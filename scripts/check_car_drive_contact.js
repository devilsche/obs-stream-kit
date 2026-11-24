#!/usr/bin/env node
/* Prüfung Kontakte Auto ↔ Auto (js/car-drive-phys.js overlap/collide/stepContacts, js/car-drive-net.js extrapolate):
 *   node scripts/check_car_drive_contact.js
 * 1) Umriss: Hülle einer autoähnlichen Punktwolke hat ≤ 16 Ecken, ist konvex, kleiner als die Bounding-Box, Ecken frei
 * 2) Nebeneinander anlehnen (Mitspieler, gleich schnell, 0,1 m Überlappung, 5 s): kaum Querbewegung, kein Crash
 * 3) Auffahren mit Δv 6 m/s (Mitspieler): ein Crash, Hinterer langsamer, Vorderer schneller, kaum Rückprall
 * 4) Mehrspieler mit 150 ms Laufzeit: zwei Clients, einer drückt seitlich hinein – mit Voraussage + weichem Kontakt
 *    wenige Crashs, kein Wegschleudern (zum Vergleich der alte Weg: Puffer-Lage, harter Kontakt)
 */
'use strict';
var path = require('path');
var Sim = require(path.join(__dirname, '../js/car-race-sim.js'));
var Stats = require(path.join(__dirname, '../js/car-race-stats.js'));
var Phys = require(path.join(__dirname, '../js/car-drive-phys.js'));
var Net = require(path.join(__dirname, '../js/car-drive-net.js'));

var fails = 0, DT = 1 / 60;
function ok(c, m) { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; }
function carFor(key, T, pose) {
  var raw = Stats.guess({ key: key, len: 4.5 }), st = Sim.stats(raw);
  return Phys.create(T, Phys.params(st, raw), pose);
}
function setSpeed(car, v) { car.vx = Math.cos(car.yaw) * v; car.vz = -Math.sin(car.yaw) * v; car.u = v; car.w = 0; }
function dims(car) { return { len: car.P.len, w: car.P.width }; }
var T = Sim.track(1), S0 = 60;   // Speedway, lange Start-/Zielgerade

// 1) Umriss
(function () {
  var pts = [], L = 4.5, W = 1.9;
  for (var i = 0; i <= 200; i++) {
    var x = -L / 2 + L * i / 200, e = Math.abs(x) / (L / 2), half = W / 2 * Math.sqrt(Math.max(0, 1 - Math.pow(e, 6)));
    pts.push([x, half], [x, -half]);
  }
  pts.push([0.3, W / 2 + 0.25], [0.3, -W / 2 - 0.25]);   // Spiegel (liegen im Modell über dem Höhenband – hier zur Probe drin)
  var sh = Phys.outline(pts, 16), area = 0, convex = true;
  for (var k = 0; k < sh.length; k++) {
    var a = sh[k], b = sh[(k + 1) % sh.length], c = sh[(k + 2) % sh.length];
    area += a[0] * b[1] - b[0] * a[1];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-9) convex = false;
  }
  area = Math.abs(area) / 2;
  var corner = Phys.overlap({ x: 0, z: 0, yaw: 0, len: L, w: W, shape: sh }, { x: L / 2 + 0.02, z: -(W / 2 + 0.02), yaw: 0, len: 0.06, w: 0.06 });
  ok(sh.length <= 16 && convex, 'Umriss: ' + sh.length + ' Ecken, konvex');
  ok(area < L * (W + 0.5) * 0.9 && !corner, 'Umriss kleiner als die Box (' + area.toFixed(2) + ' m² statt ' + (L * (W + 0.5)).toFixed(2) + '), Box-Ecke frei');
  var rr = Phys.roundedRect(4.5, 1.9);
  ok(rr.length === 16 && !Phys.overlap({ x: 0, z: 0, yaw: 0, len: 4.5, w: 1.9 }, { x: 2.25, z: 0.95, yaw: 0, len: 0.1, w: 0.1 }),
    'Ersatz-Umriss: Rechteck mit runden Ecken (16 Punkte, Ecke frei)');
})();

