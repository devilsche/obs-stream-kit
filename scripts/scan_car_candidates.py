"""Alle Kandidaten im Car-Picker vermessen: Modell (einmal) von Sketchfab holen, Innenraum ja/nein.

Ergebnis je Sketchfab-uid in data/car-scan.json (fx/car_models, Art "scan"); der Picker zeigt es an.
Aufruf im Projektordner (läuft lange, lädt jedes Modell einmal):  python3 scripts/scan_car_candidates.py
Schonend: höchstens ein neuer Download alle PACE Sekunden, bei 429 (Sketchfab-Bremse) PAUSE Sekunden warten.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fx import car_models, glb_scan, sketchfab  # noqa: E402


PACE = 120
PAUSE = 20 * 60


def main(root="."):
    cands = json.load(open(os.path.join(root, "assets", "cars", "candidates.json"), encoding="utf-8"))
    # zuerst die im Picker behaltenen
    picks = car_models.load(root, "picks")
    cands.sort(key=lambda c: 0 if (picks.get(c["uid"]) or {}).get("keep") or (c.get("have") and c["uid"] not in picks) else 1)
    done = car_models.load(root, "scan")
    for i, c in enumerate(cands):
        uid = c["uid"]
        if uid in done and "wheels" in done[uid]:
            continue
        fresh = not sketchfab.cached(root, uid)
        while True:
            try:
                res = glb_scan.scan(sketchfab.fetch(root, uid))
            except sketchfab.RateLimited:
                print("rate limited, pausing %d min" % (PAUSE // 60), flush=True)
                time.sleep(PAUSE)
                continue
            except Exception as e:   # einzelnes Modell kaputt/verweigert: vermerken, weiter
                res = {"error": str(e)[:120]}
            break
        car_models.save(root, "scan", uid, res)
        print("%3d/%d %-50s %s" % (i + 1, len(cands), c["name"][:50], res), flush=True)
        if fresh:
            time.sleep(PACE)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
