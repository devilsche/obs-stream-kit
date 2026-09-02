"""Lobby-Stärke: Season-K/D aller Spieler einer Lobby, gemittelt je Match.

Die PUBG-API gibt Lifetime-Werte nur einzeln heraus (93 Calls je Match bei
10 Calls pro Minute Budget) — Season-Werte dagegen im Zehnerpack. Deshalb
Season, und deshalb Snapshots: ein Spieler wird einmal geholt und steht
danach für jedes Match zur Verfügung, in dem er auftaucht.
"""
from unittest import mock

import pytest

from pubg import lobby_kd as lk


SEASON = "division.bro.official.pc-2018-42"


def _payload(entries):
    """Antwort des Season-Batch-Endpoints nachbauen."""
    return {"data": [
        {"id": acc, "type": "playerSeason",
         "relationships": {"player": {"data": {"id": acc}}},
         "attributes": {"gameModeStats": {"squad-fpp": stats}}}
        for acc, stats in entries.items()]}


def test_batches_are_ten_players_wide():
    """Der Endpoint nimmt zehn IDs — mehr wird als weiterer Call geschickt."""
    assert lk.chunk(list(range(25)), 10) == [
        list(range(10)), list(range(10, 20)), list(range(20, 25))]


def test_parse_reads_kills_and_losses_per_player():
    data = _payload({
        "account.a": {"kills": 100, "losses": 50, "roundsPlayed": 60,
                      "wins": 10, "damageDealt": 12000.0},
    })
    rows = lk.parse_season_batch(data, "squad-fpp")
    assert rows["account.a"]["kills"] == 100
    assert rows["account.a"]["losses"] == 50
    assert rows["account.a"]["kd"] == pytest.approx(2.0)


def test_parse_survives_players_without_that_mode():
    """Wer den Modus nie gespielt hat, hat dort keine Zahlen."""
    data = {"data": [{"id": "account.b", "attributes": {"gameModeStats": {}}}]}
    assert lk.parse_season_batch(data, "squad-fpp") == {}


def test_kd_without_losses_falls_back_to_rounds():
    """Wer nie gestorben ist, hat trotzdem eine sinnvolle Quote."""
    data = _payload({"account.c": {"kills": 9, "losses": 0, "roundsPlayed": 3,
                                    "wins": 3, "damageDealt": 900.0}})
    rows = lk.parse_season_batch(data, "squad-fpp")
    assert rows["account.c"]["kd"] == pytest.approx(3.0)


def test_lobby_average_ignores_players_without_snapshot():
    """Ein Durchschnitt über die halbe Lobby ist besser als keiner — aber die
    Abdeckung muss dabeistehen, sonst liest man ihn als vollständig."""
    snapshots = {"account.a": 2.0, "account.b": 1.0}
    out = lk.lobby_average(["account.a", "account.b", "account.c"], snapshots)
    assert out["avgKd"] == pytest.approx(1.5)
    assert out["known"] == 2
    assert out["total"] == 3
    assert out["coverage"] == pytest.approx(200 / 3)


def test_lobby_average_without_any_snapshot_is_none():
    out = lk.lobby_average(["account.a"], {})
    assert out["avgKd"] is None
    assert out["known"] == 0


def test_bots_are_not_part_of_the_lobby_strength():
    """Bots haben keine Season-Stats und wuerden den Schnitt nach unten ziehen."""
    out = lk.lobby_average(["account.a", "ai.7"], {"account.a": 2.0})
    assert out["total"] == 1
    assert out["avgKd"] == pytest.approx(2.0)


def test_missing_players_are_asked_for_only_once():
    """Ein Spieler taucht in vielen Matches auf — geholt wird er einmal."""
    client = mock.Mock()
    client.get_season_batch.return_value = _payload({
        f"account.{i}": {"kills": 10, "losses": 5, "roundsPlayed": 6,
                          "wins": 1, "damageDealt": 900.0}
        for i in range(10)})
    store = {}
    fetched = lk.fetch_missing(client, [f"account.{i}" for i in range(10)] * 3,
                               SEASON, "squad-fpp", store, max_batches=5)
    assert fetched == 10
    assert client.get_season_batch.call_count == 1


