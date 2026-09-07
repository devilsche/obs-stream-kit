"""K/D-Formel: Kills pro nicht gewonnener Runde (op.gg-Konvention).

Vorher wurde durch das API-Feld `losses` geteilt. Das Feld ist unstimmig:
fuer PEX_LuCKoR in squad-fpp Season 42 standen 595 Kills, 369 losses, 390
Runden und 32 Wins — 32 + 369 = 401 Niederlagen+Siege bei nur 390 Runden.
Der Nenner war damit zu gross und die K/D rund 3 % zu niedrig.

Gegengerechnet an op.gg:
  PEX_LuCKoR     595 / (390-32) = 1,662   op.gg 1,66
  original_Hat3  353 / (210-19) = 1,848   op.gg 1,84
"""
import pytest
import pubg.lobby_kd as lk


def test_luckor_trifft_opgg():
    assert lk._kd(595, 369, 390, 32) == pytest.approx(595 / 358)
    assert round(lk._kd(595, 369, 390, 32), 2) == 1.66


def test_hat3_trifft_opgg():
    """353/191 = 1,84816. op.gg zeigt 1,84 — schneidet also ab, wo der
    Report mit toFixed(2) auf 1,85 rundet. Der Wert selbst stimmt."""
    kd = lk._kd(353, 199, 210, 19)
    assert kd == pytest.approx(353 / 191)
    assert int(kd * 100) / 100 == 1.84


def test_losses_wird_nicht_mehr_als_nenner_benutzt():
    """Selbst wenn losses voellig daneben liegt, zaehlt rounds-wins."""
    assert lk._kd(100, 9999, 50, 10) == pytest.approx(100 / 40)


def test_alle_runden_gewonnen_faellt_auf_runden_zurueck():
    """Nenner 0 waere eine Division durch Null — dann zaehlen die Runden,
    sonst waere ein Spieler ohne Niederlage rechnerisch unendlich gut."""
    assert lk._kd(20, 0, 5, 5) == pytest.approx(4.0)


def test_ohne_runden_kein_wert():
    assert lk._kd(0, 0, 0, 0) is None


def test_wins_default_null_bedeutet_rounds_als_nenner():
    assert lk._kd(60, 0, 30) == pytest.approx(2.0)


# ── wins muss durch die Summierung durchgereicht werden ────────────────────

def _s(k, l, r, w):
    return {"kills": k, "losses": l, "rounds": r, "wins": w}


def test_sum_modes_summiert_auch_wins():
    kills, losses, rounds, wins = lk._sum_modes(
        {"duo-fpp": _s(100, 50, 60, 5), "squad-fpp": _s(200, 90, 100, 12)},
        ("duo-fpp", "squad-fpp"))
    assert (kills, rounds, wins) == (300, 160, 17)


def test_kd_resolved_nutzt_die_neue_formel():
    r = lk.kd_resolved(
        "squad-fpp",
        current_season={"squad-fpp": _s(595, 369, 390, 32)},
        current_season_id="pc-2018-42")
    assert round(r["kd"], 2) == 1.66
