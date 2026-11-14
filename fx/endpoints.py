"""/s/<token>/api/fx/<effekt> — Befehle fuer Effect-Overlays.

GET (oder POST mit JSON) mit ?cmd=... legt einen Befehl ab — GET, damit
Streamer.bot die einfache "Fetch URL"-Sub-Action nutzen kann.
.../poll?since=<seq> liefert die Befehle danach.

Effekte mit dauerhafter Sammlung (xmas: Kugeln, Geschenke; autumn: Kürbisse,
Laub; winter/spring/summer: fx/season_db.py) schreiben den Befehl zusätzlich
in die DB; der erste Poll ohne `since` liefert sie als `state` mit.
"""
import functools
import logging
import sqlite3
import time

from flask import Blueprint, Response, current_app, g, jsonify, abort, request

from core.db_compat import SqliteCompatConn
import datetime

from fx import (autumn_db, commands, duck_outfits, season_db, weather, weather_chat, weather_credit, weather_db, weather_followers, weather_frost,
                weather_season, weather_snow, weather_state, weather_theme, xmas_db)
from webcore.middleware import _get_conn

log = logging.getLogger(__name__)

bp_fx = Blueprint("fx", __name__)

# effect → (persist(conn, tenant, cmd) -> bool, load_state(conn, tenant) -> dict)
_PERSISTENT = {
    "xmas": (xmas_db.persist, xmas_db.load_state),
    "autumn": (autumn_db.persist, autumn_db.load_state),
}


# Wer zuletzt Wetter bzw. Tageszeit bestellt hat (für !weather und das Dock), je Tenant
# {"weather"|"tod": {"kind", "by", "until"}}; nur im Speicher, gilt ohnehin nur Minuten
ORDERS = {}


def _remember_order(tenant_id, slot, p, now):
    hold = p.get("hold")
    ORDERS.setdefault(tenant_id, {})[slot] = {"kind": p["to"], "by": p.get("name") or "",
                                              "until": now + hold if hold else None}


def _weather_persist(conn, tenant_id, cmd):
    """Übersteuerung speichern; der Befehl geht trotzdem in die Warteschlange,
    damit das Overlay den Zustand sofort neu holt."""
    if cmd["cmd"] == "weather":
        _remember_order(tenant_id, "tod" if cmd["params"]["to"] in weather_theme.TIMES_OF_DAY else "weather",
                        cmd["params"], time.time())
    elif cmd["cmd"] == "auto":
        ORDERS.pop(tenant_id, None)
    if cmd["cmd"] == "weather" and cmd["params"]["to"] in weather_theme.TIMES_OF_DAY:
        # Nacht/Dämmerung ist Tageszeit, nicht Wetter: bleibt beim nächsten Wetterwechsel
        weather_theme.set_tod(conn, tenant_id, cmd["params"]["to"], cmd["params"]["hold"], time.time())
    elif cmd["cmd"] == "weather":
        # mit dem laufenden (oder wartenden) bestellten Wetter mischen, z. B. Regen + Nebel
        now = time.time()
        cur = weather_db.current_override(conn, tenant_id, now)
        base = ((cur or {}).get("pending") or {}).get("kind") or (cur or {}).get("kind")
        weather_db.set_override(conn, tenant_id, weather.combine(base, cmd["params"]["to"]),
                                cmd["params"]["hold"], now)
    elif cmd["cmd"] == "auto":
        weather_db.clear_override(conn, tenant_id)
        weather_theme.clear_tod(conn, tenant_id)
    elif cmd["cmd"] in ("scrape", "warm"):
        # Ergebnis mitschicken, damit das Overlay passend animiert
        cmd["params"].update(weather_frost.use(conn, tenant_id, cmd["cmd"],
                                               cmd["params"].get("name", ""), time.time()))
    elif cmd["cmd"] == "frostclear":
        weather_frost.clear(conn, tenant_id, time.time())
    elif cmd["cmd"] == "frostreset":
        weather_frost.reset_leaders(conn, tenant_id)
    elif cmd["cmd"] == "spectacle" and cmd["params"].get("type") == "avalanche":
        # die Lawine bleibt als Schnee liegen (sichtbar im Winter-Thema)
        weather_snow.drift(conn, tenant_id, AVALANCHE_SNOW, time.time())
    else:
        return _winter_persist(conn, tenant_id, cmd)
    return True