// Zwei Mitspieler auf demselben Rechner ohne Laufzeit (jeder sieht den anderen genau). Harte Kontakte gehen wie im
// Spiel als bump an den anderen (−J), wenn der den Kontakt nicht selbst gerade gerechnet hat (js/car-drive.js peerBump)
function bumpTo(car, h) {
  var fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw), lx = -Math.sin(car.yaw), lz = -Math.cos(car.yaw);
  car.vx -= h.jx / car.P.mass; car.vz -= h.jz / car.P.mass;
  car.u = car.vx * fx + car.vz * fz; car.w = car.vx * lx + car.vz * lz;
}
function duel(a, b, inA, inB, secs, onFrame) {
  var r = { crashA: 0, crashB: 0, touch: 0, ca: {}, cb: {}, tA: -9, tB: -9, bumps: 0 };
  for (var t = 0; t < secs; t += DT) {
    var pa = { x: a.x, z: a.z, yaw: a.yaw, len: a.P.len, w: a.P.width, vx: a.vx, vz: a.vz, mass: a.P.mass, peer: true, c: r.ca };
    var pb = { x: b.x, z: b.z, yaw: b.yaw, len: b.P.len, w: b.P.width, vx: b.vx, vz: b.vz, mass: b.P.mass, peer: true, c: r.cb };
    var toB = null, toA = null;
    Phys.stepContacts(a, inA, DT, dims(a), [pb], function (o, h) {
      r.tA = t; if (h.impact >= Phys.CRASH_V) { r.crashA++; toB = h; } else r.touch++;
    });
    Phys.stepContacts(b, inB, DT, dims(b), [pa], function (o, h) {
      r.tB = t; if (h.impact >= Phys.CRASH_V) { r.crashB++; toA = h; } else r.touch++;
    });
    if (toB && t - r.tB > 0.3) { bumpTo(b, toB); r.tB = t; r.bumps++; }
    if (toA && t - r.tA > 0.3) { bumpTo(a, toA); r.tA = t; r.bumps++; }
    if (onFrame) onFrame(t);
  }
  return r;
}
function side(car, a) { return (car.x - a.x) * a.nx + (car.z - a.z) * a.nz; }

// 2) nebeneinander anlehnen
(function () {
  var a = carFor('bmw-m3-competition', T, { s: S0, d: 0 }), A0 = T.at(S0), w = a.P.width;
  var b = carFor('bmw-m3-competition', T, { s: S0, d: w - 0.1 });
  setSpeed(a, 20); setSpeed(b, 20);
  var vq = 0;
  var r = duel(a, b, { throttle: 0.5 }, { throttle: 0.5 }, 5, function () {
    var A = T.at(a.prog);
    vq = Math.max(vq, Math.abs(a.vx * A.nx + a.vz * A.nz), Math.abs(b.vx * A.nx + b.vz * A.nz));
  });
  ok(vq < 0.5 && r.crashA + r.crashB === 0, 'nebeneinander anlehnen 5 s: größte Querbewegung ' + vq.toFixed(2) + ' m/s, ' + (r.crashA + r.crashB) + ' Crashs');
})();

// 3) Auffahren Δv 6 m/s
(function () {
  var a = carFor('bmw-m3-competition', T, { s: S0, d: 0 }), b = carFor('bmw-m3-competition', T, { s: S0 + 5.5, d: 0 });
  setSpeed(a, 20); setSpeed(b, 14);
  var r = duel(a, b, {}, {}, 0.8);
  var sep = b.u - a.u;
  ok(r.crashA + r.crashB >= 1 && r.crashA + r.crashB <= 2, 'Auffahren Δv 6: ein Crash (' + r.crashA + '/' + r.crashB + ', ' + r.bumps + ' bump)');
  ok(a.u < 19 && b.u > 14.5 && sep >= -0.2 && sep <= 0.25 * 6, 'Auffahren: hinten ' + a.u.toFixed(1) + ' m/s, vorn ' + b.u.toFixed(1) + ' m/s, Trenntempo ' + sep.toFixed(2) + ' m/s');
})();

