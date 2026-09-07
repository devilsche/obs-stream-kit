"""Squad-K/D ohne den eigenen Account.

Der eigene Wert steht im Report direkt daneben; ihn in den Squad-Schnitt
zu mischen beantwortet die Frage "wie stark sind meine Mitspieler" nicht.
Gemessen am Match cc64ec49: mit eigenem Wert 1,523, ohne 1,476 — der
eigene Wert zog den Schnitt nach oben, weil er ueber zwei von drei
Mitspielern lag.
"""
import pytest
from pubg.lobby_kd import lobby_average


ME = "account.me"
SQUAD = [ME, "account.a", "account.b", "account.c"]
KDS = {ME: 1.66, "account.a": 1.85, "account.b": 1.32, "account.c": 1.26}


def test_eigener_account_faellt_aus_dem_squad_schnitt():
    r = lobby_average(SQUAD, KDS, exclude={ME})
    assert r["avgKd"] == pytest.approx((1.85 + 1.32 + 1.26) / 3)
    assert r["known"] == 3
    assert r["total"] == 3


def test_ohne_exclude_ist_der_eigene_wert_drin():
    """Gegenprobe, damit der Unterschied belegt bleibt."""
    r = lobby_average(SQUAD, KDS)
    assert r["avgKd"] == pytest.approx((1.66 + 1.85 + 1.32 + 1.26) / 4)


def test_solo_squad_hat_ohne_mich_keinen_wert():
    """Wer allein spielt, hat keine Mitspieler — dann kein Squad-Schnitt."""
    r = lobby_average([ME], KDS, exclude={ME})
    assert r["avgKd"] is None
    assert r["total"] == 0
