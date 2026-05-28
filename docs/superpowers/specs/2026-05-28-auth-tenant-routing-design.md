# Spec 2 — Auth + Tenant-Routing

**Datum:** 2026-05-28
**Status:** Draft — wartet auf User-Review
**Vorheriger Spec:** `docs/superpowers/specs/2026-05-28-postgres-tenant-foundation-design.md` (PG + Tenant-Schema)
**Folge-Specs:** Spec 3 (Streamer-Dashboard ausgebaut + Widget-Konfig), Spec 4 (Admin-Dashboard ausgebaut)

## Ziel

obs-stream-kit hat nach Spec 1 ein Multi-Tenant-Schema, aber noch keinen Login-Mechanismus. Alle Endpoints lesen hardcoded `tenant_id = 1`. Spec 2 baut die Auth-Schicht:

- HTTP-Server-Umbau von stdlib `http.server` auf **Flask**.
- **Twitch OAuth** Login-Flow für Streamer.
- **URL-Token-Routing** `/s/<token>/...` für OBS-Browser-Sources (cookieless).
- **Session-Cookies** für Dashboard (`/app/`) und Admin-Bereich (`/admin/`).
- **Approval-Queue**: jeder Twitch-Login darf sich registrieren, aber Admin gibt frei.
- **Minimaler Dashboard-Shell**: Login, Approval-Queue, Settings-Page für API-Keys.

Spec 2 baut **keinen** ausgebauten Dashboard-Content (Match-History, Status-Cards) und **keine** Widget-Konfiguration via UI — beides ist Spec 3. Spec 2 liefert nur das Skelett.

Nach Spec 2 läuft das System multi-user-fähig: ein neuer Streamer kann sich registrieren, vom Admin freigeschaltet werden, seine API-Keys eintragen und kriegt OBS-Widget-URLs mit eigenem Token — alle mit korrektem Tenant-Scoping.

## Out of Scope (Spec 3 / 4 / später)

- **Dashboard-Inhalt** (Match-History, Stats-Cards, System-Status-Panel) → Spec 3.
- **Per-Widget Konfiguration via Dashboard** (Filter, Range, Sort etc. statt URL-Query-Params) → Spec 3.
- **OBS-URLs-Seite mit Widget-Beschreibungen + Vorschau** → Spec 3.
- **Token-Rotation-Button**, Multiple-Token-Management → Spec 3.
- **Admin-Bulk-Actions, Audit-Log, Tenant-Suspendierung** → Spec 4.
- **POI-Editor-UI-Polish** → Spec 4 (das aktuelle POI-Tool bleibt admin-only-erreichbar wie bisher).
- **POI-Schema mit Polygon-Support** (siehe Followup-Doku aus Spec 1).
- **2FA, Email-Verifikation, Passwort-Login** — Twitch OAuth ist der einzige Login-Pfad.
- **TeamSpeak/Scenes-Migration** in eigene Repos (unabhängiger Parallel-Track).

## Architektur-Überblick

