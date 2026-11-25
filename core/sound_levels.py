"""Gesamtlautstärke je Tenant für Memes/Effekte und Alerts (Dashboard → Settings → Sound).

settings['sound_levels'] = {"memes": 0.5, "alerts": 0.5}. Der Server injiziert den passenden Wert als
window.__SOUND_LEVEL__ in jede Token-Quelle; js/stinger-ready.js, js/stinger-kit.js, js/alert-sound.js und die
Effekte multiplizieren ihn auf ihre eigene Lautstärke. So bleiben alle OBS-Regler auf 100 %.
"""
import json

GROUPS = ("memes", "alerts")
DEFAULT = 0.5
STEPS = (0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)
SETTING = "sound_levels"


def load(conn, tenant_id):
    from pubg.db_pg import get_setting
    try:
        raw = json.loads(get_setting(conn, tenant_id, SETTING, "") or "{}")
    except ValueError:
        raw = {}
    out = {}
    for g in GROUPS:
        try:
            out[g] = max(0.0, min(1.0, float(raw.get(g, DEFAULT))))
        except (TypeError, ValueError, AttributeError):
            out[g] = DEFAULT
    return out


def save(conn, tenant_id, values):
    from pubg.db_pg import set_setting
    cur = load(conn, tenant_id)
    for g in GROUPS:
        try:
            v = float(values.get(g))
        except (TypeError, ValueError):
            continue
        cur[g] = max(0.0, min(1.0, v))
    set_setting(conn, tenant_id, SETTING, json.dumps(cur))
    return cur


def group_for(subdir):
    """Welche Lautstärke für welche Quelle gilt."""
    return {"alerts": "alerts", "stingers": "memes", "effects": "memes", "transitions": "memes"}.get(subdir)
