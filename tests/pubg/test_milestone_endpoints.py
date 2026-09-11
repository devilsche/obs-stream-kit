"""Meilenstein-Endpoints: Konfiguration, Abholen, Probelauf.

Der Rundlauf ist der eigentliche Gegenstand: Probelauf einreihen →
Widget holt ab → quittiert → zweites Abholen liefert nichts mehr.
Bricht eines der Glieder, feiert das Overlay entweder gar nicht oder
bei jedem Takt erneut.
"""
import json
from unittest.mock import MagicMock

import pytest

from pubg import db_pg
from pubg.cache import TTLCache
from pubg.endpoints import EndpointRegistry
from pubg.weapon_milestones import OCCASIONS

CONN = None
T = None
T2 = None


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T, T2
    CONN, T, T2 = pg_compat[0], pg_compat[1], pg_compat[2]
    db_pg.upsert_player(CONN.raw, T, "account.A", "PEX_LuCKoR", "steam", 1)
    db_pg.upsert_player(CONN.raw, T2, "account.B", "original_hat3", "steam", 1)
    CONN.raw.commit()
    yield
    CONN, T, T2 = None, None, None


def _reg(tenant_id=None, account_id="account.A"):
    return EndpointRegistry(
        get_conn=lambda: CONN.raw,
        my_account_id=account_id,
        platform="steam",
        cache=TTLCache(ttl_secs=30),
        client=MagicMock(),
        poller_status=lambda: {"polling": "ok"},
        tenant_id=tenant_id if tenant_id is not None else T,
    )


def _call(method, path, body=None, qs=None, tenant_id=None,
          account_id="account.A"):
    # Der Query-String gehoert in den Pfad — das vierte Argument von
    # dispatch sind die Header, nicht die Parameter.
    from urllib.parse import urlencode
    if qs:
        path = path + "?" + urlencode(qs)
    raw = json.dumps(body).encode() if body is not None else b""
    out, code, _ = _reg(tenant_id, account_id).dispatch(method, path, raw, {})
    return json.loads(out), code


def _data(payload):
    return payload.get("data", payload)


# ── Konfiguration ───────────────────────────────────────────────────────────

def test_config_liefert_alle_anlaesse_und_die_registry():
    d, code = _call("GET", "/api/pubg/milestone-config")
    assert code == 200
    d = _data(d)
    assert set(d["config"]) == set(OCCASIONS)
    # Die Registry kommt mit, damit das Tool Beschriftungen nicht
    # doppelt pflegen muss.
    assert d["occasions"]["weapon_damage"]["label"] == "Weapon Damage"
    assert "step" in d["editable"] and "both" in d["widgets"]


def test_gespeicherte_konfiguration_kommt_zurueck():
    _call("POST", "/api/pubg/milestone-config",
          {"config": {"weapon_damage": {"step": 50000, "enabled": False,
                                        "widget": "big"}}})
    d = _data(_call("GET", "/api/pubg/milestone-config")[0])
    assert d["config"]["weapon_damage"]["step"] == 50000
    assert d["config"]["weapon_damage"]["enabled"] is False
    assert d["config"]["weapon_damage"]["widget"] == "big"


def test_unsinn_in_der_konfiguration_faellt_auf_den_default_zurueck():
    _call("POST", "/api/pubg/milestone-config",
          {"config": {"weapon_damage": {"step": -1, "widget": "haus"}}})
    d = _data(_call("GET", "/api/pubg/milestone-config")[0])
    assert d["config"]["weapon_damage"]["step"] == \
        OCCASIONS["weapon_damage"]["step"]
    assert d["config"]["weapon_damage"]["widget"] == "bar"


def test_leere_konfiguration_setzt_zurueck():
    _call("POST", "/api/pubg/milestone-config",
          {"config": {"weapon_damage": {"enabled": False}}})
    d = _data(_call("POST", "/api/pubg/milestone-config", {"config": {}})[0])
    assert d["config"]["weapon_damage"]["enabled"] is True


