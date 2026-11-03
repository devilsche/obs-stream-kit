"""Dauerhafte Sammlung für die Herbstdeko (effects/autumn.html):
Follower-Kürbisse auf dem Laubhaufen und das Laub-Protokoll (Laubfall,
Rechen, Wegfegen), pro Tenant.

Wie beim Schnee (fx/xmas_db.py) ist der Server nur Protokoll: das Overlay
rechnet Laubhöhe und Rechen-Rangliste beim Laden aus den Ereignissen nach,
mit den Regeln aus seiner URL (leafrate/rake). Laubfall ist ein Zeitraum
(start … stop), kein Schub.

DAO im sqlite-Stil ('?'-Platzhalter) — Tests laufen auf sqlite, Prod über
core.db_compat.SqliteCompatConn auf Postgres. Geleert wird nur per
cmd=clear, nie automatisch.
"""
import datetime

MAX_VISIBLE_PUMPKINS = 30
MAX_LEAF_EVENTS = 5000

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_autumn_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    event TEXT,
    secs INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fx_autumn_item_tk ON fx_autumn_item(tenant_id, kind, id);
"""

# Prod: als postgres-Superuser mit search_path = obs anlegen
PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_autumn_item (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    event TEXT,
    secs INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fx_autumn_item_tk ON fx_autumn_item(tenant_id, kind, id);
"""

_KINDS = {"pumpkins": "pumpkin", "leaves": "leaf"}
_LEAF_EVENTS = {"leaffall": "start", "leafstop": "stop", "rake": "rake", "sweep": "sweep"}


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def add_pumpkin(conn, tenant_id: int, name: str) -> bool:
    """False, wenn dieser Name schon einen Kürbis hat (Refollow). Kürbisse
    ohne Namen kommen immer dazu."""
    if name:
        row = conn.execute(
            "SELECT 1 FROM fx_autumn_item WHERE tenant_id = ? AND kind = 'pumpkin' "
            "AND lower(name) = lower(?) LIMIT 1", (tenant_id, name)).fetchone()
        if row:
            return False
    conn.execute(
        "INSERT INTO fx_autumn_item (tenant_id, kind, name, created_at) VALUES (?, 'pumpkin', ?, ?)",
        (tenant_id, name, _now()))
    conn.commit()
    return True


def add_leaf_event(conn, tenant_id: int, event: str, name: str = "", secs=None):
    """secs nur bei 'start': Laubfall endet danach von selbst."""
    conn.execute(
        "INSERT INTO fx_autumn_item (tenant_id, kind, name, event, secs, created_at) "
        "VALUES (?, 'leaf', ?, ?, ?, ?)",
        (tenant_id, name, event, secs, _now()))
    conn.commit()


def is_falling(conn, tenant_id: int) -> bool:
    """Letztes start/stop entscheidet; ein start mit secs gilt nur innerhalb
    seiner Dauer."""
    row = conn.execute(
        "SELECT event, secs, created_at FROM fx_autumn_item WHERE tenant_id = ? AND kind = 'leaf' "
        "AND event IN ('start', 'stop') ORDER BY id DESC LIMIT 1", (tenant_id,)).fetchone()
    if not row or row["event"] != "start":
        return False
    if row["secs"]:
        started = datetime.datetime.fromisoformat(row["created_at"])
        age = (datetime.datetime.now(datetime.timezone.utc) - started).total_seconds()
        return age < row["secs"]
    return True


def clear(conn, tenant_id: int, kind=None):
    """kind: 'pumpkins' | 'leaves' | None (alles)."""
    if kind in _KINDS:
        conn.execute("DELETE FROM fx_autumn_item WHERE tenant_id = ? AND kind = ?",
                     (tenant_id, _KINDS[kind]))
    else:
        conn.execute("DELETE FROM fx_autumn_item WHERE tenant_id = ?", (tenant_id,))
    conn.commit()


def load_state(conn, tenant_id: int) -> dict:
    """Neueste sichtbare Kürbisse (älteste zuerst), Gesamtzahl und das Laub-Protokoll."""
    pk = conn.execute(
        "SELECT name FROM fx_autumn_item WHERE tenant_id = ? AND kind = 'pumpkin' "
        "ORDER BY id DESC LIMIT ?", (tenant_id, MAX_VISIBLE_PUMPKINS)).fetchall()
    total = conn.execute(
        "SELECT COUNT(*) AS n FROM fx_autumn_item WHERE tenant_id = ? AND kind = 'pumpkin'",
        (tenant_id,)).fetchone()
    leaves = conn.execute(
        "SELECT name, event, secs, created_at FROM fx_autumn_item WHERE tenant_id = ? AND kind = 'leaf' "
        "ORDER BY id DESC LIMIT ?", (tenant_id, MAX_LEAF_EVENTS)).fetchall()
    return {
        "leaf_events": [{"t": datetime.datetime.fromisoformat(r["created_at"]).timestamp(),
                         "k": r["event"], "n": r["name"], "s": r["secs"]} for r in reversed(leaves)],
        "pumpkins": [{"name": r["name"]} for r in reversed(pk)],
        "pumpkin_total": int(total["n"]),
    }


def persist(conn, tenant_id: int, command: dict) -> bool:
    """Schreibt einen geparsten autumn-Befehl. False = nicht ans Overlay
    weitergeben (doppelter Kürbis)."""
    p = command["params"]
    if command["cmd"] == "pumpkin":
        return add_pumpkin(conn, tenant_id, p.get("name", ""))
    if command["cmd"] == "clear":
        clear(conn, tenant_id, p.get("kind"))
        return True
    if command["cmd"] == "leaftoggle":
        # Umschalter: der Server kennt den Stand, das Overlay bekommt den
        # aufgelösten Befehl
        command["cmd"] = "leafstop" if is_falling(conn, tenant_id) else "leaffall"
    if command["cmd"] in _LEAF_EVENTS:
        add_leaf_event(conn, tenant_id, _LEAF_EVENTS[command["cmd"]], p.get("name", ""), p.get("secs"))
    return True
