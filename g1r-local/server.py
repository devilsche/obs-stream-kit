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
import json
import os
import re
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ── Konfiguration ──────────────────────────────────────────────────────────
PORT = 9210
# MUSS mit OUTPUT_PATH im Lua-Mod (G1RExport/scripts/main.lua) übereinstimmen.
STATE_FILE = os.environ.get("G1R_STATE_FILE", r"C:\obs-g1r\g1r-state.json")
# Älter als das → als "offline" behandeln (Spiel zu / Mod pausiert).
STALE_AFTER_S = 10
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
    for it in (data.get("items") or []):
        # Mod liefert teils schon lokalisierten Namen (Spielsprache) — nicht antasten.
        if not it.get("display"):
            it["display"] = _translate(it.get("name"), lang)
    # Staerkste Waffe getrennt nach Kategorie — Nahkampf/Fernkampf sind nicht
    # vergleichbar (Armbrust 60 vs. Klinge 73), also je eigener Bestwert + Schaden.
    melee, melee_dmg = strongest_melee(data.get("items"))
    if melee:
        data["strongestMelee"] = melee
        data["strongestMeleeDisplay"] = _translate(melee, lang)
        data["strongestMeleeDmg"] = melee_dmg
    ranged, ranged_dmg = strongest_ranged(data.get("items"))
    if ranged:
        data["strongestRanged"] = ranged
        data["strongestRangedDisplay"] = _translate(ranged, lang)
        data["strongestRangedDmg"] = ranged_dmg
    mc = (data.get("stats") or {}).get("magicCircle", 0)
    ss = strongest_usable_spell(data.get("items"), mc)
    if ss:
        data["strongestSpell"] = ss
        data["strongestSpellDisplay"] = _translate(ss, lang)
    # Gilde: Rohtag -> stabiler Key (steuert Wappen-Symbol) + lokalisierter Name.
    gk = map_guild(data.get("guild"))
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
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_events(self, lang):
        # Server-Sent Events: das Widget abonniert /events einmalig, der Server
        # pusht den Payload bei jeder Aenderung (kein Netzwerk-Polling mehr).
        # Heartbeat alle 15s haelt die Verbindung wach. ThreadingHTTPServer →
        # ein Thread je Client, ein haengender Stream blockiert die anderen nicht.
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        last, last_beat = None, time.time()
        try:
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


if __name__ == "__main__":
    print(f"[g1r-local] liest {STATE_FILE}")
    print(f"[g1r-local] serviert http://localhost:{PORT}/state  (Strg+C zum Beenden)")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[g1r-local] beendet.")
    finally:
        srv.server_close()
