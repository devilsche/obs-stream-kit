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
    for key in ("xmas", "autumn", "winter", "spring", "summer", "rain"):
        e = effects[key]
        assert e["controls"] and e["live"]
        for k in e["live"]:
            assert k in commands.EFFECTS[key]["settings"]
        # jeder Schalter lässt sich live setzen
        assert e["live"] == [sw["key"] for sw in e["switches"]]


def test_non_effect_sources_have_no_live_keys():
    assert all(not s["live"] for s in list_dir_sources(".", "stingers"))
