import random

from fx import commands, weather_chat as wc


def test_points_bits_and_money():
    assert wc.points("bits", "500") == 500
    assert wc.points("money", "2,50") == 250
    assert wc.points("money", "x") == 0
    assert wc.points("raid", 30) == 0


def test_paid_command_in_message_with_enough_bits():
    r = wc.paid("bits", 250, "cheer250 !Tornado los!", "Tim")
    assert r["command"] == {"cmd": "spectacle", "params": {"type": "tornado"}}
    assert r["say"] == "Danke Tim! Du hast einen Tornado bestellt."


def test_paid_command_too_cheap_says_price():
    r = wc.paid("bits", 100, "!megabolt bitte", "Tim")
    assert r["command"] is None
    assert "250 Bits oder 2,50 €" in r["say"]


def test_paid_without_command_picks_highest_tier():
    r = wc.paid("bits", 150, "cheer150 gg", "Tim", rnd=random.Random(1))
    assert wc.OFFERS[r["offer"]][1] == "small"
    r = wc.paid("bits", 250, "", "Tim", rnd=random.Random(1))
    assert wc.OFFERS[r["offer"]][1] == "big"


def test_paid_apocalypse_needs_500_bits_or_5_euro():
    r = wc.paid("bits", 500, "cheer500 !apocalypse", "Tim")
    assert r["command"] == {"cmd": "spectacle", "params": {"type": "apocalypse"}}
    assert r["say"] == "Danke Tim! Du hast die Apokalypse bestellt."
    r = wc.paid("bits", 499, "!apocalypse", "Tim")
    assert r["command"] is None
    assert "500 Bits oder 5 €" in r["say"]


def test_paid_without_command_reaches_apocalypse_tier():
    r = wc.paid("bits", 500, "", "Tim", rnd=random.Random(1))
    assert r["offer"] == "apocalypse"
    r = wc.paid("bits", 499, "", "Tim", rnd=random.Random(1))
    assert wc.OFFERS[r["offer"]][1] == "big"


def test_price_text_shows_cents():
    assert wc.price_text("weather") == "50 Bits oder 0,50 €"
    assert wc.price_text("small") == "100 Bits oder 1 €"
    assert wc.price_text("big") == "250 Bits oder 2,50 €"


def test_paid_weather_from_50_bits():
    r = wc.paid("bits", 50, "cheer50 !rain", "Tim")
    assert r["command"] is not None


def test_paid_too_little_without_command_stays_quiet():
    assert wc.paid("bits", 49, "cheer49", "Tim") == {"command": None, "offer": None, "say": ""}


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
    assert s == "Wetter im Stream: Regen, 8 °C. Im Stream ist Herbst, der Laubhaufen liegt 40 % hoch."


def test_top_and_tip():
    assert wc.top_say("autumn", [["Tim", 12]]).startswith("Top-Laubrecher: Tim mit 12×")
    assert wc.top_say("autumn", []) == ""
    assert "!" in wc.tip_say("summer", rnd=random.Random(0))


def test_weather_say_live_from_place_and_override():
    st = {"kind": "rain", "temp": 3.2, "theme": "autumn", "seasonLevels": {"leaves": 15}, "source": "api"}
    assert wc.weather_say(st, "Berlin, Land Berlin, DE") == "Live aus Berlin: Regen, 3 °C. Im Stream ist Herbst, der Laubhaufen liegt 15 % hoch."
    st["source"], st["kind"] = "override", "storm"
    assert wc.weather_say(st, "Berlin") == "Live aus Berlin: 3 °C. Im Bild gerade: Gewitter (vom Chat bestellt). Im Stream ist Herbst, der Laubhaufen liegt 15 % hoch."


def test_weather_say_skips_empty_level():
    assert wc.weather_say({"kind": "cloudy", "temp": 3, "theme": "winter", "snowCover": 0, "source": "api"}, "Berlin") == "Live aus Berlin: bewölkt, 3 °C. Im Stream ist Winter."


def test_commands_only_for_current_season():
    summer = {wc.commands_say("summer") for _ in range(2)}
    assert len(summer) == 2
    assert all("!splash" in t and "!rake" not in t and t.endswith("Bestenliste: !board.") for t in summer)
    w = wc.commands_say("winter", frost=20)
    assert "!shovel" in w and "!scrape" in w and w.endswith("!snowboard und !frostboard.")
    assert all(len(wc.commands_say(t, 30)) < 500 for t in wc.SEASON_SAY for _ in range(2))


