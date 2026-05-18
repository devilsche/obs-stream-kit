"""Steam-Avatar-Cache.

Holt das volle Profil-Bild via Steam Web API (GetPlayerSummaries),
speichert als webp unter data/steam-avatars/<steamId>.webp.

Steam-API-Key liegt schon in .secrets (vom Steam-Widget). Wir lesen
ihn beim Init durch.
"""

import io
import os
import urllib.request


CACHE_DIR_REL = ("data", "steam-avatars")


def _cache_path(root, steam_id):
    safe = "".join(c for c in steam_id if c.isalnum())
    return os.path.join(root, *CACHE_DIR_REL, f"{safe}.webp")


def url_for(root, steam_id):
    """Fuer Frontend: liefert die URL unter der das Cache-Bild
    bereitgestellt wird. Falls Datei nicht da → None (Caller fallbackt
    auf default-Avatar)."""
    if not steam_id:
        return None
    path = _cache_path(root, steam_id)
    if os.path.exists(path):
        return f"/steam-avatars/{steam_id}.webp"
    return None


def fetch_and_cache(root, steam_id, api_key, force=False):
    """Holt das Profil-Image via Steam-API + speichert als webp.
    Returns True bei Erfolg."""
    if not steam_id or not api_key:
        return False
    out = _cache_path(root, steam_id)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if os.path.exists(out) and not force:
        return True
    api = (f"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
           f"?key={api_key}&steamids={steam_id}")
    try:
        req = urllib.request.Request(api, headers={"User-Agent": "obs-stream-kit/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            import json
            data = json.loads(r.read().decode("utf-8"))
    except Exception:
        return False
    players = (data.get("response") or {}).get("players") or []
    if not players:
        return False
    # avatarfull = 184x184, avatar = 32x32, avatarmedium = 64x64
    img_url = players[0].get("avatarfull") or players[0].get("avatarmedium")
    if not img_url:
        return False
    try:
        with urllib.request.urlopen(img_url, timeout=10) as r:
            img_bytes = r.read()
    except Exception:
        return False
    # Konvertiere zu webp via PIL (falls verfuegbar) — sonst raw speichern
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(img_bytes))
        if im.mode != "RGBA":
            im = im.convert("RGBA")
        im.save(out, "WEBP", quality=85, method=6)
    except Exception:
        with open(out, "wb") as f:
            f.write(img_bytes)
    return True


def fetch_all_pending(root, db_conn, api_key):
    """Iteriert alle User mit gesetzter steam_id, holt fehlende Avatare.
    Returns (anzahl_neu, anzahl_fehlgeschlagen)."""
    rows = db_conn.execute(
        "SELECT ts_uid, steam_id FROM teamspeak_users "
        "WHERE steam_id IS NOT NULL AND steam_id != ''"
    ).fetchall()
    new = 0
    err = 0
    for r in rows:
        sid = r["steam_id"]
        if os.path.exists(_cache_path(root, sid)):
            continue
        if fetch_and_cache(root, sid, api_key):
            new += 1
        else:
            err += 1
    return (new, err)