AVALANCHE_SNOW = 20


def _winter_persist(conn, tenant_id, cmd):
    """Winter-Thema: Kugeln/Geschenke (xmas_db), Mini-Schneemänner und
    Schneemann (season_db, effect winter), Schneedecke und Xmas-Ablauf."""
    c, p, now = cmd["cmd"], cmd["params"], time.time()
    today = datetime.date.today()
    if c in ("follow", "ornament", "mini", "pumpkin", "flower", "castle"):
        # gemeinsame Follower-Liste: jeder Follower erscheint in jeder Jahreszeit
        # in deren Gestalt; das Overlay führt alle Themen nach
        cmd["cmd"] = "follow"
        return weather_followers.add(conn, tenant_id, p.get("name", ""))
    if c == "gift":
        xmas_db.add_gift(conn, tenant_id, p.get("name", ""), p["type"], p["amount"])
    elif c == "build":
        season_db.add_event(conn, tenant_id, "winter", "build", p.get("name", ""))
    elif c == "snowmanreset":
        season_db.add_event(conn, tenant_id, "winter", "smreset")
    elif c == "shovel":
        p.update(weather_snow.shovel(conn, tenant_id, p.get("name", ""), now))
    elif c == "icicle":
        p.update(weather_snow.icicle(conn, tenant_id, p.get("name", ""), now))
    elif c == "shake":
        p.update(weather_snow.shake(conn, tenant_id, p.get("name", ""), now,
                                    need=5, win=20, force=bool(p.get("force"))))
    elif c in ("setup", "farewell"):
        weather_theme.mark(conn, tenant_id, today, {}, c)
    elif c == "season":
        weather_theme.early_start(conn, tenant_id, today, p.get("to", "auto"),
                                  zone=weather_theme.load_zone(conn, tenant_id))
    elif c == "xmasdone":
        if p.get("step"):
            weather_theme.mark(conn, tenant_id, today, {}, p["step"])
        return False
    elif c == "ignite":
        # vom Overlay gemeldet (Blitz ins Laub); spielt dort schon, nicht verteilen
        weather_season.ignite(conn, tenant_id, now, wet=bool(p.get("wet")))
        return False
    elif c in weather_season.THEME_OF:
        names = weather_followers.load(conn, tenant_id, limit=FLOWERS_SHOWN)["names"] if c in ("water", "sprinkler") else None
        p.update(weather_season.use(conn, tenant_id, c, p.get("name", ""), now, force=bool(p.get("force")),
                                    flowers=names))
    elif c == "clear" and p.get("kind") in ("followers", "ornaments", "minis", "pumpkins", "flowers", "castles"):
        weather_followers.clear(conn, tenant_id)
    elif c == "clear" and p.get("kind") in ("leaves", "garden", "heat"):
        weather_season.clear(conn, tenant_id, now, p["kind"])
    elif c == "clear":
        kind = p.get("kind")
        if kind == "gifts":
            xmas_db.clear(conn, tenant_id, kind)
        elif kind == "snowman":
            season_db.clear(conn, tenant_id, "winter", "snowman")
        elif kind == "snow":
            weather_snow.clear(conn, tenant_id, now)
    return True


FLOWERS_SHOWN = 24   # so viele neueste Follower stehen im Frühling als Blume


def _project_stage(conn, tenant_id) -> int:
    """Stufe des gemeinsamen Sub-Projekts: Subs seit dem letzten Reset, max 8."""
    stage = 0
    for e in season_db.load_state(conn, tenant_id, "winter")["events"]:
        if e["k"] == "build":
            stage = min(8, stage + 1)
        elif e["k"] == "smreset":
            stage = 0
    return stage


