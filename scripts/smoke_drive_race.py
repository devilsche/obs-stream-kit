#!/usr/bin/env python3
"""Rauchtest Chatrennen steuerbar: startet drive_ws lokal (freier Port, Test-Secret), gleicht ein Chatrennen ab
(1 Runde, 3 Fahrer), friert 2 Piloten ein, lässt Pilot A über den WS-Dienst eine Runde fahren, Pilot B nach 1 s
wegbrechen – B muss nach ~2 s von der KI übernommen werden, ein Zuschauer (Overlay) muss den Live-Takt von A, die
Übernahme von B und A's Zielzeit sehen, sync meldet beides an Flask zurück. Zweites Rennen: A lässt die KI fahren
(„ai“) und übernimmt wieder („release“) – Overlay sieht beides, sync meldet beides als ai_events.

    python3 scripts/smoke_drive_race.py

Braucht das Paket websockets (>= 13). Dauert ~25 s.
"""
import asyncio
import json
import os
import socket
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from websockets.asyncio.client import connect  # noqa: E402

import drive_ws  # noqa: E402
from fx import drive_auth, drive_race  # noqa: E402

SECRET = "smoke-secret"
fails = 0


def ok(c, msg):
    global fails
    print(("ok   " if c else "FAIL ") + msg)
    if not c:
        fails += 1


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def sync(base, key, info):
    q = urllib.parse.urlencode({"tenant": 1, "race": json.dumps(info)})
    req = urllib.request.Request(base + "/internal/sync?" + q, headers={"X-Drive-Key": key})
    return json.loads(urllib.request.urlopen(req, timeout=2).read())


async def client(port, uid, role, inbox):
    ws = await connect("ws://127.0.0.1:%d/drive-ws/race" % port)
    tk = drive_auth.make_ticket({"tid": 1, "id": uid, "login": uid, "display": uid, "role": role}, secret=SECRET)
    await ws.send(json.dumps({"t": "hello", "ticket": tk}))

    async def reader():
        try:
            async for raw in ws:
                inbox.append(json.loads(raw))
        except Exception:
            pass
    asyncio.get_running_loop().create_task(reader())
    return ws


async def run(port):
    base = "http://127.0.0.1:%d" % port
    key = drive_auth.internal_key(SECRET)
    for _ in range(50):
        try:
            await asyncio.to_thread(sync, base, key, None)
            break
        except OSError:
            await asyncio.sleep(0.1)
    start = time.time() + 3
    info = {"race_id": "smoke-1", "phase": "intro", "starts_at": start, "track": 4, "laps": 1, "fw": 25,
            "racers": [["a", "car-a", 0], ["b", "car-b", 1], ["c", "car-c", 2]], "pilots": None, "taken": []}
    ia, ib, isp = [], [], []
    wa = await client(port, "a", "driver", ia)
    wb = await client(port, "b", "driver", ib)
    await client(port, "spec-1", "spectator", isp)
    await asyncio.sleep(0.3)
    rep = await asyncio.to_thread(sync, base, key, info)
    ok(rep["connected"] == ["a", "b"], "verbundene Fahrer an Flask: %s" % rep["connected"])
    info["pilots"] = rep["connected"]
    await asyncio.to_thread(sync, base, key, info)
    await asyncio.sleep(0.2)
    ok(any(m.get("t") == "race" and m["race"]["pilots"] == ["a", "b"] for m in isp), "Overlay kennt die Piloten")
    L = drive_race.TRACK_LEN[4]   # Kart: kurze Runde (die langen Strecken brauchen ~70 s)
    s0 = -3.0
    t0 = time.time()
    lap_t = 24.0
    while True:
        now = time.time()
        rt = now - start
        prog = s0 if rt < 0 else s0 + (L + 3.5) * min(1.0, rt / lap_t)
        await wa.send(json.dumps({"t": "s", "x": prog, "z": 0, "yaw": 0, "prog": prog, "rt": max(0.0, rt),
                                  "speed": (L + 3.5) / lap_t}))
        if rt < 1.0:
            await wb.send(json.dumps({"t": "s", "x": -10, "z": 2, "yaw": 0, "prog": -10.5, "rt": max(0.0, rt), "speed": 0}))
        elif not wb.state.name == "CLOSED":
            await wb.close()
        if rt > lap_t + 0.5 or now - t0 > 40:
            break
        await asyncio.sleep(0.05)
    await asyncio.sleep(0.3)
    rep = await asyncio.to_thread(sync, base, key, dict(info, phase="race"))
    tk = [m for m in isp if m.get("t") == "takeover"]
    ok(len(tk) == 1 and tk[0]["ev"]["id"] == "b" and 2.0 <= tk[0]["ev"]["t"] <= 3.3,
       "Übernahme von B an den Overlay: %s" % (tk[0]["ev"] if tk else None))
    ok(any(m.get("t") == "S" and any(r[0] == "a" for r in m["d"]) for m in isp), "Overlay bekommt den Live-Takt von A")
    fin = [m for m in isp if m.get("t") == "lap" and m.get("id") == "a"]
    ok(fin and fin[-1].get("fin") and fin[-1]["ok"], "A im Ziel (%s)" % (fin[-1] if fin else None))
    ok(rep["pilots"]["a"]["fin"] and not rep["pilots"]["a"]["invalid"] and rep["pilots"]["b"]["taken"],
       "sync meldet Zielzeit A + Übernahme B: %s" % rep["pilots"])
    ok(any(t["id"] == "b" for t in rep["takeovers"]), "Übernahme als Ereignis für race_events")
    rec = [m for m in isp if m.get("t") == "rec"]
    ok(rec and rec[0]["id"] == "a" and rec[0]["track_rec"], "Rundenrekord von A an den Overlay gemeldet (%s)" % (rec[:1] or None))
    await ai_round(port, base, key)


