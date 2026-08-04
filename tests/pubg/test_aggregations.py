"""Aggregationen gegen Postgres (der produktive Pfad).

Frueher liefen diese Tests gegen pubg/db.py (SQLite) — das ist seit der
PG-Migration deprecated, aggregations.py spricht laengst %s-Platzhalter.
Die Schreib-Helfer unten binden die tenant_id, damit die Testkoerper
unveraendert bleiben konnten.
"""
import pytest

from pubg import db_pg
from pubg.aggregations import (compute_session_stats, compute_last_match,
                                compute_top_mates, compute_co_player,
                                compute_mates, compute_map_distribution,
                                compute_first_fight_rate, compute_squad_compare)


CONN = None
T = None


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    """Bindet Verbindung + Tenant fuer die Helfer dieses Moduls."""
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def upsert_player(conn, account_id, name, platform, is_self=False):
    db_pg.upsert_player(conn.raw, T, account_id, name, platform,
                        1 if is_self else 0)


def insert_match(conn, match_id, map_name, mode, is_ranked, duration,
                 played_at, telemetry_url):
    db_pg.insert_match(conn.raw, T, match_id, map_name, mode, is_ranked,
                       duration, played_at, telemetry_url)


def insert_participants(conn, match_id, rows):
    db_pg.insert_participants(conn.raw, T, match_id, rows)


def set_setting(conn, key, value):
    db_pg.set_setting(conn.raw, T, key, value)


def upsert_lifetime(conn, account_id, mode, stats):
    db_pg.upsert_lifetime(conn.raw, T, account_id, mode, stats)


def insert_telemetry_events(conn, match_id, events):
    db_pg.insert_telemetry_events(conn.raw, match_id, events)


def _setup(_unused=None):
    upsert_player(CONN, "account.A", "PEX_LuCKoR", "steam", True)
    return CONN


def _add_match(conn, mid, played_at, kills, dmg, place, mate_count=1, mode="squad-fpp"):
    insert_match(conn, mid, "Erangel_Main", mode, False, 1800, played_at, None)
    parts = [{"account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
              "place": place, "kills": kills, "headshot_kills": 1, "assists": 0,
              "dbnos": 0, "revives": 0, "damage_dealt": dmg, "longest_kill": 50.0,
              "time_survived": 1500, "walk_distance": 100.0, "ride_distance": 0.0,
              "swim_distance": 0.0, "weapons_acquired": 5, "heals": 0, "boosts": 0,
              "team_kills": 0}]
    for i in range(mate_count):
        upsert_player(conn, f"account.M{i}", f"Mate{i}", "steam", False)
        parts.append({
            "account_id": f"account.M{i}", "name": f"Mate{i}", "team_id": 1,
            "place": place, "kills": 1, "headshot_kills": 0, "assists": 1,
            "dbnos": 0, "revives": 0, "damage_dealt": 100.0, "longest_kill": 0.0,
            "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
            "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
            "team_kills": 0})
    insert_participants(conn, mid, parts)


def test_session_stats_aggregates_after_session_start():
    conn = _setup()
    set_setting(conn, "sessionStartedAt", "2026-05-04T18:00:00Z")
    _add_match(conn, "m1", "2026-05-04T17:00:00Z", 5, 500.0, 3)
    _add_match(conn, "m2", "2026-05-04T18:30:00Z", 4, 400.0, 1)
    _add_match(conn, "m3", "2026-05-04T19:00:00Z", 6, 600.0, 5)
    s = compute_session_stats(conn, T, "account.A")
    assert s["matches"] == 2
    assert s["kills"] == 10
    assert s["damage"] == 1000.0
    assert s["wins"] == 1
    assert s["bestPlace"] == 1
    assert s["kpm"] == 5.0  # 10 kills / 2 matches


