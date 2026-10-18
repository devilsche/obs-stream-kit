"""Den K/D-Stand alter Matches aus der Match-Historie zurueckrechnen.

`player_season_snapshot` kennt nur den letzten Stand. Fuer Matches, die
vor dem Einfrieren gespielt wurden, liesse sich damit nur der heutige
Wert festhalten — und der ist falsch: PEX_LuCKoR stand bis zur 20.
Runde der laufenden Season bei 1,66 (Rueckfall auf die Vorsaison) und
sprang erst mit dem Ueberschreiten von MIN_KD_ROUNDS auf 2,33.

Die Match-Historie erlaubt die exakte Rekonstruktion: Kills, Runden und
Siege bis zu einem Zeitpunkt aufsummieren ergibt genau den Stand, den
die API damals geliefert haette.
"""
import pytest

from pubg import db_pg


CONN = None
T = None
ICH = "account.A"
MATE = "account.B"


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def _match(mid, played_at, kills=0, place=10, mode="squad-fpp",
           mates=(MATE,)):
    db_pg.insert_match(CONN.raw, T, mid, "Baltic_Main", mode, False,
                       1800, played_at, None)
    reihen = [{"account_id": ICH, "team_id": 1, "kills": kills,
               "place": place, "name": "PEX_LuCKoR"}]
    mapping = [{"account_id": ICH, "team_id": 1}]
    for m in mates:
        reihen.append({"account_id": m, "team_id": 1, "kills": 1,
                       "place": place, "name": "Mate1"})
        mapping.append({"account_id": m, "team_id": 1})
    db_pg.insert_participants(CONN.raw, T, mid, reihen)
    db_pg.insert_team_mapping(CONN.raw, T, mid, mapping)
    db_pg.upsert_player(CONN.raw, T, ICH, "PEX_LuCKoR", "steam", 1)
    for m in mates:
        db_pg.upsert_player(CONN.raw, T, m, "Mate1", "steam", 0)
    CONN.raw.commit()


def test_season_grenzen_aus_den_snapshots():
    """Wann eine Season anfing, verraet der erste Snapshot dazu."""
    from pubg.kd_rekonstruktion import season_grenzen
    db_pg.upsert_season_snapshots(CONN.raw, "div.42", "squad-fpp",
                                  {ICH: {"kills": 1, "rounds": 1, "wins": 0}},
                                  "2026-08-01T00:00:00Z")
    db_pg.upsert_season_snapshots(CONN.raw, "div.43", "squad-fpp",
                                  {ICH: {"kills": 1, "rounds": 1, "wins": 0}},
                                  "2026-09-10T02:40:00Z")
    CONN.raw.commit()
    g = season_grenzen(CONN.raw)
    assert [s for s, _ in g] == ["div.43", "div.42"]
    assert g[0][1] == "2026-09-10T02:40:00Z"
    # Die aelteste Season ist nach hinten offen — sonst faenden Matches
    # von vor der ersten Sammlung keine Season.
    assert g[-1][1] is None


def test_season_fuer_einen_zeitpunkt():
    from pubg.kd_rekonstruktion import season_fuer
    g = [("div.43", "2026-09-10T02:40:00Z"), ("div.42", None)]
    assert season_fuer(g, "2026-09-20T18:00:00Z") == "div.43"
    assert season_fuer(g, "2026-09-01T18:00:00Z") == "div.42"
    assert season_fuer(g, "2026-09-10T02:40:00Z") == "div.43"


def test_season_stand_summiert_die_matches_davor():
    """Der Kern: Kills und Runden bis zum Match, nicht bis heute."""
    from pubg.kd_rekonstruktion import season_stand_vor
    _match("m1", "2026-09-10T17:00:00Z", kills=2, place=5)
    _match("m2", "2026-09-10T18:00:00Z", kills=3, place=1)   # Sieg
    _match("m3", "2026-09-10T19:00:00Z", kills=9, place=3)
    stand = season_stand_vor(CONN, T, [ICH], "2026-09-10T02:40:00Z",
                             "2026-09-10T19:00:00Z")
    sq = stand[ICH]["squad-fpp"]
    assert sq["rounds"] == 2 and sq["kills"] == 5 and sq["wins"] == 1
    # Das Match selbst zaehlt nicht mit: gefragt ist, wie stark er in
    # diese Runde ging.
    assert sq["kills"] != 14


