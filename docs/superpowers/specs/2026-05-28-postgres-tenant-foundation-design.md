# Spec 1 — Postgres + Tenant-Foundation

**Datum:** 2026-05-28
**Status:** Draft — wartet auf User-Review
**Vorheriges Brainstorming:** dieses Dokument
**Folge-Specs:** Spec 2 (Auth + Tenant-Routing), Spec 3 (Streamer-Dashboard), Spec 4 (Admin-Dashboard)

## Ziel

obs-stream-kit ist heute single-tenant: eine `.secrets`-Datei, drei SQLite-DBs (`pubg-history.db`, `steam-history.db`, `teamspeak.db`), alles fest verdrahtet auf einen Streamer. Spec 1 legt das **Datenfundament für Multi-Tenant-SaaS-Betrieb**:

- PUBG + Steam ziehen von SQLite auf eine zentrale PostgreSQL-Instanz um.
- Jede Daten-Tabelle bekommt eine `tenant_id`-Spalte.
- Eine neue Schicht aus `tenants`, `tenant_credentials`, `users`, `widget_tokens` und global geteilten `pois` wird angelegt.
- Per-Tenant API-Credentials werden AES-GCM-verschlüsselt in der DB gehalten, kein `.secrets` mehr als Runtime-Quelle.
- Backup-Strategie wechselt von SQLite-File-Copy auf `pg_dump` mit GFS-Retention.

Spec 1 baut **keine** Auth, **kein** UI, **keine** öffentlichen Tenant-URLs. Endpoints lesen den Tenant aus einem hardcoded Default (`tenant_id = 1` = du als Admin). Damit läuft das System nach Spec-1-Abschluss funktional wie vorher, aber das Schema ist für Spec 2+ vorbereitet.

## Out of Scope

- **TeamSpeak**: wird in ein eigenes Repo (`obs-stream-teamspeak` o.ä.) ausgelagert. Spec 1 fasst `teamspeak.db` nicht an. Die Migration des TS3-Codes ist eine separate, parallele Aufgabe.
- **Scenes** (Starting Soon / BRB / Ending / Stinger / Alerts): wandern ebenfalls in ein eigenes Repo. Spec 1 ändert nichts daran.
- Auth, Login, OAuth, Sessions → Spec 2.
- Streamer-Self-Service-UI, API-Key-Eintrags-Formular, Token-Rotations-Button → Spec 3.
- Admin-Dashboard, User-Management, Audit-Log → Spec 4.
- Storage-Rotation für das HiDrive-Telemetrie-Archiv (z.B. "drop > 12 Monate") — wird erst relevant wenn 240GB knapp werden.

## Architektur-Überblick

```
┌─────────────────────────────────────────────────────────────┐
│  serve.py (unverändert in Spec 1 — liest Tenant=1 hardcoded)│
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  PostgreSQL (eigene DB obs_stream_kit, eigene Rolle)        │
│                                                             │
│  Identity & Config                                          │
│  ├─ users               (Login-Stub, is_admin)              │
│  ├─ tenants             (Streamer-Account)                  │
│  ├─ tenant_credentials  (AES-GCM verschlüsselte API-Keys)   │
│  └─ widget_tokens       (URL-Tokens für Spec 2)             │
│                                                             │
│  Domain-Daten (alle mit tenant_id NOT NULL)                 │
│  ├─ pubg.players, pubg.matches, pubg.participants, ...      │
│  └─ steam.achievements, steam.games, ...                    │
│                                                             │
│  Global (kein tenant_id)                                    │
│  └─ pois                (POI-Editor-Daten, admin-only)      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                ┌──────────────────────────┐
                │  HiDrive FTP             │
                │  ├─ telemetry/<match_id> │  ← nur Admin-Tenant
                │  │   .json.gz            │
                │  └─ backups/             │
                │      ├─ daily/  (7)      │  ← GFS
                │      ├─ weekly/ (4)      │
                │      └─ monthly/ (6)     │
                └──────────────────────────┘
```

