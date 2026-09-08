"""Schussqualitaet und Todesbild (pubg/shot_quality.py).

Die Rechenkerne sind DB-frei und werden hier direkt geprueft. Die
DB-Abfragen bekommen einen kleinen, handgebauten Bestand ueber die
`pg`-Fixture — vor allem um zu belegen, dass der Tenant-Filter haelt
(telemetry_events hat KEINE tenant_id, der Filter laeuft ueber matches).
"""
import pytest

from pubg import shot_quality as sq


# ── Rechenkerne ─────────────────────────────────────────────────────────────

def test_hit_rate_is_hits_over_shots_in_percent():
    assert sq.hit_rate(shots=1000, hit_attacks=92) == pytest.approx(9.2)


def test_hit_rate_without_shots_is_none_not_zero():
    # 0 % waere eine Aussage, "nie geschossen" ist keine.
    assert sq.hit_rate(shots=0, hit_attacks=0) is None


def test_dmg_per_100_shots():
    assert sq.dmg_per_100(damage=2390, shots=1000) == pytest.approx(239.0)


def test_in_fight_share():
    assert sq.in_fight_share(shots_in_fight=909, shots=1000) == pytest.approx(90.9)


@pytest.mark.parametrize("secs,expected", [
    (0, "early"),
    (299, "early"),
    (300, "mid"),
    (899, "mid"),
    (900, "late"),
    (3600, "late"),
])
def test_phase_of_splits_at_5_and_15_minutes(secs, expected):
    assert sq.phase_of(secs) == expected


def test_phase_of_rejects_missing_survival():
    assert sq.phase_of(None) is None


def test_delta_pct_is_relative_change():
    assert sq.delta_pct(now=12.0, before=10.0) == pytest.approx(20.0)
    assert sq.delta_pct(now=8.0, before=10.0) == pytest.approx(-20.0)


def test_delta_pct_without_baseline_is_none():
    assert sq.delta_pct(now=12.0, before=None) is None
    assert sq.delta_pct(now=12.0, before=0) is None


def test_percentile_counts_how_many_are_worse():
    others = [1.0, 2.0, 3.0, 4.0]
    # 2.5 schlaegt zwei von vier
    assert sq.percentile(2.5, others) == pytest.approx(50.0)


def test_percentile_ignores_none_values():
    assert sq.percentile(2.5, [1.0, None, 3.0]) == pytest.approx(50.0)


def test_percentile_without_peers_is_none():
    assert sq.percentile(2.5, []) is None
    assert sq.percentile(None, [1.0, 2.0]) is None


def test_percentile_can_invert_for_lower_is_better():
    # Frueher Tod: niedriger ist besser, also zaehlt "wie viele sind hoeher"
    others = [10.0, 20.0, 30.0, 40.0]
    assert sq.percentile(15.0, others, lower_is_better=True) == pytest.approx(75.0)


def test_kd_uses_opgg_convention():
    # kills / (matches - wins), siehe reference_kd_formeln
    assert sq.kd(kills=595, matches=390, wins=32) == pytest.approx(1.662, abs=1e-3)


def test_kd_without_losses_is_none():
    assert sq.kd(kills=5, matches=3, wins=3) is None


@pytest.mark.parametrize("value,expected", [
    (0.9, "under_1_2"),
    (1.2, "1_2_to_1_6"),
    (1.7, "1_6_to_2_2"),
    (3.0, "over_2_2"),
])
def test_band_of_assigns_kd_cohorts(value, expected):
    assert sq.band_of(value) == expected


def test_band_of_without_kd_is_none():
    assert sq.band_of(None) is None


# ── Waffen-Rohnamen lesbar machen ───────────────────────────────────────────

def test_weapon_label_strips_pubg_prefix_and_suffix():
    assert sq.weapon_label("WeapHK416_C") == "M416"


def test_weapon_label_falls_back_to_cleaned_id():
    # Unbekannte ID darf nicht verschluckt werden, nur entkernt
    assert sq.weapon_label("WeapSomethingNew_C") == "SomethingNew"


