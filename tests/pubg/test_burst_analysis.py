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
                          "hitIndexSum": 7, "shotsAfterHit": 9,
                          "hitsAfterHit": 4},
            "reacting": {"bursts": 4, "hitBursts": 1, "firstShotHits": 0,
                         "hitIndexSum": 3, "shotsAfterHit": 2,
                         "hitsAfterHit": 1}}
    row = ba.to_row_fields(stat)
    assert row == {"bursts_init": 5, "hit_bursts_init": 3,
                   "first_shot_init": 2, "hit_index_sum_init": 7,
                   "shots_after_hit_init": 9, "hits_after_hit_init": 4,
                   "bursts_react": 4, "hit_bursts_react": 1,
                   "first_shot_react": 0, "hit_index_sum_react": 3,
                   "shots_after_hit_react": 2, "hits_after_hit_react": 1}


def test_to_row_fields_defaults_missing_roles_to_zero():
    row = ba.to_row_fields({})
    assert set(row.values()) == {0}
    assert len(row) == 12


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


# ── Auswertung: Klassen falten und vergleichen ─────────────────────────────

def test_class_of_weapon_name_inverts_weapon_names():
    """In match_weapon_stats steht der Klarname ("M416"), die Kategorie
    haengt aber an der Roh-Id ("WeapHK416_C"). Ohne die Umkehrung fiele
    jede Waffe auf "other" und der Vergleich mischte Sniper mit SMG."""
    from pubg.burst_analysis import class_of_weapon_name
    assert class_of_weapon_name("M416") == "ar"
    assert class_of_weapon_name("Kar98k") == "sniper"
    assert class_of_weapon_name("UMP45") == "smg"
    assert class_of_weapon_name("Mini 14") == "dmr"
    assert class_of_weapon_name("gibtsnicht") == "other"
    assert class_of_weapon_name(None) == "other"


def test_fold_bursts_by_class_sums_per_account_and_class():
    from pubg.burst_analysis import fold_bursts_by_class
    rows = [
        {"account_id": "a", "weapon": "M416", "bursts_init": 10,
         "hit_bursts_init": 4, "first_shot_init": 2, "hit_index_sum_init": 9,
         "bursts_react": 5, "hit_bursts_react": 2, "first_shot_react": 0,
         "hit_index_sum_react": 6},
        {"account_id": "a", "weapon": "Beryl", "bursts_init": 6,
         "hit_bursts_init": 2, "first_shot_init": 1, "hit_index_sum_init": 5,
         "bursts_react": 0, "hit_bursts_react": 0, "first_shot_react": 0,
         "hit_index_sum_react": 0},
        {"account_id": "b", "weapon": "Kar98k", "bursts_init": 3,
         "hit_bursts_init": 3, "first_shot_init": 3, "hit_index_sum_init": 3,
         "bursts_react": 0, "hit_bursts_react": 0, "first_shot_react": 0,
         "hit_index_sum_react": 0},
    ]
    out = fold_bursts_by_class(rows)
    ar = out[("a", "ar")]
    assert ar["initiated"]["bursts"] == 16
    assert ar["initiated"]["hitBursts"] == 6
    assert ar["initiated"]["firstShotHits"] == 3
    assert ar["initiated"]["hitIndexSum"] == 14
    assert ar["reacting"]["bursts"] == 5
    assert out[("b", "sniper")]["initiated"]["firstShotHits"] == 3
    assert ("a", "sniper") not in out


def test_fold_bursts_skips_rows_without_any_burst():
    """Der Grossteil der Tabelle stammt aus Matches vor dem Backfill —
    ohne diesen Filter erzeugen sie Klassen-Eintraege mit Nenner 0."""
    from pubg.burst_analysis import fold_bursts_by_class
    rows = [{"account_id": "a", "weapon": "M416", "bursts_init": 0,
             "hit_bursts_init": 0, "first_shot_init": 0,
             "hit_index_sum_init": 0, "bursts_react": 0,
             "hit_bursts_react": 0, "first_shot_react": 0,
             "hit_index_sum_react": 0}]
    assert fold_bursts_by_class(rows) == {}


