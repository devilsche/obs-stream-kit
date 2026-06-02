from unittest import mock


def test_dashboard_redirects_without_session(app):
    r = app.test_client().get("/")
    assert r.status_code == 302
    assert r.headers["Location"].startswith("https://stats-overlay.info/app/login")


def test_dashboard_lists_overlays_when_logged_in(app):
    from flask import g
    fake_user = {"id": 1, "is_admin": False, "is_approved": True,
                 "display_name": "LuCKoR"}

    @app.before_request
    def _login():
        g.user = fake_user
        g.tenant_id = 7

    with mock.patch("overlay_app.views_dashboard._tenant_token",
                    return_value="tok123"):
        r = app.test_client().get("/")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert "Starting Soon" in body
    assert "/s/tok123/overlays/starting-soon.html" in body
