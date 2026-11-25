"""Friend: nur mit Freischaltung; jeder Alert wird automatisch als Reaktion an den Friend weitergereicht."""
from flask import Flask, g

from fx import commands, endpoints
from fx.endpoints import bp_fx


def _client(root, tenant_id=7):
    app = Flask(__name__)
    app.config["_PROJECT_ROOT"] = root
    app.register_blueprint(bp_fx)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app.test_client()


def test_friend_locked_without_feature(tmp_path, monkeypatch):
    monkeypatch.setattr(endpoints, "_feats", lambda: ["pubg"])
    c = _client(str(tmp_path))
    assert c.get("/s/t/api/fx/friend?cmd=react&event=follow").status_code == 403
    assert c.get("/s/t/api/fx/friend/poll").status_code == 403


def test_alert_is_forwarded_to_friend_only_with_feature(tmp_path, monkeypatch):
    c = _client(str(tmp_path), tenant_id=8)
    monkeypatch.setattr(endpoints, "_feats", lambda: ["pubg"])
    c.get("/s/t/api/fx/alert?cmd=sub&username=Hat3")
    assert c.get("/s/t/api/fx/alert/poll?since=0").get_json()["commands"][-1]["cmd"] == "sub"
    monkeypatch.setattr(endpoints, "_feats", lambda: ["pubg", "friend"])
    before = c.get("/s/t/api/fx/friend/poll").get_json()["seq"]
    c.get("/s/t/api/fx/alert?cmd=raid&username=Hat3&viewers=5")
    got = c.get("/s/t/api/fx/friend/poll?since=%d" % before).get_json()["commands"]
    assert [(x["cmd"], x["params"]) for x in got] == [("react", {"event": "raid"})]


def test_allow_list_normalizes_names():
    from fx import friend_allow
    assert friend_allow.clean("@Hat3, luckor_hd\nHat3  bad name! x" ) == ["hat3", "luckor_hd", "bad", "x"]


def test_chat_commands_only_for_allowed_users(tmp_path, monkeypatch):
    from fx import friend_allow
    monkeypatch.setattr(endpoints, "_feats", lambda: ["friend"])
    monkeypatch.setattr(endpoints, "_friend_allowed", lambda: (["hat3"], "luckor_hd"))
    c = _client(str(tmp_path), tenant_id=9)
    before = c.get("/s/t/api/fx/friend/poll").get_json()["seq"]
    # nicht auf der Liste: stumm ignoriert (200, kein Befehl)
    r = c.get("/s/t/api/fx/friend?cmd=act&action=bark&user=Stranger").get_json()
    assert r["ok"] is False and r["denied"] is True
    # auf der Liste (Groß-/Kleinschreibung egal), Kanalinhaber immer, ohne user (Dashboard-Test) auch
    assert c.get("/s/t/api/fx/friend?cmd=act&action=bark&user=HAT3").get_json()["ok"] is True
    assert c.get("/s/t/api/fx/friend?cmd=act&action=sit&user=LuCKoR_HD").get_json()["ok"] is True
    assert c.get("/s/t/api/fx/friend?cmd=act&action=paw").get_json()["ok"] is True
    got = c.get("/s/t/api/fx/friend/poll?since=%d" % before).get_json()["commands"]
    assert [x["params"]["action"] for x in got] == ["bark", "sit", "paw"]
    assert friend_allow.allowed(["hat3"], "luckor_hd", "") is True
