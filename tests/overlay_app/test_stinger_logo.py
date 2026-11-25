"""Stinger-Logo: ein Bild je Tenant, im Dashboard hochgeladen, ersetzt beim Hochladen das alte."""
from overlay_app import stinger_logo

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


class FakeConn:
    def __init__(self):
        self.s = {}


def _patch(monkeypatch):
    monkeypatch.setattr(stinger_logo, "_get", lambda c, t: c.s.get(t, ""))
    monkeypatch.setattr(stinger_logo, "_put", lambda c, t, raw: c.s.__setitem__(t, raw))


def test_upload_replace_delete(tmp_path, monkeypatch):
    _patch(monkeypatch)
    c, root = FakeConn(), str(tmp_path)
    assert stinger_logo.load(c, 5) is None
    assert stinger_logo.for_page(None, "/s/t/") is None
    e1, err = stinger_logo.set_image(c, root, 5, "Mein Logo.png", PNG)
    assert err is None and e1["ext"] == "png"
    e2, _ = stinger_logo.set_image(c, root, 5, "neu.png", PNG)
    # altes Bild ist weg, nur das neue liegt im Ordner
    assert stinger_logo.path_of(root, 5, e1["id"] + ".png") is None
    assert stinger_logo.path_of(root, 5, e2["id"] + ".png")
    assert stinger_logo.for_page(stinger_logo.load(c, 5), "/s/t/") == "/s/t/stinger-logo/%s.png" % e2["id"]
    # anderer Tenant sieht nichts
    assert stinger_logo.load(c, 6) is None
    assert stinger_logo.delete(c, root, 5) is True
    assert stinger_logo.load(c, 5) is None


def test_rejects_non_images_and_paths(tmp_path, monkeypatch):
    _patch(monkeypatch)
    c = FakeConn()
    assert stinger_logo.set_image(c, str(tmp_path), 5, "x.svg", b"<svg></svg>")[1]
    assert stinger_logo.set_image(c, str(tmp_path), 5, "x.png", b"")[1]
    assert stinger_logo.path_of(str(tmp_path), 5, "../secrets.png") is None


def test_gif_rejected(tmp_path, monkeypatch):
    _patch(monkeypatch)
    e, err = stinger_logo.set_image(FakeConn(), str(tmp_path), 5, "a.gif", b"GIF89a" + b"\x00" * 20)
    assert e is None and "GIF" in err
