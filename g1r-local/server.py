#!/usr/bin/env python3
"""G1R Local Proxy — schlanker Mini-Server für den Prototyp.

Liest die vom UE4SS-Mod (G1RExport) geschriebene g1r-state.json und serviert
sie unter http://localhost:<PORT>/state. CORS + Private-Network-Access-Header
sind gesetzt, damit das OBS-Overlay (von stream-overlay.com, HTTPS) per fetch
auf http://localhost zugreifen darf.

Start:  python3 server.py
Stop:   Strg+C

Läuft komplett lokal — es verlässt nichts den PC.
"""
import collections
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# ── .env laden (optional) ──────────────────────────────────────────────────
# Liest eine .env NEBEN dieser Datei (g1r-local/.env), Format KEY=VALUE pro Zeile
# (# = Kommentar). Echte Umgebungsvariablen haben Vorrang — eine .env überschreibt
# nichts, was schon gesetzt ist. Kein externes Paket nötig (kein python-dotenv).
def _load_dotenv():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


_load_dotenv()

# ── Konfiguration ──────────────────────────────────────────────────────────
PORT = 9210
# MUSS mit OUTPUT_PATH im Lua-Mod (G1RExport/scripts/main.lua) übereinstimmen.
STATE_FILE = os.environ.get("G1R_STATE_FILE", r"C:\obs-g1r\g1r-state.json")
# Älter als das → als "offline" behandeln (Spiel zu / Mod pausiert). Großzügig,
# damit kurzes Alt-Tab/Pausieren das Overlay nicht leert (Widget dimmt statt blank).
STALE_AFTER_S = 60
# Welche Origin darf zugreifen? "*" ist am einfachsten (rein lokal, kein Risiko).
ALLOW_ORIGIN = "*"
# Item-Namen-Übersetzung: Klassenname → {de, en}. Externes File, erweiterbar
# ohne server.py anzufassen. Sprache pro Request via ?lang=de|en (Default de).
ITEM_NAMES_FILE = os.environ.get(
    "G1R_ITEM_NAMES", os.path.join(os.path.dirname(os.path.abspath(__file__)), "item_names.json"))
DEFAULT_LANG = "de"


