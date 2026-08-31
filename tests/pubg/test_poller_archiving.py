"""Tests fuer das Telemetrie-Archivierungs-Gate.

Frueher entschied `users.is_admin` direkt im Poller. Jetzt entscheidet, ob es
ueberhaupt ein Archiv-Ziel gibt: den eigenen SFTP-Zugang des Tenants oder —
nur fuer Admin-Tenants — den geteilten aus `.secrets`. Die Auswertung steckt in
pubg/archive_config.py (dort eigene Tests), hier nur das Durchreichen.
"""
from unittest.mock import MagicMock, patch

from pubg import poller


CFG = {"host": "sftp.example", "user": "u", "password": "p",
       "path": "/pubg/telemetry", "port": 22}


def test_archive_telemetry_uploads_with_the_tenant_config():
    with patch("pubg.archive_config.archive_cfg_for_tenant",
               return_value=CFG), \
         patch.object(poller, "_ftp_upload_telemetry") as up:
        poller.maybe_archive_telemetry(
            MagicMock(), tenant_id=2, match_id="m1",
            telemetry_url="https://cdn/...gz")
    up.assert_called_once_with(2, "m1", "https://cdn/...gz", cfg=CFG)


def test_archive_telemetry_skips_tenants_without_a_target():
    """Kein eigener Zugang und kein Admin → kein Upload, kein Crash."""
    with patch("pubg.archive_config.archive_cfg_for_tenant",
               return_value=None), \
         patch.object(poller, "_ftp_upload_telemetry") as up:
        poller.maybe_archive_telemetry(
            MagicMock(), tenant_id=3, match_id="m1",
            telemetry_url="https://cdn/...gz")
    up.assert_not_called()


def test_ftp_upload_passes_the_config_to_hidrive():
    """Ohne cfg-Durchreichung landet der Blob im Bucket des Betreibers."""
    with patch("pubg.hidrive_telemetry.upload_raw") as up, \
         patch("urllib.request.urlopen") as urlopen:
        urlopen.return_value.__enter__.return_value.read.return_value = b"[]"
        poller._ftp_upload_telemetry(2, "m1", "https://cdn/x.gz", cfg=CFG)
    up.assert_called_once()
    assert up.call_args.kwargs["cfg"] == CFG
