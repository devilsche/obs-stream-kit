# Overlay-Service-Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den heutigen Flask-Monolithen in zwei Prozesse splitten — Service 1 (`stats-overlay.info`: API + Dashboard + Widgets/Tools, unverändert) und Service 2 (`overlays.stats-overlay.info`: Produktions-Overlays + Mini-Dashboard) — über eine geteilte `webcore/`-Basis, ohne Code zu duplizieren.

**Architecture:** Die in beiden Services benötigten Module (`config`, `sessions`, `middleware`, `auth`, `twitch_client`, `metrics`, `creds_gate`) werden aus `app/` nach `webcore/` extrahiert (verhaltensneutral, die bestehende Test-Suite ist das Sicherheitsnetz). Service 2 (`overlay_app/`) ist eine dünne neue Flask-App, die `webcore`-Middleware/Metrics nutzt, die fünf Overlays tokenisiert mit Tenant-Channel-Injection ausliefert und ein schlankes Login-geschütztes Dashboard zeigt. Der BRB-Clip-Player ruft nicht mehr Twitch direkt (Client-Secret im Browser), sondern einen server-seitigen `/s/<token>/api/twitch/clips`-Endpoint.

**Tech Stack:** Python 3 / Flask, psycopg (Postgres), pytest, prometheus_client, Vanilla-JS-Frontend, systemd + nginx.

---

## Begründete Abweichung von der Spec

Die Spec verortete den `twitch/clips`-Endpoint bei Service 1 (`views_api.py`). Der BRB-Overlay wird aber von Service 2 (`overlays.stats-overlay.info`) ausgeliefert und ruft den Endpoint relativ (`__SERVE_BASE__ + "api/twitch/clips"`). Damit das **same-origin** bleibt (kein CORS), lebt der Endpoint in `webcore/` (geteilt) und wird von **`overlay_app`** registriert. Außerdem nutzt er die **tenant-eigenen** Twitch-Credentials aus `core.credentials.CredBundle` (`twitch_client_id`, `twitch_client_secret`, `twitch_channel`) — nicht globale.

---

## File Structure

**Neu:**
- `webcore/__init__.py` — leeres Package-Marker
- `webcore/{config,sessions,middleware,auth,twitch_client,metrics,creds_gate}.py` — verschoben aus `app/`
- `webcore/serving.py` — `inject_window_vars()` + tokenisiertes Datei-Serving + static-Helper
- `webcore/views_twitch.py` — `bp_twitch` mit `/s/<token>/api/twitch/clips`
- `overlay_app/__init__.py` — `create_app()` für Service 2
- `overlay_app/overlay_catalog.py` — Overlay-Metadaten
- `overlay_app/views_overlays.py` — Overlay- + Asset-Serving unter `/s/<token>/`
- `overlay_app/views_dashboard.py` — Mini-Dashboard `/`
- `overlay_app/templates/{base.html,overlay_dashboard.html}`
- `overlay_app/static/overlay.css`
- `serve_overlays.py` — Entry-Point Service 2 (:9001)
- `tests/webcore/` + `tests/overlay_app/` — neue Tests
- `docs/overlays-systemd.service.example`, `docs/overlays-nginx.conf.example`

**Geändert:**
- `app/__init__.py`, `app/views_*.py` — Importe auf `webcore.*` umbiegen
- `pubg/api_client.py`, `steam/api_client.py` — `app.metrics` → `webcore.metrics`
- `tests/app/*` — Importe der verschobenen Module umbiegen
- `js/clip-player.js`, `scenes/brb-pause.html` — Clip-Fetch auf Server-Endpoint
- `scenes/` → `overlays/` (Verzeichnis-Rename)
- `README.md` — neuer Service dokumentiert

---

## Task 1: `webcore/` anlegen und Module verschieben (verhaltensneutral)

Reines Verschieben + Import-Rewrite. Sicherheitsnetz: die bestehende Suite muss danach unverändert grün sein.

**Files:**
- Create: `webcore/__init__.py`
- Move: `app/{config,sessions,middleware,auth,twitch_client,metrics,creds_gate}.py` → `webcore/`
- Modify (Importe): `app/__init__.py`, `app/views_app.py`, `app/views_widgets.py`, `app/views_api.py`, `app/views_admin.py`, `pubg/api_client.py`, `steam/api_client.py`, `tests/app/*.py`

- [ ] **Step 1: Baseline — Suite grün vor dem Umbau**

Run: `python3 -m pytest -q`
Expected: PASS (alle bestehenden Tests grün — Ausgangszustand festhalten).

- [ ] **Step 2: Package anlegen und Module per `git mv` verschieben**

```bash
mkdir -p webcore
: > webcore/__init__.py
git add webcore/__init__.py
for m in config sessions middleware auth twitch_client metrics creds_gate; do
  git mv app/$m.py webcore/$m.py
done
```

- [ ] **Step 3: Intra-`webcore`-Importe umbiegen**

Diese sieben Module importierten sich gegenseitig über `app.*`. Innerhalb `webcore/` müssen sie auf `webcore.*` zeigen:

```bash
# Genau diese Modulnamen sind eindeutig -> sicheres sed.
sed -i \
  -e 's/from app\.config import/from webcore.config import/' \
  -e 's/from app\.middleware import/from webcore.middleware import/' \
  -e 's/from app\.twitch_client import/from webcore.twitch_client import/' \
  -e 's/from app import sessions/from webcore import sessions/' \
  webcore/middleware.py webcore/auth.py webcore/sessions.py webcore/twitch_client.py
# metrics.py: lazy-import im DB-Refresh
sed -i 's/from app\.middleware import _get_conn/from webcore.middleware import _get_conn/' webcore/metrics.py
```

- [ ] **Step 4: Importe in `app/`, `pubg/`, `steam/` umbiegen**

```bash
sed -i \
  -e 's/from app\.config import/from webcore.config import/' \
  -e 's/from app\.middleware import/from webcore.middleware import/' \
  -e 's/from app\.auth import/from webcore.auth import/' \
  -e 's/from app\.metrics import/from webcore.metrics import/' \
  -e 's/from app\.creds_gate import/from webcore.creds_gate import/' \
  -e 's/from app\.twitch_client import/from webcore.twitch_client import/' \
  -e 's/from app import sessions/from webcore import sessions/' \
  app/__init__.py app/views_app.py app/views_widgets.py app/views_api.py app/views_admin.py \
  pubg/api_client.py steam/api_client.py
```

- [ ] **Step 5: Importe in `tests/app/` umbiegen**

`create_app` bleibt `from app import create_app` — nur die verschobenen Module wechseln:

```bash
sed -i \
  -e 's/from app\.middleware import/from webcore.middleware import/' \
  -e 's/from app\.auth import/from webcore.auth import/' \
  -e 's/from app import sessions/from webcore import sessions/' \
  -e 's/from app import twitch_client/from webcore import twitch_client/' \
  tests/app/*.py
```

- [ ] **Step 6: Prüfen, dass keine veralteten Referenzen übrig sind**

Run: `grep -rn "from app\.\(config\|sessions\|middleware\|auth\|twitch_client\|metrics\|creds_gate\)\|from app import sessions\|from app import twitch_client" app/ webcore/ pubg/ steam/ tests/ --include=*.py`
Expected: keine Treffer (leere Ausgabe).

- [ ] **Step 7: Suite erneut grün — Verschiebung war verhaltensneutral**

Run: `python3 -m pytest -q`
Expected: PASS — identische Anzahl wie in Step 1.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(webcore): geteilte Flask-Schicht aus app/ extrahiert (verhaltensneutral)"
```

---

## Task 2: `webcore/serving.py` — Injection + Datei-Serving DRY

`_inject()` (in `app/views_widgets.py`) und die `_serve_under()`-Helper (in `app/views_static.py`) werden generalisiert nach `webcore/serving.py`, damit der Overlay-Service sie wiederverwendet. Verhalten der Widgets bleibt identisch.

**Files:**
- Create: `webcore/serving.py`
- Test: `tests/webcore/test_serving.py`
- Modify: `app/views_widgets.py`, `app/views_static.py`

- [ ] **Step 1: Failing test für `inject_window_vars`**

```python
# tests/webcore/test_serving.py
from webcore.serving import inject_window_vars


def test_inject_inserts_before_head_close():
    html = "<html><head><title>x</title></head><body></body></html>"
    out = inject_window_vars(html, {"__SERVE_BASE__": "/s/tok/",
                                     "__TWITCH_CHANNEL__": "luckor"})
    assert 'window.__SERVE_BASE__ = "/s/tok/";' in out
    assert 'window.__TWITCH_CHANNEL__ = "luckor";' in out
    # vor </head> eingefügt
    assert out.index("window.__SERVE_BASE__") < out.index("</head>")


def test_inject_prepends_when_no_head():
    html = "<body>x</body>"
    out = inject_window_vars(html, {"__SERVE_BASE__": "/s/tok/"})
    assert out.startswith("<script>")
```

- [ ] **Step 2: Test schlägt fehl**

Run: `python3 -m pytest tests/webcore/test_serving.py -v`
Expected: FAIL — `ModuleNotFoundError: webcore.serving` (ggf. `tests/webcore/__init__.py` anlegen: `: > tests/webcore/__init__.py`).

- [ ] **Step 3: `webcore/serving.py` implementieren**

```python
"""Geteilte Serving-Helfer: Window-Var-Injection + tokenisiertes Datei-Serving.

Von Service 1 (Widgets/Tools) und Service 2 (Overlays) gemeinsam genutzt.
"""
import json
import os
from flask import send_from_directory, abort


def inject_window_vars(html: str, variables: dict) -> str:
    """Setzt window.<KEY> = <json-value>; in einen <script>-Block vor </head>."""
    lines = "\n".join(
        f"window.{k} = {json.dumps(v)};" for k, v in variables.items()
    )
    script = f"<script>\n{lines}\n</script>"
    if "</head>" in html:
        return html.replace("</head>", script + "\n</head>", 1)
    return script + "\n" + html


def _safe_full_path(root: str, subdir: str, filepath: str):
    """Pfad innerhalb root/subdir auflösen, Traversal blocken. None wenn ungültig."""
    base = os.path.join(root, subdir)
    full = os.path.normpath(os.path.join(base, filepath))
    if not full.startswith(base) or not os.path.isfile(full):
        return None
    return full


def serve_asset(root: str, subdir: str, filepath: str):
    """Statische Datei aus root/subdir ausliefern (kein Inject)."""
    full = _safe_full_path(root, subdir, filepath)
    if full is None:
        abort(404)
    return send_from_directory(os.path.dirname(full), os.path.basename(full))


def serve_html_or_asset(root: str, subdir: str, filepath: str, variables: dict):
    """HTML-Dateien mit Inject ausliefern, alles andere als statisches Asset."""
    full = _safe_full_path(root, subdir, filepath)
    if full is None:
        abort(404)
    if filepath.endswith(".html"):
        with open(full, "r", encoding="utf-8") as f:
            html = f.read()
        return (inject_window_vars(html, variables), 200,
                {"Content-Type": "text/html; charset=utf-8"})
    return send_from_directory(os.path.dirname(full), os.path.basename(full))
```

- [ ] **Step 4: Test grün**

Run: `python3 -m pytest tests/webcore/test_serving.py -v`
Expected: PASS.

- [ ] **Step 5: `app/views_static.py` auf `serve_asset` umstellen**

Ersetze den Inhalt von `_serve_under` durch den geteilten Helfer:

```python
"""Public static assets fuer Widgets (Maps, Sounds, Icons)."""
import os
from flask import Blueprint, current_app
from webcore.serving import serve_asset


bp_static = Blueprint("widgets_static", __name__)


def _root() -> str:
    return current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))


@bp_static.route("/widgets-static/<path:filepath>")
def widget_static(filepath):
    return serve_asset(_root(), "widgets", filepath)


@bp_static.route("/tools-static/<path:filepath>")
def tools_static(filepath):
    return serve_asset(_root(), "tools", filepath)
```

- [ ] **Step 6: `app/views_widgets.py` — `_inject` durch `inject_window_vars` ersetzen**

Lösche die lokale `_inject`-Funktion. Ersetze in `widget_file` den finalen Inject-Aufruf:

```python
from webcore.serving import inject_window_vars
# ... innerhalb widget_file, statt: return _inject(html, token), 200, {...}
        variables = {
            "__SERVE_BASE__": f"/s/{token}/",
            "__STATIC_BASE__": "/widgets-static/",
        }
        return (inject_window_vars(html, variables), 200,
                {"Content-Type": "text/html; charset=utf-8"})
```

- [ ] **Step 7: Widget-Tests grün (Verhalten unverändert)**

Run: `python3 -m pytest tests/app/test_widget_routes.py tests/webcore/test_serving.py -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(webcore): Injection + static-Serving nach webcore.serving (DRY)"
```

---

## Task 3: Konfigurierbare `LOGIN_URL` / `PENDING_URL`

`require_*`-Decorators redirecten hart auf `/app/login` bzw. `/app/pending`. Der Overlay-Service braucht absolute Haupt-Domain-URLs.

**Files:**
- Modify: `webcore/config.py`, `webcore/middleware.py`
- Test: `tests/webcore/test_login_url.py`

- [ ] **Step 1: Failing test**

```python
# tests/webcore/test_login_url.py
from flask import Flask, g
from webcore.middleware import require_session