def test_compare_to_pool_reports_own_pool_and_percentile():
    from pubg.burst_analysis import compare_to_pool
    folded = {
        ("me", "ar"): {"initiated": {"bursts": 100, "hitBursts": 40,
                                     "firstShotHits": 10, "hitIndexSum": 120},
                       "reacting": {"bursts": 0, "hitBursts": 0,
                                    "firstShotHits": 0, "hitIndexSum": 0}},
    }
    # Neun Gegner, alle besser als ich (50 %)
    for i in range(9):
        folded[(f"p{i}", "ar")] = {
            "initiated": {"bursts": 100, "hitBursts": 40,
                          "firstShotHits": 20, "hitIndexSum": 80},
            "reacting": {"bursts": 0, "hitBursts": 0, "firstShotHits": 0,
                         "hitIndexSum": 0}}
    out = compare_to_pool(folded, "me", min_hit_bursts=10)
    ar = next(r for r in out if r["class"] == "ar" and r["role"] == "initiated")
    assert ar["firstShotPct"] == 25.0            # 10 von 40
    assert ar["poolFirstShotPct"] == 50.0        # 9x 20 von 9x 40
    assert ar["poolPlayers"] == 9
    assert ar["percentile"] == 0.0               # alle besser
    assert ar["avgHitIndex"] == 3.0              # 120/40
    assert ar["poolAvgHitIndex"] == 2.0


def test_compare_to_pool_leaves_out_classes_the_player_never_used():
    from pubg.burst_analysis import compare_to_pool
    folded = {("p0", "smg"): {"initiated": {"bursts": 50, "hitBursts": 20,
                                            "firstShotHits": 5,
                                            "hitIndexSum": 40},
                              "reacting": {"bursts": 0, "hitBursts": 0,
                                           "firstShotHits": 0,
                                           "hitIndexSum": 0}}}
    assert compare_to_pool(folded, "me") == []


def test_compare_to_pool_marks_a_thin_own_sample():
    """Unter der Schwelle bleibt die Zeile sichtbar, aber als duenn
    markiert — genauso wie bei den Landing Spots."""
    from pubg.burst_analysis import compare_to_pool, RELIABLE_HIT_BURSTS
    folded = {("me", "ar"): {"initiated": {"bursts": 5, "hitBursts": 3,
                                           "firstShotHits": 1,
                                           "hitIndexSum": 7},
                             "reacting": {"bursts": 0, "hitBursts": 0,
                                          "firstShotHits": 0,
                                          "hitIndexSum": 0}}}
    row = compare_to_pool(folded, "me")[0]
    assert row["hitBursts"] == 3
    assert row["reliable"] is False
    assert RELIABLE_HIT_BURSTS > 3


def test_compare_to_pool_returns_none_percentile_without_a_pool():
    """Eine Zahl ohne Vergleichsgruppe darf nicht wie ein Perzentil
    aussehen."""
    from pubg.burst_analysis import compare_to_pool
    folded = {("me", "ar"): {"initiated": {"bursts": 100, "hitBursts": 50,
                                           "firstShotHits": 20,
                                           "hitIndexSum": 100},
                             "reacting": {"bursts": 0, "hitBursts": 0,
                                          "firstShotHits": 0,
                                          "hitIndexSum": 0}}}
    row = compare_to_pool(folded, "me")[0]
    assert row["percentile"] is None
    assert row["poolPlayers"] == 0
    assert row["poolFirstShotPct"] is None


def test_compare_to_pool_role_gap_shows_the_bias():
    """Der Punkt der Rollen-Trennung: die Luecke zwischen eroeffnen und
    reagieren ist selbst die Aussage."""
    from pubg.burst_analysis import compare_to_pool
    folded = {("me", "ar"): {
        "initiated": {"bursts": 100, "hitBursts": 50, "firstShotHits": 25,
                      "hitIndexSum": 100},
        "reacting": {"bursts": 100, "hitBursts": 50, "firstShotHits": 5,
                     "hitIndexSum": 150}}}
    rows = {r["role"]: r for r in compare_to_pool(folded, "me")}
    assert rows["initiated"]["firstShotPct"] == 50.0
    assert rows["reacting"]["firstShotPct"] == 10.0