def test_stand_trennt_die_modi():
    from pubg.kd_rekonstruktion import season_stand_vor
    _match("m1", "2026-09-10T17:00:00Z", kills=4, mode="squad-fpp")
    _match("m2", "2026-09-10T18:00:00Z", kills=7, mode="duo-fpp")
    stand = season_stand_vor(CONN, T, [ICH], None,
                             "2026-09-10T19:00:00Z")
    assert stand[ICH]["squad-fpp"]["kills"] == 4
    assert stand[ICH]["duo-fpp"]["kills"] == 7


def test_lifetime_wird_um_die_spaeteren_matches_zurueckgerechnet():
    """Der Lifetime-Snapshot ist von heute — die Matches seit dem Match
    muessen wieder abgezogen werden."""
    from pubg.kd_rekonstruktion import lifetime_stand_vor
    _match("m1", "2026-09-10T17:00:00Z", kills=2, place=5)
    _match("m2", "2026-09-20T18:00:00Z", kills=6, place=1)
    db_pg.upsert_season_snapshots(
        CONN.raw, "lifetime", "squad-fpp",
        {ICH: {"kills": 1000, "rounds": 500, "wins": 40}},
        "2026-09-21T00:00:00Z")
    CONN.raw.commit()
    st = lifetime_stand_vor(CONN, T, [ICH], "2026-09-20T18:00:00Z")
    sq = st[ICH]["squad-fpp"]
    # m2 liegt nach dem Stichtag und wird abgezogen, m1 bleibt drin.
    assert sq["kills"] == 994 and sq["rounds"] == 499 and sq["wins"] == 39


def test_lifetime_bleibt_ohne_snapshot_leer():
    from pubg.kd_rekonstruktion import lifetime_stand_vor
    _match("m1", "2026-09-10T17:00:00Z", kills=2)
    assert lifetime_stand_vor(CONN, T, [ICH], "2026-09-20T00:00:00Z") == {}


def test_kd_vor_match_faellt_auf_die_vorsaison_zurueck():
    """Der gemessene Fall: unter MIN_KD_ROUNDS gilt die Vorsaison."""
    from pubg.kd_rekonstruktion import kd_vor_match
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.42", "squad-fpp",
        {ICH: {"kills": 595, "rounds": 390, "wins": 32}},
        "2026-08-01T00:00:00Z")
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.43", "squad-fpp",
        {ICH: {"kills": 56, "rounds": 26, "wins": 2}},
        "2026-09-10T02:40:00Z")
    CONN.raw.commit()
    # Erste Runde der neuen Season — davor null Runden darin.
    _match("m1", "2026-09-10T17:00:00Z", kills=2, mates=())
    eintraege = {e["account_id"]: e
                 for e in kd_vor_match(CONN, T, "m1")}
    e = eintraege[ICH]
    assert round(e["kd"], 2) == 1.66, "Vorsaison 595/(390-32)"
    assert e["season_id"] == "div.42"


def test_kd_vor_match_nimmt_die_laufende_season_sobald_sie_traegt():
    from pubg.kd_rekonstruktion import kd_vor_match
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.42", "squad-fpp",
        {ICH: {"kills": 595, "rounds": 390, "wins": 32}},
        "2026-08-01T00:00:00Z")
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.43", "squad-fpp",
        {ICH: {"kills": 56, "rounds": 26, "wins": 2}},
        "2026-09-10T02:40:00Z")
    CONN.raw.commit()
    # 20 Runden der neuen Season vor dem Stichmatch — ab hier traegt sie.
    for i in range(20):
        _match(f"v{i}", f"2026-09-10T1{i//10}:{i%10:02d}:00Z", kills=2,
               place=(1 if i == 0 else 8), mates=())
    _match("m1", "2026-09-11T20:00:00Z", kills=3, mates=())
    e = {x["account_id"]: x for x in kd_vor_match(CONN, T, "m1")}[ICH]
    # 40 Kills, 20 Runden, 1 Sieg -> 40 / 19
    assert round(e["kd"], 2) == 2.11
    assert e["season_id"] == "div.43"


