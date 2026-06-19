"""Streamer-Routes."""
import os

from flask import (
    Blueprint, render_template, g, jsonify, request, redirect, current_app,
    abort, send_from_directory,
)

from webcore.middleware import require_session, _get_conn
from core import credentials as core_creds


TOOLS = [
    {"key": "session-report",
     "label": "Session Report",
     "desc": "Detailed report of a session: matches, kills, achievements, map play.",
     "path": "widgets/pubg/session-report.html",
     "admin_only": False},
    {"key": "match-replay",
     "label": "Match Replay",
     "desc": "Time-lapse replay of a single match — landings, fights, kills, circle.",
     "path": "tools/match-replay.html",
     "admin_only": False},
    {"key": "landing-spots",
     "label": "Landing Spots",
     "desc": "Heatmap of where you and your mates land across all matches.",
     "path": "tools/landing-spots.html",
     "admin_only": False},
    {"key": "achievement-browser",
     "label": "Achievement Browser",
     "desc": "Full-screen browser through all Steam + PUBG achievements. Click a tile to re-trigger the popup.",
     "path": "tools/achievement-browser.html",
     "admin_only": False},
    {"key": "theme-preview",
     "label": "Theme-Vorschau",
     "desc": "Vorschau der Mittelalter-Themes auf Beispiel-Komponenten — Farben, Schrift, Form, Ornamente.",
     "path": "tools/theme-preview.html",
     "admin_only": True},
    {"key": "ornament-preview",
     "label": "Ornament-Vorschau",
     "desc": "Ornament-Rahmen (als Overlay), Textur + Background pro Theme auf verschiedenen Widget-Größen — Design-Basis.",
     "path": "tools/ornament-preview.html",
     "admin_only": True},
    {"key": "component-preview",
     "label": "Komponenten-Vorschau",
     "desc": "Lebender Katalog aller t-*-Bausteine in jedem Theme — Referenz + Abnahme.",
     "path": "tools/component-preview.html",
     "admin_only": True},
]


bp_app = Blueprint("app_streamer", __name__)


@bp_app.route("/")
def landing():
    if g.user:
        return redirect("/app/")
    return render_template("landing.html")


@bp_app.route("/app/")
@require_session
def dashboard():
    conn = _get_conn()
    admin_stats = None
    try:
        creds = core_creds.get(conn, g.tenant_id)
        # Source-Counts fuer den Cockpit-Schnellzugriff
        from app import widget_catalog
        from overlay_app.overlay_catalog import OVERLAYS
        root = current_app.config.get("_PROJECT_ROOT", ".")
        try:
            widgets_count = len(widget_catalog.get(root))
        except Exception:
            widgets_count = 0
        overlays_count = len(OVERLAYS)
        # All-tenants-Kachel (admin-only): robuste Standard-Queries
        if g.user.get("is_admin"):
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT count(*) AS c FROM tenants")
                    tenants = cur.fetchone()["c"]
                    cur.execute("SELECT pg_size_pretty(pg_database_size(current_database())) AS s")
                    db_size = cur.fetchone()["s"]
                admin_stats = {"tenants": tenants, "db_size": db_size}
            except Exception:
                admin_stats = None
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    cred_status = {
        "pubg_ready": bool(creds.pubg_name and creds.pubg_api_key),
        "steam_ready": bool(creds.steam_id and creds.steam_api_key),
        "any_missing": not (creds.pubg_name and creds.pubg_api_key
                            and creds.steam_id and creds.steam_api_key),
    }
    return render_template("dashboard.html", user=g.user, cred_status=cred_status,
                           widgets_count=widgets_count, overlays_count=overlays_count,
                           admin_stats=admin_stats)


@bp_app.route("/app/pending")
def pending():
    if g.user is None:
        return redirect("/app/login")
    if g.user["is_approved"]:
        return redirect("/app/")
    return render_template("login_pending.html", user=g.user)


@bp_app.route("/app/pending-check")
def pending_check():
    if g.user is None:
        return jsonify({"approved": False})
    return jsonify({"approved": bool(g.user["is_approved"])})