def test_weapon_label_handles_empty():
    assert sq.weapon_label(None) == "Unknown"


# ── Distanz-Klassen fuer das Todesbild ──────────────────────────────────────

@pytest.mark.parametrize("cm,expected", [
    (0, "0-10m"),
    (999, "0-10m"),
    (1000, "10-50m"),
    (4999, "10-50m"),
    (5000, "50-150m"),
    (14999, "50-150m"),
    (15000, "150m+"),
])
def test_distance_bucket(cm, expected):
    assert sq.distance_bucket(cm) == expected


def test_distance_bucket_without_distance_is_none():
    assert sq.distance_bucket(None) is None


# ── Aggregation der Rohzeilen ───────────────────────────────────────────────

def test_aggregate_weapon_rows_sums_and_derives():
    rows = [
        {"shots": 600, "hit_attacks": 60, "hits": 60, "head": 9,
         "damage": 1500, "shots_in_fight": 550, "match_id": "m1"},
        {"shots": 400, "hit_attacks": 32, "hits": 32, "head": 3,
         "damage": 900, "shots_in_fight": 359, "match_id": "m2"},
    ]
    out = sq.aggregate_weapon_rows(rows)
    assert out["shots"] == 1000
    assert out["hitAttacks"] == 92
    assert out["matches"] == 2
    assert out["hitRate"] == pytest.approx(9.2)
    assert out["dmgPer100"] == pytest.approx(240.0)
    assert out["inFightShare"] == pytest.approx(90.9)
    assert out["headShare"] == pytest.approx(13.04, abs=0.01)
    assert out["shotsPerMatch"] == pytest.approx(500.0)


def test_aggregate_weapon_rows_empty_is_zeroed_not_crashing():
    out = sq.aggregate_weapon_rows([])
    assert out["shots"] == 0
    assert out["matches"] == 0
    assert out["hitRate"] is None
    assert out["dmgPer100"] is None


def test_aggregate_weapon_rows_counts_each_match_once():
    # Mehrere Waffenzeilen im selben Match sind EIN Match
    rows = [
        {"shots": 10, "hit_attacks": 1, "hits": 1, "head": 0, "damage": 25,
         "shots_in_fight": 10, "match_id": "m1"},
        {"shots": 20, "hit_attacks": 2, "hits": 2, "head": 0, "damage": 50,
         "shots_in_fight": 20, "match_id": "m1"},
    ]
    assert sq.aggregate_weapon_rows(rows)["matches"] == 1


# ── Todesbild ───────────────────────────────────────────────────────────────

def test_summarise_deaths_groups_by_weapon_distance_and_phase():
    deaths = [
        {"weapon": "WeapHK416_C", "distance": 4800, "time_survived": 200},
        {"weapon": "WeapHK416_C", "distance": 800, "time_survived": 1000},
        {"weapon": "WeapMk12_C", "distance": 9700, "time_survived": 600},
    ]
    out = sq.summarise_deaths(deaths)
    assert out["total"] == 3
    assert out["byWeapon"][0] == {"label": "M416", "n": 2, "share": pytest.approx(66.67, abs=0.01)}
    assert dict((b["bucket"], b["n"]) for b in out["byDistance"]) == {
        "0-10m": 1, "10-50m": 1, "50-150m": 1}
    assert dict((p["phase"], p["n"]) for p in out["byPhase"]) == {
        "early": 1, "mid": 1, "late": 1}
    assert out["medianSurvivalSecs"] == pytest.approx(600)


def test_summarise_deaths_without_data():
    out = sq.summarise_deaths([])
    assert out["total"] == 0
    assert out["byWeapon"] == []
    assert out["medianSurvivalSecs"] is None


def test_summarise_deaths_tolerates_missing_fields():
    deaths = [{"weapon": None, "distance": None, "time_survived": None}]
    out = sq.summarise_deaths(deaths)
    assert out["total"] == 1
    assert out["byWeapon"][0]["label"] == "Unknown"
    # Unbrauchbare Distanz/Phase darf keine Kategorie erfinden
    assert out["byDistance"] == []
    assert out["byPhase"] == []


