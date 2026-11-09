"""Frost-Ebene der Weather-Source: Eisblumen-Stand je Tenant (0..100).

Der Stand hängt an der echten Temperatur, die nur der Server kennt; er wird
bei jeder Zustandsabfrage fortgeschrieben (`advance`). Friert es (≤ 0 °C
oder wirksamer Schneesturm), wächst er mit (2 + |Temp|) % pro Minute, im
Schneesturm mindestens 10 %; sonst taut er langsam mit (1 + Temp/2) % pro Minute; eine
Hitzewelle (auch eingestellt) schmilzt ihn mit 25 % pro Minute.
`!scrape` und `!warm` nehmen Frost weg und zählen für eine gemeinsame
Rangliste. DAO im sqlite-Stil ('?'-Platzhalter).
"""
import datetime
import json

SCRAPE = 6
WARM = 10
TOP = 5

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_weather_frost (
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


def _get(conn, tenant_id):
    row = conn.execute("SELECT data FROM fx_weather_frost WHERE tenant_id = ?", (tenant_id,)).fetchone()
    if row:
        try:
            return json.loads(row["data"])
        except (TypeError, ValueError):
            pass
    return None


def _put(conn, tenant_id, data):
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO fx_weather_frost (tenant_id, data, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        (tenant_id, json.dumps(data), stamp))
    conn.commit()


def _top(data):
    rows = sorted(data.get("top", {}).values(), key=lambda e: -e[1])
    return [list(e) for e in rows[:TOP]]


def load(conn, tenant_id) -> dict:
    """→ {"level", "top": [[name, anzahl], …]} ohne Fortschreiben."""
    data = _get(conn, tenant_id) or {"level": 0, "at": None, "top": {}}
    return {"level": round(data["level"], 1), "top": _top(data)}


def advance(conn, tenant_id, now: float, temp, blizzard: bool, rate: float = 1.0, heat: bool = False) -> dict:
    """Stand bis `now` fortschreiben. Gespeichert wird nur bei spürbarer
    Änderung oder nach 60 s, damit nicht jede Abfrage schreibt."""
    data = _get(conn, tenant_id)
    if data is None:
        data = {"level": 0, "at": now, "top": {}}
        _put(conn, tenant_id, data)
        return {"level": 0, "top": []}
    last = data.get("at")
    last = now if last is None else last
    minutes = max(0.0, now - last) / 60
    freezing = blizzard or (temp is not None and temp <= 0)
    if heat:
        # Hitzewelle (auch eingestellt) schmilzt schnell, egal wie kalt es draußen ist
        per_min = -25
    elif freezing:
        per_min = (2 + abs(min(temp or 0, 0))) * rate
        if blizzard:
            per_min = max(per_min, 10 * rate)
    elif temp is not None:
        per_min = -(1 + 0.5 * temp)
    else:
        per_min = 0
    level = min(100.0, max(0.0, data["level"] + per_min * minutes))
    if abs(level - data["level"]) >= 0.5 or now - last >= 60:
        data.update(level=level, at=now)
        _put(conn, tenant_id, data)
    return {"level": round(level, 1), "top": _top(data)}


def use(conn, tenant_id, kind: str, name: str, now: float) -> dict:
    """Kratzen (`scrape`) oder warm hauchen (`warm`) → {"done", "level"}."""
    data = _get(conn, tenant_id) or {"level": 0, "at": now, "top": {}}
    amount = SCRAPE if kind == "scrape" else WARM
    done = min(amount, data["level"])
    if done > 0:
        data["level"] -= done
        if name:
            top = data.setdefault("top", {})
            entry = top.get(name.lower(), [name, 0])
            top[name.lower()] = [name, entry[1] + 1]
        _put(conn, tenant_id, data)
    return {"done": round(done, 1), "level": round(data["level"], 1)}


def clear(conn, tenant_id, now: float) -> None:
    data = _get(conn, tenant_id) or {"top": {}}
    data.update(level=0, at=now)
    _put(conn, tenant_id, data)


def reset_leaders(conn, tenant_id) -> None:
    data = _get(conn, tenant_id)
    if data:
        data["top"] = {}
        _put(conn, tenant_id, data)
