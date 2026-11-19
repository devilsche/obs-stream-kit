import sqlite3

import pytest

from fx import race_db


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:", check_same_thread=False)
    c.row_factory = sqlite3.Row
    race_db.init_schema(c)
    yield c
    c.close()


def r(uid, place, display=None):
    return {"user_id": uid, "login": uid, "display": display or uid, "place": place, "car_key": "k"}


def pts(conn, race_id):
    rows = conn.execute("SELECT user_id, points FROM fx_race_result WHERE race_id = ?", (race_id,)).fetchall()
    return {x["user_id"]: x["points"] for x in rows}


def test_points_function():
    assert race_db.points(None, 5) == 0
    assert race_db.points(1, 3) == 3
    assert race_db.points(3, 3) == 0


def test_points_field_of_three(conn):
    race_db.record(conn, 1, "r1", [r("a", 1), r("b", 2), r("c", 3)])
    assert pts(conn, "r1") == {"a": 3, "b": 1, "c": 0}


def test_points_field_of_ten_with_dnf(conn):
    rows = [r(str(i), i) for i in range(1, 8)] + [r("x", None), r("y", None), r("z", None)]
    race_db.record(conn, 1, "r2", rows)
    p = pts(conn, "r2")
    assert p["1"] == 10 and p["2"] == 8 and p["7"] == 3 and p["x"] == 0


def test_record_is_idempotent(conn):
    assert race_db.record(conn, 1, "r1", [r("a", 1), r("b", 2), r("c", 3)]) is True
    assert race_db.record(conn, 1, "r1", [r("a", 3), r("b", 2), r("c", 1)]) is False
    assert pts(conn, "r1")["a"] == 3


def test_board_month_and_all_and_void(conn):
    race_db.record(conn, 1, "old", [r("a", 1), r("b", 2), r("c", 3)], at="2026-10-05T10:00:00+00:00")
    race_db.record(conn, 1, "new", [r("b", 1), r("a", 2), r("c", 3)], at="2026-11-05T10:00:00+00:00")
    assert [x["user_id"] for x in race_db.board(conn, 1, "month", "2026-11")] == ["b", "a", "c"]
    assert race_db.board(conn, 1, "all")[0]["points"] == 4
    assert race_db.board(conn, 1, "all")[0]["user_id"] == "a"
    assert race_db.void(conn, 1, "new") is True
    assert race_db.board(conn, 1, "month", "2026-11") == []
    assert race_db.void(conn, 1, "gibtsnicht") is False


def test_board_stats(conn):
    race_db.record(conn, 1, "r1", [r("a", 1), r("b", 2), r("c", None)], at="2026-11-01T10:00:00+00:00")
    race_db.record(conn, 1, "r2", [r("a", 2), r("b", 1), r("c", 3)], at="2026-11-02T10:00:00+00:00")
    top = {x["user_id"]: x for x in race_db.board(conn, 1, "all")}
    assert top["a"]["races"] == 2 and top["a"]["wins"] == 1 and top["a"]["podiums"] == 2 and top["a"]["best"] == 1
    assert top["c"]["best"] == 3 and top["c"]["podiums"] == 1


def test_rename_keeps_points_latest_display_wins(conn):
    race_db.record(conn, 1, "r1", [r("a", 1, display="Old"), r("b", 2), r("c", 3)])
    race_db.record(conn, 1, "r2", [r("a", 1, display="New"), r("b", 2), r("c", 3)])
    top = race_db.board(conn, 1, "all")[0]
    assert top["display"] == "New" and top["points"] == 6


def test_tenants_are_separate(conn):
    race_db.record(conn, 1, "r1", [r("a", 1), r("b", 2), r("c", 3)])
    assert race_db.board(conn, 2, "all") == []
    assert race_db.record(conn, 2, "r1", [r("a", 1), r("b", 2)]) is True


def test_tiebreak_earliest_last_result(conn):
    race_db.record(conn, 1, "r1", [r("a", 1), r("b", 2)], at="2026-11-01T10:00:00+00:00")
    race_db.record(conn, 1, "r2", [r("b", 1), r("a", 2)], at="2026-11-02T10:00:00+00:00")
    race_db.record(conn, 1, "r3", [r("a", 1), r("b", 2)], at="2026-11-03T10:00:00+00:00")
    race_db.record(conn, 1, "r4", [r("b", 1), r("a", 2)], at="2026-11-04T10:00:00+00:00")
    assert [x["user_id"] for x in race_db.board(conn, 1, "all")] == ["a", "b"]


def test_champions_only_closed_months(conn):
    now = race_db._now()
    race_db.record(conn, 1, "o", [r("a", 1), r("b", 2), r("c", 3)], at="2020-10-05T10:00:00+00:00")
    race_db.record(conn, 1, "n", [r("b", 1), r("a", 2), r("c", 3)], at=now)
    ch = race_db.champions(conn, 1)
    assert [(c["month"], c["user_id"], c["points"]) for c in ch] == [("2020-10", "a", 3)]


def test_car_stats(conn):
    race_db.record(conn, 1, "r1", [dict(r("a", 1), car_key="x"), dict(r("b", 2), car_key="y")])
    race_db.record(conn, 1, "r2", [dict(r("a", 2), car_key="x"), dict(r("b", 1), car_key="x")])
    st = {x["car_key"]: x for x in race_db.car_stats(conn, 1)}
    assert st["x"]["races"] == 3 and st["x"]["wins"] == 2
    assert st["y"]["races"] == 1 and st["y"]["wins"] == 0
