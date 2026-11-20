/* Car Drive – Fahreffekte: Bremsspuren auf dem Asphalt und Reifenqualm (three r128, ohne DOM-Styles).
 *
 *   var fx = CarDriveFx.create(THREE, scene, cam, { reduce })
 *   fx.drive(id, pose, slip, opts)   je Bild und Auto: pose = { x, z, yaw, len, w }, slip 0..1 (eigenes Auto: pc.slip,
 *                                    Handbremse verstärkt); opts = { surface, speed, hb }. Ab SLIP_MARK zieht jedes
 *                                    Hinterrad eine Spur (Asphalt/Randstein), ab SLIP_SMOKE qualmt es; im Kies/Gras
 *                                    Staub statt Spur.
 *   fx.watch(id, pose, dt, surface)  Fremd-/KI-Autos: Rutschen aus Fahrtrichtung gegen Blickrichtung geschätzt (günstig,
 *                                    aus den gezeichneten Lagen), dann wie drive(); → geschätztes Tempo (m/s)
 *   fx.update(dt, w, h)              Spuren verblassen lassen, Qualm bewegen (Rand-Fade zum Bildrand)
 *   fx.clear()                       alles weg (neues Rennen); fx.forget(id) Spur eines Autos abreißen
 *   fx.setGround(fn)                 Geländehöhe fn(x, z) (js/car-track-scene.js heightAt; null = flach): Spuren und
 *                                    Qualm liegen darauf
 *
 * Spuren: ein Ringpuffer aus MAX_SEG Vierecken in EINER Geometrie (Alpha je Ecke, eigener kleiner Shader mit Nebel),
 * verblassen nach MARK_LIFE s. Qualm: Sprite-Pool (höchstens MAXP, bei reduzierter Bewegung kaum), Rand-Fade wie in
 * js/car-race.js – Teilchen ploppen nie hart am Bildrand.
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
      dust: softTex([[0, 'rgba(214,196,156,0.85)'], [0.5, 'rgba(198,178,138,0.38)'], [1, 'rgba(190,170,130,0)']])
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
      },
      clear: function () {
        born.fill(-1e9); trails = {}; watched = {}; dirty = true;
        puffs.forEach(function (p) { p.s.visible = false; pool[p.s.userData.kind].push(p.s); });
        puffs = [];
      },
      count: function () { return { puffs: puffs.length, marks: Array.prototype.filter.call(born, function (b) { return now - b < MARK_LIFE; }).length }; }
    };
    return api;
  }

  root.CarDriveFx = { create: create };
})(typeof window !== 'undefined' ? window : this);
