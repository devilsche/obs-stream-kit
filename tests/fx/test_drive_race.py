"""Chatrennen steuerbar (Car Drive Schritt 2b): Raum je Tenant (fx/drive_race.py), Piloten/Übernahmen/Wertung in
fx/race.py, Abgleich + Links + Seite in fx/endpoints.py und app/views_drive.py."""
import json
import os
import shutil
import sqlite3

import pytest
from flask import Flask, g

from app.views_drive import bp_drive
from fx import drive_auth, drive_race as dr, endpoints, race, race_db
from fx.endpoints import bp_fx

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
T = 1_000_000.0
TID = 1


@pytest.fixture(autouse=True)
def _clean():
    race.reset()
    yield
    race.reset()


@pytest.fixture
def cars():
    cat = [{"key": "k%d" % i, "uid": "%032x" % i, "name": "Car %d" % i} for i in range(4)]
    return cat, {}


def racing(cars, ids=("a", "b", "c"), now=T):
    for u in ids:
        race.join(TID, u, u, u.upper(), "#ffffff", now, cars)
    race.admin(TID, "start", now)
    return race.state(TID, now)


# ---- fx/race.py ----

def test_pilots_frozen_once_in_intro_and_in_state(cars):
    st = racing(cars)
    assert st["phase"] == "intro" and "pilots" not in st
    assert race.set_pilots(TID, "other", ["a"], T) is None
    assert race.set_pilots(TID, st["race_id"], ["b", "zz"], T + 1) == ["b"]
    assert race.set_pilots(TID, st["race_id"], ["a"], T + 2) is None      # nur einmal
    assert race.state(TID, T + 2)["pilots"] == ["b"]
    info = race.drive_info(TID, T + 2)
    assert info["pilots"] == ["b"] and info["racers"][0] == ["a", info["racers"][0][1], 0]


def test_no_freeze_means_no_pilots_at_race_start(cars):
    st = racing(cars)
    s2 = race.state(TID, st["starts_at"] + 1)
    assert s2["phase"] == "race" and s2["pilots"] == []
    assert race.set_pilots(TID, st["race_id"], ["a"], st["starts_at"] + 2) is None


def test_takeover_events_once_per_pilot(cars):
    st = racing(cars)
    race.set_pilots(TID, st["race_id"], ["a", "b"], T)
    evs = [{"t": 5.0, "id": "a", "x": 1, "z": 2, "yaw": 0.5, "speed": 0, "prog": 40, "lap": 1},
           {"t": 6.0, "id": "a", "grid": 1}, {"t": 2, "id": "c", "grid": 1}, {"t": 3, "id": "b", "grid": 1},
           {"t": 3, "id": "b"}]
    assert race.add_takeovers(TID, st["race_id"], evs) == 2
    ev = [e for e in race.state(TID, T)["race_events"] if e["type"] == "takeover"]
    assert ev == [{"t": 3.0, "type": "takeover", "id": "b", "grid": 1},
                  {"t": 5.0, "type": "takeover", "id": "a", "x": 1.0, "z": 2.0, "yaw": 0.5, "speed": 0.0,
                   "prog": 40.0, "lap": 1}]


def test_pilot_bump_refused_and_nitro_off_after_takeover(cars):
    st = racing(cars)
    race.set_pilots(TID, st["race_id"], ["a", "b"], T)
    now = st["starts_at"] + 5
    paid = []
    out = race.boost(TID, "a", "bump", "", now, lambda c: paid.append(c) or True)
    assert not out["ok"] and "AI-driven" in out["say"] and paid == []
    assert race.boost(TID, "a", "nitro", "", now, lambda c: paid.append(c) or True)["ok"] and paid == [50]
    race.add_takeovers(TID, st["race_id"], [{"t": 6, "id": "b", "grid": 1}])
    out = race.boost(TID, "b", "nitro", "", now, lambda c: paid.append(c) or True)
    assert not out["ok"] and "AI is driving" in out["say"] and paid == [50]
    assert race.boost(TID, "c", "bump", "", now, lambda c: True)["ok"]      # KI-Auto wie bisher


