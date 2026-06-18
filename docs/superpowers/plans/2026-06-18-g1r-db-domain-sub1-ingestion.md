# G1R DB-Domain · Subprojekt 1 (Ingestion) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rohe G1R-Spieldaten landen run-getaggt und tenant-skaliert in der DB (Prod-Postgres, Tests Sqlite); abgeleitete Records/Totals/Career folgen in Subprojekt 2.

**Architecture:** Mod schreibt lokale JSON → lokaler Proxy POSTet Snapshots+Events an `/api/g1r/ingest` (Tenant-Token) → `g1r/`-Package ordnet die Daten einem Run zu (Save-Kennung/Heuristik/manuell), dedupliziert per `client_seq` und schreibt drei Tabellen. Folgt dem `pubg/`-Package-Pattern.

**Tech Stack:** Python (psycopg2 auf Prod, sqlite3 in Tests via `g1r/db.py`), Flask-Routing in `app/views_api.py`, UE4SS-Lua-Mod, pytest mit `tmp_db_path`.

**Referenz-Spec:** `docs/superpowers/specs/2026-06-18-g1r-db-domain-sub1-ingestion.md`

**Konventionen aus der Codebase (vorher lesen):**
- `pubg/db.py` (sqlite-Schema + `connect`/`init_schema` + DAO-Muster), `pubg/db_pg.py` (pg-Schema + `init_schema`).
- `pubg/endpoints.py:32-40` (`_ok`/`_err`), `pubg/endpoints.py` `EndpointRegistry.dispatch(method, path, body, headers)`.
- `app/views_api.py:174` (`_dispatch`), `:243-258` (Routes `/api/<path>` + `/s/<token>/api/<path>`, `g.tenant_id` bereits gesetzt).
- `tests/pubg/test_endpoints.py` (Registry-Test-Muster mit `tmp_db_path`).
- DAO-Funktionen nutzen `?`-Platzhalter + `INSERT … RETURNING id` (läuft auf sqlite ≥3.35 nativ und auf Postgres via `core.db_compat.SqliteCompatConn`).

---

## Task 1: Save-Kennung-Spike (Mod) — Machbarkeit, blockt nichts

**Ziel:** Klären, ob UE4SS eine stabile Durchlauf-Kennung hergibt. Ergebnis bestimmt nur, wie oft die Heuristik einspringt; `save_key` ist `nullable`, also kein Blocker.

**Files:**
- Modify: `g1r-local/G1RExport/scripts/main.lua` (einmaliger Diagnose-Print, analog zur bestehenden `guildDiagDone`-Diagnose)

- [ ] **Step 1: Diagnose-Print für Save-Kennungs-Kandidaten einbauen**

Neben `guildDiagDone` eine `saveDiagDone`-Flag deklarieren und im `tick()` (nach dem Guild-Diag-Block) einmalig die Kandidaten abklopfen — jeder Zugriff in eigenem `pcall`, damit nichts crasht:

```lua
if not saveDiagDone then
    saveDiagDone = true
    pcall(function()
        local gi, gs = "(nil)", "(nil)"
        pcall(function()
            local inst = FindFirstOf("GothicGameInstance") or FindFirstOf("GameInstance")
            if inst then gi = tostring(inst:GetFullName()) end
        end)
        -- Kandidaten: SaveGame-Subsystem / aktueller Slotname / Neuspiel-Zeit.
        pcall(function()
            local sgs = FindFirstOf("GothicSaveGameSystem") or FindFirstOf("SaveGameSystem")
            if sgs then gs = tostring(sgs:GetFullName()) end
        end)
        print(string.format("[G1RExport] Save-Diag: GameInstance=%q SaveSys=%q\n", gi, gs))
    end)
end
```

- [ ] **Step 2: lupa-Compile-Check (Pflicht — luaparser reicht nicht)**

Run (Harness aus `reference_lua_compile_check`, mockt UE4SS-Globals):
```bash
cd /home/ruschinski/git/obs-stream-kit && python3 -c "
import lupa; lua=lupa.LuaRuntime(unpack_returned_tuples=True)
lua.execute('RegisterHook=function() end; LoopAsync=function() end; FindFirstOf=function() return nil end; FindAllOf=function() return {} end; StaticFindObject=function() return nil end; FName=function() return nil end; RegisterKeyBind=function() end; DumpAllObjects=function() end; ExecuteInGameThread=function(f) end; Key=setmetatable({},{__index=function() return {} end}); ModifierKey=setmetatable({},{__index=function() return {} end}); require=function() return nil end; print=function() end; IsKeyBindRegistered=function() return false end')
src=open('g1r-local/G1RExport/scripts/main.lua').read()
print(lua.eval(\"function(s) local f,e=load(s,'main.lua'); if not f then return 'COMPILE: '..tostring(e) end; local ok,err=pcall(f); return ok and 'OK' or 'RUNTIME: '..tostring(err) end\")(src))
"
```
Expected: `OK`

