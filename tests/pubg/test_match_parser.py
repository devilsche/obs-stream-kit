import json
import os
from pubg.match_parser import (parse_match_response, find_my_team_id,
                                parse_lifetime_response, aggregate_lifetime_modes)

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def _load(name):
    with open(os.path.join(FIXTURES, name)) as f:
        return json.load(f)


def test_parse_match_response_extracts_meta():
    parsed = parse_match_response(_load("match_response.json"), "account.abc123")
    assert parsed["match_id"] == "match-1"
    assert parsed["map_name"] == "Erangel_Main"
    assert parsed["game_mode"] == "squad-fpp"
    assert parsed["duration_secs"] == 1820
    assert parsed["played_at"] == "2026-05-04T18:00:00Z"
    assert parsed["telemetry_url"] == "https://example/tel.json"


def test_parse_match_response_returns_only_my_squad():
    parsed = parse_match_response(_load("match_response.json"), "account.abc123")
    names = {p["name"] for p in parsed["squad_participants"]}
    assert names == {"PEX_LuCKoR", "MateA"}


def test_parse_match_response_self_account_id_marked():
    parsed = parse_match_response(_load("match_response.json"), "account.abc123")
    assert parsed["my_team_id"] == 5
    assert parsed["squad_participants"][0]["place"] == 3


def test_parse_lifetime_extracts_per_mode():
    payload = _load("lifetime_response.json")
    modes = parse_lifetime_response(payload)
    assert "squad-fpp" in modes
    assert modes["squad-fpp"]["rounds_played"] == 16509
    assert modes["squad-fpp"]["wins"] == 885
    assert round(modes["squad-fpp"]["kd_ratio"], 2) == round(23974 / (16509 - 885), 2)
    assert round(modes["squad-fpp"]["win_rate"], 3) == round(885 / 16509 * 100, 3)
    assert "duo-fpp" in modes


def test_parse_lifetime_aggregate_all():
    payload = _load("lifetime_response.json")
    modes = parse_lifetime_response(payload)
    agg = aggregate_lifetime_modes(modes)
    assert agg["rounds_played"] == 16509 + 200
    assert agg["wins"] == 885 + 12
