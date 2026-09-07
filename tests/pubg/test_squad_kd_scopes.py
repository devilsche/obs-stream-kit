"""Zwei Squad-Werte, zwei Bezugsgruppen.

Festgelegt am 2026-09-07:
  Match Row      -> Team inklusive mir  (squadKd)
  Phase/Session  -> nur die Mitspieler  (squadKdMates)

Vorher speiste ein einziger Wert alle drei Ebenen; ihn auf "ohne mich"
umzustellen nahm den eigenen Wert auch aus der Match Row.
"""
import pytest
from pubg.lobby_kd import lobby_average

ME = "account.me"
SQUAD = [ME, "account.a", "account.b", "account.c"]
KDS = {ME: 1.66, "account.a": 1.85, "account.b": 1.32, "account.c": 1.26}


def test_match_row_rechnet_mich_mit():
    r = lobby_average(SQUAD, KDS)
    assert r["avgKd"] == pytest.approx((1.66 + 1.85 + 1.32 + 1.26) / 4)
    assert r["total"] == 4


def test_header_rechnet_nur_die_mitspieler():
    r = lobby_average(SQUAD, KDS, exclude={ME})
    assert r["avgKd"] == pytest.approx((1.85 + 1.32 + 1.26) / 3)
    assert r["total"] == 3


def test_beide_werte_unterscheiden_sich_messbar():
    """Der gemessene Fall aus Match cc64ec49: 1,523 gegen 1,476."""
    mit = lobby_average(SQUAD, KDS)["avgKd"]
    ohne = lobby_average(SQUAD, KDS, exclude={ME})["avgKd"]
    assert mit > ohne
