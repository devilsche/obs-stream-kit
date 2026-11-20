#!/usr/bin/env node
/* Prüfskript Car Drive: Fahrphysik (js/car-drive-phys.js) und KI-Gegner aus der Sim – schnelle Rauchtests.
 *   node scripts/check_car_drive.js
 * Prüft: Beschleunigen, Kurve mit Lenk-Autopilot (ganze Runde je Strecke), Bremsen, Kies bremst, Leitplanke
 * schiebt zurück, Handbremse dreht das Heck, Nitro einmal je Runde, Rückwärtsgang (S/W wie im Rennspiel, auch aus dem
 * Kies), KI-Gegner fahren (bis 5 Runden), Kontakte Auto ↔ Auto (Rechteck-Kollision: nie durch einen Bus, Crash
 * statt Flipper: kaum Rückprall, Tempo weg, außermittiger Treffer hinten dreht, schwer gegen leicht).
 */
'use strict';
var path = require('path');
var Sim = require(path.join(__dirname, '../js/car-race-sim.js'));
var Stats = require(path.join(__dirname, '../js/car-race-stats.js'));
var Phys = require(path.join(__dirname, '../js/car-drive-phys.js'));

var fails = 0;
function ok(cond, msg) { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; }
var DT = 1 / 60;
function carFor(key, T, pose) {
  var raw = Stats.guess({ key: key, len: 4.5 }), st = Sim.stats(raw);
  return Phys.create(T, Phys.params(st, raw), pose || { s: 0, d: 0 });
}
function run(car, inp, secs) { for (var t = 0; t < secs; t += DT) Phys.step(car, typeof inp === 'function' ? inp(car) : inp, DT); return car; }
// einfacher Autopilot: Punkt voraus auf der Mittellinie anpeilen, Tempo vor Kurven begrenzen
function pilot(car) {
  var T = car.T, look = 6 + Math.abs(car.u) * 0.5, a = T.at(car.s + look);
  var ang = Math.atan2(-(a.z - car.z), a.x - car.x), err = ang - car.yaw;
  while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
  var vmax = 1e9;
  for (var k = 0; k <= 40; k += 4) { var c = Math.abs(T.at(car.s + k).curv); vmax = Math.min(vmax, Math.sqrt(car.P.grip * 0.85 / Math.max(c, 1e-4)) + k * 0.35); }
  return { steer: Math.max(-1, Math.min(1, err * 2.5)), throttle: car.u < vmax ? 1 : 0, brake: car.u > vmax + 1.5 ? 0.8 : 0 };
}

// 1) Beschleunigen auf der Startgeraden (Speedway)
var T1 = Sim.track(1);
var c = run(carFor('ferrari-laferrari', T1, { s: -20, d: 0 }), { throttle: 1 }, 3);
ok(c.u > 10 && c.u < c.P.vtop, 'beschleunigt in 3 s auf ' + c.u.toFixed(1) + ' m/s (' + Phys.speedKmh(c).toFixed(0) + ' km/h), vtop ' + c.P.vtop.toFixed(1));
ok(Math.abs(c.d) < 0.6, 'fährt geradeaus (d = ' + c.d.toFixed(2) + ')');
ok(c.prog > -20 + 10, 'Fortschritt zählt (' + c.prog.toFixed(1) + ' m)');

// 2) Bremsen aus vollem Tempo
var u0 = c.u, t0 = 0; while (c.u > 0.5 && t0 < 10) { Phys.step(c, { brake: 1 }, DT); t0 += DT; }
ok(t0 < u0 / c.P.brake * 1.6 + 0.3, 'bremst aus ' + u0.toFixed(1) + ' m/s in ' + t0.toFixed(2) + ' s');