def test_fetch_stops_at_the_batch_budget():
    """Der Match-Poller teilt sich das Rate-Limit — der Sammler nimmt nur,
    was ihm zugeteilt wurde."""
    client = mock.Mock()
    client.get_season_batch.return_value = _payload({})
    lk.fetch_missing(client, [f"account.{i}" for i in range(100)],
                     SEASON, "squad-fpp", {}, max_batches=2)
    assert client.get_season_batch.call_count == 2


def test_fetch_marks_players_the_api_does_not_know():
    """Sonst fragt der Sammler sie in jedem Durchlauf erneut."""
    client = mock.Mock()
    client.get_season_batch.return_value = _payload({"account.0": {
        "kills": 1, "losses": 1, "roundsPlayed": 1, "wins": 0,
        "damageDealt": 100.0}})
    store = {}
    lk.fetch_missing(client, ["account.0", "account.1"], SEASON, "squad-fpp",
                     store, max_batches=1)
    assert store["account.0"]["kd"] == pytest.approx(1.0)
    assert store["account.1"] is None       # Fehlanzeige, aber vermerkt


def test_lobby_average_can_exclude_our_own_squad():
    """Sonst misst man sich zum Teil gegen sich selbst."""
    snaps = {"account.me": 3.0, "account.mate": 3.0, "account.foe": 1.0}
    out = lk.lobby_average(["account.me", "account.mate", "account.foe"],
                           snaps, exclude={"account.me", "account.mate"})
    assert out["avgKd"] == pytest.approx(1.0)
    assert out["total"] == 1


def test_snapshots_go_stale_after_two_weeks():
    """Die Zahlen wachsen weiter — ein Wert von vor Monaten beschreibt den
    Spieler nicht mehr."""
    assert lk.is_stale("2026-01-01T00:00:00Z", now="2026-03-01T00:00:00Z")
    assert lk.is_stale("2026-02-10T00:00:00Z", now="2026-03-01T00:00:00Z")
    assert not lk.is_stale("2026-02-25T00:00:00Z", now="2026-03-01T00:00:00Z")
    assert lk.is_stale(None, now="2026-03-01T00:00:00Z")
    assert lk.is_stale("kaputt", now="2026-03-01T00:00:00Z")


# ── Lifetime: teuer, aber das ist die Zahl, die gefragt war ─────────────────

def _lifetime_payload(modes):
    return {"data": {"type": "playerSeason",
                     "attributes": {"gameModeStats": modes}}}


def test_lifetime_payload_is_parsed_per_mode():
    """Ein Lifetime-Call liefert ALLE Modi mit — die nimmt man alle mit,
    sonst zahlt man denselben Call spaeter nochmal."""
    payload = _lifetime_payload({
        "squad-fpp": {"kills": 900, "losses": 500, "roundsPlayed": 600,
                       "wins": 60, "damageDealt": 120000.0},
        "duo-fpp": {"kills": 100, "losses": 100, "roundsPlayed": 110,
                     "wins": 5, "damageDealt": 15000.0},
    })
    rows = lk.parse_lifetime(payload)
    assert set(rows) == {"squad-fpp", "duo-fpp"}
    assert rows["squad-fpp"]["kd"] == pytest.approx(1.8)
    assert rows["duo-fpp"]["kd"] == pytest.approx(1.0)


def test_lifetime_ignores_modes_without_rounds():
    payload = _lifetime_payload({
        "solo": {"kills": 0, "losses": 0, "roundsPlayed": 0, "wins": 0,
                  "damageDealt": 0.0}})
    assert lk.parse_lifetime(payload) == {}


