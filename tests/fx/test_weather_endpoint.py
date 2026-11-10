"""Weather-Source: Befehle, Übersteuerung und Zustands-Endpoint."""
import sqlite3

import pytest
from flask import Flask, g

from fx import autumn_db, commands, season_db, weather_api, weather_followers, weather_season, weather_db, weather_frost, weather_snow, weather_state, weather_theme, xmas_db
from fx.endpoints import bp_fx

LOC = {"lat": 50.1109, "lon": 8.6821, "label": "Frankfurt am Main, Hessen, Deutschland"}


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    weather_db.init_schema(c)
    weather_frost.init_schema(c)
    weather_snow.init_schema(c)
    weather_theme.init_schema(c)
    xmas_db.init_schema(c)
    season_db.init_schema(c)
    autumn_db.init_schema(c)
    weather_season.init_schema(c)
    weather_followers.init_schema(c)
    weather_state.LAST_THEME.clear()
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
    monkeypatch.setattr(weather_state, "climate", lambda lat, lon: None)
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
    """Ort kommt als ?place= aus der Overlay-URL; Suche und Wetter gefälscht."""
    from fx.weather import from_api
    monkeypatch.setattr(weather_state, "geocode",
                        lambda q: LOC if q == "Frankfurt" else None)
    monkeypatch.setattr(weather_state, "current",
                        lambda tid, lat, lon: from_api(kind_code, 12, 10, 270))
    return "?place=Frankfurt"


def _state(client, q=""):
    r = client.get("/s/t/api/fx/weather/state" + q)
    assert r.status_code == 200 and r.headers["Cache-Control"] == "no-store"
    return r.json["state"]


def test_no_location_uses_fallback(conn):
    st = _state(_client(conn), "?fallback=snow")
    assert st["kind"] == "snow" and st["source"] == "fallback" and st["transition"] == 25
    assert _state(_client(conn))["kind"] == "clear"


def test_location_uses_api(conn, monkeypatch):
    q = _with_location(conn, monkeypatch, kind_code=63)
    st = _state(_client(conn), q)
    assert st["kind"] == "rain" and st["source"] == "api" and st["wind"] == 0.2


def test_api_down_uses_fallback(conn, monkeypatch):
    _with_location(conn, monkeypatch)
    monkeypatch.setattr(weather_state, "current", lambda tid, lat, lon: None)
    assert _state(_client(conn), "?place=Frankfurt&fallback=fog")["source"] == "fallback"


def test_unknown_place_uses_fallback(conn, monkeypatch):
    _with_location(conn, monkeypatch)
    assert _state(_client(conn), "?place=Xyzzy")["source"] == "fallback"


def test_weather_command_sets_override_and_state_reports_it(conn):
    c = _client(conn)
    assert c.get("/s/t/api/fx/weather?cmd=weather&to=storm").json["ok"]
    st = _state(c)
    assert st["kind"] == "storm" and st["source"] == "override" and st["transition"] == 4
    assert st["until"] is not None
    # Befehl geht auch in die Warteschlange, damit das Overlay sofort nachlädt
    assert c.get("/s/t/api/fx/weather/poll?since=0").json["commands"][0]["cmd"] == "weather"


def test_forced_and_auto(conn, monkeypatch):
    q = _with_location(conn, monkeypatch)
    c = _client(conn)
    c.get("/s/t/api/fx/weather?cmd=weather&to=blizzard&hold=0")
    assert _state(c, q)["until"] is None
    c.get("/s/t/api/fx/weather?cmd=auto")
    assert _state(c, q)["source"] == "api"


def test_unknown_weather_kind_is_rejected(conn):
    r = _client(conn).get("/s/t/api/fx/weather?cmd=weather&to=hail")
    assert r.status_code == 400


def test_state_never_contains_location(conn, monkeypatch):
    q = _with_location(conn, monkeypatch)
    body = _client(conn).get("/s/t/api/fx/weather/state" + q).get_data(as_text=True)
    assert '"source":"api"' in body.replace(" ", "")
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