def _app(login_url=None):
    app = Flask(__name__)
    if login_url:
        app.config["LOGIN_URL"] = login_url

    @app.route("/secret")
    @require_session
    def secret():
        return "ok"

    @app.before_request
    def _no_user():
        g.user = None
    return app


def test_default_login_redirect():
    c = _app().test_client()
    r = c.get("/secret")
    assert r.status_code == 302
    assert r.headers["Location"] == "/app/login"


def test_custom_login_redirect():
    c = _app("https://stats-overlay.info/app/login").test_client()
    r = c.get("/secret")
    assert r.status_code == 302
    assert r.headers["Location"] == "https://stats-overlay.info/app/login"
```

- [ ] **Step 2: Test schlägt fehl**

Run: `python3 -m pytest tests/webcore/test_login_url.py -v`
Expected: FAIL — `test_custom_login_redirect` bekommt `/app/login` statt der absoluten URL.

- [ ] **Step 3: `webcore/config.py` — Defaults ergänzen**

In `class Config` einfügen (z.B. unter `OBSKIT_SID_COOKIE`):

```python
    LOGIN_URL = "/app/login"
    PENDING_URL = "/app/pending"
```

- [ ] **Step 4: `webcore/middleware.py` — Decorators auf Config lesen**

Ersetze die drei hartkodierten Redirect-Paare. `current_app` ist oben bereits importiert.

```python
def require_session(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return redirect(current_app.config.get("LOGIN_URL", "/app/login"))
        if not g.user["is_approved"]:
            return redirect(current_app.config.get("PENDING_URL", "/app/pending"))
        return view(*args, **kwargs)
    return wrapper


def require_admin(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return redirect(current_app.config.get("LOGIN_URL", "/app/login"))
        if not g.user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)
    return wrapper


def require_approved(view):
    """Erlaubt is_approved=FALSE nur auf /app/pending und /app/logout."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return redirect(current_app.config.get("LOGIN_URL", "/app/login"))
        if not g.user["is_approved"]:
            return redirect(current_app.config.get("PENDING_URL", "/app/pending"))
        return view(*args, **kwargs)
    return wrapper
```

- [ ] **Step 5: Tests grün (neu + bestehende Auth-Tests)**

Run: `python3 -m pytest tests/webcore/test_login_url.py tests/app/test_middleware.py tests/app/test_approval.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(webcore): require_* nutzt konfigurierbare LOGIN_URL/PENDING_URL"
```

---

## Task 4: Cross-Subdomain-Cookie-Domain

Login-Cookie muss optional `domain=.stats-overlay.info` setzen, damit es an beide Subdomains geht. Default bleibt host-only (Tests/lokal unverändert).

**Files:**
- Modify: `webcore/config.py`, `webcore/auth.py`
- Test: `tests/webcore/test_cookie_domain.py`

- [ ] **Step 1: Failing test**

```python
# tests/webcore/test_cookie_domain.py
from unittest import mock
from app import create_app


def _login_response(monkeypatch_cfg):
    app = create_app(testing=True)
    for k, v in monkeypatch_cfg.items():
        app.config[k] = v
    client = app.test_client()
    with mock.patch("webcore.auth.exchange_code", return_value="tok"), \
         mock.patch("webcore.auth.get_user_info",
                    return_value={"id": "123", "display_name": "x",
                                  "profile_image_url": ""}):
        with client.session_transaction() as s:
            s["oauth_state"] = "st"
        return client.get("/app/oauth/callback?state=st&code=c")


def test_cookie_has_domain_when_configured():
    r = _login_response({"OBSKIT_COOKIE_DOMAIN": ".stats-overlay.info"})
    set_cookie = "".join(r.headers.get_all("Set-Cookie"))
    assert "Domain=.stats-overlay.info" in set_cookie


def test_cookie_host_only_by_default():
    r = _login_response({"OBSKIT_COOKIE_DOMAIN": None})
    set_cookie = "".join(r.headers.get_all("Set-Cookie"))
    assert "Domain=" not in set_cookie
```

> Hinweis: `_lookup_or_create_user` schreibt in die DB. Falls die Test-DB-Fixture (`tests/app/conftest.py`) nötig ist, in `tests/webcore/conftest.py` denselben `client`/DB-Aufbau spiegeln wie in `tests/app/test_oauth.py`. Orientiere dich exakt an `tests/app/test_oauth.py` für das DB-Setup.

- [ ] **Step 2: Test schlägt fehl**

Run: `python3 -m pytest tests/webcore/test_cookie_domain.py -v`
Expected: FAIL — `Domain=` fehlt im Set-Cookie.

- [ ] **Step 3: `webcore/config.py` — Domain-Default**

In `class Config` ergänzen:

```python
    OBSKIT_COOKIE_DOMAIN = os.environ.get("OBS_KIT_COOKIE_DOMAIN") or None
```

- [ ] **Step 4: `webcore/auth.py` — `set_cookie` + `delete_cookie` mit Domain**

Im Callback (`resp.set_cookie(...)`):

```python
    resp.set_cookie(
        Config.OBSKIT_SID_COOKIE, sid,
        max_age=Config.SESSION_LIFETIME_DAYS * 86400,
        secure=not current_app.config.get("TESTING"),
        httponly=True, samesite="Lax",
        domain=current_app.config.get("OBSKIT_COOKIE_DOMAIN"),
    )
```

Im Logout (`resp.delete_cookie(...)`):

```python
    resp.delete_cookie(
        Config.OBSKIT_SID_COOKIE,
        domain=current_app.config.get("OBSKIT_COOKIE_DOMAIN"),
    )
```

- [ ] **Step 5: Tests grün**

Run: `python3 -m pytest tests/webcore/test_cookie_domain.py tests/app/test_oauth.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(webcore): optionale Cookie-Domain fuer Cross-Subdomain-SSO"
```

---

## Task 5: `scenes/` → `overlays/` umbenennen

Die fünf Produktions-Overlays bekommen ihren korrekten Ort. Relative Asset-Pfade (`../assets/`, `../js/`) bleiben unverändert — sie werden in Task 7 token-scoped bedient.

**Files:**
- Move: `scenes/` → `overlays/`
- Modify: `README.md` (Pfad-Referenzen `scenes/` → `overlays/`)

- [ ] **Step 1: Verzeichnis umbenennen**

```bash
git mv scenes overlays
```

- [ ] **Step 2: Prüfen, ob Quellcode auf `scenes/` verweist**

Run: `grep -rn "scenes/" app/ webcore/ pubg/ steam/ serve.py --include=*.py`
Expected: keine Treffer (die Overlays werden bisher nirgends vom Backend referenziert). Falls doch Treffer → dort auf `overlays/` anpassen.

- [ ] **Step 3: README-Referenzen anpassen**

Run: `grep -rn "scenes/" README.md`
Für jeden Treffer `scenes/` → `overlays/` ersetzen (Pfadangaben in der Doku).

- [ ] **Step 4: Suite grün (nichts gebrochen)**

Run: `python3 -m pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: scenes/ -> overlays/ (Produktions-Overlays korrekt benannt)"
```

---

## Task 6: Server-seitiger Clip-Abruf (`webcore.twitch_client.get_clips` + `bp_twitch`)

Twitch-OAuth + Clip-Fetch wandern auf den Server; das Client-Secret verlässt nie den Browser. Endpoint nutzt tenant-eigene Creds.

**Files:**
- Modify: `webcore/twitch_client.py` (neue `get_clips`)
- Create: `webcore/views_twitch.py`
- Test: `tests/webcore/test_twitch_clips.py`

- [ ] **Step 1: Failing test für `get_clips` (Twitch-HTTP gemockt)**

```python
# tests/webcore/test_twitch_clips.py
from unittest import mock
from webcore import twitch_client


def _resp(json_body, status=200):
    m = mock.Mock()
    m.status_code = status
    m.json.return_value = json_body
    m.raise_for_status.return_value = None
    return m


def test_get_clips_maps_fields():
    seq = [
        _resp({"access_token": "AT"}),                       # oauth token
        _resp({"data": [{"id": "B1"}]}),                     # users?login
        _resp({"data": [{                                    # clips
            "id": "ClipA", "title": "Nice", "duration": 28.5,
            "created_at": "2026-05-01T00:00:00Z",
            "view_count": 42, "creator_name": "Bob"}]}),
    ]
    with mock.patch("webcore.twitch_client.requests.post", return_value=seq[0]), \
         mock.patch("webcore.twitch_client.requests.get", side_effect=seq[1:]):
        clips = twitch_client.get_clips("cid", "csecret", "luckor", count=10)
    assert clips == [{
        "id": "ClipA", "title": "Nice", "duration": 28.5,
        "createdAt": "2026-05-01T00:00:00Z", "views": 42, "creator": "Bob"}]


def test_get_clips_unknown_channel_returns_empty():
    with mock.patch("webcore.twitch_client.requests.post",
                    return_value=_resp({"access_token": "AT"})), \
         mock.patch("webcore.twitch_client.requests.get",
                    return_value=_resp({"data": []})):
        assert twitch_client.get_clips("cid", "csecret", "ghost", count=10) == []
```

- [ ] **Step 2: Test schlägt fehl**

Run: `python3 -m pytest tests/webcore/test_twitch_clips.py -v`
Expected: FAIL — `get_clips` existiert nicht.

- [ ] **Step 3: `get_clips` in `webcore/twitch_client.py` implementieren**

Am Dateiende anfügen (oben sollte `import requests` bereits vorhanden sein — sonst ergänzen). Metrik-Wrapper `observe_external` aus `webcore.metrics` nutzen:

```python
TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
TWITCH_HELIX = "https://api.twitch.tv/helix"


def get_clips(client_id: str, client_secret: str, channel: str,
              count: int = 100) -> list:
    """App-Token holen, Channel -> broadcaster_id, Clips laden.

    Returns Liste von {id,title,duration,createdAt,views,creator}.
    Leere Liste wenn Channel unbekannt oder keine Clips.
    """
    from webcore.metrics import observe_external

    count = max(1, min(int(count or 100), 100))
    with observe_external("twitch", "oauth_token") as obs:
        tr = requests.post(TWITCH_TOKEN_URL, data={
            "client_id": client_id, "client_secret": client_secret,
            "grant_type": "client_credentials"}, timeout=10)
        obs.set_status(tr.status_code)
    token = (tr.json() or {}).get("access_token")
    if not token:
        return []
    headers = {"Client-ID": client_id, "Authorization": f"Bearer {token}"}

    with observe_external("twitch", "users") as obs:
        ur = requests.get(f"{TWITCH_HELIX}/users",
                          params={"login": channel}, headers=headers, timeout=10)
        obs.set_status(ur.status_code)
    udata = (ur.json() or {}).get("data") or []
    if not udata:
        return []
    broadcaster_id = udata[0]["id"]

    with observe_external("twitch", "clips") as obs:
        cr = requests.get(f"{TWITCH_HELIX}/clips",
                          params={"broadcaster_id": broadcaster_id,
                                  "first": count},
                          headers=headers, timeout=10)
        obs.set_status(cr.status_code)
    cdata = (cr.json() or {}).get("data") or []
    return [{
        "id": c.get("id"),
        "title": c.get("title") or "",
        "duration": c.get("duration") or 30,
        "createdAt": c.get("created_at") or "",
        "views": c.get("view_count") or 0,
        "creator": c.get("creator_name") or "",
    } for c in cdata]
```

- [ ] **Step 4: `get_clips`-Test grün**

Run: `python3 -m pytest tests/webcore/test_twitch_clips.py -v`
Expected: PASS.

- [ ] **Step 5: Failing test für den Blueprint-Endpoint**

```python
# am Ende von tests/webcore/test_twitch_clips.py anfügen
from unittest import mock as _mock
from flask import Flask, g
from webcore.views_twitch import bp_twitch


class _Creds:
    twitch_client_id = "cid"
    twitch_client_secret = "csecret"
    twitch_channel = "luckor"


def _twitch_app(tenant_id=7):
    app = Flask(__name__)
    app.register_blueprint(bp_twitch)

    @app.before_request
    def _ctx():
        g.tenant_id = tenant_id
    return app


def test_clips_endpoint_returns_json():
    app = _twitch_app()
    with _mock.patch("webcore.views_twitch._tenant_creds", return_value=_Creds()), \
         _mock.patch("webcore.views_twitch.twitch_client.get_clips",
                     return_value=[{"id": "A", "title": "t", "duration": 30,
                                    "createdAt": "", "views": 0, "creator": ""}]):
        r = app.test_client().get("/s/tok123/api/twitch/clips?count=5")
    assert r.status_code == 200
    assert r.get_json()["clips"][0]["id"] == "A"


def test_clips_endpoint_404_without_tenant():
    app = _twitch_app(tenant_id=None)
    r = app.test_client().get("/s/tok123/api/twitch/clips")
    assert r.status_code == 404
```

- [ ] **Step 6: Test schlägt fehl**

Run: `python3 -m pytest tests/webcore/test_twitch_clips.py -v`
Expected: FAIL — `webcore.views_twitch` existiert nicht.

- [ ] **Step 7: `webcore/views_twitch.py` implementieren**

```python
"""Geteilter Twitch-Endpoint: server-seitiger Clip-Abruf.

/s/<token>/api/twitch/clips — nutzt tenant-eigene Twitch-App-Credentials,
Client-Secret bleibt am Server. Wird vom Overlay-Service registriert.
"""
from flask import Blueprint, g, jsonify, abort, request, current_app

from webcore import twitch_client
from webcore.middleware import _get_conn


bp_twitch = Blueprint("twitch", __name__)


def _tenant_creds(tenant_id: int):
    from core import credentials as core_creds
    conn = _get_conn()
    try:
        return core_creds.get(conn, tenant_id)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()


@bp_twitch.route("/s/<token>/api/twitch/clips")
def clips(token):
    if g.tenant_id is None:
        abort(404)
    creds = _tenant_creds(g.tenant_id)
    if not (creds.twitch_client_id and creds.twitch_client_secret
            and creds.twitch_channel):
        return jsonify({"clips": []})
    count = request.args.get("count", type=int) or 100
    data = twitch_client.get_clips(
        creds.twitch_client_id, creds.twitch_client_secret,
        creds.twitch_channel, count=count)
    return jsonify({"clips": data})
```

- [ ] **Step 8: Alle Twitch-Tests grün**

Run: `python3 -m pytest tests/webcore/test_twitch_clips.py -v`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(webcore): server-seitiger Twitch-Clip-Endpoint (kein Secret im Browser)"
```

---

## Task 7: `overlay_app` — Factory + Overlay/Asset-Serving

Die neue dünne App: Middleware/Metrics aus `webcore`, kein OAuth, Login-Redirect auf Haupt-Domain, tokenisiertes Overlay-Serving mit Tenant-Channel-Injection plus `assets/` + `js/` unter `/s/<token>/`.

**Files:**
- Create: `overlay_app/__init__.py`, `overlay_app/overlay_catalog.py`, `overlay_app/views_overlays.py`
- Test: `tests/overlay_app/__init__.py`, `tests/overlay_app/conftest.py`, `tests/overlay_app/test_serving.py`

- [ ] **Step 1: `overlay_catalog.py` anlegen**

```python
"""Single Source of Truth fuer die Produktions-Overlays."""

OVERLAYS = [
    {"key": "starting-soon",  "label": "Starting Soon",  "file": "starting-soon.html",
     "size": "1920×1080", "params": ["title", "countdown"]},
    {"key": "brb-pause",      "label": "BRB / Pause",     "file": "brb-pause.html",
     "size": "1920×1080", "params": ["count", "countdown", "clips"]},
    {"key": "stream-ending",  "label": "Stream Ending",   "file": "stream-ending.html",
     "size": "1920×1080", "params": ["title"]},
    {"key": "just-chatting",  "label": "Just Chatting",   "file": "just-chatting.html",
     "size": "1920×1080", "params": []},
    {"key": "gameplay",       "label": "Gameplay / Kamera", "file": "gameplay.html",
     "size": "400×225", "params": []},
]
```

- [ ] **Step 2: Failing test für Overlay-Serving + Login-Redirect**

```python
# tests/overlay_app/conftest.py
import os, sys
import pytest
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from overlay_app import create_app


@pytest.fixture
def client():
    app = create_app(testing=True)
    # Token-Resolution + Creds mocken statt echter DB:
    return app
```

```python
# tests/overlay_app/test_serving.py
from unittest import mock
from flask import g


def _client_with_tenant(app, tenant_id=7):
    @app.before_request
    def _force_tenant():
        # Middleware-Tokenpfad ueberschreiben: Tenant direkt setzen
        if g.tenant_id is None:
            g.tenant_id = tenant_id
    return app.test_client()


class _Creds:
    twitch_channel = "luckor"
    twitch_client_id = "cid"


def test_overlay_html_injects_channel(client):
    c = _client_with_tenant(client)
    with mock.patch("overlay_app.views_overlays._tenant_creds",
                    return_value=_Creds()):
        r = c.get("/s/tok/overlays/starting-soon.html")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert 'window.__TWITCH_CHANNEL__ = "luckor";' in body
    assert 'window.__SERVE_BASE__ = "/s/tok/";' in body
    assert 'window.__TWITCH_CLIENT_ID__ = "cid";' in body


def test_overlay_asset_served(client):
    c = _client_with_tenant(client)
    r = c.get("/s/tok/assets/DM-Sans.woff2")
    assert r.status_code == 200


def test_dashboard_redirects_to_main_login_without_session(client):
    # kein Tenant, keine Session -> require_session redirect auf Haupt-Domain
    r = client.test_client().get("/")
    assert r.status_code == 302
    assert r.headers["Location"].startswith("https://stats-overlay.info/app/login")
```

- [ ] **Step 3: Test schlägt fehl**

Run: `python3 -m pytest tests/overlay_app/ -v`
Expected: FAIL — `overlay_app` existiert nicht.

- [ ] **Step 4: `overlay_app/views_overlays.py` implementieren**

```python
"""Overlay- und Asset-Serving unter /s/<token>/ fuer den Overlay-Service."""
import os
from flask import Blueprint, g, abort, current_app

from webcore.serving import serve_html_or_asset, serve_asset
from webcore.middleware import _get_conn


bp_overlays = Blueprint("overlays", __name__)


def _root() -> str:
    return current_app.config.get("_PROJECT_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))


def _tenant_creds(tenant_id: int):
    from core import credentials as core_creds
    conn = _get_conn()
    try:
        return core_creds.get(conn, tenant_id)
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()


@bp_overlays.route("/s/<token>/overlays/<path:filepath>")
def overlay_file(token, filepath):
    if g.tenant_id is None:
        abort(404)
    creds = _tenant_creds(g.tenant_id)
    variables = {
        "__SERVE_BASE__": f"/s/{token}/",
        "__STATIC_BASE__": f"/s/{token}/",
        "__TWITCH_CHANNEL__": creds.twitch_channel or "",
        "__TWITCH_CLIENT_ID__": creds.twitch_client_id or "",
    }
    return serve_html_or_asset(_root(), "overlays", filepath, variables)


# Relative ../assets/ und ../js/ aus den Overlay-HTMLs token-scoped bedienen.
@bp_overlays.route("/s/<token>/assets/<path:filepath>")
def overlay_assets(token, filepath):
    if g.tenant_id is None:
        abort(404)
    return serve_asset(_root(), "assets", filepath)


@bp_overlays.route("/s/<token>/js/<path:filepath>")
def overlay_js(token, filepath):
    if g.tenant_id is None:
        abort(404)
    return serve_asset(_root(), "js", filepath)
```

- [ ] **Step 5: `overlay_app/__init__.py` implementieren**

```python
"""obs-stream-kit Overlay-Service (Service 2) App-Factory."""
import os
from flask import Flask, jsonify, g, render_template
from werkzeug.middleware.proxy_fix import ProxyFix

from webcore.config import Config, TestingConfig
from webcore.middleware import register_middleware
from webcore.metrics import register_metrics
from webcore.views_twitch import bp_twitch
from overlay_app.views_overlays import bp_overlays


def create_app(testing: bool = False) -> Flask:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.from_object(TestingConfig if testing else Config)
    app.config["_PROJECT_ROOT"] = project_root

    # Login/Pending zeigen auf die Haupt-Domain (Overlay-Service hat kein OAuth).
    app.config["LOGIN_URL"] = (
        os.environ.get("OBS_KIT_MAIN_LOGIN_URL")
        or "https://stats-overlay.info/app/login")
    app.config["PENDING_URL"] = (
        os.environ.get("OBS_KIT_MAIN_PENDING_URL")
        or "https://stats-overlay.info/app/pending")

    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_for=1)

    register_middleware(app)
    register_metrics(app)
    app.register_blueprint(bp_overlays)
    app.register_blueprint(bp_twitch)

    from overlay_app.views_dashboard import bp_dashboard
    app.register_blueprint(bp_dashboard)

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app
```

> Hinweis: `bp_dashboard` kommt in Task 8 — dieser Import bleibt bis dahin auskommentiert oder Task 8 wird direkt mit angeschlossen. Für Step 6 (Serving-Tests) genügt das Auskommentieren der zwei `bp_dashboard`-Zeilen; der Redirect-Test `test_dashboard_redirects...` wird dann erst nach Task 8 grün — bis dahin als `xfail` markieren oder Task 8 zuerst ziehen.

- [ ] **Step 6: Serving-Tests grün**

Run: `python3 -m pytest tests/overlay_app/test_serving.py::test_overlay_html_injects_channel tests/overlay_app/test_serving.py::test_overlay_asset_served -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(overlay_app): Factory + tokenisiertes Overlay/Asset-Serving mit Channel-Injection"
```

---

## Task 8: Overlay-Mini-Dashboard (hinter Login)

`/` listet die Overlays des eingeloggten Tenants mit tokenisierten URLs. Spiegelt das `/app/urls`-Muster, schlankes eigenes Layout.

**Files:**
- Create: `overlay_app/views_dashboard.py`, `overlay_app/templates/base.html`, `overlay_app/templates/overlay_dashboard.html`, `overlay_app/static/overlay.css`
- Test: `tests/overlay_app/test_dashboard.py`

- [ ] **Step 1: Failing test**

```python
# tests/overlay_app/test_dashboard.py
from unittest import mock


def test_dashboard_redirects_without_session(client):
    r = client.test_client().get("/")
    assert r.status_code == 302
    assert r.headers["Location"].startswith("https://stats-overlay.info/app/login")


def test_dashboard_lists_overlays_when_logged_in(client):
    app = client
    fake_user = {"id": 1, "is_admin": False, "is_approved": True,
                 "display_name": "LuCKoR"}

    @app.before_request
    def _login():
        from flask import g
        g.user = fake_user
        g.tenant_id = 7

    with mock.patch("overlay_app.views_dashboard._tenant_token",
                    return_value="tok123"):
        r = app.test_client().get("/")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert "Starting Soon" in body
    assert "/s/tok123/overlays/starting-soon.html" in body
```

- [ ] **Step 2: Test schlägt fehl**

Run: `python3 -m pytest tests/overlay_app/test_dashboard.py -v`
Expected: FAIL — `bp_dashboard`/`_tenant_token` fehlt.

- [ ] **Step 3: `overlay_app/views_dashboard.py` implementieren**

```python
"""Overlay-Mini-Dashboard: tokenisierte URLs der Produktions-Overlays."""
from flask import Blueprint, render_template, g, request, current_app

from webcore.middleware import require_session, _get_conn
from overlay_app.overlay_catalog import OVERLAYS


bp_dashboard = Blueprint("overlay_dashboard", __name__)


def _tenant_token(tenant_id: int):
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT token FROM widget_tokens
                WHERE tenant_id = %s AND revoked_at IS NULL
                ORDER BY created_at LIMIT 1
            """, (tenant_id,))
            row = cur.fetchone()
        return row["token"] if row else None
    finally:
        if "_PG_CONN_FACTORY" not in current_app.config:
            conn.close()


