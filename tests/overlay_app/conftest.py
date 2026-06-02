import os, sys
import pytest
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from overlay_app import create_app


class _FakeCursor:
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, *a, **k): pass
    def fetchone(self): return {"tenant_id": 7}


class _FakeConn:
    def cursor(self): return _FakeCursor()
    def close(self): pass


@pytest.fixture
def app():
    a = create_app(testing=True)
    # Middleware-Token-Lookup gegen Fake-DB: jeder /s/<token>/ -> tenant_id 7
    a.config["_PG_CONN_FACTORY"] = lambda: _FakeConn()
    return a