def test_fetch_lifetime_asks_once_per_player_and_respects_the_budget():
    """Lifetime gibt es nur einzeln: ein Call je Spieler, deshalb ein hartes
    Budget — sonst hungert der Sammler das Match-Polling aus."""
    client = mock.Mock()
    client.get_lifetime.return_value = _lifetime_payload({
        "squad-fpp": {"kills": 10, "losses": 5, "roundsPlayed": 6, "wins": 1,
                       "damageDealt": 900.0}})
    store = {}
    found = lk.fetch_lifetime(client, ["account.a", "account.b", "account.a"],
                              store, max_calls=2)
    assert found == 2
    assert client.get_lifetime.call_count == 2
    assert store["account.a"]["squad-fpp"]["kd"] == pytest.approx(2.0)


def test_fetch_lifetime_keeps_unclear_errors_open():
    """Ein Fehler ohne HTTP-Status sagt nichts darueber, ob es den Spieler
    gibt — also nicht als Fehlanzeige einbrennen."""
    client = mock.Mock()
    client.get_lifetime.side_effect = ValueError("kaputt")
    store = {}
    lk.fetch_lifetime(client, ["account.weg"], store, max_calls=1)
    assert store == {}


def test_lifetime_key_is_not_a_season():
    """Die Snapshots teilen sich die Tabelle — Lifetime bekommt einen eigenen
    Schluessel, damit beide nebeneinander stehen koennen."""
    assert lk.LIFETIME_KEY == "lifetime"


def test_overall_kd_sums_all_modes():
    """"Alltime-K/D" heisst ueber alles, nicht nur ueber einen Modus — und es
    hebt die Abdeckung: von 493 Spielern ohne squad-fpp-Werte haben 382
    Zahlen in einem anderen Modus."""
    per_mode = {
        "squad-fpp": {"kills": 0, "losses": 0},
        "duo-fpp": {"kills": 300, "losses": 200},
        "solo": {"kills": 100, "losses": 50},
    }
    assert lk.overall_kd(per_mode) == pytest.approx(400 / 250)


def test_overall_kd_without_any_death_uses_rounds():
    assert lk.overall_kd({"solo": {"kills": 9, "losses": 0,
                                    "rounds": 3}}) == pytest.approx(3.0)


def test_overall_kd_of_nothing_is_none():
    assert lk.overall_kd({}) is None
    assert lk.overall_kd({"solo": {"kills": 0, "losses": 0, "rounds": 0}}) is None


def test_rate_limit_does_not_mark_a_player_as_unknown():
    """Sonst brennt ein 429 den Spieler dauerhaft als "kennt die API nicht"
    ein — gemessen: 1.400 Accounts standen faelschlich ohne Werte, obwohl
    zwei Stichproben 959 und 1.935 gespielte Runden hatten."""
    from pubg.api_client import RateLimitError
    client = mock.Mock()
    client.get_lifetime.side_effect = RateLimitError("429")
    store = {}
    lk.fetch_lifetime(client, ["account.a"], store, max_calls=1)
    assert store == {}          # bleibt offen, wird spaeter neu geholt


def test_server_errors_do_not_mark_a_player_as_unknown():
    from pubg.api_client import ApiError
    err = ApiError("HTTP 503", status=503)
    client = mock.Mock()
    client.get_lifetime.side_effect = err
    store = {}
    lk.fetch_lifetime(client, ["account.a"], store, max_calls=1)
    assert store == {}


def test_a_real_not_found_is_remembered():
    from pubg.api_client import ApiError
    client = mock.Mock()
    client.get_lifetime.side_effect = ApiError("HTTP 404", status=404)
    store = {}
    lk.fetch_lifetime(client, ["account.weg"], store, max_calls=1)
    assert store["account.weg"] is None


# ── Aufschluesselung fuers Modal ────────────────────────────────────────────

