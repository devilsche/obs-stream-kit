"""Endpoint-Dispatch gegen Postgres (der produktive Pfad).

Frueher gegen pubg/db.py (SQLite) — seit der PG-Migration deprecated.
Die Schreib-Helfer binden die tenant_id, damit die Testkoerper
unveraendert bleiben konnten.
"""
import json
from unittest.mock import MagicMock

import pytest

from pubg import db_pg
from pubg.cache import TTLCache
from pubg.endpoints import EndpointRegistry


CONN = None
T = None


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def upsert_player(conn, account_id, name, platform, is_self=False):
    db_pg.upsert_player(conn.raw, T, account_id, name, platform,
                        1 if is_self else 0)


def set_setting(conn, key, value):
    db_pg.set_setting(conn.raw, T, key, value)


def get_setting(conn, key, default=None):
    return db_pg.get_setting(conn.raw, T, key, default)


def upsert_lifetime(conn, account_id, mode, stats):
    db_pg.upsert_lifetime(conn.raw, T, account_id, mode, stats)


def _insert_match(conn, match_id, played_at, map_name="Baltic_Main",
                  game_mode="squad"):
    db_pg.insert_match(conn.raw, T, match_id, map_name, game_mode, False,
                       1800, played_at, None)


def _insert_participant(conn, match_id, account_id, name, team_id=1,
                        place=1, kills=0):
    db_pg.insert_participants(conn.raw, T, match_id, [{
        "account_id": account_id, "name": name, "team_id": team_id,
        "place": place, "kills": kills, "headshot_kills": 0, "assists": 0,
        "dbnos": 0, "revives": 0, "damage_dealt": 0.0, "longest_kill": 0.0,
        "time_survived": 0, "walk_distance": 0.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
        "team_kills": 0}])


def _insert_team_mapping(conn, match_id, account_id, team_id):
    db_pg.insert_team_mapping(conn.raw, T, match_id,
                              [{"account_id": account_id, "team_id": team_id}])


def _setup(_unused=None):
    upsert_player(CONN, "account.A", "PEX_LuCKoR", "steam", True)
    return CONN


def _registry(conn):
    return EndpointRegistry(
        get_conn=lambda: conn.raw,
        my_account_id="account.A",
        platform="steam",
        cache=TTLCache(ttl_secs=30),
        client=MagicMock(),
        poller_status=lambda: {"polling": "ok"},
        tenant_id=T,
    )


def test_session_endpoint_returns_json():
    conn = _setup()
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    reg = _registry(conn)
    body, code, ctype = reg.dispatch("GET", "/api/pubg/session", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert "kills" in payload


def test_status_endpoint():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/status", b"", {})
    assert code == 200
    assert json.loads(body)["polling"] == "ok"


def test_session_reset_endpoint():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("POST", "/api/pubg/session/reset", b"", {})
    assert code == 200
    assert get_setting(conn, "sessionStartedAt") is not None


def test_unknown_route_returns_404():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/foo", b"", {})
    assert code == 404


def test_top_mates_endpoint():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/top-mates?sortBy=avgPlace&limit=5&minMatches=10",
        b"", {})
    assert code == 200
    assert isinstance(json.loads(body), list)


def test_co_player_endpoint_unknown():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/co-player/Unknown", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert "error" in payload


def test_career_lifetime_endpoint_with_player_param():
    conn = _setup()
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


def test_settings_get_returns_all():
    conn = _setup()
    set_setting(conn, "minMatchesForTopMates", "10")
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/settings", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert payload["minMatchesForTopMates"] == "10"


def test_settings_post_persists():
    conn = _setup()
    reg = _registry(conn)
    body_in = json.dumps({"key": "minMatchesForTopMates", "value": "15"}).encode()
    body, code, _ = reg.dispatch("POST", "/api/pubg/settings", body_in, {})
    assert code == 200
    assert get_setting(conn, "minMatchesForTopMates") == "15"


def test_stamm_crew_is_not_implemented():
    """stamm_crew wurde bei der PG-Migration nicht mitgenommen — die Tabelle
    fehlt im PG_SCHEMA, die Routen sind bewusste 501-Stubs. Der Test haelt
    diesen Zustand fest, damit ein spaeteres Aktivieren auffaellt."""
    conn = _setup()
    upsert_player(conn, "account.MA", "MateA", "steam", False)
    reg = _registry(conn)
    body_in = json.dumps({"add": "MateA"}).encode()
    _, code, _ = reg.dispatch("POST", "/api/pubg/stamm-crew", body_in, {})
    assert code == 501
    # GET ist ein Leer-Stub, damit Widgets nicht auf einen Fehler laufen
    body, code, _ = reg.dispatch("GET", "/api/pubg/stamm-crew", b"", {})
    assert code == 200
    assert json.loads(body) == []


