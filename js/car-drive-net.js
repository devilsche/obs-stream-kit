/* Car Drive Mehrspieler: Netz-Client für den WS-Dienst (drive_ws.py) – ohne DOM, ohne three.js.
 * Läuft im Browser (window.CarDriveNet) und in Node ≥ 22 (globales WebSocket; Rauchtest scripts/check_car_drive_mp.js).
 *
 *   CarDriveNet.connect({ url, ticket, onMessage(msg), onState(open bool), WebSocket? }) → net
 *       url = wss://<host>/drive-ws/<code>; die erste Nachricht ist {t: 'hello', ticket}. Bricht die Verbindung
 *       unerwartet ab, verbindet net bis zu 5× neu (gleiches Ticket); onMessage bekommt alle Server-Nachrichten.
 *   net.send(obj)                 beliebige Nachricht (join, leave …), still verworfen, wenn nicht verbunden
 *   net.sendState(st, force)      eigener Zustand {x, z, yaw, roll, pitch, steer, speed, prog, t, spin}, höchstens 20 Hz
 *   net.serverNow()               Server-Uhr (s) aus dem Ping mit der kürzesten Laufzeit
 *   net.sample(id, at)            Fremdauto zum Server-Zeitpunkt `at` (Standard: serverNow() − DELAY), interpoliert
 *                                 zwischen den gepufferten Zuständen (100 ms Puffer), danach höchstens 0,25 s fortgeschrieben
 *   net.ids()                     IDs mit gepufferten Zuständen
 *   net.close()
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CarDriveNet = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var DELAY = 0.1, RATE = 1 / 20, KEEP = 30;
  function nowS() { return (typeof performance !== 'undefined' && performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now()) / 1000; }
  function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // Felder eines Zustands im Server-Batch [id, ts, x, z, yaw, roll, pitch, steer, speed, prog, spin]
  var F = ['x', 'z', 'yaw', 'roll', 'pitch', 'steer', 'speed', 'prog', 'spin'];

  function connect(opts) {
    var WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    var ws = null, open = false, closed = false, tries = 0, lastSent = -1, offset = 0, bestRtt = Infinity, pingT = null;
    var buf = {};
    var net = {
      send: function (o) { if (open && ws) try { ws.send(JSON.stringify(o)); } catch (e) { /* weg */ } },
      sendState: function (st, force) {
        var t = nowS();
        if (!force && t - lastSent < RATE) return false;
        lastSent = t;
        // Rennzeit heißt im Protokoll rt (t ist der Nachrichtentyp)
        net.send({ t: 's', x: st.x, z: st.z, yaw: st.yaw, roll: st.roll, pitch: st.pitch, steer: st.steer,
          speed: st.speed, prog: st.prog, spin: st.spin, rt: st.t });
        return true;
      },
      serverNow: function () { return nowS() + offset; },
      sample: function (id, at) {
        var b = buf[id];
        if (!b || !b.length) return null;
        if (at == null) at = net.serverNow() - DELAY;
        var i = b.length - 1;
        while (i > 0 && b[i].ts > at) i--;
        var a = b[i], c = b[i + 1], o = {};
        if (c && c.ts > a.ts && at >= a.ts) {
          var k = Math.min(1, (at - a.ts) / (c.ts - a.ts));
          F.forEach(function (f) { o[f] = f === 'yaw' || f === 'spin' ? a[f] + wrapAngle(c[f] - a[f]) * k : lerp(a[f], c[f], k); });
        } else {
          // nach dem letzten Zustand: kurz geradeaus fortschreiben, dann stehen lassen
          F.forEach(function (f) { o[f] = a[f]; });
          var ex = Math.max(0, Math.min(0.25, at - a.ts));
          o.x += Math.cos(a.yaw) * a.speed * ex; o.z -= Math.sin(a.yaw) * a.speed * ex;
        }
        o.ts = a.ts;
        return o;
      },
      ids: function () { return Object.keys(buf); },
      forget: function (id) { delete buf[id]; },
      close: function () { closed = true; if (pingT) clearInterval(pingT); try { if (ws) ws.close(); } catch (e) { /* */ } },
      isOpen: function () { return open; }
    };
    function ping() { net.send({ t: 'ping', c: nowS() }); }
    function onMsg(ev) {
      var m;
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'pong' && typeof m.c === 'number') {
        var t = nowS(), rtt = t - m.c;
        if (rtt >= 0 && rtt <= bestRtt * 1.5 + 0.01) { if (rtt < bestRtt) bestRtt = rtt; offset = m.s - (m.c + rtt / 2); }
        return;
      }
      if (m.t === 'welcome' && typeof m.now === 'number' && bestRtt === Infinity) offset = m.now - nowS();
      if (m.t === 'S' && Array.isArray(m.d)) {
        m.d.forEach(function (r) {
          if (!Array.isArray(r) || r.length < 11) return;
          var id = String(r[0]), b = buf[id] || (buf[id] = []), ts = +r[1];
          if (b.length && b[b.length - 1].ts >= ts) return;      // unverändert
          var s = { ts: ts };
          F.forEach(function (f, i) { s[f] = +r[i + 2] || 0; });
          b.push(s); if (b.length > KEEP) b.shift();
        });
      }
      if (m.t === 'phase' && m.phase === 'countdown') buf = {};
      if (opts.onMessage) opts.onMessage(m);
    }
    function start() {
      if (!WS) { if (opts.onMessage) opts.onMessage({ t: 'error', msg: 'WebSocket is not available' }); return; }
      ws = new WS(opts.url);
      ws.onopen = function () {
        open = true; tries = 0;
        ws.send(JSON.stringify({ t: 'hello', ticket: opts.ticket }));
        bestRtt = Infinity;
        [0, 150, 300, 600, 1000].forEach(function (d) { setTimeout(ping, d + 50); });
        if (pingT) clearInterval(pingT);
        pingT = setInterval(ping, 4000);
        if (opts.onState) opts.onState(true);
      };
      ws.onmessage = onMsg;
      ws.onclose = function (ev) {
        open = false;
        if (pingT) { clearInterval(pingT); pingT = null; }
        if (opts.onState) opts.onState(false, ev && ev.code);
        // 4000+ = vom Server bewusst beendet (Raum zu, Ticket ungültig …): nicht neu verbinden
        if (closed || (ev && ev.code >= 4000) || tries >= 5) { if (opts.onMessage && !closed) opts.onMessage({ t: 'gone', code: ev && ev.code }); return; }
        tries++;
        setTimeout(function () { if (!closed) start(); }, 1500 * tries);
      };
      ws.onerror = function () { /* onclose folgt */ };
    }
    start();
    return net;
  }

  return { connect: connect, DELAY: DELAY, RATE: RATE };
});
