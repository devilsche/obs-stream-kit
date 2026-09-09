"""Feuerstoss-Metriken: welcher Schuss eines Stosses ist der erste Treffer?

Das ist der messbare Anteil von Crosshair-Placement. Trifft Schuss 1, stand
das Visier schon am Ziel; trifft erst Schuss 5, wurde nachgezogen. Die
Trefferquote allein sieht beides gleich.
"""
import pytest

from pubg import burst_analysis as ba


# ── Feuerstoesse trennen ───────────────────────────────────────────────────

def test_split_bursts_groups_shots_within_the_gap():
    assert ba.split_bursts([0.0, 0.1, 0.2]) == [[0.0, 0.1, 0.2]]


def test_split_bursts_starts_a_new_burst_after_a_pause():
    out = ba.split_bursts([0.0, 0.1, 5.0, 5.1])
    assert out == [[0.0, 0.1], [5.0, 5.1]]


def test_split_bursts_uses_the_gap_boundary_inclusively():
    """Genau BURST_GAP_S Pause gehoert noch zum Stoss — sonst zerfaellt
    halbautomatisches Feuer am Grenzwert in Einzelstoesse."""
    g = ba.BURST_GAP_S
    assert ba.split_bursts([0.0, g]) == [[0.0, g]]
    assert ba.split_bursts([0.0, g + 0.01]) == [[0.0], [g + 0.01]]


def test_split_bursts_sorts_and_ignores_broken_times():
    assert ba.split_bursts([0.2, None, 0.1]) == [[0.1, 0.2]]
    assert ba.split_bursts([]) == []
    assert ba.split_bursts(None) == []


# ── Index des ersten Treffers ──────────────────────────────────────────────

def test_first_hit_index_is_one_when_the_opening_shot_lands():
    assert ba.first_hit_index([10.0, 10.1, 10.2], [10.05]) == 1


def test_first_hit_index_counts_the_shots_before_the_hit():
    # Treffer nach dem dritten Schuss
    assert ba.first_hit_index([10.0, 10.1, 10.2, 10.3], [10.25]) == 3


def test_first_hit_index_is_none_without_a_hit():
    assert ba.first_hit_index([10.0, 10.1], [50.0]) is None


def test_first_hit_index_accepts_a_hit_shortly_after_the_last_shot():
    """Projektilflug: ein Kar98k-Treffer auf 300 m landet erst Sekunden
    spaeter. Ohne die Nachlaufzeit gilt jeder Weitschuss als Fehlschuss."""
    last = 10.0
    assert ba.first_hit_index([last], [last + ba.HIT_LAG_S - 0.01]) == 1
    assert ba.first_hit_index([last], [last + ba.HIT_LAG_S + 0.5]) is None


def test_first_hit_index_ignores_hits_before_the_burst():
    assert ba.first_hit_index([10.0, 10.1], [9.0]) is None


# ── Rolle: eroeffnet oder reagiert ─────────────────────────────────────────

def test_role_is_initiated_without_incoming_damage():
    assert ba.role_of(100.0, []) == "initiated"
    assert ba.role_of(100.0, [50.0]) == "initiated"


def test_role_is_reacting_after_incoming_damage():
    """Der Bias, den die Metrik sonst versteckt: wer aus dem Hinterhalt
    eroeffnet, hat den Erstschuss-Treffer leichter als wer auf einen
    bereits schiessenden Gegner antwortet."""
    assert ba.role_of(100.0, [95.0]) == "reacting"


def test_role_window_has_a_boundary():
    w = ba.REACT_WINDOW_S
    assert ba.role_of(100.0, [100.0 - w]) == "reacting"
    assert ba.role_of(100.0, [100.0 - w - 0.01]) == "initiated"


def test_role_ignores_damage_taken_after_the_burst_started():
    assert ba.role_of(100.0, [100.5]) == "initiated"


# ── Zusammenfuehren ────────────────────────────────────────────────────────

