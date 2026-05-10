"""
Lokaler Image-Cache für Steam-Assets.

Hintergrund: wenn ein Spiel von Steam delisted wird (z.B. UT2004),
verschwinden Header-Image + Storefront-Description gleichzeitig. Wer
die Daten nicht lokal gecached hat, sieht im Widget nur noch Spielzeit
ohne Bild/Beschreibung. Dieser Cache hält alle Images auf Platte und
liefert per `/steam/img/<app_id>/<type>.jpg` aus dem lokalen Cache —
mit Fallback auf das remote CDN wenn die Datei noch nicht runter-
geladen wurde.

Pfade:
  data/steam-cache/images/<app_id>_<type>.jpg
    type ∈ {header, logo, icon}

Download passiert im Poller (Layer 1/3), Endpoint liest nur lokale
Files aus.
"""
import os
import urllib.error
import urllib.request


IMAGE_TYPES = {"header", "logo", "icon"}


def cache_dir(root: str) -> str:
    """Returns the absolute directory where images are cached."""
    d = os.path.join(root, "data", "steam-cache", "images")
    os.makedirs(d, exist_ok=True)
    return d


def cached_path(root: str, app_id: int, kind: str) -> str:
    """Vorhergesehener Pfad. Existiert evtl. noch nicht."""
    return os.path.join(cache_dir(root), f"{app_id}_{kind}.jpg")


def has_cached(root: str, app_id: int, kind: str) -> bool:
    p = cached_path(root, app_id, kind)
    return os.path.isfile(p) and os.path.getsize(p) > 0


def download_image(url: str, dest: str, timeout: float = 10.0) -> bool:
    """Lädt URL → dest. Returns True bei Erfolg."""
    if not url or not dest:
        return False
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        return True
    tmp = dest + ".part"
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "obs-stream-kit/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        if not data:
            return False
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, dest)
        return True
    except (urllib.error.URLError, urllib.error.HTTPError, OSError):
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)
        except OSError:
            pass
        return False


def ensure_app_images(root: str, app_id: int,
                       header_url: str = None,
                       logo_url: str = None,
                       icon_url: str = None) -> dict:
    """Stellt sicher dass alle drei Image-Varianten lokal gecached
    sind (lädt fehlende nach). Returns dict {kind: True/False}."""
    out = {}
    for kind, url in (("header", header_url),
                       ("logo",   logo_url),
                       ("icon",   icon_url)):
        if not url:
            out[kind] = has_cached(root, app_id, kind)
            continue
        dest = cached_path(root, app_id, kind)
        if has_cached(root, app_id, kind):
            out[kind] = True
        else:
            out[kind] = download_image(url, dest)
    return out


def local_url(app_id: int, kind: str) -> str:
    """Pfad unter dem das gecachte Bild via HTTP ausgeliefert wird.
    Wird vom Endpoint /steam/img/<app_id>/<kind>.jpg gehandelt."""
    return f"/steam/img/{app_id}/{kind}.jpg"
