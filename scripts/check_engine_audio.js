// Prüfskript für die Rechnung von js/car-engine-audio.js (ohne Web Audio): Gangmodell (inkl. Schalten), Schleifen-Leiter,
// Überblendung, Abspielrate, Sweep-Abbildung Drehzahl ↔ Stelle, Korn-Raster/Lesekopf, Hann, Ebenen-Mix; dazu bank.json (Dateien vorhanden, Schleifenpunkte gültig) und die Motorart je Auto.
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
      ok(topOn * 1.5 >= b.red * 0.85, 'bank: ' + t.id + ' Hochläufe reichen (mit ≤ 1,5 × Nachzug) bis 85 % des Begrenzers (' + topOn + ' / ' + b.red + ')');
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

console.log(fails ? fails + ' Fehler' : 'alles ok');
process.exit(fails ? 1 : 0);
