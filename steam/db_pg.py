"""PostgreSQL-Adapter fuer Steam-Daten. Analog zu pubg/db_pg.py.

Schema-Mapping SQLite -> Postgres:
  TEXT bleibt TEXT, INTEGER bleibt INTEGER, AUTOINCREMENT n/a (PK Composite).
  Alle Tabellen kriegen tenant_id INT NOT NULL.
"""
from core.db import load_dsn, connect  # noqa: F401  (Re-Export)


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
