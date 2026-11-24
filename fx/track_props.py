"""Kulissen-Modelle (Sketchfab) für die Strecken-Themen von Car Race und Car Drive.

Aufbereitet von scripts/build_track_props.py, liegen nur auf dem Server (Lizenzen):
  data/track-props/<uid>.glb       ein Modell (Teil eines Pakets: <uid>-<part>.glb), normiert: Meter, Fuß auf y = 0, mittig, Längsseite entlang x
  data/track-props/catalog.json    { "props": [{ uid, key, kind, theme, name, author, license, url, size, tris, bytes }],
                                     "credits": [{ name, author, license, url }] }
  data/track-props/off.json        { "off": [key, …] } – im Admin ausgeworfene Modelle (tools/tree-picker.html); fehlen im
                                     ausgelieferten Katalog, an ihrem Platz bleibt die prozedurale Deko bzw. ein anderes Modell
Ausgeliefert über /s/<token>/api/fx/track-props/… (fx/endpoints.py) und /drive/a/api/fx/track-props/… (app/views_drive.py);
geladen von js/car-track-scene.js. Fehlt etwas, bleibt die prozedurale Deko stehen.
"""
import json
import os
import re
import threading

UID_RE = re.compile(r"^[0-9a-f]{32}(-[a-z0-9]{1,16})?$")   # Paket-Teil: <uid>-<part>


def folder(root):
    return os.path.abspath(os.path.join(root, "data", "track-props"))


_lock = threading.Lock()


def off_keys(root):
    """Schlüssel der ausgeworfenen Modelle (Menge); kaputt oder fehlend → leer."""
    try:
        with open(os.path.join(folder(root), "off.json"), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return set()
    off = d.get("off") if isinstance(d, dict) else None
    return {k for k in off if isinstance(k, str)} if isinstance(off, list) else set()


def set_off(root, key, off):
    """Modell auswerfen (off=True) oder zurückholen. Nur Schlüssel aus dem Katalog → True, sonst False."""
    if not any(p.get("key") == key for p in catalog(root, include_off=True)["props"]):
        return False
    with _lock:
        keys = off_keys(root)
        if off:
            keys.add(key)
        else:
            keys.discard(key)
        p = os.path.join(folder(root), "off.json")
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"off": sorted(keys)}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, p)
    return True


def catalog(root, include_off=False):
    """Katalog als Dict; kaputt oder fehlend → leere Listen. Ausgeworfene Modelle fehlen – mit include_off=True
    sind sie dabei, jedes Modell mit Feld "off" (für die Auswahlseite)."""
    try:
        with open(os.path.join(folder(root), "catalog.json"), encoding="utf-8") as f:
            cat = json.load(f)
    except (OSError, ValueError):
        cat = {}
    if not isinstance(cat, dict):
        cat = {}
    props = cat.get("props") if isinstance(cat.get("props"), list) else []
    credits = cat.get("credits") if isinstance(cat.get("credits"), list) else []
    props = [p for p in props if isinstance(p, dict)]
    off = off_keys(root)
    if include_off:
        props = [dict(p, off=p.get("key") in off) for p in props]
    elif off:
        props = [p for p in props if p.get("key") not in off]
    return {"props": props, "credits": credits}


def model_name(root, uid):
    """Dateiname im Ordner oder None (unbekannte/ungültige uid)."""
    if not isinstance(uid, str) or not UID_RE.match(uid):
        return None
    name = uid + ".glb"
    return name if os.path.exists(os.path.join(folder(root), name)) else None
