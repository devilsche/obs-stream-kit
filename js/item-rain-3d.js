/* Party-Regen in echtem 3D (three.js r128, js/vendor/three-r128.min.js) für
 * effects/item-rain.html: Gummientchen (kind=duck), Sushi (kind=sushi), Spielzeugautos (kind=car,
 * js/toy-cars.js, model=mix|2002|e30|e30m3|e36|e46|e92m3) – fallen – oder Luftballons (kind=balloon),
 * die von unten aufsteigen.
 * Modelle aus Grundformen, Oberflächen als gezeichnete Canvas-Texturen; jedes
 * Teil taumelt um alle drei Achsen. Alle teilen sich Geometrie und Material.
 *
 *   ItemRain3D.start({ kind, canvas, duration, count, size, reduceMotion, eater, driver, owner, eat })
 * Autos mit driver: eine Gummiente springt in ein gelandetes Auto und fährt damit weg (driver wie eater).
 * Sushi mit eater: eine Gummiente sammelt die gelandeten Sushi ein, frisst sich voll und platzt
 * (eater = true oder Outfit-Name; owner = Kanalname → dessen !outfit; eat = Stücke bis zum Platzen).
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

  // ── Fress-Ente beim Sushi-Regen: watschelt am unteren Rand zu liegenden Sushi, schnappt sie
  // (auch im Flug), wird mit jedem Stück runder und langsamer, bläht sich auf und platzt –
  // Gummifetzen, die gefressenen Sushi und der Schnabel fliegen heraus.
  // E = { scene, W, H, FLOOR, items (Liste des Regens, live), makeSushi, size, reduce, outfit, target, duration }
  function makeEater(E) {
    var RD = root.RubberDuck, S = E.size * 1.05, Z = 420, W = E.W, FLOOR = E.FLOOR, reduce = E.reduce;
    var g = new THREE.Group(), d = RD.build({ outfit: E.outfit });
    d.position.y = 0.55; g.add(d); g.visible = false; E.scene.add(g);
    var lower = null, bills = [], mats = [], cols = [];
    d.traverse(function (m) {
      if (m.name === 'Lower bill') lower = m;
      if (m.name === 'Upper bill' || m.name === 'Lower bill') bills.push(m);
      if (!m.isMesh) return;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach(function (mt) {
        if (mt && mt.emissive && mats.indexOf(mt) < 0) { mats.push(mt); mt.userData.em0 = mt.emissive.clone(); }
        if (mt && mt.color && cols.length < 5 && !mt.transparent) {
          var hx = mt.color.clone().convertLinearToSRGB().getHex(), l = (hx >> 16 & 255) + (hx >> 8 & 255) + (hx & 255);
          if (l > 90 && l < 720 && cols.indexOf(hx) < 0) cols.push(hx);
        }
      });
    });
    if (!cols.length) cols = [0xffcd2a];
    var st = 'wait', x = 0, dir = 1, eaten = 0, target = E.target, t = 0, ph = 0, phaseT = 0;
    var bite = null, gulp = 0, burped = false, burp = 0, parts = [], puffs = [], done = false, eatenItems = 0;
    function fat() { return Math.min(1, eaten / target); }
    function scaleNow(extra) {
      var f = fat(), e = extra || 0, sq = burp > 0 ? Math.sin(burp / 0.45 * Math.PI) : 0, gp = gulp > 0 ? Math.sin(gulp / 0.25 * Math.PI) : 0;
      g.scale.set(S * (1 + 0.45 * f + e) * (1 + 0.06 * gp), S * (1 + 0.12 * f + e * 0.6) * (1 - 0.12 * sq + 0.05 * gp), S * (1 + 0.85 * f + e) * (1 + 0.08 * gp));
    }
    function face(dx) { dir = dx < 0 ? -1 : 1; g.rotation.y = dir > 0 ? -0.35 : Math.PI + 0.35; }
    function reach() { return 1.32 * S * (1 + 0.45 * fat()) * 0.94; }
    function tip() { return new THREE.Vector3(x + dir * reach(), -(FLOOR - S * 1.35), Z + 10); }
    function resting() { return E.items.filter(function (it) { return it.rest > 0 && !it.gone && !it.bitten; }); }
    function speed() { return (reduce ? 170 : 290) * (1 - 0.6 * fat()); }
    function waddle(amount) {
      ph += (E.dt || 0.016) * 11 * (0.6 + 0.4 * (1 - fat()));
      d.rotation.x = Math.sin(ph) * 0.14 * amount * (reduce ? 0.4 : 1);
      d.position.y = 0.55 + Math.abs(Math.sin(ph)) * 0.1 * amount * (1 - 0.6 * fat());
    }
    function startBite(it, air) {
      it.bitten = true; bite = { it: it, t: 0, T: air ? 0.22 : 0.32, p0: new THREE.Vector3(it.x, -it.y, it.z), s0: it.g.scale.x };
      st = 'eat';
    }
    function sample(a) { return a[Math.floor(Math.random() * a.length)]; }
    // Teilchen nach dem Platzen: fliegen, ditschen am Boden, schrumpfen am Ende und zum Rand hin weich weg
    function fling(o, x0, y0, z0, vx, vy, life, h) {
      parts.push({ o: o, x: x0, y: y0, z: z0, vx: vx, vy: vy, wx: rand(-6, 6), wy: rand(-6, 6), wz: rand(-6, 6), age: 0, life: life, h: h, s0: o.scale.clone(), hops: 0 });
      E.scene.add(o);
    }
    function burst() {
      var cx = x, cy = FLOOR - S * 1.0 * (1 + 0.12 * fat());
      g.visible = false;
      // Puff-Wolke
      for (var i = 0; i < (reduce ? 5 : 8); i++) {
        var pm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
        var pu = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), pm);
        pu.position.set(cx + rand(-60, 60), -(cy + rand(-50, 40)), Z + 40); pu.scale.setScalar(10);
        E.scene.add(pu); puffs.push({ o: pu, age: 0, life: rand(0.5, 0.8), r: rand(70, 120) * (reduce ? 0.8 : 1) });
      }
      if (reduce) { done = true; return; }
      // Gummifetzen in den Farben der Ente
      var shard = new THREE.SphereGeometry(1, 10, 6);
      for (var k = 0; k < 26; k++) {
        var sm = new THREE.MeshStandardMaterial({ color: sample(cols), roughness: 0.45, metalness: 0 });
        sm.color.convertSRGBToLinear();
        var sh = new THREE.Mesh(shard, sm), r = rand(9, 22);
        sh.scale.set(r, r * 0.3, r * rand(0.5, 0.9));
        var a = rand(-Math.PI * 0.95, -Math.PI * 0.05), v = rand(380, 820);
        fling(sh, cx + rand(-25, 25), cy + rand(-30, 30), Z + rand(-40, 60), Math.cos(a) * v, Math.sin(a) * v, rand(2.4, 3.4), r * 0.3);
      }
      // die gefressenen Sushi kommen wieder heraus
      for (var j = 0; j < Math.min(eatenItems, 20); j++) {
        var it = E.makeSushi(), sc = E.size * rand(0.75, 1.0) / it.len, a2 = rand(-Math.PI * 0.9, -Math.PI * 0.1), v2 = rand(300, 700);
        it.g.scale.setScalar(sc); it.g.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
        fling(it.g, cx + rand(-20, 20), cy + rand(-20, 20), Z + rand(-60, 20), Math.cos(a2) * v2, Math.sin(a2) * v2, rand(2.6, 3.6), E.size * 0.35);
      }
      // der Schnabel fliegt hoch und ditscht zum Schluss auf
      d.updateMatrixWorld(true);
      bills.forEach(function (b, i) {
        E.scene.attach(b);
        var p = b.position.clone();
        b.position.set(0, 0, 0);
        var bw = new THREE.Group(); bw.add(b); bw.position.copy(p);
        fling(bw, p.x, -p.y, p.z + 30, rand(-120, 120) + (i ? 60 : -60), rand(-1000, -850), 4.2, S * 0.12);
      });
    }
    function setGlow(k) {
      mats.forEach(function (mt) { mt.emissive.copy(mt.userData.em0).lerp(new THREE.Color(0xff1a00), k); mt.emissiveIntensity = 1; });
    }
    function step(dt, tt) {
      E.dt = dt; t = tt;
      if (done && !parts.length && !puffs.length) return false;
      if (st === 'wait') {
        var r0 = resting();
        if (r0.length || t > 4) {
          var fx = r0.length ? r0[0].x : W / 2;
          x = fx < W / 2 ? -S * 2 : W + S * 2; face(fx - x);
          g.visible = true; st = 'walk';
        }
      }
      if (st === 'walk') {
        var late = t > E.duration * 0.8;
        if (eaten >= target || (late && eaten > 0)) { st = 'swell'; phaseT = 0; }
        else if (late && !eaten) { st = 'leave'; }
      }
      if (st === 'walk') {
        // im Flug schnappen: fallendes Sushi genau vor dem Schnabel
        var tp = tip(), air = null;
        E.items.forEach(function (it) {
          if (air || it.gone || it.bitten || it.rest > 0 || it.bounced || it.rise) return;
          if (Math.abs(it.x - tp.x) < 34 && Math.abs(it.y - (-tp.y)) < 30) air = it;
        });
        // liegt schon eins vor dem Schnabel: sofort zuschnappen
        var near = null;
        if (!air) resting().forEach(function (it) { if (!near && Math.abs(it.x - tp.x) < 30) near = it; });
        if (air) startBite(air, true);
        else if (near) startBite(near, false);
        else {
          // Ziel: geringster Weg bis der Schnabel drüber ist (Stücke vor dem Schnabel zählen weniger als hinter ihr)
          var best = null, bd = 1e9;
          resting().forEach(function (it) { var dd = Math.min(Math.abs(it.x - tp.x), Math.abs(it.x - (x - dir * reach())) + reach() * 0.8); if (dd < bd) { bd = dd; best = it; } });
          if (best) {
            // Anlauf von der Seite, auf der sie gerade steht – Abstand = Schnabellänge (liegt es zu nah, tritt sie zurück)
            var side = x === best.x ? -dir : Math.sign(x - best.x), want = best.x + side * reach(), dx = want - x;
            if (Math.abs(dx) < 10) { face(best.x - x); startBite(best, false); }
            else { face(dx); x += Math.sign(dx) * Math.min(Math.abs(dx), speed() * dt); waddle(1); }
          } else {
            // nichts da: langsam zur Mitte schlendern und schauen
            var cx0 = W / 2 + Math.sin(t * 0.3) * 300, dx2 = cx0 - x;
            if (Math.abs(dx2) > 20) { face(dx2); x += Math.sign(dx2) * speed() * 0.4 * dt; waddle(0.6); } else waddle(0);
          }
        }
        d.rotation.z += (0 - d.rotation.z) * Math.min(1, dt * 10);
      }
      if (st === 'eat' && bite) {
        bite.t += dt; var u = Math.min(1, bite.t / bite.T), it = bite.it;
        // Kopf nicken, Schnabel auf und zu, das Stück wandert in den Schnabel und wird kleiner
        d.rotation.z = -0.45 * Math.sin(u * Math.PI) * (bite.T > 0.3 ? 1 : 0.5);
        if (lower) lower.rotation.z = -0.5 * Math.sin(Math.min(1, u * 1.3) * Math.PI);
        var tp2 = tip(), p = bite.p0.clone().lerp(tp2, smooth(0, 0.7, u));
        it.x = p.x; it.y = -p.y; it.z = p.z;
        it.g.position.copy(p); it.g.scale.setScalar(bite.s0 * (1 - smooth(0.5, 1, u)));
        if (u >= 1) {
          it.gone = true; E.scene.remove(it.g); eaten++; eatenItems++; gulp = 0.25; bite = null; st = 'walk';
          if (lower) lower.rotation.z = 0;
          if (!burped && fat() >= 0.75) { burped = true; burp = 0.45; }
        }
      }
      if (st === 'leave') {
        var out = x < W / 2 ? -S * 3 : W + S * 3; face(out - x); x += Math.sign(out - x) * speed() * dt; waddle(1);
        if (Math.abs(out - x) < 5) { g.visible = false; done = true; st = 'gone'; }
      }
      var extra = 0;
      if (st === 'swell') {
        phaseT += dt; var w = Math.min(1, phaseT / 1.4);
        extra = 0.3 * smooth(0, 1, w);
        setGlow(0.55 * w);
        d.rotation.z *= 0.9; d.position.y = 0.55;
        if (!reduce) { d.rotation.x = Math.sin(phaseT * 55) * 0.05 * w; g.position.x = x + Math.sin(phaseT * 70) * 4 * w; }
        if (lower) lower.rotation.z = 0;
        if (w >= 1) { st = 'burst'; burst(); }
      }
      if (gulp > 0) gulp = Math.max(0, gulp - dt);
      if (burp > 0) burp = Math.max(0, burp - dt);
      if (g.visible) {
        scaleNow(extra);
        if (st !== 'swell') g.position.x = x;
        g.position.y = -FLOOR; g.position.z = Z;
        if (RD.flutter) RD.flutter(d, t, 0.3, 0);
      }
      // Teilchen
      parts = parts.filter(function (p) {
        p.age += dt;
        p.vy = Math.min(p.vy + 1500 * dt, 900);
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y > FLOOR - p.h) {
          p.y = FLOOR - p.h; p.hops++;
          p.vy = p.hops < 3 ? -Math.abs(p.vy) * 0.35 : 0; p.vx *= 0.55; p.wx *= 0.5; p.wy *= 0.5; p.wz *= 0.5;
        }
        p.o.rotation.x += p.wx * dt; p.o.rotation.y += p.wy * dt; p.o.rotation.z += p.wz * dt;
        // Rand-Fade: zum Bildrand und am Lebensende schrumpfen statt hart verschwinden
        var edge = Math.min(1, Math.max(0, Math.min(p.x, W - p.x) / 90), Math.max(0, (p.y + 40) / 90));
        var k = Math.min(edge, 1 - smooth(p.life - 0.5, p.life, p.age));
        p.o.scale.copy(p.s0).multiplyScalar(Math.max(0.0001, k));
        p.o.position.set(p.x, -p.y, p.z);
        if (p.age >= p.life || (k <= 0.001 && p.age > 0.2)) { E.scene.remove(p.o); return false; }
        return true;
      });
      puffs = puffs.filter(function (q) {
        q.age += dt; var u = Math.min(1, q.age / q.life);
        q.o.scale.setScalar(10 + q.r * smooth(0, 1, u)); q.o.material.opacity = 0.85 * (1 - u);
        if (u >= 1) { E.scene.remove(q.o); return false; }
        return true;
      });
      if (st === 'burst' && !parts.length && !puffs.length) done = true;
      return !(done && !parts.length && !puffs.length);
    }
    return { step: step, hungry: function () { return st === 'wait' || st === 'walk' || st === 'eat'; } };
  }

  // ── Fahrer-Ente beim BMW-Regen: watschelt zu einem gelandeten Auto, springt durchs Fenster hinein,
  // lehnt sich mit Kopf und Schultern heraus (Rest per Clipping im Auto verborgen), Motor heult auf
  // (Wackeln, Abgaswolken) und das Auto rast mit drehenden Felgen und leicht hochgezogener Front davon.
  // E = { scene, renderer, W, FLOOR, items (live), size, reduce, outfit, duration }
  function makeDriver(E) {
    var RD = root.RubberDuck, S = E.size * 0.75, W = E.W, FLOOR = E.FLOOR, reduce = E.reduce, GROW = 2.0, CZ = 420;
    var g = new THREE.Group(), d = RD.build({ outfit: E.outfit });
    d.position.y = 0.55; g.add(d); g.visible = false; E.scene.add(g); g.scale.setScalar(S);
    // Clipping: unterhalb der Fensterlinie unsichtbar, solange sie im Auto sitzt
    E.renderer.localClippingEnabled = true;
    var clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6);
    d.traverse(function (m) {
      if (!m.isMesh) return;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach(function (mt) { if (mt) { mt.clippingPlanes = [clip]; mt.needsUpdate = true; } });
    });
    var st = 'wait', car = null, x = 0, dir = 1, cdir = 1, ph = 0, T = 0, vx = 0, puffs = [], rims = [], done = false, jump = null;
    // Abblenden der übrigen Autos: die teilen sich ihre Materialien (Lack je Farbe, Glas, Reifen …),
    // das Fahrer-Auto bekommt eigene Kopien – so trifft die Deckkraft nur die anderen.
    var dim = 1, dimMats = [], dimSeen = new Set(), dimTick = 0;
    function collectDim() {
      E.items.forEach(function (it) {
        if (it === car || !it.g) return;
        it.g.traverse(function (m) {
          if (!m.isMesh) return;
          (Array.isArray(m.material) ? m.material : [m.material]).forEach(function (mt) {
            if (!mt || dimSeen.has(mt)) return;
            dimSeen.add(mt); dimMats.push({ m: mt, t: mt.transparent, o: mt.opacity, dw: mt.depthWrite });
          });
        });
      });
    }
    function applyDim() {
      dimMats.forEach(function (r) {
        var k = r.o * dim, tr = r.t || dim < 0.999;
        if (r.m.transparent !== tr) { r.m.transparent = tr; r.m.needsUpdate = true; }
        r.m.opacity = k; r.m.depthWrite = dim > 0.95 ? r.dw : false;
      });
    }
    function ownMaterials(g2) {
      g2.traverse(function (m) { if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map(function (x) { return x.clone(); }) : m.material.clone(); });
    }
    var puffGeo = new THREE.SphereGeometry(1, 14, 10);
    function puff(px, py, pz, r, col, vxp, vyp) {
      var m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, depthWrite: false }));
      m.position.set(px, -py, pz); m.scale.setScalar(r * 0.3); E.scene.add(m);
      puffs.push({ o: m, x: px, y: py, vx: vxp || 0, vy: vyp || -20, r: r, age: 0, life: rand(0.5, 0.9) });
    }
    function face(dx) { dir = dx < 0 ? -1 : 1; g.rotation.y = dir > 0 ? -0.35 : Math.PI + 0.35; }
    function waddle(a) { ph += (E.dt || 0.016) * 11; d.rotation.x = Math.sin(ph) * 0.14 * a * (reduce ? 0.4 : 1); d.position.y = 0.55 + Math.abs(Math.sin(ph)) * 0.1 * a; }
    // Sitzplatz und Fensterlinie in Bildschirm-Koordinaten (y nach unten) aus der Lage des Autos
    function seat() {
      var sc = car.sc * car.kk;
      return { x: car.x - car.dir * car.L * 0.06 * sc, sill: car.y - car.car.belt * sc, z: car.z + car.W * 0.5 * sc + 4 };
    }
    function pick() {
      var best = null;
      E.items.forEach(function (it) {
        if (best || it.gone || it.taken || !(it.rest > 1.2) || !it.settled || it.x < 220 || it.x > W - 220) return;
        best = it;
      });
      return best;
    }
    function step(dt, t) {
      E.dt = dt;
      // übrige Autos abblenden, solange die Ente unterwegs ist, danach wieder einblenden
      var wantDim = car && (st === 'walk' || st === 'jump' || st === 'rev' || st === 'drive') ? 0.15 : 1;
      if (car && (dim !== wantDim || wantDim < 1)) {
        if (dimTick-- <= 0) { collectDim(); dimTick = 10; }   // neu gefallene Autos mit neuen Lacken
        dim += (wantDim - dim) * Math.min(1, dt * 4); if (Math.abs(dim - wantDim) < 0.01) dim = wantDim;
        applyDim();
      }
      if (done && !puffs.length && dim >= 1) return false;
      if (st === 'wait') {
        car = pick();
        if (car) {
          car.taken = true; car.kk = 1; st = 'walk'; ownMaterials(car.g);
          x = car.dir > 0 ? W + S * 3 : -S * 3;     // kommt vom näheren Bildrand, von vorn aufs Auto zu
          g.visible = true; face(car.x - x);
          car.g.traverse(function (m) { if (m.isMesh && m.geometry && m.geometry.type === 'CircleGeometry') rims.push(m); });
        } else if (t > E.duration * 0.6) { st = 'gone'; done = true; }
      }
      if (car && !car.gone) {
        // gewähltes Auto: wächst etwas (Bühne für die Ente) und kommt ganz nach vorn, Räder bleiben am Boden
        if (car.kk < GROW) car.kk = Math.min(GROW, car.kk + dt / 0.5 * (GROW - 1));
        car.z += (CZ - car.z) * Math.min(1, dt * 6);
        car.g.scale.setScalar(car.sc * car.kk);
        car.y = FLOOR - car.hh * car.kk;
        if (st === 'walk' || st === 'jump') car.g.position.set(car.x, -car.y, car.z);
      }
      if (st === 'walk') {
        var s0 = seat(), want = s0.x - car.dir * S * 0.2, dx = want - x;
        face(dx);
        if (Math.abs(dx) < 6) { st = 'jump'; jump = { t: 0, x0: x, y0: FLOOR }; face(car.dir); }
        else { x += Math.sign(dx) * Math.min(Math.abs(dx), (reduce ? 240 : 380) * dt); waddle(1); }
        g.position.set(x, -FLOOR, car.z + car.W * 0.5 * car.sc * car.kk + 30);
      }
      if (st === 'jump') {
        jump.t += dt; var u = Math.min(1, jump.t / 0.55), s1 = seat();
        // Bogen vom Boden bis zum Fenster, dann hinein bis der Hals an der Fensterlinie ist
        var feetEnd = s1.sill + 0.55 * S, hgt = 1.6 * S + 40;
        var fy = jump.y0 + (feetEnd - jump.y0) * u - Math.sin(u * Math.PI) * hgt;
        x = jump.x0 + (s1.x - jump.x0) * u;
        d.rotation.x = 0; d.position.y = 0.55;
        d.scale.set(1 - 0.15 * Math.sin(u * Math.PI), 1 + 0.12 * Math.sin(u * Math.PI), 1);
        // ab 70 % des Sprungs: alles unter der Fensterlinie unsichtbar (Welt-y = −Bildschirm-y → sichtbar wenn y ≥ −sill)
        if (u > 0.7) clip.constant = s1.sill;
        g.position.set(x, -fy, s1.z);
        if (u >= 1) { st = 'rev'; T = 0; car.bob = 0.25; }
      }
      if (st === 'rev' || st === 'drive') {
        var s2 = seat();
        // Auto federt beim Einsteigen, wackelt beim Aufheulen
        if (car.bob > 0) car.bob = Math.max(0, car.bob - dt);
        var bob = car.bob > 0 ? Math.sin((0.25 - car.bob) / 0.25 * Math.PI) * 5 : 0;
        T += dt;
        if (st === 'rev') {
          var shake = reduce ? 0 : Math.sin(T * 60) * 1.6 * Math.min(1, T * 2);
          car.g.position.set(car.x + shake, -(car.y + bob), car.z);
          if (!reduce && Math.random() < dt * 14) puff(car.x - car.dir * car.L * 0.5 * car.sc * car.kk, car.y + car.hh * car.kk * 0.6, car.z + 10, rand(12, 22), 0x8a8a90, -car.dir * rand(40, 90), -rand(10, 40));
          if (T > (reduce ? 0.4 : 1.0)) { st = 'drive'; T = 0; vx = 0; }
        } else {
          vx = Math.min(1400, vx + (reduce ? 700 : 950) * dt);
          car.x += car.dir * vx * dt;
          var lift = reduce ? 0 : Math.max(0, Math.sin(Math.min(1, T * 2.2) * Math.PI)) * 0.12;
          car.g.rotation.z = car.dir * lift;
          car.g.position.set(car.x, -(car.y + bob), car.z);
          rims.forEach(function (m) { m.rotation.z -= car.dir * vx * dt / (car.sc * car.kk * 0.35); });
          if (!reduce && Math.random() < dt * 22) puff(car.x - car.dir * car.L * 0.45 * car.sc * car.kk, car.y + car.hh * car.kk * 0.8, car.z + 10, rand(14, 26), 0xb9a98a, -car.dir * rand(20, 80), -rand(30, 70));
          if (car.x < -car.L * car.sc * car.kk || car.x > W + car.L * car.sc * car.kk) { car.gone = true; E.scene.remove(car.g); g.visible = false; st = 'gone'; done = true; }
        }
        // Ente sitzt im Auto, schaut nach vorn, wippt im Takt
        // Hals knapp über der Fensterlinie, Rest im Auto verborgen
        clip.constant = s2.sill + bob;
        var jig = st === 'rev' && !reduce ? Math.sin(T * 60) * 1.6 : 0;
        g.position.set(s2.x + jig, -(s2.sill + bob + 0.55 * S), s2.z);   // Kopf und Schultern über der Fensterlinie
        d.rotation.x = 0; d.rotation.z = st === 'drive' ? -car.dir * 0.15 : 0;   // lehnt sich im Fahrtwind zurück
        d.position.y = 0.55 + (st === 'rev' && !reduce ? Math.abs(Math.sin(T * 30)) * 0.08 : 0);
        if (RD.flutter) RD.flutter(d, t, st === 'drive' ? 1.2 + vx / 600 : 0.3, 0);
      }
      puffs = puffs.filter(function (p) {
        p.age += dt; var u = Math.min(1, p.age / p.life);
        p.x += p.vx * dt; p.y += p.vy * dt;
        // Rand-Fade: am Bildrand und am Lebensende weich weg
        var edge = Math.min(1, Math.max(0, Math.min(p.x, W - p.x) / 90));
        p.o.scale.setScalar(p.r * (0.3 + 0.9 * u)); p.o.position.set(p.x, -p.y, p.o.position.z);
        p.o.material.opacity = 0.7 * (1 - u) * edge;
        if (u >= 1) { E.scene.remove(p.o); p.o.material.dispose(); return false; }
        return true;
      });
      return !(done && !puffs.length && dim >= 1);
    }
    return { step: step, wantsCar: function () { return st === 'wait'; } };
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

    var kind = opts.kind === 'sushi' || opts.kind === 'balloon' || (opts.kind === 'car' && root.ToyCars) ? opts.kind : 'duck';
    var wantEater = kind === 'sushi' && !!opts.eater && !!root.RubberDuck;
    var wantDriver = kind === 'car' && !!opts.driver && !!root.RubberDuck;
    if ((kind === 'duck' && root.RubberDuck) || kind === 'car' || wantEater) {
      // Umgebung zum Spiegeln für das Vinyl der Gummiente bzw. den Autolack
      var ec = document.createElement('canvas'); ec.width = 512; ec.height = 256;
      var ex = ec.getContext('2d'), eg = ex.createLinearGradient(0, 0, 0, 256);
      eg.addColorStop(0, '#ffffff'); eg.addColorStop(0.45, '#c9d2dc'); eg.addColorStop(0.55, '#6a7280'); eg.addColorStop(1, '#25282e');
      ex.fillStyle = eg; ex.fillRect(0, 0, 512, 256);
      var et = new THREE.CanvasTexture(ec); et.mapping = THREE.EquirectangularReflectionMapping; et.encoding = THREE.sRGBEncoding;
      var epm = new THREE.PMREMGenerator(renderer); scene.environment = epm.fromEquirectangular(et).texture; epm.dispose();
    }
    var rise = kind === 'balloon';
    // Autos: Modell je Auto zufällig (model=mix) oder fest, Farbe aus den typischen Lacken des Modells
    var TC = root.ToyCars, carModel = TC && TC.SPEC[opts.model] ? opts.model : 'mix';
    var tpl = kind === 'car' ? { make: function () {
      var m = carModel === 'mix' ? TC.MODELS[Math.floor(Math.random() * TC.MODELS.length)] : carModel, p = TC.pickPaint(m);
      var sp = TC.SPEC[m];
      return { g: TC.build(m, p.c, p.l), len: sp.L, car: { L: sp.L, W: sp.W, hh: sp.H / 2, belt: sp.belt - sp.H / 2 } };
    } } : kind === 'sushi' ? buildSushiTemplate() : rise ? buildBalloonTemplate() : buildDuckTemplate();
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
      if (kind === 'sushi' || kind === 'car' || rise) return tpl.make();
      if (RD) {
        var o = opts.outfit === 'mix' ? RD.OUTFITS[Math.floor(Math.random() * RD.OUTFITS.length)] : (fixedOutfit || 'none');
        if (opts.mine && Math.random() < 0.34) o = opts.mine;   // Outfit des Auslösers (!outfit)
        return { g: duckOf(o, o === 'none' && Math.random() < 0.12), len: 2.7 };
      }
      return { g: Math.random() < 0.12 ? tpl.pink() : tpl.yellow(), len: 2.6 };
    }
    var size = opts.size || 96, count = opts.count || 120, duration = opts.duration || 22000;
    var spawnEnd = duration * 0.62, margin = 120;
    var ducks = [], spawned = 0, t0 = null, last = null;
    // Fress-Ente (nur Sushi, nur mit Freischaltung „sushi-eater“)
    var eater = null, EE = null;
    if (wantEater) {
      // Outfit: eater = Outfit-Name oder Chat-Name (dessen !outfit), sonst der Auslöser (by=), sonst der Kanalinhaber
      var ev = typeof opts.eater === 'string' ? opts.eater : '', vo = RD.viewerOutfit || function () { return null; };
      var eo = (ev && RD.OUTFITS.indexOf(ev) >= 0 ? ev : null) || (ev && vo(ev)) || opts.mine || (opts.owner && vo(opts.owner)) || 'none';
      EE = { scene: scene, W: W, H: H, FLOOR: FLOOR, items: ducks, size: size, reduce: reduce, outfit: eo,
             target: Math.max(3, opts.eat || 25), duration: duration / 1000, makeSushi: function () { return tpl.make(); } };
      eater = makeEater(EE);
    }
    // Fahrer-Ente (nur BMW-Regen, nur mit Freischaltung „bmw-driver“): Outfit wie bei der Fress-Ente
    var driver = null, DE = null;
    if (wantDriver) {
      var dv = typeof opts.driver === 'string' ? opts.driver : '', vo2 = RD.viewerOutfit || function () { return null; };
      var dout = (dv && RD.OUTFITS.indexOf(dv) >= 0 ? dv : null) || (dv && vo2(dv)) || opts.mine || (opts.owner && vo2(opts.owner)) || 'none';
      DE = { scene: scene, renderer: renderer, W: W, FLOOR: FLOOR, items: ducks, size: size, reduce: reduce, outfit: dout, duration: duration / 1000 };
      driver = makeDriver(DE);
    }

    function spawn() {
      var k = rand(0.8, 1.2), it = makeItem(), g = it.g;
      // jedes Teil etwa `size` groß (Ballons etwas größer)
      var sc = size * k * (rise ? 1.5 : kind === 'car' ? 2.2 : 1) / it.len;
      g.scale.set(sc, sc, sc);
      if (rise) g.rotation.set(rand(-0.15, 0.15), rand(0, 6.28), rand(-0.2, 0.2));
      else if (kind === 'car') g.rotation.set(rand(-0.35, 0.35), rand(0, 6.28), rand(-0.3, 0.3));   // Autos eher waagrecht: Seite und Front bleiben lesbar
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
      var cs = it.car ? { L: it.car.L, W: it.car.W, hh: it.car.hh * sc, belt: it.car.belt } : null;
      ducks.push({ g: g, sc: sc, car: cs, L: cs && cs.L, W: cs && cs.W, hh: cs && cs.hh, x: rand(margin, W - margin), y: rand(-200, -80), vx: rand(-30, 30), vy: rand(60, 160),
                   wx: reduce ? 0 : rand(-2.2, 2.2) * (kind === 'car' ? 0.15 : 1), wy: reduce ? 0 : rand(-2.6, 2.6) * (kind === 'car' ? 0.6 : 1), wz: reduce ? 0 : rand(-2.2, 2.2) * (kind === 'car' ? 0.2 : 1),
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
      var hungry = (!!eater && eater.hungry()) || (!!driver && driver.wantsCar());
      ducks = ducks.filter(function (d) {
        if (d.gone) return false;
        if (d.bitten) return true;   // die Ente zieht es gerade in den Schnabel
        if (d.taken) return true;    // die Fahrer-Ente hat das Auto übernommen
        if (d.rest != null) {
          // liegt am Boden und wartet aufs Gefressenwerden; ist die Ente satt oder die Zeit um, kippt es weg
          d.rest -= dt;
          if (d.q1 && !d.settled) {
            // Auto setzt sich auf die Räder, Front zum nächsten Bildrand
            d.st = Math.min(1, (d.st || 0) + dt / 0.45);
            d.g.quaternion.copy(d.q0).slerp(d.q1, smooth(0, 1, d.st));
            if (d.st >= 1) d.settled = true;
          }
          if (d.rest <= 0 || !hungry) { d.rest = null; d.bounced = true; d.vy = 40; d.vx = 0; }
          else { d.g.position.set(d.x, -d.y, d.z); return true; }
        }
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
        if (d.sit > 0) {
          // sitzt aufrecht am unteren Rand: Kippen klingt aus, nur der Umhang weht noch leicht
          d.sit -= dt;
          var damp = Math.exp(-dt * 10);
          d.g.rotation.x *= damp; d.g.rotation.z *= damp; d.g.rotation.y += d.wy * 0.15 * dt;
          if (RD && RD.flutter) RD.flutter(d.g, t / 1000, 0.35, d.ph);
          d.g.position.set(d.x, -d.y, d.z);
          if (d.sit <= 0) { d.bounced = true; d.vy = 40; d.vx = 0; d.wx = d.wy = d.wz = 0; }  // danach nach hinten weg
          return true;
        }
        d.vy = Math.min(d.vy + 900 * dt, 760);
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (kind === 'duck' && RD && !d.bounced && d.sit == null && d.y > FLOOR - d.sc * 1.1) {
          // landet sie etwa aufrecht, bleibt sie kurz sitzen
          var up = new THREE.Vector3(0, 1, 0).applyQuaternion(d.g.quaternion);
          d.sit = up.y > 0.55 ? rand(1.2, 2.0) : 0;
          if (d.sit > 0) {
            d.y = FLOOR - d.sc * 1.1; d.vy = 0;
            d.g.rotation.order = 'YXZ'; d.g.rotation.setFromQuaternion(d.g.quaternion, 'YXZ');
            d.ph = d.ph || Math.random() * 6.28;
            return true;
          }
        }
        if (!d.bounced && d.y > FLOOR - d.h) {
          if (hungry && d.hop) {
            // Fress-Ente unterwegs: nach dem Aufditschen liegen bleiben
            d.y = FLOOR - d.h; d.vy = 0; d.vx = 0; d.wx = d.wy = d.wz = 0; d.rest = rand(5, 8);
            if (d.car) {
              d.y = FLOOR - d.hh; d.rest = rand(4, 7); d.dir = d.x < W / 2 ? -1 : 1;
              d.q0 = d.g.quaternion.clone(); d.q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, d.dir > 0 ? -0.25 : Math.PI + 0.25, 0));
              d.z = Math.min(d.z, 150);   // vor den fallenden Autos, hinter der Ente
            }
            d.g.position.set(d.x, -d.y, d.z);
            return true;
          }
          if (hungry) d.hop = true; else d.bounced = true;
          d.y = FLOOR - d.h;
          d.vy = -d.vy * rand(0.25, 0.4); d.vx *= 0.6; d.wx *= 0.5; d.wy *= 0.5; d.wz *= 0.5;
        }
        // nach dem Aufditschen kippt es nach hinten: etwas kleiner, hinter die
        // fallenden Teile, und fällt unten aus dem Bild
        if (d.bounced) d.back = Math.min(1, d.back + dt / 0.7);
        if (d.y > H + d.h * 2) { remove(d); return false; }
        d.g.rotation.x += d.wx * dt; d.g.rotation.y += d.wy * dt; d.g.rotation.z += d.wz * dt;
        // Umhang flattert im Fahrtwind: je schneller, desto mehr
        if (RD && RD.flutter && kind === 'duck') RD.flutter(d.g, t / 1000, 0.9 + 1.6 * Math.min(1, Math.abs(d.vy) / 600), d.ph || (d.ph = Math.random() * 6.28));
        var s = d.sc * (1 - 0.22 * d.back);
        d.g.scale.set(s, s, s);
        d.g.position.set(d.x, -d.y, d.z - 600 * d.back);
        return true;
      });
      var eating = false;
      if (eater) { EE.items = ducks; eating = eater.step(dt, t / 1000); }
      if (driver) { DE.items = ducks; eating = driver.step(dt, t / 1000) || eating; }
      renderer.render(scene, cam);
      if (t < duration || ducks.length || eating) requestAnimationFrame(frame);
      else renderer.clear();
    }
    requestAnimationFrame(frame);
  }

  // Bauteile der Ente auch für andere Effekte (js/knife-duck.js, tools/duck-viewer.html)
  root.ItemRain3D = { start: start, duckBody: bodyGeometry, ellipsoid: ellipsoid, duckTemplate: buildDuckTemplate };
})(typeof window !== 'undefined' ? window : this);
