# Stream Overlay Set

## Projekt
Komplettes OBS Stream-Overlay-Set als statische HTML/CSS/JS Browser-Sources.
Repo: github.com/devilsche/obs-stream-kit

## Was gebaut wird
- **Starting Soon** Szene (animiert)
- **BRB / Pause** Szene (mit integriertem Twitch Clip-Player, random Wiedergabe)
- **Stream Ending** Szene (animiert)
- **Gameplay Overlay** mit Kamera-Bereich (400px breit, 16:9 Seitenverhältnis)
- **Just Chatting Overlay** (Fullscreen-Kamera mit dezenter Deko)
- **Alert-Animationen**: New Follower, Sub, Resub, Gift Sub, Bits/Cheers, Raid
- **Übergänge / Stinger Transitions**

## Technisch
- Jede Szene/Alert = eine eigenständige HTML-Datei (OBS Browser-Source)
- Vanilla HTML/CSS/JS — kein Build-Tool, kein Framework
- 1920x1080 Canvas
- Transparenter Hintergrund wo nötig (für Overlays/Alerts)
- Animationen via CSS @keyframes + Web Animations API
- Twitch Clips via Twitch Embed API
- Konfigurierbar via URL-Parameter (Twitch-Username, Farben etc.)

## Design
- Stil: Entry-inspiriert — Purple (#5e2a79) / Gold (#f2b705), DM Sans Font
- Dark-Theme-Basis für Stream
- Animationen: smooth, nicht übertrieben, professionell
- Konsistenter Look über alle Szenen

## Twitch
- Twitch-Channel kommt aus `.secrets` (`Twitch-Channel:` Eintrag) und
  wird vom Server in HTML-Seiten injiziert (`window.__TWITCH_CHANNEL__`).
  Kein hardcodierter Nickname im Source — das Repo ist generisch
  nutzbar von jedem Streamer der seine `.secrets` + `config/pubg.json`
  ausfüllt.
- Clips über Twitch API / Embed laden

## PUBG-Backend
- PUBG-Nickname + Plattform aus `config/pubg.json`
  (Template: `config/pubg.example.json`)
- PUBG-API-Key aus `.secrets` (`PUBG API Key:` Eintrag)
- Beide Files sind gitignored — jeder Nutzer trägt seine eigenen Daten ein

## Git
- Commit messages: Deutsch, Conventional Commits, KEIN Co-Authored-By
- Direkt auf `master` committen, keine Feature-Branches, keine Worktrees

## Architektur-Konventionen

**Verzeichnis-Layout (verbindlich fuer neuen Code):**

- **`widgets/<domain>/*.html`** — NUR Display-Widgets fuer OBS Browser-Sources. Pollen einen JSON-Endpoint und rendern, sonst nichts. Keine Schreib-Operationen, kein Edit-Modus. Tipische Groessen: 1920x1080 (Vollbild-Szene), oder kompakte Ecken-Overlays.
- **`tools/*.html`** — Config-Editoren + Verwaltungs-Tools. Schreiben in `data/*.json` via POST-Endpoints. Werden im normalen Browser-Tab geoeffnet, NICHT als OBS-Source. Mehrere Domains koennen sich `tools/` teilen, oder mit Praefix (`tools/pubg-pois.html`).
- **Alt-Bestand** (z.B. `widgets/pubg/poi-editor.html`, `widgets/steam/achievement-browser.html`) bleiben aus historischen Gruenden wo sie sind. Nicht migrieren, aber NEUER Code folgt der sauberen Trennung.

**Konfigurations- und Daten-Files:**

- **`.secrets`** — Credentials/API-Keys. Gitignored. Vom Server beim Start eingelesen. Format: `Key: Wert` zeilenweise.
- **`config/<domain>.json`** — Setup-Daten die der Nutzer pro Installation einmalig ausfuellt (PUBG-Nickname, Plattform). Gitignored. Mit `config/<domain>.example.json` als Template.
- **`data/<domain>.json`** oder `data/<domain>-history.db` — Persistenter State, der zur Laufzeit waechst/aendert. Gitignored. Wird von Tools/Backends geschrieben.

**API-Endpoints (`pubg/endpoints.py`-Pattern):**

- Pfad-Schema `/api/<domain>/<resource>` (z.B. `/api/pubg/last-match`, `/api/steam/achievements-list`).
- GET fuer Lesen, POST fuer Schreiben. Body als JSON.
- Returns: `_ok(payload)` oder `_err(status, msg)` — gemeinsame Helper in `pubg/endpoints.py`.
- Domain-Module bekommen ihren eigenen Endpoint-Handler. Routing-Dispatch in `serve.py`.

**Backend-Module:**

- **`<domain>/`** Python-Package mit `endpoints.py`, optional `client.py` (externe API), `aggregations.py` (DB-Queries), `db.py` (Schema + DAO). Beispiele: `pubg/`, `steam/`.
- **`pubg/aggregations.py`** kann sehr gross werden — neue domain-spezifische Logik landet im eigenen Package, nicht im PUBG-Modul.

**Frontend-Helpers:**

- **`widgets/<domain>/_<domain>.js`** und `_<domain>.css` — gemeinsame UI-Bausteine fuer Widgets innerhalb der Domain (z.B. `widgets/pubg/_pubg.js`).
- Frontend ist **vanilla JS** — kein Build-Tool, kein Bundler, kein npm. Browser laedt direkt.

**Tests:**

- `tests/<domain>/test_<feature>.py` mit pytest. Fixture `tmp_db_path` aus `tests/conftest.py` fuer DB-tests.
- TDD wenn moeglich: Test schreiben → fail → Implement → pass.
- Frontend-JS hat keine Test-Infrastruktur. Manuelle Smoke-Tests im Browser oder per `node -e "new Function(...)"`-Syntax-Check.
