# G1R DB-Domain · Subprojekt 1: Ingestion + Schema + Run-Erkennung

**Stand:** 2026-06-18 · **Status:** abgestimmt, bereit für Plan

## Ziel
G1R wird ein DB-gestütztes Domain (wie `pubg/`). Statt Records/Totals fragil im Lua-Mod
zu zählen (verschwinden bei Neustart/Reload), landen rohe Spieldaten **run-getaggt in
Postgres**. Records/Totals/Career werden später (Sub-2) als Queries daraus abgeleitet.

**Sub-1-Erfolg:** Daten landen korrekt, run-getaggt, tenant-skaliert in der DB —
per SQL verifizierbar. Keine Widget-/Layout-Arbeit (das ist Sub-3).

## Datenfluss
```
Mod main.lua → g1r-state.json (lokal) → Proxy server.py (batch/retry/offline-puffer)
   → HTTPS POST /api/g1r/ingest (Tenant-Token) → g1r/-Package → Postgres obs.*
```
Bestehende Widgets bleiben unberührt (lesen weiter localhost-JSON).

## Mod (main.lua) — liefert roher
Heutige Lua-Akkumulation (`sess`/`totals`/`records`) entfällt weitgehend; die DB rechnet.
Die `g1r-state.json` bekommt zusätzlich:
- **`saveKey`** — möglichst stabile Durchlauf-Kennung (siehe Spike); nicht lesbar → `null`.
- **`events`** — Liste seit letztem Schreiben: `{kind:"hit_dealt"|"hit_taken"|"kill", value, meta}`.
  Treffer ausgeteilt aus dem Damage-Hook; Treffer erhalten aus dem HP-Delta (Warmup-/
  Sprung-Filter bleibt bei der Event-Erzeugung); Kills aus dem Kill-Reader.
- Snapshot-Felder (Level/XP/HP/Mana/Stats/Strecke/Gilde/stärkste Waffen) bleiben.

## Schema (Postgres, `obs.`-Schema, alles `tenant_id`-skaliert)
- **`g1r_run`**: `id, tenant_id, save_key NULL, started_at, ended_at NULL, label NULL,
  detection ('save'|'heuristic'|'manual'), created_at`
- **`g1r_sample`**: `id, run_id, tenant_id, ts, level, xp, hp, hp_max, mana, mana_max,
  strength, dexterity, magic_circle, learn_pts, res_fire, res_ice, res_edge, res_point,
  res_blunt, distance_m, steps, guild_key, strongest_melee, strongest_melee_dmg,
  strongest_ranged, strongest_ranged_dmg, strongest_spell`
- **`g1r_event`**: `id, run_id, tenant_id, ts, kind, value, meta jsonb`
- Index je Tabelle auf `(tenant_id, run_id, ts)`.
- Migration als `postgres`-Superuser, Tabellen mit `obs.`-Prefix.

## Ingest-Endpoint
`POST /api/g1r/ingest` · Auth: vorhandener Tenant-Token (Header) → Tenant.
Body: `{ saveKey, snapshot{…}, events[…], client_seq }` · Antwort: `{ ok, run_id, run_label }`.

**Run-Zuordnung (auf Prod, hat die DB-Historie):**
- `saveKey` vorhanden & ≠ aktiver Run → neuer Run (`detection='save'`).
- `saveKey` == aktiver Run → selber Run.
- `saveKey = null` → Heuristik: Level/XP deutlich unter letztem Sample **und** ~Anfangs-
  werte → neuer Run (`detection='heuristic'`); sonst selber Run.
- `POST /api/g1r/run/new` (manueller Button) → erzwingt neuen Run + setzt `label`.

**Dedup/Offline:** `client_seq` monoton; bereits gesehene Sequenzen verwerfen → Retrys
nach Internet-Aussetzer schreiben keine Doppel-Events.

## Auth
Proxy bekommt den vorhandenen Tenant-Token in `.secrets`, schickt ihn im Ingest-Header.
Kein neues Auth-System.

## Erster Schritt: Save-Kennung-Spike
Mod-Spike vor dem Schema-Final: Gibt UE4SS eine stabile Durchlauf-Kennung her
(Save-System / GameInstance / Neuspiel-Zeitstempel)? `save_key` ist `nullable` → Schema
trägt beide Ausgänge; Ergebnis bestimmt nur, wie oft die Heuristik einspringt.

## Tests
- pytest (`tmp_db_path`): Run-Zuordnung (neu/selber/Heuristik/manuell), Ingest `_ok`/`_err`,
  Dedup über `client_seq`.
- Cross-Tenant: alle Queries `tenant_id`-gefiltert (mit zweitem Tenant gegenprüfen).

## Außerhalb von Sub-1
Aggregationen/Career-Endpoints (Sub-2), Widget-Umbau + Layout + Run-Auswahl-UI (Sub-3).
