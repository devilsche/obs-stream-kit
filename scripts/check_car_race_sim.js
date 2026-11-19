#!/usr/bin/env node
/* Prüfskript für js/car-race-sim.js (Car Race: Strecke + deterministische Fahrsimulation).
 * Kein Test-Framework: gibt „OK“ aus oder eine Fehlerliste, Exit-Code ≠ 0 bei Fehler.
 *
 *   node scripts/check_car_race_sim.js            alle Prüfungen (inkl. Bilanz über 1000 Rennen)
 *   node scripts/check_car_race_sim.js --races 200 Bilanz mit weniger Rennen (schneller beim Abstimmen)
 *   node scripts/check_car_race_sim.js --find 40   Strecken-Seeds suchen (prüft Seeds 1..40, druckt die Favoriten für TRACKS)
 */
'use strict';
var path = require('path');

var errors = [];
function fail(msg) { errors.push(msg); }

var Sim;
try {
  Sim = require(path.join(__dirname, '..', 'js', 'car-race-sim.js'));
} catch (e) {
  console.log('FAIL\n- Modul js/car-race-sim.js lässt sich nicht laden: ' + e.message);
  process.exit(1);
}

var args = process.argv.slice(2);
function arg(name, def) {
  var i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : def;
}

var DT = 1 / 60;
var MAX_T = 95;   // Sicherheitsnetz: die Sim muss nach spätestens 90 s selbst fertig sein

// Eigener Zufall fürs Prüfskript (Feldzusammensetzung), unabhängig von der Sim
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

var AVG = { power: 5, speed: 5, handling: 5, susp: 5, brakes: 5, weight: 5, drive: 'rwd', len: 4.5 };
var BUS = { power: 2, speed: 2, handling: 2, susp: 4, brakes: 3, weight: 10, drive: 'rwd', len: 12 };

function avgField(n) {
  var cars = [];
  for (var i = 0; i < n; i++) cars.push({ id: 'c' + i, stats: Sim.stats(AVG) });
  return cars;
}

// Läuft ein Rennen bis zum Ende; prüft unterwegs NaN, v ≤ vmax, |d| ≤ width/2
function run(opts, label, checkSteps) {
  var sim = Sim.create(opts);
  var half = sim.track.width / 2;
  var bad = false, still = opts.cars.map(function () { return 0; });
  while (!sim.done && sim.time < MAX_T) {
    sim.step();
    // festgefahren? Ein fahrbereites Auto steht nie länger als 8 s (Crash davor dauert höchstens 6 s)
    for (var i = 0; i < sim.cars.length; i++) {
      var c = sim.cars[i];
      still[i] = c.state === 'run' && c.v < 0.3 && sim.time > 3 ? still[i] + DT : 0;
      if (still[i] > 8 && !bad) { fail(label + ': Auto ' + c.id + ' steckt fest bei t=' + sim.time.toFixed(1)); bad = true; }
    }
    if (!checkSteps || bad) continue;
    for (i = 0; i < sim.cars.length; i++) {
      var st = opts.cars[i].stats;
      c = sim.cars[i];
      var nums = [c.s, c.d, c.v, c.yaw, c.roll, c.pitch, c.steer, c.spin];
      for (var k = 0; k < nums.length; k++) {
        if (typeof nums[k] !== 'number' || !isFinite(nums[k])) {
          fail(label + ': Auto ' + c.id + ' hat ungültigen Wert (' + nums.join(', ') + ') bei t=' + sim.time.toFixed(2));
          bad = true; break;
        }
      }
      if (bad) break;
      if (c.v > st.vmax + 1e-9) { fail(label + ': Auto ' + c.id + ' v=' + c.v + ' > vmax=' + st.vmax); bad = true; break; }
      if (c.v < -1e-9) { fail(label + ': Auto ' + c.id + ' fährt rückwärts v=' + c.v); bad = true; break; }
      if (Math.abs(c.d) > half + 1e-9) { fail(label + ': Auto ' + c.id + ' d=' + c.d + ' außerhalb ±' + half); bad = true; break; }
    }
  }
  if (!sim.done) fail(label + ': Rennen nach ' + MAX_T + ' s nicht fertig');
  if (!sim.cars.some(function (c) { return c.place !== null; })) fail(label + ': niemand im Ziel');
  return sim;
}

