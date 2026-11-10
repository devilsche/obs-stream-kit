/* Herbst-Thema der Weather-Source: Blätterranke mit Lichtern oben, Ast in
 * der Ecke, fallendes Laub (Wind treibt es zur Seite), Laubhaufen in den
 * Ecken, Follower-Kürbisse mit Namen (nachts leuchten die Gesichter),
 * Vogelscheuche als gemeinsames Sub-Projekt (8 Teile). Spektakel: eine
 * Windhose wirbelt Laub auf und hebt 2–4 Kürbisse an, beim Tsunami
 * schwimmen die Kürbisse kurz auf und setzen sich wieder. Schnee setzt
 * Hauben auf Kürbisse und den Hut der Vogelscheuche, die danach schmelzen.
 * Optik aus effects/autumn.html; die Laubhöhe rechnet der Server
 * (seasonLevels.leaves), hier wird nur gezeigt. Braucht js/season-kit.js
 * und js/theme-seasons.js.
 *
 *   var theme = ThemeAutumn.create(stageEl, { tags: svgGroup, hud: hudEl });
 *   theme.load(deco);  theme.update(state);  theme.command(cmd, params);
 */
(function (root) {
  'use strict';

  var PART_KEYS = ['garland', 'branch', 'pile', 'pumpkins'];

  // ── Blattformen: Stiel bei y≈+18, Spitze bei y≈-20 ──
  var LEAVES = [
    { body: 'M0 -20 L4 -9 L12 -14 L10 -4 L19 -3 L11 4 L14 10 L4 8 L1 18 L-1 18 L-4 8 L-14 10 L-11 4 L-19 -3 L-10 -4 L-12 -14 L-4 -9 Z',
      vein: 'M0 24 L0 -14 M0 4 L11 -2 M0 4 L-11 -2' },
    { body: 'M0 -20 Q6 -17 5 -12 Q10 -10 7 -5 Q12 -2 8 3 Q12 7 6 10 Q6 16 0 18 Q-6 16 -6 10 Q-12 7 -8 3 Q-12 -2 -7 -5 Q-10 -10 -5 -12 Q-6 -17 0 -20 Z',
      vein: 'M0 24 L0 -16' },
    { body: 'M0 -18 Q11 -8 8 6 Q4 16 0 18 Q-4 16 -8 6 Q-11 -8 0 -18 Z',
      vein: 'M0 24 L0 -12' }
  ];
  var PALETTE = ['#d9480f', '#f08c00', '#c92a2a', '#fab005', '#a0522d'];
  function shade(hex, f) {
    var n = parseInt(hex.replace('#', ''), 16);
    return 'rgb(' + Math.round((n >> 16) * f) + ',' + Math.round(((n >> 8) & 255) * f) + ',' + Math.round((n & 255) * f) + ')';
  }
  var DARK = PALETTE.map(function (c) { return shade(c, 0.62); });

  var MAX_PK = 30;
  var MAXH = 190;          // Haufenhöhe bei 100 %
  var BASE = 0.15;         // ein bisschen Laub liegt immer, auch frisch gerecht

  function create(stage, opts) {
    var TS = root.ThemeSeasons;
    var B = TS.base(stage, opts, 'autumn', PART_KEYS);
    var W = B.W, H = B.H, el = B.el, f1 = B.f1, rand = B.rand, clamp01 = B.clamp01;
    var rnd = TS.seeded(11);

    LEAVES.forEach(function (l, i) {
      var g = el('g', { id: 'ta-lf' + i }, B.defs);
      el('path', { d: l.body }, g);
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
      ctx.strokeStyle = 'rgba(50,20,0,.45)';
      ctx.lineWidth = 1.4;
      ctx.stroke(LEAVES[shape].p2vein);
      ctx.restore();
    }
    function leafDraw(ctx, p, a) {
      drawLeaf(ctx, p.shape, p.x, p.y, p.rot, Math.cos(p.ph * 1.3), p.s, PALETTE[p.ci], a);
    }

    // Ebenen: fallendes Laub (Basis), Ranke, Ast, Haufen, Kürbisse
    var gGarland = el('g', { 'class': 'ta-garland' }, B.svg('ta-garland-l'));
    var branchSvg = B.svg('ta-branch-l');
    var gBranch = el('g', { 'class': 'ta-branch ta-dim' }, branchSvg);
    var gSway = el('g', { 'class': 'ta-sway' }, gBranch);
    // Vogelscheuche hinter dem Laubhaufen (der Pfahl steckt im Laub)
    var gScare = el('g', { 'class': 'ta-scare ta-dim' }, B.svg());
    var pileCanvas = B.canvas();
    pileCanvas.classList.add('ta-pile', 'ta-dim');
    var pctx = pileCanvas.getContext('2d');
    var gPumpkins = el('g', { 'class': 'ta-pumpkins' }, B.svg());

    // ── Blätterranke oben mit Lichtern und Eicheln ──
    (function () {
      var d = 'M-10 4';
      for (var i = 0; i < 5; i++) {
        var x0 = -10 + i * 388;
        d += ' Q' + (x0 + 194) + ' ' + (i % 2 ? 66 : 80) + ' ' + (x0 + 388) + ' 4';
      }
      var vine = el('path', { 'class': 'ta-vine', d: d }, gGarland);
      var len = vine.getTotalLength(), n = 0;
      for (var s = 10; s < len; s += 30, n++) {
        var p = vine.getPointAtLength(s);
        var q = vine.getPointAtLength(Math.min(len, s + 1));
        var ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
        var side = n % 2 ? 1 : -1;
        leafUse(gGarland, n % 3, p.x, p.y, 180 + ang + side * (30 + rnd() * 25), 1.1 + rnd() * 0.5, 'ta-vleaf');
        if (n % 9 === 4) {
          var a = el('g', { transform: 'translate(' + f1(p.x) + ' ' + f1(p.y + 8) + ')' }, gGarland);
          el('ellipse', { 'class': 'ta-acorn-nut', cx: 0, cy: 14, rx: 8, ry: 11 }, a);
          el('path', { 'class': 'ta-acorn-cap', d: 'M-10 6 Q0 -6 10 6 Q0 10 -10 6 Z' }, a);
        }
        if (n % 2 === 0) {
          var fl = el('g', { 'class': 'ta-fl ri-' + Math.floor(rnd() * 10), transform: 'translate(' + f1(p.x) + ' ' + f1(p.y + 6) + ')' }, gGarland);
          el('circle', { 'class': 'ta-fl-glow', r: 11 }, fl);
          el('circle', { 'class': 'ta-fl-dot', r: 4 }, fl);
        }
      }
    })();

    // ── Ast oben links ──
    var branchLeaves = [];
    [
      { d: 'M-20 150 Q120 130 260 170 Q360 200 430 190', w: 16 },
      { d: 'M120 140 Q170 90 240 70', w: 7 },
      { d: 'M240 165 Q290 230 270 290', w: 6 },
      { d: 'M330 190 Q380 150 440 140', w: 5 },
      { d: 'M60 146 Q80 200 60 250', w: 5 }
    ].forEach(function (t) {
      var path = el('path', { 'class': 'ta-wood', d: t.d, 'stroke-width': t.w }, gSway);
      var len = path.getTotalLength();
      for (var s = len * 0.3; s < len; s += 34) {
        var p = path.getPointAtLength(s);
        var u = leafUse(gSway, Math.floor(rnd() * 3), p.x, p.y, rnd() * 90 + 135, 1.3 + rnd() * 0.6, 'ta-bl');
        branchLeaves.push({ node: u, x: p.x, y: p.y, gone: false });
      }
    });

    // ── Laubhaufen in den Ecken (Mitte bleibt frei) ──
    function prof(x) {
      var w = 660;
      function bump(d) { return d < w ? 0.5 + 0.5 * Math.cos(Math.PI * d / w) : 0; }
      return Math.max(bump(x), bump(W - x) * 0.92);
    }
    function drawnLevel(pct) { return BASE + (1 - BASE) * pct / 100; }
    var S = { target: 0, shown: 0, first: true, top: [] };
    function lvl() { return B.partOn('pile') ? drawnLevel(S.shown) : 0; }
    function surface(x, l) { return H - prof(x) * MAXH * (l === undefined ? lvl() : l); }

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
      for (var x = 0; x <= W; x += 16) pctx.lineTo(x, H - prof(x) * MAXH * l * 0.88);
      pctx.lineTo(W, H);
      pctx.fill();
      for (var i = 0; i < pileLeaves.length; i++) {
        var lf = pileLeaves[i];
        if (lf.f > l) break;
        var pr = prof(lf.x);
        if (pr < 0.04 || lf.thin > pr * 1.4) continue;     // flache Stellen dünner belegen
        var y = H - pr * MAXH * lf.f + lf.jy - 4;
        drawLeaf(pctx, lf.shape, lf.x, y, lf.rot, 1, lf.s, lf.dk && lf.f < l - 0.08 ? DARK[lf.ci] : PALETTE[lf.ci], 1);
      }
    }

    // ── Kürbisse: 30 Plätze, abwechselnd links/rechts von der Ecke nach innen ──
    var PK_X = [];
    for (var pi = 0; pi < MAX_PK / 2; pi++) { PK_X.push(60 + pi * 46); PK_X.push(W - 60 - pi * 46); }
    var pkNodes = [], pkNext = 0, pkTotal = 0;
    // Je Platz feste Streuung: Sorte (Farbe), Form, Neigung und Tiefe –
    // hinten kleiner, höher und dunkler, damit der Haufen räumlich wirkt
    function pkRand(slot, s) { var v = Math.sin(slot * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); }
    function buildPumpkin(name, slot, animate) {
      var depth = pkRand(slot, 3);
      var scale = (0.68 + ((slot * 7919) % 100) / 100 * 0.3) * (1 - 0.22 * depth);
      var wide = pkRand(slot, 1), sx = scale * (0.86 + 0.34 * wide), sy = scale * (1.12 - 0.28 * wide);
      var tilt = (pkRand(slot, 4) - 0.5) * 14;
      var g = el('g', { 'class': 'ta-pk ta-pk--c' + (1 + Math.floor(pkRand(slot, 2) * 5)) + (animate ? ' ta-pk--new' : '') });
      // Zwischenebene zum Anheben/Aufschwimmen (Fuß bei 0/0)
      var lift = el('g', {}, g);
      var inner = el('g', { 'class': 'ta-pk-inner' }, lift);
      el('ellipse', { 'class': 'ta-pk-shadow', cx: 0, cy: 0, rx: f1(44 * sx), ry: f1(7 * scale) }, inner);
      var body = el('g', { transform: 'rotate(' + f1(tilt) + ' 0 -30) scale(' + sx.toFixed(2) + ' ' + sy.toFixed(2) + ')' }, inner);
      el('ellipse', { 'class': 'ta-pk-light', cx: 0, cy: -30, rx: 56, ry: 40 }, body);
      el('ellipse', { 'class': 'ta-pk-body', cx: -18, cy: -30, rx: 24, ry: 30 }, body);
      el('ellipse', { 'class': 'ta-pk-body', cx: 18, cy: -30, rx: 24, ry: 30 }, body);
      el('ellipse', { 'class': 'ta-pk-lobe', cx: 0, cy: -31, rx: 22, ry: 31 }, body);
      el('path', { 'class': 'ta-pk-rib', d: 'M-12 -58 Q-20 -30 -12 -2 M12 -58 Q20 -30 12 -2' }, body);
      el('ellipse', { 'class': 'ta-pk-sheen', cx: -22, cy: -42, rx: 7, ry: 13, transform: 'rotate(-18 -22 -42)' }, body);
      // Tiefe: dunkler Schleier über den hinteren Kürbissen
      el('ellipse', { 'class': 'ta-pk-shade', cx: 0, cy: -30, rx: 43, ry: 31, 'fill-opacity': (0.42 * depth).toFixed(2) }, body);
      el('path', { 'class': 'ts-cap', d: 'M-40 -45 Q-37 -64 -18 -63 Q0 -68 18 -63 Q37 -64 40 -45 Q20 -54 0 -52 Q-20 -54 -40 -45 Z' }, body);
      el('path', { 'class': 'ta-pk-stem', d: 'M-3 -58 Q-4 -70 4 -76 L8 -72 Q3 -66 4 -58 Z' }, body);
      el('path', { 'class': 'ta-pk-face', d: 'M-20 -40 L-10 -40 L-15 -50 Z M10 -40 L20 -40 L15 -50 Z M-22 -22 L-15 -16 L-8 -22 L0 -16 L8 -22 L15 -16 L22 -22 Q0 -4 -22 -22 Z' }, body);
      return { node: g, inner: inner, lift: lift, label: name, slot: slot, h: 80 * sy, x: PK_X[slot], y: H, dy: -26 * depth,
               ly: 0, lx: 0, rot: 0, vy: 0, mode: null, shown: '' };
    }
    function placePumpkins() {
      var l = lvl();
      pkNodes.forEach(function (pk) {
        if (!pk) return;
        pk.y = Math.min(H - 6, surface(pk.x, l) + 10) + pk.dy;
        pk.node.setAttribute('transform', 'translate(' + pk.x + ' ' + f1(pk.y) + ')');
      });
    }
    function sortPumpkins() {
      pkNodes.filter(Boolean).sort(function (a, b) { return a.y - b.y; })
        .forEach(function (pk) { gPumpkins.appendChild(pk.node); });
    }
    function addPumpkin(name, animate) {
      var i = pkNext % MAX_PK;
      if (pkNodes[i]) gPumpkins.removeChild(pkNodes[i].node);
      pkNodes[i] = buildPumpkin(name, i, animate);
      gPumpkins.appendChild(pkNodes[i].node);
      pkNext++;
      placePumpkins();
      sortPumpkins();
      if (animate && B.on && B.partOn('pumpkins')) B.tag(name, pkNodes[i].x, pkNodes[i].y - pkNodes[i].h - 12, false);
    }
    function clearPumpkins() { B.clear(gPumpkins); pkNodes = []; pkNext = 0; pkTotal = 0; }

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
    function gust() {
      var dir = B.gust(900);
      [[20, 600], [W - 600, W - 20]].forEach(function (r) {
        for (var i = 0; i < 25; i++) {
          var x = rand(r[0], r[1]);
          spawn({ x: x, y: surface(x) + rand(0, 15), vx: dir * rand(300, 700), vy: rand(-380, -120), front: true });
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
      B.tag(removed > 0 ? name + ' raked!' : name + ': nothing left to rake', mid, surface(mid) - 70, true);
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
      B.tag((name || 'Someone') + ' jumped in!', x, y - 150, true);
    }
    function sweep(p) {
      setLevel(p);
      if (!(parseFloat(p.done) > 0)) { B.tag('No leaves to sweep', W / 2, 300, true); return; }
      B.gust(1400);
      gust();
      B.tag('Swept clean!', W / 2, 300, true);
    }

    // ── Spektakel: Windhose und Tsunami ──
    var show = null, whirlAcc = 0, tNow = 0;
    function spectacle(p) {
      if (!B.on || p.reduced || (p.type !== 'tornado' && p.type !== 'tsunami')) return;
      show = p;
      if (p.type !== 'tornado' || !B.partOn('pumpkins')) return;
      // 2–4 Kürbisse werden mitgerissen
      var pool = pkNodes.filter(Boolean), n = Math.min(pool.length, 2 + Math.floor(Math.random() * 3));
      for (var i = 0; i < n; i++) {
        var k = Math.floor(Math.random() * pool.length);
        pool[k].mode = 'wait';
        pool[k].peak = rand(170, 280);
        pool.splice(k, 1);
      }
    }
    function renderPk(pk) {
      var tr = pk.ly < 0.3 && Math.abs(pk.lx) < 0.3 && Math.abs(pk.rot) < 0.3 ? ''
        : 'translate(' + f1(pk.lx) + ' ' + f1(-pk.ly) + ') rotate(' + f1(pk.rot) + ' 0 -30)';
      if (tr === pk.shown) return;
      pk.shown = tr;
      pk.lift.setAttribute('transform', tr);
    }
    function stepShow(dt) {
      tNow += dt;
      var live = show && show.active();
      var tx = live && show.type === 'tornado' ? show.x() : null;
      // Laub am Fuß der Windhose aufwirbeln (Partikel blenden an den Rändern aus)
      if (tx !== null && tx > -100 && tx < W + 100) {
        whirlAcc += dt * 45;
        while (whirlAcc >= 1) {
          whirlAcc--;
          var x = tx + rand(-70, 70);
          spawn({ x: x, y: surface(x) + rand(0, 10), vx: show.dir * rand(150, 450) + rand(-250, 250), vy: rand(-1200, -550),
                  g: 650, sway: rand(90, 170), vph: rand(5, 9), front: true, s: rand(0.8, 1.4), life: rand(2.5, 4) });
        }
      }
      pkNodes.forEach(function (pk) {
        if (!pk) return;
        if (pk.mode === 'wait' && tx !== null && Math.abs(tx - pk.x) < 110) pk.mode = 'up';
        if (pk.mode === 'up') {
          // im Wirbel: steigt, kreiselt, folgt der Windhose ein Stück
          pk.ly += (pk.peak - pk.ly) * Math.min(1, dt * 2.2);
          pk.lx += (Math.max(-130, Math.min(130, ((tx === null ? pk.x : tx) - pk.x) * 0.6)) + Math.sin(tNow * 7) * 30 - pk.lx) * Math.min(1, dt * 3);
          pk.rot += dt * 260 * (show.dir || 1);
          if (tx === null || (tx - pk.x) * (show.dir || 1) > 220) { pk.mode = 'fall'; pk.vy = 0; }
        } else if (pk.mode === 'fall') {
          // fällt zurück auf seinen Platz, kurzer Hüpfer
          pk.vy += 2200 * dt;
          pk.ly -= pk.vy * dt;
          pk.lx *= Math.pow(0.02, dt);
          pk.rot += (Math.round(pk.rot / 360) * 360 - pk.rot) * Math.min(1, dt * 6);
          if (pk.ly <= 0) {
            pk.ly = 0;
            if (pk.vy > 500) pk.vy = -pk.vy * 0.3;
            else { pk.mode = null; pk.vy = 0; pk.lx = 0; pk.rot = 0; }
          }
        } else if (pk.mode === 'wait' && !live) {
          pk.mode = null;
        } else if (!pk.mode) {
          // Tsunami: auf dem Wasser treiben (gut halb eingetaucht), sonst wieder absetzen
          var target = 0, bob = 0;
          if (live && show.type === 'tsunami') {
            target = Math.max(0, Math.min(320, pk.y - (H - show.level(pk.x)) - 0.45 * pk.h));
            bob = target > 4 ? 1 : 0;
          }
          pk.ly += (target - pk.ly) * Math.min(1, dt * (target > pk.ly ? 3 : 1.4));
          pk.rot = bob * Math.sin(tNow * 2.1 + pk.slot) * 9 * Math.min(1, pk.ly / 30) + (1 - bob) * pk.rot * Math.pow(0.1, dt);
          pk.lx = Math.sin(tNow * 1.3 + pk.slot * 2) * 8 * Math.min(1, pk.ly / 30);
          if (pk.ly < 0.3 && !live) { pk.ly = 0; pk.lx = 0; pk.rot = 0; }
        }
        renderPk(pk);
      });
      if (show && !live && !pkNodes.some(function (pk) { return pk && (pk.mode || pk.ly > 0); })) show = null;
    }
    function resetShow() {
      show = null;
      pkNodes.forEach(function (pk) { if (pk) { pk.mode = null; pk.ly = 0; pk.lx = 0; pk.rot = 0; renderPk(pk); } });
    }

    // ── Hauptschleife ──
    var spawnAcc = 0, branchAcc = 0, drawn = -1, offFor = 99;
    TS.loop(function (dt) {
      // Laubhöhe folgt dem Server: Zuwachs weich, Rechen sichtbar schneller
      if (B.reduceMotion) S.shown = S.target;
      else if (S.shown !== S.target) {
        var diff = S.target - S.shown, stp = Math.max(diff > 0 ? 1 : 12, Math.abs(diff) * 1.2) * dt;
        S.shown = Math.abs(diff) <= stp ? S.target : S.shown + (diff > 0 ? stp : -stp);
      }
      // ausgeblendet nur noch kurz weiterzeichnen (Partikel fallen zu Ende)
      offFor = B.on ? 0 : offFor + dt;
      if (offFor > 3) return;
      if (B.on) stepShow(dt); else if (show) resetShow();
      B.stepSnow(dt);
      var l = lvl();
      if (Math.abs(l - drawn) > 0.002) { drawPile(l); placePumpkins(); drawn = l; }
      if (B.on) {
        // Laub fällt stetig, mit Wind deutlich mehr
        var w = Math.abs(B.windBase);
        spawnAcc += (2.5 + 9 * w) * dt;
        while (spawnAcc >= 1) {
          spawnAcc--;
          spawn({ x: rand(-200, W + 200) - B.windBase * 400, y: -40 });
        }
        // Ast verliert bei Wind Blätter, sie wachsen später nach
        if (B.partOn('branch') && w > 0.2) {
          branchAcc += dt * w;
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
    var spotRound = 0, lastSpot = null;
    setInterval(function () {
      if (!B.on) return;
      spotRound++;
      var top = S.top[0];
      if (top && spotRound % 4 === 0) { B.tag('Top raker: ' + top[0] + ' · ' + top[1] + '×', W / 2, 300, false); return; }
      if (!B.partOn('pumpkins')) return;
      var pool = pkNodes.filter(function (pk) { return pk && pk.label; });
      if (!pool.length) return;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick === lastSpot && pool.length > 1) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
      lastSpot = pick;
      B.spot(pick.inner);
      B.tag(pick.label, pick.x, pick.y - pick.h - 12, false);
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
          case 'snowmanreset': scare.reset(B.on); break;
          case 'rake': rake(p); break;
          case 'jump': jump(p.name || ''); break;
          case 'sweep': sweep(p); break;
          case 'gust': gust(); break;
          case 'celebrate': celebrate(p.name || ''); break;
          case 'seasonboard': B.board('Top rakers', S.top); break;
          case 'spectacle': spectacle(p); break;
          case 'clear':
            if (p.kind === 'pumpkins') clearPumpkins();
            else if (p.kind === 'leaves') { S.target = 0; S.top = []; }
            break;
        }
      },
      busy: function () { return null; },
      status: function () { return { on: B.on, leaves: Math.round(S.shown), pumpkins: pkTotal, project: scare.n() }; }
    };
  }

  root.ThemeAutumn = { create: create };
})(typeof window !== 'undefined' ? window : this);