def test_konfiguration_ist_pro_tenant_getrennt():
    _call("POST", "/api/pubg/milestone-config",
          {"config": {"weapon_damage": {"step": 7777}}})
    other = _data(_call("GET", "/api/pubg/milestone-config",
                        tenant_id=T2, account_id="account.B")[0])
    assert other["config"]["weapon_damage"]["step"] == \
        OCCASIONS["weapon_damage"]["step"]


# ── Abholen ─────────────────────────────────────────────────────────────────

def test_ohne_meilenstein_kommt_null():
    d, code = _call("GET", "/api/pubg/milestone-pending", qs={"widget": "big"})
    assert code == 200 and _data(d)["milestone"] is None


def test_fassung_muss_angegeben_sein():
    _, code = _call("GET", "/api/pubg/milestone-pending",
                    qs={"widget": "vollbild"})
    assert code == 400


# ── Rundlauf: Probelauf → Abholen → quittiert ───────────────────────────────

def test_probelauf_wird_genau_einmal_geliefert():
    d = _data(_call("POST", "/api/pubg/milestone-test",
                    {"occasion": "weapon_damage", "subject": "M416",
                     "value": 450000, "widget": "big"})[0])
    assert d["queued"]["value"] == 450000
    assert d["widget"] == "big"

    first = _data(_call("GET", "/api/pubg/milestone-pending",
                        qs={"widget": "big", "markShown": "1"})[0])
    assert first["milestone"]["subject"] == "M416"
    assert first["milestone"]["isTest"] is True

    # Zweites Abholen: leer. Sonst feierte das Overlay bei jedem Takt.
    second = _data(_call("GET", "/api/pubg/milestone-pending",
                         qs={"widget": "big", "markShown": "1"})[0])
    assert second["milestone"] is None


def test_ohne_markshown_bleibt_der_meilenstein_liegen():
    # Das Overlay quittiert erst, wenn die Feier auch laeuft.
    _call("POST", "/api/pubg/milestone-test",
          {"occasion": "weapon_kills", "widget": "bar"})
    for _ in range(2):
        d = _data(_call("GET", "/api/pubg/milestone-pending",
                        qs={"widget": "bar"})[0])
        assert d["milestone"] is not None


def test_probelauf_erbt_die_stufe_des_anlasses():
    d = _data(_call("POST", "/api/pubg/milestone-test",
                    {"occasion": "weapon_mastered", "subject": "Mk12"})[0])
    assert d["queued"]["tier"] == "huge"


def test_probelauf_auf_grosser_marke_wird_laut():
    d = _data(_call("POST", "/api/pubg/milestone-test",
                    {"occasion": "career_damage", "value": 4000000})[0])
    assert d["queued"]["tier"] == "huge"


def test_probelauf_auf_gewoehnlicher_marke_bleibt_leise():
    d = _data(_call("POST", "/api/pubg/milestone-test",
                    {"occasion": "career_damage", "value": 4100000})[0])
    assert d["queued"]["tier"] == "small"


def test_unbekannter_anlass_wird_abgelehnt():
    _, code = _call("POST", "/api/pubg/milestone-test",
                    {"occasion": "gibtsnicht"})
    assert code == 400


def test_zwei_probelaeufe_desselben_anlasses_blockieren_sich_nicht():
    # Der Schluessel traegt einen Zeitstempel, damit man mehrmals
    # hintereinander ansehen kann, wie es aussieht.
    for _ in range(2):
        d, code = _call("POST", "/api/pubg/milestone-test",
                        {"occasion": "weapon_damage", "widget": "bar"})
        assert code == 200
    rows = db_pg.recent_milestones(CONN.raw, T)
    assert len([r for r in rows if r["is_test"]]) >= 1


def test_probelaeufe_aufraeumen():
    _call("POST", "/api/pubg/milestone-test", {"occasion": "weapon_damage"})
    d = _data(_call("POST", "/api/pubg/milestone-purge-tests")[0])
    assert d["deleted"] >= 1
    assert db_pg.recent_milestones(CONN.raw, T) == []


def test_probelauf_eines_tenants_erreicht_den_anderen_nicht():
    _call("POST", "/api/pubg/milestone-test",
          {"occasion": "weapon_damage", "widget": "big"})
    d = _data(_call("GET", "/api/pubg/milestone-pending",
                    qs={"widget": "big"}, tenant_id=T2,
                    account_id="account.B")[0])
    assert d["milestone"] is None