def test_session_stats_includes_extended_fields():
    conn = _setup()
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    insert_match(conn, "ext1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", None)
    insert_participants(conn, "ext1", [{
        "account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
        "place": 3, "kills": 4, "headshot_kills": 1, "assists": 2,
        "dbnos": 3, "revives": 2, "damage_dealt": 412.0, "longest_kill": 187.5,
        "time_survived": 1690, "walk_distance": 2300.0, "ride_distance": 1500.0,
        "swim_distance": 50.0, "weapons_acquired": 8, "heals": 5, "boosts": 7,
        "team_kills": 0,
    }])
    s = compute_session_stats(conn, T, "account.A")
    assert s["totalBoosts"] == 7
    assert s["totalHeals"] == 5
    assert s["totalRevives"] == 2
    assert s["totalWeaponsAcquired"] == 8
    assert abs(s["walkKm"] - 2.3) < 0.001
    assert abs(s["rideKm"] - 1.5) < 0.001
    assert abs(s["swimKm"] - 0.05) < 0.001


def test_last_match_returns_squad_with_self_first():
    conn = _setup()
    set_setting(conn, "sessionStartedAt", "2026-05-04T18:00:00Z")
    _add_match(conn, "m1", "2026-05-04T18:00:00Z", 4, 412.0, 3, mate_count=2)
    lm = compute_last_match(conn, T, "account.A")
    assert lm["matchId"] == "m1"
    assert lm["map"] == "Erangel_Main"
    assert lm["myStats"]["kills"] == 4
    assert len(lm["mates"]) == 2


def test_top_mates_filters_by_min_matches():
    conn = _setup()
    upsert_player(conn, "account.MA", "MateA", "steam", False)
    for i in range(12):
        insert_match(conn, f"a{i}", "Erangel_Main", "squad-fpp", False, 1800,
                     f"2026-05-04T{i:02d}:00:00Z", None)
        insert_participants(conn, f"a{i}", [
            {"account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
             "place": 5, "kills": 4, "headshot_kills": 1, "assists": 0,
             "dbnos": 0, "revives": 0, "damage_dealt": 400.0, "longest_kill": 0.0,
             "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
             "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
             "team_kills": 0},
            {"account_id": "account.MA", "name": "MateA", "team_id": 1,
             "place": 5, "kills": 2, "headshot_kills": 0, "assists": 1,
             "dbnos": 0, "revives": 0, "damage_dealt": 200.0, "longest_kill": 0.0,
             "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
             "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
             "team_kills": 0},
        ])
    result = compute_top_mates(conn, T, "account.A",
                                sort_by="mostPlayed", limit=5, min_matches=10)
    assert len(result) == 1
    assert result[0]["name"] == "MateA"
    assert result[0]["sharedMatches"] == 12


def test_co_player_combines_shared_and_career():
    conn = _setup()
    upsert_player(conn, "account.B", "MateA", "steam", False)
    _add_match(conn, "m1", "2026-05-04T18:00:00Z", 4, 400.0, 3, mate_count=0)
    insert_participants(conn, "m1", [{
        "account_id": "account.B", "name": "MateA", "team_id": 1,
        "place": 3, "kills": 2, "headshot_kills": 0, "assists": 1,
        "dbnos": 0, "revives": 1, "damage_dealt": 200.0, "longest_kill": 50.0,
        "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
        "team_kills": 0}])
    upsert_lifetime(conn, "account.B", "all", {"rounds_played": 8000,
        "wins": 412, "top10s": 3000, "win_rate": 5.0, "top10_rate": 37.0,
        "kills": 12000, "kd_ratio": 1.5, "headshot_kills": 2000,
        "headshot_rate": 16.0, "avg_damage": 250.0, "longest_kill": 500.0,
        "time_survived_sec": 80000})
    cp = compute_co_player(conn, T, "account.A", "MateA")
    assert cp["sharedHistory"]["matches"] == 1
    assert cp["careerLifetime"]["wins"] == 412