def _ev(t, typ, **kw):
    """Sekunden ueber 59 auf Minuten umlegen — "20:00:60.000" ist kein
    gueltiger Zeitstempel und wuerde stillschweigend verworfen."""
    mm, ss = divmod(float(t), 60.0)
    return {"_T": typ,
            "_D": f"2026-09-08T20:{int(mm):02d}:{ss:06.3f}Z", **kw}


def _attack(t, name, weapon):
    return _ev(t, "LogPlayerAttack", attacker={"name": name},
               weapon={"itemId": weapon})


def _damage(t, attacker, victim, weapon):
    return _ev(t, "LogPlayerTakeDamage", attacker={"name": attacker},
               victim={"name": victim}, damageCauserName=weapon,
               damageTypeCategory="Damage_Gun")


def test_analyse_bursts_reports_per_player_weapon_and_role():
    events = [
        _attack(1.0, "me", "Item_Weapon_HK416_C"),
        _damage(1.05, "me", "them", "WeapHK416_C"),      # 1. Schuss trifft
        _attack(10.0, "me", "Item_Weapon_HK416_C"),
        _attack(10.1, "me", "Item_Weapon_HK416_C"),
        _damage(10.15, "me", "them", "WeapHK416_C"),      # 2. Schuss trifft
    ]
    out = ba.analyse_bursts(events)
    w = out["me"]["M416"]["initiated"]
    assert w["bursts"] == 2
    assert w["hitBursts"] == 2
    assert w["firstShotHits"] == 1
    assert w["hitIndexSum"] == 3          # 1 + 2


def test_analyse_bursts_separates_the_two_roles():
    events = [
        # Ich nehme zuerst Schaden, schiesse dann -> reacting
        _damage(1.0, "them", "me", "WeapUMP_C"),
        _attack(2.0, "me", "Item_Weapon_HK416_C"),
        _damage(2.05, "me", "them", "WeapHK416_C"),
        # Viel spaeter ohne eingehenden Schaden -> initiated
        _attack(60.0, "me", "Item_Weapon_HK416_C"),
        _damage(60.05, "me", "them", "WeapHK416_C"),
    ]
    out = ba.analyse_bursts(events)["me"]["M416"]
    assert out["reacting"]["bursts"] == 1
    assert out["reacting"]["firstShotHits"] == 1
    assert out["initiated"]["bursts"] == 1
    assert out["initiated"]["firstShotHits"] == 1


def test_analyse_bursts_matches_attack_and_damage_weapon_ids():
    """Attack meldet "Item_Weapon_HK416_C", TakeDamage "WeapHK416_C" — ohne
    Normalisierung findet kein Treffer je seinen Schuss."""
    events = [
        _attack(1.0, "me", "Item_Weapon_HK416_C"),
        _damage(1.05, "me", "them", "WeapHK416_C"),
    ]
    out = ba.analyse_bursts(events)
    assert list(out["me"].keys()) == ["M416"]
    assert out["me"]["M416"]["initiated"]["hitBursts"] == 1


def test_analyse_bursts_counts_a_hit_only_for_the_weapon_that_fired():
    """Ein Treffer mit der Pistole darf keinen AR-Stoss als Treffer
    ausweisen — sonst wertet jede Zweitwaffe die erste auf."""
    events = [
        _attack(1.0, "me", "Item_Weapon_HK416_C"),
        _damage(1.05, "me", "them", "WeapG18_C"),
    ]
    out = ba.analyse_bursts(events)
    assert out["me"]["M416"]["initiated"]["bursts"] == 1
    assert out["me"]["M416"]["initiated"]["hitBursts"] == 0


