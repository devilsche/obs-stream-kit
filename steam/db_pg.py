"""PostgreSQL-Adapter fuer Steam-Daten. Analog zu pubg/db_pg.py.

Schema-Mapping SQLite -> Postgres:
  TEXT bleibt TEXT, INTEGER bleibt INTEGER, AUTOINCREMENT n/a (PK Composite).
  Per-tenant Tabellen kriegen tenant_id INT NOT NULL.

Global tables (kein tenant_id):
  - steam_app_schema
  - steam_app_schema_lang
  - steam_app_details

Per-tenant tables:
  - steam_achievements_seen
  - steam_app_progress
  - steam_owned_games
"""
from typing import Optional

from core.db import load_dsn, connect  # noqa: F401  (Re-Export)
from core.db_compat import SqliteCompatConn


PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS steam_achievements_seen (
    tenant_id            INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    steam_id             TEXT NOT NULL,
    app_id               INTEGER NOT NULL,
    achievement_api_name TEXT NOT NULL,
    unlocked_at          BIGINT NOT NULL,
    display_name         TEXT,
    description          TEXT,
    icon_url             TEXT,
    displayed_at         BIGINT,
    PRIMARY KEY (tenant_id, steam_id, app_id, achievement_api_name)
);
CREATE INDEX IF NOT EXISTS idx_steam_ach_undisplayed
    ON steam_achievements_seen (tenant_id, steam_id, displayed_at);

CREATE TABLE IF NOT EXISTS steam_app_schema (
    app_id               INTEGER PRIMARY KEY,
    game_name            TEXT,
    achievement_count    INTEGER NOT NULL DEFAULT 0,
    schema_json          TEXT,
    global_pct_json      TEXT,
    global_pct_cached_at BIGINT,
    cached_at            BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS steam_app_progress (
    tenant_id      INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    steam_id       TEXT NOT NULL,
    app_id         INTEGER NOT NULL,
    unlocked_count INTEGER NOT NULL DEFAULT 0,
    last_checked   BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, steam_id, app_id)
);

CREATE TABLE IF NOT EXISTS steam_owned_games (
    tenant_id            INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    steam_id             TEXT NOT NULL,
    app_id               INTEGER NOT NULL,
    name                 TEXT,
    img_icon_url         TEXT,
    img_logo_url         TEXT,
    playtime_forever_min INTEGER NOT NULL DEFAULT 0,
    playtime_2weeks_min  INTEGER NOT NULL DEFAULT 0,
    last_played_at       BIGINT,
    steam_last_played    BIGINT,
    last_synced          BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, steam_id, app_id)
);

CREATE TABLE IF NOT EXISTS steam_app_schema_lang (
    app_id      INTEGER NOT NULL,
    lang        TEXT NOT NULL,
    schema_json TEXT,
    cached_at   BIGINT NOT NULL,
    PRIMARY KEY (app_id, lang)
);

