"""DEPRECATED — SQLite-Adapter, wird nicht mehr genutzt seit PG-Migration (Spec 1).

Der laufende Code (serve.py, pubg/poller.py, pubg/endpoints.py, pubg/aggregations.py)
greift jetzt ueber `pubg/db_pg.py` auf PostgreSQL zu. Diese Datei bleibt vorerst
liegen, weil sie noch:
  - die Pre-Migration-Backup-Files (`data/pubg-history.db.*.bak`) lesbar haelt,
  - in `pubg/cli.py` und `pubg/fetch_job.py` referenziert wird
    (Helper-Skripte, separate Migration noetig).

Wird in einer spaeteren Aufraeumphase entfernt.
"""
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
    actor_z         REAL,
    actor_health    REAL,
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
    assists           INTEGER,
    damage_dealt      REAL,
    dbnos             INTEGER,
    revives           INTEGER,
    team_kills        INTEGER,
    losses            INTEGER,
    last_refreshed    TEXT,
    PRIMARY KEY (account_id, mode),
    FOREIGN KEY (account_id) REFERENCES players(account_id)
);

CREATE TABLE IF NOT EXISTS player_season (
    account_id        TEXT NOT NULL,
    season_id         TEXT NOT NULL,
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
    assists           INTEGER,
    damage_dealt      REAL,
    dbnos             INTEGER,
    revives           INTEGER,
    team_kills        INTEGER,
    losses            INTEGER,
    last_refreshed    TEXT,
    PRIMARY KEY (account_id, season_id, mode),
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

-- Session-Milestones / PUBG-Achievements: was im Match passierte und ein
-- "Achievement Unlocked"-Popup verdient. Pro (achievement_id, match_id)
-- nur einmal. Detected_at = wann der Poller's es erstmals erkannt hat,
-- displayed_at = wann's an einen Popup-Client geliefert wurde.
CREATE TABLE IF NOT EXISTS pubg_achievements_seen (
    achievement_id  TEXT NOT NULL,
    match_id        TEXT NOT NULL,
    label           TEXT,
    icon            TEXT,
    played_at       TEXT,
    detected_at     INTEGER NOT NULL,
    displayed_at    INTEGER,
    is_rare         INTEGER NOT NULL DEFAULT 0,
    -- 1 = Eintrag wurde von Anfang an als 'kein Popup' markiert.
    -- Unterscheidet sich von 'displayed_at IS NOT NULL', das z.B.
    -- auch beim Backfill auf jetzt gesetzt wird obwohl der Eintrag
    -- konzeptionell pop-faehig waere. Wird vom Live-Filter im
    -- Achievement-Browser benutzt um nur die wirklich popaufenden
    -- Eintraege zu zeigen.
    suppress_popup  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (achievement_id, match_id)
);
CREATE INDEX IF NOT EXISTS idx_pubg_ach_undisplayed
  ON pubg_achievements_seen (displayed_at);

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


CURRENT_TELEMETRY_SCHEMA = 5
# 1 = squad-only filter
# 2 = + Kill/Knock global + Position
# 3 = + Landing global + Position (für 'Teams in 300m Umkreis')
# 4 = + LogPlayerPosition events fuer Squad-Members + z/health auf Landing
#     (genauere Landing-Pin-Position; PUBG-LogParachuteLanding firet
#      manchmal mid-air, also brauchen wir Position-Events fuer Bodencheck)
# 5 = + ItemPickup / ObjectInteraction / ObjectDestroy (fuer PAYDAY-Stats:
#     Geldsack/Schmuck/Goldbarren-Counter, Fenster-Smash-Counter etc.)
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
        ("telemetry_events", "actor_z", "REAL"),
        ("telemetry_events", "actor_health", "REAL"),
        ("telemetry_events", "victim_x", "REAL"),
        ("telemetry_events", "victim_y", "REAL"),
        ("matches", "telemetry_schema", "INTEGER DEFAULT 0"),
        ("matches", "match_schema", "INTEGER DEFAULT 0"),
        # KSA-Felder für player_lifetime nachrüsten (assists/damage/dbnos
        # waren ursprünglich nicht aus dem Lifetime-Payload extrahiert).
        ("player_lifetime", "assists", "INTEGER"),
        ("player_lifetime", "damage_dealt", "REAL"),
        ("player_lifetime", "dbnos", "INTEGER"),
        ("player_lifetime", "revives", "INTEGER"),
        ("player_lifetime", "team_kills", "INTEGER"),
        ("player_lifetime", "losses", "INTEGER"),
        ("player_season", "losses", "INTEGER"),
        # Snapshot-Pcts: bei Insert berechnet, danach unveraendert.
        ("pubg_achievements_seen", "session_pct", "REAL"),
        ("pubg_achievements_seen", "match_pct",   "REAL"),
        # 0/1 ob der Eintrag urspruenglich als suppressed (kein Popup)
        # detected wurde. Nicht rueckwirkend ableitbar fuer alte Rows,
        # die behalten 0 — fuer den Live-Filter ist das unkritisch weil
        # Live ohnehin nur frische Eintraege ab Browser-Open zeigt.
        ("pubg_achievements_seen", "suppress_popup", "INTEGER NOT NULL DEFAULT 0"),
        # tenant_id fuer Multi-Tenant-Kompatibilitaet in Test-DBs (sqlite).
        # Postgres-Schema hat das nativ; sqlite-Test-DBs brauchen die Column
        # damit _active (und andere Endpoints) WHERE tenant_id=? filtern koennen.
        ("matches", "tenant_id", "INTEGER NOT NULL DEFAULT 1"),
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
                     ("time_survived", "INTEGER"), ("slot", "INTEGER")]:
        try:
            conn.execute(f"ALTER TABLE match_team_mapping ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass

    # Migration: z + health auf bestehende Landing-Events backfillen
    # aus payload_json (Schema 4 erwartet diese Spalten; ohne Refetch
    # bekommen historische Matches sonst NULL-Werte)
    try:
        import json as _json
        need_backfill = conn.execute("""
            SELECT id, payload_json FROM telemetry_events
            WHERE event_type='Landing' AND actor_z IS NULL
            LIMIT 50000
        """).fetchall()
        if need_backfill:
            updates = []
            for row in need_backfill:
                try:
                    d = _json.loads(row[1] or "{}")
                    ch = d.get("character") or {}
                    loc = ch.get("location") or {}
                    z = loc.get("z")
                    hp = ch.get("health")
                    if z is not None or hp is not None:
                        updates.append((z, hp, row[0]))
                except (ValueError, TypeError):
                    pass
            if updates:
                conn.executemany("""
                    UPDATE telemetry_events
                    SET actor_z = ?, actor_health = ?
                    WHERE id = ?
                """, updates)
                conn.commit()
    except sqlite3.OperationalError:
        pass

    # One-shot Cleanup: Legacy-LogPlayerKill-Duplikate aus telemetry_events
    # loeschen. PUBG feuert in manchen (Event-)Server-Versionen sowohl
    # LogPlayerKill als auch LogPlayerKillV2 fuers gleiche Kill. Wir
    # behalten ab jetzt nur V2 (siehe telemetry.py::_normalize). Historische
    # DBs muessen die schon-doppelten Eintraege wegputzen.
    try:
        cur = conn.execute("""
            DELETE FROM telemetry_events
            WHERE event_type='Kill'
              AND json_extract(payload_json, '$._T') = 'LogPlayerKill'
        """)
        if cur.rowcount > 0:
            print(f"[migrate] LogPlayerKill-Duplikate entfernt: {cur.rowcount}")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # Migration: alte beast_chicken_<matchid>-IDs auf 'beast_chicken'
    # normalisieren. Davor hatte jeder Beast-Chicken eine kontext-
    # spezifische ID die Lookups in PUBG_ICON_URLS / _DESCRIPTIONS
    # umgangen hat. Beim Update gleicher PK kann's zu Conflicts kommen
    # — INSERT OR REPLACE waere overkill; einfacher: erst die normalen
    # Eintraege erkennen (zur Vermeidung von Konflikten beim Update),
    # dann die alten umbenennen und Duplikate ignorieren.
    try:
        conn.execute("""
            DELETE FROM pubg_achievements_seen
            WHERE achievement_id LIKE 'beast_chicken_%'
              AND EXISTS (
                SELECT 1 FROM pubg_achievements_seen p2
                WHERE p2.achievement_id = 'beast_chicken'
                  AND p2.match_id = pubg_achievements_seen.match_id
              )
        """)
        conn.execute("""
            UPDATE pubg_achievements_seen
            SET achievement_id = 'beast_chicken'
            WHERE achievement_id LIKE 'beast_chicken_%'
        """)
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
    # is_self via MAX(existing, new) — verhindert dass ein Lobby-Upsert
    # (is_self=False) den Self-Marker eines bestehenden Eintrags
    # ueberschreibt. Once-self-always-self.
    conn.execute("""
        INSERT INTO players(account_id, name, platform, is_self, first_seen_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
            name = excluded.name,
            platform = excluded.platform,
            is_self = MAX(players.is_self, excluded.is_self)
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
    "assists", "damage_dealt", "dbnos", "revives", "team_kills",
    "losses",
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


# Season-Stats: gleiche Shape wie player_lifetime, nur scoped auf eine
# konkrete season_id (vom PUBG-API-Endpoint /shards/{platform}/seasons).
SEASON_COLS = LIFETIME_COLS


def upsert_season(conn, account_id: str, season_id: str, mode: str,
                  stats: dict) -> None:
    cols = ", ".join(SEASON_COLS)
    placeholders = ", ".join(["?"] * len(SEASON_COLS))
    updates = ", ".join(f"{c}=excluded.{c}" for c in SEASON_COLS)
    values = [account_id, season_id, mode] + [stats.get(c) for c in SEASON_COLS]
    conn.execute(f"""
        INSERT INTO player_season(account_id, season_id, mode, {cols},
                                   last_refreshed)
        VALUES (?, ?, ?, {placeholders}, ?)
        ON CONFLICT(account_id, season_id, mode) DO UPDATE SET
            {updates}, last_refreshed=excluded.last_refreshed
    """, values + [_now_iso()])
    conn.commit()


def get_season(conn, account_id: str, season_id: str, mode: str):
    return conn.execute(
        "SELECT * FROM player_season "
        "WHERE account_id=? AND season_id=? AND mode=?",
        (account_id, season_id, mode),
    ).fetchone()


def get_seasons_for_player(conn, account_id: str):
    """Liefert alle gespeicherten (season_id, last_refreshed) für einen
    Spieler — nützlich für UI-Auswahl ältere Seasons (sobald wir mehrere
    speichern)."""
    return conn.execute(
        "SELECT DISTINCT season_id, MAX(last_refreshed) AS last_refreshed "
        "FROM player_season WHERE account_id=? "
        "GROUP BY season_id ORDER BY last_refreshed DESC",
        (account_id,),
    ).fetchall()


def insert_telemetry_events(conn, match_id: str, events: list) -> None:
    rows = [(match_id, e["event_type"], e.get("timestamp_ms"),
             e.get("actor_account"), e.get("target_account"),
             e.get("actor_x"), e.get("actor_y"), e.get("actor_z"),
             e.get("actor_health"),
             e.get("victim_x"), e.get("victim_y"),
             e.get("weapon"), e.get("distance"), e.get("damage"),
             e.get("payload_json", "{}"))
            for e in events]
    conn.executemany("""
        INSERT INTO telemetry_events
        (match_id, event_type, timestamp_ms, actor_account, target_account,
         actor_x, actor_y, actor_z, actor_health, victim_x, victim_y,
         weapon, distance, damage, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)
    conn.commit()


def get_telemetry_for_match(conn, match_id: str):
    return conn.execute(
        "SELECT * FROM telemetry_events WHERE match_id=?", (match_id,)
    ).fetchall()


def mark_telemetry_fetched(conn, match_id: str) -> None:
    conn.execute("UPDATE matches SET telemetry_fetched=1 WHERE match_id=?", (match_id,))
    conn.commit()


TELEMETRY_RETENTION_DAYS = 16   # PUBG-CDN haelt ~14d; 2d Puffer

def get_matches_needing_telemetry(conn, limit: int = 5):
    """Liefert matches die Telemetry brauchen — entweder noch nie gefetched
    ODER mit veralteter Schema-Version (fuer First-Fight-Cluster noetig).

    Filter:
    - telemetry_url muss da sein
    - telemetry_fetched=0 ODER schema < CURRENT
    - played_at >= now - TELEMETRY_RETENTION_DAYS — Matches die aelter
      sind koennen vom PUBG-CDN nicht mehr abgerufen werden (Retention
      ~14d). Wir versuchen es gar nicht erst — sonst sammelt sich
      pendings unbegrenzt an und der Poller-Thread laeuft im Kreis.
      Bei 404 vom CDN markieren wir auch innerhalb des Fensters den
      Match als abandoned (siehe poller.py::_process_one_telemetry)."""
    # played_at ist im ISO-Format 'YYYY-MM-DDTHH:MM:SSZ'. strftime mit
    # '%Y-%m-%dT%H:%M:%SZ' liefert dasselbe Format → String-Vergleich
    # funktioniert lexikografisch.
    return conn.execute("""
        SELECT m.match_id, m.telemetry_url FROM matches m
        WHERE m.telemetry_url IS NOT NULL
          AND (
            m.telemetry_fetched = 0
            OR COALESCE(m.telemetry_schema, 0) < ?
          )
          AND m.played_at >= strftime('%Y-%m-%dT%H:%M:%SZ',
                                      datetime('now', ?))
        ORDER BY m.played_at DESC LIMIT ?
    """, (CURRENT_TELEMETRY_SCHEMA,
          f"-{TELEMETRY_RETENTION_DAYS} days", limit)).fetchall()


def mark_telemetry_schema(conn, match_id: str, schema_version: int = None) -> None:
    """Setzt telemetry_schema-Marker nach erfolgreichem (Re-)Fetch.
    Default = aktuelle Schema-Version. Damit kein endloser Re-Fetch."""
    if schema_version is None:
        schema_version = CURRENT_TELEMETRY_SCHEMA
    conn.execute("UPDATE matches SET telemetry_schema=? WHERE match_id=?",
                 (schema_version, match_id))
    conn.commit()
