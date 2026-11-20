"""Gemeinsam für tests/fx: der Car-Drive-WS-Dienst ist in Tests nie echt erreichbar (kein Zufallstreffer auf einen
lokal laufenden drive_ws.py); Tests, die ihn brauchen, ersetzen drive_auth.call selbst."""
import pytest


@pytest.fixture(autouse=True)
def _drive_offline(monkeypatch):
    from fx import drive_auth, endpoints
    monkeypatch.setattr(drive_auth, "call", lambda cmd, timeout=3.0, **kw: {"ok": False, "error": "drive service offline"})
    endpoints._DRIVE_SYNC.clear()
    endpoints._DRIVE_KEY.clear()
    yield