def _weather_state(conn, tenant_id):
    """Deko-Stand fürs Winter-Thema beim ersten Poll: Kugeln, Geschenke,
    Mini-Schneemänner, Schneemann-Stufe (Subs seit dem letzten Reset, max 8)."""
    x = xmas_db.load_state(conn, tenant_id)
    stage = _project_stage(conn, tenant_id)
    # gemeinsame Follower-Liste, je Gestalt so viele neueste, wie Platz ist
    f = weather_followers.load(conn, tenant_id, limit=60)
    names, total = f["names"], f["total"]

    def newest(n):
        return [{"name": nm} for nm in names[-n:]]
    # Blumen mit ihrer Wachstumsstufe (bleibt für immer)
    stages = weather_season.grow_stages(conn, tenant_id)
    flowers = [dict(f, stage=stages[f["name"].lower()]) if f["name"].lower() in stages else f for f in newest(40)]
    return {"followers": names, "follower_total": total,
            "ornaments": newest(60), "ornament_total": total,
            "gifts": x["gifts"], "gift_total": x["gift_total"],
            "minis": newest(30), "mini_total": total,
            "pumpkins": newest(30), "pumpkin_total": total,
            "flowers": flowers, "flower_total": total,
            "castles": newest(24), "castle_total": total,
            # Sub-Projekt aller Jahreszeiten (Schneemann, Vogelscheuche, Sonnenblume, Palast)
            "snowman": stage, "project": stage}


_PERSISTENT["weather"] = (_weather_persist, _weather_state)
for _season in season_db.SPECS:
    _PERSISTENT[_season] = (functools.partial(season_db.persist, _season),
                            lambda conn, tenant_id, _e=_season: season_db.load_state(conn, tenant_id, _e))


def _no_store(resp):
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _channel(conn, tenant_id: int) -> str:
    """Twitch-Kanal des Tenants (Klartext-Spalte), leer wenn unbekannt."""
    try:
        row = conn.execute("SELECT twitch_channel FROM tenant_credentials WHERE tenant_id = ?",
                           (tenant_id,)).fetchone()
    except Exception:
        return ""
    return (row["twitch_channel"] if row else "") or ""


def _whereami(cmd) -> dict:
    """!whereiam: im Bild? Wer nicht im Bild steht, kommt im Overlay kurz vorbei
    (params.visit); der Streamer selbst ist Gastgeber."""
    name = cmd["params"].get("name", "")
    try:
        pos, channel = _with_conn(lambda conn: (
            weather_followers.position(conn, g.tenant_id, name) if name else None, _channel(conn, g.tenant_id)))
    except Exception:
        log.exception("fx weather: follower position failed")
        pos, channel = None, ""
    shown = weather_chat.visible_count(weather_state.LAST_XMAS.get(g.tenant_id, "off"),
                                       weather_state.LAST_THEME.get(g.tenant_id, ""))
    host = bool(name) and bool(channel) and name.lower() == channel.lower()
    visible = pos is not None and pos < shown
    if pos is not None and not visible and not host:
        cmd["params"]["visit"] = True
    theme = weather_state.LAST_THEME.get(g.tenant_id, "")
    stage = 0
    if theme == "spring" and visible:
        try:
            stage = _with_conn(lambda conn: weather_season.grow_stages(conn, g.tenant_id)).get(name.lower(), 0)
        except Exception:
            log.exception("fx weather: flower stage failed")
    return {"visible": visible, "say": weather_chat.whereami_say(name, pos, shown, host, theme, stage)}


def _with_conn(fn):
    raw = _get_conn()
    conn = raw if isinstance(raw, (sqlite3.Connection, SqliteCompatConn)) else SqliteCompatConn(raw)
    try:
        return fn(conn)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()


@bp_fx.route("/s/<token>/api/fx/<effect>", methods=["GET", "POST"])
def push(token, effect):
    if g.tenant_id is None or effect not in commands.EFFECTS:
        abort(404)
    args = request.args.to_dict()
    if request.method == "POST":
        args.update(request.get_json(silent=True) or {})
    try:
        cmd = commands.parse(effect, args)
    except ValueError as e:
        return _no_store(jsonify({"ok": False, "error": str(e)})), 400
    extra = {}
    if effect == "weather" and cmd["cmd"] == "build":
        # Antwort mit Projektstand, damit Streamer.bot den Fortschritt melden kann
        try:
            before = _with_conn(lambda conn: _project_stage(conn, g.tenant_id))
        except Exception:
            log.exception("fx weather: project stage failed")
            before = None
    if effect == "weather" and cmd["cmd"] == "whereami":
        extra = _whereami(cmd)
    out = _dispatch(effect, cmd)
    if out.get("duplicate"):
        return _no_store(jsonify(out))
    if effect == "weather" and cmd["cmd"] == "build" and before is not None:
        try:
            after = _with_conn(lambda conn: _project_stage(conn, g.tenant_id))
            theme = weather_state.LAST_THEME.get(g.tenant_id, "autumn")
            done = after == weather_chat.PROJECT_PARTS and before < after
            extra = {"project": after, "left": weather_chat.PROJECT_PARTS - after, "completed": done, "theme": theme,
                     "say": weather_chat.project_say(theme, after, cmd["params"].get("name", ""), done)}
        except Exception:
            log.exception("fx weather: project stage failed")
    out.update(extra)
    return _no_store(jsonify(out))



