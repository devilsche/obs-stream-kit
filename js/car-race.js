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
  var POLL_MS = 1000, HOLD = 5, FADE = 0.6, PODIUM_HOLD = 15;
  var LABEL_W = 512, LABEL_H = 112, LABEL_CH = 160;   // Schild: Namensfeld 112 px hoch, darunter Platz für die Modellzeile
  // Katalogname fürs Anzeigen säubern (Quellen-Anhängsel wie „| www.vecarz.com“, „[FREE]“, „FREE“ weg)
  function cleanName(n) {
    return String(n || '').replace(/\|\s*www\.\S+/gi, '').replace(/\[\s*free\s*\]/gi, '').replace(/\bfree\b/gi, '')
      .replace(/\s{2,}/g, ' ').replace(/^[\s|\-\u2013\u00b7]+|[\s|\-\u2013\u00b7]+$/g, '');
  }
  // Sub-Abzeichen: Stern in Tier-Farbe (T1 Silber, T2 Gold, T3 Lila mit Goldrand) – auf dunklem Grund ≥ 4,5:1
  var SUB_STAR = { 1: ['#d4dae3', null], 2: ['#f2b705', null], 3: ['#b98cff', '#f2b705'] };
  function subTier(sub) { var t = Math.round((+sub || 0) / 1000); return t >= 1 && t <= 3 ? t : 0; }
  function drawStar(g, cx, cy, r, tier) {
    var c = SUB_STAR[tier]; if (!c) return;
    g.save(); g.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath(); g.fillStyle = c[0]; g.fill();
    g.lineWidth = Math.max(1, r * 0.14); g.strokeStyle = c[1] || 'rgba(0,0,0,0.55)'; g.stroke();
    g.restore();
  }
  // Sub-Lackierungen (state: paint = Set-Name): Gold glänzend metallic, Kanal-Lila glänzend, Carbon glänzend
  var SUB_PAINTS = { gold: { c: 0xd4a017, f: 'shiny' }, purple: { c: 0x5e2a79, f: 'gloss' }, carbon: { c: 0x2b2b30, f: 'carbonGloss' } };
  function shortName(n, max) { n = cleanName(n); return n.length > max ? n.slice(0, max - 1) + '\u2026' : n; }
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
    var W = 640, H = 360, dpr = 1, resScale = 1;   // resScale: anpassbare Render-Auflösung (Leistung)
    // Layout „stage“: Rennen als Vollbild-Hintergrund (1920×1080), das Spiel als Bild-im-Bild oben links darüber.
    // Rechnung in logischen Pixeln (Höhe 540, UIK = Bildhöhe / 540), damit alle Größen wie im 960×540-Fenster
    // wirken; Kameras zielen auf die Mitte des freien Bereichs VW (ohne Bild-im-Bild), das HUD liegt darin.
    var STAGE = opts.layout === 'stage', UIK = 1, PIP = opts.pip || [24, 24, 640, 360], VW = { x: 0, y: 0, w: 640, h: 360 }, FULLW = 640, FULLH = 360;

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, premultipliedAlpha: true });
    renderer.setClearColor(0x000000, 0);
    var scene = new THREE.Scene();
    if (root.CarStage) CarStage.setup(renderer, scene, { exposure: 1.1 });
    var cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 1, 4000);
    var hud = hudCanvas.getContext('2d');
    var maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;

    function resize() {
      var PW = Math.max(64, root.innerWidth || 640), PH = Math.max(36, root.innerHeight || 360);
      UIK = STAGE ? PH / 540 : 1;
      W = FULLW = PW / UIK; H = FULLH = PH / UIK;
      dpr = STAGE ? 1 : Math.min(2, root.devicePixelRatio || 1);   // Vollbild: Pixelverhältnis 1 (Leistung neben dem Spiel)
      renderer.setPixelRatio(dpr * resScale); renderer.setSize(PW, PH, false);
      hudCanvas.width = Math.round(PW * dpr); hudCanvas.height = Math.round(PH * dpr);
      cam.aspect = W / H;
      if (STAGE) {
        // freier Bereich: rechts neben oder unter dem Bild-im-Bild (+24 px Rand) – der größere
        var m = 24, px0 = (PIP[0] + PIP[2] + m) / UIK, py0 = (PIP[1] + PIP[3] + m) / UIK;
        var right = { x: px0, y: 0, w: W - px0, h: H }, below = { x: 0, y: py0, w: W, h: H - py0 };
        VW = right;   // links unter dem Bild-im-Bild steht die Rangliste: frei ist nur der Bereich rechts davon
        // Bildmitte der Kamera in die Mitte des freien Bereichs schieben (außermittige Projektion)
        cam.setViewOffset(W, H, W / 2 - (VW.x + VW.w / 2), H / 2 - (VW.y + VW.h / 2), W, H);
      } else VW = { x: 0, y: 0, w: W, h: H };
      cam.updateProjectionMatrix();
    }
    // fn mit W/H = freier Bereich ausführen (Bildausschnitte der Kameras, HUD)
    function inView(fn) {
      if (!STAGE) return fn();
      var sw = W, sh = H; W = VW.w; H = VW.h;
      try { return fn(); } finally { W = sw; H = sh; }
    }
    resize();
    root.addEventListener('resize', resize);
    if (STAGE && stageEl) stageEl.classList.toggle('is-stage', true);

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
    var trackGroup = null, trackOwned = [], trackNear = null;
    var trackDecor = { objs: [], trees: null };   // Deko, die dem Podest-Blick im Weg stehen kann   // trackNear(x, z, R): liegt Strecke näher als R?
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
      trackDecor = { objs: [{ o: gantry, r: HALF + 13 }], trees: null };

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
        trackDecor.objs.push({ o: st, r: 12 });
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
        trackDecor.trees = { spots: spots, trunks: trunks, crowns: crowns };
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
    // Modell laden – eine Stelle; immer die leichte Renn-Version (.race.glb, fällt serverseitig auf das volle Modell zurück)
    // Modell laden (leichte Renn-Version) und für viele Autos zusammenfassen (ToyCars.mergeForRace: Teile je
    // Material und bewegter Gruppe → ~40 statt mehrere hundert Zeichenaufrufe je Auto)
    function loadCarModel(entry) {
      return ToyCars.loadModel(entry, { race: true }).then(function (t) { if (ToyCars.mergeForRace) ToyCars.mergeForRace(t); return t; });
    }
    // Warteschlange: ein Modell nach dem anderen mit Luft dazwischen (Laden + Aufbereiten blockiert den Haupt-Thread);
    // während des Rennens wird nichts geladen – die Ersatz-Kiste bleibt bis zur Siegerehrung
    var loadQ = [], loadBusy = false;
    function queueModel(r) { if (r.entry && loadQ.indexOf(r) < 0) { loadQ.push(r); pumpLoads(); } }
    function pumpLoads() {
      if (loadBusy || !loadQ.length) return;
      if (race && (race.stage === 'race' || race.stage === 'end')) { setTimeout(pumpLoads, 1000); return; }
      var r = loadQ.shift();
      if (r.gone || r.isModel) { pumpLoads(); return; }
      loadBusy = true;
      loadCarModel(r.entry).then(function () {
          if (r.gone) return;
          if (race && race.stage === 'race') { loadQ.push(r); return; }
          setModel(r);
          // auf dem Podest: neu aufs Treppchen setzen (Höhe des Modells)
          if (race && race.stage === 'podium' && race.podium && race.podium.cars) race.podium.cars.forEach(function (c) { if (c.r === r) seatOnBlock(c); });
        })
        .catch(function () { /* Ersatz-Kiste bleibt */ })
        .then(function () { loadBusy = false; setTimeout(pumpLoads, 120); });
    }
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
      // paint: Zahl = Farbset-Index aus dem Car editor, Text = Sub-Lackierung (gold/purple/carbon); sub = Tier
      var subPaint = SUB_PAINTS[typeof src.paint === 'string' ? src.paint : src.sub_paint] || null;
      var setIdx = typeof src.paint === 'number' ? src.paint : (src.paint_index | 0);
      var set = key && ToyCars.paintAt ? ToyCars.paintAt(key, setIdx) : { c: null };
      if (subPaint) set = Object.assign({}, set, { c: subPaint.c, sub: subPaint });
      var r = {
        id: src.user_id, grid: src.grid, display: String(src.display || src.user_id || '?'), color: hexColor(src.color, '#9146ff'),
        key: key, uid: src.uid, entry: entry, paint: setIdx, set: set, stats: st, len: st.len, tier: subTier(src.sub),
        w: clamp(st.len * 0.42, 1.7, 2.6), h: clamp(st.len * 0.3, 1.2, 3.2),
        holder: new THREE.Group(), body: null, owned: [], wheels: [], isModel: false,
        steer: 0, wheelAngle: 0, wheelR: clamp(0.07 * st.len, 0.3, 0.55), lastX: null, lastZ: null,
        disp: null, label: null, labelK: 1, labelText: '', gone: false, flash: 0, jolt: 0, rankY: null
      };
      r.holder.rotation.order = 'YXZ';
      // Vorschau: Modellname mit anzeigen (zur Fehlersuche „welches Auto war das?“), echte Rennen nur der Chatname
      // Automodell: in Rangliste, Fahrerkarte, Lobby-Karte und als zweite Zeile unter dem Namensschild
      r.modelName = entry ? shortName(entry.name || key, 20) : key ? shortName(key, 20) : '';
      r.shown = r.display;
      if (preview && root.console) console.info('Car Race preview: grid ' + src.grid + ' ' + r.display + ' = ' + (key || '(no car)') + (entry ? ' (' + entry.name + ', front ' + (entry.front || 'auto') + ')' : ''));
      var shadow = new THREE.Mesh(own2(r, new THREE.PlaneGeometry(1, 1)), own2(r, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.07; r.shadow = shadow; r.holder.add(shadow);
      setBox(r);
      makeLabel(r);
      scene.add(r.holder);
      if (entry) {
        queueModel(r);
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
      model.scale.setScalar(k); model.position.y = d.H / 2 * k + 0.03;   // Asphalt liegt 3 cm über dem Boden (sonst sinken die Reifen ein)
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
    // Lage eines Autos aus Weltposition (Wagenmitte zwischen den Achsen) und Gier – im Rennen aus der Sim
    // (Einspurmodell: cars[i].x/z/yaw), in der Startaufstellung aus der Strecke
    function placeCar(r, x, z, yaw, roll, pitch, steer, dt) {
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
      var c = document.createElement('canvas'); c.width = LABEL_W; c.height = LABEL_CH;
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
    // withModel: zweite, kleinere Zeile mit dem Automodell unter dem Namensfeld
    function drawLabel(r, place, force, mode, withModel) {
      mode = mode || ''; withModel = !!withModel && !!r.modelName && mode !== 'dnf';
      var text = place + '\u0000' + r.shown + '\u0000' + mode + (withModel ? '\u0000m' : '') + '\u0000' + r.tier;
      if (!force && text === r.labelText) return;
      r.labelText = text; r.labelPlace = place; r.labelMode = mode; r.label.withModel = withModel;
      var L = r.label, g = L.g;
      g.clearRect(0, 0, LABEL_W, LABEL_CH);
      var fs = 50, pad = 22, gap = 14, bw = 7;
      g.font = font(800, fs);
      var aw = mode === 'up' ? fs * 0.62 : 0;   // Platz für den Pfeil
      var pw = g.measureText(place).width + aw, name = r.shown;
      g.font = font(700, fs);
      var sw = r.tier ? fs * 0.95 : 0;   // Platz für den Sub-Stern
      pw += sw;
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
      if (r.tier) drawStar(g, x0 + pad + pw - sw / 2 + 4, LABEL_H / 2, fs * 0.36, r.tier);
      g.font = font(700, fs); g.fillStyle = mode === 'dnf' ? TK.dim : TK.text; g.fillText(name, x0 + pad + pw + gap, LABEL_H / 2 + 2);
      if (withModel) {
        g.font = font(600, 30);
        var md = r.modelName; while (md.length > 1 && g.measureText(md).width > LABEL_W - 60) md = md.slice(0, -2) + '\u2026';
        var mw = g.measureText(md).width + 28, my = LABEL_H + 2, mh = LABEL_CH - LABEL_H - 6;
        roundRect(g, (LABEL_W - mw) / 2, my, mw, mh, 14); g.fillStyle = withAlpha(TK.surface, 0.8); g.fill();
        g.fillStyle = TK.dim; g.textAlign = 'center'; g.fillText(md, LABEL_W / 2, my + mh / 2 + 1); g.textAlign = 'left';
      }
      // ohne Modellzeile sitzt die Unterkante des Namensfelds auf dem Ankerpunkt
      L.sprite.center.set(0.5, withModel ? 0 : (LABEL_CH - LABEL_H) / LABEL_CH);
      L.boxW = boxW + 2 * bw;
      L.tex.needsUpdate = true;
    }
    var tmpV = new THREE.Vector3();
    // Schilder: Text, Größe, Gedränge (hinteres kleiner/blasser), Rand-Fade, Ein-/Ausblenden
    function updateLabels(list, dt) {
      var podium = race && race.stage === 'podium';
      var hpx = podium ? podiumHpx() : clamp(H * 0.055, 13, 30), tanV = Math.tan(FOV * Math.PI / 360);
      var placed = [];
      list.forEach(function (it) {
        var r = it.r, L = r.label, up = r.flash > 0;
        // Modellzeile nur, wenn Platz ist: nah genug dran und kein Gedränge (mit Hysterese gegen Flackern)
        var zoomPx = race && race.cam ? Math.exp(race.cam.lp) : PX_MAX;
        if (podium) r.showModel = true;
        else if (r.labelK < 0.8 || zoomPx < 8) r.showModel = false;
        else if (r.labelK > 0.95 && zoomPx > 9.5) r.showModel = true;
        drawLabel(r, it.place, false, it.dnf ? 'dnf' : up ? 'up' : '', r.showModel);
        tmpV.set(r.holder.position.x, r.holder.position.y + r.height + 0.9, r.holder.position.z).project(cam);
        var px = (tmpV.x * 0.5 + 0.5) * W, py = (1 - (tmpV.y * 0.5 + 0.5)) * H, wpx = hpx * L.boxW / LABEL_H;
        var crowd = placed.some(function (o) { return Math.abs(o.px - px) < (o.w + wpx) / 2 && Math.abs(o.py - py) < hpx * 1.1; });
        r.labelK = ease(r.labelK, crowd && !up && !podium ? 0 : 1, 0.2, dt);
        // Überholt: kurzer Puls (bei reduzierter Bewegung nur der Akzentrand)
        var pulse = up && !reduce ? 1 + 0.18 * Math.sin(Math.min(1, (FLASH - r.flash) / 0.5) * Math.PI) : 1;
        var k = lerp(0.62, 1, r.labelK) * pulse, edge = Math.min(px, W - px, py, H - py);
        var ef = podium ? 1 : clamp((edge - hpx * 0.5) / (hpx * 2), 0, 1);   // Podest: Kamera hält die Schilder im Bild
        L.vis = ease(L.vis, it.show ? 1 : 0, 0.25, dt);
        var sy = hpx * k / H * 2 * tanV * (LABEL_CH / LABEL_H);   // hpx = Höhe des Namensfelds
        L.sprite.scale.set(sy * LABEL_W / LABEL_CH, sy, 1);
        L.sprite.position.set(r.holder.position.x, r.holder.position.y + r.height + 0.9, r.holder.position.z);
        L.sprite.material.opacity = lerp(0.45, 1, r.labelK) * (it.dnf ? 0.6 : 1) * ef * L.vis * (tmpV.z < 1 ? 1 : 0);
        L.sprite.renderOrder = up ? 200 : 100 - it.order;   // vordere Plätze (und der Überholende) liegen oben
        placed.push({ px: px, py: py, w: wpx * k });
      });
    }

    // ---- Rennen (lokaler Zustand) ----
    var lobbyCard = null;   // Vollbild: Zustand für die Lobby-Karte (lobby/countdown), sonst null
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
        startsAt: st.starts_at, introAt: null, intro: null, stage: 'grid', racers: {}, order: [], gridSim: null, rosterKey: '',
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
      race.stage = 'race'; race.ended = false; race.evIdx = 0; clearOil(); endIntro();
      var t = srvNow() - race.startsAt;
      race.hl = null; race.hlLast = -1e9; race.hlIdx = 0;
      if (t > 0.5) { stepTo(Math.min(t, 120)); race.cam = null; }   // Neuladen: dieselbe Rennsituation
      snap();
    }
    function snap() {
      race.prev = race.sim.cars.map(function (c) { return { s: c.s, d: c.d, x: c.x, z: c.z, yaw: c.yaw, roll: c.roll, pitch: c.pitch, steer: c.steer }; });
    }
    function advanceSim(target) {
      var sim = race.sim, DT = sim.DT || 1 / 60;
      if (target - sim.time > 1) { stepTo(target - DT); snap(); }
      var guard = 0;
      while (sim.time < target && guard++ < 240) { snap(); sim.step(); checkHighlight(sim); }
      race.alpha = clamp(1 - (sim.time - target) / DT, 0, 1);
    }
    // wie sim.fastForward, aber mit der Highlight-Entscheidung je Schritt (damit sie nach Neuladen gleich ausfällt)
    function stepTo(t) {
      var sim = race.sim, DT = sim.DT || 1 / 60, target = Math.round(t / DT);
      while (Math.round(sim.time / DT) < target && !(sim.time > 200)) { sim.step(); checkHighlight(sim); }
    }

    // ---- Unfall-Highlights: kurz ranzoomen ----
    // Entschieden je Simulationsschritt aus sim.events und dem Sim-Zustand dieses Schritts (für alle Instanzen
    // gleich, kein Zufall): Ausfall > Crash > Dreher; höchstens eins zur Zeit, mindestens 6 s zwischen zwei Starts;
    // keins, wenn der Führende in < 5 s im Ziel ist oder die Zielfrist läuft. Dauer 2,5 s (Sim-Zeit).
    var HL_PRIO = { dnf: 3, crash: 2, spin: 1 }, HL_LEN = 2.5, HL_GAP = 6;
    function checkHighlight(sim) {
      var ev = sim.events || [];
      for (; race.hlIdx < ev.length; race.hlIdx++) {
        var e = ev[race.hlIdx], pr = HL_PRIO[e.type];
        if (!pr || (e.type === 'dnf' && e.reason === 'time') || sim.done) continue;
        if (sim.cars.some(function (c) { return c.place != null; })) continue;   // Zielfrist: Fokus aufs Ziel
        var lead = null; sim.cars.forEach(function (c) { if (c.pos === 1) lead = c; });
        if (lead && race.laps * race.T.len - lead.s < Math.max(lead.v, 8) * 5 + 5) continue;   // knappes Finale nicht verlassen
        var h = race.hl;
        if (h && e.t < h.t0 + 0.6 && pr > h.prio) { h.prio = pr; h.type = e.type; h.id = e.id; h.other = e.other; continue; }   // z. B. Crash → Ausfall
        if ((!h || e.t >= h.until) && e.t - race.hlLast >= HL_GAP) {
          race.hl = { t0: e.t, until: e.t + HL_LEN, prio: pr, type: e.type, id: e.id, other: e.other };
          race.hlLast = e.t;
        }
      }
    }
    // Gewicht des Highlights jetzt (0..1, weich ein/aus) und Kamera-Ziel
    function highlightWeight(sim) {
      var h = race.hl;
      if (!h || sim.time < h.t0 || sim.time > h.until) return 0;
      return smooth01((sim.time - h.t0) / 0.5) * smooth01((h.until - sim.time) / 0.7);
    }

    // Server-Zustand übernehmen (auch der Vorschau-Zustand läuft hier durch)
    var waitLogged = false;
    function apply(st) {
      var ph = st.phase;
      if (STAGE) applyStage(st);
      if (!preview && !race && (ph === 'idle' || ph === 'lobby') && !waitLogged) {
        waitLogged = true;   // leere Seite erklärbar machen (Dashboard-Link ohne ?preview=1)
        if (root.console && console.info) console.info('Car Race: waiting for !race \u2013 add ?preview=1 to test');
      }
      if (ph === 'countdown' || ph === 'intro' || ph === 'race') {
        if (!st.race_id || finished[st.race_id]) return;
        if (race && race.id === st.race_id && race.dropAt != null) { race.dropAt = null; }   // wieder genug Fahrer
        if (!race || race.id !== st.race_id) newRace(st);
        if (!race.sim) {
          syncRacers(st.racers);
          // countdown: starts_at = Beginn der Vorstellung, Rennstart danach (wie fx/race.py);
          // intro/race: der Server nennt beide Zeiten
          if (ph === 'countdown') { race.introAt = st.starts_at; race.startsAt = st.starts_at + introSeconds(race.order.length); }
          else { race.introAt = st.intro_at != null ? st.intro_at : st.starts_at - introSeconds(race.order.length); race.startsAt = st.starts_at; }
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
    // Vollbild-Layout: in lobby/countdown nur eine Lobby-Karte unten rechts, die 3D-Bühne erst ab der Vorstellung
    function applyStage(st) {
      var ph = st.phase;
      lobbyCard = (ph === 'lobby' || ph === 'countdown') && (st.racers || []).length ? st : null;
      if (lobbyCard) show(true);
      else if (ph !== 'intro' && ph !== 'race' && (!race || race.stage === 'grid')) show(false);
    }
    function is3D(now) {
      if (!STAGE) return true;
      // 0,4 s nach Beginn der Vorstellung, 0,4 s Einblenden: der OBS-Move-Filter (~0,7 s) verkleinert das Spiel
      // währenddessen, das Loch fürs Bild-im-Bild macht das frühe Einblenden unauffällig
      return !!race && (race.stage !== 'grid' || (race.introAt != null && now >= race.introAt + 0.4));
    }
    // Loch für das Bild-im-Bild: dort bleibt die Bühne durchsichtig (das verkleinerte Spiel liegt darunter),
    // dazu ein Rahmen in Akzentfarbe mit weichem Schatten nach außen; blendet mit der 3D-Bühne ein und aus
    var frameA = 0;
    function pipHole(dt) {
      if (!STAGE) return;
      var x = PIP[0], y = PIP[1], w = PIP[2], h = PIP[3], PH = Math.round(H * UIK);
      if (renderer.setScissor) {
        renderer.setScissorTest(true); renderer.setScissor(x, PH - y - h, w, h);
        renderer.setClearColor(0x000000, 0); renderer.clear(true, true, false);
        renderer.setScissorTest(false);
      }
      frameA = ease(frameA, visible ? 1 : 0, 0.3, dt);
      var k = dpr;
      hud.setTransform(k, 0, 0, k, 0, 0);
      hud.clearRect(x - 10, y - 10, w + 20, h + 20);   // HUD nie über dem Spiel
      if (frameA > 0.01) {
        hud.save(); hud.globalAlpha = frameA;
        hud.shadowColor = 'rgba(0,0,0,0.55)'; hud.shadowBlur = 22;
        roundRect(hud, x - 3, y - 3, w + 6, h + 6, 8);
        hud.lineWidth = 6; hud.strokeStyle = TK.accent; hud.stroke();
        hud.restore();
        hud.clearRect(x, y, w, h);   // Schatten nicht ins Loch
      }
    }
    // ---- Lobby-Karte (Vollbild-Layout, lobby/countdown) ----
    // Anmeldetafel unten rechts: halbtransparentes dunkles Feld (~74 %, Kopf mit Countdown kräftiger), dünner
    // Akzentrand, Countdown als größtes Element, darunter der Aufruf mit Platzzahl und die Startliste
    // (Startplatz, Name fast weiß mit leichtem Schatten, Chatfarbe nur als Balken, Automodell kleiner darunter).
    // Neue Fahrer gleiten von rechts herein (reduzierte Bewegung: ohne). Logische Größen (540er), Text ≥ 22/18 px bei 1080p.
    var lobbySeen = {};
    function rgbOf(css) { var m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css || ''); return m ? [+m[1], +m[2], +m[3]] : null; }
    function lum(c) { return c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce(function (a, v, i) { return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0); }
    // Textfarbe so weit Richtung Weiß (dunkler Grund) bzw. Schwarz schieben, bis der Kontrast ≥ min ist
    function legible(fg, bg, min) {
      var f = rgbOf(fg), b = rgbOf(bg); if (!f || !b) return fg;
      var lb = lum(b), to = lb < 0.4 ? 255 : 0;
      for (var k = 0; k <= 1.0001; k += 0.1) {
        var c = f.map(function (v) { return v + (to - v) * k; }), lf = lum(c);
        if ((Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05) >= min) return 'rgb(' + c.map(Math.round).join(',') + ')';
      }
      return to ? '#ffffff' : '#000000';
    }
    function drawLobbyCard(now) {
      var st = lobbyCard; if (!st) return;
      var list = (st.racers || []).slice().sort(function (a, b) { return a.grid - b.grid; });
      var w = 240, pad = 12, fName = 11, fCar = 9, rowH = 29, m = 12;
      var counting = st.phase === 'countdown' && st.starts_at != null;
      var headH = pad + 15 + 8 + 34 + 10, ctaH = 24, h = headH + ctaH + list.length * rowH + pad * 0.6;
      var x0 = W - m - w, y0 = H - m - h;
      var bg = TK.surface, white = legible(TK.text, bg, 7), dim = legible(TK.dim, bg, 4.5);
      // Feld: weicher Schatten, Körper halbtransparent, Kopf kräftiger, dünner Akzentrand
      hud.save();
      hud.shadowColor = 'rgba(0,0,0,0.45)'; hud.shadowBlur = 14; hud.shadowOffsetY = 3;
      roundRect(hud, x0, y0, w, h, 10); hud.fillStyle = withAlpha(bg, 0.74); hud.fill();
      hud.restore();
      hud.save(); roundRect(hud, x0, y0, w, h, 10); hud.clip();
      hud.fillStyle = withAlpha(bg, 0.9); hud.fillRect(x0, y0, w, headH);
      hud.fillStyle = TK.accent; hud.fillRect(x0, y0, 4, headH);   // Akzentbalken am Kopf
      hud.restore();
      roundRect(hud, x0 + 0.5, y0 + 0.5, w - 1, h - 1, 10); hud.lineWidth = 1; hud.strokeStyle = withAlpha(TK.accent, 0.85); hud.stroke();
      // Text mit leichtem Schatten (bleibt auch über hellem Spielbild lesbar)
      hud.save();
      hud.shadowColor = 'rgba(0,0,0,0.6)'; hud.shadowBlur = 2; hud.shadowOffsetY = 1;
      hud.textBaseline = 'alphabetic'; hud.textAlign = 'left';
      var tx = x0 + pad + 4, ty = y0 + pad + 13;
      hud.font = font(900, 15); hud.fillStyle = white; hud.fillText('CAR RACE', tx, ty);
      hud.textAlign = 'right'; hud.font = font(800, 13); hud.fillStyle = TK.accent; hud.fillText(list.length + '/10', x0 + w - pad, ty);
      hud.textAlign = 'left';
      var by = ty + 8 + 30;
      if (counting) {
        var left = Math.max(0, Math.ceil(st.starts_at - now)), t = Math.floor(left / 60) + ':' + ('0' + left % 60).slice(-2);
        hud.font = font(900, 34); hud.fillStyle = white; hud.fillText(t, tx, by);
        var cw = hud.measureText(t).width;
        hud.font = font(600, 10); hud.fillStyle = dim; hud.fillText('until the start', tx + cw + 8, by - 3);
      } else {
        var need = Math.max(0, 3 - list.length);
        hud.font = font(800, 18); hud.fillStyle = white;
        hud.fillText(need ? need + (need === 1 ? ' more racer to start' : ' more racers to start') : 'Starting soon', tx, by - 6);
      }
      // Aufruf
      hud.font = font(800, 11.5); hud.fillStyle = TK.accent;
      hud.fillText('Type !race to join', tx, y0 + headH + 16);
      // Startliste
      var nowMs = performance.now();
      list.forEach(function (r, i) {
        var id = r.user_id; if (lobbySeen[id] == null) lobbySeen[id] = nowMs;
        var a = reduce ? 1 : smooth01((nowMs - lobbySeen[id]) / 350), dx = (1 - a) * 24;
        var ry = y0 + headH + ctaH + i * rowH, e = catalogEntry(r.car_key), car = e ? shortName(e.name || r.car_key, 24) : '';
        hud.globalAlpha = a;
        hud.shadowColor = 'transparent';
        hud.fillStyle = hexColor(r.color, '#9146ff'); hud.fillRect(x0 + pad + dx, ry + 3, 3, rowH - 8);   // Chatfarbe als Balken
        hud.shadowColor = 'rgba(0,0,0,0.6)';
        hud.textAlign = 'right'; hud.font = font(800, fName); hud.fillStyle = TK.accent;
        hud.fillText(String(r.grid), x0 + pad + 22 + dx, ry + 13);
        var tr = subTier(r.sub), so = tr ? fName * 1.1 : 0;
        if (tr) drawStar(hud, x0 + pad + 30 + dx + fName * 0.45, ry + 9.5, fName * 0.45, tr);
        hud.textAlign = 'left'; hud.font = font(700, fName); hud.fillStyle = white;
        hud.fillText(fitText(hud, String(r.display || r.user_id), w - pad * 2 - 30 - so), x0 + pad + 30 + dx + so, ry + 13);
        if (car) { hud.font = font(500, fCar); hud.fillStyle = dim; hud.fillText(fitText(hud, car, w - pad * 2 - 30), x0 + pad + 30 + dx, ry + 24); }
        hud.globalAlpha = 1;
      });
      hud.restore();
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
      // Punkte je Fahrer aus der Server-Antwort; Testfahrer stehen dort nie drin (keine Punkte-Zeile), echte Fahrer
      // bekommen ihre Zeile auch in Rennen mit Testfahrern (Server zählt ab 2 echten Fahrern)
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
        seatOnBlock(c);
      });
      // Übrige Autos, Schlieren und Schilder ausblenden
      var onPodium = {}; cars.forEach(function (c) { onPodium[c.r.id] = 1; });
      race.order.forEach(function (r) {
        if (r.streak) r.streak.meshes.forEach(function (m) { m.visible = false; });
        if (!onPodium[r.id]) { r.holder.visible = false; r.label.sprite.visible = false; }
      });
      race.podium = { result: result, response: response, cars: cars, dnf: dnf, t: 0, counted: !!pts };
      race.podium.cam = podiumCam(race.podium, spot, total);
      race.podium.keys = inView(function () { return podiumShots(race.podium); });
      clearPodiumView(race.podium, total);
      race.stage = 'podium';
      race.fadeAt = srvNow() + PODIUM_HOLD;
      upgradeWinnerModel(cars[0]);
      cars.forEach(function (c) { if (!c.r.isModel) queueModel(c.r); });   // im Rennen nicht geladene Podest-Autos jetzt
    }
    // Podest-Kamera: nah und flach (30°), so dass die drei Autos samt Schildern das Fenster füllen;
    // oben bleibt Platz für den Titel, unten für die Punkte-Schilder und die DNF-Zeile
    var PODIUM_TILT = 30 * Math.PI / 180;
    function podiumHpx() { return clamp(H * 0.1, 34, 56); }
    function podiumCam(pd, spot, total) { return inView(function () { return podiumCamRaw(pd, spot, total); }); }
    function podiumCamRaw(pd, spot, total) {
      var m = Math.round(Math.min(W * 0.045, H * 0.07)), rh = clamp(H * 0.05, 12, 28), fsP = clamp(H * 0.05, 16, 26);
      var hpx = podiumHpx(), labelW = hpx * 4.2;
      var xs = pd.cars.map(function (c) { return c.x; }), spanC = Math.max(1, Math.max.apply(null, xs) - Math.min.apply(null, xs));
      var stack = Math.max.apply(null, pd.cars.map(function (c) { return c.top + c.r.height + 0.9; }));
      var topR = m + rh * 1.6 + hpx, botR = m + fsP * 3.2 + (pd.dnf.length ? rh * 1.4 : 0);
      var cosT = Math.cos(PODIUM_TILT), sinT = Math.sin(PODIUM_TILT);
      var pxW = Math.min((W - 2 * m - labelW) / spanC, (W - 2 * m) / (total + 1));
      var pxH = (H - topR - botR) / (stack * cosT + 4 * sinT);
      var px = clamp(Math.min(pxW, pxH), PX_MIN, 90);
      // Mitte des Stapels (Boden bis Schild) auf die Mitte des freien Bereichs legen
      var off = (topR + (H - botR)) / 2 - H / 2;
      var cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
      return { x: cx, z: spot.z, y: stack / 2 + off / (px * cosT), px: px, tilt: PODIUM_TILT, orb: 0 };
    }
    // Kamerafahrt der Siegerehrung als feste Schlüsselbilder (Zeit in s ab Beginn, für alle Instanzen gleich):
    // 0–3,6 alle drei von schräg vorn · 4,8–10 Umlauf um den Sieger (vorn ¾ → Seite → hinten ¾) ·
    // je ~1,2 s Vorbeifahrt an Platz 2 und 3 · 15 zurück in die Totale. Zwischen den Bildern weich (smoothstep).
    // Reduzierte Bewegung: Totale, dann ein harter Schnitt auf eine stehende Nahaufnahme des Siegers.
    // Schlüssel: { t, x, z, y, px, tilt, orb, wide (0..1: Titel/Punkte sichtbar), focus (Auto-Index oder −1), cut }
    var CLOSE_TILT = 28 * Math.PI / 180, PASS_TILT = 22 * Math.PI / 180;
    function closeKey(c, t, orb, tilt, along, fill) {
      var hpx = podiumHpx(), cosT = Math.cos(tilt);
      // Auto füllt ~fill der Breite; Schild über dem Auto darf oben nicht anstoßen
      var px = Math.min(fill * W / Math.max(c.r.len, 3.5), (H / 2 - 12 - hpx) / ((c.r.height / 2 + 0.9) * cosT));
      var yaw = -0.3, ax = Math.cos(yaw) * along * c.r.len, az = -Math.sin(yaw) * along * c.r.len;
      return { t: t, x: c.x + ax, z: c.z + az, y: c.top + c.r.height * 0.5, px: px, tilt: tilt, orb: orb, wide: 0, focus: -1 };
    }
    function podiumShots(pd) {
      var w = pd.cam, cars = pd.cars, keys = [];
      function wide(t, orb) { return { t: t, x: w.x, z: w.z, y: w.y, px: w.px, tilt: w.tilt, orb: orb, wide: 1, focus: -1 }; }
      function idx(pl) { for (var i = 0; i < cars.length; i++) if (cars[i].place === pl) return i; return -1; }
      var i1 = idx(1), i2 = idx(2), i3 = idx(3);
      if (reduce) {
        keys.push(wide(0, 0), wide(6.5, 0));
        if (i1 >= 0) { var k = closeKey(cars[i1], 6.5, 0.55, CLOSE_TILT, 0, 0.55); k.focus = i1; k.cut = true; keys.push(k, Object.assign({}, k, { t: 15, cut: false })); }
        return keys;
      }
      keys.push(wide(0, 0.12), wide(3.6, 0));
      if (i1 >= 0) {
        [[4.8, 0.6], [7.4, -0.3], [10, -1.15]].forEach(function (o) { var k = closeKey(cars[i1], o[0], o[1], CLOSE_TILT, 0, 0.55); k.focus = i1; keys.push(k); });
      }
      var t = 10;
      [i2, i3].forEach(function (i) {
        if (i < 0) return;
        var a = closeKey(cars[i], t + 0.7, 0.25, PASS_TILT, 0.28, 0.6), b = closeKey(cars[i], t + 1.9, 0.25, PASS_TILT, -0.28, 0.6);
        a.focus = b.focus = i; keys.push(a, b); t += 1.9;
      });
      keys.push(wide(Math.max(t + 1.1, 15), 0));
      return keys;
    }
    function smooth01(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
    function podiumShotAt(pd, t) {
      var K = pd.keys, i = 0;
      while (i < K.length - 1 && K[i + 1].t <= t) i++;
      var a = K[i], b = K[Math.min(i + 1, K.length - 1)];
      var f = b === a || b.cut ? 0 : smooth01((t - a.t) / Math.max(0.01, b.t - a.t));
      return { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f), y: lerp(a.y, b.y, f), px: Math.exp(lerp(Math.log(a.px), Math.log(b.px), f)),
        tilt: lerp(a.tilt, b.tilt, f), orb: lerp(a.orb, b.orb, f), wide: lerp(a.wide, b.wide, f), focus: f < 0.5 ? a.focus : b.focus };
    }
    // Deko aus dem Blick räumen (für alle Instanzen gleich, rein aus Geometrie): alles im Podest-Bereich und in den
    // Korridoren zwischen Blickpunkt und Kamera entlang der ganzen Kamerafahrt wird ausgeblendet
    function clearPodiumView(pd, total) {
      var pc = pd.cam, tanH = Math.tan(FOV * Math.PI / 360) * (W / H), segs = [], half = total / 2 + 4;
      var tEnd = pd.keys[pd.keys.length - 1].t;
      for (var t = 0; t <= tEnd + 0.01; t += 0.25) {
        var k = podiumShotAt(pd, t), D = (W / k.px) / (2 * tanH), hor = D * Math.cos(k.tilt) + 3;
        segs.push({ x: k.x, z: k.z, cx: k.x + hor * Math.sin(k.orb), cz: k.z + hor * Math.cos(k.orb), half: k.wide > 0.5 ? half : W / k.px / 2 + 2 });
      }
      hideDecor(function (x, z, rad) { return Math.hypot(x - pc.x, z - pc.z) < half + 3 + rad || nearSegs(segs, x, z, rad); });
    }
    // Abstand eines Punkts zu den Strecken Blickpunkt → Kamera (Korridore)
    function nearSegs(segs, x, z, rad) {
      return segs.some(function (sg) {
        var dx = sg.cx - sg.x, dz = sg.cz - sg.z, L2 = dx * dx + dz * dz || 1;
        var u = clamp(((x - sg.x) * dx + (z - sg.z) * dz) / L2, 0, 1);
        return Math.hypot(x - (sg.x + dx * u), z - (sg.z + dz * u)) < sg.half + rad;
      });
    }
    // Deko ausblenden, die blocks(x, z, Radius) trifft; Rückgabe zum Wiederherstellen (restoreDecor)
    function hideDecor(blocks) {
      var undo = { objs: [], trees: [] };
      trackDecor.objs.forEach(function (d) { if (d.o.visible && blocks(d.o.position.x, d.o.position.z, d.r)) { d.o.visible = false; undo.objs.push(d.o); } });
      var tr = trackDecor.trees;
      if (tr) {
        var zero = new THREE.Matrix4().makeScale(0, 0, 0);
        tr.spots.forEach(function (sp, i) {
          if (sp.hidden || !blocks(sp[0], sp[1], 2.5)) return;
          var a = new THREE.Matrix4(), b = new THREE.Matrix4(); tr.trunks.getMatrixAt(i, a); tr.crowns.getMatrixAt(i, b);
          undo.trees.push([i, a, b]); sp.hidden = true;
          tr.trunks.setMatrixAt(i, zero); tr.crowns.setMatrixAt(i, zero);
        });
        if (undo.trees.length) { tr.trunks.instanceMatrix.needsUpdate = true; tr.crowns.instanceMatrix.needsUpdate = true; }
      }
      return undo;
    }
    function restoreDecor(undo) {
      if (!undo) return;
      undo.objs.forEach(function (o) { o.visible = true; });
      var tr = trackDecor.trees;
      if (tr && undo.trees.length) {
        undo.trees.forEach(function (u) { tr.trunks.setMatrixAt(u[0], u[1]); tr.crowns.setMatrixAt(u[0], u[2]); tr.spots[u[0]].hidden = false; });
        tr.trunks.instanceMatrix.needsUpdate = true; tr.crowns.instanceMatrix.needsUpdate = true;
      }
    }

    // ---- Fahrervorstellung (Phase intro) ----
    // Dauer wie fx/race.py: 2 s + 1,6 s je Fahrer. Kamera fliegt tief von hinten (letzter Startplatz) nach vorn
    // (Pole), hält je Auto 1,6 s schräg vorn von der Außenseite; die letzten 2 s Totale der Startaufstellung mit
    // Startampel 3-2-1. Feste Schlüsselbilder (für alle Instanzen gleich); reduzierte Bewegung: stehende
    // Startaufstellung mit Fahrerliste.
    var INTRO_BASE = 2.0, INTRO_PER = 1.6, INTRO_TILT = 20 * Math.PI / 180;
    function introSeconds(n) { return INTRO_BASE + INTRO_PER * n; }
    function gridSlot(i) {
      var c = race.gridSim.cars[i], p = race.T.at(c.s);
      return { x: c.x != null ? c.x : p.x + p.nx * c.d, z: c.z != null ? c.z : p.z + p.nz * c.d, p: p, d: c.d };
    }
    // Versatz der Sim-Wagenmitte gegenüber at(s) + n·d am Startplatz (0, falls die Sim kein x/z liefert)
    function slotOffset(c) {
      if (c.x == null) return { x: 0, z: 0 };
      var p = race.T.at(c.s);
      return { x: c.x - (p.x + p.nx * c.d), z: c.z - (p.z + p.nz * c.d) };
    }
    // Ablauf der Vorstellung (Dauer vom Server, 2 s + 1,6 s je Fahrer): erst die ganze Startaufstellung als Totale
    // (gehalten, Namen sichtbar), dann die Fahrer von hinten nach vorn – einzeln, wenn je Fahrer ≥ 1,15 s bleiben,
    // sonst als Startreihe (zwei) bzw. bei sehr wenig Zeit alle zusammen –, die letzte Karte endet vor der Startampel
    // (letzte 2 s). Im Vollbild beginnt die Totale später sichtbar (Einblenden), darum dort länger.
    var INTRO_LIGHTS = 2.0, INTRO_MOVE = 0.35, INTRO_MIN = 1.15;
    function introPlan(n) {
      var total = introSeconds(n), wide = STAGE ? 2.8 : 2.0, avail = total - wide - INTRO_LIGHTS, groups = [], gs;
      for (gs = 1; gs <= 2; gs++) if (avail / Math.ceil(n / gs) >= INTRO_MIN) break;
      if (gs > 2) gs = n;   // zu knapp: alle auf einmal
      // Gruppen von hinten nach vorn; Paare = Startreihen (Startplätze 2r+1, 2r+2)
      if (gs === 2) { for (var rr = Math.ceil(n / 2) - 1; rr >= 0; rr--) groups.push([2 * rr, 2 * rr + 1].filter(function (i) { return i < n; })); }
      else if (gs === 1) { for (var i = n - 1; i >= 0; i--) groups.push([i]); }
      else { var all = []; for (var j = n - 1; j >= 0; j--) all.push(j); groups.push(all); }
      return { total: total, wide: wide, per: avail / groups.length, groups: groups };
    }
    function buildIntro() {
      var n = race.order.length, keys = [], prevOrb = 0, plan = introPlan(n);
      function unwrap(o) { while (o - prevOrb > Math.PI) o -= 2 * Math.PI; while (o - prevOrb < -Math.PI) o += 2 * Math.PI; prevOrb = o; return o; }
      var fit = camFit(race.order.map(function (r, i) { var sl = gridSlot(i); return { x: sl.x, z: sl.z }; })) || { x: 0, z: 0, px: PX_MAX };
      var high = { x: fit.x, z: fit.z, y: 0, px: fit.px, tilt: TILT, orb: 0, wide: 1, focus: -1 };
      keys.push(Object.assign({ t: 0 }, high), Object.assign({ t: plan.wide }, high));
      plan.groups.forEach(function (g, k) {
        var t0 = plan.wide + k * plan.per, sl = g.map(gridSlot), rs = g.map(function (i) { return race.order[i]; });
        var cx = 0, cz = 0, md = 0; sl.forEach(function (q) { cx += q.x / sl.length; cz += q.z / sl.length; md += q.d / sl.length; });
        var span = 0; sl.forEach(function (a) { sl.forEach(function (b) { span = Math.max(span, Math.hypot(a.x - b.x, a.z - b.z)); }); });
        var len = Math.max.apply(null, rs.map(function (r) { return r.len; })) + span, hgt = Math.max.apply(null, rs.map(function (r) { return r.height; }));
        var p = sl[0].p, side = md >= 0 ? 1 : -1, fx = Math.cos(p.yaw), fz = -Math.sin(p.yaw);
        var orb = unwrap(Math.atan2(fx * 0.75 + p.nx * side * 0.65, fz * 0.75 + p.nz * side * 0.65));
        var cosT = Math.cos(INTRO_TILT), px = Math.min(0.42 * W / Math.max(len, 3.5), (H * 0.3) / ((hgt + 0.3) * cosT));
        // Autos im oberen Teil des Bildes, unten Platz für die Fahrerkarte(n)
        var y = hgt * 0.5 - (H * (g.length > 1 ? 0.2 : 0.14)) / (px * cosT);
        var base = { x: cx, z: cz, y: y, px: px, tilt: INTRO_TILT, wide: 0, focus: g[0] };
        keys.push(Object.assign({ t: t0 + INTRO_MOVE, orb: orb + 0.05 }, base), Object.assign({ t: t0 + plan.per, orb: orb - 0.05 }, base));
      });
      high.orb = unwrap(0);
      keys.push(Object.assign({ t: plan.total - INTRO_LIGHTS + 0.6 }, high), Object.assign({ t: plan.total }, high));
      // Deko entlang der Fahrt ausblenden (beim Rennstart wieder da)
      var tanH = Math.tan(FOV * Math.PI / 360) * (W / H), segs = [], intro = { keys: keys, at: race.introAt, n: n, plan: plan };
      for (var t = 0; t <= plan.total; t += 0.2) {
        var s = shotAt(keys, t), D = (W / s.px) / (2 * tanH), hor = D * Math.cos(s.tilt) + 3;
        segs.push({ x: s.x, z: s.z, cx: s.x + hor * Math.sin(s.orb), cz: s.z + hor * Math.cos(s.orb), half: s.wide > 0.5 ? 6 : W / s.px / 2 + 2 });
      }
      intro.undo = reduce ? null : hideDecor(function (x, z, rad) { return nearSegs(segs, x, z, rad); });
      return intro;
    }
    // Welche Fahrer zeigt die Karte gerade, mit welcher Deckkraft (für alle Instanzen gleich)?
    function introCardAt(introT) {
      if (!race || !race.intro || !race.intro.plan) return null;
      var pl = race.intro.plan, k = Math.floor((introT - pl.wide) / pl.per);
      if (introT < pl.wide || k < 0 || k >= pl.groups.length) return null;
      var st = introT - pl.wide - k * pl.per;
      return { ids: pl.groups[k], st: st, a: clamp((st - 0.05) / 0.08, 0, 1) * clamp((pl.per - st) / 0.08, 0, 1) };
    }
    // Schlüsselbild-Interpolation (wie die Siegerehrung)
    function shotAt(K, t) { return podiumShotAt({ keys: K }, t); }
    function endIntro() { if (race.intro) { restoreDecor(race.intro.undo); race.intro.undo = null; } }

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
    // Sieger: steht noch die Kiste, Modell laden. Volles Modell nachladen ist bewusst nicht eingebaut –
    // ToyCars.build() nutzt eine Vorlage je Modell-Schlüssel, ein Austausch bräuchte eine zweite Vorlage.
    // Auto aufs Podest setzen: Räder gerade und in Grundstellung, kein Ruck/Wanken/Nicken; dann so anheben oder
    // absenken, dass der tiefste echte Punkt des Modells (Ecken, nicht die Bounding-Box: gedrehte Teile würden sie
    // aufblähen) genau auf der Blockoberkante liegt
    function seatOnBlock(c) {
      var r = c.r;
      r.jolt = 0; r.steer = 0; r.wheelAngle = 0;
      r.wheels.forEach(function (w) {
        if (w.spin) w.spin.rotation[w.spin.userData.ax || 'x'] = w.base;
        if (w.front) w.pivot.rotation.y = 0;
      });
      r.holder.position.set(c.x, c.top, c.z); r.holder.rotation.set(0, -0.3, 0);
      r.holder.updateMatrixWorld(true);   // sonst misst lowestPoint mit der alten Lage aus dem Rennen
      var low = lowestPoint(r.body);
      if (isFinite(low)) r.holder.position.y += c.top - low;
      r.holder.updateMatrixWorld(true);
    }
    function lowestPoint(obj) {
      var v = new THREE.Vector3(), low = Infinity;
      obj.traverse(function (o) {
        if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
        var pa = o.geometry.attributes.position, e = o.matrixWorld.elements, n = pa.count;
        for (var i = 0; i < n; i++) {
          var x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
          var wy = e[1] * x + e[5] * y + e[9] * z + e[13];
          if (wy < low) low = wy;
        }
      });
      return low;
    }
    function upgradeWinnerModel(c) {
      var r = c.r;
      if (r.isModel || !r.entry) return;
      loadCarModel(r.entry).then(function () {
        if (r.gone || !race || race.stage !== 'podium') return;
        setModel(r);
        seatOnBlock(c);
      }).catch(function () {});
    }
    function drawPodiumHud() {
      var pd = race.podium, m = Math.round(Math.min(W * 0.045, H * 0.07)), rh = clamp(H * 0.05, 12, 28), fs = rh * 0.62;
      var wideA = pd.shot ? clamp((pd.shot.wide - 0.3) / 0.6, 0, 1) : 1;   // Titel/Punkte nur in der Totale
      if (wideA <= 0) return;
      hud.save(); hud.globalAlpha = wideA;
      hud.textBaseline = 'middle'; hud.textAlign = 'center';
      hud.font = font(800, fs * 1.1);
      var title = 'RACE RESULTS', tw = hud.measureText(title).width + rh * 1.2;
      pill(hud, (W - tw) / 2, m, tw, rh * 1.25);
      hud.fillStyle = TK.accent; hud.fillText(title, W / 2, m + rh * 0.65);
      // Punkte je Podestplatz unter dem Block: „+10 → 47 pts · #2 this month“
      // zweizeilig, damit drei Schilder nebeneinander passen: „+10 → 47 pts“ / „#2 this month“ (Text ≥ 16 px)
      var fsP = clamp(H * 0.05, 16, 26);
      pd.cars.forEach(function (c) {
        if (!c.pts) return;
        var t1 = '+' + (c.pts.gained | 0) + ' \u2192 ' + (c.pts.month_total | 0) + ' pts', t2 = c.pts.month_rank ? '#' + c.pts.month_rank + ' this month' : '';
        tmpV.set(c.x, 0.25, c.z + 2.0).project(cam);
        var px = (tmpV.x * 0.5 + 0.5) * FULLW - VW.x, py = (1 - (tmpV.y * 0.5 + 0.5)) * FULLH - VW.y + 6;
        hud.font = font(800, fsP); var w1 = hud.measureText(t1).width;
        hud.font = font(600, fsP); var w2 = t2 ? hud.measureText(t2).width : 0;
        var w = Math.max(w1, w2) + fsP * 1.1, h = fsP * (t2 ? 2.6 : 1.5);
        px = clamp(px, m + w / 2, W - m - w / 2); py = clamp(py, m + rh * 2, H - m - h - (pd.dnf.length ? rh * 1.4 : 0));
        pill(hud, px - w / 2, py, w, h);
        hud.font = font(800, fsP); hud.fillStyle = c.place === 1 ? TK.accent : TK.text; hud.fillText(t1, px, py + fsP * 0.78);
        if (t2) { hud.font = font(600, fsP); hud.fillStyle = TK.text; hud.fillText(t2, px, py + fsP * 1.88); }
      });
      if (pd.dnf.length) {
        hud.font = font(600, fs * 0.8);
        var d = fitText(hud, 'DNF: ' + pd.dnf.map(function (r) { return r.display; }).join(' · '), W - 2 * m - rh);
        var dw = hud.measureText(d).width + rh * 0.8, dy = H - m - rh * 1.8;
        pill(hud, (W - dw) / 2, dy - rh * 0.45, dw, rh * 0.9);
        hud.fillStyle = TK.dim; hud.fillText(d, W / 2, dy);
      }
      hud.restore();
    }

    // ---- Kamera ----
    function camFit(points) { return inView(function () { return camFitRaw(points); }); }
    function camFitRaw(points) {
      // points: [{x, z}] in Reihenfolge (vorn zuerst); Spitzengruppe, solange die Zoom-Grenze hält
      var effW = STAGE ? W : W * 0.78, MX = 9, MZ = 7, sinT = Math.sin(TILT);
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
      // Inhalt etwas rechts der Mitte: links steht die Rangliste (Vollbild: Rangliste rechts, Mitte bleibt)
      return { x: (minX + maxX) / 2 - (STAGE ? 0 : (W * 0.11) / px), z: (minZ + maxZ) / 2, px: px };
    }
    // fixed: festes Ziel {x, z, px} (Podest) statt Feld-Anpassung
    function updateCamera(points, dt, fixed) {
      var fit = fixed || camFit(points);
      if (!fit) return;
      var c = race.cam, tauP = reduce ? 1.6 : 0.8, tauZ = reduce ? 2.6 : 1.3;
      if (fit.fast) { tauP = 0.15; tauZ = 0.15; }   // Handzoom: direkt, nur leicht geglättet
      if (!c) c = race.cam = { x: fit.x, z: fit.z, lp: Math.log(fit.px), tx: fit.x, tz: fit.z, vx: 0, vz: 0 };
      if (fit.direct) {   // Kamerafahrt mit festen Schlüsselbildern: schon geglättet, direkt übernehmen
        c.x = c.tx = fit.x; c.z = c.tz = fit.z; c.lp = Math.log(fit.px); c.ty = fit.y; c.tilt = fit.tilt; c.orb = fit.orb; c.vx = c.vz = 0;
        tauP = 0;
      }
      // Vorhalt: geschätzte Geschwindigkeit des Ziels, damit die Dämpfung nicht hinterherhängt
      var vx = fixed ? 0 : (fit.x - c.tx) / Math.max(dt, 1e-3), vz = fixed ? 0 : (fit.z - c.tz) / Math.max(dt, 1e-3);
      var vmax = 30, vl = Math.hypot(vx, vz); if (vl > vmax) { vx *= vmax / vl; vz *= vmax / vl; }
      if (!fit.direct) {
        c.vx = ease(c.vx, vx, 0.5, dt); c.vz = ease(c.vz, vz, 0.5, dt);
        c.tx = fit.x; c.tz = fit.z;
        c.x = ease(c.x, fit.x + c.vx * tauP, tauP, dt); c.z = ease(c.z, fit.z + c.vz * tauP, tauP, dt);
        c.lp = ease(c.lp, Math.log(fit.px), tauZ, dt);
        c.ty = ease(c.ty || 0, fit.y || 0, tauP, dt);   // Blickhöhe (Podest: auf die Autos statt auf den Boden)
        // Neigung und Umlaufwinkel (Podest: flacher); weich übergeblendet
        c.tilt = ease(c.tilt == null ? TILT : c.tilt, fit.tilt != null ? fit.tilt : TILT, tauZ, dt);
        c.orb = ease(c.orb || 0, fit.orb || 0, tauP, dt);
      }
      var px = Math.exp(c.lp), visW = W / px, tanH = Math.tan(FOV * Math.PI / 360) * (W / H);
      var D = visW / (2 * tanH), hor = D * Math.cos(c.tilt);
      cam.position.set(c.x + hor * Math.sin(c.orb), c.ty + D * Math.sin(c.tilt), c.z + hor * Math.cos(c.orb));
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
    // Vollbild: kompakte Rangliste direkt unter dem Bild-im-Bild (gleiche Breite), halbtransparent wie die Lobby-Karte;
    // je Zeile Platz, Chatfarben-Balken, Name (20 px bei 1080p) und rechtsbündig das Automodell (15 px, entfällt
    // ohne Platz) – alles per measureText auf die Spalte gekürzt. Bis 10 Zeilen; reicht der Platz nicht, werden sie flacher.
    function drawStageRanking(rows, now) {
      var k = dpr * UIK, sw = W, sh = H;
      hud.save(); hud.setTransform(k, 0, 0, k, 0, 0);
      W = FULLW; H = FULLH;
      try {
        // kompakt, endet über der Streamer-Kamera (bei 1080p ab y 539): ab 6 Fahrern zwei Spalten (1–5 | 6–10)
        var x0 = PIP[0] / UIK, y0 = (PIP[1] + PIP[3] + 16) / UIK, w = PIP[2] / UIK, pad = 3, n = Math.max(1, rows.length);
        var cols = n > 5 ? 2 : 1, perCol = Math.ceil(n / cols), colW = w / cols, bottom = 265;   // 530 px bei 1080p (logisch 540er)
        var rowH = Math.min(12, (bottom - y0 - pad * 2) / perCol), fName = Math.min(7.5, rowH * 0.62), fCar = Math.min(6, rowH * 0.5);
        var h = perCol * rowH + pad * 2, bg = TK.surface, white = legible(TK.text, bg, 7), dim = legible(TK.dim, bg, 4.5);
        hud.save();
        hud.shadowColor = 'rgba(0,0,0,0.4)'; hud.shadowBlur = 10; hud.shadowOffsetY = 2;
        roundRect(hud, x0, y0, w, h, 7); hud.fillStyle = withAlpha(bg, 0.74); hud.fill();
        hud.restore();
        roundRect(hud, x0 + 0.5, y0 + 0.5, w - 1, h - 1, 7); hud.lineWidth = 1; hud.strokeStyle = withAlpha(TK.accent, 0.85); hud.stroke();
        hud.save(); roundRect(hud, x0, y0, w, h, 7); hud.clip();
        hud.shadowColor = 'rgba(0,0,0,0.6)'; hud.shadowBlur = 2; hud.shadowOffsetY = 1; hud.textBaseline = 'middle';
        var dtH = Math.min(0.1, Math.max(0, now - (race.hudT || now))); race.hudT = now;
        rows.forEach(function (row, i) {
          var r = row.r;
          r.rankY = r.rankY == null || reduce ? i : ease(r.rankY, i, 0.14, dtH);
          var col = Math.floor(i / perCol), cx0 = x0 + col * colW;
          var y = y0 + pad + clamp(r.rankY - col * perCol, -0.5, perCol - 0.5) * rowH + rowH / 2;
          if (r.flash > 0) { hud.fillStyle = withAlpha(TK.accent, 0.3 * r.flash / FLASH); hud.fillRect(cx0 + 2, y - rowH / 2 + 1, colW - 4, rowH - 2); }
          hud.globalAlpha = row.dnf ? 0.6 : 1;
          var px = cx0 + pad + 2, placeW = fName * 2.2;
          hud.textAlign = 'right'; hud.font = font(800, fName); hud.fillStyle = row.dnf ? dim : TK.accent;
          hud.fillText(fitText(hud, row.place, placeW), px + placeW, y);
          if (!row.dnf) { hud.fillStyle = r.color; hud.fillRect(px + placeW + 4, y - rowH * 0.32, 3, rowH * 0.64); }
          var nx = px + placeW + 10, right = cx0 + colW - pad - 2;
          if (r.tier) { drawStar(hud, nx + fName * 0.45, y, fName * 0.42, r.tier); nx += fName * 1.05; }
          var avail = right - nx;
          hud.font = font(500, fCar);
          var car = r.modelName || '', carW = car ? Math.min(hud.measureText(car).width, avail * 0.45) : 0;
          if (carW < 24) carW = 0;   // zu eng: Automodell weglassen
          hud.textAlign = 'left'; hud.font = font(row.fin ? 800 : 700, fName); hud.fillStyle = row.fin ? TK.accent : white;
          hud.fillText(fitText(hud, r.shown, avail - (carW ? carW + 8 : 0)), nx, y);
          if (carW) { hud.textAlign = 'right'; hud.font = font(500, fCar); hud.fillStyle = dim; hud.fillText(fitText(hud, car, carW), right, y + 0.5); }
          hud.globalAlpha = 1;
        });
        hud.restore();
      } finally { W = sw; H = sh; hud.restore(); }
    }
    // HUD zeichnen: ganzes Canvas leeren, dann im freien Bereich (Vollbild) bzw. im ganzen Fenster
    function drawHudView(fn) {
      hud.setTransform(1, 0, 0, 1, 0, 0); hud.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
      var k = dpr * UIK;
      hud.setTransform(k, 0, 0, k, VW.x * k, VW.y * k);
      inView(fn);
    }
    function drawHud(now, rows) {
      if (!race) return;
      if (race.stage === 'podium') { drawPodiumHud(); return; }
      var introT = race.stage === 'grid' && race.introAt != null ? now - race.introAt : -1;
      if (introT >= 0 && race.order.length >= 3) {
        if (reduce) { drawGridList(); drawLights(race.startsAt - now); return; }
        if (race.introShot && race.introShot.wide < 0.5) { drawIntroCard(introT); return; }
      }
      var m = Math.round(Math.min(W * 0.045, H * 0.07)), rh = clamp(H * 0.05, 12, 28), fs = rh * 0.62;
      // Rangliste links oben
      // Vollbild: Rangliste in der Spalte unter dem Bild-im-Bild (eigene Funktion, außerhalb des freien Bereichs)
      if (STAGE) drawStageRanking(rows, now);
      else {
        var pw = rh * 11.5, ph = rows.length * rh + rh * 0.4;   // Platz · Name · Automodell
        var rx = m;
        pill(hud, rx, m, pw, ph);
        hud.textBaseline = 'middle';
        // Zeilen gleiten beim Platztausch (bei reduzierter Bewegung sofort)
        var dtH = Math.min(0.1, Math.max(0, now - (race.hudT || now))); race.hudT = now;
        rows.forEach(function (row, i) {
          var r = row.r;
          r.rankY = r.rankY == null || reduce ? i : ease(r.rankY, i, 0.14, dtH);
          var y = m + rh * 0.2 + r.rankY * rh + rh / 2;
          if (r.flash > 0) {   // gerade überholt: Zeile kurz in Akzentfarbe hinterlegt
            roundRect(hud, rx + rh * 0.15, y - rh * 0.46, pw - rh * 0.3, rh * 0.92, rh * 0.2);
            hud.fillStyle = withAlpha(TK.accent, 0.3 * r.flash / FLASH); hud.fill();
          }
          hud.globalAlpha = row.dnf ? 0.6 : 1;
          hud.font = font(800, fs); hud.textAlign = 'right';
          hud.fillStyle = row.dnf ? TK.dim : TK.accent;
          hud.fillText(row.place, rx + rh * (row.dnf ? 1.7 : 1.15), y);
          if (!row.dnf) {
            hud.beginPath(); hud.arc(rx + rh * 1.55, y, rh * 0.17, 0, Math.PI * 2); hud.fillStyle = row.r.color; hud.fill();
          }
          hud.textAlign = 'left'; hud.font = font(row.fin ? 800 : 600, fs);
          hud.fillStyle = row.fin ? TK.accent : TK.text;
          var st0 = row.r.tier ? fs * 1.05 : 0;   // Sub-Stern vor dem Namen
          if (row.r.tier) drawStar(hud, rx + rh * 1.95 + fs * 0.45, y, fs * 0.42, row.r.tier);
          var nm = fitText(hud, row.r.shown, (pw - rh * 2.25) * 0.55 - st0);
          hud.fillText(nm, rx + rh * 1.95 + st0, y);
          if (row.r.modelName) {   // Automodell kleiner und gedämpft dahinter
            var nx = rx + rh * 1.95 + st0 + hud.measureText(nm).width + rh * 0.3;
            hud.font = font(500, fs * 0.82); hud.fillStyle = TK.dim;
            hud.fillText(fitText(hud, row.r.modelName, rx + pw - rh * 0.3 - nx), nx, y + fs * 0.05);
          }
          hud.globalAlpha = 1;
        });
      }
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
      var lx = STAGE ? m : W - m - lw;
      pill(hud, lx, m, lw, rh * 1.15);
      hud.textAlign = 'center'; hud.fillStyle = TK.text; hud.fillText(lapText, lx + lw / 2, m + rh * 0.6);
      // Countdown
      var left = race.startsAt != null ? race.startsAt - now : null;
      // Highlight-Schild „CRASH! Name“ (auch bei reduzierter Bewegung)
      if (race.stage === 'race' && race.hl && race.sim) {
        var hs = race.sim.time, hh = race.hl, ha = hs >= hh.t0 && hs <= hh.until + 0.3 ? smooth01((hs - hh.t0) / 0.25) * smooth01((hh.until + 0.3 - hs) / 0.4) : 0;
        var hr2 = null; race.order.forEach(function (r) { if (r.id === hh.id) hr2 = r; });
        if (ha > 0 && hr2) {
          var word = hh.type === 'dnf' ? 'OUT!' : hh.type === 'crash' ? 'CRASH!' : 'SPIN!';
          hud.save(); hud.globalAlpha = ha;
          var tf = clamp(H * 0.06, 16, 32);
          hud.font = font(900, tf); var ww = hud.measureText(word + ' ').width;
          hud.font = font(700, tf); var nn = fitText(hud, hr2.display, W * 0.4), nw2 = hud.measureText(nn).width;
          var tw2 = ww + nw2 + tf * 1.2, ty2 = m + rh * 1.6;
          pill(hud, (W - tw2) / 2, ty2, tw2, tf * 1.6);
          hud.textAlign = 'left'; hud.textBaseline = 'middle';
          hud.font = font(900, tf); hud.fillStyle = hh.type === 'spin' ? TK.accent : '#ff4a3d'; hud.fillText(word, (W - tw2) / 2 + tf * 0.6, ty2 + tf * 0.8);
          hud.font = font(700, tf); hud.fillStyle = hr2.color; hud.fillText(nn, (W - tw2) / 2 + tf * 0.6 + ww, ty2 + tf * 0.8);
          hud.restore();
        }
      }
      if (race.stage === 'grid' && left != null && introT >= 0) {
        drawLights(left);
      } else if (race.stage === 'grid' && left != null) {
        if (left > 0) {
          var sec = Math.ceil(left), t = 'STARTS IN ' + Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2);
          hud.font = font(800, fs * 1.1);
          var tw = hud.measureText(t).width + rh * 1.2;
          pill(hud, (W - tw) / 2, m, tw, rh * 1.25);
          hud.fillStyle = TK.text; hud.fillText(t, W / 2, m + rh * 0.65);
          hud.font = font(600, fs * 0.9); hud.fillStyle = TK.dim;
          hud.fillText('!race to join · ' + race.order.length + '/10', W / 2, m + rh * 1.85);
        }
      } else if (race.stage === 'race' && left != null && -left < 1.2) {
        bigText('GO!', 1 + left / 1.2);
      }
    }
    // Startampel in den letzten 2 s vor dem Start: drei rote Lichter gehen nacheinander an, dazu 3-2-1
    function drawLights(left) {
      if (!(left > 0 && left <= 2)) return;
      var lit = Math.min(3, Math.floor((2 - left) / (2 / 3)) + 1), rad = clamp(H * 0.04, 9, 22), gap = rad * 2.8;
      var cx = W / 2, cy = Math.round(Math.min(W * 0.045, H * 0.07)) + rad * 1.6;
      pill(hud, cx - gap * 1.5 - rad * 0.4, cy - rad * 1.4, gap * 3 + rad * 0.8, rad * 2.8);
      for (var i = 0; i < 3; i++) {
        hud.beginPath(); hud.arc(cx + (i - 1) * gap, cy, rad, 0, Math.PI * 2);
        hud.fillStyle = i < lit ? '#e0262b' : 'rgba(60,60,66,0.9)'; hud.fill();
      }
      bigText(String(4 - lit), (left % (2 / 3)) * 1.5);
    }
    // Fahrerkarte im Stil einer Bauchbinde: Startplatz, Name (Akzent in Chatfarbe), Automodell
    function drawIntroCard(introT) {
      var c = introCardAt(introT);
      if (!c || c.a <= 0) return;
      var m = Math.round(Math.min(W * 0.045, H * 0.07)), k = c.ids.length > 1 ? 0.72 : 1, bottom = H - m;
      hud.save(); hud.globalAlpha = c.a;
      hud.translate(reduce ? 0 : (1 - smooth01((c.st - 0.05) / 0.25)) * -24, 0);
      // Gruppe: Karten übereinander, vorderer Startplatz unten
      c.ids.slice().sort(function (a, b) { return b - a; }).forEach(function (i) { bottom -= driverCard(race.order[i], m, bottom, k) + 6; });
      hud.restore();
    }
    // eine Fahrerkarte (Unterkante bei yBottom), k = Größe; Rückgabe: Höhe
    function driverCard(r, x0, yBottom, k) {
      var m = Math.round(Math.min(W * 0.045, H * 0.07)), f1 = clamp(H * 0.12, 30, 72) * k, f2 = clamp(H * 0.075, 18, 44) * k, f3 = Math.max(16, clamp(H * 0.05, 16, 28) * k);
      var ch = f1 * 0.4 + f2 * 1.25 + f3 * 1.35 + f3 * 0.6, y0 = yBottom - ch, pad = f3 * 0.8;
      hud.font = font(900, f1); var pw = hud.measureText('P' + r.grid).width;
      var maxText = W - 2 * m - pw - pad * 3 - 8 - (r.tier ? f2 * 1.1 : 0);
      hud.font = font(800, f2); var nm = fitText(hud, r.display, maxText), nw = hud.measureText(nm).width;
      hud.font = font(600, f3); var md = fitText(hud, r.modelName || '', maxText), mw = hud.measureText(md).width;
      var cw = Math.min(W - 2 * m, 8 + pad * 3 + pw + Math.max(nw + (r.tier ? f2 * 1.1 : 0), mw));   // inkl. Sub-Stern
      roundRect(hud, x0, y0, cw, ch, f3 * 0.5); hud.fillStyle = withAlpha(TK.surface, 0.9); hud.fill();
      hud.lineWidth = 2; hud.strokeStyle = TK.border; hud.stroke();
      hud.fillStyle = r.color; hud.fillRect(x0 + 2, y0 + f3 * 0.4, 6, ch - f3 * 0.8);   // Chatfarbe als Akzentbalken
      hud.textBaseline = 'middle'; hud.textAlign = 'left';
      hud.font = font(900, f1); hud.fillStyle = TK.accent; hud.fillText('P' + r.grid, x0 + 8 + pad, y0 + ch / 2);
      var tx = x0 + 8 + pad * 2 + pw;
      if (r.tier) { drawStar(hud, tx + f2 * 0.45, y0 + ch * 0.38, f2 * 0.45, r.tier); tx += f2 * 1.1; }
      hud.font = font(800, f2); hud.fillStyle = TK.text; hud.fillText(nm, tx, y0 + ch * 0.38);
      hud.font = font(600, f3); hud.fillStyle = TK.dim; hud.fillText(md, tx, y0 + ch * 0.72);
      return ch;
    }
    // Reduzierte Bewegung: Liste der Startaufstellung statt Vorbeiflug
    function drawGridList() {
      var n = race.order.length, fs = clamp(H * 0.05, 16, 26), rh = fs * 1.35, m = Math.round(Math.min(W * 0.045, H * 0.07));
      var w = Math.min(W - 2 * m, fs * 22), h = rh * (n + 1.4), x0 = (W - w) / 2, y0 = Math.max(m, (H - h) / 2);
      pill(hud, x0, y0, w, h);
      hud.textBaseline = 'middle'; hud.textAlign = 'center'; hud.font = font(800, fs); hud.fillStyle = TK.accent;
      hud.fillText('STARTING GRID', W / 2, y0 + rh * 0.7);
      race.order.forEach(function (r, i) {
        var y = y0 + rh * (i + 1.7);
        hud.textAlign = 'right'; hud.font = font(800, fs); hud.fillStyle = TK.accent; hud.fillText('P' + r.grid, x0 + fs * 2.4, y);
        hud.beginPath(); hud.arc(x0 + fs * 3, y, fs * 0.25, 0, Math.PI * 2); hud.fillStyle = r.color; hud.fill();
        hud.textAlign = 'left'; hud.font = font(700, fs); hud.fillStyle = TK.text;
        var nm = fitText(hud, r.display, w * 0.42); hud.fillText(nm, x0 + fs * 3.6, y);
        hud.font = font(600, fs * 0.9); hud.fillStyle = TK.dim;
        hud.fillText(fitText(hud, r.modelName || '', w - fs * 4.2 - w * 0.45), x0 + fs * 3.6 + w * 0.45, y);
      });
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
      spark: softTex([[0, 'rgba(255,250,215,1)'], [0.35, 'rgba(255,170,50,0.9)'], [1, 'rgba(255,80,0,0)']]),
      flame: softTex([[0, 'rgba(255,245,200,1)'], [0.3, 'rgba(255,170,40,0.85)'], [0.65, 'rgba(230,70,10,0.4)'], [1, 'rgba(160,30,0,0)']]),
      soot: softTex([[0, 'rgba(46,42,40,0.9)'], [0.55, 'rgba(56,52,50,0.45)'], [1, 'rgba(70,66,64,0)']])
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

    var puffs = [], POOL = {}, MAXP = reduce ? 12 : 160, pv3 = new THREE.Vector3();
    function puff(kind, x, y, z, o) {
      o = o || {};
      if (puffs.length >= MAXP) return;   // voll: neues Teilchen verwerfen statt das älteste hart zu entfernen
      var spark = kind === 'spark', glow = spark || kind === 'flame';
      // aus dem Pool je Art (keine neuen Sprites/Materialien im Rennen)
      var pool = POOL[kind] || (POOL[kind] = []), sp = pool.pop();
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: FXT[kind], transparent: true, depthWrite: false, opacity: 0,
          blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending }));
        sp.userData.kind = kind; scene.add(sp);
      }
      sp.visible = true; sp.material.opacity = 0; sp.position.set(x, y, z);
      var rnd = Math.random;
      puffs.push({ s: sp, age: 0, life: o.life || (spark ? 0.35 + rnd() * 0.2 : 1.2 + rnd() * 0.9),
        size0: o.size || (spark ? 0.25 : 0.7 + rnd() * 0.5), grow: o.grow != null ? o.grow : (spark ? 0 : 1.6 + rnd() * 1.4),
        vel: new THREE.Vector3((rnd() - 0.5) * (spark ? 9 : 1.2), spark ? 1.5 + rnd() * 3 : 0.4 + rnd() * 0.8, (rnd() - 0.5) * (spark ? 9 : 1.2)),
        a: o.a || (spark ? 1 : 0.5), grav: o.grav != null ? o.grav : spark ? -9 : 0.2, flick: !!o.flick && !reduce, ph: rnd() * 6.3 });
      if (o.vel) puffs[puffs.length - 1].vel.copy(o.vel);
    }
    function burst(kind, x, z, n, o) { for (var i = 0; i < (reduce ? Math.min(n, 2) : n); i++) puff(kind, x + (Math.random() - 0.5) * 1.2, (o && o.y) || 0.4, z + (Math.random() - 0.5) * 1.2, o); }
    function stepPuffs(dt) {
      for (var i = puffs.length - 1; i >= 0; i--) {
        var q = puffs[i]; q.age += dt;
        if (q.age >= q.life) { q.s.visible = false; POOL[q.s.userData.kind].push(q.s); puffs.splice(i, 1); continue; }
        var k = q.age / q.life;
        q.s.position.addScaledVector(q.vel, dt); q.vel.multiplyScalar(1 - dt * 1.2); q.vel.y += dt * q.grav;
        if (q.s.position.y < 0.1) { q.s.position.y = 0.1; q.vel.y = 0; }
        q.s.scale.setScalar(q.size0 + q.grow * k);
        // Rand-Fade: Abstand zum Bildrand in Pixeln
        pv3.copy(q.s.position).project(cam);
        var px = (pv3.x * 0.5 + 0.5) * W, py = (1 - (pv3.y * 0.5 + 0.5)) * H, edge = Math.min(px, W - px, py, H - py);
        var ef = clamp(edge / (Math.min(W, H) * 0.12), 0, 1);
        q.s.material.opacity = q.a * Math.min(1, q.age / 0.12) * (1 - k) * ef * (q.flick ? 0.7 + 0.3 * Math.sin(q.age * 28 + q.ph) : 1);
      }
    }
    // ---- Wracks: ausgebrannt abfackeln ----
    // Ab burn: Flammen (additiv, flackernd) am Motorende und in der Mitte, dunkle Rauchsäule mit leichtem Wind;
    // nach ~10 s fallen die Flammen in sich zusammen (bis 12,5 s), danach schwelt es nur noch. Lack verkohlt
    // in 3 s (Material-Kopien je Wrack, einmalig). Reduzierte Bewegung: nur wenig ruhiger Rauch, kein Flackern.
    var WIND = new THREE.Vector3(0.9, 0, -0.3), CHAR = new THREE.Color(0x0c0a09);
    function charMaterials(r) {
      r.charBody = r.body; r.charMats = [];
      var seen = {};
      r.body.traverse(function (o) {
        if (!o.isMesh) return;
        var list = [].concat(o.material).map(function (m) {
          if (!m || !m.color) return m;
          if (seen[m.uuid]) return seen[m.uuid];
          var c = seen[m.uuid] = own2(r, m.clone());
          r.charMats.push({ m: c, from: m.color.clone() });
          return c;
        });
        o.material = Array.isArray(o.material) ? list : list[0];
      });
    }
    function wreckFx(r, age, dt) {
      if (age < 0) return;
      if (r.charBody !== r.body) charMaterials(r);   // auch nach einem späten Modell-Tausch
      var k = clamp(age / 3, 0, 1) * 0.88;
      if (r.charK !== k) {
        r.charK = k;
        r.charMats.forEach(function (x) {
          x.m.color.copy(x.from).lerp(CHAR, k);
          if ('roughness' in x.m) x.m.roughness = lerp(x.m.roughness, 1, k * 0.2);
          if ('clearcoat' in x.m) x.m.clearcoat = 0;
          if ('metalness' in x.m) x.m.metalness = Math.min(x.m.metalness, 0.3);
        });
      }
      var fire = age < 10 ? 1 : Math.max(0, 1 - (age - 10) / 2.5), y0 = r.height * 0.7;
      if (reduce) {   // ruhig: nur gelegentlich ein kleines Rauchwölkchen
        if (Math.random() < dt * 1.2) puff('soot', r.holder.position.x, y0 + 0.4, r.holder.position.z, { size: 0.6, grow: 1.2, life: 3, a: 0.4, vel: new THREE.Vector3(0.2, 0.6, 0) });
        return;
      }
      var eng = rearOf(r, false), cx = r.holder.position.x, cz = r.holder.position.z;
      if (fire > 0 && Math.random() < dt * 24 * fire) {
        var atEng = Math.random() < 0.6, fx = atEng ? eng.x : cx, fz = atEng ? eng.z : cz;
        puff('flame', fx + (Math.random() - 0.5) * r.w * 0.6, y0, fz + (Math.random() - 0.5) * r.w * 0.6,
          { size: 0.5 + Math.random() * 0.5 * fire, grow: 0.3, life: 0.45 + Math.random() * 0.3, a: 0.9 * (0.4 + 0.6 * fire), flick: true, grav: 0,
            vel: new THREE.Vector3(WIND.x * 0.5 + (Math.random() - 0.5) * 0.4, 1.6 + Math.random(), WIND.z * 0.5 + (Math.random() - 0.5) * 0.4) });
      }
      if (Math.random() < dt * (fire > 0 ? 7 : 3)) {
        puff('soot', cx + (Math.random() - 0.5) * r.w * 0.5, y0 + 0.6, cz + (Math.random() - 0.5) * r.w * 0.5,
          { size: 0.7 + 0.5 * fire, grow: 2.6 + fire, life: 3.2 + Math.random(), a: 0.35 + 0.25 * fire, grav: 0.1,
            vel: new THREE.Vector3(WIND.x + (Math.random() - 0.5) * 0.3, 1.6 + fire * 0.8, WIND.z + (Math.random() - 0.5) * 0.3) });
      }
    }
    function clearPuffs() { puffs.forEach(function (q) { q.s.visible = false; POOL[q.s.userData.kind].push(q.s); }); puffs = []; }
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
    // Leistung: höchstens 60 Bilder/s; misst die Bildzeit und senkt bei Bedarf die Render-Auflösung
    // (1 → 0,75 → 0,66, per CSS hochskaliert), bei viel Luft wieder hoch; unsichtbar wird nicht gerendert
    var ftAvg = 16, ftT = 0;
    function adaptRes(ms, dt) {
      ftAvg += (ms - ftAvg) * 0.05; ftT += dt;
      if (ftT < 2) return;
      var next = resScale;
      if (ftAvg > 20 && resScale > 0.66) next = resScale > 0.75 ? 0.75 : 0.66;
      else if (ftAvg < 12 && resScale < 1) next = resScale < 0.75 ? 0.75 : 1;
      if (next !== resScale) { resScale = next; ftT = 0; renderer.setPixelRatio(dpr * resScale); renderer.setSize(Math.round(W * UIK), Math.round(H * UIK), false); }
    }
    function frame(ts) {
      requestAnimationFrame(frame);
      if (lastTs != null && ts - lastTs < 15) return;   // 60-fps-Deckel (z. B. 144-Hz-Bildschirme)
      var dt = lastTs == null ? 1 / 60 : Math.min(0.1, (ts - lastTs) / 1000); lastTs = ts;
      // Bildabstand statt reiner Rechenzeit: erfasst auch eine ausgelastete Grafikkarte
      try { frameBody(ts, dt); } finally { if (race && visible && dt < 0.1) adaptRes(dt * 1000, dt); }
    }
    function frameBody(ts, dt) {
      if (preview) previewTick();
      if (STAGE && stageEl) stageEl.classList.toggle('is-3d', is3D(srvNow()));
      if (!race) {
        if (STAGE && lobbyCard) { renderer.clear(); drawHudView(function () { drawLobbyCard(srvNow()); }); idleCleared = false; return; }
        if (!idleCleared) { renderer.clear(); hud.setTransform(1, 0, 0, 1, 0, 0); hud.clearRect(0, 0, hudCanvas.width, hudCanvas.height); idleCleared = true; }
        return;
      }
      idleCleared = false;
      if (STAGE && race.dropAt != null && race.stage === 'grid') { teardown(); return; }   // Lobby wieder unter 3: 3D war nie zu sehen
      if (STAGE && !is3D(srvNow())) {   // Countdown im Vollbild: nur die Lobby-Karte, 3D lädt im Hintergrund
        renderer.clear(); drawHudView(function () { drawLobbyCard(srvNow()); });
        if (race.stage === 'grid' && race.startsAt != null && srvNow() >= race.startsAt && race.order.length >= 3 && race.dropAt == null) startSim();
        return;
      }
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
        var shot = pd.shot = podiumShotAt(pd, pd.t);
        // Schilder: in der Totale alle, in Nahaufnahmen nur das Auto im Bild (sonst angeschnitten)
        pd.cars.forEach(function (c, k) { labels.push({ r: c.r, place: String(c.place), show: shot.wide > 0.5 || shot.focus === k, order: k }); });
        // Goldfunken über dem Sieger (kurz, mit Rand-Fade; bei reduzierter Bewegung nicht)
        if (!reduce && pd.t < 4 && Math.random() < dt * 14) {
          var wn = pd.cars[0];
          puff('spark', wn.x + (Math.random() - 0.5) * wn.r.len, wn.top + wn.r.height + 1.5 + Math.random(), wn.z + (Math.random() - 0.5) * 2, { life: 0.9, size: 0.3 });
        }
        // Übergang aus der Rennkamera weich (1,2 s gedämpft), danach direkt den Schlüsselbildern folgen;
        // reduzierte Bewegung: sofort (Schnitt statt Fahrt)
        camFix = Object.assign({}, shot, { direct: reduce || pd.t > 1.2 });
      } else if (race.stage === 'grid') {
        // Fahrervorstellung: ab introAt bis zum Rennstart (Phase intro)
        var introT = race.introAt != null ? now - race.introAt : -1;
        var inIntro = introT >= 0 && race.gridSim && race.order.length >= 3 && race.dropAt == null;
        var ishot = null;
        if (inIntro) {
          if (!race.intro || race.intro.at !== race.introAt || race.intro.n !== race.order.length) {
            endIntro();
            race.intro = inView(buildIntro);
            var c0 = race.cam || { x: 0, z: 0, lp: Math.log(PX_MAX), ty: 0, tilt: TILT, orb: 0 };
            race.intro.cam0 = { x: c0.x, z: c0.z, px: Math.exp(c0.lp), y: c0.ty || 0, tilt: c0.tilt == null ? TILT : c0.tilt, orb: c0.orb || 0 };
          }
          if (!reduce) {
            ishot = race.introShot = shotAt(race.intro.keys, introT);
            // die ersten 0,55 s aus der bisherigen Kamera hinein überblenden, danach direkt den Schlüsselbildern folgen
            var b0 = smooth01(introT / 0.55), q0 = race.intro.cam0;
            camFix = { x: lerp(q0.x, ishot.x, b0), z: lerp(q0.z, ishot.z, b0), y: lerp(q0.y, ishot.y, b0),
              px: Math.exp(lerp(Math.log(q0.px), Math.log(ishot.px), b0)), tilt: lerp(q0.tilt, ishot.tilt, b0), orb: lerp(q0.orb, ishot.orb, b0), direct: true };
          }
        } else race.introShot = null;
        if (race.gridSim) race.order.forEach(function (r, i) {
          var c = race.gridSim.cars[i];
          if (!r.disp) r.disp = { s: c.s, d: c.d };
          var dsv = c.s - r.disp.s, ddv = c.d - r.disp.d;
          r.disp.s += clamp(dsv, -dt * Math.min(18, Math.abs(dsv) * 2.2), dt * Math.min(18, Math.abs(dsv) * 2.2));
          r.disp.d += clamp(ddv, -dt * 4, dt * 4);
          var lean = Math.abs(dsv) > 0.3 ? clamp(Math.atan2(ddv * 0.4, Math.abs(dsv) + 2), -0.25, 0.25) : 0;
          // Startaufstellung entlang der Strecke; Versatz zur Sim-Wagenmitte des Startplatzes, damit der Start nahtlos ist
          var gp = T.at(r.disp.s), off = slotOffset(c);
          placeCar(r, gp.x + gp.nx * r.disp.d + off.x, gp.z + gp.nz * r.disp.d + off.z, T.at(r.disp.s).yaw + lean, 0, 0, lean * 2, dt);
          pts.push({ x: r.holder.position.x, z: r.holder.position.z });
          // während des Vorbeiflugs keine Schilder (die Fahrerkarte zeigt den Fahrer), in der Totale wieder
          labels.push({ r: r, place: String(r.grid), show: !ishot || ishot.wide > 0.5, order: i });
        });
      } else {
        advanceSim(now - race.startsAt);
        var sim = race.sim, a = race.alpha;
        var ids = sim.standings(), idx = {};
        sim.cars.forEach(function (c, i) { idx[c.id] = i; });
        sim.cars.forEach(function (c, i) {
          var p = race.prev[i] || c, r = race.order[i];
          placeCar(r, lerp(p.x, c.x, a), lerp(p.z, c.z, a), lerp(p.yaw, c.yaw, a), lerp(p.roll, c.roll, a), lerp(p.pitch, c.pitch, a), lerp(p.steer, c.steer, a), dt);
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
          if (c.wreck && c.burn != null) wreckFx(r, sim.time - c.burn, dt);
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
      // Unfall-Highlight: Kamera zum Geschehen (Auto ~35 % der Bildbreite), dann zurück; reduzierte Bewegung: nur Schild
      if (race.stage === 'race' && race.hl && !reduce) {
        var hw = highlightWeight(race.sim);
        if (hw > 0) {
          var hi = -1, oi = -1;
          race.sim.cars.forEach(function (c, i) { if (c.id === race.hl.id) hi = i; if (c.id === race.hl.other) oi = i; });
          var base = camFit(pts);
          if (hi >= 0 && base) {
            var hr = race.order[hi], hx = hr.holder.position.x, hz = hr.holder.position.z;
            if (oi >= 0) { var orr = race.order[oi]; if (Math.hypot(orr.holder.position.x - hx, orr.holder.position.z - hz) < 25) { hx = (hx + orr.holder.position.x) / 2; hz = (hz + orr.holder.position.z) / 2; } }
            var hpx = clamp(0.35 * VW.w / Math.max(hr.len, 3.5), PX_MIN, PX_MAX * 3);
            camFix = { x: lerp(base.x, hx, hw), z: lerp(base.z, hz, hw), px: Math.exp(lerp(Math.log(base.px), Math.log(hpx), hw)) };
          }
        }
      }
      var ut = (race.stage === 'race' || race.stage === 'end' || (race.stage === 'grid' && !camFix)) ? userTarget() : null;
      if (ut) camFix = ut;   // Handzoom hat Vorrang vor Automatik und Unfall-Highlight
      updateCamera(pts, dt, camFix);
      cam.updateMatrixWorld();
      updateLabels(labels, dt);
      renderer.render(scene, cam);
      var rows = rankingRows();
      drawHudView(function () { drawHud(now, rows); });
      pipHole(dt);
    }

    // ---- Maus/Tastatur: kurz heranzoomen (nur im Browser; OBS hat keine Maus) ----
    // Mausrad zoomt auf den Punkt unter dem Zeiger (Strahl auf den Boden), linke Taste ziehen verschiebt,
    // + / − zoomen zur Bildmitte, Esc zurück; nach 3 s ohne Eingabe gleitet die Kamera zurück zur Automatik.
    // Nur im Rennen und im Countdown – Vorstellung und Siegerehrung bleiben unberührt.
    var USER_IDLE = 3, ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ray = new THREE.Raycaster(), hitV = new THREE.Vector3();
    function userAllowed() {
      if (!race || !visible || !race.cam) return false;
      if (race.stage === 'race' || race.stage === 'end') return true;
      return race.stage === 'grid' && !(race.introAt != null && srvNow() >= race.introAt);
    }
    function userCam() {
      var c = race.cam;
      if (!race.user) race.user = { x: c.x, z: c.z, px: Math.exp(c.lp) };
      race.user.last = performance.now();
      return race.user;
    }
    function groundAt(cx, cy) {
      ray.setFromCamera({ x: cx / W * 2 - 1, y: -(cy / H * 2 - 1) }, cam);
      return ray.ray.intersectPlane(ground, hitV) ? { x: hitV.x, z: hitV.z } : null;
    }
    function zoomAt(factor, cx, cy) {
      var u = userCam(), p = cx == null ? null : groundAt(cx, cy);
      var npx = clamp(u.px * factor, PX_MIN, PX_MAX * 4), k = u.px / npx;
      if (p) { u.x = p.x + (u.x - p.x) * k; u.z = p.z + (u.z - p.z) * k; }   // Punkt unter dem Zeiger bleibt stehen
      u.px = npx;
    }
    root.addEventListener('wheel', function (e) {
      if (!userAllowed()) return;
      e.preventDefault();   // Seite nicht scrollen
      zoomAt(Math.exp(-clamp(e.deltaY, -300, 300) * 0.0025), e.clientX / UIK, e.clientY / UIK);
    }, { passive: false });
    var drag = null;
    root.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || !userAllowed() || (e.target && e.target.closest && e.target.closest('button'))) return;
      drag = { x: e.clientX / UIK, y: e.clientY / UIK };
    });
    root.addEventListener('pointermove', function (e) {
      if (!drag || !userAllowed()) return;
      var u = userCam(), tilt = race.cam.tilt == null ? TILT : race.cam.tilt;
      u.x -= (e.clientX / UIK - drag.x) / u.px; u.z -= (e.clientY / UIK - drag.y) / (u.px * Math.sin(tilt));
      drag = { x: e.clientX / UIK, y: e.clientY / UIK };
    });
    root.addEventListener('pointerup', function () { drag = null; });
    root.addEventListener('keydown', function (e) {
      if (!userAllowed()) return;
      if (e.key === '+' || e.key === '=') { zoomAt(1.25, null); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { zoomAt(0.8, null); e.preventDefault(); }
      else if (e.key === 'Escape' && race.user) { race.user = null; e.preventDefault(); }
    });
    // Ziel der Handkamera (oder null, wenn die Automatik übernimmt)
    function userTarget() {
      var u = race && race.user;
      if (!u) return null;
      if (!userAllowed() || performance.now() - u.last > USER_IDLE * 1000) { race.user = null; return null; }
      return { x: u.x, z: u.z, px: u.px, fast: true };
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
        // wie der Server: nicht im Mix, „Takes part in races“ aus oder „Needs rework“ markiert → nicht in die Testlobby
        return v.mix !== false && !(v.race && v.race.on === false) && !v.rework;
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
        paint: Array.isArray(paints) && paints.length ? Math.floor(Math.random() * paints.length) : 0,
        // Vorschau zeigt Sub-Stern und Sub-Lackierung zufällig, damit beides zu sehen ist
        sub: [0, 0, 1000, 2000, 3000][Math.floor(Math.random() * 5)] });
      var last = pv.racers[pv.racers.length - 1];
      if (last.sub && Math.random() < 0.6) last.paint = ['gold', 'purple', 'carbon'][Math.floor(Math.random() * 3)];
      var now = Date.now() / 1000;
      if (pv.racers.length >= 10) pvIntro(now);
      else if (pv.racers.length >= 3 && pv.phase === 'lobby') { pv.phase = 'countdown'; pv.starts_at = now + 60; }
      previewInfo();
      apply(pvView());
    }
    function startNow() {
      if (!pv || pv.phase !== 'countdown') return;
      pvIntro(Date.now() / 1000);
      previewInfo();
      apply(pvView());
    }
    // wie fx/race.py: Startaufstellung schließen, Fahrer vorstellen, dann Rennen
    function pvIntro(at) { pv.phase = 'intro'; pv.intro_at = at; pv.starts_at = at + introSeconds(pv.racers.length); }
    function pvView() { return Object.assign({ now: Date.now() / 1000 }, pv, { racers: pv.racers.slice() }); }
    function previewInfo() {
      if (!opts.onPreviewInfo || !pv) return;
      var open = pv.phase === 'lobby' || pv.phase === 'countdown';
      opts.onPreviewInfo('Preview · ' + pv.racers.length + '/10 racers · ' + (open ? 'countdown' : pv.phase === 'intro' ? 'intro' : 'racing'),
        open && pv.racers.length < 10, pv.phase === 'countdown');
    }
    var pvLast = 0;
    function previewTick() {
      if (!pv) return;
      var now = Date.now() / 1000;
      if (now - pvLast < 0.25) return;
      pvLast = now;
      if (pv.phase === 'countdown' && now >= pv.starts_at) { pvIntro(pv.starts_at); previewInfo(); }
      if (pv.phase === 'intro' && now >= pv.starts_at) { pv.phase = 'race'; previewInfo(); }
      apply(pvView());
    }

    // ---- Start ----
    if (document.fonts && document.fonts.load) {
      document.fonts.load('700 40px "DM Sans"').then(function () {
        readTokens();
        if (race) race.order.forEach(function (r) { drawLabel(r, r.labelPlace || '', true, r.labelMode, r.label.withModel); });
      }).catch(function () {});
    }
    var catReady = (ToyCars.loadCatalog ? ToyCars.loadCatalog() : Promise.resolve([])).catch(function () { return []; });
    catReady.then(function () {
      if (preview) { offset = 0; previewReset(); }
      else poll();
      requestAnimationFrame(frame);
    });

    return { addTestRacer: addTestRacer, startNow: startNow, _state: function () { return race; }, _cam: function () { return cam; }, _introCardAt: introCardAt };   // _state/_cam: nur für Tests
  }

  root.CarRace = { start: start };
})(typeof window !== 'undefined' ? window : this);
