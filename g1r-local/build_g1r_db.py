#!/usr/bin/env python3
"""Baut die G1R-Komplettdatenbank (Waffen + Magie) aus mehreren Quellen.

Quellen:
  - steam_w.html  : Steam-Guide "Vollständige Waffen-Datenbank" (Roh-HTML) →
                    Waffen-Werte: Name(DE/EN), Seltenheit, Stufe, Schaden, Anforderung, Stat, Kategorie.
  - steam_m.html  : Steam-Guide "Datenbank aller Zauber" (Roh-HTML) → Zauber-Werte.
  - g1rdb.html    : gothic1remakegame.com Waffenliste (Roh-HTML) → EN-Name, Slug, Icon-URL.
  - g1r-items.json: eigener UE4SS-Object-Dump-Katalog → echte interne IDs (ItMw/ItRw/ItAr).

Joins:
  - Steam↔Web über Stat-Signatur (damage, reqStat, requirement) — sprachunabhängig.
  - →Dump-ID über distinktiven Namens-Token (nur benannte Unique-Waffen sauber matchbar).

Coin-/Erz-Werte werden bewusst ignoriert (vom Nutzer nicht gewünscht).
Snapshots der Roh-HTML liegen in g1r-local/raw/ (Reproduzierbarkeit).
"""
import re, html, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")


def _text(path):
    h = open(path, encoding="utf-8", errors="replace").read()
    h = re.sub(r"<script.*?</script>", "", h, flags=re.S)
    h = re.sub(r"<style.*?</style>", "", h, flags=re.S)
    h = re.sub(r"<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", html.unescape(h)).strip()


# ---------------------------------------------------------------- Waffen (Steam)
def parse_steam_weapons(path):
    txt = _text(path)
    HDR = "Symbol Gegenstandsname Seltenheit Stufe Schaden Anforderung Münzwert"
    RAR = "Legendär|Meister|Fein|Gewöhnlich|Grob|Selten|Episch"
    CATS = ("Einhandschwerter|Zweihandschwerter|Einhandäxte|Zweihandäxte|"
            "Bögen|Armbrüste|Stumpfwaffen|Streitkolben\\w*|Keulen|Stäbe|Fackeln|Stangenwaffen")
    row = re.compile(r"(.+?) (" + RAR + r") (\S+) (\d+) (?:(\d+) (STR|DEX)|(None|Keine)) (\d+)")
    out = []
    parts = txt.split(HDR)
    for k in range(1, len(parts)):
        prev = parts[k - 1][-80:]
        cm = re.findall("(" + CATS + ")", prev)
        cat = cm[-1] if cm else None
        for m in row.finditer(parts[k]):
            name = m.group(1).strip()
            name = re.sub(r"^.*?(\d+) ", "", name) if re.search(r"\d", name) else name
            out.append({
                "name": name.strip(),
                "rarity": m.group(2), "tier": m.group(3),
                "damage": int(m.group(4)),
                "requirement": int(m.group(5)) if m.group(5) else None,
                "reqStat": {"STR": "Strength", "DEX": "Dexterity"}.get(m.group(6)),
                "category": cat,
            })
    return out


# ---------------------------------------------------------------- Waffen (Web: EN-Name, Slug, Icon)
def parse_web_weapons(path):
    h = html.unescape(open(path, encoding="utf-8", errors="replace").read())
    out = {}
    for c in h.split("entity-row-thumb")[1:]:
        ms = re.search(r"/database/gothic-1-remake-items/([a-z0-9-]+)/", c)
        if not ms:
            continue
        slug = ms.group(1)
        mn = re.search(r"/database/gothic-1-remake-items/" + re.escape(slug) + r'/"[^>]*>\s*([^<]+?)\s*<', c)
        if not mn:
            continue
        md = re.search(r"(\d+)\s*Damage\s+([A-Za-z]+)\s+Damage Type", c)
        mr = re.search(r"(\d+)\s*Req\.\s*([A-Za-z]+)", c)
        mi = re.search(r"(g1r-items-[a-z0-9-]+\.webp)", c)
        rec = out.setdefault(slug, {"slug": slug, "name_en": mn.group(1).strip(),
                                    "damage": None, "reqStat": None, "requirement": None, "icon": None})
        if md and rec["damage"] is None:
            rec["damage"] = int(md.group(1)); rec["damageType"] = md.group(2)
        if mr and rec["requirement"] is None:
            rec["requirement"] = int(mr.group(1)); rec["reqStat"] = mr.group(2)
        if mi and not rec["icon"]:
            rec["icon"] = mi.group(1)
    return list(out.values())


