from flask import Flask, g
from webcore.middleware import require_session


def _app(login_url=None):
    app = Flask(__name__)
    if login_url:
        app.config["LOGIN_URL"] = login_url

    @app.route("/secret")
    @require_session
    def secret():
        return "ok"

    @app.before_request
    def _no_user():
        g.user = None
    return app


def test_default_login_redirect():
    c = _app().test_client()
    r = c.get("/secret")
    assert r.status_code == 302
    assert r.headers["Location"] == "/app/login"


def test_custom_login_redirect():
    c = _app("https://stats-overlay.info/app/login").test_client()
    r = c.get("/secret")
    assert r.status_code == 302
    assert r.headers["Location"] == "https://stats-overlay.info/app/login"
