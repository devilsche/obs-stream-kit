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
    ftp_config: Optional[str] = None  # JSON-String (DB-Dump-Ablage)
    telemetry_archive: Optional[str] = None  # JSON-String (Telemetrie-Archiv)


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
        telemetry_archive=dec(row["telemetry_archive_enc"])
        if "telemetry_archive_enc" in row else None,
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
        if cur.rowcount == 0:
            raise LookupError(f"Keine tenant_credentials fuer tenant_id={tenant_id}")
    conn.commit()


def clear_pubg_account_id(conn, tenant_id: int) -> None:
    """Gecachte account_id verwerfen.

    set_pubg() arbeitet mit COALESCE und kann darum nichts loeschen. Beim
    Wechsel des Primaer-Accounts muss die ID aber weg, sonst gehoert sie
    zum alten Namen.
    """
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials
            SET pubg_account_id = NULL, updated_at = now()
            WHERE tenant_id = %s
        """, (tenant_id,))
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
        if cur.rowcount == 0:
            raise LookupError(f"Keine tenant_credentials fuer tenant_id={tenant_id}")
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
        if cur.rowcount == 0:
            raise LookupError(f"Keine tenant_credentials fuer tenant_id={tenant_id}")
    conn.commit()


def set_telemetry_archive(conn, tenant_id: int, config_json) -> None:
    """SFTP-Zugang fuer das eigene Telemetrie-Archiv setzen.

    `config_json` = JSON-String, oder None zum Loeschen (anders als set_pubg
    kein COALESCE: der Nutzer muss den Zugang auch wieder wegnehmen koennen).
    """
    key = crypto.load_master_key()
    enc = crypto.encrypt(config_json, key) if config_json else None
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials
            SET telemetry_archive_enc = %s, updated_at = now()
            WHERE tenant_id = %s
        """, (enc, tenant_id))
        if cur.rowcount == 0:
            raise LookupError(f"Keine tenant_credentials fuer tenant_id={tenant_id}")
    conn.commit()


def set_ftp(conn, tenant_id: int, *, config_json: str):
    key = crypto.load_master_key()
    enc = crypto.encrypt(config_json, key)
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials SET ftp_config_enc = %s, updated_at = now()
            WHERE tenant_id = %s
        """, (enc, tenant_id))
        if cur.rowcount == 0:
            raise LookupError(f"Keine tenant_credentials fuer tenant_id={tenant_id}")
    conn.commit()
