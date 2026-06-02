"""Minimaler Twitch Helix HTTP-Client fuer OAuth-Flow.

Verwendet requests (Standard-Lib im venv). Keine Async-Komplikation.
"""
import requests

from webcore.config import Config


def exchange_code(code: str, client_id: str, client_secret: str,
                  redirect_uri: str) -> str:
    """OAuth Code → Access-Token."""
    resp = requests.post(Config.TWITCH_TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Twitch token-exchange fehlgeschlagen: {resp.status_code} {resp.text[:200]}"
        )
    return resp.json()["access_token"]


def get_user_info(access_token: str, client_id: str) -> dict:
    """Liefert dict mit id, login, display_name, avatar_url, email."""
    resp = requests.get(Config.TWITCH_USERINFO_URL, headers={
        "Authorization": f"Bearer {access_token}",
        "Client-Id": client_id,
    }, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Twitch /users fehlgeschlagen: {resp.status_code} {resp.text[:200]}"
        )
    data = resp.json().get("data", [])
    if not data:
        raise RuntimeError("Twitch lieferte leeren User-Block")
    u = data[0]
    return {
        "id": u["id"],
        "login": u["login"],
        "display_name": u.get("display_name") or u["login"],
        "avatar_url": u.get("profile_image_url"),
        "email": u.get("email"),
    }


TWITCH_HELIX = "https://api.twitch.tv/helix"


def get_clips(client_id: str, client_secret: str, channel: str,
              count: int = 100) -> list:
    """App-Token holen, Channel -> broadcaster_id, Clips laden.

    Returns Liste von {id,title,duration,createdAt,views,creator}.
    Leere Liste wenn Channel unbekannt, keine Clips oder Netzwerkfehler.
    """
    from webcore.metrics import observe_external

    count = max(1, min(int(count or 100), 100))
    try:
        with observe_external("twitch", "oauth_token") as obs:
            tr = requests.post(Config.TWITCH_TOKEN_URL, data={
                "client_id": client_id, "client_secret": client_secret,
                "grant_type": "client_credentials"}, timeout=10)
            obs.set_status(tr.status_code)
        token = (tr.json() or {}).get("access_token")
    except Exception:
        return []
    if not token:
        return []
    headers = {"Client-ID": client_id, "Authorization": f"Bearer {token}"}

    try:
        with observe_external("twitch", "users") as obs:
            ur = requests.get(f"{TWITCH_HELIX}/users",
                              params={"login": channel}, headers=headers, timeout=10)
            obs.set_status(ur.status_code)
        udata = (ur.json() or {}).get("data") or []
    except Exception:
        return []
    if not udata:
        return []
    broadcaster_id = udata[0]["id"]

    try:
        with observe_external("twitch", "clips") as obs:
            cr = requests.get(f"{TWITCH_HELIX}/clips",
                              params={"broadcaster_id": broadcaster_id,
                                      "first": count},
                              headers=headers, timeout=10)
            obs.set_status(cr.status_code)
        cdata = (cr.json() or {}).get("data") or []
    except Exception:
        return []
    return [{
        "id": c.get("id"),
        "title": c.get("title") or "",
        "duration": c.get("duration") or 30,
        "createdAt": c.get("created_at") or "",
        "views": c.get("view_count") or 0,
        "creator": c.get("creator_name") or "",
    } for c in cdata]
