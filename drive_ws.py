#!/usr/bin/env python3
"""Car Drive Mehrspieler: WebSocket-Dienst (obs-drive, 127.0.0.1:9010).

systemd: /usr/bin/python3 /opt/obs-stream-kit/drive_ws.py 9010 (Unit: docs/drive-systemd.service.example)
nginx:   location /drive-ws/ → 127.0.0.1:9010 mit Upgrade-Headern (docs/stream-overlay-nginx.conf.example)

Wege:
  ws  /drive-ws/<code>        Clients (Streamer-Seite und Zuschauer /drive/<code>); erste Nachricht
                              {"t": "hello", "ticket": …} (Ticket von Flask, fx/drive_auth.py)
  GET /internal/<cmd>?…       Flask (fx/endpoints.py, app/views_drive.py) mit Header X-Drive-Key;
                              open (tenant, track, laps) · start (tenant) · close (tenant) · status (tenant) · room (code)

Nachrichten Client → Server: hello {ticket} · join {car, paint} · leave · ping {c} · s {x, z, yaw, roll, pitch,
steer, speed, prog, rt (Rennzeit), spin} (~20 Hz).
Server → Client: welcome {id, room, roster, now} · roster {list} · joined {ok, msg} · phase {phase, race_id,
start_at, track, laps, grid, now} · S {now, d: [[id, ts, x, z, yaw, roll, pitch, steer, speed, prog, spin], …]}
(20 Hz) · lap {id, lap, time, ok, fin?} · results {race_id, list} · recorded {race_id, counted, points} ·
rec {id, name, car, track, time, personal, car_rec, track_rec, best_car, best_track} (geprüfte Runde gespeichert,
fx/race_db.lap_submit; nur wenn persönliche Bestzeit oder Rekord) · pong {c, s} · closed {msg} · error {msg}.
Räume, Phasen und Plausibilität: fx/drive_room.py. Ergebnisse: fx/race_db.record (einmal je race_id).

Zusätzlich – Chatrennen steuerbar (fx/drive_race.py): ein Raum je Tenant, gebunden an das aktuelle Chatrennen
(fx/race.py), Seite stream-overlay.com/drive/race/<kanal>. Flask gleicht ihn bei jedem Abruf des Rennzustands ab
(höchstens alle 0,5 s):
  ws  /drive-ws/race          Fahrer und Overlays (Zuschauen); erste Nachricht {"t": "hello", "ticket": …}
                              (Ticket mit tid + role driver|spectator, ohne code)
  GET /internal/sync?tenant=…&race=<JSON fx/race.drive_info oder leer>
                              → {ok, race_id, connected, takeovers, pilots, snap}
Client → Server: hello · ping {c} · s {x, z, yaw, roll, pitch, steer, speed, prog, rt, spin} (nur Fahrer, ~20 Hz).
Server → Client: welcome {id, role, race, now} · race {race} (Rennen/Phase/Piloten/Übernahmen geändert) ·
S {now, d} (20 Hz, wie oben) · lap {id, lap, time, ok, fin?} · rec {…} (wie oben) · takeover {ev} · pong {c, s} ·
error {msg}.
race = {race_id, phase, starts_at, track, track_name, laps, fw, pilots, taken, fin, now} (fx/drive_race.Room.info).
"""
import asyncio
import json
import logging
import os
import sys
import time
import urllib.parse

from websockets.asyncio.server import broadcast, serve
from websockets.exceptions import ConnectionClosed

from fx import drive_auth, drive_race, drive_room

log = logging.getLogger("drive_ws")
ROOT = os.path.dirname(os.path.abspath(__file__))
TICK = 0.05
DONE_STREAM = 12.0       # nach dem Ergebnis noch so lange Zustände verteilen (Auslaufen)
STATE_MIN_GAP = 0.025    # mehr als 40 Zustände/s je Client werden verworfen
RACE_PATH = "/drive-ws/race"