# ── DB-Layer ───────────────────────────────────────────────────────────────

def test_burst_discipline_reads_the_whole_lobby(pg_compat):
    """Der Punkt der acht Spalten: die Referenz kommt aus
    match_weapon_stats und damit von allen Lobby-Spielern, nicht aus
    telemetry_events mit seinen zwei Squad-Schuetzen."""
    from pubg import shot_quality as sq
    conn, t1, _ = pg_compat
    conn.execute("INSERT INTO matches (tenant_id, match_id, map_name, "
                 "game_mode, played_at) VALUES (?, ?, ?, ?, ?)",
                 (t1, "m1", "Baltic_Main", "squad", "2026-09-01T12:00:00Z"))
    def add(acc, weapon, bi, hbi, fsi, hisi):
        conn.execute(
            "INSERT INTO match_weapon_stats (tenant_id, match_id, account_id, "
            "weapon, is_bot, shots, bursts_init, hit_bursts_init, "
            "first_shot_init, hit_index_sum_init) "
            "VALUES (?, ?, ?, ?, false, 1, ?, ?, ?, ?)",
            (t1, "m1", acc, weapon, bi, hbi, fsi, hisi))
    add("account.me", "M416", 50, 20, 5, 60)          # 25 %
    for i in range(12):
        add(f"enemy{i}", "M416", 40, 20, 10, 40)      # 50 %
    conn.commit()

    out = sq.burst_discipline(conn, t1, "account.me")
    assert out["matches"] == 1
    row = next(r for r in out["rows"]
               if r["class"] == "ar" and r["role"] == "initiated")
    assert row["firstShotPct"] == 25.0
    assert row["poolFirstShotPct"] == 50.0
    assert row["poolPlayers"] == 12
    assert row["percentile"] == 0.0
    assert row["reliable"] is True


def test_burst_discipline_keeps_bots_out_of_the_pool(pg_compat):
    """Bots schiessen nach anderen Regeln und wuerden den Pool druecken."""
    from pubg import shot_quality as sq
    conn, t1, _ = pg_compat
    conn.execute("INSERT INTO matches (tenant_id, match_id, map_name, "
                 "game_mode, played_at) VALUES (?, ?, ?, ?, ?)",
                 (t1, "m1", "Baltic_Main", "squad", "2026-09-01T12:00:00Z"))
    conn.execute(
        "INSERT INTO match_weapon_stats (tenant_id, match_id, account_id, "
        "weapon, is_bot, shots, bursts_init, hit_bursts_init, "
        "first_shot_init, hit_index_sum_init) "
        "VALUES (?, ?, ?, ?, false, 1, 10, 10, 5, 20)",
        (t1, "m1", "account.me", "M416"))
    conn.execute(
        "INSERT INTO match_weapon_stats (tenant_id, match_id, account_id, "
        "weapon, is_bot, shots, bursts_init, hit_bursts_init, "
        "first_shot_init, hit_index_sum_init) "
        "VALUES (?, ?, ?, ?, true, 1, 10, 10, 0, 40)",
        (t1, "m1", "ai.bot", "M416"))
    conn.commit()
    out = sq.burst_discipline(conn, t1, "account.me")
    row = out["rows"][0]
    assert row["poolHitBursts"] == 0
    assert row["poolFirstShotPct"] is None