```
                ┌─────────────────────────────────────────────────┐
                │  nginx 443 (SSL, BASIC-AUTH ENTFERNT)           │
                └────────────────────────┬────────────────────────┘
                                         ▼
                ┌─────────────────────────────────────────────────┐
                │  Flask App (serve.py rewrite, Port 9000)        │
                │                                                 │
                │  Routes:                                        │
                │  /                   → Landing (Logo + Login)   │
                │  /app/login          → Twitch OAuth start       │
                │  /app/oauth/callback → Token-Tausch + Session   │
                │  /app/logout         → Cookie clear             │
                │  /app/               → Shell (skeleton in S2)   │
                │  /app/settings       → API-Keys-Form            │
                │  /admin/             → Shell (skeleton in S2)   │
                │  /admin/users        → Approval-Queue           │
                │  /s/<token>/widgets/...  Public widget-HTML/JS  │
                │  /s/<token>/api/...      Token-scoped JSON-API  │
                │  /api/...                Cookie-scoped API      │
                │                          (für /app/-Dashboard)  │
                │                                                 │
                │  Middleware:                                    │
                │  ├─ resolve_tenant_from_token (für /s/<t>/…)    │
                │  ├─ require_session (für /app/, /api/)          │
                │  ├─ require_admin (für /admin/)                 │
                │  └─ require_approved (alle Nicht-Login-Routen)  │
                └────────┬────────────────────────────────────────┘
                         ▼
            ┌────────────────────────────────────────────┐
            │  PostgreSQL                                │
            │  ├─ users (+ is_approved + twitch_avatar)  │
            │  ├─ user_sessions (server-side)            │
            │  ├─ tenants                                │
            │  ├─ tenant_credentials                     │
            │  ├─ widget_tokens (1 default per tenant)   │
            │  └─ <bestehende Domain-Tabellen>           │
            └────────────────────────────────────────────┘
```

**Tenant-Resolution Middleware** läuft `before_request`:
- Pfad startet mit `/s/<token>/…` → Lookup `widget_tokens WHERE token = ? AND revoked_at IS NULL` → setzt `g.tenant_id`. Bei Miss: 404.
- Pfad in `/app/`, `/api/`, `/admin/` → Session-Cookie → `user_sessions` → `users` → `g.user`, `g.tenant_id` (= owned tenant). Bei Miss: 302 → `/app/login`.
- Pfad `/`, `/app/login`, `/app/oauth/callback`, statische Login-Assets → kein Tenant-Check.

Domain-Code (`pubg/endpoints.py`, `steam/endpoints.py`, `pubg/aggregations.py`) wird tenant-agnostisch gemacht: die `HARDCODED_TENANT_ID = 1` Konstante wird ersetzt durch `flask.g.tenant_id`.

## Komponenten

### 1. HTTP-Framework-Umbau: stdlib → Flask

**Status quo:** `serve.py` ist ~960 LOC mit `BaseHTTPRequestHandler`-Subclass, eigenem Routing-Dispatch, eigener Static-File-Auslieferung, eigenem Logger-Pretty-Print.

**Target:** Flask-App mit:
- `app.route()` für Routes
- `send_from_directory()` für statische Files (widgets/, assets/, etc.)
- `before_request` für Auth-Middleware
- `session` (Flask-built-in signed cookie) für `/app/`
- Custom Request-Logger als WSGI-Middleware (behält das ANSI-Farben-Format aus dem aktuellen `serve.py`)

**File-Aufteilung:**
- `serve.py` bleibt Entry-Point, aber wird kleiner: nur App-Construction + main-Block.
- Neues Package `app/` für Flask-Routes/Views:
  - `app/__init__.py` — `create_app()` Factory.
  - `app/auth.py` — OAuth-Flow, Session-Management, `/app/login`, `/app/oauth/callback`, `/app/logout`.
  - `app/middleware.py` — `before_request`-Handler, Helper für Tenant-Resolution.
  - `app/views_app.py` — Streamer-Routes (`/app/...`, Dashboard-Shell, Settings).
  - `app/views_admin.py` — Admin-Routes (`/admin/...`, Approval-Queue).
  - `app/views_widgets.py` — `/s/<token>/widgets/<path>` Handler, `/s/<token>/api/<path>` Proxy.
  - `app/views_api.py` — `/api/...` Routes (existierende Endpoints, registriert via Adapter).
  - `app/templates/` — Jinja2 HTML (Landing, Login, Dashboard-Shell, Approval-Queue, Settings).
  - `app/static/` — Dashboard-CSS/JS (separate vom `widgets/`-Tree).

