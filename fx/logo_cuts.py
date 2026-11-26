"""Ausgeschnittene Teile für Logo 3D (widgets/logo-3d.html), bearbeitet im Logo-Cut-Editor (tools/logo-cut.html).

Global, eine Datei data/logo-cuts.json: Schlüssel = Bilddatei in assets/ (Streifen- oder Textbild), Wert = Liste
der Teile {poly: [[x, y], …], holes: [[[x, y], …], …]} in Pixeln des Originalbilds. Gibt es für ein Bild einen
Eintrag, nimmt das Widget diese Teile statt der automatischen Zerlegung.
"""
import json
import math
import os
import re
import tempfile
import threading

FILE_RE = re.compile(r"^[\w.-]+\.(png|webp|jpg)$", re.I)
MAX_PARTS = 40
MAX_POINTS = 600
MAX_HOLES = 8
MAX_COORD = 20000

_lock = threading.Lock()


def path(root: str) -> str:
    return os.path.join(root, "data", "logo-cuts.json")


def load(root: str) -> dict:
    """{bild: [teil, …]}; fehlende oder kaputte Datei = keine."""
    try:
        with open(path(root), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    cuts = data.get("cuts") if isinstance(data, dict) else None
    return cuts if isinstance(cuts, dict) else {}


def images(root: str) -> list:
    """Bilddateien in assets/, die als Logo-Bild in Frage kommen."""
    try:
        names = os.listdir(os.path.join(root, "assets"))
    except OSError:
        return []
    return sorted(n for n in names if FILE_RE.match(n))


def _ring(pts):
    if not isinstance(pts, list) or not 3 <= len(pts) <= MAX_POINTS:
        return None
    out = []
    for p in pts:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            return None
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and abs(v) <= MAX_COORD for v in p):
            return None
        out.append([round(p[0], 2), round(p[1], 2)])
    return out


def clean(parts):
    """Geprüfte, gerundete Teile oder Fehlertext."""
    if not isinstance(parts, list) or not 1 <= len(parts) <= MAX_PARTS:
        return "1 to %d parts expected" % MAX_PARTS
    out = []
    for i, part in enumerate(parts):
        if not isinstance(part, dict):
            return "Part %d: object expected" % (i + 1)
        poly = _ring(part.get("poly"))
        if poly is None:
            return "Part %d: outline needs 3 to %d valid points" % (i + 1, MAX_POINTS)
        holes_in = part.get("holes") or []
        if not isinstance(holes_in, list) or len(holes_in) > MAX_HOLES:
            return "Part %d: at most %d holes" % (i + 1, MAX_HOLES)
        holes = []
        for h in holes_in:
            r = _ring(h)
            if r is None:
                return "Part %d: hole needs 3 to %d valid points" % (i + 1, MAX_POINTS)
            holes.append(r)
        out.append({"poly": poly, "holes": holes})
    return out


def _write(root: str, cuts: dict) -> None:
    p = path(root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".logo-cuts-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "cuts": cuts}, f, ensure_ascii=False)
        os.replace(tmp, p)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def save(root: str, file: str, parts) -> str | None:
    """Speichert die Teile eines Bilds; Fehlertext oder None."""
    if not isinstance(file, str) or not FILE_RE.match(file):
        return "Invalid image name"
    if not os.path.isfile(os.path.join(root, "assets", file)):
        return "Image not found in assets/"
    res = clean(parts)
    if isinstance(res, str):
        return res
    with _lock:
        cuts = load(root)
        cuts[file] = res
        _write(root, cuts)
    return None


def delete(root: str, file: str) -> bool:
    with _lock:
        cuts = load(root)
        if file not in cuts:
            return False
        del cuts[file]
        _write(root, cuts)
    return True
