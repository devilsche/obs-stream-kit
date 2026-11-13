/* Weihnachts-Deko der Weather-Source, gemeinsam für Winter (js/theme-winter.js)
 * und Strand (js/theme-summer.js): Lichterkette oben, Baum mit Follower-Kugeln,
 * Geschenke, optional hängende Kugeln und Schnee; Aufbau- und Abschied-Animation
 * und der Xmas-Ablauf (Server-Stand, danach Override bis der Server nachzieht).
 * Klassen tw-* mit Stilen aus js/theme-winter.css; Verläufe/Filter je Thema
 * mit eigenem Präfix (ThemeXmas.defs).
 *
 *   var X = ThemeXmas.create({ root, tree, baubles, lights, x, y, k, pfx, rnd, ... });
 *   X.update(on, xmas, partsOn);  X.step(dt);  X.start('setup' | 'farewell', done);
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function f1(v) { return (+v).toFixed(1); }

  // ── Baum: Koordinaten im Baum-SVG (400 × 540) ──
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
  var MAX_ORN = 30;   // die neuesten Follower, locker über den Baum verteilt
  var GRADS = ['ornR', 'ornG', 'ornB', 'ornP'];
  // Wabenraster in den drei Stufen, gemischt: der Baum füllt sich gleichmäßig
  function makeSlots(rnd) {
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

  // ── Baumschmuck der Follower: Typ und Farbe fest aus dem Namen (gleicher Name,
  // gleicher Schmuck, in jedem Stream); hängt am Haken bei 0/0, etwa 30 hoch ──
  function nameHash(name) {
    var h = 2166136261;
    for (var i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  var ORN_TYPES = [['bauble', 40], ['nutcracker', 10], ['pinecone', 10], ['candycane', 10], ['strawstar', 10], ['bell', 10], ['gingerbread', 10]];
  function ornamentType(name) {
    var roll = nameHash(name || '?') % 100, acc = 0;
    for (var t = 0; t < ORN_TYPES.length; t++) { acc += ORN_TYPES[t][1]; if (roll < acc) return ORN_TYPES[t][0]; }
    return 'bauble';
  }
  function drawOrnament(g, name, pfx) {
    var h = nameHash(name || '?');
    switch (ornamentType(name)) {
      case 'nutcracker':
        el('path', { 'class': 'tx-hang', d: 'M0 0 L0 1.5' }, g);
        el('rect', { 'class': 'tx-black', x: -4.5, y: 1.5, width: 9, height: 8.5, rx: 1.2 }, g);
        el('rect', { 'class': 'tx-gold', x: -4.5, y: 7.6, width: 9, height: 1.6 }, g);
        el('circle', { 'class': 'tx-gold', cx: 0, cy: 4.6, r: 1.1 }, g);
        el('rect', { 'class': 'tx-skin', x: -3.6, y: 10, width: 7.2, height: 5.6, rx: 1 }, g);
        el('circle', { 'class': 'tx-black', cx: -1.4, cy: 12, r: 0.6 }, g);
        el('circle', { 'class': 'tx-black', cx: 1.4, cy: 12, r: 0.6 }, g);
        el('path', { 'class': 'tx-white', d: 'M-4 14 Q0 22 4 14 L3 14.6 Q0 18 -3 14.6 Z' }, g);
        el('rect', { 'class': 'tx-white', x: -1.8, y: 14.2, width: 3.6, height: 1.6 }, g);
        el('path', { 'class': 'tx-line', d: 'M-1.8 15 L1.8 15 M-0.6 14.2 L-0.6 15.8 M0.6 14.2 L0.6 15.8' }, g);
        el('path', { 'class': 'tx-red', d: 'M-5.5 17.5 L5.5 17.5 L6 25.5 L-6 25.5 Z' }, g);
        el('rect', { 'class': 'tx-black', x: -6, y: 22.5, width: 12, height: 1.6 }, g);
        [19, 21, 24.6].forEach(function (y) { el('circle', { 'class': 'tx-gold', cx: 0, cy: y, r: 0.7 }, g); });
        el('rect', { 'class': 'tx-blue', x: -4.6, y: 25.5, width: 3.6, height: 4.5 }, g);
        el('rect', { 'class': 'tx-blue', x: 1, y: 25.5, width: 3.6, height: 4.5 }, g);
        el('rect', { 'class': 'tx-black', x: -5, y: 29.4, width: 4.4, height: 1.8, rx: 0.6 }, g);
        el('rect', { 'class': 'tx-black', x: 0.6, y: 29.4, width: 4.4, height: 1.8, rx: 0.6 }, g);
        break;
      case 'pinecone':
        el('path', { 'class': 'tx-hang', d: 'M0 0 L0 3' }, g);
        el('path', { 'class': 'tx-brown', d: 'M0 3 C7.5 6 9 17 0 29 C-9 17 -7.5 6 0 3 Z' }, g);
        [[7, 3], [11, 4], [15, 4], [19, 3], [23, 2]].forEach(function (row, r) {
          var y = row[0], n = row[1], w = (r === 0 || r === 4) ? 2.6 : 3.2;
          for (var k = 0; k < n; k++) {
            var x = (k - (n - 1) / 2) * w * 1.6, d = 'M' + f1(x - w) + ' ' + y + ' Q' + f1(x) + ' ' + (y + 4) + ' ' + f1(x + w) + ' ' + y;
            el('path', { 'class': 'tx-brown-lt', d: d + ' Z' }, g);
            el('path', { 'class': 'tx-scale', d: d }, g);
            el('circle', { 'class': 'tx-tip', cx: f1(x), cy: y + 2.8, r: 0.6 }, g);
          }
        });
        break;
      case 'candycane':
        el('path', { 'class': 'tx-cane', d: 'M-5 6 C-5 -1 5 -1 5 6 L5 27' }, g);
        el('path', { 'class': 'tx-cane-stripe', d: 'M-5 6 C-5 -1 5 -1 5 6 L5 27' }, g);
        break;
      case 'strawstar':
        el('path', { 'class': 'tx-thread', d: 'M0 0 L0 3' }, g);
        for (var k = 0; k < 8; k++) {
          var a = k / 8 * Math.PI;
          el('line', { 'class': 'tx-straw', x1: f1(Math.cos(a) * 11), y1: f1(14 + Math.sin(a) * 11), x2: f1(-Math.cos(a) * 11), y2: f1(14 - Math.sin(a) * 11) }, g);
        }
        el('circle', { 'class': 'tx-knot', cx: 0, cy: 14, r: 2.6 }, g);
        break;
      case 'bell':
        el('path', { 'class': 'tx-hang', d: 'M0 0 L0 3' }, g);
        el('path', { d: 'M-8.5 21 Q-9 6 0 5 Q9 6 8.5 21 L10.5 23.5 L-10.5 23.5 Z', fill: 'url(#' + pfx + 'bellG)' }, g);
        el('circle', { 'class': 'tx-gold-dk', cx: 0, cy: 25.5, r: 2.2 }, g);
        el('ellipse', { 'class': 'tx-red', cx: -3.3, cy: 4.2, rx: 3, ry: 1.9 }, g);
        el('ellipse', { 'class': 'tx-red', cx: 3.3, cy: 4.2, rx: 3, ry: 1.9 }, g);
        el('circle', { 'class': 'tx-red-dk', cx: 0, cy: 4.3, r: 1.4 }, g);
        el('ellipse', { 'class': 'tx-shine', cx: -4, cy: 13, rx: 1.4, ry: 4 }, g);
        break;
      case 'gingerbread':
        el('path', { 'class': 'tx-thread', d: 'M0 0 L0 6' }, g);
        el('path', { 'class': 'tx-brown', d: 'M0 27 C-10 19 -11 11 -8 7.5 C-5.5 4.5 -1.5 5.5 0 8.5 C1.5 5.5 5.5 4.5 8 7.5 C11 11 10 19 0 27 Z' }, g);
        el('path', { 'class': 'tx-icing', d: 'M0 24 C-8 17.5 -8.6 11.5 -6.4 9.2 C-4.5 7.2 -1.6 8 0 10.8 C1.6 8 4.5 7.2 6.4 9.2 C8.6 11.5 8 17.5 0 24' }, g);
        el('circle', { 'class': 'tx-red', cx: -2.5, cy: 15, r: 1 }, g);
        el('circle', { 'class': 'tx-red', cx: 2.5, cy: 15, r: 1 }, g);
        el('circle', { 'class': 'tx-white', cx: 0, cy: 19, r: 0.9 }, g);
        break;
      default:   // Glaskugel, Farbe ebenfalls aus dem Namen
        el('path', { 'class': 'tx-hang', d: 'M0 0 L0 2' }, g);
        el('rect', { 'class': 'tx-gold', x: -3, y: 2, width: 6, height: 3.5, rx: 1 }, g);
        el('circle', { cx: 0, cy: 14.5, r: 10, fill: 'url(#' + pfx + GRADS[(h >>> 8) % GRADS.length] + ')' }, g);
        el('ellipse', { 'class': 'tx-shine', cx: -3.5, cy: 10.5, rx: 2.4, ry: 3.4 }, g);
    }
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
  // ── Adventskranz links vom Baum (Baum-Koordinaten): Ring in Aufsicht,
  // Kerzen im Uhrzeigersinn ab hinten links; je Brenntag ein Stück kürzer ──
  // flacher Blickwinkel wie der Rest der Szene (Schnee, Baum von der Seite)
  var WR = { x: -160, y: 478, rx: 70, ry: 13 };
  // leicht gedreht, damit keine Kerze genau vor einer anderen steht
  var CANDLE_A = [-160, -70, 20, 110];
  var CANDLE_H = 74, CANDLE_W = 14;
  function candleH(days) { return days < 0 ? CANDLE_H : CANDLE_H * Math.max(0.25, 1 - 0.026 * days); }

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

  // ── Verläufe und Filter; pfx trennt die Themen (gleiche ids wären ungültig) ──
  function defs(svg, pfx) {
    var d = el('defs', {}, svg);
    function grad(kind, id, attrs, stops) {
      var g = el(kind, Object.assign({ id: pfx + id }, attrs), d);
      stops.forEach(function (s) { el('stop', { offset: s[0], 'stop-color': s[1], 'stop-opacity': s[2] === undefined ? 1 : s[2] }, g); });
    }
    var bg = el('filter', { id: pfx + 'bulbGlow', x: '-200%', y: '-200%', width: '500%', height: '500%' }, d);
    el('feGaussianBlur', { stdDeviation: 7 }, bg);
    var sg = el('filter', { id: pfx + 'starGlow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, d);
    el('feGaussianBlur', { stdDeviation: 6, result: 'b' }, sg);
    var mg = el('feMerge', {}, sg);
    el('feMergeNode', { 'in': 'b' }, mg); el('feMergeNode', { 'in': 'SourceGraphic' }, mg);
    grad('linearGradient', 'treeG', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#1a4d2f'], [1, '#0d2e1b']]);
    grad('linearGradient', 'moundG', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#dfe9f6'], [0.18, '#f4f8ff'], [1, '#f4f8ff']]);
    grad('linearGradient', 'capG', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#e9d58a'], [1, '#a8892c']]);
    grad('linearGradient', 'iceG', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#ffffff', 0.95], [0.6, '#bfe6ff', 0.85], [1, '#8ccfff', 0.7]]);
    grad('radialGradient', 'ornHalo', {}, [[0, '#fff3c4', 0.95], [0.45, '#f2b705', 0.55], [1, '#f2b705', 0]]);
    grad('radialGradient', 'ballG', { cx: 0.38, cy: 0.32 }, [[0, '#ffffff'], [0.7, '#eef4fb'], [1, '#bccde2']]);
    grad('linearGradient', 'bellG', { x1: 0, y1: 0, x2: 1, y2: 0 }, [[0, '#a87c12'], [0.45, '#f7d455'], [1, '#9a6f0e']]);
    [['ornR', '#ff9a9a', '#d42a2a', '#6e0d0d'], ['ornG', '#fff1a8', '#e2ad1c', '#7a5506'],
     ['ornB', '#b6dcff', '#2a78d4', '#0d2f6e'], ['ornP', '#e4c4ff', '#8e4bb8', '#3b1656'],
     ['ornGr', '#b8f5cf', '#2ecc71', '#0e5a2c'], ['ornO', '#ffd2a8', '#ff8a1f', '#7a3a06']].forEach(function (c) {
      grad('radialGradient', c[0], { cx: 0.35, cy: 0.3 }, [[0, c[1]], [0.5, c[2]], [1, c[3]]]);
    });
    grad('linearGradient', 'giftShadeG', { x1: 0, y1: 0, x2: 1, y2: 0.3 }, [[0, '#ffffff', 0.1], [0.45, '#ffffff', 0], [1, '#000000', 0.3]]);
    // Schneemänner: Kernschatten, Kontaktschatten, Möhre
    grad('radialGradient', 'snowShadeG', { cx: 0.32, cy: 0.27, r: 0.86 }, [[0, '#7f98bb', 0], [0.6, '#7f98bb', 0], [0.85, '#7390b6', 0.28], [1, '#5d7aa3', 0.55]]);
    grad('radialGradient', 'contactG', {}, [[0, '#4f6a90', 0.55], [0.6, '#5d7aa3', 0.25], [1, '#5d7aa3', 0]]);
    grad('linearGradient', 'carrotG', { x1: 0, y1: 0, x2: 0, y2: 1 }, [[0, '#ffa04a'], [0.5, '#f07c1e'], [1, '#b8540f']]);
    grad('linearGradient', 'hatG', { x1: 0, y1: 0, x2: 1, y2: 0 }, [[0, '#3a3a46'], [0.3, '#24242c'], [1, '#121216']]);
    // Adventskranz: Kerzenwachs, Flamme, Lichtschein
    grad('linearGradient', 'candleG', { x1: 0, y1: 0, x2: 1, y2: 0 }, [[0, '#7c1219'], [0.35, '#d63a3f'], [0.6, '#c42a31'], [1, '#6a0f15']]);
    grad('radialGradient', 'flameG', { cx: 0.5, cy: 0.72, r: 0.6 }, [[0, '#fffbe6'], [0.35, '#ffd86b'], [0.75, '#ff9a2a'], [1, '#ff6a10', 0]]);
    grad('radialGradient', 'cglowG', {}, [[0, '#ffd27a', 0.75], [0.4, '#ffb347', 0.3], [1, '#ff9a2a', 0]]);
    grad('radialGradient', 'wglowG', {}, [[0, '#ffc977', 0.55], [0.5, '#ffad4a', 0.22], [1, '#ff9a2a', 0]]);
    grad('radialGradient', 'coneG', { cx: 0.4, cy: 0.35 }, [[0, '#a8743f'], [1, '#4a2c14']]);
    TIER_D.forEach(function (p, i) { var cp = el('clipPath', { id: pfx + 'tierClip' + i }, d); el('path', { d: p }, cp); });
  }

  // ── Glühbirnen: Zähler je Thema (Farbe, Lauflicht-Takt) ──
  function bulbs(rnd) {
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
    // snow: Schneestreifen auf dem Draht (nur Winter, nicht bei kleinen Ketten)
    function stringAlong(parent, d, step, baseRot, size, small, snow) {
      var path = el('path', { 'class': 'tw-wire' + (small ? ' tw-wire--small' : ''), d: d }, parent);
      if (!small && snow) el('path', { 'class': 'tw-wire-snow', d: d }, parent);
      var len = path.getTotalLength(), out = [];
      for (var s = step / 2; s < len; s += step) {
        var p = path.getPointAtLength(s), q = path.getPointAtLength(Math.min(len, s + 1));
        var ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
        out.push(bulb(parent, p.x, p.y, baseRot + ang * 0.6 + (rnd() * 10 - 5), size));
      }
      return out;
    }
    return { bulb: bulb, stringAlong: stringAlong };
  }

  // ── Tannenäste: je Stufe Reihen hängender Zweige, untere überdecken obere;
  // Unterkante mit Nadelspitzen, Oberkante heller (Licht von oben) ──
  function boughD(rx, ry, tx, ty, lift, rnd) {
    var dx = tx - rx, dy = ty - ry, len = Math.hypot(dx, dy), nx = dy / len, ny = -dx / len;
    if (ny > 0) { nx = -nx; ny = -ny; }   // Normale zeigt nach oben
    var th = 7 + len * 0.1;
    var d = 'M' + f1(rx) + ' ' + f1(ry - th * 0.5) + ' Q' + f1(rx + dx * 0.5 + nx * lift) + ' ' + f1(ry + dy * 0.5 + ny * lift - th * 0.4) + ' ' + f1(tx) + ' ' + f1(ty);
    // Unterkante zurück zur Wurzel, gezackt
    var n = Math.max(4, Math.round(len / 7));
    for (var i = 1; i <= n; i++) {
      var t = 1 - i / n, bx = rx + dx * t + nx * lift * 0.5 * Math.sin(Math.PI * t), by = ry + dy * t + ny * lift * 0.5 * Math.sin(Math.PI * t) + th * 0.5;
      var tooth = (4 + rnd() * 5) * (0.5 + t * 0.7);
      d += ' L' + f1(bx + dx / len * 3) + ' ' + f1(by + tooth) + ' L' + f1(bx) + ' ' + f1(by);
    }
    return d + ' Z';
  }
  var BOUGH_SHADES = ['tw-bough--a', 'tw-bough--b', 'tw-bough--c'];
  function buildBoughs(g, tier, rnd) {
    var ax = tier[0], ay = tier[1], by = tier[2], hw = tier[3], rows = Math.round((by - ay) / 24);
    for (var j = 0; j < rows; j++) {
      var f = (j + 0.75) / rows, y = ay + (by - ay) * f - 6, w = hw * f;
      var droop = 6 + 10 * f;
      [-1, 1].forEach(function (side) {
        var tx = ax + side * (w * 1.04 + 2), ty = y + droop + rnd() * 4;
        el('path', { 'class': 'tw-bough ' + BOUGH_SHADES[Math.floor(rnd() * 3)], d: boughD(ax + side * w * 0.12, y - 4, tx, ty, 5 + rnd() * 4, rnd) }, g);
      });
      // nach vorn hängende Zweige füllen die Mitte
      var front = Math.max(0, Math.round(w / 34));
      for (var k = 0; k < front; k++) {
        var px = ax + (k + 0.5 - front / 2) * (w * 1.6 / Math.max(1, front)) + (rnd() - 0.5) * 8;
        var sd = px < ax ? -1 : 1;
        el('path', { 'class': 'tw-bough ' + BOUGH_SHADES[Math.floor(rnd() * 3)], d: boughD(px - sd * 6, y + 2, px + sd * (16 + rnd() * 10), y + droop + 4 + rnd() * 4, 3 + rnd() * 3, rnd) }, g);
      }
    }
  }

  /* cfg:
   *   root      – Wurzel-Element (.tw), bekommt data-xmas und data-celebrate
   *   tree      – Gruppe für Baum, Hügel, Geschenke, Zähler (schon positioniert)
   *   baubles   – Gruppe für hängende Kugeln oder null
   *   lights    – Gruppe für die Lichterkette oben
   *   x, y, k   – Lage des Baums auf dem Bildschirm
   *   pfx       – Präfix der Verlauf-ids (defs)
   *   rnd       – Pseudozufall mit festem Startwert (wird vor jedem Teil gesetzt)
   *   seed(n)   – setzt den Startwert von rnd
   *   bulbs     – Glühbirnen-Zeichner (ThemeXmas.bulbs)
   *   snow      – Schnee-Teile (Winter): Draht, Äste, Sternmütze, Wehe, Geschenke
   *   mound     – { d, cls } Hügel am Fuß; ground(g) zeichnet Beiwerk darauf
   *   tag(text, x, y), board(title, rows), onSync() – Rückrufe des Themas
   */
  function create(cfg) {
    var rootEl = cfg.root, pfx = cfg.pfx, rnd = cfg.rnd, B = cfg.bulbs, snow = !!cfg.snow;
    var TX = cfg.x, TY = cfg.y, TK = cfg.k;
    function toScreen(x, y) { return [TX + x * TK, TY + y * TK]; }
    function tag(text, x, y, long) { if (cfg.tag && text) cfg.tag(text, x, y, long); }
    var on = false, xmas = 'off', partsOn = {};
    function partOn(k) { return partsOn[k] !== false; }

    // ── Lichterkette oben (Bögen mit Durchhang) ──
    cfg.seed(7);
    var gLights = cfg.lights;
    var topD = 'M-10 6', sag = 74;
    for (var li = 0; li < 5; li++) {
      var x0 = -10 + li * 388;
      topD += ' Q' + (x0 + 194) + ' ' + (6 + sag * (li % 2 ? 0.85 : 1) + 10) + ' ' + (x0 + 388) + ' 6';
    }
    var topBulbs = B.stringAlong(gLights, topD, 52, 0, 1, false, snow);

    // ── Hängende Kugeln: [x, Fadenlänge, Verlauf] ──
    var gBaubles = cfg.baubles || null;
    (cfg.baubleList || []).forEach(function (b) {
      var g = el('g', { 'class': 'tw-bauble' }, gBaubles);
      el('line', { 'class': 'tw-thread', x1: b[0], y1: -10, x2: b[0], y2: b[1] }, g);
      el('rect', { 'class': 'tw-bcap', x: b[0] - 8, y: b[1] - 4, width: 16, height: 10, rx: 3 }, g);
      el('circle', { cx: b[0], cy: b[1] + 36, r: 32, fill: 'url(#' + pfx + b[2] + ')' }, g);
      el('ellipse', { cx: b[0] - 10, cy: b[1] + 24, rx: 6, ry: 4, fill: 'rgba(255,255,255,.7)' }, g);
      if (snow) el('path', { 'class': 'tw-bsnow', d: 'M' + (b[0] - 22) + ' ' + (b[1] + 12) + ' Q' + b[0] + ' ' + (b[1] - 8) + ' ' + (b[0] + 22) + ' ' + (b[1] + 12) + ' Q' + b[0] + ' ' + (b[1] + 6) + ' ' + (b[0] - 22) + ' ' + (b[1] + 12) + ' Z' }, g);
    });

    // ── Baum ──
    var gTreeShk = cfg.tree;
    var gTreeBox = el('g', { 'class': 'tw-treebox' }, gTreeShk);
    var gTree = el('g', {}, gTreeBox);
    var gTreeBody = el('g', { 'class': 'tw-dim' }, gTree);
    // Stamm: nach oben schmaler, Rinde in Längsrissen
    el('path', { 'class': 'tw-trunk', d: 'M180 517 Q184 470 187 405 L213 405 Q216 470 220 517 Q200 522 180 517 Z' }, gTreeBody);
    el('path', { 'class': 'tw-bark', d: 'M190 420 Q189 460 188 510 M199 412 Q200 450 198 515 M208 425 Q210 470 211 512 M194 445 l-2 18 M205 470 l2 20' }, gTreeBody);
    // Stufen von unten nach oben, Schnee jeweils direkt danach; die dunkle
    // Grundform bleibt als Schatten zwischen den Ästen
    cfg.seed(5);
    [0, 1, 2].forEach(function (i) {
      el('path', { 'class': 'tw-tree-g', d: TIER_D[i] }, gTreeBody);
      buildBoughs(el('g', { 'class': 'tw-boughs' }, gTreeBody), TIERS[2 - i], rnd);
      if (!snow) return;
      el('path', { 'class': 'tw-frost', d: TIER_D[i] }, gTreeBody);
      el('path', { 'class': 'tw-ridge-snow', 'clip-path': 'url(#' + pfx + 'tierClip' + i + ')', d: TIER_RIDGE[i] }, gTreeBody);
      el('path', { 'class': 'tw-snowcap tw-snowcap--' + (3 - i), d: TIER_CAP[i] }, gTreeBody);
    });
    var treeBulbs = [];
    GARLANDS.forEach(function (d) {
      var p = el('path', { 'class': 'tw-garland tw-dim', d: d }, gTree), len = p.getTotalLength();
      for (var s = 8; s < len; s += 22) {
        var pt = p.getPointAtLength(s);
        treeBulbs.push(B.bulb(gTree, pt.x, pt.y - 4, rnd() * 30 - 15, 0.42));
      }
    });
    // nachts wie die Schneedecke abdunkeln; Lichter und Stern bleiben hell
    var gFixedOrn = el('g', { 'class': 'tw-dim' }, gTree);
    FIXED.forEach(function (f) {
      var g = el('g', { 'class': 'tw-orn' }, gFixedOrn);
      el('line', { x1: f[0], y1: f[1] - 20, x2: f[0], y2: f[1] - 12, stroke: '#ccc' }, g);
      el('circle', { cx: f[0], cy: f[1], r: 13, fill: 'url(#' + pfx + f[2] + ')' }, g);
    });
    var gOrns = el('g', { 'class': 'tw-dim' }, gTree);
    var STAR = [200, 34], GROUND = 505;
    var gStar = el('g', { transform: 'translate(' + STAR[0] + ' ' + STAR[1] + ')' }, gTree);
    el('path', { 'class': 'tw-star-rays', opacity: 0.55, d: 'M0 -62 L5 -8 L62 0 L5 8 L0 62 L-5 8 L-62 0 L-5 -8 Z' }, gStar);
    el('path', { 'class': 'tw-star', d: 'M0 -30 L8.8 -12 L28.5 -9.3 L14.3 4.6 L17.6 24.3 L0 15 L-17.6 24.3 L-14.3 4.6 L-28.5 -9.3 L-8.8 -12 Z' }, gStar);
    if (snow) el('path', { 'class': 'tw-starhat', d: 'M-15 -20 Q-14 -38 0 -40 Q14 -38 15 -20 Q8 -25 0 -24 Q-8 -25 -15 -20 Z' }, gStar);
    // Hügel nach dem Baum: der Stamm steckt darin, beim Aufbau steigt der
    // Baum hinter ihm hervor
    var gMoundBox = el('g', { 'class': 'tw-dim' }, gTreeShk);
    var mound = el('path', { 'class': cfg.mound.cls, d: cfg.mound.d }, gMoundBox);
    if (cfg.ground) cfg.ground(gMoundBox);
    var gGiftBox = el('g', { 'class': 'tw-gifts tw-dim' }, gTreeShk);
    var gGifts = el('g', {}, gGiftBox);
    var giftsBack = el('g', {}, gGifts), giftsFront = el('g', {}, gGifts);
    // Schneewehe vor Baum und Geschenken, steigt mit dem Schnee
    if (snow) {
      var gDriftBox = el('g', { 'class': 'tw-treebox tw-dim' }, gTreeShk);
      el('path', { 'class': 'tw-drift', d: 'M-170 540 Q-120 470 -60 410 Q-10 318 50 316 Q120 292 200 305 Q280 288 350 316 Q410 318 460 410 Q520 470 570 540 Z' }, gDriftBox);
    }
    var counterEl = el('text', { 'class': 'tw-counter', x: 200, y: 536, 'text-anchor': 'middle' }, gTreeShk);

    // ── Adventskranz: Zweige hinten, Kerzen, Zweige vorne, Flammen obenauf ──
    cfg.seed(11);
    var gWreathBox = el('g', { 'class': 'tw-wreath' }, gTreeShk);
    var gWreath = el('g', {}, gWreathBox);
    el('ellipse', { 'class': 'tw-wglow', cx: WR.x, cy: WR.y + 6, rx: 190, ry: 70, fill: 'url(#' + pfx + 'wglowG)' }, gWreath);
    var gWBody = el('g', { 'class': 'tw-wbody' }, gWreath);
    var gWBack = el('g', {}, gWBody), gWCand = el('g', {}, gWBody), gWFront = el('g', {}, gWBody);
    var gWFlames = el('g', {}, gWreath);
    // Baumscheibe als Unterlage: Oberseite mit Jahresringen, Rinde als Seitenband
    var SL = { cx: WR.x, cy: WR.y + 5, rx: WR.rx + 22, ry: WR.ry + 5, th: 15 };
    function sliceSide() {
      var l = SL.cx - SL.rx, r = SL.cx + SL.rx;
      return 'M' + f1(l) + ' ' + f1(SL.cy) + ' L' + f1(l) + ' ' + f1(SL.cy + SL.th) + ' A' + SL.rx + ' ' + SL.ry + ' 0 0 0 ' + f1(r) + ' ' + f1(SL.cy + SL.th) +
             ' L' + f1(r) + ' ' + f1(SL.cy) + ' A' + SL.rx + ' ' + SL.ry + ' 0 0 1 ' + f1(l) + ' ' + f1(SL.cy) + ' Z';
    }
    var gSlice = el('g', { 'class': 'tw-wslice' }, gWBody);
    el('ellipse', { 'class': 'tw-wslice-shadow', cx: SL.cx + 4, cy: SL.cy + SL.th + SL.ry - 2, rx: SL.rx + 6, ry: 5 }, gSlice);
    el('path', { 'class': 'tw-wslice-bark', d: sliceSide() }, gSlice);
    var barkD = '';
    for (var bx = -0.92; bx <= 0.93; bx += 0.115) {
      var yb = SL.cy + SL.ry * Math.sqrt(1 - bx * bx);
      barkD += ' M' + f1(SL.cx + bx * SL.rx) + ' ' + f1(yb + 2) + ' l' + f1((rnd() - 0.5) * 2) + ' ' + f1(SL.th - 3 - rnd() * 4);
    }
    el('path', { 'class': 'tw-wslice-furrow', d: barkD }, gSlice);
    el('ellipse', { 'class': 'tw-wslice-top', cx: SL.cx, cy: SL.cy, rx: SL.rx, ry: SL.ry }, gSlice);
    el('ellipse', { 'class': 'tw-wslice-sap', cx: SL.cx, cy: SL.cy, rx: SL.rx - 4, ry: SL.ry - 1.6 }, gSlice);
    [0.18, 0.34, 0.5, 0.64, 0.78, 0.9].forEach(function (k, i) {
      el('ellipse', { 'class': 'tw-wslice-ring', cx: f1(SL.cx + 3 * (1 - k)), cy: f1(SL.cy - 1 * (1 - k)), rx: f1((SL.rx - 6) * k * (1 + (i % 2 ? 0.02 : -0.015))), ry: f1((SL.ry - 2) * k) }, gSlice);
    });
    el('path', { 'class': 'tw-wslice-crack', d: 'M' + f1(SL.cx + 4) + ' ' + f1(SL.cy) + ' l' + f1(SL.rx * 0.45) + ' ' + f1(SL.ry * 0.25) + ' l' + f1(SL.rx * 0.2) + ' 1' }, gSlice);
    if (snow) {
      // Schnee bleibt auf dem freien Rand der Scheibe liegen
      el('path', { 'class': 'tw-gsnow', d: 'M' + f1(SL.cx - SL.rx + 2) + ' ' + f1(SL.cy + 1) + ' Q' + f1(SL.cx - SL.rx + 6) + ' ' + f1(SL.cy - SL.ry * 0.7) + ' ' + f1(SL.cx - SL.rx * 0.55) + ' ' + f1(SL.cy - SL.ry * 0.9) +
                   ' Q' + f1(SL.cx - SL.rx * 0.75) + ' ' + f1(SL.cy - SL.ry * 0.35) + ' ' + f1(SL.cx - SL.rx + 2) + ' ' + f1(SL.cy + 1) + ' Z' }, gSlice);
      el('path', { 'class': 'tw-gsnow', d: 'M' + f1(SL.cx + SL.rx - 2) + ' ' + f1(SL.cy + 1) + ' Q' + f1(SL.cx + SL.rx - 4) + ' ' + f1(SL.cy - SL.ry * 0.6) + ' ' + f1(SL.cx + SL.rx * 0.6) + ' ' + f1(SL.cy - SL.ry * 0.88) +
                   ' Q' + f1(SL.cx + SL.rx * 0.8) + ' ' + f1(SL.cy - SL.ry * 0.3) + ' ' + f1(SL.cx + SL.rx - 2) + ' ' + f1(SL.cy + 1) + ' Z' }, gSlice);
      el('path', { 'class': 'tw-gsnow', d: 'M' + f1(SL.cx - SL.rx * 0.5) + ' ' + f1(SL.cy + SL.ry * 0.86) + ' Q' + f1(SL.cx) + ' ' + f1(SL.cy + SL.ry * 1.12) + ' ' + f1(SL.cx + SL.rx * 0.45) + ' ' + f1(SL.cy + SL.ry * 0.88) +
                   ' Q' + f1(SL.cx) + ' ' + f1(SL.cy + SL.ry * 0.95) + ' ' + f1(SL.cx - SL.rx * 0.5) + ' ' + f1(SL.cy + SL.ry * 0.86) + ' Z' }, gSlice);
    }
    gWBody.insertBefore(gSlice, gWBack);
    var NEEDLE = ['#1d4529', '#285a33', '#33693c', '#1a3d24'];
    function sprig(parent, x, y, ang, len) {
      var c = Math.cos(ang), sn = Math.sin(ang), d = 'M' + f1(x) + ' ' + f1(y) + ' l' + f1(c * len) + ' ' + f1(sn * len * 0.45);
      for (var t = 0.15; t < 1; t += 0.12) {
        var px = x + c * len * t, py = y + sn * len * t * 0.45, nl = 7 * (1.1 - t);
        [-1, 1].forEach(function (side) {
          var a = ang + side * (0.9 + rnd() * 0.3);
          d += ' M' + f1(px) + ' ' + f1(py) + ' l' + f1(Math.cos(a) * nl) + ' ' + f1(Math.sin(a) * nl * 0.6 - 1.5);
        });
      }
      el('path', { 'class': 'tw-sprig', stroke: NEEDLE[Math.floor(rnd() * NEEDLE.length)], d: d }, parent);
    }
    function ringPt(a, r) { return [WR.x + WR.rx * r * Math.cos(a), WR.y + WR.ry * r * Math.sin(a)]; }
    // Unterbau dunkel, darauf Zweige rundum (je zwei Lagen), hinten zuerst
    // Strohring als Unterbau (mit Loch in der Mitte), darauf dicht Tannenzweige
    el('ellipse', { 'class': 'tw-wbase', cx: WR.x, cy: WR.y + 3, rx: WR.rx, ry: WR.ry }, gWBack);
    for (var wi = 0; wi < 130; wi++) {
      var wa = wi / 130 * Math.PI * 2 + rnd() * 0.05, wr = 0.72 + rnd() * 0.56, wp = ringPt(wa, wr);
      var tang = wa + Math.PI / 2 * (rnd() < 0.5 ? 1 : -1) + (rnd() - 0.5) * 0.8;
      sprig(Math.sin(wa) < -0.1 ? gWBack : gWFront, wp[0], wp[1] - 4 + rnd() * 6, tang, 20 + rnd() * 12);
    }
    // Zapfen, Beeren, Schleife vorne
    [[-0.4, 0.95], [2.0, 1.05], [-2.6, 0.9], [1.1, 1.08]].forEach(function (c) {
      var cp = ringPt(c[0], c[1]), g = el('g', { transform: 'translate(' + f1(cp[0]) + ' ' + f1(cp[1]) + ') rotate(' + f1(c[0] * 30) + ')' }, Math.sin(c[0]) < -0.1 ? gWBack : gWFront);
      el('ellipse', { rx: 9, ry: 6, fill: 'url(#' + pfx + 'coneG)' }, g);
      el('path', { 'class': 'tw-cone-scale', d: 'M-6 -2 Q-3 0 -6 2 M-2 -4 Q1 0 -2 4 M2 -4 Q5 0 2 4 M6 -2 Q8 0 6 2' }, g);
    });
    for (var bi = 0; bi < 9; bi++) {
      var ba = rnd() * Math.PI * 2, bp = ringPt(ba, 0.85 + rnd() * 0.35);
      var bg = Math.sin(ba) < -0.1 ? gWBack : gWFront;
      for (var bk = 0; bk < 3; bk++) el('circle', { 'class': 'tw-berry', cx: f1(bp[0] + (bk - 1) * 3.6), cy: f1(bp[1] + (bk === 1 ? -3 : 0)), r: 2.8 }, bg);
    }
    var bow = el('g', { transform: 'translate(' + WR.x + ' ' + (WR.y + WR.ry + 6) + ')' }, gWFront);
    el('path', { 'class': 'tw-wbow', d: 'M0 0 Q-16 -12 -20 -2 Q-18 8 0 0 Z M0 0 Q16 -12 20 -2 Q18 8 0 0 Z' }, bow);
    el('path', { 'class': 'tw-wbow', d: 'M-2 1 L-9 18 L-5 16 L-3 20 Z M2 1 L9 18 L5 16 L3 20 Z' }, bow);
    el('circle', { 'class': 'tw-wbow-knot', r: 4 }, bow);
    if (snow) {
      for (var si = 0; si < 7; si++) {
        var sp = ringPt(-Math.PI + si / 6 * Math.PI * 2 + 0.3, 1.0);
        el('ellipse', { 'class': 'tw-gsnow', cx: f1(sp[0]), cy: f1(sp[1] - 5), rx: f1(8 + rnd() * 6), ry: 3.5 }, Math.sin(-Math.PI + si / 6 * Math.PI * 2 + 0.3) < -0.1 ? gWBack : gWFront);
      }
    }
    // Kerzen: hintere vor den vorderen zeichnen; Höhe aus den Brenntagen
    var candles = CANDLE_A.map(function (deg, i) {
      var a = deg * Math.PI / 180, cp = ringPt(a, 0.78);
      return { i: i, x: cp[0], y: cp[1] + 2, days: -1, out: 0, delay: 0.3 + rnd() * 0.9 };
    });
    candles.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (c) {
      c.g = el('g', { 'class': 'tw-candle' }, gWCand);
      c.flame = el('g', { 'class': 'tw-flame tw-flame--' + c.i }, gWFlames);
      c.glow = el('circle', { 'class': 'tw-cglow', r: 30, fill: 'url(#' + pfx + 'cglowG)' }, c.flame);
      c.lean = el('g', { 'class': 'tw-flame-lean' }, c.flame);
      var fl = el('g', { 'class': 'tw-flame-fl' }, el('g', { 'class': 'tw-flame-grow' }, c.lean));
      el('path', { 'class': 'tw-flame-o', fill: 'url(#' + pfx + 'flameG)', d: 'M0 0 C-7 -4 -6 -14 0 -26 C6 -14 7 -4 0 0 Z' }, fl);
      el('path', { 'class': 'tw-flame-i', d: 'M0 -2 C-3 -5 -3 -10 0 -15 C3 -10 3 -5 0 -2 Z' }, fl);
      el('ellipse', { 'class': 'tw-flame-b', cx: 0, cy: -2, rx: 2.6, ry: 2 }, fl);
      c.smokePos = el('g', {}, gWFlames);
      c.smoke = el('path', { 'class': 'tw-smoke', d: 'M0 0 C-5 -10 5 -18 0 -28 C-5 -38 4 -46 -1 -58' }, c.smokePos);
    });
    function drawCandle(c) {
      var h = candleH(c.days), top = c.y - h, w = CANDLE_W, g = c.g;
      clear(g);
      el('rect', { x: f1(c.x - w / 2), y: f1(top), width: w, height: f1(h), fill: 'url(#' + pfx + 'candleG)' }, g);
      // Brennmulde oben, Wachsrand etwas heller
      el('ellipse', { 'class': 'tw-candle-top', cx: f1(c.x), cy: f1(top), rx: w / 2, ry: 3 }, g);
      el('ellipse', { 'class': 'tw-candle-pool', cx: f1(c.x), cy: f1(top + 0.6), rx: f1(w / 2 - 2.2), ry: 1.8 }, g);
      // Wachsnasen: je länger sie brennt, desto mehr
      var drips = c.days < 0 ? 0 : Math.min(4, 1 + Math.floor(c.days / 6));
      for (var k = 0; k < drips; k++) {
        var dx = c.x - w / 2 + 2 + (k * 5.3 + c.i * 3) % (w - 4), dl = 5 + ((k * 7 + c.i * 5) % 11);
        el('path', { 'class': 'tw-drip', d: 'M' + f1(dx - 1.8) + ' ' + f1(top) + ' l0 ' + dl + ' a1.8 1.8 0 0 0 3.6 0 l0 ' + (-dl) + ' Z' }, g);
      }
      el('path', { 'class': 'tw-wick' + (c.days < 0 ? ' tw-wick--new' : ''), d: 'M' + f1(c.x) + ' ' + f1(top) + ' q1 -4 0 -7' }, g);
      c.flame.setAttribute('transform', 'translate(' + f1(c.x) + ' ' + f1(top - 6) + ')');
      c.smokePos.setAttribute('transform', 'translate(' + f1(c.x) + ' ' + f1(top - 8) + ')');
    }
    candles.forEach(drawCandle);
    function showFlame(c, lit) {
      if (c.shownLit === lit) return;
      c.shownLit = lit;
      c.flame.classList.toggle('is-lit', lit);
    }
    function puff(c) {
      c.smoke.classList.remove('is-puff');
      void c.smoke.getBoundingClientRect();
      c.smoke.classList.add('is-puff');
    }
    // Wind: Flammen neigen sich mit; starke Böe, Sturm oder Windhose pusten sie aus
    var wLean = 0, wKick = 0, wNight = -1, wLitDrawn = -1, candlesOn = true;
    function blowOut(hold) {
      candles.forEach(function (c) {
        if (c.days < 0) return;
        if (c.shownLit && !c.out) puff(c);
        c.out = Math.max(c.out, hold + c.delay * 2);
      });
    }
    var wLift = 0;
    function stepWreath(dt) {
      // auf der Schneedecke stehen, weder schweben noch versinken
      var gy = cfg.snowAt ? cfg.snowAt(TX + WR.x * TK) : null;
      // Scheibe liegt immer auf der Schneedecke (wenig Schnee: nach unten, viel: nach oben)
      var lift = gy === null ? 0 : (gy + 2 - (TY + (SL.cy + SL.ry + SL.th) * TK)) / TK;
      if (Math.abs(lift - wLift) > 0.5) { wLift = lift; gWreathBox.setAttribute('transform', 'translate(0 ' + f1(lift) + ')'); }
      var storm = cfg.storm ? cfg.storm(TX + WR.x * TK) : false;
      var w = cfg.wind ? cfg.wind() : 0;
      if (storm) blowOut(3);
      wKick *= Math.exp(-dt * 1.6);
      var target = w * 14 + wKick;
      wLean += (target - wLean) * Math.min(1, dt * 4);
      gWreathBox.style.setProperty('--tw-flame-lean', f1(reduceMotion ? 0 : wLean) + 'deg');
      var litN = 0;
      candles.forEach(function (c) {
        if (c.out > 0) c.out = Math.max(0, c.out - dt);
        var lit = candlesOn && c.days >= 0 && c.out <= 0 && !c.unlit;
        showFlame(c, lit);
        if (lit) litN++;
      });
      if (litN !== wLitDrawn) { wLitDrawn = litN; gWreathBox.style.setProperty('--tw-wlit', (litN / 4).toFixed(2)); }
    }
    function setAdvent(list) {
      if (!Array.isArray(list)) return;
      candles.forEach(function (c, i) {
        var d = typeof list[i] === 'number' ? list[i] : -1;
        if (d === c.days) return;
        c.days = d;
        drawCandle(c);
      });
    }

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

    // ── Kugeln und Geschenke ──
    var anim = null, override = null;
    var orns = [], ornNext = 0, ornTotal = 0;
    var gifts = [], giftNext = 0, giftTotal = 0, giftLog = [];
    cfg.seed(3);
    var SLOTS = makeSlots(rnd);

    function updateCounter() {
      var p = [];
      // gezählt wird, was am Baum hängt (die neuesten MAX_ORN)
      var hang = Math.min(ornTotal, MAX_ORN);
      if (hang) p.push(hang + (hang === 1 ? ' ornament' : ' ornaments'));
      if (giftTotal) p.push(giftTotal + (giftTotal === 1 ? ' gift' : ' gifts'));
      counterEl.textContent = p.join(' · ');
    }
    function shown() { return rootEl.dataset.xmas === '1'; }

    function addOrnament(name, animate) {
      var i = ornNext % SLOTS.length, s = SLOTS[i];
      var live = animate && shown() && partOn('tree') && !anim, wait = 0;
      if (orns[i]) {
        // Platz voll: die älteste Kugel fällt wie beim Abbau ab, dann kommt die neue
        if (live && !reduceMotion) { dropOff(orns[i]); wait = 0.9; } else gOrns.removeChild(orns[i].outer);
      }
      var outer = el('g', {}, gOrns);
      var g = el('g', { 'class': 'tw-orn' + (animate ? ' tw-orn--new' : '') }, outer);
      drawOrnament(el('g', { transform: 'translate(' + f1(s[0]) + ' ' + f1(s[1] - 13) + ')' }, g), name, pfx);
      // Einflug-Klasse danach weg, sonst spielt ein späteres Spotlight den Einflug erneut ab
      if (animate) setTimeout(function () { g.classList.remove('tw-orn--new'); }, (wait + 2) * 1000);
      orns[i] = { outer: outer, inner: g, label: name, x: s[0], y: s[1], order: ornNext };
      ornNext++;
      if (live) {
        // seitlich neben dem Baum einblenden (Seite des Platzes, solange dort
        // Bildschirm frei ist) und in flachem Bogen zum Aufhängepunkt fliegen
        g.style.setProperty('--orn-fx', f1(sideFrom(s[0]) - s[0]) + 'px');
        g.style.setProperty('--orn-fy', '-80px');
        g.style.setProperty('--orn-wait', wait + 's');
        sparkle(s[0], s[1], wait);
        var p = toScreen(s[0], s[1] - 16);
        setTimeout(function () { tag(name, p[0], p[1], true); }, wait * 1000);
        // solange der Name steht, schwingt die Kugel ab und zu am Faden
        setTimeout(function () {
          outer.classList.add('tw-orn-wig');
          setTimeout(function () { outer.classList.remove('tw-orn-wig'); }, 5200);
        }, (wait + 1.4) * 1000);
      }
    }
    // Startpunkt des Einflugs: neben dem Baum auf der Seite des Platzes,
    // solange dort Bildschirm frei ist
    function sideFrom(x) {
      var leftX = Math.max(-150, (40 - TX) / TK), rightX = Math.min(550, (1880 - TX) / TK);
      return x >= STAR[0] && rightX - x > 140 ? rightX : (x - leftX > 140 ? leftX : rightX);
    }
    // Einflug als Pose zum Fortschritt k (0..1): flacher Bogen von der Seite,
    // groß am Anfang, schrumpft auf Baumgröße (für den Aufbau; per Attribut,
    // läuft damit auch in OBS)
    function flyPose(node, x, y, k) {
      if (k <= 0) { node.setAttribute('opacity', '0'); return; }
      node.setAttribute('opacity', clamp01(k * 6).toFixed(3));
      if (reduceMotion || k >= 1) { node.removeAttribute('transform'); return; }
      var fx = sideFrom(x) - x, fy = -80, e = ease(k), u = 1 - e;
      var px = u * u * fx + 2 * u * e * fx * 0.4, py = u * u * fy + 2 * u * e * fy * 1.8;
      var sc = 1 + 1.5 * (1 - ease((k - 0.4) / 0.6)), hy = y - 13;
      node.setAttribute('transform', 'translate(' + f1(px + x) + ' ' + f1(py + hy) + ') scale(' + sc.toFixed(3) + ') translate(' + f1(-x) + ' ' + f1(-hy) + ')');
    }
    // kleine Effekte, die X.step jeden Frame weiterrechnet (false = fertig)
    var effects = [];
    function runEffects(dt) {
      // was ein Effekt unterwegs neu anlegt (Fall → Scherben), landet in der neuen Liste
      var cur = effects;
      effects = [];
      effects = cur.filter(function (f) { return f(dt) !== false; }).concat(effects);
    }
    // Kurzbesuch (!whereiam) während der Baum steht: die Kugel des Besuchers
    // schwebt groß neben den Baum, wackelt mit Namen und fliegt wieder hinaus
    function visit(name) {
      if (!shown() || !partOn('tree') || anim) return;
      if (root.ThemeSeasons) root.ThemeSeasons.hold(8000);
      var fromX = sideFrom(STAR[0]), left = fromX < STAR[0];
      var hx = left ? Math.max(-40, (120 - TX) / TK) : Math.min(440, (1800 - TX) / TK), hy = 200, K = 2.5;
      var outer = el('g', { opacity: '0' }, gSparks), sway = el('g', {}, outer);
      drawOrnament(el('g', { transform: 'translate(' + f1(hx) + ' ' + f1(hy - 13) + ')' }, sway), name, pfx);
      var t = 0, arrived = false;
      function pose(px, py, op) {
        outer.setAttribute('transform', 'translate(' + f1(px) + ' ' + f1(py) + ') scale(' + K + ') translate(' + f1(-hx) + ' ' + f1(-hy) + ')');
        outer.setAttribute('opacity', clamp01(op).toFixed(3));
      }
      effects.push(function (dt) {
        t += dt;
        if (reduceMotion) { pose(hx, hy, t < 6.5 ? 1 : 0); }
        else if (t < 1) { var e = ease(t); pose(fromX + (hx - fromX) * e, hy - 70 * (1 - e) - 50 * Math.sin(e * Math.PI), t * 4); }
        else if (t < 6.5) { pose(hx, hy + Math.sin((t - 1) * 2.2) * 4, 1); }
        else { var k = ease((t - 6.5) / 1); pose(hx + (fromX - hx) * k, hy - 60 * k, 1 - k); }
        if (!arrived && t >= 1) {
          arrived = true;
          sway.classList.add('tw-orn-wig');
          var p = toScreen(hx, hy - 13 - 34 * K / 2.5 - 24);
          tag(name + ' drops by!', p[0], p[1], true);
        }
        if (t < 7.5) return true;
        if (outer.parentNode) outer.parentNode.removeChild(outer);
        return false;
      });
    }
    // älteste Kugel macht Platz: fällt zur Erde und zerbirst dort
    function dropOff(o) {
      var n = o.outer, t = 0, T = 0.55, dx = rand(-25, 25), fall = Math.max(30, GROUND - o.y);
      effects.push(function (dt) {
        t += dt;
        var k = clamp01(t / T);
        n.setAttribute('transform', 'translate(' + f1(dx * k) + ' ' + f1(fall * k * k) + ')');
        if (k < 1) return true;
        if (n.parentNode) n.parentNode.removeChild(n);
        shatter(o.x + dx, GROUND);
        return false;
      });
    }
    // Scherben springen am Boden auseinander und blenden aus
    function shatter(x, y) {
      if (reduceMotion) return;
      var g = el('g', {}, gShards), parts = [];
      for (var k = 0; k < 10; k++) {
        var r = rand(6, 11);
        var p = el('path', { 'class': 'tw-shard' + (k % 3 === 0 ? ' tw-shard--gold' : ''),
                             d: 'M0 ' + f1(-r) + ' L' + f1(r * 0.8) + ' ' + f1(r * 0.5) + ' L' + f1(-r * 0.6) + ' ' + f1(r * 0.7) + ' Z',
                             transform: 'translate(' + f1(x) + ' ' + f1(y) + ')' }, g);
        parts.push({ n: p, x: 0, y: 0, vx: rand(-110, 110), vy: rand(-170, -60), r: rand(0, 360), vr: rand(-500, 500) });
      }
      var t = 0;
      effects.push(function (dt) {
        t += dt;
        var op = 1 - clamp01((t - 0.6) / 0.7);
        parts.forEach(function (q) {
          q.vy += 460 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.r += q.vr * dt;
          if (q.y > 0) { q.y = 0; q.vy *= -0.3; q.vx *= 0.6; q.vr *= 0.5; }
          q.n.setAttribute('transform', 'translate(' + f1(x + q.x) + ' ' + f1(y + q.y) + ') rotate(' + f1(q.r) + ')');
        });
        g.setAttribute('opacity', op.toFixed(3));
        if (t < 1.3) return true;
        if (g.parentNode) g.parentNode.removeChild(g);
        return false;
      });
    }
    // Lichtkranz + Funken um die neue Kugel, kommen nach der Landung
    // Kranz hinter den Kugeln, Funken davor
    var gHalos = gTree.insertBefore(el('g', {}), gOrns), gSparks = el('g', {}, gTree);
    // Scherben über dem Hügel am Fuß, sonst verdeckt er sie
    var gShards = el('g', {}, gTreeShk);
    function sparkle(x, y, wait) {
      var h = el('circle', { 'class': 'tw-orn-halo', cx: f1(x), cy: f1(y - 2), r: 40, fill: 'url(#' + pfx + 'ornHalo)' }, gHalos);
      h.style.setProperty('--orn-wait', wait + 's');
      var g = el('g', {}, gSparks);
      for (var k = 0; k < 8; k++) {
        var a = k / 8 * Math.PI * 2 + 0.3, d = 44 + (k % 3) * 10;
        var sp = el('path', { 'class': 'tw-orn-spark', d: 'M' + f1(x) + ' ' + f1(y - 8) + ' l2.8 5.2 5.2 2.8 -5.2 2.8 -2.8 5.2 -2.8 -5.2 -5.2 -2.8 5.2 -2.8 Z' }, g);
        sp.style.setProperty('--sp-x', f1(Math.cos(a) * d) + 'px');
        sp.style.setProperty('--sp-y', f1(Math.sin(a) * d) + 'px');
        sp.style.setProperty('--sp-d', (wait + 1.3 + (k % 4) * 0.12).toFixed(2) + 's');
      }
      setTimeout(function () { [h, g].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); }, 4600 + wait * 1000);
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
      el('rect', { x: f1(-w / 2), y: f1(-h), width: f1(w), height: f1(h), fill: 'url(#' + pfx + 'giftShadeG)' }, g);
      el('rect', { x: f1(-w / 2), y: f1(-h), width: f1(w), height: f1(h * 0.14), fill: 'rgba(255,255,255,.14)' }, g);
      el('rect', { x: f1(-4 * k), y: f1(-h), width: f1(8 * k), height: f1(h), fill: look.rib }, g);
      el('rect', { x: f1(-w / 2), y: f1(-h * 0.58), width: f1(w), height: f1(7 * k), fill: look.rib }, g);
      if (snow) el('rect', { 'class': 'tw-gsnow', x: f1(-w / 2 - 1), y: f1(-h - 7 * k), width: f1(w + 2), height: f1(9 * k), rx: 4 }, g);
      // Schleife: zwei Schlaufen mit Innenschatten, Bänder, Knoten
      [-1, 1].forEach(function (sd) {
        var bx = sd * 9 * k, byy = -h - 5 * k, rot = 'rotate(' + (sd * 25) + ' ' + f1(bx) + ' ' + f1(byy) + ')';
        el('ellipse', { cx: f1(bx), cy: f1(byy), rx: f1(10 * k), ry: f1(6 * k), fill: look.rib, transform: rot }, g);
        el('ellipse', { 'class': 'tw-gift-loop', cx: f1(bx + sd * 1.5 * k), cy: f1(byy + 0.5 * k), rx: f1(5 * k), ry: f1(2.6 * k), transform: rot }, g);
        el('path', { d: 'M0 ' + f1(-h - 2 * k) + ' l' + f1(sd * 7 * k) + ' ' + f1(9 * k) + ' l' + f1(sd * 2 * k) + ' ' + f1(-3 * k) + ' Z', fill: look.rib }, g);
      });
      el('circle', { cx: 0, cy: f1(-h - 3 * k), r: f1(4 * k), fill: look.rib }, g);
      el('circle', { 'class': 'tw-gift-knot', cx: f1(-1.2 * k), cy: f1(-h - 4.2 * k), r: f1(1.6 * k) }, g);
      var label = giftLabel(gift);
      gifts[i] = { outer: outer, inner: g, label: label, x: slot[0], y: baseY - h - 18 * k, order: giftNext, base: baseY, gh: h, fl: 0, flShown: '' };
      giftNext++;
      if (gift.name) giftLog.push(gift.name);
      if (animate && shown() && partOn('gifts')) { var p = toScreen(slot[0], baseY - h - 18 * k); tag(label, p[0], p[1]); }
    }
    // Tsunami: Geschenke schwimmen auf (gut halb eingetaucht), schaukeln und
    // treiben etwas, nach dem Ablaufen setzen sie sich wieder auf ihren Platz.
    // level(x) = Wasserstand über dem unteren Bildrand (1080 px hoch) oder null
    var floodT = 0;
    function flood(level, dt) {
      floodT += dt;
      gifts.forEach(function (g) {
        if (!g) return;
        var target = 0;
        if (level && !anim && shown() && partOn('gifts')) {
          var p = toScreen(g.x, g.base);
          target = Math.max(0, Math.min(260, level(p[0]) - (1080 - p[1]) - 0.45 * g.gh * TK));
        }
        if (!target && !g.fl) return;
        g.fl += (target - g.fl) * Math.min(1, dt * (target > g.fl ? 3 : 1.2));
        if (g.fl < 0.3 && !target) {
          g.fl = 0;
          if (g.flShown) { g.outer.removeAttribute('transform'); g.flShown = ''; }
          return;
        }
        var bob = Math.min(1, g.fl / 30);
        var tr = 'translate(' + f1(Math.sin(floodT * 1.3 + g.x) * 10 * bob / TK) + ' ' + f1(-g.fl / TK) + ') rotate(' +
                 f1(Math.sin(floodT * 2.1 + g.x * 0.1) * 9 * bob) + ' ' + g.x + ' ' + f1(g.base) + ')';
        if (tr !== g.flShown) { g.flShown = tr; g.outer.setAttribute('transform', tr); }
      });
    }
    function clearOrns() { clear(gOrns); orns = []; ornNext = 0; }
    function clearGifts() { clear(giftsBack); clear(giftsFront); gifts = []; giftNext = 0; giftLog = []; }

    // ── Sichtbarkeit ──
    function wanted() {
      if (anim) return true;
      if (override) return override.vis;
      return xmas === 'on' || xmas === 'farewell';
    }
    function resetAnimAttrs() {
      candles.forEach(function (c) { c.unlit = false; });
      [gTree, gMoundBox, gGifts, gBaubles, gLights, counterEl, gWreath].forEach(function (n) {
        if (n) { n.removeAttribute('transform'); n.removeAttribute('opacity'); }
      });
      orns.forEach(function (o) { if (o) { o.outer.removeAttribute('transform'); o.outer.removeAttribute('opacity'); } });
      gifts.forEach(function (g) { if (g) { g.outer.removeAttribute('transform'); g.outer.removeAttribute('opacity'); } });
      topBulbs.concat(treeBulbs).forEach(function (b) { b.classList.remove('is-off'); });
    }
    function sync() {
      var want = on && wanted();
      if (want && !shown() && !anim) resetAnimAttrs();
      rootEl.dataset.xmas = want ? '1' : '0';
      if (cfg.onSync) cfg.onSync();
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
      if (!node) return;
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
        var st = 4.5 + 3.6 * i / Math.max(1, n);
        flyPose(o.outer, o.x, o.y, clamp01((t - st) / 0.9));
      });
      var gs = anim.gifts, m = gs.length;
      gs.forEach(function (g, j) {
        var st = 7.4 + 1.5 * j / Math.max(1, m), kg = ease((t - st) / 0.8);
        setTo(g.outer, (1 - kg) * 520, 0, kg);
      });
      counterEl.setAttribute('opacity', clamp01((t - 9) / 0.8).toFixed(3));
      // Kranz rutscht von links herein, danach brennen die Kerzen nacheinander an
      var kw = ease((t - 6.6) / 1.2);
      setTo(gWreath, -(1 - kw) * 320, 0, kw);
      candles.forEach(function (c) { c.unlit = t < 8.4 + 0.35 * c.i; });
    }
    function renderFarewell(t) {
      var os = anim.orns, n = os.length;
      os.forEach(function (o, i) {
        if (o.broke) return;
        var st = 0.3 + 3.8 * i / Math.max(1, n), kf = clamp01((t - st) / 0.55);
        var fall = Math.max(30, GROUND - o.y);
        if (kf < 1) { setTo(o.outer, o.dx * kf, kf * kf * fall, 1); return; }
        // am Boden zerbersten (nur frisch, nicht beim Nachladen mitten in der Animation)
        o.broke = true;
        setTo(o.outer, 0, 0, 0);
        if (t - st - 0.55 < 0.3) shatter(o.x + o.dx, GROUND);
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
      // Kerzen werden ausgepustet (letzte zuerst), dann geht der Kranz mit den Geschenken
      candles.forEach(function (c) {
        var off = t >= 3.4 + 0.35 * (3 - c.i);
        if (off && !c.unlit && c.shownLit) puff(c);
        c.unlit = off;
      });
      var kw = ease((t - 6.8) / 1.4);
      setTo(gWreath, -kw * 320, 0, 1 - kw);
      var kt = ease((t - 6.4) / 2.2);
      setTo(gTree, 0, kt * 280, 1 - kt);
      setTo(gMoundBox, 0, 0, 1 - clamp01((t - 7.8) / 1));
      counterEl.setAttribute('opacity', (1 - kg).toFixed(3));
      if (!anim.board && t >= 9) {
        anim.board = true;
        if (cfg.board) cfg.board('Top gifters', giftTop());
      }
    }
    function giftTop() {
      var by = {};
      giftLog.forEach(function (n) { var k = n.toLowerCase(); by[k] = by[k] || [n, 0]; by[k][1]++; });
      return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b[1] - a[1]; });
    }
    // Kugeln und Geschenke der Animation (neu, wenn der Stand erst während
    // der Animation geladen wird)
    function animLists() {
      anim.orns = orderedOrns();
      anim.gifts = orderedGifts();
      if (anim.type === 'farewell') {
        anim.orns.reverse();           // neueste fallen zuerst
        anim.orns.forEach(function (o) { o.dx = rand(-25, 25); o.broke = false; });
      }
    }
    function start(type, done) {
      if (anim) finish();
      override = null;
      anim = { type: type, t: 0, dur: type === 'setup' ? 10 : 10.5, done: done };
      animLists();
      if (type === 'farewell') resetAnimAttrs();
      (type === 'setup' ? renderSetup : renderFarewell)(0);
      rootEl.dataset.xmas = on ? '1' : '0';
    }
    function finish() {
      var a = anim;
      anim = null;
      if (a.type === 'setup') {
        resetAnimAttrs();
        override = { vis: true, stale: xmas };
      } else {
        if (!a.board && cfg.board) cfg.board('Top gifters', giftTop());
        override = { vis: false, stale: xmas };
      }
      sync();
      if (typeof a.done === 'function') a.done();
    }

    var celebrateTimer = null;
    updateCounter();

    return {
      toScreen: toScreen,
      shown: shown,
      wanted: wanted,
      partOn: partOn,
      // Follow als Kugel zeigen? (Xmas-Zeit, nicht während des Abschieds)
      followAsOrnament: function () { return wanted() && !(anim && anim.type === 'farewell'); },
      // Follower-Figuren ausblenden, sobald der Baum steht, bis nach dem Abschied
      followersHidden: function () {
        if (anim) return anim.type === 'setup' ? anim.t >= 2.5 : anim.t < 7.6;
        return shown();
      },
      update: function (isOn, xm, parts) {
        on = !!isOn;
        xmas = xm || 'off';
        partsOn = parts || {};
        if (override && xmas !== override.stale) override = null;
        sync();
      },
      sync: sync,
      ornament: function (name, animate) { addOrnament(name, animate); ornTotal++; updateCounter(); },
      gift: function (gift, animate) { addGift(gift, animate); giftTotal++; updateCounter(); },
      load: function (deco) {
        clearOrns();
        clearGifts();
        (deco.ornaments || []).forEach(function (o) { addOrnament(o.name || '', false); });
        (deco.gifts || []).forEach(function (g) { addGift({ name: g.name || '', type: g.type, amount: parseInt(g.amount, 10) || 1 }, false); });
        ornTotal = deco.ornament_total || orns.filter(Boolean).length;
        giftTotal = deco.gift_total || gifts.filter(Boolean).length;
        updateCounter();
        if (anim) {
          animLists();
          (anim.type === 'setup' ? renderSetup : renderFarewell)(Math.min(anim.t, anim.dur));
        }
      },
      clear: function (kind) {
        if (kind === 'ornaments') { clearOrns(); ornTotal = 0; updateCounter(); }
        else if (kind === 'gifts') { clearGifts(); giftTotal = 0; updateCounter(); }
      },
      // Lauflicht, Kugeln und Geschenke wackeln
      celebrate: function () {
        rootEl.dataset.celebrate = '0';
        void rootEl.getBoundingClientRect();
        rootEl.dataset.celebrate = '1';
        clearTimeout(celebrateTimer);
        celebrateTimer = setTimeout(function () { rootEl.dataset.celebrate = '0'; }, 4000);
      },
      // Kandidaten fürs Spotlight (nur wenn der Baum steht)
      visit: visit,
      spotPool: function (pool) {
        if (!shown()) return;
        if (partOn('tree')) orns.forEach(function (o) { if (o && o.label) pool.push({ node: o.inner, label: o.label, p: toScreen(o.x, o.y - 16) }); });
        if (partOn('gifts')) gifts.forEach(function (g) { if (g && g.label) pool.push({ node: g.inner, label: g.label, p: toScreen(g.x, g.y) }); });
      },
      step: function (dt) {
        if (effects.length) runEffects(dt);
        stepWreath(dt);
        if (!anim) return;
        anim.t += dt;
        (anim.type === 'setup' ? renderSetup : renderFarewell)(Math.min(anim.t, anim.dur));
        if (anim.t >= anim.dur) finish();
      },
      start: start,
      flood: flood,
      // Brenntage der vier Adventskerzen vom Server (weather_theme.advent_burn)
      advent: setAdvent,
      // Böe {dir, k}: Flammen neigen sich, ab k ≥ 1.1 gehen sie aus
      gust: function (dir, k) {
        wKick = (dir < 0 ? -1 : 1) * Math.min(2, k || 1) * 22;
        if ((k || 1) >= 1.1) blowOut(2.5);
      },
      busy: function () { return anim ? anim.type : null; },
      totals: function () { return { ornaments: ornTotal, gifts: giftTotal }; },
      bulbs: B
    };
  }

  root.ThemeXmas = { create: create, defs: defs, bulbs: bulbs };
})(typeof window !== 'undefined' ? window : this);
