"""DB-Backup via FTP/FTPS oder SFTP. Settings werden aus .secrets gelesen.

Erwartet im .secrets:
  FTP-Backup-Host:     server.example.com
  FTP-Backup-User:     username
  FTP-Backup-Pass:     secret
  FTP-Backup-Path:     /pubg-backups/  (optional — Default: root)
  FTP-Backup-Port:     21              (optional — Default: 21 / sftp 22)
  FTP-Backup-Protocol: sftp            (optional — ftp/ftps/sftp, Default: ftps)

SFTP braucht das Python-Paket `paramiko` (pip install paramiko).
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
            "FTP-Backup-Port": "port", "FTP-Backup-TLS": "tls",
            "FTP-Backup-Protocol": "protocol"}
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
    # Protokoll: ftp | ftps | sftp. Default = ftps (für Rückwärtskompat).
    cfg["protocol"] = cfg.get("protocol", "").lower() or (
        "ftp" if cfg.get("tls", "").lower() in ("false", "0", "no", "nein") else "ftps"
    )
    if cfg["protocol"] not in ("ftp", "ftps", "sftp"):
        cfg["protocol"] = "ftps"
    cfg.setdefault("path", "")
    default_port = {"ftp": "21", "ftps": "21", "sftp": "22"}[cfg["protocol"]]
    cfg.setdefault("port", default_port)
    cfg["port"] = int(cfg["port"])
    cfg["tls"] = cfg["protocol"] == "ftps"  # Rückwärtskompat-Flag
    return cfg


# ── FTP/FTPS ──────────────────────────────────────────────────────────────


def _ftp_connect(ftp_cfg: dict):
    cls = ftplib.FTP_TLS if ftp_cfg["protocol"] == "ftps" else ftplib.FTP
    ftp = cls(timeout=30)
    ftp.connect(ftp_cfg["host"], ftp_cfg["port"])
    ftp.login(ftp_cfg["user"], ftp_cfg["password"])
    if ftp_cfg["protocol"] == "ftps":
        ftp.prot_p()
    if ftp_cfg["path"]:
        for part in ftp_cfg["path"].strip("/").split("/"):
            if not part:
                continue
            try:
                ftp.cwd(part)
            except ftplib.error_perm:
                ftp.mkd(part)
                ftp.cwd(part)
    return ftp


def _upload_ftp(local_path, ftp_cfg):
    ftp = _ftp_connect(ftp_cfg)
    try:
        with open(local_path, "rb") as f:
            ftp.storbinary(f"STOR {os.path.basename(local_path)}", f)
    finally:
        ftp.quit()


def _list_ftp(ftp_cfg):
    ftp = _ftp_connect(ftp_cfg)
    try:
        return ftp.nlst()
    finally:
        ftp.quit()


def _download_ftp(remote_name, local_path, ftp_cfg):
    ftp = _ftp_connect(ftp_cfg)
    try:
        with open(local_path, "wb") as f:
            ftp.retrbinary(f"RETR {remote_name}", f.write)
    finally:
        ftp.quit()


# ── SFTP (paramiko) ───────────────────────────────────────────────────────


def _sftp_open(ftp_cfg):
    try:
        import paramiko
    except ImportError as e:
        raise ImportError(
            "SFTP braucht das Paket 'paramiko'. Installation: "
            "pip install paramiko"
        ) from e
    transport = paramiko.Transport((ftp_cfg["host"], ftp_cfg["port"]))
    transport.connect(username=ftp_cfg["user"], password=ftp_cfg["password"])
    sftp = paramiko.SFTPClient.from_transport(transport)
    if ftp_cfg["path"]:
        # Pfad-Komponenten anlegen falls nötig (für Upload)
        cur = ""
        for part in ftp_cfg["path"].strip("/").split("/"):
            if not part:
                continue
            cur = f"{cur}/{part}" if cur else f"/{part}"
            try:
                sftp.stat(cur)
            except IOError:
                try:
                    sftp.mkdir(cur)
                except IOError:
                    pass
        sftp.chdir(ftp_cfg["path"])
    return sftp, transport


def _upload_sftp(local_path, ftp_cfg):
    sftp, transport = _sftp_open(ftp_cfg)
    try:
        sftp.put(local_path, os.path.basename(local_path))
    finally:
        sftp.close()
        transport.close()


def _list_sftp(ftp_cfg):
    sftp, transport = _sftp_open(ftp_cfg)
    try:
        return sftp.listdir()
    finally:
        sftp.close()
        transport.close()


def _download_sftp(remote_name, local_path, ftp_cfg):
    sftp, transport = _sftp_open(ftp_cfg)
    try:
        sftp.get(remote_name, local_path)
    finally:
        sftp.close()
        transport.close()


# ── Public API (Protokoll-agnostisch) ─────────────────────────────────────


def upload_to_ftp(local_path: str, ftp_cfg: dict) -> tuple[bool, str]:
    """Lädt eine Datei hoch (FTP/FTPS/SFTP). Returns (success, message)."""
    if not os.path.exists(local_path):
        return False, f"file missing: {local_path}"
    try:
        if ftp_cfg["protocol"] == "sftp":
            _upload_sftp(local_path, ftp_cfg)
        else:
            _upload_ftp(local_path, ftp_cfg)
        return True, f"uploaded {os.path.basename(local_path)} via {ftp_cfg['protocol']}"
    except Exception as e:
        return False, f"{ftp_cfg['protocol'].upper()} error: {e}"


def list_remote_backups(ftp_cfg: dict) -> list[str]:
    """Listet *.bak Files im konfigurierten Pfad, sortiert ASC."""
    if ftp_cfg["protocol"] == "sftp":
        names = _list_sftp(ftp_cfg)
    else:
        names = _list_ftp(ftp_cfg)
    backups = [n for n in names if n.endswith(".bak") and ".db." in n]
    return sorted(backups)


def download_from_ftp(remote_name: str, local_path: str,
                      ftp_cfg: dict) -> tuple[bool, str]:
    """Lädt eine Datei runter (FTP/FTPS/SFTP). Returns (success, message)."""
    try:
        if ftp_cfg["protocol"] == "sftp":
            _download_sftp(remote_name, local_path, ftp_cfg)
        else:
            _download_ftp(remote_name, local_path, ftp_cfg)
        return True, f"downloaded {remote_name} → {local_path}"
    except Exception as e:
        return False, f"{ftp_cfg['protocol'].upper()} error: {e}"
