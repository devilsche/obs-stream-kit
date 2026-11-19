/* Car Race – Overlay: Startaufstellung, Rennen mit mitschwenkender Kamera, Namensschilder, Rangliste.
 * three r128; Autos über js/toy-cars.js (Lack aus dem Car editor, Farbset-Index vom Server), Bühne js/car-stage.js,
 * Strecke + Fahrsimulation js/car-race-sim.js (deterministisch aus Seed), Werte je Auto js/car-race-stats.js.
 *
 *   CarRace.start({ canvas, hud, stage, base, preview, reduceMotion, finish, track, onPreviewInfo })
 *     → { addTestRacer(), startNow() }   (beides nur in der Vorschau)
 *
 * Ablauf: Server-Zustand (GET <base>api/fx/car-race/state, jede Sekunde) → idle/lobby: nichts sichtbar ·
 * countdown: einblenden, Strecke, Startaufstellung (2er-Reihen, Pole vorn), Neuzugänge rollen von hinten ein,
 * Modelle laden (bis dahin Ersatz-Kiste in Lackfarbe) · race: Simulation aus seed, nach Neuladen per
 * fastForward(now − starts_at) an dieselbe Stelle · sim.done: Ergebnis einmal POSTen, showPodium(), ausblenden.
 * Uhr: Serverzeit aus state.now (Versatz zur eigenen Uhr, geglättet).
 * Darstellung in Metern (wie die Simulation); ToyCars-Modelle werden auf die Länge aus den Race stats skaliert.
 * Farben je Fahrer (Chatfarbe, Lack) nur im Canvas/WebGL – keine Inline-Styles.
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  // Kamera: Pixel je Meter (4,5-m-Auto 20…60 px); die Fenstergröße ändert nur den Ausschnitt
  var PX_MIN = 20 / 4.5, PX_MAX = 60 / 4.5;
  var TILT = 58 * Math.PI / 180, FOV = 30;
  var POLL_MS = 1000, HOLD = 5, FADE = 0.6;
  var LABEL_W = 512, LABEL_H = 112;
  var PREVIEW_COLORS = ['#ff4f4f', '#1e90ff', '#00c878', '#ffb000', '#b05cff', '#ff69b4', '#00d2d2', '#9acd32', '#ff7f24', '#f2f2f2'];

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(v, target, tau, dt, maxRate) {
    var d = (target - v) * (1 - Math.exp(-dt / tau));
    if (maxRate) d = clamp(d, -maxRate * dt, maxRate * dt);
    return v + d;
  }

  function start(opts) {
    var base = opts.base || '../', preview = !!opts.preview, reduce = !!opts.reduceMotion;
    var finishOpt = opts.finish != null && isFinite(opts.finish) ? clamp(+opts.finish, 5, 40) : null;
    var stageEl = opts.stage || null, canvas = opts.canvas, hudCanvas = opts.hud;
    var W = 640, H = 360, dpr = 1;

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, premultipliedAlpha: true });
    renderer.setClearColor(0x000000, 0);
    var scene = new THREE.Scene();
    if (root.CarStage) CarStage.setup(renderer, scene, { exposure: 1.1 });
    var cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 1, 4000);
    var hud = hudCanvas.getContext('2d');
    var maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;

    function resize() {
      W = Math.max(64, root.innerWidth || 640); H = Math.max(36, root.innerHeight || 360);
      dpr = Math.min(2, root.devicePixelRatio || 1);
      renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
      hudCanvas.width = Math.round(W * dpr); hudCanvas.height = Math.round(H * dpr);
      cam.aspect = W / H; cam.updateProjectionMatrix();
    }
    resize();
    root.addEventListener('resize', resize);

    // ---- Theme-Farben aus den Proben im HTML (aufgelöst, also auch color-mix & Co.) ----
    var TK = { surface: '#1d1128', text: '#ffffff', dim: '#c9bdd6', accent: '#f2b705', border: '#5e2a79', font: "'DM Sans', sans-serif" };
    function readTokens() {
      ['surface', 'text', 'dim', 'accent', 'border'].forEach(function (k) {
        var el = document.querySelector('.tk-' + k);
        var c = el && getComputedStyle(el).color;
        if (c) TK[k] = c;
      });
      var f = document.querySelector('.tk-font');
      if (f && getComputedStyle(f).fontFamily) TK.font = getComputedStyle(f).fontFamily;
    }
    readTokens();
    function font(weight, px) { return weight + ' ' + Math.round(px) + 'px ' + TK.font; }
    // Farbe mit Deckkraft (für Hintergründe aus Theme-Farben)
    function withAlpha(css, a) {
      var m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css || '');
      return m ? 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + a + ')' : css;
    }

    // ---- Uhr: Serverzeit (Sekunden) = eigene Uhr + Versatz ----
    var offset = 0, offsetSet = false;
    function srvNow() { return Date.now() / 1000 + offset; }
    function syncClock(serverNow, t0, t1) {
      if (!(serverNow > 0)) return;
      var est = serverNow - (t0 + t1) / 2000;
      if (!offsetSet || Math.abs(est - offset) > 2) { offset = est; offsetSet = true; }
      else offset += (est - offset) * 0.2;
    }

    // ---- kleine Canvas-Texturen ----
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
    var shadowTex = canvasTex(128, 128, function (g) {
      var gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
      gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    });

    // ---- Strecke ----
    var trackGroup = null, trackOwned = [];
    function own(x) { trackOwned.push(x); return x; }
    function buildTrack(T) {
      disposeTrack();
      var g = trackGroup = new THREE.Group();
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
      // Band entlang der Strecke: Seitenversatz a…b, Höhe ya/yb (Wand: a = b, ya ≠ yb); keep(i) je Abschnitt
      function strip(a, b, ya, yb, mat, vLen, keep) {
        var pos = [], uv = [], idx = [];
        for (var i = 0; i <= n; i++) {
          var p = P[i % n];
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
      var rail = own(new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide }));
      [1, -1].forEach(function (sd) {
        var off = sd * (HALF + 3.5);
        strip(off, off, 0.25, 0.85, rail, 10, function (i) {
          var p = P[i], q = P[(i + 1) % n];
          return !nearTrack(p.x + p.nx * off, p.z + p.nz * off, HALF + 2.5) && !nearTrack(q.x + q.nx * off, q.z + q.nz * off, HALF + 2.5);
        });
      });

      // Start/Ziel: Schachbrett über die Fahrbahn + Portal
      var p0 = P[0];
      var checkTex = own(canvasTex(160, 32, function (x, w, h) {
        for (var a = 0; a < 10; a++) for (var b = 0; b < 2; b++) { x.fillStyle = (a + b) % 2 ? '#111' : '#f4f4f4'; x.fillRect(a * 16, b * 16, 16, 16); }
      }));
      var line = new THREE.Mesh(own(new THREE.PlaneGeometry(T.width, 1.6)), own(new THREE.MeshStandardMaterial({ map: checkTex, roughness: 0.7 })));
      line.rotation.set(-Math.PI / 2, p0.yaw + Math.PI / 2, 0, 'YXZ');   // Breite quer zur Fahrtrichtung
      line.position.set(p0.x, 0.06, p0.z); g.add(line);
      var purple = own(new THREE.MeshStandardMaterial({ color: 0x5e2a79, roughness: 0.5 }));
      var gold = own(new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.4, metalness: 0.3 }));
      var gantry = new THREE.Group();
      [1, -1].forEach(function (sd) {
        var post = new THREE.Mesh(own(new THREE.BoxGeometry(0.4, 4.6, 0.4)), purple);
        post.position.set(0, 2.3, sd * (HALF + 1.2)); gantry.add(post);
      });
      var beam = new THREE.Mesh(own(new THREE.BoxGeometry(0.5, 0.9, T.width + 2.8)), purple); beam.position.y = 4.6; gantry.add(beam);
      var stripe = new THREE.Mesh(own(new THREE.BoxGeometry(0.52, 0.18, T.width + 2.82)), gold); stripe.position.y = 4.6; gantry.add(stripe);
      gantry.position.set(p0.x, 0, p0.z); gantry.rotation.y = p0.yaw; g.add(gantry);

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
        var off = sd * (HALF + 13), x = pS.x + pS.nx * off, z = pS.z + pS.nz * off;
        var ok = [-10, 0, 10].every(function (k) { var q = T.at(sMid + k); return !nearTrack(q.x + q.nx * off, q.z + q.nz * off, HALF + 9); });
        if (!ok) return false;
        var st = new THREE.Group();
        for (var r = 0; r < 4; r++) {
          var step = new THREE.Mesh(own(new THREE.BoxGeometry(22, 0.8 + r * 0.8, 1.6)), [standMat, standMat, crowdMat, standMat, standMat, standMat]);
          step.position.set(0, (0.8 + r * 0.8) / 2, -sd * (-2.4 + r * 1.6)); st.add(step);
        }
        var roof = new THREE.Mesh(own(new THREE.BoxGeometry(23, 0.3, 7.5)), purple);
        roof.position.set(0, 5.6, 0); st.add(roof);
        st.position.set(x, 0, z); st.rotation.y = pS.yaw; g.add(st);
        return true;
      });

      // Bäume (InstancedMesh): außerhalb der Strecke, nicht zu weit weg
      var trunkGeo = own(new THREE.CylinderGeometry(0.25, 0.3, 1.6, 6)), crownGeo = own(new THREE.ConeGeometry(1.8, 4.2, 7));
      var trunkMat = own(new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 })), crownMat = own(new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.95 }));
      var spots = [];
      for (var t = 0; t < 900 && spots.length < 90; t++) {
        var x = lerp(minX - 60, maxX + 60, rnd()), z = lerp(minZ - 60, maxZ + 60, rnd());
        if (nearTrack(x, z, HALF + 7) || !nearTrack(x, z, 70)) continue;
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
      }
      scene.add(g);
    }
    function disposeTrack() {
      if (trackGroup) scene.remove(trackGroup);
      trackOwned.forEach(function (x) { if (x && x.dispose) x.dispose(); });
      trackOwned = []; trackGroup = null;
    }

    // ---- Autos ----
    // Modell laden – eine Stelle, damit die leichte Renn-Version (.race.glb, Task 5) hier umgestellt werden kann
    function loadCarModel(entry) { return ToyCars.loadModel(entry); }
    function catalogEntry(key) {
      if (!key) return null;
      var list = ToyCars.catalog ? ToyCars.catalog() : [];
      for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
      return null;
    }
    function hexColor(css, fb) { return /^#[0-9a-f]{6}$/i.test(css || '') ? css : fb; }

    function makeRacer(src) {
      var key = src.car_key || null, entry = catalogEntry(key);
      var raw = root.CarRaceStats ? CarRaceStats.of(key || '', entry || undefined) : { len: 4.5 };
      var st = CarRaceSim.stats(raw);
      var set = key && ToyCars.paintAt ? ToyCars.paintAt(key, src.paint | 0) : { c: null };
      var r = {
        id: src.user_id, grid: src.grid, display: String(src.display || src.user_id || '?'), color: hexColor(src.color, '#9146ff'),
        key: key, uid: src.uid, entry: entry, paint: src.paint | 0, set: set, stats: st, len: st.len,
        w: clamp(st.len * 0.42, 1.7, 2.6), h: clamp(st.len * 0.3, 1.2, 3.2),
        holder: new THREE.Group(), body: null, owned: [], wheels: [], isModel: false,
        steer: 0, wheelAngle: 0, wheelR: clamp(0.07 * st.len, 0.3, 0.55), lastX: null, lastZ: null,
        disp: null, label: null, labelK: 1, labelText: '', gone: false
      };
      r.holder.rotation.order = 'YXZ';
      var shadow = new THREE.Mesh(own2(r, new THREE.PlaneGeometry(1, 1)), own2(r, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.07; r.shadow = shadow; r.holder.add(shadow);
      setBox(r);
      makeLabel(r);
      scene.add(r.holder);
      if (entry) {
        loadCarModel(entry).then(function () { if (!r.gone) setModel(r); }).catch(function () { /* Ersatz-Kiste bleibt */ });
      }
      return r;
    }
    function own2(r, x) { r.owned.push(x); return x; }
    function paintColor(r) {
      var c = r.set && r.set.c != null ? r.set.c : r.color;
      try { return new THREE.Color(c); } catch (e) { return new THREE.Color(r.color); }
    }
    // Ersatz-Kiste in Lackfarbe (bis das Modell geladen ist): Unterbau + Kabine
    function setBox(r) {
      var mat = own2(r, new THREE.MeshStandardMaterial({ color: paintColor(r), roughness: 0.4, metalness: 0.1 }));
      var glass = own2(r, new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.2, metalness: 0.3 }));
      var b = new THREE.Group();
      var low = new THREE.Mesh(own2(r, new THREE.BoxGeometry(r.len, r.h * 0.55, r.w)), mat);
      low.position.y = 0.3 + r.h * 0.275; b.add(low);
      var cab = new THREE.Mesh(own2(r, new THREE.BoxGeometry(r.len * 0.55, r.h * 0.4, r.w * 0.9)), glass);
      cab.position.set(-r.len * 0.05, 0.3 + r.h * 0.55 + r.h * 0.2, 0); b.add(cab);
      r.body = b; r.isModel = false; r.wheels = []; r.height = r.h + 0.3;
      r.holder.add(b);
      r.shadow.scale.set(r.len * 1.15, r.w * 1.4, 1);
    }
    function setModel(r) {
      if (r.isModel) return;
      var model = ToyCars.build(r.key, r.set ? r.set.c : null, r.set || {});
      var d = model.userData.dims || ToyCars.dims(r.key);
      if (!d || !(d.L > 0)) return;
      var k = r.len / d.L;
      model.scale.setScalar(k); model.position.y = d.H / 2 * k;
      if (r.body) r.holder.remove(r.body);   // Kisten-Geometrie wird mit dem Fahrer entsorgt
      r.holder.add(model); r.body = model; r.isModel = true;
      r.height = d.H * k; r.w = d.W * k;
      r.shadow.scale.set(r.len * 1.15, r.w * 1.4, 1);
      // Räder einsammeln (wie js/car-burnout.js): vorn = vorderste Achse oder im Car editor markiert
      var saveP = r.holder.position.clone(), saveR = r.holder.rotation.clone();
      r.holder.position.set(0, 0, 0); r.holder.rotation.set(0, 0, 0); r.holder.updateMatrixWorld(true);
      var wheels = [];
      model.traverse(function (o) {
        if (!/^Wheel /.test(o.name || '')) return;
        var w = new THREE.Vector3(); o.getWorldPosition(w);
        var spin = o.getObjectByName('Spin'), sgn = 1;
        if (spin) {
          var q = new THREE.Quaternion(); spin.getWorldQuaternion(q);
          var axw = new THREE.Vector3(spin.userData.ax === 'z' ? 0 : 1, 0, spin.userData.ax === 'z' ? 1 : 0).applyQuaternion(q);
          sgn = axw.z >= 0 ? 1 : -1;
        }
        wheels.push({ pivot: o, spin: spin, x: w.x, sgn: sgn, flag: o.userData.front, base: spin ? spin.rotation[spin.userData.ax || 'x'] : 0 });
      });
      var maxX = Math.max.apply(null, wheels.map(function (w) { return w.x; }).concat([-1e9]));
      var flagged = wheels.some(function (w) { return w.flag != null; });
      wheels.forEach(function (w) { w.front = flagged ? !!w.flag : w.x > 0 && w.x > maxX - r.len * 0.08; });
      r.wheels = wheels;
      r.holder.position.copy(saveP); r.holder.rotation.copy(saveR);
    }
    function disposeRacer(r) {
      r.gone = true;
      scene.remove(r.holder);
      if (r.label) { scene.remove(r.label.sprite); r.label.tex.dispose(); r.label.sprite.material.dispose(); }
      r.owned.forEach(function (x) { if (x.dispose) x.dispose(); });   // Modell-Materialien gehören ToyCars (geteilt)
    }

    // Lage eines Autos aus Strecke + Zustand; Räder: weiche Lenkung, Drehung aus der gefahrenen Strecke
    function placeCar(r, T, s, d, yaw, roll, pitch, steer, dt) {
      var p = T.at(s), x = p.x + p.nx * d, z = p.z + p.nz * d;
      if (r.lastX != null) {
        var dist = Math.min(6, Math.hypot(x - r.lastX, z - r.lastZ));
        r.wheelAngle = (r.wheelAngle + dist / r.wheelR) % (Math.PI * 2000);
      }
      r.lastX = x; r.lastZ = z;
      r.holder.position.set(x, 0, z);
      r.holder.rotation.set(roll, yaw, pitch);
      r.steer = ease(r.steer, clamp(steer, -0.6, 0.6), 0.12, dt, 1.6);
      for (var i = 0; i < r.wheels.length; i++) {
        var w = r.wheels[i];
        if (w.spin) w.spin.rotation[w.spin.userData.ax || 'x'] = w.base - r.wheelAngle * w.sgn;
        if (w.front) w.pivot.rotation.y = r.steer;
      }
    }

    // ---- Namensschilder (Sprites mit fester Bildschirmgröße) ----
    function makeLabel(r) {
      var c = document.createElement('canvas'); c.width = LABEL_W; c.height = LABEL_H;
      var tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
      var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, opacity: 0 });
      var sp = new THREE.Sprite(mat); sp.center.set(0.5, 0); sp.renderOrder = 10;
      scene.add(sp);
      r.label = { sprite: sp, canvas: c, g: c.getContext('2d'), tex: tex, boxW: LABEL_W, sx: 0, sy: 0, vis: 0 };
    }
    function roundRect(g, x, y, w, h, rad) {
      g.beginPath(); g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad);
      g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath();
    }
    function drawLabel(r, place, force) {
      var text = place + '\u0000' + r.display;
      if (!force && text === r.labelText) return;
      r.labelText = text;
      var L = r.label, g = L.g;
      g.clearRect(0, 0, LABEL_W, LABEL_H);
      var fs = 50, pad = 22, gap = 14, bw = 7;
      g.font = font(800, fs);
      var pw = g.measureText(place).width, name = r.display;
      g.font = font(700, fs);
      var maxName = LABEL_W - 2 * pad - pw - gap - 2 * bw;
      while (name.length > 1 && g.measureText(name).width > maxName) name = name.slice(0, -2) + '…';
      var nw = g.measureText(name).width, boxW = Math.min(LABEL_W - 2 * bw, pw + gap + nw + 2 * pad), x0 = (LABEL_W - boxW) / 2, y0 = bw, bh = LABEL_H - 2 * bw;
      roundRect(g, x0, y0, boxW, bh, 22);
      g.fillStyle = withAlpha(TK.surface, 0.86); g.fill();
      g.lineWidth = bw; g.strokeStyle = r.color; g.stroke();
      g.textBaseline = 'middle';
      g.font = font(800, fs); g.fillStyle = TK.accent; g.fillText(place, x0 + pad, LABEL_H / 2 + 2);
      g.font = font(700, fs); g.fillStyle = TK.text; g.fillText(name, x0 + pad + pw + gap, LABEL_H / 2 + 2);
      L.boxW = boxW + 2 * bw;
      L.tex.needsUpdate = true;
    }
    var tmpV = new THREE.Vector3();
    // Schilder: Text, Größe, Gedränge (hinteres kleiner/blasser), Rand-Fade, Ein-/Ausblenden
    function updateLabels(list, dt) {
      var hpx = clamp(H * 0.055, 13, 30), tanV = Math.tan(FOV * Math.PI / 360);
      var placed = [];
      list.forEach(function (it) {
        var r = it.r, L = r.label;
        drawLabel(r, it.place);
        tmpV.set(r.holder.position.x, r.height + 0.9, r.holder.position.z).project(cam);
        var px = (tmpV.x * 0.5 + 0.5) * W, py = (1 - (tmpV.y * 0.5 + 0.5)) * H, wpx = hpx * L.boxW / LABEL_H;
        var crowd = placed.some(function (o) { return Math.abs(o.px - px) < (o.w + wpx) / 2 && Math.abs(o.py - py) < hpx * 1.1; });
        r.labelK = ease(r.labelK, crowd ? 0 : 1, 0.2, dt);
        var k = lerp(0.62, 1, r.labelK), edge = Math.min(px, W - px, py, H - py);
        var ef = clamp((edge - hpx * 0.5) / (hpx * 2), 0, 1);
        L.vis = ease(L.vis, it.show ? 1 : 0, 0.25, dt);
        var sy = hpx * k / H * 2 * tanV;
        L.sprite.scale.set(sy * LABEL_W / LABEL_H, sy, 1);
        L.sprite.position.set(r.holder.position.x, r.height + 0.9, r.holder.position.z);
        L.sprite.material.opacity = lerp(0.45, 1, r.labelK) * ef * L.vis * (tmpV.z < 1 ? 1 : 0);
        L.sprite.renderOrder = 100 - it.order;   // vordere Plätze liegen oben
        placed.push({ px: px, py: py, w: wpx * k });
      });
    }

    // ---- Rennen (lokaler Zustand) ----
    var race = null, visible = false, finished = {};   // finished: race_ids, die hier schon zu Ende gefahren sind
    function show(on) {
      if (on === visible) return;
      visible = on;
      if (stageEl) stageEl.classList.toggle('is-on', on);
    }
    function newRace(st) {
      teardown();
      var tr = CarRaceSim.TRACKS[((st.track | 0) % CarRaceSim.TRACKS.length + CarRaceSim.TRACKS.length) % CarRaceSim.TRACKS.length];
      var T = CarRaceSim.track(tr);
      race = {
        id: st.race_id, seed: st.seed | 0, T: T, laps: st.laps || 3,
        finishWindow: finishOpt != null ? finishOpt : (st.finish_window || 15),
        startsAt: st.starts_at, stage: 'grid', racers: {}, order: [], gridSim: null, rosterKey: '',
        sim: null, simKey: '', prev: null, alpha: 1, ended: false, fadeAt: null, endedAt: null, shownAt: srvNow(),
        cam: null, lastLeader: null
      };
      buildTrack(T);
    }
    function teardown() {
      if (!race) return;
      Object.keys(race.racers).forEach(function (id) { disposeRacer(race.racers[id]); });
      disposeTrack();
      race = null;
    }
    function simCars() {
      return race.order.map(function (r) { return { id: r.id, stats: r.stats }; });
    }
    // Teilnehmerliste abgleichen (nur vor dem Start); Neuzugänge rollen von hinten auf ihren Platz
    function syncRacers(list) {
      var seen = {}, initial = !race.order.length;
      (list || []).slice().sort(function (a, b) { return a.grid - b.grid; }).forEach(function (src) {
        seen[src.user_id] = 1;
        var r = race.racers[src.user_id];
        if (!r) {
          r = race.racers[src.user_id] = makeRacer(src);
          r.rollIn = !initial;
        }
        r.grid = src.grid;
      });
      Object.keys(race.racers).forEach(function (id) { if (!seen[id]) { disposeRacer(race.racers[id]); delete race.racers[id]; } });
      race.order = Object.keys(race.racers).map(function (id) { return race.racers[id]; }).sort(function (a, b) { return a.grid - b.grid; });
      var key = race.order.map(function (r) { return r.id; }).join('|');
      if (key !== race.rosterKey && race.order.length) {
        race.rosterKey = key;
        race.gridSim = CarRaceSim.create({ seed: race.seed, track: race.T, laps: race.laps, finishWindow: race.finishWindow, cars: simCars() });
        race.order.forEach(function (r, i) {
          var c = race.gridSim.cars[i];
          if (!r.disp) r.disp = { s: r.rollIn ? c.s - 32 : c.s, d: c.d };
        });
      }
    }
    function startSim() {
      race.sim = CarRaceSim.create({ seed: race.seed, track: race.T, laps: race.laps, finishWindow: race.finishWindow, cars: simCars() });
      race.simKey = race.rosterKey + '@' + race.startsAt;
      race.stage = 'race'; race.ended = false;
      var t = srvNow() - race.startsAt;
      if (t > 0.5) { race.sim.fastForward(Math.min(t, 120)); race.cam = null; }   // Neuladen: dieselbe Rennsituation
      snap();
    }
    function snap() {
      race.prev = race.sim.cars.map(function (c) { return { s: c.s, d: c.d, yaw: c.yaw, roll: c.roll, pitch: c.pitch, steer: c.steer }; });
    }
    function advanceSim(target) {
      var sim = race.sim, DT = sim.DT || 1 / 60;
      if (target - sim.time > 1) { sim.fastForward(target - DT); snap(); }
      var guard = 0;
      while (sim.time < target && guard++ < 240) { snap(); sim.step(); }
      race.alpha = clamp(1 - (sim.time - target) / DT, 0, 1);
    }

    // Server-Zustand übernehmen (auch der Vorschau-Zustand läuft hier durch)
    function apply(st) {
      var ph = st.phase;
      if (ph === 'countdown' || ph === 'race') {
        if (!st.race_id || finished[st.race_id]) return;
        if (race && race.id === st.race_id && race.dropAt != null) { race.dropAt = null; }   // wieder genug Fahrer
        if (!race || race.id !== st.race_id) newRace(st);
        if (!race.sim) {
          race.startsAt = st.starts_at;
          syncRacers(st.racers);
          if (ph === 'race') startSim();
        } else if (race.stage === 'race' && (st.starts_at !== race.startsAt || rosterOf(st.racers) !== race.rosterKey)) {
          // Start vorgezogen (10. Fahrer) oder Feld kurz vor dem Start geändert: neu aufsetzen
          race.startsAt = st.starts_at; syncRacers(st.racers); startSim();
        }
        if (race.order.length && race.fadeAt == null) show(true);
      } else if (race && race.dropAt == null && (!race.sim || (race.stage === 'race' && (ph === 'idle' || ph === 'lobby')))) {
        // Lobby wieder unter 3 Fahrern, Rennen abgebrochen oder Server neu gestartet: ausblenden, dann aufräumen.
        // podium/cooldown während des eigenen Rennens: weiterfahren, das Ende kommt aus der Simulation
        show(false); race.dropAt = srvNow();
      }
    }
    function rosterOf(list) {
      return (list || []).slice().sort(function (a, b) { return a.grid - b.grid; }).map(function (r) { return r.user_id; }).join('|');
    }

    // Ende: Ergebnis einmal melden, dann Siegerehrung (Task 7) bzw. Endstand halten und ausblenden
    function finishRace() {
      race.ended = true; race.stage = 'end'; race.endedAt = srvNow();
      finished[race.id] = true;
      var result = race.sim.result(), id = race.id, places = result.map(function (r) { return r.place; });
      if (preview) { showPodium(result, null); return; }
      fetch(base + 'api/fx/car-race/result', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ race_id: id, places: places })
      }).then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (resp) {
        if (race && race.id === id) showPodium(result, resp);
      });
    }
    // Haken für Task 7 (Podest, Punkte, Monatsrang aus resp.points): vorerst Endstand ~5 s halten, dann ausblenden
    function showPodium(result, response) {
      race.podium = { result: result, response: response };
      race.fadeAt = srvNow() + HOLD;
    }

    // ---- Kamera ----
    function camFit(points) {
      // points: [{x, z}] in Reihenfolge (vorn zuerst); Spitzengruppe, solange die Zoom-Grenze hält
      var effW = W * 0.78, MX = 9, MZ = 7, sinT = Math.sin(TILT);
      var minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, px = PX_MAX, used = 0;
      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        var nx0 = Math.min(minX, p.x), nx1 = Math.max(maxX, p.x), nz0 = Math.min(minZ, p.z), nz1 = Math.max(maxZ, p.z);
        var need = Math.min(effW / (nx1 - nx0 + 2 * MX), H / ((nz1 - nz0 + 2 * MZ) * sinT));
        if (i > 0 && need < PX_MIN) break;
        minX = nx0; maxX = nx1; minZ = nz0; maxZ = nz1; px = need; used++;
      }
      if (!used) return null;
      px = clamp(px, PX_MIN, PX_MAX);
      // Inhalt etwas rechts der Mitte: links steht die Rangliste
      return { x: (minX + maxX) / 2 - (W * 0.11) / px, z: (minZ + maxZ) / 2, px: px };
    }
    function updateCamera(points, dt) {
      var fit = camFit(points);
      if (!fit) return;
      var c = race.cam, tauP = reduce ? 1.6 : 0.8, tauZ = reduce ? 2.6 : 1.3;
      if (!c) c = race.cam = { x: fit.x, z: fit.z, lp: Math.log(fit.px), tx: fit.x, tz: fit.z, vx: 0, vz: 0 };
      // Vorhalt: geschätzte Geschwindigkeit des Ziels, damit die Dämpfung nicht hinterherhängt
      var vx = (fit.x - c.tx) / Math.max(dt, 1e-3), vz = (fit.z - c.tz) / Math.max(dt, 1e-3);
      var vmax = 30, vl = Math.hypot(vx, vz); if (vl > vmax) { vx *= vmax / vl; vz *= vmax / vl; }
      c.vx = ease(c.vx, vx, 0.5, dt); c.vz = ease(c.vz, vz, 0.5, dt);
      c.tx = fit.x; c.tz = fit.z;
      c.x = ease(c.x, fit.x + c.vx * tauP, tauP, dt); c.z = ease(c.z, fit.z + c.vz * tauP, tauP, dt);
      c.lp = ease(c.lp, Math.log(fit.px), tauZ, dt);
      var px = Math.exp(c.lp), visW = W / px, tanH = Math.tan(FOV * Math.PI / 360) * (W / H);
      var D = visW / (2 * tanH);
      cam.position.set(c.x, D * Math.sin(TILT), c.z + D * Math.cos(TILT));
      cam.lookAt(c.x, 0, c.z);
    }

    // ---- HUD (2D-Canvas) ----
    function rankingRows() {
      var rows = [];
      if (race.stage === 'grid') {
        race.order.forEach(function (r) { rows.push({ r: r, place: String(r.grid), dnf: false, fin: false }); });
      } else {
        var sim = race.sim, ids = sim.standings(), byId = {};
        sim.cars.forEach(function (c, i) { byId[c.id] = { c: c, r: race.order[i] }; });
        ids.forEach(function (id) {
          var o = byId[id]; if (!o) return;
          var dnf = o.c.place == null && (o.c.state === 'dnf' || sim.done);
          rows.push({ r: o.r, c: o.c, place: dnf ? 'DNF' : String(o.c.place != null ? o.c.place : o.c.pos), dnf: dnf, fin: o.c.place != null });
        });
      }
      return rows;
    }
    function fitText(g, s, maxW) {
      if (g.measureText(s).width <= maxW) return s;
      while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      return s + '…';
    }
    function pill(g, x, y, w, h) {
      roundRect(g, x, y, w, h, h * 0.3);
      g.fillStyle = withAlpha(TK.surface, 0.82); g.fill();
      g.lineWidth = Math.max(1, h * 0.05); g.strokeStyle = TK.border; g.stroke();
    }
    function drawHud(now, rows) {
      hud.setTransform(dpr, 0, 0, dpr, 0, 0);
      hud.clearRect(0, 0, W, H);
      if (!race) return;
      var m = Math.round(Math.min(W * 0.045, H * 0.07)), rh = clamp(H * 0.05, 12, 28), fs = rh * 0.62;
      // Rangliste links oben
      var pw = rh * 7.4, ph = rows.length * rh + rh * 0.4;
      pill(hud, m, m, pw, ph);
      hud.textBaseline = 'middle';
      rows.forEach(function (row, i) {
        var y = m + rh * 0.2 + i * rh + rh / 2;
        hud.globalAlpha = row.dnf ? 0.6 : 1;
        hud.font = font(800, fs); hud.textAlign = 'right';
        hud.fillStyle = row.dnf ? TK.dim : TK.accent;
        hud.fillText(row.place, m + rh * (row.dnf ? 1.7 : 1.15), y);
        if (!row.dnf) {
          hud.beginPath(); hud.arc(m + rh * 1.55, y, rh * 0.17, 0, Math.PI * 2); hud.fillStyle = row.r.color; hud.fill();
        }
        hud.textAlign = 'left'; hud.font = font(row.fin ? 800 : 600, fs);
        hud.fillStyle = row.fin ? TK.accent : TK.text;
        hud.fillText(fitText(hud, row.r.display, pw - rh * 2.25), m + rh * 1.95, y);
        hud.globalAlpha = 1;
      });
      // Runde rechts oben
      var lapText = null;
      if (race.stage === 'grid') lapText = race.laps + ' LAPS';
      else if (race.stage === 'end') lapText = 'FINAL';
      else {
        var lead = rows[0] && rows[0].c;
        lapText = lead && lead.place != null ? 'FINISH' : 'LAP ' + clamp(lead ? lead.lap : 1, 1, race.laps) + '/' + race.laps;
      }
      hud.font = font(800, fs * 1.05);
      var lw = hud.measureText(lapText).width + rh * 0.9;
      pill(hud, W - m - lw, m, lw, rh * 1.15);
      hud.textAlign = 'center'; hud.fillStyle = TK.text; hud.fillText(lapText, W - m - lw / 2, m + rh * 0.6);
      // Countdown
      var left = race.startsAt != null ? race.startsAt - now : null;
      if (race.stage === 'grid' && left != null) {
        if (left > 5) {
          var sec = Math.ceil(left), t = 'STARTS IN ' + Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2);
          hud.font = font(800, fs * 1.1);
          var tw = hud.measureText(t).width + rh * 1.2;
          pill(hud, (W - tw) / 2, m, tw, rh * 1.25);
          hud.fillStyle = TK.text; hud.fillText(t, W / 2, m + rh * 0.65);
          hud.font = font(600, fs * 0.9); hud.fillStyle = TK.dim;
          hud.fillText('!race to join · ' + race.order.length + '/10', W / 2, m + rh * 1.85);
        } else bigText(String(Math.max(1, Math.ceil(left))), left % 1);
      } else if (race.stage === 'race' && left != null && -left < 1.2) {
        bigText('GO!', 1 + left / 1.2);
      }
    }
    // große Zahl in der Mitte, pulst je Sekunde (bei reduzierter Bewegung ruhig)
    function bigText(t, frac) {
      var k = reduce ? 1 : 1 + 0.25 * clamp(frac, 0, 1), sz = H * 0.2 * k;
      hud.save();
      hud.globalAlpha = clamp(reduce ? 1 : 0.35 + frac, 0, 1);
      hud.font = font(900, sz); hud.textAlign = 'center'; hud.textBaseline = 'middle';
      hud.lineWidth = sz * 0.08; hud.strokeStyle = withAlpha(TK.surface, 0.9); hud.strokeText(t, W / 2, H * 0.42);
      hud.fillStyle = TK.accent; hud.fillText(t, W / 2, H * 0.42);
      hud.restore();
    }

    // ---- Bildschleife ----
    var lastTs = null, idleCleared = false;
    function frame(ts) {
      requestAnimationFrame(frame);
      var dt = lastTs == null ? 1 / 60 : Math.min(0.1, (ts - lastTs) / 1000); lastTs = ts;
      if (preview) previewTick();
      if (!race) {
        if (!idleCleared) { renderer.clear(); hud.setTransform(1, 0, 0, 1, 0, 0); hud.clearRect(0, 0, hudCanvas.width, hudCanvas.height); idleCleared = true; }
        return;
      }
      idleCleared = false;
      var now = srvNow(), T = race.T;
      // Abbruch/Ende: ausgeblendet → aufräumen
      if (race.dropAt != null && !visible) { if (now - race.dropAt > FADE + 0.2) { teardown(); return; } }
      if (race.fadeAt != null && now >= race.fadeAt) {
        if (visible) show(false);
        if (now - race.fadeAt > FADE + 0.2) { teardown(); if (preview) previewReset(); return; }
      }
      // lokal starten, sobald der Countdown abgelaufen ist (der Server zieht beim nächsten Poll nach)
      if (race.stage === 'grid' && race.startsAt != null && now >= race.startsAt && race.order.length >= 3 && race.dropAt == null) startSim();

      var pts = [], labels = [];
      if (race.stage === 'grid') {
        if (race.gridSim) race.order.forEach(function (r, i) {
          var c = race.gridSim.cars[i];
          if (!r.disp) r.disp = { s: c.s, d: c.d };
          var dsv = c.s - r.disp.s, ddv = c.d - r.disp.d;
          r.disp.s += clamp(dsv, -dt * Math.min(18, Math.abs(dsv) * 2.2), dt * Math.min(18, Math.abs(dsv) * 2.2));
          r.disp.d += clamp(ddv, -dt * 4, dt * 4);
          var lean = Math.abs(dsv) > 0.3 ? clamp(Math.atan2(ddv * 0.4, Math.abs(dsv) + 2), -0.25, 0.25) : 0;
          placeCar(r, T, r.disp.s, r.disp.d, T.at(r.disp.s).yaw + lean, 0, 0, lean * 2, dt);
          pts.push({ x: r.holder.position.x, z: r.holder.position.z });
          labels.push({ r: r, place: String(r.grid), show: true, order: i });
        });
      } else {
        advanceSim(now - race.startsAt);
        var sim = race.sim, a = race.alpha;
        sim.cars.forEach(function (c, i) {
          var p = race.prev[i] || c, r = race.order[i];
          placeCar(r, T, lerp(p.s, c.s, a), lerp(p.d, c.d, a), lerp(p.yaw, c.yaw, a), lerp(p.roll, c.roll, a), lerp(p.pitch, c.pitch, a), lerp(p.steer, c.steer, a), dt);
        });
        if (sim.done && !race.ended) finishRace();
        // Kamera-Ziel: alle, die noch fahren (vorn zuerst); sind alle durch, das ganze Feld ohne DNF
        var ids = sim.standings(), idx = {};
        sim.cars.forEach(function (c, i) { idx[c.id] = i; });
        var active = ids.filter(function (id) { var c = sim.cars[idx[id]]; return c.place == null && c.state !== 'dnf' && !sim.done; });
        if (!active.length) active = ids.filter(function (id) { var c = sim.cars[idx[id]]; return c.state !== 'dnf' && !(sim.done && c.place == null); });
        if (!active.length) active = ids;
        active.forEach(function (id) { var r = race.order[idx[id]]; pts.push({ x: r.holder.position.x, z: r.holder.position.z }); });
        ids.forEach(function (id, o) {
          var c = sim.cars[idx[id]], r = race.order[idx[id]];
          var dnf = c.place == null && (c.state === 'dnf' || sim.done);
          labels.push({ r: r, place: dnf ? 'DNF' : String(c.place != null ? c.place : c.pos), show: true, order: o });
        });
      }
      updateCamera(pts, dt);
      cam.updateMatrixWorld();
      updateLabels(labels, dt);
      renderer.render(scene, cam);
      drawHud(now, rankingRows());
    }

    // ---- Server-Poll ----
    function poll() {
      var t0 = Date.now();
      fetch(base + 'api/fx/car-race/state', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (st) { if (st) { syncClock(st.now, t0, Date.now()); apply(st); } })
        .catch(function () { /* nächster Versuch */ })
        .then(function () { setTimeout(poll, POLL_MS); });
    }

    // ---- Vorschau: lokale Lobby ohne Server ----
    var pv = null, pvN = 0, pvResetAt = null;
    function pvCars() {
      return (ToyCars.catalog ? ToyCars.catalog() : []).filter(function (e) {
        var v = ToyCars.vehicle(e.key) || {};
        return v.mix !== false && !(v.race && v.race.on === false);
      });
    }
    function previewReset() {
      pvResetAt = null;
      var trackOpt = parseInt(opts.track, 10);
      pv = { phase: 'lobby', race_id: 'preview-' + Date.now().toString(36), seed: Math.floor(Math.random() * 2147483647),
        track: isFinite(trackOpt) ? trackOpt : Math.floor(Math.random() * 1000), laps: 3, finish_window: 15, starts_at: null, racers: [] };
      pvN = 0;
      for (var i = 0; i < 3; i++) addTestRacer();
    }
    function addTestRacer() {
      if (!pv || (pv.phase !== 'lobby' && pv.phase !== 'countdown') || pv.racers.length >= 10) return;
      var cars = pvCars(), taken = pv.racers.map(function (r) { return r.car_key; });
      var free = cars.filter(function (e) { return taken.indexOf(e.key) < 0; });
      var pick = (free.length ? free : cars)[Math.floor(Math.random() * Math.max(1, (free.length ? free : cars).length))] || null;
      var paints = pick ? (ToyCars.vehicle(pick.key) || {}).paints : null;
      pvN++;
      pv.racers.push({ grid: pv.racers.length + 1, user_id: 'test' + pvN, display: 'Tester' + pvN, color: PREVIEW_COLORS[(pvN - 1) % PREVIEW_COLORS.length],
        car_key: pick ? pick.key : null, uid: pick ? pick.uid : null,
        paint: Array.isArray(paints) && paints.length ? Math.floor(Math.random() * paints.length) : 0 });
      var now = Date.now() / 1000;
      if (pv.racers.length >= 10) { pv.phase = 'race'; pv.starts_at = now; }
      else if (pv.racers.length >= 3 && pv.phase === 'lobby') { pv.phase = 'countdown'; pv.starts_at = now + 60; }
      previewInfo();
      apply(pvView());
    }
    function startNow() {
      if (!pv || pv.phase !== 'countdown') return;
      pv.phase = 'race'; pv.starts_at = Date.now() / 1000;
      previewInfo();
      apply(pvView());
    }
    function pvView() { return Object.assign({ now: Date.now() / 1000 }, pv, { racers: pv.racers.slice() }); }
    function previewInfo() {
      if (!opts.onPreviewInfo || !pv) return;
      var open = pv.phase === 'lobby' || pv.phase === 'countdown';
      opts.onPreviewInfo('Preview · ' + pv.racers.length + '/10 racers · ' + (open ? 'countdown' : 'racing'),
        open && pv.racers.length < 10, pv.phase === 'countdown');
    }
    var pvLast = 0;
    function previewTick() {
      if (!pv) return;
      var now = Date.now() / 1000;
      if (now - pvLast < 0.25) return;
      pvLast = now;
      if (pv.phase === 'countdown' && now >= pv.starts_at) { pv.phase = 'race'; previewInfo(); }
      apply(pvView());
    }

    // ---- Start ----
    if (document.fonts && document.fonts.load) {
      document.fonts.load('700 40px "DM Sans"').then(function () {
        readTokens();
        if (race) race.order.forEach(function (r) { drawLabel(r, r.labelText.split('\u0000')[0] || '', true); });
      }).catch(function () {});
    }
    var catReady = (ToyCars.loadCatalog ? ToyCars.loadCatalog() : Promise.resolve([])).catch(function () { return []; });
    catReady.then(function () {
      if (preview) { offset = 0; previewReset(); }
      else poll();
      requestAnimationFrame(frame);
    });

    return { addTestRacer: addTestRacer, startNow: startNow };
  }

  root.CarRace = { start: start };
})(typeof window !== 'undefined' ? window : this);
