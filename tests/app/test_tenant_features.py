"""Admin schaltet Features je Tenant frei (/admin/tenants/<id>/features)."""
from app import create_app
from core import features


def _make_app(conn):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    return app


def _other_tenant(conn):
    with conn.cursor() as cur:
        cur.execute("INSERT INTO users (display_name, is_admin, is_approved, twitch_user_id) "
                    "VALUES ('Streamer', FALSE, TRUE, '777') RETURNING id")
        uid = cur.fetchone()["id"]
        cur.execute("INSERT INTO tenants (owner_user_id, slug, display_name) VALUES (%s, 'other', 'Other') RETURNING id", (uid,))
        tid = cur.fetchone()["id"]
    conn.commit()
    return tid


def test_admin_tenant_shows_all(pg_conn_test_setup):
    conn, tid, _, admin_sid = pg_conn_test_setup
    client = _make_app(conn).test_client()
    client.set_cookie("obskit_sid", admin_sid, domain="localhost")
    assert "All (admin)" in client.get("/admin/users").get_data(as_text=True)
    assert features.effective(conn, tid) == sorted(features.FEATURES)


def test_admin_sets_and_clears_features(pg_conn_test_setup):
    conn, _, _, admin_sid = pg_conn_test_setup
    tid = _other_tenant(conn)
    assert features.effective(conn, tid) == []
    client = _make_app(conn).test_client()
    client.set_cookie("obskit_sid", admin_sid, domain="localhost")
    r = client.post(f"/admin/tenants/{tid}/features", data={"feature": ["sushi-eater", "unknown"]})
    assert r.status_code == 302
    assert features.enabled(conn, tid) == ["sushi-eater"]
    assert features.effective(conn, tid) == ["sushi-eater"]
    page = client.get("/admin/users").get_data(as_text=True)
    assert 'value="sushi-eater"' in page and "checked" in page
    client.post(f"/admin/tenants/{tid}/features", data={})
    assert features.enabled(conn, tid) == []


def test_non_admin_cannot_set_features(pg_conn_test_setup_non_admin):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    client = _make_app(conn).test_client()
    client.set_cookie("obskit_sid", sid, domain="localhost")
    assert client.post(f"/admin/tenants/{tid}/features", data={"feature": "sushi-eater"}).status_code == 403
