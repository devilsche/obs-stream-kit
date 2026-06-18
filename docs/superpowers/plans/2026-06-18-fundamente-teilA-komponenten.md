# Fundamente Teil A — Komponenten-System · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das kanonische `t-*`-Baustein-Set in `widgets/_blocks.css` vervollständigen und die Eigenbau-G1R-Widgets (+ ein Alert als Muster) darauf migrieren, damit Komponenten domain-übergreifend einmal definiert und nur noch wiederverwendet werden.

**Architecture:** Neue token-getriebene `t-*`-Bausteine in `_blocks.css` (NACH `_theme.css` geladen, nutzen `--theme-*`). Eine Component-Preview-Seite unter `/app/tools/component-preview` dient als lebender Katalog + Abnahme. Migration ersetzt lokales Widget-CSS durch die Bausteine.

**Tech Stack:** Vanilla CSS/HTML, Flask-Tool-Registry (`app/views_app.py`), kein JS-Test-Framework → Abnahme per headless-Chrome-Screenshot je Theme.

**Spec:** `docs/superpowers/specs/2026-06-18-dashboard-fundamente-components-parameters.md` (Teil A).

**Konventionen (vorher ansehen):** `widgets/_blocks.css` (Stil der bestehenden `t-*`-Bausteine — descendant-Selektoren, Tokens, `prefers-reduced-motion`), `widgets/_theme.css` (Tokens; `:root` = entry-Default), `tools/theme-preview.html` (Muster für eine theme-schaltbare Tool-Seite), `app/views_app.py:16-44` (Tool-Registry).

**WICHTIG:** Bestehende `t-*`-Bausteine NICHT verändern. Es gibt KEINEN Token-Tippfehler (`--theme-frame-corner` ist korrekt; der vermeintliche Fehler war ein Kommentar-Treffer). Kein `border-left` mehr in Widgets — dafür `t-card--accent`.

**Screenshot-Harness (für alle Abnahmen):** Statischer Server auf `widgets/` + (für Tool-Seiten) auf Repo-Root, Chrome im Vordergrund. Ein wiederverwendbares Skript:
```bash
cd /home/ruschinski/git/obs-stream-kit && python3 - "$@" <<'PY'
import sys, threading, time, subprocess, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
url, out = sys.argv[1], sys.argv[2]
H = functools.partial(SimpleHTTPRequestHandler, directory=".")
srv = ThreadingHTTPServer(("127.0.0.1", 8124), H)
threading.Thread(target=srv.serve_forever, daemon=True).start(); time.sleep(0.4)
r = subprocess.run(["google-chrome","--headless=new","--disable-gpu","--no-sandbox",
  "--hide-scrollbars","--window-size=1100,900","--virtual-time-budget=2500",
  f"--screenshot={out}", url], capture_output=True, text=True, timeout=25)
srv.shutdown(); print("chrome exit", r.returncode)
PY
```
Aufruf: `… <SKRIPT> "http://127.0.0.1:8124/<pfad>" /tmp/shot.png` (Pfade relativ zum Repo-Root). Bei OBS-Widgets, die SSE/localhost pollen: mit totem Port (`?port=1`) laden → Offline-/Defaultzustand, Layout trotzdem prüfbar.

---

## Task 1: Neue `t-*`-Bausteine in `_blocks.css`

**Files:** Modify `widgets/_blocks.css` (additiv ans Ende von Ebene-1, vor Ebene-2-Charakter-Block)

- [ ] **Step 1: Bausteine ergänzen**

