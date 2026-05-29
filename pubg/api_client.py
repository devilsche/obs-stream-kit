import gzip
import json
import time
import urllib.error
import urllib.request
from collections import deque


PUBG_BASE = "https://api.pubg.com"


class RateLimitError(Exception):
    pass


class ApiError(Exception):
    pass


class RateLimiter:
    def __init__(self, max_requests: int = 10, window_secs: int = 60):
        self.max = max_requests
        self.window = window_secs
        self._timestamps: deque = deque()

    def _purge(self) -> None:
        cutoff = time.monotonic() - self.window
        while self._timestamps and self._timestamps[0] < cutoff:
            self._timestamps.popleft()

    def try_acquire(self) -> bool:
        self._purge()
        if len(self._timestamps) >= self.max:
            return False
        self._timestamps.append(time.monotonic())
        return True

    def remaining(self) -> int:
        self._purge()
        return self.max - len(self._timestamps)


class PubgClient:
    def __init__(self, api_key: str, platform: str = "steam",
                 rate_limiter_max: int = 10, rate_limiter_window: int = 60):
        self.api_key = api_key
        self.platform = platform
        self.limiter = RateLimiter(rate_limiter_max, rate_limiter_window)

    def _raw_get(self, url: str, metric_endpoint: str = "unknown") -> bytes:
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/vnd.api+json",
        })
        # Lazy import — Metriken-Modul ist optional fuer Tests/CLI.
        try:
            from app.metrics import observe_external
            _obs_ctx = observe_external("pubg", metric_endpoint)
        except Exception:
            _obs_ctx = None
        if _obs_ctx is not None:
            _obs_ctx.__enter__()
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if _obs_ctx is not None:
                    _obs_ctx.set_status(resp.status)
                return resp.read()
        except urllib.error.HTTPError as e:
            if _obs_ctx is not None:
                _obs_ctx.set_status(e.code)
            raise ApiError(f"HTTP {e.code}: {e.reason}") from e
        except urllib.error.URLError as e:
            if _obs_ctx is not None:
                _obs_ctx.set_status("url_error")
            raise ApiError(f"URL error: {e.reason}") from e
        finally:
            if _obs_ctx is not None:
                _obs_ctx.__exit__(None, None, None)

    def _get_json(self, url: str, rate_limited: bool = True,
                  metric_endpoint: str = "unknown") -> dict:
        if rate_limited and not self.limiter.try_acquire():
            raise RateLimitError("Rate-Limit erreicht — bitte warten")
        body = self._raw_get(url, metric_endpoint=metric_endpoint)
        return json.loads(body.decode("utf-8"))

    def get_player(self, name: str) -> dict:
        url = (f"{PUBG_BASE}/shards/{self.platform}/players"
               f"?filter[playerNames]={name}")
        return self._get_json(url, rate_limited=True, metric_endpoint="player")

    def get_match(self, match_id: str) -> dict:
        url = f"{PUBG_BASE}/shards/{self.platform}/matches/{match_id}"
        return self._get_json(url, rate_limited=False, metric_endpoint="match")

    def get_lifetime(self, account_id: str) -> dict:
        url = (f"{PUBG_BASE}/shards/{self.platform}/players/{account_id}"
               f"/seasons/lifetime")
        return self._get_json(url, rate_limited=True, metric_endpoint="lifetime")

    def get_seasons(self) -> dict:
        url = f"{PUBG_BASE}/shards/{self.platform}/seasons"
        return self._get_json(url, rate_limited=True, metric_endpoint="seasons")

    def get_season(self, account_id: str, season_id: str) -> dict:
        url = (f"{PUBG_BASE}/shards/{self.platform}/players/{account_id}"
               f"/seasons/{season_id}")
        return self._get_json(url, rate_limited=True, metric_endpoint="season")

    @staticmethod
    def extract_current_season_id(seasons_payload: dict) -> str | None:
        """Findet die Season mit isCurrentSeason=true im /seasons-Payload."""
        try:
            for s in seasons_payload.get("data", []):
                attrs = s.get("attributes", {}) or {}
                if attrs.get("isCurrentSeason"):
                    return s.get("id")
        except (AttributeError, TypeError):
            pass
        return None

    def get_telemetry(self, telemetry_url: str) -> list:
        req = urllib.request.Request(telemetry_url, headers={
            "Accept": "application/vnd.api+json",
            "Accept-Encoding": "gzip",
        })
        try:
            from app.metrics import observe_external
            _obs = observe_external("pubg", "telemetry")
        except Exception:
            _obs = None
        if _obs is not None:
            _obs.__enter__()
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                if _obs is not None:
                    _obs.set_status(resp.status)
                data = resp.read()
        except Exception as e:
            if _obs is not None:
                _obs.set_status(getattr(e, "code", "exception"))
            raise
        finally:
            if _obs is not None:
                _obs.__exit__(None, None, None)
        if resp.headers.get("Content-Encoding") == "gzip" or data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
        return json.loads(data.decode("utf-8"))

    @staticmethod
    def extract_match_ids(player_payload: dict) -> list:
        try:
            rels = player_payload["data"][0]["relationships"]["matches"]["data"]
            return [r["id"] for r in rels]
        except (KeyError, IndexError):
            return []
