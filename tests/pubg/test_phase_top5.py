"""Top-5 einer Phase: die fuenf staerksten Spieler der Phase.

Vorher wurde je Match ein Top-5-Mittel gebildet und diese Mittel dann
ueber die Matches gemittelt. Ergebnis: 3,27 fuer eine Phase, in der die
fuenf staerksten Gegner alle ueber 5,0 lagen — jeder von ihnen tauchte
nur in einem Match auf und wurde dort mit vier Schwaecheren verrechnet.
"""
import pytest
from pubg.lobby_kd import phase_top5


def test_staerkste_der_phase_ueber_matches_hinweg():
    """Fuenf Spieler mit ueber 5,0, verteilt auf drei Matches: der
    Phasen-Wert liegt ueber 5, nicht bei 3,3."""
    per_match = [
        [("a", 6.0), ("x", 1.0), ("y", 1.0)],
        [("b", 5.8), ("c", 5.5), ("z", 0.9)],
        [("d", 5.2), ("e", 5.1), ("w", 1.2)],
    ]
    assert phase_top5(per_match) == pytest.approx(
        (6.0 + 5.8 + 5.5 + 5.2 + 5.1) / 5)


def test_derselbe_spieler_zaehlt_nur_einmal():
    """Wer in jedem Match der Phase sass, darf die Top-5 nicht fuellen."""
    per_match = [
        [("a", 6.0), ("b", 2.0)],
        [("a", 6.0), ("c", 1.9)],
        [("a", 6.0), ("d", 1.8)],
    ]
    assert phase_top5(per_match) == pytest.approx(
        (6.0 + 2.0 + 1.9 + 1.8) / 4)


def test_bei_mehreren_werten_gilt_der_hoechste():
    """In gemischten Phasen (duo + squad) kann derselbe Spieler je Modus
    einen anderen Wert haben."""
    per_match = [[("a", 3.0)], [("a", 4.5)]]
    assert phase_top5(per_match) == pytest.approx(4.5)


def test_weniger_als_fuenf_spieler():
    assert phase_top5([[("a", 2.0), ("b", 1.0)]]) == pytest.approx(1.5)


def test_ohne_spieler_kein_wert():
    assert phase_top5([]) is None
    assert phase_top5([[]]) is None