def test_burst_discipline_honours_the_time_range(pg_compat):
    from pubg import shot_quality as sq
    conn, t1, _ = pg_compat
    for mid, when in (("old", "2026-01-01T12:00:00Z"),
                      ("new", "2026-09-01T12:00:00Z")):
        conn.execute("INSERT INTO matches (tenant_id, match_id, map_name, "
                     "game_mode, played_at) VALUES (?, ?, ?, ?, ?)",
                     (t1, mid, "Baltic_Main", "squad", when))
        conn.execute(
            "INSERT INTO match_weapon_stats (tenant_id, match_id, account_id, "
            "weapon, is_bot, shots, bursts_init, hit_bursts_init, "
            "first_shot_init, hit_index_sum_init) "
            "VALUES (?, ?, ?, ?, false, 1, 10, 10, 5, 20)",
            (t1, mid, "account.me", "M416"))
    conn.commit()
    assert sq.burst_discipline(conn, t1, "account.me")["matches"] == 2
    late = sq.burst_discipline(conn, t1, "account.me",
                               cutoff="2026-06-01T00:00:00Z")
    assert late["matches"] == 1
    assert late["rows"][0]["bursts"] == 10


def test_burst_discipline_is_empty_before_the_backfill(pg_compat):
    """Ohne Backfill stehen die Spalten auf 0 — dann darf die Antwort
    leer sein, aber die Deckung muss das ausweisen."""
    from pubg import shot_quality as sq
    conn, t1, _ = pg_compat
    conn.execute("INSERT INTO matches (tenant_id, match_id, map_name, "
                 "game_mode, played_at) VALUES (?, ?, ?, ?, ?)",
                 (t1, "m1", "Baltic_Main", "squad", "2026-09-01T12:00:00Z"))
    conn.execute(
        "INSERT INTO match_weapon_stats (tenant_id, match_id, account_id, "
        "weapon, is_bot, shots) VALUES (?, ?, ?, ?, false, 100)",
        (t1, "m1", "account.me", "M416"))
    conn.commit()
    out = sq.burst_discipline(conn, t1, "account.me")
    assert out["rows"] == []
    assert out["matches"] == 0


# ── Waffen-Mapping ─────────────────────────────────────────────────────────

def test_attack_and_damage_ids_normalise_to_the_same_name():
    """Attack meldet "Item_Weapon_X_C", TakeDamage "WeapX_C". Fallen die
    auf verschiedene Namen, findet kein Treffer seinen Schuss und die
    Waffe steht mit Stoessen und null Treffern da — an Prod-Daten
    gemessen bei Lynx AMR (2.129 Stoesse, 0 Treffer) und Crossbow."""
    from pubg.telemetry_analysis import normalize_weapon
    from pubg.aggregations import WEAPON_NAMES
    mismatched = []
    for raw in WEAPON_NAMES:
        if not raw.startswith("Weap") or not raw.endswith("_C"):
            continue
        stem = raw[len("Weap"):-len("_C")]
        item = f"Item_Weapon_{stem}_C"
        a, b = normalize_weapon(item), normalize_weapon(raw)
        if a and b and a != b:
            mismatched.append((raw, b, item, a))
    assert not mismatched, (
        "Attack- und Schadensform normalisieren verschieden: "
        + "; ".join(f"{r}->{rb!r} vs {i}->{ia!r}"
                    for r, rb, i, ia in mismatched[:8]))


def test_compare_to_pool_drops_classes_without_a_single_hit_burst():
    """Rauchgranaten, Schneebaelle und Flares erzeugen Attack-Events, aber
    keinen Schusswaffenschaden — an Prod-Daten 27 % aller Stoesse. Ohne
    Treffer-Stoss gibt es keine Visierlage zu messen."""
    from pubg.burst_analysis import compare_to_pool
    folded = {("me", "throwable"): {
                  "initiated": {"bursts": 1163, "hitBursts": 0,
                                "firstShotHits": 0, "hitIndexSum": 0},
                  "reacting": {"bursts": 104, "hitBursts": 0,
                               "firstShotHits": 0, "hitIndexSum": 0}},
              ("me", "ar"): {
                  "initiated": {"bursts": 100, "hitBursts": 40,
                                "firstShotHits": 10, "hitIndexSum": 120},
                  "reacting": {"bursts": 0, "hitBursts": 0,
                               "firstShotHits": 0, "hitIndexSum": 0}}}
    out = compare_to_pool(folded, "me")
    assert [(r["class"], r["role"]) for r in out] == [("ar", "initiated")]


# ── Durchschlagende Munition ───────────────────────────────────────────────

