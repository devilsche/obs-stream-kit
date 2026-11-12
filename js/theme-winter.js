/* Winter-Thema der Weather-Source: Schneedecke, Eiszapfen, Schneemann (Sub
 * baut, gemeinsames Sub-Projekt), Mini-Schneemänner (Follow) – in der
 * Xmas-Zeit stattdessen Follower-Kugeln am Baum (Minis ausgeblendet), dazu
 * Lichterkette, Baum, hängende Kugeln und Geschenke,
 * mit Aufbau- und Abschied-Animation. Im Schneesturm schneien die Minis bis
 * zum Hut ein (Schneehügel davor), eine Lawine begräbt die Minis in ihrer
 * Ecke kurz; danach graben sie sich wieder frei. Optik aus effects/xmas.html und
 * effects/winter.html übernommen; Stände (Schneedecke, Xmas-Ablauf) rechnet
 * der Server, hier wird nur gezeigt. Lichterkette, Baum, Kugeln, Geschenke und
 * Aufbau/Abschied kommen aus js/theme-xmas.js (gemeinsam mit dem Strand).
 * Braucht js/season-kit.js und js/theme-xmas.js.
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

  // ── Baum: Platz unten rechts (Baum-Koordinaten und Geschenke in js/theme-xmas.js) ──
  var TREE_X = 1500, TREE_Y = 567, TREE_K = 0.95;

  // ── Hängende Kugeln: [x, Fadenlänge, Verlauf] ──
  var BAUBLES = [[70, 150, 'ornR'], [170, 230, 'ornG'], [265, 120, 'ornB'],
                 [1660, 300, 'ornGr'], [1760, 360, 'ornR'], [1855, 330, 'ornO']];

  // ── Schneemann links, Minis dazwischen (Mitte unten bleibt frei) ──
  var SM_X = 250, SM_K = 0.85;
  // Plätze: [x, Maßstab, Tiefe 0..1, Neigung]; Größe, Tiefe und Versatz je
  // Platz fest gestreut (kein Springen beim Neuladen), hinten kleiner; die
  // Tiefe wird mit der Schneedecke zur Höhe (miniFoot)
  function hash(i, s) { var v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); }
  function slot(x, n, back) {
    var size = 0.62 + 0.5 * hash(n, 1);
    var depth = back ? 0.45 + 0.55 * hash(n, 2) : 0.4 * hash(n, 2);
    return [Math.round(x + (hash(n, 3) - 0.5) * 30), +(size * (1 - 0.28 * depth)).toFixed(2),
            +depth.toFixed(2), Math.round((hash(n, 4) - 0.5) * 12)];
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
    return zip(front, 9).concat(zip(back, 8)).slice(0, 12);
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

  function create(stage, opts) {
    opts = opts || {};
    var SK = root.SeasonKit;
    var tagsLayer = opts.tags || null;
    var hud = opts.hud || null;
    function tag(text, x, y, big, long) { return SK && tagsLayer && text ? SK.tag(tagsLayer, text, x, y, !!big, !!long) : null; }

    // ── Ebenen: Deko unter Blitz-Aufhellung und Wetter-Partikeln, Effekte darüber ──
    var rootEl = document.createElement('div');
    rootEl.className = 'tw';
    rootEl.setAttribute('aria-hidden', 'true');
    rootEl.dataset.on = '0';
    rootEl.dataset.xmas = '0';
    var anchor = stage.querySelector('.wk-flash') || stage.querySelector('.wk-particles');
    if (anchor) stage.insertBefore(rootEl, anchor); else stage.appendChild(rootEl);
    var fxEl = document.createElement('div');
    fxEl.className = 'tw tw--fx';
    fxEl.setAttribute('aria-hidden', 'true');
    fxEl.dataset.on = '0';
    stage.appendChild(fxEl);

    var defsSvg = el('svg', { 'class': 'tw-defs', width: 0, height: 0 }, rootEl);
    root.ThemeXmas.defs(defsSvg, 'tw-');
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
    // Treibgut vom Tsunami (Schneekugeln, Hüte, Nase, Knöpfe)
    var gFloats = el('g', { 'class': 'tw-dim' }, svg);
    var gIce = el('g', { 'class': 'tw-ice tw-shk' }, svg);
    var gBaubleBox = el('g', { 'class': 'tw-x tw-baubles' }, svg);
    var gBaubles = el('g', { 'class': 'tw-shk' }, gBaubleBox);
    var gLightBox = el('g', { 'class': 'tw-x tw-lights' }, svg);
    var gLights = el('g', { 'class': 'tw-shk' }, gLightBox);

    // ── Xmas-Deko (js/theme-xmas.js): Lichterkette, Kugeln, Baum, Geschenke ──
    var X = root.ThemeXmas.create({
      root: rootEl, tree: gTreeShk, baubles: gBaubles, lights: gLights, baubleList: BAUBLES,
      x: TREE_X, y: TREE_Y, k: TREE_K, pfx: 'tw-', snow: true,
      rnd: rnd, seed: function (n) { seed = n; }, bulbs: root.ThemeXmas.bulbs(rnd),
      mound: { cls: 'tw-mound', d: 'M-80 540 Q-48 504 22 506 Q104 492 200 498 Q298 490 378 504 Q448 506 480 540 Z' },
      tag: function (text, x, y, long) { tag(text, x, y, false, long); },
      board: function (title, rows) { showBoard(title, rows); },
      onSync: function () { syncMinis(); }
    });
    var treeToScreen = X.toScreen;
    function stringAlong(parent, d, step, baseRot, size, small) { return X.bulbs.stringAlong(parent, d, step, baseRot, size, small, true); }

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
      [-200, -176, -152].forEach(function (y) { el('circle', { 'class': 'tw-sm-coal tw-sm-btn', cx: 0, cy: y, r: 6 }, g); });
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
    var minis = [], miniNext = 0, miniTotal = 0, miniGen = 0;

    function surface(x) { return H - coverH(x, S.shown / 100); }
    function xmasShown() { return X.shown(); }
    function partOn(k) { return S.partsOn[k] !== false; }

    // Sind alle Plätze belegt, macht der älteste Platz: er rollt zur Kante
    // hinaus, ab und zu holt ihn eine Krähe; der Neue entsteht danach
    function addMini(name, animate) {
      var i = miniNext % MINI_SLOTS.length, old = minis[i];
      miniNext++;
      if (old && animate && root.ThemeSeasons) {
        minis[i] = null;
        var gen = miniGen;
        var wait = root.ThemeSeasons.leave(old.outer, { x: old.x, top: miniTop(old), r: 22 * old.k, crow: Math.random() < 0.25 });
        setTimeout(function () { if (gen === miniGen && !minis[i]) putMini(name, i, true); }, wait);
        return;
      }
      if (old) old.outer.parentNode.removeChild(old.outer);
      putMini(name, i, animate);
    }
    function putMini(name, i, animate) {
      var slot = MINI_SLOTS[i];
      // nach Tiefe einsortieren: wer höher steht (weiter hinten), liegt dahinter
      var outer = el('g', {}), before = null;
      outer.twDepth = slot[2];
      for (var c = gMinis.firstChild; c; c = c.nextSibling) if (c !== outer && c.twDepth < slot[2]) { before = c; break; }
      gMinis.insertBefore(outer, before);
      // fly: Flug im Tornado (der Schneehügel bleibt am Boden)
      var fly = el('g', {}, outer);
      var g = el('g', { 'class': 'tw-mini' + (animate ? ' tw-mini--new' : '') }, fly);
      // danach weg, sonst spielt ein späterer Scheinwerfer das Aufploppen erneut ab
      if (animate) setTimeout(function () { g.classList.remove('tw-mini--new'); }, 1100);
      el('circle', { 'class': 'tw-mini__ball', cx: 0, cy: -20, r: 22 }, g);
      el('circle', { 'class': 'tw-mini__ball', cx: 0, cy: -54, r: 15 }, g);
      el('circle', { 'class': 'tw-sm-coal', cx: -5, cy: -57, r: 2.4 }, g);
      el('circle', { 'class': 'tw-sm-coal', cx: 5, cy: -57, r: 2.4 }, g);
      el('path', { 'class': 'tw-sm-nose', d: 'M0 -53 L14 -50 L0 -48 Z' }, g);
      var hatG = el('g', { 'class': 'tw-mini__hatg' }, g);
      el('path', { 'class': 'tw-mini__hat' + (1 + Math.floor((root.ThemeSeasons ? root.ThemeSeasons.nameRand(name, 1) : (i % 4) / 4) * 4)), d: 'M-16 -64 Q0 -98 16 -64 Z' }, hatG);
      el('circle', { 'class': 'tw-mini__pom', cx: 0, cy: -83, r: 5 }, hatG);
      // Schneehügel vor dem Mini (Sturm, Lawine)
      var mound = el('path', { 'class': 'tw-mini__mound' }, outer);
      minis[i] = { outer: outer, inner: g, fly: fly, hatG: hatG, mound: mound, x: slot[0], k: slot[1], depth: slot[2], rot: slot[3], label: name,
                   bz: 0, av: 0, avAt: null, avHold: 0, wait: null, shown: -1,
                   mode: null, ly: 0, lx: 0, spin: 0, vy: 0, peak: 0, held: 0, tw: null, drop: null, flown: '' };
      placeMini(minis[i]);
      if (animate && S.on && partOn('minis')) miniTag(minis[i], name);
    }
    // Kurzbesuch (!whereiam, nicht im Bild): Mini rollt neben einen Platz, etwas
    // nach vorn; er gehört keinem Platz (minis bleibt unverändert)
    function visitMini(name) {
      if (!root.ThemeSeasons) return;
      var i = Math.floor(Math.random() * MINI_SLOTS.length), keep = minis[i];
      putMini(name, i, false);
      var v = minis[i];
      minis[i] = keep;
      v.x += v.x < W / 2 ? 34 : -34;
      v.depth = Math.max(0, v.depth - 0.25);
      placeMini(v);
      root.ThemeSeasons.visit(v.outer, { x: v.x, top: miniTop(v), r: 22 * v.k, roll: true,
        arrive: function () { if (SK) SK.hop(v.inner); tag(name + ' drops by!', v.x, miniTop(v) - 12, true); } });
    }
    // Fuß bei Tiefe 0 vorn am unteren Rand, bei 1 oben auf der Schneedecke;
    // je höher der Schnee, desto weiter stehen vorn und hinten auseinander
    function miniFoot(m) { return H - 4 - m.depth * Math.max(22, H - surface(m.x)); }
    function miniTop(m) { return miniFoot(m) - 110 * m.k; }
    function placeMini(m) {
      m.outer.setAttribute('transform', 'translate(' + m.x + ' ' + f1(miniFoot(m)) + ') rotate(' + m.rot +
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
    function syncXmas() { X.sync(); }

    // ── Animationen zu den Befehlen ──
    function celebrate(name) {
      X.celebrate();
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
    var splats = 0, SPLAT_MAX = 6;
    function snowball(name) {
      var tx = rand(500, 1420), ty = rand(300, 700), sx = rand(300, 1620), sy = H + 40;
      var who = name || 'Someone';
      if (SK) SK.crowd('snowball', who, function (n) { return n + ' threw a snowball!'; },
                       function (n) { return n + ' threw snowballs too!'; }, function (t) { tag(t, tx, ty - 110, true); });
      else tag(who + ' threw a snowball!', tx, ty - 110, true);
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
        // höchstens SPLAT_MAX Flecken zugleich, sonst deckt ein Ansturm das Spiel zu;
        // weitere Bälle zerstäuben nur in Flocken
        if (splats < SPLAT_MAX) {
          splats++;
          el('path', { 'class': 'tw-splat', d: d + ' Z' }, g);
          el('path', { 'class': 'tw-splat', d: 'M-20 30 Q-18 90 -12 92 Q-6 90 -6 30 Z M14 34 Q16 70 20 72 Q26 70 26 34 Z' }, g);
          setTimeout(function () { splats--; if (outer.parentNode) fxSvg.removeChild(outer); }, reduceMotion ? 2500 : 5100);
        } else if (outer.parentNode) fxSvg.removeChild(outer);
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
      var xm = X.followAsOrnament();
      X.ornament(name, xm && S.on);
      addMini(name, !xm && S.on);
      miniTotal++;
    }
    // Minis verschwinden, sobald der Baum steht, und kommen nach dem Abschied wieder
    function minisHidden() {
      return X.followersHidden();
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
      var base = miniFoot(m);
      for (var i = 0; i < 12; i++) {
        addP({ x: m.x + rand(-20, 20) * m.k, y: base - rand(20, 70) * m.k, vx: rand(-220, 220), vy: rand(-420, -150),
               term: 500, sway: 0, r: rand(2, 5), life: 1.2, floor: surface, draw: flake });
      }
    }
    // Blitz trifft einen Mini (nah, höchstens 70 px daneben): er zerstiebt,
    // nach 8–14 s steht er mit der Aufbau-Animation wieder (Follower bleibt)
    function miniBolt(p) {
      if (!S.on || reduceMotion || !p.near || typeof p.x !== 'number' || !partOn('minis') || minisHidden()) return;
      var best = null;
      // auch im Tornado fliegende (dort, wo sie gerade sind); in der Luft öfter
      minis.forEach(function (m) {
        if (!m || m.zap || m.bz > 0.5 || m.av > 0.3 || Math.abs(m.x + m.lx - p.x) > 70) return;
        if (!best || Math.abs(m.x + m.lx - p.x) < Math.abs(best.x + best.lx - p.x)) best = m;
      });
      var airborne = best && (best.mode === 'up' || best.mode === 'fall');
      if (!best || Math.random() < (airborne ? 0.35 : 0.65)) return;   // nicht jeder Blitz trifft
      var m = best, mx = m.x + m.lx, cy = miniFoot(m) - 40 * m.k - m.ly;
      if (p.ground) p.ground(mx, cy);
      dropTag(m);
      landMini(m);
      m.zap = true;
      m.outer.dataset.zap = '1';
      for (var i = 0; i < 30; i++) {
        addP({ x: mx + rand(-15, 15) * m.k, y: cy + rand(-30, 20) * m.k, vx: rand(-420, 420), vy: rand(-650, -100),
               term: 600, sway: 0, r: rand(2, 6), life: rand(1, 1.8), floor: surface, draw: i % 6 ? flake : spark });
      }
      if (opts.event) opts.event('struck', { target: 'snowman', name: m.label || '' });
      setTimeout(function () {
        m.zap = false;
        delete m.outer.dataset.zap;
        m.inner.classList.remove('tw-mini--new');
        void m.inner.getBBox();
        m.inner.classList.add('tw-mini--new');
        // danach wieder weg, sonst fällt er nach jedem Scheinwerfer-Wackeln neu
        setTimeout(function () { m.inner.classList.remove('tw-mini--new'); }, 1100);
        // der Name erst, wenn er wieder da ist
        if (m.label && S.on && partOn('minis') && !minisHidden()) setTimeout(function () { miniTag(m, m.label); }, 600);
      }, rand(8000, 14000));
    }
    // ── Tornado: schnappt sich Minis, wirbelt sie hoch, der Hut fliegt davon;
    // eine andere Windhose kann sie übernehmen (wie die Kürbisse im Herbst) ──
    function grabMinis() {
      if (reduceMotion || !S.on || !partOn('minis') || minisHidden()) return;
      var pool = minis.filter(function (m) { return m && !m.zap && !m.mode && m.bz < 0.5 && m.av < 0.3; });
      var n = Math.min(pool.length, 2 + Math.floor(Math.random() * 3));
      for (var i = 0; i < n; i++) {
        var j = Math.floor(Math.random() * pool.length);
        pool[j].mode = 'wait';
        pool[j].peak = rand(170, 280);
        pool.splice(j, 1);
      }
    }
    function renderFly(m) {
      followTag(m);
      var tr = m.ly < 0.3 && Math.abs(m.lx) < 0.3 && Math.abs(m.spin) < 0.3 ? ''
        : 'translate(' + f1(m.lx / m.k) + ' ' + f1(-m.ly / m.k) + ') rotate(' + f1(m.spin) + ' 0 -40)';
      if (tr === m.flown) return;
      m.flown = tr;
      m.fly.setAttribute('transform', tr);
    }
    function blowHat(m, dir) {
      m.hatG.style.setProperty('--tw-hat-dir', dir < 0 ? -1 : 1);
      m.hatG.classList.remove('is-back');
      m.hatG.classList.add('is-blown');
    }
    function hatBack(m) {
      if (!m.hatG.classList.contains('is-blown')) return;
      m.hatG.classList.remove('is-blown');
      m.hatG.classList.add('is-back');
      setTimeout(function () { m.hatG.classList.remove('is-back'); }, 700);
    }
    function landMini(m) {
      m.mode = null; m.ly = 0; m.lx = 0; m.spin = 0; m.vy = 0; m.tw = m.drop = null;
      hatBack(m);
      renderFly(m);
    }
    function stepFly(m, dt) {
      var px = m.x + m.lx, tn = tws ? tws.near(px, m.mode === 'up' ? m.tw : m.drop) : null;
      if (tn && Math.abs(tn.x - px) < 100 && !m.zap &&
          (m.mode === 'wait' || (m.mode === 'up' && m.held > 1) || m.mode === 'fall')) {
        if (m.mode === 'wait') blowHat(m, tn.dir || (tn.x < m.x ? 1 : -1));
        else m.peak = Math.min(360, Math.max(m.peak, m.ly) + rand(30, 80));
        m.mode = 'up'; m.tw = tn.t; m.held = 0;
      }
      if (m.mode === 'up') {
        m.held += dt;
        var tx = m.tw && m.tw.active() ? m.tw.x() : null, dir = (m.tw && m.tw.dir) || 1;
        m.ly += (m.peak - m.ly) * Math.min(1, dt * 2.2);
        m.lx += (Math.max(-130, Math.min(130, ((tx === null ? m.x : tx) - m.x) * 0.6)) + Math.sin(tNow * 7 + m.x) * 30 - m.lx) * Math.min(1, dt * 3);
        m.spin += dt * 300 * dir;
        if (tx === null || (tx - m.x) * dir > 220) { m.mode = 'fall'; m.vy = 0; m.drop = m.tw; m.tw = null; }
      } else if (m.mode === 'fall') {
        m.vy += 2200 * dt;
        m.ly -= m.vy * dt;
        m.lx *= Math.pow(0.02, dt);
        m.spin += (Math.round(m.spin / 360) * 360 - m.spin) * Math.min(1, dt * 6);
        if (m.ly <= 0) {
          m.ly = 0;
          if (m.vy > 500) { m.vy = -m.vy * 0.3; digPuff(m); }
          else landMini(m);
        }
      } else if (m.mode === 'wait' && !(tws && tws.any())) {
        m.mode = null;
      }
      renderFly(m);
    }
    // Namensschild am Mini: folgt ihm im Flug, verschwindet, wenn er zerstiebt
    function miniTag(m, text, big) {
      var t = tag(text, m.x + m.lx, miniTop(m) - m.ly, big);
      if (t) m.tag = { el: t, lx: m.lx, ly: m.ly };
    }
    function followTag(m) {
      var t = m.tag;
      if (!t) return;
      if (!t.el.parentNode) { m.tag = null; return; }
      var dx = m.lx - t.lx, dy = t.ly - m.ly;
      t.el.setAttribute('transform', Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3 ? '' : 'translate(' + f1(dx) + ' ' + f1(dy) + ')');
    }
    function dropTag(m) {
      if (!m.tag) return;
      var el2 = m.tag.el;
      m.tag = null;
      el2.classList.add('name-tag--out');
      setTimeout(function () { if (el2.parentNode) el2.parentNode.removeChild(el2); }, 300);
    }
    // ── Tsunami: die Welle reißt Minis in Kugeln auseinander, die samt Hut auf
    // dem Wasser treiben und zerfallen; nach dem Ablaufen bauen sie sich in
    // 10–20 s wieder auf. Der große Schneemann bleibt stehen, verliert aber
    // Hut, Nase und Knöpfe, die davontreiben, und holt sie sich danach zurück.
    // Treibgut kann eine Windhose schnappen ──
    var wave = null, floats = [], smWashed = false, smBack = 0;
    function floater(node, x, y, k, kind) {
      var g = el('g', {}, gFloats);
      g.appendChild(node);
      floats.push({ g: g, x: x, y: y, k: k, kind: kind, life: 1, spin: rand(-20, 20), vx: rand(-40, 40), vy: 0,
                    mode: 'float', tw: null, drop: null, held: 0, ph: rand(0, 6.3) });
    }
    function centered(node, dx, dy) {
      var w = el('g', { transform: 'translate(' + dx + ' ' + dy + ')' });
      w.appendChild(node);
      return w;
    }
    function washMini(m) {
      m.washed = true; m.zap = true;
      m.outer.dataset.zap = '1';
      dropTag(m);
      var top = miniFoot(m);
      floater(el('circle', { 'class': 'tw-mini__ball', r: 22 }), m.x - 10, top - 20 * m.k, m.k, 'ball');
      floater(el('circle', { 'class': 'tw-mini__ball', r: 15 }), m.x + 12, top - 54 * m.k, m.k, 'ball');
      var hat = m.hatG.cloneNode(true);
      hat.classList.remove('is-blown', 'is-back');
      floater(centered(hat, 0, 80), m.x + 4, top - 80 * m.k, m.k, 'hat');
      for (var i = 0; i < 14; i++) {
        addP({ x: m.x + rand(-20, 20) * m.k, y: top - rand(10, 70) * m.k, vx: rand(-260, 260), vy: rand(-420, -120),
               term: 500, sway: 0, r: rand(2, 5), life: 1.2, draw: flake });
      }
      m.washWait = null;
    }
    function washSnowman() {
      smWashed = true;
      gSmBody.classList.add('is-washed');
      var base = surface(SM_X) + 26;
      var at = function (lx, ly) { return [SM_X + lx * SM_K, base + ly * SM_K]; };
      var p;
      if (S.sm >= 8 && rootEl.dataset.xmas !== '1') {
        var hat = gSmBody.querySelector('.tw-sm-hatg').cloneNode(true);
        p = at(0, -330); floater(centered(hat, 0, 330), p[0], p[1], SM_K, 'hat');
      }
      if (S.sm >= 5) { p = at(19, -260); floater(el('path', { 'class': 'tw-sm-nose', d: 'M-21 -6 L21 2 L-21 6 Z' }), p[0], p[1], SM_K, 'nose'); }
      if (S.sm >= 6) [-200, -176, -152].forEach(function (y) {
        p = at(0, y); floater(el('circle', { 'class': 'tw-sm-coal', r: 6 }), p[0], p[1], SM_K, 'coal');
      });
    }
    function stepFlood(dt) {
      var live = wave && wave.active() && S.on && !reduceMotion;
      if (wave && !wave.active()) wave = null;
      // großer Schneemann: Wasser über dem Fuß reißt die losen Teile ab
      if (live && !smWashed && partOn('snowman') && S.sm >= 5 && wave.level(SM_X) > H - (surface(SM_X) + 26) + 50) washSnowman();
      if (smWashed && !live) {
        if (!smBack) smBack = rand(6, 12);
        smBack -= dt;
        if (smBack <= 0) {
          smWashed = false; smBack = 0;
          gSmBody.classList.remove('is-washed');
          gSmBody.classList.add('is-back');
          setTimeout(function () { gSmBody.classList.remove('is-back'); }, 800);
        }
      }
      floats = floats.filter(function (f) {
        var lvl = live ? wave.level(f.x) : 0, water = H - lvl;
        var tn = tws ? tws.near(f.x, f.mode === 'up' ? f.tw : f.drop) : null;
        if (tn && Math.abs(tn.x - f.x) < 100 && (f.mode !== 'up' || f.held > 1)) {
          f.mode = 'up'; f.tw = tn.t; f.held = 0; f.peak = Math.min(H - 150, Math.max(H - f.y, 0) + rand(150, 300));
        }
        if (f.mode === 'up') {
          f.held += dt;
          var tx = f.tw && f.tw.active() ? f.tw.x() : null, dir = (f.tw && f.tw.dir) || 1;
          f.y += ((H - f.peak) - f.y) * Math.min(1, dt * 2.4);
          f.x += ((tx === null ? f.x : tx) + Math.sin(tNow * 8 + f.ph) * 40 - f.x) * Math.min(1, dt * 3);
          f.spin += dt * 360 * dir;
          if (tx === null || tx < -100 || tx > W + 100) { f.mode = 'fall'; f.drop = f.tw; f.tw = null; f.vy = 0; f.vx = dir * 200; }
        } else if (live && f.y >= water - 4 && f.mode !== 'fall') {
          // auf dem Wasser: halb eingetaucht, schaukelt, treibt mit der Welle
          f.mode = 'float';
          f.y += (water - f.y) * Math.min(1, dt * 4);
          f.x += (f.vx + (wave.dir || 0) * 50) * dt;
          f.spin = Math.sin(tNow * 2 + f.ph) * 14;
          f.life -= dt / (f.kind === 'ball' ? 9 : 14);
        } else {
          // fällt (aus dem Wirbel oder ohne Wasser) und zerfällt am Boden
          f.vy += 1400 * dt;
          f.x += f.vx * dt; f.y += f.vy * dt;
          var floor = live ? Math.min(water, surface(f.x)) : surface(f.x);
          if (f.y >= floor) { f.y = floor; f.vy = 0; f.vx *= 0.5; f.mode = live && water <= surface(f.x) ? 'float' : 'ground'; }
          if (f.mode === 'ground') f.life -= dt / 1.5;
        }
        if (f.life <= 0 || f.x < -150 || f.x > W + 150) { f.g.parentNode.removeChild(f.g); return false; }
        var sc = f.k * (f.kind === 'ball' ? 0.4 + 0.6 * f.life : 1);
        f.g.setAttribute('transform', 'translate(' + f1(f.x) + ' ' + f1(f.y) + ') rotate(' + f1(f.spin) + ') scale(' + sc.toFixed(3) + ')');
        var op = Math.max(0, Math.min(1, f.life * 3, Math.min(f.x + 60, W + 60 - f.x) / 200)).toFixed(2);
        if (op !== f.op) { f.op = op; f.g.setAttribute('opacity', op); }
        return true;
      });
    }
    var tNow = 0;
    // Böe: Pulverschnee weht von der Schneedecke und von den Köpfen der
    // Minis, die Minis wackeln, Hüte sitzen kurz schief
    var gustTimer = null;
    function winterGust(p) {
      if (!S.on || reduceMotion) return;
      p = p || {};
      var dir = p.dir === 1 || p.dir === -1 ? p.dir : (Math.random() < 0.5 ? -1 : 1), gk = p.k > 0 ? p.k : 1;
      rootEl.style.setProperty('--tw-gust-dir', (dir * gk).toFixed(2));
      rootEl.dataset.gust = '1';
      clearTimeout(gustTimer);
      gustTimer = setTimeout(function () { rootEl.dataset.gust = '0'; }, 1700);
      if (partOn('cover') && S.shown > 3) {
        for (var i = 0; i < 80 * gk; i++) {
          var x = rand(0, W);
          addP({ x: x, y: surface(x) - rand(0, 8), vx: dir * gk * rand(500, 950), vy: -rand(40, 180), g: 160, term: 300,
                 sway: 0, r: rand(1.5, 3.5), life: rand(1, 1.8), draw: flake });
        }
      }
      if (partOn('minis') && !minisHidden()) minis.forEach(function (m) {
        if (!m || m.zap || m.mode) return;
        for (var j = 0; j < 6; j++) {
          addP({ x: m.x + rand(-12, 12) * m.k, y: miniTop(m) + rand(0, 20) * m.k, vx: dir * rand(350, 700), vy: -rand(60, 200), g: 200,
                 term: 300, sway: 0, r: rand(1.5, 3), life: rand(0.8, 1.4), draw: flake });
        }
      });
    }
    function stepMinis(dt) {
      tNow += dt;
      var visible = S.on && partOn('minis') && !minisHidden();
      var bzNow = visible && opts.blizzard ? clamp01(opts.blizzard()) : 0;
      var av = visible ? aval : null;
      var avT = av ? av.elapsed() : 0, avLive = av && av.active();
      minis.forEach(function (m) {
        if (!m) return;
        if (!visible) {
          m.bz = 0; m.av = 0; m.avAt = null; m.wait = null; renderMound(m);
          if (m.mode || m.ly) landMini(m);
          return;
        }
        if (!reduceMotion) stepFly(m, dt);
        // Tsunami: Welle über dem Fuß reißt ihn auseinander, danach baut er sich wieder auf
        if (wave && wave.active() && !reduceMotion && !m.zap && !m.mode && wave.level(m.x) > H - miniFoot(m) + 25 * m.k) washMini(m);
        if (m.washed && !(wave && wave.active())) {
          if (m.washWait === null) m.washWait = rand(10, 20);
          m.washWait -= dt;
          if (m.washWait <= 0) {
            m.washed = false; m.zap = false;
            delete m.outer.dataset.zap;
            m.inner.classList.remove('tw-mini--new');
            void m.inner.getBBox();
            m.inner.classList.add('tw-mini--new');
            setTimeout(function () { m.inner.classList.remove('tw-mini--new'); }, 1100);
          }
        }
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

    // ── Sturm: Baum und Schneemann schwingen mit Wind, Böen und naher Windhose
    //    gedämpft aus (wie der Strand-Baum); Minis zittern, solange sie zieht.
    //    Nur der Baum selbst biegt sich, Wehe und Geschenke bleiben ruhig ──
    var TREE_CX = TREE_X + 200 * TREE_K;
    var SWAY = root.ThemeSeasons ? root.ThemeSeasons.sway : null;
    var treeSway = SWAY && SWAY(), smSway = SWAY && SWAY();
    var tws = root.ThemeSeasons ? root.ThemeSeasons.twisters() : null, gustKick = 0, swayDrawn = '', smSwayDrawn = '', jigDrawn = '', quakeDrawn = '';
    function liveWind() { var sky = opts.sky ? opts.sky() : null; return sky ? (sky.wind || 0) : 0; }
    function stormy(w) {
      var sky = opts.sky ? opts.sky() : null, kind = sky ? sky.kind : '';
      var bz = opts.blizzard ? opts.blizzard() : 0;
      return kind === 'storm' || kind === 'blizzard' || bz > 0.3 || Math.abs(w) >= 0.8;
    }
    function stepSway(dt) {
      if (!SWAY) return;
      var on = S.on && !reduceMotion, w = liveWind(), storm = on && stormy(w);
      // jede Windhose zerrt an dem, was ihr am nächsten steht
      var nT = on && tws ? tws.near(TREE_CX) : null, nS = on && tws ? tws.near(SM_X) : null;
      var gust = on ? gustKick : 0;
      gustKick = 0;
      var tT = 0, sT = 0;
      if (on && partOn('tree') && xmasShown()) tT = nT && Math.abs(nT.x - TREE_CX) < 320 ? 6 : storm ? 2.2 : 0;
      if (on && partOn('snowman') && S.sm > 0) sT = nS && Math.abs(nS.x - SM_X) < 320 ? 4 : storm ? 1 : 0;
      var dir = w < 0 ? -1 : 1;
      var a = treeSway(dt, tT, gust, dir).toFixed(2), b = smSway(dt, sT, gust * 0.5, dir).toFixed(2);
      if (a !== swayDrawn) { swayDrawn = a; rootEl.style.setProperty('--twb-sway', a); }
      if (b !== smSwayDrawn) { smSwayDrawn = b; rootEl.style.setProperty('--tw-sm-sway', b); }
      // Kugeln am Baum wackeln, solange die Windhose ihn biegt
      var jig = tT >= 6 ? '1' : '';
      if (jig !== jigDrawn) { jigDrawn = jig; rootEl.dataset.jiggle = jig; }
      var quake = on && tws && tws.any() && partOn('minis') && !minisHidden() ? '1' : '';
      if (quake !== quakeDrawn) { quakeDrawn = quake; rootEl.dataset.quake = quake; }
    }

    // ── Hauptschleife ──
    var last = null, dirty = true, dripAcc = 0, wasOn = false;
    function frame(ts) {
      var dt = last === null ? 0 : Math.min((ts - last) / 1000, 0.05);
      last = ts;
      X.step(dt);
      X.flood(wave && wave.active() && S.on ? wave.level : null, dt);
      stepFlood(dt);
      syncMinis();
      stepSway(dt);
      // Schneedecke folgt dem Server-Stand weich
      var prev = S.shown;
      if (reduceMotion) S.shown = S.target;
      else if (S.shown !== S.target) {
        var diff = S.target - S.shown, stp = Math.max(1.5, Math.abs(diff) * 0.8) * dt;
        S.shown = Math.abs(diff) <= stp ? S.target : S.shown + (diff > 0 ? stp : -stp);
      }
      if (Math.abs(prev - S.shown) > 0.001) dirty = true;
      // Hitze: Schneemann schrumpft langsam und erholt sich wieder
      if (S.nightT !== undefined && S.night !== S.nightT) {
        var nd = S.nightT - S.night, ns = dt / 4;
        S.night = Math.abs(nd) <= ns ? S.nightT : S.night + (nd > 0 ? ns : -ns);
        dirty = true;
      }
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
      if (!S.on || X.busy() || (root.ThemeSeasons && root.ThemeSeasons.visiting())) return;
      spotRound++;
      var pool = [];
      X.spotPool(pool);
      if (partOn('minis') && !minisHidden()) minis.forEach(function (m) { if (m && m.label && !m.zap) pool.push({ node: m.inner, label: m.label, p: [m.x, miniTop(m)], mini: m }); });
      if (!pool.length) return;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      if (lastSpot && pick.label === lastSpot && pool.length > 1) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
      lastSpot = pick.label;
      if (SK) SK.spot(pick.node);
      if (pick.mini) miniTag(pick.mini, pick.label); else tag(pick.label, pick.p[0], pick.p[1]);
    }, 8000);

    showSnowman(0);
    syncXmas();

    var PART_KEYS = ['lights', 'tree', 'baubles', 'gifts', 'snowman', 'minis', 'icicles', 'cover'];
    return {
      load: function (deco) {
        if (!deco) return;
        X.load(deco);
        clear(gMinis); minis = []; miniNext = 0; miniGen++;
        (deco.minis || []).forEach(function (m) { addMini(m.name || '', false); });
        miniTotal = deco.mini_total || 0;
        var proj = deco.project != null ? deco.project : deco.snowman;
        clearTimeout(smClearTimer);
        gSm.classList.remove('is-clearing');
        S.sm = Math.max(0, Math.min(8, parseInt(proj, 10) || 0));
        showSnowman(0);
      },
      update: function (s) {
        s = s || {};
        S.on = s.theme === 'winter';
        S.xmas = s.xmas || 'off';
        if (typeof s.snowCover === 'number') {
          S.target = Math.max(0, Math.min(100, s.snowCover));
          // beim ersten Stand sofort, danach wächst/schmilzt die Decke sichtbar
          if (S.first) { S.shown = S.target; dirty = true; }
          S.first = false;
        }
        if (Array.isArray(s.snowTop)) S.snowTop = s.snowTop;
        S.heatT = (s.heat || 0) > 0.5 ? 1 : 0;
        // Nacht kommt weich: die Schleife gleitet S.night in ~4 s nach
        S.nightT = clamp01(s.night || 0);
        if (S.night === undefined) S.night = S.nightT;
        rootEl.dataset.night = Math.max(S.night, S.nightT) > 0.05 ? '1' : '0';
        var p = s.parts || {};
        PART_KEYS.forEach(function (k) {
          S.partsOn[k] = p[k] !== false;
          rootEl.dataset[k] = p[k] === false ? '0' : '1';
        });
        rootEl.dataset.on = S.on ? '1' : '0';
        fxEl.dataset.on = S.on ? '1' : '0';
        dirty = true;
        X.update(S.on, S.xmas, S.partsOn);
      },
      command: function (cmd, p) {
        p = p || {};
        switch (cmd) {
          case 'ornament':
            X.ornament(p.name || '', true); break;
          case 'gift':
            X.gift({ name: p.name || '', type: p.type, amount: parseInt(p.amount, 10) || 1 }, true); break;
          case 'mini':
            addMini(p.name || '', true); miniTotal++; break;
          case 'follow':
            follow(p.name || ''); break;
          case 'build':
            build(p.name || '', S.on); break;
          case 'whereami': {
            var me = (p.name || '').toLowerCase(), pool = [];
            X.spotPool(pool);
            if (partOn('minis') && !minisHidden()) minis.forEach(function (m) { if (m && m.label && !m.zap) pool.push({ node: m.inner, label: m.label, p: [m.x, miniTop(m)], mini: m }); });
            var hit = pool.filter(function (q) { return q.label.toLowerCase() === me; })[0];
            if (hit && S.on && SK) { SK.hop(hit.node); if (hit.mini) miniTag(hit.mini, hit.label + ' is right here!'); else tag(hit.label + ' is right here!', hit.p[0], hit.p[1]); }
            else if (!hit && p.visit && S.on) {
              if (minisHidden()) X.visit(p.name || '');
              else if (partOn('minis')) visitMini(p.name || '');
            }
            break;
          }
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
            if (p.type === 'tsunami' && !p.reduced) wave = p;
            if (tws) { tws.add(p); if (p.type === 'tornado' && !p.reduced) grabMinis(); }
            break;
          case 'gust':
            gustKick = 3 * (p && p.k > 0 ? p.k : 1); winterGust(p); break;
          case 'bolt':
            miniBolt(p); break;
          case 'clear':
            if (p.kind === 'ornaments' || p.kind === 'gifts') X.clear(p.kind);
            else if (p.kind === 'minis') { clear(gMinis); minis = []; miniNext = 0; miniGen++; miniTotal = 0; }
            else if (p.kind === 'snow') { S.target = 0; S.snowTop = []; }
            else if (p.kind === 'snowman') { S.sm = 0; showSnowman(0); }
            break;
        }
      },
      playSetup: function (done) { X.start('setup', done); },
      playFarewell: function (done) { X.start('farewell', done); },
      busy: function () { return X.busy(); },
      status: function () {
        return { on: S.on, xmas: S.xmas, shown: xmasShown(), snow: Math.round(S.shown), snowman: S.sm,
                 ornaments: X.totals().ornaments, gifts: X.totals().gifts, minis: miniTotal };
      }
    };
  }

  root.ThemeWinter = { create: create };
})(typeof window !== 'undefined' ? window : this);
