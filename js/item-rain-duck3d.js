/* Gummientchen-Regen in echtem 3D (three.js r128, js/vendor/three-r128.min.js)
 * für effects/item-rain.html?kind=duck. Die Ente ist aus Grundformen modelliert
 * (verformte Kugel als Rumpf mit hochgezogenem Schwanz, Kopf, zweiteiliger
 * Schnabel, Flügel, Augen) und hat ein glänzendes Gummi-Material; jede taumelt
 * um alle drei Achsen. Alle teilen sich Geometrie und Material.
 *
 *   DuckRain3D.start({ canvas, duration, count, size, reduceMotion })
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function smooth(a, b, v) { var t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }

  // ── Modell: Einheiten ~ Rumpflänge 2.5, Mittelpunkt im Rumpf ──
  function bodyGeometry() {
    var g = new THREE.SphereGeometry(1, 56, 40);
    var p = g.attributes.position, v = new THREE.Vector3();
    for (var i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      var x = v.x * 1.25, y = v.y * 0.78, z = v.z * 0.95;
      // Schwanz: hinten oben hochgezogen und schmaler (weich, ohne Knick)
      var k = Math.max(0, -x - 0.45), up = smooth(-1, 1, v.y);
      y += k * k * (0.5 + 1.5 * up);
      z *= 1 - k * 0.5;
      x -= k * 0.25;
      // Brust vorn etwas voller
      x += Math.max(0, x - 0.5) * 0.15 * smooth(-0.6, 0.3, v.y);
      // flache Unterseite (schwimmt)
      if (y < -0.5) y = -0.5 + (y + 0.5) * 0.25;
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  }
  function ellipsoid(rx, ry, rz, seg) {
    var g = new THREE.SphereGeometry(1, seg || 32, Math.round((seg || 32) * 0.7));
    g.scale(rx, ry, rz);
    return g;
  }

  function buildDuckTemplate() {
    var yellow = new THREE.MeshPhysicalMaterial({ color: 0xffcf1f, roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.18 });
    var pink = new THREE.MeshPhysicalMaterial({ color: 0xff9fc2, roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.18 });
    var beak = new THREE.MeshPhysicalMaterial({ color: 0xff7a12, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15 });
    var beakLow = new THREE.MeshPhysicalMaterial({ color: 0xe0580a, roughness: 0.4, clearcoat: 0.6 });
    var eye = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
    var white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    [yellow, pink, beak, beakLow, eye].forEach(function (m) { m.color.convertSRGBToLinear(); });

    var geo = {
      body: bodyGeometry(),
      head: ellipsoid(0.56, 0.54, 0.54, 44),
      neck: ellipsoid(0.42, 0.34, 0.42, 28),
      beakUp: ellipsoid(0.38, 0.13, 0.3, 28),
      beakLow: ellipsoid(0.31, 0.09, 0.25, 24),
      wing: ellipsoid(0.55, 0.3, 0.1, 28),
      eye: ellipsoid(0.085, 0.1, 0.07, 16),
      glint: ellipsoid(0.03, 0.03, 0.025, 8)
    };

    function make(bodyMat) {
      var g = new THREE.Group();
      function add(gm, mat, x, y, z, rx, ry, rz) {
        var m = new THREE.Mesh(gm, mat);
        m.position.set(x, y, z);
        if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
        g.add(m);
        return m;
      }
      add(geo.body, bodyMat, 0, 0, 0);
      add(geo.neck, bodyMat, 0.55, 0.42, 0);
      add(geo.head, bodyMat, 0.62, 0.86, 0);
      add(geo.beakUp, beak, 1.2, 0.82, 0, 0, 0, -0.12);
      add(geo.beakLow, beakLow, 1.14, 0.7, 0, 0, 0, -0.05);
      [-1, 1].forEach(function (side) {
        add(geo.wing, bodyMat, -0.05, 0.05, side * 0.86, 0, side * 0.12, 0.25);
        // auf der Kopfoberfläche, schräg vorn oben
        add(geo.eye, eye, 1.0, 1.06, side * 0.36, 0, side * 0.6, 0);
        add(geo.glint, white, 1.06, 1.1, side * 0.39);
      });
      // Ente mittig um den Schwerpunkt drehen
      g.children.forEach(function (c) { c.position.x -= 0.15; c.position.y -= 0.2; });
      return g;
    }
    return { yellow: function () { return make(yellow); }, pink: function () { return make(pink); } };
  }

  function start(opts) {
    var W = 1920, H = 1080, FLOOR = H - 26;
    var canvas = opts.canvas, reduce = !!opts.reduceMotion;
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.physicallyCorrectLights = false;

    var scene = new THREE.Scene();
    // Bildschirm-Pixel als Einheiten: x nach rechts, y nach unten (Kamera gespiegelt)
    var cam = new THREE.OrthographicCamera(0, W, 0, -H, -2000, 2000);
    cam.position.z = 1000;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a6a30, 0.75));
    var key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(-0.8, 1.2, 1.4);
    scene.add(key);
    var rim = new THREE.DirectionalLight(0xfff2cc, 0.35);
    rim.position.set(1, -0.3, 0.6);
    scene.add(rim);

    var tpl = buildDuckTemplate();
    var size = opts.size || 96, count = opts.count || 120, duration = opts.duration || 22000;
    var spawnEnd = duration * 0.62, margin = 120;
    var ducks = [], spawned = 0, t0 = null, last = null;

    function spawn() {
      var k = rand(0.8, 1.2), g = Math.random() < 0.12 ? tpl.pink() : tpl.yellow();
      // ganze Ente etwa `size` breit (Rumpflänge ~2.6 Einheiten)
      var sc = size * k / 2.6;
      g.scale.set(sc, sc, sc);
      g.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
      scene.add(g);
      ducks.push({ g: g, sc: sc, x: rand(margin, W - margin), y: rand(-200, -80), vx: rand(-30, 30), vy: rand(60, 160),
                   wx: reduce ? 0 : rand(-2.2, 2.2), wy: reduce ? 0 : rand(-2.6, 2.6), wz: reduce ? 0 : rand(-2.2, 2.2),
                   bounced: false, out: 1, h: size * k * 0.5 });
      spawned++;
    }
    function remove(d) { scene.remove(d.g); }

    function frame(ts) {
      if (t0 === null) { t0 = ts; last = ts; }
      var t = ts - t0, dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      var want = Math.min(count, Math.floor(count * (t / spawnEnd) * (1 + 0.25 * Math.sin(t / 900))));
      while (spawned < want) spawn();
      ducks = ducks.filter(function (d) {
        d.vy = Math.min(d.vy + 900 * dt, 760);
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (!d.bounced && d.y > FLOOR - d.h) {
          d.bounced = true; d.y = FLOOR - d.h;
          d.vy = -d.vy * rand(0.25, 0.4); d.vx *= 0.6; d.wx *= 0.5; d.wy *= 0.5; d.wz *= 0.5;
        }
        // nach dem Aufhüpfen weich kleiner werden statt hart zu verschwinden
        if (d.bounced) d.out -= dt / 0.8;
        if (d.out <= 0 || d.y > H + 200) { remove(d); return false; }
        d.g.rotation.x += d.wx * dt; d.g.rotation.y += d.wy * dt; d.g.rotation.z += d.wz * dt;
        var s = d.sc * Math.max(0, Math.min(1, d.out));
        d.g.scale.set(s, s, s);
        d.g.position.set(d.x, -d.y, 0);
        return true;
      });
      renderer.render(scene, cam);
      if (t < duration || ducks.length) requestAnimationFrame(frame);
      else renderer.clear();
    }
    requestAnimationFrame(frame);
  }

  root.DuckRain3D = { start: start };
})(typeof window !== 'undefined' ? window : this);