- [ ] **Step 3: Commit + In-Game-Verifikation an den User delegieren**

```bash
git add g1r-local/G1RExport/scripts/main.lua
git commit -m "spike(g1r-mod): Save-Kennungs-Diagnose (GameInstance/SaveSystem abklopfen)"
```
Der User kopiert den Mod, startet das Spiel, meldet die `Save-Diag:`-Zeile. **Ergebnis dokumentieren** (welcher Kandidat eine stabile ID liefert) — Task 9 nutzt es. Bis dahin weiterbauen (alle anderen Tasks sind unabhängig).

---

## Task 2: `g1r/db.py` — Sqlite-Schema + connect + init_schema

**Files:**
- Create: `g1r/__init__.py` (leer)
- Create: `g1r/db.py`
- Create: `tests/g1r/__init__.py` (leer)
- Create: `tests/g1r/test_db.py`

- [ ] **Step 1: Failing test**

```python
# tests/g1r/test_db.py
from g1r.db import connect, init_schema


def test_init_schema_creates_tables(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    names = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert {"g1r_run", "g1r_sample", "g1r_event", "g1r_ingest_seq"} <= names
```

- [ ] **Step 2: Run → fail**

Run: `pytest tests/g1r/test_db.py::test_init_schema_creates_tables -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'g1r'`)

- [ ] **Step 3: Implementieren**

```python
# g1r/db.py
"""G1R-DB (Sqlite-Variante für Tests/Dev). Prod nutzt g1r/db_pg.py; die DAO-
Funktionen hier laufen via core.db_compat.SqliteCompatConn auch auf Postgres
(?-Platzhalter + INSERT … RETURNING id)."""
import datetime
import json
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS g1r_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    save_key TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    label TEXT,
    detection TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS g1r_sample (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    ts TEXT NOT NULL,
    level INTEGER, xp INTEGER, hp REAL, hp_max REAL, mana REAL, mana_max REAL,
    strength INTEGER, dexterity INTEGER, magic_circle INTEGER, learn_pts INTEGER,
    res_fire INTEGER, res_ice INTEGER, res_edge INTEGER, res_point INTEGER, res_blunt INTEGER,
    distance_m REAL, steps INTEGER, guild_key TEXT,
    strongest_melee TEXT, strongest_melee_dmg INTEGER,
    strongest_ranged TEXT, strongest_ranged_dmg INTEGER,
    strongest_spell TEXT
);
CREATE TABLE IF NOT EXISTS g1r_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    tenant_id INTEGER NOT NULL,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    value INTEGER,
    meta TEXT
);
CREATE TABLE IF NOT EXISTS g1r_ingest_seq (
    tenant_id INTEGER NOT NULL,
    client_seq INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, client_seq)
);
CREATE INDEX IF NOT EXISTS ix_g1r_sample_trt ON g1r_sample(tenant_id, run_id, ts);
CREATE INDEX IF NOT EXISTS ix_g1r_event_trt ON g1r_event(tenant_id, run_id, ts);
"""


def connect(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def init_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
```

- [ ] **Step 4: Run → pass**

Run: `pytest tests/g1r/test_db.py -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add g1r/__init__.py g1r/db.py tests/g1r/__init__.py tests/g1r/test_db.py
git commit -m "feat(g1r): DB-Schema (g1r_run/sample/event/ingest_seq) + init"
```

---

## Task 3: Run-Zuordnung (`assign_run`) — neu / selber / Heuristik / manuell

**Files:**
- Modify: `g1r/db.py`
- Modify: `tests/g1r/test_db.py`

**Vertrag:**
`assign_run(conn, tenant_id, save_key, snapshot, *, force_new=False, label=None) -> int`
liefert die `run_id`. `snapshot` ist ein dict mit u.a. `level`, `xp`.

Logik:
- `force_new` → neuer Run (`detection='manual'`).
- sonst aktiven Run des Tenants holen (jüngster ohne `ended_at`, sonst jüngster).
  - `save_key` gesetzt & == aktiver `save_key` → selber Run.
  - `save_key` gesetzt & != aktiver → neuer Run (`detection='save'`), alten `ended_at` setzen.
  - `save_key` None → Heuristik: kein aktiver Run **oder** (`level<=2` und `xp<=200` und der aktive Run hatte schon `level>=5` im letzten Sample) → neuer Run (`detection='heuristic'`); sonst selber.

- [ ] **Step 1: Failing tests**

