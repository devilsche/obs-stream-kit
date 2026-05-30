# `/app/urls` Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/app/urls` als Master-Detail Layout mit prominenter URL-Card + ProxyFix-Middleware damit `base_url` korrekt `https://` zurückgibt.

**Architecture:** Drei Änderungen: (1) Werkzeug-ProxyFix in der App-Factory, damit `request.url_root` X-Forwarded-Proto respektiert; (2) Komplett-Rewrite von `app/templates/urls.html` zu Master-Detail (Desktop) / Stack (Mobile); (3) Neue CSS-Sektion in `app/static/dashboard.css` für die neuen Komponenten. Bestehende `widget_catalog`-Datenstruktur und URL-Builder-Logik bleiben unverändert.

**Tech Stack:** Flask + Jinja2, Werkzeug ProxyFix, Vanilla JS, CSS (mobile-first), pytest für Backend-Tests.

**Spec:** `docs/superpowers/specs/2026-05-30-urls-page-redesign-design.md`

---

## File Map

| Datei | Verantwortung | Op |
|---|---|---|
| `app/__init__.py` | App-Factory; bindet ProxyFix in `app.wsgi_app` ein | Modify |
| `tests/app/test_app_factory.py` | Smoke-Tests App-Factory; ergänzt um ProxyFix-Test | Modify |
| `app/static/dashboard.css` | Neue Sektion für `.url-layout`, `.url-master`, `.url-detail`, `.url-card-primary`, mobile-stack | Modify |
| `app/templates/urls.html` | Komplett-Rewrite zu Master-Detail Layout | Modify |
| `app/views_app.py` | Keine Änderung — `base_url` wird automatisch korrekt | — |

---

## Task 1: ProxyFix-Middleware einbinden

**Files:**
- Modify: `app/__init__.py:1-37`
- Modify: `tests/app/test_app_factory.py`

- [ ] **Step 1: Failing-Test schreiben**

Append an `tests/app/test_app_factory.py`:

```python
def test_proxyfix_respects_x_forwarded_proto():
    """Mit X-Forwarded-Proto: https muss request.url_root https:// zurückgeben."""
    app = create_app(testing=True)

    @app.route("/__scheme_probe__")
    def _probe():
        from flask import request
        return {"scheme": request.scheme, "url_root": request.url_root}

    client = app.test_client()
    resp = client.get("/__scheme_probe__",
                      headers={"X-Forwarded-Proto": "https",
                               "X-Forwarded-Host": "stats-overlay.info"})
    assert resp.status_code == 200
    assert resp.json["scheme"] == "https"
    assert resp.json["url_root"].startswith("https://stats-overlay.info")


def test_proxyfix_defaults_to_http_without_header():
    """Ohne X-Forwarded-Proto bleibt es http:// (lokales Dev / direkter Zugriff)."""
    app = create_app(testing=True)

    @app.route("/__scheme_probe2__")
    def _probe():
        from flask import request
        return {"scheme": request.scheme}

    resp = app.test_client().get("/__scheme_probe2__")
    assert resp.json["scheme"] == "http"
```

- [ ] **Step 2: Tests laufen lassen, sollten fehlschlagen**

Run: `cd /home/ruschinski/git/obs-stream-kit && pytest tests/app/test_app_factory.py -v`
Expected: `test_proxyfix_respects_x_forwarded_proto` FAILS mit scheme == "http" statt "https" (ProxyFix noch nicht eingebunden).

- [ ] **Step 3: ProxyFix einbinden**

Edit `app/__init__.py` — neuer Import nach Zeile 3 und neue Zeile nach `app.config["_PROJECT_ROOT"] = project_root` (nach Zeile 22):