CREATE TABLE IF NOT EXISTS steam_app_details (
    app_id            INTEGER PRIMARY KEY,
    header_image      TEXT,
    short_description TEXT,
    is_coop           INTEGER NOT NULL DEFAULT 0,
    is_multiplayer    INTEGER NOT NULL DEFAULT 0,
    category_ids      TEXT,
    genre_names       TEXT,
    cached_at         BIGINT NOT NULL
);
"""


COOP_CATEGORY_IDS        = {9, 36, 38}
MULTIPLAYER_CATEGORY_IDS = {1, 27, 36, 38}


def init_schema(conn):
    with conn.cursor() as cur:
        cur.execute(PG_SCHEMA)
    conn.commit()


def _raw(conn):
    """Liefert die unterliegende psycopg2-Connection, falls in
    SqliteCompatConn gewickelt; ansonsten conn selbst."""
    return conn.raw if isinstance(conn, SqliteCompatConn) else conn


def _steam_image_url(app_id: int, image_hash: str) -> Optional[str]:
    if not image_hash or not app_id:
        return None
    return (f"https://media.steampowered.com/steamcommunity/public/"
            f"images/apps/{app_id}/{image_hash}.jpg")


# ── Owned Games (per-tenant) ───────────────────────────────────────────────
def upsert_owned_games(conn, tenant_id: int, steam_id: str, games: list) -> None:
    """Schreibt Library-Daten. last_played_at bleibt NULL (nur Poller's
    mark_played_now darf den setzen). steam_last_played wird via COALESCE
    erhalten, falls Steam aktuell keinen Wert liefert."""
    raw = _raw(conn)
    with raw.cursor() as cur:
        for g in games:
            appid = g.get("appid")
            icon_url = _steam_image_url(appid, g.get("img_icon_url"))
            logo_url = _steam_image_url(appid, g.get("img_logo_url"))
            steam_last = g.get("rtime_last_played") or None
            cur.execute("""
                INSERT INTO steam_owned_games
                  (tenant_id, steam_id, app_id, name, img_icon_url,
                   img_logo_url, playtime_forever_min, playtime_2weeks_min,
                   last_played_at, steam_last_played, last_synced)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL, %s,
                        EXTRACT(EPOCH FROM now())::BIGINT)
                ON CONFLICT (tenant_id, steam_id, app_id) DO UPDATE SET
                  name = EXCLUDED.name,
                  img_icon_url = EXCLUDED.img_icon_url,
                  img_logo_url = EXCLUDED.img_logo_url,
                  playtime_forever_min = EXCLUDED.playtime_forever_min,
                  playtime_2weeks_min = EXCLUDED.playtime_2weeks_min,
                  steam_last_played = COALESCE(EXCLUDED.steam_last_played,
                                               steam_owned_games.steam_last_played),
                  last_synced = EXCLUDED.last_synced
            """, (tenant_id, steam_id, appid, g.get("name"),
                  icon_url, logo_url,
                  g.get("playtime_forever", 0),
                  g.get("playtime_2weeks", 0),
                  steam_last))
    raw.commit()


def mark_played_now(conn, tenant_id: int, steam_id: str, app_id: int) -> None:
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            UPDATE steam_owned_games
            SET last_played_at = EXTRACT(EPOCH FROM now())::BIGINT
            WHERE tenant_id = %s AND steam_id = %s AND app_id = %s
        """, (tenant_id, steam_id, app_id))
    raw.commit()


def get_owned_game(conn, tenant_id: int, steam_id: str, app_id: int):
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute(
            "SELECT * FROM steam_owned_games "
            "WHERE tenant_id=%s AND steam_id=%s AND app_id=%s",
            (tenant_id, steam_id, app_id),
        )
        return cur.fetchone()


def get_owned_games_filtered(conn, tenant_id: int, steam_id: str,
                              filter_kind: str = "all",
                              sort_by: str = "playtime",
                              min_playtime_min: int = 0,
                              played_since_days: int = 0,
                              limit: int = 100) -> list:
    """Joins steam_owned_games + steam_app_details (global), filtert nach
    Coop / Multiplayer / Alle, sortiert + limitiert."""
    where = ["og.tenant_id = %s", "og.steam_id = %s"]
    params = [tenant_id, steam_id]
    if filter_kind == "coop":
        where.append("ad.is_coop = 1")
    elif filter_kind == "multiplayer":
        where.append("ad.is_multiplayer = 1")
    if min_playtime_min > 0:
        where.append("og.playtime_forever_min >= %s")
        params.append(min_playtime_min)
    if played_since_days > 0:
        where.append(
            "(og.steam_last_played >= EXTRACT(EPOCH FROM now())::BIGINT - %s "
            " OR og.last_played_at  >= EXTRACT(EPOCH FROM now())::BIGINT - %s)")
        params.append(played_since_days * 86400)
        params.append(played_since_days * 86400)
    if sort_by == "recent":
        where.append("og.playtime_2weeks_min > 0")

    order = {
        "playtime": "og.playtime_forever_min DESC",
        "recent":   "og.playtime_2weeks_min DESC",
        "name":     "LOWER(og.name) ASC",
        "random":   "RANDOM()",
    }.get(sort_by, "og.playtime_forever_min DESC")

    sql = f"""
        SELECT og.app_id, og.name, og.img_icon_url, og.img_logo_url,
               og.playtime_forever_min, og.playtime_2weeks_min,
               og.last_played_at, og.steam_last_played,
               ad.header_image, ad.short_description,
               ad.is_coop, ad.is_multiplayer, ad.category_ids
        FROM steam_owned_games og
        LEFT JOIN steam_app_details ad ON ad.app_id = og.app_id
        WHERE {' AND '.join(where)}
        ORDER BY {order}
        LIMIT %s
    """
    params.append(limit)
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