```python
# tests/g1r/test_db.py  (ergänzen)
from g1r.db import connect, init_schema, assign_run, latest_sample_level


def _fresh(tmp_db_path):
    conn = connect(tmp_db_path); init_schema(conn); return conn


def test_assign_run_creates_first_run(tmp_db_path):
    conn = _fresh(tmp_db_path)
    rid = assign_run(conn, 1, "SAVE-A", {"level": 1, "xp": 0})
    assert isinstance(rid, int)
    row = conn.execute("SELECT detection, save_key FROM g1r_run WHERE id=?", (rid,)).fetchone()
    assert row["detection"] == "save" and row["save_key"] == "SAVE-A"


def test_same_save_key_keeps_run(tmp_db_path):
    conn = _fresh(tmp_db_path)
    r1 = assign_run(conn, 1, "SAVE-A", {"level": 1, "xp": 0})
    r2 = assign_run(conn, 1, "SAVE-A", {"level": 5, "xp": 900})
    assert r1 == r2


def test_changed_save_key_starts_new_run(tmp_db_path):
    conn = _fresh(tmp_db_path)
    r1 = assign_run(conn, 1, "SAVE-A", {"level": 9, "xp": 5000})
    r2 = assign_run(conn, 1, "SAVE-B", {"level": 1, "xp": 0})
    assert r2 != r1
    ended = conn.execute("SELECT ended_at FROM g1r_run WHERE id=?", (r1,)).fetchone()
    assert ended["ended_at"] is not None


def test_force_new_is_manual(tmp_db_path):
    conn = _fresh(tmp_db_path)
    r1 = assign_run(conn, 1, "SAVE-A", {"level": 1, "xp": 0})
    r2 = assign_run(conn, 1, "SAVE-A", {"level": 2, "xp": 50}, force_new=True, label="Hardcore")
    assert r2 != r1
    row = conn.execute("SELECT detection, label FROM g1r_run WHERE id=?", (r2,)).fetchone()
    assert row["detection"] == "manual" and row["label"] == "Hardcore"


def test_heuristic_new_run_on_stat_reset(tmp_db_path):
    conn = _fresh(tmp_db_path)
    r1 = assign_run(conn, 1, None, {"level": 8, "xp": 4000})
    # ein Sample schreiben, damit latest_sample_level den hohen Stand sieht
    conn.execute("INSERT INTO g1r_sample(run_id,tenant_id,ts,level,xp) VALUES(?,?,?,?,?)",
                 (r1, 1, "2026-06-18T00:00:00Z", 8, 4000)); conn.commit()
    r2 = assign_run(conn, 1, None, {"level": 1, "xp": 0})
    assert r2 != r1


def test_cross_tenant_isolation(tmp_db_path):
    conn = _fresh(tmp_db_path)
    a = assign_run(conn, 1, "SAVE-A", {"level": 1, "xp": 0})
    b = assign_run(conn, 2, "SAVE-A", {"level": 1, "xp": 0})  # gleicher save_key, anderer Tenant
    assert a != b
```

- [ ] **Step 2: Run → fail**

Run: `pytest tests/g1r/test_db.py -k "assign_run or save_key or run or tenant" -v`
Expected: FAIL (`ImportError: cannot import name 'assign_run'`)

- [ ] **Step 3: Implementieren (in `g1r/db.py` anhängen)**

```python
def _insert_run(conn, tenant_id, save_key, detection, label):
    row = conn.execute(
        "INSERT INTO g1r_run(tenant_id, save_key, started_at, label, detection, created_at) "
        "VALUES(?,?,?,?,?,?) RETURNING id",
        (tenant_id, save_key, _now_iso(), label, detection, _now_iso()),
    ).fetchone()
    conn.commit()
    return row[0]


def _active_run(conn, tenant_id):
    return conn.execute(
        "SELECT id, save_key FROM g1r_run WHERE tenant_id=? "
        "ORDER BY (ended_at IS NULL) DESC, id DESC LIMIT 1",
        (tenant_id,),
    ).fetchone()


def latest_sample_level(conn, tenant_id, run_id):
    r = conn.execute(
        "SELECT level FROM g1r_sample WHERE tenant_id=? AND run_id=? ORDER BY id DESC LIMIT 1",
        (tenant_id, run_id),
    ).fetchone()
    return (r["level"] if r and r["level"] is not None else 0)


def _end_run(conn, tenant_id, run_id):
    conn.execute("UPDATE g1r_run SET ended_at=? WHERE tenant_id=? AND id=?",
                 (_now_iso(), tenant_id, run_id))
    conn.commit()


def assign_run(conn, tenant_id, save_key, snapshot, *, force_new=False, label=None):
    if force_new:
        return _insert_run(conn, tenant_id, save_key, "manual", label)
    active = _active_run(conn, tenant_id)
    if active is None:
        return _insert_run(conn, tenant_id, save_key, "save" if save_key else "heuristic", label)
    if save_key:
        if active["save_key"] == save_key:
            return active["id"]
        _end_run(conn, tenant_id, active["id"])
        return _insert_run(conn, tenant_id, save_key, "save", label)
    # save_key None → Heuristik über Stat-Reset
    lvl = snapshot.get("level") or 0
    xp = snapshot.get("xp") or 0
    prev_lvl = latest_sample_level(conn, tenant_id, active["id"])
    if lvl <= 2 and xp <= 200 and prev_lvl >= 5:
        _end_run(conn, tenant_id, active["id"])
        return _insert_run(conn, tenant_id, None, "heuristic", label)
    return active["id"]
```

