/* Enten-Versammlung (effects/duck-assembly.html), Vollbild ~12 s:
 * Saal mit Banner „Duck assembly – called by <Name>“ → die Enten (Namen aus dem Chat) watscheln von
 * links und rechts herein und stellen sich im Bogen um das Podest auf → die Anführer-Ente springt aufs
 * Podest, Fanfare → sie hält eine Rede (Sprechblase, Schnabel klappt, Quaken), alle nicken → Jubel
 * (alle hüpfen, quaken) → alle watscheln wieder hinaus.
 *
 *   DuckAssembly.start({ canvas, by, names, count, outfit, leader, text, volume, freeze })
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, DS = root.DuckStage;
  var ease = DS.ease, lerp = DS.lerp, clamp01 = DS.clamp01;

  function start(opts) {
    var S = DS.create({ canvas: opts.canvas, volume: opts.volume, fov: 36 }), scene = S.scene, cam = S.cam;
    cam.position.set(0, 4.6, 12.5); cam.lookAt(0, 2.4, -4);
    var TOTAL = 12.5;

    // ── Saal: Holzboden, Rückwand mit Banner, Wimpelkette, Podest ──
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ map: S.wood(6, 4, 0x8a5a32, 10), roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2; floor.position.z = -6; floor.receiveShadow = true; scene.add(floor);
    var wallTex = S.canvasTex(512, 256, function (x, w, h) {
      var g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a1438'); g.addColorStop(1, '#5e2a79'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(255,255,255,0.05)'; for (var i = 0; i < 16; i++) x.fillRect(i * 32, 0, 14, h);
    });
    var wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 22), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }));
    wall.position.set(0, 10, -13); wall.receiveShadow = true; scene.add(wall);
    var by = opts.by ? String(opts.by).slice(0, 25) : '';
    var banner = new THREE.Mesh(new THREE.PlaneGeometry(14, by ? 3.6 : 2.8), new THREE.MeshStandardMaterial({ roughness: 0.6, map: S.canvasTex(1400, by ? 360 : 280, function (x, w, h) {
      x.fillStyle = '#f2b705'; S.roundRect(x, 0, 0, w, h, 40); x.fill();
      x.fillStyle = '#5e2a79'; S.roundRect(x, 14, 14, w - 28, h - 28, 30); x.fill();
      x.fillStyle = '#f2b705'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '800 150px ' + S.FONT; x.fillText('DUCK ASSEMBLY', w / 2, by ? 130 : h / 2 + 6);
      if (by) { x.fillStyle = '#ffffff'; x.font = '600 72px ' + S.FONT; x.fillText('called by ' + by, w / 2, 270); }
    }) }));
    banner.position.set(0, 7.3, -12.9); scene.add(banner);
    // Wimpel
    var cols = [0xf2b705, 0x8a4dad, 0xe6312e, 0x3fb04a, 0x2f7fd0];
    for (var i = 0; i < 26; i++) {
      var u = i / 25, px = lerp(-18, 18, u), py = 10.6 - Math.sin(u * Math.PI * 3) * 0.15 - Math.sin(u * Math.PI) * 0.9;
      var f = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 3), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.7 }));
      f.position.set(px, py - 0.55, -12.7); f.rotation.z = Math.PI; scene.add(f);
    }
    // Podest
    var PODIUM = new THREE.Vector3(0, 0, -1.6);
    var pod = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.9, 48), new THREE.MeshStandardMaterial({ map: S.wood(2, 1, 0x5a3a22, 4), roughness: 0.6 }));
    pod.position.set(PODIUM.x, 0.45, PODIUM.z); pod.castShadow = pod.receiveShadow = true; scene.add(pod);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.07, 10, 64), new THREE.MeshStandardMaterial({ color: 0xf2b705, metalness: 0.7, roughness: 0.3 }));
    rim.rotation.x = Math.PI / 2; rim.position.set(PODIUM.x, 0.88, PODIUM.z); scene.add(rim);

    // ── Anführer-Ente (der Einberufer) ──
    var leader = S.duck(opts.leader || 'king'); S.face(leader, 0.25, 1); scene.add(leader);
    if (by) { var lt = S.tag(by, { size: 1.15 }); lt.position.set(0, 3.0, 0); leader.add(lt); }
    var speech = S.bubble(opts.text || 'Quack! Order, order! Welcome, everyone!', { size: 2.6 });
    speech.position.set(0.6, 3.6, 0.2); speech.visible = false; leader.add(speech);

    // ── Teilnehmer: Plätze im Bogen hinter und neben dem Podest, Blick zum Podest ──
    var names = opts.names || [], n = Math.max(names.length, Math.min(16, Math.max(3, opts.count || 10)));
    n = Math.min(n, 16);
    var rows = n > 10 ? 2 : 1, ducks = [];
    for (var k = 0; k < n; k++) {
      var row = rows === 2 && k >= Math.ceil(n / 2) ? 1 : 0, inRow = rows === 2 ? (row ? n - Math.ceil(n / 2) : Math.ceil(n / 2)) : n;
      var idx = row ? k - Math.ceil(n / 2) : k, R = row ? 8.6 : 6.6, span = row ? 150 : 170;
      // Mitte hinter dem Podest frei lassen (dort würde die Anführer-Ente sie verdecken)
      var gap = row ? 18 : 24, ua = inRow > 1 ? idx / (inRow - 1) : 0.5, half = span / 2 - gap;
      var a = (ua < 0.5 ? -gap - (0.5 - ua) * 2 * half : gap + (ua - 0.5) * 2 * half) * Math.PI / 180;
      var slot = new THREE.Vector3(PODIUM.x + Math.sin(a) * R * 1.1, 0, PODIUM.z - 1.2 - Math.cos(a) * R * 0.5 + (row ? -1.4 : 0));
      var d = S.duck(opts.outfit || 'mix'); d.userData.ph = k * 1.7;
      var side = slot.x < 0 ? -1 : 1, from = new THREE.Vector3(side * 26, 0, slot.z + 2);
      d.userData.slot = slot; d.userData.from = from; d.userData.t0 = 0.6 + (Math.abs(slot.x) < 3 ? 1.2 : 0) + (k % 5) * 0.18 + row * 0.3;
      d.position.copy(from); scene.add(d);
      if (names[k]) { var tg = S.tag(names[k], { size: 0.95 }); tg.position.set(0, 2.85 + (k % 2) * 0.55, 0); d.add(tg); }
      ducks.push(d);
    }

    // ── Ablauf ──
    var WALK = 2.6, SPEAK = [4.6, 7.4], CHEER = [7.6, 9.2], OUT = 9.3;
    var cues = [[1.1, S.sfx.fanfare]];
    [4.75, 5.35, 6.0, 6.7].forEach(function (tq, i) { cues.push([tq, function () { S.sfx.quack(0.85 + i * 0.05); }]); });
    for (var c = 0; c < 8; c++) (function (c) { cues.push([CHEER[0] + 0.15 + c * 0.17, function () { S.sfx.quack(0.9 + Math.random() * 0.6); }]); })(c);
    S.run(TOTAL, function (t) {
      // Anführer: springt bei 0.9 aufs Podest
      var j = clamp01((t - 0.9) / 0.5), hop = Math.sin(j * Math.PI) * 1.6;
      leader.position.set(PODIUM.x + lerp(-3.2, 0, ease(j)), (j > 0.95 ? 0.9 : ease(j) * 0.9) + hop, PODIUM.z + lerp(1.5, 0, ease(j)));
      leader.visible = t > 0.75;
      // Rede: Schnabel klappt, Blase sichtbar, leichtes Gestikulieren
      var speaking = t > SPEAK[0] && t < SPEAK[1];
      speech.visible = speaking;
      S.talk(leader, speaking ? Math.abs(Math.sin((t - SPEAK[0]) * 9)) : 0);
      leader.userData.duck.rotation.z = speaking ? Math.sin(t * 3) * 0.06 : 0;
      // Jubel des Anführers am Ende
      if (t > CHEER[0] && t < CHEER[1]) leader.userData.duck.position.y = 0.55 + Math.abs(Math.sin((t - CHEER[0]) * 8)) * 0.35;
      ducks.forEach(function (d, i) {
        var s = d.userData.slot, f = d.userData.from, w = clamp01((t - d.userData.t0) / WALK), o = clamp01((t - OUT - (i % 4) * 0.12) / 2.6);
        var dd = d.userData.duck;
        if (o > 0) {                             // hinaus, zur eigenen Seite
          var to = new THREE.Vector3(Math.sign(s.x || 1) * 26, 0, s.z + 1);
          d.position.lerpVectors(s, to, ease(o)); S.face(d, to.x - s.x, to.z - s.z); S.waddle(d, t, 1);
        } else if (w < 1) {                      // herein
          d.position.lerpVectors(f, s, w); S.face(d, s.x - f.x, s.z - f.z); S.waddle(d, t, w > 0 ? 1 : 0);
        } else {                                 // am Platz: zum Podest, nicken bzw. jubeln
          d.position.copy(s); S.face(d, PODIUM.x - s.x, PODIUM.z - s.z);
          var nod = speaking ? Math.max(0, Math.sin((t - SPEAK[0]) * 5 + i)) * 0.18 : 0;
          dd.rotation.x = 0; dd.rotation.z = -nod;
          dd.position.y = 0.55 + (t > CHEER[0] && t < CHEER[1] ? Math.abs(Math.sin((t - CHEER[0]) * 7 + i * 0.7)) * 0.45 : 0);
        }
      });
    }, { freeze: opts.freeze, cues: cues });
  }

  root.DuckAssembly = { start: start };
})(typeof window !== 'undefined' ? window : this);
