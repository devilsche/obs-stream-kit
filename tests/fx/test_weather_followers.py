"""Gemeinsame Follower-Liste aller Jahreszeiten."""
import sqlite3

import pytest

from fx import autumn_db, season_db, xmas_db
from fx.weather_followers import add, init_schema, load


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    for m in (xmas_db, season_db, autumn_db):
        m.init_schema(c)
    init_schema(c)
    yield c
    c.close()


def test_existing_collections_are_merged_once_by_first_follow(conn):
    xmas_db.add_ornament(conn, 1, "Mia")
    autumn_db.add_pumpkin(conn, 1, "Ben")
    season_db.add_item(conn, 1, "spring", "mia")              # gleiche Person, später
    season_db.add_item(conn, 1, "summer", "Kim")
    season_db.add_item(conn, 1, "winter", "Ole")
    out = load(conn, 1)
    assert out["names"] == ["Mia", "Ben", "Kim", "Ole"] and out["total"] == 4


def test_add_dedupes_and_keeps_order(conn):
    assert add(conn, 1, "Ann") is True
    assert add(conn, 1, "ann") is False
    assert add(conn, 1, "Bo") is True
    assert add(conn, 1, "") is True                           # ohne Namen immer
    assert load(conn, 1)["names"] == ["Ann", "Bo", ""] and load(conn, 1)["total"] == 3


def test_newest_limited(conn):
    for i in range(70):
        add(conn, 1, "F%d" % i)
    out = load(conn, 1, limit=60)
    assert out["total"] == 70 and out["names"][0] == "F10" and out["names"][-1] == "F69"


def test_tenants_are_separate(conn):
    add(conn, 1, "Ann")
    assert load(conn, 2)["names"] == []
