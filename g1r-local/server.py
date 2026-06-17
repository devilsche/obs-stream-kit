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
        if self.path.split("?")[0] != "/state":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        lang = (qs.get("lang") or [DEFAULT_LANG])[0]
        payload = {"ok": False, "reason": "no-data"}
        try:
            age = time.time() - os.path.getmtime(STATE_FILE)
            if age <= STALE_AFTER_S:
                with open(STATE_FILE, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                data["ageSec"] = round(age, 1)
                for it in (data.get("items") or []):
                    # Liefert der Mod schon einen lokalisierten Namen (UI-Weg,
                    # GetItemNameByPos = Spielsprache), den NICHT antasten. Nur den
                    # Container-Fallback (technischer Klassenname) uebersetzen.
                    if not it.get("display"):
                        it["display"] = _translate(it.get("name"), lang)
                if data.get("spell"):
                    data["spellDisplay"] = _spell_display(data.get("spell"), lang)
                # Ausgeruestete Waffen: Klassennamen (ItMw_*/ItRw_*) wie Items uebersetzen.
                if data.get("weaponMelee"):
                    data["weaponMeleeDisplay"] = _translate(data["weaponMelee"], lang)
                if data.get("weaponRanged"):
                    data["weaponRangedDisplay"] = _translate(data["weaponRanged"], lang)
                if data.get("attack"):
                    data["attackDisplay"] = _attack_display(data.get("attack"), lang)
                data["lang"] = lang
                payload = data
            else:
                payload = {"ok": False, "reason": "stale", "ageSec": round(age, 1)}
        except FileNotFoundError:
            payload = {"ok": False, "reason": "no-file"}
        except Exception as exc:  # JSON halb geschrieben o.ä. → kurz später ok
            payload = {"ok": False, "reason": f"read-error: {exc}"}

        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