class Client:
    def __init__(self, ws, ident, code):
        self.ws = ws
        self.ident = ident
        self.code = code
        self.last_s = 0.0


class RaceClient:
    def __init__(self, ws, ident):
        self.ws = ws
        self.ident = ident
        self.id = str(ident["id"])
        self.driver = ident.get("role") == "driver"
        self.last_s = 0.0


class DriveServer:
    def __init__(self, secret=None, root=ROOT, record=None, clock=time.time, lap_record=None):
        self.secret = secret
        self.root = root
        self.clock = clock
        self.hub = drive_room.Hub(limits_loader=lambda: drive_room.Limits(drive_auth.load_limits(self.root)))
        self.conns = {}          # code → set(Client)
        self.record = record or _record_db
        self.lap_record = lap_record or _lap_db
        self.key = drive_auth.internal_key(secret)
        self._done_at = {}
        # Chatrennen: Raum je Tenant
        self.races = drive_race.Hub(limits_loader=lambda: drive_room.Limits(drive_auth.load_limits(self.root)))
        self.race_conns = {}     # tenant → set(RaceClient)

    # ---- Verteilen ----
    def _send_room(self, code, obj):
        cl = self.conns.get(code)
        if cl:
            broadcast([c.ws for c in cl], json.dumps(obj, separators=(",", ":")))

    def _roster(self, room):
        self._send_room(room.code, {"t": "roster", "list": room.roster()})

    async def _close_room(self, room, msg):
        self._send_room(room.code, {"t": "closed", "msg": msg})
        for c in list(self.conns.pop(room.code, ())):
            try:
                await c.ws.close(4000, "room closed")
            except Exception:
                pass

    # ---- interne HTTP-Schnittstelle ----
    def process_request(self, connection, request):
        parts = urllib.parse.urlsplit(request.path)
        path, q = parts.path, dict(urllib.parse.parse_qsl(parts.query))
        if path.rstrip("/") == RACE_PATH:
            return None
        if path.startswith("/drive-ws/"):
            code = path[len("/drive-ws/"):].strip("/").upper()
            if not self.hub.get(code):
                return connection.respond(404, "room not found\n")
            return None
        if path.startswith("/internal/"):
            if request.headers.get("X-Drive-Key") != self.key:
                return connection.respond(403, "forbidden\n")
            out, status = self.internal(path[len("/internal/"):], q)
            r = connection.respond(status, json.dumps(out))
            del r.headers["Content-Type"]
            r.headers["Content-Type"] = "application/json"
            return r
        return connection.respond(404, "not found\n")

    def internal(self, cmd, q):
        now = self.clock()
        try:
            tenant = int(q.get("tenant")) if q.get("tenant") not in (None, "") else None
        except ValueError:
            return {"ok": False, "error": "bad tenant"}, 400
        if cmd == "sync":
            return self.race_sync(q, now)
        if cmd == "room":
            room = self.hub.get(q.get("code"))
            if not room:
                return {"ok": False, "error": "room not found"}, 404
            return {"ok": True, "room": room.info(now), "roster": room.roster()}, 200
        if tenant is None:
            return {"ok": False, "error": "tenant missing"}, 400
        if cmd == "open":
            room, old = self.hub.open(tenant, q.get("track"), q.get("laps"), now)
            if old:
                asyncio.get_running_loop().create_task(self._close_room(old, "the host opened a new room"))
            return {"ok": True, "room": room.info(now), "roster": []}, 200
        room = self.hub.of_tenant(tenant)
        if cmd == "status":
            if not room:
                return {"ok": False, "error": "no room open"}, 200
            return {"ok": True, "room": room.info(now), "roster": room.roster()}, 200
        if not room:
            return {"ok": False, "error": "no room open"}, 200
        if cmd == "start":
            ok, msg = room.start(now)
            if ok:
                self._send_room(room.code, room.phase_msg(now))
                self._roster(room)
            return {"ok": ok, "msg": msg, "room": room.info(now), "roster": room.roster()}, 200
        if cmd == "close":
            self.hub.close(tenant)
            asyncio.get_running_loop().create_task(self._close_room(room, "the host closed the room"))
            return {"ok": True, "msg": "room closed", "room": room.info(now)}, 200
        return {"ok": False, "error": "unknown command"}, 400

    # ---- Chatrennen (fx/drive_race.py) ----
    def _send_race(self, tid, obj):
        cl = self.race_conns.get(tid)
        if cl:
            broadcast([c.ws for c in cl], json.dumps(obj, separators=(",", ":")))

    def race_connected(self, tid):
        return {c.id for c in self.race_conns.get(tid, ()) if c.driver}

    def race_sync(self, q, now):
        try:
            tenant = int(q.get("tenant"))
            info = json.loads(q["race"]) if q.get("race") else None
        except (TypeError, ValueError):
            return {"ok": False, "error": "bad request"}, 400
        if info is not None and not isinstance(info, dict):
            return {"ok": False, "error": "bad race"}, 400
        room, changed = self.races.sync(tenant, info, now)
        if changed:
            self._send_race(tenant, {"t": "race", "race": room.info(now)})
        return room.report(self.race_connected(tenant)), 200

    async def race_handler(self, ws):
        try:
            hello = json.loads(await asyncio.wait_for(ws.recv(), 10))
        except (asyncio.TimeoutError, ValueError, ConnectionClosed, TypeError):
            await ws.close(4400, "hello expected")
            return
        ident = drive_auth.read_ticket(hello.get("ticket") if isinstance(hello, dict) else None, self.secret)
        if not ident or ident.get("code") or ident.get("role") not in ("driver", "spectator"):
            await ws.send(json.dumps({"t": "error", "msg": "sign-in expired – reload the page"}))
            await ws.close(4401, "bad ticket")
            return
        try:
            tid = int(ident["tid"])
        except (TypeError, ValueError):
            await ws.close(4401, "bad ticket")
            return
        now = self.clock()
        room = self.races.get(tid, now)
        if room.clients >= drive_race.MAX_CLIENTS:
            await ws.send(json.dumps({"t": "error", "msg": "too many connections"}))
            await ws.close(4429, "full")
            return
        cl = RaceClient(ws, ident)
        self.race_conns.setdefault(tid, set()).add(cl)
        room.clients += 1
        try:
            await ws.send(json.dumps({"t": "welcome", "id": cl.id, "role": ident["role"], "race": room.info(now),
                                      "now": now}))
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(msg, dict):
                    continue
                t, now = msg.get("t"), self.clock()
                if t == "s" and cl.driver:
                    if now - cl.last_s < STATE_MIN_GAP:
                        continue
                    cl.last_s = now
                    r = self.races.rooms.get(tid)
                    if r:
                        for ev in r.state(cl.id, msg, now):
                            self._send_race(tid, ev)
                            d = r.drivers.get(cl.id)
                            if ev.get("t") == "lap" and ev.get("ok") and d:
                                self._lap(tid, r.track, d.car, cl.id, cl.ident.get("display") or cl.id, ev["time"],
                                          "race", lambda o, t=tid: self._send_race(t, o))
                elif t == "ping":
                    try:
                        broadcast([cl.ws], json.dumps({"t": "pong", "c": msg.get("c"), "s": now}))
                    except Exception:
                        pass
        except ConnectionClosed:
            pass
        finally:
            peers = self.race_conns.get(tid)
            if peers:
                peers.discard(cl)
            r = self.races.rooms.get(tid)
            if r:
                r.clients -= 1
                r.active = self.clock()

    def race_step(self, now):
        for tid, room in list(self.races.rooms.items()):
            for ev in room.tick(now):
                self._send_race(tid, {"t": "takeover", "ev": ev})
            if room.streaming(now) and self.race_conns.get(tid):
                d = room.batch(now)
                if d:
                    self._send_race(tid, {"t": "S", "now": round(now, 3), "d": d})

    # ---- Clients ----
    async def handler(self, ws):
        if urllib.parse.urlsplit(ws.request.path).path.rstrip("/") == RACE_PATH:
            await self.race_handler(ws)
            return
        code = urllib.parse.urlsplit(ws.request.path).path[len("/drive-ws/"):].strip("/").upper()
        room = self.hub.get(code)
        if not room:
            await ws.close(4404, "room not found")
            return
        if room.clients >= drive_room.MAX_CLIENTS:
            await ws.send(json.dumps({"t": "error", "msg": "room full"}))
            await ws.close(4429, "room full")
            return
        try:
            hello = json.loads(await asyncio.wait_for(ws.recv(), 10))
        except (asyncio.TimeoutError, ValueError, ConnectionClosed, TypeError):
            await ws.close(4400, "hello expected")
            return
        ident = drive_auth.read_ticket(hello.get("ticket") if isinstance(hello, dict) else None, self.secret)
        if not ident or str(ident.get("code")).upper() != room.code or ident.get("tid") != room.tenant_id:
            await ws.send(json.dumps({"t": "error", "msg": "sign-in expired – reload the page"}))
            await ws.close(4401, "bad ticket")
            return
        cl = Client(ws, ident, room.code)
        self.conns.setdefault(room.code, set()).add(cl)
        room.clients += 1
        now = self.clock()
        d = room.drivers.get(ident["id"])
        if d:
            d.connected = True
        try:
            await ws.send(json.dumps({"t": "welcome", "id": ident["id"], "role": ident.get("role"),
                                      "room": room.info(now), "roster": room.roster(), "now": now}))
            if room.phase != "lobby":
                await ws.send(json.dumps(room.phase_msg(now)))
            if room.phase == "done" and room.results:
                await ws.send(json.dumps(dict(room.results, t="results")))
            if d:
                self._roster(room)
            async for raw in ws:
                if self.hub.get(room.code) is not room:
                    break
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(msg, dict):
                    self.on_message(room, cl, msg)
        except ConnectionClosed:
            pass
        finally:
            peers = self.conns.get(room.code)
            if peers:
                peers.discard(cl)
            room.clients -= 1
            uid = ident["id"]
            if not any(c.ident["id"] == uid for c in (peers or ())):
                if room.leave(uid, self.clock()):
                    self._roster(room)

    def on_message(self, room, cl, msg):
        now = self.clock()
        t = msg.get("t")
        uid = cl.ident["id"]
        if t == "s":
            if now - cl.last_s < STATE_MIN_GAP:
                return
            cl.last_s = now
            for ev in room.state(uid, msg, now):
                self._send_room(room.code, ev)
                d = room.drivers.get(uid)
                if ev.get("t") == "lap" and ev.get("ok") and d:
                    self._lap(room.tenant_id, room.track, d.car, uid, d.display, ev["time"], "room",
                              lambda o, c=room.code: self._send_room(c, o))
        elif t == "ping":
            try:
                broadcast([cl.ws], json.dumps({"t": "pong", "c": msg.get("c"), "s": now}))
            except Exception:
                pass
        elif t == "join":
            ok, text = room.join(cl.ident, msg.get("car"), msg.get("paint"), now)
            broadcast([cl.ws], json.dumps({"t": "joined", "ok": ok, "msg": text}))
            if ok:
                self._roster(room)
        elif t == "leave":
            if room.leave(uid, now):
                self._roster(room)

    # ---- Rundenrekorde ----
    def _lap(self, tenant, track, car, uid, display, lap_time, source, send):
        """Geprüfte Runde speichern (im Thread, blockiert den Takt nicht); bei Bestzeit/Rekord „rec“ an alle."""
        if not car:
            return

        async def run():
            try:
                res = await asyncio.get_running_loop().run_in_executor(
                    None, self.lap_record, tenant, track, car, str(uid), display, lap_time, source)
            except Exception:
                log.exception("drive: lap record failed (%s, %s)", tenant, uid)
                return
            if res and (res.get("personal") or res.get("car") or res.get("track")):
                send({"t": "rec", "id": str(uid), "name": display, "car": car, "track": track, "time": lap_time,
                      "personal": bool(res.get("personal")), "car_rec": bool(res.get("car")),
                      "track_rec": bool(res.get("track")), "best_car": res.get("best_car"),
                      "best_track": res.get("best_track")})
        try:
            asyncio.get_running_loop().create_task(run())
        except RuntimeError:
            log.warning("drive: no event loop for lap record")

    # ---- Takt ----
    async def loop(self):
        last_sweep = 0.0
        while True:
            await asyncio.sleep(TICK)
            try:
                self.step(self.clock())
            except Exception:
                log.exception("drive tick failed")
            now = self.clock()
            if now - last_sweep > 30:
                last_sweep = now
                for r in self.hub.sweep(now):
                    self.conns.pop(r.code, None)
                for r in self.races.sweep(now):
                    self.race_conns.pop(r.tenant_id, None)

    def step(self, now):
        self.race_step(now)
        for room in list(self.hub.rooms.values()):
            for ev in room.tick(now):
                self._send_room(room.code, ev)
                if ev.get("t") == "results":
                    self._done_at[room.code] = now
                    self._save(room)
            streaming = room.phase in ("countdown", "race") or \
                (room.phase == "done" and now - self._done_at.get(room.code, 0) < DONE_STREAM)
            if streaming and self.conns.get(room.code):
                self._send_room(room.code, {"t": "S", "now": round(now, 3), "d": room.batch(now)})

    def _save(self, room):
        rows = room.rows()
        if not rows:
            self._send_room(room.code, {"t": "recorded", "race_id": room.race_id, "counted": False, "points": {}})
            return
        room.recorded = True     # Sperre: dieses Rennen wird genau einmal gemeldet
        race_id, tenant = room.race_id, room.tenant_id

        async def run():
            try:
                counted, pts = await asyncio.get_running_loop().run_in_executor(None, self.record, tenant, race_id, rows)
            except Exception:
                log.exception("drive: saving race %s failed", race_id)
                counted, pts = False, {}
            self._send_room(room.code, {"t": "recorded", "race_id": race_id, "counted": counted, "points": pts})
        asyncio.get_running_loop().create_task(run())


