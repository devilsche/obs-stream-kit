"""match_weapon_stats — Persistenz und Aggregation über Zeiträume.

Diese Tabelle beantwortet zwei Fragen, für die die Roh-Telemetrie jedes Mal
neu durchgerechnet werden müsste:
  "letzte Session von Spieler XY — welche Waffen, welche Accuracy?"
  "was macht Waffe X im Schnitt, über alle Spieler im Zeitraum?"
"""
import pytest

from pubg import db_pg


def _match(conn, t, mid, played_at):
    db_pg.insert_match(conn.raw, t, mid, "Erangel_Main", "squad-fpp", False,
                       1800, played_at, None)


def _rows(**kw):
    base = {"account_id": "acc.A", "player_name": "Alice", "team_id": 1,
            "is_bot": False, "weapon": "M416", "shots": 100, "hit_attacks": 20,
            "hits": 22, "damage": 400.0, "kills": 2,
            "head": 4, "torso": 12, "arm": 4, "leg": 1, "pelvis": 1}
    base.update(kw)
    return base


def test_upsert_and_read_back(pg_compat):
    conn, t = pg_compat[0], pg_compat[1]
    _match(conn, t, "m1", "2026-08-01T18:00:00Z")
    db_pg.upsert_weapon_stats(conn.raw, t, "m1", [_rows()])
    out = db_pg.get_weapon_stats_for_match(conn.raw, t, "m1")
    assert len(out) == 1
    assert out[0]["weapon"] == "M416" and out[0]["shots"] == 100


def test_upsert_is_idempotent(pg_compat):
    """Ein zweiter Backfill-Lauf darf nicht verdoppeln."""
    conn, t = pg_compat[0], pg_compat[1]
    _match(conn, t, "m2", "2026-08-01T18:00:00Z")
    db_pg.upsert_weapon_stats(conn.raw, t, "m2", [_rows()])
    db_pg.upsert_weapon_stats(conn.raw, t, "m2", [_rows(shots=150)])
    out = db_pg.get_weapon_stats_for_match(conn.raw, t, "m2")
    assert len(out) == 1
    assert out[0]["shots"] == 150      # ueberschrieben, nicht addiert


def test_aggregate_by_weapon_for_one_player(pg_compat):
    """'Letzte Session von XY' — je Waffe zusammengefasst."""
    conn, t = pg_compat[0], pg_compat[1]
    _match(conn, t, "m3", "2026-08-01T18:00:00Z")
    _match(conn, t, "m4", "2026-08-02T18:00:00Z")
    db_pg.upsert_weapon_stats(conn.raw, t, "m3", [
        _rows(shots=100, hit_attacks=20, hits=20, damage=300.0, head=5),
        _rows(weapon="Kar98k", shots=10, hit_attacks=4, hits=4, damage=280.0, head=2)])
    db_pg.upsert_weapon_stats(conn.raw, t, "m4", [
        _rows(shots=50, hit_attacks=15, hits=15, damage=200.0, head=3)])
    out = db_pg.aggregate_weapon_stats(conn.raw, t, since="1970-01-01T00:00:00Z",
                                       account_id="acc.A", group_by="weapon")
    by = {r["weapon"]: r for r in out}
    assert by["M416"]["shots"] == 150
    assert by["M416"]["hits"] == 35
    assert by["M416"]["matches"] == 2
    assert by["M416"]["head"] == 8
    assert by["Kar98k"]["matches"] == 1


def test_aggregate_by_player_for_one_weapon(pg_compat):
    """'Was macht Waffe X' — über alle Spieler im Zeitraum."""
    conn, t = pg_compat[0], pg_compat[1]
    _match(conn, t, "m5", "2026-08-01T18:00:00Z")
    db_pg.upsert_weapon_stats(conn.raw, t, "m5", [
        _rows(account_id="acc.A", player_name="Alice", shots=100, hits=20),
        _rows(account_id="acc.B", player_name="Bob", shots=40, hits=15),
        _rows(account_id="acc.C", player_name="Carl", weapon="AKM", shots=80, hits=5)])
    out = db_pg.aggregate_weapon_stats(conn.raw, t, since="1970-01-01T00:00:00Z",
                                       weapon="M416", group_by="player")
    names = {r["player_name"] for r in out}
    assert names == {"Alice", "Bob"}          # Carl hatte eine andere Waffe


def test_range_cutoff_filters_by_match_time(pg_compat):
    conn, t = pg_compat[0], pg_compat[1]
    _match(conn, t, "m6", "2026-07-01T18:00:00Z")
    _match(conn, t, "m7", "2026-08-20T18:00:00Z")
    db_pg.upsert_weapon_stats(conn.raw, t, "m6", [_rows(shots=999)])
    db_pg.upsert_weapon_stats(conn.raw, t, "m7", [_rows(shots=10)])
    out = db_pg.aggregate_weapon_stats(conn.raw, t, since="2026-08-01T00:00:00Z",
                                       account_id="acc.A", group_by="weapon")
    assert out[0]["shots"] == 10          # das alte Match faellt raus


def test_bots_can_be_excluded(pg_compat):
    conn, t = pg_compat[0], pg_compat[1]
    _match(conn, t, "m8", "2026-08-01T18:00:00Z")
    db_pg.upsert_weapon_stats(conn.raw, t, "m8", [
        _rows(account_id="acc.H", player_name="Human", shots=10),
        _rows(account_id="ai.1", player_name="BotX", is_bot=True, shots=90)])
    out = db_pg.aggregate_weapon_stats(conn.raw, t, since="1970-01-01T00:00:00Z",
                                       weapon="M416", group_by="player",
                                       include_bots=False)
    assert {r["player_name"] for r in out} == {"Human"}


def test_player_name_lookup_is_case_insensitive(pg_compat):
    """Gegner stehen oft nicht in players — deshalb ueber den Namen in
    dieser Tabelle suchen, und zwar unabhaengig von der Schreibweise."""
    conn, t = pg_compat[0], pg_compat[1]
    _match(conn, t, "m9", "2026-08-01T18:00:00Z")
    db_pg.upsert_weapon_stats(conn.raw, t, "m9", [_rows(player_name="Nipplz")])
    out = db_pg.aggregate_weapon_stats(conn.raw, t, since="1970-01-01T00:00:00Z",
                                       player_name="nipplz", group_by="weapon")
    assert out and out[0]["shots"] == 100


def test_empty_rows_are_safe(pg_compat):
    conn, t = pg_compat[0], pg_compat[1]
    db_pg.upsert_weapon_stats(conn.raw, t, "m10", [])
    assert db_pg.get_weapon_stats_for_match(conn.raw, t, "m10") == []


def test_matches_with_stats_is_reported(pg_compat):
    """Fuer den Backfill: welche Matches fehlen noch?"""
    conn, t = pg_compat[0], pg_compat[1]
    _match(conn, t, "m11", "2026-08-01T18:00:00Z")
    _match(conn, t, "m12", "2026-08-02T18:00:00Z")
    db_pg.upsert_weapon_stats(conn.raw, t, "m11", [_rows()])
    todo = db_pg.get_matches_without_weapon_stats(conn.raw, t)
    ids = {r["match_id"] for r in todo}
    assert "m12" in ids and "m11" not in ids
