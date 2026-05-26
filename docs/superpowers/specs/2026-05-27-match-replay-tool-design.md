# Match Replay Tool — Design Spec
Date: 2026-05-27

## Übersicht

Browser-Tool (`tools/match-replay.html`) das einen PUBG-Match als animierten Replay
auf der Karte darstellt — alle Teams, alle Spieler, Bullet Streaks, Kill/Knock-Marker.
Öffnet im Browser-Tab, optimiert für 1920×1080.

---

## Datenfluss

### Neue Endpoints

**`GET /api/pubg/match-replay?match=MATCH_ID`**

Backend-Ablauf:
1. `match_team_mapping` → alle Teilnehmer mit `team_id`
2. `players` → Namen aller Teilnehmer
3. Telemetrie-Blob laden: payload_json aus `telemetry_events` (falls vorhanden), sonst HiDrive-Download
4. Python verarbeitet alle relevanten Events, normalisiert Koordinaten auf 0–1 (World-Units ÷ Map-Size)
5. Ergebnis in Server-Session-Cache (Match-ID als Key, TTL solange Server läuft)

Response-Struktur:
```json
{
  "matchId": "...",
  "mapName": "Baltic_Main",
  "durationMs": 1800000,
  "teams": [
    { "teamId": 1, "color": "#e63946", "players": [
        { "accountId": "...", "name": "LuCKoR" }
    ]}
  ],
  "events": [
    { "type": "landing",  "ts": 12000, "actorId": "...", "x": 0.42, "y": 0.31 },
    { "type": "position", "ts": 15000, "actorId": "...", "x": 0.43, "y": 0.32 },
    { "type": "hit",      "ts": 90000, "actorId": "...", "targetId": "...",
      "ax": 0.44, "ay": 0.33, "tx": 0.45, "ty": 0.34, "weapon": "AKM", "distance": 87 },
    { "type": "knock",    "ts": 91000, "actorId": "...", "targetId": "...",
      "ax": 0.44, "ay": 0.33, "tx": 0.45, "ty": 0.34, "weapon": "AKM", "distance": 87 },
    { "type": "kill",     "ts": 95000, "actorId": "...", "targetId": "...",
      "ax": 0.44, "ay": 0.33, "tx": 0.45, "ty": 0.34, "weapon": "AKM", "distance": 87 },
    { "type": "death",    "ts": 95000, "actorId": "..." }
  ]
}
```

Event-Typen die aus dem Telemetrie-Blob extrahiert werden:
- `LogParachuteLanding` → `landing` (auch Respawns: zweites Landing nach Death)
- `LogPlayerPosition` → `position` (Keyframes, gefiltert auf ~1s Intervall pro Spieler)
- `LogPlayerTakeDamage` → `hit` (jeder Treffer = ein Bullet Streak)
- `LogPlayerMakeGroggy` → `knock`
- `LogPlayerKillV2` → `kill`

**`GET /api/pubg/matches-list?limit=50`**

Liefert die letzten N Matches als Dropdown-Quelle:
```json
[{ "matchId": "...", "playedAt": "2026-05-26T...", "mapName": "Baltic_Main", "place": 3, "kills": 4 }]
```

---

## Frontend-Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ [Match Dropdown ▼]                                              │
├──────────────┬──────────────────────────────────────────────────┤
│ SIDEBAR      │  CANVAS                                          │
│ 300px        │  flex: 1                                         │
│              │                                                  │
│ Team 1 ████  │  [Karte + Pins + Marker + Streaks]               │
│   LuCKoR     │                                                  │
│   Mate1      │                                                  │
│ Team 2 ████  │                                                  │
│   ...        │                                                  │
│              │                                                  │
│ ── Toggles ──│                                                  │
│ [x] Kills    │                                                  │
│ [x] Knocks   │                                                  │
│ [x] Streaks  │                                                  │
│              │                                                  │
├──────────────┴──────────────────────────────────────────────────┤
│ |◄  ►|  [━━━━━━━●───────────────]  0:45 / 28:32  [1× ▼]       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Canvas-Rendering

**Spieler-Pins:**
- Kreis in Teamfarbe + Teamnummer als Label
- Fokussiertes Team (Klick in Sidebar): volle Sättigung + Namens-Badge am Pin
- Andere Teams: grau (#aaa), nur Teamnummer
- Namens-Badge-Größe: `fontSize = clamp(8, 12 / zoomLevel, 12)` — schrumpft beim Zoomen

**Kill-Marker:**
- **×** in Teamfarbe des Killers, Größe 10px, bleibt permanent
- Knock-Marker: kleineres **×** (6px), halbe Opazität

**Bullet Streaks:**
- Linie von `(ax, ay)` nach `(tx, ty)` in Teamfarbe des Schützen, 1px, Opazität 0.7
- Entstehen zum `hit`-Timestamp
- Fade-out über 200ms nach Entstehen

**Zoom/Pan:**
- Scrollwheel: zoom (0.5× – 20×)
- Mouse-drag: pan
- Pinch-to-zoom auf Touch

**Tooltips (Hover):**
- Pin: `Team 1 · LuCKoR · 4 Kills · 2 Knocks`
- Kill-×: `killed by LuCKoR · AKM · 87m`
- Knock-×: `knocked by LuCKoR · AKM · 87m`

---

## Replay-Controls

- **Play/Pause** Button
- **Timeline-Scrubber** — zieht über Match-Dauer, zeigt aktuelle Zeit
- **Speed-Selector:** 0.5× / 1× / 2× / 4× / 8×
- Uhr zeigt `MM:SS / MM:SS`
- Beim Scrubben: Pause → Spieler-Positionen interpoliert neu berechnet

---

## Sidebar — Team/Spieler-Liste

- Jedes Team: farbiger Block mit Teamnummer + Spielernamen
- Klick auf Team oder Spieler → Fokus auf dieses Team
- Fokus bleibt bis anderer Klick oder "Alle zeigen"-Button
- URL-Parameter `?match=MATCH_ID` öffnet direkt dieses Match im Dropdown

---

## Session-Cache

- Key: `match_id`
- Value: fertig verarbeitetes Response-Dict (in-memory, Python-Dict im Server-Prozess)
- Kein Ablauf — bleibt bis Server-Neustart
- Bei erneutem Aufruf derselben Match-ID: sofortige Antwort aus Cache, kein HiDrive-Fetch

---

## Datei-Layout

```
tools/match-replay.html          ← neues Tool
pubg/endpoints.py                ← _match_replay(), _matches_list() Methoden
pubg/replay_builder.py           ← neues Modul: Telemetrie-Blob → strukturierte Events
```

`replay_builder.py` isoliert die Parsing-Logik (leichter testbar):
- `build_replay(raw_telemetry_bytes, match_meta, participants) → dict`
- `normalize_coords(x, y, map_name) → (float, float)`
- `extract_team_colors(team_ids) → {team_id: hex_color}`

---

## Offene Punkte

- `LogPlayerPosition`-Events: Intervall-Filter (1s) nötig um Response-Größe zu begrenzen
- HiDrive-Fallback: wenn weder payload_json noch HiDrive → Fehlermeldung im Tool
- Teamfarben: 25 distinkten Farben-Palette definieren (alle Teams eines Matches unterscheidbar)
- Respawn-Detection: zweites `LogParachuteLanding` für denselben `actorId` nach einem `death`-Event → neuer Landing-Marker, Pin reaktiviert
