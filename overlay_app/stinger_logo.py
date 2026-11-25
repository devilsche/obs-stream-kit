"""Logo-Pool für die WebGL-Stinger (transitions/stinger-*.html): bis zu 10 Bilder je Tenant, im Dashboard hochgeladen.

Ablage: data/stinger-logo/<tenant_id>/<id>.<ext>, Liste in settings['stinger_logo'] = [{"id", "ext", "name", "bytes"}, …]
(früher ein einzelnes Objekt, wird weiter gelesen). Die Seite bekommt den ganzen Pool als window.__STINGER_LOGOS__;
jeder Stinger nimmt per ?logos=<id>,<id> seine Auswahl daraus (leer = alle) und zeigt bei jedem Übergang eines davon.
Kein SVG: wird unter der Overlay-Domain ausgeliefert und könnte Skript enthalten.
"""
import json
import os
import re
import secrets

from overlay_app.alert_sounds import _clean_name
from overlay_app.pet_media import _img_ext

SETTING = "stinger_logo"
MAX_BYTES = 6 * 1024 * 1024
MAX_LOGOS = 10
_ID_RE = re.compile(r"^[0-9a-f]{12}$")
_FILE_RE = re.compile(r"^([0-9a-f]{12})\.(png|jpg|webp)$")
# kein GIF: der Stinger zeichnet das Bild einmal in eine Textur, eine Animation bliebe stehen
MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


def _get(conn, tenant_id):
    from pubg.db_pg import get_setting
    return get_setting(conn, tenant_id, SETTING, "") or ""


def _put(conn, tenant_id, raw):
    from pubg.db_pg import set_setting
    set_setting(conn, tenant_id, SETTING, raw)


def _ok(e):
    return isinstance(e, dict) and bool(_ID_RE.match(str(e.get("id", "")))) and e.get("ext") in MIME


def load(conn, tenant_id):
    """Liste der Logos (älteste zuerst), leer ohne Upload."""
    try:
        v = json.loads(_get(conn, tenant_id) or "null")
    except ValueError:
        return []
    if isinstance(v, dict):   # altes Format: ein einzelnes Logo
        v = [v]
    return [e for e in v if _ok(e)][:MAX_LOGOS] if isinstance(v, list) else []


def _save(conn, tenant_id, entries):
    _put(conn, tenant_id, json.dumps(entries, ensure_ascii=False) if entries else "")


def folder(root, tenant_id):
    return os.path.join(root, "data", "stinger-logo", str(int(tenant_id)))


def path_of(root, tenant_id, filename):
    """Datei eines Tenants (nur <id>.<ext>, kein Pfad), sonst None."""
    if not _FILE_RE.match(filename or ""):
        return None
    p = os.path.join(folder(root, tenant_id), filename)
    return p if os.path.isfile(p) else None


def _remove(root, tenant_id, e):
    p = path_of(root, tenant_id, e["id"] + "." + e["ext"])
    if p:
        try:
            os.remove(p)
        except OSError:
            pass


def add_image(conn, root, tenant_id, filename, data):
    """Logo hinzufügen → (Eintrag, None) oder (None, Fehlertext, englisch)."""
    if not data:
        return None, "No file received."
    if len(data) > MAX_BYTES:
        return None, "Image too large: at most %d MB." % (MAX_BYTES // (1024 * 1024))
    ext = _img_ext(data)
    if ext == "gif":
        return None, "GIFs would not move in the stinger – please use PNG or WebP."
    if not ext:
        return None, "This is not a PNG, JPG or WebP image."
    entries = load(conn, tenant_id)
    if len(entries) >= MAX_LOGOS:
        return None, "At most %d logos – remove one first." % MAX_LOGOS
    fid = secrets.token_hex(6)
    os.makedirs(folder(root, tenant_id), exist_ok=True)
    with open(os.path.join(folder(root, tenant_id), fid + "." + ext), "wb") as f:
        f.write(data)
    e = {"id": fid, "ext": ext, "name": _clean_name(filename or "logo." + ext), "bytes": len(data)}
    _save(conn, tenant_id, entries + [e])
    return e, None


def delete(conn, root, tenant_id, logo_id):
    """Ein Logo entfernen → True, wenn es das gab."""
    entries = load(conn, tenant_id)
    hit = [e for e in entries if e["id"] == logo_id]
    if not hit:
        return False
    _remove(root, tenant_id, hit[0])
    _save(conn, tenant_id, [e for e in entries if e["id"] != logo_id])
    return True


def for_page(entries, base):
    """window.__STINGER_LOGOS__ = [{"id", "url"}] (base = /s/<token>/); der Stinger wählt per ?logos=<id>,<id> aus."""
    return [{"id": e["id"], "url": base + "stinger-logo/%s.%s" % (e["id"], e["ext"])} for e in entries or []]
