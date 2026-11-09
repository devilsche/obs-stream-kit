"""Weather-Source: Befehle, Übersteuerung und Zustands-Endpoint."""
import json
import sqlite3

import pytest
from flask import Flask, g

from fx import commands, weather_api, weather_db, weather_state
from fx.endpoints import bp_fx

LOC = {"lat": 50.1109, "lon": 8.6821, "label": "Frankfurt am Main, Hessen, Deutschland"}


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    weather_db.init_schema(c)
    c.execute("CREATE TABLE settings (tenant_id INT, key TEXT, value TEXT, updated_at TEXT,"
              " PRIMARY KEY (tenant_id, key))")
    yield c
    c.close()


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    commands.reset_store()
    weather_api.reset_cache()
    # Standard: keine laufende Session, API liefert nichts
    monkeypatch.setattr(weather_state, "kd_snapshot",
                        lambda conn, tid: {"kd": 0.0, "matches": 0, "live": False})
    monkeypatch.setattr(weather_state, "current", lambda tid, lat, lon: None)
    yield
    commands.reset_store()


def _client(conn, tenant_id=1):
    app = Flask(__name__)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.register_blueprint(bp_fx)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app.test_client()


def _with_location(conn, monkeypatch, kind_code=0):
    conn.execute("INSERT INTO settings VALUES (1, 'weather.location', ?, 'x')", (json.dumps(LOC),))
    from fx.weather import from_api
    monkeypatch.setattr(weather_state, "current",
                        lambda tid, lat, lon: from_api(kind_code, 12, 10, 270))


def _state(client, q=""):
    r = client.get("/s/t/api/fx/weather/state" + q)
    assert r.status_code == 200 and r.headers["Cache-Control"] == "no-store"
    return r.json["state"]


def test_no_location_uses_fallback(conn):
    st = _state(_client(conn), "?fallback=snow")
    assert st["kind"] == "snow" and st["source"] == "fallback" and st["transition"] == 25
    assert _state(_client(conn))["kind"] == "clear"


def test_location_uses_api(conn, monkeypatch):
    _with_location(conn, monkeypatch, kind_code=63)
    st = _state(_client(conn))
    assert st["kind"] == "rain" and st["source"] == "api" and st["wind"] == 0.2


def test_api_down_uses_fallback(conn, monkeypatch):
    conn.execute("INSERT INTO settings VALUES (1, 'weather.location', ?, 'x')", (json.dumps(LOC),))
    assert _state(_client(conn), "?fallback=fog")["source"] == "fallback"


def test_weather_command_sets_override_and_state_reports_it(conn):
    c = _client(conn)
    assert c.get("/s/t/api/fx/weather?cmd=weather&to=storm").json["ok"]
    st = _state(c)
    assert st["kind"] == "storm" and st["source"] == "override" and st["transition"] == 4
    assert st["until"] is not None
    # Befehl geht auch in die Warteschlange, damit das Overlay sofort nachlädt
    assert c.get("/s/t/api/fx/weather/poll?since=0").json["commands"][0]["cmd"] == "weather"


def test_forced_and_auto(conn, monkeypatch):
    _with_location(conn, monkeypatch)
    c = _client(conn)
    c.get("/s/t/api/fx/weather?cmd=weather&to=blizzard&hold=0")
    assert _state(c)["until"] is None
    c.get("/s/t/api/fx/weather?cmd=auto")
    assert _state(c)["source"] == "api"


def test_unknown_weather_kind_is_rejected(conn):
    r = _client(conn).get("/s/t/api/fx/weather?cmd=weather&to=hail")
    assert r.status_code == 400


def test_state_never_contains_location(conn, monkeypatch):
    _with_location(conn, monkeypatch)
    body = _client(conn).get("/s/t/api/fx/weather/state").get_data(as_text=True)
    for leak in ("50.11", "8.68", "Frankfurt", "lat", "lon", "label"):
        assert leak not in body


def test_bad_kd_brings_rain_and_mood_zero_turns_it_off(conn, monkeypatch):
    monkeypatch.setattr(weather_state, "kd_snapshot",
                        lambda conn, tid: {"kd": 1.0, "matches": 5, "live": True})
    c = _client(conn)
    st = _state(c)
    assert st["kind"] == "rain" and st["gloom"] == 1 and st["lightning"] == 0
    assert st["mood"] == -1
    assert _state(c, "?mood=0")["kind"] == "clear"


def test_custom_bounds_and_test_kd(conn):
    c = _client(conn)
    st = _state(c, "?kdtest=1.4")                     # unter 1,5 → Niesel
    assert st["kind"] == "drizzle"
    st = _state(c, "?kdtest=1.8&kdlow=1&kdhigh=2")    # mit eigenen Grenzen gut
    assert st["kind"] == "clear" and st["mood"] > 0
    assert _state(c, "?kdtest=off")["mood"] == 0


def test_override_beats_mood(conn):
    c = _client(conn)
    c.get("/s/t/api/fx/weather?cmd=weather&to=snow")
    st = _state(c, "?kdtest=0.5")
    assert st["kind"] == "snow" and st["gloom"] == 0


def test_spectacle_and_strike_are_queued(conn):
    c = _client(conn)
    assert c.get("/s/t/api/fx/weather?cmd=spectacle&type=tsunami").json["ok"]
    assert c.get("/s/t/api/fx/weather?cmd=strike&dist=near").json["ok"]
    cmds = c.get("/s/t/api/fx/weather/poll?since=0").json["commands"]
    assert [x["params"] for x in cmds] == [{"type": "tsunami"}, {"dist": "near"}]
    assert _state(c)["source"] == "fallback"
    assert c.get("/s/t/api/fx/weather?cmd=spectacle&type=meteor").json["ok"]  # ungültig → ohne type


def test_settings_parse():
    p = commands.parse("weather", {"cmd": "set", "mood": "3", "kdlow": "1.2", "lock": "STORM",
                                   "veil": "on", "kdtest": "off", "fallback": "snow"})["params"]
    assert p == {"mood": 1.0, "kdlow": 1.2, "lock": "storm", "veil": True,
                 "kdtest": "off", "fallback": "snow"}
    assert commands.parse("weather", {"cmd": "weather", "to": "fog"})["params"] == {"to": "fog", "hold": 150}


def test_tenants_are_separate(conn):
    _client(conn, 1).get("/s/t/api/fx/weather?cmd=weather&to=storm&hold=0")
    assert _state(_client(conn, 2))["source"] == "fallback"
