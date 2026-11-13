"""Jahreszeiten-Mechaniken: Laub, Garten, Sommerhitze."""
import sqlite3

import pytest

from fx.weather_season import advance, ignite, init_schema, load, use


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    init_schema(c)
    yield c
    c.close()


W = {"wind": 0, "rain": 0, "heat": 0, "sun": 0, "night": 0}


def test_no_drying_while_paused_or_offline(conn):
    advance(conn, 1, 0, "spring", W, flowers=["a"])
    # kein Stream: Zeit steht
    assert advance(conn, 1, 3600, "spring", W, flowers=["a"], paused=True)["levels"]["water"] == 60
    # OBS über Nacht zu: die Lücke zählt höchstens max_gap (2 %/min × 3 min)
    lv = advance(conn, 1, 3600 + 8 * 3600, "spring", W, flowers=["a"], max_gap=180)["levels"]
    assert lv["water"] == pytest.approx(54)
    assert lv["deadFlowers"] == []


def test_blizzard_blows_leaves_away(conn):
    advance(conn, 1, 0, "autumn", W)
    advance(conn, 1, 1800, "autumn", {**W, "wind": 1})                     # 3 %/min × 30 min = 90
    # Blizzard: 25 %/min weg, statt dazu
    assert advance(conn, 1, 1920, "autumn", {**W, "wind": 1, "blizzard": 1})["levels"]["leaves"] == pytest.approx(40)
    assert advance(conn, 1, 2400, "autumn", {**W, "wind": 1, "blizzard": 1})["levels"]["leaves"] == 0


def test_leaves_fall_faster_with_wind_and_rake_counts(conn):
    advance(conn, 1, 0, "autumn", W)
    assert advance(conn, 1, 600, "autumn", W)["levels"]["leaves"] == pytest.approx(10)
    assert advance(conn, 1, 900, "autumn", {**W, "wind": 1})["levels"]["leaves"] == pytest.approx(25)
    r = use(conn, 1, "rake", "Mia", 900)
    assert r["done"] == 5 and r["level"] == pytest.approx(20)
    assert load(conn, 1)["top"]["autumn"] == [["Mia", 1]]
    use(conn, 1, "sweep", "", 900)
    assert load(conn, 1)["levels"]["leaves"] == 0


def test_garden_dries_rain_waters_weeds_grow(conn):
    assert advance(conn, 1, 0, "spring", W)["levels"]["water"] == 60   # frischer Garten ist feucht
    assert advance(conn, 1, 1500, "spring", W)["levels"]["water"] == pytest.approx(10)
    # die Gießkanne gießt nur eine Blume, der Boden bleibt
    use(conn, 1, "water", "Ben", 1500, flowers=["Ben"])
    lv = advance(conn, 1, 1620, "spring", {**W, "rain": 1})["levels"]
    assert lv["water"] == pytest.approx(66) and lv["weeds"] == pytest.approx(27)
    assert advance(conn, 1, 2220, "spring", W)["levels"]["water"] == pytest.approx(46)
    assert advance(conn, 1, 2280, "spring", {**W, "heat": 1})["levels"]["water"] == pytest.approx(40)


def test_weed_group_halves_and_force(conn):
    advance(conn, 1, 0, "spring", W)
    advance(conn, 1, 6000, "spring", W)                            # Unkraut 100
    assert use(conn, 1, "weed", "A", 6000)["level"] == pytest.approx(97)
    use(conn, 1, "weed", "B", 6001)
    r = use(conn, 1, "weed", "C", 6002)
    assert r["success"] is True and r["level"] == pytest.approx(45.5)
    assert use(conn, 1, "weed", "Mod", 6003, force=True)["level"] == pytest.approx(22.75)
    assert load(conn, 1)["top"]["spring"][0] == ["A", 1]


def test_summer_heat(conn):
    advance(conn, 1, 0, "summer", W)
    assert advance(conn, 1, 120, "summer", {**W, "heat": 1})["levels"]["heat"] == pytest.approx(40)
    assert advance(conn, 1, 180, "summer", {**W, "rain": 1})["levels"]["heat"] == pytest.approx(30)
    assert use(conn, 1, "splash", "Kim", 180) == {"done": 5, "level": 25}
    use(conn, 1, "cool", "", 180)
    assert load(conn, 1)["levels"]["heat"] == 0