```python
"""obs-stream-kit Flask-App-Factory."""
import os
from flask import Flask, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix

from app.config import Config, TestingConfig
from app.middleware import register_middleware
from app.auth import bp_auth
from app.views_admin import bp_admin
from app.views_widgets import bp_widgets
from app.views_static import bp_static
from app.views_api import bp_api
from app.views_app import bp_app
from app.metrics import register_metrics


def create_app(testing: bool = False) -> Flask:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app = Flask(__name__,
                template_folder="templates",
                static_folder="static")
    app.config.from_object(TestingConfig if testing else Config)
    app.config["_PROJECT_ROOT"] = project_root

    # Hinter nginx: X-Forwarded-Proto/Host/For respektieren, damit
    # request.url_root korrekt https://stats-overlay.info/ liefert.
    # Streng x_*=1, weil genau ein vertrauenswuerdiger Proxy-Hop existiert.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_for=1)

    register_middleware(app)
    register_metrics(app)
    app.register_blueprint(bp_auth)
    app.register_blueprint(bp_admin)
    app.register_blueprint(bp_widgets)
    app.register_blueprint(bp_static)
    app.register_blueprint(bp_api)
    app.register_blueprint(bp_app)

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app
```

- [ ] **Step 4: Tests laufen lassen, sollten passen**

Run: `cd /home/ruschinski/git/obs-stream-kit && pytest tests/app/test_app_factory.py -v`
Expected: alle 4 Tests PASS.

- [ ] **Step 5: Voll-Suite laufen lassen — keine Regression**

Run: `cd /home/ruschinski/git/obs-stream-kit && pytest -q`
Expected: alle Tests PASS (oder gleicher Pass/Fail-Stand wie vor dem Task).

- [ ] **Step 6: Commit**

```bash
cd /home/ruschinski/git/obs-stream-kit
git add app/__init__.py tests/app/test_app_factory.py
git commit -m "fix(app): ProxyFix middleware — request.url_root liefert https hinter nginx"
```

---

## Task 2: CSS für Master-Detail Layout

**Files:**
- Modify: `app/static/dashboard.css` (append am Ende)

- [ ] **Step 1: CSS-Sektion anhaengen**

Append an `app/static/dashboard.css`:

