"""Car Drive Mehrspieler: Tickets, Zuschauer-Cookie, Kanal-Link, interne Schnittstelle zum WebSocket-Dienst.

- Ticket: signiert (Flask-SECRET_KEY, itsdangerous), sagt dem WS-Dienst, wer sich verbindet:
  Räume mit Code: {tid (Tenant), code, id (Twitch-User-ID), login, display, role host|viewer, garage (Liste | None
  = alle), rnd}. Flask stellt es aus (Streamer: Token-Route, Zuschauer: /drive/<code>/ticket mit Zuschauer-Cookie).
  Chatrennen steuerbar (ohne code): {tid, id, login, display, role driver|spectator} – Fahrer über
  /drive/race/<kanal>/ticket (Zuschauer-Cookie, nur wer im aktuellen Chatrennen steht), Overlays (zuschauen, nie
  fahren) über die Token-Route …/api/fx/car-race/spectate.
- Zuschauer-Cookie `obskit_drive`: signiert {id, login, display} aus „Sign in with Twitch“ – getrennt vom
  Streamer-Login (keine Session in der DB, kein Tenant).
- Kanal-Link des Chatrennens: stream-overlay.com/drive/race/<kanal> – <kanal> = Twitch-Kanal des Tenants
  (tenant_credentials.twitch_channel), ohne Kanal der Tenant-Slug (key_of_tenant / tenant_of_key).
- Interne Steuerung: Flask ruft http://127.0.0.1:9010/internal/<cmd>?… mit Header X-Drive-Key (aus dem
  SECRET_KEY abgeleitet); nginx leitet nur /drive-ws/ weiter, /internal ist von außen nicht erreichbar.
- Grenzwerte je Auto: data/car-rain/drive-limits.json (schreibt Flask, liest der WS-Dienst beim Öffnen/je Rennen).
"""
import hashlib
import hmac
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from itsdangerous import BadSignature, URLSafeTimedSerializer

TICKET_SALT = "car-drive-ticket"
VIEWER_SALT = "car-drive-viewer"
TICKET_AGE = 12 * 3600
VIEWER_AGE = 30 * 86400
VIEWER_COOKIE = "obskit_drive"
DEFAULT_URL = "http://127.0.0.1:9010"


def _secret():
    from webcore.config import Config
    return Config.SECRET_KEY


def _ser(salt, secret=None):
    return URLSafeTimedSerializer(secret or _secret(), salt=salt)


def make_ticket(payload, secret=None):
    return _ser(TICKET_SALT, secret).dumps(payload)


def read_ticket(ticket, secret=None, max_age=TICKET_AGE):
    try:
        data = _ser(TICKET_SALT, secret).loads(ticket, max_age=max_age)
    except (BadSignature, TypeError, ValueError):
        return None
    if not isinstance(data, dict) or not data.get("id"):
        return None
    return data if data.get("code") or data.get("tid") is not None else None


def make_viewer(info, secret=None):
    return _ser(VIEWER_SALT, secret).dumps({"id": str(info["id"]), "login": info.get("login") or "",
                                            "display": info.get("display_name") or info.get("login") or ""})


def read_viewer(cookie, secret=None):
    if not cookie:
        return None
    try:
        data = _ser(VIEWER_SALT, secret).loads(cookie, max_age=VIEWER_AGE)
    except (BadSignature, TypeError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("id") else None


KEY_RE = re.compile(r"^[a-z0-9_][a-z0-9_-]{1,39}$")


def key_of_tenant(conn, tenant_id):
    """Link-Schlüssel des Tenants: Twitch-Kanal (klein), sonst Slug; None ohne beides. conn = SqliteCompatConn."""
    row = conn.execute("SELECT tc.twitch_channel AS ch, t.slug AS slug FROM tenants t "
                       "LEFT JOIN tenant_credentials tc ON tc.tenant_id = t.id WHERE t.id = ?", (tenant_id,)).fetchone()
    if not row:
        return None
    for k in (row["ch"], row["slug"]):
        k = (k or "").strip().lower()
        if KEY_RE.match(k):
            return k
    return None


def tenant_of_key(conn, key):
    """Tenant zu einem Link-Schlüssel (Twitch-Kanal, sonst Slug) oder None."""
    key = (key or "").strip().lower()
    if not KEY_RE.match(key):
        return None
    row = conn.execute("SELECT t.id AS id FROM tenants t JOIN tenant_credentials tc ON tc.tenant_id = t.id "
                       "WHERE lower(tc.twitch_channel) = ? ORDER BY t.id LIMIT 1", (key,)).fetchone()
    if not row:
        row = conn.execute("SELECT id FROM tenants WHERE lower(slug) = ? ORDER BY id LIMIT 1", (key,)).fetchone()
    return int(row["id"]) if row else None


def internal_key(secret=None):
    return hmac.new((secret or _secret()).encode(), b"car-drive-internal", hashlib.sha256).hexdigest()


def limits_path(root):
    return os.path.join(root, "data", "car-rain", "drive-limits.json")


def load_limits(root):
    try:
        with open(limits_path(root), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_limits(root, data):
    """Grenzwerte der Car-Drive-Seite ablegen (nur gültige Zahlen, atomar)."""
    cars = {}
    for k, v in ((data or {}).get("cars") or {}).items() if isinstance(data, dict) else []:
        if not isinstance(k, str) or len(k) > 120 or not isinstance(v, dict):
            continue
        try:
            vt = float(v.get("vtop"))
            laps = [round(float(x), 3) for x in (v.get("lap") or [])[:5]]
        except (TypeError, ValueError):
            continue
        if 0 < vt < 100:
            cars[k] = {"vtop": round(vt, 3), "lap": laps}
    if not cars:
        return 0
    p = limits_path(root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"cars": cars}, f)
    os.replace(tmp, p)
    return len(cars)


def call(cmd, timeout=3.0, **params):
    """Interner Aufruf beim WS-Dienst. → dict; bei Fehler {"ok": False, "error": …}."""
    base = os.environ.get("OBS_KIT_DRIVE_URL") or DEFAULT_URL
    url = "%s/internal/%s?%s" % (base.rstrip("/"), cmd, urllib.parse.urlencode(
        {k: v for k, v in params.items() if v is not None}))
    req = urllib.request.Request(url, headers={"X-Drive-Key": internal_key()})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8") or "{}")
        except ValueError:
            return {"ok": False, "error": "drive service error %d" % e.code}
    except (OSError, ValueError):
        return {"ok": False, "error": "drive service offline"}
