"""K/D-Stand zum Zeitpunkt des Matches festhalten.

`player_season_snapshot` kennt nur den letzten Stand — der
Primaerschluessel ist (account_id, season_id, mode), jeder Abruf
ueberschreibt den vorigen. Ein Match von vor drei Wochen zeigte damit
die K/D von heute.
"""
import pytest

from pubg import db_pg


CONN = None
T = None
ICH = "account.A"
MATE = "account.B"


@pytest.fixture(autouse=True)
def _bind(pg_compat):
    global CONN, T
    CONN, T = pg_compat[0], pg_compat[1]
    yield
    CONN, T = None, None


def test_squad_kd_wird_je_match_eingefroren():
    from pubg.db_pg import save_match_player_kd, get_match_player_kd
    save_match_player_kd(CONN.raw, "mk1", [
        {"account_id": ICH, "mode": "squad-fpp", "kd": 2.41, "rounds": 390,
         "source": "current_season", "season_id": "div.17"},
        {"account_id": MATE, "mode": "squad-fpp", "kd": 1.12, "rounds": 88,
         "source": "lifetime", "season_id": None},
    ], "2026-09-21T18:00:00Z")
    CONN.raw.commit()
    d = get_match_player_kd(CONN.raw, ["mk1"])
    assert d["mk1"][ICH]["kd"] == 2.41
    assert d["mk1"][ICH]["rounds"] == 390
    assert d["mk1"][MATE]["source"] == "lifetime"


def test_spaeterer_stand_ueberschreibt_den_eingefrorenen_nicht():
    """Der Sinn der Sache: Was beim Match galt, bleibt stehen."""
    from pubg.db_pg import save_match_player_kd, get_match_player_kd
    save_match_player_kd(CONN.raw, "mk2", [
        {"account_id": ICH, "mode": "squad-fpp", "kd": 2.41, "rounds": 390,
         "source": "current_season", "season_id": "div.17"}],
        "2026-09-21T18:00:00Z")
    CONN.raw.commit()
    # Zwei Wochen spaeter ist die K/D gestiegen — das Match von damals
    # darf davon nichts mitbekommen.
    save_match_player_kd(CONN.raw, "mk2", [
        {"account_id": ICH, "mode": "squad-fpp", "kd": 2.88, "rounds": 460,
         "source": "current_season", "season_id": "div.17"}],
        "2026-10-05T18:00:00Z")
    CONN.raw.commit()
    d = get_match_player_kd(CONN.raw, ["mk2"])
    assert d["mk2"][ICH]["kd"] == 2.41, "der erste Stand zaehlt"


def test_lobby_kennzahlen_je_match():
    from pubg.db_pg import save_match_lobby_kd, get_match_lobby_kd
    save_match_lobby_kd(CONN.raw, "mk3", {
        "lobbyKd": 1.37, "top5": 2.92, "median": 1.21,
        "players": 93, "coverage": 88.0}, "2026-09-21T18:00:00Z")
    CONN.raw.commit()
    d = get_match_lobby_kd(CONN.raw, ["mk3"])
    assert d["mk3"]["lobbyKd"] == 1.37
    assert d["mk3"]["top5"] == 2.92
    assert d["mk3"]["players"] == 93


def test_ohne_eintrag_kommt_nichts_zurueck():
    """Alte Matches haben keinen Eintrag — der Aufrufer faellt dann auf
    den aktuellen Snapshot zurueck, statt eine Luecke zu zeigen."""
    from pubg.db_pg import get_match_player_kd, get_match_lobby_kd
    assert get_match_player_kd(CONN.raw, ["gibtsnicht"]) == {}
    assert get_match_lobby_kd(CONN.raw, ["gibtsnicht"]) == {}


def _match(mid, played_at="2026-09-21T18:00:00Z"):
    db_pg.insert_match(CONN.raw, T, mid, "Baltic_Main", "squad-fpp", False,
                       1800, played_at, None)
    db_pg.insert_team_mapping(CONN.raw, T, mid, [
        {"account_id": ICH, "team_id": 1},
        {"account_id": MATE, "team_id": 1},
        {"account_id": "account.FREMD", "team_id": 7}])
    db_pg.upsert_player(CONN.raw, T, ICH, "PEX_LuCKoR", "steam", 1)
    db_pg.upsert_player(CONN.raw, T, MATE, "Mate1", "steam", 0)
    CONN.raw.commit()


def test_frischer_snapshot_wird_nicht_erneut_geholt():
    """Das Squad soll aktuell sein, aber nicht bei jedem Tick neu."""
    from pubg.poller import squad_accounts_zum_auffrischen
    _match("mk4")
    db_pg.upsert_season_snapshots(
        CONN.raw, "lifetime", "squad-fpp",
        {ICH: {"kills": 100, "rounds": 50, "wins": 0, "kd": 2.0}},
        _jetzt_minus(minuten=5))
    CONN.raw.commit()
    offen = squad_accounts_zum_auffrischen(CONN, T, "mk4", "lifetime",
                                            "squad-fpp", max_alter_min=30)
    # ICH ist frisch, MATE fehlt ganz — nur der muss geholt werden.
    assert ICH not in offen and MATE in offen


def test_alter_snapshot_wird_aufgefrischt():
    from pubg.poller import squad_accounts_zum_auffrischen
    _match("mk5")
    db_pg.upsert_season_snapshots(
        CONN.raw, "lifetime", "squad-fpp",
        {ICH: {"kills": 100, "rounds": 50, "wins": 0, "kd": 2.0}},
        _jetzt_minus(minuten=90))
    CONN.raw.commit()
    offen = squad_accounts_zum_auffrischen(CONN, T, "mk5", "lifetime",
                                            "squad-fpp", max_alter_min=30)
    assert ICH in offen


