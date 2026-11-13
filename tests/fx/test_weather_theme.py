"""Winter-Thema: 1. Advent, Xmas-Zeit, Aufbau/Abschied, Thema nach Datum."""
import sqlite3
from datetime import date

import pytest

from fx.weather_theme import (advent1, advent_burn, early_start, init_schema, load_early, mark, status, theme_for,
                              xmas_window)


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


def test_advent_burn_days_per_candle():
    # 2026: 1. Advent 29.11., dann 6.12., 13.12., 20.12.
    assert advent_burn(date(2026, 11, 28)) == [-1, -1, -1, -1]
    assert advent_burn(date(2026, 11, 29)) == [0, -1, -1, -1]
    assert advent_burn(date(2026, 12, 8)) == [9, 2, -1, -1]
    assert advent_burn(date(2026, 12, 24)) == [25, 18, 11, 4]
    # Januar gehört zur Vorjahres-Saison
    assert advent_burn(date(2027, 1, 2)) == [34, 27, 20, 13]
    assert advent_burn(date(2026, 6, 1)) == [-1, -1, -1, -1]


def test_window_and_season():
    assert xmas_window(date(2026, 12, 10), "advent", "12-26") == (date(2026, 11, 29), date(2026, 12, 26), 2026)
    assert xmas_window(date(2027, 1, 3), "12-01", "01-06") == (date(2026, 12, 1), date(2027, 1, 6), 2026)
    assert xmas_window(date(2026, 11, 15), "11-15", "12-26")[0] == date(2026, 11, 15)


def test_theme_by_calendar():
    # kalendarische Jahreszeiten: 20.3., 21.6., 22.9., 21.12.
    assert theme_for(date(2026, 12, 20), "auto", False) == "autumn"
    assert theme_for(date(2026, 12, 21), "auto", False) == "winter"
    assert theme_for(date(2027, 3, 19), "auto", False) == "winter"
    assert theme_for(date(2027, 3, 20), "auto", False) == "spring"
    assert theme_for(date(2026, 6, 20), "auto", False) == "spring"
    assert theme_for(date(2026, 6, 21), "auto", False) == "summer"
    assert theme_for(date(2026, 9, 21), "auto", False) == "summer"
    assert theme_for(date(2026, 9, 22), "auto", False) == "autumn"
    assert theme_for(date(2026, 11, 30), "auto", True) == "winter"       # Xmas-Zeit im November
    assert theme_for(date(2026, 7, 10), "spring", False) == "spring"
    assert theme_for(date(2026, 7, 1), "winter", False) == "winter"
    assert theme_for(date(2026, 12, 24), "none", True) == "none"


def test_tree_set_up_beats_fixed_season():
    # Baum per Knopf aufgebaut: Winter auch bei fest gewähltem Herbst
    assert theme_for(date(2026, 11, 10), "autumn", False, set_up=True) == "winter"
    assert theme_for(date(2026, 11, 10), "none", False, set_up=True) == "none"
    # Datumsfenster allein lässt das feste Thema stehen
    assert theme_for(date(2026, 12, 10), "autumn", True) == "autumn"


def test_early_start_holds_until_calendar_catches_up(conn):
    early_start(conn, 1, date(2026, 11, 10), "winter")
    early = load_early(conn, 1)
    assert early == {"theme": "winter", "until": "2026-12-21"}
    assert theme_for(date(2026, 11, 10), "auto", False, early=early) == "winter"
    assert theme_for(date(2026, 12, 20), "auto", False, early=early) == "winter"
    # danach übernimmt der Kalender, im Frühling wirkt der alte Frühstart nicht mehr
    assert theme_for(date(2027, 3, 25), "auto", False, early=early) == "spring"
    # fest gewähltes Thema geht vor
    assert theme_for(date(2026, 11, 10), "autumn", False, early=early) == "autumn"
    # „next“ = die nächste Jahreszeit nach dem Kalender; „auto“ hebt auf
    early_start(conn, 1, date(2026, 8, 1), "next")
    assert load_early(conn, 1) == {"theme": "autumn", "until": "2026-09-22"}
    early_start(conn, 1, date(2026, 8, 1), "auto")
    assert load_early(conn, 1) is None


def test_early_start_survives_xmas_steps(conn):
    early_start(conn, 1, date(2026, 11, 10), "winter")
    mark(conn, 1, date(2026, 11, 12), {}, "setup")
    assert load_early(conn, 1) == {"theme": "winter", "until": "2026-12-21"}
    assert status(conn, 1, date(2026, 11, 12), {}) == "on"

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


def test_climate_zone():
    from fx.weather_theme import climate_zone
    assert climate_zone(52.5) == "north"
    assert climate_zone(-34.6) == "south"                       # Buenos Aires
    assert climate_zone(-23.5) == "summer"                      # São Paulo: Tropen
    assert climate_zone(None) == "north"                        # ohne Ort wie bisher
    # Klima geht vor der Breite: kältester Monat ≥ 18 °C → immer Sommer
    assert climate_zone(25.3, [19, 21, 24, 28, 33, 35, 36, 37, 34, 30, 25, 21]) == "summer"   # Dubai
    assert climate_zone(-33.9, [22, 22, 21, 18, 16, 14, 13, 14, 15, 17, 19, 21]) == "south"
    # wärmster Monat < 10 °C → immer Winter
    assert climate_zone(72.0, [-20, -21, -18, -12, -3, 3, 7, 6, 1, -6, -13, -18]) == "winter"


def test_theme_by_zone():
    assert theme_for(date(2026, 4, 10), "auto", False, zone="south") == "autumn"
    assert theme_for(date(2026, 7, 10), "auto", False, zone="south") == "winter"
    assert theme_for(date(2026, 10, 10), "auto", False, zone="south") == "spring"
    assert theme_for(date(2027, 1, 10), "auto", False, zone="south") == "summer"
    assert theme_for(date(2026, 7, 10), "auto", False, zone="summer") == "summer"
    assert theme_for(date(2026, 1, 10), "auto", False, zone="summer") == "summer"
    assert theme_for(date(2026, 7, 10), "auto", False, zone="winter") == "winter"
    # Weihnachten: im Norden und im ewigen Winter Winter, sonst am Strand
    assert theme_for(date(2026, 12, 10), "auto", True, zone="north") == "winter"
    assert theme_for(date(2026, 12, 10), "auto", True, zone="south") == "summer"
    assert theme_for(date(2026, 12, 10), "auto", True, zone="summer") == "summer"
    assert theme_for(date(2026, 11, 10), "autumn", False, set_up=True, zone="south") == "summer"
    # fest gewähltes Thema geht weiter vor
    assert theme_for(date(2026, 7, 10), "spring", False, zone="summer") == "spring"


def test_xmas_theme_and_status_by_zone(conn):
    from fx.weather_theme import xmas_theme
    assert xmas_theme("north") == "winter" and xmas_theme("winter") == "winter"
    assert xmas_theme("south") == "summer" and xmas_theme("summer") == "summer"
    # Aufbau ist am Strand genauso fällig
    assert status(conn, 1, date(2026, 12, 5), {}, "summer", zone="south") == "setup"
    assert status(conn, 1, date(2026, 12, 5), {}, "summer", zone="north") == "off"


def test_early_start_follows_zone(conn):
    early_start(conn, 1, date(2026, 4, 1), "next", zone="south")      # Herbst im Süden → Winter
    assert load_early(conn, 1) == {"theme": "winter", "until": "2026-06-21"}