- [ ] **Step 4: Run → pass**

Run: `pytest tests/g1r/test_db.py -v` → PASS (alle)

- [ ] **Step 5: Commit**

```bash
git add g1r/db.py tests/g1r/test_db.py
git commit -m "feat(g1r): Run-Zuordnung (save-key/heuristik/manuell, tenant-isoliert)"
```

---

## Task 4: Sample- + Event-Insert + `client_seq`-Dedup

**Files:**
- Modify: `g1r/db.py`
- Modify: `tests/g1r/test_db.py`

**Vertrag:**
- `seq_seen(conn, tenant_id, client_seq) -> bool` (True wenn schon verarbeitet).
- `mark_seq(conn, tenant_id, client_seq)`.
- `insert_sample(conn, tenant_id, run_id, snapshot)` — schreibt eine Sample-Zeile; fehlende Felder → NULL.
- `insert_events(conn, tenant_id, run_id, events)` — `events` = Liste `{kind, value, meta}`; `meta` wird zu JSON-String.

- [ ] **Step 1: Failing tests**

```python
# tests/g1r/test_db.py (ergänzen)
from g1r.db import seq_seen, mark_seq, insert_sample, insert_events


def test_seq_dedup(tmp_db_path):
    conn = _fresh(tmp_db_path)
    assert seq_seen(conn, 1, 5) is False
    mark_seq(conn, 1, 5)
    assert seq_seen(conn, 1, 5) is True
    assert seq_seen(conn, 2, 5) is False  # anderer Tenant


def test_insert_sample_and_events(tmp_db_path):
    conn = _fresh(tmp_db_path)
    rid = assign_run(conn, 1, "S", {"level": 1, "xp": 0})
    insert_sample(conn, 1, rid, {"level": 3, "hp": 120, "guild_key": "guards"})
    insert_events(conn, 1, rid, [
        {"kind": "hit_dealt", "value": 73, "meta": None},
        {"kind": "kill", "value": 1, "meta": {"type": "Wolf"}},
    ])
    s = conn.execute("SELECT level, hp, guild_key FROM g1r_sample WHERE run_id=?", (rid,)).fetchone()
    assert s["level"] == 3 and s["hp"] == 120 and s["guild_key"] == "guards"
    evs = conn.execute("SELECT kind, value, meta FROM g1r_event WHERE run_id=? ORDER BY id", (rid,)).fetchall()
    assert [e["kind"] for e in evs] == ["hit_dealt", "kill"]
    assert '"type": "Wolf"' in evs[1]["meta"]
```

- [ ] **Step 2: Run → fail**

Run: `pytest tests/g1r/test_db.py -k "seq or insert_sample" -v`
Expected: FAIL (ImportError)

- [ ] **Step 3: Implementieren (anhängen)**

```python
_SAMPLE_COLS = ["level", "xp", "hp", "hp_max", "mana", "mana_max", "strength",
                "dexterity", "magic_circle", "learn_pts", "res_fire", "res_ice",
                "res_edge", "res_point", "res_blunt", "distance_m", "steps",
                "guild_key", "strongest_melee", "strongest_melee_dmg",
                "strongest_ranged", "strongest_ranged_dmg", "strongest_spell"]


def seq_seen(conn, tenant_id, client_seq):
    r = conn.execute("SELECT 1 FROM g1r_ingest_seq WHERE tenant_id=? AND client_seq=?",
                     (tenant_id, client_seq)).fetchone()
    return r is not None


def mark_seq(conn, tenant_id, client_seq):
    conn.execute("INSERT INTO g1r_ingest_seq(tenant_id, client_seq) VALUES(?,?)",
                 (tenant_id, client_seq))
    conn.commit()


def insert_sample(conn, tenant_id, run_id, snapshot):
    cols = ["run_id", "tenant_id", "ts"] + _SAMPLE_COLS
    vals = [run_id, tenant_id, _now_iso()] + [snapshot.get(c) for c in _SAMPLE_COLS]
    ph = ",".join(["?"] * len(cols))
    conn.execute(f"INSERT INTO g1r_sample({','.join(cols)}) VALUES({ph})", vals)
    conn.commit()


def insert_events(conn, tenant_id, run_id, events):
    for ev in (events or []):
        meta = ev.get("meta")
        conn.execute(
            "INSERT INTO g1r_event(run_id, tenant_id, ts, kind, value, meta) VALUES(?,?,?,?,?,?)",
            (run_id, tenant_id, _now_iso(), ev.get("kind"), ev.get("value"),
             json.dumps(meta) if meta is not None else None))
    conn.commit()
```

- [ ] **Step 4: Run → pass**

Run: `pytest tests/g1r/test_db.py -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add g1r/db.py tests/g1r/test_db.py
git commit -m "feat(g1r): Sample/Event-Insert + client_seq-Dedup"
```

---

## Task 5: `g1r/db_pg.py` — Postgres-Schema (Prod)

**Files:**
- Create: `g1r/db_pg.py`

