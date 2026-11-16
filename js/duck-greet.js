/* Begrüßungs-Ente (effects/duck-greet.html): wer sich mit !outfit ein Outfit ausgesucht hat, bekommt bei
 * der ersten Chat-Nachricht im Stream eine kleine Ente in diesem Outfit. Sie fällt unten herein,
 * federt, nickt mit Namensschild, quakt und watschelt zum nächsten Rand hinaus (~4,4 s).
 * Bis zu drei gleichzeitig nebeneinander, der Rest wartet; bei langer Schlange geht es schneller.
 * Befehle kommen per Poll von /api/fx/duckgreet/poll (Server: /api/fx/ducks/greet).
 *
 *   DuckGreet.start({ canvas, x, size, volume, reduceMotion, poll, test, freeze })
 *   x = Mitte der ersten Ente in px, size = Höhe der Ente in px
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, DS = root.DuckStage;
  var U = 100;          // 1 Welt-Einheit = 100 px (Orthokamera über dem ganzen Bild)
  var DUR = 4.4, SLOTS = 3;
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

  function start(opts) {
    var S = DS.create({ canvas: opts.canvas, volume: opts.volume });
    S.renderer.shadowMap.enabled = false;
    var cam = new THREE.OrthographicCamera(0, 19.2, 10.8, 0, -50, 50); cam.position.set(0, 0, 20);
    var size = Math.max(80, Math.min(400, opts.size || 180)), k = size / U / 2.15;
    var x0 = (opts.x != null ? opts.x : 220) / U, dir = x0 * U > 960 ? -1 : 1;
    var GAP = size * 1.25 / U, GROUND = 0.12;
    var queue = [], live = [], slotsUsed = [], running = false, last = null;

    function add(name, outfit) {
      if (!name || !outfit) return;
      queue.push({ name: String(name).slice(0, 25), outfit: outfit });
      kick();
    }
    function begin(item, slot, now) {
      var g = new THREE.Group(), d = S.duck(item.outfit);
      d.scale.setScalar(k); d.rotation.x = 0.22; g.add(d);
      var tag = S.tag(item.name, { size: Math.max(0.5, size / 220) }); tag.position.set(0, k * 2.9, 0); g.add(tag);
      var x = x0 + dir * slot * GAP, out = x * U < 960 ? -1 : 1;
      g.position.set(x, 13, 0); S.scene.add(g);
      var speed = queue.length > 4 ? 1.5 : 1;
      live.push({ g: g, d: d, tag: tag, slot: slot, t0: now, x: x, out: out, speed: speed, q: [false, false] });
      slotsUsed[slot] = true;
    }
    function freeSlot() { for (var i = 0; i < SLOTS; i++) if (!slotsUsed[i]) return i; return -1; }

    // Ablauf einer Ente bei Sekunde t (ohne Zeitraffer)
    function pose(e, t) {
      var g = e.g, d = e.d, inner = d.userData.duck;
      var fall = clamp01(t / 0.55), y;
      if (opts.reduceMotion) {
        var sc = Math.min(ease(t / 0.3), 1 - ease((t - DUR + 0.4) / 0.4));
        g.scale.setScalar(Math.max(0.001, sc)); g.position.set(e.x, GROUND, 0); S.face(d, 0.25 * -e.out, 1);
        S.talk(d, t > 1.1 && t < 1.35 ? 1 : 0);
        return;
      }
      if (t < 0.55) y = GROUND + 13 * (1 - fall * fall);
      else y = GROUND + Math.max(0, Math.sin(clamp01((t - 0.55) / 0.35) * Math.PI) * 0.35 * (1 - clamp01((t - 0.55) / 0.5)));
      // Landung: kurz breit gedrückt
      var sq = t > 0.5 && t < 0.85 ? Math.sin((t - 0.5) / 0.35 * Math.PI) * 0.16 : 0;
      d.scale.set(k * (1 + sq), k * (1 - sq), k * (1 + sq));
      var walk = clamp01((t - 2.9) / (DUR - 2.9)), xOff = walk * walk * 9.5 * e.out;
      g.position.set(e.x + xOff, y, 0);
      // schaut in die Kamera, zum Gehen dreht sie sich zum Rand
      var turn = ease((t - 2.7) / 0.35);
      S.face(d, (0.25 * -e.out) * (1 - turn) + e.out * turn, 1 - turn * 0.85);
      // Nicken (zweimal) und Quaken
      var nod = t > 1.0 && t < 2.5 ? Math.max(0, Math.sin((t - 1.0) / 0.75 * Math.PI * 2)) : 0;
      if (inner) inner.rotation.z = -nod * 0.22;
      S.talk(d, (t > 1.15 && t < 1.4) || (t > 1.9 && t < 2.15) ? 1 : 0);
      if (t > 2.9) S.waddle(d, t, 1, 13);
    }

    function frame(ts) {
      var now = ts / 1000, dt = last == null ? 0 : Math.min(0.1, now - last); last = now;
      if (opts.freeze == null) {
        for (var s; queue.length && (s = freeSlot()) >= 0;) begin(queue.shift(), s, now);
      }
      live = live.filter(function (e) {
        var t = opts.freeze != null ? opts.freeze : (now - e.t0) * e.speed;
        if (!opts.reduceMotion && opts.freeze == null) {
          if (!e.q[0] && t > 1.15) { e.q[0] = true; S.sfx.quack && S.sfx.quack(1.25 + Math.random() * 0.2); }
          if (!e.q[1] && t > 1.9) { e.q[1] = true; S.sfx.quack && S.sfx.quack(1.4 + Math.random() * 0.2); }
        }
        pose(e, t);
        if (opts.freeze == null && t > DUR) {
          S.scene.remove(e.g); e.tag.material.map.dispose(); e.tag.material.dispose();
          slotsUsed[e.slot] = false;
          return false;
        }
        return true;
      });
      S.renderer.render(S.scene, cam);
      if (live.length || queue.length || opts.freeze != null) requestAnimationFrame(frame);
      else { running = false; last = null; S.renderer.clear(); }
    }
    function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }

    // Test: ?test=Name:outfit,Name2:outfit2
    (opts.test || []).forEach(function (p) { add(p[0], p[1]); });
    if (opts.freeze != null) { queue.forEach(function (it, i) { if (i < SLOTS) begin(it, i, 0); }); queue = []; kick(); }

    // Poll
    if (opts.poll) {
      var since = null, epoch = null;
      var tick = function () {
        fetch(opts.poll + (since != null ? '?since=' + since : ''), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (!j) return;
            if (epoch !== null && j.epoch !== epoch) since = null;
            epoch = j.epoch;
            if (since != null) (j.commands || []).forEach(function (c) { if (c.cmd === 'greet' && c.params) add(c.params.name, c.params.outfit); });
            since = j.seq;
          })
          .catch(function () {})
          .then(function () { setTimeout(tick, 2000); });
      };
      tick();
    }
    return { add: add };
  }

  root.DuckGreet = { start: start };
})(typeof window !== 'undefined' ? window : this);
