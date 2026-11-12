"""Jahreszeiten-Mechaniken der Weather-Source (Herbst, Frühling, Sommer),
angetrieben vom wirksamen Wetter. Ein JSON-Stand je Tenant:

- Herbst `leaves`: Laub fällt stetig mit (1 + 2 × Wind) %/min × rate;
  `rake` −5 (Rangliste), `sweep` (Mods) fegt alles weg.
- Frühling `water`: trocknet mit 2 %/min (Hitze 6), Regen gießt mit
  30 %/min × Regenmenge, `water` +10; `weeds` wächst mit 1 %/min, `weed`
  −3, eine Gruppe (3 Namen in 20 s) halbiert, `force` (Mods) halbiert sofort.
  Gießen und Jäten zählen für die Rangliste. Gießen lässt außerdem eine
  Blume wachsen (`flowers` = Namen im Bild): die eigene (alle OWN_COOLDOWN s),
  sonst eine zufällige, noch nicht ausgewachsene oder eingegangene; jedes
  Gießen eine Stufe, höchstens 2. Wasser hat jede Blume für sich (`fw`): die
  Gießkanne gibt nur der gegossenen CAN %, der Rasensprenger (`sprinkler`)
  allen SPRINKLER %, Regen gießt alle, Trocknen trifft alle. Unter DEAD %
  geht eine Blume ein, zurück über REVIVE % lebt sie auf Stufe 0 wieder auf.
  Regen und Sprenger lassen nichts wachsen.
- Sommer `heat`: steigt bei Hitzewelle mit 20 %/min, bei Sonne am Tag mit
  2 %/min, sinkt bei Regen mit 10 %/min und nachts mit 3 %/min; `splash` −5
  (Rangliste), `cool` (Mods) kühlt ganz ab.

Fortgeschrieben wird nur das aktive Thema. DAO im sqlite-Stil.
"""
import datetime
import json
import random

TOP = 5
LEVELS = ("leaves", "water", "weeds", "heat")
THEME_OF = {"rake": "autumn", "sweep": "autumn", "leafstorm": "autumn", "extinguish": "autumn", "water": "spring", "weed": "spring",
            "sprinkler": "spring",
            "splash": "summer", "cool": "summer"}
FIRE_SECS = 30        # so lange brennt es trocken, im Regen nur kurz
FIRE_WET_SECS = 8
FIRE_MAX = 5          # so viele Feuer brennen höchstens gleichzeitig
RAIN_OUT_SECS = 4     # so schnell löscht Regen ein laufendes Feuer
LEAFSTORM = 25        # so viel Laub weht der Laubsturm auf den Haufen
GROW_STEPS = (1, 2)   # so oft gegossen → Blume Stufe 1, Stufe 2 (jedes Gießen eine Stufe)
OWN_COOLDOWN = 300    # die eigene Blume gießt ein Zuschauer höchstens so oft
ANY_COOLDOWN = 10     # sonst (zufällige, nicht ausgewachsene Blume) so oft
DEAD, REVIVE = 15, 30  # unter DEAD % Wasser geht eine Blume ein; zurück über REVIVE: Stufe 0
CAN = 25              # Gießkanne: so viel Wasser für die eine Blume
SPRINKLER = 30        # Rasensprenger: so viel für alle

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
    levels = {k: round(v, 2) for k, v in data["levels"].items()}
    # Frühling je Blume: Wasser, eingegangen, Wachstumsstufe
    levels["flowers"] = {k: round(v, 1) for k, v in data.get("fw", {}).items()}
    levels["deadFlowers"] = list(data.get("fdead", []))
    levels["stages"] = {k: _stage(n) for k, n in data.get("grow", {}).items() if _stage(n) > 0}
    return {"levels": levels, "top": top, "grow": dict(data.get("grow", {}))}


def _stage(n):
    return sum(1 for s in GROW_STEPS if n >= s)


def grow_stages(conn, tenant_id) -> dict:
    """→ {name klein: Stufe 1|2} der Blumen, die schon gewachsen sind."""
    data = _get(conn, tenant_id) or {}
    return {k: _stage(n) for k, n in data.get("grow", {}).items() if _stage(n) > 0}


def _pick(data, names, who, now, rnd):
    """Welche Blume gießt `who`? → (Name, Abklingzeit-Schlüssel) oder (None, None).
    Die eigene (höchstens alle OWN_COOLDOWN s), sonst eine zufällige, die noch
    nicht ausgewachsen ist (je Zuschauer alle ANY_COOLDOWN s); ohne Namen
    (Dashboard-Knopf) immer zufällig und ohne Sperre."""
    cd, grow, w = data.setdefault("growcd", {}), data.get("grow", {}), (who or "").strip().lower()
    for k in [k for k, t in cd.items() if now - t >= (OWN_COOLDOWN if k.startswith("own:") else ANY_COOLDOWN)]:
        del cd[k]
    own = [n for n in names if w and n.lower() == w]
    if own and "own:" + w not in cd:
        return own[0], "own:" + w
    if w and "any:" + w in cd:
        return None, None
    dead = set(data.get("fdead", []))
    open_ = [n for n in names if (_stage(grow.get(n.lower(), 0)) < len(GROW_STEPS) or n.lower() in dead) and n.lower() != w]
    pool = open_ or list(names)
    return (rnd.choice(pool), "any:" + w if w else None) if pool else (None, None)


