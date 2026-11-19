"""Dashboard-Knöpfe und Live-Schalter der Effects passen zu fx/commands.py."""
from urllib.parse import parse_qsl

from fx import commands
from overlay_app.overlay_catalog import EFFECT_META, list_dir_sources


def test_every_control_is_a_valid_command_without_placeholders():
    for fn, meta in EFFECT_META.items():
        if fn == "car-race.html":   # eigener Endpoint, siehe test_car_race_…
            continue
        for c in meta.get("controls", []):
            assert "%" not in c["q"], c
            assert c["icon"] and c["label"]
            commands.parse(fn[:-5], dict(parse_qsl(c["q"])))


def test_live_keys_are_settable_switches():
    effects = {e["key"]: e for e in list_dir_sources(".", "effects", switches_map=EFFECT_META)}
    for key in ("xmas", "autumn", "winter", "spring", "summer", "weather"):
        e = effects[key]
        assert e["controls"] and e["live"]
        for k in e["live"]:
            assert k in commands.EFFECTS[key]["settings"]
        # jeder Schalter lässt sich live setzen
        assert e["live"] == [sw["key"] for sw in e["switches"]]


def test_non_effect_sources_have_no_live_keys():
    assert all(not s["live"] for s in list_dir_sources(".", "stingers"))


def test_weather_has_controls_and_live_keys():
    src = {e["key"]: e for e in list_dir_sources(".", "effects", switches_map=EFFECT_META)}["weather"]
    assert [c["q"] for c in src["controls"]] == [
        "cmd=auto", "cmd=weather&to=clear", "cmd=weather&to=rain",
        "cmd=weather&to=storm", "cmd=weather&to=snow",
        "cmd=weather&to=blizzard", "cmd=weather&to=fog",
        "cmd=weather&to=cloudy", "cmd=weather&to=drizzle", "cmd=weather&to=sleet", "cmd=weather&to=heat",
        "cmd=weather&to=day", "cmd=weather&to=dawn", "cmd=weather&to=dusk", "cmd=weather&to=night",
        "cmd=season&to=winter", "cmd=season&to=spring", "cmd=season&to=summer", "cmd=season&to=autumn",
        "cmd=season&to=next", "cmd=season&to=auto",
        "cmd=strike", "cmd=gust",
        "cmd=spectacle&type=tsunami", "cmd=spectacle&type=megabolt",
        "cmd=spectacle&type=ballbolt", "cmd=spectacle&type=avalanche",
        "cmd=spectacle&type=aurora", "cmd=spectacle&type=rainbow", "cmd=spectacle&type=hail",
        "cmd=spectacle&type=meteors", "cmd=spectacle&type=tornado", "cmd=spectacle&type=fogwall",
        "cmd=spectacle&type=apocalypse", "cmd=spectacle",
        "cmd=scrape", "cmd=warm", "cmd=frostclear", "cmd=leaders", "cmd=frostreset",
        "cmd=setup", "cmd=farewell", "cmd=build", "cmd=snowmanreset", "cmd=celebrate", "cmd=shovel", "cmd=shake&force=1",
        "cmd=icicle", "cmd=snowball", "cmd=snowboard",
        "cmd=rake", "cmd=jump", "cmd=extinguish", "cmd=sweep", "cmd=leafstorm", "cmd=water", "cmd=sprinkler", "cmd=weed&force=1", "cmd=bee",
        "cmd=splash", "cmd=ice", "cmd=fries", "cmd=cool", "cmd=celebrate", "cmd=seasonboard"]
    assert {"mood", "kdlow", "kdhigh", "kdtest", "fallback", "lock", "veil"} <= set(src["live"])
    for c in src["commands"]:
        commands.parse("weather", dict(parse_qsl(c["q"])))


def test_rain_and_snow_are_hidden():
    keys = {s["key"] for s in list_dir_sources(".", "effects", switches_map=EFFECT_META)}
    assert "rain" not in keys and "snow" not in keys and "weather" in keys


def test_car_race_has_chat_commands_and_dashboard_controls():
    """Car Race: Streamer.bot-Befehle und Dashboard-Knöpfe gehen an /api/fx/car-race (eigener Endpoint)."""
    from fx.endpoints import RACE_ADMIN
    meta = EFFECT_META["car-race.html"]
    cmds = [dict(parse_qsl(c["q"])) for c in meta["commands"]]
    join = [c for c in cmds if c.get("cmd") == "join"]
    assert join and {"id", "user", "color"} <= set(join[0])
    assert {"month", "all"} <= {c.get("scope") for c in cmds if c.get("cmd") == "board"}
    ctl = [dict(parse_qsl(c["q"])) for c in meta["controls"]]
    assert {"start", "cancel", "void"} <= {c["cmd"] for c in ctl}
    assert {"cmd": "join", "test": "1"} in ctl
    valid = {"join", "board"} | set(RACE_ADMIN)
    for c in meta["controls"] + meta["commands"]:
        assert dict(parse_qsl(c["q"]))["cmd"] in valid, c
    for c in meta["controls"]:
        assert "%" not in c["q"] and c["icon"] and c["label"]
    # Dashboard-Vorschau startet die lokale Testlobby
    assert meta.get("preview_query") == "preview=1"
