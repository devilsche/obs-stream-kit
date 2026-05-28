"""Tests fuer das Telemetrie-Archivierungs-Gate (users.is_admin)."""
from unittest.mock import MagicMock, patch

from pubg import poller


def _fake_conn(is_admin: bool | None):
    """Liefert einen MagicMock-Conn, dessen cursor().__enter__() einen
    Cursor liefert, der fetchone() -> {'is_admin': is_admin} oder None
    zurueckgibt."""
    fake_conn = MagicMock()
    fake_cur = MagicMock()
    fake_conn.cursor.return_value.__enter__.return_value = fake_cur
    fake_cur.fetchone.return_value = (
        None if is_admin is None else {"is_admin": is_admin}
    )
    return fake_conn, fake_cur


def test_archive_telemetry_admin():
    fake_conn, fake_cur = _fake_conn(True)
    with patch.object(poller, "_ftp_upload_telemetry") as up:
        poller.maybe_archive_telemetry(
            fake_conn, tenant_id=1, match_id="m1",
            telemetry_url="https://cdn/...gz")
        up.assert_called_once_with(1, "m1", "https://cdn/...gz")
    fake_cur.execute.assert_called_once()


def test_archive_telemetry_non_admin():
    fake_conn, _ = _fake_conn(False)
    with patch.object(poller, "_ftp_upload_telemetry") as up:
        poller.maybe_archive_telemetry(
            fake_conn, tenant_id=2, match_id="m1",
            telemetry_url="https://cdn/...gz")
        up.assert_not_called()


def test_archive_telemetry_no_row():
    """Tenant ohne Owner-User → kein Upload, kein Crash."""
    fake_conn, _ = _fake_conn(None)
    with patch.object(poller, "_ftp_upload_telemetry") as up:
        poller.maybe_archive_telemetry(
            fake_conn, tenant_id=99, match_id="m1",
            telemetry_url="https://cdn/...gz")
        up.assert_not_called()