def test_mates_today_aggregates_per_mate():
    conn = _setup()
    upsert_player(conn, "account.MA", "MateA", "steam", False)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    for i in range(3):
        _add_match(conn, f"t{i}", f"2026-05-04T1{i}:00:00Z", 4, 400.0, 3, mate_count=0)
        insert_participants(conn, f"t{i}", [{
            "account_id": "account.MA", "name": "MateA", "team_id": 1,
            "place": 3, "kills": 2, "headshot_kills": 0, "assists": 1,
            "dbnos": 0, "revives": 1, "damage_dealt": 200.0, "longest_kill": 0.0,
            "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
            "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
            "team_kills": 0,
        }])
    result = compute_mates(conn, T, "account.A", range_key="session")
    assert len(result) == 1
    assert result[0]["name"] == "MateA"
    assert result[0]["sharedMatchesToday"] == 3


def test_map_distribution_counts_by_range():
    conn = _setup()
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    for i in range(3):
        _add_match(conn, f"e{i}", f"2026-05-04T1{i}:00:00Z", 2, 200.0, 5)
    insert_match(conn, "mir1", "Miramar_Main", "squad-fpp", False, 1800,
                 "2026-05-04T15:00:00Z", None)
    insert_participants(conn, "mir1", [{
        "account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
        "place": 1, "kills": 5, "headshot_kills": 1, "assists": 0,
        "dbnos": 0, "revives": 0, "damage_dealt": 500.0, "longest_kill": 50.0,
        "time_survived": 1800, "walk_distance": 100.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 5, "heals": 0, "boosts": 0,
        "team_kills": 0,
    }])
    out = compute_map_distribution(conn, T, "account.A", range_key="session")
    erangel = next(x for x in out if x["map"] == "Erangel_Main")
    assert erangel["count"] == 3
    miramar = next(x for x in out if x["map"] == "Miramar_Main")
    assert miramar["count"] == 1
    assert miramar["wins"] == 1


def test_first_fight_rate_aggregates():
    """First-Fight-Win-Rate: Squad gewinnt wenn am Fight-Ende mind. 1 Member
    noch lebt (kein Squad-Member als Kill-Victim im Fight-Cluster)."""
    conn = _setup()
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    # Solo-Squad: nur account.A, mate_count=0 → squad_ids = {A}
    for i in range(4):
        _add_match(conn, f"f{i}", f"2026-05-04T1{i}:00:00Z", 2, 200.0, 5,
                    mate_count=0)
    # m0: A killt Enemy → Squad lebt → WIN
    insert_telemetry_events(conn, "f0", [
        {"event_type": "Kill", "timestamp_ms": 2000, "actor_account": "account.A",
         "target_account": "account.X", "actor_x": 1000.0, "actor_y": 1000.0,
         "victim_x": 1100.0, "victim_y": 1000.0, "weapon": "Beryl",
         "distance": 50.0, "damage": None, "payload_json": "{}"},
    ])
    # m1: Enemy killt A → Squad tot → LOSS
    insert_telemetry_events(conn, "f1", [
        {"event_type": "Kill", "timestamp_ms": 2000, "actor_account": "account.X",
         "target_account": "account.A", "actor_x": 1000.0, "actor_y": 1000.0,
         "victim_x": 1100.0, "victim_y": 1000.0, "weapon": "Beryl",
         "distance": 50.0, "damage": None, "payload_json": "{}"},
    ])
    # m2: keine Combat-Events — zaehlt seit der 'fled'-Behandlung mit
    #     (aggregations.py: Matches ohne detektierbaren Fight gelten als
    #     Disengage, nicht als 'nicht stattgefunden')
    # m3: A killt Enemy → WIN
    insert_telemetry_events(conn, "f3", [
        {"event_type": "Kill", "timestamp_ms": 1500, "actor_account": "account.A",
         "target_account": "account.X", "actor_x": 500.0, "actor_y": 500.0,
         "victim_x": 600.0, "victim_y": 500.0, "weapon": "Beryl",
         "distance": 50.0, "damage": None, "payload_json": "{}"},
    ])
    res = compute_first_fight_rate(conn, T, "account.A", range_key="session")
    assert res["total"] == 4          # 3 mit Events + m2 als 'fled'
    assert res["survived"] == 2
    assert abs(res["rate"] - (2/4)*100) < 0.1