// 3) Kurve / ganze Runde mit Autopilot auf allen Strecken, Rundenzeit wie die Sim-Rundenpace
Sim.TRACKS.forEach(function (tr) {
  var T = Sim.track(tr), car = carFor('porsche-911-gt3-2', T, { s: 0, d: 0 }), t = 0, maxD = 0, rails = 0;
  while (car.laps < 1 && t < 90) { Phys.step(car, pilot(car), DT); t += DT; maxD = Math.max(maxD, Math.abs(car.d)); rails += car.rail > 0 ? 1 : 0; }
  var pace = Sim.lapTime(Sim.stats(Stats.guess({ key: 'porsche-911-gt3-2', len: 4.5 })), T);
  ok(car.laps >= 1 && t < pace * 1.6, T.name + ': Runde mit Autopilot in ' + t.toFixed(1) + ' s (Sim-Pace ' + pace.toFixed(1) + ' s), max |d| ' + maxD.toFixed(1) + ' m, Planke ' + rails + '×');
});

// 4) Lenken: Kreisfahrt nach links dreht nach links
var c2 = run(carFor('bmw-m3-competition', T1, { s: -40, d: 0 }), { throttle: 0.6 }, 1.5);
var y0 = c2.yaw; run(c2, { throttle: 0.4, steer: 1 }, 0.6);
ok(c2.yaw - y0 > 0.2, 'Lenken links dreht nach links (' + (c2.yaw - y0).toFixed(2) + ' rad)');

// 5) Kies bremst: Auto ins Kiesbett setzen
var T3 = Sim.track(3), info = Phys.trackInfo(T3), gi = -1, gsd = 1;
for (var i = 0; i < T3._raw.n && gi < 0; i++) [1, -1].forEach(function (sd) { if (gi < 0 && info.gravel[sd][i] && info.gravel[sd][(i + 4) % T3._raw.n] && (sd > 0 ? T3.runoff.left : T3.runoff.right)[i] > 6) { gi = i; gsd = sd; } });
ok(gi >= 0, 'Kiesbett gefunden (Hairpin, Punkt ' + gi + ')');
if (gi >= 0) {
  var sG = gi * T3._raw.ds, dG = gsd * (T3.width / 2 + 3);
  var g1 = Phys.create(T3, carFor('porsche-911-gt3-2', T3).P, { s: sG, d: dG }), a1 = Phys.create(T3, g1.P, { s: sG, d: 0 });
  [g1, a1].forEach(function (k) { var fx = Math.cos(k.yaw), fz = -Math.sin(k.yaw); k.vx = fx * 20; k.vz = fz * 20; });
  run(g1, { throttle: 0 }, 0.5); run(a1, { throttle: 0 }, 0.5);
  ok(g1.surface === 'gravel', 'Untergrund im Auslauf = ' + g1.surface);
  ok(g1.u < a1.u - 3, 'Kies bremst: ' + g1.u.toFixed(1) + ' m/s gegen Asphalt ' + a1.u.toFixed(1) + ' m/s nach 0,5 s');
  var g2 = Phys.create(T3, g1.P, { s: sG, d: dG }); run(g2, { throttle: 1 }, 2);
  ok(g2.surface !== 'gravel' || g2.u < 9, 'Vollgas im Kies bleibt langsam (' + g2.u.toFixed(1) + ' m/s)');
}

