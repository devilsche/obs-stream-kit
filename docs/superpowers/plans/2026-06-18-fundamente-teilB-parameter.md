# Fundamente Teil B — Parameter-Modell · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pro Source eine deklarative Parameter-Definition als JSON-Insel im Widget-HTML, die Widget (Defaults/URL) UND Server/Detailseite gemeinsam lesen — ein Schema, kein Regex-über-JS.

**Architecture:** `<script type="application/json" id="params">[…]</script>` im Widget. Frontend-Helfer `widgets/_params.js` liest die Insel (Defaults, URL-Bau). Server (`app/widget_catalog.build`) liest dieselbe Insel als **bevorzugte** Quelle der `switches`-Liste, Fallback auf das bestehende `buildFilter`-Parsing — damit nicht-migrierte Sources (PUBG) unverändert weiterlaufen. Die Detailseite (`urls.html`, `data-switches`) rendert unverändert aus der Liste.

**Tech Stack:** Vanilla JS (kein Build), Python/`re`/`json`, pytest, node für JS-Funktionstest.

**Spec:** `docs/superpowers/specs/2026-06-18-dashboard-fundamente-components-parameters.md` (Teil B).

**Schema-Shape (identisch zu `_extract_schema_from_html`):** Liste von `{key, label, type, group?, default, options?, min?, max?, step?, help?}`, `type ∈ text|select|number|bool|color`, `options` = Liste von `["wert","Label"]`.

**Konventionen (vorher ansehen):** `app/widget_catalog.py:485-511` (`build()` — `_extract_schema_from_html` → `_normalize_switches`), `app/templates/urls.html:6-16` (`src_card`-Macro rendert `data-switches`). PUBG-Voll-Migration ist NICHT Teil dieses Plans.

---

## Task 1: `widgets/_params.js` (Frontend-Helfer) + Node-Test

**Files:**
- Create: `widgets/_params.js`
- Create: `widgets/_params.test.js`

- [ ] **Step 1: Failing test**
```js
// widgets/_params.test.js
require('./_params.js');               // IIFE hängt Params an globalThis
const { values, buildUrl } = globalThis.Params;
const schema = [{key:'port',default:'9210'}, {key:'scope',default:'session'}];
let v = values(schema, '?scope=all');
if (!(v.port === '9210' && v.scope === 'all')) throw new Error('values defaults/override falsch: ' + JSON.stringify(v));
let u = buildUrl('http://x', schema, {port:'9210', scope:'all'});   // port==default → weglassen
if (u !== 'http://x?scope=all') throw new Error('buildUrl: ' + u);
let u2 = buildUrl('http://x', schema, {port:'9210', scope:'session'}); // alles default → nackte base
if (u2 !== 'http://x') throw new Error('buildUrl nackt: ' + u2);
console.log('ok');
```

- [ ] **Step 2: Test läuft → fail**

Run: `cd /home/ruschinski/git/obs-stream-kit && node widgets/_params.test.js`
Expected: FAIL (`Cannot find module` bzw. `Params` undefined)

- [ ] **Step 3: Implementieren**
```js
// widgets/_params.js — gemeinsamer Parameter-Helfer (Widget + Detailseite).
(function (global) {
  // Liest die JSON-Insel <script type="application/json" id="params"> → Schema-Liste.
  function readParams(id) {
    if (typeof document === 'undefined') return [];
    var el = document.getElementById(id || 'params');
    if (!el) return [];
    try { var d = JSON.parse(el.textContent); return Array.isArray(d) ? d : []; }
    catch (_) { return []; }
  }
  // Merged Werte: URL-Parameter überschreiben Defaults aus dem Schema.
  function values(schema, search) {
    var q = new URLSearchParams(search != null ? search :
      (typeof location !== 'undefined' ? location.search : ''));
    var out = {};
    (schema || []).forEach(function (p) {
      var v = q.get(p.key);
      out[p.key] = (v === null || v === '') ? p.default : v;
    });
    return out;
  }
  // Baut eine saubere URL: nur Parameter, die vom Default abweichen.
  function buildUrl(base, schema, vals) {
    var q = new URLSearchParams();
    (schema || []).forEach(function (p) {
      var v = vals[p.key];
      if (v !== undefined && v !== null && String(v) !== '' && String(v) !== String(p.default))
        q.set(p.key, v);
    });
    var s = q.toString();
    return s ? base + '?' + s : base;
  }
  global.Params = { readParams: readParams, values: values, buildUrl: buildUrl };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Test läuft → pass**

Run: `cd /home/ruschinski/git/obs-stream-kit && node widgets/_params.test.js`
Expected: `ok`

- [ ] **Step 5: Commit**
```bash
git add widgets/_params.js widgets/_params.test.js
git commit -m "feat(params): _params.js — JSON-Insel lesen, Defaults mergen, URL bauen"
```

---

## Task 2: Server-Insel-Reader in `widget_catalog.build()` (+ Fallback)

**Files:**
- Modify: `app/widget_catalog.py`
- Create: `tests/app/test_params_island.py`

- [ ] **Step 1: Failing test**
```python
# tests/app/test_params_island.py
from app.widget_catalog import _extract_params_island


