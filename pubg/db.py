import datetime as _dt
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    account_id      TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    platform        TEXT NOT NULL,
    is_self         INTEGER DEFAULT 0,
    first_seen_at   TEXT NOT NULL,
    last_polled_at  TEXT
);

CREATE TABLE IF NOT EXISTS matches (
    match_id          TEXT PRIMARY KEY,
    map_name          TEXT NOT NULL,
    game_mode         TEXT NOT NULL,
    is_ranked         INTEGER DEFAULT 0,
    duration_secs     INTEGER,
    played_at         TEXT NOT NULL,
    telemetry_url     TEXT,
    telemetry_fetched INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS participants (
    match_id         TEXT NOT NULL,
    account_id       TEXT NOT NULL,
    name             TEXT NOT NULL,
    team_id          INTEGER,
    place            INTEGER,
    kills            INTEGER,
    headshot_kills   INTEGER,
    assists          INTEGER,
    dbnos            INTEGER,
    revives          INTEGER,
    damage_dealt     REAL,
    longest_kill     REAL,
    time_survived    INTEGER,
    walk_distance    REAL,
    ride_distance    REAL,
    swim_distance    REAL,
    weapons_acquired INTEGER,
    heals            INTEGER,
    boosts           INTEGER,
    team_kills       INTEGER,
    PRIMARY KEY (match_id, account_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (account_id) REFERENCES players(account_id)
);
CREATE INDEX IF NOT EXISTS idx_part_player ON participants(account_id);

CREATE TABLE IF NOT EXISTS telemetry_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id        TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    timestamp_ms    INTEGER,
    actor_account   TEXT,
    target_account  TEXT,
    weapon          TEXT,
    distance        REAL,
    damage          REAL,
    payload_json    TEXT,
    FOREIGN KEY (match_id) REFERENCES matches(match_id)
);
CREATE INDEX IF NOT EXISTS idx_tel_match ON telemetry_events(match_id);
CREATE INDEX IF NOT EXISTS idx_tel_actor ON telemetry_events(actor_account);
CREATE INDEX IF NOT EXISTS idx_tel_type  ON telemetry_events(event_type);

CREATE TABLE IF NOT EXISTS player_lifetime (
    account_id        TEXT NOT NULL,
    mode              TEXT NOT NULL,
    rounds_played     INTEGER,
    wins              INTEGER,
    top10s            INTEGER,
    win_rate          REAL,
    top10_rate        REAL,
    kills             INTEGER,
    kd_ratio          REAL,
    headshot_kills    INTEGER,
    headshot_rate     REAL,
    avg_damage        REAL,
    longest_kill      REAL,
    time_survived_sec INTEGER,
    last_refreshed    TEXT,
    PRIMARY KEY (account_id, mode),
    FOREIGN KEY (account_id) REFERENCES players(account_id)
);

CREATE TABLE IF NOT EXISTS stamm_crew (
    account_id      TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    added_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- Lists ALL non-self co-players with their shared_matches count.
-- The "qualified" threshold (>=N matches) is applied by callers via WHERE,
-- not pre-filtered here. ON DELETE policy on FKs is implicit NO ACTION
-- (default) — deleting a referenced players/matches row will fail unless
-- dependent rows are removed first.
CREATE VIEW IF NOT EXISTS qualified_co_players AS
SELECT
    p.account_id,
    p.name,
    COUNT(DISTINCT pa.match_id) AS shared_matches
FROM participants pa
JOIN players p ON p.account_id = pa.account_id
WHERE p.is_self = 0
GROUP BY p.account_id;
"""


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


# ── DAO ─────────────────────────────────────────────────────────────────────


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def upsert_player(conn, account_id: str, name: str, platform: str,
                  is_self: bool = False) -> None:
    conn.execute("""
        INSERT INTO players(account_id, name, platform, is_self, first_seen_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
            name = excluded.name,
            platform = excluded.platform,
            is_self = excluded.is_self
    """, (account_id, name, platform, 1 if is_self else 0, _now_iso()))
    conn.commit()


def get_player_by_name(conn, name: str):
    return conn.execute(
        "SELECT * FROM players WHERE name = ?", (name,)
    ).fetchone()


def get_player_by_id(conn, account_id: str):
    return conn.execute(
        "SELECT * FROM players WHERE account_id = ?", (account_id,)
    ).fetchone()


def get_self_player(conn):
    return conn.execute(
        "SELECT * FROM players WHERE is_self = 1 LIMIT 1"
    ).fetchone()


def insert_match(conn, match_id, map_name, game_mode, is_ranked,
                 duration_secs, played_at, telemetry_url) -> None:
    conn.execute("""
        INSERT OR IGNORE INTO matches(match_id, map_name, game_mode, is_ranked,
            duration_secs, played_at, telemetry_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (match_id, map_name, game_mode, 1 if is_ranked else 0,
          duration_secs, played_at, telemetry_url))
    conn.commit()


def get_match(conn, match_id):
    return conn.execute(
        "SELECT * FROM matches WHERE match_id = ?", (match_id,)
    ).fetchone()


PARTICIPANT_COLS = (
    "match_id", "account_id", "name", "team_id", "place", "kills",
    "headshot_kills", "assists", "dbnos", "revives", "damage_dealt",
    "longest_kill", "time_survived", "walk_distance", "ride_distance",
    "swim_distance", "weapons_acquired", "heals", "boosts", "team_kills",
)


def insert_participants(conn, match_id, rows):
    placeholders = ",".join(["?"] * len(PARTICIPANT_COLS))
    cols = ",".join(PARTICIPANT_COLS)
    for r in rows:
        values = [match_id] + [r.get(c) for c in PARTICIPANT_COLS[1:]]
        conn.execute(
            f"INSERT OR REPLACE INTO participants({cols}) VALUES ({placeholders})",
            values,
        )
    conn.commit()


def get_squad_for_match(conn, match_id):
    return conn.execute(
        "SELECT * FROM participants WHERE match_id = ? ORDER BY name", (match_id,)
    ).fetchall()


def get_known_match_ids(conn):
    rows = conn.execute("SELECT match_id FROM matches").fetchall()
    return {r["match_id"] for r in rows}
