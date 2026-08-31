"""Woher die SFTP-Zugangsdaten fuer das Telemetrie-Archiv kommen.

Zwei Quellen, in dieser Reihenfolge:

1. **Der Tenant selbst** — `tenant_credentials.telemetry_archive_enc`, gesetzt
   ueber /app/settings. Damit hat jeder Streamer sein eigenes Archiv und ist
   nicht auf den geteilten Admin-Bucket angewiesen.
2. **`.secrets`** — der historische, geteilte HiDrive-Zugang. Gilt nur noch
   fuer Tenants, deren Owner Admin ist: sonst wuerden fremde Streamer in den
   Bucket des Betreibers schreiben.

Ohne beides gibt es kein Archiv fuer diesen Tenant — dann bleibt nur die
PUBG-API (~14 Tage) und danach das DB-Replay.
"""
import json
import os


REQUIRED = ("host", "user", "password")


def parse_config(config_json: str):
    """JSON-String → cfg-Dict wie `hidrive_telemetry` es erwartet.

    None, wenn die Konfiguration unbrauchbar ist (kaputtes JSON, Pflichtfeld
    leer). Der Aufrufer faellt dann auf die naechste Quelle zurueck, statt mit
    einer halben Konfiguration einen Verbindungsfehler zu produzieren.
    """
    if not config_json:
        return None
    try:
        raw = json.loads(config_json)
    except (ValueError, TypeError):
        return None
    if not isinstance(raw, dict):
        return None
    cfg = {
        "host": (raw.get("host") or "").strip(),
        "user": (raw.get("user") or "").strip(),
        "password": raw.get("password") or "",
        "path": (raw.get("path") or "/pubg/telemetry").strip() or "/pubg/telemetry",
        "port": raw.get("port") or 22,
    }
    if not all(cfg[k] for k in REQUIRED):
        return None
    try:
        cfg["port"] = int(cfg["port"])
    except (ValueError, TypeError):
        cfg["port"] = 22
    return cfg


def _is_admin_tenant(conn, tenant_id: int) -> bool:
    raw = getattr(conn, "raw", conn)
    with raw.cursor() as cur:
        cur.execute("""
            SELECT u.is_admin FROM tenants t
            JOIN users u ON u.id = t.owner_user_id
            WHERE t.id = %s
        """, (tenant_id,))
        row = cur.fetchone()
    return bool(row and row["is_admin"])


def archive_cfg_for_tenant(conn, tenant_id: int, secrets_path: str = ".secrets"):
    """cfg-Dict fuer diesen Tenant, oder None. Siehe Modul-Docstring."""
    from core import credentials as core_creds
    raw = getattr(conn, "raw", conn)
    try:
        creds = core_creds.get(raw, tenant_id)
    except LookupError:
        creds = None
    cfg = parse_config(creds.telemetry_archive) if creds else None
    if cfg:
        return cfg
    if _is_admin_tenant(raw, tenant_id):
        from pubg import hidrive_telemetry
        return hidrive_telemetry._get_hd_cfg(secrets_path)
    return None


def has_own_archive(conn, tenant_id: int) -> bool:
    """Hat der Tenant einen EIGENEN Zugang hinterlegt (nicht den geteilten)?"""
    from core import credentials as core_creds
    raw = getattr(conn, "raw", conn)
    try:
        creds = core_creds.get(raw, tenant_id)
    except LookupError:
        return False
    return parse_config(creds.telemetry_archive) is not None


def redacted(cfg) -> dict:
    """Anzeige-Form ohne Passwort — fuer Settings-UI und Logs."""
    if not cfg:
        return {}
    return {"host": cfg.get("host"), "port": cfg.get("port"),
            "user": cfg.get("user"), "path": cfg.get("path")}


def secrets_path_for(root: str = None) -> str:
    base = root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, ".secrets")
