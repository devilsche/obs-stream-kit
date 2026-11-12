"""Freigaben der Weather-Source: Guthaben je Zuschauer, eingelöst über die
bezahlten Chat-Befehle (!tornado …) ohne Bits.

Der Streamer oder ein Mod gibt per `!grant @name l3` frei; eine Spende mit
„@name“ in der Nachricht gibt dem Genannten automatisch ihren Betrag frei.
Gerechnet wird in denselben Punkten wie bei Bits (weather_chat.PRICE).
Guthaben addiert sich und verfällt 12 Stunden nach der letzten Freigabe.
Eine Zeile JSON pro Tenant, DAO im sqlite-Stil ('?'-Platzhalter).
"""
import datetime
import json

# Level → Punkte (l1 = 1 kleines Spektakel, l3 = 1 großes oder 2 kleine, l5 = Apokalypse)
LEVELS = {0: 0, 1: 100, 2: 150, 3: 250, 4: 400, 5: 500}
TTL = 12 * 3600

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_weather_credit (
    tenant_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

# Prod: als postgres-Superuser mit search_path = obs anlegen
PG_SCHEMA = SCHEMA


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def key(name: str) -> str:
    """Twitch-Name → Schlüssel: ohne @, klein, ohne Leerzeichen."""
    return (name or "").strip().lstrip("@").strip().lower()[:40]


def _get(conn, tenant_id, now):
    row = conn.execute("SELECT data FROM fx_weather_credit WHERE tenant_id = ?", (tenant_id,)).fetchone()
    data = {}
    if row:
        try:
            data = json.loads(row["data"]) or {}
        except (TypeError, ValueError):
            data = {}
    return {k: v for k, v in data.items() if v.get("until", 0) > now and v.get("pts", 0) > 0}


def _put(conn, tenant_id, data):
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO fx_weather_credit (tenant_id, data, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        (tenant_id, json.dumps(data), stamp))
    conn.commit()


def balance(conn, tenant_id, name, now: float) -> int:
    return _get(conn, tenant_id, now).get(key(name), {}).get("pts", 0)


def grant(conn, tenant_id, name, pts: int, now: float) -> int:
    """Punkte gutschreiben (addiert, Frist neu); pts = 0 nimmt alles weg. → neuer Stand."""
    k = key(name)
    if not k:
        return 0
    data = _get(conn, tenant_id, now)
    if pts <= 0:
        data.pop(k, None)
        total = 0
    else:
        total = data.get(k, {}).get("pts", 0) + int(pts)
        data[k] = {"pts": total, "until": now + TTL}
    _put(conn, tenant_id, data)
    return total


def spend(conn, tenant_id, name, pts: int, now: float):
    """Punkte abziehen, wenn genug da sind. → Rest oder None (reicht nicht)."""
    k = key(name)
    data = _get(conn, tenant_id, now)
    have = data.get(k, {}).get("pts", 0)
    if not k or have < pts:
        return None
    left = have - pts
    if left > 0:
        data[k]["pts"] = left
    else:
        data.pop(k, None)
    _put(conn, tenant_id, data)
    return left


def parse_level(text) -> int | None:
    """„l3“, „L3“, „3“ → Punkte des Levels; Unbekanntes → None."""
    t = str(text or "").strip().lower().lstrip("l")
    try:
        return LEVELS.get(int(t))
    except ValueError:
        return None
