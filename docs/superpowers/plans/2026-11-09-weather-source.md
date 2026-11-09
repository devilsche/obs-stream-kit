# Weather-Source (Teil 1: Wetter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Source `effects/weather.html`, die echtes Wetter am Ort des Streamers zeigt, von der Session-K/D gefärbt wird, per Chat zeitweise übersteuert werden kann, Spektakel abspielt und `rain.html`/`snow.html` ersetzt.

**Architecture:** Der Server rechnet den wirksamen Wetterzustand aus (Schicht 1 API, Schicht 2 K/D-Stimmung, Schicht 3 Übersteuerung) und liefert ihn über `/s/<token>/api/fx/weather/state`. Das Overlay pollt diesen Zustand und die bestehende fx-Befehlswarteschlange und blendet weich über. Die Wetterlogik liegt testbar in Python (`fx/weather*.py`), die Darstellung in einem wiederverwendbaren Baustein `js/weather-kit.js`, den später Frost und die Themen nutzen.

**Tech Stack:** Python 3 / Flask (fx-Blueprint), sqlite-Stil-DAO über `SqliteCompatConn`, Open-Meteo (Forecast + Geocoding, ohne Key), Vanilla JS + Canvas 2D.

**Spec:** `docs/superpowers/specs/2026-11-09-weather-source-design.md`

**Nicht in diesem Plan (eigene Pläne danach):** Frost-Ebene mit `!scrape`/`!warm` (Teil 2), Winter-Thema mit Xmas-Aufbau/-Abschied (Teil 3), Frühling/Sommer/Herbst-Themen und Umleitung der Jahreszeiten-URLs (Teil 4). Dieser Plan liefert dafür `frost` im Zustand und `WeatherKit` als Baustein.

## Global Constraints

- Frontend-Texte (Labels, Tooltips, aria) englisch; Chat, Commits, Code-Kommentare deutsch mit echten Umlauten.
- Keine Inline-Styles, kein JS-`.style`-Setzen für Optik — Klassen, CSS-Custom-Properties per `setProperty` auf `:root`/Scopes sind ok wie in bestehenden Effekten; Canvas-Zeichnen ist ok.
- Keine Emojis, Icons nur Material Symbols.
- Partikel nie hart an Bildkanten: Rand-Fade für alles, was rein- oder rausfliegt.
- `prefers-reduced-motion`: Partikelzahl stark reduziert, keine Spektakel-Bewegung (nur kurzer Blend).
- SQL mit `?`-Platzhaltern (`SqliteCompatConn`), nie `%s` in fx-Code.
- Ort des Streamers nie in URL, Overlay-Antwort oder Frontend des Overlays; nur Dashboard-Einstellungen zeigen das Label.
- Ton im Browser standardmäßig aus (`sound=0`).
- Übergang echtes Wetter/Stimmung 25 s, Übersteuerung 4 s; Mindestdauer je Übersteuerung 15 s; Standard-Haltezeit 150 s; `hold=0` = unbegrenzt (Erzwingen).
- K/D-Stimmung: nur BR-Runden (`_br_filter`), alle getrackten Accounts des Tenants, wirkt erst ab 3 Runden der laufenden Session; Session gilt als laufend, wenn das letzte Match < 4 h her ist. Stimmung holt höchstens Niesel/Regen, nie Gewitter.
- Tests nur gezielt die genannten Dateien laufen lassen, nie die volle Suite.
- Commits direkt auf `master`, Conventional Commits auf Deutsch, ohne Co-Authored-By.
- README in derselben Kette aktualisieren.

**Abweichung vom Spec (Call des Plans):** „Eigener Schnitt“ ist die BR-K/D der letzten 60 Tage aus der eigenen DB statt der Season-K/D aus der API — gleiche Formel (kills / (matches − wins)), keine API-Abhängigkeit, Season-Snapshots sind nur für den Primär-Account verlässlich.

## Review Focus

1. Kein Ort hinterlegt, Open-Meteo down oder Timeout → Overlay zeigt die Ersatz-Lage (`fallback`, Standard `clear`), friert nicht ein; letzte gute API-Antwort gilt bis 60 min weiter. → Test in Task 3 und Task 5.
2. Mehrere `!gewitter`/`!schneesturm` innerhalb von 15 s → nur der jüngste wartet, kein Flackern; `hold=0` überlebt einen Service-Neustart. → Test in Task 2.
3. Letzte Runde Stunden her oder nur Arcade-Runden → Stimmung neutral. → Test in Task 4.
4. Sehr schlechte K/D → höchstens Regen, nie Gewitter; Stimmungs-Optik dunkelt die Bildmitte nicht ab. → Test in Task 1, Sichtprüfung in Task 7.
5. Alte `rain.html`-/`snow.html`-URLs (mit Token-Pfad und Parametern) und Streamer.bot-Aktionen auf `/api/fx/rain` laufen weiter. → Test in Task 10, Smoke in Task 11.