def test_island_parsed_as_schema():
    html = '''<html><body>
    <script type="application/json" id="params">
    [{"key":"port","label":"Port","type":"text","default":"9210"},
     {"key":"scope","label":"Scope","type":"select","default":"all","options":[["session","Session"],["all","All"]]}]
    </script></body></html>'''
    s = _extract_params_island(html)
    assert [p["key"] for p in s] == ["port", "scope"]
    assert s[1]["options"] == [["session", "Session"], ["all", "All"]]


def test_absent_island_returns_empty():
    assert _extract_params_island("<html><body>nix</body></html>") == []


def test_malformed_island_returns_empty():
    assert _extract_params_island('<script type="application/json" id="params">{kaputt</script>') == []
```

- [ ] **Step 2: Test läuft → fail**

Run: `cd /home/ruschinski/git/obs-stream-kit && python3 -m pytest tests/app/test_params_island.py -v`
Expected: FAIL (`ImportError: cannot import name '_extract_params_island'`)

- [ ] **Step 3: Implementieren** — in `app/widget_catalog.py` (`import json` oben sicherstellen) ergänzen:
```python
# JSON-Insel <script type="application/json" id="params"> → Schema-Liste.
# Bevorzugte Parameter-Quelle (Teil B); robust gegen Attribut-Reihenfolge.
_ISLAND_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.DOTALL | re.IGNORECASE)


def _extract_params_island(content: str) -> list:
    for attrs, body in _ISLAND_RE.findall(content or ""):
        low = attrs.lower()
        if ('id="params"' in low or "id='params'" in low) and "application/json" in low:
            try:
                data = json.loads(body.strip())
                return data if isinstance(data, list) else []
            except Exception:
                return []
    return []
```
Und in `build()` die Quelle-Reihenfolge (Zeile ~497) so ändern:
```python
                switches = _extract_params_island(content)        # NEU: Insel bevorzugt
                if not switches:
                    switches = _extract_schema_from_html(content)  # Fallback: buildFilter
                if not switches:
                    switches = list(WIDGET_SWITCHES.get(path, []))
```

- [ ] **Step 4: Test läuft → pass + Katalog baut weiter (Regression)**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && python3 -m pytest tests/app/test_params_island.py -v && \
python3 -c "from app import widget_catalog as w; r=w.build('.'); print('build ok,', len(r), 'sources')"
```
Expected: Tests PASS; `build ok, N sources` (keine Exception — PUBG-Sources weiter über buildFilter-Fallback).

- [ ] **Step 5: Commit**
```bash
git add app/widget_catalog.py tests/app/test_params_island.py
git commit -m "feat(catalog): JSON-Insel als bevorzugte Parameter-Quelle (Fallback buildFilter)"
```

---

## Task 3: G1R Livebar — Insel + `_params.js`

**Files:** Modify `widgets/g1r/livebar.html`

- [ ] **Step 1: Insel + Helfer einbauen, Inline-Default-Logik ersetzen**

Im `<head>` (oder vor dem `<script>`) die Insel + den Helfer ergänzen:
```html
<script type="application/json" id="params">
[ {"key":"port","label":"Proxy-Port","type":"text","group":"Verbindung","default":"9210"},
  {"key":"scope","label":"Scope","type":"select","group":"Anzeige","default":"session",
   "options":[["session","Session"],["all","All"]]},
  {"key":"lang","label":"Sprache","type":"select","group":"Anzeige","default":"en",
   "options":[["en","English"],["de","Deutsch"]]} ]
</script>
<script src="../_params.js"></script>
```
Im Haupt-`<script>` die Zeilen, die `PORT`/`SCOPE` aus `URLSearchParams` mit Inline-Defaults holen, ersetzen durch:
```js
var P = Params.values(Params.readParams());
var PORT = P.port, SCOPE = (P.scope || 'session').toLowerCase(), LANG = P.lang || 'en';
var BASE = 'http://localhost:' + PORT;
```
und die `/events?lang=en` durch `'/events?lang=' + LANG` ersetzen. Restliche Logik unverändert.

- [ ] **Step 2: Check (Insel valide, Helfer geladen)**
```bash
cd /home/ruschinski/git/obs-stream-kit && python3 -c "
from app.widget_catalog import _extract_params_island
h=open('widgets/g1r/livebar.html').read()
s=_extract_params_island(h); assert [p['key'] for p in s]==['port','scope','lang'], s
assert '_params.js' in h and 'Params.values' in h
print('ok: Insel(port,scope,lang) + _params.js genutzt')"
```
Expected: `ok: …`

- [ ] **Step 3: Render-Smoke + Screenshot** (toter Port → Offline, Layout/Defaults greifen)
```bash
# Screenshot-Harness aus Teil-A-Plan: http://127.0.0.1:8124/widgets/g1r/livebar.html?port=1
```
Screenshot ansehen: Leiste rendert wie vorher.

