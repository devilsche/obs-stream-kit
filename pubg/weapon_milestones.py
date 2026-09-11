"""Meilensteine aus Waffen-Mastery, Karriere-Zahlen und Wurfgeraeten.

**Woher die Zahlen kommen.** Drei Quellen, weil keine allein reicht:

* `weapon_mastery` (API) fuehrt Alltime-Werte je Waffe. Die ingame
  angezeigte Zahl ist die Summe aus `OfficialStatsTotal` und
  `CompetitiveStatsTotal` — belegt an M416 (3156 + 23 = 3179) und
  Mk12 (1962 + 11 = 1973). `StatsTotal` ist eine dritte, aeltere
  Zaehlung und *keine* Teilmenge; sie bleibt hier unberuecksichtigt.
* `seasons/lifetime` fuehrt die kontoweiten Summen. Ueber alle Modi
  aufaddiert ergibt das genau die Zahl, die externe Tracker zeigen
  (25.709 Kills). Die Differenz zur Waffen-Summe (14.958) sind
  Toetungen ohne Waffe: Fahrzeug, Blauzone, Sturz, Faust.
* `match_weapon_stats` (unsere DB) liefert die Match-Rekorde und die
  Wurfzahlen. Fuer Rekorde ist sie der API vorzuziehen: die API fuehrt
  `MostDamagePlayerInAGame` nur im alten `StatsTotal`-Block, und der
  meldet fuer die M416 682 Schaden, wo unsere Aufzeichnung 976 belegt.
  Ein Rekord-Celebrate auf Basis der API wuerde also bei einer Marke
  ausloesen, die laengst ueberboten ist.

**Wie Level und Tier zusammenhaengen.** Das Level laeuft *innerhalb*
eines Tiers von 1 bis 99; ist es voll, beginnt das naechste Tier wieder
bei 1. `LevelCurrent` und `XPTotal` beziehen sich also auf das aktuelle
Tier, nicht auf die ganze Laufbahn.

Am Konto belegt: bei **gleichem Level steht dieselbe XP-Summe, egal in
welchem Tier** — Level 13 kommt in Tier 2 und Tier 5 vor (40.259 gegen
42.337 XP), Level 60 in Tier 0 und Tier 5 (435.027 gegen 442.079). Und
umgekehrt sitzt die ACE32 in Tier 5 bei Level 13 auf nur 42.337 XP,
waehrend die Kar98k in Tier 1 bei Level 97 916.013 traegt. Waere die XP
kumulativ, muesste es andersherum sein.

**Das Level allein sagt darum nichts.** Eine Waffe in Tier 5 bei Level
13 ist weiter als eine in Tier 1 bei Level 97 — was die Kills
bestaetigen (1.344 gegen 143). Wer zwei Staende vergleichen will, nimmt
`progress()`: Tier zuerst, Level darin.

**Das Level zaehlt in der API ab null**, und es endet bei ingame 99:
danach steigt man ins naechste Tier auf. Level 100 gibt es nur in
Tier 6, weil dort kein Aufstieg mehr moeglich ist. Die Messwerte
bestaetigen das von der anderen Seite — rohe 99 kommt ausschliesslich
in Tier 6 vor, sonst ist 98 der Hoechstwert. Der volle Stand heisst
also "Master, Level 100", mit exakt 952.500 XP bei allen drei Waffen
und Streuung null. Ausgelevelt ist `Tier == 6`, nicht ein bestimmtes
Level.

**Und darunter noch eine Ebene**: innerhalb eines Levels zaehlt das
Spiel den Fortschritt zum naechsten mit (ingame etwa "9.334/12.500" bei
Level 70). `XPTotal` ist die Summe darueber, also die XP im laufenden
Tier — nicht die des laufenden Levels und nicht die der Laufbahn.
"""
from pubg.aggregations import _weapon_ci_lookup

#: Praefix der Waffen-Ids im Mastery-Endpoint. Der Rest ist mit `Weap`
#: davor der Schluessel in WEAPON_NAMES: Item_Weapon_HK416_C → WeapHK416_C.
MASTERY_PREFIX = "Item_Weapon_"

