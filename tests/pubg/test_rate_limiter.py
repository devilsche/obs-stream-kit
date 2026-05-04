import time
from pubg.api_client import RateLimiter


def test_rate_limiter_allows_up_to_max_per_window():
    rl = RateLimiter(max_requests=3, window_secs=10)
    assert rl.try_acquire() is True
    assert rl.try_acquire() is True
    assert rl.try_acquire() is True
    assert rl.try_acquire() is False


def test_rate_limiter_releases_after_window(monkeypatch):
    t = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: t[0])
    rl = RateLimiter(max_requests=2, window_secs=10)
    assert rl.try_acquire() is True
    assert rl.try_acquire() is True
    assert rl.try_acquire() is False
    t[0] = 1011.0
    assert rl.try_acquire() is True


def test_remaining_budget():
    rl = RateLimiter(max_requests=10, window_secs=60)
    rl.try_acquire()
    rl.try_acquire()
    assert rl.remaining() == 8
