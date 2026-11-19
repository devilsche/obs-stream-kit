import json
import random
import sqlite3
import types

import pytest
from flask import Flask, g

from fx import endpoints, race, race_db
from fx.endpoints import bp_fx

T = 1_000_000.0
TID = 1


@pytest.fixture(autouse=True)
def _clean():
    race.reset()
    yield
    race.reset()


@pytest.fixture
def cars():
    cat = [{"key": "k%d" % i, "uid": "%032x" % i, "name": "Car %d" % i, "brand": "B"} for i in range(4)]
    return cat, {"k0": {"paints": [{"c": "#111", "w": 0}, {"c": "#222", "w": 5}]}}


def j(cars, uid, now=T, tid=TID):
    return race.join(tid, uid, uid, uid.upper(), "#ffffff", now, cars)


def st(now=T, tid=TID):
    return race.state(tid, now)


def start_race(cars, n=3, now=T):
    for i in range(n):
        j(cars, "abcdefghij"[i], now)
    race.admin(TID, "start", now)
    return st(now)["race_id"]


# --- Lobby und Uhr ---

def test_lobby_opens_on_first_and_countdown_on_third(cars):
    j(cars, "a")
    assert st()["phase"] == "lobby"
    j(cars, "b")
    j(cars, "c")
    s = st()
    assert s["phase"] == "countdown" and s["ends_at"] == T + 60 and s["starts_at"] == T + 60
    assert st(T + 60)["phase"] == "race"


def test_tenth_starts_immediately_and_eleventh_is_refused(cars):
    for u in "abcdefghij":
        j(cars, u)
    assert st()["phase"] == "race"
    out = j(cars, "k")
    assert out["ok"] is False and out["say"] == "race running"
    assert len(st()["racers"]) == 10


def test_double_join_counts_once(cars):
    j(cars, "a")
    out = j(cars, "a")
    assert out["ok"] is False and out["say"] == "already in"
    assert len(st()["racers"]) == 1


def test_grid_order_is_join_order(cars):
    for u in "cab":
        j(cars, u)
    assert [(r["grid"], r["user_id"]) for r in st()["racers"]] == [(1, "c"), (2, "a"), (3, "b")]


def test_join_during_race_and_cooldown_is_refused_without_change(cars):
    rid = start_race(cars)
    out = j(cars, "z", T + 5)
    assert out["ok"] is False and out["say"] == "race running"
    race.accept_result(TID, rid, [1, 2, 3], T + 30)
    out = j(cars, "z", T + 60)
    assert out["ok"] is False and out["say"].startswith("cooldown, next race in")
    assert len(st(T + 60)["racers"]) == 3
    assert st(T + 30 + race.PODIUM + 1)["phase"] == "cooldown"
    assert st(T + 30 + race.COOLDOWN)["phase"] == "idle"
    assert j(cars, "z", T + 30 + race.COOLDOWN)["ok"] is True


def test_race_without_result_ends_after_race_max(cars):
    start_race(cars)
    assert st(T + race.RACE_MAX - 1)["phase"] == "race"
    assert st(T + race.RACE_MAX)["phase"] == "cooldown"
    assert st(T + race.RACE_MAX + race.COOLDOWN)["phase"] == "idle"


def test_lobby_expires_after_5_min_below_three(cars):
    j(cars, "a")
    j(cars, "b", T + 10)
    assert st(T + 299)["phase"] == "lobby"
    assert st(T + 300)["phase"] == "idle"
    assert st(T + 300)["racers"] == []
    assert j(cars, "a", T + 301)["ok"] is True


def test_cancel_start_remove_void(cars):
    j(cars, "a")
    j(cars, "b")
    assert race.admin(TID, "start", T)["ok"] is False  # unter 3
    j(cars, "c")
    assert race.admin(TID, "remove", T, user_id="c")["ok"] is True
    assert st()["phase"] == "lobby" and [r["user_id"] for r in st()["racers"]] == ["a", "b"]
    assert race.admin(TID, "remove", T, user_id="zz")["ok"] is False
    j(cars, "c")
    assert race.admin(TID, "start", T + 1)["ok"] is True
    assert st(T + 1)["phase"] == "race"
    assert race.admin(TID, "remove", T + 1, user_id="a")["ok"] is False  # nicht im Rennen
    assert race.admin(TID, "void", T + 1)["ok"] is False  # noch nichts gezählt
    rid = st(T + 1)["race_id"]
    race.accept_result(TID, rid, [1, 2, 3], T + 20)
    race.confirm(TID, rid)
    v = race.admin(TID, "void", T + 21)
    assert v["ok"] is True and v["race_id"] == rid
    assert race.admin(TID, "void", T + 22)["ok"] is False
    race.admin(TID, "cancel", T + 22)
    assert st(T + 22)["phase"] == "idle"


