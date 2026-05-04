# PUBG Session Stats — Design

**Status:** Design (zur Review)
**Datum:** 2026-05-04
**Autor:** Brainstorming-Session (LuCKoR_HD + Claude)

## Ziel

Modulare PUBG-Stats-Komponenten als OBS-Browser-Sources, die in beliebigen Szenen (Gameplay, BRB, Starting-Soon, Stream-Ending, Just-Chatting) eingesetzt werden können. Daten kommen aus der offiziellen PUBG-Developer-API, persistiert in lokaler SQLite-DB, ausgeliefert über `serve.py`.

## Scope

### In Scope

- Live-Session-Stats (Kills, Damage, Wins, K/D, Headshot %, etc.)
- Match-by-Match-Tracking mit Map/Mode/Place/Squad-Members
- Co-Player-Tracking (Stats *deiner* Mates in *euren* gemeinsamen Matches)
- Co-Player-Career-Lifetime-Lookup ab ≥5 gemeinsamen Matches
- Map-Häufigkeits-Statistik
- First-Fight-Survival-Rate (Telemetry-basiert)
- Top-Mates-Ranking (sortierbar nach Avg Place / K/D / Win-Rate / Most Played)
- Cross-Player-View für beliebige Co-Player (`stats.html?player=...`)
- Career-Lifetime-Card für Starting-Soon
- Chat-Stats-Popup für Streamer.bot-Integration (parameter-driven HTML)
- 4 Layout-Varianten für Mates-Today: Stack, Fold, Carousel (Default), Mosaic — umschaltbar via URL-Param

### Out of Scope (für diesen Spec)

- Twitch-Chat-Integration in `serve.py` — Streamer.bot übernimmt das
- Memory-Reading des laufenden Spiels (Anti-Cheat-Risiko)
- OCR auf End-of-Match-Screens (fragil, kein Mehrwert gegenüber API)
- PUBG-Replay-Parsing (instabil, formatabhängig)
- Match-Leaderboard mit allen 60-100 Playern (on-demand möglich, aber kein eigenes Widget)
- Public-facing Web-Page (alles bindet auf `127.0.0.1`)
- Multi-Streamer-Support — nur ein Hauptaccount (`PEX_LuCKoR`/steam)

## Datenquelle: PUBG Developer API

**Endpoints:**
- `/players?filter[playerNames]=PEX_LuCKoR&filter[platforms]=steam` → Account-ID + bis zu 30 jüngste Match-IDs
- `/matches/{matchId}` → Roster (alle Teilnehmer), Stats pro Teilnehmer, Telemetry-URL
- `/matches/{matchId}/telemetry` (URL aus Match-Detail) → JSON-Stream aller In-Game-Events
- `/players/{accountId}/seasons/lifetime` → Career-Aggregate pro Mode

**Limits:**
- Player-Resource liefert max **30 Match-IDs**, Match-Detail bleibt **~14 Tage** abrufbar
- Rate-Limit: **10 Requests/Minute** (Default-Tier, kostenlos)
- API-Key kostenlos via `developer.pubg.com`
- Lifetime-Aggregate: alle Zeiten verfügbar, **keine** Match-Granularität
- Match-Daten erscheinen **5-10 Min verzögert** nach Match-Ende
- Filter `playerNames` ist **case-sensitive**

**Konsequenz:** Ohne lokale Persistenz sind Match-Details nach 14 Tagen unwiederbringlich weg. Daher Always-on-Polling und SQLite-Speicherung Pflicht.

## Architektur

```
┌──────────────────────────────────────────────────────────────┐
│  PUBG Developer API                                          │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTPS, API-Key, alle 60s, Rate-Limited
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  serve.py  (Always-on Service, 127.0.0.1)                    │
│  ├── Background-Polling-Thread                               │
│  ├── Telemetry-Parser (squad-gefiltert)                      │
│  ├── SQLite (data/pubg-history.db)                           │
│  ├── In-Memory-Cache (30s TTL für Heavy-Endpoints)           │
│  └── HTTP-Endpoints (/api/pubg/*)                            │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTP / fetch()
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  OBS Browser-Sources                                         │
│  widgets/pubg/*.html — autark, polled-driven                 │
│                                                              │
│  Streamer.bot triggert chat-stats-popup.html via OBS-URL-Set │
└──────────────────────────────────────────────────────────────┘
```

**Drei Schichten:**
1. **API-Layer** — Polling, Caching, Rate-Limit-Respekt
2. **Daten-Layer** — Persistenz, Aggregation, Settings
3. **Präsentations-Layer** — autonome HTML-Files

