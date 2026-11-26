"""Streamer-Routes."""
import json
import os
import re
from urllib.parse import urlencode

from flask import (
    Blueprint, render_template, g, jsonify, request, redirect, current_app,
    abort, send_from_directory, send_file,
)

from webcore.middleware import require_admin, require_session, _get_conn
from core import credentials as core_creds


TOOLS = [
    {"key": "session-report",
     "label": "Session Report",
     "desc": "Detailed report of a session: matches, kills, achievements, map play.",
     "path": "widgets/pubg/session-report.html",
     "admin_only": False,
     "domain": "pubg"},
    {"key": "match-replay",
     "label": "Match Replay",
     "desc": "Time-lapse replay of a single match — landings, fights, kills, circle.",
     "path": "tools/match-replay.html",
     "admin_only": False,
     "domain": "pubg"},
    {"key": "weapon-performance",
     "label": "Weapon Performance",
     "desc": "Accuracy, hit zones and damage per weapon or player over session, day, week or all time.",
     "path": "tools/weapon-performance.html",
     "admin_only": False,
     "domain": "pubg"},
    {"key": "squad-playstyle",
     "label": "Squad Playstyle",
     "desc": "Who opens the fights, how they end, who hangs too far back and who goes down first.",
     "path": "tools/squad-playstyle.html",
     "admin_only": False,
     "domain": "pubg"},
    {"key": "shot-quality",
     "label": "Shot Quality",
     "desc": "How well each bullet lands, when and how you die, and where that puts you against the lobby.",
     "path": "tools/shot-quality.html",
     "admin_only": False,
     "domain": "pubg"},
    {"key": "match-analysis",
     "label": "Match Analysis",
     "desc": "Telemetry breakdown of one match: accuracy, hit zones, kill timeline and notable hit patterns.",
     "path": "tools/match-analysis.html",
     "admin_only": False,
     "domain": "pubg"},
    {"key": "landing-spots",
     "label": "Landing Spot Analyzer",
     "desc": "Where you and your mates land, and what came of it: heatmap plus per-spot verdict against the whole lobby.",
     "path": "tools/landing-spots.html",
     "admin_only": False,
     "domain": "pubg"},
    {"key": "milestones",
     "label": "Milestone Celebrations",
     "desc": "Which weapon and career milestones get celebrated, from which mark, and in which of the two overlay sources.",
     "path": "tools/milestones.html",
     "admin_only": False,
     "domain": "pubg"},
    {"key": "achievement-browser",
     "label": "Achievement Browser",
     "desc": "Full-screen browser through all Steam + PUBG achievements. Click a tile to re-trigger the popup.",
     "path": "tools/achievement-browser.html",
     "admin_only": False},
    {"key": "explosion-preview",
     "label": "Explosion preview",
     "desc": "Ready-made explosion, fire and smoke animations (CC0) side by side, fired by click, with WebGL extras – groundwork for the new Burst effect.",
     "path": "tools/explosion-preview.html",
     "admin_only": True},
    {"key": "logo-cut",
     "label": "Logo cut editor",
     "desc": "Cut the letters and stripes of the Logo 3D apart by hand: outlines over the image, drag points, add or merge parts. Saved cuts replace the automatic split.",
     "path": "tools/logo-cut.html",
     "admin_only": True},
    {"key": "duck-viewer",
     "label": "Rubber duck viewer",
     "desc": "The 3D rubber duck from the party rain, large and freely rotatable (drag, arrow keys, zoom).",
     "path": "tools/duck-viewer.html",
     "admin_only": True,
     "domain": "ducks"},
    {"key": "duck-gallery",
     "label": "Rubber duck outfits",
     "desc": "All rubber duck outfits side by side — heroes, horror, jobs, fun and celebrities — with their URL parameter.",
     "path": "tools/duck-gallery.html",
     "admin_only": True,
     "domain": "ducks"},
    {"key": "duck-editor",
     "label": "Rubber duck editor",
     "desc": "Rebuild any rubber duck outfit or make a new one: move, turn and resize hats and props, change colours. Saved outfits go live everywhere.",
     "path": "tools/duck-editor.html",
     "admin_only": True,
     "domain": "ducks"},
    {"key": "car-gallery",
     "label": "Model gallery",
     "desc": "Every 3D model on the server (cars, track scenery, candidates, notes): tick what to keep, delete the rest.",
     "path": "tools/car-gallery.html",
     "admin_only": True,
     "domain": "race"},
    {"key": "car-picker",
     "label": "Car picker",
     "desc": "Free car models from Sketchfab by brand: tick the ones to keep for the car rain.",
     "path": "tools/car-picker.html",
     "admin_only": True,
     "domain": "race"},
    {"key": "car-viewer",
     "label": "Car viewer",
     "desc": "One car model large on screen: turn, zoom, front/side/rear/top view.",
     "path": "tools/car-viewer.html",
     "admin_only": True,
     "domain": "race"},
    {"key": "car-editor",
     "label": "Toy car editor",
     "desc": "Build rims, pick rims and tyres per car, add and tune lips, wings, diffusers, skirts, flares and exhausts. Saved cars go live in the BMW rain.",
     "path": "tools/car-editor.html",
     "admin_only": True,
     "domain": "race"},
    {"key": "engine-sound-lab",
     "label": "Engine sound lab",
     "desc": "Listen to the engine sounds per engine type or car: RPM and throttle by hand, rev, accelerate, lift off, shift – and compare with the old loop sound.",
     "path": "tools/engine-sound-lab.html",
     "admin_only": True,
     "domain": "race"},
    {"key": "car-drive",
     "label": "Car Drive",
     "desc": "Drive the Car Race yourself: pick a car from the catalogue, a track, 0–7 AI opponents and 1–5 laps. Keyboard or gamepad, fullscreen.",
     "path": "tools/car-drive.html",
     "admin_only": True,
     "domain": "race"},
    {"key": "diag",
     "label": "G1R Diagnostics",
     "desc": "Upload the UE4SS log and crash dump from the gaming PC (no copying files by hand).",
     "path": "tools/g1r-diag.html",
     "admin_only": True,
     "domain": "g1r"},
    {"key": "g1r-database",
     "label": "G1R Database",
     "desc": "Complete item catalogue from the object dump — every weapon (melee and ranged), rune and scroll, searchable.",
     "path": "tools/g1r-database.html",
     "admin_only": True,
     "domain": "g1r"},
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
        # Status-Kachel: echter Poller-Zustand + Datenstand des Tenants
        from app import status_overview as so
        try:
            rows = so.tenant_overview(conn, g.tenant_id)
            my_status = so.merge_status(rows, so.poller_status())[0] if rows else None
        except Exception:
            my_status = None
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
        "pubg_key_only": bool(creds.pubg_api_key and not creds.pubg_name),
        "steam_ready": bool(creds.steam_id and creds.steam_api_key),
        "any_missing": not (creds.pubg_name and creds.pubg_api_key
                            and creds.steam_id and creds.steam_api_key),
    }
    return render_template("dashboard.html", user=g.user, cred_status=cred_status,
                           widgets_count=widgets_count, overlays_count=overlays_count,
                           admin_stats=admin_stats, my_status=my_status)


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
            pubg_api_key = (request.form.get("pubg_api_key") or "").strip() or None
            steam_id = request.form.get("steam_id") or None
            steam_api_key = (request.form.get("steam_api_key") or "").strip() or None
            # Keys vor dem Speichern pruefen — bei einem Fehler wird NICHTS
            # gespeichert, sonst ueberschreibt ein vertauschter Key den
            # gueltigen (Steam-Key im PUBG-Feld -> Poller 401).
            from core import key_check
            errs = {}
            if pubg_api_key:
                platform = pubg_platform or core_creds.get(
                    conn, g.tenant_id).pubg_platform or "steam"
                err = key_check.check("pubg", pubg_api_key, platform)
                if err:
                    errs["pubg_err"] = err
            if steam_api_key:
                err = key_check.check("steam", steam_api_key)
                if err:
                    errs["steam_err"] = err
            if errs:
                return redirect("/app/settings?" + urlencode(errs))
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
                         "oldcamp", "barrier", "sect", "graphite"):
                set_setting(conn, g.tenant_id, "theme", theme)
            # Stinger-Font (Whitelist; "" = Theme-Default)
            sfont = request.form.get("stinger_font", "")
            if sfont in ("", "Orbitron", "Russo One", "Black Ops One", "Audiowide",
                         "Teko", "Saira Stencil One", "Wallpoet", "Bungee",
                         "Chakra Petch", "Oxanium", "Rajdhani", "Syncopate",
                         "Metamorphous", "MedievalSharp", "Cinzel Decorative"):
                set_setting(conn, g.tenant_id, "stinger_font", sfont)
            # Gesamtlautstärke Memes/Effekte und Alerts (core/sound_levels.py)
            from core import sound_levels
            sound_levels.save(conn, g.tenant_id, {"memes": request.form.get("memes_volume"),
                                                  "alerts": request.form.get("alerts_volume")})
            # Highlight-Quelle für die Szenen-Overlays (Clips vs Steam-Media)
            hsrc = request.form.get("highlight_source")
            if hsrc in ("clips", "steam_media"):
                set_setting(conn, g.tenant_id, "highlight_source", hsrc)
            return redirect("/app/settings?saved=1")
        creds = core_creds.get(conn, g.tenant_id)
        # Bestandskonten haben nur den Einzel-Namen in den Credentials —
        # der wird beim ersten Aufruf zum primaeren Eintrag der Liste.
        from pubg.db_pg import backfill_tracked_players, list_tracked_players
        backfill_tracked_players(conn, g.tenant_id, creds.pubg_name,
                                 creds.pubg_platform, creds.pubg_account_id)
        tracked = list_tracked_players(conn, g.tenant_id)
        prefs = {
            "default_range": get_setting(conn, g.tenant_id, "ui.default_range",
                                          default="session"),
            "lang": get_setting(conn, g.tenant_id, "ui.lang", default="de"),
            "theme": get_setting(conn, g.tenant_id, "theme", default="entry"),
            "stinger_font": get_setting(conn, g.tenant_id, "stinger_font", default=""),
            "highlight_source": get_setting(conn, g.tenant_id, "highlight_source",
                                            default="clips"),
        }
        from core import sound_levels
        prefs["sound"] = sound_levels.load(conn, g.tenant_id)
        prefs["sound_steps"] = sound_levels.STEPS
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
    # Telemetrie-Archiv: nur die Anzeige-Felder, niemals das Passwort.
    from pubg.archive_config import parse_config, redacted
    archive = redacted(parse_config(creds.telemetry_archive))
    return render_template("settings.html",
                           user=g.user, creds=creds, prefs=prefs,
                           tracked=tracked,
                           saved=request.args.get("saved"),
                           archive=archive,
                           archive_msg=request.args.get("archive"),
                           pubg_err=request.args.get("pubg_err"),
                           steam_err=request.args.get("steam_err"),
                           api_token=api_token, base_url=base_url)


