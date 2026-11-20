/* Car Drive: Arcade-Fahrphysik für das selbst gefahrene Auto (ohne DOM, ohne three.js, ohne Physik-Engine).
 * Läuft im Browser (window.CarDrivePhys) und in Node (module.exports). Prüfskript: scripts/check_car_drive.js
 *
 *   CarDrivePhys.params(st, raw) → Fahrzeugwerte
 *       st = CarRaceSim.stats(raw) (gleiche Spielzeug-Größen wie die KI-Gegner: m/s, m/s²), raw = CarRaceStats.of()
 *       (echte Werte: vmax km/h für den Tacho, drive für Traktion/Untersteuern/Übersteuern).
 *   CarDrivePhys.trackInfo(T) → { gravel: {1: Uint8Array, -1: Uint8Array} }   Kiesbett je Rasterpunkt und Seite
 *       (gleiche Regel wie die Darstellung in js/car-track-scene.js; sonst ist der Auslauf Gras)
 *   CarDrivePhys.create(T, P, { s, d }) → Auto auf der Strecke an (s, d), Richtung Fahrtrichtung, steht
 *   CarDrivePhys.step(car, input, dt)    input = { throttle 0..1, brake 0..1, steer −1..1 (+ = links),
 *                                         handbrake bool, nitro bool (zündet einmal je Runde) }
 *   CarDrivePhys.reset(car)              zurück auf die Mittellinie an der aktuellen Stelle, steht
 *   CarDrivePhys.speedKmh(car)           Tacho: Spielzeug-Tempo auf echte km/h hochgerechnet (vtop ↔ echte vmax)
 *
 *   car = { x, z, yaw, vx, vz, r (Gierrate, + = links), u (längs), w (quer, + = links), steer (Radwinkel rad),
 *           roll, pitch (wie CarRaceSim: roll > 0 = neigt nach rechts, pitch > 0 = Nase hoch), spin (Raddrehung rad),
 *           s (0..L), d (Seitenversatz, + = links), prog (gefahrene Meter ab Start/Ziel, Startaufstellung negativ,
 *           rückwärts fahren zählt zurück), laps (abgeschlossene Runden, nie weniger), surface 'asphalt'|'curb'|'gravel'|'grass',
 *           nitroT (s Rest-Boost), nitroLap (Runde, in der Nitro zuletzt gezündet wurde), rail (Aufprall-Tempo der
 *           letzten Leitplanken-Berührung in diesem Schritt, sonst 0), slip (0..1 Rutschen, für Qualm/Ton) }
 *
 * Modell: Einspurmodell (Vorder-/Hinterachse je halbe Masse), Seitenkraft je Achse aus dem Schräglaufwinkel mit
 * Sättigung (über dem Haftmaximum fällt sie auf 80 % – Rutschen), Haftung = st.grip (m/s²); Lastwechsel beim
 * Bremsen/Gasgeben verschiebt Haftung nach vorn/hinten; angetriebene Achse verliert Seitenhaftung unter Gas
 * (Reibungskreis: Heckantrieb übersteuert, Frontantrieb untersteuert); Handbremse: Hinterachse rutscht.
 * Kies/Gras: weniger Haftung, Bremswirkung mit dem Tempo (Kies wie die Sim: ~11 m/s² aus vollem Tempo, rollt mit
 * ~6 m/s), Holpern. Leitplanke bei |d| = Breite/2 + Auslauf + 0,3 (wie in der Darstellung): weicher Stoß –
 * zurück auf die Innenseite, Tempo in Normalenrichtung wird umgekehrt gedämpft, längs geht Tempo verloren.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CarDrivePhys = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var SUB = 1 / 120;          // fester Teilschritt
  var MAX_STEER = 0.42;       // größter Radeinschlag (rad), wie die Sim
  var ALPHA_PEAK = 0.13;      // Schräglaufwinkel mit größter Seitenkraft (rad)
  var NITRO_T = 2.2, NITRO_V = 1.25, NITRO_A = 1.8;
  var SURF = {
    asphalt: { grip: 1, k: 0, c: 0, bump: 0 },
    curb: { grip: 0.95, k: 0, c: 0.2, bump: 0.35 },
    gravel: { grip: 0.5, k: 0.45, c: 2, bump: 1 },
    grass: { grip: 0.62, k: 0.32, c: 1.4, bump: 0.6 }
  };
  var DRIVE = { rwd: [0, 1.4], fwd: [1.4, 0], awd: [0.75, 0.75] };   // Antriebsanteil vorn/hinten (Reibungskreis)

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function mod(a, n) { var r = a % n; return r < 0 ? r + n : r; }
  function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function sign(x) { return x < 0 ? -1 : 1; }
  // Seitenkraft-Kurve (normiert): steigt bis x = 1 auf 1, danach Gleitreibung bis 0,8
  function sat(x) {
    var a = Math.abs(x);
    return a <= 1 ? x * (1.5 - 0.5 * a * a) : sign(x) * Math.max(0.8, 1 - 0.12 * (a - 1));
  }

  function params(st, raw) {
    raw = raw || {};
    st = st || {};
    var len = st.len > 0 ? st.len : 4.5;
    return {
      acc: st.acc || 5, vtop: (st.vmax || 27) / 1.04, grip: st.grip || 11, brake: st.brake || 8,
      susp: st.susp || 0.5, launch: st.launch || 1, mass: st.mass || 4.5, len: len,
      wb: 0.6 * len, width: clamp(len * 0.42, 1.7, 2.6), drive: DRIVE[raw.drive] ? raw.drive : 'rwd',
      realVmax: raw.vmax > 0 ? +raw.vmax : 300, wheelR: clamp(0.07 * len, 0.3, 0.55)
    };
  }

  var infoCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function trackInfo(T) {
    if (infoCache && infoCache.has(T)) return infoCache.get(T);
    var raw = T._raw, n = raw.n, ds = raw.ds, CRV = raw.CRV;
    var runL = T.runoff ? T.runoff.left : [], runR = T.runoff ? T.runoff.right : [];
    function runAt(i, sd) { var v = (sd > 0 ? runL : runR)[mod(i, n)]; return v > 0 ? v : 0; }
    var outside = { 1: new Uint8Array(n), '-1': new Uint8Array(n) }, W14 = Math.round(14 / ds), i, k;
    for (i = 0; i < n; i++) {
      if (Math.abs(CRV[i]) <= 1 / 60) continue;
      var outSd = CRV[i] > 0 ? -1 : 1;
      for (k = -W14; k <= W14; k++) outside[outSd][mod(i + k, n)] = 1;
    }
    var gravel = { 1: new Uint8Array(n), '-1': new Uint8Array(n) };
    [1, -1].forEach(function (sd) {
      for (var q = 0; q < n; q++) gravel[sd][q] = outside[sd][q] && outside[sd][(q + 1) % n] && runAt(q, sd) > 3 && runAt(q + 1, sd) > 3 ? 1 : 0;
    });
    var curvy = new Uint8Array(n);
    for (i = 0; i < n; i++) curvy[i] = Math.abs(CRV[i]) > 1 / 60 || Math.abs(CRV[(i + 1) % n]) > 1 / 60 ? 1 : 0;
    var info = { gravel: gravel, curvy: curvy, runAt: runAt };
    if (infoCache) infoCache.set(T, info);
    return info;
  }

  // nächster Mittellinienpunkt: lokal um hint (±40 Punkte), sonst ganze Strecke
  function project(T, x, z, hint) {
    var raw = T._raw, n = raw.n, X = raw.X, Z = raw.Z, best = -1, bd = Infinity, i, q;
    if (hint >= 0) {
      for (q = -40; q <= 40; q++) {
        i = mod(hint + q, n);
        var dx = X[i] - x, dz = Z[i] - z, dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = i; }
      }
    }
    if (best < 0 || bd > 30 * 30) {
      for (i = 0; i < n; i++) {
        var ex = X[i] - x, ez = Z[i] - z, de = ex * ex + ez * ez;
        if (de < bd) { bd = de; best = i; }
      }
    }
    var yaw = raw.YAW[best], along = (x - X[best]) * Math.cos(yaw) - (z - Z[best]) * Math.sin(yaw);
    var s = mod(best * raw.ds + along, T.len), a = T.at(s);
    return { i: best, s: s, d: (x - a.x) * a.nx + (z - a.z) * a.nz, a: a };
  }

  function create(T, P, pose) {
    pose = pose || {};
    var s = pose.s || 0, d = pose.d || 0, a = T.at(s);
    var car = {
      T: T, P: P, info: trackInfo(T),
      x: a.x + a.nx * d, z: a.z + a.nz * d, yaw: a.yaw, vx: 0, vz: 0, r: 0, u: 0, w: 0, steer: 0,
      roll: 0, pitch: 0, rollV: 0, pitchV: 0, spin: 0, ax: 0, ay: 0,
      s: mod(s, T.len), d: d, hint: -1, prog: s, laps: 0, surface: 'asphalt', bumpPh: 0,
      nitroT: 0, nitroLap: -1, rail: 0, slip: 0, rails: 0
    };
    var pr = project(T, car.x, car.z, -1); car.hint = pr.i; car.s = pr.s; car.d = pr.d;
    return car;
  }

  function surfaceAt(car, pr) {
    var T = car.T, half = T.width / 2, ad = Math.abs(pr.d), sd = pr.d > 0 ? 1 : -1, i = Math.round(pr.s / T._raw.ds) % T._raw.n;
    if (ad <= half) return 'asphalt';
    if (ad <= half + 0.9 && car.info.curvy[i]) return 'curb';
    return car.info.gravel[sd][i] ? 'gravel' : 'grass';
  }

  function sub(car, inp, dt) {
    var P = car.P, T = car.T;
    var fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw), lx = -Math.sin(car.yaw), lz = -Math.cos(car.yaw);
    var u = car.vx * fx + car.vz * fz, w = car.vx * lx + car.vz * lz, sp = Math.hypot(car.vx, car.vz);
    var S = SURF[car.surface] || SURF.asphalt;
    var a = P.wb / 2, b = P.wb / 2;
    // Lenkung: Einschlag nimmt mit dem Tempo ab (sonst bei Tempo nur Rutschen), weich nachgeführt
    var maxSteer = clamp(MAX_STEER * 9 / (9 + Math.max(0, Math.abs(u) - 3)), 0.1, MAX_STEER);
    var want = clamp(inp.steer || 0, -1, 1) * maxSteer;
    car.steer += clamp(want - car.steer, -3.2 * dt, 3.2 * dt);
    var delta = car.steer;
    var thr = clamp(inp.throttle || 0, 0, 1), brk = clamp(inp.brake || 0, 0, 1), hb = !!inp.handbrake;
    var nitro = car.nitroT > 0;
    var vtop = P.vtop * (nitro ? NITRO_V : 1);
    // Längs: Antrieb (wie die Sim: fällt mit (v/vtop)^4), Bremse/Rückwärts, Fahrwiderstand, Untergrund
    var ax = 0;
    if (u > 0.5 || (u >= -0.5 && brk < 0.05)) {
      var launch = u < 8 ? P.launch : 1;
      ax += thr * P.acc * launch * (nitro ? NITRO_A : 1) * Math.max(0, 1 - Math.pow(Math.max(0, u) / vtop, 4));
      if (u > 0.5) ax -= brk * P.brake;
    } else if (u < -0.5) {
      // rückwärts: Bremse = Rückwärtsgas (bis 5 m/s), Gas bremst
      ax -= brk * P.acc * 0.6 * Math.max(0, 1 - Math.pow(-u / 5, 2));
      ax += thr * P.brake;
    } else if (brk >= 0.05) ax -= brk * P.acc * 0.6;   // aus dem Stand rückwärts anfahren
    var roll = 0.25 + (thr < 0.05 ? 0.9 : 0) + 0.0015 * u * u;   // Rollwiderstand + Motorbremse + Luft
    var resist = roll + S.c + S.k * Math.abs(u) + (hb ? 3.5 : 0);
    if (Math.abs(u) > 0.05) ax -= sign(u) * resist;
    // Haftung je Achse (Lastwechsel, Untergrund, Handbremse, Antrieb am Reibungskreis)
    var G = P.grip * S.grip, shift = clamp(-car.ax / G * 0.3, -0.22, 0.22);
    var Gf = G * 0.96 * (1 + shift), Gr = G * 1.04 * (1 - shift);
    var dr = DRIVE[P.drive], drv = Math.max(0, ax) ;
    Gf = Math.sqrt(Math.max(Gf * Gf * 0.25, Gf * Gf - Math.pow(drv * dr[0], 2)));
    Gr = Math.sqrt(Math.max(Gr * Gr * 0.25, Gr * Gr - Math.pow(drv * dr[1], 2)));
    if (hb) Gr *= 0.32;
    // Seitenkräfte (je Achse als Beschleunigung ihrer halben Masse)
    var ue = Math.max(Math.abs(u), 4), dirSign = u < -0.5 ? -1 : 1;
    var af = Math.atan2(w + car.r * a, ue) - delta * dirSign, ar = Math.atan2(w - car.r * b, ue);
    var Ff = -Gf * sat(af / ALPHA_PEAK), Fr = -Gr * sat(ar / ALPHA_PEAK);
    var ay = (Ff * Math.cos(delta) + Fr) / 2;
    var yawAcc = (a * Ff * Math.cos(delta) - b * Fr) / 2 / (a * b);
    car.slip = clamp(Math.max(Math.abs(af), Math.abs(ar)) / (ALPHA_PEAK * 2.5) * Math.min(1, sp / 6) + (hb && sp > 3 ? 0.4 : 0), 0, 1);
    // integrieren
    car.vx += (fx * ax + lx * ay) * dt; car.vz += (fz * ax + lz * ay) * dt;
    car.r += yawAcc * dt;
    car.r -= car.r * 0.6 * dt;                         // leichte Gierdämpfung (Stabilität)
    // langsam: kinematisch (kein Schräglauf-Modell nahe 0) – Gierrate aus Lenkwinkel, Querrutschen abbauen
    var k = clamp((Math.abs(u) - 1.5) / 4, 0, 1);
    if (k < 1) {
      var rk = u * Math.tan(delta) / P.wb;
      car.r = car.r * k + rk * (1 - k);
      var wn = car.vx * lx + car.vz * lz, cut = wn * (1 - k) * Math.min(1, dt * 12);
      car.vx -= lx * cut; car.vz -= lz * cut;
    }
    // Stillstand: nicht durch Widerstand rückwärts rollen
    var u2 = car.vx * fx + car.vz * fz;
    if (thr < 0.05 && brk < 0.05 && Math.abs(u2) < 0.25 && Math.abs(w) < 0.5) { car.vx *= 0.8; car.vz *= 0.8; }
    else if (u > 0.3 && u2 < 0 && brk >= 0.05) { car.vx -= fx * u2; car.vz -= fz * u2; }   // Bremsen hält bei 0 an
    car.yaw += car.r * dt;
    car.x += car.vx * dt; car.z += car.vz * dt;
    car.ax = ax; car.ay = ay; car.u = car.vx * fx + car.vz * fz; car.w = car.vx * lx + car.vz * lz;
    car.spin = (car.spin + car.u * dt / P.wheelR) % (Math.PI * 2000);
    if (car.nitroT > 0) car.nitroT = Math.max(0, car.nitroT - dt);
    // Aufbau: Wanken nach außen, Nicken mit Gas/Bremse (gedämpfte Feder), Holpern im Auslauf
    var soft = 1.15 - P.susp;
    car.bumpPh += Math.abs(car.u) * dt * 2.3;
    var bump = S.bump * Math.min(1, Math.abs(car.u) / 6);
    var rollT = clamp(ay * 0.009 * soft, -0.1, 0.1) + Math.sin(car.bumpPh * 1.7) * bump * 0.02;
    var pitchT = clamp(ax * 0.006 * soft, -0.07, 0.07) + Math.sin(car.bumpPh * 2.9) * bump * 0.018;
    car.rollV += ((rollT - car.roll) * 60 - car.rollV * 10) * dt;
    car.pitchV += ((pitchT - car.pitch) * 80 - car.pitchV * 11) * dt;
    car.roll += car.rollV * dt; car.pitch += car.pitchV * dt;
    // Strecke: Lage, Untergrund, Leitplanke
    var pr = project(T, car.x, car.z, car.hint);
    var dS = pr.s - car.s; dS = mod(dS + T.len / 2, T.len) - T.len / 2;
    car.prog += dS; car.s = pr.s; car.d = pr.d; car.hint = pr.i;
    if (car.prog >= T.len * (car.laps + 1)) car.laps = Math.floor(car.prog / T.len);
    car.surface = surfaceAt(car, pr);
    railCheck(car, pr);
  }

  function railCheck(car, pr) {
    var T = car.T, P = car.P, at = pr.a, sd = pr.d > 0 ? 1 : -1;
    var run = sd > 0 ? at.runL : at.runR, rail = T.width / 2 + (run > 0 ? run : 0) + 0.3;
    var psi = wrapAngle(car.yaw - at.yaw);
    var ext = P.width / 2 * Math.abs(Math.cos(psi)) + P.len / 2 * Math.abs(Math.sin(psi));
    var lim = rail - Math.min(ext, rail * 0.9) - 0.05, pen = Math.abs(pr.d) - lim;
    if (pen <= 0) return;
    var nx = at.nx * sd, nz = at.nz * sd;          // nach außen (zur Leitplanke)
    car.x -= nx * pen; car.z -= nz * pen; car.d -= sd * pen;
    var vn = car.vx * nx + car.vz * nz;
    if (vn > 0) {
      // weicher Stoß: zurückfedern (20 %), längs Tempo verlieren je nach Aufprall
      car.vx -= nx * vn * 1.2; car.vz -= nz * vn * 1.2;
      var keep = 1 - Math.min(0.55, 0.05 * vn + 0.04);
      car.vx *= keep; car.vz *= keep;
      car.r *= 0.5;
      // Nase etwas zur Strecke drehen (vom Planke weg)
      car.yaw -= clamp(psi, -1, 1) * Math.min(0.25, vn * 0.03) * (Math.abs(psi) < Math.PI / 2 ? 1 : 0);
      car.rail = Math.max(car.rail, vn);
      car.rails++;
    }
  }

  function step(car, inp, dt) {
    inp = inp || {};
    car.rail = 0;
    if (inp.nitro && car.nitroLap !== car.laps && car.nitroT <= 0 && car.prog > 0) { car.nitroT = NITRO_T; car.nitroLap = car.laps; }
    var t = Math.min(dt, 0.1);
    while (t > 1e-6) { var h = Math.min(SUB, t); sub(car, inp, h); t -= h; }
    return car;
  }

  function reset(car) {
    var a = car.T.at(car.s);
    car.x = a.x; car.z = a.z; car.yaw = car.yaw + wrapAngle(a.yaw - car.yaw);
    car.vx = car.vz = car.r = car.u = car.w = car.steer = 0;
    car.roll = car.pitch = car.rollV = car.pitchV = 0; car.ax = car.ay = 0;
    var pr = project(car.T, car.x, car.z, car.hint); car.d = pr.d; car.hint = pr.i; car.surface = 'asphalt';
    return car;
  }

  function speedKmh(car) { return Math.abs(car.u) / car.P.vtop * car.P.realVmax; }
  function nitroReady(car) { return car.nitroLap !== car.laps && car.nitroT <= 0; }

  return {
    params: params, trackInfo: trackInfo, project: project, create: create, step: step, reset: reset,
    speedKmh: speedKmh, nitroReady: nitroReady, MAX_STEER: MAX_STEER, NITRO_T: NITRO_T
  };
});