**Adapter zu bestehenden Endpoint-Klassen:** `pubg/endpoints.py:EndpointRegistry` und `steam/endpoints.py:SteamEndpointRegistry` haben bereits eine clean abstraction (Conn-Factory, Cache). Sie werden in `app/views_api.py` instanziiert und ihre Handler werden als Flask-Routes registriert. Die `HARDCODED_TENANT_ID`-Konstante wird durch Lookup auf `flask.g.tenant_id` ersetzt.

**Streamer.bot-Kompatibilität:** Streamer.bot ruft heute `/api/pubg/*` ohne Basic-Auth (oder mit hardcoded `.htpasswd`-Header). Nach Spec 2 brauchen diese Routes entweder Session-Cookie ODER URL-Token. Da Streamer.bot nicht logged-in ist, **muss es URL-Token nutzen** — d.h. seine Polls gehen an `/s/<token>/api/pubg/last-match` statt `/api/pubg/last-match`. Streamer.bot-Konfig wird einmalig umgestellt. (Dokumentiert in der Migration-Notes.)

### 2. Twitch OAuth Login-Flow

**Dependencies:** `authlib` (PyPI, `pip install authlib`) — saubere OAuth2-Client-Lib.

**Twitch-App-Credentials:** stehen schon in `tenant_credentials.twitch_client_id` + `twitch_client_secret_enc` für den Admin-Tenant. **Aber:** Twitch-OAuth-App ist *eine* App auf Twitch-Seite, nicht eine pro Tenant — sie identifiziert den obs-stream-kit-Service als Ganzes. Deshalb wandern Client-ID + Secret in **Server-Level Konfig** (`.secrets` + Env-Var), nicht in `tenant_credentials`:

```
Twitch App Client-ID:     <id>     # öffentlich, kann ins HTML
Twitch App Client-Secret: <secret> # server-only, NIE ins HTML
```

Die alten `twitch_client_id` + `twitch_client_secret_enc` Spalten in `tenant_credentials` bleiben bestehen (für Stream-spezifische Twitch-API-Aufrufe, wenn jemals nötig), werden aber für den OAuth-Flow nicht gelesen.

**Scopes:** `user:read:email` — minimal. Wir wollen nur Twitch-User-ID, Display-Name, Avatar-URL, optional Email. Keine Chat-Rechte (Streamer.bot macht das).

**Flow:**

```
1. User klickt "Mit Twitch einloggen" auf /
2. Server: GET /app/login
   → setzt CSRF-State in Flask-Session
   → 302 → https://id.twitch.tv/oauth2/authorize?
            client_id=...&redirect_uri=...&response_type=code
            &scope=user:read:email&state=<csrf>
3. Twitch zeigt Consent-Screen, User akzeptiert
4. Twitch: 302 → /app/oauth/callback?code=...&state=...
5. Server: GET /app/oauth/callback
   a. State-Check (CSRF)
   b. POST https://id.twitch.tv/oauth2/token (code → access_token)
   c. GET https://api.twitch.tv/helix/users (mit access_token → user-info)
   d. Lookup or create users-Row:
      - Wenn users-Row existiert mit twitch_user_id == X:
        → Login. Setze Session.
      - Wenn users-Row existiert mit twitch_user_id IS NULL AND is_admin=TRUE
        AND NICHT bereits ein anderer Admin gelinkt ist:
        → Admin-Claim. Setze twitch_user_id = X, display_name = Twitch-Name.
      - Sonst:
        → Neuer User: INSERT users (twitch_user_id, display_name, avatar_url,
          is_admin=FALSE, is_approved=FALSE)
        → 302 → /app/pending (Approval-Wartesseite)
   e. Wenn is_approved=FALSE → /app/pending mit Hinweis.
   f. Wenn is_approved=TRUE AND noch keinen Tenant → INSERT tenants
      (owner_user_id=user.id, slug=<auto-generated from twitch_name>) +
      INSERT tenant_credentials (tenant_id=...) +
      INSERT widget_tokens (tenant_id=..., label='Default').
   g. → /app/ (Dashboard).
```

**Admin-Bootstrap:**

