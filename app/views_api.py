"""API-Routes — sowohl /api/* (Cookie) als auch /s/<token>/api/* (Token).

Beide Routen-Familien rufen dieselben Handler — die Middleware hat
g.tenant_id schon gesetzt, wir reichen es einfach durch.

Spec-2 Task 9: Stub-Implementation. Echte EndpointRegistry-Wiring kommt in
Task 10 (serve.py rewrite).
"""
from flask import Blueprint, g, jsonify, abort


bp_api = Blueprint("api", __name__)


def _dispatch(path: str, tenant_id: int):
    """Routet API-Pfad zur richtigen Domain.

    In Task 10 wird das mit echter EndpointRegistry verkabelt. Aktuell:
    Stub-Handler fuer Tests/Smoke."""
    parts = path.strip("/").split("/")
    if len(parts) >= 2 and parts[0] == "pubg" and parts[1] == "healthz-tenant":
        return {"tenant_id": tenant_id, "domain": "pubg"}
    if len(parts) >= 2 and parts[0] == "steam" and parts[1] == "healthz-tenant":
        return {"tenant_id": tenant_id, "domain": "steam"}
    abort(501)


@bp_api.route("/api/<path:apipath>", methods=["GET", "POST"])
def cookie_api(apipath):
    if g.user is None or not g.user["is_approved"]:
        return jsonify({"error": "unauthenticated"}), 401
    if g.tenant_id is None:
        return jsonify({"error": "no_tenant"}), 401
    return jsonify(_dispatch(apipath, g.tenant_id))


@bp_api.route("/s/<token>/api/<path:apipath>", methods=["GET", "POST"])
def token_api(token, apipath):
    if g.tenant_id is None:
        abort(404)
    return jsonify(_dispatch(apipath, g.tenant_id))
