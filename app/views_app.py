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

    # Widget catalog. Each entry:
    #   (category, label, description, path, switches)
    # switches = list of {name, label, default, options=[(value, label), ...]}
    # The default option is highlighted on load. If the user picks the default,
    # no query param is added (widget uses its own default anyway).
    RANGE_SW = {
        "name": "range",
        "label": "Range",
        "default": "all",
        "options": [("session", "Session"), ("week", "Week"), ("all", "All")],
    }
    SORT_KD = {
        "name": "sortBy",
        "label": "Sort by",
        "default": "kd",
        "options": [("kd", "K/D"), ("matches", "Matches"), ("damage", "Damage")],
    }
    MIN_MATCHES = {
        "name": "minMatches",
        "label": "Min. matches",
        "default": "2",
        "options": [("2", "2"), ("5", "5"), ("10", "10"), ("20", "20")],
    }

    widgets_list = [
        ("PUBG · Stats", "Career Card", "Career stats: K/D, wins, top 10 — current season.", "pubg/career-card.html", []),
        ("PUBG · Stats", "Session Report", "Full per-match report after session end — kills, damage, placement.", "pubg/session-report.html", []),
        ("PUBG · Stats", "Live Bar", "Live stat bar for the gameplay overlay — kills, damage, place.", "pubg/live-bar.html", []),
        ("PUBG · Stats", "Streak Counter", "Live win-streak / top10-streak counter.", "pubg/streak-counter.html", []),
        ("PUBG · Stats", "First Fight Rate", "How often you win the first fight.", "pubg/first-fight.html", [RANGE_SW]),
        ("PUBG · Stats", "Weapon Stats", "Damage and kill distribution by weapon.", "pubg/weapon-stats.html", [RANGE_SW]),

        ("PUBG · Mates", "Coplayer", "Who plays with you (incl. partial sessions).", "pubg/coplayer.html", [RANGE_SW, MIN_MATCHES]),
        ("PUBG · Mates", "Top Mates", "Best synergy mates by team K/D.", "pubg/top-mates.html", [RANGE_SW, SORT_KD, MIN_MATCHES]),
        ("PUBG · Mates", "Mates Flyout", "Detail flyout with mate stats.", "pubg/flyout-full.html", [RANGE_SW, SORT_KD, MIN_MATCHES]),
        ("PUBG · Mates", "Anti-Mates", "Players who played against you (kill/death stats).", "pubg/anti-mates.html", [RANGE_SW]),

        ("PUBG · Maps", "Map Performance", "Performance per map: place, kills, damage.", "pubg/map-performance.html", [RANGE_SW]),
        ("PUBG · Maps", "Map Distribution", "Chicken-dinner pins on the map (all wins).", "pubg/chicken-map.html", []),
        ("PUBG · Maps", "Hot Drop", "Hot-drop visualisation — where you land.", "pubg/hot-drop.html", []),

        ("PUBG · Match", "Post-Match Card", "Card right after a match ends — stats + replay link.", "pubg/post-match-card.html", []),
        ("PUBG · Match", "Session Summary", "Summary of the current session.", "pubg/session-summary.html", []),
        ("PUBG · Match", "Session Goal", "Progress toward the configured session goal.", "pubg/session-goal.html", []),

        ("PUBG · Achievements", "Milestone Celebrate", "Animation/sound on milestone achievements.", "pubg/milestone-celebrate.html", []),
        ("PUBG · Achievements", "Achievement Feed", "Achievement ticker.", "pubg/achievement-feed.html", []),
        ("PUBG · Achievements", "Session Achievements", "Achievements unlocked in the current session.", "pubg/session-achievements.html", []),

        ("PUBG · News", "News Ticker", "Bottom-bar news + stats highlights.", "pubg/news-ticker.html", []),
        ("PUBG · News", "Lookup", "Live player lookup driven by chat commands.", "pubg/lookup.html", []),

        ("Steam", "Achievement Feed", "Achievement unlock ticker.", "steam/recent-unlocks.html", []),
        ("Steam", "Achievement Popup", "Animation on a fresh unlock.", "steam/popup.html", []),
        ("Steam", "Now Playing", "Currently played Steam game.", "steam/now-playing.html", []),
        ("Steam", "Games Ticker", "Owned-games ticker.", "steam/games-ticker.html", []),
        ("Steam", "Achievement Browser", "Full-screen browser for all achievements (Just Chatting).", "steam/achievement-browser.html", []),
    ]
    base_url = request.url_root.rstrip("/")
    return render_template("urls.html",
                           user=g.user, token=token,
                           widgets=widgets_list, base_url=base_url)
