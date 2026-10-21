"""Paket-Griffe der ganzen Lobby: beim Einlesen und als Nachtrag."""
from pubg import db_pg
from pubg.telemetry import filter_squad_events


def _roh_griff(ts_iso, acc, item, x=50000.0, y=50000.0):
    return {"_T": "LogItemPickupFromCarepackage", "_D": ts_iso,
            "character": {"accountId": acc, "name": acc,
                          "location": {"x": x, "y": y, "z": 100.0}},
            "item": {"itemId": item},
            "carePackageName": "Carapackage_RedBox_C"}


def test_fremde_griffe_ins_paket_bleiben_erhalten():
    roh = [_roh_griff("2026-10-20T17:20:00.000Z", "account.FREMD",
                      "Item_Weapon_MG3_C")]
    out = list(filter_squad_events(roh, {"account.ICH"}))
    assert [(e["event_type"], e["actor_account"]) for e in out] == [
        ("CarePackagePickup", "account.FREMD")]


def test_nachtrag_ersetzt_die_griffe_und_ist_wiederholbar(pg_compat):
    from pubg.cli import airdrop_griffe_nachtragen
    conn = pg_compat[0]
    raw = conn.raw
    db_pg.insert_telemetry_events(raw, "nm1", [
        {"event_type": "Kill", "timestamp_ms": 1, "actor_account": "account.ICH"},
        {"event_type": "CarePackagePickup", "timestamp_ms": 1792549000000,
         "actor_account": "account.ICH", "weapon": "Item_Ammo_762mm_C"}])
    roh = [_roh_griff("2026-10-20T17:20:00.000Z", "account.FREMD",
                      "Item_Weapon_MG3_C"),
           _roh_griff("2026-10-20T17:25:00.000Z", "account.ICH",
                      "Item_Ammo_762mm_C")]
    for _ in range(2):
        airdrop_griffe_nachtragen(raw, "nm1", roh)
    with raw.cursor() as cur:
        cur.execute("SELECT event_type, actor_account FROM telemetry_events "
                    "WHERE match_id = %s ORDER BY event_type, actor_account",
                    ("nm1",))
        zeilen = [(r["event_type"], r["actor_account"]) for r in cur.fetchall()]
    assert zeilen == [("CarePackagePickup", "account.FREMD"),
                      ("CarePackagePickup", "account.ICH"),
                      ("Kill", "account.ICH")]
