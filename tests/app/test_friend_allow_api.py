"""Dashboard: Friend-Erlaubnisliste speichern/lesen – nur per fetch, Namen bereinigt; der Chat-Befehl prüft sie."""
from app import create_app
from fx import friend_allow


def _client(conn, sid, root):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.config["_PROJECT_ROOT"] = str(root)
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_save_and_load(pg_conn_test_setup_non_admin, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    c = _client(conn, sid, tmp_path)
    assert c.get("/app/api/friend-allow").get_json()["names"] == []
    assert c.post("/app/api/friend-allow", json={"names": "Hat3"}).status_code == 400   # ohne fetch-Header
    r = c.post("/app/api/friend-allow", json={"names": "@Hat3, Moonwave_xD\nhat3"}, headers={"X-Requested-With": "fetch"})
    assert r.get_json()["names"] == ["hat3", "moonwave_xd"]
    assert c.get("/app/api/friend-allow").get_json()["names"] == ["hat3", "moonwave_xd"]
    assert friend_allow.load(conn, tid) == ["hat3", "moonwave_xd"]
