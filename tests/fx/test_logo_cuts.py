"""Logo-Cut-Editor: Umrisse je Logo-Bild speichern, prüfen, löschen, ausliefern."""
import os

from fx import logo_cuts

SQ = [[0, 0], [10, 0], [10, 10], [0, 10]]


def _assets(root, *names):
    os.makedirs(os.path.join(root, "assets"), exist_ok=True)
    for n in names:
        open(os.path.join(root, "assets", n), "wb").close()


def test_save_load_delete(tmp_path):
    root = str(tmp_path); _assets(root, "logo_text.png")
    assert logo_cuts.save(root, "logo_text.png", [{"poly": SQ, "holes": [[[2, 2], [4, 2], [4, 4]]]}]) is None
    assert logo_cuts.load(root)["logo_text.png"][0]["poly"] == SQ
    assert logo_cuts.delete(root, "logo_text.png") is True
    assert logo_cuts.load(root) == {}
    assert logo_cuts.delete(root, "logo_text.png") is False


def test_rejects_bad_input(tmp_path):
    root = str(tmp_path); _assets(root, "a.png")
    assert logo_cuts.save(root, "../x.png", [{"poly": SQ}])          # Pfad
    assert logo_cuts.save(root, "missing.png", [{"poly": SQ}])       # Datei fehlt
    assert logo_cuts.save(root, "a.png", [])                         # leer
    assert logo_cuts.save(root, "a.png", [{"poly": SQ[:2]}])         # < 3 Punkte
    assert logo_cuts.save(root, "a.png", [{"poly": [[0, 0], [1, "x"], [2, 2]]}])
    assert logo_cuts.save(root, "a.png", [{"poly": [[0, 0], [1, float("nan")], [2, 2]]}])
    assert logo_cuts.save(root, "a.png", [{"poly": SQ}] * (logo_cuts.MAX_PARTS + 1))
    assert logo_cuts.save(root, "a.png", [{"poly": [[i, i % 7] for i in range(logo_cuts.MAX_POINTS + 1)]}])


def test_rounds_coordinates(tmp_path):
    root = str(tmp_path); _assets(root, "a.png")
    assert logo_cuts.save(root, "a.png", [{"poly": [[0.123456, 1], [5, 0], [5, 5]]}]) is None
    assert logo_cuts.load(root)["a.png"][0]["poly"][0] == [0.12, 1]


def test_list_images(tmp_path):
    root = str(tmp_path); _assets(root, "logo_a.png", "b.webp", "c.txt")
    assert logo_cuts.images(root) == ["b.webp", "logo_a.png"]


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


def test_cuts_json_endpoint(tmp_path):
    root = str(tmp_path); _assets(root, "a.png")
    logo_cuts.save(root, "a.png", [{"poly": SQ}])
    r = _fx_client(root).get("/s/t/api/fx/logo/cuts.json")
    assert r.status_code == 200 and r.headers["Cache-Control"] == "no-store"
    assert r.json["cuts"]["a.png"][0]["poly"] == SQ
    assert _fx_client(root, None).get("/s/t/api/fx/logo/cuts.json").status_code == 404
