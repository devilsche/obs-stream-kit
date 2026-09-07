"""Welche Perspektiv-Gruppe gilt fuer einen Spielmodus.

`mode.endswith("-fpp")` traf bei den Event-Modi nicht: TDM ist ein reiner
FPP-Modus, landete aber in der TPP-Gruppe und fiel von dort auf "all modes"
durch — im Report stand hinter einem TDM-Wert "all modes lifetime".
"""
import pubg.lobby_kd as lk


def test_fpp_modi():
    for m in ("solo-fpp", "duo-fpp", "squad-fpp"):
        assert lk.perspective_modes(m) == lk.FPP_MODES, m


def test_tpp_modi():
    for m in ("solo", "duo", "squad"):
        assert lk.perspective_modes(m) == lk.TPP_MODES, m


def test_tdm_ist_fpp():
    """TDM/Arena gibt es in PUBG nur in First Person."""
    assert lk.perspective_modes("tdm") == lk.FPP_MODES


def test_unbekannter_event_modus_hat_keine_perspektive():
    """Lieber keine Gruppe als die falsche — dann greift direkt die
    Gesamtstufe."""
    assert lk.perspective_modes("heistroyale") is None
    assert lk.perspective_modes("") is None
    assert lk.perspective_modes(None) is None


def test_tdm_faellt_nicht_mehr_auf_alle_modi():
    """Ein Spieler mit FPP-Runden bekommt in TDM die FPP-Summe, nicht
    'all modes'."""
    per = {"squad-fpp": {"kills": 200, "losses": 100, "rounds": 120, "wins": 10},
           "squad": {"kills": 5, "losses": 4, "rounds": 4, "wins": 0}}
    r = lk.kd_for_mode(per, "tdm")
    assert r["basis"] == "squad-fpp"      # FPP-Gruppe, auf den Modus verengt