def test_result_merge_pilot_times_window_and_invalid(cars):
    st = racing(cars, ids=("a", "b", "c", "d"))
    rid = st["race_id"]
    race.set_pilots(TID, rid, ["b", "c"], T)
    race.add_takeovers(TID, rid, [{"t": 9, "id": "c", "grid": 1}])
    now = st["starts_at"] + 70
    # a = KI 50 s, b = Pilot 48 s (schnellster), c = übernommen (Nachfahrer 80 s > 48 + 25 → DNF), d = KI 60 s
    rows = race.accept_result(TID, rid, [1, None, None, 2], now, times=[50.0, None, 80.0, 60.0],
                              pilot_res={"b": {"fin": 48.0, "invalid": False}, "c": {"fin": None}})
    got = {r["user_id"]: r["place"] for r in rows}
    assert got == {"b": 1, "a": 2, "d": 3, "c": None}
    res = race.state(TID, now)["result"]
    assert [x["user_id"] for x in res][:3] == ["b", "a", "d"]


def test_result_invalid_pilot_gets_no_row(cars):
    st = racing(cars, ids=("a", "b", "c"))
    rid = st["race_id"]
    race.set_pilots(TID, rid, ["a"], T)
    rows = race.accept_result(TID, rid, [None, 1, 2], st["starts_at"] + 70, times=[None, 50.0, 52.0],
                              pilot_res={"a": {"fin": 40.0, "invalid": True}})
    assert {r["user_id"]: r["place"] for r in rows} == {"b": 1, "c": 2}
    res = {x["user_id"]: x for x in race.state(TID, st["starts_at"] + 70)["result"]}
    assert res["a"]["place"] is None and res["a"]["invalid"] is True


def test_result_without_pilots_unchanged(cars):
    st = racing(cars)
    rows = race.accept_result(TID, st["race_id"], [2, 1, None], st["starts_at"] + 30, times=[9.0, 99.0, None])
    assert {r["user_id"]: r["place"] for r in rows} == {"a": 2, "b": 1, "c": None}


def test_result_times_length_checked(cars):
    st = racing(cars)
    race.set_pilots(TID, st["race_id"], ["a"], T)
    with pytest.raises(ValueError):
        race.accept_result(TID, st["race_id"], [1, 2, None], st["starts_at"] + 30, times=[1.0])


# ---- fx/drive_race.py ----

INFO = {"race_id": "r1", "phase": "intro", "starts_at": T + 10, "track": 7, "laps": 1, "fw": 15,
        "racers": [["a", "car-a", 0], ["b", "car-b", 1], ["c", "", 2]], "pilots": None, "taken": []}


def room_for(info=None, now=T):
    hub = dr.Hub()
    room, changed = hub.sync(TID, dict(info or INFO), now)
    assert changed
    return hub, room


def send(room, uid, rt, prog, now, x=None, speed=10.0):
    return room.state(uid, {"x": prog if x is None else x, "z": 0, "yaw": 0, "prog": prog, "rt": rt, "speed": speed}, now)


def test_room_follows_race_and_reports_connected():
    hub, room = room_for()
    assert room.track == 2 and room.laps == 1 and list(room.drivers) == ["a", "b", "c"]
    rep = room.report({"a", "x"})
    assert rep["connected"] == ["a"] and rep["pilots"] == {}
    room2, changed = hub.sync(TID, dict(INFO, pilots=["a"]), T + 1)
    assert room2 is room and changed and room.pilots == ["a"]
    _, changed = hub.sync(TID, dict(INFO, pilots=["a", "b"]), T + 2)
    assert room.pilots == ["a"]                    # bleibt eingefroren
    hub.sync(TID, dict(INFO, race_id="r2", pilots=None), T + 3)
    assert room.pilots is None and room.race_id == "r2"


def test_states_before_freeze_only_on_grid_and_after_only_pilots():
    _, room = room_for()
    assert send(room, "b", 0, -6.0, T + 1) == [] and room.drivers["b"].state is not None
    assert room.drivers["b"].reasons == []
    room.sync(dict(INFO, pilots=["a"]), T + 2)
    send(room, "b", 0, -6.0, T + 3)
    assert room.drivers["b"].ts == T + 1           # Nicht-Pilot: ignoriert
    assert room.may_drive("a", T + 3) and not room.may_drive("zz", T + 3)