# ---------------------------------------------------------------- Magie (kuratiert aus Guide-Werten)
# Kreis / Schaden-Maximum / Mana-Notiz / Wirkung. Schaden None = kein direkter Schaden.
SPELL_STATS = {
    # Innos (Feuer)
    "light":            {"circle": 1, "damage": None, "school": "Innos", "note": "Licht"},
    "firebolt":         {"circle": 1, "damage": 65,   "school": "Innos", "note": "Aufladung 35/40/50/65"},
    "fireball":         {"circle": 3, "damage": 120,  "school": "Innos", "note": "Aufladung 60/90/120"},
    "stormoffire":      {"circle": 4, "damage": 250,  "school": "Innos", "note": "200/250"},
    "firerain":         {"circle": 5, "damage": 45,   "school": "Innos", "note": "45/Treffer (AoE)"},
    # Adanos (Wasser)
    "icebolt":          {"circle": 1, "damage": 50,   "school": "Adanos", "note": "20/30/40/50"},
    "heal":             {"circle": None, "damage": None, "school": "Adanos", "note": "Heilung"},
    "balllightning":    {"circle": 2, "damage": 120,  "school": "Adanos", "note": "Aufladung 50/70/90/120"},
    "iceblock":         {"circle": 3, "damage": 80,   "school": "Adanos", "note": "60/80"},
    "chainlightning":   {"circle": 4, "damage": 150,  "school": "Adanos", "note": "Kette 120/150"},
    "icewave":          {"circle": 5, "damage": 150,  "school": "Adanos", "note": "120/150"},
    # Sleeper (Geist)
    "fistofwind":       {"circle": 1, "damage": 50,   "school": "Sleeper", "note": "Aufladung 20/30/40/50"},
    "sleep":            {"circle": 2, "damage": None, "school": "Sleeper", "note": "Kontrolle"},
    "telekinesis":      {"circle": 3, "damage": None, "school": "Sleeper", "note": "Hilfe"},
    "charm":            {"circle": 3, "damage": None, "school": "Sleeper", "note": "Kontrolle"},
    "pyrokinesis":      {"circle": 3, "damage": 20,   "school": "Sleeper", "note": "20/Sek"},
    "stormfist":        {"circle": 4, "damage": 160,  "school": "Sleeper", "note": "120/160"},
    "control":          {"circle": 4, "damage": None, "school": "Sleeper", "note": "Hilfe"},
    "fear":             {"circle": None, "damage": None, "school": "Sleeper", "note": "Furcht"},
    "shrink":           {"circle": None, "damage": None, "school": "Sleeper", "note": "Schrumpfen"},
    # Beliar (Nekromantie / Beschwörung)
    "summonskeletons":  {"circle": None, "damage": None, "school": "Beliar", "note": "Beschwört 3 Skelette"},
    "summongolem":      {"circle": None, "damage": None, "school": "Beliar", "note": "Beschwört Golem"},
    "summondemon":      {"circle": None, "damage": None, "school": "Beliar", "note": "Beschwört Dämon"},
    "summonarmyofdarkness": {"circle": None, "damage": None, "school": "Beliar", "note": "Beschwört 9 Diener"},
    "deathtotheundead": {"circle": 4, "damage": 500,  "school": "Beliar", "note": "nur Untote"},
    "breathofdeath":    {"circle": 6, "damage": 150,  "school": "Beliar", "note": "Kreis 6"},
    "urizielwaveofdeath": {"circle": 6, "damage": 90, "school": "Beliar", "note": "90 Energie/Sek (nur Rune)"},
}


