# Overlay-Service-Split — Design

**Datum:** 2026-06-02
**Status:** Design (zur Review)

## Ziel

Die heutige Monolith-Flask-App in **zwei eigenständige Services** mit je eigener
Subdomain aufteilen, ohne Code zu duplizieren:

- **Service 1 — `stats-overlay.info` (Apex, unverändert)**
  JSON-API (`/api/`) + Overlay-Dashboard (`/app/`, daten-getriebene Widgets & Tools).
  Bleibt im Wesentlichen die heutige App, gleiche Domain wie heute.
- **Service 2 — `overlays.stats-overlay.info`** *(NEU)*
  Produktions-/Bühnen-Overlays (Starting-Soon, BRB/Pause, Stream-Ending,
  Just-Chatting, Kamera/Gameplay) + eigenes schlankes Mini-Dashboard.
  Eigener Prozess, eigene systemd-Unit.

Beide Services teilen sich Auth, Tenancy, DB und das tokenisierte Serving —
der Overlay-Service ist eine zweite dünne Flask-App über einer gemeinsamen
`webcore/`-Basis.

### Begriffsklärung

Die Dateien in `scenes/` sind **keine OBS-Szenen**, sondern **Overlays, die in
Szenen gelegt werden** (Browser-Sources). Daher:

- **Service 1 / `widgets/`** = *daten-getriebene* Overlays + Tools (ziehen die API).
- **Service 2 / `overlays/`** = *Produktions-Overlays* ohne Live-Spieldaten.

Der Ordner `scenes/` wird zu `overlays/` umbenannt.

## Entscheidungen (aus dem Brainstorming)

| Thema | Entscheidung |
|---|---|
| Trennungsart | Zwei **echte Prozesse**, je eigene Subdomain (Ansatz A) |
| Service-Schnitt | API + Dashboard zusammen (Service 1); Produktions-Overlays separat (Service 2) |
| Tenancy Service 2 | **Multi-tenant** wie Haupt-App, geteiltes Auth/Tenancy/`core` |
| OAuth in Service 2 | **Nein** — Login läuft immer über Haupt-Domain, Cookie kommt cross-subdomain mit |
| Shared-Layer-Name | `webcore/` |
| Clip-Player-Secret | **Server-seitig** via `/s/<token>/api/twitch/clips` — kein `client_secret` im Browser |
| Service-2-Name | `overlays` → Subdomain `overlays.…`, Package `overlay_app/`, Ordner `overlays/` |
| Gameplay/Kamera | Ist ein Overlay → wandert mit nach Service 2 |

## Architektur

### Code-Struktur (Ziel)

```
obs-stream-kit/
├── core/                      # bleibt — domain-agnostisch (DB/Creds/Crypto)
│
├── webcore/                   # NEU — geteilte Flask-Schicht für BEIDE Services
│   ├── __init__.py
│   ├── config.py              # ← app/config.py
│   ├── middleware.py          # ← app/middleware.py; require_session() nutzt
│   │                          #   konfigurierbare LOGIN_URL statt hartem "/app/login"
│   ├── sessions.py            # ← app/sessions.py
│   ├── auth.py                # ← app/auth.py (OAuth; Cookie auf .stats-overlay.info)
│   ├── twitch_client.py       # ← app/twitch_client.py
│   ├── metrics.py             # ← app/metrics.py (beide Factories registrieren es)
│   ├── creds_gate.py          # ← app/creds_gate.py
│   └── serving.py             # NEU — _inject() + tokenisiertes Datei-Serving + static-Helper
│                              #   (extrahiert aus views_widgets.py / views_static.py)
│
├── app/                       # SERVICE 1 — API + Dashboard + Widgets/Tools
│   ├── __init__.py            # create_app(); registriert webcore.auth + eigene BPs
│   ├── views_api.py           # /api/* und /s/<token>/api/*  (+ neuer twitch/clips-Endpoint)
│   ├── views_app.py           # /app/ Dashboard
│   ├── views_admin.py         # /admin/*
│   ├── views_widgets.py       # /s/<token>/widgets/<file>  (nutzt webcore.serving)
│   ├── views_static.py        # /widgets-static/  /tools-static/
│   ├── widget_catalog.py
│   ├── poller_startup.py      # PUBG/Steam-Poller (NUR hier)
│   ├── static/                # dashboard.css …
│   └── templates/
│
├── overlay_app/               # NEU — SERVICE 2 — overlays.stats-overlay.info
│   ├── __init__.py            # create_app(); webcore.middleware + Overlay-BPs, KEIN OAuth
│   ├── views_overlays.py      # /s/<token>/overlays/<file>  (Channel/Client-ID-Injection)
│   ├── views_dashboard.py     # /  Overlay-Mini-Dashboard (hinter Login)
│   ├── overlay_catalog.py     # Metadaten: key, label, file, size, params, type
│   ├── static/                # schlankes eigenes Dashboard-CSS
│   └── templates/             # overlay_dashboard.html, base.html
│
├── overlays/                  # ← scenes/  (umbenannt) — die Overlay-HTML-Dateien
│   └── starting-soon.html  brb-pause.html  stream-ending.html
│       just-chatting.html  gameplay.html
│
├── pubg/  steam/  teamspeak/  # bleiben — Domain-Backends (Service 1)
│
├── serve.py                   # Service 1 Entry (:9000)
└── serve_overlays.py          # NEU — Service 2 Entry (:9001)
```

### Komponenten & Verantwortlichkeiten

- **`webcore/`** — alles, was beide Apps brauchen. Reine Verschiebung aus `app/`,
  keine Logikänderung außer zwei gezielten Anpassungen (LOGIN_URL, Cookie-Domain).