@bp_dashboard.route("/")
@require_session
def dashboard():
    token = _tenant_token(g.tenant_id) if g.tenant_id else None
    base_url = request.url_root.rstrip("/")
    return render_template("overlay_dashboard.html",
                           overlays=OVERLAYS, token=token,
                           base_url=base_url, user=g.user)
```

> Prüfe die `widget_tokens`-Spaltennamen gegen `core/schema.sql` (`created_at` existiert dort). Falls die Spalte anders heißt, das `ORDER BY` anpassen.

- [ ] **Step 4: `overlay_app/__init__.py` — `bp_dashboard`-Import aktivieren**

Falls in Task 7 auskommentiert: die zwei Zeilen
```python
    from overlay_app.views_dashboard import bp_dashboard
    app.register_blueprint(bp_dashboard)
```
einkommentieren.

- [ ] **Step 5: Templates + CSS anlegen (WCAG 2.2 AA)**

```html
<!-- overlay_app/templates/base.html -->
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{% block title %}Overlays{% endblock %} — stats-overlay.info</title>
  <link rel="stylesheet" href="{{ url_for('static', filename='overlay.css') }}">
</head>
<body>
  <a class="skip-link" href="#main">Zum Inhalt springen</a>
  <header role="banner" class="topnav">
    <span class="brand">stats-overlay.info · Overlays</span>
    <a class="nav-link" href="https://stats-overlay.info/app/">Stats-Dashboard</a>
  </header>
  <main id="main" tabindex="-1">{% block body %}{% endblock %}</main>
