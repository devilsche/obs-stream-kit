"""Umgebaute und selbst gebaute Gummienten-Outfits aus dem Duck-Editor (tools/duck-editor.html).

Global für alle Kanäle: eine Datei data/duck-outfits.json, Schlüssel = Outfit-Name
(überschreibt ein Outfit aus js/rubber-duck-outfits.js oder legt ein neues an).
Die Effekte und Tools laden sie als Script (/s/<token>/api/fx/ducks/custom.js),
das RubberDuck.applyCustom(...) aufruft — synchron vor dem Effekt-Code, damit
mix/random die eigenen Outfits schon kennen.

Dazu global umgebaute Teile (Part-Werkstatt): data/duck-parts.json, Schlüssel = Teil
(cap, helmet, … bzw. acc:<Baustein>), Wert = Anpassung {p, r, s, c, hide, sub}; gilt
in jedem Outfit, das dieses Teil trägt.
"""
import json
import os
import re
import tempfile
import threading

KEY_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
MAX_DEF_BYTES = 64 * 1024
MAX_OUTFITS = 300
MAX_DEPTH = 12
PART_KEY_RE = re.compile(r"^(bill|wingL|wingR|eyes|helmet|cap|ears|cape|acc:[a-z][a-zA-Z0-9_-]{0,39})$")
MAX_PARTS = 200

_lock = threading.Lock()


def path(root: str, name: str = "outfits") -> str:
    return os.path.join(root, "data", "duck-" + name + ".json")


def _load(root: str, name: str) -> dict:
    try:
        with open(path(root, name), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    items = data.get(name) if isinstance(data, dict) else None
    return items if isinstance(items, dict) else {}


def load(root: str) -> dict:
    """Alle gespeicherten Outfits {key: def}; fehlende oder kaputte Datei = keine."""
    return _load(root, "outfits")


def load_parts(root: str) -> dict:
    """Global umgebaute Teile {key: xf}."""
    return _load(root, "parts")


def _depth(v, d=0) -> int:
    if isinstance(v, dict):
        return max([_depth(x, d + 1) for x in v.values()] or [d + 1])
    if isinstance(v, list):
        return max([_depth(x, d + 1) for x in v] or [d + 1])
    return d


def _check_body(d, what: str) -> str | None:
    if not isinstance(d, dict):
        return what + " must be an object"
    if _depth(d) > MAX_DEPTH:
        return what + " is nested too deeply"
    if len(json.dumps(d)) > MAX_DEF_BYTES:
        return what + " is too large"
    return None


def validate(key, d) -> str | None:
    """Fehlertext oder None."""
    if not isinstance(key, str) or not KEY_RE.match(key):
        return "Name: lowercase letters, digits and dashes, starting with a letter (max 32)"
    err = _check_body(d, "Outfit")
    if err:
        return err
    label = d.get("label")
    if label is not None and (not isinstance(label, str) or len(label) > 40):
        return "Label: text up to 40 characters"
    return None


def validate_part(key, xf) -> str | None:
    if not isinstance(key, str) or not PART_KEY_RE.match(key):
        return "Unknown part"
    return _check_body(xf, "Part")


def _write(root: str, items: dict, name: str = "outfits") -> None:
    p = path(root, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".duck-" + name + "-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"version": 1, name: items}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, p)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def save(root: str, key: str, d: dict) -> str | None:
    """Speichert ein Outfit; Fehlertext oder None."""
    err = validate(key, d)
    if err:
        return err
    with _lock:
        outfits = load(root)
        if key not in outfits and len(outfits) >= MAX_OUTFITS:
            return "Too many saved outfits"
        outfits[key] = d
        _write(root, outfits)
    return None


def delete(root: str, key: str) -> bool:
    with _lock:
        outfits = load(root)
        if key not in outfits:
            return False
        del outfits[key]
        _write(root, outfits)
    return True


def save_part(root: str, key: str, xf: dict) -> str | None:
    """Speichert ein global umgebautes Teil; Fehlertext oder None."""
    err = validate_part(key, xf)
    if err:
        return err
    with _lock:
        parts = load_parts(root)
        if key not in parts and len(parts) >= MAX_PARTS:
            return "Too many saved parts"
        parts[key] = xf
        _write(root, parts, "parts")
    return None


def delete_part(root: str, key: str) -> bool:
    with _lock:
        parts = load_parts(root)
        if key not in parts:
            return False
        del parts[key]
        _write(root, parts, "parts")
    return True


def _js(v) -> str:
    return json.dumps(v, ensure_ascii=True, separators=(",", ":")).replace("</", "<\\/")


def script(outfits: dict, parts: dict | None = None) -> str:
    """JavaScript, das Outfits und umgebaute Teile anmeldet; '</' maskiert, falls es je inline landet."""
    js = "window.RubberDuck && RubberDuck.applyCustom && RubberDuck.applyCustom(" + _js(outfits) + ");\n"
    if parts:
        js += "window.RubberDuck && RubberDuck.applyParts && RubberDuck.applyParts(" + _js(parts) + ");\n"
    return js
