# Postgres + Tenant-Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-28-postgres-tenant-foundation-design.md`

**Goal:** PUBG + Steam von SQLite auf PostgreSQL umziehen, alle Daten-Tabellen mit `tenant_id` versehen, AES-GCM-Credential-Vault einführen, GFS-Backup auf FTP umstellen — alles ohne Auth-Schicht (kommt in Spec 2).

**Architecture:** Eigene Postgres-DB `obs_stream_kit` mit eigener Rolle und Schema `obs`. Neues Top-Level-Package `core/` für Querschnitts-Logik (DB-Connect, Crypto, Credentials, Seed, Migration). Bestehende PUBG-Module (`pubg/db_pg.py`, `pubg/poller.py`, …) werden um `tenant_id`-Parameter erweitert. Steam bekommt analog ein `steam/db_pg.py`. POIs als globale Tabelle (kein Tenant-Scoping). Backup-Skript läuft täglich als Cronjob mit GFS-Rotation (7d + 4w + 6m).

**Tech Stack:** Python 3.11+, PostgreSQL 14+, `psycopg2-binary`, `cryptography` (AES-GCM), `paramiko` (SFTP, schon im Projekt). Vanilla `pytest`. Keine ORMs, keine Migration-Frameworks — raw SQL passt zum Projektstil.

---

## File Structure

**Neu:**
- `core/__init__.py` — leeres Package
- `core/db.py` — PG-DSN-Loader + `connect()` Helper (extrahiert aus `pubg/db_pg.py`)
- `core/crypto.py` — `encrypt/decrypt/load_master_key` (AES-GCM)
- `core/credentials.py` — `get_credentials(tenant_id)` Bundle-Loader + Setter
- `core/schema.sql` — Identity-Tabellen (`users`, `tenants`, `tenant_credentials`, `widget_tokens`, `pois`)
- `core/init_schema.py` — CLI `python -m core.init_schema` (lädt alle Schemas in PG)
- `core/seed_admin.py` — CLI `python -m core.seed_admin` (legt Tenant 1 idempotent an)
- `core/migrate_sqlite_to_pg.py` — Ersetzt `pubg/migrate_to_pg.py`, Sub-Cmds `pubg`/`steam`/`pois`
- `steam/db_pg.py` — analog `pubg/db_pg.py`, mit `tenant_id`
- `scripts/backup_pg.py` — `pg_dump` + FTP-Push + GFS-Rotation
- `tests/core/__init__.py`, `tests/core/test_crypto.py`, `test_credentials.py`, `test_seed_admin.py`, `test_migrate_sqlite_to_pg.py`
- `tests/scripts/__init__.py`, `tests/scripts/test_backup_pg.py`
- `tests/pubg/test_db_pg_tenant.py` — Tenant-Scoping
- `tests/pubg/test_poller_admin_archiving.py` — Telemetrie-Gate

**Modifiziert:**
- `pubg/db_pg.py` — Schema um `tenant_id` ergänzt, PKs erweitert, DSN/Connect verschiebt sich zu `core/db.py`
- `pubg/poller.py` — Tenant-Iteration, Credentials aus DB, Telemetrie-Gate via `users.is_admin`
- `pubg/endpoints.py` — Queries kriegen `tenant_id=1` hardcoded
- `pubg/aggregations.py` — alle Queries scopen auf `tenant_id`
- `steam/db.py` — bleibt vorerst, wird vom Poller nicht mehr genutzt nach Migration (später entfernen)
- `steam/poller.py`, `steam/endpoints.py` — Tenant-aware, DB-Backend gewechselt
- `serve.py` — liest Twitch-Channel etc. aus `tenant_credentials` statt aus `.secrets`-Modul-Vars
- `requirements.txt` — `psycopg2-binary>=2.9`, `cryptography>=42` ergänzen
- `.secrets` (lokal, gitignored) — Zeile `OBS Kit PG DSN: ...` ergänzen

**Entfernt nach erfolgreicher Migration:**
- `pubg/migrate_to_pg.py` (→ `core/migrate_sqlite_to_pg.py`)
- `data/pubg-history.db` → umbenannt in `data/pubg-history.db.pre-pg-migration.bak`
- `data/steam-history.db` → analog
- `data/pubg-pois.json` → bleibt als Read-Only-Quelle, kann später entfallen

---

## Phase 1: Foundation — DB, Dependencies, Connection Helper

### Task 1: Dependencies + Postgres-Setup auf dem Server

**Files:**
- Modify: `requirements.txt`
- Modify: `.secrets` (lokal, manuell)

- [ ] **Step 1: Dependencies in `requirements.txt` ergänzen**

Aktueller Inhalt (1 Zeile: `paramiko>=3.0`). Anhängen:

```
paramiko>=3.0
psycopg2-binary>=2.9
cryptography>=42
```

- [ ] **Step 2: Dependencies installieren**

Run: `pip install -r requirements.txt`
Expected: psycopg2-binary und cryptography landen im venv ohne Fehler.

- [ ] **Step 3: PostgreSQL DB + Rolle anlegen (manuell auf dem Server)**

Run (als `postgres`-Superuser):
```bash
sudo -u postgres psql <<'EOF'
CREATE ROLE obs_stream LOGIN PASSWORD 'wechselmich';
CREATE DATABASE obs_stream_kit OWNER obs_stream ENCODING 'UTF8';
\c obs_stream_kit
CREATE SCHEMA obs AUTHORIZATION obs_stream;
ALTER ROLE obs_stream SET search_path = obs, public;
EOF
```

Expected: `CREATE ROLE`, `CREATE DATABASE`, `CREATE SCHEMA`, `ALTER ROLE` ohne Fehler.
**Hinweis:** Passwort durch ein echtes ersetzen, dann `.secrets` updaten.

- [ ] **Step 4: DSN in `.secrets` ergänzen**

`.secrets` editieren, neue Zeile (alte `PUBG PG DSN`-Zeile entfernen, falls existent):
```
OBS Kit PG DSN: postgresql://obs_stream:wechselmich@localhost:5432/obs_stream_kit
```

- [ ] **Step 5: Master-Key generieren + ablegen**

Run:
```bash
python -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

Ausgabe als Zeile in `~/.obs-stream-kit.env`:
```bash
export OBS_KIT_MASTER_KEY=<dein-base64-key>
```

Anschließend in der Shell sourcen:
```bash
echo 'source ~/.obs-stream-kit.env' >> ~/.bashrc
source ~/.obs-stream-kit.env
echo $OBS_KIT_MASTER_KEY  # zur Kontrolle, soll den Key zeigen
```

- [ ] **Step 6: Verbindungstest**

Run:
```bash
psql "$(grep '^OBS Kit PG DSN:' .secrets | cut -d: -f2- | tr -d ' ')" -c "SELECT current_database(), current_user, current_schema();"
```

Expected: `obs_stream_kit | obs_stream | obs`.

- [ ] **Step 7: Commit**

```bash
git add requirements.txt
git commit -m "build: psycopg2-binary + cryptography als Deps fuer PG-Foundation"
```

---

### Task 2: `core/db.py` — Connection-Helper

**Files:**
- Create: `core/__init__.py`
- Create: `core/db.py`
- Create: `tests/core/__init__.py`
- Create: `tests/core/test_db.py`

- [ ] **Step 1: Failing test schreiben**

`tests/core/test_db.py`:
```python
import os
import pytest
from core import db


def test_load_dsn_from_env(monkeypatch):
    monkeypatch.setenv("OBS_KIT_PG_DSN", "postgresql://test")
    assert db.load_dsn() == "postgresql://test"


def test_load_dsn_from_secrets(tmp_path, monkeypatch):
    monkeypatch.delenv("OBS_KIT_PG_DSN", raising=False)
    secrets = tmp_path / ".secrets"
    secrets.write_text("Other Key: value\nOBS Kit PG DSN: postgresql://from-secrets\n")
    assert db.load_dsn(str(secrets)) == "postgresql://from-secrets"


def test_load_dsn_missing(tmp_path, monkeypatch):
    monkeypatch.delenv("OBS_KIT_PG_DSN", raising=False)
    assert db.load_dsn(str(tmp_path / "nope")) is None
```

- [ ] **Step 2: Tests laufen lassen — sollen fehlschlagen**

Run: `pytest tests/core/test_db.py -v`
Expected: ImportError oder ModuleNotFoundError für `core`.

- [ ] **Step 3: `core/__init__.py` anlegen (leer) und `core/db.py` schreiben**

`core/__init__.py`: leer.

`core/db.py`:
```python
"""PostgreSQL-Connection-Helper fuer obs-stream-kit.

DSN-Quellen (in dieser Reihenfolge):
  1. Env-Variable OBS_KIT_PG_DSN
  2. .secrets-Datei, Zeile 'OBS Kit PG DSN: <dsn>'
"""
import os
from typing import Optional

try:
    import psycopg2
    import psycopg2.extras
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False