def test_is_gun_damage_accepts_penetrating_variants():
    """Die Lynx AMR meldet "Damage_Gun_Penetrate_BRDM" (.50-Kaliber, geht
    durch Fahrzeugpanzerung). Mit exaktem Vergleich fiel damit JEDER
    Lynx-Treffer weg: an Prod-Daten 2.129 Schuesse ueber 859 Matches mit
    null Treffern, null Schaden und leeren Trefferzonen."""
    from pubg.telemetry_analysis import is_gun_damage
    assert is_gun_damage("Damage_Gun") is True
    assert is_gun_damage("Damage_Gun_Penetrate_BRDM") is True
    assert is_gun_damage(None) is True        # aeltere Events ohne Kategorie


def test_is_gun_damage_still_rejects_everything_else():
    """Der Praefix darf nicht zum Scheunentor werden — Blauzone, Sturz,
    Fahrzeug und Molotov sagen nichts ueber Zielen aus."""
    from pubg.telemetry_analysis import is_gun_damage
    for cat in ("Damage_BlueZone", "Damage_Molotov", "Damage_Instant_Fall",
                "Damage_Explosion_Grenade", "Damage_VehicleCrashHit",
                "Damage_Punch", "Damage_Melee", "Damage_MeleeThrow",
                "Damage_DBNO", "Damage_Drown", "Damage_BlueZoneGrenade",
                "Damage_Explosion_C4", "Damage_Explosion_RedZone",
                "Damage_Explosion_JerryCan", "Damage_Explosion_Vehicle",
                "Damage_Explosion_PanzerFaustWarhead"):
        assert is_gun_damage(cat) is False, cat


def test_bursts_count_a_penetrating_hit(pg_compat=None):
    """Ende zu Ende: ein Lynx-Treffer muss seinen Schuss finden."""
    from pubg import burst_analysis as ba
    ev = lambda t, typ, **kw: {"_T": typ,
                               "_D": f"2026-09-08T20:00:{t:06.3f}Z", **kw}
    events = [
        ev(1.0, "LogPlayerAttack", attacker={"name": "me"},
           weapon={"itemId": "Item_Weapon_L6_C"}),
        ev(1.4, "LogPlayerTakeDamage", attacker={"name": "me"},
           victim={"name": "them"}, damageCauserName="WeapL6_C",
           damageTypeCategory="Damage_Gun_Penetrate_BRDM"),
    ]
    out = ba.analyse_bursts(events)
    assert out["me"]["Lynx AMR"]["initiated"]["hitBursts"] == 1
    assert out["me"]["Lynx AMR"]["initiated"]["firstShotHits"] == 1


# ── Quote AB dem ersten Treffer ────────────────────────────────────────────
# Trennt "Ziel finden" von "Ziel halten": bis zum ersten Treffer entscheidet
# die Visierlage, danach Rueckstosskontrolle und Nachfuehren.

def test_hits_after_first_counts_the_rest_of_the_burst():
    from pubg.burst_analysis import hits_after_first
    # 5 Schuesse, Treffer bei Schuss 2, 4 und 5
    burst = [10.0, 10.1, 10.2, 10.3, 10.4]
    hits = [10.15, 10.35, 10.45]
    shots_after, hits_after = hits_after_first(burst, hits)
    assert shots_after == 3          # Schuesse 3, 4, 5
    assert hits_after == 2           # die bei 10.35 und 10.45


def test_hits_after_first_is_zero_for_a_single_shot_burst():
    from pubg.burst_analysis import hits_after_first
    assert hits_after_first([10.0], [10.05]) == (0, 0)


def test_hits_after_first_is_zero_without_any_hit():
    from pubg.burst_analysis import hits_after_first
    assert hits_after_first([10.0, 10.1], [99.0]) == (0, 0)


def test_hits_after_first_ignores_hits_beyond_the_burst():
    from pubg.burst_analysis import hits_after_first
    burst = [10.0, 10.1]
    # Treffer bei Schuss 1, dann einer lange nach dem Stoss
    shots_after, hits_after = hits_after_first(burst, [10.05, 30.0])
    assert shots_after == 1
    assert hits_after == 0


