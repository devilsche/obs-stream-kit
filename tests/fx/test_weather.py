"""Wetterlogik: Lagen, Open-Meteo-Codes, K/D-Stimmung."""
from fx.weather import KINDS, SPECTACLES, apply_mood, from_api, mood_precip, mood_value, profile


def test_profiles_cover_all_kinds():
    assert KINDS == ("clear", "cloudy", "fog", "drizzle", "rain", "storm",
                     "sleet", "snow", "blizzard", "heat", "day", "night", "dawn", "dusk")
    assert SPECTACLES == ("tsunami", "megabolt", "ballbolt", "avalanche",
                          "aurora", "rainbow", "hail", "meteors", "tornado", "fogwall")
    for k in KINDS:
        p = profile(k)
        assert p["kind"] == k and p["wind"] == 0 and 0 <= p["gloom"] <= 1
    assert profile("hail")["kind"] == "clear"


def test_wmo_codes_map_to_kinds():
    assert from_api(0, 12, 5, 270)["kind"] == "clear"
    assert from_api(3, 12, 5, 270)["kind"] == "cloudy"
    assert from_api(45, 5, 5, 270)["kind"] == "fog"
    assert from_api(53, 8, 5, 270)["kind"] == "drizzle"
    assert from_api(63, 8, 5, 270)["kind"] == "rain"
    assert from_api(81, 8, 5, 270)["kind"] == "rain"
    assert from_api(67, 0, 5, 270)["kind"] == "sleet"
    assert from_api(73, -3, 10, 270)["kind"] == "snow"
    assert from_api(75, -3, 45, 270)["kind"] == "blizzard"   # starker Schnee + Wind ≥ 40
    assert from_api(75, -3, 20, 270)["kind"] == "snow"
    assert from_api(95, 20, 30, 270)["kind"] == "storm"
    assert from_api(1, 31, 5, 270)["kind"] == "heat"         # klar + ≥ 30 °C
    assert from_api(1234, 10, 5, 270)["kind"] == "clear"     # unbekannter Code


def test_heavy_rain_is_denser():
    assert from_api(65, 8, 5, 270)["rain"] > from_api(63, 8, 5, 270)["rain"]


def test_frost_and_wind():
    s = from_api(0, -0.5, 25, 270)            # Westwind weht nach rechts
    assert s["freezing"] is True and s["wind"] == 0.5 and s["temp"] == -0.5
    assert from_api(0, 3, 50, 90)["wind"] == -1.0
    assert from_api(0, 3, 50, 90)["freezing"] is False


def test_mood_neutral_without_live_session_or_few_rounds():
    assert mood_value(3.0, 10, live=False) == 0
    assert mood_value(3.0, 2, live=True) == 0


def test_mood_fixed_default_bounds():
    assert mood_value(1.4, 5, True) == -1                    # unter 1,5 schlecht
    assert mood_value(2.6, 5, True) == 1                     # über 2,5 gut
    assert mood_value(2.0, 5, True) == 0
    assert mood_value(1.75, 5, True) == -0.5
    assert mood_value(2.0, 5, True, low=1.0, high=2.0) == 1
    assert mood_value(2.0, 5, True, low=3.0, high=2.0) == 0  # kaputte Grenzen → neutral


def test_mood_brings_rain_but_never_storm():
    assert mood_precip(1.4, 1.5) == "drizzle"
    assert mood_precip(1.1, 1.5) == "rain"                   # ≤ 0,75 × untere Grenze
    assert mood_precip(1.6, 1.5) is None
    s = apply_mood(from_api(0, 15, 5, 270), -1, 1.0, "rain")
    assert s["kind"] == "rain" and s["lightning"] == 0 and s["gloom"] == 1


def test_bad_mood_keeps_real_precipitation():
    base = from_api(73, -3, 10, 270)
    s = apply_mood(base, -1, 1.0, "rain")
    assert s["kind"] == "snow" and s["rain"] == 0


