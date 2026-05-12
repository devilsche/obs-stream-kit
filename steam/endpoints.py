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
    get_global_achievement_pct, get_achievement_feed,
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
        if route == "/api/steam/current-players":
            return self._current_players(qs)
        if route == "/api/steam/achievement-feed":
            return self._achievement_feed(qs)
        if route == "/api/steam/status":
            return self._status()
        if route == "/api/steam/debug/achievements":
            return self._debug_achievements(qs)
        if route == "/api/steam/debug/library-features":
            return self._debug_library_features(qs)
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
            "timeCreated": summary.get("timecreated"),
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
          ?kind=all|coop|multiplayer     (Default: all; alt: ?filter=)
          ?sort=playtime|recent|name|random (Default: playtime)
          ?minPlaytime=N                 Mindestspielzeit in Min
          ?playedSinceDays=N             nur Spiele in letzten N Tagen
                                         angefasst (wanna-play-Pool)
          ?limit=N                       Max Anzahl (Default 100)

        Sort=recent nutzt Steam's GetRecentlyPlayedGames als Quelle —
        GetOwnedGames liefert playtime_2weeks inkonsistent (Pragmata
        z.B. nicht enthalten obwohl 2 Tage gespielt). Die Recently-
        Played-Liste ist Steam's autoritative Ground Truth.
        """
        # 'kind' = neuer name, 'filter' bleibt als Fallback fuer
        # alte Bookmarks. Collision mit PubgUI's '?filter=0' (Bar
        # verstecken) damit aufgeloest.
        filter_kind = qs.get("kind") or qs.get("filter", "all")
        sort_by     = qs.get("sort", "playtime")
        try:
            min_playtime = int(qs.get("minPlaytime", "0"))
        except ValueError:
            min_playtime = 0
        try:
            played_since_days = int(qs.get("playedSinceDays", "0"))
        except ValueError:
            played_since_days = 0
        try:
            limit = int(qs.get("limit", "100"))
        except ValueError:
            limit = 100

        if sort_by == "recent":
            return self._owned_games_recent(filter_kind, limit)

        conn = self.db_connect()
        try:
            rows = get_owned_games_filtered(
                conn, self.client.steam_id,
                filter_kind=filter_kind, sort_by=sort_by,
                min_playtime_min=min_playtime,
                played_since_days=played_since_days, limit=limit)
            games = [self._enrich_row(r) for r in rows]
            return _ok({
                "games": games,
                "kind": filter_kind,
                "sort": sort_by,
                "playedSinceDays": played_since_days,
                "count": len(games),
            })
        finally:
            conn.close()

    def _enrich_row(self, r):
        """Standard-Game-Dict aus einer steam_owned_games-Row."""
        app_id = r["app_id"]
        return {
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
            "lastPlayedAt":      r["last_played_at"],
            "steamLastPlayed":   r["steam_last_played"],
            "isCoop":            (bool(r["is_coop"])
                                  if r["is_coop"] is not None else None),
            "isMultiplayer":     (bool(r["is_multiplayer"])
                                  if r["is_multiplayer"] is not None else None),
            "detailsCached":     r["header_image"] is not None,
        }

    def _owned_games_recent(self, filter_kind: str, limit: int):
        """sort=recent: hole frische Recently-Played-Liste von Steam,
        ueberlagere die Cache-Daten + Categories."""
        try:
            recent = self._cached(
                "recent", self.client.get_recently_played_games)
        except SteamApiError as e:
            return _err(502, str(e))
        if not recent:
            return _ok({"games": [], "filter": filter_kind,
                        "sort": "recent", "count": 0,
                        "source": "GetRecentlyPlayedGames"})

        # Reihenfolge wie Steam liefert (= sortiert nach playtime_2weeks
        # bzw. Last-Played). Bei filter=coop/multiplayer brauchen wir
        # die Categories aus dem Cache zum filtern.
        conn = self.db_connect()
        try:
            games = []
            for rp in recent:
                app_id = rp.get("appid")
                if not app_id:
                    continue
                # Vollen Cache-Row holen (Categories, header_image,
                # short_description etc.). Wenn nicht da, fallback auf
                # Steam-Recently-Played-Felder.
                row = conn.execute("""
                    SELECT og.app_id, og.name, og.img_icon_url, og.img_logo_url,
                           og.playtime_forever_min, og.playtime_2weeks_min,
                           og.last_played_at, og.steam_last_played,
                           ad.header_image, ad.short_description,
                           ad.is_coop, ad.is_multiplayer, ad.category_ids
                    FROM steam_owned_games og
                    LEFT JOIN steam_app_details ad ON ad.app_id = og.app_id
                    WHERE og.steam_id = ? AND og.app_id = ?
                """, (self.client.steam_id, app_id)).fetchone()

                if row:
                    game = self._enrich_row(row)
                    # Recently-Played-Werte gewinnen — Steam serviert
                    # hier frische Daten ohne 1h-Sync-Lag.
                    if rp.get("playtime_2weeks"):
                        game["playtime2WeeksMin"] = rp["playtime_2weeks"]
                    if rp.get("playtime_forever"):
                        game["playtimeTotalMin"] = rp["playtime_forever"]
                else:
                    # Spiel nicht in unserer owned-games Tabelle (z.B.
                    # frisch gekauftes, Layer-1-Sync noch nicht durch).
                    # Minimal-Eintrag aus Recently-Played selbst bauen.
                    game = {
                        "appId":             app_id,
                        "name":              rp.get("name"),
                        "imgIconUrl":        None,
                        "imgLogoUrl":        None,
                        "headerImage":       None,
                        "headerImageCached": f"/steam/img/{app_id}/header.jpg",
                        "imgLogoCached":     f"/steam/img/{app_id}/logo.jpg",
                        "imgIconCached":     f"/steam/img/{app_id}/icon.jpg",
                        "shortDescription":  None,
                        "playtimeTotalMin":  rp.get("playtime_forever") or 0,
                        "playtime2WeeksMin": rp.get("playtime_2weeks") or 0,
                        "lastPlayedAt":      None,
                        "steamLastPlayed":   None,
                        "isCoop":            None,
                        "isMultiplayer":     None,
                        "detailsCached":     False,
                    }

                # Filter nach Category greift erst NACH dem Lookup —
                # filter=coop/multiplayer braucht ad.is_coop. Bei
                # unbekannten (frisch gekauft) ohne Categories: raus.
                if filter_kind == "coop" and not game["isCoop"]:
                    continue
                if filter_kind == "multiplayer" and not game["isMultiplayer"]:
                    continue
                games.append(game)
                if len(games) >= limit:
                    break

            return _ok({
                "games": games,
                "filter": filter_kind,
                "sort": "recent",
                "count": len(games),
                "source": "GetRecentlyPlayedGames",
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
                # Global-Pct: wie viele Prozent aller Spieler haben dieses
                # Achievement? <5% = 'rare unlock' → Glow im Popup.
                global_pct = None
                if schema and schema["global_pct_json"]:
                    try:
                        pct_map = json.loads(schema["global_pct_json"])
                        raw = pct_map.get(r["achievement_api_name"])
                        global_pct = (float(raw)
                                      if raw is not None else None)
                    except (TypeError, ValueError, json.JSONDecodeError):
                        pass
                unlocks.append({
                    "appId":        r["app_id"],
                    "gameName":     gname,
                    "apiName":      r["achievement_api_name"],
                    "displayName":  r["display_name"],
                    "description":  r["description"],
                    "iconUrl":      r["icon_url"],
                    "unlockedAt":   r["unlocked_at"],
                    "globalPct":    global_pct,
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

    # ── Current Players (Live-Counter) ─────────────────────────────────────
    def _current_players(self, qs):
        """Live-Spielerzahl fuer ein Game.
        Query: ?appId=<id>  — wenn fehlend: nimmt currentAppId vom Poller.
        Antwort: { active: bool, appId: int, count: int }
        Cache: 60s (Steam-Endpoint vertraegt aber Last; konservativ)."""
        app_id = qs.get("appId")
        if not app_id and self.poller:
            app_id = self.poller.status().get("currentAppId")
        try:
            app_id = int(app_id) if app_id else None
        except (TypeError, ValueError):
            app_id = None
        if not app_id:
            return _ok({"active": False, "appId": None, "count": None})

        cache_key = f"current_players:{app_id}"
        now = time.monotonic()
        hit = self._cache.get(cache_key)
        if hit and now - hit[0] < 60.0:
            count = hit[1]
        else:
            try:
                count = self.client.get_number_of_current_players(app_id)
            except SteamApiError as e:
                return _err(502, str(e))
            self._cache[cache_key] = (now, count)
        return _ok({"active": True, "appId": app_id, "count": count})

    # ── Achievement Feed (letzte N Unlocks) ────────────────────────────────
    def _achievement_feed(self, qs):
        """Letzte N freigeschalteten Achievements aus der DB — fuer den
        Feed-Ticker. Liefert IMMER Daten (auch alte), unabhaengig vom
        displayed_at-Flag.
        Query: ?limit=N  (Default 20, max 100)
        """
        try:
            limit = max(1, min(100, int(qs.get("limit", "20"))))
        except ValueError:
            limit = 20
        conn = self.db_connect()
        try:
            rows = get_achievement_feed(conn, self.client.steam_id, limit)
            unlocks = []
            for r in rows:
                schema = get_app_schema(conn, r["app_id"])
                gname = schema["game_name"] if schema else None
                # Global-Pct nachladen wenn Schema vorhanden
                global_pct = None
                if schema and schema["global_pct_json"]:
                    try:
                        pct_map = json.loads(schema["global_pct_json"])
                        raw = pct_map.get(r["achievement_api_name"])
                        global_pct = (float(raw)
                                      if raw is not None else None)
                    except (TypeError, ValueError, json.JSONDecodeError):
                        pass
                unlocks.append({
                    "appId":       r["app_id"],
                    "gameName":    gname,
                    "apiName":     r["achievement_api_name"],
                    "displayName": r["display_name"],
                    "description": r["description"],
                    "iconUrl":     r["icon_url"],
                    "unlockedAt":  r["unlocked_at"],
                    "globalPct":   global_pct,
                })
            return _ok({"unlocks": unlocks, "count": len(unlocks)})
        finally:
            conn.close()

    # ── Debug: Achievement-Roh-Antwort fuer ein Game ───────────────────────
    def _debug_achievements(self, qs):
        """Zeigt die rohe Steam-Antwort fuer GetPlayerAchievements +
        GetSchemaForGame fuer eine appId. Diagnostik wenn ein Game
        (z.B. PUBG) keine Unlocks zeigt — sieht man:
          - liefert Steam ueberhaupt eine Liste?
          - sind 'achieved' und 'unlocktime' gesetzt?
          - existiert ein Schema (display_name + icon)?
        Query: ?appId=<id>  (oder Default: aktuell laufendes Spiel)
        """
        app_id = qs.get("appId")
        if not app_id and self.poller:
            app_id = self.poller.status().get("currentAppId")
        try:
            app_id = int(app_id) if app_id else None
        except (TypeError, ValueError):
            app_id = None
        if not app_id:
            return _err(400, "appId required (or game must be running)")

        result = {"appId": app_id}
        try:
            stats = self.client.get_player_achievements(app_id)
            achs = stats.get("achievements") or []
            result["achievementsCall"] = {
                "success": stats.get("success", True),
                "gameName": stats.get("gameName"),
                "error":    stats.get("error"),
                "totalAchievements":   len(achs),
                "unlockedCount":       sum(1 for a in achs if a.get("achieved")),
                "withUnlocktime":      sum(1 for a in achs
                                            if a.get("achieved")
                                            and (a.get("unlocktime") or 0) > 0),
                "sampleUnlocked":      [a for a in achs
                                        if a.get("achieved")][:3],
                "sampleLocked":        [a for a in achs
                                        if not a.get("achieved")][:2],
            }
        except SteamApiError as e:
            result["achievementsCall"] = {"error": str(e)}

        try:
            schema = self.client.get_schema_for_game(app_id)
            schema_achs = schema.get("achievements") or []
            result["schemaCall"] = {
                "achievementCount": len(schema_achs),
                "sample": schema_achs[:3],
            }
        except SteamApiError as e:
            result["schemaCall"] = {"error": str(e)}

        # DB-Stand fuer Vergleich
        conn = self.db_connect()
        try:
            row = conn.execute("""
                SELECT COUNT(*) AS n FROM steam_achievements_seen
                WHERE steam_id=? AND app_id=?
            """, (self.client.steam_id, app_id)).fetchone()
            result["dbStoredCount"] = row["n"]
            prog = conn.execute("""
                SELECT unlocked_count, last_checked FROM steam_app_progress
                WHERE steam_id=? AND app_id=?
            """, (self.client.steam_id, app_id)).fetchone()
            result["dbProgress"] = (dict(prog) if prog else None)
        finally:
            conn.close()

        return _ok(result)

    # ── Debug: Library-Features ────────────────────────────────────────────
    def _debug_library_features(self, qs):
        """Checkt fuer die Top-Played-Games was an Stream-Daten via Steam
        verfuegbar waere — UserStats (Kills/Deaths/etc), Review-Score,
        News. Hilft zu entscheiden welche Steam-API-Features sich fuer
        DIESEN Streamer lohnen zu integrieren.
        Query: ?limit=N (Default 12, max 30) — Anzahl Top-Games
        """
        try:
            limit = max(1, min(30, int(qs.get("limit", "12"))))
        except ValueError:
            limit = 12

        conn = self.db_connect()
        try:
            rows = conn.execute("""
                SELECT app_id, name, playtime_forever_min
                FROM steam_owned_games
                WHERE steam_id=? AND playtime_forever_min > 30
                ORDER BY playtime_forever_min DESC
                LIMIT ?
            """, (self.client.steam_id, limit)).fetchall()
        finally:
            conn.close()

        import urllib.error
        import urllib.request

        def _hours(min_): return round((min_ or 0) / 60, 1)

        results = []
        for r in rows:
            app_id = r["app_id"]
            info = {
                "appId":         app_id,
                "name":          r["name"],
                "playtimeHours": _hours(r["playtime_forever_min"]),
                "userStats":     None,
                "reviews":       None,
                "news":          None,
            }
            # GetUserStatsForGame — was an in-game-Stats publiziert wird
            try:
                d = self.client._get(
                    "/ISteamUserStats/GetUserStatsForGame/v0002/",
                    steamid=self.client.steam_id, appid=app_id)
                ps = d.get("playerstats") or {}
                stats = ps.get("stats") or []
                info["userStats"] = {
                    "count":  len(stats),
                    "sample": [s.get("name") for s in stats[:10]],
                }
            except SteamApiError as e:
                info["userStats"] = {"error": str(e).split(" on ")[0]}

            # Storefront appreviews — public score+count
            try:
                url = (f"https://store.steampowered.com/appreviews/{app_id}"
                       f"?json=1&purchase_type=all&num_per_page=0&language=all")
                req = urllib.request.Request(
                    url, headers={"User-Agent": "obs-stream-kit/1.0"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    rev = json.loads(resp.read().decode("utf-8"))
                qsum = rev.get("query_summary") or {}
                tot = qsum.get("total_reviews") or 0
                pos = qsum.get("total_positive") or 0
                pct = round(pos / tot * 100, 1) if tot > 0 else None
                info["reviews"] = {
                    "totalReviews":  tot,
                    "positivePct":   pct,
                    "scoreDesc":     qsum.get("review_score_desc"),
                }
            except (urllib.error.URLError, urllib.error.HTTPError,
                    json.JSONDecodeError, OSError) as e:
                info["reviews"] = {"error": str(e)[:80]}

            # GetNewsForApp — was an offiziellem Game-News kommt
            try:
                d = self.client._get(
                    "/ISteamNews/GetNewsForApp/v0002/",
                    appid=app_id, count=3, maxlength=200)
                items = (d.get("appnews") or {}).get("newsitems") or []
                info["news"] = {
                    "count":   len(items),
                    "latest":  (items[0].get("title")
                                if items else None),
                    "latestAgeDays": (
                        int((time.time() - items[0].get("date", 0)) / 86400)
                        if items else None),
                }
            except SteamApiError as e:
                info["news"] = {"error": str(e).split(" on ")[0]}

            results.append(info)

        return _ok({"games": results, "count": len(results)})

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
