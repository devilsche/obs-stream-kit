"""Status-Uebersichten fuer das Dashboard.

- Admin: eine Zeile je Tenant (Matches, letztes Match, Keys, Poller-Zustand,
  ausstehende Telemetrie) plus System-Kennzahlen (DB, Platte, Tabellen).
- Tenant: dieselben Werte fuer den eigenen Tenant als Status-Kachel.

Die Poller laufen im API-Service (serve_api.py, :9002), das Dashboard im
Frontend-Prozess (serve.py, :9000) — dort ist `_pubg_poller` None. Der
Zustand kommt deshalb ueber den internen Endpoint /internal/status des
API-Service; im lokalen Einzelprozess direkt aus dem eigenen Prozess.
"""
import datetime
import json
import os
import shutil
import urllib.request

API_INTERNAL_URL = os.environ.get("OBS_KIT_API_INTERNAL_URL",
                                  "http://127.0.0.1:9002")

# Telemetrie liefert PUBG rund 14 Tage — aelter fehlende kommt nicht mehr.
TELEMETRY_WINDOW_DAYS = 14


# ── Poller-Zustand ──────────────────────────────────────────────────────────

def _in_process():
    """Zustand aus dem eigenen Prozess, wenn die Poller hier laufen."""
    from app.poller_startup import _pubg_poller, _steam_poller
    if _pubg_poller is None and _steam_poller is None:
        return None
    pubg = _pubg_poller.status() if _pubg_poller is not None else {}
    steam = _steam_poller.status_all() if _steam_poller is not None else {}
    return {"pubg": pubg, "steam": steam}


def _fetch_internal():
    with urllib.request.urlopen(API_INTERNAL_URL + "/internal/status",
                                timeout=2) as r:
        return json.loads(r.read().decode("utf-8"))


def poller_status() -> dict:
    """{"pubg": {...}, "steam": {tid: {...}}, "reachable": bool} — Tenant-
    Schluessel immer als String (JSON liefert Strings, der Prozess ints)."""
    try:
        raw = _in_process() or _fetch_internal()
    except Exception:
        return {"pubg": {}, "steam": {}, "reachable": False}
    pubg = dict(raw.get("pubg") or {})
    pubg["perTenant"] = {str(k): v for k, v in
                         (pubg.get("perTenant") or {}).items()}
    steam = {str(k): v for k, v in (raw.get("steam") or {}).items()}
    return {"pubg": pubg, "steam": steam, "reachable": True}


# ── Datenbank ───────────────────────────────────────────────────────────────