</body>
</html>
```

```html
<!-- overlay_app/templates/overlay_dashboard.html -->
{% extends "base.html" %}
{% block title %}Overlay-URLs{% endblock %}
{% block body %}
<h1>Deine Overlay-Browser-Sources</h1>
{% if not token %}
  <p class="warn" role="alert">Noch kein Token vergeben — der Admin muss deinen
  Tenant erst freischalten.</p>
{% else %}
<p class="hint">Token: <code>{{ token }}</code> — kopiere eine URL als OBS
Browser-Source.</p>
<ul class="overlay-grid">
  {% for o in overlays %}
  <li class="overlay-card">
    <h2>{{ o.label }}</h2>
    <p class="size">{{ o.size }}</p>
    <label for="url-{{ o.key }}">OBS-URL</label>
    <input id="url-{{ o.key }}" class="url-field" type="text" readonly
           value="{{ base_url }}/s/{{ token }}/overlays/{{ o.file }}">
    {% if o.params %}
    <p class="params">Parameter:
      {% for p in o.params %}<code>{{ p }}</code>{% if not loop.last %}, {% endif %}{% endfor %}
    </p>
    {% endif %}
  </li>
  {% endfor %}
</ul>
{% endif %}
{% endblock %}
```

```css
/* overlay_app/static/overlay.css — schlank, Dark-Theme, WCAG-AA */
:root { --bg:#1a1320; --card:#2a1f33; --gold:#f2b705; --text:#f4eef8; --dim:#b9a9c6; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text);
  font-family:'DM Sans', system-ui, sans-serif; }
