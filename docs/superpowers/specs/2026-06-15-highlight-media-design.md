# Highlight-Media (Steam-Game-Media als Highlight-Quelle) — Design-Spec

**Datum:** 2026-06-15

**Ziel:** In den Szenen-Overlays (Starting Soon, Stream Ending, BRB/Pause) optional
**Steam-Game-Media** (Trailer + Screenshots des gerade gespielten Spiels) statt der
Twitch-Clips zeigen. Steuerbar über ein Dashboard-Setting, mit automatischem
Fallback auf Clips.

## Quellen-Logik (Dashboard-Setting `highlight_source`)
- **`clips`** (Default): immer nur Twitch-Clips — wie bisher, null Regression.
- **`steam_media`**: läuft gerade ein Spiel (now-playing appId erkannt) **und** ist
  Media gecacht → Steam-Media dieses Spiels. Sonst → **Fallback auf Clips.**

Die gesamte Entscheidung passiert **server-seitig** in einem Endpoint, damit der
Client (clip-player.js) nur fragt „was soll ich zeigen?".

## Steam-Media
- **Trailer**: Steam liefert `movies[]` als **HLS** (`hls_h264`) + `thumbnail`.
  Chromium (OBS) spielt HLS nicht nativ → **hls.js** nötig.
- **Screenshots**: `screenshots[].path_full` (einfache Bilder) → Slideshow,
  Anzeigedauer pro Bild per Param `?screenshotSec` (Default 10).
- Reihenfolge: Trailer zuerst (sofern vorhanden), dann Screenshot-Slideshow im Loop.

## Komponenten

### 1. Backend
- `steam/api_client.py`: `get_app_media(app_id)` — Storefront `appdetails?filters=movies,screenshots`,
  extrahiert `{trailers:[{id,name,hls,thumbnail}], screenshots:[url,...]}`.
- `steam/db.py`: `steam_app_details` um `media_json TEXT` erweitern (+ sqlite-Migration).
- Storefront-Sync (Layer 3, `_tick_app_details_sync`) speichert Media mit.
- **Endpoint** `GET /api/steam/highlight-media`:
  - Liest `highlight_source`-Setting des Tenants.
  - `clips` → `{source:"clips"}`.
  - `steam_media` + now-playing appId + Media vorhanden → `{source:"steam", appId, gameName, trailers, screenshots}`.
  - sonst → `{source:"clips"}` (Fallback).

### 2. Dashboard-Setting
- `settings.html`: Select „Highlight-Quelle" (Clips / Steam-Media).
- `views_app.py`: Whitelist + `get_setting`/`set_setting` `highlight_source`.

### 3. clip-player.js (zentral — alle 3 Overlays nutzen es)
- Vor dem Clip-Flow: `GET /api/steam/highlight-media` abfragen.
- `source==="steam"` → Steam-Media-Player: Trailer via hls.js (muted, autoplay),
  danach Screenshot-Slideshow (`screenshotSec`), Loop. Meta-Zeile zeigt Spielname.
- `source==="clips"` → bestehender Clip-Flow unverändert.
- hls.js dynamisch laden (CDN) nur wenn Trailer abgespielt werden.

### 4. Overlays
- Kein Layout-Neubau nötig — alle drei haben `#clipContainer` + nutzen `ClipPlayer.init`.
  Steam-Media rendert in denselben Container (Trailer = `<video>`, Screenshots = `<img>`).

## Phasen (jede einzeln deploybar)
1. **Backend**: Media-Fetch + DB + Endpoint (liefert vorerst immer `clips` bis Setting da).
2. **Dashboard-Setting** `highlight_source`.
3. **clip-player.js** + hls.js: Steam-Media-Wiedergabe + Fallback.
4. **Politur**: Übergänge, Screenshot-Slideshow-Animation, Verifikation per Render.

## Tests / Verifikation
- Backend: pytest für `get_app_media`-Parsing + Endpoint-Quellen-Logik (clips/steam/fallback).
- Frontend: Render der Overlays headless (wie bei Deathmatch-Widget) je Quelle.
- Null Regression: Default `clips` → bestehender Flow unverändert.
