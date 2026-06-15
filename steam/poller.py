"""
Steam-Poller — tenant-aware.

Iteriert alle Tenants aus der Postgres-DB, laedt pro Tenant Credentials
aus dem Vault (core.credentials) und pollt die Steam-Web-API mit dem
tenant-eigenen API-Key + Steam-ID.

Pro Tenant:
  Layer 1 (alle 10s):
    GetPlayerSummaries → was läuft grad (gameid)
    Plus: GetOwnedGames 1× pro Stunde sync (für Playtime-Cache)
  Layer 2 (alle 5s, nur wenn Spiel läuft):
    GetPlayerAchievements für aktuelles Spiel
    Diff mit DB → neue Unlocks → INSERT
  Layer 3 (alle 12s):
    Storefront-Sync 1 Game pro Tick (Rate-Limit-sicher)
"""
import json
import threading
import time

from core import db as core_db, credentials
from core.db_compat import SqliteCompatConn
from steam.api_client import SteamApiError
from steam.db_pg import (
    insert_unlock_if_new, upsert_owned_games, upsert_app_schema,
    get_app_schema, upsert_progress,
    find_app_needing_details_sync, upsert_app_details,
    find_app_needing_backfill, find_app_needing_unlock_check,
    mark_played_now,
    upsert_global_achievement_pct, get_global_achievement_pct,
    upsert_app_schema_lang,
    COOP_CATEGORY_IDS, MULTIPLAYER_CATEGORY_IDS,
)
from steam.image_cache import ensure_app_images


LAYER1_INTERVAL_S = 10
LAYER2_INTERVAL_S = 5
LAYER3_INTERVAL_S = 12              # Storefront-Sync (1 app pro Tick)
LAYER4_INTERVAL_S = 30              # Achievement-Backfill (1 app pro Tick)
OWNED_GAMES_REFRESH_S = 3600        # 1× / Stunde
SCHEMA_REFRESH_S = 7 * 86400        # 1× / Woche pro App
GLOBAL_PCT_REFRESH_S = 86400        # 1× / Tag pro App
APP_DETAILS_REFRESH_S = 30 * 86400  # 1× / 30 Tage pro App


def _list_tenant_ids(conn) -> list:
    raw = conn.raw if isinstance(conn, SqliteCompatConn) else conn
    with raw.cursor() as cur:
        cur.execute("SELECT id FROM tenants ORDER BY id")
        return [r["id"] for r in cur.fetchall()]


