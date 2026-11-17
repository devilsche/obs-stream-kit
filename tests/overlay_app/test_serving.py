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


def test_overlay_html_injects_features(app):
    c = app.test_client()
    with mock.patch("overlay_app.views_overlays._tenant_creds", return_value=_Creds()):
        r = c.get("/s/tok/effects/item-rain.html")
    assert 'window.__FEATURES__ = [];' in r.get_data(as_text=True)
    with mock.patch("overlay_app.views_overlays._tenant_creds", return_value=_Creds()), \
         mock.patch("core.features.effective", return_value=["sushi-eater"]):
        r = c.get("/s/tok/effects/item-rain.html")
    assert 'window.__FEATURES__ = ["sushi-eater"];' in r.get_data(as_text=True)


def test_duck_sources_blank_without_feature(app):
    c = app.test_client()
    with mock.patch("overlay_app.views_overlays._tenant_creds", return_value=_Creds()):
        r = c.get("/s/tok/effects/knife-duck.html")
    body = r.get_data(as_text=True)
    assert r.status_code == 200 and "rubber-duck" not in body and "knife-duck.js" not in body
    with mock.patch("overlay_app.views_overlays._tenant_creds", return_value=_Creds()), \
         mock.patch("core.features.effective", return_value=["ducks"]):
        r = c.get("/s/tok/effects/knife-duck.html")
    assert "knife-duck.js" in r.get_data(as_text=True)