def test_kdtest_off_means_real_kd(conn, monkeypatch):
    monkeypatch.setattr(weather_state, "kd_snapshot",
                        lambda conn, tid: {"kd": 1.0, "matches": 5, "live": True})
    assert _state(_client(conn), "?kdtest=off")["mood"] == -1


def test_place_setting_parses():
    assert commands.parse("weather", {"cmd": "set", "place": "  Bad   Homburg "})["params"] == {
        "place": "Bad Homburg"}


def test_wind_setting_accepts_auto_and_random():
    for v in ("auto", "random"):
        assert commands.parse("weather", {"cmd": "set", "wind": v})["params"] == {"wind": v}
    assert commands.parse("weather", {"cmd": "set", "wind": "-3"})["params"] == {"wind": -1.0}


def test_night_from_api_reaches_override_and_never_leaks_sun_times(conn, monkeypatch):
    import time as _t
    from fx.weather import from_api
    now = _t.time()
    monkeypatch.setattr(weather_state, "geocode", lambda q: LOC)
    monkeypatch.setattr(weather_state, "current", lambda tid, lat, lon: {
        **from_api(0, 5, 5, 270), "_sunrise": now - 20 * 3600, "_sunset": now - 4 * 3600})
    c = _client(conn)
    st = _state(c, "?place=Frankfurt")
    assert st["night"] == 1 and st["sun"] == 0
    assert "_sunrise" not in st and "_sunset" not in st
    c.get("/s/t/api/fx/weather?cmd=weather&to=clear")
    st = _state(c, "?place=Frankfurt")
    assert st["source"] == "override" and st["night"] == 1 and st["sun"] == 0


def test_test_background_accepts_only_plain_http_urls():
    ok = "https://example.com/shots/game_1.jpg"
    assert commands.parse("weather", {"cmd": "set", "testbg": ok})["params"] == {"testbg": ok}
    for bad in ("javascript:alert(1)", "https://x.com/a.jpg) ; color:red", 'https://x.com/"a.jpg', "ftp://x/a.jpg"):
        try:
            commands.parse("weather", {"cmd": "set", "testbg": bad})
            raise AssertionError(bad)
        except ValueError:
            pass


def test_fixed_weather_replaces_only_the_real_weather(conn, monkeypatch):
    q = _with_location(conn, monkeypatch, kind_code=63)      # live: Regen
    c = _client(conn)
    st = _state(c, q + "&lock=clear")
    assert st["kind"] == "clear" and st["source"] == "lock"
    st = _state(c, q + "&lock=clear&kdtest=0.8")             # Stimmung wirkt auf die feste Lage
    assert st["kind"] == "rain" and st["mood"] == -1
    assert _state(c, q + "&lock=clear&kdtest=3.5")["sun"] > 0.9
    c.get("/s/t/api/fx/weather?cmd=weather&to=snow")         # Chat schlägt feste Lage
    assert _state(c, q + "&lock=clear")["kind"] == "snow"


def test_fixed_weather_off_uses_live(conn, monkeypatch):
    q = _with_location(conn, monkeypatch, kind_code=63)
    assert _state(_client(conn), q + "&lock=off")["source"] == "api"


def test_sun_and_moon_positions_are_coarse_and_leak_nothing(conn, monkeypatch):
    q = _with_location(conn, monkeypatch)
    r = _client(conn).get("/s/t/api/fx/weather/state" + q)
    st = r.json["state"]
    for k in ("sunUp", "sunX", "sunY", "moonUp", "moonX", "moonY", "moonLit", "moonWax"):
        assert k in st
    assert 0 <= st["sunX"] <= 1 and 0 <= st["moonLit"] <= 1
    assert round(st["sunX"] / 0.02, 6) == round(st["sunX"] / 0.02)
    body = r.get_data(as_text=True)
    assert "50.11" not in body and "8.68" not in body


def test_no_location_means_no_sky_positions(conn):
    st = _state(_client(conn))
    assert "sunX" not in st and "moonX" not in st


