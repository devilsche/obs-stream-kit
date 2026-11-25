/* Disco-Kugel in WebGL (three r128) für alerts/welcome.html: Spiegelkacheln auf einer Kugel (InstancedMesh, je Kachel
 * leicht verkippt, damit sie einzeln aufblitzen), Studio-Umgebung zum Spiegeln (RoomEnvironment) und farbige Lichter
 * in den Theme-Farben, die um die Kugel kreisen. Dazu kurze Funkel-Sterne auf der Vorderseite.
 * Hängt an einer Schnur oben in der Mitte, fährt herein und am Ende wieder hoch.
 *
 *   var b = DiscoBall.create({ canvas, colors: ['#f2b705', '#5e2a79', …], radius: 1 });
 *   b.leave();                 // hochfahren
 *   b.setColors([...]);        // Theme-Wechsel
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  function create(opt) {
    var canvas = opt.canvas, W = canvas.width, H = canvas.height;
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, premultipliedAlpha: true });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.setClearColor(0, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    var scene = new THREE.Scene();
    if (THREE.RoomEnvironment) {
      var pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.02).texture; pm.dispose();
    }
    // Kamera so, dass 1 Einheit ≈ 100 px in der Kugelebene; Kugel oben in der Mitte
    var cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
    var dist = (H / 100) / 2 / Math.tan(THREE.MathUtils.degToRad(15));
    cam.position.set(0, 0, dist); cam.lookAt(0, 0, 0);
    var topY = H / 200;                                   // oberer Bildrand in Einheiten
    var R = opt.radius || 1.45, restY = topY - 0.9 - R;   // Kugelmitte im Ruhezustand

    var rig = new THREE.Group(); scene.add(rig);           // fährt rein/raus
    var ball = new THREE.Group(); rig.add(ball);           // dreht sich

    // Kacheln: Breitengrade, je Ring so viele Kacheln, dass sie etwa quadratisch bleiben
    var TILE = 0.105, rings = Math.round(Math.PI * R / TILE), mats = [], count = 0, place = [];
    for (var i = 0; i < rings; i++) {
      var lat = -Math.PI / 2 + (i + 0.5) * Math.PI / rings, n = Math.max(4, Math.round(2 * Math.PI * R * Math.cos(lat) / TILE));
      for (var j = 0; j < n; j++) { place.push([lat, (j + (i % 2) * 0.5) * 2 * Math.PI / n]); count++; }
    }
    var tileGeo = new THREE.BoxGeometry(TILE * 0.9, TILE * 0.9, 0.025);
    var tileMat = new THREE.MeshStandardMaterial({ color: 0xd9dde4, metalness: 1, roughness: 0.18, envMapIntensity: 0.75 });
    var tiles = new THREE.InstancedMesh(tileGeo, tileMat, count);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    place.forEach(function (p, k) {
      var lat = p[0], lon = p[1];
      pos.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)).multiplyScalar(R);
      e.set(-lat + (Math.random() - 0.5) * 0.12, lon + (Math.random() - 0.5) * 0.12, 0, 'YXZ'); q.setFromEuler(e);
      m4.compose(pos, q, one); tiles.setMatrixAt(k, m4);
    });
    ball.add(tiles);
    // dunkler Kern zwischen den Kacheln (Fugen)
    ball.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 48, 32), new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.9 })));
    // Aufhängung: Kappe + Schnur bis zum oberen Bildrand
    var gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 });
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.22, 24), gold); cap.position.y = R + 0.08; rig.add(cap);
    var cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 8), gold); rig.add(cord);

    // Licht: weiches Grundlicht + farbige Punktlichter, die um die Kugel kreisen (Theme-Farben)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.5));
    var lights = [];
    function setColors(cols) {
      cols = (cols && cols.length ? cols : ['#f2b705', '#5e2a79', '#ffffff']).slice(0, 4);
      lights.forEach(function (l) { rig.remove(l); });
      lights = cols.map(function (c, k) {
        var l = new THREE.PointLight(new THREE.Color(c), 5, 14, 1.2); l.userData.ph = k * Math.PI * 2 / cols.length; rig.add(l); return l;
      });
    }
    setColors(opt.colors);

    // Funkel-Sterne: kurze, helle Kreuze auf der sichtbaren Vorderseite
    var sc = document.createElement('canvas'); sc.width = sc.height = 64;
    var sx = sc.getContext('2d'), gr = sx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    sx.fillStyle = gr; sx.fillRect(0, 0, 64, 64);
    sx.fillStyle = 'rgba(255,255,255,0.9)'; sx.fillRect(30, 0, 4, 64); sx.fillRect(0, 30, 64, 4);
    var starTex = new THREE.CanvasTexture(sc), stars = [];
    for (var s = 0; s < 7; s++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      sp.userData = { t: -Math.random() * 2, life: 0.5 + Math.random() * 0.4 }; rig.add(sp); stars.push(sp);
    }

    var y = topY + R + 1.4, vy = 0, target = restY, leaving = false, t0 = null, last = null, alive = true;
    function frame(ts) {
      if (!alive) return;
      if (t0 === null) { t0 = ts; last = ts; }
      var dt = Math.min(0.05, (ts - last) / 1000), t = (ts - t0) / 1000; last = ts;
      // Feder: einfahren mit leichtem Nachschwingen, rausfahren zügig
      var k = leaving ? 18 : 30, d = leaving ? 7 : 6;
      vy += ((target - y) * k - vy * d) * dt; y += vy * dt;
      rig.position.y = y; rig.rotation.z = Math.sin(t * 1.3) * 0.03;
      ball.rotation.y += dt * 0.45;
      // Schnur von der Kappe bis über den oberen Rand
      var len = Math.max(0.1, topY + 0.5 - (y + R + 0.15)); cord.scale.y = len; cord.position.y = R + 0.15 + len / 2;
      lights.forEach(function (l) {
        var a = l.userData.ph + t * 0.9; l.position.set(Math.cos(a) * 2.6, Math.sin(a * 0.7) * 1.4, 2.2 + Math.sin(a) * 0.8);
      });
      stars.forEach(function (sp) {
        var u = sp.userData; u.t += dt;
        if (u.t > u.life) {   // neu setzen: Punkt auf der Vorderseite
          u.t = -Math.random() * 0.8; u.life = 0.4 + Math.random() * 0.4;
          var a = (Math.random() - 0.5) * 2.2, b = (Math.random() - 0.5) * 2.2;
          sp.position.set(Math.sin(a) * R * 0.95, Math.sin(b) * R * 0.9, Math.cos(a) * Math.cos(b) * R + 0.05);
        }
        var f = u.t < 0 ? 0 : Math.sin(Math.PI * u.t / u.life);
        sp.material.opacity = f; var s2 = 0.25 + 0.35 * f; sp.scale.set(s2, s2, 1);
      });
      renderer.render(scene, cam);
      if (leaving && y > topY + R + 2) { alive = false; renderer.clear(); return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return {
      leave: function () { leaving = true; target = topY + R + 3; },
      setColors: setColors
    };
  }

  root.DiscoBall = { create: create };
})(window);
