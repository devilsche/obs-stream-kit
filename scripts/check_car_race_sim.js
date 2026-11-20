#!/usr/bin/env node
/* Prüfskript für js/car-race-sim.js (Car Race: Strecke + deterministische Fahrsimulation).
 * Kein Test-Framework: gibt „OK“ aus oder eine Fehlerliste, Exit-Code ≠ 0 bei Fehler.
 *
 *   node scripts/check_car_race_sim.js            alle Prüfungen (inkl. Rundenpace, Bilanz über 1000 Rennen + Golf-Probe über 1000)
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
var OVERLAP_TOL = 0.1;   // Wrack-Überlappung: höchstens 10 cm (längs und quer)
var busInfo = '';
var overlapChecked = {}; // Rennen, in denen mindestens ein Wrack stand (Überlappung geprüft)
var MAX_T = 205;
// Chatrennen-Format (fx/race.py LAPS / FINISH_WINDOW): 2 Runden auf den langen Strecken, Ziel-Frist 25 s
var LAPS = 2, FW = 25;
// Seltene Fälle (festgefahren > 8 s) in Bilanz/Probe: höchstens RARE_MAX je 1000 Rennen (Controller-Entscheidung);
// überall sonst sind sie ein Fehler
var RARE_MAX = 3, rareCases = [];
function rare(label, msg) {
  if (/^(Bilanz-Rennen|Probe) /.test(label)) rareCases.push(msg); else fail(msg);
}   // Sicherheitsnetz: die Sim muss nach spätestens 90 s selbst fertig sein

// Eigener Zufall fürs Prüfskript (Feldzusammensetzung), unabhängig von der Sim
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

var Stats = require(path.join(__dirname, '..', 'js', 'car-race-stats.js'));
// Bezugsauto (echte Werte = CarRaceSim.REF → genau die Simulations-Grundwerte) und Bus aus der Tabelle
var AVG = { vmax: 300, acc: 3.5, hp: 600, kg: 1500, grip: 1.1, brake: 1.3, drive: 'rwd', len: 4.5 };
// Katalogautos aus der Tabelle; Länge je Auto (Katalog-len liegt nur auf dem Server, sonst 4,5 m)
var LEN = { 'trolza-5265-00-megapolis': 12, 'caterpillar-ct680': 8, 'ural-4320-soviet-army-truck': 7.6, 'amg-w14-s1': 5.4,
  'volkswagen-golf-gti-1976': 3.8, 'krabby-patty-wagon': 4 };
function carRaw(key) { var r = Stats.guess({ key: key }); r.len = LEN[key] || 4.5; return r; }
var BUS_KEY = 'trolza-5265-00-megapolis', W14_KEY = 'amg-w14-s1', GOLF_KEY = 'volkswagen-golf-gti-1976';
var BUS = carRaw(BUS_KEY);
var TKEYS = Object.keys(Stats.TABLE);
var RACECARS = /w14|917k|rsr|296-gt3|992-gt3-r|dtm/;
// Zufallsfeld: alle Tabellenautos ohne Bus/Truck/Ural/Krabby
var POOL = TKEYS.filter(function (k) { return !/trolza|caterpillar|ural|krabby/.test(k); });
// Straßensportwagen (W14-Probe): Straßenautos ab 270 km/h; Supersportwagen (Golf-Probe): ab 320 km/h
var ROAD = POOL.filter(function (k) { return !RACECARS.test(k) && Stats.TABLE[k].vmax >= 270; });
var SUPER = POOL.filter(function (k) { return !RACECARS.test(k) && Stats.TABLE[k].vmax >= 320; });

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
  var wreckPos = opts.cars.map(function () { return null; });
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
      if (still[i] > 8 && !bad) { rare(label, label + ': Auto ' + c.id + ' steckt fest bei t=' + sim.time.toFixed(1)); bad = true; }
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
    // Wracks: fest (bewegen sich nur bei einem Schubser), keine Überlappung mit anderen Autos
    // (in jedem Rennen, auch über die ganze Bilanz – geprüft werden nur Paare mit einem Wrack)
    if (!bad) {
      var pushed = null, W = [];
      for (i = 0; i < sim.cars.length; i++) {
        c = sim.cars[i];
        if (c.wreck !== (c.burn !== null) || (c.burn !== null && c.burn > sim.time + 1e-3)) { fail(label + ': Auto ' + c.id + ' wreck/burn passen nicht (' + c.wreck + '/' + c.burn + ')'); bad = true; break; }
        var wp = wreckPos[i];
        if (wp && c.v === 0 && (Math.abs(c.s - wp.s) > 1e-9 || Math.abs(c.d - wp.d) > 1e-9)) {
          // ein Schubser wirkt bis zu 1,5 s nach (Schub klingt ab)
          if (!pushed) {
            pushed = {};
            for (var q = sim.events.length - 1; q >= 0 && sim.events[q].t > sim.time - 1.5; q--) {
              if (sim.events[q].type === 'push') { pushed[sim.events[q].id] = 1; pushed[sim.events[q].other] = 1; }
            }
          }
          if (!pushed[c.id]) { fail(label + ': Wrack ' + c.id + ' bewegt sich ohne Schubser bei t=' + sim.time.toFixed(2)); bad = true; break; }
        }
        wreckPos[i] = c.wreck && c.v === 0 ? { s: c.s, d: c.d } : null;
        if (c.wreck || ((c.state === 'spin' || c.state === 'crash') && c.v < 1)) W.push(i);
      }
      if (W.length) overlapChecked[label] = 1;
      W.forEach(function (wi) {
        for (var j2 = 0; j2 < sim.cars.length && !bad; j2++) {
          if (j2 === wi) continue;
          var a1 = sim.cars[wi], a2 = sim.cars[j2], L2 = sim.track.len;
          var g2 = ((a2.s - a1.s) % L2 + L2 * 1.5) % L2 - L2 / 2;
          var lon = (opts.cars[wi].stats.len + opts.cars[j2].stats.len) / 2 - Math.abs(g2);
          var lat = (Sim.carWidth(opts.cars[wi].stats.len) + Sim.carWidth(opts.cars[j2].stats.len)) / 2 - Math.abs(a1.d - a2.d);
          if (lon > OVERLAP_TOL && lat > OVERLAP_TOL) {
            fail(label + ': ' + a2.id + ' überlappt Wrack ' + a1.id + ' (' + lon.toFixed(2) + ' × ' + lat.toFixed(2) + ' m) bei t=' + sim.time.toFixed(2)); bad = true;
          }
        }
      });
    }
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
      var nums = [c.s, c.d, c.v, c.x, c.z, c.yaw, c.roll, c.pitch, c.steer, c.spin];
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
  // Ausnahme: Rennen mit einem erlaubten seltenen Fall (festgefahren) – wer sich durch den Auslauf quetscht, ist neben
  // der Fahrbahn ohne 'off'-Ereignis; das zählt schon als seltener Fall
  if (info.returned !== info.offs - info.rails - info.offAtEnd && !(bad && /^(Bilanz-Rennen|Probe) /.test(label))) fail(label + ': ' + info.returned + ' von ' + info.offs + ' Abflügen kehren zurück (' + info.rails + ' Leitplanke, ' + info.offAtEnd + ' bei Rennende draußen)');
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
  // lange Strecken 1000–1400 m, Breite 10 m; Kart kurz (380–500 m), schmal (8 m) und eng (Radien ab 8 m)
  var kart = t.character === 'kart', LEN_R = kart ? [380, 500] : [1000, 1400], WANT_W = kart ? 8 : 10, MIN_R = kart ? 8 : 12;
  if (!(t.len >= LEN_R[0] && t.len <= LEN_R[1])) probs.push('Länge ' + t.len.toFixed(1) + ' m nicht in ' + LEN_R.join('–'));
  if (t.width !== WANT_W) probs.push('Breite ' + t.width + ' statt ' + WANT_W);
  var half = t.width / 2, minR = Infinity;
  for (var s = 0; s < t.len; s += 0.5) minR = Math.min(minR, t.radiusAt(s));
  if (!(minR >= MIN_R - 0.1)) probs.push('kleinster Radius ' + minR.toFixed(1) + ' m < ' + MIN_R);
  if (kart && !(minR <= 10)) probs.push('Kart ohne enge Kehre (kleinster Radius ' + minR.toFixed(1) + ' m, Soll ≤ 10)');
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
  if (minRun < 1.95) probs.push('Auslauf nur ' + minRun.toFixed(1) + ' m (Soll ≥ 2)');
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
  // Durchschnittsfeld, 2 Runden: Sieger im Ziel nach 120–155 s (≈ 2:20), Kart 60–90 s
  var times = [];
  for (var k = 0; k < 3; k++) {
    var sim = run({ seed: 1000 + k * 77, track: seed, laps: LAPS, finishWindow: FW, cars: avgField(10) }, 'Strecke ' + seed, true);
    times.push(winnerTime(sim));
  }
  var WT = kart ? [60, 90] : [120, 155];
  times.forEach(function (wt) { if (!(wt >= WT[0] && wt <= WT[1])) probs.push('Siegerzeit ' + wt.toFixed(1) + ' s nicht in ' + WT.join('–')); });
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
if (!Array.isArray(Sim.TRACKS) || Sim.TRACKS.length !== 5) fail('CarRaceSim.TRACKS braucht genau 5 Strecken');
(function () {   // neue Ausgaben vorhanden?
  var t = Sim.track(Sim.TRACKS ? Sim.TRACKS[0] : 1);
  if (typeof t.runoffAt !== 'function' || !t.runoff || !Array.isArray(t.corners)) fail('track() liefert kein runoffAt/runoff/corners');
  var sm = Sim.create({ seed: 1, track: t.seed, laps: LAPS, finishWindow: FW, cars: avgField(3) });
  if (!Array.isArray(sm.events) || !Array.isArray(sm.hazards)) fail('sim.events / sim.hazards fehlen');
  if (!('draft' in sm.cars[0]) || !('off' in sm.cars[0])) fail('cars[i].draft / cars[i].off fehlen');
  if (!(Sim.stats({}).mass > 0)) fail('stats().mass fehlt');
})();
if (errors.length) report();

// echte Werte: Bezugsauto = Grundwerte, REAL 0 = alle gleich, mehr Haftung/Leistung = mehr Kurventempo/Beschleunigung
if (!(Sim.REAL === 0.5)) fail('CarRaceSim.REAL = ' + Sim.REAL + ' (Standard 0,5)');
var def = Sim.stats({}), ref = Sim.stats(AVG);
['acc', 'vmax', 'grip', 'brake', 'launch', 'len'].forEach(function (k) {
  if (Math.abs(def[k] - ref[k]) > 1e-9) fail('stats({}) weicht bei ' + k + ' vom Bezugsauto ab');
});
(function () {
  var b0 = Sim.stats(BUS, 0), w0 = Sim.stats(carRaw(W14_KEY), 0);
  ['acc', 'vmax', 'grip', 'brake'].forEach(function (k) { if (Math.abs(b0[k] - w0[k]) > 1e-9) fail('REAL 0: ' + k + ' von Bus und W14 nicht gleich'); });
  var b = Sim.stats(BUS), w = Sim.stats(carRaw(W14_KEY)), b1 = Sim.stats(BUS, 1);
  ['acc', 'vmax', 'grip', 'brake'].forEach(function (k) {
    if (!(w[k] > ref[k] && ref[k] > b[k])) fail('stats: ' + k + ' nicht W14 > Bezug > Bus');
    if (!(b1[k] < b[k])) fail('REAL 1: Bus-' + k + ' nicht schlechter als bei REAL 0,5');
  });
  if (!(b.mass > 3 * ref.mass)) fail('Bus-Masse ' + b.mass.toFixed(1) + ' nicht > 3 × Bezugsauto');
  var hi = Sim.stats({ grip: 1.3 }), lo = Sim.stats({ grip: 0.8 });
  if (!(hi.grip > ref.grip && ref.grip > lo.grip)) fail('grip wirkt nicht monoton');
  var t = Sim.track(Sim.TRACKS[1]);
  if (!(Sim.lapTime(w, t) < Sim.lapTime(ref, t) && Sim.lapTime(ref, t) < Sim.lapTime(b, t))) fail('lapTime: nicht W14 < Bezug < Bus');
})();
// Rundenpace (Nutzer-Kompromiss Task 9: „ein Bus fährt eben nicht so schnell wie ein Lambo“, aber mit kleiner
// Außenseiter-Chance), Mittel über alle Strecken: Bus 8–16 % langsamer als Countach und Diablo (lange Strecken: mehr
// Gerade, und die Kart-Kehren kosten den 12-m-Bus zusätzlich – vorher 8–13 %), Ural/CT680 im Bereich
// des Busses, Golf GTI Mk1 3–6 % langsamer als das Mittel der Supersportwagen, W14 ≥ 8 % schneller
function paceOf(key) {
  var st = Sim.stats(carRaw(key));
  return Sim.TRACKS.reduce(function (a, sd) { return a + Sim.lapTime(st, Sim.track(sd)); }, 0) / Sim.TRACKS.length;
}
var PACE = {}, superAvg = SUPER.reduce(function (a, k) { return a + paceOf(k); }, 0) / SUPER.length;
['2022-lamborghini-countach-lp', '1995-lamborghini-diablo-sv', 'ural-4320-soviet-army-truck', 'caterpillar-ct680'].forEach(function (k) {
  PACE[k] = paceOf(BUS_KEY) / paceOf(k);
});
PACE.golf = paceOf(GOLF_KEY) / superAvg; PACE.w14 = paceOf(W14_KEY) / superAvg;
['2022-lamborghini-countach-lp', '1995-lamborghini-diablo-sv'].forEach(function (k) {
  if (!(PACE[k] >= 1.08 && PACE[k] <= 1.16)) fail('Bus/' + k + ' = ' + PACE[k].toFixed(3) + ' (Soll 8–16 % langsamer)');
});
['ural-4320-soviet-army-truck', 'caterpillar-ct680'].forEach(function (k) {
  if (!(PACE[k] > 0.9 && PACE[k] < 1.1)) fail(k + ': Rundenpace nicht im Bereich des Busses (Bus/' + k + ' = ' + PACE[k].toFixed(3) + ')');
});
if (!(PACE.golf >= 1.03 && PACE.golf <= 1.06)) fail('Golf GTI Mk1 ' + (100 * (PACE.golf - 1)).toFixed(1) + ' % langsamer als die Supersportwagen (Soll 3–6 %)');
if (!(PACE.w14 <= 0.92)) fail('W14 nur ' + (100 * (1 - PACE.w14)).toFixed(1) + ' % schneller als die Supersportwagen (Soll ≥ 8 %)');
var paceInfo = 'Rundenpace: Bus/Countach ' + PACE['2022-lamborghini-countach-lp'].toFixed(3) + ', Bus/Diablo ' + PACE['1995-lamborghini-diablo-sv'].toFixed(3) +
  ', Bus/Ural ' + PACE['ural-4320-soviet-army-truck'].toFixed(3) + ', Bus/CT680 ' + PACE['caterpillar-ct680'].toFixed(3) +
  ', Golf Mk1/Supersportwagen ' + PACE.golf.toFixed(3) + ', W14/Supersportwagen ' + PACE.w14.toFixed(3);

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
['fast', 'twisty', 'hairpin', 'sweeping', 'kart'].forEach(function (ch) { if (!chars[ch]) fail('keine Strecke mit Charakter ' + ch); });

// ---- 3. Determinismus + fastForward ----
function pickKeys(rnd, arr, n) {
  var a = arr.slice(), out = [];
  for (var i = 0; i < n; i++) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]);
  return out;
}
// Feld aus n Katalogautos (aus pool, ohne Doppelte), optional plus ein festes Auto (extra = Schlüssel, id = Schlüssel)
function mixedField(rnd, n, extra, pool) {
  var cars = pickKeys(rnd, pool || POOL, n).map(function (k, i) { return { id: 'car' + i, key: k, raw: carRaw(k) }; });
  if (extra) cars.push({ id: extra === BUS_KEY ? 'bus' : extra, key: extra, raw: carRaw(extra) });
  // Startaufstellung mischen (Anmeldereihenfolge ist zufällig)
  for (var i = cars.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1)), tmp = cars[i]; cars[i] = cars[j]; cars[j] = tmp;
  }
  return cars;
}
function toSimCars(field) { return field.map(function (c) { return { id: c.id, stats: Sim.stats(c.raw) }; }); }

(function () {
  var field = mixedField(mulberry32(7), 7, BUS_KEY);
  var opts = function () { return { seed: 123456, track: Sim.TRACKS[0], laps: LAPS, finishWindow: FW, cars: toSimCars(field) }; };
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

// ---- 3a. Zuschauer-Aktionen (Nitro, Anrempeln) ----
(function () {
  var field = mixedField(mulberry32(11), 6);
  var base = function (ev) { var o = { seed: 4242, track: Sim.TRACKS[1], laps: LAPS, finishWindow: FW, cars: toSimCars(field) }; if (ev) o.events = ev; return o; };
  function full(sim) { while (!sim.done && sim.time < MAX_T) sim.step(); return JSON.stringify([sim.result(), sim.events, sim.cars, sim.hazards]); }
  // ohne Ereignisse: genau wie vorher (auch mit leerer Liste und setEvents([]) mitten im Rennen)
  var ref = full(Sim.create(base()));
  if (full(Sim.create(base([]))) !== ref) fail('events: [] ändert das Rennen');
  var m = Sim.create(base()); m.fastForward(20); m.setEvents([]);
  if (full(m) !== ref) fail('setEvents([]) mitten im Rennen ändert das Rennen');
  var id0 = field[2].id, id1 = field[1].id;
  var ev = [{ t: 20, type: 'nitro', id: id0 }, { t: 30, type: 'bump', id: id0 }];
  // gleiche Ereignisse → gleiches Rennen, auch mit Vorspulen bzw. setEvents vor dem Ereignis
  var a = full(Sim.create(base(ev)));
  var b = Sim.create(base(ev)); b.fastForward(25.3);
  if (full(b) !== a) fail('Ereignisse + fastForward weichen ab');
  var c = Sim.create(base()); c.fastForward(10); if (c.setEvents(ev)) fail('setEvents meldet „zu spät“, obwohl die Ereignisse in der Zukunft liegen');
  if (full(c) !== a) fail('setEvents vor dem Ereignis weicht vom Rennen mit create({events}) ab');
  var late = Sim.create(base()); late.fastForward(22);
  if (!late.setEvents(ev)) fail('setEvents erkennt ein schon vergangenes Ereignis nicht');
  if (a === ref) fail('Ereignisse ändern das Rennen nicht');
  // Nitro bringt Strecke (wirkt auf Geraden, 3,5 s): der Führende zündet zu mehreren Zeitpunkten, Vergleich 3,5 s
  // später – auf dem Speedway bester Zeitpunkt > 3 m, auf allen Strecken nie schlechter als −0,3 m
  // (10 s dazu: seit der neuen Ideallinie liegt der Führende bei 12 s gut 1 m weiter vorn, näher an der Bremszone –
  // 2,93 statt 3,08 m; der Zeitpunkt auf der langen Startgeraden misst die Nitro-Wirkung unabhängig davon)
  var gainBy = {};
  Sim.TRACKS.forEach(function (tr) {
    var ob = function (ev) { var o = { seed: 4242, track: tr, laps: LAPS, finishWindow: FW, cars: toSimCars(field) }; if (ev) o.events = ev; return o; };
    gainBy[tr] = [10, 12, 16, 20, 24, 28, 31].map(function (T0) {
      var probe = Sim.create(ob()); probe.fastForward(T0);
      var lid = probe.standings()[0], li = field.map(function (f) { return f.id; }).indexOf(lid);
      var n0 = Sim.create(ob()), n1 = Sim.create(ob([{ t: T0, type: 'nitro', id: lid }]));
      n0.fastForward(T0 + 3.5); n1.fastForward(T0 + 3.5);
      if (!n1.events.some(function (e) { return e.type === 'nitro' && e.id === lid; })) fail('kein nitro-Ereignis bei ' + T0 + ' s');
      return n1.cars[li].s - n0.cars[li].s;
    });
  });
  function fmt(a) { return a.map(function (g) { return g.toFixed(2); }).join(', '); }
  var gain = Math.max.apply(null, gainBy[Sim.TRACKS[0]]);
  if (!(gain > 3)) fail('Nitro bringt auf dem Speedway zu wenig Strecke: ' + fmt(gainBy[Sim.TRACKS[0]]) + ' m');
  Sim.TRACKS.forEach(function (tr) { if (gainBy[tr].some(function (g) { return g < -0.3; })) fail('Nitro kostet Strecke (Strecke ' + tr + '): ' + fmt(gainBy[tr]) + ' m'); });
  // Anrempeln (ohne Ziel): jeder scharfe Rempler löst sich binnen 8 s auf (bump oder bumpmiss); mindestens ein
  // Treffer in der Probe, und der Getroffene wird seitlich verschoben
  var hits = 0, dd = 0, ids = field.map(function (f) { return f.id; });
  [10, 18, 26, 34].forEach(function (T0) {
    ids.forEach(function (bid, bi) {
      var b1 = Sim.create(base([{ t: T0, type: 'bump', id: bid }]));
      b1.fastForward(T0 + 8.2);
      var res = b1.events.filter(function (e) { return (e.type === 'bump' || e.type === 'bumpmiss') && e.id === bid; });
      var armed = !b1.events.some(function (e) { return e.id === bid && e.type === 'dnf' && e.t <= T0; }) && b1.cars[bi].place === null;
      if (res.length > 1) fail('Rempler von ' + bid + ' bei ' + T0 + ' s löst sich mehrfach auf');
      if (!res.length && armed && !b1.done) fail('Rempler von ' + bid + ' bei ' + T0 + ' s löst sich nicht auf');
      if (b1.cars[bi].hunting) fail('Rempler von ' + bid + ' nach 8 s noch scharf');
      var hit = res[0] && res[0].type === 'bump' ? res[0] : null;
      if (!hit) return;
      hits++;
      // seitliche Verschiebung des Getroffenen: Vergleich mit dem Rennen ohne Rempler kurz nach dem Treffer
      var oi = ids.indexOf(hit.other), b0 = Sim.create(base()), bh = Sim.create(base([{ t: T0, type: 'bump', id: bid }]));
      b0.fastForward(hit.t + 0.6); bh.fastForward(hit.t + 0.6);
      dd = Math.max(dd, Math.abs(bh.cars[oi].d - b0.cars[oi].d));
    });
  });
  if (!hits) fail('kein Rempler trifft in der Probe');
  if (!(dd > 0.3)) fail('Anrempeln verschiebt das Ziel zu wenig: ' + dd.toFixed(2) + ' m');
  console.log('Zuschauer-Aktionen: Nitro auf dem Speedway bis +' + gain.toFixed(1) + ' m in 3,5 s, Anrempeln ' + hits + ' Treffer, seitlich bis ' + dd.toFixed(2) + ' m');
})();

// ---- 3b. Lange Fahrzeuge (Einspurmodell): Bus auf der Hairpin-Strecke ----
// Gierwinkel ruhiger als mit dem alten starren Modell (gemessen vor dem Umbau: max. 0,1238 rad/Schritt,
// mittlere Änderung der Gierrate 0,00289 rad) und die Hinterachse schneidet enge Kurven innen.
var BUS_DYAW_BEFORE = 0.1238, BUS_JERK_BEFORE = 0.00289;
(function () {
  var worst = 0, jerk = 0, nj = 0, inSum = 0, inN = 0;
  var hair = Sim.TRACKS.filter(function (sd) { return Sim.track(sd).character === 'hairpin'; })[0];
  for (var k = 0; k < 10; k++) {
    var cars = [{ id: 'bus', stats: Sim.stats(BUS) }];
    for (var i = 1; i < 6; i++) cars.push({ id: 'c' + i, stats: Sim.stats(AVG) });
    var sim = Sim.create({ seed: 500 + k, track: hair, laps: LAPS, finishWindow: FW, cars: cars }), T = sim.track;
    var wb = Sim.wheelbase(BUS.len), prev = null, prevD = null;
    while (!sim.done) {
      sim.step();
      var c = sim.cars[0];
      if (prev !== null && (c.state === 'run' || c.state === 'done') && sim.time > 2) {
        var dy = c.yaw - prev;
        worst = Math.max(worst, Math.abs(dy));
        if (prevD !== null) { jerk += Math.abs(dy - prevD); nj++; }
        prevD = dy;
        // Hinterachse: von der Wagenmitte wb/2 nach hinten, auf die Strecke projiziert
        var crvF = T.at(c.s + wb / 2).curv;
        if (Math.abs(crvF) > 1 / 20 && c.v > 3 && c.state === 'run') {
          var rx = c.x - Math.cos(c.yaw) * wb / 2, rz = c.z + Math.sin(c.yaw) * wb / 2, sr = c.s - wb / 2, a;
          for (var q = 0; q < 4; q++) { a = T.at(sr); sr += (rx - a.x) * Math.cos(a.yaw) - (rz - a.z) * Math.sin(a.yaw); }
          a = T.at(sr);
          var dRear = (rx - a.x) * a.nx + (rz - a.z) * a.nz;
          inSum += (dRear - c.d) * (crvF > 0 ? 1 : -1); inN++;
        }
      } else prevD = null;
      prev = c.yaw;
    }
  }
  var jm = jerk / nj, inward = inSum / inN;
  busInfo = 'Bus auf ' + Sim.track(hair).name + ': max. |Δyaw| ' + worst.toFixed(4) + ' rad/Schritt (vorher ' + BUS_DYAW_BEFORE +
    '), mittlere Gierraten-Änderung ' + jm.toFixed(5) + ' (vorher ' + BUS_JERK_BEFORE + '), Hinterachse in engen Kurven im Mittel ' +
    inward.toFixed(2) + ' m weiter innen als die Vorderachse';
  if (!(worst <= BUS_DYAW_BEFORE)) fail('Bus: max. |Δyaw| ' + worst.toFixed(4) + ' > vorher ' + BUS_DYAW_BEFORE);
  if (!(jm <= BUS_JERK_BEFORE)) fail('Bus: Gierwinkel ruckelt (' + jm.toFixed(5) + ' > vorher ' + BUS_JERK_BEFORE + ')');
  if (!(inward >= 0.5)) fail('Bus: Hinterachse schneidet enge Kurven nicht innen (' + inward.toFixed(2) + ' m, Soll ≥ 0,5)');
})();

// ---- 3c. Seitenführung: kein Pendeln vor Kurven ----
// Wechsel der seitlichen Bewegungsrichtung (Vorzeichen von Δd je Schritt, Bewegungen unter 2 mm/Schritt zählen nicht)
// je Auto-Minute, fahrende Autos auf der Fahrbahn; volles Feld (Bus + 9) je Strecke über 4 Rennen, dazu der Nachfahrer
// allein. Vorher (Zielspur jeden Schritt neu zwischen Ideallinie und Überholspur, Linie direkt aus der Krümmung):
// ~80–160 je Minute, also mehrmals pro Sekunde. Soll ≤ LAT_FLIP_MAX einschließlich echter Überholmanöver.
var LAT_FLIP_MAX = 25, latInfo = '';
(function () {
  var out = [], worstTrack = 0;
  Sim.TRACKS.forEach(function (tr) {
    var flips = 0, n = 0, rnd3 = mulberry32(900 + tr);
    for (var k = 0; k < 4; k++) {
      var sim = Sim.create({ seed: 7000 + 31 * tr + k, track: tr, laps: LAPS, finishWindow: FW, cars: toSimCars(mixedField(rnd3, 9, BUS_KEY)) });
      var pd = sim.cars.map(function (c) { return c.d; }), pdd = sim.cars.map(function () { return 0; });
      while (!sim.done && sim.time < MAX_T) {
        sim.step();
        sim.cars.forEach(function (c, i) {
          var dd = c.d - pd[i]; pd[i] = c.d;
          if (c.state !== 'run' || c.off || sim.time < 3) { pdd[i] = 0; return; }
          if (Math.abs(dd) > 0.002) { if (pdd[i] && (dd > 0) !== (pdd[i] > 0)) flips++; pdd[i] = dd; }
          n++;
        });
      }
    }
    var perMin = flips / n * 3600;
    // Nachfahrer (KI übernimmt ein Auto): eigene Seitenführung, gleiche Linie
    var f = Sim.follower(tr, Sim.stats(AVG), { t: 0, s: 0, d: 3, speed: 0 }, { laps: LAPS }), fd = 3, fdd = 0, ff = 0, fn = 0;
    for (var t = DT; t < 120; t += DT) {
      var q = f.at(t), d2 = q.d - fd; fd = q.d;
      if (Math.abs(d2) > 0.002) { if (fdd && (d2 > 0) !== (fdd > 0)) ff++; fdd = d2; }
      fn++;
      if (q.finish !== null) break;
    }
    var fPerMin = ff / fn * 3600;
    worstTrack = Math.max(worstTrack, perMin, fPerMin);
    out.push(Sim.track(tr).name + ' ' + perMin.toFixed(1) + ' (Nachfahrer ' + fPerMin.toFixed(1) + ')');
    if (!(perMin <= LAT_FLIP_MAX)) fail('Seitenführung ' + Sim.track(tr).name + ': ' + perMin.toFixed(1) + ' Richtungswechsel je Auto-Minute (Soll ≤ ' + LAT_FLIP_MAX + ')');
    if (!(fPerMin <= LAT_FLIP_MAX)) fail('Nachfahrer ' + Sim.track(tr).name + ': ' + fPerMin.toFixed(1) + ' Richtungswechsel je Minute (Soll ≤ ' + LAT_FLIP_MAX + ')');
  });
  latInfo = 'Seitenführung: Richtungswechsel je Auto-Minute ' + out.join(', ') + ' (Soll ≤ ' + LAT_FLIP_MAX + ')';
})();

// ---- 4. Bilanz: Bus gegen 9 Zufallsautos aus der Tabelle (jedes Rennen neu) ----
var RACES = arg('--races', 1000);
var busWins = 0, busFin = 0, strongWins = 0, dnfs = 0, finishers = 0, wtimes = [], incidents = { spin: 0, crash: 0, dnf: 0 };
var X = { steerSum: 0, steerN: 0, steerMax: 0, offs: 0, rails: 0, returned: 0, offAtEnd: 0, pushes: 0, oilHits: 0, overtakes: 0, randomOil: 0, oilSpots: 0, maxOil: 0,
  busPush: [], busPushed: [], busLoss: [], busLost: [], busShoveLoss: [], busShovePush: [], draftSteps: 0 };
var started = Date.now();
var BSEED = arg('--seed', 2026), rnd = mulberry32(BSEED);
for (var race = 0; race < RACES; race++) {
  var field = mixedField(rnd, 9, BUS_KEY);
  var strongest = null, best = Infinity, trk = Sim.TRACKS[race % Sim.TRACKS.length];
  field.forEach(function (c) {
    if (c.id === 'bus') return;
    // stärkstes Auto = schnellste berechnete Runde auf dieser Strecke
    var lt = Sim.lapTime(Sim.stats(c.raw), trk);
    if (lt < best) { best = lt; strongest = c.id; }
  });
  var seed = ((race + (BSEED - 2026) * 100003) * 2654435761) >>> 1;
  var sim = run({ seed: seed, track: Sim.TRACKS[race % Sim.TRACKS.length], laps: LAPS, finishWindow: FW, cars: toSimCars(field) },
    'Bilanz-Rennen ' + race, race < 200);
  var res = sim.result();
  res.forEach(function (e) {
    if (e.place === 1 && e.id === 'bus') busWins++;
    if (e.id === 'bus' && e.place !== null) busFin++;
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
    // Bus schiebt in Kurven Kleinwagen aus dem Weg (kind 'shove'): relativer Tempoverlust des Busses
    if (e.kind === 'shove' && e.other === 'bus') { X.busShoveLoss.push(e.vOther > 0.5 ? e.lossOther / e.vOther : 0); X.busShovePush.push(e.push); }
    // Bus beteiligt: Schub/Tempoverlust des anderen Autos gegen den des Busses
    if (e.other === 'bus') { X.busPush.push(e.push); X.busPushed.push(e.pushOther); X.busLoss.push(e.loss); X.busLost.push(e.lossOther); }
    else if (e.id === 'bus') { X.busPush.push(e.pushOther); X.busPushed.push(e.push); X.busLoss.push(e.lossOther); X.busLost.push(e.loss); }
  });
}
var secs = (Date.now() - started) / 1000;
wtimes.sort(function (a, b) { return a - b; });
var busPct = 100 * busWins / RACES, strongPct = 100 * strongWins / RACES;
// Bus (Nutzer 2026-11-20, Variante a): gewinnt nur mit Glück oder wenn die anderen ausfallen – keine Mindest-Siegquote;
// er muss aber meist regulär ins Ziel kommen (sonst wäre er bei langen Strecken fast immer „DNF“ statt Letzter)
var busFinPct = 100 * busFin / RACES;
if (busFinPct < 70) fail('Bus kommt nur in ' + busFinPct.toFixed(1) + ' % der Rennen ins Ziel (Soll ≥ 70 %)');
if (strongPct > 60 || strongPct < 25) fail('stärkstes Auto gewinnt ' + strongPct.toFixed(1) + ' % (Soll 25–60 %)');
if (incidents.crash / RACES > 1.2) fail((incidents.crash / RACES).toFixed(2) + ' Crashs je Rennen inkl. Leitplanke (Soll ≤ 1,2)');
function mean(A) { return A.length ? A.reduce(function (x, y) { return x + y; }, 0) / A.length : 0; }
// Schwere schieben in Kurven: der Bus ist dabei der Schwere (other) und verliert je Kontakt höchstens ~10 % Tempo
if (Sim.HEAVY_PUSH) {
  if (X.busShoveLoss.length < 20) fail('nur ' + X.busShoveLoss.length + ' Kurven-Schubser des Busses (Soll ≥ 20)');
  else if (!(mean(X.busShoveLoss) <= 0.10)) fail('Bus verliert beim Schieben im Mittel ' + (100 * mean(X.busShoveLoss)).toFixed(1) + ' % Tempo (Soll ≤ 10 %)');
}
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

// ---- 5. Werte wirken: W14 gegen 9 Straßensportwagen, Golf GTI Mk1 gegen 9 Supersportwagen ----
var PROBE = Math.max(100, Math.round(RACES / 5)), w14Wins = 0, prnd = mulberry32(BSEED + 1);
for (race = 0; race < PROBE; race++) {
  var pf = mixedField(prnd, 9, W14_KEY, ROAD);
  var ps = run({ seed: race * 7919 + 1, track: Sim.TRACKS[race % Sim.TRACKS.length], laps: LAPS, finishWindow: FW, cars: toSimCars(pf) }, 'Probe ' + race, false);
  ps.result().forEach(function (e) { if (e.id === W14_KEY && e.place === 1) w14Wins++; });
}
var w14Pct = 100 * w14Wins / PROBE;
if (w14Pct < 45 || w14Pct > 85) fail('W14 gegen 9 Straßensportwagen gewinnt ' + w14Pct.toFixed(1) + ' % (Soll 45–85 %)');
// Golf-Probe ohne Prüfungen je Schritt (nur Ergebnis), dafür viele Rennen: Außenseiter-Chance ist klein
var GPROBE = RACES, golfWins = 0;
for (race = 0; race < GPROBE; race++) {
  var gs = Sim.create({ seed: race * 104729 + 3, track: Sim.TRACKS[race % Sim.TRACKS.length], laps: LAPS, finishWindow: FW,
    cars: toSimCars(mixedField(prnd, 9, GOLF_KEY, SUPER)) });
  while (!gs.done && gs.time < MAX_T) gs.step();
  gs.result().forEach(function (e) { if (e.id === GOLF_KEY && e.place === 1) golfWins++; });
}
var golfPct = 100 * golfWins / GPROBE;
if (golfPct < 0.2) fail('Golf GTI Mk1 gegen 9 Supersportwagen gewinnt ' + golfPct.toFixed(2) + ' % (Soll ≥ 0,2 %)');

// ---- 6. Kart: Größe zählt (enge Kehren, 8 m breit) ----
// Lange Supersportwagen (echte Längen) gegen wendige Kleine (Golf Mk1, Golf GTI 1992, Krabby Patty mit 55° Einschlag):
// auf dem Kart schrumpft der Rundenzeit-Vorsprung der Großen deutlich (≥ 2 Prozentpunkte gegenüber den langen
// Strecken), und im Rennen (Feld 5 Große + 4 Kleine) landen die Kleinen auf dem Kart im Mittel ≥ 0,4 Plätze weiter vorn
var KART_BIG = { '2022-lamborghini-countach-lp': 4.9, 'ferrari-gtc4-lusso': 4.9, '2025-koenigsegg-gemera': 5.0,
  '2020-abt-sportline-audi-rs6': 5.0, 'ferrari-laferrari': 4.7 };
var KART_SMALL = { 'volkswagen-golf-gti-1976': 3.8, '1992-volkswagen-golf-gti': 4.0, 'krabby-patty-wagon': 4, '1999-volkswagen-gol-2000-gti': 3.9 };
function kRaw(key, len) { var r = Stats.guess({ key: key }); r.len = len; return r; }
var kartInfo = '';
(function () {
  var kartT = Sim.TRACKS.filter(function (sd) { return Sim.track(sd).character === 'kart'; })[0];
  var longT = Sim.TRACKS.filter(function (sd) { return sd !== kartT; });
  function grpPace(G, tracks) {
    var ks = Object.keys(G);
    return ks.reduce(function (a, k) {
      var st = Sim.stats(kRaw(k, G[k]));
      return a + tracks.reduce(function (b, sd) { return b + Sim.lapTime(st, Sim.track(sd)); }, 0) / tracks.length;
    }, 0) / ks.length;
  }
  var lead = function (tracks) { return grpPace(KART_SMALL, tracks) / grpPace(KART_BIG, tracks) - 1; };
  var leadLong = lead(longT), leadKart = lead([kartT]);
  if (!(leadLong - leadKart >= 0.02)) fail('Kart: Vorsprung der großen Supersportwagen schrumpft nur von ' + (100 * leadLong).toFixed(1) + ' auf ' + (100 * leadKart).toFixed(1) + ' % (Soll ≥ 2 Prozentpunkte)');
  var KR = Math.max(60, Math.round(RACES / 8)), krnd = mulberry32(BSEED + 7), place = {};
  [kartT, longT[0]].forEach(function (tr) {
    var sum = 0, cnt = 0;
    for (var r = 0; r < KR; r++) {
      var f = Object.keys(KART_BIG).map(function (k) { return { id: 'B' + k, raw: kRaw(k, KART_BIG[k]) }; })
        .concat(Object.keys(KART_SMALL).map(function (k) { return { id: 'S' + k, raw: kRaw(k, KART_SMALL[k]) }; }));
      for (var i = f.length - 1; i > 0; i--) { var j = Math.floor(krnd() * (i + 1)), tmp = f[i]; f[i] = f[j]; f[j] = tmp; }
      var ks = Sim.create({ seed: r * 7717 + 11, track: tr, laps: LAPS, finishWindow: FW, cars: toSimCars(f) });
      while (!ks.done && ks.time < MAX_T) ks.step();
      ks.result().forEach(function (e) { if (e.id[0] === 'S') { sum += e.place === null ? f.length : e.place; cnt++; } });
    }
    place[tr] = sum / cnt;
  });
  var gain = place[longT[0]] - place[kartT];
  kartInfo = 'Kart: Rundenvorsprung große Supersportwagen vor wendigen Kleinen ' + (100 * leadLong).toFixed(1) + ' % (lange Strecken) → ' +
    (100 * leadKart).toFixed(1) + ' % (Kart); Kleine im Rennen im Mittel Platz ' + place[longT[0]].toFixed(2) + ' (' + Sim.track(longT[0]).name +
    ') → ' + place[kartT].toFixed(2) + ' (Kart), ' + KR + ' Rennen je Strecke';
  if (!(gain >= 0.4)) fail('Kart: wendige Kleine gewinnen im Rennen nur ' + gain.toFixed(2) + ' Plätze (Soll ≥ 0,4)');
})();

/* Race-stats-Schätzung (js/car-race-stats.js): Tabelle, Klassen und gültige Bereiche */
function validRace(g, label) {
  Stats.KEYS.forEach(function (k) {
    var R = Stats.RANGE[k];
    if (!(g[k] >= R[0] && g[k] <= R[1])) fail(label + '.' + k + ' = ' + g[k] + ' außerhalb ' + R[0] + '–' + R[1]);
  });
  if (['fwd', 'rwd', 'awd'].indexOf(g.drive) < 0) fail(label + ' drive ' + g.drive);
  if (!(g.len >= 0.5 && g.len <= 20)) fail(label + ' len ' + g.len);
  if (g.on !== true) fail(label + ' on ≠ true');
}
var FIX = [
  { key: 'trolza', name: 'Trolza 5265.00 "Megapolis"', brand: 'Trolza', len: 12 },
  { key: 'lambo', name: 'Lamborghini Aventador', brand: 'Lamborghini', len: 4.8 },
  { key: 'hoon', name: 'Hoonicorn- A tribute to Ken Block (Updated)', brand: 'Ford', len: 4.4 },
  { key: 'ural', name: 'Ural-4320', brand: 'Ural', len: 7.6 },
  { key: 'krabby', name: 'Krabby Patty Wagon', brand: 'Fun', len: 1 },
  { key: 'm5', name: '2003 BMW M5', brand: 'BMW', len: 4.9 },
  { key: 'golf', name: 'VW Golf', brand: 'VW' }
];
var G = {};
FIX.forEach(function (e) { validRace(G[e.key] = Stats.guess(e), 'guess ' + e.key); });
if (!(G.trolza.vmax <= 100 && G.trolza.kg >= 8000)) fail('Trolza: vmax ≤ 100 und kg ≥ 8000 erwartet');
if (!(G.lambo.vmax >= 300)) fail('Lamborghini: vmax ≥ 300 erwartet');
if (!(G.hoon.hp >= 800)) fail('Hoonicorn: hp ≥ 800 erwartet');
if (G.krabby.len !== 1) fail('Krabby: Katalog-len 1 m muss bleiben');
TKEYS.forEach(function (k) { validRace(Stats.guess({ key: k }), 'Tabelle ' + k); });
var mk1 = Stats.guess({ key: GOLF_KEY, name: 'whatever', brand: 'VW' });
if (!(mk1.vmax === 182 && mk1.hp === 110 && mk1.drive === 'fwd')) fail('Tabelle schlägt Klasse nicht: Golf Mk1 ' + JSON.stringify(mk1));
if (Stats.guess({ key: 'ferrari-296-gt3-verstappen' }).grip !== 1.6) fail('Tabelle: Ferrari 296 GT3 (Verstappen) grip 1,6 erwartet');
// clean(): alte 1–10-Felder verworfen, Bereiche geprüft
var cl = Stats.clean({ on: false, power: 7, speed: 9, weight: 3, vmax: 250, acc: 0.5, kg: '1200', grip: 9, drive: 'awd', len: 0.6 });
if (JSON.stringify(cl) !== JSON.stringify({ on: false, vmax: 250, kg: 1200, len: 0.6, drive: 'awd' })) fail('clean() falsch: ' + JSON.stringify(cl));
var CAND = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'assets', 'cars', 'candidates.json'), 'utf8'));
if (CAND.length < 100) fail('assets/cars/candidates.json zu klein: ' + CAND.length);
CAND.forEach(function (e) { validRace(Stats.guess({ key: e.key || e.uid, name: e.name, brand: e.brand, len: e.len }), 'Katalog "' + e.name + '"'); });
function gn(name, brand) { return Stats.guess({ key: 'x', name: name, brand: brand || '' }); }
var p918 = gn('Porsche 918 Spyder 2015', 'Porsche'), w14 = gn('Amg W14 S1', 'Mercedes-Benz'), g63 = gn('Mersedes-Benz G63 AMG', 'Mercedes-Benz');
if (!(p918.vmax >= 330 && p918.grip >= 1.2)) fail('Porsche 918: Hypercar erwartet');
if (!(w14.vmax >= 330 && w14.grip >= 1.2)) fail('AMG W14: Hypercar erwartet');
if (!(g63.kg >= 2200 && g63.grip <= 0.8 && g63.vmax >= 200 && g63.vmax <= 240)) fail('G63: schwerer SUV erwartet');
if (gn('Ferrari F40', 'Ferrari').drive !== 'rwd') fail('Ferrari: rwd erwartet');
var sedan = gn('Some Sedan');
if (gn('Toyota Hilux Pickup', 'Toyota').vmax !== sedan.vmax || gn('Kia Sportage', 'Kia').vmax !== sedan.vmax) fail('Pickup/Sportage dürfen nicht Kleinwagen/Sport sein');
if (G.golf.len !== 4.5) fail('Golf ohne len: Rückfall 4,5 erwartet');

