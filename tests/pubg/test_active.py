import datetime
import json
from unittest.mock import MagicMock
from pubg.db import connect, init_schema, upsert_player, insert_match
from pubg.cache import TTLCache
from pubg.endpoints import EndpointRegistry, PUBG_STEAM_APPID

PUBG = PUBG_STEAM_APPID


def _iso(minutes_ago):
    dt = (datetime.datetime.now(datetime.timezone.utc)
          - datetime.timedelta(minutes=minutes_ago))
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    return conn


def _add_match(conn, match_id, minutes_ago):
    insert_match(conn, match_id, "Erangel", "squad", 0, 1800,
                 _iso(minutes_ago), None)
    conn.commit()


def _registry(conn, steam_summary_fn=None):
    reg = EndpointRegistry(
        get_conn=lambda: conn,
        my_account_id="account.A",
        platform="steam",
        cache=TTLCache(ttl_secs=30),
        client=MagicMock(),
        poller_status=lambda: {"polling": "ok"},
        tenant_id=1,
        steam_summary_fn=steam_summary_fn,
    )
    # In Tests nutzen wir sqlite3 direkt. SqliteCompatConn wuerde ? -> %s
    # umschreiben und sqlite3 kaputt machen. Daher get_conn ueberschreiben
    # sodass _active das Raw-sqlite3-Conn (mit row_factory=sqlite3.Row) bekommt.
    reg.get_conn = lambda: conn
    return reg


def _call(reg, query=""):
    path = "/api/pubg/active" + (("?" + query) if query else "")
    body, code, _ = reg.dispatch("GET", path, b"", {})
    assert code == 200
    return json.loads(body)


def test_active_is_pubg_open_independent_of_match(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)
    reg = _registry(conn, steam_summary_fn=lambda: {"gameid": str(PUBG)})
    out = _call(reg)
    assert out["active"] is True              # PUBG laeuft laut Steam
    assert out["pubgOpen"] is True            # Alias == active
    assert out["matchRecent"] is True
    assert out["steamChecked"] is True


def test_active_stays_true_even_without_recent_match(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m_old", 120)
    reg = _registry(conn, steam_summary_fn=lambda: {"gameid": str(PUBG)})
    out = _call(reg)
    assert out["active"] is True              # PUBG laeuft -> active, egal wie alt das Match
    assert out["matchRecent"] is False        # letztes Match > 30 min


def test_pubg_closed_is_inactive_but_match_recent_still_computed(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)  # frischer Match, aber PUBG zu
    reg = _registry(conn, steam_summary_fn=lambda: {"gameid": "730"})  # CS, nicht PUBG
    out = _call(reg)
    assert out["active"] is False             # PUBG laeuft nicht
    assert out["matchRecent"] is True         # wird jetzt IMMER berechnet
    assert out["lastMatchAt"] is not None     # kein Kurzschluss mehr


def test_steam_unavailable_active_is_null(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)

    def boom():
        raise RuntimeError("steam down")

    reg = _registry(conn, steam_summary_fn=boom)
    out = _call(reg)
    assert out["active"] is None              # Steam unbestimmbar -> null
    assert out["pubgOpen"] is None
    assert out["matchRecent"] is True         # unabhaengig weiter berechnet
    assert out["steamChecked"] is False


def test_no_steam_fn_active_is_null(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)
    reg = _registry(conn, steam_summary_fn=None)
    out = _call(reg)
    assert out["active"] is None
    assert out["matchRecent"] is True
    assert out["steamChecked"] is False


def test_no_steam_query_override_active_is_null(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)
    called = {"n": 0}

    def fn():
        called["n"] += 1
        return {"gameid": "730"}

    reg = _registry(conn, steam_summary_fn=fn)
    out = _call(reg, "noSteam=1")
    assert called["n"] == 0                    # Steam nicht abgefragt
    assert out["active"] is None               # unbestimmbar -> null
    assert out["matchRecent"] is True          # weiter berechnet


def test_fake_pubg_open_override(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)
    out = _call(_registry(conn, steam_summary_fn=None), "fakePubgOpen=1")
    assert out["pubgOpen"] is True and out["active"] is True
    out = _call(_registry(conn, steam_summary_fn=None), "fakePubgOpen=0")
    assert out["pubgOpen"] is False and out["active"] is False


def test_threshold_override(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 20)  # 20 min alt
    reg = _registry(conn, steam_summary_fn=lambda: {"gameid": str(PUBG)})
    assert _call(reg, "thresholdMin=30")["matchRecent"] is True
    assert _call(reg, "thresholdMin=10")["matchRecent"] is False
