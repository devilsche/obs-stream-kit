from pubg.poi_match import point_in_poly, poly_area, dist_to_poly
from pubg.poi_match import match_poi


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


def _regions():
    # Grosse Region "City" enthaelt kleine "Downtown"
    return [
        {"name": "City",     "points": [[0, 0], [200, 0], [200, 200], [0, 200]]},
        {"name": "Downtown", "points": [[80, 80], [120, 80], [120, 120], [80, 120]]},
        {"name": "",         "points": [[300, 300], [400, 300], [350, 400]]},
    ]


def test_match_poi_smallest_enclosing_wins():
    # Punkt im Downtown (auch in City) → Downtown (kleinere Flaeche)
    assert match_poi(100, 100, _regions()) == "Downtown"


def test_match_poi_only_outer():
    assert match_poi(20, 20, _regions()) == "City"


def test_match_poi_none_when_outside():
    assert match_poi(1000, 1000, _regions()) is None


def test_match_poi_ignores_unnamed_regions():
    # Punkt im namenlosen Dreieck → None (kein Label)
    assert match_poi(350, 330, _regions()) is None
