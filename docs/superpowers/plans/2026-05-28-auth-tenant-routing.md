# Auth + Tenant-Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-28-auth-tenant-routing-design.md`

**Goal:** obs-stream-kit von stdlib http.server auf Flask umstellen, Twitch OAuth Login + URL-Token-Routing einführen, alle bisher hardcoded-tenant-1-Endpoints tenant-aware machen.

**Architecture:** Neues Flask-Package `app/` mit `create_app()` Factory. Bestehende Domain-Module (`pubg/`, `steam/`) bleiben unverändert in der Logik; ihre Endpoint-Registries werden in Flask-Routes adaptiert. Middleware setzt `flask.g.tenant_id` aus URL-Token oder Server-Session-Cookie. Server-side Sessions in `user_sessions`-Tabelle. Twitch OAuth via `authlib`.

**Tech Stack:** Python 3.12, Flask 3.x, authlib (OAuth), Jinja2 (Templates), psycopg2-binary (PG), cryptography (Crypto, schon da), pytest + Flask-TestClient.

---

## File Structure

**Neu (app/-Package):**
- `app/__init__.py` — `create_app()` Factory, registriert Blueprints, lädt Config, sets up Middleware.
- `app/config.py` — App-Config (DSN, Master-Key, Twitch-Credentials aus `.secrets` + Env).
- `app/middleware.py` — `before_request` Handler, Tenant-Resolution, Auth-Decorators.
- `app/sessions.py` — Server-Side Sessions (`user_sessions`-Tabelle wrappen).
- `app/auth.py` — OAuth-Flow: `/app/login`, `/app/oauth/callback`, `/app/logout`, Admin-Claim-Logik.
- `app/views_app.py` — Streamer-Routes: `/`, `/app/`, `/app/settings`, `/app/urls`, `/app/pending`.
- `app/views_admin.py` — Admin-Routes: `/admin/`, `/admin/users`, Approval-POST-Endpoints.
- `app/views_widgets.py` — Widget-Routes: `/s/<token>/widgets/<path>` mit HTML-Injection, `/s/<token>/api/<path>` dispatcher.
- `app/views_api.py` — `/api/<path>` cookie-scoped Adapter zu pubg/steam EndpointRegistry-Instanzen.
- `app/views_static.py` — `/widgets-static/<path>` ohne Auth.
- `app/twitch_client.py` — minimal HTTP-Client für Twitch Helix API (User-Info-Fetch nach OAuth).
- `app/templates/base.html` — gemeinsames Page-Skelett (Header, Footer).
- `app/templates/landing.html` — `/` Landing-Page.
- `app/templates/login_pending.html` — `/app/pending`.
- `app/templates/dashboard.html` — `/app/` Shell.
- `app/templates/settings.html` — `/app/settings`.
- `app/templates/urls.html` — `/app/urls`.
- `app/templates/admin_dashboard.html` — `/admin/`.
- `app/templates/admin_users.html` — `/admin/users`.
- `app/static/dashboard.css` — Brand-Colors, Sidebar, Cards.
- `app/static/dashboard.js` — Pending-Auto-Refresh, Copy-Buttons, Form-Helpers.
- `core/schema_v2.sql` — additive Migration: `users.is_approved`, `users.avatar_url`, `user_sessions`, pgcrypto.

**Tests:**
- `tests/app/__init__.py` (empty)
- `tests/app/conftest.py` — Flask-App-Fixture, PG-DSN-Test-Fixture, Twitch-Mock-Fixture.
- `tests/app/test_sessions.py`
- `tests/app/test_middleware.py`
- `tests/app/test_oauth.py`
- `tests/app/test_approval.py`
- `tests/app/test_settings.py`
- `tests/app/test_widget_routes.py`
- `tests/app/test_api_routes.py`

**Modifiziert:**
- `serve.py` — wird kurz: lädt App-Factory, startet Flask Dev/Prod-Server. Bestehende Logik (ANSI-Logger, Endpoint-Registries-Setup) wandert ins Factory bzw. ins `app/`-Package.
- `requirements.txt` — `flask>=3.0`, `authlib>=1.3` ergänzen.
- `pubg/endpoints.py` — `HARDCODED_TENANT_ID = 1` Konstante entfernt, Funktionen verlangen `tenant_id` als Argument.
- `pubg/aggregations.py` — dito (das wurde von Spec 1 mit `HARDCODED_TENANT_ID` durchgepatcht; jetzt wird's Parameter).
- `steam/endpoints.py` — dito.
- `widgets/_common/api.js` (neu falls noch nicht da) — Helper für API-Aufrufe relativ zu `window.__SERVE_BASE__`.
- Diverse Widget-HTML-Files — kleine JS-Anpassung: `fetch("/api/...")` → `fetch(API.url("/api/..."))` (über Helper).

**Entfernt nach erfolgreichem Cutover (Task 22):**
- `/etc/nginx/sites-enabled/obs-stream-kit.conf` Zeilen `auth_basic` + `auth_basic_user_file` (Server-Edit, dokumentiert).

---

## Phase 1: Foundation (Deps + Schema + App-Skeleton)

### Task 1: Dependencies + Schema-Migration

**Files:**
- Modify: `requirements.txt`
- Create: `core/schema_v2.sql`
- Create: `tests/app/__init__.py` (leer)

- [ ] **Step 1: Dependencies in `requirements.txt` ergänzen**

Aktueller Inhalt (3 Zeilen: paramiko, psycopg2-binary, cryptography). Anhängen:

```
flask>=3.0
authlib>=1.3
```

- [ ] **Step 2: Dependencies installieren (lokal + Server)**

Lokal:
```bash
pip install -r requirements.txt
```

Server (via SSH):
```bash
ssh -i ~/.ssh/entry_server root@87.106.4.31 'apt-get install -y python3-flask python3-authlib'
```

(Falls apt nicht aktuell genug für Flask 3.x: dann `pip install --break-system-packages flask authlib` als obskit-User — manueller Schritt am Cutover-Tag.)

- [ ] **Step 3: Schema-Migration anlegen — `core/schema_v2.sql`**

```sql
-- Spec 2 Schema-Migration (additiv)
-- Idempotent: kann mehrfach laufen.

-- pgcrypto fuer gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- users-Erweiterung
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Admin-User wird automatisch approved
UPDATE users SET is_approved = TRUE WHERE is_admin = TRUE;

-- Server-Side Sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    user_agent    TEXT,
    ip            INET
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user
    ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
    ON user_sessions(expires_at) WHERE expires_at > now();
```

- [ ] **Step 4: Migration auf Server ausführen**

```bash
ssh -i ~/.ssh/entry_server root@87.106.4.31 'sudo -u postgres psql obs_stream_kit -v ON_ERROR_STOP=1 < /opt/obs-stream-kit/core/schema_v2.sql'
```

Hinweis: erst nach Deploy verfügbar. Wenn lokal getestet werden soll, gegen lokale Test-DB.

Expected: `CREATE EXTENSION`, `ALTER TABLE`, `UPDATE`, `CREATE TABLE`, `CREATE INDEX` — alles `NOTICE` oder leise.

Verifikation:
```bash
ssh -i ~/.ssh/entry_server root@87.106.4.31 "sudo -u postgres psql obs_stream_kit -c '\d users' | grep -E 'is_approved|avatar_url'"
```

- [ ] **Step 5: Test-Setup vorbereiten**

`tests/app/__init__.py` anlegen (leer).

- [ ] **Step 6: Commit**

```bash
git add requirements.txt core/schema_v2.sql tests/app/__init__.py
git commit -m "build: Flask + authlib Deps, Schema-Migration (users.is_approved, user_sessions)"
```

---

### Task 2: App-Factory + Flask-Skelett

**Files:**
- Create: `app/__init__.py`
- Create: `app/config.py`
- Create: `tests/app/conftest.py`
- Create: `tests/app/test_app_factory.py`

- [ ] **Step 1: Failing Test schreiben — `tests/app/test_app_factory.py`**

```python
import pytest
from app import create_app


def test_create_app_returns_flask():
    app = create_app(testing=True)
    assert app.name == "app"


def test_app_has_healthz_route():
    app = create_app(testing=True)
    client = app.test_client()
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json == {"status": "ok"}
```

- [ ] **Step 2: Test laufen — fail**

Run: `pytest tests/app/test_app_factory.py -v`
Expected: `ModuleNotFoundError: No module named 'app'` (or 'flask' if not installed).

- [ ] **Step 3: `app/config.py` schreiben**

```python
"""App-Konfiguration aus Env + .secrets."""
import os
from typing import Optional


def _secret(key: str, secrets_path: str = ".secrets") -> Optional[str]:
    """Liest eine Zeile 'Key: Value' aus .secrets."""
    if not os.path.exists(secrets_path):
        return None
    with open(secrets_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if ":" not in line or line.startswith("#"):
                continue
            k, _, v = line.partition(":")
            if k.strip() == key:
                return v.strip()
    return None


class Config:
    SECRET_KEY = os.environ.get("OBS_KIT_FLASK_SECRET") or _secret("Flask Secret-Key") or "DEV-INSECURE-CHANGE-IN-PROD"
    SESSION_COOKIE_NAME = "obskit_csrf"  # Flask-builtin session (CSRF state nur fuer OAuth)
    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"

    TWITCH_CLIENT_ID = _secret("Twitch App Client-ID")
    TWITCH_CLIENT_SECRET = _secret("Twitch App Client-Secret")
    TWITCH_REDIRECT_URI = os.environ.get("OBS_KIT_OAUTH_REDIRECT") or "https://king-edition.de/app/oauth/callback"
    TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize"
    TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
    TWITCH_USERINFO_URL = "https://api.twitch.tv/helix/users"
    TWITCH_SCOPES = "user:read:email"

    OBSKIT_SID_COOKIE = "obskit_sid"
    SESSION_LIFETIME_DAYS = 30


class TestingConfig(Config):
    TESTING = True
    SECRET_KEY = "test-secret"
    SESSION_COOKIE_SECURE = False  # damit Test-Client funktioniert
    TWITCH_CLIENT_ID = "test-client-id"
    TWITCH_CLIENT_SECRET = "test-client-secret"
    TWITCH_REDIRECT_URI = "http://localhost/app/oauth/callback"
```

- [ ] **Step 4: `app/__init__.py` schreiben**

```python
"""obs-stream-kit Flask-App-Factory."""
from flask import Flask, jsonify

from app.config import Config, TestingConfig


def create_app(testing: bool = False) -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.from_object(TestingConfig if testing else Config)

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app
```

- [ ] **Step 5: `tests/app/conftest.py` schreiben (Fixtures fuer kommende Tests)**

```python
import os
import pytest
from app import create_app


@pytest.fixture
def app():
    return create_app(testing=True)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def pg_dsn_test():
    dsn = os.environ.get("OBS_KIT_PG_DSN_TEST")
    if not dsn:
        pytest.skip("OBS_KIT_PG_DSN_TEST nicht gesetzt")
    if "test" not in dsn.lower():
        pytest.skip("OBS_KIT_PG_DSN_TEST braucht 'test' im Namen (Schutz)")
    return dsn
```

- [ ] **Step 6: Tests laufen — pass**

Run: `pytest tests/app/test_app_factory.py -v`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add app/__init__.py app/config.py tests/app/conftest.py tests/app/test_app_factory.py
git commit -m "feat(app): Flask App-Factory + /healthz + Test-Fixtures"
```

---

### Task 3: Server-Side Sessions

**Files:**
- Create: `app/sessions.py`
- Create: `tests/app/test_sessions.py`

- [ ] **Step 1: Failing test schreiben — `tests/app/test_sessions.py`**

```python
import os
import datetime as dt
import pytest
from core import db as core_db
from app import sessions


@pytest.fixture
def pg_conn(pg_dsn_test):
    conn = core_db.connect(pg_dsn_test)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS obs CASCADE")
        cur.execute("CREATE SCHEMA obs AUTHORIZATION obs_stream")
    conn.commit()
    # Load identity + v2 schema
    import core.init_schema as init
    base = os.path.dirname(init.__file__)
    with open(os.path.join(base, "schema.sql")) as f:
        with conn.cursor() as cur:
            cur.execute(f.read())
    with open(os.path.join(base, "schema_v2.sql")) as f:
        with conn.cursor() as cur:
            cur.execute(f.read())
    # Seed admin user
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users (display_name, is_admin, is_approved) "
            "VALUES ('A', TRUE, TRUE) RETURNING id"
        )
        uid = cur.fetchone()["id"]
    conn.commit()
    yield conn, uid
    conn.close()


