/* Car Race: Strecken und deterministische Fahrsimulation (ohne DOM, ohne three.js).
 * Läuft im Browser (window.CarRaceSim) und in Node (module.exports). Prüfskript: scripts/check_car_race_sim.js
 *
 *   CarRaceSim.rng(seed) → () => Zahl in [0, 1)          mulberry32, einzige Zufallsquelle der Simulation
 *   CarRaceSim.TRACKS = [1, 2, 3]                         drei kuratierte Strecken, Reihenfolge fest:
 *       1 Speedway (fast), 2 Twister (twisty), 3 Hairpin (hairpin); der Server schickt eine Zufallszahl,
 *       der Client nimmt TRACKS[track % TRACKS.length]. CarRaceSim.LAYOUTS = die Polygone dazu.
 *   CarRaceSim.track(seed) → { pts, len, width, at(s), radiusAt(s), runoffAt(s), runoff, corners,
 *                              longestStraight, turnDir, name, character }
 *       seed wählt das Layout LAYOUTS[(seed − 1) mod 3]; aus dem Seed kommen nur die Wellen.
 *       Polygon mit Eckradien: Geraden + Kreisbögen, Links- UND Rechtskurven, Radien ≥ 13 m, Runde ~295–315 m.
 *       pts = Mittellinie im 1-m-Raster [[x, z]…]; at(s) → { x, z, yaw, curv, nx, nz, bump, runL, runR }
 *       (s in Metern ab Start/Ziel, beliebig auch negativ/über len hinaus; yaw so, dass three.js
 *       rotation.y = yaw die Front +x in Fahrtrichtung dreht; curv > 0 = Linkskurve;
 *       (nx, nz) = Normale nach links, Position eines Autos = (x + nx·d, z + nz·d); bump 0..1 = Wellen;
 *       runL/runR = Auslauf (Gras/Kies, m) links/rechts neben der Fahrbahn, dahinter die Leitplanke bei
 *       |d| = width/2 + Auslauf). runoffAt(s) → { left, right }; runoff = { left: [], right: [], max: 12 }
 *       je Rasterpunkt (Index i ↔ s = i · len / pts.length). Auslauf 0–12 m, nie über die Mitte zu einem
 *       anderen Streckenteil, innen in Kurven kleiner.
 *       corners = [{ s0, len, dir (+1 links / −1 rechts), minR, counter (gegen die Hauptdrehrichtung) }],
 *       Kurve = zusammenhängender Abschnitt mit |curv| > 1/60; longestStraight (m); turnDir = Hauptdrehrichtung.
 *   CarRaceSim.stats(raw) → { acc, vmax, grip, brake, susp, launch, len, mass }
 *       raw = Verhältnis-Werte aus dem Car editor { power, speed, handling, susp, brakes, weight } je 1–10,
 *       drive 'fwd'|'rwd'|'awd', len (m). Keine echten km/h/PS: nur das Verhältnis zählt.
 *       vmax ist die absolute Grenze (mit Windschatten); frei fährt das Auto vmax / 1,04.
 *       mass = Masse für Kontakte aus Länge und weight (Bus ≈ 17, Kleinwagen ≈ 4).
 *   CarRaceSim.create({ seed, track, laps, finishWindow, cars: [{ id, stats }] }) → sim
 *       track = Strecken-Seed (oder fertiges track()-Objekt). cars in Startreihenfolge (Index 0 = Pole).
 *       sim.step()            ein fester Schritt DT = 1/60 s
 *       sim.fastForward(t)    Schritte bis sim.time ≥ t (gleiches Ergebnis wie durchlaufen, inkl. events/hazards)
 *       sim.time, sim.done, sim.track,
 *       sim.counts = { spins, crashes, crashDnf, slides, offs, rails, pushes, oilHits }
 *       sim.cars[i] = { id, s, d, v, lap, pos, yaw, roll, pitch, steer, spin, state, place, finish, draft, off }
 *         s = gefahrene Meter ab Start/Ziel (Startaufstellung negativ), d = Seitenversatz (m, > 0 links;
 *         neben der Fahrbahn bis zur Leitplanke möglich: |d| ≤ width/2 + Auslauf),
 *         lap = 0 in der Aufstellung, dann 1..laps; pos = aktuelle Position (1 = vorn, = standings());
 *         yaw/roll/pitch in rad (yaw stetig, ohne 2π-Sprünge – darf frei interpoliert werden;
 *         roll > 0 = Aufbau neigt nach rechts, pitch > 0 = Nase hoch),
 *         steer = Lenkwinkel der Vorderräder (rad), spin = Raddrehwinkel (rad, 0..2π),
 *         state 'run'|'spin'|'crash'|'dnf'|'done' (keine neuen Werte: ein Auto im Gras ist 'run' mit off = true),
 *         place = Zielplatz oder null, finish = Zielzeit (s) oder null,
 *         draft = id des Vordermanns, solange Windschatten wirkt, sonst null,
 *         off = true, solange die Wagenmitte neben dem Asphalt ist (Gras/Kiesbett: Staub, Holpern).
 *       sim.events = [{ t, type, id, other? , …}] in Zeitreihenfolge (t = Sim-Zeit in s, auf ms gerundet):
 *         'overtake' id zieht an other vorbei (genau dann, wenn sich die Reihenfolge von standings() ändert;
 *                    nur vor Rennende, ohne Ausgeschiedene; 1 m Hysterese gegen Flackern),
 *         'spin'     Dreher (1–2 s), 'crash' Unfall (3–6 s; rail: true = Leitplanke),
 *         'off'      Wagenmitte verlässt den Asphalt (Abflug in der Kurve, auf Öl oder geschubst),
 *         'oil'      id fährt über einen Ölfleck (Grip bricht 0,5 s ein),
 *         'push'     Kontakt: id = das leichtere (stärker geschubste) Auto, other = das schwerere;
 *                    kind 'rear'|'side', push/pushOther = seitlicher Schub (m/s), loss/lossOther = Tempoverlust (m/s),
 *         'dnf'      ausgeschieden, reason 'crash'|'rail'|'time' (time = bei Rennende nicht im Ziel).
 *       sim.hazards = [{ s, d, r, from, src }] Ölflecken (Mitte bei s/d, Radius r 1,5–2,5 m), from = Sim-Zeit des
 *         Erscheinens, src = 'track' (Zufallsfleck, ~60 % der Rennen, ab Start oder ab Runde 2) oder id des Autos,
 *         dessen Crash/Schubser ihn hinterlassen hat. Höchstens 3, bleiben bis Rennende.
 *       sim.standings() → [id…]  aktuelle Reihenfolge
 *       sim.result() → [{ id, place|null }] in Startreihenfolge (null = DNF)
 *       Ende: der erste im Ziel startet die Frist finishWindow; wer danach nicht im Ziel ist, ist DNF.
 *       Spätestens nach 90 s ist Schluss. Nach sim.done fahren die Autos zur Darstellung locker weiter,
 *       am Ergebnis ändert sich nichts mehr, es kommen keine Ereignisse mehr dazu.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CarRaceSim = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var DT = 1 / 60;
  var MAX_TIME = 90;          // Rennen endet spätestens nach 90 s
  var WIDTH = 10;             // Streckenbreite (m)
  var SLIP_RANGE = 25;        // Windschatten bis 25 m Abstand
  var SLIP_BONUS = 1.04;      // +4 % Endgeschwindigkeit im Windschatten
  // Fahrphysik (spielzeughaft herunterskaliert; abgestimmt mit scripts/check_car_race_sim.js)
  var VTOP_BASE = 26.0;       // freie Endgeschwindigkeit (m/s) bei speed 5
  var ACC_BASE = 5.0;         // Beschleunigung (m/s²) bei power 5 / weight 5
  var GRIP_BASE = 11.0;        // Querbeschleunigung (m/s²) bei handling 5 / weight 5
  var BRAKE_BASE = 8.0;       // Verzögerung (m/s²) bei brakes 5 / weight 5
  var DRAG_EXP = 4;           // Beschleunigung fällt mit (v / vtop)^4 ab
  // Wirkung je Wertpunkt (relativ zu 5, gekrümmt über pts – oben steiler als unten)
  var K_POWER = 0.045, K_HANDLING = 0.04, K_BRAKES = 0.035, K_SUSP = 0.018;   // Federung: Bodenhaftung
  var K_WEIGHT_ACC = 0.017, K_WEIGHT_GRIP = 0.006, K_WEIGHT_BRAKE = 0.017;
  var STAT_EXP = 4;           // Krümmung der Wertwirkung (siehe pts)
  var LAUNCH = { awd: 1.15, rwd: 1.0, fwd: 0.93 };   // Traktion beim Losfahren je Antrieb
  var FORM_SPREAD = 0.065;    // Tagesform des Fahrers: ±3,25 % am Kurvenlimit
  var OFF_LINE = 0.03;        // Tempoverlust in Kurven je Meter neben der Ideallinie (Überholen kostet)
  // Pech: Rate je Sekunde = RISK · (v / √(G_REF·R))^RISK_EXP · e^(12·(v/eigene Grenze − 1)),
  // nur in Kurven (R_RISK = ∞: auf Geraden praktisch kein Risiko)
  var G_REF = GRIP_BASE;      // Bezugs-Kurvengrenze (m/s²)
  var RISK = 0.02;
  var RISK_EXP = 8;
  var R_RISK = Infinity;
  var DNF_CHANCE = 0.12;      // Anteil der Crashs, die das Rennen beenden
  // Pech-Arten (kumulierte Anteile): Verbremser, Abflug, Dreher, Rest Crash
  var EV_SLIDE = 0.25, EV_OFF = 0.5, EV_SPIN = 0.83;
  // Abflug ins Gras/Kiesbett
  var SLIDE_DECEL = 5;        // Verzögerung beim Rutschen über den Asphalt nach außen (m/s²)
  var GRAVEL_DECEL = 11;      // Verzögerung im Gras/Kies (m/s²)
  var GRAVEL_V = 6;           // so schnell rollt ein Auto neben der Fahrbahn zurück (m/s)
  var RAIL_V = 4;             // Einschlag in die Leitplanke ab diesem Tempo (m/s) = DNF
  // Kontakt / Schubsen
  var PUSH_K = 0.9;           // seitlicher Schub (m/s) je m/s Annäherung × 2 × Massenanteil des anderen
  var PUSH_FRIC = 9;          // Abbau des seitlichen Schubs (m/s²)
  var CONTACT_MIN = 1.5;      // Auffahren erst ab 1,5 m/s Annäherung ist ein Kontakt
  var HARD_PUSH = 8;          // harter Schubser (Auffahren ab 8 m/s): kann Öl verlieren
  var HEAVY = 2;              // ab doppelter Masse drängt ein Auto seitlich einfach in die Spur
  // Öl
  var OIL_CHANCE = 0.6;       // Anteil der Rennen mit Zufallsfleck
  var OIL_MAX = 3;            // höchstens 3 Flecken je Rennen
  var OIL_GRIP = 0.4;         // Grip-Faktor auf Öl
  var OIL_TIME = 0.5;         // so lange wirkt das Öl nach (s)
  var OIL_CRASH = 0.3;        // Chance auf einen Fleck nach Crash, Leitplanke oder hartem Schubser
  var OIL_SEE = 0.85;         // Chance, einen Fleck rechtzeitig zu sehen und auszuweichen
  var HYST = 1;               // Positionswechsel erst ab 1 m Vorsprung (kein Flackern)
  var TWO_PI = Math.PI * 2;

  // ---- Zufall ----
  function rng(seed) {
    var a = seed | 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function wrapAngle(a) { while (a > Math.PI) a -= TWO_PI; while (a < -Math.PI) a += TWO_PI; return a; }
  function mod(a, n) { var r = a % n; return r < 0 ? r + n : r; }

  // ---- Strecke ----
  // Drei kuratierte Layouts: Polygon [x, z, R] – an jeder Ecke ein Kreisbogen mit Radius R (m),
  // dazwischen Geraden. Ecken gegen die Hauptdrehrichtung ergeben Gegenkurven/Schikanen.
  var LAYOUTS = [
    { name: 'Speedway', character: 'fast', pts: [          // lange Geraden, Senke mit zwei Gegenkurven
      [0, 0, 22], [110, 0, 24], [110, 56, 15], [82, 56, 15], [70, 38, 15], [46, 38, 15], [34, 56, 15], [0, 56, 16]
    ] },
    { name: 'Twister', character: 'twisty', pts: [         // neun Kurven, S-Kurven links und rechts
      [0, 0, 15], [85, 0, 16], [100, 25, 13], [75, 41, 13], [94, 71, 13], [43, 74, 15], [30, 52, 13], [4, 58, 13], [-5, 28, 14]
    ] },
    { name: 'Hairpin', character: 'hairpin', pts: [        // lange Gerade in eine 180°-Haarnadel, danach Schikane
      [0, 0, 18], [102, 0, 13], [102, 27, 13], [70, 27, 15], [54, 48, 15], [28, 38, 15], [10, 62, 15], [-20, 36, 16]
    ] }
  ];
  var CORNER_K = 1 / 60;      // Kurve = zusammenhängender Abschnitt mit |curv| > 1/60
  var RUNOFF_MAX = 12;        // Auslauf (Gras/Kies) bis 12 m neben der Fahrbahn, dahinter Leitplanke

  // Polygon mit Eckradien → dichte Mittellinie (0,1 m); null, wenn Bögen nicht auf die Kanten passen
  function filletPath(V) {
    var N = V.length, F = [], i, k;
    for (i = 0; i < N; i++) {
      var a = V[(i - 1 + N) % N], b = V[i], c = V[(i + 1) % N];
      var u1 = [b[0] - a[0], b[1] - a[1]], l1 = Math.sqrt(u1[0] * u1[0] + u1[1] * u1[1]);
      var u2 = [c[0] - b[0], c[1] - b[1]], l2 = Math.sqrt(u2[0] * u2[0] + u2[1] * u2[1]);
      u1 = [u1[0] / l1, u1[1] / l1]; u2 = [u2[0] / l2, u2[1] / l2];
      var th = Math.atan2(u1[0] * u2[1] - u1[1] * u2[0], u1[0] * u2[0] + u1[1] * u2[1]);
      F.push({ th: th, t: b[2] * Math.tan(Math.abs(th) / 2), u1: u1, u2: u2, l2: l2 });
    }
    for (i = 0; i < N; i++) if (F[i].t + F[(i + 1) % N].t > F[i].l2 + 1e-9) return null;
    var out = [], STEP = 0.1;
    for (i = 0; i < N; i++) {
      var p = V[i], f = F[i], R = p[2], sg = f.th > 0 ? 1 : -1;
      var A = [p[0] - f.u1[0] * f.t, p[1] - f.u1[1] * f.t];
      var C = [A[0] - f.u1[1] * R * sg, A[1] + f.u1[0] * R * sg];
      var a0 = Math.atan2(A[1] - C[1], A[0] - C[0]), arc = R * Math.abs(f.th);
      for (k = 0; k < arc; k += STEP) {
        var ang = a0 + sg * k / R;
        out.push([C[0] + Math.cos(ang) * R, C[1] + Math.sin(ang) * R]);
      }
      var B = [p[0] + f.u2[0] * f.t, p[1] + f.u2[1] * f.t];
      var q = V[(i + 1) % N], g = F[(i + 1) % N], A2 = [q[0] - g.u1[0] * g.t, q[1] - g.u1[1] * g.t];
      var sl = Math.sqrt((A2[0] - B[0]) * (A2[0] - B[0]) + (A2[1] - B[1]) * (A2[1] - B[1]));
      for (k = 0; k < sl; k += STEP) out.push([B[0] + f.u2[0] * k, B[1] + f.u2[1] * k]);
    }
    return out;
  }

  // Abschnitte gleicher Art entlang der Runde (zyklisch): Kurven (|curv| > 1/60, je Vorzeichen) und Geraden
  function sections(CRV, n, ds) {
    function kind(i) { return Math.abs(CRV[i]) > CORNER_K ? (CRV[i] > 0 ? 1 : -1) : 0; }
    var s0 = 0;
    while (s0 < n && kind(s0) === kind((s0 - 1 + n) % n)) s0++;
    if (s0 === n) return [{ kind: kind(0), i0: 0, n: n }];
    var out = [], cur = null;
    for (var k = 0; k < n; k++) {
      var i = (s0 + k) % n, kd = kind(i);
      if (!cur || cur.kind !== kd) { cur = { kind: kd, i0: i, n: 0 }; out.push(cur); }
      cur.n++;
    }
    return out.map(function (sec) {
      var minR = Infinity;
      for (var k = 0; k < sec.n; k++) minR = Math.min(minR, 1 / Math.max(Math.abs(CRV[(sec.i0 + k) % n]), 1e-6));
      return { kind: sec.kind, s0: sec.i0 * ds, len: sec.n * ds, minR: minR };
    });
  }

  function layoutTrack(L) {
    var poly = filletPath(L.pts);
    if (!poly) throw new Error('CarRaceSim: Layout ' + L.name + ' – Eckradien passen nicht');
    var M = poly.length, cum = [0], i, k;
    for (i = 1; i <= M; i++) {
      var a = poly[i - 1], b = poly[i % M];
      cum.push(cum[i - 1] + Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])));
    }
    var len = cum[M], n = Math.round(len), ds = len / n, X = new Float64Array(n), Z = new Float64Array(n), j = 0;
    for (i = 0; i < n; i++) {               // gleichmäßig nach Bogenlänge neu abtasten (≈ 1 m)
      var want = i * ds;
      while (cum[j + 1] < want) j++;
      var f = (want - cum[j]) / (cum[j + 1] - cum[j] || 1), q0 = poly[j], q1 = poly[(j + 1) % M];
      X[i] = q0[0] + (q1[0] - q0[0]) * f;
      Z[i] = q0[1] + (q1[1] - q0[1]) * f;
    }
    var YAW = new Float64Array(n), CRV = new Float64Array(n), raw = new Float64Array(n);
    for (i = 0; i < n; i++) {
      var dx = X[(i + 1) % n] - X[(i - 1 + n) % n], dz = Z[(i + 1) % n] - Z[(i - 1 + n) % n];
      YAW[i] = Math.atan2(-dz, dx);
    }
    for (i = 0; i < n; i++) raw[i] = wrapAngle(YAW[(i + 1) % n] - YAW[(i - 1 + n) % n]) / (2 * ds);
    for (i = 0; i < n; i++) {             // glätten (±2 m): weiche Übergänge zwischen Gerade und Bogen
      var sum = 0;
      for (k = -2; k <= 2; k++) sum += raw[(i + k + n) % n];
      CRV[i] = sum / 5;
    }
    // Start/Ziel: Stelle mit der ruhigsten Strecke davor (dort steht die Startaufstellung)
    var bestI = 0, bestV = Infinity;
    for (i = 0; i < n; i++) {
      var v = 0;
      for (k = -45; k <= 10; k++) v += Math.abs(CRV[(i + k + n) % n]);
      if (v < bestV - 1e-9) { bestV = v; bestI = i; }
    }
    function rot(A) { var B = new Float64Array(n); for (var r = 0; r < n; r++) B[r] = A[(r + bestI) % n]; return B; }
    X = rot(X); Z = rot(Z); YAW = rot(YAW); CRV = rot(CRV);
    return { X: X, Z: Z, YAW: YAW, CRV: CRV, n: n, ds: ds, len: len };
  }

  // Auslauf je Rasterpunkt und Seite: bis RUNOFF_MAX, aber nie über die Mitte zu einem anderen
  // Streckenteil hinaus und auf der Kurveninnenseite höchstens bis kurz vor den Kurvenmittelpunkt.
  function runoffs(raw, half) {
    var n = raw.n, ds = raw.ds, out = { left: new Float64Array(n), right: new Float64Array(n) }, i, j, k;
    var NX = new Float64Array(n), NZ = new Float64Array(n);
    for (i = 0; i < n; i++) { NX[i] = -Math.sin(raw.YAW[i]); NZ[i] = -Math.cos(raw.YAW[i]); }
    [1, -1].forEach(function (sd) {
      var A = sd > 0 ? out.left : out.right, tmp = new Float64Array(n);
      for (i = 0; i < n; i++) {
        var r = 0;
        for (var rr = 0.5; rr <= RUNOFF_MAX + 1e-9; rr += 0.5) {
          var qx = raw.X[i] + NX[i] * sd * (half + rr), qz = raw.Z[i] + NZ[i] * sd * (half + rr), ok = true;
          for (j = 0; j < n && ok; j++) {
            var along = Math.min(Math.abs(j - i), n - Math.abs(j - i)) * ds;
            if (along < 12) continue;
            var ex = qx - raw.X[j], ez = qz - raw.Z[j];
            if (ex * ex + ez * ez < (half + rr) * (half + rr)) ok = false;
          }
          if (!ok) break;
          r = rr;
        }
        // Innenseite einer Kurve: Platz bis kurz vor den Mittelpunkt (engster Radius ±15 m)
        var minR = Infinity;
        for (k = -15; k <= 15; k++) {
          var c = raw.CRV[(i + k + n) % n];
          if (c * sd > 0) minR = Math.min(minR, 1 / Math.abs(c));
        }
        tmp[i] = Math.min(r, Math.max(0, minR - half - 2));
      }
      for (i = 0; i < n; i++) {           // Minimum über ±4 m, dann glätten: keine Zacken im Auslauf
        var m = Infinity;
        for (k = -4; k <= 4; k++) m = Math.min(m, tmp[(i + k + n) % n]);
        A[i] = m;
      }
      var B = new Float64Array(n);
      for (i = 0; i < n; i++) {
        var s = 0;
        for (k = -3; k <= 3; k++) s += A[(i + k + n) % n];
        B[i] = Math.min(A[i], s / 7);
      }
      for (i = 0; i < n; i++) A[i] = B[i];
    });
    return out;
  }

  var trackCache = {};
  // seed wählt das Layout: LAYOUTS[(seed − 1) mod 3] (TRACKS = [1, 2, 3]); die Wellen kommen aus dem Seed
  function track(seed) {
    seed = seed | 0;
    if (trackCache[seed]) return trackCache[seed];
    var lay = LAYOUTS[mod(seed - 1, LAYOUTS.length)];
    var raw = layoutTrack(lay), n = raw.n, ds = raw.ds, L = raw.len, rnd = rng(seed), i, k;
    // Wellen: 2–3 Abschnitte mit weichen Rändern
    var BUMP = new Float64Array(n), nb = 2 + Math.floor(rnd() * 2);
    for (k = 0; k < nb; k++) {
      var c0 = rnd() * n, half = (10 + rnd() * 15) / ds;
      for (i = 0; i < n; i++) {
        var dist = Math.abs(mod(i - c0 + n / 2, n) - n / 2);
        if (dist < half) BUMP[i] = Math.max(BUMP[i], Math.min(1, (half - dist) / 6));
      }
    }
    raw.BUMP = BUMP;
    var run = runoffs(raw, WIDTH / 2);
    raw.RUNL = run.left; raw.RUNR = run.right;
    var pts = [];
    for (i = 0; i < n; i++) pts.push([raw.X[i], raw.Z[i]]);
    function lerpA(A, i0, i1, f) { return A[i0] + (A[i1] - A[i0]) * f; }
    function at(s) {
      var u = mod(s, L) / ds, i0 = Math.floor(u) % n, i1 = (i0 + 1) % n, f = u - Math.floor(u);
      var yaw = raw.YAW[i0] + wrapAngle(raw.YAW[i1] - raw.YAW[i0]) * f;
      return {
        x: lerpA(raw.X, i0, i1, f), z: lerpA(raw.Z, i0, i1, f), yaw: wrapAngle(yaw), curv: lerpA(raw.CRV, i0, i1, f),
        nx: -Math.sin(yaw), nz: -Math.cos(yaw), bump: lerpA(raw.BUMP, i0, i1, f),
        runL: Math.min(raw.RUNL[i0], raw.RUNL[i1]), runR: Math.min(raw.RUNR[i0], raw.RUNR[i1])
      };
    }
    function radiusAt(s) { return 1 / Math.max(Math.abs(at(s).curv), 1e-4); }
    function runoffAt(s) { var a = at(s); return { left: a.runL, right: a.runR }; }
    // Kurven und Geraden; Hauptdrehrichtung = Vorzeichen der Gesamtdrehung
    var secs = sections(raw.CRV, n, ds), turn = 0;
    for (i = 0; i < n; i++) turn += raw.CRV[i] * ds;
    var dir = turn > 0 ? 1 : -1, corners = [], straight = 0;
    secs.forEach(function (sc) {
      if (sc.kind === 0) straight = Math.max(straight, sc.len);
      else corners.push({ s0: sc.s0, len: sc.len, dir: sc.kind, minR: sc.minR, counter: sc.kind !== dir });
    });
    var t = {
      seed: seed, name: lay.name, character: lay.character, pts: pts, len: L, width: WIDTH,
      at: at, radiusAt: radiusAt, runoffAt: runoffAt,
      runoff: { left: Array.prototype.slice.call(run.left), right: Array.prototype.slice.call(run.right), max: RUNOFF_MAX },
      corners: corners, longestStraight: straight, turnDir: dir, _raw: raw
    };
    trackCache[seed] = t;
    return t;
  }
  // ---- Werte je Auto (Verhältnis-Werte 1–10 → Simulationsgrößen) ----
  function val(x, def) { x = Number(x); return isFinite(x) ? clamp(x, 1, 10) : def; }
  // Wertpunkte relativ zu 5, gekrümmt: unten flach, oben steil (STAT_EXP = 1 wäre linear = v − 5).
  // So setzt sich ein starkes Auto deutlich ab, während schwache Autos untereinander näher liegen.
  function pts(v) { return 9 * (Math.pow((v - 1) / 9, STAT_EXP) - Math.pow(4 / 9, STAT_EXP)); }
  function stats(raw) {
    raw = raw || {};
    var p = val(raw.power, 5), sp = val(raw.speed, 5), h = val(raw.handling, 5), su = val(raw.susp, 5),
      b = val(raw.brakes, 5), w = val(raw.weight, 5);
    var len = Number(raw.len); if (!(len > 0)) len = 4.5;
    // speed 10 = 1,6 × speed 1, speed 5 = VTOP_BASE (dazwischen gekrümmt wie die übrigen Werte)
    var c5 = Math.pow(4 / 9, STAT_EXP), sa = 1 / (1 + 0.6 * c5);
    var vtop = VTOP_BASE * sa * (1 + 0.6 * Math.pow((sp - 1) / 9, STAT_EXP));
    var ew = pts(11 - w) - pts(6);                // Gewicht umgekehrt: leicht = gut
    return {
      acc: ACC_BASE * (1 + K_POWER * pts(p)) * (1 + K_WEIGHT_ACC * ew),
      vmax: vtop * SLIP_BONUS,
      grip: GRIP_BASE * (1 + K_HANDLING * pts(h)) * (1 + K_SUSP * pts(su)) * (1 + K_WEIGHT_GRIP * ew),
      brake: BRAKE_BASE * (1 + K_BRAKES * pts(b)) * (1 + K_WEIGHT_BRAKE * ew),
      susp: su / 10,
      launch: LAUNCH[raw.drive] || 1,
      len: len,
      mass: len * (0.55 + 0.09 * w)               // Masse für Kontakte (Bus 12 m/weight 10 ≈ 17, Kleinwagen ≈ 4)
    };
  }

  // ---- Rennen ----
  function create(opts) {
    var T = typeof opts.track === 'object' && opts.track ? opts.track : track(opts.track | 0);
    var raw = T._raw, n = raw.n, ds = raw.ds, L = T.len, HALF = T.width / 2;
    var laps = opts.laps || 3, finishWindow = opts.finishWindow == null ? 15 : opts.finishWindow;
    var rnd = rng(opts.seed | 0);
    var cars = [], P = [];
    var steps = 0, finCount = 0, deadline = Infinity;
    var events = [], hazards = [], pendingOil = null, lastContact = {};

    // Startaufstellung: 2 nebeneinander, Pole (Index 0) vorn links, Reihenabstand nach Autolänge
    var rowS = [], prevLen = 0, sRow = 0;
    for (var r = 0; r * 2 < opts.cars.length; r++) {
      var ml = 0;
      for (var q = r * 2; q < Math.min(opts.cars.length, r * 2 + 2); q++) ml = Math.max(ml, opts.cars[q].stats.len);
      sRow = r === 0 ? -(1 + ml / 2) : sRow - (prevLen / 2 + ml / 2 + 2.5);
      rowS.push(sRow); prevLen = ml;
    }

    opts.cars.forEach(function (c, i) {
      var st = c.stats, w = clamp(st.len * 0.42, 1.7, 2.6);
      var lim = HALF - w / 2 - 0.1;
      // Geschwindigkeitsprofil: Kurvengrenze aus Grip und Radius, Wellen kosten je nach Federung,
      // dann rückwärts Bremszonen einrechnen
      var prof = new Float64Array(n), k;
      for (k = 0; k < n; k++) {
        var R = 1 / Math.max(Math.abs(raw.CRV[k]), 1e-4);
        prof[k] = Math.min(st.vmax, Math.sqrt(st.grip * R)) * (1 - 0.06 * raw.BUMP[k] * (1.1 - st.susp));
      }
      for (var pass = 0; pass < 2; pass++) {
        for (k = n - 1; k >= 0; k--) {
          var nx = prof[(k + 1) % n];
          prof[k] = Math.min(prof[k], Math.sqrt(nx * nx + 2 * st.brake * ds));
        }
      }
      var bad = rnd() < 0.06;                       // verpatzter Start
      var form = 1 + (rnd() - 0.5) * FORM_SPREAD;   // Tagesform des Fahrers
      P.push({
        st: st, w: w, lim: lim, prof: prof, mass: st.mass || st.len,
        react: 0.12 + rnd() * 0.3 + (bad ? 0.5 + rnd() * 0.5 : 0),
        luck: 0.88 + rnd() * 0.24,                  // Startglück: Traktion beim Losfahren
        lineOff: (rnd() - 0.5) * 1.6,               // eigene Linie
        form: form,
        push: form * (0.985 + rnd() * 0.03),        // wie nah am Limit (pro Runde neu)
        pushLap: 0,
        dT: (i % 2 === 0 ? 1 : -1) * 2.3,
        stuck: 0, ghostT: 0, timer: 0, dur: 0, yawOff: 0, yawTo: 0, slowT: 0, slowV: 0, parked: false,
        dDot: 0, latAng: 0, accel: 0, rollV: 0, pitchV: 0, wheelR: clamp(0.07 * st.len, 0.3, 0.55),
        // Abflug / Schubs / Öl
        offTo: null, offLat: 0, pushV: 0, atRail: false, oilT: 0, oilS: -1e9, avoidKey: -1, avoidOk: false
      });
      cars.push({
        id: c.id, s: rowS[i >> 1], d: (i % 2 === 0 ? 1 : -1) * 2.3, v: 0, lap: 0, pos: i + 1,
        yaw: T.at(rowS[i >> 1]).yaw, roll: 0, pitch: 0, steer: 0, spin: 0, state: 'run', place: null, finish: null,
        draft: null, off: false
      });
    });
    var order = cars.map(function (c, i) { return i; });   // aktuelle Reihenfolge (Indizes), mit Hysterese

    // Zufalls-Ölfleck (nach den Autos gewürfelt): vor oder in einer Kurve, nie in der Startaufstellung;
    // liegt ab Start oder erscheint, sobald der Führende Runde 2 beginnt
    if (rnd() < OIL_CHANCE && T.corners && T.corners.length) {
      var cn = T.corners[Math.floor(rnd() * T.corners.length)];
      var hs = clamp(mod(cn.s0 - 12 + rnd() * (12 + cn.len * 0.6), L), 10, L - 45);
      var hz = { s: hs, d: (rnd() - 0.5) * 2 * (HALF - 2.5), r: 1.5 + rnd(), from: 0, src: 'track' };
      if (rnd() < 0.5) hazards.push(hz); else pendingOil = hz;
    }

    var counts = { spins: 0, crashes: 0, crashDnf: 0, slides: 0, offs: 0, rails: 0, pushes: 0, oilHits: 0 };

    function idxAt(s) { var u = mod(s, L) / ds; return { i0: Math.floor(u) % n, f: u - Math.floor(u) }; }
    function profAt(p, s) {
      var u = mod(s, L) / ds, i0 = Math.floor(u) % n, f = u - Math.floor(u);
      return p.prof[i0] + (p.prof[(i0 + 1) % n] - p.prof[i0]) * f;
    }
    function crvAt(s) {
      var u = mod(s, L) / ds, i0 = Math.floor(u) % n, f = u - Math.floor(u);
      return raw.CRV[i0] + (raw.CRV[(i0 + 1) % n] - raw.CRV[i0]) * f;
    }
    function bumpAt(s) {
      var u = mod(s, L) / ds, i0 = Math.floor(u) % n;
      return raw.BUMP[i0];
    }
    // Auslauf (m) an Stelle s; side > 0 = links
    function runAt(s, side) {
      var x = idxAt(s), A = side > 0 ? raw.RUNL : raw.RUNR;
      return Math.min(A[x.i0], A[(x.i0 + 1) % n]);
    }
    // Leitplanke: größter Seitenversatz der Wagenmitte je Seite
    function railLim(i, side) { return HALF + runAt(cars[i].s, side) - P[i].w / 2 - 0.1; }
    // Darf das Auto die Fahrbahn verlassen (Abflug, Schubs, schon draußen)?
    function freeLat(i) {
      var p = P[i];
      return p.offTo !== null || p.pushV !== 0 || p.atRail || Math.abs(cars[i].d) > p.lim + 1e-9;
    }
    function emit(type, i, j, extra) {
      var e = { t: Math.round(steps * DT * 1000) / 1000, type: type, id: cars[i].id };
      if (j !== null && j !== undefined) e.other = cars[j].id;
      if (extra) for (var k in extra) e[k] = extra[k];
      events.push(e);
    }
    function addOil(s, d, src) {
      if (hazards.length + (pendingOil ? 1 : 0) >= OIL_MAX) return;
      hazards.push({ s: mod(s, L), d: clamp(d, -(HALF - 1.2), HALF - 1.2), r: 1.5 + rnd(), from: Math.round(steps * DT * 1000) / 1000, src: src });
    }
    // Längsabstand b vor a entlang der Strecke (−L/2 … L/2)
    function gap(a, b) { return mod(b.s - a.s + L / 2, L) - L / 2; }
    function minGap(i, j) { return (P[i].st.len + P[j].st.len) / 2 + 0.4; }
    function latOverlap(i, j, di) {
      if ((P[i].ghostT > 0 && isWreck(j)) || (P[j].ghostT > 0 && isWreck(i))) return false;
      return Math.abs(di - cars[j].d) < (P[i].w + P[j].w) / 2 + 0.25;
    }
    // Berührt Auto i gerade ein anderes (ohne Ausnahme für Wracks)?
    function touching(i) {
      for (var j = 0; j < cars.length; j++) {
        if (j === i) continue;
        if (Math.abs(gap(cars[i], cars[j])) < minGap(i, j) - 0.05 &&
            Math.abs(cars[i].d - cars[j].d) < (P[i].w + P[j].w) / 2 + 0.25) return true;
      }
      return false;
    }
    // Wrack = steht nach Dreher/Crash (oder ausgeschieden) still
    function isWreck(j) {
      var c = cars[j];
      return c.v < 1 && (c.state === 'crash' || c.state === 'spin' || P[j].parked);
    }
    // Ist die Spur bei Seitenversatz dd für Auto i frei? Zählt nur, wer daneben oder bis `extra` Meter
    // davor fährt – Autos dahinter passen sich an (sonst warten sich mehrere Autos gegenseitig fest)
    function laneFree(i, dd, extra) {
      for (var j = 0; j < cars.length; j++) {
        if (j === i) continue;
        var g = gap(cars[i], cars[j]), mg = minGap(i, j);
        if (g > -mg + 0.05 && g < mg + extra && latOverlap(i, j, dd)) return false;
      }
      return true;
    }
    // Seitlicher Schritt nur, wenn er keine neue Überlappung mit einem Auto daneben erzeugt;
    // liefert die blockierenden Autos (leer = frei)
    function blockers(i, nd) {
      var out = [];
      for (var j = 0; j < cars.length; j++) {
        if (j === i) continue;
        var g = gap(cars[i], cars[j]);
        if (Math.abs(g) >= minGap(i, j) - 0.05) continue;   // Toleranz: direkt dahinter zählt nicht als daneben
        if (latOverlap(i, j, nd) && Math.abs(nd - cars[j].d) < Math.abs(cars[i].d - cars[j].d)) out.push(j);
      }
      return out;
    }

    function startEvent(i, c, p, kind) {
      var crv = crvAt(c.s), out = crv > 0 ? -1 : 1;           // nach außen = weg vom Kurveninneren
      if (kind === 'off' && runAt(c.s, out) < 3) kind = 'slide';   // kein Auslauf: nur Verbremser
      if (kind === 'slide') {                                  // Verbremser: zu spät gebremst, weit raus
        counts.slides++;
        p.slowT = 0.9; p.slowV = c.v * 0.55;
        p.dT = clamp(c.d + out * 2.5, -p.lim, p.lim);
      } else if (kind === 'off') {                             // Abflug: rutscht nach außen ins Gras/Kiesbett
        var depth = (0.8 + 5 * rnd() * rnd() + 9 * Math.pow(rnd(), 3)) * clamp(c.v / 14, 0.6, 1.5);   // selten bis zur Leitplanke
        p.offTo = out * (HALF + depth);
        p.offLat = Math.max(3, 0.55 * c.v);                    // seitliches Rutschtempo
        p.slowT = 0;
      } else if (kind === 'spin') {                            // Dreher 1–2 s
        counts.spins++;
        c.state = 'spin'; p.timer = 0; p.dur = 1 + clamp((c.v - 8) / 14 + (rnd() - 0.5) * 0.3, 0, 1); p.yawTo = (rnd() < 0.5 ? -1 : 1) * TWO_PI;
        p.dT = clamp(c.d + out * 2, -p.lim, p.lim);
        emit('spin', i);
      } else {                                                 // Crash 3–6 s, selten DNF
        counts.crashes++;
        c.state = 'crash'; p.timer = 0; p.dur = 3 + 3 * clamp((c.v - 8) / 14 + (rnd() - 0.5) * 0.3, 0, 1); p.yawTo = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.7);
        p.dT = out * p.lim;
        emit('crash', i);
        if (rnd() < DNF_CHANCE * clamp(c.v / 16, 0.3, 1.6)) {
          p.parked = true; counts.crashDnf++; c.state = 'dnf';
          emit('dnf', i, null, { reason: 'crash' });
        }
        if (rnd() < OIL_CRASH) addOil(c.s, c.d, c.id);
      }
    }
    // Einschlag in die Leitplanke am Rand der Auslaufzone: Rennen vorbei
    function railCrash(i) {
      var c = cars[i], p = P[i], sd = c.d > 0 ? 1 : -1;
      counts.crashes++; counts.rails++;
      c.state = 'dnf'; p.parked = true; p.atRail = true; p.offTo = null; p.pushV = 0; p.slowT = 0;
      p.timer = 0; p.dur = 3; p.yawTo = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.7); p.dT = c.d;
      emit('crash', i, null, { rail: true });
      emit('dnf', i, null, { reason: 'rail' });
      if (rnd() < OIL_CRASH) addOil(c.s, sd * (HALF - 1.2), c.id);
    }
    // Kontakt: der Schwerere schubst den Leichteren zur Seite und bremst ihn (Masse aus Gewicht und Länge)
    function contact(i, j, closing, kind) {
      var key = Math.min(i, j) * 64 + Math.max(i, j), time = steps * DT;
      if (lastContact[key] !== undefined && time - lastContact[key] < (kind === 'side' ? 2.5 : 0.8)) return;
      lastContact[key] = time;
      counts.pushes++;
      var mi = P[i].mass, mj = P[j].mass, fi = mj / (mi + mj), fj = mi / (mi + mj);
      var dir = cars[j].d - cars[i].d;
      dir = Math.abs(dir) > 0.15 ? (dir > 0 ? 1 : -1) : (rnd() < 0.5 ? -1 : 1);   // j weg von i
      var res = [[i, fi, -dir], [j, fj, dir]].map(function (e) {
        var k = e[0], f = e[1], c = cars[k], p = P[k];
        var shove = Math.min(9, PUSH_K * closing * f * 2), loss = Math.min(c.v, closing * f * 0.7);
        p.pushV = clamp(p.pushV + e[2] * shove, -9, 9);
        c.v -= loss;
        // Dreher-Chance: klein, für das leichtere Auto größer (Bus räumt ab, umgekehrt kaum)
        if (c.state === 'run' && !c.off && c.place === null && f > 0.55 && rnd() < clamp(closing * 0.15 * (f - 0.5), 0, 0.3)) startEvent(k, c, p, 'spin');
        return { shove: Math.round(shove * 100) / 100, loss: Math.round(loss * 100) / 100 };
      });
      var light = fj >= fi ? 1 : 0, lk = light ? j : i, hk = light ? i : j;
      emit('push', lk, hk, { kind: kind, push: res[light].shove, loss: res[light].loss, pushOther: res[1 - light].shove, lossOther: res[1 - light].loss });
      if (kind === 'rear' && closing >= HARD_PUSH && rnd() < OIL_CRASH) addOil(cars[lk].s, cars[lk].d, cars[lk].id);
    }

    function finishCheck(c, p, sim) {
      if (c.place === null && !p.parked && !sim.done && c.s >= laps * L) {
        c.place = ++finCount; c.finish = steps * DT;
        if (finCount === 1) deadline = c.finish + finishWindow;
      }
    }
    // Reihenfolge mit Hysterese: im Ziel nach Platz, Ausgeschiedene hinten, sonst nach s – ein Auto zieht
    // erst vorbei, wenn es HYST Meter vorn liegt (kein Flackern beim Nebeneinanderfahren)
    function rankCat(i) { return cars[i].place !== null ? 0 : P[i].parked ? 2 : 1; }
    function passes(a, b) {          // gehört a (dahinter) vor b?
      var ka = rankCat(a), kb = rankCat(b);
      if (ka !== kb) return ka < kb;
      if (ka === 0) return cars[a].place < cars[b].place;
      return cars[a].s > cars[b].s + HYST;
    }

    var sim = {
      DT: DT, track: T, cars: cars, time: 0, done: false, laps: laps, counts: counts,
      events: events, hazards: hazards,
      step: function () {
        steps++;
        var time = steps * DT, i, j, c, p, h, hz;
        var wasDone = sim.done;
        if (pendingOil) {              // Zufallsfleck ab Runde 2
          for (i = 0; i < cars.length; i++) if (cars[i].lap >= 2) break;
          if (i < cars.length) { pendingOil.from = Math.round(time * 1000) / 1000; hazards.push(pendingOil); pendingOil = null; }
        }
        // 1) Tempo, Ereignisse, Seitenziel
        for (i = 0; i < cars.length; i++) {
          c = cars[i]; p = P[i];
          var v0 = c.v;
          if (p.oilT > 0) p.oilT -= DT;
          c.draft = null;
          if (c.state === 'spin' || c.state === 'crash' || (c.state === 'dnf' && p.parked)) {
            p.timer += DT;
            c.v = Math.max(0, c.v - (c.state === 'spin' ? 14 : 18) * DT);
            var k = Math.min(1, p.timer / Math.min(p.dur, c.state === 'spin' ? p.dur : 0.6));
            var ease = 1 - (1 - k) * (1 - k);
            if (c.state === 'spin') p.yawOff = p.yawTo * ease;
            else {
              p.yawOff = p.yawTo * ease;
              if (c.state === 'crash' && p.timer > p.dur - 0.6) p.yawOff = p.yawTo * Math.max(0, (p.dur - p.timer) / 0.6);
            }
            if (c.state === 'crash' && p.parked) c.state = 'dnf';
            // erst weiterfahren, wenn sich niemand mehr am Wrack vorbeischiebt (sonst Ruck beim Auflösen)
            if (p.timer >= p.dur && c.state !== 'dnf' && touching(i)) p.timer = p.dur;
            else if (p.timer >= p.dur && c.state !== 'dnf') {
              c.state = c.place !== null ? 'done' : sim.done ? 'dnf' : 'run'; p.yawOff = 0;
            }
          } else if (c.state === 'run' || c.state === 'done' || c.state === 'dnf') {
            if (time < p.react) { c.v = 0; }
            else if (p.offTo !== null) {
              // Abflug: rutscht weiter nach außen, auf Asphalt etwas, im Kies stark gebremst
              c.v = Math.max(0, c.v - (c.off ? GRAVEL_DECEL : SLIDE_DECEL) * DT);
              p.dT = p.offTo;
              if (Math.abs(c.d - p.offTo) < 0.05 || c.v < 1) p.offTo = null;
            } else {
              // Notausgang gegen Verkeilen: wer 1,5 s hinter einem Wrack festsitzt, darf sich 2,5 s lang
              // daran vorbeischieben (Wracks blockieren ihn dann nicht mehr)
              p.stuck = c.v < 0.3 ? p.stuck + DT : 0;
              if (p.stuck > 1.5) { p.stuck = 0; p.ghostT = 2.5; }
              if (p.ghostT > 0 && !touching(i)) p.ghostT -= DT;
              var cruise = c.state !== 'run' || sim.done;      // im Ziel / nach Rennende: locker weiter
              var outside = Math.abs(c.d) > p.lim + 1e-9;      // neben der Fahrbahn: zurück auf die Strecke
              // Auto vorn (gleiche Spur) für Windschatten und Folgen
              var ahead = -1, ag = Infinity, slipJ = -1, sg = Infinity;
              for (j = 0; j < cars.length; j++) {
                if (j === i) continue;
                var g = gap(c, cars[j]);
                if (g <= 0) continue;
                if (g < SLIP_RANGE && g < sg && Math.abs(cars[j].d - c.d) < 2.5 && cars[j].v > 3 && !cars[j].off) { sg = g; slipJ = j; }
                if (g < ag && latOverlap(i, j, c.d)) { ag = g; ahead = j; }
              }
              var slip = slipJ >= 0 && !c.off;
              if (slip && c.state === 'run' && !sim.done) c.draft = cars[slipJ].id;
              var vtop = p.st.vmax / (slip ? 1 : SLIP_BONUS);
              // Ideallinie: vor Kurven nach innen; wer daneben fährt, ist in Kurven langsamer (Überholen kostet)
              var line = clamp(crvAt(c.s + 10) * 50, -2.5, 2.5) + p.lineOff;
              var offLine = 1 - OFF_LINE * Math.max(0, Math.abs(c.d - line) - 0.5);
              var target = Math.min(profAt(p, c.s) * (cruise ? 0.75 : p.push * offLine), vtop);
              if (p.slowT > 0) { p.slowT -= DT; target = Math.min(target, p.slowV); }
              if (c.off) target = Math.min(target, GRAVEL_V);
              if (ahead >= 0) {                                  // nicht auffahren
                var free = ag - minGap(i, ahead);
                target = Math.min(target, Math.max(0, cars[ahead].v + Math.max(0, free - 0.5) * 2));
              }
              if (c.v < target) {
                var a = p.st.acc * (1 - Math.pow(c.v / vtop, DRAG_EXP));
                if (c.v < 8 && c.lap <= 1) a *= p.st.launch * p.luck;   // Antrieb + Startglück beim Losfahren
                if (c.off) a *= 0.5;                                   // im Kies dreht das Rad durch
                c.v = Math.min(target, c.v + Math.max(a, 0.3) * DT);
              } else {
                c.v = Math.max(target, c.v - (c.off ? GRAVEL_DECEL : p.st.brake * 1.3) * DT);
              }
              c.v = clamp(c.v, 0, p.st.vmax);
              // Öl: Grip bricht für OIL_TIME s ein
              for (h = 0; h < hazards.length; h++) {
                hz = hazards[h];
                if (hz.src === c.id || c.v < 3) continue;
                var hg = gap(c, hz);
                if (Math.abs(hg) < hz.r + p.st.len * 0.3 && Math.abs(c.d - hz.d) < hz.r * 0.8 + p.w * 0.25 && c.s - p.oilS > 2 * hz.r + 6) {
                  p.oilS = c.s; p.oilT = OIL_TIME;
                  if (!sim.done) { counts.oilHits++; emit('oil', i); }
                  if (c.state === 'run' && !cruise && c.v > 5) {
                    var demand = c.v * c.v * Math.abs(crvAt(c.s + 3)) / (p.st.grip * OIL_GRIP);
                    if (rnd() < clamp(0.15 + 0.6 * demand, 0, 0.9)) {
                      var uo = rnd();
                      startEvent(i, c, p, uo < 0.3 ? 'spin' : uo < 0.6 && demand > 0.4 ? 'off' : 'slide');
                    }
                  }
                }
              }
              // Pech: Risiko steigt mit Tempo über der Kurvengrenze (auf Öl mit viel weniger Grip)
              var R = Math.min(R_RISK, 1 / Math.max(Math.abs(crvAt(c.s)), 1e-4));
              if (!cruise && c.state === 'run' && c.v > 4 && p.offTo === null && !c.off) {
                var gripNow = p.st.grip * (p.oilT > 0 ? OIL_GRIP : 1);
                var ratio = c.v / Math.sqrt(G_REF * R), own = c.v / Math.sqrt(gripNow * R);
                var rate = RISK * Math.pow(ratio, RISK_EXP) * Math.exp((own - 1) * 12);
                if (rnd() < rate * DT) {
                  var u = rnd();
                  startEvent(i, c, p, u < EV_SLIDE ? 'slide' : u < EV_OFF ? 'off' : u < EV_SPIN ? 'spin' : 'crash');
                }
              }
              if (c.state !== 'run' && c.state !== 'done' && c.state !== 'dnf') { p.accel = (c.v - v0) / DT; continue; }
              if (p.offTo !== null) { p.accel = (c.v - v0) / DT; continue; }
              if (outside) {
                // zurück: zum nächsten Fahrbahnrand, eingefädelt wird nur in eine freie Lücke (Schritt 2)
                p.dT = (c.d > 0 ? 1 : -1) * (p.lim - 0.3);
              } else if (p.slowT <= 0) {               // auch im Ziel: Wracks umfahren
                // Überholen: langsameres Auto dicht vorn → Seite wechseln, wenn dort Platz ist
                if (ahead >= 0 && ag < minGap(i, ahead) + 4 + Math.max(0, c.v - cars[ahead].v) * 2.5 &&
                    (cars[ahead].v < c.v * 0.99 || cars[ahead].state !== 'run')) {
                  var off = (P[i].w + P[ahead].w) / 2 + 0.8, best = null;
                  [cars[ahead].d + off, cars[ahead].d - off, 0, p.lim * 0.5, -p.lim * 0.5].forEach(function (cand) {
                    cand = clamp(cand, -p.lim, p.lim);
                    if (Math.abs(cand - cars[ahead].d) < (P[i].w + P[ahead].w) / 2 + 0.3) return;
                    if (!laneFree(i, cand, 0.5 + c.v * 0.2)) return;
                    if (best === null || Math.abs(cand - c.d) < Math.abs(best - c.d)) best = cand;
                  });
                  if (best !== null) p.dT = best;
                } else if (time > 4 && laneFree(i, clamp(line, -p.lim, p.lim), 2)) {
                  p.dT = clamp(line, -p.lim, p.lim);
                }
                // Ölfleck voraus: ausweichen, wenn gesehen (nicht jeder sieht ihn) und Platz ist
                for (h = 0; h < hazards.length; h++) {
                  hz = hazards[h];
                  var ha = gap(c, hz), need = hz.r + p.w / 2 + 0.4;
                  if (hz.src === c.id || ha < -(hz.r + p.st.len * 0.5) || ha > 6 + c.v * 1.2 || Math.abs(p.dT - hz.d) >= need) continue;
                  var akey = h * 1000 + c.lap;
                  if (p.avoidKey !== akey) { p.avoidKey = akey; p.avoidOk = rnd() < OIL_SEE; }
                  if (!p.avoidOk) continue;
                  var alt = null, altSc = 0;
                  [hz.d + need + 0.2, hz.d - need - 0.2].forEach(function (cand) {
                    cand = clamp(cand, -p.lim, p.lim);
                    if (Math.abs(cand - hz.d) < need) return;
                    // freie Seite bevorzugt; ist keine frei, trotzdem hin (Schritt 2 lenkt nur in Lücken)
                    var sc = Math.abs(cand - c.d) + (laneFree(i, cand, 0.5) ? 0 : 100);
                    if (alt === null || sc < altSc) { alt = cand; altSc = sc; }
                  });
                  if (alt !== null) p.dT = alt;
                }
              }
            }
          }
          if (c.lap > p.pushLap) { p.pushLap = c.lap; p.push = p.form * (0.985 + rnd() * 0.03); }
          p.accel = (c.v - v0) / DT;
        }
        // 2) Seitlich bewegen (nur in freie Spur, Schwere drängen) und vorwärts
        for (i = 0; i < cars.length; i++) {
          c = cars[i]; p = P[i];
          var lo = -p.lim, hi = p.lim, railHi = railLim(i, 1), railLo = -railLim(i, -1), canLeave = freeLat(i);
          if (canLeave) { hi = Math.max(hi, railHi); lo = Math.min(lo, railLo); }
          var latMax = (p.offTo !== null ? p.offLat : 2 + 0.15 * c.v) * DT;
          var steerDd = clamp(clamp(p.dT, lo, hi) - c.d, -latMax, latMax);
          var dd = steerDd + p.pushV * DT;
          // Schub klingt ab (im Kies schneller)
          if (p.pushV !== 0) {
            var fr = PUSH_FRIC * (c.off ? 1.6 : 1) * DT;
            p.pushV = Math.abs(p.pushV) <= fr ? 0 : p.pushV - (p.pushV > 0 ? fr : -fr);
          }
          var nd = c.d + dd;
          if (dd !== 0) {
            var bl = blockers(i, nd);
            if (bl.length) {
              var heavy = c.state === 'run' && !c.off && p.pushV === 0 && bl.every(function (j2) {
                return p.mass >= HEAVY * P[j2].mass && cars[j2].state !== 'dnf';
              });
              // deutlich schwerer (Bus gegen Kleinwagen): drängt einfach rein und schubst den anderen weg
              // (selbst bleibt es diesen Schritt stehen – keine Überlappung)
              if (heavy) bl.forEach(function (j2) { contact(i, j2, 1.5 + 0.5 * Math.abs(steerDd) / DT, 'side'); });
              nd = c.d;
              if (!heavy) {
                p.pushV = 0;
                // Wrack, das nicht an den Rand rutschen kann (Auto daneben): an den anderen Rand
                if ((c.state === 'crash' || p.parked) && c.v < 2 && Math.abs(p.dT) >= p.lim - 1e-9) p.dT = -p.dT;
              }
            }
          }
          // Leitplanke: wer mit Schwung hineinrutscht, ist raus
          if (nd >= railHi || nd <= railLo) {
            var hard = (p.offTo !== null || Math.abs(p.pushV) > 1.5) && c.v > RAIL_V && c.state === 'run' && !sim.done;
            nd = clamp(nd, railLo, railHi);
            if (hard) railCrash(i);
            else { p.offTo = null; p.pushV = 0; }
          }
          p.dDot = (nd - c.d) / DT;
          c.d = clamp(nd, Math.min(lo, c.d), Math.max(hi, c.d));
          c.s += c.v * DT;
        }
        // 3) Keine Durchdringung: hinteres Auto zurücksetzen und bremsen; Auffahren mit Schwung = Kontakt
        for (var it = 0; it < 2; it++) {
          for (i = 0; i < cars.length; i++) {
            for (j = 0; j < cars.length; j++) {
              if (i === j || !latOverlap(i, j, cars[i].d)) continue;
              var gg = gap(cars[i], cars[j]), mg = minGap(i, j);
              if (gg >= 0 && gg < mg) {          // j vor i, zu dicht
                var closing = cars[i].v - cars[j].v;
                if (it === 0 && closing > CONTACT_MIN && !sim.done && !isWreck(j)) contact(i, j, closing, 'rear');
                cars[i].s -= (mg - gg);
                if (cars[i].v > cars[j].v) cars[i].v = cars[j].v;
              }
            }
          }
        }
        // 4) Runden, Ziel, Darstellung
        for (i = 0; i < cars.length; i++) {
          c = cars[i]; p = P[i];
          // Runde nie zurückzählen (Auffahrschutz kann ein Auto knapp hinter die Linie zurücksetzen)
          c.lap = Math.max(c.lap, c.s < 0 ? 0 : Math.min(laps, Math.floor(c.s / L) + 1));
          finishCheck(c, p, sim);
          if (c.place !== null && c.state === 'run') c.state = 'done';
          // Abflug = Wagenmitte verlässt den Asphalt (egal ob gerutscht oder geschubst)
          var nowOff = Math.abs(c.d) > HALF;
          if (nowOff && !c.off && !sim.done) { counts.offs++; emit('off', i); }
          c.off = nowOff;
          var tp = T.at(c.s), crv = tp.curv;
          // Schräglage aus der Seitenbewegung, geglättet (sonst zuckt ein langsames Auto beim Spurwechsel)
          // (begrenzt auf ±0,7 rad und 0,12 rad je Schritt: Schubser und Abflüge drehen das Auto, ohne zu rucken)
          var latT = clamp(Math.atan2(p.dDot, Math.max(c.v, 4)), -0.7, 0.7);
          p.latAng += clamp((latT - p.latAng) * Math.min(1, DT * 10), -0.12, 0.12);
          var latAng = p.latAng;
          // stetig weiterzählen: kürzester Weg zum neuen Winkel, nie ein Sprung um 2π
          c.yaw += wrapAngle(tp.yaw + latAng + p.yawOff - c.yaw);
          var wb = c.state === 'spin' ? -p.yawOff * 0.15 : Math.atan(0.6 * p.st.len * crv) + latAng * 1.5;
          c.steer += (clamp(wb, -0.6, 0.6) - c.steer) * Math.min(1, DT * 8);
          c.spin = mod(c.spin + c.v * DT / p.wheelR, TWO_PI);
          var soft = 1.3 - p.st.susp, bump = bumpAt(c.s) + (c.off ? 0.6 : 0);   // im Kies holpert es
          var rollT = clamp(c.v * c.v * crv * 0.012 * soft, -0.12, 0.12);
          var pitchT = clamp(p.accel * 0.006 * soft, -0.08, 0.08) + Math.sin(c.s * 1.7) * bump * soft * 0.025 * Math.min(1, c.v / 8);
          p.rollV += ((rollT - c.roll) * 60 - p.rollV * 10) * DT;
          p.pitchV += ((pitchT - c.pitch) * 80 - p.pitchV * 11) * DT;
          c.roll += p.rollV * DT; c.pitch += p.pitchV * DT;
        }
        // 5) Ende
        if (!sim.done) {
          var open = 0;
          for (i = 0; i < cars.length; i++) if (cars[i].place === null && !P[i].parked) open++;
          if (open === 0 || time >= deadline - 1e-9 || time >= MAX_TIME - 1e-9) {
            sim.done = true;
            for (i = 0; i < cars.length; i++) {
              if (cars[i].place === null && !P[i].parked) emit('dnf', i, null, { reason: 'time' });
              if (cars[i].place === null && cars[i].state !== 'spin' && cars[i].state !== 'crash') cars[i].state = 'dnf';
            }
          }
        }
        // 6) Positionen (mit Hysterese) und Überholmanöver
        var prevRank = [];
        for (i = 0; i < order.length; i++) prevRank[order[i]] = i;
        var changed = true;
        while (changed) {
          changed = false;
          for (var o = 0; o + 1 < order.length; o++) {
            if (passes(order[o + 1], order[o])) { var tmp = order[o]; order[o] = order[o + 1]; order[o + 1] = tmp; changed = true; }
          }
        }
        for (i = 0; i < order.length; i++) cars[order[i]].pos = i + 1;
        if (!wasDone) {
          for (var ra = 0; ra < order.length; ra++) {          // a jetzt vor b, vorher dahinter
            for (var rb = ra + 1; rb < order.length; rb++) {
              var A = order[ra], B = order[rb];
              if (prevRank[A] > prevRank[B] && !P[A].parked && !P[B].parked) emit('overtake', A, B);
            }
          }
        }
        sim.time = time;
      },
      fastForward: function (t) {
        var target = Math.round(t / DT);
        while (steps < target) sim.step();
      },
      standings: function () {
        return order.map(function (i) { return cars[i].id; });
      },
      result: function () {
        return cars.map(function (c) { return { id: c.id, place: c.place }; });
      }
    };

    return sim;
  }


  return {
    DT: DT, WIDTH: WIDTH, MAX_TIME: MAX_TIME,
    // gute Strecken-Seeds: node scripts/check_car_race_sim.js --find 30 (Regeln + Siegerzeit 57–67 s)
    TRACKS: [1, 2, 3],
    LAYOUTS: LAYOUTS, rng: rng, track: track, stats: stats, create: create
  };
});