**Sicherheit:** Alle Endpoints binden auf `127.0.0.1`. Browser-Sources kennen niemals den API-Key. Wenn `/stats.html` jemals public werden soll → Reverse-Proxy + Auth, out-of-scope hier.

## Daten-Layer

### SQLite-Schema (`data/pubg-history.db`)

```sql
-- Players: du selbst + jeder Co-Player, der je in deiner Squad war
CREATE TABLE players (
    account_id      TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    platform        TEXT NOT NULL,
    is_self         INTEGER DEFAULT 0,
    first_seen_at   TEXT NOT NULL,
    last_polled_at  TEXT
);

-- Matches: ein Eintrag pro Match
CREATE TABLE matches (
    match_id          TEXT PRIMARY KEY,
    map_name          TEXT NOT NULL,
    game_mode         TEXT NOT NULL,        -- "squad-fpp", "duo-tpp", …
    is_ranked         INTEGER DEFAULT 0,
    duration_secs     INTEGER,
    played_at         TEXT NOT NULL,
    telemetry_url     TEXT,
    telemetry_fetched INTEGER DEFAULT 0
);

-- Participants: nur Self + Squad-Members des jeweiligen Matches
CREATE TABLE participants (
    match_id         TEXT NOT NULL,
    account_id       TEXT NOT NULL,
    name             TEXT NOT NULL,
    team_id          INTEGER,
    place            INTEGER,
    kills            INTEGER,
    headshot_kills   INTEGER,
    assists          INTEGER,
    dbnos            INTEGER,
    revives          INTEGER,
    damage_dealt     REAL,
    longest_kill     REAL,
    time_survived    INTEGER,
    walk_distance    REAL,
    ride_distance    REAL,
    swim_distance    REAL,
    weapons_acquired INTEGER,
    heals            INTEGER,
    boosts           INTEGER,
    team_kills       INTEGER,
    PRIMARY KEY (match_id, account_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (account_id) REFERENCES players(account_id)
);
CREATE INDEX idx_part_player ON participants(account_id);

-- Telemetry-Events: nur wo Squad als Actor oder Target involviert
CREATE TABLE telemetry_events (
    id              INTEGER PRIMARY KEY,
    match_id        TEXT NOT NULL,
    event_type      TEXT NOT NULL,        -- "Kill", "TakeDamage", "Landing", "Attack"
    timestamp_ms    INTEGER,
    actor_account   TEXT,
    target_account  TEXT,
    weapon          TEXT,
    distance        REAL,
    damage          REAL,
    payload_json    TEXT,
    FOREIGN KEY (match_id) REFERENCES matches(match_id)
);
CREATE INDEX idx_tel_match ON telemetry_events(match_id);
CREATE INDEX idx_tel_actor ON telemetry_events(actor_account);
CREATE INDEX idx_tel_type  ON telemetry_events(event_type);

-- Lifetime-Career pro Mode
CREATE TABLE player_lifetime (
    account_id        TEXT NOT NULL,
    mode              TEXT NOT NULL,        -- "all" oder "squad-fpp" etc.
    rounds_played     INTEGER,
    wins              INTEGER,
    top10s            INTEGER,
    win_rate          REAL,
    top10_rate        REAL,
    kills             INTEGER,
    kd_ratio          REAL,
    headshot_kills    INTEGER,
    headshot_rate     REAL,
    avg_damage        REAL,
    longest_kill      REAL,
    time_survived_sec INTEGER,
    last_refreshed    TEXT,
    PRIMARY KEY (account_id, mode),
    FOREIGN KEY (account_id) REFERENCES players(account_id)
);

-- Stamm-Crew (manuell gepflegt)
CREATE TABLE stamm_crew (
    account_id      TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    added_at        TEXT NOT NULL
);

-- Settings (UI-State, Filter, Polling-Config)
CREATE TABLE settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- View: Co-Player ab Schwellwert
CREATE VIEW qualified_co_players AS
SELECT
    p.account_id,
    p.name,
    COUNT(DISTINCT pa.match_id) AS shared_matches
FROM participants pa
JOIN players p ON p.account_id = pa.account_id
WHERE p.is_self = 0
GROUP BY p.account_id;
```

### Polling-Logik

Background-Thread in `serve.py`, Tick alle 60s (konfigurierbar):

