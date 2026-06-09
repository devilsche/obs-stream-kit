"""Admin-Routes: User-Approval, Tenant-Erstellung beim Freigeben."""
import os
import re
import secrets
from flask import (
    Blueprint, redirect, request, render_template, g, current_app, abort,
    jsonify, send_from_directory
)

from webcore.middleware import require_admin, _get_conn
from webcore import sessions as srv_sessions


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
    conn = _get_conn()
    stats = {}
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) AS c FROM tenants")
            stats["tenants"] = cur.fetchone()["c"]
            cur.execute("SELECT count(*) AS c FROM users WHERE is_approved")
            stats["users_approved"] = cur.fetchone()["c"]
            cur.execute("SELECT count(*) AS c FROM users WHERE NOT is_approved")
            stats["users_pending"] = cur.fetchone()["c"]
            cur.execute("SELECT count(*) AS c FROM matches")
            stats["matches"] = cur.fetchone()["c"]
            cur.execute("SELECT count(*) AS c FROM telemetry_events")
            stats["telemetry_events"] = cur.fetchone()["c"]
            cur.execute("SELECT count(*) AS c FROM players")
            stats["players"] = cur.fetchone()["c"]
            cur.execute("SELECT pg_size_pretty(pg_database_size(current_database())) AS s")
            stats["db_size"] = cur.fetchone()["s"]
            # Steam achievements
            try:
                cur.execute("SELECT count(*) AS c FROM steam_achievement_states")
                stats["steam_achievements"] = cur.fetchone()["c"]
            except Exception:
                stats["steam_achievements"] = "—"
    except Exception as e:
        stats["error"] = str(e)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()

    # Poller-Status
    from app.poller_startup import _pubg_poller, _steam_poller
    pubg_status = _pubg_poller.status() if _pubg_poller and hasattr(_pubg_poller, "status") else {}
    steam_status = _steam_poller.status_all() if _steam_poller and hasattr(_steam_poller, "status_all") else {}

    return render_template("admin_dashboard.html", user=g.user,
                           stats=stats, pubg_status=pubg_status,
                           steam_status=steam_status)


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
            # Tenant nur anlegen wenn noch keiner existiert (Schutz vor Doppel-Approve)
            cur.execute(
                "SELECT id FROM tenants WHERE owner_user_id = %s", (user_id,)
            )
            existing = cur.fetchone()
            if existing is None:
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
    src = os.path.join(root, "tools", "poi-editor.html")
    if not os.path.exists(src):
        abort(404)
    with open(src, "r", encoding="utf-8") as f:
        html = f.read()
    for asset in ("_pubg.css", "_pubg.js", "_pubg_pois.js"):
        html = html.replace(f'href="{asset}"', f'href="/widgets-static/pubg/{asset}"')
        html = html.replace(f'src="{asset}"',  f'src="/widgets-static/pubg/{asset}"')
    for asset in ("_theme.css", "_blocks.css"):
        for prefix in ("../", ""):
            html = html.replace(f'href="{prefix}{asset}"', f'href="/widgets-static/{asset}"')
    from webcore.serving import inject_theme
    from pubg.db_pg import get_setting
    conn2 = _get_conn()
    try:
        theme = get_setting(conn2, g.tenant_id, "theme", "entry") or "entry"
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn2.close()
    html = inject_theme(html, theme)
    inject = (
        '<script>\n'
        'window.__SERVE_BASE__ = "/";\n'
        'window.__STATIC_BASE__ = "/widgets-static/";\n'
        '</script>'
    )
    html = html.replace("</head>", inject + "\n</head>", 1)
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


# ── Icon Crop Editor ──────────────────────────────────────────────────────────

