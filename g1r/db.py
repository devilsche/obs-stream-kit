"""G1R-DB (Sqlite-Variante für Tests/Dev). Prod nutzt g1r/db_pg.py; die DAO-
Funktionen hier laufen via core.db_compat.SqliteCompatConn auch auf Postgres
(?-Platzhalter + INSERT … RETURNING id)."""
import datetime
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS g1r_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    save_key TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    label TEXT,
    detection TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS g1r_sample (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    value INTEGER,
    meta TEXT
);
CREATE TABLE IF NOT EXISTS g1r_ingest_seq (
    tenant_id INTEGER NOT NULL,
    client_seq INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, client_seq)
);
CREATE INDEX IF NOT EXISTS ix_g1r_sample_trt ON g1r_sample(tenant_id, run_id, ts);
CREATE INDEX IF NOT EXISTS ix_g1r_event_trt ON g1r_event(tenant_id, run_id, ts);
"""


def connect(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
