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

def test_weapon_class_maps_to_category():
    assert sq.weapon_class("WeapHK416_C") == "ar"
    assert sq.weapon_class(None) == "unknown"


def test_summarise_deaths_groups_by_weapon_class():
    deaths = [
        {"weapon": "WeapHK416_C", "distance": 1000, "time_survived": 400},
        {"weapon": "WeapUZI_C", "distance": 500, "time_survived": 400},
    ]
    out = sq.summarise_deaths(deaths)
    classes = dict((c["cls"], c["n"]) for c in out["byWeaponClass"])
    assert classes.get("ar") == 1
    assert sum(classes.values()) == 2


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


def test_repeat_killers_needs_more_than_one_kill(pg_compat):
    """Eine ungefilterte Killer-Liste liest sich wie "Angstgegner", zeigt
    aber nur Einmal-Killer in alphabetischer Reihenfolge."""
    conn, t1, _ = pg_compat
    _seed(conn, t1, "account.me", "match.a")
    _seed(conn, t1, "account.me", "match.b")
    _seed(conn, t1, "account.me", "match.c")
    # 'account.once' killt einmal, 'account.often' dreimal
    for mid, foe in (("match.a", "account.once"),
                     ("match.a", "account.often"),
                     ("match.b", "account.often"),
                     ("match.c", "account.often")):
        conn.execute(
            "INSERT INTO telemetry_events (match_id, event_type,"
            " actor_account, target_account, weapon, distance, timestamp_ms)"
            " VALUES (?, 'Kill', ?, 'account.me', 'WeapHK416_C', 4800,"
            " 1788000000000)", (mid, foe))
    conn.commit()

    got = sq.repeat_killers(conn, t1, "account.me", "1970-01-01T00:00:00Z")
    assert [k["name"] for k in got] == ["account.often"]


def test_compute_shot_quality_returns_all_sections(pg_compat):
    conn, t1, _ = pg_compat
    for i in range(4):
        _seed(conn, t1, "account.me", f"match.{i}", survived=300 + i * 400)

    out = sq.compute_shot_quality(conn, t1, "account.me",
                                  cutoff="1970-01-01T00:00:00Z",
                                  min_matches=1)
    for key in ("me", "byPhase", "deaths", "cohort", "ranks", "trend",
                "landings"):
        assert key in out, f"Sektion {key} fehlt"
    assert out["me"]["matches"] == 4


# ── POI-Zuordnung ───────────────────────────────────────────────────────────

SQUARE = [[1000, 1000], [2000, 1000], [2000, 2000], [1000, 2000]]
POIS = {"Baltic_Main": {"mapKm": 8, "regions": [
    {"name": "Testville", "points": SQUARE},
    {"name": "Nachbar", "points": [[3000, 3000], [4000, 3000],
                                   [4000, 4000], [3000, 4000]]},
]}}


def test_poi_boxes_carry_bounding_box_for_prefilter():
    boxes = sq.poi_boxes(POIS)
    entry = next(b for b in boxes["Baltic_Main"] if b[0] == "Testville")
    assert entry[1:5] == (1000, 2000, 1000, 2000)


def test_poi_at_finds_the_containing_region():
    boxes = sq.poi_boxes(POIS)
    assert sq.poi_at(boxes, "Baltic_Main", 1500, 1500) == "Testville"
    assert sq.poi_at(boxes, "Baltic_Main", 3500, 3500) == "Nachbar"


def test_poi_at_returns_none_outside_every_region():
    boxes = sq.poi_boxes(POIS)
    assert sq.poi_at(boxes, "Baltic_Main", 9000, 9000) is None


def test_poi_at_tolerates_unknown_map_and_missing_coords():
    boxes = sq.poi_boxes(POIS)
    assert sq.poi_at(boxes, "Unknown_Main", 1500, 1500) is None
    assert sq.poi_at(boxes, "Baltic_Main", None, 1500) is None


def test_poi_at_maps_erangel_alias():
    """Die Telemetrie nennt Erangel teils Erangel_Main, die POI-Datei
    Baltic_Main — der Endpoint gleicht das schon ab, hier auch."""
    boxes = sq.poi_boxes(POIS)
    assert sq.poi_at(boxes, "Erangel_Main", 1500, 1500) == "Testville"


