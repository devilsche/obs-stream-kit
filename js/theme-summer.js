/* Sommer-Thema der Weather-Source: Strand unten mit Follower-Sandburgen
 * (Fahne mit Namen), Sandpalast als gemeinsames Sub-Projekt (8 Teile),
 * Sonnenschirm, Muscheln, Hitzeflimmern über dem Sand,
 * Eis, das mit der Hitze schmilzt, abends dunklerer Rand und Glühwürmchen.
 * Eine eigene Sonne gibt es nicht: die Sonnenbrille sitzt auf der Sonne der
 * Weather-Kit (opts.sky liefert deren Stand), ihr Hof wächst mit der Hitze.
 * Hitze rechnet der Server (seasonLevels.heat). Optik aus effects/summer.html.
 * Braucht js/season-kit.js und js/theme-seasons.js.
 *
 *   var theme = ThemeSummer.create(stageEl, { tags, hud, sky: function () { return kit.state(); } });
 *   theme.load(deco);  theme.update(state);  theme.command(cmd, params);
 */
(function (root) {
  'use strict';

  var PART_KEYS = ['beach', 'umbrella'];
  var MAX_C = 24;
  var CONFETTI = ['#e84a5f', '#2a9df4', '#f2b705', '#2ec27e', '#ffffff'];

  function create(stage, opts) {
    opts = opts || {};
    var TS = root.ThemeSeasons;
    var B = TS.base(stage, opts, 'summer', PART_KEYS);
    var W = B.W, H = B.H, el = B.el, f1 = B.f1, rand = B.rand, clamp01 = B.clamp01;
    var rnd = TS.seeded(31);

    function grad(kind, id, attrs, stops) {
      var g = el(kind, Object.assign({ id: id }, attrs), B.defs);
      stops.forEach(function (s) { el('stop', { offset: s[0], 'stop-color': s[1], 'stop-opacity': s[2] === undefined ? 1 : s[2] }, g); });
    }
    grad('linearGradient', 'tss-sandG', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#f3dca2'], [1, '#d9b874']]);
    grad('linearGradient', 'tss-hotG', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#ffb35a'], [1, '#e8873a']]);
    grad('radialGradient', 'tss-haloG', {}, [[0, '#ffd27a', 0.55], [0.5, '#ffa040', 0.22], [1, '#ff8a30', 0]]);

    // Abendstimmung: nur Ober- und Unterrand, Bildmitte bleibt frei
    var evening = document.createElement('div');
    evening.className = 'tss-evening';
    B.root.insertBefore(evening, B.root.firstChild);

    // Ebenen: Glühwürmchen (Basis), Sonnen-Halo, Strand, Flimmern, Eis
    var skySvg = B.svg();
    var gSun = el('g', { 'class': 'tss-sun' }, skySvg);
    var halo = el('circle', { 'class': 'tss-halo', r: 1 }, gSun);

    var beachSvg = B.svg();
    var gBeach = el('g', { 'class': 'tss-beach tss-dim' }, beachSvg);
    var gUmbrella = el('g', { 'class': 'tss-umbrella' }, gBeach);
    var sand = el('path', { 'class': 'tss-sand' }, gBeach);
    var sandHot = el('path', { 'class': 'tss-sand tss-sand--hot' }, gBeach);
    var gDeco = el('g', {}, gBeach);
    // Sandpalast hinter der Burgenreihe
    var gPalace = el('g', { 'class': 'tss-palace' }, gBeach);
    var gCastles = el('g', {}, gBeach);
    var gIces = el('g', {}, gBeach);
    var shimmerCanvas = B.canvas();
    shimmerCanvas.classList.add('tss-shimmer');
    var shctx = shimmerCanvas.getContext('2d');
    var gBall = el('g', {}, B.fxSvg);

    // ── Strand ──
    function sandY(x) { return H - 70 - 10 * Math.sin(x / 140) - 6 * Math.sin(x / 47 + 1); }
    (function () {
      var d = 'M0 ' + H;
      for (var x = 0; x <= W; x += 16) d += ' L' + x + ' ' + f1(sandY(x));
      d += ' L' + W + ' ' + H + ' Z';
      sand.setAttribute('d', d);
      sandHot.setAttribute('d', d);
      for (var i = 0; i < 160; i++) { var dx = rnd() * W; el('circle', { 'class': 'tss-dot', cx: dx.toFixed(0), cy: (sandY(dx) + 10 + rnd() * 50).toFixed(0), r: (1 + rnd() * 2).toFixed(1) }, gDeco); }
      [[300, 1], [1130, -1], [1590, 1]].forEach(function (s) {
        var g = el('g', { transform: 'translate(' + s[0] + ' ' + (sandY(s[0]) + 28).toFixed(0) + ') scale(' + s[1] + ' 1)' }, gDeco);
        el('path', { 'class': 'tss-shell', d: 'M-12 0 Q-14 -18 0 -20 Q14 -18 12 0 Z M-6 -2 L-3 -18 M0 -2 L0 -19 M6 -2 L3 -18' }, g);
      });
      var ux = 1500, uy = sandY(1500) + 20;
      el('line', { 'class': 'tss-pole', x1: ux, y1: uy, x2: ux - 30, y2: uy - 260 }, gUmbrella);
      var top = el('g', { transform: 'translate(' + (ux - 30) + ' ' + (uy - 260) + ') rotate(-7)' }, gUmbrella);
      // Kuppel mit gewelltem Saum; die weißen Bahnen laufen von der Spitze
      // zum Saum und werden auf die Kuppel beschnitten (nichts ragt heraus)
      var DOME = 'M-150 30 C-140 -46 140 -46 150 30 Q125 18 100 30 Q75 16 50 30 Q25 16 0 30 Q-25 16 -50 30 Q-75 16 -100 30 Q-125 18 -150 30 Z';
      var clip = el('clipPath', { id: 'tss-uclip' }, top);
      el('path', { d: DOME }, clip);
      el('path', { 'class': 'tss-utop', d: DOME }, top);
      el('path', { 'class': 'tss-ustripe', 'clip-path': 'url(#tss-uclip)',
                   d: 'M0 -27 Q-62 -14 -100 40 L-50 40 Q-24 -2 0 -27 Z M0 -27 Q24 -2 50 40 L100 40 Q62 -14 0 -27 Z' }, top);
      el('circle', { 'class': 'tss-utip', cx: 0, cy: -29, r: 5 }, top);
    })();

    // ── Sandburgen der Follower: 24 Plätze links und rechts, die Mitte
    // unten (Spielanzeigen) bleibt frei ──
    var CASTLE_X = [];
    for (var ci = 0; ci < MAX_C; ci++) {
      var cx0 = 70 + ((ci * 7) % MAX_C) * 56;
      CASTLE_X.push(cx0 < 720 ? cx0 : cx0 + 480);
    }
    var castles = [], cNext = 0, cTotal = 0;
    function addCastle(name, animate) {
      var i = cNext % CASTLE_X.length, x = CASTLE_X[i], y = sandY(x) + 26, k = 0.5 + (i % 3) * 0.12;
      if (castles[i]) gCastles.removeChild(castles[i].node);
      var outer = el('g', { transform: 'translate(' + x + ' ' + y.toFixed(0) + ') scale(' + k.toFixed(2) + ')' }, gCastles);
      var g = el('g', { 'class': 'tss-castle-g' + (animate ? ' tss-castle-g--new' : '') }, outer);
      el('path', { 'class': 'tss-castle', d: 'M-50 0 L-50 -40 L50 -40 L50 0 Z' }, g);
      el('path', { 'class': 'tss-castle', d: 'M-58 0 L-58 -64 L-52 -64 L-52 -72 L-44 -72 L-44 -64 L-36 -64 L-36 -72 L-28 -72 L-28 -64 L-24 -64 L-24 0 Z' }, g);
      el('path', { 'class': 'tss-castle', d: 'M24 0 L24 -64 L28 -64 L28 -72 L36 -72 L36 -64 L44 -64 L44 -72 L52 -72 L52 -64 L58 -64 L58 0 Z' }, g);
      el('path', { 'class': 'tss-castle', d: 'M-16 -40 L-16 -84 L-10 -84 L-10 -92 L-2 -92 L-2 -84 L2 -84 L2 -92 L10 -92 L10 -84 L16 -84 L16 -40 Z' }, g);
      el('path', { 'class': 'tss-door', d: 'M-10 0 L-10 -20 Q0 -32 10 -20 L10 0 Z' }, g);
      el('line', { 'class': 'tss-flagpole', x1: 0, y1: -92, x2: 0, y2: -140 }, g);
      el('path', { 'class': 'tss-flag tss-f' + (1 + i % 5), d: 'M1 -140 L36 -132 L1 -122 Z' }, g);
      castles[i] = { node: outer, inner: g, x: x, y: y - 150 * k, label: name };
      cNext++;
      if (animate && B.on && B.partOn('beach')) B.tag(name, x, y - 160 * k, false);
    }
    function clearCastles() { B.clear(gCastles); castles = []; cNext = 0; cTotal = 0; }

    // ── Sandpalast: gemeinsames Sub-Projekt, wächst Turm um Turm ──
    function merlons(x0, x1, y, w) {
      var d = '', n = Math.max(2, Math.round((x1 - x0) / (w * 2)));
      var step = (x1 - x0 - w) / (n - 1);
      for (var i = 0; i < n; i++) { var x = x0 + i * step; d += 'M' + f1(x) + ' ' + y + ' h' + w + ' v-' + w + ' h-' + w + ' Z '; }
      return d;
    }
    var palace = B.project(gPalace, {
      x: 270, k: 0.85,
      y: function () { return sandY(270) + 14; },
      top: function (n) { return [0, 40, 150, 150, 230, 310, 326, 326, 420][n]; },
      done: 'The sand palace is complete!',
      names: ['the foundation', 'the walls', 'the gate', 'two towers', 'the keep', 'battlements', 'little flags', 'the royal flag'],
      parts: [
        function (g) {
          el('path', { 'class': 'tss-castle', d: 'M-200 0 Q-206 -30 -178 -40 L178 -40 Q206 -30 200 0 Z' }, g);
          el('path', { 'class': 'tss-pal-line', d: 'M-170 -20 L170 -20' }, g);
        },
        function (g) {
          el('rect', { 'class': 'tss-castle', x: -140, y: -150, width: 280, height: 112 }, g);
          el('path', { 'class': 'tss-pal-line', d: 'M-140 -112 L140 -112 M-140 -76 L140 -76 M-90 -150 L-90 -112 M60 -112 L60 -76 M-40 -76 L-40 -40 M100 -150 L100 -112' }, g);
        },
        function (g) {
          el('path', { 'class': 'tss-door', d: 'M-32 -38 L-32 -98 Q0 -132 32 -98 L32 -38 Z' }, g);
          el('path', { 'class': 'tss-pal-grid', d: 'M-16 -40 L-16 -114 M0 -40 L0 -120 M16 -40 L16 -114 M-32 -80 L32 -80 M-32 -60 L32 -60' }, g);
          el('path', { 'class': 'tss-castle', d: 'M-46 -38 L46 -38 L54 -24 L-54 -24 Z M-54 -24 L54 -24 L60 -10 L-60 -10 Z' }, g);
        },
        function (g) {
          [-160, 160].forEach(function (cx) {
            el('rect', { 'class': 'tss-castle', x: cx - 32, y: -230, width: 64, height: 192 }, g);
            el('path', { 'class': 'tss-door', d: 'M' + (cx - 9) + ' -170 L' + (cx - 9) + ' -190 Q' + cx + ' -202 ' + (cx + 9) + ' -190 L' + (cx + 9) + ' -170 Z' }, g);
            el('path', { 'class': 'tss-pal-line', d: 'M' + (cx - 32) + ' -130 L' + (cx + 32) + ' -130 M' + (cx - 32) + ' -90 L' + (cx + 32) + ' -90' }, g);
          });
        },
        function (g) {
          el('rect', { 'class': 'tss-castle', x: -56, y: -310, width: 112, height: 162 }, g);
          el('path', { 'class': 'tss-door', d: 'M-12 -238 L-12 -266 Q0 -282 12 -266 L12 -238 Z' }, g);
          el('circle', { 'class': 'tss-shell-dot', cx: -30, cy: -200, r: 6 }, g);
          el('circle', { 'class': 'tss-shell-dot', cx: 30, cy: -200, r: 6 }, g);
        },
        function (g) {
          el('path', { 'class': 'tss-castle', d: merlons(-140, 140, -150, 16) + merlons(-192, -128, -230, 14) + merlons(128, 192, -230, 14) + merlons(-56, 56, -310, 16) }, g);
        },
        function (g) {
          [-160, 160].forEach(function (cx, i) {
            el('line', { 'class': 'tss-flagpole', x1: cx, y1: -244, x2: cx, y2: -296 }, g);
            el('path', { 'class': 'tss-flag tss-f' + (i ? 5 : 2), d: 'M' + (cx + 1) + ' -296 L' + (cx + 34) + ' -288 L' + (cx + 1) + ' -279 Z' }, g);
          });
        },
        function (g) {
          el('line', { 'class': 'tss-flagpole tss-flagpole--big', x1: 0, y1: -326, x2: 0, y2: -420 }, g);
          el('path', { 'class': 'tss-flag tss-f1', d: 'M2 -420 L76 -403 L2 -384 Z' }, g);
          el('circle', { 'class': 'tss-pal-knob', cx: 0, cy: -424, r: 5 }, g);
        }
      ],
      burst: function (x, y) {
        if (!B.front) return;
        for (var i = 0; i < 26; i++) {
          B.front.add({ x: x + rand(-60, 60), y: y + rand(-20, 20), vx: rand(-300, 300), vy: rand(-650, -250), g: 1400, term: 900,
                        sway: 0, vr: 0, wf: 0, r: rand(2, 5), c: i % 4 ? '#e2c27f' : '#ffffff', life: 1.4, floor: sandY, draw: droplet });
        }
      }
    });

    // ── Hitze ──
    var S = { heat: 0, heatT: 0, first: true, top: [] };
    function heatK() { return Math.max(S.heat / 100, B.heat); }

    // ── Eis: steckt kopfüber schräg im Sand, schmilzt in 40 s (kühl) bis
    // 12 s (volle Hitze), nur Show; links oder rechts, die Mitte bleibt frei ──
    var ices = [];
    function addIce(name) {
      var x = Math.random() < 0.5 ? rand(120, 680) : rand(1240, W - 120), y = sandY(x) + 6;
      var flavor = 1 + Math.floor(Math.random() * 4), tilt = (Math.random() < 0.5 ? -1 : 1) * rand(150, 168);
      var g = el('g', { transform: 'translate(' + x.toFixed(0) + ' ' + y.toFixed(0) + ') scale(0.6)' }, gIces);
      // Kugel unten im Sand, Waffel ragt schräg nach oben
      var body = el('g', { transform: 'rotate(' + tilt.toFixed(0) + ' 0 -84)' }, el('g', { transform: 'translate(0 84)' }, g));
      el('path', { 'class': 'tss-cone', d: 'M-20 -70 L20 -70 L0 0 Z' }, body);
      el('path', { 'class': 'tss-cone-grid', d: 'M-14 -62 L8 -24 M-6 -70 L13 -40 M14 -62 L-8 -24 M6 -70 L-13 -40' }, body);
      var drip = el('path', { 'class': 'tss-scoop' + flavor }, body);
      var scoop = el('circle', { 'class': 'tss-scoop' + flavor, cx: 0, cy: -84, r: 26 }, body);
      el('path', { 'class': 'tss-sand', d: 'M-50 30 Q-36 -10 0 -13 Q36 -10 50 30 Z' }, g);
      var puddle = el('ellipse', { 'class': 'tss-scoop' + flavor, cx: 0, cy: 30, rx: 0, ry: 0 }, g);
      ices.push({ node: g, scoop: scoop, drip: drip, puddle: puddle, m: 0 });
      B.tag((name || 'Someone') + ' got an ice cream!', x, y - 70, true);
    }
    function stepIces(dt) {
      for (var i = ices.length - 1; i >= 0; i--) {
        var c = ices[i];
        c.m += dt / (40 - 28 * heatK());
        var m = Math.min(1, c.m), dl = m * 46;
        c.scoop.setAttribute('r', (26 * (1 - m * 0.85)).toFixed(1));
        c.scoop.setAttribute('cy', (-84 + m * 30).toFixed(1));
        c.drip.setAttribute('d', m < 0.05 ? '' : 'M-10 -72 Q-12 ' + (-72 + dl).toFixed(0) + ' -6 ' + (-70 + dl).toFixed(0) + ' Q-2 ' + (-72 + dl).toFixed(0) + ' -2 -72 Z M6 -72 Q6 ' + (-72 + dl * 0.6).toFixed(0) + ' 10 ' + (-70 + dl * 0.6).toFixed(0) + ' Q14 ' + (-72 + dl * 0.6).toFixed(0) + ' 12 -72 Z');
        c.puddle.setAttribute('rx', (m * 46).toFixed(1));
        c.puddle.setAttribute('ry', (m * 9).toFixed(1));
        c.node.setAttribute('opacity', (1 - clamp01((c.m - 1.1) / 0.3)).toFixed(3));
        if (c.m > 1.4) { gIces.removeChild(c.node); ices.splice(i, 1); }
      }
    }

    // ── Partikel ──
    function droplet(ctx, p, a) {
      ctx.globalAlpha = a * 0.9; ctx.fillStyle = p.c || '#8fd3ff';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
    }
    function firefly(ctx, p, a) {
      ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(p.age * p.vph * 2));
      var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16);
      g.addColorStop(0, 'rgba(255,250,170,1)'); g.addColorStop(0.3, 'rgba(220,255,120,.6)'); g.addColorStop(1, 'rgba(200,255,100,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
    }
    // Hitzeflimmern nur über dem Sand; die Weather-Kit flimmert bei Hitzewetter
    // selbst, dann tritt dieses zurück
    var shimmerT = 0, shimmerDrawn = false;
    function drawShimmer() {
      var h = S.heat / 100 * (1 - B.heat) * (1 - B.night);
      if (h < 0.12 || !B.partOn('beach')) {
        if (shimmerDrawn) { shctx.clearRect(0, 0, W, H); shimmerDrawn = false; }
        return;
      }
      shimmerDrawn = true;
      shctx.clearRect(0, 0, W, H);
      shctx.save();
      shctx.lineWidth = 2;
      var base = H - 80;
      for (var j = 0; j < 7; j++) {
        var yy = base - ((shimmerT * 30 + j * 30) % 210);
        var fade = clamp01(1 - (base - yy) / 210);
        shctx.strokeStyle = 'rgba(255,255,255,' + (h * 0.3 * fade).toFixed(3) + ')';
        shctx.beginPath();
        for (var x = 0; x <= W; x += 24) {
          // zu den Seitenrändern hin weich ausblenden
          var y = yy + Math.sin(x / 60 + shimmerT * 3 + j) * 5;
          if (x === 0) shctx.moveTo(x, y); else shctx.lineTo(x, y);
        }
        shctx.stroke();
      }
      shctx.restore();
      // Rand-Fade links und rechts
      shctx.save();
      shctx.globalCompositeOperation = 'destination-out';
      [[0, 140], [W, W - 140]].forEach(function (r) {
        var g = shctx.createLinearGradient(r[0], 0, r[1], 0);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        shctx.fillStyle = g;
        shctx.fillRect(Math.min(r[0], r[1]), 0, 140, H);
      });
      shctx.restore();
    }

    // Sonnenbrille folgt der Sonne der Weather-Kit (gleiche Rechnung wie dort)
    function placeSun() {
      var sky = opts.sky ? opts.sky() : null;
      var vis = 0, sx = 0, sy = 0;
      if (sky && typeof sky.sunX === 'number' && sky.sunUp) {
        sx = sky.sunX * W;
        sy = -10 + (300 + 10) * (sky.sunY || 0);
        vis = clamp01((sky.sun || 0) / 0.4) * clamp01((sy - 20) / 60) * clamp01(Math.min(sx, W - sx) / 120) * (1 - clamp01(sky.night || 0));
      }
      var hk = heatK();
      gSun.setAttribute('transform', 'translate(' + f1(sx) + ' ' + f1(sy) + ')');
      halo.setAttribute('r', f1(110 + 150 * hk));
      B.vars({ '--tss-sun': vis, '--tss-halo': vis * hk });
    }

    // ── Animationen zu den Befehlen ──
    function setLevel(p) {
      var lv = parseFloat(p.level);
      if (!isNaN(lv)) S.heatT = Math.max(0, Math.min(100, lv));
    }
    function burst(x, y, n) {
      for (var i = 0; i < n; i++) {
        var a = rand(0, Math.PI * 2), sp = rand(150, 700);
        if (B.front) B.front.add({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, g: 1400, term: 900, sway: 0, vr: 0, wf: 0, r: rand(3, 8), c: Math.random() < 0.3 ? '#ffffff' : '#7cc8ff', life: 1.6, draw: droplet });
      }
    }
    function splash(p) {
      var name = p.name || 'Someone';
      setLevel(p);
      var left = Math.random() < 0.5, x = left ? rand(260, 620) : rand(W - 620, W - 260), y = rand(620, 820);
      burst(x, y, 70);
      B.tag(parseFloat(p.done) > 0 ? name + ' cooled things down!' : name + ' splashed around!', x, y - 80, true);
    }
    function cool(p) {
      setLevel(p);
      if (!(parseFloat(p.done) > 0)) { B.tag('Already cool', W / 2, 300, true); return; }
      burst(300, 760, 60);
      burst(W - 300, 760, 60);
      B.tag('Cooled down!', W / 2, 300, true);
    }
    function celebrate(name) {
      B.pulse('celebrate', 3500);
      if (name) B.tag('Thank you, ' + name + '!', W / 2, 300, true);
      for (var i = 0; i < 60; i++) {
        if (B.front) B.front.add({ x: rand(0, W), y: -20, vy: rand(80, 200), term: rand(120, 220), sway: rand(10, 40), r: rand(3, 7), c: CONFETTI[i % 5], floor: sandY, draw: droplet });
      }
      if (B.reduceMotion) return;
      var b = el('g', {}, gBall), spin = el('g', {}, b);
      el('circle', { 'class': 'tss-ball-w', r: 44 }, spin);
      el('path', { 'class': 'tss-ball-r', d: 'M0 0 L0 -44 A44 44 0 0 1 38 -22 Z' }, spin);
      el('path', { 'class': 'tss-ball-b', d: 'M0 0 L38 22 A44 44 0 0 1 0 44 Z' }, spin);
      el('path', { 'class': 'tss-ball-y', d: 'M0 0 L-38 22 A44 44 0 0 1 -38 -22 Z' }, spin);
      el('circle', { 'class': 'tss-ball-w', r: 7 }, spin);
      var t0 = performance.now();
      (function step() {
        var t = (performance.now() - t0) / 1000, x = -60 + t * 520;
        var bounce = Math.abs(Math.sin(t * 3.2)) * 260 * Math.exp(-t * 0.25);
        b.setAttribute('transform', 'translate(' + x.toFixed(0) + ' ' + (sandY(Math.max(0, Math.min(W, x))) - 40 - bounce).toFixed(0) + ')');
        b.setAttribute('opacity', clamp01(Math.min(x + 40, W + 40 - x) / 140).toFixed(3));
        spin.setAttribute('transform', 'rotate(' + (t * 300).toFixed(0) + ')');
        if (x < W + 80) root.requestAnimationFrame(step); else gBall.removeChild(b);
      })();
    }

    // ── Hauptschleife ──
    var ffAcc = 0, offFor = 99;
    TS.loop(function (dt) {
      if (B.reduceMotion) S.heat = S.heatT;
      else S.heat += (S.heatT - S.heat) * Math.min(1, dt * 0.8);
      offFor = B.on ? 0 : offFor + dt;
      if (offFor > 3) return;
      var hk = heatK();
      B.vars({ '--tss-heat': hk, '--ts-night': B.night });
      placeSun();
      stepIces(dt);
      // Glühwürmchen am Abend über dem Strand
      if (B.on && B.night > 0.5) {
        ffAcc += dt * 3 * B.night;
        while (ffAcc >= 1 && B.back && B.back.count() < 60) {
          ffAcc--;
          B.back.add({ x: rand(60, W - 60), y: rand(H - 360, H - 110), vy: -rand(5, 15), term: 20, g: 0, sway: rand(20, 50), vph: rand(0.8, 2), vr: 0, wf: 0.2, life: rand(5, 9), draw: firefly });
        }
      }
      shimmerT += dt;
      drawShimmer();
      B.stepParticles(dt);
    });

    // ── Spotlight: alle 8 s eine Sandburg, jedes 4. Mal der beste Abkühler ──
    var spotRound = 0;
    setInterval(function () {
      if (!B.on) return;
      spotRound++;
      var top = S.top[0];
      if (top && spotRound % 4 === 0) { B.tag('Top cooler: ' + top[0] + ' · ' + top[1] + '×', W / 2, 300, false); return; }
      if (!B.partOn('beach')) return;
      var pool = castles.filter(function (c) { return c && c.label; });
      if (!pool.length) return;
      var c = pool[Math.floor(Math.random() * pool.length)];
      B.spot(c.inner);
      B.tag(c.label, c.x, c.y, false);
    }, 8000);

    return {
      load: function (deco) {
        if (!deco) return;
        clearCastles();
        (deco.castles || []).forEach(function (c) { addCastle(c.name || '', false); });
        cTotal = deco.castle_total || castles.filter(Boolean).length;
        palace.set(deco.project != null ? deco.project : deco.snowman);
      },
      update: function (s) {
        s = s || {};
        B.apply(s);
        var lv = s.seasonLevels || {};
        if (typeof lv.heat === 'number') {
          S.heatT = Math.max(0, Math.min(100, lv.heat));
          if (S.first) S.heat = S.heatT;   // erster Stand sofort
          S.first = false;
        }
        if (s.seasonTop && Array.isArray(s.seasonTop.summer)) S.top = s.seasonTop.summer;
      },
      command: function (cmd, p) {
        p = p || {};
        switch (cmd) {
          // Follow: Sandburg immer anlegen, sichtbar nur im aktiven Thema
          case 'follow':
          case 'castle': addCastle(p.name || '', B.on); cTotal++; break;
          case 'build': palace.build(p.name || '', B.on); break;
          case 'snowmanreset': palace.reset(B.on); break;
          case 'splash': splash(p); break;
          case 'ice': addIce(p.name || ''); break;
          case 'cool': cool(p); break;
          case 'gust': B.gust(600); break;
          case 'celebrate': celebrate(p.name || ''); break;
          case 'seasonboard': B.board('Top coolers', S.top); break;
          case 'clear':
            if (p.kind === 'castles') clearCastles();
            else if (p.kind === 'heat') { S.heatT = 0; S.top = []; }
            break;
        }
      },
      busy: function () { return null; },
      status: function () { return { on: B.on, heat: Math.round(S.heat), castles: cTotal, project: palace.n() }; }
    };
  }

  root.ThemeSummer = { create: create };
})(typeof window !== 'undefined' ? window : this);
