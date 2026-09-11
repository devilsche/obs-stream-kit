"""Von der Red Zone erwischt: Knock, Kill und im Fahrzeug.

Der Anlass war jahrelang blind. Die Bedingung lautete nur
`event_type='Kill'`, und die Zonen-Bombardierung erzeugt in den Daten
**ausschliesslich Knocks** — 74 Ereignisse, kein einziger Kill. Das
Achievement konnte also nie ausloesen, obwohl es vollstaendig
registriert war.
"""
import pytest

from pubg import db_pg
from pubg.aggregations import (PUBG_RARE_ACHIEVEMENTS,
                               compute_session_achievements)

ME = "account.A"
RED = "RedZoneBombingField_Def_C"
BLACK = "BlackZoneBombingField_Def_C"


@pytest.fixture
def sess(pg_compat):
    conn, t1, t2 = pg_compat
    db_pg.upsert_player(conn.raw, t1, ME, "PEX_LuCKoR", "steam", 1)
    conn.raw.commit()
    return conn, t1


def _match(conn, tenant_id, mid="m1", played="2026-09-11T12:00:00Z"):
    db_pg.insert_match(conn.raw, tenant_id, mid, "Baltic_Main", "squad-fpp",
                       False, 1800, played, None)
    db_pg.insert_participants(conn.raw, tenant_id, mid, [{
        "account_id": ME, "name": "PEX_LuCKoR", "team_id": 1, "place": 5,
        "kills": 2, "headshot_kills": 0, "assists": 0, "dbnos": 0,
        "revives": 0, "damage_dealt": 300.0, "longest_kill": 40.0,
        "time_survived": 900, "walk_distance": 1000.0,
        "ride_distance": 500.0, "swim_distance": 0.0,
        "weapons_acquired": 4, "heals": 1, "boosts": 1, "team_kills": 0}])
    # Ohne Team-Zuordnung ordnet das Match-Detail keine Ereignisse zu.
    db_pg.insert_team_mapping(conn.raw, tenant_id, mid,
                              [{"account_id": ME, "team_id": 1}])
    conn.raw.commit()


def _events(conn, evs, mid="m1"):
    db_pg.insert_telemetry_events(conn.raw, mid, evs)


def _hit(kind, ts, weapon=RED, target=ME):
    return {"event_type": kind, "timestamp_ms": ts, "target_account": target,
            "weapon": weapon, "actor_account": None}


def _veh(kind, ts, acc=ME):
    return {"event_type": kind, "timestamp_ms": ts, "actor_account": acc,
            "weapon": "BP_Buggy_C"}


def _ids(conn, tenant_id):
    return [a["id"] for a in compute_session_achievements(conn, tenant_id, ME)]


# ── Der eigentliche Fehler ──────────────────────────────────────────────────

def test_knock_wird_erkannt(sess):
    # Genau der Fall, den es real gibt: die Bombe streckt nieder,
    # toetet aber nicht. Vorher wurde er uebersehen.
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_hit("Knock", 600000)])
    assert "redzone_knock" in _ids(conn, t1)


def test_kill_zu_fuss_ist_ein_eigener_anlass(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_hit("Kill", 600000)])
    got = _ids(conn, t1)
    assert "redzone_death" in got
    assert "redzone_knock" not in got


def test_im_fahrzeug_zaehlt_getrennt(sess):
    # Wer faehrt, sieht die Bombardierung zu spaet — der
    # eindruecklichste der drei Faelle.
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_veh("VehicleEnter", 500000),
                   _hit("Knock", 600000),
                   _veh("VehicleLeave", 700000)])
    got = _ids(conn, t1)
    assert "redzone_vehicle_death" in got
    # Und NUR dieser: zwei Meldungen fuer ein Ereignis waeren Laerm.
    assert "redzone_knock" not in got
    assert "redzone_death" not in got


def test_kill_im_fahrzeug_bleibt_der_fahrzeug_anlass(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_veh("VehicleEnter", 500000),
                   _hit("Kill", 600000),
                   _veh("VehicleLeave", 700000)])
    got = _ids(conn, t1)
    assert got.count("redzone_vehicle_death") == 1
    assert "redzone_death" not in got


def test_treffer_nach_dem_aussteigen_zaehlt_zu_fuss(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_veh("VehicleEnter", 300000),
                   _veh("VehicleLeave", 400000),
                   _hit("Knock", 600000)])
    got = _ids(conn, t1)
    assert "redzone_knock" in got
    assert "redzone_vehicle_death" not in got


def test_schwarze_zone_zaehlt_mit(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_hit("Knock", 600000, weapon=BLACK)])
    assert "redzone_knock" in _ids(conn, t1)