def test_analyse_bursts_reports_the_follow_up_columns():
    from pubg import burst_analysis as ba
    ev = lambda t, typ, **kw: {"_T": typ,
                               "_D": f"2026-09-08T20:00:{t:06.3f}Z", **kw}
    events = [
        ev(1.0, "LogPlayerAttack", attacker={"name": "me"},
           weapon={"itemId": "Item_Weapon_HK416_C"}),
        ev(1.1, "LogPlayerAttack", attacker={"name": "me"},
           weapon={"itemId": "Item_Weapon_HK416_C"}),
        ev(1.2, "LogPlayerAttack", attacker={"name": "me"},
           weapon={"itemId": "Item_Weapon_HK416_C"}),
        ev(1.05, "LogPlayerTakeDamage", attacker={"name": "me"},
           victim={"name": "them"}, damageCauserName="WeapHK416_C",
           damageTypeCategory="Damage_Gun"),
        ev(1.25, "LogPlayerTakeDamage", attacker={"name": "me"},
           victim={"name": "them"}, damageCauserName="WeapHK416_C",
           damageTypeCategory="Damage_Gun"),
    ]
    s = ba.analyse_bursts(events)["me"]["M416"]["initiated"]
    assert s["firstShotHits"] == 1
    assert s["shotsAfterHit"] == 2       # Schuesse 2 und 3
    assert s["hitsAfterHit"] == 1        # der bei 1.25


def test_follow_up_rate_needs_shots():
    from pubg.burst_analysis import follow_up_pct
    assert follow_up_pct(0, 0) is None
    assert follow_up_pct(8, 2) == 25.0


def test_row_fields_include_the_follow_up_columns():
    from pubg.burst_analysis import to_row_fields
    row = to_row_fields({})
    for col in ("shots_after_hit_init", "hits_after_hit_init",
                "shots_after_hit_react", "hits_after_hit_react"):
        assert col in row, col
    assert len(row) == 12


def test_compare_to_pool_reports_the_follow_up_rate():
    from pubg.burst_analysis import compare_to_pool
    folded = {("me", "ar"): {
        "initiated": {"bursts": 10, "hitBursts": 10, "firstShotHits": 5,
                      "hitIndexSum": 15, "shotsAfterHit": 40,
                      "hitsAfterHit": 8},
        "reacting": {"bursts": 0, "hitBursts": 0, "firstShotHits": 0,
                     "hitIndexSum": 0, "shotsAfterHit": 0,
                     "hitsAfterHit": 0}}}
    row = compare_to_pool(folded, "me")[0]
    assert row["followUpPct"] == 20.0        # 8 von 40


# ── Wurfgeraete ────────────────────────────────────────────────────────────

def test_is_thrown_damage_accepts_explosives_and_fire():
    """Granaten, Molotov, C4 und Panzerfaust richten Schaden an, tragen
    aber keine Gun-Kategorie — deshalb standen sie mit Wuerfen und null
    Treffern in der Tabelle."""
    from pubg.telemetry_analysis import is_thrown_damage
    for cat in ("Damage_Explosion_Grenade", "Damage_Molotov",
                "Damage_Explosion_C4", "Damage_Explosion_PanzerFaustWarhead",
                "Damage_MeleeThrow", "Damage_BlueZoneGrenade"):
        assert is_thrown_damage(cat) is True, cat


def test_is_thrown_damage_rejects_gun_and_environment():
    """Muss disjunkt zu is_gun_damage sein, sonst zaehlt ein Treffer
    doppelt — und Umgebungsschaden gehoert keinem Spieler."""
    from pubg.telemetry_analysis import is_thrown_damage, is_gun_damage
    for cat in ("Damage_Gun", "Damage_Gun_Penetrate_BRDM"):
        assert is_thrown_damage(cat) is False, cat
        assert is_gun_damage(cat) is True
    for cat in ("Damage_BlueZone", "Damage_Instant_Fall", "Damage_Drown",
                "Damage_VehicleCrashHit", "Damage_VehicleHit",
                "Damage_Explosion_RedZone", "Damage_Explosion_Vehicle",
                "Damage_Explosion_GasPump", "Damage_Explosion_JerryCan",
                "Damage_DBNO", "Damage_Punch", "Damage_Melee"):
        assert is_thrown_damage(cat) is False, cat
        assert is_gun_damage(cat) is False, cat


