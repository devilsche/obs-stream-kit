/* Enten-Versammlung (effects/duck-assembly.html), Vollbild. Lila Saal mit Banner „DUCK ASSEMBLY –
 * called by <Name>“, Podest mit der Anführer-Ente (wer einberufen hat), dazu je nach mode:
 *   speech  (~12,5 s) Enten kommen, Rede in der Sprechblase, alle nicken, Jubel, alle gehen
 *   vote    (~16 s)   Abstimmung: Frage in der Sprechblase, jede Stimme (Chat-Name) watschelt auf die
 *                     Seite ihrer Antwort, Auszählung, Ergebnis-Plakette, Konfetti über den Gewinnern
 *   king    (~13 s)   Wahl zum Enten-König: Scheinwerfer sucht (Trommelwirbel), Krone schwebt auf eine Ente
 *   mutiny  (~13 s)   Meuterei: Rede, Buhrufe, Tomaten fliegen, die Anführerin flieht, alle hinterher
 *   conga   (~14 s)   Polonaise um das Podest, Disco-Kugel, Lichtflecken, Musik
 *   photo   (~13 s)   Gruppenfoto: „Say quack!“, Blitz, das Bild friert als Polaroid ein
 *
 *   DuckAssembly.start({ canvas, mode, by, names, count, outfit, leader, text, q, a, b, yes, no, volume, freeze })
 *   DuckAssembly.DURATION[mode] = Dauer in s (für Streamer.bot)
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, DS = root.DuckStage;
  var ease = DS.ease, lerp = DS.lerp, clamp01 = DS.clamp01;
  var DURATION = { speech: 12.5, vote: 16, king: 13, mutiny: 13, conga: 14, photo: 13 };
  var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };

  // Antworten aus der Frage: „Pizza oder Döner?“ → Pizza / Döner; sonst Yes / No
  function answers(q) {
    var t = String(q || '').replace(/[?!.]+\s*$/, '').trim(), m = t.split(/\s+(?:oder|or|vs\.?|versus)\s+|\s*\/\s*/i);
    if (m.length !== 2) return ['Yes', 'No'];
    var a = m[0].split(/[,:]/).pop().trim(), b = m[1].trim();
    if (a.length > 18) a = a.split(/\s+/).pop();
    if (b.length > 18) b = b.split(/\s+/)[0];
    return a && b ? [a, b] : ['Yes', 'No'];
  }

  function start(opts) {
    var mode = DURATION[opts.mode] ? opts.mode : 'speech';
    var S = DS.create({ canvas: opts.canvas, volume: opts.volume, fov: 36 }), scene = S.scene, cam = S.cam;
    cam.position.set(0, 4.6, 12.5); cam.lookAt(0, 2.4, -4);
    scene.add(cam);
    var TOTAL = DURATION[mode];

    // ── Saal ──
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
    var cols = [0xf2b705, 0x8a4dad, 0xe6312e, 0x3fb04a, 0x2f7fd0];
    for (var i = 0; i < 26; i++) {
      var u = i / 25, f = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 3), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.7 }));
      f.position.set(lerp(-18, 18, u), 10.05 - Math.sin(u * Math.PI * 3) * 0.15 - Math.sin(u * Math.PI) * 0.9, -12.7); f.rotation.z = Math.PI; scene.add(f);
    }
    var PODIUM = V(0, 0, -1.6);
    var pod = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.9, 48), new THREE.MeshStandardMaterial({ map: S.wood(2, 1, 0x5a3a22, 4), roughness: 0.6 }));
    pod.position.set(PODIUM.x, 0.45, PODIUM.z); pod.castShadow = pod.receiveShadow = true; scene.add(pod);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.07, 10, 64), new THREE.MeshStandardMaterial({ color: 0xf2b705, metalness: 0.7, roughness: 0.3 }));
    rim.rotation.x = Math.PI / 2; rim.position.set(PODIUM.x, 0.88, PODIUM.z); scene.add(rim);

    // ── Anführer-Ente ──
    var leader = S.duck(opts.leader || 'king'); S.face(leader, 0.25, 1); scene.add(leader);
    if (by) { var lt = S.tag(by, { size: 1.15 }); lt.position.set(0, 3.0, 0); leader.add(lt); }
    function leaderBubble(text) { var b = S.bubble(text, { size: 2.6 }); b.position.set(0.6, 3.6, 0.2); b.visible = false; leader.add(b); return b; }
    // springt bei 0.9 aufs Podest
    function leaderIn(t) {
      var j = clamp01((t - 0.9) / 0.5), hop = Math.sin(j * Math.PI) * 1.6;
      leader.position.set(PODIUM.x + lerp(-3.2, 0, ease(j)), (j > 0.95 ? 0.9 : ease(j) * 0.9) + hop, PODIUM.z + lerp(1.5, 0, ease(j)));
      leader.visible = t > 0.75;
    }
    function speak(b, t, t0, t1) {
      var on = t > t0 && t < t1; b.visible = on;
      S.talk(leader, on ? Math.abs(Math.sin((t - t0) * 9)) : 0);
      leader.userData.duck.rotation.z = on ? Math.sin(t * 3) * 0.06 : 0;
      return on;
    }

    // ── Teilnehmer ──
    function crowd(n, names, outfit) {
      var list = [];
      for (var k = 0; k < n; k++) {
        var d = S.duck(outfit || 'mix'); d.userData.ph = k * 1.7; d.userData.name = names[k] || '';
        if (names[k]) { var tg = S.tag(names[k], { size: 0.95 }); tg.position.set(0, 2.85 + (k % 2) * 0.55, 0); d.add(tg); }
        scene.add(d); list.push(d);
      }
      return list;
    }
    // Plätze im Bogen hinter und neben dem Podest (Mitte frei), Blick zum Podest
    function arcSlots(n) {
      var rows = n > 10 ? 2 : 1, out = [];
      for (var k = 0; k < n; k++) {
        var row = rows === 2 && k >= Math.ceil(n / 2) ? 1 : 0, inRow = rows === 2 ? (row ? n - Math.ceil(n / 2) : Math.ceil(n / 2)) : n;
        var idx = row ? k - Math.ceil(n / 2) : k, R = row ? 8.6 : 6.6, span = row ? 150 : 170;
        var gap = row ? 18 : 24, ua = inRow > 1 ? idx / (inRow - 1) : 0.5, half = span / 2 - gap;
        var a = (ua < 0.5 ? -gap - (0.5 - ua) * 2 * half : gap + (ua - 0.5) * 2 * half) * Math.PI / 180;
        out.push({ slot: V(PODIUM.x + Math.sin(a) * R * 1.1, 0, PODIUM.z - 1.2 - Math.cos(a) * R * 0.5 + (row ? -1.4 : 0)), row: row });
      }
      return out;
    }
    // hereinwatscheln (Start t0, Dauer dur); true = am Platz
    function walkIn(d, from, to, t, t0, dur) {
      var w = clamp01((t - t0) / dur);
      if (w < 1) { d.position.lerpVectors(from, to, w); S.face(d, to.x - from.x, to.z - from.z); S.waddle(d, t, w > 0 ? 1 : 0); return false; }
      d.position.copy(to); return true;
    }
    function lookAt(d, p) { S.face(d, p.x - d.position.x, p.z - d.position.z); }
    function pop(sp, t, t0, k, ratio) { var p = clamp01((t - t0) / 0.4); sp.visible = p > 0; var e = ease(p); sp.scale.set(k * ratio * e, k * e, 1); }
    function quacks(list, t0, n, gapT, lo, hi) { for (var q = 0; q < n; q++) (function (q) { list.push([t0 + q * gapT, function () { S.sfx.quack(lo + Math.random() * (hi - lo)); }]); })(q); }
    var names = opts.names || [];
    var cues = [[1.1, S.sfx.fanfare]], after = null, step;

    if (mode === 'vote') {
      // ── Abstimmung ──
      var AB = opts.a && opts.b ? [opts.a, opts.b] : answers(opts.q), allY = opts.yes || [], allN = opts.no || [];
      var yes = allY.slice(0, 12), no = allN.slice(0, 12), ny = allY.length, nn = allN.length;
      var ask = leaderBubble((opts.q || 'Yes or no?').slice(0, 70));
      var SIDE = [V(-5.2, 0, -2.2), V(5.2, 0, -2.2)], tint = [0x3fb04a, 0xe6312e];
      [0, 1].forEach(function (s) {
        var mat = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 8), new THREE.MeshBasicMaterial({ color: tint[s], transparent: true, opacity: 0.22, depthWrite: false }));
        mat.rotation.x = -Math.PI / 2; mat.position.set(SIDE[s].x, 0.02, SIDE[s].z - 1.6); scene.add(mat);
        var sign = S.tag(AB[s], { size: 1.3, bg: s ? 'rgba(150,20,20,0.92)' : 'rgba(30,110,40,0.92)' }); sign.position.set(SIDE[s].x * 1.25, 5.3, SIDE[s].z - 4); scene.add(sign);
      });
      var voters = crowd(yes.length, yes, opts.outfit).map(function (d) { d.userData.side = 0; return d; })
        .concat(crowd(no.length, no, opts.outfit).map(function (d) { d.userData.side = 1; return d; }));
      var count = [0, 0];
      voters.forEach(function (d) {
        var s = d.userData.side, idx = count[s]++, col = idx % 3, row = Math.floor(idx / 3);
        d.userData.slot = V(SIDE[s].x + (col - 1) * 1.8 * (s ? 1 : -1) + (row % 2) * 0.5, 0, SIDE[s].z + 1.4 - row * 1.8);
        d.userData.from = V((s ? 1 : -1) * 26, 0, d.userData.slot.z + 1);
        d.userData.t0 = 2.0 + idx * 0.32 + s * 0.16;
        d.position.copy(d.userData.from);
      });
      var tally = [0, 1].map(function (s) { var p = S.plaque(String([ny, nn][s]), null, { size: 1.5, bg: s ? '#7a1010' : '#1e6e28' }); p.position.set(SIDE[s].x * 1.25, 3.9, SIDE[s].z - 4); p.visible = false; scene.add(p); return p; });
      var win = ny === nn ? -1 : ny > nn ? 0 : 1, none = !ny && !nn;
      var res = S.plaque(none ? 'NOBODY VOTED' : win < 0 ? 'TIE ' + ny + ' : ' + nn : AB[win].toUpperCase() + ' WINS', none ? 'The ducks stayed home.' : win < 0 ? 'The ducks cannot decide.' : ny + ' : ' + nn, { size: 2.4 });
      res.position.set(0, 7.3, -12.4); res.visible = false; scene.add(res);
      var conf = win >= 0 ? S.confetti(SIDE[win].x - 4, SIDE[win].x + 4, -6, 1) : null;
      quacks(cues, 2.4, Math.min(voters.length, 10), 0.35, 0.9, 1.4);
      cues.push([7.6, function () { S.sfx.drumroll(1.6); }], [9.3, S.sfx.fanfare]);
      if (win >= 0) quacks(cues, 9.5, 6, 0.2, 1, 1.5);
      step = function (t) {
        leaderIn(t); speak(ask, t, 1.6, 7.4);
        pop(tally[0], t, 9.2, 1.0, 1600 / 300); pop(tally[1], t, 9.45, 1.0, 1600 / 300); pop(res, t, 9.3, 3.6, 1600 / 420);
        if (conf) conf.update(t, 9.4);
        voters.forEach(function (d, k) {
          var dd = d.userData.duck;
          if (walkIn(d, d.userData.from, d.userData.slot, t, d.userData.t0, 2.4)) {
            lookAt(d, PODIUM);
            if (t > 9.4 && d.userData.side === win) { dd.position.y = 0.55 + Math.abs(Math.sin((t - 9.4) * 7 + k)) * 0.45; dd.rotation.z = 0; }
            else if (t > 9.4 && win >= 0) { dd.position.y = 0.55; dd.rotation.z = -0.28 * ease((t - 9.4) / 0.6); }   // Köpfe hängen lassen
            else { dd.position.y = 0.55; dd.rotation.z = 0; }
          }
        });
        if (t > 9.4) leader.userData.duck.position.y = 0.55 + (win >= 0 ? Math.abs(Math.sin((t - 9.4) * 5)) * 0.25 : 0);
        if (t > 9.4 && win < 0) leader.userData.duck.rotation.x = Math.sin(t * 4) * 0.12;   // Achselzucken
      };
    } else if (mode === 'king') {
      // ── Wahl zum Enten-König ──
      // zwei versetzte Reihen mit Abstand (Ente von vorn ~1,7 breit), Mitte vor dem Podest frei;
      // erst vordere Reihe, dann hintere, die neunte ganz vorn in der Mitte
      var KS = 0.78;                                    // Kandidaten etwas kleiner, damit beide Reihen Platz haben
      var KSLOTS = [[-2.4, 1.3], [2.4, 1.3], [-4.7, 1.1], [4.7, 1.1], [-3.6, -1.1], [3.6, -1.1], [-5.9, -1.3], [5.9, -1.3], [0, 2.5]];
      var n = Math.min(9, Math.max(names.length, Math.max(4, Math.min(9, opts.count || 8))));
      var cands = crowd(n, names, opts.outfit), K = Math.floor(Math.random() * (Math.min(names.length, n) || n));
      cands.forEach(function (d, k) { var sl = KSLOTS[k]; d.scale.setScalar(KS); d.userData.slot = V(sl[0], 0, sl[1]); d.userData.from = V((sl[0] < 0 ? -1 : 1) * 26, 0, sl[1] + 0.5); d.userData.t0 = 0.4 + (k % 5) * 0.18; d.position.copy(d.userData.from); });
      var spot = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      spot.rotation.x = -Math.PI / 2; spot.position.y = 0.03; spot.visible = false; scene.add(spot);
      var ask2 = leaderBubble(opts.text || 'Who shall wear the crown?');
      var cr = S.crown(); cr.scale.setScalar(KS); cr.visible = false; scene.add(cr);
      var kn = cands[K].userData.name;
      var res2 = S.plaque('LONG LIVE ' + (kn ? kn.toUpperCase() : 'THE DUCK') + '!', 'Ruler of all ducks', { size: 2.3 }); res2.position.set(0, 7.3, -12.4); res2.visible = false; scene.add(res2);
      var conf2 = S.confetti(-9, 9, -3, 2);
      // Scheinwerfer springt immer langsamer von Ente zu Ente und landet auf K
      var hops = [], tt = 3.0, gapT = 0.16;
      while (tt < 7.3) { hops.push(tt); tt += gapT; gapT *= 1.09; }
      var seq = hops.map(function (h, i) { return i === hops.length - 1 ? K : Math.floor(Math.random() * n); });
      cues.push([3.0, function () { S.sfx.drumroll(4.4); }], [7.5, S.sfx.fanfare]);
      quacks(cues, 8.6, 8, 0.18, 0.9, 1.5);
      step = function (t) {
        leaderIn(t); speak(ask2, t, 1.6, 3.4);
        cands.forEach(function (d, k) {
          var dd = d.userData.duck;
          if (walkIn(d, d.userData.from, d.userData.slot, t, d.userData.t0, 2.2)) {
            S.face(d, 0.15 * -Math.sign(d.position.x), 1);
            if (t > 8.6 && k !== K) dd.rotation.z = -0.3 * ease((t - 8.6) / 0.5);            // verbeugen
            else if (k === K && t > 8.6) dd.position.y = 0.55 + Math.abs(Math.sin((t - 8.6) * 5)) * 0.3;
          }
        });
        var hi = -1; for (var h = 0; h < hops.length; h++) if (t >= hops[h]) hi = h;
        spot.visible = hi >= 0; if (hi >= 0) { var tgt = cands[seq[hi]].position; spot.position.x = tgt.x; spot.position.z = tgt.z; }
        var cp = clamp01((t - 7.5) / 1.1), head = cands[K].position;
        cr.visible = t > 7.5; cr.position.set(head.x, lerp(10, 2.42 * KS, ease(cp)) + (cands[K].userData.duck.position.y - 0.55) * KS, head.z + 0.08); cr.rotation.y = (1 - cp) * 6; cr.rotation.z = 0.1 * cp;
        pop(res2, t, 8.4, 3.6, 1600 / 420);
        conf2.update(t, 8.5);
      };
    } else if (mode === 'mutiny') {
      // ── Meuterei ──
      var n3 = Math.min(14, Math.max(names.length, Math.max(6, Math.min(14, opts.count || 10))));
      var mob = crowd(n3, names, opts.outfit), sl3 = arcSlots(n3);
      mob.forEach(function (d, k) { d.userData.slot = sl3[k].slot; d.userData.from = V((sl3[k].slot.x < 0 ? -1 : 1) * 26, 0, sl3[k].slot.z + 2); d.userData.t0 = 0.4 + (k % 5) * 0.18 + sl3[k].row * 0.3; d.position.copy(d.userData.from); });
      var speech3 = leaderBubble(opts.text || 'From today, bread crumbs cost double!');
      var boos = mob.filter(function (d, k) { return k % 3 === 0; }).map(function (d, k) { var b = S.bubble(k % 2 ? 'BOO!' : 'Quack off!', { size: 1.3 }); b.position.set(0.2, 3.2, 0); b.visible = false; d.add(b); return b; });
      var TOM = [], red = new THREE.MeshStandardMaterial({ color: 0xd8231e, roughness: 0.35 });
      for (var tq = 0; tq < 7; tq++) {
        var tm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), red); tm.visible = false; scene.add(tm);
        var sp3 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), red); sp3.scale.set(1.4, 0.35, 1.4); sp3.visible = false; leader.userData.duck.add(sp3);
        TOM.push({ m: tm, s: sp3, from: mob[(tq * 3 + 1) % n3], t0: 5.0 + tq * 0.42, hit: V(0.55 + Math.random() * 0.3, 0.6 + Math.random() * 1.1, (Math.random() - 0.5) * 1.0) });
        cues.push([5.0 + tq * 0.42 + 0.65, S.sfx.splat]);
      }
      cues.push([4.6, function () { S.sfx.murmur(3.2); }]);
      quacks(cues, 4.6, 6, 0.3, 0.6, 0.8);
      cues.push([8.3, function () { S.sfx.quack(1.6); S.sfx.quack(1.7, 0.2); }]);
      step = function (t) {
        var run = clamp01((t - 8.3) / 2.2);
        if (t < 8.3) { leaderIn(t); speak(speech3, t, 1.6, 4.6); }
        else {   // Flucht: vom Podest springen, nach rechts davon
          speech3.visible = false; S.talk(leader, 0);
          var jp = clamp01((t - 8.3) / 0.4);
          leader.position.set(PODIUM.x + 2.4 * jp + Math.max(0, run - 0.15) * 22, (1 - jp) * 0.9 + Math.sin(jp * Math.PI) * 1.2, PODIUM.z + 1.4 * jp);
          S.face(leader, 1, 0.1); S.waddle(leader, t, 1.4, 16);
        }
        boos.forEach(function (b) { b.visible = t > 4.6 && t < 8.0; });
        leader.updateMatrixWorld(true);
        TOM.forEach(function (o) {
          var p = (t - o.t0) / 0.65, from = o.from.position.clone().add(V(0, 2.2, 0)), to = leader.userData.duck.localToWorld(o.hit.clone());
          o.m.visible = p > 0 && p < 1; if (o.m.visible) { o.m.position.lerpVectors(from, to, p); o.m.position.y += Math.sin(p * Math.PI) * 2.2; }
          o.s.visible = p >= 1; if (p >= 1) { o.s.position.copy(o.hit); o.s.lookAt(o.s.position.clone().add(V(1, 0.2, 0))); }
        });
        if (t > 5.6 && t < 8.3) leader.userData.duck.rotation.x = Math.sin(t * 25) * 0.05;
        mob.forEach(function (d, k) {
          var dd = d.userData.duck, ch = clamp01((t - 8.9 - (k % 5) * 0.15) / 3.2);
          if (ch > 0) { var to = V(28, 0, d.userData.slot.z + 2); d.position.lerpVectors(d.userData.slot, to, ch * ch); S.face(d, 1, 0.08); S.waddle(d, t, 1.3, 15); }
          else if (walkIn(d, d.userData.from, d.userData.slot, t, d.userData.t0, 2.4)) {
            lookAt(d, PODIUM);
            dd.position.y = 0.55 + (t > 4.6 && t < 8.3 ? Math.abs(Math.sin(t * 9 + k)) * 0.22 : 0);   // empört hüpfen
          }
        });
      };
    } else if (mode === 'conga') {
      // ── Polonaise ──
      var n4 = Math.min(14, Math.max(names.length, Math.max(6, Math.min(14, opts.count || 10))));
      var line = [leader].concat(crowd(n4, names, opts.outfit));
      var ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 2), new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 1, roughness: 0.08, flatShading: true }));
      ball.position.set(0, 8.4, -3); scene.add(ball);
      var str = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3, 6), new THREE.MeshStandardMaterial({ color: 0x222222 })); str.position.set(0, 10.4, -3); scene.add(str);
      var lights = [0xff3b6b, 0x3bc8ff, 0xffe23b, 0x7dff6b, 0xc66bff].map(function (c) {
        var m = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
        m.rotation.x = -Math.PI / 2; m.position.y = 0.03; scene.add(m); return m;
      });
      var go = leaderBubble(opts.text || 'Conga line! Everybody follow me!');
      var RX = 7.2, RZ = 3.1, CZ = PODIUM.z - 1.2, SPEED = 0.62, GAPA = 0.4;
      // Weg: von links herein bis an den Kreis, dann um das Podest herum
      function congaPos(u) {
        if (u < 0) return { p: V(-RX + u * 9, 0, CZ), d: V(1, 0, 0) };
        var a = Math.PI + u;
        return { p: V(Math.cos(a) * RX, 0, CZ - Math.sin(a) * RZ), d: V(-Math.sin(a) * RX, 0, -Math.cos(a) * RZ) };
      }
      cues.length = 0; cues.push([0.6, function () { S.sfx.conga(13); }]);
      step = function (t) {
        go.visible = t > 0.8 && t < 3.6; S.talk(leader, go.visible ? Math.abs(Math.sin(t * 9)) : 0);
        line.forEach(function (d, k) {
          var c = congaPos((t - 0.3) * SPEED - 0.5 - k * GAPA);
          d.position.copy(c.p); S.face(d, c.d.x, c.d.z);
          var dd = d.userData.duck, beat = t / 0.52 * Math.PI;
          dd.position.y = 0.55 + Math.abs(Math.sin(beat)) * 0.25; dd.rotation.x = Math.sin(beat) * 0.18;
          if (k > 0 && Math.floor(t / 1.04) % 4 === 3) dd.rotation.x += Math.sin(beat * 2) * 0.12;   // Kick
        });
        ball.rotation.y = t * 0.9;
        lights.forEach(function (m, k) { var a = t * (0.7 + k * 0.13) + k * 1.3; m.position.x = Math.cos(a) * (5 + k); m.position.z = -3 + Math.sin(a * 1.3) * 3.5; });
      };
    } else if (mode === 'photo') {
      // ── Gruppenfoto ──
      var n5 = Math.min(12, Math.max(names.length, Math.max(5, Math.min(12, opts.count || 9))));
      var grp = crowd(n5, names, opts.outfit), rowsN = n5 > 6 ? 2 : 1, perRow = Math.ceil(n5 / rowsN);
      grp.forEach(function (d, k) {
        var r = Math.floor(k / perRow), c = k % perRow, cnt = r ? n5 - perRow : Math.min(perRow, n5);
        d.userData.slot = V((c - (cnt - 1) / 2) * 2.05 + (r ? 1.0 : 0), 0, r ? -0.6 : 1.6);
        d.userData.from = V((d.userData.slot.x < 0 ? -1 : 1) * 26, 0, d.userData.slot.z + 0.5); d.userData.t0 = 0.3 + (k % 6) * 0.2; d.position.copy(d.userData.from);
      });
      var say5 = leaderBubble('Say quack!');
      var flash = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
      flash.position.set(0, 0, -1); flash.renderOrder = 20; cam.add(flash);
      var snap = document.createElement('canvas'); snap.width = 1100; snap.height = 1100;
      var snapTex = new THREE.CanvasTexture(snap); snapTex.encoding = THREE.sRGBEncoding;
      var pol = new THREE.Mesh(new THREE.PlaneGeometry(1.1 * 1.25, 1.1 * 1.25), new THREE.MeshBasicMaterial({ map: snapTex, transparent: true, depthTest: false, depthWrite: false }));
      pol.position.set(0.9, -0.05, -3); pol.renderOrder = 19; pol.visible = false; cam.add(pol);
      var taken = false, takenAt = 0, caption = (by ? 'Assembly of ' + by : 'Duck assembly') + ' · ' + new Date().toLocaleDateString('en-GB');
      cues.push([5.0, S.sfx.shutter]);
      quacks(cues, 4.4, 6, 0.08, 1, 1.5);
      // direkt nach dem Rendern des Blitz-Bildes das Bild abgreifen (vor dem Weiß)
      after = function (t) {
        if (taken || t < 4.95) return; taken = true; takenAt = Math.min(t, 5.0);
        // Ausschnitt um die Gruppe (untere 60 % des Bildes), Polaroid mit breitem Rand unten
        var x = snap.getContext('2d'), src = S.renderer.domElement, sw = src.width, sh = src.height, ch = sh * 0.6, cw = ch * 980 / 800;
        x.fillStyle = '#fbf8f0'; x.fillRect(0, 0, 1100, 1100);
        x.drawImage(src, (sw - cw) / 2, sh * 0.38, cw, ch, 60, 60, 980, 800);
        x.fillStyle = '#1d2433'; x.textAlign = 'center'; x.font = '600 56px ' + S.FONT; x.fillText(caption.slice(0, 34), 550, 990);
        snapTex.needsUpdate = true;
      };
      step = function (t) {
        leaderIn(t);
        speak(say5, t, 2.6, 4.6);
        grp.forEach(function (d, k) {
          var dd = d.userData.duck;
          if (walkIn(d, d.userData.from, d.userData.slot, t, d.userData.t0, 2.4)) {
            S.face(d, -d.position.x * 0.05, 1);
            dd.position.y = 0.55 + (t > 4.3 && t < 5.0 ? Math.abs(Math.sin((t - 4.3) * 12 + k)) * 0.2 : 0);
            if (t > 5.9) dd.position.y = 0.55 + Math.abs(Math.sin((t - 5.9) * 6 + k)) * 0.3;
          }
        });
        flash.material.opacity = taken ? Math.max(0, 1 - (t - takenAt) / 0.6) : 0;   // erst nach dem Abgreifen
        var pp = clamp01((t - 5.6) / 0.7); pol.visible = taken && pp > 0;
        pol.scale.setScalar(0.3 + 0.7 * ease(pp)); pol.rotation.z = lerp(0.6, -0.08, ease(pp)); pol.position.y = lerp(-1.2, -0.05, ease(pp));
      };
    } else {
      // ── Rede ──
      var n6 = Math.min(16, Math.max(names.length, Math.min(16, Math.max(3, opts.count || 10))));
      var ducks = crowd(n6, names, opts.outfit), sl6 = arcSlots(n6);
      ducks.forEach(function (d, k) { d.userData.slot = sl6[k].slot; d.userData.from = V((sl6[k].slot.x < 0 ? -1 : 1) * 26, 0, sl6[k].slot.z + 2); d.userData.t0 = 0.6 + (Math.abs(sl6[k].slot.x) < 3 ? 1.2 : 0) + (k % 5) * 0.18 + sl6[k].row * 0.3; d.position.copy(d.userData.from); });
      var speech = leaderBubble(opts.text || 'Quack! Order, order! Welcome, everyone!');
      var SPEAK = [4.6, 7.4], CHEER = [7.6, 9.2], OUT = 9.3;
      [4.75, 5.35, 6.0, 6.7].forEach(function (tq, i) { cues.push([tq, function () { S.sfx.quack(0.85 + i * 0.05); }]); });
      quacks(cues, CHEER[0] + 0.15, 8, 0.17, 0.9, 1.5);
      step = function (t) {
        leaderIn(t);
        var speaking = speak(speech, t, SPEAK[0], SPEAK[1]);
        if (t > CHEER[0] && t < CHEER[1]) leader.userData.duck.position.y = 0.55 + Math.abs(Math.sin((t - CHEER[0]) * 8)) * 0.35;
        ducks.forEach(function (d, i) {
          var s = d.userData.slot, o = clamp01((t - OUT - (i % 4) * 0.12) / 2.6), dd = d.userData.duck;
          if (o > 0) { var to = V(Math.sign(s.x || 1) * 26, 0, s.z + 1); d.position.lerpVectors(s, to, ease(o)); S.face(d, to.x - s.x, to.z - s.z); S.waddle(d, t, 1); }
          else if (walkIn(d, d.userData.from, s, t, d.userData.t0, 2.6)) {
            lookAt(d, PODIUM);
            var nod = speaking ? Math.max(0, Math.sin((t - SPEAK[0]) * 5 + i)) * 0.18 : 0;
            dd.rotation.x = 0; dd.rotation.z = -nod;
            dd.position.y = 0.55 + (t > CHEER[0] && t < CHEER[1] ? Math.abs(Math.sin((t - CHEER[0]) * 7 + i * 0.7)) * 0.45 : 0);
          }
        });
      };
    }
    S.run(TOTAL, step, { freeze: opts.freeze, cues: cues, after: after });
  }

  root.DuckAssembly = { start: start, DURATION: DURATION, answers: answers };
})(typeof window !== 'undefined' ? window : this);
