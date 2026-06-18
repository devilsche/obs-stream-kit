"""G1R-DB (Sqlite-Variante für Tests/Dev). Prod nutzt g1r/db_pg.py; die DAO-
Funktionen hier laufen via core.db_compat.SqliteCompatConn auch auf Postgres
(?-Platzhalter + INSERT … RETURNING id)."""
import datetime
import json
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


def _insert_run(conn, tenant_id, save_key, detection, label):
    row = conn.execute(
        "INSERT INTO g1r_run(tenant_id, save_key, started_at, label, detection, created_at) "
        "VALUES(?,?,?,?,?,?) RETURNING id",
        (tenant_id, save_key, _now_iso(), label, detection, _now_iso()),
    ).fetchone()
    conn.commit()
    return row[0]


def _active_run(conn, tenant_id):
    return conn.execute(
        "SELECT id, save_key FROM g1r_run WHERE tenant_id=? "
        "ORDER BY (ended_at IS NULL) DESC, id DESC LIMIT 1",
        (tenant_id,),
    ).fetchone()


def latest_sample_level(conn, tenant_id, run_id):
    r = conn.execute(
        "SELECT level FROM g1r_sample WHERE tenant_id=? AND run_id=? ORDER BY id DESC LIMIT 1",
        (tenant_id, run_id),
    ).fetchone()
    return (r["level"] if r and r["level"] is not None else 0)


def _end_run(conn, tenant_id, run_id):
    conn.execute("UPDATE g1r_run SET ended_at=? WHERE tenant_id=? AND id=?",
                 (_now_iso(), tenant_id, run_id))
    conn.commit()


def assign_run(conn, tenant_id, save_key, snapshot, *, force_new=False, label=None):
    if force_new:
        return _insert_run(conn, tenant_id, save_key, "manual", label)
    active = _active_run(conn, tenant_id)
    if active is None:
        return _insert_run(conn, tenant_id, save_key, "save" if save_key else "heuristic", label)
    if save_key:
        if active["save_key"] == save_key:
            return active["id"]
        _end_run(conn, tenant_id, active["id"])
        return _insert_run(conn, tenant_id, save_key, "save", label)
    lvl = snapshot.get("level") or 0
    xp = snapshot.get("xp") or 0
    prev_lvl = latest_sample_level(conn, tenant_id, active["id"])
    if lvl <= 2 and xp <= 200 and prev_lvl >= 5:
        _end_run(conn, tenant_id, active["id"])
        return _insert_run(conn, tenant_id, None, "heuristic", label)
    return active["id"]


_SAMPLE_COLS = ["level", "xp", "hp", "hp_max", "mana", "mana_max", "strength",
                "dexterity", "magic_circle", "learn_pts", "res_fire", "res_ice",
                "res_edge", "res_point", "res_blunt", "distance_m", "steps",
                "guild_key", "strongest_melee", "strongest_melee_dmg",
                "strongest_ranged", "strongest_ranged_dmg", "strongest_spell"]


def seq_seen(conn, tenant_id, client_seq):
    r = conn.execute("SELECT 1 FROM g1r_ingest_seq WHERE tenant_id=? AND client_seq=?",
                     (tenant_id, client_seq)).fetchone()
    return r is not None


def mark_seq(conn, tenant_id, client_seq):
    conn.execute("INSERT INTO g1r_ingest_seq(tenant_id, client_seq) VALUES(?,?)",
                 (tenant_id, client_seq))
    conn.commit()


def insert_sample(conn, tenant_id, run_id, snapshot):
    cols = ["run_id", "tenant_id", "ts"] + _SAMPLE_COLS
    vals = [run_id, tenant_id, _now_iso()] + [snapshot.get(c) for c in _SAMPLE_COLS]
    ph = ",".join(["?"] * len(cols))
    conn.execute(f"INSERT INTO g1r_sample({','.join(cols)}) VALUES({ph})", vals)
    conn.commit()


def insert_events(conn, tenant_id, run_id, events):
    for ev in (events or []):
        meta = ev.get("meta")
        conn.execute(
            "INSERT INTO g1r_event(run_id, tenant_id, ts, kind, value, meta) VALUES(?,?,?,?,?,?)",
            (run_id, tenant_id, _now_iso(), ev.get("kind"), ev.get("value"),
             json.dumps(meta) if meta is not None else None))
    conn.commit()
