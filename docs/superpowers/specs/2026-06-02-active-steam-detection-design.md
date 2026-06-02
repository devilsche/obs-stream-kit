# `/api/pubg/active` — Steam-basierte Detection statt Taskmanager

**Datum:** 2026-06-02
**Status:** Design (zur Review)

## Ziel

`/api/pubg/active` (gepollt von Streamer.bot) entscheidet, ob der Streamer
gerade aktiv PUBG spielt. Die heutige Detection prüft, ob `TslGame.exe` **lokal**
im Taskmanager läuft (`tasklist`/`pgrep`). Seit das Backend auf einem
Remote-Server läuft, ist dieser Prozess-Check tot — der Server sieht den
lokalen Spiel-Prozess nicht.

Künftig kommt das „PUBG läuft"-Signal aus der **Steam Web API** (funktioniert
remote), kombiniert mit dem bestehenden „Match kürzlich gespielt"-DB-Check.

## Neue Logik

```
1. Steam-API: Läuft PUBG?  (now-playing → gameid == 578080)
2. Wenn ja  → DB: gab es einen Match in den letzten <thresholdMin> min (Default 30)?
              active = matchRecent
3. Wenn nein → active = false   (kein DB-Query nötig, Kurzschluss)
4. Wenn Steam es nicht sagen kann (Profil privat / keine Steam-Creds / API-Fehler)
            → Fallback auf NUR matchRecent (großzügig, wie das alte Verhalten)
```

Effektiv: `active = pubgOpen AND matchRecent`, mit Kurzschluss (PUBG zu → kein
DB-Query) und graceful Fallback (Steam unbekannt → matchRecent-only).

### Bewusst akzeptierte Kanten (vom Nutzer bestätigt)

- PUBG frisch gestartet, erster Match noch nicht beendet → `active = false`,
  bis der erste Match durch ist (kein Match in der DB für diese Session).
- Match vor 10 min beendet, PUBG aber schon geschlossen → `active = false`.

Das ist enger als heute (heute `OR`), aber gewollt: „active" heißt jetzt
*tatsächlich gerade in einer PUBG-Session*, nicht „PUBG offen im Menü seit Stunden"
und nicht „Spiel längst zu, aber Match noch in der 30-min-Schwelle".

## Response-Contract

Felder `active` und `matchRecent` bleiben erhalten (Streamer.bot nutzt diese).
Das lokale `processRunning` wird durch `pubgOpen` ersetzt.

```json
{
  "active": true,
  "pubgOpen": true,            // true | false | null (null = Steam unbestimmbar)
  "matchRecent": true,
  "lastMatchAt": "2026-06-02T20:14:00Z",
  "lastMatchAgeMin": 8.3,
  "thresholdMin": 30,
  "steamChecked": true         // false wenn Fallback (Steam nicht abgefragt/bestimmbar)
}
```

- `pubgOpen`: `true`/`false` aus Steam, `null` wenn unbestimmbar.
- Bei Kurzschluss (pubgOpen=false) wird `matchRecent` **nicht** evaluiert und als
  `false` mit `lastMatchAt=null` gemeldet.
- Bei Fallback (Steam unbestimmbar) wird `matchRecent` aus der DB bestimmt und
  `active = matchRecent`; `pubgOpen=null`, `steamChecked=false`.

### Query-Overrides

- `?thresholdMin=15` / `?thresholdSec=300` — Match-Alters-Schwelle (wie heute).
- `?noSteam=1` — Steam-Check überspringen, nur `matchRecent` (ersetzt das alte
  `?noProcess=1`; nützlich zum Testen + als manueller Fallback).
- `?fakePubgOpen=1` / `?fakePubgOpen=0` — Steam-Status simulieren (Test-Override,
  Parität zum bestehenden `fakeAppId` in `/api/steam/now-playing`).

## Architektur & Mechanik

`/api/pubg/active` (Handler `_active` in `pubg/endpoints.py`) ermittelt das
PUBG-läuft-Signal serverseitig über die Steam-Daten des Tenants:

- Lädt die Steam-Creds des Tenants (`core.credentials`: `steam_id`,
  `steam_api_key`).
- Baut/nutzt den vorhandenen Steam-Client (`steam/client.py`,
  `get_player_summaries`) und liest `gameid`.
- `pubgOpen = (gameid == 578080)`. PUBG-AppID `578080` als benannte Konstante.
- **Cache** gegen das sekündliche Streamer.bot-Polling: kurzlebiger Cache
  (~5–10 s, process-level, pro Tenant) auf das Steam-Summary-Ergebnis — analog
  zum bisherigen 5-s-`_proc_cache` des Prozess-Checks. Respektiert Steam-Rate-Limits.
- Fehler/privat/keine Creds → `pubgOpen = null`, Fallback auf matchRecent.

Der Match-Check bleibt wie heute: `SELECT MAX(played_at) FROM matches WHERE
tenant_id = ?`, Alter < Schwelle.

### Kopplung

Das pubg-Modul greift damit auf Steam-Creds + Steam-Client zu (leichte
pubg→steam-Kopplung, vom Nutzer akzeptiert). Der Steam-Client wird
wiederverwendet, nicht dupliziert.

### Multi-Tenant

Detection ist tenant-scoped: Steam-Creds und Match-Query laufen über
`tenant_id`. Cross-Tenant verifizieren (Tenant ohne Steam-Creds → Fallback greift,
kein Crash).

## Aufzuräumender Alt-Code

- `_is_pubg_running()`, `_proc_cache`, `_PROC_CACHE_TTL_S`, `_PUBG_PROCESS_NAME`
  und die `subprocess`/`tasklist`/`pgrep`-Logik in `pubg/endpoints.py` entfallen
  (toter lokaler Prozess-Check).
- `?noProcess` → `?noSteam` umbenannt.

## Error Handling

- Steam-API-Fehler (`SteamApiError`, Timeout) → als „unbestimmbar" behandeln →
  Fallback matchRecent, kein 5xx. Endpoint bleibt robust für das Polling.
- Kein Steam-Account hinterlegt → `pubgOpen=null`, Fallback.
- DB-Fehler beim Match-Query → wie heute defensiv (matchRecent=false), kein Crash.

## Testing

- `pubgOpen=true` + Match < 30 min → `active=true`.
- `pubgOpen=true` + kein/zu alter Match → `active=false`, `matchRecent=false`.
- `pubgOpen=false` → `active=false`, DB **nicht** abgefragt (Kurzschluss).
- Steam unbestimmbar (gemockter `SteamApiError` / keine Creds) → Fallback:
  `active=matchRecent`, `pubgOpen=null`, `steamChecked=false`.
- `?noSteam=1` → Steam übersprungen, `active=matchRecent`.
- `?fakePubgOpen=1`/`=0` → simuliert Steam-Status ohne echten Steam-Call.
- `?thresholdMin`/`?thresholdSec` → Schwelle wirkt.
- Steam-Summary-Cache: zwei schnelle Aufrufe lösen nur einen Steam-Call aus.
- Mit der vorhandenen pytest-Infrastruktur (`tests/pubg/`), Steam-Client gemockt.

## YAGNI / Nicht-Ziele

- Kein echtes „Match läuft gerade live" — von Steam/PUBG-API nicht abrufbar.
- Kein neuer Endpoint; `/api/pubg/active` bleibt die einzige Quelle für Streamer.bot.
- Keine Änderung am Streamer.bot-Polling oder an der Response-Nutzung
  (`active`/`matchRecent` bleiben).
