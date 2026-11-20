"""Car Race Garage: Fahrzeugklassen, Preise, Coins-Regeln, Autosuche und Sub-Lackierungen.

Klassen je Katalog-Schlüssel (Rundenpace aus der abgesegneten Wertetabelle in js/car-race-stats.js,
vor allem Kurven-g, Beschleunigung und Leistung; Marke allein entscheidet nicht):

- f1     (6000): W14 – einziges Formel-Auto (4 g Kurvenhaftung, 1000 PS).
- race   (3500): Rennwagen mit Kurven-g ≥ 1,4: 917K, 296 GT3 (beide), 992 GT3 R, A4 DTM, GT-RSR 991.
- super  (2000): Kurven-g ≥ 1,1 oder ≥ 600 PS bei ≤ 3,4 s (Supersportwagen): LaFerrari, SF90 (beide), 849,
                 488 Pista, Monza SP2, Roma, GTC4 Lusso, Countach LPI, Gemera, 918, 911 Turbo S (beide),
                 911 GT3 / GT3 Touring / GT3 RS.
- sport  (900):  Sportwagen 250–320 km/h, um 0,95–1,05 g (RS6/RS5, M3 G80/E92, 911 Carrera S/996/964/930,
                 Shelby GT500, Corvette Grand Sport, A45, Evo IX, RWB, G63) – dazu die alten Supersportler
                 Diablo SV, Testarossa 1988 und 550 Barchetta: nach Pace (≤ 0,95 g, 4–6 s) keine 2000er.
- sedan  (400):  Limousinen/Kombis/Sportlimousinen 180–250 PS-Klasse (A4, E39, M3 E30, M5 E28, 190E Evo,
                 500TE, Passat, Golf R32/GTI Mk7, 2002 Turbo, '67 Mustang).
- small  (150):  Kleinwagen/Oldies ≤ 140 PS bzw. ≥ 7,9 s (Golf GTI 1976/1992, Gol, New Beetle, 190E 1984,
                 Mustang 1965).
- fun    (250):  Spaß-Fahrzeuge (Bus, Ural, CT680, Krabby Patty, Classic Crasher).

Unbekannte Schlüssel (neu aufbereitete Autos) fallen auf Namens-Regex zurück, angelehnt an die
Klassen in js/car-race-stats.js (fun/bus/truck → fun, hyper → f1 bzw. race, suv → sport).
"""
import difflib
import math
import re

from fx.duck_viewers import norm

PRICES = {"small": 150, "sedan": 400, "sport": 900, "super": 2000, "race": 3500, "f1": 6000, "fun": 250}
LABELS = {"small": "Small/Classic", "sedan": "Sedan", "sport": "Sports car", "super": "Supercar",
          "race": "Race car", "f1": "F1", "fun": "Fun"}