def norm_spell(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def build_magic(catalog):
    """Kanonische Liste = Dump-Runen/Scrolls; Werte aus SPELL_STATS per Namens-Norm."""
    arcane = catalog.get("Arkan", {})
    out = []
    seen_stats = set()
    for group, items in arcane.items():  # "Runen" / "Schriftrollen"
        kind = "Rune" if "Rune" in group else "Scroll"
        for it in items:
            base = re.sub(r"^ItAr_(Rune|Scroll)_", "", it["id"])
            base = re.sub(r"_(Base|Player|MiltenSleeper)$", "", base)
            key = norm_spell(base)
            stats = SPELL_STATS.get(key)
            rec = {"id": it["id"], "kind": kind, "name": it["label"].replace("Rune ", "").replace("Scroll ", "")}
            if stats:
                rec.update({"school": stats["school"], "circle": stats["circle"],
                            "damage": stats["damage"], "note": stats["note"]})
                seen_stats.add(key)
            else:
                rec.update({"school": None, "circle": None, "damage": None, "note": None})
            out.append(rec)
    unmatched_stats = sorted(set(SPELL_STATS) - seen_stats)
    return out, unmatched_stats


# ---------------------------------------------------------------- Dump-ID Token-Mapping
def build_id_index(catalog):
    """token(lower) -> id, nur für distinktive benannte Waffen (kein generisches 01/02)."""
    idx = {}
    for sec in ("Nahkampf", "Fernkampf"):
        for group, items in catalog.get(sec, {}).items():
            for it in items:
                # letztes nicht-numerisches, nicht-generisches Token
                toks = re.sub(r"^It(Mw|Rw)_", "", it["id"]).split("_")
                for t in toks:
                    tl = t.lower()
                    if tl in ("1h", "2h", "old", "light", "heavy", "war", "long", "short",
                              "broad", "bastard", "small", "orc", "vorc", "sleeper", "base",
                              "hatchet", "club", "nailmace", "sledgehammer", "warhammer",
                              "poker", "mace", "axe", "sword", "bow", "crossbow", "staff",
                              "torch", "scepter", "stone", "qa", "playtest", "playerplaytest") \
                            or t.isdigit() or len(t) < 3:
                        continue
                    idx.setdefault(tl, it["id"])
    return idx


def match_dump_id(name, idx):
    for tok in re.findall(r"[A-Za-zÄÖÜäöü]+", name.lower()):
        # "beliars" -> "beliar", "gorns" -> "gorn"
        for cand in (tok, tok.rstrip("s"), re.sub(r"s$", "", tok)):
            if cand in idx:
                return idx[cand]
    return None


# ---------------------------------------------------------------- Assembly
def main():
    catalog = json.load(open(os.path.join(HERE, "g1r-items.json"), encoding="utf-8"))
    steam = parse_steam_weapons(os.path.join(RAW, "steam_w.html"))
    web = parse_web_weapons(os.path.join(RAW, "g1rdb.html"))
    idx = build_id_index(catalog)

    # Web-Indizes: normalisierter EN-Name, Stat-Signatur, Dump-ID-Brücke
    def nrm(s):
        return re.sub(r"[^a-z0-9]", "", s.lower())
    web_name = {nrm(w["name_en"]): w for w in web}
    web_sig = {}
    web_id = {}
    for w in web:
        if w["damage"] is not None and w["reqStat"]:
            web_sig.setdefault((w["damage"], w["reqStat"][0], w["requirement"]), w)
        wid = match_dump_id(w["name_en"], idx)
        if wid:
            web_id.setdefault(wid, w)

    weapons = []
    n_icon = n_id = n_en = 0
    for s in steam:
        rec = dict(s)
        did = match_dump_id(s["name"], idx)
        # Join Steam→Web: 1) Name  2) Stat-Signatur  3) Dump-ID-Brücke
        w = (web_name.get(nrm(s["name"]))
             or web_sig.get((s["damage"], (s["reqStat"] or " ")[0], s["requirement"]))
             or (did and web_id.get(did)))
        if w:
            rec["name_en"] = w["name_en"]; rec["slug"] = w["slug"]; rec["icon"] = w["icon"]
            n_en += 1
            if w["icon"]:
                n_icon += 1
            if not did:
                did = match_dump_id(w["name_en"], idx)
        else:
            rec["name_en"] = None; rec["slug"] = None; rec["icon"] = None
        rec["dumpId"] = did
        if did:
            n_id += 1
        weapons.append(rec)

    magic, unmatched = build_magic(catalog)

    db = {
        "_meta": {
            "weapons_count": len(weapons), "magic_count": len(magic),
            "weapons_with_icon": n_icon, "weapons_with_id": n_id, "weapons_with_en": n_en,
            "sources": ["steamcommunity 3739158251 (Waffen)", "steamcommunity 3740259675 (Magie)",
                        "gothic1remakegame.com (Icons/EN)", "UE4SS Object-Dump (IDs)"],
            "note": "Coin-Werte ignoriert. Stats aus Steam-Guide; EN-Name/Slug/Icon aus Web "
                    "über Stat-Signatur gejoint; dumpId per Namens-Token (nur Unique-Waffen).",
        },
        "weapons": weapons,
        "magic": magic,
    }
    out = os.path.join(HERE, "g1r-database.json")
    json.dump(db, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"weapons={len(weapons)} (icon={n_icon}, id={n_id}, en={n_en}) magic={len(magic)}")
    print("unmatched spell-stats keys:", unmatched)
    print("→", out)
    return db


if __name__ == "__main__":
    main()
