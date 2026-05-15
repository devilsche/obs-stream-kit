"""HiDrive Telemetrie-Archiv.

Speichert Raw-Telemetrie-Blobs (gzip-komprimiert) auf Strato HiDrive.
Nutzt dieselben SFTP-Credentials wie backup.py (.secrets FTP-Backup-*).

Remote-Pfad: <FTP-Backup-Path>/telemetry/<match_id>.json.gz
  Beispiel:   /pubg-backups/telemetry/abc123.json.gz

Hauptfunktionen:
  upload_raw(match_id, raw_events_list)       — nach CDN-Fetch aufrufen
  download_raw(match_id)                      — gibt list[dict] zurück
  upload_reconstructed_from_db(conn, match_id) — für Altmatches aus SQLite
  backfill_from_db(conn, limit)               — Altmatches bulk-upload
  exists(match_id)                            — schnelle Existenzprüfung
"""

import gzip
import io
import json
import os
import time


# ── Pfad-Helper ────────────────────────────────────────────────────────────

def _remote_path(base_path: str, match_id: str) -> str:
    """z.B. /pubg-backups + abc123 → /pubg-backups/telemetry/abc123.json.gz"""
    base = base_path.rstrip("/") if base_path else ""
    return f"{base}/telemetry/{match_id}.json.gz"


# ── SFTP via backup.py ─────────────────────────────────────────────────────

def _get_ftp_cfg(secrets_path: str = ".secrets"):
    from pubg.backup import load_ftp_config
    return load_ftp_config(secrets_path)


def _sftp_connect(ftp_cfg):
    try:
        import paramiko
    except ImportError as e:
        raise ImportError("pip install paramiko") from e
    transport = paramiko.Transport((ftp_cfg["host"], int(ftp_cfg["port"])))
    transport.connect(username=ftp_cfg["user"], password=ftp_cfg["password"])
    sftp = paramiko.SFTPClient.from_transport(transport)
    return sftp, transport


def _ensure_dir(sftp, remote_dir: str):
    """Verzeichnis anlegen falls nicht vorhanden."""
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        if not p:
            continue
        cur = f"{cur}/{p}" if cur else f"/{p}"
        try:
            sftp.stat(cur)
        except IOError:
            try:
                sftp.mkdir(cur)
            except IOError:
                pass


# ── Upload ────────────────────────────────────────────────────────────────

def upload_raw(match_id: str, raw_events: list,
               secrets_path: str = ".secrets") -> bool:
    """Komprimiert + uploadet rohe Telemetrie-Events auf HiDrive.
    Returns True bei Erfolg.
    """
    ftp_cfg = _get_ftp_cfg(secrets_path)
    if not ftp_cfg:
        return False
    gz_data = gzip.compress(
        json.dumps(raw_events, separators=(",", ":")).encode("utf-8"),
        compresslevel=9)
    remote = _remote_path(ftp_cfg.get("path", ""), match_id)
    remote_dir = os.path.dirname(remote)
    try:
        sftp, transport = _sftp_connect(ftp_cfg)
        _ensure_dir(sftp, remote_dir)
        with sftp.open(remote, "wb") as f:
            f.write(gz_data)
        sftp.close()
        transport.close()
        return True
    except Exception as e:
        print(f"[hidrive] upload {match_id[:16]} failed: {e}")
        return False


def upload_reconstructed_from_db(conn, match_id: str,
                                   secrets_path: str = ".secrets") -> bool:
    """Rekonstruiert Telemetrie-Events aus SQLite payload_json und
    uploadet sie als 'reconstructed'-Blob auf HiDrive.
    Fuer Altmatches wo das PUBG-CDN die Daten nicht mehr hat (>14d).
    Der Blob ist gefiltert (nur Squad-relevante Events), aber vollständig
    dank payload_json-Spalte.
    """
    try:
        rows = conn.execute(
            "SELECT payload_json FROM telemetry_events "
            "WHERE match_id = ? AND payload_json IS NOT NULL",
            (match_id,)).fetchall()
    except Exception as e:
        print(f"[hidrive] db read {match_id[:16]}: {e}")
        return False
    if not rows:
        return False
    events = []
    for r in rows:
        try:
            events.append(json.loads(r["payload_json"] if isinstance(r, dict)
                                      else r[0]))
        except (ValueError, TypeError):
            pass
    if not events:
        return False
    # Markierung: rekonstruiert (nicht original-raw)
    events.append({"_T": "_meta", "_reconstructed": True,
                    "_source": "sqlite_payload_json",
                    "_match_id": match_id})
    return upload_raw(match_id, events, secrets_path)