```css
/* ─── /app/urls — Master-Detail Layout ─────────────────────────────── */

.url-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 18px;
  align-items: start;
}

/* MASTER ─────────────────────────────────────────────── */
.url-master {
  position: sticky;
  top: 86px;
  max-height: calc(100vh - 110px);
  overflow-y: auto;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
}
.url-master__filter {
  width: 100%;
  background: var(--bg-deeper);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  font: inherit;
  min-height: 40px;
  margin-bottom: 10px;
}
.url-master__filter:focus-visible {
  outline: 2px solid var(--brand-gold);
  outline-offset: 2px;
}
.url-cat {
  margin-bottom: 6px;
}
.url-cat__title {
  color: var(--text-dim);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
  padding: 8px 8px 4px;
  cursor: pointer;
  list-style: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.url-cat__title::-webkit-details-marker { display: none; }
.url-cat__count {
  background: var(--bg-deeper);
  color: var(--text-muted);
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 0.85em;
  font-weight: 700;
}
.url-cat[open] .url-cat__title { color: var(--brand-gold); }

.url-master__item {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-left: 3px solid transparent;
  color: var(--text-muted);
  padding: 10px 12px;
  border-radius: 0 6px 6px 0;
  font: inherit;
  cursor: pointer;
  min-height: 44px;
}
.url-master__item:hover {
  background: var(--bg-elev);
  color: var(--text);
}
.url-master__item:focus-visible {
  outline: 2px solid var(--brand-gold);
  outline-offset: -2px;
}
.url-master__item[aria-current="page"] {
  background: var(--bg-elev);
  color: var(--brand-gold);
  border-left-color: var(--brand-gold);
  font-weight: 700;
}
.url-master__empty {
  color: var(--text-dim);
  font-style: italic;
  padding: 20px 12px;
  text-align: center;
}

/* DETAIL ─────────────────────────────────────────────── */
.url-detail {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 22px 24px;
  min-height: 400px;
}
.url-detail__header {
  margin-bottom: 18px;
}
.url-detail__cat {
  color: var(--text-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
}
.url-detail__cat-sep { opacity: 0.4; margin: 0 6px; }
.url-detail__path {
  color: var(--text-very-dim);
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.url-detail__title {
  color: var(--brand-gold);
  font-size: 22px;
  font-weight: 700;
  margin: 6px 0 4px;
}
.url-detail__desc {
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1.45;
  margin: 0;
}

/* URL CARD (primary action) ─────────────────────────── */
.url-card-primary {
  background: var(--bg-deeper);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  margin: 18px 0 24px;
  position: sticky;
  top: 86px;
  z-index: 5;
}
.url-card-primary__url {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: var(--text);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 14px;
  word-break: break-all;
  margin-bottom: 12px;
  user-select: all;
}
.url-card-primary__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.btn-copy-primary {
  background: var(--brand-gold);
  color: #1a0d2a;
  border: 1px solid var(--brand-gold);
  border-radius: 6px;
  padding: 12px 20px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.btn-copy-primary:hover { filter: brightness(1.1); }
.btn-copy-primary:focus-visible {
  outline: 2px solid #1a0d2a;
  outline-offset: 2px;
}
.btn-preview-secondary {
  background: transparent;
  color: var(--brand-purple-bright, #b78cd8);
  border: 1px solid var(--brand-purple-bright, #b78cd8);
  border-radius: 6px;
  padding: 12px 20px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}
.btn-preview-secondary:hover {
  background: var(--brand-purple);
  color: #fff;
}
.btn-preview-secondary:focus-visible {
  outline: 2px solid var(--brand-gold);
  outline-offset: 2px;
}
.url-copy-status {
  position: absolute;
  width: 1px; height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

/* CONFIGURE-Sektion ─────────────────────────────────── */
.url-configure__heading {
  color: var(--text-dim);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  margin: 8px 0 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.url-switches {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 18px 22px;
}
.sw-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.sw-label {
  color: var(--text-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 4px;
}
.sw-controls {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.sw-btn {
  background: var(--bg-card);
  color: var(--text-muted);
  border: 1px solid var(--border);
  padding: 6px 14px;
  border-radius: 100px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  min-height: 32px;
}
.sw-btn:hover { color: var(--text); }
.sw-btn:focus-visible {
  outline: 2px solid var(--brand-gold);
  outline-offset: 2px;
}
.sw-btn.active {
  background: var(--brand-purple);
  color: #fff;
  border-color: var(--brand-purple);
}
.sw-input {
  background: var(--bg-card);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 6px 10px;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  width: 100px;
  min-height: 36px;
  font-variant-numeric: tabular-nums;
}
.sw-input:focus-visible {
  outline: 2px solid var(--brand-gold);
  outline-offset: 2px;
}
.info-i {
  display: inline-block;
  margin-left: 4px;
  color: var(--brand-gold);
  cursor: help;
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0;
  position: relative;
}
.info-i:hover::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-deeper);
  color: var(--text);
  border: 1px solid var(--brand-gold);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.4;
  white-space: normal;
  width: 280px;
  text-align: left;
  z-index: 100;
  text-transform: none;
  letter-spacing: 0;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.info-i:hover::before {
  content: "";
  position: absolute;
  bottom: calc(100% + 1px);
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: var(--brand-gold);
  z-index: 100;
}

/* Detail-Empty-State ─────────────────────────────────── */
.url-detail__empty {
  color: var(--text-dim);
  font-style: italic;
  padding: 60px 0;
  text-align: center;
}

/* Back-Button (Mobile) ───────────────────────────────── */
.url-back-btn {
  display: none;
  background: transparent;
  border: 0;
  color: var(--brand-gold);
  font: inherit;
  font-weight: 600;
  padding: 8px 0;
  margin-bottom: 12px;
  cursor: pointer;
  min-height: 44px;
}
.url-back-btn:focus-visible {
  outline: 2px solid var(--brand-gold);
  outline-offset: 2px;
}

/* Tablet & Mobile (< 1024px): Stack-Pattern ──────────── */
@media (max-width: 1023px) {
  .url-layout {
    grid-template-columns: 1fr;
  }
  .url-master {
    position: static;
    max-height: none;
  }
  .url-master.is-hidden,
  .url-detail.is-hidden {
    display: none;
  }
  .url-back-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .url-card-primary {
    position: sticky;
    top: 70px;
  }
}

/* Reduced motion ─────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .url-master__item,
  .sw-btn,
  .btn-copy-primary,
  .btn-preview-secondary {
    transition: none;
  }
}
```