class SteamPoller(threading.Thread):
    """Background-Thread, iteriert alle Tenants und pollt ihre Steam-API.

    `client_factory(api_key, steam_id, language)` baut den SteamClient —
    so muss der Caller (serve.py) nichts ueber die Client-Implementierung
    wissen, und Tests koennen einen Stub injizieren.

    Pro-Tenant-State (currentAppId etc.) wird in self._state[tenant_id]
    gehalten. status() liefert per default den Owner-Tenant (id=1) zurueck
    fuer Backward-Compat mit dem bisherigen Single-Tenant-Widget-Code.
    """
    daemon = True

    def __init__(self, client_factory, root_dir: str = None,
                 default_language: str = "english"):
        super().__init__(name="SteamPoller")
        self.client_factory = client_factory
        self.root_dir = root_dir
        self.default_language = default_language
        self._stop = threading.Event()
        self._lock = threading.Lock()
        # state[tenant_id] = {"currentAppId": ..., "lastLayer1At": ..., ...}
        self._state = {}
        # last_*_at[tenant_id] = monotonic timestamp
        self._last_layer1 = {}
        self._last_layer2 = {}
        self._last_layer3 = {}
        self._last_layer4 = {}

    def stop(self):
        self._stop.set()

    def _ensure_state(self, tenant_id: int) -> dict:
        with self._lock:
            if tenant_id not in self._state:
                self._state[tenant_id] = {
                    "currentAppId": None,
                    "currentGameName": None,
                    "lastLayer1At": None,
                    "lastLayer2At": None,
                    "lastOwnedSyncAt": 0,
                    "lastError": None,
                    "newUnlocksTotal": 0,
                }
            return self._state[tenant_id]

    def status(self, tenant_id: int = 1) -> dict:
        """Liefert Poller-State fuer einen Tenant. Default 1 = Owner —
        bestehende Widgets erwarten Single-Tenant-Shape."""
        with self._lock:
            return dict(self._state.get(tenant_id) or {})

    def status_all(self) -> dict:
        with self._lock:
            return {tid: dict(s) for tid, s in self._state.items()}

    # ── Main Loop ────────────────────────────────────────────────────────────
    def run(self):
        while not self._stop.is_set():
            try:
                pg_conn = core_db.connect()
            except Exception as e:
                print(f"[steam-poller] db-connect failed: {e}", flush=True)
                self._stop.wait(5.0)
                continue
            try:
                tenant_ids = _list_tenant_ids(pg_conn)
            except Exception as e:
                print(f"[steam-poller] list-tenants failed: {e}", flush=True)
                pg_conn.close()
                self._stop.wait(5.0)
                continue
            finally:
                pass
            try:
                now = time.monotonic()
                for tid in tenant_ids:
                    if self._stop.is_set():
                        break
                    try:
                        self._tick_tenant(pg_conn, tid, now)
                    except Exception as e:
                        with self._lock:
                            st = self._ensure_state(tid)
                            st["lastError"] = f"{type(e).__name__}: {e}"
                        print(f"[steam-poller] tenant {tid}: {e}", flush=True)
            finally:
                pg_conn.close()
            self._stop.wait(1.0)

    def _tick_tenant(self, pg_conn, tenant_id: int, now: float):
        try:
            creds = credentials.get(pg_conn, tenant_id)
        except LookupError:
            return
        if not creds.steam_api_key or not creds.steam_id:
            return
        client = self.client_factory(
            creds.steam_api_key, creds.steam_id, self.default_language)

        last1 = self._last_layer1.get(tenant_id, 0.0)
        last2 = self._last_layer2.get(tenant_id, 0.0)
        last3 = self._last_layer3.get(tenant_id, 0.0)
        last4 = self._last_layer4.get(tenant_id, 0.0)
        state = self._ensure_state(tenant_id)

        if now - last1 >= LAYER1_INTERVAL_S:
            self._tick_layer1(pg_conn, tenant_id, client, state)
            self._last_layer1[tenant_id] = now
        if (state.get("currentAppId")
                and now - last2 >= LAYER2_INTERVAL_S):
            self._tick_layer2(pg_conn, tenant_id, client, state)
            self._last_layer2[tenant_id] = now
        if now - last3 >= LAYER3_INTERVAL_S:
            self._tick_app_details_sync(pg_conn, tenant_id, client, state)
            self._last_layer3[tenant_id] = now
        if now - last4 >= LAYER4_INTERVAL_S:
            self._tick_backfill(pg_conn, tenant_id, client, state)
            self._last_layer4[tenant_id] = now

    # ── Layer 1: Now-Playing + Owned Games refresh ──────────────────────────
    def _tick_layer1(self, conn, tenant_id, client, state):
        try:
            summary = client.get_player_summaries()
        except SteamApiError as e:
            with self._lock:
                state["lastError"] = str(e)
            return
        gameid_raw = summary.get("gameid")
        try:
            app_id = int(gameid_raw) if gameid_raw else None
        except ValueError:
            app_id = None
        with self._lock:
            state["currentAppId"] = app_id
            state["currentGameName"] = summary.get("gameextrainfo")
            state["lastLayer1At"] = int(time.time())
            state["lastError"] = None

        if app_id:
            try:
                mark_played_now(conn, tenant_id, client.steam_id, app_id)
            except Exception:
                pass

        # Owned-Games-Sync: 1× / Stunde
        ts = int(time.time())
        if ts - state.get("lastOwnedSyncAt", 0) > OWNED_GAMES_REFRESH_S:
            try:
                games = client.get_owned_games()
                if games:
                    upsert_owned_games(conn, tenant_id,
                                        client.steam_id, games)
                    if self.root_dir:
                        self._cache_top_logos(games[:20])
                with self._lock:
                    state["lastOwnedSyncAt"] = ts
            except SteamApiError as e:
                with self._lock:
                    state["lastError"] = f"owned-games sync: {e}"

    def _cache_top_logos(self, games: list) -> None:
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
    def _tick_layer2(self, conn, tenant_id, client, state):
        app_id = state.get("currentAppId")
        if not app_id:
            return
        try:
            stats = client.get_player_achievements(app_id)
        except SteamApiError as e:
            with self._lock:
                state["lastError"] = f"achievements: {e}"
            return
        if not stats.get("success", True):
            return
        achievements = stats.get("achievements") or []

        schema_lookup = self._ensure_schema(
            conn, client, app_id, stats.get("gameName"))
        self._ensure_global_pct(conn, client, app_id)

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
                conn, tenant_id, client.steam_id, app_id,
                api, unlock_ts,
                display_name=meta.get("displayName") or api,
                description=meta.get("description"),
                icon_url=meta.get("icon"))
            if inserted:
                new_unlocks += 1

        upsert_progress(conn, tenant_id, client.steam_id, app_id,
                        unlocked_count)
        with self._lock:
            state["lastLayer2At"] = int(time.time())
            state["newUnlocksTotal"] += new_unlocks

    # ── Layer 3: App-Details Storefront-Sync ────────────────────────────────
    def _tick_app_details_sync(self, conn, tenant_id, client, state):
        app_id = find_app_needing_details_sync(
            conn, tenant_id, client.steam_id, APP_DETAILS_REFRESH_S)
        if not app_id:
            return

        try:
            data = client.get_app_details(app_id)
        except SteamApiError as e:
            with self._lock:
                state["lastError"] = f"app-details {app_id}: {e}"
            data = {}

        categories = data.get("categories") or []
        category_ids = [c.get("id") for c in categories
                         if c.get("id") is not None]
        cat_set = set(category_ids)
        genres = data.get("genres") or []
        genre_names = [g.get("description") for g in genres
                        if g.get("description")]

        # Game-Media (Trailer/Screenshots) fuer das Highlight-Media-Feature.
        # Separater Storefront-Call; bei Fehler einfach ohne Media speichern.
        media_json = None
        try:
            media = client.get_app_media(app_id)
            if media.get("trailers") or media.get("screenshots"):
                media_json = json.dumps(media)
        except SteamApiError as e:
            with self._lock:
                state["lastError"] = f"app-media {app_id}: {e}"

        upsert_app_details(
            conn, app_id,
            header_image=data.get("header_image"),
            short_description=data.get("short_description"),
            is_coop=bool(cat_set & COOP_CATEGORY_IDS),
            is_multiplayer=bool(cat_set & MULTIPLAYER_CATEGORY_IDS),
            category_ids=",".join(str(c) for c in category_ids),
            genre_names=",".join(genre_names),
            media_json=media_json,
        )

        if self.root_dir and data.get("header_image"):
            try:
                ensure_app_images(self.root_dir, app_id,
                                   header_url=data["header_image"])
            except Exception:
                pass

    # ── Layer 4: Achievement-Backfill (Library aufholen) ────────────────────
    def _tick_backfill(self, conn, tenant_id, client, state):
        """Holt eine App pro Tick auf — entweder fehlendes Schema oder
        fehlende Unlock-Pruefung. Sortiert nach Playtime, damit relevante
        Spiele zuerst auftauchen. Liefert (status, app_id) fuer den CLI-
        Caller; bei Hintergrund-Use wird Return ignoriert."""
        return run_backfill_step(conn, tenant_id, client,
                                 ensure_schema_fn=self._ensure_schema,
                                 ensure_global_pct_fn=self._ensure_global_pct,
                                 state=state, lock=self._lock)

    def _ensure_global_pct(self, conn, client, app_id: int) -> None:
        _, cached_at = get_global_achievement_pct(conn, app_id)
        ts = int(time.time())
        if cached_at and ts - cached_at < GLOBAL_PCT_REFRESH_S:
            return
        try:
            pct_map = client.get_global_achievement_percentages_for_app(app_id)
        except SteamApiError:
            return
        if not pct_map:
            return
        upsert_global_achievement_pct(conn, app_id, json.dumps(pct_map))

    def _ensure_schema(self, conn, client, app_id, game_name_hint=None) -> dict:
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
            stats = client.get_schema_for_game(app_id)
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
        schema_json_str = json.dumps(lookup)
        upsert_app_schema(conn, app_id,
                          game_name=game_name_hint,
                          achievement_count=len(achs),
                          schema_json=schema_json_str)
        lang = (client.language or "english").lower()
        lang_lookup = {
            api: {"displayName": v.get("displayName"),
                  "description": v.get("description")}
            for api, v in lookup.items()
        }
        upsert_app_schema_lang(conn, app_id, lang, json.dumps(lang_lookup))
        return lookup


