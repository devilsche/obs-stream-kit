"""Ergebnisse und Punkte des Chat-Autorennens (Car Race), pro Tenant.

Jedes Rennen legt eine Zeile je Teilnehmer in fx_race_result ab. Punkte:
Jeder Zielankömmling zählt alle hinter sich (DNFs gelten als geschlagen),
der Sieger bekommt einen Bonuspunkt, DNF gibt 0. Ranglisten (Monat / ewig)
und Monatssieger werden aus diesen Zeilen berechnet; mit void() ungültig
gemachte Rennen zählen nicht mehr.

Garage: Coins (fx_race_wallet) werden in derselben Transaktion wie die
Ergebniszeilen gutgeschrieben (record) – doppelte Meldungen schreiben weder
Zeilen noch Coins; void() bucht die Coins des Rennens wieder ab (nicht unter 0).
Gekaufte Autos stehen in fx_race_garage; buy() zieht atomar ab.

DAO im sqlite-Stil ('?'-Platzhalter) — Tests laufen auf sqlite, Prod über
core.db_compat.SqliteCompatConn auf Postgres.
"""
import datetime

from fx import race_shop

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
    void INTEGER NOT NULL DEFAULT 0,
    coins INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_fx_race_result_race ON fx_race_result(tenant_id, race_id);
