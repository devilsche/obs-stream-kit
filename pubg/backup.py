"""DB-Backup via FTP/FTPS. Settings werden aus .secrets gelesen.

Erwartet im .secrets:
  FTP-Backup-Host:   ftp.example.com
  FTP-Backup-User:   username
  FTP-Backup-Pass:   secret
  FTP-Backup-Path:   /pubg-backups/    (optional — Default: root)
  FTP-Backup-Port:   21                (optional — Default: 21)
  FTP-Backup-TLS:    true              (optional — Default: true)

Wenn Host/User/Pass nicht gesetzt → kein Upload, nur lokales Backup.
"""
import ftplib
import os
import socket


def load_ftp_config(secrets_path: str) -> dict | None:
    """Liest FTP-Backup-Settings aus .secrets. Returns None wenn unvollständig."""
    if not os.path.exists(secrets_path):
        return None
    cfg = {}
    keys = {"FTP-Backup-Host": "host", "FTP-Backup-User": "user",
            "FTP-Backup-Pass": "password", "FTP-Backup-Path": "path",
            "FTP-Backup-Port": "port", "FTP-Backup-TLS": "tls"}
    with open(secrets_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            mapped = keys.get(key.strip())
            if mapped:
                cfg[mapped] = value.strip()
    if not cfg.get("host") or not cfg.get("user") or not cfg.get("password"):
        return None
    cfg.setdefault("path", "")
    cfg.setdefault("port", "21")
    cfg.setdefault("tls", "true")
    cfg["port"] = int(cfg["port"])
    cfg["tls"] = cfg["tls"].lower() in ("true", "1", "yes", "ja")
    return cfg


def upload_to_ftp(local_path: str, ftp_cfg: dict) -> tuple[bool, str]:
    """Lädt eine Datei auf FTP hoch. Returns (success, message)."""
    if not os.path.exists(local_path):
        return False, f"file missing: {local_path}"

    cls = ftplib.FTP_TLS if ftp_cfg["tls"] else ftplib.FTP
    try:
        ftp = cls(timeout=30)
        ftp.connect(ftp_cfg["host"], ftp_cfg["port"])
        ftp.login(ftp_cfg["user"], ftp_cfg["password"])
        if ftp_cfg["tls"]:
            ftp.prot_p()  # encrypt data channel

        # remote directory: cd, anlegen falls nötig
        if ftp_cfg["path"]:
            for part in ftp_cfg["path"].strip("/").split("/"):
                if not part:
                    continue
                try:
                    ftp.cwd(part)
                except ftplib.error_perm:
                    ftp.mkd(part)
                    ftp.cwd(part)

        with open(local_path, "rb") as f:
            ftp.storbinary(f"STOR {os.path.basename(local_path)}", f)
        ftp.quit()
        return True, f"uploaded {os.path.basename(local_path)}"
    except (ftplib.all_errors, socket.error, OSError) as e:
        return False, f"FTP error: {e}"


def _ftp_connect(ftp_cfg: dict):
    cls = ftplib.FTP_TLS if ftp_cfg["tls"] else ftplib.FTP
    ftp = cls(timeout=30)
    ftp.connect(ftp_cfg["host"], ftp_cfg["port"])
    ftp.login(ftp_cfg["user"], ftp_cfg["password"])
    if ftp_cfg["tls"]:
        ftp.prot_p()
    if ftp_cfg["path"]:
        for part in ftp_cfg["path"].strip("/").split("/"):
            if part:
                ftp.cwd(part)
    return ftp


def list_remote_backups(ftp_cfg: dict) -> list[str]:
    """Listet alle Backup-Dateien auf dem FTP, sortiert ASC (älteste zuerst).
    Erkennt Dateinamen im Format pubg.db.YYYYMMDD.bak."""
    ftp = _ftp_connect(ftp_cfg)
    try:
        names = ftp.nlst()
    finally:
        ftp.quit()
    backups = [n for n in names if n.endswith(".bak") and ".db." in n]
    return sorted(backups)


def download_from_ftp(remote_name: str, local_path: str,
                      ftp_cfg: dict) -> tuple[bool, str]:
    """Lädt eine Datei vom FTP runter. Returns (success, message)."""
    try:
        ftp = _ftp_connect(ftp_cfg)
        try:
            with open(local_path, "wb") as f:
                ftp.retrbinary(f"RETR {remote_name}", f.write)
        finally:
            ftp.quit()
        return True, f"downloaded {remote_name} → {local_path}"
    except (ftplib.all_errors, socket.error, OSError) as e:
        return False, f"FTP error: {e}"
