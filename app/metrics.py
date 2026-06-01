"""Prometheus-Metriken fuer obs-stream-kit.

Definiert alle Metrik-Objekte zentral, registriert sie an einer eigenen
Registry (nicht default — Multi-Process-Sicherheit). Stellt einen
/metrics-Endpoint und Flask-Hooks bereit.

Exponiert:
- HTTP: request count + Histogramm-Latenz pro (path, method, status, tenant)
- Externe APIs: PUBG/Steam call count + Histogramm-Latenz pro (provider, endpoint, status)
- Tenant-Anzahl, Pollers-Status, DB-Connection-Errors
"""
from __future__ import annotations

import re
import time
from typing import Optional

from flask import Flask, Response, g, request
from prometheus_client import (
    CollectorRegistry, Counter, Gauge, Histogram,
    generate_latest, CONTENT_TYPE_LATEST,
)

REGISTRY = CollectorRegistry()

# ── HTTP-Metriken ───────────────────────────────────────────────────────────
# Labels:
#   path     — vereinheitlicht (Token + IDs durch :token / :id ersetzt)
#   method   — GET/POST/...
#   status   — String der HTTP-Statuscode
#   tenant   — tenant_id oder 'anon'
http_requests_total = Counter(
    "obs_http_requests_total",
    "Total HTTP requests handled by obs-stream-kit",
    ["path", "method", "status", "tenant"],
    registry=REGISTRY,
)
http_request_duration_ms = Histogram(
    "obs_http_request_duration_ms",
    "HTTP request latency in milliseconds",
    ["path", "method", "tenant"],
    buckets=(1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000),
    registry=REGISTRY,
)
http_requests_in_progress = Gauge(
    "obs_http_requests_in_progress",
    "Number of HTTP requests currently being processed",
    ["path", "method"],
    registry=REGISTRY,
)

# ── Externe API ─────────────────────────────────────────────────────────────
external_api_calls_total = Counter(
    "obs_external_api_calls_total",
    "Total external API calls (PUBG, Steam)",
    ["provider", "endpoint", "status"],
    registry=REGISTRY,
)
external_api_duration_ms = Histogram(
    "obs_external_api_duration_ms",
    "External API call latency in milliseconds",
    ["provider", "endpoint"],
    buckets=(10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000),
    registry=REGISTRY,
)

# ── Tenants & Pollers ───────────────────────────────────────────────────────
tenants_total = Gauge(
    "obs_tenants_total",
    "Number of tenants currently in the database",
    registry=REGISTRY,
)
matches_total = Gauge(
    "obs_matches_total",
    "Total matches ingested across all tenants",
    registry=REGISTRY,
)
matches_per_tenant = Gauge(
    "obs_matches_per_tenant",
    "Matches ingested per tenant",
    ["tenant"],
    registry=REGISTRY,
)
players_total = Gauge(
    "obs_players_total",
    "Distinct players (account_ids) known to the database",
    registry=REGISTRY,
)
telemetry_events_by_type = Gauge(
    "obs_telemetry_events_by_type",
    "Telemetry event count per event_type",
    ["event_type"],
    registry=REGISTRY,
)
clans_total = Gauge(
    "obs_clans_total",
    "Distinct clans resolved",
    registry=REGISTRY,
)
db_size_bytes = Gauge(
    "obs_db_size_bytes",
    "Total Postgres database size in bytes (pg_database_size)",
    registry=REGISTRY,
)
db_table_size_bytes = Gauge(
    "obs_db_table_size_bytes",
    "Size in bytes per table including indexes (pg_total_relation_size)",
    ["table"],
    registry=REGISTRY,
)
poller_last_tick_ts = Gauge(
    "obs_poller_last_tick_timestamp_seconds",
    "Unix timestamp of last poller tick per provider+tenant",
    ["provider", "tenant"],
    registry=REGISTRY,
)
db_query_errors_total = Counter(
    "obs_db_query_errors_total",
    "DB query failures",
    ["domain"],
    registry=REGISTRY,
)


# ── Path-Normalisierung (Cardinality-Schutz) ────────────────────────────────
_TOKEN_RE = re.compile(r"/s/[A-Za-z0-9_]+(/|$)")
_UUID_RE = re.compile(
    r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/|$)",
    re.I,
)
_INT_RE = re.compile(r"/\d+(/|$)")
# PUBG-Account-IDs sehen aus wie account.<32hex> oder account.<lange-id>
_ACC_RE = re.compile(r"/account\.[A-Za-z0-9]+(/|$)")


def _normalize_path(path: str) -> str:
    """Path-Template fuer niedrige Cardinality.

    /s/tok_abc/api/pubg/last-match -> /s/:token/api/pubg/last-match
    /admin/users/42/approve         -> /admin/users/:id/approve
    /api/pubg/co-player/account.X   -> /api/pubg/co-player/:account
    """
    p = _TOKEN_RE.sub("/s/:token/", path)
    p = _ACC_RE.sub("/:account/", p)
    p = _UUID_RE.sub("/:uuid/", p)
    p = _INT_RE.sub("/:id/", p)
    # trailing-slash normalisieren
    if len(p) > 1 and p.endswith("/"):
        p = p[:-1]
    return p


