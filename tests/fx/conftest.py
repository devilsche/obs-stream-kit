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


@pytest.fixture(autouse=True)
def _all_extras(monkeypatch):
    """Endpunkt-Tests laufen wie beim Admin-Tenant mit allen Extras; tests/fx/test_extras_gate.py prüft die Sperre."""
    from core import features
    from fx import endpoints
    monkeypatch.setattr(endpoints, "_feats", lambda: sorted(features.FEATURES))
    yield
