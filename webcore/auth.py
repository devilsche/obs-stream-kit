"""Twitch OAuth-Flow + Admin-Claim.

Flask-Blueprint mit /app/login, /app/oauth/callback, /app/logout.
"""
import secrets
import urllib.parse
from flask import (
    Blueprint, redirect, request, session, abort, g, current_app, make_response
)

from webcore.config import Config
from webcore.twitch_client import (exchange_code, get_user_info, get_recent_followers,  # exposed for mock
                                   get_subscribers)
from webcore import sessions as srv_sessions
from webcore.middleware import _get_conn, require_session


bp_auth = Blueprint("auth", __name__)


@bp_auth.route("/app/login")
def login():
    state = secrets.token_urlsafe(32)
    session["oauth_state"] = state
    params = {
        "client_id": current_app.config["TWITCH_CLIENT_ID"],
        "redirect_uri": current_app.config["TWITCH_REDIRECT_URI"],
        "response_type": "code",
        "scope": current_app.config["TWITCH_SCOPES"],
        "state": state,
    }
    url = current_app.config["TWITCH_AUTH_URL"] + "?" + urllib.parse.urlencode(params)
    return redirect(url, code=302)


def _start_import(what, scope):
    """Einmal-Login für einen Import; der Token wird nur für diesen Abruf
    benutzt und nicht gespeichert."""
    state = secrets.token_urlsafe(32)
    session["oauth_state"] = state
    session["oauth_import"] = {"tenant": g.tenant_id, "twitch_user_id": g.user.get("twitch_user_id"), "what": what}
    params = {
        "client_id": current_app.config["TWITCH_CLIENT_ID"],
        "redirect_uri": current_app.config["TWITCH_REDIRECT_URI"],
        "response_type": "code",
        "scope": "user:read:email " + scope,
        "state": state,
    }
    return redirect(current_app.config["TWITCH_AUTH_URL"] + "?" + urllib.parse.urlencode(params), code=302)


@bp_auth.route("/app/twitch/import-followers")
@require_session
def import_followers():
    """Die letzten 60 Follower in die gemeinsame Follower-Liste der Weather-Source."""
    return _start_import("followers", "moderator:read:followers")


@bp_auth.route("/app/twitch/import-subs")
@require_session
def import_subs():
    """Aktuelle Abonnenten als Geschenke unter den Baum (Xmas-Zeit)."""
    return _start_import("subs", "channel:read:subscriptions")


def _import_conn():
    import sqlite3
    from core.db_compat import SqliteCompatConn
    raw = _get_conn()
    return raw, (raw if isinstance(raw, (sqlite3.Connection, SqliteCompatConn)) else SqliteCompatConn(raw))


def _check_own_channel(imp, info):
    if not imp.get("tenant") or str(info.get("id")) != str(imp.get("twitch_user_id")):
        abort(403, description="Twitch account does not match the logged-in user")


def _finish_sub_import(imp, access_token, info, cfg):
    """Je Abonnent ein Geschenk; Geschenk-Subs zählen für den Schenkenden
    (giftsub mit Anzahl), Tier 2/3 als Menge. Wer schon ein Geschenk hat
    und der eigene Kanal werden übersprungen."""
    from fx import xmas_db
    _check_own_channel(imp, info)
    try:
        subs = get_subscribers(access_token, cfg["TWITCH_CLIENT_ID"], info["id"])
    except RuntimeError as e:
        abort(502, description=str(e))
    me = (info.get("display_name") or info.get("login") or "").lower()
    subs = [s for s in subs if s["name"] and s["name"].lower() != me]
    own, gifted = {}, {}
    for s in subs:
        if s["gift"] and s["gifter"]:
            gifted[s["gifter"]] = gifted.get(s["gifter"], 0) + 1
        elif not s["gift"]:
            own[s["name"]] = max(own.get(s["name"], 0), s["tier"])
    raw, conn = _import_conn()
    added = 0
    try:
        known = xmas_db.gift_names(conn, imp["tenant"])
        for name, gtype, amount in ([(n, "sub", t) for n, t in own.items()]
                                    + [(n, "giftsub", c) for n, c in gifted.items()]):
            if name.lower() in known or name.lower() == me:
                continue
            xmas_db.add_gift(conn, imp["tenant"], name, gtype, amount)
            known.add(name.lower())
            added += 1
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            raw.close()
    return redirect("/app/urls?subs_imported=%d&subs_seen=%d#src=effects%%2Fweather.html"
                    % (added, len(subs)), code=302)


def _finish_follower_import(imp, access_token, info, cfg):
    """Nur der eigene Kanal: der Twitch-Account muss zum angemeldeten Nutzer passen."""
    from fx import weather_followers
    from core.db_compat import SqliteCompatConn
    if not imp.get("tenant") or str(info.get("id")) != str(imp.get("twitch_user_id")):
        abort(403, description="Twitch account does not match the logged-in user")
    try:
        names = get_recent_followers(access_token, cfg["TWITCH_CLIENT_ID"], info["id"], 60)
    except RuntimeError as e:
        abort(502, description=str(e))
    import sqlite3
    raw = _get_conn()
    conn = raw if isinstance(raw, (sqlite3.Connection, SqliteCompatConn)) else SqliteCompatConn(raw)
    added = 0
    try:
        for name in reversed(names):          # älteste zuerst, damit die Reihenfolge stimmt
            if name and weather_followers.add(conn, imp["tenant"], name):
                added += 1
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            raw.close()
    # zurück auf die Weather-Karte (Reiter bleibt wie zuletzt geöffnet)
    return redirect("/app/urls?followers_imported=%d&followers_seen=%d#src=effects%%2Fweather.html"
                    % (added, len(names)), code=302)


