"""Alert-Töne je Tenant: bis zu 3 MP3 pro Alert (Follow, Sub, Raid …), im Dashboard hochgeladen.

Ablage: Dateien unter data/alert-sounds/<tenant_id>/<alert>/<id>.mp3, Verzeichnis in settings['alert_sounds']:
  {"<alert>": {"volume": 0.6, "files": [{"id": "ab12cd34ef56", "name": "fanfare.mp3", "dur": 4.2, "bytes": 81234}]}}
Der Alert spielt beim Erscheinen zufällig einen der Töne (nicht zweimal hintereinander denselben) und blendet ihn
aus, wenn der Alert verschwindet (js/alert-sound.js). Kurze Töne erzwingen: höchstens MAX_SECONDS und MAX_BYTES.
"""
import json
import os
import re
import secrets

from overlay_app.overlay_catalog import ALERTS

ALERT_KEYS = tuple(a["key"] for a in ALERTS)
MAX_FILES = 3
MAX_SECONDS = 20.0
MAX_BYTES = 2 * 1024 * 1024
DEFAULT_VOLUME = 0.6
SETTING = "alert_sounds"
# Eingebaute Töne im Repo (assets/alert-sounds/<alert>.mp3): spielen, solange der Tenant keinen eigenen hat.
# Lautstärke 0 im Dashboard schaltet auch sie ab.
DEFAULTS = {"follow": "followalit.mp3"}
_ID_RE = re.compile(r"^[0-9a-f]{12}$")