def test_first_landing_per_player_keeps_the_earliest():
    rows = [
        {"match_id": "m1", "actor_account": "a", "timestamp_ms": 500,
         "actor_x": 1, "actor_y": 1, "map_name": "M"},
        {"match_id": "m1", "actor_account": "a", "timestamp_ms": 100,
         "actor_x": 2, "actor_y": 2, "map_name": "M"},
        {"match_id": "m1", "actor_account": "b", "timestamp_ms": 300,
         "actor_x": 3, "actor_y": 3, "map_name": "M"},
    ]
    got = sq.first_landings(rows)
    assert got[("m1", "a")]["timestamp_ms"] == 100
    assert got[("m1", "b")]["timestamp_ms"] == 300


def test_summarise_landings_computes_diff_to_lobby():
    """Der Kern der POI-Auswertung: eigene Fruehtod-Quote je POI GEGEN die
    Lobby-Quote am selben Ort. Das trennt schwieriger Platz von
    verlorenem Landefight."""
    own = [
        {"poi": "Testville", "map": "Baltic_Main", "earlyDeath": True,
         "timeSurvived": 120, "kills": 0, "damage": 50, "place": 40},
        {"poi": "Testville", "map": "Baltic_Main", "earlyDeath": False,
         "timeSurvived": 900, "kills": 3, "damage": 400, "place": 5},
    ]
    lobby = {("Baltic_Main", "Testville"): {"drops": 100, "early": 25}}
    out = sq.summarise_landings(own, lobby, min_drops=1)
    row = out[0]
    assert row["poi"] == "Testville"
    assert row["drops"] == 2
    assert row["earlyDeathPct"] == pytest.approx(50.0)
    assert row["lobbyEarlyPct"] == pytest.approx(25.0)
    assert row["diff"] == pytest.approx(25.0)
    assert row["lobbyDrops"] == 100
    assert row["avgKills"] == pytest.approx(1.5)


def test_summarise_landings_flags_thin_samples():
    """Unter RELIABLE_POI_DROPS ist die Differenz nicht belastbar — das
    Flag haelt sie aus der Rangliste des Tools heraus."""
    few = [{"poi": "Selten", "map": "M", "earlyDeath": False,
            "timeSurvived": 100, "kills": 0, "damage": 0, "place": 10}] * 6
    many = [{"poi": "Oft", "map": "M", "earlyDeath": False,
             "timeSurvived": 100, "kills": 0, "damage": 0, "place": 10}] * 25
    out = {r["poi"]: r for r in sq.summarise_landings(few + many, {}, min_drops=5)}
    assert out["Selten"]["reliable"] is False
    assert out["Oft"]["reliable"] is True


def test_summarise_landings_hides_pois_below_min_drops():
    own = [{"poi": "Rar", "map": "M", "earlyDeath": False, "timeSurvived": 100,
            "kills": 0, "damage": 0, "place": 10}]
    assert sq.summarise_landings(own, {}, min_drops=5) == []


def test_summarise_landings_without_lobby_reference_leaves_diff_none():
    own = [{"poi": "X", "map": "M", "earlyDeath": True, "timeSurvived": 10,
            "kills": 0, "damage": 0, "place": 1}]
    row = sq.summarise_landings(own, {}, min_drops=1)[0]
    assert row["lobbyEarlyPct"] is None
    assert row["diff"] is None


def test_summarise_landings_sorts_by_drops():
    own = ([{"poi": "Wenig", "map": "M", "earlyDeath": False,
             "timeSurvived": 1, "kills": 0, "damage": 0, "place": 1}]
           + [{"poi": "Viel", "map": "M", "earlyDeath": False,
               "timeSurvived": 1, "kills": 0, "damage": 0, "place": 1}] * 3)
    out = sq.summarise_landings(own, {}, min_drops=1)
    assert [r["poi"] for r in out] == ["Viel", "Wenig"]


