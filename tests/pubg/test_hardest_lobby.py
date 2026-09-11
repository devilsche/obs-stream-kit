"""Erfassung des Lobby-Rekords im Poller.

Zwei Fallen: der Alltime-Rekord muss beim ersten Mal über **alle**
Matches gerechnet werden (sonst ist der „Rekord" nur das Maximum der
letzten Woche, und das nächste gute Match feiert einen Rekord, der
keiner ist), und winzige Arcade-Lobbys dürfen nicht gewinnen — eine
Runde mit vier Spielern stand auf prod bei K/D 8,3.
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
        assert hardest_lobby(conn, t1, ME, bekannt=0.0) == 2.46
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
        assert hardest_lobby(conn, t1, ME, bekannt=2.46) == 2.46


def test_winzige_lobby_gewinnt_nicht(matches):
    # Auf prod stand eine Arcade-Runde mit vier Spielern bei K/D 8,3.
    conn, t1 = matches
    with patch("pubg.lobby_kd.lobby_kd_for_matches",
               return_value=_antwort([("m00", 8.3, 4),
                                      ("m01", 1.9, 90)])):
        assert hardest_lobby(conn, t1, ME, bekannt=0.0) == 1.9


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
        assert hardest_lobby(conn, t1, ME, bekannt=0.0) == 2.0


def test_ein_fehler_laesst_den_rekord_stehen(matches):
    # Die Lobby-Zahlen sind Beiwerk; ohne sie laufen alle anderen
    # Anlässe weiter.
    conn, t1 = matches
    with patch("pubg.lobby_kd.lobby_kd_for_matches",
               side_effect=RuntimeError("API weg")):
        assert hardest_lobby(conn, t1, ME, bekannt=2.46) == 2.46


def test_ohne_matches_bleibt_der_vorwert(pg_compat):
    conn, t1, _ = pg_compat
    db_pg.upsert_player(conn.raw, t1, ME, "PEX_LuCKoR", "steam", 1)
    conn.raw.commit()
    assert hardest_lobby(conn, t1, ME, bekannt=1.7) == 1.7
