/* Frühlings-Thema der Weather-Source: Blumenwiese unten (Follower-Blumen
 * mit Namen), Kirschblütenzweig in der Ecke, Blütenblätter treiben mit dem
 * Wind, Schmetterlinge, Bienen auf Befehl, Sonnenblume als gemeinsames
 * Sub-Projekt (8 Teile). Garten nach dem Server-Stand
 * (seasonLevels.water/weeds): trockene Erde und hängende Köpfe unter 30 %
 * Wasser, Unkraut wächst; Regen gießt sichtbar (Köpfe richten sich auf).
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
  var MAX_FL = 40;

  function create(stage, opts) {
    var TS = root.ThemeSeasons;
    var B = TS.base(stage, opts, 'spring', PART_KEYS);
    var W = B.W, H = B.H, el = B.el, f1 = B.f1, rand = B.rand, clamp01 = B.clamp01;
    var rnd = TS.seeded(23);

    var blossomDef = el('g', { id: 'tsp-blossom' }, B.defs);
    for (var bi = 0; bi < 5; bi++) {
      el('ellipse', { 'class': 'tsp-bpetal', cx: 0, cy: -7, rx: 5, ry: 7, transform: 'rotate(' + bi * 72 + ')' }, blossomDef);
    }
    el('circle', { 'class': 'tsp-bcore', r: 2.6 }, blossomDef);

    // Ebenen: Blütenblätter (Basis), Zweig, Wiese, Insekten
    var gBranch = el('g', { 'class': 'tsp-branch tsp-dim' }, B.svg());
    var gSway = el('g', { 'class': 'tsp-sway' }, gBranch);
    // Sonnenblume hinter der Wiese (Halme verdecken den Fuß)
    var gSun = el('g', { 'class': 'tsp-sunflower tsp-dim' }, B.svg());
    var meadowSvg = B.svg();
    var gMeadow = el('g', { 'class': 'tsp-meadow tsp-dim' }, meadowSvg);
    var gWeeds = el('g', {}, gMeadow);
    var gFlowers = el('g', {}, gMeadow);
    var grass = el('path', { 'class': 'tsp-grass' }, gMeadow);
    var grassDry = el('path', { 'class': 'tsp-grass tsp-grass--dry' }, gMeadow);
    var gBlades = el('g', { 'class': 'tsp-blades' }, gMeadow);
    var gBugs = el('g', { 'class': 'tsp-bugs' }, B.svg());

    // ── Wiese ──
    function groundY(x) { return H - 22 - 6 * Math.sin(x / 110) - 4 * Math.sin(x / 37); }
    (function () {
      var d = 'M0 ' + H;
      for (var x = 0; x <= W; x += 16) d += ' L' + x + ' ' + f1(groundY(x));
      d += ' L' + W + ' ' + H + ' Z';
      grass.setAttribute('d', d);
      grassDry.setAttribute('d', d);
      for (var bx = 0; bx < W; bx += 9) {
        // in der Mitte (Lebensbalken, Munition) nur kurze Halme
        var mid = bx > 700 && bx < 1220 ? 0.4 : 1;
        var y = groundY(bx) + 6, h = (14 + rnd() * 26) * mid, lean = (rnd() - 0.5) * 16 * mid;
        el('path', { 'class': 'tsp-blade', d: 'M' + bx + ' ' + (y + 4).toFixed(0) + ' Q' + (bx + lean / 2).toFixed(0) + ' ' + (y - h / 2).toFixed(0) + ' ' + (bx + lean).toFixed(0) + ' ' + (y - h).toFixed(0) }, gBlades);
      }
    })();

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

    // ── Blumen der Follower: 40 Plätze links und rechts, die Mitte unten
    // (Spielanzeigen) bleibt frei ──
    var SLOTS = [];
    for (var si = 0; si < MAX_FL; si++) {
      var sx = 40 + ((si * 23) % 40) * 34 + rnd() * 10;
      SLOTS.push(sx < 720 ? sx : sx + 480);
    }
    var flowers = [], flNext = 0, flTotal = 0;
    function addFlower(name, animate) {
      var i = flNext % SLOTS.length, x = SLOTS[i], y = groundY(x) + 8;
      if (flowers[i]) gFlowers.removeChild(flowers[i].node);
      var h = 34 + ((i * 37) % 40), type = i % 3, col = 'tsp-p' + (1 + (i * 3) % 5), lean = i % 2 ? 8 : -8;
      var outer = el('g', { transform: 'translate(' + x.toFixed(0) + ' ' + y.toFixed(0) + ')' }, gFlowers);
      var grow = el('g', { 'class': 'tsp-grow' + (animate ? ' tsp-grow--new' : '') }, outer);
      el('path', { 'class': 'tsp-stem', d: 'M0 0 Q' + lean + ' ' + (-h / 2) + ' 0 ' + (-h) }, grow);
      el('path', { 'class': 'tsp-leaf', d: 'M0 ' + (-h * 0.35) + ' Q' + (-lean * 3.2) + ' ' + (-h * 0.5) + ' ' + (-lean * 3.8) + ' ' + (-h * 0.62) + ' Q' + (-lean) + ' ' + (-h * 0.5) + ' 0 ' + (-h * 0.35) + ' Z' }, grow);
      var hp = el('g', { transform: 'translate(0 ' + (-h) + ') scale(0.68)' }, grow);
      var head = el('g', { 'class': 'tsp-head' + (i % 2 ? '' : ' tsp-head--l') }, hp);
      var bloom = el('g', { 'class': 'tsp-bloom' }, head);
      if (type === 0) {          // Margerite
        for (var k = 0; k < 10; k++) el('ellipse', { 'class': col, cx: 0, cy: -13, rx: 5, ry: 12, transform: 'rotate(' + k * 36 + ')' }, bloom);
        el('circle', { 'class': 'tsp-center', r: 8 }, bloom);
      } else if (type === 1) {   // Tulpe
        el('path', { 'class': col, d: 'M-16 -4 Q-20 -30 -12 -38 L-6 -24 L0 -40 L6 -24 L12 -38 Q20 -30 16 -4 Q0 6 -16 -4 Z' }, bloom);
      } else {                   // Mohn
        for (var m = 0; m < 5; m++) el('circle', { 'class': col, cx: 0, cy: -12, r: 11, transform: 'rotate(' + m * 72 + ')' }, bloom);
        el('circle', { 'class': 'tsp-center--dark', r: 7 }, bloom);
      }
      flowers[i] = { node: outer, head: head, x: x, y: y - h, label: name };
      flNext++;
      if (animate && B.on && B.partOn('meadow')) setTimeout(function () { B.tag(name, x, y - h - 32, false); }, 1300);
    }
    function clearFlowers() { B.clear(gFlowers); flowers = []; flNext = 0; flTotal = 0; }

    // ── Sonnenblume: gemeinsames Sub-Projekt, wächst mit jedem Teil ──
    var SF_Y = -385;     // Mitte des Blütenkopfs
    function ring(g, n, r, rx, ry, off, cls) {
      for (var i = 0; i < n; i++) {
        el('ellipse', { 'class': cls, cx: 0, cy: f1(SF_Y - r), rx: rx, ry: ry,
                        transform: 'rotate(' + f1(off + i * 360 / n) + ' 0 ' + SF_Y + ')' }, g);
      }
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
          for (var i = 0; i < 10; i++) {
            el('path', { 'class': 'tsp-sf-sepal', d: 'M-9 ' + (SF_Y - 18) + ' L0 ' + (SF_Y - 46) + ' L9 ' + (SF_Y - 18) + ' Z',
                         transform: 'rotate(' + (i * 36) + ' 0 ' + SF_Y + ')' }, g);
          }
          el('circle', { 'class': 'tsp-sf-bud', cx: 0, cy: SF_Y, r: 28 }, g);
        },
        function (g) { ring(g, 16, 50, 11, 30, 0, 'tsp-sf-petal2'); },
        function (g) { ring(g, 16, 50, 11, 30, 11.25, 'tsp-sf-petal'); },
        function (g) {
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
          var bee = el('g', { 'class': 'tsp-sf-bee' }, el('g', { transform: 'translate(26 ' + (SF_Y - 82) + ') scale(0.8)' }, g));
          el('ellipse', { 'class': 'tsp-wing', cx: -4, cy: -14, rx: 7, ry: 11 }, bee);
          el('ellipse', { 'class': 'tsp-wing', cx: 6, cy: -14, rx: 7, ry: 11 }, bee);
          el('ellipse', { 'class': 'tsp-bee', cx: 0, cy: 0, rx: 18, ry: 12 }, bee);
          el('rect', { 'class': 'tsp-bee-stripe', x: -6, y: -11, width: 5, height: 22 }, bee);
          el('rect', { 'class': 'tsp-bee-stripe', x: 4, y: -11, width: 5, height: 22 }, bee);
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

    // ── Kirschzweig oben links ──
    var blossoms = [];
    [{ d: 'M-20 140 Q140 120 300 160 Q400 186 470 172', w: 15 }, { d: 'M140 130 Q190 80 260 64', w: 7 },
     { d: 'M290 158 Q330 220 310 280', w: 6 }, { d: 'M380 180 Q420 140 480 128', w: 5 }].forEach(function (t) {
      var p = el('path', { 'class': 'tsp-wood', d: t.d, 'stroke-width': t.w }, gSway);
      var len = p.getTotalLength();
      for (var s = len * 0.25; s < len; s += 24) {
        var pt = p.getPointAtLength(s), n = rnd() < 0.5 ? 1 : 2;
        for (var k = 0; k < n; k++) {
          var bx = pt.x + (rnd() - 0.5) * 36, by = pt.y + (rnd() - 0.5) * 28;
          el('use', { href: '#tsp-blossom', transform: 'translate(' + bx.toFixed(0) + ' ' + by.toFixed(0) + ') rotate(' + (rnd() * 72).toFixed(0) + ') scale(' + (1 + rnd() * 0.7).toFixed(2) + ')' }, gSway);
          blossoms.push([bx, by]);
        }
      }
    });

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
    function blossomPetal(x, y) {
      if (!B.back) return;
      B.back.add({ x: x, y: y, vy: rand(30, 60), term: rand(40, 70), sway: rand(20, 50), r: rand(5, 8),
                   c: Math.random() < 0.7 ? '#ffc6d9' : '#ffffff', floor: groundY, draw: petal });
    }

    // ── Bienen + Schmetterlinge ──
    function makeBee() {
      var g = el('g', {}, gBugs);
      el('ellipse', { 'class': 'tsp-wing', cx: -4, cy: -14, rx: 7, ry: 11 }, g);
      el('ellipse', { 'class': 'tsp-wing', cx: 6, cy: -14, rx: 7, ry: 11 }, g);
      el('ellipse', { 'class': 'tsp-bee', cx: 0, cy: 0, rx: 18, ry: 12 }, g);
      el('rect', { 'class': 'tsp-bee-stripe', x: -6, y: -11, width: 5, height: 22 }, g);
      el('rect', { 'class': 'tsp-bee-stripe', x: 4, y: -11, width: 5, height: 22 }, g);
      return g;
    }
    function makeBfly(cls) {
      var g = el('g', {}, gBugs);
      el('path', { 'class': 'tsp-bfly-wing ' + cls, d: 'M0 0 Q-30 -34 -26 -4 Q-30 20 0 4 Z' }, g);
      el('path', { 'class': 'tsp-bfly-wing tsp-bfly-wing--r ' + cls, d: 'M0 0 Q30 -34 26 -4 Q30 20 0 4 Z' }, g);
      el('ellipse', { 'class': 'tsp-bfly-body', cx: 0, cy: 0, rx: 3, ry: 12 }, g);
      return g;
    }
    // Flug über Wegpunkte (sanft, mit Zittern); Start und Ende jenseits der
    // Ränder, dort per Deckkraft ausgeblendet
    function fly(node, pts, dur) {
      if (B.reduceMotion) { gBugs.removeChild(node); return; }
      var t0 = performance.now();
      (function step() {
        var now = performance.now();
        var k = Math.min(1, (now - t0) / dur), n = pts.length - 1;
        var seg = Math.min(n - 1, Math.floor(k * n)), f = k * n - seg;
        var a = pts[seg], b = pts[seg + 1], e = f * f * (3 - 2 * f);
        var x = a[0] + (b[0] - a[0]) * e + Math.sin(now / 160) * 6, y = a[1] + (b[1] - a[1]) * e + Math.cos(now / 130) * 5;
        node.setAttribute('transform', 'translate(' + f1(x) + ' ' + f1(y) + ')' + (b[0] < a[0] ? ' scale(-1 1)' : ''));
        node.setAttribute('opacity', clamp01(Math.min(x + 40, W + 40 - x) / 140).toFixed(3));
        if (k < 1) root.requestAnimationFrame(step); else if (node.parentNode) gBugs.removeChild(node);
      })();
    }
    function sendBee(name) {
      var live = flowers.filter(Boolean);
      var target = live.length ? live[Math.floor(Math.random() * live.length)] : { x: rand(300, W - 300), y: H - 160, head: null };
      var fromLeft = target.x > W / 2, sx = fromLeft ? -60 : W + 60, ex = fromLeft ? W + 60 : -60, ty = target.y - 20;
      fly(makeBee(), [[sx, H - rand(260, 420)], [target.x + (fromLeft ? -200 : 200), ty - 120], [target.x, ty], [target.x, ty],
                      [target.x + (fromLeft ? 180 : -180), ty - 160], [ex, H - rand(300, 460)]], 6500);
      if (target.head) setTimeout(function () { B.spot(target.head); }, 2400);
      B.tag((name || 'Someone') + ' sent a bee!', target.x, ty - 90, true);
    }
    // Schmetterlinge nur tagsüber und ohne Regen, unten über der Wiese
    function wanderButterfly() {
      if (!B.on || !B.partOn('bugs') || B.night > 0.5 || B.rain > 0.2) return;
      var y0 = rand(H - 380, H - 220), left = Math.random() < 0.5;
      var pts = [[left ? -60 : W + 60, y0]];
      for (var i = 1; i < 6; i++) pts.push([left ? i * W / 5 : W - i * W / 5, Math.min(H - 160, y0 + rand(-80, 80))]);
      pts[pts.length - 1][0] = left ? W + 60 : -60;
      fly(makeBfly(Math.random() < 0.5 ? 'tsp-bfly-a' : 'tsp-bfly-b'), pts, 16000);
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
      var live = flowers.filter(Boolean);
      var t = live.length ? live[Math.floor(Math.random() * live.length)] : { x: rand(300, W - 300), y: H - 200 };
      if (!(parseFloat(p.done) > 0)) { B.tag(name + ': the garden is already wet', t.x, t.y - 150, true); return; }
      B.tag(name + ' watered the flowers!', t.x, t.y - 150, true);
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

    // ── Hauptschleife ──
    var petalAcc = 0, offFor = 99;
    TS.loop(function (dt) {
      var k = B.reduceMotion ? 1 : Math.min(1, dt * 0.8);
      S.water += (S.waterT - S.water) * k;
      S.weeds += (S.weedsT - S.weeds) * k;
      offFor = B.on ? 0 : offFor + dt;
      if (offFor > 3) return;
      // Regen richtet die Köpfe sofort auf, bevor der Wasserstand nachzieht
      var wilt = clamp01((30 - S.water) / 30) * (1 - B.rain);
      var dry = clamp01((55 - S.water) / 55) * (1 - 0.7 * B.rain);
      B.vars({ '--tsp-wilt': wilt, '--tsp-dry': dry, '--ts-night': B.night });
      showWeeds(S.weeds);
      if (B.on && B.partOn('branch')) {
        petalAcc += dt * (1.5 + 3 * Math.abs(B.windBase));
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
      if (!B.on) return;
      spotRound++;
      var top = S.top[0];
      if (top && spotRound % 4 === 0) { B.tag('Top gardener: ' + top[0] + ' · ' + top[1] + '×', W / 2, 300, false); return; }
      if (!B.partOn('meadow')) return;
      var pool = flowers.filter(function (f) { return f && f.label; });
      if (!pool.length) return;
      var f = pool[Math.floor(Math.random() * pool.length)];
      B.spot(f.head);
      B.tag(f.label, f.x, f.y - 50, false);
    }, 8000);

    return {
      load: function (deco) {
        if (!deco) return;
        clearFlowers();
        (deco.flowers || []).forEach(function (f) { addFlower(f.name || '', false); });
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
          case 'snowmanreset': sunflower.reset(B.on); break;
          case 'water': water(p); break;
          case 'weed': weed(p); break;
          case 'bee': sendBee(p.name || ''); break;
          case 'gust':
            B.gust(700);
            for (var i = 0; i < 40 && blossoms.length; i++) { var b = blossoms[Math.floor(Math.random() * blossoms.length)]; blossomPetal(b[0], b[1]); }
            break;
          case 'celebrate': celebrate(p.name || ''); break;
          case 'seasonboard': B.board('Top gardeners', S.top); break;
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