def _dispatch(effect, cmd) -> dict:
    """Befehl dauerhaft ablegen (falls nötig) und an die Source schicken."""
    if effect in _PERSISTENT:
        persist = _PERSISTENT[effect][0]
        try:
            forward = _with_conn(lambda conn: persist(conn, g.tenant_id, cmd))
        except Exception:
            # Ohne DB läuft der Effekt trotzdem live weiter, nur nicht dauerhaft
            log.exception("fx %s: persist failed", effect)
            forward = True
        if not forward:
            return {"ok": True, "duplicate": True}
    return {"ok": True, "seq": commands.push(g.tenant_id, effect, cmd)}


@bp_fx.route("/s/<token>/api/fx/weather/paid")
def weather_paid_route(token):
    """Streamer.bot: Wetter gegen Bits/Spende oder Raid-Begrüßung.
    kind=bits|money|raid, amount, name, msg (Befehl wie !tornado optional).
    → {"ok", "offer", "say"}; say leer = nichts in den Chat."""
    if g.tenant_id is None:
        abort(404)
    kind = (request.args.get("kind") or "").strip().lower()
    amount, name = request.args.get("amount", ""), (request.args.get("name") or "")[:40]
    msg = (request.args.get("msg") or "")[:300]
    if kind == "raid":
        r = weather_chat.raid(amount, name)
    elif kind == "bits":
        r = weather_chat.paid(kind, amount, msg, name)
    elif kind == "money":
        return _no_store(jsonify(_donation(amount, msg, name)))
    else:
        return _no_store(jsonify({"ok": False, "error": "kind must be bits, money or raid"})), 400
    out = {"ok": True, "offer": r["offer"] if r["command"] else None, "say": r["say"]}
    if r["command"]:
        out.update(_order(r["command"], name))
    return _no_store(jsonify(out))


def _order(command, name):
    """Bezahlten Befehl an die Source geben (Wetter mit Besteller)."""
    args = {"cmd": command["cmd"], **command["params"]}
    if command["cmd"] == "weather" and name.strip():
        args["name"] = name
    return _dispatch("weather", commands.parse("weather", args))


def _donation(amount, msg, name):
    """Spende: mit „@name“ in der Nachricht wird der Betrag diesem Zuschauer
    freigegeben, steht dazu ein Befehl drin, wird er gleich eingelöst.
    Ohne „@name“ (oder unter 1 €) passiert nichts, freigeben dann von Hand."""
    d = weather_chat.donation(amount, msg, name)
    out = {"ok": True, "offer": None, "say": "", "to": d["to"], "points": d["pts"]}
    if not d["to"]:
        return out
    def run(conn):
        now = time.time()
        total = weather_credit.grant(conn, g.tenant_id, d["to"], d["pts"], now)
        out["say"] = weather_chat.granted_say(d["to"], total, name.strip())
        if d["offer"]:
            out.update(_redeem(conn, d["to"], d["offer"], now))
        return out
    return _with_conn(run)


def _flag(v):
    return (v or "").strip().lower() in ("true", "1", "3", "4")


def _is_staff(name):
    """Kanal selbst (Name = Twitch-Kanal des Tenants) oder Mod laut Streamer.bot
    (mod=%isModerator%, role=%role% 3/4); unaufgelöste %…%-Variablen zählen nicht."""
    try:
        ch = _with_conn(lambda conn: _channel(conn, g.tenant_id))
    except Exception:
        ch = ""
    if ch and name and name.strip().lstrip("@").lower() == ch.strip().lower():
        return True
    return _flag(request.args.get("mod")) or _flag(request.args.get("role"))