Spiegelt `g1r/db.py`-Schema in Postgres-DDL (`SERIAL`/`BIGSERIAL`, `TIMESTAMPTZ` als `TEXT` belassen für Konsistenz mit `?`-DAO, `JSONB` für `meta`). DAO wird NICHT dupliziert — die Funktionen aus `g1r/db.py` laufen via `SqliteCompatConn` auf der pg-Connection.

- [ ] **Step 1: Implementieren**

```python
# g1r/db_pg.py
"""G1R-Schema für Postgres (Prod). DAO kommt aus g1r/db.py (läuft via
core.db_compat.SqliteCompatConn auf pg). Migration als postgres-Superuser,
search_path = obs."""
PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS g1r_run (
    id BIGSERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    save_key TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    label TEXT,
    detection TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS g1r_sample (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL,
    tenant_id INTEGER NOT NULL,
    ts TEXT NOT NULL,
    level INTEGER, xp INTEGER, hp REAL, hp_max REAL, mana REAL, mana_max REAL,
    strength INTEGER, dexterity INTEGER, magic_circle INTEGER, learn_pts INTEGER,
    res_fire INTEGER, res_ice INTEGER, res_edge INTEGER, res_point INTEGER, res_blunt INTEGER,
    distance_m REAL, steps INTEGER, guild_key TEXT,
    strongest_melee TEXT, strongest_melee_dmg INTEGER,
    strongest_ranged TEXT, strongest_ranged_dmg INTEGER,
    strongest_spell TEXT
);
CREATE TABLE IF NOT EXISTS g1r_event (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL,
    tenant_id INTEGER NOT NULL,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    value INTEGER,
    meta JSONB
);
CREATE TABLE IF NOT EXISTS g1r_ingest_seq (
    tenant_id INTEGER NOT NULL,
    client_seq BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, client_seq)
);
CREATE INDEX IF NOT EXISTS ix_g1r_sample_trt ON g1r_sample(tenant_id, run_id, ts);
CREATE INDEX IF NOT EXISTS ix_g1r_event_trt ON g1r_event(tenant_id, run_id, ts);
"""


def init_schema(conn):
    with conn.cursor() as cur:
        cur.execute(PG_SCHEMA)
    conn.commit()
```

- [ ] **Step 2: Syntax-Check**

Run: `python3 -c "import ast; ast.parse(open('g1r/db_pg.py').read()); print('ok')"` → `ok`

- [ ] **Step 3: Commit**

```bash
git add g1r/db_pg.py
git commit -m "feat(g1r): Postgres-Schema (Prod-Migration)"
```

---

## Task 6: `g1r/endpoints.py` — Ingest + Run-Override

**Files:**
- Create: `g1r/endpoints.py`
- Create: `tests/g1r/test_endpoints.py`

**Vertrag:** `G1rEndpointRegistry(get_conn, tenant_id).dispatch(method, path, body, headers) -> (bytes, int, ctype)`.
- `POST /api/g1r/ingest` Body `{ "client_seq": int, "save_key": str|null, "snapshot": {...}, "events": [...] }`:
  Dedup via `seq_seen` → wenn schon gesehen: `{"ok": true, "dedup": true}`. Sonst `assign_run` → `insert_sample` → `insert_events` → `mark_seq` → `{"ok": true, "run_id": rid}`.
- `POST /api/g1r/run/new` Body `{ "label": str|null }` → `assign_run(..., force_new=True, label=...)`, snapshot leer `{}` → `{"ok": true, "run_id": rid}`.
- Unbekannt → `_err(404, ...)`.

- [ ] **Step 1: Failing tests**

```python
# tests/g1r/test_endpoints.py
import json
from g1r.db import connect, init_schema
from g1r.endpoints import G1rEndpointRegistry


def _reg(tmp_db_path):
    conn = connect(tmp_db_path); init_schema(conn)
    return G1rEndpointRegistry(get_conn=lambda: conn, tenant_id=1), conn


def test_ingest_creates_run_sample_event(tmp_db_path):
    reg, conn = _reg(tmp_db_path)
    body = json.dumps({"client_seq": 1, "save_key": "S",
                       "snapshot": {"level": 3, "hp": 100},
                       "events": [{"kind": "hit_dealt", "value": 50}]}).encode()
    out, code, _ = reg.dispatch("POST", "/api/g1r/ingest", body, {})
    assert code == 200
    res = json.loads(out)
    assert res["ok"] and res["run_id"]
    assert conn.execute("SELECT COUNT(*) c FROM g1r_event").fetchone()["c"] == 1


def test_ingest_dedup(tmp_db_path):
    reg, conn = _reg(tmp_db_path)
    body = json.dumps({"client_seq": 7, "save_key": "S", "snapshot": {"level": 1},
                       "events": [{"kind": "kill", "value": 1}]}).encode()
    reg.dispatch("POST", "/api/g1r/ingest", body, {})
    out, code, _ = reg.dispatch("POST", "/api/g1r/ingest", body, {})
    assert json.loads(out).get("dedup") is True
    assert conn.execute("SELECT COUNT(*) c FROM g1r_event").fetchone()["c"] == 1


def test_run_new_forces_run(tmp_db_path):
    reg, conn = _reg(tmp_db_path)
    reg.dispatch("POST", "/api/g1r/ingest",
                 json.dumps({"client_seq": 1, "save_key": "S", "snapshot": {"level": 9}, "events": []}).encode(), {})
    out, code, _ = reg.dispatch("POST", "/api/g1r/run/new", json.dumps({"label": "NG+"}).encode(), {})
    assert code == 200 and json.loads(out)["ok"]
    assert conn.execute("SELECT COUNT(*) c FROM g1r_run").fetchone()["c"] == 2
```

