"""Freischaltungen je Tenant: welche Extras ein Tenant bekommt, entscheidet nur der Admin
(/admin/users). Gespeichert als JSON-Liste in settings['features']; die Browser-Sources
bekommen sie als window.__FEATURES__ (overlay_app/views_overlays.py)."""
import json

# Schlüssel → Bezeichnung im Admin (englisch, wie das übrige Frontend)
FEATURES = {
    "ducks": "Rubber ducks (all duck effects, !outfit)",
    "sushi-eater": "Eater duck in the sushi rain (needs ducks)",
}
KEY = "features"


def parse(raw) -> list:
    """Gespeicherten Wert lesen: nur bekannte Schlüssel, ohne Doppelte, sortiert."""
    try:
        val = json.loads(raw) if raw else []
    except (TypeError, ValueError):
        return []
    if not isinstance(val, list):
        return []
    return sorted({k for k in val if isinstance(k, str) and k in FEATURES})


def enabled(conn, tenant_id: int) -> list:
    from pubg.db_pg import get_setting
    return parse(get_setting(conn, tenant_id, KEY, None))


def set_enabled(conn, tenant_id: int, keys) -> list:
    from pubg.db_pg import set_setting
    clean = parse(json.dumps(list(keys or [])))
    set_setting(conn, tenant_id, KEY, json.dumps(clean))
    return clean


def all_enabled(conn) -> dict:
    """{tenant_id: [features]} für die Admin-Übersicht."""
    with conn.cursor() as cur:
        cur.execute("SELECT tenant_id, value FROM settings WHERE key = %s", (KEY,))
        return {r["tenant_id"]: parse(r["value"]) for r in cur.fetchall()}


def is_admin_tenant(conn, tenant_id: int) -> bool:
    """Gehört der Tenant einem Admin? Der bekommt alles, ohne Häkchen."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT u.is_admin FROM tenants t JOIN users u ON u.id = t.owner_user_id "
                        "WHERE t.id = %s", (tenant_id,))
            r = cur.fetchone()
        return bool(r and r.get("is_admin"))
    except Exception:
        return False   # im Zweifel nichts extra freischalten, Source läuft trotzdem


def effective(conn, tenant_id: int) -> list:
    """Was die Sources bekommen: Admin-Tenant alles, sonst die Freischaltungen."""
    if is_admin_tenant(conn, tenant_id):
        return sorted(FEATURES)
    return enabled(conn, tenant_id)