// 6) Leitplanke: quer nach außen fahren → zurückgeschoben, Tempo weg
// Start kurz vor der Planke (Rand des Auslaufs), Fahrtrichtung schräg darauf zu – ein reines Querrutschen von der
// Fahrbahnmitte aus bauen die Reifen ab, bevor die Planke erreicht ist
var T2 = Sim.track(2), a3 = T2.at(60), side = a3.runL > 0.5 ? 1 : -1;
var c3 = carFor('bmw-m3-competition', T2, { s: 60, d: side * (T2.width / 2 + (side > 0 ? a3.runL : a3.runR) - 2.5) });
c3.vx = a3.nx * side * 12 + Math.cos(c3.yaw) * 10; c3.vz = a3.nz * side * 12 - Math.sin(c3.yaw) * 10;
c3.yaw = Math.atan2(-c3.vz, c3.vx);
var hit = 0, minGap = Infinity, vBefore = 0, vAfter = 0;
for (var t3 = 0; t3 < 3 && !hit; t3 += DT) {
  vBefore = Math.hypot(c3.vx, c3.vz); Phys.step(c3, {}, DT); hit = c3.rail;
  var at3 = T2.at(c3.s), rl = T2.width / 2 + (c3.d > 0 ? at3.runL : at3.runR) + 0.3; minGap = Math.min(minGap, rl - Math.abs(c3.d));
}
vAfter = Math.hypot(c3.vx, c3.vz);
ok(hit > 0, 'Leitplanke getroffen (Aufprall ' + hit.toFixed(1) + ' m/s quer)');
ok(minGap > 0, 'Wagenmitte bleibt vor der Planke (kleinster Abstand ' + minGap.toFixed(2) + ' m)');
var vn3 = c3.vx * T2.at(c3.s).nx * Math.sign(c3.d) + c3.vz * T2.at(c3.s).nz * Math.sign(c3.d);
ok(vn3 <= 0 && vAfter < vBefore * 0.8, 'zurückgeschoben, Tempo ' + vBefore.toFixed(1) + ' → ' + vAfter.toFixed(1) + ' m/s (quer jetzt ' + vn3.toFixed(1) + ' m/s)');

// 7) Handbremse dreht das Heck stärker als ohne
function turnWith(hb) { var k = run(carFor('bmw-m3-competition', T1, { s: -60, d: 0 }), { throttle: 1 }, 2.5), y = k.yaw; run(k, { throttle: 0.3, steer: 0.6, handbrake: hb }, 0.7); return k.yaw - y; }
var yh = turnWith(true), yn = turnWith(false);
ok(yh > yn, 'Handbremse: Drehung ' + yh.toFixed(2) + ' rad gegen ' + yn.toFixed(2) + ' rad ohne');

// 8) Nitro einmal je Runde
var c4 = run(carFor('bmw-m3-competition', T1, { s: 5, d: 0 }), { throttle: 1 }, 0.5);
Phys.step(c4, { throttle: 1, nitro: true }, DT); var n1 = c4.nitroT > 0;
run(c4, { throttle: 1 }, 3); Phys.step(c4, { throttle: 1, nitro: true }, DT);
ok(n1 && c4.nitroT === 0, 'Nitro zündet einmal, zweites Mal in derselben Runde nicht');