#: Level, bei dem ein Tier voll ist: danach steigt man auf und beginnt
#: wieder bei 1. Faktisch ist 99 damit das Ende jedes Tiers.
LEVEL_PER_TIER = 99

#: Level 100 gibt es nur in Tier 6. Dort kann man nicht weiter
#: aufsteigen, also zaehlt das Level einen Schritt weiter, statt in ein
#: Tier 7 zu wechseln, das es nicht gibt.
MAX_LEVEL_IN_TIER = 100

#: Die API zaehlt das Level innerhalb des Tiers ab null. Das passt zu
#: den Messwerten: rohe 99 kommt ausschliesslich in Tier 6 vor, in
#: allen anderen Tiers ist 98 der Hoechstwert — also ingame 99, das
#: Ende eines Tiers.
LEVEL_OFFSET = 1

#: Hoechstes Tier. Ohne Tier heisst es ingame "Basic", Tier 6 "Master"
#: — hoeher geht es nicht, ein Tier 7 gibt es nicht. Der hoechste
#: erreichbare Stand ist damit "Master, Level 100".
MAX_TIER = 6

#: Rangnamen, soweit belegt. Die Stufen zwischen Basic und Master sind
#: namentlich nicht bekannt und werden als Zahl gezeigt.
TIER_NAMES = {0: "Basic", MAX_TIER: "Master"}

#: Die XP-Summe fuer ein volles Tier. Am Ende (Tier 6, Level 99) bleibt
#: der Wert dort stehen: alle drei ausgelevelten Waffen tragen exakt
#: diese Zahl, Streuung null.
XP_PER_TIER = 952500

#: Wurfgeraete, wie `match_weapon_stats.weapon` sie fuehrt.
#:
#: Die Liste kommt aus WEAPON_NAMES und nicht aus der
#: `is_thrown`-Spalte: die steht in Zeilen bis August 2026 noch auf
#: false, weil die Spalte erst danach mitgeschrieben wurde.
THROWABLES = tuple(sorted({
    "Granate", "Molotov", "Klebebombe", "C4", "Panzerfaust", "Moerser",
    "Rauchbombe", "Blendgranate", "Taser", "Blauzonen-Granate",
}))

#: Anzeigenamen fuer die Wurfgeraete. WEAPON_NAMES ist deutsch
#: gepflegt und dient als Datenschluessel; die Oberflaeche ist englisch.
DISPLAY_NAMES = {
    "Granate": "Frag Grenade",
    "Klebebombe": "Sticky Bomb",
    "Rauchbombe": "Smoke Grenade",
    "Blendgranate": "Flash Grenade",
    "Taser": "Stun Gun",
    "Blauzonen-Granate": "Blue Zone Grenade",
    "Moerser": "Mortar",
    "Panzerfaust": "Panzerfaust",
}


def display_name(weapon: str) -> str:
    """Englischer Anzeigename; Waffennamen selbst sind sprachneutral."""
    return DISPLAY_NAMES.get(weapon, weapon)


def progress(tier: int, level: int) -> int:
    """Vergleichbarer Gesamtstand aus Tier und Level.

    Das Level allein taugt dafuer nicht: es laeuft in jedem Tier neu bis
    100, weshalb Tier 5 Level 14 weiter ist als Tier 1 Level 98.
    """
    return int(tier or 0) * MAX_LEVEL_IN_TIER + int(level or 0)


def tier_label(tier: int) -> str:
    """Rangname, wo bekannt — sonst die Zahl."""
    return TIER_NAMES.get(int(tier or 0), f"Tier {int(tier or 0)}")


# ── Anlaesse ────────────────────────────────────────────────────────────────