# ── App Details (Storefront-Cache, GLOBAL) ────────────────────────────────
def upsert_app_details(conn, app_id: int,
                       header_image: Optional[str] = None,
                       short_description: Optional[str] = None,
                       is_coop: bool = False,
                       is_multiplayer: bool = False,
                       category_ids: Optional[str] = None,
                       genre_names: Optional[str] = None) -> None:
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            INSERT INTO steam_app_details
              (app_id, header_image, short_description,
               is_coop, is_multiplayer, category_ids, genre_names, cached_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s,
                    EXTRACT(EPOCH FROM now())::BIGINT)
            ON CONFLICT (app_id) DO UPDATE SET
              header_image = COALESCE(EXCLUDED.header_image,
                                       steam_app_details.header_image),
              short_description = COALESCE(EXCLUDED.short_description,
                                            steam_app_details.short_description),
              is_coop = EXCLUDED.is_coop,
              is_multiplayer = EXCLUDED.is_multiplayer,
              category_ids = COALESCE(EXCLUDED.category_ids,
                                       steam_app_details.category_ids),
              genre_names = COALESCE(EXCLUDED.genre_names,
                                      steam_app_details.genre_names),
              cached_at = EXCLUDED.cached_at
        """, (app_id, header_image, short_description,
              int(bool(is_coop)), int(bool(is_multiplayer)),
              category_ids, genre_names))
    raw.commit()


def get_app_details_row(conn, app_id: int):
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute(
            "SELECT * FROM steam_app_details WHERE app_id=%s", (app_id,)
        )
        return cur.fetchone()


def find_app_needing_details_sync(conn, tenant_id: int, steam_id: str,
                                    max_age_s: int):
    """Liefert genau eine app_id die einen Storefront-Refresh braucht.
    Per-tenant (Library), aber Cache-Tabelle ist global."""
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            SELECT og.app_id
            FROM steam_owned_games og
            LEFT JOIN steam_app_details ad ON ad.app_id = og.app_id
            WHERE og.tenant_id = %s AND og.steam_id = %s
              AND (ad.cached_at IS NULL
                   OR ad.cached_at < EXTRACT(EPOCH FROM now())::BIGINT - %s)
            ORDER BY og.playtime_forever_min DESC, og.app_id ASC
            LIMIT 1
        """, (tenant_id, steam_id, max_age_s))
        row = cur.fetchone()
    return row["app_id"] if row else None


