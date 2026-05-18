"""TeamSpeak DB-Schema + DAO.

Eigene SQLite-DB unter data/teamspeak.db. Tabellen:

  teamspeak_users
    ts_uid       TEXT PK     (Client-UID aus TS3)
    last_nick    TEXT        (zuletzt gesehener Nickname)
    steam_id     TEXT NULL   (verknuepfte SteamID64)
    custom_name  TEXT NULL   (frei eintragbarer Anzeigename)
    display_source TEXT      ('ts' | 'steam' | 'custom'; default 'ts')
    speaking_icon TEXT NULL  (URL/Pfad fuer 'spricht'-Icon — override)
    silent_icon   TEXT NULL  (URL/Pfad fuer 'still'-Icon — override)
    show_in_widget INTEGER DEFAULT 1
    updated_at   TEXT

  teamspeak_encounters
    streamer_uid TEXT
    mate_uid     TEXT
    server_uid   TEXT
    count        INTEGER DEFAULT 0
    last_seen    TEXT
    PK (streamer_uid, mate_uid, server_uid)

  teamspeak_afk_channels
    server_uid   TEXT
    channel_id   TEXT
    channel_name TEXT
    PK (server_uid, channel_id)
"""
import datetime
import os
import sqlite3


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS teamspeak_users (
    ts_uid           TEXT PRIMARY KEY,
    last_nick        TEXT,
    steam_id         TEXT,
    custom_name      TEXT,
    display_source   TEXT NOT NULL DEFAULT 'ts',
    speaking_icon    TEXT,
    silent_icon      TEXT,
    show_in_widget   INTEGER NOT NULL DEFAULT 1,
    is_friend        INTEGER NOT NULL DEFAULT 0,
    is_blocked       INTEGER NOT NULL DEFAULT 0,
    notes            TEXT,
    updated_at       TEXT
);

CREATE TABLE IF NOT EXISTS teamspeak_encounters (
    streamer_uid TEXT NOT NULL,
    mate_uid     TEXT NOT NULL,
    server_uid   TEXT NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    talk_seconds INTEGER NOT NULL DEFAULT 0,
    last_seen    TEXT,
    PRIMARY KEY (streamer_uid, mate_uid, server_uid)
);
CREATE INDEX IF NOT EXISTS idx_ts_enc_mate
    ON teamspeak_encounters(mate_uid);