- **`app/`** — unverändert in Funktion; importiert künftig aus `webcore` statt
  aus den lokalen Modulen.
- **`overlay_app/`** — neue, dünne App: liest die Session (geteiltes Cookie),
  serviert die Overlays tokenisiert mit Injection, zeigt das Mini-Dashboard.

### Datenfluss

1. **Login (einmalig, Haupt-Domain):** `stats-overlay.info/app/login` → Twitch-OAuth
   → Callback setzt `obskit_sid`-Cookie mit `domain=.stats-overlay.info`.
2. **Overlay-Dashboard:** Aufruf `overlays.stats-overlay.info/` → `webcore.middleware`
   liest das Cookie (cross-subdomain) → `g.user`/`g.tenant_id`. Fehlt es →
   Redirect auf `https://stats-overlay.info/app/login`.
3. **Overlay als Browser-Source:** `overlays.…/s/<token>/overlays/brb-pause.html`
   → Middleware löst `widget_tokens` → Tenant → `webcore.serving` injiziert
   `__TWITCH_CHANNEL__`, `__TWITCH_CLIENT_ID__`, `__SERVE_BASE__`, `__STATIC_BASE__`.
4. **Clip-Abruf (BRB):** Szene ruft `GET /s/<token>/api/twitch/clips` →
   Server hält `client_secret`, gibt fertige Clip-Liste zurück.

### Token & Tenancy

- **Wiederverwendung** der bestehenden `widget_tokens`-Tabelle — ein Token pro
  Tenant deckt API + Widgets + Overlays. Keine neue Tabelle.
- Die `webcore.middleware` löst `/s/<token>/…` generisch auf (Regex existiert
  bereits); der Overlay-Service erbt das unverändert.

### Cross-Cutting-Änderungen

| Thema | Heute | Nach Umbau |
|---|---|---|
| Cookie-Scope | host-only `stats-overlay.info` | `domain=.stats-overlay.info` → SSO über beide Subdomains |
| Login-Redirect | `require_session` → hart `/app/login` | konfigurierbare `LOGIN_URL`; Overlay-Service → absolute Haupt-Domain-URL |
| OAuth-Callback | nur Haupt-Domain | bleibt nur Haupt-Domain — Overlay-Service hat kein OAuth |
| Client-Secret | ins HTML injiziert | server-seitig im `twitch/clips`-Endpoint, nie im Browser |

## Sicherheit

- **Kein `client_secret` mehr im Browser.** Der bestehende BRB-Player liest heute
  `window.__TWITCH_CLIENT_SECRET__`; das wird durch den server-seitigen
  Clip-Endpoint ersetzt. `client_id` (öffentlich) darf weiter injiziert werden.
- **Cookie:** bleibt `HttpOnly`, `Secure`, `SameSite=Lax`. Die Erweiterung auf
  `domain=.stats-overlay.info` ist nötig für SSO; betrifft nur Subdomains der
  eigenen Domain.

## Error Handling

- Unbekannter/revoked Token → 404 (wie heute in der Middleware).
- Overlay-Dashboard ohne gültige Session → Redirect auf Haupt-Domain-Login.
- Clip-Endpoint ohne Twitch-App-Credentials am Server → definierter Fehler
  (leere Clip-Liste + Log), Overlay degradiert sauber statt zu crashen.

## Deployment

- Zwei systemd-Units: `obs-stream-kit.service` (:9000) und
  `obs-overlays.service` (:9001), beide aus demselben Repo/venv, eigener
  Entry-Point.
- nginx: zusätzlicher `server`-Block für `overlays.stats-overlay.info` →
  `proxy_pass http://127.0.0.1:9001`, gleiche `ProxyFix`-Header.
- TLS: Zertifikat um die Subdomain erweitern (Certbot `-d overlays.…` bzw.
  Wildcard).
- DNS: A/AAAA-Record `overlays` auf denselben Host.

## Testing

- **Extraktion abgesichert:** Die bestehende `tests/app/`-Suite muss nach dem
  Verschieben `app/ → webcore/` grün bleiben (nur Import-Pfade anpassen) —
  beweist, dass die Verschiebung verhaltensneutral war.
- **Neu `tests/webcore/`:** Cookie-Domain-Setzen, `LOGIN_URL`-Konfigurierbarkeit
  von `require_session`.
- **Neu `tests/overlay_app/`:** tokenisiertes Overlay-Serving + Injection,
  Login-Redirect auf Haupt-Domain bei fehlender Session, `twitch/clips`-Endpoint
  (Secret bleibt server-seitig).
- Fixtures aus `tests/conftest.py` (`tmp_db_path`) wiederverwenden.

## Migrations-Reihenfolge (grob — Detaillierung im Plan)

1. `webcore/` anlegen, Module aus `app/` verschieben, Importe in `app/` + Tests
   umbiegen, Suite grün halten. (Verhaltensneutral.)
2. Cookie-Domain + konfigurierbare `LOGIN_URL` einbauen, Tests dafür.
3. `scenes/ → overlays/` umbenennen, README/Referenzen anpassen.
4. `overlay_app/` bauen: Serving, Mini-Dashboard, Catalog.
5. Server-seitigen `twitch/clips`-Endpoint bauen, BRB-Overlay darauf umstellen.
6. `serve_overlays.py`, systemd-Unit, nginx-Block, Cert, DNS.

## YAGNI / Nicht-Ziele

- Kein Aufsplitten von `core/` in ein installierbares Package (Ansatz C verworfen).
- Keine getrennten Repos.
- Keine Änderung am bestehenden Stats-Dashboard-Funktionsumfang.
- Keine Migration der Alt-Bestand-Widgets.
