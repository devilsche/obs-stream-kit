/* Herbst-Thema der Weather-Source: Blätterranke mit Lichtern oben, Ast in
 * der Ecke, fallendes Laub (Wind treibt es zur Seite), Laubhaufen in den
 * Ecken, Follower-Kürbisse mit Namen (nachts leuchten die Gesichter),
 * Vogelscheuche als gemeinsames Sub-Projekt (8 Teile). Spektakel: eine
 * Windhose wirbelt Laub auf und hebt 2–4 Kürbisse an, beim Tsunami
 * schwimmen die Kürbisse kurz auf und setzen sich wieder. Schnee setzt
 * Hauben auf Kürbisse und den Hut der Vogelscheuche, die danach schmelzen.
 * Blitzfeuer: etwa jeder 8. nahe Blitz, der in den Haufen fährt, zündet
 * das Laub (opts.ignite meldet es dem Server), es brennt ein Loch hinein,
 * bei Regen nur Zischen und Glut; !extinguish löscht. Nasses Laub (Regen)
 * wird dunkler und glänzt, weht weniger und trocknet in ~2 min.
 * Optik aus effects/autumn.html; die Laubhöhe rechnet der Server
 * (seasonLevels.leaves), hier wird nur gezeigt. Braucht js/season-kit.js
 * und js/theme-seasons.js.
 *
 *   var theme = ThemeAutumn.create(stageEl, { tags: svgGroup, hud: hudEl });
 *   theme.load(deco);  theme.update(state);  theme.command(cmd, params);
 */