def test_lobby_breakdown_liefert_median_max_und_die_raender():
    from pubg.lobby_kd import lobby_breakdown
    players = [("p%d" % i, float(i) / 10) for i in range(1, 22)]   # 0.1 .. 2.1
    b = lobby_breakdown(players, top_n=5)
    assert b["known"] == 21
    assert b["median"] == pytest.approx(1.1)
    assert b["max"] == pytest.approx(2.1)
    assert [p["name"] for p in b["top"]] == ["p21", "p20", "p19", "p18", "p17"]
    assert [p["name"] for p in b["low"]] == ["p1", "p2", "p3", "p4", "p5"]
    assert b["topAvg"] == pytest.approx((2.1 + 2.0 + 1.9 + 1.8 + 1.7) / 5)
    assert b["lowAvg"] == pytest.approx((0.1 + 0.2 + 0.3 + 0.4 + 0.5) / 5)


def test_lobby_breakdown_ohne_werte():
    from pubg.lobby_kd import lobby_breakdown
    b = lobby_breakdown([], top_n=5)
    assert b["known"] == 0 and b["median"] is None and b["max"] is None
    assert b["top"] == [] and b["low"] == []


def test_lobby_breakdown_kuerzt_die_raender_bei_wenigen_spielern():
    """Bei 6 Bekannten duerfen sich Top und Low nicht ueberlappen."""
    from pubg.lobby_kd import lobby_breakdown
    b = lobby_breakdown([("a", 1.0), ("b", 2.0), ("c", 3.0),
                         ("d", 4.0), ("e", 5.0), ("f", 6.0)], top_n=5)
    assert [p["name"] for p in b["top"]] == ["f", "e", "d"]
    assert [p["name"] for p in b["low"]] == ["a", "b", "c"]


def test_mini_lobbys_zaehlen_nicht_in_den_gesamtschnitt():
    """Ein Arcade-Match mit vier Spielern darf ein 96er-Match nicht mitteln."""
    from pubg.lobby_kd import MIN_LOBBY_PLAYERS
    matches = [
        {"lobbyKd": 1.30, "coverage": 100.0, "lobbyPlayers": 95,
         "squadKd": None, "playedAt": "2026-09-01T20:00:00Z"},
        {"lobbyKd": 4.00, "coverage": 100.0, "lobbyPlayers": 3,
         "squadKd": None, "playedAt": "2026-09-01T21:00:00Z"},
    ]
    assert MIN_LOBBY_PLAYERS > 3
    solid = [m for m in matches if lk.counts_for_average(m)]
    assert len(solid) == 1
    assert solid[0]["lobbyKd"] == 1.30


# ── K/D nach Perspektive: FPP, TPP, und der gespielte Modus zuerst ──────────

def _stats(k, l, r):
    return {"kills": k, "losses": l, "rounds": r}


def test_kd_for_mode_nimmt_den_gespielten_modus():
    """Wer in squad-fpp 49 Runden hat, wird daran gemessen — nicht an zwei
    Solo-Runden mit 20 Kills."""
    per_mode = {"squad-fpp": _stats(90, 210, 220), "solo-fpp": _stats(20, 1, 2)}
    r = lk.kd_for_mode(per_mode, "squad-fpp")
    assert r["kd"] == pytest.approx(90 / 210)
    assert r["basis"] == "squad-fpp"
    assert r["rounds"] == 220


def test_kd_for_mode_kleiner_hauptmodus_faellt_auf_die_perspektive():
    """Der Fall Emikonn: 49 Runden squad-fpp reichen allein nicht, zusammen
    mit den zwei Solo-FPP-Runden aber schon — und das Ergebnis liegt bei 0,8
    statt bei den 20,0, die vorher aus zwei Runden entstanden."""
    per_mode = {"squad-fpp": _stats(21, 49, 49), "solo-fpp": _stats(20, 1, 2)}
    r = lk.kd_for_mode(per_mode, "squad-fpp")
    assert r["basis"] == "fpp"
    assert r["kd"] == pytest.approx(41 / 50)


