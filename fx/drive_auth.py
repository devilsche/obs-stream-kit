"""Car Drive Mehrspieler: Tickets, Zuschauer-Cookie, interne Schnittstelle zum WebSocket-Dienst.

- Ticket: signiert (Flask-SECRET_KEY, itsdangerous), sagt dem WS-Dienst, wer sich verbindet:
  {tid (Tenant), code, id (Twitch-User-ID), login, display, role host|viewer, garage (Liste | None = alle), rnd}.
  Flask stellt es aus (Streamer: Token-Route, Zuschauer: /drive/<code>/ticket mit Zuschauer-Cookie).
- Zuschauer-Cookie `obskit_drive`: signiert {id, login, display} aus „Sign in with Twitch“ – getrennt vom
  Streamer-Login (keine Session in der DB, kein Tenant).
- Interne Steuerung: Flask ruft http://127.0.0.1:9010/internal/<cmd>?… mit Header X-Drive-Key (aus dem
  SECRET_KEY abgeleitet); nginx leitet nur /drive-ws/ weiter, /internal ist von außen nicht erreichbar.
- Grenzwerte je Auto: data/car-rain/drive-limits.json (schreibt Flask, liest der WS-Dienst beim Öffnen).
"""
import hashlib
import hmac
import json
import os
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
    return data if isinstance(data, dict) and data.get("id") and data.get("code") else None


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
