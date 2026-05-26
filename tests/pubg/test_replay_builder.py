from pubg.replay_builder import normalize_coords


def test_normalize_coords_center_is_half():
    # Map-Mitte (4km von 8km) → 0.5/0.5
    x, y = normalize_coords(400000, 400000, mapKm=8)
    assert abs(x - 0.5) < 1e-6
    assert abs(y - 0.5) < 1e-6


def test_normalize_coords_origin_is_zero():
    x, y = normalize_coords(0, 0, mapKm=8)
    assert x == 0.0 and y == 0.0


def test_normalize_coords_clamps_out_of_range():
    # Über die Kartengrenze hinaus → geclamped auf [0,1]
    x, y = normalize_coords(9_000_000, -5000, mapKm=8)
    assert x == 1.0
    assert y == 0.0


def test_normalize_coords_sanhok_4km():
    x, y = normalize_coords(200000, 200000, mapKm=4)
    assert abs(x - 0.5) < 1e-6


from pubg.replay_builder import team_colors


def test_team_colors_assigns_distinct_per_team():
    colors = team_colors([1, 2, 3])
    assert set(colors.keys()) == {1, 2, 3}
    assert len(set(colors.values())) == 3  # alle verschieden
    for hexc in colors.values():
        assert hexc.startswith("#") and len(hexc) == 7


def test_team_colors_wraps_when_more_teams_than_palette():
    ids = list(range(1, 40))  # mehr als Palette
    colors = team_colors(ids)
    assert len(colors) == 39  # jedes Team kriegt eine Farbe (mit Wrap)
    for hexc in colors.values():
        assert hexc.startswith("#")


def test_team_colors_stable_order():
    # Gleiche Input-Menge → gleiche Zuordnung (sortiert nach team_id)
    a = team_colors([3, 1, 2])
    b = team_colors([1, 2, 3])
    assert a == b
