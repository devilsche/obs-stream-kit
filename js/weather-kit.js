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
  // lightning 0..2 (aus, selten, oft), windMin = Mindestwind der Lage,
  // night 0..1 (Sterne statt Sonne), dusk 0..1 (Dämmerungsfarben),
  // gloom 0..1 = Grundtrübung am Rand bei nassem Wetter (fehlt = 0)
  var PROFILES = {
    clear:    { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0.08, sun: 0.55, fog: 0,    heat: 0, lightning: 0, windMin: 0, night: 0, dusk: 0 },
    cloudy:   { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0.7,  sun: 0.05, fog: 0.05, heat: 0, lightning: 0, windMin: 0, night: 0, dusk: 0 },
    fog:      { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0.45, sun: 0,    fog: 0.85, heat: 0, lightning: 0, windMin: 0, night: 0, dusk: 0 },
    drizzle:  { precip: 'rain', rain: 0,    drizzle: 0.7, snow: 0,    clouds: 0.6,  sun: 0,    fog: 0.15, heat: 0, lightning: 0, windMin: 0, night: 0, dusk: 0, gloom: 0.15 },
    rain:     { precip: 'rain', rain: 0.75, drizzle: 0.2, snow: 0,    clouds: 0.75, sun: 0,    fog: 0.1,  heat: 0, lightning: 0, windMin: 0, night: 0, dusk: 0, gloom: 0.3 },
    storm:    { precip: 'rain', rain: 1,    drizzle: 0.3, snow: 0,    clouds: 0.95, sun: 0,    fog: 0.15, heat: 0, lightning: 2, windMin: 0.6, night: 0, dusk: 0, gloom: 0.6 },
    sleet:    { precip: 'mix',  rain: 0.35, drizzle: 0.1, snow: 0.45, clouds: 0.75, sun: 0,    fog: 0.15, heat: 0, lightning: 0, windMin: 0.2, night: 0, dusk: 0, gloom: 0.25 },
    snow:     { precip: 'snow', rain: 0,    drizzle: 0,   snow: 0.6,  clouds: 0.6,  sun: 0,    fog: 0.1,  heat: 0, lightning: 0, windMin: 0, night: 0, dusk: 0 },
    blizzard: { precip: 'snow', rain: 0,    drizzle: 0,   snow: 1,    clouds: 0.85, sun: 0,    fog: 0.4,  heat: 0, lightning: 0, windMin: 0.85, night: 0, dusk: 0, gloom: 0.4 },
    heat:     { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0,    sun: 1,    fog: 0,    heat: 1, lightning: 0, windMin: 0, night: 0, dusk: 0 },
    // nur als feste Lage / Chat-Befehl; live kommen Nacht und Dämmerung vom Server
    night:    { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0.05, sun: 0,    fog: 0,    heat: 0, lightning: 0, windMin: 0, night: 1, dusk: 0 },
    dusk:     { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0.15, sun: 0.35, fog: 0,    heat: 0, lightning: 0, windMin: 0, night: 0.2, dusk: 1 }
  };
  var KINDS = Object.keys(PROFILES);
  var SPECTACLES = ['tsunami', 'megabolt', 'ballbolt', 'avalanche',
                    'aurora', 'rainbow', 'hail', 'meteors', 'tornado', 'fogwall'];
  // windRandom (true/false) ist kein Zahlenwert und springt bei der Hälfte des Übergangs
  var NUM_KEYS = ['rain', 'drizzle', 'snow', 'clouds', 'sun', 'fog', 'heat', 'gloom', 'lightning', 'wind', 'night', 'dusk'];

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
    rain:    [460, 300, 160],
    drizzle: [420, 240, 70],
    snow:    [300, 180, 80]
  };
  var RAIN_LAYERS = [
    { speed: 950,  len: [12, 20], width: 1.2, alpha: [0.26, 0.34, 0.42], drift: 0.8 },
    { speed: 1350, len: [20, 34], width: 1.6, alpha: [0.38, 0.48, 0.58], drift: 0.9 },
    { speed: 1850, len: [34, 58], width: 2.1, alpha: [0.52, 0.66, 0.8], drift: 1.0 }
  ];
  var DRIZZLE_LAYERS = [
    { speed: 520, len: [7, 12],  width: 1.1, alpha: [0.3, 0.4, 0.5], drift: 1.1 },
    { speed: 700, len: [10, 16], width: 1.4, alpha: [0.4, 0.52, 0.64], drift: 1.2 },
    { speed: 900, len: [14, 22], width: 1.7, alpha: [0.5, 0.62, 0.74], drift: 1.3 }
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
    // windRandom: Richtung und Stärke wechseln alle 6–15 s weich, mal links, mal rechts
    var wander = 0, wanderAt = 0;
    function windTarget() {
      var w = cur.wind || 0;
      if (cur.windRandom) {
        if (time >= wanderAt) {
          var side = wander > 0 ? -1 : (wander < 0 ? 1 : (Math.random() < 0.5 ? -1 : 1));
          wander = Math.random() < 0.7 ? side * rand(0.25, 1) : rand(-0.3, 0.3);
          wanderAt = time + rand(6, 15);
        }
        w = wander;
      }
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
            // dunkler Schatten unter dem hellen Strich: sichtbar auch vor
            // hellem Himmel oder Sand im Spiel
            pctx.lineWidth = L.width + 1.4;
            pctx.strokeStyle = 'rgba(30,40,60,' + (L.alpha[bk] * 0.45) + ')';
            pctx.stroke();
            pctx.lineWidth = L.width;
            pctx.strokeStyle = 'rgba(190,215,240,' + L.alpha[bk] + ')';
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
    // ── Nacht: Sterne oben am Rand, ab und zu eine Sternschnuppe ──
    var STAR_BAND = H * 0.36;
    var stars = [];
    for (var si = 0; si < 170; si++) {
      // dichter an der Oberkante, an den Seiten etwas tiefer
      var sx = rand(0, W), edge = Math.min(sx, W - sx) / (W / 2);
      stars.push({ x: sx, y: Math.pow(Math.random(), 1.6) * STAR_BAND * (1.35 - 0.5 * edge),
                   r: rand(0.6, 1.8), tw: rand(0.6, 2.2), ph: rand(0, 6.3) });
    }
    var meteor = null, nextMeteor = rand(8, 20);

    function mixRgb(a, b, t) {
      return Math.round(lerp(a[0], b[0], t)) + ',' + Math.round(lerp(a[1], b[1], t)) + ',' + Math.round(lerp(a[2], b[2], t));
    }

    function drawNight(n, c) {
      if (n < 0.01) return;
      var top = sctx.createLinearGradient(0, 0, 0, H * 0.4);
      top.addColorStop(0, 'rgba(8,12,32,' + (0.42 * n) + ')');
      top.addColorStop(1, 'rgba(8,12,32,0)');
      sctx.fillStyle = top;
      sctx.fillRect(0, 0, W, H * 0.4);
      var wet = clamp((cur.rain || 0) + (cur.drizzle || 0) + (cur.snow || 0), 0, 1);
      var vis = n * (1 - 0.9 * c) * (1 - wet);
      if (vis < 0.02) { meteor = null; return; }
      sctx.fillStyle = '#fff';
      stars.forEach(function (st) {
        var fade = Math.pow(clamp(1 - st.y / (STAR_BAND * 1.35), 0, 1), 0.8);
        var tw = reduceMotion ? 0.8 : 0.55 + 0.45 * Math.sin(time * st.tw + st.ph);
        sctx.globalAlpha = vis * fade * tw;
        sctx.beginPath();
        sctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        sctx.fill();
      });
      sctx.globalAlpha = 1;
      if (reduceMotion || vis < 0.4) return;
      if (!meteor && time >= nextMeteor) {
        var fromLeft = Math.random() < 0.5;
        meteor = { x: fromLeft ? rand(150, W * 0.45) : rand(W * 0.55, W - 150), y: rand(20, STAR_BAND * 0.5),
                   vx: (fromLeft ? 1 : -1) * rand(700, 1000), vy: rand(220, 360), t: 0, dur: rand(0.7, 1.1) };
        nextMeteor = time + rand(20, 50);
      }
      if (meteor) {
        meteor.t += dtFrame;
        var k = meteor.t / meteor.dur;
        if (k >= 1) { meteor = null; return; }
        var mx = meteor.x + meteor.vx * meteor.t, my = meteor.y + meteor.vy * meteor.t;
        var ma = vis * Math.sin(Math.PI * k);
        var tail = sctx.createLinearGradient(mx, my, mx - meteor.vx * 0.16, my - meteor.vy * 0.16);
        tail.addColorStop(0, 'rgba(255,255,255,' + ma + ')');
        tail.addColorStop(1, 'rgba(255,255,255,0)');
        sctx.strokeStyle = tail;
        sctx.lineWidth = 2;
        sctx.lineCap = 'round';
        sctx.beginPath();
        sctx.moveTo(mx, my);
        sctx.lineTo(mx - meteor.vx * 0.16, my - meteor.vy * 0.16);
        sctx.stroke();
      }
    }

    // Dämmerung: warmes orange-rosa Band oben und in den oberen Ecken
    function drawDusk(d, c, n) {
      if (d < 0.01) return;
      var a = d * (1 - 0.55 * c);
      var band = sctx.createLinearGradient(0, 0, 0, H * 0.34);
      band.addColorStop(0, 'rgba(255,128,96,' + (0.3 * a) + ')');
      band.addColorStop(0.5, 'rgba(214,96,140,' + (0.12 * a) + ')');
      band.addColorStop(1, 'rgba(120,70,150,0)');
      sctx.fillStyle = band;
      sctx.fillRect(0, 0, W, H * 0.34);
      [0, W].forEach(function (cx) {
        var cg = sctx.createRadialGradient(cx, 0, 0, cx, 0, 620);
        cg.addColorStop(0, 'rgba(255,150,90,' + (0.26 * a * (1 - 0.5 * n)) + ')');
        cg.addColorStop(1, 'rgba(255,150,90,0)');
        sctx.fillStyle = cg;
        sctx.fillRect(cx - 620, 0, 1240, 620);
      });
    }

    var heatMotes = [];
    for (var hm = 0; hm < 18; hm++) {
      heatMotes.push({ x: Math.random() < 0.5 ? rand(0, W * 0.25) : rand(W * 0.75, W),
                       y: rand(H * 0.45, H + 20), r: rand(30, 70), v: rand(25, 60), ph: rand(0, 6.3) });
    }

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

      var n = clamp(cur.night || 0, 0, 1), d = clamp(cur.dusk || 0, 0, 1);
      drawNight(n, c);
      drawDusk(d, c, n);

      // Sonne: warmer Schein und Strahlen aus der oberen linken Ecke,
      // in der Dämmerung orange-rosa
      var sunCore = mixRgb([255, 226, 160], [255, 150, 95], d);
      var sunMid = mixRgb([255, 214, 140], [255, 128, 110], d);
      var rayRgb = mixRgb([255, 236, 190], [255, 175, 125], d);
      if (s > 0.01) {
        var glow = sctx.createRadialGradient(0, 0, 0, 0, 0, 760);
        glow.addColorStop(0, 'rgba(' + sunCore + ',' + (0.5 * s) + ')');
        glow.addColorStop(0.45, 'rgba(' + sunMid + ',' + (0.16 * s) + ')');
        glow.addColorStop(1, 'rgba(' + sunMid + ',0)');
        sctx.fillStyle = glow;
        sctx.fillRect(0, 0, 900, 900);
        for (var r = 0; r < 7; r++) {
          var a0 = (0.12 + r * 0.17) + 0.03 * Math.sin(time * 0.21 + r * 1.7);
          var width = 0.045 + 0.02 * Math.sin(time * 0.33 + r);
          var len = 1150;
          var ray = sctx.createLinearGradient(0, 0, Math.cos(a0) * len, Math.sin(a0) * len);
          var ra = (0.13 + 0.06 * Math.sin(time * 0.5 + r * 2.1)) * s;
          ray.addColorStop(0, 'rgba(' + rayRgb + ',' + ra + ')');
          ray.addColorStop(0.55, 'rgba(' + rayRgb + ',' + (ra * 0.25) + ')');
          ray.addColorStop(0.8, 'rgba(' + rayRgb + ',0)');
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
        // Regenwolken sind dunkler und tiefer als Schönwetterwolken
        var wetAmt = clamp((cur.rain || 0) + 0.6 * (cur.drizzle || 0) + 0.4 * (cur.snow || 0), 0, 1);
        var shade = Math.round(lerp(118, 52, Math.max(g, 0.85 * wetAmt)));
        var bandH = H * (0.34 + 0.12 * wetAmt);
        var band = sctx.createLinearGradient(0, 0, 0, bandH);
        var ta = Math.min(0.92, 0.55 * c + 0.18 * g + 0.25 * wetAmt);
        band.addColorStop(0, 'rgba(' + shade + ',' + (shade + 8) + ',' + (shade + 22) + ',' + ta + ')');
        band.addColorStop(0.55, 'rgba(' + shade + ',' + (shade + 8) + ',' + (shade + 22) + ',' + (ta * (0.3 + 0.35 * wetAmt)) + ')');
        band.addColorStop(1, 'rgba(' + shade + ',' + (shade + 8) + ',' + (shade + 22) + ',0)');
        sctx.fillStyle = band;
        sctx.fillRect(0, 0, W, bandH);
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
        var vg = sctx.createRadialGradient(0, 0, W * 0.34, 0, 0, W * 0.66);
        vg.addColorStop(0, 'rgba(18,22,32,0)');
        vg.addColorStop(1, 'rgba(18,22,32,' + (0.7 * g) + ')');
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
        // warmer Rand (Mitte frei), Glut von unten, aufsteigendes Flimmern
        sctx.save();
        sctx.translate(W / 2, H / 2);
        sctx.scale(1, H / W);
        var hv = sctx.createRadialGradient(0, 0, W * 0.4, 0, 0, W * 0.75);
        hv.addColorStop(0, 'rgba(255,140,40,0)');
        hv.addColorStop(1, 'rgba(255,140,40,' + (0.3 * h) + ')');
        sctx.fillStyle = hv;
        sctx.fillRect(-W, -W, W * 2, W * 2);
        sctx.restore();
        var hb = sctx.createLinearGradient(0, H, 0, H - 320);
        hb.addColorStop(0, 'rgba(255,130,40,' + (0.38 * h) + ')');
        hb.addColorStop(1, 'rgba(255,130,40,0)');
        sctx.fillStyle = hb;
        sctx.fillRect(0, H - 320, W, 320);
        sctx.lineWidth = 3;
        for (var l = 0; l < 14; l++) {
          var y0 = H - ((time * 26 + l * 19) % 260);
          var la = 0.16 * h * (1 - (H - y0) / 260);
          sctx.strokeStyle = 'rgba(255,236,200,' + la + ')';
          sctx.beginPath();
          for (var x = 0; x <= W; x += 30) {
            var yy = y0 + Math.sin(x * 0.011 + time * 2.4 + l) * 6;
            if (x === 0) sctx.moveTo(x, yy); else sctx.lineTo(x, yy);
          }
          sctx.stroke();
        }
        // Hitzeblasen steigen an den Seiten auf
        heatMotes.forEach(function (m) {
          m.y -= m.v * dtFrame;
          if (m.y < H * 0.45) { m.y = H + 20; m.x = Math.random() < 0.5 ? rand(0, W * 0.25) : rand(W * 0.75, W); }
          var ma = 0.22 * h * clamp((m.y - H * 0.45) / (H * 0.25), 0, 1);
          var mg = sctx.createRadialGradient(m.x + Math.sin(time * 1.7 + m.ph) * 14, m.y, 0, m.x, m.y, m.r);
          mg.addColorStop(0, 'rgba(255,225,170,' + ma + ')');
          mg.addColorStop(1, 'rgba(255,225,170,0)');
          sctx.fillStyle = mg;
          sctx.fillRect(m.x - m.r - 20, m.y - m.r, m.r * 2 + 40, m.r * 2);
        });
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

    var TINT = { tsunami: '40,120,190', megabolt: '200,215,255', ballbolt: '255,170,80', avalanche: '235,242,250',
                 aurora: '90,230,160', rainbow: '255,210,140', hail: '220,228,240', meteors: '200,215,255',
                 tornado: '150,140,120', fogwall: '225,230,235' };

    var SHOWS = {
      tsunami: {
        // Welle läuft beschleunigend von einer Seite durch, rollt sich vorne
        // rund ein (Röhre), Schaumteppich dahinter, Gischt von der Lippe
        init: function () {
          return { dur: 6.5, dir: Math.random() < 0.5 ? 1 : -1, spray: [] };
        },
        draw: function (s, dt) {
          var p = s.t / s.dur;
          var env = smooth(p / 0.1) * (1 - smooth((p - 0.86) / 0.14));
          var run = Math.pow(p, 1.35);
          var crest = s.dir > 0 ? lerp(-W * 0.25, W * 1.4, run) : lerp(W * 1.25, -W * 0.4, run);
          var dir = s.dir;
          var top = H * 0.62 * env;
          var L = W * 0.9;
          var level = function (x) {
            var d = (crest - x) * dir;                // > 0 hinter dem Kamm
            if (d < 0) return 0;
            // am Kamm volle Höhe, nach hinten flacher auslaufend
            var h = top * (1 - 0.62 * smooth(d / L)) * (0.92 + 0.08 * smooth(d / 160));
            return h + Math.sin(x * 0.018 + s.t * 4) * 12 * env;
          };
          var fx = function (dx) { return crest + dir * dx; };
          var x0 = crest - dir * (L + 240);

          // Wasserkörper mit Lippe
          var grad = fctx.createLinearGradient(0, H - top * 1.15, 0, H);
          grad.addColorStop(0, 'rgba(150,225,245,' + (0.92 * env) + ')');
          grad.addColorStop(0.3, 'rgba(40,140,200,' + (0.92 * env) + ')');
          grad.addColorStop(1, 'rgba(10,50,100,' + (0.95 * env) + ')');
          fctx.fillStyle = grad;
          fctx.beginPath();
          fctx.moveTo(x0, H + 10);
          var x;
          for (x = x0; (crest - x) * dir >= 0; x += 20 * dir) fctx.lineTo(x, H - level(x));
          // Lippe: steigt über den Kamm, rollt rund nach vorn und unten ein
          fctx.bezierCurveTo(fx(40), H - top * 1.16, fx(170), H - top * 1.14, fx(205), H - top * 0.86);
          fctx.bezierCurveTo(fx(220), H - top * 0.72, fx(165), H - top * 0.62, fx(120), H - top * 0.7);
          // Unterseite der Lippe zurück, dann die Wand hinunter
          fctx.bezierCurveTo(fx(70), H - top * 0.6, fx(50), H - top * 0.3, fx(150), H + 10);
          fctx.closePath();
          fctx.fill();

          // Röhre: dunkler Hohlraum unter der Lippe
          var tube = fctx.createRadialGradient(fx(105), H - top * 0.5, 0, fx(105), H - top * 0.5, top * 0.32);
          tube.addColorStop(0, 'rgba(5,30,60,' + (0.55 * env) + ')');
          tube.addColorStop(1, 'rgba(5,30,60,0)');
          fctx.fillStyle = tube;
          fctx.beginPath();
          fctx.moveTo(fx(120), H - top * 0.7);
          fctx.bezierCurveTo(fx(70), H - top * 0.6, fx(50), H - top * 0.3, fx(150), H + 10);
          fctx.lineTo(fx(40), H + 10);
          fctx.lineTo(fx(40), H - top * 0.8);
          fctx.closePath();
          fctx.fill();

          // Schaumkante auf der Lippe und Schaumteppich dahinter
          fctx.fillStyle = 'rgba(245,252,255,' + (0.9 * env) + ')';
          for (var k = 0; k < 26; k++) {
            var t = k / 25;
            var lx = lerp(crest, fx(200), t), ly = H - top * (1.0 + 0.14 * Math.sin(Math.PI * t * 0.9));
            fctx.beginPath();
            fctx.arc(lx + rand(-5, 5), ly + rand(-6, 6), rand(2, 6), 0, Math.PI * 2);
            fctx.fill();
          }
          for (x = crest - dir * 700; (crest - x) * dir >= 0; x += 8 * dir) {
            var near = 1 - Math.abs(crest - x) / 700;
            if (Math.random() > 0.3 + near * 0.6) continue;
            fctx.beginPath();
            fctx.arc(x + rand(-4, 4), H - level(x) + rand(-8, 10), rand(1.5, 2.5 + near * 4.5), 0, Math.PI * 2);
            fctx.fill();
          }

          // Gischt von der Lippe und am Fuß der Wand
          if (env > 0.25) {
            for (var n = 0; n < 12; n++) {
              var fromLip = n < 8;
              s.spray.push({ x: fromLip ? fx(rand(120, 210)) : fx(rand(120, 200)),
                             y: fromLip ? H - top * rand(0.85, 1.1) : H - rand(0, 40),
                             vx: dir * rand(120, 480), vy: fromLip ? rand(-520, -200) : rand(-700, -300),
                             life: rand(0.6, 1.2), r: rand(1.5, 3.5) });
            }
          }
          s.spray = s.spray.filter(function (d) { return (d.life -= dt) > 0; });
          fctx.fillStyle = 'rgba(240,250,255,1)';
          s.spray.forEach(function (d) {
            d.vy += 1000 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
            fctx.globalAlpha = Math.min(1, d.life) * env * 0.9;
            fctx.beginPath();
            fctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
            fctx.fill();
          });
          fctx.globalAlpha = 1;
        }
      },
      megabolt: {
        // Gewitterwand: große dunkle Wolken rollen von oben herein (Himmels-
        // Ebene ohne Rand-Fade, damit sie bis an die Bildkante reicht), dann
        // schlagen die Blitze ein und erhellen die Wolken von innen
        init: function () {
          var at = [];
          for (var i = 0; i < 18; i++) at.push(rand(1.2, 6.2));
          at.sort(function (a, b) { return a - b; });
          var clouds = [];
          for (var c = 0; c < 16; c++) {
            clouds.push({ x: -200 + c * ((W + 400) / 15) + rand(-60, 60), y: rand(-90, 120),
                          r: rand(200, 340), back: c % 2 === 0, s: rand(-10, 10) });
          }
          return { dur: 7.6, at: at, clouds: clouds, glow: 0, glowX: W / 2 };
        },
        draw: function (s, dt) {
          while (s.at.length && s.at[0] <= s.t) {
            s.at.shift();
            strike(Math.random() < 0.4 ? 'near' : undefined);
            var b = bolts[bolts.length - 1];
            s.glow = 1;
            s.glowX = b.paths[0].pts[0][0];
          }
          s.glow = Math.max(0, s.glow - dt * 3.2);
          var env = smooth(s.t / 1.2) * (1 - smooth((s.t - (s.dur - 1.4)) / 1.4));
          if (env <= 0.001) return;
          var drop = (1 - env) * 300;

          // dunkler Himmel hinter den Wolken
          var dg = sctx.createLinearGradient(0, 0, 0, H * 0.42);
          dg.addColorStop(0, 'rgba(14,16,26,' + (0.72 * env) + ')');
          dg.addColorStop(0.6, 'rgba(14,16,26,' + (0.3 * env) + ')');
          dg.addColorStop(1, 'rgba(14,16,26,0)');
          sctx.fillStyle = dg;
          sctx.fillRect(0, 0, W, H * 0.42);

          [true, false].forEach(function (back) {
            s.clouds.forEach(function (c) {
              if (c.back !== back) return;
              c.x += c.s * dt;
              var y = c.y - drop * (back ? 0.7 : 1);
              var r = back ? c.r * 1.15 : c.r;
              var base = back ? 22 : 34;
              var a = (back ? 0.85 : 0.78) * env;
              var g = sctx.createRadialGradient(c.x, y, 0, c.x, y, r);
              g.addColorStop(0, 'rgba(' + base + ',' + (base + 3) + ',' + (base + 12) + ',' + a + ')');
              g.addColorStop(0.55, 'rgba(' + base + ',' + (base + 3) + ',' + (base + 12) + ',' + (a * 0.75) + ')');
              g.addColorStop(1, 'rgba(' + base + ',' + (base + 3) + ',' + (base + 12) + ',0)');
              sctx.fillStyle = g;
              sctx.fillRect(c.x - r, y - r, r * 2, r * 2);
              // Wolkenunterseite leuchtet beim Einschlag in der Nähe auf
              if (!back && s.glow > 0.02) {
                var near = Math.max(0, 1 - Math.abs(c.x - s.glowX) / 700);
                var la = 0.55 * s.glow * near * env;
                if (la > 0.01) {
                  var lg = sctx.createRadialGradient(c.x, y + r * 0.35, 0, c.x, y + r * 0.35, r * 0.8);
                  lg.addColorStop(0, 'rgba(190,200,255,' + la + ')');
                  lg.addColorStop(1, 'rgba(190,200,255,0)');
                  sctx.fillStyle = lg;
                  sctx.fillRect(c.x - r, y - r * 0.5, r * 2, r * 1.7);
                }
              }
            });
          });
        }
      },
      ballbolt: {
        // Kugelblitz wie beschrieben: erst ein Einschlag, dort glimmt eine
        // gelb-orange Kugel auf, schwebt langsam taumelnd ein Stück und
        // erlischt lautlos oder platzt mit Lichtblitz und Funken
        init: function () {
          var life = rand(4, 6);
          return { dur: 0.7 + life + 1.2, born: 0.7, life: life, pop: Math.random() < 0.5,
                   x: 0, y: 0, vx: rand(-70, 70), vy: rand(-18, 10), seed: rand(0, 100),
                   sparks: [], struck: false, popped: false };
        },
        draw: function (s, dt) {
          if (!s.struck) {
            s.struck = true;
            strike('near');
            var trunk = bolts[bolts.length - 1].paths[0].pts;
            var end = trunk[trunk.length - 1];
            s.x = clamp(end[0], 160, W - 160);
            s.y = clamp(end[1] - 60, 140, H - 160);
          }
          var age = s.t - s.born;
          if (age >= 0 && age < s.life) {
            // taumeln: zwei überlagerte Schwingungen statt gerader Bahn
            s.x += (s.vx + 34 * Math.sin(s.t * 1.3 + s.seed)) * dt;
            s.y += (s.vy + 22 * Math.sin(s.t * 1.9 + s.seed * 2)) * dt;
            var grow = smooth(age / 0.5);
            var shrink = s.pop ? 1 : 1 - smooth((age - (s.life - 0.9)) / 0.9);
            var flick = 0.82 + 0.18 * Math.sin(s.t * 29 + Math.sin(s.t * 7) * 3);
            var k = grow * shrink * flick;
            var R = 46 * (0.4 + 0.6 * grow * (s.pop ? 1 : shrink));
            var g = fctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R * 2.4);
            g.addColorStop(0, 'rgba(255,252,225,' + (0.95 * k) + ')');
            g.addColorStop(0.14, 'rgba(255,214,110,' + (0.9 * k) + ')');
            g.addColorStop(0.32, 'rgba(255,140,50,' + (0.45 * k) + ')');
            g.addColorStop(0.6, 'rgba(220,70,30,' + (0.14 * k) + ')');
            g.addColorStop(1, 'rgba(220,70,30,0)');
            fctx.fillStyle = g;
            fctx.fillRect(s.x - R * 2.4, s.y - R * 2.4, R * 4.8, R * 4.8);
            if (Math.random() < dt * 5) {
              s.sparks.push({ x: s.x, y: s.y, vx: rand(-90, 90), vy: rand(-90, 40), life: rand(0.3, 0.6), max: 0.6 });
            }
          } else if (age >= s.life && s.pop && !s.popped) {
            // Knall: kurzer Lichtblitz und Funkenregen
            s.popped = true;
            flash(s.x < W * 0.38 ? 'left' : (s.x > W * 0.62 ? 'right' : 'center'));
            emit('pop', s.x);
            for (var i = 0; i < 46; i++) {
              var ang = rand(0, Math.PI * 2), sp = rand(160, 520);
              s.sparks.push({ x: s.x, y: s.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                              life: rand(0.5, 1.1), max: 1.1 });
            }
          }
          if (s.popped && age - s.life < 0.3) {
            var pk = 1 - (age - s.life) / 0.3;
            var pr = 60 + 260 * (1 - pk);
            var pg = fctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, pr);
            pg.addColorStop(0, 'rgba(255,245,210,' + (0.8 * pk) + ')');
            pg.addColorStop(1, 'rgba(255,170,80,0)');
            fctx.fillStyle = pg;
            fctx.fillRect(s.x - pr, s.y - pr, pr * 2, pr * 2);
          }
          s.sparks = s.sparks.filter(function (d) { return (d.life -= dt) > 0; });
          s.sparks.forEach(function (d) {
            d.vy += 380 * dt; d.vx *= 1 - 1.2 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
            fctx.fillStyle = 'rgba(255,' + Math.round(170 + 80 * d.life / d.max) + ',90,' + Math.min(1, d.life * 2) + ')';
            fctx.fillRect(d.x - 1.2, d.y - 1.2, 2.4, 2.4);
          });
        }
      },
      aurora: {
        // Polarlicht: grün-violette Vorhänge wabern oben am Rand. Gezeichnet in
        // 1/8 Auflösung und weich hochskaliert, damit keine Säulen-Streifen
        // entstehen; feine Strahlen schimmern nur leicht durch
        init: function () {
          var c = [];
          for (var i = 0; i < 3; i++) c.push({ ph: rand(0, 6.3), sp: rand(0.25, 0.5), y: rand(70, 150), h: rand(150, 260) });
          var off = document.createElement('canvas');
          off.width = W / 8;
          off.height = Math.round(H * 0.5 / 8);
          return { dur: 12, curtains: c, off: off, octx: off.getContext('2d') };
        },
        draw: function (s) {
          var env = smooth(s.t / 2.5) * (1 - smooth((s.t - (s.dur - 2.5)) / 2.5));
          var sky = sctx.createLinearGradient(0, 0, 0, H * 0.45);
          sky.addColorStop(0, 'rgba(6,10,28,' + (0.82 * env) + ')');
          sky.addColorStop(0.6, 'rgba(6,10,28,' + (0.45 * env) + ')');
          sky.addColorStop(1, 'rgba(6,10,28,0)');
          sctx.fillStyle = sky;
          sctx.fillRect(0, 0, W, H * 0.45);
          var o = s.octx, S = 8, ow = s.off.width;
          o.clearRect(0, 0, ow, s.off.height);
          s.curtains.forEach(function (c, ci) {
            for (var px = 0; px < ow; px++) {
              var x = px * S;
              var base = c.y + 45 * Math.sin(x * 0.0035 + s.t * c.sp + c.ph) + 18 * Math.sin(x * 0.011 - s.t * 0.9 + ci);
              var hgt = c.h * (0.6 + 0.4 * Math.sin(x * 0.007 + s.t * 0.7 + c.ph));
              // weiche Helligkeitswellen statt Zufall pro Säule
              var a = env * (0.34 + 0.16 * Math.sin(x * 0.006 + s.t * 1.3 + ci * 2) + 0.06 * Math.sin(x * 0.05 + s.t * 3));
              var g = o.createLinearGradient(0, (base - hgt) / S, 0, (base + 30) / S);
              g.addColorStop(0, 'rgba(150,90,220,0)');
              g.addColorStop(0.55, 'rgba(120,120,230,' + (a * 0.6) + ')');
              g.addColorStop(0.9, 'rgba(90,255,170,' + a + ')');
              g.addColorStop(1, 'rgba(90,255,170,0)');
              o.fillStyle = g;
              o.fillRect(px, (base - hgt) / S, 1, (hgt + 30) / S);
            }
          });
          sctx.save();
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = 'high';
          sctx.drawImage(s.off, 0, 0, W, s.off.height * S);
          sctx.restore();
        }
      },
      rainbow: {
        // Regenbogen spannt sich von links nach rechts über den oberen Rand auf
        init: function () { return { dur: 10 }; },
        draw: function (s) {
          var env = 1 - smooth((s.t - (s.dur - 2.5)) / 2.5);
          var reveal = smooth(s.t / 3);
          var cx = W / 2, cy = H * 1.3, R = H * 1.18;
          var a0 = Math.PI + 0.12, a1 = a0 + (Math.PI - 0.24) * reveal;
          var COLORS = ['255,70,70', '255,150,50', '255,230,80', '90,210,110', '80,160,255', '150,100,230'];
          sctx.lineWidth = 16;
          COLORS.forEach(function (col, i) {
            sctx.strokeStyle = 'rgba(' + col + ',' + (0.32 * env) + ')';
            sctx.beginPath();
            sctx.arc(cx, cy, R - i * 15, a0, a1);
            sctx.stroke();
          });
          var halo = sctx.createRadialGradient(cx, cy, R - 120, cx, cy, R + 40);
          halo.addColorStop(0, 'rgba(255,255,255,0)');
          halo.addColorStop(0.7, 'rgba(255,255,255,' + (0.06 * env * reveal) + ')');
          halo.addColorStop(1, 'rgba(255,255,255,0)');
          sctx.fillStyle = halo;
          sctx.fillRect(0, 0, W, H * 0.5);
        }
      },
      hail: {
        // Hagelschauer: Körner prasseln schräg, springen am Boden auf
        init: function () { return { dur: 6, stones: [], acc: 0 }; },
        draw: function (s, dt) {
          var env = smooth(s.t / 0.5) * (1 - smooth((s.t - 4.6) / 0.8));
          var dg = sctx.createLinearGradient(0, 0, 0, H * 0.35);
          dg.addColorStop(0, 'rgba(40,46,60,' + (0.45 * env) + ')');
          dg.addColorStop(1, 'rgba(40,46,60,0)');
          sctx.fillStyle = dg;
          sctx.fillRect(0, 0, W, H * 0.35);
          s.acc += 160 * env * dt;
          while (s.acc >= 1) {
            s.acc -= 1;
            s.stones.push({ x: rand(-100, W), y: rand(-60, -10), vx: rand(140, 260), vy: rand(1200, 1600),
                            r: rand(2, 4.5), ground: H - rand(5, 70), bounced: 0, life: 1 });
          }
          fctx.fillStyle = 'rgba(235,242,250,1)';
          s.stones = s.stones.filter(function (h) {
            h.vy += 1400 * dt; h.x += h.vx * dt; h.y += h.vy * dt;
            if (h.y >= h.ground && h.vy > 0) {
              if (h.bounced >= 2) return false;
              h.y = h.ground; h.vy *= -rand(0.25, 0.4); h.vx *= 0.6; h.bounced++;
            }
            if (h.bounced) h.life -= dt * 0.9;
            if (h.life <= 0) return false;
            fctx.globalAlpha = h.life * 0.95;
            fctx.beginPath();
            fctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
            fctx.fill();
            return true;
          });
          fctx.globalAlpha = 1;
        }
      },
      meteors: {
        // Sternschnuppenregen: kurz Nachthimmel oben, viele Schnuppen
        init: function () {
          var at = [];
          for (var i = 0; i < 26; i++) at.push(rand(0.8, 7.2));
          at.sort(function (a, b) { return a - b; });
          return { dur: 9, at: at, list: [] };
        },
        draw: function (s, dt) {
          var env = smooth(s.t / 1.2) * (1 - smooth((s.t - 7.6) / 1.4));
          var sky = sctx.createLinearGradient(0, 0, 0, H * 0.42);
          sky.addColorStop(0, 'rgba(8,12,34,' + (0.82 * env) + ')');
          sky.addColorStop(0.6, 'rgba(8,12,34,' + (0.45 * env) + ')');
          sky.addColorStop(1, 'rgba(8,12,34,0)');
          sctx.fillStyle = sky;
          sctx.fillRect(0, 0, W, H * 0.42);
          while (s.at.length && s.at[0] <= s.t) {
            s.at.shift();
            var left = Math.random() < 0.5;
            s.list.push({ x: left ? rand(0, W * 0.6) : rand(W * 0.4, W), y: rand(10, H * 0.22),
                          vx: (left ? 1 : -1) * rand(800, 1300), vy: rand(250, 450), t: 0, dur: rand(0.6, 1.1),
                          w: rand(2.5, 4.5) });
          }
          sctx.lineCap = 'round';
          s.list = s.list.filter(function (m) {
            m.t += dt;
            var k = m.t / m.dur;
            if (k >= 1) return false;
            var mx = m.x + m.vx * m.t, my = m.y + m.vy * m.t, a = env * Math.sin(Math.PI * k);
            var glowR = m.w * 3;
            var head = sctx.createRadialGradient(mx, my, 0, mx, my, glowR);
            head.addColorStop(0, 'rgba(255,255,255,' + a + ')');
            head.addColorStop(1, 'rgba(255,255,255,0)');
            sctx.fillStyle = head;
            sctx.fillRect(mx - glowR, my - glowR, glowR * 2, glowR * 2);
            var tail = sctx.createLinearGradient(mx, my, mx - m.vx * 0.2, my - m.vy * 0.2);
            tail.addColorStop(0, 'rgba(255,255,255,' + a + ')');
            tail.addColorStop(0.3, 'rgba(200,220,255,' + (a * 0.5) + ')');
            tail.addColorStop(1, 'rgba(200,220,255,0)');
            sctx.strokeStyle = tail;
            sctx.lineWidth = m.w;
            sctx.beginPath();
            sctx.moveTo(mx, my);
            sctx.lineTo(mx - m.vx * 0.2, my - m.vy * 0.2);
            sctx.stroke();
            return true;
          });
        }
      },
      tornado: {
        // Windhose: dunkler Trichter unter einer Wolkenbasis, unten schmal,
        // oben breit, dreht sich (Wirbelstreifen), Staub und Trümmer am Fuß
        init: function () {
          var dir = Math.random() < 0.5 ? 1 : -1;
          var debris = [];
          for (var i = 0; i < 120; i++) debris.push({ h: Math.pow(Math.random(), 1.8), a: rand(0, 6.3), sp: rand(3, 7), r: rand(2, 5) });
          return { dur: 9, dir: dir, debris: debris };
        },
        draw: function (s) {
          var p = s.t / s.dur;
          var env = smooth(p / 0.12) * (1 - smooth((p - 0.85) / 0.15));
          var x = s.dir > 0 ? lerp(-200, W + 200, p) : lerp(W + 200, -200, p);
          var topY = H * 0.2;
          var swayAt = function (k) { return Math.sin(s.t * 1.8 + k * 2.6) * 55 * k + Math.sin(s.t * 4.5 + k * 8) * 7; };
          var widthAt = function (k) { return lerp(16, 250, Math.pow(k, 1.9)); };

          // Wolkenbasis oben (Himmels-Ebene)
          var cb = sctx.createRadialGradient(x, topY - 40, 0, x, topY - 40, 620);
          cb.addColorStop(0, 'rgba(40,40,46,' + (0.75 * env) + ')');
          cb.addColorStop(1, 'rgba(40,40,46,0)');
          sctx.save();
          sctx.translate(x, topY - 40); sctx.scale(1, 0.35); sctx.translate(-x, -(topY - 40));
          sctx.fillStyle = cb;
          sctx.fillRect(x - 620, topY - 660, 1240, 1240);
          sctx.restore();

          // Trichter in Streifen, Mitte dunkel, Ränder weich
          var n = 48, bandH = (H + 10 - topY) / n;
          for (var i = 0; i < n; i++) {
            var k = 1 - i / (n - 1);                  // 1 = oben, 0 = Boden
            // ganze Pixel, ohne Überlappung: sonst zeigen sich Nahtlinien
            var y = Math.round(topY + i * bandH), y2 = Math.round(topY + (i + 1) * bandH);
            var cx = x + swayAt(k), w = widthAt(k);
            // oben weich in die Wolkenbasis übergehen, keine harte Kante
            var a = env * (0.92 - 0.2 * k) * smooth(i / 8);
            var g = fctx.createLinearGradient(cx - w, 0, cx + w, 0);
            g.addColorStop(0, 'rgba(60,57,54,0)');
            g.addColorStop(0.22, 'rgba(60,57,54,' + (a * 0.85) + ')');
            g.addColorStop(0.5, 'rgba(46,44,42,' + a + ')');
            g.addColorStop(0.78, 'rgba(60,57,54,' + (a * 0.85) + ')');
            g.addColorStop(1, 'rgba(60,57,54,0)');
            fctx.fillStyle = g;
            fctx.fillRect(cx - w, y, w * 2, y2 - y);
          }
          // Wirbelstreifen wandern nach oben und zeigen die Drehung
          fctx.lineWidth = 2;
          for (var j = 0; j < 9; j++) {
            var kk = ((s.t * 0.22 + j / 9) % 1);
            var yy = lerp(H, topY, kk), cx2 = x + swayAt(kk), w2 = widthAt(kk) * 0.75;
            var off = Math.sin(s.t * 6 + j) * w2 * 0.5;
            fctx.strokeStyle = 'rgba(150,145,138,' + (0.5 * env * Math.sin(Math.PI * kk)) + ')';
            fctx.beginPath();
            fctx.moveTo(cx2 - w2, yy + 6);
            fctx.quadraticCurveTo(cx2 + off, yy - 10, cx2 + w2, yy + 4);
            fctx.stroke();
          }
          // Staubwolke am Fuß
          var dust = fctx.createRadialGradient(x, H, 0, x, H, 240);
          dust.addColorStop(0, 'rgba(160,138,108,' + (0.75 * env) + ')');
          dust.addColorStop(1, 'rgba(160,138,108,0)');
          fctx.fillStyle = dust;
          fctx.fillRect(x - 240, H - 240, 480, 240);
          fctx.fillStyle = 'rgba(55,48,40,1)';
          s.debris.forEach(function (d) {
            d.a += d.sp * 0.016;
            var y = lerp(H - 10, topY + 60, d.h);
            var rw = widthAt(d.h) * 1.15;
            fctx.globalAlpha = env * (0.55 + 0.45 * Math.sin(d.a));
            fctx.fillRect(x + swayAt(d.h) + Math.cos(d.a) * rw - d.r / 2, y + Math.sin(d.a) * rw * 0.25, d.r, d.r);
          });
          fctx.globalAlpha = 1;
        }
      },
      fogwall: {
        // Nebelwand rollt von einer Seite quer durch und verzieht sich
        init: function () {
          var dir = Math.random() < 0.5 ? 1 : -1, puffs = [];
          // Wand etwa 90 % der Bildbreite tief, fegt einmal komplett durch
          for (var i = 0; i < 70; i++) puffs.push({ off: rand(0, W * 0.9), y: rand(-80, H + 80), r: rand(220, 400), wob: rand(0, 6.3) });
          return { dur: 11, dir: dir, puffs: puffs };
        },
        draw: function (s) {
          var p = s.t / s.dur;
          var env = smooth(p / 0.06) * (1 - smooth((p - 0.9) / 0.1));
          var front = s.dir > 0 ? lerp(-400, W * 1.9 + 400, p) : lerp(W + 400, -W * 0.9 - 400, p);
          s.puffs.forEach(function (f) {
            var x = front - s.dir * f.off + Math.sin(s.t * 0.8 + f.wob) * 30;
            var y = f.y + Math.sin(s.t * 0.5 + f.wob) * 20;
            var g = fctx.createRadialGradient(x, y, 0, x, y, f.r);
            g.addColorStop(0, 'rgba(228,232,238,' + (0.34 * env) + ')');
            g.addColorStop(1, 'rgba(228,232,238,0)');
            fctx.fillStyle = g;
            fctx.fillRect(x - f.r, y - f.r, f.r * 2, f.r * 2);
          });
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
