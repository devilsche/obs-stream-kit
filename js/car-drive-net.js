/* Car Drive Mehrspieler: Netz-Client für den WS-Dienst (drive_ws.py) – ohne DOM, ohne three.js.
 * Läuft im Browser (window.CarDriveNet) und in Node ≥ 22 (globales WebSocket; Rauchtest scripts/check_car_drive_mp.js).
 *
 *   CarDriveNet.connect({ url, ticket, onMessage(msg), onState(open bool), WebSocket? }) → net
 *       url = wss://<host>/drive-ws/<code>; die erste Nachricht ist {t: 'hello', ticket}. Bricht die Verbindung
 *       unerwartet ab, verbindet net bis zu 5× neu (gleiches Ticket); onMessage bekommt alle Server-Nachrichten.
 *   net.send(obj)                 beliebige Nachricht (join, leave …), still verworfen, wenn nicht verbunden
 *   net.sendState(st, force)      eigener Zustand {x, z, yaw, roll, pitch, steer, speed, prog, t, spin}, höchstens 30 Hz;
 *                                 trägt ts (Server-Uhr beim Senden) und pg (eigener Ping, ms) mit
 *   net.serverNow()               Server-Uhr (s) aus dem Ping mit der kürzesten Laufzeit
 *   net.delay()                   Puffer (s), um den fremde Autos hinter der Server-Uhr gezeigt werden: passt sich dem
 *                                 gemessenen Netz-Zittern der anderen an (MIN_DELAY…MAX_DELAY, Start 0,1 s), je Bild aufrufen
 *   net.sample(id, at, T)         Fremdauto zum Server-Zeitpunkt `at` (Standard: serverNow() − delay()), interpoliert
 *                                 zwischen den gepufferten Zuständen. Fehlen Daten, fährt es bis EXT_MAX s mit dem letzten
 *                                 Tempo weiter – mit Strecke T (CarRaceSim.track) entlang der Kurve und mit gleichem
 *                                 Seitenabstand, sonst geradeaus (höchstens 0,5 s). Kommen wieder Daten, wird der Versatz
 *                                 über SMOOTH s ausgeglichen statt zu springen. → {x, z, yaw, …, ts, lag (s ohne Daten)}
 *   net.ping()                    eigener Ping {ms, jitter} (geglättet, alle 2 s gemessen) oder null
 *   net.peerPing(id)              Ping eines anderen Fahrers (ms, vom Server einmal pro Sekunde verteilt) oder null
 *   net.lag(id)                   wie lange (s) zum aktuellen Anzeigezeitpunkt schon Daten dieses Fahrers fehlen
 *   net.ids()                     IDs mit gepufferten Zuständen
 *   net.close()
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CarDriveNet = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var DELAY = 0.1, RATE = 1 / 30, KEEP = 60;
  var MIN_DELAY = 0.06, MAX_DELAY = 0.35, EXT_MAX = 1.5, SMOOTH = 0.3, PING_EVERY = 2000;
  function nowS() { return (typeof performance !== 'undefined' && performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now()) / 1000; }
  function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // Felder eines Zustands im Server-Batch [id, ts, x, z, yaw, roll, pitch, steer, speed, prog, spin]
  var F = ['x', 'z', 'yaw', 'roll', 'pitch', 'steer', 'speed', 'prog', 'spin'];

  function connect(opts) {
    var WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    var ws = null, open = false, closed = false, tries = 0, lastSent = -1, offset = 0, bestRtt = Infinity, pingT = null;
    var buf = {}, jt = {}, vis = {}, peer = {};
    var rttS = null, jit = 0, dly = DELAY, dlyAt = 0, tgt = DELAY, tgtAt = 0;
    // Puffer-Ziel: je Fahrer Paketabstand + Streuung der Ankunftsverspätung (90 %-Wert − kleinster Wert)
    function target(now) {
      var best = 0;
      Object.keys(jt).forEach(function (id) {
        var j = jt[id];
        if (now - j.at > 3 || j.L.length < 5) return;
        var L = j.L.slice().sort(function (a, b) { return a - b; });
        best = Math.max(best, j.gap + (L[Math.floor(L.length * 0.9)] - L[0]) + 0.015);
      });
      return best > 0 ? Math.max(MIN_DELAY, Math.min(MAX_DELAY, best)) : DELAY;
    }
    var net = {
      send: function (o) { if (open && ws) try { ws.send(JSON.stringify(o)); } catch (e) { /* weg */ } },
      sendState: function (st, force) {
        var t = nowS();
        if (!force && t - lastSent < RATE) return false;
        lastSent = t;
        // Rennzeit heißt im Protokoll rt (t ist der Nachrichtentyp)
        net.send({ t: 's', x: st.x, z: st.z, yaw: st.yaw, roll: st.roll, pitch: st.pitch, steer: st.steer,
          speed: st.speed, prog: st.prog, spin: st.spin, rt: st.t, ts: Math.round(net.serverNow() * 1000) / 1000,
          pg: rttS != null ? Math.round(rttS * 1000) : undefined });
        return true;
      },
      serverNow: function () { return nowS() + offset; },
      delay: function () {
        var t = nowS();
        if (t - tgtAt > 0.25) { tgt = target(t); tgtAt = t; }
        var dt = dlyAt ? Math.min(0.2, t - dlyAt) : 0;
        dlyAt = t;
        // schnell vergrößern (sonst läuft der Puffer leer), langsam verkleinern
        dly += (tgt - dly) * Math.min(1, dt * (tgt > dly ? 3 : 0.5));
        return dly;
      },
      sample: function (id, at, T) {
        var b = buf[id];
        if (!b || !b.length) return null;
        if (at == null) at = net.serverNow() - net.delay();
        var i = b.length - 1;
        while (i > 0 && b[i].ts > at) i--;
        var a = b[i], c = b[i + 1], o = {}, ext = 0;
        if (c && c.ts > a.ts && at >= a.ts) {
          var k = Math.min(1, (at - a.ts) / (c.ts - a.ts));
          F.forEach(function (f) { o[f] = f === 'yaw' || f === 'spin' ? a[f] + wrapAngle(c[f] - a[f]) * k : lerp(a[f], c[f], k); });
        } else {
          // nach dem letzten Zustand: mit dem letzten Tempo weiterfahren (entlang der Strecke), dann stehen lassen
          F.forEach(function (f) { o[f] = a[f]; });
          ext = Math.max(0, at - a.ts);
          var ex = Math.min(EXT_MAX, ext), v = Math.max(0, a.speed);
          if (T && T.at && ex > 0) {
            var A = T.at(a.prog), side = (a.x - A.x) * A.nx + (a.z - A.z) * A.nz, B = T.at(a.prog + v * ex);
            o.x = B.x + B.nx * side; o.z = B.z + B.nz * side; o.yaw = a.yaw + wrapAngle(B.yaw - A.yaw); o.prog = a.prog + v * ex;
          } else if (ex > 0) {
            ex = Math.min(0.5, ex);
            o.x += Math.cos(a.yaw) * v * ex; o.z -= Math.sin(a.yaw) * v * ex; o.prog += v * ex;
          }
        }
        // weicher Ausgleich: Ende des Weiterfahrens oder neuer Stand mitten drin → Versatz über SMOOTH s abbauen
        var w = vis[id];
        if (w && w.ext && (!ext || w.base !== a.ts)) {
          var cx = w.x - o.x, cz = w.z - o.z;
          if (cx * cx + cz * cz < 225) { w.cx = cx; w.cz = cz; w.cy = wrapAngle(w.yaw - o.yaw); w.cAt = at; }
          else w.cAt = null;
        }
        if (!w) w = vis[id] = { cAt: null };
        if (w.cAt != null) {
          var q = 1 - (at - w.cAt) / SMOOTH;
          if (q <= 0) w.cAt = null;
          else { q = Math.min(1, q); o.x += w.cx * q; o.z += w.cz * q; o.yaw += w.cy * q; }
        }
        w.ext = ext > 0; w.base = a.ts; w.x = o.x; w.z = o.z; w.yaw = o.yaw;
        o.ts = a.ts; o.lag = ext;
        return o;
      },
      ping: function () { return rttS == null ? null : { ms: Math.round(rttS * 1000), jitter: Math.round(jit * 1000) }; },
      peerPing: function (id) { var v = peer[id]; return v == null ? null : v; },
      lag: function (id) {
        var b = buf[id];
        return b && b.length ? Math.max(0, net.serverNow() - dly - b[b.length - 1].ts) : 0;
      },
      ids: function () { return Object.keys(buf); },
      forget: function (id) { delete buf[id]; delete jt[id]; delete vis[id]; },
      close: function () { closed = true; if (pingT) clearInterval(pingT); try { if (ws) ws.close(); } catch (e) { /* */ } },
      isOpen: function () { return open; }
    };
    function ping() { net.send({ t: 'ping', c: nowS(), pg: rttS != null ? Math.round(rttS * 1000) : undefined }); }
    function onMsg(ev) {
      var m;
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'pong' && typeof m.c === 'number') {
        var t = nowS(), rtt = t - m.c;
        if (rtt >= 0 && rtt <= bestRtt * 1.5 + 0.01) { if (rtt < bestRtt) bestRtt = rtt; offset = m.s - (m.c + rtt / 2); }
        if (rtt >= 0 && rtt < 10) {
          if (rttS == null) rttS = rtt;
          else { jit += (Math.abs(rtt - rttS) - jit) * 0.25; rttS += (rtt - rttS) * 0.25; }
        }
        return;
      }
      if (m.t === 'welcome' && typeof m.now === 'number' && bestRtt === Infinity) offset = m.now - nowS();
      if (m.t === 'S' && Array.isArray(m.d)) {
        var arr = net.serverNow(), live = !m.pg;     // mit pg = volle Liste (1 Hz), nicht für die Zitter-Messung
        m.d.forEach(function (r) {
          if (!Array.isArray(r) || r.length < 11) return;
          var id = String(r[0]), b = buf[id] || (buf[id] = []), ts = +r[1];
          if (b.length && b[b.length - 1].ts >= ts) return;      // unverändert
          var s = { ts: ts }, prev = b.length ? b[b.length - 1].ts : null;
          F.forEach(function (f, i) { s[f] = +r[i + 2] || 0; });
          b.push(s); if (b.length > KEEP) b.shift();
          if (!live) return;
          var j = jt[id] || (jt[id] = { L: [], gap: RATE, at: 0 });
          j.L.push(arr - ts); if (j.L.length > 60) j.L.shift();
          if (prev != null) j.gap += (Math.max(0, Math.min(0.5, ts - prev)) - j.gap) * 0.1;
          j.at = nowS();
        });
        if (m.pg && typeof m.pg === 'object') peer = m.pg;
      }
      if (m.t === 'phase' && m.phase === 'countdown') { buf = {}; jt = {}; vis = {}; }
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
        pingT = setInterval(ping, PING_EVERY);
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

  return { connect: connect, DELAY: DELAY, RATE: RATE, MIN_DELAY: MIN_DELAY, MAX_DELAY: MAX_DELAY, EXT_MAX: EXT_MAX };
});
