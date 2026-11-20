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
pong {c, s} · closed {msg} · error {msg}.
Räume, Phasen und Plausibilität: fx/drive_room.py. Ergebnisse: fx/race_db.record (einmal je race_id).
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

from fx import drive_auth, drive_room

log = logging.getLogger("drive_ws")
ROOT = os.path.dirname(os.path.abspath(__file__))
TICK = 0.05
DONE_STREAM = 12.0       # nach dem Ergebnis noch so lange Zustände verteilen (Auslaufen)
STATE_MIN_GAP = 0.025    # mehr als 40 Zustände/s je Client werden verworfen


class Client:
    def __init__(self, ws, ident, code):
        self.ws = ws
        self.ident = ident
        self.code = code
        self.last_s = 0.0


class DriveServer:
    def __init__(self, secret=None, root=ROOT, record=None, clock=time.time):
        self.secret = secret
        self.root = root
        self.clock = clock
        self.hub = drive_room.Hub(limits_loader=lambda: drive_room.Limits(drive_auth.load_limits(self.root)))
        self.conns = {}          # code → set(Client)
        self.record = record or _record_db
        self.key = drive_auth.internal_key(secret)
        self._done_at = {}

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

    # ---- Clients ----
    async def handler(self, ws):
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

    def step(self, now):
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
