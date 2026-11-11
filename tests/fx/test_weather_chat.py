import random

from fx import commands, weather_chat as wc


def test_points_bits_and_money():
    assert wc.points("bits", "500") == 500
    assert wc.points("money", "2,50") == 250
    assert wc.points("money", "x") == 0
    assert wc.points("raid", 30) == 0


def test_paid_command_in_message_with_enough_bits():
    r = wc.paid("bits", 500, "cheer500 !Tornado los!", "Tim")
    assert r["command"] == {"cmd": "spectacle", "params": {"type": "tornado"}}
    assert r["say"] == "Danke Tim! Du hast einen Tornado bestellt."


def test_paid_command_too_cheap_says_price():
    r = wc.paid("money", "1", "!megabolt bitte", "Tim")
    assert r["command"] is None
    assert "500 Bits oder 5 €" in r["say"]


def test_paid_without_command_picks_highest_tier():
    r = wc.paid("bits", 250, "cheer250 gg", "Tim", rnd=random.Random(1))
    assert wc.OFFERS[r["offer"]][1] == "small"
    r = wc.paid("money", "5", "", "Tim", rnd=random.Random(1))
    assert wc.OFFERS[r["offer"]][1] == "big"


def test_paid_too_little_without_command_stays_quiet():
    assert wc.paid("bits", 50, "cheer50", "Tim") == {"command": None, "offer": None, "say": ""}


def test_every_offer_is_a_valid_weather_command():
    for command, _, _ in wc.OFFERS.values():
        args = {"cmd": command["cmd"], **command["params"]}
        assert commands.parse("weather", args)["cmd"] == command["cmd"]


def test_raid_thresholds():
    assert wc.raid(5, "X")["command"] is None
    assert wc.raid(20, "X", rnd=random.Random(2))["offer"] in wc.RAID_FRIENDLY
    assert wc.raid(80, "X")["offer"] == "megabolt"


def test_project_say():
    assert wc.project_say("autumn", 5, "Tim") == "Danke Tim! Noch 3 Subs bis zur fertigen Vogelscheuche."
    assert wc.project_say("winter", 7) == "Noch 1 Sub bis zum fertigen Schneemann."
    assert wc.project_say("summer", 8, "Tim", completed=True) == "Danke Tim! Der Sandpalast ist fertig! Danke an alle Subs!"


def test_weather_say_with_level():
    s = wc.weather_say({"kind": "rain", "temp": 7.6, "theme": "autumn", "seasonLevels": {"leaves": 40.4}})
    assert s == "Wetter gerade: Regen, 8 °C. Im Stream ist Herbst, der Laubhaufen liegt 40 % hoch."


def test_top_and_tip():
    assert wc.top_say("autumn", [["Tim", 12]]).startswith("Top-Laubrecher: Tim mit 12×")
    assert wc.top_say("autumn", []) == ""
    assert "!" in wc.tip_say("summer", rnd=random.Random(0))


def test_weather_say_live_from_place_and_override():
    st = {"kind": "rain", "temp": 3.2, "theme": "autumn", "seasonLevels": {"leaves": 15}}
    assert wc.weather_say(st, "Berlin, Land Berlin, DE") == "Live aus Berlin: Regen, 3 °C. Im Stream ist Herbst, der Laubhaufen liegt 15 % hoch."
    st["source"], st["kind"] = "override", "storm"
    assert wc.weather_say(st, "Berlin") == "Live aus Berlin: 3 °C. Im Bild gerade: Gewitter (vom Chat bestellt). Im Stream ist Herbst, der Laubhaufen liegt 15 % hoch."


def test_weather_say_skips_empty_level():
    assert wc.weather_say({"kind": "cloudy", "temp": 3, "theme": "winter", "snowCover": 0}, "Berlin") == "Live aus Berlin: bewölkt, 3 °C. Im Stream ist Winter."


def test_commands_only_for_current_season():
    summer = {wc.commands_say("summer") for _ in range(2)}
    assert len(summer) == 2
    assert all("!splash" in t and "!rake" not in t and t.endswith("Bestenliste: !board.") for t in summer)
    w = wc.commands_say("winter", frost=20)
    assert "!shovel" in w and "!scrape" in w and w.endswith("!snowboard und !frostboard.")
    assert all(len(wc.commands_say(t, 30)) < 500 for t in wc.SEASON_SAY for _ in range(2))


def test_weather_say_names_xmas_and_snow():
    st = {"kind": "clear", "temp": 2, "theme": "winter", "xmas": "on", "snowCover": 22.4}
    assert wc.weather_say(st, "Berlin") == "Live aus Berlin: klar, 2 °C. Im Stream ist Weihnachtszeit, die Schneedecke liegt 22 % hoch."
