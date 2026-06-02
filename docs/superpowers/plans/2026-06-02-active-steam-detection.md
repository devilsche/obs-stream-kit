# `/api/pubg/active` Steam-Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den lokalen Taskmanager-Check in `/api/pubg/active` durch eine Steam-API-Detection ersetzen — `active = pubgOpen (Steam gameid==578080) AND matchRecent (DB, <30min)`, mit Kurzschluss und graceful Fallback.

**Architecture:** Der `_active`-Handler in `pubg/endpoints.py` bekommt das „PUBG-läuft"-Signal über eine injizierte `steam_summary_fn` (Dependency Injection → unit-testbar ohne echten Steam-Call). `app/views_api._build_pubg_registry` baut diese Funktion aus den Steam-Creds des Tenants und cached sie ~8 s gegen das sekündliche Streamer.bot-Polling. Der alte lokale Prozess-Check (`_is_pubg_running` + `tasklist`/`pgrep`) entfällt.

**Tech Stack:** Python 3 / Flask, psycopg + sqlite-Compat (Tests), pytest, vorhandener `steam.api_client.SteamClient`.

---

## File Structure

- `pubg/endpoints.py` — `_active` neu, `EndpointRegistry.__init__` bekommt `steam_summary_fn=None`, `PUBG_STEAM_APPID`-Konstante; toter Prozess-Code + ungenutzte Imports raus.
- `app/views_api.py` — `_build_pubg_registry` injiziert die gecachte `steam_summary_fn`; neuer Modul-Cache `_tenant_steam_summary`.
- `tests/pubg/test_active.py` — neue Unit-Tests für die `_active`-Logik (injizierte Fake-Steam-Fn, sqlite-DB).
- `tests/app/test_steam_presence_cache.py` — Test für den Cache-Wrapper.

---

## Task 1: `_active` auf Steam-Detection umbauen (Kernlogik, unit-getestet)

**Files:**
- Modify: `pubg/endpoints.py` (Imports 1–43, `EndpointRegistry.__init__` ~76–89, `_active` ~213–262)
- Test: `tests/pubg/test_active.py`

- [ ] **Step 1: Failing-Tests schreiben**

Neue Datei `tests/pubg/test_active.py`:

