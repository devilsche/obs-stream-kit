# Follow-ups nach Spec 1 (Postgres + Tenant-Foundation)

## Broken Tests (Test-Suite Re-Wiring noetig)

Nach der PG-Migration brechen folgende Tests, weil sie noch SQLite-Mock-Fixtures
nutzen. Sie testen valides Verhalten, aber gegen das alte SQLite-API. Re-Wiring
nach Plan (eigener Follow-up-Task — Schaetzung: 2-4 h):

- `tests/pubg/test_aggregations.py` — 13 Tests, sqlite3.Connection statt psycopg2.
- `tests/pubg/test_poller.py` — 3 Tests, alte PollerThread-Signatur (db_path/client).
- (Weitere ggf., bei vollem `pytest`-Run.)

**Nicht in Scope von Spec 1.** Live-Endpoints sind korrekt umgestellt; die Tests
selbst muessen gegen die neue PG-Conn-Fixture umgeschrieben werden.

## Aufgaben fuer kuenftige Specs

### POI-Schema mit Polygon-Support

Der bestehende `data/pubg-pois.json` enthaelt 89 Polygone pro Map mit
`points: [[x,y], ...]`. Das Spec-1-Schema `pois` modelliert nur Punkt+Radius
und ist deshalb leer geblieben (POI-Migration in Task 10 ausgesetzt).

Option A: Spalte `polygon_points JSONB` ergaenzen, JSON wie aus pubg-pois.json
direkt speichern. Vorteil: einfach, kein Schema-Bruch.

Option B: Neue Subtabelle `poi_vertices (poi_id, seq, x, y)`. Normalisierter,
aber teuer in Reads (JOIN + sort by seq).

Empfehlung: Option A. Schema-Erweiterung in einer Mini-Migration:
`ALTER TABLE pois ADD COLUMN polygon_points JSONB; ALTER TABLE pois ALTER COLUMN
poi_x DROP NOT NULL; ALTER TABLE pois ALTER COLUMN poi_y DROP NOT NULL;`
Dann `core/migrate_sqlite_to_pg.py migrate_pois` neu schreiben fuer das
geschachtelte JSON-Format (`data[map_name]["regions"][i]`).

### pubg/fetch_job.py + pubg/cli.py auf PG

Diese beiden Helper-Skripte importieren noch aus `pubg/db.py` (SQLite).
Funktionieren gegen das neue Schema nicht mehr. Re-write analog zu poller.py
(per-Tenant-Loop + credentials.get). Nicht business-critical (Helper-Tools
fuer einmalige Pflege-Operationen), daher in Spec 1 nicht angegangen.

### stamm_crew

`pubg/endpoints.py` enthaelt jetzt 501-Stubs fuer `/api/pubg/stamm-crew`-Routes,
weil die Tabelle nicht migriert wurde (nicht im PG_SCHEMA). Bei Bedarf: Tabelle
hinzufuegen + Daten migrieren + Endpoints aktivieren.

### `OBS_KIT_MASTER_KEY` persistent

Aktuell nur als Env-Var in Ad-hoc-Calls genutzt. Server-systemd-Unit braucht:
`Environment=OBS_KIT_MASTER_KEY=<base64>`
in `/etc/systemd/system/obs-stream-kit.service` (oder per `EnvironmentFile=`
mit eingeschraenkten Permissions, z.B. `/etc/obs-stream-kit.env` 0600).
