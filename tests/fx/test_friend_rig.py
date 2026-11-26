"""Friend-Rig-Editor: eigenes Hundemodell prüfen, speichern, löschen, ausliefern."""
import base64
import struct

from fx import friend_rig


def _b(fmt, vals):
    return base64.b64encode(struct.pack("<%d%s" % (len(vals), fmt), *vals)).decode()


def _rig(**over):
    pos = [0, 0, 0, 1, 0, 0, 0, 1, 0]
    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    skin = {"bones": ["pelvis_jnt6_04", "head_jnt40_038"], "pos": _b("f", pos), "idx": _b("I", [0, 1, 2]),
            "col": _b("B", [10] * 9), "j": _b("B", [0, 1, 0, 0] * 3), "w": _b("B", [200, 55, 0, 0] * 3),
            "inv": _b("f", ident * 2)}
    rig = {"skin": skin, "joints": {"pelvis_jnt6_04": [0.01, 0, -0.02]},
           "poses": {"sit": {"head_jnt40_038": [0, 0.1, 0, 0.995]}, "all": {"tail_2": [0, 0, 0.1, 0.995]}}, "ears": 0.8, "tailUp": 0.5, "tailCurl": -0.4}
    rig.update(over)
    return rig


def test_save_load_delete(tmp_path):
    root = str(tmp_path)
    assert friend_rig.load(root) is None
    assert friend_rig.save(root, _rig()) is None
    got = friend_rig.load(root)
    assert got["skin"]["bones"] == ["pelvis_jnt6_04", "head_jnt40_038"]
    assert got["joints"]["pelvis_jnt6_04"] == [0.01, 0, -0.02]
    assert got["poses"]["sit"]["head_jnt40_038"][3] == 0.995
    assert got["poses"]["all"]["tail_2"][2] == 0.1 and got["tailCurl"] == -0.4
    assert friend_rig.delete(root) is True
    assert friend_rig.load(root) is None
    assert friend_rig.delete(root) is False


def test_rig_without_skin_is_fine(tmp_path):
    assert friend_rig.save(str(tmp_path), {"poses": {"beg": {"head_jnt40_038": [0, 0, 0, 1]}}}) is None


def test_moves_per_pose(tmp_path):
    root = str(tmp_path)
    assert friend_rig.save(root, {"moves": {"down": {"pelvis_jnt6_04": [0, -3.5, 0]}}}) is None
    assert friend_rig.load(root)["moves"] == {"down": {"pelvis_jnt6_04": [0, -3.5, 0]}}
    assert friend_rig.save(root, {"moves": {"dance": {}}})
    assert friend_rig.save(root, {"moves": {"down": {"pelvis_jnt6_04": [0, 5000, 0]}}})
    assert friend_rig.save(root, {"moves": {"down": {"pelvis_jnt6_04": [0, 1]}}})


def test_rejects_bad_input(tmp_path):
    root = str(tmp_path)
    sk = _rig()["skin"]
    assert friend_rig.save(root, "x")
    assert friend_rig.save(root, _rig(skin=dict(sk, idx=_b("I", [0, 1, 9]))))          # Index außerhalb
    assert friend_rig.save(root, _rig(skin=dict(sk, j=_b("B", [0, 5, 0, 0] * 3))))     # Knochen außerhalb
    assert friend_rig.save(root, _rig(skin=dict(sk, col=_b("B", [1] * 8))))            # Farbe zu kurz
    assert friend_rig.save(root, _rig(skin=dict(sk, pos=_b("f", [0, float("nan"), 0, 1, 0, 0, 0, 1, 0]))))
    assert friend_rig.save(root, _rig(skin=dict(sk, pos="@@not base64@@")))
    assert friend_rig.save(root, _rig(skin=dict(sk, bones=["../x"])))
    assert friend_rig.save(root, _rig(skin=dict(sk, inv=_b("f", [1] * 16))))          # eine Matrix zu wenig
    assert friend_rig.save(root, _rig(joints={"pelvis_jnt6_04": [0, 0, 5000]}))
    assert friend_rig.save(root, _rig(poses={"dance": {}}))
    assert friend_rig.save(root, _rig(poses={"sit": {"head_jnt40_038": [0, 0, 2, 1]}}))
    assert friend_rig.save(root, _rig(ears=2))
    assert friend_rig.save(root, _rig(tailCurl=3))
    assert friend_rig.load(root) is None


def _fx_client(root, tenant_id=1):
    from flask import Flask, g
    from fx.endpoints import bp_fx
    app = Flask(__name__)
    app.config["_PROJECT_ROOT"] = root
    app.register_blueprint(bp_fx)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app.test_client()


def test_rig_json_endpoint(tmp_path):
    root = str(tmp_path)
    c = _fx_client(root)
    assert c.get("/s/tok/api/fx/friend/rig.json").json == {"rig": None}
    friend_rig.save(root, _rig())
    r = c.get("/s/tok/api/fx/friend/rig.json")
    assert r.json["rig"]["ears"] == 0.8 and "no-store" in r.headers.get("Cache-Control", "")
    assert _fx_client(root, tenant_id=None).get("/s/tok/api/fx/friend/rig.json").status_code == 404
