"""Jahreszeiten-Mechaniken der Weather-Source (Herbst, Frühling, Sommer),
angetrieben vom wirksamen Wetter. Ein JSON-Stand je Tenant:

- Herbst `leaves`: Laub fällt stetig mit (1 + 2 × Wind) %/min × rate;
  `rake` −5 (Rangliste), `sweep` (Mods) fegt alles weg.
- Frühling `water`: trocknet mit 2 %/min (Hitze 6), Regen gießt mit
  30 %/min × Regenmenge, `water` +10; `weeds` wächst mit 1 %/min, `weed`
  −3, eine Gruppe (3 Namen in 20 s) halbiert, `force` (Mods) halbiert sofort.
  Gießen und Jäten zählen für die Rangliste. Gießen lässt außerdem eine
  Blume wachsen (`target`, vom Endpoint gewählt: die eigene oder eine
  zufällige): nach GROW_STEPS-mal Gießen Stufe 1 bzw. 2, für immer; je
  Zuschauer zählt nur ein Gießen alle GROW_COOLDOWN s (ohne Namen, also
  vom Dashboard, zählt jedes). Regen lässt nichts
  wachsen, er hebt nur die Köpfe.
- Sommer `heat`: steigt bei Hitzewelle mit 20 %/min, bei Sonne am Tag mit
  2 %/min, sinkt bei Regen mit 10 %/min und nachts mit 3 %/min; `splash` −5
  (Rangliste), `cool` (Mods) kühlt ganz ab.

Fortgeschrieben wird nur das aktive Thema. DAO im sqlite-Stil.
"""
import datetime
import json

TOP = 5
LEVELS = ("leaves", "water", "weeds", "heat")
THEME_OF = {"rake": "autumn", "sweep": "autumn", "leafstorm": "autumn", "extinguish": "autumn", "water": "spring", "weed": "spring",
            "splash": "summer", "cool": "summer"}
FIRE_SECS = 30        # so lange brennt es trocken, im Regen nur kurz
FIRE_WET_SECS = 8
FIRE_MAX = 5          # so viele Feuer brennen höchstens gleichzeitig
LEAFSTORM = 25        # so viel Laub weht der Laubsturm auf den Haufen
GROW_STEPS = (5, 15)  # so oft gegossen → Blume Stufe 1, Stufe 2
GROW_COOLDOWN = 300   # je Zuschauer zählt ein Gießen fürs Wachsen nur so oft

