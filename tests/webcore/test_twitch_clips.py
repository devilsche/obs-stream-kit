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
        "createdAt": "2026-05-01T00:00:00Z", "views": 42, "creator": "Bob",
        "mp4": None}]


def test_get_clips_unknown_channel_returns_empty():
    with mock.patch("webcore.twitch_client.requests.post",
                    return_value=_resp({"access_token": "AT"})), \
         mock.patch("webcore.twitch_client.requests.get",
                    return_value=_resp({"data": []})):
        assert twitch_client.get_clips("cid", "csecret", "ghost", count=10) == []


# --- Direkte MP4-URLs (umgehen das Content-Classification-Interstitial) ---

def _gql_ok(slug, qualities=("1080", "720")):
    return {"data": {"clip": {
        "id": slug,
        "playbackAccessToken": {"signature": "SIG", "value": '{"expires":999}'},
        "videoQualities": [
            {"quality": q, "sourceURL": f"https://cdn.example/{slug}-{q}.mp4"}
            for q in qualities],
    }}}


def test_get_clip_mp4_urls_picks_highest_quality():
    with mock.patch("webcore.twitch_client.requests.post",
                    return_value=_resp([_gql_ok("ClipA")])):
        urls = twitch_client.get_clip_mp4_urls(["ClipA"])
    assert urls["ClipA"].startswith("https://cdn.example/ClipA-1080.mp4?")
    assert "sig=SIG" in urls["ClipA"]
    assert "token=" in urls["ClipA"]


def test_get_clip_mp4_urls_batches_all_slugs_in_one_request():
    slugs = ["A", "B", "C"]
    post = mock.Mock(return_value=_resp([_gql_ok(s) for s in slugs]))
    with mock.patch("webcore.twitch_client.requests.post", post):
        urls = twitch_client.get_clip_mp4_urls(slugs)
    assert set(urls) == {"A", "B", "C"}
    assert post.call_count == 1
    assert len(post.call_args.kwargs["json"]) == 3


def test_get_clip_mp4_urls_skips_clips_without_data():
    body = [_gql_ok("A"), {"data": {"clip": None}}]
    with mock.patch("webcore.twitch_client.requests.post",
                    return_value=_resp(body)):
        urls = twitch_client.get_clip_mp4_urls(["A", "Gone"])
    assert set(urls) == {"A"}


def test_get_clip_mp4_urls_network_error_returns_empty():
    with mock.patch("webcore.twitch_client.requests.post",
                    side_effect=Exception("boom")):
        assert twitch_client.get_clip_mp4_urls(["A"]) == {}


def test_get_clip_mp4_urls_empty_input_makes_no_request():
    post = mock.Mock()
    with mock.patch("webcore.twitch_client.requests.post", post):
        assert twitch_client.get_clip_mp4_urls([]) == {}
    post.assert_not_called()


def test_get_clips_attaches_mp4_url():
    seq = [
        _resp({"data": [{"id": "B1"}]}),                     # users?login
        _resp({"data": [{"id": "ClipA", "title": "Nice", "duration": 28.5,
                         "created_at": "", "view_count": 1,
                         "creator_name": "Bob"}]}),          # clips
    ]
    with mock.patch("webcore.twitch_client.requests.post",
                    return_value=_resp({"access_token": "AT"})), \
         mock.patch("webcore.twitch_client.requests.get", side_effect=seq), \
         mock.patch("webcore.twitch_client.get_clip_mp4_urls",
                    return_value={"ClipA": "https://cdn/x.mp4?sig=1"}):
        clips = twitch_client.get_clips("cid", "csecret", "luckor", count=10)
    assert clips[0]["mp4"] == "https://cdn/x.mp4?sig=1"


def test_get_clips_survives_mp4_lookup_failure():
    """Faellt der GQL-Call aus, bleiben die Clips erhalten — ohne mp4-Feld."""
    seq = [
        _resp({"data": [{"id": "B1"}]}),
        _resp({"data": [{"id": "ClipA", "title": "", "duration": 10,
                         "created_at": "", "view_count": 0,
                         "creator_name": ""}]}),
    ]
    with mock.patch("webcore.twitch_client.requests.post",
                    return_value=_resp({"access_token": "AT"})), \
         mock.patch("webcore.twitch_client.requests.get", side_effect=seq), \
         mock.patch("webcore.twitch_client.get_clip_mp4_urls", return_value={}):
        clips = twitch_client.get_clips("cid", "csecret", "luckor", count=10)
    assert clips[0]["id"] == "ClipA"
    assert clips[0]["mp4"] is None


