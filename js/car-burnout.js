/* Burnout: ein echtes Auto (js/toy-cars.js, Lack/Felgen aus dem Car editor) fährt ins Bild, dreht einen
 * 360°-Donut mit Reifenqualm und Gummispuren, heult auf, macht einen Burnout und schießt aus dem Bild.
 * three r128; Bühne aus js/car-stage.js; Räder drehen und lenken über die Gruppen „Wheel …“/„Spin“ (js/glb-fix.js).
 *
 *   CarBurnout.start({ canvas, model, reduceMotion, onDone })
 *
 * Ablauf (s): 0–2,4 rein · 2,4–6,2 Donut · 6,2–7,4 aufheulen · 7,4–9,2 Burnout · 9,2–11 raus · bis 14 ausblenden
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  function smoothstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function start(opts) {
    var canvas = opts.canvas, W = 1920, H = 1080, reduce = !!opts.reduceMotion;
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, premultipliedAlpha: true });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.setClearColor(0x000000, 0);
    var scene = new THREE.Scene();
    if (root.CarStage) CarStage.setup(renderer, scene, { exposure: 1.1 });
    var cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
    cam.position.set(0, 5.2, 18); cam.lookAt(0, 2.3, 0);

    // Boden (unsichtbar) mit Gummispuren als Canvas-Textur; Schatten unter dem Auto
    var GX = 44, GZ = 16, gc = document.createElement('canvas'); gc.width = 2048; gc.height = 745;
    var gx = gc.getContext('2d'), gtex = new THREE.CanvasTexture(gc);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(GX, GZ), new THREE.MeshBasicMaterial({ map: gtex, transparent: true, depthWrite: false }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0.01; scene.add(ground);
    function toCanvas(p) { return [(p.x / GX + 0.5) * gc.width, (p.z / GZ + 0.5) * gc.height]; }
    var shadowTex = (function () {
      var c = document.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 4, 64, 64, 64);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; scene.add(shadow);

    // Rauch: weiche Sprites, wachsen, steigen, verblassen (am Bildrand ausgeblendet, nichts poppt)
    var smokeTex = (function () {
      var c = document.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 6, 64, 64, 64);
      gr.addColorStop(0, 'rgba(235,235,235,0.9)'); gr.addColorStop(0.5, 'rgba(215,215,215,0.45)'); gr.addColorStop(1, 'rgba(200,200,200,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
    })();
    var flameTex = (function () {
      var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,250,210,1)'); gr.addColorStop(0.4, 'rgba(255,150,40,0.9)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
    })();
    var puffs = [], MAXP = reduce ? 60 : 220, tmpV = new THREE.Vector3();
    function puff(p, o) {
      if (puffs.length >= MAXP) { var old = puffs.shift(); scene.remove(old.s); }
      var flame = o && o.flame;
      var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flame ? flameTex : smokeTex, transparent: true, depthWrite: false, blending: flame ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: 0 }));
      s.position.copy(p); scene.add(s);
      puffs.push({ s: s, age: 0, life: (o && o.life) || rand(1.6, 2.8), size0: (o && o.size) || rand(0.5, 0.9), grow: (o && o.grow) || rand(2.2, 3.6),
        vel: new THREE.Vector3(rand(-0.4, 0.4), rand(0.5, 1.1), rand(-0.3, 0.6)).add((o && o.push) || new THREE.Vector3()), a: (o && o.a) || 0.55 });
    }
    function stepPuffs(dt) {
      for (var i = puffs.length - 1; i >= 0; i--) {
        var q = puffs[i]; q.age += dt;
        if (q.age >= q.life) { scene.remove(q.s); q.s.material.dispose(); puffs.splice(i, 1); continue; }
        var k = q.age / q.life;
        q.s.position.addScaledVector(q.vel, dt); q.vel.multiplyScalar(1 - dt * 0.6); q.vel.y += dt * 0.15;
        q.s.scale.setScalar(q.size0 + q.grow * k);
        // Rand-Fade: Abstand zum Bildrand in Pixeln
        tmpV.copy(q.s.position).project(cam);
        var px = (tmpV.x * 0.5 + 0.5) * W, py = (1 - (tmpV.y * 0.5 + 0.5)) * H, edge = Math.min(px, W - px, py, H - py);
        var ef = Math.max(0, Math.min(1, edge / 160));
        q.s.material.opacity = q.a * Math.min(1, q.age / 0.15) * (1 - k) * ef;
      }
    }

    var car = null, dims = null, wheels = [], skidPrev = {}, t0 = null, last = null, done = false;
    var R = 0.36;   // Radradius in Einheiten (Spielzeugmaßstab ~ 4,4 Einheiten je 4,5 m)

    // Auto aufbauen; Räder einsammeln (vorn/hinten nach Lage im Auto)
    function setup(key) {
      var p = ToyCars.pickPaint(key);
      car = ToyCars.build(key, p.c, p); dims = ToyCars.dims(key);
      scene.add(car); car.updateMatrixWorld(true);
      car.traverse(function (o) {
        if (!/^Wheel /.test(o.name || '')) return;
        var w = new THREE.Vector3(); o.getWorldPosition(w);
        var spin = o.children.filter(function (c) { return c.name === 'Spin'; })[0];
        // Drehrichtung: Achse der Drehgruppe in Weltrichtung; vorwärts rollen = Drehung um −z der Welt
        var sgn = 1;
        if (spin) {
          var q = new THREE.Quaternion(); spin.getWorldQuaternion(q);
          var axw = new THREE.Vector3(spin.userData.ax === 'z' ? 0 : 1, 0, spin.userData.ax === 'z' ? 1 : 0).applyQuaternion(q);
          sgn = axw.z >= 0 ? 1 : -1;
        }
        wheels.push({ pivot: o, spin: spin, x: w.x, side: w.z > 0 ? 1 : -1, sgn: sgn });
      });
      // vorn = vorderste Achse (Truck/Bus: mehrere Hinterachsen)
      var maxX = Math.max.apply(null, wheels.map(function (w) { return w.x; }).concat([-1e9]));
      wheels.forEach(function (w) { w.front = w.x > 0 && w.x > maxX - dims.L * 0.08; });
      shadow.scale.set(dims.L * 1.15, dims.W * 1.4, 1);
    }
    function spinWheels(rearRate, frontRate, steer, dt) {
      wheels.forEach(function (w) {
        if (w.spin) w.spin.rotation[w.spin.userData.ax] -= (w.front ? frontRate : rearRate) * dt * w.sgn;
        if (w.front) w.pivot.rotation.y = steer;
      });
    }
    function rearPoints() {
      var out = [];
      if (wheels.length) wheels.forEach(function (w) { if (!w.front) { var p = new THREE.Vector3(); w.pivot.getWorldPosition(p); p.y = 0; out.push({ k: w.pivot.name, p: p }); } });
      else [-1, 1].forEach(function (sd) { var p = new THREE.Vector3(-dims.L * 0.32, 0, sd * dims.W * 0.38); car.localToWorld(p); p.y = 0; out.push({ k: 'w' + sd, p: p }); });
      return out;
    }
    function skid(width, alpha) {
      rearPoints().forEach(function (r) {
        var a = toCanvas(r.p), b = skidPrev[r.k];
        if (b) { gx.strokeStyle = 'rgba(12,12,14,' + alpha + ')'; gx.lineWidth = width; gx.lineCap = 'round'; gx.beginPath(); gx.moveTo(b[0], b[1]); gx.lineTo(a[0], a[1]); gx.stroke(); }
        skidPrev[r.k] = a;
      });
      gtex.needsUpdate = true;
    }
    function smokeAtRear(n, push) {
      rearPoints().forEach(function (r) { for (var i = 0; i < n; i++) puff(new THREE.Vector3(r.p.x + rand(-0.2, 0.2), 0.25, r.p.z + rand(-0.2, 0.2)), { push: push }); });
    }
    function exhaust(flame) {
      var p = new THREE.Vector3(-dims.L * 0.5 - 0.05, dims.H * 0.18, dims.W * 0.25); car.localToWorld(p);
      puff(p, flame ? { flame: true, life: 0.25, size: 0.35, grow: 0.3, a: 0.95, push: new THREE.Vector3(-1.5, 0, 0).applyQuaternion(car.quaternion) }
        : { life: 1.2, size: 0.25, grow: 1.2, a: 0.35, push: new THREE.Vector3(-0.8, 0.2, 0).applyQuaternion(car.quaternion) });
    }

    // Donut um die Vorderachse: Heck schwenkt herum
    var FX = 0, F = new THREE.Vector3();
    function place(x, z, yaw, lift, shake) {
      car.rotation.set(0, yaw, lift || 0);
      if (shake) { car.rotation.x += rand(-shake, shake) * 0.4; car.rotation.z += rand(-shake, shake) * 0.6; }
      car.position.set(x, dims.H / 2 + (shake ? rand(0, shake * 0.25) : 0), z);
      shadow.position.set(x, 0.02, z); shadow.rotation.z = yaw;
    }

    function frame(ts) {
      if (t0 === null) { t0 = ts; last = ts; }
      var t = (ts - t0) / 1000, dt = Math.min(0.05, (ts - last) / 1000); last = ts;
      if (car) {
        if (t < 2.4) {                                   // rein: von links, abbremsen
          var e = smoothstep(0, 2.4, t), x = -15 + 15 * (1 - Math.pow(1 - e, 2.2));
          place(x, 0, 0);
          spinWheels((1 - e) * 22 + 2, (1 - e) * 22 + 2, 0, dt);
          if (!reduce && Math.random() < dt * 8) exhaust(false);
          FX = dims.L * 0.3; F.set(FX, 0, 0);
        } else if (t < 6.2) {                            // Donut: 360° um die Vorderachse, Heck raus
          var u = smoothstep(2.4, 6.2, t), yaw = u * Math.PI * 2;
          var cx = F.x - Math.cos(yaw) * FX, cz = F.z + Math.sin(yaw) * FX;
          place(cx, cz, yaw, 0, reduce ? 0 : 0.01);
          spinWheels(38, 6, 0.55, dt);
          skid(14, 0.32);
          if (!reduce) smokeAtRear(Math.random() < 0.7 ? 1 : 2, new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.5, 0.5)));
        } else if (t < 7.4) {                            // aufheulen: steht, wackelt, Flammen und Wolken aus dem Auspuff
          place(F.x - FX, F.z, 0, 0, reduce ? 0 : 0.025);
          skidPrev = {};
          spinWheels(0, 0, 0, dt);
          if (Math.random() < dt * (reduce ? 3 : 10)) exhaust(Math.random() < 0.45);
        } else if (t < 9.2) {                            // Burnout: Hinterräder drehen durch, viel Qualm
          place(F.x - FX, F.z, 0, 0, reduce ? 0 : 0.035);
          spinWheels(60, 0, 0, dt);
          skid(16, 0.08);
          if (!reduce) smokeAtRear(2, new THREE.Vector3(-1.6, 0.2, rand(-0.4, 0.4)));
        } else if (t < 11) {                             // raus: beschleunigen, Front hebt sich leicht
          var g = (t - 9.2) / 1.8, xx = F.x - FX + 34 * g * g;
          place(xx, F.z, 0, 0.06 * Math.sin(Math.min(1, g * 2) * Math.PI / 2) * (1 - g * 0.6));
          spinWheels(50 + 30 * g, 30 + 30 * g, 0, dt);
          if (g < 0.35) { skid(15, 0.25); if (!reduce) smokeAtRear(1, new THREE.Vector3(-2.5, 0.2, 0)); }
          else skidPrev = {};
        } else if (car.parent) { scene.remove(car); shadow.visible = false; }
        // Gummispuren ab 11 s ausblenden
        ground.material.opacity = t < 11 ? 1 : Math.max(0, 1 - (t - 11) / 3);
      }
      stepPuffs(dt);
      renderer.render(scene, cam);
      if (t < 14.5 || puffs.length) requestAnimationFrame(frame);
      else { renderer.clear(); done = true; if (opts.onDone) opts.onDone(); }
    }

    ToyCars.ready({ model: opts.model, count: 1 }).then(function (keys) {
      var key = opts.model && ToyCars.has(opts.model) ? opts.model : keys[Math.floor(Math.random() * keys.length)];
      if (!key) { if (opts.onDone) opts.onDone(); return; }
      setup(key);
      requestAnimationFrame(frame);
    });
    return { done: function () { return done; } };
  }

  root.CarBurnout = { start: start };
})(typeof window !== 'undefined' ? window : this);