- [ ] **Step 2: Run → fail**

Run: `pytest tests/g1r/test_endpoints.py -v`
Expected: FAIL (ModuleNotFoundError g1r.endpoints)

- [ ] **Step 3: Implementieren**

```python
# g1r/endpoints.py
import json
from urllib.parse import urlparse
from core.db_compat import SqliteCompatConn
from g1r.db import assign_run, insert_sample, insert_events, seq_seen, mark_seq


def _ok(payload):
    return json.dumps(payload).encode("utf-8"), 200, "application/json"


def _err(code, msg):
    return json.dumps({"error": msg}).encode("utf-8"), code, "application/json"


class G1rEndpointRegistry:
    def __init__(self, get_conn, tenant_id: int):
        _raw = get_conn
        self.get_conn = lambda: SqliteCompatConn(_raw())
        self.tenant_id = tenant_id

    def dispatch(self, method, path, body, headers):
        route = urlparse(path).path
        if method == "POST" and route == "/api/g1r/ingest":
            return self._ingest(body)
        if method == "POST" and route == "/api/g1r/run/new":
            return self._run_new(body)
        return _err(404, "unknown g1r route")

    def _ingest(self, body):
        try:
            d = json.loads(body or b"{}")
        except ValueError:
            return _err(400, "invalid json")
        seq = d.get("client_seq")
        conn = self.get_conn()
        try:
            if seq is not None and seq_seen(conn, self.tenant_id, seq):
                return _ok({"ok": True, "dedup": True})
            snap = d.get("snapshot") or {}
            rid = assign_run(conn, self.tenant_id, d.get("save_key"), snap)
            insert_sample(conn, self.tenant_id, rid, snap)
            insert_events(conn, self.tenant_id, rid, d.get("events") or [])
            if seq is not None:
                mark_seq(conn, self.tenant_id, seq)
            return _ok({"ok": True, "run_id": rid})
        finally:
            conn.close()

    def _run_new(self, body):
        try:
            d = json.loads(body or b"{}")
        except ValueError:
            d = {}
        conn = self.get_conn()
        try:
            rid = assign_run(conn, self.tenant_id, None, {}, force_new=True, label=d.get("label"))
            return _ok({"ok": True, "run_id": rid})
        finally:
            conn.close()
```

Hinweis: In den Tests wird `get_conn=lambda: conn` (nackte sqlite-Conn) übergeben; `SqliteCompatConn` muss eine bereits gewrappte/nackte sqlite-Conn durchreichen — falls `SqliteCompatConn` eine sqlite-Conn doppelt wrappt, im Test stattdessen `get_conn` so übergeben, dass `.close()` ein No-Op ist (Conn soll über mehrere Dispatches leben). Prüfe `core/db_compat.py`; wenn nötig im Test eine kleine Wrapper-Conn mit No-Op-`close()` nutzen.

- [ ] **Step 4: Run → pass**

Run: `pytest tests/g1r/test_endpoints.py -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add g1r/endpoints.py tests/g1r/test_endpoints.py
git commit -m "feat(g1r): Ingest- + Run-Override-Endpoint (Dedup, Run-Zuordnung)"
```

---

## Task 7: Flask-Routing — `g1r`-Branch in `_dispatch`

**Files:**
- Modify: `app/views_api.py`
- Test: `tests/app/test_api_routes.py` (Muster vorhanden) oder `tests/g1r/test_route.py`

- [ ] **Step 1: `_build_g1r_registry` + Dispatch-Branch einbauen**

In `app/views_api.py` neben `_build_pubg_registry`:

```python
def _build_g1r_registry(tenant_id):
    from g1r.endpoints import G1rEndpointRegistry
    return G1rEndpointRegistry(get_conn=lambda: _get_conn(), tenant_id=tenant_id)
```

In `_dispatch` (nach dem `steam`-Zweig, vor dem Credentials-Gate — g1r braucht KEIN Credentials-Gate, nur Tenant-Token) ergänzen:

```python
    if domain == "g1r":
        reg = _build_g1r_registry(tenant_id)
        full_path = "/api/" + "/".join(parts)
        return reg.dispatch(method, full_path, body, dict(request.headers))
```

