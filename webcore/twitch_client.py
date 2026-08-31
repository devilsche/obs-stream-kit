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

# Twitchs oeffentliche Web-Client-ID + persisted Query fuer den Clip-Token.
# Noetig, weil das offizielle clips.twitch.tv/embed-iframe bei Kanaelen mit
# Content Classification Labels ein Interstitial ("Start Watching") vorschaltet,
# das auf einen Klick wartet — im Overlay klickt niemand, der Clip bleibt stehen.
# Mit der signierten MP4-URL spielt das Overlay den Clip in einem eigenen
# <video>-Element, ohne iframe und ohne Gate.
GQL_URL = "https://gql.twitch.tv/gql"
GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
# Die Query wird im Klartext geschickt statt als persisted-Query-Hash: Twitch
# rotiert die Hashes, und ein abgelaufener Hash antwortet mit
# "PersistedQueryNotFound" — dann fehlt jedem Clip die mp4-URL und die Szene
# zeigt "Keine Clips gefunden". Der Operationsname muss in der Query stehen,
# sonst lehnt der Batch-Endpoint sie ab ("no operation with name ...").
GQL_CLIP_TOKEN_QUERY = (
    "query VideoAccessToken_Clip($slug: ID!) {"
    " clip(slug: $slug) {"
    " id"
    " playbackAccessToken(params: {platform: \"web\","
    " playerBackend: \"mediaplayer\", playerType: \"site\"})"
    " { signature value }"
    " videoQualities { frameRate quality sourceURL }"
    " } }"
)


# Twitch beantwortet zu grosse GQL-Batches gar nicht mehr — ab etwa 35
# Operationen kippt die komplette Antwort, nicht nur der Ueberhang. 30 liegt
# sicher darunter; 100 Clips sind damit vier Requests.
GQL_BATCH_SIZE = 30


def get_clip_mp4_urls(slugs: list) -> dict:
    """Slug -> signierte MP4-URL (hoechste verfuegbare Qualitaet).

    Fragt in Haeppchen von GQL_BATCH_SIZE an. Die Tokens sind rund 20 h
    gueltig, liegen also laenger als jede Overlay-Session.

    Fehlende oder geloeschte Clips fehlen im Ergebnis, ein fehlgeschlagener
    Chunk kostet nur seine eigenen URLs — der Aufrufer behaelt seine
    Clip-Liste und faellt fuer die betroffenen Clips ohne mp4-Feld zurueck.
    """
    slugs = [s for s in (slugs or []) if s]
    out = {}
    for i in range(0, len(slugs), GQL_BATCH_SIZE):
        out.update(_clip_mp4_batch(slugs[i:i + GQL_BATCH_SIZE]))
    return out


def _clip_mp4_batch(slugs: list) -> dict:
    """Ein GQL-Batch-Request. Siehe get_clip_mp4_urls."""
    from urllib.parse import quote
    from webcore.metrics import observe_external

    if not slugs:
        return {}
    ops = [{
        "operationName": "VideoAccessToken_Clip",
        "query": GQL_CLIP_TOKEN_QUERY,
        "variables": {"slug": s},
    } for s in slugs]
    try:
        with observe_external("twitch", "gql_clip_token") as obs:
            r = requests.post(GQL_URL, headers={"Client-ID": GQL_CLIENT_ID},
                              json=ops, timeout=15)
            obs.set_status(r.status_code)
        body = r.json()
    except Exception:
        return {}
    if not isinstance(body, list):
        return {}

    # Zuordnung ueber die Position: GQL antwortet 1:1 in Reihenfolge der Ops.
    # Robuster als clip["id"], das die persisted Query nicht zwingend liefert.
    out = {}
    for slug, item in zip(slugs, body):
        try:
            clip = (item or {}).get("data", {}).get("clip")
            if not clip:
                continue
            qualities = clip.get("videoQualities") or []
            if not qualities:
                continue
            best = max(qualities, key=lambda q: int(q.get("quality") or 0))
            pat = clip.get("playbackAccessToken") or {}
            sig, token = pat.get("signature"), pat.get("value")
            if not (best.get("sourceURL") and sig and token):
                continue
            out[slug] = f"{best['sourceURL']}?sig={sig}&token={quote(token)}"
        except Exception:
            continue
    return out


def get_clips(client_id: str, client_secret: str, channel: str = None,
              count: int = 100, broadcaster_id: str = None) -> list:
    """App-Token holen, Channel -> broadcaster_id, Clips laden.

    Ist `broadcaster_id` gesetzt (aus users.twitch_user_id), entfaellt der
    /helix/users-Lookup — spart einen Call und ist immun gegen Namensaenderungen.
    Sonst wird `channel` als Login-Name aufgeloest.

    Returns Liste von {id,title,duration,createdAt,views,creator}.
    Leere Liste wenn Channel unbekannt, keine Clips oder Netzwerkfehler.
    """
    from webcore.metrics import observe_external

    if not broadcaster_id and not channel:
        return []
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

    if not broadcaster_id:
        try:
            with observe_external("twitch", "users") as obs:
                ur = requests.get(f"{TWITCH_HELIX}/users",
                                  params={"login": channel}, headers=headers,
                                  timeout=10)
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
    return _map_clips(cdata)


def _map_clips(cdata: list) -> list:
    """Helix-Clips auf das Overlay-Format bringen und MP4-URLs anhaengen."""
    media = get_clip_mp4_urls([c.get("id") for c in cdata])
    return [{
        "id": c.get("id"),
        "title": c.get("title") or "",
        "duration": c.get("duration") or 30,
        "createdAt": c.get("created_at") or "",
        "views": c.get("view_count") or 0,
        "creator": c.get("creator_name") or "",
        "mp4": media.get(c.get("id")),
    } for c in cdata]


def get_clips_by_ids(client_id: str, client_secret: str, slugs: list) -> list:
    """Clips zu einer festen Slug-Liste (?clips=A,B,C im Overlay).

    Gleiches Ausgabeformat wie get_clips, inklusive mp4-URL.
    """
    from webcore.metrics import observe_external

    slugs = [s for s in (slugs or []) if s][:100]
    if not slugs:
        return []
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
    try:
        with observe_external("twitch", "clips") as obs:
            cr = requests.get(f"{TWITCH_HELIX}/clips", params={"id": slugs},
                              headers={"Client-ID": client_id,
                                       "Authorization": f"Bearer {token}"},
                              timeout=10)
            obs.set_status(cr.status_code)
        cdata = (cr.json() or {}).get("data") or []
    except Exception:
        return []
    return _map_clips(cdata)