---

### Task 1: Wetterlogik (Zustände, API-Code-Abbildung, Stimmung)

**Files:**
- Create: `fx/weather.py`
- Test: `tests/fx/test_weather.py`

**Interfaces:**
- Produces:
  - `KINDS: tuple[str, ...] = ("clear","cloudy","fog","drizzle","rain","storm","sleet","snow","blizzard","heat")`
  - `SPECTACLES: tuple[str, ...] = ("tsunami","megabolt","ballbolt","avalanche")`
  - `profile(kind: str) -> dict` — Grundwerte `{"kind","precip": "none|rain|snow|mix","intensity": 0..1,"clouds": 0..1,"sun": 0..1,"fog": 0..1,"lightning": 0|1|2}`.
  - `from_api(code: int, temp_c: float, wind_kmh: float, wind_dir: float) -> dict` — Profil + `wind` (−1..1) + `temp` + `frost` (temp ≤ 0).
  - `mood_value(kd, ref_kd, matches, live, low=None, high=None) -> float` (−1..1).
  - `mood_precip(kd, low) -> str | None` — `"drizzle"`, `"rain"` oder None.
  - `apply_mood(state: dict, mood: float, strength: float, precip: str | None) -> dict`.

- [ ] **Step 1: Tests schreiben**

```python
def test_wmo_codes_map_to_kinds():
    assert from_api(0, 12, 5, 270)["kind"] == "clear"
    assert from_api(3, 12, 5, 270)["kind"] == "cloudy"
    assert from_api(45, 5, 5, 270)["kind"] == "fog"
    assert from_api(53, 8, 5, 270)["kind"] == "drizzle"
    assert from_api(63, 8, 5, 270)["kind"] == "rain"
    assert from_api(81, 8, 5, 270)["kind"] == "rain"
    assert from_api(67, 0, 5, 270)["kind"] == "sleet"
    assert from_api(73, -3, 10, 270)["kind"] == "snow"
    assert from_api(75, -3, 45, 270)["kind"] == "blizzard"   # starker Schnee + Wind ≥ 40
    assert from_api(95, 20, 30, 270)["kind"] == "storm"
    assert from_api(1, 31, 5, 270)["kind"] == "heat"         # klar + ≥ 30 °C

def test_frost_and_wind():
    s = from_api(0, -0.5, 25, 270)            # Westwind weht nach rechts
    assert s["frost"] is True and s["wind"] == 0.5
    assert from_api(0, 3, 50, 90)["wind"] == -1.0

def test_mood_neutral_without_live_session_or_few_rounds():
    assert mood_value(3.0, 1.0, 10, live=False) == 0
    assert mood_value(3.0, 1.0, 2, live=True) == 0
    assert mood_value(3.0, 0, 10, live=True) == 0           # kein Referenzwert

def test_mood_relative_and_custom_bounds():
    assert mood_value(0.5, 1.0, 5, True) == -1               # ≤ 0.75 × ref
    assert mood_value(1.5, 1.0, 5, True) == 1                # ≥ 1.25 × ref
    assert mood_value(1.0, 1.0, 5, True) == 0
    assert mood_value(1.5, 9.9, 5, True, low=1.0, high=2.0) == 0

def test_mood_brings_rain_but_never_storm():
    assert mood_precip(0.9, 1.0) == "drizzle"
    assert mood_precip(0.7, 1.0) == "rain"                    # ≤ 0.75 × low
    assert mood_precip(1.1, 1.0) is None
    s = apply_mood(from_api(0, 15, 5, 270), -1, 1.0, "rain")
    assert s["kind"] == "rain" and s["lightning"] == 0

def test_good_mood_keeps_snow_but_adds_sun():
    base = from_api(73, -3, 10, 270)
    s = apply_mood(base, 1, 1.0, None)
    assert s["kind"] == "snow" and s["precip"] == "snow"
    assert s["sun"] > base["sun"] and s["clouds"] < base["clouds"]

def test_strength_zero_is_pure_weather():
    base = from_api(3, 12, 5, 270)
    assert apply_mood(base, -1, 0, "rain") == base
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `python -m pytest tests/fx/test_weather.py -q`
Expected: FAIL (ImportError `fx.weather`)

- [ ] **Step 3: `fx/weather.py` implementieren**

WMO-Abbildung: 0–1 clear, 2–3 cloudy, 45/48 fog, 51–55 drizzle, 56–57/66–67 sleet, 61–65/80–82 rain (65/82 → intensity 0.85), 71–77/85–86 snow (75/86 + Wind ≥ 40 km/h → blizzard), 95–99 storm; clear/cloudy mit ≥ 30 °C → heat. Wind: `min(1, kmh/50)`, Vorzeichen + bei Richtung 180–360° (aus Westen), sonst −; auf 2 Nachkommastellen runden. Stimmung: ohne `low`/`high` gilt `low = 0.75·ref`, `high = 1.25·ref`; linear zwischen −1 und 1 um die Mitte. `apply_mood` mit `e = mood·strength`: e > 0 → `clouds·(1−0.7e)`, `sun = max(sun, 0.6e)` bzw. `max(sun, e)` ohne Niederschlag; e < 0 → `clouds + 0.6|e|`, `fog + 0.4|e|`, `sun·(1−|e|)`, alles auf 0..1 begrenzt; `precip` setzt nur bei trockener Grundlage `drizzle`/`rain` (dessen Profil) ein, nie `storm`, `lightning` bleibt 0. `strength == 0` → unverändertes Dict zurück.

- [ ] **Step 4: Test laufen lassen, muss grün sein**

Run: `python -m pytest tests/fx/test_weather.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fx/weather.py tests/fx/test_weather.py
git commit -m "feat(weather): Wetterzustände, API-Abbildung und K/D-Stimmung"
```

---

### Task 2: Übersteuerungen speichern (Haltezeit, Mindestdauer, Neustartfest)

**Files:**
- Create: `fx/weather_db.py`
- Test: `tests/fx/test_weather_db.py`

**Interfaces:**
- Consumes: `KINDS` aus Task 1.
- Produces:
  - `SCHEMA`, `PG_SCHEMA` — Tabelle `fx_weather_state(tenant_id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)`.
  - `init_schema(conn)`
  - `MIN_HOLD = 15`
  - `set_override(conn, tenant_id, kind, hold, now: float) -> None` — `hold` 0 = unbegrenzt.
  - `clear_override(conn, tenant_id) -> None`
  - `current_override(conn, tenant_id, now: float) -> dict | None` — `{"kind", "since", "until": float|None}`; befördert fällige `pending`, löscht abgelaufene.

- [ ] **Step 1: Tests schreiben**

```python
def test_override_holds_then_expires(conn):
    set_override(conn, 1, "storm", 150, now=1000)
    assert current_override(conn, 1, 1100)["kind"] == "storm"
    assert current_override(conn, 1, 1151) is None