def test_analyse_bursts_ignores_non_gun_damage():
    """Zonenschaden und Sturz sind keine Treffer und markieren auch keine
    Reaktion — sonst gilt jeder Stoss nach einem Blue-Zone-Tick als
    Antwort auf Feindfeuer."""
    events = [
        _ev(1.0, "LogPlayerTakeDamage", attacker={"name": ""},
            victim={"name": "me"}, damageTypeCategory="Damage_BlueZone"),
        _attack(2.0, "me", "Item_Weapon_HK416_C"),
        _damage(2.05, "me", "them", "WeapHK416_C"),
    ]
    out = ba.analyse_bursts(events)["me"]["M416"]
    assert out["initiated"]["bursts"] == 1
    assert out["reacting"]["bursts"] == 0


def test_analyse_bursts_skips_players_without_a_name():
    events = [_ev(1.0, "LogPlayerAttack", attacker={},
                  weapon={"itemId": "Item_Weapon_HK416_C"})]
    assert ba.analyse_bursts(events) == {}


def test_analyse_bursts_survives_broken_timestamps():
    events = [
        {"_T": "LogPlayerAttack", "_D": "kaputt",
         "attacker": {"name": "me"}, "weapon": {"itemId": "Item_Weapon_HK416_C"}},
        _attack(1.0, "me", "Item_Weapon_HK416_C"),
    ]
    out = ba.analyse_bursts(events)
    assert out["me"]["M416"]["initiated"]["bursts"] == 1


def test_analyse_bursts_handles_an_empty_list():
    assert ba.analyse_bursts([]) == {}
    assert ba.analyse_bursts(None) == {}


# ── DB-Zeilen ──────────────────────────────────────────────────────────────

def test_to_row_fields_flattens_both_roles():
    stat = {"initiated": {"bursts": 5, "hitBursts": 3, "firstShotHits": 2,
                          "hitIndexSum": 7},
            "reacting": {"bursts": 4, "hitBursts": 1, "firstShotHits": 0,
                         "hitIndexSum": 3}}
    row = ba.to_row_fields(stat)
    assert row == {"bursts_init": 5, "hit_bursts_init": 3,
                   "first_shot_init": 2, "hit_index_sum_init": 7,
                   "bursts_react": 4, "hit_bursts_react": 1,
                   "first_shot_react": 0, "hit_index_sum_react": 3}


def test_to_row_fields_defaults_missing_roles_to_zero():
    row = ba.to_row_fields({})
    assert set(row.values()) == {0}
    assert len(row) == 8


# ── Kennzahlen ─────────────────────────────────────────────────────────────

def test_first_shot_pct_needs_hit_bursts():
    assert ba.first_shot_pct(hit_bursts=0, first_shot_hits=0) is None
    assert ba.first_shot_pct(hit_bursts=4, first_shot_hits=1) == 25.0


def test_avg_hit_index_needs_hit_bursts():
    assert ba.avg_hit_index(hit_bursts=0, hit_index_sum=0) is None
    assert ba.avg_hit_index(hit_bursts=4, hit_index_sum=10) == 2.5


# ── Anbindung an match_weapon_stats ────────────────────────────────────────

def test_to_db_rows_carries_the_burst_columns():
    from pubg.weapon_performance import to_db_rows
    analysis = {"players": {"me": {
        "accountId": "account.me", "teamId": 1, "isBot": False,
        "weapons": {"M416": {"shots": 10, "hits": 3, "kills": 0,
                             "damage": 90.0}}}}}
    bursts = {"me": {"M416": {
        "initiated": {"bursts": 4, "hitBursts": 2, "firstShotHits": 1,
                      "hitIndexSum": 5},
        "reacting": {"bursts": 2, "hitBursts": 1, "firstShotHits": 0,
                     "hitIndexSum": 3}}}}
    row = to_db_rows(analysis, bursts=bursts)[0]
    assert row["bursts_init"] == 4
    assert row["first_shot_init"] == 1
    assert row["hit_index_sum_init"] == 5
    assert row["bursts_react"] == 2
    assert row["first_shot_react"] == 0


