"""Logo-Cut-Editor: Liste, Speichern, Löschen nur für Admins und nur als JSON."""
import os

from app import create_app
from fx import logo_cuts

SQ = [[0, 0], [10, 0], [10, 10]]


def _client(conn, sid, root):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.config["_PROJECT_ROOT"] = root
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_admin_lists_saves_deletes(pg_conn_test_setup, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup
    os.makedirs(tmp_path / "assets"); open(tmp_path / "assets" / "t.png", "wb").close()
    c = _client(conn, sid, str(tmp_path))
    assert c.get("/app/api/logo-cuts").json["images"] == ["t.png"]
    assert c.post("/app/api/logo-cuts", json={"file": "t.png", "parts": [{"poly": SQ}]}).json["ok"]
    assert logo_cuts.load(str(tmp_path))["t.png"][0]["poly"] == SQ
    assert c.post("/app/api/logo-cuts", data={"file": "t.png"}).status_code == 400
    assert c.post("/app/api/logo-cuts", json={"file": "t.png", "parts": []}).status_code == 400
    assert c.delete("/app/api/logo-cuts/t.png").json["deleted"] is True


def test_non_admin_is_refused(pg_conn_test_setup_non_admin, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    os.makedirs(tmp_path / "assets"); open(tmp_path / "assets" / "t.png", "wb").close()
    c = _client(conn, sid, str(tmp_path))
    assert c.post("/app/api/logo-cuts", json={"file": "t.png", "parts": [{"poly": SQ}]}).status_code == 403
    assert c.get("/app/api/logo-cuts").status_code == 403
    assert logo_cuts.load(str(tmp_path)) == {}
