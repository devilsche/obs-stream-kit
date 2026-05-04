import json
import os
import pytest
from unittest.mock import patch
from pubg.api_client import PubgClient, RateLimitError

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def _load(name):
    with open(os.path.join(FIXTURES, name)) as f:
        return json.load(f)


def test_get_player_calls_correct_url():
    client = PubgClient(api_key="key", platform="steam")
    fake_resp = _load("player_response.json")
    with patch.object(client, "_get_json", return_value=fake_resp) as m:
        result = client.get_player("PEX_LuCKoR")
    m.assert_called_once()
    url = m.call_args[0][0]
    assert "/shards/steam/players" in url
    assert "filter[playerNames]=PEX_LuCKoR" in url
    assert result["data"][0]["attributes"]["name"] == "PEX_LuCKoR"


def test_get_match_returns_data():
    client = PubgClient(api_key="key", platform="steam")
    with patch.object(client, "_get_json", return_value=_load("match_response.json")):
        m = client.get_match("match-1")
    assert m["data"]["id"] == "match-1"


def test_get_player_match_ids_extracts_relationships():
    ids = PubgClient.extract_match_ids(_load("player_response.json"))
    assert ids == ["match-1", "match-2"]


def test_rate_limit_blocks_requests():
    client = PubgClient(api_key="key", platform="steam",
                        rate_limiter_max=1, rate_limiter_window=60)
    with patch.object(client, "_raw_get", return_value=b'{}'):
        client._get_json("https://x")
    with pytest.raises(RateLimitError):
        client._get_json("https://x")