def test_first_fight_cluster_multi_team():
    """Multi-Team-Fight: 3 Teams beteiligt, unser Squad überlebt."""
    conn = _setup()
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    insert_match(conn, "mt1", "Erangel_Main", "squad-fpp", False, 1800,
                  "2026-05-04T18:00:00Z", None)
    upsert_player(conn, "account.M0", "Mate0", "steam", False)
    upsert_player(conn, "account.E1", "Enemy1", "steam", False)
    upsert_player(conn, "account.E2", "Enemy2", "steam", False)
    upsert_player(conn, "account.E3", "Enemy3", "steam", False)
    insert_participants(conn, "mt1", [
        {"account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
         "place": 1, "kills": 2, "headshot_kills": 0, "assists": 0,
         "dbnos": 0, "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
         "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
         "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
         "team_kills": 0},
        {"account_id": "account.M0", "name": "Mate0", "team_id": 1,
         "place": 1, "kills": 1, "headshot_kills": 0, "assists": 0,
         "dbnos": 0, "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
         "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
         "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
         "team_kills": 0},
        {"account_id": "account.E1", "name": "Enemy1", "team_id": 2,
         "place": 5, "kills": 0, "headshot_kills": 0, "assists": 0,
         "dbnos": 0, "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
         "time_survived": 60, "walk_distance": 0.0, "ride_distance": 0.0,
         "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
         "team_kills": 0},
        {"account_id": "account.E2", "name": "Enemy2", "team_id": 3,
         "place": 8, "kills": 0, "headshot_kills": 0, "assists": 0,
         "dbnos": 0, "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
         "time_survived": 80, "walk_distance": 0.0, "ride_distance": 0.0,
         "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
         "team_kills": 0},
        {"account_id": "account.E3", "name": "Enemy3", "team_id": 3,
         "place": 8, "kills": 0, "headshot_kills": 0, "assists": 0,
         "dbnos": 0, "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
         "time_survived": 90, "walk_distance": 0.0, "ride_distance": 0.0,
         "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
         "team_kills": 0},
    ])
    # Cluster: alle 3 Kills innerhalb von 30s und im Radius 200m
    # (= 20000 cm). Positionen alle nahe 1000/1000.
    insert_telemetry_events(conn, "mt1", [
        # T1: Squad-Member A killt Enemy1 (Team 2) — Fight-Start
        {"event_type": "Kill", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": "account.E1",
         "actor_x": 1000.0, "actor_y": 1000.0,
         "victim_x": 1100.0, "victim_y": 1000.0,
         "weapon": "M4", "distance": 100.0, "damage": None,
         "payload_json": "{}"},
        # T2: Mate0 killt Enemy2 (Team 3) — selber Cluster
        {"event_type": "Kill", "timestamp_ms": 75000,
         "actor_account": "account.M0", "target_account": "account.E2",
         "actor_x": 1050.0, "actor_y": 1050.0,
         "victim_x": 1150.0, "victim_y": 1050.0,
         "weapon": "M4", "distance": 100.0, "damage": None,
         "payload_json": "{}"},
        # T3: Enemy3 (Team 3) killt einen seiner eigenen? Nein — Enemy1's mate.
        # Eigentlich enemy-vs-enemy: Enemy3 schießt auf jemanden im Fight.
        # Hier: Enemy3 killt einen vom Team 2 (gibt's nicht mehr) — vereinfacht
        # als: Enemy3 wird auch noch gekillt von uns. Wir können auch sagen
        # Mate0 killt Enemy3.
        {"event_type": "Kill", "timestamp_ms": 90000,
         "actor_account": "account.M0", "target_account": "account.E3",
         "actor_x": 1080.0, "actor_y": 1080.0,
         "victim_x": 1180.0, "victim_y": 1080.0,
         "weapon": "M4", "distance": 100.0, "damage": None,
         "payload_json": "{}"},
    ])
    res = compute_first_fight_rate(conn, T, "account.A", range_key="session")
    assert res["total"] == 1
    assert res["survived"] == 1     # Squad lebt → WIN
    # Neue Semantik: nur OPPONENT-Teams die uns direkt angegriffen haben.
    # Squad-Team (Team 1) selbst zählt nicht. Hier: Team 2 + Team 3 = 2.
    assert res["avgTeams"] == 2.0
    assert res["maxTeams"] == 2