- [ ] **Step 2: Smoke-Check — CSS-Datei laedt fehlerfrei**

Run: `cd /home/ruschinski/git/obs-stream-kit && python -c "open('app/static/dashboard.css').read()" && echo "OK"`
Expected: `OK` (kein Fehler).

- [ ] **Step 3: Commit**

```bash
cd /home/ruschinski/git/obs-stream-kit
git add app/static/dashboard.css
git commit -m "style(urls): CSS für Master-Detail Layout + WCAG-konforme Touch-Targets"
```

---

## Task 3: `urls.html` Komplett-Rewrite

**Files:**
- Modify: `app/templates/urls.html` (komplett ersetzen)

- [ ] **Step 1: Datei komplett ersetzen**

Ersetze den gesamten Inhalt von `app/templates/urls.html` mit:

```html
{% extends "base.html" %}
{% block title %}OBS URLs — OBS Stream Kit{% endblock %}
{% block body %}
<div class="layout">
  {% include "_sidebar.html" %}
  <main id="main-content" class="main" tabindex="-1">
    <div class="topbar"><div class="greeting">OBS Browser-Source URLs</div></div>

    <div class="card">
      <h3>How it works</h3>
      <p>Wähle links ein Widget aus. Rechts erscheint die kopierbare URL plus alle einstellbaren Parameter. Default-Werte bleiben aus der URL — picke einen abweichenden Wert um ihn als Query-Parameter anzuhängen.</p>
      <p style="color: var(--text-dim); font-size: 13px;">Token: <code>{{ token }}</code> · {{ widgets|length }} widgets</p>
    </div>

    {% if not token %}
      <div class="card"><p style="color: var(--danger);">No token found — admin still has to set up your tenant.</p></div>
    {% else %}

    {% set grouped = {} %}
    {% for cat, label, desc, path, switches in widgets %}
      {% if cat not in grouped %}{% set _ = grouped.update({cat: []}) %}{% endif %}
      {% set _ = grouped[cat].append((label, desc, path, switches)) %}
    {% endfor %}

    <div class="url-layout">

      {# ── MASTER ──────────────────────────────────────── #}
      <nav class="url-master" id="urlMaster"
           role="navigation" aria-label="Widget list">
        <input type="search" id="urlFilter"
               class="url-master__filter"
               placeholder="🔍 Filter widget…"
               aria-label="Widget-Liste filtern">

        {% for cat, items in grouped.items() %}
        <details class="url-cat" open>
          <summary class="url-cat__title">
            <span>{{ cat }}</span>
            <span class="url-cat__count">{{ items|length }}</span>
          </summary>
          {% for label, desc, path, switches in items %}
          <button type="button"
                  class="url-master__item"
                  data-widget-id="{{ path }}"
                  data-widget-cat="{{ cat }}"
                  data-widget-label="{{ label }}"
                  data-widget-desc="{{ desc }}"
                  data-widget-path="{{ path }}"
                  data-widget-base="{{ base_url }}/s/{{ token }}/widgets/{{ path }}"
                  data-widget-switches='{{ switches | tojson | safe }}'>
            {{ label }}
          </button>
          {% endfor %}
        </details>
        {% endfor %}

        <div id="urlMasterEmpty" class="url-master__empty" hidden>
          Kein Widget gefunden
        </div>
      </nav>

      {# ── DETAIL ──────────────────────────────────────── #}
      <section class="url-detail" id="urlDetail" aria-live="off">
        <button type="button" id="urlBackBtn" class="url-back-btn"
                aria-label="Zurück zur Widget-Liste">← Zurück zur Liste</button>
        <div id="urlDetailContent">
          <div class="url-detail__empty">Wähle links ein Widget aus.</div>
        </div>
      </section>

    </div>

    <div class="card">
      <h3>Streamer.bot</h3>
      <p>Replace previous <code>/api/pubg/...</code> URLs with <code>{{ base_url }}/s/{{ token }}/api/...</code> (drop the auth header).</p>
    </div>

    {% endif %}
  </main>
</div>

<script>
(function () {
  const master = document.getElementById("urlMaster");
  const detail = document.getElementById("urlDetailContent");
  const detailSection = document.getElementById("urlDetail");
  const backBtn = document.getElementById("urlBackBtn");
  const filter = document.getElementById("urlFilter");
  const masterEmpty = document.getElementById("urlMasterEmpty");
  if (!master || !detail) return;

  const items = Array.from(master.querySelectorAll(".url-master__item"));
  const cats = Array.from(master.querySelectorAll(".url-cat"));
  const isMobile = () => window.matchMedia("(max-width: 1023px)").matches;

  // ── URL aus aktuell gerendertem Detail-Switches zusammenbauen
  function buildUrl(root) {
    const base = root.dataset.base;
    const params = [];
    root.querySelectorAll(".sw-group").forEach(g => {
      const def = g.dataset.default;
      let value = null;
      if (g.dataset.type === "select") {
        const active = g.querySelector(".sw-btn.active");
        if (active) value = active.dataset.value;
      } else if (g.dataset.type === "multiselect") {
        const picks = Array.from(g.querySelectorAll(".sw-btn.active"))
          .map(b => b.dataset.value);
        value = picks.join(",");
      } else {
        const inp = g.querySelector(".sw-input");
        if (inp) value = inp.value.trim();
      }
      if (value && value !== def) {
        params.push(g.dataset.param + "=" + encodeURIComponent(value));
      }
    });
    return params.length ? base + "?" + params.join("&") : base;
  }

  // ── Switches-HTML aus switches-Array bauen
  function renderSwitches(switches) {
    if (!switches || !switches.length) return "";
    return switches.map(sw => {
      const tooltip = sw.tooltip
        ? `<span class="info-i" data-tip="${escapeHtml(sw.tooltip)}">ⓘ</span>`
        : "";
      let controls = "";
      if (sw.type === "select" && sw.options) {
        controls = sw.options.map(([value, vlabel]) =>
          `<button type="button" class="sw-btn${value == sw.default ? " active" : ""}"
                   data-value="${escapeAttr(value)}" aria-pressed="${value == sw.default ? "true" : "false"}">${escapeHtml(vlabel)}</button>`
        ).join("");
      } else if (sw.type === "multiselect" && sw.options) {
        controls = sw.options.map(([value, vlabel]) =>
          `<button type="button" class="sw-btn sw-multi"
                   data-value="${escapeAttr(value)}" aria-pressed="false">${escapeHtml(vlabel)}</button>`
        ).join("");
      } else if (sw.type === "text") {
        controls = `<input type="text" class="sw-input" style="width:200px"
                           value="${escapeAttr(sw.default || "")}"
                           placeholder="${escapeAttr(sw.placeholder || "")}">`;
      } else {
        const minAttr = sw.min !== undefined ? `min="${sw.min}"` : "";
        const maxAttr = sw.max !== undefined ? `max="${sw.max}"` : "";
        const presets = (sw.presets || []).map(p =>
          `<button type="button" class="sw-btn sw-preset${String(p) === String(sw.default) ? " active" : ""}"
                   data-value="${escapeAttr(p)}">${escapeHtml(p)}</button>`
        ).join("");
        controls = `<input type="number" class="sw-input"
                           value="${escapeAttr(sw.default)}" ${minAttr} ${maxAttr}>${presets}`;
      }
      return `
        <div class="sw-group"
             data-param="${escapeAttr(sw.key)}"
             data-default="${escapeAttr(sw.default)}"
             data-type="${escapeAttr(sw.type)}">
          <span class="sw-label">${escapeHtml(sw.label)} ${tooltip}</span>
          <div class="sw-controls">${controls}</div>
        </div>`;
    }).join("");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  // ── Detail-Panel rendern für ein Widget
  function renderDetail(item) {
    let switches;
    try { switches = JSON.parse(item.dataset.widgetSwitches || "[]"); }
    catch (_) { switches = []; }

    const base = item.dataset.widgetBase;
    const html = `
      <div class="url-detail__header" data-base="${escapeAttr(base)}">
        <div>
          <span class="url-detail__cat">${escapeHtml(item.dataset.widgetCat)}</span>
          <span class="url-detail__cat-sep">·</span>
          <span class="url-detail__path">${escapeHtml(item.dataset.widgetPath)}</span>
        </div>
        <h2 class="url-detail__title">${escapeHtml(item.dataset.widgetLabel)}</h2>
        <p class="url-detail__desc">${escapeHtml(item.dataset.widgetDesc)}</p>
      </div>

      <div class="url-card-primary" data-base="${escapeAttr(base)}">
        <div class="url-card-primary__url" id="urlText">${escapeHtml(base)}</div>
        <div class="url-card-primary__actions">
          <button type="button" class="btn-copy-primary" id="btnCopy">
            <span aria-hidden="true">📋</span> URL kopieren
          </button>
          <button type="button" class="btn-preview-secondary" id="btnPreview">
            <span aria-hidden="true">↗</span> Preview öffnen
          </button>
        </div>
        <div class="url-copy-status" id="urlCopyStatus" role="status" aria-live="polite"></div>
      </div>

      ${switches.length ? `
        <h3 class="url-configure__heading">Configure</h3>
        <div class="url-switches" id="urlSwitches">${renderSwitches(switches)}</div>
      ` : ""}
    `;
    detail.innerHTML = html;
    wireDetail(base);
  }

  // ── Event-Wiring im frisch gerenderten Detail
  function wireDetail(base) {
    const urlText = document.getElementById("urlText");
    const copyBtn = document.getElementById("btnCopy");
    const previewBtn = document.getElementById("btnPreview");
    const status = document.getElementById("urlCopyStatus");
    const switchesRoot = document.getElementById("urlSwitches");

    // Pseudo-Root mit dataset.base, damit buildUrl() funktioniert
    const root = { dataset: { base: base }, querySelectorAll: sel =>
      switchesRoot ? switchesRoot.querySelectorAll(sel) : [] };

    function refresh() { urlText.textContent = buildUrl(root); }

    if (switchesRoot) {
      switchesRoot.querySelectorAll(".sw-group").forEach(group => {
        const numInput = group.querySelector("input[type=number]");
        const isMulti = group.dataset.type === "multiselect";
        group.querySelectorAll(".sw-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            if (isMulti) {
              const pressed = btn.classList.toggle("active");
              btn.setAttribute("aria-pressed", pressed ? "true" : "false");
            } else {
              group.querySelectorAll(".sw-btn").forEach(b => {
                b.classList.remove("active");
                b.setAttribute("aria-pressed", "false");
              });
              btn.classList.add("active");
              btn.setAttribute("aria-pressed", "true");
            }
            if (numInput && btn.classList.contains("sw-preset")) {
              numInput.value = btn.dataset.value;
            }
            refresh();
          });
        });
        group.querySelectorAll(".sw-input").forEach(inp => {
          inp.addEventListener("input", () => {
            group.querySelectorAll(".sw-preset").forEach(b => b.classList.remove("active"));
            const match = group.querySelector(`.sw-preset[data-value="${inp.value}"]`);
            if (match) match.classList.add("active");
            refresh();
          });
        });
      });
    }

    copyBtn.addEventListener("click", async () => {
      const url = buildUrl(root);
      try {
        await navigator.clipboard.writeText(url);
        status.textContent = "URL kopiert.";
        copyBtn.textContent = "✓ Kopiert";
        setTimeout(() => {
          copyBtn.innerHTML = '<span aria-hidden="true">📋</span> URL kopieren';
          status.textContent = "";
        }, 1500);
      } catch (_) {
        // Fallback: textarea + execCommand
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          status.textContent = "URL kopiert.";
        } catch (_) {
          status.textContent = "Kopieren fehlgeschlagen — URL bitte manuell markieren.";
        }
        document.body.removeChild(ta);
      }
    });

    previewBtn.addEventListener("click", () => {
      window.open(buildUrl(root), "_blank", "noopener");
    });
  }

  // ── Master → Detail Switch
  let lastSelectedId = null;
  function selectItem(item, opts) {
    opts = opts || {};
    items.forEach(b => {
      b.removeAttribute("aria-current");
    });
    item.setAttribute("aria-current", "page");
    lastSelectedId = item.dataset.widgetId;
    renderDetail(item);
    if (isMobile()) {
      master.classList.add("is-hidden");
      detailSection.classList.remove("is-hidden");
      window.scrollTo(0, 0);
    }
    if (!opts.skipHash) {
      try { history.replaceState(null, "",
        "#widget=" + encodeURIComponent(item.dataset.widgetId)); } catch (_) {}
    }
  }

  items.forEach(item => {
    item.addEventListener("click", () => selectItem(item));
  });

  // ── Back-Button (nur Mobile sichtbar)
  backBtn.addEventListener("click", () => {
    detailSection.classList.add("is-hidden");
    master.classList.remove("is-hidden");
    const last = lastSelectedId
      ? master.querySelector(`[data-widget-id="${CSS.escape(lastSelectedId)}"]`)
      : null;
    if (last) last.focus();
  });

  // ── Tastatur-Navigation im Master (↑/↓/Enter)
  master.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
    const focused = document.activeElement;
    if (!focused || !focused.classList.contains("url-master__item")) return;
    e.preventDefault();
    const visible = items.filter(i => i.offsetParent !== null);
    const idx = visible.indexOf(focused);
    if (idx < 0) return;
    const next = e.key === "ArrowDown"
      ? visible[Math.min(idx + 1, visible.length - 1)]
      : visible[Math.max(idx - 1, 0)];
    if (next) next.focus();
  });

  // ── Filter
  if (filter) {
    filter.addEventListener("input", () => {
      const q = filter.value.toLowerCase().trim();
      let anyVisible = false;
      items.forEach(item => {
        const hay = (item.textContent + " " + item.dataset.widgetPath).toLowerCase();
        const show = !q || hay.includes(q);
        item.style.display = show ? "" : "none";
        if (show) anyVisible = true;
      });
      // Bei aktiver Suche alle Kategorien aufklappen
      if (q) cats.forEach(c => c.setAttribute("open", ""));
      // Empty-State
      masterEmpty.hidden = anyVisible || !q;
    });
  }

  // ── Deep-Link via Hash
  const m = (location.hash || "").match(/widget=([^&]+)/);
  const initial = m
    ? master.querySelector(`[data-widget-id="${CSS.escape(decodeURIComponent(m[1]))}"]`)
    : null;
  if (initial) {
    selectItem(initial, { skipHash: true });
  } else if (!isMobile() && items.length) {
    selectItem(items[0], { skipHash: true });
  } else if (isMobile()) {
    detailSection.classList.add("is-hidden");
  }
})();
</script>
{% endblock %}
```

