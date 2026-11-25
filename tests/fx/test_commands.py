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

def test_frame_emotes_only_cors_hosts_and_capped():
    tw = "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0"
    sv = "https://cdn.7tv.app/emote/01F6MQ33FG000FFJ97ZB8MWV52/4x.webp"
    bt = "https://cdn.betterttv.net/emote/5e4e7a1f08b4447d56a92967/3x"
    c = commands.parse("frame", {"cmd": "emotes", "urls": " ".join([tw, sv, bt, "javascript:alert(1)", tw])})
    assert c["params"]["urls"] == [tw, sv]          # BTTV ohne CORS, Unsinn und Doppelte raus
    many = ",".join("https://static-cdn.jtvnw.net/emoticons/v2/%d/default/dark/3.0" % i for i in range(9))
    assert len(commands.parse("frame", {"cmd": "emotes", "urls": many})["params"]["urls"]) == 5
    ids = commands.parse("frame", {"cmd": "emotes", "ids": "25,emotesv2_" + "a" * 32 + ",../x"})
    assert ids["params"]["ids"] == ["https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0",
                                    "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_" + "a" * 32 + "/default/dark/3.0"]
    assert commands.parse("frame", {"cmd": "shake"}) == {"cmd": "shake", "params": {}}


def test_frame_emoji_from_windows_picker():
    c = commands.parse("frame", {"cmd": "emotes", "emoji": "hi 😂👍🏽 ❤️ 👨‍👩‍👧 🇩🇪 abc 123"})
    assert c["params"]["emoji"] == ["😂", "👍🏽", "❤️", "👨‍👩‍👧", "🇩🇪"]
    assert len(commands.parse("frame", {"cmd": "emotes", "emoji": "😀" * 9})["params"]["emoji"]) == 5
    assert "emoji" not in commands.parse("frame", {"cmd": "emotes", "emoji": "nur text"})["params"]


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
    assert commands.parse("xmas", {"cmd": "clear", "kind": "gifts"})["params"] == {"kind": "gifts"}


def test_xmas_gift_defaults_and_limits():
    assert commands.parse("xmas", {"cmd": "gift", "name": "Mia"})["params"] == {
        "name": "Mia", "type": "sub", "amount": 1}
    out = commands.parse("xmas", {"cmd": "gift", "name": "Bob", "type": "BITS", "amount": "999999"})
    assert out["params"] == {"name": "Bob", "type": "bits", "amount": 100000}
    assert commands.parse("xmas", {"cmd": "gift", "type": "laser"})["params"] == {
        "type": "sub", "amount": 1}


def test_xmas_snow_commands():
    assert commands.parse("xmas", {"cmd": "snowfall"}) == {"cmd": "snowfall", "params": {}}
    assert commands.parse("xmas", {"cmd": "snowfall", "secs": "90"})["params"] == {"secs": 90}
    assert commands.parse("xmas", {"cmd": "shovel", "name": "Hat3"})["params"] == {"name": "Hat3"}
    assert commands.parse("xmas", {"cmd": "shake", "name": "Mia"})["params"] == {"name": "Mia"}
    for cmd in ("snowstop", "snowtoggle", "melt", "leaders"):
        assert commands.parse("xmas", {"cmd": cmd}) == {"cmd": cmd, "params": {}}
    assert commands.parse("xmas", {"cmd": "clear", "kind": "snow"})["params"] == {"kind": "snow"}
    out = commands.parse("xmas", {"cmd": "set", "snowrate": "999", "shovel": "0",
                                  "shakeneed": "3", "shakewin": "30"})
    assert out["params"] == {"snowrate": 300, "shovel": 1, "shakeneed": 3, "shakewin": 30}


def test_poll_commands_carry_server_time():
    commands.push(1, "xmas", {"cmd": "shake", "params": {}})
    c = commands.poll(1, "xmas", 0)["commands"][0]
    assert isinstance(c["ts"], float) and c["ts"] > 1.7e9


def test_burst_fire_args():
    out = commands.parse("burst", {"cmd": "fire", "kind": "Comic", "at": "0.25,1.7", "size": "9", "count": "40", "name": "Hat3 <b>"})
    assert out == {"cmd": "fire", "params": {"kind": "comic", "at": "0.250,1.000", "size": 3.0, "count": 12, "name": "Hat3 b"}}
    assert commands.parse("burst", {"cmd": "fire", "kind": "nuke", "at": "x"}) == {"cmd": "fire", "params": {}}
    assert commands.parse("burst", {"cmd": "fire", "at": "TopLeft"})["params"] == {"at": "topleft"}


def test_swirl_play_args():
    out = commands.parse("swirl", {"cmd": "play", "preset": "Follow", "duration": "99"})
    assert out == {"cmd": "play", "params": {"preset": "follow", "duration": 15.0}}
    assert commands.parse("swirl", {"cmd": "play", "preset": "raid", "duration": "x"}) == {"cmd": "play", "params": {}}


def test_alert_args_text_and_numbers():
    out = commands.parse("alert", {"cmd": "donation", "username": "Hat3 <script>", "amount": "5,00 €",
                                   "message": "danke\x07  dir", "viewers": "x"})
    assert out == {"cmd": "donation", "params": {"username": "Hat3 script", "amount": "5,00 €", "message": "danke dir"}}
    assert commands.parse("alert", {"cmd": "raid", "viewers": "42"})["params"] == {"viewers": 42}


def test_friend_commands():
    assert commands.parse("friend", {"cmd": "react", "event": "Raid"}) == {"cmd": "react", "params": {"event": "raid"}}
    assert commands.parse("friend", {"cmd": "act", "action": "sit", "face": "30"}) == {"cmd": "act", "params": {"action": "sit", "face": 12.0}}
    assert commands.parse("friend", {"cmd": "act", "action": "fly"}) == {"cmd": "act", "params": {}}


def test_weather_power_command():
    assert commands.parse("weather", {"cmd": "power", "state": "off"}) == {"cmd": "power", "params": {"state": "off"}}
    assert commands.parse("weather", {"cmd": "power", "state": "toggle"})["params"]["state"] == "toggle"
    assert commands.parse("weather", {"cmd": "power", "state": "kaputt"})["params"] == {}


def test_spectacle_side_choice():
    assert commands.parse("weather", {"cmd": "spectacle", "type": "tsunami", "side": "left"})["params"] == {"type": "tsunami", "side": "left"}
    assert "side" not in commands.parse("weather", {"cmd": "spectacle", "type": "tsunami", "side": "oben"})["params"]


def test_friend_fire_reaction_with_position():
    c = commands.parse("friend", {"cmd": "react", "event": "fire", "x": "1400"})
    assert c["params"] == {"event": "fire", "x": 1400}
