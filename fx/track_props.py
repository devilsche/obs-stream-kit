"""Kulissen-Modelle (Sketchfab) für die Strecken-Themen von Car Race und Car Drive.

Aufbereitet von scripts/build_track_props.py, liegen nur auf dem Server (Lizenzen):
  data/track-props/<uid>.glb       ein Modell (Teil eines Pakets: <uid>-<part>.glb), normiert: Meter, Fuß auf y = 0, mittig, Längsseite entlang x
  data/track-props/catalog.json    { "props": [{ uid, key, kind, theme, name, author, license, url, size, tris, bytes }],
                                     "credits": [{ name, author, license, url }] }
Ausgeliefert über /s/<token>/api/fx/track-props/… (fx/endpoints.py) und /drive/a/api/fx/track-props/… (app/views_drive.py);
geladen von js/car-track-scene.js. Fehlt etwas, bleibt die prozedurale Deko stehen.
"""
import json
import os
import re

UID_RE = re.compile(r"^[0-9a-f]{32}(-[a-z0-9]{1,16})?$")   # Paket-Teil: <uid>-<part>


def folder(root):
    return os.path.abspath(os.path.join(root, "data", "track-props"))


def catalog(root):
    """Katalog als Dict; kaputt oder fehlend → leere Listen."""
    try:
        with open(os.path.join(folder(root), "catalog.json"), encoding="utf-8") as f:
            cat = json.load(f)
    except (OSError, ValueError):
        cat = {}
    if not isinstance(cat, dict):
        cat = {}
    props = cat.get("props") if isinstance(cat.get("props"), list) else []
    credits = cat.get("credits") if isinstance(cat.get("credits"), list) else []
    return {"props": props, "credits": credits}


def model_name(root, uid):
    """Dateiname im Ordner oder None (unbekannte/ungültige uid)."""
    if not isinstance(uid, str) or not UID_RE.match(uid):
        return None
    name = uid + ".glb"
    return name if os.path.exists(os.path.join(folder(root), name)) else None