def test_second_command_within_min_hold_waits_and_latest_wins(conn):
    set_override(conn, 1, "storm", 150, now=1000)
    set_override(conn, 1, "blizzard", 150, now=1005)
    set_override(conn, 1, "sun", 150, now=1008)            # ungültig → ignoriert
    set_override(conn, 1, "fog", 150, now=1010)
    assert current_override(conn, 1, 1012)["kind"] == "storm"
    o = current_override(conn, 1, 1015)
    assert o["kind"] == "fog" and o["since"] == 1015 and o["until"] == 1165

def test_after_min_hold_replaces_immediately(conn):
    set_override(conn, 1, "storm", 150, now=1000)
    set_override(conn, 1, "snow", 150, now=1020)
    assert current_override(conn, 1, 1020)["kind"] == "snow"

def test_forced_survives_and_auto_clears(conn):
    set_override(conn, 1, "storm", 0, now=1000)
    assert current_override(conn, 1, 10**9)["until"] is None
    clear_override(conn, 1)
    assert current_override(conn, 1, 1001) is None

def test_tenants_are_separate(conn):
    set_override(conn, 1, "storm", 0, now=1000)
    assert current_override(conn, 2, 1001) is None
```

`conn`-Fixture wie in `tests/fx/test_season_db.py` (sqlite `:memory:` + `init_schema`).

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `python -m pytest tests/fx/test_weather_db.py -q`
Expected: FAIL (ImportError)

- [ ] **Step 3: `fx/weather_db.py` implementieren** — `data` ist JSON `{"kind","since","until","pending": {"kind","hold","at"}|null}`. Upsert per `INSERT … ON CONFLICT(tenant_id) DO UPDATE` (läuft auf sqlite ≥ 3.24 und Postgres). Ungültige `kind` ignorieren (kein Fehler, kein Schreiben).

- [ ] **Step 4: Test laufen lassen, muss grün sein**

Run: `python -m pytest tests/fx/test_weather_db.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fx/weather_db.py tests/fx/test_weather_db.py
git commit -m "feat(weather): Übersteuerungen mit Haltezeit und Mindestdauer speichern"
```

---

### Task 3: Open-Meteo-Anbindung (Ort suchen, aktuelles Wetter, Cache)

**Files:**
- Create: `fx/weather_api.py`
- Test: `tests/fx/test_weather_api.py`

**Interfaces:**
- Consumes: `from_api` aus Task 1.
- Produces:
  - `geocode(query: str) -> dict | None` — `{"lat","lon","label"}`, Label = „Name, Region, Land“.
  - `current(tenant_id: int, lat: float, lon: float, now: float | None = None) -> dict | None` — Ergebnis von `from_api(...)` oder None.
  - `reset_cache()` für Tests.

- [ ] **Step 1: Tests schreiben** (Netz per `monkeypatch` auf `fx.weather_api._fetch_json(url) -> dict` ersetzen)

```python
def test_current_maps_and_caches(monkeypatch):
    calls = []
    def fake(url):
        calls.append(url)
        return {"current": {"weather_code": 63, "temperature_2m": 7.5,
                            "wind_speed_10m": 20, "wind_direction_10m": 250}}
    monkeypatch.setattr(weather_api, "_fetch_json", fake)
    assert current(1, 52.5, 13.4, now=0)["kind"] == "rain"
    current(1, 52.5, 13.4, now=500)                      # < 10 min → Cache
    assert len(calls) == 1
    current(1, 52.5, 13.4, now=700)                      # > 10 min → neu
    assert len(calls) == 2