# ── Task 5: /api/pubg/matches-list ───────────────────────────────────────────

def test_matches_list_returns_recent():
    conn = _setup()
    _insert_match(conn, "m1", "2026-05-26T10:00:00Z", "Baltic_Main", "squad")
    _insert_participant(conn, "m1", "account.A", "PEX_LuCKoR", 3, 2, 5)
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


def test_match_replay_requires_match_id():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/match-replay", b"", {})
    assert code == 400


def test_match_replay_builds_and_caches():
    conn = _setup()
    _insert_match(conn, "m1", "2026-05-26T10:00:00Z", "Baltic_Main", "squad")
    _insert_team_mapping(conn, "m1", "account.A", 1)
    _insert_team_mapping(conn, "m1", "account.B", 2)
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


def test_match_replay_404_when_no_telemetry():
    conn = _setup()
    _insert_match(conn, "m2", "2026-05-26T10:00:00Z", "Baltic_Main", "squad")
    conn.commit()
    reg = _registry(conn)
    with patch("pubg.hidrive_telemetry.download_raw", return_value=None):
        body, code, _ = reg.dispatch(
            "GET", "/api/pubg/match-replay?match=m2", b"", {})
        assert code == 404


def test_match_replay_falls_back_to_db_squad_events():
    """Kein Roh-Blob mehr (nicht archiviert, kein CDN) — aber telemetry_events
    steht noch in der DB. Daraus muss ein Replay entstehen statt einer 404."""
    conn = _setup()
    _insert_match(conn, "m3", "2026-05-26T10:00:00Z", "Baltic_Main", "squad")
    _insert_team_mapping(conn, "m3", "account.A", 1)
    _insert_team_mapping(conn, "m3", "account.B", 2)
    db_pg.insert_telemetry_events(conn.raw, "m3", [
        {"event_type": "Landing", "timestamp_ms": 1_700_000_000_000,
         "actor_account": "account.A", "actor_x": 400000.0,
         "actor_y": 400000.0, "actor_z": 120.0},
        {"event_type": "Kill", "timestamp_ms": 1_700_000_060_000,
         "actor_account": "account.A", "target_account": "account.B",
         "actor_x": 400000.0, "actor_y": 400000.0,
         "victim_x": 410000.0, "victim_y": 410000.0,
         "weapon": "WeapAK47_C", "distance": 90.0},
    ])
    conn.commit()
    reg = _registry(conn)
    reg.client = None      # kein Live-API-Weg
    with patch("pubg.hidrive_telemetry.download_raw", return_value=None):
        body, code, _ = reg.dispatch(
            "GET", "/api/pubg/match-replay?match=m3", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert payload["replaySource"] == "db-squad"
    assert any(e["type"] == "kill" for e in payload["events"])
    # Die Luecken muessen benannt sein, sonst liest das UI sie als Wahrheit.
    assert payload["coverage"]["zones"] is False
    assert payload["coverage"]["positions"] == "squad-only"


def test_match_replay_from_raw_declares_full_coverage():
    conn = _setup()
    _insert_match(conn, "m4", "2026-05-26T10:00:00Z", "Baltic_Main", "squad")
    _insert_team_mapping(conn, "m4", "account.A", 1)
    conn.commit()
    raw = [{"_T": "LogParachuteLanding", "_D": "2026-05-26T10:00:10Z",
            "character": {"accountId": "account.A",
                          "location": {"x": 400000, "y": 400000, "z": 100}}}]
    reg = _registry(conn)
    with patch("pubg.hidrive_telemetry.download_raw", return_value=raw):
        body, code, _ = reg.dispatch(
            "GET", "/api/pubg/match-replay?match=m4", b"", {})
    assert code == 200
    assert json.loads(body)["coverage"]["zones"] is True


def test_match_replay_404_stays_when_the_db_is_empty_too():
    conn = _setup()
    _insert_match(conn, "m5", "2026-05-26T10:00:00Z", "Baltic_Main", "squad")
    conn.commit()
    reg = _registry(conn)
    reg.client = None
    with patch("pubg.hidrive_telemetry.download_raw", return_value=None):
        body, code, _ = reg.dispatch(
            "GET", "/api/pubg/match-replay?match=m5", b"", {})
    assert code == 404


def test_lobby_kd_rejects_a_bad_range():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/lobby-kd?range=epoch",
                                  b"", {})
    assert code == 400


