"""Frost-Ebene: Wachstum nach Temperatur, Kratzen/Hauchen, Rangliste."""
import sqlite3

import pytest

from fx.weather_frost import advance, clear, init_schema, load, reset_leaders, use


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    init_schema(c)
    yield c
    c.close()


def test_grows_when_freezing_and_faster_when_colder(conn):
    advance(conn, 1, now=0, temp=-1, blizzard=False)
    a = advance(conn, 1, now=600, temp=-1, blizzard=False)["level"]          # 10 min bei −1 °C
    assert a == pytest.approx(30)
    advance(conn, 2, now=0, temp=-6, blizzard=False)
    assert advance(conn, 2, now=300, temp=-6, blizzard=False)["level"] == pytest.approx(40)


def test_blizzard_freezes_even_without_temperature(conn):
    advance(conn, 1, now=0, temp=None, blizzard=True)
    assert advance(conn, 1, now=60, temp=None, blizzard=True)["level"] == pytest.approx(10)


def test_thaws_above_zero_and_stays_in_bounds(conn):
    advance(conn, 1, now=0, temp=-10, blizzard=False)
    assert advance(conn, 1, now=3600, temp=-10, blizzard=False)["level"] == 100
    assert advance(conn, 1, now=3600 + 600, temp=5, blizzard=False)["level"] == pytest.approx(65)   # 3,5 %/min
    assert advance(conn, 1, now=3600 + 3600, temp=5, blizzard=False)["level"] == 0


def test_rate_setting_scales_growth(conn):
    advance(conn, 1, now=0, temp=-1, blizzard=False, rate=2)
    assert advance(conn, 1, now=60, temp=-1, blizzard=False, rate=2)["level"] == pytest.approx(6)


def test_scrape_and_warm_reduce_and_count_for_one_board(conn):
    advance(conn, 1, now=0, temp=-10, blizzard=False)
    advance(conn, 1, now=600, temp=-10, blizzard=False)                    # 100
    r = use(conn, 1, "scrape", "Mia", now=600)
    assert r == {"done": 6, "level": 94}
    assert use(conn, 1, "warm", "mia", now=600)["done"] == 10
    use(conn, 1, "warm", "Tom", now=600)
    assert load(conn, 1)["top"][:2] == [["mia", 2], ["Tom", 1]]


def test_nothing_to_do_on_clear_glass(conn):
    assert use(conn, 1, "scrape", "Mia", now=0) == {"done": 0, "level": 0}
    assert load(conn, 1)["top"] == []


def test_clear_and_reset(conn):
    advance(conn, 1, now=0, temp=-10, blizzard=False)
    advance(conn, 1, now=600, temp=-10, blizzard=False)
    use(conn, 1, "scrape", "Mia", now=600)
    clear(conn, 1, now=600)
    assert load(conn, 1)["level"] == 0 and load(conn, 1)["top"]
    reset_leaders(conn, 1)
    assert load(conn, 1)["top"] == []


def test_tenants_are_separate(conn):
    advance(conn, 1, now=0, temp=-10, blizzard=False)
    advance(conn, 1, now=600, temp=-10, blizzard=False)
    assert load(conn, 2)["level"] == 0