- [ ] **Step 2: Template-Syntax-Check via Jinja**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && python -c "
from jinja2 import Environment, FileSystemLoader
env = Environment(loader=FileSystemLoader('app/templates'))
env.get_template('urls.html')
print('Template parses OK')
"
```
Expected: `Template parses OK` (kein TemplateSyntaxError).

- [ ] **Step 3: App startet + Render-Smoke ohne Crash**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && pytest tests/app/ -v
```
Expected: alle Tests aus `tests/app/` PASS (App-Factory + ProxyFix-Tests, kein Render-Crash).

- [ ] **Step 4: Commit**

```bash
cd /home/ruschinski/git/obs-stream-kit
git add app/templates/urls.html
git commit -m "feat(urls): Master-Detail Layout, prominente URL-Card, Mobile-Stack, WCAG 2.2 AA"
```

---

## Task 4: Manuelle Browser-Verifikation

**Files:** keine — reine Manual-Tests, Ergebnis in PR-Beschreibung dokumentieren.

- [ ] **Step 1: Server starten**

Run:
```bash
cd /home/ruschinski/git/obs-stream-kit && python serve.py --port 9000
```
Erwartet: Server lauscht auf `:9000`.

- [ ] **Step 2: Desktop-Check (≥ 1024px Browserfenster)**