def test_aurora_rewards_a_very_good_night(conn, monkeypatch):
    import time as _t
    from fx.weather import from_api
    now = _t.time()
    monkeypatch.setattr(weather_state, "geocode", lambda q: LOC)
    monkeypatch.setattr(weather_state, "current", lambda tid, lat, lon: {
        **from_api(0, 5, 5, 270), "_sunrise": now - 20 * 3600, "_sunset": now - 4 * 3600})
    c = _client(conn)
    assert _state(c, "?place=F&kdtest=3.5")["aurora"] > 0.9
    assert _state(c, "?place=F&kdtest=2.6")["aurora"] == 0
    assert _state(c, "?place=F&kdtest=3.5&aurorakd=4")["aurora"] == 0
    assert _state(c, "?place=F&kdtest=3.5&aurorakd=0")["aurora"] == 0      # 0 = aus
    assert _state(c, "?place=F&kdtest=3.5&mood=0")["aurora"] == 0          # Stimmung aus


def test_fixed_night_shows_a_moon_even_at_new_moon(conn, monkeypatch):
    q = _with_location(conn, monkeypatch)
    st = _state(_client(conn), q + "&lock=night&kdtest=3.5")
    assert st["night"] == 1 and st["sunUp"] == 0
    assert st["moonUp"] == 1 and st["moonLit"] >= 0.8 and st["aurora"] > 0.9


def test_no_aurora_behind_full_clouds(conn, monkeypatch):
    import time as _t
    from fx.weather import from_api
    now = _t.time()
    monkeypatch.setattr(weather_state, "geocode", lambda q: LOC)
    monkeypatch.setattr(weather_state, "current", lambda tid, lat, lon: {
        **from_api(3, 1, 5, 270, cloud=100), "_sunrise": now - 20 * 3600, "_sunset": now - 4 * 3600})
    st = _state(_client(conn), "?place=F&kdtest=3.5")
    assert st["night"] == 1 and st["aurora"] < 0.2


