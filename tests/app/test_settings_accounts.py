"""Settings: Verwaltung mehrerer verfolgter PUBG-Accounts."""
from app import create_app
from core import credentials as core_creds
from pubg import db_pg


def _make_app(conn):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    return app


def _client(conn, sid):
    c = _make_app(conn).test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_settings_page_lists_tracked_accounts(pg_conn_test_setup):
    conn, tid, _, sid = pg_conn_test_setup
    db_pg.add_tracked_player(conn, tid, "Zqx_Primary_1", platform="steam",
                             is_primary=True)
    db_pg.add_tracked_player(conn, tid, "Zqx_Alt_2", platform="steam")
    body = _client(conn, sid).get("/app/settings").get_data(as_text=True)
    assert "Zqx_Primary_1" in body and "Zqx_Alt_2" in body


def test_settings_page_backfills_from_credentials(pg_conn_test_setup):
    """Bestandskonto ohne Liste: der bisherige Name taucht als primaer auf."""
    conn, tid, _, sid = pg_conn_test_setup
    core_creds.set_pubg(conn, tid, name="AltName", platform="steam")
    _client(conn, sid).get("/app/settings")
    rows = db_pg.list_tracked_players(conn, tid)
    assert [(r["name"], r["is_primary"]) for r in rows] == [("AltName", True)]


def test_add_account(pg_conn_test_setup):
    conn, tid, _, sid = pg_conn_test_setup
    resp = _client(conn, sid).post("/app/settings/accounts",
                                   data={"action": "add", "name": "NeuerAlt"})
    assert resp.status_code == 302
    assert "NeuerAlt" in [r["name"] for r in db_pg.list_tracked_players(conn, tid)]


def test_add_account_rejects_empty_name(pg_conn_test_setup):
    conn, tid, _, sid = pg_conn_test_setup
    _client(conn, sid).post("/app/settings/accounts",
                            data={"action": "add", "name": "   "})
    assert db_pg.list_tracked_players(conn, tid) == []


def test_remove_account(pg_conn_test_setup):
    conn, tid, _, sid = pg_conn_test_setup
    db_pg.add_tracked_player(conn, tid, "Weg")
    _client(conn, sid).post("/app/settings/accounts",
                            data={"action": "remove", "name": "Weg"})
    assert db_pg.list_tracked_players(conn, tid) == []


def test_set_primary_also_updates_credentials(pg_conn_test_setup):
    """Der Primaer-Account bleibt die Quelle fuer bestehenden Ein-Account-Code."""
    conn, tid, _, sid = pg_conn_test_setup
    core_creds.set_pubg(conn, tid, name="Haupt", platform="steam")
    db_pg.add_tracked_player(conn, tid, "Haupt", platform="steam",
                             is_primary=True)
    db_pg.add_tracked_player(conn, tid, "Zweit", platform="steam")
    _client(conn, sid).post("/app/settings/accounts",
                            data={"action": "primary", "name": "Zweit"})
    assert core_creds.get(conn, tid).pubg_name == "Zweit"
    prim = [r["name"] for r in db_pg.list_tracked_players(conn, tid)
            if r["is_primary"]]
    assert prim == ["Zweit"]


def test_accounts_endpoint_requires_session(pg_conn_test_setup):
    conn, tid, _, _ = pg_conn_test_setup
    resp = _make_app(conn).test_client().post(
        "/app/settings/accounts", data={"action": "add", "name": "Fremd"})
    assert resp.status_code in (302, 401, 403)
    assert db_pg.list_tracked_players(conn, tid) == []


def test_set_primary_clears_stale_account_id(pg_conn_test_setup):
    """Die gecachte account_id gehoert zum alten Namen — sonst pollt der
    Poller weiter den falschen Account."""
    conn, tid, _, sid = pg_conn_test_setup
    core_creds.set_pubg(conn, tid, name="Haupt", platform="steam",
                        account_id="account.haupt")
    db_pg.add_tracked_player(conn, tid, "Haupt", is_primary=True)
    db_pg.add_tracked_player(conn, tid, "Zweit")
    _client(conn, sid).post("/app/settings/accounts",
                            data={"action": "primary", "name": "Zweit"})
    assert core_creds.get(conn, tid).pubg_account_id is None


def test_first_added_account_becomes_primary_and_credential(pg_conn_test_setup):
    """Neukonto: der erste Account ist primaer und fuellt creds.pubg_name —
    sonst blockt das creds_gate die Widgets."""
    conn, tid, _, sid = pg_conn_test_setup
    _client(conn, sid).post("/app/settings/accounts",
                            data={"action": "add", "name": "Erster"})
    rows = db_pg.list_tracked_players(conn, tid)
    assert [(r["name"], r["is_primary"]) for r in rows] == [("Erster", True)]
    assert core_creds.get(conn, tid).pubg_name == "Erster"
