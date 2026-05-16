from pubg.db import (connect, init_schema, upsert_player, insert_match,
                     insert_participants, insert_telemetry_events,
                     insert_team_mapping)
from pubg.aggregations import compute_match_detail


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    upsert_player(conn, "account.B", "Mate1", "steam", False)
    return conn


def _basic_match(conn, mid="m1", played_at="2026-05-15T18:00:00Z"):
    insert_match(conn, mid, "Baltic_Main", "squad-fpp", False, 1800, played_at, None)
    parts = []
    for acc, name in (("account.A", "PEX_LuCKoR"), ("account.B", "Mate1")):
        parts.append({
            "account_id": acc, "name": name, "team_id": 1,
            "place": 5, "kills": 2, "headshot_kills": 0, "assists": 0,
            "dbnos": 0, "revives": 0, "damage_dealt": 200.0,
            "longest_kill": 10.0, "time_survived": 600,
            "walk_distance": 0, "ride_distance": 0, "swim_distance": 0,
            "weapons_acquired": 0, "heals": 0, "boosts": 0, "team_kills": 0,
        })
    insert_participants(conn, mid, parts)
    insert_team_mapping(conn, mid, [
        {"account_id": "account.A", "team_id": 1, "kills": 2, "place": 5, "time_survived": 600},
        {"account_id": "account.B", "team_id": 1, "kills": 2, "place": 5, "time_survived": 600},
    ])
    return mid


def test_lives_single_life_wraps_landing_and_death(tmp_db_path):
    """Standard-Match (1 Leben): lives[0] enthaelt Landing+Death+Kills."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    events = [
        # Plane-Cruise erreicht (z>=150000) bei ts=5000
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        # Landing bei ts=60000
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        # Position danach
        {"event_type": "Position", "timestamp_ms": 120000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 210000.0, "actor_y": 215000.0, "actor_z": 80.0,
         "actor_health": 90.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        # Kill durch Member
        {"event_type": "Kill", "timestamp_ms": 500000,
         "actor_account": "account.A", "target_account": "account.ENEMY1",
         "actor_x": 250000.0, "actor_y": 260000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 251000.0, "victim_y": 260500.0,
         "weapon": "WeapHK416_C", "distance": 1500.0, "damage": 100.0,
         "payload_json": None},
        # Death des Members
        {"event_type": "Kill", "timestamp_ms": 700000,
         "actor_account": "account.ENEMY2", "target_account": "account.A",
         "actor_x": 290000.0, "actor_y": 295000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 290500.0, "victim_y": 295200.0,
         "weapon": "WeapBerylM762_C", "distance": 800.0, "damage": 95.0,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    assert "lives" in me, "members[].lives field fehlt"
    assert len(me["lives"]) == 1
    life = me["lives"][0]
    assert life["lifeIndex"] == 1
    # Landing
    assert life["landing"]["x"] == 200000.0
    assert life["landing"]["y"] == 200000.0
    assert life["landing"]["tsMs"] == 60000
    # Death
    assert life["death"] is not None
    assert life["death"]["x"] == 290500.0  # victim coords
    assert life["death"]["y"] == 295200.0
    assert life["death"]["weaponId"] == "WeapBerylM762_C"
    assert life["death"]["weaponName"] == "Beryl"  # via _weapon_label
    assert life["death"]["distanceM"] == 8.0  # 800cm / 100
    # Kills in diesem Leben
    assert len(life["kills"]) == 1
    assert life["kills"][0]["actorX"] == 250000.0
    assert life["kills"][0]["victimX"] == 251000.0
    # Pfade
    assert len(life["planeRoute"]) >= 1
    # planeRoute geht von cruise+3s (=8000ms) bis Landing (60000ms)
    for pt in life["planeRoute"]:
        assert pt[2] >= 8000 and pt[2] <= 60000
    # groundPath von Landing (60000) bis Death (700000)
    assert len(life["groundPath"]) >= 1
    for pt in life["groundPath"]:
        assert pt[2] >= 60000 and pt[2] <= 700000


def test_lives_survival_has_no_death(tmp_db_path):
    """Member ueberlebt: lives[0].death == None."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    events = [
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 600000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 250000.0, "actor_y": 260000.0, "actor_z": 100.0,
         "actor_health": 80.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    assert len(me["lives"]) == 1
    assert me["lives"][0]["death"] is None


def test_lives_comeback_creates_two_lives(tmp_db_path):
    """Comeback-Modus: nach Death im selben Match wieder Plane+Landing.
    lives[0] = erstes Leben (mit Death), lives[1] = zweites Leben."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    events = [
        # Leben 1: Plane → Landing → Death
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Kill", "timestamp_ms": 400000,
         "actor_account": "account.ENEMY1", "target_account": "account.A",
         "actor_x": 220000.0, "actor_y": 220000.0, "actor_z": 100.0,
         "actor_health": 100.0,
         "victim_x": 220500.0, "victim_y": 220500.0,
         "weapon": "WeapHK416_C", "distance": 500.0, "damage": 100.0,
         "payload_json": None},
        # Comeback: Leben 2 — neue Plane-Cruise + Landing
        {"event_type": "Position", "timestamp_ms": 500000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 300000.0, "actor_y": 300000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 550000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 400000.0, "actor_y": 400000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 700000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 410000.0, "actor_y": 410000.0, "actor_z": 100.0,
         "actor_health": 70.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    assert len(me["lives"]) == 2, f"Erwarte 2 Lives, bekommen {len(me['lives'])}"
    l1, l2 = me["lives"]
    assert l1["lifeIndex"] == 1 and l2["lifeIndex"] == 2
    # Leben 1: Death bei 400000
    assert l1["death"] is not None
    assert l1["death"]["tsMs"] == 400000
    # Leben 2: Landing bei 550000, kein Death (survived)
    assert l2["landing"]["tsMs"] == 550000
    assert l2["death"] is None


def test_path_timestamps_inside_lives(tmp_db_path):
    """Pfade in lives[].planeRoute und lives[].groundPath sind
    [x, y, ts_ms] 3-Tupel und chronologisch sortiert."""
    conn = _setup(tmp_db_path)
    mid = _basic_match(conn)
    events = [
        {"event_type": "Position", "timestamp_ms": 5000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 100000.0, "actor_y": 100000.0, "actor_z": 160000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 30000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 150000.0, "actor_y": 150000.0, "actor_z": 100000.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Landing", "timestamp_ms": 60000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 200000.0, "actor_y": 200000.0, "actor_z": 100.0,
         "actor_health": 100.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
        {"event_type": "Position", "timestamp_ms": 120000,
         "actor_account": "account.A", "target_account": None,
         "actor_x": 210000.0, "actor_y": 210000.0, "actor_z": 80.0,
         "actor_health": 90.0, "victim_x": None, "victim_y": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": None},
    ]
    insert_telemetry_events(conn, mid, events)
    d = compute_match_detail(conn, "account.A", mid)
    me = next(m for m in d["members"] if m["isSelf"])
    life = me["lives"][0]
    for pt in life["planeRoute"]:
        assert len(pt) == 3
        assert isinstance(pt[2], int)
    for pt in life["groundPath"]:
        assert len(pt) == 3
        assert isinstance(pt[2], int)
    pr_ts = [pt[2] for pt in life["planeRoute"]]
    gp_ts = [pt[2] for pt in life["groundPath"]]
    assert pr_ts == sorted(pr_ts)
    assert gp_ts == sorted(gp_ts)