def _iso_days_ago(days: int) -> str:
    dt = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def tenant_overview(conn, tenant_id=None) -> list:
    """Eine Zeile je Tenant (oder nur `tenant_id`)."""
    where, params = "", [_iso_days_ago(7), _iso_days_ago(TELEMETRY_WINDOW_DAYS)]
    if tenant_id is not None:
        where = "WHERE t.id = %s"
        params.append(tenant_id)
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT t.id, t.slug, t.display_name AS tenant_name,
                   u.display_name AS owner,
                   (SELECT max(s.last_seen_at) FROM user_sessions s
                     WHERE s.user_id = t.owner_user_id) AS last_seen,
                   c.pubg_name,
                   (c.pubg_api_key_enc IS NOT NULL) AS pubg_key,
                   (c.steam_api_key_enc IS NOT NULL
                    AND c.steam_id IS NOT NULL) AS steam_key,
                   ms.matches, ms.matches_7d, ms.last_match, ms.telemetry_pending
            FROM tenants t
            LEFT JOIN users u ON u.id = t.owner_user_id
            LEFT JOIN tenant_credentials c ON c.tenant_id = t.id
            LEFT JOIN LATERAL (
                SELECT count(*) AS matches,
                       count(*) FILTER (WHERE m.played_at >= %s) AS matches_7d,
                       max(m.played_at) AS last_match,
                       count(*) FILTER (WHERE m.played_at >= %s
                                        AND COALESCE(m.telemetry_fetched, 0) = 0)
                           AS telemetry_pending
                FROM matches m WHERE m.tenant_id = t.id
            ) ms ON TRUE
            {where}
            ORDER BY t.id
        """, params)
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["pubg_key"] = bool(r["pubg_key"])
        r["steam_key"] = bool(r["steam_key"])
    return rows


def merge_status(rows: list, status: dict) -> list:
    """Poller-Zustand an die Tenant-Zeilen haengen.

    pubg_state/steam_state: ok | error | warn | skip | unknown
    pubg_detail/steam_detail: Fehlertext bzw. Hinweis.
    """
    per = (status.get("pubg") or {}).get("perTenant") or {}
    steam = status.get("steam") or {}
    for r in rows:
        p = per.get(str(r["id"]))
        if not p:
            r["pubg_state"], r["pubg_detail"] = "unknown", ""
        elif p.get("polling") == "skip":
            r["pubg_state"] = "skip"
            # Haeufigster Fall: Key eingetragen, aber kein PUBG-Account
            # angelegt — dann weiss der Poller nicht, wen er abfragen soll.
            if r["pubg_key"] and not r.get("pubg_name"):
                r["pubg_detail"] = "key set, but no PUBG account added"
            else:
                r["pubg_detail"] = (p.get("reason") or "").replace("-", " ")
        else:
            errs = p.get("errors") or []
            state = p.get("polling") or "unknown"
            r["pubg_state"] = {"ok": "ok", "degraded": "warn"}.get(state, state)
            if r["pubg_state"] not in ("ok", "warn", "error"):
                r["pubg_state"] = "unknown"
            r["pubg_detail"] = "; ".join(errs[:2])
        s = steam.get(str(r["id"]))
        if not r["steam_key"]:
            r["steam_state"], r["steam_detail"] = "skip", "no key"
        elif not s:
            r["steam_state"], r["steam_detail"] = "unknown", ""
        elif s.get("lastError"):
            r["steam_state"], r["steam_detail"] = "error", s["lastError"]
        else:
            r["steam_state"], r["steam_detail"] = "ok", ""
        r["last_match_ago"] = ago(r.get("last_match"))
        r["last_seen_ago"] = ago(r.get("last_seen"))
    return rows


def system_overview(conn) -> dict:
    out = {}
    with conn.cursor() as cur:
        cur.execute("SELECT pg_size_pretty(pg_database_size(current_database())) AS s")
        out["db_size"] = cur.fetchone()["s"]
        cur.execute("""
            SELECT c.relname AS name,
                   pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
                   s.n_live_tup AS live, s.n_dead_tup AS dead
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
            WHERE n.nspname = current_schema() AND c.relkind = 'r'
            ORDER BY pg_total_relation_size(c.oid) DESC
            LIMIT 6
        """)
        out["tables"] = []
        for r in cur.fetchall():
            live, dead = r["live"] or 0, r["dead"] or 0
            out["tables"].append({
                "name": r["name"], "size": r["size"],
                "dead_pct": round(100.0 * dead / (live + dead)) if live + dead else 0,
            })
        cur.execute("SELECT count(*) FILTER (WHERE NOT is_approved) AS c FROM users")
        out["users_pending"] = cur.fetchone()["c"]
    try:
        du = shutil.disk_usage("/")
        out["disk_free"] = f"{du.free / 1024**3:.0f} GB"
        out["disk_used_pct"] = round(100.0 * du.used / du.total)
    except OSError:
        out["disk_free"], out["disk_used_pct"] = "—", None
    return out


# ── Anzeige ─────────────────────────────────────────────────────────────────

def ago(value) -> str:
    """'5 min ago' / '2 h ago' / '3 days ago' aus ISO-String oder datetime."""
    if not value:
        return "—"
    if isinstance(value, str):
        try:
            value = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return "—"
    if value.tzinfo is None:
        value = value.replace(tzinfo=datetime.timezone.utc)
    secs = (datetime.datetime.now(datetime.timezone.utc) - value).total_seconds()
    if secs < 90:
        return "just now"
    if secs < 3600:
        return f"{int(secs // 60)} min ago"
    if secs < 2 * 86400:
        return f"{int(secs // 3600)} h ago"
    return f"{int(secs // 86400)} days ago"