# ── Zustand ─────────────────────────────────────────────────────────────────

def test_zustand_ohne_snapshot_meldet_das():
    d = _data(_call("GET", "/api/pubg/milestone-state")[0])
    assert d["hasSnapshot"] is False


def test_zustand_nennt_die_naechste_marke():
    db_pg.save_milestone_snapshot(CONN.raw, T, "account.A", {
        "weapons": {"M416": {"damage": 432503, "kills": 3179}},
        "career": {"damage": 4041616, "kills": 25709}})
    CONN.raw.commit()
    d = _data(_call("GET", "/api/pubg/milestone-state")[0])
    assert d["hasSnapshot"] is True
    dmg = [r for r in d["state"]
           if r["occasion"] == "weapon_damage" and r["subject"] == "M416"][0]
    # 432.503 bei 25.000er Schritten → naechste Marke 450.000.
    assert dmg["next"] == 450000
    assert dmg["toGo"] == pytest.approx(17497)


def test_zustand_beachtet_die_eigene_schrittweite():
    db_pg.save_milestone_snapshot(CONN.raw, T, "account.A",
                                  {"career": {"damage": 4041616}})
    CONN.raw.commit()
    _call("POST", "/api/pubg/milestone-config",
          {"config": {"career_damage": {"step": 1000000}}})
    d = _data(_call("GET", "/api/pubg/milestone-state")[0])
    row = [r for r in d["state"] if r["occasion"] == "career_damage"][0]
    assert row["next"] == 5000000


# ── Vorschau am Widget selbst (?demo=) ──────────────────────────────────────

def test_demo_reiht_nichts_ein():
    # Sonst blockierte jedes Ansehen einen echten Meilenstein und liesse
    # sich nur einmal wiederholen.
    d = _data(_call("GET", "/api/pubg/milestone-demo",
                    qs={"occasion": "weapon_damage"})[0])
    assert d["milestone"]["occasion"] == "weapon_damage"
    assert db_pg.recent_milestones(CONN.raw, T) == []


def test_demo_nimmt_die_naechste_echte_marke():
    db_pg.save_milestone_snapshot(CONN.raw, T, "account.A", {
        "weapons": {"M416": {"damage": 432503}}})
    CONN.raw.commit()
    d = _data(_call("GET", "/api/pubg/milestone-demo",
                    qs={"occasion": "weapon_damage"})[0])
    m = d["milestone"]
    # 432.503 bei 25.000er Schritten → 450.000, nicht eine erfundene Zahl.
    assert m["value"] == 450000
    assert m["subject"] == "M416"
    assert m["prevValue"] == 432503


def test_demo_waehlt_die_waffe_mit_dem_hoechsten_stand():
    # Bei ihr faellt die naechste Marke wirklich als naechste.
    db_pg.save_milestone_snapshot(CONN.raw, T, "account.A", {
        "weapons": {"AKM": {"kills": 45}, "M416": {"kills": 3179}}})
    CONN.raw.commit()
    d = _data(_call("GET", "/api/pubg/milestone-demo",
                    qs={"occasion": "weapon_kills"})[0])
    assert d["milestone"]["subject"] == "M416"


def test_demo_ohne_stand_liefert_trotzdem_etwas():
    # Frische Installation: ohne Snapshot muss die Vorschau laufen,
    # sonst liesse sich die Source in OBS nicht platzieren.
    d = _data(_call("GET", "/api/pubg/milestone-demo",
                    qs={"occasion": "weapon_mastered"})[0])
    # Ausgelevelt ist Tier 6, nicht ein Level.
    assert d["milestone"]["value"] == 6
    assert d["milestone"]["subject"] == "M416"


def test_demo_erlaubt_erzwungene_werte():
    d = _data(_call("GET", "/api/pubg/milestone-demo",
                    qs={"occasion": "weapon_damage", "subject": "Mk12",
                        "value": "1000000", "tier": "huge"})[0])
    m = d["milestone"]
    assert (m["subject"], m["value"], m["tier"]) == ("Mk12", 1000000, "huge")


