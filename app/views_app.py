"""Streamer-Routes."""
from flask import (
    Blueprint, render_template, g, jsonify, request, redirect, current_app
)

from app.middleware import require_session, _get_conn
from core import credentials as core_creds


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
    try:
        creds = core_creds.get(conn, g.tenant_id)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    cred_status = {
        "pubg_ready": bool(creds.pubg_name and creds.pubg_api_key),
        "steam_ready": bool(creds.steam_id and creds.steam_api_key),
        "any_missing": not (creds.pubg_name and creds.pubg_api_key
                            and creds.steam_id and creds.steam_api_key),
    }
    return render_template("dashboard.html", user=g.user, cred_status=cred_status)


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
            return redirect("/app/settings?saved=1")
        creds = core_creds.get(conn, g.tenant_id)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return render_template("settings.html",
                           user=g.user, creds=creds,
                           saved=request.args.get("saved"))


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
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()

    # Widget-Katalog: (Kategorie, Label, Beschreibung, Pfad, Range-Optionen)
    # Range-Optionen: None = keine Range, sonst Liste von (label, query) Paaren
    RANGE_SESSION_WEEK_ALL = [
        ("Session", "?range=session"),
        ("Woche",   "?range=week"),
        ("Alle",    "?range=all"),
    ]
    RANGE_SESSION_ALL = [
        ("Session", "?range=session"),
        ("Alle",    "?range=all"),
    ]

    widgets_list = [
        ("PUBG · Stats", "Career Card", "Karriere-Stats: K/D, Wins, Top10 — aktuelle Season.", "pubg/career-card.html", None),
        ("PUBG · Stats", "Session Report", "Vollstaendiger Match-Report nach Session-Ende — Kills/Damage/Place pro Match.", "pubg/session-report.html", None),
        ("PUBG · Stats", "Live Bar", "Live-Stat-Leiste fuers Gameplay-Overlay — Kills, Damage, Place.", "pubg/live-bar.html", None),
        ("PUBG · Stats", "Streak Counter", "Win-Streak / Top10-Streak Counter, live.", "pubg/streak-counter.html", None),
        ("PUBG · Stats", "First Fight Rate", "Wie oft du den First-Fight gewinnst.", "pubg/first-fight.html", RANGE_SESSION_WEEK_ALL),
        ("PUBG · Stats", "Weapon Stats", "Damage- und Kill-Verteilung nach Waffe.", "pubg/weapon-stats.html", RANGE_SESSION_WEEK_ALL),

        ("PUBG · Mates", "Coplayer", "Wer mit dir spielt (auch teils-gespielt).", "pubg/coplayer.html", RANGE_SESSION_WEEK_ALL),
        ("PUBG · Mates", "Top Mates", "Beste Synergie-Partner sortiert nach Team-KD.", "pubg/top-mates.html", RANGE_SESSION_WEEK_ALL),
        ("PUBG · Mates", "Mates Flyout", "Detail-Flyout mit Mate-Statistiken.", "pubg/flyout-full.html", RANGE_SESSION_WEEK_ALL),
        ("PUBG · Mates", "Anti-Mates", "Spieler die gegen dich antreten (Kill/Tot Stats).", "pubg/anti-mates.html", RANGE_SESSION_WEEK_ALL),

        ("PUBG · Maps", "Map Performance", "Performance pro Map: Place, Kills, Damage.", "pubg/map-performance.html", RANGE_SESSION_WEEK_ALL),
        ("PUBG · Maps", "Map Distribution", "Chicken-Dinner-Pins auf der Map (alle Wins).", "pubg/chicken-map.html", None),
        ("PUBG · Maps", "Hot Drop", "Hot-Drop-Visualisierung — wo gelandet wird.", "pubg/hot-drop.html", None),

        ("PUBG · Match", "Post-Match Card", "Card direkt nach Match-Ende mit Stats + Replay-Link.", "pubg/post-match-card.html", None),
        ("PUBG · Match", "Session Summary", "Zusammenfassung der laufenden Session.", "pubg/session-summary.html", None),
        ("PUBG · Match", "Session Goal", "Fortschritt zum gesetzten Session-Ziel.", "pubg/session-goal.html", None),

        ("PUBG · Achievements", "Milestone Celebrate", "Animation/Sound bei erreichten Meilensteinen.", "pubg/milestone-celebrate.html", None),
        ("PUBG · Achievements", "Achievement Feed", "Ticker mit Achievements.", "pubg/achievement-feed.html", None),
        ("PUBG · Achievements", "Session Achievements", "Achievements der aktuellen Session.", "pubg/session-achievements.html", None),

        ("PUBG · News", "News Ticker", "Bottom-Bar mit Nachrichten + Stats-Highlights.", "pubg/news-ticker.html", None),
        ("PUBG · News", "Lookup", "Live-Player-Lookup (Chat-Befehl-Driven).", "pubg/lookup.html", None),

        ("Steam", "Achievement Feed", "Achievement-Unlock-Ticker.", "steam/recent-unlocks.html", None),
        ("Steam", "Achievement Popup", "Animation bei frischem Unlock.", "steam/popup.html", None),
        ("Steam", "Now Playing", "Aktuell gespieltes Steam-Spiel.", "steam/now-playing.html", None),
        ("Steam", "Games Ticker", "Owned-Games Ticker.", "steam/games-ticker.html", None),
        ("Steam", "Achievement Browser", "Vollbild-Browser fuer alle Achievements (Just-Chatting).", "steam/achievement-browser.html", None),
    ]
    base_url = request.url_root.rstrip("/")
    return render_template("urls.html",
                           user=g.user, token=token,
                           widgets=widgets_list, base_url=base_url)
