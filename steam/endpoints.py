"""
Steam-Endpoints.
  /api/steam/now-playing       — was läuft grad + Playtime + Achievement-Progress
  /api/steam/recently-played   — letzte ~10 Spiele
  /api/steam/recent-unlocks    — Achievements seit letzter Anzeige (?markDisplayed=1)
  /api/steam/status            — Poller-State (Debugging)
"""
import json
import os
import time
from urllib.parse import urlparse, parse_qs

from steam.api_client import SteamApiError
from steam.db_pg import (
    get_owned_game, get_app_schema, get_progress,
    get_undisplayed_unlocks, mark_displayed, mark_all_displayed,
    insert_unlock_if_new, upsert_app_schema,
    get_owned_games_filtered,
    get_global_achievement_pct, get_achievement_feed,
    upsert_global_achievement_pct, upsert_progress,
    get_app_schema_lang, upsert_app_schema_lang,
)
import threading


# Spec 1 Tenant-Migration: hardcodiert auf 1 (Owner-Tenant), wird in
# Spec 2 entfernt sobald Session-basierte Auth den Tenant aus dem
# Login-Context liefert.
HARDCODED_TENANT_ID = 1


def _json_default(o):
    # psycopg2 liefert NUMERIC/REAL als decimal.Decimal — JSON kennt das nicht
    import decimal
    if isinstance(o, decimal.Decimal):
        return float(o)
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def _ok(payload):
    return json.dumps(payload, default=_json_default).encode("utf-8"), 200, "application/json"


def _err(code, msg):
    return json.dumps({"error": msg}).encode("utf-8"), code, "application/json"


