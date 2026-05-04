import time


class TTLCache:
    def __init__(self, ttl_secs: int = 30):
        self.ttl = ttl_secs
        self._store: dict = {}

    def set(self, key, value) -> None:
        self._store[key] = (time.monotonic(), value)

    def get(self, key):
        entry = self._store.get(key)
        if not entry:
            return None
        ts, value = entry
        if time.monotonic() - ts > self.ttl:
            self._store.pop(key, None)
            return None
        return value

    def get_or_compute(self, key, compute_fn):
        cached = self.get(key)
        if cached is not None:
            return cached
        value = compute_fn()
        self.set(key, value)
        return value

    def invalidate(self, key=None):
        if key is None:
            self._store.clear()
        else:
            self._store.pop(key, None)
