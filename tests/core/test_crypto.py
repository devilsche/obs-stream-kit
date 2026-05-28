import base64
import os
import pytest
from cryptography.exceptions import InvalidTag
from core import crypto


def test_roundtrip():
    key = crypto.generate_key()
    ct = crypto.encrypt("hello world", key)
    assert crypto.decrypt(ct, key) == "hello world"


def test_different_nonce_each_call():
    key = crypto.generate_key()
    a = crypto.encrypt("same", key)
    b = crypto.encrypt("same", key)
    assert a != b  # Nonce muss random sein


def test_wrong_key_fails():
    key1 = crypto.generate_key()
    key2 = crypto.generate_key()
    ct = crypto.encrypt("secret", key1)
    with pytest.raises(InvalidTag):
        crypto.decrypt(ct, key2)


def test_tampered_ciphertext_fails():
    key = crypto.generate_key()
    ct = bytearray(crypto.encrypt("secret", key))
    ct[20] ^= 0x01  # flip ein bit
    with pytest.raises(InvalidTag):
        crypto.decrypt(bytes(ct), key)


def test_load_master_key_from_env(monkeypatch):
    raw = os.urandom(32)
    monkeypatch.setenv("OBS_KIT_MASTER_KEY", base64.b64encode(raw).decode())
    assert crypto.load_master_key() == raw


def test_load_master_key_missing(monkeypatch):
    monkeypatch.delenv("OBS_KIT_MASTER_KEY", raising=False)
    with pytest.raises(RuntimeError):
        crypto.load_master_key()


def test_load_master_key_wrong_length(monkeypatch):
    monkeypatch.setenv("OBS_KIT_MASTER_KEY", base64.b64encode(b"too-short").decode())
    with pytest.raises(ValueError):
        crypto.load_master_key()
