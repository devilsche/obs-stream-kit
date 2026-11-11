/* Sommer-Thema der Weather-Source: Strand unten mit Follower-Sandburgen
 * (Fahne mit Namen), Sandpalast als gemeinsames Sub-Projekt (8 Teile),
 * Sonnenschirm, Muscheln, Hitzeflimmern über dem Sand,
 * Eis, das mit der Hitze schmilzt, abends dunklerer Rand und Glühwürmchen.
 * Bei Regen sacken die Sandburgen in sich zusammen (der Palast etwas),
 * ein Tsunami spült sie flach, eine Windhose reißt sie auf ihrem Weg ein
 * (Palast verliert nur Fahnen und etwas Höhe); Schnee setzt Hauben auf Burgen,
 * Palast und Schirm; danach bauen sie sich nach und nach wieder auf.
 * Sonnenschirm: ein naher Blitz kann ihn treffen (Bespannung brennt bis auf
 * Speichen und Stange ab, nach ~60 s steht ein neuer), Sturm, Gewitter,
 * Schneesturm oder eine nahe Windhose wehen ihn weg, bei Ruhe kommt er wieder.
 * Eine eigene Sonne gibt es nicht: die Sonnenbrille sitzt auf der Sonne der
 * Weather-Kit (opts.sky liefert deren Stand), ihr Hof wächst mit der Hitze.
 * Hitze rechnet der Server (seasonLevels.heat). Optik aus effects/summer.html.
 * Weihnachten am Strand (Südhalbkugel, Tropen: Server schickt xmas mit
 * theme=summer): Lichterkette, Tannenbaum im Sand mit Follower-Kugeln und
 * Geschenke aus js/theme-xmas.js, mit Aufbau und Abschied wie im Winter;
 * die Sandburgen treten so lange zur Seite (jeder Follower einmal im Bild).
 * Braucht js/season-kit.js, js/theme-seasons.js und js/theme-xmas.js.
 *
 *   var theme = ThemeSummer.create(stageEl, { tags, hud, sky: function () { return kit.state(); } });
 *   theme.load(deco);  theme.update(state);  theme.command(cmd, params);
 *   theme.playSetup(done);  theme.playFarewell(done);
 */
