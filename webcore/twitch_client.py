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
