"""Friend: Wer im Chat Befehle geben darf (!pet, !sitz, !pfote, !komm, !bell).

Liste je Tenant in settings['friend_allow'] (JSON-Liste kleingeschriebener Twitch-Namen), im Dashboard gepflegt
(Friend-Karte → Chat commands). Streamer.bot schickt den Chat-Namen als user=%user% mit; ohne user (Dashboard-Test,
weitergereichte Alerts) gilt der Befehl immer. Der Kanalinhaber darf immer.
"""
import json
import re

SETTING = "friend_allow"
MAX_NAMES = 200
_NAME = re.compile(r"^[a-z0-9_]{1,25}$")


def clean(raw) -> list:
    """Text oder Liste → eindeutige, gültige Twitch-Namen (klein, ohne @), Reihenfolge bleibt."""
    parts = raw if isinstance(raw, list) else re.split(r"[\s,;]+", str(raw or ""))
    out = []
    for p in parts:
        n = str(p).strip().lstrip("@").lower()
        if _NAME.match(n) and n not in out:
            out.append(n)
    return out[:MAX_NAMES]


def load(conn, tenant_id) -> list:
    from pubg.db_pg import get_setting
    try:
        return clean(json.loads(get_setting(conn, tenant_id, SETTING, "") or "[]"))
    except ValueError:
        return []


def save(conn, tenant_id, names) -> list:
    from pubg.db_pg import set_setting
    names = clean(names)
    set_setting(conn, tenant_id, SETTING, json.dumps(names))
    return names


def allowed(names, owner, user) -> bool:
    user = str(user or "").strip().lstrip("@").lower()
    if not user:
        return True
    return user == str(owner or "").lower() or user in names