def test_pilot_finish_and_takeover_after_gap():
    _, room = room_for(dict(INFO, pilots=["a", "b"]))
    start = room.starts_at
    send(room, "a", 0, -3.0, start - 1)
    L = room.track_len
    evs = []
    for k in range(1, 61):
        rt = 60.0 * k / 60
        evs += send(room, "a", rt, -3.0 + (L + 3.5) * k / 60, start + rt, speed=(L + 3.5) / 60)
    assert evs and evs[-1]["fin"] == 60.0
    assert room.tick(start + 1) == []
    out = room.tick(start + 2.5)                   # b nie verbunden → vom Startplatz
    assert out == [{"t": 2.5, "type": "takeover", "id": "b", "grid": 1}]
    rep = room.report(set())
    assert rep["pilots"]["a"]["fin"] == 60.0 and rep["pilots"]["b"]["taken"] and rep["takeovers"][0]["id"] == "b"
    assert not room.may_drive("b", start + 3)


def test_takeover_from_last_state_with_speed_zero():
    _, room = room_for(dict(INFO, pilots=["a"]))
    start = room.starts_at
    send(room, "a", 0, -3.0, start - 1)
    send(room, "a", 1.0, 5.0, start + 1, x=5.0)
    assert room.tick(start + 2.9) == []
    ev = room.tick(start + 3.1)[0]
    assert ev["prog"] == 5.0 and ev["speed"] == 0.0 and ev["t"] == 3.1 and ev["lap"] == 0
    assert room.batch(start + 3.2) == []           # übernommen: kein Live-Zustand mehr


def test_grid_cheat_and_too_fast_flagged():
    _, room = room_for(dict(INFO, pilots=["c"]))
    send(room, "c", 0, 0.0, room.starts_at - 1)    # Startplatz 3 meldet sich an der Linie
    assert "grid" in room.drivers["c"].reasons
    rep = room.report(set())
    assert rep["pilots"]["c"]["invalid"] is False  # ungültig erst mit der Runde


# ---- Endpoints + Seite ----

@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    race_db.init_schema(c)
    c.execute("CREATE TABLE tenants (id INTEGER PRIMARY KEY, owner_user_id INT, slug TEXT, display_name TEXT)")
    c.execute("CREATE TABLE tenant_credentials (tenant_id INT, twitch_channel TEXT)")
    c.execute("INSERT INTO tenants VALUES (1, 1, 'main', 'Main')")
    c.execute("INSERT INTO tenant_credentials VALUES (1, 'LuckyChan')")
    c.execute("INSERT INTO tenants VALUES (2, 2, 'other-one', 'Other')")
    yield c
    c.close()


@pytest.fixture
def root(tmp_path):
    os.makedirs(tmp_path / "tools")
    shutil.copy(os.path.join(REPO, "tools", "car-drive.html"), tmp_path / "tools" / "car-drive.html")
    os.makedirs(tmp_path / "data" / "car-rain")
    (tmp_path / "data" / "car-rain" / "catalog.json").write_text(json.dumps(
        [{"key": "k%d" % i, "uid": "%032x" % i, "name": "Car %d" % i} for i in range(4)]))
    return tmp_path


@pytest.fixture
def service(monkeypatch):
    """Fake WS-Dienst: merkt die sync-Aufrufe, meldet „a“ als verbunden."""
    seen = []

    def fake(cmd, timeout=3.0, **params):
        info = json.loads(params["race"]) if params.get("race") else None
        seen.append((cmd, info))
        out = {"ok": True, "connected": ["a"], "takeovers": [], "pilots": {}, "snap": {}}
        if info and info.get("pilots") and info["phase"] == "race":
            out["pilots"] = {"a": {"fin": 33.0, "invalid": False}}
        return out
    monkeypatch.setattr(drive_auth, "call", fake)
    return seen


def _app(conn, root, tenant_id=TID):
    app = Flask(__name__)
    app.config.update(_PG_CONN_FACTORY=lambda: conn, _PROJECT_ROOT=str(root), SECRET_KEY="x", TESTING=True)
    app.register_blueprint(bp_fx)
    app.register_blueprint(bp_drive)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
        g.user = None
    return app.test_client()


def test_link_keys(conn):
    assert drive_auth.key_of_tenant(conn, 1) == "luckychan"
    assert drive_auth.key_of_tenant(conn, 2) == "other-one"
    assert drive_auth.tenant_of_key(conn, "LUCKYCHAN") == 1 and drive_auth.tenant_of_key(conn, "other-one") == 2
    assert drive_auth.tenant_of_key(conn, "nope") is None and drive_auth.tenant_of_key(conn, "../x") is None


