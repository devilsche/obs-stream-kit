"""Reihenfolge der K/D-Quellen, wie sie am 2026-09-07 festgelegt wurde.

  1. aktueller Modus, aktuelle Season
  2. aktueller Modus, letzte bekannte Season
  3. aktueller Modus, Lifetime
  4. POV (FPP bzw. TPP), aktuelle Season
  5. POV, Lifetime
  6. alle Modi, Lifetime

Vorher lief es andersherum: Lifetime hatte Vorrang, Season war nur
Ersatzquelle, und "letzte bekannte Season" gab es gar nicht.
"""
import pytest
import pubg.lobby_kd as lk


def _s(k, l, r):
    return {"kills": k, "losses": l, "rounds": r}


# ── Stufe 1: aktueller Modus, aktuelle Season ───────────────────────────────

def test_1_aktuelle_season_im_modus_schlaegt_alles():
    r = lk.kd_resolved(
        "duo-fpp",
        current_season={"duo-fpp": _s(100, 50, 60)},
        last_seasons=[("pc-2018-41", {"duo-fpp": _s(1, 50, 60)})],
        lifetime={"duo-fpp": _s(2, 50, 60)},
        current_season_id="pc-2018-42")
    assert r["kd"] == pytest.approx(100 / 60)   # Nenner = rounds - wins
    assert r["source"] == "season"
    assert r["seasonId"] == "pc-2018-42"
    assert r["basis"] == "duo-fpp"


# ── Stufe 2: aktueller Modus, letzte bekannte Season ────────────────────────

def test_2_letzte_season_kommt_vor_lifetime():
    """Aktuelle Season hat im Modus nichts, die vorige schon — die zaehlt,
    noch bevor Lifetime dran ist."""
    r = lk.kd_resolved(
        "duo-fpp",
        current_season=None,
        last_seasons=[("pc-2018-41", {"duo-fpp": _s(80, 40, 45)})],
        lifetime={"duo-fpp": _s(2, 50, 60)},
        current_season_id="pc-2018-42")
    assert r["kd"] == pytest.approx(80 / 45)
    assert r["source"] == "season"
    assert r["seasonId"] == "pc-2018-41"


# ── Stufe 3: aktueller Modus, Lifetime ──────────────────────────────────────

def test_3_lifetime_im_modus_wenn_keine_season_daten():
    r = lk.kd_resolved(
        "duo-fpp",
        lifetime={"duo-fpp": _s(60, 30, 35)})
    assert r["kd"] == pytest.approx(60 / 35)
    assert r["source"] == "lifetime"
    assert r["seasonId"] is None


def test_3_schlaegt_die_pov_stufen():
    """Der exakte Modus aus Lifetime gewinnt gegen POV aus der Season —
    Modus-Genauigkeit vor Aktualitaet."""
    r = lk.kd_resolved(
        "duo-fpp",
        current_season={"squad-fpp": _s(200, 50, 300)},
        lifetime={"duo-fpp": _s(60, 30, 35)},
        current_season_id="pc-2018-42")
    assert r["source"] == "lifetime"
    assert r["basis"] == "duo-fpp"


# ── Stufe 4: POV, aktuelle Season ───────────────────────────────────────────

def test_4_pov_aus_der_aktuellen_season():
    """Im Modus reicht es nirgends, aber die FPP-Summe der Season traegt."""
    r = lk.kd_resolved(
        "duo-fpp",
        current_season={"squad-fpp": _s(120, 60, 70)},
        lifetime={"squad": _s(500, 5, 6)},
        current_season_id="pc-2018-42")
    assert r["kd"] == pytest.approx(120 / 70)
    assert r["source"] == "season"
    assert r["basis"] == "squad-fpp"   # Gruppe besteht nur daraus


def test_4_letzte_season_wird_auf_pov_ebene_NICHT_geprueft():
    """Bewusst so festgelegt: auf POV-Ebene gibt es keine 'letzte Season'.
    Der Wert kommt dann aus Lifetime (Stufe 5)."""
    r = lk.kd_resolved(
        "duo-fpp",
        last_seasons=[("pc-2018-41", {"squad-fpp": _s(999, 3, 70)})],
        lifetime={"solo-fpp": _s(60, 30, 35)},
        current_season_id="pc-2018-42")
    assert r["source"] == "lifetime"
    assert r["basis"] == "solo-fpp"


# ── Stufe 5: POV, Lifetime ──────────────────────────────────────────────────

def test_5_pov_aus_lifetime():
    r = lk.kd_resolved(
        "duo-fpp",
        lifetime={"squad-fpp": _s(90, 45, 50), "solo-fpp": _s(30, 15, 20)})
    assert r["source"] == "lifetime"
    assert r["basis"] == "fpp"
    assert r["kd"] == pytest.approx(120 / 70)   # 50 + 20 Runden


# ── Stufe 6: alle Modi, Lifetime ────────────────────────────────────────────

