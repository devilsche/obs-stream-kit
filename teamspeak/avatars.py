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


def _cache_path(root, steam_id, suffix=""):
    safe = "".join(c for c in steam_id if c.isalnum())
    return os.path.join(root, *CACHE_DIR_REL, f"{safe}{suffix}.webp")


def url_for(root, steam_id):
    if not steam_id:
        return None
    path = _cache_path(root, steam_id)
    if os.path.exists(path):
        return f"/steam-avatars/{steam_id}.webp"
    return None


def frame_url_for(root, steam_id):
    """Liefert URL zum Frame-Cache wenn vorhanden, sonst None."""
    if not steam_id:
        return None
    path = _cache_path(root, steam_id, suffix="_frame")
    if os.path.exists(path):
        return f"/steam-avatars/{steam_id}_frame.webp"
    return None


def _http_get_json(url):
    import json
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "obs-stream-kit/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def _download_to_webp(url, out_path):
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = r.read()
    except Exception:
        return False
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        if im.mode != "RGBA":
            im = im.convert("RGBA")
        im.save(out_path, "WEBP", quality=85, method=6)
    except Exception:
        with open(out_path, "wb") as f:
            f.write(data)
    return True


def fetch_and_cache(root, steam_id, api_key, force=False):
    """Holt Profil-Avatar + ggf. Steam-Avatar-Frame via Steam-API.
    Returns True wenn mindestens der Avatar gespeichert wurde."""
    if not steam_id or not api_key:
        return False
    avatar_out = _cache_path(root, steam_id)
    frame_out  = _cache_path(root, steam_id, suffix="_frame")
    os.makedirs(os.path.dirname(avatar_out), exist_ok=True)
    need_avatar = force or not os.path.exists(avatar_out)
    need_frame  = force or not os.path.exists(frame_out)
    avatar_ok = os.path.exists(avatar_out)
    # ── Avatar ───────────────────────────────────────────────────────
    if need_avatar:
        data = _http_get_json(
            f"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
            f"?key={api_key}&steamids={steam_id}")
        if data:
            players = (data.get("response") or {}).get("players") or []
            if players:
                img_url = (players[0].get("avatarfull")
                            or players[0].get("avatarmedium"))
                if img_url and _download_to_webp(img_url, avatar_out):
                    avatar_ok = True
    # ── Frame (Premium-Feature; viele Accounts haben keinen) ─────────
    if need_frame:
        data = _http_get_json(
            f"https://api.steampowered.com/IPlayerService/GetAvatarFrame/v1/"
            f"?key={api_key}&steamid={steam_id}")
        if data:
            frame_info = (data.get("response") or {}).get("avatar_frame") or {}
            img_url = (frame_info.get("image_large")
                       or frame_info.get("image_small"))
            if img_url:
                _download_to_webp(img_url, frame_out)
            else:
                # Kein Frame gesetzt → ggf. alte Datei loeschen
                try: os.remove(frame_out)
                except (FileNotFoundError, OSError): pass
    return avatar_ok


def fetch_all_pending(root, db_conn, api_key, max_age_secs=None):
    """Iteriert alle User mit gesetzter steam_id, holt fehlende oder
    veraltete Avatare. max_age_secs: wenn gesetzt, werden Cache-Files
    aelter als das Alter neu geholt (Default None = nur fehlende).
    Returns (anzahl_neu, anzahl_fehlgeschlagen)."""
    rows = db_conn.execute(
        "SELECT ts_uid, steam_id FROM teamspeak_users "
        "WHERE steam_id IS NOT NULL AND steam_id != ''"
    ).fetchall()
    new = 0
    err = 0
    import time
    now = time.time()
    for r in rows:
        sid = r["steam_id"]
        path = _cache_path(root, sid)
        if os.path.exists(path):
            if max_age_secs is None:
                continue
            mtime = os.path.getmtime(path)
            if (now - mtime) < max_age_secs:
                continue
        if fetch_and_cache(root, sid, api_key, force=True):
            new += 1
        else:
            err += 1
    return (new, err)


def start_refresh_thread(root, db_conn, api_key, interval_secs=900):
    """Background-Thread der alle interval_secs Sekunden veraltete
    Avatar-Cache-Files neu zieht. Default 15 Minuten."""
    import threading
    import time

    def _loop():
        while True:
            try:
                fetch_all_pending(root, db_conn, api_key,
                                    max_age_secs=interval_secs)
            except Exception:
                pass
            time.sleep(interval_secs)

    t = threading.Thread(target=_loop, name="ts-avatar-refresh", daemon=True)
    t.start()
    return t
