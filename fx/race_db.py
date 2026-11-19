"""Ergebnisse und Punkte des Chat-Autorennens (Car Race), pro Tenant.

Jedes Rennen legt eine Zeile je Teilnehmer in fx_race_result ab. Punkte:
Jeder Zielankömmling zählt alle hinter sich (DNFs gelten als geschlagen),
der Sieger bekommt einen Bonuspunkt, DNF gibt 0. Ranglisten (Monat / ewig)
und Monatssieger werden aus diesen Zeilen berechnet; mit void() ungültig
gemachte Rennen zählen nicht mehr.

DAO im sqlite-Stil ('?'-Platzhalter) — Tests laufen auf sqlite, Prod über
core.db_compat.SqliteCompatConn auf Postgres.
"""
import datetime

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_race_result (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    race_id TEXT NOT NULL,
    at TEXT NOT NULL,
    user_id TEXT NOT NULL,
    login TEXT NOT NULL DEFAULT '',
    display TEXT NOT NULL DEFAULT '',
    place INTEGER,
    field INTEGER NOT NULL,
    points INTEGER NOT NULL,
    car_key TEXT NOT NULL DEFAULT '',
    void INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_fx_race_result_race ON fx_race_result(tenant_id, race_id);
CREATE INDEX IF NOT EXISTS ix_fx_race_result_at ON fx_race_result(tenant_id, at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fx_race_result_user ON fx_race_result(tenant_id, race_id, user_id);
"""

# Prod: als postgres-Superuser mit search_path = obs anlegen
SCHEMA_PG = """
CREATE TABLE IF NOT EXISTS fx_race_result (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    race_id TEXT NOT NULL,
    at TEXT NOT NULL,
    user_id TEXT NOT NULL,
    login TEXT NOT NULL DEFAULT '',
    display TEXT NOT NULL DEFAULT '',
    place INTEGER,
    field INTEGER NOT NULL,
    points INTEGER NOT NULL,
    car_key TEXT NOT NULL DEFAULT '',
    void INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_fx_race_result_race ON fx_race_result(tenant_id, race_id);
CREATE INDEX IF NOT EXISTS ix_fx_race_result_at ON fx_race_result(tenant_id, at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fx_race_result_user ON fx_race_result(tenant_id, race_id, user_id);
"""


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def points(place, field: int) -> int:
    """DNF (place None) = 0; sonst alle hinter sich (DNFs eingerechnet),
    plus ein Bonuspunkt für den Sieger."""
    if place is None:
        return 0
    return (field - place) + (1 if place == 1 else 0)


def record(conn, tenant_id: int, race_id: str, rows: list, at=None) -> bool:
    """Speichert ein Rennen. False, wenn die race_id schon existiert
    (idempotent)."""
    exists = conn.execute(
        "SELECT 1 FROM fx_race_result WHERE tenant_id = ? AND race_id = ? LIMIT 1",
        (tenant_id, race_id)).fetchone()
    if exists:
        return False
    at = at or _now()
    field = len(rows)
    try:
        for row in rows:
            place = row.get("place")
            conn.execute(
                "INSERT INTO fx_race_result (tenant_id, race_id, at, user_id, login, display, place, "
                "field, points, car_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (tenant_id, race_id, at, row["user_id"], row.get("login", ""), row.get("display", ""),
                 place, field, points(place, field), row.get("car_key", "")))
        conn.commit()
    except Exception as e:
        # Unique-Index (tenant_id, race_id, user_id): parallel schon gespeichert
        try:
            conn.rollback()
        except Exception:
            pass
        if type(e).__name__ == "IntegrityError" or "unique" in str(e).lower():
            return False
        raise
    return True


def stored_points(conn, tenant_id: int, race_id: str) -> dict:
    """user_id → Punkte dieses Rennens aus der DB (für doppelte Meldungen)."""
    rows = conn.execute(
        "SELECT user_id, points FROM fx_race_result WHERE tenant_id = ? AND race_id = ?",
        (tenant_id, race_id)).fetchall()
    return {x["user_id"]: x["points"] for x in rows}


def void(conn, tenant_id: int, race_id: str) -> bool:
    """Macht ein Rennen ungültig. False, wenn es keins gibt."""
    cur = conn.execute(
        "UPDATE fx_race_result SET void = 1 WHERE tenant_id = ? AND race_id = ?",
        (tenant_id, race_id))
    conn.commit()
    return cur.rowcount > 0


def _rank(rows) -> list:
    """Rangliste aus Ergebniszeilen (nach at, id aufsteigend). Sortierung:
    Punkte, Siege, Podien (absteigend), dann wer sein letztes Ergebnis
    früher erreicht hat; zuletzt user_id für Stabilität."""
    users = {}
    for x in rows:
        u = users.setdefault(x["user_id"], {
            "user_id": x["user_id"], "display": x["display"], "points": 0, "races": 0,
            "wins": 0, "podiums": 0, "best": None, "_last": x["at"]})
        u["display"] = x["display"]  # zuletzt gespeicherter Name gewinnt
        u["points"] += x["points"]
        u["races"] += 1
        u["_last"] = max(u["_last"], x["at"])
        if x["place"] is not None:
            u["wins"] += 1 if x["place"] == 1 else 0
            u["podiums"] += 1 if x["place"] <= 3 else 0
            u["best"] = x["place"] if u["best"] is None else min(u["best"], x["place"])
    out = sorted(users.values(),
                 key=lambda u: (-u["points"], -u["wins"], -u["podiums"], u["_last"], u["user_id"]))
    for u in out:
        del u["_last"]
    return out


def _rows(conn, tenant_id, prefix=None):
    sql = ("SELECT user_id, display, place, points, at, car_key FROM fx_race_result "
           "WHERE tenant_id = ? AND void = 0")
    args = [tenant_id]
    if prefix:
        sql += " AND at LIKE ?"
        args.append(prefix + "%")
    return conn.execute(sql + " ORDER BY at, id", args).fetchall()


def board(conn, tenant_id: int, scope: str, month=None, limit: int = 20) -> list:
    """scope 'month' (YYYY-MM, Standard: aktueller UTC-Monat) oder 'all'."""
    prefix = None
    if scope == "month":
        prefix = month or _now()[:7]
    return _rank(_rows(conn, tenant_id, prefix))[:limit]


def champions(conn, tenant_id: int) -> list:
    """Je abgeschlossenem Monat (vor dem aktuellen UTC-Monat) der Erste."""
    current = _now()[:7]
    by_month = {}
    for x in _rows(conn, tenant_id):
        m = x["at"][:7]
        if m < current:
            by_month.setdefault(m, []).append(x)
    out = []
    for m in sorted(by_month):
        top = _rank(by_month[m])[0]
        out.append({"month": m, "user_id": top["user_id"], "display": top["display"],
                    "points": top["points"]})
    return out


def car_stats(conn, tenant_id: int) -> list:
    """Starts und Siege je Auto-Modell."""
    cars = {}
    for x in _rows(conn, tenant_id):
        c = cars.setdefault(x["car_key"], {"car_key": x["car_key"], "races": 0, "wins": 0})
        c["races"] += 1
        c["wins"] += 1 if x["place"] == 1 else 0
    return sorted(cars.values(), key=lambda c: (-c["races"], c["car_key"]))
