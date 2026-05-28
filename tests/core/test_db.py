import os
import pytest
from core import db


def test_load_dsn_from_env(monkeypatch):
    monkeypatch.setenv("OBS_KIT_PG_DSN", "postgresql://test")
    assert db.load_dsn() == "postgresql://test"


def test_load_dsn_from_secrets(tmp_path, monkeypatch):
    monkeypatch.delenv("OBS_KIT_PG_DSN", raising=False)
    secrets = tmp_path / ".secrets"
    secrets.write_text("Other Key: value\nOBS Kit PG DSN: postgresql://from-secrets\n")
    assert db.load_dsn(str(secrets)) == "postgresql://from-secrets"


def test_load_dsn_missing(tmp_path, monkeypatch):
    monkeypatch.delenv("OBS_KIT_PG_DSN", raising=False)
    assert db.load_dsn(str(tmp_path / "nope")) is None
