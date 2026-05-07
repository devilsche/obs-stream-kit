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

    def _raw_get(self, url: str) -> bytes:
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/vnd.api+json",
        })
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            raise ApiError(f"HTTP {e.code}: {e.reason}") from e
        except urllib.error.URLError as e:
            raise ApiError(f"URL error: {e.reason}") from e

    def _get_json(self, url: str, rate_limited: bool = True) -> dict:
        if rate_limited and not self.limiter.try_acquire():
            raise RateLimitError("Rate-Limit erreicht — bitte warten")
        body = self._raw_get(url)
        return json.loads(body.decode("utf-8"))

    def get_player(self, name: str) -> dict:
        # /players is rate-limited (10 RPM default)
        url = (f"{PUBG_BASE}/shards/{self.platform}/players"
               f"?filter[playerNames]={name}")
        return self._get_json(url, rate_limited=True)

    def get_match(self, match_id: str) -> dict:
        # /matches/{id} is NOT rate-limited per PUBG docs
        # (rate-limits.rst → "Expected Rate Limit Usage")
        url = f"{PUBG_BASE}/shards/{self.platform}/matches/{match_id}"
        return self._get_json(url, rate_limited=False)

    def get_lifetime(self, account_id: str) -> dict:
        # /players/{id}/seasons/lifetime is rate-limited
        url = (f"{PUBG_BASE}/shards/{self.platform}/players/{account_id}"
               f"/seasons/lifetime")
        return self._get_json(url, rate_limited=True)

    def get_seasons(self) -> dict:
        # Liste aller Seasons der Plattform — eine hat
        # attributes.isCurrentSeason=true. Rate-limited (selten gerufen,
        # aktuelle Season-ID wechselt nur alle paar Monate).
        url = f"{PUBG_BASE}/shards/{self.platform}/seasons"
        return self._get_json(url, rate_limited=True)

    def get_season(self, account_id: str, season_id: str) -> dict:
        # /players/{id}/seasons/{seasonId} liefert non-ranked Aggregat
        # für DIESE Season inkl. assists/damageDealt/dBNOs/revives.
        # Rate-limited.
        url = (f"{PUBG_BASE}/shards/{self.platform}/players/{account_id}"
               f"/seasons/{season_id}")
        return self._get_json(url, rate_limited=True)

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
        # Telemetry-CDN, no API-Key needed, no rate-limit on this endpoint.
        # CDN delivers gzip-compressed JSON regardless of Accept-Encoding header.
        req = urllib.request.Request(telemetry_url, headers={
            "Accept": "application/vnd.api+json",
            "Accept-Encoding": "gzip",
        })
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
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