def test_get_clips_by_ids_maps_fields_and_mp4():
    clips_resp = _resp({"data": [{"id": "S1", "title": "T", "duration": 12,
                                  "created_at": "", "view_count": 3,
                                  "creator_name": "C"}]})
    with mock.patch("webcore.twitch_client.requests.post",
                    return_value=_resp({"access_token": "AT"})), \
         mock.patch("webcore.twitch_client.requests.get",
                    return_value=clips_resp) as get, \
         mock.patch("webcore.twitch_client.get_clip_mp4_urls",
                    return_value={"S1": "https://cdn/s1.mp4?sig=1"}):
        clips = twitch_client.get_clips_by_ids("cid", "csecret", ["S1", "S2"])
    assert clips[0]["id"] == "S1"
    assert clips[0]["mp4"] == "https://cdn/s1.mp4?sig=1"
    assert get.call_args.kwargs["params"]["id"] == ["S1", "S2"]


def test_get_clips_by_ids_empty_returns_empty_without_request():
    post = mock.Mock()
    with mock.patch("webcore.twitch_client.requests.post", post):
        assert twitch_client.get_clips_by_ids("cid", "csecret", []) == []
    post.assert_not_called()


def test_clips_endpoint_manual_slugs_use_get_clips_by_ids():
    """?slugs=a,b liefert genau diese Clips inklusive MP4-URL."""
    app = _twitch_app()
    with _mock.patch("webcore.views_twitch._tenant_creds", return_value=_Creds()), \
         _mock.patch("webcore.views_twitch.twitch_client.get_clips_by_ids",
                     return_value=[{"id": "a", "mp4": "https://cdn/a.mp4"}]) as gbi, \
         _mock.patch("webcore.views_twitch.twitch_client.get_clips") as gc:
        r = app.test_client().get("/s/tok123/api/twitch/clips?slugs=a,b")
    assert r.status_code == 200
    assert r.get_json()["clips"][0]["mp4"] == "https://cdn/a.mp4"
    assert gbi.call_args.args[2] == ["a", "b"]
    gc.assert_not_called()


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


def test_get_clips_network_error_returns_empty():
    with mock.patch("webcore.twitch_client.requests.post",
                    side_effect=Exception("boom")):
        assert twitch_client.get_clips("cid", "csecret", "luckor", count=10) == []


# --- broadcaster_id-Pfad + Tenant-Isolation ---

def test_get_clips_with_broadcaster_id_skips_users_lookup():
    """broadcaster_id gegeben → nur der Clips-Call, kein /helix/users."""
    clips_resp = _resp({"data": [{"id": "ClipZ", "title": "T", "duration": 10,
                                  "created_at": "", "view_count": 1,
                                  "creator_name": "C"}]})
    with mock.patch("webcore.twitch_client.requests.post",
                    return_value=_resp({"access_token": "AT"})), \
         mock.patch("webcore.twitch_client.requests.get",
                    return_value=clips_resp) as get:
        clips = twitch_client.get_clips("cid", "csecret", None, count=10,
                                        broadcaster_id="4711")
    assert [c["id"] for c in clips] == ["ClipZ"]
    assert get.call_count == 1
    assert get.call_args.kwargs["params"]["broadcaster_id"] == "4711"


def test_get_clips_without_channel_and_broadcaster_returns_empty():
    with mock.patch("webcore.twitch_client.requests.post",
                    return_value=_resp({"access_token": "AT"})):
        assert twitch_client.get_clips("cid", "csecret", None, count=10) == []


def test_clips_endpoint_uses_owner_broadcaster_id():
    """Ohne expliziten Channel haengt der Abruf am Tenant-Owner,
    nicht am globalen .secrets-Channel."""
    class _NoChannel:
        twitch_client_id = "cid"
        twitch_client_secret = "csecret"
        twitch_channel = None
    app = _twitch_app(tenant_id=7)
    with _mock.patch("webcore.views_twitch._tenant_creds", return_value=_NoChannel()), \
         _mock.patch("webcore.views_twitch._owner_twitch_id", return_value="99887"), \
         _mock.patch("webcore.views_twitch.twitch_client.get_clips",
                     return_value=[]) as gc:
        r = app.test_client().get("/s/tok123/api/twitch/clips")
    assert r.status_code == 200
    assert gc.call_args.kwargs["broadcaster_id"] == "99887"


def test_clips_endpoint_no_global_channel_fallback_for_foreign_tenant():
    """Fremder Tenant ohne eigenen Channel bekommt leere Liste statt Admin-Clips."""
    class _Empty:
        twitch_client_id = None
        twitch_client_secret = None
        twitch_channel = None
    app = _twitch_app(tenant_id=7)
    with _mock.patch("webcore.views_twitch._tenant_creds", return_value=_Empty()), \
         _mock.patch("webcore.views_twitch._owner_twitch_id", return_value=None), \
         _mock.patch("webcore.views_twitch.twitch_client.get_clips") as gc:
        r = app.test_client().get("/s/tok123/api/twitch/clips")
    assert r.status_code == 200
    assert r.get_json()["clips"] == []
    gc.assert_not_called()