def test_create_session_returns_uuid(pg_conn):
    conn, uid = pg_conn
    sid = sessions.create(conn, user_id=uid, user_agent="curl", ip="127.0.0.1")
    assert sid is not None
    assert len(sid) == 36  # UUID format


def test_lookup_returns_user(pg_conn):
    conn, uid = pg_conn
    sid = sessions.create(conn, user_id=uid)
    row = sessions.lookup(conn, sid)
    assert row is not None
    assert row["user_id"] == uid


def test_lookup_missing_returns_none(pg_conn):
    conn, _ = pg_conn
    row = sessions.lookup(conn, "00000000-0000-0000-0000-000000000000")
    assert row is None


def test_lookup_expired_returns_none(pg_conn):
    conn, uid = pg_conn
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO user_sessions (user_id, expires_at)
            VALUES (%s, now() - interval '1 day') RETURNING id
        """, (uid,))
        sid = cur.fetchone()["id"]
    conn.commit()
    row = sessions.lookup(conn, str(sid))
    assert row is None


def test_touch_updates_last_seen(pg_conn):
    conn, uid = pg_conn
    sid = sessions.create(conn, user_id=uid)
    sessions.touch(conn, sid)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_seen_at FROM user_sessions WHERE id = %s::uuid", (sid,)
        )
        ts1 = cur.fetchone()["last_seen_at"]
    import time
    time.sleep(0.05)
    sessions.touch(conn, sid)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_seen_at FROM user_sessions WHERE id = %s::uuid", (sid,)
        )
        ts2 = cur.fetchone()["last_seen_at"]
    assert ts2 > ts1


def test_revoke_removes_session(pg_conn):
    conn, uid = pg_conn
    sid = sessions.create(conn, user_id=uid)
    sessions.revoke(conn, sid)
    assert sessions.lookup(conn, sid) is None
```

- [ ] **Step 2: Tests laufen — fail**

Run: `pytest tests/app/test_sessions.py -v`
Expected: ModuleNotFoundError für `app.sessions` (oder alle SKIPPED ohne PG_DSN_TEST).

- [ ] **Step 3: `app/sessions.py` implementieren**

```python
"""Server-Side Sessions via user_sessions-Tabelle.

Ersetzt Flask-builtin signed-cookie session fuer Auth-relevante Daten.
Cookie enthaelt nur die Session-UUID; alle Daten sind server-side.
"""
import datetime as dt
from typing import Optional

from app.config import Config


def create(conn, user_id: int, user_agent: Optional[str] = None,
           ip: Optional[str] = None) -> str:
    """Legt neue Session an, gibt die Session-ID (UUID-String) zurueck."""
    expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(
        days=Config.SESSION_LIFETIME_DAYS
    )
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO user_sessions (user_id, user_agent, ip, expires_at)
            VALUES (%s, %s, %s, %s) RETURNING id
        """, (user_id, user_agent, ip, expires_at))
        sid = cur.fetchone()["id"]
    conn.commit()
    return str(sid)


def lookup(conn, sid: str) -> Optional[dict]:
    """Liefert dict mit user_id, expires_at oder None wenn nicht da/abgelaufen."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, user_id, expires_at, last_seen_at
            FROM user_sessions
            WHERE id = %s::uuid AND expires_at > now()
        """, (sid,))
        return cur.fetchone()


def touch(conn, sid: str) -> None:
    """Setzt last_seen_at = now()."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE user_sessions SET last_seen_at = now()
            WHERE id = %s::uuid
        """, (sid,))
    conn.commit()


def revoke(conn, sid: str) -> None:
    """Loescht die Session."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM user_sessions WHERE id = %s::uuid", (sid,))
    conn.commit()


def revoke_all_for_user(conn, user_id: int) -> int:
    """Loescht alle Sessions des Users. Returns Count."""
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM user_sessions WHERE user_id = %s", (user_id,)
        )
        return cur.rowcount
```

- [ ] **Step 4: Tests laufen**

Run: `pytest tests/app/test_sessions.py -v`
Expected: 6 passed (oder SKIPPED ohne PG_DSN_TEST).

- [ ] **Step 5: Commit**

```bash
git add app/sessions.py tests/app/test_sessions.py
git commit -m "feat(app): server-side Sessions (create/lookup/touch/revoke)"
```

---

## Phase 2: Middleware + Auth-Decorators

### Task 4: Tenant-Resolution Middleware

**Files:**
- Create: `app/middleware.py`
- Create: `tests/app/test_middleware.py`

- [ ] **Step 1: Test schreiben — `tests/app/test_middleware.py`**

```python
import pytest
from flask import g, Blueprint, jsonify

from app import create_app
from app.middleware import register_middleware, require_session, require_admin


def _make_app_with_routes(pg_conn_factory):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = pg_conn_factory
    register_middleware(app)
    bp = Blueprint("test", __name__)

    @bp.route("/s/<token>/ping")
    def widget_ping(token):
        return jsonify({"tenant_id": g.tenant_id})

    @bp.route("/app/ping")
    @require_session
    def app_ping():
        return jsonify({"user_id": g.user["id"], "tenant_id": g.tenant_id})

    @bp.route("/admin/ping")
    @require_admin
    def admin_ping():
        return jsonify({"ok": True})

    app.register_blueprint(bp)
    return app


def test_widget_route_resolves_tenant_from_token(pg_conn_test_setup):
    conn, tenant_id, token, _ = pg_conn_test_setup
    app = _make_app_with_routes(lambda: conn)
    resp = app.test_client().get(f"/s/{token}/ping")
    assert resp.status_code == 200
    assert resp.json["tenant_id"] == tenant_id


def test_widget_route_unknown_token_404(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app_with_routes(lambda: conn)
    resp = app.test_client().get("/s/tok_doesnotexist/ping")
    assert resp.status_code == 404


def test_app_route_unauthenticated_redirects_to_login(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app_with_routes(lambda: conn)
    resp = app.test_client().get("/app/ping")
    assert resp.status_code == 302
    assert "/app/login" in resp.headers["Location"]


def test_app_route_with_valid_session(pg_conn_test_setup):
    conn, tenant_id, _, session_id = pg_conn_test_setup
    app = _make_app_with_routes(lambda: conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", session_id)
    resp = client.get("/app/ping")
    assert resp.status_code == 200
    assert resp.json["tenant_id"] == tenant_id


def test_admin_route_blocks_non_admin(pg_conn_test_setup_non_admin):
    conn, _, _, session_id = pg_conn_test_setup_non_admin
    app = _make_app_with_routes(lambda: conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", session_id)
    resp = client.get("/admin/ping")
    assert resp.status_code == 403


def test_unapproved_user_redirected_to_pending(pg_conn_test_setup_unapproved):
    conn, _, _, session_id = pg_conn_test_setup_unapproved
    app = _make_app_with_routes(lambda: conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", session_id)
    resp = client.get("/app/ping")
    assert resp.status_code == 302
    assert "/app/pending" in resp.headers["Location"]
```

Plus die Fixtures dazu in `tests/app/conftest.py` ergaenzen:

```python
import os
import pytest
from core import db as core_db
from app import sessions


def _setup_schema(conn):
    import core.init_schema as init
    base = os.path.dirname(init.__file__)
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA IF EXISTS obs CASCADE")
        cur.execute("CREATE SCHEMA obs AUTHORIZATION obs_stream")
        with open(os.path.join(base, "schema.sql")) as f:
            cur.execute(f.read())
        with open(os.path.join(base, "schema_v2.sql")) as f:
            cur.execute(f.read())
    conn.commit()


def _seed_user_tenant(conn, *, is_admin: bool, is_approved: bool):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO users (display_name, is_admin, is_approved, twitch_user_id)
            VALUES ('TestUser', %s, %s, %s) RETURNING id
        """, (is_admin, is_approved, '999999' if is_admin else None))
        uid = cur.fetchone()["id"]
        if is_approved:
            cur.execute("""
                INSERT INTO tenants (owner_user_id, slug, display_name)
                VALUES (%s, 'test', 'TestTenant') RETURNING id
            """, (uid,))
            tid = cur.fetchone()["id"]
            cur.execute(
                "INSERT INTO tenant_credentials (tenant_id) VALUES (%s)", (tid,)
            )
            cur.execute("""
                INSERT INTO widget_tokens (token, tenant_id, label)
                VALUES (%s, %s, 'Default') RETURNING token
            """, ("tok_" + ("a" * 32), tid))
            token = cur.fetchone()["token"]
        else:
            tid = None
            token = None
    conn.commit()
    return uid, tid, token


@pytest.fixture
def pg_conn_test_setup(pg_dsn_test):
    conn = core_db.connect(pg_dsn_test)
    _setup_schema(conn)
    uid, tid, token = _seed_user_tenant(conn, is_admin=True, is_approved=True)
    sid = sessions.create(conn, user_id=uid)
    yield conn, tid, token, sid
    conn.close()


@pytest.fixture
def pg_conn_test_setup_non_admin(pg_dsn_test):
    conn = core_db.connect(pg_dsn_test)
    _setup_schema(conn)
    uid, tid, token = _seed_user_tenant(conn, is_admin=False, is_approved=True)
    sid = sessions.create(conn, user_id=uid)
    yield conn, tid, token, sid
    conn.close()


@pytest.fixture
def pg_conn_test_setup_unapproved(pg_dsn_test):
    conn = core_db.connect(pg_dsn_test)
    _setup_schema(conn)
    uid, tid, token = _seed_user_tenant(conn, is_admin=False, is_approved=False)
    sid = sessions.create(conn, user_id=uid)
    yield conn, tid, token, sid
    conn.close()
```

- [ ] **Step 2: Test laufen — fail**

Run: `pytest tests/app/test_middleware.py -v`
Expected: ModuleNotFoundError fuer `app.middleware`.

- [ ] **Step 3: `app/middleware.py` implementieren**

```python
"""Flask Middleware: Tenant-Resolution + Auth-Decorators.

before_request laeuft fuer jeden Request und setzt flask.g:
- g.tenant_id (aus URL-Token oder User-Session)
- g.user (dict mit id, is_admin, is_approved, ...) wenn eingeloggt

Decorators erzwingen Auth-State auf einzelnen Routes:
- require_session: redirected zu /app/login wenn nicht eingeloggt
- require_admin: 403 wenn nicht is_admin
- require_approved: redirected zu /app/pending wenn is_approved=FALSE
"""
import re
from functools import wraps
from flask import g, request, redirect, abort, current_app

