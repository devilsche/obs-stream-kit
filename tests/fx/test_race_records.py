"""Car Drive Rundenrekorde: fx/race_db.lap_*, Token-Route cmd=records, Zuschauer-Routen, WS-Dienst meldet Rekorde."""
import asyncio
import json
import os
import shutil
import sqlite3

import pytest
from flask import Flask, g

import drive_ws
from app.views_drive import bp_drive
from fx import drive_auth, drive_room as dr, race_db
from fx.endpoints import bp_fx

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    race_db.init_schema(c)
    c.execute("CREATE TABLE tenants (id INTEGER PRIMARY KEY, owner_user_id INT, slug TEXT, display_name TEXT)")
    c.execute("CREATE TABLE tenant_credentials (tenant_id INT, twitch_channel TEXT)")
    c.execute("INSERT INTO tenants VALUES (1, 1, 'main', 'Main')")
    c.execute("INSERT INTO tenant_credentials VALUES (1, 'LuckyChan')")
    yield c
    c.close()


# ---- DB ----

def test_submit_keeps_best_per_driver_and_flags_records(conn):
    r = race_db.lap_submit(conn, 1, 3, "car-a", "u1", "Uno", 22.5, "race")
    assert r["personal"] and r["car"] and r["track"]
    r = race_db.lap_submit(conn, 1, 3, "car-a", "u1", "Uno", 23.0, "race")      # langsamer: nichts
    assert not r["personal"] and not r["car"] and not r["track"]
    assert race_db.lap_best(conn, 1, 3, "car-a")["time"] == 22.5
    r = race_db.lap_submit(conn, 1, 3, "car-b", "u2", "Dos", 24.0, "room")      # neues Auto: Autorekord, kein Streckenrekord
    assert r["personal"] and r["car"] and not r["track"]
    assert r["best_track"]["display"] == "Uno"
    r = race_db.lap_submit(conn, 1, 3, "car-b", "u1", "Uno", 21.9, "room")      # schneller als alle
    assert r["personal"] and r["car"] and r["track"] and r["prev_track"]["time"] == 22.5
    rows = conn.execute("SELECT COUNT(*) AS n FROM fx_race_lap_record").fetchone()["n"]
    assert rows == 3                                                           # je (Strecke, Auto, Fahrer) eine Zeile
    rec = race_db.lap_records(conn, 1, 3)
    assert rec["track"]["time"] == 21.9 and rec["track"]["car_key"] == "car-b"
    assert [x["car_key"] for x in rec["cars"]] == ["car-b", "car-a"]


def test_records_are_per_tenant_and_track(conn):
    race_db.lap_submit(conn, 1, 0, "car-a", "u1", "Uno", 20.0)
    assert race_db.lap_best(conn, 2, 0) is None
    assert race_db.lap_best(conn, 1, 1) is None
    with pytest.raises(ValueError):
        race_db.lap_submit(conn, 1, 7, "car-a", "u1", "Uno", 20.0)
    with pytest.raises(ValueError):
        race_db.lap_submit(conn, 1, 0, "car-a", "u1", "Uno", 0)


# ---- Endpoints ----

@pytest.fixture
def client(conn, tmp_path):
    os.makedirs(tmp_path / "tools")
    shutil.copy(os.path.join(REPO, "tools", "car-drive.html"), tmp_path / "tools" / "car-drive.html")
    os.makedirs(tmp_path / "data" / "car-rain")
    (tmp_path / "data" / "car-rain" / "catalog.json").write_text(json.dumps(
        [{"key": "car-a", "uid": "0" * 32, "name": "Alpha GT"}, {"key": "car-b", "uid": "1" * 32, "name": "Beta"}]))
    app = Flask(__name__)
    app.config.update(_PG_CONN_FACTORY=lambda: conn, _PROJECT_ROOT=str(tmp_path), SECRET_KEY="x", TESTING=True)
    app.register_blueprint(bp_fx)
    app.register_blueprint(bp_drive)

    @app.before_request
    def _ctx():
        g.tenant_id = 1
        g.user = None
    return app.test_client()


