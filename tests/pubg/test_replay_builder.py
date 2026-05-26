from pubg.replay_builder import normalize_coords


def test_normalize_coords_center_is_half():
    # Map-Mitte (4km von 8km) → 0.5/0.5
    x, y = normalize_coords(400000, 400000, mapKm=8)
    assert abs(x - 0.5) < 1e-6
    assert abs(y - 0.5) < 1e-6


def test_normalize_coords_origin_is_zero():
    x, y = normalize_coords(0, 0, mapKm=8)
    assert x == 0.0 and y == 0.0


def test_normalize_coords_clamps_out_of_range():
    # Über die Kartengrenze hinaus → geclamped auf [0,1]
    x, y = normalize_coords(9_000_000, -5000, mapKm=8)
    assert x == 1.0
    assert y == 0.0


def test_normalize_coords_sanhok_4km():
    x, y = normalize_coords(200000, 200000, mapKm=4)
    assert abs(x - 0.5) < 1e-6


from pubg.replay_builder import team_colors


def test_team_colors_assigns_distinct_per_team():
    colors = team_colors([1, 2, 3])
    assert set(colors.keys()) == {1, 2, 3}
    assert len(set(colors.values())) == 3  # alle verschieden
    for hexc in colors.values():
        assert hexc.startswith("#") and len(hexc) == 7


def test_team_colors_wraps_when_more_teams_than_palette():
    ids = list(range(1, 40))  # mehr als Palette
    colors = team_colors(ids)
    assert len(colors) == 39  # jedes Team kriegt eine Farbe (mit Wrap)
    for hexc in colors.values():
        assert hexc.startswith("#")


def test_team_colors_stable_order():
    # Gleiche Input-Menge → gleiche Zuordnung (sortiert nach team_id)
    a = team_colors([3, 1, 2])
    b = team_colors([1, 2, 3])
    assert a == b


from pubg.replay_builder import extract_events


def _raw_fixture():
    """Minimaler Raw-Blob: 1 Landing, 1 Position, 1 Hit, 1 Knock, 1 Kill."""
    return [
        {"_T": "LogParachuteLanding", "_D": "2026-05-01T10:00:10Z",
         "character": {"accountId": "acc.A", "name": "LuCKoR",
                       "location": {"x": 400000, "y": 400000, "z": 100}}},
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:15Z",
         "character": {"accountId": "acc.A", "name": "LuCKoR",
                       "location": {"x": 410000, "y": 405000, "z": 100}}},
        {"_T": "LogPlayerTakeDamage", "_D": "2026-05-01T10:01:30Z",
         "attacker": {"accountId": "acc.A", "name": "LuCKoR",
                      "location": {"x": 420000, "y": 410000, "z": 100}},
         "victim": {"accountId": "acc.B", "name": "Enemy",
                    "location": {"x": 425000, "y": 412000, "z": 100}},
         "damageCauserName": "WeapAK47_C"},
        {"_T": "LogPlayerMakeGroggy", "_D": "2026-05-01T10:01:31Z",
         "attacker": {"accountId": "acc.A", "name": "LuCKoR",
                      "location": {"x": 420000, "y": 410000, "z": 100}},
         "victim": {"accountId": "acc.B", "name": "Enemy",
                    "location": {"x": 425000, "y": 412000, "z": 100}},
         "damageCauserName": "WeapAK47_C", "distance": 5000},
        {"_T": "LogPlayerKillV2", "_D": "2026-05-01T10:01:35Z",
         "killer": {"accountId": "acc.A", "name": "LuCKoR",
                    "location": {"x": 420000, "y": 410000, "z": 100}},
         "victim": {"accountId": "acc.B", "name": "Enemy",
                    "location": {"x": 425000, "y": 412000, "z": 100}},
         "killerDamageInfo": {"damageCauserName": "WeapAK47_C", "distance": 5000}},
    ]


def test_extract_events_types_and_count():
    events = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    types = [e["type"] for e in events]
    assert "landing" in types
    assert "position" in types
    assert "hit" in types
    assert "knock" in types
    assert "kill" in types


def test_extract_events_sorted_by_ts():
    events = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    ts = [e["ts"] for e in events]
    assert ts == sorted(ts)


def test_extract_events_normalizes_coords():
    events = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    landing = next(e for e in events if e["type"] == "landing")
    assert abs(landing["x"] - 0.5) < 1e-6  # 400000/800000
    assert abs(landing["y"] - 0.5) < 1e-6


def test_extract_events_hit_has_both_endpoints():
    events = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    hit = next(e for e in events if e["type"] == "hit")
    assert "ax" in hit and "ay" in hit and "tx" in hit and "ty" in hit
    assert hit["actorId"] == "acc.A"
    assert hit["targetId"] == "acc.B"


def test_extract_events_kill_has_weapon_distance():
    events = extract_events(_raw_fixture(), mapKm=8, position_interval_ms=1000)
    kill = next(e for e in events if e["type"] == "kill")
    assert kill["weapon"] == "WeapAK47_C"
    assert kill["distance"] == 5000


def test_extract_events_position_interval_thins():
    # Zwei Position-Events 200ms auseinander, interval=1000 → nur erstes bleibt
    raw = [
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:00.000Z",
         "character": {"accountId": "acc.A", "name": "X",
                       "location": {"x": 1, "y": 1, "z": 100}}},
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:00.200Z",
         "character": {"accountId": "acc.A", "name": "X",
                       "location": {"x": 2, "y": 2, "z": 100}}},
        {"_T": "LogPlayerPosition", "_D": "2026-05-01T10:00:01.500Z",
         "character": {"accountId": "acc.A", "name": "X",
                       "location": {"x": 3, "y": 3, "z": 100}}},
    ]
    events = extract_events(raw, mapKm=8, position_interval_ms=1000)
    pos = [e for e in events if e["type"] == "position"]
    assert len(pos) == 2  # 0.0s und 1.5s; 0.2s wird verworfen


from pubg.replay_builder import build_replay


def test_build_replay_structure():
    raw = _raw_fixture()
    team_mapping = {"acc.A": 1, "acc.B": 2}
    names = {"acc.A": "LuCKoR", "acc.B": "Enemy"}
    result = build_replay(
        raw, match_id="m1", map_name="Baltic_Main", mapKm=8,
        team_mapping=team_mapping, names=names)
    assert result["matchId"] == "m1"
    assert result["mapName"] == "Baltic_Main"
    assert result["durationMs"] > 0
    # Teams: zwei Teams, jeweils mit Farbe + Spielern
    teams = {t["teamId"]: t for t in result["teams"]}
    assert set(teams.keys()) == {1, 2}
    assert teams[1]["color"].startswith("#")
    assert teams[1]["players"][0]["name"] == "LuCKoR"
    assert len(result["events"]) > 0


def test_build_replay_duration_from_last_event():
    raw = _raw_fixture()
    result = build_replay(
        raw, match_id="m1", map_name="Baltic_Main", mapKm=8,
        team_mapping={"acc.A": 1, "acc.B": 2},
        names={"acc.A": "LuCKoR", "acc.B": "Enemy"})
    # Erstes Event 10:00:10, letztes 10:01:35 → 85000ms
    assert result["durationMs"] == 85000


def test_build_replay_empty_raw_returns_empty_events():
    result = build_replay(
        [], match_id="m1", map_name="Baltic_Main", mapKm=8,
        team_mapping={}, names={})
    assert result["events"] == []
    assert result["durationMs"] == 0
