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
    from app import status_overview as so
    conn = _get_conn()
    error = None
    tenants, system = [], {}
    try:
        tenants = so.tenant_overview(conn)
        system = so.system_overview(conn)
    except Exception as e:
        error = str(e)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    status = so.poller_status()
    tenants = so.merge_status(tenants, status)
    return render_template("admin_dashboard.html", user=g.user,
                           tenants=tenants, system=system, error=error,
                           poller_reachable=status["reachable"],
                           last_poll_ago=so.ago((status["pubg"] or {}).get("lastPollAt")))


@bp_admin.route("/admin/users")
@require_admin
def admin_users():
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT u.id, u.twitch_user_id, u.display_name, u.avatar_url,
                       u.is_admin, u.is_approved, u.created_at,
                       t.slug AS tenant_slug, t.id AS tenant_id
                FROM users u
                LEFT JOIN tenants t ON t.owner_user_id = u.id
                ORDER BY u.created_at DESC
            """)
            users = [dict(r) for r in cur.fetchall()]
        from core import features
        on = features.all_enabled(conn)
        for u in users:
            u["features"] = on.get(u["tenant_id"], sorted(features.DEFAULT_ON))
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    from core import features
    return render_template("admin_users.html", user=g.user, users=users,
                           feature_catalog=features.FEATURES)


@bp_admin.route("/admin/tenants/<int:tenant_id>/features", methods=["POST"])
@require_admin
def admin_tenant_features(tenant_id: int):
    """Extras eines Tenants freischalten: Formularfeld `feature` (mehrfach), Rest aus."""
    from core import features
    conn = _get_conn()
    try:
        features.set_enabled(conn, tenant_id, request.form.getlist("feature"))
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return redirect("/admin/users")


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
    from webcore.serving import inject_theme, inject_impersonation_banner
    from pubg.db_pg import get_setting
    conn2 = _get_conn()
    try:
        theme = get_setting(conn2, g.tenant_id, "theme", "entry") or "entry"
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn2.close()
    html = inject_theme(html, theme)
    # Diese Editoren SCHREIBEN Daten — in einer Fremdsicht ist der Hinweis
    # noch wichtiger als in den lesenden Tools.
    html = inject_impersonation_banner(
        html, getattr(g, "tenant_impersonating", None), request.full_path)
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
    from webcore.serving import inject_theme, inject_impersonation_banner
    from pubg.db_pg import get_setting
    conn2 = _get_conn()
    try:
        theme = get_setting(conn2, g.tenant_id, "theme", "entry") or "entry"
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn2.close()
    html = inject_theme(html, theme)
    # Diese Editoren SCHREIBEN Daten — in einer Fremdsicht ist der Hinweis
    # noch wichtiger als in den lesenden Tools.
    html = inject_impersonation_banner(
        html, getattr(g, "tenant_impersonating", None), request.full_path)
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


# ---- Sketchfab-Notizen: Modell-Links + Notiz, wofür sie gedacht sind (app/sketchfab_notes.py) ----
def _project_root():
    return current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))


@bp_admin.route("/admin/sketchfab", methods=["GET", "POST"])
@require_admin
def admin_sketchfab():
    from app import sketchfab_notes as sn
    root, error, form = _project_root(), None, {}
    if request.method == "POST":
        _, error = sn.add(root, request.form.get("urls", ""), request.form.get("note", ""))
        if not error:
            return redirect("/admin/sketchfab")
        form = {"urls": request.form.get("urls", ""), "note": request.form.get("note", "")}
    items = sn.load(root)
    return render_template("admin_sketchfab.html", user=g.user, items=items, error=error, form=form,
                           open_count=sum(1 for e in items if not e.get("done")))


@bp_admin.route("/admin/sketchfab/<entry_id>", methods=["POST"])
@require_admin
def admin_sketchfab_edit(entry_id):
    from app import sketchfab_notes as sn
    root, act = _project_root(), request.form.get("action")
    if act == "delete":
        sn.delete(root, entry_id)
    elif act in ("done", "reopen"):
        sn.update(root, entry_id, done=act == "done")
    else:
        sn.update(root, entry_id, urls_text=request.form.get("urls"), note=request.form.get("note"))
    return redirect("/admin/sketchfab#e-" + entry_id)


@bp_admin.route("/admin/tree-picker")
@require_admin
def admin_tree_picker():
    """Auswahlseite für die Baum-Modelle der Strecken (tools/tree-picker.html): alle Bäume in 3D, Haken „Keep“."""
    src = os.path.join(_project_root(), "tools", "tree-picker.html")
    if not os.path.exists(src):
        abort(404)
    with open(src, encoding="utf-8") as f:
        return f.read(), 200, {"Content-Type": "text/html; charset=utf-8"}


@bp_admin.route("/admin/api/track-props", methods=["GET", "POST"])
def admin_track_props():
    """GET: voller Katalog inkl. ausgeworfener Modelle (Feld off). POST {key, off}: auswerfen/zurückholen."""
    err, status = _admin_json_guard()
    if err:
        return err, status
    from fx import track_props
    root = _project_root()
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        key = body.get("key")
        if not isinstance(key, str) or not track_props.set_off(root, key, bool(body.get("off"))):
            return jsonify({"ok": False, "error": "unknown model"}), 400
        return jsonify({"ok": True})
    return jsonify(track_props.catalog(root, include_off=True))


@bp_admin.route("/admin/prop-search")
@require_admin
def admin_prop_search():
    """Auswahlseite für neue Kulissen-Modelle (tools/prop-search.html): Such-Treffer mit Vorschaubild, Haken „Want“."""
    src = os.path.join(_project_root(), "tools", "prop-search.html")
    if not os.path.exists(src):
        abort(404)
    with open(src, encoding="utf-8") as f:
        return f.read(), 200, {"Content-Type": "text/html; charset=utf-8"}


@bp_admin.route("/admin/api/prop-search", methods=["GET", "POST"])
def admin_prop_search_api():
    """GET: Kandidaten (assets/track-props/search-*.json) + angehakte uids. POST {uid, on}: Haken setzen."""
    err, status = _admin_json_guard()
    if err:
        return err, status
    import glob
    import json
    from fx import track_props
    root = _project_root()
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        if not track_props.set_pick(root, body.get("uid"), bool(body.get("on"))):
            return jsonify({"ok": False, "error": "invalid uid"}), 400
        return jsonify({"ok": True})
    items = []
    for fn in sorted(glob.glob(os.path.join(root, "assets", "track-props", "search-*.json"))):
        try:
            with open(fn, encoding="utf-8") as f:
                items += [x for x in json.load(f) if isinstance(x, dict)]
        except (OSError, ValueError):
            pass
    return jsonify({"items": items, "picks": sorted(track_props.picks(root))})


@bp_admin.route("/admin/car-list")
@require_admin
def admin_car_list():
    """Abwahl-Liste der Autos (tools/car-list.html): Haken „In races“ = vehicles[key].race.on."""
    src = os.path.join(_project_root(), "tools", "car-list.html")
    if not os.path.exists(src):
        abort(404)
    with open(src, encoding="utf-8") as f:
        return f.read(), 200, {"Content-Type": "text/html; charset=utf-8"}