```
1. Player-Resource holen (1 Request)
   GET /players?filter[playerNames]=PEX_LuCKoR&filter[platforms]=steam

2. Match-IDs vergleichen mit DB → unbekannte sammeln

3. Für jedes neue Match (gestaffelt, Rate-Limit-aware):
   a) Match-Detail holen (1 Request)
   b) Squad-Member-Account-IDs aus Roster (team_id == eigene team_id)
   c) Insert matches-Row
   d) Insert participants-Rows (nur Self + Squad)
   e) Insert/Update players für jeden neuen Co-Player
   f) telemetry_url speichern, telemetry_fetched=0

4. Telemetry-Backlog abarbeiten (async, Low-Priority):
   a) Fetch JSON (kein Rate-Limit-Counter — andere Domain)
   b) Parse: Kill, KillV2, TakeDamage, Landing (Parachute), Attack
   c) Filter: actor_account ODER target_account in Squad
   d) Insert telemetry_events
   e) telemetry_fetched=1

5. Co-Player-Lifetime-Refresh:
   Für jeden Co-Player aus qualified_co_players WHERE shared_matches >= 5
     UND last_refreshed > 24h ODER NULL:
       Hole Lifetime, gestaffelt (Rate-Limit-Budget reservieren)

6. Eigenes Lifetime alle 24h refreshen

7. Status-Tracking: Errors, Last-Successful-Poll, Queue-Depth → /api/pubg/status
```

**Rate-Limit:** 10 req/min. Polling-Tick reserviert maximal **6 req/min** (1 Player-Resource + bis zu 5 Match-Details/Lifetimes), Rest als Reserve für On-Demand-Endpoints.

### Cold-Start-Bulk-Import

Beim ersten Start (oder via `python serve.py --init-pubg-db`):
- Hole Player-Resource → bis zu 30 Match-IDs
- Verarbeite alle (gestaffelt, Rate-Limit-aware) → ~3-6 Min für 30 Matches
- Telemetry für alle nachladen (im Hintergrund, kann 30+ Min dauern)

### Datenmenge

Pro Match: ~10-30 KB (Match + Participants + gefilterte Telemetry).
Bei 10 Matches/Tag: ~70 MB/Jahr. SQLite kein Problem.

## API-Endpoints (`serve.py`)

Alle GET wenn nicht anders vermerkt, alle JSON-Response, alle Bind auf `127.0.0.1`.

```
GET  /api/pubg/session
       Aktuelle Session (seit sessionStartedAt aus settings)
       → { kills, damage, wins, top10s, matches, kd, headshotPct,
           bestPlace, longestKill, firstFightSurvived, firstFightTotal,
           sessionStartedAt, mapBreakdown: [...] }

GET  /api/pubg/last-match
       → { matchId, map, mode, place, durationSec, playedAt,
           myStats: {...}, mates: [{name, accountId, stats: {...}}] }

GET  /api/pubg/mates-today?range=session|day|week
       → [{ accountId, name, sharedMatchesToday, kdToday, dmgToday,
            careerLifetime: {...} | null }]

GET  /api/pubg/top-mates?sortBy=avgPlace|kd|winRate|mostPlayed&limit=5&minMatches=10
       → [{ accountId, name, sharedMatches, kd, avgDmg,
            winRate, avgPlace }]

GET  /api/pubg/co-player/{nameOrAccountId}
       → { sharedHistory: { matches, kd, avgDmg, winRate, avgPlace,
                            mapDistribution, last5Matches: [...] },
           careerLifetime: {...} }

GET  /api/pubg/career-lifetime?player=&mode=all|squad-fpp|...
       → { roundsPlayed, wins, top10s, kills, kd, headshotRate, ... }

GET  /api/pubg/map-distribution?range=session|day|week|all
       → [{ map, count, wins, avgPlace }]

GET  /api/pubg/first-fight-rate?range=session|day|week|all
       → { rate, survived, total, sparkline: [0,1,1,0,...] }

GET  /api/pubg/squad-compare?players=A,B,C,D&matches=5
       → { players: [...], matchTable: [...] }

GET  /api/pubg/match-leaderboard/{matchId}
       On-demand aus PUBG-API gezogen, nicht persistiert.

GET  /api/pubg/settings
POST /api/pubg/settings  { key, value }
       → Persistiert in settings-Tabelle

POST /api/pubg/session/reset
       Setzt sessionStartedAt = now() in settings.

GET  /api/pubg/status
       → { polling: ok|degraded|error, lastPollAt,
           pubgApiReachable, dbSize, queueDepth, rateLimitRemaining }

GET    /api/pubg/stamm-crew
POST   /api/pubg/stamm-crew    { add: "Name" }
DELETE /api/pubg/stamm-crew    { remove: "Name" }
```