```python
import datetime
import json
from unittest.mock import MagicMock
from pubg.db import connect, init_schema, upsert_player, insert_match
from pubg.cache import TTLCache
from pubg.endpoints import EndpointRegistry

PUBG = 578080


def _iso(minutes_ago):
    dt = (datetime.datetime.now(datetime.timezone.utc)
          - datetime.timedelta(minutes=minutes_ago))
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _setup(tmp_db_path):
    conn = connect(tmp_db_path)
    init_schema(conn)
    upsert_player(conn, "account.A", "PEX_LuCKoR", "steam", True)
    return conn


def _add_match(conn, match_id, minutes_ago):
    insert_match(conn, match_id, "Erangel", "squad", 0, 1800,
                 _iso(minutes_ago), None)
    conn.commit()


def _registry(conn, steam_summary_fn=None):
    return EndpointRegistry(
        get_conn=lambda: conn,
        my_account_id="account.A",
        platform="steam",
        cache=TTLCache(ttl_secs=30),
        client=MagicMock(),
        poller_status=lambda: {"polling": "ok"},
        tenant_id=1,
        steam_summary_fn=steam_summary_fn,
    )


def _call(reg, query=""):
    path = "/api/pubg/active" + (("?" + query) if query else "")
    body, code, _ = reg.dispatch("GET", path, b"", {})
    assert code == 200
    return json.loads(body)


def test_pubg_open_and_recent_match_is_active(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)
    reg = _registry(conn, steam_summary_fn=lambda: {"gameid": str(PUBG)})
    out = _call(reg)
    assert out["active"] is True
    assert out["pubgOpen"] is True
    assert out["matchRecent"] is True
    assert out["steamChecked"] is True


def test_pubg_open_but_no_recent_match_inactive(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m_old", 120)
    reg = _registry(conn, steam_summary_fn=lambda: {"gameid": str(PUBG)})
    out = _call(reg)
    assert out["active"] is False
    assert out["pubgOpen"] is True
    assert out["matchRecent"] is False


def test_pubg_closed_is_inactive_and_short_circuits_db(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)  # frischer Match, aber PUBG zu
    reg = _registry(conn, steam_summary_fn=lambda: {"gameid": "730"})  # CS, nicht PUBG
    out = _call(reg)
    assert out["active"] is False
    assert out["pubgOpen"] is False
    assert out["matchRecent"] is False        # nicht evaluiert -> false
    assert out["lastMatchAt"] is None         # Kurzschluss: kein DB-Query


def test_steam_unavailable_falls_back_to_match_recent(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)

    def boom():
        raise RuntimeError("steam down")

    reg = _registry(conn, steam_summary_fn=boom)
    out = _call(reg)
    assert out["active"] is True              # Fallback: active = matchRecent
    assert out["pubgOpen"] is None
    assert out["matchRecent"] is True
    assert out["steamChecked"] is False


def test_no_steam_fn_falls_back_to_match_recent(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)
    reg = _registry(conn, steam_summary_fn=None)
    out = _call(reg)
    assert out["active"] is True
    assert out["pubgOpen"] is None
    assert out["steamChecked"] is False


def test_no_steam_query_override_skips_steam(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)
    called = {"n": 0}

    def fn():
        called["n"] += 1
        return {"gameid": "730"}

    reg = _registry(conn, steam_summary_fn=fn)
    out = _call(reg, "noSteam=1")
    assert called["n"] == 0                    # Steam nicht abgefragt
    assert out["active"] is True               # nur matchRecent
    assert out["pubgOpen"] is None


def test_fake_pubg_open_override(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 5)
    # fakePubgOpen=1 -> pubgOpen true ohne Steam-Call
    out = _call(_registry(conn, steam_summary_fn=None), "fakePubgOpen=1")
    assert out["pubgOpen"] is True and out["active"] is True
    # fakePubgOpen=0 -> pubgOpen false -> kurzschluss
    out = _call(_registry(conn, steam_summary_fn=None), "fakePubgOpen=0")
    assert out["pubgOpen"] is False and out["active"] is False


def test_threshold_override(tmp_db_path):
    conn = _setup(tmp_db_path)
    _add_match(conn, "m1", 20)  # 20 min alt
    reg = _registry(conn, steam_summary_fn=lambda: {"gameid": str(PUBG)})
    assert _call(reg, "thresholdMin=30")["matchRecent"] is True
    assert _call(reg, "thresholdMin=10")["matchRecent"] is False
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `python3 -m pytest tests/pubg/test_active.py -v`
Expected: FAIL — `EndpointRegistry.__init__` kennt `steam_summary_fn` nicht (TypeError) bzw. die neuen Response-Felder fehlen.

- [ ] **Step 3: `EndpointRegistry.__init__` um `steam_summary_fn` erweitern**

In `pubg/endpoints.py`, Signatur + Body von `__init__` (aktuell ~76–89):

```python
class EndpointRegistry:
    def __init__(self, get_conn, my_account_id, platform, cache,
                 client, poller_status, tenant_id: int,
                 steam_summary_fn=None):
        _raw_get_conn = get_conn
        self.get_conn = lambda: SqliteCompatConn(_raw_get_conn())
        self.my_account_id = my_account_id
        self.platform = platform
        self.cache = cache
        self.client = client
        self.poller_status = poller_status
        self.tenant_id = tenant_id
        # Callable -> Steam-Player-Summary-dict (gameid uvm.) oder wirft.
        # None = keine Steam-Quelle -> _active fällt auf matchRecent zurück.
        self.steam_summary_fn = steam_summary_fn
        self._replay_cache = {}
