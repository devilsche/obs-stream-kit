"""Fahrzeuge und Felgen aus dem Auto-Editor (tools/car-editor.html) für den BMW-Regen.

Global für alle Kanäle, wie die Enten-Outfits (fx/duck_outfits.py):
- data/car-vehicles.json: Schlüssel = Modell-Schlüssel aus dem Katalog (data/car-rain/catalog.json),
  Wert = Einstellungen aus dem Car editor {label, mix, paints: [{c, w}], rim}
- data/car-rims.json: Schlüssel = Felge, Wert = Felgen-Bauplan {style, n, dish, finish, …}
- data/car-picks.json: Auswahl im Auto-Picker (tools/car-picker.html), Schlüssel = Sketchfab-uid, Wert = {keep: bool}

Regen und Tools laden beides als Script (/s/<token>/api/fx/cars/custom.js), das
ToyCars.applyCustom(...) aufruft — nach js/toy-cars.js, vor dem Effekt-Code.
"""
import json
import math
import os
import re
import tempfile
import threading

KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
MAX_DEF_BYTES = 256 * 1024   # viele gewählte Teile mit langen Namen (Lack, Räder, Farbbereiche)
MAX_DEPTH = 8
KINDS = {"vehicles": 200, "rims": 200, "picks": 600, "scan": 600}   # picks: Auswahl im Car-Picker, scan: Vermessung (Sketchfab-uid → …)

_lock = threading.Lock()


def path(root: str, kind: str) -> str:
    return os.path.join(root, "data", "car-" + kind + ".json")


