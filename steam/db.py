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
  global_pct_json TEXT,                          -- {api_name: percent_float}
  global_pct_cached_at INTEGER,                  -- Unix epoch
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
  img_icon_url TEXT,                    -- 32x32 mini icon (volle URL)
  img_logo_url TEXT,                    -- 184x69 banner (volle URL)
  playtime_forever_min INTEGER NOT NULL DEFAULT 0,
  playtime_2weeks_min INTEGER NOT NULL DEFAULT 0,
  last_played_at INTEGER,               -- Unix epoch; nur Poller (mark_played_now) — trusted
  steam_last_played INTEGER,            -- Unix epoch; Steam's rtime_last_played — unreliable aber breit
  last_synced INTEGER NOT NULL,
  PRIMARY KEY (steam_id, app_id)
);

-- Per-Sprache Schema-Cache (display_name + description in jeweiliger Lang).
-- Wird lazy gefuellt wenn der achievement-browser eine andere Sprache
-- als die in steam_app_schema gespeicherte abfragt.
CREATE TABLE IF NOT EXISTS steam_app_schema_lang (
  app_id INTEGER NOT NULL,
  lang TEXT NOT NULL,
  schema_json TEXT,                    -- {api_name: {displayName, description}}
  cached_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, lang)
);

CREATE TABLE IF NOT EXISTS steam_app_details (
  app_id INTEGER PRIMARY KEY,
  header_image TEXT,
  short_description TEXT,
  is_coop INTEGER NOT NULL DEFAULT 0,        -- categories 9/36/38
  is_multiplayer INTEGER NOT NULL DEFAULT 0, -- categories 1/27/36/38
  category_ids TEXT,                          -- comma-list
  genre_names TEXT,                           -- comma-list
  cached_at INTEGER NOT NULL
);
"""

# Steam-Storefront-Category-IDs (siehe SteamDB)
COOP_CATEGORY_IDS        = {9, 36, 38}        # Co-op / Online Co-op / Split-Screen
MULTIPLAYER_CATEGORY_IDS = {1, 27, 36, 38}    # Multi-player / Cross-Platform-MP / ...


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    # In-place Migrations (idempotent): ADD COLUMN schlaegt fehl wenn
    # Spalte schon da ist -> abfangen.
    for stmt in (
        "ALTER TABLE steam_owned_games ADD COLUMN img_logo_url TEXT",
        "ALTER TABLE steam_owned_games ADD COLUMN last_played_at INTEGER",
        "ALTER TABLE steam_owned_games ADD COLUMN steam_last_played INTEGER",
        "ALTER TABLE steam_app_schema ADD COLUMN global_pct_json TEXT",
        "ALTER TABLE steam_app_schema "
            "ADD COLUMN global_pct_cached_at INTEGER",
    ):
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass
    # One-shot cleanup beim Server-Start: alle 'last_played_at'-Werte
    # nullen fuer Spiele die Steam laut playtime_2weeks=0 nicht in den
    # letzten 14 Tagen gespielt hat. Steam's 'rtime_last_played' war
    # frueher die Quelle fuer last_played_at, aber unzuverlaessig
    # (zaehlt Library-Browse-Trigger, liefert frische ts fuer alte
    # Spiele - siehe Bug 2026-05-11 mit Arma 3). Jetzt: nur Poller's
    # mark_played_now darf last_played_at setzen.
    conn.execute("""
        UPDATE steam_owned_games
        SET last_played_at = NULL
        WHERE last_played_at IS NOT NULL
          AND playtime_2weeks_min = 0
    """)


def _steam_image_url(app_id: int, image_hash: str) -> str:
    """Steam GetOwnedGames liefert image-Hashes ohne CDN-URL. Volle URL
    bauen — funktioniert fuer img_icon_url + img_logo_url gleichermassen."""
    if not image_hash or not app_id:
        return None
    return (f"https://media.steampowered.com/steamcommunity/public/"
            f"images/apps/{app_id}/{image_hash}.jpg")


# ── Owned Games ────────────────────────────────────────────────────────────
def upsert_owned_games(conn, steam_id: str, games: list) -> None:
    """Schreibt Library-Daten. Zwei Recency-Spuren bewusst getrennt:
      1. `last_played_at` — NUR vom Poller (mark_played_now), trusted
         minute-genau wenn `gameid` aktiv ist.
      2. `steam_last_played` — Steam's `rtime_last_played`, breiter
         aber unzuverlaessig (zaehlt auch Library-Browse-Trigger).
         Brauchbar fuer GROBE Filter wie 'in den letzten 2 Jahren
         angefasst' (wanna-play-Pool).
    """
    for g in games:
        appid = g.get("appid")
        icon_url = _steam_image_url(appid, g.get("img_icon_url"))
        logo_url = _steam_image_url(appid, g.get("img_logo_url"))
        steam_last = g.get("rtime_last_played") or None
        conn.execute("""
            INSERT INTO steam_owned_games
              (steam_id, app_id, name, img_icon_url, img_logo_url,
               playtime_forever_min, playtime_2weeks_min,
               last_played_at, steam_last_played, last_synced)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, strftime('%s','now'))
            ON CONFLICT(steam_id, app_id) DO UPDATE SET
              name=excluded.name,
              img_icon_url=excluded.img_icon_url,
              img_logo_url=excluded.img_logo_url,
              playtime_forever_min=excluded.playtime_forever_min,
              playtime_2weeks_min=excluded.playtime_2weeks_min,
              steam_last_played=COALESCE(excluded.steam_last_played,
                                          steam_last_played),
              last_synced=excluded.last_synced
        """, (
            steam_id, appid, g.get("name"), icon_url, logo_url,
            g.get("playtime_forever", 0), g.get("playtime_2weeks", 0),
            steam_last,
        ))


def mark_played_now(conn, steam_id: str, app_id: int) -> None:
    """Setzt last_played_at = now für den gerade gespielten Eintrag.
    Wird vom Poller (Layer-1) bei aktivem currentAppId getriggert —
    so haben wir IMMER aktuelle Recency-Daten, auch wenn Steam selbst
    rtime_last_played nicht liefert."""
    conn.execute("""
        UPDATE steam_owned_games
        SET last_played_at = strftime('%s','now')
        WHERE steam_id = ? AND app_id = ?
    """, (steam_id, app_id))


def get_owned_game(conn, steam_id: str, app_id: int):
    return conn.execute(
        "SELECT * FROM steam_owned_games WHERE steam_id=? AND app_id=?",
        (steam_id, app_id),
    ).fetchone()


def get_owned_games_filtered(conn, steam_id: str,
                              filter_kind: str = "all",
                              sort_by: str = "playtime",
                              min_playtime_min: int = 0,
                              played_since_days: int = 0,
                              limit: int = 100) -> list:
    """Joins steam_owned_games + steam_app_details, filtert nach
    Coop / Multiplayer / Alle, sortiert + limitiert.

    filter_kind:        'all' | 'coop' | 'multiplayer'
    sort_by:            'playtime' (forever DESC) | 'recent' (2weeks DESC) |
                        'name' (alphabetisch) | 'random'
    min_playtime_min:   playtime_forever >= N min
    played_since_days:  rtime_last_played >= now - N*86400 — fuer
                        wanna-play (Steam's grobes 'angefasst').
    """
    where = ["og.steam_id = ?"]
    params = [steam_id]
    if filter_kind == "coop":
        where.append("ad.is_coop = 1")
    elif filter_kind == "multiplayer":
        where.append("ad.is_multiplayer = 1")
    if min_playtime_min > 0:
        where.append("og.playtime_forever_min >= ?")
        params.append(min_playtime_min)
    if played_since_days > 0:
        # Entweder Steam's grober Wert (kann Library-Browse zaehlen)
        # ODER Poller's trusted Wert. Fuer 'wanna play' liberal.
        where.append(
            "(og.steam_last_played >= strftime('%s','now') - ? "
            " OR og.last_played_at  >= strftime('%s','now') - ?)")
        params.append(played_since_days * 86400)
        params.append(played_since_days * 86400)
    # 'recent' = nur Spiele die Steam selbst als 'played in last 2 weeks'
    # ausweist (playtime_2weeks_min > 0). Das ist die einzig
    # zuverlaessige Quelle — Steam's `rtime_last_played` zaehlt auch
    # Library-Browse-Trigger und ist daher fuer jahrealte Spiele
    # (Arma 3 etc.) faelschlich aktuell. Layer-1 `mark_played_now`
    # bleibt fuer das aktuell laufende Spiel, das aber via now-playing
    # widget ohnehin separat angezeigt wird.
    if sort_by == "recent":
        where.append("og.playtime_2weeks_min > 0")

    order = {
        "playtime": "og.playtime_forever_min DESC",
        "recent":   "og.playtime_2weeks_min DESC",
        "name":     "og.name COLLATE NOCASE ASC",
        "random":   "RANDOM()",
    }.get(sort_by, "og.playtime_forever_min DESC")

    sql = f"""
        SELECT og.app_id, og.name, og.img_icon_url, og.img_logo_url,
               og.playtime_forever_min, og.playtime_2weeks_min,
               og.last_played_at, og.steam_last_played,
               ad.header_image, ad.short_description,
               ad.is_coop, ad.is_multiplayer, ad.category_ids
        FROM steam_owned_games og
        LEFT JOIN steam_app_details ad ON ad.app_id = og.app_id
        WHERE {' AND '.join(where)}
        ORDER BY {order}
        LIMIT ?
    """
    params.append(limit)
    return conn.execute(sql, params).fetchall()


# ── App Details (Storefront-Cache) ────────────────────────────────────────
def upsert_app_details(conn, app_id: int,
                       header_image: str = None,
                       short_description: str = None,
                       is_coop: bool = False,
                       is_multiplayer: bool = False,
                       category_ids: str = None,
                       genre_names: str = None) -> None:
    # COALESCE-Preserve: wenn Storefront ein Game spaeter nicht mehr
    # ausliefert (z.B. UT2004 — delisted), keine bestehenden Daten mit
    # NULL ueberschreiben. Neue Werte gewinnen wenn vorhanden.
    conn.execute("""
        INSERT INTO steam_app_details
          (app_id, header_image, short_description,
           is_coop, is_multiplayer, category_ids, genre_names, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
        ON CONFLICT(app_id) DO UPDATE SET
          header_image=COALESCE(excluded.header_image, header_image),
          short_description=COALESCE(excluded.short_description, short_description),
          is_coop=excluded.is_coop,
          is_multiplayer=excluded.is_multiplayer,
          category_ids=COALESCE(excluded.category_ids, category_ids),
          genre_names=COALESCE(excluded.genre_names, genre_names),
          cached_at=excluded.cached_at
    """, (app_id, header_image, short_description,
          int(bool(is_coop)), int(bool(is_multiplayer)),
          category_ids, genre_names))


def get_app_details_row(conn, app_id: int):
    return conn.execute(
        "SELECT * FROM steam_app_details WHERE app_id=?", (app_id,)
    ).fetchone()


def find_app_needing_details_sync(conn, steam_id: str,
                                    max_age_s: int) -> int:
    """Liefert genau eine app_id die einen Storefront-Refresh braucht
    (nie gefetched ODER aelter als max_age_s).
    Sortiert nach playtime_forever DESC — meist gespielte zuerst."""
    row = conn.execute("""
        SELECT og.app_id
        FROM steam_owned_games og
        LEFT JOIN steam_app_details ad ON ad.app_id = og.app_id
        WHERE og.steam_id = ?
          AND (ad.cached_at IS NULL OR ad.cached_at < strftime('%s','now') - ?)
        ORDER BY og.playtime_forever_min DESC, og.app_id ASC
        LIMIT 1
    """, (steam_id, max_age_s)).fetchone()
    return row["app_id"] if row else None


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


def get_app_schema_lang(conn, app_id: int, lang: str):
    """Sprach-spezifisches Schema-Lookup. Returns None wenn nie gefetched."""
    return conn.execute("""
        SELECT * FROM steam_app_schema_lang
        WHERE app_id=? AND lang=?
    """, (app_id, lang)).fetchone()


def upsert_app_schema_lang(conn, app_id: int, lang: str,
                            schema_json: str) -> None:
    """Cached pro Sprache. Wird vom achievements-list-Endpoint lazy
    befuellt wenn der User die Browser-Sprache umschaltet."""
    conn.execute("""
        INSERT INTO steam_app_schema_lang
          (app_id, lang, schema_json, cached_at)
        VALUES (?, ?, ?, strftime('%s','now'))
        ON CONFLICT(app_id, lang) DO UPDATE SET
          schema_json=excluded.schema_json,
          cached_at=excluded.cached_at
    """, (app_id, lang, schema_json))


def upsert_global_achievement_pct(conn, app_id: int,
                                    pct_json: str) -> None:
    """Schreibt die {api_name: percent}-Map ins schema-Row. Falls Row
    noch nicht existiert, anlegen mit minimalen Defaults — wird vom
    naechsten _ensure_schema-Call mit Game-Name/Count gefuellt."""
    conn.execute("""
        INSERT INTO steam_app_schema
          (app_id, game_name, achievement_count, schema_json,
           global_pct_json, global_pct_cached_at, cached_at)
        VALUES (?, NULL, 0, NULL, ?,
                strftime('%s','now'), strftime('%s','now'))
        ON CONFLICT(app_id) DO UPDATE SET
          global_pct_json=excluded.global_pct_json,
          global_pct_cached_at=excluded.global_pct_cached_at
    """, (app_id, pct_json))


def get_global_achievement_pct(conn, app_id: int):
    """Returns (pct_json_str, cached_at) oder (None, None)."""
    row = conn.execute("""
        SELECT global_pct_json, global_pct_cached_at
        FROM steam_app_schema WHERE app_id=?
    """, (app_id,)).fetchone()
    if not row:
        return (None, None)
    return (row["global_pct_json"], row["global_pct_cached_at"])


# ── Achievement Feed (latest unlocks across all games) ─────────────────────
def get_achievement_feed(conn, steam_id: str, limit: int = 20,
                          since_ts: int = None) -> list:
    """Letzte N Unlocks ueber alle Games — sortiert nach unlocked_at DESC.
    Liefert IMMER aktuelle Daten, unabhaengig vom displayed_at-Flag.
    since_ts: nur Unlocks mit unlocked_at >= since_ts (Default None = alle).
    Fuer den Feed-Ticker (kein Popup-Verhalten)."""
    sql = """
        SELECT app_id, achievement_api_name, unlocked_at,
               display_name, description, icon_url
        FROM steam_achievements_seen
        WHERE steam_id=? AND app_id >= 0
    """
    params = [steam_id]
    if since_ts is not None:
        sql += " AND unlocked_at >= ?"
        params.append(since_ts)
    sql += " ORDER BY unlocked_at DESC LIMIT ?"
    params.append(limit)
    return conn.execute(sql, params).fetchall()


# ── Achievement Unlocks ────────────────────────────────────────────────────
def insert_unlock_if_new(conn, steam_id: str, app_id: int,
                          api_name: str, unlocked_at: int,
                          display_name: str = None,
                          description: str = None,
                          icon_url: str = None,
                          suppress_popup: bool = False) -> bool:
    """Returns True wenn der Unlock neu war (= im Stream als 'fresh' anzeigen).
    suppress_popup=True markiert den Eintrag direkt als displayed —
    speichert ihn fuer den Feed, aber laesst das Popup unausgeloest.
    Genutzt beim ersten Poll eines Games damit nicht alle alten
    Unlocks auf einmal hochpoppen."""
    displayed_at = None
    if suppress_popup:
        import time as _t
        displayed_at = int(_t.time())
    cur = conn.execute("""
        INSERT INTO steam_achievements_seen
          (steam_id, app_id, achievement_api_name, unlocked_at,
           display_name, description, icon_url, displayed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(steam_id, app_id, achievement_api_name) DO NOTHING
    """, (steam_id, app_id, api_name, unlocked_at,
          display_name, description, icon_url, displayed_at))
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
