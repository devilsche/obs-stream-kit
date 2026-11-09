"""Jahreszeiten-Mechaniken: Laub, Garten, Sommerhitze."""
import sqlite3

import pytest

from fx.weather_season import advance, init_schema, load, use


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    init_schema(c)
    yield c
    c.close()


W = {"wind": 0, "rain": 0, "heat": 0, "sun": 0, "night": 0}


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
