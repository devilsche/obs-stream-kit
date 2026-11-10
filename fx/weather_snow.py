"""Schneedecke des Winter-Themas (0..100) je Tenant, wie der Frost auf dem
Server: wächst, solange die wirksame Lage schneit (25 × Menge^1,8 % pro
Minute × snowrate: Blizzard 25, Schnee 10, Schneeregen 6), eine Lawine legt
20 % drauf, schmilzt bei Hitze schnell (20 %/min) und
über 0 °C langsam (0,5 + 0,3 × Temp %/min). `!shovel` räumt 5 % weg,
`!shake` braucht eine Gruppe (need Namen in win Sekunden) oder force,
`!icicle` bricht einen Eiszapfen ab (ab 10 % Schnee). Schippen und
Eiszapfen zählen für die Rangliste. DAO im sqlite-Stil.
"""
import datetime
import json

SHOVEL = 5
TOP = 5

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_weather_snow (
    tenant_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""
PG_SCHEMA = SCHEMA


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _get(conn, tenant_id):
    row = conn.execute("SELECT data FROM fx_weather_snow WHERE tenant_id = ?", (tenant_id,)).fetchone()
    if row:
        try:
            return json.loads(row["data"])
        except (TypeError, ValueError):
            pass
    return None


def _put(conn, tenant_id, data):
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO fx_weather_snow (tenant_id, data, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        (tenant_id, json.dumps(data), stamp))
    conn.commit()


def _fresh(now):
    return {"level": 0, "at": now, "top": {}, "shake": []}


def _top(data):
    rows = sorted(data.get("top", {}).values(), key=lambda e: -e[1])
    return [list(e) for e in rows[:TOP]]


def _count(data, name):
    if name:
        top = data.setdefault("top", {})
        entry = top.get(name.lower(), [name, 0])
        top[name.lower()] = [name, entry[1] + 1]


def load(conn, tenant_id) -> dict:
    data = _get(conn, tenant_id) or _fresh(None)
    return {"level": round(data["level"], 1), "top": _top(data)}


def advance(conn, tenant_id, now, snow: float, heat: bool, temp, rate: float = 1.0) -> dict:
    data = _get(conn, tenant_id)
    if data is None:
        _put(conn, tenant_id, _fresh(now))
        return {"level": 0, "top": []}
    last = data.get("at")
    last = now if last is None else last
    minutes = max(0.0, now - last) / 60
    if heat:
        per_min = -20
    elif snow > 0.02:
        per_min = 25 * min(1.0, snow) ** 1.8 * rate
    elif temp is not None and temp > 0:
        per_min = -(0.5 + 0.3 * temp)
    else:
        per_min = 0
    level = min(100.0, max(0.0, data["level"] + per_min * minutes))
    if abs(level - data["level"]) >= 0.5 or now - last >= 60:
        data.update(level=level, at=now)
        _put(conn, tenant_id, data)
    return {"level": round(level, 1), "top": _top(data)}


def drift(conn, tenant_id, amount, now) -> float:
    """Lawine: Schnee auf einen Schlag dazu (bis 100) → neuer Stand."""
    data = _get(conn, tenant_id) or _fresh(now)
    data["level"] = min(100.0, data["level"] + amount)
    _put(conn, tenant_id, data)
    return round(data["level"], 1)


def shovel(conn, tenant_id, name, now) -> dict:
    data = _get(conn, tenant_id) or _fresh(now)
    done = min(SHOVEL, data["level"])
    if done > 0:
        data["level"] -= done
        _count(data, name)
        _put(conn, tenant_id, data)
    return {"done": round(done, 1), "level": round(data["level"], 1)}


def icicle(conn, tenant_id, name, now) -> dict:
    data = _get(conn, tenant_id) or _fresh(now)
    done = 1 if data["level"] >= 10 else 0
    if done:
        _count(data, name)
        _put(conn, tenant_id, data)
    return {"done": done, "level": round(data["level"], 1)}


def shake(conn, tenant_id, name, now, need: int, win: int, force: bool = False) -> dict:
    """Gruppenaktion: need verschiedene Namen innerhalb win Sekunden schütteln
    allen Schnee ab; force (Mods/Knopf) gelingt sofort."""
    data = _get(conn, tenant_id) or _fresh(now)
    if data["level"] <= 0:
        return {"success": False, "idle": True, "count": 0, "need": need, "level": 0}
    hits = [h for h in data.get("shake", []) if now - h[1] <= win and h[0] != (name or "").lower()]
    hits.append([(name or "").lower() or "?", now])
    success = force or len(hits) >= need
    if success:
        data.update(level=0, shake=[])
    else:
        data["shake"] = hits
    _put(conn, tenant_id, data)
    return {"success": success, "count": len(hits), "need": need, "level": round(data["level"], 1)}


def clear(conn, tenant_id, now) -> None:
    data = _get(conn, tenant_id) or _fresh(now)
    data.update(level=0, at=now, shake=[], top={})
    _put(conn, tenant_id, data)
