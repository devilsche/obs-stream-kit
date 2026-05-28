"""Tenant-Credential-Vault.

Liest/Schreibt tenant_credentials, verschluesselt sensitive Felder mit
core.crypto. Klartext-Felder (Namen, IDs) bleiben unverschluesselt.
"""
from dataclasses import dataclass
from typing import Optional

from core import crypto


@dataclass
class CredBundle:
    tenant_id: int
    pubg_name: Optional[str] = None
    pubg_platform: Optional[str] = None
    pubg_account_id: Optional[str] = None
    pubg_api_key: Optional[str] = None
    twitch_channel: Optional[str] = None
    twitch_client_id: Optional[str] = None
    twitch_client_secret: Optional[str] = None
    steam_id: Optional[str] = None
    steam_api_key: Optional[str] = None
    ftp_config: Optional[str] = None  # JSON-String


def get(conn, tenant_id: int) -> CredBundle:
    key = crypto.load_master_key()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM tenant_credentials WHERE tenant_id = %s", (tenant_id,)
        )
        row = cur.fetchone()
    if row is None:
        raise LookupError(f"Keine tenant_credentials fuer tenant_id={tenant_id}")
    def dec(blob):
        return crypto.decrypt(bytes(blob), key) if blob else None
    return CredBundle(
        tenant_id=tenant_id,
        pubg_name=row["pubg_name"],
        pubg_platform=row["pubg_platform"],
        pubg_account_id=row["pubg_account_id"],
        pubg_api_key=dec(row["pubg_api_key_enc"]),
        twitch_channel=row["twitch_channel"],
        twitch_client_id=row["twitch_client_id"],
        twitch_client_secret=dec(row["twitch_client_secret_enc"]),
        steam_id=row["steam_id"],
        steam_api_key=dec(row["steam_api_key_enc"]),
        ftp_config=dec(row["ftp_config_enc"]),
    )


def set_pubg(conn, tenant_id: int, *, name=None, platform=None,
             account_id=None, api_key=None):
    key = crypto.load_master_key()
    enc = crypto.encrypt(api_key, key) if api_key else None
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials
            SET pubg_name        = COALESCE(%s, pubg_name),
                pubg_platform    = COALESCE(%s, pubg_platform),
                pubg_account_id  = COALESCE(%s, pubg_account_id),
                pubg_api_key_enc = COALESCE(%s, pubg_api_key_enc),
                updated_at = now()
            WHERE tenant_id = %s
        """, (name, platform, account_id, enc, tenant_id))
    conn.commit()


def set_twitch(conn, tenant_id: int, *, channel=None, client_id=None,
               client_secret=None):
    key = crypto.load_master_key()
    enc = crypto.encrypt(client_secret, key) if client_secret else None
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials
            SET twitch_channel           = COALESCE(%s, twitch_channel),
                twitch_client_id         = COALESCE(%s, twitch_client_id),
                twitch_client_secret_enc = COALESCE(%s, twitch_client_secret_enc),
                updated_at = now()
            WHERE tenant_id = %s
        """, (channel, client_id, enc, tenant_id))
    conn.commit()


def set_steam(conn, tenant_id: int, *, steam_id=None, api_key=None):
    key = crypto.load_master_key()
    enc = crypto.encrypt(api_key, key) if api_key else None
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials
            SET steam_id          = COALESCE(%s, steam_id),
                steam_api_key_enc = COALESCE(%s, steam_api_key_enc),
                updated_at = now()
            WHERE tenant_id = %s
        """, (steam_id, enc, tenant_id))
    conn.commit()


def set_ftp(conn, tenant_id: int, *, config_json: str):
    key = crypto.load_master_key()
    enc = crypto.encrypt(config_json, key)
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials SET ftp_config_enc = %s, updated_at = now()
            WHERE tenant_id = %s
        """, (enc, tenant_id))
    conn.commit()
