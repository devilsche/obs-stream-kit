import sqlite3

import pytest
from flask import Flask, g

from fx import commands, season_db
from fx.endpoints import bp_fx


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    season_db.init_schema(c)
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

def test_season_settings_are_clamped():
    assert commands.parse("winter", {"cmd": "set", "smpos": "LEFT", "snowrate": "999", "scrape": "0"})["params"] == {
        "smpos": "left", "snowrate": 300, "scrape": 1}
    assert commands.parse("spring", {"cmd": "set", "dryrate": "0", "colors": "cherry", "pullneed": "50"})["params"] == {
        "dryrate": 0.0, "colors": "cherry", "pullneed": 20}
    assert commands.parse("summer", {"cmd": "set", "evening": "1", "heatrate": "-5"})["params"] == {
        "evening": True, "heatrate": 1}


def test_season_commands_and_args():
    assert commands.parse("winter", {"cmd": "build", "name": "Hat3"})["params"] == {"name": "Hat3"}
    assert commands.parse("winter", {"cmd": "clear", "kind": "snowman"})["params"] == {"kind": "snowman"}
    assert commands.parse("spring", {"cmd": "rainfall", "secs": "60"})["params"] == {"secs": 60}
    assert commands.parse("summer", {"cmd": "ice", "name": "Mia"})["params"] == {"name": "Mia"}
    assert commands.parse("summer", {"cmd": "clear", "kind": "flowers"})["params"] == {}
    with pytest.raises(ValueError):
        commands.parse("spring", {"cmd": "shovel"})


# --- DAO ---

def test_items_once_per_name_per_effect(conn):
    assert season_db.add_item(conn, 1, "spring", "Hat3") is True
    assert season_db.add_item(conn, 1, "spring", "hat3") is False
    assert season_db.add_item(conn, 1, "summer", "Hat3") is True      # anderer Effekt
    assert season_db.add_item(conn, 2, "spring", "Hat3") is True      # anderer Tenant
    assert season_db.add_item(conn, 1, "spring", "") is True
    s = season_db.load_state(conn, 1, "spring")
    assert s["item_total"] == 2 and [i["name"] for i in s["items"]] == ["Hat3", ""]


def test_visible_items_are_limited(conn):
    limit = season_db.SPECS["summer"]["item"][1]
    for i in range(limit + 4):
        season_db.add_item(conn, 1, "summer", "c%d" % i)
    s = season_db.load_state(conn, 1, "summer")
    assert len(s["items"]) == limit and s["items"][-1]["name"] == "c%d" % (limit + 3)
    assert s["item_total"] == limit + 4


def test_events_start_with_begin_and_skip_show_only_commands(conn):
    season_db.persist("winter", conn, 1, {"cmd": "snowfall", "params": {"secs": 90}})
    season_db.persist("winter", conn, 1, {"cmd": "scrape", "params": {"name": "Mia"}})
    season_db.persist("winter", conn, 1, {"cmd": "snowball", "params": {"name": "Bob"}})   # nur Show
    season_db.persist("winter", conn, 1, {"cmd": "build", "params": {"name": "Hat3"}})
    ev = season_db.load_state(conn, 1, "winter")["events"]
    assert [(e["k"], e["n"], e["s"]) for e in ev] == [
        ("begin", "", None), ("start", "", 90), ("scrape", "Mia", None), ("build", "Hat3", None)]
    assert all(e["t"] > 1.7e9 for e in ev)
    assert season_db.load_state(conn, 1, "spring")["events"] == []


def test_toggle_alternates_per_effect(conn):
    c = {"cmd": "raintoggle", "params": {}}
    season_db.persist("spring", conn, 1, c)
    assert c["cmd"] == "rainfall"
    c = {"cmd": "heattoggle", "params": {}}
    season_db.persist("summer", conn, 1, c)
    assert c["cmd"] == "heatwave"                 # Regen läuft, Hitze ist eigener Effekt
    c = {"cmd": "raintoggle", "params": {}}
    season_db.persist("spring", conn, 1, c)
    assert c["cmd"] == "rainstop"


def test_clear_kinds(conn):
    season_db.add_item(conn, 1, "winter", "a")
    for cmd in ("snowfall", "shovel", "build", "build"):
        season_db.persist("winter", conn, 1, {"cmd": cmd, "params": {}})
    season_db.clear(conn, 1, "winter", "snow")
    s = season_db.load_state(conn, 1, "winter")
    assert [e["k"] for e in s["events"]] == ["begin", "build", "build"] and s["item_total"] == 1
    season_db.clear(conn, 1, "winter", "snowman")
    assert [e["k"] for e in season_db.load_state(conn, 1, "winter")["events"]] == ["begin"]
    season_db.add_item(conn, 1, "spring", "b")
    season_db.clear(conn, 1, "winter", None)
    assert season_db.load_state(conn, 1, "winter") == {"events": [], "items": [], "item_total": 0}
    assert season_db.load_state(conn, 1, "spring")["item_total"] == 1


# --- Endpoint ---

def test_endpoint_round_trip(conn):
    c = _app(conn).test_client()
    assert c.get("/s/tok/api/fx/summer?cmd=castle&name=Hat3").get_json() == {"ok": True, "seq": 1}
    assert c.get("/s/tok/api/fx/summer?cmd=castle&name=HAT3").get_json() == {"ok": True, "duplicate": True}
    c.get("/s/tok/api/fx/summer?cmd=heattoggle")
    body = c.get("/s/tok/api/fx/summer/poll").get_json()
    assert body["state"]["items"] == [{"name": "Hat3"}]
    assert [e["k"] for e in body["state"]["events"]] == ["begin", "start"]
    body = c.get("/s/tok/api/fx/summer/poll?since=1").get_json()
    assert [x["cmd"] for x in body["commands"]] == ["heatwave"]
    assert c.get("/s/tok/api/fx/spring/poll").get_json()["state"]["items"] == []


# --- force=1 (Dashboard-Knopf) ---

def test_forced_group_actions_get_their_own_event(conn):
    for effect, cmd, forced in (("winter", "shake", "shakeall"), ("spring", "weed", "pullall")):
        season_db.persist(effect, conn, 1, commands.parse(effect, {"cmd": cmd, "force": "1"}))
        season_db.persist(effect, conn, 1, commands.parse(effect, {"cmd": cmd, "name": "Hat3"}))
        kinds = [e["k"] for e in season_db.load_state(conn, 1, effect)["events"]]
        assert kinds == ["begin", forced, cmd]


def test_clear_snow_removes_forced_shakes(conn):
    season_db.persist("winter", conn, 1, commands.parse("winter", {"cmd": "shake", "force": "1"}))
    season_db.persist("winter", conn, 1, commands.parse("winter", {"cmd": "build", "name": "Hat3"}))
    season_db.clear(conn, 1, "winter", "snow")
    kinds = [e["k"] for e in season_db.load_state(conn, 1, "winter")["events"]]
    assert kinds == ["begin", "build"]