Browser → `http://localhost:9000/app/urls` (eingeloggt).

Prüfen:
- Master links sichtbar (320px), Detail rechts.
- Erstes Widget ist auto-selected, gold-highlighted mit linkem Border-Indikator.
- URL-Card hat sticky-Top, große Copy + Preview Buttons.
- Click auf Switch → URL aktualisiert sich live.
- Click auf Copy → Button zeigt „✓ Kopiert", Clipboard enthält URL (paste-Test).
- Click auf Preview → neuer Tab mit Widget öffnet.
- Filter „top" → reduziert Master-Liste auf passende Widgets, Kategorien bleiben offen.
- Filter leeren → Master zeigt alle wieder.
- Tab-Navigation: Filter → Kategorien → Items → Detail → Copy/Preview/Switches. Focus-Ring (gold) sichtbar überall.
- ↓/↑ in Master-Liste scrollt durch Items.

- [ ] **Step 3: Mobile-Check (DevTools < 768px, z.B. 375px)**

Im selben Browser DevTools öffnen, Device-Toolbar auf 375×667.

Prüfen:
- Master-Liste fullwidth, Detail ausgeblendet.
- Tap auf Widget → Detail fullwidth, Master weg, `← Zurück zur Liste`-Button oben.
- URL-Card sticky beim Scroll.
- Copy-Button bleibt erreichbar.
- Tap auf Back → zurück zur Liste, Focus auf vorher gewähltem Widget.

