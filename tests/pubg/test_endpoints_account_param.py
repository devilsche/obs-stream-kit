"""?account=-Parameter: Widgets koennen die Account-Perspektive waehlen."""
import json

from core.db_compat import SqliteCompatConn
from pubg import db_pg
from pubg.cache import TTLCache
from pubg.endpoints import EndpointRegistry
from tests.pubg.test_db_pg_tenant import pg  # noqa: F401  (Fixture-Reuse)


def _registry(conn, tenant_id, my_account_id="account.haupt"):
    return EndpointRegistry(
        get_conn=lambda: conn,
        my_account_id=my_account_id,
        platform="steam",
        cache=TTLCache(),
        client=None,
        poller_status=lambda: {},
        tenant_id=tenant_id,
    )


def _body(resp):
    payload = resp[0]
    return json.loads(payload) if isinstance(payload, (str, bytes)) else payload


def _seed_two_accounts(conn, tenant_id):
    db_pg.add_tracked_player(conn, tenant_id, "Haupt", platform="steam",
                             account_id="account.haupt", is_primary=True)
    db_pg.add_tracked_player(conn, tenant_id, "Zweit", platform="steam",
                             account_id="account.zweit")


def test_accounts_endpoint_lists_tracked(pg):  # noqa: F811
    conn, t1, _ = pg
    _seed_two_accounts(conn, t1)
    reg = _registry(SqliteCompatConn(conn), t1)
    resp = reg.dispatch("GET", "/api/pubg/accounts", b"", {})
    body = _body(resp)
    names = [a["name"] for a in body["accounts"]]
    assert names == ["Haupt", "Zweit"]
    assert body["accounts"][0]["isPrimary"] is True


def test_account_param_switches_perspective(pg):  # noqa: F811
    conn, t1, _ = pg
    _seed_two_accounts(conn, t1)
    reg = _registry(SqliteCompatConn(conn), t1)
    reg.dispatch("GET", "/api/pubg/session?account=Zweit", b"", {})
    assert reg.my_account_id == "account.zweit"


def test_account_param_accepts_account_id(pg):  # noqa: F811
    conn, t1, _ = pg
    _seed_two_accounts(conn, t1)
    reg = _registry(SqliteCompatConn(conn), t1)
    reg.dispatch("GET", "/api/pubg/session?account=account.zweit", b"", {})
    assert reg.my_account_id == "account.zweit"


def test_unknown_account_is_rejected(pg):  # noqa: F811
    """Ein nicht verfolgter Account darf nicht stillschweigend zum
    Primaer-Account werden — sonst zeigt das Widget falsche Zahlen."""
    conn, t1, _ = pg
    _seed_two_accounts(conn, t1)
    reg = _registry(SqliteCompatConn(conn), t1)
    resp = reg.dispatch("GET", "/api/pubg/session?account=Fremder", b"", {})
    assert resp[1] == 400


def test_cache_is_scoped_per_account(pg):  # noqa: F811
    """Ohne Account-Scope wuerde der zweite Account die Zahlen des ersten
    aus dem Cache bekommen."""
    conn, t1, _ = pg
    _seed_two_accounts(conn, t1)
    cache = TTLCache()
    calls = []

    def _fake_session(c, tenant, acc, rng):
        calls.append(acc)
        return {"account": acc}

    import pubg.endpoints as ep
    orig = ep.compute_session_stats
    ep.compute_session_stats = _fake_session
    try:
        for acc in ("Haupt", "Zweit"):
            reg = EndpointRegistry(
                get_conn=lambda: SqliteCompatConn(conn),
                my_account_id="account.haupt", platform="steam",
                cache=cache, client=None, poller_status=lambda: {},
                tenant_id=t1)
            reg.dispatch("GET", f"/api/pubg/session?account={acc}", b"", {})
    finally:
        ep.compute_session_stats = orig
    assert calls == ["account.haupt", "account.zweit"]


def _patch_session(monkey_values):
    """compute_session_stats je Account durch feste Werte ersetzen."""
    import pubg.endpoints as ep
    orig = ep.compute_session_stats
    ep.compute_session_stats = lambda c, t, acc, rng: monkey_values[acc]
    return ep, orig


def test_account_all_sums_additive_fields(pg):  # noqa: F811
    conn, t1, _ = pg
    _seed_two_accounts(conn, t1)
    values = {
        "account.haupt": {"matches": 10, "kills": 20, "damage": 1000.0,
                          "wins": 2, "top10s": 5, "kd": 2.5, "kpm": 2.0,
                          "headshotPct": 50.0, "bestPlace": 1,
                          "longestKill": 120.0, "totalHeals": 7,
                          "sessionStartedAt": "2026-08-04T10:00:00Z",
                          "mapBreakdown": [{"map": "Erangel", "count": 10}]},
        "account.zweit": {"matches": 5, "kills": 5, "damage": 500.0,
                          "wins": 0, "top10s": 1, "kd": 1.0, "kpm": 1.0,
                          "headshotPct": 20.0, "bestPlace": 3,
                          "longestKill": 300.0, "totalHeals": 3,
                          "sessionStartedAt": "2026-08-04T09:00:00Z",
                          "mapBreakdown": [{"map": "Erangel", "count": 2},
                                           {"map": "Miramar", "count": 3}]},
    }
    ep, orig = _patch_session(values)
    try:
        reg = _registry(SqliteCompatConn(conn), t1)
        body = _body(reg.dispatch("GET", "/api/pubg/session?account=all",
                                  b"", {}))
    finally:
        ep.compute_session_stats = orig
    assert body["matches"] == 15
    assert body["kills"] == 25
    assert body["damage"] == 1500.0
    assert body["totalHeals"] == 10
    # Verhaeltnisse werden neu gerechnet, nicht addiert
    assert body["kd"] == 25 / (15 - 2)
    assert body["kpm"] == 25 / 15
    # Extremwerte: bestes Ergebnis bzw. weitester Kill
    assert body["bestPlace"] == 1
    assert body["longestKill"] == 300.0
    # Frueheste Session zaehlt
    assert body["sessionStartedAt"] == "2026-08-04T09:00:00Z"
    maps = {m["map"]: m["count"] for m in body["mapBreakdown"]}
    assert maps == {"Erangel": 12, "Miramar": 3}
    assert body["accountScope"] == "all"


def test_account_all_headshot_pct_is_kill_weighted(pg):  # noqa: F811
    """20 Kills mit 50% und 5 Kills mit 20% ergeben nicht 35%."""
    conn, t1, _ = pg
    _seed_two_accounts(conn, t1)
    values = {
        "account.haupt": {"matches": 1, "kills": 20, "headshotPct": 50.0},
        "account.zweit": {"matches": 1, "kills": 5, "headshotPct": 20.0},
    }
    ep, orig = _patch_session(values)
    try:
        reg = _registry(SqliteCompatConn(conn), t1)
        body = _body(reg.dispatch("GET", "/api/pubg/session?account=all",
                                  b"", {}))
    finally:
        ep.compute_session_stats = orig
    assert round(body["headshotPct"], 4) == round((10 + 1) / 25 * 100, 4)


def test_account_all_rejected_where_not_summable(pg):  # noqa: F811
    """Season-Rang und aehnliche Kennzahlen lassen sich nicht addieren."""
    conn, t1, _ = pg
    _seed_two_accounts(conn, t1)
    reg = _registry(SqliteCompatConn(conn), t1)
    resp = reg.dispatch("GET", "/api/pubg/last-match?account=all", b"", {})
    assert resp[1] == 400