def test_to_db_rows_without_bursts_writes_zeros():
    """Altbestand und Tests ohne Rohevents muessen weiter durchlaufen."""
    from pubg.weapon_performance import to_db_rows
    analysis = {"players": {"me": {
        "accountId": "account.me",
        "weapons": {"M416": {"shots": 1, "hits": 0, "kills": 0}}}}}
    row = to_db_rows(analysis)[0]
    for col in ("bursts_init", "hit_bursts_init", "first_shot_init",
                "hit_index_sum_init", "bursts_react", "hit_bursts_react",
                "first_shot_react", "hit_index_sum_react"):
        assert row[col] == 0, col


def test_burst_columns_are_all_in_the_insert_list():
    """Eine Spalte, die im Schema steht aber nicht in _MWS_COLS, wird
    nie geschrieben und faellt erst in der Auswertung auf."""
    from pubg.db_pg import _MWS_COLS
    from pubg.burst_analysis import ROW_FIELDS
    for cols in ROW_FIELDS.values():
        for col in cols.values():
            assert col in _MWS_COLS, col


# ── Backfill ───────────────────────────────────────────────────────────────

def test_shooter_count_separates_raw_from_reconstructed():
    """Aeltere Archiv-Files wurden aus der DB rekonstruiert und haben nur
    Squad-Events. Werte daraus kaemen aus zwei statt neunzig Spielern."""
    from scripts.backfill_bursts import shooter_count, RAW_MIN_SHOOTERS
    recon = [{"_T": "LogPlayerAttack", "attacker": {"accountId": f"a{i%2}"}}
             for i in range(200)]
    raw = [{"_T": "LogPlayerAttack", "attacker": {"accountId": f"a{i}"}}
           for i in range(90)]
    assert shooter_count(recon) == 2
    assert shooter_count(raw) == 90
    assert shooter_count(recon) < RAW_MIN_SHOOTERS <= shooter_count(raw)


def test_shooter_count_ignores_events_without_an_account():
    from scripts.backfill_bursts import shooter_count
    assert shooter_count([{"_T": "LogPlayerAttack", "attacker": {}}]) == 0
    assert shooter_count([{"_T": "LogPlayerTakeDamage",
                           "attacker": {"accountId": "a"}}]) == 0
    assert shooter_count([]) == 0
    assert shooter_count(None) == 0


def test_rows_for_match_keys_on_account_and_weapon():
    from scripts.backfill_bursts import rows_for_match
    ev = lambda t, typ, **kw: {"_T": typ, "_D": f"2026-09-08T20:00:{t:06.3f}Z",
                               **kw}
    events = [
        {"_T": "LogPlayerCreate",
         "character": {"name": "me", "accountId": "account.me", "teamId": 1}},
        ev(1.0, "LogPlayerAttack", attacker={"name": "me",
                                             "accountId": "account.me"},
           weapon={"itemId": "Item_Weapon_HK416_C"}),
        ev(1.05, "LogPlayerTakeDamage", attacker={"name": "me"},
           victim={"name": "them"}, damageCauserName="WeapHK416_C",
           damageTypeCategory="Damage_Gun"),
    ]
    rows = rows_for_match(events)
    assert ("account.me", "M416") in rows
    assert rows[("account.me", "M416")]["first_shot_init"] == 1


def test_rows_for_match_drops_players_without_an_account_id():
    """Ohne Id gibt es keinen Primaerschluessel — die Zeile faellt weg."""
    from scripts.backfill_bursts import rows_for_match
    events = [{"_T": "LogPlayerAttack", "_D": "2026-09-08T20:00:01.000Z",
               "attacker": {"name": "ghost"},
               "weapon": {"itemId": "Item_Weapon_HK416_C"}}]
    assert rows_for_match(events) == {}


def test_backfill_columns_match_the_analysis_fields():
    from scripts.backfill_bursts import BURST_COLS
    from pubg.burst_analysis import to_row_fields
    assert set(BURST_COLS) == set(to_row_fields({}).keys())
