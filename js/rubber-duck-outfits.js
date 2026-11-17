/* Weitere Outfits für die Gummiente (js/rubber-duck.js): Helden, Horror, Berufe,
 * Spaß und Berühmtheiten. Nach js/rubber-duck.js laden. Jedes Outfit nutzt die
 * Zonen des Körper-Shaders (Haut, Anzug, Muster, Maske, Haar, Gesicht, Emblem)
 * und Zubehör aus ACC (Hüte, Haare, Brillen, Requisiten).
 * Modell-Koordinaten: Schnabel zeigt nach +x, Kopfmitte HC ≈ (0.5, 1.05, 0),
 * Kopfradien HR ≈ (0.62, 0.6, 0.6), Flügel bei z ≈ ±0.79, Boden bei y = -0.55.
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, RD = root.RubberDuck;
  if (!THREE || !RD) return;
  var U = RD.util, V3 = THREE.Vector3, ACC = RD.ACC, EMB = RD.EMBLEMS, ell = U.ell, PI = Math.PI;

  // ── Materialien ──
  function M(hex, o) { return U.vinyl(hex, o); }
  function fabric(hex, o) { return U.vinyl(hex, Object.assign({ roughness: 0.85, clearcoat: 0, envMapIntensity: 0.25 }, o || {})); }
  function metal(hex, o) { return U.vinyl(hex, Object.assign({ metalness: 0.8, roughness: 0.28, clearcoat: 0.3, envMapIntensity: 1.1 }, o || {})); }
  function glow(hex) { var m = new THREE.MeshBasicMaterial({ color: hex }); m.color.convertSRGBToLinear(); return m; }
  function glass(hex, op) { return U.vinyl(hex, { transparent: true, opacity: op, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.4, depthWrite: false }); }
  function dbl(m) { m.side = THREE.DoubleSide; return m; }

  // ── Formen ──
  function add(parent, geo, mat, x, y, z, rx, ry, rz) {
    var m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m); return m;
  }
  function sph(r, seg) { return new THREE.SphereGeometry(r, seg || 32, Math.round((seg || 32) * 0.6)); }
  function dome(theta) { return new THREE.SphereGeometry(1, 48, 20, 0, PI * 2, 0, theta || PI / 2); }
  function cyl(rt, rb, h, seg, open, t0, tl) { return new THREE.CylinderGeometry(rt, rb, h, seg || 40, 1, !!open, t0 || 0, tl || PI * 2); }
  function cone(r, h, seg) { return new THREE.ConeGeometry(r, h, seg || 32); }
  function torus(R, r, seg, arc) { return new THREE.TorusGeometry(R, r, 12, seg || 48, arc || PI * 2); }
  function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
  function lathe(pts, seg) { return new THREE.LatheGeometry(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), seg || 48); }
  function r4(v) { return Math.round(v * 1e4) / 1e4; }
  // weicher Schlauch durch Punkte; als Grundform „hose“ markiert → im Duck-Editor über Knickpunkte formbar
  function tube(pts, r, mat, parent, closed) {
    var vs = pts.map(function (p) { return p instanceof V3 ? p : new V3(p[0], p[1], p[2]); });
    var curve = new THREE.CatmullRomCurve3(vs, !!closed);
    var m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, pts.length * 12), r, 10, !!closed), mat);
    m.userData.prim = { t: 'hose', p: { r: r, taper: 1, spline: true, closed: !!closed, rad: 10, pts: vs.map(function (v) { return [r4(v.x), r4(v.y), r4(v.z)]; }) } };
    parent.add(m); return m;
  }
  // Mesh entlang einer Richtung ausrichten (lokale +y-Achse → dir)
  function along(m, dir) { m.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.clone().normalize()); return m; }
  // flaches Teil mit der Fläche (lokal +z) nach n ausrichten
  function facing(m, p, n) { m.position.copy(p); m.lookAt(p.clone().add(n)); return m; }

  // ── Bezugspunkte ──
  // Gruppe auf dem Kopf: Ursprung auf Höhe HC.y + dy (Hutrand), userData.r = Kopfradius dort
  function hatBase(c, dy, tilt, dx) {
    var r = c.HR[0] * Math.sqrt(Math.max(0.12, 1 - Math.pow(dy / c.HR[1], 2))) + 0.02;
    var gr = new THREE.Group(); gr.position.set(c.HC.x - 0.03 + (dx || 0), c.HC.y + dy, 0);
    gr.rotation.z = tilt == null ? 0.12 : tilt; gr.scale.set(1, 1, c.HR[2] / c.HR[0]);
    gr.userData.r = r; c.g.add(gr); return gr;
  }
  function eyeDir(s) { return new V3(0.8, 0.36, s * 0.5).normalize(); }
  function eyeAt(c, s, rad) { return c.headPoint(eyeDir(s), rad || 1.07); }
  function neck(y, phi) { return U.surfaceAt(y, phi, 0.42); }
  function front(y, z) { return U.surface(new V3(1, y, z || 0)); }
  // Punkt + Normale auf dem Kopf in Richtung dir
  function onHead(c, dir, rad) {
    var d = dir.clone().normalize();
    return { p: c.headPoint(d, rad || 1), n: new V3(d.x / c.HR[0], d.y / c.HR[1], d.z / c.HR[2]).normalize() };
  }
  // flaches Band entlang der Vorderseite (Krawatte, Schal-Enden): ys von oben nach unten, Breite je Punkt
  function frontRibbon(c, ys, ws, mat, zc) {
    var pos = [], idx = [];
    ys.forEach(function (y, i) {
      var a = front(y, zc || 0), side = new V3(0, 0, 1);
      var p0 = a.p.clone().addScaledVector(a.n, 0.018);
      pos.push(p0.x, p0.y, p0.z - ws[i], p0.x, p0.y, p0.z + ws[i]);
      if (i) { var k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    var m = new THREE.Mesh(g, dbl(mat)); c.g.add(m); return m;
  }
  function stripesTex(c1, c2, n, vertical) {
    return U.canvasTex(256, 256, function (x, w, h) {
      for (var i = 0; i < n; i++) { x.fillStyle = i % 2 ? c2 : c1; if (vertical) x.fillRect(i * w / n, 0, w / n + 1, h); else x.fillRect(0, i * h / n, w, h / n + 1); }
    });
  }

  // ════════ Hüte & Helme ════════
  ACC.witch = function (c, a) {
    var h = hatBase(c, 0.34, 0.18), r = h.userData.r, m = dbl(fabric(a.color || 0x231a2e));
    add(h, cyl(r + 0.4, r + 0.4, 0.025, 64), m, 0, 0.012);
    add(h, cyl(r * 0.6, r * 0.92, 0.42, 48), m, 0, 0.21);
    var pv = new THREE.Group(); pv.position.set(0, 0.41, 0); pv.rotation.z = 0.55; h.add(pv);
    add(pv, cone(r * 0.6, 0.6, 48), m, 0, 0.29);
    add(h, cyl(r * 0.9, r * 0.92, 0.1, 48), fabric(a.band || 0x6b2fa0), 0, 0.07);
    add(h, box(0.03, 0.11, 0.14), metal(0xd9b23a), r * 0.91, 0.07, 0);
  };
  ACC.tricorn = function (c, a) {
    var h = hatBase(c, 0.32, 0.1), r = h.userData.r, m = dbl(fabric(a.color || 0x1b1714, { roughness: 0.7 }));
    var d = add(h, dome(), m); d.scale.set(r * 1.02, 0.34, r * 1.02);
    var brim = add(h, cyl(r + 0.34, r + 0.02, 0.3, 3, true), m, 0, 0.13); brim.rotation.y = PI / 2;
    var sk = add(h, new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: U.canvasTex(128, 128, function (x) { drawSkull(x, 64, 64, 1, '#f1ede0'); }), transparent: true, roughness: 0.6 }));
    sk.position.set(r * 0.98, 0.17, 0); sk.rotation.y = PI / 2; sk.rotation.x = -0.25;
  };
  ACC.crown = function (c, a) {
    var h = hatBase(c, 0.42, 0.05), r = h.userData.r, gold = dbl(metal(0xe2b62a));
    add(h, cyl(r * 0.98, r * 0.9, 0.22, 48, true), gold, 0, 0.11);
    var vel = add(h, dome(), fabric(0x8a1020)); vel.scale.set(r * 0.92, 0.22, r * 0.92); vel.position.y = 0.06;
    for (var i = 0; i < 8; i++) {
      var an = i / 8 * PI * 2, x = Math.cos(an) * r * 0.98, z = Math.sin(an) * r * 0.98;
      add(h, cone(0.06, 0.15, 4), gold, x, 0.29, z);
      add(h, sph(0.03, 12), gold, x, 0.37, z);
      add(h, sph(0.035, 12), metal(i % 2 ? 0x1f5fd0 : 0xc8151b, { metalness: 0.2, roughness: 0.1 }), Math.cos(an) * r * 1.0, 0.1, Math.sin(an) * r * 1.0);
    }
  };
  ACC.toque = function (c, a) {
    var h = hatBase(c, 0.36, 0.1), r = h.userData.r, m = fabric(0xf7f7f5);
    add(h, cyl(r * 1.0, r * 0.98, 0.24, 48), m, 0, 0.12);
    var top = add(h, sph(1, 32), m, 0, 0.48); top.scale.set(r * 1.3, 0.3, r * 1.3);
    for (var i = 0; i < 6; i++) { var an = i / 6 * PI * 2; var p = add(h, sph(r * 0.42, 20), m, Math.cos(an) * r * 0.75, 0.48, Math.sin(an) * r * 0.75); p.scale.y = 0.75; }
  };
  ACC.cowboy = function (c, a) {
    var h = hatBase(c, 0.33, 0.14), r = h.userData.r, m = dbl(fabric(a.color || 0x7a4f2a, { roughness: 0.75 }));
    add(h, lathe([[0.001, 0.42], [r * 0.45, 0.42], [r * 0.6, 0.36], [r * 0.85, 0.4], [r * 0.92, 0.06], [r * 0.95, 0]]), m);
    add(h, lathe([[r * 0.93, 0.0], [r + 0.22, 0.0], [r + 0.36, 0.05], [r + 0.44, 0.16]], 64), m);
    add(h, cyl(r * 0.94, r * 0.955, 0.07, 48), fabric(0x2a1e14), 0, 0.05);
  };
  ACC.santa = function (c, a) {
    var h = hatBase(c, 0.32, 0.12), r = h.userData.r;
    var pv = new THREE.Group(); pv.rotation.z = 0.75; h.add(pv);
    add(pv, cone(r * 0.98, 0.8, 48), fabric(0xc8151b), 0, 0.4);
    add(pv, sph(0.11, 20), fabric(0xffffff), 0, 0.82);
    var br = add(h, torus(r + 0.02, 0.085, 64), fabric(0xffffff)); br.rotation.x = PI / 2; br.position.y = 0.02;
  };
  ACC.tyrolean = function (c, a) {
    var h = hatBase(c, 0.36, 0.1), r = h.userData.r, m = dbl(fabric(0x3a5a2e, { roughness: 0.8 }));
    add(h, lathe([[0.001, 0.36], [r * 0.5, 0.37], [r * 0.82, 0.3], [r * 0.88, 0.02], [r * 0.9, 0]]), m);
    add(h, lathe([[r * 0.88, 0], [r + 0.13, 0], [r + 0.2, 0.06]], 64), m);
    var cord = add(h, torus(r * 0.89, 0.022, 48), fabric(0xc9a23a)); cord.rotation.x = PI / 2; cord.position.y = 0.05;
    var f = add(h, ell(0.04, 0.3, 0.012, 16), fabric(0x2a2a2a)); f.position.set(-r * 0.3, 0.32, r * 0.88); f.rotation.set(0, 0, 0.7);
    var tuft = add(h, cone(0.09, 0.32, 16), fabric(0x8a8378)); tuft.position.set(-r * 0.62, 0.3, -r * 0.6); tuft.rotation.z = 0.4;
  };
  ACC.headband = function (c, a) {
    var h = hatBase(c, a.dy != null ? a.dy : 0.3, 0.12), r = h.userData.r, m = fabric(a.color || 0xc8151b);
    var t = add(h, torus(r + 0.005, 0.045, 64), m); t.rotation.x = PI / 2;
    if (a.tails) [-1, 1].forEach(function (s) { var tl = add(h, ell(0.07, 0.24, 0.02, 16), dbl(m)); tl.position.set(-r - 0.05, -0.18, s * 0.08); tl.rotation.set(s * 0.3, 0, -0.4); });
    if (a.flower) {
      var fc = new V3(r * 0.35, 0.02, r * 0.95);
      for (var i = 0; i < 5; i++) { var an = i / 5 * PI * 2; add(h, sph(0.05, 12), fabric(a.flower), fc.x + Math.cos(an) * 0.06, fc.y + Math.sin(an) * 0.06, fc.z); }
      add(h, sph(0.045, 12), fabric(0xf2c500), fc.x, fc.y, fc.z + 0.02);
    }
  };
  ACC.tiara = function (c, a) {
    var h = hatBase(c, 0.3, 0.05), r = h.userData.r, gold = metal(0xe2b62a);
    var t = add(h, torus(r + 0.01, 0.03, 48, PI * 0.9), gold); t.rotation.set(PI / 2, 0, -PI * 0.45);
    var pk = add(h, cone(0.1, 0.18, 3), gold); pk.position.set(r * 0.98, 0.08, 0); pk.scale.z = 0.3;
    add(h, ell(0.045, 0.045, 0.02, 12), metal(0xc8151b, { metalness: 0.2 }), r * 1.04, 0.06, 0, 0, PI / 2, 0);
  };
  ACC.prisonercap = function (c, a) {
    var h = hatBase(c, 0.36, 0.1), r = h.userData.r;
    var m = new THREE.MeshStandardMaterial({ map: stripesTex('#f2f2f2', '#141414', 4), roughness: 0.85 });
    add(h, cyl(r * 0.98, r, 0.24, 48), m, 0, 0.12);
    var top = add(h, dome(), m); top.scale.set(r * 0.98, 0.1, r * 0.98); top.position.y = 0.24;
  };
  ACC.wizard = function (c, a) {
    var h = hatBase(c, 0.34, 0.15), r = h.userData.r;
    var tex = U.canvasTex(256, 256, function (x, w, hh) {
      x.fillStyle = '#2a3a8f'; x.fillRect(0, 0, w, hh); x.fillStyle = '#f2c500';
      for (var i = 0; i < 26; i++) drawStar(x, (i * 97) % w, (i * 61) % hh, 9, 4);
    });
    var m = dbl(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    add(h, cyl(r + 0.3, r + 0.3, 0.025, 64), m, 0, 0.012);
    var pv = new THREE.Group(); pv.rotation.z = 0.35; h.add(pv);
    add(pv, cone(r * 0.95, 1.0, 48), m, 0, 0.5);
  };
  ACC.pubghelm = function (c, a) {
    var h = hatBase(c, 0.16, 0.08), r = h.userData.r, m = M(0x4b5232, { roughness: 0.7, clearcoat: 0.1 });
    var d = add(h, dome(), m); d.scale.set(r + 0.05, 0.52, r + 0.05);
    add(h, cyl(r + 0.05, r + 0.07, 0.22, 48, true, PI * 0.7, PI * 1.6), dbl(m), 0, -0.1);
    [-1, 1].forEach(function (s) { add(h, box(0.32, 0.06, 0.05), M(0x2a2d22), 0.05, 0.08, s * (r + 0.07)); });
    add(h, box(0.06, 0.1, 0.16), M(0x2a2d22), r + 0.04, 0.24, 0, 0, 0, -0.5);
  };
  ACC.knighthelm = function (c, a) {
    var h = hatBase(c, 0.12, 0.06), r = h.userData.r, m = dbl(metal(0xc3c8cf));
    var d = add(h, dome(), m); d.scale.set(r + 0.04, 0.6, r + 0.04);
    add(h, cyl(r + 0.04, r + 0.08, 0.3, 48, true, PI * 0.75, PI * 1.5), m, 0, -0.14);
    var ridge = add(h, sph(1, 32), m); ridge.scale.set(r * 0.95, 0.63, 0.04);
    var pv = new THREE.Group(); pv.position.y = 0.6; h.add(pv);
    for (var i = 0; i < 5; i++) { var p = add(pv, ell(0.09, 0.3, 0.06, 16), fabric(a.plume || 0xc8151b)); p.position.set(-i * 0.09, 0.12 - i * 0.03, 0); p.rotation.z = 0.5 + i * 0.22; }
  };
  ACC.vikinghelm = function (c, a) {
    var h = hatBase(c, 0.26, 0.1), r = h.userData.r, iron = metal(0x8d9097, { roughness: 0.45 });
    var d = add(h, dome(), iron); d.scale.set(r + 0.03, 0.42, r + 0.03);
    var band = add(h, torus(r + 0.03, 0.035, 64), metal(0xb8863b)); band.rotation.x = PI / 2;
    add(h, box(0.05, 0.3, 0.07), iron, r + 0.03, -0.1, 0, 0, 0, 0.12);
    var horn = M(0xeee6cf, { roughness: 0.5 });
    [-1, 1].forEach(function (s) {
      var pts = [new V3(0, 0.18, s * (r - 0.05)), new V3(0.05, 0.3, s * (r + 0.2)), new V3(0.08, 0.58, s * (r + 0.3)), new V3(0.12, 0.8, s * (r + 0.22))];
      for (var i = 0; i < 3; i++) {
        var seg = add(h, cyl(0.075 - i * 0.022, 0.095 - i * 0.022, pts[i].distanceTo(pts[i + 1]) + 0.03, 20), horn);
        seg.position.copy(pts[i]).lerp(pts[i + 1], 0.5); along(seg, pts[i + 1].clone().sub(pts[i]));
      }
      var tip = add(h, cone(0.035, 0.12, 16), horn); tip.position.copy(pts[3]); along(tip, pts[3].clone().sub(pts[2]));
    });
  };
  ACC.wingedhelm = function (c, a) {
    var h = hatBase(c, 0.27, 0.1), r = h.userData.r, m = metal(0xc3c8cf);
    var d = add(h, dome(), m); d.scale.set(r + 0.03, 0.4, r + 0.03);
    add(h, box(0.05, 0.22, 0.08), m, r + 0.02, -0.04, 0, 0, 0, 0.1);
    [-1, 1].forEach(function (s) {
      for (var i = 0; i < 4; i++) { var f = add(h, ell(0.05, 0.24 - i * 0.03, 0.02, 16), m); f.position.set(-0.05 - i * 0.07, 0.18, s * (r + 0.02)); f.rotation.set(s * 0.25, 0, 0.6 + i * 0.25); }
    });
  };
  ACC.astro = function (c, a) {
    var gl = add(c.g, sph(1, 48), glass(0xd8ecff, 0.18)); gl.scale.set(0.82, 0.8, 0.8); gl.position.set(c.HC.x + 0.12, c.HC.y + 0.02, 0);
    var ring = add(c.g, torus(0.6, 0.07, 48), M(0xe9ecef, { roughness: 0.4 })); ring.position.set(0.5, 0.42, 0); ring.rotation.set(PI / 2, 0.25, 0);
    add(c.g, box(0.3, 0.6, 0.7), M(0xe9ecef, { roughness: 0.5 }), -0.82, 0.38, 0, 0, 0, 0.25);
  };
  ACC.pumpkinhead = function (c, a) {
    var geo = new THREE.SphereGeometry(1, 64, 40), pa = geo.attributes.position, v = new V3();
    for (var i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i); var ph = Math.atan2(v.z, v.x), k = 1 - 0.07 * (1 - Math.abs(Math.cos(ph * 5)));
      pa.setXYZ(i, v.x * k, v.y * 0.85, v.z * k);
    }
    geo.computeVertexNormals();
    var pk = add(c.g, geo, M(0xe8740c, { roughness: 0.55, clearcoat: 0.3 })); pk.scale.set(0.82, 0.82, 0.8); pk.position.set(c.HC.x + 0.04, c.HC.y + 0.04, 0);
    var st = add(c.g, cyl(0.06, 0.09, 0.24, 12), M(0x4d6b2a, { roughness: 0.8 })); st.position.set(c.HC.x, c.HC.y + 0.78, 0); st.rotation.z = -0.3;
    var face = new THREE.MeshBasicMaterial({ map: U.canvasTex(256, 192, function (x, w, h) {
      x.fillStyle = '#ffd34a';
      [[70, 70], [186, 70]].forEach(function (e) { x.beginPath(); x.moveTo(e[0], e[1] - 32); x.lineTo(e[0] - 30, e[1] + 22); x.lineTo(e[0] + 30, e[1] + 22); x.fill(); });
      x.beginPath(); x.moveTo(40, 120); for (var i = 0; i <= 8; i++) x.lineTo(40 + i * 22, 120 + (i % 2 ? 18 : 0)); x.lineTo(216, 150); for (i = 8; i >= 0; i--) x.lineTo(40 + i * 22, 165 + (i % 2 ? -14 : 0)); x.closePath(); x.fill();
    }), transparent: true, depthWrite: false });
    var fp = add(c.g, new THREE.PlaneGeometry(0.62, 0.46), face); fp.position.set(c.HC.x + 0.85, c.HC.y + 0.05, 0); fp.rotation.y = PI / 2;
  };
  ACC.hood = function (c, a) {
    var m = dbl(fabric(a.color || 0x0f0f12));
    var hd = add(c.g, new THREE.SphereGeometry(1, 48, 24, -PI * 0.68, PI * 1.36, 0, PI * 0.72), m);
    hd.scale.set(c.HR[0] * 1.2, c.HR[1] * 1.22, c.HR[2] * 1.22); hd.position.set(c.HC.x - 0.05, c.HC.y + 0.04, 0);
  };
  ACC.halo = function (c) {
    var t = add(c.g, torus(0.34, 0.035, 48), glow(0xffd54a)); t.position.set(c.HC.x - 0.05, c.HC.y + 0.82, 0); t.rotation.x = PI / 2 - 0.1;
  };

  // ════════ Haare ════════
  ACC.pompadour = function (c, a) {
    var m = M(a.color || 0x111114, { roughness: 0.25, clearcoat: 0.9 });
    var p = add(c.g, sph(1, 32), m); p.scale.set(0.42, 0.22, 0.46); p.position.set(c.HC.x + 0.14, c.HC.y + 0.52, 0); p.rotation.z = -0.35;
    var b = add(c.g, sph(1, 32), m); b.scale.set(0.5, 0.25, 0.5); b.position.set(c.HC.x - 0.12, c.HC.y + 0.47, 0);
    [-1, 1].forEach(function (s) { var o = onHead(c, new V3(0.22, -0.05, s), 1.0); facing(add(c.g, ell(0.08, 0.18, 0.02, 16), m), o.p, o.n); });
  };
  ACC.afro = function (c, a) {
    var geo = new THREE.IcosahedronGeometry(1, 4), pa = geo.attributes.position, v = new V3();
    for (var i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); var k = 1 + 0.05 * Math.sin(v.x * 23) * Math.sin(v.y * 19) * Math.sin(v.z * 21); pa.setXYZ(i, v.x * k, v.y * k, v.z * k); }
    geo.computeVertexNormals();
    var m = add(c.g, geo, fabric(a.color || 0x5a3a22, { roughness: 0.95 })); m.scale.set(0.78, 0.66, 0.8); m.position.set(c.HC.x - 0.1, c.HC.y + 0.3, 0);
  };
  ACC.wildhair = function (c, a) {
    var m = fabric(a.color || 0xe8e8e8, { roughness: 0.9 });
    for (var i = 0; i < 22; i++) {
      var an = (i / 22) * PI * 1.5 + PI * 0.25, el = -0.1 + ((i * 37) % 10) / 10 * 0.9;
      var d = new V3(-Math.abs(Math.cos(an)) * 0.9 - 0.1, el, Math.sin(an)).normalize();
      // weiche, zerzauste Büschel statt Stacheln
      var o = onHead(c, d, 0.95), sp = add(c.g, ell(0.07, 0.17, 0.09, 14), m);
      sp.position.copy(o.p).addScaledVector(o.n, 0.1); along(sp, o.n.clone().add(new V3(((i * 13) % 7 - 3) * 0.12, 0.25, 0)));
    }
  };
  ACC.flattop = function (c, a) {
    var b = add(c.g, box(0.78, 0.2, 0.84), M(a.color || 0x111114, { roughness: 0.6 })); b.position.set(c.HC.x - 0.06, c.HC.y + 0.5, 0); b.rotation.z = 0.08;
  };
  ACC.clownwig = function (c, a) {
    var cols = [0xe6312e, 0xf2c500, 0x2f8f3e, 0x1f5fd0, 0x8a3fb0];
    [-1, 1].forEach(function (s) {
      for (var i = 0; i < 6; i++) { var o = onHead(c, new V3(-0.25 + (i % 3) * 0.12, 0.1 + Math.floor(i / 3) * 0.3, s), 0.95); add(c.g, sph(0.17, 20), fabric(cols[(i + (s > 0 ? 2 : 0)) % 5])).position.copy(o.p); }
    });
    for (var j = 0; j < 4; j++) { var t = onHead(c, new V3(-0.3 + j * 0.2, 1, 0), 0.9); add(c.g, sph(0.16, 20), fabric(cols[j % 5])).position.copy(t.p); }
  };
  ACC.tufts = function (c, a) {
    var m = fabric(a.color || 0x2fa84a);
    for (var i = 0; i < 7; i++) { var o = onHead(c, new V3(-0.6 + i * 0.18, 1, ((i % 3) - 1) * 0.35), 0.95), sp = add(c.g, cone(0.08, 0.3, 10), m); sp.position.copy(o.p).addScaledVector(o.n, 0.08); along(sp, o.n.clone().add(new V3(-0.4, 0, 0))); }
  };
  ACC.mane = function (c, a) {
    var cols = [0xe6312e, 0xf28c1e, 0xf2d22e, 0x3fb04a, 0x2f7fd0, 0x8a3fb0];
    for (var i = 0; i < 9; i++) {
      var t = i / 8, an = PI * 0.45 + t * PI * 0.55, p = new V3(c.HC.x + Math.cos(an) * 0.66 - 0.05, c.HC.y + Math.sin(an) * 0.66 - t * 0.25, 0);
      var m = add(c.g, ell(0.11, 0.2, 0.09, 16), fabric(cols[i % 6])); m.position.copy(p); m.rotation.z = an - PI / 2 + 0.6;
    }
  };
  ACC.leaves = function (c) {
    var m = dbl(fabric(0x4f9a2e));
    for (var i = 0; i < 9; i++) { var o = onHead(c, new V3(-0.5 + (i % 3) * 0.35, 1, (Math.floor(i / 3) - 1) * 0.6), 1.0), lf = add(c.g, ell(0.05, 0.13, 0.015, 12), m); lf.position.copy(o.p).addScaledVector(o.n, 0.08); along(lf, o.n.clone().add(new V3((i % 2) - 0.5, 0, 0.3))); }
  };
  ACC.longhair = function (c, a) {
    var m = fabric(a.color || 0x141414, { roughness: 0.6 });
    // Haarschale über Hinterkopf, fällt bis in den Nacken (phi 0 liegt bei −x)
    var b = add(c.g, new THREE.SphereGeometry(1, 48, 28, -PI * 0.55, PI * 1.1, 0, PI * 0.82), dbl(m));
    b.scale.set(c.HR[0] * 1.06, c.HR[1] * 1.08, c.HR[2] * 1.07); b.position.set(c.HC.x - 0.04, c.HC.y + 0.02, 0);
  };

  // ════════ Gesicht ════════
  ACC.glasses = function (c, a) {
    var frame = a.frame === 'gold' ? metal(0xd9b23a) : M(a.frameColor || 0x111114, { roughness: 0.3 });
    var lensM = a.lens ? glass(a.lens, a.opacity || 0.85) : null;
    var inner = [];
    [-1, 1].forEach(function (s) {
      var p = eyeAt(c, s, 1.08), n = eyeDir(s);
      if (a.round) { facing(add(c.g, torus(0.13, 0.016, 40), frame), p, n); }
      else facing(add(c.g, torus(0.14, 0.014, 40), frame), p, n).scale.set(1, 0.8, 1);
      if (lensM) facing(add(c.g, a.round ? ell(0.125, 0.125, 0.01, 24) : ell(0.135, 0.11, 0.01, 24), lensM), p, n);
      inner.push(p.clone().add(new V3(0.04, 0.0, -s * 0.12)));
      tube([p.clone().add(new V3(-0.07, 0.01, s * 0.11)), new V3(0.75, 1.3, s * 0.6), new V3(0.4, 1.3, s * 0.6)], 0.012, frame, c.g);
    });
    tube([inner[0], new V3(1.12, 1.29, 0), inner[1]], 0.014, frame, c.g);
  };
  ACC.eyepatch = function (c, a) {
    var s = a.side || 1, p = eyeAt(c, s, 1.02), n = eyeDir(s);
    facing(add(c.g, ell(0.13, 0.11, 0.02, 24), M(0x111114)), p, n);
    var h = hatBase(c, 0.22, 0.12), t = add(h, torus(h.userData.r + 0.03, 0.012, 64), M(0x111114)); t.rotation.set(PI / 2, s * 0.35, 0);
  };
  ACC.eyepatches = function (c) {
    [-1, 1].forEach(function (s) { var e = c.decal(ell(0.2, 0.16, 0.011, 24), c.paint, new V3(0.8, 0.36, s * 0.5), 0.99); e.rotateZ(s * -0.3); });
  };
  ACC.brows = function (c, a) {
    var m = a.color != null ? M(a.color) : c.paint;
    // one: eine durchgehende Braue mittig (Zyklop)
    if (a.one) { c.decal(ell(0.24, 0.04, 0.012, 20), m, new V3(0.62, 0.78, 0), 1.0); return; }
    [-1, 1].forEach(function (s) { var b = c.decal(ell(0.13, 0.03, 0.012, 16), m, new V3(0.74, 0.58, s * 0.42), 1.0); b.rotateZ(s * -0.5); });
  };
  ACC.mustache = function (c, a) {
    var m = fabric(a.color || 0x111114, { roughness: 0.8 }), big = a.style === 'walrus';
    [-1, 1].forEach(function (s) {
      var b = add(c.g, ell(big ? 0.13 : 0.11, big ? 0.07 : 0.045, big ? 0.16 : 0.13, 20), m);
      b.position.set(1.2, 1.07, s * (big ? 0.11 : 0.1)); b.rotation.set(s * (big ? 0.5 : 0.35), 0, -0.25);
      if (a.style === 'curl') { var cu = add(c.g, torus(0.04, 0.016, 20), m); cu.position.set(1.15, 1.07, s * 0.24); cu.rotation.y = PI / 2; }
    });
  };
  ACC.beard = function (c, a) {
    var m = fabric(a.color || 0xf4f4f4, { roughness: 0.95 });
    if (a.style === 'long') {
      // langer Bart: weich fallende Form unter dem Schnabel, liegt auf der Brust
      var b = add(c.g, sph(1, 32), m); b.scale.set(0.24, 0.48, 0.36); b.position.set(0.98, 0.42, 0); b.rotation.z = 0.18;
      var tp = add(c.g, cone(0.2, 0.3, 32), m); tp.position.set(1.07, 0.0, 0); tp.rotation.z = PI + 0.18; tp.scale.z = 1.4;
    }
    var ch = add(c.g, sph(1, 32), m); ch.scale.set(0.22, a.style === 'chin' ? 0.16 : 0.24, a.style === 'chin' ? 0.22 : 0.36); ch.position.set(1.0, 0.72, 0);
    if (a.style === 'full') [-1, 1].forEach(function (s) { var o = onHead(c, new V3(0.4, -0.3, s), 0.97); var sb = add(c.g, ell(0.14, 0.2, 0.06, 16), m); facing(sb, o.p, o.n); });
  };
  ACC.rednose = function (c) { add(c.g, sph(0.1, 24), M(0xe01818, { roughness: 0.2, clearcoat: 1 }), 1.53, 0.95, 0); };
  ACC.fangs = function (c) { [-1, 1].forEach(function (s) { add(c.g, cone(0.022, 0.09, 12), M(0xfafafa), 1.3, 0.86, s * 0.1, PI, 0, 0); }); };
  ACC.stitches = function (c) {
    var bar = c.decal(new THREE.BoxGeometry(0.3, 0.018, 0.012), c.paint, new V3(0.3, 0.75, 0.55), 1.0); bar.rotateZ(0.3);
    for (var i = 0; i < 5; i++) { var x = c.decal(new THREE.BoxGeometry(0.016, 0.08, 0.012), c.paint, new V3(0.18 + i * 0.07, 0.72 + i * 0.02, 0.55), 1.0); x.rotateZ(0.3); }
  };

  // ════════ Kopf-Extras ════════
  ACC.horns = function (c, a) {
    var m = M(a.color || 0x1a1a1a, { roughness: 0.35 });
    [-1, 1].forEach(function (s) {
      var o = onHead(c, new V3(0.35, 0.85, s * 0.45), 0.95);
      var h1 = add(c.g, cone(0.08, 0.22, 20), m); h1.position.copy(o.p).addScaledVector(o.n, 0.06); along(h1, new V3(0.1, 1, s * 0.35));
      var h2 = add(c.g, cone(0.045, 0.14, 16), m); h2.position.copy(h1.position).add(new V3(0.05, 0.14, s * 0.02)); along(h2, new V3(0.4, 1, 0));
    });
  };
  ACC.antennae = function (c, a) {
    var m = M(a.color || 0x111114), tip = M(a.tip || a.color || 0x111114, { roughness: 0.2, clearcoat: 1 });
    [-1, 1].forEach(function (s) {
      var o = onHead(c, new V3(0.25, 0.95, s * 0.28), 0.98), e = o.p.clone().add(new V3(0.12, 0.42, s * 0.18));
      tube([o.p, o.p.clone().add(new V3(0.02, 0.22, s * 0.05)), e], 0.018, m, c.g);
      add(c.g, sph(0.06, 16), tip).position.copy(e);
    });
  };
  ACC.ears = function (c, a) {
    var m = M(a.color || 0x5a4129, { roughness: 0.6 });
    [-1, 1].forEach(function (s) {
      var o = onHead(c, new V3(0.0, 0.85, s * 0.55), 0.94), e;
      if (a.shape === 'fin') { e = add(c.g, cone(0.12, 0.36, 3), m); e.scale.z = 0.25; }
      else e = add(c.g, cone(a.shape === 'cat' ? 0.09 : 0.13, a.shape === 'cat' ? 0.2 : 0.34, 20), m);
      e.position.copy(o.p).addScaledVector(o.n, 0.05); along(e, new V3(-0.15, 1, s * 0.35));
    });
  };
  ACC.bolts = function (c) {
    var m = metal(0x8d9097);
    [-1, 1].forEach(function (s) { var b = add(c.g, cyl(0.05, 0.05, 0.26, 16), m, 0.46, 0.62, s * 0.5, PI / 2, 0, 0); add(c.g, cyl(0.075, 0.075, 0.05, 6), m, 0.46, 0.62, s * 0.62, PI / 2, 0, 0); });
  };
  ACC.unihorn = function (c) {
    var o = onHead(c, new V3(0.55, 0.85, 0), 0.97), dir = new V3(0.45, 1, 0).normalize(), gold = metal(0xf0c75a);
    var h = add(c.g, cone(0.08, 0.5, 24), gold); h.position.copy(o.p).addScaledVector(dir, 0.22); along(h, dir);
    for (var i = 0; i < 4; i++) { var r = add(c.g, torus(0.07 - i * 0.014, 0.012, 20), gold); r.position.copy(o.p).addScaledVector(dir, 0.04 + i * 0.1); along(r, dir); r.rotateX(PI / 2 + 0.3); }
  };
  ACC.wingears = function (c, a) {
    var m = a.color === 'white' ? M(0xf4f4f4) : metal(a.color || 0xe2b62a);
    [-1, 1].forEach(function (s) {
      var o = onHead(c, new V3(0.05, 0.25, s), 1.0);
      for (var i = 0; i < 3; i++) { var f = add(c.g, ell(0.035, 0.15 - i * 0.025, 0.012, 12), m); f.position.copy(o.p).add(new V3(-0.05 - i * 0.05, 0.05, s * 0.02)); f.rotation.set(s * 0.2, 0, 0.6 + i * 0.35); }
    });
  };
  ACC.headset = function (c, a) {
    var m = M(0x16161a, { roughness: 0.35 }), acc = metal(a.accent || 0xf2b705);
    var pts = [], i;
    for (i = 0; i <= 8; i++) { var t = i / 8, an = PI * t; pts.push(c.headPoint(new V3(-0.1, Math.sin(an), Math.cos(an)), 1.06)); }
    tube(pts, 0.03, m, c.g);
    [-1, 1].forEach(function (s) {
      var o = onHead(c, new V3(-0.1, 0.05, s), 1.04);
      var cup = add(c.g, cyl(0.17, 0.17, 0.12, 32), m); cup.position.copy(o.p); along(cup, o.n);
      var rg = add(c.g, torus(0.15, 0.018, 32), acc); rg.position.copy(o.p).addScaledVector(o.n, 0.065); along(rg, o.n); rg.rotateX(PI / 2);
    });
    var o2 = onHead(c, new V3(-0.1, 0.05, 1), 1.1);
    tube([o2.p, new V3(0.85, 0.85, 0.5), new V3(1.12, 0.86, 0.3)], 0.016, m, c.g);
    add(c.g, sph(0.045, 16), m).position.set(1.14, 0.86, 0.28);
  };
  ACC.headmirror = function (c) {
    var h = hatBase(c, 0.32, 0.1), t = add(h, torus(h.userData.r + 0.01, 0.03, 64), M(0x2a2a2a)); t.rotation.x = PI / 2;
    var o = onHead(c, new V3(0.75, 0.55, 0.1), 1.08), d = add(c.g, cyl(0.13, 0.13, 0.03, 32), metal(0xdfe3e8, { roughness: 0.05 }));
    d.position.copy(o.p); along(d, o.n);
  };

  // ════════ Körper ════════
  ACC.bowtie = function (c, a) {
    var at = neck(0.6, 0), m = fabric(a.color || 0x141414, { roughness: 0.5 }), p = at.p.clone().addScaledVector(at.n, 0.04);
    [-1, 1].forEach(function (s) { var w = add(c.g, cone(0.09, 0.18, 4), m); w.position.copy(p).add(new V3(0, 0, s * 0.09)); w.rotation.x = s * PI / 2; w.scale.z = 0.45; });
    add(c.g, sph(0.045, 12), m).position.copy(p);
  };
  ACC.tie = function (c, a) {
    frontRibbon(c, [0.5, 0.42, 0.3, 0.15, 0.0, -0.12, -0.2], [0.035, 0.05, 0.06, 0.07, 0.075, 0.06, 0.001], fabric(a.color || 0x8a1020, { roughness: 0.5 }));
  };
  ACC.neckerchief = function (c, a) {
    var m = fabric(a.color || 0xc8151b), t = add(c.g, torus(0.47, 0.06, 48), m); t.position.set(0.44, 0.6, 0); t.rotation.set(PI / 2, -0.25, 0); t.scale.set(1, 1.04, 1);
    var at = neck(0.55, 0);
    if (a.triangle) { var tr = add(c.g, cone(0.2, 0.32, 3), dbl(m)); tr.position.copy(at.p).add(new V3(0.08, -0.08, 0)); tr.rotation.set(0, PI / 2, PI - 0.4); tr.scale.z = 0.25; }
    else add(c.g, sph(0.07, 16), m).position.copy(at.p).add(new V3(0.05, 0, 0));
  };
  ACC.scarf = function (c, a) {
    var m = fabric(a.color || 0x8a8a8a, { roughness: 0.95 }), t = add(c.g, torus(0.48, a.thick || 0.1, 48), m); t.position.set(0.42, 0.62, 0); t.rotation.set(PI / 2, -0.2, 0);
  };
  ACC.stethoscope = function (c) {
    var m = M(0x1d1d22, { roughness: 0.3 }), pts = [];
    for (var i = 0; i <= 10; i++) { var ph = -PI * 0.6 + i / 10 * PI * 1.2 + PI; pts.push(neck(0.62, ph).p.clone().add(new V3(0, 0.02, 0)).multiply(new V3(1.06, 1, 1.06))); }
    var l = neck(0.6, -0.55).p, r = neck(0.6, 0.55).p, lf = front(0.0, -0.22).p, rf = front(0.12, 0.22).p;
    tube([pts[0], l.clone().multiplyScalar(1.04), lf.clone().add(new V3(0.06, 0, 0))], 0.022, m, c.g);
    tube(pts, 0.022, m, c.g);
    tube([pts[10], r.clone().multiplyScalar(1.04), rf.clone().add(new V3(0.06, 0, 0))], 0.022, m, c.g);
    var d = add(c.g, cyl(0.08, 0.08, 0.04, 24), metal(0xdfe3e8)); d.position.copy(lf).add(new V3(0.07, -0.02, 0)); d.rotation.z = PI / 2;
  };
  ACC.chain = function (c, a) {
    var pts = [], gold = metal(a.color || 0xe2b62a);
    for (var i = 0; i < 16; i++) { var ph = i / 16 * PI * 2, p = neck(0.58, ph).p, f = Math.max(0, Math.cos(ph)); pts.push(p.clone().add(new V3(f * 0.05, -f * 0.32, 0)).addScaledVector(new V3(Math.cos(ph), 0, -Math.sin(ph)), 0.05)); }
    tube(pts, 0.025, gold, c.g, true);
    if (a.medal) { var at = front(0.22, 0), d = add(c.g, cyl(0.1, 0.1, 0.03, 24), gold); d.position.copy(at.p).addScaledVector(at.n, 0.03); along(d, at.n); }
  };
  ACC.ruffle = function (c, a) {
    var cols = a.colors || [0xffffff];
    for (var i = 0; i < 18; i++) {
      var ph = i / 18 * PI * 2, at = neck(0.56, ph), r = add(c.g, ell(0.16, 0.06, 0.12, 16), fabric(cols[i % cols.length]));
      r.position.copy(at.p).addScaledVector(at.n, 0.06); r.lookAt(at.p.clone().addScaledVector(at.n, 1)); r.rotateY(PI / 2);
    }
  };
  ACC.buttons = function (c, a) {
    var m = M(a.color || 0x111114, { roughness: 0.3 });
    (a.ys || [0.35, 0.15, -0.05]).forEach(function (y) {
      (a.double ? [-0.14, 0.14] : [0]).forEach(function (z) { var at = front(y, z); add(c.g, sph(0.04, 12), m).position.copy(at.p).addScaledVector(at.n, 0.01); });
    });
  };
  // Stehkragen: ein Rechteck (Länge × Höhe), hinten am Hals angelegt und nach vorn um den
  // Hals eingerollt. roll = wie weit eingerollt (0 flach, 1 ganz rund geschlossen); bei gleicher
  // Breite wird er enger, je stärker er eingerollt ist. Ein Stück, außen Kragenfarbe, innen Futter.
  // Form-Regler (Duck-Editor): Höhe, Breite, Einrollen, nach oben aufweiten, Dicke, vordere
  // Spitzen, nach hinten kippen.
  RD.FORMS.highcollar = [
    { k: 'roll', label: 'Roll up', min: 0, max: 1, step: 0.01, def: 0.72 },
    { k: 'h', label: 'Height', min: 0.1, max: 0.9, step: 0.01, def: 0.42 },
    { k: 'w', label: 'Length', min: 0.5, max: 3.5, step: 0.01, def: 2.08 },
    { k: 'flare', label: 'Open out at the top', min: -0.3, max: 1.2, step: 0.01, def: 0.43 },
    { k: 'thick', label: 'Thickness', min: 0, max: 0.1, step: 0.002, def: 0 },
    { k: 'tips', label: 'Front tips', min: 0, max: 0.6, step: 0.01, def: 0 },
    { k: 'lean', label: 'Lean back (°)', min: -30, max: 45, step: 1, def: 10 }
  ];
  // Punkte [u][v] des Rechtecks, off = Abstand zur Mittelfläche (± halbe Dicke, + = außen)
  function collarSheet(f, off, U, V) {
    var XB = -0.46, AX = 0, ang = f.roll * 2 * PI, pts = [];
    for (var u = 0; u <= U; u++) {
      var sx = (u / U - 0.5) * f.w, th = ang > 1e-4 ? sx / (f.w / ang) : 0, R = ang > 1e-4 ? f.w / ang : 0;
      // Querschnitt: hinten bei x = XB angelegt, nach vorn eingerollt
      var x = ang > 1e-4 ? XB + R * (1 - Math.cos(th)) : XB, z = ang > 1e-4 ? R * Math.sin(th) : sx;
      var nx = -Math.cos(th), nz = Math.sin(th), e = Math.pow(Math.abs(2 * u / U - 1), 3), row = [];
      for (var v = 0; v <= V; v++) {
        var tv = v / V, k = 1 + f.flare * tv, y = (tv - 0.5) * f.h + f.tips * e * tv;
        row.push(new V3(AX + (x - AX) * k + nx * off, y, z * k + nz * off));
      }
      pts.push(row);
    }
    return pts;
  }
  function collarGeo(f) {
    var U = 64, V = 12, t = f.thick / 2, A = collarSheet(f, t, U, V), B = collarSheet(f, -t, U, V), pos = [], idx = [], g = new THREE.BufferGeometry();
    function grid(P, flip) {
      var n0 = pos.length / 3;
      P.forEach(function (row) { row.forEach(function (p) { pos.push(p.x, p.y, p.z); }); });
      for (var u = 0; u < U; u++) for (var v = 0; v < V; v++) {
        var a = n0 + u * (V + 1) + v, b = a + V + 1;
        if (flip) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    function quad(p0, p1, p2, p3) { var n = pos.length / 3; [p0, p1, p2, p3].forEach(function (p) { pos.push(p.x, p.y, p.z); }); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); }
    grid(A, true);
    var nOut = idx.length;
    if (t) {
      // Ränder zwischen Außen- und Innenfläche
      for (var u2 = 0; u2 < U; u2++) { quad(A[u2][0], A[u2 + 1][0], B[u2 + 1][0], B[u2][0]); quad(A[u2][V], B[u2][V], B[u2 + 1][V], A[u2 + 1][V]); }
      for (var v2 = 0; v2 < V; v2++) { quad(A[0][v2], B[0][v2], B[0][v2 + 1], A[0][v2 + 1]); quad(A[U][v2], A[U][v2 + 1], B[U][v2 + 1], B[U][v2]); }
      nOut = idx.length;
    }
    grid(B, true);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    g.addGroup(0, nOut, 0); g.addGroup(nOut, idx.length - nOut, 1);
    return g;
  }
  ACC.highcollar = function (c, a) {
    var f = RD.formOf('highcollar', a.form), col = a.color || 0x141418;
    var out = M(col, { roughness: 0.6, side: f.thick ? THREE.DoubleSide : THREE.FrontSide });
    var inn = M(a.inner || col, { roughness: 0.6, side: THREE.BackSide });
    var m = add(c.g, collarGeo(f), [out, inn]);
    m.name = 'Collar'; m.position.set(0.38, 0.82, 0); m.rotation.z = f.lean * PI / 180;
  };
  // Freie Form (Duck-Editor „Add part“ → Shape): Quader, Zylinder, Kugel, Ring oder Schlauch, mirror = Spiegelbild;
  // Maße, Biegung, runde Ecken, Feder und Knickpunkte stellt der Editor über „Shape“ ein.
  var HOSE = { r: 0.03, taper: 1, round: 0.5, pts: [[0, 0, -0.3], [0.05, 0.12, -0.1], [0.05, -0.05, 0.1], [0, 0.1, 0.3]] };
  ACC.shape = function (c, a) {
    var k = a.kind || 'box', geo, m;
    if (k === 'hose') {
      var info = { t: 'hose', p: HOSE, sc: [1, 1, 1], off: [0, 0, 0] };
      m = add(c.g, RD.makePrim(info, {}), M(a.color != null ? a.color : 0xf2b705, { side: THREE.DoubleSide }));
      m.userData.prim = info;
    } else {
      geo = k === 'cylinder' ? cyl(0.1, 0.1, 0.4, 32) : k === 'ball' ? sph(0.15, 32) : k === 'ring' ? torus(0.15, 0.04, 48) : box(0.3, 0.3, 0.3);
      m = add(c.g, geo, M(a.color != null ? a.color : 0xf2b705));
    }
    m.name = 'Shape'; m.position.set(1.05, 0.15, 0);
    // gespiegelt auf die andere Seite (folgt dem Original, siehe mirrorPieces in rubber-duck.js)
    if (a.mirror) { var mm = add(c.g, m.geometry, m.material); mm.name = 'Shape (mirrored)'; mm.userData.mirrorOf = 'Shape'; }
  };
  ACC.necklace = function (c, a) {
    var m = metal(a.color || 0xc9ced6), t = add(c.g, torus(0.47, 0.022, 48), m); t.position.set(0.44, 0.6, 0); t.rotation.set(PI / 2, -0.28, 0);
    for (var i = -3; i <= 3; i++) { var at = neck(0.56, i * 0.22), f = add(c.g, cone(0.025, 0.1, 8), m); f.position.copy(at.p).addScaledVector(at.n, 0.04).add(new V3(0, -0.05, 0)); f.rotation.x = PI; }
  };
  ACC.vest = function (c, a) {
    var m = fabric(a.color || 0x3a3f2a, { roughness: 0.8 });
    [[-0.05, -0.26], [-0.05, 0], [-0.05, 0.26], [0.2, -0.18], [0.2, 0.18]].forEach(function (yz) {
      var at = front(yz[0], yz[1]), b = add(c.g, box(0.16, 0.18, 0.08), m); facing(b, at.p.clone().addScaledVector(at.n, 0.03), at.n);
    });
  };

  // ════════ Requisiten ════════
  // Flügelspitze; bei breitem Körper (girth) entsprechend weiter außen
  function held(c, s) { return new V3(0.38, 0.08, s * (0.92 + 0.78 * ((+c.o.girth || 1) - 1))); }
  ACC.claws = function (c) {
    var m = metal(0xdfe3e8, { roughness: 0.15 });
    [-1, 1].forEach(function (s) { for (var i = 0; i < 3; i++) { var b = held(c, s).add(new V3(0, -0.04 + i * 0.07, s * 0.02)); tube([b, b.clone().add(new V3(0.3, 0.04, s * 0.02)), b.clone().add(new V3(0.6, 0.1, s * 0.03))], 0.014, m, c.g); } });
  };
  ACC.hammer = function (c) {
    var h = held(c, 1), m = metal(0x9aa0a8, { roughness: 0.35 });
    add(c.g, cyl(0.035, 0.035, 0.55, 12), fabric(0x5a3a22), h.x, h.y - 0.05, h.z + 0.05);
    add(c.g, box(0.36, 0.22, 0.22), m, h.x, h.y - 0.38, h.z + 0.05);
  };
  ACC.trident = function (c, a) {
    var m = a.color ? M(a.color, { roughness: 0.3 }) : metal(0xc3c8cf), h = held(c, 1).add(new V3(0.05, 0, 0.08));
    add(c.g, cyl(0.025, 0.025, 1.9, 10), m, h.x, h.y + 0.3, h.z);
    [-1, 0, 1].forEach(function (k) { var p = add(c.g, cone(0.03, 0.26, 10), m); p.position.set(h.x + k * 0.1, h.y + 1.35 - Math.abs(k) * 0.03, h.z); });
    add(c.g, box(0.26, 0.04, 0.04), m, h.x, h.y + 1.22, h.z);
  };
  ACC.scythe = function (c) {
    var h = held(c, 1).add(new V3(0, 0, 0.08));
    add(c.g, cyl(0.03, 0.03, 2.3, 10), fabric(0x2a1e14), h.x, h.y + 0.35, h.z);
    var bl = add(c.g, torus(0.42, 0.035, 32, PI * 0.55), metal(0xc3c8cf, { roughness: 0.2 })); bl.position.set(h.x - 0.38, h.y + 1.42, h.z); bl.rotation.z = 0.2; bl.scale.set(1, 1, 0.3);
  };
  ACC.broom = function (c) {
    var a0 = new V3(-1.0, -0.45, 0.9), a1 = new V3(0.5, 1.0, 0.95);
    tube([a0, a1], 0.03, fabric(0x6b4a2c), c.g);
    var b = add(c.g, cone(0.17, 0.42, 16), fabric(0xc9a25a, { roughness: 1 })); b.position.copy(a0).add(new V3(-0.1, -0.1, 0)); along(b, a1.clone().sub(a0));
  };
  ACC.pan = function (c) {
    var m = dbl(metal(0x3a3b40, { roughness: 0.4, metalness: 0.6 })), g2 = new THREE.Group();
    add(g2, lathe([[0.001, 0], [0.38, 0], [0.44, 0.1], [0.45, 0.1]]), m);
    tube([new V3(0.44, 0.06, 0), new V3(0.8, 0.12, 0)], 0.035, M(0x1a1a1a), g2);
    g2.position.set(-0.78, 0.38, 0); g2.rotation.set(0, 0, PI / 2 + 0.35); g2.rotateY(-PI / 2); c.g.add(g2);
  };
  ACC.palette = function (c) {
    var h = held(c, 1).add(new V3(0.08, 0.05, 0.05));
    var tex = U.canvasTex(256, 256, function (x, w) {
      x.fillStyle = '#d9b98a'; x.beginPath(); x.ellipse(128, 128, 120, 96, 0, 0, PI * 2); x.fill();
      x.fillStyle = 'rgba(0,0,0,0)'; x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(70, 160, 20, 0, PI * 2); x.fill(); x.globalCompositeOperation = 'source-over';
      ['#c8151b', '#f2c500', '#2f8f3e', '#1f5fd0', '#ffffff', '#3a2a1e'].forEach(function (col, i) { x.fillStyle = col; x.beginPath(); x.arc(110 + (i % 3) * 40, 85 + Math.floor(i / 3) * 50, 15, 0, PI * 2); x.fill(); });
    });
    var p = add(c.g, new THREE.PlaneGeometry(0.62, 0.62), dbl(new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 0.7 })));
    p.position.copy(h); p.rotation.y = 0.2;
    tube([h.clone().add(new V3(0.15, 0.1, 0.05)), h.clone().add(new V3(0.45, 0.45, 0.08))], 0.014, fabric(0x2a1e14), c.g);
  };
  ACC.ballchain = function (c) {
    var m = M(0x16161a, { roughness: 0.35, metalness: 0.5 }), ball = new V3(0.35, -0.33, 1.22);
    add(c.g, sph(0.22, 24), m).position.copy(ball);
    var a0 = new V3(0.2, -0.42, 0.66);
    for (var i = 0; i < 6; i++) { var t = (i + 0.5) / 6, l = add(c.g, torus(0.04, 0.012, 12), m); l.position.copy(a0).lerp(ball, t); l.rotation.set(i % 2 ? PI / 2 : 0, 0.6, 0); }
  };
  ACC.scepter = function (c) {
    var h = held(c, 1).add(new V3(0.05, 0, 0.08)), gold = metal(0xe2b62a);
    add(c.g, cyl(0.03, 0.03, 1.1, 12), gold, h.x, h.y + 0.15, h.z);
    add(c.g, sph(0.08, 20), gold, h.x, h.y + 0.74, h.z);
    add(c.g, sph(0.05, 16), metal(0xc8151b, { metalness: 0.2 }), h.x, h.y + 0.85, h.z);
  };
  ACC.wand = function (c) {
    var h = held(c, 1), e = h.clone().add(new V3(0.5, 0.35, 0.05));
    tube([h, e], 0.018, fabric(0x2a1e14), c.g);
    var st = add(c.g, new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: U.canvasTex(64, 64, function (x) { x.fillStyle = '#ffe36a'; drawStar(x, 32, 32, 30, 12); }), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    st.position.copy(e); st.rotation.y = 0.3;
  };
  ACC.beewings = function (c) {
    var m = glass(0xe8f6ff, 0.6); m.side = THREE.DoubleSide; m.depthWrite = true;
    [-1, 1].forEach(function (s) { for (var i = 0; i < 2; i++) { var w = add(c.g, ell(0.42 - i * 0.1, 0.2 - i * 0.05, 0.012, 24), m); w.position.set(-0.35 - i * 0.15, 0.95 - i * 0.12, s * (0.5 + i * 0.05)); w.rotation.set(s * 0.5, 0, 0.7 + i * 0.4); } });
  };
  // size: Größe der Flügel (Amor kleiner), am Ansatz festgehalten
  ACC.angelwings = function (c, a) {
    var m = fabric(a.color || 0xfafafa, { roughness: 0.7 }), k = a.size || 1;
    [-1, 1].forEach(function (s) { for (var i = 0; i < 5; i++) { var f = add(c.g, ell(0.08 * k, (0.38 - i * 0.04) * k, 0.03 * k, 16), m); f.position.set(-0.45 - i * 0.06 * k, 0.85 + i * 0.03 * k, s * (0.45 + i * 0.05 * k)); f.rotation.set(s * 0.6, 0, 0.9 + i * 0.18); } });
  };
  ACC.katana = function (c, a) {
    (a.two ? [-1, 1] : [1]).forEach(function (s) {
      var g2 = new THREE.Group(); g2.position.set(-0.62, 0.52, s * 0.08); g2.rotation.set(s * 0.55, 0, -0.25); c.g.add(g2);
      add(g2, box(0.02, 1.15, 0.06), metal(0xe3e7ec, { roughness: 0.12 }), 0, -0.1);
      add(g2, cyl(0.1, 0.1, 0.02, 20), metal(0xd9b23a), 0, 0.48);
      add(g2, cyl(0.035, 0.035, 0.32, 12), fabric(0x141414), 0, 0.65);
    });
  };
  ACC.shield = function (c) {
    var tex = U.canvasTex(256, 256, function (x) {
      [['#c8151b', 124], ['#f4f4f4', 98], ['#c8151b', 72], ['#1f3f9e', 48]].forEach(function (r) { x.fillStyle = r[0]; x.beginPath(); x.arc(128, 128, r[1], 0, PI * 2); x.fill(); });
      x.fillStyle = '#f4f4f4'; drawStar(x, 128, 128, 44, 17);
    });
    var top = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.4, roughness: 0.35 }), side = M(0xc8151b);
    var sh = add(c.g, cyl(0.5, 0.5, 0.04, 48), [side, top, side]); sh.position.set(0.1, 0.12, 1.02); sh.rotation.x = PI / 2;
  };
  ACC.beer = function (c) {
    var h = held(c, 1).add(new V3(0.2, -0.05, 0.08));
    add(c.g, cyl(0.14, 0.13, 0.32, 32), glass(0xf2a91e, 0.75), h.x, h.y, h.z);
    add(c.g, cyl(0.15, 0.14, 0.08, 32), fabric(0xfffbf0), h.x, h.y + 0.19, h.z);
    var hd = add(c.g, torus(0.08, 0.02, 16, 32, PI), glass(0xffffff, 0.6)); hd.position.set(h.x - 0.14, h.y, h.z); hd.rotation.z = PI / 2;
  };
  ACC.football = function (c) {
    var tex = U.canvasTex(256, 128, function (x, w, h) { x.fillStyle = '#fafafa'; x.fillRect(0, 0, w, h); x.fillStyle = '#141414'; for (var i = 0; i < 12; i++) { x.beginPath(); var cx = (i % 6) * 44 + 22 + (i > 5 ? 22 : 0), cy = i > 5 ? 90 : 38; for (var k = 0; k < 5; k++) { var an = k / 5 * PI * 2; x.lineTo(cx + Math.cos(an) * 13, cy + Math.sin(an) * 13); } x.fill(); } });
    var b = add(c.g, sph(0.22, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 })); b.position.set(1.15, -0.33, 0.55);
  };
  ACC.parrot = function (c) {
    var g2 = new THREE.Group(); g2.position.set(-0.05, 0.78, 0.48); c.g.add(g2);
    add(g2, ell(0.1, 0.16, 0.1, 20), M(0x2f9a3e), 0, 0.08);
    add(g2, sph(0.08, 20), M(0xd8231e), 0.02, 0.27);
    add(g2, cone(0.03, 0.08, 12), M(0xf2c500), 0.1, 0.26, 0, 0, 0, -PI / 2);
    add(g2, ell(0.04, 0.2, 0.03, 12), M(0x1f5fd0), -0.1, -0.08, 0, 0, 0, 0.4);
  };
  ACC.stinger = function (c) { var s = add(c.g, cone(0.06, 0.22, 16), M(0x1a1a1a)); s.position.set(-1.33, 0.7, 0); s.rotation.z = PI / 2; };
  ACC.halfmic = function (c) {
    var a0 = new V3(0.45, -0.25, 0.98), a1 = new V3(0.85, 0.7, 0.8);
    tube([a0, a1], 0.025, metal(0xc3c8cf), c.g);
    add(c.g, sph(0.07, 16), M(0x1a1a1a)).position.copy(a1);
  };
  ACC.backpack = function (c, a) { add(c.g, box(0.28, 0.55, 0.65), fabric(a.color || 0x3a3f2a), -0.85, 0.35, 0, 0, 0, 0.25); };

  // ════════ Zyklop, Butler, Leder, Rennfahrer, Amor, Tutu, Henker ════════
  // flacher Lappen mit gezacktem Unterrand, hängt in der yz-Ebene (Fläche zeigt nach +x)
  function rag(w, h, n, jag, wb) {
    var s = new THREE.Shape(), b = wb == null ? w : wb;
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0);
    for (var i = n; i >= 0; i--) s.lineTo(-b / 2 + i / n * b, -h + (i % 2 ? jag : 0));
    s.closePath();
    var g = new THREE.ShapeGeometry(s); g.rotateY(PI / 2); return g;
  }
  // Band entlang der Körperoberfläche durch die Richtungen dirs (wie U.surface), Breite w, Abstand off.
  // Flachgedrückter Schlauch, der am Körper anliegt (hug) → im Duck-Editor Knickpunkte ziehen, Breite,
  // Flachheit und Abstand per Regler; die Punkte bleiben dabei auf dem Körper.
  function strap(c, dirs, w, mat, off) {
    var info = { t: 'hose', hug: RD.hugKey(), p: { r: w / 2, flat: 0.9, lift: off || 0.02, taper: 1, spline: true, rad: 12,
      pts: dirs.map(function (d) { var q = U.surface(d).p; return [r4(q.x), r4(q.y), r4(q.z)]; }) } };
    var m = new THREE.Mesh(RD.makePrim(info, {}), dbl(mat)); m.userData.prim = info; c.g.add(m); return m;
  }
  function heartShape(sc) {
    var h = new THREE.Shape();
    h.moveTo(0, -0.5 * sc);
    h.bezierCurveTo(-0.1 * sc, -0.35 * sc, -0.5 * sc, -0.15 * sc, -0.5 * sc, 0.15 * sc);
    h.bezierCurveTo(-0.5 * sc, 0.45 * sc, -0.1 * sc, 0.5 * sc, 0, 0.25 * sc);
    h.bezierCurveTo(0.1 * sc, 0.5 * sc, 0.5 * sc, 0.45 * sc, 0.5 * sc, 0.15 * sc);
    h.bezierCurveTo(0.5 * sc, -0.15 * sc, 0.1 * sc, -0.35 * sc, 0, -0.5 * sc);
    return h;
  }

  // Lendentuch: Lappen vorn und hinten, hängen vom Gürtel frei nach unten
  ACC.loincloth = function (c, a) {
    var m = dbl(fabric(a.color || 0x7a5a36, { roughness: 0.95 }));
    var f = add(c.g, rag(0.42, 0.36, 7, 0.05, 0.34), m, 1.08, -0.12, 0, 0, 0, 0.12); f.name = 'Front flap';
    var b = add(c.g, rag(0.5, 0.36, 7, 0.05, 0.4), m, -1.02, -0.14, 0, 0, 0, -0.2); b.name = 'Back flap';
  };
  // Keule aus Holz mit Knubbeln
  ACC.club = function (c, a) {
    var m = fabric(a.color || 0x6b4a2c, { roughness: 0.9 }), g2 = new THREE.Group();
    g2.position.copy(held(c, 1).add(new V3(0.05, 0, 0.1))); g2.rotation.set(0.15, 0, -0.35); c.g.add(g2);
    add(g2, cyl(0.13, 0.045, 1.0, 16), m, 0, 0.35);
    [[0.09, 0.62, 0.08], [-0.1, 0.7, 0.05], [0.03, 0.78, -0.11], [0.1, 0.46, -0.05]].forEach(function (k) { add(g2, sph(0.05, 10), m, k[0], k[1], k[2]); });
  };
  // Frack: weiße Hemdbrust vorn, zwei Schöße hinten
  // Schöße farbig abgesetzt (color), damit sie auf dunklem Anzug zu sehen sind; Satin-Glanz
  ACC.tailcoat = function (c, a) {
    var m = dbl(M(a.color || 0x7a1626, { roughness: 0.35, clearcoat: 0.6 }));
    var sh = frontRibbon(c, [0.32, 0.2, 0.1, 0.0, -0.1, -0.18], [0.12, 0.15, 0.16, 0.16, 0.14, 0.09], fabric(a.shirt || 0xfafafa, { roughness: 0.6 }));
    sh.name = 'Shirt front';
    [-1, 1].forEach(function (s) {
      var at = U.surfaceAt(0.12, PI + s * 0.32, 0.1);
      var t = add(c.g, rag(0.28, 0.46, 2, 0.0, 0.1), m);
      t.position.copy(at.p).addScaledVector(at.n, 0.03); t.rotation.set(0, s * 0.32 + PI, 0.12);
      t.name = s < 0 ? 'Right tail' : 'Left tail';
    });
  };
  // Silbertablett mit Weinglas, auf der Flügelspitze balanciert
  ACC.tray = function (c, a) {
    var g2 = new THREE.Group(); g2.position.copy(held(c, 1).add(new V3(0.05, 0.14, 0.18))); c.g.add(g2);
    var sil = metal(a.color || 0xd8dce2, { roughness: 0.18 });
    add(g2, cyl(0.3, 0.27, 0.025, 48), sil).name = 'Tray';
    add(g2, torus(0.3, 0.018, 48), sil, 0, 0.015, 0, PI / 2).name = 'Rim';
    add(g2, lathe([[0.001, 0], [0.065, 0], [0.012, 0.012], [0.01, 0.12], [0.05, 0.15], [0.068, 0.22], [0.062, 0.3]], 24), dbl(glass(0xe8f4ff, 0.45)), 0.06, 0.012).name = 'Glass';
    add(g2, cyl(0.06, 0.047, 0.07, 24), glass(a.drink || 0x8a1020, 0.85), 0.06, 0.2).name = 'Wine';
  };
  // Reißverschluss quer über den Mund (am Schnabelrand entlang)
  ACC.zipper = function (c, a) {
    var m = metal(a.color || 0xd5d9de, { roughness: 0.2 });
    var curve = new THREE.CatmullRomCurve3([[0.95, 0.935, -0.335], [1.2, 0.915, -0.27], [1.4, 0.895, -0.16], [1.5, 0.885, 0], [1.4, 0.895, 0.16], [1.2, 0.915, 0.27], [0.95, 0.935, 0.335]].map(function (p) { return new V3(p[0], p[1], p[2]); }));
    // Zähne als ein Stück (eine Geometrie)
    var N = 46, pos = [], o = new THREE.Object3D();
    for (var i = 0; i <= N; i++) {
      var p = curve.getPoint(i / N), t = curve.getTangent(i / N), bx = box(0.022, 0.03, 0.014).toNonIndexed();
      o.position.copy(p).add(new V3(0, i % 2 ? 0.008 : -0.008, 0)); o.rotation.set(0, -Math.atan2(t.z, t.x), 0); o.updateMatrix();
      bx.applyMatrix4(o.matrix); pos.push.apply(pos, bx.attributes.position.array);
    }
    var tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.computeVertexNormals();
    add(c.g, tg, m).name = 'Teeth';
    var pull = add(c.g, box(0.03, 0.07, 0.012), m); pull.position.copy(curve.getPoint(0.12)).add(new V3(0, -0.04, 0)); pull.rotation.y = -0.5; pull.name = 'Zipper pull';
  };
  // Halsband mit Nieten und Ring vorn
  ACC.studcollar = function (c, a) {
    var lea = M(a.color || 0x111113, { roughness: 0.3, clearcoat: 1 }), st = metal(0xdfe3e8, { roughness: 0.15 });
    // Band als Ring um den Hals (folgt der Oberfläche), 0.09 hoch; unterhalb von y ≈ 0.68 liefe der Ring hinten über den Rücken
    var pos = [], idx = [], N = 48;
    for (var j = 0; j <= N; j++) {
      var a0 = neck(0.7, j / N * PI * 2), q = a0.p.clone().addScaledVector(a0.n, 0.025);
      pos.push(q.x, q.y - 0.045, q.z, q.x, q.y + 0.045, q.z);
      if (j) { var k = j * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
    }
    var bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setIndex(idx); bg.computeVertexNormals();
    add(c.g, bg, dbl(lea)).name = 'Band';
    for (var i = -5; i <= 5; i++) { if (!i) continue; var at = neck(0.7, i * 0.26), sp = add(c.g, cone(0.03, 0.07, 10), st); sp.position.copy(at.p).addScaledVector(at.n, 0.06); along(sp, at.n); }
    var f = neck(0.68, 0), r = add(c.g, torus(0.06, 0.014, 24), st); r.position.copy(f.p).addScaledVector(f.n, 0.04).add(new V3(0, -0.07, 0)); r.rotation.y = PI / 2; r.name = 'Ring';
  };
  // Brustgurte über Kreuz mit Metallring in der Mitte
  ACC.harness = function (c, a) {
    var lea = M(a.color || 0x111113, { roughness: 0.3, clearcoat: 1 });
    [-1, 1].forEach(function (s) { strap(c, [new V3(1, 0.5, s * 0.55), new V3(1, 0.28, s * 0.22), new V3(1, 0.12, 0), new V3(1, -0.05, -s * 0.25), new V3(1, -0.22, -s * 0.6)], 0.075, lea, 0.02).name = s < 0 ? 'Strap right' : 'Strap left'; });
    var at = front(0.12, 0), r = add(c.g, torus(0.065, 0.016, 24), metal(0xdfe3e8, { roughness: 0.15 }));
    facing(r, at.p.clone().addScaledVector(at.n, 0.035), at.n); r.name = 'Ring';
  };
  // Peitsche: Griff in der Flügelspitze, Riemen hängt geschwungen zum Boden
  ACC.whip = function (c, a) {
    var h = held(c, 1).add(new V3(0, 0, 0.1)), e = h.clone().add(new V3(0.22, 0.24, 0.02));
    var hg = tube([h, e], 0.03, M(0x141414, { roughness: 0.4 }), c.g); hg.name = 'Handle';
    var l = tube([e, new V3(0.85, 0.42, 1.0), new V3(1.15, 0.12, 1.12), new V3(1.2, -0.3, 1.02), new V3(0.95, -0.5, 0.92), new V3(1.25, -0.54, 0.82)], 0.013, M(a.color || 0x1e1a18, { roughness: 0.5 }), c.g); l.name = 'Lash';
  };
  // Rennhelm: Schale um Kopf und Nacken, vorn offen, getöntes Visier über den Augen, Mittelstreifen
  ACC.racehelm = function (c, a) {
    var hm = M(a.color || 0xf4f4f4, { roughness: 0.25, clearcoat: 1 }), sx = c.HR[0] * 1.13, sy = c.HR[1] * 1.13, sz = c.HR[2] * 1.13;
    function shell(m, p0, pl, t0, tl, k) { var s = add(c.g, new THREE.SphereGeometry(1, 48, 24, p0, pl, t0, tl), dbl(m)); s.scale.set(sx * (k || 1), sy * (k || 1), sz * (k || 1)); s.position.set(c.HC.x - 0.04, c.HC.y + 0.03, 0); return s; }
    shell(hm, PI + 0.9, PI * 2 - 1.8, 0, PI * 0.62).name = 'Shell';
    shell(glass(a.visor || 0x1a2a40, 0.75), PI - 0.95, 1.9, PI * 0.2, PI * 0.25).name = 'Visor';
    var st = M(a.stripe || 0x1c69d4, { roughness: 0.25, clearcoat: 1 });
    shell(st, -0.07, 0.14, 0, PI * 0.6, 1.006).name = 'Stripe';
    shell(st, PI - 0.07, 0.14, 0, PI * 0.2, 1.006).name = 'Stripe front';
  };
  // drei Rennstreifen senkrecht über die Brust (hellblau, dunkelblau, rot)
  ACC.racestripes = function (c, a) {
    var cols = a.colors || [0x5bb3e6, 0x1f2a8a, 0xd8231e], ys = [0.4, 0.25, 0.1, -0.05, -0.2, -0.4, -0.6], ws = ys.map(function () { return 0.042; });
    cols.forEach(function (col, i) { frontRibbon(c, ys, ws, fabric(col, { roughness: 0.6 }), (i - 1) * 0.088).name = 'Stripe ' + (i + 1); });
  };
  // Lenkrad vor dem Bauch
  ACC.wheel = function (c, a) {
    var g2 = new THREE.Group(); g2.position.set(1.32, 0.2, 0); g2.rotation.z = 0.35; c.g.add(g2);
    var m = M(a.color || 0x1a1a1c, { roughness: 0.45 }), al = metal(0xc3c8cf);
    add(g2, torus(0.36, 0.04, 64), m, 0, 0, 0, 0, PI / 2).name = 'Rim';
    add(g2, cyl(0.08, 0.08, 0.06, 24), al, 0, 0, 0, 0, 0, PI / 2).name = 'Hub';
    [0, 1, 2].forEach(function (k) { var sp = add(g2, box(0.03, 0.34, 0.05), al); var an = PI / 2 + k * PI * 2 / 3; sp.position.set(0, Math.sin(an) * 0.18, Math.cos(an) * 0.18); sp.rotation.x = -an + PI / 2; });
  };
  // Bogen mit Herzpfeil (Amor)
  ACC.bow = function (c, a) {
    var g2 = new THREE.Group(); g2.position.copy(held(c, 1).add(new V3(0.1, 0.18, 0.16))); c.g.add(g2);
    var gold = metal(a.color || 0xe2b62a), R = 0.42, A = PI * 0.4;
    var arc = add(g2, torus(R, 0.022, 40, A * 2), gold); arc.rotation.z = -A; arc.name = 'Bow';
    var ex = Math.cos(A) * R, ey = Math.sin(A) * R;
    tube([new V3(ex, ey, 0), new V3(ex - 0.08, 0, 0), new V3(ex, -ey, 0)], 0.005, fabric(0xfafafa), g2).name = 'String';
    add(g2, cyl(0.012, 0.012, 0.7, 8), fabric(0x8a5a2c), ex + 0.27, 0, 0, 0, 0, PI / 2).name = 'Shaft';
    var hg = new THREE.ExtrudeGeometry(heartShape(0.16), { depth: 0.025, bevelEnabled: false }); hg.translate(0, 0, -0.0125); hg.rotateZ(PI / 2);
    add(g2, hg, M(a.tip || 0xd8233a, { roughness: 0.3, clearcoat: 1 }), ex + 0.67, 0, 0).name = 'Heart tip';
    [-1, 1].forEach(function (s) { var f = add(g2, ell(0.06, 0.025, 0.004, 12), dbl(fabric(0xf7c6d6)), ex - 0.02, s * 0.025, 0, 0, 0, s * 0.35); f.name = 'Feather'; });
  };
  // Locken: kleine Kugeln dicht auf dem Oberkopf
  ACC.curls = function (c, a) {
    var m = fabric(a.color || 0xe8c25a, { roughness: 0.7 });
    for (var i = 0; i < 16; i++) {
      var u = -0.5 + (i % 4) * 0.25 + (Math.floor(i / 4) % 2) * 0.12, w = (Math.floor(i / 4) - 1.5) * 0.24;
      var o = onHead(c, new V3(u, 1, w), 0.97), b = add(c.g, sph(0.075 + (i % 3) * 0.01, 14), m); b.position.copy(o.p).addScaledVector(o.n, 0.03);
    }
  };
  // Tutu: drei gewellte Tüll-Lagen um die Taille
  ACC.tutu = function (c, a) {
    var cols = [a.color || 0xf4a6c8, a.color2 || 0xf9c8dc, a.color || 0xf4a6c8], N = 72;
    cols.forEach(function (col, L) {
      var y0 = 0.02 - L * 0.06, R = 0.34 - L * 0.05, pos = [], idx = [];
      for (var i = 0; i <= N; i++) {
        var ph = i / N * PI * 2, at = U.surfaceAt(y0, ph, 0.1), out = new V3(at.n.x, 0, at.n.z).normalize();
        var p0 = at.p.clone().addScaledVector(out, 0.01), p1 = at.p.clone().addScaledVector(out, R).add(new V3(0, -0.02 + Math.sin(ph * 14 + L * 1.7) * 0.025, 0));
        pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
        if (i) { var k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      var m = dbl(fabric(col, { roughness: 0.9, transparent: true, opacity: 0.9 }));
      var me = new THREE.Mesh(g, m); me.name = 'Layer ' + (L + 1); c.g.add(me);
    });
  };
  // Dutt oben auf dem Kopf mit Haargummi
  ACC.bun = function (c, a) {
    var o = onHead(c, new V3(-0.25, 1, 0), 0.98), m = fabric(a.color || 0x6b4a2c, { roughness: 0.8 });
    var b = add(c.g, sph(0.17, 24), m); b.position.copy(o.p).addScaledVector(o.n, 0.1); b.name = 'Bun';
    var r = add(c.g, torus(0.12, 0.025, 12, 32), fabric(a.band || 0xf4a6c8)); facing(r, o.p.clone().addScaledVector(o.n, 0.03), o.n); r.name = 'Band';
  };
  // Henkerkapuze: Spitze oben, kurzer Überwurf auf den Schultern, Augenlöcher (Kopf selbst über cowl gefärbt)
  ACC.exechood = function (c, a) {
    var m = dbl(fabric(a.color || 0x111113, { roughness: 0.75 }));
    var h = hatBase(c, 0.34, -0.12), tip = add(h, cone(h.userData.r, 0.62, 40), m); tip.position.y = 0.28; tip.name = 'Point';
    if (a.drape !== false) { var d = add(c.g, cyl(0.46, 0.78, 0.26, 48, true), m, 0.42, 0.6, 0); d.scale.z = 0.95; d.name = 'Drape'; }
    var holeM = M(c.o.skin != null ? c.o.skin : 0xf6bd16);
    [-1, 1].forEach(function (s) { var e = c.decal(ell(0.15, 0.11, 0.011, 24), holeM, new V3(0.8, 0.36, s * 0.5), 1.006); e.rotateZ(s * -0.3); e.name = s < 0 ? 'Right eye hole' : 'Left eye hole'; });
  };
  // großes Beil, aufrecht in der Flügelspitze
  ACC.axe = function (c, a) {
    var g2 = new THREE.Group(); g2.position.copy(held(c, 1).add(new V3(0.05, -0.05, 0.12))); g2.rotation.set(0, -0.5, -0.12); c.g.add(g2);
    add(g2, cyl(0.035, 0.04, 1.65, 12), fabric(0x5a3a22), 0, 0.62).name = 'Handle';
    var s = new THREE.Shape();
    s.moveTo(0, -0.1); s.lineTo(0.18, -0.13); s.lineTo(0.42, -0.3); s.quadraticCurveTo(0.58, 0.02, 0.42, 0.32); s.lineTo(0.18, 0.13); s.lineTo(0, 0.11); s.closePath();
    var bg = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }); bg.translate(0, 0, -0.015);
    add(g2, bg, metal(a.color || 0x9aa0a8, { roughness: 0.3 }), 0.02, 1.25).name = 'Blade';
  };

  // ════════ Mucki, fette Ente, Spitzen-Dessous, Lucky Luke ════════
  // Band rund um den Körper zwischen Höhe y0 und y1, folgt der Oberfläche; uv: u rundum (ru-mal), v quer.
  // ph0/ph1 = Winkelbereich (0 = vorn), cx = Achse, von der aus gemessen wird
  function ringBand(c, y0, y1, mat, off, opt) {
    opt = opt || {};
    var N = opt.n || 72, R = 4, ph0 = opt.ph0 || 0, ph1 = opt.ph1 != null ? opt.ph1 : PI * 2, cx = opt.cx != null ? opt.cx : 0.1;
    var pos = [], uv = [], idx = [];
    for (var r = 0; r <= R; r++) {
      var y = y0 + (y1 - y0) * r / R;
      for (var i = 0; i <= N; i++) {
        var at = U.surfaceAt(y, ph0 + (ph1 - ph0) * i / N, cx), q = at.p.clone().addScaledVector(at.n, off || 0.02);
        pos.push(q.x, q.y, q.z); uv.push(i / N * (opt.ru || 1), r / R);
      }
    }
    for (r = 0; r < R; r++) for (i = 0; i < N; i++) { var a0 = r * (N + 1) + i, b0 = a0 + N + 1; idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    var m = new THREE.Mesh(g, dbl(mat)); c.g.add(m); return m;
  }
  // viele kleine Formen zu EINEM Stück zusammenfassen: items = [{ geo, p, r (Euler), s }]
  function merged(items) {
    var pos = [], nrm = [], o = new THREE.Object3D();
    items.forEach(function (it) {
      var g = it.geo.index ? it.geo.toNonIndexed() : it.geo.clone();
      o.position.copy(it.p); o.rotation.copy(it.r || new THREE.Euler()); o.scale.setScalar(1);
      if (it.s) o.scale.copy(it.s);
      o.updateMatrix(); g.applyMatrix4(o.matrix);
      pos.push.apply(pos, g.attributes.position.array); nrm.push.apply(nrm, g.attributes.normal.array);
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    return out;
  }
  function rnd(i) { var x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); }
  // Spitze: durchbrochenes Muster (Löcher, Blüten, Bogenkante oben) als Alpha-Textur
  var LACE = {};
  function laceTex(col) {
    if (LACE[col]) return LACE[col];
    var t = U.canvasTex(256, 128, function (x, w, h) {
      x.fillStyle = col; x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = 'destination-out';
      for (var r = 0; r < 6; r++) for (var i = 0; i < 13; i++) { x.beginPath(); x.arc(i * 21 + (r % 2) * 10.5, 22 + r * 19, 6.5, 0, PI * 2); x.fill(); }
      for (i = 0; i < 8; i++) { x.beginPath(); x.arc(i * 32 + 16, 0, 13, 0, PI); x.fill(); }   // Bogenkante
      x.globalCompositeOperation = 'source-over';
      [[64, 70], [192, 70]].forEach(function (f) { for (var k = 0; k < 6; k++) { var an = k / 6 * PI * 2; x.beginPath(); x.ellipse(f[0] + Math.cos(an) * 11, f[1] + Math.sin(an) * 11, 8, 5, an, 0, PI * 2); x.fill(); } });
    });
    t.wrapS = THREE.RepeatWrapping;
    return (LACE[col] = t);
  }
  function lace(col) { return new THREE.MeshStandardMaterial({ map: laceTex(col), alphaTest: 0.5, roughness: 0.6, side: THREE.DoubleSide }); }

  // Bizeps-Polster auf beiden Flügeln
  ACC.biceps = function (c) {
    [-1, 1].forEach(function (s) {
      var b = add(c.g, ell(0.2, 0.13, 0.09, 24), c.wingMat, 0.02, 0.2, s * 0.86, s * 0.15, s * 0.12, 0.35);
      b.name = s < 0 ? 'Right biceps' : 'Left biceps';
    });
  };
  // Hantel in der Flügelspitze
  ACC.dumbbell = function (c, a) {
    var h = held(c, 1).add(new V3(0.05, 0, 0.14)), m = metal(a.color || 0x3a3b40, { roughness: 0.4 });
    add(c.g, cyl(0.025, 0.025, 0.62, 12), metal(0xc3c8cf), h.x, h.y, h.z, 0, 0, PI / 2).name = 'Bar';
    [-1, 1].forEach(function (s) { [0, 1].forEach(function (k) { add(c.g, cyl(0.14 - k * 0.03, 0.14 - k * 0.03, 0.05, 32), m, h.x + s * (0.24 - k * 0.055), h.y, h.z, 0, 0, PI / 2).name = 'Weight'; }); });
  };
  // Donut mit Zuckerguss und Streuseln
  ACC.donut = function (c, a) {
    var g2 = new THREE.Group(); g2.position.copy(held(c, 1).add(new V3(0.14, 0.1, 0.0))); g2.rotation.set(PI / 2 - 0.5, 0, 0.2); c.g.add(g2);
    add(g2, torus(0.12, 0.065, 32), fabric(0xd9a05b, { roughness: 0.8 })).name = 'Dough';
    var ic = add(g2, torus(0.12, 0.062, 32), M(a.color || 0xf28cb8, { roughness: 0.35, clearcoat: 0.6 }), 0, 0, 0.018); ic.scale.z = 0.75; ic.name = 'Icing';
    [0xffffff, 0x3fb0e6, 0xf2d000].forEach(function (col, j) {
      var items = [];
      for (var i = 0; i < 6; i++) { var an = (i * 3 + j) / 18 * PI * 2, rr = 0.12 + (rnd(i + j * 7) - 0.5) * 0.06; items.push({ geo: box(0.035, 0.01, 0.01), p: new V3(Math.cos(an) * rr, Math.sin(an) * rr, 0.075), r: new THREE.Euler(0, 0, an * 3) }); }
      add(g2, merged(items), M(col)).name = 'Sprinkles';
    });
  };
  // BH: zwei Körbchen aus Spitze mit rotem Saum, Träger über die Schultern, Schleife in der Mitte
  ACC.bra = function (c, a) {
    var lm = lace(a.color || '#111111'), trim = M(a.trim || 0xc8102e, { roughness: 0.4 });
    lm.map.repeat.set(3, 1);
    [-1, 1].forEach(function (s) {
      var at = front(0.12, s * 0.27), cup = add(c.g, new THREE.SphereGeometry(1, 32, 12, 0, PI * 2, 0, PI / 2), lm);
      cup.scale.set(0.21, 0.1, 0.21); cup.position.copy(at.p).addScaledVector(at.n, -0.035); along(cup, at.n); cup.name = s < 0 ? 'Right cup' : 'Left cup';
      var t = add(c.g, torus(0.21, 0.014, 40), trim); facing(t, at.p.clone().addScaledVector(at.n, -0.03), at.n); t.name = 'Trim';
      strap(c, [new V3(1, 0.3, s * 0.3), new V3(0.6, 0.6, s * 0.48), new V3(0, 0.7, s * 0.5), new V3(-0.7, 0.5, s * 0.42)], 0.035, trim, 0.015).name = s < 0 ? 'Right strap' : 'Left strap';
    });
    var mid = front(0.1, 0), bw = add(c.g, merged([{ geo: cone(0.04, 0.08, 4), p: new V3(0, 0, -0.04), r: new THREE.Euler(PI / 2, 0, 0) }, { geo: cone(0.04, 0.08, 4), p: new V3(0, 0, 0.04), r: new THREE.Euler(-PI / 2, 0, 0) }, { geo: sph(0.022, 10), p: new V3(0, 0, 0) }]), trim);
    bw.position.copy(mid.p).addScaledVector(mid.n, 0.04); bw.name = 'Bow';
  };
  // Spitzenhöschen rund um die Hüfte mit rotem Bund
  ACC.lacepanties = function (c, a) {
    var lm = lace(a.color || '#111111'); lm.map.repeat.set(9, 1);
    ringBand(c, -0.47, -0.25, lm, 0.018, { ru: 9 }).name = 'Lace';
    ringBand(c, -0.27, -0.24, M(a.trim || 0xc8102e, { roughness: 0.4 }), 0.022).name = 'Waistband';
  };
  // Strapsgürtel: Spitzenband in der Taille, vier rote Bänder nach unten
  ACC.garter = function (c, a) {
    var lm = lace(a.color || '#111111'); lm.map.repeat.set(9, 1);
    ringBand(c, -0.16, -0.05, lm, 0.02, { ru: 9 }).name = 'Belt';
    var red = M(a.trim || 0xc8102e, { roughness: 0.4 });
    [-0.38, -0.14, 0.14, 0.38].forEach(function (z, i) { strap(c, [new V3(1, -0.45, z), new V3(1, -0.8, z * 1.05), new V3(1, -1.3, z * 1.1)], 0.03, red, 0.03).name = 'Strap ' + (i + 1); });
  };
  // Federboa um den Hals, vorn hängen zwei Enden herunter (ein Stück aus vielen Flusen)
  ACC.boa = function (c, a) {
    var items = [], N = 150;
    function fluff(p, i) { var k = 0.7 + rnd(i) * 0.6; items.push({ geo: cone(0.022, 0.13, 5), p: p, r: new THREE.Euler(rnd(i + 3) * 6.3, rnd(i + 5) * 6.3, rnd(i + 7) * 6.3), s: new V3(k, k, k) }); }
    for (var i = 0; i < N; i++) { var at = neck(0.72 + (rnd(i + 11) - 0.5) * 0.06, i / N * PI * 2); fluff(at.p.clone().addScaledVector(at.n, 0.05 + rnd(i + 13) * 0.03), i); }
    [-1, 1].forEach(function (s) { for (var j = 0; j < 30; j++) { var at = front(0.42 - j * 0.012, s * (0.48 + j * 0.006)); fluff(at.p.clone().addScaledVector(at.n, 0.05 + rnd(j + 17) * 0.03), 300 + j + (s > 0 ? 50 : 0)); } });
    add(c.g, merged(items), fabric(a.color || 0xd8102e, { roughness: 1 })).name = 'Boa';
  };
  // lange Wimpern über beiden Augen
  ACC.lashes = function (c, a) {
    var items = [];
    [-1, 1].forEach(function (s) {
      var o = onHead(c, new V3(0.8, 0.36, s * 0.5), 1.0), up = new V3(0, 1, 0).addScaledVector(o.n, -o.n.y).normalize(), side = new V3().crossVectors(o.n, up);
      for (var k = -1; k <= 1; k++) {
        var dir = o.n.clone().multiplyScalar(0.6).add(up).addScaledVector(side, k * 0.5).normalize(), base = o.p.clone().addScaledVector(up, 0.095).addScaledVector(side, k * 0.04);
        var q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir);
        items.push({ geo: cone(0.012, 0.09, 8), p: base.addScaledVector(dir, 0.045), r: new THREE.Euler().setFromQuaternion(q) });
      }
    });
    add(c.g, merged(items), a.color != null ? M(a.color) : c.paint).name = 'Lashes';
  };
  // offene Weste: rundum, vorn offen
  ACC.openvest = function (c, a) {
    ringBand(c, -0.05, 0.5, fabric(a.color || 0x141414, { roughness: 0.7 }), 0.025, { ph0: 0.55, ph1: PI * 2 - 0.55, n: 64, cx: 0.3 }).name = 'Vest';
  };
  // Stirnlocke: drei Haarspitzen fallen unter der Hutkrempe in die Stirn
  ACC.forelock = function (c, a) {
    var m = fabric(a.color || 0x141414, { roughness: 0.7 }), items = [];
    [-0.12, 0, 0.12].forEach(function (z, i) {
      var o = onHead(c, new V3(0.8, 0.5, z), 1.0), dir = new V3(0.45, -1, z * 1.5).normalize();
      var q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir);
      items.push({ geo: cone(0.055, 0.2 - Math.abs(z) * 0.4, 12), p: o.p.clone().addScaledVector(o.n, 0.03).addScaledVector(dir, 0.07), r: new THREE.Euler().setFromQuaternion(q) });
    });
    add(c.g, merged(items), m).name = 'Forelock';
  };
  // Revolvergürtel mit Patronen, Schnalle und Holster samt Revolver an der Seite
  ACC.gunbelt = function (c, a) {
    var lea = fabric(a.color || 0x6b4a2c, { roughness: 0.6 }), gold = metal(0xd9b23a);
    ringBand(c, -0.24, -0.13, lea, 0.03).name = 'Belt';
    var fb = front(-0.6, 0), bk = add(c.g, box(0.14, 0.11, 0.03), gold); facing(bk, fb.p.clone().addScaledVector(fb.n, 0.05), fb.n); bk.name = 'Buckle';
    var items = [];
    [-1.1, -0.9, -0.7, -0.5, -0.3, 0.3, 0.5, 0.7, 0.9, 1.1].forEach(function (ph) { var at = U.surfaceAt(-0.185, ph, 0.1); items.push({ geo: cyl(0.016, 0.016, 0.08, 8), p: at.p.clone().addScaledVector(at.n, 0.05) }); });
    add(c.g, merged(items), gold).name = 'Cartridges';
    var hs = U.surfaceAt(-0.32, -1.25, 0.1), hg = new THREE.Group(); hg.position.copy(hs.p).addScaledVector(hs.n, 0.07); hg.lookAt(hg.position.clone().add(hs.n)); c.g.add(hg);
    add(hg, box(0.13, 0.26, 0.06), lea).name = 'Holster';
    add(hg, box(0.06, 0.14, 0.05), fabric(0x3a2414, { roughness: 0.5 }), 0.03, 0.17, 0, 0, 0, -0.35).name = 'Grip';
    add(hg, cyl(0.035, 0.035, 0.06, 12), metal(0x6a6e75), 0, 0.12, 0, PI / 2).name = 'Cylinder';
  };
  // Grashalm im Mundwinkel
  ACC.grass = function (c, a) {
    var m = fabric(a.color || 0x9ab83a, { roughness: 0.8 });
    tube([new V3(0.98, 0.915, -0.29), new V3(1.15, 0.94, -0.42), new V3(1.32, 0.99, -0.55)], 0.008, m, c.g).name = 'Grass blade';
  };

  // Langschwert: aufrecht in der Flügelspitze, Klinge schräg nach oben
  ACC.sword = function (c, a) {
    var g2 = new THREE.Group(); g2.position.copy(held(c, 1).add(new V3(0.06, 0.02, 0.1))); g2.rotation.set(0.12, -0.7, -0.28); c.g.add(g2);
    var bl = new THREE.Shape(); bl.moveTo(-0.045, 0); bl.lineTo(0.045, 0); bl.lineTo(0.04, 0.9); bl.lineTo(0, 1.04); bl.lineTo(-0.04, 0.9); bl.closePath();
    var bg = new THREE.ExtrudeGeometry(bl, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 }); bg.translate(0, 0, -0.006);
    var gold = metal(a.guard || 0xd9b23a);
    add(g2, bg, metal(a.color || 0xe3e7ec, { roughness: 0.12 }), 0, 0.03).name = 'Blade';
    add(g2, box(0.34, 0.045, 0.06), gold).name = 'Crossguard';
    add(g2, cyl(0.024, 0.024, 0.2, 12), fabric(0x4a2c18, { roughness: 0.6 }), 0, -0.12).name = 'Grip';
    add(g2, sph(0.045, 16), gold, 0, -0.25).name = 'Pommel';
  };
  // Wappenschild (spitz zulaufend) mit Kreuz, im anderen Flügel
  ACC.kiteshield = function (c, a) {
    var g2 = new THREE.Group(), h = held(c, -1); g2.position.set(h.x - 0.2, h.y + 0.1, h.z - 0.1); g2.rotation.set(0, PI - 0.6, 0.08); c.g.add(g2);
    var sh = new THREE.Shape(); sh.moveTo(-0.27, 0.32); sh.lineTo(0.27, 0.32); sh.quadraticCurveTo(0.28, -0.12, 0, -0.42); sh.quadraticCurveTo(-0.28, -0.12, -0.27, 0.32);
    var sg = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.015, bevelSegments: 2 });
    add(g2, sg, M(a.color || 0xf4f2ea, { roughness: 0.4 })).name = 'Shield';
    var cr = M(a.cross || 0xc8151b, { roughness: 0.4 });
    add(g2, box(0.08, 0.6, 0.012), cr, 0, -0.01, 0.05).name = 'Cross upright';
    add(g2, box(0.46, 0.08, 0.012), cr, 0, 0.13, 0.05).name = 'Cross bar';
  };
  // Richterperücke: weiße Lockenrollen über dem Kopf und seitlich herab (ein Stück)
  ACC.judgewig = function (c, a) {
    var items = [], k;
    // Kappe über dem Oberkopf, quer gerippt (Lockenrollen)
    items.push({ geo: new THREE.SphereGeometry(1, 40, 16, 0, PI * 2, 0, PI * 0.33), p: new V3(c.HC.x - 0.08, c.HC.y + 0.02, 0), s: new V3(c.HR[0] * 1.07, c.HR[1] * 1.07, c.HR[2] * 1.07) });
    for (k = 0; k < 6; k++) { var o = onHead(c, new V3(-0.5 + k * 0.17, 1, 0), 1.04); items.push({ geo: cyl(0.05, 0.05, 0.62 - Math.abs(k - 2.5) * 0.08, 14), p: o.p.clone(), r: new THREE.Euler(PI / 2, 0, 0) }); }
    [-1, 1].forEach(function (s) {
      for (k = 0; k < 4; k++) { var o2 = onHead(c, new V3(-0.25, 0.25 - k * 0.32, s), 0.98); items.push({ geo: torus(0.075, 0.045, 24), p: o2.p.clone().addScaledVector(o2.n, 0.06), r: new THREE.Euler(0, PI / 2, 0) }); }
    });
    for (k = 0; k < 3; k++) items.push({ geo: torus(0.07, 0.045, 24), p: new V3(c.HC.x - c.HR[0] - 0.02, c.HC.y - 0.1 - k * 0.2, 0), r: new THREE.Euler(PI / 2, 0, 0) });
    add(c.g, merged(items), fabric(a.color || 0xf1eee6, { roughness: 0.9 })).name = 'Wig';
  };
  // Holzhammer (Richter)
  ACC.gavel = function (c, a) {
    var g2 = new THREE.Group(); g2.position.copy(held(c, 1).add(new V3(0.08, 0.1, 0.12))); g2.rotation.set(0, 0, -0.5); c.g.add(g2);
    var w = fabric(a.color || 0x6b3f1f, { roughness: 0.45 });
    add(g2, cyl(0.025, 0.025, 0.55, 12), w, 0, 0.2).name = 'Handle';
    add(g2, cyl(0.075, 0.075, 0.26, 20), w, 0, 0.5, 0, PI / 2).name = 'Head';
  };
  // ════════ Embleme ════════
  function drawStar(x, cx, cy, ro, ri) { x.beginPath(); for (var i = 0; i < 10; i++) { var a = i / 10 * PI * 2 - PI / 2, r = i % 2 ? ri : ro; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } x.closePath(); x.fill(); }
  function drawSkull(x, cx, cy, sc, col) {
    x.fillStyle = col; x.beginPath(); x.arc(cx, cy - 6 * sc, 34 * sc, 0, PI * 2); x.fill(); x.fillRect(cx - 18 * sc, cy + 14 * sc, 36 * sc, 22 * sc);
    x.fillStyle = '#111'; x.beginPath(); x.arc(cx - 13 * sc, cy - 6 * sc, 9 * sc, 0, PI * 2); x.arc(cx + 13 * sc, cy - 6 * sc, 9 * sc, 0, PI * 2); x.fill();
    x.fillRect(cx - 2 * sc, cy + 6 * sc, 4 * sc, 8 * sc);
  }
  function text(x, w, t, col, font, sx) { x.fillStyle = col; x.font = font || '900 150px "Arial Black", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.save(); x.translate(w / 2, w / 2 + 6); x.scale(sx || 1, 1); x.fillText(t, 0, 0); x.restore(); }
  EMB.spider = function (x, w) {
    var c = w / 2; x.fillStyle = '#111'; x.strokeStyle = '#111'; x.lineWidth = 8; x.lineCap = 'round';
    x.beginPath(); x.ellipse(c, c - 22, 16, 22, 0, 0, PI * 2); x.fill(); x.beginPath(); x.ellipse(c, c + 26, 20, 34, 0, 0, PI * 2); x.fill();
    [-1, 1].forEach(function (s) { [[-40, -60, -70, -100], [-10, -70, 0, -110], [10, -70, 30, -60], [40, -60, 70, 30]].forEach(function (l, i) { x.beginPath(); x.moveTo(c + s * 12, c - 10 + i * 12); x.quadraticCurveTo(c + s * (40 + i * 6), c + l[0], c + s * (60 + i * 8), c + l[2] * 0.6 + i * 8); x.stroke(); }); });
  };
  EMB.arc = function (x, w) {
    var c = w / 2, g = x.createRadialGradient(c, c, 4, c, c, 100);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#bdf4ff'); g.addColorStop(0.7, '#3fc8ff'); g.addColorStop(1, 'rgba(63,200,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(c, c, 100, 0, PI * 2); x.fill();
    x.strokeStyle = '#8a9099'; x.lineWidth = 10; x.beginPath(); x.arc(c, c, 70, 0, PI * 2); x.stroke();
  };
  EMB.capstar = function (x, w) { var c = w / 2; x.fillStyle = '#f4f4f4'; drawStar(x, c, c, 110, 44); };
  EMB.bolt = function (x, w) {
    var c = w / 2; x.fillStyle = '#f4f4f4'; x.beginPath(); x.arc(c, c, 110, 0, PI * 2); x.fill();
    x.fillStyle = '#f2c500'; x.beginPath(); x.moveTo(c + 20, c - 100); x.lineTo(c - 50, c + 10); x.lineTo(c, c + 10); x.lineTo(c - 25, c + 100); x.lineTo(c + 55, c - 20); x.lineTo(c + 5, c - 20); x.closePath(); x.fill();
  };
  EMB.ww = function (x, w) { text(x, w, 'W', '#f2c500', '900 210px "Arial Black", Arial, sans-serif', 1.6); };
  EMB.robin = function (x, w) { var c = w / 2; x.fillStyle = '#f2c500'; x.beginPath(); x.arc(c, c, 100, 0, PI * 2); x.fill(); text(x, w, 'R', '#141414'); };
  EMB.discs = function (x, w) {
    for (var r = 0; r < 3; r++) for (var k = 0; k < 2; k++) { var cx = w / 2 + (k ? 55 : -55), cy = 40 + r * 80, g = x.createRadialGradient(cx - 10, cy - 10, 4, cx, cy, 32); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#8d939b'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 30, 0, PI * 2); x.fill(); }
  };
  EMB.cross = function (x, w) { var c = w / 2; x.fillStyle = '#c8151b'; x.fillRect(c - 22, 20, 44, w - 40); x.fillRect(30, c - 50, w - 60, 44); };
  EMB.redcross = function (x, w) { var c = w / 2; x.fillStyle = '#ffffff'; x.beginPath(); x.arc(c, c, 120, 0, PI * 2); x.fill(); x.fillStyle = '#d8231e'; x.fillRect(c - 28, 40, 56, w - 80); x.fillRect(40, c - 28, w - 80, 56); };
  EMB.sheriff = function (x, w) {
    var c = w / 2; x.fillStyle = '#d9b23a'; x.beginPath();
    for (var i = 0; i < 12; i++) { var a = i / 12 * PI * 2 - PI / 2, r = i % 2 ? 50 : 112; x.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); } x.closePath(); x.fill();
    for (i = 0; i < 6; i++) { var a2 = i / 6 * PI * 2 - PI / 2; x.beginPath(); x.arc(c + Math.cos(a2) * 112, c + Math.sin(a2) * 112, 12, 0, PI * 2); x.fill(); }
  };
  EMB.mission = function (x, w) {
    var c = w / 2; x.fillStyle = '#1f3f9e'; x.beginPath(); x.arc(c, c, 120, 0, PI * 2); x.fill();
    x.fillStyle = '#f4f4f4'; x.beginPath(); x.arc(c, c, 46, 0, PI * 2); x.fill();
    x.strokeStyle = '#c8151b'; x.lineWidth = 12; x.beginPath(); x.ellipse(c, c, 100, 36, -0.4, 0, PI * 2); x.stroke();
    x.fillStyle = '#ffffff'; drawStar(x, c + 70, c - 70, 12, 5); drawStar(x, c - 80, c + 60, 9, 4);
  };
  EMB.peace = function (x, w) {
    var c = w / 2; x.strokeStyle = '#ffffff'; x.lineWidth = 22; x.beginPath(); x.arc(c, c, 100, 0, PI * 2); x.stroke();
    x.beginPath(); x.moveTo(c, c - 100); x.lineTo(c, c + 100); x.moveTo(c, c); x.lineTo(c - 70, c + 70); x.moveTo(c, c); x.lineTo(c + 70, c + 70); x.stroke();
  };
  EMB.gg = function (x, w) {
    var c = w / 2; x.fillStyle = '#f2b705'; x.beginPath(); x.moveTo(c - 100, c - 90); x.lineTo(c + 100, c - 90); x.lineTo(c + 100, c + 20); x.quadraticCurveTo(c + 90, c + 90, c, c + 120); x.quadraticCurveTo(c - 90, c + 90, c - 100, c + 20); x.closePath(); x.fill();
    text(x, w, 'GG', '#5e2a79', '900 120px "Arial Black", Arial, sans-serif', 0.95);
  };
  EMB.num10 = function (x, w) { text(x, w, '10', '#141414', '900 170px "Arial Black", Arial, sans-serif', 0.9); };
  EMB.num1337 = function (x, w) { x.fillStyle = '#f4f4f4'; x.fillRect(20, 80, w - 40, 96); text(x, w, '1337', '#141414', '900 92px "Arial Black", Arial, sans-serif', 0.9); };
  EMB.skull = function (x, w) { drawSkull(x, w / 2, w / 2, 2.6, '#f1ede0'); };
  // Shirt-Aufdruck „POCHINKI“ (PUBG, Erangel) mit Fadenkreuz
  EMB.pochinki = function (x, w) {
    var c = w / 2; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.strokeStyle = '#f2b705'; x.lineWidth = 6; x.beginPath(); x.arc(c, c - 46, 40, 0, PI * 2); x.stroke();
    x.beginPath(); x.moveTo(c - 58, c - 46); x.lineTo(c - 18, c - 46); x.moveTo(c + 18, c - 46); x.lineTo(c + 58, c - 46);
    x.moveTo(c, c - 104); x.lineTo(c, c - 64); x.moveTo(c, c - 28); x.lineTo(c, c + 12); x.stroke();
    x.fillStyle = '#f2b705'; x.beginPath(); x.arc(c, c - 46, 5, 0, PI * 2); x.fill();
    x.fillStyle = '#f4f4f4'; x.font = '900 52px "Arial Black", Arial, sans-serif';
    x.save(); x.translate(c, c + 44); x.scale(Math.min(1, 240 / x.measureText('POCHINKI').width), 1); x.fillText('POCHINKI', 0, 0); x.restore();
    x.fillStyle = '#c9ced6'; x.font = '700 24px Arial, sans-serif'; x.fillText('E R A N G E L', c, c + 90);
  };
  EMB.heart = function (x, w) {
    var c = w / 2; x.fillStyle = '#d8233a'; x.beginPath(); x.moveTo(c, c + 100);
    x.bezierCurveTo(c - 20, c + 70, c - 110, c + 30, c - 110, c - 30); x.bezierCurveTo(c - 110, c - 95, c - 25, c - 105, c, c - 50);
    x.bezierCurveTo(c + 25, c - 105, c + 110, c - 95, c + 110, c - 30); x.bezierCurveTo(c + 110, c + 30, c + 20, c + 70, c, c + 100); x.fill();
  };

  // ════════ Gothic / Industrial (Industrial goth, Gothic reaper, Victorian goth) ════════
  var GC = { nori: 0x17231a, rice: 0xf7f4ea, salmon: 0xff7f50, tuna: 0xc8283c, cucumber: 0x6fbf4a };
  // Maki: Nori-Wand, Reis-Ring, Füllung (Achse = y)
  function maki(r, fill) {
    var g = new THREE.Group();
    add(g, cyl(r, r, r * 1.1, 28), fabric(GC.nori, { roughness: 0.6 }));
    add(g, cyl(r * 0.9, r * 0.9, r * 1.12, 28), fabric(GC.rice, { roughness: 0.95 }));
    add(g, cyl(r * 0.38, r * 0.38, r * 1.14, 20), M(fill || GC.salmon, { roughness: 0.35 }));
    return g;
  }
  function chainLinks(parent, pts, mat, size) {   // Kettenglieder entlang einer Linie, abwechselnd gedreht
    var curve = new THREE.CatmullRomCurve3(pts), L = curve.getLength(), n = Math.max(4, Math.round(L / (size * 1.6)));
    for (var i = 0; i <= n; i++) {
      var p = curve.getPointAt(i / n), t = curve.getTangentAt(i / n), l = add(parent, torus(size, size * 0.28, 16), mat);
      l.position.copy(p); l.quaternion.setFromUnitVectors(new V3(0, 0, 1), new V3().crossVectors(t, new V3(0, 1, 0)).normalize().lengthSq() > 0 ? new V3().crossVectors(t, new V3(0, 1, 0)).normalize() : new V3(1, 0, 0));
      l.rotateOnAxis(new V3(0, 0, 1), 0); l.scale.set(1.5, 1, 1); if (i % 2) l.rotateOnWorldAxis(t, PI / 2);
    }
  }
  function steel() { return metal(0x8d9096, { roughness: 0.35 }); }
  function rust() { return metal(0x7a4a2a, { roughness: 0.75, metalness: 0.55 }); }

  // ── A Industrial: Gasmaske, Schweißerbrille, Cyber-Dreads ──
  ACC.gasmask = function (c) {
    var rub = M(0x1a1a1d, { roughness: 0.55, clearcoat: 0.3 }), st = steel();
    var cup = add(c.g, sph(1, 32), rub); cup.scale.set(0.44, 0.3, 0.36); cup.position.set(1.3, 0.89, 0); cup.rotation.z = -0.1; cup.name = 'Mask';
    var nose = add(c.g, cyl(0.1, 0.12, 0.1, 24), st); nose.rotation.z = PI / 2; nose.position.set(1.72, 0.86, 0); nose.name = 'Valve';
    [-1, 1].forEach(function (s) {
      var f = new THREE.Group(); f.position.set(1.4, 0.8, s * 0.3); f.rotation.set(s * -0.9, 0, 0.5); c.g.add(f);
      add(f, cyl(0.1, 0.1, 0.14, 24), rust());
      add(f, cyl(0.105, 0.105, 0.03, 24), st, 0, 0.07);
      for (var k = 0; k < 4; k++) add(f, cyl(0.012, 0.012, 0.2, 6), st, -0.06 + k * 0.04, 0.085, 0).rotation.x = PI / 2;
    });
    var h = hatBase(c, -0.05, 0), r = h.userData.r, band = add(h, torus(r + 0.02, 0.03, 64), rub); band.rotation.x = PI / 2; h.rotation.z = -0.35;
  };
  ACC.goggles = function (c) {
    var h = hatBase(c, 0.3, 0), r = h.userData.r; h.rotation.z = 0.22;
    var strap = add(h, torus(r + 0.015, 0.035, 64), M(0x2a2420, { roughness: 0.7 })); strap.rotation.x = PI / 2; strap.scale.z = 1.4; strap.name = 'Strap';
    [-1, 1].forEach(function (s) {
      var dir = new V3(0.72, 0.62, s * 0.3).normalize(), p = c.headPoint(dir, 1.0), g = new THREE.Group();
      g.position.copy(p); g.lookAt(p.clone().add(dir)); c.g.add(g);
      add(g, cyl(0.13, 0.15, 0.12, 28), rust(), 0, 0, 0.05).rotation.x = PI / 2;
      var lens = add(g, new THREE.CircleGeometry(0.11, 28), M(0x39ff14, { roughness: 0.05, clearcoat: 1, emissive: 0x1d8a0a, emissiveIntensity: 0.6 })); lens.position.z = 0.115;
      for (var k = 0; k < 6; k++) { var a = k / 6 * PI * 2; add(g, sph(0.015, 8), steel(), Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.11); }
    });
  };
  ACC.cyberdreads = function (c, a) {
    var neon = M(a.color || 0x39ff14, { roughness: 0.35, emissive: 0x0f4a06, emissiveIntensity: 0.5 }), blk = M(0x111114, { roughness: 0.6 });
    var n = 16;
    for (var i = 0; i < n; i++) {
      var s = (i / (n - 1)) * 2 - 1, root0 = c.headPoint(new V3(-0.35 - 0.2 * (1 - Math.abs(s)), 0.85, s * 0.75).normalize(), 0.98);
      var sway = (i % 3 - 1) * 0.08, pts = [root0, root0.clone().add(new V3(-0.25, 0.05, s * 0.12)), root0.clone().add(new V3(-0.45 + sway, -0.45, s * 0.25)), root0.clone().add(new V3(-0.5 + sway, -0.95, s * 0.32))];
      tube(pts, 0.04, i % 3 === 1 ? blk : neon, c.g);
      add(c.g, cyl(0.05, 0.05, 0.06, 12), steel(), pts[2].x, pts[2].y, pts[2].z);
    }
    var bun = add(c.g, sph(0.2, 20), blk); bun.position.copy(c.headPoint(new V3(-0.4, 0.9, 0).normalize(), 1.0));
  };

  // ── B Gothic Reaper: rostige Sense mit aufgespießten Maki, Kette quer über die Brust ──
  ACC.sushiscythe = function (c) {
    var h = held(c, 1).add(new V3(0, 0, 0.08));
    add(c.g, cyl(0.032, 0.032, 2.3, 10), M(0x16120f, { roughness: 0.6 }), h.x, h.y + 0.35, h.z);
    var bl = add(c.g, torus(0.42, 0.04, 40, PI * 0.55), rust()); bl.position.set(h.x - 0.38, h.y + 1.42, h.z); bl.rotation.z = 0.2; bl.scale.set(1, 1, 0.25);
    var edge = add(c.g, torus(0.455, 0.012, 40, PI * 0.55), metal(0xdfe3e8, { roughness: 0.1 })); edge.position.copy(bl.position); edge.rotation.z = 0.2; edge.scale.set(1, 1, 0.3);
    [1.02, 0.66].forEach(function (y, k) { var mk = maki(0.17, k ? GC.cucumber : GC.tuna); mk.position.set(h.x, h.y + y, h.z); mk.rotation.set(PI / 2, 0, 0.5); c.g.add(mk); });
    add(c.g, cyl(0.05, 0.03, 0.12, 10), steel(), h.x, h.y + 1.52, h.z);
  };
  ACC.crosschain = function (c) {
    var pts = [U.surface(new V3(0.6, 0.62, 0.62)).p, U.surface(new V3(1, 0.25, 0.1)).p, U.surface(new V3(0.9, -0.2, -0.55)).p, U.surface(new V3(0.2, -0.3, -1)).p]
      .map(function (p, i, A) { return p.clone().multiplyScalar(1.03); });
    chainLinks(c.g, pts, steel(), 0.035);
  };

  // ── C Victorian Goth: Zylinder mit Schleier, Choker mit Kamee, Korsett-Schnürung ──
  ACC.tophat = function (c) {
    var h = hatBase(c, 0.34, 0), r = h.userData.r; h.rotation.z = 0.1; h.position.z = -0.08;
    var blk = fabric(0x0e0e11, { roughness: 0.55 }), vel = fabric(0x4a1460, { roughness: 0.9 });
    add(h, cyl(r + 0.22, r + 0.22, 0.025, 64), blk, 0, 0.012);
    add(h, cyl(r * 0.78, r * 0.86, 0.62, 48), blk, 0, 0.33);
    add(h, cyl(r * 0.87, r * 0.875, 0.12, 48), vel, 0, 0.08);
    // schwarze Feder seitlich am Band, nach hinten geschwungen
    var fpts = [new V3(r * 0.3, 0.12, r * 0.86), new V3(-r * 0.2, 0.45, r * 1.0), new V3(-r * 0.9, 0.7, r * 0.8), new V3(-r * 1.4, 0.62, r * 0.5)];
    var curve = new THREE.CatmullRomCurve3(fpts), fm = M(0x0c0c10, { roughness: 0.6, side: THREE.DoubleSide });
    for (var i = 0; i <= 14; i++) {
      var t = i / 14, p = curve.getPointAt(t), w = Math.sin(t * PI) * 0.16 + 0.02, b = add(h, sph(1, 12), fm);
      b.position.copy(p); b.scale.set(0.06, w, 0.012); b.lookAt(p.clone().add(new V3(0, 0, 1))); b.rotation.z += 0.9 - t;
    }
    tube(fpts, 0.008, fm, h);
    // Rosen am Band
    [[r * 0.6, 0.1, r * 0.62], [r * 0.4, 0.09, r * 0.78]].forEach(function (q, i) {
      add(h, sph(0.06, 12), M(i ? 0x2a0a10 : 0x7a0a1e, { roughness: 0.5 }), q[0], q[1], q[2]);
    });
  };
  ACC.choker = function (c) {
    var vel = fabric(0x0c0c0f, { roughness: 0.95 }), t = add(c.g, torus(0.45, 0.04, 48), vel); t.position.set(0.44, 0.72, 0); t.rotation.set(PI / 2, -0.28, 0); t.scale.set(1, 1.04, 1);
    var at = U.surfaceAt(0.62, 0, 0.42), g = new THREE.Group(); g.position.copy(at.p).addScaledVector(at.n, 0.04); g.lookAt(g.position.clone().add(at.n)); c.g.add(g);
    var fr = add(g, torus(0.075, 0.014, 24), metal(0xc9ccd2, { roughness: 0.15 })); fr.scale.y = 1.25;
    var cam = add(g, new THREE.CircleGeometry(0.072, 24), M(0x2a0a10, { roughness: 0.3 })); cam.scale.y = 1.25;
    var face = add(g, sph(0.035, 12), M(0xf1ebe2), 0, 0.005, 0.01); face.scale.set(0.8, 1.2, 0.3);
  };
  ACC.corset = function (c) {
    var lace = M(0x111114, { roughness: 0.5 }), bone = fabric(0x1a0a22, { roughness: 0.4, clearcoat: 0.6 });
    var ys = [0.18, 0.08, -0.02, -0.12, -0.22];
    for (var i = 0; i < ys.length - 1; i++) {
      [[-1, 1], [1, -1]].forEach(function (d) {
        var a = U.surface(new V3(1, ys[i], d[0] * 0.13)).p, b = U.surface(new V3(1, ys[i + 1], d[1] * 0.13)).p;
        tube([a.clone().multiplyScalar(1.025), a.clone().lerp(b, 0.5).multiplyScalar(1.035), b.clone().multiplyScalar(1.025)], 0.01, lace, c.g);
      });
    }
    ys.forEach(function (y) { [-1, 1].forEach(function (s) { var e = U.surface(new V3(1, y, s * 0.13)); add(c.g, torus(0.018, 0.007, 12), metal(0xc9ccd2), 0, 0, 0).position.copy(e.p.clone().addScaledVector(e.n, 0.02)); }); });
    [-1, 1].forEach(function (s) { tube([0.24, 0.1, -0.05, -0.26].map(function (y) { return U.surface(new V3(1, y, s * 0.3)).p.multiplyScalar(1.02); }), 0.018, bone, c.g); });
  };


  // Anzeigenamen der Bausteine (Duck-Editor)
  Object.assign(RD.ACC_LABELS || {}, {
    afro: 'Afro', angelwings: 'Angel wings', antennae: 'Antennae', astro: 'Space helmet', backpack: 'Backpack',
    ballchain: 'Ball and chain', beard: 'Beard', beer: 'Beer mug', beewings: 'Bee wings', bolts: 'Neck bolts',
    bowtie: 'Bow tie', broom: 'Broom', brows: 'Eyebrows', buttons: 'Buttons', chain: 'Chain', claws: 'Claws',
    clownwig: 'Clown wig', cowboy: 'Cowboy hat', crown: 'Crown', ears: 'Ears', eyepatch: 'Eye patch',
    eyepatches: 'Eye patches', fangs: 'Fangs', flattop: 'Flat top hair', football: 'Football', glasses: 'Glasses',
    halfmic: 'Mic stand', halo: 'Halo', hammer: 'Hammer', headband: 'Headband', headmirror: 'Head mirror',
    headset: 'Headset', highcollar: 'High collar', shape: 'Shape', hood: 'Hood', horns: 'Horns', katana: 'Katana',
    knighthelm: 'Knight helmet', leaves: 'Leaves', longhair: 'Long hair', mane: 'Mane', mustache: 'Moustache',
    neckerchief: 'Neckerchief', necklace: 'Necklace', palette: 'Paint palette', pan: 'Pan', parrot: 'Parrot',
    pompadour: 'Pompadour', prisonercap: 'Prisoner cap', pubghelm: 'Level 3 helmet', pumpkinhead: 'Pumpkin head',
    rednose: 'Red nose', ruffle: 'Ruffle collar', santa: 'Santa hat', scarf: 'Scarf', scepter: 'Sceptre',
    scythe: 'Scythe', shield: 'Shield', stethoscope: 'Stethoscope', stinger: 'Stinger', stitches: 'Stitches',
    tiara: 'Tiara', tie: 'Tie', toque: 'Chef hat', tricorn: 'Tricorn', trident: 'Trident', tufts: 'Hair tufts',
    tyrolean: 'Tyrolean hat', unihorn: 'Unicorn horn', vest: 'Vest', vikinghelm: 'Viking helmet', wand: 'Magic wand',
    wildhair: 'Wild hair', wingears: 'Winged ears', wingedhelm: 'Winged helmet', witch: 'Witch hat',
    wizard: 'Wizard hat', loincloth: 'Loincloth', club: 'Club', tailcoat: 'Tailcoat', tray: 'Serving tray',
    zipper: 'Mouth zipper', studcollar: 'Studded collar', harness: 'Chest harness', whip: 'Whip', racehelm: 'Racing helmet',
    racestripes: 'Racing stripes', wheel: 'Steering wheel', bow: 'Bow and heart arrow', curls: 'Curls', tutu: 'Tutu',
    bun: 'Hair bun', exechood: 'Executioner hood', axe: 'Axe', biceps: 'Biceps', dumbbell: 'Dumbbell', donut: 'Donut',
    bra: 'Lace bra', lacepanties: 'Lace panties', garter: 'Garter belt', boa: 'Feather boa', lashes: 'Eyelashes',
    openvest: 'Open vest', sword: 'Sword', kiteshield: 'Kite shield', judgewig: 'Judge wig', gavel: 'Gavel', forelock: 'Forelock', gunbelt: 'Gun belt', grass: 'Blade of grass',
    gasmask: 'Gas mask', goggles: 'Welding goggles', cyberdreads: 'Cyber dreads', sushiscythe: 'Sushi scythe',
    crosschain: 'Chest chain', tophat: 'Top hat', choker: 'Velvet choker', corset: 'Corset lacing'
  });

  // ════════ Outfits ════════
  // cat: heroes | horror | jobs | fun | celebs
  RD.addOutfits({
    // ── Helden & Schurken ──
    hulk: { label: 'Hulk', cat: 'heroes', skin: 0x5a9a2a, briefs: 0x5b2a86, briefsY: -0.18, hair: 0x15161a, hairY: 0.4, acc: [['brows']] },
    spiderman: { label: 'Spider-Man', cat: 'heroes', skin: 0xc8151b, briefs: 0x1f3f9e, briefsY: -0.12, bill: 0xc8151b, eyes: 'lens', chest: 'spider', chestSize: 0.42, pattern: { type: 'web', c2: 0x14141a, scale: 5, zone: 'all' } },
    ironman: { label: 'Iron Man', cat: 'heroes', skin: 0xa8121c, mat: { metalness: 0.55, roughness: 0.3, envMapIntensity: 1.2 }, face: 0xd9a93a, faceX: 0.2, briefs: 0xd9a93a, briefsY: -0.32, bill: 0xd9a93a, eyes: 'glow', eyeColor: 0xdff6ff, chest: 'arc', chestSize: 0.3, chestY: 0.05 },
    captain: { label: 'Captain America', cat: 'heroes', suit: 0x1f3f9e, collar: 1.0, cowl: 0x1f3f9e, belt: 0x6b4a2c, beltY: -0.12, chest: 'capstar', chestSize: 0.38, chestY: 0.12, pattern: { type: 'hstripes', c1: 0xc8151b, c2: 0xf4f4f4, scale: 9, zone: 'suit', y: [-0.7, -0.16] }, acc: [['wingears', { color: 'white' }], ['shield']] },
    thor: { label: 'Thor', cat: 'heroes', suit: 0x2c3038, collar: 0.6, chest: 'discs', chestSize: 0.5, cape: 0xb3121e, acc: [['wingedhelm'], ['beard', { style: 'chin', color: 0xd9a63c }], ['hammer']] },
    wolverine: { label: 'Wolverine', cat: 'heroes', suit: 0xf4c20d, collar: 0.55, cowl: 0xf4c20d, briefs: 0x1c2e78, briefsY: -0.15, belt: 0xc8151b, beltY: -0.13, mask: 0x141414, eyes: 'white', acc: [['ears', { shape: 'fin', color: 0x141414 }], ['claws']] },
    flash: { label: 'The Flash', cat: 'heroes', skin: 0xc8151b, belt: 0xf2c500, beltY: -0.22, suit: 0xc8151b, collar: 2, chest: 'bolt', chestSize: 0.36, chestY: 0.05, bill: 0xc8151b, acc: [['wingears']] },
    wonder: { label: 'Wonder Woman', cat: 'heroes', suit: 0xb3121e, collar: 0.5, briefs: 0x1f3f9e, briefsY: -0.2, belt: 0xe2b62a, beltY: -0.17, chest: 'ww', chestSize: 0.5, chestY: 0.08, hair: 0x141414, hairY: 0.3, pattern: { type: 'dots', c2: 0xf4f4f4, scale: 9, zone: 'suit', y: [-0.7, -0.24] }, acc: [['tiara'], ['longhair']] },
    deadpool: { label: 'Deadpool', cat: 'heroes', skin: 0xa3111a, bill: 0xa3111a, belt: 0x2a2a2a, beltY: -0.2, suit: 0xa3111a, collar: 2, eyes: 'lens', acc: [['eyepatches'], ['katana', { two: true }]] },
    panther: { label: 'Black Panther', cat: 'heroes', skin: 0x18181c, bill: 0x2a2a30, mat: { roughness: 0.35 }, eyes: 'white', acc: [['ears', { shape: 'cat', color: 0x18181c }], ['necklace']] },
    robin: { label: 'Robin', cat: 'heroes', suit: 0xc8151b, collar: 0.55, briefs: 0x1f7a2e, briefsY: -0.15, belt: 0xf2c500, beltY: -0.13, mask: 0x141414, eyes: 'white', hair: 0x141414, hairY: 0.32, cape: 0xf2c500, chest: 'robin', chestSize: 0.24, chestY: 0.15 },
    groot: { label: 'Groot', cat: 'heroes', skin: 0x7a5434, bill: 0x6b4a2c, pattern: { type: 'fur', c1: 0x5e4029, c2: 0x9a7048, scale: 7, zone: 'all' }, acc: [['leaves']] },
    joker: { label: 'Joker', cat: 'heroes', skin: 0xf1ede4, suit: 0x5b2a86, collar: 0.55, stripe: 0x2f8f3e, stripes: [0.3], bill: 0xc8151b, hair: 0x2fa84a, hairY: 0.3, acc: [['tufts'], ['bowtie', { color: 0x2f8f3e }]] },
    luckyluke: { label: 'Lucky Luke', cat: 'heroes', suit: 0xf7cf1a, collar: 0.55, briefs: 0x2c4f8a, briefsY: -0.12, acc: [['cowboy', { color: 0xf4f2ea }], ['forelock'], ['neckerchief', { color: 0xc8151b }], ['openvest'], ['gunbelt'], ['grass']] },

    // ── Halloween & Horror ──
    vampire: { label: 'Vampire', cat: 'horror', skin: 0xe9e6ea, suit: 0x141418, collar: 0.55, cape: 0x141418, hair: 0x0d0d0f, hairY: 0.3, hairPeak: 0.16, eyeColor: 0xb3121e, acc: [['highcollar', { inner: 0x9a0f18 }], ['fangs']] },
    witch: { label: 'Witch', cat: 'horror', skin: 0x8cc63f, suit: 0x231a2e, collar: 0.55, acc: [['witch'], ['longhair', { color: 0x231a2e }], ['broom']] },
    zombie: { label: 'Zombie', cat: 'horror', skin: 0x8fa37a, bill: 0x7d6a55, suit: 0x5b4a3a, collar: 0.42, eyeColor: 0xd8d2a0, pattern: { type: 'camo', c1: 0x6a7a58, c2: 0x8a2a1e, scale: 4, zone: 'skin' }, acc: [['stitches']] },
    mummy: { label: 'Mummy', cat: 'horror', skin: 0xe6dcc0, bill: 0xd8ccb0, mask: 0x2a2218, eyes: 'glow', eyeColor: 0xffe24a, pattern: { type: 'bandage', c1: 0xe9dfc6, c2: 0x6b5a3e, scale: 7, zone: 'all' } },
    frankenstein: { label: 'Frankenstein', cat: 'horror', skin: 0x86b35a, hair: 0x111114, hairY: 0.36, suit: 0x2b2b30, collar: 0.5, eyes: 'sleepy', acc: [['flattop'], ['bolts'], ['stitches']] },
    skeleton: { label: 'Skeleton', cat: 'horror', skin: 0x17171b, bill: 0xf1ede0, face: 0xf1ede0, faceX: -0.12, eyes: 'sockets', pattern: { type: 'ribs', c2: 0xf1ede0, scale: 6, zone: 'all' } },
    pumpkin: { label: 'Pumpkin head', cat: 'horror', suit: 0x1a1a1a, collar: 0.7, noBill: true, eyes: 'none', acc: [['pumpkinhead']] },
    ghost: { label: 'Ghost', cat: 'horror', skin: 0xf4f6fa, ghost: true, bill: 0xe2e6ee, eyes: 'sockets' },
    devil: { label: 'Devil', cat: 'horror', skin: 0xb8141c, bill: 0x7a0d12, eyeColor: 0xffd400, acc: [['horns'], ['brows'], ['beard', { style: 'chin', color: 0x141414 }], ['trident', { color: 0x1a1a1a }]] },
    werewolf: { label: 'Werewolf', cat: 'horror', skin: 0x6e5236, bill: 0x3a2a1e, eyeColor: 0xf2c500, pattern: { type: 'fur', c1: 0x5a4129, c2: 0x8a6a46, scale: 9, zone: 'all' }, acc: [['ears', { shape: 'pointy', color: 0x5a4129 }], ['brows']] },
    reaper: { label: 'Grim Reaper', cat: 'horror', suit: 0x0f0f12, collar: 2, face: 0x050505, faceX: -0.5, bill: 0x111114, eyes: 'glow', eyeColor: 0xff2a2a, acc: [['hood'], ['scythe']] },
    alien: { label: 'Alien', cat: 'horror', skin: 0x7ad04a, bill: 0x5aa83a, suit: 0xb9bfc8, collar: 0.5, mat: { roughness: 0.4 }, eyes: 'big', acc: [['antennae', { color: 0x5aa83a, tip: 0x7ad04a }]] },
    cyclops: { label: 'Cyclops', cat: 'horror', skin: 0x93ad6c, bill: 0xb07a3a, eyes: 'one', eyeColor: 0x7a3a1a, acc: [['brows', { one: true }], ['loincloth'], ['club']] },
    executioner: { label: 'Executioner', cat: 'horror', cowl: 0x111113, wing: 0x141414, briefs: 0x1a1a1c, briefsY: -0.08, acc: [['exechood'], ['axe']] },

    // ── Berufe & Comedy ──
    pirate: { label: 'Pirate', cat: 'jobs', suit: 0xf4f4f4, collar: 0.55, belt: 0x3a2a1e, beltY: -0.25, pattern: { type: 'hstripes', c1: 0xf4f4f4, c2: 0xb3121e, scale: 8, zone: 'suit' }, acc: [['tricorn'], ['eyepatch'], ['parrot']] },
    chef: { label: 'Chef', cat: 'jobs', suit: 0xf6f6f6, collar: 0.55, acc: [['toque'], ['mustache', { style: 'curl' }], ['neckerchief'], ['buttons', { double: true }]] },
    cowboy: { label: 'Cowboy', cat: 'jobs', suit: 0x3c5a8a, collar: 0.55, belt: 0x5a3a22, beltY: -0.22, chest: 'sheriff', chestSize: 0.24, chestY: 0.12, acc: [['cowboy'], ['neckerchief', { triangle: true }]] },
    astronaut: { label: 'Astronaut', cat: 'jobs', suit: 0xeef0f3, collar: 0.55, belt: 0x8d939b, beltY: -0.2, chest: 'mission', chestSize: 0.28, chestY: 0.1, acc: [['astro']] },
    ninja: { label: 'Ninja', cat: 'jobs', skin: 0x16161a, mask: 0xf6bd16, bill: 0x2a2a30, acc: [['headband', { tails: true, dy: 0.38 }], ['katana']] },
    knight: { label: 'Knight', cat: 'jobs', skin: 0xb9bec6, mat: { metalness: 0.75, roughness: 0.3, envMapIntensity: 1.1 }, chest: 'cross', chestSize: 0.4, acc: [['knighthelm'], ['sword'], ['kiteshield']] },
    viking: { label: 'Viking', cat: 'jobs', suit: 0x6b4a2c, collar: 0.55, belt: 0x2a1e14, beltY: -0.2, acc: [['vikinghelm'], ['beard', { style: 'long', color: 0xd27a2c }], ['scarf', { color: 0x8a8378, thick: 0.12 }]] },
    king: { label: 'King', cat: 'jobs', suit: 0x7b1522, collar: 0.55, cape: 0x7b1522, acc: [['crown'], ['chain', { medal: true }], ['scepter'], ['scarf', { color: 0xfaf7ef, thick: 0.09 }]] },
    prisoner: { label: 'Prisoner', cat: 'jobs', suit: 0xf2f2f2, collar: 0.55, chest: 'num1337', chestSize: 0.42, chestY: 0.15, pattern: { type: 'hstripes', c1: 0xf2f2f2, c2: 0x141414, scale: 7, zone: 'suit' }, acc: [['prisonercap'], ['ballchain']] },
    doctor: { label: 'Doctor', cat: 'jobs', suit: 0xf6f6f6, collar: 0.55, chest: 'redcross', chestSize: 0.18, chestY: 0.25, acc: [['headmirror'], ['stethoscope']] },
    judge: { label: 'Judge', cat: 'jobs', suit: 0x141418, collar: 0.62, acc: [['judgewig'], ['bowtie', { color: 0xfafafa }], ['gavel']] },
    clown: { label: 'Clown', cat: 'jobs', suit: 0xf4f4f4, collar: 0.55, face: 0xffffff, faceX: 0.05, pattern: { type: 'dots', c2: 0xe6312e, scale: 5, zone: 'suit' }, acc: [['clownwig'], ['rednose'], ['ruffle', { colors: [0xffffff, 0xf2c500, 0x1f5fd0] }]] },
    santa: { label: 'Santa', cat: 'jobs', suit: 0xc8151b, collar: 0.55, belt: 0x141414, beltY: -0.18, stripe: 0xf4f4f4, stripes: [-0.42], acc: [['santa'], ['beard', { style: 'long' }], ['mustache', { style: 'walrus', color: 0xf4f4f4 }]] },
    bavarian: { label: 'Bavarian', cat: 'jobs', suit: 0xf4f4f4, collar: 0.55, briefs: 0x6b4a2c, briefsY: -0.05, pattern: { type: 'suspenders', c2: 0x6b4a2c, zone: 'suit', y: [-0.1, 0.6] }, acc: [['tyrolean'], ['beer']] },
    football: { label: 'Football fan', cat: 'jobs', suit: 0xf4f4f4, collar: 0.55, stripe: 0x141414, stripe2: 0xdd0000, stripes: [0.33, 0.24], belt: 0xffce00, beltY: 0.15, briefs: 0x141414, briefsY: -0.3, chest: 'num10', chestSize: 0.36, chestY: -0.12, acc: [['football']] },
    butler: { label: 'Butler', cat: 'jobs', suit: 0x141418, collar: 0.55, wing: 0xfafafa, hair: 0x2a2a2e, hairY: 0.4, acc: [['tailcoat'], ['bowtie'], ['buttons', { ys: [0.12, 0.0, -0.1] }], ['mustache', { color: 0x2a2a2e }], ['tray']] },

    // ── Spaß ──
    bee: { label: 'Bee', cat: 'fun', skin: 0xf2c500, pattern: { type: 'hstripes', c1: 0xf2c500, c2: 0x1a1a1a, scale: 5, zone: 'all', y: [-0.6, 0.55] }, acc: [['antennae'], ['beewings'], ['stinger']] },
    unicorn: { label: 'Unicorn', cat: 'fun', skin: 0xf7dcec, bill: 0xf08ab8, acc: [['unihorn'], ['mane']] },
    angel: { label: 'Angel', cat: 'fun', suit: 0xfafafa, collar: 0.55, belt: 0xe2b62a, beltY: -0.15, acc: [['halo'], ['angelwings']] },
    wizard: { label: 'Wizard', cat: 'fun', suit: 0x2a3a8f, collar: 0.55, pattern: { type: 'dots', c2: 0xf2c500, scale: 6, zone: 'suit' }, acc: [['wizard'], ['beard', { style: 'long' }], ['wand']] },
    hippie: { label: 'Hippie', cat: 'fun', suit: 0xffffff, collar: 0.55, chest: 'peace', chestSize: 0.32, chestY: 0.05, pattern: { type: 'tiedye', scale: 3, zone: 'suit' }, acc: [['glasses', { round: true, lens: 0xf28c1e, opacity: 0.55, frame: 'gold' }], ['headband', { color: 0x8a3fb0, flower: 0xe6312e, dy: 0.34 }], ['longhair', { color: 0x6b4a2c }]] },
    pubg: { label: 'PUBG player', cat: 'fun', suit: 0x5c6140, collar: 0.55, pattern: { type: 'camo', c1: 0x3f4430, c2: 0x7a7556, scale: 3, zone: 'suit' }, acc: [['pubghelm'], ['vest'], ['pan']] },
    streamer: { label: 'Streamer', cat: 'fun', suit: 0x5e2a79, collar: 0.55, stripe: 0xf2b705, stripes: [-0.3], chest: 'gg', chestSize: 0.34, chestY: 0.02, acc: [['headset']] },
    bdsm: { label: 'BDSM', cat: 'fun', cowl: 0x141416, bill: 0x1c1c1e, eyes: 'white', wing: 0x141416, briefs: 0x141416, briefsY: -0.12, acc: [['zipper'], ['studcollar'], ['harness'], ['whip']] },
    racer: { label: 'Racing driver', cat: 'fun', suit: 0xf4f4f4, collar: 0.55, wing: 0x1a1a1c, acc: [['racehelm'], ['racestripes'], ['wheel']] },
    cupid: { label: 'Cupid', cat: 'fun', skin: 0xf7c6d6, briefs: 0xfafafa, briefsY: -0.22, chest: 'heart', chestSize: 0.22, chestY: 0.1, acc: [['curls'], ['angelwings', { size: 0.7 }], ['bow']] },
    tutu: { label: 'Tutu', cat: 'fun', suit: 0xf4a6c8, collar: 0.55, hair: 0x6b4a2c, hairY: 0.42, acc: [['bun'], ['tiara'], ['tutu']] },
    pochinki: { label: 'Pochinki', cat: 'fun', suit: 0x5f646b, collar: 0.55, chest: 'pochinki', chestSize: 0.62, chestY: 0.02, acc: [['pan']] },
    muscle: { label: 'Muscle duck', cat: 'fun', skin: 0xe9a13b, muscles: true, pattern: { type: 'abs', c2: 0x8a4a10, zone: 'skin' }, acc: [['headband', { color: 0xc8151b, dy: 0.36 }], ['brows'], ['biceps'], ['dumbbell']] },
    fat: { label: 'Fat duck', cat: 'fun', girth: 1.5, acc: [['donut']] },
    lingerie: { label: 'Lace lingerie', cat: 'fun', bill: 0xd8152a, acc: [['bra'], ['lacepanties'], ['garter'], ['boa'], ['lashes']] },
    industrial: { label: 'Industrial goth', cat: 'fun', skin: 0x232327, suit: 0x16161a, collar: 0.6, bill: 0x2a2a2e, acc: [['cyberdreads'], ['goggles'], ['gasmask'], ['studcollar'], ['chain', { color: 0x9a9da3 }]] },
    gothreaper: { label: 'Gothic reaper', cat: 'horror', skin: 0x0c0c0e, suit: 0x0c0c0e, collar: 2, face: 0x050505, faceX: -0.5, bill: 0x111114, eyes: 'glow', eyeColor: 0xff2a2a, acc: [['hood'], ['sushiscythe'], ['crosschain']] },
    victorian: { label: 'Victorian goth', cat: 'fun', skin: 0xa79fb3, suit: 0x0e0e11, collar: 0.62, collarDip: 0.45, collarV: 1, bill: 0x3a1f4a, acc: [['tophat'], ['choker'], ['corset'], ['lashes']] },

    // ── Berühmtheiten ──
    elvis: { label: 'Elvis', cat: 'celebs', suit: 0xf7f5ef, collar: 0.5, belt: 0xe2b62a, beltY: -0.22, pattern: { type: 'dots', c2: 0xe2b62a, scale: 10, zone: 'suit', y: [-0.18, 0.5] }, acc: [['pompadour'], ['glasses', { lens: 0x7a5a20, opacity: 0.8, frame: 'gold' }], ['highcollar', { color: 0xf7f5ef }]] },
    einstein: { label: 'Einstein', cat: 'celebs', suit: 0x6a6c70, collar: 0.55, hair: 0xe8e8e8, hairY: 0.42, acc: [['wildhair'], ['mustache', { style: 'walrus', color: 0xe8e8e8 }], ['tie', { color: 0x3a3a40 }]] },
    bobross: { label: 'Bob Ross', cat: 'celebs', suit: 0x9cc3e6, collar: 0.55, briefs: 0x3b5f8a, briefsY: -0.25, acc: [['afro', { color: 0x6b4a2c }], ['beard', { style: 'full', color: 0x6b4a2c }], ['palette']] },
    freddie: { label: 'Freddie Mercury', cat: 'celebs', suit: 0xf4f4f4, collar: 0.55, wing: 0xf5c518, belt: 0x141414, beltY: -0.2, hair: 0x111114, hairY: 0.38, acc: [['mustache', { style: 'thick' }], ['halfmic']] }
  });
})(this);
