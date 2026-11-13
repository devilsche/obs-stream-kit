/* Messer-Ente (effects/knife-duck.html): 3D-Gummiente (Bauteile aus
 * js/item-rain-3d.js) mit bösen Augenbrauen und Messer. Ablauf ~4,4 s:
 * aufploppen → Messer langsam vor das Gesicht heben → Glanz läuft über die
 * Klinge → Throat-Cut quer vor dem Hals mit Wischspur → böser Blick →
 * Messer runter → weg. Ton synthetisch (WebAudio), synchron zum Bild.
 *
 *   KnifeDuck.start({ canvas, x, y, height, volume, reduceMotion, freeze })
 *   freeze: Sekunde, auf der der Ablauf stehen bleibt (zum Prüfen, ?t=)
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, IR = root.ItemRain3D;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function easeOutBack(t) { t = clamp01(t); var c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ── Ton ──
  function makeSound(volume) {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC || volume <= 0) return { play: function () {} };
    var ctx = new AC(), out = ctx.createGain();
    out.gain.value = volume;
    out.connect(ctx.destination);
    function noise(sec) {
      var b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      var s = ctx.createBufferSource(); s.buffer = b; return s;
    }
    function env(g, t, a, peak, dec) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
    }
    var sounds = {
      // leises Ziehen beim Heben
      draw: function (t) {
        var n = noise(0.7), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'bandpass'; f.Q.value = 2.5;
        f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.6);
        env(g, t, 0.15, 0.18, 0.5);
        n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.7);
      },
      // heller Glanz-Ton
      ting: function (t) {
        [3150, 4720, 6300].forEach(function (fq, i) {
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = fq;
          env(g, t, 0.005, 0.07 / (i + 1), 0.5);
          o.connect(g).connect(out); o.start(t); o.stop(t + 0.6);
        });
      },
      // scharfes metallisches „Shing“ mit Nachklingen
      slice: function (t) {
        var n = noise(0.35), hp = ctx.createBiquadFilter(), g = ctx.createGain();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(7000, t); hp.frequency.exponentialRampToValueAtTime(1200, t + 0.22);
        env(g, t, 0.01, 0.55, 0.28);
        n.connect(hp).connect(g).connect(out); n.start(t); n.stop(t + 0.35);
        // Luftzug tief
        var w = noise(0.3), lp = ctx.createBiquadFilter(), wg = ctx.createGain();
        lp.type = 'lowpass'; lp.frequency.value = 900;
        env(wg, t, 0.02, 0.35, 0.22);
        w.connect(lp).connect(wg).connect(out); w.start(t); w.stop(t + 0.3);
        // Klinge klingt nach (unharmonische Teiltöne)
        [1830, 2680, 3910, 5240, 7020].forEach(function (fq, i) {
          var o = ctx.createOscillator(), og = ctx.createGain();
          o.type = 'sine'; o.frequency.value = fq * (1 + (Math.random() - 0.5) * 0.004);
          env(og, t + 0.02, 0.004, 0.16 / (1 + i * 0.6), 1.3 - i * 0.15);
          o.connect(og).connect(out); o.start(t); o.stop(t + 1.5);
        });
      }
    };
    return {
      play: function (name, at) {
        if (ctx.state === 'suspended') ctx.resume().catch(function () {});
        sounds[name](ctx.currentTime + (at || 0));
      }
    };
  }

  // ── Umgebung für Spiegelungen (Klinge, Gummiglanz) ──
  function envMap(renderer) {
    var c = document.createElement('canvas'); c.width = 512; c.height = 256;
    var x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#b9c6d6'); g.addColorStop(0.55, '#5a6470'); g.addColorStop(1, '#1d2026');
    x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(60, 40, 120, 30); x.fillRect(330, 60, 90, 24);
    var tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    var pm = new THREE.PMREMGenerator(renderer);
    var rt = pm.fromEquirectangular(tex);
    pm.dispose();
    return rt.texture;
  }

  // ── Modell (Modell-Einheiten: Ente ~2.1 hoch, Schnabel zeigt nach +x) ──
  function buildDuck() {
    var E = IR.ellipsoid;
    function phys(hex, o) { var m = new THREE.MeshPhysicalMaterial(Object.assign({ color: hex }, o)); m.color.convertSRGBToLinear(); return m; }
    var yellow = phys(0xffc81a, { roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15, envMapIntensity: 0.6 });
    var beak = phys(0xff7a12, { roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.5 });
    var beakLow = phys(0xe0580a, { roughness: 0.4, clearcoat: 0.6, envMapIntensity: 0.4 });
    var black = phys(0x101010, { roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
    var white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    var steel = phys(0xdfe6ee, { metalness: 1, roughness: 0.12, envMapIntensity: 1.4 });
    var bolster = phys(0x9aa3ad, { metalness: 1, roughness: 0.3, envMapIntensity: 1.1 });
    var wood = phys(0x5a3519, { roughness: 0.55, clearcoat: 0.4 });

    var duck = new THREE.Group();
    function add(parent, gm, mat, x, y, z, rx, ry, rz) {
      var m = new THREE.Mesh(gm, mat);
      m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0);
      parent.add(m); return m;
    }
    add(duck, IR.duckBody(), yellow, 0, 0, 0);
    add(duck, E(0.42, 0.34, 0.42, 28), yellow, 0.55, 0.42, 0);
    var head = new THREE.Group(); head.position.set(0.62, 0.86, 0); duck.add(head);
    add(head, E(0.58, 0.56, 0.56, 48), yellow, 0, 0, 0);
    add(head, E(0.38, 0.13, 0.3, 28), beak, 0.6, -0.06, 0, 0, 0, -0.12);
    add(head, E(0.31, 0.09, 0.25, 24), beakLow, 0.54, -0.17, 0, 0, 0, -0.05);
    var brows = [];
    [-1, 1].forEach(function (s) {
      add(head, E(0.09, 0.11, 0.075, 18), black, 0.4, 0.2, s * 0.36, 0, s * 0.6, 0);
      add(head, E(0.03, 0.03, 0.025, 8), white, 0.47, 0.24, s * 0.39);
      // böse Augenbrauen: innen tief, außen hoch
      var b = add(head, E(0.05, 0.035, 0.2, 16), black, 0.42, 0.38, s * 0.33);
      b.userData.side = s; brows.push(b);
    });
    // linker Flügel liegt verschränkt am Bauch, rechter hält das Messer
    add(duck, E(0.55, 0.3, 0.12, 28), yellow, 0.25, 0.05, 0.8, 0, 0.5, 0.6);
    var arm = add(duck, E(0.5, 0.26, 0.22, 28), yellow, 0, 0, 0);
    // Messer: Klinge (flach, zeigt mit der Spitze nach +y), Zwinge, Holzgriff
    var knife = new THREE.Group();
    var bs = new THREE.Shape();
    bs.moveTo(0, 0); bs.lineTo(0.2, 0); bs.quadraticCurveTo(0.24, 0.7, 0.03, 1.25); bs.quadraticCurveTo(-0.02, 0.6, 0, 0);
    var blade = new THREE.ExtrudeGeometry(bs, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 24 });
    blade.translate(-0.1, 0, -0.0125);
    add(knife, blade, steel, 0, 0.06, 0, 0, Math.PI / 2, 0);
    add(knife, new THREE.BoxGeometry(0.07, 0.07, 0.26), bolster, 0, 0.03, 0);
    add(knife, new THREE.CylinderGeometry(0.075, 0.085, 0.48, 18), wood, 0, -0.24, 0);
    duck.add(knife);
    // Glanz auf der Klinge (Sternchen, läuft nach oben)
    var gc = document.createElement('canvas'); gc.width = gc.height = 128;
    var gx = gc.getContext('2d'), rg = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.2, 'rgba(255,255,255,.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = rg; gx.fillRect(0, 0, 128, 128);
    gx.fillStyle = '#fff'; gx.fillRect(62, 4, 4, 120); gx.fillRect(4, 62, 120, 4);
    var glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
    glint.scale.set(0.5, 0.5, 1); glint.visible = false;
    knife.add(glint);
    // Wischspur beim Schnitt
    var tc = document.createElement('canvas'); tc.width = 256; tc.height = 32;
    var tx = tc.getContext('2d'), tg = tx.createLinearGradient(0, 0, 256, 0);
    tg.addColorStop(0, 'rgba(255,255,255,0)'); tg.addColorStop(1, 'rgba(255,255,255,.95)');
    tx.fillStyle = tg; tx.beginPath(); tx.moveTo(0, 16); tx.lineTo(256, 4); tx.lineTo(256, 28); tx.closePath(); tx.fill();
    var trail = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.14), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(tc), transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
    trail.visible = false;
    duck.add(trail);
    return { duck: duck, head: head, brows: brows, arm: arm, knife: knife, glint: glint, trail: trail };
  }

  // Messer-Haltungen (Modell-Koordinaten; x zum Betrachter, z zur Seite)
  // roll = Drehung in der Bildebene (um x)
  var POSE = {
    low:   { p: [1.6, 0.1, 0.0], roll: 0.75 },
    up:    { p: [1.8, 1.0, 0.12], roll: 0.05 },
    cutA:  { p: [1.75, 0.34, -0.75], roll: 1.6 },
    cutB:  { p: [1.75, 0.32, 0.72], roll: 1.6 },
    hold:  { p: [1.6, 0.22, 0.55], roll: 1.0 }
  };
  function poseAt(t) {
    // Zeitplan in Sekunden
    var K = [[0, 'low'], [0.45, 'low'], [1.2, 'up'], [1.55, 'up'], [1.6, 'cutA'], [1.78, 'cutB'], [2.1, 'hold'], [3.3, 'hold'], [3.8, 'low']];
    for (var i = 0; i < K.length - 1; i++) {
      if (t <= K[i + 1][0]) {
        var a = POSE[K[i][1]], b = POSE[K[i + 1][1]], span = K[i + 1][0] - K[i][0];
        var k = span > 0 ? (K[i + 1][1] === 'cutB' ? clamp01((t - K[i][0]) / span) : ease((t - K[i][0]) / span)) : 1;
        return { p: [lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k), lerp(a.p[2], b.p[2], k)], roll: lerp(a.roll, b.roll, k) };
      }
    }
    return POSE.low;
  }

  function start(opts) {
    var W = 1920, H = 1080;
    var renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    var scene = new THREE.Scene();
    scene.environment = envMap(renderer);
    var cam = new THREE.OrthographicCamera(0, W, 0, -H, -3000, 3000); cam.position.z = 1500;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a6a30, 0.55));
    var key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(-0.8, 1.2, 1.4); scene.add(key);
    var rim = new THREE.DirectionalLight(0xfff2cc, 0.4); rim.position.set(1, 0.2, -0.6); scene.add(rim);

    var m = buildDuck(), duck = m.duck;
    var holder = new THREE.Group(); holder.add(duck); scene.add(holder);
    // Schnabel zum Betrachter, leicht schräg
    duck.rotation.y = -Math.PI / 2 + 0.35;
    duck.position.set(-0.1, -0.2, 0);
    var unit = (opts.height || 430) / 2.2;
    holder.position.set(opts.x || 960, -(opts.y || 700), 0);
    var snd = makeSound(opts.volume == null ? 0.6 : opts.volume);
    var cues = [['draw', 0.5], ['ting', 1.25], ['slice', 1.6]], fired = {};
    var SHOULDER = new THREE.Vector3(0.75, 0.3, -0.5), TOTAL = 4.4, t0 = null;

    function frame(ts) {
      if (t0 === null) t0 = ts;
      var t = opts.freeze != null ? opts.freeze : (ts - t0) / 1000;
      if (opts.freeze == null) cues.forEach(function (c) { if (!fired[c[0]] && t >= c[1]) { fired[c[0]] = true; snd.play(c[0]); } });
      // auf- und abploppen
      var sIn = easeOutBack(t / 0.4), sOut = 1 - ease((t - 3.85) / 0.45);
      var s = unit * Math.max(0, Math.min(sIn, sOut));
      holder.scale.set(s, s, s);
      // leichtes Atmen und Kopfneigen, beim Schnitt ruckt der Kopf
      var cut = clamp01((t - 1.58) / 0.25) * (1 - clamp01((t - 1.9) / 0.4));
      duck.rotation.z = Math.sin(t * 2.2) * 0.02 - 0.06 * ease((t - 0.45) / 0.8) + 0.08 * cut;
      m.head.rotation.z = -0.1 * ease((t - 0.45) / 0.8) + 0.06 * cut;
      // Augenbrauen senken sich, je näher der Schnitt
      var anger = ease((t - 0.3) / 1.0);
      // innen (zum Schnabel) tief, außen hoch: böse
      m.brows.forEach(function (b) { b.rotation.x = -b.userData.side * (0.35 + 0.35 * anger); b.position.y = 0.38 - 0.06 * anger; });
      // Messer und Arm
      var ps = poseAt(t);
      m.knife.position.set(ps.p[0], ps.p[1], ps.p[2]);
      m.knife.rotation.set(ps.roll, 0, 0);
      var grip = new THREE.Vector3(ps.p[0], ps.p[1] - 0.2, ps.p[2]);
      var mid = SHOULDER.clone().add(grip).multiplyScalar(0.5), dir = grip.clone().sub(SHOULDER);
      m.arm.position.copy(mid);
      m.arm.scale.set(Math.max(0.6, dir.length() / 1.0), 1, 1);
      m.arm.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
      // Glanz läuft die Klinge hinauf
      var gk = clamp01((t - 1.22) / 0.3);
      m.glint.visible = gk > 0 && gk < 1;
      m.glint.position.set(0.06, 0.2 + gk * 1.0, 0);
      var gs = 0.25 + Math.sin(gk * Math.PI) * 0.45; m.glint.scale.set(gs, gs, 1);
      // Wischspur hinter der Klinge beim Schnitt
      var tk = clamp01((t - 1.6) / 0.18), tf = 1 - clamp01((t - 1.78) / 0.3);
      m.trail.visible = t > 1.6 && tf > 0;
      if (m.trail.visible) {
        var za = POSE.cutA.p[2], zb = lerp(za, POSE.cutB.p[2], tk);
        m.trail.position.set(1.85, 0.5, (za + zb) / 2);
        m.trail.rotation.set(0, Math.PI / 2, 0);
        m.trail.scale.set(Math.max(0.01, Math.abs(zb - za)), 1, 1);
        m.trail.material.opacity = tf;
      }
      renderer.render(scene, cam);
      if (opts.freeze != null || t < TOTAL + 0.2) requestAnimationFrame(frame);
      else renderer.clear();
    }
    requestAnimationFrame(frame);
  }

  root.KnifeDuck = { start: start };
})(typeof window !== 'undefined' ? window : this);