Einfügen (token-getrieben, descendant-Kinder wie bei `.t-stat`):
```css
/* ── t-bar: horizontale Live-Leiste (kompakt). Fläche/Rahmen via .t-card. ── */
.t-bar{display:flex;align-items:center;gap:0;padding:0 16px;white-space:nowrap}
.t-bar .t-sep{color:var(--theme-border)}

/* ── t-card--accent: Akzent-Kante links (statt hartkodiertem border-left). ── */
.t-card--accent{border-left-width:3px;border-left-color:var(--theme-accent)}

/* ── t-ticker: Marquee mit Rand-Fade. Track 2× befüllen (nahtloser Loop). ── */
.t-ticker{overflow:hidden;display:flex;align-items:center;flex:1;
  -webkit-mask-image:linear-gradient(90deg,transparent 0,#000 24px,#000 calc(100% - 24px),transparent 100%);
  mask-image:linear-gradient(90deg,transparent 0,#000 24px,#000 calc(100% - 24px),transparent 100%)}
.t-ticker-track{display:inline-flex;white-space:nowrap;will-change:transform;animation:t-marquee 26s linear infinite}
@keyframes t-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.t-ticker-track{animation:none}.t-ticker-track > * + *{display:none}}

/* ── t-kv: Key-Value-Zeile (Label links, Wert rechts). ── */
.t-kv{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:.85rem}
.t-kv .t-kv-k{color:var(--theme-text-dim)}
.t-kv .t-kv-v{color:var(--theme-text);font-weight:700;font-variant-numeric:tabular-nums}

/* ── t-chip: kleine Wert-Plakette. ── */
.t-chip{display:inline-flex;align-items:center;gap:6px;background:var(--theme-surface-2);
  border:var(--theme-border-width) solid var(--theme-border);border-radius:5px;
  padding:2px 8px;font-size:.76rem;color:var(--theme-text)}
.t-chip b{color:var(--theme-accent);font-variant-numeric:tabular-nums;font-weight:700}

/* ── t-crest: Icon/Wappen-Badge (Material-Symbol, Akzent). ── */
.t-crest{width:42px;height:42px;border-radius:8px;flex:none;display:grid;place-items:center;
  background:radial-gradient(circle at 30% 25%,var(--theme-primary),#1a0e2b);
  border:var(--theme-border-width) solid var(--theme-accent);color:var(--theme-accent);font-size:1.5rem}

/* ── t-flyin: Einflug-Animation (Alerts). ── */
@keyframes t-flyin{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}
.t-flyin{animation:t-flyin .45s cubic-bezier(.2,.8,.2,1) both}
@media (prefers-reduced-motion:reduce){.t-flyin{animation:none}}
```

- [ ] **Step 2: CSS-Syntax prüfen (Klammer-Balance, kein Parse-Fehler)**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && python3 -c "
css=open('widgets/_blocks.css').read()
assert css.count('{')==css.count('}'), (css.count('{'),css.count('}'))
for c in ['t-bar','t-card--accent','t-ticker','t-kv','t-chip','t-crest','t-flyin']:
    assert '.'+c in css, c
print('ok, braces balanced, all bausteine present')"
```
Expected: `ok, braces balanced, all bausteine present`

- [ ] **Step 3: Commit**
```bash
git add widgets/_blocks.css
git commit -m "feat(blocks): t-bar/t-ticker/t-kv/t-chip/t-crest/t-card--accent/t-flyin Bausteine"
```

---

## Task 2: Component-Preview-Seite

**Files:**
- Create: `tools/component-preview.html`
- Modify: `app/views_app.py` (Tool-Registry-Eintrag)

- [ ] **Step 1: Preview-Seite anlegen** (Muster: `tools/theme-preview.html` — lädt `/widgets-static/_theme.css`, theme-schaltbar)

`tools/component-preview.html`: lädt `/widgets-static/_theme.css` **und** `/widgets-static/_blocks.css`, Material-Symbols-Font, `data-theme` auf `<html>`. Ein Theme-Umschalter (Buttons setzen `document.documentElement.dataset.theme`). Pro Baustein ein beschrifteter Abschnitt, der die Komponente in echtem Markup zeigt: `.t-card`, `.t-card.t-card--accent`, `.t-bar` (mit `.t-sep`), `.t-ticker`+`.t-ticker-track`, `.t-kv` (`.t-kv-k`/`.t-kv-v`), `.t-chip` (+`<b>`), `.t-crest` (Material-Symbol `shield`), `.t-flyin`, plus die bestehenden `.t-header/.t-range/.t-stat-grid/.t-stat/.t-value/.t-label/.t-hot/.t-hot-mark`. KEINE Inline-Styles — Seiten-Layout über einen `<style>`-Block mit Klassen. Themes mind.: `entry`, `oldcamp`, `terminal`, `swiss` (Hell/Dunkel-Kontrast).

- [ ] **Step 2: Tool registrieren** in `app/views_app.py` in der Tool-Liste (nach dem `ornament-preview`-Eintrag, vor dem schließenden `]` bei Zeile ~44):
```python
    {"key": "component-preview",
     "label": "Komponenten-Vorschau",
     "desc": "Lebender Katalog aller t-*-Bausteine in jedem Theme — Referenz + Abnahme.",
     "path": "tools/component-preview.html",
     "admin_only": True},
