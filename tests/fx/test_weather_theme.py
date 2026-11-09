"""Winter-Thema: 1. Advent, Xmas-Zeit, Aufbau/Abschied, Thema nach Datum."""
import sqlite3
from datetime import date

import pytest

from fx.weather_theme import (advent1, init_schema, mark, status, theme_for, xmas_window)


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    init_schema(c)
    yield c
    c.close()


def test_first_advent():
    assert advent1(2026) == date(2026, 11, 29)
    assert advent1(2025) == date(2025, 11, 30)
    assert advent1(2022) == date(2022, 11, 27)


def test_window_and_season():
    assert xmas_window(date(2026, 12, 10), "advent", "12-26") == (date(2026, 11, 29), date(2026, 12, 26), 2026)
    assert xmas_window(date(2027, 1, 3), "12-01", "01-06") == (date(2026, 12, 1), date(2027, 1, 6), 2026)
    assert xmas_window(date(2026, 11, 15), "11-15", "12-26")[0] == date(2026, 11, 15)


def test_theme_by_date():
    assert theme_for(date(2026, 1, 10), "auto", False) == "winter"
    assert theme_for(date(2026, 11, 30), "auto", True) == "winter"       # Xmas-Zeit im November
    assert theme_for(date(2026, 11, 10), "auto", False) == "none"
    assert theme_for(date(2026, 7, 1), "winter", False) == "winter"
    assert theme_for(date(2026, 12, 24), "none", True) == "none"


def test_automatic_setup_then_farewell(conn):
    o = {"xmasfrom": "advent", "xmasto": "12-26"}
    assert status(conn, 1, date(2026, 11, 20), o) == "off"
    assert status(conn, 1, date(2026, 11, 30), o) == "setup"             # fällig
    mark(conn, 1, date(2026, 11, 30), o, "setup")
    assert status(conn, 1, date(2026, 12, 20), o) == "on"
    assert status(conn, 1, date(2026, 12, 28), o) == "farewell"          # fällig
    mark(conn, 1, date(2026, 12, 28), o, "farewell")
    assert status(conn, 1, date(2027, 1, 5), o) == "off"


def test_manual_setup_mid_november_makes_auto_setup_moot(conn):
    o = {"xmasfrom": "advent", "xmasto": "12-26"}
    mark(conn, 1, date(2026, 11, 15), o, "setup")
    assert status(conn, 1, date(2026, 11, 15), o) == "on"
    assert status(conn, 1, date(2026, 11, 30), o) == "on"                # kein zweiter Aufbau


def test_manual_farewell_ends_the_season(conn):
    o = {"xmasfrom": "advent", "xmasto": "12-26"}
    mark(conn, 1, date(2026, 12, 1), o, "setup")
    mark(conn, 1, date(2026, 12, 20), o, "farewell")
    assert status(conn, 1, date(2026, 12, 22), o) == "off"


def test_missed_farewell_after_theme_change_is_silent(conn):
    o = {"xmasfrom": "advent", "xmasto": "12-26"}
    mark(conn, 1, date(2026, 12, 1), o, "setup")
    assert status(conn, 1, date(2027, 3, 10), o, theme="none") == "off"


def test_new_season_starts_fresh(conn):
    o = {"xmasfrom": "advent", "xmasto": "12-26"}
    mark(conn, 1, date(2026, 12, 1), o, "setup")
    mark(conn, 1, date(2026, 12, 27), o, "farewell")
    assert status(conn, 1, date(2027, 11, 29), o) == "setup"


def test_tenants_are_separate(conn):
    o = {"xmasfrom": "advent", "xmasto": "12-26"}
    mark(conn, 1, date(2026, 11, 15), o, "setup")
    assert status(conn, 2, date(2026, 11, 15), o) == "off"
