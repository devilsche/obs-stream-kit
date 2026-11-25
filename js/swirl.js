/* Swirl – WebGL-Hintergrund-Wirbel für Alerts (effects/swirl.html), läuft UNTER der Alert-Quelle.
 *
 * Ein leuchtender Komet fliegt eine Spirale um die Bildmitte (dort steht die Alert-Box) und zieht
 * ein Lichtband hinter sich her. Von seiner Bahn lösen sich Partikel, die in einem wirbelfreien
 * Strömungsfeld (Curl-Noise) wie Rauch verwirbeln und verglimmen. Die Mitte bleibt frei, damit der
 * Alert-Text lesbar ist; zum Bildrand blendet alles weich aus. Alle Partikel rechnet der Grafikchip
 * aus Startwerten und Zeit, JS bewegt nur Zeit, Kometenkopf und Ton.
 *
 *   var s = Swirl.create({ canvas, accent, primary, density, sound, volume });
 *   s.play({ preset: 'follow', duration: 6 });
 *
 * Presets sind für die spätere Vereinheitlichung aller Alerts vorbereitet (zunächst nur follow).
 * Mehrere Aufrufe kurz hintereinander laufen nacheinander ab (Warteschlange, höchstens 4).
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  // turns: Umläufe bis zur Innenbahn; fly: Anteil der Dauer bis zur Innenbahn; dust/smoke: Partikel bei density 1
  var PRESETS = {
    follow: { turns: 1.5, fly: 0.58, dust: 16000, smoke: 3200, strands: 3, head: 1 }
  };
  var PRESET_NAMES = Object.keys(PRESETS);
  var QUEUE_MAX = 4;

  // Bahn: Ellipsen-Spirale um uC, Radius von uR0 auf uR1, danach weiter auf der Innenbahn
  var PATH = [
    'uniform vec2 uC, uE; uniform float uR0, uR1, uTh0, uTurns, uDir;',
    'vec2 path(float s){ float k = clamp(s, 0.0, 1.0); float r = mix(uR0, uR1, 1.0 - (1.0 - k) * (1.0 - k));',
    '  float th = uTh0 + uDir * s * uTurns * 6.2831853; r *= 1.0 + 0.07 * sin(th * 2.0 + uTh0 * 3.0) + 0.04 * sin(th * 3.0 - 1.3);',
    '  return uC + vec2(cos(th) * uE.x, sin(th) * uE.y) * r; }'
  ].join('\n');
  // Wirbelfreies Strömungsfeld: Rotation eines Potenzials aus Sinuswellen (zusammenhängende Rauchfäden)
  var CURL = [
    'uniform float uT;',
    'vec2 curl(vec2 q){ vec2 g = vec2(0.0); vec2 k; float c;',
    '  k = vec2(0.0062, 0.0049); c = cos(dot(k, q) + uT * 0.35); g += k * c * 1.0;',
    '  k = vec2(-0.0081, 0.0107); c = cos(dot(k, q) - uT * 0.28 + 1.7); g += k * c * 0.8;',
    '  k = vec2(0.0143, -0.0121); c = cos(dot(k, q) + uT * 0.5 + 4.1); g += k * c * 0.55;',
    '  k = vec2(0.031, 0.027); c = cos(dot(k, q) + 2.3); g += k * c * 0.25;',
    '  return vec2(g.y, -g.x) * 150.0; }'
  ].join('\n');
  var EDGE = 'uniform vec2 res; float edgeFade(){ vec2 p = gl_FragCoord.xy / res; vec2 e = smoothstep(0.0, 0.05, p) * smoothstep(0.0, 0.05, 1.0 - p); return e.x * e.y; }';
  var COMMON = 'uniform float uTfly, uD, uPR, uFade; uniform vec2 uClear; uniform vec3 uAcc, uPri;';

  // Partikel: aS = Startpunkt auf der Bahn, aR = Zufall, aL = Lebensdauer, aK = 0 Staub / 1 Rauchwolke
  var DUST_VS = [PATH, CURL, COMMON,
    'attribute float aS, aL, aK; attribute vec4 aR; varying vec4 vC;',
    'void main(){',
    '  float age = uT - aS * uTfly;',
    '  if (age < 0.0 || age > aL) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 0.0, 1.0); return; }',
    '  vec2 p0 = path(aS), tg = normalize(path(aS + 0.003) - p0), nr = vec2(-tg.y, tg.x), rad = normalize(p0 - uC);',
    '  p0 += nr * (aR.x - 0.5) * mix(55.0, 130.0, aK);',
    '  vec2 vel = rad * mix(-30.0, 95.0, aR.y) - tg * mix(12.0, 110.0, aR.z) + vec2(0.0, -18.0);',
    '  vec2 pl = p0 + vel * age;',
    '  vec2 p = pl + curl(pl + curl(pl) * age * 0.5) * age;',
    '  vec2 d = p - uC; float a = uDir * 0.10 * age; p = uC + vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));',
    '  float k = age / aL;',
    '  float life = smoothstep(0.0, mix(0.06, 0.25, aK), k) * (1.0 - smoothstep(mix(0.45, 0.35, aK), 1.0, k));',
    '  float clear = smoothstep(0.78, 1.05, length((p - uC) / uClear));',
    '  vec3 hot = mix(vec3(1.0, 0.97, 0.92), uAcc, smoothstep(0.0, 0.35, k));',
    '  vec3 col = mix(hot, uPri, smoothstep(0.25, 0.9, k) * 0.8);',
    '  if (aK > 0.5) col = mix(uPri, uAcc, aR.w * 0.4);',
    '  vC = vec4(col, life * clear * uFade * mix(mix(0.55, 1.0, aR.w), mix(0.07, 0.14, aR.w), aK));',
    '  gl_PointSize = mix(mix(2.0, 4.6, aR.w) * (1.0 + k * 0.5), mix(40.0, 105.0, aR.w) * (0.6 + k * 0.9), aK) * uPR;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);',
    '}'].join('\n');
  var DOT_FS = [EDGE, 'varying vec4 vC;',
    'void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float g = pow(max(0.0, 1.0 - d), 1.6);',
    '  float al = g * vC.a * edgeFade(); if (al < 0.002) discard; gl_FragColor = vec4(vC.rgb * al, al); }'].join('\n');

  // Lichtband: Punkte entlang der ganzen bisherigen Bahn; aU = Lage auf der Bahn, aO = Strang
  var TRAIL_VS = [PATH, COMMON,
    'uniform float uT, uSHead, uSMax; attribute float aU, aO; varying vec4 vC;',
    'void main(){',
    '  float s = aU * uSMax, since = (uSHead - s) * uTfly;',
    '  if (since < 0.0) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 0.0, 1.0); return; }',
    '  vec2 p = path(s), tg = normalize(path(s + 0.002) - p), nr = vec2(-tg.y, tg.x);',
    '  p += nr * aO * (2.5 + 3.5 * sin(s * 37.0 + aO * 2.1));',
    '  float a = exp(-since * 1.5) * 0.85 + exp(-since * 0.45) * 0.16;',
    '  vec3 col = mix(vec3(1.0, 0.96, 0.9), mix(uAcc, uPri, 0.35), smoothstep(0.0, 0.5, since));',
    '  bool glow = aO > 5.0; if (glow) p -= nr * aO * (2.5 + 3.5 * sin(s * 37.0 + aO * 2.1));',
    '  vC = vec4(col, a * uFade * (glow ? 0.10 : aO == 0.0 ? 1.0 : 0.75));',
    '  gl_PointSize = (glow ? 22.0 : aO == 0.0 ? 4.0 : 2.6) * uPR;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);',
    '}'].join('\n');

  var QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var HEAD_FS = ['uniform float uA, uPulse; uniform vec3 uAcc;', EDGE, 'varying vec2 vUv;',
    'void main(){ float d = length(vUv - 0.5) * 2.0;',
    '  float core = pow(max(0.0, 1.0 - d * 4.5), 1.5), halo = pow(max(0.0, 1.0 - d), 2.6) * (0.55 + 0.15 * uPulse);',
    '  vec3 c = vec3(1.0, 0.98, 0.95) * core + uAcc * halo; float al = clamp(core + halo, 0.0, 1.0) * uA * edgeFade();',
    '  gl_FragColor = vec4(c * uA * edgeFade(), al); }'].join('\n');

  function blendAdd(o) {
    o.transparent = true; o.depthTest = false; o.depthWrite = false;
    o.blending = THREE.CustomBlending; o.blendSrc = THREE.OneFactor; o.blendDst = THREE.OneFactor;
    return o;
  }
  // Theme-Farben können dunkel sein (z. B. Lila #5e2a79); zum Leuchten auf hellste Stufe anheben
  function glowColor(css, fallback) {
    var c = new THREE.Color(fallback);
    try { if (css) c.set(css); } catch (e) { /* ungültige Farbe → Rückfallwert */ }
    var m = Math.max(c.r, c.g, c.b, 0.001), f = Math.min(1 / m, 3);
    return new THREE.Color(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
  }

  // ── Ton (standardmäßig aus): Rauschen durch einen Bandpass, folgt Tempo und Seite des Kometen ──
  function Sound(volume) {
    var Ctx = root.AudioContext || root.webkitAudioContext, ctx = null, noise = null, cur = null;
    function ensure() {
      if (!Ctx) return null;
      if (!ctx) {
        ctx = new Ctx();
        var n = ctx.sampleRate * 2; noise = ctx.createBuffer(1, n, ctx.sampleRate);
        var d = noise.getChannelData(0); for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function start(dur) {
      var a = ensure(); if (!a || volume <= 0) return;
      stop();
      var t = a.currentTime, src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
      var pan = a.createStereoPanner ? a.createStereoPanner() : null;
      src.buffer = noise; src.loop = true; bp.type = 'bandpass'; bp.Q.value = 1.6; bp.frequency.value = 500;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * volume, t + 0.6);
      g.gain.setValueAtTime(0.35 * volume, t + dur * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp); bp.connect(g);
      if (pan) { g.connect(pan); pan.connect(a.destination); } else g.connect(a.destination);
      src.start(t); src.stop(t + dur + 0.1);
      cur = { bp: bp, pan: pan, src: src };
    }
    function follow(speed, x) {   // speed 0–1, x −1…1
      if (!cur || !ctx) return;
      var t = ctx.currentTime;
      cur.bp.frequency.setTargetAtTime(350 + speed * 1600, t, 0.08);
      if (cur.pan) cur.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, x)), t, 0.1);
    }
    function stop() { if (cur) { try { cur.src.stop(); } catch (e) { /* schon beendet */ } cur = null; } }
    return { start: start, follow: follow, stop: stop, unlock: ensure };
  }

  function create(opt) {
    var canvas = opt.canvas;
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    var scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
    var W = 1, H = 1, res = new THREE.Vector2(1, 1);
    var acc = glowColor(opt.accent, '#f2b705'), pri = glowColor(opt.primary, '#b25cff');
    var density = Math.max(0.2, Math.min(2, opt.density || 1));
    var sound = opt.sound ? Sound(opt.volume == null ? 0.6 : opt.volume) : null;
    var defDur = opt.duration || 6;

    // gemeinsame Uniforms (ein Objekt je Name, von allen Materialien geteilt)
    var U = {
      uC: { value: new THREE.Vector2() }, uE: { value: new THREE.Vector2(1.45, 0.85) },
      uR0: { value: 1 }, uR1: { value: 1 }, uTh0: { value: 0 }, uTurns: { value: 1.5 }, uDir: { value: 1 },
      uT: { value: 0 }, uTfly: { value: 3 }, uD: { value: 6 }, uPR: { value: 1 }, uFade: { value: 0 },
      uClear: { value: new THREE.Vector2(1, 1) }, uAcc: { value: acc }, uPri: { value: pri },
      uSHead: { value: 0 }, uSMax: { value: 1 }, res: { value: res }
    };
    function mat(vs, fs) { return new THREE.ShaderMaterial(blendAdd({ vertexShader: vs, fragmentShader: fs, uniforms: U })); }

    var dust = null, trail = null, head = null, built = null;
    function build(p) {
      if (built === p) return;
      [dust, trail].forEach(function (m) { if (m) { scene.remove(m); m.geometry.dispose(); } });
      var nd = Math.round(p.dust * density), ns = Math.round(p.smoke * density), n = nd + ns;
      var g = new THREE.BufferGeometry(), aS = new Float32Array(n), aL = new Float32Array(n), aK = new Float32Array(n), aR = new Float32Array(n * 4);
      for (var i = 0; i < n; i++) {
        var smoke = i >= nd; aK[i] = smoke ? 1 : 0;
        aS[i] = Math.random();   // wird beim Abspielen über uSEmit gestreckt (siehe play)
        aL[i] = smoke ? 1.6 + Math.random() * 1.6 : 1.0 + Math.random() * 1.6;
        for (var j = 0; j < 4; j++) aR[i * 4 + j] = Math.random();
      }
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aS', new THREE.BufferAttribute(aS, 1)); g.setAttribute('aL', new THREE.BufferAttribute(aL, 1));
      g.setAttribute('aK', new THREE.BufferAttribute(aK, 1)); g.setAttribute('aR', new THREE.BufferAttribute(aR, 4));
      dust = new THREE.Points(g, mat(DUST_VS, DOT_FS)); dust.frustumCulled = false; dust.userData.aS = aS.slice();

      // Stränge: 0 Kern, ±1 Nebenlinien, 9 = breiter weicher Schein um den Kern
      var per = 6000, offs = p.strands === 3 ? [0, -1, 1, 9] : [0, 9], nt = per * offs.length;
      var gt = new THREE.BufferGeometry(), aU = new Float32Array(nt), aO = new Float32Array(nt);
      for (var k = 0; k < nt; k++) { aU[k] = (k % per) / (per - 1); aO[k] = offs[Math.floor(k / per)]; }
      gt.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nt * 3), 3));
      gt.setAttribute('aU', new THREE.BufferAttribute(aU, 1)); gt.setAttribute('aO', new THREE.BufferAttribute(aO, 1));
      trail = new THREE.Points(gt, mat(TRAIL_VS, DOT_FS)); trail.frustumCulled = false;

      if (!head) {
        head = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial(blendAdd({ vertexShader: QUAD_VS, fragmentShader: HEAD_FS,
          uniforms: { uA: { value: 0 }, uPulse: { value: 0 }, uAcc: U.uAcc, res: U.res }, side: THREE.DoubleSide })));
        head.frustumCulled = false; head.renderOrder = 2;
      }
      trail.renderOrder = 1;
      scene.add(dust); scene.add(trail); scene.add(head);
      built = p;
    }

    function resize() {
      W = canvas.clientWidth || root.innerWidth; H = canvas.clientHeight || root.innerHeight;
      renderer.setSize(W, H, false); cam.right = W; cam.bottom = H; cam.updateProjectionMatrix();
      res.set(W * renderer.getPixelRatio(), H * renderer.getPixelRatio());
      U.uPR.value = renderer.getPixelRatio() * Math.max(0.5, H / 1080);
    }
    root.addEventListener('resize', resize); resize();

    // JS-Spiegel der Bahn (für Kometenkopf und Ton)
    function pathJS(s) {
      var k = Math.min(1, Math.max(0, s)), r = U.uR0.value + (U.uR1.value - U.uR0.value) * (1 - (1 - k) * (1 - k));
      var th = U.uTh0.value + U.uDir.value * s * U.uTurns.value * Math.PI * 2;
      return [U.uC.value.x + Math.cos(th) * U.uE.value.x * r, U.uC.value.y + Math.sin(th) * U.uE.value.y * r];
    }

    var queue = [], cur = null;
    function play(params) {
      params = params || {};
      if (queue.length >= QUEUE_MAX) return false;
      queue.push(params);
      if (!cur) next();
      return true;
    }
    function next() {
      var params = queue.shift(); if (!params) { cur = null; return; }
      var p = PRESETS[params.preset] || PRESETS.follow, D = Math.max(2, Math.min(15, +params.duration || defDur));
      build(p);
      var sc = H / 1080;
      U.uC.value.set(W / 2, H / 2);
      U.uR0.value = 0.64 * H; U.uR1.value = 0.31 * H;
      U.uClear.value.set(0.31 * H * 1.45 * 0.84, 0.31 * H * 0.85 * 0.84);
      U.uTurns.value = p.turns; U.uDir.value = Math.random() < 0.5 ? -1 : 1; U.uTh0.value = Math.random() * Math.PI * 2;
      U.uD.value = D; U.uTfly.value = D * p.fly; U.uT.value = 0;
      U.uSMax.value = D / U.uTfly.value;
      // Partikel entstehen bis 70 % der Dauer, damit sie vor dem Ende verglimmen
      var sEmit = (D * 0.7) / U.uTfly.value, src = dust.userData.aS, a = dust.geometry.attributes.aS;
      for (var i = 0; i < src.length; i++) a.array[i] = src[i] * sEmit;
      a.needsUpdate = true;
      head.scale.set(190 * sc, 190 * sc, 1);
      cur = { t: 0, D: D, sc: sc, last: pathJS(0) };
      if (sound) sound.start(D);
    }

    function step(dt) {
      if (!cur) return false;
      cur.t += dt; var t = cur.t, D = cur.D;
      U.uT.value = t;
      U.uFade.value = Math.min(1, t / 0.35) * (1 - Math.max(0, Math.min(1, (t - (D - 1)) / 1)));
      var s = t / U.uTfly.value; U.uSHead.value = s;
      var hp = pathJS(s); head.position.set(hp[0], hp[1], 0);
      head.material.uniforms.uA.value = U.uFade.value * Math.min(1, t / 0.25);
      head.material.uniforms.uPulse.value = Math.sin(t * 11);
      if (sound) {
        var v = Math.hypot(hp[0] - cur.last[0], hp[1] - cur.last[1]) / Math.max(dt, 0.001) / (900 * cur.sc);
        sound.follow(Math.min(1, v), (hp[0] / W) * 2 - 1);
      }
      cur.last = hp;
      if (t >= D) { U.uFade.value = 0; head.material.uniforms.uA.value = 0; next(); }
      return true;
    }

    var last = performance.now(), idleFrames = 0;
    (function loop(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      // Im Leerlauf nicht dauernd zeichnen (spart GPU in OBS); ein paar leere Bilder zum Säubern reichen
      if (step(dt)) { idleFrames = 0; renderer.render(scene, cam); }
      else if (idleFrames < 3) { idleFrames++; renderer.render(scene, cam); }
      requestAnimationFrame(loop);
    })(last);

    return { play: play, resize: resize, ready: Promise.resolve(), busy: function () { return !!cur; },
      unlockSound: function () { if (sound) sound.unlock(); } };
  }

  root.Swirl = { create: create, PRESETS: PRESET_NAMES };
})(window);
