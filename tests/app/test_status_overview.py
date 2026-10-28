"""Status-Uebersichten: Admin-Tabelle je Tenant, Status-Kachel fuer den
eigenen Tenant, interner Status-Endpoint des API-Service und der auf den
eigenen Tenant begrenzte /api/pubg/status."""
import datetime

import pytest

from app import create_app
from app import status_overview as so
from core import credentials
from pubg import db_pg


def _iso(days_ago=0, minutes_ago=0):
    dt = (datetime.datetime.now(datetime.timezone.utc)
          - datetime.timedelta(days=days_ago, minutes=minutes_ago))
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _match(conn, tid, mid, played_at, telemetry=1):
    db_pg.insert_match(conn, tid, mid, "Erangel_Main", "squad-fpp", 0, 1800,
                       played_at, None)
    if telemetry:
        db_pg.mark_telemetry_fetched(conn, tid, mid)


POLLER = {
    "pubg": {"lastPollAt": "2026-10-28T10:00:00Z", "perTenant": {}},
    "steam": {},
    "reachable": True,
}


@pytest.fixture
def fake_poller(monkeypatch):
    state = {"value": POLLER}
    monkeypatch.setattr(so, "poller_status", lambda: state["value"])
    return state


# ── tenant_overview (DB) ──────────────────────────────────────────────────

def test_tenant_overview_counts_and_keys(pg_conn_test_setup):
    conn, tid, _, _ = pg_conn_test_setup
    credentials.set_pubg(conn, tid, name="Ich", platform="steam", api_key="k")
    _match(conn, tid, "old", _iso(days_ago=30))
    _match(conn, tid, "new1", _iso(days_ago=2))
    _match(conn, tid, "new2", _iso(minutes_ago=30), telemetry=0)
    rows = so.tenant_overview(conn)
    me = next(r for r in rows if r["id"] == tid)
    assert me["matches"] == 3
    assert me["matches_7d"] == 2
    assert me["telemetry_pending"] == 1          # nur juenger als 14 Tage
    assert me["pubg_key"] is True and me["steam_key"] is False
    assert me["last_match"].startswith(_iso(minutes_ago=30)[:13])


def test_merge_marks_pubg_error(pg_conn_test_setup):
    conn, tid, _, _ = pg_conn_test_setup
    credentials.set_steam(conn, tid, steam_id="76561198000000000",
                          api_key="A" * 32)
    status = {"pubg": {"perTenant": {str(tid): {
                  "polling": "error", "errors": ["players: HTTP 401: Unauthorized"]}}},
              "steam": {str(tid): {"lastError": "Steam API HTTP 403"}},
              "reachable": True}
    row = so.merge_status(so.tenant_overview(conn), status)[0]
    assert row["pubg_state"] == "error"
    assert "401" in row["pubg_detail"]
    assert row["steam_state"] == "error"
    assert "403" in row["steam_detail"]


def test_merge_without_poller_data_is_unknown(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    row = so.merge_status(so.tenant_overview(conn),
                          {"pubg": {}, "steam": {}, "reachable": False})[0]
    assert row["pubg_state"] == "unknown"


def test_poller_status_unreachable_falls_back(monkeypatch):
    def boom(*a, **k):
        raise OSError("connection refused")
    monkeypatch.setattr(so, "_fetch_internal", boom)
    monkeypatch.setattr(so, "_in_process", lambda: None)
    s = so.poller_status()
    assert s["reachable"] is False and s["pubg"] == {}


def test_ago_formatting():
    assert so.ago(_iso(minutes_ago=5)) == "5 min ago"
    assert so.ago(_iso(minutes_ago=150)) == "2 h ago"
    assert so.ago(_iso(days_ago=3)) == "3 days ago"
    assert so.ago(None) == "—"


# ── Seiten ────────────────────────────────────────────────────────────────

def _client(conn, sid):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_admin_page_shows_tenant_table(pg_conn_test_setup, fake_poller):
    conn, tid, _, sid = pg_conn_test_setup
    fake_poller["value"] = {"pubg": {"perTenant": {str(tid): {
        "polling": "error", "errors": ["players: HTTP 401: Unauthorized"]}}},
        "steam": {}, "reachable": True}
    body = _client(conn, sid).get("/admin/").get_data(as_text=True)
    assert 'class="dn-table dn-table--status"' in body
    assert "HTTP 401" in body
    assert "TestTenant" in body


def test_admin_page_forbidden_for_non_admin(pg_conn_test_setup_non_admin, fake_poller):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    resp = _client(conn, sid).get("/admin/")
    assert resp.status_code in (302, 403)


def test_tenant_dashboard_shows_real_poller_error(pg_conn_test_setup, fake_poller):
    conn, tid, _, sid = pg_conn_test_setup
    credentials.set_pubg(conn, tid, name="Ich", platform="steam", api_key="k")
    _match(conn, tid, "m1", _iso(minutes_ago=12))
    fake_poller["value"] = {"pubg": {"perTenant": {str(tid): {
        "polling": "error", "errors": ["players: HTTP 401: Unauthorized"]}}},
        "steam": {}, "reachable": True}
    body = _client(conn, sid).get("/app/").get_data(as_text=True)
    assert "HTTP 401" in body
    assert "12 min ago" in body


# ── API-Service ───────────────────────────────────────────────────────────

def test_internal_status_only_from_loopback():
    from api_app import create_app as create_api
    client = create_api(testing=True).test_client()
    assert client.get("/internal/status").status_code == 200
    resp = client.get("/internal/status",
                      environ_base={"REMOTE_ADDR": "203.0.113.9"})
    assert resp.status_code == 404


def test_pubg_status_only_shows_own_tenant(monkeypatch):
    from app import views_api
    monkeypatch.setattr(views_api, "_pubg_status_all", lambda: {
        "lastPollAt": "x", "errors": ["A: boom", "B: bang"],
        "perTenant": {"1": {"polling": "ok", "errors": []},
                      "3": {"polling": "error", "errors": ["B: bang"]}}})
    s = views_api._pubg_status_for(3)
    assert list(s["perTenant"].keys()) == ["3"]
    assert s["errors"] == ["B: bang"]
    assert s["lastPollAt"] == "x"


def test_key_without_account_is_named(pg_conn_test_setup):
    """Tenant mit Key, aber ohne PUBG-Account: der Poller ueberspringt ihn —
    die Uebersicht muss sagen, was fehlt, statt 'no pubg credentials'."""
    conn, tid, _, _ = pg_conn_test_setup
    credentials.set_pubg(conn, tid, platform="steam", api_key="eyJ" + "x" * 200)
    status = {"pubg": {"perTenant": {str(tid): {
                  "polling": "skip", "reason": "no-pubg-credentials"}}},
              "steam": {}, "reachable": True}
    row = so.merge_status(so.tenant_overview(conn), status)[0]
    assert row["pubg_state"] == "skip"
    assert row["pubg_detail"] == "key set, but no PUBG account added"


def test_dashboard_names_missing_account(pg_conn_test_setup, fake_poller):
    conn, tid, _, sid = pg_conn_test_setup
    credentials.set_pubg(conn, tid, platform="steam", api_key="eyJ" + "x" * 200)
    body = _client(conn, sid).get("/app/").get_data(as_text=True)
    assert "PUBG account missing" in body
    assert "API key + in-game name missing" not in body
