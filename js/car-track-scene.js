/* Strecken-Kulisse aus einer CarRaceSim-Strecke (three r128): Wiese, Asphalt, Randlinien, Curbs, Kiesbett an
 * Kurven-Außenseiten, Leitplanken am Rand des Auslaufs, Start/Ziel mit Portal, Tribüne, Bäume.
 * Herausgelöst aus js/car-race.js (buildTrack, gleiche Regeln/Maße) für Car Drive; car-race.js baut weiter selbst.
 *
 *   CarTrackScene.build(T, { primary, accent, maxAniso }) → { group, nearTrack(x, z, R), decor, P, gantry, dispose() }
 *       T = CarRaceSim.track(seed); primary/accent = Farben für Portal/Tribünendach (CSS-Farbtext oder Zahl),
 *       group noch nicht in der Szene (Aufrufer: scene.add(res.group)); dispose() entfernt und gibt alles frei.
 *   Kiesbett-Regel: außen an Kurven (|curv| > 1/60, ±14 m), wo der Auslauf > 3 m ist – dieselbe Regel nutzt
 *   js/car-drive-phys.js (trackInfo) für die Fahrphysik.
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  function lerp(a, b, t) { return a + (b - a) * t; }
  function col(c, fb) { try { return new THREE.Color(c == null || c === '' ? fb : c); } catch (e) { return new THREE.Color(fb); } }
  function build(T, opts) {
    opts = opts || {};
    var owned = [], decor = { objs: [], trees: null }, maxAniso = opts.maxAniso || 4;
    function own(x) { owned.push(x); return x; }
    function canvasTex(w, h, draw, repeat) {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      var t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, maxAniso); }
      return t;
    }
    function noise(g, w, h, base, spread, rnd) {
      g.fillStyle = 'rgb(' + base.join(',') + ')'; g.fillRect(0, 0, w, h);
      for (var i = 0; i < w * h / 3; i++) {
        var k = (rnd() - 0.5) * spread;
        g.fillStyle = 'rgba(' + (k > 0 ? '255,255,255,' : '0,0,0,') + Math.abs(k).toFixed(3) + ')';
        g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2));
      }
    }
    var g = new THREE.Group();
    var raw = T._raw, n = raw.n, ds = raw.ds, HALF = T.width / 2;
    var rnd = CarRaceSim.rng((T.seed | 0) + 7919);
    // Mittellinie + Normale je Rasterpunkt
    var P = [];
    for (var i = 0; i < n; i++) { var a = T.at(i * ds); P.push(a); }
    // Raster für „liegt nah an der Strecke?“ (Bäume, Leitplanken, Tribüne)
    var CELL = 8, hash = {};
    P.forEach(function (p, i) { var k = Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL); (hash[k] || (hash[k] = [])).push(i); });
    function nearTrack(x, z, R) {
      var r = Math.ceil(R / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), R2 = R * R;
      for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) {
        var l = hash[(cx + a) + ',' + (cz + b)]; if (!l) continue;
        for (var q = 0; q < l.length; q++) { var p = P[l[q]], dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < R2) return true; }
      }
      return false;
    }
    // Auslauf je Rasterpunkt (links/rechts, m) – dahinter steht die Leitplanke
    var runL = T.runoff ? T.runoff.left : [], runR = T.runoff ? T.runoff.right : [];
    function runAt(i, sd) { var v = (sd > 0 ? runL : runR)[i % n]; return v > 0 ? v : 0; }
    // Band entlang der Strecke: Seitenversatz a…b (Zahl oder Funktion des Rasterindex), Höhe ya/yb
    // (Wand: a = b, ya ≠ yb); keep(i) je Abschnitt
    function strip(a0, b0, ya, yb, mat, vLen, keep) {
      var pos = [], uv = [], idx = [];
      for (var i = 0; i <= n; i++) {
        var p = P[i % n], a = typeof a0 === 'function' ? a0(i % n) : a0, b = typeof b0 === 'function' ? b0(i % n) : b0;
        pos.push(p.x + p.nx * a, ya, p.z + p.nz * a, p.x + p.nx * b, yb, p.z + p.nz * b);
        uv.push(0, i * ds / vLen, 1, i * ds / vLen);
        if (i < n && (!keep || keep(i))) { var o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      }
      if (!idx.length) return null;
      var geo = own(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      var m = new THREE.Mesh(geo, mat); g.add(m); return m;
    }
    var cx = 0, cz = 0, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    P.forEach(function (p) { cx += p.x / n; cz += p.z / n; minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });

    // Wiese (groß genug für den weitesten Zoom), Asphalt, Randlinien, Curbs in Kurven, Leitplanken
    var GS = 1600;
    var grassTex = own(canvasTex(128, 128, function (x, w, h) { noise(x, w, h, [74, 118, 58], 0.22, rnd); }, true));
    grassTex.repeat.set(GS / 12, GS / 12);
    var grass = new THREE.Mesh(own(new THREE.PlaneGeometry(GS, GS)), own(new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, metalness: 0 })));
    grass.rotation.x = -Math.PI / 2; grass.position.set(cx, 0, cz); g.add(grass);
    var asphaltTex = own(canvasTex(128, 128, function (x, w, h) { noise(x, w, h, [62, 64, 70], 0.3, rnd); }, true));
    var asphalt = own(new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
    strip(-HALF, HALF, 0.03, 0.03, asphalt, 9);
    var white = own(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7, side: THREE.DoubleSide }));
    strip(HALF - 0.45, HALF - 0.25, 0.04, 0.04, white, 10);
    strip(-HALF + 0.25, -HALF + 0.45, 0.04, 0.04, white, 10);
    var curbTex = own(canvasTex(8, 64, function (x, w, h) { x.fillStyle = '#d8262b'; x.fillRect(0, 0, w, h / 2); x.fillStyle = '#f4f4f4'; x.fillRect(0, h / 2, w, h / 2); }, true));
    var curb = own(new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.6, side: THREE.DoubleSide }));
    function curvy(i) { return Math.abs(P[i].curv) > 1 / 60 || Math.abs(P[(i + 1) % n].curv) > 1 / 60; }
    strip(HALF, HALF + 0.9, 0.05, 0.05, curb, 4, curvy);
    strip(-HALF - 0.9, -HALF, 0.05, 0.05, curb, 4, curvy);
    // Kiesbett im Auslauf an Kurven-Außenseiten (±14 m um die Kurve), wo der Auslauf > 3 m ist; sonst Gras
    var gravelTex = own(canvasTex(128, 128, function (x, w, h) { noise(x, w, h, [196, 178, 140], 0.45, rnd); }, true));
    var gravel = own(new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
    var outside = { 1: new Uint8Array(n), '-1': new Uint8Array(n) }, W14 = Math.round(14 / ds);
    for (var ci = 0; ci < n; ci++) {
      if (Math.abs(P[ci].curv) <= 1 / 60) continue;
      var outSd = P[ci].curv > 0 ? -1 : 1;   // Linkskurve → außen = rechts
      for (var k = -W14; k <= W14; k++) outside[outSd][(ci + k + n) % n] = 1;
    }
    [1, -1].forEach(function (sd) {
      strip(function (i) { return sd * (HALF + 0.9); }, function (i) { return sd * (HALF + Math.max(0.9, runAt(i, sd))); }, 0.035, 0.035, gravel, 5,
        function (i) { return outside[sd][i] && outside[sd][(i + 1) % n] && runAt(i, sd) > 3 && runAt(i + 1, sd) > 3; });
    });
    // Leitplanken am Außenrand des Auslaufs (die Sim lässt dort nicht weiter)
    var rail = own(new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide }));
    [1, -1].forEach(function (sd) {
      var off = function (i) { return sd * (HALF + runAt(i, sd) + 0.3); };
      strip(off, off, 0.25, 0.85, rail, 10);
    });

    // Start/Ziel: Schachbrett über die Fahrbahn + Portal
    var p0 = P[0];
    var checkTex = own(canvasTex(160, 32, function (x, w, h) {
      for (var a = 0; a < 10; a++) for (var b = 0; b < 2; b++) { x.fillStyle = (a + b) % 2 ? '#111' : '#f4f4f4'; x.fillRect(a * 16, b * 16, 16, 16); }
    }));
    var line = new THREE.Mesh(own(new THREE.PlaneGeometry(T.width, 1.6)), own(new THREE.MeshStandardMaterial({ map: checkTex, roughness: 0.7 })));
    line.rotation.set(-Math.PI / 2, p0.yaw + Math.PI / 2, 0, 'YXZ');   // Breite quer zur Fahrtrichtung
    line.position.set(p0.x, 0.06, p0.z); g.add(line);
    // Portal und Tribünendach in den Theme-Farben (Primär + Akzent)
    var purple = own(new THREE.MeshStandardMaterial({ color: col(opts.primary, 0x5e2a79), roughness: 0.5 }));
    var gold = own(new THREE.MeshStandardMaterial({ color: col(opts.accent, 0xf2b705), roughness: 0.4, metalness: 0.3 }));
    // Portal: Pfosten hinter den Leitplanken (lokal z = −Normale: links = −z)
    var gantry = new THREE.Group(), postL = HALF + runAt(0, 1) + 0.8, postR = HALF + runAt(0, -1) + 0.8;
    [-postL, postR].forEach(function (z) {
      var post = new THREE.Mesh(own(new THREE.BoxGeometry(0.4, 4.6, 0.4)), purple);
      post.position.set(0, 2.3, z); gantry.add(post);
    });
    var span = postL + postR + 0.4, mid = (postR - postL) / 2;
    var beam = new THREE.Mesh(own(new THREE.BoxGeometry(0.5, 0.9, span)), purple); beam.position.set(0, 4.6, mid); gantry.add(beam);
    var stripe = new THREE.Mesh(own(new THREE.BoxGeometry(0.52, 0.18, span + 0.02)), gold); stripe.position.set(0, 4.6, mid); gantry.add(stripe);
    gantry.position.set(p0.x, 0, p0.z); gantry.rotation.y = p0.yaw; g.add(gantry);
    decor.objs.push({ o: gantry, r: HALF + 13 });

    // Tribüne neben der Startgeraden, auf der Seite mit Platz
    var standMat = own(new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.8 }));
    var crowdTex = own(canvasTex(128, 32, function (x, w, h) {
      x.fillStyle = '#6d7280'; x.fillRect(0, 0, w, h);
      var cols = ['#e04848', '#3a86ff', '#ffbe0b', '#f2f2f2', '#8338ec', '#2ec4b6', '#fb5607'];
      for (var i = 0; i < 220; i++) { x.fillStyle = cols[Math.floor(rnd() * cols.length)]; x.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 2, 2); }
    }));
    var crowdMat = own(new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9 }));
    var sMid = 28, pS = T.at(sMid);
    [1, -1].some(function (sd) {
      // hinter jedem möglichen Auslauf (max. 12 m) – auch dem eines anderen Streckenteils
      var off = sd * (HALF + 12 + 5), x = pS.x + pS.nx * off, z = pS.z + pS.nz * off;
      var ok = [-10, 0, 10].every(function (k) { var q = T.at(sMid + k); return !nearTrack(q.x + q.nx * off, q.z + q.nz * off, HALF + 12 + 4); });
      if (!ok) return false;
      var st = new THREE.Group();
      for (var r = 0; r < 4; r++) {
        var step = new THREE.Mesh(own(new THREE.BoxGeometry(22, 0.8 + r * 0.8, 1.6)), [standMat, standMat, crowdMat, standMat, standMat, standMat]);
        step.position.set(0, (0.8 + r * 0.8) / 2, -sd * (-2.4 + r * 1.6)); st.add(step);
      }
      var roof = new THREE.Mesh(own(new THREE.BoxGeometry(23, 0.3, 7.5)), purple);
      roof.position.set(0, 5.6, 0); st.add(roof);
      st.position.set(x, 0, z); st.rotation.y = pS.yaw; g.add(st);
      decor.objs.push({ o: st, r: 12 });
      return true;
    });

    // Bäume (InstancedMesh): außerhalb der Strecke, nicht zu weit weg
    var trunkGeo = own(new THREE.CylinderGeometry(0.25, 0.3, 1.6, 6)), crownGeo = own(new THREE.ConeGeometry(1.8, 4.2, 7));
    var trunkMat = own(new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 })), crownMat = own(new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.95 }));
    var spots = [];
    for (var t = 0; t < 900 && spots.length < 90; t++) {
      var x = lerp(minX - 60, maxX + 60, rnd()), z = lerp(minZ - 60, maxZ + 60, rnd());
      if (nearTrack(x, z, HALF + 15) || !nearTrack(x, z, 70)) continue;   // nie im Auslauf
      if (spots.some(function (s) { return (s[0] - x) * (s[0] - x) + (s[1] - z) * (s[1] - z) < 9; })) continue;
      spots.push([x, z, 0.7 + rnd() * 0.7]);
    }
    if (spots.length) {
      var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length), crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
      var mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
      spots.forEach(function (s, i) {
        sc.setScalar(s[2]);
        ps.set(s[0], 0.8 * s[2], s[1]); mtx.compose(ps, q, sc); trunks.setMatrixAt(i, mtx);
        ps.set(s[0], (1.6 + 2.1) * s[2], s[1]); mtx.compose(ps, q, sc); crowns.setMatrixAt(i, mtx);
      });
      g.add(trunks); g.add(crowns);
      decor.trees = { spots: spots, trunks: trunks, crowns: crowns };
    }
    return { group: g, nearTrack: nearTrack, decor: decor, P: P, gantry: gantry, dispose: function () { if (g.parent) g.parent.remove(g); owned.forEach(function (x) { if (x && x.dispose) x.dispose(); }); owned = []; } };
  }
  root.CarTrackScene = { build: build };
})(typeof window !== 'undefined' ? window : this);