- [ ] **Step 4: HTTPS-Check (lokal via Header simulieren)**

Run:
```bash
curl -s -H "X-Forwarded-Proto: https" -H "X-Forwarded-Host: stats-overlay.info" \
  http://localhost:9000/app/urls | grep -E "https://stats-overlay\.info" | head -3
```
Expected: mindestens drei `https://stats-overlay.info/s/...`-Vorkommen im HTML.

(Ohne Header zeigt der Output `http://localhost:9000/...` — das ist gewollt für lokales Dev.)

- [ ] **Step 5: Server stoppen**

Ctrl-C im Terminal mit `serve.py`.

- [ ] **Step 6: Deploy auf Streaming-PC + Live-Check**

Push, dann auf dem Server pullen und neu starten (existierender Deploy-Workflow).

Run:
```bash
curl -s https://stats-overlay.info/app/urls -b "session=<dein_session_cookie>" \
  | grep -E "https://stats-overlay\.info/s/" | head -1
```
Expected: erste sichtbare URL beginnt mit `https://stats-overlay.info/s/`.

- [ ] **Step 7: Push**

```bash
cd /home/ruschinski/git/obs-stream-kit
git push origin master
```

---

## Self-Review

**Spec coverage:**
- ✅ HTTPS-Fix via ProxyFix → Task 1
- ✅ Master-Detail Desktop Layout → Task 2 (CSS) + Task 3 (Template/JS)
- ✅ Mobile Stack-Pattern + Back-Button + Focus-Restore → Task 2 CSS + Task 3 JS
- ✅ URL-Card mit primären/sekundären Buttons ≥ 44px → Task 2 CSS + Task 3 Template
- ✅ WCAG: aria-current, aria-pressed, aria-live, focus-visible, role=navigation → Task 2 + Task 3
- ✅ Filter + Tastatur-Nav → Task 3 JS
- ✅ Clipboard-API + Fallback (textarea/execCommand) → Task 3 JS
- ✅ Deep-Link via `#widget=<path>` → Task 3 JS
- ✅ Manual Browser-Tests → Task 4
- ✅ HTTPS-Verifikation → Task 4 Step 4 + 6

**Placeholder scan:** keine TODO/TBD/vague-handling-Strings im Plan. Alle Code-Blöcke vollständig.

**Type consistency:**
- `buildUrl(root)` erwartet Objekt mit `dataset.base` + `querySelectorAll` — in `wireDetail()` als Pseudo-Root konstruiert. ✓
- Master-Items haben `data-widget-{id,cat,label,desc,path,base,switches}` — alle in `renderDetail()` verwendet. ✓
- CSS-Klassen `.url-master`, `.url-detail`, `.url-card-primary`, `.btn-copy-primary`, `.btn-preview-secondary` in CSS (Task 2) + Template (Task 3) konsistent. ✓
- `.sw-btn`, `.sw-input`, `.sw-group`, `.info-i` aus alter Implementierung neu definiert + im neuen JS verdrahtet. ✓