if (X.steerN) {
  var steerMean = X.steerSum / X.steerN;
  if (!(steerMean < 0.15)) fail('Lenkwinkel: Mittel |steer| ' + steerMean.toFixed(3) + ' rad (Soll < 0,15)');
  if (!(X.steerMax <= 0.42 + 1e-9)) fail('Lenkwinkel: Maximum ' + X.steerMax.toFixed(3) + ' rad (Soll ≤ 0,42)');
  console.log('Lenkwinkel (fahrende Autos): Mittel |steer| ' + steerMean.toFixed(3) + ' rad, Maximum ' + X.steerMax.toFixed(3) + ' rad');
}

function report() {
  if (typeof RACES === 'number' && rareCases.length > RARE_MAX * Math.max(1, RACES / 1000)) {
    rareCases.forEach(function (m) { fail(m + ' (seltene Fälle: ' + rareCases.length + ' > ' + RARE_MAX + ')'); });
  }
  console.log('Strecken (TRACKS = [' + (Sim && Sim.TRACKS ? Sim.TRACKS.join(', ') : '') + ']):');
  (trackInfo || []).forEach(function (l) { console.log(l); });
  if (busInfo) console.log(busInfo);
  if (latInfo) console.log(latInfo);
  if (typeof paceInfo === 'string') console.log(paceInfo);
  if (typeof kartInfo === 'string' && kartInfo) console.log(kartInfo);
  if (typeof RACES !== 'undefined' && wtimes.length) {
    console.log('Bilanz ' + RACES + ' Rennen (' + secs.toFixed(1) + ' s): Bus gewinnt ' + busPct.toFixed(1) + ' % (im Ziel ' + busFinPct.toFixed(1) + ' %)' +
      ', stärkstes Auto ' + strongPct.toFixed(1) + ' %; DNF-Anteil ' + (100 * dnfs / (dnfs + finishers)).toFixed(1) +
      ' %; Siegerzeit Median ' + wtimes[Math.floor(wtimes.length / 2)].toFixed(1) + ' s (' + wtimes[0].toFixed(1) + '–' +
      wtimes[wtimes.length - 1].toFixed(1) + ' s); W14 gegen Straßensportwagen: ' + (typeof w14Pct === 'number' ? w14Pct.toFixed(1) : '–') +
      ' %, Golf Mk1 gegen Supersportwagen: ' + (typeof golfPct === 'number' ? golfPct.toFixed(2) : '–') + ' %; je Rennen ' + (incidents.spin / RACES).toFixed(2) + ' Dreher, ' +
      (incidents.crash / RACES).toFixed(2) + ' Crashs (davon ' + (X.rails / RACES).toFixed(2) + ' Leitplanke), ' + (incidents.dnf / RACES).toFixed(2) + ' Crash-DNF');
    console.log('Zwischenfälle je Rennen: ' + (X.offs / RACES).toFixed(2) + ' Abflüge (' + X.returned + ' zurück, ' + X.rails + ' Leitplanke, ' + X.offAtEnd +
      ' bei Rennende draußen), ' + (X.pushes / RACES).toFixed(2) + ' Kontakte, ' + (X.oilHits / RACES).toFixed(2) + ' Ölkontakte, ' +
      (X.overtakes / RACES).toFixed(1) + ' Überholmanöver; Zufalls-Ölfleck in ' + (100 * X.randomOil / RACES).toFixed(1) + ' % der Rennen, ' +
      (X.oilSpots / RACES).toFixed(2) + ' Flecken je Rennen (max. ' + X.maxOil + ')');
    console.log('Wrack-Überlappung geprüft in ' + Object.keys(overlapChecked).length + ' Rennen mit stehendem Auto/Wrack (Toleranz ' + OVERLAP_TOL + ' m)');
    var sl = X.busShoveLoss.slice().sort(function (a, b) { return a - b; });
    if (sl.length) console.log('Bus schiebt in Kurven: ' + (sl.length / RACES).toFixed(2) + ' je Rennen, Schub auf den Kleinwagen ' + mean(X.busShovePush).toFixed(2) +
      ' m/s, Tempoverlust des Busses im Mittel ' + (100 * mean(sl)).toFixed(1) + ' % (95 %: ' + (100 * (sl[Math.floor(sl.length * 0.95)] || 0)).toFixed(1) + ' %)');
    console.log('Seltene Fälle (festgefahren / zu lange im Auslauf) in Bilanz + Probe: ' + rareCases.length + ' (Soll ≤ ' + RARE_MAX + ')' + (rareCases.length ? ': ' + rareCases.join('; ') : ''));
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