# ── MP3-Länge ohne Fremdbibliothek: alle Frames ablaufen (klappt für CBR und VBR) ──
_BR = {
    (1, 1): [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    (1, 2): [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    (1, 3): [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    (2, 1): [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    (2, 2): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    (2, 3): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
_SR = {1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000]}


def _frame(data, i):
    """(Länge in Bytes, Samples, Abtastrate) des MPEG-Audio-Frames ab i, sonst None."""
    if i + 4 > len(data) or data[i] != 0xFF or (data[i + 1] & 0xE0) != 0xE0:
        return None
    b1, b2 = data[i + 1], data[i + 2]
    ver = {3: 1, 2: 2, 0: 25}.get((b1 >> 3) & 3)
    layer = {3: 1, 2: 2, 1: 3}.get((b1 >> 1) & 3)
    bri, sri, pad = b2 >> 4, (b2 >> 2) & 3, (b2 >> 1) & 1
    if ver is None or layer is None or bri in (0, 15) or sri == 3:
        return None
    br = _BR[(1 if ver == 1 else 2, layer)][bri] * 1000
    sr = _SR[ver][sri]
    if layer == 1:
        return (12 * br // sr + pad) * 4, 384, sr
    samples = 1152 if (layer == 2 or ver == 1) else 576
    return samples // 8 * br // sr + pad, samples, sr


def mp3_duration(data):
    """Länge in Sekunden oder None, wenn es kein (sauberes) MP3 ist."""
    i = 0
    if data[:3] == b"ID3" and len(data) >= 10:   # ID3v2-Tag überspringen (Größe syncsafe)
        i = 10 + ((data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F))
    end = len(data) - (128 if data[-128:-125] == b"TAG" else 0)
    # bis zum ersten echten Frame suchen (Füllbytes), aber nur kurz
    start = i
    while i < min(end, start + 4096) and _frame(data, i) is None:
        i += 1
    seconds, frames, covered = 0.0, 0, 0
    first = i
    while i < end:
        f = _frame(data, i)
        if f is None or f[0] <= 4:
            break
        seconds += f[1] / f[2]
        frames += 1
        covered += f[0]
        i += f[0]
    if frames < 10 or covered < 0.9 * (end - first):
        return None
    return round(seconds, 2)


# ── Verzeichnis in den Settings ──

def _clean_name(name):
    base = os.path.basename(name or "sound.mp3")
    base = re.sub(r"[^\w .()\-]", "", base).strip() or "sound.mp3"
    return base[:80]


def load(conn, tenant_id):
    from pubg.db_pg import get_setting
    try:
        raw = json.loads(get_setting(conn, tenant_id, SETTING, "") or "{}")
    except ValueError:
        raw = {}
    out = {}
    for key in ALERT_KEYS:
        e = raw.get(key) if isinstance(raw.get(key), dict) else {}
        files = [f for f in e.get("files", []) if isinstance(f, dict) and _ID_RE.match(str(f.get("id", "")))]
        try:
            vol = max(0.0, min(1.0, float(e.get("volume", DEFAULT_VOLUME))))
        except (TypeError, ValueError):
            vol = DEFAULT_VOLUME
        out[key] = {"volume": vol, "files": files[:MAX_FILES]}
    return out


def _save(conn, tenant_id, data):
    from pubg.db_pg import set_setting
    set_setting(conn, tenant_id, SETTING, json.dumps(data, ensure_ascii=False))


def folder(root, tenant_id, alert):
    return os.path.join(root, "data", "alert-sounds", str(int(tenant_id)), alert)


def path_of(root, tenant_id, alert, file_id):
    if alert not in ALERT_KEYS or not _ID_RE.match(file_id or ""):
        return None
    p = os.path.join(folder(root, tenant_id, alert), file_id + ".mp3")
    return p if os.path.isfile(p) else None


def add(conn, root, tenant_id, alert, filename, data):
    """Neuen Ton speichern → (Eintrag, None) oder (None, Fehlertext fürs Dashboard, englisch)."""
    if alert not in ALERT_KEYS:
        return None, "Unknown alert."
    if not data:
        return None, "No file received."
    if len(data) > MAX_BYTES:
        return None, "File too large: at most %d MB." % (MAX_BYTES // (1024 * 1024))
    dur = mp3_duration(data)
    if dur is None:
        return None, "This is not a readable MP3 file."
    if dur > MAX_SECONDS:
        return None, "Too long: %.1f s. Alert sounds may be at most %d s." % (dur, MAX_SECONDS)
    cfg = load(conn, tenant_id)
    if len(cfg[alert]["files"]) >= MAX_FILES:
        return None, "Already %d sounds for this alert. Delete one first." % MAX_FILES
    fid = secrets.token_hex(6)
    os.makedirs(folder(root, tenant_id, alert), exist_ok=True)
    with open(os.path.join(folder(root, tenant_id, alert), fid + ".mp3"), "wb") as f:
        f.write(data)
    entry = {"id": fid, "name": _clean_name(filename), "dur": dur, "bytes": len(data)}
    cfg[alert]["files"].append(entry)
    _save(conn, tenant_id, cfg)
    return entry, None


def delete(conn, root, tenant_id, alert, file_id):
    if alert not in ALERT_KEYS:
        return False
    cfg = load(conn, tenant_id)
    files = cfg[alert]["files"]
    rest = [f for f in files if f["id"] != file_id]
    if len(rest) == len(files):
        return False
    cfg[alert]["files"] = rest
    _save(conn, tenant_id, cfg)
    p = path_of(root, tenant_id, alert, file_id)
    if p:
        try:
            os.remove(p)
        except OSError:
            pass
    return True


def set_volume(conn, tenant_id, alert, volume):
    if alert not in ALERT_KEYS:
        return False
    cfg = load(conn, tenant_id)
    cfg[alert]["volume"] = max(0.0, min(1.0, float(volume)))
    _save(conn, tenant_id, cfg)
    return True


def for_overlay(cfg, alert):
    """Was der Alert im Browser braucht (wird als window.__ALERT_SOUND__ injiziert).
    default: eingebauter Ton (nur ohne eigene Dateien), relativ zur Token-Basis."""
    e = cfg.get(alert) or {}
    files = [f["id"] for f in e.get("files", [])]
    out = {"volume": e.get("volume", DEFAULT_VOLUME), "files": files}
    if not files and alert in DEFAULTS:
        out["default"] = "assets/alert-sounds/%s.mp3" % alert
    return out
