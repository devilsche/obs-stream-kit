"""PostgreSQL-Adapter fuer PUBG-Daten.

Gleiche Tabellen-Struktur wie db.py (SQLite), aber PostgreSQL-kompatibel.
Typ-Mapping: AUTOINCREMENT → BIGSERIAL, TEXT bleibt TEXT, REAL → DOUBLE PRECISION,
INTEGER → INTEGER, json_extract → #>>/->>.

Alle Tabellen tragen `tenant_id` als FK auf `tenants(id)` (Multi-Tenant-Setup).

Verbindung: `load_dsn`/`connect` werden aus `core.db` re-exportiert (zentrale
OBS-Kit-DSN aus `.secrets` / `OBS_KIT_PG_DSN`).
"""

from core.db import load_dsn, connect  # noqa: F401  (Re-Export fuer Backward-Compat)

PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    tenant_id       INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    account_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    platform        TEXT NOT NULL,
    is_self         INTEGER DEFAULT 0,
    first_seen_at   TEXT NOT NULL,
    last_polled_at  TEXT,
    PRIMARY KEY (tenant_id, account_id)
);

CREATE TABLE IF NOT EXISTS matches (
    tenant_id         INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    match_id          TEXT NOT NULL,
    map_name          TEXT NOT NULL,
    game_mode         TEXT NOT NULL,
    is_ranked         INTEGER DEFAULT 0,
    duration_secs     INTEGER,
    played_at         TEXT NOT NULL,
    telemetry_url     TEXT,
    telemetry_fetched INTEGER DEFAULT 0,
    telemetry_schema  INTEGER DEFAULT 0,
    PRIMARY KEY (tenant_id, match_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_tenant_played
    ON matches(tenant_id, played_at DESC);

CREATE TABLE IF NOT EXISTS participants (
    tenant_id        INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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
    damage_dealt     DOUBLE PRECISION,
    longest_kill     DOUBLE PRECISION,
    time_survived    INTEGER,
    walk_distance    DOUBLE PRECISION,
    ride_distance    DOUBLE PRECISION,
    swim_distance    DOUBLE PRECISION,
    weapons_acquired INTEGER,
    heals            INTEGER,
    boosts           INTEGER,
    team_kills       INTEGER,
    PRIMARY KEY (tenant_id, match_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_part_tenant_player
    ON participants(tenant_id, account_id);
CREATE INDEX IF NOT EXISTS idx_part_tenant_match
    ON participants(tenant_id, match_id);

CREATE TABLE IF NOT EXISTS match_team_mapping (
    tenant_id    INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    match_id     TEXT NOT NULL,
    account_id   TEXT NOT NULL,
    team_id      INTEGER,
    kills        INTEGER,
    place        INTEGER,
    time_survived INTEGER,
    PRIMARY KEY (tenant_id, match_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_mtm_tenant_match
    ON match_team_mapping(tenant_id, match_id);

CREATE TABLE IF NOT EXISTS telemetry_events (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    match_id        TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    timestamp_ms    BIGINT,
    actor_account   TEXT,
    target_account  TEXT,
    actor_x         DOUBLE PRECISION,
    actor_y         DOUBLE PRECISION,
    actor_z         DOUBLE PRECISION,
    actor_health    DOUBLE PRECISION,
    victim_x        DOUBLE PRECISION,
    victim_y        DOUBLE PRECISION,
    weapon          TEXT,
    distance        DOUBLE PRECISION,
    damage          DOUBLE PRECISION,
    payload_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_tel_tenant_match
    ON telemetry_events(tenant_id, match_id);
CREATE INDEX IF NOT EXISTS idx_tel_tenant_actor
    ON telemetry_events(tenant_id, actor_account);
CREATE INDEX IF NOT EXISTS idx_tel_type
    ON telemetry_events(event_type);

CREATE TABLE IF NOT EXISTS player_lifetime (
    tenant_id         INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    account_id        TEXT NOT NULL,
    mode              TEXT NOT NULL,
    rounds_played     INTEGER,
    wins              INTEGER,
    top10s            INTEGER,
    win_rate          DOUBLE PRECISION,
    top10_rate        DOUBLE PRECISION,
    kills             INTEGER,
    kd_ratio          DOUBLE PRECISION,
    headshot_kills    INTEGER,
    headshot_rate     DOUBLE PRECISION,
    avg_damage        DOUBLE PRECISION,
    longest_kill      DOUBLE PRECISION,
    time_survived_sec INTEGER,
    assists           INTEGER,
    damage_dealt      DOUBLE PRECISION,
    dbnos             INTEGER,
    revives           INTEGER,
    team_kills        INTEGER,
    losses            INTEGER,
    last_refreshed    TEXT,
    PRIMARY KEY (tenant_id, account_id, mode)
);

CREATE TABLE IF NOT EXISTS player_season (
    tenant_id         INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    account_id        TEXT NOT NULL,
    season_id         TEXT NOT NULL,
    mode              TEXT NOT NULL,
    rounds_played     INTEGER,
    wins              INTEGER,
    top10s            INTEGER,
    win_rate          DOUBLE PRECISION,
    top10_rate        DOUBLE PRECISION,
    kills             INTEGER,
    kd_ratio          DOUBLE PRECISION,
    headshot_kills    INTEGER,
    headshot_rate     DOUBLE PRECISION,
    avg_damage        DOUBLE PRECISION,
    longest_kill      DOUBLE PRECISION,
    time_survived_sec INTEGER,
    assists           INTEGER,
    damage_dealt      DOUBLE PRECISION,
    dbnos             INTEGER,
    revives           INTEGER,
    team_kills        INTEGER,
    losses            INTEGER,
    last_refreshed    TEXT,
    PRIMARY KEY (tenant_id, account_id, season_id, mode)
);

CREATE TABLE IF NOT EXISTS settings (
    tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS pubg_achievements_seen (
    tenant_id       INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    achievement_id  TEXT NOT NULL,
    match_id        TEXT NOT NULL,
    label           TEXT,
    icon            TEXT,
    played_at       TEXT,
    detected_at     BIGINT NOT NULL,
    displayed_at    BIGINT,
    is_rare         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, achievement_id, match_id)
);
CREATE INDEX IF NOT EXISTS idx_pubg_ach_undisplayed
    ON pubg_achievements_seen (tenant_id, displayed_at);
"""


def init_schema(conn) -> None:
    """Schema anlegen (idempotent via IF NOT EXISTS)."""
    with conn.cursor() as cur:
        for stmt in _split_statements(PG_SCHEMA):
            if stmt.strip():
                cur.execute(stmt)
    conn.commit()


def _split_statements(sql: str):
    """Splits multi-statement SQL naiv an ';'."""
    return [s.strip() for s in sql.split(";") if s.strip()]


# ── Compatibility helpers (spiegeln db.py API) ──────────────────────────────

CURRENT_TELEMETRY_SCHEMA = 5
CURRENT_MATCH_SCHEMA = 4


def upsert_player(conn, account_id: str, name: str, platform: str,
                  is_self: bool = False) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO players (account_id, name, platform, is_self, first_seen_at)
            VALUES (%s, %s, %s, %s, NOW()::TEXT)
            ON CONFLICT (account_id) DO UPDATE
                SET name = EXCLUDED.name,
                    last_polled_at = NOW()::TEXT
        """, (account_id, name, platform, 1 if is_self else 0))


def upsert_match(conn, match_id: str, map_name: str, game_mode: str,
                 duration_secs: int, played_at: str, telemetry_url: str,
                 is_ranked: bool = False) -> bool:
    """Returns True wenn neu angelegt."""
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO matches (match_id, map_name, game_mode, is_ranked,
                                  duration_secs, played_at, telemetry_url)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (match_id) DO NOTHING
        """, (match_id, map_name, game_mode, 1 if is_ranked else 0,
              duration_secs, played_at, telemetry_url))
        return cur.rowcount > 0


def upsert_participant(conn, match_id: str, account_id: str, data: dict) -> None:
    cols = [
        "match_id", "account_id", "name", "team_id", "place", "kills",
        "headshot_kills", "assists", "dbnos", "revives", "damage_dealt",
        "longest_kill", "time_survived", "walk_distance", "ride_distance",
        "swim_distance", "weapons_acquired", "heals", "boosts", "team_kills",
    ]
    vals = [match_id, account_id] + [data.get(c) for c in cols[2:]]
    placeholders = ", ".join(["%s"] * len(cols))
    col_str = ", ".join(cols)
    with conn.cursor() as cur:
        cur.execute(f"""
            INSERT INTO participants ({col_str}) VALUES ({placeholders})
            ON CONFLICT (match_id, account_id) DO NOTHING
        """, vals)


def upsert_team_mapping(conn, match_id: str, rows: list) -> None:
    """rows: list of {account_id, team_id, kills, place, time_survived}"""
    with conn.cursor() as cur:
        for r in rows:
            cur.execute("""
                INSERT INTO match_team_mapping
                    (match_id, account_id, team_id, kills, place, time_survived)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (match_id, account_id) DO NOTHING
            """, (match_id, r["account_id"], r.get("team_id"),
                  r.get("kills"), r.get("place"), r.get("time_survived")))


def insert_telemetry_events(conn, match_id: str, events: list) -> None:
    if not events:
        return
    cols = ["match_id", "event_type", "timestamp_ms", "actor_account",
            "target_account", "actor_x", "actor_y", "actor_z", "actor_health",
            "victim_x", "victim_y", "weapon", "distance", "damage", "payload_json"]
    placeholders = ", ".join(["%s"] * len(cols))
    col_str = ", ".join(cols)
    with conn.cursor() as cur:
        for e in events:
            cur.execute(f"""
                INSERT INTO telemetry_events ({col_str})
                VALUES ({placeholders})
            """, [match_id] + [e.get(c) for c in cols[1:]])


def mark_telemetry_fetched(conn, match_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE matches SET telemetry_fetched=1 WHERE match_id=%s",
                    (match_id,))


def mark_telemetry_schema(conn, match_id: str,
                           schema_version: int = None) -> None:
    v = schema_version if schema_version is not None else CURRENT_TELEMETRY_SCHEMA
    with conn.cursor() as cur:
        cur.execute("UPDATE matches SET telemetry_schema=%s WHERE match_id=%s",
                    (v, match_id))
    conn.commit()


def get_matches_needing_telemetry(conn, limit: int = 5) -> list:
    """Matches die Telemetrie brauchen, innerhalb 16-Tage-Fenster."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT match_id, telemetry_url FROM matches
            WHERE telemetry_url IS NOT NULL
              AND (telemetry_fetched = 0
                   OR COALESCE(telemetry_schema, 0) < %s)
              AND played_at >= (NOW() - INTERVAL '16 days')::TEXT
            ORDER BY played_at DESC
            LIMIT %s
        """, (CURRENT_TELEMETRY_SCHEMA, limit))
        return cur.fetchall()


def get_player_by_name(conn, name: str):
    with conn.cursor() as cur:
        cur.execute("SELECT account_id, name FROM players WHERE name=%s", (name,))
        return cur.fetchone()


def get_setting(conn, key: str, default=None) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM settings WHERE key=%s", (key,))
        r = cur.fetchone()
        return r["value"] if r else default


def set_setting(conn, key: str, value: str) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO settings (key, value, updated_at)
            VALUES (%s, %s, NOW()::TEXT)
            ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,
                                             updated_at=EXCLUDED.updated_at
        """, (key, value))