@bp_app.route("/app/api/weather/lookup")
@require_session
def weather_lookup():
    """Weather-Karte: welchen Ort der Server zu `place` findet und welches
    Wetter dort ist — nur fürs Dashboard, das Overlay bekommt das nie."""
    from fx import weather_api
    place = (request.args.get("place") or "").strip()[:60]
    if not place:
        return jsonify({"found": False})
    resp = jsonify(weather_api.lookup(place))
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp_app.route("/app/api/weather/theme")
@require_session
def weather_theme_now():
    """Weather-Karte: welches Deko-Thema die Source gerade zeigt — dieselbe
    Regel wie im Overlay (Kalender, Xmas-Zeit, Frühstart, aufgebauter Baum)."""
    import datetime
    from fx import weather_theme
    from fx.endpoints import _with_conn
    opts = {k: request.args.get(k) for k in ("xmasfrom", "xmasto")}
    today = datetime.date.today()

    def pick(conn):
        start, end, _ = weather_theme.xmas_window(today, opts["xmasfrom"], opts["xmasto"])
        set_up = weather_theme.is_set_up(conn, g.tenant_id, today, opts)
        return weather_theme.theme_for(today, request.args.get("theme") or "auto",
                                       start <= today <= end or set_up,
                                       early=weather_theme.load_early(conn, g.tenant_id), set_up=set_up,
                                       zone=weather_theme.load_zone(conn, g.tenant_id))
    resp = jsonify({"theme": _with_conn(pick)})
    resp.headers["Cache-Control"] = "no-store"
    return resp


