"""Schneedecke des Winter-Themas: wächst bei Schneefall, Schippen, Schütteln."""
import sqlite3

import pytest

from fx.weather_snow import advance, drift, icicle, init_schema, load, shake, shovel


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    init_schema(c)
    yield c
    c.close()


def test_grows_while_snowing_and_melts_in_heat(conn):
    # Blizzard (Menge 1): 25 %/min → nach 2,5 min gut ein Drittel bis die Hälfte
    advance(conn, 1, now=0, snow=1.0, heat=False, temp=-2)
    assert advance(conn, 1, now=150, snow=1.0, heat=False, temp=-2)["level"] == pytest.approx(62.5)
    assert advance(conn, 1, now=210, snow=0, heat=True, temp=-2)["level"] == pytest.approx(42.5)


def test_snow_amount_curve(conn):
    # Schnee (0,6) ≈ 10 %/min, Schneeregen (0,45) ≈ 6 %/min
    advance(conn, 1, now=0, snow=0.6, heat=False, temp=-2)
    assert advance(conn, 1, now=60, snow=0.6, heat=False, temp=-2)["level"] == pytest.approx(10, abs=0.3)
    advance(conn, 2, now=0, snow=0.45, heat=False, temp=-2)
    assert advance(conn, 2, now=60, snow=0.45, heat=False, temp=-2)["level"] == pytest.approx(6, abs=0.3)


def test_avalanche_drift_adds_snow(conn):
    advance(conn, 1, now=0, snow=0, heat=False, temp=-2)
    assert drift(conn, 1, 20, now=10) == 20
    assert drift(conn, 1, 90, now=20) == 100
    assert load(conn, 1)["level"] == 100


def test_slow_thaw_above_zero_and_stays_without_snow_in_frost(conn):
    advance(conn, 1, now=0, snow=1.0, heat=False, temp=-2)
    advance(conn, 1, now=144, snow=1.0, heat=False, temp=-2)                  # 60
    assert advance(conn, 1, now=1200, snow=0, heat=False, temp=-2)["level"] == pytest.approx(60)
    assert advance(conn, 1, now=1800, snow=0, heat=False, temp=4)["level"] == pytest.approx(43)


def test_shovel_counts_for_board(conn):
    advance(conn, 1, now=0, snow=1.0, heat=False, temp=-2)
    advance(conn, 1, now=144, snow=1.0, heat=False, temp=-2)
    assert shovel(conn, 1, "Mia", now=600) == {"done": 5, "level": 55}
    assert shovel(conn, 1, "", now=600)["done"] == 5
    assert load(conn, 1)["top"] == [["Mia", 1]]


def test_shake_needs_a_group_unless_forced(conn):
    advance(conn, 1, now=0, snow=1.0, heat=False, temp=-2)
    advance(conn, 1, now=144, snow=1.0, heat=False, temp=-2)
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
