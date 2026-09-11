"""Zusammenlegen der Wurfgeraet-Zeilen.

Der kritische Fall ist die Kollision: in einem Match stehen die Wuerfe
unter `BluezoneGrenade` und die Kills unter `Red Zone`. Ein reines
Umbenennen liefe in den Primaerschluessel, und wer nur eine der beiden
Zeilen nimmt, verliert die andere Haelfte.
"""
import pytest

from pubg import db_pg
from scripts.remap_throwables import RENAMES, fix_is_thrown, merge


def _row(weapon, shots=0, kills=0, damage=0.0, hits=0, is_thrown=False):
    return {"account_id": "acc-1", "player_name": "P", "team_id": 1,
            "is_bot": False, "weapon": weapon, "shots": shots,
            "hit_attacks": hits, "hits": hits, "damage": damage,
            "kills": kills, "head": 0, "torso": 0, "arm": 0, "leg": 0,
            "pelvis": 0, "finisher_hits": 0, "finisher_shots": 0,
            "shots_in_fight": 0, "is_thrown": is_thrown}


def _write(conn, tenant_id, match_id, rows):
    db_pg.insert_match(conn, tenant_id, match_id, "Baltic_Main", "squad-fpp",
                       False, 1800, "2026-09-01T12:00:00Z", None)
    db_pg.upsert_weapon_stats(conn, tenant_id, match_id, rows)
    conn.commit()


def _read(conn, tenant_id):
    with conn.cursor() as cur:
        cur.execute("SELECT weapon, shots, kills, damage, hits, is_thrown "
                    "FROM match_weapon_stats WHERE tenant_id = %s "
                    "ORDER BY weapon", (tenant_id,))
        return {r["weapon"]: dict(r) for r in cur.fetchall()}


def test_wuerfe_und_kills_landen_in_einer_zeile(pg):
    # Der eigentliche Fehler: 175 Wuerfe ohne Kills in der einen Zeile,
    # 302 Kills ohne Wuerfe in der anderen.
    conn, t1, _ = pg
    _write(conn, t1, "m1", [_row("BluezoneGrenade", shots=12),
                            _row("Red Zone", kills=3)])
    with conn.cursor() as cur:
        merge(cur)
        conn.commit()
    rows = _read(conn, t1)
    assert set(rows) == {"Blauzonen-Granate"}
    assert rows["Blauzonen-Granate"]["shots"] == 12
    assert rows["Blauzonen-Granate"]["kills"] == 3
    assert rows["Blauzonen-Granate"]["is_thrown"] is True


def test_alte_namen_verschwinden(pg):
    conn, t1, _ = pg
    _write(conn, t1, "m1", [_row("SmokeBomb", shots=9),
                            _row("FlashBang", shots=4),
                            _row("StunGun", shots=1)])
    with conn.cursor() as cur:
        merge(cur)
        conn.commit()
    rows = _read(conn, t1)
    assert set(rows) == {"Rauchbombe", "Blendgranate", "Taser"}
    assert rows["Rauchbombe"]["shots"] == 9


def test_bestehende_zielzeile_wird_addiert_nicht_ersetzt(pg):
    # Nach dem Deploy schreibt der Poller schon den neuen Namen; die
    # Migration darf diese Zeile nicht ueberbuegeln.
    conn, t1, _ = pg
    _write(conn, t1, "m1", [_row("Blauzonen-Granate", shots=5, kills=1,
                                 is_thrown=True),
                            _row("BluezoneGrenade", shots=7)])
    with conn.cursor() as cur:
        merge(cur)
        conn.commit()
    rows = _read(conn, t1)
    assert rows["Blauzonen-Granate"]["shots"] == 12
    assert rows["Blauzonen-Granate"]["kills"] == 1


def test_mehrere_matches_bleiben_getrennt(pg):
    conn, t1, _ = pg
    _write(conn, t1, "m1", [_row("SmokeBomb", shots=3)])
    _write(conn, t1, "m2", [_row("SmokeBomb", shots=4)])
    with conn.cursor() as cur:
        merge(cur)
        conn.commit()
    with conn.cursor() as cur:
        cur.execute("SELECT match_id, shots FROM match_weapon_stats "
                    "WHERE tenant_id = %s ORDER BY match_id", (t1,))
        got = [(r["match_id"], r["shots"]) for r in cur.fetchall()]
    assert got == [("m1", 3), ("m2", 4)]


def test_andere_tenants_bleiben_getrennt(pg):
    conn, t1, t2 = pg
    _write(conn, t1, "m1", [_row("SmokeBomb", shots=3)])
    _write(conn, t2, "m1", [_row("SmokeBomb", shots=8)])
    with conn.cursor() as cur:
        merge(cur)
        conn.commit()
    assert _read(conn, t1)["Rauchbombe"]["shots"] == 3
    assert _read(conn, t2)["Rauchbombe"]["shots"] == 8


def test_schusswaffen_werden_nicht_angetastet(pg):
    conn, t1, _ = pg
    _write(conn, t1, "m1", [_row("M416", shots=30, kills=2, hits=11)])
    with conn.cursor() as cur:
        merge(cur)
        fix_is_thrown(cur)
        conn.commit()
    rows = _read(conn, t1)
    assert rows["M416"]["shots"] == 30
    # Eine Schusswaffe ist kein Wurfgeraet und bleibt bei false.
    assert rows["M416"]["is_thrown"] is False


def test_is_thrown_wird_fuer_altbestand_nachgezogen(pg):
    # Der Wert ist eine reine Funktion des Namens; die Spalte wurde nur
    # erst ab August 2026 mitgeschrieben.
    conn, t1, _ = pg
    _write(conn, t1, "m1", [_row("Granate", shots=4, is_thrown=False),
                            _row("Molotov", shots=2, is_thrown=False)])
    with conn.cursor() as cur:
        assert fix_is_thrown(cur) == 2
        conn.commit()
    rows = _read(conn, t1)
    assert all(r["is_thrown"] is True for r in rows.values())


def test_alle_quellnamen_zeigen_auf_ein_wurfgeraet():
    # Ein Tippfehler im Zielnamen faende sonst erst im Betrieb auf.
    from pubg.burst_analysis import class_of_weapon_name
    for src, dst in RENAMES.items():
        assert class_of_weapon_name(dst) == "throwable", f"{src} -> {dst}"