def test_backfill_schreibt_nur_fehlende_matches():
    from pubg.kd_rekonstruktion import backfill
    from pubg.db_pg import save_match_player_kd, get_match_player_kd
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.42", "squad-fpp",
        {ICH: {"kills": 595, "rounds": 390, "wins": 32},
         MATE: {"kills": 100, "rounds": 100, "wins": 5}},
        "2026-08-01T00:00:00Z")
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.43", "squad-fpp",
        {ICH: {"kills": 0, "rounds": 0, "wins": 0}},
        "2026-09-10T02:40:00Z")
    CONN.raw.commit()
    _match("m1", "2026-09-10T17:00:00Z", kills=2)
    _match("m2", "2026-09-10T18:00:00Z", kills=3)
    # m2 ist schon eingefroren und darf sich nicht aendern.
    save_match_player_kd(CONN.raw, "m2", [
        {"account_id": ICH, "mode": "squad-fpp", "kd": 9.99, "rounds": 1,
         "source": "season", "season_id": "div.42"}],
        "2026-09-20T00:00:00Z")
    CONN.raw.commit()
    n = backfill(CONN, T)
    assert n == 1, "nur m1"
    d = get_match_player_kd(CONN.raw, ["m1", "m2"])
    assert round(d["m1"][ICH]["kd"], 2) == 1.66
    assert d["m2"][ICH]["kd"] == 9.99
    # Der Mitspieler kommt mit — auch fuer ihn gilt der Stand von damals.
    assert MATE in d["m1"]


def test_backfill_laesst_gegner_aussen_vor():
    from pubg.kd_rekonstruktion import backfill
    from pubg.db_pg import get_match_player_kd
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.42", "squad-fpp",
        {ICH: {"kills": 595, "rounds": 390, "wins": 32}},
        "2026-08-01T00:00:00Z")
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.43", "squad-fpp",
        {ICH: {"kills": 0, "rounds": 0, "wins": 0}},
        "2026-09-10T02:40:00Z")
    CONN.raw.commit()
    _match("m1", "2026-09-10T17:00:00Z", kills=2)
    db_pg.insert_team_mapping(CONN.raw, T, "m1",
                              [{"account_id": "account.GEGNER",
                                "team_id": 9}])
    CONN.raw.commit()
    backfill(CONN, T)
    assert "account.GEGNER" not in get_match_player_kd(CONN.raw, ["m1"])["m1"]


def test_ohne_season_daten_zaehlt_der_zurueckgedrehte_lifetime():
    """Matches von vor der ersten Sammlung: Season unbekannt, aber der
    Lifetime-Stand laesst sich exakt zurueckrechnen."""
    from pubg.kd_rekonstruktion import kd_vor_match
    _match("alt", "2026-04-20T17:00:00Z", kills=2, mates=())
    _match("neu", "2026-09-20T17:00:00Z", kills=8, place=1, mates=())
    db_pg.upsert_season_snapshots(
        CONN.raw, "lifetime", "squad-fpp",
        {ICH: {"kills": 1000, "rounds": 500, "wins": 40}},
        "2026-09-21T00:00:00Z")
    CONN.raw.commit()
    e = {x["account_id"]: x for x in kd_vor_match(CONN, T, "alt")}[ICH]
    # Beide Matches liegen nach dem Stichtag und gehen wieder raus:
    # 990 Kills, 498 Runden, 39 Siege -> 990 / 459
    assert round(e["kd"], 3) == round(990 / 459, 3)
    assert e["source"] == "lifetime"


# --- Mitspieler: Season-Stand aus der API, nicht aus "Matches mit uns" ---
#
# Gemessener Fall (15.10.): Nipplz hatte laut API ~100 Season-Runden in
# squad-fpp, unsere Historie kannte davon 17 — die mit uns. Gezaehlt wurde
# die 17, die 20-Runden-Schwelle griff, eingefroren wurde die Vorsaison.

def _mate_matches(n, start_tag=11, kills=2, place=8, ranked=False):
    """n gemeinsame Matches ab dem 11.09., je eins pro Stunde."""
    for i in range(n):
        mid = f"g{'r' if ranked else ''}{i}"
        _match(mid, f"2026-09-{start_tag + i // 24:02d}T{i % 24:02d}:00:00Z",
               kills=kills, place=place)
        if ranked:
            CONN.raw.cursor().execute(
                "UPDATE matches SET is_ranked = 1 WHERE match_id = %s",
                (mid,))
    CONN.raw.commit()


