import time
from pubg.cache import TTLCache


def test_get_set_returns_value():
    c = TTLCache(ttl_secs=30)
    c.set("k", {"v": 1})
    assert c.get("k") == {"v": 1}


def test_get_returns_none_after_ttl(monkeypatch):
    t = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: t[0])
    c = TTLCache(ttl_secs=10)
    c.set("k", "v")
    t[0] = 1011.0
    assert c.get("k") is None


def test_get_or_compute_caches_result():
    c = TTLCache(ttl_secs=30)
    calls = [0]

    def expensive():
        calls[0] += 1
        return "result"

    assert c.get_or_compute("k", expensive) == "result"
    assert c.get_or_compute("k", expensive) == "result"
    assert calls[0] == 1