def test_race_join_say_has_link_and_state_freezes_pilots(conn, root, service):
    c = _app(conn, root)
    for u in ("a", "b", "c"):
        r = c.get("/s/tok/api/fx/car-race?cmd=join&id=%s&user=%s" % (u, u.upper())).get_json()
    assert r["ok"] and r["say"].endswith("steer your own car: http://localhost/drive/race/luckychan")
    my = c.get("/s/tok/api/fx/car-race?cmd=mycar&id=a&user=A").get_json()
    assert "/drive/race/luckychan" in my["say"]
    c.get("/s/tok/api/fx/car-race?cmd=start")
    st = c.get("/s/tok/api/fx/car-race/state").get_json()
    assert st["phase"] == "intro" and st["pilots"] == ["a"]
    assert service[-1][1]["pilots"] == ["a"]       # gleich nachgereicht
    body = json.dumps(st)
    assert body.index('"phase"') < body.index('"pilots"')


def test_result_post_merges_service_times(conn, root, service, monkeypatch):
    c = _app(conn, root)
    for u in ("a", "b", "c"):
        c.get("/s/tok/api/fx/car-race?cmd=join&id=%s&user=%s" % (u, u.upper()))
    c.get("/s/tok/api/fx/car-race?cmd=start")
    st = c.get("/s/tok/api/fx/car-race/state").get_json()
    monkeypatch.setattr(endpoints.time, "time", lambda: st["starts_at"] + 60)
    r = c.post("/s/tok/api/fx/car-race/result", json={"race_id": st["race_id"], "places": [None, 1, 2],
                                                       "times": [None, 40.0, 41.0]}).get_json()
    assert r["counted"] and [x["user_id"] for x in r["result"]] == ["a", "b", "c"]


def test_service_down_takes_over_pilots(conn, root, service, monkeypatch):
    c = _app(conn, root)
    for u in ("a", "b", "c"):
        c.get("/s/tok/api/fx/car-race?cmd=join&id=%s&user=%s" % (u, u.upper()))
    c.get("/s/tok/api/fx/car-race?cmd=start")
    st = c.get("/s/tok/api/fx/car-race/state").get_json()
    monkeypatch.setattr(drive_auth, "call", lambda cmd, timeout=3.0, **kw: {"ok": False, "error": "offline"})
    monkeypatch.setattr(endpoints.time, "time", lambda: st["starts_at"] + 4)
    s2 = c.get("/s/tok/api/fx/car-race/state").get_json()
    tk = [e for e in s2["race_events"] if e["type"] == "takeover"]
    assert tk == [{"t": 4.0, "type": "takeover", "id": "a", "grid": 1}]


def test_spectate_ticket(conn, root):
    j = _app(conn, root).get("/s/tok/api/fx/car-race/spectate").get_json()
    tk = drive_auth.read_ticket(j["ticket"])
    assert j["path"] == "/drive-ws/race" and tk["role"] == "spectator" and tk["tid"] == TID and "code" not in tk


def test_race_page_state_and_ticket(conn, root, service):
    c = _app(conn, root)
    assert c.get("/drive/race/nope").status_code == 404
    html = c.get("/drive/race/LuckyChan").get_data(as_text=True)
    assert '"mode": "race"' in html and '"key": "luckychan"' in html and "__WIDGET_TOKEN__" not in html
    assert c.get("/drive/race/luckychan/ticket").status_code == 401
    c.set_cookie(drive_auth.VIEWER_COOKIE, drive_auth.make_viewer({"id": "a", "login": "a", "display_name": "A"}),
                 path="/drive")
    assert c.get("/drive/race/luckychan/ticket").status_code == 403     # nicht im Rennen
    st = c.get("/drive/race/luckychan/state").get_json()
    assert st["phase"] == "idle" and st["me"]["in_race"] is False
    c.get("/s/tok/api/fx/car-race?cmd=join&id=a&user=A")
    j = c.get("/drive/race/luckychan/ticket").get_json()
    tk = drive_auth.read_ticket(j["ticket"])
    assert j["ok"] and tk["role"] == "driver" and tk["id"] == "a" and tk["tid"] == TID
    assert c.get("/drive/race/luckychan/state").get_json()["me"]["in_race"] is True


def test_login_for_race_page(conn, root):
    c = _app(conn, root)
    assert c.get("/drive/login?race=../x").status_code == 400
