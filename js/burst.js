/* Burst – WebGL-Explosionen für OBS (effects/burst.html).
 *
 * Eine Explosion besteht aus Schichten: Lichtblitz, Kern-Animation (fertige Flipbooks aus
 * assets/effects/flipbooks/, Unity Labs und Pixel-Packs, alle CC0), Druckwelle, Funken und Trümmer
 * mit Schwerkraft (prallen am unteren Rand ab, blenden zum Bildrand weich aus), Glut und Rauch.
 * Dazu optional ein Name, der mit der Druckwelle fliegt, und ein im Browser erzeugter Knall (WebAudio).
 * Gezeichnet wird mit vormultipliertem Alpha, damit es auf dem durchsichtigen OBS-Grund leuchtet.
 *
 *   var b = Burst.create({ canvas, base, sound, volume, flash, ring, sparks, smoke, accent });
 *   b.ready.then(function () { b.fire({ kind: 'explosion', at: 'center', size: 1, count: 1, name: 'Hat3' }); });
 *
 * Arten: explosion (Explosion B/C + Rauch), fireball (Fireball 3), comic (Kabooms), pixel (Pixel explosion).
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  var KINDS = {
    explosion: { books: ['unity-explosion01', 'unity-explosion02'], smoke: 'unity-wispysmoke01', sparks: 90, embers: 14, flash: 1.3, ring: 1 },
    fireball: { books: ['unity-fireball03'], smoke: null, sparks: 60, embers: 10, flash: 1.1, ring: 0.8 },
    comic: { books: ['pixel-kabooms'], smoke: null, sparks: 30, embers: 0, flash: 0.7, ring: 0.9 },
    pixel: { books: ['pixel-explosion'], smoke: null, sparks: 40, embers: 0, flash: 0.8, ring: 0.7, square: true }
  };
  var KIND_NAMES = Object.keys(KINDS);
  var MAX_LIVE = 14;   // gleichzeitige Explosionen; ältere werden ausgeblendet

  var VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
  // Weicher Bildrand: alles blendet in den letzten 4 % zur Kante aus (nie hartes Abschneiden)
  var EDGE = 'uniform vec2 res; float edgeFade(){ vec2 p = gl_FragCoord.xy / res; vec2 e = smoothstep(0.0, 0.04, p) * smoothstep(0.0, 0.04, 1.0 - p); return e.x * e.y; }';
  var FLIP_FS = [
    'uniform sampler2D map; uniform float cols, rows, frame, frames, fade, blendFrames, glow;', EDGE, 'varying vec2 vUv;',
    'vec4 cell(float f){ f = clamp(f, 0.0, frames - 1.0); float c = mod(f, cols), r = floor(f / cols);',
    '  return texture2D(map, vec2((c + vUv.x) / cols, 1.0 - (r + 1.0 - vUv.y) / rows)); }',
    'void main(){ float f0 = floor(frame); vec4 a = cell(f0), b = cell(f0 + 1.0); vec4 c = blendFrames > 0.5 ? mix(a, b, fract(frame)) : a;',
    '  float k = fade * edgeFade();',
    '  if (glow > 0.5) { gl_FragColor = vec4(c.rgb * k, max(c.r, max(c.g, c.b)) * k); return; }',
    '  float al = c.a * k; if (al < 0.004) discard; gl_FragColor = vec4(c.rgb * al, al); }'
  ].join('\n');
  var FLASH_FS = 'uniform float a; uniform vec3 col;' + EDGE + 'varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float g = pow(max(0.0, 1.0 - d), 2.2) * a * edgeFade(); gl_FragColor = vec4(col * g, g); }';
  var RING_FS = 'uniform float a, w;' + EDGE + 'varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float g = smoothstep(1.0 - w, 1.0 - w * 0.5, d) * (1.0 - smoothstep(1.0 - w * 0.5, 1.0, d)) * a * edgeFade(); gl_FragColor = vec4(vec3(1.0, 0.9, 0.75) * g, g); }';
  var DOT_VS = 'attribute float life; attribute float sz; attribute float hot; varying float vL; varying float vH; void main(){ vL = life; vH = hot; gl_PointSize = sz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var DOT_FS = 'uniform vec3 accent; uniform float square;' + EDGE + 'varying float vL; varying float vH; void main(){ vec2 q = gl_PointCoord - 0.5; float d = square > 0.5 ? max(abs(q.x), abs(q.y)) * 2.0 : length(q) * 2.0; float g = square > 0.5 ? step(d, 0.9) : max(0.0, 1.0 - d);' +
    ' vec3 c = mix(mix(vec3(1.0, 0.35, 0.05), accent, 0.35), vec3(1.0, 0.93, 0.65), vL * vH); float al = g * vL * edgeFade(); gl_FragColor = vec4(c * al, al); }';
  var TEXT_FS = 'uniform sampler2D map; uniform float a;' + EDGE + 'varying vec2 vUv; void main(){ vec4 c = texture2D(map, vUv); float al = c.a * a * edgeFade(); gl_FragColor = vec4(c.rgb * al, al); }';

  function blendPremul(extra) {
    var o = { transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };
    for (var k in extra) o[k] = extra[k];
    return o;
  }
  function blendAdd(extra) { var o = blendPremul(extra); o.blendDst = THREE.OneFactor; return o; }

  // ── Ton: Knall aus Rauschen und Tiefton, je Art etwas anders ──
  function Sound(volume) {
    var Ctx = root.AudioContext || root.webkitAudioContext, ctx = null, noise = null, crush = null;
    function ensure() {
      if (!Ctx) return null;
      if (!ctx) {
        ctx = new Ctx();
        var n = ctx.sampleRate * 2.5; noise = ctx.createBuffer(1, n, ctx.sampleRate); crush = ctx.createBuffer(1, n, ctx.sampleRate);
        var d = noise.getChannelData(0), c = crush.getChannelData(0), hold = 0;
        for (var i = 0; i < n; i++) { d[i] = Math.random() * 2 - 1; if (i % 24 === 0) hold = Math.random() < 0.5 ? -1 : 1; c[i] = hold; }
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function boom(kind, size, delay) {
      var a = ensure(); if (!a || volume <= 0) return;
      var t = a.currentTime + (delay || 0), loud = Math.min(1, 0.45 + size * 0.35) * volume, len = 0.9 + size * 0.9;
      var out = a.createGain(); out.gain.value = loud; out.connect(a.destination);
      var src = a.createBufferSource(); src.buffer = kind === 'pixel' ? crush : noise;
      var lp = a.createBiquadFilter(); lp.type = 'lowpass';
      var g = a.createGain(); src.connect(lp); lp.connect(g); g.connect(out);
      var top = kind === 'fireball' ? 1800 : kind === 'pixel' ? 2600 : 4200;
      lp.frequency.setValueAtTime(top, t); lp.frequency.exponentialRampToValueAtTime(kind === 'fireball' ? 260 : 120, t + len);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === 'fireball' ? 0.7 : 1, t + (kind === 'fireball' ? 0.08 : 0.012));
      g.gain.exponentialRampToValueAtTime(0.0001, t + len * (kind === 'pixel' || kind === 'comic' ? 0.55 : 1));
      src.start(t); src.stop(t + len + 0.1);
      if (kind !== 'pixel') {   // Tiefton (der „Wumms“)
        var o = a.createOscillator(), og = a.createGain(); o.type = 'sine';
        o.frequency.setValueAtTime(kind === 'comic' ? 140 : 75, t); o.frequency.exponentialRampToValueAtTime(kind === 'comic' ? 45 : 28, t + 0.7);
        og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.9, t + 0.015); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        o.connect(og); og.connect(out); o.start(t); o.stop(t + 1);
      }
      if (kind === 'explosion') {   // nachrieselnde Trümmer
        for (var i = 0; i < 6; i++) {
          var tt = t + 0.25 + Math.random() * len * 0.8, s2 = a.createBufferSource(), bp = a.createBiquadFilter(), g2 = a.createGain();
          s2.buffer = noise; bp.type = 'bandpass'; bp.frequency.value = 1500 + Math.random() * 2500; bp.Q.value = 4;
          g2.gain.setValueAtTime(0.0001, tt); g2.gain.exponentialRampToValueAtTime(0.25, tt + 0.004); g2.gain.exponentialRampToValueAtTime(0.0001, tt + 0.06);
          s2.connect(bp); bp.connect(g2); g2.connect(out); s2.start(tt, Math.random()); s2.stop(tt + 0.08);
        }
      }
    }
    return { boom: boom, unlock: ensure };
  }

  function create(opt) {
    var canvas = opt.canvas, base = opt.base || '';
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    var scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
    var W = 1, H = 1, res = new THREE.Vector2(1, 1);
    var accent = new THREE.Color(opt.accent || '#f2b705');
    var tex = {}, man = {}, live = [], quad = new THREE.PlaneGeometry(1, 1);
    var sound = opt.sound === false ? null : Sound(opt.volume == null ? 0.7 : opt.volume);
    var on = function (k) { return opt[k] !== false; };

    function resize() {
      W = canvas.clientWidth || root.innerWidth; H = canvas.clientHeight || root.innerHeight;
      renderer.setSize(W, H, false); cam.right = W; cam.bottom = H; cam.updateProjectionMatrix();
      res.set(W * renderer.getPixelRatio(), H * renderer.getPixelRatio());
    }
    root.addEventListener('resize', resize); resize();

    var ready = fetch(base + 'assets/effects/flipbooks/manifest.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (list) {
      var need = {};
      KIND_NAMES.forEach(function (k) { KINDS[k].books.concat(KINDS[k].smoke ? [KINDS[k].smoke] : []).forEach(function (id) { need[id] = 1; }); });
      var loader = new THREE.TextureLoader();
      return Promise.all(list.filter(function (e) { return need[e.id]; }).map(function (e) {
        man[e.id] = e;
        return new Promise(function (res2) {
          loader.load(base + 'assets/effects/flipbooks/' + e.src, function (t) {
            t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
            t.minFilter = t.magFilter = e.pixel ? THREE.NearestFilter : THREE.LinearFilter;
            tex[e.id] = t; res2();
          }, null, function () { res2(); });
        });
      }));
    });

    function flip(id, w, h, x, y, z) {
      var e = man[id];
      var m = new THREE.Mesh(quad, new THREE.ShaderMaterial(blendPremul({ vertexShader: VS, fragmentShader: FLIP_FS, uniforms: {
        map: { value: tex[id] }, cols: { value: e.cols }, rows: { value: e.rows }, frame: { value: 0 }, frames: { value: e.frames },
        fade: { value: 1 }, blendFrames: { value: e.pixel ? 0 : 1 }, glow: { value: e.blend === 'add' ? 1 : 0 }, res: { value: res } } })));
      m.scale.set(w, -h, 1); m.position.set(x, y, z); scene.add(m); return m;
    }
    function aspect(id) { var im = tex[id].image, e = man[id]; return (im.width / e.cols) / (im.height / e.rows); }
    function glowMesh(fs, uni) {
      uni.res = { value: res };
      return new THREE.Mesh(quad, new THREE.ShaderMaterial(blendAdd({ vertexShader: VS, fragmentShader: fs, uniforms: uni })));
    }
    function dots(x, y, n, size, speed, ember, square) {
      var g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), life = new Float32Array(n), sz = new Float32Array(n), hot = new Float32Array(n), vel = [];
      var pr = renderer.getPixelRatio();
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, v = ember ? size * (0.05 + Math.random() * 0.25) : size * (0.8 + Math.random() * 2.4);
        vel.push([Math.cos(a) * v, Math.sin(a) * v - (ember ? size * 0.35 : size * 0.7)]);
        pos[i * 3] = x + (ember ? (Math.random() - 0.5) * size * 0.5 : 0); pos[i * 3 + 1] = y + (ember ? (Math.random() - 0.5) * size * 0.3 : 0);
        life[i] = 1; hot[i] = 0.5 + Math.random() * 0.5; sz[i] = (ember ? 3 + Math.random() * 4 : 2 + Math.random() * 5) * pr * Math.max(0.6, Math.min(1.6, size / 400));
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('life', new THREE.BufferAttribute(life, 1));
      g.setAttribute('sz', new THREE.BufferAttribute(sz, 1)); g.setAttribute('hot', new THREE.BufferAttribute(hot, 1));
      var p = new THREE.Points(g, new THREE.ShaderMaterial(blendAdd({ vertexShader: DOT_VS, fragmentShader: DOT_FS,
        uniforms: { accent: { value: accent }, square: { value: square ? 1 : 0 }, res: { value: res } } })));
      p.position.z = 1; scene.add(p);
      return { kind: ember ? 'embers' : 'sparks', mesh: p, vel: vel, t: 0, dur: (ember ? 2.4 : 1.1) / speed, size: size };
    }
    function label(text, x, y, size) {
      var c = document.createElement('canvas'), g = c.getContext('2d'), fs = 96;
      g.font = '700 ' + fs + "px 'DM Sans', system-ui, sans-serif";
      c.width = Math.ceil(g.measureText(text).width + fs * 0.8); c.height = Math.ceil(fs * 1.5);
      g.font = '700 ' + fs + "px 'DM Sans', system-ui, sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = fs * 0.14; g.strokeStyle = 'rgba(20,10,30,0.9)'; g.strokeText(text, c.width / 2, c.height / 2);
      g.fillStyle = '#' + accent.getHexString(); g.fillText(text, c.width / 2, c.height / 2);
      var t = new THREE.CanvasTexture(c), h = Math.max(54, size * 0.32), w = h * c.width / c.height;
      var m = new THREE.Mesh(quad, new THREE.ShaderMaterial(blendPremul({ vertexShader: VS, fragmentShader: TEXT_FS, uniforms: { map: { value: t }, a: { value: 0 }, res: { value: res } } })));
      m.scale.set(w, -h, 1); m.position.set(x, y, 1.2); scene.add(m);
      return { kind: 'label', mesh: m, tex: t, t: 0, dur: 2.6, y0: y, w: w, h: h, size: size };
    }

    function spot(at, i) {
      var m = 0.16, r = function (lo, hi) { return lo + Math.random() * (hi - lo); };
      var P = { center: [0.5, 0.5], left: [0.2, 0.5], right: [0.8, 0.5], top: [0.5, 0.25], bottom: [0.5, 0.75],
        topleft: [0.2, 0.25], topright: [0.8, 0.25], bottomleft: [0.2, 0.75], bottomright: [0.8, 0.75] };
      var p;
      if (!at || at === 'random') p = [r(m, 1 - m), r(m, 1 - m)];
      else if (P[at]) p = P[at];
      else { var xy = String(at).split(','); p = [Math.max(0, Math.min(1, +xy[0] || 0.5)), Math.max(0, Math.min(1, +xy[1] || 0.5))]; }
      if (i > 0 && at !== 'random' && at) p = [p[0] + (Math.random() - 0.5) * 0.18, p[1] + (Math.random() - 0.5) * 0.18];   // Salve: um den Punkt streuen
      return [p[0] * W, p[1] * H];
    }

    function one(kind, at, size, name, i, speed) {
      var K = KINDS[kind], id = K.books[Math.floor(Math.random() * K.books.length)];
      if (!tex[id]) return;
      var pos = spot(at, i), x = pos[0], y = pos[1], h = H * 0.75 * size * (i > 0 ? 0.7 + Math.random() * 0.4 : 1), w = h * aspect(id);   // Flipbooks haben viel leeren Rand: sichtbar ~40 %
      var e = man[id], core = flip(id, w, h, x, y, 0.5);
      live.push({ kind: 'flip', mesh: core, e: e, t: 0, dur: e.frames / e.fps / speed });
      if (on('flash') && K.flash) {
        var f = glowMesh(FLASH_FS, { a: { value: 1 }, col: { value: new THREE.Color(1, 0.82, 0.55) } }); f.position.set(x, y, 0.9); scene.add(f);
        live.push({ kind: 'flash', mesh: f, t: 0, dur: 0.35 / speed, s: h * 1.1 * K.flash });
      }
      if (on('ring') && K.ring) {
        var rg = glowMesh(RING_FS, { a: { value: 1 }, w: { value: 0.16 } }); rg.position.set(x, y, 0.8); scene.add(rg);
        live.push({ kind: 'ring', mesh: rg, t: 0, dur: 0.6 / speed, s: h * 1.25 * K.ring });
      }
      if (on('sparks') && K.sparks) live.push(dots(x, y, K.sparks, h * 0.6, speed, false, K.square));
      if (on('sparks') && K.embers) live.push(dots(x, y, K.embers, h * 0.6, speed, true, false));
      if (on('smoke') && K.smoke && tex[K.smoke]) {
        var sid = K.smoke;
        setTimeout(function () {
          var sm = flip(sid, h * 0.9 * aspect(sid), h * 0.9, x, y - h * 0.18, 0.3);
          live.push({ kind: 'smoke', mesh: sm, e: man[sid], t: 0, dur: man[sid].frames / man[sid].fps / speed * 1.6 });
        }, 250 / speed);
      }
      if (name && i === 0) live.push(label(name, x, y, h * 0.55));
      if (sound) sound.boom(kind, size * (i > 0 ? 0.7 : 1), 0);
      while (live.filter(function (o) { return o.kind === 'flip'; }).length > MAX_LIVE) {
        var old = live.find(function (o) { return o.kind === 'flip' && !o.dying; }); if (!old) break; old.dying = true; old.t = Math.max(old.t, old.dur * 0.85);
      }
    }

    function fire(c) {
      c = c || {};
      var kind = KINDS[c.kind] ? c.kind : (c.kind === 'random' ? KIND_NAMES[Math.floor(Math.random() * KIND_NAMES.length)] : (KINDS[opt.kind] ? opt.kind : 'explosion'));
      var size = +c.size || opt.size || 1, n = Math.max(1, Math.min(12, +c.count || 1)), speed = opt.speed || 1;
      for (var i = 0; i < n; i++) (function (i) { setTimeout(function () { one(kind, c.at || opt.at, size, c.name, i, speed); }, i * 180); })(i);
    }

    function dispose(o) {
      scene.remove(o.mesh); o.mesh.material.dispose();
      if (o.kind === 'sparks' || o.kind === 'embers') o.mesh.geometry.dispose();
      if (o.tex) o.tex.dispose();
    }
    function step(dt) {
      for (var i = live.length - 1; i >= 0; i--) {
        var o = live[i]; o.t += dt; var k = Math.min(1, o.t / o.dur), u = o.mesh.material.uniforms;
        if (o.kind === 'flip' || o.kind === 'smoke') {
          u.frame.value = Math.min(o.e.frames - 1.001, k * o.e.frames);
          u.fade.value = o.kind === 'smoke' ? Math.min(1, k * 4) * (1 - Math.max(0, (k - 0.5) / 0.5)) * 0.8 : (k > 0.85 ? (1 - k) / 0.15 : 1);
        } else if (o.kind === 'flash') {
          var s = o.s * (0.6 + k * 0.6); o.mesh.scale.set(s, s, 1); u.a.value = Math.pow(1 - k, 2) * 1.4;
        } else if (o.kind === 'ring') {
          var rs = o.s * (0.15 + Math.sqrt(k)); o.mesh.scale.set(rs, rs, 1); u.a.value = Math.pow(1 - k, 1.5) * 0.55; u.w.value = 0.16 - k * 0.1;
        } else if (o.kind === 'sparks' || o.kind === 'embers') {
          var pa = o.mesh.geometry.attributes.position, la = o.mesh.geometry.attributes.life, em = o.kind === 'embers';
          for (var j = 0; j < o.vel.length; j++) {
            var v = o.vel[j];
            if (em) { v[1] -= o.size * 0.05 * dt; v[0] += (Math.random() - 0.5) * o.size * 0.3 * dt; }
            else { v[1] += o.size * 2.6 * dt; v[0] *= 1 - 1.2 * dt; v[1] *= 1 - 0.8 * dt; }
            pa.array[j * 3] += v[0] * dt; pa.array[j * 3 + 1] += v[1] * dt;
            if (!em && pa.array[j * 3 + 1] > H - 3 && v[1] > 0) { pa.array[j * 3 + 1] = H - 3; v[1] *= -0.35; v[0] *= 0.7; }   // Aufprall unten
            la.array[j] = Math.max(0, 1 - k * (0.7 + (j % 5) * 0.08)) * (em ? Math.min(1, o.t * 3) : 1);
          }
          pa.needsUpdate = true; la.needsUpdate = true;
        } else if (o.kind === 'label') {
          var up = Math.min(1, o.t / 0.5); o.mesh.position.y = o.y0 - o.size * 0.35 * (1 - Math.pow(1 - up, 3)) - o.t * 12;
          var sc = 0.6 + 0.4 * Math.min(1, o.t / 0.25); o.mesh.scale.set(o.w * sc, -o.h * sc, 1);
          u.a.value = Math.min(1, o.t * 6) * (k > 0.7 ? (1 - k) / 0.3 : 1);
        }
        if (k >= 1) { dispose(o); live.splice(i, 1); }
      }
    }
    var last = performance.now();
    (function loop(now) { var dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt); renderer.render(scene, cam); requestAnimationFrame(loop); })(last);

    return { fire: fire, ready: ready, resize: resize, unlockSound: function () { if (sound) sound.unlock(); } };
  }

  root.Burst = { create: create, KINDS: KIND_NAMES };
})(window);
