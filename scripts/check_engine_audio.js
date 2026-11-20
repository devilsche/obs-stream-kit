// Prüfskript für die Rechnung von js/car-engine-audio.js (ohne Web Audio): Gangmodell (inkl. Schalten), Schleifen-Leiter,
// Überblendung, Abspielrate, Sweep-Abbildung Drehzahl ↔ Stelle, Korn-Raster/Lesekopf, Hann, Ebenen-Mix, Begrenzer (Frequenz/Tiefe je
// Motorart), Höchsttempo-Drehzahl im obersten Gang, Lesestellen bei gleichbleibender Drehzahl (keine kurze Wiederkehr), Motorklang je Auto
// aus dem Car editor (cleanSound, Kenndaten, Gangsprünge, von Hand schalten, markierte Abschnitte); dazu bank.json + src/ (Dateien vorhanden, Schleifenpunkte gültig) und die Motorart je Auto.
// Aufruf: node scripts/check_engine_audio.js
'use strict';
var path = require('path'), fs = require('fs');
var E = require('../js/car-engine-audio.js'), M = E.Model, S = require('../js/car-race-stats.js');
var fails = 0;
function ok(c, msg) { if (!c) { fails++; console.log('FEHLER: ' + msg); } }
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= eps, msg + ' (' + a + ' ≠ ' + b + ')'); }

var SPEC = { idle: 800, red: 7000, gears: 6, g1: 0.28 };
// Übersetzungen: oberster Gang 1, erster Gang = 1/g1
var r = M.ratios(SPEC);
ok(r.length === 6, 'sechs Gänge');
near(r[5], 1, 1e-9, 'oberster Gang 1');
near(r[0], 1 / 0.28, 1e-9, 'erster Gang 1/g1');
for (var i = 1; i < r.length; i++) ok(r[i] < r[i - 1], 'Übersetzungen fallen');
near(M.rpmAt(SPEC, 6, 1), 7000 * M.tune(SPEC).vtop, 1e-6, 'Höchsttempo im letzten Gang unter dem Begrenzer');

// Gangmodell: im Stand Leerlauf, Gas im Stand dreht hoch, Beschleunigen schaltet hoch, Drehzahl bleibt im Band
var st = {}, t, dt = 1 / 60;
for (t = 0; t < 1; t += dt) M.gearStep(SPEC, st, 0, 0, dt);
near(st.rpm, 800, 5, 'Leerlauf im Stand');
for (t = 0; t < 0.6; t += dt) M.gearStep(SPEC, st, 0, 1, dt);
ok(st.rpm > 5000, 'Gasstoß im Stand dreht hoch (' + Math.round(st.rpm) + ')');
for (t = 0; t < 1.5; t += dt) M.gearStep(SPEC, st, 0, 0, dt);
ok(st.rpm < 1200, 'danach zurück in den Leerlauf (' + Math.round(st.rpm) + ')');
st = {};
var gears = [], ups = 0, minR = 1e9, maxR = 0;
for (t = 0; t < 20; t += dt) {
  var sp = Math.min(1, t / 18);
  M.gearStep(SPEC, st, sp, 1, dt);
  if (st.shifted > 0) ups++;
  if (t > 2) { minR = Math.min(minR, st.rpm); maxR = Math.max(maxR, st.rpm); }
  gears.push(st.gear);
}
ok(ups === 5, 'Vollgas bis vmax: fünfmal hochschalten (' + ups + ')');
ok(st.gear === 6, 'am Ende im sechsten Gang');
ok(maxR <= 7000 * 1.001, 'nie über dem Begrenzer (' + Math.round(maxR) + ')');
ok(minR > 7000 * 0.45, 'unter Vollgas nicht unter halber Drehzahl (' + Math.round(minR) + ')');
for (i = 1; i < gears.length; i++) ok(gears[i] >= gears[i - 1], 'beim Beschleunigen nur hochschalten');
// Ausrollen: zurückschalten, kein Pendeln (höchstens ein Wechsel je Gang)
var downs = 0, prevG = st.gear, flips = 0, lastDir = 0;
for (t = 0; t < 20; t += dt) {
  M.gearStep(SPEC, st, Math.max(0, 1 - t / 18), 0, dt);
  if (st.gear !== prevG) { var dir = st.gear > prevG ? 1 : -1; if (lastDir && dir !== lastDir) flips++; lastDir = dir; if (dir < 0) downs++; prevG = st.gear; }
}
ok(downs >= 4 && flips === 0, 'Ausrollen schaltet zurück ohne Pendeln (runter ' + downs + ', Richtungswechsel ' + flips + ')');
// Teilgas schaltet früher als Vollgas
function shiftRpm(thr) { var s = {}, last = 0; for (var tt = 0; tt < 10; tt += dt) { var prev = s.rpm || 0; M.gearStep(SPEC, s, tt / 30, thr, dt); if (s.shifted > 0) return prev; } return last; }
ok(shiftRpm(0.4) < shiftRpm(1), 'Teilgas schaltet früher');
// E-Motor: ein Gang, Drehzahl ∝ Tempo, kein Leerlauf
var EV = { idle: 0, red: 16000, gears: 1, g1: 1 }, se = {};
for (t = 0; t < 1; t += dt) M.gearStep(EV, se, 0.5, 1, dt);
near(se.rpm, 8000, 50, 'E-Motor halbe Drehzahl bei halbem Tempo');

// Leiter + Überblendung
var loops = [{ rpm: 900, src: 1, f: 'a' }, { rpm: 950, src: 2, f: 'b' }, { rpm: 2000, src: 1, f: 'c' }, { rpm: 2100, src: 3, f: 'd' },
  { rpm: 4000, src: 2, f: 'e' }, { rpm: 6500, src: 3, f: 'f' }];