// 8b) Rückwärtsgang wie im Rennspiel (Tastatur-Rampe wie js/car-drive.js): S bremst bis zum Stand, dann rückwärts
//     bis REV_V (langsamer als vorwärts, Nitro wirkt nicht); W bremst rückwärts bis zum Stand, dann vorwärts
function ramp(car, want, secs, nitro) {
  var thr = 0, brk = 0, minU = Infinity, maxU = -Infinity, tStop = null;
  for (var t = 0; t < secs; t += DT) {
    thr += Math.max(-8 * DT, Math.min(6 * DT, (want === 'w' ? 1 : 0) - thr));
    brk += Math.max(-8 * DT, Math.min(8 * DT, (want === 's' ? 1 : 0) - brk));
    Phys.step(car, { throttle: thr, brake: brk, nitro: !!nitro }, DT);
    minU = Math.min(minU, car.u); maxU = Math.max(maxU, car.u);
    if (tStop == null && Math.abs(car.u) < 0.3) tStop = t;
  }
  return { minU: minU, maxU: maxU, tStop: tStop };
}
['bmw-m3-competition', 'ural-4320-soviet-army-truck'].forEach(function (key) {
  var r = run(carFor(key, T1, { s: -40, d: 0 }), { throttle: 1 }, 2), u1 = r.u;
  var b = ramp(r, 's', 7, true);
  ok(b.tStop != null && b.tStop < 3, key + ': S aus ' + u1.toFixed(1) + ' m/s bremst bis zum Stand (' + (b.tStop != null ? b.tStop.toFixed(2) : '–') + ' s)');
  ok(r.u < -Phys.REV_V * 0.8 && r.u >= -Phys.REV_V - 0.05, key + ': S weiter gehalten fährt rückwärts bis zur Grenze (' + r.u.toFixed(2) + ' m/s, Grenze ' + Phys.REV_V + ', Nitro gedrückt)');
  ok(r.nitroT === 0 && -r.u < r.P.vtop * 0.3, key + ': rückwärts deutlich langsamer als vorwärts (vtop ' + r.P.vtop.toFixed(1) + ')');
  var f = ramp(r, 'w', 4);
  ok(f.tStop != null && f.tStop < 1.5, key + ': W rückwärts bremst bis zum Stand (' + (f.tStop != null ? f.tStop.toFixed(2) : '–') + ' s)');
  ok(r.u > 5, key + ': W danach fährt wieder vorwärts (' + r.u.toFixed(1) + ' m/s)');
});
// Rückwärts aus dem Kiesbett/Gras (vorher: Rückwärtsgas kleiner als Roll- + Kieswiderstand → steckte fest)
if (gi >= 0) {
  var gR = Phys.create(T3, carFor('ural-4320-soviet-army-truck', T3).P, { s: sG, d: dG });
  var gb = ramp(gR, 's', 3);
  ok(gR.u < -1.2, 'rückwärts aus dem Kiesbett anfahren (Lkw, jetzt ' + gR.surface + '): ' + gR.u.toFixed(2) + ' m/s nach 3 s');
}

// 9) KI-Gegner: Sim mit 7 Autos, 5 Runden (maxTime länger als 90 s)
var keys = Object.keys(Stats.TABLE).slice(0, 7);
var sim = Sim.create({ seed: 4242, track: 4, laps: 5, finishWindow: 1e6, maxTime: 600,
  cars: keys.map(function (k, i) { return { id: 'ai' + i, stats: Sim.stats(Stats.guess({ key: k, len: 4.5 })) }; }) });
var x0 = sim.cars.map(function (q) { return [q.x, q.z]; });
sim.fastForward(30);
ok(sim.cars.every(function (q, i) { return q.state !== 'run' || Math.hypot(q.x - x0[i][0], q.z - x0[i][1]) > 20; }), 'KI-Gegner fahren (nach 30 s: ' + sim.cars.map(function (q) { return q.s.toFixed(0); }).join(', ') + ' m)');
sim.fastForward(200);
var fin = sim.cars.filter(function (q) { return q.place != null; }).length, dnf = sim.cars.filter(function (q) { return q.place == null; }).length;
ok(fin >= 5, '5 Runden: ' + fin + ' im Ziel, ' + dnf + ' ausgeschieden, Sieger nach ' + Math.min.apply(null, sim.cars.map(function (q) { return q.finish || 1e9; })).toFixed(1) + ' s');

