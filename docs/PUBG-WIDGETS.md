# PUBG Stats Widget-Set

Alle Widgets, deren URL-Parameter und empfohlene OBS-Browser-Source-Größen für ein **1920×1080** Stream-Setup.

---

## Schnellstart

```bash
# 1. PUBG-API-Key in .secrets eintragen
echo "PUBG API Key: <dein-key>" >> .secrets

# 2. DB initialisieren + Cold-Start (zieht ~30 Matches)
python serve.py --init-pubg-db
python serve.py --pubg-cold-start

# 3. Server starten — läuft als Daemon
python serve.py 8080
# (oder als systemd-User-Service: docs/pubg-systemd.service.example)

# 4. Status prüfen
curl http://localhost:8080/api/pubg/status

# 5. Demo-Übersicht aller Widgets im Browser
http://localhost:8080/widgets/pubg/index.html
```

Alle Widget-URLs sind unter `http://localhost:<port>/widgets/pubg/<datei>.html`.

---

## Widget-Übersicht

| Widget | OBS-Größe | Use-Case |
|---|---|---|
| `live-bar.html` | **1920×40** (full-width) oder **820×40** | Slim-Counter, Gameplay-Overlay oben/unten |
| `news-ticker.html` | **1920×40** (full-width) | Bottom-Bar mit rotierenden Snippets |
| `flyout-full.html` | **520×850** | Großes Detail-Panel, Hotkey-Toggle in Gameplay |
| `post-match-card.html` | **500×400** | 10s-Pop-up nach Match-Ende (Gameplay) |
| `mates-today.html` | siehe unten | "Heute gespielt mit X" |
| `top-mates.html` | **400×420** | Top-5-Liste mit Detail-Zeilen (Lifetime) |
| `career-card.html` | **400×300** | Lifetime-Stats für Starting-Soon |
| `chicken-map.html` | **430×560** | CHICKEN Wins pro Map |
| `chicken-together.html` | **430×500** | CHICKEN mit welchen Mates |
| `map-distribution.html` | **310×420** | Map-Häufigkeits-Bars |
| `first-fight.html` | **300×260** | Survival-% mit Sparkline |
| `session-summary.html` | **800×620** | Vollformat Stream-Ending |
| `squad-compare.html` | **640×400** (variabel) | 4er-Vergleichstabelle |
| `chat-stats-popup.html` | **540×320** | Streamer.bot-driven Pop-up |

**Web-View** (kein OBS): `http://localhost:8080/scenes/stats.html?player=NAME`

---

## URL-Parameter pro Widget

### `live-bar.html`

| Param | Default | Wirkung |
|---|---|---|
| `refreshMs` | `30000` | Polling-Intervall in ms |

Empfohlen: **1920×40**, Position oben oder unten am Canvas.

### `news-ticker.html`

| Param | Default | Wirkung |
|---|---|---|
| `rotateMs` | `8000` | Snippet-Wechselrate in ms |

Empfohlen: **1920×40**, ganz unten als Marquee. Rotiert: Session-Stats, Top-Mate, beliebteste Map, Career, First-Fight-Rate.

### `flyout-full.html`

| Param | Default | Wirkung |
|---|---|---|
| `filter` | `1` | `0` = Filter-Slider versteckt (für BRB/In-Game ohne Interaktion) |
| `compact` | `0` | `1` = kleinere Card (360px statt 480px), kleinere Schrift |
| `hideMates` | `0` | Top-Mates-Section weglassen |
| `hideSurvival` | `0` | Boosts/Heals/Distance-Section weglassen |
| `hideFF` | `0` | First-Fight-Section weglassen |

Slider und Sort-Dropdown sind interaktiv (OBS → Rechtsklick → "Interagieren"). Werte werden in der DB persistiert (`minMatchesForTopMates`, `topMatesSortBy`) und gelten **global** für alle Mate-Widgets.

Empfohlene Größen je Variante:
- **Full** (Default, mit Filter): **520×850** — als zweite Browser-Source mit Hotkey-Toggle in OBS
- **In-Game-Mid** (`?compact=1&filter=0&hideMates=1`): **400×580** — passt in eine Ecke
- **BRB-Compact** (`?compact=1`): **400×750** — kleines Detail-Panel auf BRB
- **Session-Only** (`?filter=0&hideMates=1`): **520×640** — nur Session-Stats + Survival

### `mates-today.html`

| Param | Default | Werte |
|---|---|---|
| `layout` | `carousel` | `carousel` / `stack` / `fold` / `mosaic` |
| `range` | `session` | `session` / `day` / `week` |
| `minMatches` | (Setting) | überschreibt globalen Slider |

Empfohlene Größen je Layout:
- `carousel`: **430×220** (eine Card im Spotlight, wechselt alle 6s)
- `stack`: **430×420** (alle Mates gestapelt)
- `fold`: **430×420** (sequentielles Reinfaden)
- `mosaic`: **640×280** (Tile-Grid 3-spaltig)

### `top-mates.html`

