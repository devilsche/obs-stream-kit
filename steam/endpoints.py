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
    get_owned_games_filtered,
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
        if route == "/api/steam/owned-games":
            return self._owned_games(qs)
        if route == "/api/steam/recent-unlocks":
            return self._recent_unlocks(qs)
        if route == "/api/steam/status":
            return self._status()
        if route == "/api/steam/test-unlock":
            return self._test_unlock(qs)
        if route == "/api/steam/test-reset":
            return self._test_reset(qs)
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

    def _owned_games(self, qs):
        """Library aus DB-Cache (Poller-getrieben), gefiltert + sortiert.
        Query-Params:
          ?filter=all|coop|multiplayer   (Default: all)
          ?sort=playtime|recent|name     (Default: playtime)
          ?minPlaytime=N                 Mindestspielzeit in Min
          ?limit=N                       Max Anzahl (Default 100)
        """
        filter_kind = qs.get("filter", "all")
        sort_by     = qs.get("sort", "playtime")
        try:
            min_playtime = int(qs.get("minPlaytime", "0"))
        except ValueError:
            min_playtime = 0
        try:
            limit = int(qs.get("limit", "100"))
        except ValueError:
            limit = 100

        conn = self.db_connect()
        try:
            rows = get_owned_games_filtered(
                conn, self.client.steam_id,
                filter_kind=filter_kind, sort_by=sort_by,
                min_playtime_min=min_playtime, limit=limit)
            games = []
            for r in rows:
                app_id = r["app_id"]
                # Cached local URLs (Server liefert 200 wenn auf Platte
                # vorhanden, sonst 404 -> Widget faellt auf remote zurueck)
                games.append({
                    "appId":             app_id,
                    "name":              r["name"],
                    "imgIconUrl":        r["img_icon_url"],
                    "imgLogoUrl":        r["img_logo_url"],
                    "headerImage":       r["header_image"],
                    "headerImageCached": f"/steam/img/{app_id}/header.jpg",
                    "imgLogoCached":     f"/steam/img/{app_id}/logo.jpg",
                    "imgIconCached":     f"/steam/img/{app_id}/icon.jpg",
                    "shortDescription":  r["short_description"],
                    "playtimeTotalMin":  r["playtime_forever_min"],
                    "playtime2WeeksMin": r["playtime_2weeks_min"],
                    "isCoop":            bool(r["is_coop"]) if r["is_coop"] is not None else None,
                    "isMultiplayer":     bool(r["is_multiplayer"]) if r["is_multiplayer"] is not None else None,
                    "detailsCached":     r["header_image"] is not None,
                })
            return _ok({
                "games": games,
                "filter": filter_kind,
                "sort": sort_by,
                "count": len(games),
            })
        finally:
            conn.close()

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
            marked_n = 0
            if mark and unlocks:
                for u in unlocks:
                    mark_displayed(conn, self.client.steam_id,
                                   u["appId"], u["apiName"])
                    marked_n += 1
                # Server-Log fuer Diagnose: in der Konsole siehst du,
                # ob Markierungen wirklich passieren.
                names = ", ".join(u["apiName"] for u in unlocks[:5])
                print(f"  steam: marked {marked_n} unlocks displayed "
                      f"[{names}{'...' if len(unlocks) > 5 else ''}]",
                      flush=True)
            return _ok({"unlocks": unlocks, "marked": marked_n})
        finally:
            conn.close()

    # ── Status (Poller-Health) ─────────────────────────────────────────────
    def _status(self):
        if not self.poller:
            return _ok({"poller": "disabled"})
        return _ok({"poller": "active", **self.poller.status()})

    def _test_reset(self, qs):
        """Markiert Test-Unlocks (app_id=-1) als displayed -> Queue
        leer, Widget zeigt wieder Now-Playing.

        Query-Params:
          ?all=1   markiert ALLE undisplayed Unlocks (auch echte)
        """
        conn = self.db_connect()
        try:
            if qs.get("all") == "1":
                n = mark_all_displayed(conn, self.client.steam_id)
            else:
                cur = conn.execute("""
                    UPDATE steam_achievements_seen
                    SET displayed_at = strftime('%s','now')
                    WHERE steam_id=? AND app_id=-1 AND displayed_at IS NULL
                """, (self.client.steam_id,))
                n = cur.rowcount
            return _ok({"marked": n})
        finally:
            conn.close()

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