from app.config import Config
from app import sessions
from core import db as core_db


PUBLIC_PATHS = (
    "/", "/healthz",
    "/app/login", "/app/oauth/callback",
    "/widgets-static/",
)

_TOKEN_RE = re.compile(r"^/s/([A-Za-z0-9_]+)/")


def _get_conn():
    factory = current_app.config.get("_PG_CONN_FACTORY")
    if factory:
        return factory()
    return core_db.connect()


def register_middleware(app):
    @app.before_request
    def resolve_context():
        g.tenant_id = None
        g.user = None
        path = request.path

        # 1. URL-Token-Pfad?
        m = _TOKEN_RE.match(path)
        if m:
            token = m.group(1)
            conn = _get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT tenant_id FROM widget_tokens
                        WHERE token = %s AND revoked_at IS NULL
                    """, (token,))
                    row = cur.fetchone()
                if row is None:
                    abort(404, description="Unknown widget token")
                g.tenant_id = row["tenant_id"]
            finally:
                if "_PG_CONN_FACTORY" not in current_app.config:
                    conn.close()
            return

        # 2. Public?
        if any(path == p or path.startswith(p) for p in PUBLIC_PATHS):
            return

        # 3. Session-Cookie?
        sid = request.cookies.get(Config.OBSKIT_SID_COOKIE)
        if not sid:
            return  # Decorators handle the redirect

        conn = _get_conn()
        try:
            row = sessions.lookup(conn, sid)
            if row is None:
                return
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT u.id, u.twitch_user_id, u.display_name, u.is_admin,
                           u.is_approved, u.avatar_url,
                           t.id AS tenant_id
                    FROM users u
                    LEFT JOIN tenants t ON t.owner_user_id = u.id
                    WHERE u.id = %s
                """, (row["user_id"],))
                user = cur.fetchone()
            if user:
                g.user = dict(user)
                g.tenant_id = user["tenant_id"]
                sessions.touch(conn, sid)
        finally:
            if "_PG_CONN_FACTORY" not in current_app.config:
                conn.close()


def require_session(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return redirect("/app/login")
        if not g.user["is_approved"]:
            return redirect("/app/pending")
        return view(*args, **kwargs)
    return wrapper


def require_admin(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return redirect("/app/login")
        if not g.user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)
    return wrapper


def require_approved(view):
    """Erlaubt is_approved=FALSE nur auf /app/pending und /app/logout."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return redirect("/app/login")
        if not g.user["is_approved"]:
            return redirect("/app/pending")
        return view(*args, **kwargs)
    return wrapper
```

- [ ] **Step 4: Tests laufen**

Run: `pytest tests/app/test_middleware.py -v`
Expected: 6 passed (oder SKIPPED ohne PG_DSN_TEST).

- [ ] **Step 5: Commit**

```bash
git add app/middleware.py tests/app/test_middleware.py tests/app/conftest.py
git commit -m "feat(app): Middleware fuer Tenant-Resolution + Auth-Decorators"
```

---

## Phase 3: Twitch OAuth

### Task 5: Twitch HTTP-Client (User-Info-Fetch)

**Files:**
- Create: `app/twitch_client.py`
- Create: `tests/app/test_twitch_client.py`

- [ ] **Step 1: Test schreiben**

`tests/app/test_twitch_client.py`:

```python
from unittest.mock import patch, MagicMock
from app import twitch_client


def _mock_response(json_data, status_code=200):
    m = MagicMock()
    m.status_code = status_code
    m.json.return_value = json_data
    return m


def test_exchange_code_for_token():
    with patch("app.twitch_client.requests.post") as post:
        post.return_value = _mock_response({
            "access_token": "tok_abc", "refresh_token": "ref_xyz",
            "expires_in": 14400, "scope": ["user:read:email"], "token_type": "bearer",
        })
        token = twitch_client.exchange_code("code123", "client_id", "secret", "http://cb")
        assert token == "tok_abc"


def test_get_user_info():
    with patch("app.twitch_client.requests.get") as gget:
        gget.return_value = _mock_response({
            "data": [{
                "id": "987654321",
                "login": "neuerstreamer",
                "display_name": "NeuerStreamer",
                "profile_image_url": "https://example/avatar.png",
                "email": "user@example.com",
            }]
        })
        info = twitch_client.get_user_info("tok_abc", "client_id")
        assert info["id"] == "987654321"
        assert info["display_name"] == "NeuerStreamer"
        assert info["avatar_url"] == "https://example/avatar.png"


def test_get_user_info_empty_raises():
    with patch("app.twitch_client.requests.get") as gget:
        gget.return_value = _mock_response({"data": []})
        try:
            twitch_client.get_user_info("tok_abc", "client_id")
            assert False, "should have raised"
        except RuntimeError as e:
            assert "leeren User" in str(e) or "empty" in str(e).lower()
```

- [ ] **Step 2: Run — fail**

`pytest tests/app/test_twitch_client.py -v` → ModuleNotFoundError.

- [ ] **Step 3: Implementation — `app/twitch_client.py`**

```python
"""Minimaler Twitch Helix HTTP-Client fuer OAuth-Flow.

Verwendet requests (Standard-Lib im venv). Keine Async-Komplikation.
"""
import requests

from app.config import Config


def exchange_code(code: str, client_id: str, client_secret: str,
                  redirect_uri: str) -> str:
    """OAuth Code → Access-Token."""
    resp = requests.post(Config.TWITCH_TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Twitch token-exchange fehlgeschlagen: {resp.status_code} {resp.text[:200]}"
        )
    return resp.json()["access_token"]


def get_user_info(access_token: str, client_id: str) -> dict:
    """Liefert dict mit id, login, display_name, avatar_url, email."""
    resp = requests.get(Config.TWITCH_USERINFO_URL, headers={
        "Authorization": f"Bearer {access_token}",
        "Client-Id": client_id,
    }, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Twitch /users fehlgeschlagen: {resp.status_code} {resp.text[:200]}"
        )
    data = resp.json().get("data", [])
    if not data:
        raise RuntimeError("Twitch lieferte leeren User-Block")
    u = data[0]
    return {
        "id": u["id"],
        "login": u["login"],
        "display_name": u.get("display_name") or u["login"],
        "avatar_url": u.get("profile_image_url"),
        "email": u.get("email"),
    }
```

- [ ] **Step 4: Run — pass**

`pytest tests/app/test_twitch_client.py -v` → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/twitch_client.py tests/app/test_twitch_client.py
git commit -m "feat(app): twitch_client (exchange_code + get_user_info)"
```

---

### Task 6: OAuth Login + Callback + Admin-Claim

**Files:**
- Create: `app/auth.py`
- Create: `tests/app/test_oauth.py`

- [ ] **Step 1: Test schreiben**

`tests/app/test_oauth.py`:

```python
from unittest.mock import patch
import pytest

from app import create_app
from app.auth import bp_auth
from app.middleware import register_middleware
from app import sessions


def _make_app(conn):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    register_middleware(app)
    app.register_blueprint(bp_auth)
    return app


def test_login_redirects_to_twitch(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app(conn)
    resp = app.test_client().get("/app/login")
    assert resp.status_code == 302
    assert "id.twitch.tv/oauth2/authorize" in resp.headers["Location"]
    assert "client_id=test-client-id" in resp.headers["Location"]
    assert "state=" in resp.headers["Location"]


def test_callback_creates_new_user_pending(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup  # has admin tenant already
    app = _make_app(conn)
    client = app.test_client()
    # Erst /login um state zu setzen
    client.get("/app/login")
    state_resp = client.get("/app/login")
    state = state_resp.headers["Location"].split("state=")[1].split("&")[0]
    with patch("app.auth.exchange_code", return_value="acc_xyz"), \
         patch("app.auth.get_user_info", return_value={
             "id": "555", "login": "neu", "display_name": "Neu",
             "avatar_url": "http://a", "email": "neu@x",
         }):
        resp = client.get(f"/app/oauth/callback?code=c1&state={state}")
    assert resp.status_code == 302
    assert "/app/pending" in resp.headers["Location"]
    # User existiert mit is_approved=FALSE
    with conn.cursor() as cur:
        cur.execute("SELECT is_approved FROM users WHERE twitch_user_id = '555'")
        assert cur.fetchone()["is_approved"] is False


def test_callback_admin_claim(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app(conn)
    # Admin-Row hat schon twitch_user_id = '999999' aus Fixture
    # Wir simulieren: dieser Twitch-User loggt sich ein
    client = app.test_client()
    state_resp = client.get("/app/login")
    state = state_resp.headers["Location"].split("state=")[1].split("&")[0]
    with patch("app.auth.exchange_code", return_value="acc_xyz"), \
         patch("app.auth.get_user_info", return_value={
             "id": "999999", "login": "admin", "display_name": "Admin",
             "avatar_url": "http://a", "email": "a@x",
         }):
        resp = client.get(f"/app/oauth/callback?code=c1&state={state}")
    assert resp.status_code == 302
    assert "/app/" == resp.headers["Location"] or resp.headers["Location"].endswith("/app/")
    # Cookie gesetzt?
    cookies = resp.headers.getlist("Set-Cookie")
    assert any("obskit_sid=" in c for c in cookies)


def test_callback_state_mismatch_400(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app(conn)
    client = app.test_client()
    client.get("/app/login")  # legt state an
    resp = client.get("/app/oauth/callback?code=c1&state=WRONG")
    assert resp.status_code == 400


def test_logout_clears_session_and_cookie(pg_conn_test_setup):
    conn, _, _, sid = pg_conn_test_setup
    app = _make_app(conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", sid)
    resp = client.get("/app/logout")
    assert resp.status_code == 302
    assert sessions.lookup(conn, sid) is None
```

- [ ] **Step 2: Run — fail**

`pytest tests/app/test_oauth.py -v` → ModuleNotFoundError.

- [ ] **Step 3: Implementation — `app/auth.py`**

```python
"""Twitch OAuth-Flow + Admin-Claim.

Flask-Blueprint mit /app/login, /app/oauth/callback, /app/logout.
"""
import secrets
import urllib.parse
from flask import (
    Blueprint, redirect, request, session, abort, g, current_app, make_response
)

from app.config import Config
from app.twitch_client import exchange_code, get_user_info  # exposed for mock
from app import sessions as srv_sessions
from app.middleware import _get_conn


bp_auth = Blueprint("auth", __name__)


@bp_auth.route("/app/login")
def login():
    state = secrets.token_urlsafe(32)
    session["oauth_state"] = state
    params = {
        "client_id": current_app.config["TWITCH_CLIENT_ID"],
        "redirect_uri": current_app.config["TWITCH_REDIRECT_URI"],
        "response_type": "code",
        "scope": current_app.config["TWITCH_SCOPES"],
        "state": state,
    }
    url = current_app.config["TWITCH_AUTH_URL"] + "?" + urllib.parse.urlencode(params)
    return redirect(url, code=302)


@bp_auth.route("/app/oauth/callback")
def callback():
    state = request.args.get("state")
    code = request.args.get("code")
    if not state or state != session.pop("oauth_state", None):
        abort(400, description="OAuth-State-Mismatch (CSRF)")
    if not code:
        abort(400, description="Missing OAuth code")

    cfg = current_app.config
    try:
        access_token = exchange_code(
            code, cfg["TWITCH_CLIENT_ID"], cfg["TWITCH_CLIENT_SECRET"],
            cfg["TWITCH_REDIRECT_URI"],
        )
        info = get_user_info(access_token, cfg["TWITCH_CLIENT_ID"])
    except RuntimeError as e:
        abort(502, description=str(e))

    conn = _get_conn()
    try:
        user = _lookup_or_create_user(conn, info)
        sid = srv_sessions.create(
            conn, user_id=user["id"],
            user_agent=request.headers.get("User-Agent"),
            ip=request.remote_addr,
        )
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()

    target = "/app/" if user["is_approved"] else "/app/pending"
    resp = make_response(redirect(target, code=302))
    resp.set_cookie(
        Config.OBSKIT_SID_COOKIE, sid,
        max_age=Config.SESSION_LIFETIME_DAYS * 86400,
        secure=not current_app.config.get("TESTING"),
        httponly=True, samesite="Lax",
    )
    return resp


@bp_auth.route("/app/logout")
def logout():
    sid = request.cookies.get(Config.OBSKIT_SID_COOKIE)
    if sid:
        conn = _get_conn()
        try:
            srv_sessions.revoke(conn, sid)
        finally:
            if "_PG_CONN_FACTORY" not in current_app.config:
                conn.close()
    resp = make_response(redirect("/", code=302))
    resp.delete_cookie(Config.OBSKIT_SID_COOKIE)
    return resp


def _lookup_or_create_user(conn, info: dict) -> dict:
    """3 Pfade:
    1. Existing user with twitch_user_id == info.id → login.
    2. Existing admin-row with twitch_user_id IS NULL AND is_admin=TRUE → claim.
    3. New user → INSERT with is_approved=FALSE.
    """
    twitch_id = info["id"]
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, is_admin, is_approved FROM users WHERE twitch_user_id = %s",
            (twitch_id,)
        )
        row = cur.fetchone()
        if row:
            return dict(row)

        # 2. Admin-Claim?
        cur.execute("""
            SELECT id FROM users
            WHERE twitch_user_id IS NULL AND is_admin = TRUE
            LIMIT 1
        """)
        admin_row = cur.fetchone()
        if admin_row:
            cur.execute("""
                UPDATE users SET twitch_user_id = %s, display_name = %s, avatar_url = %s
                WHERE id = %s RETURNING id, is_admin, is_approved
            """, (twitch_id, info["display_name"], info.get("avatar_url"),
                  admin_row["id"]))
            return dict(cur.fetchone())

        # 3. Neuer User
        cur.execute("""
            INSERT INTO users (twitch_user_id, display_name, avatar_url,
                               is_admin, is_approved)
            VALUES (%s, %s, %s, FALSE, FALSE)
            RETURNING id, is_admin, is_approved
        """, (twitch_id, info["display_name"], info.get("avatar_url")))
        u = cur.fetchone()
    conn.commit()
    return dict(u)
```

- [ ] **Step 4: Run — pass**

`pytest tests/app/test_oauth.py -v` → 5 passed.

- [ ] **Step 5: Commit**

```bash
git add app/auth.py tests/app/test_oauth.py
git commit -m "feat(app): Twitch OAuth Flow + Admin-Claim + Logout"
```

---

## Phase 4: Approval Flow

### Task 7: Admin Approval Endpoints

**Files:**
- Create: `app/views_admin.py`
- Create: `tests/app/test_approval.py`

- [ ] **Step 1: Test schreiben — `tests/app/test_approval.py`**

```python
from app import create_app
from app.middleware import register_middleware
from app.views_admin import bp_admin


def _make_app(conn):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    register_middleware(app)
    app.register_blueprint(bp_admin)
    return app


def test_approve_creates_tenant(pg_conn_test_setup):
    conn, _, _, admin_sid = pg_conn_test_setup
    # Seed: einen pending-User
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO users (twitch_user_id, display_name, is_approved)
            VALUES ('555', 'Pending', FALSE) RETURNING id
        """)
        pending_uid = cur.fetchone()["id"]
    conn.commit()

    app = _make_app(conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", admin_sid)
    resp = client.post(f"/admin/users/{pending_uid}/approve")
    assert resp.status_code == 302

    with conn.cursor() as cur:
        cur.execute("SELECT is_approved FROM users WHERE id = %s", (pending_uid,))
        assert cur.fetchone()["is_approved"] is True
        cur.execute(
            "SELECT count(*) AS n FROM tenants WHERE owner_user_id = %s",
            (pending_uid,)
        )
        assert cur.fetchone()["n"] == 1
        cur.execute("""
            SELECT count(*) AS n FROM widget_tokens
            WHERE tenant_id = (SELECT id FROM tenants WHERE owner_user_id = %s)
        """, (pending_uid,))
        assert cur.fetchone()["n"] == 1


def test_deny_keeps_is_approved_false(pg_conn_test_setup):
    conn, _, _, admin_sid = pg_conn_test_setup
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO users (twitch_user_id, display_name, is_approved)
            VALUES ('666', 'Deny', FALSE) RETURNING id
        """)
        uid = cur.fetchone()["id"]
    conn.commit()

    app = _make_app(conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", admin_sid)
    resp = client.post(f"/admin/users/{uid}/deny")
    assert resp.status_code == 302

    with conn.cursor() as cur:
        cur.execute("SELECT is_approved FROM users WHERE id = %s", (uid,))
        assert cur.fetchone()["is_approved"] is False
        cur.execute(
            "SELECT count(*) AS n FROM tenants WHERE owner_user_id = %s", (uid,)
        )
        assert cur.fetchone()["n"] == 0


def test_non_admin_403(pg_conn_test_setup_non_admin):
    conn, _, _, sid = pg_conn_test_setup_non_admin
    app = _make_app(conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", sid)
    resp = client.post("/admin/users/9999/approve")
    assert resp.status_code == 403
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implementation — `app/views_admin.py`**

```python
"""Admin-Routes: User-Approval, Tenant-Erstellung beim Freigeben."""
import re
import secrets
from flask import (
    Blueprint, redirect, request, render_template, g, current_app
)

from app.middleware import require_admin, _get_conn
from app import sessions as srv_sessions


bp_admin = Blueprint("admin", __name__)


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "user"
    return base[:30]


def _gen_token() -> str:
    return "tok_" + secrets.token_hex(16)


def _unique_slug(conn, base: str) -> str:
    candidate = base
    n = 0
    while True:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM tenants WHERE slug = %s", (candidate,))
            if cur.fetchone() is None:
                return candidate
        n += 1
        candidate = f"{base}-{n}"


@bp_admin.route("/admin/")
@require_admin
def admin_home():
    return render_template("admin_dashboard.html", user=g.user)


@bp_admin.route("/admin/users")
@require_admin
def admin_users():
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT u.id, u.twitch_user_id, u.display_name, u.avatar_url,
                       u.is_admin, u.is_approved, u.created_at,
                       t.slug AS tenant_slug
                FROM users u
                LEFT JOIN tenants t ON t.owner_user_id = u.id
                ORDER BY u.created_at DESC
            """)
            users = [dict(r) for r in cur.fetchall()]
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return render_template("admin_users.html", user=g.user, users=users)