var L = M.ladder(loops, 'auto-x');
ok(L.length === 4, 'Leiter: ähnliche Drehzahlen (±10 %) bilden eine Stufe (' + L.length + ')');
for (i = 1; i < L.length; i++) ok(L[i].rpm > L[i - 1].rpm, 'Leiter aufsteigend');
var L2 = M.ladder(loops, 'auto-x');
ok(JSON.stringify(L) === JSON.stringify(L2), 'Leiter je Auto stabil');
var differ = false;
['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(function (k) { if (JSON.stringify(M.ladder(loops, k)) !== JSON.stringify(L)) differ = true; });
ok(differ, 'verschiedene Autos bekommen verschiedene Aufnahmen');
ok(M.ladder(loops, 'z', 3).length <= 3, 'lite: höchstens 3 Stufen');
var w = M.weights(L, 500);
ok(w.length === 1 && w[0].i === 0 && w[0].g === 1, 'unter der untersten Stufe nur die unterste');
w = M.weights(L, 99999);
ok(w.length === 1 && w[0].i === L.length - 1, 'über der obersten nur die oberste');
w = M.weights(L, L[1].rpm);
ok(w.some(function (x) { return x.i === 1 && Math.abs(x.g - 1) < 1e-9; }), 'genau auf einer Stufe: volle Stufe');
for (var rpm = L[0].rpm; rpm < L[L.length - 1].rpm; rpm += 37) {
  w = M.weights(L, rpm);
  var pw = w.reduce(function (a, x) { return a + x.g * x.g; }, 0);
  near(pw, 1, 1e-9, 'gleiche Leistung bei ' + rpm);
}
near(M.rate(3000, 1500), 2, 1e-9, 'Rate = rpm / Schleifen-rpm');
ok(M.rate(100000, 1000) === 2.4 && M.rate(1, 1000) === 0.45, 'Rate begrenzt');

// Sweeps: Drehzahl → Stelle (auch fallend), Umkehrung, Ränder
var SW = M.prepSweep({ pts: [[0.15, 1000], [1.15, 2000], [2.15, 4000], [3.15, 4000], [3.65, 6000]] });
near(M.sweepPos(SW, 1500).t, 0.65, 1e-9, 'Sweep: 1500 U/min mitten zwischen 1000 und 2000');
near(M.sweepPos(SW, 3000).t, 1.65, 1e-9, 'Sweep: 3000 U/min');
near(M.sweepPos(SW, 500).t, 0.15, 1e-9, 'Sweep: unterhalb → Anfang');
ok(M.sweepPos(SW, 500).r === 1000, 'Sweep: unterhalb → Drehzahl am Anfang');
near(M.sweepPos(SW, 9000).t, 3.65, 1e-9, 'Sweep: oberhalb → Ende');
for (var rr = 1000; rr <= 6000; rr += 250) {
  var tp = M.sweepPos(SW, rr).t;
  near(M.sweepRpm(SW, tp), rr, 1e-6, 'Sweep: Stelle → Drehzahl zurück bei ' + rr);
}
var SD = M.prepSweep({ pts: [[0.1, 5000], [1.1, 2500], [2.1, 1000]] });
near(M.sweepPos(SD, 3750).t, 0.6, 1e-9, 'Abfall-Sweep: 3750 U/min');
ok(SD.lo === 1000 && SD.hi === 5000, 'Abfall-Sweep: Bereich');
var lastT = -1, mono = true;
for (rr = 1000; rr <= 5000; rr += 100) { var tt2 = M.sweepPos(SD, rr).t; if (tt2 > lastT && lastT >= 0) mono = false; lastT = tt2; }
ok(mono, 'Abfall-Sweep: höhere Drehzahl = frühere Stelle');
// Band: um die Drehzahl, mindestens minSpan lang (oder ±12 %), a < b
var bnd = M.band(SW, 3000, 0.35);
ok(bnd.a < bnd.b && M.sweepRpm(SW, bnd.a) <= 3000 && M.sweepRpm(SW, bnd.b) >= 3000, 'Band umschließt die Drehzahl');
ok(bnd.b - bnd.a >= 0.35 || (M.sweepRpm(SW, bnd.b) / 3000 > 1.08), 'Band lang genug oder ±9 % (' + (bnd.b - bnd.a).toFixed(3) + ' s)');
var bdn = M.band(SD, 2000, 0.35);
var bE = M.band(SW, 9000, 0.35, 3.8);
ok(bE.b - bE.a >= 0.35 - 1e-9 && bE.b <= 3.8 && bE.a >= 0, 'Band am oberen Rand auf Mindestlänge verlängert (' + bE.a.toFixed(2) + '–' + bE.b.toFixed(2) + ')');
ok(bdn.a < bdn.b, 'Band im Abfall-Sweep a < b');
// Korn-Raster: ganzer Motorzyklus, lange Zyklen auf Vielfache der Zündperiode ≥ 35 ms
near(M.period(6000, 8), 0.02, 1e-12, 'Periode = Motorzyklus 120/U/min');
[[900, 4], [700, 8], [600, 6], [1000, 12], [450, 8]].forEach(function (c) {
  var P = M.period(c[0], c[1]), pf = 120 / c[0] / c[1];
  ok(P >= 0.035 - 1e-12 && P <= 0.07 + 1e-9, 'Periode im Rahmen bei ' + c[0] + '/' + c[1] + ' (' + P.toFixed(4) + ')');
  near(P / pf, Math.round(P / pf), 1e-9, 'Periode = Vielfaches der Zündperiode bei ' + c[0] + '/' + c[1]);
});
// Lesekopf: höchstens eine halbe Periode neben der Zielstelle, nur um ganze Perioden verschoben (Phase bleibt)
[[1.234, 1.0, 0.02, 0], [0.5, 0.9, 0.033, 0], [2.0, 2.0, 0.05, 1], [0.1, 3.0, 0.04, -1]].forEach(function (c) {
  var h = M.grainHead(c[0], c[1], c[2], c[3]), d = h - c[1] - c[3] * c[2];
  ok(Math.abs(d) <= c[2] / 2 + 1e-9, 'Lesekopf nahe Ziel (' + h.toFixed(4) + ')');
  near((h - c[0]) / c[2], Math.round((h - c[0]) / c[2]), 1e-9, 'Lesekopf um ganze Perioden verschoben');
});
// WSOLA-Feinsuche: in einer periodischen Welle (Periode 9,7 ms) liegt die beste Stelle phasengleich zur Fortsetzung
var SRt = 8000, per = 0.0097, wave = new Float32Array(SRt * 2);
for (i = 0; i < wave.length; i++) { var ph = (i / SRt) / per; wave[i] = Math.sin(2 * Math.PI * ph) + 0.5 * Math.sin(4 * Math.PI * ph + 1); }
[[0.4, 0.9031], [0.7, 1.2], [1.0, 0.5555]].forEach(function (c) {
  var bm = M.bestMatch(wave, SRt, c[0], c[1], 0.03, per / 2, 1, 1), dph = ((bm - c[0]) / per) % 1;
  dph = Math.min(Math.abs(dph), 1 - Math.abs(dph));
  ok(dph < 0.02 && Math.abs(bm - c[1]) <= per / 2 + 1 / SRt, 'WSOLA: phasengleich und nahe am Ziel (' + bm.toFixed(4) + ', Phase ' + dph.toFixed(3) + ')');
});
ok(M.bestMatch(wave, SRt, 0.001, 0.5, 0.03, 0.005, 1, 1) === 0.5, 'WSOLA: ohne Vorlauf bleibt das Ziel');
// Hann-Fenster: Ränder 0, Mitte 1, halb überlappend Summe ≈ 1
var H = M.hann(65);
ok(H[0] === 0 && Math.abs(H[64]) < 1e-6 && Math.abs(H[32] - 1) < 1e-6, 'Hann: Ränder 0, Mitte 1');
for (i = 0; i < 32; i++) near(H[i] + H[i + 32], 1, 0.01, 'Hann 50 % Überlappung = 1 bei ' + i);
// Ebenen-Mix: gleiche Leistung, Leerlauf nur unten, Last verteilt auf Gas/Schub
var SPM = { idle: 800, red: 7000 };
[[800, 0], [800, 1], [1000, 0.5], [1300, 0.3], [3000, 0], [3000, 1], [6000, 0.7]].forEach(function (c) {
  var m = M.layerMix(SPM, c[0], c[1], true, true);
  near(m.idle * m.idle + m.on * m.on + m.off * m.off, 1, 1e-9, 'Mix gleiche Leistung bei ' + c[0] + '/' + c[1]);
});
ok(M.layerMix(SPM, 800, 0, true, true).idle > 0.999, 'Mix: im Leerlauf nur Leerlauf-Schleife');
ok(M.layerMix(SPM, 3000, 0.5, true, true).idle < 1e-9, 'Mix: bei 3000 keine Leerlauf-Schleife');
var mf = M.layerMix(SPM, 4000, 1, true, true);
ok(mf.on > 0.999 && mf.off < 1e-6, 'Mix: Vollgas nur Hochlauf');
var mo = M.layerMix(SPM, 4000, 0, true, true);
ok(mo.off > 0.999 && mo.on < 1e-6, 'Mix: Gas weg nur Abfall');
var mn = M.layerMix(SPM, 4000, 0, true, false);
ok(mn.off === 0 && mn.on > 0.5 && mn.on < M.layerMix(SPM, 4000, 1, true, false).on, 'Mix ohne Abfall: Hochlauf leiser ohne Last');
ok(M.layerMix(SPM, 800, 0, false, true).idle === 0, 'Mix ohne Leerlauf-Schleife: Sweeps tragen');
// Schalten: Drehzahl fällt nach dem Hochschalten schnell um den Gangsprung, kurz Last weg
st = {};
var drop = null;
for (t = 0; t < 12 && drop == null; t += dt) {
  var before = st.rpm;
  M.gearStep(SPEC, st, Math.min(1, t / 10), 1, dt);
  if (st.shifted > 0) {
    var cutSeen = st.cut > 0, s2 = st;
    for (var k2 = 0; k2 < Math.round(0.15 / dt); k2++) M.gearStep(SPEC, s2, Math.min(1, (t + (k2 + 1) * dt) / 10), 1, dt);
    drop = { before: before, after: s2.rpm, cut: cutSeen };
  }
}
ok(drop && drop.after < drop.before * 0.85, 'Hochschalten: Drehzahl fällt in 0,15 s deutlich (' + (drop && Math.round(drop.before)) + ' → ' + (drop && Math.round(drop.after)) + ')');
ok(drop && drop.cut, 'Hochschalten: kurz Last weg');
// Zurückschalten ohne Gas: Zwischengas
st = { rpm: 3000, gear: 4, cut: 0, lim: 0, blip: 0 };
var blipSeen = false;
for (t = 0; t < 6; t += dt) { M.gearStep(SPEC, st, Math.max(0.06, 0.5 - t / 8), 0, dt); if (st.shifted < 0 && st.blip > 0) blipSeen = true; }
ok(blipSeen, 'Zurückschalten ohne Gas: Zwischengas');
// Zustand ohne cut/lim (nach vorgegebener Drehzahl im Lab): schaltet trotzdem hoch, nie weit über den Begrenzer
st = { rpm: 5000, gear: 1 }; var maxR2 = 0;
for (t = 0; t < 12; t += dt) { M.gearStep(SPEC, st, Math.min(1, t / 10), t < 10 ? 1 : 0, dt); maxR2 = Math.max(maxR2, st.rpm); }
ok(st.gear >= 5 && maxR2 <= SPEC.red * 1.021, 'Lab-Zustand: schaltet hoch (Gang ' + st.gear + '), höchstens Begrenzer (' + Math.round(maxR2) + ')');
// erzwungenes Hochschalten (Engine sound lab)
st = {}; for (t = 0; t < 1; t += dt) M.gearStep(SPEC, st, 0.15, 1, dt);
var g0 = st.gear; st.force = 1; M.gearStep(SPEC, st, 0.15, 1, dt);
ok(st.gear === g0 + 1 && st.shifted === 1, 'erzwungenes Hochschalten');

// ---- Begrenzer, Höchsttempo, gleichbleibende Drehzahl – je Motorart (Abstimmung aus TUNE, Daten aus bank.json)
var bankJ = (function () { try { return require('../assets/sounds/engines/bank.json'); } catch (e) { return null; } })();
function typeSpec(id) {
  var b = bankJ && bankJ.types[id];
  return Object.assign({ idle: 800, red: 7000, gears: 6, g1: 0.28, cyl: 6 }, b ? { idle: b.idle, red: b.red, gears: b.gears, g1: b.g1, cyl: b.cyl } : {}, { type: id });
}
// Begrenzer im Stand (ausgekuppelt, Vollgas halten): Frequenz und Tiefe messen (fein abgetastet)
function limiterRun(spec, secs, h) {
  var s = {}, mins = 0, lo = 1e9, hi = 0, on = 0, prevD = 0, prevR = null;
  for (var tt = 0; tt < secs; tt += h) {
    M.gearStep(spec, s, 0, 1, h);
    if (tt < 1) continue;
    if (s.limiter) on++;
    lo = Math.min(lo, s.rpm); hi = Math.max(hi, s.rpm);
    if (prevR != null) { var dR = s.rpm - prevR; if (prevD < 0 && dR >= 0) mins++; if (dR !== 0) prevD = dR; }
    prevR = s.rpm;
  }
  return { hz: mins / (secs - 1), lo: lo, hi: hi, on: on * h / (secs - 1) };
}
E.TYPES.forEach(function (tp) {
  var spc = typeSpec(tp.id), tn = M.tune(spc);
  if (spc.gears <= 1) {
    var se2 = {}; for (t = 0; t < 2; t += dt) M.gearStep(spc, se2, 1, 1, dt);
    ok(!se2.limiter, tp.id + ': E-Motor ohne Begrenzer');
    return;
  }
  // Begrenzer: 10–20 Hz (Diesel: weicher Regler 3–8 Hz), Einbruch 2–8 %, nie über dem Begrenzer
  var lr = limiterRun(spc, 4, 1 / 2000);
  ok(lr.on > 0.99, tp.id + ': Vollgas im Stand → Begrenzer arbeitet durchgehend (' + lr.on.toFixed(2) + ')');
  near(lr.hz, tn.hz, tn.hz * 0.06, tp.id + ': Begrenzer-Frequenz');
  ok(tn.soft ? lr.hz >= 3 && lr.hz <= 8 : lr.hz >= 10 && lr.hz <= 20.5, tp.id + ': Begrenzer-Frequenz im Rahmen (' + lr.hz.toFixed(1) + ' Hz)');
  var depth = 1 - lr.lo / spc.red;
  ok(depth >= 0.02 && depth <= 0.08 && lr.hi <= spc.red * 1.0001, tp.id + ': Begrenzer-Einbruch ' + (depth * 100).toFixed(1) + ' %, höchstens Begrenzer');
  ok(tn.soft || tn.dip <= 0.55, tp.id + ': Begrenzer-Schnitt deutlich hörbar (Pegel ' + tn.dip + ')');
  // bei 60 Bildern/s genauso (Zustand), Gas weg → sofort aus
  var s60 = {}; for (t = 0; t < 2; t += dt) M.gearStep(spc, s60, 0, 1, dt);
  ok(s60.limiter === 1 && s60.limN >= Math.floor(tn.hz * 1.2), tp.id + ': Begrenzer auch bei 60 Bildern/s (' + s60.limN + ' Schnitte)');
  M.gearStep(spc, s60, 0, 0.2, dt);
  ok(!s60.limiter, tp.id + ': Gas weg → Begrenzer aus');
  // Teilgas im Stand bleibt unter dem Begrenzer
  var sp2 = {}; for (t = 0; t < 2; t += dt) M.gearStep(spc, sp2, 0, 0.8, dt);
  ok(!sp2.limiter && sp2.rpm < spc.red * 0.9, tp.id + ': Teilgas im Stand ohne Begrenzer (' + Math.round(sp2.rpm) + ')');
  // Höchsttempo im obersten Gang: 90–95 % des Begrenzers
  var vr = M.rpmAt(spc, spc.gears, 1) / spc.red;
  ok(vr >= 0.9 && vr <= 0.95, tp.id + ': Höchsttempo im obersten Gang bei ' + (vr * 100).toFixed(1) + ' % des Begrenzers');
  ok(tn.shift >= 0.92 && tn.shift <= 0.97, tp.id + ': Schaltpunkt ' + tn.shift);
  // Vollgas durch alle Gänge bis Höchsttempo: hochschalten vor dem Begrenzer, nie Begrenzer, oben 90–95 %
  var sa = {}, limSeen = 0, upAt = [], prev = 0;   // Tempo ab 0,5 s über 1 % (vorher Stand = ausgekuppelt)
  for (t = 0; t < 40; t += dt) {
    prev = sa.rpm || 0;
    M.gearStep(spc, sa, Math.min(1, t / 30), 1, dt);
    if (sa.limiter && t > 0.5) limSeen++;            // im Stand (Anfahren) darf er kurz kommen
    if (sa.shifted > 0) upAt.push(prev / spc.red);
  }
  ok(sa.gear === spc.gears && upAt.length === spc.gears - 1, tp.id + ': Vollgas schaltet bis in den obersten Gang (' + upAt.length + ')');
  ok(!limSeen, tp.id + ': Vollgas mit Hochschalten nie im Begrenzer (' + limSeen + ' Bilder)');
  ok(upAt.every(function (x) { return x <= tn.shift + 0.01 && x < 0.985; }), tp.id + ': Hochschalten vor dem Begrenzer (max ' + Math.max.apply(null, upAt).toFixed(3) + ')');
  var endR = sa.rpm / spc.red;
  ok(endR >= 0.89 && endR <= 0.95 && !sa.limiter, tp.id + ': Höchsttempo-Drehzahl ' + (endR * 100).toFixed(1) + ' % ohne Begrenzer');
  // Gang gehalten bei Übertempo (bergab / Windschatten): Begrenzer
  var so = {}; for (t = 0; t < 3; t += dt) M.gearStep(spc, so, Math.min(1.15, 0.9 + t), 1, dt);
  ok(so.gear === spc.gears && so.limiter === 1, tp.id + ': über Höchsttempo im obersten Gang → Begrenzer');
});
// Schnitt-Verlauf: 0 am Begrenzer, 1 tiefster Punkt, stetig
[M.tune({ type: 'v10' }), M.tune({ type: 'dsl' })].forEach(function (tn) {
  near(M.limitWave(tn, 0), 0, 1e-9, 'Schnitt beginnt am Begrenzer');
  var mx = 0, jump = 0, pv = M.limitWave(tn, 0);
  for (var ph = 0.001; ph < 1; ph += 0.001) { var wv = M.limitWave(tn, ph); mx = Math.max(mx, wv); jump = Math.max(jump, Math.abs(wv - pv)); pv = wv; }
  ok(mx > 0.99 && jump < 0.02, 'Schnitt-Verlauf stetig bis 1 (' + mx.toFixed(3) + ', Sprung ' + jump.toFixed(3) + ')');
  ok(M.limitRpm({ type: tn.k, red: 8000 }) < 8000 && M.limitRpm({ type: tn.k, red: 8000 }) > 8000 * 0.95, 'mittlere Begrenzer-Drehzahl knapp darunter');
});
// Lab-Zustand mit vorgegebener Drehzahl (alte Zustände ohne limiter): limitStep greift erst oben
var sl = { rpm: 3000, gear: 1 };
ok(!M.limitStep(typeSpec('i4'), sl, 3000, 1, dt) && !sl.limiter, 'limitStep unten aus');

// Gleichbleibende Drehzahl: Lesestellen der Körner ohne kurze Wiederkehr. Je Motorart der Sweep, den die Stimme oben
// nimmt, bei Höchsttempo-Drehzahl und Begrenzer-Mitte; 30 s Körner im 40-ms-Raster (mit ±10 % Abstand) simulieren.
function seeded(n) { return function () { n = (n * 1664525 + 1013904223) >>> 0; return n / 4294967296; }; }
function headSeq(sw, rpm, secs, rnd, steadyMode) {
  var g = {}, head = null, out = [], win = null, dur = sw.dur || sw.pts[sw.pts.length - 1][0] + 0.15, span = 0.08 * 1.5;
  var lo = span / 2 + 0.002, hi = dur - span / 2 - 0.002;
  for (var tt = 0, gap = 0.04; tt < secs; tt += gap) {
    var bd = steadyMode ? M.steadyBand(sw, rpm, dur, 1.5) : M.band(sw, Math.min(Math.max(rpm, sw.lo), sw.hi), 0.35, dur);
    bd.a = Math.max(lo, Math.min(hi, bd.a)); bd.b = Math.max(lo, Math.min(hi, bd.b));
    win = bd;
    var rate = Math.min(1.5, Math.max(0.75, rpm / M.sweepRpm(sw, head == null ? bd.a : head)));
    var adv = gap * rate, nat = head == null ? null : head + adv;
    var pk = M.pickHead(g, bd, nat, adv, rnd, steadyMode);
    head = pk.head; out.push({ t: tt, h: head });
    gap = steadyMode ? 0.04 * (0.9 + 0.2 * rnd()) : 0.04;
  }
  return { seq: out, win: win };     // win = Fenster, wie die Stimme es nutzt (Korn-Platz an den Rändern abgezogen)
}
// Anteil der Körner, deren Lesestelle ein früheres Korn vor Δt (0,15 … 1 s) schon fast genau (±10 ms) hatte – ein
// kurzer Zyklus zeigt sich als Spitze bei seiner Periode
function repeatPeak(seq) {
  var best = 0, at = 0;
  for (var lag = 0.15; lag <= 1.0001; lag += 0.02) {
    var hit = 0, n = 0;
    for (var a = 0; a < seq.length; a++) {
      for (var b = a + 1; b < seq.length && seq[b].t - seq[a].t <= lag + 0.01; b++) {
        if (seq[b].t - seq[a].t < lag - 0.01) continue;
        n++; if (Math.abs(seq[b].h - seq[a].h) < 0.01) hit++;
        break;
      }
    }
    if (n && hit / n > best) { best = hit / n; at = lag; }
  }
  return { frac: best, lag: at };
}
if (bankJ) {
  var oldPeak = 0;
  E.TYPES.forEach(function (tp) {
    var b = bankJ.types[tp.id], spc = typeSpec(tp.id);
    if (!b || !(b.on || []).length || spc.gears <= 1) return;
    var top = b.on.slice().sort(function (x, y) { return y.pts[y.pts.length - 1][1] - x.pts[x.pts.length - 1][1]; })[0];
    var sw = M.prepSweep(Object.assign({}, top));
    [M.rpmAt(spc, spc.gears, 1), M.limitRpm(spc)].forEach(function (rpm, k) {
      var r1 = headSeq(sw, rpm, 30, seeded(7 + k), true), pk = repeatPeak(r1.seq);
      var wl = r1.win.b - r1.win.a, hs = r1.seq.map(function (x) { return x.h; });
      var used = Math.max.apply(null, hs) - Math.min.apply(null, hs);
      // Zufallstreffer-Grenze: 10 ms von wl s Fenster ≈ 2 · 0,01 / wl (plus Spielraum)
      ok(pk.frac < Math.max(0.12, 0.06 / Math.max(0.1, wl)), tp.id + (k ? ' Begrenzer' : ' Höchsttempo') + ': keine Wiederkehr der Lesestelle unter 1 s (Spitze ' + (pk.frac * 100).toFixed(0) + ' % bei ' + pk.lag.toFixed(2) + ' s, Fenster ' + wl.toFixed(2) + ' s)');
      ok(used >= Math.min(1, wl) * 0.75, tp.id + (k ? ' Begrenzer' : ' Höchsttempo') + ': ganzes Fenster genutzt (' + used.toFixed(2) + ' / ' + wl.toFixed(2) + ' s)');
      if (wl < 1) console.log('  Hinweis: ' + tp.id + (k ? ' Begrenzer' : ' Höchsttempo') + ' – Aufnahme ' + top.f + ' hat oben nur ' + wl.toFixed(2) + ' s Material (zufällig gemischt, Rauschen deckt ab)');
      var rOld = headSeq(sw, rpm, 30, seeded(7 + k), false);
      oldPeak = Math.max(oldPeak, repeatPeak(rOld.seq).frac);
    });
    // das Fenster für gleichbleibende Drehzahl ist nie kürzer als das Band beim Hochdrehen
    b.on.forEach(function (o) {
      var sx = M.prepSweep(Object.assign({}, o));
      [sx.lo * 1.1, (sx.lo + sx.hi) / 2, sx.hi * 0.95, sx.hi * 1.3].forEach(function (rq) {
        var ws = M.steadyBand(sx, rq, o.dur, 1.5), wb = M.band(sx, rq, 0.35, o.dur);
        ok(ws.b - ws.a >= wb.b - wb.a - 1e-9 && ws.a >= 0 && ws.b <= o.dur + 1e-9, tp.id + ': steadyBand ≥ band bei ' + Math.round(rq) + ' (' + o.f + ')');
      });
    });
  });
  console.log('  Gegenprobe altes Verfahren: Wiederkehr-Spitze ' + (oldPeak * 100).toFixed(0) + ' %');
  ok(oldPeak > 0.2, 'Gegenprobe: altes Verfahren (kurzes Band) zeigt Wiederkehr (' + (oldPeak * 100).toFixed(0) + ' %)');
}
// langsamer Sweep (wie eine Aufnahme bei fast gleicher Drehzahl): Fenster ≥ 1 s, Drehzahl darin höchstens ±31 %
var SLOW = M.prepSweep({ pts: [[0.1, 3000], [2.1, 4000], [4.1, 5000], [6.1, 6000]] });
var wS = M.steadyBand(SLOW, 4500, 6.2, 1.5);
ok(wS.b - wS.a >= 1.2 - 1e-9 && M.sweepRpm(SLOW, wS.a) >= 4500 / 1.31 && M.sweepRpm(SLOW, wS.b) <= 4500 * 1.31, 'steadyBand: langes Fenster (' + wS.a.toFixed(2) + '–' + wS.b.toFixed(2) + ' s)');
var wT = M.steadyBand(SLOW, 8000, 6.2, 1.5);
ok(M.sweepRpm(SLOW, wT.a) >= 8000 / 1.5 - 1 && wT.b > 5.9, 'steadyBand über dem Sweep: nur so tief, wie der Tonhöhen-Nachzug reicht (' + wT.a.toFixed(2) + '–' + wT.b.toFixed(2) + ' s)');
// pickHead: gleichbleibend springt regelmäßig, beim Hochdrehen läuft es natürlich weiter
var gH = {}, bdH = { a: 0.5, b: 2.5 }, jumps = 0, hh = null, rndH = seeded(3);
for (i = 0; i < 500; i++) { var pH = M.pickHead(gH, bdH, hh == null ? null : hh + 0.04, 0.04, rndH, true); if (pH.jump) jumps++; hh = pH.head; }
ok(jumps > 500 / 9 && jumps < 500 / 2.5, 'pickHead: gleichbleibend Sprung alle 2–7 Körner (' + jumps + ' von 500)');
gH = {}; hh = 0.6; var nj = 0;
for (i = 0; i < 20; i++) { pH = M.pickHead(gH, bdH, hh + 0.04, 0.04, rndH, false); if (pH.jump) nj++; hh = pH.head; }
ok(nj === 0, 'pickHead: im Band läuft der Lesekopf natürlich weiter');

// Motorart je Auto
ok(S.guess({ key: '2015-porsche-911-carrera-s' }).engine === 'f6', '911 → f6');
ok(S.guess({ key: '1988-ferrari-testarossa' }).engine === 'v12', 'Testarossa → v12');
ok(S.guess({ key: 'ford-mustang-1965' }).engine === 'v8m', 'Mustang → v8m');
ok(S.guess({ key: 'amg-w14-s1' }).engine === 'f1', 'W14 → f1');
ok(S.guess({ key: 'ferrari-296-gt3-verstappen' }).engine === 'v6t', 'Ferrari 296 GT3 → v6t (V6-Biturbo, kein F1)');
ok(S.guess({ key: '2020-abt-sportline-audi-rs6' }).engine === 'v8t', 'RS6 → v8t');
ok(S.guess({ name: 'Lamborghini Huracan' }).engine === 'v10', 'Huracán → v10');
ok(S.clean({ engine: 'v12' }).engine === 'v12' && S.clean({ engine: 'x' }).engine === undefined, 'clean prüft engine');
ok(S.ENGINES.length === E.TYPES.length && E.TYPES.every(function (t) { return S.ENGINES.indexOf(t.id) >= 0; }), 'gleiche Motorarten in Stats und Audio');

// Klangbank
var dir = path.join(__dirname, '..', 'assets', 'sounds', 'engines'), bankF = path.join(dir, 'bank.json');
if (fs.existsSync(bankF)) {
  var bank = JSON.parse(fs.readFileSync(bankF, 'utf8'));
  E.TYPES.forEach(function (t) {
    var b = bank.types[t.id];
    ok(!!b, 'bank: ' + t.id + ' vorhanden');
    if (!b) return;
    ok(b.loops.length >= 2, 'bank: ' + t.id + ' hat mindestens zwei Schleifen (' + b.loops.length + ')');
    if (t.id !== 'ev') ok((b.on || []).length >= 1, 'bank: ' + t.id + ' hat mindestens einen Hochlauf (Sweep)');
    if (t.id !== 'ev') {
      var topOn = Math.max.apply(null, (b.on || []).map(function (o) { return o.pts[o.pts.length - 1][1]; }).concat([0]));
      var xt = Math.max(1.5, M.tune({ type: t.id }).ext);
      ok(topOn * xt >= b.red * 0.85, 'bank: ' + t.id + ' Hochläufe reichen (mit ≤ ' + xt + ' × Nachzug) bis 85 % des Begrenzers (' + topOn + ' / ' + b.red + ')');
    }
    ['on', 'off'].forEach(function (k) {
      (b[k] || []).forEach(function (o) {
        ok(fs.existsSync(path.join(dir, o.f)), 'bank: Datei ' + o.f);
        ok(bank.sources[String(o.src)], 'bank: Quelle ' + o.src + ' mit Angaben');
        var p = o.pts || [], up = true, okT = true;
        for (var j = 1; j < p.length; j++) {
          if (p[j][0] <= p[j - 1][0]) okT = false;
          if (k === 'on' ? p[j][1] < p[j - 1][1] : p[j][1] > p[j - 1][1]) up = false;
        }
        ok(p.length >= 10 && okT && up, 'bank: Drehzahlverlauf ' + o.f + ' monoton (' + k + ')');
        ok(p.length && p[0][0] >= 0 && p[p.length - 1][0] <= o.dur + 1e-6, 'bank: Drehzahlverlauf ' + o.f + ' innerhalb der Datei');
        var lo = Math.min(p[0][1], p[p.length - 1][1]), hi = Math.max(p[0][1], p[p.length - 1][1]);
        ok(hi / lo >= 1.3 && hi <= b.red * 1.2 && lo >= b.idle * 0.4, 'bank: Bereich ' + o.f + ' plausibel (' + lo + '–' + hi + ')');
      });
    });
    ['loops', 'start', 'rev', 'pass', 'pop', 'turbo'].forEach(function (k) {
      (b[k] || []).forEach(function (o) {
        ok(fs.existsSync(path.join(dir, o.f)), 'bank: Datei ' + o.f);
        ok(bank.sources[String(o.src)], 'bank: Quelle ' + o.src + ' mit Angaben');
        if (k === 'loops') ok(o.le > o.ls + 0.5 && o.ls > 0 && o.rpm > 0, 'bank: Schleifenpunkte ' + o.f);
      });
    });
  });
  Object.keys(bank.sources).forEach(function (id) {
    var s = bank.sources[id];
    ok(s.lic === 'CC0' || s.lic === 'CC BY', 'Lizenz ' + id + ' ' + s.lic);
    ok(/^https:\/\/freesound\.org\/people\/[^/]+\/sounds\/\d+\/$/.test(s.url), 'URL ' + id);
  });
  Object.keys(bank.cars || {}).forEach(function (key) {
    var tp = S.guess({ key: key }).engine, b = bank.types[tp], src = bank.cars[key];
    ok(b && ['on', 'start', 'loops'].some(function (k) { return (b[k] || []).some(function (o) { return o.src === src; }); }),
      'bank: festes Auto ' + key + ' (' + tp + ') hat Aufnahme ' + src);
  });
} else console.log('(bank.json fehlt – nur Rechnung geprüft)');

// ---- Motorklang je Auto aus dem Car editor (def.sound)
var SND = { src: 415275, idle: [1, 3], sweep: { t0: 4, t1: 9.5, rpm0: 1200, rpm1: 7200 }, lift: null, start: [0, 2.5],
  idleRpm: 850, redline: 7600, gears: 6, shiftRpm: 7000, steps: [1.7, 1.45, 1.3, 1.2, 1.15], limitStyle: 'hard', limitHz: 14 };
var cs = M.cleanSound(SND);
function sortJ(o) { return JSON.stringify(o, Object.keys(o).sort()); }
ok(cs && sortJ(cs) === sortJ(SND) && cs.sweep.rpm1 === 7200, 'cleanSound behält gültige Angaben (inkl. null = Abschnitt aus)');
ok(M.cleanSound({ idle: [1, 3] }) === null, 'cleanSound: Abschnitt ohne Aufnahme fällt weg');
cs = M.cleanSound({ src: 1, sweep: { t0: 4, t1: 9, rpm0: 7000, rpm1: 1200 }, lift: { t0: 1, t1: 2, rpm0: 1000, rpm1: 5000 }, gears: 0, limitStyle: 'x', redline: 1e6 });
ok(cs && !cs.sweep && !cs.lift && !cs.gears && !cs.limitStyle && !cs.redline, 'cleanSound: falsche Richtung/Werte fallen weg');
var BS = { type: 'i6', idle: 750, red: 7500, gears: 6, g1: 0.28 };
var ss = M.soundSpec(BS, SND);
ok(ss.idle === 850 && ss.red === 7600 && ss.gears === 6 && BS.red === 7500, 'soundSpec: Kenndaten überschrieben, Vorlage unverändert');
near(M.tune(ss).shift, 7000 / 7600, 1e-9, 'soundSpec: Schaltdrehzahl → Anteil am Begrenzer');
ok(M.tune(ss).hz === 14 && M.tune(ss).soft === false, 'soundSpec: Begrenzer-Takt/-Art');
r = M.ratios(ss);
near(r[5], 1, 1e-9, 'Gangsprünge: oberster Gang 1');
near(r[0], 1.7 * 1.45 * 1.3 * 1.2 * 1.15, 1e-9, 'Gangsprünge: erster Gang = Produkt');
near(r[3] / r[4], 1.2, 1e-9, 'Gangsprung 4→5');
var auto = M.steps(BS);
ok(auto.length === 5 && Math.abs(auto.reduce(function (a, x) { return a * x; }, 1) - 1 / 0.28) < 0.02, 'Automatik-Gangsprünge ergeben 1/g1');
// Schaltdrehzahl wirkt: Vollgas schaltet knapp unter shiftRpm hoch
var s2 = {}, prevR = 0, shiftAt = 0;
for (t = 0; t < 12 && !shiftAt; t += dt) { prevR = s2.rpm || 0; M.gearStep(ss, s2, t / 25, 1, dt); if (s2.shifted > 0) shiftAt = prevR; }
ok(shiftAt > 6300 && shiftAt <= 7000 * 1.02, 'Vollgas schaltet bei der eingestellten Drehzahl (' + Math.round(shiftAt) + ')');
// Begrenzer aus: Vollgas im Stand bleibt am Begrenzer, kein Stottern
var off = M.soundSpec(BS, { limitStyle: 'off' }), s3 = {};
for (t = 0; t < 2; t += dt) M.gearStep(off, s3, 0, 1, dt);
ok(!s3.limiter && s3.rpm <= 7500 * 1.001 && s3.rpm > 7300, 'Begrenzer aus: Drehzahl hält oben ohne Schnitte (' + Math.round(s3.rpm) + ')');
// von Hand schalten: manual hält den Gang (läuft in den Begrenzer), force −1 schaltet zurück
var s4 = { manual: true }, lim = false;
for (t = 0; t < 3; t += dt) { M.gearStep(ss, s4, t / 10, 1, dt); if (s4.limiter) lim = true; }
ok(s4.gear === 1 && lim, 'manual: bleibt im 1. Gang und erreicht den Begrenzer');
s4.force = 1; M.gearStep(ss, s4, 0.2, 1, dt); ok(s4.gear === 2, 'force +1 schaltet hoch');
s4.force = -1; M.gearStep(ss, s4, 0.2, 0, dt); ok(s4.gear === 1, 'force −1 schaltet zurück');
var s5 = { neutral: true, gear: 3, rpm: 800 };
for (t = 0; t < 1; t += dt) M.gearStep(ss, s5, 0.5, 1, dt);
ok(s5.rpm > 7000, 'neutral: Gas dreht frei hoch (' + Math.round(s5.rpm) + ')');
// Drehzahlverlauf eines markierten Hochlaufs: monoton, Endpunkte = rpm0/rpm1, ab Ausschnitt-Anfang (pad)
var cur = { t0: 0, dt: 0.05, rpm: [] };
for (i = 0; i < 400; i++) cur.rpm.push(i % 17 === 0 ? 0 : Math.round(1000 + 40 * i + (i % 3) * 30));
var pts = M.sweepPts(cur, 4, 9.5, 1200, 7200, 0.15);
ok(pts[0][0] === 0.15 && pts[0][1] === 1200 && pts[pts.length - 1][1] === 7200, 'sweepPts: Endpunkte (' + JSON.stringify(pts[0]) + ')');
near(pts[pts.length - 1][0], 5.65, 1e-6, 'sweepPts: Ende = Länge + pad');
var mono = true;
for (i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1] || pts[i][0] <= pts[i - 1][0]) mono = false;
ok(mono, 'sweepPts: monoton steigend, Zeit steigend');
var lin = M.sweepPts({ t0: 0, dt: 0.05, rpm: [] }, 1, 2, 7000, 1500, 0);
ok(lin[0][1] === 7000 && lin[lin.length - 1][1] === 1500 && lin.every(function (p, k) { return !k || p[1] <= lin[k - 1][1]; }), 'sweepPts ohne Messung: gleichmäßig fallend');
var sw = M.prepSweep({ pts: pts });
near(M.sweepPos(sw, 1200).t, 0.15, 1e-6, 'markierter Hochlauf: Anfangsdrehzahl am Markierungs-Anfang');
// Schleife: Länge L − F, Naht stetig (Ende geht in den Anfang über)
var sig = new Float32Array(44100);
for (i = 0; i < sig.length; i++) sig[i] = Math.sin(i * 0.05) * (0.5 + 0.3 * Math.sin(i * 0.0007));
var lp = M.loopData(sig, 1000, 21000, 2000);
ok(lp.length === 18000, 'loopData: Länge L − F');
ok(Math.abs(lp[lp.length - 1] - lp[0]) < 0.06, 'loopData: Naht stetig (' + (lp[lp.length - 1] - lp[0]).toFixed(3) + ')');
var gq = M.segGain(sig, 0, 44100, -20);
var e = 0; for (i = 0; i < sig.length; i++) e += sig[i] * sig[i] * gq * gq;
near(20 * Math.log10(Math.sqrt(e / sig.length)), -20, 0.01, 'segGain: −20 dBFS RMS');
// Quell-Aufnahmen für den Editor: index.json, je Aufnahme mp3 + json mit Drehzahlverlauf und gültigen Vorschlägen
var srcDir = path.join(__dirname, '..', 'assets', 'sounds', 'engines', 'src');
if (fs.existsSync(path.join(srcDir, 'index.json'))) {
  var idx = JSON.parse(fs.readFileSync(path.join(srcDir, 'index.json'), 'utf8')).sources, bytes = 0;
  ok(Object.keys(idx).length >= 10, 'src: mindestens 10 Aufnahmen (' + Object.keys(idx).length + ')');
  Object.keys(idx).forEach(function (id) {
    var mp = path.join(srcDir, id + '.mp3'), js = path.join(srcDir, id + '.json');
    ok(fs.existsSync(mp) && fs.existsSync(js), 'src: Dateien zu ' + id);
    if (!fs.existsSync(js)) return;
    bytes += fs.statSync(mp).size;
    var inf = JSON.parse(fs.readFileSync(js, 'utf8'));
    ok(inf.dur <= 30.05 && inf.rpm.length > 10 && inf.dt > 0, 'src: ' + id + ' ≤ 30 s mit Drehzahlverlauf');
    ok(idx[id].types.length && idx[id].lic && idx[id].url, 'src: ' + id + ' mit Motorarten und Lizenz');
    var a = inf.auto || {}, c2 = M.cleanSound(Object.assign({ src: +id }, a));
    ['idle', 'sweep', 'lift', 'start'].forEach(function (k) {
      if (!a[k]) return;
      ok(c2 && c2[k], 'src: Vorschlag ' + k + ' von ' + id + ' gültig');
      var t1 = Array.isArray(a[k]) ? a[k][1] : a[k].t1;
      ok(t1 <= inf.dur + 0.01, 'src: Vorschlag ' + k + ' von ' + id + ' innerhalb der Aufnahme');
    });
  });
  ok(bytes < 8 * 1024 * 1024, 'src: zusammen unter 8 MB (' + (bytes / 1048576).toFixed(1) + ' MB)');
}

