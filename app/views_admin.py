"""Admin-Routes: User-Approval, Tenant-Erstellung beim Freigeben."""
import os
import re
import secrets
from flask import (
    Blueprint, redirect, request, render_template, g, current_app, abort
)

from app.middleware import require_admin, _get_conn
from app import sessions as srv_sessions


bp_admin = Blueprint("admin", __name__)


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "user"
    return base[:30]


def _gen_token() -> str:
    return "tok_" + secrets.token_hex(16)


def _unique_slug(conn, base: str) -> str:
    candidate = base
    n = 0
    while True:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM tenants WHERE slug = %s", (candidate,))
            if cur.fetchone() is None:
                return candidate
        n += 1
        candidate = f"{base}-{n}"


@bp_admin.route("/admin/")
@require_admin
def admin_home():
    return render_template("admin_dashboard.html", user=g.user)


@bp_admin.route("/admin/users")
@require_admin
def admin_users():
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT u.id, u.twitch_user_id, u.display_name, u.avatar_url,
                       u.is_admin, u.is_approved, u.created_at,
                       t.slug AS tenant_slug
                FROM users u
                LEFT JOIN tenants t ON t.owner_user_id = u.id
                ORDER BY u.created_at DESC
            """)
            users = [dict(r) for r in cur.fetchall()]
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return render_template("admin_users.html", user=g.user, users=users)


@bp_admin.route("/admin/users/<int:user_id>/approve", methods=["POST"])
@require_admin
def admin_approve(user_id: int):
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE users SET is_approved = TRUE
                WHERE id = %s RETURNING display_name
            """, (user_id,))
            row = cur.fetchone()
            if row is None:
                return redirect("/admin/users")
            slug = _unique_slug(conn, _slugify(row["display_name"]))
            cur.execute("""
                INSERT INTO tenants (owner_user_id, slug, display_name)
                VALUES (%s, %s, %s) RETURNING id
            """, (user_id, slug, row["display_name"]))
            tid = cur.fetchone()["id"]
            cur.execute(
                "INSERT INTO tenant_credentials (tenant_id) VALUES (%s)", (tid,)
            )
            cur.execute("""
                INSERT INTO widget_tokens (token, tenant_id, label)
                VALUES (%s, %s, 'Default')
            """, (_gen_token(), tid))
        conn.commit()
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return redirect("/admin/users")


@bp_admin.route("/admin/users/<int:user_id>/deny", methods=["POST"])
@require_admin
def admin_deny(user_id: int):
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET is_approved = FALSE WHERE id = %s",
                        (user_id,))
        conn.commit()
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return redirect("/admin/users")


@bp_admin.route("/admin/users/<int:user_id>/suspend", methods=["POST"])
@require_admin
def admin_suspend(user_id: int):
    """Setzt is_approved=FALSE + revoked alle Sessions."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET is_approved = FALSE WHERE id = %s",
                        (user_id,))
        srv_sessions.revoke_all_for_user(conn, user_id)
        conn.commit()
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return redirect("/admin/users")


@bp_admin.route("/admin/poi-editor")
@require_admin
def admin_poi_editor():
    """Serviert den PUBG POI-Editor admin-only. POIs sind global
    (eine Map-Definition fuer alle Tenants), daher gehoert die
    Bearbeitung in den Admin-Bereich."""
    root = current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    src = os.path.join(root, "widgets", "pubg", "poi-editor.html")
    if not os.path.exists(src):
        abort(404)
    with open(src, "r", encoding="utf-8") as f:
        html = f.read()
    # Relative Asset-Pfade (_pubg.css, _pubg.js, _pubg_pois.js) auf
    # absolute /widgets-static/pubg/ umschreiben — analog tools_open().
    for asset in ("_pubg.css", "_pubg.js", "_pubg_pois.js"):
        html = html.replace(
            f'href="{asset}"',
            f'href="/widgets-static/pubg/{asset}"')
        html = html.replace(
            f'src="{asset}"',
            f'src="/widgets-static/pubg/{asset}"')
    inject = (
        '<script>\n'
        'window.__SERVE_BASE__ = "/";\n'
        'window.__STATIC_BASE__ = "/widgets-static/";\n'
        '</script>'
    )
    if "</head>" in html:
        html = html.replace("</head>", inject + "\n</head>", 1)
    else:
        html = inject + "\n" + html
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}
