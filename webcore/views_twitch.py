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
    from webcore.config import Config
    creds = _tenant_creds(g.tenant_id)
    # Per-tenant credentials → fall back to global .secrets
    client_id     = creds.twitch_client_id     or Config.TWITCH_CLIENT_ID
    client_secret = creds.twitch_client_secret  or Config.TWITCH_CLIENT_SECRET
    channel       = creds.twitch_channel        or Config.TWITCH_CHANNEL
    if not (client_id and client_secret and channel):
        return jsonify({"clips": []})
    count = request.args.get("count", type=int) or 100
    data = twitch_client.get_clips(client_id, client_secret, channel, count=count)
    return jsonify({"clips": data})
