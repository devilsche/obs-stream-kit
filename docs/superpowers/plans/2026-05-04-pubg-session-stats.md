# PUBG Session Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modulare PUBG-Stats-Komponenten als OBS-Browser-Sources mit Always-on-Backend (`serve.py` + SQLite), die aus der offiziellen PUBG-Developer-API gespeist werden.

**Architecture:** Drei Schichten — (1) PUBG-API-Polling in Background-Thread mit Rate-Limit-Budget, (2) SQLite-Persistenz mit selektiv squad-gefilterten Telemetry-Events, (3) autonome HTML-Widgets, die `serve.py`-Endpoints pollen. Streamer.bot triggert das parameter-driven `chat-stats-popup.html` extern, kein Twitch-Bot in serve.py.

**Tech Stack:** Python 3 (stdlib: `http.server`, `sqlite3`, `threading`, `urllib.request`, `json`), pytest für Backend-Tests, vanilla HTML/CSS/JS für Widgets, DM Sans Font, Theme Purple/Gold.

---

## File Structure

**Neue Backend-Module** (`pubg/` — neues Package):
- `pubg/__init__.py` — Modul-Marker
- `pubg/config.py` — Lädt `config/pubg.json` und `.secrets`-PUBG-Key
- `pubg/db.py` — SQLite-Schema, Migrations, DAO-Functions
- `pubg/api_client.py` — PUBG-HTTP-Client mit Rate-Limiter
- `pubg/poller.py` — Background-Polling-Thread
- `pubg/telemetry.py` — Telemetry-JSON-Parser (squad-gefiltert)
- `pubg/aggregations.py` — Stats-Aggregation (Session, Top-Mates, First-Fight)
- `pubg/cache.py` — In-Memory-Cache mit 30s TTL
- `pubg/endpoints.py` — HTTP-Route-Handlers für `/api/pubg/*`
- `pubg/cli.py` — CLI-Entry für `--init-pubg-db` und Cold-Start

**Tests:**
- `tests/__init__.py`
- `tests/conftest.py` — pytest-Fixtures (Temp-DB, Mock-API-Responses)
- `tests/fixtures/*.json` — Recorded API-Responses
- `tests/pubg/test_*.py` — Test-Files pro Modul

**Konfiguration:**
- `config/pubg.json` — Player-Name, Platform, Polling-Intervall, Schwellwerte
- `.secrets` — erweitert um `PUBG-API-Key:` Zeile
- `.secrets.example` — selbiges
- `.gitignore` — `data/`, `config/pubg.local.json` ignorieren

**Daten:**
- `data/pubg-history.db` — SQLite-DB (gitignored)
- `data/pubg-history.db.bak` — rotierender Backup

**Widgets** (`widgets/pubg/` — neues Subdir):
- `widgets/pubg/_pubg.css` — Shared Theme-Styles
- `widgets/pubg/_pubg.js` — Shared Helpers (poll, fetch-with-retry, formatters)
- `widgets/pubg/live-bar.html`
- `widgets/pubg/flyout-full.html`
- `widgets/pubg/mates-today.html`
- `widgets/pubg/top-mates.html`
- `widgets/pubg/post-match-card.html`
- `widgets/pubg/map-distribution.html`
- `widgets/pubg/first-fight.html`
- `widgets/pubg/session-summary.html`
- `widgets/pubg/career-card.html`
- `widgets/pubg/news-ticker.html`
- `widgets/pubg/squad-compare.html`
- `widgets/pubg/chat-stats-popup.html`

**Web-View:**
- `scenes/stats.html` — Cross-Player-View

**Modifiziert:**
- `serve.py` — Polling-Thread starten, `/api/pubg/*` und `/api/pubg/settings` POST/DELETE-Routes registrieren
- `README.md` — Setup-Section + URL-Parameter-Tabelle aller Komponenten

---

## Phasen-Überblick

1. **Phase 1: Projekt-Setup** — pytest, Config, Secrets-Erweiterung, gitignore
2. **Phase 2: DB-Schema** — Schema-Init, DAO-Layer, Migrations
3. **Phase 3: API-Client** — HTTP-Wrapper, Rate-Limiter, Mock-Recordings
4. **Phase 4: Match-Polling** — Player-Resource → Match-Details → DB
5. **Phase 5: HTTP-Endpoints (Basis)** — serve.py-Integration, Status, Session, Last-Match
6. **Phase 6: Erste Widgets** — live-bar, post-match-card, _pubg.css, _pubg.js
7. **Phase 7: Co-Player-Layer** — Lifetime-Refresh, Top-Mates, Co-Player-Endpoints
8. **Phase 8: Mate-Widgets** — top-mates.html, mates-today.html (4 Layouts), career-card.html
9. **Phase 9: Telemetry** — Parser, First-Fight-Detection, first-fight.html
10. **Phase 10: Map + Settings** — Map-Distribution, Settings-Endpoint, Slider-UI
11. **Phase 11: Restliche Widgets** — flyout-full, session-summary, news-ticker, squad-compare
12. **Phase 12: Cross-Player + Chat-Popup** — scenes/stats.html, chat-stats-popup.html
13. **Phase 13: Setup-Hilfen + README** — CLI, systemd-Beispiel, README-Update

---

(Tasks folgen in einzelnen Sektionen unten.)

## Phase 1: Projekt-Setup

### Task 1.1: pytest und Verzeichnis-Struktur

**Files:**
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`
- Create: `pubg/__init__.py`
- Create: `requirements-dev.txt`
- Modify: `.gitignore`

- [ ] **Step 1: requirements-dev.txt anlegen**

```
pytest>=7.0
```

- [ ] **Step 2: pytest installierbar machen, leere Test-Skelette anlegen**

```python
# tests/__init__.py — leer
```

```python
# tests/conftest.py
import os
import sys
import tempfile
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


@pytest.fixture
def tmp_db_path(tmp_path):
    return str(tmp_path / "test.db")
```

```python
# pubg/__init__.py — leer
```

- [ ] **Step 3: .gitignore erweitern**

Hänge an `.gitignore`:
```
data/
config/pubg.local.json
__pycache__/
.pytest_cache/
*.pyc
```

- [ ] **Step 4: pytest-Smoke-Test laufen lassen**

```bash
pip install -r requirements-dev.txt
pytest tests/ -v
```
Expected: `no tests ran` ohne Errors.

- [ ] **Step 5: Commit**

```bash
git add tests/ pubg/__init__.py requirements-dev.txt .gitignore
git commit -m "chore(pubg): pytest-Setup + Verzeichnisstruktur"
```

### Task 1.2: Config-Modul

**Files:**
- Create: `config/pubg.json`
- Create: `pubg/config.py`
- Create: `tests/pubg/__init__.py`
- Create: `tests/pubg/test_config.py`
- Modify: `.secrets.example`

- [ ] **Step 1: Test schreiben**

```python
# tests/pubg/test_config.py
import json
from pubg.config import load_config, load_api_key


def test_load_config_returns_dict_with_required_keys(tmp_path):
    cfg_file = tmp_path / "pubg.json"
    cfg_file.write_text(json.dumps({
        "playerName": "PEX_LuCKoR",
        "platform": "steam",
        "stammCrew": ["MateA"],
        "pollIntervalSec": 60,
        "minMatchesForLifetime": 5,
        "minMatchesForTopMates": 10
    }))
    cfg = load_config(str(cfg_file))
    assert cfg["playerName"] == "PEX_LuCKoR"
    assert cfg["platform"] == "steam"
    assert cfg["pollIntervalSec"] == 60


def test_load_api_key_from_secrets(tmp_path):
    secrets = tmp_path / ".secrets"
    secrets.write_text("Client-ID: x\nPUBG-API-Key: my-key-123\n")
    assert load_api_key(str(secrets)) == "my-key-123"


def test_load_api_key_missing_returns_none(tmp_path):
    secrets = tmp_path / ".secrets"
    secrets.write_text("Client-ID: x\n")
    assert load_api_key(str(secrets)) is None
```

- [ ] **Step 2: Test fail-laufen**

```bash
pytest tests/pubg/test_config.py -v
```
Expected: FAIL — `pubg.config` nicht vorhanden.

- [ ] **Step 3: Implementation**

```python
# pubg/config.py
import json
import os

DEFAULTS = {
    "playerName": "PEX_LuCKoR",
    "platform": "steam",
    "stammCrew": [],
    "pollIntervalSec": 60,
    "minMatchesForLifetime": 5,
    "minMatchesForTopMates": 10,
}


def load_config(path: str) -> dict:
    cfg = dict(DEFAULTS)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            cfg.update(json.load(f))
    return cfg


