"""
Steam-DB Schema und Helper.
Separate SQLite-File (data/steam-history.db), unabhängig von pubg-history.db
— Steam-Modul kann separat aktiviert/deaktiviert werden.
"""
import sqlite3


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS steam_achievements_seen (
  steam_id TEXT NOT NULL,
  app_id INTEGER NOT NULL,
  achievement_api_name TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,        -- Unix epoch (Steam-unlocktime)
  display_name TEXT,                    -- aus Schema-Cache
  description TEXT,
  icon_url TEXT,
  displayed_at INTEGER,                 -- NULL wenn noch nicht im Stream gezeigt
  PRIMARY KEY (steam_id, app_id, achievement_api_name)
);

CREATE INDEX IF NOT EXISTS idx_steam_ach_undisplayed
  ON steam_achievements_seen (steam_id, displayed_at);

CREATE TABLE IF NOT EXISTS steam_app_schema (
  app_id INTEGER PRIMARY KEY,
  game_name TEXT,
  achievement_count INTEGER NOT NULL DEFAULT 0,  -- total Achievements im Game
  schema_json TEXT,                              -- volles Schema als JSON
  cached_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steam_app_progress (
  steam_id TEXT NOT NULL,
  app_id INTEGER NOT NULL,
  unlocked_count INTEGER NOT NULL DEFAULT 0,
  last_checked INTEGER NOT NULL,
  PRIMARY KEY (steam_id, app_id)
);

CREATE TABLE IF NOT EXISTS steam_owned_games (
  steam_id TEXT NOT NULL,
  app_id INTEGER NOT NULL,
  name TEXT,
  img_icon_url TEXT,                    -- 184x69 banner from Steam
  playtime_forever_min INTEGER NOT NULL DEFAULT 0,
  playtime_2weeks_min INTEGER NOT NULL DEFAULT 0,
  last_synced INTEGER NOT NULL,
  PRIMARY KEY (steam_id, app_id)
);
"""


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)


# ── Owned Games ────────────────────────────────────────────────────────────
def upsert_owned_games(conn, steam_id: str, games: list) -> None:
    for g in games:
        conn.execute("""
            INSERT INTO steam_owned_games
              (steam_id, app_id, name, img_icon_url,
               playtime_forever_min, playtime_2weeks_min, last_synced)
            VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))
            ON CONFLICT(steam_id, app_id) DO UPDATE SET
              name=excluded.name,
              img_icon_url=excluded.img_icon_url,
              playtime_forever_min=excluded.playtime_forever_min,
              playtime_2weeks_min=excluded.playtime_2weeks_min,
              last_synced=excluded.last_synced
        """, (
            steam_id, g.get("appid"), g.get("name"), g.get("img_icon_url"),
            g.get("playtime_forever", 0), g.get("playtime_2weeks", 0),
        ))


def get_owned_game(conn, steam_id: str, app_id: int):
    return conn.execute(
        "SELECT * FROM steam_owned_games WHERE steam_id=? AND app_id=?",
        (steam_id, app_id),
    ).fetchone()


# ── App Schema ─────────────────────────────────────────────────────────────
def upsert_app_schema(conn, app_id: int, game_name: str,
                       achievement_count: int, schema_json: str) -> None:
    conn.execute("""
        INSERT INTO steam_app_schema
          (app_id, game_name, achievement_count, schema_json, cached_at)
        VALUES (?, ?, ?, ?, strftime('%s','now'))
        ON CONFLICT(app_id) DO UPDATE SET
          game_name=excluded.game_name,
          achievement_count=excluded.achievement_count,
          schema_json=excluded.schema_json,
          cached_at=excluded.cached_at
    """, (app_id, game_name, achievement_count, schema_json))


def get_app_schema(conn, app_id: int):
    return conn.execute(
        "SELECT * FROM steam_app_schema WHERE app_id=?", (app_id,)
    ).fetchone()


# ── Achievement Unlocks ────────────────────────────────────────────────────
def insert_unlock_if_new(conn, steam_id: str, app_id: int,
                          api_name: str, unlocked_at: int,
                          display_name: str = None,
                          description: str = None,
                          icon_url: str = None) -> bool:
    """Returns True wenn der Unlock neu war (= im Stream als 'fresh' anzeigen)."""
    cur = conn.execute("""
        INSERT INTO steam_achievements_seen
          (steam_id, app_id, achievement_api_name, unlocked_at,
           display_name, description, icon_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(steam_id, app_id, achievement_api_name) DO NOTHING
    """, (steam_id, app_id, api_name, unlocked_at,
          display_name, description, icon_url))
    return cur.rowcount > 0


def get_undisplayed_unlocks(conn, steam_id: str, since_ts: int = None) -> list:
    sql = """
        SELECT app_id, achievement_api_name, unlocked_at,
               display_name, description, icon_url
        FROM steam_achievements_seen
        WHERE steam_id=? AND displayed_at IS NULL
    """
    params = [steam_id]
    if since_ts is not None:
        sql += " AND unlocked_at >= ?"
        params.append(since_ts)
    sql += " ORDER BY unlocked_at ASC"
    return conn.execute(sql, params).fetchall()


def mark_displayed(conn, steam_id: str, app_id: int, api_name: str) -> None:
    conn.execute("""
        UPDATE steam_achievements_seen
        SET displayed_at = strftime('%s','now')
        WHERE steam_id=? AND app_id=? AND achievement_api_name=?
    """, (steam_id, app_id, api_name))


def mark_all_displayed(conn, steam_id: str) -> int:
    cur = conn.execute("""
        UPDATE steam_achievements_seen
        SET displayed_at = strftime('%s','now')
        WHERE steam_id=? AND displayed_at IS NULL
    """, (steam_id,))
    return cur.rowcount


# ── Progress (unlocked / total) ────────────────────────────────────────────
def upsert_progress(conn, steam_id: str, app_id: int,
                     unlocked_count: int) -> None:
    conn.execute("""
        INSERT INTO steam_app_progress
          (steam_id, app_id, unlocked_count, last_checked)
        VALUES (?, ?, ?, strftime('%s','now'))
        ON CONFLICT(steam_id, app_id) DO UPDATE SET
          unlocked_count=excluded.unlocked_count,
          last_checked=excluded.last_checked
    """, (steam_id, app_id, unlocked_count))


def get_progress(conn, steam_id: str, app_id: int):
    return conn.execute("""
        SELECT * FROM steam_app_progress
        WHERE steam_id=? AND app_id=?
    """, (steam_id, app_id)).fetchone()