- [ ] **Step 2: Route-Test**

```python
# tests/g1r/test_route.py
import json
from app import create_app  # vorhandene App-Factory; sonst Muster aus tests/app/test_api_routes.py


def test_g1r_ingest_route(client_for_tenant):  # Fixture-Muster aus tests/app/
    r = client_for_tenant.post("/s/<token>/api/g1r/ingest",
        data=json.dumps({"client_seq": 1, "save_key": "S",
                         "snapshot": {"level": 1}, "events": []}),
        content_type="application/json")
    assert r.status_code == 200 and r.get_json()["ok"]
```

Hinweis: Falls keine fertige App-Test-Fixture existiert, das Routing stattdessen über `_dispatch` direkt testen (Tenant-Token-Auflösung ist bereits durch `g.tenant_id` abgedeckt und in `tests/app/test_api_routes.py` vorgemacht).

- [ ] **Step 3: Run → pass**

Run: `pytest tests/g1r/ tests/app/test_api_routes.py -v` → PASS

- [ ] **Step 4: Commit**

```bash
git add app/views_api.py tests/g1r/test_route.py
git commit -m "feat(g1r): /api/g1r/* Routing (Tenant-Token), kein Credentials-Gate"
```

---

## Task 8: Proxy `server.py` — Forwarder (batch / retry / offline-puffer)

**Files:**
- Modify: `g1r-local/server.py`
- Create: `g1r-local/test_forwarder.py`

**Vertrag:** Eine Klasse `Forwarder(prod_url, token)` mit:
- `enqueue(snapshot, events)` → hängt ein Paket mit monoton steigendem `client_seq` an einen In-Memory-Puffer (Deque, max. N, ältestes fällt raus).
- `flush_once(post_fn)` → schickt das älteste Paket via `post_fn(url, headers, body)->status`; bei 200 aus dem Puffer entfernen, sonst drin lassen (Retry beim nächsten Mal). `post_fn` injizierbar für Tests.
- Ein Thread ruft `flush_once` periodisch (z.B. alle 2 s) mit echtem `urllib.request`-POST.

Die `?lang`/State-Logik bleibt; der Forwarder liest dieselbe State-Datei (oder bekommt die Snapshots aus dem bestehenden Lese-Pfad) und schickt sie an Prod. Token aus `.secrets` (`G1R Ingest Token:` bzw. vorhandener Tenant-Token).

- [ ] **Step 1: Failing test**

```python
# g1r-local/test_forwarder.py
import importlib.util as u, os
spec = u.spec_from_file_location("srv", os.path.join(os.path.dirname(__file__), "server.py"))
srv = u.module_from_spec(spec); spec.loader.exec_module(srv)


def test_forwarder_buffers_and_retries():
    fw = srv.Forwarder("http://x/api/g1r/ingest", "tok")
    fw.enqueue({"level": 1}, [{"kind": "kill", "value": 1}])
    fw.enqueue({"level": 2}, [])
    calls = []
    def fail(url, headers, body): calls.append(body); return 500
    fw.flush_once(fail)            # 500 → bleibt im Puffer
    assert len(fw.buffer) == 2
    sent = []
    def ok(url, headers, body): sent.append(body); return 200
    fw.flush_once(ok); fw.flush_once(ok)
    assert len(fw.buffer) == 0     # beide raus
    # monoton steigende client_seq
    import json
    seqs = [json.loads(b)["client_seq"] for b in sent]
    assert seqs == sorted(seqs) and len(set(seqs)) == 2
```

- [ ] **Step 2: Run → fail**

Run: `cd g1r-local && python3 -m pytest test_forwarder.py -v`
Expected: FAIL (`AttributeError: module 'srv' has no attribute 'Forwarder'`)

- [ ] **Step 3: Implementieren (in `g1r-local/server.py`)**

```python
import collections

class Forwarder:
    """Puffert Ingest-Pakete und schickt sie an Prod; übersteht Offline-Phasen."""
    def __init__(self, prod_url, token, maxlen=500):
        self.prod_url = prod_url
        self.token = token
        self.buffer = collections.deque(maxlen=maxlen)
        self._seq = 0

    def enqueue(self, snapshot, events, save_key=None):
        self._seq += 1
        self.buffer.append(json.dumps({
            "client_seq": self._seq, "save_key": save_key,
            "snapshot": snapshot, "events": events or [],
        }).encode("utf-8"))

    def flush_once(self, post_fn):
        if not self.buffer:
            return
        body = self.buffer[0]
        headers = {"Content-Type": "application/json", "X-Tenant-Token": self.token}
        try:
            status = post_fn(self.prod_url, headers, body)
        except Exception:
            return  # Netz weg → beim nächsten Mal erneut
        if status == 200:
            self.buffer.popleft()
```

Plus eine `_real_post(url, headers, body)`-Funktion mit `urllib.request` und ein Thread, der `flush_once(_real_post)` alle 2 s aufruft (analog zum bestehenden SSE/serve-Setup). `prod_url`/`token` aus Env/`.secrets`.

