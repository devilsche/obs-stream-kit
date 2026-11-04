import sqlite3

import pytest
from flask import Flask, g

from fx import commands, xmas_db
from fx.endpoints import bp_fx


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    xmas_db.init_schema(c)
    yield c
    c.close()


@pytest.fixture(autouse=True)
def _clean_store():
    commands.reset_store()
    yield
    commands.reset_store()


# --- DAO ---

def test_ornaments_are_stored_once_per_name(conn):
    assert xmas_db.add_ornament(conn, 1, "Hat3") is True
    assert xmas_db.add_ornament(conn, 1, "hat3") is False      # Refollow, gleicher Name
    assert xmas_db.add_ornament(conn, 1, "") is True            # ohne Namen immer
    assert xmas_db.add_ornament(conn, 1, "") is True
    assert xmas_db.add_ornament(conn, 2, "Hat3") is True        # anderer Tenant
    state = xmas_db.load_state(conn, 1)
    assert state["ornament_total"] == 3
    assert [o["name"] for o in state["ornaments"]] == ["Hat3", "", ""]


def test_state_returns_newest_items_oldest_first(conn):
    for i in range(xmas_db.MAX_VISIBLE_ORNAMENTS + 5):
        xmas_db.add_ornament(conn, 1, "u%d" % i)
    for i in range(xmas_db.MAX_VISIBLE_GIFTS + 2):
        xmas_db.add_gift(conn, 1, "g%d" % i, "bits", 100 + i)
    state = xmas_db.load_state(conn, 1)
    names = [o["name"] for o in state["ornaments"]]
    assert len(names) == xmas_db.MAX_VISIBLE_ORNAMENTS
    assert names[0] == "u5" and names[-1] == "u%d" % (xmas_db.MAX_VISIBLE_ORNAMENTS + 4)
    assert state["ornament_total"] == xmas_db.MAX_VISIBLE_ORNAMENTS + 5
    assert len(state["gifts"]) == xmas_db.MAX_VISIBLE_GIFTS
    assert state["gifts"][-1] == {"name": "g%d" % (xmas_db.MAX_VISIBLE_GIFTS + 1),
                                  "type": "bits", "amount": 100 + xmas_db.MAX_VISIBLE_GIFTS + 1}
    assert state["gift_total"] == xmas_db.MAX_VISIBLE_GIFTS + 2


def test_clear_by_kind(conn):
    xmas_db.add_ornament(conn, 1, "a")
    xmas_db.add_gift(conn, 1, "b", "sub", 1)
    xmas_db.add_ornament(conn, 2, "c")
    xmas_db.clear(conn, 1, "gifts")
    s = xmas_db.load_state(conn, 1)
    assert (s["ornament_total"], s["gift_total"]) == (1, 0)
    xmas_db.clear(conn, 1, None)
    assert xmas_db.load_state(conn, 1)["ornament_total"] == 0
    assert xmas_db.load_state(conn, 2)["ornament_total"] == 1


# --- Endpoint ---

def _app(conn, tenant_id=1):
    app = Flask(__name__)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.register_blueprint(bp_fx)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app


def test_endpoint_persists_and_skips_duplicates(conn):
    c = _app(conn).test_client()
    r = c.get("/s/tok/api/fx/xmas?cmd=ornament&name=Hat3")
    assert r.get_json() == {"ok": True, "seq": 1}
    r = c.get("/s/tok/api/fx/xmas?cmd=ornament&name=HAT3")
    assert r.get_json() == {"ok": True, "duplicate": True}
    c.get("/s/tok/api/fx/xmas?cmd=gift&name=Mia&type=giftsub&amount=5")

    body = c.get("/s/tok/api/fx/xmas/poll").get_json()
    assert body["seq"] == 2
    assert body["state"]["ornament_total"] == 1
    assert body["state"]["gifts"] == [{"name": "Mia", "type": "giftsub", "amount": 5}]

    body = c.get("/s/tok/api/fx/xmas/poll?since=1").get_json()
    assert [x["cmd"] for x in body["commands"]] == ["gift"]
    assert body["commands"][0]["params"] == {"name": "Mia", "type": "giftsub", "amount": 5}


