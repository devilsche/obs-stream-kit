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
    assert r["say"] == "Danke dir, Tim! Gleich gibt es einen Tornado."


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
    assert wc.project_say("autumn", 5, "Tim") == "Danke dir, Tim! Die Vogelscheuche wächst: 5 von 8 Teilen."
    assert wc.project_say("winter", 7) == "Der Schneemann wächst: 7 von 8 Teilen."
    assert wc.project_say("summer", 8, "Tim", completed=True) == "Danke dir, Tim! Der Sandpalast ist fertig, danke an alle, die mitgebaut haben!"


def test_weather_say_with_level():
    s = wc.weather_say({"kind": "rain", "temp": 7.6, "theme": "autumn", "seasonLevels": {"leaves": 40.4}})
    assert s == "Wetter gerade: Regen, 8 °C, der Laubhaufen liegt 40 % hoch."


def test_top_and_tip():
    assert wc.top_say("autumn", [["Tim", 12]]) == "Top-Laubrecher bisher: Tim (12×)."
    assert wc.top_say("autumn", []) == ""
    assert "!" in wc.tip_say("summer", rnd=random.Random(0))
