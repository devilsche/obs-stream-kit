/* Car Race / Car Drive – Motorklänge aus echten Aufnahmen (Freesound, CC0 / CC BY; Liste: assets/sounds/engines/CREDITS.md).
 * Gebaut von scripts/build_engine_sounds.py: je Motorart Schleifen bei mehreren Drehzahlen + Einmal-Klänge (bank.json).
 * Reines Web Audio, keine Bibliothek. Hängt sich an den AudioContext + Master (Kompressor/Begrenzer) von
 * js/car-race-sound.js – Lautstärke, Stumm und das Starten nach der ersten Eingabe kommen von dort.
 *
 *   var E = CarEngineAudio.create(snd[, { base }])   snd = CarRaceSound.create(…) (braucht snd.ctx + snd.master);
 *                                                    null ohne Web Audio. base = URL von assets/sounds/engines/
 *                                                    (Standard: neben dem Skript, …/js/ → …/assets/sounds/engines/)
 *   E.ready                                           Promise: bank.json geladen (false bei Fehler)
 *   var v = E.voice(type, { gain, seed, lite })       Motorstimme; type = Motorart (i4 t4 i6 f6 v8m v8f v10 v12 f1 dsl ev),
 *                                                    seed = Autoschlüssel (welche Aufnahme bevorzugt wird), lite = weniger
 *                                                    Schleifen (Fremdautos)
 *   v.update(dt, { speed, throttle, dist, ref, radial, pan, on })
 *        speed = Anteil an der Höchstgeschwindigkeit (0..1), throttle 0..1, dist/ref = Abstand zum Hörer und
 *        Bezugsabstand (gleiche Einheit; ohne dist = am Hörer), radial = Annäherung in m/s (Doppler, + = kommt näher),
 *        pan −1..1, on = false → leise ausblenden. Drehzahl kommt aus dem Gangmodell (unten).
 *   v.oneShot(kind[, gain])                           start | rev | pass | pop | turbo (zufällige Aufnahme der Art)
 *   v.blip([amount])                                  Gasstoß im Stand (Drehzahl hoch und wieder runter)
 *   v.rpm(), v.gear(), v.stop()
 *   E.oneShot(type, kind, { gain, rate, pan, seed })  Einmal-Klang ohne Stimme (z. B. Vorbeifahrt an der TV-Kamera)
 *   E.preview(type[, seed])                           Hörprobe für den Car editor: Anlassen, zwei Gasstöße, Hochdrehen, Leerlauf
 *   E.stopAll()
 *   CarEngineAudio.TYPES                              Liste [{ id, label }] (für Auswahlfelder)
 *   CarEngineAudio.Model                              reine Rechnung (Node-Test scripts/check_engine_audio.js):
 *        gearStep(spec, st, speed, throttle, dt) → st { rpm, gear, cut, shifted }, ratios(spec), rpmAt(spec, g, speed),
 *        ladder(loops, seed, max), weights(ladder, rpm) → [{ i, g }], rate(rpm, loopRpm)
 */