_KEYS = {
    "f1": ["amg-w14-s1"],
    "race": ["porsche-917k-lm-red", "ferrari-296-gt3", "ferrari-296-gt3-verstappen", "2024-porsche-992-gt3-r",
             "audi-a4-r9-dtm-a", "2017-porsche-gt-rsr-991-duke"],
    "super": ["2025-koenigsegg-gemera", "ferrari-laferrari", "2022-lamborghini-countach-lp", "porsche-918-free",
              "2021-ferrari-sf90-spider", "ferrari-488-pista-widebody", "2026-ferrari-849-testarossa",
              "2023-ferrari-sf90-xx-stradal", "2021-porsche-911-turbo-s-992", "porsche-911-turbo-s",
              "ferrari-gtc4-lusso", "2020-ferrari-roma", "porsche-911-gt3-2", "2022-porsche-911-gt3-touring",
              "2023-porsche-911-gt3-rs-2-7", "2019-ferrari-monza-sp2"],
    "sport": ["1995-lamborghini-diablo-sv", "2020-abt-sportline-audi-rs6", "2015-porsche-911-carrera-s",
              "2020-audi-rs-6-avant", "2024-audi-rs6-avant-gt", "porsche-911-turbo-996-2000-b",
              "ferrari-550-barchetta-2000-a", "ford-mustang-shelby-gt500", "1962-chevrolet-corvette-gran",
              "bmw-m3-competition", "bmw-m2-competition-f87", "1992-porsche-911-964-turbo-s", "1988-ferrari-testarossa", "2020-audi-rs5-coup",
              "mercedes-benz-a45-amg-2018", "porsche-911-rauh-welt-free", "1982-porsche-930-911-turbo-3",
              "free-1975-porsche-911-930-tu", "2010-bmw-m3-e92", "mitsubishi-lancer-evo-ix", "mersedes-benz-g63-amg"],
    "sedan": ["1990-mercedes-benz-190e-2-5", "mercedes-benz-500te-w126-est", "vw-golf-gti-mk7",
              "2002-volkswagen-golf-r32-mk4", "1988-bmw-m5-e28", "audi-a4-b8", "audi-a4-l40-tfsi", "bmw-e39-free",
              "1990-bmw-m3-sport-evolution", "mercedes-190e-evo-1982-3d-mo", "audi-a4-b5-5-avant", "2000-volkswagen-passat-varia",
              "1973-bmw-2002-turbo", "67-mustang-high-poly"],
    "small": ["1992-volkswagen-golf-gti", "1999-volkswagen-gol-2000-gti", "1998-volkswagen-new-beetle",
              "1984-mercedes-190e", "volkswagen-golf-gti-1976", "ford-mustang-1965"],
    "fun": ["classic-crasher-c170-dominat", "caterpillar-ct680", "krabby-patty-wagon", "ural-4320-soviet-army-truck",
            "trolza-5265-00-megapolis"],
}
CLASS_OF_KEY = {k: c for c, keys in _KEYS.items() for k in keys}

# Rückfall für Schlüssel ohne Eintrag; Reihenfolge zählt (erste passende Klasse gewinnt)
_FALLBACK = [
    ("fun", re.compile(r"krabby|hoonicorn|crasher|\bbus\b|trolza|megapolis|\bpaz\b|\bliaz\b|truck|\bural\b|"
                       r"caterpillar|kamaz|\bman\b|scania|\bzil\b|\bmaz\b", re.I)),
    ("f1", re.compile(r"\bw1\d\b|\bformula\b|\bf1\b", re.I)),
    ("race", re.compile(r"\b91[78]k\b|gt3[ -]?r\b|\bgt3\b(?!.*\b(rs|touring)\b)|\bdtm\b|\brsr\b|\bgte\b|le ?mans", re.I)),
    ("super", re.compile(r"supercar|lamborghini|ferrari|koenigsegg|bugatti|mclaren|aventador|huracan|pagani|\b918\b",
                         re.I)),
    ("sport", re.compile(r"\bsport\b|\bm[2-8]\b|\brs\s?\d*\b|\bamg\b|porsche|mustang|shelby|corvette|\bevo\b|"
                         r"\bgt-?r\b|\bsupra\b|\bg\s?-?63\b", re.I)),
    ("small", re.compile(r"\bgolf\b|\bpolo\b|\bmini\b|\bfiat\b|\b2cv\b|\bsmart\b|\bbeetle\b|\bkäfer\b", re.I)),
]

# Coins je gewertetem Rennen (nur echte Fahrer)
COIN_START = 10
COIN_PLACE = {1: 30, 2: 20, 3: 10}
COIN_FINISH = 5
SUB_MULT = {0: 1.0, 1000: 1.25, 2000: 1.5, 3000: 2.0}

# Sub-Lackierungen (feste Farbsets, Overlay setzt sie um; Task G3)
PAINTS = {"gold": "Gold", "purple": "Purple", "carbon": "Carbon"}


def class_of(key, entry=None) -> str:
    if key in CLASS_OF_KEY:
        return CLASS_OF_KEY[key]
    s = " ".join(str((entry or {}).get(f) or "") for f in ("name", "brand")) + " " + (key or "")
    for cls, rx in _FALLBACK:
        if rx.search(s):
            return cls
    return "sedan"


def price(key, entry=None) -> int:
    return PRICES[class_of(key, entry)]


