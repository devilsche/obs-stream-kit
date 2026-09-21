"""Eingefrorene Staende schlagen ueberall durch, nicht nur im Timelog.

Der Report zeigt dieselbe Zahl an mehreren Stellen — Match-Zeile,
Phasen-Kopf, Lobby-Modal. Solange nur eine davon den Stand vom
Match-Zeitpunkt nimmt, widersprechen sich die Ansichten.
"""
import pytest

from pubg import db_pg


CONN = None
T = None
ICH = "account.A"
MATE = "account.B"
GEGNER = ["account.G%d" % i for i in range(6)]


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def _match(mid, played_at, mates=(MATE,)):
    db_pg.insert_match(CONN.raw, T, mid, "Baltic_Main", "squad-fpp", False,
                       1800, played_at, None)
    mapping = [{"account_id": ICH, "team_id": 1}]
    for m in mates:
        mapping.append({"account_id": m, "team_id": 1})
    for i, g in enumerate(GEGNER):
        mapping.append({"account_id": g, "team_id": 10 + i})
    db_pg.insert_match_team_mapping if False else None
    db_pg.insert_team_mapping(CONN.raw, T, mid, mapping)
    db_pg.insert_participants(CONN.raw, T, mid, [
        {"account_id": ICH, "team_id": 1, "kills": 2, "place": 5,
         "name": "PEX_LuCKoR"}])
    db_pg.upsert_player(CONN.raw, T, ICH, "PEX_LuCKoR", "steam", 1)
    for m in mates:
        db_pg.upsert_player(CONN.raw, T, m, "Mate1", "steam", 0)
    CONN.raw.commit()


def _heutige_snapshots():
    """Der heutige Stand — deutlich hoeher als der eingefrorene."""
    snaps = {ICH: {"kills": 900, "rounds": 400, "wins": 20},
             MATE: {"kills": 800, "rounds": 400, "wins": 20}}
    for g in GEGNER:
        snaps[g] = {"kills": 400, "rounds": 400, "wins": 10}
    db_pg.upsert_season_snapshots(CONN.raw, "lifetime", "squad-fpp", snaps,
                                  "2026-09-21T00:00:00Z")
    CONN.raw.commit()


def test_lobby_kd_nimmt_den_eingefrorenen_squad_wert():
    from pubg.lobby_kd import lobby_kd_for_matches, LIFETIME_KEY
    _match("f1", "2026-09-10T17:00:00Z")
    _heutige_snapshots()
    db_pg.save_match_player_kd(CONN.raw, "f1", [
        {"account_id": ICH, "mode": "squad-fpp", "kd": 1.66, "rounds": 390,
         "source": "season", "season_id": "div.42"},
        {"account_id": MATE, "mode": "squad-fpp", "kd": 1.20, "rounds": 300,
         "source": "season", "season_id": "div.42"}],
        "2026-09-21T00:00:00Z")
    CONN.raw.commit()
    d = lobby_kd_for_matches(CONN, T, ["f1"], LIFETIME_KEY,
                             my_account_id=ICH)
    m = d["matches"][0]
    assert round(m["squadKd"], 2) == 1.43, "(1,66 + 1,20) / 2"
    assert round(m["squadKdMates"], 2) == 1.20, "ohne mich"
    assert round(m["myKd"], 2) == 1.66
    # Die Gegner haben keinen eingefrorenen Stand -> heutiger Wert.
    assert round(m["lobbyKd"], 2) == 1.03


def test_lobby_detail_zeigt_den_eingefrorenen_stand():
    from pubg.lobby_kd import lobby_detail
    _match("f1", "2026-09-10T17:00:00Z")
    _heutige_snapshots()
    db_pg.save_match_player_kd(CONN.raw, "f1", [
        {"account_id": ICH, "mode": "squad-fpp", "kd": 1.66, "rounds": 390,
         "source": "season", "season_id": "div.42"}],
        "2026-09-21T00:00:00Z")
    CONN.raw.commit()
    d = lobby_detail(CONN, T, ["f1"], my_account_id=ICH)
    ich = [x for x in d["totals"]["squad"] if x["isMe"]][0]
    assert ich["kd"] == 1.66 and ich["seasonId"] == "div.42"
    assert ich["frozen"] is True


