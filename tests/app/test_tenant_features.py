"""Admin schaltet Features je Tenant frei (/admin/tenants/<id>/features)."""
from app import create_app
from core import features


def _make_app(conn):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    return app


def test_admin_sets_and_clears_features(pg_conn_test_setup):
    conn, tid, _, admin_sid = pg_conn_test_setup
    client = _make_app(conn).test_client()
    client.set_cookie("obskit_sid", admin_sid, domain="localhost")
    r = client.post(f"/admin/tenants/{tid}/features", data={"feature": ["sushi-eater", "unknown"]})
    assert r.status_code == 302
    assert features.enabled(conn, tid) == ["sushi-eater"]
    page = client.get("/admin/users").get_data(as_text=True)
    assert 'value="sushi-eater"' in page and "checked" in page
    client.post(f"/admin/tenants/{tid}/features", data={})
    assert features.enabled(conn, tid) == []


def test_non_admin_cannot_set_features(pg_conn_test_setup_non_admin):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    client = _make_app(conn).test_client()
    client.set_cookie("obskit_sid", sid, domain="localhost")
    assert client.post(f"/admin/tenants/{tid}/features", data={"feature": "sushi-eater"}).status_code == 403
