"""Flask Middleware: Tenant-Resolution + Auth-Decorators.

before_request laeuft fuer jeden Request und setzt flask.g:
- g.tenant_id (aus URL-Token oder User-Session)
- g.user (dict mit id, is_admin, is_approved, ...) wenn eingeloggt

Decorators erzwingen Auth-State auf einzelnen Routes:
- require_session: redirected zu /app/login wenn nicht eingeloggt
- require_admin: 403 wenn nicht is_admin
- require_approved: redirected zu /app/pending wenn is_approved=FALSE
"""
import re
from functools import wraps
from flask import g, request, redirect, abort, current_app

from webcore.config import Config
from webcore import sessions
from core import db as core_db


# Exakte Pfade, fuer die kein Session-Lookup gemacht wird.
PUBLIC_EXACT = ("/", "/healthz", "/app/login", "/app/oauth/callback")
# Prefixe (mit trailing-slash) — alle darunter gelten als public.
PUBLIC_PREFIXES = ("/widgets-static/", "/static/")

_TOKEN_RE = re.compile(r"^/s/([A-Za-z0-9_]+)/")


def _get_conn():
    factory = current_app.config.get("_PG_CONN_FACTORY")
    if factory:
        return factory()
    return core_db.connect()


def register_middleware(app):
    @app.before_request
    def resolve_context():
        g.tenant_id = None
        g.user = None
        path = request.path

        # 1. URL-Token-Pfad?
        m = _TOKEN_RE.match(path)
        if m:
            token = m.group(1)
            conn = _get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT tenant_id FROM widget_tokens
                        WHERE token = %s AND revoked_at IS NULL
                    """, (token,))
                    row = cur.fetchone()
                if row is None:
                    abort(404, description="Unknown widget token")
                g.tenant_id = row["tenant_id"]
            finally:
                if "_PG_CONN_FACTORY" not in current_app.config:
                    conn.close()
            return

        # 2. Public? Exakte Matches und prefix-Matches getrennt — sonst
        # haetten alle Pfade durch startswith("/") gematched.
        if path in PUBLIC_EXACT or any(path.startswith(p) for p in PUBLIC_PREFIXES):
            # Auf Public-Pfaden trotzdem User aus Session lesen (fuer Landing
            # die User-Status anzeigt). Nur keinen Redirect-Zwang.
            sid = request.cookies.get(Config.OBSKIT_SID_COOKIE)
            if sid:
                _maybe_set_user_from_session(sid)
            return

        # 3. Session-Cookie auf geschützten Pfaden
        sid = request.cookies.get(Config.OBSKIT_SID_COOKIE)
        if not sid:
            return  # Decorators handle the redirect
        _maybe_set_user_from_session(sid)


def _maybe_set_user_from_session(sid: str) -> None:
    """Liest session + user aus DB und setzt g.user/g.tenant_id falls valide.
    Admin-Impersonation: ?asTenant=<id> ueberschreibt g.tenant_id auf den
    gewuenschten Tenant (nur fuer is_admin User). g.tenant_impersonating
    enthaelt dann {id, slug, display_name} fuer UI-Banner."""
    g.tenant_impersonating = None
    conn = _get_conn()
    try:
        row = sessions.lookup(conn, sid)
        if row is None:
            return
        with conn.cursor() as cur:
            cur.execute("""
                SELECT u.id, u.twitch_user_id, u.display_name, u.is_admin,
                       u.is_approved, u.avatar_url,
                       t.id AS tenant_id
                FROM users u
                LEFT JOIN tenants t ON t.owner_user_id = u.id
                WHERE u.id = %s
            """, (row["user_id"],))
            user = cur.fetchone()
        if user:
            g.user = dict(user)
            g.tenant_id = user["tenant_id"]
            sessions.touch(conn, sid)
            # Admin-Impersonation via ?asTenant=<id-or-slug>
            if user["is_admin"]:
                as_t = (request.args.get("asTenant") or "").strip()
                if as_t:
                    # Akzeptiert sowohl numerische ID als auch Slug.
                    as_tid = None
                    if as_t.isdigit():
                        as_tid = int(as_t)
                    with conn.cursor() as cur:
                        if as_tid is not None:
                            cur.execute("""
                                SELECT t.id, t.slug, u2.display_name
                                FROM tenants t
                                LEFT JOIN users u2 ON u2.id = t.owner_user_id
                                WHERE t.id = %s
                            """, (as_tid,))
                        else:
                            cur.execute("""
                                SELECT t.id, t.slug, u2.display_name
                                FROM tenants t
                                LEFT JOIN users u2 ON u2.id = t.owner_user_id
                                WHERE t.slug = %s
                            """, (as_t,))
                        t_row = cur.fetchone()
                    if t_row and t_row["id"] != user["tenant_id"]:
                        g.tenant_id = t_row["id"]
                        g.tenant_impersonating = {
                            "id": t_row["id"],
                            "slug": t_row["slug"],
                            "display_name": t_row["display_name"]
                                              or t_row["slug"],
                        }
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()


def require_session(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return redirect(current_app.config.get("LOGIN_URL", "/app/login"))
        if not g.user["is_approved"]:
            return redirect(current_app.config.get("PENDING_URL", "/app/pending"))
        return view(*args, **kwargs)
    return wrapper


def require_admin(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return redirect(current_app.config.get("LOGIN_URL", "/app/login"))
        if not g.user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)
    return wrapper


def require_approved(view):
    """Erlaubt is_approved=FALSE nur auf /app/pending und /app/logout."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return redirect(current_app.config.get("LOGIN_URL", "/app/login"))
        if not g.user["is_approved"]:
            return redirect(current_app.config.get("PENDING_URL", "/app/pending"))
        return view(*args, **kwargs)
    return wrapper
