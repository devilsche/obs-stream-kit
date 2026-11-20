"""Car Drive Mehrspieler: Token-Route /s/<token>/api/fx/car-drive und Zuschauer-Seite /drive/<code>."""
import json
import os
import shutil
import sqlite3

import pytest
from flask import Flask, g

from app.views_drive import bp_drive
from fx import drive_auth, race_db
from fx.endpoints import bp_fx

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOM = {"code": "ABC234", "tenant": 1, "track": 2, "track_name": "Hairpin", "laps": 3, "phase": "lobby",
        "race_id": None, "start_at": None, "drivers": 0, "max": 8}


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    race_db.init_schema(c)
    yield c
    c.close()


@pytest.fixture
def root(tmp_path):
    os.makedirs(tmp_path / "tools")
    shutil.copy(os.path.join(REPO, "tools", "car-drive.html"), tmp_path / "tools" / "car-drive.html")
    os.makedirs(tmp_path / "data" / "car-rain")
    (tmp_path / "data" / "car-rain" / "catalog.json").write_text(json.dumps(
        [{"key": "a", "uid": "0" * 32}, {"key": "b", "uid": "1" * 32}]))
    return tmp_path


@pytest.fixture
def calls(monkeypatch):
    seen = []

    def fake(cmd, timeout=3.0, **params):
        seen.append((cmd, params))
        if cmd == "room":
            return {"ok": True, "room": ROOM, "roster": []} if params.get("code") == "ABC234" else {"ok": False}
        if cmd == "open":
            return {"ok": True, "room": ROOM}
        return {"ok": True, "msg": "race starts in 8 s", "room": ROOM}
    monkeypatch.setattr(drive_auth, "call", fake)
    return seen


def _app(conn, root, tenant_id=1):
    app = Flask(__name__)
    app.config.update(_PG_CONN_FACTORY=lambda: conn, _PROJECT_ROOT=str(root), SECRET_KEY="x", TESTING=True)
    app.register_blueprint(bp_fx)
    app.register_blueprint(bp_drive)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
        g.user = None
    return app.test_client()


def test_open_returns_link_say_and_host_ticket(conn, root, calls):
    c = _app(conn, root)
    r = c.post("/s/tok/api/fx/car-drive?cmd=open&track=2&laps=3&host=1",
               json={"limits": {"cars": {"a": {"vtop": 20, "lap": [20, 20, 20, 20, 20]}}}})
    j = r.get_json()
    assert r.status_code == 200 and j["ok"] and j["code"] == "ABC234"
    assert j["url"].endswith("/drive/ABC234") and j["url"] in j["say"]
    tk = drive_auth.read_ticket(j["ticket"])
    assert tk["role"] == "host" and tk["tid"] == 1 and tk["garage"] is None
    assert calls[0] == ("open", {"tenant": 1, "track": "2", "laps": "3"})
    assert drive_auth.load_limits(str(root))["cars"]["a"]["vtop"] == 20.0


def test_open_from_streamerbot_without_ticket_and_random_track(conn, root, calls):
    j = _app(conn, root).get("/s/tok/api/fx/car-drive?cmd=open&track=%25track%25").get_json()
    assert "ticket" not in j and calls[0][1]["track"] == "random"


def test_start_close_pass_through(conn, root, calls):
    c = _app(conn, root)
    assert c.get("/s/tok/api/fx/car-drive?cmd=start").get_json()["say"] == "race starts in 8 s"
    c.get("/s/tok/api/fx/car-drive?cmd=close")
    assert [x[0] for x in calls] == ["start", "close"]


def test_offline_service(conn, root, monkeypatch):
    monkeypatch.setattr(drive_auth, "call", lambda cmd, **kw: {"ok": False, "error": "drive service offline"})
    r = _app(conn, root).get("/s/tok/api/fx/car-drive?cmd=open")
    assert r.status_code == 503 and r.get_json()["say"] == "Car Drive is offline"


def test_viewer_page_without_token(conn, root, calls):
    r = _app(conn, root).get("/drive/abc234")
    html = r.get_data(as_text=True)
    assert r.status_code == 200 and "__WIDGET_TOKEN__" not in html and "ducks/custom.js" not in html
    assert '"mode": "viewer"' in html and '"user": null' in html and "/drive/a/js/car-drive.js" in html


def test_ticket_needs_signin_then_filters_garage(conn, root, calls):
    c = _app(conn, root)
    assert c.get("/drive/ABC234/ticket").status_code == 401
    conn.execute("INSERT INTO fx_race_garage (tenant_id, user_id, car_key, bought_at) VALUES (1, '42', 'a', 'x')")
    conn.execute("INSERT INTO fx_race_garage (tenant_id, user_id, car_key, bought_at) VALUES (1, '42', 'gone', 'x')")
    c.set_cookie(drive_auth.VIEWER_COOKIE, drive_auth.make_viewer({"id": 42, "login": "v", "display_name": "V"}),
                 path="/drive")
    j = c.get("/drive/ABC234/ticket").get_json()
    assert j["ok"] and j["garage"] == ["a"] and j["rnd"] in ("a", "b")
    tk = drive_auth.read_ticket(j["ticket"])
    assert tk["id"] == "42" and tk["role"] == "viewer" and tk["garage"] == ["a"] and tk["code"] == "ABC234"
    assert c.get("/drive/ZZZ999/ticket").status_code == 404


def test_engine_sounds_without_token(conn, root, calls):
    d = root / "assets" / "sounds" / "engines" / "i4"
    os.makedirs(d)
    (root / "assets" / "sounds" / "engines" / "bank.json").write_text('{"version": 1}')
    (d / "loop-900-1.mp3").write_bytes(b"ID3x")
    c = _app(conn, root)
    assert c.get("/drive/a/assets/sounds/engines/bank.json").get_json() == {"version": 1}
    assert c.get("/drive/a/assets/sounds/engines/i4/loop-900-1.mp3").status_code == 200
    assert c.get("/drive/a/assets/sounds/engines/../../../tools/car-drive.html").status_code == 404
    assert c.get("/drive/a/assets/sounds/engines/i4/none.mp3").status_code == 404
