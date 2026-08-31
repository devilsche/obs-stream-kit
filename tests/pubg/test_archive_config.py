"""Auflösung der Archiv-Zugangsdaten: Tenant-eigen vor geteilt."""
from unittest import mock

import pytest

from pubg import archive_config as ac


def test_parse_config_needs_host_user_password():
    assert ac.parse_config('{"host":"h","user":"u","password":"p"}')
    assert ac.parse_config('{"host":"h","user":"u"}') is None
    assert ac.parse_config('{"host":"","user":"u","password":"p"}') is None


def test_parse_config_defaults_port_and_path():
    cfg = ac.parse_config('{"host":"h","user":"u","password":"p"}')
    assert cfg["port"] == 22
    assert cfg["path"] == "/pubg/telemetry"


def test_parse_config_accepts_port_as_string():
    """Aus einem HTML-Formular kommt der Port als Text."""
    cfg = ac.parse_config('{"host":"h","user":"u","password":"p","port":"2222"}')
    assert cfg["port"] == 2222


def test_parse_config_survives_garbage():
    assert ac.parse_config("kein json") is None
    assert ac.parse_config('["liste"]') is None
    assert ac.parse_config(None) is None


def test_redacted_drops_the_password():
    cfg = ac.parse_config('{"host":"h","user":"u","password":"geheim"}')
    out = ac.redacted(cfg)
    assert "geheim" not in str(out)
    assert out["host"] == "h" and out["user"] == "u"


class _Cur:
    def __init__(self, row):
        self._row = row
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
    def execute(self, *a):
        pass
    def fetchone(self):
        return self._row


class _Conn:
    def __init__(self, is_admin):
        self._row = {"is_admin": is_admin}
    def cursor(self):
        return _Cur(self._row)


def _creds(telemetry_archive):
    return mock.Mock(telemetry_archive=telemetry_archive)


def test_own_config_wins_over_the_shared_one():
    own = '{"host":"eigen","user":"u","password":"p"}'
    with mock.patch("core.credentials.get", return_value=_creds(own)), \
         mock.patch("pubg.hidrive_telemetry._get_hd_cfg",
                    return_value={"host": "geteilt"}) as shared:
        cfg = ac.archive_cfg_for_tenant(_Conn(True), 1)
    assert cfg["host"] == "eigen"
    shared.assert_not_called()


def test_admin_without_own_config_gets_the_shared_one():
    with mock.patch("core.credentials.get", return_value=_creds(None)), \
         mock.patch("pubg.hidrive_telemetry._get_hd_cfg",
                    return_value={"host": "geteilt"}):
        cfg = ac.archive_cfg_for_tenant(_Conn(True), 1)
    assert cfg["host"] == "geteilt"


def test_foreign_tenant_never_reaches_the_shared_bucket():
    """Sonst schreiben fremde Streamer in den Bucket des Betreibers."""
    with mock.patch("core.credentials.get", return_value=_creds(None)), \
         mock.patch("pubg.hidrive_telemetry._get_hd_cfg",
                    return_value={"host": "geteilt"}):
        assert ac.archive_cfg_for_tenant(_Conn(False), 2) is None


def test_broken_own_config_does_not_promote_a_foreign_tenant():
    with mock.patch("core.credentials.get", return_value=_creds("{kaputt")), \
         mock.patch("pubg.hidrive_telemetry._get_hd_cfg",
                    return_value={"host": "geteilt"}):
        assert ac.archive_cfg_for_tenant(_Conn(False), 2) is None


def test_has_own_archive_only_counts_usable_configs():
    with mock.patch("core.credentials.get",
                    return_value=_creds('{"host":"h","user":"u","password":"p"}')):
        assert ac.has_own_archive(_Conn(False), 2) is True
    with mock.patch("core.credentials.get", return_value=_creds('{"host":"h"}')):
        assert ac.has_own_archive(_Conn(False), 2) is False