**In-Memory-Caching:** 30s TTL für Heavy-Endpoints (top-mates, map-distribution, mates-today, first-fight-rate, career-lifetime). DB-Queries laufen nur 1x pro 30s, auch wenn 5 Browser-Sources gleichzeitig pollen.

## Komponenten-Bibliothek

Alle Komponenten leben in `widgets/pubg/`. Die Cross-Player-View liegt in `scenes/` (kein OBS-Widget).

| Datei | Zweck | Refresh | Daten |
|---|---|---|---|
| `live-bar.html` | Slim-Counter Gameplay | 30s | session |
| `flyout-full.html` | Großes Detail-Panel, Hotkey-Toggle | 60s | session, map-distribution, top-mates, first-fight-rate |
| `mates-today.html` | "Heute mit X, Y, Z" — 4 Layouts (`?layout=stack\|fold\|carousel\|mosaic`, Default: carousel) | 30s | mates-today |
| `top-mates.html` | Standalone Top-5-Widget für BRB | 5min | top-mates |
| `post-match-card.html` | 10s-Pop-up nach Match-Ende | 30s (poll auf neue match_id) | last-match |
| `map-distribution.html` | Map-Häufigkeit (Donut/Bar) | 5min | map-distribution |
| `first-fight.html` | Survival-% mit Sparkline | 5min | first-fight-rate |
| `session-summary.html` | Vollformat Stream-Ending | 60s | alles aggregiert |
| `career-card.html` | Lifetime für Starting-Soon | 24h | career-lifetime |
| `news-ticker.html` | Marquee-Bar unten, rotiert Snippets alle 8s | 60s | session, top-mates |
| `squad-compare.html` | Multi-Player-Tabelle (bis 4) | 60s | squad-compare |
| `chat-stats-popup.html` | Parameter-driven Pop-up via Streamer.bot (`?player=NAME&layout=mosaic\|spotlight&duration=12`) | on-load | co-player |
| `scenes/stats.html` | Cross-Player-Web-View (`?player=NAME`) | on-load | co-player |

### `mates-today.html` — 4 Layout-Varianten

**Carousel (Default — `?layout=carousel`)**

Eine Card im Spotlight, wechselt alle 5-8s zum nächsten Mate. Slide-Cross-Fade. Wenn nur 1 Mate da → keine Animation.

**Stack (`?layout=stack`)**

Alle Mates als gestapelte Cards untereinander, alle gleichzeitig sichtbar, Career + Heute-mit-dir-Block.

**Fold (`?layout=fold`)**

Sequentieller Build-Up: jeder Mate erscheint mit 0.6s Versatz, danach statisch.

**Mosaic (`?layout=mosaic`)**

Tile-Grid nebeneinander. Bei 4+ Mates wrap auf 2 Reihen.

### `chat-stats-popup.html` — Streamer.bot-Integration

URL-Parameter:
- `player` (required) — PUBG-Name oder Account-ID
- `layout` (optional, Default `mosaic`) — `mosaic` oder `spotlight`
- `duration` (optional) — Auto-Hide nach N Sek; ohne → bleibt bis Source-Visibility=off
- `theme` (optional, Default `dark`)

**Streamer.bot-Workflow** (in der README als Doku):
```
Trigger: Twitch Chat Command "!mypubgstats"
Action 1: $pubgName = Argument 1 ODER aus Streamer.bot-Mapping
Action 2: OBS Browser-Source URL setzen:
          http://localhost:PORT/widgets/pubg/chat-stats-popup.html?player={pubgName}
Action 3: Source einblenden
Action 4: 12s warten
Action 5: Source ausblenden
```

## Setup-Flow

1. **API-Key holen** — `developer.pubg.com` → "API access" → kostenloser Key
2. **`.secrets` erweitern** — `PUBG_API_KEY=<key>`
3. **`config/pubg.json` erstellen:**
   ```json
   {
     "playerName": "PEX_LuCKoR",
     "platform": "steam",
     "stammCrew": [],
     "pollIntervalSec": 60,
     "minMatchesForLifetime": 5,
     "minMatchesForTopMates": 10
   }
   ```
4. **DB initialisieren** — `python serve.py --init-pubg-db` (Schema + Cold-Start-Import)
5. **`serve.py` als Always-on-Service** — systemd-User-Unit (Linux) oder Task-Scheduler (Windows)
6. **OBS-Sources hinzufügen** — pro Szene die gewünschten `widgets/pubg/*.html`
7. **Streamer.bot-Action für `!mypubgstats`** konfigurieren (siehe Workflow oben)
8. **README aktualisieren** mit Setup-Flow + URL-Parametern aller Komponenten

