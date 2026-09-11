"""Erfassung des Lobby-Rekords im Poller.

Zwei Fallen: der Alltime-Rekord muss beim ersten Mal über **alle**
Matches gerechnet werden (sonst ist der „Rekord" nur das Maximum der
letzten Woche, und das nächste gute Match feiert einen Rekord, der
keiner ist), und winzige Arcade-Lobbys dürfen nicht gewinnen — eine
Runde mit vier Spielern stand auf prod bei K/D 8,3.

`hardest_lobby` liefert `(wert, match_id)` — die Id nur, wenn ein neuer
Bestwert dabei ist, denn nur dann gibt es Begleitzahlen festzuhalten.
"""
from unittest.mock import patch

import pytest

from pubg import db_pg
from pubg.poller import LOBBY_RECORD_WINDOW, hardest_lobby

ME = "account.A"


@pytest.fixture
def matches(pg_compat):
    conn, t1, _ = pg_compat
    db_pg.upsert_player(conn.raw, t1, ME, "PEX_LuCKoR", "steam", 1)
    for i in range(40):
        mid = f"m{i:02d}"
        db_pg.insert_match(conn.raw, t1, mid, "Baltic_Main", "squad-fpp",
                           False, 1800, f"2026-08-{i % 28 + 1:02d}T12:00:00Z",
                           None)
        db_pg.insert_participants(conn.raw, t1, mid, [{
            "account_id": ME, "name": "PEX_LuCKoR", "team_id": 1,
            "place": 5, "kills": 1, "headshot_kills": 0, "assists": 0,
            "dbnos": 0, "revives": 0, "damage_dealt": 100.0,
            "longest_kill": 0.0, "time_survived": 600,
            "walk_distance": 0.0, "ride_distance": 0.0,
            "swim_distance": 0.0, "weapons_acquired": 1, "heals": 0,
            "boosts": 0, "team_kills": 0}])
    conn.raw.commit()
    return conn, t1


def _antwort(paare):
    """(matchId, lobbyKd, spieler) → Antwort von lobby_kd_for_matches.

    `coverage` ist ein **Prozentwert**, kein Anteil — `counts_for_average`
    vergleicht gegen MIN_COVERAGE_PCT = 25.
    """
    return {"matches": [
        {"matchId": mid, "lobbyKd": kd, "lobbyPlayers": n, "known": n,
         "coverage": 100.0, "playedAt": "2026-08-01T12:00:00Z"}
        for mid, kd, n in paare]}


def test_ohne_vorwert_werden_alle_matches_gerechnet(matches):
    conn, t1 = matches
    gesehen = {}

    def fake(c, t, mids, key, **kw):
        gesehen["n"] = len(mids)
        return _antwort([(mids[0], 2.46, 90)])

    with patch("pubg.lobby_kd.lobby_kd_for_matches", side_effect=fake):
        wert, _ = hardest_lobby(conn, t1, ME, bekannt=0.0)
    assert wert == 2.46
    # Alle 40, nicht nur das Fenster — sonst wäre es kein Alltime-Wert.
    assert gesehen["n"] == 40


def test_mit_vorwert_nur_das_fenster(matches):
    conn, t1 = matches
    gesehen = {}

    def fake(c, t, mids, key, **kw):
        gesehen["n"] = len(mids)
        return _antwort([(mids[0], 1.5, 90)])

    with patch("pubg.lobby_kd.lobby_kd_for_matches", side_effect=fake):
        hardest_lobby(conn, t1, ME, bekannt=2.0)
    assert gesehen["n"] == LOBBY_RECORD_WINDOW


def test_der_vorwert_ist_die_untergrenze(matches):
    # Ein schwächeres Fenster darf den Rekord nicht senken.
    conn, t1 = matches
    with patch("pubg.lobby_kd.lobby_kd_for_matches",
               return_value=_antwort([("m00", 1.4, 90)])):
        assert hardest_lobby(conn, t1, ME, bekannt=2.46)[0] == 2.46


def test_winzige_lobby_gewinnt_nicht(matches):
    # Auf prod stand eine Arcade-Runde mit vier Spielern bei K/D 8,3.
    conn, t1 = matches
    with patch("pubg.lobby_kd.lobby_kd_for_matches",
               return_value=_antwort([("m00", 8.3, 4),
                                      ("m01", 1.9, 90)])):
        assert hardest_lobby(conn, t1, ME, bekannt=0.0)[0] == 1.9


def test_lobby_ohne_abdeckung_gewinnt_nicht(matches):
    # Ein Mittel aus zehn von 93 Spielern (10,7 %) sagt mehr über unsere
    # Sammelquote als über die Lobby; die Schwelle liegt bei 25 %.
    conn, t1 = matches
    schlecht = {"matches": [
        {"matchId": "m00", "lobbyKd": 9.0, "lobbyPlayers": 93, "known": 10,
         "coverage": 10.7, "playedAt": "2026-08-01T12:00:00Z"},
        {"matchId": "m01", "lobbyKd": 2.0, "lobbyPlayers": 90, "known": 90,
         "coverage": 100.0, "playedAt": "2026-08-02T12:00:00Z"}]}
    with patch("pubg.lobby_kd.lobby_kd_for_matches", return_value=schlecht):
        assert hardest_lobby(conn, t1, ME, bekannt=0.0)[0] == 2.0


def test_ein_fehler_laesst_den_rekord_stehen(matches):
    # Die Lobby-Zahlen sind Beiwerk; ohne sie laufen alle anderen
    # Anlässe weiter.
    conn, t1 = matches
    with patch("pubg.lobby_kd.lobby_kd_for_matches",
               side_effect=RuntimeError("API weg")):
        assert hardest_lobby(conn, t1, ME, bekannt=2.46) == (2.46, None)