def test_landing_stats_scopes_to_tenant(pg_compat):
    """Landing-Events haengen an telemetry_events (ohne tenant_id) — der
    Filter muss ueber matches laufen."""
    conn, t1, t2 = pg_compat
    for tenant, mid in ((t1, "match.mine"), (t2, "match.other")):
        _seed(conn, tenant, "account.me", mid, survived=120)
        conn.execute(
            "INSERT INTO telemetry_events (match_id, event_type,"
            " actor_account, actor_x, actor_y, timestamp_ms)"
            " VALUES (?, 'Landing', 'account.me', 1500, 1500, 1000)", (mid,))
    conn.commit()

    out = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                           pois=POIS, min_drops=1)
    assert len(out["byPoi"]) == 1
    assert out["byPoi"][0]["drops"] == 1
    assert out["byPoi"][0]["poi"] == "Testville"


def test_landing_stats_counts_lobby_drops_and_deaths(pg_compat):
    conn, t1, _ = pg_compat
    _seed(conn, t1, "account.me", "match.a", survived=120)
    # Ein Gegner landet am selben POI und stirbt dort binnen 5 min
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " actor_x, actor_y, timestamp_ms)"
        " VALUES ('match.a', 'Landing', 'account.foe', 1500, 1500, 1000)")
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " target_account, victim_x, victim_y, timestamp_ms)"
        " VALUES ('match.a', 'Kill', 'account.me', 'account.foe',"
        " 1600, 1600, 60000)")
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " actor_x, actor_y, timestamp_ms)"
        " VALUES ('match.a', 'Landing', 'account.me', 1500, 1500, 1000)")
    conn.commit()

    out = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                           pois=POIS, min_drops=1)
    row = out["byPoi"][0]
    assert row["lobbyDrops"] == 2          # ich + der Gegner
    assert row["lobbyEarlyPct"] == pytest.approx(50.0)   # einer von zwei tot


def test_landing_stats_measures_own_and_lobby_on_the_same_clock(pg_compat):
    """Der eigene Wert darf NICHT aus time_survived kommen: das laeuft ab
    Rundenstart, das Lobby-Fenster ab der Landung. Gemischt kippt die
    Differenz ins Gegenteil — an Prod-Daten von +9,0 auf -10,5."""
    conn, t1, _ = pg_compat
    # time_survived 120 s waere "Fruehtod ab Rundenstart", aber der Kill
    # faellt 6 Minuten NACH der Landung — also kein Landefight.
    _seed(conn, t1, "account.me", "match.a", survived=120)
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " actor_x, actor_y, timestamp_ms)"
        " VALUES ('match.a', 'Landing', 'account.me', 1500, 1500, 1000)")
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " target_account, victim_x, victim_y, timestamp_ms)"
        " VALUES ('match.a', 'Kill', 'account.foe', 'account.me',"
        " 1600, 1600, 361000)")
    conn.commit()

    row = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                           pois=POIS, min_drops=1)["byPoi"][0]
    assert row["earlyDeathPct"] == pytest.approx(0.0)
    assert row["lobbyEarlyPct"] == pytest.approx(0.0)


def test_landing_stats_counts_own_lost_landing_fight(pg_compat):
    conn, t1, _ = pg_compat
    _seed(conn, t1, "account.me", "match.a", survived=900)
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " actor_x, actor_y, timestamp_ms)"
        " VALUES ('match.a', 'Landing', 'account.me', 1500, 1500, 1000)")
    # Tod 2 Minuten nach der Landung, im Landeplatz
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " target_account, victim_x, victim_y, timestamp_ms)"
        " VALUES ('match.a', 'Kill', 'account.foe', 'account.me',"
        " 1600, 1600, 121000)")
    conn.commit()

    row = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                           pois=POIS, min_drops=1)["byPoi"][0]
    assert row["earlyDeathPct"] == pytest.approx(100.0)
    assert row["lobbyEarlyPct"] == pytest.approx(100.0)
    assert row["diff"] == pytest.approx(0.0)


def test_landing_stats_does_not_count_death_outside_the_landing_spot(pg_compat):
    """Wegrotiert und woanders gefallen ist kein verlorener Landefight."""
    conn, t1, _ = pg_compat
    _seed(conn, t1, "account.me", "match.a", survived=900)
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " actor_x, actor_y, timestamp_ms)"
        " VALUES ('match.a', 'Landing', 'account.me', 1500, 1500, 1000)")
    # Tod rechtzeitig, aber im Nachbar-POI
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " target_account, victim_x, victim_y, timestamp_ms)"
        " VALUES ('match.a', 'Kill', 'account.foe', 'account.me',"
        " 3500, 3500, 121000)")
    conn.commit()

    row = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                           pois=POIS, min_drops=1)["byPoi"][0]
    assert row["earlyDeathPct"] == pytest.approx(0.0)