#: Die feierbaren Anlaesse.
#:
#: `kind` bestimmt, wann ausgeloest wird:
#:   ``step``   jede erreichte Vielfache von `step`
#:   ``record`` jeder neue Hoechstwert
#:   ``at``     genau beim Erreichen eines Wertes (einmalig je Waffe)
#: `huge_every` hebt eine Teilmenge der Stufen auf die grosse Fassung —
#: sonst waere die halbe Million Schaden so laut wie die naechsten
#: hunderttausend.
OCCASIONS = {
    "weapon_damage": {
        "scope": "weapon", "metric": "damage", "kind": "step",
        "step": 25000, "huge_every": 250000, "unit": "damage",
        "label": "Weapon Damage", "widget": "bar", "enabled": True,
        "hint": "Total damage dealt with one weapon",
    },
    "weapon_kills": {
        "scope": "weapon", "metric": "kills", "kind": "step",
        "step": 250, "huge_every": 1000, "unit": "kills",
        "label": "Weapon Kills", "widget": "bar", "enabled": True,
        "hint": "Total kills with one weapon",
    },
    # Ausgelevelt heisst Tier 6, nicht ein bestimmtes Level: das Level
    # beginnt in jedem Tier neu, und ein "Level 100" gibt es nicht.
    "weapon_mastered": {
        "scope": "weapon", "metric": "tier", "kind": "at",
        "at": MAX_TIER, "unit": "tier",
        "label": "Weapon Mastered", "widget": "big", "enabled": True,
        "tier": "huge",
        "hint": "A weapon reaches the master tier",
    },
    # Der Tier-Wechsel ist ein eigener Anlass, aber ein leiser: er
    # faellt je Waffe hoechstens sechsmal im Leben und haengt an den
    # Kills, nicht am Level. Vorbelegt nur fuer die Leiste — ein
    # Vollbild dafuer waere zu viel.
    "weapon_tier": {
        "scope": "weapon", "metric": "tier", "kind": "record",
        "min": 1, "unit": "tier",
        "label": "Mastery Tier", "widget": "bar", "enabled": True,
        "tier": "big",
        "hint": "A weapon climbs to the next mastery tier",
    },
    "weapon_best_damage": {
        "scope": "weapon", "metric": "best_damage", "kind": "record",
        "min": 400, "unit": "damage",
        "label": "Weapon Damage Record", "widget": "big", "enabled": True,
        "tier": "big",
        "hint": "New personal best in a single match",
    },
    "weapon_best_kills": {
        "scope": "weapon", "metric": "best_kills", "kind": "record",
        "min": 5, "unit": "kills",
        "label": "Weapon Kill Record", "widget": "big", "enabled": True,
        "tier": "big",
        "hint": "New personal best in a single match",
    },
    "weapon_longest": {
        "scope": "weapon", "metric": "longest", "kind": "record",
        "min": 200, "unit": "metres",
        "label": "Longest Kill", "widget": "big", "enabled": True,
        "tier": "big",
        "hint": "New longest kill with a weapon",
    },
    "thrown_count": {
        "scope": "weapon", "metric": "throws", "kind": "step",
        "step": 100, "huge_every": 1000, "unit": "throws",
        "label": "Throwables Thrown", "widget": "bar", "enabled": True,
        "hint": "Grenades, molotovs and the rest, counted per type",
    },
    "career_damage": {
        "scope": "career", "metric": "damage", "kind": "step",
        "step": 100000, "huge_every": 500000, "unit": "damage",
        "label": "Career Damage", "widget": "big", "enabled": True,
        "hint": "Total damage across every mode",
    },
    "career_kills": {
        "scope": "career", "metric": "kills", "kind": "step",
        "step": 1000, "huge_every": 5000, "unit": "kills",
        "label": "Career Kills", "widget": "bar", "enabled": True,
        "hint": "Total kills across every mode",
    },
    "career_rounds": {
        "scope": "career", "metric": "rounds", "kind": "step",
        "step": 1000, "huge_every": 5000, "unit": "rounds",
        "label": "Career Rounds", "widget": "bar", "enabled": False,
        "hint": "Matches played, all modes",
    },
    "career_knocks": {
        "scope": "career", "metric": "dbnos", "kind": "step",
        "step": 1000, "huge_every": 5000, "unit": "knocks",
        "label": "Career Knocks", "widget": "bar", "enabled": True,
        "hint": "Enemies knocked down",
    },
    "career_revives": {
        "scope": "career", "metric": "revives", "kind": "step",
        "step": 500, "huge_every": 2500, "unit": "revives",
        "label": "Teammates Revived", "widget": "bar", "enabled": True,
        "hint": "Picking your squad back up",
    },
    "career_assists": {
        "scope": "career", "metric": "assists", "kind": "step",
        "step": 500, "huge_every": 2500, "unit": "assists",
        "label": "Career Assists", "widget": "bar", "enabled": False,
        "hint": "Damage that someone else finished",
    },
    "career_top10s": {
        "scope": "career", "metric": "top10s", "kind": "step",
        "step": 500, "huge_every": 2500, "unit": "top 10s",
        "label": "Top 10 Finishes", "widget": "bar", "enabled": False,
        "hint": "Rounds that ended in the last ten",
    },
    # Strecke kommt in Metern; die Schrittweite ist ein Tausender-Kilometer.
    "career_walk": {
        "scope": "career", "metric": "walk", "kind": "step",
        "step": 1000000, "huge_every": 5000000, "unit": "metres",
        "label": "Distance on Foot", "widget": "bar", "enabled": True,
        "hint": "Every 1000 km walked",
    },
    "career_ride": {
        "scope": "career", "metric": "ride", "kind": "step",
        "step": 1000000, "huge_every": 5000000, "unit": "metres",
        "label": "Distance Driven", "widget": "bar", "enabled": False,
        "hint": "Every 1000 km behind the wheel",
    },
    # Zeit kommt in Sekunden; 360.000 s sind einhundert Stunden.
    "career_time": {
        "scope": "career", "metric": "time_survived", "kind": "step",
        "step": 360000, "huge_every": 1800000, "unit": "seconds",
        "label": "Time Survived", "widget": "bar", "enabled": True,
        "hint": "Every 100 hours alive in a round",
    },
    "career_heals": {
        "scope": "career", "metric": "heals", "kind": "step",
        "step": 5000, "huge_every": 25000, "unit": "heals",
        "label": "Items Used", "widget": "bar", "enabled": False,
        "hint": "Bandages, first aid kits, med kits",
    },
    "career_looted": {
        "scope": "career", "metric": "weapons_acquired", "kind": "step",
        "step": 10000, "huge_every": 50000, "unit": "weapons",
        "label": "Weapons Picked Up", "widget": "bar", "enabled": False,
        "hint": "Every gun you ever grabbed",
    },
    "career_vehicles": {
        "scope": "career", "metric": "vehicle_destroys", "kind": "step",
        "step": 100, "huge_every": 500, "unit": "vehicles",
        "label": "Vehicles Destroyed", "widget": "bar", "enabled": False,
        "hint": "Cars, bikes and boats you blew up",
    },
    # Kein Erfolg, sondern eine Marke mit Selbstironie: Granate zu
    # frueh, Auto vor den Baum, Sprung ohne Fallschirm. Bei 123 in
    # 17.606 Runden faellt sie selten genug, um witzig zu bleiben.
    "career_suicides": {
        "scope": "career", "metric": "suicides", "kind": "step",
        "step": 25, "huge_every": 100, "unit": "own goals",
        "label": "Own Goals", "widget": "bar", "enabled": True,
        "hint": "Ways to die that nobody else gets credit for",
    },
    "career_roadkills": {
        "scope": "career", "metric": "road_kills", "kind": "step",
        "step": 25, "huge_every": 100, "unit": "road kills",
        "label": "Road Kills", "widget": "bar", "enabled": False,
        "hint": "Kills by bumper",
    },
    # Kontoweite Rekorde. Anders als die Waffen-Rekorde kommen diese aus
    # der API und gelten damit fuer die ganze Karriere, nicht nur fuer
    # die Matches, deren Telemetrie wir haben.
    "career_longest_kill": {
        "scope": "career", "metric": "longest_kill", "kind": "record",
        "min": 300, "unit": "metres",
        "label": "Longest Kill Ever", "widget": "big", "enabled": True,
        "tier": "huge",
        "hint": "A new career-long shot",
    },
    "career_most_kills": {
        "scope": "career", "metric": "most_kills", "kind": "record",
        "min": 10, "unit": "kills",
        "label": "Most Kills in a Round", "widget": "big", "enabled": True,
        "tier": "huge",
        "hint": "Beating your best round ever",
    },
}