@bp_app.route("/app/settings", methods=["GET", "POST"])
@require_session
def settings():
    conn = _get_conn()
    from pubg.db_pg import get_setting, set_setting
    try:
        if request.method == "POST":
            pubg_name = request.form.get("pubg_name") or None
            pubg_platform = request.form.get("pubg_platform") or None
            pubg_api_key = request.form.get("pubg_api_key") or None
            steam_id = request.form.get("steam_id") or None
            steam_api_key = request.form.get("steam_api_key") or None
            if pubg_name or pubg_platform or pubg_api_key:
                core_creds.set_pubg(
                    conn, g.tenant_id,
                    name=pubg_name, platform=pubg_platform, api_key=pubg_api_key
                )
            if steam_id or steam_api_key:
                core_creds.set_steam(
                    conn, g.tenant_id,
                    steam_id=steam_id, api_key=steam_api_key
                )
            # Defaults (Widget-Range + Sprache) — speichern wenn explizit gesetzt
            default_range = request.form.get("default_range")
            if default_range in ("session", "week", "all"):
                set_setting(conn, g.tenant_id, "ui.default_range", default_range)
            lang = request.form.get("lang")
            if lang in ("de", "en"):
                set_setting(conn, g.tenant_id, "ui.lang", lang)
            # Theme (gilt fuers ganze Konto; Whitelist analog ALLOWED_THEMES)
            theme = request.form.get("theme")
            if theme in ("entry", "terminal", "aurora", "midnight",
                         "editorial", "swiss", "azure",
                         "oldcamp", "barrier", "sect"):
                set_setting(conn, g.tenant_id, "theme", theme)
            # Stinger-Font (Whitelist; "" = Theme-Default)
            sfont = request.form.get("stinger_font", "")
            if sfont in ("", "Orbitron", "Russo One", "Black Ops One", "Audiowide",
                         "Teko", "Saira Stencil One", "Wallpoet", "Bungee",
                         "Chakra Petch", "Oxanium", "Rajdhani", "Syncopate",
                         "Metamorphous", "MedievalSharp", "Cinzel Decorative"):
                set_setting(conn, g.tenant_id, "stinger_font", sfont)
            # Highlight-Quelle für die Szenen-Overlays (Clips vs Steam-Media)
            hsrc = request.form.get("highlight_source")
            if hsrc in ("clips", "steam_media"):
                set_setting(conn, g.tenant_id, "highlight_source", hsrc)
            return redirect("/app/settings?saved=1")
        creds = core_creds.get(conn, g.tenant_id)
        prefs = {
            "default_range": get_setting(conn, g.tenant_id, "ui.default_range",
                                          default="session"),
            "lang": get_setting(conn, g.tenant_id, "ui.lang", default="de"),
            "theme": get_setting(conn, g.tenant_id, "theme", default="entry"),
            "stinger_font": get_setting(conn, g.tenant_id, "stinger_font", default=""),
            "highlight_source": get_setting(conn, g.tenant_id, "highlight_source",
                                            default="clips"),
        }
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    # Token für API-URL-Anzeige
    try:
        with _get_conn() as tc:
            with tc.cursor() as cur:
                cur.execute(
                    "SELECT token FROM widget_tokens WHERE tenant_id=%s AND revoked_at IS NULL ORDER BY created_at LIMIT 1",
                    (g.tenant_id,))
                row = cur.fetchone()
                api_token = row["token"] if row else None
    except Exception:
        api_token = None

    base_url = request.url_root.rstrip("/")
    return render_template("settings.html",
                           user=g.user, creds=creds, prefs=prefs,
                           saved=request.args.get("saved"),
                           api_token=api_token, base_url=base_url)


@bp_app.route("/app/api-docs")
@require_session
def api_docs():
    from overlay_app.overlay_catalog import ALERTS
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT token FROM widget_tokens WHERE tenant_id=%s AND revoked_at IS NULL ORDER BY created_at LIMIT 1",
                (g.tenant_id,))
            row = cur.fetchone()
            token = row["token"] if row else None
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return render_template("api_docs.html",
                           user=g.user, token=token,
                           base_url=request.url_root.rstrip("/"),
                           alerts=ALERTS)