## Komponenten

### 1. PostgreSQL-Setup

Lokale Postgres-Instanz (bereits auf dem Server vorhanden). Eigene DB und Rolle:

```sql
CREATE ROLE obs_stream LOGIN PASSWORD '<aus .secrets>';
CREATE DATABASE obs_stream_kit OWNER obs_stream ENCODING 'UTF8';
\c obs_stream_kit
CREATE SCHEMA obs AUTHORIZATION obs_stream;
ALTER ROLE obs_stream SET search_path = obs, public;
```

Begründung: eigene DB statt Tabellen-Prefix → klare Isolation gegenüber anderen Projekten auf derselben PG-Instanz, eigene Backups/Permissions/Quotas pro DB.

DSN landet in `.secrets`:
```
OBS Kit PG DSN: postgresql://obs_stream:<pw>@localhost:5432/obs_stream_kit
```

(Existiert teilweise schon als `PUBG PG DSN` in der aktuellen Migration — wird umbenannt.)

### 2. Schema: Identity & Config

#### `users`
Login-Identität (Stub für Spec 1, voll genutzt ab Spec 2).

```sql
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    twitch_user_id  TEXT UNIQUE,            -- nullable in Spec 1, NOT NULL ab Spec 2
    display_name    TEXT NOT NULL,
    is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Spec-1-Seed: ein User-Row für dich mit `is_admin = TRUE`, `twitch_user_id` ggf. NULL bis Spec 2.

#### `tenants`
Ein Tenant = ein Streamer-Setup (PUBG-Daten-Sammlung, Widget-Konfiguration, …). MVP: 1 User → 1 Tenant.

```sql
CREATE TABLE tenants (
    id              SERIAL PRIMARY KEY,
    owner_user_id   INT NOT NULL REFERENCES users(id),
    slug            TEXT UNIQUE NOT NULL,   -- z.B. "luckor" (für spätere /app/-URLs)
    display_name    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Spec-1-Seed: ein Tenant-Row (`id=1`) mit deinem User als Owner, `slug='admin'` o.ä.

**Telemetrie-Archivierungs-Policy:** kein eigenes Flag in `tenants`. Der Poller archiviert Telemetrie genau dann auf HiDrive, wenn der besitzende User `is_admin = TRUE` hat (Join `tenants` → `users.is_admin`). Damit ist die Policy "nur Admin-Tenant archiviert" implizit korrekt: solange du der einzige Admin bist, läuft das Archiv für dich. Falls je ein zweiter Admin dazukäme, würde dessen Telemetrie ebenfalls archiviert — das ist die korrekte Semantik.

#### `tenant_credentials`
Pro-Tenant verschlüsselte API-Keys. Ersetzt `.secrets` als Runtime-Quelle.

```sql
CREATE TABLE tenant_credentials (
    tenant_id            INT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

    -- PUBG
    pubg_name            TEXT,
    pubg_platform        TEXT,                 -- 'steam', 'kakao', ...
    pubg_account_id      TEXT,                 -- 'account.abc...' (aus PUBG-API resolved)
    pubg_api_key_enc     BYTEA,

    -- Twitch
    twitch_channel       TEXT,
    twitch_client_id     TEXT,                 -- App-Credentials, nicht verschlüsselt
    twitch_client_secret_enc BYTEA,

    -- Steam
    steam_id             TEXT,
    steam_api_key_enc    BYTEA,

    -- FTP (HiDrive für Telemetrie-Archiv + DB-Backup)
    ftp_config_enc       BYTEA,                -- JSON-Blob: {protocol,host,port,user,pass,path}

    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Verschlüsselung: AES-GCM mit 256-bit-Master-Key aus Env-Variable `OBS_KIT_MASTER_KEY` (Base64-encoded). Jeder `_enc`-Wert hat das Layout `nonce (12 bytes) || ciphertext || tag (16 bytes)`. Plaintext-Spalten (z.B. `pubg_name`, `pubg_platform`) sind nicht sensitiv und stehen Klartext da, um Indexierung/Debugging zu vereinfachen.

**Reads:** Domain-Code (Poller, API-Client) bekommt einen Helper `get_credentials(tenant_id) → CredBundle` der entschlüsselt zurückgibt. Plaintext liegt nur kurz im RAM.

#### `widget_tokens`
Vorbereitung für Spec 2 (URL `/s/<token>/widgets/...`). In Spec 1 nur angelegt, noch nicht genutzt.

```sql
CREATE TABLE widget_tokens (
    token           TEXT PRIMARY KEY,         -- random, 32 bytes hex, "tok_<base32>"
    tenant_id       INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    label           TEXT,                     -- z.B. "OBS Main", "Backup-Setup"
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);
CREATE INDEX idx_widget_tokens_tenant ON widget_tokens(tenant_id) WHERE revoked_at IS NULL;
```

Spec-1-Seed: ein Token-Row für deinen Tenant (damit du in Spec 2 sofort URLs hast).

#### `pois` (global)
POI-Editor schreibt hierhin. Keine `tenant_id`, kein Scoping — global geteilt, nur Admin schreibt (durchgesetzt erst in Spec 2 via Auth-Middleware). In Spec 1 reine Schema-Anlage + Migration der bestehenden `data/pubg-pois.json`.

```sql
CREATE TABLE pois (
    id              SERIAL PRIMARY KEY,
    map_name        TEXT NOT NULL,
    name            TEXT NOT NULL,
    poi_x           DOUBLE PRECISION NOT NULL,
    poi_y           DOUBLE PRECISION NOT NULL,
    radius_m        DOUBLE PRECISION,
    tags            TEXT[],
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pois_map ON pois(map_name);
```

### 3. Schema: Domain-Daten

Alle bestehenden PUBG- und Steam-Tabellen bekommen `tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`. Primary Keys werden um `tenant_id` erweitert, wo Match-IDs zwischen Tenants kollidieren könnten (z.B. `(tenant_id, match_id)` statt nur `match_id` — selbes Match kann in mehreren Tenants gespielt worden sein, wenn zwei Streamer im selben Squad waren).

#### PUBG (Schema-Erweiterung gegenüber `pubg/db_pg.py`)

Die bestehenden Tabellen in `pubg/db_pg.py` (`players`, `matches`, `participants`, `match_team_mapping`, …) werden um `tenant_id` ergänzt. Konkret betroffen:

| Tabelle | PK alt | PK neu |
|---|---|---|
| `players` | `account_id` | `(tenant_id, account_id)` — derselbe Spieler kann für mehrere Tenants relevant sein (z.B. Mitspieler) |
| `matches` | `match_id` | `(tenant_id, match_id)` |
| `participants` | `(match_id, account_id)` | `(tenant_id, match_id, account_id)` |
| `match_team_mapping` | `(match_id, account_id)` | `(tenant_id, match_id, account_id)` |

Indexe entsprechend mit führendem `tenant_id`.

**Begründung Multi-Row-Match:** wenn Tenant A und Tenant B im selben PUBG-Squad spielen, taucht dasselbe `match_id` in beiden Tenant-Datenständen auf. Würde man Match-ID global eindeutig machen, müsste man Reads für jeden Tenant filtern und Writes deduplizieren — aufwändiger als pro Tenant separat zu speichern. Storage-Overhead bei wirklichem Squad-Overlap ist klein (~35KB pro Match × ~5 Mit-Streamer = ~175KB pro Squad-Match).

**`matches.telemetry_url`** bleibt existierend. Replay-Endpoint (für andere Specs zu bauen) entscheidet zur Lesezeit:
- Wenn Anfragender Admin → versuche HiDrive-Lookup (`telemetry/<match_id>.json.gz`)
- Sonst → Redirect auf `telemetry_url`; 404 vom CDN → "nicht mehr verfügbar"

#### Steam (Neu-Migration aus `steam/db.py`)

Tabellen aus `steam/db.py` (Achievements, Games, Schema-Cache) übernehmen, `tenant_id` ergänzen. Genaue Tabellen werden im Implementation-Plan listet (`steam/db.py` inspizieren).

### 4. Crypto-Helper

Neues Modul `core/crypto.py`:

```python
def encrypt(plaintext: str, key: bytes) -> bytes: ...
def decrypt(ciphertext: bytes, key: bytes) -> str: ...
def load_master_key() -> bytes: ...   # Base64-decode von OBS_KIT_MASTER_KEY
```

- Algorithmus: AES-GCM (via `cryptography` Library — bereits PyPI, kein Build-Tool-Issue).
- Format `nonce || ct || tag`. `decrypt` wirft `InvalidTag` bei Manipulation.
- `load_master_key` failt laut wenn Env-Var fehlt oder kein gültiges 32-Byte-Material decodiert.

Master-Key wird einmalig generiert (`python -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"`) und außerhalb des Repos abgelegt. Empfohlen: in `~/.obs-stream-kit.env` als Zeile `export OBS_KIT_MASTER_KEY=<base64>`, dann via systemd-Unit oder `serve.py`-Startup-Skript sourcen. Runtime-Kontrakt ist die Env-Variable. Dokumentation: wenn der Key verloren geht, sind alle `_enc`-Werte tot, Tenants müssen Credentials neu eintragen — Klartext-Spalten (Namen, IDs) bleiben verwendbar.

Test-Suite: `tests/core/test_crypto.py` — Round-Trip, falscher Key wirft, Tampering wirft.

### 5. Initial-Seed-Script

Neues CLI-Tool: `python -m core.seed_admin`.

Liest `.secrets` und legt an:
1. `users (id=1, display_name='Admin', is_admin=TRUE)`
2. `tenants (id=1, owner_user_id=1, slug='admin', display_name='Admin')`
3. `tenant_credentials (tenant_id=1, …)` mit den Werten aus `.secrets`:
   - `PUBG API Key` → `pubg_api_key_enc`
   - PUBG-Name + Platform aus `config/pubg.json` → `pubg_name`, `pubg_platform`
   - `Twitch-Channel`, `Client-ID`, `Client-Secret` → `twitch_*`
   - `Steam API Key`, `Steam ID` → `steam_*`
   - `FTP-Backup-*` Block → `ftp_config_enc`
4. `widget_tokens (tenant_id=1, label='Default')` mit frisch generiertem Token.

Idempotent: wenn `tenant_id=1` schon existiert, gibt's eine Warnung und das Script tut nichts. Update läuft über eigenes Tool (kommt in Spec 3).

### 6. Daten-Migration: SQLite → Postgres

Existierende Migration `pubg/migrate_to_pg.py` wird erweitert:
- Akzeptiert `--tenant-id` (Default 1). Schreibt jede Row mit der ID.
- Wird umbenannt in `core/migrate_sqlite_to_pg.py` und erhält Sub-Commands für `pubg` und `steam`.
- TS3-Migration ist explizit nicht enthalten (siehe Out of Scope).

Ablauf:
```bash
python -m core.seed_admin                                  # Tenant 1 anlegen
python -m core.migrate_sqlite_to_pg pubg  --tenant-id 1   # bestehende pubg-history.db
python -m core.migrate_sqlite_to_pg steam --tenant-id 1   # bestehende steam-history.db
python -m core.migrate_pois data/pubg-pois.json           # POIs (global, kein tenant_id)
```

Nach Abschluss bleiben die SQLite-Files als `*.db.pre-pg-migration.bak` liegen (Sicherheitsnetz für ~30 Tage), dann manuell zu löschen.

### 7. Anpassung der Domain-Module

`pubg/db.py`, `pubg/db_pg.py`, `pubg/endpoints.py`, `pubg/poller.py`, `pubg/aggregations.py` (und Steam-Pendants) werden auf den neuen tenant-aware Schema-Pfad umgestellt:

- Alle Queries kriegen ein `tenant_id`-Argument. Default-Parameter `tenant_id: int = 1` für Spec-1-Phase (entfernt in Spec 2 zugunsten von Pflicht-Argument).
- API-Credentials werden über `core.credentials.get(tenant_id)` geladen statt aus Modul-Level-`.secrets`-Variablen.
- Poller-Loop iteriert über `SELECT id FROM tenants` und ruft für jeden Tenant die bestehende Match-Fetch-Logik auf.
- Telemetrie-Archiv-Step in `pubg/poller.py` checkt `users.is_admin` für den besitzenden User — nur dann FTP-Push.

`serve.py` selbst wird in Spec 1 **nicht** umgebaut. Er bleibt stdlib-HTTP. Wo er heute `.secrets` einliest und in HTML injiziert, holt er den Wert künftig aus `tenant_credentials WHERE tenant_id = 1` (hardcoded). Der echte Auth-/Routing-Umbau auf Flask kommt in Spec 2.

### 8. FTP-Backup mit GFS-Retention

Neues Skript `scripts/backup_pg.py`, läuft als Daily-Cronjob:

```
dump = pg_dump --format=custom obs_stream_kit | gzip
upload → ftp://.../backups/daily/pg_dump_YYYY-MM-DD.dump.gz

if today.weekday() == Sunday:
    copy daily → ftp://.../backups/weekly/pg_dump_YYYY-MM-DD_weekly.dump.gz

if today.day == 1:
    copy daily → ftp://.../backups/monthly/pg_dump_YYYY-MM-01_monthly.dump.gz

prune:
  daily/   keep last 7
  weekly/  keep last 4
  monthly/ keep last 6
```

FTP-Credentials aus `tenant_credentials WHERE tenant_id = 1` (`ftp_config_enc`). In Spec 1 hardcoded auf Admin-Tenant — der Backup-Job ist global, nicht per Tenant.

Bestehender SQLite-File-Backup (`pubg-history.db.YYYYMMDD.bak`) entfällt nach Migration.

### 9. Telemetrie-Archivierung

Code-Pfad in `pubg/poller.py` (oder dem entsprechenden Telemetrie-Fetch-Modul):

```python
def maybe_archive_telemetry(tenant_id, match_id, telemetry_url):
    user = get_owner_user(tenant_id)
    if not user.is_admin:
        return                                        # andere Streamer: nur DB-Row
    blob = http_get(telemetry_url)                   # bereits gz vom CDN
    ftp_upload(f"telemetry/{match_id}.json.gz", blob)
```

Kein eigener `telemetry_enabled`-Flag auf `tenants` — Policy ergibt sich aus `users.is_admin`. Begründung siehe `tenants`-Abschnitt.

Aktueller HiDrive-Telemetrie-Ordner wird **nicht angetastet** (deine bestehenden Files bleiben). Die Migration ändert nur zukünftige Match-Ingestions.

## Daten-Fluss (nach Spec 1)

1. Poller-Cron tickt: `for tenant in tenants:`
2. Für jeden Tenant: Credentials aus DB ent­schlüsseln → PUBG-API mit dessen Dev-Key abfragen.
3. Neue Matches → `pubg.matches`, `pubg.participants` etc. mit `tenant_id`.
4. Wenn Owner-User `is_admin`: Telemetrie-File runterladen + FTP-Push.
5. Aggregations-Endpoints (`/api/pubg/last-match` etc.) lesen `tenant_id = 1` (hardcoded in Spec 1).
6. Widgets pollen wie bisher die Endpoints.
7. Backup-Cron (täglich 04:00 UTC): `pg_dump` → FTP mit GFS.

## Error Handling

- **Crypto-Key fehlt oder kaputt:** Server startet nicht, Fehler­meldung verweist auf Setup-Doc.
- **Tenant ohne Credentials:** Poller überspringt diesen Tenant mit Log-Warnung statt Crash.
- **PUBG-API-Key invalid:** Pro-Tenant-Logging, andere Tenants laufen weiter (heute crasht der ganze Poller).
- **Telemetrie-FTP-Push fehlschlägt:** Match ist trotzdem in DB (telemetry_url + CDN-Fallback funktioniert). Re-Try-Queue oder manueller Re-Push (Implementation-Detail im Plan).
- **Backup-FTP fehlschlägt:** Lokale Dump-Kopie bleibt in `/tmp` plus eine Status-Datei für Monitoring.

## Tests

Pytest-Setup (`tests/conftest.py` bereits vorhanden). Neue Test-Module:

- `tests/core/test_crypto.py` — AES-GCM Round-Trip, Tampering-Detection, Key-Loading
- `tests/core/test_seed_admin.py` — Idempotenz, Fehler bei fehlender `.secrets`
- `tests/core/test_migrate_sqlite_to_pg.py` — Row-Counts pre/post, Foreign-Key-Integrität
- `tests/pubg/test_db_pg_tenant.py` — Inserts mit verschiedenen `tenant_id`-Werten, Read-Scoping
- `tests/pubg/test_poller_admin_archiving.py` — Mock-Telemetrie, prüft dass Non-Admin-Tenants keinen FTP-Call triggern
- `tests/scripts/test_backup_pg.py` — GFS-Rotations-Logik (mock filesystem statt echtes FTP)

DB-Tests laufen gegen eine separate Test-PG-DB (Connection via `OBS_KIT_PG_DSN_TEST`).

## Migration-Plan (Reihenfolge der Implementierung)

Wird vom writing-plans Skill detailliert. Grobe Schritte:

1. PG-Setup (DB, Rolle, Schema-Suchpfad) + DSN in `.secrets`.
2. `core/crypto.py` + Tests.
3. Schema-Migrations-SQL: `tenants`, `users`, `tenant_credentials`, `widget_tokens`, `pois` (leer).
4. `pubg/db_pg.py` mit `tenant_id` erweitern + Schema-Migration auf bestehende Test-DB.
5. Steam: `steam/db.py` analog auf PG portieren.
6. POIs: `data/pubg-pois.json` → DB.
7. `core/seed_admin.py` + `core/migrate_sqlite_to_pg.py` + dry-run validieren.
8. Echte Migration auf Live-DB ausführen (manueller Schritt mit dir).
9. `pubg/endpoints.py`, `pubg/poller.py`, `pubg/aggregations.py` auf tenant-aware umstellen.
10. Steam-Endpoints analog.
11. `scripts/backup_pg.py` + Cron-Konfig + manueller Restore-Test.
12. Smoke-Test: Widget-Stack lädt, Poller läuft, Backup wird geschrieben, Telemetrie archiviert.

## Offene Punkte

- **PG-Version**: welche Postgres-Version läuft auf dem Server? Schema nutzt `TEXT[]`, `TIMESTAMPTZ`, `BYTEA`, `SERIAL` — alles seit Jahren stabil. `JSONB` brauchen wir derzeit nicht. → vom User vor Implementation bestätigen.
- **Cron-Mechanik**: läuft `serve.py` bereits unter systemd? Wo werden Backup- und Poller-Crons aufgehängt? → vom User klären, kein Schema-Risk.

## Erfolgskriterien

- `psql obs_stream_kit -c "\dt"` zeigt das neue Schema.
- `python -m core.seed_admin` legt Tenant 1 idempotent an.
- Widgets/Endpoints liefern dieselben Werte wie vor der Migration (vergleichbar gegen SQLite-Backup-Files).
- `scripts/backup_pg.py` läuft 1× durch, schreibt nach `daily/`, prune lässt 7 Dateien stehen.
- Telemetrie wird für deinen Tenant nach HiDrive geschoben. Ein Mock-Non-Admin-Tenant (`is_admin=FALSE`) löst keinen FTP-Call aus.
- `pytest` grün.