def test_demo_lehnt_unbekannten_anlass_ab():
    # Ein vertippter Name soll nicht stumm ins Leere laufen.
    _, code = _call("GET", "/api/pubg/milestone-demo",
                    qs={"occasion": "weapon_dmg"})
    assert code == 400


def test_anlass_liste_nennt_die_zielfassung():
    # Damit ?demo=1 und ?demo=all nur zeigen, was fuer die jeweilige
    # Fassung bestimmt ist.
    d = _data(_call("GET", "/api/pubg/milestone-occasions")[0])
    ids = {o["id"]: o for o in d["occasions"]}
    assert set(ids) == set(OCCASIONS)
    assert ids["weapon_mastered"]["widget"] == "big"
    assert ids["weapon_damage"]["widget"] == "bar"


def test_probelauf_nimmt_ebenfalls_die_naechste_marke():
    # Test und Vorschau teilen den Aufbau; nur das Einreihen trennt sie.
    db_pg.save_milestone_snapshot(CONN.raw, T, "account.A", {
        "career": {"damage": 4041616}})
    CONN.raw.commit()
    d = _data(_call("POST", "/api/pubg/milestone-test",
                    {"occasion": "career_damage"})[0])
    assert d["queued"]["value"] == 4100000


def test_zwei_vorschauen_im_selben_moment_kollidieren_nicht():
    # Der Schluessel traegt Millisekunden; bei Sekunden waere die zweite
    # Vorschau derselbe Eintrag und wuerde verworfen.
    for _ in range(3):
        _call("POST", "/api/pubg/milestone-test",
              {"occasion": "weapon_damage", "widget": "bar"})
    rows = db_pg.recent_milestones(CONN.raw, T)
    assert len(rows) == 3


# ── Laute Stufe in der Vorschau ─────────────────────────────────────────────

def test_vorschau_springt_auf_die_laute_marke():
    # Ohne das bekommt man die grosse Fassung nie zu sehen: die naechste
    # echte Marke ist fast immer eine gewoehnliche.
    db_pg.save_milestone_snapshot(CONN.raw, T, "account.A", {
        "weapons": {"M416": {"damage": 432503}}})
    CONN.raw.commit()
    leise = _data(_call("GET", "/api/pubg/milestone-demo",
                        qs={"occasion": "weapon_damage"})[0])["milestone"]
    laut = _data(_call("GET", "/api/pubg/milestone-demo",
                       qs={"occasion": "weapon_damage",
                           "loud": "1"})[0])["milestone"]
    # 25.000er Schritte → 450.000 (leise); huge_every 250.000 → 500.000.
    assert (leise["value"], leise["tier"]) == (450000, "small")
    assert (laut["value"], laut["tier"]) == (500000, "huge")


def test_laute_marke_wirkt_auch_kontoweit():
    db_pg.save_milestone_snapshot(CONN.raw, T, "account.A", {
        "career": {"damage": 4041616}})
    CONN.raw.commit()
    laut = _data(_call("GET", "/api/pubg/milestone-demo",
                       qs={"occasion": "career_damage",
                           "loud": "1"})[0])["milestone"]
    # 500.000er Stufe → 4.500.000, und das ist eine halbe Million.
    assert (laut["value"], laut["tier"]) == (4500000, "huge")


def test_laut_aendert_nichts_bei_rekorden():
    # Ein Rekord hat keine Stufen; seine Stufe steht fest.
    db_pg.save_milestone_snapshot(CONN.raw, T, "account.A", {
        "weapons": {"Mk12": {"longest": 631}}})
    CONN.raw.commit()
    a = _data(_call("GET", "/api/pubg/milestone-demo",
                    qs={"occasion": "weapon_longest"})[0])["milestone"]
    b = _data(_call("GET", "/api/pubg/milestone-demo",
                    qs={"occasion": "weapon_longest",
                        "loud": "1"})[0])["milestone"]
    assert a["value"] == b["value"] and b["tier"] == "big"


