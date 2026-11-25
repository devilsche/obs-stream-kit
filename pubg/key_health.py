"""Zustand des eigenen PUBG-API-Keys je Tenant.

Der Poller ordnet nach jedem Durchlauf seine Fehler ein und merkt sich den Zustand in
settings['pubg_key_health'] = {"state": "ok"|"limit"|"invalid", "since": ISO-Zeit}:

  invalid — PUBG antwortet mit 401: Der Key ist ungültig, abgelaufen oder gelöscht.
  limit   — 429: Der Key ist gültig, aber sein Kontingent (10 Abfragen pro Minute) ist leer.
  ok      — sonst.

Ist der eigene Key ungültig, gibt es keine neuen Session-Reports mehr (pubg/endpoints.py). Ältere
Zeiträume, die vor dem Ausfall endeten, bleiben lesbar. Fremde Keys springen nicht ein.
"""
import json
from datetime import datetime, timezone

KEY = "pubg_key_health"

MESSAGES = {
    "invalid": "PUBG API key invalid or expired. Create a new key at developer.pubg.com and enter it under "
               "Settings. New reports stay locked until then.",
    "limit": "PUBG API key is valid, but its rate limit is used up (10 requests per minute). "
             "New matches may arrive with a delay.",
}


def classify(errors) -> str:
    """Fehlertexte eines Poller-Durchlaufs → invalid | limit | ok."""
    texts = [str(e) for e in (errors or [])]
    if any("HTTP 401" in t for t in texts):
        return "invalid"
    if any("Rate-Limit" in t or "HTTP 429" in t for t in texts):
        return "limit"
    return "ok"


def _now_iso(now=None) -> str:
    now = now or datetime.now(timezone.utc)
    return now.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def get(conn, tenant_id: int) -> dict:
    from pubg.db_pg import get_setting
    try:
        val = json.loads(get_setting(conn, tenant_id, KEY, None) or "{}")
    except (TypeError, ValueError):
        val = {}
    if not isinstance(val, dict) or val.get("state") not in ("ok", "limit", "invalid"):
        return {"state": "ok", "since": None}
    return {"state": val["state"], "since": val.get("since")}


def record(conn, tenant_id: int, state: str, now=None) -> dict:
    """Zustand speichern; „since“ bleibt stehen, solange sich der Zustand nicht ändert."""
    from pubg.db_pg import set_setting
    old = get(conn, tenant_id)
    if old["state"] == state and old.get("since"):
        return old
    new = {"state": state, "since": _now_iso(now)}
    set_setting(conn, tenant_id, KEY, json.dumps(new))
    return new


def blocks_report(health: dict, range_to) -> bool:
    """Neuer Report gesperrt? Nur bei ungültigem Key und nur für Zeiträume, die nach dem Ausfall enden
    (ohne „to“ = bis jetzt). range_to: ISO-Zeit oder None."""
    if (health or {}).get("state") != "invalid":
        return False
    since = health.get("since")
    if not range_to or not since:
        return True
    try:
        to = datetime.fromisoformat(str(range_to).replace("Z", "+00:00"))
        if to.tzinfo is None:
            to = to.replace(tzinfo=timezone.utc)
        return to > datetime.fromisoformat(since.replace("Z", "+00:00"))
    except ValueError:
        return True
