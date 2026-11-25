"""Pet-Stinger (transitions/pet.html): eigenes Bild und bis zu 3 Töne je Tenant, im Dashboard hochgeladen.

Ablage: data/pet-media/<tenant_id>/<id>.<ext>, Verzeichnis in settings['pet_media']:
  {"img": {"id", "ext", "name", "bytes"} | null, "sounds": [{"id", "name", "dur", "bytes"}], "volume": 0.6}
Die Seite bekommt window.__PET_MEDIA__ = {img, sounds: [{url, dur}], volume}, spielt einen zufälligen Ton ab dem
Einblenden des Bildes und bleibt stehen, bis er zu Ende ist.
Ein img=-Parameter in der URL hat weiter Vorrang (alte OBS-Quellen).
"""
import json
import os
import re
import secrets

from overlay_app.alert_sounds import _clean_name, mp3_duration

SETTING = "pet_media"
MAX_SOUNDS = 3
MAX_SECONDS = 15.0
MAX_SOUND_BYTES = 2 * 1024 * 1024
MAX_IMG_BYTES = 6 * 1024 * 1024
DEFAULT_VOLUME = 0.6
_ID_RE = re.compile(r"^[0-9a-f]{12}$")
_FILE_RE = re.compile(r"^([0-9a-f]{12})\.(png|jpg|webp|gif|mp3)$")
MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "gif": "image/gif", "mp3": "audio/mpeg"}


def _get(conn, tenant_id):
    from pubg.db_pg import get_setting
    return get_setting(conn, tenant_id, SETTING, "") or ""


def _put(conn, tenant_id, raw):
    from pubg.db_pg import set_setting
    set_setting(conn, tenant_id, SETTING, raw)


def _img_ext(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    return None


def load(conn, tenant_id):
    try:
        raw = json.loads(_get(conn, tenant_id) or "{}")
    except ValueError:
        raw = {}
    img = raw.get("img") if isinstance(raw.get("img"), dict) else None
    if img and not (_ID_RE.match(str(img.get("id", ""))) and img.get("ext") in MIME and img.get("ext") != "mp3"):
        img = None
    sounds = [s for s in raw.get("sounds", []) if isinstance(s, dict) and _ID_RE.match(str(s.get("id", "")))][:MAX_SOUNDS]
    try:
        vol = max(0.0, min(1.0, float(raw.get("volume", DEFAULT_VOLUME))))
    except (TypeError, ValueError):
        vol = DEFAULT_VOLUME
    return {"img": img, "sounds": sounds, "volume": vol}


def _save(conn, tenant_id, cfg):
    _put(conn, tenant_id, json.dumps(cfg, ensure_ascii=False))


def folder(root, tenant_id):
    return os.path.join(root, "data", "pet-media", str(int(tenant_id)))


def path_of(root, tenant_id, filename):
    """Datei eines Tenants (nur <id>.<ext>, kein Pfad), sonst None."""
    if not _FILE_RE.match(filename or ""):
        return None
    p = os.path.join(folder(root, tenant_id), filename)
    return p if os.path.isfile(p) else None


def _remove(root, tenant_id, filename):
    p = path_of(root, tenant_id, filename)
    if p:
        try:
            os.remove(p)
        except OSError:
            pass


def _write(root, tenant_id, filename, data):
    os.makedirs(folder(root, tenant_id), exist_ok=True)
    with open(os.path.join(folder(root, tenant_id), filename), "wb") as f:
        f.write(data)


def set_image(conn, root, tenant_id, filename, data):
    """Bild speichern (ersetzt das alte) → (Eintrag, None) oder (None, Fehlertext, englisch)."""
    if not data:
        return None, "No file received."
    if len(data) > MAX_IMG_BYTES:
        return None, "Image too large: at most %d MB." % (MAX_IMG_BYTES // (1024 * 1024))
    ext = _img_ext(data)
    if not ext:
        return None, "This is not a PNG, JPG, WebP or GIF image."
    cfg = load(conn, tenant_id)
    fid = secrets.token_hex(6)
    _write(root, tenant_id, fid + "." + ext, data)
    if cfg["img"]:
        _remove(root, tenant_id, cfg["img"]["id"] + "." + cfg["img"]["ext"])
    cfg["img"] = {"id": fid, "ext": ext, "name": _clean_name(filename or "image." + ext), "bytes": len(data)}
    _save(conn, tenant_id, cfg)
    return cfg["img"], None


def add_sound(conn, root, tenant_id, filename, data):
    if not data:
        return None, "No file received."
    if len(data) > MAX_SOUND_BYTES:
        return None, "File too large: at most %d MB." % (MAX_SOUND_BYTES // (1024 * 1024))
    dur = mp3_duration(data)
    if dur is None:
        return None, "This is not a readable MP3 file."
    if dur > MAX_SECONDS:
        return None, "Too long: %.1f s. Pet sounds may be at most %d s." % (dur, MAX_SECONDS)
    cfg = load(conn, tenant_id)
    if len(cfg["sounds"]) >= MAX_SOUNDS:
        return None, "Already %d sounds. Delete one first." % MAX_SOUNDS
    fid = secrets.token_hex(6)
    _write(root, tenant_id, fid + ".mp3", data)
    entry = {"id": fid, "name": _clean_name(filename), "dur": dur, "bytes": len(data)}
    cfg["sounds"].append(entry)
    _save(conn, tenant_id, cfg)
    return entry, None


def delete(conn, root, tenant_id, file_id):
    """Bild oder Ton löschen."""
    cfg = load(conn, tenant_id)
    if cfg["img"] and cfg["img"]["id"] == file_id:
        _remove(root, tenant_id, file_id + "." + cfg["img"]["ext"])
        cfg["img"] = None
        _save(conn, tenant_id, cfg)
        return True
    rest = [s for s in cfg["sounds"] if s["id"] != file_id]
    if len(rest) == len(cfg["sounds"]):
        return False
    cfg["sounds"] = rest
    _save(conn, tenant_id, cfg)
    _remove(root, tenant_id, file_id + ".mp3")
    return True


def set_volume(conn, tenant_id, volume):
    cfg = load(conn, tenant_id)
    cfg["volume"] = max(0.0, min(1.0, float(volume)))
    _save(conn, tenant_id, cfg)


def for_page(cfg, base):
    """window.__PET_MEDIA__ für transitions/pet.html (base = /s/<token>/)."""
    img = cfg["img"]
    return {"img": (base + "pet-media/%s.%s" % (img["id"], img["ext"])) if img else None,
            "sounds": [{"url": base + "pet-media/%s.mp3" % s["id"], "dur": s.get("dur", 0)} for s in cfg["sounds"]],
            "volume": cfg["volume"]}
