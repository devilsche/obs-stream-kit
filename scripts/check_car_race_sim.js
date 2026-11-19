#!/usr/bin/env node
/* Prüfskript für js/car-race-sim.js (Car Race: Strecke + deterministische Fahrsimulation).
 * Kein Test-Framework: gibt „OK“ aus oder eine Fehlerliste, Exit-Code ≠ 0 bei Fehler.
 *
 *   node scripts/check_car_race_sim.js            alle Prüfungen (inkl. Bilanz über 1000 Rennen)
 *   node scripts/check_car_race_sim.js --races 200 Bilanz mit weniger Rennen (schneller beim Abstimmen)
 *   node scripts/check_car_race_sim.js --tracks    nur die Strecken prüfen und ihre Eigenschaften drucken
 *   node scripts/check_car_race_sim.js --seed 3    Bilanz mit anderer Stichprobe (Feld + Rennen-Seeds; Standard 2026)
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

// Läuft ein Rennen bis zum Ende; prüft unterwegs NaN, v ≤ vmax, |d| ≤ Fahrbahn + Auslauf, yaw/lap,
// Ereignisliste (Zeitreihenfolge, Überholmanöver ⇔ Positionswechsel), draft, Rückkehr nach Abflug
function run(opts, label, checkSteps) {
  var sim = Sim.create(opts);
  var half = sim.track.width / 2;
  var bad = false, still = opts.cars.map(function () { return 0; }), prevYaw = null, prevLap = null;
  var offT = opts.cars.map(function () { return 0; }), wasOff = opts.cars.map(function () { return false; });
  var info = { steerSum: 0, steerN: 0, steerMax: 0, offs: 0, returned: 0, offAtEnd: 0 };
  var ids = {}; opts.cars.forEach(function (c) { ids[c.id] = 1; });
  var evSeen = 0, prevOrder = sim.standings(), lastT = 0;
  while (!sim.done && sim.time < MAX_T) {
    var doneBefore = sim.done;
    sim.step();
    // festgefahren? Ein fahrbereites Auto steht nie länger als 8 s (Crash davor dauert höchstens 6 s)
    for (var i = 0; i < sim.cars.length; i++) {
      var c = sim.cars[i];
      if (c.state === 'run') { var as = Math.abs(c.steer); info.steerSum += as; info.steerN++; if (as > info.steerMax) info.steerMax = as; }
      still[i] = c.state === 'run' && c.v < 0.3 && sim.time > 3 ? still[i] + DT : 0;
      if (still[i] > 8 && !bad) { fail(label + ': Auto ' + c.id + ' steckt fest bei t=' + sim.time.toFixed(1)); bad = true; }
      // Abflug: neben der Fahrbahn höchstens 12 s, dann muss das Auto zurück sein
      var isOff = Math.abs(c.d) > half + 1e-9;
      if (isOff !== c.off && !bad) { fail(label + ': Auto ' + c.id + ' off=' + c.off + ' passt nicht zu d=' + c.d.toFixed(2)); bad = true; }
      offT[i] = isOff && c.state !== 'dnf' ? offT[i] + DT : 0;
      if (offT[i] > 12 && !bad) { fail(label + ': Auto ' + c.id + ' kommt nach Abflug nicht zurück (t=' + sim.time.toFixed(1) + ')'); bad = true; }
      if (wasOff[i] && !isOff) info.returned++;
      wasOff[i] = isOff;
    }
    // neue Ereignisse dieses Schritts
    var stepEv = sim.events.slice(evSeen);
    evSeen = sim.events.length;
    stepEv.forEach(function (e) {
      if (bad) return;
      if (Math.abs(e.t - sim.time) > 1e-3 || e.t < lastT) { fail(label + ': Ereignis ' + e.type + ' mit falscher Zeit ' + e.t + ' (Sim ' + sim.time.toFixed(3) + ')'); bad = true; }
      if (['overtake', 'spin', 'crash', 'off', 'oil', 'push', 'dnf'].indexOf(e.type) < 0) { fail(label + ': unbekanntes Ereignis ' + e.type); bad = true; }
      if (!ids[e.id] || (e.other !== undefined && (!ids[e.other] || e.other === e.id))) { fail(label + ': Ereignis ' + e.type + ' mit falscher id/other'); bad = true; }
      if (e.type === 'off') info.offs++;
      lastT = e.t;
    });
    // Überholmanöver ⇔ Positionswechsel (vor Rennende, ohne Ausgeschiedene)
    var order = sim.standings();
    if (checkSteps && !doneBefore && !bad) {
      var stateOf = {};
      sim.cars.forEach(function (c) { stateOf[c.id] = c.state; });
      var want = [];
      for (var a = 0; a < order.length; a++) {
        for (var b = a + 1; b < order.length; b++) {
          if (prevOrder.indexOf(order[a]) > prevOrder.indexOf(order[b]) && stateOf[order[a]] !== 'dnf' && stateOf[order[b]] !== 'dnf') want.push(order[a] + '>' + order[b]);
        }
      }
      var got = stepEv.filter(function (e) { return e.type === 'overtake'; }).map(function (e) { return e.id + '>' + e.other; });
      if (want.sort().join() !== got.sort().join()) { fail(label + ': Überholmanöver ' + JSON.stringify(got) + ' ≠ Positionswechsel ' + JSON.stringify(want) + ' bei t=' + sim.time.toFixed(2)); bad = true; }
      sim.cars.forEach(function (c) { if (order[c.pos - 1] !== c.id && !bad) { fail(label + ': pos von ' + c.id + ' passt nicht zu standings()'); bad = true; } });
    }
    prevOrder = order;
    // Ölflecken: höchstens 3, Felder gültig
    if (sim.hazards.length > 3 && !bad) { fail(label + ': ' + sim.hazards.length + ' Ölflecken (Soll ≤ 3)'); bad = true; }
    if (!checkSteps || bad) continue;
    sim.hazards.forEach(function (h) {
      if (!(h.s >= 0 && h.s < sim.track.len && Math.abs(h.d) <= half && h.r >= 1.5 && h.r <= 2.5 && h.from >= 0 && h.from <= sim.time + 1e-3) && !bad) {
        fail(label + ': ungültiger Ölfleck ' + JSON.stringify(h)); bad = true;
      }
    });
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
      var ro = sim.track.runoffAt(c.s), lim = half + (c.d > 0 ? ro.left : ro.right);
      if (Math.abs(c.d) > lim + 1e-6) { fail(label + ': Auto ' + c.id + ' d=' + c.d.toFixed(2) + ' hinter der Leitplanke (±' + lim.toFixed(2) + ')'); bad = true; break; }
      if (prevYaw && Math.abs(c.yaw - prevYaw[i]) > 0.5) { fail(label + ': Auto ' + c.id + ' yaw springt um ' + (c.yaw - prevYaw[i]).toFixed(2) + ' rad'); bad = true; break; }
      if (prevLap && c.lap < prevLap[i]) { fail(label + ': Auto ' + c.id + ' Runde zählt zurück'); bad = true; break; }
      if (c.draft !== null && (!ids[c.draft] || c.draft === c.id)) { fail(label + ': Auto ' + c.id + ' draft=' + c.draft); bad = true; break; }
    }
    prevYaw = sim.cars.map(function (c) { return c.yaw; });
    prevLap = sim.cars.map(function (c) { return c.lap; });
  }
  if (!sim.done) fail(label + ': Rennen nach ' + MAX_T + ' s nicht fertig');
  if (!sim.cars.some(function (c) { return c.place !== null; })) fail(label + ': niemand im Ziel');
  var railIds = {};
  sim.events.forEach(function (e) { if (e.type === 'crash' && e.rail) railIds[e.id] = 1; });
  sim.cars.forEach(function (c) { if (c.off && !railIds[c.id]) info.offAtEnd++; });
  info.rails = Object.keys(railIds).length;
  if (info.returned !== info.offs - info.rails - info.offAtEnd) fail(label + ': ' + info.returned + ' von ' + info.offs + ' Abflügen kehren zurück (' + info.rails + ' Leitplanke, ' + info.offAtEnd + ' bei Rennende draußen)');
  sim.checkInfo = info;
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
  if (!(t.len >= 280 && t.len <= 500)) probs.push('Länge ' + t.len.toFixed(1) + ' m nicht in 280–500');
  if (t.width !== 10) probs.push('Breite ' + t.width + ' statt 10');
  var half = t.width / 2, minR = Infinity;
  for (var s = 0; s < t.len; s += 0.5) minR = Math.min(minR, t.radiusAt(s));
  if (!(minR >= 12)) probs.push('kleinster Radius ' + minR.toFixed(1) + ' m < 12');
  // Kurven unabhängig von t.corners nachzählen: zusammenhängende Abschnitte mit |curv| > 1/60
  var step = 0.5, n = Math.round(t.len / step), kinds = [], turn = 0;
  for (var i = 0; i < n; i++) {
    var cv = t.at(i * step).curv;
    turn += cv * step;
    kinds.push(Math.abs(cv) > 1 / 60 ? (cv > 0 ? 1 : -1) : 0);
  }
  var main = turn > 0 ? 1 : -1, s0 = 0;
  while (s0 < n && kinds[s0] === kinds[(s0 - 1 + n) % n]) s0++;
  var secs = [], cur = null;
  for (i = 0; i < n; i++) {
    var kd = kinds[(s0 + i) % n];
    if (!cur || cur.k !== kd) { cur = { k: kd, len: 0, minR: Infinity, i0: (s0 + i) % n }; secs.push(cur); }
    cur.len += step;
    cur.minR = Math.min(cur.minR, t.radiusAt(((s0 + i) % n) * step));
  }
  var counter = secs.filter(function (x) { return x.k === -main; }).length;
  var corners = secs.filter(function (x) { return x.k !== 0; }).length;
  var tight = secs.filter(function (x) { return x.k !== 0 && x.minR <= 20; }).length;
  var straight = Math.max.apply(null, secs.filter(function (x) { return x.k === 0; }).map(function (x) { return x.len; }).concat([0]));
  if (Math.abs(Math.abs(turn) - 2 * Math.PI) > 0.2) probs.push('Gesamtdrehung ' + turn.toFixed(2) + ' rad statt ±2π');
  if (counter < 2) probs.push(counter + ' Kurven gegen die Hauptdrehrichtung (Soll ≥ 2)');
  if (tight < 1) probs.push('keine enge Kurve (R ≤ 20 m)');
  if (straight < 60) probs.push('längste Gerade ' + straight.toFixed(0) + ' m (Soll ≥ 60)');
  // Auslauf je Seite 0–12 m, mindestens 2 m; keine Überschneidung inkl. Fahrbahn + Auslauf:
  // kein Punkt der Fahrbahn oder des Auslaufs (bis zur Leitplanke) liegt auf der Fahrbahn oder im Auslauf
  // eines entlang der Strecke weit entfernten Abschnitts
  var minRun = Infinity, maxRun = 0, P = [];
  var stepC = 1, nc = Math.floor(t.len / stepC);
  for (i = 0; i < nc; i++) {
    var a = t.at(i * stepC);
    minRun = Math.min(minRun, a.runL, a.runR); maxRun = Math.max(maxRun, a.runL, a.runR);
    P.push(a);
  }
  if (minRun < 2) probs.push('Auslauf nur ' + minRun.toFixed(1) + ' m (Soll ≥ 2)');
  if (maxRun > 12 + 1e-9) probs.push('Auslauf ' + maxRun.toFixed(1) + ' m (Soll ≤ 12)');
  var overlap = 0, minD = Infinity;
  for (i = 0; i < nc && overlap < 1; i++) {
    for (var j = 0; j < nc; j++) {
      var along = Math.min(Math.abs(i - j), nc - Math.abs(i - j)) * stepC;
      if (along < 30) continue;
      var pj = P[j];
      minD = Math.min(minD, Math.hypot(P[i].x - pj.x, P[i].z - pj.z));
      // Querschnitt von i (Leitplanke links bis Leitplanke rechts) gegen das Band von j (Fahrbahn + Auslauf)
      for (var off = -(half + P[i].runR) + 0.25; off < half + P[i].runL - 0.25; off += 1) {
        var qx = P[i].x + P[i].nx * off, qz = P[i].z + P[i].nz * off;
        var dx = qx - pj.x, dz = qz - pj.z, lat = dx * pj.nx + dz * pj.nz, lon = dx * pj.nz - dz * pj.nx;
        if (Math.abs(lon) < 0.5 && lat < half + pj.runL - 0.25 && lat > -(half + pj.runR) + 0.25) { overlap++; break; }
      }
    }
  }
  if (overlap) probs.push('Fahrbahn/Auslauf überschneidet sich');
  // Durchschnittsfeld, 3 Runden: Sieger im Ziel nach 45–75 s
  var times = [];
  for (var k = 0; k < 3; k++) {
    var sim = run({ seed: 1000 + k * 77, track: seed, laps: 3, finishWindow: 15, cars: avgField(10) }, 'Strecke ' + seed, true);
    times.push(winnerTime(sim));
  }
  times.forEach(function (wt) { if (!(wt >= 45 && wt <= 75)) probs.push('Siegerzeit ' + wt.toFixed(1) + ' s nicht in 45–75'); });
  return { probs: probs, len: t.len, minR: minR, minD: minD, times: times, corners: corners, counter: counter, tight: tight,
    straight: straight, minRun: minRun, name: t.name, character: t.character };
}
function trackLine(seed, r) {
  return '  Strecke ' + seed + ' ' + r.name + ' (' + r.character + '): ' + r.len.toFixed(0) + ' m, ' + r.corners + ' Kurven, davon ' +
    r.counter + ' gegen die Drehrichtung, ' + r.tight + ' eng (R ≤ 20), min. Radius ' + r.minR.toFixed(1) + ' m, längste Gerade ' +
    r.straight.toFixed(0) + ' m, Auslauf ≥ ' + r.minRun.toFixed(1) + ' m, Siegerzeit Durchschnittsfeld ' +
    r.times.map(function (x) { return x.toFixed(1); }).join('/') + ' s';
}

if (args.indexOf('--tracks') >= 0) {
  Sim.TRACKS.forEach(function (sd) { var r = checkTrack(sd); console.log(trackLine(sd, r) + (r.probs.length ? '  -- ' + r.probs.join('; ') : '')); });
  process.exit(0);
}

// ---- 1. Grundlagen ----
['rng', 'track', 'stats', 'create'].forEach(function (f) {
  if (typeof Sim[f] !== 'function') fail('CarRaceSim.' + f + ' fehlt');
});
if (!Array.isArray(Sim.TRACKS) || Sim.TRACKS.length !== 3) fail('CarRaceSim.TRACKS braucht genau 3 Strecken');
(function () {   // neue Ausgaben vorhanden?
  var t = Sim.track(Sim.TRACKS ? Sim.TRACKS[0] : 1);
  if (typeof t.runoffAt !== 'function' || !t.runoff || !Array.isArray(t.corners)) fail('track() liefert kein runoffAt/runoff/corners');
  var sm = Sim.create({ seed: 1, track: t.seed, laps: 3, finishWindow: 15, cars: avgField(3) });
  if (!Array.isArray(sm.events) || !Array.isArray(sm.hazards)) fail('sim.events / sim.hazards fehlen');
  if (!('draft' in sm.cars[0]) || !('off' in sm.cars[0])) fail('cars[i].draft / cars[i].off fehlen');
  if (!(Sim.stats({}).mass > 0)) fail('stats().mass fehlt');
})();
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
var chars = {};
Sim.TRACKS.forEach(function (seed) {
  var r = checkTrack(seed);
  trackInfo.push(trackLine(seed, r));
  r.probs.forEach(function (p) { fail('Strecke ' + seed + ': ' + p); });
  chars[r.character] = 1;
});
['fast', 'twisty', 'hairpin'].forEach(function (ch) { if (!chars[ch]) fail('keine Strecke mit Charakter ' + ch); });

// ---- 3. Determinismus + fastForward ----
function mixedField(rnd, n, withBus) {
  var cars = [];
  for (var i = 0; i < n; i++) {
    var raw;
    if (withBus && i === 0) raw = BUS;
    else {
      raw = {
        // Zufallsauto aus dem Katalog: jeder Wert gleichverteilt 3–9
        power: 3 + Math.floor(rnd() * 7), speed: 3 + Math.floor(rnd() * 7), handling: 3 + Math.floor(rnd() * 7),
        susp: 3 + Math.floor(rnd() * 7), brakes: 3 + Math.floor(rnd() * 7), weight: 3 + Math.floor(rnd() * 7),
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
  if (JSON.stringify(a.events) !== JSON.stringify(b.events)) fail('gleicher Seed ergibt unterschiedliche Ereignisse');
  if (!a.events.length) fail('Ereignisliste leer');
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
    if (JSON.stringify(a.events) !== JSON.stringify(c.events)) fail('fastForward(' + t + '): Ereignisliste weicht ab');
    if (JSON.stringify(a.hazards) !== JSON.stringify(c.hazards)) fail('fastForward(' + t + '): Ölflecken weichen ab');
  });
  // result() in Startreihenfolge, Plätze 1..k lückenlos
  var res = a.result();
  if (res.length !== field.length) fail('result() hat ' + res.length + ' statt ' + field.length + ' Einträge');
  res.forEach(function (e, i) { if (e.id !== field[i].id) fail('result() nicht in Startreihenfolge: ' + e.id + ' an ' + i); });
  var places = res.map(function (e) { return e.place; }).filter(function (p) { return p !== null; }).sort(function (x, y) { return x - y; });
  places.forEach(function (p, i) { if (p !== i + 1) fail('Plätze nicht lückenlos: ' + JSON.stringify(places)); });
  if (!places.length) fail('niemand im Ziel');
  var st = a.standings();
  // nach Rennende kommen keine Ereignisse mehr dazu (Autos rollen nur aus)
  var nEv = a.events.length;
  for (var k = 0; k < 180; k++) a.step();
  if (a.events.length !== nEv) fail('nach Rennende kommen noch Ereignisse: ' + JSON.stringify(a.events.slice(nEv, nEv + 3)));
  if (st.length !== field.length) fail('standings() hat falsche Länge');
})();

// ---- 4. Bilanz: Bus gegen 9 Zufallsautos (Werte je 3–9, jedes Rennen neu) ----
var RACES = arg('--races', 1000);
var busWins = 0, strongWins = 0, dnfs = 0, finishers = 0, wtimes = [], incidents = { spin: 0, crash: 0, dnf: 0 };
var X = { steerSum: 0, steerN: 0, steerMax: 0, offs: 0, rails: 0, returned: 0, offAtEnd: 0, pushes: 0, oilHits: 0, overtakes: 0, randomOil: 0, oilSpots: 0, maxOil: 0,
  busPush: [], busPushed: [], busLoss: [], busLost: [], draftSteps: 0 };
var started = Date.now();
var BSEED = arg('--seed', 2026), rnd = mulberry32(BSEED);
for (var race = 0; race < RACES; race++) {
  var field = mixedField(rnd, 10, true);
  var strongest = null, best = -1;
  field.forEach(function (c) {
    if (c.id === 'bus') return;
    // Wertesumme; Gewicht zählt umgekehrt (schwer = schlechter), also 12 − weight
    var r = c.raw, sum = r.power + r.speed + r.handling + r.susp + r.brakes + (12 - r.weight);
    if (sum > best) { best = sum; strongest = c.id; }
  });
  var seed = ((race + (BSEED - 2026) * 100003) * 2654435761) >>> 1;
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
  X.offs += sim.counts.offs; X.rails += sim.counts.rails; X.pushes += sim.counts.pushes; X.oilHits += sim.counts.oilHits;
  X.steerSum += sim.checkInfo.steerSum; X.steerN += sim.checkInfo.steerN; X.steerMax = Math.max(X.steerMax, sim.checkInfo.steerMax);
  X.returned += sim.checkInfo.returned; X.offAtEnd += sim.checkInfo.offAtEnd;
  if (sim.hazards.some(function (h) { return h.src === 'track'; })) X.randomOil++;
  X.oilSpots += sim.hazards.length; X.maxOil = Math.max(X.maxOil, sim.hazards.length);
  sim.events.forEach(function (e) {
    if (e.type === 'overtake') X.overtakes++;
    if (e.type !== 'push') return;
    // Bus beteiligt: Schub/Tempoverlust des anderen Autos gegen den des Busses
    if (e.other === 'bus') { X.busPush.push(e.push); X.busPushed.push(e.pushOther); X.busLoss.push(e.loss); X.busLost.push(e.lossOther); }
    else if (e.id === 'bus') { X.busPush.push(e.pushOther); X.busPushed.push(e.push); X.busLoss.push(e.lossOther); X.busLost.push(e.loss); }
  });
}
var secs = (Date.now() - started) / 1000;
wtimes.sort(function (a, b) { return a - b; });
var busPct = 100 * busWins / RACES, strongPct = 100 * strongWins / RACES;
if (busPct < 1) fail('Bus gewinnt nur ' + busPct.toFixed(1) + ' % (Soll ≥ 1 %)');
if (strongPct > 45 || strongPct < 20) fail('stärkstes Auto gewinnt ' + strongPct.toFixed(1) + ' % (Soll 20–45 %)');
if (incidents.crash / RACES > 1.2) fail((incidents.crash / RACES).toFixed(2) + ' Crashs je Rennen inkl. Leitplanke (Soll ≤ 1,2)');
function mean(A) { return A.length ? A.reduce(function (x, y) { return x + y; }, 0) / A.length : 0; }
// Abflüge kommen vor und die Autos kehren zurück (wer nicht in der Leitplanke landet)
if (X.offs / RACES <= 0.2) fail('nur ' + (X.offs / RACES).toFixed(2) + ' Abflüge je Rennen (Soll > 0,2)');
if (X.returned !== X.offs - X.rails - X.offAtEnd) fail(X.returned + ' von ' + X.offs + ' Abflügen kehren zurück (' + X.rails + ' Leitplanke, ' + X.offAtEnd + ' bei Rennende draußen)');
// Ölflecken: Zufallsfleck in 50–70 % der Rennen, nie mehr als 3
var oilPct = 100 * X.randomOil / RACES;
if (oilPct < 50 || oilPct > 70) fail('Zufalls-Ölfleck in ' + oilPct.toFixed(1) + ' % der Rennen (Soll 50–70 %)');
if (X.maxOil > 3) fail(X.maxOil + ' Ölflecken in einem Rennen (Soll ≤ 3)');
// Kontakt-Asymmetrie: der Bus schubst Kleinwagen deutlich weiter weg als umgekehrt und verliert kaum Tempo
if (X.busPush.length < 20) fail('nur ' + X.busPush.length + ' Kontakte mit dem Bus (Soll ≥ 20 für die Asymmetrie-Prüfung)');
else {
  if (!(mean(X.busPush) >= 3 * mean(X.busPushed))) fail('Bus schubst ' + mean(X.busPush).toFixed(2) + ' m/s, wird geschubst ' + mean(X.busPushed).toFixed(2) + ' m/s (Soll ≥ 3×)');
  if (!(mean(X.busLoss) >= 2 * mean(X.busLost))) fail('Tempoverlust durch den Bus ' + mean(X.busLoss).toFixed(2) + ' m/s, des Busses ' + mean(X.busLost).toFixed(2) + ' m/s (Soll ≥ 2×)');
}

// ---- 5. Werte wirken: ein Auto mit lauter 10ern gegen neun mit lauter 5ern ----
var TOP = { power: 10, speed: 10, handling: 10, susp: 10, brakes: 10, weight: 1, drive: 'awd', len: 4.5 };
var PROBE = Math.max(100, Math.round(RACES / 5)), topWins = 0;
for (race = 0; race < PROBE; race++) {
  var pc = avgField(10), slot = race % 10;
  pc[slot] = { id: 'top', stats: Sim.stats(TOP) };
  var ps = run({ seed: race * 7919 + 1, track: Sim.TRACKS[race % Sim.TRACKS.length], laps: 3, finishWindow: 15, cars: pc }, 'Probe ' + race, false);
  ps.result().forEach(function (e) { if (e.id === 'top' && e.place === 1) topWins++; });
}
var topPct = 100 * topWins / PROBE;
if (topPct < 35) fail('lauter 10er gegen neun 5er gewinnt nur ' + topPct.toFixed(1) + ' % (Soll ≥ 35 %)');

/* Race-stats-Schätzung (js/car-race-stats.js): Klassen und gültige Bereiche */
var Stats = require(path.join(__dirname, '..', 'js', 'car-race-stats.js'));
var FIX = [
  { key: 'trolza', name: 'Trolza 5265.00 "Megapolis"', brand: 'Trolza', len: 12 },
  { key: 'lambo', name: 'Lamborghini Aventador', brand: 'Lamborghini', len: 4.8 },
  { key: 'hoon', name: 'Hoonicorn- A tribute to Ken Block (Updated)', brand: 'Ford', len: 4.4 },
  { key: 'ural', name: 'Ural-4320', brand: 'Ural', len: 7.6 },
  { key: 'krabby', name: 'Krabby Patty Wagon', brand: 'Fun', len: 4 },
  { key: 'm5', name: '2003 BMW M5', brand: 'BMW', len: 4.9 },
  { key: 'golf', name: 'VW Golf', brand: 'VW' }
];
var G = {};
FIX.forEach(function (e) {
  var g = G[e.key] = Stats.guess(e);
  Stats.KEYS.forEach(function (k) { if (!(g[k] >= 1 && g[k] <= 10)) fail('guess ' + e.key + '.' + k + ' = ' + g[k] + ' außerhalb 1–10'); });
  if (['fwd', 'rwd', 'awd'].indexOf(g.drive) < 0) fail('guess ' + e.key + ' drive ' + g.drive);
  if (!(g.len >= 2 && g.len <= 20)) fail('guess ' + e.key + ' len ' + g.len);
  if (g.on !== true) fail('guess ' + e.key + ' on ≠ true');
});
if (!(G.trolza.speed <= 3 && G.trolza.weight >= 9)) fail('Trolza: speed ≤ 3 und weight ≥ 9 erwartet');
if (!(G.lambo.speed >= 9)) fail('Lamborghini: speed ≥ 9 erwartet');
if (G.hoon.power !== 10) fail('Hoonicorn: power = 10 erwartet');
var CAND = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'assets', 'cars', 'candidates.json'), 'utf8'));
if (CAND.length < 100) fail('assets/cars/candidates.json zu klein: ' + CAND.length);
CAND.forEach(function (e) {
  var g = Stats.guess({ key: e.key || e.uid, name: e.name, brand: e.brand, len: e.len });
  Stats.KEYS.forEach(function (k) { if (!(g[k] >= 1 && g[k] <= 10)) fail('Katalog "' + e.name + '": ' + k + ' = ' + g[k]); });
  if (['fwd', 'rwd', 'awd'].indexOf(g.drive) < 0) fail('Katalog "' + e.name + '": drive ' + g.drive);
  if (!(g.len >= 2 && g.len <= 20)) fail('Katalog "' + e.name + '": len ' + g.len);
});
function gn(name, brand) { return Stats.guess({ key: 'x', name: name, brand: brand || '' }); }
var p918 = gn('Porsche 918 Spyder 2015', 'Porsche'), w14 = gn('Amg W14 S1', 'Mercedes-Benz'), g63 = gn('Mersedes-Benz G63 AMG', 'Mercedes-Benz');
if (!(p918.speed >= 9 && p918.weight <= 3)) fail('Porsche 918: Hypercar erwartet');
if (!(w14.speed >= 9 && w14.weight <= 3)) fail('AMG W14: Hypercar erwartet');
if (!(g63.weight >= 7 && g63.handling <= 4 && g63.speed >= 5 && g63.speed <= 7)) fail('G63: schwerer SUV erwartet');
if (gn('Ferrari F40', 'Ferrari').drive !== 'rwd') fail('Ferrari: rwd erwartet');
if (gn('Toyota Hilux Pickup', 'Toyota').weight !== 5 || gn('Kia Sportage', 'Kia').speed !== 5) fail('Pickup/Sportage dürfen nicht Kleinwagen/Sport sein');
if (G.golf.len !== 4.5) fail('Golf ohne len: Rückfall 4,5 erwartet');

