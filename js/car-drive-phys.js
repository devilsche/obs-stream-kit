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
 *                                         Bremse im Stand = Rückwärtsgang (bis REV_V), rückwärts bremst das Gas
 *   CarDrivePhys.reset(car)              zurück auf die Mittellinie an der aktuellen Stelle, steht
 *   CarDrivePhys.speedKmh(car)           Tacho: Spielzeug-Tempo auf echte km/h hochgerechnet (vtop ↔ echte vmax)
 *   CarDrivePhys.overlap(a, b)           Umriss gegen Umriss (konvexe Polygone, Trennachsen): a/b = { x, z, yaw, len, w,
 *                                         shape? } → null oder { pen, nx, nz (Normale von b zu a), px, pz (Kontaktpunkt) }
 *                                         shape = [[a vorn, b links], …] m (aus dem Modell, outline), sonst Rechteck mit
 *                                         runden Ecken (Radius 0,35 × Breite, roundedRect(len, w))
 *   CarDrivePhys.outline(pts, maxN)      konvexe Hülle einer Punktwolke [[a, b], …], vereinfacht auf ≤ maxN (16) Ecken
 *   CarDrivePhys.collide(car, me, o)     Kontakt eigenes Auto ↔ anderes Auto: me = { len, w } (echte Grundfläche des
 *                                         eigenen Modells, optional shape), o = { x, z, yaw, len, w, shape?, vx, vz, mass,
 *                                         peer? } (mass Infinity = Wrack; peer = Mitspieler, der denselben Kontakt bei sich
 *                                         rechnet: nur Massenanteil, weich, ein Stoß je Berührung).
 *                                         Nur das eigene Auto reagiert: ganz aus der Überlappung geschoben, Stoß im
 *                                         Kontaktpunkt (unelastisch, Reibung, Drehimpuls) → null oder { impact (m/s
 *                                         Aufprall in Normalenrichtung), slide (m/s längs der Berührung), scrape bool,
 *                                         jx, jz (Stoß auf das eigene Auto, N·s in Spielzeug-Masse), px, pz, nx, nz, pen,
 *                                         tx, tz (Richtung, in die das eigene Auto an der Berührung entlanggleitet) }
 *   CarDrivePhys.impulse(car, jx, jz, px, pz, imp)  Stoß von außen (Mitspieler-Meldung bump): Schub + Drehstoß im
 *                                        Kontaktpunkt, ab CRASH_V kurz benommen
 *   CarDrivePhys.stepContacts(car, input, dt, me, others, onHit)
 *                                        step() in Teilstücken (≤ CHUNK m Relativweg) mit collide() gegen alle others
 *                                        nach jedem Stück (kein Durchtunneln bei Tempo/niedriger Bildrate); others wie o
 *                                        oben, optional mit x0, z0, yaw0 = Lage im vorigen Bild (wird mitinterpoliert);
 *                                        onHit(o, hit) je Berührung → { rail (größter Leitplanken-Aufprall), hits }
 *
 *   car = { x, z, yaw, vx, vz, r (Gierrate, + = links), u (längs), w (quer, + = links), steer (Radwinkel rad),
 *           roll, pitch (wie CarRaceSim: roll > 0 = neigt nach rechts, pitch > 0 = Nase hoch), spin (Raddrehung rad),
 *           s (0..L), d (Seitenversatz, + = links), prog (gefahrene Meter ab Start/Ziel, Startaufstellung negativ,
 *           rückwärts fahren zählt zurück), laps (abgeschlossene Runden, nie weniger), surface 'asphalt'|'curb'|'gravel'|'grass',
 *           nitroT (s Rest-Boost), nitroLap (Runde, in der Nitro zuletzt gezündet wurde), rail (Aufprall-Tempo der
 *           letzten Leitplanken-Berührung in diesem Schritt, sonst 0), slip (0..1 Rutschen, für Qualm/Ton) }
 *
 * Kontakte (collide): Grundfläche als Rechteck, Überlappung über die vier Kantenrichtungen beider Autos (kleinste
 * Eindringtiefe = Normale), Kontaktpunkt = Mittel der eingedrungenen Ecken. Stoß wie ein Crash, nicht wie Flipper:
 * kaum Rückprall (RESTITUTION, bei hartem Aufprall noch weniger), Reibung längs der Berührung (seitliches Schrammen
 * gleitet ab), Stoß im Kontaktpunkt dreht das Auto (Treffer hinten außermittig = Dreher), Knautschzone kostet je nach
 * Aufprall und Massenverhältnis zusätzlich Tempo, danach kurz weniger Haftung/Lenkung (car.hitT). Schwere Autos
 * bewegen sich kaum, leichte werden geschoben. Keine Ausfälle – Arcade.
 *
 * Modell: Einspurmodell (Vorder-/Hinterachse je halbe Masse), Seitenkraft je Achse aus dem Schräglaufwinkel mit
 * Sättigung (über dem Haftmaximum fällt sie auf 80 % – Rutschen), Haftung = st.grip (m/s²); Lastwechsel beim
 * Bremsen/Gasgeben verschiebt Haftung nach vorn/hinten; angetriebene Achse verliert Seitenhaftung unter Gas
 * (Reibungskreis: Heckantrieb übersteuert, Frontantrieb untersteuert); Handbremse: Hinterachse rutscht.
 * Drift (P.drift 0–1 aus den Race stats, Bezug 0,5): hohe Driftfreude = Heck etwas lockerer, die Seitenkraft hinten
 * fällt über dem Haftmaximum nur sanft ab (Rutschen lässt sich mit Gas halten), die Handbremse dreht williger, beim
 * Rutschen reicht der Lenkeinschlag weiter fürs Gegenlenken; niedrige Driftfreude = Heck hält etwas mehr (Untersteuern),
 * fällt über dem Maximum stärker ab (kein automatisches Einfangen – der Spieler lenkt selbst gegen).
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
  // Rückwärtsgang: Endtempo (m/s, Spielzeug-Maßstab, ~1/5 vorwärts) und Antrieb (Anteil von acc, mindestens REV_A_MIN
  // m/s² – muss Rollwiderstand + Kies/Gras überwinden, sonst kommt man aus dem Auslauf nicht rückwärts heraus)
  var REV_V = 5, REV_A = 0.85, REV_A_MIN = 3.6;
  var SURF = {
    asphalt: { grip: 1, k: 0, c: 0, bump: 0 },
    curb: { grip: 0.95, k: 0, c: 0.2, bump: 0.35 },
    gravel: { grip: 0.5, k: 0.45, c: 2, bump: 1 },
    grass: { grip: 0.62, k: 0.32, c: 1.4, bump: 0.6 }
  };
  // Kontakte: Rückprall, Reibung längs der Berührung, Trägheitsfaktor (< 1 = dreht leichter, Arcade),
  // ab CRASH_V m/s Aufprall ist es ein Crash (sonst Schrammen), Knautsch-Tempoverlust je m/s, größte Drehung durch Stoß
  var PEER_SOFT = 0.3, PEER_CORR = 4;   // Mitspieler: Anteil der Überlappung je Teilschritt, größtes Korrekturtempo (m/s)
  var RESTITUTION = 0.12, CONTACT_MU = 0.4, INERTIA_K = 0.7, CRASH_V = 2.5, CRUMPLE = 0.014, MAX_DR = 3.2, HIT_T = 0.7;
  var DRIVE = { rwd: [0, 1.4], fwd: [1.4, 0], awd: [0.75, 0.75] };   // Antriebsanteil vorn/hinten (Reibungskreis)

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function mod(a, n) { var r = a % n; return r < 0 ? r + n : r; }
  function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function sign(x) { return x < 0 ? -1 : 1; }
  // Seitenkraft-Kurve (normiert): steigt bis x = 1 auf 1, danach Gleitreibung bis floor (Standard 0,8) mit Abfall k
  function sat(x, floor, k) {
    var a = Math.abs(x);
    return a <= 1 ? x * (1.5 - 0.5 * a * a) : sign(x) * Math.max(floor == null ? 0.8 : floor, 1 - (k == null ? 0.12 : k) * (a - 1));
  }

  function params(st, raw) {
    raw = raw || {};
    st = st || {};
    var len = st.len > 0 ? st.len : 4.5;
    return {
      acc: st.acc || 5, vtop: (st.vmax || 27) / 1.04, grip: st.grip || 11, brake: st.brake || 8,
      susp: st.susp || 0.5, launch: st.launch || 1, mass: st.mass || 4.5, len: len,
      wb: 0.6 * len,
      // schwere Fahrzeuge (Bus/Lkw) quietschen/qualmen erst bei deutlich mehr Schräglauf (große, weiche Reifen)
      slipK: (st.mass || 4.5) > 10 ? 1.5 : 1, width: clamp(len * 0.42, 1.7, 2.6), drive: DRIVE[raw.drive] ? raw.drive : 'rwd',
      realVmax: raw.vmax > 0 ? +raw.vmax : 300, wheelR: clamp(0.07 * len, 0.3, 0.55),
      lock: clamp((raw.steer > 0 ? +raw.steer : 38) * Math.PI / 180, 0.17, 1.05),  // größter Radeinschlag (rad) je Auto
      drift: st.drift != null && isFinite(st.drift) ? clamp(+st.drift, 0, 1) : 0.5     // Driftfreude (Race stats)
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
      nitroT: 0, nitroLap: -1, rail: 0, slip: 0, rails: 0, hitT: 0
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
    // Lenkung: im Stand voller Einschlag des Autos (P.lock), mit Tempo nur so viel, wie die Haftung nutzen kann –
    // kinematischer Winkel für den Grenzradius (wb·G/u²) plus Schräglauf vorn knapp über dem Haftungsmaximum, damit
    // man die Kurvenhaftung voll ausfahren (und leicht überziehen) kann statt hart zu untersteuern
    var lock = P.lock || MAX_STEER, Gs = P.grip * S.grip;
    var dr0 = P.drift == null ? 0.5 : P.drift;
    // Gegenlenken beim Rutschen: je driftfreudiger, desto mehr Einschlag über den Grenzwinkel hinaus
    var slideX = (inp.steer || 0) * car.r < 0 ? clamp((car.slip - 0.45) / 0.35, 0, 1) * dr0 * 0.25 : 0;
    var maxSteer = clamp(P.wb * Gs / Math.max(1, u * u) + ALPHA_PEAK * 0.9 + slideX, 0.1, lock);
    var want = clamp(inp.steer || 0, -1, 1) * maxSteer;
    // Lenkhilfe gegen Untersteuern: die Vorderräder nie weiter als bis zum Haftungsmaximum über die Fahrtrichtung der
    // Vorderachse hinaus einschlagen (mehr Einschlag würde nur rutschen – lange Busse/Lkw schoben sonst geradeaus);
    // bei Schritttempo bleibt der volle Einschlag (kinematisch), dazwischen weich
    if (Math.abs(u) > 2) {
      var dirS = u < -0.5 ? -1 : 1, aim = Math.atan2(w + car.r * (P.wb / 2), Math.max(Math.abs(u), 4)) * dirS;
      var band = ALPHA_PEAK * 1.15 + Math.max(0, 7 - Math.abs(u)) * 0.12 + slideX;
      // nur begrenzen, nie selbst gegenlenken: höchstens bis zur Mitte zurück, Gegenlenken macht der Spieler
      if (want > 0) want = Math.min(want, Math.max(0, aim + band));
      else if (want < 0) want = Math.max(want, Math.min(0, aim - band));
    }
    // nach einem Crash kurz benommen: Lenkung träger, weniger Haftung, Drehung wird nicht kinematisch weggebügelt
    var stun = car.hitT > 0 ? clamp(car.hitT / 0.4, 0, 1) : 0;
    if (car.hitT > 0) car.hitT = Math.max(0, car.hitT - dt);
    car.steer += clamp(want - car.steer, -3.2 * dt * (1 - 0.7 * stun), 3.2 * dt * (1 - 0.7 * stun));
    var delta = car.steer;
    var thr = clamp(inp.throttle || 0, 0, 1), brk = clamp(inp.brake || 0, 0, 1), hb = !!inp.handbrake;
    var nitro = car.nitroT > 0;
    var vtop = P.vtop * (nitro ? NITRO_V : 1);
    // Längs: Antrieb (wie die Sim: fällt mit (v/vtop)^4), Bremse/Rückwärts, Fahrwiderstand, Untergrund
    // Rückwärtsgang wie im Rennspiel: vorwärts bremst S, im Stand fährt S rückwärts (bis REV_V, ohne Nitro),
    // rückwärts bremst W, im Stand fährt W wieder vorwärts. pedal = das Pedal, das gerade antreibt (Motorbremse nur ohne).
    var ax = 0, pedal = thr, revA = Math.max(REV_A_MIN, P.acc * REV_A);
    if (u > 0.5 || (u >= -0.5 && brk < 0.05)) {
      var launch = u < 8 ? P.launch : 1;
      ax += thr * P.acc * launch * (nitro ? NITRO_A : 1) * Math.max(0, 1 - Math.pow(Math.max(0, u) / vtop, 4));
      if (u > 0.5) ax -= brk * P.brake;
    } else if (u < -0.5) {
      // rückwärts: Bremse = Rückwärtsgas (bis REV_V), Gas bremst
      pedal = brk;
      ax -= brk * revA * Math.max(0, 1 - Math.pow(-u / REV_V, 3));
      ax += thr * P.brake;
    } else if (brk >= 0.05) { pedal = brk; ax -= brk * revA; }   // aus dem Stand rückwärts anfahren
    var roll = 0.25 + (pedal < 0.05 ? 0.9 : 0) + 0.0015 * u * u;   // Rollwiderstand + Motorbremse + Luft
    var resist = roll + S.c + S.k * Math.abs(u) + (hb ? 3.5 : 0);
    if (Math.abs(u) > 0.05) ax -= sign(u) * resist;
    // Haftung je Achse (Lastwechsel, Untergrund, Handbremse, Antrieb am Reibungskreis)
    var G = P.grip * S.grip, shift = clamp(-car.ax / G * 0.3, -0.22, 0.22);
    var Gf = G * 1.04 * (1 + shift), Gr = G * 0.98 * (1 - shift);
    var dr = DRIVE[P.drive], drv = Math.max(0, ax) ;
    Gf = Math.sqrt(Math.max(Gf * Gf * 0.25, Gf * Gf - Math.pow(drv * dr[0], 2)));
    Gr = Math.sqrt(Math.max(Gr * Gr * 0.25, Gr * Gr - Math.pow(drv * dr[1], 2)));
    Gr *= 1 + 0.08 * (0.5 - dr0);                       // Driftfreude: Heck lockerer (hoch) bzw. fester (niedrig)
    if (hb) Gr *= 0.42 - 0.2 * dr0;                     // Handbremse dreht driftfreudige Autos williger
    if (stun > 0) { Gf *= 1 - 0.5 * stun; Gr *= 1 - 0.55 * stun; }
    // Seitenkräfte (je Achse als Beschleunigung ihrer halben Masse)
    var ue = Math.max(Math.abs(u), 4), dirSign = u < -0.5 ? -1 : 1;
    var af = Math.atan2(w + car.r * a, ue) - delta * dirSign, ar = Math.atan2(w - car.r * b, ue);
    var Ff = -Gf * sat(af / ALPHA_PEAK), Fr = -Gr * sat(ar / ALPHA_PEAK, 0.72 + 0.2 * dr0, 0.16 - 0.08 * dr0);
    var ay = (Ff * Math.cos(delta) + Fr) / 2;
    var yawAcc = (a * Ff * Math.cos(delta) - b * Fr) / 2 / (a * b);
    car.slip = clamp(Math.max(Math.abs(af), Math.abs(ar)) / (ALPHA_PEAK * 2.5 * P.slipK) * Math.min(1, sp / 6) + (hb && sp > 3 ? 0.4 : 0), 0, 1);
    // integrieren
    car.vx += (fx * ax + lx * ay) * dt; car.vz += (fz * ax + lz * ay) * dt;
    car.r += yawAcc * dt;
    // leichte Gierdämpfung (Stabilität); bei langem Radstand schwächer – dort ist das Giermoment der Reifen kleiner,
    // eine feste Dämpfung fräße Bussen/Lkw die halbe Lenkwirkung
    car.r -= car.r * 0.6 * Math.min(1, 2.8 / P.wb) * dt;
    // (kein automatisches Einfangen eines ausbrechenden Hecks mehr – Gegenlenken macht der Spieler; wenig Driftfreude
    // wirkt über mehr Haftung hinten und einen sanfteren Abfall der Seitenkraft)
    // langsam: kinematisch (kein Schräglauf-Modell nahe 0) – Gierrate aus Lenkwinkel, Querrutschen abbauen
    var k = Math.max(clamp((Math.abs(u) - 1.5) / 4, 0, 1), stun);
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
    else if (u < -0.3 && u2 > 0 && thr >= 0.05) { car.vx -= fx * u2; car.vz -= fz * u2; }  // rückwärts: Gas hält bei 0 an
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
    car.roll = car.pitch = car.rollV = car.pitchV = 0; car.ax = car.ay = 0; car.hitT = 0;
    var pr = project(car.T, car.x, car.z, car.hint); car.d = pr.d; car.hint = pr.i; car.surface = 'asphalt';
    return car;
  }

  // ---- Kontakte Auto ↔ Auto ----
  // Umriss = konvexes Polygon im Fahrzeugsystem [[a (vorn +), b (links +)], …] in Metern, gegen den Uhrzeigersinn
  // von oben (x/z) gesehen. o.shape aus dem Modell (outline), sonst Rechteck mit runden Ecken aus len/w.
  var ROUND = 0.35, shapeCache = {};
  function roundedRect(len, w) {
    var key = len.toFixed(3) + '|' + w.toFixed(3);
    if (shapeCache[key]) return shapeCache[key];
    var hl = len / 2, hw = w / 2, r = Math.min(ROUND * w, hl * 0.9, hw * 0.9), out = [];
    // Ecken vorn links → hinten links → hinten rechts → vorn rechts, je Ecke ein Viertelkreis aus 4 Punkten
    [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]].forEach(function (c) {
      var ca = c[0] * (hl - r), cb = c[1] * (hw - r), a0 = c[2] * Math.PI / 2;
      for (var k = 0; k < 4; k++) { var t = a0 + k / 3 * Math.PI / 2; out.push([ca + Math.cos(t) * r, cb + Math.sin(t) * r]); }
    });
    return (shapeCache[key] = out);
  }
  // konvexe Hülle (Andrew) einer Punktwolke [[a, b], …], auf höchstens maxN Ecken vereinfacht (kleinste Dreiecksfläche
  // zuerst weg, Visvalingam) – Umriss eines Modells von oben
  function outline(pts, maxN) {
    var P = pts.filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (P.length < 3) return null;
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], hi = [], i;
    for (i = 0; i < P.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 0) lo.pop(); lo.push(P[i]); }
    for (i = P.length - 1; i >= 0; i--) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], P[i]) <= 0) hi.pop(); hi.push(P[i]); }
    var H = lo.slice(0, -1).concat(hi.slice(0, -1));
    maxN = maxN || 16;
    while (H.length > maxN) {
      var best = -1, bestA = Infinity;
      for (i = 0; i < H.length; i++) {
        var a = Math.abs(cross(H[(i + H.length - 1) % H.length], H[i], H[(i + 1) % H.length]));
        if (a < bestA) { bestA = a; best = i; }
      }
      H.splice(best, 1);
    }
    return H.length >= 3 ? H : null;
  }
  function shapeOf(o) { return o.shape && o.shape.length >= 3 ? o.shape : roundedRect(o.len, o.w); }
  // Umriss in Weltkoordinaten: a längs (cos yaw, −sin yaw), b links (−sin yaw, −cos yaw)
  function poly(o) {
    var c = Math.cos(o.yaw), sn = Math.sin(o.yaw), sh = shapeOf(o), out = new Array(sh.length);
    for (var i = 0; i < sh.length; i++) { var a = sh[i][0], b = sh[i][1]; out[i] = [o.x + c * a - sn * b, o.z - sn * a - c * b]; }
    return out;
  }
  function projPoly(P, nx, nz) {
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < P.length; i++) { var d = P[i][0] * nx + P[i][1] * nz; if (d < lo) lo = d; if (d > hi) hi = d; }
    return [lo, hi];
  }
  // Punkt im konvexen Polygon (beliebiger Umlaufsinn, Rand + eps zählt mit)
  function insidePoly(P, p, eps) {
    var sgn = 0;
    for (var i = 0; i < P.length; i++) {
      var a = P[i], b = P[(i + 1) % P.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
      var cr = (ex * (p[1] - a[1]) - ez * (p[0] - a[0])) / L;
      if (Math.abs(cr) <= eps) continue;
      var s1 = cr > 0 ? 1 : -1;
      if (sgn && s1 !== sgn) return false;
      sgn = s1;
    }
    return true;
  }
  // Polygon gegen Polygon (Trennachsen über alle Kantennormalen beider Umrisse): a/b = { x, z, yaw, len, w, shape? } →
  // null oder { pen, nx, nz (Normale von b zu a), px, pz (Kontaktpunkt) }
  function overlap(a0, b0) {
    var A = poly(a0), B = poly(b0), dx = a0.x - b0.x, dz = a0.z - b0.z, best = null;
    for (var pass = 0; pass < 2; pass++) {
      var P = pass ? B : A;
      for (var i = 0; i < P.length; i++) {
        var p = P[i], q = P[(i + 1) % P.length], nx = -(q[1] - p[1]), nz = q[0] - p[0], L = Math.hypot(nx, nz);
        if (L < 1e-9) continue;
        nx /= L; nz /= L;
        var pa = projPoly(A, nx, nz), pb = projPoly(B, nx, nz), pen = Math.min(pa[1] - pb[0], pb[1] - pa[0]);
        if (pen <= 0) return null;                     // Trennachse gefunden
        var dist = dx * nx + dz * nz;
        if (!best || pen < best.pen - 1e-9) best = { pen: pen, nx: dist < 0 ? -nx : nx, nz: dist < 0 ? -nz : nz };
      }
    }
    if (!best) return null;
    // Kontaktpunkt: Mittel der Ecken, die im anderen Umriss stecken (sonst Stützpunkt von a gegen die Normale)
    var sx = 0, sz = 0, n = 0, k;
    for (k = 0; k < A.length; k++) if (insidePoly(B, A[k], 0.02)) { sx += A[k][0]; sz += A[k][1]; n++; }
    for (k = 0; k < B.length; k++) if (insidePoly(A, B[k], 0.02)) { sx += B[k][0]; sz += B[k][1]; n++; }
    if (n) { best.px = sx / n; best.pz = sz / n; }
    else {
      var lo = Infinity, bp = A[0];
      for (k = 0; k < A.length; k++) { var d = A[k][0] * best.nx + A[k][1] * best.nz; if (d < lo) { lo = d; bp = A[k]; } }
      best.px = bp[0] + best.nx * best.pen / 2; best.pz = bp[1] + best.nz * best.pen / 2;
    }
    return best;
  }
  function collide(car, me, o, dtSub) {
    var P = car.P, len = me && me.len > 0 ? me.len : P.len, w = me && me.w > 0 ? me.w : P.width;
    var h = overlap({ x: car.x, z: car.z, yaw: car.yaw, len: len, w: w, shape: me && me.shape }, o);
    if (!h) return null;
    var nx = h.nx, nz = h.nz, tx = -nz, tz = nx;
    var mP = P.mass, mA = o.mass > 0 ? o.mass : P.mass, invA = isFinite(mA) ? 1 / mA : 0;
    // Lage: ganz heraus, wenn ich hineinfahre – so fährt man nie durch ein Auto, auch langsam/rückwärts nicht.
    // Rammt mich dagegen der andere (KI-/Fremdauto auf fester Bahn, das hier nicht ausweicht), schiebt er mich nur
    // nach Massenanteil: ein leichter Wagen verschiebt einen Bus kaum (der Rest bleibt als Überlappung stehen).
    // Gilt immer, wenn nicht ich hineinfahre (auch seitliches Abdrängen in der Kurve), und weich über ein paar
    // Teilschritte statt in einem Ruck (kein „Plopp“): Abdrängen wirkt langsam und nach Gewicht.
    var myIn = -(car.vx * nx + car.vz * nz), oIn = (o.vx || 0) * nx + (o.vz || 0) * nz;
    // Mitspieler (o.peer): der andere Client rechnet denselben Kontakt bei sich – jeder nimmt nur seinen Massenanteil,
    // weich über die Teilschritte (zusammen einmal, nicht doppelt; kein Sprung)
    var peer = !!o.peer && invA > 0;
    var share = peer ? clamp(mA / (mA + mP), 0.1, 0.9) : invA && oIn > 0.05 && oIn >= myIn ? Math.max(0.08, mA / (mA + mP)) * 0.45 : 1;
    // Steckt ein leichterer Rammer schon tiefer drin: weder schieben noch Stoß – er fährt durch (wie im Overlay, wo die Sim
    // fährt), statt mich Bild für Bild auf sein Tempo mitzunehmen
    // (auch wenn die Berührungsnormale beim Durchfahren umklappt – sonst ein Sprung um die halbe Breite; 0,45 m liegt
    // über dem Teilschritt CHUNK, eigenes Hineinfahren erreicht das nie)
    if (!peer && invA && mA < mP * 0.9 && h.pen > 0.45) return { impact: 0, slide: 0, scrape: false, jx: 0, jz: 0, px: h.px, pz: h.pz, nx: nx, nz: nz, pen: h.pen, tx: tx, tz: tz };
    // leichterer Schieber: keine Lagekorrektur (sie würde mich Bild für Bild mit seinem Tempo mitnehmen), nur der
    // begrenzte Stoß unten; gleich schwere/schwerere drängen weich nach Massenanteil ab
    var lightPush = !peer && share < 1 && mA < mP * 0.9;
    if (peer) {
      var corr = Math.min(h.pen * share * PEER_SOFT, PEER_CORR * (dtSub > 0 ? dtSub : SUB));
      car.x += nx * corr; car.z += nz * corr;
    } else if (!lightPush) { car.x += nx * (h.pen * share + 0.002); car.z += nz * (h.pen * share + 0.002); }
    var I = mP * (len * len + w * w) / 12 * INERTIA_K;
    var rx = h.px - car.x, rz = h.pz - car.z;            // Hebel vom Schwerpunkt zum Kontaktpunkt
    // Tempo im Kontaktpunkt: v + Gierrate × Hebel (Gierrate + = links: Punkt bewegt sich um (rz, −rx))
    var rvx = car.vx + car.r * rz - (o.vx || 0), rvz = car.vz - car.r * rx - (o.vz || 0);
    var vn = rvx * nx + rvz * nz, vt = rvx * tx + rvz * tz;
    var res = { impact: 0, slide: Math.abs(vt), scrape: false, jx: 0, jz: 0, px: h.px, pz: h.pz, nx: nx, nz: nz, pen: h.pen,
      tx: vt < 0 ? -tx : tx, tz: vt < 0 ? -tz : tz };
    if (vn >= 0) return res;                            // trennt sich schon: nur Lage korrigieren
    var impact = -vn;
    var cn = rz * nx - rx * nz, ct = rz * tx - rx * tz;
    var e = RESTITUTION * clamp(1 - impact / 16, 0.25, 1);   // harter Aufprall federt noch weniger
    var Jn = -(1 + e) * vn / (1 / mP + cn * cn / I + invA);
    // Schiebt mich ein Auto auf fester Bahn (KI/Fremdauto, gibt nicht nach), drückt es höchstens mit dem, was seine
    // Reifen hergeben (Masse × Haftung) – ein leichter Wagen bewegt einen Lkw kaum, gleich schwere drängen ab;
    // Aufprall-Stöße (hartes Auffahren) bleiben
    // (halbe Haftung: der Schieber lenkt ja nicht absichtlich in mich hinein – ein Anstupser drängt, wirft aber nicht raus)
    if (!peer && share < 1 && dtSub > 0 && impact < CRASH_V) Jn = Math.min(Jn, 0.5 * mA * (o.grip || P.grip) * dtSub);
    // Ein leichterer Schieber auf fester Bahn gibt nie nach: ohne Grenze stieße er in jedem Teilschritt neu, bis ich
    // sein Tempo habe (ein Golf beschleunigt dann einen Bus wie ein Lkw). Je Kontakt bekommt er deshalb nur den Schwung,
    // den ein echter Stoß überträgt (reduzierte Masse × Anfahrtempo × (1 + e)), danach nur noch das weiche Drängen nach Haftung.
    // Mitspieler genauso: sein Tempo kommt erst mit dem nächsten Zustand – ohne Grenze stieße er bis dahin in jedem
    // Teilschritt neu (Flipper). Ein Stoß je Berührung, danach nur das weiche Anlehnen.
    if (lightPush || peer) {
      var st = o.c || o, tick = car.cTick || 0;
      if (!(st.jTick >= tick - 1) || st.jCar !== car) { st.jUsed = 0; st.jMax = (1 + e) * impact * mA * mP / (mA + mP); st.jCar = car; }
      st.jTick = tick;
      var soft = dtSub > 0 ? 0.5 * mA * (o.grip || P.grip) * dtSub : 0;
      Jn = Math.min(Jn, Math.max(st.jMax - st.jUsed, soft));
      st.jUsed += Jn;
    }
    var Jt = clamp(-vt / (1 / mP + ct * ct / I + invA), -CONTACT_MU * Jn, CONTACT_MU * Jn);
    var jx = nx * Jn + tx * Jt, jz = nz * Jn + tz * Jt;
    car.vx += jx / mP; car.vz += jz / mP;
    // Drehstoß: schiebt mich ein Auto auf fester Bahn nur seitlich an (Schrammen), dreht es mich kaum – sonst reicht
    // ein Anstupser am Heck, um mich aus der Kurve zu drehen; eigene Treffer und harte Aufpralle drehen voll
    // (auch beim Crash, wenn ein leichteres Auto mich anfährt: ein Golf dreht keinen Bus)
    car.r += clamp((rz * jx - rx * jz) / I, -MAX_DR, MAX_DR) * (share < 1 && (impact < CRASH_V || mA < mP * 0.9) ? 0.35 : 1);
    var scrape = impact < CRASH_V;
    if (!scrape) {
      // Knautschzone: zusätzlicher Tempoverlust nach Aufprall und Massenverhältnis (gegen schwere Autos mehr)
      var heavy = invA ? mA / (mA + mP) : 1, keep = 1 - Math.min(0.35, impact * CRUMPLE * 1.3 * heavy);
      car.vx *= keep; car.vz *= keep;
      // benommen (weniger Haftung/Lenkung) nach Massenverhältnis: gleich schwer wie bisher, ein Bus nach einem
      // Golf-Treffer kaum – sonst bricht sein Heck schon bei einem Stups aus und bleibt im Drift
      var daze = clamp(2 * heavy, 0.1, 1);
      car.hitT = Math.max(car.hitT || 0, Math.min(HIT_T, (0.12 + impact * 0.035) * daze));
      car.steer *= 1 - 0.5 * daze;
    }
    var fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw), lx = -Math.sin(car.yaw), lz = -Math.cos(car.yaw);
    car.u = car.vx * fx + car.vz * fz; car.w = car.vx * lx + car.vz * lz;
    res.impact = impact; res.scrape = scrape; res.jx = jx; res.jz = jz;
    return res;
  }

  // Stoß von außen (Mitspieler meldet den Kontakt, bump): J (N·s Spielzeug-Masse) im Punkt (px, pz) – Schub UND
  // Drehstoß wie in collide (Treffer hinten außermittig dreht), harter Aufprall (imp ≥ CRASH_V) macht kurz benommen
  function impulse(car, jx, jz, px, pz, imp) {
    var P = car.P, mP = P.mass, I = mP * (P.len * P.len + P.width * P.width) / 12 * INERTIA_K;
    car.vx += jx / mP; car.vz += jz / mP;
    if (isFinite(px) && isFinite(pz)) {
      var rx = px - car.x, rz = pz - car.z;
      if (rx * rx + rz * rz < P.len * P.len) car.r += clamp((rz * jx - rx * jz) / I, -MAX_DR, MAX_DR) * ((imp || 0) >= CRASH_V ? 1 : 0.35);
    }
    if ((imp || 0) >= CRASH_V) { car.hitT = Math.max(car.hitT || 0, Math.min(HIT_T, 0.12 + imp * 0.035)); car.steer *= 0.5; }
    var fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw), lx = -Math.sin(car.yaw), lz = -Math.cos(car.yaw);
    car.u = car.vx * fx + car.vz * fz; car.w = car.vx * lx + car.vz * lz;
  }

  var CHUNK = 0.3;
  function stepContacts(car, inp, dt, me, others, onHit) {
    others = others || [];
    var vmax = Math.hypot(car.vx, car.vz), i, o;
    for (i = 0; i < others.length; i++) {
      o = others[i];
      var mv = o.x0 != null ? Math.hypot(o.x - o.x0, o.z - o.z0) / Math.max(dt, 1e-3) : Math.hypot(o.vx || 0, o.vz || 0);
      vmax = Math.max(vmax, Math.hypot(car.vx, car.vz) + mv);
    }
    var n = others.length ? clamp(Math.ceil(vmax * Math.min(dt, 0.1) / CHUNK), 1, 12) : 1, rail = 0, hits = [];
    car.cTick = (car.cTick || 0) + 1;   // Bildzähler: zusammenhängender Kontakt über mehrere Bilder
    for (var k = 1; k <= n; k++) {
      step(car, inp, dt / n);
      rail = Math.max(rail, car.rail);
      for (i = 0; i < others.length; i++) {
        o = others[i];
        var f = k / n, pose = o;
        if (o.x0 != null && f < 1) {
          pose = { x: o.x0 + (o.x - o.x0) * f, z: o.z0 + (o.z - o.z0) * f, yaw: o.yaw0 + wrapAngle(o.yaw - o.yaw0) * f,
            len: o.len, w: o.w, vx: o.vx, vz: o.vz, mass: o.mass, grip: o.grip, c: o.c || o };
        }
        var reach = (o.len + (me && me.len > 0 ? me.len : car.P.len)) / 2 + 1;
        if (Math.abs(pose.x - car.x) > reach || Math.abs(pose.z - car.z) > reach) continue;
        var h = collide(car, me, pose, dt / n);
        if (h) { h.o = o; hits.push(h); if (onHit) onHit(o, h); }
      }
    }
    car.rail = rail;
    return { rail: rail, hits: hits };
  }

  function speedKmh(car) { return Math.abs(car.u) / car.P.vtop * car.P.realVmax; }
  function nitroReady(car) { return car.nitroLap !== car.laps && car.nitroT <= 0; }

  return {
    params: params, trackInfo: trackInfo, project: project, create: create, step: step, reset: reset,
    speedKmh: speedKmh, nitroReady: nitroReady, impulse: impulse, overlap: overlap, outline: outline, roundedRect: roundedRect, collide: collide, stepContacts: stepContacts, CRASH_V: CRASH_V, MAX_STEER: MAX_STEER, NITRO_T: NITRO_T, REV_V: REV_V
  };
});