def _seasons_fuer_mate(s43, fetched="2026-09-30T00:00:00Z"):
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.42", "squad-fpp",
        {MATE: {"kills": 226, "rounds": 71, "wins": 13}},
        "2026-08-01T00:00:00Z")
    # Season-Grenze: der erste div.43-Snapshot (von irgendwem) am 10.09.
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.43", "duo-fpp",
        {ICH: {"kills": 0, "rounds": 0, "wins": 0}},
        "2026-09-10T02:40:00Z")
    if s43:
        db_pg.upsert_season_snapshots(CONN.raw, "div.43", "squad-fpp",
                                      {MATE: s43}, fetched)
    CONN.raw.commit()


def test_mitspieler_season_runden_kommen_aus_der_api():
    """100 Season-Runden laut API, 15 davon mit uns: die Season traegt."""
    from pubg.kd_rekonstruktion import kd_vor_match
    _mate_matches(15)
    _seasons_fuer_mate({"kills": 420, "rounds": 100, "wins": 24})
    e = {x["account_id"]: x for x in kd_vor_match(CONN, T, "g10")}[MATE]
    assert e["season_id"] == "div.43", "nicht auf die Vorsaison zurueck"
    # g10..g14 liegen ab dem Stichmatch und werden abgezogen: je 1 Kill,
    # 1 Runde, kein Sieg -> 415 Kills, 95 Runden, 24 Siege.
    assert e["rounds"] == 95
    assert e["kd"] == pytest.approx(415 / 71, abs=1e-4)


def test_mitspieler_kd_nicht_aus_den_gemeinsamen_runden():
    """Auch wenn die gemeinsamen Runden selbst 20 erreichen, zaehlt der
    API-Stand — nicht die K/D aus den Runden mit uns."""
    from pubg.kd_rekonstruktion import kd_vor_match
    _mate_matches(22)
    _seasons_fuer_mate({"kills": 300, "rounds": 102, "wins": 24})
    e = {x["account_id"]: x for x in kd_vor_match(CONN, T, "g21")}[MATE]
    assert e["rounds"] == 101
    assert e["kd"] == pytest.approx(299 / 77, abs=1e-4)


def test_mitspieler_ohne_season_snapshot_faellt_zurueck():
    """Ohne API-Stand gibt es keine Season-Zahl — die gemeinsamen Runden
    sind kein Ersatz dafuer."""
    from pubg.kd_rekonstruktion import kd_vor_match
    _mate_matches(25)
    _seasons_fuer_mate(None)
    e = {x["account_id"]: x for x in kd_vor_match(CONN, T, "g24")}[MATE]
    assert e["season_id"] == "div.42"


def test_matches_nach_dem_abruf_werden_nicht_abgezogen():
    """Was nach dem Snapshot gespielt wurde, steckt nicht darin."""
    from pubg.kd_rekonstruktion import kd_vor_match
    _mate_matches(15)
    # Abruf am 11.09. um 12:00 — g12..g14 kamen danach.
    _seasons_fuer_mate({"kills": 420, "rounds": 100, "wins": 24},
                       fetched="2026-09-11T12:00:00Z")
    e = {x["account_id"]: x for x in kd_vor_match(CONN, T, "g10")}[MATE]
    assert e["rounds"] == 98, "nur g10 und g11 lagen vor dem Abruf"


def test_ranked_match_zaehlt_nicht_in_den_normal_modus():
    from pubg.kd_rekonstruktion import lifetime_stand_vor
    _mate_matches(3, ranked=True)
    db_pg.upsert_season_snapshots(
        CONN.raw, "lifetime", "squad-fpp",
        {MATE: {"kills": 1000, "rounds": 500, "wins": 40}},
        "2026-09-30T00:00:00Z")
    db_pg.upsert_season_snapshots(
        CONN.raw, "lifetime", "squad-fpp-ranked",
        {MATE: {"kills": 100, "rounds": 50, "wins": 4, "losses": 46}},
        "2026-09-30T00:00:00Z")
    CONN.raw.commit()
    st = lifetime_stand_vor(CONN, T, [MATE], "2026-09-01T00:00:00Z")
    assert st[MATE]["squad-fpp"]["rounds"] == 500
    assert st[MATE]["squad-fpp-ranked"]["rounds"] == 47


