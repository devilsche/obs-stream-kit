# Welcome-Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Baue ein kompaktes Celebration-Widget (`widgets/welcome.html`) für Erstbesucher im Chat, das sich visuell klar von `latest-follower.html` abhebt, den bestehenden `SparkleEngine` nutzt und einen einmaligen Pop-Burst beim Laden zeigt — ohne dass Partikel jemals sichtbar über den Rand fliegen.

**Architecture:** Eine einzelne HTML-Datei nach dem etablierten Muster (siehe `widgets/latest-follower.html`): inline CSS und JS, `SparkleEngine` aus `js/sparkles.js`, kein Build-Schritt. Pop-Burst als eigene, im Widget eingebettete JS-Routine mit winkelbasiertem Distanz-Cap.

**Tech Stack:** Vanilla HTML/CSS/JS, `SparkleEngine` (`js/sparkles.js`), DM Sans (`assets/DM-Sans.woff2`).

**Reference Spec:** `docs/superpowers/specs/2026-04-18-welcome-widget-design.md`

**Verification approach:** Dieses Projekt hat kein Unit-Test-Framework. Alle Widgets werden **visuell im Browser** verifiziert. Jeder Task endet mit einem konkreten Check-im-Browser-Schritt.

---

## File Structure

| Datei | Zweck | Status |
|-------|-------|--------|
| `widgets/welcome.html` | Das Widget selbst (Layout, Sparkles, Pop-Burst) | neu |
| `README.md` | Dokumentation des neuen Widgets | modifiziert |
| `js/sparkles.js` | Bestehende Sparkle-Engine — **unverändert** | — |

Nur `widgets/welcome.html` und `README.md` werden berührt.

---

## Task 1: Widget-Skeleton (Layout + URL-Param)

**Files:**
- Create: `widgets/welcome.html`

Ziel: Grundgerüst mit Layout, Typografie, Badge und URL-Parameter. Noch ohne Sparkles und Pop-Burst. Danach ist das Widget statisch sichtbar und der Name-Param funktioniert.

