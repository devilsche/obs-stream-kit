"""
Steam-Poller (Hintergrund-Thread).

Layer 1 (alle 10s):
  GetPlayerSummaries → was läuft grad (gameid)
  Plus: GetOwnedGames 1× pro Stunde sync (für Playtime-Cache)

Layer 2 (alle 5s, nur wenn Spiel läuft):
  GetPlayerAchievements für aktuelles Spiel
  Diff mit DB → neue Unlocks → INSERT
  Schema fetchen wenn fehlt (für display_name + icon)
  Plus: GetSchemaForGame zur Display-Name/Icon-Auflösung
"""
import json
import threading
import time

from steam.api_client import SteamApiError
from steam.db import (
    insert_unlock_if_new, upsert_owned_games, upsert_app_schema,
    get_app_schema, upsert_progress,
    find_app_needing_details_sync, upsert_app_details,
    mark_played_now,
    upsert_global_achievement_pct, get_global_achievement_pct,
    COOP_CATEGORY_IDS, MULTIPLAYER_CATEGORY_IDS,
)
from steam.image_cache import ensure_app_images


LAYER1_INTERVAL_S = 10
LAYER2_INTERVAL_S = 5
LAYER3_INTERVAL_S = 12              # Storefront-Sync (1 app pro Tick)
OWNED_GAMES_REFRESH_S = 3600        # 1× / Stunde
SCHEMA_REFRESH_S = 7 * 86400        # 1× / Woche pro App
GLOBAL_PCT_REFRESH_S = 86400        # 1× / Tag pro App
APP_DETAILS_REFRESH_S = 30 * 86400  # 1× / 30 Tage pro App