def test_only_the_active_theme_advances(conn):
    advance(conn, 1, 0, "summer", W)
    assert advance(conn, 1, 600, "summer", W)["levels"]["leaves"] == 0


def test_tenants_are_separate(conn):
    advance(conn, 1, 0, "autumn", W)
    advance(conn, 1, 600, "autumn", W)
    assert load(conn, 2)["levels"]["leaves"] == 0


def test_lightning_fire_burns_leaves_and_extinguish_counts(conn):
    advance(conn, 1, 0, "autumn", W)
    advance(conn, 1, 1800, "autumn", {**W, "wind": 1})                     # 90
    r = ignite(conn, 1, 1800, wet=False)
    assert r["secs"] == 30
    assert load(conn, 1)["levels"]["leaves"] == pytest.approx(90)       # Loch nur im Bild, an der Stelle
    assert use(conn, 1, "extinguish", "Mia", 1810)["done"] == 1
    # eigene Rangliste der Feuerwehr, nicht die der Laubrecher
    assert load(conn, 1)["top"]["fire"] == [["Mia", 1]] and "autumn" not in load(conn, 1)["top"]
    assert use(conn, 1, "extinguish", "Tom", 1811)["done"] == 0            # schon aus, zählt nicht
    assert load(conn, 1)["top"]["fire"] == [["Mia", 1]]


def test_up_to_five_fires_burn_at_once_and_extinguish_takes_the_oldest(conn):
    advance(conn, 1, 0, "autumn", W)
    advance(conn, 1, 6000, "autumn", {**W, "wind": 1})                     # 100
    for i in range(5):
        r = ignite(conn, 1, 6000 + i, wet=False)
        assert r["fires"] == i + 1
    assert ignite(conn, 1, 6006, wet=False) == {"secs": 0, "fires": 5}   # voll
    for left, name in ((4, "Mia"), (3, "Tom"), (2, "Mia")):
        r = use(conn, 1, "extinguish", name, 6010)
        assert r["done"] == 1 and r["fires"] == left
    assert ignite(conn, 1, 6011, wet=False)["fires"] == 3                  # zwei brennen noch
    # die beiden übrigen ersten Feuer gehen nach 30 s von selbst aus
    assert ignite(conn, 1, 6035, wet=False)["fires"] == 2


def test_old_single_fire_state_still_counts(conn):
    advance(conn, 1, 0, "autumn", W)
    from fx.weather_season import _get, _put
    data = _get(conn, 1)
    data["fire"] = {"until": 500}
    _put(conn, 1, data)
    assert use(conn, 1, "extinguish", "Mia", 400)["done"] == 1


def test_wet_fire_only_smoulders_and_goes_out_by_itself(conn):
    advance(conn, 1, 0, "autumn", W)
    assert ignite(conn, 1, 100, wet=True)["secs"] == 8
    assert use(conn, 1, "extinguish", "Mia", 120)["done"] == 0             # schon von selbst aus


def test_snow_cools_the_beach(conn):
    advance(conn, 1, 0, "summer", W)
    advance(conn, 1, 300, "summer", {**W, "heat": 1})                       # 20 %/min × 5 = 100
    assert advance(conn, 1, 420, "summer", {**W, "heat": 1, "snow": 0.6})["levels"]["heat"] == pytest.approx(50)


def test_heat_fades_without_sun_faster_when_cold(conn):
    advance(conn, 1, 0, "summer", W)
    advance(conn, 1, 300, "summer", {**W, "heat": 1})                       # 100
    assert advance(conn, 1, 600, "summer", W)["levels"]["heat"] == pytest.approx(80)            # −4 %/min
    assert advance(conn, 1, 900, "summer", {**W, "temp": 5})["levels"]["heat"] == pytest.approx(40)   # −8 %/min
    # Sonne hält den Strand warm, auch wenn es kühl ist? Nein: unter 15 °C kühlt er trotzdem
    assert advance(conn, 1, 1020, "summer", {**W, "sun": 1, "temp": 5})["levels"]["heat"] == pytest.approx(24)