@bp_app.route("/app/assets/pet-image", methods=["POST"])
@require_session
def upload_pet_image():
    """Nimmt ein Bild-Upload, prüft Qualität, konvertiert zu WebP, speichert tenant-spezifisch."""
    import hashlib, io
    from PIL import Image

    f = request.files.get("image")
    if not f:
        return jsonify({"error": "Kein Bild übermittelt"}), 400

    data = f.read(20 * 1024 * 1024 + 1)  # max 20 MB lesen
    if len(data) > 20 * 1024 * 1024:
        return jsonify({"error": "Bild zu groß — max. 20 MB"}), 400

    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data))  # nach verify() neu öffnen
    except Exception:
        return jsonify({"error": "Ungültiges Bildformat"}), 400

    w, h = img.size
    min_dim = min(w, h)
    if min_dim < 300:
        return jsonify({
            "error": f"Auflösung zu niedrig ({w}×{h}px) — mindestens 300×300 px benötigt"
        }), 400

    # Auf Quadrat zentriert zuschneiden
    left   = (w - min_dim) // 2
    top    = (h - min_dim) // 2
    img    = img.crop((left, top, left + min_dim, top + min_dim))
    img    = img.resize((600, 600), Image.LANCZOS)
    img    = img.convert("RGB")

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=88, method=4)
    webp_bytes = buf.getvalue()

    # Speichern unter data/pet-images/<tenant_id>_<hash>.webp
    # Alte Bilder desselben Tenants vorher löschen (nur neuestes behalten).
    root     = current_app.config.get("_PROJECT_ROOT", ".")
    out_dir  = os.path.join(root, "data", "pet-images")
    os.makedirs(out_dir, exist_ok=True)
    prefix = f"{g.tenant_id}_"
    for old in os.listdir(out_dir):
        if old.startswith(prefix) and old.endswith(".webp"):
            try:
                os.remove(os.path.join(out_dir, old))
            except OSError:
                pass
    fname    = f"{g.tenant_id}_{hashlib.sha256(webp_bytes).hexdigest()[:12]}.webp"
    out_path = os.path.join(out_dir, fname)
    with open(out_path, "wb") as fp:
        fp.write(webp_bytes)

    url = request.url_root.rstrip("/") + "/app/assets/pet-images/" + fname
    return jsonify({"url": url, "size": f"{w}×{h}px → 600×600 WebP"})


@bp_app.route("/app/assets/pet-images/<path:filename>")
@require_session
def serve_pet_image(filename):
    root    = current_app.config.get("_PROJECT_ROOT", ".")
    out_dir = os.path.join(root, "data", "pet-images")
    return send_from_directory(out_dir, filename)