## Visuals & Theme

Konsistent mit existierendem Stack (CLAUDE.md: Purple `#5e2a79` / Gold `#f2b705`, DM Sans, Dark-Theme):

- **Cards:** dunkler Hintergrund `rgba(20,12,30,0.85)`, dezenter Purple-Border, Gold-Akzente auf Highlights (Wins, Best Place)
- **Zahlen:** DM Sans Bold, große Werte in Gold, Labels in muted Grau
- **Map-Icons:** schlichte SVG-Silhouetten, monochrome
- **Mode-Icons:** kleine Glyphen für Solo/Duo/Squad, FPP/TPP
- **Animationen:** Slide-In + Fade, keine Bouncy-Easings
- **Sparkles auf Win/Best-Place-Events:** Rand-Fade Pflicht (siehe Memory-Regel)

## Error-Handling

| Szenario | Verhalten |
|---|---|
| PUBG-API down | `serve.py` retry mit exponential backoff (1s → 2s → 4s → 8s → 16s, dann 60s); `/api/pubg/status` reflektiert; Browser-Sources zeigen letzte DB-Daten |
| Rate-Limit erreicht | Polling pausiert bis nächste Minute, Queue wird abgebaut |
| API liefert 14+ Tage keine neuen Matches (wie pubglookup-Outage Oktober 2023) | Status-Endpoint zeigt "degraded", optional Banner-Widget kann das in OBS zeigen |
| DB korrupt | Backup auto-restore aus `data/pubg-history.db.bak` (Rotation alle 24h) |
| Browser-Source kann `serve.py` nicht erreichen | Komponenten zeigen "Stats nicht verfügbar" + retry alle 30s |
| Telemetry-URL liefert 404 (Match >14 Tage) | telemetry_fetched=skip, gespeicherte Match-Stats bleiben gültig |
| Co-Player-Lifetime-API liefert 404 (z.B. Account gelöscht) | Eintrag markiert als "career_unavailable", Anzeige fällt auf "—" |

## Testing

- **Unit-Tests** für Telemetry-Parser (gefilterte Event-Erkennung, First-Fight-Detection)
- **Integration-Test** für Polling-Loop (mit Mock-API)
- **DB-Migration-Test** beim Schema-Update
- **Browser-Source-Test** manuell in OBS pro Komponente
- **Rate-Limit-Stresstest:** 30 Match-Backfill darf nicht über 10 req/min ausreißen

## Open Questions / Future Work

- Sound-Cue beim Win? (out-of-scope — fügt sich aber nahtlos in den existierenden Alert-Stack ein)
- Hotkey-Mapping für Flyout in OBS? Über OBS-Hotkey-System auf "Source-Visibility-Toggle" — keine Code-Änderung nötig
- Multi-Account-Support (z.B. Smurf-Account)? — out-of-scope, später per zusätzlichem Player-Eintrag denkbar
- Match-Leaderboard als eigenes Widget? — on-demand-Endpoint vorhanden, Komponente bei Bedarf nachziehen
- Persistenz von Sub-Mates-Beziehungen ("PlayerA spielt oft mit PlayerB ohne dich")? — out-of-scope

## Akzeptanzkriterien

- ✅ `serve.py` läuft als Always-on-Service, polled PUBG-API, persistiert in SQLite
- ✅ Alle 13 HTML-Komponenten laden ohne JS-Errors, zeigen korrekte Daten
- ✅ Cold-Start-Bulk-Import von 30 Matches funktioniert in einem Lauf
- ✅ Co-Player-Lifetime wird automatisch geholt sobald `shared_matches >= 5`
- ✅ Top-Mates-Filter im Flyout per Slider verstellbar, persistent in SQLite
- ✅ `mates-today.html?layout=carousel|stack|fold|mosaic` rendert alle 4 Layouts korrekt
- ✅ `chat-stats-popup.html?player=NAME` funktioniert mit Streamer.bot-Trigger
- ✅ `stats.html?player=NAME` zeigt eure Historie + Career-Lifetime
- ✅ Rate-Limit von 10 req/min wird nie überschritten (auch nicht beim Backfill)
- ✅ Bei API-Outage zeigen Komponenten gecachte Daten statt zu crashen
- ✅ README dokumentiert Setup-Flow + alle URL-Parameter aller Komponenten