def run_backfill_step(conn, tenant_id: int, client,
                       ensure_schema_fn, ensure_global_pct_fn,
                       state: dict = None, lock=None):
    """Eine Backfill-Iteration: schaut ob ein Spiel ohne Schema existiert
    → Schema + Global-Pct fetchen. Sonst: ein Spiel ohne Unlock-Check
    → Achievements + Progress fetchen. Liefert ("schema", app_id),
    ("unlocks", app_id, new_unlocks) oder ("done", None).
    """
    app_id = find_app_needing_backfill(conn, tenant_id, client.steam_id)
    if app_id:
        try:
            ensure_schema_fn(conn, client, app_id)
            ensure_global_pct_fn(conn, client, app_id)
        except SteamApiError as e:
            if state is not None and lock is not None:
                with lock:
                    state["lastError"] = f"backfill schema {app_id}: {e}"
            # Trotzdem leeres Schema cachen damit die App nicht endlos
            # wieder vorne in der Queue auftaucht.
            try:
                upsert_app_schema(conn, app_id, game_name=None,
                                   achievement_count=0, schema_json="{}")
            except Exception:
                pass
            return ("error", app_id)
        return ("schema", app_id)

    app_id = find_app_needing_unlock_check(conn, tenant_id, client.steam_id)
    if app_id:
        try:
            stats = client.get_player_achievements(app_id)
        except SteamApiError as e:
            if state is not None and lock is not None:
                with lock:
                    state["lastError"] = f"backfill unlocks {app_id}: {e}"
            # Leeres Progress-Row damit App nicht wieder gepickt wird —
            # bei naechster Live-Session wird sie via Layer 2 ohnehin
            # frisch geprueft.
            try:
                upsert_progress(conn, tenant_id, client.steam_id, app_id, 0)
            except Exception:
                pass
            return ("error", app_id)

        if not stats.get("success", True):
            upsert_progress(conn, tenant_id, client.steam_id, app_id, 0)
            return ("skip", app_id)

        achievements = stats.get("achievements") or []
        existing = get_app_schema(conn, app_id)
        try:
            schema_lookup = (json.loads(existing["schema_json"] or "{}")
                              if existing else {})
        except Exception:
            schema_lookup = {}

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
                conn, tenant_id, client.steam_id, app_id,
                api, unlock_ts,
                display_name=meta.get("displayName") or api,
                description=meta.get("description"),
                icon_url=meta.get("icon"))
            if inserted:
                new_unlocks += 1
        upsert_progress(conn, tenant_id, client.steam_id, app_id,
                        unlocked_count)
        if state is not None and lock is not None:
            with lock:
                state["newUnlocksTotal"] = (
                    state.get("newUnlocksTotal", 0) + new_unlocks)
        return ("unlocks", app_id, new_unlocks)

    return ("done", None)
