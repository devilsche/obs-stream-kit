from unittest import mock


class _Creds:
    twitch_channel = "luckor"
    twitch_client_id = "cid"


def test_overlay_html_injects_channel(app):
    c = app.test_client()
    with mock.patch("overlay_app.views_overlays._tenant_creds",
                    return_value=_Creds()):
        r = c.get("/s/tok/overlays/starting-soon.html")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert 'window.__TWITCH_CHANNEL__ = "luckor";' in body
    assert 'window.__SERVE_BASE__ = "/s/tok/";' in body
    assert 'window.__TWITCH_CLIENT_ID__ = "cid";' in body


def test_overlay_asset_served(app):
    c = app.test_client()
    r = c.get("/s/tok/assets/DM-Sans.woff2")
    assert r.status_code == 200