| Param | Default | Werte |
|---|---|---|
| `sortBy` | (Setting, sonst `mostPlayed`) | `synergy` / `mostPlayed` / `chickensTogether` / `kd` / `mateKd` / `winRate` / `avgPlace` |
| `limit` | `5` | beliebige Zahl |
| `minMatches` | (Setting, sonst `10`) | Filter, Mates mit < n shared games werden ausgeblendet |

Empfohlene Größe: **400×420**.

**Sortier-Empfehlungen:**
- `synergy` — Composite KDA × Win-Rate (Default für TOP-MATE-Stat)
- `mostPlayed` — deine treuesten Squad-Buddies
- `chickensTogether` — mit wem hast du am meisten Chicken Dinner

### `career-card.html`

| Param | Default | Wirkung |
|---|---|---|
| `player` | (self) | Anderer Player-Name möglich, falls dessen Lifetime in DB |
| `mode` | `all` | `all` / `squad-fpp` / `squad-tpp` / `duo-fpp` / ... |

Empfohlen: **400×300**. Gut für Starting-Soon-Szene oben rechts.

### `chicken-map.html`

| Param | Default | Wirkung |
|---|---|---|
| `range` | `all` | `session` / `day` / `week` / `all` (alle DB-Matches) |

Empfohlen: **430×560**. Footnote weist auf API-Limit hin (zählt ab Setup).

### `chicken-together.html`

| Param | Default | Wirkung |
|---|---|---|
| `minWins` | `1` | nur Mates mit ≥n gemeinsamen Wins |

Empfohlen: **430×500**. Footnote ehrlich über API-Limit.

### `map-distribution.html`

| Param | Default | Wirkung |
|---|---|---|
| `range` | `session` | `session` / `day` / `week` / `all` |

Empfohlen: **310×420**.

### `first-fight.html`

| Param | Default | Wirkung |
|---|---|---|
| `range` | `session` | `session` / `day` / `week` |

Empfohlen: **300×260**. Telemetry-basiert — braucht ein paar Polling-Ticks bis die Events verarbeitet sind.

### `session-summary.html`

Kein URL-Param. Vollformat-Card mit Session-Total + Survival-Stats + Distance + Maps + Mates.

Empfohlen: **800×620**. Optimal für die Stream-Ending-Szene zentriert.

### `squad-compare.html`

| Param | Default | Wirkung |
|---|---|---|
| `players` | (leer, zeigt Hinweis) | komma-getrennt: `players=PEX_LuCKoR,MateA,MateB,MateC` |
| `matches` | `5` | letzte n Matches |

Empfohlen: **640×400**. Höhe wächst mit Match-Anzahl.

### `chat-stats-popup.html`

| Param | Default | Wirkung |
|---|---|---|
| `player` | (required) | PUBG-Name oder Account-ID |
| `duration` | `12` | Auto-Hide nach n Sekunden, `0` = bleibt bis Source-Visibility=off |

Empfohlen: **540×320**. Streamer.bot triggert: setzt URL → Source einblenden → 12s warten → ausblenden.

### `scenes/stats.html` (Web-View, kein OBS)

| Param | Default | Wirkung |
|---|---|---|
| `player` | (required) | Cross-Player-Detail-Page |

Im Browser öffnen, **nicht** als Browser-Source. Layout responsiv.

---

## Beispiel-Layouts

### Gameplay-Szene (1920×1080)

```
┌──────────────────── live-bar.html (1920×40) ─────────────────────┐
│                                                                   │
│                                                                   │
│                                       ┌─ flyout-full ──────────┐ │
│                                       │ (520×850, Hotkey-Tog.)  │ │
│                                       └─────────────────────────┘ │
│                                                                   │
│        ┌─ post-match-card (500×400) ─┐                            │
│        │ (mittig, nur bei Match-End) │                            │
│        └─────────────────────────────┘                            │
│                                                                   │
├──────────────────── news-ticker.html (1920×40) ───────────────────┤
└───────────────────────────────────────────────────────────────────┘
```

### BRB / Pause-Szene

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌─ chicken-map ──┐  ┌─ chicken-together ─┐  ┌─ top-mates ────┐ │
│  │  430×560       │  │   430×500          │  │   400×420       │ │
│  │  CHICKEN pro Map    │  │   CHICKEN mit Mates     │  │  Top-5 Synergy  │ │
│  └────────────────┘  └────────────────────┘  └─────────────────┘ │
│                                                                  │
│  ┌─ mates-today.html?layout=mosaic ─ (640×280) ─────────────┐    │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                  │
│  (vorhandener brb-pause Clip-Player darunter)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Starting-Soon-Szene

```
┌─────────────────────────────────────────────────────────────────┐
│                                          ┌─ career-card ──────┐ │
│                                          │ 400×300            │ │
│                                          │ 16k Matches        │ │
│                                          │ 885 Wins · K/D 1.5 │ │
│                                          └────────────────────┘ │
│                                                                  │
│              (animierter "Starting Soon"-Titel)                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Stream-Ending-Szene

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│              ┌─── session-summary.html (800×620) ────┐           │
│              │   Vollformat-Übersicht der Session    │           │
│              │   (Kills, Wins, Boosts, Heals,        │           │
│              │    Distance, Maps, Mates)             │           │
│              └────────────────────────────────────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Streamer.bot Setup für `!mypubgstats`

```
Trigger: Twitch Chat Command "!mypubgstats"
Action 1: $pubgName = Argument-1 (oder gespeichertes Mapping)
Action 2: OBS Browser-Source URL setzen:
          http://localhost:8080/widgets/pubg/chat-stats-popup.html?player={pubgName}