```

- [ ] **Step 4: `PUBG_STEAM_APPID`-Konstante + `_active` neu schreiben**

Ersetze die alte `_active`-Methode (~213–262) vollständig. Füge die Konstante oben bei den anderen Modul-Konstanten ein (dort wo vorher `_PUBG_PROCESS_NAME` stand):

```python
PUBG_STEAM_APPID = 578080
```

Neue Methode:

```python
    def _active(self, qs):
        """active = pubgOpen (Steam) AND matchRecent (DB, < thresholdMin).

        - PUBG offen (Steam gameid == 578080) -> active = matchRecent.
        - PUBG zu                              -> active = false (kein DB-Query).
        - Steam unbestimmbar (keine fn / Fehler / noSteam) -> Fallback:
          active = matchRecent.

        Overrides: ?thresholdMin / ?thresholdSec / ?noSteam=1 / ?fakePubgOpen=0|1
        """
        threshold_min = float(qs.get("thresholdMin", 30))
        if "thresholdSec" in qs:
            threshold_min = float(qs["thresholdSec"]) / 60.0

        # ── pubgOpen bestimmen: True / False / None(unbestimmbar) ──
        pubg_open = None
        steam_checked = False
        if "fakePubgOpen" in qs:
            pubg_open = qs.get("fakePubgOpen") == "1"
            steam_checked = True
        elif qs.get("noSteam") != "1" and self.steam_summary_fn is not None:
            try:
                summary = self.steam_summary_fn() or {}
                gid_raw = summary.get("gameid")
                gid = int(gid_raw) if gid_raw else 0
                pubg_open = (gid == PUBG_STEAM_APPID)
                steam_checked = True
            except Exception:
                pubg_open = None
                steam_checked = False

        # ── matchRecent nur wenn nicht kurzgeschlossen (PUBG sicher zu) ──
        match_recent = False
        last_iso = None
        age_min = None
        if pubg_open is not False:
            conn = self.get_conn()
            row = conn.execute(
                "SELECT MAX(played_at) AS last FROM matches WHERE tenant_id = ?",
                (self.tenant_id,)
            ).fetchone()
            last_iso = row["last"] if row else None
            if last_iso:
                try:
                    last_dt = datetime.datetime.fromisoformat(
                        last_iso.replace("Z", "+00:00"))
                    now = datetime.datetime.now(datetime.timezone.utc)
                    age_min = round((now - last_dt).total_seconds() / 60.0, 1)
                    match_recent = age_min < threshold_min
                except Exception:
                    pass

        # ── active-Entscheidung ──
        # pubg_open True  -> active = matchRecent
        # pubg_open None  -> Fallback: active = matchRecent
        # pubg_open False -> active = false (kurzgeschlossen)
        active = match_recent if pubg_open is not False else False

        return _ok({
            "active": active,
            "pubgOpen": pubg_open,
            "matchRecent": match_recent,
            "lastMatchAt": last_iso,
            "lastMatchAgeMin": age_min,
            "thresholdMin": threshold_min,
            "steamChecked": steam_checked,
        })
