#!/usr/bin/env node
/* Rauchtest Car Drive Mehrspieler: N Clients (js/car-drive-net.js + Fahrphysik mit Autopilot) gegen einen laufenden
 * WS-Dienst. Wird von scripts/smoke_drive_ws.py gestartet (startet den Dienst lokal, öffnet den Raum, stellt Tickets aus):
 *   node scripts/check_car_drive_mp.js <ws-base> <http-base> <code> <internal-key> <tenant> <ticket> [<ticket> …]
 * Der letzte Client schummelt (springt 150 m nach vorn) und muss als ungültig gewertet werden. Ab 4 Clients verliert
 * Client 1 nach 4 s das Signal (sendet nichts mehr): der Server übernimmt (takeover), der Träger (carrier) meldet die
 * Lage des Nachfahrers (s mit for) – der Fahrer muss trotzdem ins Ziel kommen, seine KI-Runden ohne Rekord.
 * Prüft: alle verbunden + angemeldet, Countdown/Start kommen an, Fremdzustände werden gepuffert und interpoliert,
 * Runden-/Zielmeldungen, Ergebnis mit Plätzen, „recorded“ kommt.
 */
'use strict';
var path = require('path');
var Net = require(path.join(__dirname, '../js/car-drive-net.js'));
var Sim = require(path.join(__dirname, '../js/car-race-sim.js'));
var Stats = require(path.join(__dirname, '../js/car-race-stats.js'));
var Phys = require(path.join(__dirname, '../js/car-drive-phys.js'));

var a = process.argv.slice(2), WSB = a[0], HTTPB = a[1], CODE = a[2], KEY = a[3], TENANT = a[4], TICKETS = a.slice(5);
var fails = 0;
function ok(c, m) { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; }
var CAR = 'porsche-911-gt3-2', N = TICKETS.length;

function pilot(car, k) {
  var T = car.T, look = 6 + Math.abs(car.u) * 0.5, p = T.at(car.s + look);
  var err = Math.atan2(-(p.z - car.z), p.x - car.x) - car.yaw;
  while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
  var vmax = 1e9;
  for (var q = 0; q <= 40; q += 4) vmax = Math.min(vmax, Math.sqrt(car.P.grip * k / Math.max(Math.abs(T.at(car.s + q).curv), 1e-4)) + q * 0.35);
  return { steer: Math.max(-1, Math.min(1, err * 2.5)), throttle: car.u < vmax ? 1 : 0, brake: car.u > vmax + 1.5 ? 0.8 : 0 };
}

