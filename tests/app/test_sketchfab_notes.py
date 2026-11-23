from app import sketchfab_notes as sn

UID = "0123456789abcdef0123456789abcdef"


def test_parse_urls_multi_dedupe_and_uid():
    t = ("https://sketchfab.com/3d-models/old-car-%s\n"
         "https://sketchfab.com/3d-models/old-car-%s, https://example.com/x." % (UID, UID))
    urls = sn.parse_urls(t)
    assert urls == ["https://sketchfab.com/3d-models/old-car-" + UID, "https://example.com/x"]
    assert sn.uid_of(urls[0]) == UID and sn.uid_of(urls[1]) is None


def test_add_update_delete(tmp_path):
    root = str(tmp_path)
    assert sn.add(root, "no links here", "x") == (None, "Add at least one URL.")
    e, err = sn.add(root, "https://sketchfab.com/3d-models/a-" + UID, "  car for the race  ")
    assert err is None and e["note"] == "car for the race" and e["uids"] == [UID] and not e["done"]
    e2, _ = sn.add(root, "https://sketchfab.com/a https://sketchfab.com/b", "")
    assert [x["id"] for x in sn.load(root)] == [e2["id"], e["id"]]
    assert sn.update(root, e["id"], done=True) and sn.load(root)[1]["done"]
    assert sn.update(root, e["id"], urls_text="", note="props")
    assert sn.load(root)[1]["urls"] == e["urls"] and sn.load(root)[1]["note"] == "props"
    assert sn.delete(root, e2["id"]) and not sn.delete(root, e2["id"])
    assert len(sn.load(root)) == 1 and not sn.update(root, "nope", done=True)
