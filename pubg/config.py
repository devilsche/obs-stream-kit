import json
import os

DEFAULTS = {
    "playerName": "",
    "platform": "steam",
    "stammCrew": [],
    "pollIntervalSec": 60,
    "minMatchesForLifetime": 5,
    "minMatchesForTopMates": 10,
}


def load_config(path: str) -> dict:
    """Loads config/pubg.json. Falls back to DEFAULTS, but the
    PUBG-Backend won't start without playerName set.

    Provide config/pubg.example.json as template — copy to
    config/pubg.json and fill in your PUBG nickname + platform."""
    cfg = dict(DEFAULTS)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            cfg.update(json.load(f))
    return cfg


def load_api_key(secrets_path: str) -> str | None:
    """Read the PUBG API key. Accepts both 'PUBG-API-Key:' and 'PUBG API Key:'
    spellings (dashes or spaces, case-insensitive)."""
    if not os.path.exists(secrets_path):
        return None
    with open(secrets_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            normalized = key.strip().lower().replace("-", " ")
            if normalized == "pubg api key":
                return value.strip()
    return None
