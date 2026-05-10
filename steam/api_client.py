"""
Steam Web API Client.
Wrapped Endpoints:
  - GetPlayerSummaries  → was läuft grad, Profil, Online-Status
  - GetPlayerAchievements → Achievements für ein App
  - GetSchemaForGame    → Achievement-Schema (Display-Name, Beschreibung, Icon)
  - GetOwnedGames       → Library + Spielzeit
  - GetRecentlyPlayedGames → letzte ~10 Spiele

Steam Web API erlaubt 100k Calls/Tag pro API-Key. Pro-Endpoint kein
Rate-Header, aber 429 möglich bei Bursts.

API Docs: https://steamcommunity.com/dev
API Key holen: https://steamcommunity.com/dev/apikey
"""
import json
import urllib.parse
import urllib.request


STEAM_API_BASE = "https://api.steampowered.com"


class SteamApiError(Exception):
    pass


class SteamClient:
    def __init__(self, api_key: str, steam_id: str, timeout: float = 10.0):
        self.api_key = api_key
        self.steam_id = str(steam_id)
        self.timeout = timeout

    # ── Low-Level ────────────────────────────────────────────────────────────
    def _get(self, path: str, **params) -> dict:
        params["key"] = self.api_key
        url = f"{STEAM_API_BASE}{path}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(
            url, headers={"User-Agent": "obs-stream-kit/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise SteamApiError(
                f"Steam API HTTP {e.code} on {path}: {e.reason}") from e
        except Exception as e:
            raise SteamApiError(f"Steam API call failed on {path}: {e}") from e

    # ── High-Level ───────────────────────────────────────────────────────────
    def get_player_summaries(self) -> dict:
        """Returns first player summary (avatar, online state, gameid if
        currently in-game). Empty dict if API returned nothing."""
        data = self._get(
            "/ISteamUser/GetPlayerSummaries/v0002/",
            steamids=self.steam_id)
        players = (data.get("response") or {}).get("players") or []
        return players[0] if players else {}

    def get_player_achievements(self, app_id: int) -> dict:
        """Achievements for one game. Each item has 'apiname', 'achieved'
        (0/1), and 'unlocktime' (Unix epoch, 0 if locked).
        Returns: {gameName, achievements: [...], success: bool}.
        """
        data = self._get(
            "/ISteamUserStats/GetPlayerAchievements/v0001/",
            steamid=self.steam_id, appid=app_id)
        return data.get("playerstats") or {}

    def get_schema_for_game(self, app_id: int) -> dict:
        """Achievement-Schema (display name, description, icon URLs).
        Useful to map 'apiname' → 'displayName' für Stream-Overlay."""
        data = self._get(
            "/ISteamUserStats/GetSchemaForGame/v2/",
            appid=app_id)
        return (data.get("game") or {}).get("availableGameStats") or {}

    def get_recently_played_games(self) -> list:
        """Liste der zuletzt gespielten Spiele (max ~10). Pro-Game:
        appid, name, playtime_2weeks, playtime_forever."""
        data = self._get(
            "/IPlayerService/GetRecentlyPlayedGames/v0001/",
            steamid=self.steam_id, count=10)
        return (data.get("response") or {}).get("games") or []

    def get_owned_games(self) -> list:
        """Library mit Spielzeit. Privacy 'Game Details' muss public sein."""
        data = self._get(
            "/IPlayerService/GetOwnedGames/v0001/",
            steamid=self.steam_id, include_appinfo=1)
        return (data.get("response") or {}).get("games") or []
