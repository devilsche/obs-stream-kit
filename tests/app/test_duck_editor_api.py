"""Duck-Editor: Speichern/Löschen nur für Admins und nur als JSON."""
from app import create_app
from fx import duck_outfits


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
    r = c.post("/app/api/ducks/outfits", json={"key": "my-duck", "def": {"label": "Mine"}})
    assert r.status_code == 200 and r.json["ok"]
    assert duck_outfits.load(str(tmp_path)) == {"my-duck": {"label": "Mine"}}
    assert c.post("/app/api/ducks/outfits", json={"key": "Bad Key", "def": {}}).status_code == 400
    assert c.delete("/app/api/ducks/outfits/my-duck").json["deleted"] is True
    assert duck_outfits.load(str(tmp_path)) == {}


def test_form_posts_are_refused(pg_conn_test_setup, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup
    r = _client(conn, sid, str(tmp_path)).post("/app/api/ducks/outfits", data={"key": "x", "def": "{}"})
    assert r.status_code == 400 and duck_outfits.load(str(tmp_path)) == {}


def test_non_admin_is_refused(pg_conn_test_setup_non_admin, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    r = _client(conn, sid, str(tmp_path)).post("/app/api/ducks/outfits", json={"key": "x", "def": {}})
    assert r.status_code == 403 and duck_outfits.load(str(tmp_path)) == {}
