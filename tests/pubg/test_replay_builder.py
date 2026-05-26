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
