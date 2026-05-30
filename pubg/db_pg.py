"""PostgreSQL-Adapter fuer PUBG-Daten.

Gleiche Tabellen-Struktur wie db.py (SQLite), aber PostgreSQL-kompatibel.
Typ-Mapping: AUTOINCREMENT -> BIGSERIAL, TEXT bleibt TEXT, REAL -> DOUBLE
PRECISION, INTEGER -> INTEGER, json_extract -> ->>.

Alle Tabellen tragen `tenant_id` als FK auf `tenants(id)` (Multi-Tenant-Setup).
ALLE Helper-Funktionen nehmen `tenant_id` als erste Pflicht-Parameter
direkt nach `conn`.

Verbindung: `load_dsn`/`connect` werden aus `core.db` re-exportiert (zentrale
OBS-Kit-DSN aus `.secrets` / `OBS_KIT_PG_DSN`).
"""

import datetime as _dt
from typing import Optional

try:
    from psycopg2.extras import execute_values
except ImportError:  # psycopg2 ist optional am Dev-Rechner — Modul soll trotzdem laden
    execute_values = None  # type: ignore[assignment]

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
    match_schema      INTEGER DEFAULT 0,
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
    slot         INTEGER,
    kills        INTEGER,
    place        INTEGER,
    time_survived INTEGER,
    PRIMARY KEY (tenant_id, match_id, account_id)
);
-- Additiv: slot wurde nach v3 hinzugefuegt, alte Datensaetze haben NULL.
ALTER TABLE match_team_mapping ADD COLUMN IF NOT EXISTS slot INTEGER;
CREATE INDEX IF NOT EXISTS idx_mtm_tenant_match
    ON match_team_mapping(tenant_id, match_id);

-- telemetry_events: GLOBAL (no tenant_id). Wenn zwei Tenants im selben
-- Match sind, wird die Telemetrie einmal gespeichert. Sichtbarkeit
-- kommt durch den Join mit matches (das hat tenant_id).
CREATE TABLE IF NOT EXISTS telemetry_events (
    id              BIGSERIAL PRIMARY KEY,
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
CREATE INDEX IF NOT EXISTS idx_tel_match
    ON telemetry_events(match_id);
CREATE INDEX IF NOT EXISTS idx_tel_match_type
    ON telemetry_events(match_id, event_type);
CREATE INDEX IF NOT EXISTS idx_tel_actor
    ON telemetry_events(actor_account);
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
    suppress_popup  INTEGER NOT NULL DEFAULT 0,
    session_pct     DOUBLE PRECISION,
    match_pct       DOUBLE PRECISION,
    PRIMARY KEY (tenant_id, achievement_id, match_id)
);
CREATE INDEX IF NOT EXISTS idx_pubg_ach_undisplayed
    ON pubg_achievements_seen (tenant_id, displayed_at);
"""


# ── Schema-Versionen (re-exportiert von db.py; identisch halten!) ───────────

CURRENT_TELEMETRY_SCHEMA = 5
CURRENT_MATCH_SCHEMA = 4

TELEMETRY_RETENTION_DAYS = 16


# ── Setup / Low-level ───────────────────────────────────────────────────────


def init_schema(conn) -> None:
    """Schema anlegen (idempotent via IF NOT EXISTS).

    psycopg2 unterstuetzt Multi-Statement-SQL in einem `execute`-Call,
    solange der Treiber kein Server-Side-Prepared-Statement macht.
    """
    with conn.cursor() as cur:
        cur.execute(PG_SCHEMA)
    conn.commit()


def integrity_check(conn) -> str:
    """Connectivity-Check (PG hat kein PRAGMA-integrity-check Aequivalent).
    Liefert 'ok' wenn DB erreichbar ist, sonst Fehler-String."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 AS ok")
            cur.fetchone()
        return "ok"
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Settings ────────────────────────────────────────────────────────────────


