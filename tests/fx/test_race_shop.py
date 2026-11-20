"""Car Race Garage: Klassen, Preise, Coins-Regeln, Autosuche (fx/race_shop.py)."""
import re
from pathlib import Path

from fx import race_shop

ROOT = Path(__file__).resolve().parents[2]


def _table_keys():
    src = (ROOT / "js" / "car-race-stats.js").read_text(encoding="utf-8")
    block = src[src.index("var ROWS = {"):src.index("};", src.index("var ROWS = {"))]
    return re.findall(r"'([a-z0-9-]+)':", block)


def test_every_table_car_has_an_explicit_class():
    keys = _table_keys()
    assert len(keys) > 60
    missing = [k for k in keys if k not in race_shop.CLASS_OF_KEY]
    assert missing == []
    # keine Doppel-Zuordnung
    total = sum(len(v) for v in race_shop._KEYS.values())
    assert total == len(race_shop.CLASS_OF_KEY)


def test_prices_follow_the_spec():
    assert race_shop.PRICES == {"small": 150, "sedan": 400, "sport": 900, "super": 2000, "race": 3500,
                                "f1": 6000, "fun": 250}
    assert race_shop.price("amg-w14-s1") == 6000
    assert race_shop.price("ferrari-296-gt3-verstappen") == 3500
    assert race_shop.price("2024-porsche-992-gt3-r") == 3500
    assert race_shop.price("audi-a4-r9-dtm-a") == 3500
    assert race_shop.price("porsche-917k-lm-red") == 3500
    assert race_shop.price("2022-lamborghini-countach-lp") == 2000
    assert race_shop.price("porsche-918-free") == 2000
    assert race_shop.price("2015-porsche-911-carrera-s") == 900
    assert race_shop.price("bmw-m3-competition") == 900
    assert race_shop.price("2020-audi-rs-6-avant") == 900
    assert race_shop.price("audi-a4-b8") == 400
    assert race_shop.price("bmw-e39-free") == 400
    assert race_shop.price("1990-bmw-m3-sport-evolution") == 400
    assert race_shop.price("bmw-m2-competition-f87") == 900
    assert race_shop.price("volkswagen-golf-gti-1976") == 150
    assert race_shop.price("1984-mercedes-190e") == 150
    for k in ("trolza-5265-00-megapolis", "ural-4320-soviet-army-truck", "caterpillar-ct680", "krabby-patty-wagon"):
        assert race_shop.price(k) == 250


def test_unknown_keys_fall_back_by_name():
    c = race_shop.class_of
    assert c("x1", {"name": "Lamborghini Huracan", "brand": "Lamborghini"}) == "super"
    assert c("x2", {"name": "MAN TGX truck", "brand": "MAN"}) == "fun"
    assert c("x3", {"name": "Mercedes W13 F1", "brand": "Mercedes-Benz"}) == "f1"
    assert c("x4", {"name": "Porsche 911 GT3 R 2019", "brand": "Porsche"}) == "race"
    assert c("x5", {"name": "BMW M4", "brand": "BMW"}) == "sport"
    assert c("x6", {"name": "VW Polo", "brand": "Volkswagen"}) == "small"
    assert c("x7", {"name": "Skoda Octavia", "brand": "Skoda"}) == "sedan"


def test_coins_with_places_finish_and_sub_multiplier():
    assert race_shop.coins(None) == 10
    assert race_shop.coins(1) == 45
    assert race_shop.coins(2) == 35
    assert race_shop.coins(3) == 25
    assert race_shop.coins(4) == 15
    assert race_shop.coins(1, 1000) == 56      # 45 × 1,25 = 56,25
    assert race_shop.coins(4, 1000) == 19      # 15 × 1,25 = 18,75
    assert race_shop.coins(2, 2000) == 53      # 35 × 1,5 = 52,5 → aufgerundet
    assert race_shop.coins(None, 3000) == 20


def test_tier_parsing():
    t = race_shop.tier
    assert t("False", "1000") == 0
    assert t("", "") == 0
    assert t("True", "1000") == 1000
    assert t("true", "2000") == 2000
    assert t("True", "3") == 3000
    assert t("1", "") == 1000           # Sub ohne Tier-Angabe = Tier 1
    assert t("True", "99") == 1000


CAT = [{"key": "2020-audi-rs-6-avant", "name": "2020 Audi RS 6 Avant", "brand": "Audi"},
       {"key": "2024-audi-rs6-avant-gt", "name": "2024 Audi RS6 Avant GT", "brand": "Audi"},
       {"key": "amg-w14-s1", "name": "Amg W14 S1 | www.vecarz.com", "brand": "Mercedes-Benz"},
       {"key": "volkswagen-golf-gti-1976", "name": "Volkswagen Golf GTI 1976", "brand": "Volkswagen"},
       {"key": "1992-volkswagen-golf-gti", "name": "1992 Volkswagen Golf GTI", "brand": "Volkswagen"},
       {"key": "krabby-patty-wagon", "name": "Krabby Patty Wagon", "brand": "Other"}]


def test_find_car_exact_partial_ambiguous_and_typo():
    f = race_shop.find_car
    assert f("W14", CAT)[0]["key"] == "amg-w14-s1"
    assert f("Krabby", CAT)[0]["key"] == "krabby-patty-wagon"
    assert f("1992 Volkswagen Golf GTI", CAT)[0]["key"] == "1992-volkswagen-golf-gti"
    assert f("golf gti 1976", CAT)[0]["key"] == "volkswagen-golf-gti-1976"
    car, hits = f("rs6", CAT)
    assert car is None and {h["key"] for h in hits} == {"2020-audi-rs-6-avant", "2024-audi-rs6-avant-gt"}
    assert f("krabby paty wagon", CAT)[0] is None and f("krabby paty wagon", CAT)[1][0]["key"] == "krabby-patty-wagon"
    assert f("", CAT) == (None, [])
    assert f("zzzzzz", CAT) == (None, [])


def test_find_paint_and_clean_name():
    assert race_shop.find_paint("Gold") == "gold"
    assert race_shop.find_paint("pur") == "purple"
    assert race_shop.find_paint("carbon") == "carbon"
    assert race_shop.find_paint("off") == "off"
    assert race_shop.find_paint("rainbow") is None
    assert race_shop.clean_name("FREE Audi R8 | www.vecarz.com") == "Audi R8"
    assert race_shop.car_name(CAT, "amg-w14-s1") == "Amg W14 S1"
