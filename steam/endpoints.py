"""
Steam-Endpoints.
  /api/steam/now-playing       — was läuft grad + Playtime + Achievement-Progress
  /api/steam/recently-played   — letzte ~10 Spiele
  /api/steam/recent-unlocks    — Achievements seit letzter Anzeige (?markDisplayed=1)
  /api/steam/status            — Poller-State (Debugging)
"""
import json
import time
from urllib.parse import urlparse, parse_qs

from steam.api_client import SteamApiError
from steam.db import (
    get_owned_game, get_app_schema, get_progress,
    get_undisplayed_unlocks, mark_displayed, mark_all_displayed,
    insert_unlock_if_new, upsert_app_schema,
)


def _ok(payload):
    return json.dumps(payload).encode("utf-8"), 200, "application/json"


def _err(code, msg):
    return json.dumps({"error": msg}).encode("utf-8"), code, "application/json"


class SteamEndpointRegistry:
    def __init__(self, client, db_connect_fn,
                 poller=None, cache_ttl_s: float = 10.0):
        self.client = client
        self.db_connect = db_connect_fn
        self.poller = poller
        self.cache_ttl_s = cache_ttl_s
        self._cache = {}

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
        u = urlparse(path)
        qs = {k: v[0] for k, v in parse_qs(u.query).items()}
        route = u.path
        if route == "/api/steam/now-playing":
            return self._now_playing(qs)
        if route == "/api/steam/recently-played":
            return self._recently_played()
        if route == "/api/steam/recent-unlocks":
            return self._recent_unlocks(qs)
        if route == "/api/steam/status":
            return self._status()
        if route == "/api/steam/test-unlock":
            return self._test_unlock(qs)
        return None

    # ── Now-Playing mit Playtime + Achievement-Progress ────────────────────
    def _now_playing(self, qs):
        try:
            summary = self._cached("summary", self.client.get_player_summaries)
        except SteamApiError as e:
            return _err(502, str(e))
        game_id_raw = summary.get("gameid")
        try:
            game_id = int(game_id_raw) if game_id_raw else None
        except ValueError:
            game_id = None

        playtime_total_min = None
        playtime_2weeks_min = None
        achievements_unlocked = None
        achievements_total = None
        game_name = summary.get("gameextrainfo")
        img_icon_url = None

        if game_id:
            conn = self.db_connect()
            try:
                # Playtime aus DB-Cache (Poller füllt das alle Stunde)
                owned = get_owned_game(conn, self.client.steam_id, game_id)
                if owned:
                    playtime_total_min = owned["playtime_forever_min"]
                    playtime_2weeks_min = owned["playtime_2weeks_min"]
                    if not game_name:
                        game_name = owned["name"]
                    img_icon_url = owned["img_icon_url"]
                # Achievement-Progress aus DB
                schema = get_app_schema(conn, game_id)
                if schema:
                    achievements_total = schema["achievement_count"]
                progress = get_progress(conn, self.client.steam_id, game_id)
                if progress:
                    achievements_unlocked = progress["unlocked_count"]
            finally:
                conn.close()

        return _ok({
            "active": bool(game_id),
            "appId": game_id,
            "gameName": game_name,
            "personaName": summary.get("personaname"),
            "personaState": summary.get("personastate"),
            "avatar": summary.get("avatarfull"),
            "profileUrl": summary.get("profileurl"),
            "playtimeTotalMin": playtime_total_min,
            "playtime2WeeksMin": playtime_2weeks_min,
            "achievementsUnlocked": achievements_unlocked,
            "achievementsTotal": achievements_total,
            "imgIconUrl": img_icon_url,
        })

    def _recently_played(self):
        try:
            games = self._cached("recent", self.client.get_recently_played_games)
        except SteamApiError as e:
            return _err(502, str(e))
        return _ok({"games": games})

    # ── Recent Unlocks ──────────────────────────────────────────────────────
    def _recent_unlocks(self, qs):
        """Liefert die seit letztem Markieren noch nicht angezeigten Unlocks.
        ?markDisplayed=1 → markiert alle gelieferten als angezeigt
        ?sinceSec=N      → nur Unlocks der letzten N Sekunden (cap)
        """
        mark = qs.get("markDisplayed") == "1"
        since_sec = qs.get("sinceSec")
        since_ts = None
        if since_sec:
            try:
                since_ts = int(time.time()) - int(since_sec)
            except ValueError:
                since_ts = None

        conn = self.db_connect()
        try:
            rows = get_undisplayed_unlocks(conn, self.client.steam_id, since_ts)
            unlocks = []
            for r in rows:
                # Game-Name aus Schema-Cache
                schema = get_app_schema(conn, r["app_id"])
                gname = schema["game_name"] if schema else None
                unlocks.append({
                    "appId":        r["app_id"],
                    "gameName":     gname,
                    "apiName":      r["achievement_api_name"],
                    "displayName":  r["display_name"],
                    "description":  r["description"],
                    "iconUrl":      r["icon_url"],
                    "unlockedAt":   r["unlocked_at"],
                })
            if mark and unlocks:
                for u in unlocks:
                    mark_displayed(conn, self.client.steam_id,
                                   u["appId"], u["apiName"])
            return _ok({"unlocks": unlocks, "marked": bool(mark and unlocks)})
        finally:
            conn.close()

    # ── Status (Poller-Health) ─────────────────────────────────────────────
    def _status(self):
        if not self.poller:
            return _ok({"poller": "disabled"})
        return _ok({"poller": "active", **self.poller.status()})

    # ── Test-Unlock (Diagnose / Widget-Test) ───────────────────────────────
    def _test_unlock(self, qs):
        """Triggert einen Fake-Achievement-Unlock — fuer Widget-Tests.
        Wird via app_id=-1 markiert (kollidiert nicht mit echten Apps).

        Query-Params (alle optional):
          ?title=...    Display-Name        (Default: 'Test Achievement')
          ?desc=...     Beschreibung        (Default: 'Triggered via test endpoint')
          ?game=...     Game-Name fuer Anzeige (Default: 'Test Game')
          ?icon=...     Icon-URL             (Default: Steam-Logo)
        """
        title = qs.get("title", "Test Achievement")
        desc  = qs.get("desc",  "Triggered via test endpoint")
        game  = qs.get("game",  "Test Game")
        icon  = qs.get(
            "icon",
            "https://store.cloudflare.steamstatic.com/public/shared/images/responsive/header_logo.png")

        conn = self.db_connect()
        try:
            # Fake Schema-Eintrag fuer app_id=-1 (oder updaten)
            upsert_app_schema(conn, app_id=-1, game_name=game,
                              achievement_count=0, schema_json="{}")
            api_name = f"test_{int(time.time() * 1000)}"
            inserted = insert_unlock_if_new(
                conn, self.client.steam_id, -1, api_name,
                int(time.time()),
                display_name=title, description=desc, icon_url=icon)
            return _ok({
                "ok": True,
                "inserted": inserted,
                "apiName": api_name,
                "title": title,
            })
        finally:
            conn.close()
