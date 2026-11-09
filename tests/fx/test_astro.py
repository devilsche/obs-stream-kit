"""Sonnen- und Mondstand (Formeln nach SunCalc, Referenzwerte aus dessen Tests)."""
import math
from datetime import datetime, timezone

from fx.astro import moon_illumination, moon_position, sky_xy, sun_position

T = datetime(2013, 3, 5, tzinfo=timezone.utc).timestamp()


def test_sun_position_matches_suncalc():
    az, alt = sun_position(T, 50.5, 30.5)
    assert math.isclose(az, -2.5003175907168385, abs_tol=1e-9)
    assert math.isclose(alt, -0.7000406838781611, abs_tol=1e-9)


def test_moon_position_matches_suncalc():
    az, alt = moon_position(T, 50.5, 30.5)
    assert math.isclose(az, -0.9783999522438226, abs_tol=1e-9)
    assert math.isclose(alt, 0.014551482243892251, abs_tol=1e-9)


def test_moon_illumination_matches_suncalc():
    lit, phase = moon_illumination(T)
    assert math.isclose(lit, 0.4848068202456373, abs_tol=1e-9)
    assert math.isclose(phase, 0.7548368838538762, abs_tol=1e-9)


def test_sky_xy_north_rises_left_sets_right_high_is_top():
    east = sky_xy(-math.pi / 2, 0.05, 50)
    south = sky_xy(0, math.pi / 3, 50)
    west = sky_xy(math.pi / 2, 0.05, 50)
    assert east[0] < south[0] < west[0]
    assert south[1] < east[1]


def test_sky_xy_south_hemisphere_faces_north():
    east = sky_xy(-math.pi / 2, 0.05, -33)
    west = sky_xy(math.pi / 2, 0.05, -33)
    assert east[0] > west[0]


def test_sky_xy_is_coarse():
    x, y = sky_xy(0.1234, 0.4321, 50)
    assert round(x / 0.02, 6) == round(x / 0.02) and round(y / 0.05, 6) == round(y / 0.05)
