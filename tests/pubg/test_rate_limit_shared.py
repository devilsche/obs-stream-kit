"""Rate-Limiting muss ueber Client-Instanzen und Poll-Ticks hinweg halten.

Der Poller baut je Tick einen neuen PubgClient — ein instanzgebundener
Limiter faengt damit nur Bursts innerhalb eines Ticks ab.
"""
from unittest import mock
import urllib.error

import pytest

from pubg import api_client
from pubg.api_client import PubgClient, RateLimitError, ApiError


@pytest.fixture(autouse=True)
def _clean_limiters():
    api_client.reset_shared_limiters()
    yield
    api_client.reset_shared_limiters()


def _http_error(code, headers=None):
    return urllib.error.HTTPError("http://x", code, "err", headers or {}, None)


def test_same_api_key_shares_budget_across_instances():
    a = PubgClient("KEY-A", rate_limiter_max=2)
    b = PubgClient("KEY-A", rate_limiter_max=2)
    assert a.limiter.try_acquire() is True
    assert b.limiter.try_acquire() is True
    assert b.limiter.try_acquire() is False


def test_different_api_keys_have_separate_budgets():
    a = PubgClient("KEY-A", rate_limiter_max=1)
    b = PubgClient("KEY-B", rate_limiter_max=1)
    assert a.limiter.try_acquire() is True
    assert b.limiter.try_acquire() is True


def test_http_429_raises_rate_limit_error_with_retry_after():
    c = PubgClient("KEY-A")
    err = _http_error(429, {"Retry-After": "17"})
    with mock.patch("urllib.request.urlopen", side_effect=err):
        with pytest.raises(RateLimitError) as ei:
            c.get_player("Wer")
    assert ei.value.retry_after == 17


def test_other_http_errors_stay_api_errors():
    c = PubgClient("KEY-A")
    with mock.patch("urllib.request.urlopen", side_effect=_http_error(500)):
        with pytest.raises(ApiError):
            c.get_player("Wer")


def test_server_remaining_header_shrinks_local_budget():
    """Sagt der Server weniger Budget als wir lokal glauben, gilt der Server."""
    c = PubgClient("KEY-A", rate_limiter_max=10)
    resp = mock.MagicMock()
    resp.status = 200
    resp.headers = {"X-RateLimit-Remaining": "1", "X-RateLimit-Limit": "10"}
    resp.read.return_value = b'{"data": []}'
    resp.__enter__.return_value = resp
    with mock.patch("urllib.request.urlopen", return_value=resp):
        c.get_player("Wer")
    assert c.limiter.remaining() == 1
