"""Chat-Übersteuerungen der Weather-Source: Haltezeit, Mindestdauer, Neustartfest."""
import sqlite3

import pytest

from fx.weather_db import MIN_HOLD, clear_override, current_override, init_schema, set_override


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    init_schema(c)
    yield c
    c.close()


def test_override_holds_then_expires(conn):
    set_override(conn, 1, "storm", 150, now=1000)
    assert current_override(conn, 1, 1100)["kind"] == "storm"
    assert current_override(conn, 1, 1151) is None


def test_second_command_within_min_hold_waits_and_latest_wins(conn):
    assert MIN_HOLD == 15
    set_override(conn, 1, "storm", 150, now=1000)
    set_override(conn, 1, "blizzard", 150, now=1005)
    set_override(conn, 1, "sun", 150, now=1008)            # ungültig → ignoriert
    set_override(conn, 1, "fog", 150, now=1010)
    assert current_override(conn, 1, 1012)["kind"] == "storm"
    o = current_override(conn, 1, 1015)
    assert o["kind"] == "fog" and o["since"] == 1015 and o["until"] == 1165


def test_after_min_hold_replaces_immediately(conn):
    set_override(conn, 1, "storm", 150, now=1000)
    set_override(conn, 1, "snow", 150, now=1020)
    assert current_override(conn, 1, 1020)["kind"] == "snow"


def test_forced_survives_and_auto_clears(conn):
    set_override(conn, 1, "storm", 0, now=1000)
    assert current_override(conn, 1, 10**9)["until"] is None
    clear_override(conn, 1)
    assert current_override(conn, 1, 1001) is None


def test_auto_also_drops_pending(conn):
    set_override(conn, 1, "storm", 150, now=1000)
    set_override(conn, 1, "snow", 150, now=1005)
    clear_override(conn, 1)
    assert current_override(conn, 1, 1030) is None


def test_pending_after_expired_current_starts_on_time(conn):
    set_override(conn, 1, "storm", 20, now=1000)
    set_override(conn, 1, "fog", 150, now=1010)
    o = current_override(conn, 1, 1100)
    assert o["kind"] == "fog" and o["since"] == 1015


def test_tenants_are_separate(conn):
    set_override(conn, 1, "storm", 0, now=1000)
    assert current_override(conn, 2, 1001) is None