Action 3: Source einblenden
Action 4: 12 Sek warten
Action 5: Source ausblenden
```

Browser-Source einmal als 540×320 anlegen, dann via Streamer.bot URL pro Trigger setzen.

---

## Settings (persistent in SQLite)

Globale Settings, die alle Widgets respektieren — gesetzt via `flyout-full`-Slider oder direkt:

```bash
# Aktuelle Settings ansehen
curl http://localhost:8080/api/pubg/settings

# Setting setzen
curl -X POST http://localhost:8080/api/pubg/settings \
  -H "Content-Type: application/json" \
  -d '{"key":"minMatchesForTopMates","value":"15"}'
```

| Setting | Default | Wirkung |
|---|---|---|
| `minMatchesForTopMates` | `10` | Schwellwert für Top-Mates und Mates-Today |
| `topMatesSortBy` | `mostPlayed` | Default-Sort, gilt auch für News-Ticker |
| `sessionStartedAt` | (auto) | manueller Session-Reset, sonst auto-detect |
| `sessionGapHours` | `4` | Lücke zwischen Matches die neue Session signalisiert |

---

## Session-Logik

**Auto-Detection** (Default): Der Backend findet den Session-Start automatisch — er sucht in den letzten 200 Matches die erste Lücke > 4h zwischen aufeinanderfolgenden Matches. Alle Matches nach dieser Lücke gehören zur aktuellen Session.

**Manueller Reset** (für Stream-Start): überstimmt Auto-Detection.

```bash
# Session-Reset = jetzt
curl -X POST http://localhost:8080/api/pubg/session/reset
```

In Streamer.bot oder per OBS-Hotkey vor jedem Stream einmalig ausführen.

---

## Status-Endpoint

```bash
curl http://localhost:8080/api/pubg/status
```

```json
{
  "polling": "ok|degraded|error",
  "lastPollAt": "2026-05-04T12:33:30Z",
  "errors": [],
  "newMatches": 5,
  "lifetimeRefreshed": 1,
  "telemetryProcessed": 3,
  "rateLimitRemaining": 4
}
```

`rateLimitRemaining` = wie viele API-Requests im aktuellen Minutenfenster noch frei sind. Default-Tier: 10/min.

---

## Map-Code-Mapping

Die PUBG-API liefert interne Codenamen — alle Widgets übersetzen automatisch:

| API-Code | Echter Name |
|---|---|
| `Erangel_Main` / `Baltic_Main` | Erangel |
| `Desert_Main` | Miramar |
| `Savage_Main` | Sanhok |
| `DihorOtok_Main` | Vikendi |
| `Tiger_Main` | Taego |
| `Kiki_Main` | Deston |
| `Neon_Main` | Rondo |
| `Heaven_Main` | Haven |
| `Summerland_Main` | Karakin |
| `Chimera_Main` | Paramo |
| `Range_Main` | Camp Jackal (Training) |

---

## API-Endpoints (für Custom-Widgets)

Alle JSON, alle GET wenn nicht anders vermerkt, alle nur auf `127.0.0.1`:

```
GET  /api/pubg/session
GET  /api/pubg/last-match
GET  /api/pubg/status
POST /api/pubg/session/reset
GET  /api/pubg/top-mates?sortBy=&limit=&minMatches=
GET  /api/pubg/co-player/{nameOrAccountId}
GET  /api/pubg/career-lifetime?player=&mode=all|squad-fpp|...
GET  /api/pubg/mates-today?range=&minMatches=
GET  /api/pubg/map-distribution?range=
GET  /api/pubg/first-fight-rate?range=
GET  /api/pubg/squad-compare?players=A,B,C&matches=5
GET  /api/pubg/chickens-together?minWins=1
GET  /api/pubg/settings
POST /api/pubg/settings    {key, value}
GET  /api/pubg/stamm-crew
POST /api/pubg/stamm-crew   {add: "Name"}
DELETE /api/pubg/stamm-crew {remove: "Name"}
```

In-Memory-Cache: 30s TTL für Heavy-Endpoints, Top-Mates über alle Sort/Filter-Varianten konsistent.

---

## Performance-Hinweise

- **Polling**: 60s Tick, max 5 Match-Details pro Tick (Rate-Limit-Schutz)
- **Cold-Start**: ~30 Matches in ~6 Min eingelesen (5/min Cap)
- **DB-Größe**: ~10-30 KB pro Match (Header + Squad + gefilterte Telemetry) → ~70 MB/Jahr
- **Browser-Sources**: poll alle 30-60s, Cache reduziert DB-Last

Bei langsamen API-Antworten (`rateLimitRemaining` regelmäßig nahe 0): Higher-Tier-Key unter [developer.pubg.com](https://developer.pubg.com) beantragen (bis 60+ RPM).