def test_failure_keeps_last_good_for_an_hour(monkeypatch):
    monkeypatch.setattr(weather_api, "_fetch_json", lambda url: {"current": {
        "weather_code": 0, "temperature_2m": 10, "wind_speed_10m": 0, "wind_direction_10m": 0}})
    current(1, 1, 1, now=0)
    def boom(url): raise OSError("down")
    monkeypatch.setattr(weather_api, "_fetch_json", boom)
    assert current(1, 1, 1, now=700)["kind"] == "clear"
    assert current(1, 1, 1, now=3700) is None

def test_cache_is_per_tenant(monkeypatch): ...   # Tenant 2 löst eigenen Abruf aus

def test_geocode_label(monkeypatch):
    monkeypatch.setattr(weather_api, "_fetch_json", lambda url: {"results": [
        {"latitude": 50.1, "longitude": 8.7, "name": "Frankfurt am Main",
         "admin1": "Hessen", "country": "Deutschland"}]})
    assert geocode("Frankfurt") == {"lat": 50.1, "lon": 8.7,
                                    "label": "Frankfurt am Main, Hessen, Deutschland"}

def test_geocode_nothing_found(monkeypatch):
    monkeypatch.setattr(weather_api, "_fetch_json", lambda url: {})
    assert geocode("xyzzy") is None
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `python -m pytest tests/fx/test_weather_api.py -q`
Expected: FAIL

- [ ] **Step 3: `fx/weather_api.py` implementieren** — `_fetch_json` via `urllib.request.urlopen(url, timeout=5)`. Forecast-URL `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m`, Geocoding `https://geocoding-api.open-meteo.com/v1/search?name=…&count=1&language=de`. Cache je `tenant_id` als `{"at", "value"}` im Modul-Dict mit Lock: frisch < 600 s, nach Fehler gilt der letzte Wert bis 3600 s. Fehler loggen ohne Koordinaten.

- [ ] **Step 4: Test laufen lassen, muss grün sein**

Run: `python -m pytest tests/fx/test_weather_api.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fx/weather_api.py tests/fx/test_weather_api.py
git commit -m "feat(weather): Open-Meteo-Abruf mit Cache je Tenant"
```

---

### Task 4: K/D-Daten für die Stimmung

**Files:**
- Create: `fx/weather_mood.py`
- Test: `tests/fx/test_weather_mood.py` (lokale Test-Postgres, skippt ohne `OBS_KIT_PG_DSN_TEST` wie `tests/pubg/test_weapon_stats_db.py`)

**Interfaces:**
- Produces: `kd_snapshot(conn, tenant_id: int, now: datetime | None = None) -> dict` — `{"kd": float, "matches": int, "refKd": float | None, "live": bool}`; `conn` ist `SqliteCompatConn`.

- [ ] **Step 1: Tests schreiben** (Matches/Participants wie in `tests/pubg/test_aggregations.py` anlegen, Helper `_p` dort)

