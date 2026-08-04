import os, sys
import pytest
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from overlay_app import create_app


class _FakeCursor:
    """Antwortet abhaengig von der Query.

    Frueher lieferte fetchone() pauschal {"tenant_id": 7} — der spaeter
    ergaenzte Theme-/Settings-Lookup fragt aber `value` ab und lief in
    einen KeyError.
    """

    def __init__(self): self._sql = ""
    def __enter__(self): return self
    def __exit__(self, *a): return False

    def execute(self, sql="", *a, **k): self._sql = sql or ""

    def fetchone(self):
        if "FROM settings" in self._sql:
            return None  # kein Setting hinterlegt -> Default greift
        return {"tenant_id": 7}


class _FakeConn:
    def cursor(self): return _FakeCursor()
    def close(self): pass


@pytest.fixture
def app():
    a = create_app(testing=True)
    # Middleware-Token-Lookup gegen Fake-DB: jeder /s/<token>/ -> tenant_id 7
    a.config["_PG_CONN_FACTORY"] = lambda: _FakeConn()
    return a