def test_good_mood_keeps_snow_but_adds_sun():
    base = from_api(73, -3, 10, 270)
    s = apply_mood(base, 1, 1.0, None)
    assert s["kind"] == "snow" and s["precip"] == "snow"
    assert s["sun"] > base["sun"] and s["clouds"] < base["clouds"]


def test_strength_zero_is_pure_weather():
    base = from_api(3, 12, 5, 270)
    assert apply_mood(base, -1, 0, "rain") == base


from fx.weather import daylight


def test_night_and_dusk_profiles_exist():
    assert profile("night")["night"] == 1 and profile("night")["sun"] == 0
    assert profile("dusk")["dusk"] == 1
    assert profile("clear")["night"] == 0 and profile("clear")["dusk"] == 0


def test_partly_cloudy_is_clear_with_clouds_from_cover():
    few = from_api(2, 12, 5, 270, cloud=20)
    many = from_api(2, 12, 5, 270, cloud=60)
    assert few["kind"] == many["kind"] == "clear"
    assert many["clouds"] > few["clouds"] and many["sun"] < few["sun"]
    assert from_api(0, 12, 5, 270, cloud=0)["sun"] == profile("clear")["sun"]
    assert from_api(3, 12, 5, 270, cloud=90)["kind"] == "cloudy"


SUNRISE, SUNSET = 1_000_000, 1_000_000 + 9 * 3600


def test_daylight_day_night_and_twilight():
    assert daylight(SUNRISE + 4 * 3600, SUNRISE, SUNSET) == {"night": 0, "dusk": 0}
    assert daylight(SUNSET + 3 * 3600, SUNRISE, SUNSET) == {"night": 1, "dusk": 0}
    assert daylight(SUNRISE - 3 * 3600, SUNRISE, SUNSET) == {"night": 1, "dusk": 0}
    at_set = daylight(SUNSET, SUNRISE, SUNSET)
    assert at_set["dusk"] == 1 and 0 < at_set["night"] < 1
    later = daylight(SUNSET + 30 * 60, SUNRISE, SUNSET)
    assert later["night"] > at_set["night"] and 0 < later["dusk"] < 1


def test_night_puts_out_the_sun_even_with_good_mood():
    s = apply_mood({**profile("clear"), "night": 1}, 1, 1.0, None)
    assert s["sun"] == 0


def test_wet_kinds_bring_their_own_gloom_and_mood_scales_it():
    assert profile("storm")["gloom"] > profile("rain")["gloom"] > profile("clear")["gloom"] == 0
    assert apply_mood(profile("rain"), 1, 1.0, None)["gloom"] < profile("rain")["gloom"]
    assert apply_mood(profile("storm"), -0.2, 1.0, None)["gloom"] == profile("storm")["gloom"]


def test_bad_mood_rain_cools_a_heatwave():
    s = apply_mood(profile("heat"), -1, 1.0, "rain")
    assert s["kind"] == "rain" and s["heat"] <= 0.2
    assert apply_mood(profile("heat"), -0.5, 1.0, None)["heat"] < 1


def test_good_mood_thins_fog():
    assert apply_mood(profile("fog"), 1, 1.0, None)["fog"] < profile("fog")["fog"] * 0.6


def test_good_mood_barely_brightens_storm_or_blizzard():
    for k in ("storm", "blizzard"):
        s = apply_mood(profile(k), 1, 1.0, None)
        assert s["sun"] <= 0.25 and s["lightning"] == profile(k)["lightning"]
    assert apply_mood(profile("rain"), 1, 1.0, None)["sun"] >= 0.5      # Sonnenregen bleibt


def test_good_mood_does_not_turn_overcast_into_full_sun():
    s = apply_mood(profile("cloudy"), 1, 1.0, None)
    assert s["sun"] <= 0.4 and s["clouds"] >= 0.45
    assert apply_mood(profile("clear"), 1, 1.0, None)["sun"] == 1