#: Was das Config-Tool ueberschreiben darf. Alles andere ist Code.
#:
#: `at` steht bewusst NICHT darin: der einzige Anlass dieser Art ist
#: "ausgelevelt", und das ist Tier 6 — eine Tatsache des Spiels, keine
#: Einstellung. Als einstellbares Feld hat es bereits Schaden
#: angerichtet: eine Konfiguration, die noch die alte Fassung
#: (Level 100) gespeichert hatte, ueberschrieb den korrigierten Wert
#: und liess den Anlass auf einen Tier-Wert 100 zeigen, den es nicht
#: gibt.
CONFIG_FIELDS = ("enabled", "step", "widget", "huge_every", "min")

#: Zielwidgets. `both` liefert denselben Meilenstein an beide.
WIDGETS = ("big", "bar", "both")


def default_config() -> dict:
    """Die Registry-Werte als flache, speicherbare Konfiguration."""
    return {
        oid: {f: o[f] for f in CONFIG_FIELDS if f in o}
        for oid, o in OCCASIONS.items()
    }


def merge_config(stored) -> dict:
    """Gespeicherte Konfiguration ueber die Registry-Defaults legen.

    Unbekannte Anlaesse aus einer aelteren Fassung fallen weg, neu
    hinzugekommene erscheinen mit ihrem Default — das Tool muss nach
    einem Update nichts nachtragen.
    """
    cfg = default_config()
    for oid, over in (stored or {}).items():
        if oid not in cfg or not isinstance(over, dict):
            continue
        for f in CONFIG_FIELDS:
            if f not in over or over[f] is None:
                continue
            if f == "enabled":
                cfg[oid][f] = bool(over[f])
            elif f == "widget":
                if over[f] in WIDGETS:
                    cfg[oid][f] = over[f]
            else:
                try:
                    v = float(over[f])
                except (TypeError, ValueError):
                    continue
                if v > 0:
                    cfg[oid][f] = int(v) if v == int(v) else v
    return cfg