# ── Was NICHT ausloesen darf ────────────────────────────────────────────────

def test_blauzonen_granate_ist_keine_zonen_bombe(sess):
    # Das alte Muster `weapon LIKE '%Bomb%'` traf auch
    # `Bluezonebomb_EffectActor_C` — die geworfene Granate, die mit der
    # Zonen-Bombardierung nichts zu tun hat.
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_hit("Knock", 600000,
                        weapon="Bluezonebomb_EffectActor_C")])
    got = _ids(conn, t1)
    assert not any(g.startswith("redzone") for g in got)


def test_blauzone_selbst_ist_keine_red_zone(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_hit("Knock", 600000,
                        weapon="TslGameModeBase_BattleRoyaleBP_C")])
    assert not any(g.startswith("redzone") for g in _ids(conn, t1))


def test_treffer_auf_einen_anderen_zaehlt_nicht(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_hit("Knock", 600000, target="account.X")])
    assert not any(g.startswith("redzone") for g in _ids(conn, t1))


def test_nur_schaden_ohne_knock_loest_nichts_aus(sess):
    # Von der Druckwelle gestreift und weitergelaufen ist kein Anlass.
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [{"event_type": "TakeDamage", "timestamp_ms": 600000,
                    "target_account": ME, "weapon": RED, "damage": 67.0}])
    assert not any(g.startswith("redzone") for g in _ids(conn, t1))


# ── Zaehlung und Einordnung ─────────────────────────────────────────────────

def test_mehrere_treffer_im_match_werden_gezaehlt(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_hit("Knock", 600000), _hit("Knock", 610000)])
    labels = [a["label"] for a in compute_session_achievements(conn, t1, ME)
              if a["id"] == "redzone_knock"]
    assert labels == ["Red Zone Shockwave · 2×"]


def test_einzelner_treffer_ohne_zaehler_im_label(sess):
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [_hit("Knock", 600000)])
    labels = [a["label"] for a in compute_session_achievements(conn, t1, ME)
              if a["id"] == "redzone_knock"]
    assert labels == ["Red Zone Shockwave"]


def test_die_seltenen_faelle_gelten_als_rare():
    # Der Knock ist der Alltagsfall und bleibt schlicht; im Fahrzeug
    # erwischt zu werden und zu Fuss erschlagen zu werden nicht.
    assert "redzone_vehicle_death" in PUBG_RARE_ACHIEVEMENTS
    assert "redzone_death" in PUBG_RARE_ACHIEVEMENTS
    assert "redzone_knock" not in PUBG_RARE_ACHIEVEMENTS


def test_alle_drei_sind_vollstaendig_registriert():
    # Eine ID ohne Eintrag in Prioritaet, Label oder Icons fiele im
    # Popup und im Browser stumm aus.
    from pubg.endpoints import EndpointRegistry as R
    for aid in ("redzone_knock", "redzone_death", "redzone_vehicle_death"):
        assert aid in R.PUBG_POPUP_PRIORITY, aid
        assert aid in R.PUBG_CANONICAL_LABELS, aid
        assert aid in R.PUBG_ICON_URLS, aid
        for lang in ("english", "german"):
            assert aid in R.PUBG_ACH_DESCRIPTIONS[lang], f"{aid}/{lang}"


# ── Todesursache im Report ──────────────────────────────────────────────────

def _kill_types(conn, tenant_id):
    """Todesursachen aus dem Match-Detail, wie der Report sie zeigt."""
    from pubg.aggregations import compute_match_detail
    d = compute_match_detail(conn, tenant_id, ME, "m1") or {}
    rows = d.get("kills") or d.get("killFeed") or d.get("events") or []
    return [r.get("type") for r in rows]


def test_todesursache_zonen_bombe(sess):
    # Der Waffen-Fallback deckte die echte Bombardierung gar nicht ab,
    # dafuer aber die geworfene Blauzonen-Granate.
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [{"event_type": "Kill", "timestamp_ms": 600000,
                    "target_account": ME, "weapon": RED,
                    "actor_account": None, "damage_reason": ""}])
    assert "kill_redzone" in _kill_types(conn, t1)


def test_blauzonen_granate_ist_kein_zonentod(sess):
    # Sie hat einen Werfer; als Umgebungstod gezaehlt verlor sie ihn.
    conn, t1 = sess
    _match(conn, t1)
    _events(conn, [{"event_type": "Kill", "timestamp_ms": 600000,
                    "target_account": ME,
                    "weapon": "Bluezonebomb_EffectActor_C",
                    "actor_account": "account.X", "damage_reason": ""}])
    assert "kill_redzone" not in _kill_types(conn, t1)
