"""Gummienten-Outfit je Zuschauer (!outfit <name> im Chat).

Je Tenant eine Datei data/duck-viewers-<tenant>.json: {login: {"o": outfit, "n": Anzeigename, "t": Zeit}}.
Die Effekte bekommen die Zuordnung über /s/<token>/api/fx/ducks/custom.js (RubberDuck.setViewers)
und ziehen jeder genannten Ente ihr Outfit an (Messer-Ente, Gericht, Versammlung, Regen,
Begrüßungs-Ente).

Welche Outfits es gibt, steht in js/rubber-duck.js (OUTFITS) und js/rubber-duck-outfits.js
(RD.addOutfits) — hier nur ausgelesen, damit die Liste nicht doppelt gepflegt wird; dazu
die selbst gebauten aus dem Duck-Editor (fx/duck_outfits.py) und deutsche Namen (DE).
"""
import difflib
import json
import os
import re
import tempfile
import threading
import time

from fx import duck_outfits

MAX_VIEWERS = 5000
LOGIN_RE = re.compile(r"^[a-z0-9_]{1,25}$")
_DEF_RE = re.compile(r"^\s+'?([a-z][a-z0-9_-]*)'?: \{ label: '([^']*)'", re.M)

# deutsche Namen (Chat ist deutsch); mehrere je Outfit erlaubt
DE = {
    "none": ["Normal", "Ohne", "Gelb"], "thw": ["Technisches Hilfswerk"], "police": ["Polizei", "Polizist"],
    "fire": ["Feuerwehr", "Feuerwehrmann"], "captain": ["Captain"], "flash": ["Flash"], "wonder": ["Wonderwoman"],
    "panther": ["Black Panther"], "vampire": ["Vampir"], "witch": ["Hexe"], "mummy": ["Mumie"],
    "skeleton": ["Skelett"], "pumpkin": ["Kürbis", "Kürbiskopf"], "ghost": ["Geist", "Gespenst"],
    "devil": ["Teufel"], "werewolf": ["Werwolf"], "reaper": ["Sensenmann", "Tod"], "cyclops": ["Zyklop"],
    "executioner": ["Henker"], "pirate": ["Pirat"], "chef": ["Koch"], "astronaut": ["Raumfahrer"],
    "knight": ["Ritter"], "viking": ["Wikinger"], "king": ["König"], "prisoner": ["Gefangener", "Häftling", "Sträfling"],
    "doctor": ["Arzt", "Doktor"], "judge": ["Richter"], "santa": ["Weihnachtsmann", "Nikolaus"],
    "bavarian": ["Bayer", "Lederhose"], "football": ["Fußballfan", "Fußball"], "bee": ["Biene"],
    "unicorn": ["Einhorn"], "angel": ["Engel"], "wizard": ["Zauberer"], "racer": ["Rennfahrer"],
    "cupid": ["Amor"], "muscle": ["Mucki", "Muckiente", "Muskelente"], "fat": ["Fett", "Fette Ente", "Dick"],
    "lingerie": ["Dessous", "Spitze", "Spitzendessous"], "butler": ["Diener"], "streamer": ["Streamer"],
    "industrial": ["Industrial", "Cybergoth", "Gasmaske"], "gothreaper": ["Gothic Sensenmann", "Goth Reaper", "Gothic Tod"],
    "victorian": ["Viktorianisch", "Gothic Lady", "Zylinder"],
}


def norm(s: str) -> str:
    """Vergleichsform: klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern."""
    s = (s or "").lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return re.sub(r"[^a-z0-9]", "", s)


_cache = {"key": None, "items": None}
_cache_lock = threading.Lock()


def _code_outfits(root: str) -> list:
    """[(key, label)] aus den JS-Dateien, in Reihenfolge der Galerie."""
    out = []
    try:
        with open(os.path.join(root, "js", "rubber-duck.js"), encoding="utf-8") as f:
            src = f.read()
        block = src[src.index("var OUTFITS = {"):]
        out += _DEF_RE.findall(block[:block.index("\n  };")])
    except (OSError, ValueError):
        pass
    try:
        with open(os.path.join(root, "js", "rubber-duck-outfits.js"), encoding="utf-8") as f:
            src = f.read()
        block = src[src.index("RD.addOutfits({"):]
        out += _DEF_RE.findall(block[:block.index("\n  });")])
    except (OSError, ValueError):
        pass
    return out


def catalog(root: str) -> list:
    """Alle wählbaren Outfits [{key, label, names}] (names = Vergleichsformen), mit Cache je Datei-Stand."""
    files = [os.path.join(root, "js", "rubber-duck.js"), os.path.join(root, "js", "rubber-duck-outfits.js"),
             duck_outfits.path(root)]
    stamp = tuple(os.path.getmtime(p) if os.path.exists(p) else 0 for p in files)
    with _cache_lock:
        if _cache["key"] == (root, stamp):
            return _cache["items"]
    items, seen = [], {}
    for key, label in _code_outfits(root):
        seen[key] = len(items)
        items.append({"key": key, "label": label})
    for key, d in duck_outfits.load(root).items():
        label = d.get("label") if isinstance(d.get("label"), str) and d.get("label") else key
        if key in seen:
            items[seen[key]]["label"] = label
        else:
            seen[key] = len(items)
            items.append({"key": key, "label": label})
    for it in items:
        names = [it["key"], it["label"]] + DE.get(it["key"], [])
        it["names"] = list(dict.fromkeys(n for n in (norm(x) for x in names) if n))
    with _cache_lock:
        _cache["key"], _cache["items"] = (root, stamp), items
    return items