```

- [ ] **Step 3: Rendert + alle Bausteine sichtbar (Screenshot je Theme)**

Mit dem Screenshot-Harness (oben), Seite direkt aus `tools/`:
```bash
# entry
… <HARNESS> "http://127.0.0.1:8124/tools/component-preview.html" /tmp/cp-entry.png
```
Für andere Themes: die Seite so bauen, dass `?theme=oldcamp` (o.ä.) `data-theme` setzt; dann je Theme ein Screenshot. Erwartung: jeder Baustein sichtbar, kein Layout-Bruch. Screenshots ansehen (Read-Tool).

- [ ] **Step 4: Commit**
```bash
git add tools/component-preview.html app/views_app.py
git commit -m "feat(tools): Komponenten-Vorschau (lebender t-*-Katalog je Theme)"
```

---

## Task 3: G1R Career-Card migrieren

**Files:** Modify `widgets/g1r/career-card.html`

Aktuell nutzt die Card lokale Klassen + `border-left`. Mapping auf Bausteine:

| lokal (entfernen) | Baustein |
|---|---|
| `.t-card.career` mit `border-left-*` | `t-card t-card--accent` (Akzentkante aus Baustein) |
| `.crest` | `t-crest` |
| `.grid .stat` / `.kv .row` (Label/Wert-Zeilen) | `t-kv` mit `.t-kv-k` / `.t-kv-v` |
| `.res span` (Resistenz) | `t-chip` (+ `<b>`) |

- [ ] **Step 1: Markup auf Bausteine umstellen + lokale CSS-Regeln entfernen**

Im `<style>` die lokalen Definitionen für `.crest`, `.grid`, `.stat`, `.kv`, `.res span`, `.section-lbl`-Doppelung und die `border-left`-Override auf `.t-card.career` **entfernen** (Layout-spezifische Reste wie feste Breite/Höhe `360×480`, Padding, Sektions-Abstände dürfen bleiben). Im Markup die Klassen gemäß Tabelle ersetzen; KV-Zeilen als `<div class="t-kv"><span class="t-kv-k">Strength</span><span class="t-kv-v" id="strength">—</span></div>`. JS-IDs (`strength`, `hp`, …) unverändert lassen.

- [ ] **Step 2: Kein `border-left` / `.crest` / `.kv`-Eigenbau mehr im File**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && python3 -c "
h=open('widgets/g1r/career-card.html').read()
assert 'border-left' not in h, 'border-left noch da'
assert 't-card--accent' in h and 't-crest' in h and 't-kv' in h and 't-chip' in h
print('ok: Bausteine genutzt, kein border-left')"
```
Expected: `ok: Bausteine genutzt, kein border-left`

- [ ] **Step 3: Render-Smoke (Offline-Zustand, toter Port) + Screenshot**
```bash
… <HARNESS> "http://127.0.0.1:8124/widgets/g1r/career-card.html?port=1&scope=all" /tmp/cc.png
```
Screenshot ansehen: Layout steht (Header/Crest, Stats als KV, Resistenz-Chips, Records, Gear), 360×480, kein Bruch.

- [ ] **Step 4: Commit**
```bash
git add widgets/g1r/career-card.html
git commit -m "refactor(g1r): Career-Card auf t-card--accent/t-crest/t-kv/t-chip (kein border-left)"
```

---

## Task 4: G1R Livebar migrieren

**Files:** Modify `widgets/g1r/livebar.html`

- [ ] **Step 1: Auf `t-bar` + `t-card--accent` umstellen**

`.t-card.bar`-Eigenbau (padding/flex/`border-left`) durch `class="t-card t-bar t-card--accent"` ersetzen; die lokale `.t-card.bar`-Regel + die border-left-Zeilen entfernen. Trenner `.sep`→`.t-sep` (Baustein). Item-Klassen (`.it`/`.v`/`.k`/`.clock`) sind livebar-spezifisch und dürfen als lokales Layout bleiben (oder `.k`→`.t-kv-k`-Stil, optional). Höhe 46px/Breite 1040px bleiben.

