from datetime import datetime, timezone

from fx import track_ads as ta

NOW = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)


def _ev(i, when="2026-11-28T10:00:00Z", **kw):
    e = {"id": "evt_%016x" % i, "name": "Event %d" % i, "date_time": when, "location": "Theater am Park, 12683 Berlin",
         "category": "theater", "hero_url": "https://app.myentry.info/events/evt_%016x/hero.webp?v=1" % i}
    e.update(kw)
    return e


def _reset():
    ta._pool.update(at=0.0, items=[])


def test_refresh_filters_and_dedupes():
    _reset()
    rows = [_ev(1), _ev(1), _ev(2, when="2026-11-01T10:00:00Z"), _ev(3, hero_url="https://evil.example/x.webp"),
            _ev(4, id="../etc"), _ev(5)]
    assert ta.refresh(lambda url: rows, now=NOW) == 2
    ids = sorted(e["id"] for e in ta._pool["items"])
    assert ids == ["evt_%016x" % 1, "evt_%016x" % 5]
    assert ta._pool["items"][0]["city"] == "Berlin"


def test_pick_hides_hero_and_gives_image_path():
    _reset()
    ta.refresh(lambda url: [_ev(i) for i in range(1, 30)], now=NOW)
    ta._pool["at"] = 1e18
    out = ta.pick(8)
    assert len(out) == 8 and len({e["id"] for e in out}) == 8
    assert all("hero" not in e and e["img"] == "api/fx/track-ads/" + e["id"] + ".webp" for e in out)


def test_fetch_error_keeps_old_pool():
    _reset()
    ta.refresh(lambda url: [_ev(1)], now=NOW)

    def boom(url):
        raise OSError("down")
    assert ta.refresh(boom, now=NOW) == 0
    assert len(ta._pool["items"]) == 1


def test_image_only_for_pool_ids(tmp_path):
    _reset()
    ta.refresh(lambda url: [_ev(7)], now=NOW)
    eid = "evt_%016x" % 7
    assert ta.image(str(tmp_path), "evt_ffffffffffffffff", download=lambda u: b"X") is None   # nicht im Vorrat
    assert ta.image(str(tmp_path), "../../x", download=lambda u: b"X") is None
    p = ta.image(str(tmp_path), eid, download=lambda u: b"RIFF")
    assert p and open(p, "rb").read() == b"RIFF"
    assert ta.image(str(tmp_path), eid, download=lambda u: 1 / 0) == p   # aus dem Zwischenspeicher
