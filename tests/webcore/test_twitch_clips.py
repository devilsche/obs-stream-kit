from unittest import mock
from webcore import twitch_client


def _resp(json_body, status=200):
    m = mock.Mock()
    m.status_code = status
    m.json.return_value = json_body
    m.raise_for_status.return_value = None
    return m


def test_get_clips_maps_fields():
    seq = [
        _resp({"access_token": "AT"}),                       # oauth token
        _resp({"data": [{"id": "B1"}]}),                     # users?login
        _resp({"data": [{                                    # clips
            "id": "ClipA", "title": "Nice", "duration": 28.5,
            "created_at": "2026-05-01T00:00:00Z",
            "view_count": 42, "creator_name": "Bob"}]}),
    ]
    with mock.patch("webcore.twitch_client.requests.post", return_value=seq[0]), \
         mock.patch("webcore.twitch_client.requests.get", side_effect=seq[1:]):
        clips = twitch_client.get_clips("cid", "csecret", "luckor", count=10)
    assert clips == [{
        "id": "ClipA", "title": "Nice", "duration": 28.5,
        "createdAt": "2026-05-01T00:00:00Z", "views": 42, "creator": "Bob"}]


def test_get_clips_unknown_channel_returns_empty():
    with mock.patch("webcore.twitch_client.requests.post",
                    return_value=_resp({"access_token": "AT"})), \
         mock.patch("webcore.twitch_client.requests.get",
                    return_value=_resp({"data": []})):
        assert twitch_client.get_clips("cid", "csecret", "ghost", count=10) == []


# --- Blueprint tests ---

from unittest import mock as _mock
from flask import Flask, g
from webcore.views_twitch import bp_twitch


class _Creds:
    twitch_client_id = "cid"
    twitch_client_secret = "csecret"
    twitch_channel = "luckor"


def _twitch_app(tenant_id=7):
    app = Flask(__name__)
    app.register_blueprint(bp_twitch)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app


def test_clips_endpoint_returns_json():
    app = _twitch_app()
    with _mock.patch("webcore.views_twitch._tenant_creds", return_value=_Creds()), \
         _mock.patch("webcore.views_twitch.twitch_client.get_clips",
                     return_value=[{"id": "A", "title": "t", "duration": 30,
                                    "createdAt": "", "views": 0, "creator": ""}]):
        r = app.test_client().get("/s/tok123/api/twitch/clips?count=5")
    assert r.status_code == 200
    assert r.get_json()["clips"][0]["id"] == "A"


def test_clips_endpoint_404_without_tenant():
    app = _twitch_app(tenant_id=None)
    r = app.test_client().get("/s/tok123/api/twitch/clips")
    assert r.status_code == 404
