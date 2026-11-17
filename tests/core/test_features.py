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