def test_landing_stats_ignores_deaths_after_the_window(pg_compat):
    conn, t1, _ = pg_compat
    _seed(conn, t1, "account.me", "match.a", survived=1200)
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " actor_x, actor_y, timestamp_ms)"
        " VALUES ('match.a', 'Landing', 'account.me', 1500, 1500, 1000)")
    # Tod 6 Minuten nach der Landung — kein Landefight mehr
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " target_account, victim_x, victim_y, timestamp_ms)"
        " VALUES ('match.a', 'Kill', 'account.foe', 'account.me',"
        " 1600, 1600, 361000)")
    conn.commit()

    out = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                           pois=POIS, min_drops=1)
    assert out["byPoi"][0]["lobbyEarlyPct"] == pytest.approx(0.0)


# ── Squad gegen Einzelperson am Landeplatz ──────────────────────────────────

def test_summarise_landings_splits_own_death_from_squad_wipe():
    """Der Fall, um den es geht: das Squad haelt den Platz, ich sterbe
    trotzdem. Dann ist der Platz nicht das Problem."""
    own = [
        # ich tot, Squad lebt weiter — mein Fehler, nicht der des Platzes
        {"poi": "P", "map": "M", "earlyDeath": True, "squadWiped": False,
         "squadSize": 4, "timeSurvived": 100, "kills": 0, "damage": 0, "place": 30},
        {"poi": "P", "map": "M", "earlyDeath": True, "squadWiped": False,
         "squadSize": 4, "timeSurvived": 110, "kills": 0, "damage": 0, "place": 28},
        # Squad komplett weg — da war der Platz zu heiss
        {"poi": "P", "map": "M", "earlyDeath": True, "squadWiped": True,
         "squadSize": 4, "timeSurvived": 90, "kills": 0, "damage": 0, "place": 40},
        # alles gut
        {"poi": "P", "map": "M", "earlyDeath": False, "squadWiped": False,
         "squadSize": 4, "timeSurvived": 900, "kills": 2, "damage": 300, "place": 4},
    ]
    row = sq.summarise_landings(own, {}, min_drops=1)[0]
    assert row["earlyDeathPct"] == pytest.approx(75.0)
    assert row["squadWipedPct"] == pytest.approx(25.0)
    # ich tot, Squad aber nicht ausgeloescht: 2 von 4
    assert row["diedSquadAlivePct"] == pytest.approx(50.0)


def test_summarise_landings_ignores_solo_rounds_for_squad_wipe():
    """Bei Squad-Groesse 1 ist "Squad wiped" dasselbe wie "ich tot" und
    traegt keine eigene Aussage — solche Runden bleiben aus dem Nenner."""
    own = [
        {"poi": "P", "map": "M", "earlyDeath": True, "squadWiped": True,
         "squadSize": 1, "timeSurvived": 100, "kills": 0, "damage": 0, "place": 40},
        {"poi": "P", "map": "M", "earlyDeath": False, "squadWiped": False,
         "squadSize": 3, "timeSurvived": 900, "kills": 1, "damage": 90, "place": 6},
    ]
    row = sq.summarise_landings(own, {}, min_drops=1)
    assert row[0]["squadRounds"] == 1
    assert row[0]["squadWipedPct"] == pytest.approx(0.0)


def test_summarise_landings_without_squad_data_leaves_squad_none():
    own = [{"poi": "P", "map": "M", "earlyDeath": True, "timeSurvived": 100,
            "kills": 0, "damage": 0, "place": 10}]
    row = sq.summarise_landings(own, {}, min_drops=1)[0]
    assert row["squadWipedPct"] is None
    assert row["diedSquadAlivePct"] is None


