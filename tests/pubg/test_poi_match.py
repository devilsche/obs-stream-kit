from pubg.poi_match import point_in_poly, poly_area, dist_to_poly
from pubg.poi_match import match_poi
from pubg.poi_match import perp_distance_to_route


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


def test_perp_distance_on_line_is_zero():
    # Route entlang x-Achse (0,0)->(100,0); Punkt (50,0) liegt drauf
    d = perp_distance_to_route(50, 0, 0, 0, 100, 0)
    assert abs(d) < 1e-6


def test_perp_distance_perpendicular():
    # Punkt 30 ueber der Linie
    d = perp_distance_to_route(50, 30, 0, 0, 100, 0)
    assert abs(d - 30) < 1e-6


def test_perp_distance_degenerate_route():
    # A == B → Distanz = Punkt-zu-Punkt
    d = perp_distance_to_route(3, 4, 0, 0, 0, 0)
    assert abs(d - 5) < 1e-6


from pubg.poi_match import apply_pin_cal


def test_apply_pin_cal_identity_when_empty():
    assert apply_pin_cal(400000, 300000, 8, None) == (400000, 300000)
    assert apply_pin_cal(400000, 300000, 8, {}) == (400000, 300000)


def test_apply_pin_cal_offset_shifts_in_cm():
    x, y = apply_pin_cal(400000, 400000, 8, {"offsetX": 5000, "offsetY": -3000})
    assert x == 405000
    assert y == 397000


def test_apply_pin_cal_flipx_mirrors_around_center():
    # mapKm=8 → center=400000; flipX spiegelt x
    x, y = apply_pin_cal(300000, 400000, 8, {"flipX": True})
    assert x == 500000  # 2*400000 - 300000
    assert y == 400000


def test_apply_pin_cal_scale_center_anchored():
    # Punkt auf dem Zentrum bleibt fix bei scale
    x, y = apply_pin_cal(400000, 400000, 8, {"scaleX": 2, "scaleY": 2})
    assert x == 400000 and y == 400000
    # Punkt abseits skaliert um Zentrum
    x2, y2 = apply_pin_cal(500000, 400000, 8, {"scaleX": 2})
    assert x2 == 600000  # (500000-400000)*2 + 400000
