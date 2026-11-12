/* Frühlings-Thema der Weather-Source: Blumenwiese unten (Follower-Blumen
 * mit Namen), Kirschblütenzweig in der Ecke, Blütenblätter treiben mit dem
 * Wind, Schmetterlinge, Bienen auf Befehl, Sonnenblume als gemeinsames
 * Sub-Projekt (8 Teile). Garten nach dem Server-Stand
 * (seasonLevels.water/weeds): trockene Erde und hängende Köpfe unter 30 %
 * Wasser, Unkraut wächst; Regen gießt sichtbar (Köpfe richten sich auf).
 * Spektakel: eine Windhose zerrt an den Blumen (Blütenblätter fliegen),
 * Hagel knickt ein paar um, sie richten sich nach 20–30 s wieder auf. Bei
 * Schnee lassen Blumen und Sonnenblume die Köpfe hängen.
 * Optik aus effects/spring.html. Braucht js/season-kit.js und
 * js/theme-seasons.js.
 *
 *   var theme = ThemeSpring.create(stageEl, { tags: svgGroup, hud: hudEl });
 *   theme.load(deco);  theme.update(state);  theme.command(cmd, params);
 */
(function (root) {
  'use strict';

  var PART_KEYS = ['meadow', 'branch', 'bugs'];
  var PETALS = ['#ff5d8f', '#ffd23f', '#8e6cff', '#ff8a3d', '#ffffff'];
  var MAX_FL = 24;

  function create(stage, opts) {
    var TS = root.ThemeSeasons;
    var B = TS.base(stage, opts, 'spring', PART_KEYS);
    var W = B.W, H = B.H, el = B.el, f1 = B.f1, rand = B.rand, clamp01 = B.clamp01;
    var rnd = TS.seeded(23);

    // Blütenfarben als Verlauf: am Grund kräftig, zur Spitze heller (je Blatt,
    // dreht mit); Glocken oben dunkler, Gänseblümchen mit rosa Spitzen
    ['g1', 'g2', 'g3', 'g4', 'g5', 'gdaisy', 'gbell', 'gleaf'].forEach(function (id) {
      var lg = el('linearGradient', { id: 'tsp-' + id, x1: 0, y1: id === 'gbell' ? 0 : 1, x2: 0, y2: id === 'gbell' ? 1 : 0 }, B.defs);
      el('stop', { offset: '0', 'class': 'tsp-' + id + '-0' }, lg);
      el('stop', { offset: '1', 'class': 'tsp-' + id + '-1' }, lg);
    });
    // Kirschblüte: fünf an der Spitze gekerbte Blätter, innen rosa, außen fast
    // weiß, langer Kranz Staubblätter mit gelben Beuteln; dazu Knospe und junges Blatt
    var bpg = el('radialGradient', { id: 'tsp-bpg', gradientUnits: 'userSpaceOnUse', cx: 0, cy: 0, r: 11 }, B.defs);
    el('stop', { offset: '0', 'class': 'tsp-bpg-0' }, bpg);
    el('stop', { offset: '0.4', 'class': 'tsp-bpg-1' }, bpg);
    el('stop', { offset: '1', 'class': 'tsp-bpg-2' }, bpg);
    var blossomDef = el('g', { id: 'tsp-blossom' }, B.defs);
    for (var bi = 0; bi < 5; bi++) {
      el('path', { 'class': 'tsp-bpetal', d: 'M0 0 C-5.5 -2 -7.5 -8.5 -4.2 -11.4 C-2.6 -12.6 -1 -11.8 0 -10.5 C1 -11.8 2.6 -12.6 4.2 -11.4 C7.5 -8.5 5.5 -2 0 0 Z', transform: 'rotate(' + bi * 72 + ')' }, blossomDef);
    }
    el('circle', { 'class': 'tsp-bcore', r: 2.4 }, blossomDef);
    for (bi = 0; bi < 12; bi++) {
      var sa = bi * 30 + 15, sl = 5.2 + (bi % 3) * 0.9, sxp = Math.sin(sa * Math.PI / 180) * sl, syp = -Math.cos(sa * Math.PI / 180) * sl;
      el('path', { 'class': 'tsp-stamen', d: 'M0 0 L' + sxp.toFixed(1) + ' ' + syp.toFixed(1) }, blossomDef);
      el('circle', { 'class': 'tsp-anther', cx: sxp.toFixed(1), cy: syp.toFixed(1), r: 0.9 }, blossomDef);
    }
    var budDef = el('g', { id: 'tsp-bud' }, B.defs);
    el('ellipse', { 'class': 'tsp-bud', cx: 0, cy: -4, rx: 3.2, ry: 4.6 }, budDef);
    el('path', { 'class': 'tsp-bud-cup', d: 'M-3 -1.5 Q0 1.5 3 -1.5 L2 1 Q0 2.2 -2 1 Z' }, budDef);
    var yleafDef = el('g', { id: 'tsp-yleaf' }, B.defs);
    el('path', { 'class': 'tsp-yleaf', d: 'M0 0 C4 -3 4.5 -10 0 -16 C-4.5 -10 -4 -3 0 0 Z' }, yleafDef);
    el('path', { 'class': 'tsp-yleaf-vein', d: 'M0 0 L0 -14' }, yleafDef);

    // Ebenen: Blütenblätter (Basis), Zweig, Wiese, Insekten
    var gBranch = el('g', { 'class': 'tsp-branch tsp-dim' }, B.svg());
    var gSway = el('g', {}, gBranch);
    // Sonnenblume hinter der Wiese (Halme verdecken den Fuß)
    var gSun = el('g', { 'class': 'tsp-sunflower tsp-dim' }, B.svg());
    var meadowSvg = B.svg();
    var gMeadow = el('g', { 'class': 'tsp-meadow tsp-dim' }, meadowSvg);
    // hohe Halme hinter den Blumen: die Stiele wachsen aus dem Gras
    var gBack = el('g', { 'class': 'tsp-blades tsp-blades--back' }, gMeadow);
    var gWeeds = el('g', {}, gMeadow);
    var gFlowers = el('g', {}, gMeadow);
    var grass = el('path', { 'class': 'tsp-grass' }, gMeadow);
    var grassDry = el('path', { 'class': 'tsp-grass tsp-grass--dry' }, gMeadow);
    var gBlades = el('g', { 'class': 'tsp-blades' }, gMeadow);
    // vom Tornado abgerissene Blütenköpfe fliegen vor der Wiese
    var gFlyHeads = el('g', {}, gMeadow);
    var gBugs = el('g', { 'class': 'tsp-bugs' }, B.svg());

    var bladeBands = [];
    // ── Wiese ──
    function groundY(x) { return H - 22 - 6 * Math.sin(x / 110) - 4 * Math.sin(x / 37); }
    (function () {
      var d = 'M0 ' + H;
      for (var x = 0; x <= W; x += 16) d += ' L' + x + ' ' + f1(groundY(x));
      d += ' L' + W + ' ' + H + ' Z';
      grass.setAttribute('d', d);
      grassDry.setAttribute('d', d);
      // Halme als spitz zulaufende Formen, in Horsten mit Lücken; hinten hoch
      // und dunkler, vorn kurze helle Büschel auf der Kante (kein harter
      // Horizont); Bänder je 60 px schwingen mit den Windwellen
      function bands(parent, k) {
        var list = [];
        for (var i = 0; i * 60 < W; i++) { list.push({ g: el('g', {}, parent), x: i * 60 + 30, k: k, shown: null }); bladeBands.push(list[i]); }
        return list;
      }
      var backB = bands(gBack, 1), frontB = bands(gBlades, 0.45);
      function blade(band, x, y, h, w, lean, cls) {
        el('path', { 'class': cls, d: 'M' + f1(x - w / 2) + ' ' + f1(y) + ' Q' + f1(x - w / 4 + lean * 0.35) + ' ' + f1(y - h * 0.55) + ' ' + f1(x + lean) + ' ' + f1(y - h) +
                     ' Q' + f1(x + w / 4 + lean * 0.35) + ' ' + f1(y - h * 0.55) + ' ' + f1(x + w / 2) + ' ' + f1(y) + ' Z' }, band[Math.max(0, Math.min(band.length - 1, Math.floor(x / 60)))].g);
      }
      function tufts(band, gapLo, gapHi, nLo, nHi, hLo, hHi, wLo, wHi, dy, cls) {
        for (var cx = rnd() * 20; cx < W; cx += gapLo + rnd() * (gapHi - gapLo)) {
          // in der Mitte (Lebensbalken, Munition) nur kurze Halme
          var mid = cx > 700 && cx < 1220 ? 0.4 : 1, n = nLo + Math.floor(rnd() * (nHi - nLo + 1));
          for (var k = 0; k < n; k++) {
            var bx = cx + (k - (n - 1) / 2) * (3 + rnd() * 3), y = groundY(bx) + dy;
            var fan = (k - (n - 1) / 2) / Math.max(1, n - 1);
            blade(band, bx, y, (hLo + rnd() * (hHi - hLo)) * mid, wLo + rnd() * (wHi - wLo), (fan * 14 + (rnd() - 0.5) * 8) * mid,
                  cls + ' tsp-bl' + (1 + Math.floor(rnd() * 3)));
          }
        }
      }
      tufts(backB, 22, 48, 4, 8, 22, 52, 3, 5.5, 6, 'tsp-blade tsp-blade--back');
      tufts(frontB, 10, 26, 3, 6, 7, 18, 2.5, 4.5, 9, 'tsp-blade');
      // Klee und winzige Gänseblümchen, sparsam im Gras
      for (var ci2 = 0; ci2 < 34; ci2++) {
        var kx = 20 + rnd() * (W - 40); if (kx > 720 && kx < 1200) continue;
        var ky = groundY(kx) + 10 + rnd() * 8, cg = el('g', { transform: 'translate(' + f1(kx) + ' ' + f1(ky) + ') scale(' + (0.8 + rnd() * 0.5).toFixed(2) + ')' }, frontB[Math.floor(kx / 60)].g);
        if (ci2 % 3) {
          for (var q = 0; q < 3; q++) el('circle', { 'class': 'tsp-clover', cx: f1(Math.sin(q * 2.09) * 2.6), cy: f1(-Math.cos(q * 2.09) * 2.6), r: 2.6 }, cg);
        } else {
          for (var q2 = 0; q2 < 8; q2++) el('ellipse', { 'class': 'tsp-tiny', cx: 0, cy: -2.2, rx: 0.9, ry: 2, transform: 'rotate(' + q2 * 45 + ')' }, cg);
          el('circle', { 'class': 'tsp-center', r: 1.2 }, cg);
        }
      }
    })();

    // Schnee am Boden: über der Wiese, die Grashalme schauen heraus
    B.groundSnow(gMeadow, gBlades, groundY, [[230, 120, 12]]);

    // Unkraut: 40 Büschel in fester Reihenfolge, sichtbar je nach Stand
    var weedNodes = [];
    for (var wi = 0; wi < 40; wi++) {
      // nicht in der Mitte (Spielanzeigen)
      var wx = 30 + rnd() * (W - 600); if (wx > 700) wx += 540;
      var wy = groundY(wx) + 4;
      var wOuter = el('g', { transform: 'translate(' + wx.toFixed(0) + ' ' + wy.toFixed(0) + ')' }, gWeeds);
      var wg = el('g', { 'class': 'tsp-weed' }, wOuter);
      var dd = '';
      for (var wk = 0; wk < 6; wk++) {
        var a = -Math.PI / 2 + (wk - 2.5) * 0.35, l = 30 + rnd() * 40;
        dd += 'M0 0 L' + (Math.cos(a - 0.12) * l * 0.5).toFixed(0) + ' ' + (Math.sin(a - 0.12) * l * 0.5).toFixed(0) +
              ' L' + (Math.cos(a) * l).toFixed(0) + ' ' + (Math.sin(a) * l).toFixed(0) +
              ' L' + (Math.cos(a + 0.12) * l * 0.5).toFixed(0) + ' ' + (Math.sin(a + 0.12) * l * 0.5).toFixed(0) + ' Z ';
      }
      el('path', { 'class': 'tsp-weed-leaf', d: dd }, wg);
      if (rnd() < 0.4) el('circle', { 'class': 'tsp-weed-seed', cx: 0, cy: -46, r: 6 }, wg);
      weedNodes.push({ node: wg, x: wx, y: wy, order: rnd() });
    }
    weedNodes.sort(function (p, q) { return p.order - q.order; });
    var shownWeedN = -1;
    function showWeeds(pct) {
      var n = Math.round(pct / 100 * weedNodes.length);
      if (n === shownWeedN) return;
      shownWeedN = n;
      weedNodes.forEach(function (w, i) { w.node.classList.toggle('is-on', i < n); });
    }

    // ── Blumen der Follower: 12 Plätze links und rechts, die Mitte unten
    // (Spielanzeigen) bleibt frei ──
    // in Grüppchen: 10 Horste links und rechts (frei um die Sonnenblume bei
    // x 230), je 2–3 Blumen; neue Blumen gehen reihum in die Horste
    var PATCHES = [60, 340, 460, 580, 690, 1250, 1390, 1530, 1670, 1820], SLOTS = [];
    for (var si = 0; si < MAX_FL; si++) {
      var pc = PATCHES[si % PATCHES.length], m = Math.floor(si / PATCHES.length);
      SLOTS.push(pc + [0, -26, 24][m] + (rnd() - 0.5) * 12);
    }
    var flowers = [], flNext = 0, flTotal = 0, flGen = 0;
    // Sind alle Plätze belegt, macht die älteste Platz: sie purzelt zur Kante
    // hinaus, ab und zu holt sie eine Amsel; die Neue wächst danach
    function addFlower(name, animate) {
      var i = flNext % SLOTS.length, old = flowers[i];
      flNext++;
      if (old && animate) {
        flowers[i] = null;
        var gen = flGen;
        var wait = TS.leave(old.node, { x: old.x, top: old.y, r: old.h / 2, crow: Math.random() < 0.25 });
        setTimeout(function () { if (gen === flGen && !flowers[i]) putFlower(name, i, true); }, wait);
        return;
      }
      if (old) gFlowers.removeChild(old.node);
      putFlower(name, i, animate);
    }
    // Blatt entlang -y, Fuß bei 0/0: breit in der Mitte, spitz auslaufend
    function leafPath(len, wid) {
      return 'M0 0 C' + f1(wid) + ' ' + f1(-len * 0.25) + ' ' + f1(wid * 0.8) + ' ' + f1(-len * 0.75) + ' 0 ' + f1(-len) +
             ' C' + f1(-wid * 0.8) + ' ' + f1(-len * 0.75) + ' ' + f1(-wid) + ' ' + f1(-len * 0.25) + ' 0 0 Z';
    }
    // je Sorte [Höhe am Stiel 0..1, Winkel, Länge, Breite]; Tulpe mit breiten
    // Grundblättern, Gänseblümchen als Rosette, Sonnenblume herzförmig breit
    var LEAVES = [
      [[0.3, -55, 20, 4], [0.55, 50, 17, 3.5], [0.75, -45, 13, 3]],
      [[0.02, -16, 40, 8], [0.08, 20, 34, 7]],
      [[0.25, -60, 22, 6.5], [0.45, 55, 19, 5.5], [0.65, -50, 14, 4.5]],
      [[0.3, -50, 17, 3.5], [0.55, 45, 15, 3]],
      [[0.35, -65, 22, 10], [0.6, 60, 19, 9]],
      [[0, -70, 15, 5.5], [0, 65, 14, 5], [0.02, -25, 13, 5]]
    ];
    function drawBloom(bloom, type, col) {
      var k;
      if (type === 0) {          // Margerite: schmale, an der Spitze gekerbte Zungenblüten
        for (k = 0; k < 14; k++) el('path', { 'class': col, d: 'M0 -5 C-4 -8 -4.6 -18 -2 -24 L0 -22.4 L2 -24 C4.6 -18 4 -8 0 -5 Z', transform: 'rotate(' + f1(k * 360 / 14) + ')' }, bloom);
        el('circle', { 'class': 'tsp-center', r: 7.5 }, bloom);
        for (k = 0; k < 9; k++) el('circle', { 'class': 'tsp-dot', cx: f1(Math.cos(k * 2.4) * (1.2 + k * 0.55)), cy: f1(Math.sin(k * 2.4) * (1.2 + k * 0.55)), r: 0.9 }, bloom);
      } else if (type === 1) {   // Tulpe: hinten zwei dunklere Blätter, vorn drei überlappend
        el('path', { 'class': col + ' tsp-shade', d: 'M-14 -6 Q-19 -30 -9 -41 Q0 -31 9 -41 Q19 -30 14 -6 Z' }, bloom);
        el('path', { 'class': col, d: 'M-15 -4 Q-21 -28 -8 -39 Q-1 -25 2 -6 Q-6 0 -15 -4 Z' }, bloom);
        el('path', { 'class': col, d: 'M15 -4 Q21 -28 8 -39 Q1 -25 -2 -6 Q6 0 15 -4 Z' }, bloom);
        el('path', { 'class': col + ' tsp-front', d: 'M-8 -2 Q-11 -26 0 -37 Q11 -26 8 -2 Q0 3 -8 -2 Z' }, bloom);
      } else if (type === 2) {   // Mohn: vier zerknitterte Blätter, dunkler Fleck, Kapsel mit Narbenstrahlen
        for (k = 0; k < 4; k++) el('path', { 'class': col, d: 'M0 0 C-15 -1 -19 -16 -12 -23 C-7 -27 -3 -24 0 -26 C3 -24 7 -27 12 -23 C19 -16 15 -1 0 0 Z', transform: 'rotate(' + (45 + k * 90) + ')' }, bloom);
        el('circle', { 'class': 'tsp-center--dark', r: 8.5 }, bloom);
        el('circle', { 'class': 'tsp-pod', r: 4.6 }, bloom);
        for (k = 0; k < 7; k++) el('path', { 'class': 'tsp-pod-ray', d: 'M0 0 L0 -4.2', transform: 'rotate(' + f1(k * 360 / 7) + ')' }, bloom);
      } else if (type === 3) {   // Glockenblume: drei nickende Glocken mit fünf Zipfeln am Bogen
        el('path', { 'class': 'tsp-stem tsp-stem--thin', d: 'M0 0 Q14 -10 24 4' }, bloom);
        [[0, 0, 1], [13, -3, 0.9], [23, 6, 0.8]].forEach(function (b) {
          var bg = el('g', { transform: 'translate(' + b[0] + ' ' + b[1] + ') scale(' + b[2] + ')' }, bloom);
          el('path', { 'class': 'tsp-bell', d: 'M-6 1 Q-7 9 -9 15 L-6.5 13.5 L-4.5 16.5 L-1.5 14.2 L0 17 L1.5 14.2 L4.5 16.5 L6.5 13.5 L9 15 Q7 9 6 1 Q0 -2.5 -6 1 Z' }, bg);
          el('path', { 'class': 'tsp-calyx', d: 'M-5 1.5 L-3 -2 L0 0.5 L3 -2 L5 1.5 Q0 3.5 -5 1.5 Z' }, bg);
        });
      } else if (type === 4) {   // kleine Sonnenblume: zwei Kränze, Scheibe mit Kernspirale
        for (k = 0; k < 12; k++) el('ellipse', { 'class': 'tsp-p2 tsp-shade', cx: 0, cy: -14, rx: 4.5, ry: 10, transform: 'rotate(' + (k * 30 + 15) + ')' }, bloom);
        for (k = 0; k < 12; k++) el('ellipse', { 'class': 'tsp-p2', cx: 0, cy: -14, rx: 4.5, ry: 10, transform: 'rotate(' + k * 30 + ')' }, bloom);
        el('circle', { 'class': 'tsp-center--seed', r: 9.5 }, bloom);
        for (k = 0; k < 22; k++) el('circle', { 'class': 'tsp-seed', cx: f1(Math.cos(k * 2.4) * Math.sqrt(k) * 1.8), cy: f1(Math.sin(k * 2.4) * Math.sqrt(k) * 1.8), r: 0.95 }, bloom);
      } else {                   // Gänseblümchen-Büschel: drei Köpfe, Spitzen rosa
        [[-12, 6, 0.6], [12, 10, 0.55], [0, 0, 0.75]].forEach(function (d) {
          var dg = el('g', { transform: 'translate(' + d[0] + ' ' + d[1] + ') scale(' + d[2] + ')' }, bloom);
          for (var k2 = 0; k2 < 16; k2++) el('ellipse', { 'class': 'tsp-daisy', cx: 0, cy: -11, rx: 2.6, ry: 9, transform: 'rotate(' + f1(k2 * 22.5) + ')' }, dg);
          el('circle', { 'class': 'tsp-center', r: 5.5 }, dg);
        });
      }
    }
    // Stiel als Kurve: Fuß bleibt stehen, die Spitze wandert mit dem
    // Ausschlag sw (Grad); Blätter und Kopf sitzen auf der Kurve
    function poseFlower(f, nod) {
      var a = f.sw * Math.PI / 180, h = f.h;
      var tx = Math.sin(a) * h, ty = -Math.cos(a) * h, cx = f.lean + tx * 0.18, cy = -h * 0.55;
      f.stem.setAttribute('d', 'M0 0 Q' + f1(cx) + ' ' + f1(cy) + ' ' + f1(tx) + ' ' + f1(ty));
      var tip = Math.atan2(tx - cx, cy - ty) * 180 / Math.PI;
      f.hp.setAttribute('transform', 'translate(' + f1(tx) + ' ' + f1(ty) + ') rotate(' + f1(tip + nod) + ') scale(' + f.hk.toFixed(2) + ')');
      f.leaves.forEach(function (L) {
        var t = L.t, u = 1 - t;
        var px = 2 * u * t * cx + t * t * tx, py = 2 * u * t * cy + t * t * ty;
        L.g.setAttribute('transform', 'translate(' + f1(px) + ' ' + f1(py) + ') rotate(' + f1(L.ang + (L.fl || 0) + f.sw * 0.6) + ')');
      });
    }
    // Wachstum durch Gießen (Server zählt je Blume): Stufe 1 größer mit Knospe
    // am Seitentrieb, Stufe 2 noch größer, die Knospe ist aufgeblüht
    var STAGE_H = [1, 1.15, 1.3], STAGE_K = [1, 1.07, 1.14], flStage = {};
    function stageOf(name) { return flStage[(name || '').toLowerCase()] || 0; }
    function putFlower(name, i, animate) {
      var x = SLOTS[i], y = groundY(x) + 8, st = stageOf(name);
      // je Name fest: Sorte, Farbe, Höhe, Neigung, Kopfgröße, Blätter
      var fr = function (s) { return TS.nameRand(name, s); };
      var ci = Math.floor(fr(7) * 5);
      var h = Math.round((34 + Math.floor(fr(6) * 40)) * 1.5), type = Math.floor(fr(1) * 6), col = 'tsp-p' + (1 + ci);
      var lean = (fr(2) < 0.5 ? -1 : 1) * (4 + 8 * fr(3)), hk = (0.55 + 0.25 * fr(4)) * STAGE_K[st];
      h = Math.round(h * STAGE_H[st]);
      var outer = el('g', { transform: 'translate(' + x.toFixed(0) + ' ' + y.toFixed(0) + ')' }, gFlowers);
      // Zwischenebene zum Biegen/Umknicken (Fuß bei 0/0)
      var bend = el('g', {}, outer);
      var grow = el('g', { 'class': 'tsp-grow' + (animate ? ' tsp-grow--new' : '') }, bend);
      if (animate) setTimeout(function () { grow.classList.remove('tsp-grow--new'); }, 2600);
      // Blätter hängen am Stiel und wandern mit, wenn er sich im Wind biegt
      var leaves = [];
      (LEAVES[type] || LEAVES[0]).forEach(function (L, li) {
        if (li >= 2 && fr(5) >= 0.45) return;
        var len = L[2] * (0.85 + 0.3 * fr(8 + li)), wid = L[3];
        var lg = el('g', {}, grow);
        el('path', { 'class': 'tsp-leaf', d: leafPath(len, wid) }, lg);
        el('path', { 'class': 'tsp-vein', d: 'M0 0 Q' + f1(wid * 0.15) + ' ' + f1(-len * 0.5) + ' 0 ' + f1(-len * 0.88) }, lg);
        leaves.push({ g: lg, t: L[0], ang: L[1] * (fr(2) < 0.5 ? 1 : -1) * (li % 2 ? -1 : 1), ph: fr(11 + li) * 6.28 });
      });
      if (st >= 1) {
        // Seitentrieb: Knospe (Stufe 1) bzw. zweite, kleinere Blüte (Stufe 2)
        var sg = el('g', {}, grow), sl = 18 + h * 0.08;
        el('path', { 'class': 'tsp-stem tsp-stem--thin', d: 'M0 0 Q3 ' + f1(-sl * 0.5) + ' 0 ' + f1(-sl) }, sg);
        var tip = el('g', { transform: 'translate(0 ' + f1(-sl) + ')' }, sg);
        if (st === 1) {
          el('ellipse', { 'class': col, cx: 0, cy: -5, rx: 3.6, ry: 6 }, tip);
          el('path', { 'class': 'tsp-calyx', d: 'M-4 0 L-2.5 -5 L0 -1 L2.5 -5 L4 0 Q0 2 -4 0 Z' }, tip);
        } else {
          drawBloom(el('g', { 'class': 'tsp-bloom', transform: 'scale(' + (hk * 0.6).toFixed(2) + ')' }, tip), type, col);
        }
        leaves.push({ g: sg, t: 0.45, ang: (lean > 0 ? -1 : 1) * 50, ph: fr(14) * 6.28 });
      }
      var stem = el('path', { 'class': 'tsp-stem' }, grow);
      var hp = el('g', {}, grow);
      var head = el('g', { 'class': 'tsp-head' + (i % 2 ? '' : ' tsp-head--l') }, hp);
      var bloom = el('g', { 'class': 'tsp-bloom' }, head);
      drawBloom(bloom, type, col);
      // Schwingung: hohe Stiele langsam und weit, kurze zittern schnell
      var f0 = 1.7 - 0.8 * clamp01((h - 51) / 60);
      flowers[i] = { node: outer, head: head, bend: bend, grow: grow, x: x, y: y - h, h: h, hk: hk, label: name, c: PETALS[ci], stage: st,
                     ang: 0, shown: 0, knock: 0, hitIn: null, holdFor: 0, rip: null, fly: null,
                     stem: stem, hp: hp, leaves: leaves, lean: lean, sw: 0, sv: 0, wk: f0 * 6.283, zeta: 0.12 + 0.08 * fr(9),
                     ph: fr(10) * 6.28, swShown: null };
      poseFlower(flowers[i], 0);
      if (animate && B.on && B.partOn('meadow')) setTimeout(function () { B.tag(name, x, y - h - 32, false); }, 1300);
    }
    // Kurzbesuch (!whereiam, nicht im Bild): Blume wächst neben einem Platz auf,
    // eine Krähe holt sie wieder ab; sie gehört keinem Platz (flowers bleibt unverändert)
    function visitFlower(name) {
      var i = Math.floor(Math.random() * SLOTS.length), keep = flowers[i];
      putFlower(name, i, false);
      var v = flowers[i];
      flowers[i] = keep;
      v.x += v.x < W / 2 ? 30 : -30;
      var y = groundY(v.x) + 12;
      v.node.setAttribute('transform', 'translate(' + v.x.toFixed(0) + ' ' + y.toFixed(0) + ')');
      TS.visit(v.node, { x: v.x, top: y - v.h, r: v.h / 2, crow: true,
        arrive: function () { if (root.SeasonKit) root.SeasonKit.hop(v.head); B.tag(name + ' drops by!', v.x, y - v.h - 50, true); } });
    }
    function clearFlowers() { B.clear(gFlowers); flowers = []; flNext = 0; flTotal = 0; flGen++; }

    // ── Sonnenblume: gemeinsames Sub-Projekt, wächst mit jedem Teil ──
    var SF_Y = -385;     // Mitte des Blütenkopfs
    function ring(g, n, r, rx, ry, off, cls) {
      for (var i = 0; i < n; i++) {
        el('ellipse', { 'class': cls, cx: 0, cy: f1(SF_Y - r), rx: rx, ry: ry,
                        transform: 'rotate(' + f1(off + i * 360 / n) + ' 0 ' + SF_Y + ')' }, g);
      }
    }
    // Kopf-Teile in eine Hülle, die sich bei Schnee am Stängelende neigt
    var sfHeads = [], sfDroop = 0;
    function droopG(g) { var h = el('g', {}, g); sfHeads.push(h); return h; }
    function droopSunflower(k) {
      if (Math.abs(k - sfDroop) < 0.003) return;
      sfDroop = k;
      var tr = k < 0.003 ? '' : 'rotate(' + (k * 30).toFixed(1) + ' 0 -362)';
      sfHeads.forEach(function (h) { h.setAttribute('transform', tr); });
    }
    var sunflower = B.project(gSun, {
      x: 230, k: 0.9,
      y: function () { return groundY(230) + 12; },
      top: function (n) { return [0, 130, 250, 360, 418, 470, 470, 470, 500][n]; },
      done: 'The sunflower is in full bloom!',
      names: ['a sprout', 'more stem', 'the tall stem', 'a bud', 'the first petals', 'a full bloom', 'a happy face', 'a bee'],
      parts: [
        function (g) {
          el('path', { 'class': 'tsp-sf-stem', d: 'M0 4 Q-6 -60 0 -132' }, g);
          el('path', { 'class': 'tsp-sf-leaf', d: 'M-2 -50 Q-40 -76 -58 -58 Q-34 -40 -2 -50 Z M2 -70 Q36 -96 54 -80 Q32 -60 2 -70 Z' }, g);
        },
        function (g) {
          el('path', { 'class': 'tsp-sf-stem', d: 'M0 -132 Q8 -190 0 -252' }, g);
          el('path', { 'class': 'tsp-sf-leaf', d: 'M2 -150 Q-50 -186 -82 -160 Q-46 -130 2 -150 Z M2 -205 Q52 -240 84 -214 Q48 -184 2 -205 Z' }, g);
        },
        function (g) {
          el('path', { 'class': 'tsp-sf-stem', d: 'M0 -252 Q-7 -310 0 -362' }, g);
          el('path', { 'class': 'tsp-sf-leaf', d: 'M-2 -292 Q-46 -322 -72 -300 Q-42 -274 -2 -292 Z' }, g);
        },
        function (g) {
          g = droopG(g);
          for (var i = 0; i < 10; i++) {
            el('path', { 'class': 'tsp-sf-sepal', d: 'M-9 ' + (SF_Y - 18) + ' L0 ' + (SF_Y - 46) + ' L9 ' + (SF_Y - 18) + ' Z',
                         transform: 'rotate(' + (i * 36) + ' 0 ' + SF_Y + ')' }, g);
          }
          el('circle', { 'class': 'tsp-sf-bud', cx: 0, cy: SF_Y, r: 28 }, g);
        },
        function (g) { g = droopG(g); ring(g, 16, 50, 11, 30, 0, 'tsp-sf-petal2'); },
        function (g) { g = droopG(g); ring(g, 16, 50, 11, 30, 11.25, 'tsp-sf-petal'); },
        function (g) {
          g = droopG(g);
          el('circle', { 'class': 'tsp-sf-disk', cx: 0, cy: SF_Y, r: 34 }, g);
          for (var i = 0; i < 18; i++) {
            var a = i * 2.4, rr = 6 + i * 1.4;
            el('circle', { 'class': 'tsp-sf-seed', cx: f1(Math.cos(a) * rr), cy: f1(SF_Y + Math.sin(a) * rr), r: 2 }, g);
          }
          el('circle', { 'class': 'tsp-sf-eye', cx: -11, cy: SF_Y - 7, r: 5 }, g);
          el('circle', { 'class': 'tsp-sf-eye', cx: 11, cy: SF_Y - 7, r: 5 }, g);
          el('path', { 'class': 'tsp-sf-smile', d: 'M-15 ' + (SF_Y + 8) + ' Q0 ' + (SF_Y + 22) + ' 15 ' + (SF_Y + 8) }, g);
          el('circle', { 'class': 'tsp-sf-cheek', cx: -21, cy: SF_Y + 6, r: 5 }, g);
          el('circle', { 'class': 'tsp-sf-cheek', cx: 21, cy: SF_Y + 6, r: 5 }, g);
        },
        function (g) {
          g = droopG(g);
          var bee = el('g', { 'class': 'tsp-sf-bee' }, el('g', { transform: 'translate(26 ' + (SF_Y - 82) + ') scale(1.5)' }, g));
          beeShape(bee).dataset.legs = '1';
        }
      ],
      burst: function (x, y) {
        if (!B.front) return;
        for (var i = 0; i < 24; i++) {
          B.front.add({ x: x + rand(-40, 40), y: y + rand(-30, 30), vx: rand(-260, 260), vy: rand(-600, -250), term: rand(60, 100),
                        sway: rand(20, 50), r: rand(4, 7), c: i % 3 ? '#ffd23f' : '#ffffff', life: 1.8, draw: petal });
        }
      }
    });

    // ── Kirschzweig oben links: Rinde rotbraun mit hellen Querstreifen
    // (Lentizellen), Blüten in Büscheln an kurzen Kurztrieben, Knospen und junge
    // Blätter. Bewegt sich gestaffelt: Hauptast langsam, Zweige schneller,
    // Büschel zittern ──
    var blossoms = [], twigs = [], clusters = [];
    var TWIGS = [{ d: 'M-20 140 Q140 120 300 160 Q400 186 470 172', w: 15, at: [-20, 140], f: 0.22, amp: 0.7 },
                 { d: 'M140 130 Q190 80 260 64', w: 7, at: [140, 130], f: 0.55, amp: 2.2 },
                 { d: 'M290 158 Q330 220 310 280', w: 6, at: [290, 158], f: 0.5, amp: 2.0 },
                 { d: 'M380 180 Q420 140 480 128', w: 5, at: [380, 180], f: 0.65, amp: 2.6 }];
    var gMainTwig = null;
    TWIGS.forEach(function (t, ti) {
      var tg = el('g', {}, ti ? gMainTwig : gSway);
      if (!ti) gMainTwig = tg;
      el('path', { 'class': 'tsp-wood', d: t.d, 'stroke-width': t.w }, tg);
      var p = el('path', { 'class': 'tsp-wood-hi', d: t.d, 'stroke-width': (t.w * 0.35).toFixed(1), transform: 'translate(0 ' + f1(-t.w * 0.22) + ')' }, tg);
      var len = p.getTotalLength();
      function ptAt(s) {
        var a = p.getPointAtLength(s), b = p.getPointAtLength(Math.min(len, s + 1));
        var dx = b.x - a.x, dy = b.y - a.y, n = Math.hypot(dx, dy) || 1;
        return { x: a.x, y: a.y + t.w * 0.22, tx: dx / n, ty: dy / n };
      }
      // Lentizellen: kurze helle Striche quer zur Faser
      for (var ls = 10; t.w >= 7 && ls < len - 6; ls += 12 + rnd() * 16) {
        var q = ptAt(ls), lw = t.w * (0.12 + rnd() * 0.16);
        el('path', { 'class': 'tsp-lenticel', d: 'M' + f1(q.x - q.ty * lw) + ' ' + f1(q.y + q.tx * lw) + ' L' + f1(q.x + q.ty * lw * 0.6) + ' ' + f1(q.y - q.tx * lw * 0.6) }, tg);
      }
      twigs.push({ g: tg, x: t.at[0], y: t.at[1], f: t.f, amp: t.amp, ph: rnd() * 6.28, shown: null });
      for (var s = len * (ti ? 0.2 : 0.3); s < len; s += 30 + rnd() * 18) {
        var pt = ptAt(s), side = rnd() < 0.55 ? -1 : 1;
        var nx = -pt.ty * side, ny = pt.tx * side;
        var cg = el('g', {}, tg);
        // Kurztrieb, daran 2–4 Blüten an langen Stielen, mal eine Knospe oder ein Blatt
        var spx = pt.x + nx * t.w * 0.5, spy = pt.y + ny * t.w * 0.5, ex = spx + nx * 5, ey = spy + ny * 5;
        el('path', { 'class': 'tsp-spur', d: 'M' + f1(pt.x) + ' ' + f1(pt.y) + ' L' + f1(ex) + ' ' + f1(ey) }, cg);
        if (rnd() < 0.35) el('use', { href: '#tsp-yleaf', transform: 'translate(' + f1(ex) + ' ' + f1(ey) + ') rotate(' + f1(Math.atan2(nx, -ny) * 57.3 + (rnd() - 0.5) * 70) + ') scale(' + (0.9 + rnd() * 0.5).toFixed(2) + ')' }, cg);
        var n = 2 + Math.floor(rnd() * 2);
        for (var k = 0; k < n; k++) {
          var ang = Math.atan2(ny, nx) + (k - (n - 1) / 2) * 0.55 + (rnd() - 0.5) * 0.3, pl = 9 + rnd() * 9;
          var bx = ex + Math.cos(ang) * pl, by = ey + Math.sin(ang) * pl;
          el('path', { 'class': 'tsp-pedicel', d: 'M' + f1(ex) + ' ' + f1(ey) + ' Q' + f1(ex + Math.cos(ang) * pl * 0.5) + ' ' + f1(ey + Math.sin(ang) * pl * 0.5 + 2) + ' ' + f1(bx) + ' ' + f1(by) }, cg);
          if (rnd() < 0.15) {
            el('use', { href: '#tsp-bud', transform: 'translate(' + f1(bx) + ' ' + f1(by) + ') rotate(' + f1(ang * 57.3 + 90) + ')' }, cg);
          } else {
            el('use', { href: '#tsp-blossom', transform: 'translate(' + f1(bx) + ' ' + f1(by) + ') rotate(' + (rnd() * 72).toFixed(0) + ') scale(' + (0.95 + rnd() * 0.5).toFixed(2) + ')' }, cg);
            blossoms.push([bx, by]);
          }
        }
        clusters.push({ g: cg, x: pt.x, y: pt.y, f: 1.8 + rnd() * 1.4, ph: rnd() * 6.28, shown: null });
      }
    });
    function stepBranch(dt, gustK) {
      if (!B.partOn('branch')) return;
      var w = Math.abs(windAt(200)) + Math.abs(gustK) * 0.8, lean = windDir() * Math.min(1.5, w) * 0.8;
      twigs.forEach(function (t, ti) {
        var a = (ti ? lean * 1.5 : lean * 0.5) + Math.sin(windT * t.f * 6.283 + t.ph) * t.amp * (0.35 + w);
        if (t.shown !== null && Math.abs(a - t.shown) < 0.02) return;
        t.shown = a;
        t.g.setAttribute('transform', 'rotate(' + a.toFixed(2) + ' ' + t.x + ' ' + t.y + ')');
      });
      clusters.forEach(function (c) {
        var a = Math.sin(windT * c.f * 6.283 + c.ph) * (1.5 + 9 * w) + lean * 3;
        if (c.shown !== null && Math.abs(a - c.shown) < 0.05) return;
        c.shown = a;
        c.g.setAttribute('transform', 'rotate(' + a.toFixed(1) + ' ' + f1(c.x) + ' ' + f1(c.y) + ')');
      });
    }

    // ── Partikel ──
    function petal(ctx, p, al) {
      ctx.save(); ctx.globalAlpha = al; ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.scale(Math.cos(p.ph * 1.4), 1);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, 6.283); ctx.fill();
      ctx.restore();
    }
    function spray(ctx, p, al) {
      ctx.globalAlpha = al; ctx.fillStyle = '#9fd6ff';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
    }
    // Blütenblätter nachts so dunkel wie Zweig und Wiese (.tsp-dim)
    function dimCol(hex) {
      var k = 1 - 0.4 * B.night, n = parseInt(hex.slice(1), 16);
      return 'rgb(' + Math.round((n >> 16) * k) + ',' + Math.round(((n >> 8) & 255) * k) + ',' + Math.round((n & 255) * k) + ')';
    }
    // im Regen nass und schwer: fallen schneller, fast senkrecht, kaum Flattern
    function blossomPetal(x, y) {
      if (!B.back) return;
      var wet = clamp01(B.rain * 2);
      B.back.add({ x: x, y: y, vy: rand(30, 60) + 120 * wet, term: rand(40, 70) + 160 * wet, sway: rand(20, 50) * (1 - 0.85 * wet), r: rand(5, 8),
                   c: dimCol(Math.random() < 0.7 ? '#ffc6d9' : '#ffffff'), floor: groundY, draw: petal });
    }

    // ── Biene: Kopf mit Facettenauge und geknickten Fühlern, pelzige Brust,
    // gestreifter Hinterleib mit Stachel, hängende Beine mit Pollenhöschen.
    // Die Flügel schlagen ~230-mal pro Sekunde mit kleinem Ausschlag: zu
    // sehen ist nur ein flimmernder Schleier, kein einzelner Schlag ──
    function beeShape(parent) {
      var g = el('g', { 'class': 'tsp-bee' }, parent);
      // Beine (hinter dem Körper): Hüfte > Knie > Fuß, das hintere Paar mit Pollen
      [[0, 4, -3, 11, 1, 16], [3, 5, 2, 12, 5, 17], [6, 4, 8, 10, 10, 15]].forEach(function (l, i) {
        el('path', { 'class': 'tsp-bee-leg', d: 'M' + l[0] + ' ' + l[1] + ' L' + l[2] + ' ' + l[3] + ' L' + l[4] + ' ' + l[5] }, g);
        if (!i) el('ellipse', { 'class': 'tsp-bee-pollen', cx: -2.5, cy: 11, rx: 2.6, ry: 2 }, g);
      });
      // Flügelschleier hinter der Brust, darüber die flimmernden Flügel
      el('path', { 'class': 'tsp-bee-blur', d: 'M2 -5 L-14 -20 Q-2 -26 10 -21 Z' }, g);
      el('path', { 'class': 'tsp-bee-sting', d: 'M-20 2 L-24 3 L-20 4 Z' }, g);
      el('ellipse', { 'class': 'tsp-bee-abd', cx: -10, cy: 3, rx: 11, ry: 7.5 }, g);
      // Streifen als senkrechte Sehnen der Ellipse
      [-15.5, -10, -4.5].forEach(function (x) {
        var dx = (x + 10) / 11, hh = 7.5 * Math.sqrt(1 - dx * dx);
        el('line', { 'class': 'tsp-bee-band', x1: x, y1: f1(3 - hh), x2: x, y2: f1(3 + hh) }, g);
      });
      el('circle', { 'class': 'tsp-bee-thx', cx: 2, cy: 0, r: 6.5 }, g);
      el('circle', { 'class': 'tsp-bee-fuzz', cx: 2, cy: 0, r: 6.5 }, g);
      el('circle', { 'class': 'tsp-bee-head', cx: 10.5, cy: 1.5, r: 4.4 }, g);
      el('ellipse', { 'class': 'tsp-bee-eye', cx: 11.5, cy: 0.5, rx: 2, ry: 2.8 }, g);
      el('path', { 'class': 'tsp-bee-ant', d: 'M11 -2.5 L13 -9 L18 -9.5 M12.5 -2 L16 -7 L20 -6' }, g);
      var wings = el('g', { 'class': 'tsp-bee-wings' }, g);
      el('path', { 'class': 'tsp-bee-wing', d: 'M2 -5 Q-6 -21 -13 -18 Q-10 -9 2 -5 Z M-1 -10 L-9 -17' }, wings);
      el('path', { 'class': 'tsp-bee-wing tsp-bee-wing--b', d: 'M3 -5 Q0 -16 -5 -15 Q-4 -8 3 -5 Z' }, wings);
      return g;
    }
    // Biene fliegt im Zickzack zur Blüte, steht davor kurz im Schwebeflug,
    // landet mit gestreckten Beinen, geneigt zur Blüte, und summt weiter
    function beeFlight(target, done) {
      if (B.reduceMotion) { if (done) done(); return; }
      var dir = target.x > W / 2 ? 1 : -1, g = el('g', {}, gBugs), body = beeShape(g);
      var sx = dir > 0 ? -60 : W + 60, sy = H - rand(280, 440), ex = dir > 0 ? W + 60 : -60, ey = H - rand(320, 480);
      var hx = target.x - dir * 46, hy = target.y - 34, t0 = performance.now(), last = t0;
      var IN = 2.4, HOVER = 0.8, LAND = 0.35, SIT = 1.3, OUT = 2.2, x = sx, y = sy, tilt = 0, arrived = false;
      var whirl = null, spin = 0, tossed = 0, tvx = 0, tvy = 0;
      (function step() {
        var now = performance.now(), t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000), face = dir, tt;
        last = now;
        var want = 0, legs = 0;
        // Windhose in der Nähe: reißt sie mit und schleudert sie aus dem Bild
        var tn = tws.near(x);
        if (!whirl && !tossed && tn && Math.abs(tn.x - x) < 110) { whirl = tn.t; if (!arrived) { arrived = true; if (done) done(); } }
        if (whirl || tossed) {
          var wx = whirl && whirl.active() ? whirl.x() : null;
          if (whirl && (wx === null || wx < -100 || wx > W + 100)) {
            whirl = null; tossed = x < W / 2 ? -1 : 1; tvx = tossed * 420; tvy = -160;
          }
          if (whirl) {
            x += (wx + Math.sin(now / 120) * 45 - x) * Math.min(1, dt * 3);
            y += ((H - 650) - y) * Math.min(1, dt * 0.9);
          } else {
            tvy += 120 * dt; x += tvx * dt; y += tvy * dt;
          }
          spin += dt * 720 * (whirl ? whirl.dir || 1 : tossed);
          body.dataset.legs = '1';
          g.setAttribute('transform', 'translate(' + f1(x) + ' ' + f1(y) + ') rotate(' + f1(spin) + ') scale(' + (dir * 1.45).toFixed(2) + ' 1.45)');
          g.setAttribute('opacity', clamp01(Math.min(x + 40, W + 40 - x) / 140).toFixed(3));
          if (x < -80 || x > W + 80 || y < -80) { gBugs.removeChild(g); return; }
          root.requestAnimationFrame(step);
          return;
        }
        if (t < IN) {
          // Zickzack: seitlich und in der Höhe pendelnd, zum Schwebepunkt hin langsamer
          var k = t / IN, e = 1 - Math.pow(1 - k, 2.2), wob = 1 - k;
          x = sx + (hx - sx) * e + Math.sin(t * 7) * 26 * wob;
          y = sy + (hy - sy) * e + Math.sin(t * 11) * 18 * wob;
          want = 10 * Math.cos(t * 7) * wob;
        } else if (t < IN + HOVER) {
          // Schwebeflug vor der Blüte, leicht aufgerichtet
          tt = t - IN;
          x = hx + Math.sin(tt * 9) * 3; y = hy + Math.sin(tt * 13) * 2.5;
          want = -18; legs = 1;
        } else if (t < IN + HOVER + LAND) {
          tt = (t - IN - HOVER) / LAND;
          var le = tt * tt * (3 - 2 * tt);
          x = hx + (target.x - dir * 4 - hx) * le; y = hy + (target.y - 6 - hy) * le;
          want = -18 + 30 * le; legs = 1;
          if (!arrived && tt > 0.5) { arrived = true; if (done) done(); }
        } else if (t < IN + HOVER + LAND + SIT) {
          // sitzt, nach vorn geneigt in die Blüte
          x = target.x - dir * 4 + Math.sin(t * 20) * 0.6; y = target.y - 6; want = 14; legs = 1;
        } else if (t < IN + HOVER + LAND + SIT + OUT) {
          tt = (t - IN - HOVER - LAND - SIT) / OUT;
          var oe = tt * tt;
          var bx = target.x - dir * 4, by = target.y - 6;
          x = bx + (ex - bx) * oe + Math.sin(t * 7) * 22 * tt;
          y = by + (ey - by) * Math.sqrt(tt) + Math.sin(t * 11) * 14 * tt;
          want = -12 + 12 * tt;
        } else { gBugs.removeChild(g); return; }
        tilt += (want - tilt) * Math.min(1, dt * 8);
        body.dataset.legs = legs ? '1' : '0';
        g.setAttribute('transform', 'translate(' + f1(x) + ' ' + f1(y) + ') scale(' + (face * 1.45).toFixed(2) + ' 1.45) rotate(' + f1(tilt) + ')');
        g.setAttribute('opacity', clamp01(Math.min(x + 40, W + 40 - x) / 140).toFixed(3));
        root.requestAnimationFrame(step);
      })();
    }
    function sendBee(name) {
      var live = flowers.filter(function (f) { return f && !f.rip; });
      var f = live.length ? live[Math.floor(Math.random() * live.length)] : null;
      var target = f ? { x: f.x, y: f.y, head: f.head } : { x: rand(300, W - 300), y: H - 160, head: null };
      beeFlight(target, function () { if (target.head) B.spot(target.head); });
      var ty = target.y - 20;
      if (root.SeasonKit) root.SeasonKit.crowd('bee', name || 'Someone', function (n) { return n + ' sent a bee!'; },
                                               function (n) { return n + ' sent bees too!'; }, function (t) { B.tag(t, target.x, ty - 90, true); });
      else B.tag((name || 'Someone') + ' sent a bee!', target.x, ty - 90, true);
    }

    // ── Schmetterling: vier Flügel (Vorder- größer als Hinterflügel) mit
    // dunklem Rand und Zeichnung, Körper aus Kopf, Brust, Hinterleib,
    // Fühler mit Keulen. Schräg von der Seite und leicht von oben gesehen:
    // jeder Flügel klappt um die Körperachse (th 0° = flach, 90° = hoch),
    // der nahe zeigt hochgeklappt seine Unterseite. Langsamer Schlag
    // (~9/s): beim Abschlag steigt er, beim Aufschlag sackt er durch; dazu
    // Haken und kurze Gleitstrecken. Landet ab und zu auf einer Blüte,
    // klappt die Flügel zusammen und sonnt sich mit kurzem Öffnen ──
    var BF_P = 0.5;   // Blick von oben (rad)
    var BF_KINDS = ['peacock', 'brimstone', 'blue'];
    // Flügelumriss: [v (nach vorn), u (Spanne)]
    var BF_FORE = [[3, 0], [9, 10], [13, 24], [8, 31], [0, 29], [-5, 17], [-4, 3]];
    var BF_HIND = [[-3, 1], [-4, 12], [-8, 21], [-15, 20], [-19, 11], [-12, 2]];
    // Zeichnung je Art: [Flügel, v, u, r, Klasse]
    var BF_PAT = {
      peacock: [['f', 6, 23, 5.5, 'tsp-bf-eye1'], ['f', 6, 23, 3.4, 'tsp-bf-eye2'], ['f', 6.5, 23.5, 1.6, 'tsp-bf-eye3'],
                ['h', -12, 13, 5, 'tsp-bf-eye4'], ['h', -12, 13, 2.6, 'tsp-bf-eye2'], ['f', 9, 14, 1.4, 'tsp-bf-dot']],
      brimstone: [['f', 2, 16, 1.8, 'tsp-bf-spot'], ['h', -10, 11, 1.8, 'tsp-bf-spot']],
      blue: [['f', 5, 24, 1, 'tsp-bf-dot'], ['f', 1, 23.5, 1, 'tsp-bf-dot'], ['h', -9, 16.5, 1, 'tsp-bf-dot'], ['h', -13, 15.5, 1, 'tsp-bf-dot']]
    };
    // Unterseite (Tarnung, beim hochgeklappten nahen Flügel zu sehen):
    // Bänder als verkleinerter Umriss [Faktor, Klasse], Punkte wie oben
    var BF_UBAND = { peacock: [[0.66, 'tsp-bf-uband'], [0.5, 'tsp-bf-uband2']] };
    var BF_UPAT = {
      brimstone: [['f', 2, 16, 1.1, 'tsp-bf-urust'], ['h', -10, 11, 1.1, 'tsp-bf-urust']],
      blue: [['f', 2, 18, 2.3, 'tsp-bf-uring'], ['f', 2, 18, 1.4, 'tsp-bf-udot'], ['f', 5, 11, 2.1, 'tsp-bf-uring'], ['f', 5, 11, 1.2, 'tsp-bf-udot'],
             ['f', 0, 20, 2, 'tsp-bf-uring'], ['f', 0, 20, 1.1, 'tsp-bf-udot'],
             ['h', -8, 9, 2, 'tsp-bf-uring'], ['h', -8, 9, 1.1, 'tsp-bf-udot'], ['h', -13, 13, 2, 'tsp-bf-uring'], ['h', -13, 13, 1.1, 'tsp-bf-udot'],
             ['h', -6, 15.5, 1.3, 'tsp-bf-uorange'], ['h', -10.5, 16, 1.3, 'tsp-bf-uorange'], ['h', -14.5, 14, 1.3, 'tsp-bf-uorange']]
    };
    function bfProj(v, u, th, s) {
      return [v, -u * Math.sin(th) * Math.cos(BF_P) + s * u * Math.cos(th) * Math.sin(BF_P)];
    }
    function bfPath(pts, th, s, shrink) {
      var P = pts.map(function (p) { return bfProj(p[0] * shrink, p[1] * shrink, th, s); }), n = P.length;
      function mid(a, b) { return f1((a[0] + b[0]) / 2) + ' ' + f1((a[1] + b[1]) / 2); }
      var d = 'M' + mid(P[n - 1], P[0]);
      for (var i = 0; i < n; i++) d += ' Q' + f1(P[i][0]) + ' ' + f1(P[i][1]) + ' ' + mid(P[i], P[(i + 1) % n]);
      return d + ' Z';
    }
    function bfCircle(v, u, r, th, s) {
      var d = '';
      for (var i = 0; i < 10; i++) {
        var a = i / 10 * 6.283, p = bfProj(v + Math.cos(a) * r, u + Math.sin(a) * r, th, s);
        d += (i ? ' L' : 'M') + f1(p[0]) + ' ' + f1(p[1]);
      }
      return d + ' Z';
    }
    function makeBf(kind) {
      var g = el('g', { 'class': 'tsp-bf tsp-bf--' + kind }, gBugs);
      function wing(s, fore) {
        var w = el('g', { 'class': 'tsp-bf-wing' }, g);
        var o = { g: w, s: s, fore: fore, edge: el('path', { 'class': 'tsp-bf-edge' }, w), inner: el('path', { 'class': 'tsp-bf-in' }, w), pat: [] };
        (BF_PAT[kind] || []).forEach(function (p) {
          if ((p[0] === 'f') === fore) o.pat.push({ p: p, n: el('path', { 'class': 'tsp-bf-pat ' + p[4] }, w) });
        });
        o.bands = [];
        if (s > 0) {
          (BF_UBAND[kind] || []).forEach(function (b) { o.bands.push({ k: b[0], n: el('path', { 'class': 'tsp-bf-under ' + b[1] }, w) }); });
          (BF_UPAT[kind] || []).forEach(function (p) {
            if ((p[0] === 'f') === fore) o.pat.push({ p: p, n: el('path', { 'class': 'tsp-bf-under ' + p[4] }, w) });
          });
        }
        return o;
      }
      var wings = [wing(-1, false), wing(-1, true)];
      var body = el('g', { 'class': 'tsp-bf-body' }, g);
      el('ellipse', { cx: -8, cy: 0.5, rx: 9, ry: 2.4 }, body);
      el('ellipse', { cx: 2, cy: 0, rx: 4, ry: 3 }, body);
      el('circle', { cx: 7.2, cy: -0.5, r: 2.5 }, body);
      el('path', { 'class': 'tsp-bf-ant', d: 'M8 -2.5 Q12 -9 17 -13 M7 -2.5 Q9 -10 12 -15' }, body);
      el('circle', { cx: 17, cy: -13, r: 1.3 }, body);
      el('circle', { cx: 12, cy: -15, r: 1.3 }, body);
      wings.push(wing(1, false), wing(1, true));
      return { g: g, wings: wings };
    }
    function poseBf(b, th) {
      b.wings.forEach(function (w) {
        var pts = w.fore ? BF_FORE : BF_HIND;
        // Unterseite des nahen Flügels zu sehen, sobald er steiler steht als der Blick
        var under = w.s > 0 && th > BF_P ? '1' : '0';
        if (w.g.dataset.under !== under) w.g.dataset.under = under;
        w.edge.setAttribute('d', bfPath(pts, th, w.s, 1));
        w.inner.setAttribute('d', bfPath(pts, th, w.s, 0.84));
        w.bands.forEach(function (b) { b.n.setAttribute('d', bfPath(pts, th, w.s, b.k)); });
        w.pat.forEach(function (q) { q.n.setAttribute('d', bfCircle(q.p[1], q.p[2], q.p[3], th, w.s)); });
      });
    }
    function wanderButterfly() {
      if (!B.on || !B.partOn('bugs') || B.night > 0.5 || B.rain > 0.2 || B.reduceMotion) return;
      // Hintergrund-Tab: Timer laufen weiter, rAF steht – sonst stauen sich Falter an
      if (document.hidden || gBugs.querySelectorAll('.tsp-bf').length >= 3) return;
      var dir = Math.random() < 0.5 ? 1 : -1, b = makeBf(BF_KINDS[Math.floor(Math.random() * BF_KINDS.length)]);
      var x = dir > 0 ? -60 : W + 60, base = rand(H - 380, H - 240), y = base, vx = dir * 95, vy = 0;
      var ph = 0, hook = rand(1, 2.5), glide = 0, tilt = 0, last = performance.now();
      // ab und zu eine Blüte vor ihm zum Rasten
      var cand = flowers.filter(function (f) { return f && !f.rip && (f.x - x) * dir > 300 && (f.x - x) * dir < 1500; });
      var rest = Math.random() < 0.6 && cand.length ? cand[Math.floor(Math.random() * cand.length)] : null, sit = 0, sat = false;
      var whirl = null, spin = 0;
      (function step() {
        var now = performance.now(), dt = Math.min(0.05, (now - last) / 1000), th;
        last = now;
        if (!B.on) { gBugs.removeChild(b.g); return; }
        // Windhose in der Nähe: reißt ihn mit, wirbelt ihn hoch und schleudert ihn hinaus
        var tn = tws.near(x);
        if (!whirl && tn && Math.abs(tn.x - x) < 130) { whirl = tn.t; sit = 0; rest = null; }
        if (whirl) {
          var wx = whirl.active() ? whirl.x() : null;
          if (wx === null || wx < -100 || wx > W + 100) {
            whirl = null; dir = x < W / 2 ? -1 : 1; vx = dir * 380; vy = -150; spin = 0;
          } else {
            x += (wx + Math.sin(now / 140) * 55 - x) * Math.min(1, dt * 3);
            y += ((H - 700) - y) * Math.min(1, dt * 0.9);
            spin += dt * 600 * (whirl.dir || 1);
            th = 0.6 + 0.9 * Math.sin(now / 35);
          }
        }
        if (whirl) {
          poseBf(b, th);
          b.g.setAttribute('transform', 'translate(' + f1(x) + ' ' + f1(y) + ') rotate(' + f1(spin) + ') scale(' + (dir * 1.7).toFixed(2) + ' 1.7)');
          b.g.setAttribute('opacity', clamp01(Math.min(x + 40, W + 40 - x) / 140).toFixed(3));
          root.requestAnimationFrame(step);
          return;
        }
        if (sit > 0) {
          // sitzt: Flügel zusammengeklappt, öffnet sie ein paar Mal zum Sonnen
          sit -= dt;
          var open = Math.max(0, Math.sin((4.5 - sit) * 1.6)) ;
          th = 1.5 - 1.1 * Math.pow(open, 3);
          tilt += (0 - tilt) * Math.min(1, dt * 6);
          if (sit <= 0) { vy = -60; vx = dir * 60; }
        } else {
          // Flug: Schlag ~9/s, Abschlag hebt, Aufschlag lässt durchsacken
          if (glide > 0) { glide -= dt; th = 0.15; }
          else {
            ph += dt * 9;
            var p = ph - Math.floor(ph);
            th = p < 0.5 ? 1.3 - 1.65 * (0.5 - 0.5 * Math.cos(Math.PI * p / 0.5)) : -0.35 + 1.65 * (0.5 - 0.5 * Math.cos(Math.PI * (p - 0.5) / 0.5));
            vy += (p < 0.5 ? -520 : 420) * dt;
            if (Math.random() < dt * 0.35) glide = rand(0.25, 0.5);
          }
          // Haken: unvorhersehbar seitlich und in der Höhe
          hook -= dt;
          if (hook <= 0) { hook = rand(0.7, 2.2); vy += rand(-160, 160); vx = dir * rand(55, 140); }
          var tx = null, ty = base;
          if (rest && !sat) { tx = rest.x; ty = rest.y - 8; if (Math.abs(rest.x - x) < 260) vx += ((rest.x - x) * 1.6 - vx) * Math.min(1, dt * 3); }
          vy += (ty - y) * 1.4 * dt - vy * 0.9 * dt;
          if (rest && !sat && Math.abs(rest.x - x) < 6 && Math.abs(ty - y) < 8) { sat = true; sit = rand(3.5, 5); x = rest.x; y = ty; vx = 0; vy = 0; }
          // Böen treiben ihn seitlich ab
          if (sit <= 0) { x += (vx + B.windPx() * 0.15) * dt; y += vy * dt; }
          tilt += (Math.max(-20, Math.min(20, vy * 0.08)) - tilt) * Math.min(1, dt * 5);
        }
        poseBf(b, th);
        b.g.setAttribute('transform', 'translate(' + f1(x) + ' ' + f1(y) + ') scale(' + (dir * 1.7).toFixed(2) + ' 1.7) rotate(' + f1(tilt * dir) + ')');
        b.g.setAttribute('opacity', clamp01(Math.min(x + 40, W + 40 - x) / 140).toFixed(3));
        if ((dir > 0 && x > W + 80) || (dir < 0 && x < -80)) { gBugs.removeChild(b.g); return; }
        root.requestAnimationFrame(step);
      })();
    }
    setInterval(wanderButterfly, 25000);
    setTimeout(wanderButterfly, 3000);

    // ── Animationen zu den Befehlen ──
    var S = { water: 100, waterT: 100, weeds: 0, weedsT: 0, first: true, top: [] };
    function setLevels(p, key) {
      var lv = parseFloat(p.level);
      if (!isNaN(lv)) S[key + 'T'] = Math.max(0, Math.min(100, lv));
    }
    var can = el('g', { 'class': 'tsp-can' }, B.fxSvg);
    el('path', { 'class': 'tsp-can-body', d: 'M-40 -30 L30 -30 L36 30 L-46 30 Z' }, can);
    el('path', { 'class': 'tsp-can-body', d: 'M30 -20 L90 -46 L94 -38 L36 -4 Z' }, can);
    el('path', { 'class': 'tsp-can-handle', d: 'M-40 -20 Q-74 0 -40 22' }, can);
    var watering = false;
    function water(p) {
      var name = p.name || 'Someone';
      setLevels(p, 'water');
      var live = flowers.filter(Boolean), key = (p.flower || '').toLowerCase();
      // gegossen wird die Blume, die der Server gewählt hat (die eigene oder eine zufällige)
      var mine = live.filter(function (f) { return f.label.toLowerCase() === key; })[0];
      var t = mine || (live.length ? live[Math.floor(Math.random() * live.length)] : { x: rand(300, W - 300), y: H - 200 });
      if (key && p.stage !== undefined) {
        var stg = parseInt(p.stage, 10) || 0;
        if (B.yes(p.up) && mine) setTimeout(function () { growFlower(mine, stg); }, B.reduceMotion ? 0 : 1500);
        else flStage[key] = Math.max(flStage[key] || 0, stg);
      }
      if (!(parseFloat(p.done) > 0) && !mine) { B.tag(name + ': the garden is already wet', t.x, t.y - 150, true); return; }
      B.tag(mine && mine.label.toLowerCase() === (p.name || '').toLowerCase() ? name + ' watered their flower!' :
            mine ? name + ' watered ' + mine.label + "'s flower!" : name + ' watered the flowers!', t.x, t.y - 150, true);
      if (B.reduceMotion || watering) return;
      watering = true;
      can.classList.add('is-on');
      var cx = Math.max(140, Math.min(W - 220, t.x - 90)), cy = t.y - 110, t0 = performance.now();
      (function step() {
        var k = Math.min(1, (performance.now() - t0) / 1600);
        can.setAttribute('transform', 'translate(' + cx.toFixed(0) + ' ' + cy.toFixed(0) + ') rotate(' + (Math.min(1, k * 4) * 30).toFixed(0) + ')');
        if (k > 0.2 && k < 0.9 && B.front) {
          for (var i = 0; i < 3; i++) B.front.add({ x: cx + 80 + rand(-6, 6), y: cy + 10, vx: rand(10, 60), vy: rand(0, 80), term: 500, g: 1200, sway: 0, wf: 0, r: rand(2, 3.5), floor: groundY, draw: spray });
        }
        if (k < 1) root.requestAnimationFrame(step); else { can.classList.remove('is-on'); watering = false; }
      })();
    }
    // Blume eine Stufe höher: an Ort und Stelle neu aufbauen, federt groß
    function growFlower(f, stg) {
      flStage[f.label.toLowerCase()] = Math.max(stageOf(f.label), stg);
      var i = flowers.indexOf(f);
      if (i < 0 || f.rip || f.fly || f.knock) return;   // gerade im Sturm: zeigt sich beim nächsten Aufbau
      var next = f.node.nextSibling;
      gFlowers.removeChild(f.node);
      putFlower(f.label, i, false);
      var n = flowers[i];
      gFlowers.insertBefore(n.node, next);   // gleiche Tiefe wie vorher
      if (!B.reduceMotion) {
        n.grow.classList.add('tsp-grow--up');
        setTimeout(function () { n.grow.classList.remove('tsp-grow--up'); }, 1300);
      }
      if (B.on && B.partOn('meadow')) flowerTag(n, f.label + (stg >= 2 ? "'s flower is in full bloom!" : "'s flower is growing!"), true);
    }
    function weed(p) {
      var name = p.name || 'Someone', success = B.yes(p.success);
      setLevels(p, 'weeds');
      var visible = weedNodes.filter(function (w) { return w.node.classList.contains('is-on'); });
      var w = visible[visible.length - 1];
      if (!(parseFloat(p.done) > 0)) { B.tag(name + ': no weeds', W / 2, 300, true); return; }
      var burst = success ? visible : (w ? [w] : []);
      burst.forEach(function (v) {
        for (var i = 0; i < (success ? 3 : 6); i++) {
          if (B.front) B.front.add({ x: v.x, y: v.y - 20, vx: rand(-200, 200), vy: rand(-700, -400), term: 700, sway: 0, wf: 0, r: rand(5, 9), c: '#2f5e22', life: 1.4, draw: petal });
        }
      });
      if (w) B.tag(name + ' pulled weeds', w.x, w.y - 80, false);
      var need = parseInt(p.need, 10) || 0, count = parseInt(p.count, 10) || 0;
      if (success) B.group('Weeds pulled!', 1, 3000);
      else if (need) B.group('Pull together! ' + count + '/' + need, count / need, 20000);
    }
    function celebrate(name) {
      B.pulse('celebrate', 3500);
      for (var i = 0; i < 140; i++) {
        if (B.front) B.front.add({ x: rand(0, W), y: -30 - rand(0, 200), vy: rand(80, 160), term: rand(60, 110), sway: rand(30, 70), r: rand(5, 9), c: PETALS[i % 5], floor: groundY, draw: petal });
      }
      if (name) B.tag('Thank you, ' + name + '!', W / 2, 300, true);
    }

    // ── Spektakel: Windhosen (beliebig viele) und Hagel ──
    var show = null, tws = TS.twisters(), tNow = 0;
    function spectacle(p) {
      if (!B.on || p.reduced || (p.type !== 'tornado' && p.type !== 'hail')) return;
      show = p;
      tws.add(p);
      if (p.type === 'tornado' && B.partOn('meadow')) {
        // 2–4 Blüten reißt die Windhose ab, sobald sie vorbeikommt
        var cand = flowers.filter(function (f) { return f && !f.rip; });
        for (var c = Math.min(cand.length, 2 + Math.floor(Math.random() * 3)); c > 0; c--) {
          var ci = Math.floor(Math.random() * cand.length);
          cand[ci].rip = 'wait';
          cand.splice(ci, 1);
        }
      }
      if (p.type !== 'hail' || !B.partOn('meadow')) return;
      // ein paar Blumen werden während des Schauers getroffen
      var pool = flowers.filter(Boolean), n = Math.min(pool.length, 3 + Math.floor(Math.random() * 3));
      for (var i = 0; i < n; i++) {
        var k = Math.floor(Math.random() * pool.length);
        pool[k].hitIn = rand(0.8, 4.4);
        pool.splice(k, 1);
      }
    }
    function flowerPetal(f, vx, vy) {
      if (!B.front) return;
      var a = f.ang * Math.PI / 180;
      var wet = clamp01(B.rain * 2);
      B.front.add({ x: f.x + Math.sin(a) * f.h, y: f.y + f.h - Math.cos(a) * f.h, vx: vx, vy: vy, g: 500, term: rand(50, 90) + 160 * wet,
                    sway: rand(30, 80) * (1 - 0.85 * wet), r: rand(4, 7), c: f.c.charAt(0) === '#' ? dimCol(f.c) : f.c, life: rand(2.5, 4), floor: groundY, draw: petal });
    }
    // ── Abgerissene Blüten: Kopf (Kopie) wirbelt im Trichter, eine andere
    // Windhose kann ihn übernehmen; ohne Windhose segelt er davon und blendet
    // aus. Der Stiel bleibt geknickt, nach 20–30 s wächst eine neue Blüte ──
    var flyHeads = [];
    function ripHead(f, tn) {
      var dir = tn.dir || (tn.x < f.x ? 1 : -1);
      var g = el('g', {}, gFlyHeads), copy = f.head.cloneNode(true);
      copy.classList.remove('is-spot', 'is-hop');
      g.appendChild(copy);
      f.head.classList.add('tsp-head--gone');
      f.rip = 'gone';
      f.knock = -dir * rand(55, 75);
      f.holdFor = rand(20, 30);
      var h = { g: g, f: f, x: f.x, y: f.y, k: f.hk, lx: 0, ly: 0, spin: 0, op: 1, mode: 'up', tw: tn.t, drop: null,
                held: 0, peak: rand(160, 320), vx: 0, vy: 0 };
      f.fly = h;
      flyHeads.push(h);
      flowerPetal(f, dir * rand(150, 350), rand(-500, -250));
    }
    function regrowHead(f) {
      f.rip = null;
      f.head.classList.remove('tsp-head--gone');
      f.head.classList.add('tsp-head--regrow');
      setTimeout(function () { f.head.classList.remove('tsp-head--regrow'); }, 1300);
    }
    function stepHeads(dt) {
      flyHeads = flyHeads.filter(function (h) {
        var px = h.x + h.lx, tn = tws.near(px, h.mode === 'up' ? h.tw : h.drop);
        if (tn && Math.abs(tn.x - px) < 100 && (h.mode === 'drift' || h.held > 1)) {
          if (h.mode === 'drift') { h.peak = Math.max(h.peak, h.ly) + rand(20, 60); h.op = 1; }
          h.mode = 'up'; h.tw = tn.t; h.held = 0;
        }
        if (h.mode === 'up') {
          h.held += dt;
          var tx = h.tw && h.tw.active() ? h.tw.x() : null, dir = (h.tw && h.tw.dir) || 1;
          h.ly += (h.peak - h.ly) * Math.min(1, dt * 2.5);
          h.lx += (((tx === null ? px : tx) - h.x) + Math.sin(tNow * 8 + h.x) * 40 - h.lx) * Math.min(1, dt * 3);
          h.spin += dt * 420 * dir;
          if (tx === null || tx < -100 || tx > W + 100) {
            h.mode = 'drift'; h.drop = h.tw; h.tw = null;
            h.vx = dir * rand(180, 320); h.vy = -rand(40, 120);
          }
        } else {
          // ohne Windhose: segelt mit dem Schwung davon, sinkt langsam, blendet aus
          h.vy += 120 * dt;
          h.lx += h.vx * dt; h.ly -= h.vy * dt;
          h.spin += dt * 120 * (h.vx < 0 ? -1 : 1);
          h.op -= dt / 2.5;
        }
        var sx = h.x + h.lx;
        if (h.op <= 0 || sx < -150 || sx > W + 150) {
          h.g.parentNode.removeChild(h.g);
          if (h.f.fly === h) h.f.fly = null;
          return false;
        }
        h.g.setAttribute('transform', 'translate(' + f1(sx) + ' ' + f1(h.y - h.ly) + ') rotate(' + f1(h.spin) + ') scale(' + h.k.toFixed(2) + ')');
        var o = Math.max(0, Math.min(1, h.op)).toFixed(2);
        if (o !== h.o) { h.o = o; h.g.setAttribute('opacity', o); }
        return true;
      });
    }
    // Namensschild an der Blume: fliegt mit dem abgerissenen Kopf mit
    function flowerAt(f) { return f.fly ? [f.fly.x + f.fly.lx, f.fly.y - f.fly.ly] : [f.x, f.y]; }
    function flowerTag(f, text, big) {
      var at = flowerAt(f), t = B.tag(text, at[0], at[1] - 50, big);
      if (t) f.tag = { el: t, x: at[0], y: at[1] };
    }
    function followTag(f) {
      var t = f.tag;
      if (!t) return;
      if (!t.el.parentNode) { f.tag = null; return; }
      var at = flowerAt(f), dx = at[0] - t.x, dy = at[1] - t.y;
      t.el.setAttribute('transform', Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3 ? '' : 'translate(' + f1(dx) + ' ' + f1(dy) + ')');
    }
    // Böe: alle Blumen biegen sich in Windrichtung und federn nach, ein paar
    // Blütenblätter fliegen ab, der Zweig verliert eine Wolke Blüten
    var gustT = 0, gustDir = 1, GUST = 1.8, flBusy = false;
    function gust(p) {
      gustDir = B.gust(1000, p);
      for (var i = 0; i < 40 && blossoms.length; i++) { var b = blossoms[Math.floor(Math.random() * blossoms.length)]; blossomPetal(b[0], b[1]); }
      if (!B.on || B.reduceMotion || !B.partOn('meadow')) return;
      gustT = GUST;
      flowers.forEach(function (f) {
        if (f && !f.rip && Math.random() < 0.4 * B.gustK) flowerPetal(f, gustDir * B.gustK * rand(250, 520), rand(-320, -120));
      });
    }
    function stepShow(dt) {
      tNow += dt;
      gustT = Math.max(0, gustT - dt);
      // Hüllkurve: schnell rein, langsam raus
      var gEnv = gustT > 0 ? Math.min(1, (GUST - gustT) / 0.2) * (gustT / GUST) : 0;
      stepHeads(dt);
      var live = (show && show.active()) || tws.any();
      var busy = flyHeads.length > 0;
      flowers.forEach(function (f) {
        if (!f) return;
        var want = 0;
        // Windhose: je näher, desto heftiger (zur nächsten hin geneigt), Blätter fliegen
        if (gEnv > 0) want += gustDir * 30 * B.gustK * gEnv * (0.75 + 0.35 * Math.sin(tNow * 13 + f.x * 0.07));
        var tn = tws.near(f.x);
        if (tn && f.rip === 'wait' && !B.reduceMotion && Math.abs(tn.x - f.x) < 90) ripHead(f, tn);
        followTag(f);
        if (tn) {
          var d = tn.x - f.x, str = clamp01(1 - Math.abs(d) / 450);
          want = str * ((d > 0 ? 1 : -1) * 28 + Math.sin(tNow * 8 + f.x * 0.05) * 32);
          if (str > 0.35 && Math.random() < dt * 10 * str) {
            flowerPetal(f, (d > 0 ? 1 : -1) * rand(150, 450) + tn.dir * 200, rand(-650, -250));
          }
        }
        // Hagel: Treffer knickt die Blume um, nach 20–30 s richtet sie sich auf
        if (f.hitIn !== null) {
          f.hitIn -= dt;
          if (f.hitIn <= 0) {
            f.hitIn = null;
            f.knock = (Math.random() < 0.5 ? -1 : 1) * rand(60, 82);
            f.holdFor = rand(20, 30);
            for (var i = 0; i < 3; i++) flowerPetal(f, rand(-120, 120), rand(-300, -120));
          }
          busy = true;
        }
        if (f.knock) {
          f.holdFor -= dt;
          if (f.holdFor <= 0 && f.rip === 'gone') regrowHead(f);
          if (f.holdFor <= 0) {
            f.knock *= Math.pow(0.4, dt);
            if (Math.abs(f.knock) < 0.5) f.knock = 0;
          }
          busy = true;
        }
        want += f.knock;
        // Umknicken schnell, Aufrichten weich
        f.ang += (want - f.ang) * Math.min(1, dt * (Math.abs(want) > Math.abs(f.ang) ? 9 : 4));
        if (Math.abs(f.ang) < 0.05 && !want) f.ang = 0;
        if (Math.abs(f.ang - f.shown) > 0.05) {
          f.shown = f.ang;
          f.bend.setAttribute('transform', f.ang ? 'rotate(' + f.ang.toFixed(1) + ')' : '');
        }
        if (f.ang || f.rip) busy = true;
        if (f.rip === 'wait' && !live) f.rip = null;
      });
      if (show && !live && !busy) show = null;
      flBusy = busy;
    }
    function resetShow() {
      show = null; tws.clear();
      flyHeads.forEach(function (h) { if (h.g.parentNode) h.g.parentNode.removeChild(h.g); });
      flyHeads = [];
      flowers.forEach(function (f) {
        if (!f) return;
        if (f.rip === 'gone') regrowHead(f);
        f.rip = null; f.fly = null;
        f.ang = f.shown = f.knock = 0; f.hitIn = null;
        f.bend.setAttribute('transform', '');
      });
    }

    // ── Wind: Grundströmung aus dem Wetter plus Böenwellen, die mit dem Wind
    // über die Wiese laufen (wie Wogen im Kornfeld). Auch bei Flaute eine
    // leichte Brise. Ergebnis in Grad Auslenkung für einen mittleren Stiel ──
    var windT = 0;
    function windDir() { return B.windBase < -0.05 ? -1 : 1; }
    function windAt(x) {
      var base = Math.abs(B.windBase), d = windDir(), u = x * d;
      var wave = 0.5 + 0.5 * Math.sin((u - (120 + 260 * base) * windT) / 260) * Math.sin((u - 90 * windT) / 610 + 1.7);
      var flick = Math.sin((u - 200 * windT) / 70 + 0.6) * 0.18;
      return d * ((0.1 + 0.6 * base) + (0.12 + 0.9 * base) * (wave + flick));
    }
    function stepSway(dt) {
      windT += dt;
      var gustK = Math.min(1.5, Math.abs(B.gustPx) / 700) * (B.gustPx < 0 ? -1 : 1);
      flowers.forEach(function (f) {
        if (!f || f.fly) return;
        // Federpendel: Wind zieht, der Stiel federt zurück und schwingt nach
        var target = (windAt(f.x) + gustK * 0.6) * (5 + f.h * 0.09) + Math.sin(windT * 2.3 + f.ph) * 0.8;
        var acc = f.wk * f.wk * (target - f.sw) - 2 * f.zeta * f.wk * f.sv;
        f.sv += acc * dt; f.sw += f.sv * dt;
        // Blätter flattern schneller als der Stiel, je mehr Wind, desto heftiger
        var w = Math.abs(target) / 10;
        f.leaves.forEach(function (L) { L.fl = Math.sin(windT * (7 + w * 6) + L.ph) * (2 + 7 * w); });
        if (f.swShown === null || Math.abs(f.sw - f.swShown) > 0.04 || w > 0.05) {
          f.swShown = f.sw;
          poseFlower(f, -f.sv * 0.05);
        }
      });
      // Grashalme: je Band geschert, die Welle läuft von Band zu Band
      bladeBands.forEach(function (b) {
        var a = -(windAt(b.x) + gustK * 0.5) * 1.6 * b.k;
        if (b.shown !== null && Math.abs(a - b.shown) < 0.05) return;
        b.shown = a;
        b.g.setAttribute('transform', 'translate(0 ' + (H - 20) + ') skewX(' + f1(a) + ') translate(0 ' + (20 - H) + ')');
      });
      stepBranch(dt, gustK);
    }

    // ── Hauptschleife ──
    var petalAcc = 0, offFor = 99;
    TS.loop(function (dt) {
      var k = B.reduceMotion ? 1 : Math.min(1, dt * 0.8);
      S.water += (S.waterT - S.water) * k;
      S.weeds += (S.weedsT - S.weeds) * k;
      offFor = B.on ? 0 : offFor + dt;
      if (offFor > 3) return;
      if (B.on) { if (show || gustT > 0 || flBusy) stepShow(dt); } else if (show) resetShow();
      if (B.on && !B.reduceMotion) stepSway(Math.min(dt, 0.05));
      // Regen richtet die Köpfe sofort auf, bevor der Wasserstand nachzieht
      var wilt = clamp01((30 - S.water) / 30) * (1 - B.rain);
      var dry = clamp01((55 - S.water) / 55) * (1 - 0.7 * B.rain);
      // Schnee: Köpfe hängen, auch die Sonnenblume ein Stück
      var cold = Math.min(1, B.stepSnow(dt));
      wilt = Math.max(wilt, 0.85 * cold);
      B.vars({ '--tsp-wilt': wilt, '--tsp-dry': dry, '--ts-night': B.night });
      droopSunflower(cold);
      showWeeds(S.weeds);
      if (B.on && B.partOn('branch')) {
        // nachts fallen weniger
        petalAcc += dt * (1.5 + 3 * Math.abs(B.windBase)) * (1 - 0.7 * B.night);
        while (petalAcc >= 1) {
          petalAcc--;
          var b = blossoms[Math.floor(Math.random() * blossoms.length)];
          blossomPetal(b[0], b[1]);
        }
      }
      B.stepParticles(dt);
    });

    // ── Spotlight: alle 8 s eine Blume, jedes 4. Mal der beste Gärtner ──
    var spotRound = 0;
    setInterval(function () {
      if (!B.on || TS.visiting()) return;
      spotRound++;
      if (!B.partOn('meadow')) return;
      var pool = flowers.filter(function (f) { return f && f.label; });
      if (!pool.length) return;
      var f = pool[Math.floor(Math.random() * pool.length)];
      B.spot(f.fly ? f.fly.g.firstChild : f.head);
      flowerTag(f, f.label, false);
    }, 8000);

    return {
      load: function (deco) {
        if (!deco) return;
        clearFlowers();
        flStage = {};
        (deco.flowers || []).forEach(function (f) {
          if (f.stage) flStage[(f.name || '').toLowerCase()] = parseInt(f.stage, 10) || 0;
          addFlower(f.name || '', false);
        });
        flTotal = deco.flower_total || flowers.filter(Boolean).length;
        sunflower.set(deco.project != null ? deco.project : deco.snowman);
      },
      update: function (s) {
        s = s || {};
        B.apply(s);
        var lv = s.seasonLevels || {};
        if (typeof lv.water === 'number') S.waterT = Math.max(0, Math.min(100, lv.water));
        if (typeof lv.weeds === 'number') S.weedsT = Math.max(0, Math.min(100, lv.weeds));
        if (S.first && (typeof lv.water === 'number' || typeof lv.weeds === 'number')) {
          S.water = S.waterT; S.weeds = S.weedsT; S.first = false;    // erster Stand sofort
        }
        if (s.seasonTop && Array.isArray(s.seasonTop.spring)) S.top = s.seasonTop.spring;
      },
      command: function (cmd, p) {
        p = p || {};
        switch (cmd) {
          // Follow: Blume immer anlegen, sichtbar nur im aktiven Thema
          case 'follow':
          case 'flower': addFlower(p.name || '', B.on); flTotal++; break;
          case 'build': sunflower.build(p.name || '', B.on); break;
          case 'whereami': {
            var me = (p.name || '').toLowerCase();
            var fl = flowers.filter(function (f) { return f && f.label && f.label.toLowerCase() === me; })[0];
            if (fl && B.on && B.partOn('meadow') && root.SeasonKit) { root.SeasonKit.hop(fl.fly ? fl.fly.g.firstChild : fl.head); flowerTag(fl, fl.label + ' is right here!', true); }
            else if (!fl && p.visit && B.on && B.partOn('meadow')) visitFlower(p.name || '');
            break;
          }
          case 'snowmanreset': sunflower.reset(B.on); break;
          case 'water': water(p); break;
          case 'weed': weed(p); break;
          case 'bee': sendBee(p.name || ''); break;
          case 'gust': gust(p); break;
          case 'celebrate': celebrate(p.name || ''); break;
          case 'seasonboard': B.board('Top gardeners', S.top); break;
          case 'spectacle': spectacle(p); break;
          case 'clear':
            if (p.kind === 'flowers') clearFlowers();
            else if (p.kind === 'garden') { S.weedsT = 0; S.top = []; }
            break;
        }
      },
      busy: function () { return null; },
      status: function () { return { on: B.on, water: Math.round(S.water), weeds: Math.round(S.weeds), flowers: flTotal, project: sunflower.n() }; }
    };
  }

  root.ThemeSpring = { create: create };
})(typeof window !== 'undefined' ? window : this);