.skip-link { position:absolute; left:-999px; }
.skip-link:focus { left:8px; top:8px; background:var(--gold); color:#000;
  padding:8px 12px; z-index:10; }
.topnav { display:flex; gap:16px; align-items:center; justify-content:space-between;
  padding:14px 20px; background:var(--card); }
.brand { font-weight:600; }
.nav-link, .url-field { color:var(--text); }
a { color:var(--gold); }
a:focus-visible, .url-field:focus-visible, input:focus-visible {
  outline:3px solid var(--gold); outline-offset:2px; }
main { padding:24px 20px; max-width:1100px; margin:0 auto; }
h1 { color:var(--gold); }
.overlay-grid { list-style:none; padding:0; display:grid;
  grid-template-columns:repeat(auto-fill, minmax(320px,1fr)); gap:16px; }
.overlay-card { background:var(--card); border-radius:12px; padding:16px; }
.overlay-card h2 { margin:0 0 4px; font-size:1.1rem; }
.size { color:var(--dim); margin:0 0 12px; font-size:.85rem; }
label { display:block; font-size:.8rem; color:var(--dim); margin-bottom:4px; }
.url-field { width:100%; min-height:40px; padding:8px 10px; border-radius:8px;
  border:1px solid #4a3a58; background:#16101d; color:var(--text);
  font-family:monospace; font-size:.8rem; }
