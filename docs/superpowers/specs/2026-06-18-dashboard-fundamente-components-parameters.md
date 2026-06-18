# Dashboard-Fundamente — Komponenten-System + Parameter-Modell

**Stand:** 2026-06-18 · **Status:** abgestimmt, bereit für Plan(e).
**Übergeordnet:** `docs/superpowers/specs/2026-06-18-dashboard-structure-decisions.md` (Sub-Projekte 2+3).

Zwei Quer-Standards, die alle Domains (PUBG/Steam/G1R/Stream) teilen. Beide hängen über die
URL-Detailseite zusammen (sie nutzt Komponenten **und** rendert aus dem Parameter-Schema),
deshalb ein gemeinsames Spec. **Bau in zwei Plänen:** erst Komponenten (2), dann Parameter (3).

Leitprinzip: jede Komponente und jedes Parameter-Schema **einmal** definieren, dann nur noch
wiederverwenden. Kein domain-lokaler Eigenbau.

---

## Teil A — Komponenten-System (Sub-Projekt 2)

**Heimat:** `widgets/_blocks.css` (`t-*`-Bausteine) + `widgets/_theme.css` (`--theme-*`-Tokens).
Beide werden NACH `_theme.css` geladen; Tokens liefern Farbe/Form/Typo je Theme.

**Bestehendes Vokabular (bestätigt, bleibt):**
`t-card` (Rahmen + Ornament via `::before`) · `t-header` · `t-range` · `t-stat`/`t-stat-grid`
(`--cols3`/`--cols4`/`--compact`)/`t-value`/`t-label` · `t-hot`(`--1/2/3`)/`t-hot-mark` ·
`t-launch` · `t-gauge`.

**Neue Bausteine (benennen + bauen — decken heutigen Eigenbau ab):**
- `t-bar` — horizontale Live-Leiste (G1R-Livebar, PUBG-live-bar): flex-Reihe, kompakte Höhe.
- `t-ticker` — Marquee mit Rand-Fade (`mask-image`) + `prefers-reduced-motion`-Stop (G1R/PUBG-News).
- `t-kv` / `t-row` — Key-Value-Zeile (Label links, Wert rechts) für dichte Detail-Karten (G1R-Career).
- `t-chip` — kleine Wert-Plakette (Resistenz-Chips u.ä.).
- `t-crest` — Badge für Icon/Gilden-Wappen (Material-Symbol, theme-Akzent).
- `t-card--accent` — Modifier: Akzent-Kante links (statt hartkodiertem `border-left`).
- `t-flyin` — Einflug-Animation (Alerts), `prefers-reduced-motion`-fest.

**Regeln:**
- Neue Sources komponieren NUR aus diesem Set. Fehlt ein Baustein → **einmal hier** ergänzen,
  nicht lokal nachbauen. Keine Inline-Styles (bestehende Regel). Werte je Element über Tokens/
  `data-*`/`:nth-child`, nicht hartkodiert.
- Token-Fix: `--theme-frame-corner-` (abgeschnittener/fehlerhafter Token in `_theme.css`) bereinigen.

**Component-Preview-Seite** (`tools/component-preview.html` o.ä.): zeigt jeden Baustein in jedem
Theme — Referenz beim Bauen + visuelle Abnahme. Kein OBS-Output (Tool-Tab, Global-Cluster).

**Migration (in dieser Reihenfolge):** Eigenbau-G1R-Widgets zuerst — `widgets/g1r/career-card.html`
(KV-Zeilen→`t-kv`, Chips→`t-chip`, Crest→`t-crest`, Akzent→`t-card--accent`, **kein** `border-left`),
`livebar.html` (→`t-bar`), `news-ticker.html` (→`t-ticker`); danach Alerts (→`t-flyin`).

**Tests:** kein JS-Test-Framework im Frontend → Abnahme über die Component-Preview-Seite
(headless-Screenshot je Theme) + Smoke, dass migrierte Widgets unverändert rendern.

---

## Teil B — Parameter-Modell (Sub-Projekt 3)

**Schema je Source (deklarativ, eine Quelle der Wahrheit):**
Liste von Feldern `{key, label, type, group, default, help?, options?, min?, max?, step?}`,
`type ∈ {text, select, number, bool, color}`. `group` bündelt Felder auf der Detailseite.

**Wo es lebt — JSON-Insel im Widget-HTML:**
```html
<script type="application/json" id="params">
[ {"key":"port","label":"Proxy-Port","type":"text","group":"Verbindung","default":"9210"},
  {"key":"scope","label":"Scope","type":"select","group":"Anzeige","default":"all",
   "options":[["session","Session"],["all","All"]]} ]
</script>
```
- Co-located mit dem Widget (ein Ort pro Widget). Echtes JSON → **kein** Regex-über-JS.
- Das Widget-JS liest die Insel (Defaults setzen, ggf. rendern). Der **Server** parst dieselbe
  Insel (HTML laden → `<script type="application/json" id="params">`-Block extrahieren → `json.load`).

**Geteilter Frontend-Helfer `widgets/_params.js`:**
- `readParams()` — liest+parst die Insel.
- `applyDefaults(params)` — füllt fehlende URL-Parameter mit Defaults.
- (Nicht-OBS/Detailseite) optionaler Renderer; in OBS nur Defaults/Werte ziehen.
- Einmal geschrieben, von allen Widgets genutzt.

**Server-Seite (`app/widget_catalog.py`):**
- Neue Funktion liest die JSON-Insel je Source (ersetzt das heutige `buildFilter`-Regex-Parsing).
- Die URL-Detailseite rendert daraus **uniform** das Formular (gruppiert), baut die Live-URL live
  (Kopieren/„In OBS"), zeigt Defaults. Gleiches Rendering für alle Domains.

**Migration:** PUBG-`buildFilter([...])` → JSON-Insel (Inhalt 1:1 übertragbar). G1R/Steam/Alerts
bekommen Inseln (heute rohe URLSearchParams). Übergang: Server kann `buildFilter` weiter lesen,
bis eine Source migriert ist.

**Tests (Python, pytest):** Insel-Extraktion aus HTML (gültiges/fehlendes/kaputtes JSON),
Schema-Normalisierung, URL-Bau aus Schema+Werten.

---

## Reihenfolge + Abgrenzung
1. **Plan 1 — Komponenten:** Vokabular ergänzen, Preview-Seite, G1R-Widgets + Alerts migrieren.
2. **Plan 2 — Parameter:** `_params.js` + JSON-Inseln + Server-Insel-Reader + Detailseiten-Render,
   Sources migrieren.
- **Nicht hier:** die domain-first IA-Shell selbst (Sub-Projekt 1) und das Milestone-Subsystem
  (Sub-Projekt 4) — bauen auf diesen Fundamenten auf, eigene Specs.
- `steamName` der G1R-Career kommt serverseitig aus der Steam-Summary (Sub-2 des G1R-DB-Domains),
  nicht aus einem Parameter — hier nur erwähnt, nicht Teil dieses Specs.
