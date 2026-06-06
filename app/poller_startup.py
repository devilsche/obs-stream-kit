"""Poller-Startup-Hook.

Wird einmalig vom Flask-Entry (serve.py) aufgerufen — startet PUBG- und
Steam-Poller als Daemon-Threads. Beide iterieren ueber alle Tenants und
pollen pro Tenant mit Credentials aus dem Vault.
"""
import os
import threading


_started = False
_lock = threading.Lock()
_steam_poller = None   # Globale Referenz für views_api
_pubg_poller  = None   # Globale Referenz für views_api


def _pubg_client_factory(api_key: str, platform: str):
    from pubg.api_client import PubgClient
    return PubgClient(api_key=api_key, platform=platform)


def _steam_client_factory(api_key: str, steam_id: str, language: str):
    from steam.api_client import SteamClient
    return SteamClient(api_key=api_key, steam_id=steam_id, language=language)


def start_pollers(root_dir: str):
    """Idempotent — Threads werden nur einmal gestartet."""
    global _started
    with _lock:
        if _started:
            return
        _started = True

    from pubg.poller import PollerThread
    from steam.poller import SteamPoller
    from pubg.cache import TTLCache

    # PUBG
    global _pubg_poller
    pubg_cache = TTLCache(ttl_secs=30)
    pubg_thread = PollerThread(
        client_factory=_pubg_client_factory,
        interval_secs=60,
        cache=pubg_cache,
    )
    pubg_thread.start()
    _pubg_poller = pubg_thread
    print("[poller-startup] PUBG-Poller gestartet")

    # Steam
    global _steam_poller
    steam_thread = SteamPoller(
        client_factory=_steam_client_factory,
        root_dir=root_dir,
    )
    steam_thread.start()
    _steam_poller = steam_thread
    print("[poller-startup] Steam-Poller gestartet")