# ── Kohorten ────────────────────────────────────────────────────────────────

def test_build_cohort_bands_averages_per_band():
    players = [
        {"accountId": "a", "kd": 0.8, "hitRate": 8.0, "shotsPerMatch": 60},
        {"accountId": "b", "kd": 1.0, "hitRate": 9.0, "shotsPerMatch": 64},
        {"accountId": "c", "kd": 3.0, "hitRate": 11.0, "shotsPerMatch": 140},
    ]
    bands = sq.build_cohort_bands(players)
    by_key = {b["band"]: b for b in bands}
    assert by_key["under_1_2"]["players"] == 2
    assert by_key["under_1_2"]["hitRate"] == pytest.approx(8.5)
    assert by_key["over_2_2"]["players"] == 1
    # Leere Baender tauchen nicht auf
    assert "1_6_to_2_2" not in by_key


def test_build_cohort_bands_skips_players_without_kd():
    players = [{"accountId": "a", "kd": None, "hitRate": 8.0}]
    assert sq.build_cohort_bands(players) == []


def test_rank_me_reports_percentile_per_metric():
    me = {"accountId": "me", "hitRate": 9.2, "dmgPer100": 239.0,
          "inFightShare": 90.9}
    peers = [
        {"accountId": "p1", "hitRate": 8.0, "dmgPer100": 200.0, "inFightShare": 89.0},
        {"accountId": "p2", "hitRate": 12.0, "dmgPer100": 320.0, "inFightShare": 94.0},
        {"accountId": "me", "hitRate": 9.2, "dmgPer100": 239.0, "inFightShare": 90.9},
    ]
    out = sq.rank_me(me, peers)
    # Sich selbst nicht als Vergleich zaehlen: 1 von 2 ist schlechter
    assert out["hitRate"]["percentile"] == pytest.approx(50.0)
    assert out["hitRate"]["peers"] == 2
    assert out["dmgPer100"]["percentile"] == pytest.approx(50.0)


def test_rank_me_without_peers_gives_no_percentile():
    me = {"accountId": "me", "hitRate": 9.2}
    out = sq.rank_me(me, [{"accountId": "me", "hitRate": 9.2}])
    assert out["hitRate"]["percentile"] is None
    assert out["hitRate"]["peers"] == 0


# ── DB-Ebene: Tenant-Isolation ──────────────────────────────────────────────

def _seed(conn, tenant_id, account_id, match_id, *, mode="squad-fpp",
          played_at="2026-09-01T12:00:00Z", survived=600, kills=2,
          shots=100, hits=10, damage=250, in_fight=95, place=5):
    conn.execute(
        "INSERT INTO matches (tenant_id, match_id, game_mode, map_name,"
        " played_at, duration_secs) VALUES (?, ?, ?, ?, ?, ?)"
        " ON CONFLICT DO NOTHING",
        (tenant_id, match_id, mode, "Baltic_Main", played_at, 1800))
    conn.execute(
        "INSERT INTO participants (tenant_id, match_id, account_id, name,"
        " place, kills, damage_dealt, time_survived, dbnos, assists, revives,"
        " heals, boosts, weapons_acquired, walk_distance, ride_distance,"
        " headshot_kills, team_id, longest_kill, swim_distance, team_kills)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 3, 2, 7, 1500, 800, 1, 1,"
        " 120, 0, 0) ON CONFLICT DO NOTHING",
        (tenant_id, match_id, account_id, "Tester", place, kills, damage,
         survived))
    conn.execute(
        "INSERT INTO match_weapon_stats (tenant_id, match_id, account_id,"
        " player_name, weapon, shots, hits, hit_attacks, head, torso, arm,"
        " leg, pelvis, damage, kills, shots_in_fight, finisher_shots,"
        " finisher_hits, team_id, is_bot) VALUES (?, ?, ?, ?, 'WeapHK416_C',"
        " ?, ?, ?, 1, 5, 2, 2, 0, ?, ?, ?, 0, 0, 1, false)"
        " ON CONFLICT DO NOTHING",
        (tenant_id, match_id, account_id, "Tester", shots, hits, hits,
         damage, kills, in_fight))
    conn.commit()


