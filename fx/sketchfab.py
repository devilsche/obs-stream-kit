"""Sketchfab-Modelle für die Vorschau im Car-Picker (tools/car-picker.html) holen und zwischenspeichern.

Download braucht ein Konto: Token aus der Umgebung (SKETCHFAB_API_TOKEN) oder .secrets
('Sketchfab API Token: …'). Ablauf: GET /v3/models/<uid>/download (mit Token) liefert eine
zeitlich begrenzte Adresse der GLB-Datei; die wird einmal geladen und unter
data/car-cache/<uid>.glb aufgehoben.
"""
import json
import os
import re
import tempfile
import threading
import urllib.request

# Modell-IDs: alt 32 Hex-Zeichen, neu (seit 2025) 27 Zeichen aus Buchstaben und Ziffern, z. B. 6hiH0iyDqXqtdD9wbqSbyLLhKmz
UID_PAT = r"(?:[0-9a-f]{32}|[0-9A-Za-z]{27})"
UID_RE = re.compile(r"^" + UID_PAT + r"$")
_BASE_RE = re.compile(r"^(" + UID_PAT + r")(?=[-.]|$)")


def base_uid(s):
    """Modell-ID am Anfang eines Namens („<uid>-tree“, „<uid>.glb“), sonst None."""
    m = _BASE_RE.match(s or "") if isinstance(s, str) else None
    return m.group(1) if m else None
API = "https://api.sketchfab.com/v3/models/{uid}/download"
MAX_BYTES = 150 * 1024 * 1024
_locks = {}
_guard = threading.Lock()


class FetchError(Exception):
    def __init__(self, msg, status=502):
        super().__init__(msg)
        self.status = status


class RateLimited(FetchError):
    """Sketchfab sagt 429: zu viele Downloads, später nochmal."""
    def __init__(self):
        super().__init__("Sketchfab rate limit, try again later", 429)


def token(root: str):
    t = os.environ.get("SKETCHFAB_API_TOKEN")
    if t:
        return t.strip()
    p = os.path.join(root, ".secrets")
    if not os.path.exists(p):
        return None
    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            k, _, v = line.rstrip("\n").partition(":")
            if k.strip() == "Sketchfab API Token" and v.strip():
                return v.strip()
    return None


def cached(root: str, uid: str) -> bool:
    return bool(isinstance(uid, str) and UID_RE.match(uid) and os.path.exists(cache_path(root, uid)))


def cache_path(root: str, uid: str) -> str:
    return os.path.join(root, "data", "car-cache", uid + ".glb")


def _lock(uid):
    with _guard:
        return _locks.setdefault(uid, threading.Lock())


def _open(url, headers=None, timeout=60):
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=timeout)


def fetch(root: str, uid: str) -> str:
    """Pfad der GLB-Datei; lädt sie beim ersten Mal von Sketchfab. FetchError mit Text für die Oberfläche."""
    if not isinstance(uid, str) or not UID_RE.match(uid):
        raise FetchError("Unknown model")
    path = cache_path(root, uid)
    if os.path.exists(path):
        return path
    tok = token(root)
    if not tok:
        raise FetchError("No Sketchfab token on the server")
    with _lock(uid):
        if os.path.exists(path):
            return path
        try:
            with _open(API.format(uid=uid), {"Authorization": "Token " + tok}, 30) as r:
                info = json.load(r)
        except Exception as e:
            if getattr(e, "code", None) == 429:
                raise RateLimited() from e
            raise FetchError("Sketchfab refused the download (%s)" % getattr(e, "code", "network")) from e
        url = (info.get("glb") or {}).get("url")
        if not url:
            raise FetchError("This model has no GLB download")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".dl-", suffix=".glb")
        try:
            size = 0
            with os.fdopen(fd, "wb") as out, _open(url, None, 120) as r:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise FetchError("Model is too large for the preview")
                    out.write(chunk)
            os.replace(tmp, path)
        except FetchError:
            raise
        except Exception as e:
            raise FetchError("Download failed") from e
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    return path
