"""Pruefung von PUBG-/Steam-API-Keys, bevor /app/settings sie speichert.

Hintergrund: Beide Felder hiessen nur "API key" — ein Steam-Key landete im
PUBG-Feld, ueberschrieb den gueltigen PUBG-Key und der Poller stand mit 401.

Zwei Stufen:
  1. Format — PUBG-Keys sind JWTs (eyJ…, drei Teile), Steam-Keys 32 Zeichen
     Hex. Erkennt auch den vertauschten Fall und benennt ihn eigens.
  2. Live — ein authentifizierter Aufruf. Nur 401/403 blockiert; ist die API
     nicht erreichbar oder im Rate-Limit, wird nicht blockiert.

Rueckgabe jeweils ein Fehler-Code (siehe settings.html) oder None.
"""
import re
import urllib.error
import urllib.request

_PUBG_RE = re.compile(r"^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
_STEAM_RE = re.compile(r"^[0-9A-Fa-f]{32}$")
_PUBG_SHARDS = ("steam", "kakao", "psn", "xbox")


def format_error(kind: str, key: str):
    if kind == "pubg":
        if _STEAM_RE.match(key):
            return "pubg_is_steam"
        return None if _PUBG_RE.match(key) and len(key) > 100 else "pubg_format"
    if _PUBG_RE.match(key):
        return "steam_is_pubg"
    return None if _STEAM_RE.match(key) else "steam_format"


def _http_status(url: str, headers=None):
    """HTTP-Status eines GET, None bei Netzfehler/Timeout."""
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


def live_error(kind: str, key: str, platform: str = "steam"):
    if kind == "pubg":
        shard = platform if platform in _PUBG_SHARDS else "steam"
        status = _http_status(
            f"https://api.pubg.com/shards/{shard}/seasons",
            {"Authorization": "Bearer " + key,
             "Accept": "application/vnd.api+json"})
        return "pubg_rejected" if status in (401, 403) else None
    status = _http_status(
        "https://api.steampowered.com/ISteamWebAPIUtil/GetSupportedAPIList/v1/"
        "?key=" + key)
    return "steam_rejected" if status in (401, 403) else None


def check(kind: str, key: str, platform: str = "steam"):
    return format_error(kind, key) or live_error(kind, key, platform)
