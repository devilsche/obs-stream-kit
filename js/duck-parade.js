/* Outfit-Parade (effects/duck-parade.html): alle Gummienten-Outfits watscheln als Laufband von rechts
 * nach links, jede mit Schild „Name · !outfit <name>“. Vorneweg ein Schild „Pick your duck“.
 *   einmal (!outfits): alle Outfits in t Sekunden, danach leer
 *   loop: endlos in gemischter Reihenfolge, nach jeder Runde wieder das Schild (BRB, Starting Soon)
 *
 *   DuckParade.start({ canvas, loop, t, size, speed, reduceMotion, freeze, ping })
 *   ping = URL, unter der sich die Parade meldet (/api/fx/ducks/parade, Begrüßungs-Enten weichen aus)
 *   size = Höhe der Ente in px, speed = px/s (nur loop; einmal ergibt sich das Tempo aus t)
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, DS = root.DuckStage, RD = root.RubberDuck;
  var U = 100, W = 19.2, H = 4;    // Leinwand 1920×400, 1 Einheit = 100 px

  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function start(opts) {
    var S = DS.create({ canvas: opts.canvas, volume: 0 });
    S.renderer.shadowMap.enabled = false;
    var cam = new THREE.OrthographicCamera(0, W, H, 0, -50, 50); cam.position.set(0, 0, 20);
    var size = Math.max(60, Math.min(260, opts.size || 110)), k = size / U / 2.15;
    var GAP = size * 1.55 / U, GROUND = 0.1;
    var list = RD.OUTFITS.filter(function (o) { return o !== 'none' && o.indexOf('court-') !== 0; });
    var order = opts.loop ? shuffle(list.slice()) : list.slice(), next = 0;
    // Tempo: einmal → alle Outfits plus Schild in t Sekunden über den ganzen Bildschirm
    var total = (order.length + 1) * GAP + W + 2 * GAP;
    var speed = opts.loop ? (opts.speed || 70) / U : total / Math.max(10, (opts.t || 60) - 0.5);
    var TPL = {}, TAGS = {}, items = [], head = W + GAP;   // head = x der nächsten Ente

    // Schild: Anzeigename groß, darunter „!outfit <name>“ in Gold
    function label(key) {
      if (TAGS[key]) return new THREE.Sprite(TAGS[key]);
      var info = RD.info(key) || { label: key }, w = 640, h = 200;
      var tex = S.canvasTex(w, h, function (x) {
        x.fillStyle = 'rgba(58, 22, 78, 0.92)'; S.roundRect(x, 6, 6, w - 12, h - 12, 44); x.fill();
        x.lineWidth = 6; x.strokeStyle = '#f2b705'; x.stroke();
        x.textAlign = 'center'; x.textBaseline = 'middle';
        fit(x, info.label, '700', 70, w - 70); x.fillStyle = '#ffffff'; x.fillText(info.label, w / 2, 70);
        fit(x, '!outfit ' + key, '600', 52, w - 70); x.fillStyle = '#f2b705'; x.fillText('!outfit ' + key, w / 2, 145);
      });
      TAGS[key] = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      return new THREE.Sprite(TAGS[key]);
    }
    function fit(x, text, weight, px, maxW) {
      x.font = weight + ' ' + px + 'px ' + S.FONT;
      var w = x.measureText(text).width;
      if (w > maxW) x.font = weight + ' ' + Math.floor(px * maxW / w) + 'px ' + S.FONT;
    }
    function sign() {
      var w = 900, h = 260;
      var tex = S.canvasTex(w, h, function (x) {
        x.fillStyle = '#5e2a79'; S.roundRect(x, 8, 8, w - 16, h - 16, 50); x.fill();
        x.lineWidth = 10; x.strokeStyle = '#f2b705'; x.stroke();
        x.textAlign = 'center'; x.textBaseline = 'middle';
        fit(x, 'Pick your duck', '800', 92, w - 90); x.fillStyle = '#ffffff'; x.fillText('Pick your duck', w / 2, 95);
        fit(x, 'type !outfit <name> in chat', '600', 58, w - 90); x.fillStyle = '#f2b705'; x.fillText('type !outfit <name> in chat', w / 2, 185);
      });
      var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      var sh = size * 0.62 / U; s.scale.set(sh * w / h, sh, 1);
      var g = new THREE.Group(); g.add(s); s.position.y = GROUND + size * 0.55 / U;
      return g;
    }
    function duck(key) {
      if (!TPL[key]) TPL[key] = RD.build({ outfit: key });
      var g = new THREE.Group(), inner = RD.clone ? RD.clone(TPL[key]) : TPL[key].clone();
      inner.position.y = 0.55; g.add(inner); g.userData.duck = inner;
      g.scale.setScalar(k); g.rotation.x = 0.18; S.face(g, -1, 0.45);
      var holder = new THREE.Group(); holder.add(g);
      var t = label(key), th = size * 0.36 / U; t.scale.set(th * 3.2, th, 1); t.position.y = GROUND + size * 1.42 / U;
      holder.add(t); holder.userData.d = g; holder.userData.ph = Math.random() * 6;
      return holder;
    }
    function spawn(obj) { obj.position.set(head, GROUND, 0); S.scene.add(obj); items.push(obj); head += GAP; }
    function drop(obj) {
      S.scene.remove(obj);
      obj.traverse(function (m) { if (m.isMesh && m.userData && m.userData.cape) m.geometry.dispose(); });
    }

    spawn(sign()); head += GAP * 0.35;
    function fill() {
      while (head < W + GAP * 2) {
        if (next >= order.length) {
          if (!opts.loop) { head = Infinity; return; }
          order = shuffle(list.slice()); next = 0;
          head += GAP * 0.35; spawn(sign()); head += GAP * 0.35;   // nach jeder Runde wieder das Schild
        }
        spawn(duck(order[next++]));
      }
    }

    var last = null, t = 0;
    function frame(ts) {
      var now = ts / 1000, dt = last == null ? 0 : Math.min(0.1, now - last); last = now;
      if (opts.freeze != null) { dt = 0; if (t === 0) { t = opts.freeze; for (var rem = t * speed; rem > 0; rem -= GAP / 2) step(Math.min(GAP / 2, rem)); } } else { t += dt; step(dt * speed); }
      items.forEach(function (o) {
        var d = o.userData.d;
        if (d && !opts.reduceMotion) S.waddle(d, t, 1, 10);
        if (d && RD.flutter) RD.flutter(d.userData.duck, t, 0.25, o.userData.ph);
      });
      S.renderer.render(S.scene, cam);
      if (opts.loop || items.length || opts.freeze != null) requestAnimationFrame(frame);
      else S.renderer.clear();
    }
    // Laufband um dx weiterschieben; Enten links draußen entfernen, rechts neue nachschieben
    function step(dx) {
      if (!dx) { fill(); return; }
      var rest = [];
      items.forEach(function (o) { o.position.x -= dx; if (o.position.x < -GAP) drop(o); else rest.push(o); });
      items = rest; if (head !== Infinity) head -= dx;
      fill();
    }
    // der Begrüßungs-Ente sagen, dass unten das Laufband läuft (sie landet dann darüber)
    function ping(sec) { if (opts.ping) fetch(opts.ping + '?sec=' + sec, { cache: 'no-store' }).catch(function () {}); }
    if (opts.freeze == null) {
      if (opts.loop) { ping(30); setInterval(function () { ping(30); }, 20000); }
      else ping(Math.ceil(opts.t || 60));
    }
    fill();
    requestAnimationFrame(frame);
  }

  root.DuckParade = { start: start };
})(typeof window !== 'undefined' ? window : this);
