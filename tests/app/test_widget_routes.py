from app import create_app
from webcore.middleware import register_middleware
from app.views_widgets import bp_widgets
from app.views_static import bp_static


def _make_app(conn, root_dir):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.config["_PROJECT_ROOT"] = str(root_dir)
    register_middleware(app)
    app.register_blueprint(bp_widgets)
    app.register_blueprint(bp_static)
    return app


def test_widget_html_injects_serve_base(pg_conn_test_setup, tmp_path):
    conn, _, token, _ = pg_conn_test_setup
    (tmp_path / "widgets" / "pubg").mkdir(parents=True)
    (tmp_path / "widgets" / "pubg" / "last-match.html").write_text(
        "<html><head></head><body>HI</body></html>"
    )
    app = _make_app(conn, tmp_path)
    resp = app.test_client().get(f"/s/{token}/widgets/pubg/last-match.html")
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    assert "window.__SERVE_BASE__" in body
    assert token in body


def test_widget_static_no_token_needed(pg_conn_test_setup, tmp_path):
    conn, *_ = pg_conn_test_setup
    (tmp_path / "widgets" / "pubg" / "assets").mkdir(parents=True)
    (tmp_path / "widgets" / "pubg" / "assets" / "icon.png").write_bytes(b"\x89PNG")
    app = _make_app(conn, tmp_path)
    resp = app.test_client().get("/widgets-static/pubg/assets/icon.png")
    assert resp.status_code == 200
    assert resp.data.startswith(b"\x89PNG")


def test_unknown_token_404(pg_conn_test_setup, tmp_path):
    conn, *_ = pg_conn_test_setup
    app = _make_app(conn, tmp_path)
    resp = app.test_client().get("/s/tok_nope/widgets/pubg/last-match.html")
    assert resp.status_code == 404