// ---- Übergabe zwischen Aufnahmen (alle Motorarten): eigene Stücke vor geliehenen, oberstes eigenes gestreckt bis
// TUNE.ext, Wechsel über ±15 % Drehzahl überblendet, Pegel/Helligkeit an der Übergabe angeglichen
function pc(lo, hi, src, from) { var o = M.prepSweep({ src: src, pts: [[0.15, lo], [1.15, Math.sqrt(lo * hi)], [2.15, hi]], dur: 2.3 }); if (from) o.from = from; return o; }
var HL = [pc(1400, 5200, 1), pc(1100, 2800, 2), pc(1600, 6400, 3, 'v8f')];
ok(M.sweepSel(HL, 2000, 1.35) === 0, 'sweepSel: erstes eigenes Stück, das die Drehzahl enthält');
ok(M.sweepSel(HL, 6000, 1.35) === 0, 'sweepSel: über dem eigenen Stück erst strecken (bis 1,35 ×), nicht leihen');
ok(M.sweepSel(HL, 7300, 1.35) === 2, 'sweepSel: geliehenes Stück erst jenseits der Streckung');
ok(M.sweepSel(HL, 7300, 1.75) === 0, 'sweepSel: mit ext 1,75 bleibt es beim eigenen');
ok(M.sweepSel(HL, 2000, 1.35, function (x) { return x.src !== 1; }) === 1, 'sweepSel: ohne Puffer das nächste eigene');
// Überblendung: Gewichte gleiche Leistung, breiter Übergang, keine Sprünge
var XW = 1.15, both = [], prevW = null, jumpW = 0;
for (var rq = 3000; rq <= 12000; rq *= 1.005) {
  var mx = M.sweepMix(HL, rq, 1.35, XW), e2 = mx.reduce(function (a, m) { return a + m.g * m.g; }, 0);
  if (Math.abs(e2 - 1) > 1e-9) ok(false, 'sweepMix: Summe der Quadrate 1 bei ' + Math.round(rq));
  var w = {}; mx.forEach(function (m) { w[m.i] = m.g; });
  if (mx.length === 2 && Math.min(mx[0].g, mx[1].g) > 0.15) both.push(rq);
  if (prevW) [0, 1, 2].forEach(function (i) { jumpW = Math.max(jumpW, Math.abs((w[i] || 0) - (prevW[i] || 0))); });
  prevW = w;
}
ok(both.length && both[both.length - 1] / both[0] >= 1.2, 'sweepMix: Wechsel der Aufnahme über ≥ 20 % Drehzahl verteilt (' + (both.length ? (both[both.length - 1] / both[0]).toFixed(2) : 0) + ' ×)');
ok(jumpW < 0.3, 'sweepMix: Gewichte ändern sich je 0,5 % Drehzahl um < 0,3 (' + jumpW.toFixed(2) + ')');
ok(M.sweepMix(HL, 2000, 1.35, XW).length === 1, 'sweepMix: mitten in einem Stück nur dieses');
// Pegel-/Helligkeitsangleich: Rauschen gefiltert (dumpf, laut) gegen hell und leise → nach dem Angleich ±2 dB
function synth(n, amp, bright, seed) {
  var r = seeded(seed), d = new Float32Array(n), y = 0;
  for (var i = 0; i < n; i++) { var x = r() * 2 - 1; y = bright ? x : y + 0.1 * (x - y); d[i] = amp * y; }
  return d;
}
var SR = 8000, dA = synth(SR * 2.3, 0.8, false, 3), dB = synth(SR * 2.3, 0.08, true, 5);
var mp = M.matchPiece(pc(1400, 5200, 1), dA, pc(4000, 8000, 2), dB, SR);
for (var i2 = 0; i2 < dB.length; i2++) dB[i2] *= mp.gain;
var mp2 = M.matchPiece(pc(1400, 5200, 1), dA, pc(4000, 8000, 2), dB, SR);
ok(Math.abs(mp.lA - mp.lB) > 5 && Math.abs(mp2.lA - mp2.lB) <= 2, 'matchPiece: Pegel an der Übergabe vorher ' + (mp.lB - mp.lA).toFixed(1) + ' dB, danach ±2 dB (' + (mp2.lB - mp2.lA).toFixed(1) + ')');
ok(mp.shelf < -3, 'matchPiece: helleres Stück wird abgesenkt (' + mp.shelf.toFixed(1) + ' dB)');
ok(mp.h > 4000 && mp.h < 5200, 'matchPiece: Übergabe in der Überlappung (' + mp.h + ')');
ok(M.stretchShelf(1) === 0 && M.stretchShelf(1.69) < -4 && M.stretchShelf(9) >= -12, 'stretchShelf: Streckung wird dunkler ausgeglichen');

