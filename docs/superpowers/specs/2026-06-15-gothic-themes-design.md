# Gothic / Mittelalter-Themes — Design-Spec

**Datum:** 2026-06-15
**Ziel:** Drei neue auswählbare Themes im Stil des Spiels *Gothic* (mittelalterliche
Dark-Fantasy), jeweils an einem der ikonischen Lager orientiert. Über die reinen
Farb-Tokens hinaus: themenspezifische Schriften, Form (Eckigkeit/Rahmen),
Hintergrund-Glow **und** echte Ornamente (verzierte Rahmen-Ecken + Textur-Overlay).

## Scope

- **In Scope (Phase 1):**
  - 3 vollständige Theme-Token-Sätze in `widgets/_theme.css`
  - Gothic-Fonts in den zentralen `@import` aufnehmen
  - 2 neue Ornament-Tokens (`--theme-frame`, `--theme-texture`) + `none`-Defaults
    für alle bestehenden Themes (null Regression)
  - Ornament-Assets (SVG-Eckbeschläge als `border-image`, Textur-Overlays)
  - **Live-Vorschau-Seite** `tools/theme-preview.html`, die alle drei Themes auf
    repräsentativen Beispiel-Komponenten zeigt (Card, Tabelle, Buttons, Badges,
    Alert-Box) inkl. Ornamente, mit Theme-Switcher
- **Phase 2 (separat, nach Beurteilung der Vorschau):** system-weiter Rollout der
  Ornamente auf die echten Widget-Container. Begründung: `border-image` braucht
  konsistente CSS-Hooks pro Widget-Container — die Klassennamen variieren. Die
  Farb/Font/Form-Tokens wirken dagegen sofort über den bestehenden Alias-Layer.
- **Out of Scope:** Änderungen am Theme-Switch-Backend (Server-Injektion existiert),
  Picker-UI.

## Die drei Themes

Alle Paletten sind auf WCAG-Kontrast geprüft (Body-`text` auf `bg`/`surface` ≥ 4.5:1).

### 1 · `oldcamp` — „Altes Lager" (Erzbarone)
Warm, Leder, Bronze, Fackelfeuer.
```
--theme-primary:#b9762f; --theme-accent:#e0a93e; --theme-accent-2:#8a5a2b; --theme-on-primary:#1a1008;
--theme-bg:#130c07; --theme-surface:#1f150c; --theme-surface-2:#2a1d10; --theme-border:#6b4a24;
--theme-text:#ece0c8; --theme-text-dim:#b09a76; --theme-text-faint:#7d6b4e;
--theme-ok:#8a9a3c; --theme-warn:#e0a93e; --theme-danger:#b5302a;
--theme-font-display:"Cinzel",serif; --theme-font-body:"EB Garamond",serif; --theme-font-mono:"JetBrains Mono",monospace;
--theme-stinger-font:"Cinzel",serif;
--theme-radius:2px; --theme-border-width:2.5px; --theme-shadow:0 14px 40px rgba(0,0,0,.6);
--theme-hot-icon:"swords";
--theme-page-bg:radial-gradient(900px 600px at 50% -10%,rgba(185,118,47,.28),#130c07 60%);
--theme-frame:<oldcamp-svg>; --theme-texture:<leder-overlay>;
```

### 2 · `barrier` — „Sumpflager / Die Barriere" (Magie & Schwefel)
Mystisch, giftgrün, magischer Barriere-Glow.
```
--theme-primary:#7fc23a; --theme-accent:#b6e84a; --theme-accent-2:#4a8f5c; --theme-on-primary:#08120a;
--theme-bg:#080d0a; --theme-surface:#101a12; --theme-surface-2:#16241a; --theme-border:#3c6b3a;
--theme-text:#dfeed6; --theme-text-dim:#93ab8e; --theme-text-faint:#637a60;
--theme-ok:#7fc23a; --theme-warn:#cfe04a; --theme-danger:#d4622a;
--theme-font-display:"Cinzel",serif; --theme-font-body:"IM Fell English",serif; --theme-font-mono:"JetBrains Mono",monospace;
--theme-stinger-font:"Cinzel",serif;
--theme-radius:3px; --theme-border-width:2px; --theme-shadow:0 0 24px rgba(127,194,58,.18),0 14px 40px rgba(0,0,0,.6);
--theme-hot-icon:"local_fire_department";
--theme-page-bg:radial-gradient(1000px 700px at 70% -10%,rgba(127,194,58,.30),#080d0a 62%);
--theme-frame:<barrier-svg>; --theme-texture:<nebel-overlay>;
```