# Follower-Import startet hier, weil nginx /app/* an diesen Dienst schickt;
# der Twitch-Callback läuft im API-Dienst (gemeinsame Session).
from webcore.auth import import_followers as _import_followers, import_subs as _import_subs  # noqa: E402
bp_app.add_url_rule("/app/twitch/import-followers", "twitch_import_followers", _import_followers)
bp_app.add_url_rule("/app/twitch/import-subs", "twitch_import_subs", _import_subs)


@bp_app.route("/app/settings/accounts", methods=["POST"])
@require_session
def settings_accounts():
    """Verfolgte PUBG-Accounts pflegen (add / remove / primary).

    Eigener Endpoint statt Teil des Settings-Formulars: HTML erlaubt keine
    verschachtelten Forms, und das Hinzufuegen eines Accounts soll nicht
    die uebrigen Einstellungen mitspeichern.
    """
    from pubg.db_pg import (add_tracked_player, list_tracked_players,
                            remove_tracked_player, set_primary_tracked_player)
    action = request.form.get("action")
    name = (request.form.get("name") or "").strip()
    if not name:
        return redirect("/app/settings")
    conn = _get_conn()
    try:
        creds = core_creds.get(conn, g.tenant_id)
        if action == "add":
            # Der erste Account wird primaer — sonst bliebe creds.pubg_name
            # leer und das creds_gate wuerde alle Widgets blockieren.
            first = not list_tracked_players(conn, g.tenant_id)
            add_tracked_player(conn, g.tenant_id, name,
                               platform=creds.pubg_platform,
                               is_primary=first)
            if first:
                core_creds.set_pubg(conn, g.tenant_id, name=name)
        elif action == "remove":
            remove_tracked_player(conn, g.tenant_id, name)
        elif action == "primary":
            set_primary_tracked_player(conn, g.tenant_id, name)
            # Bestehender Ein-Account-Code liest weiterhin creds.pubg_name —
            # der Primaer-Account bleibt dessen Quelle. account_id gehoert zum
            # alten Namen und wird vom Poller neu aufgeloest.
            core_creds.set_pubg(conn, g.tenant_id, name=name)
            core_creds.clear_pubg_account_id(conn, g.tenant_id)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return redirect("/app/settings?saved=1")


def _archive_cfg_from_form(conn, form):
    """Formular → JSON-Konfiguration. Ein leeres Passwort-Feld heisst
    "unveraendert" — sonst muesste man es bei jeder Pfad-Korrektur neu
    eintippen (und Browser-Autofill wuerde es reihenweise leeren)."""
    import json
    from pubg.archive_config import parse_config
    password = form.get("archive_password") or ""
    if not password:
        old = parse_config(core_creds.get(conn, g.tenant_id).telemetry_archive)
        password = (old or {}).get("password") or ""
    cfg = {
        "host": (form.get("archive_host") or "").strip(),
        "port": (form.get("archive_port") or "22").strip(),
        "user": (form.get("archive_user") or "").strip(),
        "password": password,
        "path": (form.get("archive_path") or "/pubg/telemetry").strip(),
    }
    parsed = parse_config(json.dumps(cfg))
    return parsed, json.dumps(cfg)


@bp_app.route("/app/settings/archive", methods=["POST"])
@require_session
def settings_archive():
    """Eigenes Telemetrie-Archiv (SFTP) speichern oder entfernen.

    Eigener Endpoint wie settings_accounts: HTML kann keine verschachtelten
    Forms, und ein Archiv-Eintrag soll nicht die uebrigen Einstellungen
    mitspeichern.
    """
    conn = _get_conn()
    try:
        if request.form.get("action") == "delete":
            core_creds.set_telemetry_archive(conn, g.tenant_id, None)
            return redirect("/app/settings?archive=removed")
        parsed, config_json = _archive_cfg_from_form(conn, request.form)
        if not parsed:
            return redirect("/app/settings?archive=incomplete")
        core_creds.set_telemetry_archive(conn, g.tenant_id, config_json)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return redirect("/app/settings?archive=saved")


@bp_app.route("/app/settings/archive/test", methods=["POST"])
@require_session
def settings_archive_test():
    """Zugang pruefen, bevor der Poller stundenlang stumm scheitert.

    Nimmt die Formularwerte (noch ungespeichert testen zu koennen ist der
    halbe Sinn) und schreibt/liest/loescht eine Testdatei.
    """
    conn = _get_conn()
    try:
        parsed, _ = _archive_cfg_from_form(conn, request.form)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    if not parsed:
        return jsonify({"ok": False,
                        "error": "Host, Benutzer und Passwort sind Pflicht"})
    from pubg.hidrive_telemetry import check_connection
    return jsonify(check_connection(parsed))


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


