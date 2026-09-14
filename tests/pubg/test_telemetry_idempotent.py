"""Telemetrie darf nur einmal in der DB landen.

Telemetrie ist global: spielen zwei Tenants zusammen, holen beide
Poller dasselbe Match — und die Pruefung "hat es schon Events?" lief
nicht atomar. Beide sahen leer, beide schrieben, jedes Event stand
zweimal da.
"""
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


def _ev(ts, et="Kill"):
    return {"event_type": et, "timestamp_ms": ts,
            "actor_account": "account.A", "target_account": "account.E",
            "actor_x": 1.0, "actor_y": 2.0, "actor_z": 3.0,
            "actor_health": 100.0, "victim_x": 4.0, "victim_y": 5.0,
            "weapon": "WeapAK47_C", "distance": 100.0, "damage": None,
            "damage_reason": "Damage_Gun", "seat_index": None,
            "attachments": None, "payload_json": None}


def _n(mid):
    return CONN.execute("SELECT count(*) AS n FROM telemetry_events "
                        "WHERE match_id = ?", (mid,)).fetchone()["n"]


def test_zweiter_import_legt_nichts_nach():
    db_pg.insert_match(CONN.raw, T, "ti1", "Baltic_Main", "squad-fpp", False,
                       1800, "2026-09-14T18:00:00Z", None)
    db_pg.insert_telemetry_events(CONN.raw, "ti1", [_ev(1000), _ev(2000)])
    CONN.raw.commit()
    assert _n("ti1") == 2
    # Zweiter Poller, dasselbe Match.
    db_pg.insert_telemetry_events(CONN.raw, "ti1", [_ev(1000), _ev(2000)])
    CONN.raw.commit()
    assert _n("ti1") == 2


def test_doppelte_events_im_blob_landen_einmal():
    """Selbst wenn der Blob dasselbe Ereignis zweimal enthaelt.

    Ein Spieler kann nicht zweimal in derselben Millisekunde von
    derselben Waffe erledigt werden.
    """
    db_pg.insert_match(CONN.raw, T, "ti2", "Baltic_Main", "squad-fpp", False,
                       1800, "2026-09-14T18:00:00Z", None)
    db_pg.insert_telemetry_events(CONN.raw, "ti2",
                                  [_ev(1000), _ev(1000), _ev(2000)])
    CONN.raw.commit()
    assert _n("ti2") == 2


def test_mehrfachtreffer_derselben_salve_bleiben_erhalten():
    """Schrot trifft mit mehreren Kugeln in derselben Millisekunde —
    solche TakeDamage-Zeilen sind echt und duerfen nicht wegfallen."""
    db_pg.insert_match(CONN.raw, T, "ti3", "Baltic_Main", "squad-fpp", False,
                       1800, "2026-09-14T18:00:00Z", None)
    a, b = _ev(1000, "TakeDamage"), _ev(1000, "TakeDamage")
    a["damage"], b["damage"] = 12.5, 9.0
    db_pg.insert_telemetry_events(CONN.raw, "ti3", [a, b])
    CONN.raw.commit()
    assert _n("ti3") == 2


def test_bereinigung_entfernt_nur_echte_dubletten():
    """Der Altbestand: 19.064 Ereignis-Gruppen standen doppelt in der DB."""
    from pubg.db_pg import dedupe_telemetry
    db_pg.insert_match(CONN.raw, T, "ti4", "Baltic_Main", "squad-fpp", False,
                       1800, "2026-09-14T18:00:00Z", None)
    # Ueber den Dedup beim Insert hinweg direkt einfuegen, wie es der
    # doppelte Import damals getan hat.
    zeile = _ev(1000)
    spalten = ("match_id, event_type, timestamp_ms, actor_account, "
               "target_account, weapon, distance, damage_reason")
    with CONN.raw.cursor() as cur:
        for _ in range(2):
            cur.execute(
                f"INSERT INTO telemetry_events ({spalten}) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                ("ti4", zeile["event_type"], zeile["timestamp_ms"],
                 zeile["actor_account"], zeile["target_account"],
                 zeile["weapon"], zeile["distance"],
                 zeile["damage_reason"]))
        # Eine Schrot-Salve: gleiche Zeit, unterschiedlicher Schaden.
        for dmg in (12.5, 9.0):
            cur.execute(
                f"INSERT INTO telemetry_events ({spalten}, damage) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                ("ti4", "TakeDamage", 2000, "account.A", "account.E",
                 "WeapS686_C", 5.0, None, dmg))
    CONN.raw.commit()
    assert _n("ti4") == 4

    weg = dedupe_telemetry(CONN.raw, match_id="ti4")
    CONN.raw.commit()
    assert weg == 1
    # Der doppelte Kill ist einmal da, die Salve vollstaendig.
    assert _n("ti4") == 3
    n_dmg = CONN.execute(
        "SELECT count(*) AS n FROM telemetry_events "
        "WHERE match_id = ? AND event_type = 'TakeDamage'",
        ("ti4",)).fetchone()["n"]
    assert n_dmg == 2


def test_bereinigung_ohne_dubletten_aendert_nichts():
    from pubg.db_pg import dedupe_telemetry
    db_pg.insert_match(CONN.raw, T, "ti5", "Baltic_Main", "squad-fpp", False,
                       1800, "2026-09-14T18:00:00Z", None)
    db_pg.insert_telemetry_events(CONN.raw, "ti5", [_ev(1000), _ev(2000)])
    CONN.raw.commit()
    assert dedupe_telemetry(CONN.raw, match_id="ti5") == 0
    assert _n("ti5") == 2