def test_lobby_kd_reports_coverage_per_match():
    """Ohne Abdeckung liest man einen Schnitt aus 2 von 90 Spielern wie einen
    vollstaendigen."""
    from pubg import db_pg
    conn = _setup()
    # Season-Stats gibt es je Spielmodus — das Match muss zum abgefragten
    # Modus passen, sonst gäbe es keine vergleichbaren Zahlen.
    _insert_match(conn, "lk1", "2026-05-20T18:00:00Z", "Baltic_Main", "squad-fpp")
    _insert_participant(conn, "lk1", "account.A", "PEX_LuCKoR", team_id=1)
    for acc, team in (("account.A", 1), ("account.F1", 7), ("account.F2", 7),
                      ("ai.9", 12)):
        _insert_team_mapping(conn, "lk1", acc, team)
    # Hauptzahl ist Alltime — die Snapshots liegen unter dem lifetime-Schlüssel.
    db_pg.upsert_season_snapshots(conn.raw, "lifetime", "squad-fpp", {
        "account.A": {"kills": 100, "losses": 50, "rounds": 60, "wins": 5,
                       "damage": 1.0, "kd": 2.0},
        "account.F1": {"kills": 40, "losses": 40, "rounds": 50, "wins": 1,
                        "damage": 1.0, "kd": 1.0},
    }, "2026-05-20T00:00:00Z")
    conn.commit()
    reg = _registry(conn)
    body, code, _ = reg.dispatch(
        "GET", "/api/pubg/lobby-kd?range=all&season=s1", b"", {})
    assert json.loads(body)["basis"] == "lifetime"
    assert code == 200
    data = json.loads(body)
    m = data["matches"][0]
    # "Lobby" heisst: alle ausser uns — der eigene Squad steckte sonst in
    # beiden Seiten des Vergleichs. Bots zaehlen ohnehin nicht mit.
    assert m["lobbyPlayers"] == 2
    assert m["known"] == 1
    assert m["lobbyKd"] == 1.0
    assert m["squadKd"] == 2.0
    assert m["diff"] == 1.0


def test_squad_playstyle_rejects_a_bad_range():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch(
        "GET", "/api/pubg/squad-playstyle?range=epoch", b"", {})
    assert code == 400


def test_squad_playstyle_reports_rows_per_mate():
    conn = _setup()
    upsert_player(conn, "account.MATE", "MateA", "steam", False)
    for i, mid in enumerate(("ps1", "ps2", "ps3")):
        _insert_match(conn, mid, f"2026-05-2{i}T18:00:00Z")
        _insert_participant(conn, mid, "account.A", "PEX_LuCKoR", team_id=1)
        _insert_participant(conn, mid, "account.MATE", "MateA", team_id=1)
        _insert_team_mapping(conn, mid, "account.A", 1)
        _insert_team_mapping(conn, mid, "account.MATE", 1)
        _insert_team_mapping(conn, mid, "account.FOE", 7)
        base = 1_700_000_000_000 + i * 3_600_000
        db_pg.insert_telemetry_events(conn.raw, mid, [
            {"event_type": "Landing", "timestamp_ms": base,
             "actor_account": "account.A", "actor_x": 0.0, "actor_y": 0.0},
            {"event_type": "TakeDamage", "timestamp_ms": base + 30_000,
             "actor_account": "account.A", "target_account": "account.FOE",
             "actor_x": 0.0, "actor_y": 0.0,
             "victim_x": 5000.0, "victim_y": 0.0},
            {"event_type": "Knock", "timestamp_ms": base + 32_000,
             "actor_account": "account.A", "target_account": "account.FOE"},
        ])
    conn.commit()
    reg = _registry(conn)
    body, code, _ = reg.dispatch(
        "GET", "/api/pubg/squad-playstyle?range=all&minMatches=1", b"", {})
    assert code == 200
    data = json.loads(body)
    me = next(r for r in data["rows"] if r["accountId"] == "account.A")
    assert me["matches"] == 3
    assert me["opened"] == 3
    assert me["openedWithDown"] == 3
    assert me["openHitPct"] == 100.0
    assert me["downsPerOpen"] == 1.0


