/* Car Race / Car Drive – Motorklänge aus echten Aufnahmen (Freesound, CC0 / CC BY; Liste: assets/sounds/engines/CREDITS.md).
 * Gebaut von scripts/build_engine_sounds.py (Hintergrund: docs/engine-sound-research.md). Reines Web Audio, keine
 * Bibliothek. Hängt sich an den AudioContext + Master (Kompressor/Begrenzer) von js/car-race-sound.js – Lautstärke,
 * Stumm und das Starten nach der ersten Eingabe kommen von dort.
 *
 * Klangaufbau je Stimme (wie bei Renn-Simulationen):
 *   - Gas (on-load): ein echter Hochlauf-Mitschnitt („Sweep“) wird granular abgespielt – kurze Hann-Körner (80 ms,
 *     halb überlappend), deren Leseposition der Drehzahl folgt; die Tonhöhe stammt damit aus der Aufnahme, nur
 *     Restabweichungen werden nachgezogen. Körner liegen auf ganzen Motorzyklen (120 / U/min) zueinander und werden
 *     per Wellenform-Vergleich (WSOLA) fein angesetzt, damit sich überlappende Körner nicht auslöschen.
 *   - Gas weg (off-load): Abfall-Mitschnitt genauso (fehlt er: Hochlauf dumpfer und leiser), dazu Knallen
 *   - Leerlauf: Schleife, unterhalb ~1,5 × Leerlauf eingeblendet
 *   - Turbo-Pfeifen (synthetisch, nach Ladedruck), Abblasen beim Gaswegnehmen
 *   - Begrenzer: unter Last am Begrenzer (Stand/ausgekuppelt, Gang gehalten) Kraftstoff-Schnitte 5–20 / s je Motorart –
 *     Pegel-Einbruch + kurz tiefere Tonhöhe je Schnitt, auf der Audio-Uhr geplant, manche Motorarten knistern dazu
 *   - gleichbleibende Drehzahl (Höchsttempo, Begrenzer): langes Fenster mit zufälligen Sprüngen und unregelmäßigem
 *     Korn-Abstand, leichtes Drehzahl-Wackeln und Ansaug-/Auspuffrauschen – keine hörbare Wiederholung
 *   Ohne Sweep (z. B. Elektro): Drehzahl-Schleifen mit Abspielrate und Überblendung (alter Weg, Rückfall).
 *
 *   var E = CarEngineAudio.create(snd[, { base }])   snd = CarRaceSound.create(…) (braucht snd.ctx + snd.master);
 *                                                    null ohne Web Audio. base = URL von assets/sounds/engines/
 *                                                    (Standard: neben dem Skript, …/js/ → …/assets/sounds/engines/)
 *   E.ready                                           Promise: bank.json geladen (false bei Fehler)
 *   var v = E.voice(type, { gain, seed, lite, src, mode })   Motorstimme; type = Motorart (i4 t4 i6 f6 v6t v8m v8f v8t
 *                                                    v10 v12 f1 dsl ev), seed = Autoschlüssel (welche Aufnahme; bank.cars legt
 *                                                    für einzelne Autos die Aufnahme fest), lite = sparsamer (Fremdautos);
 *                                                    nur Engine sound lab: src = Aufnahme erzwingen (Freesound-ID),
 *                                                    mode 'loops' = alter Weg (nur Drehzahl-Schleifen) zum Vergleich
 *   v.update(dt, { speed, throttle, dist, ref, radial, pan, on, rpm, load })
 *        speed = Anteil an der Höchstgeschwindigkeit (0..1), throttle 0..1, dist/ref = Abstand zum Hörer und
 *        Bezugsabstand (gleiche Einheit; ohne dist = am Hörer), radial = Annäherung in m/s (Doppler, + = kommt näher),
 *        pan −1..1, on = false → leise ausblenden. Drehzahl kommt aus dem Gangmodell (unten).
 *        rpm / load (optional, Engine sound lab): Drehzahl bzw. Last direkt vorgeben statt Gangmodell
 *   v.oneShot(kind[, gain])                           start | rev | pass | pop | turbo (Aufnahme passend zur Stimme)
 *   v.blip([amount])                                  Gasstoß im Stand (Drehzahl hoch und wieder runter)
 *   v.shift()                                         sofort hochschalten (Engine sound lab)
 *   v.rpm(), v.gear(), v.level(), v.info(), v.stop()  info = { rpm, gear, load, mix, on, off, idle, src, limiter, limitHz, steady }
 *                                                    (limiter = true, solange der Begrenzer arbeitet)
 *   E.oneShot(type, kind, { gain, rate, pan, seed })  Einmal-Klang ohne Stimme (z. B. Vorbeifahrt an der TV-Kamera)
 *   E.has(type, kind), E.bank(), E.spec(type)
 *   E.preview(type[, seed])                           Hörprobe für den Car editor: Anlassen, zwei Gasstöße, Hochdrehen, Leerlauf
 *   E.stopAll()
 *   CarEngineAudio.TYPES                              Liste [{ id, label }] (für Auswahlfelder)
 *   CarEngineAudio.Model                              reine Rechnung (Node-Test scripts/check_engine_audio.js):
 *        gearStep(spec, st, speed, throttle, dt) → st { rpm, gear, cut, shifted, limiter }, ratios(spec), rpmAt(spec, g, speed),
 *        tune(spec) (Abstimmung je spec.type), limitStep(spec, st, target, thr, dt), limitWave(tune, phase), limitRpm(spec),
 *        steadyBand(sw, rpm, dur, rateHi), pickHead(state, band, nat, adv, rnd, steady),
 *        ladder(loops, seed, max), weights(ladder, rpm) → [{ i, g }], rate(rpm, loopRpm),
 *        prepSweep(sw), sweepPos(sw, rpm) → { t, r }, sweepRpm(sw, t), period(rpm, cyl), grainHead(head, pos, P, k),
 *        bestMatch(data, sr, nat, cand, len, delta, step, dec) (WSOLA-Feinsuche), band(sw, rpm, minSpan, dur) → { a, b },
 *        layerMix(spec, rpm, load, hasIdle, hasOff) → { idle, on, off }, hann(n)
 */