def set_setting(conn, tenant_id: int, key: str, value: str) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO settings (tenant_id, key, value, updated_at)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (tenant_id, key) DO UPDATE
                SET value = EXCLUDED.value,
                    updated_at = EXCLUDED.updated_at
        """, (tenant_id, key, value, _now_iso()))
    conn.commit()


def get_setting(conn, tenant_id: int, key: str, default=None):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT value FROM settings WHERE tenant_id=%s AND key=%s",
            (tenant_id, key),
        )
        r = cur.fetchone()
        return r["value"] if r else default


# ── Players ─────────────────────────────────────────────────────────────────


def upsert_player(conn, tenant_id: int, account_id: str, name: str,
                  platform: str, is_self: int = 0) -> None:
    """Upsert player. is_self via GREATEST(existing, new) — once-self-always-self.
    first_seen_at bleibt erhalten via COALESCE (nur beim ersten Insert gesetzt).
    last_polled_at wird bei jedem Aufruf auf now() gesetzt."""
    now = _now_iso()
    is_self_int = 1 if is_self else 0
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO players (tenant_id, account_id, name, platform,
                                  is_self, first_seen_at, last_polled_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (tenant_id, account_id) DO UPDATE
                SET name = EXCLUDED.name,
                    platform = EXCLUDED.platform,
                    is_self = GREATEST(players.is_self, EXCLUDED.is_self),
                    last_polled_at = EXCLUDED.last_polled_at
        """, (tenant_id, account_id, name, platform, is_self_int, now, now))
    conn.commit()


def get_player_by_name(conn, tenant_id: int, name: str):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM players WHERE tenant_id=%s AND name=%s LIMIT 1",
            (tenant_id, name),
        )
        return cur.fetchone()


def get_player_by_id(conn, tenant_id: int, account_id: str):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM players WHERE tenant_id=%s AND account_id=%s",
            (tenant_id, account_id),
        )
        return cur.fetchone()


def get_self_player(conn, tenant_id: int):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM players WHERE tenant_id=%s AND is_self=1 LIMIT 1",
            (tenant_id,),
        )
        return cur.fetchone()


# ── Matches ─────────────────────────────────────────────────────────────────


def insert_match(conn, tenant_id: int, match_id: str, map_name: str,
                 game_mode: str, is_ranked, duration_secs: Optional[int],
                 played_at: str, telemetry_url: Optional[str] = None) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO matches (tenant_id, match_id, map_name, game_mode,
                                  is_ranked, duration_secs, played_at,
                                  telemetry_url)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (tenant_id, match_id) DO NOTHING
        """, (tenant_id, match_id, map_name, game_mode,
              1 if is_ranked else 0, duration_secs, played_at, telemetry_url))
    conn.commit()


def get_match(conn, tenant_id: int, match_id: str):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM matches WHERE tenant_id=%s AND match_id=%s",
            (tenant_id, match_id),
        )
        return cur.fetchone()


def get_known_match_ids(conn, tenant_id: int) -> set:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT match_id FROM matches WHERE tenant_id=%s", (tenant_id,)
        )
        return {r["match_id"] for r in cur.fetchall()}


def get_squad_for_match(conn, tenant_id: int, match_id: str):
    """Alle Participants des Matches (Spiegel von db.py — Squad-Filterung
    macht der Caller via team_id-Vergleich)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM participants WHERE tenant_id=%s AND match_id=%s "
            "ORDER BY name",
            (tenant_id, match_id),
        )
        return cur.fetchall()


def mark_match_schema(conn, tenant_id: int, match_id: str,
                      schema_version: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE matches SET match_schema=%s "
            "WHERE tenant_id=%s AND match_id=%s",
            (schema_version, tenant_id, match_id),
        )
    conn.commit()


def get_matches_needing_match_schema_update(conn, tenant_id: int,
                                              target_schema: int,
                                              limit: int = 10):
    """Matches deren match_schema < target_schema ODER die noetige Daten
    fehlen (Schema 3 -> kills, Schema 4 -> time_survived)."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT m.match_id FROM matches m
            WHERE m.tenant_id = %s
              AND (
                COALESCE(m.match_schema, 0) < %s
                OR (%s >= 3 AND NOT EXISTS (
                    SELECT 1 FROM match_team_mapping mtm
                    WHERE mtm.tenant_id = m.tenant_id
                      AND mtm.match_id = m.match_id
                      AND mtm.kills IS NOT NULL
                ))
                OR (%s >= 4 AND NOT EXISTS (
                    SELECT 1 FROM match_team_mapping mtm
                    WHERE mtm.tenant_id = m.tenant_id
                      AND mtm.match_id = m.match_id
                      AND mtm.time_survived IS NOT NULL
                ))
              )
            ORDER BY m.played_at DESC LIMIT %s
        """, (tenant_id, target_schema, target_schema, target_schema, limit))
        return cur.fetchall()


# ── Participants / Teams ────────────────────────────────────────────────────

PARTICIPANT_COLS = (
    "match_id", "account_id", "name", "team_id", "place", "kills",
    "headshot_kills", "assists", "dbnos", "revives", "damage_dealt",
    "longest_kill", "time_survived", "walk_distance", "ride_distance",
    "swim_distance", "weapons_acquired", "heals", "boosts", "team_kills",
)