function winnerTime(sim) {
  var best = Infinity;
  sim.cars.forEach(function (c) { if (c.state === 'done' && c.finish < best) best = c.finish; });
  return best;
}

// ---- Strecken prüfen ----
function checkTrack(seed) {
  var probs = [];
  var t = Sim.track(seed);
  if (!(t.len >= 300 && t.len <= 500)) probs.push('Länge ' + t.len.toFixed(1) + ' m nicht in 300–500');
  if (t.width !== 10) probs.push('Breite ' + t.width + ' statt 10');
  var minR = Infinity;
  for (var s = 0; s < t.len; s += 0.5) minR = Math.min(minR, t.radiusAt(s));
  if (!(minR >= 12)) probs.push('kleinster Radius ' + minR.toFixed(1) + ' m < 12');
  // keine Überschneidung: Mittellinien-Punkte, die entlang der Strecke weit auseinander liegen,
  // müssen räumlich mindestens Streckenbreite + Rand (≥ 1,5 × Breite) Abstand haben
  var step = 2, n = Math.floor(t.len / step), P = [];
  for (var i = 0; i < n; i++) { var a = t.at(i * step); P.push([a.x, a.z]); }
  var minD = Infinity;
  for (i = 0; i < n; i++) {
    for (var j = i + 1; j < n; j++) {
      var along = Math.min((j - i) * step, t.len - (j - i) * step);
      if (along < 40) continue;
      var dx = P[i][0] - P[j][0], dz = P[i][1] - P[j][1];
      minD = Math.min(minD, Math.sqrt(dx * dx + dz * dz));
    }
  }
  if (!(minD >= 1.5 * t.width)) probs.push('Strecke kommt sich auf ' + minD.toFixed(1) + ' m nahe (Überschneidung)');
  // Durchschnittsfeld, 3 Runden: Sieger im Ziel nach 45–75 s
  var times = [];
  for (var k = 0; k < 3; k++) {
    var sim = run({ seed: 1000 + k * 77, track: seed, laps: 3, finishWindow: 15, cars: avgField(10) }, 'Strecke ' + seed, true);
    times.push(winnerTime(sim));
  }
  times.forEach(function (wt) { if (!(wt >= 45 && wt <= 75)) probs.push('Siegerzeit ' + wt.toFixed(1) + ' s nicht in 45–75'); });
  return { probs: probs, len: t.len, minR: minR, minD: minD, times: times };
}

if (args.indexOf('--find') >= 0) {
  var upto = arg('--find', 40), good = [];
  for (var sd = 1; sd <= upto; sd++) {
    var r = checkTrack(sd);
    console.log('Seed ' + sd + ': Länge ' + r.len.toFixed(0) + ' m, min. Radius ' + r.minR.toFixed(1) + ' m, Abstand ' +
      r.minD.toFixed(1) + ' m, Siegerzeiten ' + r.times.map(function (x) { return x.toFixed(1); }).join('/') +
      (r.probs.length ? '  -- ' + r.probs.join('; ') : '  gut'));
    // Favoriten: Regeln erfüllt und Siegerzeit nah am Ziel ~60 s (57–67 s)
    if (!r.probs.length && r.times.every(function (x) { return x >= 57 && x <= 67; })) good.push(sd);
  }
  console.log('Favoriten (Siegerzeit 57–67 s): [' + good.join(', ') + ']');
  process.exit(0);
}

// ---- 1. Grundlagen ----
['rng', 'track', 'stats', 'create'].forEach(function (f) {
  if (typeof Sim[f] !== 'function') fail('CarRaceSim.' + f + ' fehlt');
});
if (!Array.isArray(Sim.TRACKS) || Sim.TRACKS.length < 8) fail('CarRaceSim.TRACKS braucht mindestens 8 Seeds');
if (errors.length) report();