# ── Mastery-Antwort lesen ───────────────────────────────────────────────────

def mastery_weapon_name(mastery_id: str):
    """`Item_Weapon_HK416_C` → `M416`, oder None wenn unbekannt.

    Derselbe Klarname, unter dem `match_weapon_stats` die Waffe fuehrt —
    sonst liessen sich API-Summen und unsere Match-Rekorde nicht zu
    einer Waffe zusammenfuehren.
    """
    raw = str(mastery_id or "")
    stem = raw[len(MASTERY_PREFIX):] if raw.startswith(MASTERY_PREFIX) else raw
    hit = _weapon_ci_lookup("Weap" + stem) or _weapon_ci_lookup(stem)
    return hit[0] if hit else None


def _stat_sum(w, field, *aliases):
    """Ein Feld aus Official + Competitive.

    Die beiden Bloecke benennen dasselbe teils anders (`LongestKill`
    gegen `LongestDefeat`), darum die Aliase.
    """
    total = 0.0
    for block in ("OfficialStatsTotal", "CompetitiveStatsTotal"):
        b = w.get(block) or {}
        for f in (field,) + aliases:
            if f in b:
                total += b.get(f) or 0
                break
    return total


def _stat_max(w, field, *aliases):
    """Ein Rekord-Feld: der groessere der beiden Bloecke, nicht die Summe."""
    best = 0.0
    for block in ("OfficialStatsTotal", "CompetitiveStatsTotal"):
        b = w.get(block) or {}
        for f in (field,) + aliases:
            if f in b:
                best = max(best, b.get(f) or 0)
                break
    return best


