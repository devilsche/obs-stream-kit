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
