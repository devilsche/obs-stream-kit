"""Longest-Kill-Tiers: der API-Wert ist in METERN.

Regression zu einem Bug, der in 1104 Matches jedes Longest-Kill-Achievement
unterdrueckt hat: die Umrechnung nahm an, der Wert komme in
Telemetrie-Einheiten (100 = 1 m), und teilte alles ab 50 durch 100. Aus
619,7 m wurden 6,2 m — longest_kill_400 und _600 konnten nie ausloesen,
obwohl 12 Matches ueber 400 m und einer ueber 600 m lagen.
"""
import pubg.aggregations as agg


def _tier_ids(longest_value):
    """Welche Tier-IDs faellt der Wert durch die Kaskade?"""
    out, seen = [], set()
    m = agg._longest_kill_meters(longest_value)
    agg._emit_tier_cascade(out, seen, agg.LONGEST_KILL_TIERS, int(m),
                           lambda v: f"{v}m", "match-1", "2026-09-06T00:00:00Z")
    return {a["id"] for a in out}


def test_619m_loest_400er_und_600er_aus():
    """Der gemessene Fall: 619,7 m aus der API."""
    assert _tier_ids(619.7) == {"longest_kill_400", "longest_kill_600"}


def test_450m_loest_nur_den_400er_aus():
    assert _tier_ids(450.0) == {"longest_kill_400"}


def test_unter_400m_loest_nichts_aus():
    assert _tier_ids(399.9) == set()


def test_meterwert_wird_nicht_durch_100_geteilt():
    """Kern des Bugs: 619,7 darf nicht zu 6,197 werden."""
    assert agg._longest_kill_meters(619.7) == 619.7
    assert agg._longest_kill_meters(84.4) == 84.4


def test_zentimeterwert_wird_umgerechnet():
    """Schutz fuer versehentlich in Telemetrie-Einheiten gespeicherte
    Werte: ueber 2000 kann kein Kill liegen."""
    assert agg._longest_kill_meters(61970.0) == 619.7


def test_null_bleibt_null():
    assert agg._longest_kill_meters(0) == 0
    assert agg._longest_kill_meters(None) == 0
