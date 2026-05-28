"""CLI: Initialer Seed des Admin-Tenants (tenant_id=1) aus .secrets + config/pubg.json.

Idempotent: wenn Tenant 1 schon existiert, passiert nichts (Warnung).
"""
import json
import os
import secrets as py_secrets
import sys

from core import db as core_db, credentials


def _parse_secrets(path: str) -> dict:
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if ":" not in line or line.startswith("#"):
                continue
            k, _, v = line.partition(":")
            out[k.strip()] = v.strip()
    return out


def _gen_token() -> str:
    return "tok_" + py_secrets.token_hex(16)


def run(secrets_path: str = ".secrets",
        pubg_config_path: str = "config/pubg.json") -> int:
    sec = _parse_secrets(secrets_path)
    pubg_cfg = {}
    if os.path.exists(pubg_config_path):
        with open(pubg_config_path, "r", encoding="utf-8") as f:
            pubg_cfg = json.load(f)

    conn = core_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM tenants WHERE id = 1")
            if cur.fetchone():
                print("Tenant 1 schon vorhanden — Seed uebersprungen.")
                return 0
            cur.execute("""
                INSERT INTO users (display_name, is_admin, twitch_user_id)
                VALUES (%s, TRUE, NULL) RETURNING id
            """, (sec.get("Twitch-Channel") or "Admin",))
            uid = cur.fetchone()["id"]
            cur.execute("""
                INSERT INTO tenants (id, owner_user_id, slug, display_name)
                VALUES (1, %s, 'admin', %s)
            """, (uid, sec.get("Twitch-Channel") or "Admin"))
            cur.execute(
                "INSERT INTO tenant_credentials (tenant_id) VALUES (1)"
            )
            cur.execute("""
                INSERT INTO widget_tokens (token, tenant_id, label)
                VALUES (%s, 1, 'Default')
            """, (_gen_token(),))
        conn.commit()

        # Credentials befuellen (verschluesselt via core.credentials)
        credentials.set_pubg(
            conn, 1,
            name=pubg_cfg.get("nick"),
            platform=pubg_cfg.get("platform"),
            api_key=sec.get("PUBG API Key") or None,
        )
        credentials.set_twitch(
            conn, 1,
            channel=sec.get("Twitch-Channel") or None,
            client_id=sec.get("Client-ID") or None,
            client_secret=sec.get("Client-Secret") or None,
        )
        credentials.set_steam(
            conn, 1,
            steam_id=sec.get("Steam ID") or None,
            api_key=sec.get("Steam API Key") or None,
        )
        ftp_cfg = {
            k.replace("FTP-Backup-", "").lower(): v
            for k, v in sec.items()
            if k.startswith("FTP-Backup-")
        }
        if ftp_cfg:
            credentials.set_ftp(conn, 1, config_json=json.dumps(ftp_cfg))
        print("Admin-Tenant 1 angelegt.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(run())