def _load_item_names():
    try:
        with open(ITEM_NAMES_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


ITEM_NAMES = _load_item_names()


def _load_json_map(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return {k: v for k, v in json.load(fh).items() if not k.startswith("_")}
    except Exception:
        return {}


# Waffen-Schaden aus dem Wiki: Klassenname -> Schaden. Dient dazu, aus dem
# Inventar die staerkste Waffe zu bestimmen (strongest_weapon).
WEAPON_DAMAGE = _load_json_map(os.path.join(os.path.dirname(os.path.abspath(__file__)), "weapon_damage.json"))


def _strongest_by_prefix(items, prefix):
    """Klassenname der Inventar-Waffe mit hoechstem Wiki-Schaden, beschraenkt auf
    Items deren Klassenname mit prefix beginnt (ItMw_ = Nahkampf, ItRw_ = Fernkampf).
    Liefert (name, dmg) oder (None, None)."""
    pre = prefix.lower()
    best, best_dmg = None, -1
    for it in (items or []):
        nm = it.get("name") or ""
        if not nm.lower().startswith(pre):
            continue
        # Echter Mod-Schaden (it.dmg, live aus dem Spiel) bevorzugt, sonst Wiki-Tabelle.
        dmg = it.get("dmg")
        if dmg is None:
            dmg = WEAPON_DAMAGE.get(nm)
        if dmg is not None and dmg > best_dmg:
            best, best_dmg = nm, dmg
    return (best, best_dmg if best is not None else None)


def strongest_melee(items):
    """Staerkste Nahkampfwaffe (ItMw_). (name, dmg) oder (None, None)."""
    return _strongest_by_prefix(items, "ItMw_")


def strongest_ranged(items):
    """Staerkste Fernkampfwaffe (ItRw_: Bogen/Armbrust). (name, dmg) oder (None, None)."""
    return _strongest_by_prefix(items, "ItRw_")


# Zauber-Kreise: Klassenname -> benoetigter Magie-Kreis (1-6). Eine Rune ist
# nutzbar, wenn ihr Kreis <= magicCircle des Spielers. Dient dazu, aus dem
# Inventar den staerksten nutzbaren Zauber zu bestimmen.
SPELL_CIRCLE = _load_json_map(os.path.join(os.path.dirname(os.path.abspath(__file__)), "spell_circle.json"))


def _norm_arcane(name):
    """ItAr_Scroll_FireBall / ItAr_Rune_Fireball -> 'fireball' — macht den Kreis-Lookup
    Rune/Scroll-agnostisch (spell_circle.json listet meist nur die Scroll-Variante,
    der Spieler trägt aber evtl. die Rune desselben Zaubers)."""
    s = re.sub(r"^ItAr_(Scroll|Rune)_", "", name or "", flags=re.IGNORECASE)
    return re.sub(r"[^a-z0-9]", "", s.lower())


def ore_count(items):
    """Summe der Erznuggets (ItMi_Orenugget) im Inventar — die Gothic-Waehrung 'Erz'."""
    total = 0
    for it in (items or []):
        if (it.get("name") or "").lower() == "itmi_orenugget":
            total += it.get("count") or 0
    return total


def strongest_usable_spell(items, magic_circle):
    """Liefert den Klassennamen der nutzbaren Inventar-Rune mit dem hoechsten
    Kreis (<= magicCircle), oder None wenn keine nutzbar ist. Rune/Scroll-agnostisch."""
    try:
        mc = int(magic_circle)
    except (TypeError, ValueError):
        return None
    # Normalisierte Sicht auf SPELL_CIRCLE, damit Rune wie Scroll matcht.
    norm = {_norm_arcane(k): v for k, v in SPELL_CIRCLE.items()}
    best, best_circle = None, 0
    for it in (items or []):
        circ = norm.get(_norm_arcane(it.get("name")))
        if circ is not None and circ <= mc and circ > best_circle:
            best, best_circle = it.get("name"), circ
    return best


# ── Gilde: Rohtag (z.B. "Guild.Guards", "EPlayerGuild::MagesWater") → stabiler
# Key + lokalisierter Name. Substring-tolerant, weil das exakte Tag-Format des
# Engine-Calls noch nicht feststeht. Key steuert im Widget das Wappen-Symbol.
GUILD_NAMES = {
    "guards":      {"de": "Gardist",       "en": "Guard"},
    "fire_mage":   {"de": "Feuermagier",   "en": "Fire Mage"},
    "water_mage":  {"de": "Wassermagier",  "en": "Water Mage"},
    "mercenaries": {"de": "Söldner",       "en": "Mercenary"},
    "templars":    {"de": "Templer",       "en": "Templar"},
    "novices":     {"de": "Novize",        "en": "Novice"},
    "rogues":      {"de": "Bandit",        "en": "Rogue"},
    "shadows":     {"de": "Schatten",      "en": "Shadow"},
}
# Reihenfolge: spezifischere Treffer (mageswater/magesfire) vor generischen (water/fire).
_GUILD_MATCH = [
    ("mageswater", "water_mage"), ("magesfire", "fire_mage"),
    ("guard", "guards"), ("templ", "templars"), ("novice", "novices"),
    ("mercenar", "mercenaries"), ("rogue", "rogues"), ("shadow", "shadows"),
    ("water", "water_mage"), ("fire", "fire_mage"),
]


# Letzter gueltiger Gilden-Key (haelt die Anzeige stabil, wenn GetGuild kurz nichts liefert).
_GUILD_CACHE = {"key": None}


def map_guild(raw):
    """Rohen Gilden-Tag auf einen stabilen Key abbilden. None bei leer/keine Gilde."""
    if not raw:
        return None
    low = re.sub(r"[^a-z]", "", str(raw).lower())
    if not low or "none" in low:
        return None
    for sub, key in _GUILD_MATCH:
        if sub in low:
            return key
    return None


def build_payload(lang):
    """State-Datei lesen und anreichern (Uebersetzungen, staerkste Waffen/Zauber,
    Gilde). Liefert das fertige Dict — gemeinsam fuer /state und /events."""
    try:
        age = time.time() - os.path.getmtime(STATE_FILE)
    except FileNotFoundError:
        return {"ok": False, "reason": "no-file"}
    except OSError as exc:
        return {"ok": False, "reason": f"stat-error: {exc}"}
    if age > STALE_AFTER_S:
        return {"ok": False, "reason": "stale", "ageSec": round(age, 1)}
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:  # JSON halb geschrieben o.ä. → kurz später ok
        return {"ok": False, "reason": f"read-error: {exc}"}

    data["ageSec"] = round(age, 1)
    mc_for_items = (data.get("stats") or {}).get("magicCircle", 0)
    for it in (data.get("items") or []):
        # Mod liefert teils schon lokalisierten Namen (Spielsprache) — nicht antasten.
        if not it.get("display"):
            it["display"] = _translate(it.get("name"), lang)
        # Schaden + Typ pro Item anreichern (Live-CDO geht am Build nicht → aus dem
        # Klassennamen via weapon_damage.json / spell_circle.json). Klassenname = it.name.
        nm = it.get("name") or ""
        low = nm.lower()
        if low.startswith("itmw"):
            it["wType"] = "melee"
            if it.get("dmg") is None and WEAPON_DAMAGE.get(nm) is not None:
                it["dmg"] = WEAPON_DAMAGE[nm]   # Fallback: Mod lieferte keinen Live-Schaden
        elif low.startswith("itrw"):
            it["wType"] = "ranged"
            if it.get("dmg") is None and WEAPON_DAMAGE.get(nm) is not None:
                it["dmg"] = WEAPON_DAMAGE[nm]
        elif low.startswith("itar"):
            it["wType"] = "spell"
            circ = SPELL_CIRCLE.get(nm)
            if circ is None:  # Rune/Scroll-agnostisch
                norm = {_norm_arcane(k): v for k, v in SPELL_CIRCLE.items()}
                circ = norm.get(_norm_arcane(nm))
            if circ is not None:
                it["circle"] = circ
                it["usable"] = circ <= (mc_for_items or 0)
    # Staerkste Waffe getrennt nach Kategorie — Nahkampf/Fernkampf sind nicht
    # vergleichbar (Armbrust 60 vs. Klinge 73), also je eigener Bestwert + Schaden.
    # Die AUSGERUESTETE Waffe (READ_CARRY → data.weapon) steckt NICHT im Beutel-Inventar
    # (sie ist in der Hand), wuerde sonst beim Staerksten fehlen → als Kandidat zumischen.
    weapon_items = list(data.get("items") or [])
    if data.get("weapon"):
        weapon_items.append({"name": data["weapon"]})
    melee, melee_dmg = strongest_melee(weapon_items)
    if melee:
        data["strongestMelee"] = melee
        data["strongestMeleeDisplay"] = _translate(melee, lang)
        data["strongestMeleeDmg"] = melee_dmg
    ranged, ranged_dmg = strongest_ranged(weapon_items)
    if ranged:
        data["strongestRanged"] = ranged
        data["strongestRangedDisplay"] = _translate(ranged, lang)
        data["strongestRangedDmg"] = ranged_dmg
    mc = (data.get("stats") or {}).get("magicCircle", 0)
    # Auch hier die in-Hand-Rune (data.weapon) zumischen — sonst kommt strongestSpell
    # nicht, wenn die Rune gerade in der Hand statt im Beutel ist (wie bei melee/ranged).
    ss = strongest_usable_spell(weapon_items, mc)
    if ss:
        data["strongestSpell"] = ss
        data["strongestSpellDisplay"] = _translate(ss, lang)
        # Zauber haben KEINEN festen Schaden (laden auf etc.) → statt dmg den Magie-Kreis.
        _circ = SPELL_CIRCLE.get(ss)
        if _circ is None:
            _norm = {_norm_arcane(k): v for k, v in SPELL_CIRCLE.items()}
            _circ = _norm.get(_norm_arcane(ss))
        if _circ is not None:
            data["strongestSpellCircle"] = _circ
    # Erz (Erznugget) — Gothic-Waehrung, Summe aus dem Inventar.
    data["ore"] = ore_count(data.get("items"))
    # Gilde: Rohtag -> stabiler Key (steuert Wappen-Symbol) + lokalisierter Name.
    # GetGuild() liefert direkt nach dem Laden (State noch nicht voll) teils nichts →
    # den letzten GUELTIGEN Key cachen, damit die Gilde nicht auf "Adventurer" flackert.
    gk = map_guild(data.get("guild"))
    if gk:
        _GUILD_CACHE["key"] = gk
    else:
        gk = _GUILD_CACHE["key"]
    if gk:
        data["guildKey"] = gk
        data["guildName"] = (GUILD_NAMES.get(gk) or {}).get(lang) or gk
    if data.get("spell"):
        data["spellDisplay"] = _spell_display(data.get("spell"), lang)
    if data.get("weapon"):
        data["weaponDisplay"] = _translate(data["weapon"], lang)
    if data.get("attack"):
        data["attackDisplay"] = _attack_display(data.get("attack"), lang)
    if isinstance(data.get("kills"), dict):
        data["killsDisplay"] = {
            _creature_display(t, lang): n for t, n in data["kills"].items()}
    if isinstance(data.get("killNews"), list):
        verb = "slain" if lang == "en" else "erledigt"
        for ev in data["killNews"]:
            name = _creature_display(ev.get("type"), lang)
            ev["text"] = f"{ev.get('n', 1)}× {name} {verb}"
    steam = os.environ.get("G1R_STEAM_NAME", "")
    if steam:
        data["steamName"] = steam
    data["lang"] = lang
    return data


# Zauber-Namen analog. Schlüssel werden normalisiert (klein, nur a-z0-9), damit
# Schreibweisen/Unterstriche egal sind ('Spell_Fireball' == 'FireBall' == 'fireball').
SPELL_NAMES_FILE = os.environ.get(
    "G1R_SPELL_NAMES", os.path.join(os.path.dirname(os.path.abspath(__file__)), "spell_names.json"))


def _norm_spell(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _load_spell_names():
    try:
        with open(SPELL_NAMES_FILE, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        return {_norm_spell(k): v for k, v in raw.items() if not k.startswith("_")}
    except Exception:
        return {}


SPELL_NAMES = _load_spell_names()


def _prettify(cls_name):
    """Fallback ohne Mapping. G1R nutzt die Original-Gothic-Namen mit zweistelligem
    Kategorie-Praefix: ItFo_ (Food), ItMi_ (Misc/Gold/Erz), ItPo_ (Potion), ItMw_/
    ItRw_ (Nah-/Fernkampfwaffe), ItAr_ (Armor), ItRu_/ItSc_ (Rune/Scroll), ItKe_
    (Key) usw. Praefix raus, Rest lesbar machen: 'ItFo_Carrot' → 'Carrot'."""
    s = re.sub(r"^It[A-Za-z]{2}_", "", cls_name or "")  # Gothic-Kategorie-Praefix
    s = re.sub(r"^Item_?", "", s)                        # generisches Item-Praefix
    s = s.replace("_", " ")
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", s)  # CamelCase trennen
    return s.strip() or (cls_name or "Item")


def _translate(cls_name, lang):
    entry = ITEM_NAMES.get(cls_name)
    if entry:
        return entry.get(lang) or entry.get(DEFAULT_LANG) or entry.get("en") or _prettify(cls_name)
    return _prettify(cls_name)


def _spell_display(tag, lang):
    """Aktiver-Zauber-Tag -> Klarname, z.B. 'SpellCategory.Spell_Fireball' -> 'Feuerball'.
    Teil nach letztem Punkt, 'Spell_'-Praefix weg, normalisiert im spell_names.json
    nachschlagen; fehlt der Eintrag, Name lesbar machen (Fallback)."""
    if not tag:
        return None
    suffix = str(tag).split(".")[-1]
    suffix = re.sub(r"^Spell_", "", suffix, flags=re.IGNORECASE)
    entry = SPELL_NAMES.get(_norm_spell(suffix))
    if entry:
        return entry.get(lang) or entry.get(DEFAULT_LANG) or entry.get("en") or suffix
    last = suffix.replace("_", " ")
    last = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", last)  # CamelCase trennen
    return last.strip() or str(tag)


# Schlagrichtung: Tag-Suffix (z.B. "AttackDirection.Left") -> DE/EN.
_ATTACK_DIR = {
    "left":    {"de": "Schlag links",  "en": "Strike left"},
    "right":   {"de": "Schlag rechts", "en": "Strike right"},
    "forward": {"de": "Stich",         "en": "Thrust"},
    "front":   {"de": "Stich",         "en": "Thrust"},
    "top":     {"de": "Schlag oben",   "en": "Strike top"},
    "up":      {"de": "Schlag oben",   "en": "Strike top"},
    "down":    {"de": "Schlag unten",  "en": "Strike down"},
    "back":    {"de": "Rückhand",      "en": "Backhand"},
}


def _attack_display(tag, lang):
    """Schlagrichtungs-Tag -> Klarname, z.B. 'AttackDirection.Left' -> 'Schlag links'."""
    if not tag:
        return None
    suffix = str(tag).split(".")[-1]
    entry = _ATTACK_DIR.get(_norm_spell(suffix))
    if entry:
        return entry.get(lang) or entry.get(DEFAULT_LANG) or entry.get("en")
    last = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", suffix.replace("_", " "))
    return last.strip() or str(tag)


# Kreatur-Namen (Kill-Map-Keys) -> DE/EN. Keys werden normalisiert gematcht; die
# echten Roh-Keys zeigt das Diagnose-Log im UE4SS.log, dann hier ergaenzen.
_CREATURE = {
    "wolf": {"de": "Wolf", "en": "Wolf"},
    "warg": {"de": "Warg", "en": "Warg"},
    "scavenger": {"de": "Scavenger", "en": "Scavenger"},
    "shadowbeast": {"de": "Schattenläufer", "en": "Shadowbeast"},
    "snapper": {"de": "Schnapper", "en": "Snapper"},
    "lurker": {"de": "Lauerer", "en": "Lurker"},
    "molerat": {"de": "Molerat", "en": "Molerat"},
    "bloodfly": {"de": "Blutfliege", "en": "Bloodfly"},
    "bloodhound": {"de": "Bluthund", "en": "Bloodhound"},
    "minecrawler": {"de": "Minecrawler", "en": "Minecrawler"},
    "crawler": {"de": "Minecrawler", "en": "Minecrawler"},
    "lizard": {"de": "Echse", "en": "Lizard"},
    "firelizard": {"de": "Feuerechse", "en": "Fire Lizard"},
    "razor": {"de": "Scherge", "en": "Razor"},
    "troll": {"de": "Troll", "en": "Troll"},
    "harpy": {"de": "Harpyie", "en": "Harpy"},
    "swampshark": {"de": "Sumpfhai", "en": "Swampshark"},
    "orcdog": {"de": "Orkhund", "en": "Orc Dog"},
    "skeleton": {"de": "Skelett", "en": "Skeleton"},
    "golem": {"de": "Golem", "en": "Golem"},
    "demon": {"de": "Dämon", "en": "Demon"},
    "orc": {"de": "Ork", "en": "Orc"},
}


def _creature_display(name, lang):
    """Kill-Map-Key -> Klarname. Strippt gängige Präfixe, normalisiert, schlägt nach."""
    if not name:
        return None
    base = re.sub(r"^(NPC_|Creature_|Mon_|BP_|Monster_)", "", str(name), flags=re.IGNORECASE)
    entry = _CREATURE.get(_norm_spell(base))
    if entry:
        return entry.get(lang) or entry.get(DEFAULT_LANG) or entry.get("en")
    pretty = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", base.replace("_", " "))
    return pretty.strip() or str(name)


class Forwarder:
    """Puffert Ingest-Pakete und schickt sie an Prod; übersteht Offline-Phasen."""
    def __init__(self, prod_url, token, maxlen=500):
        self.prod_url = prod_url
        self.token = token
        self.buffer = collections.deque(maxlen=maxlen)
        self._seq = 0

    def enqueue(self, snapshot, events, save_key=None):
        self._seq += 1
        self.buffer.append(json.dumps({
            "client_seq": self._seq, "save_key": save_key,
            "snapshot": snapshot, "events": events or [],
        }).encode("utf-8"))

    def flush_once(self, post_fn):
        if not self.buffer:
            return
        body = self.buffer[0]
        headers = {"Content-Type": "application/json", "X-Tenant-Token": self.token}
        try:
            status = post_fn(self.prod_url, headers, body)
        except Exception:
            return  # Netz weg -> beim nächsten Mal erneut
        if status == 200:
            self.buffer.popleft()


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        route = self.path.split("?")[0]
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        lang = (qs.get("lang") or [DEFAULT_LANG])[0]
        if route == "/state":
            self._serve_state(lang)
        elif route == "/events":
            self._serve_events(lang)
        else:
            self.send_response(404)
            self._cors()
            self.end_headers()

    def _serve_state(self, lang):
        # Einmal-Snapshot (Polling-Fallback / Debug). Widgets nutzen /events.
        body = json.dumps(build_payload(lang)).encode("utf-8")
        try:
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionError, OSError):
            return  # Client hat vorher getrennt → nichts zu tun

    def _serve_events(self, lang):
        # Server-Sent Events: das Widget abonniert /events einmalig, der Server
        # pusht den Payload bei jeder Aenderung (kein Netzwerk-Polling mehr).
        # Heartbeat alle 15s haelt die Verbindung wach. ThreadingHTTPServer →
        # ein Thread je Client, ein haengender Stream blockiert die anderen nicht.
        last, last_beat = None, time.time()
        try:
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            while True:
                body = json.dumps(build_payload(lang))
                now = time.time()
                if body != last or (now - last_beat) >= 15:
                    self.wfile.write(("data: " + body + "\n\n").encode("utf-8"))
                    self.wfile.flush()
                    last, last_beat = body, now
                time.sleep(0.25)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return  # Client (OBS-Quelle/Tab) geschlossen → Thread sauber beenden

    def log_message(self, *args):
        pass  # leise


# ── Prod-Forwarding (optional) ───────────────────────────────────────────────
# Versendet die Daten zusätzlich an die Prod-DB-API. Aktiv NUR wenn G1R_INGEST_URL
# gesetzt ist (volle Token-URL, z.B. https://stream-overlay.com/s/<token>/api/g1r/ingest).
# Ohne die Env-Var bleibt der Proxy reiner Lokal-Server wie bisher.
_SNAPSHOT_MAP = {
    "level": ("stats", "level"), "xp": ("stats", "xp"),
    "hp": ("stats", "hp"), "hp_max": ("stats", "hpMax"),
    "mana": ("stats", "mana"), "mana_max": ("stats", "manaMax"),
    "strength": ("stats", "strength"), "dexterity": ("stats", "dexterity"),
    "magic_circle": ("stats", "magicCircle"), "learn_pts": ("stats", "learnPts"),
    "res_fire": ("stats", "resFire"), "res_ice": ("stats", "resIce"),
    "res_edge": ("stats", "resEdge"), "res_point": ("stats", "resPoint"),
    "res_blunt": ("stats", "resBlunt"),
    "distance_m": ("session", "distanceM"), "steps": ("session", "steps"),
}


def snapshot_from_payload(p):
    """build_payload-Output auf die g1r_sample-Snapshot-Felder abbilden."""
    snap = {col: (p.get(grp) or {}).get(key) for col, (grp, key) in _SNAPSHOT_MAP.items()}
    snap["guild_key"] = p.get("guildKey")
    snap["strongest_melee"] = p.get("strongestMelee")
    snap["strongest_melee_dmg"] = p.get("strongestMeleeDmg")
    snap["strongest_ranged"] = p.get("strongestRanged")
    snap["strongest_ranged_dmg"] = p.get("strongestRangedDmg")
    snap["strongest_spell"] = p.get("strongestSpell")
    return snap


def _real_post(url, headers, body):
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=5) as r:
        return getattr(r, "status", None) or r.getcode()


def _forward_loop(fw, interval=2.0):
    """Pollt die State-Datei; bei jeder NEUEN Mod-Schreibung (mtime-Wechsel) genau
    ein Paket an Prod schicken (Dedup gegen Retries macht der Server via client_seq)."""
    last_mtime = 0
    while True:
        try:
            m = os.path.getmtime(STATE_FILE)
        except OSError:
            m = 0
        if m and m != last_mtime:
            p = build_payload(DEFAULT_LANG)
            if p.get("ok"):
                fw.enqueue(snapshot_from_payload(p), p.get("events") or [], p.get("saveKey"))
                last_mtime = m
        try:
            fw.flush_once(_real_post)
        except Exception:
            pass
        time.sleep(interval)


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    """Wie ThreadingHTTPServer, aber Verbindungs-Abbrüche (Browser/OBS schließt die
    SSE-Verbindung → WinError 10053 / Broken Pipe) werden still verworfen statt als
    Traceback nach stderr gedruckt. Echte Fehler kommen weiter durch."""
    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


if __name__ == "__main__":
    print(f"[g1r-local] liest {STATE_FILE}")
    print(f"[g1r-local] serviert http://localhost:{PORT}/state  (Strg+C zum Beenden)")
    _ingest_url = os.environ.get("G1R_INGEST_URL")
    if _ingest_url:
        _fw = Forwarder(_ingest_url, os.environ.get("G1R_INGEST_TOKEN", ""))
        threading.Thread(target=_forward_loop, args=(_fw,), daemon=True).start()
        print(f"[g1r-local] Prod-Forwarding aktiv → {_ingest_url}")
    srv = QuietThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[g1r-local] beendet.")
    finally:
        srv.server_close()