(function (root) {
  'use strict';
  var TYPES = [
    { id: 'i4', label: 'Inline-4' }, { id: 't4', label: 'Turbo inline-4' }, { id: 'i6', label: 'Inline-6' },
    { id: 'f6', label: 'Flat-6' }, { id: 'v8m', label: 'Muscle V8' }, { id: 'v8f', label: 'Exotic V8 (flat-plane)' },
    { id: 'v6t', label: 'Twin-turbo V6 (GT racer)' }, { id: 'v8t', label: 'Twin-turbo V8' }, { id: 'v10', label: 'V10' }, { id: 'v12', label: 'V12' },
    { id: 'f1', label: 'Formula 1' }, { id: 'dsl', label: 'Diesel truck / bus' }, { id: 'ev', label: 'Electric' }
  ];
  // fehlt einer Motorart eine Einmal-Klang-Art (z. B. keine Vorbeifahrt-Aufnahme), nimmt sie die der Verwandten
  var SHOT_FALLBACK = { i4: ['t4', 'i6'], t4: ['i4', 'i6'], i6: ['f6', 'i4'], f6: ['i6', 'v10'], v8m: ['v8t', 'v8f'], v8f: ['v10', 'v8t'],
    v8t: ['v8m', 'v8f'], v6t: ['t4', 'f6', 'i6'], v10: ['v12', 'v8f'], v12: ['v10', 'v8f'], f1: ['v10'], dsl: [], ev: [] };
  // Grundpegel aller Aufnahmen (Schleifen/Sweeps sind auf −20 dBFS RMS normiert): leiser als die Effekte von
  // car-race-sound.js, damit Quietschen/Crash/Ampel hörbar bleiben – der Master-Begrenzer fängt den Rest
  var MIX = 0.35;
  // Knallen beim Gaswegnehmen (Schubabschaltung/Fehlzündung): Wahrscheinlichkeit je Motorart
  var POPS = { t4: 0.8, i6: 0.35, f6: 0.5, v6t: 0.7, v8m: 0.6, v8f: 0.7, v8t: 0.75, v10: 0.6, v12: 0.45, f1: 0.5 };
  // Körner: Länge und Abstand (s); Vorlauf der Planung (s) – überbrückt auch verspätete Bilder
  var GR = 0.08, HOP = 0.04, GR_LITE = 0.1, HOP_LITE = 0.05, AHEAD = 0.09;
  var RATE_LO = 0.75, RATE_HI = 1.5;                  // Tonhöhen-Nachzug außerhalb des Sweeps
  // Abstimmung je Motorart:
  //   vtop    Drehzahl bei Höchsttempo im obersten Gang (Anteil am Begrenzer) – darunter, damit Vollgas oben nicht im
  //           Begrenzer hängt
  //   shift   Hochschalt-Drehzahl bei Vollgas (Anteil am Begrenzer) – vor dem Begrenzer
  //   hz      Begrenzer: Schnitte je Sekunde (Kraftstoffabschaltung; Renn-Motoren schneller/härter, Diesel weicher Regler)
  //   depth   Drehzahl-Einbruch je Schnitt (Anteil), duty Anteil des Schnitts an der Periode, dip Pegel im Schnitt
  //   crackle Wahrscheinlichkeit für Knistern/Knallen, wenn nach dem Schnitt wieder Kraftstoff kommt
  //   soft    weicher Regler (Diesel): Drehzahl pendelt sinusförmig statt zu stottern
  //   noise   Ansaug-/Auspuffrauschen unter Last (überdeckt die Körnung bei gleichbleibender Drehzahl)
  var TUNE_DEF = { vtop: 0.93, shift: 0.95, hz: 14, depth: 0.05, duty: 0.45, dip: 0.45, crackle: 0, soft: false, noise: 0.06 };
  var TUNE = {
    i4: { vtop: 0.92, shift: 0.94, hz: 12, depth: 0.05, dip: 0.5 },
    t4: { vtop: 0.92, shift: 0.92, hz: 13, depth: 0.06, dip: 0.42, crackle: 0.35 },
    i6: { vtop: 0.93, shift: 0.94, hz: 13, depth: 0.045, dip: 0.48, crackle: 0.2 },
    f6: { vtop: 0.94, shift: 0.96, hz: 15, depth: 0.05, dip: 0.42 },
    v6t: { vtop: 0.93, shift: 0.95, hz: 17, depth: 0.06, duty: 0.5, dip: 0.35, crackle: 0.4 },
    v8m: { vtop: 0.91, shift: 0.92, hz: 10, depth: 0.065, dip: 0.4, crackle: 0.35 },
    v8f: { vtop: 0.94, shift: 0.96, hz: 16, depth: 0.05, dip: 0.4 },
    v8t: { vtop: 0.92, shift: 0.93, hz: 12, depth: 0.055, dip: 0.42, crackle: 0.35 },
    v10: { vtop: 0.94, shift: 0.96, hz: 17, depth: 0.05, duty: 0.5, dip: 0.36, crackle: 0.3, noise: 0.07 },
    v12: { vtop: 0.94, shift: 0.95, hz: 15, depth: 0.04, dip: 0.45, crackle: 0.25 },
    f1: { vtop: 0.95, shift: 0.97, hz: 20, depth: 0.04, duty: 0.5, dip: 0.3, noise: 0.07 },
    dsl: { vtop: 0.9, shift: 0.92, hz: 5, depth: 0.03, duty: 0.5, dip: 0.7, soft: true, noise: 0.05 },
    ev: { noise: 0 }
  };

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function hash(s) { s = String(s || ''); var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  // ---------------------------------------------------------------- Rechnung (ohne Web Audio, testbar)
  var Model = {
    // Abstimmung der Motorart (spec.type, sonst Standardwerte)
    tune: function (spec) {
      var k = spec && spec.type, c = spec && spec._tune;
      if (c && c.k === k) return c;
      c = Object.assign({ k: k }, TUNE_DEF, TUNE[k] || {});
      if (spec) spec._tune = c;
      return c;
    },
    // Übersetzungen: oberster Gang 1, erster Gang erreicht den Begrenzer bei g1 · vmax; dazwischen geometrisch
    ratios: function (spec) {
      var n = Math.max(1, spec.gears | 0), q = n > 1 ? Math.pow(1 / spec.g1, 1 / (n - 1)) : 1, r = [];
      for (var g = 1; g <= n; g++) r.push(Math.pow(q, n - g));
      return r;
    },
    rpmAt: function (spec, g, speed) {
      var r = spec._r || (spec._r = Model.ratios(spec));
      return Math.max(0, speed) * r[clamp(g, 1, r.length) - 1] * spec.red * Model.tune(spec).vtop;
    },
    // ein Schritt Gangmodell: Hochschalten je nach Gas früher/später, Zurückschalten mit Abstand (Hysterese),
    // im Stand bzw. beim Anfahren Kupplung (Drehzahl aus dem Gas), Drehzahl folgt träge. Hochschalten: Drehzahl fällt
    // schnell auf die des neuen Gangs (Übersetzungssprung), dazu kurz Gas weg (cut, Zugkraftunterbrechung);
    // Zurückschalten ohne Gas: kurzer Zwischengas-Stoß (blip). Am Begrenzer stottert sie.
    gearStep: function (spec, st, speed, thr, dt) {
      st = st || {};
      if (st.rpm == null || st.gear == null) { st.rpm = st.rpm == null ? spec.idle : st.rpm; st.gear = 1; }
      st.cut = st.cut || 0; st.blip = st.blip || 0;     // auch nach vorgegebener Drehzahl (Lab)
      st.shifted = 0;
      speed = Math.max(0, speed || 0); thr = clamp(thr || 0, 0, 1);
      if (spec.gears <= 1) {                            // E-Motor: ein Gang, kein Leerlauf
        var te = speed * spec.red;
        st.rpm += (te - st.rpm) * (1 - Math.exp(-dt / 0.08));
        st.gear = 1; return st;
      }
      var n = spec.gears, g = st.gear || 1;
      if (st.cut > 0) st.cut = Math.max(0, st.cut - dt);
      if (st.blip > 0) st.blip = Math.max(0, st.blip - dt);
      var tn = Model.tune(spec), up = spec.red * (0.6 + (tn.shift - 0.6) * thr), down = spec.red * (0.3 + 0.12 * thr);
      if (st.force && g < n) { g++; st.shifted = 1; st.cut = 0.14 + 0.1 * thr; st.force = 0; }
      else if (g < n && Model.rpmAt(spec, g, speed) > up && st.cut <= 0) { g++; st.shifted = 1; st.cut = 0.14 + 0.1 * thr; }
      else if (g > 1 && Model.rpmAt(spec, g, speed) < down && Model.rpmAt(spec, g - 1, speed) < up * 0.9) {
        g--; st.shifted = -1;
        if (thr < 0.3 && speed > 0.05) st.blip = 0.16;
      }
      st.force = 0;
      st.gear = g;
      var wheel = Model.rpmAt(spec, g, speed), target, stand = speed < 0.01;
      // im Stand/ausgekuppelt: Gas = Drehzahl, Vollgas läuft in den Begrenzer (Teilgas bleibt darunter)
      if (stand) target = spec.idle + thr * (1.04 * spec.red - spec.idle);
      else if (g === 1 && wheel < 0.45 * spec.red) target = Math.max(wheel, spec.idle + thr * (0.5 * spec.red - spec.idle));   // Kupplung schleift
      else target = Math.max(wheel, spec.idle);
      if (st.blip > 0) target *= 1.08;
      target = Math.min(target, spec.red * 1.02);           // nie (weit) über den Begrenzer, auch im Schub
      if (Model.limitStep(spec, st, target, thr, dt)) return st;
      // eingekuppelt hängt die Drehzahl fest an den Rädern (kurze Zeitkonstante); im Stand/schleifend träger
      var slip = stand || (g === 1 && wheel < 0.45 * spec.red);
      var tau = target > st.rpm ? (stand ? 0.09 : slip ? 0.14 : 0.05) : (st.cut > 0 ? 0.035 : slip ? 0.12 : 0.06);
      st.rpm += (target - st.rpm) * (1 - Math.exp(-dt / tau));
      return st;
    },
    // Begrenzer (Kraftstoffabschaltung): will die Drehzahl unter Last (Gas > 50 %) über den Begrenzer und ist sie dort
    // angekommen, pendelt sie knapp darunter – Schnitt (Drehzahl fällt um depth), Erholung zurück zum Begrenzer,
    // hz-mal je Sekunde. Setzt st.rpm selbst und gibt true zurück; st.limiter = 1 solange er arbeitet, st.limPh Phase
    // (0..1, 0 = Beginn eines Schnitts), st.limN Zahl der Schnitte. Ohne Last / nach dem Hochschalten sofort aus.
    limitStep: function (spec, st, target, thr, dt) {
      var tn = Model.tune(spec);
      if (spec.gears <= 1 || !(thr > 0.5) || target < spec.red * 0.995 || (!st.limiter && st.rpm < spec.red * 0.985)) {
        st.limiter = 0; st.limPh = 0; return false;
      }
      if (!st.limiter) { st.limiter = 1; st.limPh = 0; st.limN = 0; }
      var ph = st.limPh + dt * tn.hz;
      st.limN = (st.limN || 0) + Math.floor(ph);
      st.limPh = ph % 1;
      st.rpm = spec.red * (1 - tn.depth * Model.limitWave(tn, st.limPh));
      return true;
    },
    // Verlauf eines Begrenzer-Schnitts (0 = am Begrenzer, 1 = tiefster Punkt) über die Phase 0..1: schneller Abfall im
    // Schnitt (duty), dann Erholung; weicher Regler (Diesel) sinusförmig
    limitWave: function (tn, ph) {
      ph = ((ph % 1) + 1) % 1;
      if (tn.soft) return 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
      return ph < tn.duty ? Math.sin(Math.PI / 2 * ph / tn.duty) : 1 - smooth((ph - tn.duty) / (1 - tn.duty));
    },
    // mittlere Drehzahl im Begrenzer (für die Körner; das Pendeln selbst kommt im Takt der Audio-Uhr dazu)
    limitRpm: function (spec) { return spec.red * (1 - Model.tune(spec).depth * 0.5); },

    // Schleifen-Leiter einer Stimme: Schleifen mit ähnlicher Drehzahl (±10 %) bilden eine Stufe; je Stufe die
    // Aufnahme, die zum Auto passt (seed) – bevorzugt immer dieselbe Quelle, damit die Klangfarbe nicht springt
    ladder: function (loops, seed, max, prefSrc) {
      var L = (loops || []).slice().sort(function (a, b) { return a.rpm - b.rpm; });
      if (!L.length) return [];
      var srcs = []; L.forEach(function (l) { if (srcs.indexOf(l.src) < 0) srcs.push(l.src); });
      var pref = prefSrc != null && srcs.indexOf(prefSrc) >= 0 ? prefSrc : srcs[hash(seed) % srcs.length];
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
    rate: function (rpm, loopRpm) { return clamp(rpm / Math.max(1, loopRpm), 0.45, 2.4); },

    // Sweep = Mitschnitt mit Drehzahlverlauf pts [[t s, U/min], …] (t steigend; U/min beim Hochlauf steigend, beim
    // Abfall fallend – das Bauskript macht ihn monoton). prepSweep legt die Suchtabellen an (nach Drehzahl sortiert).
    prepSweep: function (sw) {
      if (sw._T) return sw;
      var p = (sw.pts || []).slice().sort(function (a, b) { return a[0] - b[0]; });
      var T = p.map(function (x) { return x[0]; }), R = p.map(function (x) { return x[1]; });
      sw._pT = T; sw._pR = R;                                    // nach Zeit
      var idx = R.map(function (r, i) { return i; }).sort(function (a, b) { return R[a] - R[b]; });
      sw._T = idx.map(function (i) { return T[i]; }); sw._R = idx.map(function (i) { return R[i]; });   // nach Drehzahl
      sw.lo = sw._R[0]; sw.hi = sw._R[sw._R.length - 1];
      return sw;
    },
    // Stelle im Sweep für eine Drehzahl (außerhalb: Rand) → { t, r } (r = Drehzahl an der Stelle)
    sweepPos: function (sw, rpm) {
      Model.prepSweep(sw);
      var T = sw._T, R = sw._R, n = R.length;
      if (!n) return { t: 0, r: rpm };
      if (rpm <= R[0]) return { t: T[0], r: R[0] };
      if (rpm >= R[n - 1]) return { t: T[n - 1], r: R[n - 1] };
      var a = 0, b = n - 1;
      while (b - a > 1) { var m = (a + b) >> 1; if (R[m] <= rpm) a = m; else b = m; }
      var f = R[b] > R[a] ? (rpm - R[a]) / (R[b] - R[a]) : 0;
      return { t: T[a] + f * (T[b] - T[a]), r: rpm };
    },
    // Drehzahl an einer Stelle des Sweeps (Zeit → U/min)
    sweepRpm: function (sw, t) {
      Model.prepSweep(sw);
      var T = sw._pT, R = sw._pR, n = T.length;
      if (!n) return 1000;
      if (t <= T[0]) return R[0];
      if (t >= T[n - 1]) return R[n - 1];
      var a = 0, b = n - 1;
      while (b - a > 1) { var m = (a + b) >> 1; if (T[m] <= t) a = m; else b = m; }
      return R[a] + (t - T[a]) / Math.max(1e-9, T[b] - T[a]) * (R[b] - R[a]);
    },
    // Zeitbereich des Sweeps, in dem die Drehzahl höchstens ±tol neben rpm liegt (tol ab 4 %, bis 9 % verbreitert,
    // bis das Band ≥ minSpan s lang ist) → { a, b } (a < b)
    // am Rand des Sweeps (Drehzahl darüber/darunter) bzw. bei steilen Stellen wird das Band auf minSpan verlängert
    // (innerhalb 0…dur; die Tonhöhe zieht die Abspielrate nach) – sonst spielte immer dieselbe Stelle („Schleifen“)
    band: function (sw, rpm, minSpan, dur, maxTol) {
      var a = 0, b = 0, mt = maxTol || 0.121;
      for (var tol = 0.04; tol <= mt; tol *= 1.5) {
        var t1 = Model.sweepPos(sw, rpm * (1 - tol)).t, t2 = Model.sweepPos(sw, rpm * (1 + tol)).t;
        a = Math.min(t1, t2); b = Math.max(t1, t2);
        if (b - a >= minSpan) break;
      }
      if (dur && b - a < minSpan) {
        var m = (a + b) / 2, h = Math.min(minSpan, dur) / 2;
        a = m - h; b = m + h;
        if (a < 0) { b -= a; a = 0; }
        if (b > dur) { a -= b - dur; b = dur; }
        a = Math.max(0, a);
      }
      return { a: a, b: b };
    },
    // Fenster bei gleichbleibender Drehzahl: lang (Ziel ≥ 1,2 s; Drehzahl an der Lesestelle bis ±30 % daneben), damit
    // die Körner nicht immer wieder dieselbe kurze Stelle spielen. Über dem Ende des Sweeps (Höchsttempo, Begrenzer)
    // bis hinunter, wo der Tonhöhen-Nachzug (rateHi) noch reicht; mindestens 0,35 s wie band
    steadyBand: function (sw, rpm, dur, rateHi) {
      Model.prepSweep(sw);
      var w = Model.band(sw, rpm, 1.2, 0, 0.31);
      if (w.b - w.a < 1 && rpm > sw.lo) {
        var t1 = Model.sweepPos(sw, rpm / (rateHi || RATE_HI) * 1.02).t, t2 = Model.sweepPos(sw, rpm * 1.2).t;
        if (Math.abs(t2 - t1) > w.b - w.a) w = { a: Math.min(t1, t2), b: Math.max(t1, t2) };
      }
      if (w.b - w.a < 0.35) w = Model.band(sw, rpm, 0.35, dur);
      return w;
    },
    // Lesestelle des nächsten Korns: läuft die vorige natürlich weiter (nat) und liegt im Fenster, bleibt sie; sonst
    // Sprung an eine zufällige Stelle (beim Hochdrehen im vorderen Teil des Bands). Bei gleichbleibender Drehzahl
    // (steady) springt sie nach 2–7 Körnern ohnehin irgendwohin im ganzen Fenster – keine feste Wiederkehr.
    // g = Zustand je Ebene ({ run }), adv = Vorschub bis zum nächsten Korn (s), rnd = Zufall 0..1 → { head, jump }
    pickHead: function (g, bd, nat, adv, rnd, steady) {
      var fits = nat != null && nat >= bd.a && nat <= bd.b - adv;
      if (fits && (!steady || g.run > 0)) { if (steady) g.run--; return { head: nat, jump: false }; }
      g.run = steady ? 2 + Math.floor(rnd() * 6) : 0;
      return { head: bd.a + rnd() * (steady ? 1 : 0.35) * (bd.b - bd.a), jump: true };
    },
    // Korn-Raster: ein Motorzyklus (720° = 120 / U/min s) – auch bei Oktavfehlern der Beschriftung ein Vielfaches der
    // echten Periode; lange Zyklen (Leerlauf) auf ein Vielfaches der Zündperiode ≥ 35 ms gekürzt
    period: function (rpm, cyl) {
      var P = 120 / Math.max(100, rpm);
      if (P > 0.07 && cyl > 1) { var pf = P / cyl * 2; P = pf * Math.ceil(0.035 / pf); }
      return P;
    },
    // Lesekopf auf die Zielstelle ziehen, nur um ganze Perioden (Phase bleibt), k = zusätzliche Perioden (Abwechslung)
    grainHead: function (head, pos, P, k) {
      var d = head - pos;
      d -= P * Math.round(d / P);
      return pos + d + (k || 0) * P;
    },
    // WSOLA: Stelle c in [cand − delta, cand + delta] (s), deren vorausgehender Abschnitt (len s) dem vor nat am
    // ähnlichsten ist (normierte Kreuzkorrelation, jede dec-te Probe, Suchschritt step Proben) → Zeit in s
    bestMatch: function (d, sr, nat, cand, len, delta, step, dec) {
      var n = Math.max(8, Math.round(len * sr)), a0 = Math.round(nat * sr) - n, best = cand, bv = -2;
      var c0 = Math.round((cand - delta) * sr) - n, c1 = Math.round((cand + delta) * sr) - n;
      if (a0 < 0 || a0 + n > d.length) return cand;
      c0 = Math.max(0, c0); c1 = Math.min(d.length - n - 1, c1);
      var ea = 0, i;
      for (i = 0; i < n; i += dec) ea += d[a0 + i] * d[a0 + i];
      if (ea <= 1e-12) return cand;
      for (var c = c0; c <= c1; c += step) {
        var num = 0, eb = 0;
        for (i = 0; i < n; i += dec) { var b = d[c + i]; num += d[a0 + i] * b; eb += b * b; }
        var v = eb > 1e-12 ? num / Math.sqrt(ea * eb) : -1;
        if (v > bv) { bv = v; best = (c + n) / sr; }
      }
      return best;
    },
    // Anteile der Ebenen: Leerlauf-Schleife unten (bis 1,5 × Leerlauf ausgeblendet), darüber Gas/Schub nach Last
    // (gleiche Leistung); ohne Schub-Mitschnitt trägt der Hochlauf beides (leiser ohne Last)
    layerMix: function (spec, rpm, load, hasIdle, hasOff) {
      load = clamp(load, 0, 1);
      var wi = hasIdle ? 1 - smooth((rpm - spec.idle * 1.05) / (spec.idle * 0.45)) : 0;
      var gi = hasIdle ? Math.cos((1 - wi) * Math.PI / 2) : 0, rest = hasIdle ? Math.sin((1 - wi) * Math.PI / 2) : 1;
      if (!hasOff) return { idle: gi, on: rest * (0.55 + 0.45 * load), off: 0 };
      return { idle: gi, on: rest * Math.sqrt(load), off: rest * Math.sqrt(1 - load) };
    },
    hann: function (n) {
      var a = new Float32Array(n);
      for (var i = 0; i < n; i++) a[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
      return a;
    }
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
    var bank = null, bufs = {}, voices = [], HANN = Model.hann(64), noiseB = null;
    // weißes Rauschen (2 s, geteilt): Ansaug-/Auspuffrauschen und Knistern am Begrenzer
    function noiseBuf() {
      if (noiseB) return noiseB;
      noiseB = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      var d = noiseB.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return noiseB;
    }
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
    function pick(list, seed, src) {
      if (!list || !list.length) return null;
      if (src != null) { var p = list.filter(function (x) { return x.src === src; })[0]; if (p) return p; }
      return list[(seed == null ? Math.floor(Math.random() * 1e9) : hash(seed)) % list.length];
    }
    // Aufnahme, die eine Stimme trägt: fest je Auto (bank.cars), sonst einer der zwei besten Hochläufe nach seed
    function voiceSrc(sp, seed) {
      var fixed = bank && bank.cars && bank.cars[seed];
      if (fixed != null) return fixed;
      var on = sp && sp.on || [];
      if (on.length) return on[hash(seed) % Math.min(2, on.length)].src;
      return null;
    }

    function playShot(type, kind, o) {
      o = o || {};
      return ready.then(function () {
        var sp = spec(type), list = sp && sp[kind];
        (SHOT_FALLBACK[type] || []).forEach(function (f) { if (!(list && list.length)) { var s2 = bank.types[f]; list = s2 && s2[kind]; } });
        var item = pick(list, o.seed, o.src);
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
      var gainK = vo.gain == null ? 1 : vo.gain, seed = vo.seed || type, lite = !!vo.lite;
      var gr = lite ? GR_LITE : GR, hop = lite ? HOP_LITE : HOP;
      var sp = null, st = {}, alive = true, started = false, src0 = null;
      // Rückfall-Schleifen (ohne Sweep)
      var lad = [], srcs = [], gains = [];
      // Sweep-Ebenen: on (Hochlauf), off (Abfall); je Ebene Haupt-Sweep + ggf. ein höher reichender (ext)
      var layers = {}, idle = null, mixNow = { idle: 0, on: 0, off: 0 };
      var vGain = ctx.createGain(), lp = ctx.createBiquadFilter(), mix = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      // Begrenzer: limG = Pegel-Einbruch je Schnitt, dly = Tonhöhe (Verzögerung wächst im Schnitt → kurz tiefer)
      var limG = ctx.createGain(), dly = ctx.createDelay(0.05), D0 = 0.005;
      vGain.gain.value = 0; lp.type = 'lowpass'; lp.frequency.value = 6000; lp.Q.value = 0.5; mix.gain.value = 1;
      limG.gain.value = 1; dly.delayTime.value = D0;
      mix.connect(limG); limG.connect(dly); dly.connect(lp); lp.connect(vGain);
      if (pan) { vGain.connect(pan); pan.connect(out); } else vGain.connect(out);
      var turbo = null, lastAtt = 1, boost = 0, lastThr = 0, offT = 0, popNext = 0, blipT = 0, blipA = 0, level = 0, loadS = 0, dop = 1;
      // gleichbleibende Drehzahl erkennen (träge Drehzahl), Drehzahl-Wackeln (±1–2 %, langsamer Zufall), Rauschen,
      // Begrenzer-Schnitte auf der Audio-Uhr (limNext = Beginn des nächsten Schnitts)
      var rpmSlow = 0, steady = false, wob = 0, noise = null, limNext = 0, limOn = false;

      // Sweep der Ebene für diese Drehzahl: der erste der Liste (bevorzugte Aufnahme zuerst), dessen Bereich passt;
      // sonst der nächstliegende (Schub-Ebene oberhalb ihres Mitschnitts → Hochlauf-Mitschnitt, dumpfer)
      function pickSweep(L, rpm) {
        var best = null, bd = 1e9, i, s;
        for (i = 0; i < L.list.length; i++) {             // zuerst eines, das die Drehzahl wirklich enthält
          s = L.list[i];
          if (s.buf && rpm >= s.lo && rpm <= s.hi) return s;
        }
        for (i = 0; i < L.list.length; i++) {
          s = L.list[i];
          if (!s.buf) continue;
          if (rpm >= s.lo * 0.87 && rpm <= s.hi * 1.15) return s;
          var d = rpm > s.hi ? Math.log(rpm / s.hi) : Math.log(s.lo / rpm);
          if (d < bd - 0.05) { bd = d; best = s; }
        }
        return best;
      }
      // ein Korn eines Sweeps zur Zeit when: Zielstelle aus der Drehzahl; Lesekopf auf ganze Motorzyklen gezogen und
      // dann per Wellenform-Vergleich (WSOLA) fein so gesetzt, dass das Korn an das vorige anschließt – überlappende
      // Körner löschen sich so nicht aus (kein Flattern im Korn-Takt)
      function grain(L, when, rpm, gap) {
        var sw = pickSweep(L, rpm);
        if (!sw) return;
        if (L.cur !== sw) { if (L.cur) L.cur.head = null; L.cur = sw; }
        var sp0 = Model.sweepPos(sw, rpm), pos = sp0.t, P = Model.period(sp0.r, sp.cyl);
        var adv = gap * (sw.rate || 1), nat = sw.head == null ? null : sw.head + adv;
        // Band um die Drehzahl (±4 %, verbreitert bis ≥ 0,35 s Material): solange der Lesekopf darin liegt, läuft er
        // natürlich vorwärts (kein kurzes Wiederholen derselben Stelle = kein „Schleifen“); verlässt er es, springt er
        // an eine zufällige Stelle im vorderen Teil des Bands. Bei gleichbleibender Drehzahl (Höchsttempo, Begrenzer)
        // ein langes Fenster mit zufälligen Sprüngen (Model.steadyBand/pickHead) – sonst hörbare Wiederholung
        var span = gr * RATE_HI, lo = span / 2 + 0.002, hi = sw.buf.duration - span / 2 - 0.002;
        var bd = steady ? Model.steadyBand(sw, rpm, sw.buf.duration, RATE_HI) : Model.band(sw, sp0.r, 0.35, sw.buf.duration), head;
        bd.a = clamp(bd.a, lo, hi); bd.b = clamp(bd.b, lo, hi);              // nur Stellen, an denen ein Korn Platz hat
        var pk = Model.pickHead(L, bd, nat, adv, Math.random, steady);
        head = pk.jump ? Model.grainHead(nat == null ? pk.head : nat, pk.head, P, 0) : pk.head;
        while (head < lo) head += P;
        while (head > hi) head -= P;
        if (head < lo) head = lo;
        if (nat != null && nat - adv >= 0 && nat < sw.buf.duration) {
          if (!sw.data) sw.data = sw.buf.getChannelData(0);
          head = Model.bestMatch(sw.data, sw.buf.sampleRate, nat, head, adv, Math.min(P / 2, 0.006), lite ? 4 : 2, lite ? 6 : 4);
          head = clamp(head, lo, hi);
        }
        // Tonhöhe: Drehzahl / Drehzahl an der Lesestelle (im Band höchstens ein paar Prozent, außerhalb des Sweeps
        // mehr), geglättet, damit Messrauschen der Beschriftung nicht als Zittern hörbar wird
        var want = rpm / Math.max(1, Model.sweepRpm(sw, head));
        sw.rc = sw.rc == null ? want : sw.rc + (want - sw.rc) * 0.35;
        var rate = clamp(sw.rc, RATE_LO, RATE_HI);
        sw.head = head; sw.rate = rate * dop;                 // Lesekopf rückt um Abstand × Abspielrate weiter
        var s = ctx.createBufferSource(), e = ctx.createGain();
        s.buffer = sw.buf; s.playbackRate.value = rate * dop;
        e.gain.value = 0;
        try { e.gain.setValueCurveAtTime(HANN, when, gr); } catch (er) { e.gain.setValueAtTime(1, when); }
        s.connect(e); e.connect(L.g);
        s.start(when, Math.max(0, head - gr * rate * dop / 2), gr * rate * dop + 0.005);
        s.onended = function () { try { e.disconnect(); } catch (er) { /* schon getrennt */ } };
      }
      function schedule(rpm) {
        var t = ctx.currentTime, until = t + AHEAD;
        ['on', 'off'].forEach(function (k) {
          var L = layers[k];
          if (!L) return;
          var w = mixNow[k];
          if (w < 0.003) { L.next = 0; L.list.forEach(function (x) { x.head = null; }); L.cur = null; return; }
          if (!L.next || L.next < t) { L.next = t + 0.004; L.gap = hop; }
          // bei gleichbleibender Drehzahl Körner leicht unregelmäßig setzen (±10 %): kein fester Korn-Takt
          while (L.next < until) { grain(L, L.next, rpm, L.gap || hop); L.gap = steady ? hop * (0.9 + 0.2 * Math.random()) : hop; L.next += L.gap; }
        });
      }

      // ein Begrenzer-Schnitt zur Zeit w (Periode per): Pegel bricht ein, Tonhöhe sinkt kurz (Verzögerung wächst) und
      // kommt in der Erholung zurück; wenn wieder Kraftstoff kommt, manchmal Knistern (unverbranntes Gemisch)
      function limitCut(w, per, tn) {
        var c = per * tn.duty, h = tn.depth * 0.7, back = w + c + (per - c) * 0.6;
        limG.gain.setValueAtTime(1, w);
        limG.gain.linearRampToValueAtTime(tn.dip, w + c * (tn.soft ? 0.9 : 0.3));
        limG.gain.setValueAtTime(tn.dip, w + c);
        limG.gain.linearRampToValueAtTime(1, back);
        dly.delayTime.setValueAtTime(D0, w);
        dly.delayTime.linearRampToValueAtTime(D0 + h * c, w + c);
        dly.delayTime.linearRampToValueAtTime(D0, w + per);
        if (tn.crackle && Math.random() < tn.crackle) crackle(w + c + Math.random() * 0.01, 0.6 + Math.random() * 0.6);
      }
      function crackle(w, a) {
        var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), len = 0.008 + Math.random() * 0.018;
        s.buffer = noiseBuf();
        f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 2600; f.Q.value = 1.4;
        g.gain.setValueAtTime(0.0001, w);
        g.gain.linearRampToValueAtTime(a * 0.5 * MIX * gainK * lastAtt, w + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0001, w + len);
        s.connect(f); f.connect(g); g.connect(pan || out);
        s.start(w, Math.random() * 1.9, len + 0.01);
        s.onended = function () { try { g.disconnect(); } catch (e) { /* schon getrennt */ } };
      }

      var v = {
        type: type,
        update: function (dt, p) {
          if (!alive) return;
          p = p || {};
          dt = clamp(dt || 0, 0, 0.1);
          if (!sp || !started) return;
          var thr = clamp(p.throttle || 0, 0, 1);
          if (blipT > 0) { blipT = Math.max(0, blipT - dt); thr = Math.max(thr, blipT > 0.25 ? blipA : blipA * blipT / 0.25); }
          if (p.rpm != null) {                                    // Drehzahl vorgegeben (Engine sound lab)
            if (st.rpm == null) st.rpm = sp.idle;
            if (st.cut > 0) st.cut = Math.max(0, st.cut - dt);
            var wantR = clamp(+p.rpm || 0, 0, sp.red * 1.02);
            // Regler ganz oben mit Last → Begrenzer
            if (!Model.limitStep(sp, st, wantR >= sp.red * 0.99 ? sp.red * 1.02 : wantR, p.load != null ? +p.load : thr, dt)) {
              st.rpm += (Math.min(wantR, sp.red) - st.rpm) * (1 - Math.exp(-dt / 0.06));
            }
            st.gear = st.gear || 1; st.shifted = 0;
          } else Model.gearStep(sp, st, p.speed || 0, thr, dt);
          var t = ctx.currentTime, tn = Model.tune(sp);
          // Körner: im Begrenzer die mittlere Drehzahl (das Pendeln liefern limG/dly im Takt der Audio-Uhr)
          var rpm = st.limiter ? Model.limitRpm(sp) : st.rpm;
          rpmSlow = rpmSlow ? rpmSlow + (rpm - rpmSlow) * (1 - Math.exp(-dt / 0.35)) : rpm;
          steady = !!st.limiter || (rpm > sp.idle * 1.6 && Math.abs(rpm - rpmSlow) < rpm * 0.02);
          // leichtes Wackeln der Drehzahl (langsamer Zufall, ±1–2 % oben) – ein echter Motor hält sie nie ganz still
          wob += (-wob * dt / 0.25) + (Math.random() - 0.5) * 0.1 * Math.sqrt(dt);
          wob = clamp(wob, -0.02, 0.02);
          var rpmG = rpm * (1 + wob * smooth((rpm / sp.red - 0.45) / 0.35));
          dop = p.radial ? clamp(340 / (340 - clamp(p.radial, -120, 120)), 0.75, 1.35) : 1;
          // Last: Gas (nach dem Hochschalten kurz weg, beim Zwischengas kurz da), geglättet
          var load = p.load != null ? clamp(+p.load, 0, 1) : st.cut > 0 ? 0 : st.blip > 0 ? Math.max(thr, 0.6) : thr;
          loadS += (load - loadS) * (1 - Math.exp(-dt / (load > loadS ? 0.05 : 0.08)));
          if (layers.on) {
            mixNow = Model.layerMix(sp, rpm, loadS, !!idle, !!layers.off);
            if (idle) {
              idle.g.gain.setTargetAtTime(mixNow.idle, t, 0.03);
              if (idle.s) idle.s.playbackRate.setTargetAtTime(clamp(rpm / idle.rpm, 0.8, 1.5) * dop, t, 0.03);
            }
            layers.on.g.gain.setTargetAtTime(mixNow.on, t, 0.02);
            if (layers.off) layers.off.g.gain.setTargetAtTime(mixNow.off, t, 0.02);
            schedule(rpmG);
          } else {
            var ws = Model.weights(lad, Math.max(rpm, sp.gears <= 1 ? 1 : 0));
            var w = {};
            ws.forEach(function (x) { w[x.i] = x.g; });
            for (var i = 0; i < lad.length; i++) {
              gains[i].gain.setTargetAtTime(w[i] || 0, t, 0.04);
              if (srcs[i]) srcs[i].playbackRate.setTargetAtTime(Model.rate(sp.gears <= 1 ? Math.max(rpm, lad[0].rpm * 0.5) : rpm, lad[i].rpm) * dop, t, 0.03);
            }
          }
          var dist = p.dist == null ? 0 : Math.max(0, p.dist), ref = p.ref || 1;
          var att = dist <= ref ? 1 : ref / dist;
          lastAtt = att;
          var air = clamp(14000 * Math.pow(att, 0.7), 900, 14000);
          // Klangfarbe: Sweeps bringen Last und Drehzahl schon mit → Filter nur leicht; Schleifen brauchen mehr
          var bright = sp.gears <= 1 ? 9000 : layers.on ? (layers.off ? 9000 + 5000 * loadS : 2600 + 9000 * Math.pow(loadS, 0.7) + 2500 * (rpm / sp.red))
            : 1600 + 7000 * Math.pow(loadS, 0.8) + 2500 * (rpm / sp.red);
          lp.frequency.setTargetAtTime(Math.min(air, bright), t, 0.05);
          var ev = sp.gears <= 1 ? clamp((p.speed || 0) * 3 + thr * 0.3, 0, 1) : 1;
          var dyn = layers.on ? (layers.off ? 1 : 0.8 + 0.2 * loadS) : (0.5 + 0.5 * loadS) * (0.75 + 0.25 * rpm / sp.red);
          // Schalten hörbar machen: während der Zugkraftunterbrechung kurz leiser (Einbruch), danach wieder voll
          var shiftDip = st.cut > 0 && p.rpm == null ? 0.55 : 1;
          level = p.on === false ? 0 : MIX * gainK * att * ev * dyn * shiftDip;
          vGain.gain.setTargetAtTime(level, t, p.on === false ? 0.25 : shiftDip < 1 ? 0.02 : 0.05);
          if (pan) pan.pan.setTargetAtTime(clamp(p.pan || 0, -1, 1), t, 0.05);
          // Begrenzer: Schnitte bis AHEAD voraus planen (Periode ±6 % unregelmäßig); jeder Schnitt endet wieder bei
          // vollem Pegel und Grund-Verzögerung, beim Aussteigen läuft der letzte nur aus
          if (st.limiter && p.on !== false) {
            if (!limOn || limNext < t) limNext = t + 0.005;
            limOn = true;
            while (limNext < t + AHEAD) {
              var per = (1 / tn.hz) * (1 + (Math.random() - 0.5) * 0.12);
              limitCut(limNext, per, tn); limNext += per;
            }
            if (POPS[type] && tn.crackle && t > popNext && Math.random() < dt * 1.5 * tn.crackle) { v.oneShot('pop', 0.12); popNext = t + 0.25 + Math.random() * 0.4; }
          } else limOn = false;
          // Ansaug-/Auspuffrauschen: nach Last und Drehzahl (oben unter Vollgas am meisten), Klangfarbe folgt der Drehzahl
          if (noise) {
            var fr = clamp(rpm / sp.red, 0, 1.05);
            noise.g.gain.setTargetAtTime(tn.noise * Math.pow(loadS, 1.5) * fr * fr, t, 0.06);
            noise.f.frequency.setTargetAtTime((350 + 2400 * fr) * dop, t, 0.08);
          }
          // Turbo: Ladedruck folgt Last × Drehzahl träge (Aufladen ~0,6 s, Abfall schnell), Pfeifen 2,5–7 kHz
          if (turbo) {
            var want = clamp((rpm / sp.red - 0.25) * 1.5, 0, 1) * loadS;
            boost += (want - boost) * (1 - Math.exp(-dt / (want > boost ? 0.6 : 0.15)));
            turbo.g.gain.setTargetAtTime((sp.boost === true ? 0.12 : +sp.boost || 0.12) * MIX * boost * gainK * att, t, 0.05);
            turbo.o.frequency.setTargetAtTime((2500 + 4500 * boost) * dop, t, 0.08);
            if (lastThr > 0.6 && thr < 0.2 && boost > 0.45) v.oneShot('turbo', 0.35 * boost);
            else if (st.shifted > 0 && boost > 0.5) { v.oneShot('turbo', 0.16 * boost); boost *= 0.6; }   // Abblasen beim Schalten
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
        // Einmal-Klang am Ort der Stimme (Abstand wie beim letzten update, Panorama der Stimme), auch vor dem Laden;
        // bevorzugt aus derselben Aufnahme wie die Stimme (Anlassen und Fahren klingen nach demselben Auto)
        oneShot: function (kind, g) {
          if (!alive) return;
          ready.then(function () {
            if (!alive) return;
            var s = src0 != null ? src0 : voiceSrc(spec(type), seed);
            playShot(type, kind, { gain: (g == null ? 0.5 : g) * gainK * lastAtt, dest: pan || out, seed: seed + ':' + kind + ':' + Math.random(), src: kind === 'pop' ? null : s });
          });
        },
        blip: function (a) { blipA = clamp(a == null ? 0.8 : a, 0.2, 1); blipT = 0.45; },
        shift: function () { st.force = 1; },
        rpm: function () { return st.rpm || 0; },
        gear: function () { return st.gear || 1; },
        level: function () { return level; },
        info: function () {
          return { rpm: st.rpm || 0, gear: st.gear || 1, load: loadS, boost: boost, mix: mixNow, src: src0,
            limiter: !!st.limiter, limitHz: st.limiter && sp ? Model.tune(sp).hz : 0, steady: steady,
            on: layers.on ? (layers.on.cur || layers.on.sw).f : null, pieces: layers.on ? layers.on.list.length : 0,
            off: layers.off ? (layers.off.cur || layers.off.sw).f : null, idle: idle ? idle.f : null, loops: layers.on ? 0 : lad.length };
        },
        stop: function () {
          if (!alive) return;
          alive = false;
          var t = ctx.currentTime;
          vGain.gain.setTargetAtTime(0, t, 0.12);
          if (turbo) turbo.g.gain.setTargetAtTime(0, t, 0.1);
          setTimeout(function () {
            srcs.forEach(function (s) { try { s.stop(); } catch (e) { /* nie gestartet */ } });
            if (idle && idle.s) { try { idle.s.stop(); } catch (e) { /* nie gestartet */ } }
            if (turbo) { try { turbo.o.stop(); turbo.n.stop(); } catch (e) { /* schon aus */ } }
            if (noise) { try { noise.s.stop(); } catch (e) { /* schon aus */ } }
            try { vGain.disconnect(); if (pan) pan.disconnect(); } catch (e) { /* schon getrennt */ }
          }, 700);
          voices = voices.filter(function (x) { return x !== v; });
        }
      };

      // Sweep-Ebene anlegen: die Stücke der bevorzugten Aufnahme zuerst (nach Drehzahl), dann die übrigen (nach Güte,
      // wie in bank.json) – pickSweep nimmt je Drehzahl das erste passende; Ersatz-Stücke (Schub-Ebene: die Hochläufe)
      // hinten an. Je Ebene eigene Kopien (eigener Lesekopf), Puffer werden geteilt
      function makeLayer(list, pref, more) {
        if (!list || !list.length) return null;
        list = list.map(function (x) { return Model.prepSweep(Object.assign({}, x)); });
        var own = list.filter(function (x) { return x.src === pref; }).sort(function (a, b) { return a.lo - b.lo; });
        var all = own.concat(list.filter(function (x) { return x.src !== pref; }))
          .concat((more || []).map(function (x) { return Object.assign({}, x, { head: null }); }));
        var g = ctx.createGain(); g.gain.value = 0; g.connect(mix);
        return { sw: all[0], list: all, g: g, next: 0, cur: null };
      }

      ready.then(function () {
        if (!alive) return;
        sp = spec(type);
        if (!sp) return;
        sp = Object.assign({}, sp, { type: type });
        st = {};
        src0 = vo.src != null ? +vo.src : voiceSrc(sp, seed);
        var waits = [];
        if (sp.on && sp.on.length && vo.mode !== 'loops') {
          layers.on = makeLayer(sp.on, src0);
          if (!lite) layers.off = makeLayer(sp.off, src0, layers.on.list);
          ['on', 'off'].forEach(function (k) {
            var L = layers[k];
            if (!L) return;
            L.list.forEach(function (x) { waits.push(load(x.f).then(function (b) { x.buf = b; })); });
          });
          // Leerlauf: Schleife derselben Aufnahme, sonst die tiefste
          var il = (sp.loops || []).filter(function (l) { return l.rpm <= sp.idle * 1.3; });
          var it = il.filter(function (l) { return l.src === src0; })[0] || il.sort(function (a, b) { return Math.abs(Math.log(a.rpm / sp.idle)) - Math.abs(Math.log(b.rpm / sp.idle)); })[0];
          if (it) {
            idle = { f: it.f, rpm: it.rpm, g: ctx.createGain() };
            idle.g.gain.value = 0; idle.g.connect(mix);
            waits.push(load(it.f).then(function (b) {
              if (!b || !alive) return;
              var s = ctx.createBufferSource();
              s.buffer = b; s.loop = true; s.loopStart = it.ls; s.loopEnd = Math.min(it.le, b.duration);
              s.connect(idle.g); s.start(ctx.currentTime, it.ls + (hash(seed) % 1000) / 1000 * (it.le - it.ls));
              idle.s = s;
            }));
          }
        } else {
          lad = Model.ladder(sp.loops, seed, lite ? 4 : 0, src0);
          waits.push(Promise.all(lad.map(function (l) { return load(l.f); })).then(function (bs) {
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
          }));
        }
        return Promise.all(waits).then(function () {
          if (!alive) return;
          if (layers.on && !layers.on.sw.buf) {                 // Sweep nicht geladen → ohne Sweep weiter (stumm)
            if (root.console) console.warn('Engine sounds: sweep for ' + type + ' missing');
          }
          if (sp.gears > 1 && Model.tune(sp).noise > 0) {
            var ns = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng0 = ctx.createGain();
            ns.buffer = noiseBuf(); ns.loop = true;
            nf.type = 'bandpass'; nf.frequency.value = 800; nf.Q.value = 0.6; ng0.gain.value = 0;
            ns.connect(nf); nf.connect(ng0); ng0.connect(mix);
            ns.start(ctx.currentTime, (hash(seed) % 1000) / 500);
            noise = { s: ns, f: nf, g: ng0 };
          }
          if (sp.boost) {
            var o = ctx.createOscillator(), n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), tg = ctx.createGain();
            o.type = 'sine'; o.frequency.value = 2500;
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
      spec: function (type) { return spec(type); },
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