def parse_mastery(payload) -> dict:
    """Mastery-Antwort → {Klarname: {metrik: wert}}.

    Waffen ohne Mapping fallen weg; ihre Id wuerde sich mit keiner
    Zeile in `match_weapon_stats` treffen. Mehrere Ids koennen auf
    denselben Klarname zeigen (Skin-Varianten) — Summen werden dann
    addiert, Rekorde maximiert.
    """
    ws = (((payload or {}).get("data") or {}).get("attributes")
          or {}).get("weaponSummaries") or {}
    out = {}
    for wid, w in ws.items():
        name = mastery_weapon_name(wid)
        if not name:
            continue
        cur = out.setdefault(name, {
            "damage": 0.0, "kills": 0, "headshots": 0, "groggies": 0,
            "longest": 0.0, "best_kills": 0, "level": 0, "xp": 0,
            "tier": 0, "progress": 0,
        })
        cur["damage"] += _stat_sum(w, "DamagePlayer")
        cur["kills"] += int(_stat_sum(w, "Kills"))
        cur["headshots"] += int(_stat_sum(w, "HeadShots", "Headshots"))
        cur["groggies"] += int(_stat_sum(w, "Groggies"))
        cur["longest"] = max(cur["longest"],
                             _stat_max(w, "LongestKill", "LongestDefeat"))
        cur["best_kills"] = max(cur["best_kills"],
                                int(_stat_max(w, "MostKillsInAGame")))
        # Das Level gilt innerhalb des Tiers und zaehlt ab null: die
        # 99 der API ist ingame die 100.
        lvl = int(w.get("LevelCurrent") or w.get("Level") or 0)
        lvl += LEVEL_OFFSET
        tier = int(w.get("TierCurrent") or 0)
        xp = int(w.get("XPTotal") or w.get("XP") or 0)
        # Bei Skin-Varianten gewinnt der weitere Stand als Ganzes, nicht
        # das hoehere Level: Tier 5 Level 13 steht ueber Tier 1 Level 97.
        if progress(tier, lvl) >= progress(cur["tier"], cur["level"]):
            cur["level"] = lvl
            cur["tier"] = tier
        cur["xp"] = max(cur["xp"], xp)
        cur["progress"] = progress(cur["tier"], cur["level"])
    return out


#: Kontoweite Felder aus `seasons/lifetime`. Links unser Name, rechts
#: das API-Feld und wie ueber die Modi zusammengefasst wird.
#:
#: Der Weg fuehrt absichtlich am eigenen Lifetime-Parser vorbei: der
#: mappt nur auf die Spalten von `player_lifetime` und laesst Strecke,
#: Heilung und die Rekordfelder fallen. Sie hier nachzutragen wuerde
#: zehn Spalten und eine Migration kosten, gebraucht werden sie aber
#: nur zum Vergleich zweier Staende.
CAREER_FIELDS = {
    "damage": ("damageDealt", "sum"),
    "kills": ("kills", "sum"),
    "rounds": ("roundsPlayed", "sum"),
    "wins": ("wins", "sum"),
    "top10s": ("top10s", "sum"),
    "dbnos": ("dBNOs", "sum"),
    "assists": ("assists", "sum"),
    "revives": ("revives", "sum"),
    "heals": ("heals", "sum"),
    "boosts": ("boosts", "sum"),
    "walk": ("walkDistance", "sum"),
    "ride": ("rideDistance", "sum"),
    "swim": ("swimDistance", "sum"),
    "time_survived": ("timeSurvived", "sum"),
    "weapons_acquired": ("weaponsAcquired", "sum"),
    "vehicle_destroys": ("vehicleDestroys", "sum"),
    "road_kills": ("roadKills", "sum"),
    "headshot_kills": ("headshotKills", "sum"),
    "suicides": ("suicides", "sum"),
    # Rekorde: das Maximum ueber die Modi, nicht deren Summe.
    "longest_kill": ("longestKill", "max"),
    "most_kills": ("roundMostKills", "max"),
    "longest_survived": ("longestTimeSurvived", "max"),
}


def career_from_payload(payload) -> dict:
    """Kontoweite Summen aus der Lifetime-Antwort.

    Die Modi sind disjunkt — jede Runde zaehlt in genau einem —, also
    ist Aufaddieren richtig und ergibt die Zahl, die externe Tracker
    zeigen (am Konto belegt: 25.709 Kills).
    """
    modes = (((payload or {}).get("data") or {}).get("attributes")
             or {}).get("gameModeStats") or {}
    out = {k: 0.0 for k in CAREER_FIELDS}
    for s in modes.values():
        for name, (field, how) in CAREER_FIELDS.items():
            v = s.get(field) or 0
            if how == "max":
                out[name] = max(out[name], v)
            else:
                out[name] += v
    return out