@bp_app.route("/app/urls")
@require_session
def urls():
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT token, label FROM widget_tokens
                WHERE tenant_id = %s AND revoked_at IS NULL
                ORDER BY created_at
                LIMIT 1
            """, (g.tenant_id,))
            row = cur.fetchone()
            token = row["token"] if row else None
        creds = core_creds.get(conn, g.tenant_id)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    pubg_ready = bool(creds.pubg_name and creds.pubg_api_key)
    steam_ready = bool(creds.steam_id and creds.steam_api_key)

    # Widget switches come directly from each widget's `buildFilter([...])`
    # call in its HTML — single source of truth (see app/widget_catalog.py).
    from app import widget_catalog
    project_root = current_app.config.get("_PROJECT_ROOT", ".")
    widgets_list = widget_catalog.get(project_root)
    base_url = request.url_root.rstrip("/")
    # Alles laeuft unter einer Domain (stream-overlay.com) -> Overlay-URLs nutzen
    # dieselbe Basis. Overlay-Szenen kommen aus dem geteilten Katalog.
    from overlay_app.overlay_catalog import OVERLAYS, ALERTS, DECOR, TRANSITIONS, STINGER_META, EFFECT_META, list_dir_sources
    stingers = list_dir_sources(project_root, "stingers", desc="Stinger-Transition mit Meme-Effekt.",
                                switches_map=STINGER_META)
    effects  = list_dir_sources(project_root, "effects",  desc="Visual effect overlay.",
                                switches_map=EFFECT_META)
    transitions = TRANSITIONS
    return render_template("urls.html",
                           user=g.user, token=token,
                           pubg_ready=pubg_ready, steam_ready=steam_ready,
                           widgets=widgets_list, base_url=base_url,
                           overlays=OVERLAYS, overlay_base=base_url,
                           alerts=ALERTS, decor=DECOR,
                           stingers=stingers, effects=effects, transitions=transitions)


def _visible_tools():
    """Tools the current user is allowed to see."""
    return [t for t in TOOLS
            if not t["admin_only"] or g.user.get("is_admin")]


@bp_app.route("/app/tools")
@require_session
def tools_index():
    return render_template("tools.html", user=g.user, tools=_visible_tools())


@bp_app.route("/app/tools/<key>")
@require_session
def tools_open(key):
    tool = next((t for t in TOOLS if t["key"] == key), None)
    if tool is None:
        abort(404)
    if tool["admin_only"] and not g.user.get("is_admin"):
        abort(403)
    root = current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    full_path = os.path.normpath(os.path.join(root, tool["path"]))
    if not full_path.startswith(root) or not os.path.exists(full_path):
        abort(404)
    # Credentials-Gate: blocke das Tool wenn der Tenant keine API-Keys
    # fuer die noetige Domain hinterlegt hat.
    from webcore.creds_gate import (required_domains, missing_domains,
                                  render_block_page)
    needed = required_domains(tool["path"])
    if needed:
        conn = _get_conn()
        try:
            creds = core_creds.get(conn, g.tenant_id)
        finally:
            if "_PG_CONN_FACTORY" not in current_app.config:
                conn.close()
        missing = missing_domains(creds, needed)
        if missing:
            return (render_block_page(tool["path"], missing, "/app/"),
                    200, {"Content-Type": "text/html; charset=utf-8"})
    with open(full_path, "r", encoding="utf-8") as f:
        html = f.read()
    # Theme auf <html data-theme="..."> setzen — ohne das greifen
    # alle html[data-theme="X"]-Selektoren in _theme.css nicht.
    from webcore.serving import inject_theme
    from pubg.db_pg import get_setting
    conn2 = _get_conn()
    try:
        theme = get_setting(conn2, g.tenant_id, "theme", "entry") or "entry"
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn2.close()
    html = inject_theme(html, theme)
    # Bei Tools die als widgets/<domain>/*.html liegen (Alt-Bestand:
    # session-report, poi-editor) zeigen die relativen Asset-Pfade
    # (_pubg.css, _pubg.js, _pubg_pois.js) auf das gleiche Verzeichnis.
    # Unter /app/tools/<key> ist das geschluckt, deshalb rewriten auf
    # absolute /widgets-static/<domain>/...
    if tool["path"].startswith("widgets/"):
        domain = tool["path"].split("/")[1]
        # Domain-spezifische Assets
        for asset in ("_pubg.css", "_pubg.js", "_pubg_pois.js"):
            html = html.replace(
                f'href="{asset}"',
                f'href="/widgets-static/{domain}/{asset}"')
            html = html.replace(
                f'src="{asset}"',
                f'src="/widgets-static/{domain}/{asset}"')
        # Shared Assets direkt unter widgets/ — mit oder ohne ../-Prefix
        for asset in ("_theme.css", "_blocks.css"):
            for prefix in ("../", ""):
                html = html.replace(
                    f'href="{prefix}{asset}"',
                    f'href="/widgets-static/{asset}"')
                html = html.replace(
                    f'src="{prefix}{asset}"',
                    f'src="/widgets-static/{asset}"')
    # Tools laufen cookie-authenticated, kein Token — alle /api/-Calls
    # gehen direkt an die Cookie-Routes mit g.tenant_id aus der Session.
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