# ── Download ──────────────────────────────────────────────────────────────

def download_raw(match_id: str, secrets_path: str = ".secrets") -> list | None:
    """Lädt Telemetrie-Blob von HiDrive und gibt list[dict] zurück.
    Returns None wenn nicht vorhanden oder Fehler.
    """
    ftp_cfg = _get_ftp_cfg(secrets_path)
    if not ftp_cfg:
        return None
    remote = _remote_path(ftp_cfg.get("path", ""), match_id)
    try:
        sftp, transport = _sftp_connect(ftp_cfg)
        buf = io.BytesIO()
        sftp.getfo(remote, buf)
        sftp.close()
        transport.close()
        buf.seek(0)
        return json.loads(gzip.decompress(buf.read()).decode("utf-8"))
    except Exception as e:
        print(f"[hidrive] download {match_id[:16]} failed: {e}")
        return None


def exists(match_id: str, secrets_path: str = ".secrets") -> bool:
    """Prüft ob ein Match-Blob auf HiDrive existiert."""
    ftp_cfg = _get_ftp_cfg(secrets_path)
    if not ftp_cfg:
        return False
    remote = _remote_path(ftp_cfg.get("path", ""), match_id)
    try:
        sftp, transport = _sftp_connect(ftp_cfg)
        sftp.stat(remote)
        sftp.close()
        transport.close()
        return True
    except Exception:
        return False


def list_archived(secrets_path: str = ".secrets") -> list[str]:
    """Listet alle archivierten Match-IDs (ohne .json.gz-Suffix)."""
    ftp_cfg = _get_ftp_cfg(secrets_path)
    if not ftp_cfg:
        return []
    base = ftp_cfg.get("path", "").rstrip("/")
    remote_dir = f"{base}/telemetry"
    try:
        sftp, transport = _sftp_connect(ftp_cfg)
        files = sftp.listdir(remote_dir)
        sftp.close()
        transport.close()
        return [f.replace(".json.gz", "") for f in files if f.endswith(".json.gz")]
    except Exception as e:
        print(f"[hidrive] list failed: {e}")
        return []


# ── Bulk-Backfill für Altmatches ──────────────────────────────────────────

def backfill_from_db(conn, secrets_path: str = ".secrets",
                      limit: int | None = None,
                      pacing_s: float = 0.5) -> dict:
    """Uploadet alle Matches aus SQLite die noch kein HiDrive-Archiv haben.
    Sinnvoll für einmaligen Import der Altmatches.

    Returns: {uploaded, skipped, errors}
    """
    already = set(list_archived(secrets_path))
    rows = conn.execute(
        "SELECT DISTINCT match_id FROM telemetry_events"
    ).fetchall()
    match_ids = [r["match_id"] if isinstance(r, dict) else r[0] for r in rows]
    if limit:
        match_ids = match_ids[:limit]

    uploaded = 0; skipped = 0; errors = 0
    total = len(match_ids)
    for i, mid in enumerate(match_ids, 1):
        if mid in already:
            skipped += 1
            continue
        ok = upload_reconstructed_from_db(conn, mid, secrets_path)
        if ok:
            uploaded += 1
            print(f"  [{i}/{total}] uploaded {mid[:16]}... "
                  f"({uploaded} done, {skipped} skipped)")
        else:
            errors += 1
            print(f"  [{i}/{total}] ERROR {mid[:16]}")
        if pacing_s > 0:
            time.sleep(pacing_s)

    return {"uploaded": uploaded, "skipped": skipped, "errors": errors}
