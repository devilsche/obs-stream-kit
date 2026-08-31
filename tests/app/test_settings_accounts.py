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


# ── Telemetrie-Archiv (SFTP) ────────────────────────────────────────────────

def _client(conn, sid):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_archive_form_saves_encrypted_config(pg_conn_test_setup):
    conn, tenant_id, _, sid = pg_conn_test_setup
    c = _client(conn, sid)
    resp = c.post("/app/settings/archive", data={
        "archive_host": "sftp.example", "archive_port": "2222",
        "archive_user": "user1", "archive_password": "geheim",
        "archive_path": "/eigenes/archiv"})
    assert resp.status_code == 302
    assert "archive=saved" in resp.headers["Location"]
    from core import credentials
    from pubg.archive_config import parse_config
    cfg = parse_config(credentials.get(conn, tenant_id).telemetry_archive)
    assert cfg["host"] == "sftp.example"
    assert cfg["port"] == 2222
    assert cfg["path"] == "/eigenes/archiv"
    # In der DB darf das Passwort nicht im Klartext liegen
    with conn.cursor() as cur:
        cur.execute("SELECT telemetry_archive_enc FROM tenant_credentials "
                    "WHERE tenant_id=%s", (tenant_id,))
        blob = bytes(cur.fetchone()["telemetry_archive_enc"])
    assert b"geheim" not in blob


def test_archive_form_keeps_password_when_left_empty(pg_conn_test_setup):
    """Sonst muesste man das Passwort bei jeder Pfad-Korrektur neu eintippen."""
    conn, tenant_id, _, sid = pg_conn_test_setup
    c = _client(conn, sid)
    c.post("/app/settings/archive", data={
        "archive_host": "sftp.example", "archive_user": "user1",
        "archive_password": "geheim", "archive_path": "/a"})
    c.post("/app/settings/archive", data={
        "archive_host": "sftp.example", "archive_user": "user1",
        "archive_password": "", "archive_path": "/b"})
    from core import credentials
    from pubg.archive_config import parse_config
    cfg = parse_config(credentials.get(conn, tenant_id).telemetry_archive)
    assert cfg["path"] == "/b"
    assert cfg["password"] == "geheim"


def test_archive_form_rejects_incomplete_input(pg_conn_test_setup):
    conn, tenant_id, _, sid = pg_conn_test_setup
    c = _client(conn, sid)
    resp = c.post("/app/settings/archive", data={
        "archive_host": "sftp.example", "archive_user": "",
        "archive_password": "x"})
    assert "archive=incomplete" in resp.headers["Location"]
    from core import credentials
    assert credentials.get(conn, tenant_id).telemetry_archive is None


def test_archive_can_be_removed(pg_conn_test_setup):
    conn, tenant_id, _, sid = pg_conn_test_setup
    c = _client(conn, sid)
    c.post("/app/settings/archive", data={
        "archive_host": "h", "archive_user": "u", "archive_password": "p"})
    resp = c.post("/app/settings/archive", data={"action": "delete"})
    assert "archive=removed" in resp.headers["Location"]
    from core import credentials
    assert credentials.get(conn, tenant_id).telemetry_archive is None


def test_archive_test_endpoint_reports_failure_without_connecting(pg_conn_test_setup):
    conn, _, _, sid = pg_conn_test_setup
    c = _client(conn, sid)
    r = c.post("/app/settings/archive/test", data={
        "archive_host": "", "archive_user": "", "archive_password": ""})
    assert r.status_code == 200
    assert r.get_json()["ok"] is False


def test_archive_test_endpoint_uses_the_form_values(pg_conn_test_setup):
    """Testen soll VOR dem Speichern moeglich sein."""
    from unittest import mock
    conn, _, _, sid = pg_conn_test_setup
    c = _client(conn, sid)
    with mock.patch("pubg.hidrive_telemetry.check_connection",
                    return_value={"ok": True, "error": None,
                                   "path": "/x", "files": 3}) as chk:
        r = c.post("/app/settings/archive/test", data={
            "archive_host": "neu.example", "archive_user": "u",
            "archive_password": "p", "archive_path": "/x"})
    assert r.get_json() == {"ok": True, "error": None, "path": "/x", "files": 3}
    assert chk.call_args.args[0]["host"] == "neu.example"


def test_settings_page_never_shows_the_password(pg_conn_test_setup):
    conn, _, _, sid = pg_conn_test_setup
    c = _client(conn, sid)
    c.post("/app/settings/archive", data={
        "archive_host": "sftp.example", "archive_user": "u",
        "archive_password": "streng-geheim", "archive_path": "/a"})
    body = c.get("/app/settings").get_data(as_text=True)
    assert "sftp.example" in body
    assert "streng-geheim" not in body