def test_weather_say_names_xmas_and_snow():
    st = {"kind": "clear", "temp": 2, "theme": "winter", "xmas": "on", "snowCover": 22.4, "source": "api"}
    assert wc.weather_say(st, "Berlin") == "Live aus Berlin: klar, 2 °C. Im Stream ist Weihnachtszeit, die Schneedecke liegt 22 % hoch."


def test_weather_say_names_who_ordered_and_time_of_day():
    st = {"kind": "rain", "temp": 3, "source": "override", "theme": "autumn"}
    orders = {"weather": {"kind": "rain", "by": "Tim", "until": 1000 + 130},
              "tod": {"kind": "night", "by": "", "until": 1000 + 50}}
    assert wc.weather_say(st, "Berlin", orders, 1000) == ("Live aus Berlin: 3 °C. Im Bild gerade: Regen (bestellt von Tim, noch 2 min). "
                                                          "Tageszeit: Nacht (vom Chat bestellt, noch 1 min). Im Stream ist Herbst.")
    # nur Tageszeit bestellt: Wetter bleibt live
    st = {"kind": "cloudy", "temp": 3, "source": "override", "theme": "autumn"}
    assert wc.weather_say(st, "Berlin", {"tod": {"kind": "day", "by": "Ann", "until": None}}, 1000).startswith(
        "Live aus Berlin: bewölkt, 3 °C. Tageszeit: Tag (bestellt von Ann).")


def test_weather_say_fixed_weather_is_not_live():
    st = {"kind": "snow", "temp": None, "source": "lock", "theme": "winter"}
    assert wc.weather_say(st, "Berlin") == "Wetter im Stream: Schnee (fest eingestellt). Im Stream ist Winter."


def test_whereami_say_texts():
    assert wc.whereami_say("Tim", None) == "@Tim Hier stehen die Follower des Kanals, dich gibt es noch nicht."
    assert wc.whereami_say("Tim", 3) == ""
    assert wc.whereami_say("Tim", 15) == ("@Tim Du bist gerade nicht im Bild, dort stehen immer die neuesten 12 Follower. "
                                          "Für einen kurzen Besuch kommst du aber vorbei.")
    assert wc.whereami_say("Tim", 15, shown=30) == ""
    assert wc.whereami_say("LuCKoR_HD", None, host=True) == "@LuCKoR_HD Du bist der Gastgeber, dir gehört die ganze Deko."


def test_visible_count_with_tree():
    assert wc.visible_count("off") == 12
    assert wc.visible_count("on") == 30 and wc.visible_count("farewell") == 30


# ── Freigaben ──

def test_reach_say_lists_two_biggest_options():
    assert wc.reach_say(250) == "1 großes Spektakel oder 2 kleine Spektakel"
    assert wc.reach_say(100) == "1 kleines Spektakel oder 2× Wetter"
    assert wc.reach_say(500) == "die Apokalypse oder 2 große Spektakel"
    assert wc.reach_say(50) == "1× Wetter"
    assert wc.reach_say(20) == "noch nichts"


def test_donation_with_mention_grants_amount_to_that_user():
    r = wc.donation("2,50", "für @User123 !tornado", "Oma")
    assert r == {"to": "User123", "pts": 250, "offer": "tornado"}
    assert wc.donation("3", "gg", "Oma") == {"to": None, "pts": 300, "offer": None}
    # unter 1 € gibt es nur ein Dankeschön
    assert wc.donation("0,99", "@User123", "Oma")["to"] is None


def test_redeem_says():
    assert wc.wanted("hallo !Tornado jetzt") == "tornado"
    assert wc.wanted("!foo") is None
    assert wc.redeem_say("Tim", "tornado", 0) == "Tim schickt einen Tornado (Freigabe aufgebraucht)."
    assert wc.redeem_say("Tim", "rain", 50) == "Tim schickt Regen (Rest reicht für 1× Wetter)."
    assert wc.no_credit_say("Tim", "tornado", 0) == "@Tim !tornado gibt es mit cheer250 !tornado oder per Freigabe."
    assert wc.no_credit_say("Tim", "tornado", 100) == "@Tim dein Guthaben (100) reicht nicht für !tornado, das braucht 250."
