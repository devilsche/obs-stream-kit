"""Werbetafeln an den Strecken (Car Race / Car Drive): kommende öffentliche Events von Entry (myentry.info).

Quelle: GET https://app.myentry.info/api/v1/events/public?limit=20&radius=0 – ohne Anmeldung, je Aufruf höchstens
20 Events in zufälliger Auswahl. Der Server sammelt daraus einen Vorrat (mehrere Aufrufe, ~10 min gültig) und gibt
jedem Aufrufer eine eigene Zufallsauswahl, damit bei jedem Laden andere Events auf den Tafeln stehen. Titelbilder
werden über den Server geholt und unter data/track-ads/<id>.webp zwischengespeichert (gleiche Herkunft – die
Strecke zeichnet sie in den Textur-Atlas, js/car-track-themes.js Art.setAds; Zuschauer-Browser rufen Entry nicht auf).

  pick(n)          → [{ id, name, when (ISO, UTC), city, category, img (relativer Pfad) }]
  image(root, id)  → Dateipfad des Titelbilds oder None
"""
import json
import os
import random
import re
import threading
import time
import urllib.request
from datetime import datetime, timezone

API = "https://app.myentry.info/api/v1/events/public?limit=20&radius=0"
IMG_PREFIX = "https://app.myentry.info/events/"
UA = "obs-stream-kit track-ads"
TTL = 600            # Vorrat gilt 10 min
CALLS = 6            # Aufrufe je Auffrischung (je bis 20 zufällige Events)
MAX_IMG = 2 * 1024 * 1024
MAX_FILES = 400
ID_RE = re.compile(r"^evt_[0-9a-f]{6,32}$")

_lock = threading.Lock()
_pool = {"at": 0.0, "items": []}


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=6) as r:
        return json.loads(r.read(1024 * 1024).decode("utf-8"))


def _city(loc):
    """„Theater am Park, 12683 Berlin“ → „Berlin“ (letzter Teil, Postleitzahl weg)."""
    part = (loc or "").split(",")[-1].strip()
    part = re.sub(r"^\d{4,5}\s+", "", part)
    return part[:40]


def _clean(e, now):
    try:
        eid, name, hero = e.get("id") or "", (e.get("name") or "").strip(), e.get("hero_url") or ""
        when = datetime.fromisoformat((e.get("date_time") or "").replace("Z", "+00:00"))
    except (AttributeError, ValueError, TypeError):
        return None
    if not ID_RE.match(eid) or not name or not hero.startswith(IMG_PREFIX) or when < now:
        return None
    return {"id": eid, "name": name[:90], "when": when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "city": _city(e.get("location")), "category": (e.get("category") or "")[:20], "hero": hero}


def refresh(fetch=_get_json, now=None):
    """Vorrat neu füllen (mehrere zufällige Abrufe, doppelte raus). Fehler: alter Vorrat bleibt."""
    now = now or datetime.now(timezone.utc)
    got = {}
    for _ in range(CALLS):
        try:
            rows = fetch(API)
        except Exception:
            continue
        for e in rows if isinstance(rows, list) else []:
            c = _clean(e, now) if isinstance(e, dict) else None
            if c:
                got[c["id"]] = c
    with _lock:
        if got:
            _pool["items"] = list(got.values())
        _pool["at"] = time.time()
    return len(got)


def pool(fetch=_get_json):
    if time.time() - _pool["at"] > TTL:
        refresh(fetch)
    return list(_pool["items"])


def pick(n=12, fetch=_get_json):
    items = pool(fetch)
    sel = random.sample(items, min(n, len(items)))
    return [{k: v for k, v in e.items() if k != "hero"} | {"img": "api/fx/track-ads/" + e["id"] + ".webp"} for e in sel]


def folder(root):
    return os.path.join(root, "data", "track-ads")


def image(root, eid, download=None):
    """Titelbild aus dem Zwischenspeicher, sonst (nur für Events im Vorrat) bei Entry holen."""
    if not ID_RE.match(eid or ""):
        return None
    d = folder(root)
    path = os.path.join(d, eid + ".webp")
    if os.path.exists(path):
        return path
    hero = next((e["hero"] for e in _pool["items"] if e["id"] == eid), None)
    if not hero:
        return None
    try:
        data = (download or _download)(hero)
    except Exception:
        return None
    if not data or len(data) > MAX_IMG:
        return None
    os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)
    _prune(d)
    return path


def _download(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=8) as r:
        return r.read(MAX_IMG + 1)


def _prune(d):
    files = sorted((os.path.join(d, f) for f in os.listdir(d) if f.endswith(".webp")), key=os.path.getmtime)
    for f in files[:-MAX_FILES]:
        try:
            os.remove(f)
        except OSError:
            pass