```

- [ ] **Step 5: Toten Prozess-Code + ungenutzte Imports entfernen**

In `pubg/endpoints.py`:
- Lösche die komplette Funktion `_is_pubg_running()` samt Kommentarblock und die Konstanten `_PUBG_PROCESS_NAME`, `_proc_cache`, `_PROC_CACHE_TTL_S` (Zeilen ~10–43).
- Entferne die Imports `import subprocess`, `import sys`, `import time` aus dem Dateikopf. Diese drei werden ausschließlich vom gelöschten Prozess-Check genutzt (verifiziert: `subprocess`/`sys` nur dort; `time.` nur in der gelöschten `_is_pubg_running`).
- Verifiziere nach dem Löschen mit `grep -n "subprocess\|sys\.\|time\.\|_is_pubg_running\|_proc_cache" pubg/endpoints.py` → keine Treffer.

- [ ] **Step 6: Tests grün**

Run: `python3 -m pytest tests/pubg/test_active.py -v`
Expected: PASS (alle 8 Tests).

- [ ] **Step 7: Import-Check + volle Suite**

Run: `python3 -c "import pubg.endpoints"` → kein ImportError (beweist, dass keine entfernten Imports mehr referenziert werden).
Run: `python3 -m pytest tests/pubg/test_endpoints.py -q` → unverändert grün (Registry-Konstruktion ohne `steam_summary_fn` funktioniert weiter dank Default `None`).
Run: `python3 -m pytest -q` → keine neuen Failures gegenüber Baseline.

- [ ] **Step 8: Commit**

```bash
git add pubg/endpoints.py tests/pubg/test_active.py
git commit -m "feat(pubg): /api/pubg/active via Steam-Detection statt Taskmanager"
```

---

## Task 2: Steam-Signal in `_build_pubg_registry` verdrahten (+ Cache)

**Files:**
- Modify: `app/views_api.py` (`_build_pubg_registry` ~70–108, neuer Modul-Cache)
- Test: `tests/app/test_steam_presence_cache.py`

- [ ] **Step 1: Failing-Test für den Cache-Wrapper**

Neue Datei `tests/app/test_steam_presence_cache.py`:

```python
from app.views_api import _tenant_steam_summary, _steam_presence_cache


class _FakeSteam:
    def __init__(self):
        self.calls = 0

    def get_player_summaries(self):
        self.calls += 1
        return {"gameid": "578080", "personaname": "x"}


def test_cache_collapses_rapid_calls():
    _steam_presence_cache.clear()
    steam = _FakeSteam()
    a = _tenant_steam_summary(42, steam)
    b = _tenant_steam_summary(42, steam)
    assert a == b == {"gameid": "578080", "personaname": "x"}
    assert steam.calls == 1                 # zweiter Call aus Cache


def test_cache_is_per_tenant():
    _steam_presence_cache.clear()
    s1, s2 = _FakeSteam(), _FakeSteam()
    _tenant_steam_summary(1, s1)
    _tenant_steam_summary(2, s2)
    assert s1.calls == 1 and s2.calls == 1   # getrennte Tenants -> getrennt
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `python3 -m pytest tests/app/test_steam_presence_cache.py -v`
Expected: FAIL — `_tenant_steam_summary` / `_steam_presence_cache` existieren nicht (ImportError).

- [ ] **Step 3: Cache-Wrapper in `app/views_api.py` ergänzen**

Oben bei den Modul-Globals (z.B. nach den `_SHARED_*_CACHE`-Definitionen) einfügen:

```python
import time as _time

# Kurzlebiger per-Tenant-Cache fuer das Steam-Presence-Summary (gameid),
# damit das sekuendliche Streamer.bot-Polling von /api/pubg/active nicht
# jeden Tick einen Steam-API-Call ausloest. ~8s analog zum alten Prozess-Cache.
_STEAM_PRESENCE_TTL_S = 8.0
_steam_presence_cache = {}  # tenant_id -> (monotonic_ts, summary_dict)


def _tenant_steam_summary(tenant_id, steam_client):
    """Cached get_player_summaries(). Wirft die SteamApiError/Exception des
    Clients weiter (der Aufrufer in _active faengt sie -> Fallback)."""
    now = _time.monotonic()
    hit = _steam_presence_cache.get(tenant_id)
    if hit and now - hit[0] < _STEAM_PRESENCE_TTL_S:
        return hit[1]
    summary = steam_client.get_player_summaries()
    _steam_presence_cache[tenant_id] = (now, summary)
    return summary
```

Hinweis: Bei einer Exception aus `get_player_summaries()` wird **nichts** gecacht (die Zuweisung wird nicht erreicht) und die Exception propagiert — `_active` behandelt das als „unbestimmbar" → Fallback.

- [ ] **Step 4: Cache-Test grün**

Run: `python3 -m pytest tests/app/test_steam_presence_cache.py -v`
Expected: PASS.