- [ ] **Step 1: Erstelle `widgets/welcome.html` mit Layout-Skelett**

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=600, height=140" />
  <title>Welcome</title>
  <style>
    @font-face {
      font-family: 'DM Sans';
      src: url('../assets/DM-Sans.woff2') format('woff2');
      font-weight: 100 900;
      font-style: normal;
      font-display: block;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      width: 600px;
      height: 140px;
      overflow: hidden;
      background: transparent;
      font-family: 'DM Sans', sans-serif;
    }

    .content {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 18px 20px;
    }

    .kicker {
      font-size: 16px;
      font-weight: 700;
      color: #f2b705;
      letter-spacing: 6px;
      text-transform: uppercase;
      text-shadow:
        0 0 10px rgba(242, 183, 5, 0.8),
        0 0 20px rgba(242, 183, 5, 0.4);
      margin-bottom: 8px;
    }

    .name {
      font-size: 44px;
      font-weight: 900;
      color: #ffffff;
      line-height: 1;
      max-width: 520px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-shadow:
        0 0 20px rgba(255, 255, 255, 0.6),
        0 0 50px rgba(94, 42, 121, 0.9),
        0 0 80px rgba(155, 85, 192, 0.4);
    }

    .divider {
      width: 120px;
      height: 2px;
      margin-top: 10px;
      background: linear-gradient(90deg, transparent, #f2b705, transparent);
    }

    .badge {
      position: absolute;
      top: 12px;
      right: 14px;
      z-index: 3;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      color: #c9a0dc;
      padding: 4px 10px;
      border: 1px solid #5e2a79;
      border-radius: 4px;
      background: rgba(94, 42, 121, 0.15);
      transform: rotate(-8deg);
      text-shadow: 0 0 6px rgba(155, 85, 192, 0.6);
      text-transform: uppercase;
    }
  </style>
</head>
<body>

  <div class="badge">First Time</div>

  <div class="content">
    <div class="kicker">&#10022; Willkommen &#10022;</div>
    <div class="name" id="name">NewViewer42</div>
    <div class="divider"></div>
  </div>

  <script>
    (function () {
      'use strict';
      var params = new URLSearchParams(window.location.search);
      var name = params.get('name') || 'NewViewer42';
      document.getElementById('name').textContent = name;
    })();
  </script>

</body>
</html>
```

- [ ] **Step 2: Im Browser öffnen und visuell prüfen**

Öffne `widgets/welcome.html` direkt im Browser (File-URL).

Erwartung:
- Widget sichtbar auf 600×140 Fläche, transparenter Hintergrund
- Kicker oben: `✦ WILLKOMMEN ✦` in Gold
- Name mittig: `NewViewer42` in weiß, großer Schrift
- Gold-Divider unter dem Namen
- Badge oben rechts: `FIRST TIME` in Lila, leicht schräg
- Kein Overflow, kein Scrollbar

- [ ] **Step 3: URL-Parameter testen**

Öffne `widgets/welcome.html?name=TestUser42`.

Erwartung: Anzeigename wechselt zu `TestUser42`.

Öffne `widgets/welcome.html?name=DiesIstEinSehrLangerBenutzernameZumTesten`.

Erwartung: Name wird via `text-overflow: ellipsis` gekürzt, kein Zeilenumbruch.

- [ ] **Step 4: Commit**

```bash
git add widgets/welcome.html
git commit -m "feat(welcome): Widget-Skeleton mit Layout und URL-Parameter"
```

---

## Task 2: Sparkle-Engine integrieren

**Files:**
- Modify: `widgets/welcome.html`

Ziel: Dauerhafte Sparkles im Hintergrund, gemischte Farben (Gold/Purple/White), mit Edge-Fade aus `SparkleEngine`. Nach diesem Task sind Sparkles sichtbar, bleiben im Canvas, verlassen nie sichtbar den Rand.

- [ ] **Step 1: Sparkle-Container im HTML einfügen**

Direkt **vor** dem `.content`-Div einfügen (so liegen Sparkles optisch hinter dem Text):

```html
  <div id="sparkle-container" style="position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;"></div>
```

- [ ] **Step 2: Sparkle-Engine einbinden**

Direkt **vor** dem schließenden `</body>` einfügen (nach dem bestehenden `<script>`-Block mit URL-Param):

```html
  <script src="../js/sparkles.js"></script>
  <script>
    (function () {
      'use strict';
      new SparkleEngine(document.getElementById('sparkle-container'), {
        count: 14,
        speed: 0.4,
        maxOpacity: 1.0,
        colors: { gold: 0.4, purple: 0.4, white: 0.2 },
        sizeWeights: { big: 0.15, normal: 0.35, small: 0.35, tiny: 0.15 }
      }).start();
    })();
  </script>
```

- [ ] **Step 3: Visuell im Browser prüfen**

Reload `widgets/welcome.html`.

Erwartung:
- 14 Sparkles bewegen sich langsam über den Canvas
- Farben: Mix aus Gold, Lila, Weiß (sichtbar)
- Sparkles nähern sich den Rändern, **blenden weich aus** (kein hartes Poppen)
- Keine Sparkle schießt sichtbar über den Rand hinaus

Speziell prüfen (Blick 20s lang):
- Horizontaler Rand (links/rechts): Sparkles werden leiser, kehren um → ✓
- Vertikaler Rand (oben/unten): Gleiches Verhalten → ✓

- [ ] **Step 4: Commit**

```bash
git add widgets/welcome.html
git commit -m "feat(welcome): Sparkle-Engine mit gemischtem Gold/Purple/White Mix"
```

---

## Task 3: Pop-Burst beim Laden (edge-safe)

**Files:**
- Modify: `widgets/welcome.html`

Ziel: Einmaliger Partikel-Burst beim Widget-Start mit 12 Partikeln, die aus der Canvas-Mitte ausbrechen. Distanz pro Partikel wird winkelbasiert gekappt, sodass Endposition ≥40px vom Rand entfernt bleibt. Opacity-Keyframe endet auf 0 → kein hartes Clip am Rand.

- [ ] **Step 1: Burst-Container im HTML einfügen**

Direkt **nach** dem `#sparkle-container`-Div und **vor** `.content`:

```html
  <div id="burst-container" style="position:absolute;inset:0;z-index:1;overflow:hidden;pointer-events:none;"></div>
```

- [ ] **Step 2: Burst-Keyframe im `<style>` ergänzen**

Im bestehenden `<style>`-Block vor dem schließenden `</style>` hinzufügen:

```css
    @keyframes burstParticle {
      0%   { transform: translate(-50%, -50%) translate(0, 0) scale(0); opacity: 0; }
      15%  { transform: translate(-50%, -50%) translate(calc(var(--tx) * 0.15), calc(var(--ty) * 0.15)) scale(1); opacity: 1; }
      50%  { transform: translate(-50%, -50%) translate(calc(var(--tx) * 0.5), calc(var(--ty) * 0.5)) scale(1); opacity: 0.8; }
      100% { transform: translate(-50%, -50%) translate(var(--tx), var(--ty)) scale(1); opacity: 0; }
    }

    .burst-particle {
      position: absolute;
      top: 50%;
      left: 50%;
      border-radius: 50%;
      animation: burstParticle 1.2s ease-out forwards;
    }
```

- [ ] **Step 3: Burst-Logik im `<script>` ergänzen**

Im bestehenden zweiten `<script>`-Block (dem mit `SparkleEngine`), **nach** der `SparkleEngine`-Initialisierung, innerhalb derselben IIFE:

```js
      /* ── Pop-Burst (einmalig beim Laden) ─────────────────── */
      var BURST_COUNT = 12;
      var CANVAS_W = 600;
      var CANVAS_H = 140;
      var EDGE_MARGIN = 40;
      var BURST_COLORS = ['#f2b705', '#f2b705', '#f2b705',
                          '#5e2a79', '#c9a0dc', '#9b55c0',
                          '#ffffff', '#ffffff'];

      var burstContainer = document.getElementById('burst-container');
      var centerX = CANVAS_W / 2;
      var centerY = CANVAS_H / 2;
      var maxDistX = centerX - EDGE_MARGIN;
      var maxDistY = centerY - EDGE_MARGIN;

      for (var i = 0; i < BURST_COUNT; i++) {
        var angle = Math.random() * Math.PI * 2;
        var desired = 150 + Math.random() * 150;
        var cosA = Math.abs(Math.cos(angle));
        var sinA = Math.abs(Math.sin(angle));
        var capX = cosA > 0.001 ? maxDistX / cosA : Infinity;
        var capY = sinA > 0.001 ? maxDistY / sinA : Infinity;
        var dist = Math.min(desired, capX, capY);
        var tx = Math.cos(angle) * dist;
        var ty = Math.sin(angle) * dist;

        var size = 8 + Math.random() * 6;
        var color = BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)];
        var delay = Math.random() * 0.15;

        var el = document.createElement('div');
        el.className = 'burst-particle';
        el.style.cssText =
          'width:' + size + 'px;' +
          'height:' + size + 'px;' +
          'background:' + color + ';' +
          'box-shadow:0 0 ' + size + 'px ' + color + ';' +
          '--tx:' + tx.toFixed(1) + 'px;' +
          '--ty:' + ty.toFixed(1) + 'px;' +
          'animation-delay:' + delay.toFixed(2) + 's;';
        burstContainer.appendChild(el);
      }
```

- [ ] **Step 4: Visuell im Browser prüfen**

Reload `widgets/welcome.html` und achte auf die ersten ~1.5 Sekunden.

Erwartung:
- 12 Partikel poppen aus Canvas-Mitte auf und fliegen nach außen
- Partikel erreichen **nie sichtbar** den Rand — sie faden aus, bevor sie die Cap-Position erreichen
- Verschiedene Farben (Gold, Purple, Weiß)
- Nach ~1.5s ist der Burst komplett verschwunden
- Sparkles laufen danach weiter (normal, ohne Burst)

**Kritischer Check:** Öffne das Widget mehrfach (F5) und beobachte speziell die **Oberkante** und **Unterkante** des Canvas. Dort ist der Cap am engsten (nur ~30px Spielraum bei rein vertikalem Flug). Partikel dürfen dort **nie** angeschnitten sichtbar sein.

- [ ] **Step 5: Reload-Test mit mehrfachem Refresh**

Drücke F5 ~10 mal hintereinander in kurzer Folge.

Erwartung: Jedes Mal korrekter Burst, keine Visual-Glitches, Partikel bleiben edge-safe.

- [ ] **Step 6: Commit**

```bash
git add widgets/welcome.html
git commit -m "feat(welcome): Pop-Burst beim Laden mit winkelbasiertem Edge-Cap"
```

---

## Task 4: README aktualisieren

**Files:**
- Modify: `README.md`

Ziel: Neuer Abschnitt für das Welcome-Widget unter der Widgets-Sektion, plus Update der Übersichtstabelle am Ende.

- [ ] **Step 1: Bestehende README-Struktur lesen**

Öffne `README.md` und finde die Widgets-Sektion. Das Welcome-Widget soll **zwischen Logo und Webcam-Rahmen** eingefügt werden (oder wahlweise nach Webcam-Rahmen, vor "Info-Widgets"). Empfohlene Position: direkt nach Webcam-Rahmen, vor "Info-Widgets".

Die Ziel-Position findest du durch die Suche nach `### Info-Widgets`.

- [ ] **Step 2: Welcome-Widget-Abschnitt einfügen**

**Direkt vor** der Zeile `### Info-Widgets` folgendes einfügen:

```markdown
### Welcome-Widget

| | |
|-|-|
| **Datei** | `widgets/welcome.html` |
| **Beschreibung** | Toast-Widget für Erstbesucher im Chat — Name + Gold-Kicker + `FIRST TIME`-Badge, Pop-Burst beim Einblenden |
| **Interner Canvas** | 600×140 |
| **OBS Browser-Source** | 600×140 (OBS skaliert proportional) |

**URL-Parameter:**

| Parameter | Default | Beschreibung |
|-----------|---------|--------------|
| `name` | `NewViewer42` | Angezeigter Username |

**OBS-Setup:**
1. Browser-Source hinzufügen → Größe **600×140**
2. Source auf **unsichtbar** stellen (Auge-Icon aus)
3. **Show Transition** einstellen: Rechtsklick → Show Transition → *Slide* oder *Fade*
4. Per Streamer.bot bei First-Chat-Event die URL setzen (`?name=%user%`) und die Source einblenden
5. Nach X Sekunden Source wieder ausblenden (OBS übernimmt die Animation)

**Beispiel:** `widgets/welcome.html?name=NeuerChatter`

```

- [ ] **Step 3: Übersichtstabelle am Ende der README aktualisieren**

In der Sektion `## Übersicht Browser-Source-Größen` die bestehende Tabelle finden. Eine neue Zeile für das Welcome-Widget einfügen — direkt unter der Zeile `| Info-Widgets | ... |`:

```markdown
| Welcome-Widget | **600×140** | Kompakt, Pop-Burst beim Einblenden |
```

- [ ] **Step 4: README im Markdown-Viewer sichten**

Öffne `README.md` in einem Markdown-Viewer (z.B. VSCode-Preview) und prüfe:
- Welcome-Abschnitt ist korrekt formatiert
- Tabellen rendern ohne Fehler
- Übersichtstabelle enthält neue Zeile

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): Welcome-Widget dokumentiert"
```

---

## Task 5: End-to-End-Verifikation

**Files:**
- Keine Änderungen — reine Verifikation

Ziel: Finaler Smoke-Test aus Nutzersicht.

- [ ] **Step 1: Widget mit verschiedenen Namen öffnen**

Öffne nacheinander:
- `widgets/welcome.html`
- `widgets/welcome.html?name=Kurz`
- `widgets/welcome.html?name=MittellangerName`
- `widgets/welcome.html?name=DiesIstEinSehrLangerBenutzernameZumTesten1234`
- `widgets/welcome.html?name=%C3%9Cml%C3%A4uts%C3%B6%C3%A4%C3%BC` (= `ÜmläutsöäÜ`)

Erwartung:
- Alle Namen werden korrekt angezeigt
- Sehr lange Namen werden mit `…` gekürzt
- Umlaute funktionieren

- [ ] **Step 2: OBS-Integration prüfen (falls OBS verfügbar)**

Falls OBS lokal installiert ist:
- Neue Browser-Source mit `widgets/welcome.html?name=TestUser`, Größe 600×140
- Source auf Canvas ziehen
- Prüfen: transparenter Hintergrund, Widget sichtbar
- Prüfen: Bei Skalierung auf 450×105 in OBS → Widget bleibt lesbar, Proportionen korrekt

Wenn OBS nicht verfügbar: Schritt überspringen und in der Abschluss-Message notieren.

- [ ] **Step 3: Regel-Check: Partikel-Rand-Regel eingehalten?**

Reload-Test 10x:
- Sparkles: Nie über Rand → ✓
- Pop-Burst: Nie über Rand → ✓

Wenn ein Problem auftritt: zurück zu Task 3, Step 4 und Cap-Math oder Opacity-Kurve justieren.

- [ ] **Step 4: Abschluss-Commit (nur falls noch offene Changes)**

Falls Git sauber ist (`git status` zeigt nichts), kein Commit nötig.

---

## Self-Review

- **Spec coverage:** Dimensionen (Task 1), Layout (Task 1), Typo (Task 1), Badge (Task 1), URL-Param (Task 1), Sparkles (Task 2), Pop-Burst mit Edge-Cap (Task 3), README (Task 4), Verifikation (Task 5). Alle Spec-Punkte abgedeckt.
- **Placeholder-Scan:** Keine TBD/TODO-Marker, jeder Step hat konkreten Code oder konkreten Verify-Schritt.
- **Type/Name consistency:** `#sparkle-container`, `#burst-container`, `.burst-particle`, CSS-Vars `--tx`/`--ty`, `burstParticle`-Keyframe — alle durchgängig gleich benannt.
- **Regel-Compliance:** Partikel-Rand-Regel ist Kern von Task 3 (Cap-Math) + Verify-Steps.