def test_own_metrics_only_sees_own_tenant(pg_compat):
    conn, t1, t2 = pg_compat
    _seed(conn, t1, "account.me", "match.a", shots=100, hits=12)
    _seed(conn, t2, "account.me", "match.b", shots=100, hits=2)

    got = sq.own_metrics(conn, t1, "account.me", "1970-01-01T00:00:00Z")
    assert got["matches"] == 1
    assert got["shots"] == 100
    assert got["hitRate"] == pytest.approx(12.0)


def test_own_metrics_respects_cutoff(pg_compat):
    conn, t1, _ = pg_compat
    _seed(conn, t1, "account.me", "match.old", played_at="2026-01-01T10:00:00Z")
    _seed(conn, t1, "account.me", "match.new", played_at="2026-09-01T10:00:00Z")

    got = sq.own_metrics(conn, t1, "account.me", "2026-06-01T00:00:00Z")
    assert got["matches"] == 1


def test_own_metrics_excludes_non_br_modes(pg_compat):
    conn, t1, _ = pg_compat
    _seed(conn, t1, "account.me", "match.br", mode="squad-fpp")
    _seed(conn, t1, "account.me", "match.tdm", mode="tdm")

    got = sq.own_metrics(conn, t1, "account.me", "1970-01-01T00:00:00Z")
    assert got["matches"] == 1


def test_deaths_join_keeps_tenant_scope(pg_compat):
    """telemetry_events hat keine tenant_id — der Filter muss ueber matches
    laufen, sonst tauchen Tode aus fremden Tenants auf."""
    conn, t1, t2 = pg_compat
    _seed(conn, t1, "account.me", "match.mine")
    _seed(conn, t2, "account.me", "match.other")
    for mid in ("match.mine", "match.other"):
        conn.execute(
            "INSERT INTO telemetry_events (match_id, event_type,"
            " actor_account, target_account, weapon, distance, timestamp_ms)"
            " VALUES (?, 'Kill', 'account.foe', 'account.me', 'WeapHK416_C',"
            " 4800, 1788000000000)", (mid,))
    conn.commit()

    rows = sq.death_rows(conn, t1, "account.me", "1970-01-01T00:00:00Z")
    assert len(rows) == 1


def test_phase_breakdown_buckets_by_survival(pg_compat):
    conn, t1, _ = pg_compat
    _seed(conn, t1, "account.me", "match.e", survived=120, shots=40, hits=6)
    _seed(conn, t1, "account.me", "match.m", survived=600, shots=60, hits=6)
    _seed(conn, t1, "account.me", "match.l", survived=1500, shots=200, hits=16)

    out = sq.phase_breakdown(conn, t1, "account.me", "1970-01-01T00:00:00Z")
    by = {p["phase"]: p for p in out}
    assert by["early"]["hitRate"] == pytest.approx(15.0)
    assert by["late"]["hitRate"] == pytest.approx(8.0)
    assert by["late"]["shotsPerMatch"] == pytest.approx(200.0)


def test_cohort_players_needs_min_matches(pg_compat):
    conn, t1, _ = pg_compat
    for i in range(3):
        _seed(conn, t1, "account.few", f"match.f{i}")
    for i in range(5):
        _seed(conn, t1, "account.many", f"match.m{i}")

    players = sq.cohort_players(conn, t1, min_matches=5)
    ids = {p["accountId"] for p in players}
    assert ids == {"account.many"}


def test_compute_shot_quality_returns_all_sections(pg_compat):
    conn, t1, _ = pg_compat
    for i in range(4):
        _seed(conn, t1, "account.me", f"match.{i}", survived=300 + i * 400)

    out = sq.compute_shot_quality(conn, t1, "account.me",
                                  cutoff="1970-01-01T00:00:00Z",
                                  min_matches=1)
    for key in ("me", "byPhase", "deaths", "cohort", "ranks", "trend"):
        assert key in out, f"Sektion {key} fehlt"
    assert out["me"]["matches"] == 4