(function (root) {
  'use strict';
  var TYPES = [
    { id: 'i4', label: 'Inline-4' }, { id: 't4', label: 'Turbo inline-4' }, { id: 'i6', label: 'Inline-6' },
    { id: 'f6', label: 'Flat-6' }, { id: 'v8m', label: 'Muscle V8' }, { id: 'v8f', label: 'Exotic V8' },
    { id: 'v10', label: 'V10' }, { id: 'v12', label: 'V12' }, { id: 'f1', label: 'Formula 1' },
    { id: 'dsl', label: 'Diesel truck / bus' }, { id: 'ev', label: 'Electric' }
  ];
  // Knallen beim Gaswegnehmen (Schubabschaltung/Fehlzündung): Wahrscheinlichkeit je Motorart
  // fehlt einer Motorart eine Einmal-Klang-Art (z. B. keine Vorbeifahrt-Aufnahme), nimmt sie die der Verwandten
  var SHOT_FALLBACK = { i4: ['t4', 'i6'], t4: ['i4', 'i6'], i6: ['f6', 'i4'], f6: ['i6', 'v10'], v8m: ['v8f'], v8f: ['v10', 'v8m'],
    v10: ['v12', 'v8f'], v12: ['v10', 'v8f'], f1: ['v10'], dsl: [], ev: [] };
  // Grundpegel aller Aufnahmen (Schleifen sind auf −20 dBFS RMS normiert): leiser als die Effekte von
  // car-race-sound.js, damit Quietschen/Crash/Ampel hörbar bleiben – der Master-Begrenzer fängt den Rest
  var MIX = 0.35;
  var POPS = { t4: 0.8, i6: 0.35, f6: 0.5, v8m: 0.6, v8f: 0.7, v10: 0.6, v12: 0.45, f1: 0.5 };

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function hash(s) { s = String(s || ''); var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ---------------------------------------------------------------- Rechnung (ohne Web Audio, testbar)
  var Model = {
    // Übersetzungen: oberster Gang 1, erster Gang erreicht den Begrenzer bei g1 · vmax; dazwischen geometrisch
    ratios: function (spec) {
      var n = Math.max(1, spec.gears | 0), q = n > 1 ? Math.pow(1 / spec.g1, 1 / (n - 1)) : 1, r = [];
      for (var g = 1; g <= n; g++) r.push(Math.pow(q, n - g));
      return r;
    },
    rpmAt: function (spec, g, speed) {
      var r = spec._r || (spec._r = Model.ratios(spec));
      return Math.max(0, speed) * r[clamp(g, 1, r.length) - 1] * spec.red * 0.97;
    },
    // ein Schritt Gangmodell: Hochschalten je nach Gas früher/später, Zurückschalten mit Abstand (Hysterese),
    // im Stand bzw. beim Anfahren Kupplung (Drehzahl aus dem Gas), Drehzahl folgt träge, nach dem Hochschalten
    // kurz Gas weg (cut), am Begrenzer stottert sie
    gearStep: function (spec, st, speed, thr, dt) {
      st = st || {};
      if (st.rpm == null || st.gear == null) { st.rpm = st.rpm == null ? spec.idle : st.rpm; st.gear = 1; st.cut = 0; st.lim = 0; }
      st.shifted = 0;
      speed = Math.max(0, speed || 0); thr = clamp(thr || 0, 0, 1);
      if (spec.gears <= 1) {                            // E-Motor: ein Gang, kein Leerlauf
        var te = speed * spec.red;
        st.rpm += (te - st.rpm) * (1 - Math.exp(-dt / 0.08));
        st.gear = 1; return st;
      }
      var n = spec.gears, g = st.gear || 1;
      if (st.cut > 0) st.cut = Math.max(0, st.cut - dt);
      var up = spec.red * (0.6 + 0.33 * thr), down = spec.red * (0.3 + 0.12 * thr);
      if (g < n && Model.rpmAt(spec, g, speed) > up && st.cut <= 0) { g++; st.shifted = 1; st.cut = 0.12 + 0.08 * thr; }
      else if (g > 1 && Model.rpmAt(spec, g, speed) < down && Model.rpmAt(spec, g - 1, speed) < up * 0.9) { g--; st.shifted = -1; }
      st.gear = g;
      var wheel = Model.rpmAt(spec, g, speed), target, stand = speed < 0.01;
      if (stand) target = spec.idle + thr * (0.9 * spec.red - spec.idle);                  // im Stand: Gas = Drehzahl
      else if (g === 1 && wheel < 0.45 * spec.red) target = Math.max(wheel, spec.idle + thr * (0.5 * spec.red - spec.idle));   // Kupplung schleift
      else target = Math.max(wheel, spec.idle);
      // Begrenzer: kurz abfallen lassen
      if (target >= spec.red * 0.985 && thr > 0.5) {
        st.lim = (st.lim || 0) + dt;
        if (st.lim > 0.09) { st.lim = 0; st.rpm = spec.red * 0.93; }
        target = Math.min(target, spec.red);
      }
      var tau = target > st.rpm ? (stand ? 0.09 : 0.14) : (st.shifted > 0 ? 0.035 : 0.12);
      st.rpm += (target - st.rpm) * (1 - Math.exp(-dt / tau));
      return st;
    },
    // Schleifen-Leiter einer Stimme: Schleifen mit ähnlicher Drehzahl (±10 %) bilden eine Stufe; je Stufe die
    // Aufnahme, die zum Auto passt (seed) – bevorzugt immer dieselbe Quelle, damit die Klangfarbe nicht springt
    ladder: function (loops, seed, max) {
      var L = (loops || []).slice().sort(function (a, b) { return a.rpm - b.rpm; });
      if (!L.length) return [];
      var srcs = []; L.forEach(function (l) { if (srcs.indexOf(l.src) < 0) srcs.push(l.src); });
      var pref = srcs[hash(seed) % srcs.length];
      var steps = [], cur = null;
      L.forEach(function (l) {
        if (cur && Math.log(l.rpm / cur[0].rpm) < 0.1) cur.push(l); else { cur = [l]; steps.push(cur); }
      });
      var out = steps.map(function (s) {
        var p = s.filter(function (l) { return l.src === pref; })[0];
        return p || s[hash(seed + ':' + s[0].rpm) % s.length];
      });
      if (max && out.length > max) {                      // gleichmäßig ausdünnen, unterste und oberste bleiben
        var o2 = [];
        for (var i = 0; i < max; i++) o2.push(out[Math.round(i * (out.length - 1) / (max - 1))]);
        out = o2.filter(function (x, k) { return o2.indexOf(x) === k; });
      }
      return out;
    },
    // Überblendung zwischen den zwei nächsten Stufen (log. Drehzahl, gleiche Leistung); außerhalb nur die äußerste
    weights: function (ladder, rpm) {
      var n = ladder.length;
      if (!n) return [];
      if (rpm <= ladder[0].rpm) return [{ i: 0, g: 1 }];
      if (rpm >= ladder[n - 1].rpm) return [{ i: n - 1, g: 1 }];
      for (var i = 0; i < n - 1; i++) {
        var a = ladder[i].rpm, b = ladder[i + 1].rpm;
        if (rpm >= a && rpm <= b) {
          var w = Math.log(rpm / a) / Math.log(b / a);
          return [{ i: i, g: Math.cos(w * Math.PI / 2) }, { i: i + 1, g: Math.sin(w * Math.PI / 2) }];
        }
      }
      return [{ i: n - 1, g: 1 }];
    },
    rate: function (rpm, loopRpm) { return clamp(rpm / Math.max(1, loopRpm), 0.45, 2.4); }
  };

  // ---------------------------------------------------------------- Web Audio
  var BASE = (function () {
    var s = root.document && root.document.currentScript && root.document.currentScript.src || '';
    var m = /^(.*\/)js\/car-engine-audio\.js/.exec(s);
    return (m ? m[1] : '../') + 'assets/sounds/engines/';
  })();

  function create(snd, opts) {
    opts = opts || {};
    if (!snd || !snd.ctx || !snd.master) return null;
    var ctx = snd.ctx, out = snd.master, base = opts.base || BASE;
    var bank = null, bufs = {}, voices = [];
    var ready = (root.fetch ? root.fetch(base + 'bank.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }) : Promise.reject(new Error('no fetch')))
      .then(function (b) { bank = b; return true; })
      .catch(function (e) { if (root.console) console.warn('Engine sounds: bank.json not loaded – ' + e.message); return false; });

    function load(f) {
      if (bufs[f]) return bufs[f];
      bufs[f] = root.fetch(base + f).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then(function (ab) {
          return new Promise(function (ok, bad) { var p = ctx.decodeAudioData(ab, ok, bad); if (p && p.then) p.then(ok, bad); });
        })
        .catch(function (e) { if (root.console) console.warn('Engine sounds: ' + f + ' – ' + (e && e.message)); return null; });
      return bufs[f];
    }
    function spec(type) {
      var t = bank && bank.types && (bank.types[type] || bank.types.i4);
      return t || null;
    }
    function pick(list, seed) { return list && list.length ? list[(seed == null ? Math.floor(Math.random() * 1e9) : hash(seed)) % list.length] : null; }

    function playShot(type, kind, o) {
      o = o || {};
      return ready.then(function () {
        var sp = spec(type), list = sp && sp[kind];
        (SHOT_FALLBACK[type] || []).forEach(function (f) { if (!(list && list.length)) { var s2 = bank.types[f]; list = s2 && s2[kind]; } });
        var item = pick(list, o.seed);
        if (!item) return null;
        return load(item.f).then(function (buf) {
          if (!buf) return null;
          var t = ctx.currentTime, src = ctx.createBufferSource(), g = ctx.createGain(), dst = o.dest || out;
          src.buffer = buf; src.playbackRate.value = clamp(o.rate || 1, 0.5, 2);
          g.gain.value = (o.gain == null ? 0.5 : o.gain) * MIX;
          src.connect(g);
          if (o.pan && ctx.createStereoPanner) { var p = ctx.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); g.connect(p); p.connect(dst); } else g.connect(dst);
          src.start(t);
          src.onended = function () { try { g.disconnect(); } catch (e) { /* schon getrennt */ } };
          return item;
        });
      });
    }

    function voice(type, vo) {
      vo = vo || {};
      var gainK = vo.gain == null ? 1 : vo.gain, seed = vo.seed || type;
      var sp = null, lad = [], srcs = [], gains = [], st = {}, alive = true, started = false;
      var vGain = ctx.createGain(), lp = ctx.createBiquadFilter(), mix = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      vGain.gain.value = 0; lp.type = 'lowpass'; lp.frequency.value = 6000; lp.Q.value = 0.5; mix.gain.value = 1;
      mix.connect(lp); lp.connect(vGain);
      if (pan) { vGain.connect(pan); pan.connect(out); } else vGain.connect(out);
      // Turbo-Pfeifen (t4): leiser Sinus + schmales Rauschband, Tonhöhe/Pegel nach Ladedruck
      var turbo = null, lastAtt = 1, boost = 0, lastThr = 0, offT = 0, popNext = 0, blipT = 0, blipA = 0, level = 0;
      var v = {
        type: type,
        update: function (dt, p) {
          if (!alive) return;
          p = p || {};
          dt = clamp(dt || 0, 0, 0.1);
          if (!sp || !started) return;
          var thr = clamp(p.throttle || 0, 0, 1);
          if (blipT > 0) { blipT = Math.max(0, blipT - dt); thr = Math.max(thr, blipT > 0.25 ? blipA : blipA * blipT / 0.25); }
          Model.gearStep(sp, st, p.speed || 0, thr, dt);
          var t = ctx.currentTime, rpm = st.rpm;
          var dop = p.radial ? clamp(340 / (340 - clamp(p.radial, -120, 120)), 0.75, 1.35) : 1;
          var ws = Model.weights(lad, Math.max(rpm, sp.gears <= 1 ? 1 : 0));
          var w = {};
          ws.forEach(function (x) { w[x.i] = x.g; });
          for (var i = 0; i < lad.length; i++) {
            gains[i].gain.setTargetAtTime(w[i] || 0, t, 0.04);
            if (srcs[i]) srcs[i].playbackRate.setTargetAtTime(Model.rate(sp.gears <= 1 ? Math.max(rpm, lad[0].rpm * 0.5) : rpm, lad[i].rpm) * dop, t, 0.03);
          }
          // Last: Gas offen = voller, heller; Schub = leiser, dumpfer; nach dem Hochschalten kurz weg
          var load = st.cut > 0 ? 0.25 : thr;
          var dist = p.dist == null ? 0 : Math.max(0, p.dist), ref = p.ref || 1;
          var att = dist <= ref ? 1 : ref / dist;
          lastAtt = att;
          var air = clamp(14000 * Math.pow(att, 0.7), 900, 14000);
          var bright = sp.gears <= 1 ? 9000 : 1600 + 7000 * Math.pow(load, 0.8) + 2500 * (rpm / sp.red);
          lp.frequency.setTargetAtTime(Math.min(air, bright), t, 0.05);
          var ev = sp.gears <= 1 ? clamp((p.speed || 0) * 3 + thr * 0.3, 0, 1) : 1;
          level = p.on === false ? 0 : MIX * gainK * att * ev * (0.5 + 0.5 * load) * (0.75 + 0.25 * rpm / sp.red);
          vGain.gain.setTargetAtTime(level, t, p.on === false ? 0.25 : 0.06);
          if (pan) pan.pan.setTargetAtTime(clamp(p.pan || 0, -1, 1), t, 0.05);
          // Turbo
          if (turbo) {
            var want = clamp((rpm / sp.red - 0.3) * 1.6, 0, 1) * thr;
            boost += (want - boost) * (1 - Math.exp(-dt / (want > boost ? 0.6 : 0.15)));
            turbo.g.gain.setTargetAtTime(0.12 * MIX * boost * gainK * att, t, 0.05);
            turbo.o.frequency.setTargetAtTime(1800 + 3600 * boost, t, 0.08);
            if (lastThr > 0.6 && thr < 0.2 && boost > 0.45) v.oneShot('turbo', 0.35 * boost);
          }
          // Knallen beim Gaswegnehmen bei hoher Drehzahl (nur manche Motorarten, nicht jedes Mal)
          if (lastThr > 0.5 && thr < 0.15) offT = 0.9;
          if (offT > 0) {
            offT -= dt;
            var pr = POPS[type] || 0;
            if (pr && rpm > sp.red * 0.45 && t > popNext && Math.random() < dt * 6 * pr) { v.oneShot('pop', 0.28); popNext = t + 0.12 + Math.random() * 0.3; }
          }
          if (st.shifted > 0 && thr > 0.7 && POPS[type] && Math.random() < POPS[type] * 0.5) v.oneShot('pop', 0.22);
          lastThr = thr;
        },
        // Einmal-Klang am Ort der Stimme (Abstand wie beim letzten update, Panorama der Stimme), auch vor dem Laden
        oneShot: function (kind, g) { if (alive) playShot(type, kind, { gain: (g == null ? 0.5 : g) * gainK * lastAtt, dest: pan || out }); },
        blip: function (a) { blipA = clamp(a == null ? 0.8 : a, 0.2, 1); blipT = 0.45; },
        rpm: function () { return st.rpm || 0; },
        gear: function () { return st.gear || 1; },
        level: function () { return level; },
        stop: function () {
          if (!alive) return;
          alive = false;
          var t = ctx.currentTime;
          vGain.gain.setTargetAtTime(0, t, 0.12);
          if (turbo) turbo.g.gain.setTargetAtTime(0, t, 0.1);
          setTimeout(function () {
            srcs.forEach(function (s) { try { s.stop(); } catch (e) { /* nie gestartet */ } });
            if (turbo) { try { turbo.o.stop(); turbo.n.stop(); } catch (e) { /* schon aus */ } }
            try { vGain.disconnect(); if (pan) pan.disconnect(); } catch (e) { /* schon getrennt */ }
          }, 700);
          voices = voices.filter(function (x) { return x !== v; });
        }
      };
      ready.then(function () {
        if (!alive) return;
        sp = spec(type);
        if (!sp) return;
        sp = Object.assign({}, sp);
        st = {};
        lad = Model.ladder(sp.loops, seed, vo.lite ? 4 : 0);
        return Promise.all(lad.map(function (l) { return load(l.f); })).then(function (bs) {
          if (!alive) return;
          var t = ctx.currentTime;
          lad.forEach(function (l, i) {
            var g = ctx.createGain(); g.gain.value = 0; g.connect(mix); gains[i] = g;
            var b = bs[i];
            if (!b) return;
            var s = ctx.createBufferSource();
            s.buffer = b; s.loop = true;
            s.loopStart = l.ls; s.loopEnd = Math.min(l.le, b.duration);
            s.connect(g);
            s.start(t, l.ls + (hash(seed + i) % 1000) / 1000 * (l.le - l.ls));
            srcs[i] = s;
          });
          if (sp.boost) {
            var o = ctx.createOscillator(), n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), tg = ctx.createGain();
            o.type = 'sine'; o.frequency.value = 2000;
            var nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = nb.getChannelData(0);
            for (var k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
            n.buffer = nb; n.loop = true; bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 6;
            var ng = ctx.createGain(); ng.gain.value = 0.25;
            o.connect(tg); n.connect(bp); bp.connect(ng); ng.connect(tg); tg.gain.value = 0;
            if (pan) tg.connect(pan); else tg.connect(out);
            o.start(); n.start();
            turbo = { o: o, n: n, g: tg };
          }
          started = true;
        });
      });
      voices.push(v);
      return v;
    }

    var api = {
      ready: ready,
      voice: voice,
      oneShot: function (type, kind, o) { return playShot(type, kind, o); },
      has: function (type, kind) {
        return [type].concat(SHOT_FALLBACK[type] || []).some(function (t) { var sp = bank && bank.types && bank.types[t]; return !!(sp && sp[kind] && sp[kind].length); });
      },
      bank: function () { return bank; },
      // Car editor: Anlassen → Leerlauf → zwei Gasstöße → einmal hochdrehen (stehend, Gang 1 mit Kupplung) → Leerlauf
      preview: function (type, seed) {
        if (api._pv) { api._pv.stop(); clearInterval(api._pvT); }
        snd.resume && snd.resume();
        var v = voice(type, { gain: 0.9, seed: seed }), t0 = null, shot = false;
        api._pv = v;
        api._pvT = setInterval(function () {
          if (t0 == null) { t0 = ctx.currentTime; }
          var t = ctx.currentTime - t0;
          if (!shot && api.has(type, 'start')) { shot = true; v.oneShot('start', 0.6); }
          var thr = 0, speed = 0;
          if (t > 1.6 && t < 1.95) thr = 0.8;
          else if (t > 2.6 && t < 3.0) thr = 1;
          else if (t > 3.8 && t < 7.5) { thr = 1; speed = Math.min(1, (t - 3.8) / 3.7) * 0.95; }
          else if (t >= 7.5 && t < 9) { thr = 0; speed = Math.max(0, 0.95 - (t - 7.5) * 0.6); }
          v.update(0.05, { speed: speed, throttle: thr, on: t < 10.5 });
          if (t > 11.5) { v.stop(); clearInterval(api._pvT); api._pv = null; }
        }, 50);
        return v;
      },
      stopAll: function () { voices.slice().forEach(function (v) { v.stop(); }); }
    };
    return api;
  }

  var api = { create: create, Model: Model, TYPES: TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CarEngineAudio = api;
})(typeof window !== 'undefined' ? window : this);