- [ ] **Step 5: `_build_pubg_registry` injiziert `steam_summary_fn`**

In `app/views_api.py`, in `_build_pubg_registry`: `creds` wird dort bereits via `core_creds.get(conn, tenant_id)` geladen und enthält `steam_id` + `steam_api_key`. Ergänze nach dem Bau des PUBG-`client` (vor dem `return EndpointRegistry(...)`):

```python
    steam_summary_fn = None
    if creds.steam_api_key and creds.steam_id:
        from steam.api_client import SteamClient
        _steam_client = SteamClient(api_key=creds.steam_api_key,
                                    steam_id=creds.steam_id)
        steam_summary_fn = lambda: _tenant_steam_summary(tenant_id, _steam_client)
```

Und ergänze im `return EndpointRegistry(...)`-Aufruf das Keyword-Argument:

```python
        steam_summary_fn=steam_summary_fn,
```

(Alle anderen Argumente des `return EndpointRegistry(...)` bleiben unverändert.)

- [ ] **Step 6: Bestehende API-Route-Tests + volle Suite grün**

Run: `python3 -m pytest tests/app/test_api_routes.py tests/app/test_steam_presence_cache.py tests/pubg/test_active.py -q`
Expected: PASS.
Run: `python3 -m pytest -q`
Expected: keine neuen Failures gegenüber Baseline (nur die vorbestehenden DB-Failures in `tests/pubg/`).

- [ ] **Step 7: Commit**

```bash
git add app/views_api.py tests/app/test_steam_presence_cache.py
git commit -m "feat(api): _build_pubg_registry injiziert gecachtes Steam-Presence-Signal"
```

---

## Self-Review

**Spec-Coverage:**
- Steam-Detection statt Taskmanager → Task 1 (`_active` + `steam_summary_fn`), Task 2 (Wiring) ✓
- `active = pubgOpen AND matchRecent`, Kurzschluss bei PUBG-zu → Task 1 Step 4 + Test `test_pubg_closed_..._short_circuits_db` ✓
- Fallback bei Steam-unbestimmbar → Task 1 Tests `test_steam_unavailable...`, `test_no_steam_fn...` ✓
- Response-Felder `active`/`matchRecent` bleiben, `processRunning`→`pubgOpen`, `steamChecked` neu → Task 1 Step 4 ✓
- Overrides `thresholdMin`/`thresholdSec`/`noSteam`/`fakePubgOpen` → Task 1 Tests ✓
- AppID 578080 als Konstante → `PUBG_STEAM_APPID` ✓
- ~8s-Cache gegen Polling → Task 2 (`_tenant_steam_summary`) ✓
- Multi-Tenant (per-Tenant Steam-Creds + Cache-Key) → Task 2 `test_cache_is_per_tenant` ✓
- Alt-Code (`_is_pubg_running`, `subprocess`/`sys`/`time`) entfernt → Task 1 Step 5 ✓
- Robustheit (kein 5xx bei Steam-Fehler) → `_active` fängt Exception → Fallback ✓

**Platzhalter:** keine.

**Typ-/Namens-Konsistenz:** `steam_summary_fn` (Konstruktor-kwarg + Attribut + Injection), `_tenant_steam_summary`, `_steam_presence_cache`, `PUBG_STEAM_APPID`, Response-Keys (`active`, `pubgOpen`, `matchRecent`, `lastMatchAt`, `lastMatchAgeMin`, `thresholdMin`, `steamChecked`) durchgängig identisch in Task 1, Task 2 und Tests.

**Offener Verifikationspunkt für den Implementer:**
- Falls `insert_match` in `pubg/db.py` eine andere Argument-Reihenfolge/Signatur hat als `(conn, match_id, map_name, game_mode, is_ranked, duration_secs, played_at, telemetry_url)`, die Test-Helper `_add_match` entsprechend anpassen (Signatur vor dem Schreiben des Tests gegenchecken).