def test_kd_for_mode_faellt_auf_die_perspektive_zurueck():
    """Kein squad-fpp, aber genug Duo-FPP: FPP bleibt FPP."""
    per_mode = {"duo-fpp": _stats(120, 60, 70), "squad": _stats(500, 5, 6)}
    r = lk.kd_for_mode(per_mode, "squad-fpp")
    assert r["kd"] == pytest.approx(120 / 60)
    assert r["basis"] == "fpp"


def test_kd_for_mode_nimmt_zuletzt_alles_zusammen():
    """Nur TPP gespielt, das Match war FPP: dann zaehlt die ganze Karriere."""
    per_mode = {"squad": _stats(300, 100, 150), "duo": _stats(60, 20, 30)}
    r = lk.kd_for_mode(per_mode, "squad-fpp")
    assert r["kd"] == pytest.approx(360 / 120)
    assert r["basis"] == "all"


def test_kd_for_mode_ohne_ausreichende_stichprobe():
    """Zwei Solo-Runden sagen nichts — dann lieber gar kein Wert."""
    per_mode = {"solo-fpp": _stats(20, 1, 2)}
    r = lk.kd_for_mode(per_mode, "squad-fpp")
    assert r["kd"] is None and r["basis"] is None


def test_kd_by_perspective_trennt_fpp_und_tpp():
    per_mode = {"squad-fpp": _stats(290, 89, 98), "squad": _stats(30, 1, 2),
                "solo": _stats(46, 3, 4), "duo-fpp": _stats(40, 40, 40)}
    p = lk.kd_by_perspective(per_mode)
    assert p["fpp"]["kd"] == pytest.approx((290 + 40) / (89 + 40))
    assert p["fpp"]["rounds"] == 138
    # TPP hat nur sechs Runden — zu duenn fuer eine eigene Aussage.
    assert p["tpp"]["kd"] is None
    assert p["tpp"]["rounds"] == 6


def test_negativ_eintrag_ueberschreibt_keine_vorhandenen_werte(pg):
    """Ein Fehlversuch darf einen Spieler, von dem wir Zahlen haben, nicht
    als 'kennt die API nicht' markieren — sonst fragt ihn niemand mehr ab."""
    from pubg import db_pg
    conn, _t1, _t2 = pg
    db_pg.upsert_lifetime_snapshots(conn, {
        "account.X": {"solo-fpp": {"kills": 20, "losses": 1, "rounds": 2,
                                    "wins": 1, "damage": 1.0, "kd": 20.0}},
    }, "2026-09-01T06:15:43Z")
    # Zweiter Lauf, diesmal ohne Daten (API-Fehler oder leere Antwort).
    db_pg.upsert_lifetime_snapshots(conn, {"account.X": None},
                                     "2026-09-01T06:29:16Z")
    rows = db_pg.get_lifetime_by_mode(conn, ["account.X"])
    assert set(rows.get("account.X") or {}) == {"solo-fpp"}


def test_kd_for_mode_verwirft_eine_stufe_die_kaum_gespielt_wurde():
    """Ein TPP-Match darf nicht auf 25 TPP-Runden zurueckfallen, wenn daneben
    10.663 Runden squad-fpp stehen — gemessen ergab das 4,74 statt 1,50."""
    per_mode = {"solo": _stats(0, 1, 1), "squad": _stats(103, 19, 21),
                "duo": _stats(6, 3, 3),
                "squad-fpp": _stats(15279, 10219, 10663),
                "duo-fpp": _stats(10052, 6474, 6723)}
    r = lk.kd_for_mode(per_mode, "solo")
    assert r["basis"] == "all"
    assert r["kd"] == pytest.approx(25440 / 16716, rel=0.01)


def test_kd_for_mode_nimmt_die_perspektive_wenn_sie_wirklich_gespielt_wurde():
    per_mode = {"squad": _stats(900, 600, 700), "squad-fpp": _stats(100, 90, 95)}
    r = lk.kd_for_mode(per_mode, "solo")
    assert r["basis"] == "tpp"