def test_records_cmd_say_and_shape(conn, client):
    r = client.get("/s/tok/api/fx/car-race?cmd=records&track=coast").get_json()
    assert r["ok"] and r["record"] is None and r["say"] == "No lap record on Coast yet."
    race_db.lap_submit(conn, 1, 3, "car-a", "u1", "Uno", 21.344)
    race_db.lap_submit(conn, 1, 3, "car-b", "u2", "Dos", 23.1)
    r = client.get("/s/tok/api/fx/car-race?cmd=records&track=3&car=car-b").get_json()
    assert r["say"] == "Track record Coast: Uno 21.34 s (Alpha GT) · best Beta: Dos 23.10 s"
    assert r["track"] == 3 and r["track_name"] == "Coast"
    assert r["record"]["display"] == "Uno" and r["record"]["car_name"] == "Alpha GT"
    assert r["car"]["time"] == 23.1 and len(r["cars"]) == 2
    r = client.get("/s/tok/api/fx/car-race?cmd=records").get_json()
    assert r["say"] == "Lap records: Coast Uno 21.34 s" and len(r["tracks"]) == 5
    resp = client.get("/s/tok/api/fx/car-race?cmd=records&track=moon")
    assert resp.status_code == 400 and "speedway" in resp.get_json()["say"]


def test_viewer_records_routes(conn, client, monkeypatch):
    race_db.lap_submit(conn, 1, 2, "car-a", "u1", "Uno", 19.5)
    r = client.get("/drive/race/luckychan/records?track=2").get_json()
    assert r["record"]["time"] == 19.5
    monkeypatch.setattr(drive_auth, "call", lambda cmd, timeout=3.0, **p: {"ok": True, "room": {"tenant": 1, "code": "ABC234"}})
    assert client.get("/drive/ABC234/records?track=2&car=car-a").get_json()["car"]["display"] == "Uno"
    assert client.get("/drive/race/nobody-here/records").status_code == 404


# ---- WS-Dienst: geprüfte Runde → lap_record, „rec“ an den Raum ----

class FakeWs:
    def __init__(self):
        self.sent = []


def test_server_records_verified_laps_and_sends_rec(monkeypatch):
    calls, sent = [], []

    def lap_record(*a):
        calls.append(a)
        return {"personal": True, "car": True, "track": len(calls) == 1, "best_car": None, "best_track": None}

    async def go():
        srv = drive_ws.DriveServer(secret="s", lap_record=lap_record)
        monkeypatch.setattr(srv, "_send_room", lambda code, obj: sent.append(obj))
        room, _ = srv.hub.open(5, 0, 2, 1000.0)
        ok, _ = room.join({"id": "u1", "login": "u1", "display": "Uno", "role": "viewer", "garage": None}, "car-a", 0, 1000.0)
        assert ok
        room.start(1000.0)
        cl = drive_ws.Client(FakeWs(), {"id": "u1"}, room.code)
        L, s0 = room.track_len, dr.grid_pose(0)[0]
        t0 = room.start_at
        # zwei Runden à 22 s, gleichmäßig
        total, T, steps = 2 * L - s0 + 0.5, 44.0, 120
        for k in range(1, steps + 1):
            rt = T * k / steps
            srv.clock = lambda v=t0 + rt: v
            cl.last_s = 0
            srv.on_message(room, cl, {"t": "s", "x": s0 + total * k / steps, "z": 0, "yaw": 0,
                                      "prog": s0 + total * k / steps, "rt": rt, "speed": total / T})
        await asyncio.sleep(0.2)
    asyncio.run(go())
    assert len(calls) == 2
    assert calls[0][:5] == (5, 0, "car-a", "u1", "Uno") and calls[0][6] == "room"
    recs = [m for m in sent if m.get("t") == "rec"]
    assert len(recs) == 2 and recs[0]["track_rec"] and not recs[1]["track_rec"] and recs[0]["name"] == "Uno"


def test_server_ignores_unverified_laps(monkeypatch):
    calls = []

    async def go():
        srv = drive_ws.DriveServer(secret="s", lap_record=lambda *a: calls.append(a) or {})
        monkeypatch.setattr(srv, "_send_room", lambda code, obj: None)
        room, _ = srv.hub.open(5, 0, 2, 1000.0)
        room.join({"id": "u1", "login": "u1", "display": "Uno", "role": "viewer", "garage": None}, "car-a", 0, 1000.0)
        monkeypatch.setattr(room, "state", lambda uid, msg, now: [{"t": "lap", "id": "u1", "lap": 1, "time": 9.0, "ok": False}])
        srv.on_message(room, drive_ws.Client(FakeWs(), {"id": "u1"}, room.code), {"t": "s"})
        await asyncio.sleep(0.05)
    asyncio.run(go())
    assert calls == []