@bp_app.route("/app/tools/diag/upload", methods=["POST"])
@require_session
def diag_upload():
    """G1R-Diagnose-Upload (admin-only): nimmt Log-Text und/oder eine Crashdump-Datei,
    legt sie unter data/diag/ mit FESTEN Namen ab (ueberschreibt den letzten Upload,
    bleibt 'temporaer'; kein user-controlled Pfad → kein Path-Traversal)."""
    if not g.user.get("is_admin"):
        abort(403)
    root = current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "data", "diag")
    os.makedirs(out_dir, exist_ok=True)

    resp = {}
    log = request.form.get("log")
    if log:
        log_bytes = log.encode("utf-8")
        with open(os.path.join(out_dir, "g1r-diag-log.txt"), "wb") as fp:
            fp.write(log_bytes)
        resp["log_bytes"] = len(log_bytes)

    f = request.files.get("dump")
    if f and f.filename:
        # Groessen-Limit 300 MB (Content-Length vorab pruefen → kein RAM-Blowup).
        MAX = 300 * 1024 * 1024
        if request.content_length and request.content_length > MAX:
            return jsonify({"error": "Datei zu groß — max. 300 MB"}), 400
        dump_path = os.path.join(out_dir, "g1r-diag.dmp")
        f.save(dump_path)                      # werkzeug streamt auf Disk
        try:
            resp["dump_bytes"] = os.path.getsize(dump_path)
        except OSError:
            resp["dump_bytes"] = 0

    if not resp:
        return jsonify({"error": "Nichts übermittelt"}), 400
    return jsonify({"ok": True, **resp})


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
        try:
            from core import features
            feats = set(features.effective(conn, g.tenant_id))
        except Exception:
            feats = set()
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
    from overlay_app.overlay_catalog import MEME_TIMING_SWITCHES, has_meme_sound
    for st_ in stingers:   # Ton-Timing für alle Memes mit Tondatei
        if has_meme_sound(project_root, st_["file"]):
            st_["switches"] = st_["switches"] + MEME_TIMING_SWITCHES
    effects  = list_dir_sources(project_root, "effects",  desc="Visual effect overlay.",
                                switches_map=EFFECT_META)
    # Schalter mit "feature" nur zeigen, wenn der Tenant die Freischaltung hat (core/features.py)
    from core.features import EXTRAS, TOOL_CARD_EXTRAS
    # Sonderpunkte (PUBG, Gothic 1, Race, Ducks, Weather) nur mit Freischaltung
    widgets_list = [w for w in widgets_list if _widget_domain(w[0]) not in EXTRAS or _widget_domain(w[0]) in feats]
    effects = [e for e in effects if e["domain"] not in EXTRAS or e["domain"] in feats]
    for e in effects:
        e["switches"] = [sw for sw in e["switches"] if not sw.get("feature") or sw["feature"] in feats]
        if e["file"] in ("item-rain.html", "car-burnout.html"):
            e["switches"] = [_car_model_switch(project_root, sw) if sw["key"] == "model" else sw for sw in e["switches"]]
    transitions = TRANSITIONS
    visible = _visible_tools()
    domain_tools = {d: _domain_tools(visible, d) for d in TOOL_CARD_EXTRAS if d in feats}
    race_link = None
    if "race" in feats:
        try:
            from fx.endpoints import drive_link
            race_link = drive_link(g.tenant_id)
        except Exception:
            current_app.logger.exception("urls: race drive link failed")
    return render_template("urls.html", domain_tools=domain_tools, race_link=race_link,
                           user=g.user, token=token,
                           pubg_ready=pubg_ready, steam_ready=steam_ready,
                           widgets=widgets_list, base_url=base_url,
                           overlays=OVERLAYS, overlay_base=base_url,
                           alerts=ALERTS, decor=DECOR,
                           stingers=stingers, effects=effects, transitions=transitions)


def _car_model_switch(root, sw):
    """Auswahl „Car model“ aus dem Auto-Katalog (data/car-rain/catalog.json): Mix, je Marke, je Auto."""
    import json as _json
    try:
        with open(os.path.join(root, "data", "car-rain", "catalog.json"), encoding="utf-8") as f:
            cat = _json.load(f)
    except (OSError, ValueError):
        cat = []
    brands = sorted({c.get("brand", "") for c in cat if c.get("brand")})
    opts = [["mix", "Random mix"]] + [["brand:" + b, "All " + b] for b in brands]
    opts += [[c["key"], "%s – %s" % (c.get("brand", ""), c.get("name", c["key"]))] for c in sorted(cat, key=lambda c: (c.get("brand", ""), c.get("name", "")))]
    return dict(sw, options=opts)


