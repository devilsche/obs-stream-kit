/* Wetter-Baustein: Regen, Niesel, Schnee, Wolken, Nebel, Sonne, Hitze,
 * Blitz, Wind und Spektakel auf Canvas — mit weichen Übergängen.
 *
 * Nutzung:
 *   var kit = WeatherKit.create(stageEl);
 *   kit.setState(WeatherKit.profile('rain'), 25);   // Übergang in s
 *   kit.strike(); kit.gust(); kit.spectacle('tsunami');
 *   kit.on('spectacle', function (info) { … });   // Art, Dauer, Live-Abfragen
 *   kit.on('strike', function (dist, hit) { … });  // hit.x/y = Blitz-Ende, hit.ground(x, y) verlängert bis dorthin
 *   kit.dark();                                     // Abdunklung durch den Mega-Blitz 0..1
 *   kit.blizzard();                                 // Schneesturm-Grad 0..1
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
    dawn:     { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0.15, sun: 0.35, fog: 0.1,  heat: 0, lightning: 0, windMin: 0, night: 0.2, dusk: 1 },
    dusk:     { precip: 'none', rain: 0,    drizzle: 0,   snow: 0,    clouds: 0.15, sun: 0.35, fog: 0,    heat: 0, lightning: 0, windMin: 0, night: 0.2, dusk: 1 }
  };
  var KINDS = Object.keys(PROFILES);
  var SPECTACLES = ['tsunami', 'megabolt', 'ballbolt', 'avalanche',
                    'aurora', 'rainbow', 'hail', 'meteors', 'tornado', 'fogwall'];
  // windRandom (true/false) ist kein Zahlenwert und springt bei der Hälfte des Übergangs
  var NUM_KEYS = ['rain', 'drizzle', 'snow', 'clouds', 'sun', 'fog', 'heat', 'gloom', 'lightning', 'wind', 'night', 'dusk', 'mood', 'aurora'];

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

    function emit(ev, arg, arg2) { (listeners[ev] || []).forEach(function (fn) { fn(arg, arg2); }); }

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
    // Dächer (z. B. Sonnenschirm): [{x0, x1, y(x)}]; Regen zerplatzt dort,
    // an den Rändern tropft es ab
    var shelters = [], splashes = [], drips = [];
    var spawnAcc = {};

    function target(type, li) {
      var amount = type === 'rain' ? cur.rain : type === 'drizzle' ? cur.drizzle : cur.snow;
      // im Schneesturm deutlich mehr Flocken
      var storm = type === 'snow' ? 1 + 1.4 * bz : 1;
      return Math.round(COUNT[type][li] * clamp(amount, 0, 1) * motionScale * storm);
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
        // im Schneesturm kommt ein Teil seitlich herein (Rand blendet weich)
        if (!initial && Math.random() < 0.75 * bz) {
          p.x = wind > 0 ? rand(-60, -10) : rand(W + 10, W + 60);
          p.y = rand(-20, H * 0.9);
        }
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
          // Schneesturm: Flocken jagen fast waagerecht; nasser Schnee fällt schneller
          p.y += p.v * (1 + 0.4 * bz + 1.1 * wetS) * dt;
          p.x += (wind * (160 + p.layer * 90) * sl.drift * (1 + 2.2 * bz) +
                  Math.sin(p.phase + time * p.freq) * sl.sway) * dt;
          gone = p.y - p.r > H || p.x < -1000 || p.x > W + 1000;
          // Flocken bleiben auf einem Dach liegen (ohne Spritzer)
          for (var sj = 0; sj < shelters.length && !gone; sj++) {
            var sf = shelters[sj];
            if (p.x >= sf.x0 && p.x <= sf.x1 && p.y >= sf.y(p.x)) gone = true;
          }
        } else {
          var L = (p.type === 'rain' ? RAIN_LAYERS : DRIZZLE_LAYERS)[p.layer];
          var dy = p.v * dt;
          p.y += dy;
          p.x += dy * tanA * L.drift;
          gone = p.y - p.len > H;
          for (var si = 0; si < shelters.length && !gone; si++) {
            var sh = shelters[si];
            if (p.x < sh.x0 || p.x > sh.x1) continue;
            var sy = sh.y(p.x);
            if (p.y >= sy && p.y - dy < sy + 4) {
              gone = true;
              if (splashes.length < 80) splashes.push({ x: p.x, y: sy, t: 0 });
              // jeder vierte Tropfen läuft zum nächsten Rand und tropft ab
              if (Math.random() < 0.25 && drips.length < 60) {
                var ex = p.x - sh.x0 < sh.x1 - p.x ? sh.x0 + 2 : sh.x1 - 2;
                drips.push({ x: ex, y: sh.y(ex) + 2, v: 0, wait: 0.15 + Math.random() * 0.5 });
              }
            }
          }
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
      splashes.forEach(function (s) { s.t += dt; });
      splashes = splashes.filter(function (s) { return s.t < 0.22; });
      drips.forEach(function (d) {
        if (d.wait > 0) { d.wait -= dt; return; }
        d.v += 1800 * dt;
        d.y += d.v * dt;
      });
      drips = drips.filter(function (d) { return d.y < H + 20; });
    }

    function drawParts(wind) {
      pctx.clearRect(0, 0, W, H);
      // Spritzer auf dem Dach und abtropfendes Wasser an den Rändern
      if (splashes.length || drips.length) {
        pctx.strokeStyle = 'rgba(200,222,245,0.8)';
        pctx.lineWidth = 1.4;
        pctx.beginPath();
        splashes.forEach(function (s) {
          var k = s.t / 0.22, r = 3 + 7 * k;
          pctx.moveTo(s.x - r, s.y - 1 - 4 * k);
          pctx.lineTo(s.x - r * 0.4, s.y);
          pctx.moveTo(s.x + r, s.y - 1 - 4 * k);
          pctx.lineTo(s.x + r * 0.4, s.y);
        });
        drips.forEach(function (d) {
          pctx.moveTo(d.x, d.y);
          pctx.lineTo(d.x, d.y - (d.wait > 0 ? 3 : 10));
        });
        pctx.stroke();
      }
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
      // Schnee: Flocken glitzern, wenn die Sonne durchkommt. Bei Schneeregen
      // (wetS) sind sie nass: größer, matt grau-weiß, in Fallrichtung
      // gestreckt und tauen nach unten hin zu Tropfen weg
      var sparkle = cur.sun > 0.25 && wetS < 0.3;
      SNOW_LAYERS.forEach(function (sl, li) {
        if (wetS > 0.05) {
          var tilt = Math.atan2(wind * 0.6, 1);
          pctx.fillStyle = 'rgba(' + Math.round(248 - 30 * wetS) + ',' + Math.round(251 - 24 * wetS) + ',' + Math.round(255 - 18 * wetS) + ',1)';
          for (var j = 0; j < parts.length; j++) {
            var w = parts[j];
            if (w.type !== 'snow' || w.layer !== li) continue;
            var melt = 1 - 0.65 * wetS * clamp(w.y / H, 0, 1);
            var rr = w.r * (1 + 0.5 * wetS) * (0.6 + 0.4 * melt);
            pctx.globalAlpha = sl.alpha * (1 - 0.2 * wetS) * melt;
            pctx.beginPath();
            pctx.ellipse(w.x, w.y, rr, rr * (1 + 0.9 * wetS), -tilt, 0, Math.PI * 2);
            pctx.fill();
          }
          pctx.globalAlpha = 1;
          return;
        }
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

    // Tagesfarbe → Nachtfarbe (mondbeschienen), nach aktueller Nacht
    function nightRgb(day, nite) { return mixRgb(day, nite, 0.8 * clamp(cur.night || 0, 0, 1)); }

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
      // gute K/D: klarer, hellere Sterne, mehr Sternschnuppen
      var boost = Math.max(0, cur.mood || 0);
      var vis = n * (1 - 0.9 * c) * (1 - wet) * (0.7 + 0.3 * boost);
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
        nextMeteor = time + rand(20, 50) / (1 + 2 * boost);
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

    // ── Mond: wandert wie die Sonne, mit Phase; Wolken verdecken ihn ──
    var moonCanvas = document.createElement('canvas');
    var MOON_R = 30;
    moonCanvas.width = moonCanvas.height = MOON_R * 2 + 4;
    var mctx = moonCanvas.getContext('2d');
    var moonDrawn = null;

    function drawMoon(n, c) {
      var hasSky = typeof cur.moonX === 'number';
      var up = hasSky ? cur.moonUp : (n > 0.3 ? 1 : 0);
      if (!up) return;
      var wet = clamp((cur.rain || 0) + (cur.drizzle || 0) + (cur.snow || 0), 0, 1);
      var boost = Math.max(0, cur.mood || 0);
      // tagsüber nur blass, nachts voll; gute K/D macht ihn heller
      var mv = (0.22 + 0.78 * n) * (1 - 0.85 * c) * (1 - wet) * (0.75 + 0.25 * boost);
      if (mv < 0.02) return;
      var mx = (hasSky ? cur.moonX : 0.85) * W;
      var my = lerp(10, 300, hasSky ? cur.moonY : 0.15);
      var lit = hasSky ? cur.moonLit : 1, wax = hasSky ? cur.moonWax : 1;
      var glow = sctx.createRadialGradient(mx, my, 0, mx, my, 280);
      // Neumond: kein Schein ohne sichtbare Scheibe
      glow.addColorStop(0, 'rgba(210,222,255,' + (0.28 * mv * Math.pow(lit, 0.7)) + ')');
      glow.addColorStop(1, 'rgba(210,222,255,0)');
      sctx.fillStyle = glow;
      sctx.fillRect(mx - 280, my - 280, 560, 560);
      // Phase: helle Scheibe, die Nachtseite wird mit versetztem Kreis
      // ausgestanzt (zunehmend = rechts hell)
      var key = lit.toFixed(2) + wax;
      if (moonDrawn !== key) {
        moonDrawn = key;
        var cx = MOON_R + 2;
        mctx.clearRect(0, 0, moonCanvas.width, moonCanvas.height);
        mctx.globalCompositeOperation = 'source-over';
        mctx.fillStyle = 'rgb(236,240,248)';
        mctx.beginPath();
        mctx.arc(cx, cx, MOON_R, 0, Math.PI * 2);
        mctx.fill();
        mctx.fillStyle = 'rgba(190,198,215,0.55)';
        [[-8, -6, 7], [9, 4, 5], [-2, 11, 4], [6, -12, 3]].forEach(function (cr) {
          mctx.beginPath();
          mctx.arc(cx + cr[0], cx + cr[1], cr[2], 0, Math.PI * 2);
          mctx.fill();
        });
        mctx.globalCompositeOperation = 'destination-out';
        mctx.beginPath();
        mctx.arc(cx + (wax ? -1 : 1) * 2 * MOON_R * lit, cx, MOON_R + 1, 0, Math.PI * 2);
        mctx.fill();
        mctx.globalCompositeOperation = 'source-over';
      }
      sctx.globalAlpha = Math.min(1, mv * 1.1);
      sctx.drawImage(moonCanvas, mx - MOON_R - 2, my - MOON_R - 2);
      sctx.globalAlpha = 1;
    }

    // Polarlicht-Feld: Vorhänge in 1/8 Auflösung, weich hochskaliert (keine
    // Säulen-Streifen); für das Spektakel und als ruhige Belohnung bei Nacht
    function auroraField() {
      var curtains = [];
      for (var i = 0; i < 3; i++) curtains.push({ ph: rand(0, 6.3), sp: rand(0.25, 0.5), y: rand(70, 150), h: rand(150, 260) });
      var off = document.createElement('canvas');
      off.width = W / 8;
      off.height = Math.round(H * 0.5 / 8);
      var o = off.getContext('2d');
      return function (alpha, t) {
        var S = 8, ow = off.width;
        o.clearRect(0, 0, ow, off.height);
        curtains.forEach(function (c, ci) {
          for (var px = 0; px < ow; px++) {
            var x = px * S;
            var base = c.y + 45 * Math.sin(x * 0.0035 + t * c.sp + c.ph) + 18 * Math.sin(x * 0.011 - t * 0.9 + ci);
            var hgt = c.h * (0.6 + 0.4 * Math.sin(x * 0.007 + t * 0.7 + c.ph));
            var a = alpha * (0.34 + 0.16 * Math.sin(x * 0.006 + t * 1.3 + ci * 2) + 0.06 * Math.sin(x * 0.05 + t * 3));
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
        sctx.drawImage(off, 0, 0, W, off.height * S);
        sctx.restore();
      };
    }
    var ambientAurora = auroraField();

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

      // Sonne wandert oben über den Himmel (Stand vom Server, ohne Ort:
      // oben links), Strahlen fächern zur Bildmitte hin auf und verlaufen
      // vorher; in der Dämmerung orange-rosa
      var sunCore = mixRgb([255, 226, 160], [255, 150, 95], d);
      var sunMid = mixRgb([255, 214, 140], [255, 128, 110], d);
      var rayRgb = mixRgb([255, 236, 190], [255, 175, 125], d);
      var hasSky = typeof cur.sunX === 'number';
      if (hasSky && !cur.sunUp) s = 0;
      if (s > 0.01) {
        var sx = (hasSky ? cur.sunX : 0.03) * W;
        var sy = lerp(-10, 300, hasSky ? cur.sunY : 0);
        var glow = sctx.createRadialGradient(sx, sy, 0, sx, sy, 760);
        glow.addColorStop(0, 'rgba(' + sunCore + ',' + (0.5 * s) + ')');
        glow.addColorStop(0.45, 'rgba(' + sunMid + ',' + (0.16 * s) + ')');
        glow.addColorStop(1, 'rgba(' + sunMid + ',0)');
        sctx.fillStyle = glow;
        sctx.fillRect(sx - 760, sy - 760, 1520, 1520);
        var disc = sctx.createRadialGradient(sx, sy, 0, sx, sy, 75);
        disc.addColorStop(0, 'rgba(255,252,236,' + (0.95 * s) + ')');
        disc.addColorStop(0.45, 'rgba(' + sunCore + ',' + (0.75 * s) + ')');
        disc.addColorStop(1, 'rgba(' + sunCore + ',0)');
        sctx.fillStyle = disc;
        sctx.fillRect(sx - 75, sy - 75, 150, 150);
        var toward = Math.atan2(H * 0.55 - sy, W / 2 - sx);
        for (var r = 0; r < 7; r++) {
          var a0 = toward + (r - 3) * 0.24 + 0.03 * Math.sin(time * 0.21 + r * 1.7);
          var width = 0.045 + 0.02 * Math.sin(time * 0.33 + r);
          var len = 1000;
          var ray = sctx.createLinearGradient(sx, sy, sx + Math.cos(a0) * len, sy + Math.sin(a0) * len);
          var ra = (0.13 + 0.06 * Math.sin(time * 0.5 + r * 2.1)) * s;
          ray.addColorStop(0, 'rgba(' + rayRgb + ',' + ra + ')');
          ray.addColorStop(0.45, 'rgba(' + rayRgb + ',' + (ra * 0.25) + ')');
          ray.addColorStop(0.7, 'rgba(' + rayRgb + ',0)');
          sctx.fillStyle = ray;
          sctx.beginPath();
          sctx.moveTo(sx, sy);
          sctx.lineTo(sx + Math.cos(a0 - width) * len, sy + Math.sin(a0 - width) * len);
          sctx.lineTo(sx + Math.cos(a0 + width) * len, sy + Math.sin(a0 + width) * len);
          sctx.closePath();
          sctx.fill();
        }
      }
      drawMoon(n, c);
      if ((cur.aurora || 0) > 0.02) ambientAurora(cur.aurora * 0.6, time);

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

      // Mega-Blitz: Gewitter-Trübung kräftig, dazu ein Hauch über der Mitte
      if (darkNow > 0.01) {
        g = Math.max(g, darkNow);
        sctx.fillStyle = 'rgba(14,16,26,' + (0.12 * darkNow) + ')';
        sctx.fillRect(0, 0, W, H);
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

    // ── Schneesturm: Whiteout (Ränder kräftig, Mitte leicht) und Ground
    //    Blizzard (aufgewirbelter Schnee fegt über den unteren Rand) ──
    var drifts = [];
    function drawBlizzard(wind, dt) {
      if (bz < 0.02 && !drifts.length) return;
      var cold = nightRgb([228, 238, 252], [120, 134, 162]);
      var gustPulse = 0.85 + 0.15 * Math.sin(time * 1.7) + 0.2 * Math.max(0, Math.abs(wind) - Math.abs(cur.wind || 0));
      sctx.save();
      sctx.translate(W / 2, H / 2);
      sctx.scale(1, H / W);
      var wo = sctx.createRadialGradient(0, 0, W * 0.12, 0, 0, W * 0.7);
      wo.addColorStop(0, 'rgba(' + cold + ',' + (0.14 * bz * gustPulse) + ')');
      wo.addColorStop(1, 'rgba(' + cold + ',' + (0.62 * bz * gustPulse) + ')');
      sctx.fillStyle = wo;
      sctx.fillRect(-W, -W, W * 2, W * 2);
      sctx.restore();
      // Bodenschleier
      var gb = sctx.createLinearGradient(0, H, 0, H * 0.68);
      gb.addColorStop(0, 'rgba(' + cold + ',' + (0.55 * bz) + ')');
      gb.addColorStop(1, 'rgba(' + cold + ',0)');
      sctx.fillStyle = gb;
      sctx.fillRect(0, H * 0.68, W, H * 0.32);
      // Treibschnee-Schlieren am Boden (Partikel-Ebene, weicher Rand)
      var dirW = wind >= 0 ? 1 : -1;
      var want = 90 * bz;
      if (drifts.length < want && Math.random() < 0.9) {
        drifts.push({ x: dirW > 0 ? rand(-300, W * 0.6) : rand(W * 0.4, W + 300), y: H - rand(0, H * 0.28),
                      len: rand(80, 260), v: rand(700, 1300), ph: rand(0, 6.3), age: 0, life: rand(0.8, 1.8) });
      }
      pctx.lineCap = 'round';
      drifts = drifts.filter(function (d) {
        d.age += dt;
        if (d.age >= d.life) return false;
        d.x += dirW * d.v * dt;
        var a = 0.6 * smooth(d.age / 0.25) * (1 - smooth((d.age - d.life * 0.6) / (d.life * 0.4)));
        pctx.strokeStyle = 'rgba(' + cold + ',' + a + ')';
        pctx.lineWidth = 3 + 2 * Math.sin(d.ph);
        pctx.beginPath();
        pctx.moveTo(d.x, d.y);
        pctx.quadraticCurveTo(d.x - dirW * d.len * 0.5, d.y - 6 * Math.sin(time * 3 + d.ph), d.x - dirW * d.len, d.y + 3);
        pctx.stroke();
        return true;
      });
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

    // Zweites Argument an die Zuhörer: Ende des Hauptstrangs (x/y) und
    // ground(x, y), das den Blitz bis zu einem Einschlagpunkt verlängert
    // (Deko-Themen: Blitz trifft Laubhaufen oder Schirm); dist bleibt erstes Argument
    function strike(which) {
      var dist = which === 'near' ? rand(0, 0.3) : which === 'far' ? rand(0.6, 1) : Math.random();
      var b = makeBolt(dist);
      bolts.push(b);
      flash(b.side);
      var trunk = b.paths[0].pts, end = trunk[trunk.length - 1];
      emit('strike', dist, {
        x: end[0], y: end[1], near: dist <= 0.3,
        ground: function (gx, gy) {
          var e = trunk[trunk.length - 1];
          if (gy <= e[1]) return;
          zigzag(e[0], e[1], gx, gy, 60, 4, trunk);
        }
      });
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

    // ── Spektakel: bis zu SHOW_MAX laufen gleichzeitig (auch zweimal dasselbe),
    //    weitere warten (höchstens SHOW_MAX) und starten, sobald Platz ist ──
    var SHOW_MAX = 3;
    var shows = [], queued = [];

    function spectacle(type) {
      if (SPECTACLES.indexOf(type) < 0) return false;
      if (shows.length >= SHOW_MAX) {
        if (queued.length < SHOW_MAX) queued.push(type);
        return true;
      }
      startShow(type);
      return true;
    }

    function startShow(type) {
      var s;
      if (reduceMotion) {
        s = { type: 'tint', t: 0, dur: 1.2, color: TINT[type] };
        shows.push(s);
        emit('spectacle', showInfo(s, type, true));
        return;
      }
      s = SHOWS[type].init();
      s.type = type;
      s.t = 0;
      shows.push(s);
      emit('spectacle', showInfo(s, type, false));
    }

    // Auskunft an die Deko-Themen: Art, Dauer, Richtung (1 = von links),
    // live abfragbar solange das Spektakel läuft: Wasserstand über dem
    // unteren Rand an Stelle x (Tsunami), x der Windhose, Aufprall der Lawine
    function showInfo(s, type, reduced) {
      function on() { return shows.indexOf(s) >= 0; }
      return {
        type: type, dur: s.dur, dir: s.dir || 0, reduced: reduced, land: s.land || null, snow: !!s.snow,
        active: on,
        elapsed: function () { return on() ? s.t : s.dur; },
        level: function (x) { return on() && s.level ? Math.max(0, s.level(x)) : 0; },
        x: function () { return on() && typeof s.x === 'number' ? s.x : null; }
      };
    }

    var TINT = { tsunami: '40,120,190', megabolt: '200,215,255', ballbolt: '255,170,80', avalanche: '235,242,250',
                 aurora: '90,230,160', rainbow: '255,210,140', hail: '220,228,240', meteors: '200,215,255',
                 tornado: '150,140,120', fogwall: '225,230,235' };

    var AV_ARRIVE = 1.4, AV_PASS = 7.2;   // Lawine: Kopf erscheint / ist durch
    var SHOWS = {
      tsunami: {
        // Tsunami wie in echt: erst zieht sich das Wasser am unteren Rand
        // zurück, dann rollt eine steile, schäumende Flutwand von der Seite
        // heran und türmt sich auf, das Land steht unter Wasser, danach läuft
        // es wieder ab. Trübes Wasser mit Treibgut, keine Surferwelle.
        init: function () {
          var debris = [];
          for (var i = 0; i < 40; i++) debris.push({ off: rand(0, W * 1.2), dy: rand(0.1, 0.9), r: rand(3, 9), ph: rand(0, 6.3) });
          return { dur: 10, dir: Math.random() < 0.5 ? 1 : -1, spray: [], debris: debris };
        },
        draw: function (s, dt) {
          var t = s.t, dir = s.dir;
          var RETREAT = 1.8, SURGE = 4.6, DRAIN_AT = RETREAT + SURGE;
          var murkTop = nightRgb([96, 150, 150], [40, 70, 82]);
          var murkMid = nightRgb([52, 98, 104], [22, 44, 56]);
          var murkLow = nightRgb([30, 58, 62], [10, 22, 30]);
          var foamRgb = nightRgb([240, 246, 242], [170, 188, 196]);
          var fade = 1 - smooth((t - (s.dur - 0.8)) / 0.8);
          var waterPath = function (levelAt, x0, x1) {
            var grad = fctx.createLinearGradient(0, H * 0.3, 0, H);
            grad.addColorStop(0, 'rgba(' + murkTop + ',' + (0.9 * fade) + ')');
            grad.addColorStop(0.45, 'rgba(' + murkMid + ',' + (0.92 * fade) + ')');
            grad.addColorStop(1, 'rgba(' + murkLow + ',' + (0.95 * fade) + ')');
            fctx.fillStyle = grad;
            fctx.beginPath();
            fctx.moveTo(x0, H + 10);
            var step = (x1 > x0 ? 16 : -16), x;
            for (x = x0; (x1 - x) * Math.sign(step) >= 0; x += step) fctx.lineTo(x, H - levelAt(x));
            fctx.lineTo(x1, H + 10);
            fctx.closePath();
            fctx.fill();
          };
          var chop = function (x) {
            return Math.sin(x * 0.013 + t * 3.1) * 9 + Math.sin(x * 0.031 - t * 4.7) * 5 + Math.sin(x * 0.0047 + t * 1.3) * 12;
          };

          // 1) Rückzug: ein Wasserstreifen am unteren Rand sinkt weg
          if (t < RETREAT + 0.4) {
            var k = smooth(t / RETREAT);
            var lvl = (1 - k) * 70 * smooth(t / 0.3);
            if (lvl > 1) waterPath(function (x) { return lvl + Math.sin(x * 0.02 + t * 2) * 3; }, -20, W + 20);
          }

          // 2) Flutwand rollt heran und türmt sich auf; dahinter steht das Land unter Wasser
          var flood = 0;
          if (t >= RETREAT) {
            var p = Math.min(1, (t - RETREAT) / SURGE);
            var run = Math.pow(p, 0.85);
            var front = dir > 0 ? lerp(-80, W + 260, run) : lerp(W + 80, -260, run);
            var wall = H * lerp(0.18, 0.66, Math.pow(p, 0.7));   // Auflaufen: die Wand wächst
            flood = H * lerp(0.08, 0.34, p);                      // Flutstand hinter der Wand
            var drain = smooth((t - DRAIN_AT) / (s.dur - DRAIN_AT - 0.6));
            wall *= 1 - drain; flood *= 1 - drain;
            var levelAt = function (x) {
              var d = (front - x) * dir;                          // > 0: hinter der Front
              if (d < 0) return 0;
              var face = 1 - smooth(d / 520);                     // Wand fällt nach hinten zum Flutstand ab
              return flood + (wall - flood) * face + chop(x) * (0.6 + 0.4 * face);
            };
            s.level = levelAt;
            var back = dir > 0 ? -40 : W + 40;
            waterPath(levelAt, back, front + dir * 2);

            // steile Front: schäumende, brodelnde Kante
            if (wall > 20 && drain < 0.9) {
              fctx.fillStyle = 'rgba(' + foamRgb + ',' + (0.85 * fade * (1 - drain)) + ')';
              for (var i = 0; i < 70; i++) {
                var fy = H - rand(0, wall * 1.05);
                var fx2 = front - dir * rand(0, 60) + Math.sin(fy * 0.05 + t * 9) * 10;
                fctx.beginPath();
                fctx.arc(fx2, fy, rand(3, 10), 0, Math.PI * 2);
                fctx.fill();
              }
              // Schaumkrone oben auf der Wand
              for (var j = 0; j < 60; j++) {
                var cx = front - dir * rand(0, 480);
                fctx.beginPath();
                fctx.arc(cx, H - levelAt(cx) + rand(-6, 8), rand(2, 7), 0, Math.PI * 2);
                fctx.fill();
              }
              for (var n = 0; n < 10; n++) {
                s.spray.push({ x: front + dir * rand(-20, 40), y: H - wall * rand(0.7, 1.05),
                               vx: dir * rand(150, 520), vy: rand(-560, -180), life: rand(0.5, 1.1), r: rand(2, 4.5) });
              }
            }

            // Treibgut im Flutwasser
            fctx.fillStyle = 'rgba(' + nightRgb([62, 48, 34], [30, 26, 22]) + ',' + (0.85 * fade) + ')';
            s.debris.forEach(function (d) {
              var x = front - dir * d.off;
              if ((front - x) * dir < 40 || x < -20 || x > W + 20) return;
              var lv = levelAt(x);
              if (lv < 12) return;
              var y = H - lv * d.dy + Math.sin(t * 2 + d.ph) * 4;
              fctx.save();
              fctx.translate(x, y);
              fctx.rotate(Math.sin(t * 1.5 + d.ph) * 0.6);
              fctx.fillRect(-d.r * 1.6, -d.r * 0.4, d.r * 3.2, d.r * 0.8);
              fctx.restore();
            });
          }

          s.spray = s.spray.filter(function (d) { return (d.life -= dt) > 0; });
          fctx.fillStyle = 'rgba(' + foamRgb + ',1)';
          s.spray.forEach(function (d) {
            d.vy += 1000 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
            fctx.globalAlpha = Math.min(1, d.life) * 0.9 * fade;
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
          // Bild abdunkeln wie bei schwerem Gewitter, jeder Einschlag hellt kurz auf
          s.dark = env * (1 - 0.7 * s.glow);
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
                // nachts leuchten die Wolken beim Einschlag stärker auf
                var la = 0.55 * s.glow * near * env * (1 + 0.6 * clamp(cur.night || 0, 0, 1));
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
        // Polarlicht-Spektakel: Himmel dunkelt ab, kräftige Vorhänge
        init: function () { return { dur: 12, field: auroraField() }; },
        draw: function (s) {
          var env = smooth(s.t / 2.5) * (1 - smooth((s.t - (s.dur - 2.5)) / 2.5));
          var sky = sctx.createLinearGradient(0, 0, 0, H * 0.45);
          var dim = env * (1 - 0.9 * clamp(cur.night || 0, 0, 1));
          sky.addColorStop(0, 'rgba(6,10,28,' + (0.82 * dim) + ')');
          sky.addColorStop(0.6, 'rgba(6,10,28,' + (0.45 * dim) + ')');
          sky.addColorStop(1, 'rgba(6,10,28,0)');
          sctx.fillStyle = sky;
          sctx.fillRect(0, 0, W, H * 0.45);
          s.field(env, s.t);
        }
      },
      rainbow: {
        // Regenbogen über dem oberen Rand, blendet wie in echt langsam ein,
        // sobald die Sonne durchkommt. Unscharf: die Sonnenscheibe (~0,5°)
        // verschmiert die Farben ineinander, innen ist der Himmel heller,
        // außen liegt das dunklere Alexander-Band; die Helligkeit schwankt
        // entlang des Bogens
        init: function () {
          var cx = W / 2, cy = H * 1.3, R = H * 1.18;
          var nt = clamp(cur.night || 0, 0, 1);
          var off = document.createElement('canvas');
          off.width = W;
          off.height = H;
          var o = off.getContext('2d');
          // nachts ein Mondregenbogen: blass, fast farblos, schwächer
          function c(rgb, a) { return 'rgba(' + mixRgb(rgb, [222, 228, 238], 0.8 * nt) + ',' + (a * (1 - 0.45 * nt)) + ')'; }
          function ring(r0, r1, stops) {
            var g = o.createRadialGradient(cx, cy, r0, cx, cy, r1);
            stops.forEach(function (st) { g.addColorStop(st[0], c(st[1], st[2])); });
            o.fillStyle = g;
            o.beginPath();
            o.arc(cx, cy, r1, Math.PI, Math.PI * 2);
            o.arc(cx, cy, r0, Math.PI * 2, Math.PI, true);
            o.fill();
          }
          var WH = [255, 255, 255], DK = [10, 14, 30];
          var VI = [150, 110, 230], BL = [90, 150, 255], GR = [110, 210, 120],
              YE = [255, 228, 100], OR = [255, 150, 60], RD = [240, 70, 60];
          o.filter = 'blur(5px)';
          // Bogen samt aufgehelltem Innenraum
          ring(R - 420, R + 30, [
            [0, WH, 0], [0.55, WH, 0.07], [0.74, VI, 0.1],
            [0.78, VI, 0.22], [0.81, BL, 0.34], [0.86, GR, 0.4], [0.9, YE, 0.46],
            [0.94, OR, 0.42], [0.97, RD, 0.3], [1, RD, 0]
          ]);
          // außen das dunklere Alexander-Band
          ring(R + 30, R + 230, [[0, DK, 0], [0.3, DK, 0.07], [1, DK, 0]]);
          o.filter = 'none';
          // Regen ist nie gleichmäßig verteilt: Helligkeit wandert entlang des Bogens
          if (o.createConicGradient) {
            var m = o.createConicGradient(0, cx, cy);
            m.addColorStop(0, 'rgba(0,0,0,1)');
            for (var k = 0; k <= 8; k++) m.addColorStop(0.5 + k / 16, 'rgba(0,0,0,' + rand(0.45, 1) + ')');
            o.globalCompositeOperation = 'destination-in';
            o.fillStyle = m;
            o.fillRect(0, 0, off.width, off.height);
            o.globalCompositeOperation = 'source-over';
          }
          return { dur: 25, off: off };
        },
        draw: function (s) {
          var env = 1 - smooth((s.t - (s.dur - 5)) / 5);
          sctx.save();
          sctx.globalAlpha = env * smooth(s.t / 3.5);
          sctx.drawImage(s.off, 0, 0);
          sctx.restore();
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
          // nachts ist der Himmel schon dunkel: nicht über Mond und Sterne legen
          var dim = env * (1 - 0.9 * clamp(cur.night || 0, 0, 1));
          sky.addColorStop(0, 'rgba(8,12,34,' + (0.82 * dim) + ')');
          sky.addColorStop(0.6, 'rgba(8,12,34,' + (0.45 * dim) + ')');
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
        // oben breit, dreht sich (Wirbelstreifen), Staub und Trümmer am Fuß.
        // Im Winter, bei liegendem Schnee oder kräftigem Schneefall eine
        // Schneehose: hell, halb durchsichtig, wirbelt Schnee statt Staub
        init: function () {
          var dir = Math.random() < 0.5 ? 1 : -1;
          var debris = [];
          for (var i = 0; i < 120; i++) debris.push({ h: Math.pow(Math.random(), 1.8), a: rand(0, 6.3), sp: rand(3, 7), r: rand(2, 5) });
          var snow = cur.theme === 'winter' || (cur.snowCover || 0) > 15 || (cur.snow || 0) > 0.4;
          return { dur: 9, dir: dir, debris: debris, snow: snow };
        },
        draw: function (s) {
          var p = s.t / s.dur;
          var env = smooth(p / 0.12) * (1 - smooth((p - 0.85) / 0.15));
          var x = s.dir > 0 ? lerp(-200, W + 200, p) : lerp(W + 200, -200, p);
          s.x = x;
          var topY = H * 0.2;
          var swayAt = function (k) { return Math.sin(s.t * 1.8 + k * 2.6) * 55 * k + Math.sin(s.t * 4.5 + k * 8) * 7; };
          var widthAt = function (k) { return lerp(16, 250, Math.pow(k, 1.9)); };

          // Wolkenbasis oben (Himmels-Ebene)
          var cb = sctx.createRadialGradient(x, topY - 40, 0, x, topY - 40, 620);
          var baseRgb = s.snow ? nightRgb([120, 128, 142], [70, 78, 98]) : '40,40,46';
          cb.addColorStop(0, 'rgba(' + baseRgb + ',' + ((s.snow ? 0.6 : 0.75) * env) + ')');
          cb.addColorStop(1, 'rgba(' + baseRgb + ',0)');
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
            var a = env * (0.92 - 0.2 * k) * smooth(i / 8) * (s.snow ? 0.7 : 1);
            var g = fctx.createLinearGradient(cx - w, 0, cx + w, 0);
            var edgeRgb = s.snow ? nightRgb([226, 232, 240], [150, 160, 182]) : nightRgb([60, 57, 54], [62, 66, 82]);
            var coreRgb = s.snow ? nightRgb([190, 200, 214], [118, 128, 152]) : nightRgb([46, 44, 42], [44, 47, 60]);
            g.addColorStop(0, 'rgba(' + edgeRgb + ',0)');
            g.addColorStop(0.22, 'rgba(' + edgeRgb + ',' + (a * 0.85) + ')');
            g.addColorStop(0.5, 'rgba(' + coreRgb + ',' + a + ')');
            g.addColorStop(0.78, 'rgba(' + edgeRgb + ',' + (a * 0.85) + ')');
            g.addColorStop(1, 'rgba(' + edgeRgb + ',0)');
            fctx.fillStyle = g;
            fctx.fillRect(cx - w, y, w * 2, y2 - y);
          }
          // Wirbelstreifen wandern nach oben und zeigen die Drehung
          fctx.lineWidth = 2;
          for (var j = 0; j < 9; j++) {
            var kk = ((s.t * 0.22 + j / 9) % 1);
            var yy = lerp(H, topY, kk), cx2 = x + swayAt(kk), w2 = widthAt(kk) * 0.75;
            var off = Math.sin(s.t * 6 + j) * w2 * 0.5;
            fctx.strokeStyle = 'rgba(' + (s.snow ? nightRgb([255, 255, 255], [200, 210, 230]) : nightRgb([150, 145, 138], [95, 102, 122])) +
                               ',' + ((s.snow ? 0.7 : 0.5) * env * Math.sin(Math.PI * kk)) + ')';
            fctx.beginPath();
            fctx.moveTo(cx2 - w2, yy + 6);
            fctx.quadraticCurveTo(cx2 + off, yy - 10, cx2 + w2, yy + 4);
            fctx.stroke();
          }
          // nachts zucken Blitze in der Wolkenbasis und zeigen den Trichter
          if ((cur.night || 0) > 0.3 && env > 0.5 && Math.random() < 0.012) {
            s.flashT = 0.25;
            flash(x < W * 0.38 ? 'left' : (x > W * 0.62 ? 'right' : 'center'));
          }
          if (s.flashT > 0) {
            s.flashT -= 0.016;
            var fl = sctx.createRadialGradient(x, topY - 40, 0, x, topY - 40, 520);
            fl.addColorStop(0, 'rgba(200,210,255,' + (0.5 * s.flashT / 0.25) + ')');
            fl.addColorStop(1, 'rgba(200,210,255,0)');
            sctx.fillStyle = fl;
            sctx.fillRect(x - 520, topY - 560, 1040, 1040);
          }
          // Staub- bzw. Schneewolke am Fuß, darin Trümmer bzw. Flocken
          var dustRgb = s.snow ? nightRgb([240, 244, 250], [170, 180, 200]) : '160,138,108';
          var dust = fctx.createRadialGradient(x, H, 0, x, H, s.snow ? 300 : 240);
          dust.addColorStop(0, 'rgba(' + dustRgb + ',' + ((s.snow ? 0.85 : 0.75) * env) + ')');
          dust.addColorStop(1, 'rgba(' + dustRgb + ',0)');
          fctx.fillStyle = dust;
          fctx.fillRect(x - 300, H - 300, 600, 300);
          fctx.fillStyle = s.snow ? 'rgba(' + nightRgb([252, 253, 255], [205, 214, 232]) + ',1)' : 'rgba(55,48,40,1)';
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
          // Wand 2,5 Bildbreiten tief: zieht eine Weile durchs Bild
          for (var i = 0; i < 150; i++) puffs.push({ off: rand(0, W * 2.5), y: rand(-80, H + 80), r: rand(240, 420), wob: rand(0, 6.3) });
          return { dur: 19, dir: dir, puffs: puffs };
        },
        draw: function (s) {
          var p = s.t / s.dur;
          var env = smooth(p / 0.04) * (1 - smooth((p - 0.94) / 0.06));
          var front = s.dir > 0 ? lerp(-400, W * 3.5 + 400, p) : lerp(W + 400, -W * 2.5 - 400, p);
          s.puffs.forEach(function (f) {
            var x = front - s.dir * f.off + Math.sin(s.t * 0.8 + f.wob) * 30;
            if (x < -f.r - 40 || x > W + f.r + 40) return;
            var y = f.y + Math.sin(s.t * 0.5 + f.wob) * 20;
            var g = fctx.createRadialGradient(x, y, 0, x, y, f.r);
            var fogRgb = nightRgb([228, 232, 238], [95, 105, 128]);
            g.addColorStop(0, 'rgba(' + fogRgb + ',' + (0.34 * env) + ')');
            g.addColorStop(1, 'rgba(' + fogRgb + ',0)');
            fctx.fillStyle = g;
            fctx.fillRect(x - f.r, y - f.r, f.r * 2, f.r * 2);
          });
        }
      },
      avalanche: {
        // Staublawine nach echtem Aufbau: Abriss oben in der Ecke, Druckwelle
        // (Schneestaub fegt schräg, Böe), dann rauscht der Kopf schräg aus der
        // Ecke den Hang hinunter und wächst zu einer brodelnden Wolke (Ballen
        // quellen bergseitig nach, Schattenseite unten), darunter dichter
        // Schnee mit springenden Brocken; Durchzug fast weiß, danach sinkt
        // feiner Schnee aus der übrigen Wolke
        init: function () {
          var dir = Math.random() < 0.5 ? 1 : -1;
          var crack = [];
          for (var i = 0; i <= 12; i++) {
            var k = i / 12;
            crack.push([lerp(40, 560, k) + rand(-12, 12), lerp(300, 30, k) + rand(-12, 12)]);
          }
          // Aufprall: wo und wann die Bahn des Kopfes den unteren Rand kreuzt
          // (gleiche Rechnung wie in draw)
          var lx0 = -160, ly0 = -160, lx1 = W + 420, ly1 = H + 360;
          var dl = Math.hypot(lx1 - lx0, ly1 - ly0), f = (H - ly0) / (ly1 - ly0);
          var run = Math.pow(f * dl / (dl + 700), 1 / 0.8);
          var lx = lx0 + (lx1 - lx0) * f;
          var land = { x: dir > 0 ? lx : W - lx, t: AV_ARRIVE + run * (AV_PASS - AV_ARRIVE) };
          return { dur: 12, dir: dir, crack: crack, billows: [], chunks: [], streaks: [], flakes: [],
                   acc: 0, gusted: false, land: land };
        },
        draw: function (s, dt) {
          var t = s.t, dir = s.dir;
          var xs = function (x) { return dir > 0 ? x : W - x; };       // Herkunftsseite links/rechts
          var snow = nightRgb([248, 250, 255], [170, 182, 206]);
          var shade = nightRgb([168, 182, 208], [88, 100, 130]);
          var fade = 1 - smooth((t - (s.dur - 1.5)) / 1.5);
          var ARRIVE = AV_ARRIVE, PASS = AV_PASS;

          // 1) Abriss: gezackte Bruchkante oben in der Ecke, Staubschleier
          if (t < 1.6) {
            var ca = smooth(t / 0.25) * (1 - smooth((t - 1.1) / 0.5));
            var shown = Math.ceil(smooth(t / 0.5) * s.crack.length);
            fctx.lineWidth = 4;
            fctx.strokeStyle = 'rgba(' + nightRgb([70, 84, 110], [30, 38, 56]) + ',' + (0.9 * ca) + ')';
            fctx.beginPath();
            for (var c = 0; c < shown; c++) {
              var cp = s.crack[c];
              if (c === 0) fctx.moveTo(xs(cp[0]), cp[1]); else fctx.lineTo(xs(cp[0]), cp[1]);
            }
            fctx.stroke();
            if (Math.random() < dt * 25) {
              var src = s.crack[Math.floor(Math.random() * s.crack.length)];
              s.billows.push({ x: xs(src[0]), y: src[1], r: rand(30, 60), vx: dir * rand(40, 120), vy: rand(10, 60),
                               grow: 40, life: rand(1, 1.6), age: 0, a: 0.5 });
            }
          }

          // Kopf läuft schräg aus der oberen Ecke den Hang hinunter (beschleunigend);
          // d = Laufrichtung, nv = senkrecht dazu nach oben (dort quillt die Wolke)
          var run = clamp((t - ARRIVE) / (PASS - ARRIVE), 0, 1);
          var sx0 = xs(-160), sy0 = -160, ex = xs(W + 420), ey = H + 360;
          var dl = Math.hypot(ex - sx0, ey - sy0), dx = (ex - sx0) / dl, dy = (ey - sy0) / dl;
          var nvx = dy, nvy = -dx;
          if (nvy > 0) { nvx = -nvx; nvy = -nvy; }
          var along = (dl + 700) * Math.pow(run, 0.8);
          var fX = sx0 + dx * along, fY = sy0 + dy * along;
          var headH = H * lerp(0.12, 0.42, smooth(run / 0.5));

          // 2) Druckwelle: kurz vor dem Kopf fegt Schneestaub waagerecht durch
          if (t > ARRIVE - 0.5 && t < ARRIVE + 2.2) {
            if (!s.gusted) { s.gusted = true; gust(); }
            for (var n = 0; n < 6; n++) {
              s.streaks.push({ x: rand(-100, W + 100), y: rand(-100, H), len: rand(60, 180),
                               v: rand(1600, 2400), life: rand(0.5, 0.9) });
            }
          }
          fctx.lineCap = 'round';
          s.streaks = s.streaks.filter(function (st) {
            st.life -= dt;
            if (st.life <= 0) return false;
            st.x += dx * st.v * dt; st.y += dy * st.v * dt;
            fctx.strokeStyle = 'rgba(' + snow + ',' + (0.5 * Math.min(1, st.life * 2)) + ')';
            fctx.lineWidth = 1.6;
            fctx.beginPath();
            fctx.moveTo(st.x, st.y);
            fctx.lineTo(st.x - dx * st.len, st.y - dy * st.len);
            fctx.stroke();
            return true;
          });

          // 3) Kopf: neue Ballen quellen an der Front, oben größer und steigend
          if (t >= ARRIVE && t < PASS + 0.4) {
            s.acc += 34 * dt;
            while (s.acc >= 1) {
              s.acc -= 1;
              var hf = Math.pow(Math.random(), 0.8);                   // 0 = Hang, 1 = Kopfspitze
              var back = rand(0, 200), sp = rand(250, 520) * (1 - 0.5 * hf), rise = rand(15, 70) * hf;
              s.billows.push({ x: fX - dx * back + nvx * hf * headH + rand(-20, 20),
                               y: fY - dy * back + nvy * hf * headH + rand(-20, 20),
                               r: lerp(70, 170, hf) * rand(0.8, 1.2), vx: dx * sp + nvx * rise,
                               vy: dy * sp + nvy * rise, grow: rand(40, 80), life: rand(3.4, 5.2), age: 0, a: 1 });
            }
            // springende Brocken am Fuß
            if (Math.random() < dt * 30) {
              var cs = rand(400, 800), cu = rand(150, 380);
              s.chunks.push({ x: fX + rand(-40, 40), y: fY + rand(-40, 40), vx: dx * cs + nvx * cu,
                              vy: dy * cs + nvy * cu, r: rand(3, 9), life: rand(0.8, 1.4) });
            }
          }
          // Ballen: erst Schattenseite (versetzt nach unten), dann helle Seite
          s.billows.forEach(function (b) {
            b.age += dt;
            b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 1 - 0.25 * dt;
            b.r += b.grow * dt;
          });
          s.billows = s.billows.filter(function (b) { return b.age < b.life; });
          // jeder Ballen mit eigener Schattenseite, ältere hinten, neuere vorne:
          // so zeichnen sich die Wülste gegeneinander ab
          s.billows.forEach(function (b) {
            var a = 0.36 * b.a * fade * smooth(b.age / 0.35) * (1 - smooth((b.age - b.life * 0.55) / (b.life * 0.45)));
            if (a < 0.01) return;
            [[shade, b.r * 0.3, 1.0], [snow, 0, 1.0]].forEach(function (pass) {
              var cy = b.y + pass[1];
              var g = fctx.createRadialGradient(b.x - b.r * 0.25, cy - b.r * 0.25, 0, b.x, cy, b.r);
              g.addColorStop(0, 'rgba(' + pass[0] + ',' + Math.min(1, a * 1.6) + ')');
              g.addColorStop(0.72, 'rgba(' + pass[0] + ',' + a + ')');
              g.addColorStop(0.88, 'rgba(' + pass[0] + ',' + (a * 0.55) + ')');
              g.addColorStop(1, 'rgba(' + pass[0] + ',0)');
              fctx.fillStyle = g;
              fctx.fillRect(b.x - b.r, cy - b.r, b.r * 2, b.r * 2);
            });
          });
          // dichte Schneemasse am Hang hinter der Front, nach hinten weich auslaufend
          if (t >= ARRIVE && t < PASS + 2) {
            var baseA = 0.8 * fade * (1 - smooth((t - PASS) / 2));
            for (var bi = 0; bi < 16; bi++) {
              var kb = bi / 15, bk = kb * 1300;
              var bxp = fX - dx * bk, byp = fY - dy * bk, br = lerp(130, 90, kb);
              var ba = baseA * (1 - kb) * smooth(along / 300);
              if (ba < 0.01) continue;
              var bgr = fctx.createRadialGradient(bxp, byp, 0, bxp, byp, br);
              bgr.addColorStop(0, 'rgba(' + snow + ',' + ba + ')');
              bgr.addColorStop(0.6, 'rgba(' + shade + ',' + (ba * 0.7) + ')');
              bgr.addColorStop(1, 'rgba(' + shade + ',0)');
              fctx.fillStyle = bgr;
              fctx.fillRect(bxp - br, byp - br, br * 2, br * 2);
            }
          }
          fctx.fillStyle = 'rgba(' + snow + ',1)';
          s.chunks = s.chunks.filter(function (ch) {
            ch.life -= dt;
            if (ch.life <= 0) return false;
            ch.vy += 1100 * dt; ch.x += ch.vx * dt; ch.y += ch.vy * dt;
            fctx.globalAlpha = Math.min(1, ch.life * 2) * fade;
            fctx.beginPath();
            fctx.arc(ch.x, ch.y, ch.r, 0, Math.PI * 2);
            fctx.fill();
            return true;
          });
          fctx.globalAlpha = 1;

          // 4) Durchzug: kurz fast weiß, die Mitte bleibt durchscheinend
          var white = smooth((t - 4.2) / 1.2) * (1 - smooth((t - 6.6) / 2.2));
          if (white > 0.01) {
            fctx.fillStyle = 'rgba(' + snow + ',' + (0.3 * white * fade) + ')';
            fctx.fillRect(0, 0, W, H);
          }

          // 5) Nachrieseln: der aufgewirbelte Schnee sinkt aus der übrigen Wolke
          // ab (nur dort, wo noch Wolke ist), Flocken blenden weich ein
          if (t > 5.8 && t < s.dur - 1.2 && s.billows.length) {
            for (var f = 0; f < 6; f++) {
              var src = s.billows[Math.floor(Math.random() * s.billows.length)];
              var ang = rand(0, 6.3), rr = Math.sqrt(Math.random()) * src.r * 0.8;
              s.flakes.push({ x: src.x + Math.cos(ang) * rr, y: src.y + Math.sin(ang) * rr, vy: rand(30, 80),
                              sw: rand(0, 6.3), r: rand(1, 2.4), life: rand(3, 5), age: 0 });
            }
          }
          fctx.fillStyle = 'rgba(' + snow + ',1)';
          s.flakes = s.flakes.filter(function (fl) {
            fl.life -= dt;
            fl.age += dt;
            if (fl.life <= 0) return false;
            fl.y += fl.vy * dt;
            fl.x += Math.sin(t * 1.5 + fl.sw) * 12 * dt;
            fctx.globalAlpha = 0.85 * smooth(fl.age / 0.5) * Math.min(1, fl.life) * fade;
            fctx.beginPath();
            fctx.arc(fl.x, fl.y, fl.r, 0, Math.PI * 2);
            fctx.fill();
            return true;
          });
          fctx.globalAlpha = 1;
        }
      }
    };

    // Abdunklung 0..1 (Mega-Blitz) für Himmel und Deko (--wk-dark an der Bühne)
    var darkNow = 0, darkShown = -1;
    function setDark() {
      darkNow = 0;
      shows.forEach(function (s) { if (s.type === 'megabolt') darkNow = Math.max(darkNow, clamp(s.dark || 0, 0, 1)); });
      if (Math.abs(darkNow - darkShown) < 0.01 && !(darkNow === 0 && darkShown > 0)) return;
      darkShown = darkNow;
      stage.style.setProperty('--wk-dark', darkNow.toFixed(3));
      stage.dataset.wkDark = darkNow > 0.005 ? '1' : '0';
    }

    function drawShow(dt) {
      fctx.clearRect(0, 0, W, H);
      setDark();
      if (!shows.length) return;
      shows.slice().forEach(function (s) {
        s.t += dt;
        fctx.save(); sctx.save();
        if (s.type === 'tint') {
          var a = 0.14 * Math.sin(Math.PI * clamp(s.t / s.dur, 0, 1));
          fctx.fillStyle = 'rgba(' + s.color + ',' + a + ')';
          fctx.fillRect(0, 0, W, H);
        } else {
          SHOWS[s.type].draw(s, dt);
        }
        fctx.restore(); sctx.restore();
        if (s.t >= s.dur) {
          shows.splice(shows.indexOf(s), 1);
          if (queued.length) startShow(queued.shift());
        }
      });
    }

    // ── Haupt-Schleife ──
    var dtFrame = 0;
    var bz = 0, wetS = 0;
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
      // Schneesturm-Grad: viel Schnee und starker Wind
      bz = smooth(((cur.snow || 0) - 0.7) / 0.3) * smooth((Math.abs(wind) - 0.45) / 0.4);
      // Schneeregen-Grad: Schnee und Regen gleichzeitig = nasser Schnee
      wetS = (cur.snow || 0) > 0.02 ? smooth(((cur.rain || 0) + (cur.drizzle || 0)) / 0.3) : 0;
      var counts = manageParts(dt, wind);
      stepParts(dt, wind, counts);
      drawSky(wind);
      drawParts(wind);
      drawBlizzard(wind, dt);
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
      busy: function () { return shows.length ? shows[0].type : null; },
      // Schneesturm-Grad 0..1 (viel Schnee und starker Wind), live
      blizzard: function () { return bz; },
      // Dächer setzen, an denen Regen zerplatzt (leer = keine)
      setShelters: function (list) { shelters = list || []; },
      // Abdunklung durch den Mega-Blitz 0..1, live
      dark: function () { return darkNow; },
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
