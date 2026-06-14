"""Tests fuer die server-seitige Session-Milestone-Detection im Poller.

poll_tenant() soll detect_and_store_session_achievements() aufrufen wenn
in einem Tick neue Matches ODER neue Telemetrie dazukamen — damit das
Auto-Polling (frueher rein browser-getriggert) neue PUBG-Milestones sieht.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from pubg import poller


def _creds():
    return SimpleNamespace(
        pubg_api_key="key", pubg_name="PEX_LuCKoR",
        pubg_platform="steam", pubg_account_id="account.A")


def _patch_subfuncs(new_matches=0, telemetry_processed=0):
    """Patcht alle Sub-Schritte von poll_tenant ausser der Detection.
    Returns ein contextmanager-Stack via patch.multiple-aehnlichem dict."""
    return {
        "credentials": patch.object(poller.credentials, "get",
                                    return_value=_creds()),
        "single_tick": patch.object(
            poller, "run_single_tick",
            return_value={"new_matches": new_matches, "errors": [],
                          "skipped": 0}),
        "lifetimes": patch.object(
            poller, "refresh_lifetimes",
            return_value={"refreshed": 0, "errors": []}),
        "seasons": patch.object(
            poller, "refresh_seasons",
            return_value={"refreshed": 0, "errors": [], "seasonId": None}),
        "backfill": patch.object(
            poller, "backfill_missing_seasons",
            return_value={"backfilled": 0, "errors": []}),
        "telemetry": patch.object(
            poller, "process_telemetry_backlog",
            return_value={"processed": telemetry_processed, "errors": []}),
    }


def _run_poll_tenant(new_matches, telemetry_processed):
    """Fuehrt poll_tenant mit gemockten Subfuncs aus, patcht die Detection
    und gibt den Detection-Mock + das Status-Dict zurueck."""
    patches = _patch_subfuncs(new_matches, telemetry_processed)
    detect = MagicMock(return_value=new_matches + telemetry_processed)
    client_factory = lambda *a, **k: MagicMock(platform="steam")
    with patches["credentials"], patches["single_tick"], \
         patches["lifetimes"], patches["seasons"], patches["backfill"], \
         patches["telemetry"], \
         patch("pubg.aggregations.detect_and_store_session_achievements",
               detect):
        status = poller.poll_tenant(MagicMock(), tenant_id=1,
                                    client_factory=client_factory)
    return detect, status


def test_detects_on_new_match():
    detect, status = _run_poll_tenant(new_matches=2, telemetry_processed=0)
    detect.assert_called_once()
    # tenant_id + my_account_id korrekt durchgereicht
    args = detect.call_args.args
    assert args[1] == 1 and args[2] == "account.A"
    assert status["achievementsDetected"] == 2


def test_detects_on_new_telemetry_only():
    detect, status = _run_poll_tenant(new_matches=0, telemetry_processed=3)
    detect.assert_called_once()
    assert status["achievementsDetected"] == 3


def test_no_detect_without_changes():
    detect, status = _run_poll_tenant(new_matches=0, telemetry_processed=0)
    detect.assert_not_called()
    assert status["achievementsDetected"] == 0


def test_detect_failure_does_not_crash_poll():
    """Wirft die Detection, soll poll_tenant trotzdem ein Status-Dict
    liefern und den Fehler in errors aufnehmen."""
    patches = _patch_subfuncs(new_matches=1, telemetry_processed=0)
    boom = MagicMock(side_effect=RuntimeError("detect boom"))
    client_factory = lambda *a, **k: MagicMock(platform="steam")
    with patches["credentials"], patches["single_tick"], \
         patches["lifetimes"], patches["seasons"], patches["backfill"], \
         patches["telemetry"], \
         patch("pubg.aggregations.detect_and_store_session_achievements",
               boom):
        status = poller.poll_tenant(MagicMock(), tenant_id=1,
                                    client_factory=client_factory)
    assert status["achievementsDetected"] == 0
    assert any("detect" in e.lower() for e in status["errors"])
