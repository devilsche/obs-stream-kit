"""Fahrzeuge und Felgen aus dem Auto-Editor (tools/car-editor.html) für den BMW-Regen.

Global für alle Kanäle, wie die Enten-Outfits (fx/duck_outfits.py):
- data/car-vehicles.json: Schlüssel = Fahrzeug (überschreibt ein eingebautes aus js/toy-cars.js
  oder legt ein neues an), Wert = Aufbau {label, body, rims, tires, parts, paints, …}
- data/car-rims.json: Schlüssel = Felge, Wert = Felgen-Bauplan {style, n, dish, finish, …}
- data/car-picks.json: Auswahl im Auto-Picker (tools/car-picker.html), Schlüssel = Sketchfab-uid, Wert = {keep: bool}

Regen und Tools laden beides als Script (/s/<token>/api/fx/cars/custom.js), das
ToyCars.applyCustom(...) aufruft — nach js/toy-cars.js, vor dem Effekt-Code.
"""
import json
import os
import re
import tempfile
import threading

KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
MAX_DEF_BYTES = 32 * 1024
MAX_DEPTH = 8
KINDS = {"vehicles": 200, "rims": 200, "picks": 600}   # picks: Auswahl im Auto-Picker (Sketchfab-uid → {keep})

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
