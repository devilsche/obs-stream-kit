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
    // Feuer liegt unter den Spektakeln (Tsunami, Nebelwand, Lawine ziehen davor)
    var fireEl = document.createElement('div');
    fireEl.className = 'ts ts--' + name + ' ts--fx';
    fireEl.setAttribute('aria-hidden', 'true');
    fireEl.dataset.on = '0';
    var fxAnchor = stage.querySelector('.wk-fx');
    if (fxAnchor) stage.insertBefore(fireEl, fxAnchor); else stage.insertBefore(fireEl, fxEl);

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
    function tag(text, x, y, big, long) {
      if (!SK || !tagsLayer || !text) return null;
      var half = String(text).length * (big ? 8.5 : 5) + 30;
      x = Math.max(half, Math.min(W - half, x));
      return SK.tag(tagsLayer, text, x, y, !!big, !!long);
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
      on: false, night: 0, rain: 0, heat: 0, sun: 0, windBase: 0, gustPx: 0, gustK: 1, partsOn: {}, snow: 0,
      el: el, clear: clear, f1: f1, rand: rand, clamp01: clamp01, seeded: seeded, yes: yes,
      canvas: function () { return canvas(rootEl); },
      svg: function (cls) { return svgLayer(rootEl, cls); },
      tag: tag, spot: spot, board: board, group: group, vars: vars, pulse: pulse,
      partOn: function (k) { return B.partsOn[k] !== false; },
      // Weather-Zustand übernehmen; liefert true, wenn das Thema sichtbar ist
      apply: function (s) {
        B.on = s.theme === name;
        // Nacht kommt weich (stepSnow gleitet B.night in ~4 s nach)
        B.nightT = clamp01(s.night || 0);
        if (B.night === undefined || B.firstNight !== false) { B.night = B.nightT; B.firstNight = false; }
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
        fireEl.dataset.on = rootEl.dataset.on;
        rootEl.dataset.night = B.night > 0.5 ? '1' : '0';
        rootEl.dataset.wet = B.rain > 0.1 ? '1' : '0';
        return B.on;
      },
      // Böe: Partikel werden kräftig zur Seite gedrückt
      // p = {dir, k} vom Kit (Richtung und Stärke der Böe); B.gustK für die Themen
      gust: function (px, p) {
        p = p || {};
        var dir = p.dir === 1 || p.dir === -1 ? p.dir : (Math.random() < 0.5 ? -1 : 1);
        B.gustK = p.k > 0 ? p.k : 1;
        B.gustPx = dir * (px || 900) * B.gustK;
        return dir;
      },
      // Wind (px/s) aus dem Wetter plus abklingender Böe auf beide Partikel-Ebenen
      stepParticles: function (dt) {
        B.gustPx *= Math.pow(0.3, dt);
        var w = B.windBase * 320 + B.gustPx;
        if (back) { back.windTarget = w; back.step(dt); }
        if (front) { front.windTarget = w; front.step(dt); }
      },
      windPx: function () { return B.windBase * 320 + B.gustPx; },
      // Schnee-Stand 0..1,2 (Schneehauben, hängende Köpfe) aus dem Live-Wetter:
      // wächst mit der Schneemenge, Schneesturm macht dicker; danach in ~1 min
      // weg. Ausgeblendet sofort 0. Setzt --ts-snow, liefert den Stand.
      stepSnow: function (dt) {
        // Nacht gleitet (keine harte Umschaltung bei fester Lage „Night“)
        if (B.nightT !== undefined && B.night !== B.nightT) {
          var nd = B.nightT - B.night, ns = dt / 4;
          B.night = Math.abs(nd) <= ns ? B.nightT : B.night + (nd > 0 ? ns : -ns);
          rootEl.dataset.night = B.night > 0.5 ? '1' : '0';
        }
        var sky = opts.sky ? opts.sky() : null;
        var sn = sky ? clamp01(sky.snow || 0) : 0;
        var bz = opts.blizzard ? clamp01(opts.blizzard()) : 0;
        // liegen bleibt erst etwas, wenn die ersten Flocken unten ankommen
        B.snowFor = sn > 0.05 ? (B.snowFor || 0) + dt : 0;
        var want = B.on && B.snowFor > 8 ? Math.min(1.2, sn + 0.3 * bz) : 0;
        if (!B.on || reduceMotion) B.snow = want;
        else if (want > B.snow) B.snow = Math.min(want, B.snow + dt / 25);
        else B.snow = Math.max(want, B.snow - dt / 60);
        B.vars({ '--ts-snow': B.snow });
        return B.snow;
      },
      // Schnee am Boden: dünne Puderschicht und darüber eine dicke Decke
      // (erst bei viel Schnee), Deckkraft über --ts-snow. yAt(x) = Boden,
      // drifts = [[x, halbe Breite, Höhe]] Verwehungen; in der Bildmitte
      // (Spielanzeigen) bleibt die Decke flach.
      groundSnow: function (parent, before, yAt, drifts) {
        function top(x, deep) {
          var mid = x > 700 && x < 1220 ? 0.3 : 1;
          var t = deep ? (6 + 3 * Math.sin(x / 53) + 2 * Math.sin(x / 19)) * mid : 2.5 + 1.5 * Math.sin(x / 31);
          if (deep) (drifts || []).forEach(function (d) {
            var k = 1 - Math.abs(x - d[0]) / d[1];
            if (k > 0) t += d[2] * k * k * (3 - 2 * k) * mid;
          });
          return yAt(x) - t;
        }
        var out = {};
        ['dust', 'deep'].forEach(function (kind) {
          var d = 'M0 ' + H;
          for (var x = 0; x <= W; x += 12) d += ' L' + x + ' ' + f1(top(x, kind === 'deep'));
          d += ' L' + W + ' ' + H + ' Z';
          out[kind] = parent.insertBefore(el('path', { 'class': 'ts-gsnow ts-gsnow--' + kind, d: d }), before || null);
        });
        return out;
      }
    };

    // Wedeln mit Nachschwingen (makeSway unten, auch fürs Winter-Thema)
    B.sway = makeSway;

    // ── Gemeinsames Sub-Projekt (8 Teile, Stand gilt für alle Jahreszeiten) ──
    // cfg: parts[8] = function (g) zeichnet Teil i (Fuß bei 0/0), names[8],
    //      x, y() = Fuß auf dem Bildschirm, k = Maßstab, top(n) = Schild-Höhe
    //      über dem Fuß bei Stand n (lokal), done = Text wenn fertig,
    //      burst(x, y) = kleine Partikel beim Bauen (optional)
    B.project = function (parent, cfg) {
      var pos = el('g', { 'class': 'ts-proj' }, parent);
      var body = el('g', { 'class': 'ts-proj-body' }, pos);
      var parts = cfg.parts.map(function (fn, i) {
        var g = el('g', { 'class': 'ts-proj-part', 'data-step': i + 1 }, body);
        fn(g);
        return g;
      });
      var n = 0, clearTimer = null;
      function place() {
        pos.setAttribute('transform', 'translate(' + f1(cfg.x) + ' ' + f1(cfg.y()) + ') scale(' + cfg.k + ')');
      }
      function show(animStep) {
        parts.forEach(function (g, i) {
          g.classList.toggle('is-on', i + 1 <= n);
          g.classList.toggle('is-new', i + 1 === animStep);
        });
        pos.setAttribute('data-n', String(n));
      }
      function tagY() { return cfg.y() - cfg.top(n) * cfg.k - 30; }
      place();
      show(0);
      return {
        place: place,
        n: function () { return n; },
        set: function (v) {
          clearTimeout(clearTimer);
          pos.classList.remove('is-clearing');
          n = Math.max(0, Math.min(8, parseInt(v, 10) || 0));
          show(0);
        },
        // Teil dazu; animiert nur, wenn das Thema sichtbar ist
        build: function (name, visible) {
          clearTimeout(clearTimer);
          pos.classList.remove('is-clearing');
          if (n >= 8) {
            if (visible) tag(cfg.done, cfg.x, tagY(), true);
            return;
          }
          n++;
          show(visible ? n : 0);
          if (!visible) return;
          tag((name || 'Someone') + ' added ' + cfg.names[n - 1] + '!', cfg.x, tagY(), true);
          if (cfg.burst) cfg.burst(cfg.x, cfg.y() - cfg.top(n) * cfg.k * 0.6);
          if (n === 8) {
            pos.classList.remove('is-done'); void pos.getBoundingClientRect(); pos.classList.add('is-done');
          }
        },
        // Zurücksetzen: sichtbar kurz ausblenden, sonst sofort
        reset: function (visible) {
          clearTimeout(clearTimer);
          if (!visible || reduceMotion || !n) { n = 0; show(0); return; }
          pos.classList.add('is-clearing');
          clearTimer = setTimeout(function () {
            n = 0; show(0);
            pos.classList.remove('is-clearing');
          }, 700);
        },
        node: pos
      };
    };
    // ── Feuer (Blitz im Laub, brennender Schirm): Flammen und Glut auf einer
    // eigenen Ebene über dem Wetter, aber unter den Spektakeln (Rand-Fade per
    // CSS-Maske), Rauch, Funken,
    // Dampf und Wasser als Partikel auf der vorderen Ebene ──
    var fireCtx = null;
    B.fireCtx = function () {
      if (!fireCtx) {
        var c = canvas(fireEl);
        c.classList.add('ts-fire');
        fireCtx = c.getContext('2d');
      }
      return fireCtx;
    };
    // eine Flammenzunge: Fuß bei x/y, Breite w, Höhe h, flackert über t;
    // bauchig unten, schlanke, pendelnde Spitze, heller Kern
    function tongue(ctx, x, y, w, h, t, seed) {
      var fl = 0.72 + 0.18 * Math.sin(t * 9 + seed * 3.1) + 0.1 * Math.sin(t * 21 + seed * 7.7);
      h *= fl;
      var lean = Math.sin(t * 4.3 + seed * 2.3) * w * 0.45 + Math.sin(t * 11 + seed) * w * 0.12;
      [[1, 1, 'rgba(255,110,25,', 0.8, 'rgba(190,30,10,'], [0.6, 0.66, 'rgba(255,214,110,', 0.95, 'rgba(255,140,30,'],
       [0.3, 0.36, 'rgba(255,250,215,', 1, 'rgba(255,220,140,']].forEach(function (L) {
        var ww = w * L[0], hh = h * L[1];
        var g = ctx.createLinearGradient(0, y, 0, y - hh);
        g.addColorStop(0, L[2] + L[3] + ')');
        g.addColorStop(0.5, L[4] + (L[3] * 0.75) + ')');
        g.addColorStop(1, L[4] + '0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - ww * 0.35, y + ww * 0.08);
        ctx.bezierCurveTo(x - ww * 0.75, y - hh * 0.22, x + lean * 0.4 - ww * 0.3, y - hh * 0.62, x + lean, y - hh);
        ctx.bezierCurveTo(x + lean * 0.4 + ww * 0.3, y - hh * 0.62, x + ww * 0.75, y - hh * 0.22, x + ww * 0.35, y + ww * 0.08);
        ctx.closePath();
        ctx.fill();
      });
    }
    // Flammenreihe über pts ([x, y, Höhenfaktor]), k = Stärke 0..1
    B.flames = function (ctx, pts, w, h, k, t) {
      if (k <= 0.01) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = 'rgba(255,120,30,0.8)';
      ctx.shadowBlur = 18;
      pts.forEach(function (p, i) {
        var hv = 0.75 + 0.25 * Math.sin(t * 1.7 + i * 2.9);
        tongue(ctx, p[0], p[1], w * (0.7 + 0.3 * k), h * k * (p[2] || 1) * hv, t, i + 1);
      });
      ctx.restore();
    };
    // warmer Lichthof (Feuer, Glut)
    B.glow = function (ctx, x, y, r, a, rgb) {
      if (a <= 0.005) return;
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(' + (rgb || '255,150,60') + ',' + a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + (rgb || '255,150,60') + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    function puffDraw(ctx, p, a) {
      var k = p.age / (p.life || 4), r = p.r + p.gr * p.age;
      var al = a * p.o * (1 - k);
      if (al <= 0.004) return;
      var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, 'rgba(' + p.c + ',' + al.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + p.c + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }
    function sparkDraw(ctx, p, a) {
      var k = 1 - p.age / p.life;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgb(255,' + Math.round(110 + 130 * k) + ',' + Math.round(40 + 80 * k) + ')';
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      ctx.globalAlpha = 1;
    }
    function dropDraw(ctx, p, a) {
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Rauch (dunkel) bzw. Dampf (hell) steigt auf und treibt mit dem Wind
    B.smoke = function (x, y, o) {
      o = o || {};
      if (!front) return;
      front.add({ x: x + rand(-8, 8), y: y, vx: rand(-15, 15), vy: -(o.up || rand(50, 90)), g: 0, term: 80, sway: rand(6, 18), vph: rand(0.6, 1.4),
                  vr: 0, wf: o.wf === undefined ? 0.45 : o.wf, drag: 0.5, r: o.r || rand(14, 24), gr: o.gr || rand(14, 26),
                  o: o.o || 0.4, c: o.steam ? '236,240,246' : (o.c || '78,72,70'), life: o.life || rand(3, 5), draw: puffDraw });
    };
    B.sparks = function (x, y, n, spread) {
      if (!front) return;
      for (var i = 0; i < n; i++) {
        front.add({ x: x + rand(-(spread || 20), spread || 20), y: y, vx: rand(-80, 80), vy: -rand(180, 420), g: 320, term: 160,
                    sway: rand(10, 40), vph: rand(4, 9), vr: 0, wf: 0.3, life: rand(0.8, 1.6), draw: sparkDraw });
      }
    };
    // Brocken (Blitz trifft Kürbis o. Ä.): fliegen in alle Richtungen, fallen zu Boden
    B.chunks = function (x, y, n, colors, floor) {
      if (!front) return;
      for (var i = 0; i < n; i++) {
        var a = rand(-Math.PI, 0), sp = rand(200, 700);
        front.add({ x: x + rand(-15, 15), y: y + rand(-15, 15), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 1500, term: 900,
                    sway: 0, vr: 0, wf: 0, r: rand(2.5, 7), c: colors[i % colors.length], life: rand(1.2, 2), floor: floor || null, draw: dropDraw });
      }
    };
    // Wasser: Tropfen fliegen im Bogen auf das Ziel bzw. spritzen dort auf
    B.water = function (x, y, n, floor) {
      if (!front) return;
      for (var i = 0; i < n; i++) {
        var a = rand(-Math.PI * 0.95, -Math.PI * 0.05), sp = rand(150, 560);
        front.add({ x: x + rand(-25, 25), y: y - rand(0, 15), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 1400, term: 900,
                    sway: 0, vr: 0, wf: 0, r: rand(2.5, 6), c: i % 4 ? '#7cc8ff' : '#e6f6ff', life: 1.4, floor: floor || null, draw: dropDraw });
      }
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

  // ── Wedeln mit Nachschwingen: Ausschlag folgt dem Wind (schnell hoch,
  //    langsam aus), Böen geben einen abklingenden Stoß. Liefert je Schritt
  //    den Winkel; dir = Windrichtung (±1), die Mitte liegt leicht im Wind ──
  function makeSway() {
    var amp = 0, ph = 0, kick = 0;
    return function (dt, target, gust, dir) {
      if (gust > kick) kick = gust;
      kick *= Math.pow(0.25, dt);
      var want = Math.max(target, kick);
      amp += (want - amp) * Math.min(1, dt * (want > amp ? 2.5 : 0.4));
      ph += dt * (2.4 + 3.5 * Math.min(1, amp / 6));
      if (amp < 0.03) { amp = 0; return 0; }
      return amp * Math.sin(ph) + 0.35 * amp * (dir || 1);
    };
  }

  // Ältester Follower macht Platz für einen neuen: rollt zum nächsten Rand
  // hinaus (blendet vor der Kante aus) oder, mit crow, ein Vogel holt ihn ab.
  // node bleibt an seiner Stelle im SVG, bekommt nur Hüllen für die
  // CSS-Animationen; x/top = Mitte und Oberkante im Bild, r = Rollradius.
  // → ms, nach denen der Platz frei aussieht (dann fällt der Neue)
  var LEAVE_ROLL = 2200, LEAVE_CROW = 3400;
  // Schatten beim Rollen: dreht nicht mit, bleibt flach am Boden und wird je
  // nach Drehlage breiter oder schmaler (ratio = Höhe/Breite der Figur)
  // Mehrere Windhosen zugleich: hält die laufenden (Spektakel-Infos) und
  // liefert die nächste zu einer Stelle, damit jede an der Deko zerren kann
  function twisters() {
    var list = [];
    function live() { list = list.filter(function (t) { return t.active(); }); return list; }
    function near(x, not) {
      var best = null;
      live().forEach(function (t) {
        var tx = t !== not ? t.x() : null;
        if (tx !== null && (!best || Math.abs(tx - x) < Math.abs(best.x - x))) best = { x: tx, dir: t.dir || 0, t: t };
      });
      return best;
    }
    return {
      add: function (p) { if (p.type === 'tornado' && !p.reduced) list.push(p); },
      any: function () { return live().length > 0; },
      near: near,
      each: function (fn) { live().forEach(function (t) { var tx = t.x(); if (tx !== null) fn(tx, t.dir || 0, t); }); },
      clear: function () { list = []; }
    };
  }

  function rollShadow(shadow, spin, ratio, ms) {
    if (!shadow || !spin || !root.requestAnimationFrame) return;
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var m = root.getComputedStyle(spin).transform, a = 1, b = 0;
      if (m && m !== 'none') { var v = m.slice(m.indexOf('(') + 1, -1).split(','); a = +v[0]; b = +v[1]; }
      var th = Math.atan2(b, a), c = Math.cos(th), s = Math.sin(th);
      shadow.setAttribute('transform', 'scale(' + Math.sqrt(c * c + ratio * ratio * s * s).toFixed(3) + ' 1)');
      if (ts - t0 < ms) root.requestAnimationFrame(step); else shadow.removeAttribute('transform');
    }
    root.requestAnimationFrame(step);
  }
  // rollende Figur (Besuch, Platzmachen): Schatten aus dem drehenden Teil holen,
  // er wandert mit, dreht aber nicht
  function groundShadow(wrap, node, item, o, ms) {
    if (!o.shadow || !o.shadow.parentNode) return;
    var holder = el('g', { transform: node.getAttribute('transform') || '' });
    wrap.insertBefore(holder, item);
    holder.appendChild(o.shadow);
    rollShadow(o.shadow, item, o.shadowRatio || 0.7, ms);
  }
  function leave(node, o) {
    var parent = node.parentNode;
    if (!parent) return 0;
    var crow = !!o.crow, wrap = el('g', { 'class': 'ts-leave ts-leave--' + (crow ? 'crow' : 'roll') });
    parent.insertBefore(wrap, node);
    var inner = el('g', { 'class': 'ts-leave__item' }, wrap);
    inner.appendChild(node);
    var dir = o.x < W / 2 ? -1 : 1;
    if (crow) {
      // Vogel kommt von schräg oben aus der Bildmitte, packt zu und fliegt mit
      // der Beute zur näheren Seite hinaus
      var bird = el('g', { transform: 'translate(' + Math.round(o.x) + ' ' + Math.round(o.top) + ')' }, wrap);
      var fly = el('g', { 'class': 'ts-bird ts-bird--' + (o.bird || 'crow') }, bird);
      el('path', { 'class': 'ts-bird__wing', d: 'M-4 -18 Q-26 -44 -44 -30 Q-24 -30 -8 -14 Z' }, fly);
      el('path', { 'class': 'ts-bird__wing ts-bird__wing--far', d: 'M4 -18 Q26 -44 44 -30 Q24 -30 8 -14 Z' }, fly);
      el('ellipse', { 'class': 'ts-bird__body', cx: 0, cy: -14, rx: 20, ry: 11 }, fly);
      el('circle', { 'class': 'ts-bird__body', cx: dir * 20, cy: -22, r: 8 }, fly);
      el('path', { 'class': 'ts-bird__beak', d: 'M' + dir * 27 + ' -24 L' + dir * 38 + ' -21 L' + dir * 27 + ' -18 Z' }, fly);
      el('path', { 'class': 'ts-bird__feet', d: 'M-5 -4 L-6 2 M5 -4 L6 2' }, fly);
      wrap.style.setProperty('--ts-bx', (-dir * 520) + 'px');
      wrap.style.setProperty('--ts-fx', (dir * (dir < 0 ? o.x + 160 : W - o.x + 160)) + 'px');
      wrap.style.setProperty('--ts-fy', (-Math.max(260, o.top + 200)) + 'px');
    } else {
      // bis knapp vor die Kante; Drehung passend zum Weg (Abrollen)
      var dx = dir < 0 ? -(o.x - 20) : W - 20 - o.x, r = Math.max(10, o.r || 24);
      wrap.style.setProperty('--ts-dx', Math.round(dx) + 'px');
      wrap.style.setProperty('--ts-rot', Math.round(dx / r * 57.3) + 'deg');
      groundShadow(wrap, node, inner, o, LEAVE_ROLL);
    }
    var ms = crow ? LEAVE_CROW : LEAVE_ROLL;
    setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, ms + 200);
    return crow ? 1700 : 900;
  }

  // !whereiam für jemanden, der gerade nicht im Bild steht: die Figur kommt von
  // der näheren Kante hereingerollt (roll) oder wächst auf, meldet sich mit
  // o.arrive (Hüpfen + Name) und geht danach wie beim Platzmachen wieder
  var VISIT_IN = 1600, VISIT_POP = 700, VISIT_STAY = 5200;
  // solange ein Besuch läuft, pausiert der Namens-Scheinwerfer (sonst überlappen die Schilder)
  var visitEnd = 0;
  function hold(ms) {
    // Namen, die der Scheinwerfer gerade zeigt (kleine Schilder), blenden sofort aus
    if (!visiting() && root.document) {
      [].forEach.call(root.document.querySelectorAll('.name-tag:not(.name-tag--big)'), function (t) { t.classList.add('name-tag--out'); });
    }
    visitEnd = Math.max(visitEnd, Date.now() + ms);
  }
  function visiting() { return Date.now() < visitEnd; }
  function visit(node, o) {
    var parent = node.parentNode;
    if (!parent) return;
    hold((o.roll ? VISIT_IN : VISIT_POP) + VISIT_STAY + 1500);
    var roll = !!o.roll, wrap = el('g', { 'class': 'ts-visit ts-visit--' + (roll ? 'roll' : 'pop') });
    parent.appendChild(wrap);
    var inner = el('g', { 'class': 'ts-visit__item' }, wrap);
    inner.appendChild(node);
    if (roll) {
      var dir = o.x < W / 2 ? -1 : 1, dx = dir < 0 ? -(o.x - 20) : W - 20 - o.x, r = Math.max(10, o.r || 24);
      wrap.style.setProperty('--ts-dx', Math.round(dx) + 'px');
      wrap.style.setProperty('--ts-rot', Math.round(dx / r * 57.3) + 'deg');
      groundShadow(wrap, node, inner, o, VISIT_IN);
    }
    var inMs = roll ? VISIT_IN : VISIT_POP;
    setTimeout(function () { if (o.arrive) o.arrive(); }, inMs);
    setTimeout(function () {
      leave(node, o);
      setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, (o.crow ? LEAVE_CROW : LEAVE_ROLL) + 400);
    }, inMs + VISIT_STAY);
  }

  // fester Zufallswert 0..1 je Name und Merkmal: Follower sehen in jeder
  // Jahreszeit und bei jedem Besuch gleich aus, egal auf welchem Platz
  function nameRand(name, s) {
    var str = String(name || '?').toLowerCase() + '#' + s, h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }

  root.ThemeSeasons = { nameRand: nameRand, sway: makeSway, base: base, loop: loop, seeded: seeded, el: el, W: W, H: H, leave: leave, visit: visit, hold: hold, visiting: visiting, rollShadow: rollShadow, twisters: twisters };
})(typeof window !== 'undefined' ? window : this);