def load_dsn(secrets_path: str = ".secrets") -> Optional[str]:
    env = os.environ.get("OBS_KIT_PG_DSN")
    if env:
        return env
    if not os.path.exists(secrets_path):
        return None
    with open(secrets_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if ":" not in line:
                continue
            key, _, val = line.partition(":")
            if key.strip().lower().replace("-", " ") == "obs kit pg dsn":
                return val.strip()
    return None


def connect(dsn: Optional[str] = None):
    if not HAS_PSYCOPG2:
        raise ImportError("psycopg2 nicht installiert: pip install psycopg2-binary")
    if dsn is None:
        dsn = load_dsn()
    if not dsn:
        raise RuntimeError("OBS Kit PG DSN nicht gefunden (Env oder .secrets)")
    conn = psycopg2.connect(dsn, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = False
    return conn
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pytest tests/core/test_db.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add core/__init__.py core/db.py tests/core/__init__.py tests/core/test_db.py
git commit -m "feat(core): db.load_dsn + connect Helper (PG-Foundation Task 2)"
```

---

## Phase 2: Crypto

### Task 3: `core/crypto.py` — AES-GCM

**Files:**
- Create: `core/crypto.py`
- Create: `tests/core/test_crypto.py`

- [ ] **Step 1: Failing test**

`tests/core/test_crypto.py`:
```python
import base64
import os
import pytest
from cryptography.exceptions import InvalidTag
from core import crypto


def test_roundtrip():
    key = crypto.generate_key()
    ct = crypto.encrypt("hello world", key)
    assert crypto.decrypt(ct, key) == "hello world"


def test_different_nonce_each_call():
    key = crypto.generate_key()
    a = crypto.encrypt("same", key)
    b = crypto.encrypt("same", key)
    assert a != b  # Nonce muss random sein


def test_wrong_key_fails():
    key1 = crypto.generate_key()
    key2 = crypto.generate_key()
    ct = crypto.encrypt("secret", key1)
    with pytest.raises(InvalidTag):
        crypto.decrypt(ct, key2)


def test_tampered_ciphertext_fails():
    key = crypto.generate_key()
    ct = bytearray(crypto.encrypt("secret", key))
    ct[20] ^= 0x01  # flip ein bit
    with pytest.raises(InvalidTag):
        crypto.decrypt(bytes(ct), key)


def test_load_master_key_from_env(monkeypatch):
    raw = os.urandom(32)
    monkeypatch.setenv("OBS_KIT_MASTER_KEY", base64.b64encode(raw).decode())
    assert crypto.load_master_key() == raw


def test_load_master_key_missing(monkeypatch):
    monkeypatch.delenv("OBS_KIT_MASTER_KEY", raising=False)
    with pytest.raises(RuntimeError):
        crypto.load_master_key()


def test_load_master_key_wrong_length(monkeypatch):
    monkeypatch.setenv("OBS_KIT_MASTER_KEY", base64.b64encode(b"too-short").decode())
    with pytest.raises(ValueError):
        crypto.load_master_key()
```

- [ ] **Step 2: Tests laufen lassen — fail**

Run: `pytest tests/core/test_crypto.py -v`
Expected: ModuleNotFoundError für `core.crypto`.

- [ ] **Step 3: `core/crypto.py` implementieren**

```python
"""AES-GCM Verschluesselung fuer tenant_credentials._enc Felder.

Format: nonce (12 bytes) || ciphertext || tag (16 bytes)
Key: 32 Bytes (AES-256), aus Env-Var OBS_KIT_MASTER_KEY (Base64).
"""
import base64
import os
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


NONCE_BYTES = 12


def generate_key() -> bytes:
    return secrets.token_bytes(32)


def encrypt(plaintext: str, key: bytes) -> bytes:
    nonce = secrets.token_bytes(NONCE_BYTES)
    aead = AESGCM(key)
    ct_and_tag = aead.encrypt(nonce, plaintext.encode("utf-8"), None)
    return nonce + ct_and_tag


def decrypt(blob: bytes, key: bytes) -> str:
    nonce = blob[:NONCE_BYTES]
    ct_and_tag = blob[NONCE_BYTES:]
    aead = AESGCM(key)
    return aead.decrypt(nonce, ct_and_tag, None).decode("utf-8")


def load_master_key() -> bytes:
    raw = os.environ.get("OBS_KIT_MASTER_KEY")
    if not raw:
        raise RuntimeError(
            "OBS_KIT_MASTER_KEY nicht gesetzt. "
            "Generieren: python -c 'import secrets,base64; "
            "print(base64.b64encode(secrets.token_bytes(32)).decode())' "
            "und in ~/.obs-stream-kit.env als 'export OBS_KIT_MASTER_KEY=<wert>' ablegen."
        )
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError(f"OBS_KIT_MASTER_KEY muss 32 Bytes sein (war {len(key)})")
    return key
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pytest tests/core/test_crypto.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add core/crypto.py tests/core/test_crypto.py
git commit -m "feat(core): AES-GCM crypto Helper fuer Tenant-Credentials"
```

---

## Phase 3: Identity-Schema + Init

### Task 4: `core/schema.sql` + `core/init_schema.py`

**Files:**
- Create: `core/schema.sql`
- Create: `core/init_schema.py`

- [ ] **Step 1: Schema-SQL anlegen**

`core/schema.sql`:
```sql
-- obs-stream-kit Identity & Config Schema
-- Wird via `python -m core.init_schema` ausgefuehrt (idempotent)

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    twitch_user_id  TEXT UNIQUE,
    display_name    TEXT NOT NULL,
    is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
    id              SERIAL PRIMARY KEY,
    owner_user_id   INT NOT NULL REFERENCES users(id),
    slug            TEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_credentials (
    tenant_id                  INT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    pubg_name                  TEXT,
    pubg_platform              TEXT,
    pubg_account_id            TEXT,
    pubg_api_key_enc           BYTEA,
    twitch_channel             TEXT,
    twitch_client_id           TEXT,
    twitch_client_secret_enc   BYTEA,
    steam_id                   TEXT,
    steam_api_key_enc          BYTEA,
    ftp_config_enc             BYTEA,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS widget_tokens (
    token        TEXT PRIMARY KEY,
    tenant_id    INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    label        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_widget_tokens_tenant
    ON widget_tokens(tenant_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS pois (
    id          SERIAL PRIMARY KEY,
    map_name    TEXT NOT NULL,
    name        TEXT NOT NULL,
    poi_x       DOUBLE PRECISION NOT NULL,
    poi_y       DOUBLE PRECISION NOT NULL,
    radius_m    DOUBLE PRECISION,
    tags        TEXT[],
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pois_map ON pois(map_name);
```

- [ ] **Step 2: Init-CLI schreiben**

`core/init_schema.py`:
```python
"""CLI: laedt core/schema.sql in die PG-DB. Idempotent (CREATE TABLE IF NOT EXISTS).

Verwendung:
    python -m core.init_schema
"""
import os
import sys

from core import db


def main() -> int:
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path, "r", encoding="utf-8") as f:
        sql = f.read()
    conn = db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    finally:
        conn.close()
    print("Schema geladen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Schema in die DB laden**

Run: `python -m core.init_schema`
Expected: `Schema geladen.` und kein Fehler.

Verifikation:
```bash
psql "$(grep '^OBS Kit PG DSN:' .secrets | cut -d: -f2- | tr -d ' ')" -c "\dt"
```
Expected: Tabellen `users`, `tenants`, `tenant_credentials`, `widget_tokens`, `pois` listed.

- [ ] **Step 4: Commit**

```bash
git add core/schema.sql core/init_schema.py
git commit -m "feat(core): Identity-Schema (users/tenants/credentials/tokens/pois) + Init-CLI"
```

---

### Task 5: `core/credentials.py` — Vault-API

**Files:**
- Create: `core/credentials.py`
- Create: `tests/core/test_credentials.py`

- [ ] **Step 1: Failing tests**

`tests/core/test_credentials.py`:
```python
import os
import base64
import pytest
from core import crypto, credentials, db


@pytest.fixture
def pg_conn(monkeypatch):
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    conn = db.connect(dsn)
    with conn.cursor() as cur:
        cur.execute("TRUNCATE tenant_credentials, tenants, users RESTART IDENTITY CASCADE")
        cur.execute("INSERT INTO users (display_name, is_admin) VALUES ('T', TRUE) RETURNING id")
        uid = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenants (owner_user_id, slug, display_name) "
            "VALUES (%s, 'test', 'Test') RETURNING id",
            (uid,)
        )
        tid = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenant_credentials (tenant_id) VALUES (%s)", (tid,)
        )
    conn.commit()
    yield conn, tid
    conn.close()


def test_set_and_get_pubg_key(pg_conn, monkeypatch):
    conn, tid = pg_conn
    key = crypto.generate_key()
    monkeypatch.setenv("OBS_KIT_MASTER_KEY", base64.b64encode(key).decode())
    credentials.set_pubg(conn, tid, name="LuCKoR", platform="steam", api_key="dev-key-abc")
    bundle = credentials.get(conn, tid)
    assert bundle.pubg_name == "LuCKoR"
    assert bundle.pubg_platform == "steam"
    assert bundle.pubg_api_key == "dev-key-abc"


def test_get_returns_none_for_unset_fields(pg_conn, monkeypatch):
    conn, tid = pg_conn
    key = crypto.generate_key()
    monkeypatch.setenv("OBS_KIT_MASTER_KEY", base64.b64encode(key).decode())
    bundle = credentials.get(conn, tid)
    assert bundle.pubg_api_key is None
    assert bundle.steam_api_key is None


def test_get_missing_tenant_raises(pg_conn, monkeypatch):
    conn, _ = pg_conn
    key = crypto.generate_key()
    monkeypatch.setenv("OBS_KIT_MASTER_KEY", base64.b64encode(key).decode())
    with pytest.raises(LookupError):
        credentials.get(conn, 99999)
```

- [ ] **Step 2: Tests laufen — fail**

Run: `pytest tests/core/test_credentials.py -v`
Expected: ModuleNotFoundError für `core.credentials`.

- [ ] **Step 3: `core/credentials.py` schreiben**

```python
"""Tenant-Credential-Vault.

Liest/Schreibt tenant_credentials, verschluesselt sensitive Felder mit
core.crypto. Klartext-Felder (Namen, IDs) bleiben unverschluesselt.
"""
from dataclasses import dataclass
from typing import Optional

from core import crypto


@dataclass
class CredBundle:
    tenant_id: int
    pubg_name: Optional[str] = None
    pubg_platform: Optional[str] = None
    pubg_account_id: Optional[str] = None
    pubg_api_key: Optional[str] = None
    twitch_channel: Optional[str] = None
    twitch_client_id: Optional[str] = None
    twitch_client_secret: Optional[str] = None
    steam_id: Optional[str] = None
    steam_api_key: Optional[str] = None
    ftp_config: Optional[str] = None  # JSON-String


def get(conn, tenant_id: int) -> CredBundle:
    key = crypto.load_master_key()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM tenant_credentials WHERE tenant_id = %s", (tenant_id,)
        )
        row = cur.fetchone()
    if row is None:
        raise LookupError(f"Keine tenant_credentials fuer tenant_id={tenant_id}")
    def dec(blob):
        return crypto.decrypt(bytes(blob), key) if blob else None
    return CredBundle(
        tenant_id=tenant_id,
        pubg_name=row["pubg_name"],
        pubg_platform=row["pubg_platform"],
        pubg_account_id=row["pubg_account_id"],
        pubg_api_key=dec(row["pubg_api_key_enc"]),
        twitch_channel=row["twitch_channel"],
        twitch_client_id=row["twitch_client_id"],
        twitch_client_secret=dec(row["twitch_client_secret_enc"]),
        steam_id=row["steam_id"],
        steam_api_key=dec(row["steam_api_key_enc"]),
        ftp_config=dec(row["ftp_config_enc"]),
    )


def set_pubg(conn, tenant_id: int, *, name=None, platform=None,
             account_id=None, api_key=None):
    key = crypto.load_master_key()
    enc = crypto.encrypt(api_key, key) if api_key else None
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials
            SET pubg_name        = COALESCE(%s, pubg_name),
                pubg_platform    = COALESCE(%s, pubg_platform),
                pubg_account_id  = COALESCE(%s, pubg_account_id),
                pubg_api_key_enc = COALESCE(%s, pubg_api_key_enc),
                updated_at = now()
            WHERE tenant_id = %s
        """, (name, platform, account_id, enc, tenant_id))
    conn.commit()


def set_twitch(conn, tenant_id: int, *, channel=None, client_id=None,
               client_secret=None):
    key = crypto.load_master_key()
    enc = crypto.encrypt(client_secret, key) if client_secret else None
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials
            SET twitch_channel           = COALESCE(%s, twitch_channel),
                twitch_client_id         = COALESCE(%s, twitch_client_id),
                twitch_client_secret_enc = COALESCE(%s, twitch_client_secret_enc),
                updated_at = now()
            WHERE tenant_id = %s
        """, (channel, client_id, enc, tenant_id))
    conn.commit()


def set_steam(conn, tenant_id: int, *, steam_id=None, api_key=None):
    key = crypto.load_master_key()
    enc = crypto.encrypt(api_key, key) if api_key else None
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials
            SET steam_id          = COALESCE(%s, steam_id),
                steam_api_key_enc = COALESCE(%s, steam_api_key_enc),
                updated_at = now()
            WHERE tenant_id = %s
        """, (steam_id, enc, tenant_id))
    conn.commit()


def set_ftp(conn, tenant_id: int, *, config_json: str):
    key = crypto.load_master_key()
    enc = crypto.encrypt(config_json, key)
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE tenant_credentials SET ftp_config_enc = %s, updated_at = now()
            WHERE tenant_id = %s
        """, (enc, tenant_id))
    conn.commit()
```

- [ ] **Step 4: Test-PG-DB vorbereiten + Tests laufen lassen**

Test-DB anlegen (einmalig manuell):
```bash
sudo -u postgres psql <<'EOF'
CREATE DATABASE obs_stream_kit_test OWNER obs_stream;
\c obs_stream_kit_test
CREATE SCHEMA obs AUTHORIZATION obs_stream;
EOF
```

Env-Var setzen + Schema laden:
```bash
export OBS_KIT_PG_DSN_TEST="postgresql://obs_stream:wechselmich@localhost:5432/obs_stream_kit_test"
OBS_KIT_PG_DSN="$OBS_KIT_PG_DSN_TEST" python -m core.init_schema
```

Tests:
```bash
pytest tests/core/test_credentials.py -v
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add core/credentials.py tests/core/test_credentials.py
git commit -m "feat(core): credentials Vault-API (get/set_pubg/set_twitch/set_steam/set_ftp)"
```

---

## Phase 4: PUBG-Schema mit Tenant-ID

### Task 6: `pubg/db_pg.py` Schema mit `tenant_id`

**Files:**
- Modify: `pubg/db_pg.py`
- Create: `tests/pubg/test_db_pg_tenant.py`

- [ ] **Step 1: Failing test schreiben**

`tests/pubg/test_db_pg_tenant.py`:
```python
import os
import pytest
from core import db as core_db
from pubg import db_pg


@pytest.fixture
def pg():
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    conn = core_db.connect(dsn)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS obs CASCADE")
        cur.execute("CREATE SCHEMA obs AUTHORIZATION obs_stream")
    conn.commit()
    # Schema neu laden
    import core.init_schema as init
    schema_path = os.path.join(os.path.dirname(init.__file__), "schema.sql")
    with conn.cursor() as cur:
        cur.execute(open(schema_path).read())
        cur.execute(db_pg.PG_SCHEMA)
        cur.execute(
            "INSERT INTO users (display_name, is_admin) VALUES ('A',TRUE) RETURNING id"
        )
        uid = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenants (owner_user_id,slug,display_name) "
            "VALUES (%s,'t1','T1') RETURNING id", (uid,))
        t1 = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenants (owner_user_id,slug,display_name) "
            "VALUES (%s,'t2','T2') RETURNING id", (uid,))
        t2 = cur.fetchone()["id"]
    conn.commit()
    yield conn, t1, t2
    conn.close()


def test_matches_have_tenant_id_in_pk(pg):
    conn, t1, t2 = pg
    with conn.cursor() as cur:
        # selbes match_id in beiden Tenants moeglich
        cur.execute("""
            INSERT INTO matches (tenant_id, match_id, map_name, game_mode, played_at)
            VALUES (%s, 'm1', 'Erangel', 'squad', '2026-05-28T00:00:00Z')
        """, (t1,))
        cur.execute("""
            INSERT INTO matches (tenant_id, match_id, map_name, game_mode, played_at)
            VALUES (%s, 'm1', 'Erangel', 'squad', '2026-05-28T00:00:00Z')
        """, (t2,))
    conn.commit()
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM matches WHERE match_id='m1'")
        assert cur.fetchone()["n"] == 2


def test_matches_scope_query(pg):
    conn, t1, t2 = pg
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO matches (tenant_id, match_id, map_name, game_mode, played_at)
            VALUES (%s, 'mA', 'Erangel', 'squad', '2026-05-28T00:00:00Z'),
                   (%s, 'mB', 'Erangel', 'squad', '2026-05-28T00:00:00Z')
        """, (t1, t2))
    conn.commit()
    with conn.cursor() as cur:
        cur.execute("SELECT match_id FROM matches WHERE tenant_id = %s", (t1,))
        rows = [r["match_id"] for r in cur.fetchall()]
        assert rows == ["mA"]
```

- [ ] **Step 2: Tests laufen — fail (kein `tenant_id`)**

Run: `pytest tests/pubg/test_db_pg_tenant.py -v`
Expected: psycopg2.errors.UndefinedColumn `tenant_id`.

- [ ] **Step 3: `pubg/db_pg.py` PG_SCHEMA umbauen**

`pubg/db_pg.py:21-173` (Konstante `PG_SCHEMA`) ersetzen durch:

```python
PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    tenant_id       INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    account_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    platform        TEXT NOT NULL,
    is_self         INTEGER DEFAULT 0,
    first_seen_at   TEXT NOT NULL,
    last_polled_at  TEXT,
    PRIMARY KEY (tenant_id, account_id)
);

CREATE TABLE IF NOT EXISTS matches (
    tenant_id         INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    match_id          TEXT NOT NULL,
    map_name          TEXT NOT NULL,
    game_mode         TEXT NOT NULL,
    is_ranked         INTEGER DEFAULT 0,
    duration_secs     INTEGER,
    played_at         TEXT NOT NULL,
    telemetry_url     TEXT,
    telemetry_fetched INTEGER DEFAULT 0,
    telemetry_schema  INTEGER DEFAULT 0,
    PRIMARY KEY (tenant_id, match_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_tenant_played
    ON matches(tenant_id, played_at DESC);

CREATE TABLE IF NOT EXISTS participants (
    tenant_id        INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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
    damage_dealt     DOUBLE PRECISION,
    longest_kill     DOUBLE PRECISION,
    time_survived    INTEGER,
    walk_distance    DOUBLE PRECISION,
    ride_distance    DOUBLE PRECISION,
    swim_distance    DOUBLE PRECISION,
    weapons_acquired INTEGER,
    heals            INTEGER,
    boosts           INTEGER,
    team_kills       INTEGER,
    PRIMARY KEY (tenant_id, match_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_part_tenant_player
    ON participants(tenant_id, account_id);
CREATE INDEX IF NOT EXISTS idx_part_tenant_match
    ON participants(tenant_id, match_id);

CREATE TABLE IF NOT EXISTS match_team_mapping (
    tenant_id    INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    match_id     TEXT NOT NULL,
    account_id   TEXT NOT NULL,
    team_id      INTEGER,
    kills        INTEGER,
    place        INTEGER,
    time_survived INTEGER,
    PRIMARY KEY (tenant_id, match_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_mtm_tenant_match
    ON match_team_mapping(tenant_id, match_id);

CREATE TABLE IF NOT EXISTS telemetry_events (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    match_id        TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    timestamp_ms    BIGINT,
    actor_account   TEXT,
    target_account  TEXT,
    actor_x         DOUBLE PRECISION,
    actor_y         DOUBLE PRECISION,
    actor_z         DOUBLE PRECISION,
    actor_health    DOUBLE PRECISION,
    victim_x        DOUBLE PRECISION,
    victim_y        DOUBLE PRECISION,
    weapon          TEXT,
    distance        DOUBLE PRECISION,
    damage          DOUBLE PRECISION,
    payload_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_tel_tenant_match
    ON telemetry_events(tenant_id, match_id);
CREATE INDEX IF NOT EXISTS idx_tel_tenant_actor
    ON telemetry_events(tenant_id, actor_account);
CREATE INDEX IF NOT EXISTS idx_tel_type
    ON telemetry_events(event_type);

CREATE TABLE IF NOT EXISTS player_lifetime (
    tenant_id         INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    account_id        TEXT NOT NULL,
    mode              TEXT NOT NULL,
    rounds_played     INTEGER,
    wins              INTEGER,
    top10s            INTEGER,
    win_rate          DOUBLE PRECISION,
    top10_rate        DOUBLE PRECISION,
    kills             INTEGER,
    kd_ratio          DOUBLE PRECISION,
    headshot_kills    INTEGER,
    headshot_rate     DOUBLE PRECISION,
    avg_damage        DOUBLE PRECISION,
    longest_kill      DOUBLE PRECISION,
    time_survived_sec INTEGER,
    assists           INTEGER,
    damage_dealt      DOUBLE PRECISION,
    dbnos             INTEGER,
    revives           INTEGER,
    team_kills        INTEGER,
    losses            INTEGER,
    last_refreshed    TEXT,
    PRIMARY KEY (tenant_id, account_id, mode)
);

CREATE TABLE IF NOT EXISTS player_season (
    tenant_id         INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    account_id        TEXT NOT NULL,
    season_id         TEXT NOT NULL,
    mode              TEXT NOT NULL,
    rounds_played     INTEGER,
    wins              INTEGER,
    top10s            INTEGER,
    win_rate          DOUBLE PRECISION,
    top10_rate        DOUBLE PRECISION,
    kills             INTEGER,
    kd_ratio          DOUBLE PRECISION,
    headshot_kills    INTEGER,
    headshot_rate     DOUBLE PRECISION,
    avg_damage        DOUBLE PRECISION,
    longest_kill      DOUBLE PRECISION,
    time_survived_sec INTEGER,
    assists           INTEGER,
    damage_dealt      DOUBLE PRECISION,
    dbnos             INTEGER,
    revives           INTEGER,
    team_kills        INTEGER,
    losses            INTEGER,
    last_refreshed    TEXT,
    PRIMARY KEY (tenant_id, account_id, season_id, mode)
);

CREATE TABLE IF NOT EXISTS settings (
    tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS pubg_achievements_seen (
    tenant_id       INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    achievement_id  TEXT NOT NULL,
    match_id        TEXT NOT NULL,
    label           TEXT,
    icon            TEXT,
    played_at       TEXT,
    detected_at     BIGINT NOT NULL,
    displayed_at    BIGINT,
    is_rare         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, achievement_id, match_id)
);
CREATE INDEX IF NOT EXISTS idx_pubg_ach_undisplayed
    ON pubg_achievements_seen (tenant_id, displayed_at);
"""
```

Außerdem in `pubg/db_pg.py` die `load_dsn()` und `connect()` Funktionen (Zeilen 176–200) **entfernen** und stattdessen am Anfang importieren:

```python
from core.db import load_dsn, connect  # noqa: F401  (Re-Export fuer Backward-Compat)
```

- [ ] **Step 4: Tests laufen — pass**

Run: `pytest tests/pubg/test_db_pg_tenant.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add pubg/db_pg.py tests/pubg/test_db_pg_tenant.py
git commit -m "feat(pubg): db_pg PG_SCHEMA mit tenant_id auf allen Tabellen + Indexen"
```

---

## Phase 5: Steam-Schema mit Tenant-ID

### Task 7: `steam/db_pg.py`

**Files:**
- Create: `steam/db_pg.py`

- [ ] **Step 1: Schema-Modul anlegen (analog `pubg/db_pg.py`)**

`steam/db_pg.py`:
```python
"""PostgreSQL-Adapter fuer Steam-Daten. Analog zu pubg/db_pg.py.

Schema-Mapping SQLite -> Postgres:
  TEXT bleibt TEXT, INTEGER bleibt INTEGER, AUTOINCREMENT n/a (PK Composite).
  Alle Tabellen kriegen tenant_id INT NOT NULL.
"""
from core.db import load_dsn, connect  # noqa: F401  (Re-Export)


PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS steam_achievements_seen (
    tenant_id            INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    steam_id             TEXT NOT NULL,
    app_id               INTEGER NOT NULL,
    achievement_api_name TEXT NOT NULL,
    unlocked_at          BIGINT NOT NULL,
    display_name         TEXT,
    description          TEXT,
    icon_url             TEXT,
    displayed_at         BIGINT,
    PRIMARY KEY (tenant_id, steam_id, app_id, achievement_api_name)
);
CREATE INDEX IF NOT EXISTS idx_steam_ach_undisplayed
    ON steam_achievements_seen (tenant_id, steam_id, displayed_at);

CREATE TABLE IF NOT EXISTS steam_app_schema (
    app_id               INTEGER PRIMARY KEY,
    game_name            TEXT,
    achievement_count    INTEGER NOT NULL DEFAULT 0,
    schema_json          TEXT,
    global_pct_json      TEXT,
    global_pct_cached_at BIGINT,
    cached_at            BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS steam_app_progress (
    tenant_id      INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    steam_id       TEXT NOT NULL,
    app_id         INTEGER NOT NULL,
    unlocked_count INTEGER NOT NULL DEFAULT 0,
    last_checked   BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, steam_id, app_id)
);

CREATE TABLE IF NOT EXISTS steam_owned_games (
    tenant_id            INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    steam_id             TEXT NOT NULL,
    app_id               INTEGER NOT NULL,
    name                 TEXT,
    img_icon_url         TEXT,
    img_logo_url         TEXT,
    playtime_forever_min INTEGER NOT NULL DEFAULT 0,
    playtime_2weeks_min  INTEGER NOT NULL DEFAULT 0,
    last_played_at       BIGINT,
    steam_last_played    BIGINT,
    last_synced          BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, steam_id, app_id)
);

CREATE TABLE IF NOT EXISTS steam_app_schema_lang (
    app_id      INTEGER NOT NULL,
    lang        TEXT NOT NULL,
    schema_json TEXT,
    cached_at   BIGINT NOT NULL,
    PRIMARY KEY (app_id, lang)
);

CREATE TABLE IF NOT EXISTS steam_app_details (
    app_id            INTEGER PRIMARY KEY,
    header_image      TEXT,
    short_description TEXT,
    is_coop           INTEGER NOT NULL DEFAULT 0,
    is_multiplayer    INTEGER NOT NULL DEFAULT 0,
    category_ids      TEXT,
    genre_names       TEXT,
    cached_at         BIGINT NOT NULL
);
"""


COOP_CATEGORY_IDS        = {9, 36, 38}
MULTIPLAYER_CATEGORY_IDS = {1, 27, 36, 38}


def init_schema(conn):
    with conn.cursor() as cur:
        cur.execute(PG_SCHEMA)
    conn.commit()
```

**Hinweis:** `steam_app_schema`, `steam_app_schema_lang`, `steam_app_details` sind **global** (kein `tenant_id`), weil Steam-Spieldaten anbieter-unabhängig sind. Nur Per-Player-Daten (Achievements-Status, owned_games) bekommen `tenant_id`.

- [ ] **Step 2: Schema-Load testen**

Run:
```bash
python -c "
from core import db
from steam import db_pg
conn = db.connect()
db_pg.init_schema(conn)
conn.close()
print('Steam-Schema geladen.')
"
```
Expected: `Steam-Schema geladen.` ohne Fehler.

- [ ] **Step 3: Commit**

```bash
git add steam/db_pg.py
git commit -m "feat(steam): db_pg PG-Schema mit tenant_id auf Per-User-Tabellen"
```

---

## Phase 6: Migration-Tool

### Task 8: `core/migrate_sqlite_to_pg.py`

**Files:**
- Create: `core/migrate_sqlite_to_pg.py`
- Create: `tests/core/test_migrate_sqlite_to_pg.py`
- Delete (am Ende): `pubg/migrate_to_pg.py`

- [ ] **Step 1: Test schreiben**

`tests/core/test_migrate_sqlite_to_pg.py`:
```python
import os
import sqlite3
import pytest
from core import db as core_db, migrate_sqlite_to_pg as migrate


@pytest.fixture
def fresh_pg(monkeypatch):
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    conn = core_db.connect(dsn)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS obs CASCADE")
        cur.execute("CREATE SCHEMA obs AUTHORIZATION obs_stream")
    conn.commit()
    # Identity-Schema + pubg + steam laden
    from core import init_schema
    from pubg import db_pg as pubg_pg
    from steam import db_pg as steam_pg
    with conn.cursor() as cur:
        with open(os.path.join(os.path.dirname(init_schema.__file__), "schema.sql")) as f:
            cur.execute(f.read())
        cur.execute(pubg_pg.PG_SCHEMA)
        cur.execute(steam_pg.PG_SCHEMA)
        cur.execute(
            "INSERT INTO users (display_name, is_admin) VALUES ('A',TRUE) RETURNING id"
        )
        uid = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO tenants (owner_user_id,slug,display_name) "
            "VALUES (%s,'a','Admin') RETURNING id", (uid,))
        tid = cur.fetchone()["id"]
    conn.commit()
    yield conn, tid
    conn.close()


def test_migrate_pubg_players(fresh_pg, tmp_path):
    conn, tid = fresh_pg
    sqlite_path = tmp_path / "pubg.db"
    sq = sqlite3.connect(str(sqlite_path))
    sq.executescript("""
        CREATE TABLE players (
            account_id TEXT PRIMARY KEY, name TEXT, platform TEXT,
            is_self INTEGER, first_seen_at TEXT, last_polled_at TEXT);
        INSERT INTO players VALUES ('account.x','LuCKoR','steam',1,'2026-01-01',NULL);
        INSERT INTO players VALUES ('account.y','Mate','steam',0,'2026-01-02',NULL);
    """)
    sq.commit()
    sq.close()
    migrate.migrate_pubg(str(sqlite_path), conn, tid)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM players WHERE tenant_id = %s", (tid,))
        assert cur.fetchone()["n"] == 2
        cur.execute("SELECT name FROM players WHERE account_id='account.x' AND tenant_id=%s", (tid,))
        assert cur.fetchone()["name"] == "LuCKoR"
```

- [ ] **Step 2: Test laufen — fail**

Run: `pytest tests/core/test_migrate_sqlite_to_pg.py -v`
Expected: ModuleNotFoundError für `core.migrate_sqlite_to_pg`.

- [ ] **Step 3: `core/migrate_sqlite_to_pg.py` implementieren**

```python
"""Migration: SQLite (pubg-history.db, steam-history.db) → PostgreSQL.

Verwendung:
    python -m core.migrate_sqlite_to_pg pubg  --tenant-id 1 [--db data/pubg-history.db]
    python -m core.migrate_sqlite_to_pg steam --tenant-id 1 [--db data/steam-history.db]
    python -m core.migrate_sqlite_to_pg pois  [--json data/pubg-pois.json]
    python -m core.migrate_sqlite_to_pg all   --tenant-id 1
"""
import argparse
import json
import os
import sqlite3
import sys

from core import db as core_db


# (column-list, sqlite-select) je Tabelle. ORDER matters: parents first.
PUBG_TABLES = [
    ("players",
     ["account_id","name","platform","is_self","first_seen_at","last_polled_at"]),
    ("matches",
     ["match_id","map_name","game_mode","is_ranked","duration_secs","played_at",
      "telemetry_url","telemetry_fetched","telemetry_schema"]),
    ("participants",
     ["match_id","account_id","name","team_id","place","kills","headshot_kills",
      "assists","dbnos","revives","damage_dealt","longest_kill","time_survived",
      "walk_distance","ride_distance","swim_distance","weapons_acquired",
      "heals","boosts","team_kills"]),
    ("match_team_mapping",
     ["match_id","account_id","team_id","kills","place","time_survived"]),
    ("player_lifetime",
     ["account_id","mode","rounds_played","wins","top10s","win_rate","top10_rate",
      "kills","kd_ratio","headshot_kills","headshot_rate","avg_damage",
      "longest_kill","time_survived_sec","assists","damage_dealt","dbnos",
      "revives","team_kills","losses","last_refreshed"]),
    ("player_season",
     ["account_id","season_id","mode","rounds_played","wins","top10s","win_rate",
      "top10_rate","kills","kd_ratio","headshot_kills","headshot_rate",
      "avg_damage","longest_kill","time_survived_sec","assists","damage_dealt",
      "dbnos","revives","team_kills","losses","last_refreshed"]),
    ("settings", ["key","value","updated_at"]),
    ("pubg_achievements_seen",
     ["achievement_id","match_id","label","icon","played_at","detected_at",
      "displayed_at","is_rare"]),
]

STEAM_PER_TENANT_TABLES = [
    ("steam_achievements_seen",
     ["steam_id","app_id","achievement_api_name","unlocked_at","display_name",
      "description","icon_url","displayed_at"]),
    ("steam_app_progress", ["steam_id","app_id","unlocked_count","last_checked"]),
    ("steam_owned_games",
     ["steam_id","app_id","name","img_icon_url","img_logo_url",
      "playtime_forever_min","playtime_2weeks_min","last_played_at",
      "steam_last_played","last_synced"]),
]

STEAM_GLOBAL_TABLES = [
    ("steam_app_schema",
     ["app_id","game_name","achievement_count","schema_json","global_pct_json",
      "global_pct_cached_at","cached_at"]),
    ("steam_app_schema_lang", ["app_id","lang","schema_json","cached_at"]),
    ("steam_app_details",
     ["app_id","header_image","short_description","is_coop","is_multiplayer",
      "category_ids","genre_names","cached_at"]),
]


def _copy(sqlite_conn, pg_conn, table, cols, tenant_id):
    """Copy rows from sqlite into postgres. If tenant_id is not None, prepend it."""
    sq_rows = sqlite_conn.execute(
        f"SELECT {','.join(cols)} FROM {table}"
    ).fetchall()
    if not sq_rows:
        print(f"  {table}: 0 Rows")
        return 0
    if tenant_id is None:
        pg_cols = cols
        values_tpl = "(" + ",".join(["%s"] * len(cols)) + ")"
        rows = [tuple(r) for r in sq_rows]
    else:
        pg_cols = ["tenant_id"] + cols
        values_tpl = "(" + ",".join(["%s"] * (len(cols) + 1)) + ")"
        rows = [(tenant_id, *tuple(r)) for r in sq_rows]
    with pg_conn.cursor() as cur:
        from psycopg2.extras import execute_values
        execute_values(
            cur,
            f"INSERT INTO {table} ({','.join(pg_cols)}) VALUES %s "
            f"ON CONFLICT DO NOTHING",
            rows,
            template=values_tpl,
        )
    pg_conn.commit()
    print(f"  {table}: {len(rows)} Rows")
    return len(rows)


def migrate_pubg(sqlite_path: str, pg_conn, tenant_id: int) -> None:
    sq = sqlite3.connect(sqlite_path)
    sq.row_factory = sqlite3.Row
    print(f"PUBG-Migration aus {sqlite_path} → tenant_id={tenant_id}")
    for table, cols in PUBG_TABLES:
        try:
            _copy(sq, pg_conn, table, cols, tenant_id)
        except sqlite3.OperationalError as e:
            print(f"  {table}: SKIP ({e})")
    sq.close()


def migrate_steam(sqlite_path: str, pg_conn, tenant_id: int) -> None:
    sq = sqlite3.connect(sqlite_path)
    sq.row_factory = sqlite3.Row
    print(f"Steam-Migration aus {sqlite_path} → tenant_id={tenant_id}")
    for table, cols in STEAM_PER_TENANT_TABLES:
        try:
            _copy(sq, pg_conn, table, cols, tenant_id)
        except sqlite3.OperationalError as e:
            print(f"  {table}: SKIP ({e})")
    for table, cols in STEAM_GLOBAL_TABLES:
        try:
            _copy(sq, pg_conn, table, cols, None)
        except sqlite3.OperationalError as e:
            print(f"  {table}: SKIP ({e})")
    sq.close()


def migrate_pois(json_path: str, pg_conn) -> None:
    if not os.path.exists(json_path):
        print(f"POI-JSON nicht gefunden: {json_path}")
        return
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Erwartetes Format: {<map_name>: [{name,x,y,radius_m?,tags?,notes?}, ...]}
    rows = []
    for map_name, pois in data.items():
        for poi in pois:
            rows.append((
                map_name, poi["name"], poi["x"], poi["y"],
                poi.get("radius_m"), poi.get("tags") or [], poi.get("notes"),
            ))
    if not rows:
        print("Keine POIs gefunden.")
        return
    with pg_conn.cursor() as cur:
        from psycopg2.extras import execute_values
        execute_values(
            cur,
            "INSERT INTO pois (map_name,name,poi_x,poi_y,radius_m,tags,notes) "
            "VALUES %s ON CONFLICT DO NOTHING",
            rows,
        )
    pg_conn.commit()
    print(f"POIs: {len(rows)} Rows")


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["pubg", "steam", "pois", "all"])
    p.add_argument("--tenant-id", type=int, default=1)
    p.add_argument("--db", help="Pfad zur SQLite-DB (Default: data/<domain>-history.db)")
    p.add_argument("--json", help="POI-JSON (Default: data/pubg-pois.json)")
    args = p.parse_args(argv)

    pg = core_db.connect()
    try:
        if args.cmd in ("pubg", "all"):
            path = args.db or "data/pubg-history.db"
            migrate_pubg(path, pg, args.tenant_id)
        if args.cmd in ("steam", "all"):
            path = args.db or "data/steam-history.db"
            migrate_steam(path, pg, args.tenant_id)
        if args.cmd in ("pois", "all"):
            path = args.json or "data/pubg-pois.json"
            migrate_pois(path, pg)
    finally:
        pg.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Tests laufen — pass**

Run: `pytest tests/core/test_migrate_sqlite_to_pg.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add core/migrate_sqlite_to_pg.py tests/core/test_migrate_sqlite_to_pg.py
git commit -m "feat(core): SQLite→PG Migrations-CLI (pubg/steam/pois) mit --tenant-id"
```

---

## Phase 7: Seed-Admin

### Task 9: `core/seed_admin.py`

**Files:**
- Create: `core/seed_admin.py`
- Create: `tests/core/test_seed_admin.py`

- [ ] **Step 1: Test schreiben**

`tests/core/test_seed_admin.py`:
```python
import os
import base64
import pytest
from core import crypto, db as core_db, seed_admin


@pytest.fixture
def fresh_pg(monkeypatch):
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    monkeypatch.setenv("OBS_KIT_PG_DSN", dsn)
    monkeypatch.setenv("OBS_KIT_MASTER_KEY",
                       base64.b64encode(crypto.generate_key()).decode())
    conn = core_db.connect(dsn)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS obs CASCADE")
        cur.execute("CREATE SCHEMA obs AUTHORIZATION obs_stream")
    conn.commit()
    from core import init_schema
    with conn.cursor() as cur:
        with open(os.path.join(os.path.dirname(init_schema.__file__),
                               "schema.sql")) as f:
            cur.execute(f.read())
    conn.commit()
    yield conn
    conn.close()


def test_seed_creates_admin_tenant(fresh_pg, tmp_path):
    secrets = tmp_path / ".secrets"
    secrets.write_text(
        "Twitch-Channel: LuCKoR_HD\n"
        "Client-ID: tw-id\n"
        "Client-Secret: tw-secret\n"
        "Steam API Key: steam-abc\n"
        "Steam ID: 7656\n"
        "PUBG API Key: pubg-key\n"
        "FTP-Backup-Host: ftp.host\n"
    )
    pubg_cfg = tmp_path / "pubg.json"
    pubg_cfg.write_text('{"nick":"LuCKoR","platform":"steam"}')

    seed_admin.run(secrets_path=str(secrets), pubg_config_path=str(pubg_cfg))

    with fresh_pg.cursor() as cur:
        cur.execute("SELECT id, is_admin FROM users")
        rows = cur.fetchall()
        assert len(rows) == 1
        assert rows[0]["is_admin"] is True
        cur.execute("SELECT id, slug FROM tenants")
        rows = cur.fetchall()
        assert len(rows) == 1
        assert rows[0]["id"] == 1
        cur.execute("SELECT pubg_name, pubg_platform FROM tenant_credentials")
        creds = cur.fetchone()
        assert creds["pubg_name"] == "LuCKoR"
        assert creds["pubg_platform"] == "steam"
        cur.execute("SELECT count(*) AS n FROM widget_tokens")
        assert cur.fetchone()["n"] == 1


def test_seed_idempotent(fresh_pg, tmp_path, capsys):
    secrets = tmp_path / ".secrets"
    secrets.write_text("Twitch-Channel: x\n")
    pubg_cfg = tmp_path / "pubg.json"
    pubg_cfg.write_text('{"nick":"x","platform":"steam"}')
    seed_admin.run(secrets_path=str(secrets), pubg_config_path=str(pubg_cfg))
    seed_admin.run(secrets_path=str(secrets), pubg_config_path=str(pubg_cfg))
    out = capsys.readouterr().out
    assert "schon vorhanden" in out.lower()
    with fresh_pg.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM tenants")
        assert cur.fetchone()["n"] == 1
```

- [ ] **Step 2: Tests laufen — fail**

Run: `pytest tests/core/test_seed_admin.py -v`
Expected: ModuleNotFoundError für `core.seed_admin`.

- [ ] **Step 3: `core/seed_admin.py` implementieren**

```python
"""CLI: Initialer Seed des Admin-Tenants (tenant_id=1) aus .secrets + config/pubg.json.

Idempotent: wenn Tenant 1 schon existiert, passiert nichts (Warnung).
"""
import json
import os
import secrets as py_secrets
import sys

from core import db as core_db, credentials


def _parse_secrets(path: str) -> dict:
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if ":" not in line or line.startswith("#"):
                continue
            k, _, v = line.partition(":")
            out[k.strip()] = v.strip()
    return out


def _gen_token() -> str:
    return "tok_" + py_secrets.token_hex(16)


def run(secrets_path: str = ".secrets",
        pubg_config_path: str = "config/pubg.json") -> int:
    sec = _parse_secrets(secrets_path)
    pubg_cfg = {}
    if os.path.exists(pubg_config_path):
        with open(pubg_config_path, "r", encoding="utf-8") as f:
            pubg_cfg = json.load(f)

    conn = core_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM tenants WHERE id = 1")
            if cur.fetchone():
                print("Tenant 1 schon vorhanden — Seed uebersprungen.")
                return 0
            cur.execute("""
                INSERT INTO users (display_name, is_admin, twitch_user_id)
                VALUES (%s, TRUE, NULL) RETURNING id
            """, (sec.get("Twitch-Channel") or "Admin",))
            uid = cur.fetchone()["id"]
            cur.execute("""
                INSERT INTO tenants (id, owner_user_id, slug, display_name)
                VALUES (1, %s, 'admin', %s)
            """, (uid, sec.get("Twitch-Channel") or "Admin"))
            cur.execute(
                "INSERT INTO tenant_credentials (tenant_id) VALUES (1)"
            )
            cur.execute("""
                INSERT INTO widget_tokens (token, tenant_id, label)
                VALUES (%s, 1, 'Default')
            """, (_gen_token(),))
        conn.commit()

        # Credentials befuellen (verschluesselt via core.credentials)
        credentials.set_pubg(
            conn, 1,
            name=pubg_cfg.get("nick"),
            platform=pubg_cfg.get("platform"),
            api_key=sec.get("PUBG API Key") or None,
        )
        credentials.set_twitch(
            conn, 1,
            channel=sec.get("Twitch-Channel") or None,
            client_id=sec.get("Client-ID") or None,
            client_secret=sec.get("Client-Secret") or None,
        )
        credentials.set_steam(
            conn, 1,
            steam_id=sec.get("Steam ID") or None,
            api_key=sec.get("Steam API Key") or None,
        )
        ftp_cfg = {
            k.replace("FTP-Backup-", "").lower(): v
            for k, v in sec.items()
            if k.startswith("FTP-Backup-")
        }
        if ftp_cfg:
            credentials.set_ftp(conn, 1, config_json=json.dumps(ftp_cfg))
        print("Admin-Tenant 1 angelegt.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(run())
```

- [ ] **Step 4: Tests laufen — pass**

Run: `pytest tests/core/test_seed_admin.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add core/seed_admin.py tests/core/test_seed_admin.py
git commit -m "feat(core): seed_admin CLI fuer initialen Admin-Tenant (idempotent)"
```

---

## Phase 8: Live-Migration durchführen

### Task 10: Live-DB-Migration auf dem Server (manueller Schritt)

**Files:**
- Modify: `data/pubg-history.db` → Backup
- Modify: `data/steam-history.db` → Backup

> **⚠️ Diesen Task NICHT in Subagent ausführen — Live-Daten-Migration mit User-Bestätigung.**

- [ ] **Step 1: Volle Backup-Kopie der SQLite-DBs**

```bash
cp data/pubg-history.db   data/pubg-history.db.pre-pg-migration.bak
cp data/steam-history.db  data/steam-history.db.pre-pg-migration.bak
cp data/pubg-pois.json    data/pubg-pois.json.pre-pg-migration.bak
```

- [ ] **Step 2: Schema in Live-DB laden**

```bash
python -m core.init_schema
python -c "
from core import db
from pubg import db_pg as p
from steam import db_pg as s
conn = db.connect()
with conn.cursor() as cur:
    cur.execute(p.PG_SCHEMA)
    cur.execute(s.PG_SCHEMA)
conn.commit()
conn.close()
print('Domain-Schemas geladen.')
"
```
Expected: keine Fehler.

- [ ] **Step 3: Admin-Tenant seeden**

```bash
python -m core.seed_admin
```
Expected: `Admin-Tenant 1 angelegt.`

- [ ] **Step 4: PUBG-Daten migrieren**

```bash
python -m core.migrate_sqlite_to_pg pubg --tenant-id 1
```
Expected: pro Tabelle eine Row-Count-Zeile.

- [ ] **Step 5: Steam-Daten migrieren**

```bash
python -m core.migrate_sqlite_to_pg steam --tenant-id 1
```
Expected: dito.

- [ ] **Step 6: POIs migrieren**

```bash
python -m core.migrate_sqlite_to_pg pois
```
Expected: Row-Count.

- [ ] **Step 7: Verifikation**

```bash
python <<'EOF'
from core import db
conn = db.connect()
with conn.cursor() as cur:
    for tab in ["matches", "participants", "steam_owned_games", "pois"]:
        cur.execute(f"SELECT count(*) AS n FROM {tab}")
        print(f"{tab}: {cur.fetchone()['n']}")
conn.close()
EOF
```
Expected: Counts > 0 für die migrierten Tabellen.

- [ ] **Step 8: Commit (Backup-Files sind gitignored, aber Migration ist Meilenstein)**

```bash
git commit --allow-empty -m "chore(migration): SQLite -> PG fuer Tenant 1 ausgefuehrt"
```

---

## Phase 9: PUBG-Domain auf Tenant-aware Reads

### Task 11: `pubg/endpoints.py` und `pubg/aggregations.py`

**Files:**
- Modify: `pubg/endpoints.py`
- Modify: `pubg/aggregations.py`

- [ ] **Step 1: `pubg/endpoints.py` — Tenant-Hardcode einführen**

In `pubg/endpoints.py` (Datei-Anfang):
```python
HARDCODED_TENANT_ID = 1  # entfernt in Spec 2 (Auth gibt Tenant aus Session)
```

Jeden SQL-Query, der bisher ohne Filter lief, mit `WHERE tenant_id = HARDCODED_TENANT_ID` (bzw. zusätzlich zu existierenden WHERE-Clauses) ergänzen. Vorgehen: grep nach `FROM matches`, `FROM participants`, `FROM player_*`, `FROM pubg_achievements_seen`, `FROM settings` im File.

Pattern für JOINs / Subqueries: jeder Read der diese Tabellen anfasst kriegt den Filter dazu.

- [ ] **Step 2: `pubg/aggregations.py` — analog**

Selbe Vorgehensweise. Hinweis: das ist eine große Datei (`pubg/aggregations.py kann sehr gross werden` laut CLAUDE.md). Nicht splitten, nur Tenant-Filter ergänzen.

- [ ] **Step 3: Endpoints manuell smoketesten**

`serve.py` starten, dann:
```bash
curl -s http://localhost:9000/api/pubg/last-match | jq '.match_id'
```
Expected: gleicher Wert wie vor der Migration (verglichen mit `data/pubg-history.db.pre-pg-migration.bak` via `sqlite3 .../bak "SELECT match_id FROM matches ORDER BY played_at DESC LIMIT 1"`).

- [ ] **Step 4: Commit**

```bash
git add pubg/endpoints.py pubg/aggregations.py
git commit -m "feat(pubg): endpoints + aggregations scope auf tenant_id=1 (hardcoded, Spec 2 aufhebt)"
```

---

### Task 12: `pubg/poller.py` — Tenant-Iteration + Credentials aus DB + Telemetrie-Gate

**Files:**
- Modify: `pubg/poller.py`
- Create: `tests/pubg/test_poller_admin_archiving.py`

- [ ] **Step 1: Test schreiben (Telemetrie-Gate)**

`tests/pubg/test_poller_admin_archiving.py`:
```python
from unittest.mock import MagicMock, patch
from pubg import poller


def test_archive_telemetry_admin():
    fake_conn = MagicMock()
    fake_cur = MagicMock()
    fake_conn.cursor.return_value.__enter__.return_value = fake_cur
    fake_cur.fetchone.return_value = {"is_admin": True}
    with patch.object(poller, "_ftp_upload_telemetry") as up:
        poller.maybe_archive_telemetry(
            fake_conn, tenant_id=1, match_id="m1",
            telemetry_url="https://cdn/...gz")
        up.assert_called_once()


def test_archive_telemetry_non_admin():
    fake_conn = MagicMock()
    fake_cur = MagicMock()
    fake_conn.cursor.return_value.__enter__.return_value = fake_cur
    fake_cur.fetchone.return_value = {"is_admin": False}
    with patch.object(poller, "_ftp_upload_telemetry") as up:
        poller.maybe_archive_telemetry(
            fake_conn, tenant_id=2, match_id="m1",
            telemetry_url="https://cdn/...gz")
        up.assert_not_called()
```

- [ ] **Step 2: Test laufen — fail**

Run: `pytest tests/pubg/test_poller_admin_archiving.py -v`
Expected: AttributeError für `maybe_archive_telemetry`.

- [ ] **Step 3: `pubg/poller.py` umbauen**

Neue Helper-Funktion hinzufügen:
```python
def maybe_archive_telemetry(conn, tenant_id: int, match_id: str,
                             telemetry_url: str) -> None:
    """Lädt Telemetrie und schiebt sie nach HiDrive, aber NUR wenn der
    Owner-User des Tenants is_admin=TRUE hat."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT u.is_admin
            FROM tenants t
            JOIN users u ON u.id = t.owner_user_id
            WHERE t.id = %s
        """, (tenant_id,))
        row = cur.fetchone()
    if not row or not row["is_admin"]:
        return
    _ftp_upload_telemetry(tenant_id, match_id, telemetry_url)


def _ftp_upload_telemetry(tenant_id: int, match_id: str,
                          telemetry_url: str) -> None:
    """Telemetrie vom PUBG-CDN ziehen und in HiDrive ablegen.
    Implementation: bestehende Logik aus pubg/hidrive_telemetry.py wiederverwenden."""
    from pubg import hidrive_telemetry
    hidrive_telemetry.upload(tenant_id, match_id, telemetry_url)
```

Die Haupt-Poller-Loop (in `pubg/poller.py:run()` o.ä.) so umbauen, dass sie über Tenants iteriert:

```python
def run():
    conn = core_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM tenants")
            tenant_ids = [r["id"] for r in cur.fetchall()]
        for tid in tenant_ids:
            try:
                poll_tenant(conn, tid)
            except Exception as e:
                print(f"[poller] tenant {tid} fehler: {e}")
    finally:
        conn.close()


def poll_tenant(conn, tenant_id: int):
    creds = credentials.get(conn, tenant_id)
    if not creds.pubg_api_key or not creds.pubg_name:
        print(f"[poller] tenant {tenant_id}: keine PUBG-Credentials, skip")
        return
    # ... bestehende Fetch-Logik, aber:
    # 1. api_client mit creds.pubg_api_key statt globalem Key
    # 2. queries mit tenant_id-Argument
    # 3. nach erfolgreichem matches-Insert:
    #    maybe_archive_telemetry(conn, tenant_id, match_id, telemetry_url)
```

**Hinweis zur Umsetzung:** Bestehende Top-Level-Funktionen, die globale `PUBG_API_KEY`/`PLAYER_NAME`-Variablen lasen, kriegen explizite Parameter und werden von `poll_tenant` mit Werten aus `creds` aufgerufen.

- [ ] **Step 4: Test laufen — pass**

Run: `pytest tests/pubg/test_poller_admin_archiving.py -v`
Expected: 2 passed.

- [ ] **Step 5: Manueller Smoke-Test**

Poller einmalig laufen lassen (nicht als Daemon), Logs prüfen:
```bash
python -c "from pubg import poller; poller.run()"
```
Expected: für Tenant 1 PUBG-Fetch + Telemetrie-Upload-Log; keine Crashes.

- [ ] **Step 6: Commit**

```bash
git add pubg/poller.py tests/pubg/test_poller_admin_archiving.py
git commit -m "feat(pubg): poller iteriert Tenants + maybe_archive_telemetry an users.is_admin gebunden"
```

---

## Phase 10: Steam-Domain auf Tenant-aware Reads

### Task 13: `steam/endpoints.py` + `steam/poller.py`

**Files:**
- Modify: `steam/endpoints.py`
- Modify: `steam/poller.py`

- [ ] **Step 1: `steam/endpoints.py` — Tenant-Hardcode**

Analog zu `pubg/endpoints.py:Task 11`: Datei-Header:
```python
HARDCODED_TENANT_ID = 1
```

Alle SQL-Reads auf `steam_achievements_seen`, `steam_owned_games`, `steam_app_progress` kriegen `WHERE tenant_id = HARDCODED_TENANT_ID`. Globale Tabellen (`steam_app_schema`, `steam_app_schema_lang`, `steam_app_details`) bleiben unverändert.

Weiteres: in Steam-Endpoints wird bisher `steam/db.py` (SQLite) genutzt — auf `core.db.connect()` + `steam/db_pg.py` umstellen.

- [ ] **Step 2: `steam/poller.py` — Tenant-Iteration**

Analog zu `pubg/poller.py:Task 12`:
```python
def run():
    conn = core_db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM tenants")
            tenant_ids = [r["id"] for r in cur.fetchall()]
        for tid in tenant_ids:
            poll_tenant(conn, tid)
    finally:
        conn.close()


def poll_tenant(conn, tenant_id: int):
    creds = credentials.get(conn, tenant_id)
    if not creds.steam_api_key or not creds.steam_id:
        return
    # bestehende Logik, parametrisiert mit creds.steam_id, creds.steam_api_key, tenant_id
```

- [ ] **Step 3: Smoke-Test**

```bash
curl -s http://localhost:9000/api/steam/recent-achievements | jq '.[0]'
```
Expected: ein Achievement-Object, identisch zu vor-Migration-Wert (Vergleich gegen SQLite-Backup).

- [ ] **Step 4: Commit**

```bash
git add steam/endpoints.py steam/poller.py
git commit -m "feat(steam): endpoints + poller auf PG + tenant-scoping umgestellt"
```

---

## Phase 11: `serve.py` — Credentials aus DB statt `.secrets`-Modulvars

### Task 14: serve.py liest Twitch-Channel aus tenant_credentials

**Files:**
- Modify: `serve.py`

- [ ] **Step 1: `serve.py` lokalisieren wo `.secrets` gelesen wird**

In `serve.py:50` (laut Read-Output: nach `# .secrets lesen`) ersetzen durch DB-Lookup:

```python
# .secrets fuer Bootstrap-Notwendigkeiten (PG-DSN, Master-Key-Pfad-Hinweise) bleibt
# erhalten. Tenant-Daten (Twitch-Channel, Twitch-Client-ID) kommen aus DB.

from core import db as core_db, credentials as core_creds

def _load_tenant_secrets(tenant_id: int = 1) -> dict:
    """Liest Twitch/Steam/PUBG-Config fuer den hardcoded Tenant 1.
    Wird in Spec 2 durch Per-Request-Tenant-Resolve ersetzt."""
    conn = core_db.connect()
    try:
        creds = core_creds.get(conn, tenant_id)
    finally:
        conn.close()
    return {
        "Twitch-Channel": creds.twitch_channel or "",
        "Client-ID": creds.twitch_client_id or "",
        # Client-Secret bleibt SERVER-SIDE — wird NICHT in HTML injiziert
    }

secrets = _load_tenant_secrets()
```

Den bestehenden Block, der `secrets` aus der `.secrets`-Datei parsed, **belassen** (für Bootstrap-Werte wie ggf. lokale Override-Pfade), aber das Ergebnis aus `_load_tenant_secrets()` darüber-mergen so dass DB-Werte gewinnen.

- [ ] **Step 2: HTML-Injection-Logik prüfen**

In `serve.py` gibt's eine Stelle, die `window.__TWITCH_CHANNEL__` in HTML schreibt. Sicherstellen dass diese den `secrets["Twitch-Channel"]`-Wert nimmt (sollte unverändert klappen, da die Variable jetzt aus DB kommt).

- [ ] **Step 3: Smoke-Test**

`serve.py` starten, eine Widget-HTML im Browser öffnen, in Console:
```js
window.__TWITCH_CHANNEL__
```
Expected: dein Twitch-Channel-String.

- [ ] **Step 4: Commit**

```bash
git add serve.py
git commit -m "feat(serve): Twitch-Channel/Client-ID aus tenant_credentials statt .secrets"
```

---

## Phase 12: GFS-Backup

### Task 15: `scripts/backup_pg.py` mit GFS-Rotation

**Files:**
- Create: `scripts/backup_pg.py`
- Create: `tests/scripts/__init__.py`
- Create: `tests/scripts/test_backup_pg.py`

- [ ] **Step 1: Test schreiben (Rotations-Logik mockt FS + FTP)**

`tests/scripts/test_backup_pg.py`:
```python
from datetime import date
import pytest
from scripts import backup_pg


def test_pick_tier_sunday_first_of_month():
    # 2026-02-01 ist ein Sonntag UND der 1. des Monats → alle drei Tiers
    tiers = backup_pg.pick_tiers(date(2026, 2, 1))
    assert tiers == {"daily", "weekly", "monthly"}


def test_pick_tier_sunday_only():
    tiers = backup_pg.pick_tiers(date(2026, 5, 17))  # Sonntag, nicht 1.
    assert tiers == {"daily", "weekly"}


def test_pick_tier_first_of_month_only():
    tiers = backup_pg.pick_tiers(date(2026, 6, 1))  # Montag + 1.
    assert tiers == {"daily", "monthly"}


def test_pick_tier_normal_day():
    tiers = backup_pg.pick_tiers(date(2026, 5, 28))
    assert tiers == {"daily"}


def test_prune_keeps_n_newest():
    files = [
        "pg_dump_2026-05-28.dump.gz",
        "pg_dump_2026-05-27.dump.gz",
        "pg_dump_2026-05-26.dump.gz",
        "pg_dump_2026-05-25.dump.gz",
        "pg_dump_2026-05-24.dump.gz",
        "pg_dump_2026-05-23.dump.gz",
        "pg_dump_2026-05-22.dump.gz",
        "pg_dump_2026-05-21.dump.gz",  # zu alt
        "pg_dump_2026-05-20.dump.gz",  # zu alt
    ]
    to_delete = backup_pg.files_to_prune(files, keep=7)
    assert sorted(to_delete) == [
        "pg_dump_2026-05-20.dump.gz",
        "pg_dump_2026-05-21.dump.gz",
    ]
```

- [ ] **Step 2: Tests laufen — fail**

Run: `pytest tests/scripts/test_backup_pg.py -v`
Expected: ModuleNotFoundError.

- [ ] **Step 3: `scripts/backup_pg.py` schreiben**

```python
"""PostgreSQL-Backup → FTP mit GFS-Retention.

7 daily + 4 weekly + 6 monthly. Cronjob: einmal pro Tag 04:00.

Verwendung:
    python -m scripts.backup_pg

DSN: aus core.db.load_dsn(). FTP-Config: aus tenant_credentials WHERE tenant_id=1.
"""
import datetime
import gzip
import io
import json
import os
import re
import subprocess
import sys
from datetime import date
from typing import Iterable

from core import db as core_db, credentials as core_creds


KEEP = {"daily": 7, "weekly": 4, "monthly": 6}
FILENAME_RE = re.compile(r"pg_dump_(\d{4}-\d{2}-\d{2})(?:_(weekly|monthly))?\.dump\.gz")


def pick_tiers(today: date) -> set:
    tiers = {"daily"}
    if today.weekday() == 6:  # Sonntag
        tiers.add("weekly")
    if today.day == 1:
        tiers.add("monthly")
    return tiers


def files_to_prune(filenames: Iterable[str], keep: int) -> list:
    dated = []
    for f in filenames:
        m = FILENAME_RE.search(f)
        if not m:
            continue
        dated.append((m.group(1), f))
    dated.sort(reverse=True)
    return [f for (_, f) in dated[keep:]]


def _pg_dump(dsn: str) -> bytes:
    proc = subprocess.run(
        ["pg_dump", "--format=custom", dsn],
        capture_output=True, check=True
    )
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        gz.write(proc.stdout)
    return buf.getvalue()


def _ftp_connect(ftp_cfg: dict):
    # Reused logic — uses paramiko for SFTP (siehe pubg/hidrive_telemetry.py).
    import paramiko
    transport = paramiko.Transport((ftp_cfg["host"], int(ftp_cfg.get("port", 22))))
    transport.connect(username=ftp_cfg["user"], password=ftp_cfg["pass"])
    return paramiko.SFTPClient.from_transport(transport), transport


def _ensure_dir(sftp, path: str):
    parts = path.strip("/").split("/")
    p = ""
    for part in parts:
        p = f"{p}/{part}"
        try:
            sftp.stat(p)
        except IOError:
            sftp.mkdir(p)


def _upload(sftp, remote_path: str, data: bytes):
    with sftp.open(remote_path, "wb") as f:
        f.write(data)


def _list_dir(sftp, path: str) -> list:
    try:
        return sftp.listdir(path)
    except IOError:
        return []


def _remove(sftp, path: str):
    try:
        sftp.remove(path)
    except IOError:
        pass


def run(today: date | None = None) -> int:
    today = today or date.today()
    tiers = pick_tiers(today)
    dsn = core_db.load_dsn()
    if not dsn:
        print("Keine DSN gefunden, abbruch.")
        return 1

    print(f"Dumping {dsn.split('@')[-1]} ...")
    blob = _pg_dump(dsn)
    print(f"Dump-Groesse: {len(blob)/1024/1024:.1f} MB")

    conn = core_db.connect()
    try:
        creds = core_creds.get(conn, 1)
    finally:
        conn.close()
    if not creds.ftp_config:
        print("Keine FTP-Config in tenant 1 — abbruch.")
        return 1
    ftp_cfg = json.loads(creds.ftp_config)
    base_path = ftp_cfg.get("path", "/").rstrip("/")

    sftp, transport = _ftp_connect(ftp_cfg)
    try:
        for tier in tiers:
            tier_dir = f"{base_path}/backups/{tier}"
            _ensure_dir(sftp, tier_dir)
            suffix = "" if tier == "daily" else f"_{tier}"
            fname = f"pg_dump_{today.isoformat()}{suffix}.dump.gz"
            _upload(sftp, f"{tier_dir}/{fname}", blob)
            print(f"  hochgeladen: {tier_dir}/{fname}")

            # Pruning
            existing = _list_dir(sftp, tier_dir)
            for old in files_to_prune(existing, keep=KEEP[tier]):
                _remove(sftp, f"{tier_dir}/{old}")
                print(f"  geloescht:   {tier_dir}/{old}")
    finally:
        sftp.close()
        transport.close()
    return 0


if __name__ == "__main__":
    sys.exit(run())
```

- [ ] **Step 4: Tests laufen — pass**

Run: `pytest tests/scripts/test_backup_pg.py -v`
Expected: 5 passed.

- [ ] **Step 5: Live-Backup-Test**

```bash
python -m scripts.backup_pg
```
Expected: erfolgreicher Upload nach `<ftp-base>/backups/daily/pg_dump_YYYY-MM-DD.dump.gz`. Manuell per FTP-Client prüfen dass Datei da ist und ≥1MB groß.

- [ ] **Step 6: Cronjob installieren**

```bash
crontab -e
```
Zeile ergänzen:
```
0 4 * * * cd /home/ruschinski/git/obs-stream-kit && /home/ruschinski/git/obs-stream-kit/.venv/bin/python -m scripts.backup_pg >> /var/log/obs-stream-kit-backup.log 2>&1
```

(Pfade an deine Umgebung anpassen; `.venv` ggf. weglassen wenn system-Python genutzt wird.)

- [ ] **Step 7: Commit**

```bash
git add scripts/backup_pg.py tests/scripts/__init__.py tests/scripts/test_backup_pg.py
git commit -m "feat(scripts): backup_pg mit GFS-Retention (7d + 4w + 6m) auf SFTP"
```

---

## Phase 13: Cleanup + End-to-End-Smoke

### Task 16: SQLite-Code-Pfade entsorgen + finaler Smoke-Test

**Files:**
- Delete: `pubg/migrate_to_pg.py` (ersetzt durch `core/migrate_sqlite_to_pg.py`)
- Modify: `pubg/db.py` — Deprecation-Warnung am Top
- Modify: `steam/db.py` — Deprecation-Warnung am Top

- [ ] **Step 1: Alte Migration entfernen**

```bash
git rm pubg/migrate_to_pg.py
```

- [ ] **Step 2: Deprecation-Markierungen**

`pubg/db.py` (Datei-Anfang):
```python
"""DEPRECATED — SQLite-Adapter, wird nicht mehr genutzt seit PG-Migration (Spec 1).
Code bleibt liegen fuer historischen Read der .pre-pg-migration.bak Files.
Wird in einer spaeteren Aufraeumphase entfernt."""
```

Selbiges in `steam/db.py`.

- [ ] **Step 3: End-to-End-Smoke-Test**

```bash
# Poller einmal laufen lassen
python -c "from pubg import poller; poller.run()"
python -c "from steam import poller; poller.run()"

# Server starten und Widgets aufrufen
python serve.py 9000 &
SERVER_PID=$!
sleep 2

# Endpoints prüfen
for ep in /api/pubg/last-match /api/pubg/session-stats /api/steam/recent-achievements; do
    echo "=== $ep ==="
    curl -s "http://localhost:9000$ep" | head -c 200
    echo
done

kill $SERVER_PID
```
Expected: alle Endpoints liefern Daten (nicht leer, nicht Fehler).

- [ ] **Step 4: Backup-Restore-Übung**

```bash
# Auf einer Test-DB
psql -c "CREATE DATABASE obs_stream_kit_restore_test"
# Letzten Daily-Dump runterladen
sftp <ftp-host> <<EOF
get backups/daily/pg_dump_YYYY-MM-DD.dump.gz /tmp/test.dump.gz
bye
EOF
gunzip /tmp/test.dump.gz
pg_restore -d obs_stream_kit_restore_test /tmp/test.dump
psql obs_stream_kit_restore_test -c "SELECT count(*) FROM matches"
```
Expected: ein Row-Count > 0 — Restore funktioniert.

- [ ] **Step 5: Commit**

```bash
git add pubg/db.py steam/db.py
git rm pubg/migrate_to_pg.py
git commit -m "chore: deprecate SQLite-DB-Adapter, remove old migration tool"
```

---

## Self-Review-Notiz

Nach Spec-Vergleich:

- **Spec §1 (Postgres-Setup):** ✅ Task 1
- **Spec §2 (Identity-Schema):** ✅ Task 4
- **Spec §3 (Domain-Daten mit tenant_id):** ✅ Tasks 6, 7
- **Spec §4 (Crypto-Helper):** ✅ Task 3
- **Spec §5 (Seed-Script):** ✅ Task 9
- **Spec §6 (Daten-Migration):** ✅ Tasks 8, 10
- **Spec §7 (Domain-Module Refactor):** ✅ Tasks 11, 12, 13
- **Spec §8 (Backup mit GFS):** ✅ Task 15
- **Spec §9 (Telemetrie-Archivierung):** ✅ Task 12 (`maybe_archive_telemetry`)
- **`serve.py`-Anpassung:** ✅ Task 14

Tests existieren für: crypto, credentials, schema-tenant-scoping, migration, seed_admin (idempotenz), poller-archive-gate, backup-GFS-rotation.

**Offene Punkte aus Spec (nicht Teil dieses Plans):**
- PG-Version-Check vor Start: muss vom User auf dem Server geprüft werden (`psql --version`, ≥ 14 empfohlen).
- Cron-Mechanik: Task 15 Step 6 nutzt klassisches `crontab`; falls systemd-Timer gewollt, dort anpassen.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-postgres-tenant-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — frischer Subagent pro Task, Review zwischen Tasks, schnelle Iteration. Gut für diesen Plan, weil viele Tasks unabhängig sind und Test-Loops kurz.

**2. Inline Execution** — Tasks in dieser Session abarbeiten, mit Checkpoints zum Review.

**Welcher Ansatz?**
