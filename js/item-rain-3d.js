/* Party-Regen in echtem 3D (three.js r128, js/vendor/three-r128.min.js) für
 * effects/item-rain.html: Gummientchen (kind=duck), Sushi (kind=sushi) – beide
 * fallen – oder Luftballons (kind=balloon), die von unten aufsteigen.
 * Modelle aus Grundformen, Oberflächen als gezeichnete Canvas-Texturen; jedes
 * Teil taumelt um alle drei Achsen. Alle teilen sich Geometrie und Material.
 *
 *   ItemRain3D.start({ kind, canvas, duration, count, size, reduceMotion })
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

  // ── Sushi ──
  // Textur aus einem gezeichneten Canvas (sRGB)
  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  // Reiskörner: kleine Ellipsen, hell und etwas dunkler, mit feinem Schatten
  function drawGrains(ctx, n, place, len) {
    for (var i = 0; i < n; i++) {
      var p = place();
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(Math.random() * Math.PI);
      ctx.fillStyle = Math.random() < 0.55 ? '#fbfaf5' : '#e9e3d2';
      ctx.strokeStyle = 'rgba(120,108,85,.32)'; ctx.lineWidth = len * 0.14;
      ctx.beginPath(); ctx.ellipse(0, 0, len * rand(0.8, 1.2), len * 0.42, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  function riceTexture() {
    return canvasTex(512, 512, function (ctx, w, h) {
      ctx.fillStyle = '#e8e2d2'; ctx.fillRect(0, 0, w, h);
      drawGrains(ctx, 2600, function () { return [Math.random() * w, Math.random() * h]; }, 9);
    });
  }
  // Stirnseite eines Maki: Nori-Rand, Reisring, Füllung (Lachs, Gurke, Tamago)
  function makiFace(kind) {
    return canvasTex(512, 512, function (ctx, w) {
      var c = w / 2;
      ctx.fillStyle = '#152019'; ctx.fillRect(0, 0, w, w);
      ctx.fillStyle = '#e6dfcd'; ctx.beginPath(); ctx.arc(c, c, c * 0.93, 0, Math.PI * 2); ctx.fill();
      drawGrains(ctx, 1500, function () {
        var a = Math.random() * Math.PI * 2, r = c * (0.38 + Math.sqrt(Math.random()) * 0.53);
        return [c + Math.cos(a) * r, c + Math.sin(a) * r];
      }, 11);
      // Schatten um die Füllung
      var g = ctx.createRadialGradient(c, c, c * 0.3, c, c, c * 0.48);
      g.addColorStop(0, 'rgba(80,60,40,.35)'); g.addColorStop(1, 'rgba(80,60,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, c * 0.48, 0, Math.PI * 2); ctx.fill();
      var r = c * 0.36;
      if (kind === 'salmon') {
        var sg = ctx.createRadialGradient(c - r * 0.3, c - r * 0.3, 0, c, c, r);
        sg.addColorStop(0, '#ff9a6c'); sg.addColorStop(1, '#d9532c');
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.clip();
        ctx.strokeStyle = 'rgba(255,232,220,.85)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        for (var i = -3; i <= 3; i++) { ctx.beginPath(); ctx.arc(c - r * 1.1, c + r * 1.1, r * (1.2 + i * 0.22), -1.4, -0.15); ctx.stroke(); }
        ctx.restore();
      } else if (kind === 'cucumber') {
        ctx.fillStyle = '#2f6b22'; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8fce68'; ctx.beginPath(); ctx.arc(c, c, r * 0.86, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d8f1c2'; ctx.beginPath(); ctx.arc(c, c, r * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6aa64a';
        for (var j = 0; j < 7; j++) { var a = j / 7 * Math.PI * 2; ctx.beginPath(); ctx.ellipse(c + Math.cos(a) * r * 0.28, c + Math.sin(a) * r * 0.28, 7, 4, a, 0, Math.PI * 2); ctx.fill(); }
      } else {
        ctx.fillStyle = '#f5c531'; ctx.fillRect(c - r, c - r * 0.8, r * 2, r * 1.6);
        ctx.strokeStyle = 'rgba(190,130,10,.55)'; ctx.lineWidth = 4;
        for (var k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(c - r, c + k * r * 0.3); ctx.lineTo(c + r, c + k * r * 0.3); ctx.stroke(); }
        ctx.strokeStyle = '#d29a12'; ctx.lineWidth = 3; ctx.strokeRect(c - r, c - r * 0.8, r * 2, r * 1.6);
      }
    });
  }
  // Nori-Wand: dunkelgrün mit Längsfasern und Naht
  function noriTexture() {
    return canvasTex(512, 128, function (ctx, w, h) {
      ctx.fillStyle = '#1b281f'; ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 700; i++) {
        ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(70,100,70,.35)' : 'rgba(0,0,0,.35)';
        ctx.lineWidth = rand(0.5, 1.6);
        var x = Math.random() * w;
        ctx.beginPath(); ctx.moveTo(x, Math.random() * h * 0.3); ctx.lineTo(x + rand(-3, 3), h - Math.random() * h * 0.3); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(w * 0.3, 0, 3, h);
    });
  }
  // Fischscheibe: Lachs mit weißen Fettlinien, Garnele mit Bändern
  function fishTexture(kind) {
    return canvasTex(512, 256, function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      if (kind === 'salmon') { g.addColorStop(0, '#ff9466'); g.addColorStop(1, '#e8602f'); }
      else { g.addColorStop(0, '#ffb08c'); g.addColorStop(1, '#f06a3c'); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      if (kind === 'salmon') {
        ctx.strokeStyle = 'rgba(255,238,228,.9)'; ctx.lineCap = 'round';
        for (var i = -2; i < 12; i++) {
          ctx.lineWidth = rand(5, 9);
          ctx.beginPath(); ctx.moveTo(i * 48, -10); ctx.quadraticCurveTo(i * 48 + 40, h * 0.5, i * 48 + 10, h + 10); ctx.stroke();
        }
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.8)';
        for (var j = 0; j < 7; j++) { ctx.fillRect(j * 76 + 20, 0, 22, h); }
        ctx.fillStyle = 'rgba(200,40,20,.5)';
        for (var k = 0; k < 7; k++) { ctx.fillRect(j * 0 + k * 76 + 44, 0, 8, h); }
      }
    });
  }
  function buildSushiTemplate() {
    var std = function (o) { return new THREE.MeshStandardMaterial(o); };
    var rice = std({ map: riceTexture(), roughness: 0.85 });
    rice.bumpMap = rice.map; rice.bumpScale = 0.015;
    var nori = std({ map: noriTexture(), roughness: 0.55, metalness: 0.05 });
    var faces = { salmon: makiFace('salmon'), cucumber: makiFace('cucumber'), tamago: makiFace('tamago') };
    var faceMat = {};
    Object.keys(faces).forEach(function (k) { faceMat[k] = std({ map: faces[k], roughness: 0.8, bumpMap: faces[k], bumpScale: 0.01 }); });
    var fishMat = {
      salmon: new THREE.MeshPhysicalMaterial({ map: fishTexture('salmon'), roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      shrimp: new THREE.MeshPhysicalMaterial({ map: fishTexture('shrimp'), roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 })
    };
    var tailMat = new THREE.MeshPhysicalMaterial({ color: 0xe8461f, roughness: 0.35, clearcoat: 0.6 });
    tailMat.color.convertSRGBToLinear();

    // Maki: Zylinder, Seite Nori, beide Stirnseiten Reis + Füllung
    var makiGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.42, 56, 1, false);
    // Nigiri: Reisballen mit flacher Unterseite
    var riceGeo = new THREE.SphereGeometry(1, 40, 28);
    riceGeo.scale(0.5, 0.24, 0.3);
    (function () {
      var p = riceGeo.attributes.position;
      for (var i = 0; i < p.count; i++) { var y = p.getY(i); if (y < -0.12) p.setY(i, -0.12 + (y + 0.12) * 0.3); }
      riceGeo.computeVertexNormals();
    })();
    // Fischscheibe: dünne Platte, zu den Enden schmaler, über den Reis gebogen
    var fishGeo = new THREE.BoxGeometry(1.2, 0.07, 0.64, 40, 1, 14);
    (function () {
      var p = fishGeo.attributes.position;
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i), y = p.getY(i), z = p.getZ(i), e = Math.abs(x) / 0.6;
        z *= 1 - Math.pow(e, 4) * 0.4;
        y += 0.24 - 0.42 * x * x;
        p.setXYZ(i, x, y, z);
      }
      fishGeo.computeVertexNormals();
    })();
    var tailGeo = new THREE.ConeGeometry(0.13, 0.3, 20);
    tailGeo.scale(1, 1, 0.35);

    function maki() {
      var kind = ['salmon', 'cucumber', 'tamago'][Math.floor(Math.random() * 3)];
      var g = new THREE.Group();
      var m = new THREE.Mesh(makiGeo, [nori, faceMat[kind], faceMat[kind]]);
      m.rotation.y = Math.random() * 6.28;
      g.add(m);
      return { g: g, len: 1.0 };
    }
    function nigiri() {
      var kind = Math.random() < 0.65 ? 'salmon' : 'shrimp';
      var g = new THREE.Group();
      var r = new THREE.Mesh(riceGeo, rice); r.position.y = -0.08; g.add(r);
      g.add(new THREE.Mesh(fishGeo, fishMat[kind]));
      if (kind === 'shrimp') {
        [-1, 1].forEach(function (s) {
          var t = new THREE.Mesh(tailGeo, tailMat);
          t.position.set(0.66, 0.1, s * 0.07); t.rotation.set(s * 0.3, 0, -1.9);
          g.add(t);
        });
      }
      return { g: g, len: 1.25 };
    }
    return { make: function () { return Math.random() < 0.6 ? maki() : nigiri(); } };
  }

  // ── Luftballons: Drehkörper (oben breit, unten zum Knoten schmal), Knoten,
  // Schnur; glänzendes Latex. Modell-Einheiten: Ballon ~1.9 hoch, 1.64 breit ──
  var BALLOON_COLORS = [0xe8202a, 0x1f6fe0, 0xffc81a, 0x22a85a, 0xff7a1a, 0xff5fa8, 0x8e4bd6, 0xd4a017];
  function buildBalloonTemplate() {
    var prof = [[0.0, -1.0], [0.06, -0.98], [0.2, -0.88], [0.42, -0.66], [0.62, -0.38], [0.76, -0.08],
                [0.82, 0.2], [0.78, 0.48], [0.64, 0.74], [0.42, 0.92], [0.18, 1.0], [0.0, 1.02]];
    var body = new THREE.LatheGeometry(prof.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), 48);
    body.computeVertexNormals();
    var knot = new THREE.CylinderGeometry(0.05, 0.11, 0.12, 16);
    var mats = BALLOON_COLORS.map(function (c) {
      var m = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
      m.color.convertSRGBToLinear();
      return m;
    });
    var stringMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 });
    // Schnur: drei Glieder, jedes leicht geschwungen; sie hängen aneinander und
    // pendeln zeitversetzt (siehe start → swing)
    var SEG = 0.62;
    var seg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, -SEG * 0.35, 0.01), new THREE.Vector3(-0.04, -SEG * 0.7, -0.01), new THREE.Vector3(0, -SEG, 0)
    ]), 16, 0.012, 6, false);
    return {
      make: function () {
        var mat = mats[Math.floor(Math.random() * mats.length)];
        var g = new THREE.Group();
        var b = new THREE.Mesh(body, mat);
        g.add(b);
        var k = new THREE.Mesh(knot, mat); k.position.y = -1.04; g.add(k);
        var parent = g, pivots = [];
        for (var i = 0; i < 3; i++) {
          var pv = new THREE.Group();
          pv.position.y = i === 0 ? -1.1 : -SEG;
          pv.add(new THREE.Mesh(seg, stringMat));
          parent.add(pv); pivots.push(pv); parent = pv;
        }
        return { g: g, len: 1.9, pivots: pivots };
      }
    };
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

    var kind = opts.kind === 'sushi' || opts.kind === 'balloon' ? opts.kind : 'duck';
    if (kind === 'duck' && root.RubberDuck) {
      // Umgebung zum Spiegeln für das Vinyl der Gummiente
      var ec = document.createElement('canvas'); ec.width = 512; ec.height = 256;
      var ex = ec.getContext('2d'), eg = ex.createLinearGradient(0, 0, 0, 256);
      eg.addColorStop(0, '#ffffff'); eg.addColorStop(0.45, '#c9d2dc'); eg.addColorStop(0.55, '#6a7280'); eg.addColorStop(1, '#25282e');
      ex.fillStyle = eg; ex.fillRect(0, 0, 512, 256);
      var et = new THREE.CanvasTexture(ec); et.mapping = THREE.EquirectangularReflectionMapping; et.encoding = THREE.sRGBEncoding;
      var epm = new THREE.PMREMGenerator(renderer); scene.environment = epm.fromEquirectangular(et).texture; epm.dispose();
    }
    var rise = kind === 'balloon';
    var tpl = kind === 'sushi' ? buildSushiTemplate() : rise ? buildBalloonTemplate() : buildDuckTemplate();
    // neues Teil: { g, len } – len = größte Ausdehnung in Modell-Einheiten
    // Enten: neue Gummiente (js/rubber-duck.js) mit Outfit; je Outfit einmal gebaut,
    // danach geklont (teilt Geometrie und Material). outfit 'mix' = zufällig je Ente
    var RD = root.RubberDuck, duckCache = {};
    function duckOf(outfit, pink) {
      var key = outfit + (pink ? ':pink' : '');
      if (!duckCache[key]) {
        var inner = RD.build({ outfit: outfit, color: pink ? 0xff9fc2 : null });
        inner.position.set(-0.12, -0.55, 0);   // um die Mitte der Ente drehen
        duckCache[key] = new THREE.Group().add(inner);
      }
      return RD.clone ? RD.clone(duckCache[key]) : duckCache[key].clone();
    }
    // outfit 'random' = einmal je Aufruf ein Outfit (ohne „none“), alle Enten gleich
    var fixedOutfit = opts.outfit;
    if (fixedOutfit === 'random' && RD) {
      var pool = RD.OUTFITS.filter(function (k) { return k !== 'none'; });
      fixedOutfit = pool[Math.floor(Math.random() * pool.length)];
    }
    function makeItem() {
      if (kind === 'sushi' || rise) return tpl.make();
      if (RD) {
        var o = opts.outfit === 'mix' ? RD.OUTFITS[Math.floor(Math.random() * RD.OUTFITS.length)] : (fixedOutfit || 'none');
        return { g: duckOf(o, o === 'none' && Math.random() < 0.12), len: 2.7 };
      }
      return { g: Math.random() < 0.12 ? tpl.pink() : tpl.yellow(), len: 2.6 };
    }
    var size = opts.size || 96, count = opts.count || 120, duration = opts.duration || 22000;
    var spawnEnd = duration * 0.62, margin = 120;
    var ducks = [], spawned = 0, t0 = null, last = null;

    function spawn() {
      var k = rand(0.8, 1.2), it = makeItem(), g = it.g;
      // jedes Teil etwa `size` groß (Ballons etwas größer)
      var sc = size * k * (rise ? 1.5 : 1) / it.len;
      g.scale.set(sc, sc, sc);
      if (rise) g.rotation.set(rand(-0.15, 0.15), rand(0, 6.28), rand(-0.2, 0.2));
      else g.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
      scene.add(g);
      if (rise) {
        // Ballons: steigen von unten auf, pendeln leicht, drehen sich langsam
        ducks.push({ g: g, sc: sc, rise: true, x: rand(margin, W - margin), y: H + rand(160, 320), vy: -rand(130, 230), z: rand(-300, 300),
                     ph: rand(0, 6.28), sw: rand(0.6, 1.2), amp: rand(18, 40), wy: reduce ? 0 : rand(-0.6, 0.6), h: size * k,
                     pivots: it.pivots, sph: rand(0, 6.28), sf: rand(2.2, 3.4) });
        spawned++;
        return;
      }
      ducks.push({ g: g, sc: sc, x: rand(margin, W - margin), y: rand(-200, -80), vx: rand(-30, 30), vy: rand(60, 160),
                   wx: reduce ? 0 : rand(-2.2, 2.2), wy: reduce ? 0 : rand(-2.6, 2.6), wz: reduce ? 0 : rand(-2.2, 2.2),
                   bounced: false, back: 0, h: size * k * 0.5, z: rand(-300, 300) });
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
        if (d.rise) {
          d.ph += dt * d.sw;
          d.y += d.vy * dt;
          if (d.y < -d.h * 3.5) { remove(d); return false; }
          d.g.rotation.y += d.wy * dt;
          d.g.rotation.z = Math.sin(d.ph) * 0.12;
          // Schnur wackelt: jedes Glied etwas später und weiter als das obere
          d.sph += dt * d.sf;
          if (!reduce) d.pivots.forEach(function (pv, i) {
            pv.rotation.z = Math.sin(d.sph - i * 0.9) * (0.12 + i * 0.1) - Math.sin(d.ph) * 0.1;
            pv.rotation.x = Math.sin(d.sph * 0.7 - i * 1.1) * (0.08 + i * 0.06);
          });
          d.g.position.set(d.x + Math.sin(d.ph) * d.amp, -d.y, d.z);
          return true;
        }
        d.vy = Math.min(d.vy + 900 * dt, 760);
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (!d.bounced && d.y > FLOOR - d.h) {
          d.bounced = true; d.y = FLOOR - d.h;
          d.vy = -d.vy * rand(0.25, 0.4); d.vx *= 0.6; d.wx *= 0.5; d.wy *= 0.5; d.wz *= 0.5;
        }
        // nach dem Aufditschen kippt es nach hinten: etwas kleiner, hinter die
        // fallenden Teile, und fällt unten aus dem Bild
        if (d.bounced) d.back = Math.min(1, d.back + dt / 0.7);
        if (d.y > H + d.h * 2) { remove(d); return false; }
        d.g.rotation.x += d.wx * dt; d.g.rotation.y += d.wy * dt; d.g.rotation.z += d.wz * dt;
        // Umhang flattert im Fahrtwind: je schneller, desto mehr
        if (RD && RD.flutter && kind === 'duck') RD.flutter(d.g, t / 1000, 0.4 + Math.min(1, d.vy / 600), d.ph || (d.ph = Math.random() * 6.28));
        var s = d.sc * (1 - 0.22 * d.back);
        d.g.scale.set(s, s, s);
        d.g.position.set(d.x, -d.y, d.z - 600 * d.back);
        return true;
      });
      renderer.render(scene, cam);
      if (t < duration || ducks.length) requestAnimationFrame(frame);
      else renderer.clear();
    }
    requestAnimationFrame(frame);
  }

  // Bauteile der Ente auch für andere Effekte (js/knife-duck.js, tools/duck-viewer.html)
  root.ItemRain3D = { start: start, duckBody: bodyGeometry, ellipsoid: ellipsoid, duckTemplate: buildDuckTemplate };
})(typeof window !== 'undefined' ? window : this);
