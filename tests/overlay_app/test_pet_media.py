"""Pet-Stinger: Bild und bis zu 3 Töne im Dashboard hochladen statt Bild-URL; die Seite bekommt sie injiziert."""
from overlay_app import pet_media

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 100


def _mp3(frames):
    return (b"\xff\xfb\x90\x00" + b"\x00" * 413) * frames


class FakeConn:
    pass


def _patch(monkeypatch):
    store = {}
    monkeypatch.setattr(pet_media, "_get", lambda conn, tid: store.get(tid, ""))
    monkeypatch.setattr(pet_media, "_put", lambda conn, tid, raw: store.__setitem__(tid, raw))
    return store


def test_image_replace_and_sounds(tmp_path, monkeypatch):
    _patch(monkeypatch)
    c, root = FakeConn(), str(tmp_path)
    e, err = pet_media.set_image(c, root, 3, "Luke.png", PNG)
    assert err is None and e["ext"] == "png"
    first = pet_media.path_of(root, 3, e["id"] + ".png")
    assert first
    e2, err = pet_media.set_image(c, root, 3, "luke.jpg", JPG)          # ersetzt das alte Bild
    assert e2["ext"] == "jpg" and pet_media.path_of(root, 3, e["id"] + ".png") is None
    assert pet_media.set_image(c, root, 3, "x.txt", b"hello")[1]          # kein Bild → Fehler
    for i in range(3):
        assert pet_media.add_sound(c, root, 3, "s%d.mp3" % i, _mp3(40))[1] is None
    assert "Delete one" in pet_media.add_sound(c, root, 3, "s4.mp3", _mp3(40))[1]
    cfg = pet_media.load(c, 3)
    assert len(cfg["sounds"]) == 3 and cfg["img"]["id"] == e2["id"]
    assert pet_media.delete(c, root, 3, cfg["sounds"][0]["id"])
    out = pet_media.for_page(pet_media.load(c, 3), "/s/tok/")
    assert out["img"] == "/s/tok/pet-media/%s.jpg" % e2["id"] and len(out["sounds"]) == 2 and out["sounds"][0]["dur"] > 0
    assert pet_media.delete(c, root, 3, e2["id"]) and pet_media.for_page(pet_media.load(c, 3), "/s/tok/")["img"] is None


def test_other_tenant_cannot_read(tmp_path, monkeypatch):
    _patch(monkeypatch)
    e, _ = pet_media.set_image(FakeConn(), str(tmp_path), 3, "a.png", PNG)
    assert pet_media.path_of(str(tmp_path), 4, e["id"] + ".png") is None
    assert pet_media.path_of(str(tmp_path), 3, "../3/" + e["id"] + ".png") is None
