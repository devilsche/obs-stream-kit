import sqlite3

import pytest

from fx import weather_credit as wcr


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    wcr.init_schema(c)
    yield c
    c.close()


def test_levels():
    assert wcr.parse_level("l1") == 100
    assert wcr.parse_level("L3") == 250
    assert wcr.parse_level("5") == 500
    assert wcr.parse_level("l0") == 0
    assert wcr.parse_level("l9") is None
    assert wcr.parse_level("x") is None


def test_grant_adds_and_spend_takes(conn):
    assert wcr.grant(conn, 1, "@User123", 100, 0) == 100
    assert wcr.grant(conn, 1, "user123", 100, 10) == 200
    assert wcr.spend(conn, 1, "USER123", 250, 20) is None
    assert wcr.spend(conn, 1, "user123", 150, 20) == 50
    assert wcr.balance(conn, 1, "user123", 30) == 50
    assert wcr.balance(conn, 2, "user123", 30) == 0


def test_grant_zero_removes_and_credit_expires(conn):
    wcr.grant(conn, 1, "a", 250, 0)
    wcr.grant(conn, 1, "a", 0, 1)
    assert wcr.balance(conn, 1, "a", 2) == 0
    wcr.grant(conn, 1, "b", 100, 0)
    assert wcr.balance(conn, 1, "b", wcr.TTL - 1) == 100
    assert wcr.balance(conn, 1, "b", wcr.TTL + 1) == 0
