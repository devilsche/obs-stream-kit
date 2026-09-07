"""Ranked-Stats: eigene Datenquelle, eigener Modus-Schluessel.

Ranked und Unranked sind nicht vergleichbar (andere Lobby-Staerke, anderer
Einsatz), deshalb bekommt ein Ranked-Match auch Ranked-Werte. Die API
liefert sie unter einem eigenen Endpoint und nennt den Nenner `deaths`
statt `losses`.
"""
import pytest
import pubg.lobby_kd as lk


def _payload(modes):
    return {"data": {"attributes": {"rankedGameModeStats": modes}}}


def test_parse_liest_ranked_modi():
    p = _payload({
        "squad-fpp": {"kills": 300, "deaths": 150, "roundsPlayed": 160,
                       "wins": 12, "currentTier": {"tier": "Diamond",
                                                    "subTier": "2"},
                       "currentRankPoint": 3450},
        "duo-fpp": {"kills": 40, "deaths": 30, "roundsPlayed": 32, "wins": 2},
    })
    rows = lk.parse_ranked(p)
    assert set(rows) == {"squad-fpp-ranked", "duo-fpp-ranked"}
    sq = rows["squad-fpp-ranked"]
    assert sq["kills"] == 300
    assert sq["rounds"] == 160
    assert sq["wins"] == 12
    # Nenner ist rounds - wins, wie bei den Normal-Werten
    assert sq["kd"] == pytest.approx(300 / 148)


def test_parse_uebernimmt_deaths_als_losses():
    """Die Ranked-Antwort nennt es `deaths`; intern heisst das Feld
    weiterhin losses, damit dieselbe Rechen-Kette greift."""
    rows = lk.parse_ranked(_payload({
        "squad-fpp": {"kills": 10, "deaths": 7, "roundsPlayed": 8, "wins": 1}}))
    assert rows["squad-fpp-ranked"]["losses"] == 7


def test_parse_ignoriert_modi_ohne_runden():
    rows = lk.parse_ranked(_payload({
        "solo-fpp": {"kills": 0, "deaths": 0, "roundsPlayed": 0, "wins": 0}}))
    assert rows == {}


def test_parse_leere_antwort():
    assert lk.parse_ranked({}) == {}
    assert lk.parse_ranked(None) == {}


# ── Modus-Schluessel ────────────────────────────────────────────────────────

def test_ranked_mode_key():
    assert lk.ranked_mode("squad-fpp") == "squad-fpp-ranked"
    assert lk.ranked_mode("duo") == "duo-ranked"
    assert lk.ranked_mode(None) is None


# ── Auswahl: Ranked-Match nimmt Ranked-Werte ────────────────────────────────

def _s(k, l, r, w=0):
    return {"kills": k, "losses": l, "rounds": r, "wins": w}


def test_ranked_match_nimmt_ranked_werte():
    r = lk.kd_resolved(
        "squad-fpp", is_ranked=True,
        current_season={"squad-fpp": _s(100, 50, 60),
                        "squad-fpp-ranked": _s(300, 150, 160, 10)},
        current_season_id="pc-2018-42")
    assert r["kd"] == pytest.approx(300 / 150)
    assert r["basis"] == "squad-fpp-ranked"
    assert r["isRankedValue"] is True


def test_ranked_match_faellt_auf_normal_zurueck_und_kennzeichnet():
    """Ohne Ranked-Daten gilt der Normal-Wert — aber sichtbar als
    Ersatz, nicht als Ranked-Zahl."""
    r = lk.kd_resolved(
        "squad-fpp", is_ranked=True,
        current_season={"squad-fpp": _s(100, 50, 60)},
        current_season_id="pc-2018-42")
    assert r["kd"] == pytest.approx(100 / 60)
    assert r["basis"] == "squad-fpp"
    assert r["isRankedValue"] is False
    assert r["rankedFallback"] is True


def test_unranked_match_ignoriert_ranked_daten():
    """Ranked-Werte haben in einer unranked Lobby nichts zu sagen."""
    r = lk.kd_resolved(
        "squad-fpp", is_ranked=False,
        current_season={"squad-fpp": _s(100, 50, 60),
                        "squad-fpp-ranked": _s(999, 1, 500)},
        current_season_id="pc-2018-42")
    assert r["basis"] == "squad-fpp"
    assert r["isRankedValue"] is False
    assert r["rankedFallback"] is False


def test_ranked_perspektive_als_zweite_stufe():
    """Kein Ranked im gespielten Modus, aber in einem anderen FPP-Modus."""
    r = lk.kd_resolved(
        "squad-fpp", is_ranked=True,
        current_season={"duo-fpp-ranked": _s(120, 60, 70, 5)},
        current_season_id="pc-2018-42")
    assert r["isRankedValue"] is True
    assert r["basis"] == "duo-fpp-ranked"


def test_unranked_ohne_flag_bleibt_wie_vorher():
    """Ohne is_ranked verhaelt sich die Funktion wie bisher."""
    r = lk.kd_resolved("squad-fpp",
                       current_season={"squad-fpp": _s(100, 50, 60)},
                       current_season_id="pc-2018-42")
    assert r["basis"] == "squad-fpp"
    assert r.get("isRankedValue") is False
