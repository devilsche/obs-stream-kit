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
import urllib.error
import urllib.parse
import urllib.request


STEAM_API_BASE = "https://api.steampowered.com"


class SteamApiError(Exception):
    pass


class SteamClient:
    def __init__(self, api_key: str, steam_id: str, timeout: float = 10.0,
                 language: str = "english"):
        self.api_key = api_key
        self.steam_id = str(steam_id)
        self.timeout = timeout
        # Steam-Language fuer Schema + Achievement-Display-Names.
        # Steam-Codes: english, german, french, spanish, italian,
        # russian, polish, portuguese, brazilian, japanese, koreana,
        # schinese, tchinese, thai, turkish, czech, danish, dutch,
        # finnish, greek, hungarian, norwegian, romanian, swedish, ...
        # Wenn Steam fuer dieses Spiel keine Uebersetzung hat,
        # fallback auf english (Steam-seitig).
        self.language = (language or "english").lower()

    # ── Low-Level ────────────────────────────────────────────────────────────
    def _get(self, path: str, **params) -> dict:
        params["key"] = self.api_key
        url = f"{STEAM_API_BASE}{path}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(
            url, headers={"User-Agent": "obs-stream-kit/1.0"})
        # Metric-Endpoint = letztes Pfadsegment (z.B. GetPlayerAchievements)
        try:
            from webcore.metrics import observe_external
            ep = path.rstrip("/").split("/")[-2] or "unknown"
            _obs = observe_external("steam", ep)
        except Exception:
            _obs = None
        if _obs is not None:
            _obs.__enter__()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                if _obs is not None:
                    _obs.set_status(r.status)
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if _obs is not None:
                _obs.set_status(e.code)
            raise SteamApiError(
                f"Steam API HTTP {e.code} on {path}: {e.reason}") from e
        except Exception as e:
            if _obs is not None:
                _obs.set_status("exception")
            raise SteamApiError(f"Steam API call failed on {path}: {e}") from e
        finally:
            if _obs is not None:
                _obs.__exit__(None, None, None)

    # ── High-Level ───────────────────────────────────────────────────────────
    def get_avatar_frame(self) -> dict:
        """Liefert den equipped Avatar-Frame (Community-Item) des Players.
        Returns {} wenn keiner equipped oder API still. Frame-URLs sind
        PNG mit Transparenz, geeignet als CSS-Overlay auf dem Avatar.
        Response-Struktur: {communityitemid, image_small, image_large}."""
        data = self._get(
            "/IPlayerService/GetAvatarFrame/v1/",
            steamid=self.steam_id)
        return ((data.get("response") or {})
                .get("avatar_frame") or {})

    def get_profile_items_equipped(self) -> dict:
        """Alle equipped Community-Items (frame, animated avatar,
        profile_background, mini_profile_background) in einem Call.
        Reichere Daten als GetAvatarFrame, gleicher Endpoint-Namespace.
        Returns die gesamte 'response'-Hash, leerer dict wenn nix."""
        data = self._get(
            "/IPlayerService/GetProfileItemsEquipped/v1/",
            steamid=self.steam_id)
        return data.get("response") or {}

    def get_player_summaries(self) -> dict:
        """Returns first player summary (avatar, online state, gameid if
        currently in-game). Empty dict if API returned nothing."""
        data = self._get(
            "/ISteamUser/GetPlayerSummaries/v0002/",
            steamids=self.steam_id)
        players = (data.get("response") or {}).get("players") or []
        return players[0] if players else {}

    def get_player_summaries_batch(self, steam_ids) -> list:
        """Batch-Variante: bis zu 100 SteamID64s in einem Call.
        Returns liste aller player-summaries. SteamIDs kann iterable
        oder comma-string sein."""
        if isinstance(steam_ids, (list, tuple, set)):
            steam_ids = ",".join(str(s) for s in steam_ids)
        if not steam_ids:
            return []
        data = self._get(
            "/ISteamUser/GetPlayerSummaries/v0002/",
            steamids=steam_ids)
        return (data.get("response") or {}).get("players") or []

    def get_friend_list(self) -> list:
        """Liefert die Friend-Liste als Liste von dicts mit Feldern
        steamid, relationship, friend_since. Funktioniert nur wenn
        die Friend-Liste oeffentlich ist — sonst leer."""
        data = self._get(
            "/ISteamUser/GetFriendList/v0001/",
            steamid=self.steam_id, relationship="friend")
        return ((data.get("friendslist") or {})
                .get("friends") or [])

    def get_player_achievements(self, app_id: int, language: str = None) -> dict:
        """Achievements for one game. Each item has 'apiname', 'achieved'
        (0/1), and 'unlocktime' (Unix epoch, 0 if locked).
        Returns: {gameName, achievements: [...], success: bool}.
        language: 'l='-Parameter fuer Display-Namen (default = self.language).
        """
        data = self._get(
            "/ISteamUserStats/GetPlayerAchievements/v0001/",
            steamid=self.steam_id, appid=app_id,
            l=language or self.language)
        return data.get("playerstats") or {}

    def get_schema_for_game(self, app_id: int, language: str = None) -> dict:
        """Achievement-Schema (display name, description, icon URLs).
        Useful to map 'apiname' → 'displayName' für Stream-Overlay.
        language: 'l='-Parameter fuer Display-Namen (default = self.language).
        """
        data = self._get(
            "/ISteamUserStats/GetSchemaForGame/v2/",
            appid=app_id, l=language or self.language)
        return (data.get("game") or {}).get("availableGameStats") or {}

    def get_recently_played_games(self) -> list:
        """Liste der zuletzt gespielten Spiele (max ~10). Pro-Game:
        appid, name, playtime_2weeks, playtime_forever."""
        data = self._get(
            "/IPlayerService/GetRecentlyPlayedGames/v0001/",
            steamid=self.steam_id, count=10)
        return (data.get("response") or {}).get("games") or []

    def get_owned_games(self) -> list:
        """Library mit Spielzeit. Privacy 'Game Details' muss public sein.
        include_played_free_games=1: F2P-MP-Titel (Warframe, Dota etc.)
        kommen mit rein, sonst fehlten sie im wanna-play-Pool.
        rtime_last_played wird wenn vorhanden direkt mitgeliefert."""
        data = self._get(
            "/IPlayerService/GetOwnedGames/v0001/",
            steamid=self.steam_id,
            include_appinfo=1,
            include_played_free_games=1)
        return (data.get("response") or {}).get("games") or []

    def get_number_of_current_players(self, app_id: int) -> int:
        """Live-Spielerzahl fuer ein App. Kein API-Key noetig — aber wir
        nutzen den `_get`-Wrapper trotzdem, damit das User-Agent-Setup
        konsistent ist. Returns None wenn nicht verfuegbar."""
        data = self._get(
            "/ISteamUserStats/GetNumberOfCurrentPlayers/v1/",
            appid=app_id)
        resp = data.get("response") or {}
        if resp.get("result") != 1:
            return None
        return resp.get("player_count")

    def get_global_achievement_percentages_for_app(self, app_id: int) -> dict:
        """Liefert {achievement_api_name: percent_float} — wie viele
        Prozent ALLER Spieler dieses Achievement haben. Useful fuer
        'rare unlock' Highlights im Popup. Kein API-Key noetig.

        Steam liefert 'percent' je nach Spiel mal als Number, mal als
        String (z.B. '12.3456'). Wir casten konsequent zu float."""
        data = self._get(
            "/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
            gameid=app_id)
        achs = ((data.get("achievementpercentages") or {})
                .get("achievements") or [])
        out = {}
        for a in achs:
            name = a.get("name")
            if not name:
                continue
            try:
                out[name] = float(a.get("percent"))
            except (TypeError, ValueError):
                continue
        return out

    def get_app_details(self, app_id: int) -> dict:
        """Storefront-API (NICHT Web-API): liefert Categories, Genres,
        Header-Image fuer ein Spiel. Kein API-Key noetig.
        Vorsicht: Rate-Limit ~200/IP/5min."""
        url = (f"https://store.steampowered.com/api/appdetails"
               f"?appids={app_id}&filters=categories,genres,basic")
        req = urllib.request.Request(
            url, headers={"User-Agent": "obs-stream-kit/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode("utf-8"))
        except Exception as e:
            raise SteamApiError(f"Storefront appdetails {app_id}: {e}") from e
        block = data.get(str(app_id)) or {}
        if not block.get("success"):
            return {}
        return block.get("data") or {}

    def get_app_media(self, app_id: int) -> dict:
        """Storefront-API: Trailer (HLS) + Screenshots fuer ein Spiel.
        Kein API-Key noetig. Returns
          {"trailers": [{"id","name","hls","thumbnail"}], "screenshots": [url,...]}
        Trailer kommen als HLS-Stream (hls_h264) -> Player braucht hls.js."""
        url = (f"https://store.steampowered.com/api/appdetails"
               f"?appids={app_id}&filters=movies,screenshots")
        req = urllib.request.Request(
            url, headers={"User-Agent": "obs-stream-kit/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode("utf-8"))
        except Exception as e:
            raise SteamApiError(f"Storefront media {app_id}: {e}") from e
        block = data.get(str(app_id)) or {}
        if not block.get("success"):
            return {"trailers": [], "screenshots": []}
        d = block.get("data") or {}
        trailers = [
            {"id": m.get("id"), "name": m.get("name"),
             "hls": m.get("hls_h264"), "thumbnail": m.get("thumbnail")}
            for m in (d.get("movies") or []) if m.get("hls_h264")
        ]
        screenshots = [
            s.get("path_full") for s in (d.get("screenshots") or [])
            if s.get("path_full")
        ]
        return {"trailers": trailers, "screenshots": screenshots}
