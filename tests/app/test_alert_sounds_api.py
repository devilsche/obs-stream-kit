"""Dashboard: Alert-Töne hochladen, listen, Lautstärke, löschen – nur eigene, nur per fetch."""
import io

from app import create_app


def _mp3(frames):
    return (b"\xff\xfb\x90\x00" + b"\x00" * 413) * frames


def _client(conn, sid, root):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.config["_PROJECT_ROOT"] = str(root)
    c = app.test_client()
    c.set_cookie("obskit_sid", sid, domain="localhost")
    return c


def test_upload_list_volume_delete(pg_conn_test_setup_non_admin, tmp_path):
    conn, tid, _, sid = pg_conn_test_setup_non_admin
    c = _client(conn, sid, tmp_path)
    H = {"X-Requested-With": "fetch"}
    # ohne fetch-Header abgelehnt (fremdes Formular)
    r = c.post("/app/api/alert-sounds/follow", data={"sound": (io.BytesIO(_mp3(100)), "a.mp3")})
    assert r.status_code == 400
    r = c.post("/app/api/alert-sounds/follow", headers=H, data={"sound": (io.BytesIO(_mp3(100)), "Fanfare.mp3")})
    assert r.status_code == 200 and r.get_json()["file"]["name"] == "Fanfare.mp3"
    fid = r.get_json()["file"]["id"]
    r = c.post("/app/api/alert-sounds/follow", headers=H, data={"sound": (io.BytesIO(b"x" * 999), "b.mp3")})
    assert r.status_code == 400 and "MP3" in r.get_json()["error"]
    lst = c.get("/app/api/alert-sounds").get_json()
    assert [f["id"] for f in lst["alerts"]["follow"]["files"]] == [fid] and lst["maxFiles"] == 3
    assert c.get(f"/app/api/alert-sounds/follow/{fid}.mp3").status_code == 200
    assert c.post("/app/api/alert-sounds/follow/volume", json={"volume": 0.4}, headers=H).get_json()["ok"]
    assert c.get("/app/api/alert-sounds").get_json()["alerts"]["follow"]["volume"] == 0.4
    assert c.delete(f"/app/api/alert-sounds/follow/{fid}").status_code == 400            # ohne Header
    assert c.delete(f"/app/api/alert-sounds/follow/{fid}", headers=H).get_json()["ok"]
    assert c.get(f"/app/api/alert-sounds/follow/{fid}.mp3").status_code == 404
    assert (tmp_path / "data" / "alert-sounds" / str(tid) / "follow").is_dir()
