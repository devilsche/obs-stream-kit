"""Umgebaute und selbst gebaute Gummienten-Outfits aus dem Duck-Editor (tools/duck-editor.html).

Global für alle Kanäle: eine Datei data/duck-outfits.json, Schlüssel = Outfit-Name
(überschreibt ein Outfit aus js/rubber-duck-outfits.js oder legt ein neues an).
Die Effekte und Tools laden sie als Script (/s/<token>/api/fx/ducks/custom.js),
das RubberDuck.applyCustom(...) aufruft — synchron vor dem Effekt-Code, damit
mix/random die eigenen Outfits schon kennen.
"""
import json
import os
import re
import tempfile
import threading

KEY_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
MAX_DEF_BYTES = 64 * 1024
MAX_OUTFITS = 300
MAX_DEPTH = 8

_lock = threading.Lock()


def path(root: str) -> str:
    return os.path.join(root, "data", "duck-outfits.json")


def load(root: str) -> dict:
    """Alle gespeicherten Outfits {key: def}; fehlende oder kaputte Datei = keine."""
    try:
        with open(path(root), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    outfits = data.get("outfits") if isinstance(data, dict) else None
    return outfits if isinstance(outfits, dict) else {}


def _depth(v, d=0) -> int:
    if isinstance(v, dict):
        return max([_depth(x, d + 1) for x in v.values()] or [d + 1])
    if isinstance(v, list):
        return max([_depth(x, d + 1) for x in v] or [d + 1])
    return d


def validate(key, d) -> str | None:
    """Fehlertext oder None."""
    if not isinstance(key, str) or not KEY_RE.match(key):
        return "Name: lowercase letters, digits and dashes, starting with a letter (max 32)"
    if not isinstance(d, dict):
        return "Outfit must be an object"
    label = d.get("label")
    if label is not None and (not isinstance(label, str) or len(label) > 40):
        return "Label: text up to 40 characters"
    if _depth(d) > MAX_DEPTH:
        return "Outfit is nested too deeply"
    if len(json.dumps(d)) > MAX_DEF_BYTES:
        return "Outfit is too large"
    return None


def _write(root: str, outfits: dict) -> None:
    p = path(root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".duck-outfits-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "outfits": outfits}, f, ensure_ascii=False, indent=1)
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


def script(outfits: dict) -> str:
    """JavaScript, das die Outfits anmeldet; '</' maskiert, falls es je inline landet."""
    body = json.dumps(outfits, ensure_ascii=True, separators=(",", ":")).replace("</", "<\\/")
    return "window.RubberDuck && RubberDuck.applyCustom && RubberDuck.applyCustom(" + body + ");\n"
