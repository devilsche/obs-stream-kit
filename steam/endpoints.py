"""
Steam-Endpoints. Klein gehalten: erst nur Now-Playing.
Achievement-Polling + DB folgt im nächsten Schritt.
"""
import json
import time

from steam.api_client import SteamApiError


def _ok(payload):
    return json.dumps(payload).encode("utf-8"), 200, "application/json"


def _err(code, msg):
    return json.dumps({"error": msg}).encode("utf-8"), code, "application/json"


class SteamEndpointRegistry:
    def __init__(self, client, cache_ttl_s: float = 10.0):
        self.client = client
        self.cache_ttl_s = cache_ttl_s
        self._cache = {}  # key → (ts, value)

    def _cached(self, key, fn):
        now = time.monotonic()
        hit = self._cache.get(key)
        if hit and now - hit[0] < self.cache_ttl_s:
            return hit[1]
        value = fn()
        self._cache[key] = (now, value)
        return value

    def dispatch(self, method: str, path: str, body: bytes, headers: dict):
        if method != "GET":
            return None
        if path == "/api/steam/now-playing":
            return self._now_playing()
        if path == "/api/steam/recently-played":
            return self._recently_played()
        return None

    def _now_playing(self):
        try:
            summary = self._cached("summary", self.client.get_player_summaries)
        except SteamApiError as e:
            return _err(502, str(e))
        game_id_raw = summary.get("gameid")
        try:
            game_id = int(game_id_raw) if game_id_raw else None
        except ValueError:
            game_id = None
        return _ok({
            "active": bool(game_id),
            "appId": game_id,
            "gameName": summary.get("gameextrainfo"),
            "personaName": summary.get("personaname"),
            "personaState": summary.get("personastate"),  # 0=offline, 1=online
            "avatar": summary.get("avatarfull"),
            "profileUrl": summary.get("profileurl"),
        })

    def _recently_played(self):
        try:
            games = self._cached("recent", self.client.get_recently_played_games)
        except SteamApiError as e:
            return _err(502, str(e))
        return _ok({"games": games})
