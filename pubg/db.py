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
    telemetry_fetched INTEGER DEFAULT 0,
    telemetry_schema  INTEGER DEFAULT 0
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
    actor_x         REAL,
    actor_y         REAL,
    victim_x        REAL,
    victim_y        REAL,
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
    conn = sqlite3.connect(path, timeout=10.0)
    conn.row_factory = sqlite3.Row
    # WAL: crash-safe + Reader blocken Writer nicht (Poller schreibt während
    # HTTP-Endpoints lesen). synchronous=NORMAL ist mit WAL safe und schnell.
    # busy_timeout: bei kurzen Locks 5s warten statt SQLITE_BUSY werfen.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


CURRENT_TELEMETRY_SCHEMA = 3
# 1 = squad-only filter
# 2 = + Kill/Knock global + Position
# 3 = + Landing global + Position (für 'Teams in 300m Umkreis')
# match_schema: 1 = nur Squad-Participants
# 2 = + match_team_mapping (account_id, team_id)
# 3 = + match_team_mapping mit kills + place (für echtes Lobby-K/D + Squad-Aggregat)
# 4 = + match_team_mapping mit time_survived (für echte Death-Counts pro Mate)
CURRENT_MATCH_SCHEMA = 4


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    # Migrationen für bestehende DBs: ALTER TABLE ADD COLUMN ist idempotent
    # via try/except, weil SQLite kein "IF NOT EXISTS" für Columns kennt.
    migrations = [
        ("telemetry_events", "actor_x", "REAL"),
        ("telemetry_events", "actor_y", "REAL"),
        ("telemetry_events", "victim_x", "REAL"),
        ("telemetry_events", "victim_y", "REAL"),
        ("matches", "telemetry_schema", "INTEGER DEFAULT 0"),
        ("matches", "match_schema", "INTEGER DEFAULT 0"),
    ]
    for table, col, typ in migrations:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass  # Column existiert bereits
    # Lightweight Lookup: account_id → team_id pro Match.
    # +kills, +place für echtes Lobby-K/D und Squad-Aggregate.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS match_team_mapping (
            match_id TEXT NOT NULL,
            account_id TEXT NOT NULL,
            team_id INTEGER,
            kills INTEGER,
            place INTEGER,
            time_survived INTEGER,
            PRIMARY KEY (match_id, account_id)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_mtm_match ON match_team_mapping(match_id)
    """)
    # Migrationen für bestehende DBs
    for col, typ in [("kills", "INTEGER"), ("place", "INTEGER"),
                     ("time_survived", "INTEGER")]:
        try:
            conn.execute(f"ALTER TABLE match_team_mapping ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass
    conn.commit()


def integrity_check(conn: sqlite3.Connection) -> str:
    """Returns 'ok' wenn DB sauber ist, sonst Fehler-String."""
    row = conn.execute("PRAGMA integrity_check").fetchone()
    return row[0] if row else "unknown"


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


def insert_team_mapping(conn, match_id: str, mapping_rows) -> None:
    """Schreibt account_id → team_id+kills+place+time_survived Lookup für
    die gesamte Lobby. Idempotent via INSERT OR REPLACE auf
    (match_id, account_id)."""
    for r in mapping_rows:
        if not r.get("account_id"):
            continue
        conn.execute(
            "INSERT OR REPLACE INTO match_team_mapping"
            "(match_id, account_id, team_id, kills, place, time_survived) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (match_id, r["account_id"], r.get("team_id"),
             r.get("kills"), r.get("place"), r.get("time_survived")),
        )
    conn.commit()


def get_team_mapping_for_match(conn, match_id: str) -> dict:
    """Liefert {account_id: team_id} für gesamte Lobby des Matches."""
    rows = conn.execute(
        "SELECT account_id, team_id FROM match_team_mapping WHERE match_id = ?",
        (match_id,),
    ).fetchall()
    return {r["account_id"]: r["team_id"] for r in rows}


def mark_match_schema(conn, match_id: str, schema_version: int) -> None:
    conn.execute(
        "UPDATE matches SET match_schema = ? WHERE match_id = ?",
        (schema_version, match_id),
    )
    conn.commit()


def get_matches_needing_match_schema_update(conn, target_schema: int,
                                              limit: int = 1000):
    """Matches deren match_schema < target_schema OR die nötige Daten
    fehlen (Schema 3 → kills, Schema 4 → time_survived). Letzteres fängt
    Matches die irrtümlich als 'schema=N' markiert waren ohne dass die
    Daten wirklich da sind."""
    return conn.execute("""
        SELECT m.match_id FROM matches m
        WHERE COALESCE(m.match_schema, 0) < ?
           OR (? >= 3 AND NOT EXISTS (
               SELECT 1 FROM match_team_mapping mtm
               WHERE mtm.match_id = m.match_id
                 AND mtm.kills IS NOT NULL
           ))
           OR (? >= 4 AND NOT EXISTS (
               SELECT 1 FROM match_team_mapping mtm
               WHERE mtm.match_id = m.match_id
                 AND mtm.time_survived IS NOT NULL
           ))
        ORDER BY m.played_at DESC LIMIT ?
    """, (target_schema, target_schema, target_schema, limit)).fetchall()


def get_squad_for_match(conn, match_id):
    return conn.execute(
        "SELECT * FROM participants WHERE match_id = ? ORDER BY name", (match_id,)
    ).fetchall()


def get_known_match_ids(conn):
    rows = conn.execute("SELECT match_id FROM matches").fetchall()
    return {r["match_id"] for r in rows}


def set_setting(conn, key: str, value: str) -> None:
    conn.execute("""
        INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    """, (key, value, _now_iso()))
    conn.commit()


def get_setting(conn, key: str, default=None):
    r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


LIFETIME_COLS = (
    "rounds_played", "wins", "top10s", "win_rate", "top10_rate",
    "kills", "kd_ratio", "headshot_kills", "headshot_rate",
    "avg_damage", "longest_kill", "time_survived_sec",
)


def upsert_lifetime(conn, account_id: str, mode: str, stats: dict) -> None:
    cols = ", ".join(LIFETIME_COLS)
    placeholders = ", ".join(["?"] * len(LIFETIME_COLS))
    updates = ", ".join(f"{c}=excluded.{c}" for c in LIFETIME_COLS)
    values = [account_id, mode] + [stats.get(c) for c in LIFETIME_COLS]
    conn.execute(f"""
        INSERT INTO player_lifetime(account_id, mode, {cols}, last_refreshed)
        VALUES (?, ?, {placeholders}, ?)
        ON CONFLICT(account_id, mode) DO UPDATE SET {updates}, last_refreshed=excluded.last_refreshed
    """, values + [_now_iso()])
    conn.commit()


def get_lifetime(conn, account_id: str, mode: str):
    return conn.execute(
        "SELECT * FROM player_lifetime WHERE account_id=? AND mode=?",
        (account_id, mode),
    ).fetchone()


def insert_telemetry_events(conn, match_id: str, events: list) -> None:
    rows = [(match_id, e["event_type"], e.get("timestamp_ms"),
             e.get("actor_account"), e.get("target_account"),
             e.get("actor_x"), e.get("actor_y"),
             e.get("victim_x"), e.get("victim_y"),
             e.get("weapon"), e.get("distance"), e.get("damage"),
             e.get("payload_json", "{}"))
            for e in events]
    conn.executemany("""
        INSERT INTO telemetry_events
        (match_id, event_type, timestamp_ms, actor_account, target_account,
         actor_x, actor_y, victim_x, victim_y,
         weapon, distance, damage, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)
    conn.commit()