def test_leafstorm_adds_leaves_without_ranking(conn):
    advance(conn, 1, 0, "autumn", W)
    r = use(conn, 1, "leafstorm", "Mod", 10)
    assert r["done"] == 25 and r["level"] == 25
    assert "autumn" not in load(conn, 1)["top"]



def test_own_flower_first_then_random_open_ones(conn):
    import random
    from fx.weather_season import OWN_COOLDOWN, ANY_COOLDOWN, grow_stages
    names = ["Anna", "Ben", "Cleo"]
    r = use(conn, 1, "water", "anna", 0, flowers=names)
    assert r["flower"] == "Anna" and r["stage"] == 1 and r["up"] is True
    # zweites Mal gleich danach: zufällige, nicht ausgewachsene
    r = use(conn, 1, "water", "anna", 1, flowers=names, rnd=random.Random(3))
    assert r["flower"] in ("Ben", "Cleo") and r["stage"] == 1
    # innerhalb von ANY_COOLDOWN wächst nichts
    r = use(conn, 1, "water", "anna", 2, flowers=names)
    assert "flower" not in r
    # nach OWN_COOLDOWN wieder die eigene: Stufe 2, ausgewachsen
    r = use(conn, 1, "water", "anna", OWN_COOLDOWN + 1, flowers=names)
    assert r["flower"] == "Anna" and r["stage"] == 2
    assert grow_stages(conn, 1)["anna"] == 2


def test_dashboard_without_name_waters_random_open_flower_every_time(conn):
    names = ["Anna", "Ben"]
    for t in range(4):
        use(conn, 1, "water", "", t, flowers=names)
    from fx.weather_season import grow_stages
    assert grow_stages(conn, 1) == {"anna": 2, "ben": 2}


def test_each_flower_has_its_own_water_can_waters_only_one(conn):
    names = ["Anna", "Ben"]
    advance(conn, 1, 0, "spring", W, flowers=names)
    r = use(conn, 1, "water", "anna", 0, flowers=names)
    assert r["flower"] == "Anna" and r["flower_level"] == pytest.approx(85)
    lv = load(conn, 1)["levels"]
    assert lv["flowers"] == {"anna": 85.0, "ben": 60.0} and lv["water"] == 60


def test_flower_dies_alone_and_revives_at_stage_zero(conn):
    from fx.weather_season import grow_stages
    names = ["Anna", "Ben"]
    advance(conn, 1, 0, "spring", W, flowers=names)
    use(conn, 1, "water", "anna", 0, flowers=names)           # Anna 85, Stufe 1
    st = advance(conn, 1, 23 * 60, "spring", W, flowers=names)  # −46: Anna 39, Ben 14
    assert st["levels"]["deadFlowers"] == ["ben"] and grow_stages(conn, 1) == {"anna": 1}
    # Gießkanne für Ben: lebt auf (39), wächst dabei aber nicht
    r = use(conn, 1, "water", "ben", 23 * 60, flowers=names)
    assert r["revived"] is True and r["stage"] == 0
    assert load(conn, 1)["levels"]["deadFlowers"] == []


def test_sprinkler_waters_all_and_regen_does_not_grow(conn):
    from fx.weather_season import grow_stages
    names = ["Anna", "Ben"]
    advance(conn, 1, 0, "spring", W, flowers=names)
    advance(conn, 1, 23 * 60, "spring", W, flowers=names)     # beide 14, eingegangen
    r = use(conn, 1, "sprinkler", "Mod", 23 * 60, flowers=names)
    assert sorted(r["revived"]) == ["anna", "ben"]
    assert load(conn, 1)["levels"]["flowers"] == {"anna": 44.0, "ben": 44.0}
    advance(conn, 1, 30 * 60, "spring", dict(W, rain=1), flowers=names)
    assert grow_stages(conn, 1) == {}


def test_rain_puts_out_running_fires_on_the_server(conn):
    advance(conn, 1, 0, "autumn", W)
    ignite(conn, 1, 0)
    assert use(conn, 1, "extinguish", "", 1)["fires"] == 0      # löschbar, solange es brennt
    ignite(conn, 1, 10)
    advance(conn, 1, 11, "autumn", dict(W, rain=1))
    # nach ein paar Sekunden Regen ist es aus, nichts mehr zu löschen
    assert use(conn, 1, "extinguish", "", 16)["done"] == 0
