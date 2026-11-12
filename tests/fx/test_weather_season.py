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
    use(conn, 1, "water", "Ben", 1500)                            # Feuchte 20
    lv = advance(conn, 1, 1620, "spring", {**W, "rain": 1})["levels"]
    assert lv["water"] == pytest.approx(76) and lv["weeds"] == pytest.approx(27)
    assert advance(conn, 1, 2220, "spring", W)["levels"]["water"] == pytest.approx(56)
    assert advance(conn, 1, 2280, "spring", {**W, "heat": 1})["levels"]["water"] == pytest.approx(50)


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


def test_water_grows_the_target_flower_in_two_steps(conn):
    from fx.weather_season import GROW_STEPS, GROW_COOLDOWN, grow_stages
    t = 0
    r = None
    for i in range(GROW_STEPS[1]):
        # jeder Zuschauer zählt höchstens alle GROW_COOLDOWN Sekunden
        r = use(conn, 1, "water", "U" + str(i % 3), t, target="Anna")
        t += GROW_COOLDOWN / 3 + 1
        if i + 1 == GROW_STEPS[0]:
            assert r["flower"] == "Anna" and r["stage"] == 1 and r["up"] is True
    assert r["stage"] == 2 and r["up"] is True
    # mehr als zwei Stufen gibt es nicht, und sie bleiben
    r = use(conn, 1, "water", "U9", t + 9999, target="anna")
    assert r["stage"] == 2 and r["up"] is False
    assert grow_stages(conn, 1) == {"anna": 2}


def test_water_cooldown_and_rain_do_not_grow(conn):
    from fx.weather_season import grow_stages
    use(conn, 1, "water", "Tim", 0, target="Anna")
    r = use(conn, 1, "water", "Tim", 10, target="Anna")
    assert r["counted"] is False
    advance(conn, 1, 600, "spring", dict(W, rain=1))
    assert grow_stages(conn, 1) == {}
    assert load(conn, 1)["grow"] == {"anna": 1}


def test_water_without_name_always_counts(conn):
    # Dashboard-Knopf (ohne Namen): keine Abklingzeit
    use(conn, 1, "water", "", 0, target="Anna")
    r = use(conn, 1, "water", "", 1, target="Anna")
    assert r["counted"] is True
    assert load(conn, 1)["grow"] == {"anna": 2}
