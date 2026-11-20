#!/usr/bin/env python3
"""Rauchtest Car Drive Mehrspieler: startet drive_ws lokal (freier Port, Test-Secret, Ergebnis nur im Speicher),
öffnet einen Raum (1 Runde) über die interne Schnittstelle, stellt N Tickets aus und lässt
scripts/check_car_drive_mp.js mit N Node-Clients fahren.

    python3 scripts/smoke_drive_ws.py [N=3]

Braucht das Paket websockets (>= 13) und Node >= 22 (globales WebSocket/fetch).
"""
import asyncio
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import drive_ws  # noqa: E402
from fx import drive_auth  # noqa: E402

SECRET = "smoke-secret"
SAVED = []


def fake_record(tenant, race_id, rows):
    SAVED.append((tenant, race_id, rows))
    return True, {r["user_id"]: 1 for r in rows}


LAPS = []


def fake_lap(tenant, track, car, uid, display, lap_time, source):
    LAPS.append((uid, lap_time, source))
    return {"personal": True, "car": len(LAPS) == 1, "track": len(LAPS) == 1, "best_car": None, "best_track": None}


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    port = free_port()
    th = threading.Thread(target=lambda: asyncio.run(drive_ws.main("127.0.0.1", port, secret=SECRET, record=fake_record,
                                                             lap_record=fake_lap)),
                          daemon=True)
    th.start()
    base = "http://127.0.0.1:%d" % port
    key = drive_auth.internal_key(SECRET)
    for _ in range(50):
        try:
            req = urllib.request.Request(base + "/internal/open?tenant=1&track=0&laps=1", headers={"X-Drive-Key": key})
            room = json.loads(urllib.request.urlopen(req, timeout=1).read())["room"]
            break
        except OSError:
            time.sleep(0.1)
    else:
        print("FAIL Dienst startet nicht")
        return 1
    code = room["code"]
    print("ok   Raum %s offen (%s, %d Runde)" % (code, room["track_name"], room["laps"]))
    tickets = [drive_auth.make_ticket({"tid": 1, "code": code, "id": "u%d" % i, "login": "u%d" % i,
                                       "display": "Driver%d" % i, "role": "host" if i == 0 else "viewer",
                                       "garage": None, "rnd": None}, secret=SECRET) for i in range(n)]
    rc = subprocess.call(["node", os.path.join(ROOT, "scripts", "check_car_drive_mp.js"),
                          "ws://127.0.0.1:%d" % port, base, code, key, "1"] + tickets)
    print("     gespeichert: %s" % [(r[1], [(x["user_id"], x["place"]) for x in r[2]]) for r in SAVED])
    if rc == 0 and len(SAVED) != 1:
        print("FAIL Ergebnis nicht genau einmal gespeichert")
        rc = 1
    # Rundenrekorde: geprüfte Runden der ehrlichen Fahrer, nie die des Schummlers (letzter Client)
    cheat = "u%d" % (n - 1) if n > 2 else None
    print("     Rekord-Runden: %s" % LAPS)
    if not LAPS or any(u == cheat for u, _, _ in LAPS) or any(src != "room" for _, _, src in LAPS):
        print("FAIL Rekord-Runden: nur geprüfte Runden ehrlicher Fahrer erwartet")
        rc = 1
    else:
        print("ok   Rekord-Runden nur von geprüften Runden (%d)" % len(LAPS))
    return rc


if __name__ == "__main__":
    sys.exit(main())
