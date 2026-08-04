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


def _owner_twitch_id(tenant_id: int):
    """Twitch-User-ID des Tenant-Owners = broadcaster_id fuer den Clip-Abruf."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT u.twitch_user_id
                FROM tenants t JOIN users u ON u.id = t.owner_user_id
                WHERE t.id = %s
            """, (tenant_id,))
            row = cur.fetchone()
        return (row and row["twitch_user_id"]) or None
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()


@bp_twitch.route("/s/<token>/api/twitch/clips")
def clips(token):
    if g.tenant_id is None:
        abort(404)
    from webcore.config import Config
    creds = _tenant_creds(g.tenant_id)
    # App-Credentials duerfen global sein (eine Twitch-App fuer alle Tenants),
    # der Channel NICHT — sonst sehen fremde Tenants die Clips des Admins.
    client_id     = creds.twitch_client_id     or Config.TWITCH_CLIENT_ID
    client_secret = creds.twitch_client_secret  or Config.TWITCH_CLIENT_SECRET
    channel = creds.twitch_channel
    # Explizit gesetzter Channel gewinnt (erlaubt Clips eines fremden Kanals),
    # sonst die Twitch-ID des Owners.
    broadcaster_id = None if channel else _owner_twitch_id(g.tenant_id)
    if not channel and not broadcaster_id and g.tenant_id == 1:
        channel = Config.TWITCH_CHANNEL  # Admin-Tenant vor OAuth-Claim
    if not (client_id and client_secret) or not (channel or broadcaster_id):
        return jsonify({"clips": []})
    count = request.args.get("count", type=int) or 100
    data = twitch_client.get_clips(client_id, client_secret, channel,
                                   count=count, broadcaster_id=broadcaster_id)
    return jsonify({"clips": data})
