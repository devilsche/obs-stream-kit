# Theme-System — Architektur (Konzept, NOCH NICHT gebaut)

Status 2026-06-03: abgestimmtes Konzept, wartet auf finales „go" vor Implementierung.
Ziel: Alle Browser-Sources (Widgets, Overlays, Tools) sollen einheitlich gebaut und
voll themebar sein — ein Theme gestaltet alles um, auch komplett anders.

## 1. Theme-Modell
- **6 Themes**: Entry (aktuell, Purple/Gold) · Terminal · Midnight · Editorial · Aurora · Swiss.
  (Mockup-Referenzen: `docs/design-proposals/*.html`.)
- **Ein Theme pro Tenant**, in **Settings** gewählt, in der DB gespeichert.
- Der Server **injiziert** das gewählte Theme beim Ausliefern *jeder* Source
  (analog zur bestehenden `__TWITCH_CHANNEL__`-Injection in `webcore/serving.py`).
  Kein URL-Param, kein pro-Source-Mischen.

## 2. Token-Schnittstelle (~19 CSS-Custom-Properties, `--theme-*`)
Alle Sources nutzen NUR diese. Jedes Theme-File füllt die Werte.
```
Akzent   --theme-primary  --theme-accent  --theme-accent-2
Flächen  --theme-bg  --theme-surface  --theme-surface-2  --theme-border
Text     --theme-text  --theme-text-dim  --theme-text-faint
Status   --theme-ok  --theme-warn  --theme-danger     (pro Theme eigene Werte)
Typo     --theme-font-display  --theme-font-body  --theme-font-mono
Form     --theme-radius  --theme-border-width  --theme-shadow
```
- **Spacing/Größen sind NICHT themebar** (fix) — sonst brechen Widget-Layouts je Theme.
- Beispielwerte (zeigt Spannweite): Entry primary `#5e2a79`/accent `#f2b705`/radius `8px`;
  Terminal `#22e0d6`/`#ff4d8d`/`4px`; Swiss `#1f3aff`/`#1f3aff`/`0`, border-width `3px`.

## 3. Komponenten-Ansatz: Stufe B — CSS-Klassen-Bausteine
Entscheidung: **CSS-Klassen-Bausteine, KEINE gekapselten JS/Web-Components.**
Begründung: Projekt ist „vanilla, kein Build-Tool, kein Framework" (CLAUDE.md);
OBS-Sources sind einzeln geladene statische Seiten → leichtgewichtig ist Vorteil;
Daten-/Poll-Logik existiert schon in `widgets/pubg/_pubg.js`.

Ein Widget = **Komposition aus Bausteinen + Daten**, KEIN eigenes Styling mehr.
Gleiches Widget-HTML in jedem Theme → ein Theme-Wechsel = anderer Look (auch komplett).

## 4. Baustein-Inventar (~15, Vorschlag — in Klärung)
Theme-agnostische CSS-Klassen (`t-*`). Dashboard, Tools UND Widgets teilen sich
DIESELBE Bibliothek → ein Theme stylt alles einheitlich.

**Anzeige (Widgets/Overlays):**
| Baustein | Zweck | Struktur |
|---|---|---|
| `t-card` | Panel/Container | + Theme-Deko (Grid/Glas/Eck-Marker je Theme) |
| `t-header` | Widget-Kopf | `.t-title` + optional `.t-range`/`.t-sub` |
| `t-stat` | große Zahl + Label | `.t-value` + `.t-label` |
| `t-stat-grid` | mehrere t-stat nebeneinander | Layout (fix spacing) |
| `t-row` | Listenzeile | optional `.t-rank` + `.t-row-name`(+`.t-row-sub`) + `.t-row-value` |
| `t-list` | Container für t-rows | Trennlinien |
| `t-badge` | Tag/Status-Chip | — |
| `t-led` | Status-Punkt | Farbe via ok/warn/danger |
| `t-bar` | Fortschritt/Goal-Balken | `.t-bar` > `.t-bar-fill` |
| `t-divider` | Trennlinie | — |
| `t-icon` | Waffen-/Map-/Achievement-Icon | — |
| `t-frame` | dekorativer Rahmen (Webcam, Bild) — ohne Karten-BG | — |
| `t-hot` | **Modifier** auf t-stat/t-row: hebt Besonderes hervor (Glow/Schimmer/invertiert je Theme) | bestehendes `.pubg-hot`/`.pubg-fire` verallgemeinern |

**Bedienung (Tools/Settings/Dashboard):**
| Baustein | Zweck |
|---|---|
| `t-button` | Aktion (primär/ghost) |
| `t-input` / `t-field` | Eingabefeld + Label |
| `t-seg` | Segmented Control (Session/Week/All) |
| `t-tab` | Tab-Leiste (URL-Sub-Tabs) |

