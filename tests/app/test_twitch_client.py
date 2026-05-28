from unittest.mock import patch, MagicMock
from app import twitch_client


def _mock_response(json_data, status_code=200):
    m = MagicMock()
    m.status_code = status_code
    m.json.return_value = json_data
    return m


def test_exchange_code_for_token():
    with patch("app.twitch_client.requests.post") as post:
        post.return_value = _mock_response({
            "access_token": "tok_abc", "refresh_token": "ref_xyz",
            "expires_in": 14400, "scope": ["user:read:email"], "token_type": "bearer",
        })
        token = twitch_client.exchange_code("code123", "client_id", "secret", "http://cb")
        assert token == "tok_abc"


def test_get_user_info():
    with patch("app.twitch_client.requests.get") as gget:
        gget.return_value = _mock_response({
            "data": [{
                "id": "987654321",
                "login": "neuerstreamer",
                "display_name": "NeuerStreamer",
                "profile_image_url": "https://example/avatar.png",
                "email": "user@example.com",
            }]
        })
        info = twitch_client.get_user_info("tok_abc", "client_id")
        assert info["id"] == "987654321"
        assert info["display_name"] == "NeuerStreamer"
        assert info["avatar_url"] == "https://example/avatar.png"


def test_get_user_info_empty_raises():
    with patch("app.twitch_client.requests.get") as gget:
        gget.return_value = _mock_response({"data": []})
        try:
            twitch_client.get_user_info("tok_abc", "client_id")
            assert False, "should have raised"
        except RuntimeError as e:
            assert "leeren User" in str(e) or "empty" in str(e).lower()
