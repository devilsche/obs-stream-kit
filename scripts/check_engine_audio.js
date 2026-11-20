// Prüfskript für die Rechnung von js/car-engine-audio.js (ohne Web Audio): Gangmodell, Schleifen-Leiter,
// Überblendung, Abspielrate; dazu bank.json (Dateien vorhanden, Schleifenpunkte gültig) und die Motorart je Auto.
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
near(M.rpmAt(SPEC, 6, 1), 7000 * 0.97, 1e-6, 'Höchsttempo im letzten Gang knapp unter dem Begrenzer');

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

// Motorart je Auto
ok(S.guess({ key: '2015-porsche-911-carrera-s' }).engine === 'f6', '911 → f6');
ok(S.guess({ key: '1988-ferrari-testarossa' }).engine === 'v12', 'Testarossa → v12');
ok(S.guess({ key: 'ford-mustang-1965' }).engine === 'v8m', 'Mustang → v8m');
ok(S.guess({ key: 'amg-w14-s1' }).engine === 'f1', 'W14 → f1');
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
} else console.log('(bank.json fehlt – nur Rechnung geprüft)');

console.log(fails ? fails + ' Fehler' : 'alles ok');
process.exit(fails ? 1 : 0);