Beispiel-Komposition (Career Card):
```
t-card > t-header(t-title "Career" + t-range "Session")
       + t-stat-grid( t-stat(12.4 / K/D)  t-stat(312 / Matches)  t-stat(9 / Wins) )
```

## 5. Theme-File-Schema
Jedes Theme = **eine CSS-Datei**, die liefert:
1. die Token-Werte (`:root{ --theme-*: ... }`)
2. CSS-Regeln für jeden `t-*`-Baustein (Aussehen)
3. Ebene-2-Eigenheiten (z.B. `body::before` Grid/Gradient-Mesh, Glow, Eck-Marker)
→ 6 Themes = 6 Dateien, jede stylt dieselben ~10 Bausteine.

## 6. Parameter-System (3 Schichten)
Löst das „alle haben gleiche + viele eigene"-Chaos durch klare Zuordnung.

- **Schicht 1 — Universell (automatisch):** `scale` · `theme` · `dock`. Vom gemeinsamen
  `_base.js` automatisch gelesen/angewendet; Widget deklariert sie NICHT. (`theme` ist server-injiziert.)
- **Schicht 2 — Standard-Katalog (einmal definiert, überall gleich):** `range` · `limit` ·
  `pollMs` · `player` · `sortBy` · `mode` · `header` · `filter`. Zentral in `_base.js` als
  `PARAMS.*` (Label/Typ/Optionen/Default) definiert; Widgets **referenzieren** sie statt sie
  neu zu schreiben → keine Abweichungen.
- **Schicht 3 — Widget-eigen:** `minKills` · `type` · `goal` · … nur echte Sonderfälle, inline.

```js
WidgetBase.buildFilter([
  PARAMS.range, PARAMS.limit,                                   // Schicht 2 (Katalog)
  { key:"minKills", label:"Min kills", type:"range", min:0, max:30, default:0 }  // Schicht 3
]);  // Schicht 1 (scale/theme/dock) ist automatisch da
```

## 7. Migration (schrittweise, KEIN big-bang)
Schlüssel: **Alias-Layer**, damit nichts auf einmal umfällt.
1. **Fundament** (kein Widget anfassen): `_theme.css` (Tokens + `t-*`-Bausteine), 6 Theme-Dateien,
   `_base.js` (Parameter-Katalog + universelle Logik + Theme-Hook).
2. **Alias-Layer** — alte Variablen auf neue mappen:
   ```css
   --pubg-purple: var(--theme-primary);  --pubg-gold: var(--theme-accent);
   --color-purple: var(--theme-primary); /* … */
   ```
   → schlagartig sind ALLE bestehenden Sources theme-kompatibel (Farb-/Font-Ebene),
   OHNE ein Widget umzubauen. Theme-Umschalten funktioniert ab hier überall.
3. **Dann schrittweise pro Gruppe** auf echte `t-*`-Bausteine (für Ebene-2-Look, jederzeit pausierbar):
   PUBG-Widgets (am nächsten dran, `.pubg-card`/`.pubg-stat-*` ≈ `t-*`) → Overlays (`--color-*`)
   → einfache Widgets (latest-*/tipgoal/logo/welcome/webcam, ~57 hardcodierte Farben, meiste Arbeit)
   → Tools + Dashboard (Bedien-Bausteine). Nichts ist je „halb kaputt".

## Verwandtes, aber GETRENNTES Feature: Highlight-Erkennung
Der Baustein `t-hot` ist nur die **Anzeige**. *Wann* etwas „hot"/besonders ist
(Longshot >400m, neuer Rekord, 10+ Kills, Chicken Dinner, …) ist **Daten-/Backend-Logik**
(Aggregation), kein Theme-Thema. Eigenes Feature — gehört zum Umfeld der schon notierten
Achievement-/Milestone-Ideen ([[project_pubg_achievement_tiers]], [[project_pubg_burning_hell_milestone]]).
Blockiert das Theme-System NICHT; das Theme liefert nur `t-hot`, die Regeln kommen separat.

## Offene Punkte (für die Bau-Session)
- Theme-Auswahl-UI in Settings (Vorschau-Kacheln, vgl. `docs/design-proposals/index.html`).
- DB: wo wird das gewählte Theme gespeichert (Spalte in `tenant_credentials` o.ä.).
- Konkrete `t-*`-Markup-/Klassen-Definitionen + `_theme.css`-Grundgerüst beim Bau festlegen.

Verwandt: [[project_design_proposals_keep]], [[project_dashboard_redesign]].