```python
def test_session_kd_br_only_all_accounts(pg):
    # Tenant 1, zwei getrackte Accounts, 3 BR-Runden heute (4, 2, 0 Kills, kein Sieg)
    # + 1 Zombie-Runde (zulu_hell-fpp, 30 Kills) + 60-Tage-Historie
    snap = kd_snapshot(pg, 1, now=NOW)
    assert snap["matches"] == 3 and snap["kd"] == 2.0 and snap["live"] is True

def test_not_live_after_four_hours(pg):
    assert kd_snapshot(pg, 1, now=NOW + timedelta(hours=5))["live"] is False

def test_other_tenant_does_not_leak(pg):
    assert kd_snapshot(pg, 2, now=NOW)["matches"] == 0
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `OBS_KIT_PG_DSN_TEST="postgresql://obs_stream:test@127.0.0.1:55433/obs_test" python -m pytest tests/fx/test_weather_mood.py -q`
Expected: FAIL

- [ ] **Step 3: `fx/weather_mood.py` implementieren** — Accounts aus `tracked_players` des Tenants; Session-Start über `pubg.aggregations._session_filter`, BR über `_br_filter("m")`; `refKd` gleiche Formel über `played_at ≥ now − 60 Tage` (None ohne Runden); `live` = jüngstes BR-Match < 4 h vor `now`.

- [ ] **Step 4: Test laufen lassen, muss grün sein** (gleicher Befehl) — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fx/weather_mood.py tests/fx/test_weather_mood.py
git commit -m "feat(weather): Session-K/D als Stimmungsquelle (nur BR, alle Accounts)"
```

---

### Task 5: Befehle und State-Endpoint

**Files:**
- Modify: `fx/commands.py` (Eintrag `"weather"` in `EFFECTS`)
- Modify: `fx/endpoints.py` (Persistenz für `weather`, neue Route `/s/<token>/api/fx/weather/state`)
- Test: `tests/fx/test_weather_endpoint.py`

**Interfaces:**
- Consumes: Task 1–4.
- Produces:
  - Befehle `weather` (`to`: Wahl aus `KINDS`, `hold`: int 0..3600, Standard 150), `auto`, `strike` (`dist`: near/far), `gust`, `spectacle` (`type`: Wahl aus `SPECTACLES`), `set`, `reset`.
  - Settings (`cmd=set` und URL): `mood` float 0..1 (Standard 0.5), `kdlow`/`kdhigh` float 0..20, `fallback` Wahl aus `KINDS`, `lock` Wahl aus `KINDS` oder `off`, `sound` flag, `volume` level, `thunder` level.
  - `GET /s/<token>/api/fx/weather/state?mood=&kdlow=&kdhigh=&fallback=` → `{"state": {…Profil…, "wind", "temp", "frost", "source": "api|fallback|override", "until": float|None, "transition": 25|4}, "now": float}`. Kein Ort, keine Koordinaten in der Antwort.
  - Ort wird gelesen aus `settings`-Zeile `key='weather.location'` (JSON `{"lat","lon","label"}`) per `SELECT value FROM settings WHERE tenant_id=? AND key=?`.

- [ ] **Step 1: Tests schreiben** (Flask-App wie `_app` in `tests/fx/test_season_db.py`, sqlite mit `settings`- und `fx_weather_state`-Tabelle; `weather_api.current` und `weather_mood.kd_snapshot` per monkeypatch)

