from pubg.poi_match import point_in_poly, poly_area, dist_to_poly


SQUARE = [[0, 0], [100, 0], [100, 100], [0, 100]]


def test_point_in_poly_inside():
    assert point_in_poly(50, 50, SQUARE) is True


def test_point_in_poly_outside():
    assert point_in_poly(150, 50, SQUARE) is False


def test_poly_area_square():
    assert poly_area(SQUARE) == 10000


def test_dist_to_poly_outside_is_positive():
    # Punkt 50 rechts der rechten Kante
    d = dist_to_poly(150, 50, SQUARE)
    assert abs(d - 50) < 1e-6


def test_dist_to_poly_inside_touches_edge():
    # Punkt innen, naechste Kante 10 entfernt
    d = dist_to_poly(10, 50, SQUARE)
    assert abs(d - 10) < 1e-6
