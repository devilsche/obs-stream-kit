import json
from pubg.config import load_config, load_api_key


def test_load_config_returns_dict_with_required_keys(tmp_path):
    cfg_file = tmp_path / "pubg.json"
    cfg_file.write_text(json.dumps({
        "playerName": "PEX_LuCKoR",
        "platform": "steam",
        "stammCrew": ["MateA"],
        "pollIntervalSec": 60,
        "minMatchesForLifetime": 5,
        "minMatchesForTopMates": 10
    }))
    cfg = load_config(str(cfg_file))
    assert cfg["playerName"] == "PEX_LuCKoR"
    assert cfg["platform"] == "steam"
    assert cfg["pollIntervalSec"] == 60


def test_load_api_key_from_secrets(tmp_path):
    secrets = tmp_path / ".secrets"
    secrets.write_text("Client-ID: x\nPUBG-API-Key: my-key-123\n")
    assert load_api_key(str(secrets)) == "my-key-123"


def test_load_api_key_accepts_spaces_in_key_name(tmp_path):
    secrets = tmp_path / ".secrets"
    secrets.write_text("Client-ID: x\nPUBG API Key: my-key-456\n")
    assert load_api_key(str(secrets)) == "my-key-456"


def test_load_api_key_missing_returns_none(tmp_path):
    secrets = tmp_path / ".secrets"
    secrets.write_text("Client-ID: x\n")
    assert load_api_key(str(secrets)) is None
