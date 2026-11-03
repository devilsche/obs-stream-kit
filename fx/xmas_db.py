"""Dauerhafte Sammlung für den Weihnachtsschmuck (effects/xmas.html):
Follower-Kugeln am Baum und Geschenke darunter, pro Tenant.

DAO im sqlite-Stil ('?'-Platzhalter) — Tests laufen auf sqlite, Prod über
core.db_compat.SqliteCompatConn auf Postgres. Geleert wird nur per
cmd=clear, nie automatisch.
"""
import datetime

MAX_VISIBLE_ORNAMENTS = 60
MAX_VISIBLE_GIFTS = 15

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

_KINDS = {"ornaments": "ornament", "gifts": "gift"}


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


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


def clear(conn, tenant_id: int, kind=None):
    """kind: 'ornaments' | 'gifts' | None (beides)."""
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
    return {
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
    return True
