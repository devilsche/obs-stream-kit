"""G1R-Schema für Postgres (Prod). DAO kommt aus g1r/db.py (läuft via
core.db_compat.SqliteCompatConn auf pg). Migration als postgres-Superuser,
search_path = obs."""

PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS g1r_run (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    save_key TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    label TEXT,
    detection TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS g1r_sample (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL,
    tenant_id INTEGER NOT NULL,
    ts TEXT NOT NULL,
    level INTEGER, xp INTEGER, hp REAL, hp_max REAL, mana REAL, mana_max REAL,
    strength INTEGER, dexterity INTEGER, magic_circle INTEGER, learn_pts INTEGER,
    res_fire INTEGER, res_ice INTEGER, res_edge INTEGER, res_point INTEGER, res_blunt INTEGER,
    distance_m REAL, steps INTEGER, guild_key TEXT,
    strongest_melee TEXT, strongest_melee_dmg INTEGER,
    strongest_ranged TEXT, strongest_ranged_dmg INTEGER,
    strongest_spell TEXT
);
CREATE TABLE IF NOT EXISTS g1r_event (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL,
    tenant_id INTEGER NOT NULL,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    value INTEGER,
    meta JSONB
);
CREATE TABLE IF NOT EXISTS g1r_ingest_seq (
    tenant_id INTEGER NOT NULL,
    client_seq BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, client_seq)
);
CREATE INDEX IF NOT EXISTS ix_g1r_sample_trt ON g1r_sample(tenant_id, run_id, ts);
CREATE INDEX IF NOT EXISTS ix_g1r_event_trt ON g1r_event(tenant_id, run_id, ts);
"""


def init_schema(conn):
    with conn.cursor() as cur:
        cur.execute(PG_SCHEMA)
    conn.commit()