def test_thrown_weapons_are_flagged_in_db_rows():
    """Ohne die Kennzeichnung landen Wurfgeraete in der Trefferquote: eine
    Granate, die drei Gegner erwischt, waere ein Schuss mit drei
    Treffern."""
    from pubg.weapon_performance import to_db_rows
    analysis = {"players": {"me": {"accountId": "account.me", "weapons": {
        "Granate": {"shots": 4, "hits": 3, "damage": 210.0, "kills": 1},
        "M416": {"shots": 30, "hits": 9, "damage": 260.0, "kills": 0}}}}}
    rows = {r["weapon"]: r for r in to_db_rows(analysis)}
    assert rows["Granate"]["is_thrown"] is True
    assert rows["M416"]["is_thrown"] is False


def test_no_rate_from_a_single_hit_burst():
    """"1 von 1 Stoessen traf mit dem ersten Schuss" ergibt 100 % und liest
    sich als Befund, obwohl es eine einzige Beobachtung ist. Die Rohzahl
    sagt dasselbe, ohne etwas zu behaupten."""
    from pubg.burst_analysis import compare_to_pool
    folded = {("me", "dmr"): {
        "initiated": {"bursts": 0, "hitBursts": 0, "firstShotHits": 0,
                      "hitIndexSum": 0, "shotsAfterHit": 0, "hitsAfterHit": 0},
        "reacting": {"bursts": 4, "hitBursts": 1, "firstShotHits": 1,
                     "hitIndexSum": 1, "shotsAfterHit": 2,
                     "hitsAfterHit": 1}}}
    row = compare_to_pool(folded, "me")[0]
    assert row["bursts"] == 4
    assert row["hitBursts"] == 1
    assert row["firstShotHits"] == 1
    assert row["ratedEnough"] is False
    assert row["firstShotPct"] is None
    assert row["avgHitIndex"] is None
    assert row["followUpPct"] is None
    # Der Anteil der Stoesse OHNE Treffer hat den groesseren Nenner und
    # bleibt darum ablesbar — 3 von 4 trafen nichts.
    assert row["missBurstPct"] == 75.0


def test_rate_appears_at_the_threshold():
    from pubg.burst_analysis import compare_to_pool, MIN_RATE_HIT_BURSTS
    n = MIN_RATE_HIT_BURSTS
    folded = {("me", "ar"): {
        "initiated": {"bursts": n, "hitBursts": n, "firstShotHits": n,
                      "hitIndexSum": n, "shotsAfterHit": 0, "hitsAfterHit": 0},
        "reacting": {"bursts": 0, "hitBursts": 0, "firstShotHits": 0,
                     "hitIndexSum": 0, "shotsAfterHit": 0, "hitsAfterHit": 0}}}
    row = compare_to_pool(folded, "me")[0]
    assert row["ratedEnough"] is True
    assert row["firstShotPct"] == 100.0