var vr = Sim.stats({ speed: 10 }).vmax / Sim.stats({ speed: 1 }).vmax;
if (!(vr > 1.55 && vr < 1.65)) fail('speed 10 / speed 1 = ' + vr.toFixed(2) + ' (Soll ≈ 1,6)');
var def = Sim.stats({}), five = Sim.stats(AVG);
['acc', 'vmax', 'grip', 'brake', 'susp', 'launch', 'len'].forEach(function (k) {
  if (def[k] !== five[k]) fail('stats({}) weicht bei ' + k + ' von lauter 5ern ab');
});

var r1 = Sim.rng(42), r2 = Sim.rng(42);
for (var q = 0; q < 5; q++) if (r1() !== r2()) fail('rng(42) ist nicht deterministisch');

// ---- 2. Strecken ----
var trackInfo = [];
Sim.TRACKS.forEach(function (seed) {
  var r = checkTrack(seed);
  trackInfo.push('  Strecke ' + seed + ': ' + r.len.toFixed(0) + ' m, min. Radius ' + r.minR.toFixed(1) +
    ' m, Siegerzeit Durchschnittsfeld ' + r.times.map(function (x) { return x.toFixed(1); }).join('/') + ' s');
  r.probs.forEach(function (p) { fail('Strecke ' + seed + ': ' + p); });
});

// ---- 3. Determinismus + fastForward ----
function mixedField(rnd, n, withBus) {
  var cars = [];
  for (var i = 0; i < n; i++) {
    var raw;
    if (withBus && i === 0) raw = BUS;
    else {
      raw = {
        power: 5 + Math.floor(rnd() * 6), speed: 5 + Math.floor(rnd() * 6), handling: 5 + Math.floor(rnd() * 6),
        susp: 5 + Math.floor(rnd() * 6), brakes: 5 + Math.floor(rnd() * 6), weight: 5 + Math.floor(rnd() * 6),
        drive: ['fwd', 'rwd', 'awd'][Math.floor(rnd() * 3)], len: 4.2 + rnd() * 0.8
      };
    }
    cars.push({ id: withBus && i === 0 ? 'bus' : 'car' + i, raw: raw });
  }
  // Startaufstellung mischen (Anmeldereihenfolge ist zufällig)
  for (i = cars.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1)), tmp = cars[i]; cars[i] = cars[j]; cars[j] = tmp;
  }
  return cars;
}
function toSimCars(field) { return field.map(function (c) { return { id: c.id, stats: Sim.stats(c.raw) }; }); }

(function () {
  var field = mixedField(mulberry32(7), 8, true);
  var opts = function () { return { seed: 123456, track: Sim.TRACKS[0], laps: 3, finishWindow: 15, cars: toSimCars(field) }; };
  var a = run(opts(), 'Determinismus A', true), b = run(opts(), 'Determinismus B', false);
  var ra = JSON.stringify(a.result()), rb = JSON.stringify(b.result());
  if (ra !== rb) fail('gleicher Seed ergibt unterschiedliche Ergebnisse:\n    ' + ra + '\n    ' + rb);
  [0.5, 7, 23.4, 41].forEach(function (t) {
    var c = Sim.create(opts());
    c.fastForward(t);
    if (Math.abs(c.time - Math.round(t / DT) * DT) > DT) fail('fastForward(' + t + ') steht bei time=' + c.time);
    while (!c.done && c.time < MAX_T) c.step();
    var rc = JSON.stringify(c.result());
    if (rc !== ra) fail('fastForward(' + t + ') + Weiterlaufen weicht ab:\n    ' + rc + '\n    ' + ra);
    var sa = JSON.stringify(a.cars), sc = JSON.stringify(c.cars);
    if (sa !== sc) fail('fastForward(' + t + '): Endzustand der Autos weicht ab');
  });
  // result() in Startreihenfolge, Plätze 1..k lückenlos
  var res = a.result();
  if (res.length !== field.length) fail('result() hat ' + res.length + ' statt ' + field.length + ' Einträge');
  res.forEach(function (e, i) { if (e.id !== field[i].id) fail('result() nicht in Startreihenfolge: ' + e.id + ' an ' + i); });
  var places = res.map(function (e) { return e.place; }).filter(function (p) { return p !== null; }).sort(function (x, y) { return x - y; });
  places.forEach(function (p, i) { if (p !== i + 1) fail('Plätze nicht lückenlos: ' + JSON.stringify(places)); });
  if (!places.length) fail('niemand im Ziel');
  var st = a.standings();
  if (st.length !== field.length) fail('standings() hat falsche Länge');
})();

