"""AES-GCM Verschluesselung fuer tenant_credentials._enc Felder.

Format: nonce (12 bytes) || ciphertext || tag (16 bytes)
Key: 32 Bytes (AES-256), aus Env-Var OBS_KIT_MASTER_KEY (Base64).
"""
import base64
import os
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


NONCE_BYTES = 12


def generate_key() -> bytes:
    return secrets.token_bytes(32)


def encrypt(plaintext: str, key: bytes) -> bytes:
    nonce = secrets.token_bytes(NONCE_BYTES)
    aead = AESGCM(key)
    ct_and_tag = aead.encrypt(nonce, plaintext.encode("utf-8"), None)
    return nonce + ct_and_tag


def decrypt(blob: bytes, key: bytes) -> str:
    nonce = blob[:NONCE_BYTES]
    ct_and_tag = blob[NONCE_BYTES:]
    aead = AESGCM(key)
    return aead.decrypt(nonce, ct_and_tag, None).decode("utf-8")


def load_master_key() -> bytes:
    raw = os.environ.get("OBS_KIT_MASTER_KEY")
    if not raw:
        raise RuntimeError(
            "OBS_KIT_MASTER_KEY nicht gesetzt. "
            "Generieren: python -c 'import secrets,base64; "
            "print(base64.b64encode(secrets.token_bytes(32)).decode())' "
            "und in ~/.obs-stream-kit.env als 'export OBS_KIT_MASTER_KEY=<wert>' ablegen."
        )
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError(f"OBS_KIT_MASTER_KEY muss 32 Bytes sein (war {len(key)})")
    return key
