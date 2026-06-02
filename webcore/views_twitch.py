"""Geteilter Twitch-Endpoint: server-seitiger Clip-Abruf.

/s/<token>/api/twitch/clips — nutzt tenant-eigene Twitch-App-Credentials,
Client-Secret bleibt am Server. Wird vom Overlay-Service registriert.
"""
from flask import Blueprint, g, jsonify, abort, request, current_app

from webcore import twitch_client
from webcore.middleware import _get_conn


bp_twitch = Blueprint("twitch", __name__)


def _tenant_creds(tenant_id: int):
    from core import credentials as core_creds
    conn = _get_conn()
    try:
        return core_creds.get(conn, tenant_id)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()


@bp_twitch.route("/s/<token>/api/twitch/clips")
def clips(token):
    if g.tenant_id is None:
        abort(404)
    creds = _tenant_creds(g.tenant_id)
    if not (creds.twitch_client_id and creds.twitch_client_secret
            and creds.twitch_channel):
        return jsonify({"clips": []})
    count = request.args.get("count", type=int) or 100
    data = twitch_client.get_clips(
        creds.twitch_client_id, creds.twitch_client_secret,
        creds.twitch_channel, count=count)
    return jsonify({"clips": data})
