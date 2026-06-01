"""Twitch OAuth-Flow + Admin-Claim.

Flask-Blueprint mit /app/login, /app/oauth/callback, /app/logout.
"""
import secrets
import urllib.parse
from flask import (
    Blueprint, redirect, request, session, abort, g, current_app, make_response
)

from webcore.config import Config
from webcore.twitch_client import exchange_code, get_user_info  # exposed for mock
from webcore import sessions as srv_sessions
from webcore.middleware import _get_conn


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

    conn = _get_conn()
    try:
        user = _lookup_or_create_user(conn, info)
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