def tier(sub, tier_raw) -> int:
    """Sub-Tier aus Streamer.bot (sub=%isSubscribed%, tier=%subscriptionTier%): 0 = kein Sub."""
    if (sub or "").strip().lower() not in ("true", "1", "yes"):
        return 0
    t = (tier_raw or "").strip().lower().replace("tier", "").strip()
    t = {"1": "1000", "2": "2000", "3": "3000", "prime": "1000"}.get(t, t)
    return int(t) if t in ("1000", "2000", "3000") else 1000


def coins(place, sub=0) -> int:
    """Coins eines echten Fahrers; place None = DNF (nur Teilnahme)."""
    base = COIN_START
    if place is not None:
        base += COIN_PLACE.get(place, 0) + COIN_FINISH
    return int(math.floor(base * SUB_MULT.get(sub, 1.0) + 0.5))


def clean_name(name) -> str:
    """Katalogname fürs Chat-Echo: Quellenvermerke und FREE-Marker entfernen."""
    n = re.sub(r"\|?\s*www\.vecarz\.com", "", name or "", flags=re.I)
    n = re.sub(r"\[\s*FREE\s*\]", "", n, flags=re.I)
    n = re.sub(r"^\s*FREE\s+", "", n, flags=re.I)
    return re.sub(r"\s+", " ", n).strip(" |-") or "?"


def car_name(catalog, key) -> str:
    for c in catalog or []:
        if c.get("key") == key:
            return clean_name(c.get("name") or key)
    return "?"


def _names(entry):
    n = clean_name(entry.get("name") or entry.get("key"))
    short = re.sub(r"^\d{4}\s*-?\s*", "", n)
    brand = entry.get("brand") or ""
    model = re.sub(r"^" + re.escape(brand) + r"\s*", "", short, flags=re.I) if brand else short
    raw = [entry.get("key") or "", n, short, model]
    return list(dict.fromkeys(x for x in (norm(s) for s in raw) if x))


def find_car(query, catalog):
    """(Katalog-Eintrag, []) bei eindeutigem Treffer, sonst (None, Vorschläge) – Muster wie !outfit."""
    n = norm(query)
    if not n:
        return None, []
    items = [(c, _names(c)) for c in catalog or [] if c.get("key")]
    exact = [c for c, names in items if n in names]
    if exact:
        return exact[0], []
    if len(n) >= 2:
        for test in (lambda x: x.startswith(n), lambda x: n in x):
            hit = [c for c, names in items if any(test(x) for x in names)]
            if len(hit) == 1:
                return hit[0], []
            if hit:
                return None, hit[:4]
    by_name = {}
    for c, names in items:
        for x in names:
            by_name.setdefault(x, c)
    out = []
    for x in difflib.get_close_matches(n, list(by_name), n=6, cutoff=0.6):
        if by_name[x] not in out:
            out.append(by_name[x])
    return None, out[:4]


def find_name(query, names):
    """Unscharfe Namenssuche (z. B. Anrempeln): (Index, []) bei eindeutigem Treffer, sonst (None, Vorschläge als Indizes)."""
    n = norm(query)
    if not n:
        return None, []
    items = [(i, norm(x)) for i, x in enumerate(names)]
    exact = [i for i, x in items if x == n]
    if len(exact) == 1:
        return exact[0], []
    for test in (lambda x: x.startswith(n), lambda x: n in x):
        hit = [i for i, x in items if x and test(x)]
        if len(hit) == 1:
            return hit[0], []
        if hit:
            return None, hit[:4]
    by = {x: i for i, x in items if x}
    close = [by[x] for x in difflib.get_close_matches(n, list(by), n=3, cutoff=0.7)]
    return (close[0], []) if len(close) == 1 else (None, close)


def find_paint(query):
    """Sub-Lackierung: Set-ID, "off" zum Zurücksetzen, None wenn unbekannt."""
    n = norm(query)
    if n in ("off", "none", "reset", "default"):
        return "off"
    for k, label in PAINTS.items():
        if n in (k, norm(label)) or (len(n) >= 2 and k.startswith(n)):
            return k
    return None