def resolve(q: str, items: list):
    """(Outfit, []) bei eindeutigem Treffer, sonst (None, Vorschläge)."""
    n = norm(q)
    if not n:
        return None, []
    exact = [it for it in items if n in it["names"]]
    if exact:
        return exact[0], []
    if len(n) >= 3:
        pre = [it for it in items if any(x.startswith(n) for x in it["names"])]
        if len(pre) == 1:
            return pre[0], []
        if pre:
            return None, pre[:4]
        part = [it for it in items if any(n in x for x in it["names"])]
        if len(part) == 1:
            return part[0], []
        if part:
            return None, part[:4]
    by_name = {}
    for it in items:
        for x in it["names"]:
            by_name.setdefault(x, it)
    close = difflib.get_close_matches(n, list(by_name), n=6, cutoff=0.6)
    out = []
    for x in close:
        if by_name[x] not in out:
            out.append(by_name[x])
    return None, out[:4]


# ── Zuordnung Zuschauer → Outfit ──
_lock = threading.Lock()


def login_of(name: str) -> str:
    return (name or "").strip().lstrip("@").lower()


def path(root: str, tenant_id) -> str:
    return os.path.join(root, "data", "duck-viewers-%s.json" % int(tenant_id))


def load(root: str, tenant_id) -> dict:
    try:
        with open(path(root, tenant_id), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    v = data.get("viewers") if isinstance(data, dict) else None
    return v if isinstance(v, dict) else {}


def _write(root: str, tenant_id, viewers: dict) -> None:
    p = path(root, tenant_id)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".duck-viewers-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "viewers": viewers}, f, ensure_ascii=False, indent=0)
        os.replace(tmp, p)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def outfit_of(root: str, tenant_id, name: str):
    v = load(root, tenant_id).get(login_of(name))
    return v.get("o") if isinstance(v, dict) else None


def set_outfit(root: str, tenant_id, name: str, key) -> bool:
    """Outfit setzen (key=None löscht). False bei ungültigem Namen oder voller Liste."""
    login = login_of(name)
    if not LOGIN_RE.match(login):
        return False
    with _lock:
        viewers = load(root, tenant_id)
        if key is None:
            if viewers.pop(login, None) is None:
                return True
        else:
            if login not in viewers and len(viewers) >= MAX_VIEWERS:
                return False
            viewers[login] = {"o": key, "n": (name or "").strip().lstrip("@")[:25], "t": int(time.time())}
        _write(root, tenant_id, viewers)
    return True


def _anywhere(root: str, login: str):
    """Neueste !outfit-Wahl eines Logins über alle Kanäle (Tenants) hinweg."""
    import glob
    best = None
    for f in glob.glob(os.path.join(root, "data", "duck-viewers-*.json")):
        m = re.search(r"duck-viewers-(\d+)\.json$", f)
        if not m:
            continue
        v = load(root, int(m.group(1))).get(login)
        if isinstance(v, dict) and isinstance(v.get("o"), str) and (best is None or (v.get("t") or 0) > (best.get("t") or 0)):
            best = v
    return best["o"] if best else None


def mapping(root: str, tenant_id, owner: str = "") -> dict:
    """{login: outfit} für die Effekte. owner = Kanalinhaber: hat er im eigenen Kanal nichts gewählt,
    gilt seine neueste Wahl aus einem anderen Kanal (z. B. als Zuschauer bei einem anderen Streamer)."""
    m = {k: v["o"] for k, v in load(root, tenant_id).items() if isinstance(v, dict) and isinstance(v.get("o"), str)}
    own = login_of(owner)
    if own and own not in m:
        o = _anywhere(root, own)
        if o:
            m[own] = o
    return m


# ── Chat ──
RANDOM_WORDS = {"random", "zufall", "zufaellig", "reset", "mix", "weg", "keins", "keines"}


def _label(items: list, key: str) -> str:
    for it in items:
        if it["key"] == key:
            return it["label"]
    return key


def command(root: str, tenant_id, user: str, q: str) -> dict:
    """!outfit [<name>|random] → {say, outfit}."""
    items = catalog(root)
    who = (user or "").strip().lstrip("@") or "Du"
    q = (q or "").strip()
    if not q:
        cur = outfit_of(root, tenant_id, user)
        if cur:
            return {"say": "%s watschelt als %s. Ändern mit !outfit <Name>, alle Outfits: !outfits" % (who, _label(items, cur)),
                    "outfit": cur}
        return {"say": "%s hat noch kein Outfit, die Ente kommt zufällig. Aussuchen mit !outfit <Name>, alle Outfits: !outfits" % who,
                "outfit": None}
    if norm(q) in RANDOM_WORDS:
        set_outfit(root, tenant_id, user, None)
        return {"say": "%s nimmt wieder zufällige Outfits." % who, "outfit": None}
    hit, sugg = resolve(q, items)
    if hit:
        if not set_outfit(root, tenant_id, user, hit["key"]):
            return {"say": "Das ging leider nicht, %s." % who, "outfit": None}
        return {"say": "%s watschelt jetzt als %s." % (who, hit["label"]), "outfit": hit["key"]}
    if sugg:
        return {"say": "Kein Outfit „%s“. Meintest du: %s? Alle Outfits: !outfits" % (q[:30], ", ".join(s["label"] for s in sugg)),
                "outfit": None}
    return {"say": "Kein Outfit „%s“. Alle Outfits zeigt !outfits" % q[:30], "outfit": None}


def script(viewers: dict) -> str:
    """JavaScript für /api/fx/ducks/custom.js: Zuordnung an RubberDuck.setViewers."""
    return ("window.RubberDuck && RubberDuck.setViewers && RubberDuck.setViewers("
            + json.dumps(viewers, ensure_ascii=True, separators=(",", ":")).replace("</", "<\\/") + ");\n")