# ── App Schema (GLOBAL) ────────────────────────────────────────────────────
def upsert_app_schema(conn, app_id: int, game_name: Optional[str],
                       achievement_count: int,
                       schema_json: Optional[str]) -> None:
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            INSERT INTO steam_app_schema
              (app_id, game_name, achievement_count, schema_json, cached_at)
            VALUES (%s, %s, %s, %s, EXTRACT(EPOCH FROM now())::BIGINT)
            ON CONFLICT (app_id) DO UPDATE SET
              game_name = EXCLUDED.game_name,
              achievement_count = EXCLUDED.achievement_count,
              schema_json = EXCLUDED.schema_json,
              cached_at = EXCLUDED.cached_at
        """, (app_id, game_name, achievement_count, schema_json))
    raw.commit()


def get_app_schema(conn, app_id: int):
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute(
            "SELECT * FROM steam_app_schema WHERE app_id=%s", (app_id,)
        )
        return cur.fetchone()


def get_app_schema_lang(conn, app_id: int, lang: str):
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute(
            "SELECT * FROM steam_app_schema_lang "
            "WHERE app_id=%s AND lang=%s",
            (app_id, lang)
        )
        return cur.fetchone()


def upsert_app_schema_lang(conn, app_id: int, lang: str,
                            schema_json: str) -> None:
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            INSERT INTO steam_app_schema_lang
              (app_id, lang, schema_json, cached_at)
            VALUES (%s, %s, %s, EXTRACT(EPOCH FROM now())::BIGINT)
            ON CONFLICT (app_id, lang) DO UPDATE SET
              schema_json = EXCLUDED.schema_json,
              cached_at = EXCLUDED.cached_at
        """, (app_id, lang, schema_json))
    raw.commit()


def upsert_global_achievement_pct(conn, app_id: int,
                                    pct_json: str) -> None:
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            INSERT INTO steam_app_schema
              (app_id, game_name, achievement_count, schema_json,
               global_pct_json, global_pct_cached_at, cached_at)
            VALUES (%s, NULL, 0, NULL, %s,
                    EXTRACT(EPOCH FROM now())::BIGINT,
                    EXTRACT(EPOCH FROM now())::BIGINT)
            ON CONFLICT (app_id) DO UPDATE SET
              global_pct_json = EXCLUDED.global_pct_json,
              global_pct_cached_at = EXCLUDED.global_pct_cached_at
        """, (app_id, pct_json))
    raw.commit()


def get_global_achievement_pct(conn, app_id: int):
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            SELECT global_pct_json, global_pct_cached_at
            FROM steam_app_schema WHERE app_id=%s
        """, (app_id,))
        row = cur.fetchone()
    if not row:
        return (None, None)
    return (row["global_pct_json"], row["global_pct_cached_at"])


# ── Achievement Feed (per-tenant) ──────────────────────────────────────────
def get_achievement_feed(conn, tenant_id: int, steam_id: str,
                          limit: int = 20,
                          since_ts: Optional[int] = None) -> list:
    sql = """
        SELECT app_id, achievement_api_name, unlocked_at,
               display_name, description, icon_url
        FROM steam_achievements_seen
        WHERE tenant_id=%s AND steam_id=%s AND app_id >= 0
    """
    params = [tenant_id, steam_id]
    if since_ts is not None:
        sql += " AND unlocked_at >= %s"
        params.append(since_ts)
    sql += " ORDER BY unlocked_at DESC LIMIT %s"
    params.append(limit)
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


# ── Achievement Unlocks (per-tenant) ───────────────────────────────────────
def insert_unlock_if_new(conn, tenant_id: int, steam_id: str, app_id: int,
                          api_name: str, unlocked_at: int,
                          display_name: Optional[str] = None,
                          description: Optional[str] = None,
                          icon_url: Optional[str] = None,
                          suppress_popup: bool = False) -> bool:
    displayed_at = None
    if suppress_popup:
        import time as _t
        displayed_at = int(_t.time())
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            INSERT INTO steam_achievements_seen
              (tenant_id, steam_id, app_id, achievement_api_name,
               unlocked_at, display_name, description, icon_url, displayed_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (tenant_id, steam_id, app_id, achievement_api_name)
                DO NOTHING
        """, (tenant_id, steam_id, app_id, api_name, unlocked_at,
              display_name, description, icon_url, displayed_at))
        rc = cur.rowcount
    raw.commit()
    return rc > 0


def get_undisplayed_unlocks(conn, tenant_id: int, steam_id: str,
                             since_ts: Optional[int] = None) -> list:
    sql = """
        SELECT app_id, achievement_api_name, unlocked_at,
               display_name, description, icon_url
        FROM steam_achievements_seen
        WHERE tenant_id=%s AND steam_id=%s AND displayed_at IS NULL
    """
    params = [tenant_id, steam_id]
    if since_ts is not None:
        sql += " AND unlocked_at >= %s"
        params.append(since_ts)
    sql += " ORDER BY unlocked_at ASC"
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def mark_displayed(conn, tenant_id: int, steam_id: str, app_id: int,
                    api_name: str) -> None:
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            UPDATE steam_achievements_seen
            SET displayed_at = EXTRACT(EPOCH FROM now())::BIGINT
            WHERE tenant_id=%s AND steam_id=%s AND app_id=%s
              AND achievement_api_name=%s
        """, (tenant_id, steam_id, app_id, api_name))
    raw.commit()