def _record_db(tenant_id, race_id, rows):
    """Ergebnis in fx_race_result + Coins (race_db.record ist je race_id idempotent). → (gezählt, Punkte je user_id)."""
    import sqlite3
    from core import db as core_db
    from core.db_compat import SqliteCompatConn
    from fx import race_db
    raw = core_db.connect()
    conn = raw if isinstance(raw, (sqlite3.Connection, SqliteCompatConn)) else SqliteCompatConn(raw)
    try:
        counted = race_db.record(conn, tenant_id, race_id, rows)
    finally:
        raw.close()
    field = len(rows)
    return counted, {r["user_id"]: race_db.points(r["place"], field) for r in rows}


def _lap_db(tenant_id, track, car_key, user_id, display, lap_time, source):
    """Geprüfte Runde in fx_race_lap_record (race_db.lap_submit). → Ergebnis von lap_submit."""
    import sqlite3
    from core import db as core_db
    from core.db_compat import SqliteCompatConn
    from fx import race_db
    raw = core_db.connect()
    conn = raw if isinstance(raw, (sqlite3.Connection, SqliteCompatConn)) else SqliteCompatConn(raw)
    try:
        return race_db.lap_submit(conn, tenant_id, track, car_key, user_id, display, lap_time, source)
    finally:
        raw.close()


async def main(host, port, secret=None, record=None):
    srv = DriveServer(secret=secret, record=record)
    async with serve(srv.handler, host, port, process_request=srv.process_request, max_size=8192,
                     ping_interval=20, ping_timeout=20):
        print("obs-drive serving on %s:%d" % (host, port), flush=True)
        await srv.loop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    port = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 9010
    asyncio.run(main("127.0.0.1", port))