def insert_participants(conn, tenant_id: int, match_id: str, rows) -> None:
    """Bulk-Insert participants. ON CONFLICT DO NOTHING — wie INSERT OR
    REPLACE im Original ist semantisch fast gleich, weil PUBG-Match-Daten
    immutable sind nachdem das Match fertig ist."""
    if not rows:
        return
    all_cols = ("tenant_id",) + PARTICIPANT_COLS
    values = []
    for r in rows:
        row = [tenant_id, match_id] + [r.get(c) for c in PARTICIPANT_COLS[1:]]
        values.append(tuple(row))
    col_str = ", ".join(all_cols)
    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO participants ({col_str}) VALUES %s "
            "ON CONFLICT (tenant_id, match_id, account_id) DO NOTHING",
            values,
        )
    conn.commit()


def insert_team_mapping(conn, tenant_id: int, match_id: str,
                        mapping_rows) -> None:
    """account_id -> team_id+kills+place+time_survived Lookup fuer die
    Lobby. Idempotent via ON CONFLICT DO UPDATE (im Gegensatz zu
    participants — Team-Mapping wird gerne nachtraeglich enriched)."""
    if not mapping_rows:
        return
    values = []
    for r in mapping_rows:
        if not r.get("account_id"):
            continue
        values.append((
            tenant_id, match_id, r["account_id"], r.get("team_id"),
            r.get("slot"), r.get("kills"), r.get("place"),
            r.get("time_survived"),
        ))
    if not values:
        return
    with conn.cursor() as cur:
        execute_values(
            cur,
            "INSERT INTO match_team_mapping "
            "(tenant_id, match_id, account_id, team_id, slot, kills, place, "
            "time_survived) VALUES %s "
            "ON CONFLICT (tenant_id, match_id, account_id) DO UPDATE SET "
            "team_id=EXCLUDED.team_id, slot=EXCLUDED.slot, "
            "kills=EXCLUDED.kills, "
            "place=EXCLUDED.place, time_survived=EXCLUDED.time_survived",
            values,
        )
    conn.commit()


def get_team_mapping_for_match(conn, tenant_id: int, match_id: str) -> dict:
    """{account_id: team_id} fuer gesamte Lobby des Matches."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT account_id, team_id FROM match_team_mapping "
            "WHERE tenant_id=%s AND match_id=%s",
            (tenant_id, match_id),
        )
        return {r["account_id"]: r["team_id"] for r in cur.fetchall()}


# ── Stats (Lifetime + Season) ───────────────────────────────────────────────

LIFETIME_COLS = (
    "rounds_played", "wins", "top10s", "win_rate", "top10_rate",
    "kills", "kd_ratio", "headshot_kills", "headshot_rate",
    "avg_damage", "longest_kill", "time_survived_sec",
    "assists", "damage_dealt", "dbnos", "revives", "team_kills",
    "losses",
)
SEASON_COLS = LIFETIME_COLS


def upsert_lifetime(conn, tenant_id: int, account_id: str, mode: str,
                    stats: dict) -> None:
    cols = ", ".join(LIFETIME_COLS)
    placeholders = ", ".join(["%s"] * len(LIFETIME_COLS))
    updates = ", ".join(f"{c}=EXCLUDED.{c}" for c in LIFETIME_COLS)
    values = [tenant_id, account_id, mode] + [stats.get(c) for c in LIFETIME_COLS] + [_now_iso()]
    with conn.cursor() as cur:
        cur.execute(f"""
            INSERT INTO player_lifetime
              (tenant_id, account_id, mode, {cols}, last_refreshed)
            VALUES (%s, %s, %s, {placeholders}, %s)
            ON CONFLICT (tenant_id, account_id, mode) DO UPDATE SET
              {updates}, last_refreshed=EXCLUDED.last_refreshed
        """, values)
    conn.commit()


def get_lifetime(conn, tenant_id: int, account_id: str, mode: str):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM player_lifetime "
            "WHERE tenant_id=%s AND account_id=%s AND mode=%s",
            (tenant_id, account_id, mode),
        )
        return cur.fetchone()


def upsert_season(conn, tenant_id: int, account_id: str, season_id: str,
                  mode: str, stats: dict) -> None:
    cols = ", ".join(SEASON_COLS)
    placeholders = ", ".join(["%s"] * len(SEASON_COLS))
    updates = ", ".join(f"{c}=EXCLUDED.{c}" for c in SEASON_COLS)
    values = [tenant_id, account_id, season_id, mode] + \
             [stats.get(c) for c in SEASON_COLS] + [_now_iso()]
    with conn.cursor() as cur:
        cur.execute(f"""
            INSERT INTO player_season
              (tenant_id, account_id, season_id, mode, {cols}, last_refreshed)
            VALUES (%s, %s, %s, %s, {placeholders}, %s)
            ON CONFLICT (tenant_id, account_id, season_id, mode) DO UPDATE SET
              {updates}, last_refreshed=EXCLUDED.last_refreshed
        """, values)
    conn.commit()


def get_season(conn, tenant_id: int, account_id: str, season_id: str,
               mode: str):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM player_season "
            "WHERE tenant_id=%s AND account_id=%s AND season_id=%s AND mode=%s",
            (tenant_id, account_id, season_id, mode),
        )
        return cur.fetchone()


def get_seasons_for_player(conn, tenant_id: int, account_id: str):
    """Distinct (season_id, last_refreshed) fuer einen Spieler."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT season_id, MAX(last_refreshed) AS last_refreshed "
            "FROM player_season WHERE tenant_id=%s AND account_id=%s "
            "GROUP BY season_id ORDER BY last_refreshed DESC",
            (tenant_id, account_id),
        )
        return cur.fetchall()


