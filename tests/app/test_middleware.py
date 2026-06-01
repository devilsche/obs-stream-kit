import pytest
from flask import g, Blueprint, jsonify

from app import create_app
from webcore.middleware import register_middleware, require_session, require_admin


def _make_app_with_routes(pg_conn_factory):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = pg_conn_factory
    register_middleware(app)
    bp = Blueprint("test", __name__)

    @bp.route("/s/<token>/ping")
    def widget_ping(token):
        return jsonify({"tenant_id": g.tenant_id})

    @bp.route("/app/ping")
    @require_session
    def app_ping():
        return jsonify({"user_id": g.user["id"], "tenant_id": g.tenant_id})

    @bp.route("/admin/ping")
    @require_admin
    def admin_ping():
        return jsonify({"ok": True})

    app.register_blueprint(bp)
    return app


def test_widget_route_resolves_tenant_from_token(pg_conn_test_setup):
    conn, tenant_id, token, _ = pg_conn_test_setup
    app = _make_app_with_routes(lambda: conn)
    resp = app.test_client().get(f"/s/{token}/ping")
    assert resp.status_code == 200
    assert resp.json["tenant_id"] == tenant_id


def test_widget_route_unknown_token_404(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app_with_routes(lambda: conn)
    resp = app.test_client().get("/s/tok_doesnotexist/ping")
    assert resp.status_code == 404


def test_app_route_unauthenticated_redirects_to_login(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app_with_routes(lambda: conn)
    resp = app.test_client().get("/app/ping")
    assert resp.status_code == 302
    assert "/app/login" in resp.headers["Location"]


def test_app_route_with_valid_session(pg_conn_test_setup):
    conn, tenant_id, _, session_id = pg_conn_test_setup
    app = _make_app_with_routes(lambda: conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", session_id)
    resp = client.get("/app/ping")
    assert resp.status_code == 200
    assert resp.json["tenant_id"] == tenant_id


def test_admin_route_blocks_non_admin(pg_conn_test_setup_non_admin):
    conn, _, _, session_id = pg_conn_test_setup_non_admin
    app = _make_app_with_routes(lambda: conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", session_id)
    resp = client.get("/admin/ping")
    assert resp.status_code == 403


def test_unapproved_user_redirected_to_pending(pg_conn_test_setup_unapproved):
    conn, _, _, session_id = pg_conn_test_setup_unapproved
    app = _make_app_with_routes(lambda: conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", session_id)
    resp = client.get("/app/ping")
    assert resp.status_code == 302
    assert "/app/pending" in resp.headers["Location"]
