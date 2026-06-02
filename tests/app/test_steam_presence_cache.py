from app.views_api import _tenant_steam_summary, _steam_presence_cache


class _FakeSteam:
    def __init__(self):
        self.calls = 0

    def get_player_summaries(self):
        self.calls += 1
        return {"gameid": "578080", "personaname": "x"}


def test_cache_collapses_rapid_calls():
    _steam_presence_cache.clear()
    steam = _FakeSteam()
    a = _tenant_steam_summary(42, steam)
    b = _tenant_steam_summary(42, steam)
    assert a == b == {"gameid": "578080", "personaname": "x"}
    assert steam.calls == 1                 # zweiter Call aus Cache


def test_cache_is_per_tenant():
    _steam_presence_cache.clear()
    s1, s2 = _FakeSteam(), _FakeSteam()
    _tenant_steam_summary(1, s1)
    _tenant_steam_summary(2, s2)
    assert s1.calls == 1 and s2.calls == 1   # getrennte Tenants -> getrennt
