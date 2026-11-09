/* Wetter-Baustein: Regen, Niesel, Schnee, Wolken, Nebel, Sonne, Hitze,
 * Blitz, Wind und Spektakel auf Canvas — mit weichen Übergängen.
 *
 * Nutzung:
 *   var kit = WeatherKit.create(stageEl);
 *   kit.setState(WeatherKit.profile('rain'), 25);   // Übergang in s
 *   kit.strike(); kit.gust(); kit.spectacle('tsunami');
 *
 * Die Lagen (PROFILES) spiegeln fx/weather.py 1:1 — der Server rechnet
 * Stimmung und Übersteuerung aus und liefert den fertigen Zustand.
 *
 * Grundregel Stimmung: Himmel, Nebel und Abdunklung liegen nur an den
 * Rändern — die Bildmitte (Gameplay) bleibt immer frei.
 */
(function (root) {
  'use strict';

  var W = 1920, H = 1080;

  // ── Wetterlagen ──
  // rain/drizzle/snow = Niederschlagsmenge 0..1, clouds/sun/fog/heat 0..1,
  // lightning 0..2 (aus, selten, oft), windMin = Mindestwind der Lage
  var PROFILES = {
    clear:    { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0.08, sun: 0.55, fog: 0,    heat: 0, lightning: 0, windMin: 0 },
    cloudy:   { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0.7,  sun: 0.05, fog: 0.05, heat: 0, lightning: 0, windMin: 0 },
    fog:      { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0.45, sun: 0,    fog: 0.85, heat: 0, lightning: 0, windMin: 0 },
    drizzle:  { precip: 'rain', rain: 0,    drizzle: 0.7, snow: 0,    clouds: 0.6,  sun: 0,    fog: 0.15, heat: 0, lightning: 0, windMin: 0 },
    rain:     { precip: 'rain', rain: 0.6,  drizzle: 0.2, snow: 0,    clouds: 0.75, sun: 0,    fog: 0.1,  heat: 0, lightning: 0, windMin: 0 },
    storm:    { precip: 'rain', rain: 1,    drizzle: 0.3, snow: 0,    clouds: 0.95, sun: 0,    fog: 0.15, heat: 0, lightning: 2, windMin: 0.6 },
    sleet:    { precip: 'mix',  rain: 0.35, drizzle: 0.1, snow: 0.45, clouds: 0.75, sun: 0,    fog: 0.15, heat: 0, lightning: 0, windMin: 0.2 },
    snow:     { precip: 'snow', rain: 0,    drizzle: 0,   snow: 0.6,  clouds: 0.6,  sun: 0,    fog: 0.1,  heat: 0, lightning: 0, windMin: 0 },
    blizzard: { precip: 'snow', rain: 0,    drizzle: 0,   snow: 1,    clouds: 0.85, sun: 0,    fog: 0.4,  heat: 0, lightning: 0, windMin: 0.85 },
    heat:     { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0,    sun: 1,    fog: 0,    heat: 1, lightning: 0, windMin: 0 }
  };
  var KINDS = Object.keys(PROFILES);
  var SPECTACLES = ['tsunami', 'megabolt', 'ballbolt', 'avalanche'];
  var NUM_KEYS = ['rain', 'drizzle', 'snow', 'clouds', 'sun', 'fog', 'heat', 'gloom', 'lightning', 'wind'];

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  function profile(kind) {
    var p = PROFILES[kind] || PROFILES.clear;
    var out = { kind: PROFILES[kind] ? kind : 'clear', gloom: 0, wind: 0 };
    for (var k in p) out[k] = p[k];
    return out;
  }

  // Zahlen linear, precip/kind springen bei der Hälfte
  function mix(from, to, t) {
    var out = {};
    for (var k in to) {
      if (typeof to[k] === 'number' && typeof from[k] === 'number') out[k] = lerp(from[k], to[k], t);
      else out[k] = t >= 0.5 ? to[k] : (k in from ? from[k] : to[k]);
    }
    return out;
  }

  // ── Partikel ──
  // Anzahl pro Ebene [hinten, mitte, vorne] bei Menge 1
  var COUNT = {
    rain:    [420, 260, 120],
    drizzle: [320, 160, 0],
    snow:    [300, 180, 80]
  };
  var RAIN_LAYERS = [
    { speed: 950,  len: [10, 18], width: 1.0, alpha: [0.16, 0.24, 0.32], drift: 0.8 },
    { speed: 1350, len: [18, 30], width: 1.3, alpha: [0.28, 0.38, 0.48], drift: 0.9 },
    { speed: 1850, len: [30, 52], width: 1.8, alpha: [0.42, 0.56, 0.70], drift: 1.0 }
  ];
  var DRIZZLE_LAYERS = [
    { speed: 520, len: [5, 9],   width: 0.9, alpha: [0.14, 0.2, 0.26], drift: 1.1 },
    { speed: 700, len: [8, 13],  width: 1.1, alpha: [0.22, 0.3, 0.36], drift: 1.2 }
  ];
  var SNOW_LAYERS = [
    { speed: 55,  r: [1.1, 2.0], alpha: 0.55, drift: 0.7, sway: 18 },
    { speed: 95,  r: [2.0, 3.2], alpha: 0.75, drift: 0.85, sway: 26 },
    { speed: 150, r: [3.2, 4.8], alpha: 0.92, drift: 1.0, sway: 34 }
  ];
  var MAX_TAN = 0.5;
  var LIGHTNING_RANGES = [null, [14, 32], [5, 12]];

  function create(stage, opts) {
    opts = opts || {};
    var reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var motionScale = reduceMotion ? 0.25 : 1;

    function canvas(cls) {
      var c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      c.className = 'wk-layer ' + cls;
      c.setAttribute('aria-hidden', 'true');
      stage.appendChild(c);
      return c.getContext('2d');
    }
    var sctx = canvas('wk-sky');
    var bctx = canvas('wk-bolt');
    var flashEl = document.createElement('div');
    flashEl.className = 'wk-flash';
    flashEl.setAttribute('aria-hidden', 'true');
    stage.appendChild(flashEl);
    var pctx = canvas('wk-particles');
    var fctx = canvas('wk-fx');
    pctx.lineCap = 'round';
    flashEl.addEventListener('animationend', function () { flashEl.classList.remove('is-flashing'); });

    var cur = profile(opts.kind || 'clear');
    var from = cur, to = cur, transT = 1, transSecs = 0;
    var time = 0, last = null;
    var listeners = {};

    function emit(ev, arg) { (listeners[ev] || []).forEach(function (fn) { fn(arg); }); }

    function setState(state, secs) {
      var target = {};
      for (var k in state) target[k] = state[k];
      NUM_KEYS.forEach(function (k) { if (typeof target[k] !== 'number') target[k] = 0; });
      from = {};
      for (var c in cur) from[c] = cur[c];
      to = target;
      transSecs = Math.max(0, secs || 0);
      transT = transSecs > 0 ? 0 : 1;
      if (transT === 1) {
        cur = mix(from, to, 1);
        prefill();
      }
      scheduleStrike();
    }

    // Fehlende Partikel gleich übers ganze Bild verteilen (Start, Sofortwechsel)
    function prefill() {
      ['rain', 'drizzle', 'snow'].forEach(function (type) {
        COUNT[type].forEach(function (_, li) {
          var have = 0;
          parts.forEach(function (q) { if (q.type === type && q.layer === li) have++; });
          for (var i = have, n = target(type, li); i < n; i++) {
            var p = { type: type, layer: li };
            spawn(p, true, 0);
            parts.push(p);
          }
        });
      });
    }

    // ── Wind ──
    var windNow = 0, gustT = -1, gustDir = 1;
    function gust() {
      gustT = 0;
      gustDir = windNow > 0.05 ? 1 : (windNow < -0.05 ? -1 : (Math.random() < 0.5 ? -1 : 1));
      emit('gust');
    }
    function windTarget() {
      var w = cur.wind || 0;
      var min = cur.windMin || 0;
      if (Math.abs(w) < min) w = (w < 0 ? -1 : 1) * min;
      return clamp(w, -1, 1);
    }
    function updateWind(dt) {
      var step = 0.35 * dt;
      windNow += clamp(windTarget() - windNow, -step, step);
      var g = 0;
      if (gustT >= 0) {
        gustT += dt;
        if (gustT >= 2.5) gustT = -1;
        else g = gustDir * 0.55 * Math.sin(Math.PI * gustT / 2.5);
      }
      var sway = reduceMotion ? 0 : 0.07 * Math.sin(time * 0.37) + 0.04 * Math.sin(time * 1.13);
      return clamp(windNow + g + sway, -1.6, 1.6);
    }

    // ── Partikel-Verwaltung: zu viele fallen zu Ende, fehlende kommen von oben ──
    var parts = [];
    var spawnAcc = {};

    function target(type, li) {
      var amount = type === 'rain' ? cur.rain : type === 'drizzle' ? cur.drizzle : cur.snow;
      return Math.round(COUNT[type][li] * clamp(amount, 0, 1) * motionScale);
    }

    function spawn(p, initial, wind) {
      var margin = H * 0.8 + 40;
      if (p.type === 'snow') {
        var sl = SNOW_LAYERS[p.layer];
        p.v = sl.speed * rand(0.8, 1.25);
        p.r = rand(sl.r[0], sl.r[1]);
        p.phase = rand(0, Math.PI * 2);
        p.freq = rand(0.6, 1.4);
        p.glint = Math.random() < 0.18;
        // Bei Wind von der Luvseite hereinwehen lassen
        var span = Math.abs(wind) * 900 + 120;
        p.x = wind > 0 ? rand(-span, W) : rand(0, W + span);
        p.y = initial ? rand(-H * 0.1, H) : rand(-60, -10);
      } else {
        var L = (p.type === 'rain' ? RAIN_LAYERS : DRIZZLE_LAYERS)[p.layer];
        p.v = L.speed * rand(0.85, 1.15);
        p.len = rand(L.len[0], L.len[1]);
        p.bucket = (Math.random() * 3) | 0;
        p.x = rand(-margin, W + margin);
        p.y = initial ? rand(-H * 0.2, H) : -p.len - rand(0, 160);
      }
      p.dead = false;
    }

    function manageParts(dt, wind) {
      var counts = {};
      parts.forEach(function (p) {
        var key = p.type + p.layer;
        counts[key] = (counts[key] || 0) + 1;
      });
      ['rain', 'drizzle', 'snow'].forEach(function (type) {
        COUNT[type].forEach(function (_, li) {
          var key = type + li;
          var want = target(type, li);
          var have = counts[key] || 0;
          if (have >= want) { spawnAcc[key] = 0; return; }
          // Beim Start einer Lage schneller auffüllen, damit es nicht ewig dauert
          spawnAcc[key] = (spawnAcc[key] || 0) + Math.max(want * dt * 0.9, 1 * dt * 30);
          while (spawnAcc[key] >= 1 && have < want) {
            var np = { type: type, layer: li };
            spawn(np, false, wind);
            parts.push(np);
            have++;
            spawnAcc[key] -= 1;
          }
        });
      });
      return counts;
    }

    function stepParts(dt, wind, counts) {
      var tanA = wind * MAX_TAN;
      var anyDead = false;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        var gone;
        if (p.type === 'snow') {
          var sl = SNOW_LAYERS[p.layer];
          p.y += p.v * dt;
          p.x += (wind * (160 + p.layer * 90) * sl.drift +
                  Math.sin(p.phase + time * p.freq) * sl.sway) * dt;
          gone = p.y - p.r > H || p.x < -1000 || p.x > W + 1000;
        } else {
          var L = (p.type === 'rain' ? RAIN_LAYERS : DRIZZLE_LAYERS)[p.layer];
          var dy = p.v * dt;
          p.y += dy;
          p.x += dy * tanA * L.drift;
          gone = p.y - p.len > H;
        }
        if (gone) {
          var key = p.type + p.layer;
          if ((counts[key] || 0) > target(p.type, p.layer)) {
            p.dead = true;
            anyDead = true;
            counts[key]--;
          } else {
            spawn(p, false, wind);
          }
        }
      }
      if (anyDead) parts = parts.filter(function (p) { return !p.dead; });
    }

    function drawParts(wind) {
      pctx.clearRect(0, 0, W, H);
      var tanA = wind * MAX_TAN;
      [['rain', RAIN_LAYERS], ['drizzle', DRIZZLE_LAYERS]].forEach(function (pair) {
        var type = pair[0], layers = pair[1];
        layers.forEach(function (L, li) {
          var slant = tanA * L.drift;
          pctx.lineWidth = L.width;
          for (var bk = 0; bk < 3; bk++) {
            pctx.beginPath();
            var any = false;
            for (var i = 0; i < parts.length; i++) {
              var d = parts[i];
              if (d.type !== type || d.layer !== li || d.bucket !== bk) continue;
              pctx.moveTo(d.x, d.y);
              pctx.lineTo(d.x - d.len * slant, d.y - d.len);
              any = true;
            }
            if (!any) continue;
            pctx.strokeStyle = 'rgba(174,203,235,' + L.alpha[bk] + ')';
            pctx.stroke();
          }
        });
      });
      // Schnee: Flocken glitzern, wenn die Sonne durchkommt
      var sparkle = cur.sun > 0.25;
      SNOW_LAYERS.forEach(function (sl, li) {
        pctx.beginPath();
        var any = false;
        for (var i = 0; i < parts.length; i++) {
          var f = parts[i];
          if (f.type !== 'snow' || f.layer !== li) continue;
          pctx.moveTo(f.x + f.r, f.y);
          pctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          any = true;
        }
        if (!any) return;
        pctx.fillStyle = 'rgba(248,251,255,' + sl.alpha + ')';
        pctx.fill();
      });
      if (sparkle) {
        pctx.fillStyle = 'rgba(255,250,225,1)';
        for (var j = 0; j < parts.length; j++) {
          var g = parts[j];
          if (g.type !== 'snow' || !g.glint) continue;
          var tw = Math.sin(time * 6 + g.phase * 3);
          if (tw < 0.6) continue;
          pctx.globalAlpha = (tw - 0.6) * 2.5 * Math.min(1, cur.sun);
          pctx.fillRect(g.x - g.r * 1.6, g.y - 0.5, g.r * 3.2, 1);
          pctx.fillRect(g.x - 0.5, g.y - g.r * 1.6, 1, g.r * 3.2);
        }
        pctx.globalAlpha = 1;
      }
    }

    // ── Himmel: nur Ränder ──
    var puffs = [];
    for (var pi = 0; pi < 9; pi++) {
      puffs.push({ x: rand(0, W + 600), y: rand(-60, 110), r: rand(170, 320), s: rand(8, 22) });
    }
    var fogPuffs = [];
    for (var fi = 0; fi < 8; fi++) {
      fogPuffs.push({ x: rand(0, W + 800), y: rand(H - 220, H + 40), r: rand(220, 380), s: rand(10, 26) });
    }

    function drawSky(wind) {
      sctx.clearRect(0, 0, W, H);
      var c = clamp(cur.clouds, 0, 1), g = clamp(cur.gloom, 0, 1);
      var f = clamp(cur.fog, 0, 1), s = clamp(cur.sun, 0, 1), h = clamp(cur.heat, 0, 1);
      var dir = wind >= 0 ? 1 : -1;

      // Sonne: warmer Schein und Strahlen aus der oberen linken Ecke
      if (s > 0.01) {
        var glow = sctx.createRadialGradient(0, 0, 0, 0, 0, 760);
        glow.addColorStop(0, 'rgba(255,226,160,' + (0.5 * s) + ')');
        glow.addColorStop(0.45, 'rgba(255,214,140,' + (0.16 * s) + ')');
        glow.addColorStop(1, 'rgba(255,214,140,0)');
        sctx.fillStyle = glow;
        sctx.fillRect(0, 0, 900, 900);
        for (var r = 0; r < 7; r++) {
          var a0 = (0.12 + r * 0.17) + 0.03 * Math.sin(time * 0.21 + r * 1.7);
          var width = 0.045 + 0.02 * Math.sin(time * 0.33 + r);
          var len = 1150;
          var ray = sctx.createLinearGradient(0, 0, Math.cos(a0) * len, Math.sin(a0) * len);
          var ra = (0.13 + 0.06 * Math.sin(time * 0.5 + r * 2.1)) * s;
          ray.addColorStop(0, 'rgba(255,236,190,' + ra + ')');
          ray.addColorStop(0.55, 'rgba(255,236,190,' + (ra * 0.25) + ')');
          ray.addColorStop(0.8, 'rgba(255,236,190,0)');
          sctx.fillStyle = ray;
          sctx.beginPath();
          sctx.moveTo(-30, -30);
          sctx.lineTo(Math.cos(a0 - width) * len, Math.sin(a0 - width) * len);
          sctx.lineTo(Math.cos(a0 + width) * len, Math.sin(a0 + width) * len);
          sctx.closePath();
          sctx.fill();
        }
      }

      // Wolkenband oben, wandert mit dem Wind
      if (c > 0.01) {
        var shade = Math.round(lerp(118, 62, g));
        var band = sctx.createLinearGradient(0, 0, 0, H * 0.34);
        var ta = 0.42 * c + 0.18 * g;
        band.addColorStop(0, 'rgba(' + shade + ',' + (shade + 8) + ',' + (shade + 22) + ',' + ta + ')');
        band.addColorStop(0.55, 'rgba(' + shade + ',' + (shade + 8) + ',' + (shade + 22) + ',' + (ta * 0.3) + ')');
        band.addColorStop(1, 'rgba(' + shade + ',' + (shade + 8) + ',' + (shade + 22) + ',0)');
        sctx.fillStyle = band;
        sctx.fillRect(0, 0, W, H * 0.34);
        puffs.forEach(function (p) {
          p.x += p.s * (0.4 + Math.abs(wind)) * dir * dtFrame;
          var span = W + 700;
          if (p.x > W + 350) p.x -= span;
          if (p.x < -350) p.x += span;
          var pg = sctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          var pa = 0.3 * c + 0.12 * g;
          pg.addColorStop(0, 'rgba(' + shade + ',' + (shade + 6) + ',' + (shade + 18) + ',' + pa + ')');
          pg.addColorStop(1, 'rgba(' + shade + ',' + (shade + 6) + ',' + (shade + 18) + ',0)');
          sctx.fillStyle = pg;
          sctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        });
      }

      // Trübe Stimmung: Ecken-Vignette, Mitte bleibt frei
      if (g > 0.01) {
        sctx.save();
        sctx.translate(W / 2, H / 2);
        sctx.scale(1, H / W);
        var vg = sctx.createRadialGradient(0, 0, W * 0.42, 0, 0, W * 0.78);
        vg.addColorStop(0, 'rgba(18,22,32,0)');
        vg.addColorStop(1, 'rgba(18,22,32,' + (0.55 * g) + ')');
        sctx.fillStyle = vg;
        sctx.fillRect(-W, -W, W * 2, W * 2);
        sctx.restore();
      }

      // Nebel: Band unten und an den Seiten, Schwaden ziehen
      if (f > 0.01) {
        var fb = sctx.createLinearGradient(0, H, 0, H * 0.6);
        fb.addColorStop(0, 'rgba(206,212,222,' + (0.55 * f) + ')');
        fb.addColorStop(1, 'rgba(206,212,222,0)');
        sctx.fillStyle = fb;
        sctx.fillRect(0, H * 0.6, W, H * 0.4);
        [[0, W * 0.2], [W, W * 0.8]].forEach(function (side) {
          var sg = sctx.createLinearGradient(side[0], 0, side[1], 0);
          sg.addColorStop(0, 'rgba(206,212,222,' + (0.32 * f) + ')');
          sg.addColorStop(1, 'rgba(206,212,222,0)');
          sctx.fillStyle = sg;
          sctx.fillRect(Math.min(side[0], side[1]), 0, W * 0.2, H);
        });
        fogPuffs.forEach(function (p) {
          p.x += p.s * (0.3 + Math.abs(wind)) * dir * dtFrame;
          var span = W + 800;
          if (p.x > W + 400) p.x -= span;
          if (p.x < -400) p.x += span;
          var pg = sctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          pg.addColorStop(0, 'rgba(214,219,228,' + (0.28 * f) + ')');
          pg.addColorStop(1, 'rgba(214,219,228,0)');
          sctx.fillStyle = pg;
          sctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        });
      }

      // Hitze: warmer Saum unten, flimmernde Linien steigen auf
      if (h > 0.01) {
        var hb = sctx.createLinearGradient(0, H, 0, H - 240);
        hb.addColorStop(0, 'rgba(255,150,60,' + (0.2 * h) + ')');
        hb.addColorStop(1, 'rgba(255,150,60,0)');
        sctx.fillStyle = hb;
        sctx.fillRect(0, H - 240, W, 240);
        sctx.lineWidth = 2;
        for (var l = 0; l < 12; l++) {
          var y0 = H - ((time * 22 + l * 17) % 200);
          var la = 0.07 * h * (1 - (H - y0) / 200);
          sctx.strokeStyle = 'rgba(255,240,215,' + la + ')';
          sctx.beginPath();
          for (var x = 0; x <= W; x += 40) {
            var yy = y0 + Math.sin(x * 0.012 + time * 2.2 + l) * 4;
            if (x === 0) sctx.moveTo(x, yy); else sctx.lineTo(x, yy);
          }
          sctx.stroke();
        }
      }
    }

    // ── Blitze ──
    var bolts = [];
    var nextStrike = Infinity;
    var lastFlash = -10;

    // Takt richtet sich nach der Ziel-Lage, nicht nach der gerade sichtbaren
    function scheduleStrike() {
      var range = reduceMotion ? null : LIGHTNING_RANGES[Math.round(clamp(to.lightning || 0, 0, 2))];
      nextStrike = range ? time + rand(range[0], range[1]) : Infinity;
    }

    function zigzag(x0, y0, x1, y1, spread, depth, out) {
      if (depth === 0) { out.push([x1, y1]); return; }
      var mx = (x0 + x1) / 2 + rand(-spread, spread);
      var my = (y0 + y1) / 2 + rand(-spread * 0.2, spread * 0.2);
      zigzag(x0, y0, mx, my, spread / 2, depth - 1, out);
      zigzag(mx, my, x1, y1, spread / 2, depth - 1, out);
    }

    function makeBolt(dist) {
      var x0 = rand(W * 0.1, W * 0.9);
      var y1 = rand(H * 0.45, H * 0.8);
      var x1 = x0 + rand(-220, 220);
      var trunk = [[x0, -30]];
      zigzag(x0, -30, x1, y1, 160, 6, trunk);
      var paths = [{ pts: trunk, w: 3.2 }];
      var branches = 1 + ((Math.random() * 3) | 0);
      for (var b = 0; b < branches; b++) {
        var start = trunk[2 + ((Math.random() * (trunk.length - 6)) | 0)];
        var br = [[start[0], start[1]]];
        zigzag(start[0], start[1], start[0] + rand(-260, 260), start[1] + rand(120, 300), 70, 4, br);
        paths.push({ pts: br, w: 1.6 });
      }
      return { paths: paths, t: 0, k: 1.25 - dist * 0.6, dim: 1 - dist * 0.35,
               side: x0 < W * 0.38 ? 'left' : (x0 > W * 0.62 ? 'right' : 'center') };
    }

    // Bildblitz höchstens alle 0,45 s (unter 3 Blitzen pro Sekunde)
    function flash(side) {
      if (time - lastFlash < 0.45 || reduceMotion) return;
      lastFlash = time;
      flashEl.dataset.side = side;
      flashEl.classList.remove('is-flashing');
      void flashEl.offsetWidth;
      flashEl.classList.add('is-flashing');
    }

    function strike(which) {
      var dist = which === 'near' ? rand(0, 0.3) : which === 'far' ? rand(0.6, 1) : Math.random();
      var b = makeBolt(dist);
      bolts.push(b);
      flash(b.side);
      emit('strike', dist);
    }

    function boltAlpha(t) {
      if (t < 0.04) return 1;
      if (t < 0.09) return 0.25;
      if (t < 0.16) return 0.9;
      if (t < 0.6) return 0.9 * (1 - (t - 0.16) / 0.44);
      return 0;
    }

    function drawBolts(dt) {
      bctx.clearRect(0, 0, W, H);
      if (!bolts.length) return;
      bctx.lineCap = 'round';
      bctx.lineJoin = 'round';
      bolts.forEach(function (b) {
        b.t += dt;
        var a = boltAlpha(b.t) * b.dim;
        if (a <= 0) { b.done = true; return; }
        b.paths.forEach(function (p) {
          bctx.beginPath();
          bctx.moveTo(p.pts[0][0], p.pts[0][1]);
          for (var i = 1; i < p.pts.length; i++) bctx.lineTo(p.pts[i][0], p.pts[i][1]);
          bctx.shadowColor = 'rgba(205,220,255,' + a + ')';
          bctx.shadowBlur = 28;
          bctx.strokeStyle = 'rgba(205,220,255,' + (a * 0.55) + ')';
          bctx.lineWidth = p.w * 3 * b.k;
          bctx.stroke();
          bctx.shadowBlur = 8;
          bctx.strokeStyle = 'rgba(255,255,255,' + a + ')';
          bctx.lineWidth = p.w * b.k;
          bctx.stroke();
        });
      });
      bctx.shadowBlur = 0;
      bolts = bolts.filter(function (b) { return !b.done; });
    }

    // ── Spektakel: eins läuft, höchstens eins wartet ──
    var show = null, queued = null;

    function spectacle(type) {
      if (SPECTACLES.indexOf(type) < 0) return false;
      if (show) { queued = type; return true; }
      startShow(type);
      return true;
    }

    function startShow(type) {
      if (reduceMotion) { show = { type: 'tint', t: 0, dur: 1.2, color: TINT[type] }; return; }
      show = SHOWS[type].init();
      show.type = type;
      show.t = 0;
      emit('spectacle', type);
    }

    var TINT = { tsunami: '40,120,190', megabolt: '200,215,255', ballbolt: '150,210,255', avalanche: '235,242,250' };

    var SHOWS = {
      tsunami: {
        init: function () {
          return { dur: 8.5, dir: Math.random() < 0.5 ? 1 : -1, spray: [] };
        },
        draw: function (s, dt) {
          var p = s.t / s.dur;
          var env = smooth(p / 0.12) * (1 - smooth((p - 0.8) / 0.2));
          var crest = s.dir > 0 ? lerp(-W * 0.35, W * 1.45, p) : lerp(W * 1.35, -W * 0.45, p);
          var L = W * 0.95;
          var top = H * 0.44 * env;
          var level = function (x) {
            var d = (crest - x) * s.dir;               // > 0 hinter dem Kamm
            if (d < 0) return 0;
            var k = d / L;
            var h = k < 0.08 ? top * (0.6 + 5 * k) : top * Math.max(0.12, 1 - (k - 0.08) * 0.95);
            return h + Math.sin(x * 0.02 + s.t * 3) * 10 * env;
          };
          var x0 = crest - s.dir * (L + 200);
          var grad = fctx.createLinearGradient(0, H - top - 40, 0, H);
          grad.addColorStop(0, 'rgba(120,205,235,' + (0.85 * env) + ')');
          grad.addColorStop(0.35, 'rgba(40,130,190,' + (0.85 * env) + ')');
          grad.addColorStop(1, 'rgba(12,58,110,' + (0.9 * env) + ')');
          fctx.fillStyle = grad;
          fctx.beginPath();
          fctx.moveTo(x0, H + 10);
          var step = 24 * s.dir;
          var x;
          for (x = x0; (crest - x) * s.dir >= 0; x += step) fctx.lineTo(x, H - level(x));
          // Überschlagende Front
          fctx.quadraticCurveTo(crest + s.dir * 90, H - top * 1.02, crest + s.dir * 70, H - top * 0.55);
          fctx.quadraticCurveTo(crest + s.dir * 30, H - top * 0.35, crest + s.dir * 150, H + 10);
          fctx.closePath();
          fctx.fill();
          // Schaumkrone
          fctx.fillStyle = 'rgba(245,252,255,' + (0.85 * env) + ')';
          for (x = crest - s.dir * 420; (crest - x) * s.dir >= 0; x += 9 * s.dir) {
            var near = 1 - Math.abs(crest - x) / 420;
            if (Math.random() > 0.35 + near * 0.5) continue;
            fctx.beginPath();
            fctx.arc(x + rand(-4, 4), H - level(x) + rand(-6, 6), rand(1.5, 2.5 + near * 4), 0, Math.PI * 2);
            fctx.fill();
          }
          // Gischt
          if (env > 0.3) {
            for (var n = 0; n < 6; n++) {
              s.spray.push({ x: crest + s.dir * rand(0, 80), y: H - top * rand(0.85, 1.05),
                             vx: s.dir * rand(60, 260), vy: rand(-420, -160), life: rand(0.6, 1.1) });
            }
          }
          s.spray = s.spray.filter(function (d) { return (d.life -= dt) > 0; });
          s.spray.forEach(function (d) {
            d.vy += 900 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
            fctx.globalAlpha = Math.min(1, d.life) * env;
            fctx.fillRect(d.x, d.y, 2.5, 2.5);
          });
          fctx.globalAlpha = 1;
        }
      },
      megabolt: {
        init: function () {
          var at = [];
          for (var i = 0; i < 18; i++) at.push(rand(0, 5));
          at.sort(function (a, b) { return a - b; });
          return { dur: 6, at: at };
        },
        draw: function (s) {
          while (s.at.length && s.at[0] <= s.t) {
            s.at.shift();
            strike(Math.random() < 0.4 ? 'near' : undefined);
          }
          // Himmel dunkelt oben kurz nach (nur der Rand)
          var env = smooth(s.t / 0.6) * (1 - smooth((s.t - 5) / 1));
          var dg = fctx.createLinearGradient(0, 0, 0, H * 0.3);
          dg.addColorStop(0, 'rgba(20,24,40,' + (0.35 * env) + ')');
          dg.addColorStop(1, 'rgba(20,24,40,0)');
          fctx.fillStyle = dg;
          fctx.fillRect(0, 0, W, H * 0.3);
        }
      },
      ballbolt: {
        init: function () {
          var flip = Math.random() < 0.5;
          var pts = [[-140, rand(H * 0.2, H * 0.55)], [W * 0.33, rand(H * 0.05, H * 0.95)],
                     [W * 0.66, rand(H * 0.05, H * 0.95)], [W + 140, rand(H * 0.25, H * 0.7)]];
          if (flip) pts = pts.map(function (q) { return [W - q[0], q[1]]; });
          return { dur: 7, pts: pts, trail: [], sparks: [] };
        },
        draw: function (s, dt) {
          var t = smooth(s.t / s.dur) * 0.15 + (s.t / s.dur) * 0.85;
          var u = 1 - t, P = s.pts;
          var x = u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0];
          var y = u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1];
          x += Math.sin(s.t * 9) * 6;
          y += Math.cos(s.t * 7) * 6;
          s.trail.push([x, y]);
          if (s.trail.length > 26) s.trail.shift();
          fctx.lineCap = 'round';
          for (var i = 1; i < s.trail.length; i++) {
            fctx.strokeStyle = 'rgba(170,220,255,' + (i / s.trail.length * 0.35) + ')';
            fctx.lineWidth = i / s.trail.length * 16;
            fctx.beginPath();
            fctx.moveTo(s.trail[i - 1][0], s.trail[i - 1][1]);
            fctx.lineTo(s.trail[i][0], s.trail[i][1]);
            fctx.stroke();
          }
          var pulse = 1 + 0.12 * Math.sin(s.t * 23);
          var glow = fctx.createRadialGradient(x, y, 0, x, y, 90 * pulse);
          glow.addColorStop(0, 'rgba(255,255,255,0.95)');
          glow.addColorStop(0.18, 'rgba(190,230,255,0.85)');
          glow.addColorStop(0.45, 'rgba(120,190,255,0.25)');
          glow.addColorStop(1, 'rgba(120,190,255,0)');
          fctx.fillStyle = glow;
          fctx.fillRect(x - 100, y - 100, 200, 200);
          // Knistern rund um die Kugel
          fctx.strokeStyle = 'rgba(220,240,255,0.8)';
          fctx.lineWidth = 1.4;
          for (var k = 0; k < 3; k++) {
            var ang = rand(0, Math.PI * 2), r0 = 18, r1 = rand(40, 75);
            var arc = [[x + Math.cos(ang) * r0, y + Math.sin(ang) * r0]];
            zigzag(arc[0][0], arc[0][1], x + Math.cos(ang) * r1, y + Math.sin(ang) * r1, 14, 3, arc);
            fctx.beginPath();
            fctx.moveTo(arc[0][0], arc[0][1]);
            for (var a = 1; a < arc.length; a++) fctx.lineTo(arc[a][0], arc[a][1]);
            fctx.stroke();
          }
          for (var n = 0; n < 3; n++) {
            s.sparks.push({ x: x, y: y, vx: rand(-220, 220), vy: rand(-220, 120), life: rand(0.3, 0.7) });
          }
          s.sparks = s.sparks.filter(function (d) { return (d.life -= dt) > 0; });
          fctx.fillStyle = 'rgba(230,245,255,1)';
          s.sparks.forEach(function (d) {
            d.vy += 500 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
            fctx.globalAlpha = Math.min(1, d.life * 2);
            fctx.fillRect(d.x, d.y, 2, 2);
          });
          fctx.globalAlpha = 1;
        }
      },
      avalanche: {
        init: function () {
          var flip = Math.random() < 0.5;
          var chunks = [];
          for (var i = 0; i < 70; i++) {
            chunks.push({ back: rand(0, 520), side: rand(-260, 260), r: rand(26, 105),
                          spin: rand(0, Math.PI * 2), bob: rand(2, 5) });
          }
          return { dur: 9.5, flip: flip, chunks: chunks, powder: [], debris: [] };
        },
        draw: function (s, dt) {
          var p = s.t / s.dur;
          var env = 1 - smooth((p - 0.82) / 0.18);
          // Front läuft von oben rechts nach unten links
          var sx = W + 260, sy = -200, ex = -420, ey = H + 220;
          var f = Math.min(1.2, p * 1.35);
          var dx = ex - sx, dy = ey - sy, len = Math.sqrt(dx * dx + dy * dy);
          var ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
          var fx = sx + dx * f, fy = sy + dy * f;
          function at(back, side) {
            var X = fx - ux * back + nx * side, Y = fy - uy * back + ny * side;
            return s.flip ? [W - X, Y] : [X, Y];
          }
          if (f < 1.15) {
            for (var n = 0; n < 4; n++) {
              var q = at(rand(0, 380), rand(-300, 300));
              s.powder.push({ x: q[0], y: q[1], r: rand(60, 140), grow: rand(40, 90), life: rand(2, 3.2), max: 3.2 });
            }
            for (var d = 0; d < 3; d++) {
              var q2 = at(rand(-20, 60), rand(-260, 260));
              s.debris.push({ x: q2[0], y: q2[1], vx: (s.flip ? -1 : 1) * ux * rand(200, 500) + rand(-80, 80),
                              vy: uy * rand(200, 500) - rand(100, 300), life: rand(0.6, 1.2) });
            }
          }
          s.powder = s.powder.filter(function (o) { return (o.life -= dt) > 0; });
          s.powder.forEach(function (o) {
            o.r += o.grow * dt;
            var a = (o.life / o.max) * 0.32 * env;
            var g = fctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
            g.addColorStop(0, 'rgba(240,245,252,' + a + ')');
            g.addColorStop(1, 'rgba(240,245,252,0)');
            fctx.fillStyle = g;
            fctx.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
          });
          if (f < 1.2) {
            s.chunks.forEach(function (c) {
              var q = at(c.back, c.side + Math.sin(s.t * c.bob + c.spin) * 14);
              var g = fctx.createRadialGradient(q[0] - c.r * 0.25, q[1] - c.r * 0.3, c.r * 0.1, q[0], q[1], c.r);
              g.addColorStop(0, 'rgba(255,255,255,' + (0.95 * env) + ')');
              g.addColorStop(0.6, 'rgba(226,234,246,' + (0.85 * env) + ')');
              g.addColorStop(1, 'rgba(200,214,232,0)');
              fctx.fillStyle = g;
              fctx.beginPath();
              fctx.arc(q[0], q[1], c.r, 0, Math.PI * 2);
              fctx.fill();
            });
          }
          s.debris = s.debris.filter(function (o) { return (o.life -= dt) > 0; });
          fctx.fillStyle = 'rgba(250,252,255,1)';
          s.debris.forEach(function (o) {
            o.vy += 900 * dt; o.x += o.vx * dt; o.y += o.vy * dt;
            fctx.globalAlpha = Math.min(1, o.life * 1.5) * env;
            fctx.beginPath();
            fctx.arc(o.x, o.y, 4, 0, Math.PI * 2);
            fctx.fill();
          });
          fctx.globalAlpha = 1;
        }
      }
    };

    function drawShow(dt) {
      fctx.clearRect(0, 0, W, H);
      if (!show) return;
      show.t += dt;
      if (show.type === 'tint') {
        var a = 0.14 * Math.sin(Math.PI * clamp(show.t / show.dur, 0, 1));
        fctx.fillStyle = 'rgba(' + show.color + ',' + a + ')';
        fctx.fillRect(0, 0, W, H);
      } else {
        SHOWS[show.type].draw(show, dt);
      }
      if (show.t >= show.dur) {
        show = null;
        fctx.clearRect(0, 0, W, H);
        if (queued) { var q = queued; queued = null; startShow(q); }
      }
    }

    // ── Haupt-Schleife ──
    var dtFrame = 0;
    var paused = false;
    function frame(now) {
      var dt = last === null ? 0 : Math.min((now - last) / 1000, 0.05);
      last = now;
      if (paused) dt = 0;
      dtFrame = dt;
      time += dt;

      if (transT < 1) {
        transT = Math.min(1, transT + dt / transSecs);
        cur = mix(from, to, smooth(transT));
      }

      // Erst schlagen, wenn das Gewitter halb aufgezogen ist
      if (time >= nextStrike) {
        if (cur.lightning >= 0.5) strike();
        scheduleStrike();
      }

      var wind = updateWind(dt);
      var counts = manageParts(dt, wind);
      stepParts(dt, wind, counts);
      drawSky(wind);
      drawParts(wind);
      drawBolts(dt);
      drawShow(dt);
      root.requestAnimationFrame(frame);
    }

    prefill();
    scheduleStrike();
    root.requestAnimationFrame(frame);

    return {
      setState: setState,
      strike: strike,
      gust: gust,
      spectacle: spectacle,
      on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      pause: function (v) { paused = !!v; },
      state: function () { return cur; },
      progress: function () { return transT; },
      busy: function () { return show ? show.type : null; },
      counts: function () {
        var c = { rain: 0, drizzle: 0, snow: 0 };
        parts.forEach(function (p) { c[p.type]++; });
        return c;
      }
    };
  }

  root.WeatherKit = {
    KINDS: KINDS,
    SPECTACLES: SPECTACLES,
    profile: profile,
    mix: mix,
    create: create
  };
})(typeof window !== 'undefined' ? window : this);