def test_gegner_gehoeren_nicht_zum_squad():
    from pubg.poller import squad_accounts_zum_auffrischen
    _match("mk6")
    offen = squad_accounts_zum_auffrischen(CONN, T, "mk6", "lifetime",
                                            "squad-fpp", max_alter_min=30)
    assert "account.FREMD" not in offen


def _jetzt_minus(minuten=0):
    import datetime
    d = (datetime.datetime.now(datetime.timezone.utc)
         - datetime.timedelta(minutes=minuten))
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_timelog_zeigt_den_stand_von_damals():
    """Der Kern: Im Match-Detail steht die K/D, die beim Match galt.

    Ohne das zeigte ein Match von vor drei Wochen die heutigen Werte —
    und damit andere Zahlen, als man in der Aufzeichnung gesehen hat.
    """
    from pubg.aggregations import compute_match_detail
    from pubg.db_pg import save_match_player_kd
    _match("mk7")
    db_pg.insert_participants(CONN.raw, T, "mk7", [{
        "account_id": ICH, "name": "PEX_LuCKoR", "team_id": 1, "place": 1,
        "kills": 3, "headshot_kills": 0, "assists": 0, "dbnos": 0,
        "revives": 0, "damage_dealt": 300.0, "longest_kill": 0.0,
        "time_survived": 1800, "walk_distance": 0.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0,
        "boosts": 0, "team_kills": 0}])
    db_pg.insert_telemetry_events(CONN.raw, "mk7", [{
        "event_type": "Kill", "timestamp_ms": 1000, "actor_account": ICH,
        "target_account": "account.FREMD", "weapon": "WeapAK47_C",
        "payload_json": "{}"}])
    # Heutiger Stand: hoch. Stand beim Match: niedrig.
    db_pg.upsert_season_snapshots(
        CONN.raw, "lifetime", "squad-fpp",
        {ICH: {"kills": 900, "rounds": 300, "wins": 0, "kd": 3.0}},
        "2026-09-21T18:00:00Z")
    save_match_player_kd(CONN.raw, "mk7", [
        {"account_id": ICH, "mode": "squad-fpp", "kd": 1.25, "rounds": 80,
         "source": "current_season", "season_id": "div.17"}],
        "2026-09-01T12:00:00Z")
    CONN.raw.commit()
    d = compute_match_detail(CONN, T, ICH, "mk7") or {}
    kd = (d.get("playerKds") or {}).get(ICH)
    assert kd is not None
    assert kd["kd"] == 1.25, "der eingefrorene Stand muss gewinnen"
    assert kd.get("frozen") is True


def test_ohne_eingefrorenen_stand_gilt_der_aktuelle():
    """Alte Matches ohne Eintrag zeigen weiter den heutigen Wert — eine
    Luecke waere schlechter als ein leicht verschobener Wert."""
    from pubg.aggregations import compute_match_detail
    _match("mk8")
    db_pg.insert_participants(CONN.raw, T, "mk8", [{
        "account_id": ICH, "name": "PEX_LuCKoR", "team_id": 1, "place": 1,
        "kills": 1, "headshot_kills": 0, "assists": 0, "dbnos": 0,
        "revives": 0, "damage_dealt": 100.0, "longest_kill": 0.0,
        "time_survived": 1800, "walk_distance": 0.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0,
        "boosts": 0, "team_kills": 0}])
    db_pg.insert_telemetry_events(CONN.raw, "mk8", [{
        "event_type": "Kill", "timestamp_ms": 1000, "actor_account": ICH,
        "target_account": "account.FREMD", "weapon": "WeapAK47_C",
        "payload_json": "{}"}])
    db_pg.upsert_season_snapshots(
        CONN.raw, "lifetime", "squad-fpp",
        {ICH: {"kills": 900, "rounds": 300, "wins": 0, "kd": 3.0}},
        "2026-09-21T18:00:00Z")
    CONN.raw.commit()
    d = compute_match_detail(CONN, T, ICH, "mk8") or {}
    kd = (d.get("playerKds") or {}).get(ICH)
    assert kd is not None and kd["kd"] == 3.0
    assert not kd.get("frozen")


def test_einfrieren_schreibt_squad_und_lobby():
    """Nach einem Match wird beides festgehalten."""
    from unittest.mock import MagicMock, patch
    from pubg.poller import kd_stand_einfrieren
    from pubg.db_pg import get_match_player_kd, get_match_lobby_kd
    _match("mk9")
    db_pg.upsert_season_snapshots(
        CONN.raw, "lifetime", "squad-fpp",
        {ICH: {"kills": 200, "rounds": 100, "wins": 0, "kd": 2.0},
         MATE: {"kills": 60, "rounds": 60, "wins": 0, "kd": 1.0}},
        "2026-09-21T17:55:00Z")
    CONN.raw.commit()
    client = MagicMock()
    with patch("pubg.lobby_kd.lobby_kd_for_matches", return_value={
            "matches": [{"matchId": "mk9", "lobbyKd": 1.44,
                         "lobbyTop5": 2.9, "lobbyMedian": 1.2,
                         "players": 90, "coverage": 77.0}]}):
        kd_stand_einfrieren(CONN, T, client, "mk9")
    CONN.raw.commit()
    sp = get_match_player_kd(CONN.raw, ["mk9"]).get("mk9") or {}
    assert ICH in sp and sp[ICH]["kd"] is not None
    lo = get_match_lobby_kd(CONN.raw, ["mk9"]).get("mk9") or {}
    assert lo.get("lobbyKd") == 1.44
    assert lo.get("players") == 90
