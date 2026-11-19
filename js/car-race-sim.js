/* Car Race: Streckengenerator und deterministische Fahrsimulation (ohne DOM, ohne three.js).
 * Läuft im Browser (window.CarRaceSim) und in Node (module.exports). Prüfskript: scripts/check_car_race_sim.js
 *
 *   CarRaceSim.rng(seed) → () => Zahl in [0, 1)          mulberry32, einzige Zufallsquelle der Simulation
 *   CarRaceSim.track(seed) → { pts, len, width, at(s), radiusAt(s), start }
 *       geschlossene Catmull-Rom-Kurve, Runde 300–500 m, Radien ≥ 12 m, keine Überschneidung.
 *       pts = Mittellinie im 1-m-Raster [[x, z]…]; at(s) → { x, z, yaw, curv, nx, nz, bump }
 *       (s in Metern ab Start/Ziel, beliebig auch negativ/über len hinaus; yaw so, dass three.js
 *       rotation.y = yaw die Front +x in Fahrtrichtung dreht; curv > 0 = Linkskurve;
 *       (nx, nz) = Normale nach links, Position eines Autos = (x + nx·d, z + nz·d); bump 0..1 = Wellen).
 *   CarRaceSim.TRACKS                                     gute Strecken-Seeds (vom Prüfskript gefunden);
 *       der Server schickt eine Zufallszahl, der Client nimmt TRACKS[track % TRACKS.length].
 *   CarRaceSim.stats(raw) → { acc, vmax, grip, brake, susp, launch, len }
 *       raw = Verhältnis-Werte aus dem Car editor { power, speed, handling, susp, brakes, weight } je 1–10,
 *       drive 'fwd'|'rwd'|'awd', len (m). Keine echten km/h/PS: nur das Verhältnis zählt.
 *       vmax ist die absolute Grenze (mit Windschatten); frei fährt das Auto vmax / 1,04.
 *   CarRaceSim.create({ seed, track, laps, finishWindow, cars: [{ id, stats }] }) → sim
 *       track = Strecken-Seed (oder fertiges track()-Objekt). cars in Startreihenfolge (Index 0 = Pole).
 *       sim.step()            ein fester Schritt DT = 1/60 s
 *       sim.fastForward(t)    Schritte bis sim.time ≥ t (gleiches Ergebnis wie durchlaufen)
 *       sim.time, sim.done, sim.track, sim.counts = { spins, crashes, crashDnf, slides }
 *       sim.cars[i] = { id, s, d, v, lap, pos, yaw, roll, pitch, steer, spin, state, place, finish }
 *         s = gefahrene Meter ab Start/Ziel (Startaufstellung negativ), d = Seitenversatz (m, > 0 links),
 *         lap = 0 in der Aufstellung, dann 1..laps; pos = aktuelle Position (1 = vorn);
 *         yaw/roll/pitch in rad (roll > 0 = Aufbau neigt nach rechts, pitch > 0 = Nase hoch),
 *         steer = Lenkwinkel der Vorderräder (rad), spin = Raddrehwinkel (rad, 0..2π),
 *         state 'run'|'spin'|'crash'|'dnf'|'done', place = Zielplatz oder null, finish = Zielzeit (s) oder null.
 *       sim.standings() → [id…]  aktuelle Reihenfolge
 *       sim.result() → [{ id, place|null }] in Startreihenfolge (null = DNF)
 *       Ende: der erste im Ziel startet die Frist finishWindow; wer danach nicht im Ziel ist, ist DNF.
 *       Spätestens nach 90 s ist Schluss. Nach sim.done fahren die Autos zur Darstellung locker weiter,
 *       am Ergebnis ändert sich nichts mehr.
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
  var VTOP_BASE = 30.0;       // freie Endgeschwindigkeit (m/s) bei speed 5 – auf der kurvigen Bahn selten erreicht
  var ACC_BASE = 5.0;         // Beschleunigung (m/s²) bei power 5 / weight 5
  var GRIP_BASE = 6.5;        // Querbeschleunigung (m/s²) bei handling 5 / weight 5
  var BRAKE_BASE = 8.0;       // Verzögerung (m/s²) bei brakes 5 / weight 5
  var DRAG_EXP = 4;           // Beschleunigung fällt mit (v / vtop)^4 ab
  var LAUNCH = { awd: 1.15, rwd: 1.0, fwd: 0.93 };   // Traktion beim Losfahren je Antrieb
  var FORM_SPREAD = 0.09;     // Tagesform des Fahrers: ±4,5 % am Kurvenlimit
  var OFF_LINE = 0.03;        // Tempoverlust in Kurven je Meter neben der Ideallinie (Überholen kostet)
  // Pech: Rate je Sekunde = RISK · (v / √(G_REF·R))^RISK_EXP · e^(12·(v/eigene Grenze − 1)),
  // R höchstens R_RISK (Geraden zählen wie ein weiter Bogen: wer dort sehr schnell ist, riskiert auch etwas)
  var G_REF = GRIP_BASE;      // Bezugs-Kurvengrenze (m/s²)
  var RISK = 0.008;
  var RISK_EXP = 8;
  var R_RISK = 60;
  var DNF_CHANCE = 0.12;      // Anteil der Crashs, die das Rennen beenden
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
  // Ein Kandidat aus dem Zufallsstrom; null, wenn er die Regeln verletzt (dann neu würfeln)
  function tryTrack(rnd) {
    var N = 7 + Math.floor(rnd() * 5), C = [], i, k;
    for (i = 0; i < N; i++) {
      var ang = (i + (rnd() - 0.5) * 0.7) * TWO_PI / N;
      var rad = 0.45 + 0.55 * rnd();
      C.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
    }
    // geschlossene Catmull-Rom-Kurve fein abtasten
    var SUB = 40, poly = [];
    for (i = 0; i < N; i++) {
      var p0 = C[(i - 1 + N) % N], p1 = C[i], p2 = C[(i + 1) % N], p3 = C[(i + 2) % N];
      for (k = 0; k < SUB; k++) {
        var t = k / SUB, t2 = t * t, t3 = t2 * t;
        poly.push([
          0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
        ]);
      }
    }
    var M = poly.length, cum = [0];
    for (i = 1; i <= M; i++) {
      var a = poly[i - 1], b = poly[i % M];
      cum.push(cum[i - 1] + Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])));
    }
    var target = 300 + rnd() * 60;               // Rundenlänge (m)
    var scale = target / cum[M];
    // gleichmäßig nach Bogenlänge neu abtasten (≈ 1 m)
    var n = Math.round(target), ds = target / n, X = new Float64Array(n), Z = new Float64Array(n), j = 0;
    for (i = 0; i < n; i++) {
      var want = i * ds / scale;
      while (cum[j + 1] < want) j++;
      var f = (want - cum[j]) / (cum[j + 1] - cum[j] || 1);
      var q0 = poly[j], q1 = poly[(j + 1) % M];
      X[i] = (q0[0] + (q1[0] - q0[0]) * f) * scale;
      Z[i] = (q0[1] + (q1[1] - q0[1]) * f) * scale;
    }
    // Richtung und Krümmung
    var YAW = new Float64Array(n), CRV = new Float64Array(n), raw = new Float64Array(n);
    for (i = 0; i < n; i++) {
      var dx = X[(i + 1) % n] - X[(i - 1 + n) % n], dz = Z[(i + 1) % n] - Z[(i - 1 + n) % n];
      YAW[i] = Math.atan2(-dz, dx);
    }
    for (i = 0; i < n; i++) raw[i] = wrapAngle(YAW[(i + 1) % n] - YAW[(i - 1 + n) % n]) / (2 * ds);
    for (i = 0; i < n; i++) {             // glätten (±2 m), sonst rauscht die Krümmung
      var sum = 0;
      for (k = -2; k <= 2; k++) sum += raw[(i + k + n) % n];
      CRV[i] = sum / 5;
    }
    var minR = Infinity;
    for (i = 0; i < n; i++) minR = Math.min(minR, 1 / Math.max(Math.abs(CRV[i]), 1e-6));
    if (minR < 12.5) return null;
    // keine Überschneidung: entlang der Strecke weit entfernte Punkte brauchen räumlich ≥ 16 m Abstand
    for (i = 0; i < n; i += 2) {
      for (j = i + 2; j < n; j += 2) {
        var along = Math.min(j - i, n - (j - i)) * ds;
        if (along < 40) continue;
        var ex = X[i] - X[j], ez = Z[i] - Z[j];
        if (ex * ex + ez * ez < 16 * 16) return null;
      }
    }
    // Kurvigkeit: genug enge Kurven, damit es kein Oval wird
    var tight = 0;
    for (i = 0; i < n; i++) if (Math.abs(CRV[i]) > 1 / 30) tight++;
    if (tight * ds < target * 0.12) return null;
    // Start/Ziel: Stelle mit der ruhigsten Strecke davor (dort steht die Startaufstellung)
    var bestI = 0, bestV = Infinity;
    for (i = 0; i < n; i++) {
      var v = 0;
      for (k = -45; k <= 10; k++) v += Math.abs(CRV[(i + k + n) % n]);
      if (v < bestV) { bestV = v; bestI = i; }
    }
    // Wellen: 2–3 Abschnitte mit weichen Rändern
    var BUMP = new Float64Array(n), nb = 2 + Math.floor(rnd() * 2);
    for (k = 0; k < nb; k++) {
      var c0 = rnd() * n, half = (10 + rnd() * 15) / ds;
      for (i = 0; i < n; i++) {
        var dist = Math.abs(mod(i - c0 + n / 2, n) - n / 2);
        if (dist < half) BUMP[i] = Math.max(BUMP[i], Math.min(1, (half - dist) / 6));
      }
    }
    // Arrays so drehen, dass Index 0 die Start/Ziel-Linie ist
    function rot(A) { var B = new Float64Array(n); for (var r = 0; r < n; r++) B[r] = A[(r + bestI) % n]; return B; }
    return { X: rot(X), Z: rot(Z), YAW: rot(YAW), CRV: rot(CRV), BUMP: rot(BUMP), n: n, ds: ds, len: target };
  }

  var trackCache = {};
  function track(seed) {
    seed = seed | 0;
    if (trackCache[seed]) return trackCache[seed];
    var rnd = rng(seed), raw = null;
    for (var attempt = 0; attempt < 2000 && !raw; attempt++) raw = tryTrack(rnd);
    if (!raw) throw new Error('CarRaceSim.track: keine gültige Strecke für Seed ' + seed);
    var n = raw.n, ds = raw.ds, L = raw.len, pts = [];
    for (var i = 0; i < n; i++) pts.push([raw.X[i], raw.Z[i]]);
    function at(s) {
      var u = mod(s, L) / ds, i0 = Math.floor(u) % n, i1 = (i0 + 1) % n, f = u - Math.floor(u);
      var yaw = raw.YAW[i0] + wrapAngle(raw.YAW[i1] - raw.YAW[i0]) * f;
      return {
        x: raw.X[i0] + (raw.X[i1] - raw.X[i0]) * f,
        z: raw.Z[i0] + (raw.Z[i1] - raw.Z[i0]) * f,
        yaw: wrapAngle(yaw),
        curv: raw.CRV[i0] + (raw.CRV[i1] - raw.CRV[i0]) * f,
        nx: -Math.sin(yaw), nz: -Math.cos(yaw),
        bump: raw.BUMP[i0] + (raw.BUMP[i1] - raw.BUMP[i0]) * f
      };
    }
    function radiusAt(s) { return 1 / Math.max(Math.abs(at(s).curv), 1e-4); }
    var t = { seed: seed, pts: pts, len: L, width: WIDTH, at: at, radiusAt: radiusAt, _raw: raw };
    trackCache[seed] = t;
    return t;
  }

  // ---- Werte je Auto (Verhältnis-Werte 1–10 → Simulationsgrößen) ----
  function val(x, def) { x = Number(x); return isFinite(x) ? clamp(x, 1, 10) : def; }
  function stats(raw) {
    raw = raw || {};
    var p = val(raw.power, 5), sp = val(raw.speed, 5), h = val(raw.handling, 5), su = val(raw.susp, 5),
      b = val(raw.brakes, 5), w = val(raw.weight, 5);
    var len = Number(raw.len); if (!(len > 0)) len = 4.5;
    // speed 10 = 1,6 × speed 1, speed 5 = VTOP_BASE
    var vtop = VTOP_BASE * (1 + (sp - 5) * 0.6 / 11.4);
    return {
      acc: ACC_BASE * (0.9 + 0.02 * p) * (1.06 - 0.012 * w),
      vmax: vtop * SLIP_BONUS,
      grip: GRIP_BASE * (0.94 + 0.012 * h) * (1.01 - 0.002 * w),
      brake: BRAKE_BASE * (0.8 + 0.04 * b) * (1.1 - 0.02 * w),
      susp: su / 10,
      launch: LAUNCH[raw.drive] || 1,
      len: len
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
        st: st, w: w, lim: lim, prof: prof,
        react: 0.12 + rnd() * 0.3 + (bad ? 0.5 + rnd() * 0.5 : 0),
        luck: 0.88 + rnd() * 0.24,                  // Startglück: Traktion beim Losfahren
        lineOff: (rnd() - 0.5) * 1.6,               // eigene Linie
        form: form,
        push: form * (0.985 + rnd() * 0.03),        // wie nah am Limit (pro Runde neu)
        pushLap: 0,
        dT: (i % 2 === 0 ? 1 : -1) * 2.3,
        stuck: 0, ghostT: 0, timer: 0, dur: 0, yawOff: 0, yawTo: 0, slowT: 0, slowV: 0, parked: false,
        dDot: 0, accel: 0, rollV: 0, pitchV: 0, wheelR: clamp(0.07 * st.len, 0.3, 0.55)
      });
      cars.push({
        id: c.id, s: rowS[i >> 1], d: (i % 2 === 0 ? 1 : -1) * 2.3, v: 0, lap: 0, pos: i + 1,
        yaw: 0, roll: 0, pitch: 0, steer: 0, spin: 0, state: 'run', place: null, finish: null
      });
    });

    var counts = { spins: 0, crashes: 0, crashDnf: 0, slides: 0 };

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
    // Längsabstand b vor a entlang der Strecke (−L/2 … L/2)
    function gap(a, b) { return mod(b.s - a.s + L / 2, L) - L / 2; }
    function minGap(i, j) { return (P[i].st.len + P[j].st.len) / 2 + 0.4; }
    function latOverlap(i, j, di) {
      if ((P[i].ghostT > 0 && isWreck(j)) || (P[j].ghostT > 0 && isWreck(i))) return false;
      return Math.abs(di - cars[j].d) < (P[i].w + P[j].w) / 2 + 0.25;
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

    function startEvent(i, c, p, kind) {
      var crv = crvAt(c.s), out = crv > 0 ? -1 : 1;           // nach außen = weg vom Kurveninneren
      if (kind === 'slide') {                                  // Verbremser: zu spät gebremst, weit raus
        counts.slides++;
        p.slowT = 0.9; p.slowV = c.v * 0.55;
        p.dT = clamp(c.d + out * 2.5, -p.lim, p.lim);
      } else if (kind === 'spin') {                            // Dreher 1–2 s
        counts.spins++;
        c.state = 'spin'; p.timer = 0; p.dur = 1 + clamp((c.v - 8) / 14 + (rnd() - 0.5) * 0.3, 0, 1); p.yawTo = (rnd() < 0.5 ? -1 : 1) * TWO_PI;
        p.dT = clamp(c.d + out * 2, -p.lim, p.lim);
      } else {                                                 // Crash 3–6 s, selten DNF
        counts.crashes++;
        c.state = 'crash'; p.timer = 0; p.dur = 3 + 3 * clamp((c.v - 8) / 14 + (rnd() - 0.5) * 0.3, 0, 1); p.yawTo = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.7);
        p.dT = out * p.lim;
        if (rnd() < DNF_CHANCE * clamp(c.v / 16, 0.3, 1.6)) { p.parked = true; counts.crashDnf++; }
      }
    }

    function finishCheck(c, p, sim) {
      if (c.place === null && !p.parked && !sim.done && c.s >= laps * L) {
        c.place = ++finCount; c.finish = steps * DT;
        if (finCount === 1) deadline = c.finish + finishWindow;
      }
    }

    var sim = {
      DT: DT, track: T, cars: cars, time: 0, done: false, laps: laps, counts: counts,
      step: function () {
        steps++;
        var time = steps * DT, i, j, c, p;
        // 1) Tempo, Ereignisse, Seitenziel
        for (i = 0; i < cars.length; i++) {
          c = cars[i]; p = P[i];
          var v0 = c.v;
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
            if (p.timer >= p.dur && c.state !== 'dnf') {
              c.state = c.place !== null ? 'done' : sim.done ? 'dnf' : 'run'; p.yawOff = 0;
            }
          } else if (c.state === 'run' || c.state === 'done' || c.state === 'dnf') {
            if (time < p.react) { c.v = 0; }
            else {
              // Notausgang gegen Verkeilen: wer 1,5 s hinter einem Wrack festsitzt, darf sich 2,5 s lang
              // daran vorbeischieben (Wracks blockieren ihn dann nicht mehr)
              p.stuck = c.v < 0.3 ? p.stuck + DT : 0;
              if (p.stuck > 1.5) { p.stuck = 0; p.ghostT = 2.5; }
              if (p.ghostT > 0) p.ghostT -= DT;
              var cruise = c.state !== 'run' || sim.done;      // im Ziel / nach Rennende: locker weiter
              // Auto vorn (gleiche Spur) für Windschatten und Folgen
              var ahead = -1, ag = Infinity, slip = false;
              for (j = 0; j < cars.length; j++) {
                if (j === i) continue;
                var g = gap(c, cars[j]);
                if (g <= 0) continue;
                if (g < SLIP_RANGE && Math.abs(cars[j].d - c.d) < 2.5 && cars[j].v > 3) slip = true;
                if (g < ag && latOverlap(i, j, c.d)) { ag = g; ahead = j; }
              }
              var vtop = p.st.vmax / (slip ? 1 : SLIP_BONUS);
              // Ideallinie: vor Kurven nach innen; wer daneben fährt, ist in Kurven langsamer (Überholen kostet)
              var line = clamp(crvAt(c.s + 10) * 50, -2.5, 2.5) + p.lineOff;
              var offLine = 1 - OFF_LINE * Math.max(0, Math.abs(c.d - line) - 0.5);
              var target = Math.min(profAt(p, c.s) * (cruise ? 0.75 : p.push * offLine), vtop);
              if (p.slowT > 0) { p.slowT -= DT; target = Math.min(target, p.slowV); }
              if (ahead >= 0) {                                  // nicht auffahren
                var free = ag - minGap(i, ahead);
                target = Math.min(target, Math.max(0, cars[ahead].v + Math.max(0, free - 0.5) * 2));
              }
              if (c.v < target) {
                var a = p.st.acc * (1 - Math.pow(c.v / vtop, DRAG_EXP));
                if (c.v < 8 && c.lap <= 1) a *= p.st.launch * p.luck;   // Antrieb + Startglück beim Losfahren
                c.v = Math.min(target, c.v + Math.max(a, 0.3) * DT);
              } else {
                c.v = Math.max(target, c.v - p.st.brake * 1.3 * DT);
              }
              c.v = clamp(c.v, 0, p.st.vmax);
              // Pech: Risiko steigt mit Tempo über der Kurvengrenze
              // (Geraden zählen wie ein weiter Bogen mit R = R_RISK: wer dort sehr schnell ist, riskiert auch etwas)
              var R = Math.min(R_RISK, 1 / Math.max(Math.abs(crvAt(c.s)), 1e-4));
              if (!cruise && c.state === 'run' && c.v > 4) {
                var ratio = c.v / Math.sqrt(G_REF * R), own = c.v / Math.sqrt(p.st.grip * R);
                var rate = RISK * Math.pow(ratio, RISK_EXP) * Math.exp((own - 1) * 12);
                if (rnd() < rate * DT) {
                  var u = rnd();
                  startEvent(i, c, p, u < 0.45 ? 'slide' : u < 0.82 ? 'spin' : 'crash');
                }
              }
              // Überholen: langsameres Auto dicht vorn → Seite wechseln, wenn dort Platz ist
              if (p.slowT <= 0) {                     // auch im Ziel: Wracks umfahren
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
              }
            }
          }
          if (c.lap > p.pushLap) { p.pushLap = c.lap; p.push = p.form * (0.985 + rnd() * 0.03); }
          p.accel = (c.v - v0) / DT;
        }
        // 2) Seitlich bewegen (nur in freie Spur) und vorwärts
        for (i = 0; i < cars.length; i++) {
          c = cars[i]; p = P[i];
          var latMax = (2 + 0.15 * c.v) * DT, dd = clamp(clamp(p.dT, -p.lim, p.lim) - c.d, -latMax, latMax);
          var nd = c.d + dd;
          if (dd !== 0 && !laneFreeMove(i, nd)) {
            nd = c.d;
            // Wrack, das nicht an den Rand rutschen kann (Auto daneben): an den anderen Rand
            if ((c.state === 'crash' || p.parked) && c.v < 2 && Math.abs(p.dT) >= p.lim - 1e-9) p.dT = -p.dT;
          }
          p.dDot = (nd - c.d) / DT;
          c.d = clamp(nd, -p.lim, p.lim);
          c.s += c.v * DT;
        }
        // 3) Keine Durchdringung: hinteres Auto zurücksetzen und bremsen
        for (var it = 0; it < 2; it++) {
          for (i = 0; i < cars.length; i++) {
            for (j = 0; j < cars.length; j++) {
              if (i === j || !latOverlap(i, j, cars[i].d)) continue;
              var gg = gap(cars[i], cars[j]), mg = minGap(i, j);
              if (gg >= 0 && gg < mg) {          // j vor i, zu dicht
                cars[i].s -= (mg - gg);
                if (cars[i].v > cars[j].v) cars[i].v = cars[j].v;
              }
            }
          }
        }
        // 4) Runden, Ziel, Darstellung
        for (i = 0; i < cars.length; i++) {
          c = cars[i]; p = P[i];
          c.lap = c.s < 0 ? 0 : Math.min(laps, Math.floor(c.s / L) + 1);
          finishCheck(c, p, sim);
          if (c.place !== null && c.state === 'run') c.state = 'done';
          var tp = T.at(c.s), crv = tp.curv;
          var latAng = Math.atan2(p.dDot, Math.max(c.v, 1));
          c.yaw = wrapAngle(tp.yaw + latAng + p.yawOff);
          var wb = c.state === 'spin' ? -p.yawOff * 0.15 : Math.atan(0.6 * p.st.len * crv) + latAng * 1.5;
          c.steer += (clamp(wb, -0.6, 0.6) - c.steer) * Math.min(1, DT * 8);
          c.spin = mod(c.spin + c.v * DT / p.wheelR, TWO_PI);
          var soft = 1.3 - p.st.susp, bump = bumpAt(c.s);
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
              if (cars[i].place === null && cars[i].state !== 'spin' && cars[i].state !== 'crash') cars[i].state = 'dnf';
            }
          }
        }
        // Positionen
        var order = sim.standings();
        for (i = 0; i < cars.length; i++) cars[i].pos = order.indexOf(cars[i].id) + 1;
        sim.time = time;
      },
      fastForward: function (t) {
        var target = Math.round(t / DT);
        while (steps < target) sim.step();
      },
      standings: function () {
        var idx = cars.map(function (c, i) { return i; });
        idx.sort(function (a, b) {
          var ca = cars[a], cb = cars[b];
          var ka = ca.place !== null ? 0 : P[a].parked ? 2 : 1, kb = cb.place !== null ? 0 : P[b].parked ? 2 : 1;
          if (ka !== kb) return ka - kb;
          if (ka === 0) return ca.place - cb.place;
          if (cb.s !== ca.s) return cb.s - ca.s;
          return a - b;
        });
        return idx.map(function (i) { return cars[i].id; });
      },
      result: function () {
        return cars.map(function (c) { return { id: c.id, place: c.place }; });
      }
    };

    // Seitlicher Schritt nur, wenn er keine neue Überlappung mit einem Auto daneben erzeugt
    function laneFreeMove(i, nd) {
      for (var j = 0; j < cars.length; j++) {
        if (j === i) continue;
        var g = gap(cars[i], cars[j]);
        if (Math.abs(g) >= minGap(i, j) - 0.05) continue;   // Toleranz: direkt dahinter zählt nicht als daneben
        if (latOverlap(i, j, nd) && Math.abs(nd - cars[j].d) < Math.abs(cars[i].d - cars[j].d)) return false;
      }
      return true;
    }

    return sim;
  }


  return {
    DT: DT, WIDTH: WIDTH, MAX_TIME: MAX_TIME,
    // gute Strecken-Seeds: node scripts/check_car_race_sim.js --find 30 (Regeln + Siegerzeit 57–67 s)
    TRACKS: [1, 4, 5, 6, 8, 9, 10, 12, 16, 17, 20, 24],
    rng: rng, track: track, stats: stats, create: create
  };
});
