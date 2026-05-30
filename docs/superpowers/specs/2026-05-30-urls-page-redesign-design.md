# `/app/urls` Page Redesign — Design Spec

**Datum:** 2026-05-30
**Status:** Approved (Brainstorming → Plan)

## Problem

Die aktuelle `/app/urls`-Seite hat drei konkrete Mängel:

1. **URL ist HTTP statt HTTPS.** `request.url_root` in `views_app.py:148` reflektiert das Schema, das Flask sieht. Hinter nginx ohne `X-Forwarded-Proto`-Respektierung kommt `http://` zurück.
2. **Preview- und Copy-Button sind falsch platziert.** Beide hängen rechts an einer abgeschnittenen URL-Pill, sind 11px klein (WCAG 2.5.3 verletzt, Target unter 24×24px) und haben kein visuelles Gewicht. User übersieht/vertippt sich.
3. **Seite hat keine Struktur.** Pro Widget gibt es Head + Description + Switch-Grid + URL-Pill flach untereinander. Bei 7 Kategorien × N Widgets × M Switches entsteht ein visueller Brei ohne Hierarchie zwischen „configure" und „use".

## Ziel

Master-Detail-Layout mit prominenter URL-Card und korrekt aufgelöstem HTTPS-Schema. Mobile-tauglich via Stack-Pattern. WCAG 2.2 AA konform.

## Out of Scope (YAGNI)

