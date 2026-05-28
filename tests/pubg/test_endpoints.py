import json
from unittest.mock import MagicMock
from pubg.db import (connect, init_schema, upsert_player, set_setting,
                     get_setting, upsert_lifetime)
from pubg.cache import TTLCache
from pubg.endpoints import EndpointRegistry


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    return conn


def _registry(conn):
    return EndpointRegistry(
        get_conn=lambda: conn,
        my_account_id="account.A",
        platform="steam",
        cache=TTLCache(ttl_secs=30),
        client=MagicMock(),
        poller_status=lambda: {"polling": "ok"},
        tenant_id=1,
    )


def test_session_endpoint_returns_json(tmp_db_path):
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    reg = _registry(conn)
    body, code, ctype = reg.dispatch("GET", "/api/pubg/session", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert "kills" in payload


def test_status_endpoint(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/status", b"", {})
    assert code == 200
    assert json.loads(body)["polling"] == "ok"


def test_session_reset_endpoint(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("POST", "/api/pubg/session/reset", b"", {})
    assert code == 200
    assert get_setting(conn, "sessionStartedAt") is not None


def test_unknown_route_returns_404(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/foo", b"", {})
    assert code == 404


def test_top_mates_endpoint(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/top-mates?sortBy=avgPlace&limit=5&minMatches=10",
        b"", {})
    assert code == 200
    assert isinstance(json.loads(body), list)


def test_co_player_endpoint_unknown(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/co-player/Unknown", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert "error" in payload


def test_career_lifetime_endpoint_with_player_param(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.B", "MateA", "steam", False)
    upsert_lifetime(conn, "account.B", "all", {"rounds_played": 100,
        "wins": 5, "top10s": 30, "win_rate": 5.0, "top10_rate": 30.0,
        "kills": 200, "kd_ratio": 2.0, "headshot_kills": 50,
        "headshot_rate": 25.0, "avg_damage": 300.0, "longest_kill": 100.0,
        "time_survived_sec": 1000})
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/career-lifetime?player=MateA&mode=all", b"", {})
    assert code == 200
    assert json.loads(body)["wins"] == 5


def test_settings_get_returns_all(tmp_db_path):
    conn = _setup(tmp_db_path)
    set_setting(conn, "minMatchesForTopMates", "10")
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/settings", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert payload["minMatchesForTopMates"] == "10"


def test_settings_post_persists(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body_in = json.dumps({"key": "minMatchesForTopMates", "value": "15"}).encode()
    body, code, _ = reg.dispatch("POST", "/api/pubg/settings", body_in, {})
    assert code == 200
    assert get_setting(conn, "minMatchesForTopMates") == "15"


def test_stamm_crew_add_and_list(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.MA", "MateA", "steam", False)
    reg = _registry(conn)
    body_in = json.dumps({"add": "MateA"}).encode()
    body, code, _ = reg.dispatch("POST", "/api/pubg/stamm-crew", body_in, {})
    assert code == 200
    body, code, _ = reg.dispatch("GET", "/api/pubg/stamm-crew", b"", {})
    assert "MateA" in body.decode()


# ── Task 5: /api/pubg/matches-list ───────────────────────────────────────────

def test_matches_list_returns_recent(tmp_db_path):
    conn = _setup(tmp_db_path)
    conn.execute(
        "INSERT INTO matches (match_id, played_at, map_name, game_mode) "
        "VALUES (?,?,?,?)",
        ("m1", "2026-05-26T10:00:00Z", "Baltic_Main", "squad"))
    conn.execute(
        "INSERT INTO participants (match_id, account_id, name, team_id, place, kills) "
        "VALUES (?,?,?,?,?,?)",
        ("m1", "account.A", "PEX_LuCKoR", 3, 2, 5))
    conn.commit()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/matches-list?limit=10", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert isinstance(payload, list)
    assert payload[0]["matchId"] == "m1"
    assert payload[0]["mapName"] == "Baltic_Main"
    assert payload[0]["place"] == 2
    assert payload[0]["kills"] == 5


# ── Task 6: /api/pubg/match-replay ───────────────────────────────────────────
from unittest.mock import patch


def test_match_replay_requires_match_id(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/match-replay", b"", {})
    assert code == 400


def test_match_replay_builds_and_caches(tmp_db_path):
    conn = _setup(tmp_db_path)
    conn.execute(
        "INSERT INTO matches (match_id, played_at, map_name, game_mode) "
        "VALUES (?,?,?,?)",
        ("m1", "2026-05-26T10:00:00Z", "Baltic_Main", "squad"))
    conn.execute(
        "INSERT INTO match_team_mapping (match_id, account_id, team_id) "
        "VALUES (?,?,?)", ("m1", "account.A", 1))
    conn.execute(
        "INSERT INTO match_team_mapping (match_id, account_id, team_id) "
        "VALUES (?,?,?)", ("m1", "account.B", 2))
    conn.commit()

    raw = [
        {"_T": "LogParachuteLanding", "_D": "2026-05-26T10:00:10Z",
         "character": {"accountId": "account.A", "name": "PEX_LuCKoR",
                       "location": {"x": 400000, "y": 400000, "z": 100}}},
        {"_T": "LogPlayerKillV2", "_D": "2026-05-26T10:01:00Z",
         "killer": {"accountId": "account.A", "name": "PEX_LuCKoR",
                    "location": {"x": 400000, "y": 400000, "z": 100}},
         "victim": {"accountId": "account.B", "name": "Foe",
                    "location": {"x": 410000, "y": 410000, "z": 100}},
         "killerDamageInfo": {"damageCauserName": "WeapAK47_C", "distance": 90}},
    ]
    reg = _registry(conn)
    with patch("pubg.hidrive_telemetry.download_raw", return_value=raw) as dl:
        body, code, _ = reg.dispatch(
            "GET", "/api/pubg/match-replay?match=m1", b"", {})
        assert code == 200
        payload = json.loads(body)
        assert payload["matchId"] == "m1"
        assert len(payload["teams"]) == 2
        assert any(e["type"] == "kill" for e in payload["events"])
        # Zweiter Aufruf → Cache, kein zweiter Download
        reg.dispatch("GET", "/api/pubg/match-replay?match=m1", b"", {})
        assert dl.call_count == 1


def test_match_replay_404_when_no_telemetry(tmp_db_path):
    conn = _setup(tmp_db_path)
    conn.execute(
        "INSERT INTO matches (match_id, played_at, map_name, game_mode) "
        "VALUES (?,?,?,?)", ("m2", "2026-05-26T10:00:00Z", "Baltic_Main", "squad"))
    conn.commit()
    reg = _registry(conn)
    with patch("pubg.hidrive_telemetry.download_raw", return_value=None):
        body, code, _ = reg.dispatch(
            "GET", "/api/pubg/match-replay?match=m2", b"", {})
        assert code == 404


def test_player_search_matches_prefix(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.B", "Mate1", "steam", False)
    upsert_player(conn, "account.C", "LuckyGuy", "steam", False)
    conn.commit()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/player-search?q=Luc", b"", {})
    assert code == 200
    payload = json.loads(body)
    names = {p["name"] for p in payload}
    assert "PEX_LuCKoR" in names      # account.A aus _setup
    assert "LuckyGuy" in names
    assert "Mate1" not in names


def test_player_search_empty_query_returns_empty(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/player-search?q=", b"", {})
    assert code == 200
    assert json.loads(body) == []


def test_landing_heatmap_endpoint(tmp_db_path):
    conn = _setup(tmp_db_path)
    conn.execute("INSERT INTO matches (match_id, played_at, map_name, game_mode) "
                 "VALUES ('m1','2026-05-01T10:00:00Z','Baltic_Main','squad')")
    conn.execute("INSERT INTO match_team_mapping (match_id, account_id, team_id) "
                 "VALUES ('m1','account.A',1)")
    conn.execute("INSERT INTO telemetry_events "
                 "(match_id, event_type, timestamp_ms, actor_account, actor_x, actor_y, actor_z, actor_health) "
                 "VALUES ('m1','Landing',1000,'account.A',400000,400000,100,90)")
    conn.commit()
    reg = _registry(conn)
    body, code, _ = reg.dispatch(
        "GET", "/api/pubg/landing-heatmap?map=Baltic_Main&p0=account.A", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert payload["totalMatches"] == 1
    assert len(payload["scatterPoints"]) == 1


def test_landing_heatmap_requires_map(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/landing-heatmap", b"", {})
    assert code == 400
