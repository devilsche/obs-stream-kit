"""API-Routes — sowohl /api/* (Cookie) als auch /s/<token>/api/* (Token).

Beide Routen-Familien rufen dieselben Handler — die Middleware hat
g.tenant_id schon gesetzt, wir reichen es einfach durch.

Spec-2 Task 10: per-request EndpointRegistry-Konstruktion. Tradeoff:
- pro: kein Cross-Tenant-Leak im Cache, simples Wiring ohne grossen
  Refactor der Registry-Klassen (Task 9 hat tenant_id auf self gepackt).
- contra: Cache wird pro Request neu aufgebaut → effektiv aus. Fuer
  Spec 2 (1-few tenants) OK; Spec 3 kann Tenant-aware shared Cache.
"""
from flask import Blueprint, g, jsonify, abort, request, current_app

from app.middleware import _get_conn


bp_api = Blueprint("api", __name__)


def _build_pubg_registry(tenant_id):
    """Frische EndpointRegistry pro Request. Cache=None, Client=None —
    Endpoints lesen aus der DB und brauchen den Poll-Client nicht."""
    from pubg.endpoints import EndpointRegistry
    return EndpointRegistry(
        get_conn=lambda: _get_conn(),
        my_account_id=None,
        platform=None,
        cache=None,
        client=None,
        poller_status=lambda: {"running": False},
        tenant_id=tenant_id,
    )


def _build_steam_registry(tenant_id):
    """Frische SteamEndpointRegistry pro Request."""
    from steam.endpoints import SteamEndpointRegistry
    return SteamEndpointRegistry(
        client=None,
        db_connect_fn=lambda: _get_conn(),
        poller=None,
        root_dir=current_app.config.get("_PROJECT_ROOT") or ".",
        tenant_id=tenant_id,
    )


def _dispatch(path: str, tenant_id: int, method: str = "GET",
              body: bytes = b""):
    """Routet /pubg/<sub> oder /steam/<sub> zur richtigen Registry.

    Returns (body_bytes_or_dict, status_int, content_type_str)."""
    parts = path.strip("/").split("/")
    if len(parts) < 1 or not parts[0]:
        abort(404)
    domain = parts[0]

    # Tenant-Healthcheck (Task 9 Stub bleibt fuer Tests)
    if len(parts) >= 2 and parts[1] == "healthz-tenant":
        return ({"tenant_id": tenant_id, "domain": domain},
                200, "application/json")

    full_path = "/api/" + "/".join(parts)
    if domain == "pubg":
        try:
            reg = _build_pubg_registry(tenant_id)
            return reg.dispatch(method, full_path, body,
                                dict(request.headers))
        except Exception as e:  # noqa: BLE001
            current_app.logger.exception("pubg dispatch failed")
            return ({"error": f"pubg_dispatch_failed: {e}"}, 500,
                    "application/json")
    elif domain == "steam":
        try:
            reg = _build_steam_registry(tenant_id)
            return reg.dispatch(method, full_path, body,
                                dict(request.headers))
        except Exception as e:  # noqa: BLE001
            current_app.logger.exception("steam dispatch failed")
            return ({"error": f"steam_dispatch_failed: {e}"}, 500,
                    "application/json")

    abort(404)


def _respond(result):
    """dispatch() liefert (body, status, content_type). body kann bytes
    (JSON-encoded) oder dict (unser healthz-Stub) sein."""
    body, status, content_type = result
    if isinstance(body, (bytes, str)):
        return (body, status, {"Content-Type": content_type
                               or "application/json"})
    return jsonify(body), status


@bp_api.route("/api/<path:apipath>", methods=["GET", "POST"])
def cookie_api(apipath):
    if g.user is None or not g.user.get("is_approved"):
        return jsonify({"error": "unauthenticated"}), 401
    if g.tenant_id is None:
        return jsonify({"error": "no_tenant"}), 401
    return _respond(_dispatch(apipath, g.tenant_id,
                              method=request.method,
                              body=request.get_data() or b""))


@bp_api.route("/s/<token>/api/<path:apipath>", methods=["GET", "POST"])
def token_api(token, apipath):
    if g.tenant_id is None:
        abort(404)
    return _respond(_dispatch(apipath, g.tenant_id,
                              method=request.method,
                              body=request.get_data() or b""))