// ---- 4. Bilanz: Bus gegen 9 Sportwagen/Limousinen ----
var RACES = arg('--races', 1000);
var busWins = 0, strongWins = 0, dnfs = 0, finishers = 0, wtimes = [], incidents = { spin: 0, crash: 0, dnf: 0 };
var started = Date.now();
var rnd = mulberry32(2026);
for (var race = 0; race < RACES; race++) {
  var field = mixedField(rnd, 10, true);
  var strongest = null, best = -1;
  field.forEach(function (c) {
    if (c.id === 'bus') return;
    var r = c.raw, sum = r.power + r.speed + r.handling + r.susp + r.brakes - r.weight * 0.5 + (r.drive === 'awd' ? 1 : 0);
    if (sum > best) { best = sum; strongest = c.id; }
  });
  var seed = (race * 2654435761) >>> 1;
  var sim = run({ seed: seed, track: Sim.TRACKS[race % Sim.TRACKS.length], laps: 3, finishWindow: 15, cars: toSimCars(field) },
    'Bilanz-Rennen ' + race, race < 200);
  var res = sim.result();
  res.forEach(function (e) {
    if (e.place === 1 && e.id === 'bus') busWins++;
    if (e.place === 1 && e.id === strongest) strongWins++;
    if (e.place === null) dnfs++; else finishers++;
  });
  if (sim.counts) { incidents.spin += sim.counts.spins; incidents.crash += sim.counts.crashes; incidents.dnf += sim.counts.crashDnf; }
  wtimes.push(winnerTime(sim));
}
var secs = (Date.now() - started) / 1000;
wtimes.sort(function (a, b) { return a - b; });
var busPct = 100 * busWins / RACES, strongPct = 100 * strongWins / RACES;
if (busPct < 2) fail('Bus gewinnt nur ' + busPct.toFixed(1) + ' % (Soll ≥ 2 %)');
if (strongPct > 45) fail('stärkstes Auto gewinnt ' + strongPct.toFixed(1) + ' % (Soll ≤ 45 %)');

function report() {
  console.log('Strecken (TRACKS = [' + (Sim && Sim.TRACKS ? Sim.TRACKS.join(', ') : '') + ']):');
  trackInfo.forEach(function (l) { console.log(l); });
  if (typeof RACES !== 'undefined' && wtimes.length) {
    console.log('Bilanz ' + RACES + ' Rennen (' + secs.toFixed(1) + ' s): Bus gewinnt ' + busPct.toFixed(1) +
      ' %, stärkstes Auto ' + strongPct.toFixed(1) + ' %; DNF-Anteil ' + (100 * dnfs / (dnfs + finishers)).toFixed(1) +
      ' %; Siegerzeit Median ' + wtimes[Math.floor(wtimes.length / 2)].toFixed(1) + ' s (' + wtimes[0].toFixed(1) + '–' +
      wtimes[wtimes.length - 1].toFixed(1) + ' s); je Rennen ' + (incidents.spin / RACES).toFixed(2) + ' Dreher, ' +
      (incidents.crash / RACES).toFixed(2) + ' Crashs, ' + (incidents.dnf / RACES).toFixed(2) + ' Crash-DNF');
  }
  if (errors.length) {
    console.log('FAIL');
    errors.forEach(function (e) { console.log('- ' + e); });
    process.exit(1);
  }
  console.log('OK');
  process.exit(0);
}
report();