(function (root) {
  'use strict';

  var PART_KEYS = ['beach', 'umbrella'];
  var XMAS_KEYS = ['lights', 'tree', 'gifts'];
  // Baum am Strand: rechts neben der Bildmitte, Fuß im Sand
  var TREE_X = 1470, TREE_Y = 520, TREE_K = 0.95;
  var MAX_C = 12;
  var CONFETTI = ['#e84a5f', '#2a9df4', '#f2b705', '#2ec27e', '#ffffff'];

  function create(stage, opts) {
    opts = opts || {};
    var TS = root.ThemeSeasons;
    var B = TS.base(stage, opts, 'summer', PART_KEYS);
    var W = B.W, H = B.H, el = B.el, f1 = B.f1, rand = B.rand, clamp01 = B.clamp01;
    var rnd = TS.seeded(31);

    // Schneehaube auf einer flachen Oberkante (x0..x1 bei y), wächst über --ts-snow
    function cap(parent, x0, x1, y, h) {
      return el('path', { 'class': 'ts-cap', d: 'M' + (x0 - 3) + ' ' + (y + 1) + ' Q' + (x0 - 3) + ' ' + (y - h) + ' ' + (x0 + 6) + ' ' + (y - h) +
                          ' L' + (x1 - 6) + ' ' + (y - h) + ' Q' + (x1 + 3) + ' ' + (y - h) + ' ' + (x1 + 3) + ' ' + (y + 1) + ' Z' }, parent);
    }
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
    // Schirm: Aufpoppen (CSS) > Flug (transform) > Stange und Kuppel
    var gUPop = el('g', { 'class': 'tss-upop' }, gUmbrella);
    var gUFly = el('g', {}, gUPop);
    var sand = el('path', { 'class': 'tss-sand' }, gBeach);
    var sandHot = el('path', { 'class': 'tss-sand tss-sand--hot' }, gBeach);
    var gDeco = el('g', {}, gBeach);
    // Sandpalast hinter der Burgenreihe
    var gPalace = el('g', { 'class': 'tss-palace' }, gBeach);
    var gCastles = el('g', { 'class': 'tss-castles' }, gBeach);
    var gIces = el('g', {}, gBeach);
    // ── Weihnachten am Strand: eigene .tw-Wurzel mit den Stilen aus
    // theme-winter.css, sichtbar nur mit dem Sommer (liegt in dessen Wurzel) ──
    var xRoot = document.createElement('div');
    xRoot.className = 'tw tw--beach';
    xRoot.dataset.on = '1';
    xRoot.dataset.xmas = '0';
    B.root.appendChild(xRoot);
    var xDefs = el('svg', { 'class': 'tw-defs', width: 0, height: 0 }, xRoot);
    root.ThemeXmas.defs(xDefs, 'twb-');
    var xSvg = el('svg', { 'class': 'tw-layer', viewBox: '0 0 1920 1080' }, xRoot);
    var gXTree = el('g', { 'class': 'tw-shk' }, el('g', { 'class': 'tw-x', transform: 'translate(' + TREE_X + ' ' + TREE_Y + ') scale(' + TREE_K + ')' }, xSvg));
    var gXLights = el('g', { 'class': 'tw-shk' }, el('g', { 'class': 'tw-x tw-lights' }, xSvg));
    var xSeed = 7;
    function xrnd() { xSeed = (xSeed * 16807) % 2147483647; return xSeed / 2147483647; }
    var X = root.ThemeXmas.create({
      root: xRoot, tree: gXTree, baubles: null, lights: gXLights,
      // Schneeteile wie im Winter, eingeblendet nur bei Schnee (CSS über --ts-snow)
      x: TREE_X, y: TREE_Y, k: TREE_K, pfx: 'twb-', snow: true,
      rnd: xrnd, seed: function (n) { xSeed = n; }, bulbs: root.ThemeXmas.bulbs(xrnd),
      // Sandhügel bis unter den Bildrand, Seestern und Muschel davor
      mound: { cls: 'tw-mound', d: 'M-120 600 L-120 560 Q-70 506 10 508 Q104 494 200 500 Q296 492 390 508 Q470 506 520 560 L520 600 Z' },
      ground: function (g) {
        el('path', { 'class': 'tss-starfish', transform: 'translate(-86 534) rotate(-14)',
                     d: 'M0 -17 L5 -6 L17 -5 L8 3 L11 15 L0 9 L-11 15 L-8 3 L-17 -5 L-5 -6 Z' }, g);
        el('path', { 'class': 'tss-shell', transform: 'translate(-40 552) scale(-1 1)',
                     d: 'M-12 0 Q-14 -18 0 -20 Q14 -18 12 0 Z M-6 -2 L-3 -18 M0 -2 L0 -19 M6 -2 L3 -18' }, g);
      },
      tag: function (text, x, y) { B.tag(text, x, y, false); },
      board: function (title, rows) { B.board(title, rows); },
      onSync: function () { syncCastles(); }
    });
    // Hügel unter dem Baum macht Hitze und Schnee wie der übrige Strand mit
    (function () {
      var m = xRoot.querySelector('.tw-mound');
      ['tw-mound tss-sand--hot', 'tw-mound ts-gsnow ts-gsnow--dust', 'tw-mound ts-gsnow ts-gsnow--deep'].forEach(function (cls) {
        var c = m.cloneNode(false);
        c.setAttribute('class', cls);
        m.parentNode.insertBefore(c, m.nextSibling);
      });
    })();
    // Burgen ausblenden, sobald der Baum steht, und nach dem Abschied zurück
    function syncCastles() {
      var v = X.followersHidden() ? '1' : '0';
      if (B.root.dataset.hidecastle !== v) B.root.dataset.hidecastle = v;
    }
    var shimmerCanvas = B.canvas();
    shimmerCanvas.classList.add('tss-shimmer');
    var shctx = shimmerCanvas.getContext('2d');
    var gBall = el('g', {}, B.fxSvg);
    var gBirds = el('g', {}, B.fxSvg);

    // ── Strand: in der Mitte (Lebensbalken, x 700–1220) nur ein flacher
    // Streifen, zu den Seiten hin weich über 250 px ansteigend ──
    function sandY(x) {
      var hi = H - 70 - 10 * Math.sin(x / 140) - 6 * Math.sin(x / 47 + 1);
      var lo = H - 18 - 3 * Math.sin(x / 47 + 1);
      var d = x < 700 ? (700 - x) / 250 : x > 1220 ? (x - 1220) / 250 : 0;
      var k = d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
      return hi + (lo - hi) * k;
    }
    // Fuß der Stange, Kuppelmitte (tx/ty), Neigung der Kuppel
    var U = { px: 1500, py: 0, tx: 1470, ty: 0, rot: -7, mode: 'up', t: 0, x: 0, y: 0, a: 0, vx: 0, vy: 0, va: 0,
              dir: 1, calm: 0, hx: 0, hy: -20, op: '' };
    U.py = sandY(U.px) + 20;
    U.ty = U.py - 260;
    (function () {
      var d = 'M0 ' + H;
      for (var x = 0; x <= W; x += 16) d += ' L' + x + ' ' + f1(sandY(x));
      d += ' L' + W + ' ' + H + ' Z';
      sand.setAttribute('d', d);
      sandHot.setAttribute('d', d);
      for (var i = 0; i < 160; i++) { var dx = rnd() * W; el('circle', { 'class': 'tss-dot', cx: dx.toFixed(0), cy: (sandY(dx) + 10 + rnd() * 50).toFixed(0), r: (1 + rnd() * 2).toFixed(1) }, gDeco); }
      [[300, 1], [1700, -1], [1590, 1]].forEach(function (s) {
        var g = el('g', { transform: 'translate(' + s[0] + ' ' + (sandY(s[0]) + 28).toFixed(0) + ') scale(' + s[1] + ' 1)' }, gDeco);
        el('path', { 'class': 'tss-shell', d: 'M-12 0 Q-14 -18 0 -20 Q14 -18 12 0 Z M-6 -2 L-3 -18 M0 -2 L0 -19 M6 -2 L3 -18' }, g);
      });
      var ux = U.px, uy = U.py;
      U.pole = el('line', { 'class': 'tss-pole', x1: ux, y1: uy, x2: U.tx, y2: U.ty }, gUFly);
      var top = el('g', { transform: 'translate(' + U.tx + ' ' + U.ty + ') rotate(' + U.rot + ')' }, gUFly);
      // Kuppel mit gewelltem Saum; die weißen Bahnen laufen von der Spitze
      // zum Saum und werden auf die Kuppel beschnitten (nichts ragt heraus)
      var DOME = 'M-150 30 C-140 -46 140 -46 150 30 Q125 18 100 30 Q75 16 50 30 Q25 16 0 30 Q-25 16 -50 30 Q-75 16 -100 30 Q-125 18 -150 30 Z';
      var clip = el('clipPath', { id: 'tss-uclip' }, top);
      el('path', { d: DOME }, clip);
      // Speichen unter der Bespannung, sichtbar erst wenn sie abbrennt
      var ribs = '';
      [-150, -100, -50, 0, 50, 100, 150].forEach(function (hx) {
        ribs += 'M0 -27 Q' + f1(hx * 0.55) + ' ' + f1(-27 - 6 + Math.abs(hx) * 0.05) + ' ' + hx + ' ' + (Math.abs(hx) === 150 ? 30 : 26) + ' ';
      });
      U.ribs = el('path', { 'class': 'tss-urib tss-ufold', d: ribs }, top);
      // Bespannung mit Brandloch-Maske (schwarzer Kreis wächst vom Einschlag aus)
      var mask = el('mask', { id: 'tss-umask', maskUnits: 'userSpaceOnUse', x: -200, y: -120, width: 400, height: 220 }, top);
      el('rect', { x: -200, y: -120, width: 400, height: 220, fill: '#fff' }, mask);
      U.hole = el('circle', { cx: 0, cy: -20, r: 0, fill: '#000' }, mask);
      var fab = el('g', { mask: 'url(#tss-umask)' }, top);
      U.fab = el('g', { 'class': 'tss-ufold' }, fab);
      fab = U.fab;
      el('path', { 'class': 'tss-utop', d: DOME }, fab);
      el('path', { 'class': 'tss-ustripe', 'clip-path': 'url(#tss-uclip)',
                   d: 'M0 -27 Q-62 -14 -100 40 L-50 40 Q-24 -2 0 -27 Z M0 -27 Q24 -2 50 40 L100 40 Q62 -14 0 -27 Z' }, fab);
      U.char = el('path', { 'class': 'tss-uchar', d: DOME, opacity: 0 }, fab);
      el('path', { 'class': 'ts-cap', d: 'M-122 -6 C-104 -42 104 -42 122 -6 C80 -24 -80 -24 -122 -6 Z' }, fab);
      // glühende Brandkante, auf die Kuppel beschnitten
      var edge = el('g', { 'clip-path': 'url(#tss-uclip)' }, top);
      U.edge = el('circle', { 'class': 'tss-uedge', cx: 0, cy: -20, r: 0 }, edge);
      U.edgeGlow = el('circle', { 'class': 'tss-uedge-glow', cx: 0, cy: -20, r: 0 }, edge);
      el('circle', { 'class': 'tss-utip', cx: 0, cy: -29, r: 5 }, top);
    })();

    // ── Sandburgen der Follower: 12 Plätze, abwechselnd links/rechts von der
    // Ecke nach innen; die Mitte unten (Spielanzeigen) bleibt frei ──
    var CASTLE_X = [];
    for (var ci = 0; ci < MAX_C; ci++) {
      var cx0 = 70 + Math.floor(ci / 2) * 56;
      CASTLE_X.push(ci % 2 ? W - cx0 : cx0);
    }
    // Schnee am Boden: Puder unter Palast und Burgen, die dicke Decke mit
    // Verwehungen liegt davor und deckt ihren Fuß zu
    var sandSnow = B.groundSnow(gBeach, gPalace, sandY,
      CASTLE_X.map(function (x) { return [x, 50, 4]; }).concat([[270, 160, 12]]));
    gBeach.insertBefore(sandSnow.deep, gCastles.nextSibling);
    // unter dem offenen Schirm bleibt der Sand fast frei: weiche Aussparung
    // in beiden Schneeschichten (Maske), verschwindet, wenn der Schirm fehlt
    (function () {
      var g = el('radialGradient', { id: 'tss-uspotG' }, B.defs);
      [[0, 0.85], [0.6, 0.7], [1, 0]].forEach(function (s) {
        el('stop', { offset: s[0], 'stop-color': '#000', 'stop-opacity': s[1] }, g);
      });
      var m = el('mask', { id: 'tss-snowspot', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H }, B.defs);
      el('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff' }, m);
      U.spot = el('ellipse', { 'class': 'tss-uspot', cx: 1470, cy: f1(sandY(1470) + 8), rx: 165, ry: 70, fill: 'url(#tss-uspotG)' }, m);
      sandSnow.dust.setAttribute('mask', 'url(#tss-snowspot)');
      sandSnow.deep.setAttribute('mask', 'url(#tss-snowspot)');
    })();
    var castles = [], cNext = 0, cTotal = 0, cGen = 0;
    // Burg-Varianten je Platz fest gestreut: Bauform, Sandton, Spiegelung,
    // Muschel, Größe. build(g) zeichnet (Fuß bei 0/0) und liefert die
    // Fahnenstange [x, Fuß, Spitze] und die Höhe für Schild und Spotlight
    function cRand(i, s) { var v = Math.sin(i * 91.7 + s * 47.3) * 43758.5453; return v - Math.floor(v); }
    function wall(x0, x1, y0, y1) { return 'M' + x0 + ' ' + y0 + ' L' + x0 + ' ' + y1 + ' L' + x1 + ' ' + y1 + ' L' + x1 + ' ' + y0 + ' Z'; }
    function tower(x0, x1, top, mw) {
      // Turm mit Zinnen auf der Oberkante
      var d = 'M' + x0 + ' 0 L' + x0 + ' ' + top, n = Math.max(2, Math.round((x1 - x0) / (mw * 2))), st = (x1 - x0) / (2 * n - 1);
      for (var j = 0; j < 2 * n - 1; j++) {
        var xa = x0 + j * st, xb = xa + st;
        d += j % 2 ? ' L' + f1(xa) + ' ' + top + ' L' + f1(xb) + ' ' + top : ' L' + f1(xa) + ' ' + (top - mw) + ' L' + f1(xb) + ' ' + (top - mw) + ' L' + f1(xb) + ' ' + top;
      }
      return d + ' L' + x1 + ' 0 Z';
    }
    var CASTLE_BUILD = [
      function (g) {   // zwei Türme und Bergfried (Klassiker)
        el('path', { 'class': 'tss-castle', d: wall(-50, 50, 0, -40) }, g);
        el('path', { 'class': 'tss-castle', d: tower(-58, -24, -64, 8) }, g);
        el('path', { 'class': 'tss-castle', d: tower(24, 58, -64, 8) }, g);
        el('path', { 'class': 'tss-castle', d: tower(-16, 16, -84, 8).replace('M-16 0', 'M-16 -40').replace(/L16 0 Z$/, 'L16 -40 Z') }, g);
        el('path', { 'class': 'tss-door', d: 'M-10 0 L-10 -20 Q0 -32 10 -20 L10 0 Z' }, g);
        cap(g, -58, -24, -72, 10); cap(g, 24, 58, -72, 10); cap(g, -16, 16, -92, 10);
        return { pole: [0, -92, -140], top: 150 };
      },
      function (g) {   // Eimerburg: zwei gestapelte Eimerformen
        el('path', { 'class': 'tss-castle', d: 'M-38 0 L-32 -60 L32 -60 L38 0 Z' }, g);
        el('path', { 'class': 'tss-castle', d: tower(-30, 30, -60, 7).replace('M-30 0', 'M-30 -58').replace(/L30 0 Z$/, 'L30 -58 Z') }, g);
        el('path', { 'class': 'tss-castle', d: 'M-22 -66 L-18 -100 L18 -100 L22 -66 Z' }, g);
        el('path', { 'class': 'tss-castle', d: tower(-18, 18, -100, 6).replace('M-18 0', 'M-18 -98').replace(/L18 0 Z$/, 'L18 -98 Z') }, g);
        el('path', { 'class': 'tss-castle-ring', d: 'M-35 -22 L35 -22 M-33 -40 L33 -40 M-20 -84 L20 -84' }, g);
        el('path', { 'class': 'tss-door', d: 'M-8 0 L-8 -16 Q0 -26 8 -16 L8 0 Z' }, g);
        cap(g, -30, 30, -67, 8); cap(g, -18, 18, -106, 8);
        return { pole: [0, -106, -150], top: 158 };
      },
      function (g) {   // breite Mauer mit drei kleinen Türmen
        el('path', { 'class': 'tss-castle', d: tower(-64, 64, -32, 7) }, g);
        el('path', { 'class': 'tss-castle', d: tower(-70, -50, -56, 6) }, g);
        el('path', { 'class': 'tss-castle', d: tower(50, 70, -56, 6) }, g);
        el('path', { 'class': 'tss-castle', d: tower(-12, 12, -64, 6) }, g);
        el('path', { 'class': 'tss-door', d: 'M-9 0 L-9 -18 Q0 -28 9 -18 L9 0 Z' }, g);
        el('rect', { 'class': 'tss-door', x: -42, y: -24, width: 7, height: 9, rx: 3 }, g);
        el('rect', { 'class': 'tss-door', x: 35, y: -24, width: 7, height: 9, rx: 3 }, g);
        cap(g, -64, 64, -39, 6); cap(g, -70, -50, -62, 7); cap(g, 50, 70, -62, 7); cap(g, -12, 12, -70, 7);
        return { pole: [0, -70, -112], top: 120 };
      },
      function (g) {   // Doppelturm mit spitzen Dächern und Torbogen
        el('path', { 'class': 'tss-castle', d: wall(-16, 16, 0, -46) }, g);
        el('path', { 'class': 'tss-castle', d: wall(-44, -16, 0, -80) }, g);
        el('path', { 'class': 'tss-castle', d: wall(16, 44, 0, -80) }, g);
        el('path', { 'class': 'tss-castle-roof', d: 'M-48 -80 L-30 -112 L-12 -80 Z M12 -80 L30 -112 L48 -80 Z' }, g);
        el('path', { 'class': 'tss-door', d: 'M-12 0 L-12 -22 Q0 -38 12 -22 L12 0 Z' }, g);
        el('rect', { 'class': 'tss-door', x: -33, y: -62, width: 6, height: 10, rx: 3 }, g);
        el('rect', { 'class': 'tss-door', x: 27, y: -62, width: 6, height: 10, rx: 3 }, g);
        cap(g, -16, 16, -46, 6);
        return { pole: [-30, -112, -146], top: 152 };
      }
    ];
    // Sind alle Plätze belegt, macht die älteste Platz: sie rollt zur Kante
    // hinaus, ab und zu holt sie eine Möwe; die Neue entsteht danach
    function addCastle(name, animate) {
      var i = cNext % CASTLE_X.length, old = castles[i];
      cNext++;
      if (old && animate) {
        castles[i] = null;
        var gen = cGen;
        var wait = TS.leave(old.node, { x: old.x, top: old.y, r: 30, crow: Math.random() < 0.25, bird: 'gull' });
        setTimeout(function () { if (gen === cGen && !castles[i]) putCastle(name, i, true); }, wait);
        return;
      }
      if (old) gCastles.removeChild(old.node);
      putCastle(name, i, animate);
    }
    function putCastle(name, i, animate) {
      var x = CASTLE_X[i], y = sandY(x) + 26;
      var k = 0.5 + 0.26 * cRand(i, 1), form = Math.floor(cRand(i, 2) * CASTLE_BUILD.length);
      var mirror = cRand(i, 3) < 0.4, tone = 1 + Math.floor(cRand(i, 4) * 3);
      var outer = el('g', { transform: 'translate(' + x + ' ' + y.toFixed(0) + ') scale(' + k.toFixed(2) + ')' }, gCastles);
      // Zwischenebene fürs Zusammensacken (Fuß bei 0/0), darin die Burg mit ihren CSS-Animationen
      var slump = el('g', {}, outer);
      var g = el('g', { 'class': 'tss-castle-g tss-tone' + tone + (animate ? ' tss-castle-g--new' : '') }, slump);
      var body = el('g', mirror ? { transform: 'scale(-1 1)' } : {}, g);
      var info = CASTLE_BUILD[form](body);
      var px = mirror ? -info.pole[0] : info.pole[0];
      el('line', { 'class': 'tss-flagpole', x1: px, y1: info.pole[1], x2: px, y2: info.pole[2] }, g);
      var flagG = el('g', {}, g);
      el('path', { 'class': 'tss-flag tss-f' + (1 + i % 5), d: 'M' + (px + 1) + ' ' + info.pole[2] + ' l35 8 l-35 10 Z' }, flagG);
      // manche haben eine Muschel am Fuß
      if (cRand(i, 5) < 0.35) {
        var sx = (cRand(i, 6) < 0.5 ? -1 : 1) * (52 + 14 * cRand(i, 7));
        el('path', { 'class': 'tss-shell', transform: 'translate(' + f1(sx) + ' -2) scale(0.7)',
                     d: 'M-12 0 Q-14 -18 0 -20 Q14 -18 12 0 Z M-6 -2 L-3 -18 M0 -2 L0 -19 M6 -2 L3 -18' }, g);
      }
      // weggesackter Sand vor dem Fuß
      var mound = el('path', { 'class': 'tss-mound', d: 'M-74 6 Q-46 -24 0 -27 Q46 -24 74 6 Z', opacity: 0 }, outer);
      castles[i] = { node: outer, inner: g, slump: slump, flagG: flagG, mound: mound, x: x, y: y - info.top * k, label: name,
                     fx: px, fy: info.pole[2], s: 0, shown: -1, wait: null, washed: false };
      if (animate && B.on && B.partOn('beach')) B.tag(name, x, y - (info.top + 10) * k, false);
    }
    function clearCastles() { B.clear(gCastles); castles = []; cNext = 0; cTotal = 0; cGen++; }

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
          cap(g, -140, 140, -150, 14);
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
            cap(g, cx - 32, cx + 32, -230, 14);
          });
        },
        function (g) {
          el('rect', { 'class': 'tss-castle', x: -56, y: -310, width: 112, height: 162 }, g);
          el('path', { 'class': 'tss-door', d: 'M-12 -238 L-12 -266 Q0 -282 12 -266 L12 -238 Z' }, g);
          el('circle', { 'class': 'tss-shell-dot', cx: -30, cy: -200, r: 6 }, g);
          el('circle', { 'class': 'tss-shell-dot', cx: 30, cy: -200, r: 6 }, g);
          cap(g, -56, 56, -310, 14);
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
    // Schnee auf heißem Sand dampft, bis der Strand abgekühlt ist
    var steamAcc = 0;
    function stepSteam(dt) {
      var sky = opts.sky ? opts.sky() : null, sn = sky ? sky.snow || 0 : 0;
      var hot = S.heat / 100;
      if (!B.on || B.reduceMotion || sn < 0.1 || hot < 0.25 || !B.partOn('beach')) { steamAcc = 0; return; }
      steamAcc += dt * 24 * hot * Math.min(1, sn * 1.5);
      while (steamAcc >= 1) {
        steamAcc--;
        var x = Math.random() < 0.5 ? rand(40, 690) : rand(1230, W - 40);
        B.smoke(x, sandY(x) + 4, { steam: true, o: 0.4 + 0.3 * hot, up: rand(35, 70), r: rand(12, 20), gr: rand(30, 45), life: rand(2.2, 3.4) });
      }
    }
    // liegt Schnee, glüht der Sand nicht mehr (der Server kühlt die Hitze nach)
    function snowCool() { return 1 - clamp01(B.snow * 3); }
    function heatK() { return Math.max(S.heat / 100, B.heat) * snowCool(); }

    // ── Eis: Waffel steckt mit der Spitze im Sand (gut ein Drittel), Kugel
    // oben, 10–25° schräg; schmilzt in 40 s (kühl) bis 12 s (volle Hitze),
    // nur Show; links oder rechts, die Mitte bleibt frei ──
    var ices = [];
    // Eis und Pommes überall am Strand, auch in der Mitte (sie sind nur kurz da);
    // sie stehen vorn im Sand, vor dem Fuß der Sandburgen, aber nicht unter der Bildkante
    function sideX() { return rand(120, W - 120); }
    function frontY(x, d) { return Math.min(sandY(x) + d, H - 10); }
    function addIce(name) {
      var x = sideX(), y = frontY(x, 30);
      var flavor = 1 + Math.floor(Math.random() * 4), tilt = (Math.random() < 0.5 ? -1 : 1) * rand(10, 25);
      var g = el('g', { transform: 'translate(' + x.toFixed(0) + ' ' + y.toFixed(0) + ') scale(0.6)' }, gIces);
      // Spitze 24 unter der Sandlinie, um sie herum gekippt
      var body = el('g', { transform: 'rotate(' + tilt.toFixed(0) + ') translate(0 24)' }, g);
      el('path', { 'class': 'tss-cone', d: 'M-20 -70 L20 -70 L0 0 Z' }, body);
      el('path', { 'class': 'tss-cone-grid', d: 'M-14 -62 L8 -24 M-6 -70 L13 -40 M14 -62 L-8 -24 M6 -70 L-13 -40' }, body);
      var drip = el('path', { 'class': 'tss-scoop' + flavor }, body);
      var scoop = el('circle', { 'class': 'tss-scoop' + flavor, cx: 0, cy: -84, r: 26 }, body);
      el('path', { 'class': 'tss-sand', d: 'M-44 30 Q-32 -4 0 -6 Q32 -4 44 30 Z' }, g);
      // Pfütze auf der Seite, zu der das Eis kippt
      var puddle = el('ellipse', { 'class': 'tss-scoop' + flavor, cx: f1(tilt * 1.6), cy: 6, rx: 0, ry: 0 }, g);
      var ice = { node: g, scoop: scoop, drip: drip, puddle: puddle, m: 0, x: x, y: y, tilt: tilt, flavor: flavor, name: name || 'Someone',
                  stolen: false, fade: 0 };
      ices.push(ice);
      B.tag((name || 'Someone') + ' got an ice cream!', x, y - 70, true);
      // Möwen-Gag: etwa jedes 3. Eis wird nach ein paar Sekunden geklaut
      if (!B.reduceMotion && Math.random() < 1 / 3) {
        setTimeout(function () {
          if (!B.on || ices.indexOf(ice) < 0 || ice.m > 0.6) return;
          gull(x, y - 6, function () {
            if (ices.indexOf(ice) < 0) return null;
            ice.stolen = true;
            B.tag('A seagull stole ' + ice.name + "'s ice cream!", x, y - 90, true);
            return { scoop: ice.flavor, r: Math.max(8, 26 * (1 - Math.min(1, ice.m) * 0.85)) };
          }, null, function () {
            // Kugelmitte im Bild (Waffel gekippt, Kugel sackt beim Schmelzen)
            var a = ice.tilt * Math.PI / 180, m = Math.min(1, ice.m), d = (60 - m * 30) * 0.6;
            return [x + d * Math.sin(a), y - d * Math.cos(a), 26 * (1 - m * 0.85) * 0.6];
          });
        }, rand(3000, 6000));
      }
    }
    function stepIces(dt) {
      for (var i = ices.length - 1; i >= 0; i--) {
        var c = ices[i];
        if (c.stolen) {
          // leere Waffel bleibt kurz stecken und verblasst
          c.fade += dt;
          if (c.scoop.getAttribute('r') !== '0') { c.scoop.setAttribute('r', '0'); c.drip.setAttribute('d', ''); }
          c.node.setAttribute('opacity', (1 - clamp01((c.fade - 4) / 2)).toFixed(3));
          if (c.fade > 6) { gIces.removeChild(c.node); ices.splice(i, 1); }
          continue;
        }
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

    // ── Pommes (!fries): rot-weiße Papierschale im Sand; nach 15–40 s holt
    // die Möwe sie in 2–4 Flügen (oder einem großen Griff), dann verblasst die Schale ──
    var fries = [];
    function addFries(name) {
      var x = sideX(), y = frontY(x, 34);
      var g = el('g', { 'class': 'tss-fries', transform: 'translate(' + x.toFixed(0) + ' ' + y.toFixed(0) + ') scale(0.7)' }, gIces);
      var sticks = [];
      for (var i = 0; i < 12; i++) {
        var fx = -30 + i * 5.4 + rand(-2, 2), fh = rand(34, 52), rot = rand(-14, 14);
        sticks.push(el('rect', { 'class': 'tss-fry', x: f1(fx - 3.5), y: f1(-30 - fh), width: 7, height: f1(fh), rx: 1.5,
                                 transform: 'rotate(' + f1(rot) + ' ' + f1(fx) + ' -30)' }, g));
      }
      el('path', { 'class': 'tss-tray', d: 'M-40 -40 L40 -40 L30 0 L-30 0 Z' }, g);
      el('path', { 'class': 'tss-tray-stripe', d: 'M-26 -40 L-18 -40 L-16 0 L-22 0 Z M-4 -40 L4 -40 L3 0 L-3 0 Z M18 -40 L26 -40 L22 0 L16 0 Z' }, g);
      el('path', { 'class': 'tss-sand', d: 'M-50 16 Q-38 -4 0 -5 Q38 -4 50 16 Z' }, g);
      var fr = { node: g, sticks: sticks, x: x, y: y, left: sticks.length, fade: -1 };
      fries.push(fr);
      B.tag((name || 'Someone') + ' got fries!', x, y - 90, true);
      setTimeout(function () { friesRaid(fr); }, rand(15000, 40000));
    }
    function friesRaid(fr) {
      if (fries.indexOf(fr) < 0) return;
      if (!B.on || B.reduceMotion) { fr.fade = 0; return; }
      var trips = Math.random() < 0.25 ? 1 : 2 + Math.floor(Math.random() * 3);
      (function trip() {
        if (fries.indexOf(fr) < 0) return;
        if (!B.on) { fr.fade = 0; return; }
        gull(fr.x, fr.y - 4, function () {
          var n = Math.ceil(fr.left / trips);
          trips--;
          for (var k = 0; k < n && fr.left > 0; k++) { fr.left--; fr.sticks[fr.left].setAttribute('opacity', '0'); }
          return { fries: n };
        }, function () {
          if (fr.left > 0 && trips > 0) setTimeout(trip, rand(1500, 4000));
          else fr.fade = 0;
        }, function (dir) { return [fr.x - dir * 16, fr.y - 32, 2]; });
      })();
    }
    function stepFries(dt) {
      for (var i = fries.length - 1; i >= 0; i--) {
        var f = fries[i];
        if (f.fade < 0) continue;
        f.fade += dt;
        f.node.setAttribute('opacity', (1 - clamp01(f.fade / 1.5)).toFixed(3));
        if (f.fade >= 1.5) { gIces.removeChild(f.node); fries.splice(i, 1); }
      }
    }

    // ── Möwe: gleitet von der Seite heran, landet neben dem Ziel, pickt,
    // schnappt sich die Beute (grab liefert, was sie trägt) und fliegt davon.
    // Gliederpuppe in Körpereinheiten (GK px je Einheit), Blick nach +x:
    // Rumpf und Kopf als Profil, die Flügel als 3D-Gelenkkette (Schulter >
    // Handgelenk > Spitze), schräg projiziert, damit Schlag und M-Form lesbar
    // sind. Schlag: schneller Abschlag (40 %), langsamer Aufschlag mit
    // angewinkelter Hand, die Spitze hinkt nach; der Rumpf wippt gegenläufig ──
    var GK = 1.2, STAND = 15, DEG = Math.PI / 180;
    var CAM_Y = 0.45, CAM_P = -0.4;   // Kamera: Gier und Neigung (rad)
    var gulls = [], gullN = 0;
    function mix(a, b, k) { return a + (b - a) * k; }
    function ease(k) { k = clamp01(k); return k * k * (3 - 2 * k); }
    // Schlagstellung: +1 oben, −1 unten; Abschlag 40 % der Periode
    function wbeat(p) {
      p -= Math.floor(p);
      return p < 0.4 ? Math.cos(Math.PI * p / 0.4) : -Math.cos(Math.PI * (p - 0.4) / 0.6);
    }
    // Handgelenk beim Aufschlag angewinkelt, beim Abschlag gestreckt
    function wfold(p) { p -= Math.floor(p); return p < 0.4 ? 0 : Math.sin(Math.PI * (p - 0.4) / 0.6); }
    function wingPose(b, t) {
      var p = b.fp, A = b.amp, fo = wfold(p) * Math.min(1, A), sw = Math.sin(t * 1.9);
      var gl = { a1: 20 + 2.5 * sw, a2: -14 + 3 * Math.sin(t * 1.9 - 0.7), b1: -14, b2: 28, ext: 1 };
      var fl = { a1: 8 + 40 * A * wbeat(p), a2: -2 + 56 * A * wbeat(p - 0.09), b1: -6 + 10 * fo, b2: 20 + 40 * fo, ext: 1 - 0.22 * fo };
      // Abfangen: Flügel weit vorn, gewölbt, kurze Bremsschläge
      var fr = { a1: 26 + 26 * wbeat(p), a2: 6 + 36 * wbeat(p - 0.08), b1: -24 + 10 * fo, b2: 4 + 26 * fo, ext: 1 - 0.1 * fo };
      var o = {};
      ['a1', 'a2', 'b1', 'b2', 'ext'].forEach(function (k) { o[k] = mix(mix(gl[k], fl[k], b.flapW), fr[k], b.flareW); });
      // Anlegen: Spannweite schrumpft, Hand klappt nach hinten
      o.ext *= 1 - 0.85 * b.F;
      o.b1 = mix(o.b1, 40, b.F); o.b2 = mix(o.b2, 120, b.F); o.a1 = mix(o.a1, 10, b.F); o.a2 = mix(o.a2, 0, b.F);
      return o;
    }
    // Körperraum (x vor, y oben, z zum Betrachter) > Bildebene der Puppe
    function gproj(v, roll) {
      var cr = Math.cos(roll), sr = Math.sin(roll);
      var y = v[1] * cr - v[2] * sr, z = v[1] * sr + v[2] * cr;
      var X = v[0] * Math.cos(CAM_Y) - z * Math.sin(CAM_Y), D = v[0] * Math.sin(CAM_Y) + z * Math.cos(CAM_Y);
      return [X, -(y * Math.cos(CAM_P) + D * Math.sin(CAM_P))];
    }
    function wdir(a, b, s) {
      a *= DEG; b *= DEG;
      return [-Math.sin(b), Math.sin(a) * Math.cos(b), s * Math.cos(a) * Math.cos(b)];
    }
    function drawWing(w, P, s, roll) {
      var S = [2, 2.2, s * 2], d1 = wdir(P.a1, P.b1, s), d2 = wdir(P.a2, P.b2, s);
      var Wr = [S[0] + d1[0] * 15 * P.ext, S[1] + d1[1] * 15 * P.ext, S[2] + d1[2] * 15 * P.ext];
      var T = [Wr[0] + d2[0] * 21 * P.ext, Wr[1] + d2[1] * 21 * P.ext, Wr[2] + d2[2] * 21 * P.ext];
      function lead(u) { return [Wr[0] + (T[0] - Wr[0]) * u, Wr[1] + (T[1] - Wr[1]) * u, Wr[2] + (T[2] - Wr[2]) * u]; }
      function trail(u) { var q = lead(u); q[0] -= 10.5 * Math.pow(1 - u, 0.6) * P.ext + 0.6 * (1 - u); return q; }
      function pt(v) { var q = gproj(v, roll); return f1(q[0]) + ' ' + f1(q[1]); }
      var sp = gproj(S, roll), wp = gproj(Wr, roll), st = gproj([S[0] - 12 * P.ext, S[1], S[2]], roll);
      var d = 'M' + pt(S) + ' L' + pt(Wr) + ' Q' + pt(lead(0.5).map(function (c, i) { return c + (i === 1 ? 0.6 : 0); })) + ' ' + pt(T) +
              ' Q' + pt(trail(0.7)) + ' ' + pt(trail(0.35)) + ' L' + pt(trail(0)) +
              ' Q' + pt([(S[0] + Wr[0]) / 2 - 11.5, (S[1] + Wr[1]) / 2, (S[2] + Wr[2]) / 2]) + ' ' + pt([S[0] - 12 * P.ext, S[1], S[2]]) + ' Z';
      w.main.setAttribute('d', d);
      w.edge.setAttribute('d', d.slice(0, -2));
      w.tip.setAttribute('d', 'M' + pt(lead(0.6)) + ' L' + pt(T) + ' Q' + pt(trail(0.82)) + ' ' + pt(trail(0.6)) + ' Z');
      var m = gproj(lead(0.9), roll), m2 = gproj(trail(0.9), roll);
      w.mirror.setAttribute('cx', f1((m[0] * 2 + m2[0]) / 3)); w.mirror.setAttribute('cy', f1((m[1] * 2 + m2[1]) / 3));
      // Unterseite sichtbar, wenn die Armfläche im Bild umklappt
      var cross = (wp[0] - sp[0]) * (st[1] - sp[1]) - (wp[1] - sp[1]) * (st[0] - sp[0]);
      var under = cross * s > 0 ? '1' : '0';
      if (w.g.dataset.under !== under) w.g.dataset.under = under;
    }
    function newWing(parent, far) {
      var g = el('g', { 'class': 'tss-gull-wing' + (far ? ' tss-gull-wing--far' : '') }, parent);
      var main = el('path', { 'class': 'tss-gull-wfill' }, g);
      return { g: g, main: main, edge: el('path', { 'class': 'tss-gull-wedge' }, g), tip: el('path', { 'class': 'tss-gull-tip' }, g),
               mirror: el('circle', { 'class': 'tss-gull-mirror', r: 0.8 }, g) };
    }
    // Bein als Zweigelenk: Hüfte > Ferse (knickt nach hinten) > Fuß
    function legPath(h, f, toe) {
      var l1 = 5.5, l2 = 8.5, dx = f[0] - h[0], dy = f[1] - h[1], d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      var dd = Math.min(d, l1 + l2 - 0.05), ux = dx / d, uy = dy / d;
      var a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      var px = h[0] + ux * a, py = h[1] + uy * a, k1x = px - uy * hh, k2x = px + uy * hh;
      var kx = k1x < k2x ? k1x : k2x, ky = k1x < k2x ? py + ux * hh : py - ux * hh;
      var fx = h[0] + ux * dd, fy = h[1] + uy * dd;
      return { leg: 'M' + f1(h[0]) + ' ' + f1(h[1]) + ' L' + f1(kx) + ' ' + f1(ky) + ' L' + f1(fx) + ' ' + f1(fy),
               foot: 'M' + f1(fx - 0.8) + ' ' + f1(fy - 0.6) + ' L' + f1(fx + toe[0] * 3.6) + ' ' + f1(fy + toe[1] * 3.6 - 0.2) +
                     ' L' + f1(fx + toe[0] * 3.2 + 0.6) + ' ' + f1(fy + toe[1] * 3.2 + 1) + ' Z' };
    }

    function gull(tx, ty, grab, done, reach) {
      // reach(dir): Zielpunkt [x, y, r] für die Schnabelspitze (Kugel, Pommes)
      var fromLeft = tx < W / 2, dir = fromLeft ? 1 : -1;
      var rc = reach ? reach(dir) : [tx, ty - 30, 8];
      // Rumpfmitte so, dass die Schnabelspitze nach dem Landehüpfer (7 px) knapp vor dem Ziel ist
      var lx = rc[0] - dir * (rc[2] + 3 + 22 * GK + 7), gy = sandY(lx) + 3, ly = gy - STAND * GK;
      var g = el('g', { 'class': 'tss-gull', opacity: 0 }, gBirds);
      var flip = el('g', {}, g);
      var legs = el('g', { 'class': 'tss-gull-legs' }, flip);
      var legF = el('path', { 'class': 'tss-gull-leg tss-gull-leg--far' }, legs), footF = el('path', { 'class': 'tss-gull-foot tss-gull-leg--far' }, legs);
      var legN = el('path', { 'class': 'tss-gull-leg' }, legs), footN = el('path', { 'class': 'tss-gull-foot' }, legs);
      var pose = el('g', {}, flip);
      var wFar = newWing(pose, true);
      // Weiße Teile einmal als graue Kontur (use) dahinter, dann weiß darüber
      var id = 'tss-gullw' + (++gullN);
      el('use', { 'class': 'tss-gull-ol', href: '#' + id }, pose);
      var white = el('g', { 'class': 'tss-gull-white' }, pose);
      var wIn = el('g', { id: id }, white);
      el('path', { d: 'M-13.5 -2 L-20.5 -2.6 Q-21.8 -0.6 -20.5 1.4 L-13.5 1 Z' }, wIn);
      el('path', { d: 'M10 -0.8 C10 -4.4 4.5 -5.2 -2 -4.8 C-8 -4.4 -12.5 -3 -15 -1.8 L-15 1 C-11.5 2.6 -6 4.6 0 4.6 C6 4.6 10 2.6 10 -0.8 Z' }, wIn);
      var neck = el('path', {}, wIn);
      var head = el('g', {}, wIn);
      el('circle', { r: 4.5 }, head);
      // angelegter Flügel: grauer Mantel, schwarze Handschwingen über dem Schwanz
      var folded = el('g', { 'class': 'tss-gull-folded', opacity: 0 }, pose);
      el('path', { 'class': 'tss-gull-mantle', d: 'M8 -3.6 C2 -7 -8 -6.4 -13.5 -3.6 L-15 -0.8 C-8 1.4 0 1 6.5 -1 Z' }, folded);
      el('path', { 'class': 'tss-gull-tip', d: 'M-11 -3.9 L-25 -2.4 Q-25.2 -1.4 -24 -1.1 L-12.5 -0.4 Z' }, folded);
      el('circle', { 'class': 'tss-gull-mirror', cx: -22.6, cy: -1.9, r: 0.6 }, folded);
      el('path', { 'class': 'tss-gull-tertial', d: 'M5 -1.4 C-2 0.4 -8 0.6 -12.5 -0.6' }, folded);
      var wNear = newWing(pose, false);
      var headTop = el('g', {}, pose);
      el('path', { 'class': 'tss-gull-bill', d: 'M3.4 -1.7 L9.4 -1 Q10.9 -0.6 10.4 0.9 L9.6 0.5 L3.6 1.1 Z' }, headTop);
      el('circle', { 'class': 'tss-gull-gonys', cx: 8.9, cy: 0.75, r: 0.6 }, headTop);
      el('circle', { 'class': 'tss-gull-eye', cx: 1.3, cy: -1.5, r: 0.8 }, headTop);
      var carry = el('g', {}, headTop);
      // Anflug: Bézier von außerhalb des Bilds bis zum Abfangpunkt vor der Landestelle
      var x0 = fromLeft ? -170 : W + 170, y0 = rand(140, 300);
      var x3 = lx - dir * 38, y3 = ly - 34, dx = Math.abs(x3 - x0), dy = y3 - y0;
      var gl = { g: g, flip: flip, pose: pose, head: head, headTop: headTop, neck: neck, folded: folded, carry: carry,
                 wFar: wFar, wNear: wNear, legs: legs, legN: legN, legF: legF, footN: footN, footF: footF,
                 dir: dir, face: dir, phase: 'in', t: 0, age: 0, grab: grab, done: done, reach: reach,
                 bz: [x0, y0, x0 + dir * dx * 0.45, y0 + dy * 0.12, x3 - dir * dx * 0.45, y3 - dy * 0.14, x3, y3],
                 tin: Math.max(2.1, Math.min(3.4, Math.sqrt(dx * dx + dy * dy) / 330)),
                 lx: lx, ly: ly, gy: gy, x: x0, y: y0, px: x0, py: y0, vx: 0, vy: 0,
                 fp: 0, amp: 1, flapW: 1, flareW: 0, F: 0, pitch: 0, roll: 0, bob: 0, stand: 0,
                 hx: 0, hy: 0, hr: 0, feet: null, legW: 0, plant: 0, fx: 0 };
      gulls.push(gl);
    }
    function bez(c, u) {
      var v = 1 - u;
      return [v * v * v * c[0] + 3 * v * v * u * c[2] + 3 * v * u * u * c[4] + u * u * u * c[6],
              v * v * v * c[1] + 3 * v * v * u * c[3] + 3 * v * u * u * c[5] + u * u * u * c[7]];
    }
    // Flugneigung aus der Bahn: sinkend Nase runter, steigend hoch
    function flightPitch(b, lo, hi) {
      var a = -Math.atan2(b.vy, Math.abs(b.vx) + 1) / DEG * 0.45;
      return Math.max(lo, Math.min(hi, a));
    }
    // Schnabelspitze (Kopfmitte + Schnabel) in Puppen-Einheiten zum Ziel
    function peckVec(b) {
      if (!b.reach) return [5, 3];
      var rc = b.reach(b.dir), tipx = 12.5 + 10.4, tipy = -9 + 0.6;
      var vx = (rc[0] - b.x) * b.face / GK - tipx, vy = (rc[1] - b.y) / GK - tipy;
      return [Math.max(-2, Math.min(8, vx)), Math.max(-6, Math.min(8, vy))];
    }
    function stepGulls(dt) {
      for (var i = gulls.length - 1; i >= 0; i--) {
        var b = gulls[i], t, k, per = 0.42, standFeet = false;
        b.t += dt; b.age += dt; t = b.t;
        b.px = b.x; b.py = b.y;
        if (b.phase === 'in') {
          // ein paar Schläge, dann Gleitflug in einer Kurve herunter
          k = clamp01(t / b.tin);
          var q = bez(b.bz, k * (1.25 - 0.25 * k));
          b.x = q[0]; b.y = q[1];
          b.flapW = 1 - ease((t - 0.7) / 0.5);
          b.amp = 0.9;
          b.flareW = 0;
          // im Gleiten in die Kurve geneigt, leicht pendelnd
          b.roll = 0.1 * Math.sin(t * 1.1) * b.flapW + (0.32 + 0.08 * Math.sin(t * 1.1)) * (1 - b.flapW);
          if (k >= 1) { b.phase = 'land'; b.t = 0; b.lx0 = b.x; b.ly0 = b.y; b.p0 = b.pitch; }
        } else if (b.phase === 'land') {
          // Abfangen: Rumpf steil, Flügel nach vorn gewölbt, Beine vor,
          // 2–3 Bremsschläge, aufsetzen, ein Hüpfer, Flügel anlegen
          k = clamp01(t / 0.62);
          per = 0.24;
          b.flareW = ease(t / 0.15) * (1 - ease((t - 0.62) / 0.3));
          b.flapW = 0; b.amp = 1 - clamp01((t - 0.55) / 0.3);
          b.roll *= Math.pow(0.02, dt);
          b.pitch = k < 0.45 ? mix(b.p0, 30, ease(k / 0.45)) : mix(30, 8, ease((k - 0.45) / 0.55));
          b.legW = ease(t / 0.3);
          if (t < 0.62) {
            b.x = mix(b.lx0, b.lx, 1 - (1 - k) * (1 - k));
            b.y = mix(b.ly0, b.ly, Math.pow(k, 1.5));
            b.feet = 'fwd';
          } else {
            // Hüpfer nach dem Aufsetzen
            var h = clamp01((t - 0.62) / 0.3);
            b.x = b.lx + b.dir * 7 * ease(h);
            b.y = b.ly - 6 * Math.sin(Math.PI * h);
            b.F = ease((t - 0.62) / 0.4);
            b.stand = ease((t - 0.62) / 0.4);
            b.feet = h < 1 ? 'hop' : 'stand';
            if (t >= 1.05) { b.phase = 'stand'; b.t = 0; b.fx = b.x; b.feet = 'stand'; }
          }
        } else if (b.phase === 'stand') {
          // pickt dreimal nach der Beute, beim dritten Mal zugreifen
          b.F = 1; b.stand = 1; b.amp = 0; b.flareW = 0; b.feet = 'stand';
          var pk = 0;
          [[0.4, 0.34], [0.95, 0.34], [1.45, 0.4]].forEach(function (w) {
            if (t > w[0] && t < w[0] + w[1]) pk = Math.max(pk, Math.sin(Math.PI * (t - w[0]) / w[1]));
          });
          var pv = peckVec(b);
          b.hx = pv[0] * pk; b.hy = pv[1] * pk + 0.6 * Math.sin(t * 9) * (1 - pk) * (t < 1.65 ? 1 : 0);
          b.hr = 28 * pk - (t > 1.7 ? 14 * Math.sin(Math.PI * clamp01((t - 1.7) / 0.4)) : 0);
          b.pitch = 6 - 14 * pk;
          b.y = b.ly + 0.8 * GK * pk;
          if (t >= 1.65 && !b.grabbed) {
            b.grabbed = true;
            var loot = b.grab ? b.grab() : null;
            var rr = loot && loot.scoop ? Math.max(2.4, Math.min(5, loot.r * 0.6 * 0.5 / GK)) : 0;
            if (rr) el('circle', { 'class': 'tss-scoop' + loot.scoop, cx: f1(9.6 + rr * 0.45), cy: f1(0.8 + rr * 0.75), r: f1(rr) }, b.carry);
            if (loot && loot.fries) {
              for (var j = 0; j < Math.min(4, loot.fries); j++) {
                el('rect', { 'class': 'tss-fry tss-gull-fry', x: f1(7 + j * 0.8), y: -6.5 + (j % 2) * 0.8, width: 2.6, height: 13, rx: 0.6,
                             transform: 'rotate(' + (62 + j * 9) + ' 9.4 0.2)' }, b.carry);
              }
            }
          }
          if (t >= 2.1) { b.phase = 'turn'; b.t = 0; b.hx = b.hy = b.hr = 0; }
        } else if (b.phase === 'turn') {
          // Hüpfer mit Kehrtwende
          k = clamp01(t / 0.32);
          b.y = b.ly - 5 * Math.sin(Math.PI * k);
          b.x = b.fx - b.dir * 3 * ease(k);
          if (k >= 0.5) b.face = -b.dir;
          b.feet = k < 1 ? 'hop' : 'stand';
          b.pitch = 6;
          if (k >= 1) { b.phase = 'off'; b.t = 0; b.x0 = b.x; b.y0 = b.ly; b.fx = b.x; }
        } else {
          // Abflug: ducken, abspringen, kräftige Schläge, steigend davon
          var face = b.face, c = ease(t / 0.16);
          b.flareW = 0; b.flapW = 1;
          if (t < 0.16) {
            b.y = b.y0 + 2.6 * GK * c; b.pitch = 6 + 8 * c; b.hx = 1.5 * c; b.hy = 2 * c;
            b.F = 1 - 0.5 * c; b.amp = 1.25; b.feet = 'stand';
            b.fp = 0.62;   // Flügel kommen im Aufschlag hoch
          } else {
            var u = t - 0.16;
            b.x = b.x0 + face * (70 * u + 150 * u * u);
            b.y = b.y0 + 2.6 * GK * Math.exp(-14 * u) - (22 * (1 - Math.exp(-7 * u)) + 115 * u + 45 * u * u);
            b.F = 0.5 * (1 - ease(u / 0.16));
            b.stand = 1 - ease(u / 0.4);
            b.amp = u < 1.2 ? 1.25 : mix(1.25, 0.9, ease((u - 1.2) / 0.6));
            per = u < 1.2 ? 0.32 : 0.42;
            b.hx *= Math.pow(0.01, dt); b.hy *= Math.pow(0.01, dt);
            b.legW = 1 - ease((u - 0.12) / 0.25);
            b.feet = 'trail';
          }
        }
        // Geschwindigkeit, Schlag, Neigung im Flug
        if (dt > 0) { b.vx = (b.x - b.px) / dt; b.vy = (b.y - b.py) / dt; }
        b.fp += dt / per * (b.amp > 0 ? 1 : 0);
        if (b.phase === 'in') b.pitch = flightPitch(b, -18, 10);
        if (b.phase === 'off' && t >= 0.16) b.pitch = mix(14, flightPitch(b, -8, 24), ease((t - 0.16) / 0.3));
        if (b.phase === 'off') b.roll = 0.08 * Math.sin(b.t * 1.3);
        // Rumpf wippt gegen den Schlag (Abschlag hebt)
        var A = (1 - b.F) * b.amp * Math.max(b.flapW, b.flareW);
        b.bob = 0.9 * A * wbeat(b.fp - 0.05);
        drawGull(b);
        var op = clamp01(Math.min(b.x + 60, W + 60 - b.x) / 180) * clamp01((b.y + 60) / 160);
        b.g.setAttribute('opacity', op.toFixed(3));
        if (b.phase === 'off' && (op <= 0 && b.t > 0.5 || b.t > 6)) {
          gBirds.removeChild(b.g);
          gulls.splice(i, 1);
          if (b.done) b.done();
        }
      }
    }
    function drawGull(b) {
      var P = wingPose(b, b.age), pr = -b.pitch * DEG, cp = Math.cos(pr), sp = Math.sin(pr);
      b.g.setAttribute('transform', 'translate(' + f1(b.x) + ' ' + f1(b.y) + ')');
      b.flip.setAttribute('transform', 'scale(' + (b.face * GK) + ' ' + GK + ')');
      b.pose.setAttribute('transform', 'translate(0 ' + f1(b.bob) + ') rotate(' + f1(-b.pitch) + ')');
      drawWing(b.wFar, P, -1, b.roll);
      drawWing(b.wNear, P, 1, b.roll);
      var wo = clamp01((0.9 - b.F) / 0.4).toFixed(2), fo = clamp01((b.F - 0.4) / 0.4).toFixed(2);
      b.wFar.g.setAttribute('opacity', wo); b.wNear.g.setAttribute('opacity', wo);
      b.folded.setAttribute('opacity', fo);
      // Kopf: im Flug eingezogen nach vorn, im Stand höher auf dem Hals
      var hx = mix(13.5, 12.5, b.stand) + b.hx, hy = mix(-3.6, -9, b.stand) + b.hy;
      var ht = 'translate(' + f1(hx) + ' ' + f1(hy) + ') rotate(' + f1(b.hr) + ')';
      b.head.setAttribute('transform', ht);
      b.headTop.setAttribute('transform', ht);
      b.neck.setAttribute('d', 'M4.5 -5 L' + f1(hx - 2.2) + ' ' + f1(hy - 3.6) + ' L' + f1(hx + 1.5) + ' ' + f1(hy + 3.4) + ' L8.6 2 Z');
      // Beine: im Reiseflug eingezogen, beim Landen vorgestreckt, im Stand fest am Boden
      var hips = [[-1, 4.2], [-2.6, 3.8]].map(function (h) {
        return [h[0] * cp - h[1] * sp, h[0] * sp + h[1] * cp + b.bob];
      });
      var vis = b.feet === 'stand' || b.feet === 'hop' || b.legW > 0.02;
      if (b.legs.getAttribute('opacity') !== (vis ? '1' : '0')) b.legs.setAttribute('opacity', vis ? '1' : '0');
      if (!vis) return;
      [[b.legN, b.footN, 0], [b.legF, b.footF, 1]].forEach(function (L) {
        var h = hips[L[2]], f, toe;
        if (b.feet === 'stand') {
          f = [(b.fx - b.x) * b.face / GK + 1.5 - L[2] * 3, (b.gy - b.y) / GK];
          toe = [1, 0];
        } else if (b.feet === 'hop') {
          f = [h[0] + 1.5 - L[2] * 2, h[1] + 10.5]; toe = [1, 0];
        } else if (b.feet === 'fwd') {
          var tk = [h[0] - 9, h[1] + 3], fw = [h[0] + 6.5 - L[2] * 1.5, h[1] + 9];
          f = [mix(tk[0], fw[0], b.legW), mix(tk[1], fw[1], b.legW)]; toe = [0.8, 0.6];
        } else {
          var tr = [h[0] - 9, h[1] + 3], dn = [h[0] - 5 - L[2] * 1.5, h[1] + 10];
          f = [mix(tr[0], dn[0], b.legW), mix(tr[1], dn[1], b.legW)]; toe = [-0.2, 1];
        }
        var lp = legPath(h, f, toe);
        L[0].setAttribute('d', lp.leg);
        L[1].setAttribute('d', lp.foot);
      });
    }
    function clearSnacks() {
      gulls.forEach(function (b) { if (b.g.parentNode) b.g.parentNode.removeChild(b.g); });
      gulls = [];
      fries.forEach(function (f) { if (f.node.parentNode) f.node.parentNode.removeChild(f.node); });
      fries = [];
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
      var h = S.heat / 100 * (1 - B.heat) * (1 - B.night) * snowCool();
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

    // ── Regen und Tsunami: Burgen sacken zusammen und bauen sich wieder auf ──
    // s = 0 (steht) .. 1 (flach); Regen drückt höchstens auf 0,6
    var wave = null;          // laufender Tsunami (Auskunft der Weather-Kit)
    var pal = { s: 0, shown: -1, wait: null, washed: false };
    function liveRain() {
      var sky = opts.sky ? opts.sky() : null;
      return sky ? clamp01((sky.rain || 0) + 0.5 * (sky.drizzle || 0)) : B.rain;
    }
    // ein Bauwerk Richtung Ziel bewegen; Wiederaufbau erst nach Wartezeit
    // (gestaffelt, ein paar zugleich), dann in ~25 s
    // Tsunami spült flach (washed), die Windhose reißt ein (blown, nur in
    // Reichweite reach um ihr x); Wiederaufbau erst, wenn beide vorbei sind
    function sweeping() { return (wave && wave.active()) || (twister && twister.active()); }
    function stepSlump(c, target, x, maxWait, rebuild) {
      // vom Blitz getroffen: wie weggespült, bis zap abgelaufen ist
      if (c.zap > 0) { c.zap -= dt0; c.washed = true; c.hard = 1; }
      if (wave && !B.reduceMotion && wave.level(x) > 30) { c.washed = true; c.hard = Math.max(c.hard || 0, rebuild.washed); }
      var tx = twister && !B.reduceMotion ? twister.x() : null;
      if (tx !== null && Math.abs(tx - x) < rebuild.reach && !c.torn) {
        c.torn = true;
        c.washed = true;
        c.hard = Math.max(c.hard || 0, rebuild.blown);
        if (rebuild.torn) rebuild.torn(twister.dir || (tx < x ? 1 : -1));
      }
      if (c.washed && !sweeping() && !(c.zap > 0)) { c.washed = false; c.torn = false; c.hard = 0; c.wait = rand(3, maxWait); }
      if (c.washed) target = Math.max(target, c.hard);
      if (B.reduceMotion) { c.s = target; c.wait = null; return; }
      if (target >= c.s - 0.005) {
        c.wait = null;
        c.s += Math.min(target - c.s, dt0 * (c.washed ? 2.5 : 0.01 + target / 60));
        return;
      }
      if (c.wait === null) c.wait = rand(0, maxWait);
      if (c.wait > 0) { c.wait -= dt0; if (c.wait <= 0 && rebuild.burst) rebuild.burst(); return; }
      c.s = Math.max(target, c.s - dt0 / 25);
    }
    var dt0 = 0, twister = null;
    // Windhose reißt Türme und Fahnen ab: Sand und Fetzen fliegen mit dem Wirbel
    function debris(x, y, dir, flags) {
      if (!B.front) return;
      for (var i = 0; i < 40; i++) {
        B.front.add({ x: x + rand(-50, 50), y: y - rand(0, 70), vx: dir * rand(200, 750) + rand(-150, 150), vy: -rand(450, 1000), g: 900, term: 700,
                      sway: rand(20, 60), vph: rand(4, 9), vr: 0, wf: 0.2, r: rand(2, 5), c: i % 5 ? '#e2c27f' : '#b8955a', life: rand(1.6, 2.8), draw: droplet });
      }
      if (!flags) return;
      for (var j = 0; j < 5; j++) {
        B.front.add({ x: x + rand(-20, 20), y: y - 60, vx: dir * rand(300, 650), vy: -rand(600, 900), g: 500, term: 300,
                      sway: rand(40, 90), vph: rand(5, 10), vr: 0, wf: 0.3, r: rand(4, 6), c: CONFETTI[j % 5], life: 2.6, draw: droplet });
      }
    }
    function sandPuff(x, y) {
      if (!B.front) return;
      for (var i = 0; i < 10; i++) {
        B.front.add({ x: x + rand(-30, 30), y: y - rand(0, 20), vx: rand(-160, 160), vy: rand(-420, -160), g: 1400, term: 900,
                      sway: 0, vr: 0, wf: 0, r: rand(2, 4), c: '#e2c27f', life: 1, floor: sandY, draw: droplet });
      }
    }
    function renderCastle(c) {
      if (Math.abs(c.s - c.shown) < 0.002) return;
      c.shown = c.s;
      var sv = c.s, sy = 1 - 0.82 * sv, sx = 1 + 0.3 * sv;
      c.slump.setAttribute('transform', sv < 0.002 ? '' : 'scale(' + sx.toFixed(3) + ' ' + sy.toFixed(3) + ')');
      // nasse Fahne hängt, bei flacher Burg ist sie weggespült
      c.flagG.setAttribute('transform', 'rotate(' + (70 * clamp01(sv / 0.4)).toFixed(1) + ' ' + c.fx + ' ' + c.fy + ')');
      c.flagG.setAttribute('opacity', (1 - clamp01((sv - 0.75) / 0.15)).toFixed(3));
      c.mound.setAttribute('transform', 'scale(' + (0.5 + 0.7 * sv).toFixed(3) + ' ' + sv.toFixed(3) + ')');
      c.mound.setAttribute('opacity', clamp01(sv * 6).toFixed(3));
    }
    function renderPalace() {
      if (Math.abs(pal.s - pal.shown) < 0.002) return;
      pal.shown = pal.s;
      var px = 270, py = sandY(270) + 14, sy = 1 - 0.5 * pal.s, sx = 1 + 0.12 * pal.s;
      gPalace.setAttribute('transform', pal.s < 0.002 ? '' : 'translate(' + px + ' ' + f1(py) + ') scale(' + sx.toFixed(3) + ' ' + sy.toFixed(3) + ') translate(' + (-px) + ' ' + f1(-py) + ')');
    }
    function stepCastles(dt) {
      dt0 = dt;
      if (!sweeping() && (wave || twister)) {
        // erst loslassen, wenn alle gespülten Burgen ihre Wartezeit haben
        if (!castles.some(function (c) { return c && c.washed; }) && !pal.washed) { wave = null; twister = null; }
      }
      if (!B.on) {
        // ausgeblendet: nichts animieren, alles steht wieder
        castles.forEach(function (c) { if (c) { c.s = 0; c.wait = null; c.washed = false; c.torn = false; c.hard = 0; renderCastle(c); } });
        pal.s = 0; pal.washed = false; pal.torn = false; pal.hard = 0; pal.wait = null; renderPalace();
        wave = null; twister = null;
        return;
      }
      var r = liveRain();
      castles.forEach(function (c) {
        if (!c) return;
        // unter dem stehenden Schirm bleibt die Burg trocken
        var dry = U.mode === 'up' && !uClosed && B.partOn('umbrella') && Math.abs(c.x - U.tx) < 135;
        // unterm Schirm auch keine Schneehaube
        var dv = dry ? '1' : '';
        if (c.node.dataset.dry !== dv) c.node.dataset.dry = dv;
        stepSlump(c, dry ? 0 : 0.6 * r, c.x, 60, { washed: 1, blown: 1, reach: 110,
                                         torn: function (dir) { debris(c.x, c.y + 40, dir, true); },
                                         burst: function () { sandPuff(c.x, sandY(c.x)); } });
        renderCastle(c);
      });
      stepSlump(pal, 0.3 * r, 270, 30, { washed: 0.7, blown: 0.55, reach: 280,
                                         torn: function (dir) {
                                           debris(270, sandY(270) - 260, dir, true);
                                           debris(230, sandY(230) - 150, dir, false);
                                           debris(310, sandY(310) - 120, dir, false);
                                         } });
      // Windhose: Palast verliert Türme und Fahnen, bis er wieder steht
      var pb = pal.torn || pal.s > 0.05 && gPalace.dataset.blown === '1' ? '1' : '0';
      if (gPalace.dataset.blown !== pb) gPalace.dataset.blown = pb;
      // naht die Windhose, bebt der Palast
      var ptx = twister && twister.active && twister.active() ? twister.x() : null;
      var pq = !B.reduceMotion && ptx !== null && Math.abs(ptx - 270) < 380 ? '1' : '0';
      if (gPalace.dataset.quake !== pq) gPalace.dataset.quake = pq;
      renderPalace();
    }

    // ── Sonnenschirm: Blitz, Sturm, Windhose ──
    var tornado = null, uDrawn = false, uctx = B.fireCtx();
    // Baum am Strand steht vor dem Schirm: dann weder Feuer noch Wegwehen
    function treeOver() { return X.shown() && xRoot.dataset.tree !== '0'; }
    // der Schirm fliegt auch weg, wenn der Weihnachtsbaum davor steht
    function umbrellaFree() { return B.on && !B.reduceMotion && B.partOn('beach') && B.partOn('umbrella'); }
    // Strand-Baum biegt sich im Sturm, bei naher Windhose kräftig
    var TREE_CX = TREE_X + 200 * TREE_K, treeSway = B.sway(), swayDrawn = '', jigDrawn = '';
    function stepTreeSway(dt) {
      var tx = tornado ? tornado.x() : null, target = 0, gust = 0;
      if (B.on && !B.reduceMotion && treeOver()) {
        if (tx !== null && Math.abs(tx - TREE_CX) < 320) target = 6;
        else if (stormy()) target = 2.2;
        gust = Math.min(4, Math.abs(B.gustPx) / 200);
      }
      var a = treeSway(dt, target, gust, B.windBase < 0 ? -1 : 1);
      var v = a.toFixed(2);
      if (v !== swayDrawn) { swayDrawn = v; xRoot.style.setProperty('--twb-sway', v); }
      // Kugeln wackeln mit, solange der Baum stark schwingt
      var jig = target >= 6 ? '1' : '';
      if (jig !== jigDrawn) { jigDrawn = jig; xRoot.dataset.jiggle = jig; }
    }
    // Kuppel-Punkt (lokal) auf den Bildschirm (ohne Flug)
    function uScreen(lx, ly) {
      var a = U.rot * Math.PI / 180;
      return [U.tx + lx * Math.cos(a) - ly * Math.sin(a), U.ty + lx * Math.sin(a) + ly * Math.cos(a)];
    }
    function domeTop(lx) { return -27 + 57 * (lx / 150) * (lx / 150); }
    function inDome(lx, ly) { return Math.abs(lx) < 148 && ly > domeTop(lx) - 1 && ly < 27; }
    // Blitz trifft eine Sandburg (nah, höchstens 80 px daneben, nicht unterm
    // Schirm): sie zerbröselt mit Funken, baut sich danach wieder auf
    function castleBolt(p) {
      if (!B.on || B.reduceMotion || !p.near || typeof p.x !== 'number' || !B.partOn('beach')) return;
      var best = null;
      castles.forEach(function (c) {
        if (!c || c.s > 0.3 || c.zap > 0 || c.node.dataset.dry === '1' || Math.abs(c.x - p.x) > 80) return;
        if (!best || Math.abs(c.x - p.x) < Math.abs(best.x - p.x)) best = c;
      });
      if (!best || Math.random() < 0.65) return;   // nicht jeder Blitz trifft
      var c = best, y = sandY(c.x);
      if (p.ground) p.ground(c.x, y - 20);
      c.zap = 3;
      debris(c.x, c.y + 40, -1, true);
      debris(c.x, c.y + 40, 1, false);
      B.sparks(c.x, y - 20, 24, 30);
      for (var i = 0; i < 4; i++) B.smoke(c.x + rand(-25, 25), y - 20, { o: 0.35 });
      if (opts.event) opts.event('struck', { target: 'castle', name: c.label || '' });
    }
    function umbrellaBolt(p) {
      if (!p.near || U.mode !== 'up' || uClosed || !umbrellaFree() || typeof p.x !== 'number') return castleBolt(p);
      var c = uScreen(0, -10);
      if (Math.abs(p.x - c[0]) > 120) return castleBolt(p);
      U.hx = Math.max(-110, Math.min(110, p.x - c[0]));
      U.hy = domeTop(U.hx) + 4;
      var hit = uScreen(U.hx, U.hy);
      if (p.ground) p.ground(hit[0], hit[1]);
      U.mode = 'burn'; U.t = 0; U.acc = 0;
      [U.hole, U.edge, U.edgeGlow].forEach(function (n) { n.setAttribute('cx', f1(U.hx)); n.setAttribute('cy', f1(U.hy)); });
      B.sparks(hit[0], hit[1], 24, 10);
      if (opts.event) opts.event('struck', { target: 'umbrella', name: '' });
    }
    // Brandkante wächst vom Einschlag aus und erreicht nach 6 s den fernsten Saum
    function burnR() { return (175 + Math.abs(U.hx)) * Math.pow(B.clamp01(U.t / 6), 1.15); }
    function setBurn(r, charA, edgeA) {
      U.hole.setAttribute('r', f1(r));
      U.edge.setAttribute('r', f1(r));
      U.edgeGlow.setAttribute('r', f1(r));
      U.edge.setAttribute('opacity', edgeA.toFixed(2));
      U.edgeGlow.setAttribute('opacity', edgeA.toFixed(2));
      U.char.setAttribute('opacity', charA.toFixed(2));
    }
    function placeFly(op) {
      var tr = U.x === 0 && U.y === 0 && U.a === 0 ? '' : 'translate(' + f1(U.x) + ' ' + f1(U.y) + ') rotate(' + f1(U.a) + ' ' + U.tx + ' ' + U.ty + ')';
      gUFly.setAttribute('transform', tr);
      var o = op === undefined ? '1' : op.toFixed(3);
      if (o !== U.op) { gUFly.setAttribute('opacity', o); U.op = o; }
    }
    // Schirm als Dach für den Regen der Wetter-Engine (Kuppel ungefähr als
    // Parabel, mit der Neigung der Kuppel); nur solange er steht
    var shelterOn = null, uClosed = false;
    function shelterUmbrella() {
      var on = B.on && U.mode === 'up' && !uClosed && B.partOn('beach') && B.partOn('umbrella');
      if (on === shelterOn || !opts.shelter) return;
      shelterOn = on;
      if (U.spot) U.spot.classList.toggle('is-off', !on);
      var a = U.rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      opts.shelter(on ? [{ x0: U.tx - 148, x1: U.tx + 148, y: function (x) {
        var lx = x - U.tx, ly = 30 - 57 * (1 - Math.pow(lx / 150, 2));
        return U.ty + lx * sa + ly * ca;
      } }] : []);
    }
    // stehender Schirm neigt sich in Böen und flattert leicht bei Wind (um den Fuß)
    var uLean = 0, uLeanT = 0;
    function leanUmbrella() {
      if (B.reduceMotion) return;
      uLeanT += 1 / 60;
      var w = Math.abs(B.windBase);
      var a = Math.max(-10, Math.min(10, B.gustPx / 600 * 8)) + B.windBase * 2.5 +
              (w > 0.3 ? Math.sin(uLeanT * 11) * 1.5 * w : 0);
      if (Math.abs(a - uLean) < 0.05) return;
      uLean = a;
      gUFly.setAttribute('transform', Math.abs(a) < 0.05 ? '' : 'rotate(' + f1(a) + ' ' + U.px + ' ' + f1(U.py) + ')');
    }
    // neuer Schirm steht sofort (ohne Animation) bzw. poppt aus dem Sand
    function freshUmbrella(pop) {
      U.mode = 'up'; U.t = 0; U.x = 0; U.y = 0; U.a = 0; U.calm = 0; uLean = 0;
      setBurn(0, 0, 0);
      U.ribs.classList.remove('is-burnt');
      U.pole.classList.remove('is-burnt');
      placeFly(1);
      if (pop) { gUPop.classList.remove('is-pop'); void gUPop.getBoundingClientRect(); gUPop.classList.add('is-pop'); }
    }
    function stormy() {
      var sky = opts.sky ? opts.sky() : null, kind = sky ? sky.kind : '';
      var bz = opts.blizzard ? opts.blizzard() : 0;
      return kind === 'storm' || kind === 'blizzard' || bz > 0.3 || Math.abs(B.windBase) >= 0.8;
    }
    function tornadoNear() {
      var tx = tornado ? tornado.x() : null;
      return tx !== null && Math.abs(tx - U.px) < 200;
    }
    function stepUmbrella(dt, ts) {
      if (!B.on) {
        if (U.mode !== 'up') freshUmbrella(false);
        if (uDrawn) { uctx.clearRect(0, 0, W, H); uDrawn = false; }
        tornado = null;
        shelterUmbrella();
        return;
      }
      if (tornado && !tornado.active()) tornado = null;
      stepTreeSway(dt);
      U.t += dt;
      var burning = false;
      if (U.mode === 'up' && umbrellaFree() && (stormy() || tornadoNear())) {
        U.mode = 'fly'; U.t = 0; U.vx = 0; U.vy = -420; U.va = 0;
        var tx = tornado ? tornado.x() : null;
        U.dir = tx !== null ? (tornado.dir || (tx < U.px ? 1 : -1)) : (B.windBase < 0 ? -1 : 1);
        sandPuff(U.px, U.py - 10);
      }
      if (U.mode === 'up') leanUmbrella();
      // nachts zugeklappt (kein Regenschutz mehr); mit Abstand zwischen Zu und
      // Auf, damit er in der Dämmerung nicht hin und her klappt
      var shut = uClosed ? B.night > 0.4 : B.night > 0.6;
      if (shut !== uClosed) { uClosed = shut; gUmbrella.dataset.closed = shut ? '1' : '0'; }
      shelterUmbrella();
      if (U.mode === 'burn') {
        // Bespannung brennt in ~6 s bis auf Speichen und Stange ab
        var r = burnR();
        setBurn(r, Math.min(0.55, U.t / 6), 1 - B.clamp01((U.t - 5.4) / 0.6));
        burning = true;
        if (U.t >= 6) { U.mode = 'burnt'; U.ribs.classList.add('is-burnt'); U.pole.classList.add('is-burnt'); setBurn(320, 0, 0); }
      } else if (U.mode === 'burnt') {
        // qualmende Stange, nach ~60 s steht ein neuer Schirm
        U.acc = (U.acc || 0) + dt * 2.2 * (1 - B.clamp01(U.t / 50));
        while (U.acc >= 1) { U.acc--; var tip = uScreen(0, -29); B.smoke(tip[0], tip[1] - 4, { o: 0.7, r: rand(14, 20), gr: rand(14, 22), c: '96,92,90' }); }
        if (U.t >= 54) freshUmbrella(true);
      } else if (U.mode === 'fly') {
        // hebt ab, überschlägt sich und fliegt mit dem Wind seitlich davon
        U.vx += U.dir * 420 * dt;
        U.vx = Math.max(-750, Math.min(750, U.vx));
        U.vy += (U.t < 1.2 ? -60 : 180) * dt;
        U.va += U.dir * 260 * dt;
        U.x += U.vx * dt; U.y += U.vy * dt; U.a += U.va * dt;
        var sx = U.tx + U.x, sy = U.ty + U.y;
        var op = B.clamp01(Math.min(sx + 60, W + 60 - sx) / 220) * B.clamp01((sy + 150) / 220);
        placeFly(op);
        if (op <= 0 && U.t > 0.5) { U.mode = 'away'; U.t = 0; U.calm = 0; }
      } else if (U.mode === 'away') {
        // kommt wieder, wenn es ~20 s ruhig ist und keine Windhose läuft
        U.calm = !stormy() && Math.abs(B.windBase) < 0.5 && !tornado ? U.calm + dt : 0;
        if (U.calm >= 20) {
          U.mode = 'back'; U.t = 0; U.x = 0; U.y = -1150; U.a = -U.dir * 35; U.vy = 0;
          placeFly(0);
        }
      } else if (U.mode === 'back') {
        // fällt von oben zurück und steckt sich in den Sand
        U.vy += 1700 * dt;
        U.y += U.vy * dt;
        U.a *= Math.pow(0.15, dt);
        if (U.y >= 0) {
          U.y = 0;
          if (U.vy > 380) { U.vy = -U.vy * 0.22; sandPuff(U.px, U.py - 10); }
          else { U.mode = 'up'; U.a = 0; U.vy = 0; }
        }
        placeFly(B.clamp01((U.ty + U.y + 150) / 220));
      }
      // Flammen an der Brandkante, Rauch darüber
      if (!burning) {
        if (uDrawn) { uctx.clearRect(0, 0, W, H); uDrawn = false; }
        return;
      }
      uctx.clearRect(0, 0, W, H);
      uDrawn = true;
      var rr = burnR(), pts = [], k = 1 - B.clamp01((U.t - 5) / 1);
      for (var i = 0; i < 18; i++) {
        var ang = i / 18 * Math.PI * 2, lx = U.hx + Math.cos(ang) * rr, ly = U.hy + Math.sin(ang) * rr * 0.9;
        if (!inDome(lx, ly)) continue;
        var sp = uScreen(lx, ly);
        pts.push([sp[0], sp[1] + 6, 0.8 + 0.2 * Math.sin(i * 1.7)]);
      }
      var c = uScreen(U.hx, U.hy);
      B.glow(uctx, c[0], c[1], 260, 0.28 * k);
      B.flames(uctx, pts, 34, 80, k, ts / 1000);
      U.acc = (U.acc || 0) + dt * 7 * k;
      while (U.acc >= 1 && pts.length) {
        U.acc--;
        var q = pts[Math.floor(Math.random() * pts.length)];
        B.smoke(q[0], q[1] - 30, { o: 0.65, r: rand(16, 26), c: '96,92,90' });
        if (Math.random() < 0.5) B.sparks(q[0], q[1] - 10, 1, 10);
      }
    }

    // ── Hauptschleife ──
    var ffAcc = 0, offFor = 99;
    var xmas = 'off';
    TS.loop(function (dt, ts) {
      X.step(dt);
      syncCastles();
      if (B.reduceMotion) S.heat = S.heatT;
      else S.heat += (S.heatT - S.heat) * Math.min(1, dt * 0.8);
      offFor = B.on ? 0 : offFor + dt;
      if (offFor > 3) return;
      var hk = heatK();
      B.vars({ '--tss-heat': hk, '--ts-night': B.night });
      placeSun();
      B.stepSnow(dt);
      stepSteam(dt);
      stepIces(dt);
      if (B.on) { stepGulls(dt); stepFries(dt); } else if (gulls.length || fries.length) clearSnacks();
      stepCastles(dt);
      stepUmbrella(dt, ts);
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
    // In der Xmas-Zeit statt der Burgen Kugeln und Geschenke am Baum
    setInterval(function () {
      if (!B.on || X.busy()) return;
      spotRound++;
      var top = S.top[0];
      if (top && spotRound % 4 === 0) { B.tag('Top cooler: ' + top[0] + ' · ' + top[1] + '×', W / 2, 300, false); return; }
      var pool = [];
      X.spotPool(pool);
      if (B.partOn('beach') && !X.followersHidden()) {
        castles.forEach(function (c) { if (c && c.label) pool.push({ node: c.inner, label: c.label, p: [c.x, c.y] }); });
      }
      if (!pool.length) return;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      B.spot(pick.node);
      B.tag(pick.label, pick.p[0], pick.p[1], false);
    }, 8000);

    return {
      load: function (deco) {
        if (!deco) return;
        clearCastles();
        (deco.castles || []).forEach(function (c) { addCastle(c.name || '', false); });
        cTotal = deco.castle_total || castles.filter(Boolean).length;
        X.load(deco);
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
        // Xmas-Teile einzeln abschaltbar wie im Winter
        var pp = s.parts || {}, xp = {};
        XMAS_KEYS.forEach(function (k) {
          xp[k] = pp[k] !== false;
          xRoot.dataset[k] = xp[k] ? '1' : '0';
        });
        xRoot.dataset.night = B.night > 0.05 ? '1' : '0';
        xRoot.style.setProperty('--tw-night', B.night.toFixed(3));
        xmas = s.xmas || 'off';
        X.update(B.on, xmas, xp);
      },
      command: function (cmd, p) {
        p = p || {};
        switch (cmd) {
          // Follow: Sandburg immer anlegen, sichtbar nur im aktiven Thema
          // Follow: in der Xmas-Zeit Kugel am Baum, sonst Sandburg; die jeweils
          // andere Form still mitführen, damit beide Listen stimmen
          case 'follow':
          case 'castle':
            var xm = X.followAsOrnament();
            X.ornament(p.name || '', xm && B.on);
            addCastle(p.name || '', !xm && B.on);
            cTotal++;
            break;
          case 'ornament': X.ornament(p.name || '', true); break;
          case 'gift': X.gift({ name: p.name || '', type: p.type, amount: parseInt(p.amount, 10) || 1 }, true); break;
          case 'build': palace.build(p.name || '', B.on); break;
          case 'whereami': {
            var me = (p.name || '').toLowerCase(), pool = [];
            X.spotPool(pool);
            if (B.partOn('beach') && !X.followersHidden()) {
              castles.forEach(function (c) { if (c && c.label) pool.push({ node: c.inner, label: c.label, p: [c.x, c.y] }); });
            }
            var hit = pool.filter(function (q) { return q.label.toLowerCase() === me; })[0];
            if (hit && B.on && root.SeasonKit) { root.SeasonKit.hop(hit.node); B.tag(hit.label + ' is right here!', hit.p[0], hit.p[1], true); }
            break;
          }
          case 'snowmanreset': palace.reset(B.on); break;
          case 'splash': splash(p); break;
          case 'ice': addIce(p.name || ''); break;
          case 'fries': addFries(p.name || ''); break;
          case 'cool': cool(p); break;
          case 'gust': B.gust(600); break;
          case 'celebrate':
            if (X.shown()) X.celebrate();
            celebrate(p.name || '');
            break;
          case 'seasonboard': B.board('Top coolers', S.top); break;
          // Tsunami spült die Burgen flach, sobald das Wasser sie erreicht
          case 'spectacle':
            if (B.on && p.type === 'tsunami' && !p.reduced) wave = p;
            if (B.on && p.type === 'tornado' && !p.reduced) { twister = p; tornado = p; }
            break;
          case 'bolt': umbrellaBolt(p); break;
          case 'clear':
            if (p.kind === 'castles') clearCastles();
            else if (p.kind === 'ornaments' || p.kind === 'gifts') X.clear(p.kind);
            else if (p.kind === 'heat') { S.heatT = 0; S.top = []; }
            break;
        }
      },
      playSetup: function (done) { X.start('setup', done); },
      playFarewell: function (done) { X.start('farewell', done); },
      busy: function () { return X.busy(); },
      status: function () {
        var t = X.totals();
        return { on: B.on, heat: Math.round(S.heat), castles: cTotal, project: palace.n(),
                 xmas: xmas, shown: X.shown(), ornaments: t.ornaments, gifts: t.gifts };
      }
    };
  }

  root.ThemeSummer = { create: create };
})(typeof window !== 'undefined' ? window : this);
