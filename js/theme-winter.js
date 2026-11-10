/* Winter-Thema der Weather-Source: Schneedecke, Eiszapfen, Schneemann (Sub
 * baut, gemeinsames Sub-Projekt), Mini-Schneemänner (Follow) – in der
 * Xmas-Zeit stattdessen Follower-Kugeln am Baum (Minis ausgeblendet), dazu
 * Lichterkette, Baum, hängende Kugeln und Geschenke,
 * mit Aufbau- und Abschied-Animation. Im Schneesturm schneien die Minis bis
 * zum Hut ein (Schneehügel davor), eine Lawine begräbt die Minis in ihrer
 * Ecke kurz; danach graben sie sich wieder frei. Optik aus effects/xmas.html und
 * effects/winter.html übernommen; Stände (Schneedecke, Xmas-Ablauf) rechnet
 * der Server, hier wird nur gezeigt. Braucht js/season-kit.js.
 *
 *   var theme = ThemeWinter.create(stageEl, { tags: svgGroup, hud: hudEl });
 *   theme.load(deco);  theme.update(state);  theme.command(cmd, params);
 *   theme.playSetup(done);  theme.playFarewell(done);
 */
(function (root) {
  'use strict';

  var W = 1920, H = 1080;
  var NS = 'http://www.w3.org/2000/svg';
  var reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function outBack(t) { t = clamp01(t); var c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  function outBounce(t) {
    t = clamp01(t);
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
    if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
    t -= 2.625 / 2.75; return 7.5625 * t * t + 0.984375;
  }
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function f1(v) { return (+v).toFixed(1); }

  // Pseudozufall mit festem Startwert: Aufbau sieht bei jedem Laden gleich aus
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

  // ── Baum: Platz unten rechts, Koordinaten im Baum-SVG (400 × 540) ──
  var TREE_X = 1500, TREE_Y = 567, TREE_K = 0.95;
  function treeToScreen(x, y) { return [TREE_X + x * TREE_K, TREE_Y + y * TREE_K]; }
  // (Spitze x, Spitze y, Basis y, halbe Basisbreite) — wie die Pfade
  var TIERS = [[200, 38, 202, 82], [200, 90, 300, 122], [200, 150, 402, 162]];
  var TIER_D = [
    'M200 150 L362 402 Q280 422 200 412 Q120 422 38 402 Z',
    'M200 90 L322 300 Q260 318 200 310 Q140 318 78 300 Z',
    'M200 38 L282 202 Q240 216 200 210 Q160 216 118 202 Z'
  ];
  var TIER_RIDGE = ['M38 402 L200 150 L362 402', 'M78 300 L200 90 L322 300', 'M118 202 L200 38 L282 202'];
  var TIER_CAP = [
    'M38 402 Q120 422 200 412 Q280 422 362 402 Q350 392 330 396 Q300 404 270 398 Q235 408 200 402 Q160 410 130 398 Q95 406 62 396 Q48 394 38 402 Z',
    'M78 300 Q140 318 200 310 Q260 318 322 300 Q310 292 292 296 Q262 304 236 297 Q215 306 190 300 Q160 307 132 297 Q102 304 78 300 Z',
    'M118 202 Q160 216 200 210 Q240 216 282 202 Q270 195 252 199 Q228 207 205 200 Q182 207 160 199 Q138 205 118 202 Z'
  ];
  var GARLANDS = ['M140 178 Q200 206 262 172', 'M106 272 Q200 304 298 262', 'M74 372 Q200 410 330 362'];
  var FIXED = [[160, 160, 'ornR'], [236, 243, 'ornG'], [140, 334, 'ornB'], [272, 342, 'ornP']];
  var MAX_ORN = 60;
  var GRADS = ['ornR', 'ornG', 'ornB', 'ornP'];
  // Wabenraster in den drei Stufen, gemischt: der Baum füllt sich gleichmäßig
  function makeSlots() {
    seed = 3;
    var d = 27, out = [];
    function inside(x, y) {
      return TIERS.some(function (t) {
        if (y < t[1] + 34 || y > t[2] - 14) return false;
        return Math.abs(x - 200) <= t[3] * (y - t[1]) / (t[2] - t[1]) - 13;
      });
    }
    for (var r = 0, y = 72; y < 400; y += d * 0.866, r++) {
      for (var x = 200 - 8 * d + (r % 2 ? d / 2 : 0); x <= 200 + 8 * d; x += d) {
        if (!inside(x, y)) continue;
        if (FIXED.some(function (f) { return Math.hypot(f[0] - x, f[1] - y) < d; })) continue;
        out.push([x + (rnd() * 6 - 3), y + (rnd() * 6 - 3)]);
      }
    }
    for (var k = out.length - 1; k > 0; k--) {
      var m = Math.floor(rnd() * (k + 1)), tmp = out[k]; out[k] = out[m]; out[m] = tmp;
    }
    return out.slice(0, MAX_ORN);
  }

  // ── Geschenke: hintere Reihe zuerst, vordere davor ([x, vorne?]) ──
  var GIFT_SLOTS = [
    [200, 1], [150, 0], [250, 0], [135, 1], [265, 1],
    [100, 0], [300, 0], [75, 1], [325, 1], [55, 0],
    [345, 0], [18, 1], [382, 1], [-35, 1], [435, 1]
  ];
  var GIFT_LOOK = {
    sub:     { w: 52, h: 40, box: '#c4302b', rib: '#f2d16b' },
    resub:   { w: 56, h: 44, box: '#2e8b57', rib: '#e8443a' },
    giftsub: { w: 58, h: 46, box: '#7d3ca3', rib: '#f2b705' },
    bits:    { w: 40, h: 32, box: '#2a64b8', rib: '#ffffff' },
    raid:    { w: 66, h: 50, box: '#e8772e', rib: '#ffffff' }
  };
  function giftScale(type, amount) {
    amount = amount || 1;
    if (type === 'giftsub') return Math.min(1.6, 1 + Math.log(amount) / Math.LN2 / 6);
    if (type === 'bits') return amount >= 10000 ? 1.55 : amount >= 1000 ? 1.3 : 1;
    if (type === 'resub') return amount >= 12 ? 1.15 : 1;
    if (type === 'raid') return amount >= 50 ? 1.25 : 1;
    return 1;
  }
  function giftLabel(gift) {
    var n = gift.amount || 1, who = gift.name || '';
    var what = {
      sub: 'sub', resub: n > 1 ? n + ' months' : 'resub',
      giftsub: n + (n === 1 ? ' gift sub' : ' gift subs'),
      bits: n + ' bits', raid: 'raid with ' + n
    }[gift.type] || '';
    return who ? who + (what ? ' · ' + what : '') : what;
  }

  // ── Hängende Kugeln: [x, Fadenlänge, Verlauf] ──
  var BAUBLES = [[70, 150, 'ornR'], [170, 230, 'ornG'], [265, 120, 'ornB'],
                 [1660, 300, 'ornGr'], [1760, 360, 'ornR'], [1855, 330, 'ornO']];

  // ── Schneemann links, Minis dazwischen (Mitte unten bleibt frei) ──
  var SM_X = 250, SM_K = 0.85;
  // Plätze: [x, Maßstab, Höhenversatz, Neigung]; Größe, Tiefe und Versatz je
  // Platz fest gestreut (kein Springen beim Neuladen), hinten kleiner und höher
  function hash(i, s) { var v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); }
  function slot(x, n, back) {
    var size = 0.62 + 0.5 * hash(n, 1);
    var depth = back ? 0.45 + 0.55 * hash(n, 2) : 0.4 * hash(n, 2);
    return [Math.round(x + (hash(n, 3) - 0.5) * 30), +(size * (1 - 0.28 * depth)).toFixed(2),
            Math.round(10 - 36 * depth), Math.round((hash(n, 4) - 0.5) * 12)];
  }
  var MINI_SLOTS = (function () {
    var front = [], back = [], i;
    for (i = 0; i < 9; i++) front.push(slot(420 + i * 48, i, false));
    for (i = 0; i < 8; i++) front.push(slot(1430 - i * 48, 10 + i, false));
    for (i = 0; i < 8; i++) back.push(slot(444 + i * 48, 20 + i, true));
    for (i = 0; i < 7; i++) back.push(slot(1406 - i * 48, 30 + i, true));
    // abwechselnd links/rechts, von außen nach innen
    function zip(list, nl) {
      var l = list.slice(0, nl), r = list.slice(nl), out = [];
      while (l.length || r.length) { if (l.length) out.push(l.shift()); if (r.length) out.push(r.shift()); }
      return out;
    }
    return zip(front, 9).concat(zip(back, 8)).slice(0, 30);
  })();
  var PART_NAMES = ['', 'the base', 'the belly', 'the head', 'eyes and a smile', 'a carrot nose',
                    'buttons and arms', 'a scarf', 'the top hat'];

  // Schneedecke: Höhe an Stelle x bei Schnee s (0..1); ein Rest bleibt immer
  function coverH(x, s) {
    var w = 620;
    function bump(d) { return d < w ? 0.5 + 0.5 * Math.cos(Math.PI * d / w) : 0; }
    var wav = 6 * Math.sin(x / 70) + 4 * Math.sin(x / 23);
    return 10 + 55 * s + wav * (0.2 + s) + Math.max(bump(x), bump(W - x)) * (14 + 150 * s);
  }
  function ridgeY(x, s) { return 4 + 12 * s + 4 * Math.sin(x / 40) * (0.4 + s) + 3 * Math.sin(x / 13) * (0.4 + s); }

  function defs(svg) {
    var d = el('defs', {}, svg);
    function grad(kind, id, attrs, stops) {
      var g = el(kind, Object.assign({ id: id }, attrs), d);
      stops.forEach(function (s) { el('stop', { offset: s[0], 'stop-color': s[1], 'stop-opacity': s[2] === undefined ? 1 : s[2] }, g); });
    }
    var bg = el('filter', { id: 'tw-bulbGlow', x: '-200%', y: '-200%', width: '500%', height: '500%' }, d);
    el('feGaussianBlur', { stdDeviation: 7 }, bg);
    var sg = el('filter', { id: 'tw-starGlow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, d);
    el('feGaussianBlur', { stdDeviation: 6, result: 'b' }, sg);
    var mg = el('feMerge', {}, sg);
    el('feMergeNode', { 'in': 'b' }, mg); el('feMergeNode', { 'in': 'SourceGraphic' }, mg);
    grad('linearGradient', 'tw-treeG', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#2f7a4a'], [1, '#14472b']]);
    grad('linearGradient', 'tw-moundG', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#dfe9f6'], [0.18, '#f4f8ff'], [1, '#f4f8ff']]);
    grad('linearGradient', 'tw-capG', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#e9d58a'], [1, '#a8892c']]);
    grad('linearGradient', 'tw-iceG', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#ffffff', 0.95], [0.6, '#bfe6ff', 0.85], [1, '#8ccfff', 0.7]]);
    grad('radialGradient', 'tw-ballG', { cx: 0.38, cy: 0.32 }, [[0, '#ffffff'], [0.7, '#eef4fb'], [1, '#bccde2']]);
    [['ornR', '#ff9a9a', '#d42a2a', '#6e0d0d'], ['ornG', '#fff1a8', '#e2ad1c', '#7a5506'],
     ['ornB', '#b6dcff', '#2a78d4', '#0d2f6e'], ['ornP', '#e4c4ff', '#8e4bb8', '#3b1656'],
     ['ornGr', '#b8f5cf', '#2ecc71', '#0e5a2c'], ['ornO', '#ffd2a8', '#ff8a1f', '#7a3a06']].forEach(function (c) {
      grad('radialGradient', 'tw-' + c[0], { cx: 0.35, cy: 0.3 }, [[0, c[1]], [0.5, c[2]], [1, c[3]]]);
    });
    TIER_D.forEach(function (p, i) { var cp = el('clipPath', { id: 'tw-tierClip' + i }, d); el('path', { d: p }, cp); });
  }

  function create(stage, opts) {
    opts = opts || {};
    var SK = root.SeasonKit;
    var tagsLayer = opts.tags || null;
    var hud = opts.hud || null;
    function tag(text, x, y, big) { if (SK && tagsLayer && text) SK.tag(tagsLayer, text, x, y, !!big); }

    // ── Ebenen: Deko unter Blitz-Aufhellung und Wetter-Partikeln, Effekte darüber ──
    var rootEl = document.createElement('div');
    rootEl.className = 'tw';
    rootEl.setAttribute('aria-hidden', 'true');
    rootEl.dataset.on = '0';
    rootEl.dataset.xmas = '0';
    var anchor = stage.querySelector('.wk-flash') || stage.querySelector('.wk-particles');
    if (anchor) stage.insertBefore(rootEl, anchor); else stage.appendChild(rootEl);
    var fxEl = document.createElement('div');
    fxEl.className = 'tw';
    fxEl.setAttribute('aria-hidden', 'true');
    fxEl.dataset.on = '0';
    stage.appendChild(fxEl);

    var defsSvg = el('svg', { 'class': 'tw-defs', width: 0, height: 0 }, rootEl);
    defs(defsSvg);
    var svg = el('svg', { 'class': 'tw-layer', viewBox: '0 0 1920 1080' }, rootEl);
    var fxCanvas = document.createElement('canvas');
    fxCanvas.width = W; fxCanvas.height = H;
    fxCanvas.className = 'tw-layer';
    fxEl.appendChild(fxCanvas);
    var fxSvg = el('svg', { 'class': 'tw-layer', viewBox: '0 0 1920 1080' }, fxEl);
    var parts = SK ? SK.Particles(fxCanvas, 700) : null;

    // Ebenen-Reihenfolge: Decke, Baum, Minis, Schneemann, Eiszapfen, Kugeln, Lichterkette
    var gCover = el('g', { 'class': 'tw-cover tw-dim' }, svg);
    var coverShade = el('path', { 'class': 'tw-cover-shade' }, gCover);
    var coverSnow = el('path', { 'class': 'tw-cover-snow' }, gCover);
    var gTreeWrap = el('g', { 'class': 'tw-x', transform: 'translate(' + TREE_X + ' ' + TREE_Y + ') scale(' + TREE_K + ')' }, svg);
    var gTreeShk = el('g', { 'class': 'tw-shk' }, gTreeWrap);
    var gMinis = el('g', { 'class': 'tw-minis tw-shk tw-dim' }, svg);
    var gSmPos = el('g', {}, svg);
    var gSm = el('g', { 'class': 'tw-sm tw-shk', 'data-head': '0', 'data-belly': '0' }, gSmPos);
    var gIce = el('g', { 'class': 'tw-ice tw-shk' }, svg);
    var gBaubleBox = el('g', { 'class': 'tw-x tw-baubles' }, svg);
    var gBaubles = el('g', { 'class': 'tw-shk' }, gBaubleBox);
    var gLightBox = el('g', { 'class': 'tw-x tw-lights' }, svg);
    var gLights = el('g', { 'class': 'tw-shk' }, gLightBox);

    // ── Glühbirnen ──
    var bulbIndex = 0;
    function bulb(parent, x, y, rot, size) {
      var g = el('g', {
        'class': 'tw-bulb k' + (1 + (bulbIndex % 5)) + ' ci-' + (bulbIndex % 10) + ' ri-' + Math.floor(rnd() * 10),
        transform: 'translate(' + f1(x) + ' ' + f1(y) + ') rotate(' + f1(rot) + ') scale(' + size + ')'
      }, parent);
      el('ellipse', { 'class': 'glow lit', cx: 0, cy: 18, rx: 14, ry: 16, opacity: 0.75 }, g);
      el('rect', { 'class': 'socket', x: -5, y: 0, width: 10, height: 9, rx: 2 }, g);
      el('path', { 'class': 'body lit', d: 'M0 8 C9 10 9 24 0 32 C-9 24 -9 10 0 8 Z' }, g);
      bulbIndex++;
      return g;
    }
    function stringAlong(parent, d, step, baseRot, size, small) {
      var path = el('path', { 'class': 'tw-wire' + (small ? ' tw-wire--small' : ''), d: d }, parent);
      if (!small) el('path', { 'class': 'tw-wire-snow', d: d }, parent);
      var len = path.getTotalLength(), out = [];
      for (var s = step / 2; s < len; s += step) {
        var p = path.getPointAtLength(s), q = path.getPointAtLength(Math.min(len, s + 1));
        var ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
        out.push(bulb(parent, p.x, p.y, baseRot + ang * 0.6 + (rnd() * 10 - 5), size));
      }
      return out;
    }

    // ── Lichterkette oben (Bögen mit Durchhang) ──
    seed = 7;
    var topD = 'M-10 6', sag = 74;
    for (var li = 0; li < 5; li++) {
      var x0 = -10 + li * 388;
      topD += ' Q' + (x0 + 194) + ' ' + (6 + sag * (li % 2 ? 0.85 : 1) + 10) + ' ' + (x0 + 388) + ' 6';
    }
    var topBulbs = stringAlong(gLights, topD, 52, 0, 1);

    // ── Hängende Kugeln ──
    BAUBLES.forEach(function (b) {
      var g = el('g', { 'class': 'tw-bauble' }, gBaubles);
      el('line', { 'class': 'tw-thread', x1: b[0], y1: -10, x2: b[0], y2: b[1] }, g);
      el('rect', { 'class': 'tw-bcap', x: b[0] - 8, y: b[1] - 4, width: 16, height: 10, rx: 3 }, g);
      el('circle', { cx: b[0], cy: b[1] + 36, r: 32, fill: 'url(#tw-' + b[2] + ')' }, g);
      el('ellipse', { cx: b[0] - 10, cy: b[1] + 24, rx: 6, ry: 4, fill: 'rgba(255,255,255,.7)' }, g);
      el('path', { 'class': 'tw-bsnow', d: 'M' + (b[0] - 22) + ' ' + (b[1] + 12) + ' Q' + b[0] + ' ' + (b[1] - 8) + ' ' + (b[0] + 22) + ' ' + (b[1] + 12) + ' Q' + b[0] + ' ' + (b[1] + 6) + ' ' + (b[0] - 22) + ' ' + (b[1] + 12) + ' Z' }, g);
    });

    // ── Baum ──
    var gTreeBox = el('g', { 'class': 'tw-treebox' }, gTreeShk);
    var gTree = el('g', {}, gTreeBox);
    var gTreeBody = el('g', { 'class': 'tw-dim' }, gTree);
    el('rect', { 'class': 'tw-trunk', x: 182, y: 405, width: 36, height: 112 }, gTreeBody);
    // Stufen von unten nach oben, Schnee jeweils direkt danach
    [0, 1, 2].forEach(function (i) {
      el('path', { 'class': 'tw-tree-g', d: TIER_D[i] }, gTreeBody);
      el('path', { 'class': 'tw-frost', d: TIER_D[i] }, gTreeBody);
      el('path', { 'class': 'tw-ridge-snow', 'clip-path': 'url(#tw-tierClip' + i + ')', d: TIER_RIDGE[i] }, gTreeBody);
      el('path', { 'class': 'tw-snowcap tw-snowcap--' + (3 - i), d: TIER_CAP[i] }, gTreeBody);
    });
    var treeBulbs = [];
    GARLANDS.forEach(function (d) {
      var p = el('path', { 'class': 'tw-garland', d: d }, gTree), len = p.getTotalLength();
      for (var s = 8; s < len; s += 22) {
        var pt = p.getPointAtLength(s);
        treeBulbs.push(bulb(gTree, pt.x, pt.y - 4, rnd() * 30 - 15, 0.42));
      }
    });
    var gFixedOrn = el('g', {}, gTree);
    FIXED.forEach(function (f) {
      var g = el('g', { 'class': 'tw-orn' }, gFixedOrn);
      el('line', { x1: f[0], y1: f[1] - 20, x2: f[0], y2: f[1] - 12, stroke: '#ccc' }, g);
      el('circle', { cx: f[0], cy: f[1], r: 13, fill: 'url(#tw-' + f[2] + ')' }, g);
    });
    var gOrns = el('g', {}, gTree);
    var gStar = el('g', { transform: 'translate(200 34)' }, gTree);
    el('path', { 'class': 'tw-star-rays', opacity: 0.55, d: 'M0 -62 L5 -8 L62 0 L5 8 L0 62 L-5 8 L-62 0 L-5 -8 Z' }, gStar);
    el('path', { 'class': 'tw-star', d: 'M0 -30 L8.8 -12 L28.5 -9.3 L14.3 4.6 L17.6 24.3 L0 15 L-17.6 24.3 L-14.3 4.6 L-28.5 -9.3 L-8.8 -12 Z' }, gStar);
    el('path', { 'class': 'tw-starhat', d: 'M-15 -20 Q-14 -38 0 -40 Q14 -38 15 -20 Q8 -25 0 -24 Q-8 -25 -15 -20 Z' }, gStar);
    // Schneehügel nach dem Baum: der Stamm steckt im Schnee, beim Aufbau
    // steigt der Baum hinter ihm hervor
    var gMoundBox = el('g', {}, gTreeShk);
    var mound = el('path', { 'class': 'tw-mound', d: 'M-80 540 Q-48 504 22 506 Q104 492 200 498 Q298 490 378 504 Q448 506 480 540 Z' }, gMoundBox);
    var gGiftBox = el('g', { 'class': 'tw-gifts' }, gTreeShk);
    var gGifts = el('g', {}, gGiftBox);
    var giftsBack = el('g', {}, gGifts), giftsFront = el('g', {}, gGifts);
    // Schneewehe vor Baum und Geschenken, steigt mit dem Schnee
    var gDriftBox = el('g', { 'class': 'tw-treebox' }, gTreeShk);
    el('path', { 'class': 'tw-drift', d: 'M-170 540 Q-120 470 -60 410 Q-10 318 50 316 Q120 292 200 305 Q280 288 350 316 Q410 318 460 410 Q520 470 570 540 Z' }, gDriftBox);
    var counterEl = el('text', { 'class': 'tw-counter', x: 200, y: 536, 'text-anchor': 'middle' }, gTreeShk);

    // Oberkante des Hügels je x (Baum-Koordinaten), damit kein Geschenk schwebt
    var groundY = (function () {
      var len = mound.getTotalLength(), top = {};
      for (var d = 0; d <= len; d += 1) {
        var pt = mound.getPointAtLength(d), bx = Math.round(pt.x);
        if (pt.y < 539 && (top[bx] === undefined || pt.y < top[bx])) top[bx] = pt.y;
      }
      return function (x) {
        for (var off = 0; off < 40; off++) {
          var b = Math.round(x);
          if (top[b + off] !== undefined) return top[b + off];
          if (top[b - off] !== undefined) return top[b - off];
        }
        return 520;
      };
    })();

    // ── Eiszapfen ──
    var gIcicles = el('g', {}, gIce);
    var ridgeShade = el('path', { 'class': 'tw-ridge-shade' }, gIce);
    var ridge = el('path', { 'class': 'tw-ridge' }, gIce);
    seed = 19;
    var icicles = [];
    for (var ix = 14; ix < W; ix += 34 + rnd() * 26) {
      icicles.push({ x: ix, w: 7 + rnd() * 8, max: 30 + rnd() * 110, grow: 1, tip: 0, node: el('path', { 'class': 'tw-ice-i' }, gIcicles) });
    }

    // ── Schneemann: 8 Teile, eins pro Sub; Xmas: Mütze + Lichterkette ──
    var gSmBody = el('g', { 'class': 'tw-sm-body tw-dim' }, gSm);
    var smParts = [];
    function smPart(step, build, cls) {
      var g = el('g', { 'class': 'tw-sm-part' + (cls ? ' ' + cls : ''), 'data-step': step }, gSmBody);
      build(g);
      smParts.push(g);
    }
    smPart(1, function (g) { el('circle', { 'class': 'tw-sm-ball', cx: 0, cy: -70, r: 74 }, g); });
    smPart(2, function (g) { el('circle', { 'class': 'tw-sm-ball', cx: 0, cy: -180, r: 54 }, g); });
    smPart(3, function (g) { el('circle', { 'class': 'tw-sm-ball', cx: 0, cy: -262, r: 40 }, g); });
    smPart(4, function (g) {
      el('circle', { 'class': 'tw-sm-coal', cx: -14, cy: -272, r: 5 }, g);
      el('circle', { 'class': 'tw-sm-coal', cx: 14, cy: -272, r: 5 }, g);
      [-16, -8, 0, 8, 16].forEach(function (dx, i) { el('circle', { 'class': 'tw-sm-coal', cx: dx, cy: -246 - Math.abs(i - 2) * 3, r: 3 }, g); });
    });
    smPart(5, function (g) { el('path', { 'class': 'tw-sm-nose', d: 'M-2 -266 L40 -258 L-2 -254 Z' }, g); });
    smPart(6, function (g) {
      [-200, -176, -152].forEach(function (y) { el('circle', { 'class': 'tw-sm-coal', cx: 0, cy: y, r: 6 }, g); });
      el('path', { 'class': 'tw-sm-arm', d: 'M-48 -190 L-118 -236 M-96 -222 L-112 -252' }, g);
      var r = el('g', { 'class': 'tw-sm-armr' }, g);
      el('path', { 'class': 'tw-sm-arm', d: 'M48 -190 L118 -236 M96 -222 L114 -250' }, r);
    });
    smPart(7, function (g) {
      el('path', { 'class': 'tw-sm-scarf', d: 'M-42 -232 Q0 -214 42 -232 L44 -218 Q0 -200 -44 -218 Z' }, g);
      el('path', { 'class': 'tw-sm-scarf', d: 'M18 -222 L32 -168 L16 -166 L8 -220 Z' }, g);
      el('rect', { 'class': 'tw-sm-scarf2', x: 18, y: -190, width: 14, height: 6, transform: 'rotate(14 25 -187)' }, g);
    });
    smPart(8, function (g) {
      var h = el('g', { 'class': 'tw-sm-hatg' }, g);
      el('rect', { 'class': 'tw-sm-hat', x: -44, y: -300, width: 88, height: 10, rx: 4 }, h);
      el('rect', { 'class': 'tw-sm-hat', x: -30, y: -362, width: 60, height: 64, rx: 6 }, h);
      el('rect', { 'class': 'tw-sm-band', x: -30, y: -312, width: 60, height: 10 }, h);
    }, 'tw-sm-tophat');
    // Lichterkette um Bauch und Sockel (ab Bauch), Mütze (ab Kopf)
    var gSmLights = el('g', { 'class': 'tw-sm-xmas tw-sm-lights' }, gSmBody);
    seed = 29;
    stringAlong(gSmLights, 'M-50 -206 Q-6 -150 52 -168', 15, 0, 0.36, true);
    stringAlong(gSmLights, 'M-68 -112 Q0 -50 70 -96', 17, 0, 0.4, true);
    var gSanta = el('g', { 'class': 'tw-sm-xmas tw-sm-santa' }, gSmBody);
    el('path', { 'class': 'tw-santa-red', d: 'M-38 -296 C-34 -346 6 -384 62 -352 L54 -338 C24 -352 8 -336 38 -296 Z' }, gSanta);
    el('rect', { 'class': 'tw-santa-white', x: -44, y: -304, width: 88, height: 16, rx: 8 }, gSanta);
    el('circle', { 'class': 'tw-santa-white', cx: 60, cy: -340, r: 10 }, gSanta);

    // ── Effekt-Zeichner (Canvas) ──
    function flake(ctx, p, a) {
      ctx.globalAlpha = a * 0.9; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
    }
    function shard(ctx, p, a) {
      ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = 'rgba(200,235,255,.95)';
      ctx.beginPath(); ctx.moveTo(-p.r, 0); ctx.lineTo(0, -p.r * 2.4); ctx.lineTo(p.r, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    function drop(ctx, p, a) {
      ctx.globalAlpha = a; ctx.fillStyle = '#bfe6ff';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 2.2, 4, 0, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
    }
    function spark(ctx, p, a) {
      ctx.globalAlpha = a; ctx.fillStyle = '#fff6c8';
      var r = 2 + 2 * Math.abs(Math.sin(p.age * 9));
      ctx.fillRect(p.x - r, p.y - 0.7, r * 2, 1.4); ctx.fillRect(p.x - 0.7, p.y - r, 1.4, r * 2);
      ctx.globalAlpha = 1;
    }
    function addP(p) { if (parts) parts.add(p); }

    // ── HUD: Gruppen-Fortschritt und Rangliste ──
    var groupBox = null, groupText = null, boardBox = null, boardTitle = null, boardList = null;
    if (hud) {
      groupBox = document.createElement('div');
      groupBox.className = 'hud__box hud__group';
      groupText = document.createElement('span');
      groupBox.appendChild(groupText);
      var bar = document.createElement('div');
      bar.className = 'hud__bar';
      groupBox.appendChild(bar);
      hud.appendChild(groupBox);
      boardBox = document.createElement('div');
      boardBox.className = 'hud__box';
      boardTitle = document.createElement('h2');
      boardList = document.createElement('ol');
      boardBox.appendChild(boardTitle); boardBox.appendChild(boardList);
      hud.appendChild(boardBox);
    }
    var boardTimer = null, groupTimer = null;
    function showBoard(title, rows) {
      if (!boardBox) return;
      boardTitle.textContent = title;
      clear(boardList);
      rows = rows && rows.length ? rows.slice(0, 5) : [['Nobody yet', 0]];
      rows.forEach(function (e, i) {
        var li = document.createElement('li');
        var a = document.createElement('span'), b = document.createElement('span');
        a.textContent = (i + 1) + '. ' + e[0];
        b.textContent = e[1] + '×';
        li.appendChild(a); li.appendChild(b); boardList.appendChild(li);
      });
      boardBox.classList.remove('is-on'); void boardBox.offsetWidth; boardBox.classList.add('is-on');
      clearTimeout(boardTimer);
      boardTimer = setTimeout(function () { boardBox.classList.remove('is-on'); }, 10000);
    }

    // ── Zustand ──
    var S = {
      on: false, xmas: 'off', target: 0, shown: 0, first: true, heatT: 0, heat: 0, night: 0,
      snowTop: [], sm: 0, partsOn: {}
    };
    var override = null;          // nach Aufbau/Abschied bis der Server nachzieht
    var anim = null;              // laufende Aufbau-/Abschied-Animation
    var orns = [], ornNext = 0, ornTotal = 0;
    var gifts = [], giftNext = 0, giftTotal = 0, giftLog = [];
    var minis = [], miniNext = 0, miniTotal = 0;
    var SLOTS = makeSlots();

    function updateCounter() {
      var p = [];
      if (ornTotal) p.push(ornTotal + (ornTotal === 1 ? ' ornament' : ' ornaments'));
      if (giftTotal) p.push(giftTotal + (giftTotal === 1 ? ' gift' : ' gifts'));
      counterEl.textContent = p.join(' · ');
    }
    function surface(x) { return H - coverH(x, S.shown / 100); }
    function xmasShown() { return rootEl.dataset.xmas === '1'; }
    function partOn(k) { return S.partsOn[k] !== false; }

    function addOrnament(name, animate) {
      var i = ornNext % SLOTS.length, s = SLOTS[i];
      if (orns[i]) gOrns.removeChild(orns[i].outer);
      var outer = el('g', {}, gOrns);
      var g = el('g', { 'class': 'tw-orn' + (animate ? ' tw-orn--new' : '') }, outer);
      el('line', { x1: f1(s[0]), y1: f1(s[1] - 13), x2: f1(s[0]), y2: f1(s[1] - 6), stroke: '#ccc' }, g);
      el('circle', { cx: f1(s[0]), cy: f1(s[1] + 4), r: 10, fill: 'url(#tw-' + GRADS[ornNext % GRADS.length] + ')' }, g);
      orns[i] = { outer: outer, inner: g, label: name, x: s[0], y: s[1], order: ornNext };
      ornNext++;
      if (animate && xmasShown() && partOn('tree')) { var p = treeToScreen(s[0], s[1] - 16); tag(name, p[0], p[1]); }
    }
    function addGift(gift, animate) {
      var i = giftNext % GIFT_SLOTS.length, slot = GIFT_SLOTS[i];
      if (gifts[i]) gifts[i].outer.parentNode.removeChild(gifts[i].outer);
      var look = GIFT_LOOK[gift.type] || GIFT_LOOK.sub;
      var k = giftScale(gift.type, gift.amount), w = look.w * k, h = look.h * k;
      var baseY = groundY(slot[0]) + (slot[1] ? 16 : 4);
      var outer = el('g', {}, slot[1] ? giftsFront : giftsBack);
      var pos = el('g', { transform: 'translate(' + slot[0] + ' ' + f1(baseY) + ')' }, outer);
      var g = el('g', { 'class': 'tw-gift' + (animate ? ' tw-gift--new' : '') }, pos);
      el('rect', { x: f1(-w / 2), y: f1(-h), width: f1(w), height: f1(h), rx: 3, fill: look.box }, g);
      el('rect', { x: f1(-w / 2), y: f1(-h), width: f1(w), height: f1(h * 0.18), fill: 'rgba(255,255,255,.12)' }, g);
      el('rect', { x: f1(-4 * k), y: f1(-h), width: f1(8 * k), height: f1(h), fill: look.rib }, g);
      el('rect', { x: f1(-w / 2), y: f1(-h * 0.58), width: f1(w), height: f1(7 * k), fill: look.rib }, g);
      el('rect', { 'class': 'tw-gsnow', x: f1(-w / 2 - 1), y: f1(-h - 7 * k), width: f1(w + 2), height: f1(9 * k), rx: 4 }, g);
      el('ellipse', { cx: f1(-9 * k), cy: f1(-h - 5 * k), rx: f1(10 * k), ry: f1(6 * k), fill: look.rib, transform: 'rotate(-25 ' + f1(-9 * k) + ' ' + f1(-h - 5 * k) + ')' }, g);
      el('ellipse', { cx: f1(9 * k), cy: f1(-h - 5 * k), rx: f1(10 * k), ry: f1(6 * k), fill: look.rib, transform: 'rotate(25 ' + f1(9 * k) + ' ' + f1(-h - 5 * k) + ')' }, g);
      el('circle', { cx: 0, cy: f1(-h - 3 * k), r: f1(4 * k), fill: look.rib }, g);
      var label = giftLabel(gift);
      gifts[i] = { outer: outer, inner: g, label: label, x: slot[0], y: baseY - h - 18 * k, order: giftNext };
      giftNext++;
      if (gift.name) giftLog.push(gift.name);
      if (animate && xmasShown() && partOn('gifts')) { var p = treeToScreen(slot[0], baseY - h - 18 * k); tag(label, p[0], p[1]); }
    }
    function addMini(name, animate) {
      var i = miniNext % MINI_SLOTS.length, slot = MINI_SLOTS[i];
      if (minis[i]) minis[i].outer.parentNode.removeChild(minis[i].outer);
      // nach Tiefe einsortieren: wer höher steht (weiter hinten), liegt dahinter
      var outer = el('g', {}), before = null;
      outer.twDy = slot[2];
      for (var c = gMinis.firstChild; c; c = c.nextSibling) if (c !== outer && c.twDy > slot[2]) { before = c; break; }
      gMinis.insertBefore(outer, before);
      var g = el('g', { 'class': 'tw-mini' + (animate ? ' tw-mini--new' : '') }, outer);
      el('circle', { 'class': 'tw-mini__ball', cx: 0, cy: -20, r: 22 }, g);
      el('circle', { 'class': 'tw-mini__ball', cx: 0, cy: -54, r: 15 }, g);
      el('circle', { 'class': 'tw-sm-coal', cx: -5, cy: -57, r: 2.4 }, g);
      el('circle', { 'class': 'tw-sm-coal', cx: 5, cy: -57, r: 2.4 }, g);
      el('path', { 'class': 'tw-sm-nose', d: 'M0 -53 L14 -50 L0 -48 Z' }, g);
      el('path', { 'class': 'tw-mini__hat' + (1 + i % 4), d: 'M-16 -64 Q0 -98 16 -64 Z' }, g);
      el('circle', { 'class': 'tw-mini__pom', cx: 0, cy: -83, r: 5 }, g);
      // Schneehügel vor dem Mini (Sturm, Lawine)
      var mound = el('path', { 'class': 'tw-mini__mound' }, outer);
      minis[i] = { outer: outer, inner: g, mound: mound, x: slot[0], k: slot[1], dy: slot[2], rot: slot[3], label: name,
                   bz: 0, av: 0, avAt: null, avHold: 0, wait: null, shown: -1 };
      miniNext++;
      placeMini(minis[i]);
      if (animate && S.on && partOn('minis')) tag(name, slot[0], miniTop(minis[i]));
    }
    function miniTop(m) { return surface(m.x) + m.dy - 110 * m.k; }
    function placeMini(m) {
      m.outer.setAttribute('transform', 'translate(' + m.x + ' ' + f1(surface(m.x) + m.dy) + ') rotate(' + m.rot +
                           ') scale(' + m.k + ')');
    }
    function placeSnowman() {
      gSmPos.setAttribute('transform', 'translate(' + SM_X + ' ' + f1(surface(SM_X) + 26) + ') scale(' + SM_K + ')');
    }
    function showSnowman(animateStep) {
      smParts.forEach(function (g) {
        var st = +g.getAttribute('data-step');
        g.classList.toggle('is-on', st <= S.sm);
        g.classList.toggle('is-new', st === animateStep);
      });
      gSm.setAttribute('data-head', S.sm >= 3 ? '1' : '0');
      gSm.setAttribute('data-belly', S.sm >= 2 ? '1' : '0');
    }
    function smTop() { return surface(SM_X) + 26 - 380 * SM_K; }

    function drawCover() {
      var s = S.shown / 100, d = 'M0 ' + H, ds = 'M0 ' + H;
      for (var x = 0; x <= W; x += 20) {
        var h = coverH(x, s);
        d += ' L' + x + ' ' + f1(H - h);
        ds += ' L' + x + ' ' + f1(H - h - 6);
      }
      coverSnow.setAttribute('d', d + ' L' + W + ' ' + H + ' Z');
      coverShade.setAttribute('d', ds + ' L' + W + ' ' + H + ' Z');
    }
    function drawIce() {
      var s = S.shown / 100, d = 'M0 0', ds = 'M0 0';
      for (var x = 0; x <= W; x += 16) {
        d += ' L' + x + ' ' + f1(ridgeY(x, s));
        ds += ' L' + x + ' ' + f1(ridgeY(x, s) + 5);
      }
      ridge.setAttribute('d', d + ' L' + W + ' 0 Z');
      ridgeShade.setAttribute('d', ds + ' L' + W + ' 0 Z');
      icicles.forEach(function (ic) {
        var len = ic.max * clamp01(s / 0.7) * ic.grow;     // bei 70 % Schnee voll
        var top = ridgeY(ic.x, s) - 2;
        ic.tip = top + len;
        ic.node.setAttribute('d', len < 2 ? '' :
          'M' + f1(ic.x - ic.w) + ' ' + f1(top) +
          ' Q' + f1(ic.x - ic.w * 0.3) + ' ' + f1(top + len * 0.5) + ' ' + f1(ic.x) + ' ' + f1(top + len) +
          ' Q' + f1(ic.x + ic.w * 0.3) + ' ' + f1(top + len * 0.5) + ' ' + f1(ic.x + ic.w) + ' ' + f1(top) + ' Z');
      });
    }
    var lastVars = '';
    function applySnowVars() {
      var s = S.shown / 100;
      var vars = [['--tw-snow', s], ['--tw-light', clamp01(s / 0.08)], ['--tw-cap', clamp01((s - 0.08) / 0.35)],
                  ['--tw-hat', clamp01((s - 0.6) / 0.25)], ['--tw-drift', 0.3 * clamp01((s - 0.4) / 0.6)],
                  ['--tw-melt', S.heat], ['--tw-night', S.night]];
      var sig = vars.map(function (v) { return v[1].toFixed(3); }).join('|');
      if (sig === lastVars) return;
      lastVars = sig;
      vars.forEach(function (v) { rootEl.style.setProperty(v[0], v[1].toFixed(3)); });
    }

    // ── Sichtbarkeit der Xmas-Teile ──
    function xmasWanted() {
      if (anim) return true;
      if (override) return override.vis;
      return S.xmas === 'on' || S.xmas === 'farewell';
    }
    function resetAnimAttrs() {
      [gTree, gMoundBox, gGifts, gBaubles, gLights, counterEl].forEach(function (n) { n.removeAttribute('transform'); n.removeAttribute('opacity'); });
      orns.forEach(function (o) { if (o) { o.outer.removeAttribute('transform'); o.outer.removeAttribute('opacity'); } });
      gifts.forEach(function (g) { if (g) { g.outer.removeAttribute('transform'); g.outer.removeAttribute('opacity'); } });
      topBulbs.concat(treeBulbs).forEach(function (b) { b.classList.remove('is-off'); });
    }
    function syncXmas() {
      var want = S.on && xmasWanted();
      if (want && !xmasShown() && !anim) resetAnimAttrs();
      rootEl.dataset.xmas = want ? '1' : '0';
      syncMinis();
    }

    // ── Aufbau / Abschied ──
    function orderedOrns() { return orns.filter(Boolean).sort(function (a, b) { return a.order - b.order; }); }
    function orderedGifts() { return gifts.filter(Boolean).sort(function (a, b) { return a.order - b.order; }); }
    function lightAt(list, t, t0, span, reverse) {
      var n = list.length;
      list.forEach(function (b, i) {
        var at = t0 + span * (reverse ? (n - 1 - i) : i) / Math.max(1, n);
        var lit = reverse ? t < at : t >= at;
        b.classList.toggle('is-off', !lit);
      });
    }
    function setTo(node, dx, dy, op) {
      if (reduceMotion) { dx = 0; dy = 0; }
      node.setAttribute('transform', 'translate(' + f1(dx) + ' ' + f1(dy) + ')');
      node.setAttribute('opacity', clamp01(op).toFixed(3));
    }
    function renderSetup(t) {
      var k = ease(t / 2.5);
      setTo(gTree, 0, (1 - k) * 280, k);
      setTo(gMoundBox, 0, 0, t / 1.2);
      setTo(gLights, 0, 0, t / 1.2);
      lightAt(topBulbs.concat(treeBulbs), t, 2, 2.6, false);
      var kb = ease((t - 3) / 1.5);
      setTo(gBaubles, 0, -(1 - kb) * 460, kb);
      var os = anim.orns, n = os.length;
      os.forEach(function (o, i) {
        var st = 4.5 + 3.6 * i / Math.max(1, n), ko = clamp01((t - st) / 0.5);
        setTo(o.outer, 0, -(1 - outBack(ko)) * 40, ko);
      });
      var gs = anim.gifts, m = gs.length;
      gs.forEach(function (g, j) {
        var st = 7.4 + 1.5 * j / Math.max(1, m), kg = ease((t - st) / 0.8);
        setTo(g.outer, (1 - kg) * 520, 0, kg);
      });
      counterEl.setAttribute('opacity', clamp01((t - 9) / 0.8).toFixed(3));
    }
    function renderFarewell(t) {
      var os = anim.orns, n = os.length;
      os.forEach(function (o, i) {
        var st = 0.3 + 3.8 * i / Math.max(1, n), kf = clamp01((t - st) / 1.2);
        var fall = Math.max(30, 505 - o.y);
        setTo(o.outer, o.dx * kf, outBounce(kf) * fall, 1 - clamp01((kf - 0.65) / 0.35));
      });
      lightAt(topBulbs.concat(treeBulbs), t, 4.3, 2, true);
      setTo(gLights, 0, 0, 1 - clamp01((t - 7.5) / 1.5));
      var kb = ease((t - 5.2) / 1.5);
      setTo(gBaubles, 0, -kb * 460, 1 - kb);
      var kg = ease((t - 6.6) / 1.8);
      anim.gifts.forEach(function (g, j) {
        var st = 6.6 + 1.2 * j / Math.max(1, anim.gifts.length), kk = ease((t - st) / 0.9);
        setTo(g.outer, kk * 520, 0, 1 - kk);
      });
      var kt = ease((t - 6.4) / 2.2);
      setTo(gTree, 0, kt * 280, 1 - kt);
      setTo(gMoundBox, 0, 0, 1 - clamp01((t - 7.8) / 1));
      counterEl.setAttribute('opacity', (1 - kg).toFixed(3));
      if (!anim.board && t >= 9) {
        anim.board = true;
        showBoard('Top gifters', giftTop());
      }
    }
    function giftTop() {
      var by = {};
      giftLog.forEach(function (n) { var k = n.toLowerCase(); by[k] = by[k] || [n, 0]; by[k][1]++; });
      return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b[1] - a[1]; });
    }
    function startAnim(type, done) {
      if (anim) finishAnim();
      override = null;
      anim = { type: type, t: 0, dur: type === 'setup' ? 10 : 10.5, done: done,
               orns: orderedOrns(), gifts: orderedGifts() };
      if (type === 'farewell') {
        anim.orns.reverse();           // neueste fallen zuerst
        anim.orns.forEach(function (o) { o.dx = rand(-25, 25); });
        resetAnimAttrs();
      }
      (type === 'setup' ? renderSetup : renderFarewell)(0);
      rootEl.dataset.xmas = S.on ? '1' : '0';
    }
    function finishAnim() {
      var a = anim;
      anim = null;
      if (a.type === 'setup') {
        resetAnimAttrs();
        override = { vis: true, stale: S.xmas };
      } else {
        if (!a.board) showBoard('Top gifters', giftTop());
        override = { vis: false, stale: S.xmas };
      }
      syncXmas();
      if (typeof a.done === 'function') a.done();
    }

    // ── Animationen zu den Befehlen ──
    var celebrateTimer = null;
    function celebrate(name) {
      rootEl.dataset.celebrate = '0';
      void rootEl.getBoundingClientRect();
      rootEl.dataset.celebrate = '1';
      clearTimeout(celebrateTimer);
      celebrateTimer = setTimeout(function () { rootEl.dataset.celebrate = '0'; }, 4000);
      [[0, 1], [W, -1]].forEach(function (c) {
        for (var i = 0; i < 60; i++) {
          addP({ x: c[0] + c[1] * rand(0, 160), y: H - rand(20, 120), vx: c[1] * rand(250, 650), vy: rand(-1150, -650),
                 term: 70, sway: rand(10, 30), r: rand(2, 6), life: 4, draw: i % 4 ? flake : spark });
        }
      });
      if (name) tag('Thank you, ' + name + '!', W / 2, 300, true);
    }
    function shakeClass(cls, ms) {
      rootEl.classList.remove('is-shakeoff', 'is-wobble');
      void rootEl.getBoundingClientRect();
      rootEl.classList.add(cls);
      setTimeout(function () { rootEl.classList.remove(cls); }, ms);
    }
    function shovelSpot() {
      var left = Math.random() < 0.5;
      // rechts steht in der Xmas-Zeit der Baum, dann eher links schippen
      if (!left && xmasShown() && partOn('tree') && Math.random() < 0.6) left = true;
      var x = left ? rand(380, 700) : rand(1100, 1420);
      return [x, surface(x) + 4];
    }
    function shovelAt(x, y) {
      var outer = el('g', { transform: 'translate(' + f1(x) + ' ' + f1(y) + ')' }, fxSvg);
      var g = el('g', { 'class': 'tw-shovel' }, outer);
      el('line', { 'class': 'tw-shovel__stick', x1: 34, y1: -70, x2: 8, y2: -12 }, g);
      el('rect', { 'class': 'tw-shovel__grip', x: 26, y: -82, width: 18, height: 8, rx: 3, transform: 'rotate(24 35 -78)' }, g);
      el('path', { 'class': 'tw-shovel__blade', d: 'M-12 -18 L18 -6 L12 14 Q-4 20 -18 8 Z' }, g);
      setTimeout(function () { if (outer.parentNode) fxSvg.removeChild(outer); }, reduceMotion ? 600 : 1000);
    }
    function shovel(p) {
      var name = p.name || 'Someone', done = parseFloat(p.done) || 0;
      var sp = shovelSpot();
      if (!(done > 0)) { tag(name + ': nothing to shovel', sp[0], sp[1] - 70, true); return; }
      if (p.level !== undefined && !isNaN(parseFloat(p.level))) S.target = Math.max(0, Math.min(100, parseFloat(p.level)));
      shovelAt(sp[0], sp[1]);
      var dir = sp[0] < W / 2 ? 1 : -1;
      setTimeout(function () {
        for (var i = 0; i < 24; i++) {
          addP({ x: sp[0] + rand(-30, 30), y: sp[1] - 6, vx: dir * rand(120, 380), vy: rand(-700, -350),
                 term: 500, sway: 0, r: rand(4, 10), life: 1.6, draw: flake });
        }
      }, reduceMotion ? 0 : 420);
      tag(name + ' shoveled!', sp[0], sp[1] - 90, true);
    }
    function shake(p) {
      var name = p.name || '';
      if (p.idle === true || p.idle === 'true' || p.idle === 1) {
        tag((name || 'Someone') + ': no snow to shake off', W / 2, 300, true);
        return;
      }
      var count = parseInt(p.count, 10) || 0, need = parseInt(p.need, 10) || 5;
      var success = p.success === true || p.success === 'true' || p.success === 1;
      if (groupBox) {
        groupBox.classList.add('is-on');
        clearTimeout(groupTimer);
      }
      if (success) {
        if (groupText) groupText.textContent = 'Shaken off!';
        if (groupBox) groupBox.style.setProperty('--hudp', '1');
        S.target = 0;
        shakeClass('is-shakeoff', 1200);
        for (var i = 0; i < 90; i++) {
          var x = rand(60, W - 60);
          addP({ x: x, y: surface(x), vx: rand(-200, 200), vy: rand(-800, -300), term: 500, sway: 0, r: rand(4, 10), life: 1.8, draw: flake });
        }
        if (xmasShown()) {
          for (var j = 0; j < 30; j++) {
            var q = treeToScreen(rand(60, 340), rand(150, 420));
            addP({ x: q[0], y: q[1], vx: rand(-80, 80), vy: rand(0, 80), term: 600, sway: 0, r: rand(3, 8), floor: surface, draw: flake });
          }
        }
        tag('Shaken off!' + (name ? ' Thanks, ' + name : ''), W / 2, 300, true);
        groupTimer = setTimeout(function () { if (groupBox) groupBox.classList.remove('is-on'); }, 3000);
      } else {
        if (groupText) groupText.textContent = 'Shake it off! ' + count + '/' + need;
        if (groupBox) groupBox.style.setProperty('--hudp', clamp01(count / need).toFixed(3));
        shakeClass('is-wobble', 600);
        for (var k = 0; k < 10; k++) {
          var xx = rand(100, W - 100);
          addP({ x: xx, y: rand(10, 40), vx: rand(-40, 40), vy: rand(20, 80), term: 300, sway: 10, r: rand(2, 5), floor: surface, draw: flake });
        }
        var win = parseFloat(p.win) || 20;
        groupTimer = setTimeout(function () { if (groupBox) groupBox.classList.remove('is-on'); }, win * 1000);
      }
    }
    function icicle(p) {
      var name = p.name || 'Someone';
      var cand = icicles.filter(function (ic) { return ic.tip > 40; });
      if (!(parseFloat(p.done) > 0) || !cand.length || !partOn('icicles')) {
        tag(name + ': no icicles yet', W / 2, 260, true);
        return;
      }
      var ic = cand[Math.floor(Math.random() * cand.length)], len = ic.tip;
      for (var i = 0; i < 14; i++) {
        addP({ x: ic.x + rand(-ic.w, ic.w), y: rand(20, len), vx: rand(-60, 60), vy: rand(0, 120), g: 1400, term: 900,
               sway: 0, vr: rand(-6, 6), r: rand(3, ic.w), floor: surface, draw: shard });
      }
      ic.grow = 0;
      tag(name + ' broke an icicle!', ic.x, len + 60, true);
    }
    function snowball(name) {
      var tx = rand(500, 1420), ty = rand(300, 700), sx = rand(300, 1620), sy = H + 40;
      tag((name || 'Someone') + ' threw a snowball!', tx, ty - 110, true);
      var ball = el('circle', { 'class': 'tw-ball', r: 10 }, fxSvg);
      var t0 = performance.now(), dur = reduceMotion ? 1 : 650;
      function hit() {
        if (ball.parentNode) fxSvg.removeChild(ball);
        var outer = el('g', { transform: 'translate(' + f1(tx) + ' ' + f1(ty) + ')' }, fxSvg);
        var g = el('g', { 'class': 'tw-splat-g' }, outer);
        var d = 'M0 -60';
        for (var a = 0; a <= 16; a++) {
          var ang = a / 16 * Math.PI * 2 - Math.PI / 2, rr = 46 + (a % 2 ? 14 : 30) * Math.random();
          d += ' L' + f1(Math.cos(ang) * rr) + ' ' + f1(Math.sin(ang) * rr);
        }
        el('path', { 'class': 'tw-splat', d: d + ' Z' }, g);
        el('path', { 'class': 'tw-splat', d: 'M-20 30 Q-18 90 -12 92 Q-6 90 -6 30 Z M14 34 Q16 70 20 72 Q26 70 26 34 Z' }, g);
        setTimeout(function () { if (outer.parentNode) fxSvg.removeChild(outer); }, reduceMotion ? 2500 : 5100);
        for (var i = 0; i < 16; i++) addP({ x: tx, y: ty, vx: rand(-360, 360), vy: rand(-420, 120), term: 600, sway: 0, r: rand(3, 7), life: 0.9, draw: flake });
      }
      // Flugbahn per Zeitgeber, damit sie auch ohne sichtbares Bild zu Ende läuft
      (function step() {
        var k = Math.min(1, (performance.now() - t0) / dur);
        ball.setAttribute('cx', f1(sx + (tx - sx) * k));
        ball.setAttribute('cy', f1(sy + (ty - sy) * k - Math.sin(k * Math.PI) * 180));
        ball.setAttribute('r', f1(10 + k * 34));
        if (k < 1) root.requestAnimationFrame(step); else hit();
      })();
    }
    // Bau-Schritt; unsichtbar nur Stand nachziehen (gemeinsames Sub-Projekt)
    var smClearTimer = null;
    function build(name, visible) {
      clearTimeout(smClearTimer);
      gSm.classList.remove('is-clearing');
      var done = S.sm < 8;
      S.sm = Math.min(8, S.sm + 1);
      showSnowman(done && visible ? S.sm : 0);
      if (!visible) return;
      var y = smTop() - 40;
      if (!done) { tag('Snowman is finished!', SM_X, y, true); return; }
      tag((name || 'Someone') + ' added ' + PART_NAMES[S.sm] + '!', SM_X, y, true);
      if (S.sm === 8) {
        gSm.classList.remove('is-done'); void gSm.getBoundingClientRect(); gSm.classList.add('is-done');
        celebrate('');
      }
    }

    function resetSnowman(visible) {
      clearTimeout(smClearTimer);
      if (!visible || reduceMotion || !S.sm) { S.sm = 0; gSm.classList.remove('is-clearing'); showSnowman(0); return; }
      gSm.classList.add('is-clearing');
      smClearTimer = setTimeout(function () { S.sm = 0; showSnowman(0); gSm.classList.remove('is-clearing'); }, 700);
    }
    // Follow: in der Xmas-Zeit Kugel am Baum, sonst Mini-Schneemann; die
    // jeweils andere Form still mitführen, damit beide Listen stimmen
    function follow(name) {
      var xm = xmasWanted() && !(anim && anim.type === 'farewell');
      addOrnament(name, xm && S.on);
      addMini(name, !xm && S.on);
      ornTotal++; miniTotal++;
      updateCounter();
    }
    // Minis verschwinden, sobald der Baum steht, und kommen nach dem Abschied wieder
    function minisHidden() {
      if (anim) return anim.type === 'setup' ? anim.t >= 2.5 : anim.t < 7.6;
      return xmasShown();
    }
    function syncMinis() {
      var v = minisHidden() ? '1' : '0';
      if (rootEl.dataset.hidemini !== v) rootEl.dataset.hidemini = v;
    }

    // ── Einschneien: Schneesturm (bis zum Hut) und Lawine (ganz begraben) ──
    // b = Hügelhöhe in Mini-Einheiten: 1 = bis unter den Hut, 1,45 = ganz bedeckt
    var aval = null;
    function moundPath(b) {
      var h = 68 * b, w = 24 + 16 * Math.min(1, b) + 12 * Math.max(0, b - 1);
      return 'M' + f1(-w - 14) + ' 14 Q' + f1(-w) + ' ' + f1(-h * 0.95) + ' 0 ' + f1(-h) +
             ' Q' + f1(w) + ' ' + f1(-h * 0.95) + ' ' + f1(w + 14) + ' 14 Z';
    }
    function renderMound(m) {
      var b = Math.max(m.bz, m.av);
      if (Math.abs(b - m.shown) < 0.004) return;
      m.shown = b;
      m.mound.setAttribute('d', b < 0.02 ? '' : moundPath(b));
    }
    function digPuff(m) {
      var base = surface(m.x) + m.dy;
      for (var i = 0; i < 12; i++) {
        addP({ x: m.x + rand(-20, 20) * m.k, y: base - rand(20, 70) * m.k, vx: rand(-220, 220), vy: rand(-420, -150),
               term: 500, sway: 0, r: rand(2, 5), life: 1.2, floor: surface, draw: flake });
      }
    }
    function stepMinis(dt) {
      var visible = S.on && partOn('minis') && !minisHidden();
      var bzNow = visible && opts.blizzard ? clamp01(opts.blizzard()) : 0;
      var av = visible ? aval : null;
      var avT = av ? av.elapsed() : 0, avLive = av && av.active();
      minis.forEach(function (m) {
        if (!m) return;
        if (!visible) { m.bz = 0; m.av = 0; m.avAt = null; m.wait = null; renderMound(m); return; }
        // Sturm: wächst mit dem Sturm, nach dem Sturm gestaffelt freigraben (~1 min)
        var want = 0.98 * bzNow;
        if (reduceMotion) m.bz = want;
        else if (want >= m.bz - 0.005) { m.wait = null; m.bz += Math.min(want - m.bz, dt * (0.01 + want / 35)); }
        else {
          if (m.wait === null) m.wait = rand(0, 25);
          if (m.wait > 0) { m.wait -= dt; if (m.wait <= 0 && m.bz > 0.3) digPuff(m); }
          else m.bz = Math.max(want, m.bz - dt / 35);
        }
        // Lawine: begräbt die Minis auf der Aufprall-Seite, kurz danach graben sie sich aus
        if (m.avAt !== null) {
          if (m.avHold > 0) {
            if (avT >= m.avAt) m.av = Math.min(1.45, m.av + dt * 3);
            // nach der Lawine noch 2–6 s begraben, dann freigraben (~5 s)
            if (!avLive) { m.avHold -= dt; if (m.avHold <= 0) digPuff(m); }
          } else {
            m.av = Math.max(0, m.av - dt / 5);
            if (m.av <= 0) m.avAt = null;
          }
        }
        renderMound(m);
      });
      if (aval && !avLive && !minis.some(function (m) { return m && m.avAt !== null; })) aval = null;
    }
    function avalanche(p) {
      if (!S.on || p.reduced || !p.land || !partOn('minis') || minisHidden()) return;
      aval = p;
      var right = p.land.x > W / 2;
      minis.forEach(function (m) {
        if (!m || (m.x > W / 2) !== right) return;
        // je weiter weg vom Aufprall, desto später erreicht ihn der Schnee
        m.avAt = p.land.t + Math.abs(m.x - p.land.x) / 1600;
        m.avHold = rand(2, 6);
      });
    }

    // ── Hauptschleife ──
    var last = null, dirty = true, dripAcc = 0, wasOn = false;
    function frame(ts) {
      var dt = last === null ? 0 : Math.min((ts - last) / 1000, 0.05);
      last = ts;
      if (anim) {
        anim.t += dt;
        (anim.type === 'setup' ? renderSetup : renderFarewell)(Math.min(anim.t, anim.dur));
        if (anim.t >= anim.dur) finishAnim();
      }
      syncMinis();
      // Schneedecke folgt dem Server-Stand weich
      var prev = S.shown;
      if (reduceMotion) S.shown = S.target;
      else if (S.shown !== S.target) {
        var diff = S.target - S.shown, stp = Math.max(1.5, Math.abs(diff) * 0.8) * dt;
        S.shown = Math.abs(diff) <= stp ? S.target : S.shown + (diff > 0 ? stp : -stp);
      }
      if (Math.abs(prev - S.shown) > 0.001) dirty = true;
      // Hitze: Schneemann schrumpft langsam und erholt sich wieder
      var ph = S.heat;
      S.heat += (S.heatT - S.heat) * Math.min(1, dt / (S.heatT > S.heat ? 8 : 15));
      if (Math.abs(S.heat - S.heatT) < 0.002) S.heat = S.heatT;
      if (ph !== S.heat) dirty = true;
      icicles.forEach(function (ic) { if (ic.grow < 1) { ic.grow = Math.min(1, ic.grow + dt / 30); dirty = true; } });
      if (S.on || wasOn) {
        stepMinis(dt);
        if (dirty) {
          drawCover(); drawIce(); placeSnowman();
          minis.forEach(function (m) { if (m) placeMini(m); });
          applySnowVars();
          dirty = false;
        }
        // Tropfen am Schneemann bei Hitze, an den Eiszapfen bei Tauwetter
        if (S.on && S.heat > 0.3 && S.sm > 0 && partOn('snowman')) {
          dripAcc += dt * 4 * S.heat;
          while (dripAcc >= 1) {
            dripAcc--;
            var side = Math.random() < 0.5 ? -1 : 1, top = Math.min(3, S.sm);
            var cy = [-70, -180, -262][Math.floor(Math.random() * top)], rr = [74, 54, 40][[-70, -180, -262].indexOf(cy)];
            var base = surface(SM_X) + 26;
            addP({ x: SM_X + side * rr * 0.8 * SM_K, y: base + (cy + rr * 0.3) * SM_K, vx: 0, vy: 30, g: 900, term: 500,
                   sway: 0, vr: 0, wf: 0, floor: surface, draw: drop });
          }
        }
        if (parts) parts.step(dt);
      }
      wasOn = S.on;
      root.requestAnimationFrame(frame);
    }
    root.requestAnimationFrame(frame);

    // ── Spotlight: alle 8 s ein Name, jedes 4. Mal der beste Schipper ──
    var spotRound = 0, lastSpot = null;
    setInterval(function () {
      if (!S.on || anim) return;
      spotRound++;
      var top = S.snowTop[0];
      if (top && spotRound % 4 === 0) { tag('Top shoveler: ' + top[0] + ' · ' + top[1] + '×', W / 2, 300, false); return; }
      var pool = [];
      if (xmasShown()) {
        if (partOn('tree')) orns.forEach(function (o) { if (o && o.label) pool.push({ node: o.inner, label: o.label, p: treeToScreen(o.x, o.y - 16) }); });
        if (partOn('gifts')) gifts.forEach(function (g) { if (g && g.label) pool.push({ node: g.inner, label: g.label, p: treeToScreen(g.x, g.y) }); });
      }
      if (partOn('minis') && !minisHidden()) minis.forEach(function (m) { if (m && m.label) pool.push({ node: m.inner, label: m.label, p: [m.x, miniTop(m)] }); });
      if (!pool.length) return;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      if (lastSpot && pick.label === lastSpot && pool.length > 1) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
      lastSpot = pick.label;
      if (SK) SK.spot(pick.node);
      tag(pick.label, pick.p[0], pick.p[1]);
    }, 8000);

    showSnowman(0);
    updateCounter();
    syncXmas();

    var PART_KEYS = ['lights', 'tree', 'baubles', 'gifts', 'snowman', 'minis', 'icicles', 'cover'];
    return {
      load: function (deco) {
        if (!deco) return;
        clear(gOrns); orns = []; ornNext = 0;
        clear(giftsBack); clear(giftsFront); gifts = []; giftNext = 0; giftLog = [];
        clear(gMinis); minis = []; miniNext = 0;
        (deco.ornaments || []).forEach(function (o) { addOrnament(o.name || '', false); });
        (deco.gifts || []).forEach(function (g) { addGift({ name: g.name || '', type: g.type, amount: parseInt(g.amount, 10) || 1 }, false); });
        (deco.minis || []).forEach(function (m) { addMini(m.name || '', false); });
        ornTotal = deco.ornament_total || orns.filter(Boolean).length;
        giftTotal = deco.gift_total || gifts.filter(Boolean).length;
        miniTotal = deco.mini_total || 0;
        var proj = deco.project != null ? deco.project : deco.snowman;
        clearTimeout(smClearTimer);
        gSm.classList.remove('is-clearing');
        S.sm = Math.max(0, Math.min(8, parseInt(proj, 10) || 0));
        showSnowman(0);
        updateCounter();
      },
      update: function (s) {
        s = s || {};
        S.on = s.theme === 'winter';
        S.xmas = s.xmas || 'off';
        if (override && S.xmas !== override.stale) override = null;
        if (typeof s.snowCover === 'number') {
          S.target = Math.max(0, Math.min(100, s.snowCover));
          // beim ersten Stand sofort, danach wächst/schmilzt die Decke sichtbar
          if (S.first) { S.shown = S.target; dirty = true; }
          S.first = false;
        }
        if (Array.isArray(s.snowTop)) S.snowTop = s.snowTop;
        S.heatT = (s.heat || 0) > 0.5 ? 1 : 0;
        S.night = clamp01(s.night || 0);
        rootEl.dataset.night = S.night > 0.05 ? '1' : '0';
        var p = s.parts || {};
        PART_KEYS.forEach(function (k) {
          S.partsOn[k] = p[k] !== false;
          rootEl.dataset[k] = p[k] === false ? '0' : '1';
        });
        rootEl.dataset.on = S.on ? '1' : '0';
        fxEl.dataset.on = S.on ? '1' : '0';
        dirty = true;
        syncXmas();
      },
      command: function (cmd, p) {
        p = p || {};
        switch (cmd) {
          case 'ornament':
            addOrnament(p.name || '', true); ornTotal++; updateCounter(); break;
          case 'gift':
            addGift({ name: p.name || '', type: p.type, amount: parseInt(p.amount, 10) || 1 }, true); giftTotal++; updateCounter(); break;
          case 'mini':
            addMini(p.name || '', true); miniTotal++; break;
          case 'follow':
            follow(p.name || ''); break;
          case 'build':
            build(p.name || '', S.on); break;
          case 'snowmanreset':
            resetSnowman(S.on); break;
          case 'shovel':
            shovel(p); break;
          case 'shake':
            shake(p); break;
          case 'icicle':
            icicle(p); break;
          case 'snowball':
            snowball(p.name || ''); break;
          case 'celebrate':
            celebrate(p.name || ''); break;
          case 'snowboard':
            showBoard('Top snow shovelers', S.snowTop); break;
          case 'spectacle':
            if (p.type === 'avalanche') avalanche(p);
            break;
          case 'clear':
            if (p.kind === 'ornaments') { clear(gOrns); orns = []; ornNext = 0; ornTotal = 0; updateCounter(); }
            else if (p.kind === 'gifts') { clear(giftsBack); clear(giftsFront); gifts = []; giftNext = 0; giftTotal = 0; giftLog = []; updateCounter(); }
            else if (p.kind === 'minis') { clear(gMinis); minis = []; miniNext = 0; miniTotal = 0; }
            else if (p.kind === 'snow') { S.target = 0; S.snowTop = []; }
            else if (p.kind === 'snowman') { S.sm = 0; showSnowman(0); }
            break;
        }
      },
      playSetup: function (done) { startAnim('setup', done); },
      playFarewell: function (done) { startAnim('farewell', done); },
      busy: function () { return anim ? anim.type : null; },
      status: function () {
        return { on: S.on, xmas: S.xmas, shown: xmasShown(), snow: Math.round(S.shown), snowman: S.sm,
                 ornaments: ornTotal, gifts: giftTotal, minis: miniTotal };
      }
    };
  }

  root.ThemeWinter = { create: create };
})(typeof window !== 'undefined' ? window : this);