class SteamPoller(threading.Thread):
    daemon = True

    def __init__(self, client, db_connect_fn, root_dir: str = None):
        super().__init__(name="SteamPoller")
        self.client = client
        self.db_connect = db_connect_fn  # returns fresh sqlite3.Connection
        self.root_dir = root_dir  # für lokalen Image-Cache
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._state = {
            "currentAppId": None,
            "currentGameName": None,
            "lastLayer1At": None,
            "lastLayer2At": None,
            "lastOwnedSyncAt": 0,
            "lastError": None,
            "newUnlocksTotal": 0,
        }

    def stop(self):
        self._stop.set()

    def status(self) -> dict:
        with self._lock:
            return dict(self._state)

    # ── Main Loop ────────────────────────────────────────────────────────────
    def run(self):
        last_layer1 = 0.0
        last_layer2 = 0.0
        last_layer3 = 0.0
        while not self._stop.is_set():
            now = time.monotonic()
            try:
                if now - last_layer1 >= LAYER1_INTERVAL_S:
                    self._tick_layer1()
                    last_layer1 = now
                if (self._state["currentAppId"]
                        and now - last_layer2 >= LAYER2_INTERVAL_S):
                    self._tick_layer2()
                    last_layer2 = now
                if now - last_layer3 >= LAYER3_INTERVAL_S:
                    self._tick_app_details_sync()
                    last_layer3 = now
            except Exception as e:
                with self._lock:
                    self._state["lastError"] = f"{type(e).__name__}: {e}"
            self._stop.wait(1.0)

    # ── Layer 1: Now-Playing + Owned Games refresh ──────────────────────────
    def _tick_layer1(self):
        try:
            summary = self.client.get_player_summaries()
        except SteamApiError as e:
            with self._lock:
                self._state["lastError"] = str(e)
            return
        gameid_raw = summary.get("gameid")
        try:
            app_id = int(gameid_raw) if gameid_raw else None
        except ValueError:
            app_id = None
        with self._lock:
            self._state["currentAppId"] = app_id
            self._state["currentGameName"] = summary.get("gameextrainfo")
            self._state["lastLayer1At"] = int(time.time())
            self._state["lastError"] = None

        # last_played_at fuer das aktive Spiel auf 'jetzt' setzen —
        # damit sort=recent zuverlaessig auch dann funktioniert wenn
        # Steam selbst keine playtime_2weeks-Daten liefert.
        if app_id:
            try:
                conn = self.db_connect()
                try:
                    mark_played_now(conn, self.client.steam_id, app_id)
                finally:
                    conn.close()
            except Exception:
                pass

        # Owned-Games-Sync: 1× / Stunde — auch wenn kein Spiel läuft
        ts = int(time.time())
        if ts - self._state.get("lastOwnedSyncAt", 0) > OWNED_GAMES_REFRESH_S:
            try:
                games = self.client.get_owned_games()
                if games:
                    conn = self.db_connect()
                    try:
                        upsert_owned_games(conn, self.client.steam_id, games)
                    finally:
                        conn.close()
                    # Pro Owned-Games-Sync: max ~10 Bilder cachen, damit
                    # die ersten Library-Pages sofort lokal verfuegbar
                    # sind. Restliche Bilder werden vom Layer-3-Sync
                    # nach und nach gezogen.
                    if self.root_dir:
                        self._cache_top_logos(games[:20])
                with self._lock:
                    self._state["lastOwnedSyncAt"] = ts
            except SteamApiError as e:
                with self._lock:
                    self._state["lastError"] = f"owned-games sync: {e}"

    def _cache_top_logos(self, games: list) -> None:
        """Lädt header + logo + icon der ersten N Games auf Platte.
        header.jpg kommt vom Steam-Store-CDN (gleiches Bild wie in der
        Library) und ist OHNE Storefront-API-Sync verfügbar. Best-
        effort, Fehler werden geschluckt."""
        community = ("https://media.steampowered.com/steamcommunity"
                     "/public/images/apps")
        store_cdn = "https://cdn.cloudflare.steamstatic.com/steam/apps"
        for g in games:
            appid = g.get("appid")
            if not appid:
                continue
            icon_hash = g.get("img_icon_url")
            logo_hash = g.get("img_logo_url")
            try:
                ensure_app_images(
                    self.root_dir, appid,
                    header_url=f"{store_cdn}/{appid}/header.jpg",
                    logo_url=(f"{community}/{appid}/{logo_hash}.jpg"
                              if logo_hash else None),
                    icon_url=(f"{community}/{appid}/{icon_hash}.jpg"
                              if icon_hash else None))
            except Exception:
                pass

    # ── Layer 2: Achievements für aktuelles Spiel ───────────────────────────
    def _tick_layer2(self):
        app_id = self._state.get("currentAppId")
        if not app_id:
            return
        try:
            stats = self.client.get_player_achievements(app_id)
        except SteamApiError as e:
            with self._lock:
                self._state["lastError"] = f"achievements: {e}"
            return
        if not stats.get("success", True):
            return
        achievements = stats.get("achievements") or []

        conn = self.db_connect()
        try:
            # Schema für display_name/icon nachladen, falls nicht da
            schema_lookup = self._ensure_schema(conn, app_id, stats.get("gameName"))
            # Global-Achievement-Pct fuer Rare-Highlight im Popup (1×/Tag)
            self._ensure_global_pct(conn, app_id)

            unlocked_count = 0
            new_unlocks = 0
            for ach in achievements:
                if ach.get("achieved"):
                    unlocked_count += 1
                    api = ach.get("apiname")
                    unlock_ts = ach.get("unlocktime") or 0
                    if not api or unlock_ts <= 0:
                        continue
                    meta = schema_lookup.get(api, {})
                    inserted = insert_unlock_if_new(
                        conn, self.client.steam_id, app_id,
                        api, unlock_ts,
                        display_name=meta.get("displayName") or api,
                        description=meta.get("description"),
                        icon_url=meta.get("icon"))
                    if inserted:
                        new_unlocks += 1

            upsert_progress(conn, self.client.steam_id, app_id, unlocked_count)
            with self._lock:
                self._state["lastLayer2At"] = int(time.time())
                self._state["newUnlocksTotal"] += new_unlocks
        finally:
            conn.close()

    # ── Layer 3: App-Details Storefront-Sync (rate-limited) ────────────────
    def _tick_app_details_sync(self):
        """Holt fuer ein einzelnes Game der Library die Storefront-Details
        (Categories, Header-Image). Pro Tick max 1 Spiel — Rate-Limit-
        sicher (~5 Calls/Min bei LAYER3_INTERVAL_S=12)."""
        conn = self.db_connect()
        try:
            app_id = find_app_needing_details_sync(
                conn, self.client.steam_id, APP_DETAILS_REFRESH_S)
            if not app_id:
                return  # Library komplett gecached
        finally:
            conn.close()

        try:
            data = self.client.get_app_details(app_id)
        except SteamApiError as e:
            with self._lock:
                self._state["lastError"] = f"app-details {app_id}: {e}"
            # Trotzdem markieren um keine Endlos-Retry-Schleife zu haben
            data = {}

        categories = data.get("categories") or []
        category_ids = [c.get("id") for c in categories if c.get("id") is not None]
        cat_set = set(category_ids)
        genres = data.get("genres") or []
        genre_names = [g.get("description") for g in genres if g.get("description")]

        conn = self.db_connect()
        try:
            upsert_app_details(
                conn, app_id,
                header_image=data.get("header_image"),
                short_description=data.get("short_description"),
                is_coop=bool(cat_set & COOP_CATEGORY_IDS),
                is_multiplayer=bool(cat_set & MULTIPLAYER_CATEGORY_IDS),
                category_ids=",".join(str(c) for c in category_ids),
                genre_names=",".join(genre_names),
            )
        finally:
            conn.close()

        # Header-Image lokal cachen sobald Storefront-URL bekannt
        if self.root_dir and data.get("header_image"):
            try:
                ensure_app_images(self.root_dir, app_id,
                                   header_url=data["header_image"])
            except Exception:
                pass

    def _ensure_global_pct(self, conn, app_id: int) -> None:
        """Holt einmal pro Tag die globalen Unlock-Prozent. Best-effort —
        Fehler werden geschluckt (kein API-Key noetig, Endpoint ist
        oeffentlich aber kann auch leer sein)."""
        _, cached_at = get_global_achievement_pct(conn, app_id)
        ts = int(time.time())
        if cached_at and ts - cached_at < GLOBAL_PCT_REFRESH_S:
            return
        try:
            pct_map = self.client.get_global_achievement_percentages_for_app(app_id)
        except SteamApiError:
            return
        if not pct_map:
            return
        upsert_global_achievement_pct(conn, app_id, json.dumps(pct_map))

    def _ensure_schema(self, conn, app_id, game_name_hint=None) -> dict:
        """Liefert {api_name: {displayName, description, icon}} fuer das App.
        Cache 1 Woche. Gibt {} zurueck wenn Schema nicht abrufbar."""
        existing = get_app_schema(conn, app_id)
        ts = int(time.time())
        needs_refresh = (not existing
                         or ts - existing["cached_at"] > SCHEMA_REFRESH_S)
        if not needs_refresh:
            try:
                return json.loads(existing["schema_json"] or "{}")
            except Exception:
                pass

        try:
            stats = self.client.get_schema_for_game(app_id)
        except SteamApiError:
            return {}
        achs = stats.get("achievements") or []
        lookup = {}
        for a in achs:
            lookup[a.get("name")] = {
                "displayName": a.get("displayName"),
                "description": a.get("description"),
                "icon":        a.get("icon"),
            }
        upsert_app_schema(conn, app_id,
                          game_name=game_name_hint,
                          achievement_count=len(achs),
                          schema_json=json.dumps(lookup))
        return lookup