- [ ] **Step 2: Kein `border-left` mehr**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && python3 -c "
h=open('widgets/g1r/livebar.html').read()
assert 'border-left' not in h and 't-bar' in h and 't-card--accent' in h
print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Render-Smoke + Screenshot**
```bash
… <HARNESS> "http://127.0.0.1:8124/widgets/g1r/livebar.html?port=1" /tmp/bar.png
```
Ansehen: Leiste 1040×46, Felder + Trenner sichtbar, Akzentkante links.

- [ ] **Step 4: Commit**
```bash
git add widgets/g1r/livebar.html
git commit -m "refactor(g1r): Livebar auf t-bar + t-card--accent"
```

---

## Task 5: G1R News-Ticker migrieren

**Files:** Modify `widgets/g1r/news-ticker.html`

- [ ] **Step 1: Auf `t-ticker` umstellen**

Lokales `.mask`/`.track`/`@keyframes marquee` durch die Bausteine ersetzen: `.mask`→`t-ticker`, `.track`→`t-ticker-track` (im Markup `id="track"`/`id="run"` etc. behalten), die lokale Marquee-Definition + Mask entfernen (kommt jetzt aus `_blocks.css`). `border-left` (falls vorhanden) → `t-card--accent`. Tag-Label (`.tag`) darf lokal bleiben. 760×40 bleibt.

- [ ] **Step 2: Kein lokales Marquee/Mask mehr doppelt**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && python3 -c "
h=open('widgets/g1r/news-ticker.html').read()
assert 't-ticker' in h and 'border-left' not in h
print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Render-Smoke + Screenshot**
```bash
… <HARNESS> "http://127.0.0.1:8124/widgets/g1r/news-ticker.html?port=1" /tmp/tick.png
```
Ansehen: Laufband 760×40, Rand-Fade sichtbar.

- [ ] **Step 4: Commit**
```bash
git add widgets/g1r/news-ticker.html
git commit -m "refactor(g1r): News-Ticker auf t-ticker (Marquee+Fade aus _blocks.css)"
```

---

## Task 6: `t-flyin` an EINEM Alert als Muster (Rest später)

**Files:** Modify `alerts/welcome.html`

Die Alerts haben aufwändige, funktionierende Einzel-Animationen. Hier wird `t-flyin` NUR am `welcome`-Alert als Referenz-Muster angewandt; die übrigen 7 Alerts bleiben unverändert und werden in einem späteren Durchgang migriert (bewusst, kein stiller Cut — sie funktionieren).

- [ ] **Step 1: `_blocks.css` im welcome-Alert laden + Einflug über `t-flyin`**

In `alerts/welcome.html` zusätzlich `<link rel="stylesheet" href="../widgets/_blocks.css">` NACH `_theme.css`. Die Einflug-Animation des Haupt-Containers auf `class="… t-flyin"` umstellen (die lokale Einflug-Keyframe entfernen, sofern sie nur den Einflug macht; Bounce-Out/Hiding bleibt lokal).

- [ ] **Step 2: Render-Smoke + Screenshot**
```bash
… <HARNESS> "http://127.0.0.1:8124/alerts/welcome.html?name=TestUser" /tmp/welcome.png
```
Ansehen: Alert rendert, Einflug-Zustand sichtbar.

- [ ] **Step 3: Commit**
```bash
git add alerts/welcome.html
git commit -m "refactor(alerts): welcome auf t-flyin (Muster; übrige Alerts folgen später)"
```

---

## Self-Review-Notiz (Plan ↔ Spec Teil A)
- Spec „neue Bausteine" → Task 1 (alle 7). „Component-Preview-Seite" → Task 2. „Migration G1R-Widgets" → Tasks 3–5. „Alerts → t-flyin" → Task 6 (1 Alert als Muster, Rest explizit später). „kein border-left" → in Tasks 3–5 verifiziert. „Token-Fix" → entfällt (Fehlalarm, im Plan-Kopf notiert). Abnahme via Preview + Screenshot → in jeder Task.
- `t-row` aus dem Spec ist mit `t-kv` zusammengelegt (eine Key-Value-Zeile, kein zweiter Baustein nötig — YAGNI).
- Bestehende `t-*`-Bausteine bleiben unangetastet.