def _redeem(conn, name, offer, now):
    command, tier, _ = weather_chat.OFFERS[offer]
    left = weather_credit.spend(conn, g.tenant_id, name, weather_chat.PRICE[tier], now)
    if left is None:
        have = weather_credit.balance(conn, g.tenant_id, name, now)
        return {"offer": None, "say": weather_chat.no_credit_say(name, offer, have)}
    out = {"offer": offer, "say": weather_chat.redeem_say(name, offer, left), "left": left}
    out.update(_order(command, name))
    return out


@bp_fx.route("/s/<token>/api/fx/weather/grant")
def weather_grant_route(token):
    """Streamer.bot (nur Mods): !grant @name l3 → Freigabe; l0 nimmt sie weg.
    to=@name, level=l0..l5 (oder points=…). → {"ok", "to", "points", "say"}."""
    if g.tenant_id is None:
        abort(404)
    by = request.args.get("by")
    if by is not None and not _is_staff(by):
        return _no_store(jsonify({"ok": False, "say": "Freigeben dürfen nur der Kanal und Mods."})), 403
    to = weather_credit.key(request.args.get("to", ""))
    pts = weather_credit.parse_level(request.args.get("level", ""))
    if pts is None and request.args.get("points"):
        pts = weather_chat.points("bits", request.args.get("points"))
    if not to or pts is None:
        return _no_store(jsonify({"ok": False, "error": "need to=@name and level=l0..l5",
                                  "say": "So geht's: !grant @name l1 (l1 bis l5, l0 nimmt die Freigabe weg)"})), 400
    total = _with_conn(lambda conn: weather_credit.grant(conn, g.tenant_id, to, pts, time.time()))
    return _no_store(jsonify({"ok": True, "to": to, "points": total,
                              "say": weather_chat.granted_say(to, total)}))


@bp_fx.route("/s/<token>/api/fx/weather/redeem")
def weather_redeem_route(token):
    """Streamer.bot: bezahlter Chat-Befehl ohne Bits (!tornado …), name=%user%,
    msg=Befehl. Löst ein, wenn das Guthaben reicht. → {"ok", "offer", "say"}."""
    if g.tenant_id is None:
        abort(404)
    name = (request.args.get("name") or "").strip().lstrip("@")[:40]
    offer = weather_chat.wanted(request.args.get("msg", ""))
    if not name or not offer:
        return _no_store(jsonify({"ok": False, "offer": None, "say": ""})), 400
    out = {"ok": True}
    # Mods und der Kanal selbst lösen kostenlos aus
    if _is_staff(name):
        out.update(offer=offer, say="", free=True)
        out.update(_order(weather_chat.OFFERS[offer][0], name))
        return _no_store(jsonify(out))
    out.update(_with_conn(lambda conn: _redeem(conn, name, offer, time.time())))
    return _no_store(jsonify(out))


@bp_fx.route("/s/<token>/api/fx/weather/credit")
def weather_credit_route(token):
    """!credit: Guthaben eines Zuschauers. → {"ok", "points", "say"}."""
    if g.tenant_id is None:
        abort(404)
    name = (request.args.get("name") or "").strip().lstrip("@")[:40]
    have = _with_conn(lambda conn: weather_credit.balance(conn, g.tenant_id, name, time.time())) if name else 0
    return _no_store(jsonify({"ok": True, "points": have, "say": weather_chat.credit_say(name, have)}))


_INFO_TURN = {}