Bei Deploy von Spec 2 existiert bereits `users(id=1, is_admin=TRUE, is_approved=TRUE, twitch_user_id=NULL)` (aus Spec-1-Seed). Der erste OAuth-Login eines Admins claimed diese Row (Punkt 5d Pfad 2). Da Spec 2 die Basic-Auth gleichzeitig entfernt, gibt's ein **Bootstrap-Risiko**: Wenn ein Fremder zwischen Deploy und Admin-Login die `/app/login`-Route erreicht und sich vor dem Admin einloggt, könnte er die Admin-Row claimen.

**Mitigation (zwingend bei Deploy):**

Option A — **Pre-Seed** (empfohlen): Admin loggt sich vorab einmal bei Twitch ein, holt seine User-ID (z.B. via `https://api.twitch.tv/helix/users` mit eigenem Access-Token, oder via Web-Tools wie [streamweasels.com/twitch-tools/convert-username-to-user-id](https://streamweasels.com/twitch-tools/convert-username-to-user-id/)), und der Admin-Tenant kriegt diese ID vor Deploy in die DB:
```sql
UPDATE users SET twitch_user_id = '12345678' WHERE id = 1;
```
Dann erfolgt der Admin-Claim-Pfad NICHT mehr (die Spalte ist gesetzt) — der erste Login matched einfach normal.

Option B — **Deploy-Window**: Spec 2 wird mit Basic-Auth-noch-aktiv deployed; Admin loggt sich ein, claimed die Row; danach Basic-Auth in nginx entfernen + reloaden.

Plan-Doku wird Option A präferieren mit Option B als Fallback.

### 3. URL-Token-Routing für OBS-Browser-Sources

**Token-Format:** `tok_<32 hex>` (32 Bytes random → 64-Zeichen-Hex prefix "tok_"). Existiert schon in Spec 1: `widget_tokens` Tabelle, `seed_admin` legt einen `Default`-Token pro Tenant an.

**Route-Handler:**

```python
@app.route("/s/<token>/widgets/<path:filepath>")
def widget_html(token, filepath):
    tenant_id = resolve_token(token)  # 404 wenn nicht gefunden/revoked
    g.tenant_id = tenant_id
    # serve_from_directory + Twitch-Inject (siehe unten)
    return _serve_widget(filepath)


@app.route("/s/<token>/api/<path:apipath>", methods=["GET","POST"])
def widget_api(token, apipath):
    tenant_id = resolve_token(token)
    g.tenant_id = tenant_id
    return _dispatch_api(apipath)
```

**HTML-Injection:** wenn ein Widget-HTML ausgeliefert wird, injiziert der Server (wie heute schon mit `__TWITCH_CHANNEL__`) zusätzlich:

```html
<script>
window.__SERVE_BASE__ = "/s/tok_a8f9.../";
window.__TWITCH_CHANNEL__ = "LuCKoR_HD";
window.__STEAM_CHANNEL__ = "...";
// etc.
</script>
```

Existierende Widget-JS-Files werden minimal angepasst: statt `fetch("/api/pubg/last-match")` → `fetch(window.__SERVE_BASE__ + "api/pubg/last-match")`. Helper-Funktion in `widgets/_common/api.js` zentralisiert das.

**Public Widget-Routes mappen 1:1 auf existierende:** `/widgets/pubg/last-match.html` (alt) → `/s/<token>/widgets/pubg/last-match.html` (neu). Die alte URL-Form geht nicht mehr — OBS-Source-URLs müssen einmalig umgestellt werden.

**Static Assets im Widget-Tree:** Bilder/Sounds in `widgets/.../assets/` und `widgets/pubg/maps/` sollen ohne Token-Re-Check zugänglich sein (sonst läuft jeder Map-Tile-Fetch über die Resolution-Middleware). Lösung: Diese statischen Pfade werden **außerhalb** von `/s/<token>/` gehostet, z.B. `/widgets-static/pubg/maps/Erangel.webp`. Da sie keine sensitiven Daten enthalten, ist das tenant-unabhängig OK. Widget-JS nutzt `__STATIC_BASE__ = "/widgets-static/"`.

### 4. Schema-Änderungen

```sql
-- Spec 2 Schema-Erweiterung (gehört in core/schema.sql migration)

ALTER TABLE users ADD COLUMN is_approved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
-- Admin-Row erhält is_approved=TRUE explizit (Backfill):
UPDATE users SET is_approved = TRUE WHERE is_admin = TRUE;

CREATE TABLE user_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    user_agent    TEXT,
    ip            INET
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at)
    WHERE expires_at > now();
```

**Hinweis `gen_random_uuid()`:** verlangt das Extension `pgcrypto`. Falls noch nicht aktiv:
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

**Server-side Sessions** statt signed-cookie weil:
- Sofortige Invalidation möglich (Admin kann User auslogen)
- Cookie nur Session-ID, kein Payload → kleiner, einfacher
- Bessere Audit-Möglichkeit (sehen wo User eingeloggt sind)

Cookie-Form: `obskit_sid=<uuid>; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`.
Cookie wird beim OAuth-Callback gesetzt, `last_seen_at` wird bei jedem `g.user`-Lookup aktualisiert (rolling), `expires_at` ist Hard-Cutoff 30 Tage.

### 5. UI-Komponenten (Skelett)

#### Landing-Page (`/`)

Statische Seite. Logo + Tagline ("OBS Stream Kit — PUBG/Steam Stats für deinen Stream") + großer Button "Mit Twitch einloggen" → `/app/login`. Bei bereits eingeloggtem User: 302 → `/app/`.

#### Login-Pending (`/app/pending`)

Sichtbar für User mit `is_approved = FALSE`. Zeigt: "Hallo {display_name}, dein Account wartet auf Freischaltung. Sobald der Admin freigibt, kannst du loslegen." Plus Logout-Button.

Wird per Polling-Refresh alle 30 s aktualisiert (über Plain JS) — wenn approved, redirect zu `/app/`. Optional, billig zu bauen.

#### Dashboard-Shell (`/app/`)

Die in Block 1 (Design-Mockup) gezeigte Struktur, aber **mit Platzhalter-Inhalt**:
- Sidebar mit Nav-Items (Dashboard / Settings / OBS-URLs / Match-History / Logout). Admin-Section mit User-Approval / POI-Editor / System nur sichtbar wenn `is_admin`.
- Topbar mit Greeting + User-Chip.
- Main-Area: einfache "Welcome"-Card mit Hinweisen ("Trag deine API-Keys ein", "Hol dir deine OBS-URLs"). Die Stats-Cards + Match-List bleiben **leere Platzhalter** mit "Coming in Spec 3"-Hinweis.

Sidebar-CSS aus dem v1-Mockup wird zu `app/static/dashboard.css` extrahiert. Brand-Variablen (`--brand-purple: #5e2a79; --brand-gold: #f2b705;`).

#### Settings (`/app/settings`)

Single-Page-Form (POST → speichert in `tenant_credentials`, redirect → /app/):
- PUBG: Name (Text), Platform (Dropdown: steam/kakao/psn/xbox), API-Key (Password-Input).
- Steam: Steam-ID (Text), API-Key (Password-Input).
- Test-Buttons: "PUBG-API testen" (resolved Name → account_id, zeigt Erfolg/Fehler).

Inkrementelles Speichern — leere Felder überschreiben nicht. Bei erfolgreichem Save wird automatisch `pubg_account_id` resolved + persistiert.

#### OBS-URLs (`/app/urls`) — Minimal

Tabelle: Widget-Name | URL | Copy-Button. Liste hardcoded aus den verfügbaren Widget-HTML-Files in `widgets/`. Token kommt aus `widget_tokens WHERE tenant_id=g.tenant_id ORDER BY created_at LIMIT 1`.

In Spec 3: Per-Widget Description, Vorschau, Konfiguration. In Spec 2 nur die nackte Liste.

#### Admin: User-Approval (`/admin/users`)

Tabelle: Avatar | Display-Name | Twitch-User-ID | Registriert seit | Status | Aktion
- Filter-Tabs: "Wartend" / "Aktiv" / "Alle"
- Aktion-Buttons: "✓ Freigeben" / "✗ Ablehnen" / "🔒 Sperren" (für bereits Aktive)
- Bei Freigabe: setze `is_approved=TRUE` + erstelle Tenant + tenant_credentials + widget_tokens-Default. Ohne diesen Schritt kann der User sich nicht einloggen.
- Bei Ablehnung: setze `is_approved=FALSE` (bleibt so, aber User kann sich nicht einloggen — Pending-Loop).
- Bei Sperren: User-Sessions invalidieren + `is_approved=FALSE`.

#### Admin: Bereiche-Stub (`/admin/`)

Welcome-Card mit Links zu User-Approval, später POI-Editor / System. Restliche Admin-Specifics ist Spec 4.

### 6. Tenant-aware Domain-Code

Die `HARDCODED_TENANT_ID = 1`-Konstante in `pubg/endpoints.py`, `pubg/aggregations.py`, `steam/endpoints.py` wird gelöscht. Stattdessen:

```python
from flask import g
tenant_id = g.tenant_id  # gesetzt von Middleware
```

Da viele Funktionen außerhalb des Request-Context auch laufen können (Poller!), wird das so gestaltet: Funktionen nehmen `tenant_id` als Pflicht-Argument (wie schon nach Spec 1), aber die Flask-Routes lesen `g.tenant_id` und reichen es runter:

```python
@app.route("/api/pubg/last-match")
def api_last_match():
    return _ok(compute_last_match(get_db(), g.tenant_id))
```

Das nimmt die Hardcode-Konstante als Default raus und macht die Funktionen pure tenant-input-getrieben.

### 7. Streamer.bot-Migration

Bestehende Streamer.bot-Konfig nutzt vermutlich Endpoints wie `https://king-edition.de/api/pubg/last-match` mit Basic-Auth-Header. Nach Spec 2:
- Basic-Auth-Header entfällt.
- URL-Form: `https://king-edition.de/s/<token>/api/pubg/last-match`.

Token = das Default-Token des Admin-Tenants (sichtbar in `/app/urls`).

Dokumentiert in `docs/streamerbot-migration.md` (neue Datei) mit Schritt-für-Schritt Anleitung.

## Daten-Fluss-Beispiele

### Neuer Streamer-Onboarding

1. Streamer öffnet `https://king-edition.de/` → Landing-Page.
2. Klick "Mit Twitch einloggen" → `/app/login` → 302 → Twitch.
3. Twitch-Consent → Callback mit `code`.
4. Server: Token-Tausch → User-Info (`twitch_user_id=987654321`, `display_name=NeuerStreamer`).
5. Server: `users`-Row anlegen (`is_approved=FALSE`).
6. Server: 302 → `/app/pending`.
7. Streamer sieht "Warte auf Freischaltung".

8. Admin öffnet `/admin/users?status=wartend` (mit `obskit_sid` Cookie).
9. Sieht NeuerStreamer in der Tabelle.
10. Klick "✓ Freigeben" → POST `/admin/users/987654321/approve`.
11. Server: `is_approved=TRUE`, INSERT tenants, tenant_credentials (leer), widget_tokens (Default).
12. (Optional: Push-Notification an Streamer via SSE — Spec 3 oder später.)

13. NeuerStreamer poll'd `/app/pending` (JS-Auto-Refresh). Sieht is_approved=TRUE.
14. Auto-Redirect zu `/app/`.
15. Welcome-Card sagt "Trag erst deine PUBG-Keys ein" → Klick `/app/settings`.
16. Form-Submit → tenant_credentials befüllt.
17. Zurück zu `/app/` (Dashboard-Shell sichtbar).
18. Klick `/app/urls` → kopiert Widget-URLs in OBS.

### OBS-Widget-Request

1. OBS Browser-Source: `https://king-edition.de/s/tok_a8f9.../widgets/pubg/last-match.html`.
2. nginx → Flask.
3. Middleware: Token-Lookup → `tenant_id=42` → `g.tenant_id=42`.
4. Handler: liest HTML-File, injiziert `__SERVE_BASE__` + `__TWITCH_CHANNEL__` + andere Tenant-Daten.
5. Response: HTML.
6. Browser parsed, JS lädt `fetch(__SERVE_BASE__ + "api/pubg/last-match")` = `/s/tok_a8f9.../api/pubg/last-match`.
7. Handler: Token-Lookup (wieder) → `tenant_id=42` → `compute_last_match(get_db(), 42)`.
8. JSON-Response.

### Dashboard-API-Request

1. Browser zu `/app/`, User hat `obskit_sid`-Cookie.
2. Middleware: Session-Lookup → `g.user`, `g.tenant_id`.
3. Dashboard-JS fetch'd `/api/pubg/session-stats` (relative URL, kein Token).
4. Handler: liest `g.tenant_id` (= owned Tenant des Users) → Aggregation.
5. JSON-Response.

## Error Handling

| Szenario | Verhalten |
|---|---|
| Token nicht gefunden / revoked | 404 mit JSON `{"error": "Unknown widget token"}` |
| Session-Cookie abgelaufen | 302 → `/app/login` (von protected Route) oder 401 (von API-Call) |
| User logged in aber `is_approved=FALSE` | 302 → `/app/pending` (alle Routes außer `/app/pending`, `/app/logout`, OAuth-Callback) |
| Twitch-OAuth-Callback ohne State | 400 "OAuth-State-Mismatch (CSRF)" |
| Twitch-Token-Exchange schlägt fehl | 502 "Twitch returned error: …" |
| Twitch /helix/users gibt leeren User | 502 "Twitch lieferte keine User-Daten" |
| User klickt Admin-Action ohne is_admin | 403 |
| User klickt Settings-Save mit invalidem PUBG-Key | Inline-Form-Error, kein DB-Write |
| PUBG-API-Resolve schlägt fehl beim Settings-Save | Settings werden trotzdem gespeichert, `pubg_account_id` bleibt NULL, Banner "Account-ID konnte nicht aufgelöst werden — Keys werden re-tried beim ersten Poll" |

## Tests

Schwerpunkte:
- `tests/app/test_middleware.py` — Tenant-Resolution für `/s/<token>/...` vs. `/app/...` vs. `/admin/...`. Erwartete 302/401/403.
- `tests/app/test_oauth.py` — Mock Twitch-Endpoints; happy path, CSRF-Fail, Token-Fail, neuer User (pending), bestehender User (login), Admin-Claim.
- `tests/app/test_approval.py` — Admin approved User, Tenant + Token werden erstellt, sperrbar.
- `tests/app/test_settings.py` — Settings-Form schreibt in tenant_credentials, encrypted Felder werden verschlüsselt.
- `tests/app/test_widget_routes.py` — `/s/<token>/widgets/...` resolved Token korrekt, injiziert SCRIPT-Block, `/s/<token>/api/...` routet auf bestehende Handler.
- `tests/app/test_session.py` — Cookie-Setup, Expiry, Logout.

PG-DB-abhängige Tests skipping über `OBS_KIT_PG_DSN_TEST`.

## Sicherheit

- **CSRF**: Flask-Session-State im OAuth-Flow. Settings-Form mit CSRF-Token (Flask-WTF oder manueller Hidden-Token).
- **Twitch-Client-Secret**: nur server-side (.secrets), niemals im HTML.
- **Master-Key**: persistiert via `/etc/obs-stream-kit.env` (Spec-1-Cutover hat das bereits eingerichtet).
- **Cookie**: `HttpOnly; Secure; SameSite=Lax` (Lax weil OAuth-Callback via 302 die Session lesen muss).
- **Token in URL**: per definitionem nicht stark wie Cookie. Mitigation: jedes Token ist rotierbar (Spec 3 baut den Button); für Spec 2 reicht "Token im URL und damit in Browser-History/Logs". Realistisches Threat-Model: OBS-Browser-Sources laufen lokal beim Streamer, Logs sind nicht öffentlich.
- **Open Registration mit Approval**: jeder Twitch-User landet in `users`-Tabelle. Spam-Risk: Rate-Limit auf OAuth-Callback IP-basiert (10/min) — Spec 2 Minimum.

## Migration / Deploy-Plan

1. **Admin-Twitch-ID besorgen** (manueller One-Time-Step vor Deploy).
2. **Schema-Migration**: `ALTER TABLE users ADD COLUMN is_approved`, `CREATE TABLE user_sessions`, etc.
3. **Twitch-App** anlegen auf https://dev.twitch.tv/console/apps — Client-ID + Secret in `.secrets` als `Twitch App Client-ID` und `Twitch App Client-Secret`. Redirect-URI: `https://king-edition.de/app/oauth/callback`.
4. **Code-Deploy** via `scripts/deploy.sh`.
5. **nginx**: `auth_basic`-Zeilen entfernen, `nginx -t && systemctl reload nginx`.
6. **Service-Restart** (deploy.sh macht das eh).
7. **Smoke-Test**:
   - `https://king-edition.de/` → Landing.
   - Admin loggt sich ein → Dashboard.
   - Existierende OBS-URLs **funktionieren noch nicht** — müssen einmalig umgestellt werden.
8. **OBS-Browser-Sources umstellen** auf neue Token-URLs (Admin holt sich seine URLs aus `/app/urls`).
9. **Streamer.bot umstellen** (siehe docs/streamerbot-migration.md).

## Erfolgskriterien

- `https://king-edition.de/app/login` → Twitch → Callback → `/app/` läuft sauber durch.
- Ein zweiter Twitch-Account loggt sich ein → landet in `/app/pending`.
- Admin sieht den 2. User in `/admin/users` und kann freigeben.
- Nach Freigabe: 2. User loggt sich ein → `/app/` Dashboard-Shell sichtbar.
- 2. User trägt PUBG-Keys ein → Save klappt, `tenant_credentials.pubg_api_key_enc` befüllt.
- 2. User holt Widget-URL → öffnet in Browser → Widget zeigt Daten seines eigenen Tenants (nicht des Admins).
- Admin's existierende OBS-Widgets funktionieren wieder unter neuer Token-URL.
- nginx liefert keine 401 Basic-Auth mehr aus.

## Offene Punkte

- **Twitch-Login-Button**: brauchen wir auf Landing-Page Logo + Tagline-Text. Wer macht den Text? (Default-Vorschlag implementiert, Admin kann später editieren via einer config-Datei.)
- **Pending-Auto-Refresh**: 30-s-Poll oder SSE? Spec 2 nimmt Poll (simpler). SSE für Push-Notifications kommt vielleicht in Spec 3/4.
- **Admin-Notification bei neuer Registration**: Email? Web-Push? Nichts? Spec 2 sagt: **nichts** (Admin schaut manuell in `/admin/users`). Spec 4 kann das ausbauen.
- **TeamSpeak/Scenes-Widgets**: aktuell außerhalb des Multi-Tenant-Modells. Solange sie im obs-stream-kit-Repo bleiben, müssen ihre URL-Routes auch unter `/s/<token>/...` laufen. Falls TS3 in eigenes Repo wandert (siehe Spec-1-Followups), entfällt das Problem.
