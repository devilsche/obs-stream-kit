import json
from unittest import mock

import pytest

from overlay_app import alert_sounds


def _mp3(frames, header=b"\xff\xfb\x90\x00"):
    """MPEG-1 Layer III, 128 kbit/s, 44,1 kHz: 417 Byte pro Frame, 1152 Samples."""
    return b"ID3\x03\x00\x00\x00\x00\x00\x0a" + b"\x00" * 10 + (header + b"\x00" * 413) * frames


def test_mp3_duration_reads_frames():
    assert alert_sounds.mp3_duration(_mp3(100)) == pytest.approx(100 * 1152 / 44100, abs=0.01)


def test_mp3_duration_rejects_non_mp3():
    assert alert_sounds.mp3_duration(b"RIFF" + b"\x00" * 5000) is None
    assert alert_sounds.mp3_duration(_mp3(3)) is None   # zu wenige Frames


@pytest.fixture
def store():
    data = {}
    with mock.patch("pubg.db_pg.get_setting", side_effect=lambda c, t, k, d=None: data.get((t, k), d)), \
         mock.patch("pubg.db_pg.set_setting", side_effect=lambda c, t, k, v: data.__setitem__((t, k), v)):
        yield data


def test_add_limits_and_delete(tmp_path, store):
    ok, err = alert_sounds.add(None, str(tmp_path), 2, "follow", "../evil<>.mp3", _mp3(100))
    assert err is None and ok["name"] == "evil.mp3" and ok["dur"] > 2
    assert (tmp_path / "data" / "alert-sounds" / "2" / "follow" / (ok["id"] + ".mp3")).is_file()
    # zu lang (20 s Grenze) und kein MP3
    assert alert_sounds.add(None, str(tmp_path), 2, "follow", "x.mp3", _mp3(800))[1].startswith("Too long")
    assert "not a readable MP3" in alert_sounds.add(None, str(tmp_path), 2, "follow", "x.mp3", b"nope" * 100)[1]
    assert alert_sounds.add(None, str(tmp_path), 2, "nope", "x.mp3", _mp3(100))[1] == "Unknown alert."
    for _ in range(2):
        assert alert_sounds.add(None, str(tmp_path), 2, "follow", "x.mp3", _mp3(50))[1] is None
    assert "Already 3" in alert_sounds.add(None, str(tmp_path), 2, "follow", "x.mp3", _mp3(50))[1]
    # Tenant 1 sieht nichts von Tenant 2
    assert alert_sounds.load(None, 1)["follow"]["files"] == []
    assert alert_sounds.delete(None, str(tmp_path), 2, "follow", ok["id"])
    assert alert_sounds.path_of(str(tmp_path), 2, "follow", ok["id"]) is None
    assert len(alert_sounds.load(None, 2)["follow"]["files"]) == 2
    assert alert_sounds.path_of(str(tmp_path), 2, "follow", "../../x") is None


def test_volume_and_overlay_view(store):
    assert alert_sounds.set_volume(None, 2, "raid", 7)
    cfg = alert_sounds.load(None, 2)
    assert cfg["raid"]["volume"] == 1.0
    assert alert_sounds.for_overlay(cfg, "raid") == {"volume": 1.0, "files": []}
    store[(2, "alert_sounds")] = "kaputt"
    assert alert_sounds.load(None, 2)["raid"]["volume"] == alert_sounds.DEFAULT_VOLUME


def test_builtin_default_only_without_own_files(store):
    assert alert_sounds.for_overlay(alert_sounds.load(None, 3), "follow")["default"] == "assets/alert-sounds/follow.mp3"
    assert "default" not in alert_sounds.for_overlay(alert_sounds.load(None, 3), "raid")
    store[(3, "alert_sounds")] = json.dumps({"follow": {"volume": 0.2, "files": [{"id": "ab12cd34ef56", "name": "x.mp3"}]}})
    assert "default" not in alert_sounds.for_overlay(alert_sounds.load(None, 3), "follow")
