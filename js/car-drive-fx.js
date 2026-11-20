/* Car Drive – Fahreffekte: Bremsspuren auf dem Asphalt und Reifenqualm (three r128, ohne DOM-Styles).
 *
 *   var fx = CarDriveFx.create(THREE, scene, cam, { reduce })
 *   fx.drive(id, pose, slip, opts)   je Bild und Auto: pose = { x, z, yaw, len, w }, slip 0..1 (eigenes Auto: pc.slip,
 *                                    Handbremse verstärkt); opts = { surface, speed, hb }. Ab SLIP_MARK zieht jedes
 *                                    Hinterrad eine Spur (Asphalt/Randstein), ab SLIP_SMOKE qualmt es; im Kies/Gras
 *                                    Staub statt Spur.
 *   fx.watch(id, pose, dt, surface)  Fremd-/KI-Autos: Rutschen aus Fahrtrichtung gegen Blickrichtung geschätzt (günstig,
 *                                    aus den gezeichneten Lagen), dann wie drive(); → geschätztes Tempo (m/s)
 *   fx.crash(x, z, level, nx, nz)    Auto-Crash am Kontaktpunkt: Funkenregen + Splitter (Kunststoff/Glas), level 0..1,
 *                                    (nx, nz) = Stoßnormale (Funken fliegen bevorzugt seitlich davon weg)
 *   fx.scrape(x, z, level, dt, tx, tz) Schrammen längs eines anderen Autos: Funkenstrom je Bild, level 0..1, (tx, tz) =
 *                                    Gleitrichtung
 *   fx.update(dt, w, h)              Spuren verblassen lassen, Qualm/Funken/Splitter bewegen (Rand-Fade zum Bildrand)
 *   fx.clear()                       alles weg (neues Rennen); fx.forget(id) Spur eines Autos abreißen
 *   fx.setGround(fn)                 Geländehöhe fn(x, z) (js/car-track-scene.js heightAt; null = flach): Spuren und
 *                                    Qualm liegen darauf
 *
 *
 *   var sp = CarDriveFx.speed(THREE, scene, { reduce })   Tempogefühl (Car Drive):
 *   sp.set(k, vig, dt, w, h)         Fahrtwind-Streifen am Bildrand (k 0..1, bei reduzierter Bewegung aus) und
 *                                    Tempo-Vignette (vig 0..1) – EIN Bildschirm-Viereck, ein Zeichenaufruf, nur sichtbar
 *                                    wenn k/vig > 0; Streifen blenden zum Bildrand weich aus
 *   var wb = sp.wheels(holder, wheels)  verwischte Felgen (Scheibe außen je Rad, am Rad-Pivot); wb.set(level, dt),
 *                                    wb.dispose(); unsichtbar (kein Zeichenaufruf) bei level < 0,02
 *
 * Spuren: ein Ringpuffer aus MAX_SEG Vierecken in EINER Geometrie (Alpha je Ecke, eigener kleiner Shader mit Nebel),
 * verblassen nach MARK_LIFE s. Qualm: Sprite-Pool (höchstens MAXP, bei reduzierter Bewegung kaum), Rand-Fade wie in
 * js/car-race.js – Teilchen ploppen nie hart am Bildrand. Funken/Splitter: eigener kleiner Pool (MAXS, bei reduzierter
 * Bewegung nur eine Handvoll), Schwerkraft, Splitter hüpfen am Boden aus, gleicher Rand-Fade.
 */
