"""Das Archiv darf keine Luecke bekommen, nur weil jemand schneller war.

Telemetrie ist global: holt ein anderer Tenant sie zuerst, steigt der
eigene Poller vorher aus — und damit auch vor dem Archiv-Upload. Da nur
ein Tenant ein Archiv hat, fiel dessen Abdeckung von 100% auf 40%.
"""
from unittest.mock import MagicMock, patch

import pytest

from pubg import db_pg


CONN = None
T = None


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def _ev(ts):
    return {"event_type": "Kill", "timestamp_ms": ts,
            "actor_account": "account.A", "target_account": "account.E",
            "actor_x": 1.0, "actor_y": 2.0, "actor_z": 3.0,
            "actor_health": 100.0, "victim_x": 4.0, "victim_y": 5.0,
            "weapon": "WeapAK47_C", "distance": 100.0, "damage": None,
            "damage_reason": "Damage_Gun", "seat_index": None,
            "attachments": None, "payload_json": None}


def test_fremd_geholtes_match_wird_trotzdem_archiviert():
    from pubg.poller import _archiv_nachholen
    db_pg.insert_match(CONN.raw, T, "ag1", "Baltic_Main", "squad-fpp", False,
                       1800, "2026-09-15T18:00:00Z", "https://cdn/x.json")
    db_pg.insert_telemetry_events(CONN.raw, "ag1", [_ev(1000)])
    CONN.raw.commit()

    client = MagicMock()
    client.get_telemetry.return_value = [{"_T": "LogPlayerKillV2"}]
    cfg = {"host": "h", "path": "/p"}
    with patch("pubg.hidrive_telemetry.exists", return_value=False) as ex, \
         patch("pubg.hidrive_telemetry.upload_raw") as up:
        _archiv_nachholen(CONN, T, client, "ag1", "https://cdn/x.json",
                          cfg=cfg)
    assert ex.called
    assert up.called, "Blob haette hochgeladen werden muessen"


def test_bereits_archiviertes_match_wird_nicht_erneut_geladen():
    """Sonst zieht jeder Tick denselben Blob vom CDN."""
    from pubg.poller import _archiv_nachholen
    client = MagicMock()
    cfg = {"host": "h", "path": "/p"}
    with patch("pubg.hidrive_telemetry.exists", return_value=True), \
         patch("pubg.hidrive_telemetry.upload_raw") as up:
        _archiv_nachholen(CONN, T, client, "ag2", "https://cdn/x.json",
                          cfg=cfg)
    assert not client.get_telemetry.called
    assert not up.called


def test_ohne_archiv_passiert_nichts():
    from pubg.poller import _archiv_nachholen
    client = MagicMock()
    with patch("pubg.hidrive_telemetry.upload_raw") as up:
        _archiv_nachholen(CONN, T, client, "ag3", "https://cdn/x.json",
                          cfg=None)
    assert not client.get_telemetry.called
    assert not up.called


def _tenant_mit_archiv(tid, match_id, acc):
    """Tenant, der in diesem Match gespielt hat.

    Nachweis ist der Eintrag in `matches` — der Poller legt ein Match
    nur fuer Tenants an, deren Account darin gespielt hat.
    """
    db_pg.insert_match(CONN.raw, tid, match_id, "Baltic_Main", "squad-fpp",
                       False, 1800, "2026-09-15T18:00:00Z", None)
    db_pg.insert_team_mapping(CONN.raw, tid, match_id,
                              [{"account_id": acc, "team_id": 1}])
    CONN.raw.commit()


def test_fremdes_archiv_darf_genutzt_werden_wer_dabei_war():
    """Die Telemetrie gehoert dem Match, nicht dem Konto.

    Wer in derselben Lobby sass, hat dasselbe Spiel gespielt und darf
    den Blob aus einem fremden Archiv lesen — sonst haette jeder
    Tenant eine andere Sicht auf dieselbe Runde.
    """
    from pubg.archive_config import lesbare_archive_fuer_match
    _tenant_mit_archiv(T, "sh1", "account.A")
    cfgs = lesbare_archive_fuer_match(CONN.raw, T, "sh1")
    # Wer dabei war, bekommt mindestens einen Eintrag — `None` steht
    # fuer "Standard-Konfiguration aus .secrets", wenn kein eigener
    # Zugang hinterlegt ist.
    assert len(cfgs) >= 1


def test_ohne_teilnahme_kein_fremdes_archiv():
    """Wer nicht dabei war, bekommt auch keinen fremden Blob."""
    from pubg.archive_config import lesbare_archive_fuer_match
    db_pg.insert_match(CONN.raw, T, "sh2", "Baltic_Main", "squad-fpp", False,
                       1800, "2026-09-15T18:00:00Z", None)
    CONN.raw.commit()
    # Tenant 999 hat in sh2 nie gespielt — kein Eintrag in `matches`.
    cfgs = lesbare_archive_fuer_match(CONN.raw, 999, "sh2")
    assert cfgs == []