# ── Erkennung ───────────────────────────────────────────────────────────────

def _steps_crossed(prev, cur, step):
    """Die erreichten Vielfachen von `step` zwischen prev und cur.

    Mehrere auf einmal sind moeglich (ein Match kann zwei Marken
    reissen); gefeiert wird nur die hoechste, die anderen waeren
    Rueckstand von gestern.
    """
    if step <= 0 or cur <= prev:
        return []
    lo = int(prev // step)
    hi = int(cur // step)
    return [n * step for n in range(lo + 1, hi + 1)]


def tier_for(occ, value):
    """small / big / huge — wie laut gefeiert wird."""
    fixed = occ.get("tier")
    if fixed:
        return fixed
    huge = occ.get("huge_every")
    if huge and value and value % huge == 0:
        return "huge"
    return "small"


def milestone_key(occasion, subject, value):
    """Stabiler Schluessel, damit nichts zweimal gefeiert wird.

    Der Wert gehoert hinein: dieselbe Waffe reisst dieselbe Metrik
    immer wieder, nur an anderer Marke.
    """
    v = int(value) if float(value) == int(value) else round(float(value), 2)
    return f"{occasion}:{subject}:{v}"


def _emit(occasion, occ, subject, value, prev):
    return {
        "key": milestone_key(occasion, subject, value),
        "occasion": occasion,
        "subject": subject,
        "display": display_name(subject) if subject else "",
        "label": occ.get("label") or occasion,
        "unit": occ.get("unit") or "",
        "value": value,
        "prev_value": prev,
        "tier": tier_for(occ, value),
        "widget": occ.get("widget") or "bar",
    }


def detect(prev: dict, cur: dict, cfg=None) -> list:
    """Meilensteine zwischen zwei Staenden.

    `prev` und `cur` sind gleich aufgebaut::

        {"weapons": {"M416": {"damage": …, "kills": …, …}},
         "career":  {"damage": …, "kills": …, "rounds": …}}

    Ein leeres `prev` liefert bewusst nichts: der erste Lauf legt den
    Ausgangsstand an, sonst waere die halbe Karriere auf einmal faellig.
    """
    if not prev or not (prev.get("weapons") or prev.get("career")):
        return []
    cfg = cfg or default_config()
    found = []
    for oid, occ in OCCASIONS.items():
        c = cfg.get(oid) or {}
        if not c.get("enabled", occ.get("enabled")):
            continue
        metric = occ["metric"]
        kind = occ["kind"]
        if occ["scope"] == "career":
            pairs = [("", (prev.get("career") or {}).get(metric, 0) or 0,
                      (cur.get("career") or {}).get(metric, 0) or 0)]
        else:
            pw, cw = prev.get("weapons") or {}, cur.get("weapons") or {}
            pairs = [(name, (pw.get(name) or {}).get(metric, 0) or 0,
                      (vals.get(metric, 0) or 0))
                     for name, vals in sorted(cw.items())]
        for subject, p, v in pairs:
            if kind == "step":
                step = c.get("step", occ.get("step")) or 0
                hit = _steps_crossed(p, v, step)
                if hit:
                    found.append(_emit(oid, {**occ, **c}, subject,
                                       hit[-1], p))
            elif kind == "record":
                floor = c.get("min", occ.get("min")) or 0
                if v > p and v >= floor and p > 0:
                    found.append(_emit(oid, {**occ, **c}, subject, v, p))
            elif kind == "at":
                target = c.get("at", occ.get("at")) or 0
                if p < target <= v:
                    found.append(_emit(oid, {**occ, **c}, subject,
                                       target, p))
    # Die lauteste zuerst — wer mehrere offen hat, sieht das Grosse.
    order = {"huge": 0, "big": 1, "small": 2}
    found.sort(key=lambda m: (order.get(m["tier"], 3), -float(m["value"])))
    return found