CREATE INDEX IF NOT EXISTS ix_fx_race_result_at ON fx_race_result(tenant_id, at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fx_race_result_user ON fx_race_result(tenant_id, race_id, user_id);
CREATE TABLE IF NOT EXISTS fx_race_wallet (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    display TEXT NOT NULL DEFAULT '',
    coins INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fx_race_wallet_user ON fx_race_wallet(tenant_id, user_id);
CREATE TABLE IF NOT EXISTS fx_race_garage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    car_key TEXT NOT NULL,
    bought_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fx_race_garage_car ON fx_race_garage(tenant_id, user_id, car_key);
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
    void INTEGER NOT NULL DEFAULT 0,
    coins INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_fx_race_result_race ON fx_race_result(tenant_id, race_id);
CREATE INDEX IF NOT EXISTS ix_fx_race_result_at ON fx_race_result(tenant_id, at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fx_race_result_user ON fx_race_result(tenant_id, race_id, user_id);
CREATE TABLE IF NOT EXISTS fx_race_wallet (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    display TEXT NOT NULL DEFAULT '',
    coins INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fx_race_wallet_user ON fx_race_wallet(tenant_id, user_id);
CREATE TABLE IF NOT EXISTS fx_race_garage (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    car_key TEXT NOT NULL,
    bought_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fx_race_garage_car ON fx_race_garage(tenant_id, user_id, car_key);
"""


def init_schema(conn):
    conn.executescript(SCHEMA)
    try:  # ältere sqlite-Datenbanken ohne coins-Spalte
        conn.execute("ALTER TABLE fx_race_result ADD COLUMN coins INTEGER NOT NULL DEFAULT 0")
    except Exception:
        pass
    conn.commit()


def _integrity(e) -> bool:
    return type(e).__name__ == "IntegrityError" or "unique" in str(e).lower()


def _rollback(conn):
    try:
        conn.rollback()
    except Exception:
        pass


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def points(place, field: int) -> int:
    """DNF (place None) = 0; sonst alle hinter sich (DNFs eingerechnet),
    plus ein Bonuspunkt für den Sieger."""
    if place is None:
        return 0
    return (field - place) + (1 if place == 1 else 0)


def record(conn, tenant_id: int, race_id: str, rows: list, at=None) -> bool:
    """Speichert ein Rennen und schreibt die Coins gut (eine Transaktion). False, wenn
    die race_id schon existiert (idempotent, dann auch keine Coins). rows[i]["sub"] =
    beim Join gespeichertes Sub-Tier (0/1000/2000/3000) für den Coin-Multiplikator."""
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
            gain = race_shop.coins(place, row.get("sub") or 0)
            conn.execute(
                "INSERT INTO fx_race_result (tenant_id, race_id, at, user_id, login, display, place, "
                "field, points, car_key, coins) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (tenant_id, race_id, at, row["user_id"], row.get("login", ""), row.get("display", ""),
                 place, field, points(place, field), row.get("car_key", ""), gain))
            _credit(conn, tenant_id, row["user_id"], row.get("display", ""), gain, at)
        conn.commit()
    except Exception as e:
        # Unique-Index (tenant_id, race_id, user_id): parallel schon gespeichert
        _rollback(conn)
        if _integrity(e):
            return False
        raise
    return True


def _credit(conn, tenant_id, user_id, display, n, at):
    """Coins gutschreiben/abziehen (ohne commit); Stand fällt nie unter 0."""
    conn.execute(
        "INSERT INTO fx_race_wallet (tenant_id, user_id, display, coins, updated_at) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT (tenant_id, user_id) DO UPDATE SET "
        "coins = CASE WHEN fx_race_wallet.coins + excluded.coins > 0 "
        "THEN fx_race_wallet.coins + excluded.coins ELSE 0 END, "
        "display = CASE WHEN excluded.display <> '' THEN excluded.display ELSE fx_race_wallet.display END, "
        "updated_at = excluded.updated_at",
        (tenant_id, user_id, display or "", n, at))
    if n < 0:
        # neu angelegte Zeile mit negativem Startwert auf 0 setzen
        conn.execute("UPDATE fx_race_wallet SET coins = 0 WHERE tenant_id = ? AND user_id = ? AND coins < 0",
                     (tenant_id, user_id))


def stored_points(conn, tenant_id: int, race_id: str) -> dict:
    """user_id → Punkte dieses Rennens aus der DB (für doppelte Meldungen)."""
    rows = conn.execute(
        "SELECT user_id, points FROM fx_race_result WHERE tenant_id = ? AND race_id = ?",
        (tenant_id, race_id)).fetchall()
    return {x["user_id"]: x["points"] for x in rows}


def void(conn, tenant_id: int, race_id: str) -> bool:
    """Macht ein Rennen ungültig und bucht seine Coins wieder ab (nicht unter 0).
    False, wenn es keins gibt."""
    try:
        live = conn.execute(
            "SELECT user_id, coins FROM fx_race_result WHERE tenant_id = ? AND race_id = ? AND void = 0",
            (tenant_id, race_id)).fetchall()
        cur = conn.execute(
            "UPDATE fx_race_result SET void = 1 WHERE tenant_id = ? AND race_id = ? AND void = 0",
            (tenant_id, race_id))
        hit = cur.rowcount > 0
        if hit:
            at = _now()
            for x in live:
                if x["coins"]:
                    conn.execute(
                        "UPDATE fx_race_wallet SET coins = CASE WHEN coins > ? THEN coins - ? ELSE 0 END, "
                        "updated_at = ? WHERE tenant_id = ? AND user_id = ?",
                        (x["coins"], x["coins"], at, tenant_id, x["user_id"]))
        conn.commit()
    except Exception:
        _rollback(conn)
        raise
    return hit


# --- Garage ---

def coins(conn, tenant_id: int, user_id: str) -> int:
    row = conn.execute("SELECT coins FROM fx_race_wallet WHERE tenant_id = ? AND user_id = ?",
                       (tenant_id, user_id)).fetchone()
    return int(row["coins"]) if row else 0


def add_coins(conn, tenant_id: int, user_id: str, display: str, n: int) -> int:
    """Coins von Hand vergeben (negativ = abziehen, nicht unter 0). → neuer Stand."""
    try:
        _credit(conn, tenant_id, user_id, display, int(n), _now())
        conn.commit()
    except Exception:
        _rollback(conn)
        raise
    return coins(conn, tenant_id, user_id)


def spend(conn, tenant_id: int, user_id: str, cost: int) -> bool:
    """Atomar abziehen, nur wenn genug da ist (eine UPDATE-Bedingung). → True bei Erfolg."""
    try:
        cur = conn.execute(
            "UPDATE fx_race_wallet SET coins = coins - ?, updated_at = ? "
            "WHERE tenant_id = ? AND user_id = ? AND coins >= ?",
            (cost, _now(), tenant_id, user_id, cost))
        if cur.rowcount != 1:
            _rollback(conn)
            return False
        conn.commit()
        return True
    except Exception:
        _rollback(conn)
        raise


def garage(conn, tenant_id: int, user_id: str) -> list:
    """Gekaufte Auto-Schlüssel, älteste zuerst."""
    rows = conn.execute("SELECT car_key FROM fx_race_garage WHERE tenant_id = ? AND user_id = ? "
                        "ORDER BY bought_at, id", (tenant_id, user_id)).fetchall()
    return [x["car_key"] for x in rows]


def owns(conn, tenant_id: int, user_id: str, car_key: str) -> bool:
    return conn.execute("SELECT 1 FROM fx_race_garage WHERE tenant_id = ? AND user_id = ? AND car_key = ?",
                        (tenant_id, user_id, car_key)).fetchone() is not None


def buy(conn, tenant_id: int, user_id: str, car_key: str, cost: int):
    """Atomar: Stand prüfen, abziehen, eintragen. → (status, Stand) mit status
    "ok" | "owned" | "poor". Abziehen nur, wenn genug da ist (eine UPDATE-Bedingung);
    der Unique-Index verhindert Doppelkauf, dann wird das Abziehen zurückgerollt."""
    if owns(conn, tenant_id, user_id, car_key):
        return "owned", coins(conn, tenant_id, user_id)
    at = _now()
    try:
        cur = conn.execute(
            "UPDATE fx_race_wallet SET coins = coins - ?, updated_at = ? "
            "WHERE tenant_id = ? AND user_id = ? AND coins >= ?",
            (cost, at, tenant_id, user_id, cost))
        if cur.rowcount != 1:
            _rollback(conn)
            return "poor", coins(conn, tenant_id, user_id)
        conn.execute("INSERT INTO fx_race_garage (tenant_id, user_id, car_key, bought_at) VALUES (?, ?, ?, ?)",
                     (tenant_id, user_id, car_key, at))
        conn.commit()
    except Exception as e:
        _rollback(conn)
        if _integrity(e):
            return "owned", coins(conn, tenant_id, user_id)
        raise
    return "ok", coins(conn, tenant_id, user_id)


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
