"""Dashboard: Friend-Erlaubnisliste speichern/lesen – nur per fetch, Namen bereinigt; der Chat-Befehl prüft sie."""
from app import create_app
from fx import friend_allow


def _client(conn, sid, root):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.config["_PROJECT_ROOT"] = str(root)
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_save_and_load(pg_conn_test_setup_non_admin, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    c = _client(conn, sid, tmp_path)
    assert c.get("/app/api/friend-allow").get_json()["names"] == []
    assert c.post("/app/api/friend-allow", json={"names": "Hat3"}).status_code == 400   # ohne fetch-Header
    r = c.post("/app/api/friend-allow", json={"names": "@Hat3, Moonwave_xD\nhat3"}, headers={"X-Requested-With": "fetch"})
    assert r.get_json()["names"] == ["hat3", "moonwave_xd"]
    assert c.get("/app/api/friend-allow").get_json()["names"] == ["hat3", "moonwave_xd"]
    assert friend_allow.load(conn, tid) == ["hat3", "moonwave_xd"]


def test_pet_media_api(pg_conn_test_setup_non_admin, tmp_path):
    import io
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    c = _client(conn, sid, tmp_path)
    H = {"X-Requested-With": "fetch"}
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    mp3 = (b"\xff\xfb\x90\x00" + b"\x00" * 413) * 40
    assert c.post("/app/api/pet-media/image", data={"file": (io.BytesIO(png), "a.png")}).status_code == 400   # ohne Header
    img = c.post("/app/api/pet-media/image", headers=H, data={"file": (io.BytesIO(png), "Luke.png")}).get_json()["file"]
    snd = c.post("/app/api/pet-media/sound", headers=H, data={"file": (io.BytesIO(mp3), "wuff.mp3")}).get_json()["file"]
    assert c.post("/app/api/pet-media/volume", headers=H, json={"volume": 0.3}).get_json()["ok"]
    d = c.get("/app/api/pet-media").get_json()
    assert d["img"]["id"] == img["id"] and [s["id"] for s in d["sounds"]] == [snd["id"]] and d["volume"] == 0.3
    assert c.get("/app/api/pet-media/file/%s.png" % img["id"]).status_code == 200
    assert c.delete("/app/api/pet-media/" + snd["id"], headers=H).get_json()["ok"]
    assert c.get("/app/api/pet-media").get_json()["sounds"] == []


def test_stinger_logo_api(pg_conn_test_setup_non_admin, tmp_path):
    import io
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    c = _client(conn, sid, tmp_path)
    H = {"X-Requested-With": "fetch"}
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    assert c.get("/app/api/stinger-logo").get_json()["logos"] == []
    assert c.post("/app/api/stinger-logo", data={"file": (io.BytesIO(png), "a.png")}).status_code == 400   # ohne Header
    e1 = c.post("/app/api/stinger-logo", headers=H, data={"file": (io.BytesIO(png), "Logo.png")}).get_json()["logo"]
    e2 = c.post("/app/api/stinger-logo", headers=H, data={"file": (io.BytesIO(png), "Zwei.png")}).get_json()["logo"]
    d = c.get("/app/api/stinger-logo").get_json()
    assert [e["id"] for e in d["logos"]] == [e1["id"], e2["id"]] and d["max"] == 10
    assert c.get("/app/api/stinger-logo/file/%s.png" % e1["id"]).status_code == 200
    assert c.delete("/app/api/stinger-logo?id=" + e1["id"], headers=H).get_json()["ok"]
    assert c.delete("/app/api/stinger-logo?id=" + e1["id"], headers=H).status_code == 404
    assert [e["id"] for e in c.get("/app/api/stinger-logo").get_json()["logos"]] == [e2["id"]]