def test_neu_berechnen_ueberschreibt_den_falschen_stand():
    from pubg.kd_rekonstruktion import neu_berechnen
    from pubg.db_pg import save_match_player_kd, get_match_player_kd
    _mate_matches(15)
    _seasons_fuer_mate({"kills": 420, "rounds": 100, "wins": 24})
    # So wurde es bisher eingefroren: Vorsaison, weil 10 < 20.
    save_match_player_kd(CONN.raw, "g10", [
        {"account_id": MATE, "mode": "squad-fpp", "kd": 3.897,
         "rounds": 71, "source": "season", "season_id": "div.42"}],
        "2026-09-11T10:30:00Z")
    assert neu_berechnen(CONN, T, "2026-09-11T00:00:00Z") == 15
    eintrag = get_match_player_kd(CONN.raw, ["g10"])["g10"][MATE]
    assert eintrag["seasonId"] == "div.43"


# --- Stand nach dem Match: das Match selbst zaehlt mit ---

def test_nach_dem_match_zaehlt_das_match_mit():
    from pubg.kd_rekonstruktion import kd_vor_match
    _seasons_fuer_mate({"kills": 420, "rounds": 100, "wins": 24})
    _mate_matches(15)
    vor = {x["account_id"]: x for x in kd_vor_match(CONN, T, "g10")}[MATE]
    nach = {x["account_id"]: x
            for x in kd_vor_match(CONN, T, "g10", nach=True)}[MATE]
    assert nach["rounds"] == vor["rounds"] + 1


def test_zwanzigste_runde_schaltet_nach_dem_match_auf_die_season():
    """Mit dem Match, das die 20. Season-Runde ist, gilt danach schon die
    neue Season — davor noch die alte."""
    from pubg.kd_rekonstruktion import kd_vor_match
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.42", "squad-fpp",
        {ICH: {"kills": 595, "rounds": 390, "wins": 32}},
        "2026-08-01T00:00:00Z")
    db_pg.upsert_season_snapshots(
        CONN.raw, "div.43", "squad-fpp",
        {ICH: {"kills": 56, "rounds": 26, "wins": 2}},
        "2026-09-10T02:40:00Z")
    CONN.raw.commit()
    for i in range(19):
        _match(f"v{i}", f"2026-09-10T1{i//10}:{i%10:02d}:00Z", kills=2,
               mates=())
    _match("m20", "2026-09-11T20:00:00Z", kills=3, mates=())
    vor = {x["account_id"]: x for x in kd_vor_match(CONN, T, "m20")}[ICH]
    nach = {x["account_id"]: x
            for x in kd_vor_match(CONN, T, "m20", nach=True)}[ICH]
    assert vor["season_id"] == "div.42"
    assert nach["season_id"] == "div.43" and nach["rounds"] == 20


def test_gespeichert_wird_beides_und_nach_ist_der_standard():
    from pubg.kd_rekonstruktion import kd_eintraege
    from pubg.db_pg import save_match_player_kd, get_match_player_kd
    _seasons_fuer_mate({"kills": 420, "rounds": 100, "wins": 24})
    _mate_matches(15)
    save_match_player_kd(CONN.raw, "g10", kd_eintraege(CONN, T, "g10"),
                         "2026-09-30T00:00:00Z")
    nach = get_match_player_kd(CONN.raw, ["g10"])["g10"][MATE]
    vor = get_match_player_kd(CONN.raw, ["g10"], stand="vor")["g10"][MATE]
    assert nach["stand"] == "nach" and vor["stand"] == "vor"
    assert nach["rounds"] == vor["rounds"] + 1


def test_alter_eintrag_ohne_nach_stand_faellt_auf_vor_zurueck():
    from pubg.db_pg import save_match_player_kd, get_match_player_kd
    _mate_matches(1)
    save_match_player_kd(CONN.raw, "g0", [
        {"account_id": MATE, "mode": "squad-fpp", "kd": 2.0, "rounds": 50,
         "source": "season", "season_id": "div.43"}],
        "2026-09-30T00:00:00Z")
    v = get_match_player_kd(CONN.raw, ["g0"])["g0"][MATE]
    assert v["kd"] == 2.0 and v["stand"] == "vor"
