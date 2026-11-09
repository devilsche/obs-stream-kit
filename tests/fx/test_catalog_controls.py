"""Dashboard-Knöpfe und Live-Schalter der Effects passen zu fx/commands.py."""
from urllib.parse import parse_qsl

from fx import commands
from overlay_app.overlay_catalog import EFFECT_META, list_dir_sources


def test_every_control_is_a_valid_command_without_placeholders():
    for fn, meta in EFFECT_META.items():
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
        "cmd=auto", "cmd=weather&to=night", "cmd=weather&to=clear", "cmd=weather&to=rain",
        "cmd=weather&to=storm", "cmd=weather&to=snow",
        "cmd=weather&to=blizzard", "cmd=weather&to=fog",
        "cmd=strike", "cmd=gust",
        "cmd=spectacle&type=tsunami", "cmd=spectacle&type=megabolt",
        "cmd=spectacle&type=ballbolt", "cmd=spectacle&type=avalanche",
        "cmd=spectacle&type=aurora", "cmd=spectacle&type=rainbow", "cmd=spectacle&type=hail",
        "cmd=spectacle&type=meteors", "cmd=spectacle&type=tornado", "cmd=spectacle&type=fogwall",
        "cmd=scrape", "cmd=warm", "cmd=frostclear", "cmd=leaders",
        "cmd=setup", "cmd=farewell", "cmd=celebrate", "cmd=shovel", "cmd=shake&force=1",
        "cmd=icicle", "cmd=snowball", "cmd=snowboard",
        "cmd=rake", "cmd=jump", "cmd=sweep", "cmd=water", "cmd=weed&force=1", "cmd=bee",
        "cmd=splash", "cmd=ice", "cmd=cool", "cmd=celebrate", "cmd=seasonboard"]
    assert {"mood", "kdlow", "kdhigh", "kdtest", "fallback", "lock", "veil"} <= set(src["live"])
    for c in src["commands"]:
        commands.parse("weather", dict(parse_qsl(c["q"])))


def test_rain_and_snow_are_hidden():
    keys = {s["key"] for s in list_dir_sources(".", "effects", switches_map=EFFECT_META)}
    assert "rain" not in keys and "snow" not in keys and "weather" in keys