def test_endpoint_clear_kind(conn):
    c = _app(conn).test_client()
    c.get("/s/tok/api/fx/xmas?cmd=ornament&name=a")
    c.get("/s/tok/api/fx/xmas?cmd=gift&name=b")
    c.get("/s/tok/api/fx/xmas?cmd=clear&kind=ornaments")
    s = c.get("/s/tok/api/fx/xmas/poll").get_json()["state"]
    assert (s["ornament_total"], s["gift_total"]) == (0, 1)


def test_rain_poll_has_no_db_state(conn):
    body = _app(conn).test_client().get("/s/tok/api/fx/rain/poll").get_json()
    assert body["state"] == {}


def test_snow_events_are_logged_with_time(conn):
    xmas_db.persist(conn, 1, {"cmd": "snowfall", "params": {"secs": 60}})
    xmas_db.persist(conn, 1, {"cmd": "shovel", "params": {"name": "Hat3"}})
    xmas_db.persist(conn, 1, {"cmd": "shake", "params": {}})
    xmas_db.persist(conn, 1, {"cmd": "snowstop", "params": {}})
    xmas_db.persist(conn, 1, {"cmd": "melt", "params": {}})
    xmas_db.persist(conn, 1, {"cmd": "leaders", "params": {}})     # nur Anzeige, kein Ereignis
    ev = xmas_db.load_state(conn, 1)["snow_events"]
    assert [(e["k"], e["n"], e["s"]) for e in ev] == [
        ("start", "", 60), ("shovel", "Hat3", None), ("shake", "", None), ("stop", "", None), ("melt", "", None)]
    assert all(isinstance(e["t"], float) and e["t"] > 1.7e9 for e in ev)
    # Schnee zählt nicht als Kugel/Geschenk
    s = xmas_db.load_state(conn, 1)
    assert (s["ornament_total"], s["gift_total"]) == (0, 0)


def test_snowtoggle_alternates_and_becomes_start_or_stop(conn):
    c1 = {"cmd": "snowtoggle", "params": {}}
    xmas_db.persist(conn, 1, c1)
    assert c1["cmd"] == "snowfall"          # ans Overlay geht der aufgelöste Befehl
    c2 = {"cmd": "snowtoggle", "params": {}}
    xmas_db.persist(conn, 1, c2)
    assert c2["cmd"] == "snowstop"
    xmas_db.persist(conn, 1, {"cmd": "shovel", "params": {"name": "x"}})
    c3 = {"cmd": "snowtoggle", "params": {}}
    xmas_db.persist(conn, 1, c3)
    assert c3["cmd"] == "snowfall"
    assert [e["k"] for e in xmas_db.load_state(conn, 1)["snow_events"]] == ["start", "stop", "shovel", "start"]
    # anderer Tenant beginnt bei "aus"
    c4 = {"cmd": "snowtoggle", "params": {}}
    xmas_db.persist(conn, 2, c4)
    assert c4["cmd"] == "snowfall"


def test_poll_reports_server_time(conn):
    body = _app(conn).test_client().get("/s/tok/api/fx/xmas/poll").get_json()
    assert isinstance(body["now"], float) and body["now"] > 1.7e9


def test_clear_snow_keeps_ornaments(conn):
    xmas_db.add_ornament(conn, 1, "a")
    xmas_db.persist(conn, 1, {"cmd": "snowfall", "params": {}})
    xmas_db.clear(conn, 1, "snow")
    s = xmas_db.load_state(conn, 1)
    assert s["snow_events"] == [] and s["ornament_total"] == 1
    xmas_db.persist(conn, 1, {"cmd": "snowfall", "params": {}})
    xmas_db.clear(conn, 1, None)
    assert xmas_db.load_state(conn, 1)["snow_events"] == []


def test_forced_shake_is_logged_as_shakeall(conn):
    xmas_db.persist(conn, 1, commands.parse("xmas", {"cmd": "shake", "force": "1"}))
    xmas_db.persist(conn, 1, commands.parse("xmas", {"cmd": "shake", "name": "Hat3", "force": "0"}))
    assert [e["k"] for e in xmas_db.load_state(conn, 1)["snow_events"]] == ["shakeall", "shake"]
