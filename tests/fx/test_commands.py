import pytest
from flask import Flask, g

from fx import commands
from fx.endpoints import bp_fx


@pytest.fixture(autouse=True)
def _clean_store():
    commands.reset_store()
    yield
    commands.reset_store()


# --- Validierung ---

def test_parse_simple_commands():
    for cmd in ("strike", "gust", "stop", "start", "reset"):
        assert commands.parse("rain", {"cmd": cmd}) == {"cmd": cmd, "params": {}}


def test_parse_strike_with_distance():
    assert commands.parse("rain", {"cmd": "strike", "dist": "NEAR"}) == {
        "cmd": "strike", "params": {"dist": "near"}}
    assert commands.parse("rain", {"cmd": "strike", "dist": "far"})["params"] == {"dist": "far"}
    # unbekannte Entfernung: normaler Blitz mit Zufallsentfernung
    assert commands.parse("rain", {"cmd": "strike", "dist": "mars"})["params"] == {}


def test_parse_set_normalizes_values():
    out = commands.parse("rain", {"cmd": "set", "intensity": "STORM", "wind": "2",
                                  "lightning": "frequent", "color": "#9FC4FF",
                                  "splash": "0"})
    assert out == {"cmd": "set", "params": {
        "intensity": "storm", "wind": 1.0, "lightning": 2,
        "color": "9fc4ff", "splash": False}}


def test_parse_set_sound_levels_are_clamped():
    out = commands.parse("rain", {"cmd": "set", "sound": "off", "volume": "1.7",
                                  "thunder": "-1"})
    assert out["params"] == {"sound": False, "volume": 1.0, "thunder": 0.0}
    with pytest.raises(ValueError):
        commands.parse("rain", {"cmd": "set", "volume": "loud"})


def test_parse_set_wind_random_and_short_color():
    out = commands.parse("rain", {"cmd": "set", "wind": "random", "color": "abc"})
    assert out["params"] == {"wind": "random", "color": "aabbcc"}


def test_parse_set_ignores_invalid_values_but_needs_one_valid():
    out = commands.parse("rain", {"cmd": "set", "intensity": "monsoon", "wind": "-0.4"})
    assert out["params"] == {"wind": -0.4}
    with pytest.raises(ValueError):
        commands.parse("rain", {"cmd": "set", "intensity": "monsoon"})


def test_parse_rejects_unknown_command_and_effect():
    with pytest.raises(ValueError):
        commands.parse("rain", {"cmd": "explode"})
    with pytest.raises(ValueError):
        commands.parse("rain", {})
    with pytest.raises(KeyError):
        commands.parse("lava", {"cmd": "strike"})


# --- Store ---

def test_poll_without_since_returns_only_current_seq():
    commands.push(1, "rain", {"cmd": "strike", "params": {}})
    out = commands.poll(1, "rain", None)
    assert out["seq"] == 1
    assert out["commands"] == []


def test_poll_since_returns_newer_commands_in_order():
    commands.push(1, "rain", {"cmd": "strike", "params": {}})
    commands.push(1, "rain", {"cmd": "gust", "params": {}})
    commands.push(1, "rain", {"cmd": "stop", "params": {}})
    out = commands.poll(1, "rain", 1)
    assert [c["cmd"] for c in out["commands"]] == ["gust", "stop"]
    assert [c["seq"] for c in out["commands"]] == [2, 3]
    assert out["seq"] == 3


def test_store_is_isolated_per_tenant_and_effect():
    commands.push(1, "rain", {"cmd": "strike", "params": {}})
    assert commands.poll(2, "rain", 0)["commands"] == []
    assert commands.poll(2, "rain", 0)["seq"] == 0


def test_store_keeps_only_recent_commands():
    for _ in range(commands.MAX_KEEP + 5):
        commands.push(1, "rain", {"cmd": "strike", "params": {}})
    out = commands.poll(1, "rain", 0)
    assert len(out["commands"]) == commands.MAX_KEEP