def test_landing_stats_reports_squad_survived_while_i_died(pg_compat):
    conn, t1, _ = pg_compat
    _seed(conn, t1, "account.me", "match.a", survived=120)
    # Mate im selben Team (team_id 1, wie in _seed)
    conn.execute(
        "INSERT INTO participants (tenant_id, match_id, account_id, name,"
        " place, kills, damage_dealt, time_survived, dbnos, assists, revives,"
        " heals, boosts, weapons_acquired, walk_distance, ride_distance,"
        " headshot_kills, team_id, longest_kill, swim_distance, team_kills)"
        " VALUES (?, 'match.a', 'account.mate', 'Mate', 3, 4, 500, 1500,"
        " 2, 1, 0, 3, 2, 8, 2000, 500, 1, 1, 200, 0, 0)", (t1,))
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " actor_x, actor_y, timestamp_ms)"
        " VALUES ('match.a', 'Landing', 'account.me', 1500, 1500, 1000)")
    # nur ICH sterbe, der Mate nicht
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " target_account, victim_x, victim_y, timestamp_ms)"
        " VALUES ('match.a', 'Kill', 'account.foe', 'account.me',"
        " 1600, 1600, 60000)")
    conn.commit()

    row = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                           pois=POIS, min_drops=1)["byPoi"][0]
    assert row["earlyDeathPct"] == pytest.approx(100.0)
    assert row["squadWipedPct"] == pytest.approx(0.0)
    assert row["diedSquadAlivePct"] == pytest.approx(100.0)


def test_landing_stats_reports_squad_wipe(pg_compat):
    conn, t1, _ = pg_compat
    _seed(conn, t1, "account.me", "match.a", survived=120)
    conn.execute(
        "INSERT INTO participants (tenant_id, match_id, account_id, name,"
        " place, kills, damage_dealt, time_survived, dbnos, assists, revives,"
        " heals, boosts, weapons_acquired, walk_distance, ride_distance,"
        " headshot_kills, team_id, longest_kill, swim_distance, team_kills)"
        " VALUES (?, 'match.a', 'account.mate', 'Mate', 30, 0, 40, 130,"
        " 0, 0, 0, 1, 0, 3, 300, 0, 0, 1, 0, 0, 0)", (t1,))
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " actor_x, actor_y, timestamp_ms)"
        " VALUES ('match.a', 'Landing', 'account.me', 1500, 1500, 1000)")
    for victim in ("account.me", "account.mate"):
        conn.execute(
            "INSERT INTO telemetry_events (match_id, event_type,"
            " actor_account, target_account, victim_x, victim_y, timestamp_ms)"
            " VALUES ('match.a', 'Kill', 'account.foe', ?, 1600, 1600, 60000)",
            (victim,))
    conn.commit()

    row = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                           pois=POIS, min_drops=1)["byPoi"][0]
    assert row["squadWipedPct"] == pytest.approx(100.0)
    assert row["diedSquadAlivePct"] == pytest.approx(0.0)


def test_landing_stats_reports_untruncated_totals_per_map(pg_compat):
    """Die Kartenzeile im Tool darf nicht die Summe der gezeigten Zeilen
    nennen: auf Deston fielen bei min_drops=5 zwei Drittel der Landungen
    weg und die Zeile las sich wie die Gesamtzahl."""
    conn, t1, _ = pg_compat
    # 3 Landungen im POI, 1 daneben im Gelaende
    for i, (x, y) in enumerate([(1500, 1500), (1500, 1600), (1500, 1700),
                                (9000, 9000)]):
        _seed(conn, t1, "account.me", f"match.{i}", survived=900)
        conn.execute(
            "INSERT INTO telemetry_events (match_id, event_type,"
            " actor_account, actor_x, actor_y, timestamp_ms)"
            " VALUES (?, 'Landing', 'account.me', ?, ?, 1000)",
            (f"match.{i}", x, y))
    conn.commit()

    out = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                           pois=POIS, min_drops=1)
    per_map = {m["map"]: m for m in out["perMap"]}
    assert per_map["Baltic_Main"]["landings"] == 4
    assert per_map["Baltic_Main"]["assigned"] == 3
    assert per_map["Baltic_Main"]["spots"] == 1


def test_landing_stats_default_min_drops_keeps_rare_spots(pg_compat):
    conn, t1, _ = pg_compat
    _seed(conn, t1, "account.me", "match.a", survived=900)
    conn.execute(
        "INSERT INTO telemetry_events (match_id, event_type, actor_account,"
        " actor_x, actor_y, timestamp_ms)"
        " VALUES ('match.a', 'Landing', 'account.me', 1500, 1500, 1000)")
    conn.commit()

    # Ohne min_drops-Argument: der Default darf einen Einzel-Drop nicht
    # verschlucken, sonst verschwinden ganze Karten aus der Auswertung.
    out = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                           pois=POIS)
    assert len(out["byPoi"]) == 1
    assert out["byPoi"][0]["reliable"] is False