// 10) Kontakte Auto ↔ Auto (stepContacts/collide wie js/car-drive.js)
var TB = Sim.track(1), S0 = 268;   // Speedway: Gerade von ~265 bis ~315 m
function busAt(s, d, turn) {
  var a = TB.at(s);
  return { x: a.x + a.nx * d, z: a.z + a.nz * d, yaw: a.yaw + (turn || 0), len: 12, w: 2.5, vx: 0, vz: 0, mass: 17 };
}
function dims(car) { return { len: car.P.len, w: car.P.width }; }
function setSpeed(car, v) { car.vx = Math.cos(car.yaw) * v; car.vz = -Math.sin(car.yaw) * v; car.u = v; }
// fährt mit inp gegen others; → größte Überlappung nach jedem Bild, Tempo/Gierrate rund um den ersten Treffer.
// react: der andere bekommt den Gegenstoß ab (wie die KI im Solo-Rennen bzw. der andere Client bei sich)
function crashRun(car, inp, others, secs, react) {
  var r = { maxPen: 0, hit: null, vIn: 0, vOut: null, rMax: 0, sp: [] };
  for (var t = 0; t < secs; t += DT) {
    var v0 = Math.hypot(car.vx, car.vz);
    var out = Phys.stepContacts(car, inp, DT, dims(car), others, react ? function (o, h) { o.vx -= h.jx / o.mass; o.vz -= h.jz / o.mass; } : null);
    others.forEach(function (o) {
      var h = Phys.overlap({ x: car.x, z: car.z, yaw: car.yaw, len: car.P.len, w: car.P.width }, o);
      if (h) r.maxPen = Math.max(r.maxPen, h.pen);
      if (o.x0 != null) { o.x0 = o.x; o.z0 = o.z; o.yaw0 = o.yaw; o.x += o.vx * DT; o.z += o.vz * DT; }
    });
    var big = out.hits.filter(function (h) { return h.impact > 0; })[0];
    if (big && !r.hit) { r.hit = big; r.vIn = v0; r.tHit = t; }
    if (r.hit && r.vOut == null && t - r.tHit >= 0.1) r.vOut = Math.hypot(car.vx, car.vz);
    if (r.hit) r.rMax = Math.max(r.rMax, Math.abs(car.r));
  }
  if (r.vOut == null) r.vOut = Math.hypot(car.vx, car.vz);
  return r;
}
// Bus quer über die Strecke (Breitseite), Bus längs (Heck): nie durchfahren, auch bei Tempo, langsam, rückwärts
[[5, 'quer'], [15, 'quer'], [30, 'quer'], [45, 'quer'], [30, 'längs'], [3, 'längs']].forEach(function (cs) {
  var v = cs[0], car = carFor('bmw-m3-competition', TB, { s: S0, d: 0 }), bus = busAt(S0 + 25, 0, cs[1] === 'quer' ? Math.PI / 2 : 0);
  setSpeed(car, v);
  var r = crashRun(car, { throttle: 1 }, [bus], 2.5);
  var a = TB.at(S0 + 25), ahead = (car.x - bus.x) * Math.cos(a.yaw) - (car.z - bus.z) * Math.sin(a.yaw);
  ok(r.hit && r.maxPen < 0.05 && ahead < 0, 'Bus ' + cs[1] + ' mit ' + v + ' m/s + Vollgas: nicht durch (größte Überlappung ' + (r.maxPen * 100).toFixed(1) + ' cm, Auto ' + ahead.toFixed(1) + ' m vor der Busmitte)');
  if (v >= 15) ok(r.vOut < r.vIn * 0.35, 'Bus ' + cs[1] + ' ' + v + ' m/s: Tempo weg ' + r.vIn.toFixed(1) + ' → ' + r.vOut.toFixed(1) + ' m/s nach 0,1 s');
});
// Rückprall gering: frontal in ein Wrack (unbeweglich) und in einen Bus, der den Gegenstoß abbekommt
(function () {
  var car = carFor('bmw-m3-competition', TB, { s: S0, d: 0 }), wreck = busAt(S0 + 25, 0, Math.PI / 2), back = 0, hits = 0;
  wreck.mass = Infinity; setSpeed(car, 20);
  for (var t = 0; t < 1.5; t += DT) {
    hits += Phys.stepContacts(car, {}, DT, dims(car), [wreck]).hits.length;
    back = Math.max(back, -car.u);
  }
  ok(hits > 0 && back < 20 * 0.2, 'Rückprall gering: 20 m/s frontal ins Wrack → höchstens ' + back.toFixed(2) + ' m/s zurück');
  var c2 = carFor('bmw-m3-competition', TB, { s: S0, d: 0 }), bus = busAt(S0 + 25, 0, Math.PI / 2), e = null;
  setSpeed(c2, 20);
  for (var t2 = 0; t2 < 1.5 && e == null; t2 += DT) {
    Phys.stepContacts(c2, {}, DT, dims(c2), [bus], function (o, h) {
      if (h.impact < 5) return;
      o.vx -= h.jx / o.mass; o.vz -= h.jz / o.mass;
      e = ((c2.vx - o.vx) * h.nx + (c2.vz - o.vz) * h.nz) / h.impact;   // Trenntempo / Aufpralltempo
    });
  }
  ok(e != null && e >= 0 && e < 0.2, 'Stoßzahl gegen den Bus ' + (e != null ? e.toFixed(3) : '–') + ' (unelastisch, Bus bekommt den Gegenstoß)');
})();
// rückwärts in den Bus (Bus hinter dem Auto), S gehalten
(function () {
  var car = carFor('bmw-m3-competition', TB, { s: S0 + 30, d: 0 }), bus = busAt(S0 + 21, 0, Math.PI / 2);
  var r = crashRun(car, { brake: 1 }, [bus], 5);
  var a = TB.at(S0 + 21), behind = (car.x - bus.x) * Math.cos(a.yaw) - (car.z - bus.z) * Math.sin(a.yaw);
  ok(r.hit && r.maxPen < 0.05 && behind > 0, 'rückwärts in den Bus: nicht durch (Überlappung ' + (r.maxPen * 100).toFixed(1) + ' cm, ' + behind.toFixed(1) + ' m hinter der Busmitte)');
})();
// schräg mit Gas an der Busseite entlang: schrammt (kein Crash), gleitet ab und behält Tempo
(function () {
  var car = carFor('bmw-m3-competition', TB, { s: S0 + 8, d: 0 }), bus = busAt(S0 + 12, 2.2, 0);
  car.yaw += 0.08; setSpeed(car, 14);
  var crash = 0, scr = 0;
  for (var t = 0; t < 2.5; t += DT) {
    Phys.stepContacts(car, { throttle: 0.6 }, DT, dims(car), [bus], function (o, h) { if (h.scrape && h.impact > 0) scr++; else if (h.impact > 0) crash++; });
  }
  ok(scr > 0 && crash === 0 && car.u > 9, 'flacher Seitenkontakt schrammt: ' + scr + '× Schrammen, ' + crash + '× Crash, Tempo danach ' + car.u.toFixed(1) + ' m/s');
})();
// außermittiger Treffer hinten: anderes Auto fährt versetzt ins Heck → Gierrate (Dreher)
(function () {
  var car = carFor('bmw-m3-competition', TB, { s: S0 + 20, d: 0 }), a = TB.at(S0 + 14);
  var o = { x: a.x + a.nx * 1.3, z: a.z + a.nz * 1.3, yaw: a.yaw, len: 4.5, w: 1.9, mass: 4.5,
    vx: Math.cos(a.yaw) * 18, vz: -Math.sin(a.yaw) * 18 };
  o.x0 = o.x; o.z0 = o.z; o.yaw0 = o.yaw;
  var yaw0 = car.yaw, r = crashRun(car, {}, [o], 0.6);
  var c0 = carFor('bmw-m3-competition', TB, { s: S0 + 20, d: 0 }), o2 = Object.assign({}, o, { x: a.x, z: a.z, x0: a.x, z0: a.z });
  var rc = crashRun(c0, {}, [o2], 0.6);
  ok(r.hit && r.rMax > 0.8 && r.rMax > rc.rMax * 3, 'Treffer hinten außermittig dreht: Gierrate ' + r.rMax.toFixed(2) + ' rad/s (mittig ' + rc.rMax.toFixed(2) + '), Drehung ' + (car.yaw - yaw0).toFixed(2) + ' rad');
})();
// schwer gegen leicht: gleicher Stoß von hinten (4,5er Auto mit 15 m/s), leichtes Auto wird viel stärker geschoben
(function () {
  function shove(key) {
    var car = carFor(key, TB, { s: S0 + 20, d: 0 }), a = TB.at(S0 + 13.5);
    var o = { x: a.x, z: a.z, yaw: a.yaw, len: 4.5, w: 1.9, mass: 4.5, vx: Math.cos(a.yaw) * 15, vz: -Math.sin(a.yaw) * 15 };
    o.x0 = o.x; o.z0 = o.z; o.yaw0 = o.yaw;
    crashRun(car, {}, [o], 0.4, true);
    return { dv: car.u, m: car.P.mass };
  }
  var light = shove('krabby-patty-wagon'), heavy = shove('ural-4320-soviet-army-truck');
  ok(light.dv > heavy.dv * 2.5, 'leicht (Masse ' + light.m.toFixed(1) + ') geschoben auf ' + light.dv.toFixed(1) + ' m/s, schwer (Masse ' + heavy.m.toFixed(1) + ') nur ' + heavy.dv.toFixed(1) + ' m/s');
  // umgekehrt: rammt man selbst ein 4,5er Auto mit 20 m/s, verliert der Laster wenig, das leichte Auto viel
  function ram(key) {
    var car = carFor(key, TB, { s: S0, d: 0 }), o = busAt(S0 + 10, 0, 0); o.len = 4.5; o.w = 1.9; o.mass = 4.5;
    o.x0 = o.x; o.z0 = o.z; o.yaw0 = o.yaw;
    setSpeed(car, 20); var r = crashRun(car, {}, [o], 0.5, true); return r.vOut / r.vIn;
  }
  var kl = ram('krabby-patty-wagon'), kh = ram('ural-4320-soviet-army-truck');
  ok(kh > 0.6 && kl < kh - 0.3, 'Rammen: Laster behält ' + (kh * 100).toFixed(0) + ' % Tempo, leichtes Auto ' + (kl * 100).toFixed(0) + ' %');
})();

