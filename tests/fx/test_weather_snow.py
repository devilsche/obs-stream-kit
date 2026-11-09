"""Schneedecke des Winter-Themas: wächst bei Schneefall, Schippen, Schütteln."""
import sqlite3

import pytest

from fx.weather_snow import advance, icicle, init_schema, load, shake, shovel


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    init_schema(c)
    yield c
    c.close()


def test_grows_while_snowing_and_melts_in_heat(conn):
    advance(conn, 1, now=0, snow=1.0, heat=False, temp=-2)
    assert advance(conn, 1, now=300, snow=1.0, heat=False, temp=-2)["level"] == pytest.approx(30)
    assert advance(conn, 1, now=360, snow=0, heat=True, temp=-2)["level"] == pytest.approx(10)


def test_slow_thaw_above_zero_and_stays_without_snow_in_frost(conn):
    advance(conn, 1, now=0, snow=1.0, heat=False, temp=-2)
    advance(conn, 1, now=600, snow=1.0, heat=False, temp=-2)                  # 60
    assert advance(conn, 1, now=1200, snow=0, heat=False, temp=-2)["level"] == pytest.approx(60)
    assert advance(conn, 1, now=1800, snow=0, heat=False, temp=4)["level"] == pytest.approx(43)


def test_shovel_counts_for_board(conn):
    advance(conn, 1, now=0, snow=1.0, heat=False, temp=-2)
    advance(conn, 1, now=600, snow=1.0, heat=False, temp=-2)
    assert shovel(conn, 1, "Mia", now=600) == {"done": 5, "level": 55}
    assert shovel(conn, 1, "", now=600)["done"] == 5
    assert load(conn, 1)["top"] == [["Mia", 1]]


def test_shake_needs_a_group_unless_forced(conn):
    advance(conn, 1, now=0, snow=1.0, heat=False, temp=-2)
    advance(conn, 1, now=600, snow=1.0, heat=False, temp=-2)
    r = shake(conn, 1, "A", now=600, need=3, win=20)
    assert r["success"] is False and r["count"] == 1 and r["need"] == 3
    shake(conn, 1, "a", now=605, need=3, win=20)                              # gleicher Name zählt einmal
    shake(conn, 1, "B", now=606, need=3, win=20)
    assert shake(conn, 1, "C", now=607, need=3, win=20)["success"] is True
    assert load(conn, 1)["level"] == 0
    advance(conn, 1, now=1200, snow=1.0, heat=False, temp=-2)
    assert shake(conn, 1, "Mod", now=1200, need=3, win=20, force=True)["success"] is True


def test_icicle_needs_snow(conn):
    assert icicle(conn, 1, "Mia", now=0)["done"] == 0
    advance(conn, 1, now=0, snow=1.0, heat=False, temp=-2)
    advance(conn, 1, now=300, snow=1.0, heat=False, temp=-2)
    assert icicle(conn, 1, "Mia", now=300)["done"] == 1
    assert load(conn, 1)["top"] == [["Mia", 1]]
