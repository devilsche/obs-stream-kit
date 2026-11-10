"""Letzte Follower von Twitch holen (Helix /channels/followers)."""
from webcore import twitch_client


class _Resp:
    def __init__(self, status, data):
        self.status_code, self._data, self.text = status, data, ""

    def json(self):
        return self._data


def test_recent_followers_newest_first(monkeypatch):
    seen = {}

    def fake_get(url, params=None, headers=None, timeout=None):
        seen.update(url=url, params=params, headers=headers)
        return _Resp(200, {"data": [{"user_name": "Neu"}, {"user_name": "Alt"}]})
    monkeypatch.setattr(twitch_client.requests, "get", fake_get)
    assert twitch_client.get_recent_followers("tok", "cid", "123") == ["Neu", "Alt"]
    assert seen["url"].endswith("/channels/followers")
    assert seen["params"] == {"broadcaster_id": "123", "first": 60}
    assert seen["headers"]["Authorization"] == "Bearer tok"


def test_recent_followers_error(monkeypatch):
    monkeypatch.setattr(twitch_client.requests, "get", lambda *a, **k: _Resp(401, {}))
    try:
        twitch_client.get_recent_followers("tok", "cid", "123")
        raise AssertionError("expected RuntimeError")
    except RuntimeError:
        pass
