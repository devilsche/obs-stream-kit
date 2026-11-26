"""Friend-Rig-Editor: Laden, Speichern, Löschen nur für Admins und nur als JSON."""
from app import create_app
from fx import friend_rig

RIG = {"poses": {"sit": {"head_jnt40_038": [0, 0, 0, 1]}}, "ears": 0.5}


def _client(conn, sid, root):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.config["_PROJECT_ROOT"] = root
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_admin_loads_saves_deletes(pg_conn_test_setup, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup
    c = _client(conn, sid, str(tmp_path))
    assert c.get("/app/api/friend-rig").json == {"ok": True, "rig": None}
    assert c.post("/app/api/friend-rig", json={"rig": RIG}).json["ok"]
    assert friend_rig.load(str(tmp_path))["ears"] == 0.5
    assert c.get("/app/api/friend-rig").json["rig"]["ears"] == 0.5
    assert c.post("/app/api/friend-rig", data={"rig": "x"}).status_code == 400
    assert c.post("/app/api/friend-rig", json={"rig": {"ears": 7}}).status_code == 400
    assert c.delete("/app/api/friend-rig").json["deleted"] is True


def test_non_admin_is_refused(pg_conn_test_setup_non_admin, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    c = _client(conn, sid, str(tmp_path))
    assert c.post("/app/api/friend-rig", json={"rig": RIG}).status_code == 403
    assert c.get("/app/api/friend-rig").status_code == 403
    assert c.delete("/app/api/friend-rig").status_code == 403
    assert friend_rig.load(str(tmp_path)) is None