def load(root: str, kind: str) -> dict:
    """Gespeicherte Einträge {key: def}; fehlende oder kaputte Datei = keine."""
    try:
        with open(path(root, kind), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    items = data.get(kind) if isinstance(data, dict) else None
    return items if isinstance(items, dict) else {}


def _depth(v, d=0) -> int:
    if isinstance(v, dict):
        return max([_depth(x, d + 1) for x in v.values()] or [d + 1])
    if isinstance(v, list):
        return max([_depth(x, d + 1) for x in v] or [d + 1])
    return d


def validate(kind: str, key, d) -> str | None:
    """Fehlertext oder None."""
    if kind not in KINDS:
        return "Unknown kind"
    if not isinstance(key, str) or not KEY_RE.match(key):
        return "Name: lowercase letters, digits and dashes (max 32)"
    if not isinstance(d, dict):
        return "Definition must be an object"
    if _depth(d) > MAX_DEPTH:
        return "Definition is nested too deeply"
    if len(json.dumps(d)) > MAX_DEF_BYTES:
        return "Definition is too large"
    label = d.get("label")
    if label is not None and (not isinstance(label, str) or len(label) > 40):
        return "Label: text up to 40 characters"
    if "sound" in d:
        err = _sound_err(d["sound"])
        if err:
            return "Sound: " + err
    return None


def _num(v, lo, hi) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and lo <= v <= hi


# Motorklang je Auto (Abschnitt „Sound“ im Car editor, Laufzeit js/car-engine-audio.js): Aufnahme src (Freesound-ID,
# Datei assets/sounds/engines/src/<id>.mp3) mit markierten Abschnitten in s (null = Abschnitt aus) und Kenndaten
SOUND_SEGS = {"idle": (0.2, 10.0), "start": (0.2, 8.0), "limiter": (0.2, 10.0)}   # [t0, t1], Länge von–bis
SOUND_SWEEPS = {"sweep": 1, "lift": -1}                                          # {t0, t1, rpm0, rpm1}, Richtung
SOUND_KEYS = {"src", "idleRpm", "redline", "gears", "shiftRpm", "steps", "limitStyle", "limitHz"} | set(SOUND_SEGS) | set(SOUND_SWEEPS)
SOUND_MAX_T = 60.0


def _sound_err(s) -> str | None:
    """Fehlertext oder None für def.sound."""
    if not isinstance(s, dict):
        return "must be an object"
    extra = set(s) - SOUND_KEYS
    if extra:
        return "unknown field " + sorted(extra)[0]
    src = s.get("src")
    if src is not None and not (isinstance(src, int) and not isinstance(src, bool) and 0 < src < 10 ** 9):
        return "recording id invalid"
    segs = [k for k in list(SOUND_SEGS) + list(SOUND_SWEEPS) if s.get(k) is not None]
    if segs and src is None:
        return "marked sections need a recording"
    for k, (lo, hi) in SOUND_SEGS.items():
        v = s.get(k)
        if v is None:
            continue
        if not (isinstance(v, list) and len(v) == 2 and all(_num(x, 0, SOUND_MAX_T) for x in v) and lo <= v[1] - v[0] <= hi):
            return k + ": start/end in seconds, %g–%g s long" % (lo, hi)
    for k, sign in SOUND_SWEEPS.items():
        v = s.get(k)
        if v is None:
            continue
        if not (isinstance(v, dict) and set(v) == {"t0", "t1", "rpm0", "rpm1"}):
            return k + ": needs t0, t1, rpm0, rpm1"
        if not (_num(v["t0"], 0, SOUND_MAX_T) and _num(v["t1"], 0, SOUND_MAX_T) and 0.3 <= v["t1"] - v["t0"] <= 20):
            return k + ": start/end in seconds, 0.3–20 s long"
        if not (_num(v["rpm0"], 100, 20000) and _num(v["rpm1"], 100, 20000)):
            return k + ": rpm 100–20000"
        if (v["rpm1"] - v["rpm0"]) * sign < 0.05 * min(v["rpm0"], v["rpm1"]):
            return k + (": rpm must rise" if sign > 0 else ": rpm must fall")
    if "idleRpm" in s and not _num(s["idleRpm"], 200, 6000):
        return "idle rpm 200–6000"
    if "redline" in s and not _num(s["redline"], 1000, 20000):
        return "redline 1000–20000"
    gears = s.get("gears")
    if gears is not None and not (isinstance(gears, int) and not isinstance(gears, bool) and 1 <= gears <= 10):
        return "gears 1–10"
    if "shiftRpm" in s and not _num(s["shiftRpm"], 500, s["redline"] if _num(s.get("redline"), 1000, 20000) else 20000):
        return "shift rpm up to the redline"
    steps = s.get("steps")
    if steps is not None:
        if not (isinstance(steps, list) and len(steps) <= 9 and all(_num(x, 1.0, 3.0) for x in steps)):
            return "gear steps: up to 9 ratios 1.0–3.0"
        if gears is not None and len(steps) != max(0, gears - 1):
            return "gear steps: one less than gears"
    if "limitStyle" in s and s["limitStyle"] not in ("off", "hard", "soft"):
        return "limiter: off, hard or soft"
    if "limitHz" in s and not _num(s["limitHz"], 3, 30):
        return "limiter cuts 3–30 per second"
    return None


def _write(root: str, kind: str, items: dict) -> None:
    p = path(root, kind)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".car-" + kind + "-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"version": 1, kind: items}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, p)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def save(root: str, kind: str, key: str, d: dict) -> str | None:
    """Speichert ein Fahrzeug bzw. eine Felge; Fehlertext oder None."""
    err = validate(kind, key, d)
    if err:
        return err
    with _lock:
        items = load(root, kind)
        if key not in items and len(items) >= KINDS[kind]:
            return "Too many saved entries"
        items[key] = d
        _write(root, kind, items)
    return None


def delete(root: str, kind: str, key: str) -> bool:
    if kind not in KINDS:
        return False
    with _lock:
        items = load(root, kind)
        if key not in items:
            return False
        del items[key]
        _write(root, kind, items)
    return True


def _js(v) -> str:
    return json.dumps(v, ensure_ascii=True, separators=(",", ":")).replace("</", "<\\/")


def script(vehicles: dict, rims: dict) -> str:
    """JavaScript, das eigene Felgen und Fahrzeuge anmeldet; '</' maskiert, falls es je inline landet."""
    return ("window.ToyCars && ToyCars.applyCustom && ToyCars.applyCustom("
            + _js({"rims": rims, "vehicles": vehicles}) + ");\n")