- [ ] **Step 4: Run → pass**

Run: `cd g1r-local && python3 -m pytest test_forwarder.py -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add g1r-local/server.py g1r-local/test_forwarder.py
git commit -m "feat(g1r-proxy): Forwarder mit Offline-Puffer + Retry (client_seq)"
```

---

## Task 9: Mod `main.lua` — `saveKey` + `events`-Liste in die JSON

**Files:**
- Modify: `g1r-local/G1RExport/scripts/main.lua`

**Vertrag:** `g1r-state.json` enthält künftig `"saveKey": <string|null>` (aus dem Spike-Ergebnis, Task 1) und `"events": [ {kind,value,meta}, … ]` — die seit dem letzten Schreiben gepufferten Treffer/Kills. Die bestehende Lua-Akkumulation (`sess`/`totals`/`records`) darf bleiben (Abwärtskompatibilität der alten Widgets), aber die Events werden zusätzlich roh ausgegeben.

- [ ] **Step 1: Event-Puffer einführen**

Modul-Variable `local pendingEvents = {}`. Im Damage-Hook (statt nur `sessDamageDealt += num`): zusätzlich `pendingEvents[#pendingEvents+1] = {kind="hit_dealt", value=math.floor(num+0.5)}`. Im HP-Delta (Schaden erhalten, außerhalb Warmup): `pendingEvents[#pendingEvents+1] = {kind="hit_taken", value=math.floor(-d+0.5)}`. Im Kill-Reader: `{kind="kill", value=1, meta={type=<typ>}}`.

- [ ] **Step 2: `saveKey` + `events` in `buildJson` schreiben**

Den im Spike (Task 1) bestätigten Kandidaten als `saveKey` lesen (sonst `null`). In `buildJson` zwei `parts[#parts+1]`-Zeilen ergänzen: `"saveKey":<jsonEsc|null>` und `"events":[…]` (Events als JSON-Array serialisieren, dann `pendingEvents = {}` leeren — nur nach erfolgreichem Schreiben).

- [ ] **Step 3: lupa-Compile-Check**

Run: (Harness wie Task 1, Step 2) → Expected `OK`

- [ ] **Step 4: Commit + In-Game-Verifikation**

```bash
git add g1r-local/G1RExport/scripts/main.lua
git commit -m "feat(g1r-mod): saveKey + rohe events-Liste in g1r-state.json"
```
User kopiert Mod, prüft per `http://localhost:9210/state`, dass `saveKey` + `events` erscheinen.

---

## Task 10: Prod-Migration + Deploy

**Files:** keine Code-Änderung — Ausführung.

- [ ] **Step 1: Schema auf Prod anlegen** (als postgres-Superuser, `obs.`-Schema; vgl. `reference_prod_db_migrations`)

```bash
ssh -i ~/.ssh/obskit root@31.70.95.217 'cd /opt/obs-stream-kit && git pull --ff-only && \
  sudo -u postgres psql -d obs -c "SET search_path=obs;" -f - <<SQL
$(python3 -c "from g1r.db_pg import PG_SCHEMA; print(PG_SCHEMA)")
SQL'
```
(Praktisch: `PG_SCHEMA` lokal ausgeben, auf Prod via `sudo -u postgres psql -d obs -v ON_ERROR_STOP=1` einspielen, `SET search_path=obs;` voranstellen.)

- [ ] **Step 2: Services neu starten + Smoke**

```bash
ssh -i ~/.ssh/obskit root@31.70.95.217 'systemctl restart obs-api obs-overlays obs-stream-kit && sleep 2 && systemctl is-active obs-api obs-overlays obs-stream-kit'
```
Smoke: vom Spiel-PC einen Test-Ingest posten und per `sudo -u postgres psql -d obs -c "SELECT * FROM obs.g1r_run;"` prüfen, dass eine Run-Zeile mit korrektem `tenant_id` steht.

- [ ] **Step 3: Cross-Tenant-Verifikation** (`feedback_verify_own_work`)

Mit dem zweiten Tenant (Hat3) einen Ingest posten → eigene `run_id`, keine Vermischung mit Tenant 1.

---

## Self-Review-Notiz (Plan ↔ Spec)
- Spec §Mod → Tasks 1, 9. §Schema → Tasks 2, 5. §Ingest+Run-Zuordnung → Tasks 3, 6. §Dedup → Tasks 4, 6. §Auth/Routing → Task 7. §Proxy → Task 8. §Tests → in jeder Task. §Migration → Task 10. §Cross-Tenant → Tasks 3, 10.
- Offene Abhängigkeit: Task 9 `saveKey`-Quelle hängt am Spike-Ergebnis (Task 1) — bis dahin `null` (Heuristik trägt). Kein Blocker für Tasks 2–8.
- `SqliteCompatConn`-Verhalten in Task 6 verifizieren (Doppel-Wrap / `close()`), ggf. Test-Conn mit No-Op-`close()`.
