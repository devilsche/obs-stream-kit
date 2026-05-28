"""App-Konfiguration aus Env + .secrets."""
import os
from typing import Optional


def _secret(key: str, secrets_path: str = ".secrets") -> Optional[str]:
    """Liest eine Zeile 'Key: Value' aus .secrets."""
    if not os.path.exists(secrets_path):
        return None
    with open(secrets_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if ":" not in line or line.startswith("#"):
                continue
            k, _, v = line.partition(":")
            if k.strip() == key:
                return v.strip()
    return None


class Config:
    SECRET_KEY = os.environ.get("OBS_KIT_FLASK_SECRET") or _secret("Flask Secret-Key") or "DEV-INSECURE-CHANGE-IN-PROD"
    SESSION_COOKIE_NAME = "obskit_csrf"
    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"

    TWITCH_CLIENT_ID = _secret("Twitch App Client-ID")
    TWITCH_CLIENT_SECRET = _secret("Twitch App Client-Secret")
    TWITCH_REDIRECT_URI = os.environ.get("OBS_KIT_OAUTH_REDIRECT") or "https://king-edition.de/app/oauth/callback"
    TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize"
    TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
    TWITCH_USERINFO_URL = "https://api.twitch.tv/helix/users"
    TWITCH_SCOPES = "user:read:email"

    OBSKIT_SID_COOKIE = "obskit_sid"
    SESSION_LIFETIME_DAYS = 30


class TestingConfig(Config):
    TESTING = True
    SECRET_KEY = "test-secret"
    SESSION_COOKIE_SECURE = False
    TWITCH_CLIENT_ID = "test-client-id"
    TWITCH_CLIENT_SECRET = "test-client-secret"
    TWITCH_REDIRECT_URI = "http://localhost/app/oauth/callback"
