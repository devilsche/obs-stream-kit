"""PostgreSQL-Backup → FTP mit GFS-Retention.

7 daily + 4 weekly + 6 monthly. Cronjob: einmal pro Tag 04:00.

Verwendung:
    python -m scripts.backup_pg

DSN: aus core.db.load_dsn(). FTP-Config: aus tenant_credentials WHERE tenant_id=1.
"""
import datetime
import gzip
import io
import json
import os
import re
import subprocess
import sys
from datetime import date
from typing import Iterable

from core import db as core_db, credentials as core_creds


KEEP = {"daily": 7, "weekly": 4, "monthly": 6}
FILENAME_RE = re.compile(r"pg_dump_(\d{4}-\d{2}-\d{2})(?:_(weekly|monthly))?\.dump\.gz")


def pick_tiers(today: date) -> set:
    tiers = {"daily"}
    if today.weekday() == 6:  # Sonntag
        tiers.add("weekly")
    if today.day == 1:
        tiers.add("monthly")
    return tiers


def files_to_prune(filenames: Iterable[str], keep: int) -> list:
    dated = []
    for f in filenames:
        m = FILENAME_RE.search(f)
        if not m:
            continue
        dated.append((m.group(1), f))
    dated.sort(reverse=True)
    return [f for (_, f) in dated[keep:]]


def _pg_dump(dsn: str) -> bytes:
    proc = subprocess.run(
        ["pg_dump", "--format=custom", dsn],
        capture_output=True, check=True
    )
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        gz.write(proc.stdout)
    return buf.getvalue()


def _ftp_connect(ftp_cfg: dict):
    """SFTP via paramiko (siehe pubg/hidrive_telemetry.py)."""
    import paramiko
    transport = paramiko.Transport((ftp_cfg["host"], int(ftp_cfg.get("port", 22))))
    transport.connect(username=ftp_cfg["user"], password=ftp_cfg["pass"])
    return paramiko.SFTPClient.from_transport(transport), transport


def _ensure_dir(sftp, path: str):
    parts = path.strip("/").split("/")
    p = ""
    for part in parts:
        p = f"{p}/{part}"
        try:
            sftp.stat(p)
        except IOError:
            sftp.mkdir(p)


def _upload(sftp, remote_path: str, data: bytes):
    with sftp.open(remote_path, "wb") as f:
        f.write(data)


def _list_dir(sftp, path: str) -> list:
    try:
        return sftp.listdir(path)
    except IOError:
        return []


def _remove(sftp, path: str):
    try:
        sftp.remove(path)
    except IOError:
        pass


def run(today: date | None = None) -> int:
    today = today or date.today()
    tiers = pick_tiers(today)
    dsn = core_db.load_dsn()
    if not dsn:
        print("Keine DSN gefunden, abbruch.")
        return 1

    print(f"Dumping {dsn.split('@')[-1]} ...")
    blob = _pg_dump(dsn)
    print(f"Dump-Groesse: {len(blob)/1024/1024:.1f} MB")

    conn = core_db.connect()
    try:
        creds = core_creds.get(conn, 1)
    finally:
        conn.close()
    if not creds.ftp_config:
        print("Keine FTP-Config in tenant 1 — abbruch.")
        return 1
    ftp_cfg = json.loads(creds.ftp_config)
    base_path = ftp_cfg.get("path", "/").rstrip("/")

    sftp, transport = _ftp_connect(ftp_cfg)
    try:
        for tier in tiers:
            tier_dir = f"{base_path}/backups/{tier}"
            _ensure_dir(sftp, tier_dir)
            suffix = "" if tier == "daily" else f"_{tier}"
            fname = f"pg_dump_{today.isoformat()}{suffix}.dump.gz"
            _upload(sftp, f"{tier_dir}/{fname}", blob)
            print(f"  hochgeladen: {tier_dir}/{fname}")

            # Pruning
            existing = _list_dir(sftp, tier_dir)
            for old in files_to_prune(existing, keep=KEEP[tier]):
                _remove(sftp, f"{tier_dir}/{old}")
                print(f"  geloescht:   {tier_dir}/{old}")
    finally:
        sftp.close()
        transport.close()
    return 0


if __name__ == "__main__":
    sys.exit(run())
