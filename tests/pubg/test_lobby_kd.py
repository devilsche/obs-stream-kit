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


def test_snapshots_go_stale_after_a_month():
    """Season-Zahlen wachsen weiter — ein Wert von vor drei Monaten beschreibt
    den Spieler nicht mehr."""
    assert lk.is_stale("2026-01-01T00:00:00Z", now="2026-03-01T00:00:00Z")
    assert not lk.is_stale("2026-02-20T00:00:00Z", now="2026-03-01T00:00:00Z")
    assert lk.is_stale(None, now="2026-03-01T00:00:00Z")
    assert lk.is_stale("kaputt", now="2026-03-01T00:00:00Z")
