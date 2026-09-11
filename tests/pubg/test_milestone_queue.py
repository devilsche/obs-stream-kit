"""Warteschlange der Meilensteine: Schluessel, Marker je Fassung, Tenants."""
import pytest

from pubg.db_pg import (get_milestone_snapshot, mark_milestone_shown,
                        pending_milestones, purge_test_milestones,
                        queue_milestones, recent_milestones,
                        save_milestone_snapshot)


def _item(key="weapon_damage:M416:425000", occasion="weapon_damage",
          subject="M416", value=425000, tier="small", widget="bar"):
    return {"key": key, "occasion": occasion, "subject": subject,
            "label": "Weapon Damage", "unit": "damage", "value": value,
            "prev_value": value - 1000, "tier": tier, "widget": widget}


# ── Snapshot ────────────────────────────────────────────────────────────────

def test_snapshot_fehlt_beim_ersten_mal(pg):
    conn, t1, _ = pg
    assert get_milestone_snapshot(conn, t1, "acc-1") is None


def test_snapshot_kommt_zurueck_wie_gespeichert(pg):
    conn, t1, _ = pg
    stats = {"weapons": {"M416": {"damage": 432503.5, "kills": 3179}},
             "career": {"damage": 4041616, "kills": 25709}}
    save_milestone_snapshot(conn, t1, "acc-1", stats)
    conn.commit()
    back = get_milestone_snapshot(conn, t1, "acc-1")
    assert back["weapons"]["M416"]["kills"] == 3179
    assert back["career"]["damage"] == 4041616


def test_snapshot_wird_ueberschrieben_nicht_verdoppelt(pg):
    conn, t1, _ = pg
    save_milestone_snapshot(conn, t1, "acc-1", {"career": {"kills": 1}})
    save_milestone_snapshot(conn, t1, "acc-1", {"career": {"kills": 2}})
    conn.commit()
    assert get_milestone_snapshot(conn, t1, "acc-1")["career"]["kills"] == 2


def test_snapshot_ist_pro_tenant_getrennt(pg):
    conn, t1, t2 = pg
    save_milestone_snapshot(conn, t1, "acc-1", {"career": {"kills": 10}})
    conn.commit()
    assert get_milestone_snapshot(conn, t2, "acc-1") is None


# ── Einreihen ───────────────────────────────────────────────────────────────

def test_einreihen_zaehlt_die_neuen(pg):
    conn, t1, _ = pg
    assert queue_milestones(conn, t1, [_item()]) == 1


def test_derselbe_meilenstein_kommt_nicht_zweimal(pg):
    conn, t1, _ = pg
    # Der Poller laeuft haeufiger als die Marken fallen — ohne diese
    # Sperre wuerde jede Runde dieselbe Feier ausloesen.
    queue_milestones(conn, t1, [_item()])
    assert queue_milestones(conn, t1, [_item()]) == 0
    conn.commit()
    assert len(recent_milestones(conn, t1)) == 1


def test_andere_marke_ist_ein_neuer_eintrag(pg):
    conn, t1, _ = pg
    queue_milestones(conn, t1, [_item()])
    n = queue_milestones(conn, t1, [
        _item(key="weapon_damage:M416:450000", value=450000)])
    assert n == 1


def test_einreihen_ist_pro_tenant_getrennt(pg):
    conn, t1, t2 = pg
    queue_milestones(conn, t1, [_item()])
    conn.commit()
    assert pending_milestones(conn, t2, "bar") == []


# ── Abholen und quittieren ──────────────────────────────────────────────────

def test_abholen_liefert_nur_die_passende_fassung(pg):
    conn, t1, _ = pg
    queue_milestones(conn, t1, [_item(widget="bar")])
    conn.commit()
    assert len(pending_milestones(conn, t1, "bar")) == 1
    assert pending_milestones(conn, t1, "big") == []


def test_both_geht_an_beide_fassungen(pg):
    conn, t1, _ = pg
    queue_milestones(conn, t1, [_item(widget="both")])
    conn.commit()
    assert len(pending_milestones(conn, t1, "bar")) == 1
    assert len(pending_milestones(conn, t1, "big")) == 1


def test_quittieren_wirkt_nur_fuer_die_eine_fassung(pg):
    # Der Grund fuer zwei Marker: sonst nimmt die zuerst pollende
    # Source der anderen den Anlass weg.
    conn, t1, _ = pg
    it = _item(widget="both")
    queue_milestones(conn, t1, [it])
    mark_milestone_shown(conn, t1, [it["key"]], "bar")
    conn.commit()
    assert pending_milestones(conn, t1, "bar") == []
    assert len(pending_milestones(conn, t1, "big")) == 1


def test_zweimal_quittieren_zaehlt_einmal(pg):
    conn, t1, _ = pg
    it = _item()
    queue_milestones(conn, t1, [it])
    assert mark_milestone_shown(conn, t1, [it["key"]], "bar") == 1
    assert mark_milestone_shown(conn, t1, [it["key"]], "bar") == 0


def test_lauteste_stufe_kommt_zuerst(pg):
    # Eine ausgelevelte Waffe soll nicht hinter drei Schadensmarken warten.
    conn, t1, _ = pg
    queue_milestones(conn, t1, [
        _item(key="a", tier="small", widget="big"),
        _item(key="b", occasion="weapon_mastered", tier="huge", widget="big"),
        _item(key="c", occasion="weapon_best_kills", tier="big",
              widget="big"),
    ])
    conn.commit()
    got = pending_milestones(conn, t1, "big", limit=3)
    assert [r["tier"] for r in got] == ["huge", "big", "small"]


def test_unbekannte_fassung_liefert_nichts(pg):
    conn, t1, _ = pg
    queue_milestones(conn, t1, [_item()])
    conn.commit()
    assert pending_milestones(conn, t1, "vollbild") == []
    assert mark_milestone_shown(conn, t1, ["x"], "vollbild") == 0


# ── Probelaeufe ─────────────────────────────────────────────────────────────

def test_probelauf_geht_durch_dieselbe_warteschlange(pg):
    conn, t1, _ = pg
    queue_milestones(conn, t1, [_item(key="test:x")], is_test=True)
    conn.commit()
    rows = pending_milestones(conn, t1, "bar")
    assert len(rows) == 1 and rows[0]["is_test"] is True


def test_probelaeufe_wegwerfen_laesst_echte_stehen(pg):
    conn, t1, _ = pg
    queue_milestones(conn, t1, [_item()])
    queue_milestones(conn, t1, [_item(key="test:x")], is_test=True)
    conn.commit()
    assert purge_test_milestones(conn, t1) == 1
    conn.commit()
    rows = recent_milestones(conn, t1)
    assert len(rows) == 1 and rows[0]["is_test"] is False
