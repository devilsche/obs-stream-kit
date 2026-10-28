"""Settings: API-Keys werden vor dem Speichern geprueft — ein Steam-Key im
PUBG-Feld darf den PUBG-Key nicht mehr ueberschreiben."""
import pytest

from app import create_app
from core import credentials as core_creds
from core import key_check

PUBG_OLD = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9." + "o" * 180 + ".old"
PUBG_NEW = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9." + "n" * 180 + ".new"
STEAM_OLD = "A" * 32
STEAM_NEW = "B0B" + "1" * 29


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    monkeypatch.setattr(key_check, "_http_status", lambda url, headers=None: 200)


def _client(conn, sid):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def _seed(conn, tid):
    core_creds.set_pubg(conn, tid, name="Haupt", platform="steam",
                        api_key=PUBG_OLD)
    core_creds.set_steam(conn, tid, steam_id="76561198000000000",
                         api_key=STEAM_OLD)


def test_steam_key_in_pubg_field_is_rejected_and_nothing_saved(pg_conn_test_setup):
    conn, tid, _, sid = pg_conn_test_setup
    _seed(conn, tid)
    resp = _client(conn, sid).post("/app/settings", data={
        "pubg_api_key": STEAM_NEW, "steam_api_key": STEAM_NEW})
    assert resp.status_code == 302
    assert "pubg_err=pubg_is_steam" in resp.headers["Location"]
    creds = core_creds.get(conn, tid)
    assert creds.pubg_api_key == PUBG_OLD      # nicht ueberschrieben
    assert creds.steam_api_key == STEAM_OLD    # ganzes Formular verworfen


def test_rejected_key_is_not_saved(pg_conn_test_setup, monkeypatch):
    conn, tid, _, sid = pg_conn_test_setup
    _seed(conn, tid)
    monkeypatch.setattr(key_check, "_http_status", lambda url, headers=None: 403)
    resp = _client(conn, sid).post("/app/settings",
                                   data={"steam_api_key": STEAM_NEW})
    assert "steam_err=steam_rejected" in resp.headers["Location"]
    assert core_creds.get(conn, tid).steam_api_key == STEAM_OLD


def test_valid_keys_are_saved(pg_conn_test_setup):
    conn, tid, _, sid = pg_conn_test_setup
    _seed(conn, tid)
    resp = _client(conn, sid).post("/app/settings", data={
        "pubg_api_key": "  " + PUBG_NEW + " ", "steam_api_key": STEAM_NEW})
    assert resp.headers["Location"].endswith("/app/settings?saved=1")
    creds = core_creds.get(conn, tid)
    assert creds.pubg_api_key == PUBG_NEW      # Leerzeichen abgeschnitten
    assert creds.steam_api_key == STEAM_NEW


def test_error_is_shown_on_the_field(pg_conn_test_setup):
    conn, tid, _, sid = pg_conn_test_setup
    _seed(conn, tid)
    body = _client(conn, sid).get(
        "/app/settings?pubg_err=pubg_is_steam").get_data(as_text=True)
    assert 'id="pubg_api_key_err"' in body
    assert 'aria-invalid="true"' in body
    assert "Steam key" in body
