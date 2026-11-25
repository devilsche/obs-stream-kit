"""Freischaltungen je Tenant: welche Extras ein Tenant bekommt, entscheidet nur der Admin
(/admin/users). Gespeichert als JSON-Liste in settings['features']; die Browser-Sources
bekommen sie als window.__FEATURES__ (overlay_app/views_overlays.py)."""
import json

# Schlüssel → Bezeichnung im Admin (englisch, wie das übrige Frontend)
FEATURES = {
    "pubg": "PUBG (stats widgets, session report, PUBG tools)",
    "g1r": "Gothic 1 Remake (live data widgets and tools)",
    "weather": "Weather (weather scene, seasonal decoration, weather commands, weather dock)",
    "race": "Race (Car Race, Car Drive, item rain, burnout)",
    "ducks": "Rubber ducks (all duck effects, !outfit)",
    "sushi-eater": "Eater duck in the sushi rain (needs ducks)",
    "bmw-driver": "Driver duck in the BMW rain (needs ducks)",
    "duck-vacuum": "Vacuum duck cleans up after every rain (needs ducks)",
    "friend": "Friend (animated dog that roams the stream and reacts to alerts and chat)",
}
KEY = "features"

# Sonderpunkte im Dashboard (Hauptpunkte Stream und Steam hat jeder): eigene goldene Reiter in dieser
# Reihenfolge, ohne Freischaltung unsichtbar
EXTRAS = ("pubg", "g1r", "race", "ducks", "weather", "friend")
EXTRA_LABELS = {"pubg": "PUBG", "g1r": "Gothic 1", "race": "Race", "ducks": "Ducks", "weather": "Weather", "friend": "Friend"}
# Werkzeuge dieser Sonderpunkte stehen zusätzlich als Karten in ihrem Reiter
TOOL_CARD_EXTRAS = ("race", "ducks", "weather")

# Gilt, solange der Admin für einen Tenant noch nichts gespeichert hat (PUBG ist derzeit für alle frei)
DEFAULT_ON = ("pubg",)

# OBS-Quelle (effects/<datei>) → nötige Freischaltung; ohne sie liefert der Server eine leere Seite
SOURCE_FEATURE = {
    **{f: "weather" for f in ("weather.html", "rain.html", "snow.html", "xmas.html", "autumn.html",
                              "winter.html", "spring.html", "summer.html")},
    **{f: "race" for f in ("car-race.html", "car-burnout.html", "item-rain.html")},
    **{f: "ducks" for f in ("knife-duck.html", "duck-greet.html", "duck-parade.html", "duck-assembly.html",
                            "duck-court.html")},
    "friend.html": "friend",
}

# Erstes Pfadstück hinter /api/fx/ → nötige Freischaltung (Enten prüft fx/endpoints.py selbst)
API_FEATURE = {
    **{k: "weather" for k in ("weather", "rain", "xmas", "autumn", "winter", "spring", "summer")},
    **{k: "race" for k in ("car-race", "car-drive", "cars", "track-props", "track-ads", "track-ads.json")},
    "friend": "friend",
}


def source_feature(filename):
    return SOURCE_FEATURE.get(filename)


def api_feature(rest):
    """rest = Pfad hinter /api/fx/, z. B. "weather/state" oder "car-race"."""
    return API_FEATURE.get((rest or "").split("/", 1)[0])


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
    raw = get_setting(conn, tenant_id, KEY, None)
    return sorted(DEFAULT_ON) if raw is None else parse(raw)


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


_cache = {}
CACHE_S = 10


def effective_cached(load, tenant_id: int, now=None) -> list:
    """Wie effective(), aber je Tenant 10 s gemerkt – für Endpunkte, die OBS sekündlich abfragt.
    load() liefert die frische Liste (holt sich die DB-Verbindung selbst)."""
    import time
    now = time.time() if now is None else now
    hit = _cache.get(tenant_id)
    if hit and now - hit[0] < CACHE_S:
        return hit[1]
    val = load()
    _cache[tenant_id] = (now, val)
    return val


def effective(conn, tenant_id: int) -> list:
    """Was die Sources bekommen: Admin-Tenant alles, sonst die Freischaltungen."""
    if is_admin_tenant(conn, tenant_id):
        return sorted(FEATURES)
    return enabled(conn, tenant_id)
