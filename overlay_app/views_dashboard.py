"""Service-2-Root (stream-overlay.com): kein eigenes Dashboard.

Das Login-Cookie ist auf die Stats-Domain (andere eTLD+1) gescoped und kommt
auf der Overlay-Domain nicht an — ein eingeloggtes Dashboard ist hier also
nicht moeglich. Der Root-Pfad leitet daher auf die Overlay-URL-Uebersicht der
Stats-Domain um (dort liegen die tokenisierten URLs, eingeloggt erreichbar).
Die Overlays selbst werden tokenbasiert unter /s/<token>/overlays/ bedient.
"""
from flask import Blueprint, redirect, current_app


bp_dashboard = Blueprint("overlay_dashboard", __name__)


@bp_dashboard.route("/")
def dashboard():
    return redirect(current_app.config["MAIN_URLS_URL"], code=302)
