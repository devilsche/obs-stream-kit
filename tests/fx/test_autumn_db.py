import sqlite3

import pytest
from flask import Flask, g

from fx import autumn_db, commands
from fx.endpoints import bp_fx


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    autumn_db.init_schema(c)
    yield c
    c.close()


@pytest.fixture(autouse=True)
def _clean_store():
    commands.reset_store()
    yield
    commands.reset_store()


def _app(conn, tenant_id=1):
    app = Flask(__name__)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.register_blueprint(bp_fx)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app


# --- Befehle ---

def test_autumn_set_normalizes_values():
    out = commands.parse("autumn", {"cmd": "set", "branch": "RIGHT", "colors": "maple",
                                    "leafrate": "999", "rake": "0", "garlandy": "60",
                                    "faces": "on", "density": "laser"})
    assert out["params"] == {"branch": "right", "colors": "maple", "leafrate": 300,
                             "rake": 1, "garlandy": 60, "faces": True}


def test_autumn_command_args():
    assert commands.parse("autumn", {"cmd": "pumpkin", "name": "<b>Hat3</b>"})["params"] == {"name": "bHat3b"}
    assert commands.parse("autumn", {"cmd": "rake", "name": "Mia"})["params"] == {"name": "Mia"}
    assert commands.parse("autumn", {"cmd": "leaffall", "secs": "60"})["params"] == {"secs": 60}
    assert commands.parse("autumn", {"cmd": "clear", "kind": "leaves"})["params"] == {"kind": "leaves"}
    assert commands.parse("autumn", {"cmd": "clear", "kind": "snow"})["params"] == {}
    for cmd in ("gust", "sweep", "leaders", "leafstop", "leaftoggle", "reset"):
        assert commands.parse("autumn", {"cmd": cmd}) == {"cmd": cmd, "params": {}}
    with pytest.raises(ValueError):
        commands.parse("autumn", {"cmd": "shovel"})


# --- DAO ---

def test_pumpkins_once_per_name_and_limited(conn):
    assert autumn_db.add_pumpkin(conn, 1, "Hat3") is True
    assert autumn_db.add_pumpkin(conn, 1, "HAT3") is False
    assert autumn_db.add_pumpkin(conn, 1, "") is True
    assert autumn_db.add_pumpkin(conn, 2, "Hat3") is True
    for i in range(autumn_db.MAX_VISIBLE_PUMPKINS + 3):
        autumn_db.add_pumpkin(conn, 1, "u%d" % i)
    s = autumn_db.load_state(conn, 1)
    assert s["pumpkin_total"] == autumn_db.MAX_VISIBLE_PUMPKINS + 5
    names = [p["name"] for p in s["pumpkins"]]
    assert len(names) == autumn_db.MAX_VISIBLE_PUMPKINS
    assert names[-1] == "u%d" % (autumn_db.MAX_VISIBLE_PUMPKINS + 2)


def test_leaf_events_are_logged_with_time(conn):
    autumn_db.persist(conn, 1, {"cmd": "leaffall", "params": {"secs": 60}})
    autumn_db.persist(conn, 1, {"cmd": "rake", "params": {"name": "Hat3"}})
    autumn_db.persist(conn, 1, {"cmd": "jump", "params": {"name": "Mia"}})    # nur Anzeige
    autumn_db.persist(conn, 1, {"cmd": "gust", "params": {}})                 # nur Anzeige
    autumn_db.persist(conn, 1, {"cmd": "leafstop", "params": {}})
    autumn_db.persist(conn, 1, {"cmd": "sweep", "params": {}})
    ev = autumn_db.load_state(conn, 1)["leaf_events"]
    assert [(e["k"], e["n"], e["s"]) for e in ev] == [
        ("start", "", 60), ("rake", "Hat3", None), ("stop", "", None), ("sweep", "", None)]
    assert all(isinstance(e["t"], float) and e["t"] > 1.7e9 for e in ev)
    assert autumn_db.load_state(conn, 1)["pumpkin_total"] == 0


def test_leaftoggle_alternates(conn):
    c1 = {"cmd": "leaftoggle", "params": {}}
    autumn_db.persist(conn, 1, c1)
    assert c1["cmd"] == "leaffall"
    c2 = {"cmd": "leaftoggle", "params": {}}
    autumn_db.persist(conn, 1, c2)
    assert c2["cmd"] == "leafstop"
    c3 = {"cmd": "leaftoggle", "params": {}}
    autumn_db.persist(conn, 2, c3)                  # anderer Tenant beginnt bei "aus"
    assert c3["cmd"] == "leaffall"


def test_clear_by_kind(conn):
    autumn_db.add_pumpkin(conn, 1, "a")
    autumn_db.persist(conn, 1, {"cmd": "rake", "params": {"name": "b"}})
    autumn_db.add_pumpkin(conn, 2, "c")
    autumn_db.clear(conn, 1, "leaves")
    s = autumn_db.load_state(conn, 1)
    assert s["leaf_events"] == [] and s["pumpkin_total"] == 1
    autumn_db.clear(conn, 1, None)
    assert autumn_db.load_state(conn, 1)["pumpkin_total"] == 0
    assert autumn_db.load_state(conn, 2)["pumpkin_total"] == 1


# --- Endpoint ---

def test_endpoint_persists_pumpkins_and_resolves_toggle(conn):
    c = _app(conn).test_client()
    assert c.get("/s/tok/api/fx/autumn?cmd=pumpkin&name=Hat3").get_json() == {"ok": True, "seq": 1}
    assert c.get("/s/tok/api/fx/autumn?cmd=pumpkin&name=hat3").get_json() == {"ok": True, "duplicate": True}
    c.get("/s/tok/api/fx/autumn?cmd=leaftoggle")

    body = c.get("/s/tok/api/fx/autumn/poll").get_json()
    assert body["state"]["pumpkins"] == [{"name": "Hat3"}]
    assert [e["k"] for e in body["state"]["leaf_events"]] == ["start"]

    body = c.get("/s/tok/api/fx/autumn/poll?since=1").get_json()
    assert [x["cmd"] for x in body["commands"]] == ["leaffall"]
