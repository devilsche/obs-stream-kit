"""Gemeinsame Follower-Liste der Weather-Source: jeder Follower erscheint in
jeder Jahreszeit, nur in deren Gestalt (Kugel bzw. Mini-Schneemann, Kürbis,
Blume, Sandburg). Ein Name zählt einmal.

Beim ersten Zugriff je Tenant werden die bisherigen Sammlungen der alten
Effekte übernommen (Kugeln, Mini-Schneemänner, Kürbisse, Blumen, Sandburgen),
in der Reihenfolge des ersten Follows; eine Markierungszeile verhindert
ein zweites Übernehmen. DAO im sqlite-Stil.
"""
import datetime
import re

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_weather_follower (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'follower',
    name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fx_weather_follower_tk ON fx_weather_follower(tenant_id, kind, id);
"""

PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_weather_follower (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'follower',
    name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fx_weather_follower_tk ON fx_weather_follower(tenant_id, kind, id);
"""

# (Tabelle, Bedingung) der alten Sammlungen
_OLD = (
    ("fx_xmas_item", "kind = 'ornament'"),
    ("fx_autumn_item", "kind = 'pumpkin'"),
    ("fx_season_item", "kind = 'item' AND effect IN ('winter', 'spring', 'summer')"),
)


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def _ensure_imported(conn, tenant_id):
    if conn.execute("SELECT 1 FROM fx_weather_follower WHERE tenant_id = ? AND kind = 'imported' LIMIT 1",
                    (tenant_id,)).fetchone():
        return
    rows = []
    for table, cond in _OLD:
        try:
            rows += [(r["created_at"], r["name"]) for r in conn.execute(
                "SELECT name, created_at FROM %s WHERE tenant_id = ? AND %s" % (table, cond),
                (tenant_id,)).fetchall()]
        except Exception:
            # alte Tabelle fehlt (frische Installation); Postgres braucht ein Rollback
            try:
                conn.rollback()
            except Exception:
                pass
            continue
    seen = set()
    for created, name in sorted(rows, key=lambda r: r[0]):
        key = (name or "").lower()
        if key and key in seen:
            continue
        seen.add(key)
        conn.execute("INSERT INTO fx_weather_follower (tenant_id, kind, name, created_at) "
                     "VALUES (?, 'follower', ?, ?)", (tenant_id, name or "", created))
    conn.execute("INSERT INTO fx_weather_follower (tenant_id, kind, name, created_at) "
                 "VALUES (?, 'imported', '', ?)", (tenant_id, _now()))
    conn.commit()


# Twitch-Namen: Buchstaben (auch lokalisiert), Ziffern, Unterstrich
_NAME = re.compile(r"\w{1,25}")
_PLACEHOLDERS = {"user", "username", "name", "displayname", "follower"}


def is_placeholder(name: str) -> bool:
    """Nicht ersetzte Streamer.bot-Variable (`latestFollower.user`, `%user%`, `user`)?"""
    return bool(name) and (not _NAME.fullmatch(name) or name.lower() in _PLACEHOLDERS)


def add(conn, tenant_id: int, name: str) -> bool:
    """False, wenn der Name schon folgt (Refollow) oder ein Platzhalter ist.
    Ohne Namen immer."""
    if is_placeholder(name):
        return False
    _ensure_imported(conn, tenant_id)
    if name and conn.execute(
            "SELECT 1 FROM fx_weather_follower WHERE tenant_id = ? AND kind = 'follower' "
            "AND lower(name) = lower(?) LIMIT 1", (tenant_id, name)).fetchone():
        return False
    conn.execute("INSERT INTO fx_weather_follower (tenant_id, kind, name, created_at) "
                 "VALUES (?, 'follower', ?, ?)", (tenant_id, name or "", _now()))
    conn.commit()
    return True


def load(conn, tenant_id: int, limit: int = 60) -> dict:
    """→ {"names": neueste `limit` Namen (älteste zuerst), "total"}."""
    _ensure_imported(conn, tenant_id)
    rows = conn.execute("SELECT name FROM fx_weather_follower WHERE tenant_id = ? AND kind = 'follower' "
                        "ORDER BY id DESC LIMIT ?", (tenant_id, limit)).fetchall()
    total = conn.execute("SELECT COUNT(*) AS n FROM fx_weather_follower WHERE tenant_id = ? "
                         "AND kind = 'follower'", (tenant_id,)).fetchone()
    return {"names": [r["name"] for r in reversed(rows)], "total": int(total["n"])}


def clear(conn, tenant_id: int) -> None:
    _ensure_imported(conn, tenant_id)
    conn.execute("DELETE FROM fx_weather_follower WHERE tenant_id = ? AND kind = 'follower'", (tenant_id,))
    conn.commit()
