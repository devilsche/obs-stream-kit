/* Car Race (Overlay) – Motorstimmen aus echten Aufnahmen für die Autos, auf die die Kamera schaut.
 * Baut auf js/car-engine-audio.js (Klangbank) und js/car-race-sound.js (AudioContext, Master, Lautstärke, ?sound=0).
 * Das Feld-Rumpeln von car-race-sound.js bleibt; hier kommen höchstens MAX Stimmen dazu: die Autos, die der Kamera
 * am nächsten und im Bild sind (Führender, Nahaufnahme, Unfall-Zoom, Podest) – leiser nach Abstand, mit Doppler.
 *
 *   var E = CarRaceEngines.create(snd)          null ohne snd/Web Audio/Klangbank-Skript
 *   E.frame(dt, race, cam, visible, now)        je Bild nach der Kamera (car-race.js); race = Rennzustand
 *                                               (stage grid/race/end/podium, order[i] mit holder/stats (Sim-Werte)/key/entry,
 *                                               sim.cars[i].v),
 *                                               now = Server-Zeit (Countdown bis race.startsAt)
 *   E.rev(sec)                                  „START YOUR ENGINES“: das Feld gibt sec Sekunden lang kräftig Gas
 *                                               (Gasstöße aller Stimmen in der Startaufstellung, je eine Hochdreh-Aufnahme)
 *   E.stop()                                    alle Stimmen aus
 * Zusätzlich: Vorbeifahrt (pass) an der Kamera – vorausberechnet, damit die lauteste Stelle der Aufnahme auf den
 * nächsten Punkt fällt; in der Startaufstellung Gasstöße, die zum Start hin dichter werden.
 */
