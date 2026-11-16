/* Enten-Gericht (effects/duck-court.html), Vollbild ~15 s:
 * Gerichtssaal (Holz, Richterpult, Schild „DUCK COURT“) → die Richter-Ente schlägt dreimal mit dem Hammer
 * („Order in the court!“) → Urteil („<Name>: Guilty!“), rotes Licht unter der Verurteilten, sie zittert,
 * Gemurmel → Pfiff, zwei Polizei-Enten watscheln herein, nehmen sie in die Mitte und führen sie ab;
 * die anderen Angeklagten schauen hinterher → „Next!“, Hammerschlag.
 *
 *   DuckCourt.start({ canvas, names, guilty, verdict, judge, outfit, volume, freeze })
 *   names: Angeklagte (Chat), guilty: Nummer (1 = erster) oder Name, sonst zufällig
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, DS = root.DuckStage, RD = root.RubberDuck;
  var ease = DS.ease, lerp = DS.lerp, clamp01 = DS.clamp01;

  function start(opts) {
    var S = DS.create({ canvas: opts.canvas, volume: opts.volume, fov: 36 }), scene = S.scene, cam = S.cam;
    var CAM = new THREE.Vector3(0, 4.4, 12.2), LOOK = new THREE.Vector3(0, 2.5, -4);
    var TOTAL = 15;

    // ── Saal ──
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ map: S.wood(5, 3, 0x5a3820, 12), roughness: 0.65 }));
    floor.rotation.x = -Math.PI / 2; floor.position.z = -2; floor.receiveShadow = true; scene.add(floor);
    var panel = S.canvasTex(512, 512, function (x, w, h) {
      x.fillStyle = '#4a2c16'; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
        var X = 24 + i * 244, Y = 24 + j * 244;
        x.fillStyle = '#5e391d'; x.fillRect(X, Y, 220, 220); x.strokeStyle = '#2e1a0b'; x.lineWidth = 8; x.strokeRect(X + 14, Y + 14, 192, 192);
        x.strokeStyle = 'rgba(255,220,170,0.12)'; x.lineWidth = 3; x.strokeRect(X + 20, Y + 20, 180, 180);
      }
    });
    panel.wrapS = panel.wrapT = THREE.RepeatWrapping; panel.repeat.set(8, 3);
    var wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 22), new THREE.MeshStandardMaterial({ map: panel, roughness: 0.8 }));
    wall.position.set(0, 10, -11); wall.receiveShadow = true; scene.add(wall);
    // Schild über dem Richter: Waage und „DUCK COURT“
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.6), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2, map: S.canvasTex(1200, 350, function (x, w, h) {
      x.fillStyle = '#2a1408'; S.roundRect(x, 0, 0, w, h, 30); x.fill();
      x.strokeStyle = '#d9b23a'; x.lineWidth = 12; S.roundRect(x, 14, 14, w - 28, h - 28, 22); x.stroke();
      x.fillStyle = '#d9b23a'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '800 150px ' + S.FONT; x.font = '800 128px ' + S.FONT; x.fillText('DUCK COURT', w / 2 + 120, h / 2 + 6);
      // Waage
      var cx = 150, cy = 175; x.strokeStyle = '#d9b23a'; x.lineWidth = 9; x.beginPath(); x.moveTo(cx, cy - 95); x.lineTo(cx, cy + 90); x.moveTo(cx - 75, cy - 60); x.lineTo(cx + 75, cy - 60); x.moveTo(cx - 60, cy + 90); x.lineTo(cx + 60, cy + 90); x.stroke();
      [-1, 1].forEach(function (s) { x.beginPath(); x.moveTo(cx + s * 75, cy - 60); x.lineTo(cx + s * 50, cy + 10); x.moveTo(cx + s * 75, cy - 60); x.lineTo(cx + s * 100, cy + 10); x.stroke(); x.beginPath(); x.arc(cx + s * 75, cy + 10, 26, 0, Math.PI); x.fill(); });
    }) }));
    sign.position.set(0, 7.6, -10.9); scene.add(sign);
    // Richterpult mit goldener Leiste, Podest dahinter
    var dark = new THREE.MeshStandardMaterial({ map: S.wood(2, 1, 0x3a2210, 5), roughness: 0.55 });
    var bench = new THREE.Mesh(new THREE.BoxGeometry(8, 2.7, 1.8), dark); bench.position.set(0, 1.35, -6); bench.castShadow = bench.receiveShadow = true; scene.add(bench);
    var trim = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.16, 2), new THREE.MeshStandardMaterial({ color: 0xd9b23a, metalness: 0.7, roughness: 0.3 })); trim.position.set(0, 2.72, -6); scene.add(trim);
    var dais = new THREE.Mesh(new THREE.BoxGeometry(8, 1.9, 3), dark); dais.position.set(0, 0.95, -8.4); scene.add(dais);
    // Anklagebank: Lehne hinter den Angeklagten
    var dockBack = new THREE.Mesh(new THREE.BoxGeometry(12, 1.3, 0.35), dark); dockBack.position.set(0, 0.65, -2.4); dockBack.castShadow = true; scene.add(dockBack);
    var dockRail = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.14, 0.45), trim.material); dockRail.position.set(0, 1.35, -2.4); scene.add(dockRail);

    // ── Richter-Ente mit Hammer auf dem Pult ──
    RD.addOutfits({ 'court-judge': { label: 'Judge', cat: 'jobs', suit: 0x141418, collar: 0.62, acc: [['judgewig'], ['bowtie', { color: 0xfafafa }]] } });
    var judge = S.duck('court-judge'); judge.position.set(0, 1.75, -7.2); judge.scale.setScalar(1.3); S.face(judge, 0, 1); scene.add(judge);
    if (opts.judge) { var jt = S.tag('Judge ' + opts.judge, { size: 0.85 }); jt.position.set(0, 2.72, 0); judge.add(jt); }
    var bubbleJ = {};
    function say(key, text) { var b = S.bubble(text, { size: 2.1 }); b.position.set(1.5, 4.75, -6.2); b.visible = false; scene.add(b); bubbleJ[key] = b; }
    var gavel = new THREE.Group(); gavel.position.set(2.6, 2.86, -5.6); scene.add(gavel);
    var gw = new THREE.MeshStandardMaterial({ color: 0x6b3f1f, roughness: 0.45 });
    var gh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 12), gw); gh.rotation.z = Math.PI / 2; gh.position.x = -0.45; gavel.add(gh);
    var gk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.42, 24), gw); gk.position.x = -0.9; gavel.add(gk);
    gavel.traverse(function (m) { if (m.isMesh) m.castShadow = true; });
    var block = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.1, 32), gw); block.position.set(1.7, 2.85, -5.6); scene.add(block);

    // ── Angeklagte ──
    var names = opts.names || [], n = Math.max(3, Math.min(5, names.length || 3));
    var gi = -1;
    if (opts.guilty != null && opts.guilty !== '') {
      var gn = parseInt(opts.guilty, 10);
      if (isFinite(gn) && String(gn) === String(opts.guilty).trim()) gi = gn - 1;
      else names.forEach(function (nm, i) { if (nm.toLowerCase() === String(opts.guilty).replace(/^@/, '').toLowerCase()) gi = i; });
    }
    if (gi < 0 || gi >= n) gi = Math.floor(Math.random() * Math.min(n, names.length || n));
    var defs = [];
    for (var k = 0; k < n; k++) {
      var d = S.duck(opts.outfit || 'mix', names[k]), x0 = lerp(-4.6, 4.6, n > 1 ? k / (n - 1) : 0.5);
      d.position.set(x0, 0, -0.9); S.face(d, 0.35, 1); d.userData.ph = k * 1.3; d.userData.home = d.position.clone();
      if (names[k]) { var tg = S.tag(names[k], { size: 0.95 }); tg.position.set(0, 2.85 + (k % 2) * 0.5, 0); d.add(tg); }
      scene.add(d); defs.push(d);
    }
    var G = defs[gi], gName = names[gi] || '';
    say('order', 'Order in the court!');
    say('verdict', (gName ? gName + ': ' : '') + (opts.verdict || 'Guilty!'));
    say('next', 'Next!');
    // rotes Licht unter der Verurteilten
    var spot = new THREE.Mesh(new THREE.RingGeometry(0.2, 1.6, 48), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false }));
    spot.rotation.x = -Math.PI / 2; spot.position.set(G.position.x, 0.02, G.position.z); scene.add(spot);

    // ── Polizei ──
    var cops = [-1, 1].map(function (s, i) {
      var c = S.duck('police'); c.userData.ph = 2 + i; c.position.set(18 + i * 1.6, 0, 0.6); scene.add(c);
      c.userData.side = s; return c;
    });

    // Weg durch Punkte (gleich lange Abschnitte nach Länge), liefert Lage und Laufrichtung
    function path(pts, u) {
      var L = [], tot = 0;
      for (var i = 1; i < pts.length; i++) { var l = pts[i].distanceTo(pts[i - 1]); L.push(l); tot += l; }
      var d = clamp01(u) * tot;
      for (i = 0; i < L.length; i++) { if (d <= L[i] || i === L.length - 1) { var f = L[i] ? Math.min(1, d / L[i]) : 1; return { p: pts[i].clone().lerp(pts[i + 1], f), dir: pts[i + 1].clone().sub(pts[i]) }; } d -= L[i]; }
    }
    // Abstände: eine Ente ist ~2,4 lang und ~1,7 breit. Polizei kommt auf eigenen Spuren vor der Bank,
    // stellt sich vor die Verurteilte; abgeführt wird als Kolonne (Abstand 2,8) auf der Spur EXIT_Z
    var LANE_IN = [2.4, 4.3], EXIT_Z = 3.0, GAP = 2.8, FORM = 1.0;
    function abfuehren(obj, start, form, t) {
      var p1 = clamp01((t - OUT[0]) / FORM), p2 = clamp01((t - OUT[0] - FORM) / (OUT[1] - OUT[0] - FORM));
      if (p2 > 0) { obj.position.set(form.x + 22 * p2, 0, form.z); S.face(obj, 1, 0); S.waddle(obj, t, 1); }
      else { obj.position.lerpVectors(start, form, ease(p1)); if (p1 < 1) S.face(obj, form.x - start.x, form.z - start.z); S.waddle(obj, t, p1 < 1 ? 1 : 0); }
    }
    function walk(obj, pts, u, t) {
      var w = path(pts, u); obj.position.copy(w.p);
      if (u > 0 && u < 1) { S.face(obj, w.dir.x, w.dir.z); S.waddle(obj, t, 1); } else S.waddle(obj, t, 0);
    }

    // ── Ablauf ──
    var HITS = [1.4, 1.75, 2.1, 3.3, 12.5], IN = [5.8, 8.2], OUT = [8.7, 12.4];
    var cues = HITS.map(function (h) { return [h, S.sfx.gavel]; });
    cues.push([3.55, function () { S.sfx.murmur(2.8); }], [3.6, function () { S.sfx.quack(0.7); S.sfx.quack(0.65, 0.3); }],
      [5.7, S.sfx.whistle], [8.75, function () { S.sfx.quack(0.6); }], [9.6, function () { S.sfx.quack(0.55); }]);
    function swing(t) {                          // Hammer: kurz anheben, zuschlagen
      var a = 0;
      HITS.forEach(function (h) {
        if (t > h - 0.32 && t < h) a = Math.max(a, t < h - 0.1 ? ease((t - h + 0.32) / 0.22) : 1 - Math.pow((t - h + 0.1) / 0.1, 2));
      });
      return a;
    }
    function shake(t) { var s = 0; HITS.forEach(function (h) { if (t >= h) s += Math.exp(-(t - h) * 14); }); return Math.min(1, s); }
    S.run(TOTAL, function (t) {
      var sh = shake(t) * 0.09;
      cam.position.set(CAM.x + Math.sin(t * 90) * sh, CAM.y + Math.cos(t * 77) * sh, CAM.z); cam.lookAt(LOOK);
      gavel.rotation.z = -1.0 * swing(t);
      judge.userData.duck.rotation.z = -0.08 * swing(t);
      bubbleJ.order.visible = t > 1.2 && t < 3.0;
      bubbleJ.verdict.visible = t > 3.3 && t < 6.2;
      bubbleJ.next.visible = t > 12.3 && t < 14.4;
      var talking = bubbleJ.order.visible || bubbleJ.verdict.visible || bubbleJ.next.visible;
      S.talk(judge, talking ? Math.abs(Math.sin(t * 9)) : 0);
      // Urteil: Licht pulsiert, die Verurteilte zittert
      var lit = t > 3.35 && t < OUT[0] + 0.6 ? 0.5 + 0.25 * Math.sin(t * 8) : 0;
      spot.material.opacity = lit * clamp01((t - 3.35) / 0.3);
      spot.position.set(G.position.x, 0.02, G.position.z);
      // Polizei herein (vor der Bank entlang), stellt sich schräg vor die Verurteilte; dann alle hinaus nach rechts
      var H0 = G.userData.home, out = t > OUT[0];
      cops.forEach(function (c, i) {
        var slot = new THREE.Vector3(H0.x + c.userData.side * 1.6, 0, H0.z + 2.4);
        var w = clamp01((t - IN[0] - i * 0.3) / (IN[1] - IN[0]));
        if (out) abfuehren(c, slot, new THREE.Vector3(H0.x + c.userData.side * GAP, 0, EXIT_Z), t);
        else {
          walk(c, [new THREE.Vector3(18 + i * 1.6, 0, LANE_IN[i]), new THREE.Vector3(slot.x, 0, LANE_IN[i]), slot], ease(w), t);
          if (w >= 1) S.face(c, -c.userData.side, -0.4);
        }
      });
      // Abführen
      defs.forEach(function (d, i) {
        var dd = d.userData.duck;
        if (d === G) {
          if (out) { abfuehren(d, H0, new THREE.Vector3(H0.x, 0, EXIT_Z), t); dd.rotation.z = -0.12; }
          else { d.position.copy(d.userData.home); var tr = t > 3.4 && t < OUT[0] ? 0.05 : 0; dd.rotation.x = Math.sin(t * 60) * tr; dd.position.y = 0.55; dd.rotation.z = t > 3.4 ? -0.1 : 0; }
        } else {
          // schauen hinterher (drehen sich nach rechts)
          var look = ease((t - OUT[0] - 0.4) / 1.2) * (1 - ease((t - 13.2) / 0.8));
          d.rotation.y = lerp(Math.atan2(-1, 0.35), Math.atan2(-0.4, 1), look);
          dd.rotation.z = t > 3.35 && t < 4.2 ? -0.08 : 0;
        }
      });
    }, { freeze: opts.freeze, cues: cues });
  }

  root.DuckCourt = { start: start };
})(typeof window !== 'undefined' ? window : this);
