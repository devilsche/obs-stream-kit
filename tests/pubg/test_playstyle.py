"""Spielstil- und Kampf-Auswertung je Squad-Mate (pubg/playstyle.py).

Die Rechenkerne arbeiten auf Event-Listen, nicht auf der DB — deshalb hier
synthetische Event-Folgen statt Fixtures.
"""
import pytest

from pubg import playstyle as ps


T0 = 1_700_000_000_000
SQUAD = {"account.me": "Ich", "account.mate": "Mate"}
TEAM_OF = {"account.me": 1, "account.mate": 1,
           "account.foe1": 7, "account.foe2": 7,
           "account.other": 9, "ai.bot1": 12}


def ev(kind, ts_s, actor=None, target=None, ax=None, ay=None,
       vx=None, vy=None):
    return {"event_type": kind, "timestamp_ms": T0 + int(ts_s * 1000),
            "actor_account": actor, "target_account": target,
            "actor_x": ax, "actor_y": ay, "victim_x": vx, "victim_y": vy}


# ── Kampf-Erkennung ─────────────────────────────────────────────────────────

def test_fight_opener_is_whoever_shoots_first():
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1",
           ax=0, ay=0, vx=5000, vy=0),
        ev("TakeDamage", 12, "account.foe1", "account.me"),
    ]
    fights = ps.build_fights(events, SQUAD, TEAM_OF)
    assert len(fights) == 1
    assert fights[0]["opener"] == "account.me"
    assert fights[0]["openedByUs"] is True
    assert fights[0]["openDist"] == pytest.approx(50.0)   # 5000 cm


def test_fight_opened_by_the_enemy_has_no_squad_opener():
    events = [
        ev("TakeDamage", 10, "account.foe1", "account.me"),
        ev("TakeDamage", 11, "account.me", "account.foe1"),
    ]
    fights = ps.build_fights(events, SQUAD, TEAM_OF)
    assert fights[0]["openedByUs"] is False
    assert fights[0]["opener"] is None
    assert fights[0]["engagedBy"] == "account.me"   # wer zurueckschiesst


def test_fights_against_the_same_team_split_after_a_pause():
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("TakeDamage", 15, "account.me", "account.foe2"),
        ev("TakeDamage", 120, "account.me", "account.foe1"),   # 105 s spaeter
    ]
    fights = ps.build_fights(events, SQUAD, TEAM_OF)
    assert len(fights) == 2


def test_fights_against_different_teams_are_separate():
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("TakeDamage", 12, "account.me", "account.other"),
    ]
    fights = ps.build_fights(events, SQUAD, TEAM_OF)
    assert {f["foeTeam"] for f in fights} == {7, 9}


def test_bot_fights_are_dropped_by_default():
    """Bot-Kills wuerden jede Quote schoenen."""
    events = [ev("TakeDamage", 10, "account.me", "ai.bot1")]
    assert ps.build_fights(events, SQUAD, TEAM_OF) == []
    assert len(ps.build_fights(events, SQUAD, TEAM_OF, include_bots=True)) == 1


def test_damage_between_two_foreign_teams_is_ignored():
    """Die DB haelt nur squad-nahe Events — was doch durchrutscht, ist keins
    unserer Gefechte."""
    events = [ev("TakeDamage", 10, "account.other", "account.foe1")]
    assert ps.build_fights(events, SQUAD, TEAM_OF) == []


# ── Ausgang ─────────────────────────────────────────────────────────────────

def test_fight_is_won_when_more_enemies_go_down():
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 12, "account.me", "account.foe1"),
        ev("Kill", 14, "account.me", "account.foe1"),      # gleiches Opfer
        ev("Kill", 20, "account.mate", "account.foe2"),
    ]
    f = ps.build_fights(events, SQUAD, TEAM_OF)[0]
    assert f["theirDowns"] == 2      # zwei Gegner, nicht drei Events
    assert f["ourDowns"] == 0
    assert f["result"] == "won"


def test_fight_is_lost_when_we_lose_more_people():
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 13, "account.foe1", "account.me"),
        ev("Knock", 15, "account.foe2", "account.mate"),
    ]
    f = ps.build_fights(events, SQUAD, TEAM_OF)[0]
    assert f["ourDowns"] == 2
    assert f["result"] == "lost"


def test_fight_without_any_down_counts_as_pointless():
    """Genau der Fall 'schiesst und es passiert nichts'."""
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("TakeDamage", 12, "account.me", "account.foe1"),
    ]
    f = ps.build_fights(events, SQUAD, TEAM_OF)[0]
    assert f["result"] == "pointless"


def test_even_trade_is_its_own_result():
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 12, "account.me", "account.foe1"),
        ev("Knock", 13, "account.foe2", "account.me"),
    ]
    assert ps.build_fights(events, SQUAD, TEAM_OF)[0]["result"] == "trade"


def test_downs_after_the_last_shot_still_count():
    """Der Knock kommt oft Sekunden nach dem letzten Schadensereignis."""
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Kill", 40, "account.me", "account.foe1"),
    ]
    f = ps.build_fights(events, SQUAD, TEAM_OF)[0]
    assert f["theirDowns"] == 1


# ── Spielstil je Spieler ────────────────────────────────────────────────────

def pos(ts_s, acc, x, y):
    return ev("Position", ts_s, acc, ax=x, ay=y)


