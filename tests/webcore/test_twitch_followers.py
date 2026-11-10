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


def test_subscribers_paginated(monkeypatch):
    pages = [{"data": [{"user_name": "A", "tier": "1000", "is_gift": False, "gifter_name": ""}],
              "pagination": {"cursor": "c1"}},
             {"data": [{"user_name": "B", "tier": "2000", "is_gift": True, "gifter_name": "G"}],
              "pagination": {}}]
    calls = []

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append(dict(params))
        return _Resp(200, pages[len(calls) - 1])
    monkeypatch.setattr(twitch_client.requests, "get", fake_get)
    subs = twitch_client.get_subscribers("tok", "cid", "123")
    assert subs == [{"name": "A", "tier": 1, "gift": False, "gifter": ""},
                    {"name": "B", "tier": 2, "gift": True, "gifter": "G"}]
    assert calls[0] == {"broadcaster_id": "123", "first": 100}
    assert calls[1] == {"broadcaster_id": "123", "first": 100, "after": "c1"}