def test_ohne_matches_bleibt_der_vorwert(pg_compat):
    conn, t1, _ = pg_compat
    db_pg.upsert_player(conn.raw, t1, ME, "PEX_LuCKoR", "steam", 1)
    conn.raw.commit()
    assert hardest_lobby(conn, t1, ME, bekannt=1.7) == (1.7, None)


# ── Begleitzahlen zum Rekord ────────────────────────────────────────────────

def test_die_kennzahlen_kommen_aus_lobby_detail(matches):
    # Nicht nachbauen: lobby_detail liefert Median, beide Ränder und den
    # eigenen Squad bereits — dieselbe Funktion, hinter der im Report die
    # Lobby-Zahl hängt.
    #
    # Der Squad heißt dort `squadAvgMates`, in `lobby_kd_for_matches`
    # dagegen `squadKdMates`. Mit dem falschen Namen stand überall 0,00;
    # dieser Test hält den richtigen fest.
    from pubg.poller import lobby_begleitzahlen
    conn, t1 = matches
    antwort = {"matches": [{
        "matchId": "m00", "avg": 2.46, "median": 1.31, "max": 8.16,
        "topAvg": 6.02, "lowAvg": 0.41, "squadAvgMates": 1.9,
        "squadMatesKnown": 2,
        "known": 80, "lobbyPlayers": 80, "map": "Neon_Main",
        "playedAt": "2026-05-03T12:00:00Z",
        "top": [{"name": "Hai", "kd": 8.16}]}]}
    with patch("pubg.lobby_kd.lobby_detail", return_value=antwort):
        d = lobby_begleitzahlen(conn, t1, "m00", ME)
    assert d["topAvg"] == 6.02
    assert d["lowAvg"] == 0.41
    assert d["squadKd"] == 1.9
    assert d["squadKnown"] == 2
    assert d["median"] == 1.31
    assert d["topName"] == "Hai"


def test_ohne_lobby_detail_bleibt_der_rekord_ohne_beiwerk(matches):
    from pubg.poller import lobby_begleitzahlen
    conn, t1 = matches
    with patch("pubg.lobby_kd.lobby_detail",
               side_effect=RuntimeError("weg")):
        assert lobby_begleitzahlen(conn, t1, "m00", ME) is None


def test_rekord_liefert_die_match_id_mit(matches):
    # Nur wenn ein neuer Bestwert dabei ist — sonst gäbe es nichts
    # festzuhalten.
    conn, t1 = matches
    with patch("pubg.lobby_kd.lobby_kd_for_matches",
               return_value=_antwort([("m00", 2.46, 90)])):
        wert, mid = hardest_lobby(conn, t1, ME, bekannt=0.0)
    assert (wert, mid) == (2.46, "m00")


def test_ohne_neuen_bestwert_keine_match_id(matches):
    conn, t1 = matches
    with patch("pubg.lobby_kd.lobby_kd_for_matches",
               return_value=_antwort([("m00", 1.4, 90)])):
        wert, mid = hardest_lobby(conn, t1, ME, bekannt=2.46)
    assert wert == 2.46 and mid is None


def test_begleitzahlen_erreichen_den_meilenstein():
    # Der ganze Weg: Zustand mit extra -> detect -> Eintrag.
    from pubg.weapon_milestones import detect
    prev = {"weapons": {}, "career": {"hardest_lobby": 2.34}}
    cur = {"weapons": {}, "career": {"hardest_lobby": 2.46},
           "extra": {"hardest_lobby": {"topAvg": 6.02, "lowAvg": 0.41,
                                       "median": 1.31, "squadKd": 1.9}}}
    m = [x for x in detect(prev, cur)
         if x["occasion"] == "career_hardest_lobby"][0]
    assert m["extra"]["topAvg"] == 6.02
    assert m["extra"]["squadKd"] == 1.9


def test_anlaesse_ohne_begleitzahlen_bleiben_leer():
    from pubg.weapon_milestones import detect
    prev = {"weapons": {"M416": {"best_damage": 900}}, "career": {}}
    cur = {"weapons": {"M416": {"best_damage": 976}}, "career": {}}
    m = [x for x in detect(prev, cur)
         if x["occasion"] == "weapon_best_damage"][0]
    assert m["extra"] is None


def test_fehlender_squad_ist_nicht_null(matches):
    # Eine 0,00 hieße „Squad mit K/D 0" und nicht „kein Squad". Wenn
    # kein Mitspieler eine bekannte K/D hat, bleibt das Feld leer und
    # das Widget rückt den härtesten Gegner nach.
    from pubg.poller import lobby_begleitzahlen
    conn, t1 = matches
    antwort = {"matches": [{
        "matchId": "m00", "avg": 2.14, "median": 1.68, "max": 9.21,
        "topAvg": 6.08, "lowAvg": 0.54, "squadAvgMates": None,
        "squadMatesKnown": 0, "known": 87, "lobbyPlayers": 91,
        "map": "Baltic_Main", "playedAt": "2026-04-28T12:00:00Z",
        "top": [{"name": "Twitch_Smeerkees", "kd": 9.21}]}]}
    with patch("pubg.lobby_kd.lobby_detail", return_value=antwort):
        d = lobby_begleitzahlen(conn, t1, "m00", ME)
    assert d["squadKd"] is None
    assert d["squadKnown"] == 0
    # Der Ersatz muss vorhanden sein, sonst bliebe die Reihe kurz.
    assert d["max"] == 9.21 and d["topName"] == "Twitch_Smeerkees"