- Saved-Presets („speichere meine bevorzugte URL-Variante")
- Drag-Reorder / Custom-Sortierung der Widget-Liste
- QR-Code-Generierung
- king-edition.de-Cleanup (eigener Plan, siehe Memory `project_only_stats_overlay_domain`)
- Cache-Audit für Upstream-API-Calls (eigener Plan, siehe Memory `project_shared_cache_audit`)

## Architektur

### 1. HTTPS-Fix (Backend)

In `app/__init__.py` Werkzeug-ProxyFix einsetzen:

```python
from werkzeug.middleware.proxy_fix import ProxyFix
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1, x_for=1)
```

Nginx sendet bereits `X-Forwarded-Proto: https`, `X-Forwarded-Host`, `X-Forwarded-For`. Damit liefert `request.url_root` automatisch `https://stats-overlay.info/`. Keine Code-Änderung in `urls.html` oder `views_app.py` nötig.

**Sicherheits-Hinweis:** ProxyFix nur mit `x_*=1` (genau ein Proxy-Hop). Höhere Werte würden Spoofing erlauben, da wir nur einen vertrauenswürdigen nginx-Hop haben.

### 2. Layout — Desktop (≥ 1024px)

Master-Detail:

```
┌─ Header: "OBS Browser-Source URLs"  Token: abc…  N widgets ─────┐
├──────────────────┬────────────────────────────────────────────────┤
│ MASTER (320px)   │ DETAIL (flex-1)                                │
│ sticky-top       │                                                │
│                  │  ┌─ Widget-Header ─────────────────────────┐  │
│ 🔍 Filter…       │  │ ⓘ PUBG · Live  ·  widgets/pubg/...     │  │
│                  │  │ Top Vehicle Hunters                      │  │
│ ▾ PUBG · Live    │  │ Descriptive subtitle…                    │  │
│   • Hunters ●    │  └──────────────────────────────────────────┘ │
│   • Match Detail │                                                │
│ ▾ PUBG · Mates   │  ┌─ URL ─────────────────────────────────────┐│
│   • Top Mates    │  │ https://stats-overlay.info/s/…/widgets/…  ││
│ ▾ Alerts         │  │                                            ││
│   • Follower     │  │  [📋 Copy URL]   [↗ Open Preview]         ││
│ …                │  └────────────────────────────────────────────┘│
│                  │                                                │
│                  │  ── Configure ──                              │
│                  │  Range:    (•Session) ( 7 days) ( DB)         │
│                  │  Sort by:  (•dealt) ( taken) ( ratio)         │
│                  │  Max rows: [10]  presets: 5 10 15 20          │
└──────────────────┴────────────────────────────────────────────────┘
```

**Master:**
- 320px breit, sticky-top unter der Top-Nav.
- Collapsible Kategorien (`<details>`-Elemente), default offen.
- Aktiver Eintrag: brand-gold Text + linker Border-Indikator (●), `aria-current="page"`.
- Hover: subtiler bg-tint.
- Filter-Feld oben: live filter über Widget-Label + Path, expandiert alle Kategorien automatisch bei aktiver Suche, leert Suche → Kategorien wie vorher.
- Tastatur: ↑/↓ navigiert durch Widgets, Enter selektiert.

**Detail:**
- Sticky-Top: Widget-Header (Kategorie-Tag + Titel + Pfad) + URL-Card.
- URL-Card hat volle Breite, URL in `font-family: ui-monospace`, `word-break: break-all` (kein truncate — User soll die volle URL sehen).
- Buttons: `[📋 Copy URL]` ist **primary** (brand-gold bg, dark text, ≥ 44×44px, Icon + Label). `[↗ Open Preview]` ist **secondary** (outline brand-purple, gleiche Größe).
- Konfigurations-Sektion darunter, mit `<h2>Configure</h2>`-Heading.
- URL aktualisiert sich live bei jedem Switch-Click (bestehende `buildUrl()`-Logik bleibt).

### 3. Layout — Mobile (< 768px)

Stack-Pattern:

- **State A — List-View:** Master-Liste fullwidth, Detail-View ausgeblendet.
- **State B — Detail-View:** Tap auf Widget zeigt Detail-View fullwidth mit `[← Back to list]`-Button oben, Master ausgeblendet.
- URL-Card sticky-top im Detail-View, sodass Copy-Button immer erreichbar bleibt auch beim Scroll durch Switches.
- Back-Button restored Focus auf das vorher gewählte Widget in der Liste.
- Geschichts-State: optional via `history.pushState` damit Browser-Back funktioniert. (Nice-to-have, kein Blocker.)

### 4. Tablet (768–1023px)

Detail-View ist wie Desktop, Master kollabiert in Mobile-Stack-Pattern. (Vermeidet zu schmales Master.)

### 5. WCAG 2.2 AA — konkrete Anforderungen

- **Skip-Link:** bereits in `base.html`, bleibt.
- **Touch-Targets:** alle interaktiven Elemente ≥ 44×44px (Switch-Pills aktuell ~24px → heben).
- **Focus-Indicator:** sichtbar mit 3:1 Kontrast (`focus-visible:outline 2px solid var(--brand-gold); outline-offset:2px`).
- **`aria-pressed`** auf select/multiselect Switch-Buttons (toggle-state für Screenreader).
- **`aria-current="page"`** auf aktivem Master-Eintrag.
- **`aria-live="polite"`-Region** für Copy-Feedback: `<span class="sr-only" id="copyStatus">` wird mit „URL kopiert" befüllt.
- **`role="navigation"`** + `aria-label="Widget list"` auf Master.
- **`prefers-reduced-motion`:** Master→Detail-Transition auf Mobile respektiert das.
- **Zoom:** keine `user-scalable=no` (bereits ok in base.html).

### 6. Button-Hierarchie (visuelles Gewicht)

| Element | Style | Größe |
|---|---|---|
| **Copy URL** | brand-gold bg, dark text, copy-icon + Label | ≥ 44px high, padding 12px 20px |
| **Open Preview** | outline brand-purple, gold-on-hover | ≥ 44px high, padding 12px 20px |
| Switch-Pill (Range/Sort) | bisheriger `.sw-btn`-Style, aktiv = brand-purple | min 32px high (von 24 hoch) |
| Numeric-Input + Preset | numeric input + kleinere preset-pills | input min 36px |
| Filter | `<input type=search>`, brand-purple focus-ring | min 40px high |

## Datenfluss

Unverändert:

1. `urls_page()` in `views_app.py` lädt Token aus DB + Widget-Catalog aus `widget_catalog.get(...)`.
2. Übergibt `widgets=[(cat, label, desc, path, switches), ...]` und `base_url` an Template.
3. Template gruppiert Widgets nach Kategorie für die Master-Liste.
4. Client-JS `buildUrl(block)` setzt URL aus den selected Switches zusammen (bestehende Logik).

## Dateien

| Datei | Änderung |
|---|---|
| `app/__init__.py` | ProxyFix middleware einbinden (3-4 Zeilen) |
| `app/templates/urls.html` | Komplett-Rewrite: Master-Detail layout |
| `app/static/dashboard.css` | Neue Sektion: `.url-master`, `.url-detail`, `.url-card-primary`, Mobile-Stack via `@media (max-width: 767px)`, Tablet-Variante |
| `app/views_app.py` | Keine Änderung — `base_url` wird automatisch korrekt durch ProxyFix |

## Komponenten-Verträge

**Master-Item:**
- Input: `{ id, label, path, category }` + selected-state
- Output: emit `widget:select(id)` bei Click/Enter
- Verantwortung: rendert Listen-Eintrag, hält keinen State

**Detail-Panel:**
- Input: aktuell ausgewähltes Widget-Objekt (label, path, desc, switches, baseUrl)
- Output: nichts (autark)
- Verantwortung: rendert Header + URL-Card + Configure-Section, rebuild URL bei Switch-Change

**URL-Card:**
- Input: live-URL string
- Output: emit `url:copy` (auf Click), `url:preview` (auf Click)
- Verantwortung: zeigt URL, kopiert in Clipboard, öffnet Preview-Tab

**Filter-Input:**
- Input: search query
- Output: emit `filter:change(query)`
- Verantwortung: blendet Master-Items aus die nicht matchen, expandiert alle Kategorien bei aktivem Filter

## Error Handling

- **Kein Token:** weiterhin die existierende `<div class="card">No token found</div>` Variante, Master-Detail wird gar nicht gerendert.
- **Clipboard-API fehlgeschlagen:** Fallback `<textarea>+execCommand("copy")`, `aria-live` meldet „Kopieren fehlgeschlagen, URL bitte manuell markieren".
- **Filter findet nichts:** Master zeigt `<div class="empty">Kein Widget gefunden</div>`.
- **Switch hat invaliden Wert (z.B. number out of range):** input behält Wert, URL-Builder kappt auf min/max. Kein Block.

## Testing

Manuelle Smoke-Tests im Browser (Frontend hat keine Test-Infrastruktur, vanilla JS):

1. **Desktop ≥ 1024px:** Master sticky, Auswahl wechselt Detail. Filter funktioniert. Copy-Button kopiert (Clipboard-API verfügbar in localhost+https).
2. **Tablet 768–1023px:** Detail wie Desktop, Master in Stack-Mode auf Mobile.
3. **Mobile < 768px:** List ↔ Detail toggelt, Back-Button restored focus, URL-Card sticky.
4. **Tastatur-Navigation:** Tab durchgeht Master → Detail → URL-Card → Switches. Focus sichtbar.
5. **Screenreader-Test (mind. VoiceOver oder NVDA):** `aria-current` und `aria-live` Copy-Feedback funktioniert.
6. **HTTPS:** nach Deploy einmal `curl -s https://stats-overlay.info/app/urls | grep base_url` — sollte `https://` zeigen.
7. **ProxyFix-Regression:** Login-Flow weiterhin funktional (OAuth-Redirect-URL ist absolut, sollte nicht betroffen sein, aber prüfen).

## Risiken

- **ProxyFix-Misskonfiguration:** falsche `x_*`-Counts könnten Header-Spoofing erlauben. Mitigation: streng `x_proto=1, x_host=1, x_for=1`, da exakt ein nginx-Proxy.
- **Mobile-Stack-State:** wenn User Browser-Back drückt ohne pushState, landet er auf vorheriger Seite statt zurück zur Liste. Akzeptabel als V1 — pushState als Folge-Iteration.
- **Bestehende Tabs (`url-tabs`):** werden komplett ersetzt durch die Master-Liste. Deep-Link via `#tab=N` aus dem alten Code entfällt; ggf. via `#widget=<path>` ersetzen für Tab-Sharing (Nice-to-have).

## Migration / Backout

- Kein Daten-Migration nötig (rein Frontend + ein Middleware-Add).
- Backout: Revert beide Commits (ProxyFix-Commit + urls-Rewrite-Commit). Keine DB-Migration.