def test_ein_spieler_steht_zweimal_wenn_der_stand_wechselte():
    """Season-Grenze im Zeitraum: beide Staende gehoeren in die Liste."""
    from pubg.lobby_kd import lobby_detail
    _match("alt", "2026-09-10T17:00:00Z")
    _match("neu", "2026-09-20T17:00:00Z")
    _heutige_snapshots()
    for mid, kd, sid in (("alt", 1.66, "div.42"), ("neu", 2.33, "div.43")):
        db_pg.save_match_player_kd(CONN.raw, mid, [
            {"account_id": ICH, "mode": "squad-fpp", "kd": kd, "rounds": 390,
             "source": "season", "season_id": sid}],
            "2026-09-21T00:00:00Z")
    CONN.raw.commit()
    d = lobby_detail(CONN, T, ["alt", "neu"], my_account_id=ICH)
    meine = [x for x in d["totals"]["squad"] if x["isMe"]]
    assert len(meine) == 2, "alter und neuer Stand"
    assert sorted(x["kd"] for x in meine) == [1.66, 2.33]
    assert all(x["matches"] == 1 for x in meine)
    assert all("_kds" not in x for x in meine), "Hilfsfeld bleibt drin"
    # Jede Zeile sagt, fuer welchen Zeitraum sie gilt.
    alt = [x for x in meine if x["kd"] == 1.66][0]
    assert alt["from"].startswith("2026-09-10")
    assert alt["to"].startswith("2026-09-10")


def test_gleicher_stand_bleibt_eine_zeile():
    from pubg.lobby_kd import lobby_detail
    _match("m1", "2026-09-10T17:00:00Z")
    _match("m2", "2026-09-10T18:00:00Z")
    _heutige_snapshots()
    for mid in ("m1", "m2"):
        db_pg.save_match_player_kd(CONN.raw, mid, [
            {"account_id": ICH, "mode": "squad-fpp", "kd": 1.66,
             "rounds": 390, "source": "season", "season_id": "div.42"}],
            "2026-09-21T00:00:00Z")
    CONN.raw.commit()
    d = lobby_detail(CONN, T, ["m1", "m2"], my_account_id=ICH)
    meine = [x for x in d["totals"]["squad"] if x["isMe"]]
    assert len(meine) == 1 and meine[0]["matches"] == 2


def test_season_wert_wandert_und_bleibt_trotzdem_eine_zeile():
    """Innerhalb einer Season bewegt sich der Wert mit jedem Match — das
    darf keine Zeile je Runde geben."""
    from pubg.lobby_kd import lobby_detail
    _heutige_snapshots()
    for i, kd in enumerate((2.37, 2.35, 2.33, 2.23)):
        mid = "s%d" % i
        _match(mid, "2026-09-20T1%d:00:00Z" % i)
        db_pg.save_match_player_kd(CONN.raw, mid, [
            {"account_id": ICH, "mode": "squad-fpp", "kd": kd,
             "rounds": 20 + i, "source": "season", "season_id": "div.43"}],
            "2026-09-21T00:00:00Z")
    CONN.raw.commit()
    d = lobby_detail(CONN, T, ["s0", "s1", "s2", "s3"], my_account_id=ICH)
    meine = [x for x in d["totals"]["squad"] if x["isMe"]]
    assert len(meine) == 1, "eine Season, eine Zeile"
    z = meine[0]
    assert z["matches"] == 4
    assert round(z["kd"], 3) == round((2.37 + 2.35 + 2.33 + 2.23) / 4, 3)
    assert z["kdMin"] == 2.23 and z["kdMax"] == 2.37