async def ai_round(port, base, key):
    start = time.time() + 1
    info = {"race_id": "smoke-2", "phase": "intro", "starts_at": start, "track": 4, "laps": 2, "fw": 25,
            "racers": [["a", "car-a", 0], ["c", "car-c", 1]], "pilots": None, "taken": []}
    ia, isp = [], []
    wa = await client(port, "a", "driver", ia)
    await client(port, "spec-2", "spectator", isp)
    await asyncio.sleep(0.3)
    await asyncio.to_thread(sync, base, key, info)
    info["pilots"] = ["a"]
    await asyncio.to_thread(sync, base, key, info)
    v, step = 10.0, 0
    while time.time() - start < 6.0:
        rt = time.time() - start
        prog = -3.0 + v * max(0.0, rt)
        if rt < 2.0 or rt > 4.0:
            if rt > 4.0:
                prog = 40.0 + v * (rt - 4.0)
            await wa.send(json.dumps({"t": "s", "x": prog, "z": 0, "yaw": 0, "prog": prog, "rt": max(0.0, rt), "speed": v}))
        elif step == 0:
            await wa.send(json.dumps({"t": "ai"}))
            step = 1
        if rt > 3.98 and step == 1:
            await wa.send(json.dumps({"t": "release", "x": 40.0, "z": 0, "yaw": 0, "speed": v, "prog": 40.0, "rt": rt}))
            step = 2
        await asyncio.sleep(0.05)
    rep = await asyncio.to_thread(sync, base, key, dict(info, phase="race"))
    tk = [m["ev"] for m in isp if m.get("t") == "takeover"]
    rl = [m["ev"] for m in isp if m.get("t") == "release"]
    ok(len(tk) == 1 and tk[0].get("by") == "user" and tk[0]["speed"] > 0, "„Let AI drive“ an den Overlay: %s" % tk)
    ok(len(rl) == 1 and rl[0]["prog"] == 40.0, "„Take the wheel“ an den Overlay: %s" % rl)
    ok([e["type"] for e in rep.get("ai_events", [])] == ["takeover", "release"] and not rep["pilots"]["a"]["taken"],
       "sync: ai_events + A fährt wieder selbst (%s)" % [e["type"] for e in rep.get("ai_events", [])])
    ok(not any(m.get("t") == "ai_denied" for m in ia) and rep["pilots"]["a"]["reasons"] == [],
       "keine Ablehnung, keine Prüf-Verstöße nach der Übergabe (%s)" % rep["pilots"]["a"]["reasons"])


def main():
    port = free_port()
    srv = drive_ws.DriveServer(secret=SECRET, lap_record=lambda *a: {"personal": True, "car": True, "track": True,
                                                                       "best_car": None, "best_track": None})

    async def all_():
        from websockets.asyncio.server import serve
        async with serve(srv.handler, "127.0.0.1", port, process_request=srv.process_request):
            loop = asyncio.get_running_loop().create_task(srv.loop())
            await run(port)
            loop.cancel()
    asyncio.run(all_())
    print(fails and "%d Fehler" % fails or "alles ok")
    return 1 if fails else 0


if __name__ == "__main__":
    import urllib.parse  # noqa: F401
    sys.exit(main())
