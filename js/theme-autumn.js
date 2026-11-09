/* Herbst-Thema der Weather-Source: Blätterranke mit Lichtern oben, Ast in
 * der Ecke, fallendes Laub (Wind treibt es zur Seite), Laubhaufen in den
 * Ecken, Follower-Kürbisse mit Namen (nachts leuchten die Gesichter).
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
    function buildPumpkin(name, slot, animate) {
      var scale = 0.68 + ((slot * 7919) % 100) / 100 * 0.3;
      var g = el('g', { 'class': 'ta-pk' + (animate ? ' ta-pk--new' : '') });
      var inner = el('g', { 'class': 'ta-pk-inner' }, g);
      var body = el('g', { transform: 'scale(' + scale.toFixed(2) + ')' }, inner);
      el('ellipse', { 'class': 'ta-pk-light', cx: 0, cy: -30, rx: 56, ry: 40 }, body);
      el('ellipse', { 'class': 'ta-pk-body', cx: -18, cy: -30, rx: 24, ry: 30 }, body);
      el('ellipse', { 'class': 'ta-pk-body', cx: 18, cy: -30, rx: 24, ry: 30 }, body);
      el('ellipse', { 'class': 'ta-pk-lobe', cx: 0, cy: -31, rx: 22, ry: 31 }, body);
      el('path', { 'class': 'ta-pk-rib', d: 'M-12 -58 Q-20 -30 -12 -2 M12 -58 Q20 -30 12 -2' }, body);
      el('path', { 'class': 'ta-pk-stem', d: 'M-3 -58 Q-4 -70 4 -76 L8 -72 Q3 -66 4 -58 Z' }, body);
      el('path', { 'class': 'ta-pk-face', d: 'M-20 -40 L-10 -40 L-15 -50 Z M10 -40 L20 -40 L15 -50 Z M-22 -22 L-15 -16 L-8 -22 L0 -16 L8 -22 L15 -16 L22 -22 Q0 -4 -22 -22 Z' }, body);
      return { node: g, inner: inner, label: name, slot: slot, h: 80 * scale, x: PK_X[slot], y: H };
    }
    function placePumpkins() {
      var l = lvl();
      pkNodes.forEach(function (pk) {
        if (!pk) return;
        pk.y = Math.min(H - 6, surface(pk.x, l) + 10);
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

    // ── Partikel ──
    function spawn(o) {
      var parts = o.front ? B.front : B.back;
      if (!parts) return;
      parts.add({
        x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy === undefined ? rand(50, 90) : o.vy,
        term: rand(60, 100), sway: rand(20, 60), vph: rand(2, 5),
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
          case 'pumpkin': addPumpkin(p.name || '', true); pkTotal++; break;
          case 'rake': rake(p); break;
          case 'jump': jump(p.name || ''); break;
          case 'sweep': sweep(p); break;
          case 'gust': gust(); break;
          case 'celebrate': celebrate(p.name || ''); break;
          case 'seasonboard': B.board('Top rakers', S.top); break;
          case 'clear':
            if (p.kind === 'pumpkins') clearPumpkins();
            else if (p.kind === 'leaves') { S.target = 0; S.top = []; }
            break;
        }
      },
      busy: function () { return null; },
      status: function () { return { on: B.on, leaves: Math.round(S.shown), pumpkins: pkTotal }; }
    };
  }

  root.ThemeAutumn = { create: create };
})(typeof window !== 'undefined' ? window : this);