from pubg.aggregations import compute_landing_spots


def _seed_landings():
    """Zwei Matches mit unterschiedlicher Squad-Konstellation.

    Schreibt ueber die DAOs statt per Roh-SQL — die Tabellen tragen seit
    der PG-Migration eine tenant_id.
    """
    conn = CONN
    upsert_player(conn, "acc.A", "LuCKoR", "steam", True)
    upsert_player(conn, "acc.B", "Mate1", "steam", False)
    upsert_player(conn, "acc.C", "Rando", "steam", False)

    def _part(acc, name, team_id):
        return {"account_id": acc, "name": name, "team_id": team_id,
                "place": 5, "kills": 0, "headshot_kills": 0, "assists": 0,
                "dbnos": 0, "revives": 0, "damage_dealt": 0.0,
                "longest_kill": 0.0, "time_survived": 0, "walk_distance": 0.0,
                "ride_distance": 0.0, "swim_distance": 0.0,
                "weapons_acquired": 0, "heals": 0, "boosts": 0,
                "team_kills": 0}

    # Match 1: A + B im Team 1
    insert_match(conn, "m1", "Baltic_Main", "squad", False, 1800,
                 "2026-05-01T10:00:00Z", None)
    insert_participants(conn, "m1", [_part("acc.A", "LuCKoR", 1),
                                      _part("acc.B", "Mate1", 1)])
    db_pg.insert_team_mapping(conn.raw, T, "m1", [
        {"account_id": "acc.A", "team_id": 1},
        {"account_id": "acc.B", "team_id": 1}])
    # A landet bei (400000,400000), B bei (410000,410000)
    insert_telemetry_events(conn, "m1", [
        {"event_type": "Landing", "timestamp_ms": 1000,
         "actor_account": "acc.A", "actor_x": 400000.0, "actor_y": 400000.0,
         "actor_z": 100.0, "actor_health": 90.0},
        {"event_type": "Landing", "timestamp_ms": 1000,
         "actor_account": "acc.B", "actor_x": 410000.0, "actor_y": 410000.0,
         "actor_z": 100.0, "actor_health": 90.0}])

    # Match 2: A + C im Team 1 (andere Konstellation)
    insert_match(conn, "m2", "Baltic_Main", "squad", False, 1800,
                 "2026-05-02T10:00:00Z", None)
    insert_participants(conn, "m2", [_part("acc.A", "LuCKoR", 1),
                                      _part("acc.C", "Rando", 1)])
    db_pg.insert_team_mapping(conn.raw, T, "m2", [
        {"account_id": "acc.A", "team_id": 1},
        {"account_id": "acc.C", "team_id": 1}])
    insert_telemetry_events(conn, "m2", [
        {"event_type": "Landing", "timestamp_ms": 1000,
         "actor_account": "acc.A", "actor_x": 600000.0, "actor_y": 600000.0,
         "actor_z": 100.0, "actor_health": 90.0}])
    return conn


