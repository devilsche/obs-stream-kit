from app import create_app
from app.middleware import register_middleware
from app.views_admin import bp_admin


def _make_app(conn):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    register_middleware(app)
    app.register_blueprint(bp_admin)
    return app


def test_approve_creates_tenant(pg_conn_test_setup):
    conn, _, _, admin_sid = pg_conn_test_setup
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO users (twitch_user_id, display_name, is_approved)
            VALUES ('555', 'Pending', FALSE) RETURNING id
        """)
        pending_uid = cur.fetchone()["id"]
    conn.commit()

    app = _make_app(conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", admin_sid)
    resp = client.post(f"/admin/users/{pending_uid}/approve")
    assert resp.status_code == 302

    with conn.cursor() as cur:
        cur.execute("SELECT is_approved FROM users WHERE id = %s", (pending_uid,))
        assert cur.fetchone()["is_approved"] is True
        cur.execute(
            "SELECT count(*) AS n FROM tenants WHERE owner_user_id = %s",
            (pending_uid,)
        )
        assert cur.fetchone()["n"] == 1
        cur.execute("""
            SELECT count(*) AS n FROM widget_tokens
            WHERE tenant_id = (SELECT id FROM tenants WHERE owner_user_id = %s)
        """, (pending_uid,))
        assert cur.fetchone()["n"] == 1


def test_deny_keeps_is_approved_false(pg_conn_test_setup):
    conn, _, _, admin_sid = pg_conn_test_setup
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO users (twitch_user_id, display_name, is_approved)
            VALUES ('666', 'Deny', FALSE) RETURNING id
        """)
        uid = cur.fetchone()["id"]
    conn.commit()

    app = _make_app(conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", admin_sid)
    resp = client.post(f"/admin/users/{uid}/deny")
    assert resp.status_code == 302

    with conn.cursor() as cur:
        cur.execute("SELECT is_approved FROM users WHERE id = %s", (uid,))
        assert cur.fetchone()["is_approved"] is False
        cur.execute(
            "SELECT count(*) AS n FROM tenants WHERE owner_user_id = %s", (uid,)
        )
        assert cur.fetchone()["n"] == 0


def test_non_admin_403(pg_conn_test_setup_non_admin):
    conn, _, _, sid = pg_conn_test_setup_non_admin
    app = _make_app(conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", sid)
    resp = client.post("/admin/users/9999/approve")
    assert resp.status_code == 403
