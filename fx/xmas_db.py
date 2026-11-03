"""Dauerhafte Sammlung für den Weihnachtsschmuck (effects/xmas.html):
Follower-Kugeln am Baum, Geschenke darunter und das Schnee-Protokoll
(Schneefall, Schippen, Rütteln, Tauen), pro Tenant.

Beim Schnee ist der Server bewusst nur Protokoll: das Overlay rechnet
Schneehöhe und Schipper-Rangliste beim Laden aus den Ereignissen nach,
mit den Regeln aus seiner URL (snowrate/shovel/shakeneed/shakewin).
Schneefall ist ein Zeitraum (start … stop), kein Schub.

DAO im sqlite-Stil ('?'-Platzhalter) — Tests laufen auf sqlite, Prod über
core.db_compat.SqliteCompatConn auf Postgres. Geleert wird nur per
cmd=clear, nie automatisch.
"""
import datetime

MAX_VISIBLE_ORNAMENTS = 60
MAX_VISIBLE_GIFTS = 15
MAX_SNOW_EVENTS = 5000

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_xmas_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    gtype TEXT,
    amount INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fx_xmas_item_tk ON fx_xmas_item(tenant_id, kind, id);
"""

# Prod: als postgres-Superuser mit search_path = obs anlegen
PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_xmas_item (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    gtype TEXT,
    amount INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fx_xmas_item_tk ON fx_xmas_item(tenant_id, kind, id);
"""

_KINDS = {"ornaments": "ornament", "gifts": "gift", "snow": "snow"}
_SNOW_EVENTS = {"snowfall": "start", "snowstop": "stop", "shovel": "shovel", "shake": "shake", "melt": "melt"}


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def add_ornament(conn, tenant_id: int, name: str) -> bool:
    """False, wenn dieser Name schon eine Kugel hat (Refollow). Kugeln ohne
    Namen werden immer angehängt."""
    if name:
        row = conn.execute(
            "SELECT 1 FROM fx_xmas_item WHERE tenant_id = ? AND kind = 'ornament' "
            "AND lower(name) = lower(?) LIMIT 1", (tenant_id, name)).fetchone()
        if row:
            return False
    conn.execute(
        "INSERT INTO fx_xmas_item (tenant_id, kind, name, created_at) VALUES (?, 'ornament', ?, ?)",
        (tenant_id, name, _now()))
    conn.commit()
    return True


def add_gift(conn, tenant_id: int, name: str, gtype: str, amount: int):
    conn.execute(
        "INSERT INTO fx_xmas_item (tenant_id, kind, name, gtype, amount, created_at) "
        "VALUES (?, 'gift', ?, ?, ?, ?)",
        (tenant_id, name, gtype, amount, _now()))
    conn.commit()


def add_snow_event(conn, tenant_id: int, event: str, name: str = "", secs=None):
    """secs nur bei 'start': Schneefall endet danach von selbst (amount-Spalte)."""
    conn.execute(
        "INSERT INTO fx_xmas_item (tenant_id, kind, name, gtype, amount, created_at) "
        "VALUES (?, 'snow', ?, ?, ?, ?)",
        (tenant_id, name, event, secs, _now()))
    conn.commit()


def is_snowing(conn, tenant_id: int) -> bool:
    """Letztes start/stop entscheidet; ein start mit secs gilt nur innerhalb
    seiner Dauer."""
    row = conn.execute(
        "SELECT gtype, amount, created_at FROM fx_xmas_item WHERE tenant_id = ? AND kind = 'snow' "
        "AND gtype IN ('start', 'stop') ORDER BY id DESC LIMIT 1", (tenant_id,)).fetchone()
    if not row or row["gtype"] != "start":
        return False
    if row["amount"]:
        started = datetime.datetime.fromisoformat(row["created_at"])
        age = (datetime.datetime.now(datetime.timezone.utc) - started).total_seconds()
        return age < row["amount"]
    return True


def clear(conn, tenant_id: int, kind=None):
    """kind: 'ornaments' | 'gifts' | 'snow' | None (alles)."""
    if kind in _KINDS:
        conn.execute("DELETE FROM fx_xmas_item WHERE tenant_id = ? AND kind = ?",
                     (tenant_id, _KINDS[kind]))
    else:
        conn.execute("DELETE FROM fx_xmas_item WHERE tenant_id = ?", (tenant_id,))
    conn.commit()


def _count(conn, tenant_id, kind):
    row = conn.execute("SELECT COUNT(*) AS n FROM fx_xmas_item WHERE tenant_id = ? AND kind = ?",
                       (tenant_id, kind)).fetchone()
    return int(row["n"])


def load_state(conn, tenant_id: int) -> dict:
    """Neueste sichtbare Kugeln/Geschenke (älteste zuerst) + Gesamtzahlen."""
    orn = conn.execute(
        "SELECT name FROM fx_xmas_item WHERE tenant_id = ? AND kind = 'ornament' "
        "ORDER BY id DESC LIMIT ?", (tenant_id, MAX_VISIBLE_ORNAMENTS)).fetchall()
    gifts = conn.execute(
        "SELECT name, gtype, amount FROM fx_xmas_item WHERE tenant_id = ? AND kind = 'gift' "
        "ORDER BY id DESC LIMIT ?", (tenant_id, MAX_VISIBLE_GIFTS)).fetchall()
    snow = conn.execute(
        "SELECT name, gtype, amount, created_at FROM fx_xmas_item WHERE tenant_id = ? AND kind = 'snow' "
        "ORDER BY id DESC LIMIT ?", (tenant_id, MAX_SNOW_EVENTS)).fetchall()
    return {
        "snow_events": [{"t": datetime.datetime.fromisoformat(r["created_at"]).timestamp(),
                         "k": r["gtype"], "n": r["name"], "s": r["amount"]} for r in reversed(snow)],
        "ornaments": [{"name": r["name"]} for r in reversed(orn)],
        "ornament_total": _count(conn, tenant_id, "ornament"),
        "gifts": [{"name": r["name"], "type": r["gtype"], "amount": r["amount"]}
                  for r in reversed(gifts)],
        "gift_total": _count(conn, tenant_id, "gift"),
    }


def persist(conn, tenant_id: int, command: dict) -> bool:
    """Schreibt einen geparsten xmas-Befehl. False = nicht ans Overlay
    weitergeben (doppelte Kugel)."""
    p = command["params"]
    if command["cmd"] == "ornament":
        return add_ornament(conn, tenant_id, p.get("name", ""))
    if command["cmd"] == "gift":
        add_gift(conn, tenant_id, p.get("name", ""), p["type"], p["amount"])
    elif command["cmd"] == "clear":
        clear(conn, tenant_id, p.get("kind"))
    else:
        if command["cmd"] == "snowtoggle":
            # Umschalter: der Server kennt den Stand, das Overlay bekommt
            # den aufgelösten Befehl
            command["cmd"] = "snowstop" if is_snowing(conn, tenant_id) else "snowfall"
        if command["cmd"] in _SNOW_EVENTS:
            add_snow_event(conn, tenant_id, _SNOW_EVENTS[command["cmd"]], p.get("name", ""), p.get("secs"))
    return True