```python
def test_weather_command_sets_override_and_state_reports_it(client, conn):
    assert client.get("/s/t/api/fx/weather?cmd=weather&to=storm").json["ok"]
    st = client.get("/s/t/api/fx/weather/state").json["state"]
    assert st["kind"] == "storm" and st["source"] == "override" and st["transition"] == 4

def test_auto_returns_to_api(client, monkeypatch): ...      # cmd=auto → source "api"

def test_no_location_uses_fallback(client):
    st = client.get("/s/t/api/fx/weather/state?fallback=snow").json["state"]
    assert st["kind"] == "snow" and st["source"] == "fallback"

def test_api_down_uses_fallback(client, monkeypatch): ...   # current() → None

def test_state_never_contains_location(client, conn):
    # Ort gesetzt → Antworttext enthält weder lat/lon-Werte noch Label
    ...

def test_mood_params_reach_resolution(client, monkeypatch):
    # kd 0.7 bei kdlow=1 → Regen trotz klarer API; mood=0 → klar
    ...

def test_spectacle_and_strike_are_queued_not_persisted(client): ...
def test_unknown_weather_kind_is_rejected(client): ...      # cmd=weather&to=hail → 400
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `python -m pytest tests/fx/test_weather_endpoint.py -q`
Expected: FAIL

- [ ] **Step 3: Implementieren** — `weather_db.persist`-Hook in `_PERSISTENT` (schreibt bei `weather`/`auto`, leitet alle Befehle weiter); Route `state` nutzt `_with_conn`, `weather_api.current` mit Tenant-Ort, `weather_mood.kd_snapshot`, `mood_value`/`mood_precip`/`apply_mood`, darüber `current_override`. `transition` = 4 bei Übersteuerung, sonst 25. Antwort mit `no-store`. Fehler in API/Mood loggen und neutral weiterrechnen.

- [ ] **Step 4: Test laufen lassen, muss grün sein** — dazu `tests/fx/test_commands.py` mitlaufen lassen.

Run: `python -m pytest tests/fx/test_weather_endpoint.py tests/fx/test_commands.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fx/commands.py fx/endpoints.py tests/fx/test_weather_endpoint.py
git commit -m "feat(weather): Befehle und Zustands-Endpoint für die Wetter-Source"
```

---

### Task 6: Ort in den Einstellungen

**Files:**
- Modify: `app/views_app.py` (`settings()`), `app/templates/settings.html`
- Test: `tests/app/test_weather_location.py` (lokale Test-Postgres, weil `set_setting`/`get_setting` aus `pubg.db_pg` `%s`-SQL nutzen; skippt ohne `OBS_KIT_PG_DSN_TEST`)

**Interfaces:**
- Consumes: `geocode` aus Task 3.
- Produces: Formfeld `weather_place` (Text) und Checkbox `weather_clear`; speichert `set_setting(conn, tenant, "weather.location", json.dumps({...}))` bzw. löscht den Eintrag; Fehler → Redirect `?weather_err=not_found`. `prefs["weather_label"]` für die Anzeige.

- [ ] **Step 1: Test schreiben** — `save_weather_location(conn, tenant_id, place, clear) -> str | None` (Fehlercode oder None) in `app/views_app.py` testen: gefundener Ort speichert JSON mit Label; nicht gefunden → `"not_found"`, nichts gespeichert; `clear` löscht.
- [ ] **Step 2: Test laufen lassen, muss fehlschlagen** — `OBS_KIT_PG_DSN_TEST="postgresql://obs_stream:test@127.0.0.1:55433/obs_test" python -m pytest tests/app/test_weather_location.py -q`
- [ ] **Step 3: Implementieren** — Abschnitt „Weather“ in `settings.html`: Label „Location for live weather“, Hinweis „Only used on the server to fetch the weather. Never shown on stream.“, aktuelles Label anzeigen, Fehler mit `aria-invalid` + `aria-describedby`.
- [ ] **Step 4: Test laufen lassen, muss grün sein**
- [ ] **Step 5: Commit** — `feat(weather): Ort für das Live-Wetter in den Einstellungen`

---

### Task 7: Darstellungs-Baustein und Wetter-Overlay

**Files:**
- Create: `js/weather-kit.js`, `effects/weather.html`
- Reuse: Partikel-, Wind- und Blitzcode aus `effects/rain.html`, Flocken aus `effects/snow.html` (verschieben, nicht kopieren — `rain.html`/`snow.html` werden in Task 10 zu Umleitungen)

**Interfaces:**
- Consumes: State-Antwort aus Task 5, Befehle `strike`, `gust`, `weather`, `auto`, `set`, `reset` aus der Poll-Warteschlange.
- Produces (für Task 8, 9 und spätere Pläne): `window.WeatherKit.create(container: HTMLElement, opts) -> kit` mit
  - `kit.setState(state: object, transitionSecs: number)`
  - `kit.strike(dist?: "near"|"far")`, `kit.gust()`
  - `kit.on(event: "strike"|"gust", fn)`
  - `kit.counts() -> {rain, snow}` (für Prüfung im Tune-Modus)
  - reine Hilfsfunktion `WeatherKit.mix(from, to, t) -> object` (Zahlen linear, `precip` schaltet bei t ≥ 0.5)

Schritte:

- [ ] **Step 1: `WeatherKit.mix` + Anteilsrechnung prüfen** — node-Check: `node -e "global.window={};require('./js/weather-kit.js');const m=window.WeatherKit.mix({intensity:1,precip:'rain'},{intensity:0,precip:'snow'},0.25);if(m.intensity!==0.75||m.precip!=='rain')process.exit(1)"` — Expected: Exit 0 (vorher Fehler, weil Datei fehlt).
- [ ] **Step 2: Baustein bauen** — Canvas-Ebenen hinten/mitte/vorne; Partikelarten Regen, Niesel (feine kurze Striche), Schnee, Schneeregen (Mischung), Blizzard (viel Schnee + starker Wind); Übergang verschiebt Spawn-Anteile über `transitionSecs`, bestehende Partikel fallen zu Ende. Himmel-Ebene nur am Rand: Wolken-/Nebel-Vignette oben und an den Seiten, Nebelband unten, Sonnenstrahlen aus der oberen Ecke, Hitzeflimmern unten — **Bildmitte (mittlere 60 % × 60 %) bleibt bei jeder Stimmung ohne Abdunklung**. Blitz und Böe aus `rain.html`. Rand-Fade für alle Partikel.
- [ ] **Step 3: `effects/weather.html`** — liest URL-Settings (Task 5), pollt `/s/<token>/api/fx/weather/state` alle 15 s (sofort nach `weather`/`auto` aus der Warteschlange) und `/api/fx/weather/poll` jede Sekunde wie `rain.html`; `lock=<kind>` ignoriert den Server-Zustand und zeigt das feste Profil; Tune-Modus (`tune=1`) mit Zustand, Quelle, Restzeit, Partikelzahlen. `prefers-reduced-motion` reduziert Partikel auf 25 %.
- [ ] **Step 4: Prüfen** — `node -e` Syntax-Check beider Dateien; im Browser lokal `effects/weather.html?lock=rain&tune=1`, dann `lock=snow`, `lock=storm`, und über die Konsole `kit.setState(...)` Regen → Schnee in 25 s: Mischphase sichtbar, kein Tropfen wird zur Flocke, Bildmitte bei Stimmung −1 nicht dunkler.
- [ ] **Step 5: Commit** — `feat(weather): Wetter-Baustein und Overlay mit weichen Übergängen`

---

### Task 8: Spektakel

**Files:**
- Modify: `js/weather-kit.js` (`kit.spectacle(type: string)`), `effects/weather.html` (Befehl `spectacle`)

- [ ] **Step 1: Prüfung vorbereiten** — Tune-Modus bekommt vier Buttons (`tsunami`, `megabolt`, `ballbolt`, `avalanche`).
- [ ] **Step 2: Bauen** — jedes Spektakel 6–12 s, läuft über der Lage, ändert keinen Zustand; zweites Spektakel während eines laufenden startet erst nach dessen Ende (höchstens eins wartend):
  - `tsunami`: Welle rollt von einer zufälligen Seite durch die untere Bildhälfte, Gischt, Rand-Fade.
  - `megabolt`: 12–20 Blitze in ~5 s an wechselnden Stellen, Bildblitz gedämpft (keine Vollbild-Flashes über 0.35 Deckkraft).
  - `ballbolt`: leuchtende Kugel auf geschwungener Bahn quer durchs Bild, Funken, blendet am Rand ein/aus.
  - `avalanche`: Schneemasse mit Pulverwolke rollt von oben rechts nach unten links, verwischt am Ende.
  - Reduced Motion: kurzer Farb-Blend statt Bewegung.
- [ ] **Step 3: Prüfen** — jeder Button im Tune-Modus, auch zweimal schnell hintereinander; keine Kante mit hartem Popping.
- [ ] **Step 4: Commit** — `feat(weather): Spektakel Tsunami, Mega-Blitze, Kugelblitz und Lawine`

---

### Task 9: Ton im Browser (optional, Standard aus)

**Files:**
- Create: `js/weather-audio.js` (Synth aus `rain.html` verschoben, Schnee/Wind-Rauschen ergänzt)
- Modify: `effects/weather.html`

- [ ] **Step 1: Bauen** — drei Pegel: Dauerwetter (`volume`, nur wenn `sound=1`, Standard stumm), Ereignisse (Übersteuerung hörbar, blendet am Ende über 3 s aus), Akzente (Blitz/Donner mit Entfernungsverzögerung, Böe, Spektakel-Rauschen) über `thunder`. API-/Stimmungswechsel ohne eigenen Ton.
- [ ] **Step 2: Prüfen** — `sound=0` erzeugt keinen `AudioContext`; `sound=1` im Browser hörbar.
- [ ] **Step 3: Commit** — `feat(weather): optionaler Ton, standardmäßig aus`

---

### Task 10: Umleitung Rain/Snow, Katalog, Live control

**Files:**
- Modify: `effects/rain.html`, `effects/snow.html` (werden kleine Umleitungsseiten)
- Modify: `effects/weather.html` (Kanal `chan=rain`: pollt zusätzlich `/api/fx/rain/poll` und versteht `start`/`stop`/`strike`/`gust`/`set`/`reset`)
- Modify: `overlay_app/overlay_catalog.py` (Eintrag `weather.html`; `rain.html`/`snow.html` mit `"hidden": True`, `list_dir_sources` überspringt sie)
- Test: `tests/fx/test_catalog_controls.py`, `tests/fx/test_weather_redirect.py`

**Interfaces:**
- Produces: Umleitungsregel `rain.html?intensity=I&wind=W&lightning=L&color=C&sound=S&volume=V&thunder=T` → `weather.html?lock=<light→drizzle | medium/heavy→rain | storm→storm>&wind=W&lightning=L&…&chan=rain`; `snow.html?…` → `weather.html?lock=snow`. Token-Pfad bleibt erhalten (`location.replace` mit relativem Pfad).

- [ ] **Step 1: Tests schreiben**

```python
def test_weather_has_controls_and_live_keys():
    src = {e["key"]: e for e in list_dir_sources(".", "effects", switches_map=EFFECT_META)}["weather"]
    assert [c["q"] for c in src["controls"]] == [
        "cmd=auto", "cmd=weather&to=clear&hold=0", "cmd=weather&to=rain&hold=0",
        "cmd=weather&to=storm&hold=0", "cmd=weather&to=snow&hold=0",
        "cmd=weather&to=blizzard&hold=0", "cmd=weather&to=fog&hold=0",
        "cmd=strike", "cmd=gust",
        "cmd=spectacle&type=tsunami", "cmd=spectacle&type=megabolt",
        "cmd=spectacle&type=ballbolt", "cmd=spectacle&type=avalanche"]
    assert {"mood", "kdlow", "kdhigh", "fallback", "lock"} <= set(src["live"])