# ── Unterbereiche zusammenfassen ────────────────────────────────────────────

def test_base_poi_strips_the_subarea():
    assert sq.base_poi("Cavala - Warehouses") == "Cavala"
    assert sq.base_poi("Fishing Camp - South") == "Fishing Camp"
    assert sq.base_poi("Bootyard") == "Bootyard"
    # Kein Trenner-Fehlalarm bei Bindestrich im Namen
    assert sq.base_poi("Das-Flip") == "Das-Flip"


def test_summarise_landings_can_merge_subareas():
    """Cavala, Cavala - Apartments und Cavala - Warehouses sind derselbe
    Absprung-Entschluss. Zusammengefasst tragen sie ein Sample, getrennt
    zeigen sie Unterschiede — deshalb umschaltbar."""
    own = [
        {"poi": "Cavala", "map": "M", "earlyDeath": True, "timeSurvived": 100,
         "kills": 0, "damage": 0, "place": 30},
        {"poi": "Cavala - Warehouses", "map": "M", "earlyDeath": False,
         "timeSurvived": 900, "kills": 2, "damage": 200, "place": 5},
        {"poi": "Cavala - Apartments", "map": "M", "earlyDeath": False,
         "timeSurvived": 800, "kills": 1, "damage": 150, "place": 8},
    ]
    lobby = {
        ("M", "Cavala"): {"drops": 100, "early": 40},
        ("M", "Cavala - Warehouses"): {"drops": 50, "early": 10},
        ("M", "Cavala - Apartments"): {"drops": 50, "early": 20},
    }
    sep = sq.summarise_landings(own, lobby, min_drops=1)
    assert len(sep) == 3

    merged = sq.summarise_landings(own, lobby, min_drops=1,
                                   group_subareas=True)
    assert len(merged) == 1
    row = merged[0]
    assert row["poi"] == "Cavala"
    assert row["drops"] == 3
    assert row["earlyDeathPct"] == pytest.approx(100.0 / 3)
    # Lobby MUSS mitgruppiert werden, sonst vergleicht man 3 eigene Drops
    # gegen nur einen der drei Unterbereiche
    assert row["lobbyDrops"] == 200
    assert row["lobbyEarlyPct"] == pytest.approx(35.0)
    assert row["subAreas"] == 3


def test_summarise_landings_marks_single_area_without_subareas():
    own = [{"poi": "Bootyard", "map": "M", "earlyDeath": False,
            "timeSurvived": 900, "kills": 0, "damage": 0, "place": 5}]
    row = sq.summarise_landings(own, {}, min_drops=1, group_subareas=True)[0]
    assert row["subAreas"] == 1


def test_landing_stats_passes_grouping_through(pg_compat):
    conn, t1, _ = pg_compat
    pois = {"Baltic_Main": {"regions": [
        {"name": "Ort", "points": [[1000, 1000], [1500, 1000],
                                    [1500, 1500], [1000, 1500]]},
        {"name": "Ort - Lager", "points": [[1600, 1000], [2000, 1000],
                                            [2000, 1500], [1600, 1500]]},
    ]}}
    for i, x in enumerate((1200, 1800)):
        _seed(conn, t1, "account.me", f"match.{i}", survived=900)
        conn.execute(
            "INSERT INTO telemetry_events (match_id, event_type,"
            " actor_account, actor_x, actor_y, timestamp_ms)"
            " VALUES (?, 'Landing', 'account.me', ?, 1200, 1000)",
            (f"match.{i}", x))
    conn.commit()

    sep = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                           pois=pois, min_drops=1)
    assert len(sep["byPoi"]) == 2

    merged = sq.landing_stats(conn, t1, "account.me", "1970-01-01T00:00:00Z",
                              pois=pois, min_drops=1, group_subareas=True)
    assert len(merged["byPoi"]) == 1
    assert merged["byPoi"][0]["drops"] == 2
