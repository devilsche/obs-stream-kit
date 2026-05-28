"""API-Routes — sowohl /api/* (Cookie) als auch /s/<token>/api/* (Token).

Beide Routen-Familien rufen dieselben Handler — die Middleware hat
g.tenant_id schon gesetzt, wir reichen es einfach durch.

Cache: module-level shared TTLCache, aber jeder Tenant kriegt einen
Prefix-Wrapper. So bleibt das Speed-Win zwischen Requests erhalten
ohne Cross-Tenant-Lecks (Tenant 1's Keys: 't1:...', Tenant 2's: 't2:...').
"""
from flask import Blueprint, g, jsonify, abort, request, current_app

from app.middleware import _get_conn


bp_api = Blueprint("api", __name__)


# Process-global TTL-Cache. Wird beim Server-Start einmal erzeugt und
# zwischen ALLEN Requests geteilt. Tenant-Trennung passiert via Prefix-Wrapper.
_SHARED_PUBG_CACHE = None
_SHARED_STEAM_CACHE = None


def _shared_pubg_cache():
    global _SHARED_PUBG_CACHE
    if _SHARED_PUBG_CACHE is None:
        from pubg.cache import TTLCache
        _SHARED_PUBG_CACHE = TTLCache(ttl_secs=30)
    return _SHARED_PUBG_CACHE


def _shared_steam_cache():
    global _SHARED_STEAM_CACHE
    if _SHARED_STEAM_CACHE is None:
        from pubg.cache import TTLCache
        _SHARED_STEAM_CACHE = TTLCache(ttl_secs=30)
    return _SHARED_STEAM_CACHE


class _TenantPrefixCache:
    """Cache-Wrapper der allen keys einen tenant-spezifischen Prefix
    voranstellt. So koennen mehrere Tenants denselben TTLCache nutzen,
    ohne sich gegenseitig zu sehen."""

    __slots__ = ("_u", "_p")

    def __init__(self, underlying, tenant_id: int):
        self._u = underlying
        self._p = f"t{tenant_id}:"

    def get(self, key):
        return self._u.get(self._p + key)

    def set(self, key, value, ttl=None):
        return self._u.set(self._p + key, value, ttl=ttl)

    def get_or_compute(self, key, compute_fn, ttl=None):
        return self._u.get_or_compute(self._p + key, compute_fn, ttl=ttl)

    def invalidate(self, key=None):
        if key is None:
            # Nur eigene tenant-Eintraege loeschen — andere Tenants unangetastet
            doomed = [k for k in list(self._u._store) if k.startswith(self._p)]
            for k in doomed:
                self._u._store.pop(k, None)
        else:
            self._u.invalidate(self._p + key)


def _build_pubg_registry(tenant_id):
    """Frische EndpointRegistry pro Request, aber Cache ist process-shared
    mit Tenant-Prefix. Credentials kommen pro Request frisch aus DB."""
    from pubg.endpoints import EndpointRegistry
    from core import credentials as core_creds
    conn = _get_conn()
    try:
        creds = core_creds.get(conn, tenant_id)
    finally:
        conn.close()
    return EndpointRegistry(
        get_conn=lambda: _get_conn(),
        my_account_id=creds.pubg_account_id,
        platform=creds.pubg_platform or "steam",
        cache=_TenantPrefixCache(_shared_pubg_cache(), tenant_id),
        client=None,
        poller_status=lambda: {"running": False},
        tenant_id=tenant_id,
    )


def _build_steam_registry(tenant_id):
    """Frische SteamEndpointRegistry pro Request, shared cache."""
    from steam.endpoints import SteamEndpointRegistry
    from steam.api_client import SteamClient
    from core import credentials as core_creds
    conn = _get_conn()
    try:
        creds = core_creds.get(conn, tenant_id)
    finally:
        conn.close()
    client = None
    if creds.steam_api_key and creds.steam_id:
        client = SteamClient(api_key=creds.steam_api_key,
                             steam_id=creds.steam_id,
                             language="english")
    return SteamEndpointRegistry(
        client=client,
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
    # Query-String wieder anhaengen — die Endpoint-Klasse erwartet einen
    # urlparse-baren Pfad und liest qs aus dem Query-Teil.
    if request.query_string:
        full_path = full_path + "?" + request.query_string.decode("utf-8")
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