def test_rain_and_snow_are_hidden():
    keys = {s["key"] for s in list_dir_sources(".", "effects", switches_map=EFFECT_META)}
    assert "rain" not in keys and "snow" not in keys and "weather" in keys

def test_redirect_pages_point_to_weather():
    # rain.html enthält das Mapping light→drizzle, storm→storm und chan=rain;
    # snow.html enthält lock=snow (Textprüfung der Umleitungsseiten)
```

Im bestehenden `test_live_keys_are_settable_switches` `"rain"` durch `"weather"` ersetzen (Rain ist danach ausgeblendet).

Plus: `commands` des Weather-Eintrags listet Chat-Beispiele `cmd=weather&to=storm` („!thunderstorm: storm for 2.5 min“) etc. Labels englisch, Icons Material Symbols (`auto_mode`, `sunny`, `rainy`, `thunderstorm`, `ac_unit`, `severe_cold`, `foggy`, `bolt`, `air`, `tsunami`, `flash_on`, `blur_circular`, `landslide`).

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen** — `python -m pytest tests/fx/test_catalog_controls.py tests/fx/test_weather_redirect.py -q`
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: Test laufen lassen, muss grün sein** (gleicher Befehl)
- [ ] **Step 5: Commit** — `feat(weather): Rain und Snow leiten auf die Wetter-Source um`

---

### Task 11: README, Prod-Migration, Deploy, Prüfung

**Files:**
- Modify: `README.md` (neuer Abschnitt „Weather“: Ort einstellen, Schichten, Stimmungsgrenzen, Chat-Befehle mit Streamer.bot-Beispielen, Spektakel, Ton über Streamer.bot; Rain/Snow-Abschnitte verweisen darauf)

- [ ] **Step 1: README schreiben und committen** — `docs(weather): README-Abschnitt zur Wetter-Source`
- [ ] **Step 2: Push** — `git push`
- [ ] **Step 3: Prod-Tabelle anlegen** — `PG_SCHEMA` aus `fx/weather_db.py` per `ssh -i ~/.ssh/obskit root@31.70.95.217 "LC_ALL=C.UTF-8 sudo -u postgres psql -d obs_stream_kit -v ON_ERROR_STOP=1 -c 'SET search_path = obs' -c '<PG_SCHEMA>' -c 'GRANT SELECT, INSERT, UPDATE, DELETE ON fx_weather_state TO obs_stream'"` — Expected: `CREATE TABLE`, `GRANT`.
- [ ] **Step 4: Deploy** — `cd /opt/obs-stream-kit && git pull --ff-only && systemctl restart obs-stream-kit obs-overlays obs-api`
- [ ] **Step 5: Prüfen auf Prod** — für Tenant 1 und Tenant 2: `…/api/fx/weather/state` liefert `source: fallback` ohne Ort; nach Ort-Eintrag (Tenant 1) `source: api`; `cmd=weather&to=storm` → `override`, nach `cmd=auto` zurück; alte `rain.html`-Token-URL landet auf `weather.html?lock=…`; `/api/fx/rain?cmd=strike` erreicht das umgeleitete Overlay. Antwort enthält keinen Ort.