def test_6_alle_modi_aus_lifetime_als_letzte_stufe():
    """TPP-Runden fuer ein FPP-Match: erst auf der letzten Stufe zaehlen
    sie mit, und dort ohne Anteils-Regel."""
    r = lk.kd_resolved(
        "duo-fpp",
        lifetime={"squad": _s(24, 12, 12)})
    assert r["source"] == "lifetime"
    assert r["basis"] == "squad"
    assert r["kd"] == pytest.approx(2.0)


def test_6_season_wird_auf_der_letzten_stufe_NICHT_geprueft():
    """Bewusst so festgelegt: 'alle Modi' gibt es nur aus Lifetime."""
    r = lk.kd_resolved(
        "duo-fpp",
        current_season={"squad": _s(24, 12, 12)},
        current_season_id="pc-2018-42")
    assert r["kd"] is None
    assert r["source"] is None


# ── Schwellen bleiben ───────────────────────────────────────────────────────

def test_zu_duenne_stufe_wird_uebersprungen():
    """19 Runden im Modus reichen nicht (MIN_KD_ROUNDS=20), die
    Lifetime-Gesamtstufe traegt dann."""
    r = lk.kd_resolved(
        "duo-fpp",
        current_season={"duo-fpp": _s(5, 19, 19)},
        lifetime={"duo-fpp": _s(5, 19, 19), "squad": _s(30, 15, 15)})
    assert r["source"] == "lifetime"
    assert r["basis"] == "all"


def test_ohne_jede_quelle_kein_wert():
    r = lk.kd_resolved("duo-fpp")
    assert r["kd"] is None
    assert r["source"] is None
    assert r["seasonId"] is None


# ── Stufe 2 im Detail: rueckwaerts durch ALLE Seasons ───────────────────────

def test_2_geht_rueckwaerts_bis_eine_season_genug_runden_hat():
    """Nicht nur die letzte Season: reicht die auch nicht, wird weiter
    zurueckgegangen, bis eine im Modus ueber MIN_KD_ROUNDS liegt."""
    r = lk.kd_resolved(
        "duo-fpp",
        current_season={"duo-fpp": _s(3, 5, 5)},          # zu duenn
        last_seasons=[
            ("pc-2018-41", {"duo-fpp": _s(4, 8, 8)}),     # zu duenn
            ("pc-2018-40", {"duo-fpp": _s(90, 45, 50)}),  # traegt
            ("pc-2018-39", {"duo-fpp": _s(10, 5, 999)}),  # nicht mehr geprueft
        ],
        lifetime={"duo-fpp": _s(1, 100, 100)},
        current_season_id="pc-2018-42")
    assert r["kd"] == pytest.approx(90 / 50)
    assert r["source"] == "season"
    assert r["seasonId"] == "pc-2018-40"


def test_2_wenn_keine_season_reicht_kommt_lifetime():
    """Alle Seasons unter 20 Runden im Modus → Stufe 3."""
    r = lk.kd_resolved(
        "duo-fpp",
        current_season={"duo-fpp": _s(3, 5, 5)},
        last_seasons=[
            ("pc-2018-41", {"duo-fpp": _s(4, 8, 8)}),
            ("pc-2018-40", {"duo-fpp": _s(2, 9, 9)}),
        ],
        lifetime={"duo-fpp": _s(60, 30, 35)},
        current_season_id="pc-2018-42")
    assert r["source"] == "lifetime"
    assert r["kd"] == pytest.approx(60 / 35)
    assert r["seasonId"] is None


# ── Stichprobe im Verhaeltnis zur Karriere ──────────────────────────────────

def test_lifetime_runden_werden_mitgeliefert():
    """Damit im Report "230/4000 Runden" stehen kann: die Runden der
    verwendeten Stufe neben den Lifetime-Runden DERSELBEN Ebene — hier
    also duo-fpp, nicht die Karriere ueber alle Modi."""
    r = lk.kd_resolved(
        "duo-fpp",
        current_season={"duo-fpp": _s(300, 200, 230)},
        lifetime={"duo-fpp": _s(4000, 3000, 4000),
                  "squad-fpp": _s(2000, 1500, 3000)},
        current_season_id="pc-2018-42")
    assert r["source"] == "season"
    assert r["rounds"] == 230
    assert r["lifetimeRounds"] == 4000


def test_lifetime_runden_auch_bei_lifetime_quelle():
    r = lk.kd_resolved(
        "duo-fpp",
        lifetime={"duo-fpp": _s(4000, 3000, 4000),
                  "squad-fpp": _s(2000, 1500, 3000)})
    assert r["source"] == "lifetime"
    assert r["rounds"] == 4000
    assert r["lifetimeRounds"] == 4000


def test_lifetime_runden_null_ohne_lifetime_daten():
    r = lk.kd_resolved(
        "duo-fpp",
        current_season={"duo-fpp": _s(30, 20, 25)},
        current_season_id="pc-2018-42")
    assert r["lifetimeRounds"] == 0
