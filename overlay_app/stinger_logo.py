"""Logo für die WebGL-Stinger (transitions/stinger-*.html): ein Bild je Tenant, im Dashboard hochgeladen.

Ablage: data/stinger-logo/<tenant_id>/<id>.<ext>, Eintrag in settings['stinger_logo'] = {"id", "ext", "name", "bytes"}.
Die Seite bekommt window.__STINGER_LOGO__ (URL oder null) und zeigt es mit ?show=logo statt des Namens.
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


def load(conn, tenant_id):
    """Eintrag des Logos oder None."""
    try:
        e = json.loads(_get(conn, tenant_id) or "null")
    except ValueError:
        return None
    if isinstance(e, dict) and _ID_RE.match(str(e.get("id", ""))) and e.get("ext") in MIME:
        return e
    return None


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


def set_image(conn, root, tenant_id, filename, data):
    """Logo speichern (ersetzt das alte) → (Eintrag, None) oder (None, Fehlertext, englisch)."""
    if not data:
        return None, "No file received."
    if len(data) > MAX_BYTES:
        return None, "Image too large: at most %d MB." % (MAX_BYTES // (1024 * 1024))
    ext = _img_ext(data)
    if ext == "gif":
        return None, "GIFs would not move in the stinger – please use PNG or WebP."
    if not ext:
        return None, "This is not a PNG, JPG or WebP image."
    old = load(conn, tenant_id)
    fid = secrets.token_hex(6)
    os.makedirs(folder(root, tenant_id), exist_ok=True)
    with open(os.path.join(folder(root, tenant_id), fid + "." + ext), "wb") as f:
        f.write(data)
    if old:
        _remove(root, tenant_id, old)
    e = {"id": fid, "ext": ext, "name": _clean_name(filename or "logo." + ext), "bytes": len(data)}
    _put(conn, tenant_id, json.dumps(e, ensure_ascii=False))
    return e, None


def delete(conn, root, tenant_id):
    old = load(conn, tenant_id)
    if not old:
        return False
    _remove(root, tenant_id, old)
    _put(conn, tenant_id, "")
    return True


def for_page(entry, base):
    """window.__STINGER_LOGO__ (base = /s/<token>/)."""
    return (base + "stinger-logo/%s.%s" % (entry["id"], entry["ext"])) if entry else None