@bp_fx.route("/s/<token>/api/fx/weather/info")
def weather_info_route(token):
    """Streamer.bot: fertige Chat-Sätze. what=weather|project|top|tip|commands|rotate
    (rotate wechselt Projekt, Rangliste, Tipp); place wie in der Overlay-URL."""
    if g.tenant_id is None:
        abort(404)
    what = (request.args.get("what") or "weather").strip().lower()
    # wie die Source: deren zuletzt gemeldete Einstellungen (Thema, feste Lage, Ort);
    # ein place in der Anfrage zählt nur, wenn die Source keinen kennt
    opts = dict(weather_state.LAST_OPTS.get(g.tenant_id, {}))
    place = (request.args.get("place") or "").strip()
    if place and not opts.get("place"):
        val = commands.EFFECTS["weather"]["settings"]["place"](place)
        if val is not None:
            opts["place"] = val

    def build(conn):
        state = None
        if what == "weather" or g.tenant_id not in weather_state.LAST_THEME:
            state = weather_state.resolve(conn, g.tenant_id, opts)
        theme = weather_state.LAST_THEME.get(g.tenant_id, "autumn")

        def top():
            if theme == "winter":
                return weather_chat.top_say(theme, weather_snow.load(conn, g.tenant_id)["top"])
            return weather_chat.top_say(theme, weather_season.load(conn, g.tenant_id)["top"].get(theme, []))
        now = time.time()
        orders = {k: v for k, v in ORDERS.get(g.tenant_id, {}).items() if v["until"] is None or v["until"] > now}
        says = {"weather": lambda: weather_chat.weather_say(state, opts.get("place", ""), orders, now),
                "project": lambda: weather_chat.project_say(theme, _project_stage(conn, g.tenant_id)),
                "top": top, "tip": lambda: weather_chat.tip_say(theme),
                "commands": lambda: weather_chat.commands_say(theme, weather_frost.load(conn, g.tenant_id)["level"])}
        if what == "rotate":
            order = ("project", "top", "tip")
            turn = _INFO_TURN.get(g.tenant_id, 0)
            for i in range(len(order)):
                key = order[(turn + i) % len(order)]
                text = says[key]()
                if text:
                    _INFO_TURN[g.tenant_id] = turn + i + 1
                    return text
            return ""
        return says[what]() if what in says else ""
    try:
        say = _with_conn(build)
    except Exception:
        log.exception("fx weather: info failed")
        say = ""
    return _no_store(jsonify({"ok": True, "say": say}))


@bp_fx.route("/s/<token>/api/fx/<effect>/poll")
def poll(token, effect):
    if g.tenant_id is None or effect not in commands.EFFECTS:
        abort(404)
    since = request.args.get("since", type=int)
    out = commands.poll(g.tenant_id, effect, since)
    out["now"] = time.time()          # Uhrabgleich für zeitabhängige Effekte (Schneefall)
    out["state"] = {}
    if since is None and effect in _PERSISTENT:
        load = _PERSISTENT[effect][1]
        try:
            out["state"] = _with_conn(lambda conn: load(conn, g.tenant_id))
        except Exception:
            log.exception("fx %s: load_state failed", effect)
    return _no_store(jsonify(out))


@bp_fx.route("/s/<token>/api/fx/weather/state")
def weather_state_route(token):
    """Wirksamer Wetterzustand; Settings wie in der Overlay-URL."""
    if g.tenant_id is None:
        abort(404)
    settings = commands.EFFECTS["weather"]["settings"]
    opts = {}
    for key in ("place", "lock", "mood", "kdlow", "kdhigh", "kdtest", "fallback", "aurorakd",
                "frost", "frostrate", "theme", "xmasfrom", "xmasto", "snowrate", "leafrate"):
        raw = (request.args.get(key) or "").strip()
        if raw:
            val = settings[key](raw)
            if val is not None:
                opts[key] = val
    # live=0: OBS meldet, dass nicht gestreamt wird → Garten & Co. trocknen nicht
    paused = request.args.get("live") == "0"
    state = _with_conn(lambda conn: weather_state.resolve(conn, g.tenant_id, opts, paused=paused))
    weather_state.LAST_OPTS[g.tenant_id] = dict(opts)
    return _no_store(jsonify({"state": state, "now": time.time()}))


@bp_fx.route("/s/<token>/api/fx/ducks/custom.js")
def duck_outfits_js(token):
    """Outfits aus dem Duck-Editor (global) als Script für Regen, Messer-Ente und Tools."""
    if g.tenant_id is None:
        abort(404)
    root = current_app.config.get("_PROJECT_ROOT") or "."
    resp = Response(duck_outfits.script(duck_outfits.load(root)), mimetype="application/javascript")
    return _no_store(resp)
