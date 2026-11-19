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


def test_unique_index_rejects_duplicate_rows(conn):
    race_db.record(conn, 1, "r1", [r("a", 1), r("b", 2)])
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO fx_race_result (tenant_id, race_id, at, user_id, field, points) "
                     "VALUES (1, 'r1', 'x', 'a', 2, 1)")


def test_record_integrity_error_means_already_recorded(conn):
    # Wettlauf: die Existenzprüfung sieht noch nichts, der Unique-Index schlägt zu
    race_db.record(conn, 1, "r1", [r("a", 1), r("b", 2)])
    real = conn.execute
    class Blind:
        def __getattr__(self, n): return getattr(conn, n)
        def execute(self, sql, *a):
            if sql.startswith("SELECT 1"):
                return real("SELECT 1 WHERE 0")
            return real(sql, *a)
    assert race_db.record(Blind(), 1, "r1", [r("a", 1), r("b", 2)]) is False
    assert len(pts(conn, "r1")) == 2


def test_stored_points(conn):
    race_db.record(conn, 1, "r1", [r("a", 1), r("b", 2)])
    assert race_db.stored_points(conn, 1, "r1") == {"a": 2, "b": 0}


# --- Garage: Coins und Käufe ---

def rs(uid, place, sub=0):
    return {**r(uid, place), "sub": sub}


def test_record_credits_coins_once_with_sub_multiplier(conn):
    rows = [rs("a", 1, 1000), rs("b", 2), rs("c", 3, 3000), rs("d", 4), rs("e", None, 2000)]
    assert race_db.record(conn, 1, "r1", rows) is True
    got = {u: race_db.coins(conn, 1, u) for u in "abcde"}
    assert got == {"a": 56, "b": 35, "c": 50, "d": 15, "e": 15}
    # doppelte Meldung: weder Zeilen noch Coins
    assert race_db.record(conn, 1, "r1", rows) is False
    assert race_db.coins(conn, 1, "a") == 56
    assert race_db.record(conn, 1, "r2", [rs("a", 2), rs("b", 1)]) is True
    assert race_db.coins(conn, 1, "a") == 56 + 35 and race_db.coins(conn, 1, "b") == 35 + 45


def test_coins_are_per_tenant(conn):
    race_db.record(conn, 1, "r1", [rs("a", 1), rs("b", 2)])
    race_db.record(conn, 2, "r1", [rs("a", 2), rs("b", 1)])
    assert race_db.coins(conn, 1, "a") == 45 and race_db.coins(conn, 2, "a") == 35
    assert race_db.coins(conn, 3, "a") == 0


def test_failed_record_rolls_back_coins(conn):
    race_db.record(conn, 1, "r1", [rs("a", 1), rs("b", 2)])
    # parallele zweite Instanz: Unique-Index greift mitten im Schreiben
    real_exec = conn.execute
    rows = [rs("c", 1), rs("a", 2)]

    class Wrap:
        def __getattr__(self, n):
            return getattr(conn, n)

        def execute(self, sql, args=()):
            if sql.startswith("SELECT 1 FROM fx_race_result"):
                return real_exec("SELECT 1 WHERE 0")
            return real_exec(sql, args)
    conn.execute("INSERT INTO fx_race_result (tenant_id, race_id, at, user_id, field, points) "
                 "VALUES (1, 'r2', 'x', 'a', 2, 0)")
    conn.commit()
    assert race_db.record(Wrap(), 1, "r2", rows) is False
    assert race_db.coins(conn, 1, "c") == 0 and race_db.coins(conn, 1, "a") == 45


def test_void_takes_coins_back_but_not_below_zero(conn):
    race_db.record(conn, 1, "r1", [rs("a", 1), rs("b", 2)])
    race_db.add_coins(conn, 1, "b", "b", 400)
    assert race_db.buy(conn, 1, "b", "car", 400)[0] == "ok"   # b gibt die Rennen-Coins aus
    assert race_db.void(conn, 1, "r1") is True
    assert race_db.coins(conn, 1, "a") == 0 and race_db.coins(conn, 1, "b") == 0
    assert race_db.void(conn, 1, "r1") is False


def test_buy_ok_poor_owned_and_garage(conn):
    assert race_db.buy(conn, 1, "a", "golf", 150) == ("poor", 0)
    race_db.add_coins(conn, 1, "a", "Alice", 200)
    assert race_db.buy(conn, 1, "a", "e39", 400) == ("poor", 200)
    assert race_db.buy(conn, 1, "a", "golf", 150) == ("ok", 50)
    assert race_db.buy(conn, 1, "a", "golf", 150) == ("owned", 50)
    race_db.add_coins(conn, 1, "a", "Alice", 1000)
    assert race_db.buy(conn, 1, "a", "e39", 400) == ("ok", 650)
    assert race_db.garage(conn, 1, "a") == ["golf", "e39"]
    assert race_db.owns(conn, 1, "a", "golf") and not race_db.owns(conn, 2, "a", "golf")
    assert race_db.garage(conn, 2, "a") == []


def test_buy_double_insert_rolls_back_payment(conn):
    race_db.add_coins(conn, 1, "a", "a", 500)
    # parallel schon gekauft (Zeile da, owns()-Prüfung verpasst): Abzug wird zurückgerollt
    conn.execute("INSERT INTO fx_race_garage (tenant_id, user_id, car_key, bought_at) VALUES (1, 'a', 'golf', 'x')")
    conn.commit()
    real = race_db.owns
    try:
        race_db.owns = lambda *a: False
        assert race_db.buy(conn, 1, "a", "golf", 150) == ("owned", 500)
    finally:
        race_db.owns = real
    assert race_db.coins(conn, 1, "a") == 500


def test_add_coins_negative_clamps_and_keeps_display(conn):
    assert race_db.add_coins(conn, 1, "a", "Alice", -50) == 0
    assert race_db.add_coins(conn, 1, "a", "Alice", 100) == 100
    assert race_db.add_coins(conn, 1, "a", "", -30) == 70
    assert race_db.add_coins(conn, 1, "a", "Alice", -500) == 0
    row = conn.execute("SELECT display FROM fx_race_wallet WHERE tenant_id = 1 AND user_id = 'a'").fetchone()
    assert row["display"] == "Alice"