@bp_admin.route("/admin/icon-crop")
@require_admin
def admin_icon_crop():
    root = current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    src = os.path.join(root, "tools", "icon-crop-editor.html")
    if not os.path.exists(src):
        abort(404)
    with open(src, "r", encoding="utf-8") as f:
        html = f.read()
    for asset in ("_theme.css", "_blocks.css"):
        html = html.replace(f'href="{asset}"', f'href="/widgets-static/{asset}"')
    for asset in ("_pubg.css", "_pubg.js"):
        html = html.replace(f'href="{asset}"', f'href="/widgets-static/pubg/{asset}"')
        html = html.replace(f'src="{asset}"', f'src="/widgets-static/pubg/{asset}"')
    from webcore.serving import inject_theme
    from pubg.db_pg import get_setting
    conn2 = _get_conn()
    try:
        theme = get_setting(conn2, g.tenant_id, "theme", "entry") or "entry"
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn2.close()
    html = inject_theme(html, theme)
    inject = '<script>\nwindow.__SERVE_BASE__ = "/";\n</script>'
    html = html.replace("</head>", inject + "\n</head>", 1)
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


def _admin_json_guard():
    """Gibt (None, None) wenn Admin — sonst (response, status) als JSON-Fehler."""
    if g.user is None:
        return jsonify({"error": "unauthenticated"}), 401
    if not g.user.get("is_admin"):
        return jsonify({"error": "forbidden"}), 403
    return None, None


@bp_admin.route("/admin/icon-crop/save", methods=["POST"])
def admin_icon_crop_save():
    try:
        return _admin_icon_crop_save_impl()
    except Exception as e:
        import traceback
        current_app.logger.error("icon-crop-save failed: %s\n%s", e, traceback.format_exc())
        return jsonify({"error": str(e)}), 500


def _admin_icon_crop_save_impl():
    err, status = _admin_json_guard()
    if err:
        return err, status
    import io
    from PIL import Image, ImageDraw
    name = request.form.get("name", "").strip()
    if not name or not re.match(r"^[a-zA-Z0-9_\-]+$", name):
        return jsonify({"error": "Ungültiger Dateiname"}), 400
    circular = request.form.get("circular", "0") == "1"
    f = request.files.get("image")
    if not f:
        return jsonify({"error": "Kein Bild übermittelt"}), 400
    try:
        img = Image.open(io.BytesIO(f.read())).convert("RGBA")
    except Exception:
        return jsonify({"error": "Ungültiges Bildformat"}), 400
    if circular:
        # Kreismaske: weicher Rand via Anti-Aliasing (4x oversample)
        sz = img.size[0]
        big = sz * 4
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
        mask = mask.resize((sz, sz), Image.LANCZOS)
        img.putalpha(mask)
    root = current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "widgets", "pubg", "assets", "achievements")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, name + ".png")
    img.save(out_path, "PNG", optimize=True)
    return jsonify({"path": f"/widgets-static/pubg/assets/achievements/{name}.png"})


@bp_admin.route("/admin/icon-crop/list")
def admin_icon_crop_list():
    err, status = _admin_json_guard()
    if err:
        return err, status
    root = current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    # Alle PUBG_ICON_URLS keys + tatsächliche Dateien in icons/ und achievements/
    from pubg.endpoints import EndpointRegistry
    all_icon_urls = EndpointRegistry.PUBG_ICON_URLS
    icons = []
    seen = set()
    for key, url in sorted(all_icon_urls.items()):
        if url:
            icons.append({"name": key, "url": url, "has_file": True})
            seen.add(key)
    # Zusätzliche Dateien in achievements/ die noch nicht in PUBG_ICON_URLS
    ach_dir = os.path.join(root, "widgets", "pubg", "assets", "achievements")
    if os.path.exists(ach_dir):
        for fn in sorted(os.listdir(ach_dir)):
            if fn.endswith(".png") and fn != "carstuff.png":
                n = fn[:-4]
                if n not in seen:
                    icons.append({"name": n,
                                  "url": f"/widgets-static/pubg/assets/achievements/{fn}",
                                  "has_file": True})
    return jsonify({"icons": icons})