### 3 · `sect` — „Schläfer-Tempel / Sekte" (Wüste & Opferfeuer)
Obsidian, Wüstensand, Glut, archaisch-hart.
```
--theme-primary:#c2682f; --theme-accent:#e0913a; --theme-accent-2:#7a3b3b; --theme-on-primary:#160d10;
--theme-bg:#0f0a10; --theme-surface:#1b1118; --theme-surface-2:#251820; --theme-border:#6e4530;
--theme-text:#ecd9c2; --theme-text-dim:#ab917a; --theme-text-faint:#786052;
--theme-ok:#9a8a3c; --theme-warn:#e0913a; --theme-danger:#c0322a;
--theme-font-display:"Cinzel Decorative",serif; --theme-font-body:"Marcellus",serif; --theme-font-mono:"JetBrains Mono",monospace;
--theme-stinger-font:"Cinzel Decorative",serif;
--theme-radius:0px; --theme-border-width:2px; --theme-shadow:0 14px 44px rgba(0,0,0,.7);
--theme-hot-icon:"local_fire_department";
--theme-page-bg:linear-gradient(0deg,rgba(194,104,47,.22) 0%,#0f0a10 45%);
--theme-frame:<sect-svg>; --theme-texture:<stein-overlay>;
```

## Fonts

Zum bestehenden `@import` in `_theme.css` ergänzen (alle Google Fonts):
`Cinzel:wght@500;600;700`, `Cinzel+Decorative:wght@700;900`,
`EB+Garamond:ital,wght@0,400;0,500;1,400`, `IM+Fell+English:ital@0;1`,
`Marcellus`.

## Ornament-Mechanik

Zwei neue Tokens, Default `none` bei `:root` und allen bestehenden Themes:
- **`--theme-frame`** — `border-image`-Quelle: ein inline-SVG (data-URI) mit
  themenspezifischen Eck-Beschlägen (Bronze-Nieten / glühende Runen / gemeißelter
  Stein). `border-image-slice`/`-width` passend gesetzt.
- **`--theme-texture`** — dezenter Hintergrund-Overlay (data-URI-SVG-Pattern, niedrige
  Opazität): genarbtes Leder / Nebelschwaden / Stein-Maserung. Wird als zusätzlicher
  `background-image`-Layer auf Surface-Container gelegt.

In Phase 1 werden beide nur in `tools/theme-preview.html` auf die Beispiel-Container
angewendet (Demonstration). Kein Inline-`style` — alles über Klassen/Tokens.

## Vorschau-Seite `tools/theme-preview.html`

- Eigenständige HTML im `tools/`-Schema (Browser-Tab, kein OBS-Widget).
- Theme-Switcher (4 Buttons: 3 Gothic + „entry" als Referenz) setzt `data-theme`
  aufs `<html>`. Buttons als echte `<button>`, keyboard-/focus-fähig, `aria-pressed`.
- Repräsentative Komponenten, alle via `--theme-*` getokent: Career-Card, Daten-Tabelle,
  Primär-/Sekundär-Buttons, Badges (ok/warn/danger), Alert-Box, ein Ornament-Rahmen.
- Zeigt Farben, Schrift, Form, Glow **und** Ornamente in einem Blick.
- WCAG: `lang="de"`, semantisches Markup, sichtbare Focus-Indikatoren, keine Inline-Styles.

## Tests / Verifikation

- Frontend-only, keine Test-Infrastruktur → manueller Smoke-Test im Browser.
- WCAG-Kontrast der Paletten vor dem Commit gegenrechnen.
- Bestehende Themes unverändert (Default-`none` für neue Tokens → null Regression).
```
