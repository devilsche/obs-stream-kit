/* Gemeinsame Grundlage der Jahreszeiten-Themen Herbst, Frühling, Sommer der
 * Weather-Source (js/theme-autumn.js, theme-spring.js, theme-summer.js):
 * Ebenen (Deko unter dem Wetter, Effekte darüber), Partikel mit Wind,
 * Namensschilder, Rangliste und Gruppen-Fortschritt im HUD, Sichtbarkeit
 * und Teil-Schalter. Braucht js/season-kit.js.
 *
 *   var B = ThemeSeasons.base(stageEl, opts, 'autumn', PART_KEYS);
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
  // Pseudozufall mit festem Startwert: Deko sieht bei jedem Laden gleich aus
  function seeded(s) {
    return function () { s = (s * 16807) % 2147483647; return s / 2147483647; };
  }
  function yes(v) { return v === true || v === 'true' || v === 1 || v === '1'; }

  function base(stage, opts, name, partKeys) {
    opts = opts || {};
    var SK = root.SeasonKit;
    var tagsLayer = opts.tags || null;
    var hud = opts.hud || null;

    // Deko unter Blitz-Aufhellung und Wetter-Partikeln, Effekte darüber
    var rootEl = document.createElement('div');
    rootEl.className = 'ts ts--' + name;
    rootEl.setAttribute('aria-hidden', 'true');
    rootEl.dataset.on = '0';
    var anchor = stage.querySelector('.wk-flash') || stage.querySelector('.wk-particles');
    if (anchor) stage.insertBefore(rootEl, anchor); else stage.appendChild(rootEl);
    var fxEl = document.createElement('div');
    fxEl.className = 'ts ts--' + name + ' ts--fx';
    fxEl.setAttribute('aria-hidden', 'true');
    fxEl.dataset.on = '0';
    stage.appendChild(fxEl);

    function canvas(parent) {
      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      c.className = 'ts-layer';
      parent.appendChild(c);
      return c;
    }
    function svgLayer(parent, cls) {
      return el('svg', { 'class': 'ts-layer' + (cls ? ' ' + cls : ''), viewBox: '0 0 1920 1080' }, parent);
    }
    var defsSvg = el('svg', { 'class': 'ts-defs', width: 0, height: 0 }, rootEl);
    var defs = el('defs', {}, defsSvg);
    var back = SK ? SK.Particles(canvas(rootEl), 700) : null;
    var frontCanvas = canvas(fxEl);
    var front = SK ? SK.Particles(frontCanvas, 700) : null;
    var fxSvg = svgLayer(fxEl);

    // lange Schilder ganz ins Bild rücken (Breite grob geschätzt)
    function tag(text, x, y, big) {
      if (!SK || !tagsLayer || !text) return;
      var half = String(text).length * (big ? 8.5 : 5) + 30;
      x = Math.max(half, Math.min(W - half, x));
      SK.tag(tagsLayer, text, x, y, !!big);
    }
    function spot(node) { if (SK && node) SK.spot(node); }

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
    function board(title, rows) {
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
    function group(text, frac, ms) {
      if (!groupBox) return;
      groupText.textContent = text;
      groupBox.style.setProperty('--hudp', clamp01(frac).toFixed(3));
      groupBox.classList.add('is-on');
      clearTimeout(groupTimer);
      groupTimer = setTimeout(function () { groupBox.classList.remove('is-on'); }, ms);
    }

    // CSS-Variablen auf beiden Wurzeln, nur bei Änderung
    var lastVars = {};
    function vars(obj) {
      for (var k in obj) {
        var v = typeof obj[k] === 'number' ? obj[k].toFixed(3) : String(obj[k]);
        if (lastVars[k] === v) continue;
        lastVars[k] = v;
        rootEl.style.setProperty(k, v);
        fxEl.style.setProperty(k, v);
      }
    }
    // Kurzer Effekt über ein data-Attribut, Animationen starten neu
    var pulseTimers = {};
    function pulse(attr, ms) {
      [rootEl, fxEl].forEach(function (n) { n.dataset[attr] = '0'; });
      void rootEl.getBoundingClientRect();
      [rootEl, fxEl].forEach(function (n) { n.dataset[attr] = '1'; });
      clearTimeout(pulseTimers[attr]);
      pulseTimers[attr] = setTimeout(function () {
        [rootEl, fxEl].forEach(function (n) { n.dataset[attr] = '0'; });
      }, ms);
    }

    // ── Zustand: Sichtbarkeit, Nacht, Wetter, Teil-Schalter ──
    var B = {
      W: W, H: H, reduceMotion: reduceMotion,
      root: rootEl, fx: fxEl, defs: defs, fxSvg: fxSvg, back: back, front: front,
      on: false, night: 0, rain: 0, heat: 0, sun: 0, windBase: 0, gustPx: 0, partsOn: {},
      el: el, clear: clear, f1: f1, rand: rand, clamp01: clamp01, seeded: seeded, yes: yes,
      canvas: function () { return canvas(rootEl); },
      svg: function (cls) { return svgLayer(rootEl, cls); },
      tag: tag, spot: spot, board: board, group: group, vars: vars, pulse: pulse,
      partOn: function (k) { return B.partsOn[k] !== false; },
      // Weather-Zustand übernehmen; liefert true, wenn das Thema sichtbar ist
      apply: function (s) {
        B.on = s.theme === name;
        B.night = clamp01(s.night || 0);
        B.rain = clamp01((s.rain || 0) + 0.5 * (s.drizzle || 0));
        B.heat = clamp01(s.heat || 0);
        B.sun = clamp01(s.sun || 0);
        B.windBase = Math.max(-1, Math.min(1, s.wind || 0));
        var p = s.parts || {};
        (partKeys || []).forEach(function (k) {
          B.partsOn[k] = p[k] !== false;
          rootEl.dataset[k] = p[k] === false ? '0' : '1';
          fxEl.dataset[k] = rootEl.dataset[k];
        });
        rootEl.dataset.on = B.on ? '1' : '0';
        fxEl.dataset.on = rootEl.dataset.on;
        rootEl.dataset.night = B.night > 0.5 ? '1' : '0';
        rootEl.dataset.wet = B.rain > 0.1 ? '1' : '0';
        return B.on;
      },
      // Böe: Partikel werden kräftig zur Seite gedrückt
      gust: function (px) {
        var dir = B.windBase > 0.05 ? 1 : B.windBase < -0.05 ? -1 : (Math.random() < 0.5 ? -1 : 1);
        B.gustPx = dir * (px || 900);
        return dir;
      },
      // Wind (px/s) aus dem Wetter plus abklingender Böe auf beide Partikel-Ebenen
      stepParticles: function (dt) {
        B.gustPx *= Math.pow(0.3, dt);
        var w = B.windBase * 320 + B.gustPx;
        if (back) { back.windTarget = w; back.step(dt); }
        if (front) { front.windTarget = w; front.step(dt); }
      },
      windPx: function () { return B.windBase * 320 + B.gustPx; }
    };
    return B;
  }

  // Hauptschleife je Thema: läuft immer, zeichnet nur sichtbar (und einmal danach)
  function loop(fn) {
    var last = null;
    function frame(ts) {
      var dt = last === null ? 0 : Math.min((ts - last) / 1000, 0.05);
      last = ts;
      fn(dt, ts);
      root.requestAnimationFrame(frame);
    }
    root.requestAnimationFrame(frame);
  }

  root.ThemeSeasons = { base: base, loop: loop, seeded: seeded, el: el, W: W, H: H };
})(typeof window !== 'undefined' ? window : this);