def test_squad_playstyle_session_range_resolves_the_cutoff():
    """range=all umgeht die Zeitraum-Aufloesung — der Session-Zweig muss
    eigenstaendig getestet werden, sonst faellt ein fehlender Import erst
    live auf."""
    conn = _setup()
    set_setting(conn, "sessionStartedAt", "1970-01-01T00:00:00Z")
    reg = _registry(conn)
    body, code, _ = reg.dispatch(
        "GET", "/api/pubg/squad-playstyle?range=session", b"", {})
    assert code == 200, body


def test_squad_playstyle_players_filter_needs_everyone_in_the_match():
    """Mit players=X zaehlen nur Matches, in denen X wirklich dabei war."""
    conn = _setup()
    upsert_player(conn, "account.MATE", "MateA", "steam", False)
    _insert_match(conn, "ps9", "2026-05-20T18:00:00Z")
    _insert_participant(conn, "ps9", "account.A", "PEX_LuCKoR", team_id=1)
    _insert_team_mapping(conn, "ps9", "account.A", 1)
    db_pg.insert_telemetry_events(conn.raw, "ps9", [
        {"event_type": "Landing", "timestamp_ms": 1_700_000_000_000,
         "actor_account": "account.A", "actor_x": 0.0, "actor_y": 0.0}])
    conn.commit()
    reg = _registry(conn)
    body, code, _ = reg.dispatch(
        "GET", "/api/pubg/squad-playstyle?range=all&minMatches=1&players=MateA",
        b"", {})
    assert code == 200
    assert json.loads(body)["rows"] == []


def test_player_search_matches_prefix():
    conn = _setup()
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


def test_player_search_empty_query_returns_empty():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/player-search?q=", b"", {})
    assert code == 200
    assert json.loads(body) == []


def test_landing_heatmap_endpoint():
    conn = _setup()
    _insert_match(conn, "m1", "2026-05-01T10:00:00Z")
    _insert_team_mapping(conn, "m1", "account.A", 1)
    db_pg.insert_telemetry_events(conn.raw, "m1", [
        {"event_type": "Landing", "timestamp_ms": 1000,
         "actor_account": "account.A", "actor_x": 400000.0,
         "actor_y": 400000.0, "actor_z": 100.0, "actor_health": 90.0}])
    reg = _registry(conn)
    body, code, _ = reg.dispatch(
        "GET", "/api/pubg/landing-heatmap?map=Baltic_Main&p0=account.A", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert payload["totalMatches"] == 1
    assert len(payload["scatterPoints"]) == 1


def test_landing_heatmap_requires_map():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/landing-heatmap", b"", {})
    assert code == 400


def test_performance_history_endpoint_defaults_to_session():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/performance-history", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert payload["groupBy"] == "session"
    assert payload["groups"] == []


def test_performance_history_endpoint_rejects_bad_groupby():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/performance-history?groupBy=century", b"", {})
    assert code == 400


def test_performance_history_endpoint_unknown_player():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/performance-history?player=GibtsNicht", b"", {})
    assert code == 404


def test_performance_history_endpoint_player_is_case_insensitive():
    """Nicknames tippt man selten mit exakter Gross-/Kleinschreibung —
    'nipplz' muss denselben Account finden wie 'Nipplz'."""
    conn = _setup()
    upsert_player(conn, "account.MA", "Nipplz", "steam", False)
    reg = _registry(conn)
    for variant in ("Nipplz", "nipplz", "NIPPLZ"):
        body, code, _ = reg.dispatch("GET",
            f"/api/pubg/performance-history?player={variant}", b"", {})
        assert code == 200, f"{variant} -> {code}"


def test_match_analysis_requires_match_id():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/match-analysis", b"", {})
    assert code == 400


def test_match_analysis_reports_unavailable_telemetry():
    """Kein Archiv-Eintrag und keine telemetry_url -> 404 mit Begruendung,
    kein Stacktrace."""
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/match-analysis?matchId=gibtsnicht", b"", {})
    assert code == 404
    assert "gibtsnicht" in json.loads(body).get("error", "")


def test_weapon_performance_rejects_bad_range():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/weapon-performance?range=century", b"", {})
    assert code == 400


def test_weapon_performance_rejects_bad_groupby():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/weapon-performance?groupBy=galaxy", b"", {})
    assert code == 400


def test_weapon_performance_without_matches_is_empty_not_error():
    conn = _setup()
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/weapon-performance?range=all", b"", {})
    assert code == 200
    d = json.loads(body)
    assert d["rows"] == [] and d["matchesPending"] == 0