// 4) Mehrspieler mit Laufzeit: jeder sieht den anderen LAT s alt (Zustände 30 Hz). Beide halten ihre Spur (Lenkregler),
// A zieht 0,5–2 s auf B's Spur hinüber und drückt ihn – wie viele Crashs, wie stark wird B quer weggestoßen, springt etwas?
function holdLane(car, dT) {
  var A = T.at(car.prog + 14), px = A.x + A.nx * dT, pz = A.z + A.nz * dT;
  var err = Math.atan2(-(pz - car.z), px - car.x) - car.yaw;
  while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
  return { throttle: 0.55, steer: Math.max(-1, Math.min(1, err * 2.2)) };
}
function mpRun(newWay) {
  var LAT = 0.15, W = 0, a = carFor('bmw-m3-competition', T, { s: S0, d: 0 });
  W = a.P.width;
  var b = carFor('bmw-m3-competition', T, { s: S0, d: W + 0.4 });
  setSpeed(a, 22); setSpeed(b, 22);
  var hist = { a: [], b: [] }, r = { crash: 0, latB: 0, maxJump: 0 }, sendT = 0, ca = {}, cb = {}, prev = null;
  function snap(car, t) { return { ts: t, x: car.x, z: car.z, yaw: car.yaw, speed: Math.hypot(car.vx, car.vz), prog: car.prog, roll: 0, pitch: 0, steer: 0, spin: 0 }; }
  function view(list, t) {
    var s = null;
    for (var i = list.length - 1; i >= 0; i--) if (list[i].ts <= t - LAT) { s = list[i]; break; }
    if (!s) return null;
    if (!newWay) return s;                                  // alter Weg: Lage aus dem Puffer, Vergangenheit
    return Net.extrapolate(s, Math.min(Net.PRED_MAX, t - s.ts), T);
  }
  for (var t = 0; t < 4; t += DT) {
    if (t >= sendT) { hist.a.push(snap(a, t)); hist.b.push(snap(b, t)); sendT += 1 / 30; }
    var va = view(hist.a, t), vb = view(hist.b, t);
    var inA = holdLane(a, t > 0.5 && t < 2 ? W + 0.4 : 0), inB = holdLane(b, W + 0.4);
    [[a, vb, inA, cb], [b, va, inB, ca]].forEach(function (x) {
      var me = x[0], v = x[1];
      if (!v) { Phys.step(me, x[2], DT); return; }
      var o = { x: v.x, z: v.z, yaw: v.yaw, len: me.P.len, w: me.P.width, vx: Math.cos(v.yaw) * v.speed, vz: -Math.sin(v.yaw) * v.speed,
        mass: me.P.mass, peer: newWay, c: x[3] };
      Phys.stepContacts(me, x[2], DT, dims(me), [o], function (oo, h) { if (h.impact >= Phys.CRASH_V) r.crash++; });
    });
    var A = T.at(b.prog);
    r.latB = Math.max(r.latB, Math.abs(b.vx * A.nx + b.vz * A.nz));
    if (prev) r.maxJump = Math.max(r.maxJump, Math.hypot(b.x - prev.x - b.vx * DT, b.z - prev.z - b.vz * DT));
    prev = { x: b.x, z: b.z };
  }
  return r;
}
(function () {
  var oldW = mpRun(false), newW = mpRun(true);
  console.log('     alter Weg (Puffer-Lage, harter Kontakt): ' + oldW.crash + ' Crashs, B quer bis ' + oldW.latB.toFixed(2) + ' m/s, größter Sprung ' + (oldW.maxJump * 100).toFixed(1) + ' cm');
  ok(newW.crash <= 2, 'Mehrspieler 150 ms: ' + newW.crash + ' Crashs (alter Weg ' + oldW.crash + ')');
  ok(newW.latB < 3, 'Mehrspieler 150 ms: B wird nicht weggeschleudert (quer bis ' + newW.latB.toFixed(2) + ' m/s)');
  ok(newW.maxJump < 0.05, 'Mehrspieler 150 ms: kein Sprung, größter Versatz je Bild ' + (newW.maxJump * 100).toFixed(1) + ' cm');
})();

console.log(fails ? fails + ' Fehler' : 'alles ok');
process.exit(fails ? 1 : 0);
