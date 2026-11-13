/* Messer-Ente (effects/knife-duck.html) im Stil der Telegram-„Utya“-Sticker:
 * Toon-Shading (zwei Gelbtöne), dicke dunkelorange Kontur, ein Blob aus Kopf
 * und Körper, böse Brauen. Ablauf wie das GIF, gekürzt auf ~4 s: aufploppen →
 * Messer ruckt hoch vor das Gesicht (federt nach) → Glanzstern an der Spitze →
 * der andere Flügel setzt am Hals an, Starre, zieht langsam quer rüber
 * (Cut-Throat, mit Kratzen der Klinge) und bleibt am Kinn →
 * böser Blick, blauer Ring pulsiert → Messer runter → weg. Animiert „auf
 * Zweien“ (Pose steht 1/15 s). Sitzt standardmäßig auf dem unteren Bildrand und
 * wird weich ein- und ausgeblendet. Ton als Dateien (assets/sounds/knife-draw.mp3,
 * knife-glint.mp3, knife-swipe.mp3); fehlt eine, bleibt es an der Stelle still.
 *
 *   KnifeDuck.start({ canvas, style, x, y, height, volume, freeze, soundBase })
 *   style: 'sticker' (Standard, Utya-Toon) oder 'rubber' (sitzende 3D-Gummiente)
 *   freeze: Sekunde, auf der der Ablauf stehen bleibt (zum Prüfen, ?t=)
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function back(t) { t = clamp01(t); var c = 2.2; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  var COL = {
    yellow: 0xffcd2a, shade: 0xe39612, line: 0x9a4a08, beak: 0xff8a2a, beakShade: 0xd5561a,
    black: 0x1b1b1b, blade: 0xb6e6ff, bladeShade: 0x72b6e2, bladeLine: 0x1d5a86, handle: 0x3a3f4a, ring: 0x59c8ff
  };

  // ── Toon: zwei feste Farbstufen (Licht/Schatten) nach Lichteinfall ──
  function toon(light, dark) {
    // Grenze Licht/Schatten über ~1 Pixel weich (fwidth), sonst treppig
    var m = new THREE.ShaderMaterial({
      extensions: { derivatives: true },
      uniforms: { cLight: { value: new THREE.Color(light) }, cDark: { value: new THREE.Color(dark) }, lightDir: { value: new THREE.Vector3(-0.55, 0.65, 0.55).normalize() } },
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 cLight; uniform vec3 cDark; uniform vec3 lightDir; varying vec3 vN;' +
        'void main(){ float d = dot(normalize(vN), lightDir); float w = fwidth(d) * 1.2;' +
        ' gl_FragColor = vec4(mix(cDark, cLight, smoothstep(-0.05 - w, -0.05 + w, d)), 1.0); }'
    });
    return m;
  }
  function flat(hex) { return new THREE.MeshBasicMaterial({ color: hex }); }
  // Kontur: Rückseiten-Hülle, entlang der Normalen aufgeblasen
  function outline(mesh, width, hex) {
    var g = mesh.geometry.clone(), p = g.attributes.position, n = g.attributes.normal;
    for (var i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * width, p.getY(i) + n.getY(i) * width, p.getZ(i) + n.getZ(i) * width);
    var o = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: hex, side: THREE.BackSide }));
    mesh.add(o);
    return o;
  }
  function ell(rx, ry, rz, seg) { var g = new THREE.SphereGeometry(1, seg || 40, Math.round((seg || 40) * 0.7)); g.scale(rx, ry, rz); return g; }

  // ── Modell (Einheiten: Ente ~2.7 hoch, schaut nach +z) ──
  // Umgebung zum Spiegeln (Stahl, Gummiglanz): heller Himmel, dunkler Boden, zwei Lichtstreifen
  function envMap(renderer) {
    var c = document.createElement('canvas'); c.width = 512; c.height = 256;
    var x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#b9c6d6'); g.addColorStop(0.55, '#5a6470'); g.addColorStop(1, '#1d2026');
    x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(60, 40, 120, 30); x.fillRect(330, 60, 90, 24);
    var tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    var pm = new THREE.PMREMGenerator(renderer), rt = pm.fromEquirectangular(tex);
    pm.dispose();
    return rt.texture;
  }
  function phys(hex, o) { var m = new THREE.MeshPhysicalMaterial(Object.assign({ color: hex }, o)); m.color.convertSRGBToLinear(); return m; }

  // Gummiente (Modell aus js/item-rain-3d.js): sitzt, schräg zur Kamera,
  // böse Brauen; Arme, Messer und Geste kommen wie beim Sticker dazu
  function rubberBody(parent) {
    var IR = root.ItemRain3D, E = IR.ellipsoid;
    // Vinyl: warmes, sattes Gelb, seidenmatt, leicht durchscheinend (warmes Eigenleuchten)
    var yel = phys(0xf4b710, { roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.45, envMapIntensity: 0.35, emissive: 0x3a1c00 });
    var beak = phys(0xf26b10, { roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.3, emissive: 0x2a0a00 });
    var beakLow = phys(0xd2500c, { roughness: 0.55, envMapIntensity: 0.25 });
    var paint = new THREE.MeshBasicMaterial({ color: 0x0b0b0b }); paint.color.convertSRGBToLinear();
    var white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    var g = new THREE.Group();
    function add(gm, mat, x, y, z, rx, ry, rz) { var m = new THREE.Mesh(gm, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0); g.add(m); return m; }
    add(IR.duckBody(), yel, 0, 0, 0);
    add(E(0.42, 0.34, 0.42, 28), yel, 0.55, 0.42, 0);
    var HC = new THREE.Vector3(0.62, 0.86, 0), HR = 0.56;
    add(E(HR, 0.54, 0.54, 48), yel, HC.x, HC.y, HC.z);
    add(E(0.38, 0.13, 0.3, 28), beak, 1.2, 0.82, 0, 0, 0, -0.12);
    add(E(0.31, 0.09, 0.25, 24), beakLow, 1.14, 0.7, 0, 0, 0, -0.05);
    // aufgemalt: flache Form auf der Kopfoberfläche, entlang der Normalen ausgerichtet
    function decal(geo, mat, dir, tilt) {
      var n = dir.clone().normalize(), m = new THREE.Mesh(geo, mat);
      m.position.copy(HC).addScaledVector(n, HR * 0.985);
      m.lookAt(m.position.clone().add(n));
      m.rotateZ(tilt || 0);
      g.add(m);
      return m;
    }
    [-1, 1].forEach(function (s) {
      var eDir = new THREE.Vector3(0.62, 0.32, s * 0.72);
      decal(E(0.075, 0.095, 0.012, 20), paint, eDir, 0);
      // Lichtpunkt oben vorn im Auge
      decal(E(0.024, 0.028, 0.014, 10), white, new THREE.Vector3(0.66, 0.4, s * 0.66), 0);
      // böse Braue: geschwungener Strich, vorn (zum Schnabel) tief
      var bDir = new THREE.Vector3(0.5, 0.66, s * 0.6);
      decal(E(0.16, 0.038, 0.012, 20), paint, bDir, -s * 0.55);
    });
    g.rotation.y = -Math.PI / 2 + 0.55;
    parent.add(g);
    return yel;
  }

  function build(style) {
    var rubber = style === 'rubber';
    var duck = new THREE.Group();
    var yel = toon(COL.yellow, COL.shade), beakM = toon(COL.beak, COL.beakShade), blk = flat(COL.black), wht = flat(0xffffff);
    function part(geo, mat, x, y, z, line, parent) {
      var m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
      (parent || duck).add(m);
      if (line && !rubber) outline(m, line, COL.line);
      return m;
    }
    var eyes = [], brows = [];
    if (rubber) yel = rubberBody(duck);
    else {
    // Kopf-Körper-Blob als Drehkörper: unten breit, leichte Taille, großer Kopf
    // Umriss als eine glatte Polarkurve: großer Kopf, weiche Delle am Hals,
    // flacher Boden – keine Knicke, keine Stufen in der Kontur
    var prof = [];
    for (var i = 0; i <= 120; i++) {
      var th = -Math.PI / 2 + Math.PI * i / 120;
      // weiche Delle am Hals (knapp über der Mitte), Kopf oben voll, Boden flacher
      var R = 1 + 0.07 * Math.sin(th) - 0.1 * Math.exp(-Math.pow((th - 0.12) / 0.32, 2));
      var y = 0.36 + 1.3 * R * Math.sin(th);
      if (y < -0.7) y = -0.7 + (y + 0.7) * 0.45;
      prof.push(new THREE.Vector2(Math.max(0.0005, 1.05 * R * Math.cos(th)), y));
    }
    prof[0].x = 0; prof[prof.length - 1].x = 0;
    var blobGeo = new THREE.LatheGeometry(prof, 128);
    blobGeo.computeVertexNormals();
    part(blobGeo, yel, 0, 0, 0, 0.06);
    // Glanzstreif oben links
    var hl = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.045, 8, 40, 0.85), wht);
    hl.position.set(-0.02, 0.84, 0.36); hl.rotation.set(-0.35, -0.45, 1.6);
    duck.add(hl);
    // Schnabel: klein, Unterschnabel etwas zurück
    var beak = new THREE.Group(); beak.position.set(0.04, 0.6, 1.0); duck.add(beak);
    part(ell(0.36, 0.15, 0.27, 32), beakM, 0, 0.03, 0, 0.04, beak);
    part(ell(0.28, 0.1, 0.2, 28), beakM, 0, -0.11, -0.04, 0.035, beak);
    // Augen mit Lichtpunkt (Pupillen wandern beim Seitenblick)
    [-1, 1].forEach(function (s) {
      var e = part(ell(0.15, 0.19, 0.08, 20), blk, s * 0.38, 0.92, 0.94, 0);
      var c = new THREE.Mesh(ell(0.05, 0.055, 0.02, 10), wht); c.position.set(-0.04, 0.06, 0.07); e.add(c);
      e.userData.x0 = s * 0.38; eyes.push(e);
    });
    // böse Brauen: dicke Balken, innen tief
    [-1, 1].forEach(function (s) {
      var b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.38, 12), blk);
      b.position.set(s * 0.38, 1.2, 0.92); b.rotation.set(0, 0, Math.PI / 2 + s * 0.45);
      duck.add(b); b.userData.s = s; brows.push(b);
    });
    // kleine Watschelfüße vorn unter dem Bauch
    var feet = toon(COL.beak, COL.beakShade);
    [-1, 1].forEach(function (sd) {
      var f = part(ell(0.24, 0.07, 0.2, 24), feet, sd * 0.32, -0.74, 0.62, 0.035);
      f.rotation.y = sd * 0.35;
    });
    }
    // Flügel: links (Bild) hält das Messer, rechts macht die Geste und bleibt am Kinn
    var swipe = part(ell(0.36, 0.17, 0.2, 24), yel, 0.6, -0.1, 0.84, 0.04);
    var hand = part(ell(0.26, 0.2, 0.2, 24), yel, -0.55, 0.0, 0.9, 0.04);
    // Messer: großes Kochmesser, Klinge hellblau mit dunkler Kontur und Glanzstreif
    var knife = new THREE.Group(); duck.add(knife);
    var bs = new THREE.Shape();
    bs.moveTo(-0.16, 0); bs.lineTo(0.2, 0); bs.lineTo(0.22, 0.9); bs.quadraticCurveTo(0.2, 1.25, 0.02, 1.45); bs.quadraticCurveTo(-0.16, 0.9, -0.16, 0);
    var bladeGeo = new THREE.ExtrudeGeometry(bs, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1, curveSegments: 20 });
    bladeGeo.translate(0, 0.12, -0.02);
    bladeGeo.computeVertexNormals();
    var blade = new THREE.Mesh(bladeGeo, rubber ? phys(0xdfe6ee, { metalness: 1, roughness: 0.15 }) : toon(COL.blade, COL.bladeShade)); knife.add(blade);
    if (!rubber) {
      // Kontur: dieselbe Form gleichmäßig breiter (großer Rand), dunkel, direkt dahinter
      var lineGeo = new THREE.ExtrudeGeometry(bs, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.055, bevelSegments: 3, curveSegments: 20 });
      lineGeo.translate(0, 0.12, -0.05);
      knife.add(new THREE.Mesh(lineGeo, flat(COL.bladeLine)));
    }
    var shine = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.95), wht); shine.position.set(0.1, 0.62, 0.05); shine.rotation.z = -0.04; knife.add(shine);
    var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.45, 16), rubber ? phys(0x5a3519, { roughness: 0.55, clearcoat: 0.4 }) : toon(COL.handle, 0x23262d));
    handle.position.y = -0.14; knife.add(handle);
    if (!rubber) outline(handle, 0.03, 0x111317);
    if (rubber) knife.scale.set(0.8, 0.8, 0.8);
    // Glanzstern (vierzackig)
    var sc = document.createElement('canvas'); sc.width = sc.height = 128;
    var sx = sc.getContext('2d'); sx.fillStyle = '#fff';
    sx.beginPath(); sx.moveTo(64, 0); sx.quadraticCurveTo(70, 58, 128, 64); sx.quadraticCurveTo(70, 70, 64, 128); sx.quadraticCurveTo(58, 70, 0, 64); sx.quadraticCurveTo(58, 58, 64, 0); sx.fill();
    var star = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthTest: false }));
    star.position.set(0.04, 1.55, 0.1); star.visible = false; knife.add(star);
    // blauer Ring am Boden
    var ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 64), new THREE.MeshBasicMaterial({ color: COL.ring, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2 + 0.25; ring.position.y = -1.0;
    if (!rubber) duck.add(ring);
    return { duck: duck, knife: knife, hand: hand, swipe: swipe, eyes: eyes, brows: brows, star: star, ring: ring };
  }

  // Posen je Stil. Messer: tief schräg vor dem Bauch ↔ senkrecht vor dem Gesicht;
  // es liegt vor dem Flügel, der die Geste macht (der zieht zwischen Messer und Ente
  // durch). Geste: Flügel setzt links am Hals an, zieht nach rechts, bleibt am Kinn.
  // bottom = Unterkante in Einheiten, size = Höhe in Einheiten
  var STYLE = {
    sticker: { LOW: { x: -0.42, y: -0.45, z: 1.5, rot: -0.9 }, UP: { x: -0.42, y: 0.1, z: 1.65, rot: 0.06 },
               SW0: { x: -0.2, y: 0.38, rot: 0.1 }, SW1: { x: 0.48, y: 0.42, rot: 0.25 }, REST: { x: 0.62, y: -0.1, rot: 0.6 },
               swipeZ: function (x) { return 1.06 * Math.sqrt(Math.max(0, 1 - Math.pow(x / 1.1, 2))) + 0.14; }, bottom: 0.83, size: 2.9 },
    rubber:  { LOW: { x: -0.55, y: -0.3, z: 1.4, rot: -0.9 }, UP: { x: 0.05, y: 0.35, z: 1.7, rot: 0.06 },
               SW0: { x: 0.08, y: 0.48, rot: 0.1 }, SW1: { x: 0.82, y: 0.5, rot: 0.25 }, REST: { x: 0.9, y: 0.02, rot: 0.6 },
               swipeZ: function () { return 1.25; }, bottom: 0.53, size: 2.1 }
  };

  function sound(src, volume) {
    var a = new Audio(src); a.preload = 'auto'; a.volume = volume;
    return { play: function () { try { a.currentTime = 0; var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ohne Ton */ } } };
  }

  function start(opts) {
    var W = 1920, H = 1080;
    var renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, alpha: true, antialias: true });
    // doppelte Auflösung, der Browser skaliert herunter: glatte Kanten
    renderer.setPixelRatio(2); renderer.setSize(W, H, false); renderer.setClearColor(0x000000, 0);
    var scene = new THREE.Scene();
    var cam = new THREE.OrthographicCamera(0, W, 0, -H, -3000, 3000); cam.position.z = 1500;

    var styleName = opts.style === 'rubber' ? 'rubber' : 'sticker', ST = STYLE[styleName];
    var LOW = ST.LOW, UP = ST.UP, SW0 = ST.SW0, SW1 = ST.SW1, REST = ST.REST;
    if (styleName === 'rubber') {
      // echtes Licht für das glänzende Gummi (Sticker hat flache Toon-Farben)
      renderer.outputEncoding = THREE.sRGBEncoding;
      scene.environment = envMap(renderer);
      // weicheres, wärmeres Licht: Vinyl statt Hochglanz
      scene.add(new THREE.HemisphereLight(0xfff6e0, 0x6a4a20, 0.5));
      var key = new THREE.DirectionalLight(0xfff4e0, 0.8); key.position.set(-0.8, 1.2, 1.4); scene.add(key);
      var rim = new THREE.DirectionalLight(0xffe2a8, 0.25); rim.position.set(1, -0.3, 0.6); scene.add(rim);
    }
    var m = build(styleName), holder = new THREE.Group();
    holder.add(m.duck); scene.add(holder);
    if (styleName === 'sticker') m.duck.rotation.y = 0.15;
    var unit = (opts.height || 430) / ST.size;
    holder.scale.set(unit, unit, unit);
    // ohne y: sitzt 50 px über dem unteren Bildrand (Unterseite der Kontur bei ~0.83 Einheiten)
    var y = opts.y != null ? opts.y : H - ST.bottom * unit - 50;
    holder.position.set(opts.x || 960, -y, 0);
    var vol = opts.volume == null ? 0.7 : opts.volume, base = opts.soundBase || '../assets/sounds/';
    var cues = [[sound(base + 'knife-draw.mp3', vol), 0.35], [sound(base + 'knife-glint.mp3', vol), 0.7], [sound(base + 'knife-swipe.mp3', vol), 1.65]];
    var fired = [], TOTAL = 4.75, t0 = null;

    function frame(ts) {
      if (t0 === null) t0 = ts;
      var real = opts.freeze != null ? opts.freeze : (ts - t0) / 1000;
      if (opts.freeze == null) cues.forEach(function (c, i) { if (!fired[i] && real >= c[1]) { fired[i] = true; c[0].play(); } });
      // „auf Zweien“: Posen springen in 1/15-s-Schritten
      var t = Math.floor(real * 15) / 15;
      // weich ein- und ausblenden (Deckkraft der Fläche, CSS-Variable --fade)
      var fade = Math.max(0, Math.min(ease(real / 0.25), 1 - ease((real - 4.3) / 0.45)));
      opts.canvas.style.setProperty('--fade', fade.toFixed(3));
      // Messer ruckt hoch (mit Nachfedern), ab 3.85 wieder runter
      var k = t < 0.35 ? 0 : t < 3.85 ? back((t - 0.35) / 0.22) : 1 - ease((t - 3.85) / 0.35);
      m.knife.position.set(lerp(LOW.x, UP.x, k), lerp(LOW.y, UP.y, k), lerp(LOW.z, UP.z, k));
      m.knife.rotation.set(0, 0, lerp(LOW.rot, UP.rot, k));
      m.hand.position.set(m.knife.position.x - 0.06, m.knife.position.y - 0.12, m.knife.position.z + 0.08);
      // Cut-Throat: 1.1 an den Hals, starrt kurz, 1.65–2.85 langsam quer rüber,
      // bleibt am Kinn; ab 3.85 zurück
      var a = ease((t - 1.1) / 0.2), b = clamp01((t - 1.65) / 1.2), r = ease((t - 3.85) / 0.3);
      b = b * b * (3 - 2 * b) * 0.25 + b * 0.75;   // fast gleichmäßig, weich an den Enden
      var P = { x: lerp(lerp(REST.x, SW0.x, a), SW1.x, b), y: lerp(lerp(REST.y, SW0.y, a), SW1.y, b), rot: lerp(lerp(REST.rot, SW0.rot, a), SW1.rot, b) };
      P = { x: lerp(P.x, REST.x, r), y: lerp(P.y, REST.y, r), rot: lerp(P.rot, REST.rot, r) };
      // immer knapp vor der Körperoberfläche
      m.swipe.position.set(P.x, P.y, ST.swipeZ(P.x)); m.swipe.rotation.set(0, 0, P.rot);
      // Seitenblick zum Messer, zur Geste wieder starr nach vorn
      var look = ease((t - 0.45) / 0.1) * (1 - ease((t - 1.1) / 0.1));
      m.eyes.forEach(function (e) { e.position.x = e.userData.x0 - 0.07 * look; });
      var anger = ease((t - 0.35) / 0.2);
      m.brows.forEach(function (bw) { bw.position.y = 1.2 - 0.05 * anger; bw.rotation.z = Math.PI / 2 + bw.userData.s * (0.45 + 0.12 * anger); });
      // Glanzstern blinkt an der Spitze
      var gs = (t >= 0.7 && t < 1.05) ? Math.sin(((t - 0.7) / 0.35) * Math.PI) : 0;
      m.star.visible = gs > 0.02; m.star.scale.set(0.65 * gs, 0.65 * gs, 1); m.star.material.rotation = gs * 0.6;
      // blauer Ring pulsiert beim Hochreißen und bei der Geste
      var r1 = clamp01((t - 0.35) / 0.6), r2 = clamp01((t - 1.65) / 0.8), rr = r2 > 0 ? r2 : r1;
      m.ring.material.opacity = (rr > 0 && rr < 1) ? (1 - rr) * 0.9 : 0;
      var rs = 1.15 + rr * 0.5; m.ring.scale.set(rs, rs, rs);
      renderer.render(scene, cam);
      if (opts.freeze != null || real < TOTAL + 0.2) requestAnimationFrame(frame);
      else renderer.clear();
    }
    requestAnimationFrame(frame);
  }

  root.KnifeDuck = { start: start };
})(typeof window !== 'undefined' ? window : this);