.params { color:var(--dim); font-size:.8rem; margin-top:10px; }
.warn { color:var(--gold); }
code { background:#16101d; padding:2px 6px; border-radius:4px; }
```

- [ ] **Step 6: Dashboard-Tests grün**

Run: `python3 -m pytest tests/overlay_app/ -q`
Expected: PASS (inkl. Redirect-Test aus Task 7).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(overlay_app): Login-geschuetztes Overlay-Mini-Dashboard"
```

---

## Task 9: Frontend — Clip-Player auf Server-Endpoint umstellen

Client-seitiges OAuth + Client-Secret raus, einzelner Fetch auf `/s/<token>/api/twitch/clips`.

**Files:**
- Modify: `js/clip-player.js`
- Modify: `overlays/brb-pause.html` (falls inline-Variante denselben Block enthält)

- [ ] **Step 1: `js/clip-player.js` — API-Modus ersetzen**

Ersetze ab `// API Modus` (der `if (!clientId || !clientSecret)`-Block samt komplettem `fetch('https://id.twitch.tv/oauth2/token', …)`-Kette) durch einen einzigen Server-Fetch:

```javascript
    // API Modus — Clips kommen server-seitig (kein Secret im Browser).
    var serveBase = window.__SERVE_BASE__ || '/';
    var url = serveBase.replace(/\/+$/, '/') + 'api/twitch/clips?count=' + clipCount;
    fetch(url, { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var list = (data && data.clips) || [];
        if (!list.length) throw new Error('Keine Clips gefunden');
        startPlayer(list);
      })
      .catch(function (err) {
        console.error('ClipPlayer:', err);
        showError(err.message || 'API-Fehler');
      });
```

Außerdem die nicht mehr genutzten `clientId`/`clientSecret`-Zeilen (var-Deklarationen) entfernen und den hartkodierten `|| 'LuCKoR_HD'`-Default auf `|| window.__TWITCH_CHANNEL__ || ''` ändern (Repo bleibt generisch).

- [ ] **Step 2: `overlays/brb-pause.html` — denselben Block prüfen/ersetzen**

`brb-pause.html` enthält eine inline-Variante (Zeilen ~636 ff. mit `clientSecret`). Falls sie nicht `js/clip-player.js` nutzt, denselben Server-Fetch wie in Step 1 einsetzen und `clientSecret` entfernen.

Run: `grep -n "clientSecret\|client_secret\|oauth2/token" overlays/brb-pause.html`
Expected nach der Änderung: keine Treffer.

- [ ] **Step 3: JS-Syntax-Check**

Run: `node --check js/clip-player.js`
Expected: kein Fehler (exit 0).

- [ ] **Step 4: Manueller Smoke-Test (dokumentieren)**

Lokal Service 2 starten (Task 10) und `…/s/<token>/overlays/brb-pause.html` in einem Browser öffnen; DevTools-Network zeigt **einen** Request auf `api/twitch/clips`, **kein** `oauth2/token`, kein Secret im Quelltext.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(overlays): BRB-Clip-Player nutzt server-seitigen Endpoint (kein Secret im Browser)"
```

---

## Task 10: `serve_overlays.py` — Entry-Point Service 2

**Files:**
- Create: `serve_overlays.py`
- Test: `tests/overlay_app/test_factory.py`

- [ ] **Step 1: Failing test**

```python
# tests/overlay_app/test_factory.py
from overlay_app import create_app


def test_factory_builds_app():
    app = create_app(testing=True)
    assert app is not None


def test_healthz_ok():
    app = create_app(testing=True)
    r = app.test_client().get("/healthz")
    assert r.status_code == 200
    assert r.get_json()["status"] == "ok"
```

- [ ] **Step 2: Test schlägt fehl/grün prüfen**

Run: `python3 -m pytest tests/overlay_app/test_factory.py -v`
Expected: PASS (Factory existiert seit Task 7; dieser Test sichert den Entry-Point-Vertrag ab).

- [ ] **Step 3: `serve_overlays.py` implementieren**

```python
#!/usr/bin/env python3
"""obs-stream-kit Overlay-Service (Service 2) Entry-Point.

systemd: /usr/bin/python3 /opt/obs-stream-kit/serve_overlays.py 9001
"""
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 9001
HOST = "0.0.0.0"

from overlay_app import create_app

app = create_app()

if __name__ == "__main__":
    print(f"obs-stream-kit overlays serving on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False)
```

> Wichtig: **keine** Poller hier (`start_pollers` bleibt allein in `serve.py`/Service 1) — der Overlay-Service ist read-only und teilt sich dieselbe DB.

- [ ] **Step 4: Smoke — App importiert + Healthz**

Run: `python3 -c "import serve_overlays; print('ok')"`
Expected: `ok` (kein ImportError).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: serve_overlays.py — Entry-Point fuer Overlay-Service (:9001)"
```

---

## Task 11: Deployment — systemd + nginx + DNS + README

Reine Ops-/Doku-Artefakte. Keine Python-Tests; verifiziert auf dem Prod-Server (`root@31.70.95.217`, `/opt/obs-stream-kit`, `~/.ssh/obskit`).

**Files:**
- Create: `docs/overlays-systemd.service.example`, `docs/overlays-nginx.conf.example`
- Modify: `README.md`

- [ ] **Step 1: systemd-Unit-Vorlage**

```ini
# docs/overlays-systemd.service.example
# Aktivieren auf dem Server:
#   cp docs/overlays-systemd.service.example /etc/systemd/system/obs-overlays.service
#   systemctl daemon-reload && systemctl enable --now obs-overlays.service
[Unit]
Description=obs-stream-kit Overlay-Service (Service 2)
After=network-online.target

[Service]
Type=simple
User=obskit
WorkingDirectory=/opt/obs-stream-kit
EnvironmentFile=/etc/obs-stream-kit.env
ExecStart=/usr/bin/python3 /opt/obs-stream-kit/serve_overlays.py 9001
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Env-Datei ergänzen (auf dem Server, dokumentieren)**

In `/etc/obs-stream-kit.env` (von beiden Services geladen) ergänzen — damit das Login-Cookie cross-subdomain gilt:

```
OBS_KIT_COOKIE_DOMAIN=.stats-overlay.info
```

(Optional, falls abweichend: `OBS_KIT_MAIN_LOGIN_URL`, `OBS_KIT_MAIN_PENDING_URL`.)

- [ ] **Step 3: nginx-Server-Block-Vorlage**

```nginx
# docs/overlays-nginx.conf.example
server {
    listen 443 ssl http2;
    server_name overlays.stats-overlay.info;

    ssl_certificate     /etc/letsencrypt/live/stats-overlay.info/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stats-overlay.info/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:9001;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Forwarded-For   $remote_addr;
        proxy_set_header   X-Forwarded-Host  $host;
    }
}
```

- [ ] **Step 4: DNS + TLS (Ops-Schritte, dokumentieren)**

- DNS: A/AAAA-Record `overlays.stats-overlay.info` → `31.70.95.217`.
- TLS: Zertifikat um die Subdomain erweitern, z.B.
  `certbot --expand -d stats-overlay.info -d overlays.stats-overlay.info`
  (oder Wildcard). nginx reload.

- [ ] **Step 5: README — Overlay-Service-Abschnitt**

Unter der Architektur-/Deployment-Sektion ergänzen: zwei Services, Subdomain `overlays.…`, Entry-Point `serve_overlays.py`, systemd-Unit `obs-overlays.service`, dass das Login über die Haupt-Domain läuft und das Cookie via `OBS_KIT_COOKIE_DOMAIN` cross-subdomain gilt. (Memory-Regel: README bei neuen Features mit aktualisieren.)

- [ ] **Step 6: deploy.sh um Overlay-Service-Restart erweitern (falls genutzt)**

`scripts/deploy.sh` ist veraltet (zeigt auf `king-edition.de`/alte IP). Falls weiter verwendet: den `systemctl restart obs-stream-kit`-Schritt um `obs-overlays` erweitern:
```bash
ssh -i "$SSH_KEY" "$SERVER" "systemctl restart obs-stream-kit obs-overlays && systemctl status obs-overlays --no-pager -l | head -20"
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs(deploy): Overlay-Service systemd + nginx + DNS/TLS + README"
```

---

## Self-Review

**Spec-Coverage:**
- Zwei echte Prozesse + Subdomain → Tasks 7, 10, 11 ✓
- `webcore/`-Extraktion, verhaltensneutral → Task 1 (Suite als Netz) ✓
- Token-Reuse `widget_tokens` → Tasks 7, 8 (Middleware unverändert) ✓
- Channel-Injection pro Tenant → Task 7 ✓
- Cross-Subdomain-Cookie → Task 4 ✓
- Konfigurierbare LOGIN_URL, kein OAuth in Service 2 → Tasks 3, 7 ✓
- Server-seitiger Clip-Endpoint, kein Secret im Browser → Tasks 6, 9 ✓
- `scenes/ → overlays/` Rename → Task 5 ✓
- Mini-Dashboard → Task 8 ✓
- Tests (webcore, overlay_app) → Tasks 2–8, 10 ✓
- Deployment → Task 11 ✓

**Abweichung dokumentiert:** Clip-Endpoint in `webcore` + Registrierung in `overlay_app` (same-origin) statt in Service 1 — siehe Kopf des Plans.

**Type-/Namens-Konsistenz:** `inject_window_vars`, `serve_html_or_asset`, `serve_asset`, `get_clips`, `bp_twitch`, `bp_overlays`, `bp_dashboard`, `_tenant_creds`, `_tenant_token` durchgängig identisch verwendet. Clip-Dict-Felder (`id,title,duration,createdAt,views,creator`) in `get_clips`, Test und Frontend-`startPlayer` deckungsgleich.

**Offene Verifikationspunkte für den Implementierer (im Plan markiert):**
- `widget_tokens`-Spaltenname `created_at` gegen `core/schema.sql` prüfen (Task 8).
- DB-Fixture-Setup für `tests/webcore/test_cookie_domain.py` an `tests/app/test_oauth.py` orientieren (Task 4).
- Reihenfolge Task 7/8: `bp_dashboard`-Import erst aktiv, wenn `views_dashboard.py` existiert.