// 14) Lenkung: kein hartes Untersteuern – voller Einschlag nutzt bei Tempo die Kurvenhaftung aus; Einschlag je Auto
(function () {
  var T = Sim.track(1);
  [10, 18, 26].forEach(function (v) {
    var car = carFor('2020-ferrari-roma', T, { s: -40, d: -3 });
    var fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw); car.vx = fx * v; car.vz = fz * v;
    var best = 0;
    for (var t = 0; t < 1.5; t += DT) {
      var h0 = Math.atan2(car.vz, car.vx); Phys.step(car, { steer: 1, throttle: 0.3 }, DT);
      if (car.surface !== 'asphalt') break;
      var dh = Math.atan2(car.vz, car.vx) - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      best = Math.max(best, Math.abs(dh / DT) * Math.hypot(car.vx, car.vz));
    }
    ok(best >= car.P.grip * (v < 12 ? 0.7 : 0.85), 'voller Einschlag bei ' + v + ' m/s: Querbeschleunigung ' + best.toFixed(1) + ' von ' + car.P.grip.toFixed(1) + ' m/s² Haftung');
  });
  var lk = function (k) { var g = Stats.guess({ key: k, name: k, len: 4.5 }); return Phys.params(Sim.stats(g), g).lock * 180 / Math.PI; };
  ok(lk('krabby-patty-wagon') > lk('2020-ferrari-roma') && lk('2020-ferrari-roma') > lk('amg-w14-s1'),
     'Einschlag je Auto: Krabby ' + lk('krabby-patty-wagon').toFixed(0) + '° > Roma ' + lk('2020-ferrari-roma').toFixed(0) + '° > W14 ' + lk('amg-w14-s1').toFixed(0) + '°');
})();

console.log(fails ? fails + ' Prüfung(en) fehlgeschlagen' : 'alles ok');
process.exit(fails ? 1 : 0);