- [ ] **Step 4: Commit**
```bash
git add widgets/g1r/livebar.html
git commit -m "feat(g1r): Livebar Parameter als JSON-Insel + _params.js"
```

---

## Task 4: G1R News-Ticker — Insel + `_params.js`

**Files:** Modify `widgets/g1r/news-ticker.html`

- [ ] **Step 1: Insel + Helfer**

Insel (news-ticker hat port + lang; kein scope):
```html
<script type="application/json" id="params">
[ {"key":"port","label":"Proxy-Port","type":"text","group":"Verbindung","default":"9210"},
  {"key":"lang","label":"Sprache","type":"select","group":"Anzeige","default":"en",
   "options":[["en","English"],["de","Deutsch"]]} ]
</script>
<script src="../_params.js"></script>
```
Im `<script>` `PORT`-Inline-Default ersetzen:
```js
var P = Params.values(Params.readParams());
var PORT = P.port, LANG = P.lang || 'en';
var BASE = 'http://localhost:' + PORT;
```
`/events?lang=en` → `'/events?lang=' + LANG`. Rest unverändert.

- [ ] **Step 2: Check**
```bash
cd /home/ruschinski/git/obs-stream-kit && python3 -c "
from app.widget_catalog import _extract_params_island
h=open('widgets/g1r/news-ticker.html').read()
s=_extract_params_island(h); assert [p['key'] for p in s]==['port','lang'], s
assert '_params.js' in h and 'Params.values' in h
print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Render-Smoke + Screenshot** (`?port=1`) — Ticker rendert wie vorher.

- [ ] **Step 4: Commit**
```bash
git add widgets/g1r/news-ticker.html
git commit -m "feat(g1r): News-Ticker Parameter als JSON-Insel + _params.js"
```

---

## Task 5: G1R Career-Card — Insel + `_params.js`

**Files:** Modify `widgets/g1r/career-card.html`

- [ ] **Step 1: Insel + Helfer**

Insel (port + scope[Default all] + lang):
```html
<script type="application/json" id="params">
[ {"key":"port","label":"Proxy-Port","type":"text","group":"Verbindung","default":"9210"},
  {"key":"scope","label":"Scope","type":"select","group":"Anzeige","default":"all",
   "options":[["session","Session"],["all","All"]]},
  {"key":"lang","label":"Sprache","type":"select","group":"Anzeige","default":"en",
   "options":[["en","English"],["de","Deutsch"]]} ]
</script>
<script src="../_params.js"></script>
```
Im `<script>` die `params`/`PORT`/`SCOPE`-Inline-Logik ersetzen:
```js
var P = Params.values(Params.readParams());
var PORT = P.port, SCOPE = (P.scope || 'all').toLowerCase(), LANG = P.lang || 'en';
var USE_ALL = (SCOPE !== 'session');
var BASE = 'http://localhost:' + PORT;
```
`/events?lang=en` → `'/events?lang=' + LANG`. `SCOPE_TXT`/Render unverändert.
ACHTUNG: die lokale Variable hieß bisher `params` (URLSearchParams) — alle ihre Verwendungen auf `P`/`PORT`/`SCOPE` umstellen, keine verwaiste `params`-Referenz lassen.

- [ ] **Step 2: Check**
```bash
cd /home/ruschinski/git/obs-stream-kit && python3 -c "
from app.widget_catalog import _extract_params_island
h=open('widgets/g1r/career-card.html').read()
s=_extract_params_island(h); assert [p['key'] for p in s]==['port','scope','lang'], s
assert '_params.js' in h and 'Params.values' in h
print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Render-Smoke + Screenshot** (`?port=1&scope=all`) — Card rendert wie vorher (Stats/Chips/Records).

- [ ] **Step 4: Commit**
```bash
git add widgets/g1r/career-card.html
git commit -m "feat(g1r): Career-Card Parameter als JSON-Insel + _params.js"
```

---

## Self-Review-Notiz (Plan ↔ Spec Teil B)
- Spec „`_params.js` (readParams/applyDefaults)" → Task 1 (`values` = applyDefaults-Äquivalent + `buildUrl`). „Server-Insel-Reader + Fallback" → Task 2. „Detailseite rendert uniform" → unverändert (rendert schon aus `switches`; Task 2 speist nur die bevorzugte Quelle ein) — kein eigener Task nötig. „JSON-Inseln in G1R-Widgets + _params.js" → Tasks 3–5. „PUBG-Voll-Migration NICHT" → Fallback in Task 2 erhält PUBG. „pytest Insel-Extraktion + URL-Bau" → Task 2 (pytest) + Task 1 (node URL-Bau).
- Schema-Shape der Inseln = identisch zu `_extract_schema_from_html` → `urls.html` rendert unverändert.
- Methodennamen konsistent: `Params.readParams/values/buildUrl`, `_extract_params_island`.