if (bankJ) {
  // f6 (Nutzer: „ab 5200 kommt eine andere mp3“): nur Boxer-/Porsche-Aufnahmen, Leerlauf → Begrenzer ohne Leihgabe
  var f6 = bankJ.types.f6, ext6 = M.tune({ type: 'f6' }).ext, L6 = f6.on.map(function (o) { return M.prepSweep(Object.assign({}, o)); });
  ok(f6.on.every(function (o) { return !o.from && /porsche|boxer/i.test(bankJ.sources[o.src].title); }), 'f6: alle Hochläufe aus eigenen Porsche-Aufnahmen');
  var lo6 = Math.min.apply(null, L6.map(function (o) { return o.lo; })), hi6 = Math.max.apply(null, L6.map(function (o) { return o.hi; }));
  ok(lo6 <= f6.idle * 1.6, 'f6: Hochläufe beginnen am Leerlauf (' + lo6 + ')');
  ok(hi6 * ext6 >= f6.red, 'f6: oberstes Stück gestreckt bis zum Begrenzer (' + hi6 + ' × ' + ext6 + ' ≥ ' + f6.red + ')');
  var miss = 0;
  for (var r6 = f6.idle; r6 <= f6.red * 1.02; r6 *= 1.01) {
    var s6 = M.sweepSel(L6, r6, ext6), q6 = s6 >= 0 ? L6[s6] : null;
    if (!q6 || (r6 > q6.hi && r6 > q6.hi * ext6) || r6 / q6.hi > Math.max(1.5, ext6)) miss++;
  }
  ok(!miss, 'f6: jede Drehzahl Leerlauf…Begrenzer aus eigenem Stück im Streck-Bereich (' + miss + ' Lücken)');
  // dsl (Nutzer: „on-435656-1 ist schlecht“, Lader passt nicht zum Lkw)
  var ds = bankJ.types.dsl, tbd = M.tune({ type: 'dsl' }).tb;
  ok(!ds.on.some(function (o) { return o.src === 435656; }), 'dsl: Hochlauf 435656 nicht mehr in der Bank');
  ok(ds.on.every(function (o) { return !o.from; }), 'dsl: keine geliehenen Hochläufe');
  ok(tbd.tone === 0 && tbd.hi <= 1500 && tbd.hiss && ds.boost <= 0.04, 'dsl: Lader tief und leise, kein Pfeifton/Abblasventil');
  ok(M.tune({ type: 't4' }).tb.tone === 1 && M.tune({ type: 't4' }).tb.lo === 2500, 'Benziner-Turbo unverändert (Pfeifen 2,5–7 kHz)');
  // echte Stücke (ffmpeg dekodiert): nach dem Angleich an jeder Übergabe ±2 dB
  var cp = require('child_process'), hasFF = !cp.spawnSync('ffmpeg', ['-version']).error;
  if (hasFF) {
    var dec = function (f) {
      var r = cp.spawnSync('ffmpeg', ['-v', 'quiet', '-i', path.join(__dirname, '..', 'assets', 'sounds', 'engines', f), '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 });
      var b = r.stdout; return new Float32Array(b.buffer, b.byteOffset, b.length >> 2).slice();
    };
    ['f6', 'dsl', 'v8m', 'v12'].forEach(function (tp) {
      var ps = bankJ.types[tp].on.map(function (o) { return M.prepSweep(Object.assign({}, o, { d: dec(o.f) })); });
      for (var a = 1; a < ps.length; a++) {
        var m = M.matchPiece(ps[0], ps[0].d, ps[a], ps[a].d, 22050);
        if (!m) continue;
        var after = m.lB + 20 * Math.log10(m.gain);
        ok(Math.abs(after - m.lA) <= 2, tp + ': Pegel an der Übergabe ' + ps[0].f + ' → ' + ps[a].f + ' bei ' + m.h + ' U/min ±2 dB (' + (m.lB - m.lA).toFixed(1) + ' dB → ' + (after - m.lA).toFixed(1) + ' dB)');
      }
    });
  } else console.log('  (ffmpeg fehlt – Pegel der echten Stücke nicht geprüft)');
}

console.log(fails ? fails + ' Fehler' : 'alles ok');
process.exit(fails ? 1 : 0);
