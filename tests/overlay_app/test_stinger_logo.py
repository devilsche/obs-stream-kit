"""Stinger-Logos: bis zu 10 Bilder je Tenant, im Dashboard hochgeladen."""
from overlay_app import stinger_logo

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


class FakeConn:
    def __init__(self):
        self.s = {}


def _patch(monkeypatch):
    monkeypatch.setattr(stinger_logo, "_get", lambda c, t: c.s.get(t, ""))
    monkeypatch.setattr(stinger_logo, "_put", lambda c, t, raw: c.s.__setitem__(t, raw))


def test_add_list_delete(tmp_path, monkeypatch):
    _patch(monkeypatch)
    c, root = FakeConn(), str(tmp_path)
    assert stinger_logo.load(c, 5) == []
    assert stinger_logo.for_page([], "/s/t/") == []
    e1, err = stinger_logo.add_image(c, root, 5, "Mein Logo.png", PNG)
    assert err is None and e1["ext"] == "png"
    e2, _ = stinger_logo.add_image(c, root, 5, "neu.png", PNG)
    # beide bleiben, in Upload-Reihenfolge
    assert [e["id"] for e in stinger_logo.load(c, 5)] == [e1["id"], e2["id"]]
    assert stinger_logo.for_page(stinger_logo.load(c, 5), "/s/t/") == [
        {"id": e1["id"], "url": "/s/t/stinger-logo/%s.png" % e1["id"]},
        {"id": e2["id"], "url": "/s/t/stinger-logo/%s.png" % e2["id"]}]
    # anderer Tenant sieht nichts
    assert stinger_logo.load(c, 6) == []
    assert stinger_logo.delete(c, root, 5, e1["id"]) is True
    assert stinger_logo.path_of(root, 5, e1["id"] + ".png") is None
    assert [e["id"] for e in stinger_logo.load(c, 5)] == [e2["id"]]
    assert stinger_logo.delete(c, root, 5, "nichtda") is False


def test_max_ten(tmp_path, monkeypatch):
    _patch(monkeypatch)
    c, root = FakeConn(), str(tmp_path)
    for i in range(stinger_logo.MAX_LOGOS):
        assert stinger_logo.add_image(c, root, 5, "l%d.png" % i, PNG)[1] is None
    e, err = stinger_logo.add_image(c, root, 5, "zuviel.png", PNG)
    assert e is None and "10" in err
    assert len(stinger_logo.load(c, 5)) == 10


def test_old_single_entry_still_read(monkeypatch):
    _patch(monkeypatch)
    c = FakeConn()
    c.s[5] = '{"id": "0123456789ab", "ext": "png", "name": "alt.png", "bytes": 3}'
    assert [e["id"] for e in stinger_logo.load(c, 5)] == ["0123456789ab"]


def test_rejects_non_images_and_paths(tmp_path, monkeypatch):
    _patch(monkeypatch)
    c = FakeConn()
    assert stinger_logo.add_image(c, str(tmp_path), 5, "x.svg", b"<svg></svg>")[1]
    assert stinger_logo.add_image(c, str(tmp_path), 5, "x.png", b"")[1]
    assert stinger_logo.path_of(str(tmp_path), 5, "../secrets.png") is None


def test_gif_rejected(tmp_path, monkeypatch):
    _patch(monkeypatch)
    e, err = stinger_logo.add_image(FakeConn(), str(tmp_path), 5, "a.gif", b"GIF89a" + b"\x00" * 20)
    assert e is None and "GIF" in err