def _grow(data, flower, cd_key, now):
    """Eine Stufe für `flower` (höchstens bis ausgewachsen)."""
    key = flower.strip().lower()
    grow = data.setdefault("grow", {})
    before = _stage(grow.get(key, 0))
    counted = before < len(GROW_STEPS)
    if counted:
        grow[key] = grow.get(key, 0) + 1
    if cd_key:
        data.setdefault("growcd", {})[cd_key] = now
    after = _stage(grow.get(key, 0))
    return {"flower": flower.strip(), "stage": after, "up": after > before, "counted": counted}


def _fw(data, names=None) -> dict:
    """Wasser je Blume {name klein: %}; mit `names` (Blumen im Bild) bekommt
    jede einen Eintrag (neu: Stand des Bodens), andere fallen weg."""
    fw = data.setdefault("fw", {})
    if names is not None:
        keep = {n.lower() for n in names}
        for k in [k for k in fw if k not in keep]:
            del fw[k]
        for k in keep:
            fw.setdefault(k, data["levels"]["water"])
    return fw


def _life(data) -> list:
    """Eingehen und Aufleben je Blume: unter DEAD % eingegangen, zurück über
    REVIVE % lebt sie wieder auf und steht auf Stufe 0. → Namen der aufgelebten."""
    dead, grow, revived = set(data.get("fdead", [])), data.setdefault("grow", {}), []
    for k, v in _fw(data).items():
        if v < DEAD:
            dead.add(k)
        elif v >= REVIVE and k in dead:
            dead.discard(k)
            grow.pop(k, None)
            revived.append(k)
    data["fdead"] = sorted(dead)
    return revived


def _count(data, theme, name):
    if name:
        board = data.setdefault("top", {}).setdefault(theme, {})
        entry = board.get(name.lower(), [name, 0])
        board[name.lower()] = [name, entry[1] + 1]


def load(conn, tenant_id) -> dict:
    return _out(_get(conn, tenant_id) or _fresh(None))


def advance(conn, tenant_id, now, theme: str, w: dict, rate: float = 1.0, flowers=None) -> dict:
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
    doused = False
    if theme == "autumn":
        if w.get("blizzard", 0) > 0.5:
            # Schneesturm pustet den Laubhaufen weg
            lv["leaves"] = _clamp(lv["leaves"] - 25 * m)
        else:
            lv["leaves"] = _clamp(lv["leaves"] + (1 + 2 * min(1, abs(w.get("wind", 0)))) * rate * m)
        if w.get("rain", 0) > 0.2 and data.get("fires"):
            # Regen löscht laufende Feuer nach ein paar Sekunden (wie im Overlay)
            data["fires"] = [min(u, now + RAIN_OUT_SECS) for u in _fires(data, now)]
            doused = True
    elif theme == "spring":
        dry = 6 if w.get("heat", 0) > 0.5 else 2
        delta = (30 * w.get("rain", 0) - dry) * m
        # jede Blume trocknet gleich, Regen gießt alle (neue zuerst mit dem Bodenstand anlegen)
        fw = _fw(data, flowers)
        lv["water"] = _clamp(lv["water"] + delta)
        for k in fw:
            fw[k] = _clamp(fw[k] + delta)
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
    changed = any(abs(lv[k] - before[k]) >= 0.5 for k in LEVELS) or doused
    if theme == "spring":
        before_dead = list(data.get("fdead", []))
        if _life(data) or data.get("fdead", []) != before_dead or flowers is not None and set(data.get("fw", {})) != {n.lower() for n in flowers}:
            changed = True
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
        flowers=None, rnd=None) -> dict:
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
        # Gießkanne: nur die eine Blume bekommt Wasser
        key, done = "water", 0
        fw = _fw(data, flowers) if flowers else _fw(data)
        pick, cd_key = _pick(data, flowers, name, now, rnd or random) if flowers else (None, None)
        if pick:
            k = pick.lower()
            before = fw.get(k, lv["water"])
            fw[k] = min(100.0, before + CAN)
            done = fw[k] - before
            out["flower_level"] = round(fw[k], 1)
            if k in _life(data):
                # aufgelebt: wieder Stufe 0, dieses Gießen lässt sie nicht wachsen
                out.update(flower=pick.strip(), stage=0, up=False, counted=False, revived=True)
                if cd_key:
                    data.setdefault("growcd", {})[cd_key] = now
            else:
                out.update(_grow(data, pick, cd_key, now))
    elif cmd == "sprinkler":
        # Rasensprenger: alle Blumen und der Boden bekommen Wasser, wachsen lässt er nichts
        key = "water"
        done = min(SPRINKLER, 100 - lv["water"]); lv["water"] += done
        fw = _fw(data, flowers) if flowers else _fw(data)
        for k in fw:
            fw[k] = min(100.0, fw[k] + SPRINKLER)
        out["revived"] = _life(data)
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
    if kind == "garden":
        data["fw"], data["fdead"] = {}, []
    data.get("top", {}).pop(theme, None)
    if theme == "autumn":
        data.get("top", {}).pop("fire", None)
    _put(conn, tenant_id, data)