@bp_auth.route("/app/oauth/callback")
def callback():
    state = request.args.get("state")
    code = request.args.get("code")
    if not state or state != session.pop("oauth_state", None):
        abort(400, description="OAuth-State-Mismatch (CSRF)")
    if not code:
        abort(400, description="Missing OAuth code")

    cfg = current_app.config
    try:
        access_token = exchange_code(
            code, cfg["TWITCH_CLIENT_ID"], cfg["TWITCH_CLIENT_SECRET"],
            cfg["TWITCH_REDIRECT_URI"],
        )
        info = get_user_info(access_token, cfg["TWITCH_CLIENT_ID"])
    except RuntimeError as e:
        abort(502, description=str(e))

    imp = session.pop("oauth_import", None)
    if imp:
        if imp.get("what") == "subs":
            return _finish_sub_import(imp, access_token, info, cfg)
        return _finish_follower_import(imp, access_token, info, cfg)

    conn = _get_conn()
    try:
        user = _lookup_or_create_user(conn, info)
        _sync_twitch_channel(conn, user["id"], info.get("login"))
        sid = srv_sessions.create(
            conn, user_id=user["id"],
            user_agent=request.headers.get("User-Agent"),
            ip=request.remote_addr,
        )
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()

    target = "/app/" if user["is_approved"] else "/app/pending"
    resp = make_response(redirect(target, code=302))
    resp.set_cookie(
        Config.OBSKIT_SID_COOKIE, sid,
        max_age=Config.SESSION_LIFETIME_DAYS * 86400,
        secure=not current_app.config.get("TESTING"),
        httponly=True, samesite="Lax",
        domain=current_app.config.get("OBSKIT_COOKIE_DOMAIN"),
    )
    return resp


@bp_auth.route("/app/logout")
def logout():
    sid = request.cookies.get(Config.OBSKIT_SID_COOKIE)
    if sid:
        conn = _get_conn()
        try:
            srv_sessions.revoke(conn, sid)
        finally:
            if "_PG_CONN_FACTORY" not in current_app.config:
                conn.close()
    resp = make_response(redirect("/", code=302))
    resp.delete_cookie(
        Config.OBSKIT_SID_COOKIE,
        domain=current_app.config.get("OBSKIT_COOKIE_DOMAIN"),
    )
    return resp


def _sync_twitch_channel(conn, user_id: int, login: str) -> None:
    """Clip-Channel des eigenen Tenants aus dem Login-Namen befuellen.

    Nur wenn noch nichts hinterlegt ist — ein bewusst eingetragener
    Fremd-Channel bleibt unangetastet. Ohne das faellt der Clip-Abruf auf
    den globalen .secrets-Channel zurueck und fremde Tenants saehen die
    Clips des Admins.
    """
    if not login:
        return
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials tc
            SET twitch_channel = %s, updated_at = now()
            FROM tenants t
            WHERE t.id = tc.tenant_id
              AND t.owner_user_id = %s
              AND (tc.twitch_channel IS NULL OR tc.twitch_channel = '')
        """, (login, user_id))
    conn.commit()


def _lookup_or_create_user(conn, info: dict) -> dict:
    """3 Pfade:
    1. Existing user with twitch_user_id == info.id → login.
    2. Existing admin-row with twitch_user_id IS NULL AND is_admin=TRUE → claim.
    3. New user → INSERT with is_approved=FALSE.
    """
    twitch_id = info["id"]
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, is_admin, is_approved FROM users WHERE twitch_user_id = %s",
            (twitch_id,)
        )
        row = cur.fetchone()
        if row:
            return dict(row)

        # 2. Admin-Claim?
        cur.execute("""
            SELECT id FROM users
            WHERE twitch_user_id IS NULL AND is_admin = TRUE
            LIMIT 1
        """)
        admin_row = cur.fetchone()
        if admin_row:
            cur.execute("""
                UPDATE users SET twitch_user_id = %s, display_name = %s, avatar_url = %s
                WHERE id = %s RETURNING id, is_admin, is_approved
            """, (twitch_id, info["display_name"], info.get("avatar_url"),
                  admin_row["id"]))
            user = dict(cur.fetchone())
            conn.commit()
            return user

        # 3. Neuer User
        cur.execute("""
            INSERT INTO users (twitch_user_id, display_name, avatar_url,
                               is_admin, is_approved)
            VALUES (%s, %s, %s, FALSE, FALSE)
            RETURNING id, is_admin, is_approved
        """, (twitch_id, info["display_name"], info.get("avatar_url")))
        u = cur.fetchone()
    conn.commit()
    return dict(u)
