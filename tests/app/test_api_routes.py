from app import create_app
from webcore.middleware import register_middleware
from app.views_api import bp_api


def _make_app(conn):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    register_middleware(app)
    app.register_blueprint(bp_api)
    return app


def test_api_via_token_path(pg_conn_test_setup):
    conn, tenant_id, token, _ = pg_conn_test_setup
    app = _make_app(conn)
    resp = app.test_client().get(f"/s/{token}/api/pubg/healthz-tenant")
    assert resp.status_code == 200
    assert resp.json["tenant_id"] == tenant_id


def test_api_via_session_cookie(pg_conn_test_setup):
    conn, tenant_id, _, sid = pg_conn_test_setup
    app = _make_app(conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", sid)
    resp = client.get("/api/pubg/healthz-tenant")
    assert resp.status_code == 200
    assert resp.json["tenant_id"] == tenant_id


def test_api_unauthenticated_401(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app(conn)
    resp = app.test_client().get("/api/pubg/healthz-tenant")
    assert resp.status_code == 401
