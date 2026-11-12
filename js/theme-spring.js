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
  var MAX_FL = 12;

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
    // vom Tornado abgerissene Blütenköpfe fliegen vor der Wiese
    var gFlyHeads = el('g', {}, gMeadow);
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
    var SLOTS = [];
    for (var si = 0; si < MAX_FL; si++) {
      var sx = 40 + ((si * 23) % 40) * 34 + rnd() * 10;
      SLOTS.push(sx < 720 ? sx : sx + 480);
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
    function putFlower(name, i, animate) {
      var x = SLOTS[i], y = groundY(x) + 8;
      // je Name fest: Sorte, Farbe, Höhe, Neigung, Kopfgröße, Blätter
      var fr = function (s) { return TS.nameRand(name, s); };
      var ci = Math.floor(fr(7) * 5);
      var h = 34 + Math.floor(fr(6) * 40), type = Math.floor(fr(1) * 6), col = 'tsp-p' + (1 + ci);
      var lean = (fr(2) < 0.5 ? -1 : 1) * (4 + 8 * fr(3)), hk = 0.55 + 0.25 * fr(4);
      var outer = el('g', { transform: 'translate(' + x.toFixed(0) + ' ' + y.toFixed(0) + ')' }, gFlowers);
      // Zwischenebene zum Biegen/Umknicken (Fuß bei 0/0)
      var bend = el('g', {}, outer);
      var grow = el('g', { 'class': 'tsp-grow' + (animate ? ' tsp-grow--new' : '') }, bend);
      if (animate) setTimeout(function () { grow.classList.remove('tsp-grow--new'); }, 2600);
      el('path', { 'class': 'tsp-stem', d: 'M0 0 Q' + lean + ' ' + (-h / 2) + ' 0 ' + (-h) }, grow);
      el('path', { 'class': 'tsp-leaf', d: 'M0 ' + (-h * 0.35) + ' Q' + (-lean * 3.2) + ' ' + (-h * 0.5) + ' ' + (-lean * 3.8) + ' ' + (-h * 0.62) + ' Q' + (-lean) + ' ' + (-h * 0.5) + ' 0 ' + (-h * 0.35) + ' Z' }, grow);
      if (fr(5) < 0.45) el('path', { 'class': 'tsp-leaf', d: 'M0 ' + (-h * 0.6) + ' Q' + (lean * 3) + ' ' + (-h * 0.72) + ' ' + (lean * 3.4) + ' ' + (-h * 0.85) + ' Q' + (lean * 0.8) + ' ' + (-h * 0.72) + ' 0 ' + (-h * 0.6) + ' Z' }, grow);
      var hp = el('g', { transform: 'translate(0 ' + (-h) + ') scale(' + hk.toFixed(2) + ')' }, grow);
      var head = el('g', { 'class': 'tsp-head' + (i % 2 ? '' : ' tsp-head--l') }, hp);
      var bloom = el('g', { 'class': 'tsp-bloom' }, head);
      if (type === 0) {          // Margerite
        for (var k = 0; k < 10; k++) el('ellipse', { 'class': col, cx: 0, cy: -13, rx: 5, ry: 12, transform: 'rotate(' + k * 36 + ')' }, bloom);
        el('circle', { 'class': 'tsp-center', r: 8 }, bloom);
      } else if (type === 1) {   // Tulpe
        el('path', { 'class': col, d: 'M-16 -4 Q-20 -30 -12 -38 L-6 -24 L0 -40 L6 -24 L12 -38 Q20 -30 16 -4 Q0 6 -16 -4 Z' }, bloom);
      } else if (type === 2) {   // Mohn
        for (var m = 0; m < 5; m++) el('circle', { 'class': col, cx: 0, cy: -12, r: 11, transform: 'rotate(' + m * 72 + ')' }, bloom);
        el('circle', { 'class': 'tsp-center--dark', r: 7 }, bloom);
      } else if (type === 3) {   // Glockenblume: drei hängende Glocken am Bogen
        el('path', { 'class': 'tsp-stem', d: 'M0 0 Q14 -8 22 6' }, bloom);
        [[0, 0], [12, 0], [22, 8]].forEach(function (b) {
          el('path', { 'class': 'tsp-bell', d: 'M' + (b[0] - 7) + ' ' + (b[1] + 14) + ' Q' + (b[0] - 7) + ' ' + b[1] + ' ' + b[0] + ' ' + b[1] +
                       ' Q' + (b[0] + 7) + ' ' + b[1] + ' ' + (b[0] + 7) + ' ' + (b[1] + 14) + ' L' + (b[0] + 4) + ' ' + (b[1] + 11) +
                       ' L' + b[0] + ' ' + (b[1] + 15) + ' L' + (b[0] - 4) + ' ' + (b[1] + 11) + ' Z' }, bloom);
        });
      } else if (type === 4) {   // kleine Sonnenblume
        for (var q = 0; q < 12; q++) el('ellipse', { 'class': 'tsp-p2', cx: 0, cy: -14, rx: 4.5, ry: 10, transform: 'rotate(' + q * 30 + ')' }, bloom);
        el('circle', { 'class': 'tsp-center--dark', r: 9 }, bloom);
      } else {                   // Gänseblümchen-Büschel: drei kleine Köpfe
        [[-12, 6, 0.6], [12, 10, 0.55], [0, 0, 0.75]].forEach(function (d) {
          var dg = el('g', { transform: 'translate(' + d[0] + ' ' + d[1] + ') scale(' + d[2] + ')' }, bloom);
          for (var k2 = 0; k2 < 12; k2++) el('ellipse', { 'class': 'tsp-daisy', cx: 0, cy: -11, rx: 3.5, ry: 9, transform: 'rotate(' + k2 * 30 + ')' }, dg);
          el('circle', { 'class': 'tsp-center', r: 6 }, dg);
        });
      }
      flowers[i] = { node: outer, head: head, bend: bend, x: x, y: y - h, h: h, hk: hk, label: name, c: PETALS[ci],
                     ang: 0, shown: 0, knock: 0, hitIn: null, holdFor: 0, rip: null, fly: null };
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
      blue: [['f', 4, 26, 1.1, 'tsp-bf-dot'], ['f', -1, 25, 1.1, 'tsp-bf-dot'], ['h', -12, 18, 1.1, 'tsp-bf-dot'], ['h', -16, 15, 1.1, 'tsp-bf-dot']]
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
        w.pat.forEach(function (q) { q.n.setAttribute('d', bfCircle(q.p[1], q.p[2], q.p[3], th, w.s)); });
      });
    }
    function wanderButterfly() {
      if (!B.on || !B.partOn('bugs') || B.night > 0.5 || B.rain > 0.2 || B.reduceMotion) return;
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
    function gust() {
      gustDir = B.gust(1000);
      for (var i = 0; i < 40 && blossoms.length; i++) { var b = blossoms[Math.floor(Math.random() * blossoms.length)]; blossomPetal(b[0], b[1]); }
      if (!B.on || B.reduceMotion || !B.partOn('meadow')) return;
      gustT = GUST;
      flowers.forEach(function (f) {
        if (f && !f.rip && Math.random() < 0.4) flowerPetal(f, gustDir * rand(250, 520), rand(-320, -120));
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
        if (gEnv > 0) want += gustDir * 30 * gEnv * (0.75 + 0.35 * Math.sin(tNow * 13 + f.x * 0.07));
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

    // ── Hauptschleife ──
    var petalAcc = 0, offFor = 99;
    TS.loop(function (dt) {
      var k = B.reduceMotion ? 1 : Math.min(1, dt * 0.8);
      S.water += (S.waterT - S.water) * k;
      S.weeds += (S.weedsT - S.weeds) * k;
      offFor = B.on ? 0 : offFor + dt;
      if (offFor > 3) return;
      if (B.on) { if (show || gustT > 0 || flBusy) stepShow(dt); } else if (show) resetShow();
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
          case 'gust': gust(); break;
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