SCHEMA = """
CREATE TABLE IF NOT EXISTS fx_weather_season (
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
    row = conn.execute("SELECT data FROM fx_weather_season WHERE tenant_id = ?", (tenant_id,)).fetchone()
    if row:
        try:
            return json.loads(row["data"])
        except (TypeError, ValueError):
            pass
    return None


def _put(conn, tenant_id, data):
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO fx_weather_season (tenant_id, data, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        (tenant_id, json.dumps(data), stamp))
    conn.commit()


def _fresh(now):
    # ein frischer Garten ist feucht, sonst hingen die Blumen gleich die Köpfe
    return {"levels": {"leaves": 0.0, "water": 60.0, "weeds": 0.0, "heat": 0.0}, "at": now, "top": {}, "pull": []}


def _clamp(v):
    return max(0.0, min(100.0, v))


def _out(data):
    top = {}
    for theme, board in data.get("top", {}).items():
        rows = sorted(board.values(), key=lambda e: -e[1])
        top[theme] = [list(e) for e in rows[:TOP]]
    return {"levels": {k: round(v, 2) for k, v in data["levels"].items()}, "top": top,
            "grow": dict(data.get("grow", {}))}


def _stage(n):
    return sum(1 for s in GROW_STEPS if n >= s)


def grow_stages(conn, tenant_id) -> dict:
    """→ {name klein: Stufe 1|2} der Blumen, die schon gewachsen sind."""
    data = _get(conn, tenant_id) or {}
    return {k: _stage(n) for k, n in data.get("grow", {}).items() if _stage(n) > 0}


def _grow(data, flower, who, now):
    """Gießen für die Blume `flower` zählen (Abklingzeit je Zuschauer)."""
    key, w = flower.strip().lower(), (who or "").strip().lower()
    grow, cd = data.setdefault("grow", {}), data.setdefault("growcd", {})
    for k in [k for k, t in cd.items() if now - t >= GROW_COOLDOWN]:
        del cd[k]
    before = _stage(grow.get(key, 0))
    # ohne Namen (Dashboard-Knopf des Streamers) zählt jedes Gießen
    counted = (not w or w not in cd) and before < len(GROW_STEPS)
    if counted:
        grow[key] = grow.get(key, 0) + 1
        if w:
            cd[w] = now
    after = _stage(grow.get(key, 0))
    return {"flower": flower.strip(), "stage": after, "up": after > before, "counted": counted}


def _count(data, theme, name):
    if name:
        board = data.setdefault("top", {}).setdefault(theme, {})
        entry = board.get(name.lower(), [name, 0])
        board[name.lower()] = [name, entry[1] + 1]


def load(conn, tenant_id) -> dict:
    return _out(_get(conn, tenant_id) or _fresh(None))


def advance(conn, tenant_id, now, theme: str, w: dict, rate: float = 1.0) -> dict:
    """w: wirksames Wetter {wind, rain, snow, heat, sun, night, blizzard} (je 0..1),
    optional temp (°C, nur bei echtem Wetter)."""
    data = _get(conn, tenant_id)
    if data is None:
        _put(conn, tenant_id, _fresh(now))
        return _out(_fresh(now))
    last = data.get("at")
    last = now if last is None else last
    m = max(0.0, now - last) / 60
    lv = data["levels"]
    before = dict(lv)
    if theme == "autumn":
        if w.get("blizzard", 0) > 0.5:
            # Schneesturm pustet den Laubhaufen weg
            lv["leaves"] = _clamp(lv["leaves"] - 25 * m)
        else:
            lv["leaves"] = _clamp(lv["leaves"] + (1 + 2 * min(1, abs(w.get("wind", 0)))) * rate * m)
    elif theme == "spring":
        dry = 6 if w.get("heat", 0) > 0.5 else 2
        lv["water"] = _clamp(lv["water"] + (30 * w.get("rain", 0) - dry) * m)
        lv["weeds"] = _clamp(lv["weeds"] + 1 * rate * m)
    elif theme == "summer":
        if w.get("snow", 0) > 0.2:
            per = -25       # Schnee kühlt den Strand schnell
        elif w.get("rain", 0) > 0.2:
            per = -10
        elif w.get("heat", 0) > 0.5:
            per = 20
        elif w.get("temp") is not None and w["temp"] < 15:
            per = -8        # kalter Ort: kühlt auch bei Sonne
        elif w.get("night", 0) > 0.5:
            per = -3
        elif w.get("sun", 0) > 0.4:
            per = 2
        else:
            per = -4        # bewölkt, ohne Sonne: kühlt langsam ab
        lv["heat"] = _clamp(lv["heat"] + per * rate * m)
    changed = any(abs(lv[k] - before[k]) >= 0.5 for k in LEVELS)
    if changed or now - last >= 60:
        data["at"] = now
        _put(conn, tenant_id, data)
    return _out(data)


def _fires(data, now) -> list:
    """Laufende Feuer (Ende je Feuer, ältestes zuerst); übernimmt den alten
    Einzel-Stand "fire" und wirft abgelaufene weg."""
    old = data.pop("fire", None)
    fires = data.setdefault("fires", [])
    if old:
        fires.insert(0, old["until"])
    fires[:] = [u for u in fires if now < u]
    return fires


def ignite(conn, tenant_id, now, wet: bool = False) -> dict:
    """Blitz schlägt ins Laub oder ein Feuer springt über (meldet das Overlay):
    brennt eine Weile, bis es von selbst ausgeht oder jemand löscht. Das Loch
    brennt das Overlay nur an der Stelle; der gemeinsame Laubstand beider
    Haufen bleibt. Bis zu FIRE_MAX gleichzeitig, darüber passiert nichts
    → {"secs", "fires"}."""
    data = _get(conn, tenant_id) or _fresh(now)
    fires = _fires(data, now)
    if len(fires) >= FIRE_MAX:
        return {"secs": 0, "fires": len(fires)}
    secs = FIRE_WET_SECS if wet else FIRE_SECS
    fires.append(now + secs)
    _put(conn, tenant_id, data)
    return {"secs": secs, "fires": len(fires)}


def use(conn, tenant_id, cmd: str, name: str, now, force: bool = False, need: int = 3, win: int = 20,
        target: str = "") -> dict:
    """Chat-/Mod-Aktion → {"done", "level"} (Jäten zusätzlich success/count/need,
    Gießen mit `target` zusätzlich flower/stage/up/counted)."""
    data = _get(conn, tenant_id) or _fresh(now)
    lv, theme = data["levels"], THEME_OF[cmd]
    out = {}
    if cmd == "rake":
        done = min(5, lv["leaves"]); lv["leaves"] -= done; key = "leaves"
    elif cmd == "sweep":
        done = lv["leaves"]; lv["leaves"] = 0; key = "leaves"
    elif cmd == "leafstorm":
        # Mods: ein Windstoß weht Laub auf den Haufen (+25 %)
        done = min(LEAFSTORM, 100 - lv["leaves"]); lv["leaves"] += done; key = "leaves"
    elif cmd == "extinguish":
        # löscht das älteste laufende Feuer; ohne Feuer zählt es nicht
        fires = _fires(data, now)
        done = 1 if fires else 0
        if fires:
            fires.pop(0)
        out["fires"] = len(fires)   # brennen danach noch
        key = "leaves"
    elif cmd == "water":
        done = min(10, 100 - lv["water"]); lv["water"] += done; key = "water"
        if target and target.strip():
            out.update(_grow(data, target, name, now))
    elif cmd == "splash":
        done = min(5, lv["heat"]); lv["heat"] -= done; key = "heat"
    elif cmd == "cool":
        done = lv["heat"]; lv["heat"] = 0; key = "heat"
    else:  # weed
        key = "weeds"
        start = lv["weeds"]
        if force:
            lv["weeds"] = start / 2
            out.update(success=True, count=0, need=need)
        else:
            lv["weeds"] = max(0.0, start - 3)
            hits = [h for h in data.get("pull", []) if now - h[1] <= win and h[0] != (name or "?").lower()]
            hits.append([(name or "?").lower(), now])
            success = len(hits) >= need
            if success:
                lv["weeds"] /= 2
                hits = []
            data["pull"] = hits
            out.update(success=success, count=0 if success else len(hits), need=need)
        done = start - lv["weeds"]
    if done > 0 and cmd in ("rake", "extinguish", "water", "weed", "splash") and not force:
        # Löschen hat eine eigene Rangliste („Top firefighters“), nicht die der Laubrecher
        _count(data, "fire" if cmd == "extinguish" else theme, name)
    _put(conn, tenant_id, data)
    out.update(done=round(done, 2), level=round(lv[key], 2))
    return out


def clear(conn, tenant_id, now, kind: str) -> None:
    """kind: leaves | garden | heat – Stand und Rangliste des Themas löschen."""
    data = _get(conn, tenant_id) or _fresh(now)
    theme = {"leaves": "autumn", "garden": "spring", "heat": "summer"}[kind]
    for k in {"leaves": ("leaves",), "garden": ("water", "weeds"), "heat": ("heat",)}[kind]:
        data["levels"][k] = 60.0 if k == "water" else 0.0
    data.get("top", {}).pop(theme, None)
    if theme == "autumn":
        data.get("top", {}).pop("fire", None)
    _put(conn, tenant_id, data)