# ── Flask-Hooks ─────────────────────────────────────────────────────────────
def register_metrics(app: Flask) -> None:
    """Registriert Request-Timing + /metrics-Endpoint."""

    @app.before_request
    def _metrics_start():
        g._metrics_t0 = time.perf_counter()
        path = _normalize_path(request.path)
        try:
            http_requests_in_progress.labels(path, request.method).inc()
            g._metrics_path = path
        except Exception:
            pass

    @app.after_request
    def _metrics_end(response):
        try:
            path = getattr(g, "_metrics_path", None) or _normalize_path(request.path)
            t0 = getattr(g, "_metrics_t0", None)
            tenant = str(getattr(g, "tenant_id", None) or "anon")
            status = str(response.status_code)
            method = request.method
            http_requests_in_progress.labels(path, method).dec()
            http_requests_total.labels(path, method, status, tenant).inc()
            if t0 is not None:
                dur_ms = (time.perf_counter() - t0) * 1000.0
                http_request_duration_ms.labels(path, method, tenant).observe(dur_ms)
        except Exception:
            pass
        return response

    # DB-Metrics Cache — wird alle 60s aktualisiert. Spart Last bei
    # haeufigeren Prometheus-Scrapes.
    _db_cache = {"updated_at": 0.0}

    def _refresh_db_metrics():
        now = time.time()
        if now - _db_cache["updated_at"] < 60:
            return
        try:
            from app.middleware import _get_conn
            conn = _get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) AS c FROM tenants")
                    tenants_total.set(int((cur.fetchone() or {}).get("c") or 0))
                    cur.execute("SELECT COUNT(*) AS c FROM matches")
                    matches_total.set(int((cur.fetchone() or {}).get("c") or 0))
                    cur.execute(
                        "SELECT tenant_id, COUNT(*) AS c FROM matches "
                        "GROUP BY tenant_id")
                    matches_per_tenant._metrics.clear()
                    for r in cur.fetchall():
                        matches_per_tenant.labels(str(r["tenant_id"])).set(
                            int(r["c"] or 0))
                    cur.execute(
                        "SELECT COUNT(DISTINCT account_id) AS c FROM players")
                    players_total.set(int((cur.fetchone() or {}).get("c") or 0))
                    cur.execute("SELECT COUNT(*) AS c FROM clans")
                    clans_total.set(int((cur.fetchone() or {}).get("c") or 0))
                    cur.execute(
                        "SELECT event_type, COUNT(*) AS c "
                        "FROM telemetry_events GROUP BY event_type")
                    telemetry_events_by_type._metrics.clear()
                    for r in cur.fetchall():
                        telemetry_events_by_type.labels(
                            r["event_type"] or "?").set(int(r["c"] or 0))
                    # DB-Groesse + per-Table-Groesse (inkl. Indexe).
                    # Time-Series in Prometheus → Wachstum-Kurve in Grafana.
                    cur.execute("SELECT pg_database_size(current_database()) AS s")
                    db_size_bytes.set(int((cur.fetchone() or {}).get("s") or 0))
                    cur.execute(
                        "SELECT relname AS table, "
                        "pg_total_relation_size(c.oid) AS s "
                        "FROM pg_class c "
                        "JOIN pg_namespace n ON n.oid = c.relnamespace "
                        "WHERE c.relkind='r' AND n.nspname='obs' "
                        "ORDER BY s DESC")
                    db_table_size_bytes._metrics.clear()
                    for r in cur.fetchall():
                        db_table_size_bytes.labels(r["table"]).set(
                            int(r["s"] or 0))
            finally:
                if "_PG_CONN_FACTORY" not in app.config:
                    conn.close()
            _db_cache["updated_at"] = now
        except Exception:
            db_query_errors_total.labels("metrics").inc()

    @app.route("/metrics")
    def _metrics_endpoint():
        _refresh_db_metrics()
        body = generate_latest(REGISTRY)
        return Response(body, mimetype=CONTENT_TYPE_LATEST)


# ── Decorator/Helper fuer externe API-Calls ─────────────────────────────────
def observe_external(provider: str, endpoint: str):
    """Context-Manager fuer eine externe HTTP-Call-Messung.

    Usage:
        with observe_external("pubg", "lifetime") as obs:
            r = http.get(url)
            obs.set_status(r.status_code)
    """

    class _Obs:
        __slots__ = ("provider", "endpoint", "_t0", "_status")

        def __init__(self, p, e):
            self.provider = p
            self.endpoint = e
            self._t0 = None
            self._status = "exception"

        def __enter__(self):
            self._t0 = time.perf_counter()
            return self

        def set_status(self, status):
            self._status = str(status)

        def __exit__(self, exc_type, exc_val, exc_tb):
            dur_ms = (time.perf_counter() - self._t0) * 1000.0
            try:
                external_api_duration_ms.labels(self.provider, self.endpoint).observe(dur_ms)
                external_api_calls_total.labels(
                    self.provider, self.endpoint, self._status).inc()
            except Exception:
                pass
            return False  # don't swallow exceptions

    return _Obs(provider, endpoint)