class SteamEndpointRegistry:
    def __init__(self, client, db_connect_fn,
                 poller=None, cache_ttl_s: float = 10.0,
                 root_dir: str = None):
        self.client = client
        self.db_connect = db_connect_fn
        self.poller = poller
        self.cache_ttl_s = cache_ttl_s
        self.root_dir = root_dir or os.getcwd()
        self._cache = {}
        # Persistente Steam-Prefs aus data/steam-prefs.json — Sprache
        # darin ueberschreibt was im SteamClient kam (= .secrets-Wert).
        # So kann der User die Sprache ueber's API andern und es bleibt.
        self._load_prefs()
        # Backfill: alle bisher in steam_app_schema gespeicherten
        # Schemas einmalig auch in steam_app_schema_lang(current_lang)
        # ablegen, damit Switch zur Current-Lang nicht alles neu pullt.
        self._backfill_lang_cache()
        # AppID -> {name, headerImage, capsuleImage} (Persistenz waehrend
        # Server-Run). Genutzt wenn ein Game nicht in der DB ist (Non-
        # Steam-via-Proton, fakeAppId-Tests, fresh-bought games).
        # Storefront-API hat ~200/IP/5min Rate-Limit; ohne diesen Cache
        # wuerden wiederholte Polls den Limit pruegeln.
        self._app_meta = {}
        # Avatar-Frame + Animated-Avatar URLs (Community-Items, aendern
        # sich selten). Refresh 1×/h reicht.
        self._profile_items = None
        self._profile_items_fetched_at = 0
        # Friend-Liste (steamid64 strings). Refresh 1×/h — Freunde
        # aendern sich nicht minuetlich.
        self._friend_ids = None
        self._friend_ids_fetched_at = 0
        # Bulk-Achievement-Sync (Backfill ALLER owned games)
        self._sync_thread = None
        self._sync_progress = {}

    def _get_profile_items(self):
        """Cached fetch von Frame + Animated-Avatar (1× pro Stunde).
        Returns dict {avatarFrame, animatedAvatar} mit absoluten URLs
        oder None. Beides sind getrennte Steam-Community-Items."""
        now = time.monotonic()
        if (self._profile_items is not None
                and now - self._profile_items_fetched_at < 3600):
            return self._profile_items
        out = {"avatarFrame": None, "animatedAvatar": None}
        try:
            items = self.client.get_profile_items_equipped()
            af = items.get("avatar_frame") or {}
            # Frame: image_small ist die ANIMIERTE APNG-Variante
            # (z.B. Aghanim Frame), image_large das statische
            # Standbild. User-bestaetigt 2026-05-12.
            out["avatarFrameAnim"] = self._build_community_image_url(
                af.get("image_small"))
            out["avatarFrameStatic"] = self._build_community_image_url(
                af.get("image_large"))
            out["avatarFrame"] = (out["avatarFrameAnim"]
                                  or out["avatarFrameStatic"])
            aa = items.get("animated_avatar") or {}
            # Animated Avatar (separates Item, nicht-deterministisch
            # ob small oder large das animierte ist — beide exposen).
            out["animatedAvatarLarge"] = self._build_community_image_url(
                aa.get("image_large"))
            out["animatedAvatarSmall"] = self._build_community_image_url(
                aa.get("image_small"))
            out["animatedAvatar"] = (out["animatedAvatarLarge"]
                                      or out["animatedAvatarSmall"])
        except SteamApiError:
            pass
        # GetAvatarFrame als Fallback falls GetProfileItemsEquipped
        # leer war (Steam ist da inkonsistent).
        if not out["avatarFrame"]:
            try:
                frame = self.client.get_avatar_frame()
                out["avatarFrame"] = self._build_community_image_url(
                    frame.get("image_large") or frame.get("image_small"))
            except SteamApiError:
                pass
        self._profile_items = out
        self._profile_items_fetched_at = now
        return out

    @staticmethod
    def _derive_library_url(header_url, app_id, filename):
        """Library-Variante (library_600x900.jpg etc.) zum Header
        ableiten. Header sieht so aus:
          .../store_item_assets/steam/apps/<id>/<hash>/header.jpg?t=...
        Library liegt am SELBEN Hash-Verzeichnis. Falls Header auf
        altem CDN (cdn.cloudflare.steamstatic.com/steam/apps/<id>/),
        ist Library dort auch.

        Falls Header None ist, geben wir die alte CDN-URL als
        Spekulation zurueck — fuer aeltere Games klappt sie."""
        if header_url:
            base = header_url.split("?", 1)[0]  # ?t=… abschneiden
            if "/header.jpg" in base:
                return base.replace("/header.jpg", "/" + filename)
        if app_id:
            return (f"https://cdn.cloudflare.steamstatic.com"
                    f"/steam/apps/{app_id}/{filename}")
        return None

    @staticmethod
    def _build_community_image_url(raw):
        """Baut absolute URL fuer ein Steam-Community-Item-Bild.
        - absolute URL: durchreichen
        - relative (z.B. 'items/<appid>/<hash>.png'): CDN-Prefix dran
        - leer/None: None
        """
        if not raw:
            return None
        if raw.startswith("http://") or raw.startswith("https://"):
            return raw
        base = ("https://cdn.cloudflare.steamstatic.com"
                "/steamcommunity/public/images/")
        return base + raw.lstrip("/")

    def _backfill_lang_cache(self):
        """One-shot beim Server-Start: schreibt jeden steam_app_schema-
        Eintrag der noch keinen Lang-Cache fuer die current_lang hat
        dorthin um. Damit erspart sich der erste Sprach-Switch zur
        Server-Default-Sprache ein erneutes Pullen pro Game."""
        lang = (self.client.language or "english").lower()
        if not lang:
            return
        conn = self.db_connect()
        try:
            rows = conn.execute("""
                SELECT s.app_id, s.schema_json
                FROM steam_app_schema s
                LEFT JOIN steam_app_schema_lang l
                  ON l.app_id = s.app_id AND l.lang = %s
                WHERE s.schema_json IS NOT NULL
                  AND s.schema_json != '{}'
                  AND l.app_id IS NULL
            """, (lang,)).fetchall()
            for r in rows:
                try:
                    full = json.loads(r["schema_json"])
                except (TypeError, json.JSONDecodeError):
                    continue
                lang_lookup = {
                    api: {"displayName": v.get("displayName"),
                          "description": v.get("description")}
                    for api, v in full.items()
                }
                upsert_app_schema_lang(
                    conn, r["app_id"], lang, json.dumps(lang_lookup))
        except Exception:
            pass
        finally:
            conn.close()

    def _prefs_path(self):
        return os.path.join(self.root_dir, "data", "steam-prefs.json")

    def _load_prefs(self):
        path = self._prefs_path()
        if not os.path.exists(path):
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                prefs = json.load(f)
        except (OSError, json.JSONDecodeError):
            return
        lang = (prefs.get("language") or "").strip().lower()
        if lang:
            self.client.language = lang

    def _save_prefs(self, **updates):
        path = self._prefs_path()
        prefs = {}
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    prefs = json.load(f)
            except (OSError, json.JSONDecodeError):
                prefs = {}
        prefs.update(updates)
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(prefs, f, indent=2)
        except OSError:
            pass

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
        if route == "/api/steam/friends-in-lobby":
            return self._friends_in_lobby(qs)
        if route == "/api/steam/friends-status":
            return self._friends_status(qs)
        if route == "/api/steam/achievement-feed":
            return self._achievement_feed(qs)
        if route == "/api/steam/status":
            return self._status()
        if route == "/api/steam/debug/achievements":
            return self._debug_achievements(qs)
        if route == "/api/steam/debug/library-features":
            return self._debug_library_features(qs)
        if route == "/api/steam/debug/profile-items":
            return self._debug_profile_items(qs)
        if route == "/api/steam/test-unlock":
            return self._test_unlock(qs)
        if route == "/api/steam/test-reset":
            return self._test_reset(qs)
        if route == "/api/steam/replay-achievements":
            return self._replay_achievements(qs)
        if route == "/api/steam/achievements-list":
            return self._achievements_list(qs)
        if route == "/api/steam/language":
            return self._language_setting(qs)
        if route == "/api/steam/sync-all-achievements":
            return self._sync_all_achievements(qs)
        return None

    # ── Now-Playing mit Playtime + Achievement-Progress ────────────────────
    def _now_playing(self, qs):
        try:
            summary = self._cached("summary", self.client.get_player_summaries)
        except SteamApiError as e:
            return _err(502, str(e))

        # Test-Override: ?fakeAppId=578080[&fakeGame=NAME] simuliert das
        # Spiel als 'gerade aktiv', alle anderen Felder bleiben real
        # (Avatar, Persona, timeCreated). Praktisch ohne Steam-Client
        # offen / ohne Game am Laufen.
        fake_app_raw = qs.get("fakeAppId")
        if fake_app_raw:
            try:
                game_id = int(fake_app_raw)
            except ValueError:
                game_id = None
        else:
            game_id_raw = summary.get("gameid")
            try:
                game_id = int(game_id_raw) if game_id_raw else None
            except ValueError:
                game_id = None

        playtime_total_min = None
        playtime_2weeks_min = None
        achievements_unlocked = None
        achievements_total = None
        game_name = qs.get("fakeGame") or summary.get("gameextrainfo")
        img_icon_url = None
        store_header = None
        store_capsule = None
        store_lib_bg = None
        store_lib_logo = None

        if game_id:
            conn = self.db_connect()
            try:
                # Playtime aus DB-Cache (Poller füllt das alle Stunde)
                owned = get_owned_game(conn, HARDCODED_TENANT_ID,
                                        self.client.steam_id, game_id)
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
                progress = get_progress(conn, HARDCODED_TENANT_ID,
                                         self.client.steam_id, game_id)
                if progress:
                    achievements_unlocked = progress["unlocked_count"]
            finally:
                conn.close()

            # Storefront-Meta IMMER pullen — liefert die einzigen
            # zuverlaessigen Image-URLs (akamai-content-hashed) und
            # ueberlebt sowohl die alten /steam/apps/-Pattern als auch
            # die Library-Hash-Variante. Cached pro AppID fuer Server-
            # Laufzeit, also nur 1 Storefront-Call pro Game.
            meta = self._app_meta.get(game_id)
            if meta is None:
                try:
                    details = self.client.get_app_details(game_id)
                    meta = {
                        "name":         details.get("name"),
                        "headerImage":  details.get("header_image"),
                        "capsuleImage": details.get("capsule_image"),
                    }
                except SteamApiError:
                    meta = {}
                # library_600x900 + library_logo gibt's nicht direkt in
                # appdetails; abgeleitet aus dem Hash-Pfad des Headers
                # (gleiches store_item_assets-Verzeichnis). Falls Header
                # auf altem CDN liegt, ist die Library-Variante dort
                # auch (cdn.cloudflare.steamstatic.com/steam/apps/<id>/).
                meta["library600x900"] = self._derive_library_url(
                    meta.get("headerImage"), game_id, "library_600x900.jpg")
                meta["libraryLogo"] = self._derive_library_url(
                    meta.get("headerImage"), game_id, "library_logo.png")
                self._app_meta[game_id] = meta
            if not game_name:
                game_name = meta.get("name")
            store_header  = meta.get("headerImage")
            store_capsule = meta.get("capsuleImage")
            store_lib_bg  = meta.get("library600x900")
            store_lib_logo= meta.get("libraryLogo")

        return _ok({
            "active": bool(game_id),
            "appId": game_id,
            "gameName": game_name,
            "personaName": summary.get("personaname"),
            "personaState": summary.get("personastate"),
            "avatar": (self._get_profile_items().get("animatedAvatar")
                       or summary.get("avatarfull")),
            "avatarStatic": summary.get("avatarfull"),
            "avatarFrame": self._get_profile_items().get("avatarFrame"),
            "avatarFrameAnim": self._get_profile_items().get("avatarFrameAnim"),
            "avatarFrameStatic": self._get_profile_items().get("avatarFrameStatic"),
            "animatedAvatar": self._get_profile_items().get("animatedAvatar"),
            "animatedAvatarLarge": self._get_profile_items().get("animatedAvatarLarge"),
            "animatedAvatarSmall": self._get_profile_items().get("animatedAvatarSmall"),
            "profileUrl": summary.get("profileurl"),
            "timeCreated": summary.get("timecreated"),
            "playtimeTotalMin": playtime_total_min,
            "playtime2WeeksMin": playtime_2weeks_min,
            "achievementsUnlocked": achievements_unlocked,
            "achievementsTotal": achievements_total,
            "imgIconUrl": img_icon_url,
            "headerImageUrl": store_header,
            "capsuleImageUrl": store_capsule,
            "libraryBgUrl":   store_lib_bg,
            "libraryLogoUrl": store_lib_logo,
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
                conn, HARDCODED_TENANT_ID, self.client.steam_id,
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
                    WHERE og.tenant_id = %s AND og.steam_id = %s
                      AND og.app_id = %s
                """, (HARDCODED_TENANT_ID, self.client.steam_id,
                      app_id)).fetchone()

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
            rows = get_undisplayed_unlocks(
                conn, HARDCODED_TENANT_ID, self.client.steam_id, since_ts)
            unlocks = []
            # Aktive Server-Sprache fuer Display-Translation
            lang = (self.client.language or "").lower()
            lang_lookups = {}  # app_id -> {api_name: {displayName, description}}
            unique_apps = set(r["app_id"] for r in rows)
            for ap in unique_apps:
                if not lang:
                    break
                cached = get_app_schema_lang(conn, ap, lang)
                if cached and cached["schema_json"]:
                    try:
                        lang_lookups[ap] = json.loads(cached["schema_json"])
                        continue
                    except json.JSONDecodeError:
                        pass
                # Frisch fuer diese Sprache holen
                try:
                    schema = self.client.get_schema_for_game(ap, language=lang)
                    schema_achs = schema.get("achievements") or []
                    lookup = {
                        a.get("name"): {
                            "displayName": a.get("displayName"),
                            "description": a.get("description"),
                        }
                        for a in schema_achs if a.get("name")
                    }
                    upsert_app_schema_lang(
                        conn, ap, lang, json.dumps(lookup))
                    lang_lookups[ap] = lookup
                except SteamApiError:
                    upsert_app_schema_lang(conn, ap, lang, "{}")
                    lang_lookups[ap] = {}
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
                # Display-Translation in aktive Sprache (falls Cache da)
                disp = r["display_name"]
                desc = r["description"]
                meta = (lang_lookups.get(r["app_id"]) or {}).get(
                    r["achievement_api_name"])
                if meta:
                    disp = meta.get("displayName") or disp
                    desc = meta.get("description") or desc
                unlocks.append({
                    "appId":        r["app_id"],
                    "gameName":     gname,
                    "apiName":      r["achievement_api_name"],
                    "displayName":  disp,
                    "description":  desc,
                    "iconUrl":      r["icon_url"],
                    "unlockedAt":   r["unlocked_at"],
                    "globalPct":    global_pct,
                })
            marked_n = 0
            if mark and unlocks:
                for u in unlocks:
                    mark_displayed(conn, HARDCODED_TENANT_ID,
                                   self.client.steam_id,
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

    # ── Friends-In-Lobby ───────────────────────────────────────────────────
    def _get_friend_ids(self):
        """Cached Friend-IDs (1× pro Stunde). Returns list of SteamID64
        strings. Leer wenn Friend-Liste privat oder API down."""
        now = time.monotonic()
        if (self._friend_ids is not None
                and now - self._friend_ids_fetched_at < 3600):
            return self._friend_ids
        try:
            friends = self.client.get_friend_list()
            self._friend_ids = [f.get("steamid") for f in friends
                                 if f.get("steamid")]
        except SteamApiError:
            self._friend_ids = []
        self._friend_ids_fetched_at = now
        return self._friend_ids

    def _friends_in_lobby(self, qs):
        """Welche Freunde sind grad in derselben Lobby + Game wie der
        Streamer? Matcht auf gameid + lobbysteamid in den Player-
        Summaries. Voraussetzung: Friend-Liste public und Friends
        haben 'Game Details' auf Public.

        Antwort: { active, gameId, gameName, lobbySteamId, friends:[…] }
        """
        try:
            me = self._cached("summary", self.client.get_player_summaries)
        except SteamApiError as e:
            return _err(502, str(e))
        my_game = me.get("gameid")
        my_lobby = me.get("lobbysteamid")
        my_game = str(my_game) if my_game else None
        my_lobby = str(my_lobby) if my_lobby else None

        # Test-Override aus query: erlaubt Diagnose-Calls.
        fake_lobby = qs.get("fakeLobbyId")
        fake_game  = qs.get("fakeAppId")
        if fake_lobby: my_lobby = fake_lobby
        if fake_game:  my_game  = fake_game

        # Optional: erwartete Squad-Groesse (PUBG: 4 fuer Squad, 2 fuer
        # Duo, 1 fuer Solo). Wenn gesetzt, berechnen wir wie viele
        # 'andere' (= nicht auf Steam-Friend-Liste) im Team sind.
        try:
            expected_size = int(qs.get("expectedSize", "0"))
        except ValueError:
            expected_size = 0

        if not my_game and not my_lobby:
            return _ok({"active": False, "friends": [], "count": 0,
                        "othersCount": 0})

        friend_ids = self._get_friend_ids()
        if not friend_ids:
            others = max(0, expected_size - 1) if expected_size else 0
            return _ok({"active": True, "gameId": my_game,
                        "lobbySteamId": my_lobby, "friends": [],
                        "count": 0, "othersCount": others,
                        "expectedSize": expected_size or None,
                        "note": "friend list private or empty"})

        # GetPlayerSummaries akzeptiert bis 100 SteamIDs pro Call.
        # Batch wenn noetig.
        matches = []
        for i in range(0, len(friend_ids), 100):
            batch = friend_ids[i:i+100]
            try:
                players = self.client.get_player_summaries_batch(batch)
            except SteamApiError:
                continue
            for p in players:
                f_lobby = p.get("lobbysteamid")
                f_game  = p.get("gameid")
                f_lobby = str(f_lobby) if f_lobby else None
                f_game  = str(f_game)  if f_game  else None
                # Match: gleiche Lobby ODER gleiches Game.
                # Lobby-Match ist starker Indikator (sicher zusammen),
                # Game-Match nur Indikator (selbes Spiel, evtl. anderes Match).
                same_lobby = bool(my_lobby and f_lobby == my_lobby)
                same_game  = bool(my_game  and f_game  == my_game)
                if not (same_lobby or same_game):
                    continue
                matches.append({
                    "steamId":     p.get("steamid"),
                    "personaName": p.get("personaname"),
                    "avatar":      p.get("avatarfull"),
                    "profileUrl":  p.get("profileurl"),
                    "gameId":      f_game,
                    "gameName":    p.get("gameextrainfo"),
                    "lobbySteamId": f_lobby,
                    "sameLobby":   same_lobby,
                    "sameGame":    same_game,
                })
        # Lobby-Matches zuerst, dann gleiche-Game-Matches
        matches.sort(key=lambda m: (not m["sameLobby"], m["personaName"] or ""))

        # Andere im Team die nicht in der Steam-Friend-Liste sind:
        # Squad-Size minus (Streamer + erkannte Steam-Friends-in-Lobby).
        # Nur sameLobby-Matches zaehlen — Game-only sind woanders.
        in_my_lobby_count = sum(1 for m in matches if m["sameLobby"])
        others = 0
        if expected_size:
            others = max(0, expected_size - 1 - in_my_lobby_count)

        return _ok({
            "active":       bool(my_game),
            "gameId":       my_game,
            "gameName":     me.get("gameextrainfo"),
            "lobbySteamId": my_lobby,
            "friends":      matches,
            "count":        len(matches),
            "othersCount":  others,
            "expectedSize": expected_size or None,
        })

    # ── Friends-Status (alle Freunde + Online/Game/Lobby) ─────────────────
    def _friends_status(self, qs):
        """Liefert die komplette Friend-Liste mit Online-State, was sie
        gerade spielen und Lobby-IDs. Funktioniert unabhaengig davon
        ob der Streamer selber online ist.

        Query:
          ?filter=all|online|ingame    Default: all
          ?sort=name|state|game        Default: state (in-game zuerst)
          ?limit=N                     Default: keine Begrenzung

        personaState-Codes (von Steam):
          0 = Offline, 1 = Online, 2 = Busy, 3 = Away, 4 = Snooze,
          5 = Looking to trade, 6 = Looking to play
        """
        filt = qs.get("filter", "all").lower()
        sort_by = qs.get("sort", "state").lower()
        try:
            limit = int(qs.get("limit", "0")) or None
        except ValueError:
            limit = None

        friend_ids = self._get_friend_ids()
        if not friend_ids:
            return _ok({"friends": [], "count": 0,
                        "note": "friend list private or empty"})

        # Auch meine eigene Lobby-ID mitziehen, damit wir je Friend
        # entscheiden koennen ob er in MEINER Lobby ist.
        try:
            me = self._cached("summary", self.client.get_player_summaries)
        except SteamApiError:
            me = {}
        my_lobby = str(me.get("lobbysteamid")) if me.get("lobbysteamid") else None
        my_game  = str(me.get("gameid")) if me.get("gameid") else None

        friends = []
        for i in range(0, len(friend_ids), 100):
            batch = friend_ids[i:i+100]
            try:
                players = self.client.get_player_summaries_batch(batch)
            except SteamApiError:
                continue
            for p in players:
                f_lobby = str(p.get("lobbysteamid")) if p.get("lobbysteamid") else None
                f_game  = str(p.get("gameid")) if p.get("gameid") else None
                state   = p.get("personastate", 0)
                friends.append({
                    "steamId":      p.get("steamid"),
                    "personaName":  p.get("personaname"),
                    "avatar":       p.get("avatarfull"),
                    "profileUrl":   p.get("profileurl"),
                    "personaState": state,
                    "stateName":    self._persona_state_name(state),
                    "gameId":       f_game,
                    "gameName":     p.get("gameextrainfo"),
                    "lobbySteamId": f_lobby,
                    "inMyLobby":    bool(my_lobby and f_lobby == my_lobby),
                    "inMyGame":     bool(my_game  and f_game  == my_game),
                    "lastLogoff":   p.get("lastlogoff"),
                })

        # Filter anwenden
        if filt == "online":
            friends = [f for f in friends if f["personaState"] != 0]
        elif filt == "ingame":
            friends = [f for f in friends if f["gameId"]]

        # Sort
        if sort_by == "name":
            friends.sort(key=lambda f: (f["personaName"] or "").lower())
        elif sort_by == "game":
            friends.sort(key=lambda f: (
                not f["gameId"], (f["gameName"] or "").lower(),
                (f["personaName"] or "").lower()))
        else:  # state: in-game > online > away/busy > offline
            def _state_rank(f):
                if f["gameId"]:        return 0
                if f["personaState"] == 1: return 1   # Online
                if f["personaState"] in (3, 4, 5, 6): return 2  # Away/etc
                if f["personaState"] == 2: return 3   # Busy
                return 9  # Offline
            friends.sort(key=lambda f: (
                _state_rank(f), (f["personaName"] or "").lower()))

        if limit:
            friends = friends[:limit]

        return _ok({
            "friends":  friends,
            "count":    len(friends),
            "totalFriends": len(friend_ids),
            "myLobbySteamId": my_lobby,
            "myGameId": my_game,
            "filter":   filt,
            "sort":     sort_by,
        })

    @staticmethod
    def _persona_state_name(state):
        return {
            0: "offline", 1: "online", 2: "busy", 3: "away",
            4: "snooze", 5: "lookingToTrade", 6: "lookingToPlay",
        }.get(state, "unknown")

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
        Query:
          ?limit=N        Top-N neueste (Default 20, max 100)
          ?sinceDays=N    nur Unlocks juenger als N Tage (Default 0 = aus)
        """
        try:
            limit = max(1, min(100, int(qs.get("limit", "20"))))
        except ValueError:
            limit = 20
        try:
            since_days = max(0, int(qs.get("sinceDays", "0")))
        except ValueError:
            since_days = 0
        conn = self.db_connect()
        try:
            since_ts = (int(time.time()) - since_days * 86400) if since_days else None
            rows = get_achievement_feed(
                conn, HARDCODED_TENANT_ID, self.client.steam_id,
                limit, since_ts=since_ts)
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
                WHERE tenant_id=%s AND steam_id=%s AND app_id=%s
            """, (HARDCODED_TENANT_ID, self.client.steam_id,
                  app_id)).fetchone()
            result["dbStoredCount"] = row["n"]
            prog = conn.execute("""
                SELECT unlocked_count, last_checked FROM steam_app_progress
                WHERE tenant_id=%s AND steam_id=%s AND app_id=%s
            """, (HARDCODED_TENANT_ID, self.client.steam_id,
                  app_id)).fetchone()
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
                WHERE tenant_id=%s AND steam_id=%s
                  AND playtime_forever_min > 30
                ORDER BY playtime_forever_min DESC
                LIMIT %s
            """, (HARDCODED_TENANT_ID, self.client.steam_id,
                  limit)).fetchall()
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

    # ── Debug: Avatar-Frame / Profile-Items ────────────────────────────────
    def _debug_profile_items(self, qs):
        """Roh-Ausgabe beider Frame-API-Calls + die finalen URLs die
        _get_profile_items() zurueckgibt. Hilft beim Debuggen
        warum kein Frame/Animation angezeigt wird."""
        result = {}
        try:
            result["getAvatarFrame"] = self.client.get_avatar_frame()
        except SteamApiError as e:
            result["getAvatarFrame"] = {"error": str(e)}
        try:
            result["getProfileItemsEquipped"] = (
                self.client.get_profile_items_equipped())
        except SteamApiError as e:
            result["getProfileItemsEquipped"] = {"error": str(e)}
        # Cache leeren damit nochmal frisch gefetched wird
        self._profile_items = None
        self._profile_items_fetched_at = 0
        result["resolved"] = self._get_profile_items()
        return _ok(result)

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
                n = mark_all_displayed(conn, HARDCODED_TENANT_ID,
                                       self.client.steam_id)
            else:
                cur = conn.execute("""
                    UPDATE steam_achievements_seen
                    SET displayed_at = EXTRACT(EPOCH FROM now())::BIGINT
                    WHERE tenant_id=%s AND steam_id=%s
                      AND app_id=-1 AND displayed_at IS NULL
                """, (HARDCODED_TENANT_ID, self.client.steam_id))
                n = cur.rowcount
            return _ok({"marked": n})
        finally:
            conn.close()

    # ── Language Setting (persistent) ──────────────────────────────────────
    def _language_setting(self, qs):
        """GET ohne Param: returnt aktuell gesetzte Sprache.
        GET mit ?lang=X: setzt + persistiert die neue Sprache, gilt fuer
        ALLE Steam-API-Calls ab jetzt (auch fuer's now-playing-Polling
        und Layer-2-Achievement-Sync). Display-Names neuer Unlocks
        kommen ab sofort in dieser Sprache.
        Bestehende Achievements im DB-Cache bleiben in alter Sprache
        bis ein force-Sync laeuft (siehe sync-all-achievements?force=1).
        """
        new_lang = (qs.get("lang") or "").strip().lower()
        if new_lang:
            self.client.language = new_lang
            self._save_prefs(language=new_lang)
        return _ok({
            "language": self.client.language,
            "saved": bool(new_lang),
        })

    # ── Bulk-Sync: Achievements fuer ALLE owned games ──────────────────────
    def _sync_all_achievements(self, qs):
        """Hintergrund-Job: walkt durch alle Games in steam_owned_games und
        zieht pro Game GetPlayerAchievements + GetSchemaForGame +
        GetGlobalAchievementPercentages. Inserted neue Unlocks in
        steam_achievements_seen. Markiert sie als suppress_popup=1 by
        Default (silent Backfill) damit nicht 1000 Popups gleichzeitig
        kommen.

        Query:
          ?popup=1      neue Unlocks NICHT als displayed markieren —
                        Popup-Widget feuert sie alle nacheinander
                        (Vorsicht: bei riesigen Libraries Stundenlang)
          ?force=1      Schema/Global-Pct neu pullen auch wenn cached

        Antwort: { started, running, progress }
        Progress-Felder: total, done, skipped (no public stats),
                          errors, newUnlocks
        """
        if self._sync_thread and self._sync_thread.is_alive():
            return _ok({"running": True, "started": False,
                        "progress": self._sync_progress})

        suppress = qs.get("popup") != "1"
        force = qs.get("force") == "1"
        self._sync_progress = {
            "total": 0, "done": 0, "skipped": 0, "errors": 0,
            "newUnlocks": 0, "running": True,
            "startedAt": int(time.time()),
            "suppress": suppress,
        }

        def worker():
            try:
                # Owned-Games-Liste, sortiert nach Playtime (interessante
                # zuerst — wenn der User abbricht hat er die Wichtigen).
                conn = self.db_connect()
                try:
                    rows = conn.execute("""
                        SELECT app_id, name FROM steam_owned_games
                        WHERE tenant_id=%s AND steam_id=%s AND app_id >= 0
                        ORDER BY playtime_forever_min DESC
                    """, (HARDCODED_TENANT_ID,
                          self.client.steam_id)).fetchall()
                finally:
                    conn.close()
                self._sync_progress["total"] = len(rows)

                for r in rows:
                    app_id = r["app_id"]
                    self._sync_one_app(app_id, r["name"], suppress, force)
                    self._sync_progress["done"] += 1
                    # Steam-API-Politeness: ~10 calls/s (3 calls pro Game)
                    time.sleep(0.1)
            except Exception as e:
                self._sync_progress["lastError"] = (
                    f"{type(e).__name__}: {e}")
            finally:
                self._sync_progress["running"] = False
                self._sync_progress["finishedAt"] = int(time.time())

        self._sync_thread = threading.Thread(
            target=worker, name="SteamBulkSync", daemon=True)
        self._sync_thread.start()
        return _ok({"started": True, "running": True,
                    "progress": self._sync_progress})

    def _sync_one_app(self, app_id, game_name, suppress_popup, force):
        """Eine Game-App syncen: achievements + schema + global_pct."""
        try:
            stats = self.client.get_player_achievements(app_id)
        except SteamApiError:
            self._sync_progress["errors"] += 1
            return
        if not stats.get("success", True):
            self._sync_progress["skipped"] += 1
            return
        achievements = stats.get("achievements") or []
        if not achievements:
            self._sync_progress["skipped"] += 1
            return

        conn = self.db_connect()
        try:
            # Schema (display_name + icon)
            schema_lookup = {}
            existing = get_app_schema(conn, app_id)
            need_schema = force or not existing or not existing["schema_json"]
            if need_schema:
                try:
                    schema = self.client.get_schema_for_game(app_id)
                    schema_achs = schema.get("achievements") or []
                    schema_lookup = {
                        a.get("name"): {
                            "displayName": a.get("displayName"),
                            "description": a.get("description"),
                            "icon":        a.get("icon"),
                        }
                        for a in schema_achs if a.get("name")
                    }
                    schema_json_str = json.dumps(schema_lookup)
                    upsert_app_schema(
                        conn, app_id,
                        game_name=stats.get("gameName") or game_name,
                        achievement_count=len(schema_achs),
                        schema_json=schema_json_str)
                    # Dual-write in lang-Cache (Server-aktuelle Sprache)
                    cur_lang = (self.client.language or "english").lower()
                    lang_lookup = {
                        api: {"displayName": v.get("displayName"),
                              "description": v.get("description")}
                        for api, v in schema_lookup.items()
                    }
                    upsert_app_schema_lang(
                        conn, app_id, cur_lang, json.dumps(lang_lookup))
                except SteamApiError:
                    pass
            elif existing and existing["schema_json"]:
                try:
                    schema_lookup = json.loads(existing["schema_json"])
                except Exception:
                    pass

            # Global Pct
            _, gpct_cached_at = get_global_achievement_pct(conn, app_id)
            if force or not gpct_cached_at:
                try:
                    pct_map = self.client.get_global_achievement_percentages_for_app(app_id)
                    if pct_map:
                        upsert_global_achievement_pct(
                            conn, app_id, json.dumps(pct_map))
                except SteamApiError:
                    pass

            # Unlocks inserten
            now_ts = int(time.time())
            unlocked_count = 0
            new_unlocks = 0
            for ach in achievements:
                if not ach.get("achieved"):
                    continue
                unlocked_count += 1
                api = ach.get("apiname")
                if not api:
                    continue
                unlock_ts = ach.get("unlocktime") or 0
                if unlock_ts <= 0:
                    unlock_ts = now_ts
                meta = schema_lookup.get(api, {})
                inserted = insert_unlock_if_new(
                    conn, HARDCODED_TENANT_ID,
                    self.client.steam_id, app_id,
                    api, unlock_ts,
                    display_name=meta.get("displayName") or api,
                    description=meta.get("description"),
                    icon_url=meta.get("icon"),
                    suppress_popup=suppress_popup)
                if inserted:
                    new_unlocks += 1
            upsert_progress(conn, HARDCODED_TENANT_ID,
                            self.client.steam_id, app_id, unlocked_count)
            self._sync_progress["newUnlocks"] += new_unlocks
        finally:
            conn.close()

    # ── Achievements-List (fuer Browser-Widget) ────────────────────────────
    def _achievements_list(self, qs):
        """Liste aller in DB gespeicherten Achievements mit Metadaten —
        Game-Name, Display-Name, Icon, Global-Pct, Unlock-Zeit. Fuer's
        Browser-Widget wo man pro Game filtern und einzelne anklicken
        kann zum Re-Triggern.

        Query:
          ?appId=N   nur dieses Spiel
          ?limit=N   max Eintraege (default 500)
          ?lang=X    Sprache fuer displayName/description. Falls eine
                     andere als die ursprueglich gespeicherte: pro
                     unique app_id wird einmalig GetSchemaForGame in
                     dieser Sprache gefetched + gecached (kann beim
                     ersten Sprach-Wechsel ein paar Sekunden dauern).
        """
        try:
            limit = max(1, int(qs.get("limit", "500")))
        except ValueError:
            limit = 500
        try:
            app_id = int(qs.get("appId")) if qs.get("appId") else None
        except ValueError:
            app_id = None
        # Sprache: per-Request-Override oder aktuell gesetzte Server-Lang.
        # Wir uebersetzen IMMER ueber steam_app_schema_lang (lazy-fetch),
        # damit die Anzeige zur aktuellen Sprache passt — unabhaengig
        # davon was in steam_achievements_seen.display_name gespeichert
        # ist (stale-data-Schutz nach Sprach-Wechsel).
        lang = (qs.get("lang") or self.client.language or "").lower()
        translate = bool(lang)

        conn = self.db_connect()
        try:
            sql = """
                SELECT s.app_id, s.achievement_api_name, s.unlocked_at,
                       s.display_name, s.description, s.icon_url,
                       s.displayed_at,
                       sch.game_name, sch.global_pct_json
                FROM steam_achievements_seen s
                LEFT JOIN steam_app_schema sch ON sch.app_id = s.app_id
                WHERE s.tenant_id = %s AND s.steam_id = %s
                  AND s.app_id >= 0
            """
            params = [HARDCODED_TENANT_ID, self.client.steam_id]
            if app_id is not None:
                sql += " AND s.app_id = %s"
                params.append(app_id)
            sql += (" ORDER BY LOWER(sch.game_name) ASC, "
                    "s.unlocked_at DESC LIMIT %s")
            params.append(limit)
            rows = conn.execute(sql, params).fetchall()

            # Wenn andere Sprache angefordert: fuer alle unique app_ids
            # das Schema in dieser Sprache fetchen wenn nicht cached.
            lang_lookups = {}  # app_id -> {api_name: {displayName, description}}
            if translate:
                unique_apps = set(r["app_id"] for r in rows)
                for ap in unique_apps:
                    cached = get_app_schema_lang(conn, ap, lang)
                    if cached and cached["schema_json"]:
                        try:
                            lang_lookups[ap] = json.loads(cached["schema_json"])
                            continue
                        except json.JSONDecodeError:
                            pass
                    # Frisch holen
                    try:
                        schema = self.client.get_schema_for_game(
                            ap, language=lang)
                        schema_achs = schema.get("achievements") or []
                        lookup = {
                            a.get("name"): {
                                "displayName": a.get("displayName"),
                                "description": a.get("description"),
                            }
                            for a in schema_achs if a.get("name")
                        }
                        upsert_app_schema_lang(
                            conn, ap, lang, json.dumps(lookup))
                        lang_lookups[ap] = lookup
                    except SteamApiError:
                        # Cache leere Antwort, damit kein Retry-Spam
                        upsert_app_schema_lang(conn, ap, lang, "{}")
                        lang_lookups[ap] = {}
                    time.sleep(0.05)  # Politness

            # Game-Namen + Counts fuer den Filter-Dropdown
            games = {}
            items = []
            for r in rows:
                ap = r["app_id"]
                gname = r["game_name"] or ("App #" + str(ap))
                games.setdefault(ap, {"appId": ap, "name": gname, "count": 0})
                games[ap]["count"] += 1

                pct = None
                if r["global_pct_json"]:
                    try:
                        pct_map = json.loads(r["global_pct_json"])
                        raw = pct_map.get(r["achievement_api_name"])
                        pct = float(raw) if raw is not None else None
                    except (TypeError, ValueError, json.JSONDecodeError):
                        pass

                disp = r["display_name"]
                desc = r["description"]
                if translate:
                    meta = (lang_lookups.get(ap) or {}).get(
                        r["achievement_api_name"])
                    if meta:
                        disp = meta.get("displayName") or disp
                        desc = meta.get("description") or desc

                items.append({
                    "appId":       ap,
                    "gameName":    gname,
                    "apiName":     r["achievement_api_name"],
                    "displayName": disp,
                    "description": desc,
                    "iconUrl":     r["icon_url"],
                    "unlockedAt":  r["unlocked_at"],
                    "globalPct":   pct,
                    "displayed":   r["displayed_at"] is not None,
                })

            return _ok({
                "achievements": items,
                "games": sorted(games.values(),
                                 key=lambda g: g["name"].lower()),
                "count": len(items),
                "filter": {"appId": app_id, "limit": limit, "lang": lang or None},
                "translated": translate,
            })
        finally:
            conn.close()

    # ── Replay-Achievements (für Sound/Visual-Test) ────────────────────────
    def _replay_achievements(self, qs):
        """Macht bereits-angezeigte Achievements wieder undisplayed —
        damit das Popup-Widget sie nochmal feuert. Nuetzlich zum
        Sound-Test oder fuer Stream-Recap.

        Query-Params:
          ?appId=N       nur fuer dieses Spiel (sonst alle Spiele)
          ?apiName=NAME  nur dieser eine Eintrag (Click-To-Trigger im Browser)
          ?limit=N       max Anzahl Eintraege (default 20)
          ?onlyRare=1    nur Achievements mit globalPct <= rarePct (default 5)
        """
        try:
            limit = max(1, int(qs.get("limit", "20")))
        except ValueError:
            limit = 20
        try:
            app_id = int(qs.get("appId")) if qs.get("appId") else None
        except ValueError:
            app_id = None
        api_name_filter = qs.get("apiName") or None
        only_rare = qs.get("onlyRare") == "1"
        try:
            rare_pct = float(qs.get("rarePct", "10"))
        except ValueError:
            rare_pct = 5.0

        conn = self.db_connect()
        try:
            # Achievements der letzten Unlocks holen (neueste zuerst).
            sql = """
                SELECT s.app_id, s.achievement_api_name
                FROM steam_achievements_seen s
                WHERE s.tenant_id = %s
                  AND s.steam_id = %s
                  AND s.app_id >= 0
            """
            params = [HARDCODED_TENANT_ID, self.client.steam_id]
            if app_id is not None:
                sql += " AND s.app_id = %s"
                params.append(app_id)
            if api_name_filter:
                sql += " AND s.achievement_api_name = %s"
                params.append(api_name_filter)
            sql += " ORDER BY s.unlocked_at DESC LIMIT %s"
            params.append(limit * 3 if only_rare else limit)
            rows = conn.execute(sql, params).fetchall()

            keys = []
            for r in rows:
                if only_rare:
                    schema = get_app_schema(conn, r["app_id"])
                    if not schema or not schema["global_pct_json"]:
                        continue
                    try:
                        pct_map = json.loads(schema["global_pct_json"])
                        raw = pct_map.get(r["achievement_api_name"])
                        pct = float(raw) if raw is not None else None
                    except (TypeError, ValueError, json.JSONDecodeError):
                        pct = None
                    if pct is None or pct > rare_pct:
                        continue
                keys.append((r["app_id"], r["achievement_api_name"]))
                if len(keys) >= limit:
                    break

            n = 0
            for ap, api in keys:
                cur = conn.execute("""
                    UPDATE steam_achievements_seen
                    SET displayed_at = NULL
                    WHERE tenant_id=%s AND steam_id=%s
                      AND app_id=%s AND achievement_api_name=%s
                """, (HARDCODED_TENANT_ID, self.client.steam_id, ap, api))
                n += cur.rowcount
            return _ok({
                "reset": n,
                "appId": app_id,
                "limit": limit,
                "onlyRare": only_rare,
            })
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
                conn, HARDCODED_TENANT_ID,
                self.client.steam_id, -1, api_name,
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