(function (root) {
  'use strict';
  var MAX_SEG = 900, MARK_LIFE = 14, MARK_W = 0.26, MARK_A = 0.55, SEG_MIN = 0.35, SLIP_MARK = 0.42, SLIP_SMOKE = 0.55;

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  function create(THREE, scene, cam, opts) {
    opts = opts || {};
    var reduce = !!opts.reduce;

    // ---- Spuren ----
    var pos = new Float32Array(MAX_SEG * 4 * 3), alpha = new Float32Array(MAX_SEG * 4), born = new Float32Array(MAX_SEG).fill(-1e9);
    var idx = new Uint32Array(MAX_SEG * 6);
    for (var i = 0; i < MAX_SEG; i++) {
      var v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v + 2; idx[o + 4] = v + 1; idx[o + 5] = v + 3;
    }
    var geo = new THREE.BufferGeometry();
    var posAttr = new THREE.BufferAttribute(pos, 3), aAttr = new THREE.BufferAttribute(alpha, 1);
    posAttr.setUsage(THREE.DynamicDrawUsage); aAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr); geo.setAttribute('a', aAttr); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);   // liegt überall auf der Strecke
    var mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { color: { value: new THREE.Color(0x141016) } }]),
      vertexShader: 'attribute float a; varying float vA;\n#include <fog_pars_vertex>\nvoid main() { vA = a; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
      fragmentShader: 'uniform vec3 color; varying float vA;\n#include <fog_pars_fragment>\nvoid main() { if (vA < 0.004) discard; gl_FragColor = vec4(color, vA);\n#include <fog_fragment>\n}',
      transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    var marks = new THREE.Mesh(geo, mat);
    marks.frustumCulled = false; marks.renderOrder = 1;
    scene.add(marks);
    var head = 0, now = 0, dirty = false, trails = {};
    var Y = 0.045;   // knapp über Asphalt (0,03) und Linien (0,04)
    var groundFn = null;
    function gy(x, z) { return groundFn ? groundFn(x, z) : 0; }

    function segment(a, b, strength) {
      var k = head; head = (head + 1) % MAX_SEG;
      var p = k * 12, hw = MARK_W / 2;
      var dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * hw, nz = dx / l * hw;
      // Anfang mit den Kanten des vorigen Stücks verbinden (keine Lücken in Kurven)
      var ax0 = a.ex != null ? a.ex : a.x + nx, az0 = a.ez != null ? a.ez : a.z + nz;
      var ax1 = a.fx != null ? a.fx : a.x - nx, az1 = a.fz != null ? a.fz : a.z - nz;
      pos[p] = ax0; pos[p + 1] = Y + gy(ax0, az0); pos[p + 2] = az0;
      pos[p + 3] = ax1; pos[p + 4] = Y + gy(ax1, az1); pos[p + 5] = az1;
      pos[p + 6] = b.x + nx; pos[p + 7] = Y + gy(b.x + nx, b.z + nz); pos[p + 8] = b.z + nz;
      pos[p + 9] = b.x - nx; pos[p + 10] = Y + gy(b.x - nx, b.z - nz); pos[p + 11] = b.z - nz;
      b.ex = b.x + nx; b.ez = b.z + nz; b.fx = b.x - nx; b.fz = b.z - nz;
      born[k] = now; strengthOf[k] = clamp(strength, 0.3, 1);
      dirty = true;
    }
    var strengthOf = new Float32Array(MAX_SEG);

    function wheels(pose) {
      var fx = Math.cos(pose.yaw), fz = -Math.sin(pose.yaw), lx = -Math.sin(pose.yaw), lz = -Math.cos(pose.yaw);
      var back = pose.len * 0.3, half = pose.w * 0.4;
      return [{ x: pose.x - fx * back + lx * half, z: pose.z - fz * back + lz * half },
              { x: pose.x - fx * back - lx * half, z: pose.z - fz * back - lz * half }];
    }

    // ---- Qualm ----
    function softTex(stops) {
      var c = root.document.createElement('canvas'); c.width = c.height = 64;
      var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      stops.forEach(function (st) { gr.addColorStop(st[0], st[1]); });
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }
    var TEX = {
      smoke: softTex([[0, 'rgba(236,236,240,0.85)'], [0.5, 'rgba(220,220,226,0.4)'], [1, 'rgba(210,210,216,0)']]),
      dust: softTex([[0, 'rgba(214,196,156,0.85)'], [0.5, 'rgba(198,178,138,0.38)'], [1, 'rgba(190,170,130,0)']]),
      spark: softTex([[0, 'rgba(255,255,236,1)'], [0.25, 'rgba(255,214,120,0.9)'], [0.6, 'rgba(255,140,40,0.35)'], [1, 'rgba(255,100,20,0)']]),
      shard: softTex([[0, 'rgba(70,72,80,1)'], [0.55, 'rgba(48,50,56,0.9)'], [0.75, 'rgba(40,40,46,0.3)'], [1, 'rgba(30,30,36,0)']])
    };
    var MAXP = reduce ? 10 : 140, puffs = [], pool = { smoke: [], dust: [] }, pv = new THREE.Vector3();
    function puff(kind, x, z, a, vx, vz) {
      if (puffs.length >= MAXP) return;   // voll: verwerfen statt das älteste hart zu entfernen
      var sp = pool[kind].pop();
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX[kind], transparent: true, depthWrite: false, opacity: 0 }));
        sp.userData.kind = kind; scene.add(sp);
      }
      sp.visible = true; sp.material.opacity = 0; sp.position.set(x, gy(x, z) + 0.35, z);
      var r = Math.random;
      puffs.push({ s: sp, age: 0, life: (reduce ? 0.9 : 1.1) + r() * 0.8, size0: 0.6 + r() * 0.4, grow: reduce ? 0.8 : 2.2 + r() * 1.2,
        vx: (vx || 0) * 0.25 + (r() - 0.5) * 1.1, vy: 0.5 + r() * 0.7, vz: (vz || 0) * 0.25 + (r() - 0.5) * 1.1, a: a });
    }

    // ---- Funken + Splitter (Crash/Schrammen) ----
    var MAXS = reduce ? 8 : 160, bits = [], bitPool = { spark: [], shard: [] };
    function bit(kind, x, y, z, vx, vy, vz, life, size) {
      if (bits.length >= MAXS) return;   // voll: verwerfen
      var sp = bitPool[kind].pop();
      if (!sp) {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX[kind], transparent: true, depthWrite: false, opacity: 0,
          blending: kind === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending }));
        sp.userData.kind = kind; scene.add(sp);
      }
      sp.visible = true; sp.material.opacity = 0; sp.position.set(x, y, z); sp.scale.setScalar(size);
      bits.push({ s: sp, age: 0, life: life, vx: vx, vy: vy, vz: vz, size: size, spark: kind === 'spark' });
    }
    function sparks(x, z, n, speed, dx, dz, spread) {
      var y = gy(x, z) + 0.45, r = Math.random;
      for (var i = 0; i < n; i++) {
        var a = (r() - 0.5) * spread, c = Math.cos(a), sn = Math.sin(a), v = speed * (0.4 + r() * 0.8);
        bit('spark', x + (r() - 0.5) * 0.3, y + r() * 0.3, z + (r() - 0.5) * 0.3,
          (dx * c - dz * sn) * v, 1 + r() * 3, (dx * sn + dz * c) * v, 0.25 + r() * 0.35, 0.16 + r() * 0.14);
      }
    }

    var watched = {};
    var api = {
      setGround: function (fn) { groundFn = typeof fn === 'function' ? fn : null; },
      drive: function (id, pose, slip, o) {
        o = o || {};
        var sp = o.speed || 0, surf = o.surface || 'asphalt', hard = surf === 'asphalt' || surf === 'curb';
        var on = sp > 2.5 && slip > SLIP_MARK, tr = trails[id] || (trails[id] = [null, null]);
        var ws = wheels(pose);
        for (var w = 0; w < 2; w++) {
          if (!on || !hard) { tr[w] = null; continue; }
          var pt = ws[w];
          if (!tr[w]) { tr[w] = { x: pt.x, z: pt.z }; continue; }
          var d = Math.hypot(pt.x - tr[w].x, pt.z - tr[w].z);
          if (d > 6) { tr[w] = { x: pt.x, z: pt.z }; continue; }   // Sprung (zurück auf die Strecke, Nachladen)
          if (d >= SEG_MIN) { var nb = { x: pt.x, z: pt.z }; segment(tr[w], nb, slip); tr[w] = nb; }
        }
        // Qualm (Asphalt) bzw. Staub (Kies/Gras), Rate mit Rutschen und Tempo
        var dust = !hard && sp > 3, smoke = hard && slip > SLIP_SMOKE && sp > 3;
        if (dust || smoke) {
          var rate = (dust ? 10 : 16 * (slip - SLIP_SMOKE + 0.2)) * Math.min(1, sp / 12) * (reduce ? 0.15 : 1) * (o.dt || 1 / 60);
          for (var k = 0; k < 2; k++) {
            if (Math.random() < rate) puff(dust ? 'dust' : 'smoke', ws[k].x + (Math.random() - 0.5) * 0.4, ws[k].z + (Math.random() - 0.5) * 0.4,
              dust ? 0.4 : 0.35 + 0.25 * slip, o.vx, o.vz);
          }
        }
      },
      watch: function (id, pose, dt, surface) {
        var w = watched[id], dtt = Math.max(dt, 1e-3);
        watched[id] = { x: pose.x, z: pose.z, t: now };
        if (!w || now - w.t > 0.5) return 0;
        var vx = (pose.x - w.x) / dtt, vz = (pose.z - w.z) / dtt, sp = Math.hypot(vx, vz);
        if (sp > 60) return 0;                              // Sprung
        var slip = 0;
        if (sp > 4) {
          var ang = Math.atan2(-vz, vx) - pose.yaw;
          while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
          slip = clamp((Math.abs(ang) - 0.08) / 0.35, 0, 1);
        }
        api.drive(id, pose, slip, { speed: sp, surface: surface || 'asphalt', vx: vx, vz: vz, dt: dt });
        return sp;
      },
      crash: function (x, z, level, nx, nz) {
        level = clamp(level || 0, 0, 1);
        if (level <= 0) return;
        var r = Math.random, tx = -(nz || 0), tz = nx || 1;
        // Funken nach beiden Seiten längs der Berührung + etwas weg von der Normalen
        var n = Math.round((reduce ? 3 : 26) * level) + (reduce ? 1 : 4);
        sparks(x, z, Math.ceil(n / 2), 6 + 8 * level, tx, tz, 1.6);
        sparks(x, z, Math.floor(n / 2), 6 + 8 * level, -tx, -tz, 1.6);
        if (level > 0.3) {
          var m = Math.round((reduce ? 1 : 12) * level), y = gy(x, z) + 0.5;
          for (var i = 0; i < m; i++) {
            var a = r() * Math.PI * 2, v = 2 + r() * 4 * level;
            bit('shard', x, y + r() * 0.3, z, Math.cos(a) * v + (nx || 0) * 2, 2 + r() * 3.5 * level, Math.sin(a) * v + (nz || 0) * 2,
              1.2 + r() * 1.2, 0.1 + r() * 0.12);
          }
          puff('smoke', x, z, 0.25 + 0.2 * level, 0, 0);
        }
      },
      scrape: function (x, z, level, dt, tx, tz) {
        level = clamp(level || 0, 0, 1);
        var rate = (reduce ? 3 : 45) * level * (dt || 1 / 60), n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
        if (n > 0) sparks(x, z, n, 3 + 6 * level, -(tx || 0), -(tz || 0), 0.9);
      },
      forget: function (id) { delete trails[id]; delete watched[id]; },
      update: function (dt, W, H) {
        now += dt;
        // Spuren: Alpha nach Alter (nur wenn etwas lebt)
        var any = false;
        for (var s = 0; s < MAX_SEG; s++) {
          var age = now - born[s], a = age < MARK_LIFE ? MARK_A * strengthOf[s] * (1 - age / MARK_LIFE) : 0, q = s * 4;
          if (a > 0) any = true;
          if (alpha[q] !== a) { alpha[q] = alpha[q + 1] = alpha[q + 2] = alpha[q + 3] = a; dirty = true; }
        }
        marks.visible = any;
        if (dirty) { posAttr.needsUpdate = true; aAttr.needsUpdate = true; dirty = false; }
        for (var i = puffs.length - 1; i >= 0; i--) {
          var p = puffs[i]; p.age += dt;
          if (p.age >= p.life) { p.s.visible = false; pool[p.s.userData.kind].push(p.s); puffs.splice(i, 1); continue; }
          var k = p.age / p.life;
          p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
          p.vx *= 1 - dt * 1.5; p.vz *= 1 - dt * 1.5; p.vy *= 1 - dt * 0.8;
          p.s.scale.setScalar(p.size0 + p.grow * k);
          // Rand-Fade: Abstand zum Bildrand (Pixel); hinter der Kamera unsichtbar
          pv.copy(p.s.position).project(cam);
          var px = (pv.x * 0.5 + 0.5) * W, py = (1 - (pv.y * 0.5 + 0.5)) * H, edge = Math.min(px, W - px, py, H - py);
          var ef = pv.z > 1 ? 0 : clamp(edge / (Math.min(W, H) * 0.12), 0, 1);
          p.s.material.opacity = p.a * Math.min(1, p.age / 0.15) * (1 - k) * ef;
        }
        for (var j = bits.length - 1; j >= 0; j--) {
          var b = bits[j]; b.age += dt;
          if (b.age >= b.life) { b.s.visible = false; bitPool[b.s.userData.kind].push(b.s); bits.splice(j, 1); continue; }
          var bp = b.s.position;
          b.vy -= (b.spark ? 9 : 14) * dt;
          bp.x += b.vx * dt; bp.y += b.vy * dt; bp.z += b.vz * dt;
          var floor = gy(bp.x, bp.z) + 0.06;
          if (bp.y < floor) { bp.y = floor; b.vy = Math.abs(b.vy) * (b.spark ? 0.25 : 0.35); b.vx *= 0.6; b.vz *= 0.6; }
          if (b.spark) { b.vx *= 1 - dt * 2; b.vz *= 1 - dt * 2; }
          var kb = b.age / b.life;
          if (b.spark) b.s.scale.setScalar(b.size * (1 - 0.6 * kb));
          pv.copy(bp).project(cam);
          var bx = (pv.x * 0.5 + 0.5) * W, by = (1 - (pv.y * 0.5 + 0.5)) * H, be = Math.min(bx, W - bx, by, H - by);
          var bf = pv.z > 1 ? 0 : clamp(be / (Math.min(W, H) * 0.12), 0, 1);
          b.s.material.opacity = (b.spark ? 1 - kb * kb : Math.min(1, (1 - kb) * 3)) * bf;
        }
      },
      clear: function () {
        born.fill(-1e9); trails = {}; watched = {}; dirty = true;
        puffs.forEach(function (p) { p.s.visible = false; pool[p.s.userData.kind].push(p.s); });
        puffs = [];
        bits.forEach(function (b) { b.s.visible = false; bitPool[b.s.userData.kind].push(b.s); });
        bits = [];
      },
      count: function () { return { puffs: puffs.length, bits: bits.length, marks: Array.prototype.filter.call(born, function (b) { return now - b < MARK_LIFE; }).length }; }
    };
    return api;
  }

  // ---- Tempogefühl: Fahrtwind-Streifen + Tempo-Vignette (Bildschirm) und verwischte Felgen ----
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  var SPEED_VS = 'varying vec2 vP;\nvoid main() { vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  // Streifen: Strahlen aus der Bildmitte, je Winkel-Spur zufällig an/aus, Striche laufen nach außen; Breite in
  // Pixeln (nicht im Winkel), nur im äußeren Ring, weich zum Bildrand ausgeblendet. Vignette: dunkler Rand.
  var SPEED_FS = [
    'uniform float uK; uniform float uVig; uniform float uT; uniform vec2 uRes;',
    'varying vec2 vP;',
    'float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }',
    'void main() {',
    '  vec2 px = vP * 0.5 * uRes; float rp = length(px), rmax = length(0.5 * uRes), r = rp / rmax;',
    '  float s = 0.0;',
    '  if (uK > 0.0 && r > 0.38) {',
    '    float N = 140.0, a = (atan(px.y, px.x) / 6.2831853 + 0.5) * N, cell = floor(a), h = h1(cell), h2 = h1(cell + 71.3);',
    '    float dpx = abs(fract(a) - 0.5) * 6.2831853 / N * rp;',
    '    float thin = smoothstep(1.4 + 1.6 * r, 0.3, dpx);',
    '    float ph = fract(r * (1.3 + h2) - uT * (1.1 + 1.6 * h2) + h);',
    '    float seg = smoothstep(0.0, 0.05, ph) * smoothstep(0.38, 0.1, ph);',
    '    vec2 e = 0.5 * uRes - abs(px); float edge = clamp(min(e.x, e.y) / (0.06 * uRes.y), 0.0, 1.0);',
    '    s = thin * seg * step(1.0 - 0.45 * uK, h) * smoothstep(0.38, 0.85, r) * edge * uK * 0.42;',
    '  }',
    '  float v = smoothstep(0.5, 1.08, r) * uVig;',
    '  float al = max(s, v);',
    '  if (al < 0.003) discard;',
    '  gl_FragColor = vec4(vec3(0.94, 0.96, 1.0) * (s / al), al);',
    '}'].join('\n');
  function makeRimTex() {
    var c = root.document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    // Nabe dunkel, Speichenbereich als verwischter Metallschleier, Felgenhorn hell, außen weich (Reifen bleibt scharf)
    gr.addColorStop(0, 'rgba(40,42,46,0.95)'); gr.addColorStop(0.16, 'rgba(70,72,78,0.92)');
    gr.addColorStop(0.24, 'rgba(150,154,162,0.72)'); gr.addColorStop(0.7, 'rgba(176,180,188,0.66)');
    gr.addColorStop(0.86, 'rgba(206,210,216,0.8)'); gr.addColorStop(0.93, 'rgba(120,122,128,0.55)'); gr.addColorStop(1, 'rgba(60,60,64,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    // leichte Wischbögen, damit die Drehung lesbar bleibt
    g.lineCap = 'round';
    for (var i = 0; i < 9; i++) {
      var r0 = 20 + i * 4.6, a0 = i * 2.1;
      g.strokeStyle = 'rgba(235,238,244,' + (0.12 + (i % 3) * 0.05) + ')'; g.lineWidth = 2;
      g.beginPath(); g.arc(64, 64, r0, a0, a0 + 1.6); g.stroke();
    }
    return c;
  }
  function speed(THREE, scene, opts) {
    opts = opts || {};
    var reduce = !!opts.reduce;
    var U = { uK: { value: 0 }, uVig: { value: 0 }, uT: { value: 0 }, uRes: { value: new THREE.Vector2(1920, 1080) } };
    var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: U, vertexShader: SPEED_VS, fragmentShader: SPEED_FS, transparent: true, depthTest: false, depthWrite: false
    }));
    quad.frustumCulled = false; quad.renderOrder = 999; quad.visible = false;
    scene.add(quad);
    var rimTex = null, discGeo = null;
    return {
      // k = Streifen 0..1 (bei reduzierter Bewegung immer aus), vig = Vignette 0..1, W/H = Bildgröße in Pixeln
      set: function (k, vig, dt, W, H) {
        k = reduce ? 0 : clamp(k || 0, 0, 1); vig = clamp(vig || 0, 0, 1);
        U.uK.value = k; U.uVig.value = vig; U.uT.value = (U.uT.value + (dt || 0)) % 1000;
        U.uRes.value.set(W || 1920, H || 1080);
        quad.visible = k > 0.005 || vig > 0.005;
      },
      // verwischte Felgen je Auto: Scheibe außen auf jedem Rad (am Rad-Pivot, lenkt mit); holder steht beim Aufruf
      // noch im Ursprung (wie nach collectWheels). → { set(level 0..1, dt), dispose() } oder null
      wheels: function (holder, wheels) {
        if (!wheels || !wheels.length) return null;
        if (!rimTex) { rimTex = new THREE.CanvasTexture(makeRimTex()); discGeo = new THREE.CircleGeometry(1, 28); }
        var mat = new THREE.MeshBasicMaterial({ map: rimTex, color: 0xb8bcc4, transparent: true, depthWrite: false, opacity: 0,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        holder.updateMatrixWorld(true);
        var discs = [], box = new THREE.Box3(), c = new THREE.Vector3(), sz = new THREE.Vector3();
        wheels.forEach(function (w) {
          box.setFromObject(w.pivot); if (box.isEmpty()) return;
          box.getCenter(c); box.getSize(sz);
          var R = Math.max(sz.x, sz.y) / 2, side = c.z >= 0 ? 1 : -1;
          var d = new THREE.Mesh(discGeo, mat);
          d.scale.setScalar(R * 0.74);
          d.position.set(c.x, c.y, c.z + side * (sz.z / 2 + 0.006));
          if (side < 0) d.rotation.y = Math.PI;
          d.visible = false; d.renderOrder = 2;
          holder.add(d); d.updateMatrixWorld(true); w.pivot.attach(d);
          discs.push(d);
        });
        if (!discs.length) { mat.dispose(); return null; }
        var shown = 0;
        return {
          set: function (level, dt) {
            level = clamp(level || 0, 0, 1);
            if (level < 0.02 && shown < 0.02) return;
            shown = level;
            mat.opacity = level * 0.88;
            for (var i = 0; i < discs.length; i++) {
              discs[i].visible = level >= 0.02;
              if (!reduce) discs[i].rotateZ(-(dt || 0) * (14 + 10 * level) * (i % 2 ? 1.07 : 1));
            }
          },
          dispose: function () { discs.forEach(function (d) { if (d.parent) d.parent.remove(d); }); mat.dispose(); }
        };
      },
      dispose: function () { scene.remove(quad); quad.geometry.dispose(); quad.material.dispose(); }
    };
  }

  root.CarDriveFx = { create: create, speed: speed, smooth: smooth };
})(typeof window !== 'undefined' ? window : this);
