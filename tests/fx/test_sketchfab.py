"""Car-Picker-Vorschau: Sketchfab-Modelle holen und zwischenspeichern (Netz gemockt)."""
import io
import json

import pytest

from fx import sketchfab

UID = "0123456789abcdef0123456789abcdef"


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_fetch_downloads_once_and_caches(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setenv("SKETCHFAB_API_TOKEN", "tok")

    def fake_open(url, headers=None, timeout=60):
        calls.append((url, headers))
        if "api.sketchfab.com" in url:
            assert headers == {"Authorization": "Token tok"}
            return _Resp(json.dumps({"glb": {"url": "https://cdn/x.glb"}}).encode())
        return _Resp(b"glTF-data")
    monkeypatch.setattr(sketchfab, "_open", fake_open)
    p = sketchfab.fetch(str(tmp_path), UID)
    assert open(p, "rb").read() == b"glTF-data"
    sketchfab.fetch(str(tmp_path), UID)
    assert len(calls) == 2


def test_fetch_rejects_bad_uid_and_missing_token(tmp_path, monkeypatch):
    monkeypatch.delenv("SKETCHFAB_API_TOKEN", raising=False)
    with pytest.raises(sketchfab.FetchError):
        sketchfab.fetch(str(tmp_path), "../etc/passwd")
    with pytest.raises(sketchfab.FetchError):
        sketchfab.fetch(str(tmp_path), UID)


def test_token_from_secrets(tmp_path, monkeypatch):
    monkeypatch.delenv("SKETCHFAB_API_TOKEN", raising=False)
    (tmp_path / ".secrets").write_text("Other: x\nSketchfab API Token: abc123\n")
    assert sketchfab.token(str(tmp_path)) == "abc123"