def test_result_counts_once_and_only_in_window(cars):
    rid = start_race(cars)
    rows = race.accept_result(TID, rid, [2, 1, None], T + 30)
    assert [(r["user_id"], r["place"]) for r in rows] == [("a", 2), ("b", 1), ("c", None)]
    assert st(T + 30)["phase"] == "podium"
    assert [x["user_id"] for x in st(T + 30)["result"]] == ["b", "a", "c"]
    race.confirm(TID, rid)
    assert race.accept_result(TID, rid, [3, 2, 1], T + 31) is None


def test_late_result_after_window_is_not_counted(cars):
    rid = start_race(cars)
    assert race.accept_result(TID, rid, [1, 2, 3], T + race.RESULT_WINDOW + 1) is None
    assert race.accept_result(TID, "other", [1, 2, 3], T + 10) is None


def test_invalid_places_are_rejected(cars):
    rid = start_race(cars)
    for bad in ([1, 2], [1, 1, 2], [1, 3, None], [0, 1, 2], [1, 2, 3, 4], ["a", 1, 2], [[1], 1, 2], [True, 2, 3]):
        with pytest.raises(ValueError):
            race.accept_result(TID, rid, bad, T + 10)
    assert race.accept_result(TID, rid, [None, None, None], T + 10) is not None


def test_pick_car_respects_mix_and_race_off():
    cat = [{"key": k, "uid": k, "name": k} for k in ("a", "b", "c")]
    veh = {"a": {"mix": False}, "b": {"race": {"on": False}}}
    rng = random.Random(1)
    for _ in range(20):
        assert race.pick_car(cat, veh, rng, set())["car_key"] == "c"
    assert race.pick_car(cat, {"a": {"mix": False}, "b": {"mix": False}, "c": {"mix": False}}, rng, set()) == {
        "car_key": None, "uid": None, "paint": 0}


def test_pick_car_prefers_free_and_weights_paint():
    cat = [{"key": k, "uid": k, "name": k} for k in ("a", "b")]
    veh = {"a": {"paints": [{"c": "#1", "w": 0}, {"c": "#2", "w": 3}]}}
    rng = random.Random(2)
    for _ in range(20):
        p = race.pick_car(cat, veh, rng, {"b"})
        assert p["car_key"] == "a" and p["paint"] == 1
    assert race.pick_car(cat, veh, rng, {"a", "b"})["car_key"] in ("a", "b")


def test_join_without_cars_still_works():
    out = race.join(TID, "a", "a", "A", "#fff", T, ([], {}))
    assert out["ok"] is True and out["state"]["racers"][0]["car_key"] is None


def test_tenants_are_separate(cars):
    j(cars, "a", tid=1)
    assert st(tid=2)["phase"] == "idle"


# --- Endpoints ---

@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    race_db.init_schema(c)
    yield c
    c.close()


@pytest.fixture
def clock(monkeypatch):
    box = {"now": T}
    monkeypatch.setattr(endpoints, "time", types.SimpleNamespace(time=lambda: box["now"]))
    return box


def _client(conn, tmp_path, tenant_id=1):
    d = tmp_path / "data" / "car-rain"
    d.mkdir(parents=True)
    cat = [{"key": "k%d" % i, "uid": "%032x" % i, "name": "Car %d" % i, "brand": "B"} for i in range(4)]
    (d / "catalog.json").write_text(json.dumps(cat))
    app = Flask(__name__)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.config["_PROJECT_ROOT"] = str(tmp_path)
    app.register_blueprint(bp_fx)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app.test_client()


def _join(c, uid, user=None, color="%color%"):
    return c.get("/s/tok/api/fx/car-race", query_string={"cmd": "join", "id": uid, "user": user or uid, "color": color})


def test_join_endpoint_unresolved_and_color(conn, tmp_path, clock):
    c = _client(conn, tmp_path)
    r = _join(c, "%userId%", "Alice", "#AABBCC").get_json()
    assert r["ok"] is True and r["say"].startswith("@Alice is in!")
    racer = r["state"]["racers"][0]
    assert racer["user_id"] == "alice" and racer["color"] == "#aabbcc"
    assert _join(c, "42", "Bob").get_json()["state"]["racers"][1]["color"] == "#f2b705"
    assert _join(c, "42", "Bob").get_json()["ok"] is False
    assert _join(c, "7", "x" * 40).get_json()["state"]["racers"][2]["display"] == "x" * 25
    assert c.get("/s/tok/api/fx/car-race", query_string={"cmd": "join", "id": "%userId%", "user": "%user%"}).status_code == 400


def test_test_racers_and_remove(conn, tmp_path, clock):
    c = _client(conn, tmp_path)
    for _ in range(2):
        c.get("/s/tok/api/fx/car-race?cmd=join&test=1")
    c.get("/s/tok/api/fx/car-race?cmd=remove&id=test1")
    r = c.get("/s/tok/api/fx/car-race?cmd=join&test=1").get_json()
    assert [x["user_id"] for x in r["state"]["racers"]] == ["test2", "test1"]
    assert r["state"]["racers"][1]["display"] == "Tester1"


