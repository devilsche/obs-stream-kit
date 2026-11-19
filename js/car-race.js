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
 * Sichtbar aus der Sim: Auslauf (Kiesbett an Kurven-Außenseiten, Leitplanke an dessen Rand), Ölflecken (sim.hazards),
 * Windschatten (cars[i].draft), Ereignisse (sim.events: overtake → Schild leuchtet + Rangliste gleitet, spin/crash →
 * Qualm, off → Staub, push → Funken + Ruck, dnf → graues Schild). Nach fastForward nur Ereignisse der letzten 1,5 s.
 * Darstellung in Metern (wie die Simulation); ToyCars-Modelle werden auf die Länge aus den Race stats skaliert.
 * Farben je Fahrer (Chatfarbe, Lack) nur im Canvas/WebGL – keine Inline-Styles.
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  // Kamera: Pixel je Meter (4,5-m-Auto 20…60 px); die Fenstergröße ändert nur den Ausschnitt
  var PX_MIN = 20 / 4.5, PX_MAX = 60 / 4.5;
  var TILT = 58 * Math.PI / 180, FOV = 30;
  var MAX_STEER = 0.42;   // größter Lenkeinschlag der Vorderräder (rad), wie in der Simulation
  var POLL_MS = 1000, HOLD = 5, FADE = 0.6, PODIUM_HOLD = 12;
  var LABEL_W = 512, LABEL_H = 112;
  var FLASH = 1.4;          // s, so lange leuchtet das Schild nach einem Überholmanöver
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
    var trackGroup = null, trackOwned = [], trackNear = null;   // trackNear(x, z, R): liegt Strecke näher als R?
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
      var purple = own(new THREE.MeshStandardMaterial({ color: 0x5e2a79, roughness: 0.5 }));
      var gold = own(new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.4, metalness: 0.3 }));
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
      }
      trackNear = nearTrack;
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
        disp: null, label: null, labelK: 1, labelText: '', gone: false, flash: 0, jolt: 0, rankY: null
      };
      r.holder.rotation.order = 'YXZ';
      // Vorschau: Modellname mit anzeigen (zur Fehlersuche „welches Auto war das?“), echte Rennen nur der Chatname
      var model = entry ? String(entry.name || key) : key ? String(key) : 'placeholder box';
      if (model.length > 22) model = model.slice(0, 21) + '\u2026';
      r.shown = preview ? r.display + ' \u00b7 ' + model : r.display;
      if (preview && root.console) console.info('Car Race preview: grid ' + src.grid + ' ' + r.display + ' = ' + (key || '(no car)') + (entry ? ' (' + entry.name + ', front ' + (entry.front || 'auto') + ')' : ''));
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
      // Plausibilität: hängt an einer Radgruppe mehr als ein Rad (z. B. die Karosserie, weil die automatische
      // Raderkennung bei Modellen aus wenigen Netzen zu viel greift), würde sie mitrollen/mitlenken und die
      // Karosserie mit Renntempo um die Achse wirbeln („nur die Räder fahren“) – solche Gruppen bleiben stehen
      var bad = [];
      wheels = wheels.filter(function (w) {
        var b = new THREE.Box3().setFromObject(w.pivot), sz = new THREE.Vector3(); b.getSize(sz);
        var ok = !b.isEmpty() && sz.x <= r.len * 0.45 && sz.y <= Math.max(r.height * 0.9, 0.5);
        if (!ok) bad.push(w.pivot.name);
        return ok;
      });
      if (bad.length && root.console) console.warn('Car Race: ' + r.key + ' – wheel groups too big (body in the wheel?), not animated: ' + bad.join(', '));
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
      if (r.streak) r.streak.meshes.forEach(function (m) { scene.remove(m); });
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
      r.steer = ease(r.steer, clamp(steer, -MAX_STEER, MAX_STEER), 0.12, dt, 1.6);
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
    // mode: '' normal · 'up' gerade überholt (Akzentrand, Pfeil nach oben, leuchtet) · 'dnf' ausgegraut
    function drawLabel(r, place, force, mode) {
      mode = mode || '';
      var text = place + '\u0000' + r.shown + '\u0000' + mode;
      if (!force && text === r.labelText) return;
      r.labelText = text; r.labelPlace = place; r.labelMode = mode;
      var L = r.label, g = L.g;
      g.clearRect(0, 0, LABEL_W, LABEL_H);
      var fs = preview ? 38 : 50, pad = 22, gap = 14, bw = 7;   // Vorschau: längerer Text (Modellname)
      g.font = font(800, fs);
      var aw = mode === 'up' ? fs * 0.62 : 0;   // Platz für den Pfeil
      var pw = g.measureText(place).width + aw, name = r.shown;
      g.font = font(700, fs);
      var maxName = LABEL_W - 2 * pad - pw - gap - 2 * bw - (mode === 'up' ? 16 : 0);
      while (name.length > 1 && g.measureText(name).width > maxName) name = name.slice(0, -2) + '…';
      var nw = g.measureText(name).width, boxW = Math.min(LABEL_W - 2 * bw, pw + gap + nw + 2 * pad), x0 = (LABEL_W - boxW) / 2, y0 = bw, bh = LABEL_H - 2 * bw;
      roundRect(g, x0, y0, boxW, bh, 22);
      g.fillStyle = withAlpha(TK.surface, mode === 'dnf' ? 0.7 : 0.86); g.fill();
      if (mode === 'up') { g.fillStyle = withAlpha(TK.accent, 0.25); g.fill(); }
      g.lineWidth = bw; g.strokeStyle = mode === 'up' ? TK.accent : mode === 'dnf' ? TK.dim : r.color; g.stroke();
      g.textBaseline = 'middle';
      var tx = x0 + pad;
      if (mode === 'up') {   // Pfeil nach oben (gezeichnet, kein Zeichen aus der Schrift)
        var ah = fs * 0.62, ay = LABEL_H / 2;
        g.beginPath(); g.moveTo(tx, ay + ah * 0.4); g.lineTo(tx + ah * 0.5, ay - ah * 0.5); g.lineTo(tx + ah, ay + ah * 0.4); g.closePath();
        g.fillStyle = TK.accent; g.fill(); tx += aw;
      }
      g.font = font(800, fs); g.fillStyle = mode === 'dnf' ? TK.dim : TK.accent; g.fillText(place, tx, LABEL_H / 2 + 2);
      g.font = font(700, fs); g.fillStyle = mode === 'dnf' ? TK.dim : TK.text; g.fillText(name, x0 + pad + pw + gap, LABEL_H / 2 + 2);
      L.boxW = boxW + 2 * bw;
      L.tex.needsUpdate = true;
    }
    var tmpV = new THREE.Vector3();
    // Schilder: Text, Größe, Gedränge (hinteres kleiner/blasser), Rand-Fade, Ein-/Ausblenden
    function updateLabels(list, dt) {
      var hpx = clamp(H * 0.055, 13, 30), tanV = Math.tan(FOV * Math.PI / 360);
      var placed = [];
      list.forEach(function (it) {
        var r = it.r, L = r.label, up = r.flash > 0;
        drawLabel(r, it.place, false, it.dnf ? 'dnf' : up ? 'up' : '');
        tmpV.set(r.holder.position.x, r.holder.position.y + r.height + 0.9, r.holder.position.z).project(cam);
        var px = (tmpV.x * 0.5 + 0.5) * W, py = (1 - (tmpV.y * 0.5 + 0.5)) * H, wpx = hpx * L.boxW / LABEL_H;
        var crowd = placed.some(function (o) { return Math.abs(o.px - px) < (o.w + wpx) / 2 && Math.abs(o.py - py) < hpx * 1.1; });
        r.labelK = ease(r.labelK, crowd && !up ? 0 : 1, 0.2, dt);
        // Überholt: kurzer Puls (bei reduzierter Bewegung nur der Akzentrand)
        var pulse = up && !reduce ? 1 + 0.18 * Math.sin(Math.min(1, (FLASH - r.flash) / 0.5) * Math.PI) : 1;
        var k = lerp(0.62, 1, r.labelK) * pulse, edge = Math.min(px, W - px, py, H - py);
        var ef = clamp((edge - hpx * 0.5) / (hpx * 2), 0, 1);
        L.vis = ease(L.vis, it.show ? 1 : 0, 0.25, dt);
        var sy = hpx * k / H * 2 * tanV;
        L.sprite.scale.set(sy * LABEL_W / LABEL_H, sy, 1);
        L.sprite.position.set(r.holder.position.x, r.holder.position.y + r.height + 0.9, r.holder.position.z);
        L.sprite.material.opacity = lerp(0.45, 1, r.labelK) * (it.dnf ? 0.6 : 1) * ef * L.vis * (tmpV.z < 1 ? 1 : 0);
        L.sprite.renderOrder = up ? 200 : 100 - it.order;   // vordere Plätze (und der Überholende) liegen oben
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
        finishWindow: preview && finishOpt != null ? finishOpt : (st.finish_window || 15),   // ?finish nur in der Vorschau: echte Rennen nehmen den Server-Wert, damit jede Instanz dasselbe Ergebnis rechnet
        startsAt: st.starts_at, stage: 'grid', racers: {}, order: [], gridSim: null, rosterKey: '',
        sim: null, simKey: '', prev: null, alpha: 1, ended: false, fadeAt: null, endedAt: null, shownAt: srvNow(),
        cam: null, lastLeader: null, evIdx: 0, oil: []
      };
      buildTrack(T);
    }
    function teardown() {
      if (!race) return;
      Object.keys(race.racers).forEach(function (id) { disposeRacer(race.racers[id]); });
      clearOil(); clearPuffs();
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
      race.stage = 'race'; race.ended = false; race.evIdx = 0; clearOil();
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
    var waitLogged = false;
    function apply(st) {
      var ph = st.phase;
      if (!preview && !race && (ph === 'idle' || ph === 'lobby') && !waitLogged) {
        waitLogged = true;   // leere Seite erklärbar machen (Dashboard-Link ohne ?preview=1)
        if (root.console && console.info) console.info('Car Race: waiting for !race \u2013 add ?preview=1 to test');
      }
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
    // ---- Siegerehrung ----
    // Podest neben der Ziellinie, hinter jedem möglichen Auslauf; Plätze 1–3 auf Blöcken (2 · 1 · 3),
    // Punkte aus der Server-Antwort (nur gezählte Rennen), DNF-Liste klein darunter; ~12 s, dann ausblenden.
    var PODIUM_COL = { 1: ['#f2b705', 0xf2b705], 2: ['#c3c9d2', 0xc3c9d2], 3: ['#c07a3e', 0xc07a3e] };
    function showPodium(result, response) {
      var top = result.filter(function (x) { return x.place != null && x.place <= 3; }).sort(function (a, b) { return a.place - b.place; });
      var byId = {}; race.order.forEach(function (r) { byId[r.id] = r; });
      var pts = response && response.counted && response.points ? response.points : null;
      var cars = top.map(function (x) { return { r: byId[x.id], place: x.place, pts: pts ? pts[x.id] || null : null }; }).filter(function (c) { return c.r; });
      if (!cars.length) {   // niemand im Ziel: Endstand halten, dann ausblenden
        race.podium = { result: result, response: response };
        race.fadeAt = srvNow() + HOLD;
        return;
      }
      var dnf = result.filter(function (x) { return x.place == null; }).map(function (x) { return byId[x.id]; }).filter(Boolean);
      // Blöcke: Breite nach Autolänge, Reihenfolge links → rechts 2 · 1 · 3
      var seq = [2, 1, 3].map(function (pl) { return cars.filter(function (c) { return c.place === pl; })[0]; }).filter(Boolean);
      var widths = seq.map(function (c) { return Math.max(5, c.r.len * 0.95 + 1.2); }), total = widths.reduce(function (a, b) { return a + b; }, 0);
      var spot = podiumSpot(total + 2);
      var g = new THREE.Group(); g.position.set(spot.x, 0, spot.z); trackGroup.add(g);
      var plinth = new THREE.Mesh(own(new THREE.BoxGeometry(total + 2, 0.25, 6)), own(new THREE.MeshStandardMaterial({ color: 0x5e2a79, roughness: 0.6 })));
      plinth.position.y = 0.125; g.add(plinth);
      var x = -total / 2;
      seq.forEach(function (c, i) {
        var bw = widths[i], h = c.place === 1 ? 1.7 : c.place === 2 ? 1.2 : 0.85, col = PODIUM_COL[c.place];
        var side = own(new THREE.MeshStandardMaterial({ color: col[1], roughness: 0.35, metalness: 0.4 }));
        var front = own(new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2, map: own(canvasTex(128, 96, function (q, w, hh) {
          q.fillStyle = col[0]; q.fillRect(0, 0, w, hh);
          q.fillStyle = 'rgba(20,12,30,0.85)'; q.font = font(900, 72); q.textAlign = 'center'; q.textBaseline = 'middle';
          q.fillText(String(c.place), w / 2, hh / 2 + 4);
        })) }));
        var block = new THREE.Mesh(own(new THREE.BoxGeometry(bw - 0.2, h, 4)), [side, side, side, side, front, side]);
        block.position.set(x + bw / 2, 0.25 + h / 2, 0); g.add(block);
        c.x = spot.x + x + bw / 2; c.z = spot.z; c.top = 0.25 + h;
        x += bw;
        // Auto aufs Podest: leicht zur Kamera gedreht, Räder gerade
        var r = c.r;
        r.holder.position.set(c.x, c.top, c.z); r.holder.rotation.set(0, -0.3, 0);
        r.steer = 0; r.wheels.forEach(function (w) { if (w.front) w.pivot.rotation.y = 0; });
      });
      // Übrige Autos, Schlieren und Schilder ausblenden
      var onPodium = {}; cars.forEach(function (c) { onPodium[c.r.id] = 1; });
      race.order.forEach(function (r) {
        if (r.streak) r.streak.meshes.forEach(function (m) { m.visible = false; });
        if (!onPodium[r.id]) { r.holder.visible = false; r.label.sprite.visible = false; }
      });
      var px = clamp(W * 0.72 / (total + 4), PX_MIN, 24);
      race.podium = { result: result, response: response, cars: cars, dnf: dnf, t: 0, counted: !!pts,
        cam: { x: spot.x, z: spot.z, y: 1.6, px: px } };
      race.stage = 'podium';
      race.fadeAt = srvNow() + PODIUM_HOLD;
      upgradeWinnerModel(cars[0]);
    }
    // freier Platz fürs Podest kurz vor der Ziellinie (Seite egal), sonst weiter draußen
    function podiumSpot(width) {
      var T = race.T, HALF = T.width / 2, p = T.at(-14), best = null;
      [HALF + 22, HALF + 32, HALF + 45].some(function (off) {
        return [1, -1].some(function (sd) {
          var x = p.x + p.nx * off * sd, z = p.z + p.nz * off * sd;
          var free = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].every(function (k) {
            return !trackNear || !trackNear(x + k[0] * width / 2, z + k[1] * 3.5, HALF + 12 + 3);
          });
          if (free) best = { x: x, z: z };
          return free;
        });
      });
      return best || { x: p.x + p.nx * (HALF + 22), z: p.z + p.nz * (HALF + 22) };
    }
    // Sieger in voller Qualität: heute sind alle Modelle voll (leichte Renn-Modelle, Task 5, fehlen noch) –
    // hier später das volle Modell nachladen (Fallback: Renn-Version). Jetzt nur: steht noch die Kiste, Modell laden.
    function upgradeWinnerModel(c) {
      var r = c.r;
      if (r.isModel || !r.entry) return;
      loadCarModel(r.entry).then(function () {
        if (r.gone || !race || race.stage !== 'podium') return;
        setModel(r);
        r.holder.position.set(c.x, c.top, c.z); r.holder.rotation.set(0, -0.3, 0);
      }).catch(function () {});
    }
    function drawPodiumHud() {
      var pd = race.podium, m = Math.round(Math.min(W * 0.045, H * 0.07)), rh = clamp(H * 0.05, 12, 28), fs = rh * 0.62;
      hud.textBaseline = 'middle'; hud.textAlign = 'center';
      hud.font = font(800, fs * 1.1);
      var title = 'RACE RESULTS', tw = hud.measureText(title).width + rh * 1.2;
      pill(hud, (W - tw) / 2, m, tw, rh * 1.25);
      hud.fillStyle = TK.accent; hud.fillText(title, W / 2, m + rh * 0.65);
      // Punkte je Podestplatz unter dem Block: „+10 → 47 pts · #2 this month“
      pd.cars.forEach(function (c) {
        if (!c.pts) return;
        var t = '+' + (c.pts.gained | 0) + ' → ' + (c.pts.month_total | 0) + ' pts' + (c.pts.month_rank ? ' · #' + c.pts.month_rank + ' this month' : '');
        tmpV.set(c.x, 0, c.z + 2.6).project(cam);
        var px = (tmpV.x * 0.5 + 0.5) * W, py = (1 - (tmpV.y * 0.5 + 0.5)) * H + rh * 0.5;
        hud.font = font(700, fs * 0.85);
        var w = hud.measureText(t).width + rh * 0.8;
        px = clamp(px, m + w / 2, W - m - w / 2); py = clamp(py, m + rh * 2, H - m - rh * 2.4);
        pill(hud, px - w / 2, py - rh * 0.5, w, rh);
        hud.fillStyle = c.place === 1 ? TK.accent : TK.text; hud.fillText(t, px, py);
      });
      if (pd.dnf.length) {
        hud.font = font(600, fs * 0.8);
        var d = fitText(hud, 'DNF: ' + pd.dnf.map(function (r) { return r.display; }).join(' · '), W - 2 * m - rh);
        var dw = hud.measureText(d).width + rh * 0.8, dy = H - m - rh * 1.8;
        pill(hud, (W - dw) / 2, dy - rh * 0.45, dw, rh * 0.9);
        hud.fillStyle = TK.dim; hud.fillText(d, W / 2, dy);
      }
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
    // fixed: festes Ziel {x, z, px} (Podest) statt Feld-Anpassung
    function updateCamera(points, dt, fixed) {
      var fit = fixed || camFit(points);
      if (!fit) return;
      var c = race.cam, tauP = reduce ? 1.6 : 0.8, tauZ = reduce ? 2.6 : 1.3;
      if (!c) c = race.cam = { x: fit.x, z: fit.z, lp: Math.log(fit.px), tx: fit.x, tz: fit.z, vx: 0, vz: 0 };
      // Vorhalt: geschätzte Geschwindigkeit des Ziels, damit die Dämpfung nicht hinterherhängt
      var vx = fixed ? 0 : (fit.x - c.tx) / Math.max(dt, 1e-3), vz = fixed ? 0 : (fit.z - c.tz) / Math.max(dt, 1e-3);
      var vmax = 30, vl = Math.hypot(vx, vz); if (vl > vmax) { vx *= vmax / vl; vz *= vmax / vl; }
      c.vx = ease(c.vx, vx, 0.5, dt); c.vz = ease(c.vz, vz, 0.5, dt);
      c.tx = fit.x; c.tz = fit.z;
      c.x = ease(c.x, fit.x + c.vx * tauP, tauP, dt); c.z = ease(c.z, fit.z + c.vz * tauP, tauP, dt);
      c.lp = ease(c.lp, Math.log(fit.px), tauZ, dt);
      c.ty = ease(c.ty || 0, fit.y || 0, tauP, dt);   // Blickhöhe (Podest: auf die Autos statt auf den Boden)
      var px = Math.exp(c.lp), visW = W / px, tanH = Math.tan(FOV * Math.PI / 360) * (W / H);
      var D = visW / (2 * tanH);
      cam.position.set(c.x, c.ty + D * Math.sin(TILT), c.z + D * Math.cos(TILT));
      cam.lookAt(c.x, c.ty, c.z);
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
      if (race.stage === 'podium') { drawPodiumHud(); return; }
      var m = Math.round(Math.min(W * 0.045, H * 0.07)), rh = clamp(H * 0.05, 12, 28), fs = rh * 0.62;
      // Rangliste links oben
      var pw = rh * (preview ? 12 : 7.4), ph = rows.length * rh + rh * 0.4;
      pill(hud, m, m, pw, ph);
      hud.textBaseline = 'middle';
      // Zeilen gleiten beim Platztausch (bei reduzierter Bewegung sofort)
      var dtH = Math.min(0.1, Math.max(0, now - (race.hudT || now))); race.hudT = now;
      rows.forEach(function (row, i) {
        var r = row.r;
        r.rankY = r.rankY == null || reduce ? i : ease(r.rankY, i, 0.14, dtH);
        var y = m + rh * 0.2 + r.rankY * rh + rh / 2;
        if (r.flash > 0) {   // gerade überholt: Zeile kurz in Akzentfarbe hinterlegt
          roundRect(hud, m + rh * 0.15, y - rh * 0.46, pw - rh * 0.3, rh * 0.92, rh * 0.2);
          hud.fillStyle = withAlpha(TK.accent, 0.3 * r.flash / FLASH); hud.fill();
        }
        hud.globalAlpha = row.dnf ? 0.6 : 1;
        hud.font = font(800, fs); hud.textAlign = 'right';
        hud.fillStyle = row.dnf ? TK.dim : TK.accent;
        hud.fillText(row.place, m + rh * (row.dnf ? 1.7 : 1.15), y);
        if (!row.dnf) {
          hud.beginPath(); hud.arc(m + rh * 1.55, y, rh * 0.17, 0, Math.PI * 2); hud.fillStyle = row.r.color; hud.fill();
        }
        hud.textAlign = 'left'; hud.font = font(row.fin ? 800 : 600, fs);
        hud.fillStyle = row.fin ? TK.accent : TK.text;
        hud.fillText(fitText(hud, row.r.shown, pw - rh * 2.25), m + rh * 1.95, y);
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

    // ---- Effekte: Partikel (Qualm, Staub, Funken), Ölflecken, Windschatten-Schlieren ----
    // Alle Partikel blenden am Bildrand aus (nichts poppt); bei reduzierter Bewegung nur wenige, keine Dauer-Ströme
    function softTex(stops) {
      return canvasTex(64, 64, function (g) {
        var gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
        stops.forEach(function (st) { gr.addColorStop(st[0], st[1]); });
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      });
    }
    var FXT = {
      smoke: softTex([[0, 'rgba(240,240,240,0.9)'], [0.5, 'rgba(222,222,222,0.42)'], [1, 'rgba(210,210,210,0)']]),
      dust: softTex([[0, 'rgba(216,198,158,0.9)'], [0.5, 'rgba(200,180,140,0.4)'], [1, 'rgba(190,170,130,0)']]),
      spark: softTex([[0, 'rgba(255,250,215,1)'], [0.35, 'rgba(255,170,50,0.9)'], [1, 'rgba(255,80,0,0)']])
    };
    // Ölfleck: unregelmäßige dunkle Lache mit Glanzrand (feste Zufallsfolge, für alle Instanzen gleich)
    var oilTex = canvasTex(128, 128, function (g) {
      var rr = CarRaceSim.rng(4711);
      for (var i = 0; i < 7; i++) {
        var x = 64 + (rr() - 0.5) * 50, y = 64 + (rr() - 0.5) * 50, rad = 22 + rr() * 26;
        var gr = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
        gr.addColorStop(0, 'rgba(12,10,16,0.95)'); gr.addColorStop(0.75, 'rgba(18,16,26,0.85)'); gr.addColorStop(1, 'rgba(18,16,26,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      }
      g.globalCompositeOperation = 'source-atop';
      var hl = g.createLinearGradient(20, 20, 108, 108);
      hl.addColorStop(0, 'rgba(120,90,200,0.25)'); hl.addColorStop(0.5, 'rgba(60,160,170,0.18)'); hl.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = hl; g.fillRect(0, 0, 128, 128);
    });
    // Windschatten: feine helle Schliere, an beiden Enden weich
    var streakTex = canvasTex(128, 16, function (g, w, h) {
      for (var y = 2; y < h; y += 5) {
        var gr = g.createLinearGradient(0, 0, w, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.8)');
        gr.addColorStop(0.55, 'rgba(255,255,255,0.25)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, y, w, 1.5);
      }
    });
    streakTex.wrapS = THREE.RepeatWrapping;
    var streakGeo = new THREE.PlaneGeometry(1, 1); streakGeo.rotateX(-Math.PI / 2);   // flach: Länge x, Breite z
    var oilGeo = new THREE.CircleGeometry(1, 28); oilGeo.rotateX(-Math.PI / 2);

    var puffs = [], MAXP = reduce ? 12 : 160, pv3 = new THREE.Vector3();
    function puff(kind, x, y, z, o) {
      o = o || {};
      if (puffs.length >= MAXP) return;   // voll: neues Teilchen verwerfen statt das älteste hart zu entfernen
      var spark = kind === 'spark';
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: FXT[kind], transparent: true, depthWrite: false, opacity: 0,
        blending: spark ? THREE.AdditiveBlending : THREE.NormalBlending }));
      sp.position.set(x, y, z); scene.add(sp);
      var rnd = Math.random;
      puffs.push({ s: sp, age: 0, life: o.life || (spark ? 0.35 + rnd() * 0.2 : 1.2 + rnd() * 0.9),
        size0: o.size || (spark ? 0.25 : 0.7 + rnd() * 0.5), grow: o.grow != null ? o.grow : (spark ? 0 : 1.6 + rnd() * 1.4),
        vel: new THREE.Vector3((rnd() - 0.5) * (spark ? 9 : 1.2), spark ? 1.5 + rnd() * 3 : 0.4 + rnd() * 0.8, (rnd() - 0.5) * (spark ? 9 : 1.2)),
        a: o.a || (spark ? 1 : 0.5), grav: spark ? -9 : 0.2 });
    }
    function burst(kind, x, z, n, o) { for (var i = 0; i < (reduce ? Math.min(n, 2) : n); i++) puff(kind, x + (Math.random() - 0.5) * 1.2, (o && o.y) || 0.4, z + (Math.random() - 0.5) * 1.2, o); }
    function stepPuffs(dt) {
      for (var i = puffs.length - 1; i >= 0; i--) {
        var q = puffs[i]; q.age += dt;
        if (q.age >= q.life) { scene.remove(q.s); q.s.material.dispose(); puffs.splice(i, 1); continue; }
        var k = q.age / q.life;
        q.s.position.addScaledVector(q.vel, dt); q.vel.multiplyScalar(1 - dt * 1.2); q.vel.y += dt * q.grav;
        if (q.s.position.y < 0.1) { q.s.position.y = 0.1; q.vel.y = 0; }
        q.s.scale.setScalar(q.size0 + q.grow * k);
        // Rand-Fade: Abstand zum Bildrand in Pixeln
        pv3.copy(q.s.position).project(cam);
        var px = (pv3.x * 0.5 + 0.5) * W, py = (1 - (pv3.y * 0.5 + 0.5)) * H, edge = Math.min(px, W - px, py, H - py);
        var ef = clamp(edge / (Math.min(W, H) * 0.12), 0, 1);
        q.s.material.opacity = q.a * Math.min(1, q.age / 0.12) * (1 - k) * ef;
      }
    }
    function clearPuffs() { puffs.forEach(function (q) { scene.remove(q.s); q.s.material.dispose(); }); puffs = []; }
    function rearOf(r, back) {
      var y = r.holder.rotation.y, f = (back ? -0.45 : 0.45) * r.len;
      return { x: r.holder.position.x + Math.cos(y) * f, z: r.holder.position.z - Math.sin(y) * f };
    }

    // Ölflecken aus sim.hazards: ab „from“ weich einblenden, bleiben bis Rennende
    function updateOil(sim) {
      var hz = sim.hazards || [];
      for (var i = 0; i < hz.length; i++) {
        var h = hz[i], m = race.oil[i];
        if (!m) {
          var mat = new THREE.MeshStandardMaterial({ map: oilTex, transparent: true, depthWrite: false, opacity: 0, roughness: 0.08, metalness: 0.6, color: 0xffffff });
          m = race.oil[i] = new THREE.Mesh(oilGeo, mat);
          var p = race.T.at(h.s);
          m.position.set(p.x + p.nx * h.d, 0.065 + i * 0.002, p.z + p.nz * h.d);
          m.scale.set(h.r, 1, h.r); m.rotation.y = i * 2.1;
          scene.add(m);
        }
        m.material.opacity = 0.92 * clamp((sim.time - h.from) / 0.8, 0, 1);
      }
    }
    function clearOil() {
      if (!race || !race.oil) return;
      race.oil.forEach(function (m) { scene.remove(m); m.material.dispose(); });
      race.oil = [];
    }

    // Windschatten: zwei Schlieren zwischen Heck des Vordermanns und Front des Hintermanns
    function updateDraft(r, leader, dt) {
      if (!r.streak) {
        var mat = own2(r, new THREE.MeshBasicMaterial({ map: streakTex, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending }));
        r.streak = { mat: mat, vis: 0, meshes: [0, 1].map(function () { var m = new THREE.Mesh(streakGeo, mat); scene.add(m); return m; }) };
      }
      var S = r.streak;
      S.vis = ease(S.vis, leader ? 1 : 0, 0.3, dt);
      S.mat.opacity = 0.28 * S.vis;
      S.meshes.forEach(function (m) { m.visible = S.vis > 0.02 && !!(leader || S.from); });
      if (!leader) return;
      var a = rearOf(leader, true), b = rearOf(r, false), dx = a.x - b.x, dz = a.z - b.z, len = Math.hypot(dx, dz);
      if (len < 0.5 || len > 30) { S.meshes.forEach(function (m) { m.visible = false; }); return; }
      S.from = true;
      var ux = dx / len, uz = dz / len, rot = Math.atan2(-dz, dx);
      S.meshes.forEach(function (m, k) {
        var off = (k ? 1 : -1) * Math.min(r.w, leader.w) * 0.28;
        m.position.set((a.x + b.x) / 2 - uz * off, 0.55 + k * 0.25, (a.z + b.z) / 2 + ux * off);
        m.rotation.y = rot; m.scale.set(len, 1, 0.45);
      });
    }

    // Ereignisse seit dem letzten Bild (nach Neuladen/fastForward nur die der letzten 1,5 s)
    function processEvents(sim, idx) {
      var ev = sim.events || [];
      for (; race.evIdx < ev.length; race.evIdx++) {
        var e = ev[race.evIdx];
        if (sim.time - e.t > 1.5) continue;
        var r = race.order[idx[e.id]], o = e.other != null ? race.order[idx[e.other]] : null;
        if (!r) continue;
        var p = r.holder.position, back = rearOf(r, true);
        if (e.type === 'overtake') { r.flash = FLASH; }
        else if (e.type === 'spin') burst('smoke', back.x, back.z, 5);
        else if (e.type === 'crash') { burst('smoke', p.x, p.z, 7); if (e.rail) burst('spark', p.x, p.z, 10, { y: 0.6 }); r.jolt = 1; }
        else if (e.type === 'off') burst('dust', back.x, back.z, 6, { y: 0.3 });
        else if (e.type === 'push') {
          var mx = o ? (p.x + o.holder.position.x) / 2 : p.x, mz = o ? (p.z + o.holder.position.z) / 2 : p.z;
          burst('spark', mx, mz, 7, { y: 0.6 });
          r.jolt = 1; if (o) o.jolt = Math.max(o.jolt || 0, 0.5);
        } else if (e.type === 'oil') burst('smoke', back.x, back.z, 2, { a: 0.3 });
        else if (e.type === 'dnf' && e.reason !== 'time') burst('smoke', p.x, p.z, 4);
      }
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

      var pts = [], labels = [], camFix = null;
      if (race.stage === 'podium') {
        var pd = race.podium;
        pd.t += dt;
        pd.cars.forEach(function (c, k) { labels.push({ r: c.r, place: String(c.place), show: true, order: k }); });
        // Goldfunken über dem Sieger (kurz, mit Rand-Fade; bei reduzierter Bewegung nicht)
        if (!reduce && pd.t < 4 && Math.random() < dt * 14) {
          var wn = pd.cars[0];
          puff('spark', wn.x + (Math.random() - 0.5) * wn.r.len, wn.top + wn.r.height + 1.5 + Math.random(), wn.z + (Math.random() - 0.5) * 2, { life: 0.9, size: 0.3 });
        }
        camFix = pd.cam;
      } else if (race.stage === 'grid') {
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
        var ids = sim.standings(), idx = {};
        sim.cars.forEach(function (c, i) { idx[c.id] = i; });
        sim.cars.forEach(function (c, i) {
          var p = race.prev[i] || c, r = race.order[i];
          placeCar(r, T, lerp(p.s, c.s, a), lerp(p.d, c.d, a), lerp(p.yaw, c.yaw, a), lerp(p.roll, c.roll, a), lerp(p.pitch, c.pitch, a), lerp(p.steer, c.steer, a), dt);
          // Stoß-Ruck nach Kontakt/Crash (kurz, bei reduzierter Bewegung aus)
          if (r.jolt > 0) {
            if (!reduce) { var j = r.jolt * r.jolt; r.holder.position.y = 0.12 * j; r.holder.rotation.x += 0.07 * j * Math.sin(r.jolt * 25); }
            r.jolt = Math.max(0, r.jolt - dt * 3.5);
          }
          if (r.flash > 0) r.flash = Math.max(0, r.flash - dt);
          // neben der Bahn: Staub/Kies aus dem Heck; Dreher: Reifenqualm (nur ohne reduzierte Bewegung)
          if (!reduce && c.v > 3 && ((c.off && Math.random() < dt * 10) || (c.state === 'spin' && Math.random() < dt * 12))) {
            var bk = rearOf(r, true);
            puff(c.off ? 'dust' : 'smoke', bk.x + (Math.random() - 0.5), 0.35, bk.z + (Math.random() - 0.5), { a: c.off ? 0.45 : 0.4 });
          }
          updateDraft(r, c.draft != null && !sim.done ? race.order[idx[c.draft]] : null, dt);
        });
        processEvents(sim, idx);
        updateOil(sim);
        if (!reduce) streakTex.offset.x = (streakTex.offset.x - dt * 1.6) % 1;
        if (sim.done && !race.ended) finishRace();
        // Kamera-Ziel: alle, die noch fahren (vorn zuerst, auch neben der Bahn); sind alle durch, das ganze Feld ohne DNF
        var active = ids.filter(function (id) { var c = sim.cars[idx[id]]; return c.place == null && c.state !== 'dnf' && !sim.done; });
        if (!active.length) active = ids.filter(function (id) { var c = sim.cars[idx[id]]; return c.state !== 'dnf' && !(sim.done && c.place == null); });
        if (!active.length) active = ids;
        active.forEach(function (id) { var r = race.order[idx[id]]; pts.push({ x: r.holder.position.x, z: r.holder.position.z }); });
        ids.forEach(function (id, o) {
          var c = sim.cars[idx[id]], r = race.order[idx[id]];
          var dnf = c.place == null && (c.state === 'dnf' || sim.done);
          labels.push({ r: r, place: dnf ? 'DNF' : String(c.place != null ? c.place : c.pos), show: true, order: o, dnf: dnf });
        });
      }
      stepPuffs(dt);
      updateCamera(pts, dt, camFix);
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
        if (race) race.order.forEach(function (r) { drawLabel(r, r.labelPlace || '', true, r.labelMode); });
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
