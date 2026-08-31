"""Woher die Roh-Telemetrie eines Matches kommt.

Reihenfolge: **HiDrive-Archiv zuerst, PUBG-API als Fallback.** Telemetrie ist
unveraenderlich — ein einmal archiviertes Match aendert sich nie, der Griff
ins Archiv spart also jeden externen Call. Und die API haelt die Dateien nur
begrenzt vor: am 2026-08-26 gemessen waren Matches ab dem 09.08. abrufbar,
alles davor lieferte 403. Das sind ~17 Tage.

Was von der API kommt, wird direkt ins Archiv geschoben — sonst ist es nach
Ablauf der Retention endgueltig verloren.

`archive` und `client` sind Parameter, damit die Logik ohne Netz testbar
bleibt; ohne Angabe werden die echten Module benutzt.
"""

from collections import namedtuple

#: events   — Liste der Roh-Events
#: source   — "hidrive" oder "api"
#: archived — ob die Events (neu) ins Archiv geschrieben wurden
TelemetryResult = namedtuple("TelemetryResult", "events source archived")


class TelemetryUnavailable(RuntimeError):
    """Weder im Archiv noch ueber die API zu bekommen."""


def _default_archive():
    from pubg import hidrive_telemetry
    return hidrive_telemetry


def _default_client(secrets_path: str = ".secrets"):
    """PUBG-Client fuer den CDN-Download.

    Der Telemetrie-Download braucht keinen API-Key — die telemetry_url ist ein
    signierter CDN-Link ohne Auth. Ein fehlender Key ist daher kein Grund, den
    Fallback zu verweigern; er wird nur mitgegeben, wenn er da ist.
    """
    from pubg.api_client import PubgClient
    from pubg.config import load_api_key
    return PubgClient(load_api_key(secrets_path) or "")


def load_telemetry(match_id: str, telemetry_url: str = None,
                   archive=None, client=None,
                   secrets_path: str = ".secrets",
                   archive_cfg=None) -> TelemetryResult:
    """Holt die Roh-Events eines Matches. Siehe Modul-Docstring.

    `archive_cfg` = SFTP-Zugang dieses Tenants (pubg/archive_config.py). Ohne
    Angabe gilt der geteilte Zugang aus `.secrets` — der gehoert aber nur dem
    Betreiber, Tenant-Aufrufe sollten ihren eigenen mitgeben.

    Wirft TelemetryUnavailable, wenn beide Quellen nichts liefern.
    """
    archive = archive if archive is not None else _default_archive()
    reasons = []

    # 1) Archiv — billigste Quelle, kein Rate-Limit, keine Retention.
    try:
        events = archive.download_raw(match_id, secrets_path=secrets_path,
                                      cfg=archive_cfg)
        if events:
            return TelemetryResult(events, "hidrive", False)
        reasons.append("nicht im Archiv")
    except Exception as e:                      # SFTP down, Credentials fehlen
        reasons.append(f"Archiv-Fehler: {e}")

    # 2) PUBG-API — nur solange die CDN-Datei noch existiert.
    if not telemetry_url:
        raise TelemetryUnavailable(
            f"Telemetrie fuer {match_id} nicht verfuegbar "
            f"(keine telemetry_url; {'; '.join(reasons)})")
    try:
        client = client if client is not None else _default_client(secrets_path)
        events = client.get_telemetry(telemetry_url)
    except Exception as e:
        reasons.append(f"API-Fehler: {e}")
        raise TelemetryUnavailable(
            f"Telemetrie fuer {match_id} nicht verfuegbar ({'; '.join(reasons)})")
    if not events:
        reasons.append("API lieferte keine Events")
        raise TelemetryUnavailable(
            f"Telemetrie fuer {match_id} nicht verfuegbar ({'; '.join(reasons)})")

    # 3) Ins Archiv nachziehen. Scheitert das, zaehlen trotzdem die Daten —
    #    der Upload ist Beiwerk, nicht der Zweck des Aufrufs.
    archived = False
    try:
        archive.upload_raw(match_id, events, secrets_path=secrets_path,
                           cfg=archive_cfg)
        archived = True
    except Exception:
        pass
    return TelemetryResult(events, "api", archived)