CREATE TABLE IF NOT EXISTS teamspeak_afk_channels (
    server_uid   TEXT NOT NULL,
    channel_id   TEXT NOT NULL,
    channel_name TEXT,
    PRIMARY KEY (server_uid, channel_id)
);
"""


def connect(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # check_same_thread=False + WAL + timeout=5s ist multi-thread-safe.
    # SQLite serialisiert intern, kein Python-Lock noetig.
    conn = sqlite3.connect(path, check_same_thread=False, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_schema(conn):
    conn.executescript(SCHEMA_SQL)
    # Migrate existing DBs — neue Spalten dazu (IF NOT EXISTS verfuegbar
    # ab SQLite 3.35, sonst try/except).
    for col, ddl in [
        ("is_friend",  "INTEGER NOT NULL DEFAULT 0"),
        ("is_blocked", "INTEGER NOT NULL DEFAULT 0"),
        ("notes",      "TEXT"),
    ]:
        try:
            conn.execute(f"ALTER TABLE teamspeak_users ADD COLUMN {col} {ddl}")
        except Exception:
            pass
    try:
        conn.execute("ALTER TABLE teamspeak_encounters "
                     "ADD COLUMN talk_seconds INTEGER NOT NULL DEFAULT 0")
    except Exception:
        pass
    conn.commit()


# ── User-Mappings ─────────────────────────────────────────────────────
def upsert_user_nick(conn, ts_uid, nick):
    """Wird laufend aufgerufen wenn wir einen Client sehen — speichert
    nur den last_nick. Andere Mapping-Felder bleiben."""
    if not ts_uid or not nick:
        return
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute("""
        INSERT INTO teamspeak_users (ts_uid, last_nick, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(ts_uid) DO UPDATE SET
            last_nick  = excluded.last_nick,
            updated_at = excluded.updated_at
    """, (ts_uid, nick, now))
    conn.commit()


def get_all_users(conn):
    return [dict(r) for r in conn.execute(
        "SELECT * FROM teamspeak_users ORDER BY last_nick").fetchall()]


def get_user(conn, ts_uid):
    r = conn.execute(
        "SELECT * FROM teamspeak_users WHERE ts_uid = ?",
        (ts_uid,)).fetchone()
    return dict(r) if r else None


def save_user_mapping(conn, ts_uid, **fields):
    """Setzt steam_id, custom_name, display_source, speaking_icon,
    silent_icon, show_in_widget. Akzeptiert ts_uid auch fuer einen
    neuen Eintrag (last_nick wird auf '' gesetzt wenn noch nicht da)."""
    allowed = {"steam_id", "custom_name", "display_source",
               "speaking_icon", "silent_icon", "show_in_widget",
               "last_nick", "is_friend", "is_blocked", "notes"}
    fields = {k: v for k, v in fields.items() if k in allowed}
    if not fields:
        return
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    # Erst INSERT mit Defaults sicherstellen
    conn.execute("""
        INSERT OR IGNORE INTO teamspeak_users
            (ts_uid, last_nick, display_source, show_in_widget, updated_at)
        VALUES (?, '', 'ts', 1, ?)
    """, (ts_uid, now))
    # Mutual-Exclusion: is_friend und is_blocked koennen nicht beide
    # gleichzeitig aktiv sein.
    if fields.get("is_friend") == 1:
        fields["is_blocked"] = 0
    elif fields.get("is_blocked") == 1:
        fields["is_friend"] = 0
    set_parts = [f"{k} = ?" for k in fields.keys()]
    set_parts.append("updated_at = ?")
    values = list(fields.values()) + [now, ts_uid]
    conn.execute(
        f"UPDATE teamspeak_users SET {', '.join(set_parts)} WHERE ts_uid = ?",
        values)
    conn.commit()


# ── Encounter-Counter ─────────────────────────────────────────────────
def bump_encounter(conn, streamer_uid, mate_uid, server_uid):
    if not streamer_uid or not mate_uid or not server_uid:
        return
    if streamer_uid == mate_uid:
        return
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute("""
        INSERT INTO teamspeak_encounters
            (streamer_uid, mate_uid, server_uid, count, last_seen)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(streamer_uid, mate_uid, server_uid) DO UPDATE SET
            count     = teamspeak_encounters.count + 1,
            last_seen = excluded.last_seen
    """, (streamer_uid, mate_uid, server_uid, now))
    conn.commit()


def get_encounters(conn, streamer_uid):
    """Liefert {mate_uid, total, talk_seconds, last_seen} aufsummiert
    ueber alle Server, sortiert nach talk_seconds desc dann count desc."""
    rows = conn.execute("""
        SELECT mate_uid,
               SUM(count) AS total,
               SUM(talk_seconds) AS talk_seconds,
               MAX(last_seen) AS last_seen
        FROM teamspeak_encounters
        WHERE streamer_uid = ?
        GROUP BY mate_uid
        ORDER BY talk_seconds DESC, total DESC
    """, (streamer_uid,)).fetchall()
    return [dict(r) for r in rows]


def bump_talk_seconds(conn, streamer_uid, mate_uid, server_uid, seconds):
    """Erhoeht talk_seconds fuer ein Encounter-Tupel. Wenn das Tupel
    noch nicht existiert wird ein Eintrag angelegt (count=0 + die
    seconds)."""
    if not streamer_uid or not mate_uid or not server_uid: return
    if streamer_uid == mate_uid: return
    if seconds <= 0: return
    import datetime
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute("""
        INSERT INTO teamspeak_encounters
            (streamer_uid, mate_uid, server_uid, count, talk_seconds, last_seen)
        VALUES (?, ?, ?, 0, ?, ?)
        ON CONFLICT(streamer_uid, mate_uid, server_uid) DO UPDATE SET
            talk_seconds = teamspeak_encounters.talk_seconds + ?,
            last_seen = excluded.last_seen
    """, (streamer_uid, mate_uid, server_uid, seconds, now, seconds))
    conn.commit()


# ── AFK-Channels ──────────────────────────────────────────────────────
def get_afk_channels(conn, server_uid=None):
    if server_uid:
        rows = conn.execute(
            "SELECT * FROM teamspeak_afk_channels WHERE server_uid = ?",
            (server_uid,)).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM teamspeak_afk_channels").fetchall()
    return [dict(r) for r in rows]


def set_afk_channel(conn, server_uid, channel_id, channel_name):
    conn.execute("""
        INSERT INTO teamspeak_afk_channels (server_uid, channel_id, channel_name)
        VALUES (?, ?, ?)
        ON CONFLICT(server_uid, channel_id) DO UPDATE SET
            channel_name = excluded.channel_name
    """, (server_uid, channel_id, channel_name or ""))
    conn.commit()


def remove_afk_channel(conn, server_uid, channel_id):
    conn.execute(
        "DELETE FROM teamspeak_afk_channels "
        "WHERE server_uid = ? AND channel_id = ?",
        (server_uid, channel_id))
    conn.commit()


def is_afk_channel(conn, server_uid, channel_id):
    r = conn.execute(
        "SELECT 1 FROM teamspeak_afk_channels "
        "WHERE server_uid = ? AND channel_id = ?",
        (server_uid, channel_id)).fetchone()
    return r is not None
