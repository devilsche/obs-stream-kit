"""TeamSpeak Widget Config — laed Host/Port/Streamer-Settings + API-Key.

Secrets-Eintrag: `TS3-ClientQuery-Key: <key>` (auch `TS3 ClientQuery Key`
mit Spaces wird akzeptiert).
"""
import json
import os

DEFAULTS = {
    "host": "127.0.0.1",
    "port": 25639,
    # streamerTsUid kann leer bleiben — wird beim ersten Connect
    # automatisch ermittelt (whoami) und in DB persistiert.
    "streamerTsUid": "",
    # Hysterese — wie lange ein "stopped talking" verzoegert wird.
    # 150ms reicht damit Mikropausen nicht ans Stoppen koppeln, sub-200ms
    # 'ja'/'ok' bleiben aber sichtbar.
    "talkingTailMs": 150,
}


def load_config(path: str) -> dict:
    cfg = dict(DEFAULTS)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            cfg.update(json.load(f))
    return cfg


def load_api_key(secrets_path: str) -> str | None:
    """Liest den TS3-ClientQuery-API-Key aus .secrets. Toleriert die
    Schreibvarianten 'TS3-ClientQuery-Key', 'TS3 ClientQuery Key',
    'Teamspeak API Key' (Legacy aus alter Skizze)."""
    if not os.path.exists(secrets_path):
        return None
    accept = {
        "ts3 clientquery key",
        "teamspeak clientquery key",
        "teamspeak api key",
    }
    with open(secrets_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            normalized = key.strip().lower().replace("-", " ")
            if normalized in accept:
                return value.strip()
    return None
