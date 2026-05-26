# Landing Spots Tool — Design Spec
Date: 2026-05-27

## Übersicht

Browser-Tool (`tools/landing-spots.html`) das pro Karte zeigt, wo Spieler landen.
Heatmap-Darstellung + POI-Liste mit Flugrouten-Filter.
Auswertbar nach einzelnem Spieler, Team-Kombination oder Squad-Konstellation.
Optimiert für 1920×1080 (auch als OBS-Fullscreen nutzbar).

---

## Datenquellen (bereits vorhanden)

- `telemetry_events` WHERE `event_type = 'LogParachuteLanding'` → `actor_account`, `actor_x`, `actor_y`, `match_id`
- `pubg-pois.json` → POI-Polygone pro Karte
- `matches` + `match_team_mapping` → wer war in welchem Match zusammen im Squad
- `players` → Namen für Autocomplete

---

## Neue Endpoints

**`GET /api/pubg/landing-heatmap?map=Baltic_Main&p0=acc1&p1=acc2&p2=acc3&p3=acc4&routeFilter=1`**

Parameter:
- `map` — Kartenname (z.B. `Baltic_Main`)
- `p0`–`p3` — Account-IDs der gewünschten Spieler (leer = beliebig)
- `routeFilter=1` — nur Matches einbeziehen wo die Flugroute ≤1,5km Querdistanz zum jeweiligen Landing-POI hatte

Response:
```json
{
  "pois": [
    {
      "name": "Pochinki",
      "cx": 0.48, "cy": 0.52,
      "total": 14,
      "byPlayer": {
        "acc1": { "name": "LuCKoR",  "count": 8, "pct": 57 },
        "acc2": { "name": "Mate1",   "count": 4, "pct": 29 },
        "acc3": { "name": "Mate2",   "count": 2, "pct": 14 }
      }
    }
  ],
  "scatterPoints": [
    { "accountId": "acc1", "x": 0.481, "y": 0.519, "matchId": "..." }
  ],
  "totalMatches": 28
}
```

**`GET /api/pubg/player-search?q=LuCK`**

Autocomplete aus `players`-Tabelle, liefert `[{accountId, name}]`.

---

## Flugrouten-Filter

PUBG-Telemetrie enthält frühe `LogPlayerPosition`-Events vor dem Landing — daraus
lässt sich die Flugzeug-Trajektorie rekonstruieren (Start- und Endpunkt der Route).

Berechnung Querdistanz POI → Flugroute:
```
d = |((B-A) × (A-P))| / |B-A|
```
wobei A/B = Start/End der Flugroute (normalisierte Coords), P = POI-Zentrum.

Matches werden nur einbezogen wenn `d ≤ 1500m` (= 0.1875 auf 8km-Karten).

Fallback: wenn Flugroute nicht rekonstruierbar → Match trotzdem einbeziehen,
aber in Response als `routeUnknown: true` markieren.

---

## Frontend-Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ [Karte ▼]  [P1: LuCKoR____] [P2: Mate1_____] [P3: ___] [P4: __]│
│            [x] Flugrouten-Filter (≤1,5km)         28 Matches   │
├────────────────────────────────┬────────────────────────────────┤
│  KARTE + HEATMAP               │  POI-LISTE                     │
│  ~1100px                       │  ~480px                        │
│                                │                                │
│  [Kartenbild]                  │  Pochinki      14×  ████████   │
│  + Heatmap-Blobs pro POI       │    LuCKoR  8×  ██████          │
│  + Scatter-Dots (wenn Player   │    Mate1   4×  ████            │
│    in Sidebar angeklickt)      │    Mate2   2×  ██              │
│                                │                                │
│  ── Player-Leiste (unten) ──   │  School         7×  █████      │
│  [● LuCKoR] [● Mate1] [● M2]  │    LuCKoR  5×  ████           │
│                                │    Mate1   2×  ██              │
└────────────────────────────────┴────────────────────────────────┘
```

**Player-Leiste** (unter der Karte):
- Pro gefiltertem Spieler ein farbiger Button
- Klick → Scatter-Dots dieses Spielers erscheinen auf der Karte (in seiner Farbe)
- Mehrfachauswahl möglich

---

## Heatmap-Rendering

- Heatmap-Blob pro POI, Radius proportional zu `total`-Count, max ~80px
- Farbe: Gradient `rgba(242,183,5, 0.15)` (Gold) → `rgba(94,42,121, 0.7)` (Lila) je nach Intensität
- Intensität normalisiert: `count / maxCount` über alle POIs dieser Karte
- Kein Blob für POIs mit 0 Landings
- POI-Name als Label zentriert über Blob (nur sichtbar wenn count > 0)

**Scatter-Dots (per Player):**
- Kleiner Punkt (4px) in Spielerfarbe an exakter Landing-Koordinate
- Erscheinen zusätzlich zur Heatmap wenn Spieler in der Player-Leiste aktiv

---

## POI-Liste

- Sortiert nach `total` DESC
- Pro POI: Name, Gesamtcount, Balken-Visualisierung
- Darunter per-Player aufgeklappt: Name, Count, Prozentzahl
- Hover über POI → entsprechender Blob auf Karte gepulst hervorgehoben
- Hover über Karte-Blob → POI in Liste scrollt in Sicht

---

## Spieler-Filter (Autocomplete)

- 4 Input-Felder nebeneinander in der Header-Leiste
- Tippen startet Suche gegen `/api/pubg/player-search?q=...`
- Dropdown mit Vorschlägen, Klick übernimmt Account-ID
- Leeres Feld = beliebiger Spieler (Squad-Fill zählt mit)
- Beim Ändern der Filter: neuer Fetch gegen `landing-heatmap`

**Konstellations-Logik im Backend:**
Matches werden nur einbezogen wenn alle angegebenen Spieler im selben Match
UND im selben Squad waren. Leere Felder stellen keine Bedingung.

---

## Karten-Selector

- Dropdown: alle Maps die in der DB vorhanden sind (dynamisch aus `matches`-Tabelle)
- Beim Wechsel: Kartenbilder aus `widgets/pubg/maps/<MapName>.png`
- POI-Definitionen aus `pubg-pois.json` (nach `mapName` gefiltert)

---

## Datei-Layout

```
tools/landing-spots.html         ← neues Tool
pubg/endpoints.py                ← _landing_heatmap(), _player_search() Methoden
```

Kein neues Python-Modul nötig — die Aggregations-Logik ist überschaubar
und landet direkt in `endpoints.py` als private Methoden.

---

## Offene Punkte

- Flugrouten-Rekonstruktion aus `LogPlayerPosition`: muss validiert werden ob
  diese Events für alle Matches in ausreichender Dichte vorhanden sind
- POI-Polygon-Matching: Landing-Koordinate → POI-Name via Point-in-Polygon
  (bereits in `_pubg_pois.js` vorhanden → Python-Port nötig)
- Karten-Größen-Tabelle (World-Units → km) für Querdistanz-Berechnung:
  Erangel/Miramar 8km, Sanhok 4km, Karakin 2km, etc.