(function (root) {
  'use strict';
  var MAX = 3, REF = 10, FAR = 140, PASS_D = 9, PASS_GAP = 1.2;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  function create(snd) {
    if (!snd || !root.CarEngineAudio) return null;
    var eng = root.CarEngineAudio.create(snd);
    if (!eng) return null;
    var ok = false, voices = [], lastPass = -1, info = new Map(), fwd = null, right = null, revUntil = -1;
    eng.ready.then(function (b) { ok = b; });

    function stats(r) {
      var s = info.get(r);
      if (!s) {
        // r.stats = Sim-Werte (Spielzeug-Tempo), echte Werte + Motorart aus CarRaceStats (Schätzung + Car editor)
        var CS = root.CarRaceStats, raw = CS && r.key ? CS.of(r.key, r.entry || undefined) : {}, vtop = (r.stats && r.stats.vmax) || 30;
        s = { engine: raw.engine || 'i4', vtop: vtop, mps: (raw.vmax || 250) / 3.6 / vtop,
              x: null, z: null, d: null, v: 0, pass: -10 };
        info.set(r, s);
      }
      return s;
    }
    function stopAll() { voices.forEach(function (o) { o.v.stop(); }); voices = []; }

    function frame(dt, race, cam, visible, now) {
      if (!ok || !race || !cam) { if (voices.length) stopAll(); return; }
      if (!visible || !race.order || !race.order.length) { stopAll(); return; }
      if (!fwd) { fwd = new cam.position.constructor(); right = new cam.position.constructor(); }
      cam.getWorldDirection(fwd);
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      var stage = race.stage, cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
      var sim = race.sim, left = race.startsAt != null && now != null ? race.startsAt - now : null;
      var cand = [];
      race.order.forEach(function (r, i) {
        if (!r || !r.holder || !r.holder.visible) return;
        var s = stats(r), p = r.holder.position, c = sim && stage !== 'grid' && stage !== 'podium' ? sim.cars[i] : null;
        if (c && (c.state === 'dnf' || c.ghost)) { s.x = null; return; }
        var vx = 0, vz = 0;
        if (s.x != null && dt > 0) { vx = (p.x - s.x) / dt; vz = (p.z - s.z) / dt; }
        s.x = p.x; s.z = p.z;
        var dx = p.x - cx, dy = (p.y || 0) - cy, dz = p.z - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var radial = s.d != null && dt > 0 ? -(d - s.d) / dt * s.mps : 0;
        s.d = d;
        var v = c ? c.v : Math.hypot(vx, vz);
        var acc = dt > 0 ? (v - s.v) / dt : 0;
        s.v = v;
        // im Bild? (Winkel zur Blickrichtung)
        var front = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / Math.max(1e-3, d);
        // Vorbeifahrt: nächster Punkt der geraden Bahn relativ zur Kamera (am Boden)
        if (stage === 'race' && v > s.vtop * 0.35 && dt > 0) {
          var px = dx, pz = dz, vv = vx * vx + vz * vz;
          if (vv > 1) {
            var tca = -(px * vx + pz * vz) / vv, mx = px + vx * tca, mz = pz + vz * tca, dmin = Math.sqrt(mx * mx + mz * mz + dy * dy);
            var t = performance.now() / 1000;
            if (dmin < PASS_D && tca > 0.9 && tca < 1.25 && t - s.pass > 4 && t - lastPass > PASS_GAP && eng.has(s.engine, 'pass')) {
              s.pass = lastPass = t;
              eng.oneShot(s.engine, 'pass', { gain: 0.45 * clamp(REF / Math.max(REF, dmin * 2), 0.4, 1), seed: r.key + ':' + Math.floor(t),
                pan: clamp((vx * right.x + vz * right.z) / Math.sqrt(vv), -1, 1) * 0.5 });
            }
          }
        }
        if (d < FAR && front > 0.25) cand.push({ r: r, s: s, d: d, radial: radial, acc: acc, v: v, pan: clamp((dx * right.x + dz * right.z) / Math.max(1e-3, d), -1, 1) * 0.6 });
      });
      cand.sort(function (a, b) { return a.d - b.d; });
      cand = cand.slice(0, MAX);
      var want = cand.map(function (x) { return x.r; });
      voices = voices.filter(function (o) { if (want.indexOf(o.r) < 0) { o.v.stop(); return false; } return true; });
      cand.forEach(function (x, k) {
        var o = voices.filter(function (q) { return q.r === x.r; })[0];
        if (!o) { o = { r: x.r, v: eng.voice(x.s.engine, { gain: 0.75, seed: x.r.key, lite: true }), thr: 0, blipT: 0 }; voices.push(o); }
        var speed = stage === 'grid' || stage === 'podium' ? 0 : x.v / x.s.vtop, thr;
        if (stage === 'grid') {
          // Startaufstellung: Leerlauf, Gasstöße (zum Start hin öfter), in der letzten halben Sekunde Drehzahl halten
          thr = left != null && left < 0.6 && left > -0.5 ? 0.45 : 0;
          var rate = left == null ? 0.05 : left < 4 ? 0.9 : left < 10 ? 0.3 : 0.08;
          var revving = performance.now() / 1000 < revUntil;
          if (revving) {
            // Feld gibt Gas: je Stimme einmal Hochdrehen, dann dichte, kräftige Gasstöße
            if (!o.revved) { o.revved = true; o.v.oneShot('rev', 0.55); }
            rate = 2.4; thr = 0.25;
          }
          if (Math.random() < dt * rate) o.v.blip(revving ? 0.75 + Math.random() * 0.25 : 0.45 + Math.random() * 0.5);
        } else if (stage === 'podium') {
          thr = 0;
          if (race.podium && race.podium.cars && race.podium.cars[0] && race.podium.cars[0].r === x.r && Math.random() < dt * 0.35) o.v.blip(0.6 + Math.random() * 0.4);
        } else {
          thr = x.acc > 0.4 ? 0.9 : x.acc < -2 ? 0 : 0.45;
          if (stage === 'end' && x.v < x.s.vtop * 0.2) thr = 0;
        }
        o.thr += (thr - o.thr) * Math.min(1, dt * 8);
        o.v.update(dt, { speed: speed, throttle: o.thr, dist: x.d, ref: REF, radial: x.radial, pan: x.pan });
      });
    }
    function rev(sec) {
      revUntil = performance.now() / 1000 + Math.max(0.5, +sec || 2);
      voices.forEach(function (o) { o.revved = false; });
    }
    return { frame: frame, rev: rev, stop: function () { stopAll(); info = new Map(); revUntil = -1; }, engine: eng };
  }

  root.CarRaceEngines = { create: create };
})(typeof window !== 'undefined' ? window : this);