# --- Endpoint ---

def _app(tenant_id=7):
    app = Flask(__name__)
    app.register_blueprint(bp_fx)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app


def test_endpoint_push_then_poll():
    c = _app().test_client()
    r = c.get("/s/tok/api/fx/rain?cmd=set&intensity=heavy&wind=random")
    assert r.status_code == 200
    assert r.get_json() == {"ok": True, "seq": 1}
    assert "no-store" in r.headers["Cache-Control"]

    r = c.get("/s/tok/api/fx/rain/poll?since=0")
    body = r.get_json()
    assert body["seq"] == 1
    assert body["epoch"] == commands.EPOCH
    assert body["commands"][0]["cmd"] == "set"
    assert body["commands"][0]["params"] == {"intensity": "heavy", "wind": "random"}


def test_endpoint_accepts_post():
    r = _app().test_client().post("/s/tok/api/fx/rain", json={"cmd": "strike"})
    assert r.status_code == 200
    assert r.get_json()["seq"] == 1


def test_endpoint_errors():
    c = _app().test_client()
    assert c.get("/s/tok/api/fx/rain?cmd=explode").status_code == 400
    assert c.get("/s/tok/api/fx/lava?cmd=strike").status_code == 404
    assert _app(None).test_client().get("/s/tok/api/fx/rain?cmd=strike").status_code == 404


# --- xmas ---

def test_xmas_set_normalizes_values():
    out = commands.parse("xmas", {"cmd": "set", "lights": "FRAME", "pattern": "chase",
                                  "colors": "theme", "lightsy": "999", "sag": "40",
                                  "baubles": "left", "blen": "3", "bsize": "0.8",
                                  "tree": "0", "treepos": "left", "treex": "460",
                                  "tsize": "1.2", "treesnow": "1", "snow": "off"})
    assert out["params"] == {
        "lights": "frame", "pattern": "chase", "colors": "theme", "lightsy": 400,
        "sag": 40, "baubles": "left", "blen": 2.0, "bsize": 0.8, "tree": False,
        "treepos": "left", "treex": 460, "tsize": 1.2, "treesnow": True, "snow": False}


def test_xmas_ornament_name_is_sanitized():
    out = commands.parse("xmas", {"cmd": "ornament", "name": "  <b>Kekskrümel</b>_99 extra lang name  "})
    assert out == {"cmd": "ornament", "params": {"name": "bKekskrümelb_99 extr"}}
    assert commands.parse("xmas", {"cmd": "ornament"})["params"] == {}


def test_xmas_simple_commands():
    for cmd in ("celebrate", "clear", "reset"):
        assert commands.parse("xmas", {"cmd": cmd}) == {"cmd": cmd, "params": {}}


def test_xmas_ornaments_are_kept_as_state():
    commands.push(1, "xmas", commands.parse("xmas", {"cmd": "ornament", "name": "Hat3"}))
    commands.push(1, "xmas", commands.parse("xmas", {"cmd": "ornament"}))
    commands.push(1, "xmas", commands.parse("xmas", {"cmd": "celebrate"}))
    state = commands.poll(1, "xmas", None)["state"]
    assert state == {"ornaments": ["Hat3", ""]}
    for i in range(commands.MAX_ORNAMENTS + 3):
        commands.push(1, "xmas", {"cmd": "ornament", "params": {"name": str(i)}})
    orn = commands.poll(1, "xmas", None)["state"]["ornaments"]
    assert len(orn) == commands.MAX_ORNAMENTS
    assert orn[-1] == str(commands.MAX_ORNAMENTS + 2)
    commands.push(1, "xmas", {"cmd": "clear", "params": {}})
    assert commands.poll(1, "xmas", None)["state"] == {"ornaments": []}
    # andere Tenants und Effekte sehen davon nichts
    assert commands.poll(2, "xmas", None)["state"] == {}
    assert commands.poll(1, "rain", None)["state"] == {}