def test_thrown_rows_stay_out_of_the_aim_metrics(pg_compat):
    """Eine Granate, die drei Gegner erwischt, waere ein Schuss mit drei
    Treffern — ohne den Filter zeigte die Trefferquote 300 %."""
    from pubg import shot_quality as sq
    conn, t1, _ = pg_compat
    conn.execute("INSERT INTO matches (tenant_id, match_id, map_name, "
                 "game_mode, played_at) VALUES (?, ?, ?, ?, ?)",
                 (t1, "m1", "Baltic_Main", "squad", "2026-09-01T12:00:00Z"))
    conn.execute(
        "INSERT INTO match_weapon_stats (tenant_id, match_id, account_id, "
        "weapon, is_bot, is_thrown, shots, hit_attacks, hits, damage) "
        "VALUES (?, ?, ?, 'M416', false, false, 100, 10, 12, 800)",
        (t1, "m1", "account.me"))
    conn.execute(
        "INSERT INTO match_weapon_stats (tenant_id, match_id, account_id, "
        "weapon, is_bot, is_thrown, shots, hit_attacks, hits, damage) "
        "VALUES (?, ?, ?, 'Granate', false, true, 1, 1, 3, 210)",
        (t1, "m1", "account.me"))
    conn.commit()
    me = sq.own_metrics(conn, t1, "account.me", "1970-01-01T00:00:00Z")
    assert me["shots"] == 100          # der Wurf zaehlt nicht als Schuss
    assert me["hits"] == 12            # und die drei Getroffenen nicht als Treffer
    assert round(me["hitRate"], 1) == 10.0


def test_burst_discipline_selects_the_follow_up_columns(pg_compat):
    """Eine Spalte, die im Schema steht aber nicht im SELECT, bleibt
    stumm auf 0 und faellt erst in der Anzeige auf."""
    from pubg import shot_quality as sq
    conn, t1, _ = pg_compat
    conn.execute("INSERT INTO matches (tenant_id, match_id, map_name, "
                 "game_mode, played_at) VALUES (?, ?, ?, ?, ?)",
                 (t1, "m1", "Baltic_Main", "squad", "2026-09-01T12:00:00Z"))
    conn.execute(
        "INSERT INTO match_weapon_stats (tenant_id, match_id, account_id, "
        "weapon, is_bot, shots, bursts_init, hit_bursts_init, "
        "first_shot_init, hit_index_sum_init, shots_after_hit_init, "
        "hits_after_hit_init) "
        "VALUES (?, ?, ?, 'M416', false, 1, 30, 25, 10, 50, 60, 15)",
        (t1, "m1", "account.me"))
    conn.commit()
    row = sq.burst_discipline(conn, t1, "account.me")["rows"][0]
    assert row["followUpPct"] == 25.0        # 15 von 60


def test_full_rows_uses_the_same_chain_as_the_poller():
    """Backfill und Ingest muessen dieselbe Kette laufen, sonst driften
    die Zahlen je nachdem, wer die Zeile geschrieben hat."""
    from scripts.backfill_bursts import full_rows_for_match
    ev = lambda t, typ, **kw: {"_T": typ,
                               "_D": f"2026-09-08T20:00:{t:06.3f}Z", **kw}
    events = [
        {"_T": "LogPlayerCreate",
         "character": {"name": "me", "accountId": "account.me", "teamId": 1}},
        ev(1.0, "LogPlayerAttack", attackType="Weapon",
           attacker={"name": "me", "accountId": "account.me"},
           weapon={"itemId": "Item_Weapon_L6_C"}),
        # Lynx-Treffer mit durchschlagender Munition
        ev(1.4, "LogPlayerTakeDamage", attacker={"name": "me"},
           victim={"name": "them"}, damageCauserName="WeapL6_C",
           damageTypeCategory="Damage_Gun_Penetrate_BRDM", damage=90.0),
        # Granatenwurf mit Treffer
        ev(20.0, "LogPlayerAttack", attackType="Weapon",
           attacker={"name": "me", "accountId": "account.me"},
           weapon={"itemId": "Item_Weapon_Grenade_C"}),
        ev(21.0, "LogPlayerTakeDamage", attacker={"name": "me"},
           victim={"name": "them"}, damageCauserName="ProjGrenade_C",
           damageTypeCategory="Damage_Explosion_Grenade", damage=70.0),
    ]
    rows = {r["weapon"]: r for r in full_rows_for_match(events)}
    lynx = rows["Lynx AMR"]
    assert lynx["hits"] == 1 and lynx["damage"] == 90.0
    assert lynx["is_thrown"] is False
    assert lynx["hit_bursts_init"] == 1
    gren = rows["Granate"]
    assert gren["hits"] == 1 and gren["damage"] == 70.0
    assert gren["is_thrown"] is True