if (X.steerN) {
  var steerMean = X.steerSum / X.steerN;
  if (!(steerMean < 0.15)) fail('Lenkwinkel: Mittel |steer| ' + steerMean.toFixed(3) + ' rad (Soll < 0,15)');
  if (!(X.steerMax <= 0.42 + 1e-9)) fail('Lenkwinkel: Maximum ' + X.steerMax.toFixed(3) + ' rad (Soll ≤ 0,42)');
  console.log('Lenkwinkel (fahrende Autos): Mittel |steer| ' + steerMean.toFixed(3) + ' rad, Maximum ' + X.steerMax.toFixed(3) + ' rad');
}

function report() {
  console.log('Strecken (TRACKS = [' + (Sim && Sim.TRACKS ? Sim.TRACKS.join(', ') : '') + ']):');
  (trackInfo || []).forEach(function (l) { console.log(l); });
  if (typeof RACES !== 'undefined' && wtimes.length) {
    console.log('Bilanz ' + RACES + ' Rennen (' + secs.toFixed(1) + ' s): Bus gewinnt ' + busPct.toFixed(1) +
      ' %, stärkstes Auto ' + strongPct.toFixed(1) + ' %; DNF-Anteil ' + (100 * dnfs / (dnfs + finishers)).toFixed(1) +
      ' %; Siegerzeit Median ' + wtimes[Math.floor(wtimes.length / 2)].toFixed(1) + ' s (' + wtimes[0].toFixed(1) + '–' +
      wtimes[wtimes.length - 1].toFixed(1) + ' s); 10er gegen 5er: ' + (typeof topPct === 'number' ? topPct.toFixed(1) : '–') + ' %; je Rennen ' + (incidents.spin / RACES).toFixed(2) + ' Dreher, ' +
      (incidents.crash / RACES).toFixed(2) + ' Crashs (davon ' + (X.rails / RACES).toFixed(2) + ' Leitplanke), ' + (incidents.dnf / RACES).toFixed(2) + ' Crash-DNF');
    console.log('Zwischenfälle je Rennen: ' + (X.offs / RACES).toFixed(2) + ' Abflüge (' + X.returned + ' zurück, ' + X.rails + ' Leitplanke, ' + X.offAtEnd +
      ' bei Rennende draußen), ' + (X.pushes / RACES).toFixed(2) + ' Kontakte, ' + (X.oilHits / RACES).toFixed(2) + ' Ölkontakte, ' +
      (X.overtakes / RACES).toFixed(1) + ' Überholmanöver; Zufalls-Ölfleck in ' + (100 * X.randomOil / RACES).toFixed(1) + ' % der Rennen, ' +
      (X.oilSpots / RACES).toFixed(2) + ' Flecken je Rennen (max. ' + X.maxOil + ')');
    console.log('Kontakte mit dem Bus (' + X.busPush.length + '): Schub auf das andere Auto ' + mean(X.busPush).toFixed(2) + ' m/s, auf den Bus ' +
      mean(X.busPushed).toFixed(2) + ' m/s; Tempoverlust ' + mean(X.busLoss).toFixed(2) + ' / ' + mean(X.busLost).toFixed(2) + ' m/s');
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