def test_frost_grows_in_blizzard_and_chat_scrapes(conn, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(weather_state.time, "time", lambda: clock[0])
    import fx.endpoints as ep
    monkeypatch.setattr(ep.time, "time", lambda: clock[0])
    c = _client(conn)
    assert _state(c, "?lock=blizzard")["frost"] == 0
    clock[0] += 300                                              # 5 min Schneesturm
    st = _state(c, "?lock=blizzard")
    assert st["frost"] == 50 and st["frostTop"] == []
    r = c.get("/s/t/api/fx/weather?cmd=scrape&name=Mia").json
    assert r["ok"]
    cmd = c.get("/s/t/api/fx/weather/poll?since=0").json["commands"][-1]
    assert cmd["cmd"] == "scrape" and cmd["params"] == {"name": "Mia", "done": 6, "level": 44}
    assert _state(c, "?lock=blizzard")["frostTop"] == [["Mia", 1]]


def test_frost_off_setting_hides_but_keeps_state(conn):
    assert "frost" in _state(_client(conn), "?frost=0")
    assert _state(_client(conn), "?frost=0")["frostOn"] is False


def test_frost_commands_parse():
    assert commands.parse("weather", {"cmd": "warm", "name": "Tom"})["params"] == {"name": "Tom"}
    for c in ("frostclear", "frostreset", "leaders"):
        assert commands.parse("weather", {"cmd": c})["cmd"] == c
    assert commands.parse("weather", {"cmd": "set", "frostrate": "9", "frost": "off"})["params"] == {
        "frostrate": 4.0, "frost": False}


def test_fixed_dawn_puts_the_sun_low_in_the_east(conn, monkeypatch):
    q = _with_location(conn, monkeypatch)
    st = _state(_client(conn), q + "&lock=dawn")
    assert st["kind"] == "dawn" and st["dusk"] == 1 and st["sunUp"] == 1 and st["sunX"] < 0.3


def test_sound_settings_parse():
    assert commands.parse("weather", {"cmd": "set", "sound": "1", "volume": "0.4", "thunder": "2"})["params"] == {
        "sound": True, "volume": 0.4, "thunder": 1.0}


# --- Winter-Thema ---

def test_winter_items_are_stored_and_listed_in_first_poll(conn):
    c = _client(conn)
    assert c.get("/s/t/api/fx/weather?cmd=ornament&name=Mia").json["ok"]
    assert c.get("/s/t/api/fx/weather?cmd=ornament&name=mia").json.get("duplicate")   # Refollow
    c.get("/s/t/api/fx/weather?cmd=gift&name=Tom&type=bits&amount=500")
    c.get("/s/t/api/fx/weather?cmd=mini&name=Lea")
    c.get("/s/t/api/fx/weather?cmd=build&name=Sub1")
    c.get("/s/t/api/fx/weather?cmd=build&name=Sub2")
    st = c.get("/s/t/api/fx/weather/poll").json["state"]
    # gemeinsame Follower-Liste: Kugel und Mini sind dieselben Leute
    assert [o["name"] for o in st["ornaments"]] == ["Mia", "Lea"] and st["ornament_total"] == 2
    assert [m["name"] for m in st["minis"]] == ["Mia", "Lea"] and st["follower_total"] == 2
    assert st["gifts"] == [{"name": "Tom", "type": "bits", "amount": 500}]
    assert st["snowman"] == 2 and st["project"] == 2
    c.get("/s/t/api/fx/weather?cmd=snowmanreset")
    assert c.get("/s/t/api/fx/weather/poll").json["state"]["snowman"] == 0


def test_state_reports_theme_and_xmas(conn):
    c = _client(conn)
    st = _state(c, "?theme=winter")
    assert st["theme"] == "winter" and st["xmas"] in ("off", "setup", "on", "farewell")
    c.get("/s/t/api/fx/weather?cmd=setup")
    assert _state(c, "?theme=winter")["xmas"] == "on"
    c.get("/s/t/api/fx/weather?cmd=farewell")
    assert _state(c, "?theme=winter")["xmas"] == "off"
    assert _state(c, "?theme=none")["theme"] == "none"


def test_shovel_and_shake_report_results(conn, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(weather_state.time, "time", lambda: clock[0])
    import fx.endpoints as ep
    monkeypatch.setattr(ep.time, "time", lambda: clock[0])
    c = _client(conn)
    _state(c, "?lock=snow")
    clock[0] += 240
    assert _state(c, "?lock=snow")["snowCover"] == pytest.approx(39.9, abs=0.1)   # 25 × 0,6^1,8 %/min × 4 min
    c.get("/s/t/api/fx/weather?cmd=shovel&name=Mia")
    c.get("/s/t/api/fx/weather?cmd=shake&name=Mod&force=1")
    cmds = c.get("/s/t/api/fx/weather/poll?since=0").json["commands"]
    assert cmds[0]["params"]["done"] == 5 and cmds[1]["params"]["success"] is True


def test_winter_commands_parse():
    assert commands.parse("weather", {"cmd": "gift", "name": "A"})["params"] == {"name": "A", "type": "sub", "amount": 1}
    assert commands.parse("weather", {"cmd": "xmasdone", "step": "setup"})["params"] == {"step": "setup"}
    assert commands.parse("weather", {"cmd": "set", "theme": "WINTER", "xmasfrom": "11-15", "xmasto": "01-06",
                                      "tree": "0"})["params"] == {
        "theme": "winter", "xmasfrom": "11-15", "xmasto": "01-06", "tree": False}
    assert commands.parse("weather", {"cmd": "set", "xmasfrom": "advent"})["params"] == {"xmasfrom": "advent"}


def test_follow_becomes_ornament_in_xmas_and_mini_otherwise(conn):
    c = _client(conn)
    _state(c, "?theme=winter")
    c.get("/s/t/api/fx/weather?cmd=follow&name=Lea")
    assert [m["name"] for m in c.get("/s/t/api/fx/weather/poll").json["state"]["minis"]] == ["Lea"]
    c.get("/s/t/api/fx/weather?cmd=setup")
    c.get("/s/t/api/fx/weather?cmd=follow&name=Ben")
    st = c.get("/s/t/api/fx/weather/poll").json["state"]
    assert [o["name"] for o in st["ornaments"]] == ["Lea", "Ben"]
    cmds = c.get("/s/t/api/fx/weather/poll?since=0").json["commands"]
    # jeder Follow geht als "follow" ans Overlay, das alle Jahreszeiten nachführt
    assert [x["cmd"] for x in cmds if x["params"].get("name") in ("Lea", "Ben")] == ["follow", "follow"]
    assert c.get("/s/t/api/fx/weather?cmd=follow&name=ben").json.get("duplicate")


# --- Herbst, Frühling, Sommer ---

def test_season_items_and_follow_per_theme(conn):
    c = _client(conn)
    _state(c, "?theme=autumn")
    c.get("/s/t/api/fx/weather?cmd=follow&name=Ann")
    _state(c, "?theme=spring")
    c.get("/s/t/api/fx/weather?cmd=follow&name=Bo")
    _state(c, "?theme=summer")
    c.get("/s/t/api/fx/weather?cmd=follow&name=Cy")
    st = c.get("/s/t/api/fx/weather/poll").json["state"]
    # jede Jahreszeit zeigt alle Follower in ihrer Gestalt
    for key in ("pumpkins", "flowers", "castles", "minis", "ornaments"):
        assert [x["name"] for x in st[key]] == ["Ann", "Bo", "Cy"]
    assert st["pumpkin_total"] == st["flower_total"] == 3


def test_season_actions_report_results_and_levels(conn, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(weather_state.time, "time", lambda: clock[0])
    import fx.endpoints as ep
    monkeypatch.setattr(ep.time, "time", lambda: clock[0])
    c = _client(conn)
    _state(c, "?theme=autumn&lock=clear")
    clock[0] += 600
    st = _state(c, "?theme=autumn&lock=clear")
    assert st["seasonLevels"]["leaves"] == 10
    c.get("/s/t/api/fx/weather?cmd=rake&name=Mia")
    cmd = c.get("/s/t/api/fx/weather/poll?since=0").json["commands"][-1]
    assert cmd["params"]["done"] == 5
    assert _state(c, "?theme=autumn&lock=clear")["seasonTop"]["autumn"] == [["Mia", 1]]


def test_season_commands_parse():
    for cmd in ("pumpkin", "rake", "jump", "flower", "water", "weed", "bee", "castle", "splash", "ice", "fries"):
        assert commands.parse("weather", {"cmd": cmd, "name": "X"})["params"] == {"name": "X"}
    for cmd in ("sweep", "cool", "seasonboard"):
        assert commands.parse("weather", {"cmd": cmd})["cmd"] == cmd
    assert commands.parse("weather", {"cmd": "clear", "kind": "castles"})["params"] == {"kind": "castles"}


def test_manual_setup_in_november_switches_auto_theme_to_winter(conn, monkeypatch):
    import datetime as _dt
    nov15 = _dt.datetime(2026, 11, 15, 18, 0).timestamp()
    monkeypatch.setattr(weather_state.time, "time", lambda: nov15)
    import fx.endpoints as ep

    class _D(_dt.date):
        @classmethod
        def today(cls):
            return _dt.date(2026, 11, 15)
    monkeypatch.setattr(ep.datetime, "date", _D)
    c = _client(conn)
    assert _state(c)["theme"] == "autumn"
    c.get("/s/t/api/fx/weather?cmd=setup")
    st = _state(c)
    assert st["theme"] == "winter" and st["xmas"] == "on"


def _november(monkeypatch):
    import datetime as _dt
    import fx.endpoints as ep
    nov15 = _dt.datetime(2026, 11, 15, 18, 0).timestamp()
    monkeypatch.setattr(weather_state.time, "time", lambda: nov15)

    class _D(_dt.date):
        @classmethod
        def today(cls):
            return _dt.date(2026, 11, 15)
    monkeypatch.setattr(ep.datetime, "date", _D)


def test_manual_setup_beats_fixed_autumn(conn, monkeypatch):
    _november(monkeypatch)
    c = _client(conn)
    assert _state(c, "?theme=autumn")["theme"] == "autumn"
    c.get("/s/t/api/fx/weather?cmd=setup")
    st = _state(c, "?theme=autumn")
    assert st["theme"] == "winter" and st["xmas"] == "on"
    c.get("/s/t/api/fx/weather?cmd=farewell")
    assert _state(c, "?theme=autumn")["theme"] == "autumn"


def test_start_next_season_early(conn, monkeypatch):
    _november(monkeypatch)
    c = _client(conn)
    assert commands.parse("weather", {"cmd": "season", "to": "NEXT"})["params"] == {"to": "next"}
    c.get("/s/t/api/fx/weather?cmd=season&to=next")
    assert _state(c)["theme"] == "winter"
    c.get("/s/t/api/fx/weather?cmd=season&to=auto")
    assert _state(c)["theme"] == "autumn"


def test_avalanche_leaves_snow(conn):
    c = _client(conn)
    before = _state(c, "?theme=winter")["snowCover"]
    c.get("/s/t/api/fx/weather?cmd=spectacle&type=avalanche")
    assert _state(c, "?theme=winter")["snowCover"] >= before + 19.5


SAO_PAULO = {"lat": -23.55, "lon": -46.63, "label": "São Paulo"}
BUENOS_AIRES = {"lat": -34.6, "lon": -58.38, "label": "Buenos Aires"}


def test_tropics_are_always_summer_and_christmas_is_on_the_beach(conn, monkeypatch):
    _november(monkeypatch)
    monkeypatch.setattr(weather_state, "geocode", lambda q: SAO_PAULO)
    c = _client(conn)
    assert _state(c, "?place=SP")["theme"] == "summer"
    c.get("/s/t/api/fx/weather?cmd=setup")
    st = _state(c, "?place=SP")
    assert st["theme"] == "summer" and st["xmas"] == "on"


def test_southern_hemisphere_seasons_and_remembered_zone(conn, monkeypatch):
    _november(monkeypatch)
    monkeypatch.setattr(weather_state, "geocode", lambda q: BUENOS_AIRES)
    c = _client(conn)
    assert _state(c, "?place=BA")["theme"] == "spring"            # Mitte November im Süden
    # cmd=season kennt den Ort nicht: nimmt die zuletzt ermittelte Zone
    c.get("/s/t/api/fx/weather?cmd=season&to=next")
    assert _state(c, "?place=BA")["theme"] == "summer"


def test_climate_overrides_latitude(conn, monkeypatch):
    _november(monkeypatch)
    monkeypatch.setattr(weather_state, "geocode", lambda q: BUENOS_AIRES)
    monkeypatch.setattr(weather_state, "climate", lambda lat, lon: [20] * 12)
    assert _state(_client(conn), "?place=BA")["theme"] == "summer"


def test_ignite_is_not_broadcast_and_extinguish_reports(conn):
    c = _client(conn)
    _state(c, "?theme=autumn")
    c.get("/s/t/api/fx/weather?cmd=ignite")
    assert c.get("/s/t/api/fx/weather/poll?since=0").json["commands"] == []
    c.get("/s/t/api/fx/weather?cmd=extinguish&name=Mia")
    cmds = c.get("/s/t/api/fx/weather/poll?since=0").json["commands"]
    assert cmds[-1]["cmd"] == "extinguish" and cmds[-1]["params"]["done"] == 1


def test_time_of_day_is_independent_of_weather(conn):
    # Tag ohne Ort; Night per Knopf bleibt, wenn danach Regen kommt
    c = _client(conn)
    assert _state(c)["night"] == 0
    c.get("/s/t/api/fx/weather?cmd=weather&to=night&hold=0")
    assert _state(c)["night"] == 1
    c.get("/s/t/api/fx/weather?cmd=weather&to=rain&hold=0")
    st = _state(c)
    assert st["night"] == 1 and st["rain"] > 0.5 and st["kind"] == "rain"
    # Dusk ersetzt nur die Tageszeit, das Wetter bleibt
    c.get("/s/t/api/fx/weather?cmd=weather&to=dusk&hold=0")
    st = _state(c)
    assert st["dusk"] == 1 and st["rain"] > 0.5
    # Auto setzt beides zurück
    c.get("/s/t/api/fx/weather?cmd=auto")
    st = _state(c)
    assert st["night"] == 0 and st["dusk"] == 0 and st["source"] != "override"