@bp_admin.route("/admin/users/<int:user_id>/approve", methods=["POST"])
@require_admin
def admin_approve(user_id: int):
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            # Set is_approved
            cur.execute("""
                UPDATE users SET is_approved = TRUE
                WHERE id = %s RETURNING display_name
            """, (user_id,))
            row = cur.fetchone()
            if row is None:
                return redirect("/admin/users")
            slug = _unique_slug(conn, _slugify(row["display_name"]))
            # Create tenant
            cur.execute("""
                INSERT INTO tenants (owner_user_id, slug, display_name)
                VALUES (%s, %s, %s) RETURNING id
            """, (user_id, slug, row["display_name"]))
            tid = cur.fetchone()["id"]
            cur.execute(
                "INSERT INTO tenant_credentials (tenant_id) VALUES (%s)", (tid,)
            )
            cur.execute("""
                INSERT INTO widget_tokens (token, tenant_id, label)
                VALUES (%s, %s, 'Default')
            """, (_gen_token(), tid))
        conn.commit()
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return redirect("/admin/users")


@bp_admin.route("/admin/users/<int:user_id>/deny", methods=["POST"])
@require_admin
def admin_deny(user_id: int):
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET is_approved = FALSE WHERE id = %s",
                        (user_id,))
        conn.commit()
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return redirect("/admin/users")


@bp_admin.route("/admin/users/<int:user_id>/suspend", methods=["POST"])
@require_admin
def admin_suspend(user_id: int):
    """Setzt is_approved=FALSE + revoked alle Sessions."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET is_approved = FALSE WHERE id = %s",
                        (user_id,))
        srv_sessions.revoke_all_for_user(conn, user_id)
        conn.commit()
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return redirect("/admin/users")
```

- [ ] **Step 4: Run — pass**

`pytest tests/app/test_approval.py -v` → 3 passed (Tests gehen unter Annahme dass Templates noch nicht existieren; render_template wird in Task 19 verdrahtet — die Route returnt 302, nicht render).

Wenn Tests an render_template scheitern: dummy-Templates anlegen für Task 7:
```bash
mkdir -p app/templates
echo "<html><body>admin home</body></html>" > app/templates/admin_dashboard.html
echo "<html><body>admin users</body></html>" > app/templates/admin_users.html
```

- [ ] **Step 5: Commit**

```bash
git add app/views_admin.py tests/app/test_approval.py app/templates/admin_*.html
git commit -m "feat(app): Admin-Approval Endpoints (approve/deny/suspend) + Tenant-Erstellung"
```

---

## Phase 5: Widget + API Routes

### Task 8: Widget HTML + API Dispatcher unter /s/<token>/

**Files:**
- Create: `app/views_widgets.py`
- Create: `app/views_static.py`
- Create: `tests/app/test_widget_routes.py`

- [ ] **Step 1: Test schreiben**

`tests/app/test_widget_routes.py`:

```python
from app import create_app
from app.middleware import register_middleware
from app.views_widgets import bp_widgets
from app.views_static import bp_static


def _make_app(conn, root_dir):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    app.config["_PROJECT_ROOT"] = str(root_dir)
    register_middleware(app)
    app.register_blueprint(bp_widgets)
    app.register_blueprint(bp_static)
    return app


def test_widget_html_injects_serve_base(pg_conn_test_setup, tmp_path):
    conn, _, token, _ = pg_conn_test_setup
    (tmp_path / "widgets" / "pubg").mkdir(parents=True)
    (tmp_path / "widgets" / "pubg" / "last-match.html").write_text(
        "<html><head></head><body>HI</body></html>"
    )
    app = _make_app(conn, tmp_path)
    resp = app.test_client().get(f"/s/{token}/widgets/pubg/last-match.html")
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    assert "window.__SERVE_BASE__" in body
    assert token in body


def test_widget_static_no_token_needed(pg_conn_test_setup, tmp_path):
    conn, *_ = pg_conn_test_setup
    (tmp_path / "widgets" / "pubg" / "assets").mkdir(parents=True)
    (tmp_path / "widgets" / "pubg" / "assets" / "icon.png").write_bytes(b"\x89PNG")
    app = _make_app(conn, tmp_path)
    resp = app.test_client().get("/widgets-static/pubg/assets/icon.png")
    assert resp.status_code == 200
    assert resp.data.startswith(b"\x89PNG")


def test_unknown_token_404(pg_conn_test_setup, tmp_path):
    conn, *_ = pg_conn_test_setup
    app = _make_app(conn, tmp_path)
    resp = app.test_client().get("/s/tok_nope/widgets/pubg/last-match.html")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implementation — `app/views_widgets.py`**

```python
"""Widget-Routes: HTML mit Inject + API-Dispatcher unter /s/<token>/."""
import os
import re
from flask import Blueprint, send_from_directory, current_app, g, request, abort


bp_widgets = Blueprint("widgets", __name__)


def _project_root() -> str:
    root = current_app.config.get("_PROJECT_ROOT")
    if root:
        return root
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _inject(html: str, token: str) -> str:
    """Setzt window.__SERVE_BASE__ + window.__STATIC_BASE__ ein."""
    script = (
        f'<script>\n'
        f'window.__SERVE_BASE__ = "/s/{token}/";\n'
        f'window.__STATIC_BASE__ = "/widgets-static/";\n'
        f'</script>'
    )
    # In <head> kurz vor </head>; falls kein head: nach <html> erstmal
    if "</head>" in html:
        return html.replace("</head>", script + "\n</head>", 1)
    return script + "\n" + html


@bp_widgets.route("/s/<token>/widgets/<path:filepath>")
def widget_file(token, filepath):
    # tenant_id ist via Middleware bereits resolved
    root = _project_root()
    full_path = os.path.normpath(os.path.join(root, "widgets", filepath))
    if not full_path.startswith(os.path.join(root, "widgets")):
        abort(404)
    if not os.path.exists(full_path):
        abort(404)

    if filepath.endswith(".html"):
        with open(full_path, "r", encoding="utf-8") as f:
            html = f.read()
        return _inject(html, token), 200, {"Content-Type": "text/html; charset=utf-8"}

    # Andere Files (CSS/JS) ohne Inject ausliefern
    return send_from_directory(os.path.dirname(full_path), os.path.basename(full_path))
```

- [ ] **Step 4: `app/views_static.py` (Asset-Pfad ohne Token)**

```python
"""Public static assets fuer Widgets (Maps, Sounds, Icons).