def get_telemetry_for_match(conn, match_id: str):
    return conn.execute(
        "SELECT * FROM telemetry_events WHERE match_id=?", (match_id,)
    ).fetchall()


def mark_telemetry_fetched(conn, match_id: str) -> None:
    conn.execute("UPDATE matches SET telemetry_fetched=1 WHERE match_id=?", (match_id,))
    conn.commit()


def get_matches_needing_telemetry(conn, limit: int = 5):
    """Liefert matches die Telemetry brauchen — entweder noch nie gefetched
    ODER mit veralteter Schema-Version (für First-Fight-Cluster nötig).

    NOTE: PUBG-Doku dokumentiert KEINEN expliziten Telemetry-CDN-TTL.
    /telemetry-cdn ist nicht rate-limited, also versuchen wir jeden Match
    mit URL — bei 404 (URL abgelaufen) wird sauber telemetry_fetched=1
    gesetzt, kein endloser Re-Fetch."""
    return conn.execute("""
        SELECT m.match_id, m.telemetry_url FROM matches m
        WHERE m.telemetry_url IS NOT NULL
          AND (
            m.telemetry_fetched = 0
            OR COALESCE(m.telemetry_schema, 0) < ?
          )
        ORDER BY m.played_at DESC LIMIT ?
    """, (CURRENT_TELEMETRY_SCHEMA, limit)).fetchall()


def mark_telemetry_schema(conn, match_id: str, schema_version: int = None) -> None:
    """Setzt telemetry_schema-Marker nach erfolgreichem (Re-)Fetch.
    Default = aktuelle Schema-Version. Damit kein endloser Re-Fetch."""
    if schema_version is None:
        schema_version = CURRENT_TELEMETRY_SCHEMA
    conn.execute("UPDATE matches SET telemetry_schema=? WHERE match_id=?",
                 (schema_version, match_id))
    conn.commit()