def test_landing_spots_filters_by_constellation():
    conn = _seed_landings()
    # Filter: A + B zusammen → nur Match 1 zaehlt
    res = compute_landing_spots(conn, T, "Baltic_Main", ["acc.A", "acc.B"])
    accs_with_points = {p["accountId"] for p in res["scatterPoints"]}
    assert "acc.A" in accs_with_points
    assert "acc.B" in accs_with_points
    # Match 2 (A+C) ist ausgeschlossen → A hat nur 1 Landung (aus m1)
    a_points = [p for p in res["scatterPoints"] if p["accountId"] == "acc.A"]
    assert len(a_points) == 1
    assert res["totalMatches"] == 1


def test_landing_spots_single_player_all_matches():
    conn = _seed_landings()
    # Nur A → beide Matches
    res = compute_landing_spots(conn, T, "Baltic_Main", ["acc.A"])
    a_points = [p for p in res["scatterPoints"] if p["accountId"] == "acc.A"]
    assert len(a_points) == 2
    assert res["totalMatches"] == 2


def test_landing_spots_route_filter_excludes_far_pois():
    conn = _seed_landings()
    # Flugroute fuer m1: zwei Cruise-Position-Events (z>=150000) entlang
    # der Linie x=400000 (vertikal). POI bei (400000,400000) liegt drauf
    # (0km Querdistanz), also bleibt er drin.
    conn.execute("INSERT INTO telemetry_events "
                 "(match_id, event_type, timestamp_ms, actor_account, actor_x, actor_y, actor_z) "
                 "VALUES ('m1','Position',100,'acc.A',400000,0,160000)")
    conn.execute("INSERT INTO telemetry_events "
                 "(match_id, event_type, timestamp_ms, actor_account, actor_x, actor_y, actor_z) "
                 "VALUES ('m1','Position',200,'acc.A',400000,800000,160000)")
    conn.commit()
    # Filter A allein, route_filter an. POIs der Map kommen aus pois_blob.
    pois = {"mapKm": 8, "regions": [
        {"name": "OnRoute",  "points": [[390000,390000],[410000,390000],
                                        [410000,410000],[390000,410000]]},
        {"name": "FarAway",  "points": [[10000,10000],[30000,10000],
                                        [30000,30000],[10000,30000]]},
    ]}
    res = compute_landing_spots(conn, T, "Baltic_Main", ["acc.A"],
                                pois_blob=pois, route_filter=True)
    # m1-Landung (400000,400000) ist auf der Route → bleibt.
    # m2 hat keine Cruise-Events → routeUnknown → bleibt ebenfalls.
    poi_names = {p["name"] for p in res["pois"]}
    assert "OnRoute" in poi_names


def test_squad_compare_table():
    conn = _setup()
    upsert_player(conn, "account.MA", "MateA", "steam", False)
    upsert_player(conn, "account.MB", "MateB", "steam", False)
    insert_match(conn, "sc1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", None)
    insert_participants(conn, "sc1", [
        {"account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1, "place": 3,
         "kills": 5, "headshot_kills": 1, "assists": 0, "dbnos": 0, "revives": 0,
         "damage_dealt": 500.0, "longest_kill": 0.0, "time_survived": 1500,
         "walk_distance": 0.0, "ride_distance": 0.0, "swim_distance": 0.0,
         "weapons_acquired": 0, "heals": 0, "boosts": 0, "team_kills": 0},
        {"account_id": "account.MA", "name": "MateA", "team_id": 1, "place": 3,
         "kills": 3, "headshot_kills": 0, "assists": 1, "dbnos": 0, "revives": 0,
         "damage_dealt": 300.0, "longest_kill": 0.0, "time_survived": 1500,
         "walk_distance": 0.0, "ride_distance": 0.0, "swim_distance": 0.0,
         "weapons_acquired": 0, "heals": 0, "boosts": 0, "team_kills": 0},
    ])
    res = compute_squad_compare(conn, T, "account.A", ["PEX_LuCKoR", "MateA"], 5)
    assert len(res["matchTable"]) == 1
    assert res["matchTable"][0]["cells"]["MateA"]["kills"] == 3