def test_result_endpoint_counts_once_and_gives_points(conn, tmp_path, clock):
    c = _client(conn, tmp_path)
    for u in "abc":
        _join(c, u)
    c.get("/s/tok/api/fx/car-race?cmd=start")
    s = c.get("/s/tok/api/fx/car-race/state").get_json()
    assert s["phase"] == "race"
    clock["now"] = T + 40
    r = c.post("/s/tok/api/fx/car-race/result", json={"race_id": s["race_id"], "places": [2, 1, None]}).get_json()
    assert r["counted"] is True
    assert r["points"]["b"]["gained"] == 3 and r["points"]["a"]["gained"] == 1 and r["points"]["c"]["gained"] == 0
    assert r["points"]["b"]["month_rank"] == 1 and r["points"]["b"]["month_total"] == 3
    again = c.post("/s/tok/api/fx/car-race/result", json={"race_id": s["race_id"], "places": [1, 2, 3]}).get_json()
    assert again["counted"] is False
    assert conn.execute("SELECT COUNT(*) FROM fx_race_result").fetchone()[0] == 3
    b = c.get("/s/tok/api/fx/car-race?cmd=board&scope=all").get_json()
    assert b["rows"][0]["user_id"] == "b" and b["say"].startswith("Top 3: 1. b 3 pts")
    c.get("/s/tok/api/fx/car-race?cmd=void")
    assert conn.execute("SELECT COUNT(*) FROM fx_race_result WHERE void = 0").fetchone()[0] == 0


def test_result_endpoint_bad_body_is_400_and_db_failure_not_counted(conn, tmp_path, clock, monkeypatch):
    c = _client(conn, tmp_path)
    for u in "abc":
        _join(c, u)
    c.get("/s/tok/api/fx/car-race?cmd=start")
    rid = c.get("/s/tok/api/fx/car-race/state").get_json()["race_id"]
    assert c.post("/s/tok/api/fx/car-race/result", json={"race_id": rid, "places": [1, 1, 2]}).status_code == 400
    assert c.post("/s/tok/api/fx/car-race/result", json={}).status_code == 400

    def boom(*a, **k):
        raise RuntimeError("db")
    monkeypatch.setattr(race_db, "record", boom)
    r = c.post("/s/tok/api/fx/car-race/result", json={"race_id": rid, "places": [1, 2, 3]}).get_json()
    assert r["counted"] is False


def test_unknown_tenant_404(conn, tmp_path):
    c = _client(conn, tmp_path, tenant_id=None)
    assert c.get("/s/tok/api/fx/car-race?cmd=join&id=1&user=a").status_code == 404
    assert c.get("/s/tok/api/fx/car-race/state").status_code == 404
    assert c.post("/s/tok/api/fx/car-race/result", json={}).status_code == 404


def test_race_with_test_racer_is_never_recorded(conn, tmp_path, clock):
    c = _client(conn, tmp_path)
    _join(c, "a")
    _join(c, "b")
    c.get("/s/tok/api/fx/car-race?cmd=join&test=1")
    c.get("/s/tok/api/fx/car-race?cmd=start")
    rid = c.get("/s/tok/api/fx/car-race/state").get_json()["race_id"]
    r = c.post("/s/tok/api/fx/car-race/result", json={"race_id": rid, "places": [1, 2, 3]}).get_json()
    assert r["counted"] is False
    assert conn.execute("SELECT COUNT(*) FROM fx_race_result").fetchone()[0] == 0
    assert c.get("/s/tok/api/fx/car-race/state").get_json()["phase"] == "podium"


def test_failed_write_can_be_retried_and_void_ignores_unstored(conn, tmp_path, clock, monkeypatch):
    c = _client(conn, tmp_path)
    for u in "abc":
        _join(c, u)
    c.get("/s/tok/api/fx/car-race?cmd=start")
    rid = c.get("/s/tok/api/fx/car-race/state").get_json()["race_id"]
    real = race_db.record
    monkeypatch.setattr(race_db, "record", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db")))
    body = {"race_id": rid, "places": [1, 2, 3]}
    assert c.post("/s/tok/api/fx/car-race/result", json=body).get_json()["counted"] is False
    assert c.get("/s/tok/api/fx/car-race?cmd=void").get_json()["ok"] is False
    monkeypatch.setattr(race_db, "record", real)
    assert c.post("/s/tok/api/fx/car-race/result", json=body).get_json()["counted"] is True


def test_user_id_is_capped(conn, tmp_path, clock):
    c = _client(conn, tmp_path)
    r = _join(c, "x" * 100).get_json()
    assert len(r["state"]["racers"][0]["user_id"]) == 64
