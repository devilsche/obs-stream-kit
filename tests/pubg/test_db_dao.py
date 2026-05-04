import datetime
from pubg.db import connect, init_schema, upsert_player, get_player_by_name


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    return conn


def test_upsert_player_inserts_new(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, account_id="account.A", name="PEX_LuCKoR",
                  platform="steam", is_self=True)
    p = get_player_by_name(conn, "PEX_LuCKoR")
    assert p["account_id"] == "account.A"
    assert p["is_self"] == 1


def test_upsert_player_updates_name_on_conflict(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.A", "OldName", "steam", False)
    upsert_player(conn, "account.A", "NewName", "steam", False)
    p = get_player_by_name(conn, "NewName")
    assert p["account_id"] == "account.A"
    assert get_player_by_name(conn, "OldName") is None