def mark_all_displayed(conn, tenant_id: int, steam_id: str) -> int:
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            UPDATE steam_achievements_seen
            SET displayed_at = EXTRACT(EPOCH FROM now())::BIGINT
            WHERE tenant_id=%s AND steam_id=%s AND displayed_at IS NULL
        """, (tenant_id, steam_id))
        rc = cur.rowcount
    raw.commit()
    return rc


# ── Progress (per-tenant) ──────────────────────────────────────────────────
def upsert_progress(conn, tenant_id: int, steam_id: str, app_id: int,
                     unlocked_count: int) -> None:
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            INSERT INTO steam_app_progress
              (tenant_id, steam_id, app_id, unlocked_count, last_checked)
            VALUES (%s, %s, %s, %s, EXTRACT(EPOCH FROM now())::BIGINT)
            ON CONFLICT (tenant_id, steam_id, app_id) DO UPDATE SET
              unlocked_count = EXCLUDED.unlocked_count,
              last_checked = EXCLUDED.last_checked
        """, (tenant_id, steam_id, app_id, unlocked_count))
    raw.commit()


def find_app_needing_backfill(conn, tenant_id: int, steam_id: str):
    """Liefert genau eine app_id aus der Library, fuer die noch kein
    Achievement-Schema gecached ist. Sortiert nach playtime desc — meist
    gespielte Spiele zuerst, damit der Streamer schnell relevante Daten
    sieht."""
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            SELECT og.app_id
            FROM steam_owned_games og
            LEFT JOIN steam_app_schema s ON s.app_id = og.app_id
            WHERE og.tenant_id = %s AND og.steam_id = %s
              AND s.app_id IS NULL
            ORDER BY og.playtime_forever_min DESC, og.app_id ASC
            LIMIT 1
        """, (tenant_id, steam_id))
        row = cur.fetchone()
    return row["app_id"] if row else None


def find_app_needing_unlock_check(conn, tenant_id: int, steam_id: str):
    """Liefert eine app_id mit gecachtem Schema (>0 Achievements), fuer
    die der User noch keinen Progress-Eintrag hat — d.h. die Unlocks
    wurden noch nie geprueft. Sortiert nach playtime desc."""
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            SELECT og.app_id
            FROM steam_owned_games og
            JOIN steam_app_schema s ON s.app_id = og.app_id
            LEFT JOIN steam_app_progress p
              ON p.tenant_id = og.tenant_id
             AND p.steam_id = og.steam_id
             AND p.app_id = og.app_id
            WHERE og.tenant_id = %s AND og.steam_id = %s
              AND s.achievement_count > 0
              AND p.app_id IS NULL
            ORDER BY og.playtime_forever_min DESC, og.app_id ASC
            LIMIT 1
        """, (tenant_id, steam_id))
        row = cur.fetchone()
    return row["app_id"] if row else None


def get_progress(conn, tenant_id: int, steam_id: str, app_id: int):
    raw = _raw(conn)
    with raw.cursor() as cur:
        cur.execute("""
            SELECT * FROM steam_app_progress
            WHERE tenant_id=%s AND steam_id=%s AND app_id=%s
        """, (tenant_id, steam_id, app_id))
        return cur.fetchone()