def test_probelauf_nimmt_die_laute_marke_mit():
    db_pg.save_milestone_snapshot(CONN.raw, T, "account.A", {
        "career": {"damage": 4041616}})
    CONN.raw.commit()
    d = _data(_call("POST", "/api/pubg/milestone-test",
                    {"occasion": "career_damage", "loud": 1})[0])
    assert d["queued"]["tier"] == "huge"


# ── Tier-Wechsel ────────────────────────────────────────────────────────────

def test_tier_wechsel_ist_ein_anlass_nur_fuer_die_leiste():
    d = _data(_call("GET", "/api/pubg/milestone-occasions")[0])
    row = [o for o in d["occasions"] if o["id"] == "weapon_tier"][0]
    assert row["widget"] == "bar"
    assert row["kind"] == "record"


def test_tier_wechsel_feiert_den_aufstieg():
    from pubg.weapon_milestones import detect
    prev = {"weapons": {"Beryl": {"tier": 4}}, "career": {}}
    cur = {"weapons": {"Beryl": {"tier": 5}}, "career": {}}
    hit = [m for m in detect(prev, cur) if m["occasion"] == "weapon_tier"][0]
    assert (hit["value"], hit["prev_value"]) == (5, 4)


def test_gleiches_tier_feiert_nicht():
    from pubg.weapon_milestones import detect
    prev = {"weapons": {"Beryl": {"tier": 5}}, "career": {}}
    cur = {"weapons": {"Beryl": {"tier": 5}}, "career": {}}
    assert [m for m in detect(prev, cur)
            if m["occasion"] == "weapon_tier"] == []


def test_verlauf_nennt_zielfassung_und_anzeige_stand():
    # Ohne diese Felder stand im Tool bei jedem Eintrag "-" als Ziel und
    # "waiting" als Status, auch nach dem Zeigen.
    _call("POST", "/api/pubg/milestone-test",
          {"occasion": "weapon_damage", "widget": "both"})
    d = _data(_call("GET", "/api/pubg/milestone-state")[0])
    r = d["recent"][0]
    assert r["widget"] == "both"
    assert r["shownBigAt"] is None and r["shownBarAt"] is None

    _call("GET", "/api/pubg/milestone-pending",
          qs={"widget": "bar", "markShown": "1"})
    r2 = _data(_call("GET", "/api/pubg/milestone-state")[0])["recent"][0]
    assert r2["shownBarAt"] and r2["shownBigAt"] is None


def test_probelauf_nimmt_mitgeschickte_konfiguration():
    # Sonst muesste man erst speichern, um eine geaenderte
    # Schrittweite ausprobieren zu koennen.
    db_pg.save_milestone_snapshot(CONN.raw, T, "account.A", {
        "weapons": {"M416": {"damage": 432503}}})
    CONN.raw.commit()
    d = _data(_call("POST", "/api/pubg/milestone-test",
                    {"occasion": "weapon_damage",
                     "config": {"weapon_damage": {"step": 100000}}})[0])
    # 432.503 bei 100.000er Schritten → 500.000, nicht 450.000.
    assert d["queued"]["value"] == 500000


def test_mitgeschickte_konfiguration_wird_nicht_gespeichert():
    _call("POST", "/api/pubg/milestone-test",
          {"occasion": "weapon_damage",
           "config": {"weapon_damage": {"step": 100000}}})
    stored = _data(_call("GET", "/api/pubg/milestone-config")[0])
    assert stored["config"]["weapon_damage"]["step"] == \
        OCCASIONS["weapon_damage"]["step"]


def test_vorschau_behaelt_die_dezimalstellen():
    # Bei 2,4584 als Stand ergab round(x*1.05) eine 3 — ein Wert, den
    # es bei einer Lobby-K/D so nie gibt.
    db_pg.save_milestone_snapshot(CONN.raw, T, "account.A", {
        "career": {"hardest_lobby": 2.4584}})
    CONN.raw.commit()
    d = _data(_call("GET", "/api/pubg/milestone-demo",
                    qs={"occasion": "career_hardest_lobby"})[0])
    m = d["milestone"]
    assert m["value"] == pytest.approx(2.58, abs=0.01)
    assert m["prevValue"] == pytest.approx(2.4584, abs=0.001)
