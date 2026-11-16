/* Spielzeugautos im Stil klassischer BMW-Modelle für den Party-Regen (effects/item-rain.html?kind=car),
 * three.js r128. Maße nach den Vorbildern (L × B × H, Radstand in m), Räder etwas größer wie bei
 * Spielzeugautos. Kein Markenlogo, kein Schriftzug – erkennbar an Form, Front und Lichtern.
 *
 *   2002  (1966–77) rundlich, runde Einzelscheinwerfer im schwarzen Grill, Chromstoßstangen
 *   e30   (1982–94) kantig, je zwei runde Scheinwerfer, schmale Doppelniere, Chromstoßstangen
 *   e30m3            dazu Frontlippe, hoher Heckflügel, breitere Spur
 *   e36   (1990–2000) Keil, Doppelscheinwerfer unter Glas
 *   e46   (1998–2006) rundlicher, Leuchtringe („Angel Eyes“), breitere Niere
 *   e92m3 (2007–13) Powerdome auf der Haube, vier Endrohre
 * Überall: Hofmeister-Knick am hinteren Ende des Seitenfensters.
 *
 *   ToyCars.build(model, colorHex) → THREE.Group (Mitte im Auto, Länge in x, ~4,4 Einheiten)
 *   ToyCars.MODELS, ToyCars.COLORS[model] (typische Lacke)
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  // Seitenprofil-Kennzahlen je Modell (m): L, W, H, wb Radstand, fo Überhang vorn, r Radradius (Spielzeug),
  // nose Höhe Front oben, cowl Höhe am Windschutzscheibenfuß, belt Gürtellinie hinten, deck Kofferraum,
  // ws/rs Länge Windschutz-/Heckscheibe (waagrecht), roofF/roofR Dachkanten (Anteil von L ab hinten),
  // slant Neigung der Front, tumble Einzug der Fahrgastzelle oben
  var SPEC = {
    '2002':  { L: 4.23, W: 1.59, H: 1.41, wb: 2.50, fo: 0.78, r: 0.33, nose: 0.74, cowl: 0.86, belt: 0.86, deck: 0.84, ws: 0.42, rs: 0.40, roofF: 0.62, roofR: 0.33, slant: 0.02, tumble: 0.16, chrome: true , round: 0.1 },
    e30:     { L: 4.32, W: 1.65, H: 1.38, wb: 2.57, fo: 0.80, r: 0.34, nose: 0.76, cowl: 0.88, belt: 0.90, deck: 0.90, ws: 0.52, rs: 0.40, roofF: 0.6, roofR: 0.31, slant: 0.0, tumble: 0.14, chrome: true },
    e30m3:   { L: 4.35, W: 1.68, H: 1.37, wb: 2.56, fo: 0.82, r: 0.35, nose: 0.74, cowl: 0.87, belt: 0.90, deck: 0.92, ws: 0.54, rs: 0.36, roofF: 0.6, roofR: 0.32, slant: 0.0, tumble: 0.14, wing: true, lip: true, wide: 0.05 },
    e36:     { L: 4.43, W: 1.71, H: 1.34, wb: 2.70, fo: 0.83, r: 0.35, nose: 0.66, cowl: 0.86, belt: 0.92, deck: 0.92, ws: 0.70, rs: 0.52, roofF: 0.6, roofR: 0.3, slant: 0.1, tumble: 0.17, lip: true , round: 0.1 },
    e46:     { L: 4.49, W: 1.76, H: 1.37, wb: 2.73, fo: 0.85, r: 0.36, nose: 0.68, cowl: 0.88, belt: 0.94, deck: 0.95, ws: 0.72, rs: 0.55, roofF: 0.6, roofR: 0.3, slant: 0.12, tumble: 0.18, rings: true , round: 0.13 },
    e92m3:   { L: 4.62, W: 1.80, H: 1.42, wb: 2.76, fo: 0.90, r: 0.38, nose: 0.70, cowl: 0.92, belt: 1.0, deck: 1.0, ws: 0.76, rs: 0.6, roofF: 0.6, roofR: 0.29, slant: 0.14, tumble: 0.2, dome: true, quad: true, rings: true, lip: true , round: 0.12 }
  };
  var MODELS = Object.keys(SPEC);
  var COLORS = {
    '2002': [0xe8742a, 0xd9cfae, 0x2f5d8a, 0xb8bcc2],               // Inka, Chamonix, Fjord, Polaris
    e30: [0xf2f2ee, 0xa8141c, 0x15161a, 0x1d3e7a],                  // Alpinweiß, Henna, Diamantschwarz, Royalblau
    e30m3: [0xf2f2ee, 0xc8151b, 0x2a2c30],                          // Alpinweiß, Brillantrot, Schwarz
    e36: [0xe6c21a, 0x2b3f8f, 0x1d2a6e, 0xf2f2ee],                  // Dakar, Estoril, Le Mans, Alpinweiß
    e46: [0x2f7fc8, 0xb3121a, 0xe5b52a, 0xb8bcc2],                  // Laguna Seca, Imola, Phoenix, Silbergrau
    e92m3: [0x8a1018, 0x1d3e8a, 0x15161a, 0xd8dade]                 // Melbourne, Interlagos, Jerez, Alpinweiß
  };

  function col(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  var MAT = {};
  function mats() {
    if (MAT.glass) return MAT;
    var phys = function (o) { var m = new THREE.MeshPhysicalMaterial(o); if (o.color != null) m.color.convertSRGBToLinear(); return m; };
    MAT.glass = phys({ color: 0x1a222c, roughness: 0.05, metalness: 0.3, clearcoat: 1, envMapIntensity: 1.4, side: THREE.DoubleSide });
    MAT.chrome = phys({ color: 0xe6e9ee, roughness: 0.12, metalness: 1, envMapIntensity: 1.3 });
    MAT.black = phys({ color: 0x141518, roughness: 0.55 });
    MAT.tire = phys({ color: 0x18191b, roughness: 0.85 });
    MAT.lamp = new THREE.MeshBasicMaterial({ color: col(0xfff6dc) });
    MAT.ring = new THREE.MeshBasicMaterial({ color: col(0xdff2ff) });
    MAT.tail = phys({ color: 0xc8101e, roughness: 0.2, clearcoat: 1, emissive: 0x3a0005 });
    MAT.amber = phys({ color: 0xf29a1e, roughness: 0.2, clearcoat: 1 });
    MAT.plate = phys({ color: 0xf4f4f0, roughness: 0.5 });
    return MAT;
  }
  // Felgen als Textur: cross (Kreuzspeiche), star (Sternspeiche), steel (Stahlfelge mit Kappe)
  var RIMS = {};
  function rimMat(style) {
    if (RIMS[style]) return RIMS[style];
    var t = canvasTex(256, 256, function (x, w) {
      var c = w / 2;
      x.fillStyle = '#1a1b1e'; x.beginPath(); x.arc(c, c, 126, 0, Math.PI * 2); x.fill();
      x.fillStyle = style === 'steel' ? '#c9ccd2' : '#d6d9de'; x.beginPath(); x.arc(c, c, 112, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2a2c30';
      if (style === 'cross') {
        x.beginPath(); x.arc(c, c, 100, 0, Math.PI * 2); x.fill();
        x.strokeStyle = '#d6d9de'; x.lineWidth = 7;
        for (var i = 0; i < 16; i++) { var a = i / 16 * Math.PI * 2; x.beginPath(); x.moveTo(c + Math.cos(a) * 30, c + Math.sin(a) * 30); x.lineTo(c + Math.cos(a + 0.6) * 102, c + Math.sin(a + 0.6) * 102); x.stroke(); x.beginPath(); x.moveTo(c + Math.cos(a) * 30, c + Math.sin(a) * 30); x.lineTo(c + Math.cos(a - 0.6) * 102, c + Math.sin(a - 0.6) * 102); x.stroke(); }
      } else if (style === 'star') {
        for (var k = 0; k < 5; k++) { x.save(); x.translate(c, c); x.rotate(k / 5 * Math.PI * 2); x.beginPath(); x.moveTo(-26, -20); x.lineTo(-48, -100); x.lineTo(48, -100); x.lineTo(26, -20); x.closePath(); x.fill(); x.restore(); }
      } else {
        for (var j = 0; j < 8; j++) { var b = j / 8 * Math.PI * 2; x.beginPath(); x.ellipse(c + Math.cos(b) * 70, c + Math.sin(b) * 70, 12, 18, b, 0, Math.PI * 2); x.fill(); }
      }
      x.fillStyle = '#e6e9ee'; x.beginPath(); x.arc(c, c, 26, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#9aa0a8'; x.beginPath(); x.arc(c, c, 12, 0, Math.PI * 2); x.fill();
    });
    return (RIMS[style] = new THREE.MeshStandardMaterial({ map: t, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }));
  }

  // ── Karosserie ──
  // Seitenprofil unten: Boden mit Radläufen, Front, Haube, Gürtellinie, Kofferraum, Heck (x 0 = Heck)
  function lowerShape(s) {
    var L = s.L, ro = L - s.wb - s.fo, xr = ro, xf = ro + s.wb, gc = 0.16, ar = s.r + 0.05;
    var sh = new THREE.Shape();
    sh.moveTo(0.06, gc + 0.04);
    sh.lineTo(xr - ar, gc);
    sh.lineTo(xr - ar, s.r);
    sh.absarc(xr, s.r, ar, Math.PI, 0, true);
    sh.lineTo(xr + ar, gc);                                           // Unterboden waagrecht zwischen den Radläufen
    sh.lineTo(xf - ar, gc);
    sh.lineTo(xf - ar, s.r);
    sh.absarc(xf, s.r, ar, Math.PI, 0, true);
    sh.lineTo(xf + ar, gc);
    sh.lineTo(L - 0.08, gc);
    sh.quadraticCurveTo(L, gc + 0.02, L, gc + 0.14);
    sh.lineTo(L - s.slant, s.nose);                                   // Front
    var xc = xf - 0.25 - s.ws * 0.2;                                  // Windschutzscheibenfuß
    sh.quadraticCurveTo(L - s.slant - 0.1, s.nose + 0.04, L - s.slant - 0.35, s.nose + 0.06);
    sh.lineTo(xc, s.cowl);                                            // Haube
    var xd = L * s.roofR - s.rs * 0.75;                               // Heckscheibenfuß
    sh.lineTo(xd, s.belt);                                            // Gürtellinie
    sh.lineTo(0.3, s.deck);                                           // Kofferraumdeckel
    sh.quadraticCurveTo(0.02, s.deck, 0.02, s.deck - 0.12);
    sh.lineTo(0, gc + 0.12);                                          // Heck
    sh.closePath();
    return { shape: sh, xr: xr, xf: xf, xc: xc, xd: xd };
  }
  // Fahrgastzelle: Windschutzscheibe, Dach, Heckscheibe (Seitenprofil)
  function cabinPts(s, lo) {
    var L = s.L, yb = Math.max(s.cowl, s.belt) - 0.02;
    return [[lo.xc + 0.02, yb], [L * s.roofF + 0.02, s.H], [L * s.roofR, s.H], [lo.xd, yb]];
  }
  // Seiten der Fahrgastzelle als Textur: Lack (weiß, wird mit der Lackfarbe multipliziert), Fenster dunkel,
  // B-Säule, Hofmeister-Knick hinten unten. UV der Extrusion = Profil-Koordinaten in m
  function cabinSideTex(s, cp) {
    var W = 1024, Hh = 512, L = s.L, H = s.H;
    function X(x) { return x / L * W; } function Y(y) { return (1 - y / H) * Hh; }
    var t = canvasTex(W, Hh, function (x) {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, Hh);
      var yb = cp[0][1] + 0.05, yt = H - 0.07;
      var fA = [cp[0][0] - 0.05, yb], fT = [cp[1][0] - 0.05, yt], rT = [cp[2][0] + 0.06, yt];
      // Hofmeister-Knick: die hintere Fensterkante läuft nach hinten unten und knickt kurz vor der
      // Gürtellinie deutlich nach vorn
      var kink = [cp[3][0] + 0.12, yb + 0.2];
      var bx = (fA[0] + kink[0]) / 2 + 0.05;
      function poly(p) { x.beginPath(); p.forEach(function (q, i) { (i ? x.lineTo : x.moveTo).call(x, X(q[0]), Y(q[1])); }); x.closePath(); }
      x.fillStyle = '#c8ccd2';                                        // Chrom-/Gummirahmen
      poly([fA, fT, rT, [kink[0] - 0.04, kink[1] + 0.02], [kink[0] + 0.34, yb - 0.02], [fA[0], yb - 0.02]]); x.fill();
      x.fillStyle = '#12161c';
      poly([[fA[0] - 0.02, yb + 0.01], [fT[0] - 0.02, yt - 0.03], [bx + 0.05, yt - 0.03], [bx + 0.05, yb + 0.01]]); x.fill();
      poly([[bx - 0.05, yb + 0.01], [bx - 0.05, yt - 0.03], [rT[0] + 0.02, yt - 0.03], [kink[0], kink[1]], [kink[0] + 0.3, yb + 0.01]]); x.fill();
    });
    t.repeat.set(1 / L, 1 / H);
    return t;
  }
  // Seiten unten: Türfugen, Schutzleiste, Griffe, Blinker vorn
  function lowerSideTex(s, lo) {
    var W = 1024, Hh = 256, L = s.L, H = s.H;
    function X(x) { return x / L * W; } function Y(y) { return (1 - y / H) * Hh * (H / H); }
    var t = canvasTex(W, Hh * 2, function (x, w, h) {
      function YY(y) { return (1 - y / H) * h; }
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 3;
      var d0 = lo.xc - 0.05, d1 = lo.xd + 0.25;
      x.beginPath(); x.moveTo(X(d0), YY(s.cowl - 0.02)); x.lineTo(X(d0), YY(0.24)); x.moveTo(X(d1), YY(s.belt - 0.02)); x.lineTo(X(d1), YY(0.24)); x.stroke();
      x.fillStyle = s.chrome ? '#b9bec6' : '#2a2c30'; x.fillRect(X(0.25), YY(0.5), X(L - 0.5), 10);   // Schutzleiste
      x.fillStyle = '#5a5e66'; x.fillRect(X(d1 + 0.18), YY(s.belt - 0.1), 26, 7);                 // Türgriff
      x.fillStyle = '#f29a1e'; x.fillRect(X(lo.xf + 0.42), YY(0.6), 14, 8);                        // Seitenblinker
    });
    t.repeat.set(1 / L, 1 / H);
    return t;
  }

  function add(g, geo, mat, x, y, z, rx, ry, rz) { var m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0); g.add(m); return m; }
  function rbox(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

  var CACHE = {};
  function build(model, color) {
    var s = SPEC[model] || SPEC.e30, M = mats(), key = model + ':' + color;
    if (CACHE[key]) return CACHE[key].clone();
    var paint = new THREE.MeshPhysicalMaterial({ color: col(color), metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 });
    var car = new THREE.Group(), body = new THREE.Group(); car.add(body);
    var W = s.W + (s.wide || 0), bev = s.round || 0.07;
    var lo = lowerShape(s);
    // Unterteil: Seiten mit Fugen-Textur, Rest Lack
    var lg = new THREE.ExtrudeGeometry(lo.shape, { depth: W - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 20 });
    lg.translate(0, 0, -(W - 2 * bev) / 2);
    var sideLo = paint.clone(); sideLo.map = lowerSideTex(s, lo);
    add(body, lg, [sideLo, paint]);
    // Fahrgastzelle: oben eingezogen (Tumblehome)
    var cp = cabinPts(s, lo), csh = new THREE.Shape();
    cp.forEach(function (p, i) { if (i) csh.lineTo(p[0], p[1]); else csh.moveTo(p[0], p[1]); });
    var cw = W * 0.86, cg = new THREE.ExtrudeGeometry(csh, { depth: cw - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
    cg.translate(0, 0, -(cw - 0.08) / 2);
    (function () { var p = cg.attributes.position, yb = cp[0][1]; for (var i = 0; i < p.count; i++) { var k = Math.max(0, (p.getY(i) - yb) / (s.H - yb)); p.setZ(i, p.getZ(i) * (1 - s.tumble * k)); } cg.computeVertexNormals(); })();
    var sideCab = paint.clone(); sideCab.map = cabinSideTex(s, cp);
    add(body, cg, [sideCab, paint]);
    // Windschutz- und Heckscheibe als Glasflächen auf den Schrägen
    // Fläche entlang a→b (Länge) und quer (z); Normale = (a→b) × z zeigt bei dieser Reihenfolge nach außen
    function pane(a, b, wid) {
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      var u = new THREE.Vector3(dx / len, dy / len, 0), v = new THREE.Vector3(0, 0, 1), n = new THREE.Vector3().crossVectors(u, v);
      var m = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.9, wid), M.glass);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
      m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0).addScaledVector(n, 0.05);
      body.add(m); return m;
    }
    var mw = cw * (1 - s.tumble * 0.5) - 0.14;
    pane(cp[0], cp[1], mw); pane(cp[2], cp[3], mw);

    // ── Front (x = L) ──
    var L = s.L, fx = L + bev + 0.012 - s.slant * 0.5, yl = s.nose - 0.17;
    var front = new THREE.Group(); front.position.set(fx, 0, 0); front.rotation.y = Math.PI / 2; body.add(front);   // lokal: x quer, y hoch, +z nach vorn
    var kw = model === 'e46' || model === 'e92m3' ? 0.2 : model === '2002' ? 0.13 : 0.14, kh = model === 'e46' || model === 'e92m3' ? 0.2 : 0.24;
    if (model === '2002' || model === 'e30' || model === 'e30m3') add(front, rbox(W - 0.3, 0.2, 0.02), M.black, 0, yl, 0.0);          // schwarzer Grill quer
    [-1, 1].forEach(function (sd) {
      // Doppelniere: Chromrahmen, schwarzes Gitter
      add(front, rbox(kw + 0.04, kh + 0.04, 0.03), M.chrome, sd * (kw / 2 + 0.03), yl + 0.02, 0.01);
      add(front, rbox(kw, kh, 0.04), M.black, sd * (kw / 2 + 0.03), yl + 0.02, 0.012);
      var ex = W / 2 - 0.28;
      if (model === '2002') add(front, new THREE.CircleGeometry(0.1, 24), M.lamp, sd * ex, yl, 0.02);
      else if (model === 'e30' || model === 'e30m3') [0, 1].forEach(function (k) { add(front, new THREE.CircleGeometry(0.075, 24), M.lamp, sd * (ex - 0.06 + k * 0.17 - 0.08), yl, 0.02); });
      else {
        // Scheinwerfer unter Glas, bei E46/E92 mit Leuchtringen
        add(front, rbox(0.42, 0.15, 0.03), M.glass, sd * (ex - 0.06), yl + 0.01, 0.01);
        [0, 1].forEach(function (k) {
          var cx = sd * (ex - 0.06 + (k ? 0.1 : -0.1) * sd);
          add(front, new THREE.CircleGeometry(0.055, 20), M.lamp, cx, yl + 0.01, 0.03);
          if (s.rings) add(front, new THREE.TorusGeometry(0.068, 0.009, 8, 32), M.ring, cx, yl + 0.01, 0.035);
        });
      }
      add(front, rbox(0.12, 0.05, 0.02), M.amber, sd * (W / 2 - 0.18), 0.36, 0.02);                // Blinker unten
    });
    add(front, rbox(0.42, 0.11, 0.02), M.plate, 0, 0.3, 0.06);                                   // Kennzeichenfeld (leer)
    if (s.chrome) add(front, rbox(W + 0.04, 0.08, 0.1), M.chrome, 0, 0.42, 0.05);               // Chromstoßstange
    else add(front, rbox(W + 0.02, 0.16, 0.08), M.black, 0, 0.24, 0.03);
    if (s.lip) add(front, rbox(W - 0.1, 0.05, 0.18), M.black, 0, 0.19, 0.02);                    // Frontlippe
    // ── Heck (x = 0) ──
    var rear = new THREE.Group(); rear.position.set(-bev - 0.012, 0, 0); rear.rotation.y = -Math.PI / 2; body.add(rear);
    var yt = s.deck - 0.2;
    [-1, 1].forEach(function (sd) {
      if (model === '2002') add(rear, new THREE.CircleGeometry(0.075, 20), M.tail, sd * (W / 2 - 0.22), yt, 0.02);
      else if (model === 'e30' || model === 'e30m3') { add(rear, rbox(0.46, 0.16, 0.02), M.tail, sd * (W / 2 - 0.3), yt, 0.01); add(rear, rbox(0.14, 0.16, 0.025), M.amber, sd * (W / 2 - 0.62), yt, 0.012); }
      else add(rear, rbox(0.4, 0.13, 0.02), M.tail, sd * (W / 2 - 0.28), yt + 0.02, 0.01);
    });
    add(rear, rbox(0.42, 0.11, 0.02), M.plate, 0, yt - 0.06, 0.01);
    if (s.chrome) add(rear, rbox(W + 0.04, 0.08, 0.1), M.chrome, 0, 0.42, 0.05);
    else add(rear, rbox(W + 0.02, 0.18, 0.06), M.black, 0, 0.27, 0.02);
    (s.quad ? [-0.5, -0.36, 0.36, 0.5] : [-0.45]).forEach(function (ex) { add(rear, new THREE.CylinderGeometry(0.045, 0.045, 0.12, 14), M.chrome, ex * (W / 1.76), 0.22, 0.03, Math.PI / 2); });
    // Extras
    if (s.wing) {
      add(body, rbox(0.26, 0.035, W - 0.12), paint, 0.16, s.deck + 0.17, 0, 0, 0, 0.12);
      [-1, 1].forEach(function (sd) { add(body, rbox(0.14, 0.14, 0.03), paint, 0.2, s.deck + 0.09, sd * (W / 2 - 0.3)); });
    }
    if (s.dome) add(body, rbox(0.9, 0.04, 0.42), paint, lo.xf - 0.1, s.nose + 0.14, 0, 0, 0, 0.12);
    // Spiegel
    [-1, 1].forEach(function (sd) { add(body, rbox(0.08, 0.08, 0.14), paint, lo.xc + 0.05, s.cowl + 0.08, sd * (W / 2 + 0.02)); });
    // ── Räder ──
    var rs = model === '2002' ? 'steel' : model === 'e30' ? 'cross' : 'star', rm = rimMat(rs), tw = 0.25;
    [lo.xr, lo.xf].forEach(function (wx) {
      [-1, 1].forEach(function (sd) {
        var wz = sd * (W / 2 - tw / 2 + 0.04);
        add(body, new THREE.CylinderGeometry(s.r, s.r, tw, 28), M.tire, wx, s.r, wz, Math.PI / 2);
        add(body, new THREE.CircleGeometry(s.r * 0.7, 28), rm, wx, s.r, wz + sd * (tw / 2 + 0.003), 0, sd > 0 ? 0 : Math.PI, 0);
      });
    });
    // Mitte des Autos in den Ursprung
    body.position.set(-L / 2, -s.H / 2, 0);
    CACHE[key] = car;
    return car.clone();
  }

  function random() {
    var m = MODELS[Math.floor(Math.random() * MODELS.length)], c = COLORS[m];
    return { model: m, color: c[Math.floor(Math.random() * c.length)] };
  }

  root.ToyCars = { build: build, MODELS: MODELS, COLORS: COLORS, SPEC: SPEC, random: random };
})(typeof window !== 'undefined' ? window : this);