def test_first_down_marks_only_the_first_of_the_squad():
    events = [
        pos(10, "account.me", 0, 0), pos(10, "account.mate", 100, 0),
        ev("Knock", 60, "account.foe1", "account.me"),
        ev("Knock", 90, "account.foe1", "account.mate"),
    ]
    m = ps.player_metrics(events, SQUAD, TEAM_OF)
    assert m["account.me"]["firstDown"] is True
    assert m["account.mate"]["firstDown"] is False


def test_distance_at_down_uses_positions_before_the_knock():
    """Mit einem Fenster um den Knock herum misst man den Mate, der zur
    Rettung heranlaeuft — nicht die Lage beim Knock."""
    events = [
        pos(50, "account.me", 0, 0),
        pos(50, "account.mate", 30000, 0),      # 300 m weg
        ev("Knock", 55, "account.foe1", "account.me"),
        pos(70, "account.mate", 500, 0),        # rennt hin: 5 m
    ]
    m = ps.player_metrics(events, SQUAD, TEAM_OF)
    assert m["account.me"]["distAtDown"] == pytest.approx(300.0)


def test_loot_rate_counts_pickups_per_living_minute():
    events = [
        ev("Landing", 0, "account.me", ax=0, ay=0),
        ev("ItemPickup", 30, "account.me"),
        ev("ItemPickupBox", 60, "account.me"),
        ev("Knock", 120, "account.foe1", "account.me"),
    ]
    m = ps.player_metrics(events, SQUAD, TEAM_OF)["account.me"]
    assert m["pickups"] == 2
    assert m["aliveMin"] == pytest.approx(2.0)
    assert m["pickupsPerMin"] == pytest.approx(1.0)


def test_standing_still_is_measured_against_moving():
    steh = [pos(t, "account.me", 0, 0) for t in range(0, 60, 10)]
    lauf = [pos(t, "account.mate", t * 1000, 0) for t in range(0, 60, 10)]
    m = ps.player_metrics(steh + lauf, SQUAD, TEAM_OF)
    assert m["account.me"]["stillShare"] == pytest.approx(100.0)
    assert m["account.mate"]["stillShare"] == pytest.approx(0.0)


def test_team_distance_pairs_positions_in_the_same_time_window():
    events = [
        pos(10, "account.me", 0, 0), pos(10, "account.mate", 20000, 0),
        pos(20, "account.me", 0, 0), pos(20, "account.mate", 40000, 0),
    ]
    m = ps.player_metrics(events, SQUAD, TEAM_OF)["account.me"]
    # Beide Mate-Punkte liegen im 15-s-Fenster, es zaehlt der naechste: 200 m.
    assert m["teamDistMedian"] == pytest.approx(200.0)
    assert m["farShare"] == pytest.approx(100.0)         # beide > 100 m


def test_solo_match_has_no_team_distance():
    events = [pos(10, "account.me", 0, 0)]
    m = ps.player_metrics(events, {"account.me": "Ich"}, TEAM_OF)["account.me"]
    assert m["teamDistMedian"] is None
    assert m["farShare"] is None


# ── Aggregation über Matches ────────────────────────────────────────────────

def test_aggregate_merges_matches_into_one_row_per_player():
    a1 = ps.analyse_match([
        ev("Landing", 0, "account.me", ax=0, ay=0),
        ev("ItemPickup", 10, "account.me"),
        ev("TakeDamage", 30, "account.me", "account.foe1"),
        ev("Kill", 35, "account.me", "account.foe1"),
        ev("Knock", 200, "account.foe2", "account.me"),   # lange danach
    ], SQUAD, TEAM_OF)
    a2 = ps.analyse_match([
        ev("Landing", 0, "account.me", ax=0, ay=0),
        ev("TakeDamage", 30, "account.foe1", "account.me"),
        ev("Knock", 33, "account.foe1", "account.me"),
    ], SQUAD, TEAM_OF)
    rows = ps.aggregate([a1, a2])
    me = next(r for r in rows if r["accountId"] == "account.me")
    assert me["matches"] == 2
    assert me["opened"] == 1          # nur im ersten Match eroeffnet
    assert me["openedWon"] == 1
    assert me["firstDownPct"] == pytest.approx(100.0)


def test_aggregate_sorts_by_matches_then_name():
    a = ps.analyse_match([pos(10, "account.me", 0, 0)], SQUAD, TEAM_OF)
    rows = ps.aggregate([a])
    assert rows == sorted(rows, key=lambda r: (-r["matches"], r["name"]))


def test_aggregate_of_nothing_is_an_empty_list():
    assert ps.aggregate([]) == []


def test_opening_success_rate_counts_fights_with_a_downed_enemy():
    """Die Frage "pro Eroeffnung, wie oft geht der Gegner down" —
    unabhaengig davon, ob wir den Kampf am Ende gewonnen haben."""
    won = ps.analyse_match([
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 12, "account.me", "account.foe1"),
    ], SQUAD, TEAM_OF)
    traded = ps.analyse_match([
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 12, "account.me", "account.foe1"),
        ev("Knock", 14, "account.foe2", "account.me"),
    ], SQUAD, TEAM_OF)
    nothing = ps.analyse_match([
        ev("TakeDamage", 10, "account.me", "account.foe1"),
    ], SQUAD, TEAM_OF)
    me = next(r for r in ps.aggregate([won, traded, nothing])
              if r["accountId"] == "account.me")
    assert me["opened"] == 3
    assert me["openedWithDown"] == 2
    assert me["openHitPct"] == pytest.approx(200 / 3)
    # Downs je Eroeffnung: 1 + 1 + 0 auf drei Eroeffnungen
    assert me["downsPerOpen"] == pytest.approx(2 / 3)
