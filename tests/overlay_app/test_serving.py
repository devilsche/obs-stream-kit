import json
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
        r = c.get("/s/tok/effects/burst.html")
    assert 'window.__FEATURES__ = ["pubg"];' in r.get_data(as_text=True)   # nichts gespeichert: Standard
    with mock.patch("overlay_app.views_overlays._tenant_creds", return_value=_Creds()), \
         mock.patch("core.features.effective", return_value=["race", "sushi-eater"]):
        r = c.get("/s/tok/effects/item-rain.html")
    assert 'window.__FEATURES__ = ["race", "sushi-eater"];' in r.get_data(as_text=True)


def test_weather_and_race_sources_blank_without_feature(app):
    c = app.test_client()
    for src in ("weather.html", "xmas.html", "car-race.html", "item-rain.html"):
        with mock.patch("overlay_app.views_overlays._tenant_creds", return_value=_Creds()):
            body = c.get("/s/tok/effects/" + src).get_data(as_text=True)
        assert "<title>Not enabled</title>" in body, src
    with mock.patch("overlay_app.views_overlays._tenant_creds", return_value=_Creds()), \
         mock.patch("core.features.effective", return_value=["weather"]):
        body = c.get("/s/tok/effects/weather.html").get_data(as_text=True)
    assert "Not enabled" not in body


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


def test_theme_json_returns_tenant_theme_and_caches(app):
    from overlay_app import views_overlays
    views_overlays._THEME_CACHE.clear()
    c = app.test_client()
    with mock.patch("pubg.db_pg.get_setting", return_value="aurora") as gs:
        r1 = c.get("/s/tok/theme.json")
        r2 = c.get("/s/tok/theme.json")
    assert r1.get_json() == {"theme": "aurora"} and r2.get_json() == {"theme": "aurora"}
    assert r1.headers["Cache-Control"] == "no-store"
    assert gs.call_count == 1   # zweite Abfrage aus dem Zwischenspeicher
    views_overlays._THEME_CACHE.clear()
    with mock.patch("pubg.db_pg.get_setting", return_value="kaputt"):
        assert c.get("/s/tok/theme.json").get_json() == {"theme": "entry"}
    views_overlays._THEME_CACHE.clear()


def test_alert_gets_its_sounds_injected(app):
    c = app.test_client()
    cfg = json.dumps({"follow": {"volume": 0.4, "files": [{"id": "ab12cd34ef56", "name": "a.mp3", "dur": 2, "bytes": 1}]}})
    with mock.patch("overlay_app.views_overlays._tenant_creds", return_value=_Creds()), \
         mock.patch("pubg.db_pg.get_setting", side_effect=lambda c, t, k, d=None: cfg if k == "alert_sounds" else d):
        body = c.get("/s/tok/alerts/follow.html").get_data(as_text=True)
        other = c.get("/s/tok/effects/burst.html").get_data(as_text=True)
    assert '"files": ["ab12cd34ef56"]' in body and '"base": "/s/tok/alert-sounds/follow/"' in body
    assert "alert-sound.js" in body
    assert "__ALERT_SOUND__" not in other


def test_alert_sound_file_only_existing(app):
    c = app.test_client()
    assert c.get("/s/tok/alert-sounds/follow/ab12cd34ef56.mp3").status_code == 404
    assert c.get("/s/tok/alert-sounds/follow/..%2F..%2Fx.mp3").status_code == 404