Diese Files enthalten keine sensitiven Daten und werden ohne Token-Check
ausgeliefert — sonst muesste jede Map-Tile durch die Tenant-Resolution.
"""
import os
from flask import Blueprint, send_from_directory, current_app


bp_static = Blueprint("widgets_static", __name__)


@bp_static.route("/widgets-static/<path:filepath>")
def widget_static(filepath):
    root = current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    widgets_root = os.path.join(root, "widgets")
    full_path = os.path.normpath(os.path.join(widgets_root, filepath))
    if not full_path.startswith(widgets_root):
        return ("", 404)
    if not os.path.isfile(full_path):
        return ("", 404)
    return send_from_directory(os.path.dirname(full_path),
                                os.path.basename(full_path))
```

- [ ] **Step 5: Run — pass**

`pytest tests/app/test_widget_routes.py -v` → 3 passed.

- [ ] **Step 6: Commit**

```bash
git add app/views_widgets.py app/views_static.py tests/app/test_widget_routes.py
git commit -m "feat(app): widget-Routes /s/<token>/widgets/... + /widgets-static/"
```

---

### Task 9: API-Routes integrieren (`/api/...` + `/s/<token>/api/...`)

**Files:**
- Create: `app/views_api.py`
- Modify: `pubg/endpoints.py` (HARDCODED_TENANT_ID entfernen, g.tenant_id konsumieren)
- Modify: `pubg/aggregations.py` (dito)
- Modify: `steam/endpoints.py` (dito)
- Create: `tests/app/test_api_routes.py`

- [ ] **Step 1: Test schreiben**

`tests/app/test_api_routes.py`:

```python
from unittest.mock import MagicMock, patch
from app import create_app
from app.middleware import register_middleware
from app.views_api import bp_api


def _make_app(conn):
    app = create_app(testing=True)
    app.config["_PG_CONN_FACTORY"] = lambda: conn
    register_middleware(app)
    app.register_blueprint(bp_api)
    return app


def test_api_via_token_path(pg_conn_test_setup):
    conn, tenant_id, token, _ = pg_conn_test_setup
    app = _make_app(conn)
    # Mock the registry method to inspect tenant_id flow
    with patch("app.views_api._handle_pubg_last_match", return_value={"tid": tenant_id}):
        resp = app.test_client().get(f"/s/{token}/api/pubg/last-match")
        assert resp.status_code == 200
        assert resp.json["tid"] == tenant_id


def test_api_via_session_cookie(pg_conn_test_setup):
    conn, tenant_id, _, sid = pg_conn_test_setup
    app = _make_app(conn)
    client = app.test_client()
    client.set_cookie("localhost", "obskit_sid", sid)
    with patch("app.views_api._handle_pubg_last_match", return_value={"tid": tenant_id}):
        resp = client.get("/api/pubg/last-match")
        assert resp.status_code == 200
        assert resp.json["tid"] == tenant_id


def test_api_unauthenticated_401(pg_conn_test_setup):
    conn, *_ = pg_conn_test_setup
    app = _make_app(conn)
    resp = app.test_client().get("/api/pubg/last-match")
    assert resp.status_code == 401
```

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: `pubg/endpoints.py` — Entferne HARDCODED_TENANT_ID, mache Funktionen explizit**

Lokalisieren: am Datei-Anfang ist `HARDCODED_TENANT_ID = 1`. Entfernen.

Jede Funktion die intern `HARDCODED_TENANT_ID` referenziert, kriegt jetzt `tenant_id` als Pflicht-Argument (das macht der Subagent fuer alle Routes auf einmal — siehe Anweisungen):

Beispiel-Pattern (illustrativ, vor jedem Vorkommen anwenden):
```python
# VORHER
def last_match(conn):
    return self._fetch_last(conn, HARDCODED_TENANT_ID)

# NACHHER
def last_match(conn, tenant_id: int):
    return self._fetch_last(conn, tenant_id)
```

Methoden in `EndpointRegistry`, die durch den Compat-Layer aufgerufen wurden, bleiben so dass `tenant_id` via Argument fließt. Bei vielen ist die Methode bereits in Spec 1 Task 11b mit `HARDCODED_TENANT_ID` geupdated; jetzt nur die Konstante durch Argument ersetzen.

**Konkrete Anweisung an den Subagent:** "Lösche die Konstante `HARDCODED_TENANT_ID` und ersetze jede Verwendung durch einen Funktions-Parameter `tenant_id`. Method-Signaturen erweitern, Caller in der gleichen Datei updaten."

- [ ] **Step 4: `pubg/aggregations.py` und `steam/endpoints.py` — gleiches Pattern**

Selbe Vorgehensweise: Konstante raus, Parameter rein, interne Caller updaten.

- [ ] **Step 5: `app/views_api.py` — Adapter**

```python
"""API-Routes — sowohl /api/* (Cookie) als auch /s/<token>/api/* (Token).

Beide Routen-Familien rufen dieselben Handler — die Middleware hat
g.tenant_id schon gesetzt, wir reichen es einfach durch.
"""
from flask import Blueprint, g, jsonify, request, abort

from app.middleware import require_session, _get_conn


bp_api = Blueprint("api", __name__)


# Stubs — production fuellt diese mit echten Calls in die EndpointRegistry
def _handle_pubg_last_match(conn, tenant_id):
    from pubg.endpoints import _ok  # reuse JSON-encoder
    # In Production: pubg_registry.last_match(conn, tenant_id)
    # Hier Platzhalter, wird in Task 10 (serve.py rewrite) ersetzt
    return {"placeholder": True, "tenant_id": tenant_id}


def _dispatch(path: str, tenant_id: int):
    """Routet /pubg/<sub> oder /steam/<sub> zur richtigen Registry-Methode."""
    parts = path.strip("/").split("/")
    if len(parts) < 2:
        abort(404)
    domain, action = parts[0], parts[1]
    rest = parts[2:]

    conn = _get_conn()
    try:
        if domain == "pubg":
            if action == "last-match":
                return _handle_pubg_last_match(conn, tenant_id)
            # ... weitere routen werden in Task 10 via EndpointRegistry verkabelt
        # Steam analog
        abort(404)
    finally:
        if "_PG_CONN_FACTORY" not in __import__("flask").current_app.config:
            conn.close()


@bp_api.route("/api/<path:apipath>", methods=["GET", "POST"])
def cookie_api(apipath):
    if g.user is None or not g.user["is_approved"]:
        return jsonify({"error": "unauthenticated"}), 401
    if g.tenant_id is None:
        return jsonify({"error": "no_tenant"}), 401
    payload = _dispatch(apipath, g.tenant_id)
    return jsonify(payload)


@bp_api.route("/s/<token>/api/<path:apipath>", methods=["GET", "POST"])
def token_api(token, apipath):
    if g.tenant_id is None:
        abort(404)
    payload = _dispatch(apipath, g.tenant_id)
    return jsonify(payload)
```

- [ ] **Step 6: Run — pass**

`pytest tests/app/test_api_routes.py -v` → 3 passed.

- [ ] **Step 7: Commit**

```bash
git add app/views_api.py pubg/endpoints.py pubg/aggregations.py steam/endpoints.py \
        tests/app/test_api_routes.py
git commit -m "feat(app): API-Routes /api/* + /s/<token>/api/*; HARDCODED_TENANT_ID raus"
```

---

### Task 10: serve.py auf Flask-App umstellen

**Files:**
- Modify: `serve.py`
- Modify: `app/__init__.py` (Endpoint-Registries verdrahten)

- [ ] **Step 1: `app/__init__.py` erweitern um Registries**

```python
"""obs-stream-kit Flask-App-Factory."""
import os
from flask import Flask, jsonify

from app.config import Config, TestingConfig
from app.middleware import register_middleware
from app.auth import bp_auth
from app.views_app import bp_app
from app.views_admin import bp_admin
from app.views_widgets import bp_widgets
from app.views_static import bp_static
from app.views_api import bp_api


def create_app(testing: bool = False) -> Flask:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app = Flask(__name__,
                template_folder=os.path.join("templates"),
                static_folder=os.path.join("static"))
    app.config.from_object(TestingConfig if testing else Config)
    app.config["_PROJECT_ROOT"] = project_root

    register_middleware(app)
    app.register_blueprint(bp_auth)
    app.register_blueprint(bp_app)
    app.register_blueprint(bp_admin)
    app.register_blueprint(bp_widgets)
    app.register_blueprint(bp_static)
    app.register_blueprint(bp_api)

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app
```

- [ ] **Step 2: `serve.py` schlank machen**

Komplett ersetzen durch:

```python
#!/usr/bin/env python3
"""obs-stream-kit Entry-Point.

Startet die Flask-App auf Port 9000 (oder $argv[1]).
"""
import os
import sys

# PUBG-CLI-Modi (vor App-Init)
if len(sys.argv) > 1 and sys.argv[1] == "--init-pubg-db":
    from pubg.cli import init_db
    ROOT = os.path.dirname(os.path.abspath(__file__))
    init_db(ROOT)
    sys.exit(0)
if len(sys.argv) > 1 and sys.argv[1] == "--pubg-cold-start":
    from pubg.cli import cold_start
    ROOT = os.path.dirname(os.path.abspath(__file__))
    sys.exit(cold_start(ROOT))

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 9000
HOST = "0.0.0.0"

from app import create_app

app = create_app()

if __name__ == "__main__":
    # Produktion: hinter nginx, Flask Dev-Server reicht (single-user).
    # Bei Bedarf gunicorn ueber systemd.
    print(f"obs-stream-kit serving on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False)
```

- [ ] **Step 3: Syntax-Check**

```bash
python -m py_compile serve.py
python -c "from app import create_app; app = create_app(); print('routes:', len(app.url_map._rules))"
```
Expected: kein Crash, mindestens 15-20 Routes registriert.

- [ ] **Step 4: Commit**

```bash
git add serve.py app/__init__.py
git commit -m "feat(serve): Flask-App-Entry mit allen Blueprints registriert"
```

---

## Phase 6: UI Pages (Templates + Static)

### Task 11: Base-Template + Landing-Page + Static-Files

**Files:**
- Create: `app/templates/base.html`
- Create: `app/templates/landing.html`
- Create: `app/templates/login_pending.html`
- Create: `app/static/dashboard.css`
- Create: `app/views_app.py`

- [ ] **Step 1: `app/templates/base.html`**

```html
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{% block title %}OBS Stream Kit{% endblock %}</title>
  <link rel="stylesheet" href="/static/dashboard.css">
</head>
<body>
  {% block body %}{% endblock %}
</body>
</html>
```

- [ ] **Step 2: `app/static/dashboard.css`**

Übernommen aus dem v1-Mockup (Block 1 design), extrahiert als globales Stylesheet. Brand-Farben, Sidebar, Cards, Inputs.

```css
:root {
  --brand-purple: #5e2a79;
  --brand-gold: #f2b705;
  --bg: #0e0a14;
  --bg-card: #1c1129;
  --bg-deeper: #14091e;
  --border: #2a1f3a;
  --text: #e9e3f1;
  --text-muted: #c0b6d0;
  --text-dim: #8b7da3;
  --text-very-dim: #6b5d7e;
  --success: #6ce682;
  --danger: #e26a6a;
  --warning: #f2b705;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: "DM Sans", system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

a { color: var(--brand-gold); text-decoration: none; }

.landing {
  min-height: 100vh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 24px;
  text-align: center;
}
.landing-logo {
  width: 80px; height: 80px;
  background: linear-gradient(135deg, var(--brand-purple), var(--brand-gold));
  border-radius: 16px;
  margin-bottom: 24px;
}
.landing h1 { font-size: 32px; margin: 0 0 12px; color: var(--brand-gold); }
.landing p { color: var(--text-muted); margin: 0 0 32px; max-width: 520px; }
.btn-twitch {
  background: #9146ff;
  color: #fff;
  padding: 14px 32px;
  border-radius: 8px;
  border: 0;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex; gap: 10px; align-items: center;
}
.btn-twitch:hover { background: #a25eff; }

.layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
}
.sidebar {
  background: var(--bg-deeper);
  padding: 24px 16px;
  border-right: 1px solid var(--border);
}
.brand {
  display: flex; align-items: center; gap: 10px;
  font-weight: 700; font-size: 16px;
  color: var(--brand-gold);
  margin-bottom: 32px;
}
.brand-dot {
  width: 12px; height: 12px;
  background: linear-gradient(135deg, var(--brand-gold), var(--brand-purple));
  border-radius: 3px;
}
.sidebar nav a {
  display: block;
  padding: 9px 12px;
  margin-bottom: 4px;
  color: var(--text-muted);
  border-radius: 6px;
  font-size: 14px;
  border-left: 3px solid transparent;
}
.sidebar nav a.active,
.sidebar nav a:hover {
  background: rgba(94, 42, 121, 0.35);
  color: var(--brand-gold);
  border-left-color: var(--brand-gold);
}
.sidebar .admin-section {
  margin-top: 28px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.sidebar .admin-label {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-very-dim);
  padding: 0 12px 6px;
}

.main { padding: 28px 32px; }

.topbar {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 24px;
}
.greeting { font-size: 22px; font-weight: 700; }
.user-chip {
  display: flex; align-items: center; gap: 10px;
  background: var(--bg-card);
  padding: 6px 14px 6px 6px;
  border-radius: 100px;
  font-size: 13px;
}
.user-chip img {
  width: 32px; height: 32px; border-radius: 50%;
}

.card {
  background: var(--bg-card);
  border-radius: 10px;
  border: 1px solid var(--border);
  padding: 18px 20px;
  margin-bottom: 16px;
}
.card h3 {
  font-size: 14px;
  margin: 0 0 14px;
  color: var(--brand-gold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.form-row { margin-bottom: 14px; }
.form-row label {
  display: block;
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--text-dim); margin-bottom: 6px;
}
.form-row input, .form-row select {
  width: 100%;
  background: var(--bg-deeper);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 14px;
}
.btn {
  background: var(--brand-purple);
  color: #fff;
  border: 0;
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 600;
}
.btn:hover { background: #7a3b9b; }
.btn-gold { background: var(--brand-gold); color: var(--bg); }
.btn-danger { background: var(--danger); }
.btn-sm { padding: 6px 12px; font-size: 12px; }

table.users {
  width: 100%; border-collapse: collapse;
}
table.users th, table.users td {
  padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border);
  font-size: 13px;
}
table.users th { color: var(--text-dim); text-transform: uppercase; font-size: 11px; }
table.users tr:hover { background: rgba(94,42,121,0.15); }

.url-pill {
  display: flex; justify-content: space-between; align-items: center;
  background: var(--bg-deeper);
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  margin-bottom: 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.url-pill .copy-btn {
  background: var(--brand-purple); color: #fff;
  border: 0; padding: 5px 12px; border-radius: 4px;
  font-size: 11px; cursor: pointer;
}

.pending {
  min-height: 100vh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center; padding: 24px;
}
.pending-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px;
  max-width: 480px;
}
.pending-card h1 { color: var(--brand-gold); margin: 0 0 16px; }
```

- [ ] **Step 3: `app/templates/landing.html`**

```html
{% extends "base.html" %}
{% block title %}OBS Stream Kit{% endblock %}
{% block body %}
<div class="landing">
  <div class="landing-logo"></div>
  <h1>OBS Stream Kit</h1>
  <p>PUBG- und Steam-Stats fuer deinen Twitch-Stream. Tenant-aware Widgets, Telemetrie-Replay, Achievement-Feed.</p>
  <a class="btn-twitch" href="/app/login">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>
    Mit Twitch einloggen
  </a>
</div>
{% endblock %}
```

- [ ] **Step 4: `app/templates/login_pending.html`**

```html
{% extends "base.html" %}
{% block title %}Warte auf Freischaltung — OBS Stream Kit{% endblock %}
{% block body %}
<div class="pending">
  <div class="pending-card">
    <h1>👋 Hallo {{ user.display_name }}</h1>
    <p>Dein Account ist registriert und wartet auf Freischaltung durch den Admin.</p>
    <p style="color: var(--text-dim); font-size: 13px;">Sobald freigegeben, landest du automatisch im Dashboard.</p>
    <p style="margin-top: 24px;"><a href="/app/logout" class="btn btn-sm">Logout</a></p>
  </div>
</div>
<script>
  setInterval(async () => {
    const r = await fetch("/app/pending-check");
    const j = await r.json();
    if (j.approved) location.href = "/app/";
  }, 30000);
</script>
{% endblock %}
```

- [ ] **Step 5: `app/views_app.py` schreiben**

```python
"""Streamer-Routes."""
from flask import (
    Blueprint, render_template, g, jsonify, request, redirect, abort, current_app
)

from app.middleware import require_session, _get_conn
from app import sessions as srv_sessions
from core import credentials as core_creds


bp_app = Blueprint("app_streamer", __name__)


@bp_app.route("/")
def landing():
    if g.user:
        return redirect("/app/")
    return render_template("landing.html")


@bp_app.route("/app/")
@require_session
def dashboard():
    return render_template("dashboard.html", user=g.user)


@bp_app.route("/app/pending")
def pending():
    if g.user is None:
        return redirect("/app/login")
    if g.user["is_approved"]:
        return redirect("/app/")
    return render_template("login_pending.html", user=g.user)


@bp_app.route("/app/pending-check")
def pending_check():
    if g.user is None:
        return jsonify({"approved": False})
    return jsonify({"approved": bool(g.user["is_approved"])})


@bp_app.route("/app/settings", methods=["GET", "POST"])
@require_session
def settings():
    conn = _get_conn()
    try:
        if request.method == "POST":
            pubg_name = request.form.get("pubg_name") or None
            pubg_platform = request.form.get("pubg_platform") or None
            pubg_api_key = request.form.get("pubg_api_key") or None
            steam_id = request.form.get("steam_id") or None
            steam_api_key = request.form.get("steam_api_key") or None
            if pubg_name or pubg_platform or pubg_api_key:
                core_creds.set_pubg(
                    conn, g.tenant_id,
                    name=pubg_name, platform=pubg_platform, api_key=pubg_api_key
                )
            if steam_id or steam_api_key:
                core_creds.set_steam(
                    conn, g.tenant_id,
                    steam_id=steam_id, api_key=steam_api_key
                )
            return redirect("/app/settings?saved=1")
        # GET: Werte laden
        creds = core_creds.get(conn, g.tenant_id)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()
    return render_template("settings.html",
                           user=g.user, creds=creds,
                           saved=request.args.get("saved"))


@bp_app.route("/app/urls")
@require_session
def urls():
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT token, label FROM widget_tokens
                WHERE tenant_id = %s AND revoked_at IS NULL
                ORDER BY created_at
                LIMIT 1
            """, (g.tenant_id,))
            row = cur.fetchone()
            token = row["token"] if row else None
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()

    widgets_list = [
        ("PUBG: Letztes Match", "pubg/last-match.html"),
        ("PUBG: Session-Stats", "pubg/session.html"),
        ("PUBG: Top-Mates", "pubg/flyout-full.html"),
        ("PUBG: Map-Distribution", "pubg/chicken-map.html"),
        ("Steam: Recent Unlocks", "steam/recent-unlocks.html"),
        ("Steam: Owned Games", "steam/games.html"),
    ]
    base_url = request.url_root.rstrip("/")
    return render_template("urls.html",
                           user=g.user, token=token,
                           widgets=widgets_list, base_url=base_url)
```

- [ ] **Step 6: Test der Landing-Page**

`pytest tests/app/test_app_factory.py -v` (sollte weiter passen).

Smoke-Test gegen leeren Test-Server:
```bash
python -c "
from app import create_app
app = create_app(testing=True)
c = app.test_client()
r = c.get('/')
print('GET / status:', r.status_code)
assert r.status_code == 200
print('OK')
"
```

- [ ] **Step 7: Commit**

```bash
git add app/templates/base.html app/templates/landing.html \
        app/templates/login_pending.html app/static/dashboard.css \
        app/views_app.py
git commit -m "feat(app): Landing-Page + Pending-Page + base-Template + dashboard.css"
```

---

### Task 12: Dashboard-Shell + Settings + URLs Templates

**Files:**
- Create: `app/templates/dashboard.html`
- Create: `app/templates/settings.html`
- Create: `app/templates/urls.html`

- [ ] **Step 1: `app/templates/dashboard.html`**

```html
{% extends "base.html" %}
{% block title %}Dashboard — OBS Stream Kit{% endblock %}
{% block body %}
<div class="layout">
  {% include "_sidebar.html" %}
  <main class="main">
    <div class="topbar">
      <div class="greeting">Hallo {{ user.display_name }} 👋</div>
      <div class="user-chip">
        {% if user.avatar_url %}<img src="{{ user.avatar_url }}">{% else %}<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--brand-purple),var(--brand-gold))"></div>{% endif %}
        <span>{{ user.display_name }}</span>
      </div>
    </div>

    <div class="card">
      <h3>Willkommen</h3>
      <p>Dein Tenant ist bereit. Naechste Schritte:</p>
      <ol>
        <li><a href="/app/settings">Trag deine PUBG- und Steam-API-Keys ein</a> — ohne die laeuft kein Poller.</li>
        <li><a href="/app/urls">Hol dir deine OBS-Widget-URLs</a> und konfiguriere sie als Browser-Source.</li>
      </ol>
      <p style="color: var(--text-dim); font-size: 13px; margin-top: 16px;">
        Stats-Cards, Match-History und System-Status-Panel kommen in Spec 3.
      </p>
    </div>
  </main>
</div>
{% endblock %}
```

- [ ] **Step 2: `app/templates/_sidebar.html`** (Partial)

```html
<aside class="sidebar">
  <div class="brand">
    <div class="brand-dot"></div>
    OBS Stream Kit
  </div>
  <nav>
    <a href="/app/" class="{% if request.path == '/app/' %}active{% endif %}">📊 Dashboard</a>
    <a href="/app/settings" class="{% if request.path.startswith('/app/settings') %}active{% endif %}">⚙️ Settings</a>
    <a href="/app/urls" class="{% if request.path.startswith('/app/urls') %}active{% endif %}">🔗 OBS-URLs</a>
    <a href="/app/logout">🚪 Logout</a>
    {% if user.is_admin %}
    <div class="admin-section">
      <div class="admin-label">Admin</div>
      <a href="/admin/users" class="{% if request.path.startswith('/admin/users') %}active{% endif %}">👥 User-Approval</a>
      <a href="/admin/" class="{% if request.path == '/admin/' %}active{% endif %}">📈 Admin-Home</a>
    </div>
    {% endif %}
  </nav>
</aside>
```

- [ ] **Step 3: `app/templates/settings.html`**

```html
{% extends "base.html" %}
{% block title %}Settings — OBS Stream Kit{% endblock %}
{% block body %}
<div class="layout">
  {% include "_sidebar.html" %}
  <main class="main">
    <div class="topbar"><div class="greeting">Settings</div></div>

    {% if saved %}
    <div class="card" style="border-color: var(--success); color: var(--success);">✓ Gespeichert</div>
    {% endif %}

    <form method="POST" class="card">
      <h3>PUBG</h3>
      <div class="form-row">
        <label>Spielername</label>
        <input name="pubg_name" value="{{ creds.pubg_name or '' }}" placeholder="z.B. LuCKoR">
      </div>
      <div class="form-row">
        <label>Plattform</label>
        <select name="pubg_platform">
          <option value="">— wähle —</option>
          <option value="steam" {% if creds.pubg_platform == 'steam' %}selected{% endif %}>Steam</option>
          <option value="kakao" {% if creds.pubg_platform == 'kakao' %}selected{% endif %}>Kakao</option>
          <option value="psn" {% if creds.pubg_platform == 'psn' %}selected{% endif %}>PlayStation</option>
          <option value="xbox" {% if creds.pubg_platform == 'xbox' %}selected{% endif %}>Xbox</option>
        </select>
      </div>
      <div class="form-row">
        <label>API-Key</label>
        <input name="pubg_api_key" type="password" placeholder="{% if creds.pubg_api_key %}(gespeichert — leer lassen zum behalten){% else %}aus developer.pubg.com{% endif %}">
      </div>

      <h3 style="margin-top: 24px;">Steam</h3>
      <div class="form-row">
        <label>Steam-ID (Steam64)</label>
        <input name="steam_id" value="{{ creds.steam_id or '' }}" placeholder="76561198...">
      </div>
      <div class="form-row">
        <label>API-Key</label>
        <input name="steam_api_key" type="password" placeholder="{% if creds.steam_api_key %}(gespeichert — leer lassen zum behalten){% else %}aus steamcommunity.com/dev{% endif %}">
      </div>

      <button class="btn" type="submit">Speichern</button>
    </form>
  </main>
</div>
{% endblock %}
```

- [ ] **Step 4: `app/templates/urls.html`**

```html
{% extends "base.html" %}
{% block title %}OBS-URLs — OBS Stream Kit{% endblock %}
{% block body %}
<div class="layout">
  {% include "_sidebar.html" %}
  <main class="main">
    <div class="topbar"><div class="greeting">OBS Browser-Source URLs</div></div>

    <div class="card">
      <h3>Anleitung</h3>
      <p>Kopiere die URLs unten in OBS als <strong>Browser-Source</strong> (1920x1080 oder je nach Widget). Token ist persistent — wenn du ihn rotierst, musst du alle Browser-Sources neu setzen.</p>
    </div>

    <div class="card">
      <h3>Widgets</h3>
      {% if not token %}
      <p style="color: var(--danger);">Kein Token gefunden — der Admin hat dein Tenant noch nicht eingerichtet.</p>
      {% else %}
      {% for label, path in widgets %}
      <div class="url-pill">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">
          <strong style="color: var(--brand-gold);">{{ label }}</strong> ·
          {{ base_url }}/s/{{ token }}/widgets/{{ path }}
        </span>
        <button class="copy-btn" onclick="navigator.clipboard.writeText('{{ base_url }}/s/{{ token }}/widgets/{{ path }}')">copy</button>
      </div>
      {% endfor %}
      {% endif %}
    </div>

    <div class="card">
      <h3>Streamer.bot Integration</h3>
      <p>Wenn du <a href="https://streamer.bot">Streamer.bot</a> verwendest, ersetze deine bisherigen <code>/api/pubg/...</code> URLs durch:</p>
      <div class="url-pill">
        <span><code>{{ base_url }}/s/{{ token }}/api/pubg/last-match</code></span>
        <button class="copy-btn" onclick="navigator.clipboard.writeText('{{ base_url }}/s/{{ token }}/api/pubg/last-match')">copy</button>
      </div>
    </div>
  </main>
</div>
{% endblock %}
```

- [ ] **Step 5: Smoke-Test gegen lokale Test-DB**

```bash
OBS_KIT_PG_DSN_TEST="postgresql://obs_stream:fWaVreQ-MBljRfsLgciGyXwxescu0BH0@myentry.info:5432/obs_stream_kit_test" \
  pytest tests/app/ -v -k "not oauth_callback and not approval"
```

(Skip OAuth/approval-Tests die Templates noch nicht haben. Sie laufen sobald `/admin/users` und `dashboard` Templates da sind, was jetzt der Fall ist.)

- [ ] **Step 6: Commit**

```bash
git add app/templates/dashboard.html app/templates/_sidebar.html \
        app/templates/settings.html app/templates/urls.html
git commit -m "feat(app): Dashboard-Shell + Settings-Form + URLs-Page Templates"
```

---

### Task 13: Admin-User-Approval Template

**Files:**
- Modify: `app/templates/admin_dashboard.html` (war Stub)
- Modify: `app/templates/admin_users.html` (war Stub)

- [ ] **Step 1: `app/templates/admin_dashboard.html`**

```html
{% extends "base.html" %}
{% block title %}Admin — OBS Stream Kit{% endblock %}
{% block body %}
<div class="layout">
  {% include "_sidebar.html" %}
  <main class="main">
    <div class="topbar"><div class="greeting">Admin-Bereich</div></div>
    <div class="card">
      <h3>Bereiche</h3>
      <ul>
        <li><a href="/admin/users">User-Approval-Queue</a></li>
        <li><span style="color: var(--text-dim)">POI-Editor — kommt in Spec 4</span></li>
        <li><span style="color: var(--text-dim)">System-Status — kommt in Spec 4</span></li>
      </ul>
    </div>
  </main>
</div>
{% endblock %}
```

- [ ] **Step 2: `app/templates/admin_users.html`**

```html
{% extends "base.html" %}
{% block title %}User-Approval — OBS Stream Kit{% endblock %}
{% block body %}
<div class="layout">
  {% include "_sidebar.html" %}
  <main class="main">
    <div class="topbar"><div class="greeting">User-Approval</div></div>
    <div class="card">
      <table class="users">
        <thead>
          <tr>
            <th>Avatar</th>
            <th>Display-Name</th>
            <th>Twitch-ID</th>
            <th>Registriert</th>
            <th>Status</th>
            <th>Aktion</th>
          </tr>
        </thead>
        <tbody>
          {% for u in users %}
          <tr>
            <td>{% if u.avatar_url %}<img src="{{ u.avatar_url }}" style="width:28px;height:28px;border-radius:50%">{% endif %}</td>
            <td>{{ u.display_name }}{% if u.is_admin %} <span style="color: var(--brand-gold); font-size: 11px;">[Admin]</span>{% endif %}</td>
            <td><code>{{ u.twitch_user_id or '—' }}</code></td>
            <td style="color: var(--text-dim); font-size: 12px;">{{ u.created_at.strftime("%Y-%m-%d %H:%M") }}</td>
            <td>
              {% if u.is_approved %}
              <span style="color: var(--success);">✓ Aktiv</span>
              {% else %}
              <span style="color: var(--warning);">⏳ Wartend</span>
              {% endif %}
            </td>
            <td>
              {% if not u.is_admin %}
                {% if not u.is_approved %}
                <form method="POST" action="/admin/users/{{ u.id }}/approve" style="display:inline">
                  <button type="submit" class="btn btn-sm btn-gold">✓ Freigeben</button>
                </form>
                <form method="POST" action="/admin/users/{{ u.id }}/deny" style="display:inline">
                  <button type="submit" class="btn btn-sm btn-danger">✗ Ablehnen</button>
                </form>
                {% else %}
                <form method="POST" action="/admin/users/{{ u.id }}/suspend" style="display:inline">
                  <button type="submit" class="btn btn-sm btn-danger">🔒 Sperren</button>
                </form>
                {% endif %}
              {% endif %}
            </td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </main>
</div>
{% endblock %}
```

- [ ] **Step 3: Re-run alle Tests**

```bash
pytest tests/app/ -v
```
Expected: kein Test scheitert mehr an fehlenden Templates.

- [ ] **Step 4: Commit**

```bash
git add app/templates/admin_dashboard.html app/templates/admin_users.html
git commit -m "feat(app): admin_dashboard + admin_users Templates"
```

---

## Phase 7: Widget JS Integration

### Task 14: Widget-API-Helper + JS-Anpassung in Widget-Files

**Files:**
- Create: `widgets/_common/api.js`
- Modify: ~30 Widget-HTML-Files (find via grep)

- [ ] **Step 1: `widgets/_common/api.js`**

```javascript
// Helper für API-URL-Konstruktion mit __SERVE_BASE__.
// Wird per <script src="/widgets-static/_common/api.js"> oder
// direkter Pfad eingebunden.
window.API = {
  url(path) {
    const base = window.__SERVE_BASE__ || "/";
    // path beginnt typisch mit "api/" oder "/api/"
    const clean = path.startsWith("/") ? path.slice(1) : path;
    return base + clean;
  },
  get(path) {
    return fetch(this.url(path)).then(r => r.json());
  }
};
```

- [ ] **Step 2: Widget-HTML-Files patchen**

Identifiziere alle Widget-HTML-Files die `/api/` direkt nutzen:

```bash
grep -rln 'fetch("/api/\|fetch(\x27/api/' widgets/ --include="*.html" --include="*.js"
```

In jedem File:
- `<script>` Block einfuegen am Anfang: `<script src="/widgets-static/_common/api.js"></script>` (ODER falls JS in `.js` Datei: dort sicherstellen dass `window.API` verfuegbar ist via load-order)
- `fetch("/api/pubg/last-match")` → `fetch(API.url("/api/pubg/last-match"))` (oder `API.get("/api/pubg/last-match")` für JSON-Antworten)

**Subagent-Anweisung:** "Finde alle `fetch("/api/...")` und `fetch('/api/...')` in `widgets/`-HTML/JS-Files. Ersetze durch `fetch(API.url(...))`. Stelle sicher dass das api.js-Script vorher gelangt wird (entweder via `<script>`-Tag in HTML oder als ESM-Import). Behalte Query-Parameter bei (range, sortBy etc. — die werden in Spec 3 entfernt, nicht jetzt)."

- [ ] **Step 3: Smoke-Test einer einzelnen HTML-Page**

```bash
# Lokal: Flask-App starten und Widget aufrufen
OBS_KIT_PG_DSN="<test-dsn>" OBS_KIT_MASTER_KEY="<key>" python serve.py 9000 &
SERVER_PID=$!
sleep 2
curl -s http://localhost:9000/s/tok_a8f9.../widgets/pubg/last-match.html | grep -c "__SERVE_BASE__"
# Expected: >= 1 (das injection-script ist drin)
kill $SERVER_PID
```

- [ ] **Step 4: Commit**

```bash
git add widgets/
git commit -m "feat(widgets): API.url-Helper + JS-Calls auf SERVE_BASE umgestellt"
```

---

## Phase 8: Cutover

### Task 15: Streamer.bot + Admin-Pre-Seed Doku (MANUAL CONTEXT)

**Files:**
- Create: `docs/streamerbot-migration.md`
- Create: `docs/spec-2-deploy.md`

- [ ] **Step 1: `docs/streamerbot-migration.md`**

```markdown
# Streamer.bot Migration (Spec 2 Cutover)

Spec 2 entfernt die globale Basic-Auth in nginx. Streamer.bot kann sich nicht
mehr per `.htpasswd`-Header authentifizieren — es nutzt ab jetzt URL-Tokens.

## Schritte

1. Admin loggt sich auf https://king-edition.de/app/ ein.
2. Navigiert zu `/app/urls`.
3. Kopiert sein **Default-Token** (Format `tok_xxxxxxxx...`).
4. In Streamer.bot: jeden API-Aufruf von:
   - **Alt:** `https://king-edition.de/api/pubg/last-match`
   - **Neu:** `https://king-edition.de/s/tok_xxxxxxxx.../api/pubg/last-match`
5. Auth-Header in Streamer.bot entfernen (kein `Authorization: Basic ...` mehr).

## Validierung

```bash
curl -s "https://king-edition.de/s/<token>/api/pubg/last-match" | jq .matchId
```
Sollte 200 + die last-match-ID liefern, ohne Header.
```

- [ ] **Step 2: `docs/spec-2-deploy.md`**

```markdown
# Spec 2 Deploy-Plan

## Vor-Deploy-Schritte

1. **Admin-Twitch-User-ID besorgen.** Login auf https://dev.twitch.tv,
   auf einem persönlichen Twitch-Account, "Get my user data" via Helix-API.
   Alternative: Tools wie streamweasels.com/twitch-tools/convert-username-to-user-id
   Speichern als Variable, z.B. `ADMIN_TWITCH_ID=123456789`.

2. **Twitch-OAuth-App anlegen** unter https://dev.twitch.tv/console/apps:
   - Name: "OBS Stream Kit (king-edition.de)"
   - OAuth Redirect URLs: `https://king-edition.de/app/oauth/callback`
   - Category: Application Integration
   - Speichern → Client-ID + Client-Secret notieren.

3. **`.secrets` auf Server erweitern:**
   ```bash
   ssh -i ~/.ssh/entry_server root@87.106.4.31 \
     "cat >> /opt/obs-stream-kit/.secrets <<'EOF'
   Twitch App Client-ID: <client-id>
   Twitch App Client-Secret: <client-secret>
   Flask Secret-Key: <generate via: python -c 'import secrets; print(secrets.token_urlsafe(48))'>
   EOF"
   ```

4. **Admin-Twitch-ID pre-seed:**
   ```bash
   ssh -i ~/.ssh/entry_server root@87.106.4.31 \
     "sudo -u postgres psql obs_stream_kit \
        -c \"UPDATE users SET twitch_user_id = '$ADMIN_TWITCH_ID' WHERE id = 1\""
   ```

## Deploy

```bash
# 1. Code deployen
bash scripts/deploy.sh

# 2. Schema-Migration ausfuehren
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "sudo -u postgres psql obs_stream_kit < /opt/obs-stream-kit/core/schema_v2.sql"

# 3. nginx Basic-Auth entfernen
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "sed -i.bak '/auth_basic/d' /etc/nginx/sites-enabled/obs-stream-kit.conf && nginx -t && systemctl reload nginx"

# 4. Service ist von deploy.sh schon restartet — kontrollieren
ssh -i ~/.ssh/entry_server root@87.106.4.31 'systemctl status obs-stream-kit --no-pager -l | head -10'
```

## Post-Deploy Smoke-Tests

```bash
# Landing
curl -s -o /dev/null -w "%{http_code}\n" https://king-edition.de/
# Expected: 200

# Login Start (sollte zu Twitch redirect)
curl -s -o /dev/null -w "%{http_code} → %{redirect_url}\n" \
  https://king-edition.de/app/login
# Expected: 302 → https://id.twitch.tv/oauth2/authorize?...

# Admin loggt sich ein (manuell im Browser)
# https://king-edition.de/ → "Mit Twitch einloggen"

# Nach Login: Admin holt sich die Token-URL aus /app/urls
# OBS-Sources umstellen → Widget-Tests
```

## Rollback (Notfall)

```bash
# 1. Code zurueck
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "cd /opt/obs-stream-kit-rollback && rsync -a . /opt/obs-stream-kit/ && systemctl restart obs-stream-kit"
# (Vorausgesetzt /opt/obs-stream-kit-rollback ist ein Pre-Cutover-Snapshot.)

# 2. nginx Basic-Auth wieder rein
ssh ... "cp /etc/nginx/sites-enabled/obs-stream-kit.conf.bak /etc/nginx/sites-enabled/obs-stream-kit.conf && systemctl reload nginx"

# 3. PG-Schema NICHT zurueck rollen (additive only).
```
```

- [ ] **Step 3: Commit**

```bash
git add docs/streamerbot-migration.md docs/spec-2-deploy.md
git commit -m "docs(spec-2): Streamer.bot-Migration + Deploy-Plan"
```

---

### Task 16: Live-Deploy + Cutover (MANUELL mit User-Bestätigung)

> **⚠️ Manueller Schritt — nicht in Subagent ausführen.**

- [ ] **Step 1: Admin-Twitch-ID besorgen** (User: manuell, via dev.twitch.tv oder Web-Tool).

- [ ] **Step 2: Twitch-OAuth-App anlegen** auf dev.twitch.tv mit Redirect-URI `https://king-edition.de/app/oauth/callback`.

- [ ] **Step 3: Server-`.secrets` erweitern** mit `Twitch App Client-ID`, `Twitch App Client-Secret`, `Flask Secret-Key` (siehe `docs/spec-2-deploy.md`).

- [ ] **Step 4: Admin-Row pre-seed**

```bash
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "sudo -u postgres psql obs_stream_kit \
     -c \"UPDATE users SET twitch_user_id = '<DEINE-ID>' WHERE id = 1\""
```

- [ ] **Step 5: Schema-Migration auf Live-DB**

```bash
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "sudo -u postgres psql obs_stream_kit -f /opt/obs-stream-kit/core/schema_v2.sql"
```

- [ ] **Step 6: Code deployen**

```bash
bash scripts/deploy.sh
```

- [ ] **Step 7: nginx Basic-Auth entfernen**

```bash
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  "sed -i.bak '/auth_basic/d' /etc/nginx/sites-enabled/obs-stream-kit.conf && nginx -t && systemctl reload nginx"
```

- [ ] **Step 8: Service-Health-Check**

```bash
ssh -i ~/.ssh/entry_server root@87.106.4.31 \
  'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9000/healthz'
# Expected: 200
```

- [ ] **Step 9: End-to-End Browser-Test**

User öffnet https://king-edition.de/ → Login mit Twitch → landet im Dashboard → /app/urls → kopiert Token-URL → öffnet in neuem Tab → Widget rendert.

- [ ] **Step 10: Streamer.bot umstellen** (siehe `docs/streamerbot-migration.md`).

- [ ] **Step 11: OBS-Browser-Sources umstellen** (Admin: ~30 Sources in OBS auf die neuen Token-URLs ändern).

- [ ] **Step 12: Commit-Marker**

```bash
git commit --allow-empty -m "chore(deploy): Spec 2 Cutover live"
git push
```

---

## Self-Review-Notiz

Nach Spec-Vergleich (Vorgaben vs. Tasks):

| Spec-Abschnitt | Task |
|---|---|
| §1 HTTP-Framework Flask | Task 2 (App-Factory), Task 10 (serve.py) |
| §2 Twitch OAuth | Task 5 (twitch_client), Task 6 (auth flow + admin-claim) |
| §3 URL-Token-Routing | Task 8 (widget routes) |
| §4 Schema-Änderungen | Task 1 (schema_v2.sql) |
| §5 UI-Komponenten | Tasks 11, 12, 13 |
| §6 Tenant-aware Domain-Code | Task 9 (HARDCODED_TENANT_ID removal) |
| §7 Streamer.bot-Migration | Task 15 (docs), Task 16 (manual cutover) |
| Sessions (Server-Side) | Task 3 |
| Middleware | Task 4 |
| Approval-Flow | Task 7 |

Spec-Anforderungen ohne Task: keine — alle abgedeckt.

Placeholders/TBDs gescannt: keine.

Type/Signature-Konsistenz: `tenant_id` ist in `_handle_pubg_last_match`-Stub (Task 9) wie auch in den Aggregations-Funktionen ein int. `g.tenant_id` ist überall int. CredBundle-Felder werden konsistent verwendet.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-auth-tenant-routing.md`. Two execution options:

**1. Subagent-Driven (recommended)** — ich dispatche pro Task einen frischen Subagent, mit zwei-stufigem Review danach. Konsistent mit Spec 1.

**2. Inline Execution** — wir arbeiten Tasks in dieser Session ab.

Manuelle User-Steps (Task 1 Server-Apt, Task 16 komplett) gehen ohnehin durch dich oder über meine SSH-Calls. Code-Tasks sind klar abgegrenzt.

**Welcher Ansatz?**
