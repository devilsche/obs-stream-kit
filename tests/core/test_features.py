"""Freischaltungen je Tenant (nur der Admin setzt sie): Liste in settings['features']."""
from core import features


def test_parse_keeps_only_known_unique_sorted():
    assert features.parse('["sushi-eater", "nope", "sushi-eater"]') == ["sushi-eater"]


def test_parse_tolerates_garbage():
    for raw in (None, "", "kaputt{", '{"a": 1}', "[1, 2]"):
        assert features.parse(raw) == []


def test_catalog_has_sushi_eater_with_label():
    assert "sushi-eater" in features.FEATURES
    assert features.FEATURES["sushi-eater"]


class _Cur:
    def __init__(self, rows): self.rows, self.sql = rows, ""
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def execute(self, sql, args=None): self.sql = sql
    def fetchone(self): return self.rows.get("admin" if "is_admin" in self.sql else "setting")


class _Conn:
    def __init__(self, rows): self.rows = rows
    def cursor(self): return _Cur(self.rows)


def test_admin_tenant_has_everything():
    conn = _Conn({"admin": {"is_admin": True}, "setting": None})
    assert features.effective(conn, 1) == sorted(features.FEATURES)


def test_other_tenant_only_what_admin_enabled():
    conn = _Conn({"admin": {"is_admin": False}, "setting": {"value": '["sushi-eater"]'}})
    assert features.effective(conn, 2) == ["sushi-eater"]
    conn = _Conn({"admin": None, "setting": None})
    assert features.effective(conn, 3) == ["pubg"]          # nichts gespeichert → Standard
    conn = _Conn({"admin": None, "setting": {"value": "[]"}})
    assert features.effective(conn, 3) == []                # Admin hat alles abgehakt


def test_extras_map_sources_and_api():
    assert features.EXTRAS == ("pubg", "g1r", "race", "ducks", "weather")
    assert features.DEFAULT_ON == ("pubg",)
    assert features.source_feature("winter.html") == "weather"
    assert features.source_feature("item-rain.html") == "race"
    assert features.source_feature("duck-court.html") == "ducks"
    assert features.source_feature("lens-flare.html") is None
    assert features.api_feature("weather/state") == "weather"
    assert features.api_feature("xmas/poll") == "weather"
    assert features.api_feature("car-race") == "race"
    assert features.api_feature("cars/model/x.glb") == "race"
    assert features.api_feature("track-ads.json") == "race"
    assert features.api_feature("ducks/parade") is None


def test_effective_cached_remembers_ten_seconds():
    features._cache.clear()
    calls = []

    def load():
        calls.append(1)
        return ["race"]
    assert features.effective_cached(load, 9, now=100) == ["race"]
    assert features.effective_cached(load, 9, now=105) == ["race"] and len(calls) == 1
    features.effective_cached(load, 9, now=111)
    assert len(calls) == 2
    features._cache.clear()