(function (root) {
  'use strict';

  var PART_KEYS = ['garland', 'branch', 'pile', 'leaves', 'pumpkins'];

  // ── Blattformen nach echten Herbstblättern (Stiel bei y≈+24, Spitze bei y≈-20):
  // Spitzahorn (fünf spitz gezähnte Lappen, Adern strahlenförmig vom Stielansatz),
  // Stieleiche (abgerundete Lappen, Öhrchen am Grund, Seitenadern zu den Lappen),
  // Buche/Birke (eiförmig, gesägter Rand, parallele Seitenadern) ──
  var LEAVES = [
    { body: 'M0 -20 L2.5 -14 L5.5 -16.5 L5 -10.5 L8.5 -11.5 L6.5 -6.5 L4 -4.5 L10 -7.5 L14 -12.5 L14 -7.5 L19 -6.5 L15.5 -2.5 L17.5 0.5 L12 1 L8 2 L11.5 5.5 L12 10 L8 8.5 L5.5 11.5 L2.5 8.5 L0.8 11 L-0.8 11 L-2.5 8.5 L-5.5 11.5 L-8 8.5 L-12 10 L-11.5 5.5 L-8 2 L-12 1 L-17.5 0.5 L-15.5 -2.5 L-19 -6.5 L-14 -7.5 L-14 -12.5 L-10 -7.5 L-4 -4.5 L-6.5 -6.5 L-8.5 -11.5 L-5 -10.5 L-5.5 -16.5 L-2.5 -14 Z',
      vein: 'M0 24 L0 10 L0 -15 M0 8 L13 -9 M0 8 L-13 -9 M0 9 L10 7 M0 9 L-10 7 M0 0 L4 -9 M0 0 L-4 -9' },
    { body: 'M0 -20 Q5 -21 4.5 -16 Q2.5 -14 5 -12.5 Q10.5 -12 8 -8 Q5 -7 7.5 -4.5 Q12.5 -3 9.5 1 Q6 2 8.5 5 Q11.5 8.5 7 10 Q4 10.5 4.5 13 Q4 16 0.8 15 L-0.8 15 Q-4 16 -4.5 13 Q-4 10.5 -7 10 Q-11.5 8.5 -8.5 5 Q-6 2 -9.5 1 Q-12.5 -3 -7.5 -4.5 Q-5 -7 -8 -8 Q-10.5 -12 -5 -12.5 Q-2.5 -14 -4.5 -16 Q-5 -21 0 -20 Z',
      vein: 'M0 24 L0 -17 M0 -11 L5 -14 M0 -11 L-5 -14 M0 -6 L8 -9 M0 -6 L-8 -9 M0 -1 L9 -2 M0 -1 L-9 -2 M0 5 L9 6 M0 5 L-9 6' },
    { body: 'M0 -21 L3.7 -18.7 L3.8 -17.4 L6 -16.1 L5.7 -14.8 L7.7 -13.5 L7.2 -12.2 L9 -10.8 L8.3 -9.5 L9.9 -8.2 L8.9 -6.9 L10.3 -5.6 L9.2 -4.3 L10.3 -3 L9 -1.7 L10 -0.4 L8.5 0.9 L9.4 2.2 L7.7 3.5 L8.4 4.8 L6.5 6.2 L7 7.5 L5.1 8.8 L5.4 10.1 L3.3 11.4 L3.5 12.7 L0.8 14 L-0.8 14 L-3.5 12.7 L-3.3 11.4 L-5.4 10.1 L-5.1 8.8 L-7 7.5 L-6.5 6.2 L-8.4 4.8 L-7.7 3.5 L-9.4 2.2 L-8.5 0.9 L-10 -0.4 L-9 -1.7 L-10.3 -3 L-9.2 -4.3 L-10.3 -5.6 L-8.9 -6.9 L-9.9 -8.2 L-8.3 -9.5 L-9 -10.8 L-7.2 -12.2 L-7.7 -13.5 L-5.7 -14.8 L-6 -16.1 L-3.8 -17.4 L-3.7 -18.7 Z',
      vein: 'M0 24 L0 -17 M0 -13 L8.5 -17.5 M0 -13 L-8.5 -17.5 M0 -8.6 L7.9 -13.1 M0 -8.6 L-7.9 -13.1 M0 -4.2 L7.3 -8.7 M0 -4.2 L-7.3 -8.7 M0 0.2 L6.7 -4.3 M0 0.2 L-6.7 -4.3 M0 4.6 L6.1 0.1 M0 4.6 L-6.1 0.1 M0 9 L5.5 4.5 M0 9 L-5.5 4.5' }
  ];
  // natürliche Herbstfarben: gebranntes Orange, Bernstein, Ahornrot, Gold, Eichenbraun
  var PALETTE = ['#c8501a', '#e08a1e', '#a8231e', '#d9a31f', '#8a5a2b'];
  function shade(hex, f) {
    var n = parseInt(hex.replace('#', ''), 16);
    return 'rgb(' + Math.round((n >> 16) * f) + ',' + Math.round(((n >> 8) & 255) * f) + ',' + Math.round((n & 255) * f) + ')';
  }
  var DARK = PALETTE.map(function (c) { return shade(c, 0.62); });
  // verkohlt (Brandloch) und nass in 10 Stufen (fallendes Laub auf Canvas)
  var CHAR = PALETTE.map(function (c) { return shade(c, 0.22); });
  var WETPAL = [];
  for (var wq = 0; wq <= 10; wq++) WETPAL.push(PALETTE.map(function (c) { return shade(c, 1 - 0.4 * wq / 10); }));

  var MAX_PK = 12;
  var MAXH = 190;          // Haufenhöhe bei 100 %
  var BASE = 0.15;         // ein bisschen Laub liegt immer, auch frisch gerecht

  function create(stage, opts) {
    var TS = root.ThemeSeasons;
    var B = TS.base(stage, opts, 'autumn', PART_KEYS);
    var W = B.W, H = B.H, el = B.el, f1 = B.f1, rand = B.rand, clamp01 = B.clamp01;
    var rnd = TS.seeded(11);

    var sheen = el('linearGradient', { id: 'ta-leafsheen', x1: 0, y1: 0, x2: 1, y2: 1 }, B.defs);
    el('stop', { offset: '0', 'class': 'ta-sheen-0' }, sheen);
    el('stop', { offset: '0.6', 'class': 'ta-sheen-1' }, sheen);
    LEAVES.forEach(function (l, i) {
      // Fläche (Farbe vom use), Glanz von oben links, dunklerer Rand, Adern
      var g = el('g', { id: 'ta-lf' + i }, B.defs);
      el('path', { d: l.body }, g);
      el('path', { 'class': 'ta-leaf-sheen', d: l.body }, g);
      el('path', { 'class': 'ta-leaf-rim', d: l.body }, g);
      el('path', { 'class': 'ta-vein', d: l.vein }, g);
      l.p2body = new Path2D(l.body);
      l.p2vein = new Path2D(l.vein);
    });
    var glow = el('filter', { id: 'ta-glow', x: '-200%', y: '-200%', width: '500%', height: '500%' }, B.defs);
    el('feGaussianBlur', { stdDeviation: 6 }, glow);

    function leafUse(parent, i, x, y, rot, s, cls) {
      return el('use', {
        href: '#ta-lf' + i, 'class': cls + ' ta-c' + (1 + Math.floor(rnd() * 5)),
        transform: 'translate(' + f1(x) + ' ' + f1(y) + ') rotate(' + f1(rot) + ') scale(' + s.toFixed(2) + ')'
      }, parent);
    }
    function drawLeaf(ctx, shape, x, y, rot, sx, s, color, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(s * sx, s);
      ctx.fillStyle = color;
      ctx.fill(LEAVES[shape].p2body);
      // dunklerer Rand und feine Adern wie bei echten Blättern
      ctx.strokeStyle = 'rgba(70,25,0,.35)';
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';
      ctx.stroke(LEAVES[shape].p2body);
      ctx.strokeStyle = 'rgba(60,25,0,.42)';
      ctx.lineWidth = 0.9;
      ctx.stroke(LEAVES[shape].p2vein);
      ctx.restore();
    }
    function leafDraw(ctx, p, a) {
      if (p.burnAt !== undefined) { burnDraw(ctx, p, a); return; }
      drawLeaf(ctx, p.shape, p.x, p.y, p.rot, Math.cos(p.ph * 1.3), p.s, WETPAL[Math.round(W8.wet * 10)][p.ci], a);
    }
    // brennendes Blatt: glüht orange, verkohlt von außen, zerfällt zu Asche;
    // landet es noch glühend auf dem Haufen, kann dort ein Feuer entstehen
    function burnDraw(ctx, p, a) {
      var t = p.age - p.burnAt, k = Math.min(1, t / p.burnFor);
      var col = p.smolder ? 'rgb(' + Math.round(70 - 30 * k) + ',' + Math.round(50 - 25 * k) + ',' + Math.round(35 - 20 * k) + ')'
              : k < 0.35 ? 'rgb(255,' + Math.round(150 - 160 * k) + ',40)' : 'rgb(' + Math.round(120 - 90 * k) + ',' + Math.round(45 - 30 * k) + ',' + Math.round(25 - 15 * k) + ')';
      drawLeaf(ctx, p.shape, p.x, p.y, p.rot, Math.cos(p.ph * 1.3), p.s * (1 - 0.45 * k), col, a * (1 - 0.6 * k));
      if (!p.smolder && k < 0.8) {
        ctx.save(); ctx.globalAlpha = a * (0.5 - 0.5 * k); ctx.fillStyle = '#ffb347';
        ctx.beginPath(); ctx.arc(p.x, p.y, 9 * p.s, 0, 6.283); ctx.fill(); ctx.restore();
        if (Math.random() < 0.06) B.sparks(p.x, p.y, 2, 6);
      }
      if (Math.random() < (p.smolder ? 0.05 : 0.03)) B.smoke(p.x, p.y, { o: 0.25 });
      if (!p.landed && !p.smolder && k < 0.7 && p.y >= surface(p.x) - 4) {
        p.landed = true;
        if (Math.random() < 0.2 && enoughAt(p.x) && !flooded(p.x) && !fireAt(p.x) && burning().length < FIRE_MAX) ignite(p.x, 'ember');
      }
      if (k >= 1 && !p.ash) { p.ash = true; p.life = p.age + 0.5; }
    }
    // Blitz: Blätter in der Luft nahe dem Blitzkanal fangen Feuer, im Regen qualmen sie nur;
    // Blätter am Ast in der Nähe glimmen auf und fallen brennend ab
    function igniteLeaves(x) {
      var wet = liveRain() > 0.2;
      [B.back, B.front].forEach(function (ps) {
        if (ps && ps.each) ps.each(function (q) {
          if (q.draw !== leafDraw || q.burnAt !== undefined || Math.abs(q.x - x) > 90 + Math.random() * 60) return;
          q.burnAt = q.age; q.burnFor = rand(1.6, 2.8); q.smolder = wet;
          q.term = (q.term || 80) * (wet ? 1 : 1.8); q.sway *= 0.5;
        });
      });
      if (!B.partOn('branch') || x > 560) return;
      branchLeaves.forEach(function (b) {
        if (b.gone || Math.abs(b.x - x) > 110 || Math.random() < 0.5) return;
        b.gone = true;
        b.node.classList.remove('ta-bl--grow');
        b.node.classList.add('ta-bl--gone');
        spawn({ x: b.x, y: b.y, vy: 20, s: 1.4, burn: true, smolder: wet });
        setTimeout(function () { b.gone = false; b.node.classList.remove('ta-bl--gone'); b.node.classList.add('ta-bl--grow'); }, rand(12000, 20000));
      });
    }
    var W8 = { wet: 0 };   // Nässe 0..1

    // Ebenen: fallendes Laub (Basis), Ranke, Ast, Haufen, Kürbisse
    var gGarland = el('g', { 'class': 'ta-garland' }, B.svg('ta-garland-l'));
    var branchSvg = B.svg('ta-branch-l');
    var gBranch = el('g', { 'class': 'ta-branch ta-dim' }, branchSvg);
    var gSway = el('g', { 'class': 'ta-frostable', id: 'ta-sway-g' }, gBranch);
    // Vogelscheuche hinter dem Laubhaufen (der Pfahl steckt im Laub)
    // Strohballen und Maisgarbe ebenfalls dahinter, Pilze wachsen vor dem Laub
    var scareSvg = B.svg();
    var gDeco = el('g', { 'class': 'ta-deco ta-dim' }, scareSvg);
    var gScare = el('g', { 'class': 'ta-scare ta-dim' }, scareSvg);
    var pileCanvas = B.canvas();
    pileCanvas.classList.add('ta-pile', 'ta-dim');
    var pctx = pileCanvas.getContext('2d');
    var gShrooms = el('g', { 'class': 'ta-shrooms ta-dim' }, B.svg());
    var gPumpkins = el('g', { 'class': 'ta-pumpkins' }, B.svg());

    // ── Blätterranke oben mit Lichtern und Eicheln ──
    var garlandLights = [], garLampPos = [];
    (function () {
      var d = 'M-10 4';
      for (var i = 0; i < 5; i++) {
        var x0 = -10 + i * 388;
        d += ' Q' + (x0 + 194) + ' ' + (i % 2 ? 66 : 80) + ' ' + (x0 + 388) + ' 4';
      }
      // Blätter und Eicheln in eigener Gruppe (nachts gedimmt wie der Ast), darüber
      // der warme Schein der Lämpchen (per Maske nur auf den Blättern), dann die Lämpchen
      // Nachts gedimmt (Hülle); eine ungedimmte Kopie liegt darüber, sichtbar nur in
      // der Lichtmaske um die Lämpchen: dort fällt das Dunklerwerden weg
      var gLeaves = el('g', { id: 'ta-gleaves' }, el('g', { 'class': 'ta-gl-leaves' }, gGarland));
      var litGar = el('g', { 'class': 'ta-lit', mask: 'url(#ta-garland-light)' }, gGarland);
      el('use', { href: '#ta-gleaves' }, litGar);
      var vine = el('path', { 'class': 'ta-vine', d: d }, gLeaves);
      var len = vine.getTotalLength(), n = 0;
      for (var s = 10; s < len; s += 30, n++) {
        var p = vine.getPointAtLength(s);
        var q = vine.getPointAtLength(Math.min(len, s + 1));
        var ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
        var side = n % 2 ? 1 : -1;
        leafUse(gLeaves, n % 3, p.x, p.y, 180 + ang + side * (30 + rnd() * 25), 1.1 + rnd() * 0.5, 'ta-vleaf');
        if (n % 9 === 4) {
          var a = el('g', { transform: 'translate(' + f1(p.x) + ' ' + f1(p.y + 8) + ')' }, gLeaves);
          el('ellipse', { 'class': 'ta-acorn-nut', cx: 0, cy: 14, rx: 8, ry: 11 }, a);
          el('path', { 'class': 'ta-acorn-cap', d: 'M-10 6 Q0 -6 10 6 Q0 10 -10 6 Z' }, a);
        }
        if (n % 2 === 0) {
          var fl = el('g', { 'class': 'ta-fl ri-' + Math.floor(rnd() * 10), transform: 'translate(' + f1(p.x) + ' ' + f1(p.y + 6) + ')' }, gGarland);
          garlandLights.push([p.x, p.y + 6]);
          garLampPos.push([p.x, p.y + 6]);
          el('circle', { 'class': 'ta-fl-glow', r: 11 }, fl);
          el('circle', { 'class': 'ta-fl-dot', r: 4 }, fl);
        }
      }
    })();

    // ── Ast oben links: Eichenrinde (dunkel, Glanzkante, Risse, Knoten),
    // Blätter in Büscheln an kurzen Stielen, dazwischen Eicheln und Ahorn-
    // Propeller. Bewegt sich gestaffelt mit dem Wind: Hauptast langsam, Zweige
    // schneller, Büschel flattern; nasses Laub hängt schwer, Raureif im
    // Schneesturm. Bei Böen fallen Eicheln und Propeller (drehen sich) ──
    var branchLeaves = [], aTwigs = [], aClusters = [], seeds = [];
    var iceDef = el('g', { id: 'ta-ice' }, B.defs);
    for (var ii = 0; ii < 3; ii++) {
      el('path', { 'class': 'ta-ice-l', d: 'M0 -4.5 L0 4.5 M-1.3 -3.2 L0 -2.2 L1.3 -3.2 M-1.3 3.2 L0 2.2 L1.3 3.2', transform: 'rotate(' + ii * 60 + ')' }, iceDef);
    }
    var acornDef = el('g', { id: 'ta-acorn' }, B.defs);
    el('ellipse', { 'class': 'ta-acorn-nut', cx: 0, cy: 9, rx: 5, ry: 7 }, acornDef);
    el('path', { 'class': 'ta-acorn-cap', d: 'M-6.5 4 Q0 -4 6.5 4 Q0 7 -6.5 4 Z' }, acornDef);
    el('path', { 'class': 'ta-acorn-stalk', d: 'M0 -3 L0 0' }, acornDef);
    var samDef = el('g', { id: 'ta-samara' }, B.defs);
    el('path', { 'class': 'ta-samara-wing', d: 'M0 0 C-4 6 -16 14 -22 12 C-16 8 -8 4 -1 -1 Z' }, samDef);
    el('path', { 'class': 'ta-samara-wing', d: 'M0 0 C4 6 16 14 22 12 C16 8 8 4 1 -1 Z' }, samDef);
    el('circle', { 'class': 'ta-samara-seed', r: 2.6 }, samDef);
    var A_TWIGS = [
      { d: 'M-20 150 Q120 130 260 170 Q360 200 430 190', w: 16, at: [-20, 150], f: 0.2, amp: 0.6 },
      { d: 'M120 140 Q170 90 240 70', w: 7, at: [120, 140], f: 0.5, amp: 2 },
      { d: 'M240 165 Q290 230 270 290', w: 6, at: [240, 165], f: 0.45, amp: 1.8 },
      { d: 'M330 190 Q380 150 440 140', w: 5, at: [330, 190], f: 0.6, amp: 2.4 },
      { d: 'M60 146 Q80 200 60 250', w: 5, at: [60, 146], f: 0.55, amp: 2 }
    ];
    var aMain = null;
    A_TWIGS.forEach(function (t, ti) {
      var tg = el('g', {}, ti ? aMain : gSway);
      if (!ti) aMain = tg;
      el('path', { 'class': 'ta-wood', d: t.d, 'stroke-width': t.w }, tg);
      var hi = el('path', { 'class': 'ta-wood-hi', d: t.d, 'stroke-width': (t.w * 0.3).toFixed(1), transform: 'translate(0 ' + f1(-t.w * 0.25) + ')' }, tg);
      var len = hi.getTotalLength();
      function ptAt(s) {
        var a = hi.getPointAtLength(s), b = hi.getPointAtLength(Math.min(len, s + 1));
        var dx = b.x - a.x, dy = b.y - a.y, n = Math.hypot(dx, dy) || 1;
        return { x: a.x, y: a.y + t.w * 0.25, tx: dx / n, ty: dy / n };
      }
      // Risse längs der Faser, auf dem Hauptast ein paar Knoten
      for (var cs = 12; t.w >= 6 && cs < len - 10; cs += 14 + rnd() * 18) {
        var c = ptAt(cs), off = (rnd() - 0.5) * t.w * 0.5, cl = 6 + rnd() * 8;
        el('path', { 'class': 'ta-crack', d: 'M' + f1(c.x - c.ty * off) + ' ' + f1(c.y + c.tx * off) + ' l' + f1(c.tx * cl) + ' ' + f1(c.ty * cl) }, tg);
      }
      if (!ti) [0.35, 0.62].forEach(function (k) { var q = ptAt(len * k); el('ellipse', { 'class': 'ta-knot', cx: f1(q.x), cy: f1(q.y + 1), rx: 4, ry: 2.6 }, tg); });
      aTwigs.push({ g: tg, x: t.at[0], y: t.at[1], f: t.f, amp: t.amp, ph: rnd() * 6.28, shown: null });
      for (var s = len * (ti ? 0.25 : 0.3); s < len; s += 42 + rnd() * 20) {
        var pt = ptAt(s), side = rnd() < 0.6 ? 1 : -1;
        var nx = -pt.ty * side, ny = pt.tx * side;
        if (ny < -0.2) { nx = -nx; ny = -ny; }        // Büschel hängen eher nach unten
        var cg = el('g', {}, tg), ex = pt.x + nx * (t.w * 0.5 + 4), ey = pt.y + ny * (t.w * 0.5 + 4);
        el('path', { 'class': 'ta-stalk', d: 'M' + f1(pt.x) + ' ' + f1(pt.y) + ' L' + f1(ex) + ' ' + f1(ey) }, cg);
        var n = 2 + Math.floor(rnd() * 2);
        for (var k = 0; k < n; k++) {
          var ang = Math.atan2(ny, nx) + (k - (n - 1) / 2) * 0.7 + (rnd() - 0.5) * 0.3, pl = 2 + rnd() * 3;
          var lx = ex + Math.cos(ang) * pl, ly = ey + Math.sin(ang) * pl;
          // Blattspitze zeigt vom Stiel weg (Form zeigt nach -y)
          var u = leafUse(cg, Math.floor(rnd() * 3), lx, ly, ang * 57.3 + 90, 1 + rnd() * 0.4, 'ta-bl');
          branchLeaves.push({ node: u, x: lx, y: ly, gone: false });
        }
        // ab und zu Eicheln (Hauptast, dicke Zweige) oder ein Ahorn-Propellerpaar
        var r = rnd();
        if (r < 0.22 || (r < 0.4 && t.w < 7)) {
          var kind = t.w >= 6 && r < 0.22 ? 'acorn' : 'samara';
          var sx = ex + nx * 6, sy = ey + Math.max(4, ny * 6) + 2;
          var sn = el('use', { href: '#ta-' + kind, 'class': 'ta-seed', transform: 'translate(' + f1(sx) + ' ' + f1(sy) + ') rotate(' + f1((rnd() - 0.5) * 30) + ')' }, cg);
          seeds.push({ node: sn, x: sx, y: sy, kind: kind, gone: false });
        }
        el('use', { href: '#ta-ice', 'class': 'ta-ice', transform: 'translate(' + f1(ex + nx * 6) + ' ' + f1(ey + ny * 6) + ')' }, cg);
        aClusters.push({ g: cg, x: pt.x, y: pt.y, f: 1.6 + rnd() * 1.4, ph: rnd() * 6.28, shown: null });
      }
    });
    // Lichterkette beleuchtet nachts: Lichtmasken (weiß in der Mitte, weich zum
    // Rand) um die Lämpchen; darin zeigt eine ungedimmte Kopie von Ranke bzw. Ast
    // die echten Farben – das nächtliche Dunklerwerden fällt dort weg
    (function () {
      var lg = el('radialGradient', { id: 'ta-lampg' }, B.defs);
      el('stop', { offset: '0', 'class': 'ta-lampg-0' }, lg);
      el('stop', { offset: '0.5', 'class': 'ta-lampg-m' }, lg);
      el('stop', { offset: '1', 'class': 'ta-lampg-1' }, lg);
      function lightMask(id, list, r) {
        var m = el('mask', { id: id, maskUnits: 'userSpaceOnUse', x: -100, y: -100, width: W + 200, height: 600 }, B.defs);
        list.forEach(function (l) { el('circle', { 'class': 'ta-lamp', cx: f1(l[0]), cy: f1(l[1]), r: r }, m); });
      }
      lightMask('ta-garland-light', garLampPos, 70);
      lightMask('ta-branch-light', garlandLights.filter(function (l) { return l[0] < 640; }), 230);
      var lit = el('g', { 'class': 'ta-lit ta-lit--branch', mask: 'url(#ta-branch-light)' }, branchSvg);
      el('use', { href: '#ta-sway-g' }, lit);
    })();
    // ── Erntedeko: Strohballen rechts (gestapelt), ein Ballen und eine
    // Maisgarbe links neben der Vogelscheuche; die Maisblätter rascheln im Wind ──
    var cornLeaves = [];
    function bale(x, y, w, h) {
      var g = el('g', { transform: 'translate(' + f1(x) + ' ' + f1(y) + ')' }, gDeco);
      el('rect', { 'class': 'ta-bale', x: f1(-w / 2), y: f1(-h), width: f1(w), height: f1(h), rx: 7 }, g);
      el('rect', { 'class': 'ta-bale-top', x: f1(-w / 2 + 3), y: f1(-h + 2), width: f1(w - 6), height: 7, rx: 4 }, g);
      var d = '';
      for (var i = 0; i < 26; i++) {
        var sx = -w / 2 + 5 + rnd() * (w - 10), sy = -h + 8 + rnd() * (h - 12), l = 5 + rnd() * 8, a = (rnd() - 0.5) * 0.8;
        d += 'M' + f1(sx) + ' ' + f1(sy) + ' l' + f1(Math.cos(a) * l) + ' ' + f1(Math.sin(a) * l) + ' ';
      }
      el('path', { 'class': 'ta-bale-straw', d: d }, g);
      [-0.25, 0.25].forEach(function (k) { el('path', { 'class': 'ta-bale-twine', d: 'M' + f1(w * k) + ' ' + f1(-h + 1) + ' L' + f1(w * k) + ' -1' }, g); });
      // ein paar Halme stehen über den Rand
      for (var j = 0; j < 6; j++) {
        var hx = -w / 2 + rnd() * w;
        el('path', { 'class': 'ta-bale-wisp', d: 'M' + f1(hx) + ' ' + f1(-h + 2) + ' q' + f1((rnd() - 0.5) * 8) + ' ' + f1(-4 - rnd() * 4) + ' ' + f1((rnd() - 0.5) * 12) + ' ' + f1(-6 - rnd() * 5) }, g);
      }
    }
    bale(W - 610, H - 2, 92, 46); bale(W - 512, H - 2, 92, 46); bale(W - 560, H - 46, 88, 44);
    bale(470, H - 2, 84, 42);
    (function cornSheaf(x, y) {
      var g = el('g', { 'class': 'ta-corn', transform: 'translate(' + x + ' ' + y + ')' }, gDeco);
      var n = 11;
      for (var i = 0; i < n; i++) {
        var k = (i - (n - 1) / 2) / ((n - 1) / 2), bx = k * 20, tx = k * 3, topx = k * 34 + (rnd() - 0.5) * 8, topy = -230 - rnd() * 30;
        el('path', { 'class': 'ta-corn-stalk', d: 'M' + f1(bx) + ' 0 L' + f1(tx) + ' -110 Q' + f1(tx + (topx - tx) * 0.3) + ' -170 ' + f1(topx) + ' ' + f1(topy) }, g);
        // Rispe oben
        el('path', { 'class': 'ta-corn-tassel', d: 'M' + f1(topx) + ' ' + f1(topy) + ' l-4 -10 M' + f1(topx) + ' ' + f1(topy) + ' l3 -12 M' + f1(topx) + ' ' + f1(topy) + ' l7 -7' }, g);
        // hängende, trockene Blätter in zwei Höhen
        [0.35, 0.7].forEach(function (h, j) {
          if (rnd() < 0.3) return;
          var t = h, px = tx + (topx - tx) * (t - 0.0) * 0.6, py = -110 - (topy + 110) * -t;
          var side = rnd() < 0.5 ? -1 : 1, L = 50 + rnd() * 30;
          var lg = el('g', { transform: 'translate(' + f1(px) + ' ' + f1(py) + ')' }, g);
          el('path', { 'class': 'ta-corn-leaf' + (rnd() < 0.4 ? ' ta-corn-leaf--b' : ''), d: 'M0 0 Q' + f1(side * L * 0.5) + ' ' + f1(-12) + ' ' + f1(side * L) + ' ' + f1(18 + rnd() * 20) + ' Q' + f1(side * L * 0.45) + ' -4 0 5 Z' }, lg);
          cornLeaves.push({ g: lg, x: px, y: py, ph: rnd() * 6.28, f: 0.8 + rnd() * 0.8, side: side, gx: x, gy: y });
        });
      }
      // Bindfaden und zwei Kolben am Fuß
      el('path', { 'class': 'ta-corn-tie', d: 'M-12 -112 Q0 -104 12 -112 M-12 -106 Q0 -98 12 -106' }, g);
      [[-26, -8, -25], [24, -6, 22]].forEach(function (c) {
        var cg = el('g', { transform: 'translate(' + c[0] + ' ' + c[1] + ') rotate(' + c[2] + ')' }, g);
        el('ellipse', { 'class': 'ta-cob', cx: 0, cy: -16, rx: 6.5, ry: 17 }, cg);
        el('path', { 'class': 'ta-cob-rows', d: 'M-3 -30 L-3 -2 M0 -32 L0 0 M3 -30 L3 -2' }, cg);
        el('path', { 'class': 'ta-husk', d: 'M0 0 Q-14 -12 -10 -34 Q-5 -14 0 -4 Q5 -14 10 -34 Q14 -12 0 0 Z' }, cg);
      });
    })(395, H - 4);
    function stepCorn(w, dir) {
      cornLeaves.forEach(function (L) {
        var a = (Math.sin(aWindT * L.f * 6.283 + L.ph) * (2 + 9 * w) + dir * w * 6) * (1 - 0.5 * W8.wet);
        L.g.setAttribute('transform', 'translate(' + f1(L.x) + ' ' + f1(L.y) + ') rotate(' + f1(a) + ')');
      });
    }

    // ── Pilze nach Regen: solange es nass ist, wachsen nach und nach Fliegen-
    // pilze und Steinpilze aus dem Laub (bis zu 7), nach dem Abtrocknen
    // vergehen sie nach 2–4 min; ein Feuer an der Stelle lässt sie welken ──
    var shrooms = [], shroomAcc = 0;
    function makeShroom(x) {
      var fly = Math.random() < 0.55, g = el('g', {}, gShrooms), s = 1.1 + Math.random() * 0.5;
      var inner = el('g', { transform: 'scale(' + s.toFixed(2) + ')' }, g);
      if (fly) {
        el('path', { 'class': 'ta-shroom-stem', d: 'M-5 0 Q-6 -14 -4 -26 L4 -26 Q6 -14 5 0 Z' }, inner);
        el('path', { 'class': 'ta-shroom-ring', d: 'M-6 -18 Q0 -14 6 -18 L5 -21 Q0 -18 -5 -21 Z' }, inner);
        el('path', { 'class': 'ta-shroom-gills', d: 'M-16 -26 Q0 -21 16 -26 Z' }, inner);
        el('path', { 'class': 'ta-shroom-red', d: 'M-17 -26 Q-17 -44 0 -45 Q17 -44 17 -26 Q0 -22 -17 -26 Z' }, inner);
        [[-9, -33, 2.2], [-2, -40, 1.8], [6, -36, 2.4], [11, -30, 1.6], [-12, -29, 1.4], [1, -31, 1.5]].forEach(function (d) {
          el('circle', { 'class': 'ta-shroom-dot', cx: d[0], cy: d[1], r: d[2] }, inner);
        });
      } else {
        el('path', { 'class': 'ta-shroom-stem ta-shroom-stem--porcini', d: 'M-8 0 Q-11 -10 -6 -20 L6 -20 Q11 -10 8 0 Z' }, inner);
        el('path', { 'class': 'ta-shroom-brown', d: 'M-15 -19 Q-15 -36 0 -37 Q15 -36 15 -19 Q0 -15 -15 -19 Z' }, inner);
        el('ellipse', { 'class': 'ta-shroom-sheen', cx: -5, cy: -30, rx: 4, ry: 2.2 }, inner);
      }
      return { g: g, x: x, grow: 0, dry: 0, life: 120 + Math.random() * 120, gone: false };
    }
    function stepShrooms(dt) {
      if (!B.on || !B.partOn('pile')) return;
      if (W8.wet > 0.5 && !B.reduceMotion) {
        shroomAcc += dt;
        if (shroomAcc > (shrooms.length ? 6 + Math.random() * 6 : 3) && shrooms.length < 7) {
          shroomAcc = 0;
          var side = Math.random() < 0.5, x = side ? 40 + Math.random() * 540 : W - 40 - Math.random() * 540;
          if (!fireAt(x)) {
            var n = Math.random() < 0.4 ? 2 : 1;
            for (var i = 0; i < n; i++) shrooms.push(makeShroom(x + i * (14 + Math.random() * 10) * (side ? 1 : -1)));
          }
        }
      }
      shrooms = shrooms.filter(function (m) {
        if (W8.wet < 0.1) m.dry += dt;
        var dying = m.dry > m.life || fireAt(m.x) || flooded(m.x);
        m.grow = dying ? Math.max(0, m.grow - dt / 2.5) : Math.min(1, m.grow + dt / 3);
        if (dying && m.grow <= 0) { m.g.parentNode.removeChild(m.g); return false; }
        var e = m.grow < 1 ? 1 - Math.pow(1 - m.grow, 3) : 1;
        m.g.setAttribute('transform', 'translate(' + f1(m.x) + ' ' + f1(surface(m.x) + 6) + ') scale(' + (e * (dying ? 1 : 1)).toFixed(3) + ' ' + e.toFixed(3) + ')');
        m.g.setAttribute('opacity', dying ? Math.min(1, m.grow * 1.5).toFixed(2) : '1');
        return true;
      });
    }

    var aWindT = 0, aFrost = 0, aFrostShown = null;
    function stepBranch(dt) {
      if (!B.on || B.reduceMotion) return;
      aWindT += dt;
      var gk = Math.min(1.5, Math.abs(B.gustPx) / 700);
      var w = Math.abs(B.windBase) * (0.6 + 0.4 * Math.sin(aWindT * 0.7)) + gk * 0.8 + 0.12;
      var dir = (B.gustPx || B.windBase) < 0 ? -1 : 1, heavy = 1 - 0.5 * W8.wet, stiff = 1 - 0.85 * aFrost;
      stepCorn(w, dir);
      if (!B.partOn('branch')) return;
      var lean = dir * Math.min(1.5, w) * 0.8;
      aTwigs.forEach(function (t, ti) {
        var a = ((ti ? lean * 1.5 : lean * 0.5) + Math.sin(aWindT * t.f * 6.283 + t.ph) * t.amp * (0.35 + w)) * heavy * stiff;
        if (t.shown !== null && Math.abs(a - t.shown) < 0.02) return;
        t.shown = a;
        t.g.setAttribute('transform', 'rotate(' + a.toFixed(2) + ' ' + t.x + ' ' + t.y + ')');
      });
      aClusters.forEach(function (c) {
        var a = (Math.sin(aWindT * c.f * 6.283 + c.ph) * (2 + 10 * w) + lean * 3) * heavy * stiff;
        if (c.shown !== null && Math.abs(a - c.shown) < 0.05) return;
        c.shown = a;
        c.g.setAttribute('transform', 'rotate(' + a.toFixed(1) + ' ' + f1(c.x) + ' ' + f1(c.y) + ')');
      });
    }
    // Raureif im Schneesturm (in ~6 s), taut danach in ~1 min ab
    function stepAFrost(dt) {
      var want = B.on && opts.blizzard && opts.blizzard() > 0.15 ? 1 : 0;
      aFrost = B.reduceMotion ? want : want > aFrost ? Math.min(1, aFrost + dt / 6) : Math.max(0, aFrost - dt / 60);
      B.vars({ '--ta-frost': aFrost });
      var on = aFrost > 0.01 ? '1' : '0';
      if (on !== aFrostShown) { aFrostShown = on; B.root.dataset.frost = on; }
    }
    // Eichel fällt gerade und springt kurz auf, Propeller trudelt drehend langsam herab
    function seedDraw(ctx, p, a) {
      ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y);
      if (p.kind === 'acorn') {
        ctx.rotate(p.rot * 0.3);
        ctx.fillStyle = '#9a6a2e'; ctx.beginPath(); ctx.ellipse(0, 3, 4, 5.5, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#5e4022'; ctx.beginPath(); ctx.ellipse(0, -1.5, 5, 2.6, 0, 3.14, 6.283); ctx.fill();
      } else {
        ctx.rotate(p.ph * 3); ctx.scale(Math.cos(p.ph * 6) * 0.5 + 0.6, 1);
        ctx.fillStyle = '#c99a4a';
        ctx.beginPath(); ctx.ellipse(-9, 3, 10, 3.2, 0.35, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.ellipse(9, 3, 10, 3.2, -0.35, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#7a5226'; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, 6.283); ctx.fill();
      }
      ctx.restore();
    }
    function dropSeeds(n) {
      if (!B.on || !B.partOn('branch') || !B.back) return;
      var live = seeds.filter(function (s) { return !s.gone; });
      for (var i = 0; i < n && live.length; i++) {
        var s = live.splice(Math.floor(Math.random() * live.length), 1)[0];
        s.gone = true; s.node.classList.add('ta-bl--gone');
        B.back.add(s.kind === 'acorn'
          ? { x: s.x, y: s.y, vx: rand(-30, 30), vy: 40, g: 1300, term: 700, sway: 0, wf: 0.2, kind: 'acorn', vr: rand(-4, 4), floor: function (x) { return surface(x) + 4; }, draw: seedDraw }
          : { x: s.x, y: s.y, vx: rand(-20, 20), vy: 10, g: 120, term: rand(45, 70), sway: rand(20, 40), vph: rand(4, 7), wf: 1, kind: 'samara', floor: function (x) { return surface(x) + 4; }, draw: seedDraw });
        (function (sd) { setTimeout(function () { sd.gone = false; sd.node.classList.remove('ta-bl--gone'); sd.node.classList.add('ta-bl--grow'); }, rand(20000, 40000)); })(s);
      }
    }

    // ── Laubhaufen in den Ecken (Mitte bleibt frei) ──
    function prof(x) {
      var w = 660;
      function bump(d) { return d < w ? 0.5 + 0.5 * Math.cos(Math.PI * d / w) : 0; }
      return Math.max(bump(x), bump(W - x) * 0.92);
    }
    function drawnLevel(pct) { return BASE + (1 - BASE) * pct / 100; }
    var S = { target: 0, shown: 0, first: true, top: [] };
    function lvl() { return B.partOn('pile') ? drawnLevel(S.shown) : 0; }
    // Brandlöcher: Senke im Profil (Anteil der Höhe), wächst beim Brennen,
    // füllt sich danach langsam wieder; der gemeinsame Laubstand beider Haufen bleibt
    var dips = [];
    function dipAt(x) {
      var d = 0;
      for (var i = 0; i < dips.length; i++) { var u = (x - dips[i].x) / dips[i].w; d += dips[i].d * Math.exp(-u * u); }
      return Math.min(0.85, d);
    }
    function surface(x, l) { return H - prof(x) * (1 - dipAt(x)) * MAXH * (l === undefined ? lvl() : l); }

    var pileLeaves = [];
    for (var k = 0; k < 2600; k++) {
      pileLeaves.push({
        x: rnd() * W, f: rnd(), shape: Math.floor(rnd() * 3), rot: rnd() * Math.PI * 2,
        s: 0.9 + rnd() * 0.7, ci: Math.floor(rnd() * 5), dk: rnd() < 0.45, jy: rnd() * 10, thin: rnd()
      });
    }
    pileLeaves.sort(function (a, b) { return a.f - b.f; });
    function drawPile(l) {
      pctx.clearRect(0, 0, W, H);
      var g = pctx.createLinearGradient(0, H - MAXH, 0, H);
      g.addColorStop(0, '#7a3e10'); g.addColorStop(1, '#3d1d06');
      pctx.fillStyle = g;
      pctx.beginPath();
      pctx.moveTo(0, H);
      for (var x = 0; x <= W; x += 16) pctx.lineTo(x, H - prof(x) * (1 - dipAt(x)) * MAXH * l * 0.88);
      pctx.lineTo(W, H);
      pctx.fill();
      var wet = W8.wet;
      for (var i = 0; i < pileLeaves.length; i++) {
        var lf = pileLeaves[i];
        if (lf.f > l) break;
        var pr = prof(lf.x);
        if (pr < 0.04 || lf.thin > pr * 1.4) continue;     // flache Stellen dünner belegen
        var dp = dips.length ? dipAt(lf.x) : 0, top = l * (1 - dp);
        if (lf.f > top) continue;                          // im Brandloch weg
        var y = H - pr * MAXH * lf.f + lf.jy - 4;
        // am Rand des Brandlochs verkohlt
        var col = dp > 0.04 && lf.f > top - 0.12 ? CHAR[lf.ci] : lf.dk && lf.f < l - 0.08 ? DARK[lf.ci] : PALETTE[lf.ci];
        drawLeaf(pctx, lf.shape, lf.x, y, lf.rot, 1, lf.s, col, 1);
        // nass: kleine Glanzlichter auf den obersten Blättern
        if (wet > 0.05 && i % 4 === 0 && lf.f > top - 0.2) {
          pctx.globalAlpha = 0.4 * wet;
          pctx.fillStyle = '#fff6e6';
          pctx.beginPath();
          pctx.ellipse(lf.x - 3 * lf.s, y - 5 * lf.s, 2.2 * lf.s, 6 * lf.s, lf.rot, 0, 6.283);
          pctx.fill();
          pctx.globalAlpha = 1;
        }
      }
      drawPileSnow(l);
    }

    // Schnee auf dem Haufen: Puder ab wenig Schnee, bei viel Schnee eine
    // dicke Decke, aus der nur noch einzelne Blätter schauen
    function drawPileSnow(l) {
      var sn = Math.min(1.2, B.snow);
      if (sn < 0.03) return;
      var thick = 3 + 14 * sn, pts = [];
      for (var x = 0; x <= W; x += 12) {
        var y = H - prof(x) * (1 - dipAt(x)) * MAXH * l * 0.88;
        pts.push([x, Math.min(H, y + 6) - thick * (0.75 + 0.25 * Math.sin(x / 37))]);
      }
      pctx.save();
      pctx.fillStyle = '#f4f8ff';
      pctx.strokeStyle = '#ffffff';
      // Puder: zarter Schleier; viel Schnee deckt den Haufen fast ganz zu
      pctx.globalAlpha = Math.min(1, sn * 2.5) * (sn > 0.5 ? Math.min(0.78, 0.4 + (sn - 0.5) * 0.9) : 0.35);
      pctx.beginPath();
      pctx.moveTo(0, H);
      pts.forEach(function (p) { pctx.lineTo(p[0], p[1]); });
      pctx.lineTo(W, H);
      pctx.fill();
      // Saum an der Oberkante (nur oben, nicht an den Bildrändern)
      pctx.globalAlpha = Math.min(1, sn * 2.5);
      pctx.lineWidth = 2 + 6 * sn;
      pctx.lineJoin = 'round';
      pctx.beginPath();
      pts.forEach(function (p, i) { if (i) pctx.lineTo(p[0], p[1]); else pctx.moveTo(p[0], p[1]); });
      pctx.stroke();
      pctx.restore();
    }

    // ── Kürbisse: 12 Plätze, abwechselnd links/rechts von der Ecke nach innen ──
    // Je Seite von außen nach innen: Tiefe 0 = vorn am unteren Laubrand,
    // 1 = hinten oben auf dem Laub; dazwischen anteilig. Je höher das Laub,
    // desto weiter rücken sie auseinander, bei flachem Laub steht mal einer
    // halb vor dem Nachbarn (PK_SHIFT schiebt ihn seitlich heran)
    var PK_DEPTH = [1, 0.5, 0.2, 0.85, 0.35, 0.65], PK_SHIFT = [0, 0, 30, 0, -24, 0];
    var PK_X = [], PK_D = [];
    for (var pi = 0; pi < MAX_PK / 2; pi++) {
      PK_X.push(64 + pi * 82 + PK_SHIFT[pi]); PK_X.push(W - 64 - pi * 82 - PK_SHIFT[pi]);
      PK_D.push(PK_DEPTH[pi]); PK_D.push(PK_DEPTH[pi]);
    }
    // Fußpunkt bei Tiefe d: zwischen unterem Rand und Laub-Oberkante
    function pkFootY(x, d, l) {
      var front = H - 6, top = Math.min(front, surface(x, l) + 10);
      return front - d * (front - top);
    }
    var pkNodes = [], pkNext = 0, pkTotal = 0, pkGen = 0;
    // Je Platz feste Streuung: Sorte (Farbe), Form, Neigung und Tiefe –
    // hinten kleiner, höher und dunkler, damit der Haufen räumlich wirkt
    // Sorte fürs Namensschild bei !whereiam (wie PUMPKIN_SAY im Server)
    var PK_KIND_EN = { classic: 'a garden pumpkin', hokkaido: 'a hokkaido', turban: "a turk's turban", butternut: 'a butternut',
                       warty: 'a warty gourd', striped: 'a striped gourd', ghost: 'a white ghost pumpkin' };
    function buildPumpkin(name, slot, animate) {
      // Tiefe gehört zum Platz, Aussehen (Sorte, Größe, Form, Neigung) zum Namen
      var depth = PK_D[slot] === undefined ? 0.5 : PK_D[slot], nr = function (s) { return TS.nameRand(name, s); };
      var scale = (0.68 + nr(1) * 0.3) * (1 - 0.22 * depth);
      var wide = nr(2), sx = scale * (0.86 + 0.34 * wide), sy = scale * (1.12 - 0.28 * wide);
      var tilt = (nr(3) - 0.5) * 14;
      // Sorte je Name (Gartenkürbis, Hokkaido, Bischofsmütze, Butternut, Warzen-,
      // gestreifter Zierkürbis, weißer Ghost), Farbe über die Sorten-Klasse
      var variety = root.Pumpkin.varietyOf(nr(4));
      var g = el('g', { 'class': 'ta-pk ta-pk--v-' + variety + (animate ? ' ta-pk--new' : '') });
      // danach weg, sonst spielt ein späterer Scheinwerfer das Herunterfallen erneut ab
      if (animate) setTimeout(function () { g.classList.remove('ta-pk--new'); }, 1200);
      // Zwischenebene zum Anheben/Aufschwimmen (Fuß bei 0/0)
      var lift = el('g', {}, g);
      var inner = el('g', { 'class': 'ta-pk-inner' }, lift);
      var shadow = el('ellipse', { 'class': 'ta-pk-shadow', cx: 0, cy: 0, rx: f1(44 * sx), ry: f1(7 * scale) }, inner);
      // beim Zurückrollen dreht nur der Körper, der Schatten bleibt flach
      var spin = el('g', { 'class': 'ta-pk-spin' }, inner);
      var body = el('g', { transform: 'rotate(' + f1(tilt) + ' 0 -30) scale(' + sx.toFixed(2) + ' ' + sy.toFixed(2) + ')' }, spin);
      // Körper aus 10 Wülsten (js/pumpkin.js), dreht sich um die Stielachse;
      // dunkler Schleier über den hinteren Kürbissen gibt Tiefe
      var model = root.Pumpkin.build(body, { shade: 0.42 * depth, cap: true, variety: variety, seed: nr(9) });
      return { node: g, inner: inner, lift: lift, shadow: shadow, spin: spin, model: model, variety: variety, ratio: (61 * sy) / (84 * sx),
               label: name, slot: slot, h: 80 * sy, x: PK_X[slot], y: H, dy: 0, depth: depth,
               ly: 0, lx: 0, rot: 0, vy: 0, mode: null, shown: '' };
    }
    function placePumpkins() {
      var l = lvl();
      pkNodes.forEach(function (pk) {
        if (!pk) return;
        pk.y = pkFootY(pk.x, pk.depth, l);
        pk.node.setAttribute('transform', 'translate(' + pk.x + ' ' + f1(pk.y) + ')');
      });
    }
    function sortPumpkins() {
      pkNodes.filter(Boolean).sort(function (a, b) { return a.y - b.y; })
        .forEach(function (pk) { gPumpkins.appendChild(pk.node); });
    }
    // Sind alle Plätze belegt, macht der älteste Platz: er rollt zur Kante
    // hinaus, ab und zu holt ihn eine Krähe; der Neue fällt danach
    function addPumpkin(name, animate) {
      var i = pkNext % MAX_PK, old = pkNodes[i];
      if (old && animate) {
        pkNodes[i] = null;
        pkNext++;
        var gen = pkGen;
        var wait = TS.leave(old.node, { x: old.x, top: old.y - old.h, r: old.h / 2, crow: Math.random() < 0.25,
                                        shadow: old.shadow, shadowRatio: old.ratio });
        setTimeout(function () { if (gen === pkGen && !pkNodes[i]) putPumpkin(name, i, true); }, wait);
        return;
      }
      if (old) gPumpkins.removeChild(old.node);
      putPumpkin(name, i, animate);
      pkNext++;
    }
    // Nachts bekommen die Kürbisse ihr Gesicht, einer nach dem anderen: die
    // Hälfte glimmt weich auf, viele rollen weg und kommen mit Gesicht zurück,
    // selten platzt einer und ein geschnitzter fällt an seinen Platz; morgens
    // erlöschen sie ebenso
    var pkLit = false;
    function lightPumpkins(on) {
      var list = pkNodes.filter(Boolean).sort(function () { return Math.random() - 0.5; });
      if (!B.on || B.reduceMotion) { list.forEach(function (pk) { pk.node.classList.toggle('is-lit', on); }); return; }
      var at = 300;
      list.forEach(function (pk) {
        at += rand(350, 900);
        setTimeout(function () {
          if (pkLit !== on || pkNodes.indexOf(pk) < 0) return;
          if (!on) {
            pk.node.classList.remove('is-lit');
            pk.node.classList.add('is-dim');
            setTimeout(function () { pk.node.classList.remove('is-dim'); }, 2100);
            return;
          }
          pk.node.classList.remove('is-dim');
          var r = Math.random();
          if (r < 0.25 || pk.zap || pk.mode !== null) { pk.node.classList.add('is-lit'); return; }
          if (r < 0.5) {
            // dreht sich um die eigene Achse, das Gesicht kommt von der Seite nach vorn
            var from = (Math.random() < 0.5 ? -1 : 1) * rand(110, 200);
            root.Pumpkin.pose(pk.model, from);
            pk.node.classList.add('is-lit');
            root.Pumpkin.turn(pk.model, 1400, from);
            return;
          }
          if (r < 0.9) {
            // rollt zur Kante hinaus, derselbe kommt mit Gesicht zurückgerollt
            var ghost = pk.node.cloneNode(true);
            ghost.classList.remove('ta-pk--new', 'is-lit');
            pk.node.parentNode.insertBefore(ghost, pk.node);
            var back = TS.leave(ghost, { x: pk.x, top: pk.y - pk.h, r: pk.h / 2,
                                         shadow: ghost.querySelector('.ta-pk-shadow'), shadowRatio: pk.ratio });
            pk.zap = true;
            pk.node.dataset.zap = '1';
            var dx = pk.x < W / 2 ? -(pk.x - 20) : W - 20 - pk.x;
            setTimeout(function () {
              pk.zap = false;
              delete pk.node.dataset.zap;
              pk.node.classList.add('is-lit');
              pk.node.style.setProperty('--pk-in', Math.round(dx) + 'px');
              pk.node.style.setProperty('--pk-spin', Math.round(dx / (pk.h / 2) * 57.3) + 'deg');
              pk.node.classList.remove('is-rollin');
              void pk.node.getBBox();
              pk.node.classList.add('is-rollin');
              TS.rollShadow(pk.shadow, pk.spin, pk.ratio, 1600);
              setTimeout(function () { pk.node.classList.remove('is-rollin'); }, 1700);
            }, back + 1400);
            return;
          }
          var cy = pk.y + pk.dy - pk.h * 0.45;
          pk.zap = true;
          pk.node.dataset.zap = '1';
          B.chunks(pk.x, cy, 26, ['#e8761e', '#f2a03a', '#c4561a', '#f6e7b0'], function () { return H - 4; });
          setTimeout(function () {
            pk.zap = false;
            delete pk.node.dataset.zap;
            pk.node.classList.add('is-lit');
            dropIn(pk);
          }, 700);
        }, at);
      });
    }
    // Kürbis fällt neu auf seinen Platz; die Klasse danach wieder weg, sonst
    // spielt der Fall erneut, sobald ein Scheinwerfer-Wackeln endet
    function dropIn(pk) {
      pk.node.classList.remove('ta-pk--new');
      void pk.node.getBBox();
      pk.node.classList.add('ta-pk--new');
      clearTimeout(pk.dropT);
      pk.dropT = setTimeout(function () { pk.node.classList.remove('ta-pk--new'); }, 1200);
    }
    function putPumpkin(name, i, animate) {
      pkNodes[i] = buildPumpkin(name, i, animate);
      if (pkLit) pkNodes[i].node.classList.add('is-lit');
      gPumpkins.appendChild(pkNodes[i].node);
      placePumpkins();
      sortPumpkins();
      if (animate && B.on && B.partOn('pumpkins')) B.tag(name, pkNodes[i].x, pkNodes[i].y - pkNodes[i].h - 12, false);
    }
    // Kurzbesuch (!whereiam, nicht im Bild): Kürbis rollt zwischen zwei Plätze, etwas vor die Reihe
    function visitPumpkin(name) {
      var slot = Math.floor(Math.random() * MAX_PK), v = buildPumpkin(name, slot, false);
      v.x = PK_X[slot] + (slot % 2 ? -41 : 41);
      var y = pkFootY(v.x, 0.15);
      v.node.setAttribute('transform', 'translate(' + v.x + ' ' + y.toFixed(1) + ')');
      if (pkLit) v.node.classList.add('is-lit');
      gPumpkins.appendChild(v.node);
      TS.visit(v.node, { x: v.x, top: y - v.h, r: v.h / 2, roll: true, shadow: v.shadow, shadowRatio: v.ratio,
        arrive: function () { if (root.SeasonKit) root.SeasonKit.hop(v.inner); B.tag(name + ' drops by!', v.x, y - v.h - 12, true); } });
    }
    function clearPumpkins() { B.clear(gPumpkins); pkNodes = []; pkNext = 0; pkTotal = 0; pkGen++; }

    // ── Vogelscheuche: gemeinsames Sub-Projekt, 8 Teile ──
    var scare = B.project(gScare, {
      x: 250, k: 0.85,
      y: function () { return H + 4; },
      top: function (n) { return n >= 5 ? 450 : 420; },
      done: 'The scarecrow is finished!',
      names: ['the post', 'a straw body', 'a shirt', 'the head', 'a hat', 'a face', 'patches and straw', 'a crow'],
      parts: [
        function (g) {
          el('rect', { 'class': 'ta-sc-wood', x: -7, y: -420, width: 14, height: 424, rx: 3 }, g);
          el('rect', { 'class': 'ta-sc-wood', x: -142, y: -306, width: 284, height: 12, rx: 3 }, g);
        },
        function (g) {
          el('path', { 'class': 'ta-sc-straw', d: 'M-44 -300 L44 -300 L58 -170 L30 -150 L0 -164 L-30 -150 L-58 -170 Z' }, g);
          el('path', { 'class': 'ta-sc-strand', d: 'M-50 -175 L-62 -128 M-30 -160 L-36 -116 M-8 -164 L-6 -118 M16 -160 L22 -120 M40 -168 L54 -126' }, g);
        },
        function (g) {
          el('path', { 'class': 'ta-sc-shirt', d: 'M-52 -306 L-140 -310 L-140 -282 L-56 -268 L-60 -198 L60 -198 L56 -268 L140 -282 L140 -310 L52 -306 Z' }, g);
          el('path', { 'class': 'ta-sc-plaid', d: 'M-30 -304 L-34 -198 M0 -304 L0 -198 M30 -304 L34 -198 M-57 -260 L57 -260 M-59 -226 L59 -226 M-110 -308 L-110 -286 M-80 -307 L-80 -280 M110 -308 L110 -286 M80 -307 L80 -280' }, g);
          el('path', { 'class': 'ta-sc-strand', d: 'M-140 -306 L-162 -318 M-140 -296 L-166 -296 M-140 -287 L-160 -274 M140 -306 L162 -318 M140 -296 L166 -296 M140 -287 L160 -274' }, g);
        },
        function (g) {
          el('circle', { 'class': 'ta-sc-sack', cx: 0, cy: -352, r: 46 }, g);
          el('path', { 'class': 'ta-sc-sack', d: 'M-24 -310 L-32 -296 L-16 -300 L-10 -290 L0 -299 L10 -290 L16 -300 L32 -296 L24 -310 Z' }, g);
          el('path', { 'class': 'ta-sc-twine', d: 'M-24 -310 Q0 -302 24 -310' }, g);
        },
        function (g) {
          el('path', { 'class': 'ta-sc-hat', d: 'M-38 -390 Q-36 -440 -8 -447 Q18 -451 34 -438 Q40 -420 38 -390 Z' }, g);
          el('ellipse', { 'class': 'ta-sc-hat', cx: 0, cy: -388, rx: 72, ry: 12 }, g);
          el('rect', { 'class': 'ta-sc-band', x: -38, y: -406, width: 76, height: 11 }, g);
          el('path', { 'class': 'ts-cap', d: 'M-38 -426 Q-36 -452 -8 -458 Q20 -462 36 -440 Q38 -432 38 -426 Q0 -436 -38 -426 Z' }, g);
          el('path', { 'class': 'ts-cap', d: 'M-74 -389 Q-72 -401 -38 -400 L38 -400 Q72 -401 74 -389 Q0 -395 -74 -389 Z' }, g);
        },
        function (g) {
          el('path', { 'class': 'ta-sc-stitch', d: 'M-26 -370 L-12 -356 M-12 -370 L-26 -356 M12 -370 L26 -356 M26 -370 L12 -356' }, g);
          el('path', { 'class': 'ta-sc-nose', d: 'M-6 -348 L6 -348 L0 -337 Z' }, g);
          el('path', { 'class': 'ta-sc-stitch', d: 'M-24 -328 Q0 -314 24 -328 M-16 -330 L-14 -318 M-5 -326 L-4 -314 M5 -326 L4 -314 M16 -330 L14 -318' }, g);
        },
        function (g) {
          el('rect', { 'class': 'ta-sc-patch', x: -44, y: -258, width: 24, height: 22 }, g);
          el('rect', { 'class': 'ta-sc-patch ta-sc-patch--b', x: 92, y: -306, width: 22, height: 18 }, g);
          el('rect', { 'class': 'ta-sc-patch ta-sc-patch--b', x: 18, y: -384, width: 16, height: 13 }, g);
          el('path', { 'class': 'ta-sc-strand', d: 'M-60 -386 L-78 -370 M-50 -384 L-60 -362 M52 -384 L68 -366 M60 -386 L80 -374 M-20 -298 L-26 -282 M20 -298 L28 -284' }, g);
        },
        function (g) {
          el('path', { 'class': 'ta-sc-crow', d: 'M76 -334 L50 -344 L56 -328 Z' }, g);
          el('ellipse', { 'class': 'ta-sc-crow', cx: 96, cy: -332, rx: 24, ry: 14 }, g);
          el('circle', { 'class': 'ta-sc-crow', cx: 116, cy: -348, r: 11 }, g);
          el('path', { 'class': 'ta-sc-beak', d: 'M124 -351 L140 -347 L124 -342 Z' }, g);
          el('circle', { 'class': 'ta-sc-eye', cx: 119, cy: -351, r: 2.4 }, g);
          el('path', { 'class': 'ta-sc-legs', d: 'M92 -320 L92 -311 M102 -320 L102 -311' }, g);
        }
      ],
      burst: function (x, y) {
        for (var i = 0; i < 26; i++) spawn({ x: x + rand(-50, 50), y: y + rand(-30, 30), vx: rand(-300, 300), vy: rand(-650, -250), front: true, s: rand(0.6, 1), life: 1.6 });
      }
    });

    // ── Partikel ──
    function spawn(o) {
      var parts = o.front ? B.front : B.back;
      if (!parts) return;
      parts.add({
        x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy === undefined ? rand(50, 90) : o.vy, g: o.g,
        term: rand(60, 100), sway: o.sway || rand(20, 60), vph: o.vph || rand(2, 5),
        shape: Math.floor(Math.random() * 3), ci: Math.floor(Math.random() * 5), s: o.s || rand(0.8, 1.4),
        floor: o.land === false ? null : function (x) { return surface(x) + 6; },
        life: o.life, draw: leafDraw
      });
      if (o.burn && parts.each) parts.each(function (q) {
        if (q.burnAt === undefined && q.x === o.x && q.y === o.y) { q.burnAt = 0; q.burnFor = rand(1.6, 2.8); q.smolder = !!o.smolder; q.term *= o.smolder ? 1 : 1.8; }
      });
    }

    // ── Animationen zu den Befehlen ──
    function celebrate(name) {
      B.pulse('celebrate', 4000);
      for (var i = 0; i < 90; i++) {
        var left = i % 2 === 0;
        spawn({ x: left ? rand(0, 200) : W - rand(0, 200), y: H - rand(20, 120),
                vx: (left ? 1 : -1) * rand(250, 650), vy: rand(-1150, -650), front: true });
      }
      if (name) B.tag('Thank you, ' + name + '!', W / 2, 300, true);
    }
    // Böe: Laub fliegt vom Haufen, Kürbisse wackeln, die Krähe flattert auf
    function gust(p) {
      var dir = B.gust(900, p), gk = B.gustK;
      dropSeeds(Math.round(1 + 2 * gk));
      B.vars({ '--ts-gust-dir': (dir * gk).toFixed(2) });
      B.pulse('gust', 1500);
      [[20, 600], [W - 600, W - 20]].forEach(function (r) {
        for (var i = 0, n = Math.round(25 * gk * (1 - 0.7 * W8.wet)); i < n; i++) {
          var x = rand(r[0], r[1]);
          spawn({ x: x, y: surface(x) + rand(0, 15), vx: dir * gk * rand(300, 700), vy: rand(-380, -120), front: true });
        }
      });
    }
    var rakeTool = el('g', { 'class': 'ta-rake' }, B.fxSvg);
    el('line', { 'class': 'ta-rake-handle', x1: 0, y1: 0, x2: 150, y2: -230 }, rakeTool);
    el('path', { 'class': 'ta-rake-head', d: 'M-46 6 L46 -6 M-40 5 L-44 30 M-20 3 L-23 28 M0 0 L-2 26 M20 -3 L19 23 M40 -5 L40 20' }, rakeTool);
    var rakeSide = 0, raking = false;
    function setLevel(p) {
      var lv = parseFloat(p.level);
      if (!isNaN(lv)) S.target = Math.max(0, Math.min(100, lv));
    }
    function rake(p) {
      var name = p.name || 'Someone', removed = parseFloat(p.done) || 0;
      setLevel(p);
      var left = rakeSide++ % 2 === 0;
      var mid = left ? 330 : W - 330;
      if (removed > 0 && root.SeasonKit) {
        root.SeasonKit.crowd('rake', name, function (n) { return n + ' raked!'; },
                             function (n) { return n + ' raked too!'; }, function (t) { B.tag(t, mid, surface(mid) - 70, true); });
      } else B.tag(removed > 0 ? name + ' raked!' : name + ': nothing left to rake', mid, surface(mid) - 70, true);
      if (B.reduceMotion || raking || removed <= 0) return;
      raking = true;
      rakeTool.classList.add('is-on');
      var from = left ? 560 : W - 560, to = left ? 70 : W - 70;
      var t0 = performance.now(), dur = 1400;
      (function step() {
        var k = Math.min(1, (performance.now() - t0) / dur);
        var stroke = (k * 3) % 1;                       // drei Züge
        var x = from + (to - from) * (Math.floor(k * 3) / 3 + stroke / 3);
        var y = surface(x) + 6 - Math.sin(stroke * Math.PI) * 10;
        rakeTool.setAttribute('transform', 'translate(' + f1(x) + ' ' + f1(y) + ')' + (left ? '' : ' scale(-1 1)'));
        if (Math.random() < 0.6) spawn({ x: x + rand(-30, 30), y: y - 10, vx: (left ? -1 : 1) * rand(120, 320), vy: rand(-420, -200), front: true, land: false, life: 1.6 });
        if (k < 1) root.requestAnimationFrame(step);
        else { rakeTool.classList.remove('is-on'); raking = false; }
      })();
    }
    function jump(name) {
      var left = Math.random() < 0.5;
      var x = left ? rand(120, 380) : W - rand(120, 380);
      var y = surface(x);
      for (var i = 0; i < 70; i++) {
        spawn({ x: x + rand(-50, 50), y: y + rand(0, 20), vx: rand(-380, 380), vy: rand(-1050, -450), front: true, s: rand(0.9, 1.6) });
      }
      if (root.SeasonKit) root.SeasonKit.crowd('jump', name || 'Someone', function (n) { return n + ' jumped in!'; },
                                               function (n) { return n + ' jumped in too!'; }, function (t) { B.tag(t, x, y - 150, true); });
      else B.tag((name || 'Someone') + ' jumped in!', x, y - 150, true);
    }
    function sweep(p) {
      setLevel(p);
      if (!(parseFloat(p.done) > 0)) { B.tag('No leaves to sweep', W / 2, 300, true); return; }
      B.gust(1400);
      gust();
      B.tag('Swept clean!', W / 2, 300, true);
    }

    // ── Spektakel: Windhosen (beliebig viele) und Tsunami ──
    var wave = null, tws = TS.twisters(), whirlAcc = 0, tNow = 0;
    function spectacle(p) {
      if (!B.on || p.reduced || (p.type !== 'tornado' && p.type !== 'tsunami')) return;
      if (p.type === 'tsunami') { wave = p; return; }
      tws.add(p);
      if (!B.partOn('pumpkins')) return;
      // 2–4 Kürbisse werden mitgerissen
      var pool = pkNodes.filter(Boolean), n = Math.min(pool.length, 2 + Math.floor(Math.random() * 3));
      for (var i = 0; i < n; i++) {
        var k = Math.floor(Math.random() * pool.length);
        pool[k].mode = 'wait';
        pool[k].peak = rand(170, 280);
        pool.splice(k, 1);
      }
    }
    // Namensschild am Kürbis: folgt ihm, wenn er schwimmt oder im Wirbel
    // fliegt, und verschwindet, wenn er platzt
    function pkTag(pk, text, big) {
      var t = B.tag(text, pk.x + pk.lx, pk.y - pk.h - 12 - pk.ly, big);
      if (t) pk.tag = { el: t, lx: pk.lx, ly: pk.ly };
    }
    function followTag(pk) {
      var t = pk.tag;
      if (!t) return;
      if (!t.el.parentNode) { pk.tag = null; return; }
      var dx = pk.lx - t.lx, dy = t.ly - pk.ly;
      t.el.setAttribute('transform', Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3 ? '' : 'translate(' + f1(dx) + ' ' + f1(dy) + ')');
    }
    function dropTag(pk) {
      if (!pk.tag) return;
      var el = pk.tag.el;
      pk.tag = null;
      el.classList.add('name-tag--out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }
    function renderPk(pk) {
      followTag(pk);
      var tr = pk.ly < 0.3 && Math.abs(pk.lx) < 0.3 && Math.abs(pk.rot) < 0.3 ? ''
        : 'translate(' + f1(pk.lx) + ' ' + f1(-pk.ly) + ') rotate(' + f1(pk.rot) + ' 0 -30)';
      if (tr === pk.shown) return;
      pk.shown = tr;
      pk.lift.setAttribute('transform', tr);
    }
    function stepShow(dt) {
      tNow += dt;
      var flood = wave && wave.active();
      if (wave && !flood) wave = null;
      var live = flood || tws.any();
      stepScare(dt, tws.near(SC_X));
      // Laub am Fuß jeder Windhose aufwirbeln (Partikel blenden an den Rändern aus)
      tws.each(function (tx, dir) {
        // über dem Tsunami (Wasserhose) liegt kein Laub mehr zum Aufwirbeln
        if (tx < -100 || tx > W + 100 || flooded(tx)) return;
        whirlAcc += dt * 45;
        while (whirlAcc >= 1) {
          whirlAcc--;
          var x = tx + rand(-70, 70);
          spawn({ x: x, y: surface(x) + rand(0, 10), vx: dir * rand(150, 450) + rand(-250, 250), vy: rand(-1200, -550),
                  g: 650, sway: rand(90, 170), vph: rand(5, 9), front: true, s: rand(0.8, 1.4), life: rand(2.5, 4) });
        }
      });
      pkNodes.forEach(function (pk) {
        if (!pk) return;
        // eine Windhose schnappt sich vorgemerkte Kürbisse, auf dem Wasser
        // treibende (Wasserhose) und solche, die eine andere gerade fallen
        // lässt oder noch im Wirbel hat: dann wirbelt sie weiter, noch höher
        // (die eigene bzw. die, die ihn gerade fallen ließ, zählt nicht mit;
        // im Wirbel erst nach einer Sekunde, sonst reißen zwei hin und her)
        var px = pk.x + pk.lx, tn = tws.near(px, pk.mode === 'up' ? pk.tw : pk.drop);
        if (tn && Math.abs(tn.x - px) < 110 && !B.reduceMotion && !pk.zap &&
            (pk.mode === 'wait' || (pk.mode === 'up' && pk.held > 1) || pk.mode === 'fall' || (!pk.mode && pk.ly > 20))) {
          if (pk.mode !== 'wait') pk.peak = Math.min(360, Math.max(pk.peak || 0, pk.ly) + rand(30, 80));
          pk.mode = 'up'; pk.tw = tn.t; pk.held = 0;
        }
        if (pk.mode === 'up') {
          pk.held += dt;
          // im Wirbel: steigt, kreiselt, folgt seiner Windhose ein Stück
          var tx = pk.tw && pk.tw.active() ? pk.tw.x() : null, dir = (pk.tw && pk.tw.dir) || 1;
          pk.ly += (pk.peak - pk.ly) * Math.min(1, dt * 2.2);
          pk.lx += (Math.max(-130, Math.min(130, ((tx === null ? pk.x : tx) - pk.x) * 0.6)) + Math.sin(tNow * 7) * 30 - pk.lx) * Math.min(1, dt * 3);
          pk.rot += dt * 260 * dir;
          if (tx === null || (tx - pk.x) * dir > 220) { pk.mode = 'fall'; pk.vy = 0; pk.drop = pk.tw; pk.tw = null; }
        } else if (pk.mode === 'fall') {
          // fällt zurück auf seinen Platz, kurzer Hüpfer
          pk.vy += 2200 * dt;
          pk.ly -= pk.vy * dt;
          pk.lx *= Math.pow(0.02, dt);
          pk.rot += (Math.round(pk.rot / 360) * 360 - pk.rot) * Math.min(1, dt * 6);
          if (pk.ly <= 0) {
            pk.ly = 0;
            if (pk.vy > 500) pk.vy = -pk.vy * 0.3;
            else { pk.mode = null; pk.vy = 0; pk.lx = 0; pk.rot = 0; pk.drop = null; }
          }
        } else if (pk.mode === 'wait' && !live) {
          pk.mode = null;
        } else if (!pk.mode) {
          // Tsunami: auf dem Wasser treiben (gut halb eingetaucht), sonst wieder absetzen
          var target = 0, bob = 0;
          if (flood) {
            target = Math.max(0, Math.min(320, pk.y - (H - wave.level(pk.x)) - 0.45 * pk.h));
            bob = target > 4 ? 1 : 0;
          }
          pk.ly += (target - pk.ly) * Math.min(1, dt * (target > pk.ly ? 3 : 1.4));
          pk.rot = bob * Math.sin(tNow * 2.1 + pk.slot) * 9 * Math.min(1, pk.ly / 30) + (1 - bob) * pk.rot * Math.pow(0.1, dt);
          pk.lx = Math.sin(tNow * 1.3 + pk.slot * 2) * 8 * Math.min(1, pk.ly / 30);
          if (pk.ly < 0.3 && !live) { pk.ly = 0; pk.lx = 0; pk.rot = 0; }
        }
        renderPk(pk);
      });
    }
    // Vogelscheuche: biegt sich bei Sturm, schwankt bei Böen; naht die
    // Windhose, wird sie durchgeschüttelt, Hut und Krähe fliegen davon und
    // kommen danach zurück
    var SC_X = 250, scHatBack = 0, scStraw = 0, scSway = B.sway(), scDrawn = '';
    function scSet(k, v) { if (gScare.dataset[k] !== v) gScare.dataset[k] = v; }
    function stepScare(dt, tn) {
      var near = !!tn && Math.abs(tn.x - SC_X) < 330;
      var sky = opts.sky ? opts.sky() : null, kind = sky ? sky.kind : '';
      var bz = opts.blizzard ? opts.blizzard() : 0;
      var stormy = kind === 'storm' || kind === 'blizzard' || bz > 0.3 || Math.abs(B.windBase) >= 0.8;
      // gedämpftes Pendel: schwingt nach, wenn der Wind nachlässt
      var a = B.reduceMotion ? 0 : scSway(dt, near ? 7 : stormy ? 2 : 0, Math.min(4, Math.abs(B.gustPx) / 200),
                                          B.windBase < 0 ? -1 : 1);
      var av = a.toFixed(2);
      if (av !== scDrawn) { scDrawn = av; gScare.style.setProperty('--ta-sc-sway', av); }
      if (near && !B.reduceMotion && scare.n() >= 5) {
        if (gScare.dataset.gone !== '1') { scSet('dir', tn.dir < 0 ? 'l' : 'r'); scSet('gone', '1'); }
        scHatBack = 2.5;
        // Stroh und Laub fliegen mit dem Wirbel
        scStraw += dt * 18;
        while (scStraw >= 1) {
          scStraw--;
          spawn({ x: SC_X + rand(-60, 60), y: H - rand(150, 330), vx: (tn.dir || 1) * rand(300, 700), vy: rand(-500, -150),
                  g: 500, sway: rand(80, 150), vph: rand(5, 9), front: true, s: rand(0.6, 1), life: rand(1.5, 2.5), land: false });
        }
      } else if (gScare.dataset.gone === '1') {
        scHatBack -= dt;
        if (scHatBack <= 0) scSet('gone', '');
      }
    }
    function resetShow() {
      wave = null; tws.clear();
      scSet('gone', '');
      pkNodes.forEach(function (pk) { if (pk) { pk.mode = null; pk.ly = 0; pk.lx = 0; pk.rot = 0; pk.tw = pk.drop = null; renderPk(pk); } });
    }

    // ── Nässe: Regen macht das Laub dunkel und schwer, trocknet in ~2 min ──
    function liveRain() {
      var sky = opts && opts.sky ? opts.sky() : null;
      return sky ? clamp01((sky.rain || 0) + 0.5 * (sky.drizzle || 0)) : B.rain;
    }
    function stepWet(dt) {
      var want = liveRain() > 0.2 ? 1 : 0;
      if (B.reduceMotion) W8.wet = want;
      else if (want > W8.wet) W8.wet = Math.min(want, W8.wet + dt / 15);
      else W8.wet = Math.max(want, W8.wet - dt / 120);
      B.vars({ '--ta-wet': W8.wet });
      var flag = W8.wet > 0.01 ? '1' : '0';
      if (B.root.dataset.leafwet !== flag) B.root.dataset.leafwet = flag;
    }

    // ── Blitzfeuer im Laub: bis zu FIRE_MAX Feuer, nur im sichtbaren Thema ──
    // Ein naher Blitz bis REACH px neben dem Haufen springt hinein; trifft er
    // ein Feuer (FIRE_NEAR), facht er es neu an. Trockene Feuer springen nach
    // einer Weile auf die Nachbarstelle über (Kettenreaktion bis zum Maximum).
    var FIRE_MAX = 5, REACH = 250, FIRE_NEAR = 110;
    var fires = [], lastFireX = null, fireDrawn = false;
    var fctx = B.fireCtx();
    function pileFloor(x) { return surface(x) + 6; }
    function burning() { return fires.filter(function (f) { return !f.out; }); }
    function fireAt(x) {
      for (var i = 0; i < fires.length; i++) if (!fires[i].out && Math.abs(fires[i].x - x) < FIRE_NEAR) return fires[i];
      return null;
    }
    // genug Laub für ein Feuer: 45 px, bei dünnem Haufen 60 % seiner höchsten Stelle
    function enoughAt(x) { return H - surface(x) >= Math.min(45, 0.6 * MAXH * lvl()); }
    function emit(name, args) { if (opts.event) opts.event(name, args); }
    // Blitz trifft einen Kürbis (nah, höchstens 90 px daneben): er platzt,
    // nach 8–14 s wächst er mit der Aufbau-Animation nach (Follower bleibt)
    function pumpkinBolt(p) {
      if (!B.partOn('pumpkins')) return false;
      var best = null;
      // auch auf dem Tsunami treibende und im Wirbel fliegende (dort, wo sie
      // gerade sind); hoch in der Luft trifft er öfter
      pkNodes.forEach(function (pk) {
        if (!pk || pk.zap || Math.abs(pk.x + pk.lx - p.x) > 90) return;
        if (!best || Math.abs(pk.x + pk.lx - p.x) < Math.abs(best.x + best.lx - p.x)) best = pk;
      });
      var airborne = best && (best.mode === 'up' || best.mode === 'fall');
      if (!best || Math.random() < (airborne ? 0.35 : 0.65)) return false;  // nicht jeder Blitz trifft
      var pk = best, cx = pk.x + pk.lx, cy = pk.y + pk.dy - pk.h * 0.45 - pk.ly;
      if (p.ground) p.ground(cx, cy);
      dropTag(pk);
      // zerplatzt: wächst später an seinem Platz nach
      pk.mode = null; pk.ly = 0; pk.lx = 0; pk.rot = 0; pk.vy = 0; pk.tw = pk.drop = null;
      renderPk(pk);
      pk.zap = true;
      pk.node.dataset.zap = '1';
      B.chunks(cx, cy, 34, ['#e8761e', '#f2a03a', '#c4561a', '#f6e7b0', '#5a3a1e'], function () { return H - 4; });
      B.sparks(cx, cy, 20, 30);
      for (var i = 0; i < 4; i++) B.smoke(cx + rand(-25, 25), cy, { o: 0.35 });
      emit('struck', { target: 'pumpkin', name: pk.label || '' });
      setTimeout(function () {
        pk.zap = false;
        delete pk.node.dataset.zap;
        dropIn(pk);
        // der Name erst, wenn er wieder da ist
        if (pk.label && B.on && B.partOn('pumpkins')) setTimeout(function () { pkTag(pk, pk.label, false); }, 600);
      }, rand(8000, 14000));
      return true;
    }
    // Blitz-Einschlag (vom Weather-Kit): nah, im Haufen, Laub > 5 %
    function bolt(p) {
      if (!B.on || B.reduceMotion || !p.near || typeof p.x !== 'number') return;
      igniteLeaves(p.x);
      if (pumpkinBolt(p)) return;
      if (!B.partOn('pile') || S.shown <= 5) return;
      var x = Math.max(140, Math.min(W - 140, p.x));
      // zum nächsten Rand hin bis zur ersten Stelle mit genug Laub (Mitte ist frei)
      var dir = x < W / 2 ? -1 : 1, moved = 0;
      while (!enoughAt(x) && moved < REACH) { x += dir * 10; moved += 10; }
      if (!enoughAt(x) || flooded(x)) return;          // zu weit daneben oder unter Wasser
      x = Math.max(140, Math.min(W - 140, x + dir * Math.random() * 60));
      var hit = fireAt(x);
      if (!hit && burning().length >= FIRE_MAX) return;
      if (p.ground) p.ground(hit ? hit.x : x, surface(hit ? hit.x : x) + 6);
      if (hit) {
        // frische Glut: brennt von vorn, springt erneut über
        if (!hit.wet) { hit.t = Math.min(hit.t, 3); hit.spreadAt = hit.t + rand(8, 14); }
        B.sparks(hit.x, surface(hit.x), 24, 30);
        return;
      }
      ignite(x, 'lightning');
    }
    function ignite(x, cause) {
      var wet = liveRain() > 0.2;
      var f = { x: x, wet: wet, t: 0, dur: wet ? 8 : 30, out: false, outT: 0, smokeAcc: 0, sparkAcc: 0, k: 0, ember: 0,
                spreadAt: wet ? Infinity : rand(8, 14),
                dip: { x: x, w: wet ? 50 : 75, d: 0, max: wet ? 0.15 : 0.7, heal: false } };
      fires.push(f);
      lastFireX = x;
      dips.push(f.dip);
      var y = surface(x);
      B.sparks(x, y, wet ? 10 : 30, 30);
      if (wet) {
        // nasses Laub: kurzes Zischen, Dampf- und Rauchwolke
        for (var i = 0; i < 10; i++) B.smoke(x + rand(-40, 40), y - rand(0, 20), { steam: true, o: 0.55, up: rand(60, 120), life: rand(1.5, 2.6) });
        for (var j = 0; j < 5; j++) B.smoke(x + rand(-30, 30), y - 10, { o: 0.45 });
      }
      if (opts.ignite) opts.ignite(wet);
      emit('fire', { cause: cause, wet: wet, fires: burning().length, side: x < W / 2 ? 'left' : 'right' });
    }
    // Funkenflug: Nachbarstelle im Haufen (mit dem Wind eher in seine Richtung)
    function spread(f) {
      var wind = B.windBase || 0;
      for (var tries = 0; tries < 4; tries++) {
        var dir = Math.random() < 0.5 + 0.35 * Math.max(-1, Math.min(1, wind)) ? 1 : -1;
        var x = f.x + dir * rand(130, 200);
        if (x < 140 || x > W - 140 || !enoughAt(x) || fireAt(x)) continue;
        B.sparks(f.x, surface(f.x) - 20, 18, 60);
        ignite(x, 'spread');
        return;
      }
    }
    function stepFire(dt, t) {
      if (!fires.length) {
        if (fireDrawn) { fctx.clearRect(0, 0, W, H); fireDrawn = false; }
        return;
      }
      fctx.clearRect(0, 0, W, H);
      fireDrawn = true;
      for (var n = fires.length - 1; n >= 0; n--) {
        var f = fires[n];
        if (stepOne(f, dt, t)) {
          f.dip.heal = true;
          fires.splice(n, 1);
          // von selbst ausgebrannt (nicht gelöscht)
          if (!f.out) emit('fireOut', { wet: f.wet, fires: burning().length });
        }
      }
    }
    // ein Feuer fortschreiben und zeichnen; true = vorbei
    // steht der Tsunami über dem Laub, ist das Feuer sofort aus (zischt, dampft)
    function flooded(x) { return wave && wave.active() && wave.level(x) > H - surface(x) + 10; }
    function stepOne(f, dt, t) {
      f.t += dt;
      if (!f.out && flooded(f.x)) {
        f.out = true; f.outT = 0;
        for (var sm = 0; sm < 8; sm++) B.smoke(f.x + rand(-50, 50), H - wave.level(f.x), { steam: true, o: 0.6, up: rand(70, 140), life: rand(1.5, 2.5) });
        emit('fireOut', { wet: true, fires: burning().length });
      }
      // Regen löscht ein laufendes Feuer nach ein paar Sekunden (je stärker, desto schneller)
      var rn = liveRain();
      if (!f.out && rn > 0.2) {
        f.rainT = (f.rainT || 0) + dt * rn;
        if (Math.random() < dt * 4) B.smoke(f.x + rand(-40, 40), surface(f.x), { steam: true, o: 0.4, life: rand(1.2, 2) });
        if (f.rainT > 3) {
          f.out = true; f.outT = 0;
          for (var rs = 0; rs < 6; rs++) B.smoke(f.x + rand(-50, 50), surface(f.x), { steam: true, o: 0.55, up: rand(60, 120), life: rand(1.5, 2.5) });
          emit('fireOut', { wet: true, fires: burning().length });
        }
      }
      var k, ember;
      if (f.out) {
        f.outT += dt;
        k = f.k * Math.pow(0.01, dt);
        ember = f.ember * Math.pow(0.05, dt);
        if (f.outT < 2) for (var st = 0; st < 2; st++) if (Math.random() < dt * 8) B.smoke(f.x + rand(-50, 50), surface(f.x), { steam: true, o: 0.5, life: rand(1.6, 2.6) });
      } else if (f.wet) {
        // nur Glut, die nach ~8 s erlischt
        k = 0.3 * (1 - B.clamp01(f.t / 0.8));
        ember = B.clamp01(f.t / 0.5) * (1 - B.clamp01((f.t - (f.dur - 2)) / 2));
      } else {
        // trocken: ~30 s, flaut zum Ende hin von selbst ab, Glut glimmt nach
        k = B.clamp01(f.t / 2) * (1 - B.clamp01((f.t - (f.dur - 8)) / 8));
        ember = B.clamp01(f.t / 3) * (1 - B.clamp01((f.t - f.dur) / 4));
      }
      f.k = k; f.ember = ember;
      if (!f.out) f.dip.d = Math.min(f.dip.max, f.dip.max * f.t / (f.dur * 0.7));
      if (f.out ? f.outT > 2.5 : f.t > f.dur + (f.wet ? 0 : 4)) return true;
      // im Regen springt nichts über
      if (!f.out && f.t >= f.spreadAt) {
        f.spreadAt = Infinity;
        if (k > 0.5 && liveRain() <= 0.2 && burning().length < FIRE_MAX && Math.random() < 0.7) spread(f);
      }

      var y = surface(f.x);
      // Rauch, Funken
      f.smokeAcc += dt * (f.out ? 0 : 1.5 + 5 * k + 1.5 * ember);
      while (f.smokeAcc >= 1) { f.smokeAcc--; B.smoke(f.x + rand(-40, 40), y - 30 - 90 * k, { o: 0.35 + 0.2 * k, r: rand(18, 30) }); }
      f.sparkAcc += dt * 14 * k;
      while (f.sparkAcc >= 1) { f.sparkAcc--; B.sparks(f.x, y - 20, 1, 50); }

      B.glow(fctx, f.x, y - 30, 300, 0.3 * k + 0.08 * ember);
      var fl = 0.75 + 0.25 * Math.sin(t * 0.009 + f.x) * Math.sin(t * 0.0137);
      B.glow(fctx, f.x, y + 4, 80 + 30 * k, 0.75 * ember * fl, '255,80,20');
      B.glow(fctx, f.x, y + 8, 34, 0.7 * ember * fl, '255,190,90');
      // Glutpunkte in der Senke
      fctx.fillStyle = 'rgba(255,170,60,' + (0.85 * ember).toFixed(3) + ')';
      for (var e = 0; e < 9; e++) {
        var ex = f.x + Math.sin(e * 2.7) * 48, ey = surface(ex) + 4 + Math.cos(e * 1.9) * 4;
        if (0.5 + 0.5 * Math.sin(t * 0.004 * (1 + e % 3) + e) > 0.35) { fctx.beginPath(); fctx.arc(ex, ey, 2.6, 0, 6.283); fctx.fill(); }
      }
      var pts = [];
      for (var i = -3; i <= 3; i++) { var px = f.x + i * 19 + Math.sin(i * 5.3) * 5; pts.push([px, surface(px) + 12, 1 - Math.abs(i) * 0.2]); }
      B.flames(fctx, pts, 44, 160, k, t / 1000);
      return false;
    }
    // !extinguish: done = 1 löscht das älteste Feuer mit Wasser und Dampf (Schild),
    // sonst kleiner Spritzer
    function extinguish(p) {
      if (!B.on) return;
      var done = parseFloat(p.done) > 0;
      var live = burning(), f = live[0] || null;
      var x = f ? f.x : lastFireX !== null ? lastFireX : (Math.random() < 0.5 ? 330 : W - 330);
      if (!done) {
        var sx = f ? x : Math.random() < 0.5 ? rand(200, 520) : rand(W - 520, W - 200);
        B.water(sx, surface(sx), 14, pileFloor);
        return;
      }
      var y = surface(x);
      B.water(x, y, 70, pileFloor);
      for (var i = 0; i < 16; i++) B.smoke(x + rand(-70, 70), y - rand(0, 40), { steam: true, o: 0.6, up: rand(70, 150), r: rand(20, 34), life: rand(2, 3.5) });
      if (f) { f.out = true; f.outT = 0; }
      var left = burning().length;
      B.tag((p.name || 'Someone') + ' put out the fire!' + (left ? ' ' + left + ' left' : ''), x, y - 190, true);
      emit('extinguished', { name: p.name || '', fires: left });
    }
    function stepDips(dt) {
      for (var i = dips.length - 1; i >= 0; i--) {
        if (!dips[i].heal) continue;
        dips[i].d -= dt * dips[i].max / 240;   // neues Laub füllt das Loch in ~4 min
        if (dips[i].d <= 0) dips.splice(i, 1);
      }
    }

    // ── Hauptschleife ──
    var spawnAcc = 0, branchAcc = 0, blowAcc = 0, drawn = -1, drawnSig = '', offFor = 99;
    TS.loop(function (dt, ts) {
      // Laubhöhe folgt dem Server: Zuwachs weich, Rechen sichtbar schneller
      if (B.reduceMotion) S.shown = S.target;
      else if (S.shown !== S.target) {
        var diff = S.target - S.shown, stp = Math.max(diff > 0 ? 1 : 12, Math.abs(diff) * 1.2) * dt;
        S.shown = Math.abs(diff) <= stp ? S.target : S.shown + (diff > 0 ? stp : -stp);
      }
      // ausgeblendet nur noch kurz weiterzeichnen (Partikel fallen zu Ende)
      offFor = B.on ? 0 : offFor + dt;
      // ausgeblendet: laufendes Feuer endet still
      if (!B.on && fires.length) { fires = []; dips = []; }
      stepWet(dt);
      stepFire(dt, ts);
      stepAFrost(dt);
      stepBranch(Math.min(dt, 0.05));
      stepShrooms(Math.min(dt, 0.05));
      if (offFor > 3) return;
      if (B.on) stepShow(dt);
      else if (wave || tws.any() || pkNodes.some(function (pk) { return pk && (pk.mode || pk.ly); })) resetShow();
      B.stepSnow(dt);
      stepDips(dt);
      var l = lvl();
      // neu zeichnen bei Stand, Brandloch oder Nässe (gestuft)
      var sig = dips.map(function (d) { return d.d.toFixed(2); }).join(',') + '|' + Math.round(W8.wet * 20) +
                '|' + Math.round(B.snow * 20);
      if (Math.abs(l - drawn) > 0.002 || sig !== drawnSig) { drawPile(l); placePumpkins(); drawn = l; drawnSig = sig; }
      if (B.on) {
        // Schneesturm pustet den Laubhaufen weg: Blätter fliegen vom Haufen
        // mit dem Wind seitlich aus dem Bild (der Server senkt den Stand mit)
        var bz = opts.blizzard ? clamp01(opts.blizzard()) : 0;
        if (bz > 0.3 && S.shown > 1 && !B.reduceMotion) {
          var dir = B.windBase < 0 ? -1 : 1;
          blowAcc += dt * 40 * bz;
          while (blowAcc >= 1) {
            blowAcc--;
            var bx = rand(0, W);
            spawn({ x: bx, y: surface(bx) + rand(-6, 6), vx: dir * rand(650, 1200), vy: rand(-380, -60), g: 120,
                    sway: rand(40, 90), vph: rand(6, 10), front: true, s: rand(0.8, 1.3), life: rand(1.8, 3), land: false });
          }
        }
        // Laub fällt stetig, mit Wind deutlich mehr (Schalter leaves)
        // nasses Laub ist schwer: Wind löst nur noch ~30 % davon
        var w = Math.abs(B.windBase), heavy = 1 - 0.7 * W8.wet;
        spawnAcc = B.partOn('leaves') ? spawnAcc + (2.5 + 9 * w * heavy) * dt : 0;
        while (spawnAcc >= 1) {
          spawnAcc--;
          spawn({ x: rand(-200, W + 200) - B.windBase * 400, y: -40 });
        }
        // Ast verliert bei Wind Blätter, sie wachsen später nach
        if (B.partOn('branch') && w > 0.2) {
          branchAcc += dt * w * heavy;
          if (branchAcc > 1) {
            branchAcc = 0;
            var live = branchLeaves.filter(function (b) { return !b.gone; });
            if (live.length) {
              var b = live[Math.floor(Math.random() * live.length)];
              b.gone = true;
              b.node.classList.remove('ta-bl--grow');
              b.node.classList.add('ta-bl--gone');
              spawn({ x: b.x, y: b.y, vy: 30, s: 1.4 });
              setTimeout(function () {
                b.gone = false;
                b.node.classList.remove('ta-bl--gone');
                b.node.classList.add('ta-bl--grow');
              }, 9000);
            }
          }
        }
      }
      B.stepParticles(dt);
    });

    // ── Spotlight: alle 8 s ein Kürbis, jedes 4. Mal der beste Laubrecher ──
    var fireBoardTimer = null;
    var spotRound = 0, lastSpot = null;
    setInterval(function () {
      if (!B.on || TS.visiting()) return;
      spotRound++;
      if (!B.partOn('pumpkins')) return;
      // geplatzte Kürbisse nicht: sonst stünde ein Name über einer leeren Stelle
      var pool = pkNodes.filter(function (pk) { return pk && pk.label && !pk.zap; });
      if (!pool.length) return;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick === lastSpot && pool.length > 1) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
      lastSpot = pick;
      B.spot(pick.inner);
      pkTag(pick, pick.label, false);
    }, 8000);

    return {
      load: function (deco) {
        if (!deco) return;
        clearPumpkins();
        (deco.pumpkins || []).forEach(function (p) { addPumpkin(p.name || '', false); });
        pkTotal = deco.pumpkin_total || pkNodes.filter(Boolean).length;
        scare.set(deco.project != null ? deco.project : deco.snowman);
      },
      update: function (s) {
        s = s || {};
        B.apply(s);
        var lv = s.seasonLevels || {};
        if (typeof lv.leaves === 'number') {
          S.target = Math.max(0, Math.min(100, lv.leaves));
          if (S.first) S.shown = S.target;   // erster Stand sofort
          S.first = false;
        }
        if (s.seasonTop && Array.isArray(s.seasonTop.autumn)) S.top = s.seasonTop.autumn;
        var lit = B.nightT > 0.5;
        if (lit !== pkLit) { pkLit = lit; lightPumpkins(lit); }
        if (s.seasonTop) S.fireTop = Array.isArray(s.seasonTop.fire) ? s.seasonTop.fire : [];
        B.vars({ '--ts-night': B.night });
        drawn = -1;
      },
      command: function (cmd, p) {
        p = p || {};
        switch (cmd) {
          // Follow: Kürbis immer anlegen, sichtbar nur im aktiven Thema
          case 'follow':
          case 'pumpkin': addPumpkin(p.name || '', B.on); pkTotal++; break;
          case 'build': scare.build(p.name || '', B.on); break;
          case 'whereami': {
            var me = (p.name || '').toLowerCase();
            var pk = pkNodes.filter(function (k) { return k && k.label && !k.zap && k.label.toLowerCase() === me; })[0];
            if (pk && B.on && B.partOn('pumpkins') && root.SeasonKit) { root.SeasonKit.hop(pk.inner); pkTag(pk, pk.label + ' is ' + PK_KIND_EN[pk.variety || 'classic'] + '!', true); }
            else if (!pk && p.visit && B.on && B.partOn('pumpkins')) visitPumpkin(p.name || '');
            break;
          }
          case 'snowmanreset': scare.reset(B.on); break;
          case 'rake': rake(p); break;
          case 'jump': jump(p.name || ''); break;
          case 'sweep': sweep(p); break;
          case 'leafstorm':
            setLevel(p);
            B.gust(1600);
            gust();
            B.tag('Leaf storm!', W / 2, 300, true);
            break;
          case 'gust': gust(p); break;
          case 'celebrate': celebrate(p.name || ''); break;
          // erst die Laubrecher, dann (wenn schon jemand gelöscht hat) die Feuerwehr
          case 'seasonboard':
            B.board('Top rakers', S.top);
            clearTimeout(fireBoardTimer);
            if (S.fireTop && S.fireTop.length) fireBoardTimer = setTimeout(function () { B.board('Top firefighters', S.fireTop); }, 10500);
            break;
          case 'spectacle': spectacle(p); break;
          case 'bolt': bolt(p); break;
          case 'extinguish': extinguish(p); break;
          case 'clear':
            if (p.kind === 'pumpkins') clearPumpkins();
            else if (p.kind === 'leaves') { S.target = 0; S.top = []; }
            break;
        }
      },
      busy: function () { return null; },
      status: function () { return { on: B.on, leaves: Math.round(S.shown), pumpkins: pkTotal, project: scare.n(),
                                     fire: burning().length, wet: +W8.wet.toFixed(2) }; }
    };
  }

  root.ThemeAutumn = { create: create };
})(typeof window !== 'undefined' ? window : this);
