import json
import os

DEFAULTS = {
    "playerName": "PEX_LuCKoR",
    "platform": "steam",
    "stammCrew": [],
    "pollIntervalSec": 60,
    "minMatchesForLifetime": 5,
    "minMatchesForTopMates": 10,
}


def load_config(path: str) -> dict:
    cfg = dict(DEFAULTS)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            cfg.update(json.load(f))
    return cfg


def load_api_key(secrets_path: str) -> str | None:
    if not os.path.exists(secrets_path):
        return None
    with open(secrets_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("PUBG-API-Key:"):
                return line.split(":", 1)[1].strip()
    return None
