"""Alle Kandidaten im Car-Picker vermessen: Modell (einmal) von Sketchfab holen, Innenraum ja/nein.

Ergebnis je Sketchfab-uid in data/car-scan.json (fx/car_models, Art "scan"); der Picker zeigt es an.
Aufruf im Projektordner (läuft lange, lädt jedes Modell einmal):  python3 scripts/scan_car_candidates.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fx import car_models, glb_scan, sketchfab  # noqa: E402


def main(root="."):
    cands = json.load(open(os.path.join(root, "assets", "cars", "candidates.json"), encoding="utf-8"))
    done = car_models.load(root, "scan")
    for i, c in enumerate(cands):
        uid = c["uid"]
        if uid in done and "interior" in done[uid]:
            continue
        try:
            path = sketchfab.fetch(root, uid)
            res = glb_scan.scan(path)
        except Exception as e:   # einzelnes Modell kaputt/verweigert: vermerken, weiter
            res = {"error": str(e)[:120]}
        car_models.save(root, "scan", uid, res)
        print("%3d/%d %-50s %s" % (i + 1, len(cands), c["name"][:50], res), flush=True)
        time.sleep(0.5)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