var clients = TICKETS.map(function (tk, i) {
  var c = { i: i, cheat: i === N - 1 && N > 2, drop: i === 1 && N > 3, taken: {}, follow: {}, carrier: null, aiAt: 0, roster: 0, phase: null, results: null, recorded: null, laps: [], sampled: 0, joined: false };
  c.net = Net.connect({ url: WSB + '/drive-ws/' + CODE, ticket: tk, onMessage: function (m) { onMsg(c, m); } });
  return c;
});
var started = false;
function onMsg(c, m) {
  if (m.t === 'welcome') { c.id = m.id; c.net.send({ t: 'join', car: CAR, paint: 0 }); }
  else if (m.t === 'joined') c.joined = m.ok;
  else if (m.t === 'roster') {
    c.roster = m.list.length;
    if (!started && clients.every(function (x) { return x.roster === N; })) {
      started = true;
      fetch(HTTPB + '/internal/start?tenant=' + TENANT, { headers: { 'X-Drive-Key': KEY } }).then(function (r) { return r.json(); })
        .then(function (j) { ok(j.ok, 'Start über interne Schnittstelle: ' + j.msg); });
    }
  } else if (m.t === 'phase') {
    c.phase = m.phase;
    if (m.phase === 'countdown') setup(c, m);
  } else if (m.t === 'lap' && m.id === c.id) c.laps.push(m);
  else if (m.t === 'results') c.results = m;
  else if (m.t === 'takeover') { c.taken[m.ev.id] = m.ev; delete c.follow[m.ev.id]; c.sawTakeover = m.ev.id; }
  else if (m.t === 'carrier') c.carrier = m.id;
  else if (m.t === 'recorded') { c.recorded = m; check(); }
  else if (m.t === 'error') ok(false, 'Fehler vom Server: ' + m.msg);
}
function setup(c, m) {
  var T = Sim.track(Sim.TRACKS[m.track]), raw = Stats.guess({ key: CAR, len: 4.5 }), st = Sim.stats(raw);
  var me = m.grid.filter(function (g) { return g.id === c.id; })[0], gi = me ? me.grid : 0;
  var s = -(4 + Math.floor(gi / 2) * 7.5), d = gi % 2 === 0 ? 2.3 : -2.3;
  c.car = Phys.create(T, Phys.params(st, raw), { s: s, d: d });
  c.startAt = m.start_at; c.T = T;
  var last = Date.now();
  c.timer = setInterval(function () {
    var now = Date.now(), dt = (now - last) / 1000; last = now;
    var rt = c.net.serverNow() - c.startAt;
    if (rt > 0 && c.phase !== 'done') {
      Phys.step(c.car, pilot(c.car, 0.75 + 0.05 * c.i), dt);
      if (c.cheat && rt > 3 && !c.cheated) { c.cheated = true; c.car.prog += 150; }
    }
    if (c.drop && rt > 4) return;          // Signal weg
    if (c.carrier === c.id && now - c.aiAt > 200) {
      c.aiAt = now;
      Object.keys(c.taken).forEach(function (id) {
        var f = c.follow[id] || (c.follow[id] = Sim.follower(c.T, st, c.taken[id], { laps: m.laps }));
        var q = f.at(rt);
        c.net.send({ t: 's', for: id, x: q.x, z: q.z, yaw: q.yaw, roll: 0, pitch: 0, steer: q.steer, speed: q.v, prog: q.s,
          rt: rt, spin: q.spin, ts: c.net.serverNow() });
      });
    }
    c.net.sendState({ x: c.car.x, z: c.car.z, yaw: c.car.yaw, roll: c.car.roll, pitch: c.car.pitch, steer: c.car.steer,
      speed: Math.hypot(c.car.vx, c.car.vz), prog: c.car.prog, t: Math.max(0, rt), spin: c.car.spin });
    c.net.ids().forEach(function (id) { if (id !== c.id && c.net.sample(id)) c.sampled++; });
  }, 1000 / 60);
}
var done = false;
function check() {
  if (done || !clients.every(function (c) { return c.recorded; })) return;
  done = true;
  clients.forEach(function (c) { clearInterval(c.timer); c.net.close(); });
  ok(clients.every(function (c) { return c.joined; }), 'alle ' + N + ' Clients angemeldet');
  ok(clients.every(function (c) { return c.sampled > 100; }), 'Fremdautos interpoliert (' + clients.map(function (c) { return c.sampled; }).join(', ') + ' Abfragen)');
  var res = clients[0].results, byId = {};
  res.list.forEach(function (r) { byId[r.id] = r; });
  console.log('     Ergebnis: ' + res.list.map(function (r) { return r.name + ' ' + (r.place || r.status) + ' ' + (r.time != null ? r.time.toFixed(2) + ' s' : '') + (r.reasons.length ? ' [' + r.reasons.join(',') + ']' : ''); }).join(' · '));
  var honest = clients.filter(function (c) { return !c.cheat; });
  ok(honest.every(function (c) { return byId[c.id].status === 'finished' && c.laps.length >= 1 && c.laps[c.laps.length - 1].ok; }), 'ehrliche Fahrer im Ziel, Runden gültig');
  ok(honest.map(function (c) { return byId[c.id].place; }).sort().join() === honest.map(function (c, i) { return i + 1; }).join(), 'Plätze 1..' + honest.length + ' vergeben');
  var dropped = clients.filter(function (c) { return c.drop; })[0];
  if (dropped) {
    ok(clients.some(function (c) { return c.sawTakeover === dropped.id; }), 'Übernahme nach Signalverlust gemeldet');
    ok(byId[dropped.id].status === 'finished', 'KI bringt den getrennten Fahrer ins Ziel (' + byId[dropped.id].status + ')');
    ok(dropped.laps.some(function (l) { return l.ai; }), 'Runde der KI als ai markiert');
  }
  var cheater = clients.filter(function (c) { return c.cheat; })[0];
  if (cheater) ok(byId[cheater.id].status === 'invalid', 'Schummler ungültig (' + byId[cheater.id].reasons.join(',') + ')');
  ok(clients.every(function (c) { return c.recorded.race_id === res.race_id; }), 'recorded an alle (gezählt: ' + clients[0].recorded.counted + ')');
  console.log(fails ? fails + ' Fehler' : 'alles ok');
  process.exit(fails ? 1 : 0);
}
setTimeout(function () { ok(false, 'Zeitüberschreitung (kein Ergebnis nach 150 s)'); process.exit(1); }, 150000);