# ── Telemetry ───────────────────────────────────────────────────────────────


def insert_telemetry_events(conn, match_id: str, events: list) -> None:
    """Insert telemetry events for a match. Telemetry is GLOBAL (no
    tenant_id) — wenn ein anderer Tenant das Match schon gefetched hat,
    skippen wir komplett und sparen sowohl API-Call als auch Speicher."""
    if not events:
        return
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM telemetry_events WHERE match_id = %s LIMIT 1",
            (match_id,))
        if cur.fetchone():
            return  # schon da — anderer Tenant war schneller
    rows = [(
        match_id, e["event_type"], e.get("timestamp_ms"),
        e.get("actor_account"), e.get("target_account"),
        e.get("actor_x"), e.get("actor_y"), e.get("actor_z"),
        e.get("actor_health"),
        e.get("victim_x"), e.get("victim_y"),
        e.get("weapon"), e.get("distance"), e.get("damage"),
        e.get("payload_json", "{}"),
    ) for e in events]
    with conn.cursor() as cur:
        execute_values(
            cur,
            "INSERT INTO telemetry_events "
            "(match_id, event_type, timestamp_ms, actor_account, "
            "target_account, actor_x, actor_y, actor_z, actor_health, "
            "victim_x, victim_y, weapon, distance, damage, payload_json) "
            "VALUES %s",
            rows,
        )
    conn.commit()


def has_telemetry_for_match(conn, match_id: str) -> bool:
    """Check if telemetry already exists globally for this match.
    Used by fetch-jobs to short-circuit before hitting the PUBG API."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM telemetry_events WHERE match_id = %s LIMIT 1",
            (match_id,))
        return cur.fetchone() is not None


def get_telemetry_for_match(conn, match_id: str):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM telemetry_events WHERE match_id=%s",
            (match_id,),
        )
        return cur.fetchall()


def mark_telemetry_fetched(conn, tenant_id: int, match_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE matches SET telemetry_fetched=1 "
            "WHERE tenant_id=%s AND match_id=%s",
            (tenant_id, match_id),
        )
    conn.commit()


def get_matches_needing_telemetry(conn, tenant_id: int, limit: int = 5):
    """Matches die Telemetrie brauchen, innerhalb Retention-Fenster.

    Filter:
    - telemetry_url muss da sein
    - telemetry_fetched=0 ODER schema < CURRENT
    - played_at >= now - TELEMETRY_RETENTION_DAYS
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT match_id, telemetry_url FROM matches
            WHERE tenant_id = %s
              AND telemetry_url IS NOT NULL
              AND (telemetry_fetched = 0
                   OR COALESCE(telemetry_schema, 0) < %s)
              AND played_at >= TO_CHAR(
                    (NOW() AT TIME ZONE 'UTC') - (%s || ' days')::INTERVAL,
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            ORDER BY played_at DESC
            LIMIT %s
        """, (tenant_id, CURRENT_TELEMETRY_SCHEMA,
              TELEMETRY_RETENTION_DAYS, limit))
        return cur.fetchall()


def mark_telemetry_schema(conn, tenant_id: int, match_id: str,
                          schema_version: Optional[int] = None) -> None:
    """Setzt telemetry_schema-Marker nach erfolgreichem (Re-)Fetch.
    Default = aktuelle Schema-Version. Damit kein endloser Re-Fetch."""
    v = schema_version if schema_version is not None else CURRENT_TELEMETRY_SCHEMA
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE matches SET telemetry_schema=%s "
            "WHERE tenant_id=%s AND match_id=%s",
            (v, tenant_id, match_id),
        )
    conn.commit()