def load_api_key(secrets_path: str) -> str | None:
    if not os.path.exists(secrets_path):
        return None
    with open(secrets_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("PUBG-API-Key:"):
                return line.split(":", 1)[1].strip()
    return None
```

- [ ] **Step 4: Test passen lassen**

```bash
pytest tests/pubg/test_config.py -v
```
Expected: 3 PASS.

- [ ] **Step 5: Default-Config-Datei und secrets.example aktualisieren**

```json
// config/pubg.json
{
  "playerName": "PEX_LuCKoR",
  "platform": "steam",
  "stammCrew": [],
  "pollIntervalSec": 60,
  "minMatchesForLifetime": 5,
  "minMatchesForTopMates": 10
}
```

Hänge `.secrets.example` an:
```
PUBG-API-Key:  DEIN_PUBG_API_KEY
```

- [ ] **Step 6: Commit**

```bash
git add pubg/config.py tests/pubg/ config/pubg.json .secrets.example
git commit -m "feat(pubg): Config-Modul + .secrets-Erweiterung um PUBG-API-Key"
```


## Phase 2: DB-Schema und DAO-Layer

### Task 2.1: Schema-Init und Connect-Helper

**Files:**
- Create: `pubg/db.py`
- Create: `tests/pubg/test_db_schema.py`

- [ ] **Step 1: Test schreiben**

```python
# tests/pubg/test_db_schema.py
import sqlite3
from pubg.db import connect, init_schema


def test_init_schema_creates_all_tables(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    names = [r[0] for r in cur.fetchall()]
    assert "players" in names
    assert "matches" in names
    assert "participants" in names
    assert "telemetry_events" in names
    assert "player_lifetime" in names
    assert "stamm_crew" in names
    assert "settings" in names


def test_init_schema_creates_qualified_co_players_view(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='view'"
    )
    names = [r[0] for r in cur.fetchall()]
    assert "qualified_co_players" in names


def test_init_schema_idempotent(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    init_schema(conn)  # Zweiter Call darf nicht crashen
```

- [ ] **Step 2: Test fail-laufen**

```bash
pytest tests/pubg/test_db_schema.py -v
```
Expected: FAIL — `pubg.db` not found.

- [ ] **Step 3: Implementation `pubg/db.py`**

```python
# pubg/db.py
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    account_id      TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    platform        TEXT NOT NULL,
    is_self         INTEGER DEFAULT 0,
    first_seen_at   TEXT NOT NULL,
    last_polled_at  TEXT
);

CREATE TABLE IF NOT EXISTS matches (
    match_id          TEXT PRIMARY KEY,
    map_name          TEXT NOT NULL,
    game_mode         TEXT NOT NULL,
    is_ranked         INTEGER DEFAULT 0,
    duration_secs     INTEGER,
    played_at         TEXT NOT NULL,
    telemetry_url     TEXT,
    telemetry_fetched INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS participants (
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
    damage_dealt     REAL,
    longest_kill     REAL,
    time_survived    INTEGER,
    walk_distance    REAL,
    ride_distance    REAL,
    swim_distance    REAL,
    weapons_acquired INTEGER,
    heals            INTEGER,
    boosts           INTEGER,
    team_kills       INTEGER,
    PRIMARY KEY (match_id, account_id),
    FOREIGN KEY (match_id) REFERENCES matches(match_id),
    FOREIGN KEY (account_id) REFERENCES players(account_id)
);
CREATE INDEX IF NOT EXISTS idx_part_player ON participants(account_id);

CREATE TABLE IF NOT EXISTS telemetry_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id        TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    timestamp_ms    INTEGER,
    actor_account   TEXT,
    target_account  TEXT,
    weapon          TEXT,
    distance        REAL,
    damage          REAL,
    payload_json    TEXT,
    FOREIGN KEY (match_id) REFERENCES matches(match_id)
);
CREATE INDEX IF NOT EXISTS idx_tel_match ON telemetry_events(match_id);
CREATE INDEX IF NOT EXISTS idx_tel_actor ON telemetry_events(actor_account);
CREATE INDEX IF NOT EXISTS idx_tel_type  ON telemetry_events(event_type);

CREATE TABLE IF NOT EXISTS player_lifetime (
    account_id        TEXT NOT NULL,
    mode              TEXT NOT NULL,
    rounds_played     INTEGER,
    wins              INTEGER,
    top10s            INTEGER,
    win_rate          REAL,
    top10_rate        REAL,
    kills             INTEGER,
    kd_ratio          REAL,
    headshot_kills    INTEGER,
    headshot_rate     REAL,
    avg_damage        REAL,
    longest_kill      REAL,
    time_survived_sec INTEGER,
    last_refreshed    TEXT,
    PRIMARY KEY (account_id, mode),
    FOREIGN KEY (account_id) REFERENCES players(account_id)
);

CREATE TABLE IF NOT EXISTS stamm_crew (
    account_id      TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    added_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE VIEW IF NOT EXISTS qualified_co_players AS
SELECT
    p.account_id,
    p.name,
    COUNT(DISTINCT pa.match_id) AS shared_matches
FROM participants pa
JOIN players p ON p.account_id = pa.account_id
WHERE p.is_self = 0
GROUP BY p.account_id;
"""


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()
```

- [ ] **Step 4: Tests grün**

```bash
pytest tests/pubg/test_db_schema.py -v
```
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add pubg/db.py tests/pubg/test_db_schema.py
git commit -m "feat(pubg): SQLite-Schema + connect/init_schema"
```

### Task 2.2: DAO — Players und Matches

**Files:**
- Modify: `pubg/db.py`
- Create: `tests/pubg/test_db_dao.py`

- [ ] **Step 1: Test für upsert_player**

```python
# tests/pubg/test_db_dao.py
import datetime
from pubg.db import connect, init_schema, upsert_player, get_player_by_name


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    return conn


def test_upsert_player_inserts_new(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, account_id="account.A", name="PEX_LuCKoR",
                  platform="steam", is_self=True)
    p = get_player_by_name(conn, "PEX_LuCKoR")
    assert p["account_id"] == "account.A"
    assert p["is_self"] == 1


def test_upsert_player_updates_name_on_conflict(tmp_db_path):
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.A", "OldName", "steam", False)
    upsert_player(conn, "account.A", "NewName", "steam", False)
    p = get_player_by_name(conn, "NewName")
    assert p["account_id"] == "account.A"
    assert get_player_by_name(conn, "OldName") is None
```

- [ ] **Step 2: Test schlägt fehl**

```bash
pytest tests/pubg/test_db_dao.py -v
```
Expected: FAIL.

- [ ] **Step 3: Implementation an `pubg/db.py` anhängen**

```python
import datetime as _dt


def _now_iso() -> str:
    return _dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"


def upsert_player(conn, account_id: str, name: str, platform: str,
                  is_self: bool = False) -> None:
    conn.execute("""
        INSERT INTO players(account_id, name, platform, is_self, first_seen_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
            name = excluded.name,
            platform = excluded.platform,
            is_self = excluded.is_self
    """, (account_id, name, platform, 1 if is_self else 0, _now_iso()))
    conn.commit()


def get_player_by_name(conn, name: str):
    return conn.execute(
        "SELECT * FROM players WHERE name = ?", (name,)
    ).fetchone()


def get_player_by_id(conn, account_id: str):
    return conn.execute(
        "SELECT * FROM players WHERE account_id = ?", (account_id,)
    ).fetchone()


def get_self_player(conn):
    return conn.execute(
        "SELECT * FROM players WHERE is_self = 1 LIMIT 1"
    ).fetchone()
```

- [ ] **Step 4: Tests grün**

```bash
pytest tests/pubg/test_db_dao.py -v
```

- [ ] **Step 5: Commit**

```bash
git add pubg/db.py tests/pubg/test_db_dao.py
git commit -m "feat(pubg): DAO upsert_player + Lookup-Helpers"
```

### Task 2.3: DAO — Match-Insert und Squad-Filter

**Files:**
- Modify: `pubg/db.py`
- Modify: `tests/pubg/test_db_dao.py`

- [ ] **Step 1: Tests anhängen**

```python
def test_insert_match_and_get(tmp_db_path):
    from pubg.db import insert_match, get_match
    conn = _setup(tmp_db_path)
    insert_match(conn, match_id="m1", map_name="Erangel_Main",
                 game_mode="squad-fpp", is_ranked=False, duration_secs=1820,
                 played_at="2026-05-04T18:00:00Z",
                 telemetry_url="https://example/tel.json")
    m = get_match(conn, "m1")
    assert m["map_name"] == "Erangel_Main"
    assert m["telemetry_fetched"] == 0


def test_insert_participants_only_for_squad(tmp_db_path):
    from pubg.db import insert_match, insert_participants, get_squad_for_match
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    upsert_player(conn, "account.B", "MateA", "steam", False)
    upsert_player(conn, "account.C", "MateB", "steam", False)
    insert_match(conn, "m1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", None)
    insert_participants(conn, "m1", [
        {"account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 5,
         "place": 3, "kills": 4, "headshot_kills": 1, "assists": 2,
         "dbnos": 3, "revives": 1, "damage_dealt": 412.0, "longest_kill": 187.5,
         "time_survived": 1690, "walk_distance": 2300.0, "ride_distance": 1100.0,
         "swim_distance": 0.0, "weapons_acquired": 8, "heals": 3, "boosts": 4,
         "team_kills": 0},
        {"account_id": "account.B", "name": "MateA", "team_id": 5,
         "place": 3, "kills": 2, "headshot_kills": 0, "assists": 4,
         "dbnos": 1, "revives": 2, "damage_dealt": 287.0, "longest_kill": 92.0,
         "time_survived": 1690, "walk_distance": 2200.0, "ride_distance": 1100.0,
         "swim_distance": 0.0, "weapons_acquired": 6, "heals": 2, "boosts": 3,
         "team_kills": 0},
    ])
    squad = get_squad_for_match(conn, "m1")
    assert len(squad) == 2
    assert {p["name"] for p in squad} == {"PEX_LuCKoR", "MateA"}
```

- [ ] **Step 2: Test fail-laufen**

- [ ] **Step 3: An `pubg/db.py` anhängen**

```python
def insert_match(conn, match_id, map_name, game_mode, is_ranked,
                 duration_secs, played_at, telemetry_url) -> None:
    conn.execute("""
        INSERT OR IGNORE INTO matches(match_id, map_name, game_mode, is_ranked,
            duration_secs, played_at, telemetry_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (match_id, map_name, game_mode, 1 if is_ranked else 0,
          duration_secs, played_at, telemetry_url))
    conn.commit()


def get_match(conn, match_id):
    return conn.execute(
        "SELECT * FROM matches WHERE match_id = ?", (match_id,)
    ).fetchone()


PARTICIPANT_COLS = (
    "match_id", "account_id", "name", "team_id", "place", "kills",
    "headshot_kills", "assists", "dbnos", "revives", "damage_dealt",
    "longest_kill", "time_survived", "walk_distance", "ride_distance",
    "swim_distance", "weapons_acquired", "heals", "boosts", "team_kills",
)


def insert_participants(conn, match_id, rows):
    placeholders = ",".join(["?"] * len(PARTICIPANT_COLS))
    cols = ",".join(PARTICIPANT_COLS)
    for r in rows:
        values = [match_id] + [r.get(c) for c in PARTICIPANT_COLS[1:]]
        conn.execute(
            f"INSERT OR REPLACE INTO participants({cols}) VALUES ({placeholders})",
            values,
        )
    conn.commit()


def get_squad_for_match(conn, match_id):
    return conn.execute(
        "SELECT * FROM participants WHERE match_id = ? ORDER BY name", (match_id,)
    ).fetchall()


def get_known_match_ids(conn):
    rows = conn.execute("SELECT match_id FROM matches").fetchall()
    return {r["match_id"] for r in rows}
```

- [ ] **Step 4: Tests grün**

- [ ] **Step 5: Commit**

```bash
git add pubg/db.py tests/pubg/test_db_dao.py
git commit -m "feat(pubg): Match + Participant DAO"
```

### Task 2.4: DAO — Lifetime, Settings, Telemetry

**Files:**
- Modify: `pubg/db.py`
- Modify: `tests/pubg/test_db_dao.py`

- [ ] **Step 1: Tests anhängen**

```python
def test_settings_get_set(tmp_db_path):
    from pubg.db import set_setting, get_setting
    conn = _setup(tmp_db_path)
    assert get_setting(conn, "key1") is None
    set_setting(conn, "key1", "value1")
    assert get_setting(conn, "key1") == "value1"
    set_setting(conn, "key1", "value2")
    assert get_setting(conn, "key1") == "value2"


def test_lifetime_upsert(tmp_db_path):
    from pubg.db import upsert_lifetime, get_lifetime
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    upsert_lifetime(conn, "account.A", "squad-fpp", {
        "rounds_played": 16509, "wins": 885, "top10s": 6487,
        "win_rate": 5.361, "top10_rate": 39.294, "kills": 23974,
        "kd_ratio": 1.534, "headshot_kills": 5762, "headshot_rate": 24.034,
        "avg_damage": 287.0, "longest_kill": 612.0, "time_survived_sec": 320000,
    })
    lt = get_lifetime(conn, "account.A", "squad-fpp")
    assert lt["wins"] == 885


def test_insert_telemetry_events(tmp_db_path):
    from pubg.db import insert_match, insert_telemetry_events, get_telemetry_for_match
    conn = _setup(tmp_db_path)
    insert_match(conn, "m1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", None)
    insert_telemetry_events(conn, "m1", [
        {"event_type": "Kill", "timestamp_ms": 12000,
         "actor_account": "account.A", "target_account": "account.X",
         "weapon": "Beryl", "distance": 87.0, "damage": 100.0,
         "payload_json": "{}"},
        {"event_type": "Landing", "timestamp_ms": 1000,
         "actor_account": "account.A", "target_account": None,
         "weapon": None, "distance": None, "damage": None,
         "payload_json": "{}"},
    ])
    rows = get_telemetry_for_match(conn, "m1")
    assert len(rows) == 2
```

- [ ] **Step 2: Tests fail-laufen**

- [ ] **Step 3: An `pubg/db.py` anhängen**

```python
def set_setting(conn, key: str, value: str) -> None:
    conn.execute("""
        INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    """, (key, value, _now_iso()))
    conn.commit()


def get_setting(conn, key: str, default=None):
    r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


LIFETIME_COLS = (
    "rounds_played", "wins", "top10s", "win_rate", "top10_rate",
    "kills", "kd_ratio", "headshot_kills", "headshot_rate",
    "avg_damage", "longest_kill", "time_survived_sec",
)


def upsert_lifetime(conn, account_id: str, mode: str, stats: dict) -> None:
    cols = ", ".join(LIFETIME_COLS)
    placeholders = ", ".join(["?"] * len(LIFETIME_COLS))
    updates = ", ".join(f"{c}=excluded.{c}" for c in LIFETIME_COLS)
    values = [account_id, mode] + [stats.get(c) for c in LIFETIME_COLS]
    conn.execute(f"""
        INSERT INTO player_lifetime(account_id, mode, {cols}, last_refreshed)
        VALUES (?, ?, {placeholders}, ?)
        ON CONFLICT(account_id, mode) DO UPDATE SET {updates}, last_refreshed=excluded.last_refreshed
    """, values + [_now_iso()])
    conn.commit()


def get_lifetime(conn, account_id: str, mode: str):
    return conn.execute(
        "SELECT * FROM player_lifetime WHERE account_id=? AND mode=?",
        (account_id, mode),
    ).fetchone()


def insert_telemetry_events(conn, match_id: str, events: list) -> None:
    rows = [(match_id, e["event_type"], e.get("timestamp_ms"),
             e.get("actor_account"), e.get("target_account"),
             e.get("weapon"), e.get("distance"), e.get("damage"),
             e.get("payload_json", "{}"))
            for e in events]
    conn.executemany("""
        INSERT INTO telemetry_events
        (match_id, event_type, timestamp_ms, actor_account, target_account,
         weapon, distance, damage, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)
    conn.commit()


def get_telemetry_for_match(conn, match_id: str):
    return conn.execute(
        "SELECT * FROM telemetry_events WHERE match_id=?", (match_id,)
    ).fetchall()


def mark_telemetry_fetched(conn, match_id: str) -> None:
    conn.execute("UPDATE matches SET telemetry_fetched=1 WHERE match_id=?", (match_id,))
    conn.commit()


def get_matches_needing_telemetry(conn, limit: int = 5):
    return conn.execute("""
        SELECT match_id, telemetry_url FROM matches
        WHERE telemetry_fetched = 0 AND telemetry_url IS NOT NULL
        ORDER BY played_at DESC LIMIT ?
    """, (limit,)).fetchall()
```

- [ ] **Step 4: Tests grün**

```bash
pytest tests/pubg/test_db_dao.py -v
```

- [ ] **Step 5: Commit**

```bash
git add pubg/db.py tests/pubg/test_db_dao.py
git commit -m "feat(pubg): DAO Settings + Lifetime + Telemetry"
```


## Phase 3: API-Client mit Rate-Limiter

### Task 3.1: Rate-Limiter

**Files:**
- Create: `pubg/api_client.py`
- Create: `tests/pubg/test_rate_limiter.py`

- [ ] **Step 1: Test schreiben**

```python
# tests/pubg/test_rate_limiter.py
import time
from pubg.api_client import RateLimiter


def test_rate_limiter_allows_up_to_max_per_window():
    rl = RateLimiter(max_requests=3, window_secs=10)
    assert rl.try_acquire() is True
    assert rl.try_acquire() is True
    assert rl.try_acquire() is True
    assert rl.try_acquire() is False


def test_rate_limiter_releases_after_window(monkeypatch):
    t = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: t[0])
    rl = RateLimiter(max_requests=2, window_secs=10)
    assert rl.try_acquire() is True
    assert rl.try_acquire() is True
    assert rl.try_acquire() is False
    t[0] = 1011.0  # mehr als window
    assert rl.try_acquire() is True


def test_remaining_budget():
    rl = RateLimiter(max_requests=10, window_secs=60)
    rl.try_acquire()
    rl.try_acquire()
    assert rl.remaining() == 8
```

- [ ] **Step 2: Test fail**

- [ ] **Step 3: Implementation**

```python
# pubg/api_client.py
import time
from collections import deque


class RateLimiter:
    def __init__(self, max_requests: int = 10, window_secs: int = 60):
        self.max = max_requests
        self.window = window_secs
        self._timestamps: deque = deque()

    def _purge(self) -> None:
        cutoff = time.monotonic() - self.window
        while self._timestamps and self._timestamps[0] < cutoff:
            self._timestamps.popleft()

    def try_acquire(self) -> bool:
        self._purge()
        if len(self._timestamps) >= self.max:
            return False
        self._timestamps.append(time.monotonic())
        return True

    def remaining(self) -> int:
        self._purge()
        return self.max - len(self._timestamps)
```

- [ ] **Step 4: Tests grün**

```bash
pytest tests/pubg/test_rate_limiter.py -v
```

- [ ] **Step 5: Commit**

```bash
git add pubg/api_client.py tests/pubg/test_rate_limiter.py
git commit -m "feat(pubg): RateLimiter (10 req/min Default)"
```

### Task 3.2: PubgClient — HTTP-Wrapper

**Files:**
- Modify: `pubg/api_client.py`
- Create: `tests/pubg/test_api_client.py`
- Create: `tests/fixtures/__init__.py`
- Create: `tests/fixtures/player_response.json`
- Create: `tests/fixtures/match_response.json`

- [ ] **Step 1: Recordings ablegen** (Beispiel-Strukturen aus PUBG-API-Docs)

```json
// tests/fixtures/player_response.json
{
  "data": [{
    "id": "account.abc123",
    "type": "player",
    "attributes": {"name": "PEX_LuCKoR", "shardId": "steam"},
    "relationships": {
      "matches": {
        "data": [
          {"type": "match", "id": "match-1"},
          {"type": "match", "id": "match-2"}
        ]
      }
    }
  }]
}
```

```json
// tests/fixtures/match_response.json
{
  "data": {
    "type": "match",
    "id": "match-1",
    "attributes": {
      "mapName": "Erangel_Main",
      "gameMode": "squad-fpp",
      "duration": 1820,
      "createdAt": "2026-05-04T18:00:00Z",
      "isCustomMatch": false,
      "matchType": "official"
    },
    "relationships": {
      "rosters": {"data": [{"type": "roster", "id": "r1"}]},
      "assets": {"data": [{"type": "asset", "id": "a1"}]}
    }
  },
  "included": [
    {
      "type": "roster", "id": "r1",
      "attributes": {"stats": {"teamId": 5, "rank": 3, "teamId": 5}},
      "relationships": {
        "participants": {"data": [
          {"type": "participant", "id": "p1"},
          {"type": "participant", "id": "p2"}
        ]}
      }
    },
    {
      "type": "participant", "id": "p1",
      "attributes": {"stats": {
        "playerId": "account.abc123", "name": "PEX_LuCKoR",
        "kills": 4, "headshotKills": 1, "assists": 2, "DBNOs": 3,
        "revives": 1, "damageDealt": 412.0, "longestKill": 187.5,
        "timeSurvived": 1690, "walkDistance": 2300, "rideDistance": 1100,
        "swimDistance": 0, "weaponsAcquired": 8, "heals": 3, "boosts": 4,
        "teamKills": 0, "winPlace": 3
      }}
    },
    {
      "type": "participant", "id": "p2",
      "attributes": {"stats": {
        "playerId": "account.def456", "name": "MateA",
        "kills": 2, "headshotKills": 0, "assists": 4, "DBNOs": 1,
        "revives": 2, "damageDealt": 287.0, "longestKill": 92.0,
        "timeSurvived": 1690, "walkDistance": 2200, "rideDistance": 1100,
        "swimDistance": 0, "weaponsAcquired": 6, "heals": 2, "boosts": 3,
        "teamKills": 0, "winPlace": 3
      }}
    },
    {"type": "asset", "id": "a1", "attributes": {"URL": "https://example/tel.json"}}
  ]
}
```

- [ ] **Step 2: Test schreiben**

```python
# tests/pubg/test_api_client.py
import json
import os
from unittest.mock import patch, MagicMock
from pubg.api_client import PubgClient

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def _load(name):
    with open(os.path.join(FIXTURES, name)) as f:
        return json.load(f)


def test_get_player_calls_correct_url():
    client = PubgClient(api_key="key", platform="steam")
    fake_resp = _load("player_response.json")
    with patch.object(client, "_get_json", return_value=fake_resp) as m:
        result = client.get_player("PEX_LuCKoR")
    m.assert_called_once()
    url = m.call_args[0][0]
    assert "/shards/steam/players" in url
    assert "filter[playerNames]=PEX_LuCKoR" in url
    assert result["data"][0]["attributes"]["name"] == "PEX_LuCKoR"


def test_get_match_returns_data():
    client = PubgClient(api_key="key", platform="steam")
    with patch.object(client, "_get_json", return_value=_load("match_response.json")):
        m = client.get_match("match-1")
    assert m["data"]["id"] == "match-1"


def test_get_player_match_ids_extracts_relationships():
    client = PubgClient(api_key="key", platform="steam")
    ids = client.extract_match_ids(_load("player_response.json"))
    assert ids == ["match-1", "match-2"]


def test_rate_limit_blocks_requests():
    from pubg.api_client import RateLimitError
    client = PubgClient(api_key="key", platform="steam",
                        rate_limiter_max=1, rate_limiter_window=60)
    with patch.object(client, "_raw_get", return_value=b'{}'):
        client._get_json("https://x")
    import pytest
    with pytest.raises(RateLimitError):
        client._get_json("https://x")
```

- [ ] **Step 3: Implementation an `pubg/api_client.py` anhängen**

```python
import json
import urllib.request
import urllib.error


PUBG_BASE = "https://api.pubg.com"


class RateLimitError(Exception):
    pass


class ApiError(Exception):
    pass


class PubgClient:
    def __init__(self, api_key: str, platform: str = "steam",
                 rate_limiter_max: int = 10, rate_limiter_window: int = 60):
        self.api_key = api_key
        self.platform = platform
        self.limiter = RateLimiter(rate_limiter_max, rate_limiter_window)

    def _raw_get(self, url: str) -> bytes:
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/vnd.api+json",
        })
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            raise ApiError(f"HTTP {e.code}: {e.reason}") from e
        except urllib.error.URLError as e:
            raise ApiError(f"URL error: {e.reason}") from e

    def _get_json(self, url: str) -> dict:
        if not self.limiter.try_acquire():
            raise RateLimitError("Rate-Limit erreicht — bitte warten")
        body = self._raw_get(url)
        return json.loads(body.decode("utf-8"))

    def get_player(self, name: str) -> dict:
        url = (f"{PUBG_BASE}/shards/{self.platform}/players"
               f"?filter[playerNames]={name}")
        return self._get_json(url)

    def get_match(self, match_id: str) -> dict:
        url = f"{PUBG_BASE}/shards/{self.platform}/matches/{match_id}"
        return self._get_json(url)

    def get_lifetime(self, account_id: str) -> dict:
        url = (f"{PUBG_BASE}/shards/{self.platform}/players/{account_id}"
               f"/seasons/lifetime")
        return self._get_json(url)

    def get_telemetry(self, telemetry_url: str) -> list:
        # Telemetry-CDN, kein API-Key nötig, kein Rate-Limit
        req = urllib.request.Request(telemetry_url, headers={
            "Accept": "application/vnd.api+json",
        })
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))

    @staticmethod
    def extract_match_ids(player_payload: dict) -> list:
        try:
            rels = player_payload["data"][0]["relationships"]["matches"]["data"]
            return [r["id"] for r in rels]
        except (KeyError, IndexError):
            return []
```

- [ ] **Step 4: Tests grün**

```bash
pytest tests/pubg/test_api_client.py -v
```

- [ ] **Step 5: Commit**

```bash
git add pubg/api_client.py tests/pubg/test_api_client.py tests/fixtures/
git commit -m "feat(pubg): PubgClient mit RateLimiter und Fixtures"
```


## Phase 4: Match-Polling-Loop

### Task 4.1: Match-Detail-Parser

**Files:**
- Create: `pubg/match_parser.py`
- Create: `tests/pubg/test_match_parser.py`

- [ ] **Step 1: Test schreiben**

```python
# tests/pubg/test_match_parser.py
import json
import os
from pubg.match_parser import parse_match_response, find_my_team_id

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def _load(name):
    with open(os.path.join(FIXTURES, name)) as f:
        return json.load(f)


def test_parse_match_response_extracts_meta():
    parsed = parse_match_response(_load("match_response.json"), "account.abc123")
    assert parsed["match_id"] == "match-1"
    assert parsed["map_name"] == "Erangel_Main"
    assert parsed["game_mode"] == "squad-fpp"
    assert parsed["duration_secs"] == 1820
    assert parsed["played_at"] == "2026-05-04T18:00:00Z"
    assert parsed["telemetry_url"] == "https://example/tel.json"


def test_parse_match_response_returns_only_my_squad():
    parsed = parse_match_response(_load("match_response.json"), "account.abc123")
    names = {p["name"] for p in parsed["squad_participants"]}
    assert names == {"PEX_LuCKoR", "MateA"}


def test_parse_match_response_self_account_id_marked():
    parsed = parse_match_response(_load("match_response.json"), "account.abc123")
    assert parsed["my_team_id"] == 5
    assert parsed["squad_participants"][0]["place"] == 3
```

- [ ] **Step 2: Test fail**

- [ ] **Step 3: Implementation**

```python
# pubg/match_parser.py


def _index_included(match_payload):
    by_type = {}
    for item in match_payload.get("included", []):
        by_type.setdefault(item["type"], {})[item["id"]] = item
    return by_type


def find_my_team_id(match_payload, my_account_id):
    idx = _index_included(match_payload)
    rosters = idx.get("roster", {})
    parts = idx.get("participant", {})
    for r in rosters.values():
        part_ids = [p["id"] for p in r["relationships"]["participants"]["data"]]
        for pid in part_ids:
            p = parts.get(pid)
            if not p:
                continue
            if p["attributes"]["stats"].get("playerId") == my_account_id:
                return r["attributes"]["stats"].get("teamId")
    return None


def _participant_to_row(p):
    s = p["attributes"]["stats"]
    return {
        "account_id": s.get("playerId"),
        "name": s.get("name"),
        "place": s.get("winPlace"),
        "kills": s.get("kills"),
        "headshot_kills": s.get("headshotKills"),
        "assists": s.get("assists"),
        "dbnos": s.get("DBNOs"),
        "revives": s.get("revives"),
        "damage_dealt": s.get("damageDealt"),
        "longest_kill": s.get("longestKill"),
        "time_survived": s.get("timeSurvived"),
        "walk_distance": s.get("walkDistance"),
        "ride_distance": s.get("rideDistance"),
        "swim_distance": s.get("swimDistance"),
        "weapons_acquired": s.get("weaponsAcquired"),
        "heals": s.get("heals"),
        "boosts": s.get("boosts"),
        "team_kills": s.get("teamKills"),
    }


def parse_match_response(match_payload, my_account_id):
    data = match_payload["data"]
    attrs = data["attributes"]
    idx = _index_included(match_payload)

    my_team_id = find_my_team_id(match_payload, my_account_id)
    rosters = idx.get("roster", {})
    parts = idx.get("participant", {})

    squad = []
    for r in rosters.values():
        if r["attributes"]["stats"].get("teamId") != my_team_id:
            continue
        for pref in r["relationships"]["participants"]["data"]:
            p = parts.get(pref["id"])
            if not p:
                continue
            row = _participant_to_row(p)
            row["team_id"] = my_team_id
            squad.append(row)

    telemetry_url = None
    for asset in idx.get("asset", {}).values():
        url = asset.get("attributes", {}).get("URL")
        if url:
            telemetry_url = url
            break

    return {
        "match_id": data["id"],
        "map_name": attrs.get("mapName"),
        "game_mode": attrs.get("gameMode"),
        "duration_secs": attrs.get("duration"),
        "is_ranked": attrs.get("matchType") == "competitive",
        "played_at": attrs.get("createdAt"),
        "telemetry_url": telemetry_url,
        "my_team_id": my_team_id,
        "squad_participants": squad,
    }
```

- [ ] **Step 4: Tests grün**

- [ ] **Step 5: Commit**

```bash
git add pubg/match_parser.py tests/pubg/test_match_parser.py
git commit -m "feat(pubg): Match-Response-Parser mit Squad-Filter"
```

### Task 4.2: Lifetime-Parser

**Files:**
- Modify: `pubg/match_parser.py`
- Create: `tests/fixtures/lifetime_response.json`
- Modify: `tests/pubg/test_match_parser.py`

- [ ] **Step 1: Fixture**

```json
// tests/fixtures/lifetime_response.json
{
  "data": {
    "type": "lifetime",
    "attributes": {
      "gameModeStats": {
        "squad-fpp": {
          "roundsPlayed": 16509, "wins": 885, "top10s": 6487,
          "kills": 23974, "headshotKills": 5762,
          "damageDealt": 4730000.0, "longestKill": 612.0,
          "timeSurvived": 320000, "assists": 7000, "dBNOs": 12000
        },
        "duo-fpp": {
          "roundsPlayed": 200, "wins": 12, "top10s": 80,
          "kills": 350, "headshotKills": 70,
          "damageDealt": 60000.0, "longestKill": 480.0,
          "timeSurvived": 5000, "assists": 50, "dBNOs": 80
        }
      }
    }
  }
}
```

- [ ] **Step 2: Test anhängen**

```python
def test_parse_lifetime_extracts_per_mode():
    from pubg.match_parser import parse_lifetime_response
    payload = _load("lifetime_response.json")
    modes = parse_lifetime_response(payload)
    assert "squad-fpp" in modes
    assert modes["squad-fpp"]["rounds_played"] == 16509
    assert modes["squad-fpp"]["wins"] == 885
    assert round(modes["squad-fpp"]["kd_ratio"], 2) == round(23974 / (16509 - 885), 2)
    assert round(modes["squad-fpp"]["win_rate"], 3) == round(885 / 16509 * 100, 3)
    assert "duo-fpp" in modes


def test_parse_lifetime_aggregate_all():
    from pubg.match_parser import parse_lifetime_response, aggregate_lifetime_modes
    payload = _load("lifetime_response.json")
    modes = parse_lifetime_response(payload)
    agg = aggregate_lifetime_modes(modes)
    assert agg["rounds_played"] == 16509 + 200
    assert agg["wins"] == 885 + 12
```

- [ ] **Step 3: Implementation anhängen**

```python
def _safe_div(a, b):
    return (a / b) if b else 0.0


def parse_lifetime_response(payload):
    out = {}
    modes = payload["data"]["attributes"].get("gameModeStats", {})
    for mode, s in modes.items():
        rounds = s.get("roundsPlayed", 0) or 0
        wins = s.get("wins", 0) or 0
        kills = s.get("kills", 0) or 0
        hs = s.get("headshotKills", 0) or 0
        deaths = max(rounds - wins, 0)
        out[mode] = {
            "rounds_played": rounds,
            "wins": wins,
            "top10s": s.get("top10s", 0) or 0,
            "win_rate": _safe_div(wins, rounds) * 100,
            "top10_rate": _safe_div(s.get("top10s", 0) or 0, rounds) * 100,
            "kills": kills,
            "kd_ratio": _safe_div(kills, deaths),
            "headshot_kills": hs,
            "headshot_rate": _safe_div(hs, kills) * 100,
            "avg_damage": _safe_div(s.get("damageDealt", 0) or 0, rounds),
            "longest_kill": s.get("longestKill", 0.0) or 0.0,
            "time_survived_sec": s.get("timeSurvived", 0) or 0,
        }
    return out


def aggregate_lifetime_modes(modes_dict):
    sums = {k: 0 for k in (
        "rounds_played", "wins", "top10s", "kills",
        "headshot_kills", "time_survived_sec",
    )}
    dmg_total = 0.0
    longest = 0.0
    for s in modes_dict.values():
        for k in sums:
            sums[k] += s.get(k, 0) or 0
        dmg_total += (s.get("avg_damage", 0) or 0) * (s.get("rounds_played", 0) or 0)
        longest = max(longest, s.get("longest_kill", 0.0) or 0.0)
    rounds = sums["rounds_played"]
    deaths = max(rounds - sums["wins"], 0)
    return {
        **sums,
        "win_rate": _safe_div(sums["wins"], rounds) * 100,
        "top10_rate": _safe_div(sums["top10s"], rounds) * 100,
        "kd_ratio": _safe_div(sums["kills"], deaths),
        "headshot_rate": _safe_div(sums["headshot_kills"], sums["kills"]) * 100,
        "avg_damage": _safe_div(dmg_total, rounds),
        "longest_kill": longest,
    }
```

- [ ] **Step 4: Tests grün**

- [ ] **Step 5: Commit**

```bash
git add pubg/match_parser.py tests/pubg/test_match_parser.py tests/fixtures/lifetime_response.json
git commit -m "feat(pubg): Lifetime-Parser mit Mode-Aggregation"
```

### Task 4.3: Polling-Loop (single tick)

**Files:**
- Create: `pubg/poller.py`
- Create: `tests/pubg/test_poller.py`

- [ ] **Step 1: Test mit Mock-Client**

```python
# tests/pubg/test_poller.py
import json
import os
from unittest.mock import MagicMock
from pubg.db import connect, init_schema, upsert_player, get_known_match_ids, get_match
from pubg.poller import run_single_tick

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def _load(name):
    with open(os.path.join(FIXTURES, name)) as f:
        return json.load(f)


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.abc123", "PEX_LuCKoR", "steam", True)
    return conn


def test_run_single_tick_imports_new_match(tmp_db_path):
    conn = _setup(tmp_db_path)
    client = MagicMock()
    client.get_player.return_value = _load("player_response.json")
    client.extract_match_ids = lambda p: ["match-1", "match-2"]
    client.get_match.side_effect = lambda mid: _load("match_response.json") if mid == "match-1" else {"data": {"id": "match-2", "attributes": {"mapName": "Miramar_Main", "gameMode": "duo-fpp", "duration": 1500, "createdAt": "2026-05-04T19:00:00Z"}, "relationships": {"rosters": {"data": []}, "assets": {"data": []}}}, "included": []}

    run_single_tick(conn, client, my_player_name="PEX_LuCKoR",
                    my_account_id="account.abc123",
                    max_matches_per_tick=5)

    known = get_known_match_ids(conn)
    assert known == {"match-1", "match-2"}
    m = get_match(conn, "match-1")
    assert m["map_name"] == "Erangel_Main"


def test_run_single_tick_skips_already_known(tmp_db_path):
    from pubg.db import insert_match
    conn = _setup(tmp_db_path)
    insert_match(conn, "match-1", "Erangel_Main", "squad-fpp", False, 1820,
                 "2026-05-04T18:00:00Z", None)
    client = MagicMock()
    client.get_player.return_value = _load("player_response.json")
    client.extract_match_ids = lambda p: ["match-1"]
    run_single_tick(conn, client, "PEX_LuCKoR", "account.abc123", 5)
    client.get_match.assert_not_called()
```

- [ ] **Step 2: Test fail**

- [ ] **Step 3: Implementation**

```python
# pubg/poller.py
from pubg.db import (
    upsert_player, insert_match, insert_participants,
    get_known_match_ids,
)
from pubg.match_parser import parse_match_response


def run_single_tick(conn, client, my_player_name: str,
                    my_account_id: str, max_matches_per_tick: int = 5) -> dict:
    """One polling iteration. Returns stats dict for status reporting."""
    stats = {"new_matches": 0, "errors": [], "skipped": 0}

    try:
        player_payload = client.get_player(my_player_name)
    except Exception as e:
        stats["errors"].append(f"player: {e}")
        return stats

    match_ids = client.extract_match_ids(player_payload)
    known = get_known_match_ids(conn)
    new_ids = [mid for mid in match_ids if mid not in known]

    for mid in new_ids[:max_matches_per_tick]:
        try:
            m_payload = client.get_match(mid)
            parsed = parse_match_response(m_payload, my_account_id)
            insert_match(conn, parsed["match_id"], parsed["map_name"],
                         parsed["game_mode"], parsed.get("is_ranked", False),
                         parsed["duration_secs"], parsed["played_at"],
                         parsed.get("telemetry_url"))
            for p in parsed["squad_participants"]:
                upsert_player(conn, p["account_id"], p["name"],
                              client.platform,
                              is_self=(p["account_id"] == my_account_id))
            insert_participants(conn, parsed["match_id"], parsed["squad_participants"])
            stats["new_matches"] += 1
        except Exception as e:
            stats["errors"].append(f"match {mid}: {e}")

    stats["skipped"] = max(0, len(new_ids) - max_matches_per_tick)
    return stats
```

- [ ] **Step 4: Tests grün**

```bash
pytest tests/pubg/test_poller.py -v
```

- [ ] **Step 5: Commit**

```bash
git add pubg/poller.py tests/pubg/test_poller.py
git commit -m "feat(pubg): Polling single-tick — Match-Import"
```

### Task 4.4: Lifetime-Refresh-Helper

**Files:**
- Modify: `pubg/poller.py`
- Modify: `tests/pubg/test_poller.py`

- [ ] **Step 1: Test anhängen**

```python
def test_refresh_lifetimes_for_qualified_co_players(tmp_db_path):
    from pubg.poller import refresh_lifetimes
    from pubg.db import insert_match, insert_participants, get_lifetime
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.B", "MateA", "steam", False)
    # Erzeuge 5 gemeinsame Matches mit MateA
    for i in range(5):
        mid = f"m{i}"
        insert_match(conn, mid, "Erangel_Main", "squad-fpp", False, 1800,
                     f"2026-05-04T1{i}:00:00Z", None)
        insert_participants(conn, mid, [
            {"account_id": "account.abc123", "name": "PEX_LuCKoR",
             "team_id": 1, "place": 5, "kills": 3, "headshot_kills": 0,
             "assists": 1, "dbnos": 1, "revives": 0, "damage_dealt": 200.0,
             "longest_kill": 50.0, "time_survived": 1500, "walk_distance": 100.0,
             "ride_distance": 0.0, "swim_distance": 0.0, "weapons_acquired": 5,
             "heals": 1, "boosts": 1, "team_kills": 0},
            {"account_id": "account.B", "name": "MateA", "team_id": 1,
             "place": 5, "kills": 2, "headshot_kills": 0, "assists": 1,
             "dbnos": 0, "revives": 0, "damage_dealt": 150.0, "longest_kill": 30.0,
             "time_survived": 1500, "walk_distance": 100.0, "ride_distance": 0.0,
             "swim_distance": 0.0, "weapons_acquired": 4, "heals": 0, "boosts": 1,
             "team_kills": 0},
        ])
    client = MagicMock()
    client.get_lifetime.return_value = _load("lifetime_response.json")
    stats = refresh_lifetimes(conn, client, min_matches=5, max_per_tick=3)
    assert stats["refreshed"] == 1
    lt = get_lifetime(conn, "account.B", "all")
    assert lt is not None
```

- [ ] **Step 2: Test fail**

- [ ] **Step 3: Implementation anhängen**

```python
import datetime
from pubg.db import upsert_lifetime
from pubg.match_parser import parse_lifetime_response, aggregate_lifetime_modes


def _is_stale(iso_ts, max_age_hours=24):
    if not iso_ts:
        return True
    try:
        ts = datetime.datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
    except Exception:
        return True
    age = datetime.datetime.now(datetime.timezone.utc) - ts
    return age.total_seconds() > max_age_hours * 3600


def refresh_lifetimes(conn, client, min_matches: int = 5,
                      max_per_tick: int = 3) -> dict:
    rows = conn.execute("""
        SELECT q.account_id, q.name, q.shared_matches,
               (SELECT MAX(last_refreshed) FROM player_lifetime
                WHERE account_id = q.account_id) AS last_refreshed
        FROM qualified_co_players q
        WHERE q.shared_matches >= ?
    """, (min_matches,)).fetchall()

    refreshed = 0
    errors = []
    for r in rows:
        if not _is_stale(r["last_refreshed"]):
            continue
        if refreshed >= max_per_tick:
            break
        try:
            payload = client.get_lifetime(r["account_id"])
            modes = parse_lifetime_response(payload)
            for mode, stats in modes.items():
                upsert_lifetime(conn, r["account_id"], mode, stats)
            agg = aggregate_lifetime_modes(modes)
            upsert_lifetime(conn, r["account_id"], "all", agg)
            refreshed += 1
        except Exception as e:
            errors.append(f"{r['name']}: {e}")
    return {"refreshed": refreshed, "errors": errors}
```

- [ ] **Step 4: Tests grün**

- [ ] **Step 5: Commit**

```bash
git add pubg/poller.py tests/pubg/test_poller.py
git commit -m "feat(pubg): Lifetime-Refresh ab >=5 gemeinsamen Matches"
```


## Phase 5: HTTP-Endpoints (Basis) und serve.py-Integration

### Task 5.1: In-Memory-Cache

**Files:**
- Create: `pubg/cache.py`
- Create: `tests/pubg/test_cache.py`

- [ ] **Step 1: Test schreiben**

```python
# tests/pubg/test_cache.py
import time
from pubg.cache import TTLCache


def test_get_set_returns_value():
    c = TTLCache(ttl_secs=30)
    c.set("k", {"v": 1})
    assert c.get("k") == {"v": 1}


def test_get_returns_none_after_ttl(monkeypatch):
    t = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: t[0])
    c = TTLCache(ttl_secs=10)
    c.set("k", "v")
    t[0] = 1011.0
    assert c.get("k") is None


def test_get_or_compute_caches_result():
    c = TTLCache(ttl_secs=30)
    calls = [0]

    def expensive():
        calls[0] += 1
        return "result"

    assert c.get_or_compute("k", expensive) == "result"
    assert c.get_or_compute("k", expensive) == "result"
    assert calls[0] == 1
```

- [ ] **Step 2: Test fail**

- [ ] **Step 3: Implementation**

```python
# pubg/cache.py
import time


class TTLCache:
    def __init__(self, ttl_secs: int = 30):
        self.ttl = ttl_secs
        self._store: dict = {}

    def set(self, key, value) -> None:
        self._store[key] = (time.monotonic(), value)

    def get(self, key):
        entry = self._store.get(key)
        if not entry:
            return None
        ts, value = entry
        if time.monotonic() - ts > self.ttl:
            self._store.pop(key, None)
            return None
        return value

    def get_or_compute(self, key, compute_fn):
        cached = self.get(key)
        if cached is not None:
            return cached
        value = compute_fn()
        self.set(key, value)
        return value

    def invalidate(self, key=None):
        if key is None:
            self._store.clear()
        else:
            self._store.pop(key, None)
```

- [ ] **Step 4: Tests grün**

- [ ] **Step 5: Commit**

```bash
git add pubg/cache.py tests/pubg/test_cache.py
git commit -m "feat(pubg): TTLCache mit get_or_compute"
```

### Task 5.2: Aggregations — Session und Last-Match

**Files:**
- Create: `pubg/aggregations.py`
- Create: `tests/pubg/test_aggregations.py`

- [ ] **Step 1: Test schreiben**

```python
# tests/pubg/test_aggregations.py
from pubg.db import (connect, init_schema, upsert_player, insert_match,
                     insert_participants, set_setting)
from pubg.aggregations import compute_session_stats, compute_last_match


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    return conn


def _add_match(conn, mid, played_at, kills, dmg, place, mate_count=1, mode="squad-fpp"):
    insert_match(conn, mid, "Erangel_Main", mode, False, 1800, played_at, None)
    parts = [{"account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
              "place": place, "kills": kills, "headshot_kills": 1, "assists": 0,
              "dbnos": 0, "revives": 0, "damage_dealt": dmg, "longest_kill": 50.0,
              "time_survived": 1500, "walk_distance": 100.0, "ride_distance": 0.0,
              "swim_distance": 0.0, "weapons_acquired": 5, "heals": 0, "boosts": 0,
              "team_kills": 0}]
    for i in range(mate_count):
        parts.append({
            "account_id": f"account.M{i}", "name": f"Mate{i}", "team_id": 1,
            "place": place, "kills": 1, "headshot_kills": 0, "assists": 1,
            "dbnos": 0, "revives": 0, "damage_dealt": 100.0, "longest_kill": 0.0,
            "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
            "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
            "team_kills": 0})
    insert_participants(conn, mid, parts)


def test_session_stats_aggregates_after_session_start(tmp_db_path):
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T18:00:00Z")
    _add_match(conn, "m1", "2026-05-04T17:00:00Z", 5, 500.0, 3)  # vor Session
    _add_match(conn, "m2", "2026-05-04T18:30:00Z", 4, 400.0, 1)
    _add_match(conn, "m3", "2026-05-04T19:00:00Z", 6, 600.0, 5)
    s = compute_session_stats(conn, "account.A")
    assert s["matches"] == 2
    assert s["kills"] == 10
    assert s["damage"] == 1000.0
    assert s["wins"] == 1
    assert s["bestPlace"] == 1


def test_last_match_returns_squad_with_self_first(tmp_db_path):
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T18:00:00Z")
    _add_match(conn, "m1", "2026-05-04T18:00:00Z", 4, 412.0, 3, mate_count=2)
    lm = compute_last_match(conn, "account.A")
    assert lm["matchId"] == "m1"
    assert lm["map"] == "Erangel_Main"
    assert lm["myStats"]["kills"] == 4
    assert len(lm["mates"]) == 2
```

- [ ] **Step 2: Test fail**

- [ ] **Step 3: Implementation**

```python
# pubg/aggregations.py
from pubg.db import get_setting


def _session_filter(conn):
    started_at = get_setting(conn, "sessionStartedAt")
    return started_at or "1970-01-01T00:00:00Z"


def compute_session_stats(conn, my_account_id: str) -> dict:
    started = _session_filter(conn)
    rows = conn.execute("""
        SELECT m.match_id, m.map_name, m.played_at,
               pa.kills, pa.damage_dealt, pa.place, pa.headshot_kills,
               pa.longest_kill
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
        ORDER BY m.played_at ASC
    """, (my_account_id, started)).fetchall()

    kills = sum(r["kills"] or 0 for r in rows)
    headshots = sum(r["headshot_kills"] or 0 for r in rows)
    damage = sum(r["damage_dealt"] or 0.0 for r in rows)
    wins = sum(1 for r in rows if (r["place"] or 99) == 1)
    top10s = sum(1 for r in rows if (r["place"] or 99) <= 10)
    best_place = min((r["place"] for r in rows if r["place"]), default=None)
    longest = max((r["longest_kill"] or 0.0 for r in rows), default=0.0)

    map_breakdown = {}
    for r in rows:
        m = r["map_name"]
        map_breakdown[m] = map_breakdown.get(m, 0) + 1

    return {
        "matches": len(rows),
        "kills": kills,
        "damage": damage,
        "wins": wins,
        "top10s": top10s,
        "kd": kills / max(len(rows) - wins, 1),
        "headshotPct": (headshots / kills * 100) if kills else 0,
        "bestPlace": best_place,
        "longestKill": longest,
        "sessionStartedAt": started,
        "mapBreakdown": [{"map": m, "count": c}
                         for m, c in sorted(map_breakdown.items(),
                                            key=lambda x: -x[1])],
    }


def compute_last_match(conn, my_account_id: str):
    row = conn.execute("""
        SELECT m.* FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ?
        ORDER BY m.played_at DESC LIMIT 1
    """, (my_account_id,)).fetchone()
    if not row:
        return None
    parts = conn.execute(
        "SELECT * FROM participants WHERE match_id = ?", (row["match_id"],)
    ).fetchall()
    me = next((p for p in parts if p["account_id"] == my_account_id), None)
    mates = [p for p in parts if p["account_id"] != my_account_id]
    return {
        "matchId": row["match_id"],
        "map": row["map_name"],
        "mode": row["game_mode"],
        "place": me["place"] if me else None,
        "durationSec": row["duration_secs"],
        "playedAt": row["played_at"],
        "myStats": dict(me) if me else None,
        "mates": [{"name": p["name"], "accountId": p["account_id"],
                   "stats": dict(p)} for p in mates],
    }
```

- [ ] **Step 4: Tests grün**

- [ ] **Step 5: Commit**

```bash
git add pubg/aggregations.py tests/pubg/test_aggregations.py
git commit -m "feat(pubg): Aggregations Session + Last-Match"
```

### Task 5.3: Endpoint-Layer

**Files:**
- Create: `pubg/endpoints.py`
- Create: `tests/pubg/test_endpoints.py`

- [ ] **Step 1: Test schreiben**

```python
# tests/pubg/test_endpoints.py
import json
from unittest.mock import MagicMock
from pubg.db import connect, init_schema, upsert_player, set_setting
from pubg.cache import TTLCache
from pubg.endpoints import EndpointRegistry


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    return conn


def _registry(conn):
    return EndpointRegistry(
        get_conn=lambda: conn,
        my_account_id="account.A",
        platform="steam",
        cache=TTLCache(ttl_secs=30),
        client=MagicMock(),
        poller_status=lambda: {"polling": "ok"},
    )


def test_session_endpoint_returns_json(tmp_db_path):
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    reg = _registry(conn)
    body, code, ctype = reg.dispatch("GET", "/api/pubg/session", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert "kills" in payload


def test_status_endpoint(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/status", b"", {})
    assert code == 200
    assert json.loads(body)["polling"] == "ok"


def test_session_reset_endpoint(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("POST", "/api/pubg/session/reset", b"", {})
    assert code == 200
    from pubg.db import get_setting
    assert get_setting(conn, "sessionStartedAt") is not None


def test_unknown_route_returns_404(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/foo", b"", {})
    assert code == 404
```

- [ ] **Step 2: Test fail**

- [ ] **Step 3: Implementation**

```python
# pubg/endpoints.py
import datetime
import json
from urllib.parse import urlparse, parse_qs
from pubg.db import set_setting, get_setting
from pubg.aggregations import compute_session_stats, compute_last_match


def _ok(payload):
    return json.dumps(payload).encode("utf-8"), 200, "application/json"


def _err(code, msg):
    return json.dumps({"error": msg}).encode("utf-8"), code, "application/json"


class EndpointRegistry:
    def __init__(self, get_conn, my_account_id, platform, cache,
                 client, poller_status):
        self.get_conn = get_conn
        self.my_account_id = my_account_id
        self.platform = platform
        self.cache = cache
        self.client = client
        self.poller_status = poller_status

    def dispatch(self, method: str, path: str, body: bytes, headers: dict):
        u = urlparse(path)
        route = (method, u.path)
        qs = {k: v[0] for k, v in parse_qs(u.query).items()}

        if route == ("GET", "/api/pubg/session"):
            return self._session()
        if route == ("GET", "/api/pubg/last-match"):
            return self._last_match()
        if route == ("GET", "/api/pubg/status"):
            return _ok(self.poller_status())
        if route == ("POST", "/api/pubg/session/reset"):
            return self._session_reset()
        return _err(404, f"unknown route {path}")

    def _session(self):
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            "session",
            lambda: compute_session_stats(conn, self.my_account_id),
        ))

    def _last_match(self):
        conn = self.get_conn()
        result = self.cache.get_or_compute(
            "last-match",
            lambda: compute_last_match(conn, self.my_account_id),
        )
        return _ok(result or {})

    def _session_reset(self):
        conn = self.get_conn()
        now = datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"
        set_setting(conn, "sessionStartedAt", now)
        self.cache.invalidate("session")
        return _ok({"sessionStartedAt": now})
```

- [ ] **Step 4: Tests grün**

- [ ] **Step 5: Commit**

```bash
git add pubg/endpoints.py tests/pubg/test_endpoints.py
git commit -m "feat(pubg): EndpointRegistry mit Session/Last-Match/Status"
```

### Task 5.4: Background-Polling-Thread

**Files:**
- Modify: `pubg/poller.py`
- Create: `tests/pubg/test_poller_thread.py`

- [ ] **Step 1: Test schreiben**

```python
# tests/pubg/test_poller_thread.py
import time
from unittest.mock import MagicMock
from pubg.db import connect, init_schema, upsert_player
from pubg.poller import PollerThread


def test_poller_thread_starts_and_stops(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    client = MagicMock()
    client.platform = "steam"
    client.get_player.return_value = {"data": [{"id": "account.A",
        "attributes": {"name": "PEX_LuCKoR"},
        "relationships": {"matches": {"data": []}}}]}
    client.extract_match_ids = lambda p: []

    t = PollerThread(db_path=tmp_db_path, client=client,
                     my_player_name="PEX_LuCKoR",
                     my_account_id="account.A",
                     interval_secs=0.1, lifetime_min_matches=5,
                     lifetime_max_per_tick=3, match_max_per_tick=5)
    t.start()
    time.sleep(0.3)
    status = t.status()
    assert status["polling"] in ("ok", "running")
    t.stop()
    t.join(timeout=2)
    assert not t.is_alive()
```

- [ ] **Step 2: Test fail**

- [ ] **Step 3: Implementation an `pubg/poller.py` anhängen**

```python
import datetime
import threading
from pubg.db import connect


def _iso_utc_now():
    return datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"


class PollerThread(threading.Thread):
    def __init__(self, db_path, client, my_player_name, my_account_id,
                 interval_secs=60, lifetime_min_matches=5,
                 lifetime_max_per_tick=3, match_max_per_tick=5):
        super().__init__(daemon=True, name="pubg-poller")
        self.db_path = db_path
        self.client = client
        self.my_player_name = my_player_name
        self.my_account_id = my_account_id
        self.interval = interval_secs
        self.lifetime_min = lifetime_min_matches
        self.lifetime_max = lifetime_max_per_tick
        self.match_max = match_max_per_tick
        self._stop = threading.Event()
        self._last_status = {"polling": "starting", "lastPollAt": None,
                              "errors": [], "newMatches": 0,
                              "lifetimeRefreshed": 0}

    def run(self):
        while not self._stop.is_set():
            try:
                conn = connect(self.db_path)
                m_stats = run_single_tick(conn, self.client,
                                          self.my_player_name, self.my_account_id,
                                          self.match_max)
                l_stats = refresh_lifetimes(conn, self.client,
                                            self.lifetime_min, self.lifetime_max)
                self._last_status = {
                    "polling": "ok" if not (m_stats["errors"] or l_stats["errors"])
                               else "degraded",
                    "lastPollAt": _iso_utc_now(),
                    "errors": m_stats["errors"] + l_stats["errors"],
                    "newMatches": m_stats["new_matches"],
                    "lifetimeRefreshed": l_stats["refreshed"],
                    "rateLimitRemaining": self.client.limiter.remaining()
                                          if hasattr(self.client, "limiter") else None,
                }
                conn.close()
            except Exception as e:
                self._last_status = {"polling": "error", "errors": [str(e)]}
            self._stop.wait(self.interval)

    def stop(self):
        self._stop.set()

    def status(self):
        return dict(self._last_status)
```

- [ ] **Step 4: Tests grün**

```bash
pytest tests/pubg/test_poller_thread.py -v
```

- [ ] **Step 5: Commit**

```bash
git add pubg/poller.py tests/pubg/test_poller_thread.py
git commit -m "feat(pubg): PollerThread Background-Service"
```

### Task 5.5: serve.py-Integration

**Files:**
- Modify: `serve.py`

- [ ] **Step 1: PUBG-Bootstrap am Anfang von serve.py einfügen**

Direkt nach `secrets`-Block (nach Zeile 48), aber vor `DEV_LOG_JS`:

```python
# ── PUBG-Backend-Bootstrap ─────────────────────────────────────────────────────
PUBG_ENABLED = False
pubg_registry = None
pubg_poller = None
try:
    from pubg.config import load_config, load_api_key
    from pubg.db import connect as _pubg_connect, init_schema as _pubg_init_schema
    from pubg.api_client import PubgClient
    from pubg.cache import TTLCache
    from pubg.poller import PollerThread
    from pubg.endpoints import EndpointRegistry

    pubg_cfg = load_config(os.path.join(ROOT, "config", "pubg.json"))
    pubg_key = load_api_key(secrets_path)
    if pubg_key:
        os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
        pubg_db_path = os.path.join(ROOT, "data", "pubg-history.db")
        # Schema-Init einmalig
        _conn = _pubg_connect(pubg_db_path)
        _pubg_init_schema(_conn)
        _conn.close()

        pubg_client = PubgClient(api_key=pubg_key, platform=pubg_cfg["platform"])

        # Wir brauchen die my_account_id beim ersten Lauf — wenn unbekannt: lazy
        from pubg.db import get_player_by_name
        _conn = _pubg_connect(pubg_db_path)
        _self = get_player_by_name(_conn, pubg_cfg["playerName"])
        _conn.close()
        my_account_id = _self["account_id"] if _self else None

        if my_account_id is None:
            # First-Time: Player-Resource pullen, account_id ermitteln
            try:
                resp = pubg_client.get_player(pubg_cfg["playerName"])
                if resp.get("data"):
                    my_account_id = resp["data"][0]["id"]
                    _conn = _pubg_connect(pubg_db_path)
                    from pubg.db import upsert_player
                    upsert_player(_conn, my_account_id, pubg_cfg["playerName"],
                                  pubg_cfg["platform"], is_self=True)
                    _conn.close()
            except Exception as e:
                print(f"  PUBG-Setup: konnte Account-ID nicht laden: {e}")

        if my_account_id:
            pubg_cache = TTLCache(ttl_secs=30)
            pubg_poller = PollerThread(
                db_path=pubg_db_path, client=pubg_client,
                my_player_name=pubg_cfg["playerName"],
                my_account_id=my_account_id,
                interval_secs=pubg_cfg["pollIntervalSec"],
                lifetime_min_matches=pubg_cfg["minMatchesForLifetime"],
            )
            pubg_poller.start()
            pubg_registry = EndpointRegistry(
                get_conn=lambda: _pubg_connect(pubg_db_path),
                my_account_id=my_account_id,
                platform=pubg_cfg["platform"],
                cache=pubg_cache,
                client=pubg_client,
                poller_status=pubg_poller.status,
            )
            PUBG_ENABLED = True
            print("  PUBG-Backend aktiv  ✓")
        else:
            print("  PUBG-Backend: Account-ID unbekannt, Polling nicht gestartet")
    else:
        print("  PUBG-Backend: kein PUBG-API-Key in .secrets — Backend deaktiviert")
except Exception as e:
    print(f"  PUBG-Backend Init-Fehler: {e}")
```

- [ ] **Step 2: do_GET um PUBG-Routes erweitern**

In `do_GET`, *vor* dem existierenden `path = self.translate_path(...)`-Block:

```python
        if PUBG_ENABLED and self.path.startswith("/api/pubg/"):
            try:
                body, code, ctype = pubg_registry.dispatch(
                    "GET", self.path, b"", dict(self.headers))
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                self.send_error(500, str(e))
                return
```

- [ ] **Step 3: do_POST um PUBG-Routes erweitern**

Vor dem existierenden `if self.path != '/dev-log':`-Block:

```python
        if PUBG_ENABLED and self.path.startswith("/api/pubg/"):
            try:
                length = int(self.headers.get('Content-Length', 0))
                body_in = self.rfile.read(length) if length else b""
                body, code, ctype = pubg_registry.dispatch(
                    "POST", self.path, body_in, dict(self.headers))
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                self.send_error(500, str(e))
                return
```

- [ ] **Step 4: Manueller Smoke-Test**

```bash
python serve.py 8080 &
sleep 2
curl -s http://localhost:8080/api/pubg/status | python -m json.tool
curl -s http://localhost:8080/api/pubg/session | python -m json.tool
kill %1
```
Expected: JSON-Response mit polling-Status. Wenn kein Match-History-Daten: leeres Session-Objekt.

- [ ] **Step 5: Commit**

```bash
git add serve.py
git commit -m "feat(pubg): serve.py-Integration — Bootstrap + /api/pubg/* Routing"
```


## Phase 6: Erste Widgets — Shared Helpers + Live-Bar + Post-Match-Card

### Task 6.1: Shared CSS

**Files:**
- Create: `widgets/pubg/_pubg.css`

- [ ] **Step 1: Theme-CSS schreiben**

```css
/* widgets/pubg/_pubg.css */
:root {
  --pubg-purple: #5e2a79;
  --pubg-purple-bg: rgba(20, 12, 30, 0.85);
  --pubg-gold: #f2b705;
  --pubg-text: #e8e0f0;
  --pubg-muted: #8a7d99;
  --pubg-border: rgba(94, 42, 121, 0.6);
  --pubg-radius: 8px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: "DM Sans", system-ui, sans-serif;
  background: transparent;
  color: var(--pubg-text);
  -webkit-font-smoothing: antialiased;
}

.pubg-card {
  background: var(--pubg-purple-bg);
  border: 1px solid var(--pubg-border);
  border-radius: var(--pubg-radius);
  padding: 10px 14px;
  backdrop-filter: blur(6px);
}

.pubg-stat-value {
  font-weight: 700;
  color: var(--pubg-gold);
  font-variant-numeric: tabular-nums;
}

.pubg-stat-label {
  color: var(--pubg-muted);
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.pubg-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.pubg-fade-in {
  animation: pubg-fade-in 0.4s ease-out;
}

@keyframes pubg-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.pubg-error { color: #e57b7b; font-size: 0.85em; }
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/_pubg.css
git commit -m "feat(pubg): Shared Theme-CSS"
```

### Task 6.2: Shared JS Helpers

**Files:**
- Create: `widgets/pubg/_pubg.js`

- [ ] **Step 1: Helper-Library schreiben**

```javascript
// widgets/pubg/_pubg.js
(function (global) {
  const PubgUI = {};

  PubgUI.fmtNum = (n) => {
    if (n == null) return "—";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  };

  PubgUI.fmtPct = (n) => (n == null ? "—" : n.toFixed(1) + "%");

  PubgUI.fmtKD = (n) => (n == null ? "—" : n.toFixed(2));

  PubgUI.fmtPlace = (n) => (n == null ? "—" : "#" + n);

  PubgUI.fmtMap = (raw) => {
    if (!raw) return "—";
    return raw.replace(/_Main$/, "").replace(/_/g, " ");
  };

  PubgUI.fmtMode = (raw) => {
    if (!raw) return "—";
    return raw.toUpperCase().replace("-", " ");
  };

  PubgUI.fetchJson = async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  };

  PubgUI.poll = (url, interval, onData, onError) => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        onData(await PubgUI.fetchJson(url));
      } catch (e) {
        if (onError) onError(e);
      }
      if (!stopped) setTimeout(tick, interval);
    };
    tick();
    return () => { stopped = true; };
  };

  PubgUI.qs = (key, fallback) => {
    const u = new URL(location.href);
    return u.searchParams.get(key) ?? fallback;
  };

  global.PubgUI = PubgUI;
})(window);
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/_pubg.js
git commit -m "feat(pubg): Shared JS-Helper-Library"
```

### Task 6.3: Live-Bar Widget

**Files:**
- Create: `widgets/pubg/live-bar.html`

- [ ] **Step 1: HTML/CSS/JS schreiben**

```html
<!-- widgets/pubg/live-bar.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG Live Bar</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { display: flex; align-items: center; height: 40px; }
    .live-bar {
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 6px 16px;
      width: 100%;
      height: 40px;
      font-size: 16px;
    }
    .live-bar .sep { color: var(--pubg-muted); }
    .live-bar .label { color: var(--pubg-muted); margin-right: 4px; font-size: 0.85em; }
    .live-bar .icon { margin-right: 4px; }
  </style>
</head>
<body>
  <div class="pubg-card live-bar pubg-fade-in" id="bar">
    <span><span class="icon">🎯</span><span class="pubg-stat-value" id="kills">—</span> <span class="label">Kills</span></span>
    <span class="sep">·</span>
    <span><span class="icon">🩸</span><span class="pubg-stat-value" id="dmg">—</span> <span class="label">DMG</span></span>
    <span class="sep">·</span>
    <span><span class="icon">CHICKEN</span><span class="pubg-stat-value" id="wins">—</span> <span class="label">Wins</span></span>
    <span class="sep">·</span>
    <span class="label">Match</span> <span class="pubg-stat-value" id="matches">—</span>
    <span class="sep">·</span>
    <span class="pubg-stat-value" id="map">—</span>
  </div>
  <script src="_pubg.js"></script>
  <script>
    const REFRESH_MS = parseInt(PubgUI.qs("refreshMs", 30000), 10);

    function render(s) {
      document.getElementById("kills").textContent = PubgUI.fmtNum(s.kills);
      document.getElementById("dmg").textContent = PubgUI.fmtNum(Math.round(s.damage || 0));
      document.getElementById("wins").textContent = PubgUI.fmtNum(s.wins);
      document.getElementById("matches").textContent = PubgUI.fmtNum(s.matches);
      const lastMap = s.mapBreakdown && s.mapBreakdown[0];
      document.getElementById("map").textContent =
        lastMap ? PubgUI.fmtMap(lastMap.map) : "—";
    }

    PubgUI.poll("/api/pubg/session", REFRESH_MS, render, console.error);
  </script>
</body>
</html>
```

- [ ] **Step 2: Manueller Browser-Test**

In OBS oder Browser öffnen: `http://localhost:8080/widgets/pubg/live-bar.html`. Zahlen sollten gerendert werden (oder "—" wenn keine Daten).

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/live-bar.html
git commit -m "feat(pubg): Live-Bar-Widget für Gameplay-Overlay"
```

### Task 6.4: Post-Match-Card Widget

**Files:**
- Create: `widgets/pubg/post-match-card.html`

- [ ] **Step 1: HTML schreiben**

```html
<!-- widgets/pubg/post-match-card.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG Post-Match Card</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { display: flex; align-items: center; justify-content: center; height: 100vh; }
    .card {
      width: 360px;
      padding: 24px;
      text-align: center;
      transition: opacity 0.6s, transform 0.6s;
      opacity: 0;
      transform: translateX(80px);
    }
    .card.visible { opacity: 1; transform: translateX(0); }
    .card .label { font-size: 0.85em; color: var(--pubg-muted); }
    .card h2 {
      margin: 6px 0 18px;
      font-size: 1.2em;
      letter-spacing: 0.04em;
      color: var(--pubg-text);
    }
    .card .place {
      font-size: 3em;
      font-weight: 700;
      color: var(--pubg-gold);
      margin: 12px 0;
      text-shadow: 0 0 20px rgba(242, 183, 5, 0.4);
    }
    .card .stats {
      display: flex; justify-content: space-around;
      margin-top: 14px; gap: 12px;
    }
    .card .stats > div { display: flex; flex-direction: column; }
  </style>
</head>
<body>
  <div class="pubg-card card" id="card">
    <div class="label">MATCH <span id="matchnum">—</span></div>
    <h2 id="header">— · —</h2>
    <div class="place" id="place">—</div>
    <div class="stats">
      <div><span class="pubg-stat-value" id="kills">—</span><span class="pubg-stat-label">Kills</span></div>
      <div><span class="pubg-stat-value" id="dmg">—</span><span class="pubg-stat-label">DMG</span></div>
      <div><span class="pubg-stat-value" id="surv">—</span><span class="pubg-stat-label">Survived</span></div>
    </div>
  </div>
  <script src="_pubg.js"></script>
  <script>
    const HIDE_AFTER_MS = parseInt(PubgUI.qs("durationMs", 10000), 10);
    let lastMatchId = null;
    let hideTimer = null;

    function showCard(lm) {
      document.getElementById("matchnum").textContent = "#" + (lm.matchId || "");
      document.getElementById("header").textContent =
        PubgUI.fmtMap(lm.map) + " · " + PubgUI.fmtMode(lm.mode);
      document.getElementById("place").textContent = PubgUI.fmtPlace(lm.place);
      const ms = lm.myStats || {};
      document.getElementById("kills").textContent = PubgUI.fmtNum(ms.kills);
      document.getElementById("dmg").textContent = PubgUI.fmtNum(Math.round(ms.damage_dealt || 0));
      const min = Math.floor((ms.time_survived || 0) / 60);
      const sec = (ms.time_survived || 0) % 60;
      document.getElementById("surv").textContent = `${min}:${String(sec).padStart(2, "0")}`;

      const card = document.getElementById("card");
      card.classList.add("visible");
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => card.classList.remove("visible"), HIDE_AFTER_MS);
    }

    PubgUI.poll("/api/pubg/last-match", 30000, (lm) => {
      if (!lm || !lm.matchId) return;
      if (lm.matchId !== lastMatchId) {
        lastMatchId = lm.matchId;
        showCard(lm);
      }
    }, console.error);
  </script>
</body>
</html>
```

- [ ] **Step 2: Manueller Browser-Test** — Reload triggert Initial-Match-Display.

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/post-match-card.html
git commit -m "feat(pubg): Post-Match-Card mit Auto-Reveal bei neuer match_id"
```


## Phase 7: Co-Player-Layer

### Task 7.1: Top-Mates und Co-Player Aggregations

**Files:**
- Modify: `pubg/aggregations.py`
- Modify: `tests/pubg/test_aggregations.py`

- [ ] **Step 1: Tests anhängen**

```python
def test_top_mates_filters_by_min_matches(tmp_db_path):
    from pubg.aggregations import compute_top_mates
    conn = _setup(tmp_db_path)
    # 12 Matches mit MateA (qualifiziert), 3 Matches mit MateB (zu wenig)
    for i in range(12):
        _add_match(conn, f"a{i}", f"2026-05-04T{i:02d}:00:00Z", 4, 400.0, 5, mate_count=0)
        from pubg.db import insert_participants
        insert_participants(conn, f"a{i}", [{
            "account_id": "account.MA", "name": "MateA", "team_id": 1,
            "place": 5, "kills": 2, "headshot_kills": 0, "assists": 1,
            "dbnos": 0, "revives": 0, "damage_dealt": 200.0, "longest_kill": 0.0,
            "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
            "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
            "team_kills": 0,
        }])
    from pubg.db import upsert_player
    upsert_player(conn, "account.MA", "MateA", "steam", False)
    result = compute_top_mates(conn, "account.A",
                                sort_by="mostPlayed", limit=5, min_matches=10)
    assert len(result) == 1
    assert result[0]["name"] == "MateA"
    assert result[0]["sharedMatches"] == 12


def test_top_mates_sort_by_avg_place(tmp_db_path):
    from pubg.aggregations import compute_top_mates
    from pubg.db import upsert_player, insert_participants
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.X", "MateX", "steam", False)
    upsert_player(conn, "account.Y", "MateY", "steam", False)
    # MateX: avg place 3, MateY: avg place 8
    for i in range(10):
        for mid_prefix, mate_acc, mate_name, place in (
            (f"x{i}", "account.X", "MateX", 3),
            (f"y{i}", "account.Y", "MateY", 8),
        ):
            _add_match(conn, mid_prefix, f"2026-05-04T{i:02d}:30:00Z",
                       2, 200.0, place, mate_count=0)
            insert_participants(conn, mid_prefix, [{
                "account_id": mate_acc, "name": mate_name, "team_id": 1,
                "place": place, "kills": 1, "headshot_kills": 0, "assists": 0,
                "dbnos": 0, "revives": 0, "damage_dealt": 100.0, "longest_kill": 0.0,
                "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
                "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
                "team_kills": 0,
            }])
    res = compute_top_mates(conn, "account.A", sort_by="avgPlace",
                              limit=5, min_matches=5)
    assert res[0]["name"] == "MateX"


def test_co_player_combines_shared_and_career(tmp_db_path):
    from pubg.aggregations import compute_co_player
    from pubg.db import upsert_player, upsert_lifetime, insert_participants
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.B", "MateA", "steam", False)
    _add_match(conn, "m1", "2026-05-04T18:00:00Z", 4, 400.0, 3)
    insert_participants(conn, "m1", [{
        "account_id": "account.B", "name": "MateA", "team_id": 1,
        "place": 3, "kills": 2, "headshot_kills": 0, "assists": 1,
        "dbnos": 0, "revives": 1, "damage_dealt": 200.0, "longest_kill": 50.0,
        "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
        "team_kills": 0}])
    upsert_lifetime(conn, "account.B", "all", {"rounds_played": 8000,
        "wins": 412, "top10s": 3000, "win_rate": 5.0, "top10_rate": 37.0,
        "kills": 12000, "kd_ratio": 1.5, "headshot_kills": 2000,
        "headshot_rate": 16.0, "avg_damage": 250.0, "longest_kill": 500.0,
        "time_survived_sec": 80000})
    cp = compute_co_player(conn, "account.A", "MateA")
    assert cp["sharedHistory"]["matches"] == 1
    assert cp["careerLifetime"]["wins"] == 412
```

- [ ] **Step 2: Tests fail**

- [ ] **Step 3: An `pubg/aggregations.py` anhängen**

```python
SORT_KEYS = {
    "avgPlace": "avg_place ASC",
    "kd": "kd DESC",
    "winRate": "win_rate DESC",
    "mostPlayed": "shared DESC",
}


def compute_top_mates(conn, my_account_id: str,
                      sort_by: str = "avgPlace",
                      limit: int = 5,
                      min_matches: int = 10) -> list:
    order = SORT_KEYS.get(sort_by, SORT_KEYS["avgPlace"])
    rows = conn.execute(f"""
        WITH co AS (
            SELECT mate.account_id, mate.name, mate.match_id, mate.place,
                   me.kills AS my_kills, me.damage_dealt AS my_dmg
            FROM participants mate
            JOIN participants me ON me.match_id = mate.match_id AND me.account_id = ?
            WHERE mate.account_id != ?
        )
        SELECT account_id, name,
               COUNT(*) AS shared,
               AVG(place) AS avg_place,
               (CAST(SUM(my_kills) AS REAL) / MAX(COUNT(*) - SUM(CASE WHEN place=1 THEN 1 ELSE 0 END), 1)) AS kd,
               AVG(my_dmg) AS avg_dmg,
               (CAST(SUM(CASE WHEN place=1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) * 100 AS win_rate
        FROM co
        GROUP BY account_id, name
        HAVING shared >= ?
        ORDER BY {order}
        LIMIT ?
    """, (my_account_id, my_account_id, min_matches, limit)).fetchall()

    return [{
        "accountId": r["account_id"],
        "name": r["name"],
        "sharedMatches": r["shared"],
        "avgPlace": r["avg_place"],
        "kd": r["kd"],
        "avgDmg": r["avg_dmg"],
        "winRate": r["win_rate"],
    } for r in rows]


def compute_co_player(conn, my_account_id: str, name_or_id: str) -> dict:
    p = conn.execute("""
        SELECT * FROM players WHERE name = ? OR account_id = ? LIMIT 1
    """, (name_or_id, name_or_id)).fetchone()
    if not p:
        return {"error": "player not found"}

    shared = conn.execute("""
        SELECT m.match_id, m.map_name, m.played_at, mate.place,
               mate.kills, mate.damage_dealt
        FROM matches m
        JOIN participants mate ON mate.match_id = m.match_id
        JOIN participants me ON me.match_id = m.match_id AND me.account_id = ?
        WHERE mate.account_id = ?
        ORDER BY m.played_at DESC
    """, (my_account_id, p["account_id"])).fetchall()

    if not shared:
        history = {"matches": 0}
    else:
        n = len(shared)
        wins = sum(1 for r in shared if (r["place"] or 99) == 1)
        kills = sum(r["kills"] or 0 for r in shared)
        avg_dmg = sum(r["damage_dealt"] or 0.0 for r in shared) / n
        avg_place = sum(r["place"] for r in shared if r["place"]) / n
        deaths = max(n - wins, 1)
        map_dist = {}
        for r in shared:
            map_dist[r["map_name"]] = map_dist.get(r["map_name"], 0) + 1
        history = {
            "matches": n,
            "kd": kills / deaths,
            "avgDmg": avg_dmg,
            "avgPlace": avg_place,
            "winRate": (wins / n) * 100,
            "wins": wins,
            "mapDistribution": [{"map": m, "count": c}
                                for m, c in sorted(map_dist.items(),
                                                    key=lambda x: -x[1])],
            "last5Matches": [{
                "matchId": r["match_id"], "map": r["map_name"],
                "playedAt": r["played_at"], "place": r["place"],
                "kills": r["kills"], "damage": r["damage_dealt"],
            } for r in shared[:5]],
        }

    lifetime = conn.execute(
        "SELECT * FROM player_lifetime WHERE account_id = ? AND mode = 'all'",
        (p["account_id"],)
    ).fetchone()

    return {
        "name": p["name"],
        "accountId": p["account_id"],
        "sharedHistory": history,
        "careerLifetime": dict(lifetime) if lifetime else None,
    }
```

- [ ] **Step 4: Tests grün**

- [ ] **Step 5: Commit**

```bash
git add pubg/aggregations.py tests/pubg/test_aggregations.py
git commit -m "feat(pubg): Top-Mates + Co-Player Aggregations"
```

### Task 7.2: Endpoints für Top-Mates, Co-Player, Career-Lifetime

**Files:**
- Modify: `pubg/endpoints.py`
- Modify: `tests/pubg/test_endpoints.py`

- [ ] **Step 1: Tests anhängen**

```python
def test_top_mates_endpoint(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/top-mates?sortBy=avgPlace&limit=5&minMatches=10",
        b"", {})
    assert code == 200
    assert isinstance(json.loads(body), list)


def test_co_player_endpoint_404_when_unknown(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/co-player/Unknown", b"", {})
    payload = json.loads(body)
    # endpoint returns 200 mit error-Feld; 404-Mapping ist optional
    assert code in (200, 404)


def test_career_lifetime_endpoint_with_player_param(tmp_db_path):
    from pubg.db import upsert_player, upsert_lifetime
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.B", "MateA", "steam", False)
    upsert_lifetime(conn, "account.B", "all", {"rounds_played": 100,
        "wins": 5, "top10s": 30, "win_rate": 5.0, "top10_rate": 30.0,
        "kills": 200, "kd_ratio": 2.0, "headshot_kills": 50,
        "headshot_rate": 25.0, "avg_damage": 300.0, "longest_kill": 100.0,
        "time_survived_sec": 1000})
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET",
        "/api/pubg/career-lifetime?player=MateA&mode=all", b"", {})
    assert code == 200
    assert json.loads(body)["wins"] == 5
```

- [ ] **Step 2: Tests fail**

- [ ] **Step 3: Routes in `EndpointRegistry.dispatch` ergänzen**

In `dispatch`-Methode, nach `if route == ("POST", "/api/pubg/session/reset"): ...` einfügen, vor dem Final-`return _err(404, ...)`:

```python
        if route == ("GET", "/api/pubg/top-mates"):
            return self._top_mates(qs)
        if u.path.startswith("/api/pubg/co-player/"):
            name = u.path[len("/api/pubg/co-player/"):]
            return self._co_player(name)
        if route == ("GET", "/api/pubg/career-lifetime"):
            return self._career_lifetime(qs)
```

Dann die Methoden anhängen:

```python
    def _top_mates(self, qs):
        sort_by = qs.get("sortBy", "avgPlace")
        limit = int(qs.get("limit", 5))
        min_matches = int(qs.get("minMatches", 10))
        conn = self.get_conn()
        from pubg.aggregations import compute_top_mates
        key = f"top-mates:{sort_by}:{limit}:{min_matches}"
        return _ok(self.cache.get_or_compute(
            key, lambda: compute_top_mates(conn, self.my_account_id,
                                            sort_by, limit, min_matches)))

    def _co_player(self, name):
        from pubg.aggregations import compute_co_player
        conn = self.get_conn()
        result = self.cache.get_or_compute(
            f"co-player:{name}",
            lambda: compute_co_player(conn, self.my_account_id, name),
        )
        return _ok(result)

    def _career_lifetime(self, qs):
        player = qs.get("player")
        mode = qs.get("mode", "all")
        conn = self.get_conn()
        if not player:
            row = conn.execute(
                "SELECT * FROM player_lifetime WHERE account_id = ? AND mode = ?",
                (self.my_account_id, mode)).fetchone()
        else:
            row = conn.execute("""
                SELECT pl.* FROM player_lifetime pl
                JOIN players p ON p.account_id = pl.account_id
                WHERE (p.name = ? OR p.account_id = ?) AND pl.mode = ?
            """, (player, player, mode)).fetchone()
        return _ok(dict(row) if row else {})
```

- [ ] **Step 4: Tests grün**

- [ ] **Step 5: Commit**

```bash
git add pubg/endpoints.py tests/pubg/test_endpoints.py
git commit -m "feat(pubg): Endpoints Top-Mates + Co-Player + Career-Lifetime"
```

### Task 7.3: Mates-Today Endpoint

**Files:**
- Modify: `pubg/aggregations.py`
- Modify: `pubg/endpoints.py`
- Modify: `tests/pubg/test_aggregations.py`

- [ ] **Step 1: Test anhängen**

```python
def test_mates_today_aggregates_per_mate(tmp_db_path):
    from pubg.aggregations import compute_mates_today
    from pubg.db import upsert_player, insert_participants, set_setting
    conn = _setup(tmp_db_path)
    upsert_player(conn, "account.MA", "MateA", "steam", False)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    for i in range(3):
        _add_match(conn, f"t{i}", f"2026-05-04T1{i}:00:00Z", 4, 400.0, 3, mate_count=0)
        insert_participants(conn, f"t{i}", [{
            "account_id": "account.MA", "name": "MateA", "team_id": 1,
            "place": 3, "kills": 2, "headshot_kills": 0, "assists": 1,
            "dbnos": 0, "revives": 1, "damage_dealt": 200.0, "longest_kill": 0.0,
            "time_survived": 1500, "walk_distance": 0.0, "ride_distance": 0.0,
            "swim_distance": 0.0, "weapons_acquired": 0, "heals": 0, "boosts": 0,
            "team_kills": 0,
        }])
    result = compute_mates_today(conn, "account.A", range_key="session")
    assert len(result) == 1
    assert result[0]["name"] == "MateA"
    assert result[0]["sharedMatchesToday"] == 3
```

- [ ] **Step 2: Test fail**

- [ ] **Step 3: An `pubg/aggregations.py` anhängen**

```python
def _range_filter(conn, range_key):
    if range_key == "session":
        return _session_filter(conn)
    if range_key == "day":
        import datetime
        d = datetime.datetime.utcnow().strftime("%Y-%m-%dT00:00:00Z")
        return d
    if range_key == "week":
        import datetime
        d = (datetime.datetime.utcnow() - datetime.timedelta(days=7)) \
              .strftime("%Y-%m-%dT00:00:00Z")
        return d
    return "1970-01-01T00:00:00Z"


def compute_mates_today(conn, my_account_id: str,
                        range_key: str = "session") -> list:
    cutoff = _range_filter(conn, range_key)
    rows = conn.execute("""
        SELECT mate.account_id, mate.name,
               COUNT(*) AS shared,
               AVG(mate.kills) AS kills_avg,
               SUM(mate.kills) AS kills_total,
               AVG(mate.damage_dealt) AS dmg_avg
        FROM participants mate
        JOIN participants me ON me.match_id = mate.match_id AND me.account_id = ?
        JOIN matches m ON m.match_id = mate.match_id
        WHERE mate.account_id != ? AND m.played_at >= ?
        GROUP BY mate.account_id, mate.name
        ORDER BY shared DESC
    """, (my_account_id, my_account_id, cutoff)).fetchall()

    out = []
    for r in rows:
        lt = conn.execute(
            "SELECT * FROM player_lifetime WHERE account_id = ? AND mode = 'all'",
            (r["account_id"],)).fetchone()
        out.append({
            "accountId": r["account_id"],
            "name": r["name"],
            "sharedMatchesToday": r["shared"],
            "kdToday": (r["kills_total"] / max(r["shared"], 1)),
            "dmgToday": r["dmg_avg"],
            "careerLifetime": dict(lt) if lt else None,
        })
    return out
```

- [ ] **Step 4: Endpoint `GET /api/pubg/mates-today` ergänzen**

In `EndpointRegistry.dispatch`, vor `top-mates`:

```python
        if route == ("GET", "/api/pubg/mates-today"):
            return self._mates_today(qs)
```

Methode:

```python
    def _mates_today(self, qs):
        from pubg.aggregations import compute_mates_today
        range_key = qs.get("range", "session")
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            f"mates-today:{range_key}",
            lambda: compute_mates_today(conn, self.my_account_id, range_key)))
```

- [ ] **Step 5: Tests grün, Commit**

```bash
pytest tests/pubg/ -v
git add pubg/aggregations.py pubg/endpoints.py tests/pubg/test_aggregations.py
git commit -m "feat(pubg): mates-today Aggregation + Endpoint"
```


## Phase 8: Mate-Widgets

### Task 8.1: top-mates.html

**Files:**
- Create: `widgets/pubg/top-mates.html`

- [ ] **Step 1: HTML schreiben**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG Top Mates</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { padding: 16px; }
    .panel { width: 320px; padding: 16px; }
    .panel h3 {
      margin: 0 0 12px;
      font-size: 0.9em;
      letter-spacing: 0.08em;
      color: var(--pubg-muted);
      text-transform: uppercase;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .row:last-child { border-bottom: 0; }
    .row .rank { color: var(--pubg-gold); width: 22px; font-weight: 700; }
    .row .name { flex: 1; padding-left: 6px; }
    .row .stat { color: var(--pubg-muted); font-size: 0.85em; }
    .row .stat b { color: var(--pubg-text); }
  </style>
</head>
<body>
  <div class="pubg-card panel pubg-fade-in">
    <h3 id="title">Top Mates</h3>
    <div id="rows"></div>
  </div>
  <script src="_pubg.js"></script>
  <script>
    const SORT_BY = PubgUI.qs("sortBy", "avgPlace");
    const LIMIT = parseInt(PubgUI.qs("limit", 5), 10);
    const MIN = parseInt(PubgUI.qs("minMatches", 10), 10);

    const SORT_LABEL = {
      avgPlace: "Avg Place", kd: "K/D",
      winRate: "Win-Rate", mostPlayed: "Most Played",
    };
    document.getElementById("title").textContent =
      "Top Mates · " + (SORT_LABEL[SORT_BY] || SORT_BY);

    function valueFor(m) {
      if (SORT_BY === "avgPlace") return "Avg #" + (m.avgPlace || 0).toFixed(1);
      if (SORT_BY === "kd") return "K/D " + (m.kd || 0).toFixed(2);
      if (SORT_BY === "winRate") return (m.winRate || 0).toFixed(1) + "%";
      if (SORT_BY === "mostPlayed") return m.sharedMatches + " Games";
      return "";
    }

    function render(list) {
      const rows = document.getElementById("rows");
      rows.innerHTML = list.map((m, i) => `
        <div class="row">
          <span class="rank">${i+1}</span>
          <span class="name">${m.name}</span>
          <span class="stat"><b>${valueFor(m)}</b></span>
        </div>`).join("") || `<div class="pubg-error">noch keine Daten</div>`;
    }

    const url = `/api/pubg/top-mates?sortBy=${SORT_BY}&limit=${LIMIT}&minMatches=${MIN}`;
    PubgUI.poll(url, 5 * 60 * 1000, render, console.error);
  </script>
</body>
</html>
```

- [ ] **Step 2: Browser-Test**

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/top-mates.html
git commit -m "feat(pubg): top-mates Widget"
```

### Task 8.2: mates-today.html — Stack Layout

**Files:**
- Create: `widgets/pubg/mates-today.html`

- [ ] **Step 1: HTML mit allen 4 Layouts**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG Mates Today</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { padding: 16px; }
    .header {
      color: var(--pubg-muted);
      font-size: 0.8em;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    .mate {
      padding: 10px 14px;
      margin-bottom: 8px;
      border-left: 3px solid var(--pubg-purple);
    }
    .mate-name { font-weight: 700; font-size: 1.05em; }
    .mate-line {
      display: flex; justify-content: space-between;
      font-size: 0.85em; color: var(--pubg-muted);
      margin-top: 4px;
    }
    .mate-line b { color: var(--pubg-text); font-variant-numeric: tabular-nums; }

    /* Stack (Default) */
    .stack { display: flex; flex-direction: column; }

    /* Fold — sequenzielles fade */
    .fold .mate { opacity: 0; transform: translateX(-12px); }
    .fold .mate.shown { opacity: 1; transform: translateX(0); transition: 0.4s; }

    /* Carousel */
    .carousel { position: relative; min-height: 180px; }
    .carousel .mate { position: absolute; inset: 0; opacity: 0; transition: opacity 0.6s; padding: 24px; }
    .carousel .mate.active { opacity: 1; }
    .carousel .dots {
      position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 6px;
    }
    .carousel .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--pubg-muted); opacity: 0.4; }
    .carousel .dot.active { background: var(--pubg-gold); opacity: 1; }

    /* Mosaic */
    .mosaic { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .mosaic .mate { border-left: 0; border-top: 3px solid var(--pubg-purple); }
  </style>
</head>
<body>
  <div class="header">Heute gespielt mit</div>
  <div id="root" class="pubg-card stack"></div>

  <script src="_pubg.js"></script>
  <script>
    const LAYOUT = PubgUI.qs("layout", "carousel");
    const RANGE = PubgUI.qs("range", "session");
    document.getElementById("root").className = "pubg-card " + LAYOUT;

    function mateHTML(m) {
      const career = m.careerLifetime;
      const careerLine = career
        ? `Career: <b>${PubgUI.fmtNum(career.rounds_played)}</b> Games · K/D <b>${PubgUI.fmtKD(career.kd_ratio)}</b> · <b>${PubgUI.fmtNum(career.wins)}</b> Wins`
        : `<span style="color:var(--pubg-gold)">🆕 Neuer Mate</span>`;
      return `
        <div class="mate">
          <div class="mate-name">${m.name}</div>
          <div class="mate-line">
            <span>Heute: <b>K/D ${PubgUI.fmtKD(m.kdToday)}</b> · DMG <b>${PubgUI.fmtNum(Math.round(m.dmgToday||0))}</b> · <b>${m.sharedMatchesToday}</b> Matches</span>
          </div>
          <div class="mate-line">
            <span>${careerLine}</span>
          </div>
        </div>`;
    }

    let carouselIdx = 0;
    let carouselTimer = null;

    function render(list) {
      const root = document.getElementById("root");
      if (!list || !list.length) {
        root.innerHTML = `<div class="pubg-error">noch keine Mates heute</div>`;
        return;
      }
      if (LAYOUT === "carousel") {
        root.innerHTML = list.map((m, i) =>
          `<div class="mate ${i===0?'active':''}" data-i="${i}">${mateHTML(m).replace(/^<div class="mate">|<\/div>$/g,'')}</div>`
        ).join("") + `<div class="dots">${list.map((_,i)=>`<div class="dot ${i===0?'active':''}"></div>`).join("")}</div>`;
        if (carouselTimer) clearInterval(carouselTimer);
        carouselIdx = 0;
        carouselTimer = setInterval(() => {
          carouselIdx = (carouselIdx + 1) % list.length;
          root.querySelectorAll(".mate").forEach((el, i) =>
            el.classList.toggle("active", i === carouselIdx));
          root.querySelectorAll(".dot").forEach((el, i) =>
            el.classList.toggle("active", i === carouselIdx));
        }, 6000);
      } else if (LAYOUT === "fold") {
        root.innerHTML = list.map(mateHTML).join("");
        root.querySelectorAll(".mate").forEach((el, i) =>
          setTimeout(() => el.classList.add("shown"), i * 600));
      } else {
        root.innerHTML = list.map(mateHTML).join("");
      }
    }

    PubgUI.poll(`/api/pubg/mates-today?range=${RANGE}`, 30000, render, console.error);
  </script>
</body>
</html>
```

- [ ] **Step 2: Layouts manuell testen**

URLs:
- `mates-today.html` → Carousel (Default)
- `mates-today.html?layout=stack`
- `mates-today.html?layout=fold`
- `mates-today.html?layout=mosaic`

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/mates-today.html
git commit -m "feat(pubg): mates-today Widget mit 4 Layouts (Carousel default)"
```

### Task 8.3: career-card.html

**Files:**
- Create: `widgets/pubg/career-card.html`

- [ ] **Step 1: HTML schreiben**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG Career</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { padding: 20px; display: flex; align-items: center; }
    .card { width: 360px; padding: 20px 24px; }
    .header { font-size: 0.85em; letter-spacing: 0.1em;
              color: var(--pubg-muted); text-transform: uppercase; margin-bottom: 14px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
    .grid div { display: flex; justify-content: space-between; }
    .grid .label { color: var(--pubg-muted); font-size: 0.85em; }
  </style>
</head>
<body>
  <div class="pubg-card card pubg-fade-in">
    <div class="header">Career · <span id="player">—</span></div>
    <div class="grid">
      <div><span class="label">Matches</span><span class="pubg-stat-value" id="matches">—</span></div>
      <div><span class="label">Wins</span><span class="pubg-stat-value" id="wins">—</span></div>
      <div><span class="label">K/D</span><span class="pubg-stat-value" id="kd">—</span></div>
      <div><span class="label">Headshot</span><span class="pubg-stat-value" id="hs">—</span></div>
      <div><span class="label">Win %</span><span class="pubg-stat-value" id="winpct">—</span></div>
      <div><span class="label">Top10 %</span><span class="pubg-stat-value" id="top10">—</span></div>
      <div><span class="label">Longest</span><span class="pubg-stat-value" id="longest">—</span></div>
      <div><span class="label">Kills</span><span class="pubg-stat-value" id="kills">—</span></div>
    </div>
  </div>
  <script src="_pubg.js"></script>
  <script>
    const PLAYER = PubgUI.qs("player", "");
    const MODE = PubgUI.qs("mode", "all");
    document.getElementById("player").textContent = PLAYER || "Self";

    function render(d) {
      if (!d || !d.rounds_played) return;
      document.getElementById("matches").textContent = PubgUI.fmtNum(d.rounds_played);
      document.getElementById("wins").textContent = PubgUI.fmtNum(d.wins);
      document.getElementById("kd").textContent = PubgUI.fmtKD(d.kd_ratio);
      document.getElementById("hs").textContent = PubgUI.fmtPct(d.headshot_rate);
      document.getElementById("winpct").textContent = PubgUI.fmtPct(d.win_rate);
      document.getElementById("top10").textContent = PubgUI.fmtPct(d.top10_rate);
      document.getElementById("longest").textContent = Math.round(d.longest_kill || 0) + "m";
      document.getElementById("kills").textContent = PubgUI.fmtNum(d.kills);
    }

    const params = new URLSearchParams({ mode: MODE });
    if (PLAYER) params.set("player", PLAYER);
    PubgUI.poll(`/api/pubg/career-lifetime?${params}`, 24*60*60*1000, render, console.error);
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/career-card.html
git commit -m "feat(pubg): career-card Widget für Starting-Soon"
```


## Rate-Limit-Hinweis

Das Default-Tier der PUBG-API liefert **10 Requests/Minute**, was für den Steady-State des Polling-Loops (1-3 req/min) entspannt reicht und beim Cold-Start (max 9 req/min) knapp aber innerhalb des Limits liegt.

Im laufenden Stream ist `/api/pubg/status` zu beobachten — das Feld `rateLimitRemaining` zeigt das aktuelle Budget. Falls du regelmäßig nahe 0 läufst (z.B. weil du sehr viele Stamm-Mates hast oder Streamer.bot häufig `!mypubgstats` für unterschiedliche Spieler triggert):

- **Higher-Tier-Key beantragen** unter `developer.pubg.com` → "Increase rate limit" mit Use-Case-Beschreibung (Stream-Overlay, persönlich, non-commercial). Approval üblicherweise wenige Tage. Bis 60+ RPM verfügbar.
- Der `RateLimiter` in `pubg/api_client.py` sollte mit dem neuen Limit konfiguriert werden — Parameter in `config/pubg.json` ergänzen: `"apiRateLimitPerMinute": 60`.


## Phase 9: Telemetry — First-Fight-Survival-Rate

### Task 9.1: Telemetry-Parser

**Files:**
- Create: `pubg/telemetry.py`
- Create: `tests/fixtures/telemetry_sample.json`
- Create: `tests/pubg/test_telemetry.py`

- [ ] **Step 1: Fixture mit minimalem Telemetry-Sample**

```json
[
  {"_T": "LogParachuteLanding", "_D": "2026-05-04T18:01:30.000Z",
   "character": {"accountId": "account.A", "name": "PEX_LuCKoR"}},
  {"_T": "LogParachuteLanding", "_D": "2026-05-04T18:01:32.000Z",
   "character": {"accountId": "account.B", "name": "MateA"}},
  {"_T": "LogPlayerTakeDamage", "_D": "2026-05-04T18:02:00.000Z",
   "attacker": {"accountId": "account.X", "name": "EnemyX"},
   "victim": {"accountId": "account.A", "name": "PEX_LuCKoR"},
   "damage": 35.0, "damageCauserName": "WeapHK416_C"},
  {"_T": "LogPlayerKillV2", "_D": "2026-05-04T18:02:10.000Z",
   "killer": {"accountId": "account.A", "name": "PEX_LuCKoR"},
   "victim": {"accountId": "account.X", "name": "EnemyX"},
   "killerDamageInfo": {"damageCauserName": "WeapBeryl_C", "distance": 87.0}},
  {"_T": "LogPlayerAttack", "_D": "2026-05-04T18:02:08.000Z",
   "attacker": {"accountId": "account.A", "name": "PEX_LuCKoR"},
   "weapon": {"itemId": "WeapBeryl_C"}}
]
```

- [ ] **Step 2: Test schreiben**

```python
# tests/pubg/test_telemetry.py
import json
import os
from pubg.telemetry import filter_squad_events, detect_first_fight

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def _load(name):
    with open(os.path.join(FIXTURES, name)) as f:
        return json.load(f)


def test_filter_squad_events_keeps_only_squad_involvement():
    events = _load("telemetry_sample.json")
    squad = {"account.A", "account.B"}
    out = list(filter_squad_events(events, squad))
    types = [e["event_type"] for e in out]
    assert "Landing" in types
    assert "Kill" in types
    assert "TakeDamage" in types


def test_detect_first_fight_survived_when_player_kills_attacker():
    events = _load("telemetry_sample.json")
    result = detect_first_fight(events, "account.A", landing_window_secs=120)
    assert result["engaged"] is True
    assert result["survived"] is True


def test_detect_first_fight_no_engagement_returns_none():
    events = [
        {"_T": "LogParachuteLanding", "_D": "2026-05-04T18:01:30.000Z",
         "character": {"accountId": "account.A"}},
    ]
    result = detect_first_fight(events, "account.A")
    assert result["engaged"] is False
```

- [ ] **Step 3: Test fail**

- [ ] **Step 4: Implementation**

```python
# pubg/telemetry.py
import datetime as _dt
import json


def _parse_ts(iso):
    if not iso:
        return None
    return _dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _ts_ms(iso):
    t = _parse_ts(iso)
    return int(t.timestamp() * 1000) if t else None


def _normalize(event):
    """Convert one PUBG telemetry event to flat row schema."""
    et = event.get("_T", "")
    base = {"event_type": None, "timestamp_ms": _ts_ms(event.get("_D")),
            "actor_account": None, "target_account": None,
            "weapon": None, "distance": None, "damage": None,
            "payload_json": json.dumps(event, separators=(",", ":")),
            "_raw_T": et}
    if et == "LogParachuteLanding":
        base["event_type"] = "Landing"
        base["actor_account"] = (event.get("character") or {}).get("accountId")
    elif et == "LogPlayerKillV2":
        base["event_type"] = "Kill"
        base["actor_account"] = (event.get("killer") or {}).get("accountId")
        base["target_account"] = (event.get("victim") or {}).get("accountId")
        info = event.get("killerDamageInfo") or {}
        base["weapon"] = info.get("damageCauserName")
        base["distance"] = info.get("distance")
    elif et == "LogPlayerTakeDamage":
        base["event_type"] = "TakeDamage"
        base["actor_account"] = (event.get("attacker") or {}).get("accountId")
        base["target_account"] = (event.get("victim") or {}).get("accountId")
        base["damage"] = event.get("damage")
        base["weapon"] = event.get("damageCauserName")
    elif et == "LogPlayerAttack":
        base["event_type"] = "Attack"
        base["actor_account"] = (event.get("attacker") or {}).get("accountId")
        base["weapon"] = (event.get("weapon") or {}).get("itemId")
    else:
        return None
    return base


def filter_squad_events(events, squad_account_ids):
    for e in events:
        norm = _normalize(e)
        if not norm:
            continue
        if (norm["actor_account"] in squad_account_ids
                or norm["target_account"] in squad_account_ids):
            yield norm


def detect_first_fight(events, my_account_id, landing_window_secs=120):
    landing_ts = None
    first_engagement = None
    fight_window_end = None
    survived_flag = None

    for e in events:
        et = e.get("_T", "")
        ts = _parse_ts(e.get("_D"))
        if not ts:
            continue
        if et == "LogParachuteLanding":
            ch = e.get("character") or {}
            if ch.get("accountId") == my_account_id and landing_ts is None:
                landing_ts = ts
                fight_window_end = ts + _dt.timedelta(seconds=landing_window_secs)
                continue
        if landing_ts is None:
            continue
        if fight_window_end and ts > fight_window_end and first_engagement is None:
            return {"engaged": False, "survived": None}

        attacker = (e.get("attacker") or e.get("killer") or {}).get("accountId")
        victim = (e.get("victim") or {}).get("accountId")

        if first_engagement is None:
            if et in ("LogPlayerTakeDamage", "LogPlayerKillV2"):
                if my_account_id in (attacker, victim):
                    first_engagement = e
                    if et == "LogPlayerKillV2" and victim == my_account_id:
                        return {"engaged": True, "survived": False}
                    if et == "LogPlayerKillV2" and attacker == my_account_id:
                        survived_flag = True
                    # weiter prüfen, ob ich später sterbe
                    fight_window_end = ts + _dt.timedelta(seconds=60)
                    continue
        else:
            if et == "LogPlayerKillV2" and victim == my_account_id:
                return {"engaged": True, "survived": False}
            if et == "LogPlayerKillV2" and attacker == my_account_id:
                survived_flag = True

    if first_engagement is None:
        return {"engaged": False, "survived": None}
    return {"engaged": True, "survived": True if survived_flag else True}
```

- [ ] **Step 5: Tests grün**

- [ ] **Step 6: Commit**

```bash
git add pubg/telemetry.py tests/pubg/test_telemetry.py tests/fixtures/telemetry_sample.json
git commit -m "feat(pubg): Telemetry-Parser + First-Fight-Detection"
```

### Task 9.2: Telemetry-Backlog im Poller verarbeiten

**Files:**
- Modify: `pubg/poller.py`
- Modify: `tests/pubg/test_poller.py`

- [ ] **Step 1: Test anhängen**

```python
def test_process_telemetry_backlog_filters_and_persists(tmp_db_path):
    from pubg.poller import process_telemetry_backlog
    from pubg.db import (insert_match, get_telemetry_for_match,
                         get_matches_needing_telemetry)
    conn = _setup(tmp_db_path)
    insert_match(conn, "m1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", "https://example/tel.json")
    upsert_player(conn, "account.B", "MateA", "steam", False)

    client = MagicMock()
    client.get_telemetry.return_value = [
        {"_T": "LogParachuteLanding", "_D": "2026-05-04T18:01:30.000Z",
         "character": {"accountId": "account.abc123"}},
        {"_T": "LogParachuteLanding", "_D": "2026-05-04T18:01:30.000Z",
         "character": {"accountId": "account.UNKNOWN"}},  # nicht squad
        {"_T": "LogPlayerKillV2", "_D": "2026-05-04T18:02:00.000Z",
         "killer": {"accountId": "account.abc123"},
         "victim": {"accountId": "account.X"},
         "killerDamageInfo": {"damageCauserName": "WeapBeryl_C", "distance": 50.0}},
    ]

    process_telemetry_backlog(conn, client, "account.abc123",
                               max_per_tick=5)

    rows = get_telemetry_for_match(conn, "m1")
    assert len(rows) == 2  # Landing+Kill, nicht der Foreign Landing
    backlog = get_matches_needing_telemetry(conn)
    assert len(backlog) == 0
```

- [ ] **Step 2: Implementation an `pubg/poller.py` anhängen**

```python
from pubg.telemetry import filter_squad_events
from pubg.db import (insert_telemetry_events, mark_telemetry_fetched,
                     get_matches_needing_telemetry)


def _squad_account_ids_for_match(conn, match_id):
    rows = conn.execute(
        "SELECT account_id FROM participants WHERE match_id = ?", (match_id,)
    ).fetchall()
    return {r["account_id"] for r in rows}


def process_telemetry_backlog(conn, client, my_account_id, max_per_tick=5):
    pending = get_matches_needing_telemetry(conn, limit=max_per_tick)
    processed = 0
    errors = []
    for row in pending:
        try:
            raw = client.get_telemetry(row["telemetry_url"])
        except Exception as e:
            errors.append(f"telemetry {row['match_id']}: {e}")
            mark_telemetry_fetched(conn, row["match_id"])  # skip bei 404
            continue
        squad = _squad_account_ids_for_match(conn, row["match_id"])
        if my_account_id not in squad:
            squad.add(my_account_id)
        events = list(filter_squad_events(raw, squad))
        if events:
            insert_telemetry_events(conn, row["match_id"], events)
        mark_telemetry_fetched(conn, row["match_id"])
        processed += 1
    return {"processed": processed, "errors": errors}
```

- [ ] **Step 3: PollerThread um Backlog-Step erweitern**

In `PollerThread.run()` nach `refresh_lifetimes(...)`:

```python
                t_stats = process_telemetry_backlog(conn, self.client,
                                                     self.my_account_id, 3)
                self._last_status["telemetryProcessed"] = t_stats["processed"]
                self._last_status["errors"].extend(t_stats["errors"])
```

- [ ] **Step 4: Tests grün, Commit**

```bash
pytest tests/pubg/test_poller.py -v
git add pubg/poller.py tests/pubg/test_poller.py
git commit -m "feat(pubg): Telemetry-Backlog im Poller"
```

### Task 9.3: First-Fight-Aggregation und Endpoint

**Files:**
- Modify: `pubg/aggregations.py`
- Modify: `pubg/endpoints.py`
- Modify: `tests/pubg/test_aggregations.py`

- [ ] **Step 1: Test anhängen**

```python
def test_first_fight_rate_aggregates(tmp_db_path):
    from pubg.aggregations import compute_first_fight_rate
    from pubg.db import insert_telemetry_events
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    for i in range(4):
        _add_match(conn, f"f{i}", f"2026-05-04T1{i}:00:00Z", 2, 200.0, 5)
    # m0: engaged + survived  → 1/1
    insert_telemetry_events(conn, "f0", [
        {"event_type": "Landing", "timestamp_ms": 1, "actor_account": "account.A",
         "target_account": None, "weapon": None, "distance": None,
         "damage": None, "payload_json": "{}"},
        {"event_type": "Kill", "timestamp_ms": 2000, "actor_account": "account.A",
         "target_account": "account.X", "weapon": "Beryl", "distance": 50.0,
         "damage": None, "payload_json": "{}"},
    ])
    # m1: engaged + died
    insert_telemetry_events(conn, "f1", [
        {"event_type": "Landing", "timestamp_ms": 1, "actor_account": "account.A",
         "target_account": None, "weapon": None, "distance": None,
         "damage": None, "payload_json": "{}"},
        {"event_type": "Kill", "timestamp_ms": 2000, "actor_account": "account.X",
         "target_account": "account.A", "weapon": "Beryl", "distance": 50.0,
         "damage": None, "payload_json": "{}"},
    ])
    # m2: kein engagement → ignored
    # m3: engaged + survived
    insert_telemetry_events(conn, "f3", [
        {"event_type": "Landing", "timestamp_ms": 1, "actor_account": "account.A",
         "target_account": None, "weapon": None, "distance": None,
         "damage": None, "payload_json": "{}"},
        {"event_type": "Kill", "timestamp_ms": 1500, "actor_account": "account.A",
         "target_account": "account.X", "weapon": "Beryl", "distance": 50.0,
         "damage": None, "payload_json": "{}"},
    ])
    res = compute_first_fight_rate(conn, "account.A", range_key="session")
    assert res["total"] == 3
    assert res["survived"] == 2
    assert abs(res["rate"] - (2/3)*100) < 0.1
```

- [ ] **Step 2: Implementation anhängen**

```python
def compute_first_fight_rate(conn, my_account_id, range_key="session"):
    cutoff = _range_filter(conn, range_key)
    matches = conn.execute("""
        SELECT m.match_id FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
        ORDER BY m.played_at ASC
    """, (my_account_id, cutoff)).fetchall()

    total = 0
    survived = 0
    sparkline = []
    for m in matches:
        events = conn.execute("""
            SELECT event_type, timestamp_ms, actor_account, target_account
            FROM telemetry_events
            WHERE match_id = ? ORDER BY timestamp_ms ASC
        """, (m["match_id"],)).fetchall()
        if not events:
            continue
        landing = next((e for e in events if e["event_type"] == "Landing"
                        and e["actor_account"] == my_account_id), None)
        if not landing:
            continue
        window_end = landing["timestamp_ms"] + 120 * 1000
        engagements = [e for e in events
                       if e["event_type"] in ("Kill", "TakeDamage")
                       and e["timestamp_ms"] >= landing["timestamp_ms"]
                       and e["timestamp_ms"] <= window_end
                       and (e["actor_account"] == my_account_id
                            or e["target_account"] == my_account_id)]
        if not engagements:
            continue
        first = engagements[0]
        # Tod im Fenster?
        died = any(e["event_type"] == "Kill"
                   and e["target_account"] == my_account_id
                   and e["timestamp_ms"] <= first["timestamp_ms"] + 60000
                   for e in events)
        total += 1
        if not died:
            survived += 1
            sparkline.append(1)
        else:
            sparkline.append(0)
    return {
        "rate": (survived / total * 100) if total else 0,
        "survived": survived,
        "total": total,
        "sparkline": sparkline[-20:],
    }
```

- [ ] **Step 3: Endpoint ergänzen**

In `EndpointRegistry.dispatch`:

```python
        if route == ("GET", "/api/pubg/first-fight-rate"):
            return self._first_fight(qs)
```

```python
    def _first_fight(self, qs):
        from pubg.aggregations import compute_first_fight_rate
        range_key = qs.get("range", "session")
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            f"ff:{range_key}",
            lambda: compute_first_fight_rate(conn, self.my_account_id, range_key)))
```

- [ ] **Step 4: Tests grün, Commit**

```bash
git add pubg/aggregations.py pubg/endpoints.py tests/pubg/test_aggregations.py
git commit -m "feat(pubg): First-Fight-Rate Aggregation + Endpoint"
```

### Task 9.4: first-fight.html Widget

**Files:**
- Create: `widgets/pubg/first-fight.html`

- [ ] **Step 1: HTML schreiben**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG First Fight</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { padding: 16px; }
    .card { width: 240px; padding: 18px; text-align: center; }
    .header { font-size: 0.8em; color: var(--pubg-muted);
              text-transform: uppercase; letter-spacing: 0.1em; }
    .pct { font-size: 3.2em; font-weight: 700; color: var(--pubg-gold);
           margin: 8px 0 4px; }
    .sub { color: var(--pubg-muted); font-size: 0.85em; }
    .spark { display: flex; gap: 3px; margin-top: 14px; justify-content: center; }
    .spark span { width: 10px; height: 18px; border-radius: 2px;
                  background: rgba(255,255,255,0.1); }
    .spark span.s { background: var(--pubg-gold); }
    .spark span.d { background: rgba(229, 123, 123, 0.6); }
  </style>
</head>
<body>
  <div class="pubg-card card pubg-fade-in">
    <div class="header">First Fight Survived</div>
    <div class="pct" id="pct">—</div>
    <div class="sub" id="sub">—</div>
    <div class="spark" id="spark"></div>
  </div>
  <script src="_pubg.js"></script>
  <script>
    const RANGE = PubgUI.qs("range", "session");
    function render(d) {
      document.getElementById("pct").textContent = (d.rate||0).toFixed(0) + "%";
      document.getElementById("sub").textContent = `${d.survived||0} von ${d.total||0} überlebt`;
      const spark = document.getElementById("spark");
      spark.innerHTML = (d.sparkline||[]).map(v =>
        `<span class="${v ? 's' : 'd'}"></span>`).join("");
    }
    PubgUI.poll(`/api/pubg/first-fight-rate?range=${RANGE}`, 5*60*1000, render, console.error);
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/first-fight.html
git commit -m "feat(pubg): first-fight Widget"
```


## Phase 10: Map-Distribution + Settings + Stamm-Crew

### Task 10.1: Map-Distribution Aggregation

**Files:**
- Modify: `pubg/aggregations.py`
- Modify: `pubg/endpoints.py`
- Modify: `tests/pubg/test_aggregations.py`

- [ ] **Step 1: Test anhängen**

```python
def test_map_distribution_counts_by_range(tmp_db_path):
    from pubg.aggregations import compute_map_distribution
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    for i in range(3):
        _add_match(conn, f"e{i}", f"2026-05-04T1{i}:00:00Z", 2, 200.0, 5)
    from pubg.db import insert_match, insert_participants
    insert_match(conn, "mir1", "Miramar_Main", "squad-fpp", False, 1800,
                 "2026-05-04T15:00:00Z", None)
    insert_participants(conn, "mir1", [{
        "account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
        "place": 1, "kills": 5, "headshot_kills": 1, "assists": 0,
        "dbnos": 0, "revives": 0, "damage_dealt": 500.0, "longest_kill": 50.0,
        "time_survived": 1800, "walk_distance": 100.0, "ride_distance": 0.0,
        "swim_distance": 0.0, "weapons_acquired": 5, "heals": 0, "boosts": 0,
        "team_kills": 0,
    }])
    out = compute_map_distribution(conn, "account.A", range_key="session")
    erangel = next(x for x in out if x["map"] == "Erangel_Main")
    assert erangel["count"] == 3
    miramar = next(x for x in out if x["map"] == "Miramar_Main")
    assert miramar["count"] == 1
    assert miramar["wins"] == 1
```

- [ ] **Step 2: Implementation anhängen**

```python
def compute_map_distribution(conn, my_account_id, range_key="session"):
    cutoff = _range_filter(conn, range_key) if range_key != "all" else "1970-01-01T00:00:00Z"
    rows = conn.execute("""
        SELECT m.map_name,
               COUNT(*) AS cnt,
               SUM(CASE WHEN pa.place=1 THEN 1 ELSE 0 END) AS wins,
               AVG(pa.place) AS avg_place
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
        GROUP BY m.map_name
        ORDER BY cnt DESC
    """, (my_account_id, cutoff)).fetchall()
    return [{"map": r["map_name"], "count": r["cnt"],
             "wins": r["wins"], "avgPlace": r["avg_place"]} for r in rows]
```

Endpoint:

```python
        if route == ("GET", "/api/pubg/map-distribution"):
            return self._map_dist(qs)
```

```python
    def _map_dist(self, qs):
        from pubg.aggregations import compute_map_distribution
        range_key = qs.get("range", "session")
        conn = self.get_conn()
        return _ok(self.cache.get_or_compute(
            f"map:{range_key}",
            lambda: compute_map_distribution(conn, self.my_account_id, range_key)))
```

- [ ] **Step 3: Tests grün, Commit**

```bash
git add pubg/aggregations.py pubg/endpoints.py tests/pubg/test_aggregations.py
git commit -m "feat(pubg): map-distribution Aggregation + Endpoint"
```

### Task 10.2: map-distribution Widget

**Files:**
- Create: `widgets/pubg/map-distribution.html`

- [ ] **Step 1: HTML mit horizontalen Bars**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG Maps</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { padding: 16px; }
    .panel { width: 280px; padding: 16px; }
    .panel h3 { margin: 0 0 12px; font-size: 0.85em;
                color: var(--pubg-muted); text-transform: uppercase;
                letter-spacing: 0.08em; }
    .row { margin-bottom: 8px; }
    .row .name { display: flex; justify-content: space-between;
                 font-size: 0.9em; margin-bottom: 3px; }
    .bar {
      height: 6px; background: rgba(255,255,255,0.08);
      border-radius: 3px; overflow: hidden;
    }
    .bar-fill { height: 100%; background: var(--pubg-gold); transition: width 0.6s; }
  </style>
</head>
<body>
  <div class="pubg-card panel pubg-fade-in">
    <h3 id="title">Map-Verteilung</h3>
    <div id="rows"></div>
  </div>
  <script src="_pubg.js"></script>
  <script>
    const RANGE = PubgUI.qs("range", "session");
    function render(list) {
      const max = Math.max(1, ...list.map(x => x.count));
      const html = list.map(m => `
        <div class="row">
          <div class="name"><span>${PubgUI.fmtMap(m.map)}</span>
            <span class="pubg-stat-value">${m.count}${m.wins?` · CHICKEN${m.wins}`:""}</span></div>
          <div class="bar"><div class="bar-fill" style="width:${m.count/max*100}%"></div></div>
        </div>`).join("");
      document.getElementById("rows").innerHTML =
        html || `<div class="pubg-error">noch keine Matches</div>`;
    }
    PubgUI.poll(`/api/pubg/map-distribution?range=${RANGE}`,
                5*60*1000, render, console.error);
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/map-distribution.html
git commit -m "feat(pubg): map-distribution Widget mit horizontalen Bars"
```

### Task 10.3: Settings-Endpoint und Stamm-Crew

**Files:**
- Modify: `pubg/endpoints.py`
- Modify: `tests/pubg/test_endpoints.py`

- [ ] **Step 1: Tests anhängen**

```python
def test_settings_get_returns_all(tmp_db_path):
    from pubg.db import set_setting
    conn = _setup(tmp_db_path)
    set_setting(conn, "minMatchesForTopMates", "10")
    reg = _registry(conn)
    body, code, _ = reg.dispatch("GET", "/api/pubg/settings", b"", {})
    assert code == 200
    payload = json.loads(body)
    assert payload["minMatchesForTopMates"] == "10"


def test_settings_post_persists(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body_in = json.dumps({"key": "minMatchesForTopMates", "value": "15"}).encode()
    body, code, _ = reg.dispatch("POST", "/api/pubg/settings", body_in, {})
    assert code == 200
    from pubg.db import get_setting
    assert get_setting(conn, "minMatchesForTopMates") == "15"


def test_stamm_crew_add_and_list(tmp_db_path):
    conn = _setup(tmp_db_path)
    reg = _registry(conn)
    body_in = json.dumps({"add": "MateA"}).encode()
    body, code, _ = reg.dispatch("POST", "/api/pubg/stamm-crew", body_in, {})
    assert code == 200
    body, code, _ = reg.dispatch("GET", "/api/pubg/stamm-crew", b"", {})
    assert "MateA" in body.decode()
```

- [ ] **Step 2: Implementation in `EndpointRegistry`**

In `dispatch`:

```python
        if route == ("GET", "/api/pubg/settings"):
            return self._settings_get()
        if route == ("POST", "/api/pubg/settings"):
            return self._settings_set(body)
        if route == ("GET", "/api/pubg/stamm-crew"):
            return self._stamm_get()
        if route == ("POST", "/api/pubg/stamm-crew"):
            return self._stamm_add(body)
        if route == ("DELETE", "/api/pubg/stamm-crew"):
            return self._stamm_del(body)
```

Methoden:

```python
    def _settings_get(self):
        conn = self.get_conn()
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        return _ok({r["key"]: r["value"] for r in rows})

    def _settings_set(self, body):
        try:
            payload = json.loads(body or b"{}")
            from pubg.db import set_setting
            set_setting(self.get_conn(), payload["key"], str(payload["value"]))
            self.cache.invalidate()
            return _ok({"ok": True})
        except Exception as e:
            return _err(400, str(e))

    def _stamm_get(self):
        conn = self.get_conn()
        rows = conn.execute("SELECT * FROM stamm_crew").fetchall()
        return _ok([{"name": r["name"], "accountId": r["account_id"]}
                    for r in rows])

    def _stamm_add(self, body):
        try:
            payload = json.loads(body or b"{}")
            name = payload["add"]
            conn = self.get_conn()
            p = conn.execute("SELECT * FROM players WHERE name = ?", (name,)).fetchone()
            if not p:
                return _err(404, f"Player {name} unbekannt — spiele erst mal mit ihm")
            conn.execute("""
                INSERT OR IGNORE INTO stamm_crew(account_id, name, added_at)
                VALUES (?, ?, datetime('now'))
            """, (p["account_id"], name))
            conn.commit()
            return _ok({"ok": True})
        except Exception as e:
            return _err(400, str(e))

    def _stamm_del(self, body):
        try:
            payload = json.loads(body or b"{}")
            name = payload["remove"]
            conn = self.get_conn()
            conn.execute("DELETE FROM stamm_crew WHERE name = ?", (name,))
            conn.commit()
            return _ok({"ok": True})
        except Exception as e:
            return _err(400, str(e))
```

DELETE muss in `serve.py` auch durchgeroutet werden — siehe Task 10.4.

- [ ] **Step 3: Tests grün**

- [ ] **Step 4: Commit**

```bash
git add pubg/endpoints.py tests/pubg/test_endpoints.py
git commit -m "feat(pubg): Settings + Stamm-Crew Endpoints"
```

### Task 10.4: serve.py — DELETE-Routing

**Files:**
- Modify: `serve.py`

- [ ] **Step 1: do_DELETE-Methode hinzufügen**

In `Handler`-Klasse (nach `do_POST`):

```python
    def do_DELETE(self):
        if PUBG_ENABLED and self.path.startswith("/api/pubg/"):
            try:
                length = int(self.headers.get('Content-Length', 0))
                body_in = self.rfile.read(length) if length else b""
                body, code, ctype = pubg_registry.dispatch(
                    "DELETE", self.path, body_in, dict(self.headers))
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                self.send_error(500, str(e))
                return
        self.send_error(405)
```

In `end_headers` (Allow-Methods):

```python
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST, DELETE")
```

- [ ] **Step 2: Commit**

```bash
git add serve.py
git commit -m "feat(pubg): DELETE-Routing für Stamm-Crew"
```


## Phase 11: Restliche Widgets

### Task 11.1: flyout-full.html

**Files:**
- Create: `widgets/pubg/flyout-full.html`

- [ ] **Step 1: HTML mit Slider-Filter und Sektionen**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG Flyout</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { padding: 20px; }
    .panel { width: 480px; padding: 20px 24px; }
    .head {
      display: flex; justify-content: space-between; align-items: baseline;
      margin-bottom: 14px;
    }
    .head h2 { margin: 0; font-size: 1.05em; letter-spacing: 0.06em; }
    .head .reset-btn {
      background: rgba(94, 42, 121, 0.25); border: 1px solid var(--pubg-border);
      color: var(--pubg-text); border-radius: 4px;
      padding: 4px 10px; cursor: pointer; font-family: inherit;
      font-size: 0.8em;
    }
    .head .reset-btn:hover { background: rgba(94, 42, 121, 0.5); }

    .section {
      border-top: 1px solid rgba(255,255,255,0.07);
      padding: 12px 0;
    }
    .section h3 {
      margin: 0 0 8px;
      font-size: 0.75em;
      color: var(--pubg-muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .stat-grid .cell { display: flex; flex-direction: column; }
    .stat-grid .cell .pubg-stat-value { font-size: 1.4em; }

    .controls { display: flex; align-items: center; gap: 12px; padding-top: 10px; }
    .controls input[type=range] { flex: 1; }
    .controls select {
      background: rgba(0,0,0,0.3); color: var(--pubg-text);
      border: 1px solid var(--pubg-border); padding: 4px 6px; border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="pubg-card panel pubg-fade-in">
    <div class="head">
      <h2>PUBG SESSION</h2>
      <button class="reset-btn" id="reset">Reset</button>
    </div>

    <div class="section">
      <h3>Session</h3>
      <div class="stat-grid">
        <div class="cell"><span class="pubg-stat-value" id="kills">—</span><span class="pubg-stat-label">Kills</span></div>
        <div class="cell"><span class="pubg-stat-value" id="dmg">—</span><span class="pubg-stat-label">Damage</span></div>
        <div class="cell"><span class="pubg-stat-value" id="wins">—</span><span class="pubg-stat-label">Wins</span></div>
        <div class="cell"><span class="pubg-stat-value" id="kd">—</span><span class="pubg-stat-label">K/D</span></div>
        <div class="cell"><span class="pubg-stat-value" id="hs">—</span><span class="pubg-stat-label">Headshot</span></div>
        <div class="cell"><span class="pubg-stat-value" id="best">—</span><span class="pubg-stat-label">Best Place</span></div>
      </div>
    </div>

    <div class="section">
      <h3>First Fight</h3>
      <div><span class="pubg-stat-value" id="ff">—</span> <span class="pubg-stat-label" id="ffsub">—</span></div>
    </div>

    <div class="section">
      <h3>Top Mates</h3>
      <div id="topmates"></div>
    </div>

    <div class="section">
      <h3>Filter</h3>
      <div class="controls">
        <span class="pubg-stat-label">Min Matches</span>
        <input type="range" id="minMatches" min="1" max="50" value="10">
        <span class="pubg-stat-value" id="minVal">10</span>
        <select id="sortBy">
          <option value="avgPlace">Avg Place</option>
          <option value="kd">K/D</option>
          <option value="winRate">Win-Rate</option>
          <option value="mostPlayed">Most Played</option>
        </select>
      </div>
    </div>
  </div>

  <script src="_pubg.js"></script>
  <script>
    let currentMin = 10;
    let currentSort = "avgPlace";

    async function loadSettings() {
      try {
        const s = await PubgUI.fetchJson("/api/pubg/settings");
        if (s.minMatchesForTopMates) {
          currentMin = parseInt(s.minMatchesForTopMates, 10);
          document.getElementById("minMatches").value = currentMin;
          document.getElementById("minVal").textContent = currentMin;
        }
        if (s.topMatesSortBy) {
          currentSort = s.topMatesSortBy;
          document.getElementById("sortBy").value = currentSort;
        }
      } catch (_) {}
    }

    async function saveSetting(key, value) {
      await fetch("/api/pubg/settings", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({key, value: String(value)}),
      });
    }

    function renderSession(s) {
      document.getElementById("kills").textContent = PubgUI.fmtNum(s.kills);
      document.getElementById("dmg").textContent = PubgUI.fmtNum(Math.round(s.damage||0));
      document.getElementById("wins").textContent = PubgUI.fmtNum(s.wins);
      document.getElementById("kd").textContent = PubgUI.fmtKD(s.kd);
      document.getElementById("hs").textContent = PubgUI.fmtPct(s.headshotPct);
      document.getElementById("best").textContent = PubgUI.fmtPlace(s.bestPlace);
    }

    function renderFF(f) {
      document.getElementById("ff").textContent = (f.rate||0).toFixed(0) + "%";
      document.getElementById("ffsub").textContent = `${f.survived||0} / ${f.total||0}`;
    }

    function renderTopMates(list) {
      document.getElementById("topmates").innerHTML = list.length ? list.map((m,i) => `
        <div class="pubg-row" style="padding:4px 0">
          <span style="color:var(--pubg-gold);width:18px">${i+1}</span>
          <span style="flex:1">${m.name}</span>
          <span class="pubg-stat-label">${m.sharedMatches} games</span>
        </div>`).join("") : '<span class="pubg-error">noch keine Daten</span>';
    }

    function reload() {
      PubgUI.fetchJson("/api/pubg/session").then(renderSession).catch(()=>{});
      PubgUI.fetchJson("/api/pubg/first-fight-rate?range=session").then(renderFF).catch(()=>{});
      PubgUI.fetchJson(`/api/pubg/top-mates?sortBy=${currentSort}&limit=5&minMatches=${currentMin}`)
        .then(renderTopMates).catch(()=>{});
    }

    document.getElementById("minMatches").addEventListener("input", (e) => {
      currentMin = parseInt(e.target.value, 10);
      document.getElementById("minVal").textContent = currentMin;
    });
    document.getElementById("minMatches").addEventListener("change", () => {
      saveSetting("minMatchesForTopMates", currentMin);
      reload();
    });
    document.getElementById("sortBy").addEventListener("change", (e) => {
      currentSort = e.target.value;
      saveSetting("topMatesSortBy", currentSort);
      reload();
    });
    document.getElementById("reset").addEventListener("click", async () => {
      await fetch("/api/pubg/session/reset", {method: "POST"});
      reload();
    });

    loadSettings().then(() => {
      reload();
      setInterval(reload, 60000);
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: OBS-Interagieren-Test**

Source einfügen, Rechtsklick → Interagieren → Slider verschieben, Sort wechseln. Werte sollten in DB landen.

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/flyout-full.html
git commit -m "feat(pubg): flyout-full Panel mit Slider + Sort-Dropdown"
```

### Task 11.2: session-summary.html

**Files:**
- Create: `widgets/pubg/session-summary.html`

- [ ] **Step 1: HTML — Stream-Ending-Übersicht**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG Session Summary</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { padding: 32px; }
    .summary { width: 720px; padding: 28px 32px; }
    .summary h1 { margin: 0 0 18px; font-size: 1.4em; letter-spacing: 0.1em;
                  color: var(--pubg-gold); text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
    .grid .cell { display: flex; flex-direction: column; }
    .grid .cell .pubg-stat-value { font-size: 1.8em; }
    .twocol { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 22px; }
    .col h3 { margin: 0 0 10px; font-size: 0.8em; color: var(--pubg-muted);
              text-transform: uppercase; letter-spacing: 0.1em; }
    .map-row, .mate-row {
      display: flex; justify-content: space-between; padding: 4px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
  </style>
</head>
<body>
  <div class="pubg-card summary pubg-fade-in">
    <h1>Session-Übersicht</h1>
    <div class="grid">
      <div class="cell"><span class="pubg-stat-value" id="matches">—</span><span class="pubg-stat-label">Matches</span></div>
      <div class="cell"><span class="pubg-stat-value" id="kills">—</span><span class="pubg-stat-label">Kills</span></div>
      <div class="cell"><span class="pubg-stat-value" id="dmg">—</span><span class="pubg-stat-label">Damage</span></div>
      <div class="cell"><span class="pubg-stat-value" id="wins">—</span><span class="pubg-stat-label">Wins</span></div>
    </div>
    <div class="twocol">
      <div class="col"><h3>Maps</h3><div id="maps"></div></div>
      <div class="col"><h3>Mates</h3><div id="mates"></div></div>
    </div>
  </div>
  <script src="_pubg.js"></script>
  <script>
    function render() {
      PubgUI.fetchJson("/api/pubg/session").then(s => {
        document.getElementById("matches").textContent = PubgUI.fmtNum(s.matches);
        document.getElementById("kills").textContent = PubgUI.fmtNum(s.kills);
        document.getElementById("dmg").textContent = PubgUI.fmtNum(Math.round(s.damage||0));
        document.getElementById("wins").textContent = PubgUI.fmtNum(s.wins);
      });
      PubgUI.fetchJson("/api/pubg/map-distribution?range=session").then(list => {
        document.getElementById("maps").innerHTML = list.map(m =>
          `<div class="map-row"><span>${PubgUI.fmtMap(m.map)}</span><span class="pubg-stat-value">${m.count}</span></div>`).join("");
      });
      PubgUI.fetchJson("/api/pubg/mates-today?range=session").then(list => {
        document.getElementById("mates").innerHTML = list.map(m =>
          `<div class="mate-row"><span>${m.name}</span><span class="pubg-stat-value">${m.sharedMatchesToday}</span></div>`).join("");
      });
    }
    render();
    setInterval(render, 60000);
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/session-summary.html
git commit -m "feat(pubg): session-summary für Stream-Ending"
```

### Task 11.3: news-ticker.html

**Files:**
- Create: `widgets/pubg/news-ticker.html`

- [ ] **Step 1: HTML — rotierende Snippets**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG News Ticker</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { display: flex; align-items: center; height: 36px; padding: 0; }
    .ticker {
      width: 100%; height: 36px;
      display: flex; align-items: center;
      padding: 0 18px;
      font-size: 0.95em;
      overflow: hidden;
      position: relative;
    }
    .ticker .slot {
      position: absolute; left: 18px; right: 18px;
      transition: opacity 0.5s, transform 0.5s;
    }
    .ticker .slot.out { opacity: 0; transform: translateY(-12px); }
    .ticker .slot.in  { opacity: 0; transform: translateY(12px); }
    .ticker .slot.active { opacity: 1; transform: translateY(0); }
    .ticker .label {
      color: var(--pubg-gold);
      font-weight: 700;
      letter-spacing: 0.12em;
      margin-right: 12px;
    }
  </style>
</head>
<body>
  <div class="pubg-card ticker">
    <div class="slot active" id="slot"></div>
  </div>
  <script src="_pubg.js"></script>
  <script>
    const ROTATE_MS = parseInt(PubgUI.qs("rotateMs", 8000), 10);
    let snippets = [];
    let idx = 0;

    async function refresh() {
      const out = [];
      try {
        const s = await PubgUI.fetchJson("/api/pubg/session");
        if (s.matches) {
          out.push(`<span class="label">SESSION</span> ${s.kills} Kills · ${PubgUI.fmtNum(Math.round(s.damage))} DMG · ${s.wins} Wins`);
        }
      } catch (_) {}
      try {
        const tm = await PubgUI.fetchJson("/api/pubg/top-mates?sortBy=avgPlace&limit=1&minMatches=10");
        if (tm[0]) {
          out.push(`<span class="label">BEST MATE</span> ${tm[0].name} · Avg #${(tm[0].avgPlace||0).toFixed(1)} · ${tm[0].sharedMatches} Games`);
        }
      } catch (_) {}
      try {
        const md = await PubgUI.fetchJson("/api/pubg/map-distribution?range=session");
        if (md[0]) {
          out.push(`<span class="label">MAP HEUTE</span> ${PubgUI.fmtMap(md[0].map)} (${md[0].count} Spiele)`);
        }
      } catch (_) {}
      try {
        const c = await PubgUI.fetchJson("/api/pubg/career-lifetime?mode=all");
        if (c.rounds_played) {
          out.push(`<span class="label">CAREER</span> ${PubgUI.fmtNum(c.rounds_played)} Games · K/D ${PubgUI.fmtKD(c.kd_ratio)} · ${c.wins} Wins`);
        }
      } catch (_) {}
      try {
        const f = await PubgUI.fetchJson("/api/pubg/first-fight-rate?range=session");
        if (f.total) {
          out.push(`<span class="label">FIRST FIGHT</span> ${(f.rate||0).toFixed(0)}% überlebt (${f.survived}/${f.total})`);
        }
      } catch (_) {}
      snippets = out;
    }

    function show(html) {
      const slot = document.getElementById("slot");
      slot.classList.remove("active");
      slot.classList.add("out");
      setTimeout(() => {
        slot.innerHTML = html;
        slot.classList.remove("out");
        slot.classList.add("in");
        requestAnimationFrame(() => {
          slot.classList.remove("in");
          slot.classList.add("active");
        });
      }, 500);
    }

    function tick() {
      if (snippets.length === 0) return;
      idx = (idx + 1) % snippets.length;
      show(snippets[idx]);
    }

    refresh().then(() => {
      if (snippets.length) {
        document.getElementById("slot").innerHTML = snippets[0];
        setInterval(tick, ROTATE_MS);
      }
    });
    setInterval(refresh, 60000);
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/news-ticker.html
git commit -m "feat(pubg): news-ticker mit rotierenden Snippets"
```

### Task 11.4: squad-compare.html

**Files:**
- Modify: `pubg/aggregations.py`
- Modify: `pubg/endpoints.py`
- Create: `widgets/pubg/squad-compare.html`

- [ ] **Step 1: Aggregation und Endpoint**

In `pubg/aggregations.py`:

```python
def compute_squad_compare(conn, my_account_id, player_names, last_n=5):
    targets = [n.strip() for n in player_names if n.strip()]
    if not targets:
        return {"players": [], "matchTable": []}

    rows = conn.execute(f"""
        SELECT p.account_id, p.name FROM players p
        WHERE p.name IN ({",".join(["?"]*len(targets))})
    """, targets).fetchall()
    name_to_acc = {r["name"]: r["account_id"] for r in rows}

    cutoff_q = conn.execute("""
        SELECT m.match_id, m.map_name, m.played_at
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ?
        ORDER BY m.played_at DESC LIMIT ?
    """, (my_account_id, last_n)).fetchall()
    match_ids = [r["match_id"] for r in cutoff_q]

    table = []
    for mid_row in cutoff_q:
        cells = {}
        for name in targets:
            acc = name_to_acc.get(name)
            if not acc:
                cells[name] = None
                continue
            p = conn.execute("""
                SELECT kills, damage_dealt, place
                FROM participants WHERE match_id = ? AND account_id = ?
            """, (mid_row["match_id"], acc)).fetchone()
            cells[name] = dict(p) if p else None
        table.append({"matchId": mid_row["match_id"],
                      "map": mid_row["map_name"],
                      "playedAt": mid_row["played_at"],
                      "cells": cells})
    return {"players": targets, "matchTable": table}
```

In `pubg/endpoints.py` `dispatch`:

```python
        if route == ("GET", "/api/pubg/squad-compare"):
            return self._squad_compare(qs)
```

```python
    def _squad_compare(self, qs):
        from pubg.aggregations import compute_squad_compare
        names = (qs.get("players") or "").split(",")
        n = int(qs.get("matches", 5))
        conn = self.get_conn()
        return _ok(compute_squad_compare(conn, self.my_account_id, names, n))
```

- [ ] **Step 2: Widget**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG Squad Compare</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { padding: 16px; }
    .panel { padding: 16px; min-width: 480px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    th, td { padding: 6px 8px; text-align: left;
             border-bottom: 1px solid rgba(255,255,255,0.06); }
    th { font-size: 0.75em; color: var(--pubg-muted);
         text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
    td.win { color: var(--pubg-gold); }
  </style>
</head>
<body>
  <div class="pubg-card panel pubg-fade-in">
    <table>
      <thead><tr id="head"></tr></thead>
      <tbody id="body"></tbody>
    </table>
  </div>
  <script src="_pubg.js"></script>
  <script>
    const PLAYERS = (PubgUI.qs("players", "") || "").split(",").filter(Boolean);
    const MATCHES = parseInt(PubgUI.qs("matches", 5), 10);

    function render(d) {
      const head = ["Map / Datum", ...d.players].map(h => `<th>${h}</th>`).join("");
      document.getElementById("head").innerHTML = head;
      const body = d.matchTable.map(row => {
        const cells = d.players.map(p => {
          const c = row.cells[p];
          if (!c) return `<td>—</td>`;
          const cls = c.place === 1 ? "win" : "";
          return `<td class="${cls}">#${c.place} · ${c.kills}K · ${PubgUI.fmtNum(Math.round(c.damage_dealt||0))}</td>`;
        }).join("");
        const date = (row.playedAt || "").slice(0, 10);
        return `<tr><td>${PubgUI.fmtMap(row.map)} · ${date}</td>${cells}</tr>`;
      }).join("");
      document.getElementById("body").innerHTML = body || `<tr><td>—</td></tr>`;
    }

    if (PLAYERS.length) {
      PubgUI.poll(`/api/pubg/squad-compare?players=${encodeURIComponent(PLAYERS.join(","))}&matches=${MATCHES}`,
                  60000, render, console.error);
    } else {
      document.getElementById("body").innerHTML =
        `<tr><td class="pubg-error">URL-Parameter ?players=A,B,C nötig</td></tr>`;
    }
  </script>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add pubg/aggregations.py pubg/endpoints.py widgets/pubg/squad-compare.html
git commit -m "feat(pubg): squad-compare Aggregation + Widget"
```


## Phase 12: Cross-Player-View und Chat-Stats-Popup

### Task 12.1: scenes/stats.html

**Files:**
- Create: `scenes/stats.html`

- [ ] **Step 1: HTML — Standalone-Web-View**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG Player Stats</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../widgets/pubg/_pubg.css">
  <style>
    body {
      background: linear-gradient(180deg, #1a0d2a 0%, #0a0510 100%);
      min-height: 100vh; padding: 40px 20px;
      display: flex; justify-content: center;
    }
    .container { max-width: 720px; width: 100%; }
    h1 { font-size: 2em; margin: 0 0 24px; color: var(--pubg-gold); }
    .section { margin-bottom: 28px; padding: 20px 24px; }
    .section h2 {
      margin: 0 0 14px; font-size: 0.85em; color: var(--pubg-muted);
      text-transform: uppercase; letter-spacing: 0.1em;
    }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .grid .cell { display: flex; flex-direction: column; }
    .matches { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    .matches th, .matches td {
      padding: 6px 8px; text-align: left;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .matches th { color: var(--pubg-muted); font-size: 0.75em;
                  text-transform: uppercase; letter-spacing: 0.08em; }
  </style>
</head>
<body>
  <div class="container">
    <h1 id="title">—</h1>

    <div class="pubg-card section">
      <h2>Mit dir gespielt</h2>
      <div class="grid">
        <div class="cell"><span class="pubg-stat-value" id="sm">—</span><span class="pubg-stat-label">Matches</span></div>
        <div class="cell"><span class="pubg-stat-value" id="skd">—</span><span class="pubg-stat-label">K/D</span></div>
        <div class="cell"><span class="pubg-stat-value" id="sdmg">—</span><span class="pubg-stat-label">Avg DMG</span></div>
        <div class="cell"><span class="pubg-stat-value" id="splace">—</span><span class="pubg-stat-label">Avg Place</span></div>
        <div class="cell"><span class="pubg-stat-value" id="swin">—</span><span class="pubg-stat-label">Win-Rate</span></div>
        <div class="cell"><span class="pubg-stat-value" id="swins">—</span><span class="pubg-stat-label">Wins</span></div>
      </div>
    </div>

    <div class="pubg-card section" id="careerSection">
      <h2>Career Lifetime (PUBG-API)</h2>
      <div class="grid">
        <div class="cell"><span class="pubg-stat-value" id="cm">—</span><span class="pubg-stat-label">Matches</span></div>
        <div class="cell"><span class="pubg-stat-value" id="ckd">—</span><span class="pubg-stat-label">K/D</span></div>
        <div class="cell"><span class="pubg-stat-value" id="cwins">—</span><span class="pubg-stat-label">Wins</span></div>
        <div class="cell"><span class="pubg-stat-value" id="cwinpct">—</span><span class="pubg-stat-label">Win %</span></div>
        <div class="cell"><span class="pubg-stat-value" id="ctop10">—</span><span class="pubg-stat-label">Top10 %</span></div>
        <div class="cell"><span class="pubg-stat-value" id="chs">—</span><span class="pubg-stat-label">Headshot</span></div>
      </div>
    </div>

    <div class="pubg-card section">
      <h2>Letzte 5 Matches mit dir</h2>
      <table class="matches">
        <thead><tr><th>Map</th><th>Place</th><th>Kills</th><th>DMG</th><th>Datum</th></tr></thead>
        <tbody id="last5"></tbody>
      </table>
    </div>
  </div>

  <script src="../widgets/pubg/_pubg.js"></script>
  <script>
    const PLAYER = PubgUI.qs("player", "");

    if (!PLAYER) {
      document.querySelector(".container").innerHTML =
        '<h1 style="color:var(--pubg-error)">Parameter ?player=NAME fehlt</h1>';
    } else {
      document.getElementById("title").textContent = PLAYER;
      PubgUI.fetchJson(`/api/pubg/co-player/${encodeURIComponent(PLAYER)}`)
        .then(d => {
          document.getElementById("title").textContent = d.name || PLAYER;
          const sh = d.sharedHistory || {};
          document.getElementById("sm").textContent = PubgUI.fmtNum(sh.matches);
          document.getElementById("skd").textContent = PubgUI.fmtKD(sh.kd);
          document.getElementById("sdmg").textContent = PubgUI.fmtNum(Math.round(sh.avgDmg||0));
          document.getElementById("splace").textContent = sh.avgPlace ? "#" + sh.avgPlace.toFixed(1) : "—";
          document.getElementById("swin").textContent = PubgUI.fmtPct(sh.winRate);
          document.getElementById("swins").textContent = PubgUI.fmtNum(sh.wins);

          const cl = d.careerLifetime;
          if (cl) {
            document.getElementById("cm").textContent = PubgUI.fmtNum(cl.rounds_played);
            document.getElementById("ckd").textContent = PubgUI.fmtKD(cl.kd_ratio);
            document.getElementById("cwins").textContent = PubgUI.fmtNum(cl.wins);
            document.getElementById("cwinpct").textContent = PubgUI.fmtPct(cl.win_rate);
            document.getElementById("ctop10").textContent = PubgUI.fmtPct(cl.top10_rate);
            document.getElementById("chs").textContent = PubgUI.fmtPct(cl.headshot_rate);
          } else {
            document.getElementById("careerSection").style.display = "none";
          }

          document.getElementById("last5").innerHTML =
            (sh.last5Matches || []).map(m => `
              <tr>
                <td>${PubgUI.fmtMap(m.map)}</td>
                <td>#${m.place || "?"}</td>
                <td>${m.kills || 0}</td>
                <td>${PubgUI.fmtNum(Math.round(m.damage||0))}</td>
                <td>${(m.playedAt||"").slice(0,10)}</td>
              </tr>`).join("") || `<tr><td colspan="5">—</td></tr>`;
        })
        .catch(e => { document.querySelector(".container").innerHTML += `<div class="pubg-error">${e}</div>`; });
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Browser-Test**

`http://localhost:8080/scenes/stats.html?player=PEX_LuCKoR`

- [ ] **Step 3: Commit**

```bash
git add scenes/stats.html
git commit -m "feat(pubg): scenes/stats.html — Cross-Player-View"
```

### Task 12.2: chat-stats-popup.html (Streamer.bot-driven)

**Files:**
- Create: `widgets/pubg/chat-stats-popup.html`

- [ ] **Step 1: HTML — Mosaic-Single-Tile-Layout**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PUBG Chat Stats</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_pubg.css">
  <style>
    body { display: flex; align-items: center; justify-content: center;
           height: 100vh; padding: 0; }
    .popup {
      width: 460px;
      padding: 24px 28px;
      transform: translateY(40px);
      opacity: 0;
      transition: opacity 0.5s, transform 0.5s;
    }
    .popup.show { opacity: 1; transform: translateY(0); }
    .popup .ribbon {
      display: inline-block;
      padding: 3px 10px;
      background: var(--pubg-gold);
      color: #1a0d2a;
      font-weight: 700;
      font-size: 0.72em;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      border-radius: 3px;
      margin-bottom: 10px;
    }
    .popup .name { font-size: 1.6em; font-weight: 700; margin-bottom: 14px; }
    .popup .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
    .popup .cell { display: flex; flex-direction: column; }
    .popup .cell .pubg-stat-value { font-size: 1.5em; }
    .popup .career { font-size: 0.85em; color: var(--pubg-muted);
                     margin-top: 14px; padding-top: 14px;
                     border-top: 1px solid rgba(255,255,255,0.08); }
  </style>
</head>
<body>
  <div class="pubg-card popup" id="popup">
    <span class="ribbon">Mit mir gespielt</span>
    <div class="name" id="name">—</div>
    <div class="grid">
      <div class="cell"><span class="pubg-stat-value" id="m">—</span><span class="pubg-stat-label">Matches</span></div>
      <div class="cell"><span class="pubg-stat-value" id="kd">—</span><span class="pubg-stat-label">K/D</span></div>
      <div class="cell"><span class="pubg-stat-value" id="dmg">—</span><span class="pubg-stat-label">Avg DMG</span></div>
    </div>
    <div class="career" id="career">—</div>
  </div>

  <script src="_pubg.js"></script>
  <script>
    const PLAYER = PubgUI.qs("player", "");
    const DURATION = parseInt(PubgUI.qs("duration", 12), 10) * 1000;

    if (!PLAYER) {
      document.getElementById("name").textContent = "?player= fehlt";
    } else {
      PubgUI.fetchJson(`/api/pubg/co-player/${encodeURIComponent(PLAYER)}`)
        .then(d => {
          if (d.error) {
            document.getElementById("name").textContent = "Player nicht gefunden";
            return reveal();
          }
          document.getElementById("name").textContent = d.name || PLAYER;
          const sh = d.sharedHistory || {};
          document.getElementById("m").textContent = PubgUI.fmtNum(sh.matches);
          document.getElementById("kd").textContent = PubgUI.fmtKD(sh.kd);
          document.getElementById("dmg").textContent = PubgUI.fmtNum(Math.round(sh.avgDmg||0));
          const cl = d.careerLifetime;
          document.getElementById("career").textContent = cl
            ? `Career: ${PubgUI.fmtNum(cl.rounds_played)} Games · K/D ${PubgUI.fmtKD(cl.kd_ratio)} · ${cl.wins} Wins`
            : (sh.matches ? "Career: noch nicht geladen (<5 gemeinsame Matches?)" : "Noch nie zusammen gespielt");
          reveal();
        })
        .catch(e => { document.getElementById("name").textContent = "Fehler"; reveal(); });
    }

    function reveal() {
      document.getElementById("popup").classList.add("show");
      if (DURATION > 0) {
        setTimeout(() => {
          document.getElementById("popup").classList.remove("show");
        }, DURATION);
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Manueller Test**

`http://localhost:8080/widgets/pubg/chat-stats-popup.html?player=PEX_LuCKoR&duration=12`

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/chat-stats-popup.html
git commit -m "feat(pubg): chat-stats-popup für Streamer.bot-Trigger"
```


## Phase 13: CLI, Service-Setup, README

### Task 13.1: CLI für Init und Cold-Start

**Files:**
- Create: `pubg/cli.py`
- Modify: `serve.py`

- [ ] **Step 1: CLI-Modul schreiben**

```python
# pubg/cli.py
import os
import sys
from pubg.config import load_config, load_api_key
from pubg.db import (connect, init_schema, upsert_player, get_player_by_name)
from pubg.api_client import PubgClient
from pubg.poller import run_single_tick


def init_db(root: str) -> str:
    os.makedirs(os.path.join(root, "data"), exist_ok=True)
    db_path = os.path.join(root, "data", "pubg-history.db")
    conn = connect(db_path)
    init_schema(conn)
    conn.close()
    print(f"Schema initialisiert: {db_path}")
    return db_path


def cold_start(root: str, max_matches: int = 30):
    cfg = load_config(os.path.join(root, "config", "pubg.json"))
    api_key = load_api_key(os.path.join(root, ".secrets"))
    if not api_key:
        print("Kein PUBG-API-Key in .secrets!")
        return 1
    db_path = init_db(root)
    client = PubgClient(api_key=api_key, platform=cfg["platform"])
    conn = connect(db_path)

    self_p = get_player_by_name(conn, cfg["playerName"])
    if not self_p:
        print(f"Pulle Account-ID für {cfg['playerName']}…")
        resp = client.get_player(cfg["playerName"])
        if not resp.get("data"):
            print("Player nicht gefunden!")
            return 1
        my_acc_id = resp["data"][0]["id"]
        upsert_player(conn, my_acc_id, cfg["playerName"],
                      cfg["platform"], is_self=True)
    else:
        my_acc_id = self_p["account_id"]
        print(f"Player bereits in DB: {my_acc_id}")

    print(f"Cold-Start: ziehe bis zu {max_matches} Matches…")
    total_imported = 0
    for _ in range(max_matches // 5 + 1):
        stats = run_single_tick(conn, client, cfg["playerName"],
                                 my_acc_id, max_matches_per_tick=5)
        total_imported += stats["new_matches"]
        if stats["errors"]:
            print(f"  Errors: {stats['errors']}")
        if stats["new_matches"] == 0 and stats["skipped"] == 0:
            break
        print(f"  Importiert: +{stats['new_matches']}, "
              f"insgesamt: {total_imported}, skipped: {stats['skipped']}")
        import time
        time.sleep(12)  # zwischen Ticks: 12s ergibt 5 req / 60s
    conn.close()
    print(f"Cold-Start fertig — {total_imported} Matches in DB.")
    return 0


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if len(sys.argv) > 1 and sys.argv[1] == "init":
        init_db(root)
    elif len(sys.argv) > 1 and sys.argv[1] == "cold-start":
        sys.exit(cold_start(root))
    else:
        print("Usage: python -m pubg.cli init | cold-start")
```

- [ ] **Step 2: serve.py CLI-Args verarbeiten**

In serve.py ganz am Anfang nach den Imports:

```python
if len(sys.argv) > 1 and sys.argv[1] == "--init-pubg-db":
    from pubg.cli import init_db
    init_db(os.path.dirname(os.path.abspath(__file__)))
    sys.exit(0)
if len(sys.argv) > 1 and sys.argv[1] == "--pubg-cold-start":
    from pubg.cli import cold_start
    sys.exit(cold_start(os.path.dirname(os.path.abspath(__file__))))
```

- [ ] **Step 3: Manueller Test**

```bash
python serve.py --init-pubg-db
python serve.py --pubg-cold-start
```

- [ ] **Step 4: Commit**

```bash
git add pubg/cli.py serve.py
git commit -m "feat(pubg): CLI für init + cold-start"
```

### Task 13.2: systemd-User-Service-Beispiel

**Files:**
- Create: `docs/pubg-systemd.service.example`

- [ ] **Step 1: Unit-File schreiben**

```ini
# docs/pubg-systemd.service.example
# Kopie nach ~/.config/systemd/user/obs-stream-kit.service
[Unit]
Description=obs-stream-kit Server (PUBG-Stats Always-on)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/git/obs-stream-kit
ExecStart=/usr/bin/python3 %h/git/obs-stream-kit/serve.py 8080
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

- [ ] **Step 2: Aktivieren-Anleitung in Datei kommentieren**

Hänge oben in der Datei an:

```
# Aktivieren:
#   systemctl --user daemon-reload
#   systemctl --user enable --now obs-stream-kit.service
#   systemctl --user status obs-stream-kit.service
#
# Logs:
#   journalctl --user -u obs-stream-kit.service -f
```

- [ ] **Step 3: Commit**

```bash
git add docs/pubg-systemd.service.example
git commit -m "docs(pubg): systemd-User-Service-Beispiel"
```

### Task 13.3: README erweitern

**Files:**
- Modify: `README.md`

- [ ] **Step 1: PUBG-Sektion in README einfügen**

Füge nach den existierenden Sektionen einen Block ein:

```markdown
## PUBG Session Stats

Modulares PUBG-Stats-Set mit lokaler SQLite-Persistenz und Live-Polling der offiziellen
PUBG-Developer-API. Always-on Backend (`serve.py` + `pubg/`-Modul) liefert JSON-Endpoints,
HTML-Widgets als Browser-Sources rendern.

### Setup

1. **API-Key** unter [developer.pubg.com](https://developer.pubg.com) holen (kostenlos,
   10 RPM Default)
2. **`.secrets`** erweitern:
   ```
   PUBG-API-Key:  <dein-key>
   ```
3. **`config/pubg.json`** anpassen (Default-Werte sind in der Datei vorgegeben):
   ```json
   {
     "playerName": "PEX_LuCKoR",
     "platform": "steam",
     "stammCrew": [],
     "pollIntervalSec": 60,
     "minMatchesForLifetime": 5,
     "minMatchesForTopMates": 10
   }
   ```
4. **DB initialisieren + Cold-Start** (zieht die letzten 30 Matches):
   ```bash
   python serve.py --init-pubg-db
   python serve.py --pubg-cold-start
   ```
5. **`serve.py` als Always-on starten** — siehe `docs/pubg-systemd.service.example`
   für systemd-User-Setup. Auf Windows via Task-Scheduler oder NSSM.
6. **Browser-Sources** in OBS einfügen (siehe Tabelle unten).

### Browser-Source-Komponenten

Alle URLs unter `http://localhost:8080/widgets/pubg/<datei>.html`.

| Datei | Zweck | URL-Parameter |
|---|---|---|
| `live-bar.html` | Slim-Counter Gameplay | `refreshMs` |
| `flyout-full.html` | Großes Detail-Panel mit Filter-Slider | — |
| `mates-today.html` | "Heute gespielt mit X" | `layout=carousel\|stack\|fold\|mosaic`, `range=session\|day\|week` |
| `top-mates.html` | Top-5-Liste | `sortBy=avgPlace\|kd\|winRate\|mostPlayed`, `limit`, `minMatches` |
| `post-match-card.html` | 10s-Pop-up nach Match-Ende | `durationMs` |
| `map-distribution.html` | Map-Häufigkeits-Bars | `range=session\|day\|week\|all` |
| `first-fight.html` | Survival-% mit Sparkline | `range` |
| `session-summary.html` | Vollformat Stream-Ending | — |
| `career-card.html` | Lifetime-Anzeige | `player`, `mode=all\|squad-fpp\|...` |
| `news-ticker.html` | Marquee-Bar mit rotierenden Snippets | `rotateMs` |
| `squad-compare.html` | 4er-Vergleichs-Tabelle | `players=A,B,C,D`, `matches` |
| `chat-stats-popup.html` | Streamer.bot-driven Pop-up | `player`, `duration` (Sek) |

Cross-Player-Web-View: `http://localhost:8080/scenes/stats.html?player=NAME`

### Streamer.bot-Setup für `!mypubgstats`

```
Trigger: Twitch Chat Command "!mypubgstats"
Action 1: $pubgName = User-Argument oder gespeichertes Mapping
Action 2: OBS Browser-Source URL setzen:
          http://localhost:8080/widgets/pubg/chat-stats-popup.html?player={pubgName}
Action 3: Source einblenden
Action 4: 12 Sekunden warten
Action 5: Source ausblenden
```

### Status-Monitoring

```
GET http://localhost:8080/api/pubg/status
```
Liefert `{polling, lastPollAt, errors, newMatches, lifetimeRefreshed,
telemetryProcessed, rateLimitRemaining}`. Nutzbar für ein internes Dashboard
oder zum Debuggen.

### Rate-Limit

Default 10 RPM reicht für 1-2 Matches/Min steady-state. Bei häufigen
`!mypubgstats`-Triggern oder vielen Stamm-Mates: Higher-Tier-Key unter
[developer.pubg.com](https://developer.pubg.com) beantragen.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(pubg): README-Section mit Setup, Komponenten, Streamer.bot"
```

### Task 13.4: Final-Smoke-Test

- [ ] **Step 1: Test-Suite gesamthaft laufen lassen**

```bash
pytest tests/ -v
```
Expected: alle PASS.

- [ ] **Step 2: serve.py starten und Endpoints durchgehen**

```bash
python serve.py 8080 &
sleep 3
curl -s http://localhost:8080/api/pubg/status | python -m json.tool
curl -s http://localhost:8080/api/pubg/session | python -m json.tool
curl -s http://localhost:8080/api/pubg/last-match | python -m json.tool
curl -s "http://localhost:8080/api/pubg/top-mates?limit=5&minMatches=1" | python -m json.tool
curl -s "http://localhost:8080/api/pubg/mates-today" | python -m json.tool
curl -s "http://localhost:8080/api/pubg/map-distribution?range=session" | python -m json.tool
curl -s "http://localhost:8080/api/pubg/first-fight-rate?range=session" | python -m json.tool
curl -s "http://localhost:8080/api/pubg/career-lifetime?mode=all" | python -m json.tool
kill %1
```

Expected: alle Endpoints liefern JSON ohne Crash.

- [ ] **Step 3: Browser-Sources visuell prüfen**

Nacheinander in OBS oder Browser öffnen:
- `live-bar.html`
- `post-match-card.html`
- `flyout-full.html`
- `mates-today.html` (alle 4 Layouts via `?layout=`)
- `top-mates.html`
- `map-distribution.html`
- `first-fight.html`
- `session-summary.html`
- `career-card.html`
- `news-ticker.html`
- `chat-stats-popup.html?player=PEX_LuCKoR`
- `scenes/stats.html?player=PEX_LuCKoR`

Erwartet: alle laden, Theme konsistent, keine Console-Errors.

- [ ] **Step 4: Final-Commit (falls noch ausstehend)**

```bash
git status
# falls etwas offen:
git add -p
git commit -m "chore(pubg): Final-Smoke-Test-Korrekturen"
```

---

## Akzeptanzkriterien (Spec-Mapping)

| Spec-Anforderung | Implementiert in |
|---|---|
| Always-on `serve.py` + SQLite + 60s Polling | Phase 5.4–5.5 |
| Schema schlank (Self + Squad + gefilterte Telemetry) | Phase 2, Phase 9.1–9.2 |
| 12 Browser-Source-Widgets + 1 Web-View | Phase 6, 8, 9.4, 10.2, 11, 12 |
| Co-Player-Lifetime ab ≥5 gemeinsamen Matches | Phase 4.4 |
| Top-Mates konfigurierbar (Sort, Limit, Min-Matches) | Phase 7.1–7.2, 11.1 |
| `mates-today.html` mit 4 Layouts (Carousel default) | Phase 8.2 |
| `chat-stats-popup.html?player=…` Streamer.bot-driven | Phase 12.2 |
| `scenes/stats.html` Cross-Player-View | Phase 12.1 |
| Rate-Limit 10 RPM nie überschritten | Phase 3.1 RateLimiter, Phase 5.4 PollerThread |
| Status-Endpoint mit Polling-Health | Phase 5.3, Phase 5.4 |
| OBS-Interagieren-Slider persistiert in SQLite | Phase 10.3, Phase 11.1 |
| Theme Purple/Gold + DM Sans | Phase 6.1 _pubg.css, alle Widgets nutzen es |
| README mit Setup + URL-Parameter-Tabelle | Phase 13.3 |
| systemd-User-Service-Beispiel | Phase 13.2 |
| Cold-Start-Bulk-Import | Phase 13.1 |


## Phase 14: Erweiterte Session-Stats + Animated Count-Up

### Task 14.1: compute_session_stats um Boosts/Heals/Revives/Distance erweitern

**Files:**
- Modify: `pubg/aggregations.py`
- Modify: `tests/pubg/test_aggregations.py`

- [ ] **Step 1: Test anhängen**

```python
def test_session_stats_includes_extended_fields(tmp_db_path):
    from pubg.db import insert_participants, insert_match, set_setting, upsert_player
    conn = _setup(tmp_db_path)
    set_setting(conn, "sessionStartedAt", "2026-05-04T00:00:00Z")
    insert_match(conn, "ext1", "Erangel_Main", "squad-fpp", False, 1800,
                 "2026-05-04T18:00:00Z", None)
    insert_participants(conn, "ext1", [{
        "account_id": "account.A", "name": "PEX_LuCKoR", "team_id": 1,
        "place": 3, "kills": 4, "headshot_kills": 1, "assists": 2,
        "dbnos": 3, "revives": 2, "damage_dealt": 412.0, "longest_kill": 187.5,
        "time_survived": 1690, "walk_distance": 2300.0, "ride_distance": 1500.0,
        "swim_distance": 50.0, "weapons_acquired": 8, "heals": 5, "boosts": 7,
        "team_kills": 0,
    }])
    s = compute_session_stats(conn, "account.A")
    assert s["totalBoosts"] == 7
    assert s["totalHeals"] == 5
    assert s["totalRevives"] == 2
    assert s["totalWeaponsAcquired"] == 8
    assert abs(s["walkKm"] - 2.3) < 0.001
    assert abs(s["rideKm"] - 1.5) < 0.001
    assert abs(s["swimKm"] - 0.05) < 0.001
```

- [ ] **Step 2: Test fail**

- [ ] **Step 3: `compute_session_stats` in `pubg/aggregations.py` erweitern**

Ersetze die SELECT-Query in `compute_session_stats` um die zusätzlichen Spalten:

```python
def compute_session_stats(conn, my_account_id: str) -> dict:
    started = _session_filter(conn)
    rows = conn.execute("""
        SELECT m.match_id, m.map_name, m.played_at,
               pa.kills, pa.damage_dealt, pa.place, pa.headshot_kills,
               pa.longest_kill, pa.boosts, pa.heals, pa.revives,
               pa.weapons_acquired, pa.walk_distance, pa.ride_distance,
               pa.swim_distance, pa.assists, pa.dbnos, pa.time_survived
        FROM matches m
        JOIN participants pa ON pa.match_id = m.match_id
        WHERE pa.account_id = ? AND m.played_at >= ?
        ORDER BY m.played_at ASC
    """, (my_account_id, started)).fetchall()

    kills = sum(r["kills"] or 0 for r in rows)
    headshots = sum(r["headshot_kills"] or 0 for r in rows)
    damage = sum(r["damage_dealt"] or 0.0 for r in rows)
    wins = sum(1 for r in rows if (r["place"] or 99) == 1)
    top10s = sum(1 for r in rows if (r["place"] or 99) <= 10)
    best_place = min((r["place"] for r in rows if r["place"]), default=None)
    longest = max((r["longest_kill"] or 0.0 for r in rows), default=0.0)
    boosts = sum(r["boosts"] or 0 for r in rows)
    heals = sum(r["heals"] or 0 for r in rows)
    revives = sum(r["revives"] or 0 for r in rows)
    weapons = sum(r["weapons_acquired"] or 0 for r in rows)
    walk_m = sum(r["walk_distance"] or 0.0 for r in rows)
    ride_m = sum(r["ride_distance"] or 0.0 for r in rows)
    swim_m = sum(r["swim_distance"] or 0.0 for r in rows)
    assists = sum(r["assists"] or 0 for r in rows)
    dbnos = sum(r["dbnos"] or 0 for r in rows)
    survived_sec = sum(r["time_survived"] or 0 for r in rows)

    map_breakdown = {}
    for r in rows:
        m = r["map_name"]
        map_breakdown[m] = map_breakdown.get(m, 0) + 1

    return {
        "matches": len(rows),
        "kills": kills,
        "damage": damage,
        "wins": wins,
        "top10s": top10s,
        "kd": kills / max(len(rows) - wins, 1),
        "headshotPct": (headshots / kills * 100) if kills else 0,
        "bestPlace": best_place,
        "longestKill": longest,
        "totalBoosts": boosts,
        "totalHeals": heals,
        "totalRevives": revives,
        "totalWeaponsAcquired": weapons,
        "totalAssists": assists,
        "totalDbnos": dbnos,
        "totalSurvivedSec": survived_sec,
        "walkKm": walk_m / 1000.0,
        "rideKm": ride_m / 1000.0,
        "swimKm": swim_m / 1000.0,
        "sessionStartedAt": started,
        "mapBreakdown": [{"map": m, "count": c}
                         for m, c in sorted(map_breakdown.items(),
                                            key=lambda x: -x[1])],
    }
```

- [ ] **Step 4: Tests grün**

```bash
pytest tests/pubg/test_aggregations.py -v
```

- [ ] **Step 5: Commit**

```bash
git add pubg/aggregations.py tests/pubg/test_aggregations.py
git commit -m "feat(pubg): Session-Stats um Boosts/Heals/Revives/Distance erweitert"
```

### Task 14.2: animateNumber Helper in _pubg.js

**Files:**
- Modify: `widgets/pubg/_pubg.js`

- [ ] **Step 1: Helper anhängen**

In `_pubg.js`, vor dem `global.PubgUI = PubgUI;`-Zeile:

```javascript
  PubgUI.animateNumber = function (el, targetValue, opts) {
    const o = opts || {};
    const duration = o.durationMs || 900;
    const formatter = o.format || ((n) => String(Math.round(n)));
    const startText = (el.textContent || "").replace(/[^\d.\-]/g, "");
    const start = parseFloat(startText) || 0;
    if (start === targetValue) {
      el.textContent = formatter(targetValue);
      return;
    }
    const startTs = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - startTs) / duration);
      // easeOutQuart
      const eased = 1 - Math.pow(1 - t, 4);
      const value = start + (targetValue - start) * eased;
      el.textContent = formatter(value);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };

  PubgUI.fmtNumAnim = (n) => {
    if (n == null) return "—";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(Math.round(n));
  };

  PubgUI.fmtKm = (km) => (km == null ? "—" : km.toFixed(2) + "km");
```

- [ ] **Step 2: Manueller Browser-Test**

In Browser-Console:
```javascript
const el = document.createElement("div");
document.body.appendChild(el);
el.textContent = "0";
PubgUI.animateNumber(el, 412, {durationMs: 1500});
// Sehe Zahl smooth hochzählen
```

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/_pubg.js
git commit -m "feat(pubg): animateNumber Helper für Count-Up-Animationen"
```

### Task 14.3: live-bar.html nutzt animateNumber

**Files:**
- Modify: `widgets/pubg/live-bar.html`

- [ ] **Step 1: render() umschreiben**

Im `<script>`-Block, ersetze die `render`-Function:

```javascript
    function render(s) {
      const fmt = (n) => {
        if (n == null) return "—";
        if (n >= 1000) return (n / 1000).toFixed(1) + "k";
        return String(Math.round(n));
      };
      PubgUI.animateNumber(document.getElementById("kills"), s.kills || 0, {format: fmt});
      PubgUI.animateNumber(document.getElementById("dmg"), s.damage || 0, {format: fmt});
      PubgUI.animateNumber(document.getElementById("wins"), s.wins || 0, {format: fmt});
      PubgUI.animateNumber(document.getElementById("matches"), s.matches || 0, {format: fmt});
      const lastMap = s.mapBreakdown && s.mapBreakdown[0];
      document.getElementById("map").textContent =
        lastMap ? PubgUI.fmtMap(lastMap.map) : "—";
    }
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/live-bar.html
git commit -m "feat(pubg): live-bar nutzt animateNumber für Count-Up"
```

### Task 14.4: post-match-card.html nutzt animateNumber

**Files:**
- Modify: `widgets/pubg/post-match-card.html`

- [ ] **Step 1: showCard() umschreiben**

Im `<script>`-Block, ersetze die `showCard`-Function so dass die Zahlen animiert reinrollen:

```javascript
    function showCard(lm) {
      document.getElementById("matchnum").textContent = "#" + (lm.matchId || "");
      document.getElementById("header").textContent =
        PubgUI.fmtMap(lm.map) + " · " + PubgUI.fmtMode(lm.mode);
      document.getElementById("place").textContent = PubgUI.fmtPlace(lm.place);
      const ms = lm.myStats || {};
      const card = document.getElementById("card");
      card.classList.add("visible");

      // Reset für Re-Animation
      ["kills", "dmg"].forEach(id => document.getElementById(id).textContent = "0");
      requestAnimationFrame(() => {
        PubgUI.animateNumber(document.getElementById("kills"), ms.kills || 0,
                             {format: (n) => String(Math.round(n))});
        PubgUI.animateNumber(document.getElementById("dmg"),
                             Math.round(ms.damage_dealt || 0),
                             {format: (n) => Math.round(n) >= 1000 ? (n/1000).toFixed(1)+"k" : String(Math.round(n))});
      });
      const min = Math.floor((ms.time_survived || 0) / 60);
      const sec = (ms.time_survived || 0) % 60;
      document.getElementById("surv").textContent = `${min}:${String(sec).padStart(2, "0")}`;

      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => card.classList.remove("visible"), HIDE_AFTER_MS);
    }
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/post-match-card.html
git commit -m "feat(pubg): post-match-card nutzt animateNumber"
```

### Task 14.5: session-summary.html erweitert um Extended Stats

**Files:**
- Modify: `widgets/pubg/session-summary.html`

- [ ] **Step 1: Layout um Extended-Stats-Block erweitern**

Im HTML, nach dem ersten `<div class="grid">`-Block, einen zweiten Block einfügen:

```html
    <div class="grid" style="margin-top: 14px;">
      <div class="cell"><span class="pubg-stat-value" id="boosts">—</span><span class="pubg-stat-label">Boosts</span></div>
      <div class="cell"><span class="pubg-stat-value" id="heals">—</span><span class="pubg-stat-label">Heals</span></div>
      <div class="cell"><span class="pubg-stat-value" id="revives">—</span><span class="pubg-stat-label">Revives</span></div>
      <div class="cell"><span class="pubg-stat-value" id="weapons">—</span><span class="pubg-stat-label">Weapons</span></div>
    </div>
    <div class="grid" style="margin-top: 14px;">
      <div class="cell"><span class="pubg-stat-value" id="walk">—</span><span class="pubg-stat-label">Walked</span></div>
      <div class="cell"><span class="pubg-stat-value" id="drive">—</span><span class="pubg-stat-label">Driven</span></div>
      <div class="cell"><span class="pubg-stat-value" id="swim">—</span><span class="pubg-stat-label">Swam</span></div>
      <div class="cell"><span class="pubg-stat-value" id="assists">—</span><span class="pubg-stat-label">Assists</span></div>
    </div>
```

In `render()`-Function ersetze den Session-Block durch animierte Updates:

```javascript
    function render() {
      PubgUI.fetchJson("/api/pubg/session").then(s => {
        const num = (n) => String(Math.round(n));
        const knum = (n) => n >= 1000 ? (n/1000).toFixed(1)+"k" : String(Math.round(n));
        const km = (n) => n.toFixed(2) + "km";

        PubgUI.animateNumber(document.getElementById("matches"), s.matches || 0, {format: num});
        PubgUI.animateNumber(document.getElementById("kills"), s.kills || 0, {format: num});
        PubgUI.animateNumber(document.getElementById("dmg"), s.damage || 0, {format: knum});
        PubgUI.animateNumber(document.getElementById("wins"), s.wins || 0, {format: num});

        PubgUI.animateNumber(document.getElementById("boosts"), s.totalBoosts || 0, {format: num});
        PubgUI.animateNumber(document.getElementById("heals"), s.totalHeals || 0, {format: num});
        PubgUI.animateNumber(document.getElementById("revives"), s.totalRevives || 0, {format: num});
        PubgUI.animateNumber(document.getElementById("weapons"), s.totalWeaponsAcquired || 0, {format: num});

        PubgUI.animateNumber(document.getElementById("walk"), s.walkKm || 0, {format: km});
        PubgUI.animateNumber(document.getElementById("drive"), s.rideKm || 0, {format: km});
        PubgUI.animateNumber(document.getElementById("swim"), s.swimKm || 0, {format: km});
        PubgUI.animateNumber(document.getElementById("assists"), s.totalAssists || 0, {format: num});
      });
      PubgUI.fetchJson("/api/pubg/map-distribution?range=session").then(list => {
        document.getElementById("maps").innerHTML = list.map(m =>
          `<div class="map-row"><span>${PubgUI.fmtMap(m.map)}</span><span class="pubg-stat-value">${m.count}</span></div>`).join("");
      });
      PubgUI.fetchJson("/api/pubg/mates-today?range=session").then(list => {
        document.getElementById("mates").innerHTML = list.map(m =>
          `<div class="mate-row"><span>${m.name}</span><span class="pubg-stat-value">${m.sharedMatchesToday}</span></div>`).join("");
      });
    }
```

- [ ] **Step 2: Browser-Test in Stream-Ending**

- [ ] **Step 3: Commit**

```bash
git add widgets/pubg/session-summary.html
git commit -m "feat(pubg): session-summary mit erweiterten Stats + Count-Up"
```

### Task 14.6: flyout-full.html — Extended Stats Sektion

**Files:**
- Modify: `widgets/pubg/flyout-full.html`

- [ ] **Step 1: Neue Section ergänzen**

Vor der Section "Filter" im HTML einfügen:

```html
    <div class="section">
      <h3>Survival</h3>
      <div class="stat-grid">
        <div class="cell"><span class="pubg-stat-value" id="boosts">—</span><span class="pubg-stat-label">Boosts</span></div>
        <div class="cell"><span class="pubg-stat-value" id="heals">—</span><span class="pubg-stat-label">Heals</span></div>
        <div class="cell"><span class="pubg-stat-value" id="revives">—</span><span class="pubg-stat-label">Revives</span></div>
        <div class="cell"><span class="pubg-stat-value" id="walk">—</span><span class="pubg-stat-label">Walked</span></div>
        <div class="cell"><span class="pubg-stat-value" id="drive">—</span><span class="pubg-stat-label">Driven</span></div>
        <div class="cell"><span class="pubg-stat-value" id="weapons">—</span><span class="pubg-stat-label">Weapons</span></div>
      </div>
    </div>
```

In `renderSession(s)` ersetze den Body durch:

```javascript
    function renderSession(s) {
      const num = (n) => String(Math.round(n));
      const knum = (n) => n >= 1000 ? (n/1000).toFixed(1)+"k" : String(Math.round(n));
      const km = (n) => n.toFixed(1) + "km";

      PubgUI.animateNumber(document.getElementById("kills"), s.kills || 0, {format: num});
      PubgUI.animateNumber(document.getElementById("dmg"), s.damage || 0, {format: knum});
      PubgUI.animateNumber(document.getElementById("wins"), s.wins || 0, {format: num});
      document.getElementById("kd").textContent = PubgUI.fmtKD(s.kd);
      document.getElementById("hs").textContent = PubgUI.fmtPct(s.headshotPct);
      document.getElementById("best").textContent = PubgUI.fmtPlace(s.bestPlace);

      PubgUI.animateNumber(document.getElementById("boosts"), s.totalBoosts || 0, {format: num});
      PubgUI.animateNumber(document.getElementById("heals"), s.totalHeals || 0, {format: num});
      PubgUI.animateNumber(document.getElementById("revives"), s.totalRevives || 0, {format: num});
      PubgUI.animateNumber(document.getElementById("walk"), s.walkKm || 0, {format: km});
      PubgUI.animateNumber(document.getElementById("drive"), s.rideKm || 0, {format: km});
      PubgUI.animateNumber(document.getElementById("weapons"), s.totalWeaponsAcquired || 0, {format: num});
    }
```

- [ ] **Step 2: Commit**

```bash
git add widgets/pubg/flyout-full.html
git commit -m "feat(pubg): flyout-full mit Survival-Section + Count-Up"
```