@bp_app.route("/app/dock/weather")
@require_session
def dock_weather():
    """Schmale Steuerseite für ein OBS-Dock (Docks → Benutzerdefinierte Browser-Docks):
    Statuszeile wie !weather und die Knöpfe der Weather-Source, ohne Menü.
    ?place= wie in der Overlay-URL, damit die Statuszeile das echte Wetter am Ort zeigt."""
    if "weather" not in _unlocked_extras():
        abort(403)
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT token FROM widget_tokens
                WHERE tenant_id = %s AND revoked_at IS NULL
                ORDER BY created_at
                LIMIT 1
            """, (g.tenant_id,))
            row = cur.fetchone()
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    from overlay_app.overlay_catalog import EFFECT_META
    groups = []
    for c in EFFECT_META["weather.html"].get("controls", []):
        if not groups or groups[-1]["name"] != c["group"]:
            groups.append({"name": c["group"], "items": []})
        groups[-1]["items"].append(c)
    return render_template("dock_weather.html", token=row["token"] if row else None, groups=groups,
                           place=(request.args.get("place") or "").strip()[:80],
                           who=(g.user.get("display_name") or "").strip())


def _duck_root():
    return current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))


@bp_app.route("/app/api/ducks/outfits", methods=["POST"])
@require_admin
def duck_outfit_save():
    """Duck-Editor: Outfit speichern (global, gilt sofort in Regen und Messer-Ente).
    Nur JSON — ein fremdes Formular kann so keinen Request unterschieben."""
    from fx import duck_outfits
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict):
        return jsonify({"ok": False, "error": "JSON body expected"}), 400
    err = duck_outfits.save(_duck_root(), body.get("key"), body.get("def"))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    return jsonify({"ok": True})


@bp_app.route("/app/api/ducks/outfits/<key>", methods=["DELETE"])
@require_admin
def duck_outfit_delete(key):
    """Gespeichertes Outfit löschen: eigenes ist weg, umgebautes wieder im Original."""
    from fx import duck_outfits
    return jsonify({"ok": True, "deleted": duck_outfits.delete(_duck_root(), key)})


@bp_app.route("/app/api/ducks/parts", methods=["POST"])
@require_admin
def duck_part_save():
    """Part-Werkstatt: ein Teil global umbauen (gilt in jedem Outfit mit diesem Teil)."""
    from fx import duck_outfits
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict):
        return jsonify({"ok": False, "error": "JSON body expected"}), 400
    err = duck_outfits.save_part(_duck_root(), body.get("key"), body.get("xf"))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    return jsonify({"ok": True})


@bp_app.route("/app/api/ducks/parts/<key>", methods=["DELETE"])
@require_admin
def duck_part_delete(key):
    """Globalen Umbau eines Teils verwerfen: wieder wie im Code."""
    from fx import duck_outfits
    return jsonify({"ok": True, "deleted": duck_outfits.delete_part(_duck_root(), key)})


@bp_app.route("/app/api/logo-cuts", methods=["GET"])
@require_admin
def logo_cuts_list():
    """Logo-Cut-Editor: Bilder in assets/ und gespeicherte Teile."""
    from fx import logo_cuts
    root = _duck_root()
    return jsonify({"ok": True, "images": logo_cuts.images(root), "cuts": logo_cuts.load(root)})


@bp_app.route("/app/api/logo-cuts", methods=["POST"])
@require_admin
def logo_cuts_save():
    """Logo-Cut-Editor: Teile eines Bilds speichern (global, Logo 3D nimmt sie beim nächsten Laden). Nur JSON."""
    from fx import logo_cuts
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict):
        return jsonify({"ok": False, "error": "JSON body expected"}), 400
    err = logo_cuts.save(_duck_root(), body.get("file"), body.get("parts"))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    return jsonify({"ok": True})


@bp_app.route("/app/api/logo-cuts/<file>", methods=["DELETE"])
@require_admin
def logo_cuts_delete(file):
    """Eigene Teile verwerfen: Logo 3D zerlegt das Bild wieder automatisch."""
    from fx import logo_cuts
    return jsonify({"ok": True, "deleted": logo_cuts.delete(_duck_root(), file)})


@bp_app.route("/app/api/cars/<kind>", methods=["POST"])
@require_admin
def car_model_save(kind):
    """Auto-Editor: Fahrzeug bzw. Felge speichern (global, gilt sofort im BMW-Regen). Nur JSON."""
    from fx import car_models
    if kind not in car_models.KINDS:
        abort(404)
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict):
        return jsonify({"ok": False, "error": "JSON body expected"}), 400
    err = car_models.save(_duck_root(), kind, body.get("key"), body.get("def"))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    return jsonify({"ok": True})


@bp_app.route("/app/api/cars/preview/<uid>.glb")
@require_admin
def car_preview_glb(uid):
    """Car-Picker: Sketchfab-Modell für die 3D-Vorschau (beim ersten Mal vom Server geladen, dann aus dem Cache)."""
    from fx import sketchfab
    try:
        path = sketchfab.fetch(_duck_root(), uid)
    except sketchfab.FetchError as e:
        return jsonify({"ok": False, "error": str(e)}), e.status
    return send_from_directory(os.path.dirname(path), os.path.basename(path), mimetype="model/gltf-binary", max_age=86400)


@bp_app.route("/app/api/models", methods=["GET"])
@require_admin
def models_list():
    """Model gallery: alle 3D-Modelle (Autos, Kulissen, Notizen) mit Haken „Keep“ (fx/model_sort.py)."""
    from fx import model_sort
    return jsonify({"ok": True, "items": model_sort.inventory(_duck_root())})


@bp_app.route("/app/api/models/<uid>.glb")
@require_admin
def models_glb(uid):
    """Höchste Auflösung eines Modells (Original-Download, sonst aufbereitete Fassung)."""
    from fx import model_sort
    path = model_sort.glb_path(_duck_root(), uid)
    if not path:
        abort(404)
    return send_from_directory(os.path.dirname(path), os.path.basename(path), mimetype="model/gltf-binary", max_age=86400)


@bp_app.route("/app/api/models/<uid>/thumb", methods=["GET", "POST"])
@require_admin
def models_thumb(uid):
    """Vorschaubild: GET liefert es, POST (image/webp) speichert das von der Seite gerenderte."""
    from fx import model_sort
    path = model_sort.thumb_path(_duck_root(), uid)
    if not path:
        abort(404)
    if request.method == "POST":
        if request.mimetype != "image/webp":
            return jsonify({"ok": False, "error": "image/webp expected"}), 400
        ok = model_sort.save_thumb(_duck_root(), uid, request.get_data(cache=False))
        return (jsonify({"ok": True}), 200) if ok else (jsonify({"ok": False, "error": "invalid image"}), 400)
    if not os.path.exists(path):
        abort(404)
    return send_from_directory(os.path.dirname(path), os.path.basename(path), mimetype="image/webp", max_age=3600)


@bp_app.route("/app/api/models/keep", methods=["POST"])
@require_admin
def models_keep():
    """Haken „Keep“ setzen. Nur JSON — ein fremdes Formular kann so keinen Request unterschieben."""
    from fx import model_sort
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict) or not model_sort.set_keep(_duck_root(), body.get("uid"), bool(body.get("keep"))):
        return jsonify({"ok": False, "error": "invalid uid"}), 400
    return jsonify({"ok": True})


@bp_app.route("/app/api/models/purge", methods=["POST"])
@require_admin
def models_purge():
    """Alle nicht behaltenen Modelle in den Papierkorb (data/model-trash/<Zeit>/). Die Seite schickt die erwartete
    Anzahl mit; stimmt sie nicht mehr (anderer Tab hat geändert), passiert nichts."""
    from fx import model_sort
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict):
        return jsonify({"ok": False, "error": "JSON body expected"}), 400
    root = _duck_root()
    n = sum(1 for i in model_sort.inventory(root) if not i["keep"] and i["have"])
    if body.get("expect") != n:
        return jsonify({"ok": False, "error": "selection changed, reload the page", "count": n}), 409
    return jsonify({"ok": True, **model_sort.purge(root)})


@bp_app.route("/app/api/cars/<kind>", methods=["GET"])
@require_admin
def car_model_list(kind):
    """Gespeicherte Einträge einer Art (z. B. die Auswahl im Auto-Picker)."""
    from fx import car_models
    if kind not in car_models.KINDS:
        abort(404)
    return jsonify({"ok": True, "items": car_models.load(_duck_root(), kind)})


@bp_app.route("/app/api/cars/<kind>/<key>", methods=["DELETE"])
@require_admin
def car_model_delete(kind, key):
    """Gespeichertes Fahrzeug bzw. Felge löschen: eigenes ist weg, umgebautes wieder im Original."""
    from fx import car_models
    if kind not in car_models.KINDS:
        abort(404)
    return jsonify({"ok": True, "deleted": car_models.delete(_duck_root(), kind, key)})


def _widget_domain(cat: str) -> str:
    """Dashboard-Reiter eines Widgets aus seiner Kategorie (wie in urls.html)."""
    return "pubg" if cat.startswith("PUBG") else ("steam" if cat == "Steam" else ("g1r" if cat == "Gothic 1" else "stream"))


def _domain_tools(tools, domain):
    """Tools einer Dashboard-Domain (Feld "domain" in TOOLS) als Link-Karten für /app/urls."""
    return [t for t in tools if t.get("domain") == domain]


def _unlocked_extras() -> set:
    """Freigeschaltete Extras (Weather/Race/Ducks) des aktuellen Tenants, 10 s gemerkt."""
    from core import features

    def load():
        conn = _get_conn()
        try:
            return features.effective(conn, g.tenant_id)
        finally:
            if "_PG_CONN_FACTORY" not in current_app.config:
                conn.close()
    try:
        return set(features.effective_cached(load, g.tenant_id)) & set(features.EXTRAS)
    except Exception:
        current_app.logger.exception("extras lookup failed")
        return set()


def _tool_allowed(t, extras) -> bool:
    from core.features import EXTRAS
    if t["admin_only"] and not g.user.get("is_admin"):
        return False
    return t.get("domain") not in EXTRAS or t.get("domain") in extras


def _visible_tools():
    """Tools the current user is allowed to see."""
    extras = _unlocked_extras()
    return [t for t in TOOLS if _tool_allowed(t, extras)]


@bp_app.route("/app/tools")
@require_session
def tools_index():
    return render_template("tools.html", user=g.user, tools=_visible_tools())


#: Cache-Buster fuer Tool-Assets. Der Server schickt zwar no-cache mit
#: ETag, aber sobald eine gecachte HTML-Seite die alte URL enthaelt,
#: revalidiert der Browser die falsche Datei. Mit ?v=<mtime> wechselt die
#: URL bei jedem Deploy, und "ich sehe den Fix nicht" hoert auf, eine
#: mogliche Erklaerung zu sein.
_STATIC_REF = re.compile(r'(src|href)="(/(?:tools|widgets)-static/[^"?]+)"')
_TOKEN_JS_REF = re.compile(r'(src)="(/s/[^/"]+/js/([^"?]+))"')


def _bust_static_urls(html: str, root: str) -> str:
    def repl(m):
        attr, url = m.group(1), m.group(2)
        rel = url.lstrip("/")
        prefix, _, tail = rel.partition("/")
        sub = "tools" if prefix == "tools-static" else "widgets"
        full = os.path.normpath(os.path.join(root, sub, tail))
        if not full.startswith(root) or not os.path.exists(full):
            return m.group(0)
        return f'{attr}="{url}?v={int(os.path.getmtime(full))}"'
    html = _STATIC_REF.sub(repl, html)

    # Skripte der Sources, die Tools über /s/<token>/js/… laden (z. B. js/toy-cars.js): ebenfalls ?v=<mtime>,
    # sonst ruft ein neues Tool eine alte, gecachte Fassung auf
    def repl_js(m):
        attr, url, rel = m.group(1), m.group(2), m.group(3)
        full = os.path.normpath(os.path.join(root, "js", rel))
        if not full.startswith(root) or not os.path.exists(full):
            return m.group(0)
        return f'{attr}="{url}?v={int(os.path.getmtime(full))}"'
    return _TOKEN_JS_REF.sub(repl_js, html)


@bp_app.route("/app/tools/<key>")
@require_session
def tools_open(key):
    tool = next((t for t in TOOLS if t["key"] == key), None)
    if tool is None:
        abort(404)
    if not _tool_allowed(tool, _unlocked_extras()):
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
            from pubg.db_pg import get_setting
            gate_theme = get_setting(conn, g.tenant_id, "theme", "entry") or "entry"
        finally:
            if "_PG_CONN_FACTORY" not in current_app.config:
                conn.close()
        missing = missing_domains(creds, needed)
        if missing:
            return (render_block_page(tool["path"], missing, "/app/", theme=gate_theme),
                    200, {"Content-Type": "text/html; charset=utf-8"})
    with open(full_path, "r", encoding="utf-8") as f:
        html = f.read()
    # Theme auf <html data-theme="..."> setzen — ohne das greifen
    # alle html[data-theme="X"]-Selektoren in _theme.css nicht.
    from webcore.serving import inject_theme, inject_impersonation_banner
    from pubg.db_pg import get_setting
    conn2 = _get_conn()
    try:
        theme = get_setting(conn2, g.tenant_id, "theme", "entry") or "entry"
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn2.close()
    html = inject_theme(html, theme)
    # Fremdsicht kennzeichnen (?asTenant=...) — an der Seite selbst ist sonst
    # nicht zu sehen, wessen Daten da stehen.
    html = inject_impersonation_banner(
        html, getattr(g, "tenant_impersonating", None), request.full_path)
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
    #
    # Der Widget-Token kommt trotzdem mit: ein Tool, das eine
    # OBS-Source-URL zum Kopieren anzeigt, braucht ihn. Ohne
    # `/s/<token>/` antwortet die Widget-Route mit 404, und eine
    # angezeigte URL ohne Token ist schlimmer als keine — sie sieht
    # richtig aus. Der Token steht ohnehin auf der Uebersichtsseite;
    # hier entsteht kein neues Geheimnis.
    widget_token = ""
    try:
        conn3 = _get_conn()
        try:
            with conn3.cursor() as cur:
                cur.execute(
                    "SELECT token FROM widget_tokens WHERE tenant_id = %s "
                    "AND revoked_at IS NULL ORDER BY created_at LIMIT 1",
                    (g.tenant_id,))
                row = cur.fetchone()
                widget_token = (row["token"] if row else "") or ""
        finally:
            if "_PG_CONN_FACTORY" not in current_app.config:
                conn3.close()
    except Exception:                    # kein Token eingerichtet
        widget_token = ""
    # Vorschau-Tools, die Dateien der Sources laden (/s/__WIDGET_TOKEN__/js/…)
    html = html.replace("/s/__WIDGET_TOKEN__/", "/s/" + widget_token + "/")
    inject = (
        '<script>\n'
        'window.__SERVE_BASE__ = "/";\n'
        'window.__STATIC_BASE__ = "/widgets-static/";\n'
        'window.__WIDGET_TOKEN__ = '
        + json.dumps(widget_token) + ';\n'
        '</script>'
    )
    if "</head>" in html:
        html = html.replace("</head>", inject + "\n</head>", 1)
    else:
        html = inject + "\n" + html
    html = _bust_static_urls(html, root)
    # Ohne no-cache haelt der Browser diese Seite beliebig lange und laedt
    # damit auch die alten Asset-URLs weiter — ein Deploy kommt dann nicht
    # an, ohne dass jemand hart neu laedt. serve_html_or_asset macht das
    # fuer Widgets schon so, hier fehlte es.
    return html, 200, {"Content-Type": "text/html; charset=utf-8",
                       "Cache-Control": "no-cache, must-revalidate"}


# ── Alert-Töne (bis zu 3 MP3 je Alert, Dashboard → Stream → Alert-Karte) ──

def _sound_conn(fn):
    conn = _get_conn()
    try:
        return fn(conn)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()


def _sound_root():
    return current_app.config.get("_PROJECT_ROOT", ".")


def _fetch_only():
    """Schreibende Aufrufe nur per fetch() mit eigenem Header – ein fremdes Formular kann den nicht setzen."""
    return request.headers.get("X-Requested-With") == "fetch"


@bp_app.route("/app/api/stinger-logo", methods=["GET", "POST", "DELETE"])
@require_session
def stinger_logo_api():
    """Logos der WebGL-Stinger: GET = Liste, POST = hinzufügen (bis 10), DELETE ?id= = eines entfernen."""
    from overlay_app import stinger_logo
    if request.method == "GET":
        return jsonify({"ok": True, "logos": _sound_conn(lambda c: stinger_logo.load(c, g.tenant_id)),
                        "max": stinger_logo.MAX_LOGOS})
    if not _fetch_only():
        return jsonify({"ok": False, "error": "Bad request."}), 400
    if request.method == "DELETE":
        lid = request.args.get("id", "")
        if not _sound_conn(lambda c: stinger_logo.delete(c, _sound_root(), g.tenant_id, lid)):
            return jsonify({"ok": False, "error": "Logo not found."}), 404
        return jsonify({"ok": True})
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "No file received."}), 400
    data = f.read(stinger_logo.MAX_BYTES + 1)
    entry, err = _sound_conn(lambda c: stinger_logo.add_image(c, _sound_root(), g.tenant_id, f.filename, data))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    return jsonify({"ok": True, "logo": entry})


@bp_app.route("/app/api/stinger-logo/file/<filename>")
@require_session
def stinger_logo_preview(filename):
    """Vorschau im Dashboard."""
    from flask import send_file
    from overlay_app import stinger_logo
    p = stinger_logo.path_of(_sound_root(), g.tenant_id, filename)
    if not p:
        abort(404)
    return send_file(p, mimetype=stinger_logo.MIME[filename.rsplit(".", 1)[1]], max_age=0)


@bp_app.route("/app/api/pet-media")
@require_session
def pet_media_list():
    from overlay_app import pet_media
    cfg = _sound_conn(lambda c: pet_media.load(c, g.tenant_id))
    return jsonify({"ok": True, "img": cfg["img"], "sounds": cfg["sounds"], "volume": cfg["volume"],
                    "maxSounds": pet_media.MAX_SOUNDS, "maxSeconds": pet_media.MAX_SECONDS})


@bp_app.route("/app/api/pet-media/<kind>", methods=["POST"])
@require_session
def pet_media_upload(kind):
    """kind=image (ersetzt) | sound (bis zu 3) | volume (JSON)."""
    from overlay_app import pet_media
    if not _fetch_only():
        return jsonify({"ok": False, "error": "Bad request."}), 400
    if kind == "volume":
        body = request.get_json(silent=True) if request.is_json else None
        try:
            vol = float(body.get("volume"))
        except (AttributeError, TypeError, ValueError):
            return jsonify({"ok": False, "error": "Invalid volume."}), 400
        _sound_conn(lambda c: pet_media.set_volume(c, g.tenant_id, vol))
        return jsonify({"ok": True})
    if kind not in ("image", "sound"):
        abort(404)
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "No file received."}), 400
    limit = pet_media.MAX_IMG_BYTES if kind == "image" else pet_media.MAX_SOUND_BYTES
    data = f.read(limit + 1)
    fn = pet_media.set_image if kind == "image" else pet_media.add_sound
    entry, err = _sound_conn(lambda c: fn(c, _sound_root(), g.tenant_id, f.filename, data))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    return jsonify({"ok": True, "file": entry})


@bp_app.route("/app/api/pet-media/<file_id>", methods=["DELETE"])
@require_session
def pet_media_delete(file_id):
    from overlay_app import pet_media
    if not _fetch_only():
        return jsonify({"ok": False, "error": "Bad request."}), 400
    if not _sound_conn(lambda c: pet_media.delete(c, _sound_root(), g.tenant_id, file_id)):
        return jsonify({"ok": False, "error": "Not found."}), 404
    return jsonify({"ok": True})


@bp_app.route("/app/api/pet-media/file/<filename>")
@require_session
def pet_media_preview(filename):
    """Vorschau/Vorhören im Dashboard."""
    from flask import send_file
    from overlay_app import pet_media
    p = pet_media.path_of(_sound_root(), g.tenant_id, filename)
    if not p:
        abort(404)
    return send_file(p, mimetype=pet_media.MIME[filename.rsplit(".", 1)[1]], max_age=0)


@bp_app.route("/app/api/friend-allow", methods=["GET", "POST"])
@require_session
def friend_allow_api():
    """Friend: Erlaubnisliste für Chat-Befehle lesen/speichern (Text mit Namen, getrennt durch Komma/Zeile)."""
    from fx import friend_allow
    if request.method == "POST":
        if not _fetch_only():
            return jsonify({"ok": False, "error": "Bad request."}), 400
        body = request.get_json(silent=True) if request.is_json else None
        names = _sound_conn(lambda c: friend_allow.save(c, g.tenant_id, (body or {}).get("names", "")))
        return jsonify({"ok": True, "names": names})
    return jsonify({"ok": True, "names": _sound_conn(lambda c: friend_allow.load(c, g.tenant_id))})


@bp_app.route("/app/api/alert-sounds")
@require_session
def alert_sounds_list():
    from overlay_app import alert_sounds
    cfg = _sound_conn(lambda c: alert_sounds.load(c, g.tenant_id))
    return jsonify({"alerts": cfg, "defaults": alert_sounds.DEFAULTS, "extras": alert_sounds.EXTRAS, "maxFiles": alert_sounds.MAX_FILES,
                    "maxSeconds": alert_sounds.MAX_SECONDS, "maxBytes": alert_sounds.MAX_BYTES})


@bp_app.route("/app/api/alert-sounds/<alert>", methods=["POST"])
@require_session
def alert_sounds_upload(alert):
    from overlay_app import alert_sounds
    if not _fetch_only():
        return jsonify({"ok": False, "error": "Bad request."}), 400
    f = request.files.get("sound")
    if not f:
        return jsonify({"ok": False, "error": "No file received."}), 400
    data = f.read(alert_sounds.MAX_BYTES + 1)
    entry, err = _sound_conn(lambda c: alert_sounds.add(c, _sound_root(), g.tenant_id, alert, f.filename, data))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    return jsonify({"ok": True, "file": entry})


@bp_app.route("/app/api/alert-sounds/<alert>/volume", methods=["POST"])
@require_session
def alert_sounds_volume(alert):
    from overlay_app import alert_sounds
    body = request.get_json(silent=True) if request.is_json else None
    try:
        vol = float(body.get("volume"))
    except (AttributeError, TypeError, ValueError):
        return jsonify({"ok": False, "error": "Invalid volume."}), 400
    if not _sound_conn(lambda c: alert_sounds.set_volume(c, g.tenant_id, alert, vol)):
        return jsonify({"ok": False, "error": "Unknown alert."}), 404
    return jsonify({"ok": True})


@bp_app.route("/app/api/alert-sounds/<alert>/options", methods=["POST"])
@require_session
def alert_sounds_options(alert):
    """Dauer (s), Ton ganz ausspielen, Alert bis zum Tonende stehen lassen – gilt für den Wartemodus (alerts/live.html)."""
    from overlay_app import alert_sounds
    body = request.get_json(silent=True) if request.is_json else None
    if not isinstance(body, dict):
        return jsonify({"ok": False, "error": "Bad request."}), 400
    try:
        dur = int(body["duration"]) if body.get("duration") is not None else None
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Invalid duration."}), 400
    full = bool(body["full"]) if "full" in body else None
    stay = bool(body["stay"]) if "stay" in body else None
    extras = body.get("extras") if isinstance(body.get("extras"), dict) else None
    if not _sound_conn(lambda c: alert_sounds.set_options(c, g.tenant_id, alert, dur, full, stay, extras)):
        return jsonify({"ok": False, "error": "Unknown alert."}), 404
    return jsonify({"ok": True})


@bp_app.route("/app/api/alert-sounds/<alert>/<file_id>", methods=["DELETE"])
@require_session
def alert_sounds_delete(alert, file_id):
    from overlay_app import alert_sounds
    if not _fetch_only():
        return jsonify({"ok": False, "error": "Bad request."}), 400
    if not _sound_conn(lambda c: alert_sounds.delete(c, _sound_root(), g.tenant_id, alert, file_id)):
        return jsonify({"ok": False, "error": "Not found."}), 404
    return jsonify({"ok": True})


@bp_app.route("/app/api/alert-sounds/<alert>/<file_id>.mp3")
@require_session
def alert_sounds_file(alert, file_id):
    """Vorhören im Dashboard (nur eigene Töne)."""
    from overlay_app import alert_sounds
    p = alert_sounds.path_of(_sound_root(), g.tenant_id, alert, file_id)
    if not p:
        abort(404)
    return send_file(p, mimetype="audio/mpeg", max_age=3600)
