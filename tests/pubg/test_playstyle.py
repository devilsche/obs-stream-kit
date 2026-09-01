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


def test_the_same_victim_counts_once_across_fights():
    """Knock im ersten Gefecht, Finisher zwei Minuten spaeter im zweiten:
    das ist EIN erledigter Gegner, kein zweiter."""
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 12, "account.me", "account.foe1"),
        ev("TakeDamage", 180, "account.me", "account.foe1"),
        ev("Kill", 182, "account.me", "account.foe1"),
    ]
    fights = ps.build_fights(events, SQUAD, TEAM_OF)
    assert len(fights) == 2
    assert sum(f["theirDowns"] for f in fights) == 1


def test_kill_without_a_knock_still_counts():
    """Der letzte Gegner eines Teams geht ohne DBNO direkt zu Boden — gemessen
    betrifft das rund ein Viertel aller Kills."""
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Kill", 12, "account.me", "account.foe1"),
    ]
    assert ps.build_fights(events, SQUAD, TEAM_OF)[0]["theirDowns"] == 1


def test_a_revived_enemy_can_go_down_again():
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 12, "account.me", "account.foe1"),
        ev("Revive", 20, "account.foe2", "account.foe1"),
        ev("Knock", 30, "account.me", "account.foe1"),
    ]
    assert ps.build_fights(events, SQUAD, TEAM_OF)[0]["theirDowns"] == 2


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


# ── Eigene Leistung vs. Team-Ergebnis ───────────────────────────────────────

def test_fight_records_who_did_the_downing():
    """Wer aufmacht, muss nicht der sein, der trifft — beides gehoert
    getrennt ausgewiesen."""
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 12, "account.mate", "account.foe1"),
        ev("Knock", 14, "account.me", "account.foe2"),
        ev("Knock", 16, "account.foe2", "account.mate"),
    ]
    f = ps.build_fights(events, SQUAD, TEAM_OF)[0]
    assert f["theirDowns"] == 2
    assert f["ourDowns"] == 1
    assert f["downsBy"]["account.me"] == 1      # einen selbst umgelegt
    assert f["downsBy"]["account.mate"] == 1
    assert f["lostBy"] == ["account.mate"]      # wen es bei uns erwischt hat


def test_aggregate_separates_own_downs_from_team_result():
    a = ps.analyse_match([
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 12, "account.mate", "account.foe1"),   # Mate macht die Arbeit
        ev("Knock", 20, "account.foe2", "account.mate"),   # kostet uns den Mate
    ], SQUAD, TEAM_OF)
    me = next(r for r in ps.aggregate([a]) if r["accountId"] == "account.me")
    assert me["opened"] == 1
    assert me["downsFor"] == 1          # Team-Ergebnis
    assert me["downsBySelf"] == 0       # er selbst hat niemanden umgelegt
    assert me["downsAgainst"] == 1      # ein eigener Mann unten
    assert me["squadLossPerOpen"] == pytest.approx(1.0)
    mate = next(r for r in ps.aggregate([a]) if r["accountId"] == "account.mate")
    assert mate["downsMade"] == 1       # zaehlt auch ausserhalb eigener Kaempfe


# ── "Ich treffe zuerst — geht der um?" ──────────────────────────────────────

def test_fight_tracks_the_first_victim_and_whether_he_goes_down():
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),   # erster Treffer
        ev("TakeDamage", 12, "account.me", "account.foe2"),
        ev("Knock", 20, "account.me", "account.foe1"),
    ]
    f = ps.build_fights(events, SQUAD, TEAM_OF)[0]
    assert f["openTarget"] == "account.foe1"
    assert f["openTargetDown"] is True
    assert f["openTargetDownBySelf"] is True


def test_first_victim_who_gets_away_counts_as_not_down():
    """Angeschossen, aber weggekommen — genau der Fall, um den es geht."""
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 20, "account.me", "account.foe2"),        # ein ANDERER faellt
    ]
    f = ps.build_fights(events, SQUAD, TEAM_OF)[0]
    assert f["openTarget"] == "account.foe1"
    assert f["openTargetDown"] is False


def test_first_victim_downed_by_a_mate_counts_but_not_as_own():
    events = [
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 20, "account.mate", "account.foe1"),
    ]
    f = ps.build_fights(events, SQUAD, TEAM_OF)[0]
    assert f["openTargetDown"] is True
    assert f["openTargetDownBySelf"] is False


def test_aggregate_reports_the_first_victim_rate():
    def fight(down_by=None):
        evs = [ev("TakeDamage", 10, "account.me", "account.foe1")]
        if down_by:
            evs.append(ev("Knock", 20, down_by, "account.foe1"))
        return ps.analyse_match(evs, SQUAD, TEAM_OF)
    rows = ps.aggregate([fight("account.me"), fight("account.mate"),
                         fight(None), fight(None)])
    me = next(r for r in rows if r["accountId"] == "account.me")
    assert me["opened"] == 4
    assert me["openTargetDown"] == 2
    assert me["openTargetDownPct"] == pytest.approx(50.0)
    assert me["openTargetDownBySelfPct"] == pytest.approx(25.0)
    # Bezogen auf die Faelle, in denen das Ziel WIRKLICH fiel: einer von
    # zweien war er selbst.
    assert me["openTargetFinishedSelfPct"] == pytest.approx(50.0)


def test_finished_self_is_none_without_a_single_downed_target():
    a = ps.analyse_match([ev("TakeDamage", 10, "account.me", "account.foe1")],
                          SQUAD, TEAM_OF)
    me = next(r for r in ps.aggregate([a]) if r["accountId"] == "account.me")
    assert me["openTargetDown"] == 0
    assert me["openTargetFinishedSelfPct"] is None


# ── Vergleichszeile: der Gegner macht auf ───────────────────────────────────

def test_baseline_counts_only_fights_the_enemy_started():
    """Ohne diese Zeile fehlt der Massstab: Kaempfe, die uns aufgezwungen
    werden, gehen deutlich schlechter aus als die selbst begonnenen."""
    ours = ps.analyse_match([
        ev("TakeDamage", 10, "account.me", "account.foe1"),
        ev("Knock", 12, "account.me", "account.foe1"),
    ], SQUAD, TEAM_OF)
    theirs = ps.analyse_match([
        ev("TakeDamage", 10, "account.foe1", "account.me"),
        ev("Knock", 12, "account.foe1", "account.me"),
    ], SQUAD, TEAM_OF)
    b = ps.baseline([ours, theirs])
    assert b["opened"] == 1              # nur der fremd-eroeffnete Kampf
    assert b["downsAgainst"] == 1
    assert b["downsFor"] == 0
    assert b["lostPct"] == pytest.approx(100.0)
    assert b["wonPct"] == pytest.approx(0.0)


def test_baseline_without_such_fights_is_none():
    only_ours = ps.analyse_match([
        ev("TakeDamage", 10, "account.me", "account.foe1"),
    ], SQUAD, TEAM_OF)
    assert ps.baseline([only_ours]) is None


def test_baseline_reports_the_same_shape_as_a_player_row():
    """Damit die Zeile in dieselbe Tabelle passt."""
    theirs = ps.analyse_match([
        ev("TakeDamage", 10, "account.foe1", "account.me"),
        ev("Knock", 14, "account.me", "account.foe1"),
    ], SQUAD, TEAM_OF)
    b = ps.baseline([theirs])
    for key in ("opened", "wonPct", "lostPct", "pointlessPct", "downsFor",
                "downsAgainst", "downsPerOpen", "squadLossPerOpen"):
        assert key in b, key
    assert b["downsPerOpen"] == pytest.approx(1.0)
