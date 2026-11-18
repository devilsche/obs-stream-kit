"""Auto-Editor: Speichern/Löschen nur für Admins und nur als JSON."""
from app import create_app
from fx import car_models


def _client(conn, sid, root):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.config["_PROJECT_ROOT"] = root
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_admin_saves_and_deletes(pg_conn_test_setup, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup
    c = _client(conn, sid, str(tmp_path))
    for kind in ("vehicles", "rims"):
        r = c.post("/app/api/cars/" + kind, json={"key": "my-" + kind, "def": {"label": "Mine"}})
        assert r.status_code == 200 and r.json["ok"]
        assert car_models.load(str(tmp_path), kind) == {"my-" + kind: {"label": "Mine"}}
        assert c.post("/app/api/cars/" + kind, json={"key": "Bad Key", "def": {}}).status_code == 400
        assert c.delete("/app/api/cars/" + kind + "/my-" + kind).json["deleted"] is True
        assert car_models.load(str(tmp_path), kind) == {}
    assert c.post("/app/api/cars/boats", json={"key": "x", "def": {}}).status_code == 404


def test_form_posts_are_refused(pg_conn_test_setup, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup
    r = _client(conn, sid, str(tmp_path)).post("/app/api/cars/vehicles", data={"key": "x", "def": "{}"})
    assert r.status_code == 400 and car_models.load(str(tmp_path), "vehicles") == {}


def test_non_admin_is_refused(pg_conn_test_setup_non_admin, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    c = _client(conn, sid, str(tmp_path))
    assert c.post("/app/api/cars/vehicles", json={"key": "x", "def": {}}).status_code == 403
    assert c.delete("/app/api/cars/rims/x").status_code == 403
    assert car_models.load(str(tmp_path), "vehicles") == {}


def test_picks_save_and_list(pg_conn_test_setup, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup
    c = _client(conn, sid, str(tmp_path))
    uid = "0123456789abcdef0123456789abcdef"
    assert c.post("/app/api/cars/picks", json={"key": uid, "def": {"keep": True}}).json["ok"]
    assert c.get("/app/api/cars/picks").json["items"] == {uid: {"keep": True}}
    assert c.get("/app/api/cars/boats").status_code == 404


def test_non_admin_cannot_list_picks(pg_conn_test_setup_non_admin, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    assert _client(conn, sid, str(tmp_path)).get("/app/api/cars/picks").status_code == 403
