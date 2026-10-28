"""Key-Pruefung beim Speichern in /app/settings: Format + Live-Test."""
from core import key_check

PUBG_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9." + "a" * 180 + ".sig_part-123"
STEAM_KEY = "F4C6" + "0" * 24 + "C260"


def test_valid_formats_pass():
    assert key_check.format_error("pubg", PUBG_KEY) is None
    assert key_check.format_error("steam", STEAM_KEY) is None
    assert key_check.format_error("steam", STEAM_KEY.lower()) is None


def test_steam_key_in_pubg_field_is_detected():
    assert key_check.format_error("pubg", STEAM_KEY) == "pubg_is_steam"


def test_pubg_key_in_steam_field_is_detected():
    assert key_check.format_error("steam", PUBG_KEY) == "steam_is_pubg"


def test_garbage_is_format_error():
    assert key_check.format_error("pubg", "hallo") == "pubg_format"
    assert key_check.format_error("steam", "hallo") == "steam_format"
    assert key_check.format_error("steam", STEAM_KEY + "X") == "steam_format"


def test_live_rejected_on_401_403(monkeypatch):
    monkeypatch.setattr(key_check, "_http_status", lambda url, headers=None: 401)
    assert key_check.live_error("pubg", PUBG_KEY, "steam") == "pubg_rejected"
    monkeypatch.setattr(key_check, "_http_status", lambda url, headers=None: 403)
    assert key_check.live_error("steam", STEAM_KEY) == "steam_rejected"


def test_live_ok_or_unreachable_does_not_block(monkeypatch):
    # 200 = gueltig; 429/5xx/Netzfehler (None) = nicht pruefbar -> nicht blockieren
    for status in (200, 429, 503, None):
        monkeypatch.setattr(key_check, "_http_status",
                            lambda url, headers=None, s=status: s)
        assert key_check.live_error("pubg", PUBG_KEY, "steam") is None
        assert key_check.live_error("steam", STEAM_KEY) is None


def test_check_skips_live_test_when_format_is_wrong(monkeypatch):
    calls = []
    monkeypatch.setattr(key_check, "_http_status",
                        lambda url, headers=None: calls.append(url) or 200)
    assert key_check.check("pubg", STEAM_KEY, "steam") == "pubg_is_steam"
    assert calls == []
