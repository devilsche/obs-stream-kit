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
  function tube(pts, r, mat, parent, closed) {
    var curve = new THREE.CatmullRomCurve3(pts.map(function (p) { return p instanceof V3 ? p : new V3(p[0], p[1], p[2]); }), !!closed);
    var m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, pts.length * 12), r, 10, !!closed), mat);
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
  ACC.highcollar = function (c, a) {
    var geo = cyl(0.66, 0.46, 0.42, 40, true, PI * 0.78, PI * 1.44);
    var out = add(c.g, geo, M(a.color || 0x141418, { roughness: 0.6 })), inn = add(c.g, geo, M(a.inner || a.color || 0x141418, { roughness: 0.6, side: THREE.BackSide }));
    [out, inn].forEach(function (m) { m.position.set(0.38, 0.82, 0); m.rotation.z = 0.18; });
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
  function held(c, s) { return new V3(0.38, 0.08, s * 0.92); }
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
  ACC.angelwings = function (c) {
    var m = fabric(0xfafafa, { roughness: 0.7 });
    [-1, 1].forEach(function (s) { for (var i = 0; i < 5; i++) { var f = add(c.g, ell(0.08, 0.38 - i * 0.04, 0.03, 16), m); f.position.set(-0.45 - i * 0.06, 0.85 + i * 0.03, s * (0.45 + i * 0.05)); f.rotation.set(s * 0.6, 0, 0.9 + i * 0.18); } });
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

    // ── Berufe & Comedy ──
    pirate: { label: 'Pirate', cat: 'jobs', suit: 0xf4f4f4, collar: 0.55, belt: 0x3a2a1e, beltY: -0.25, pattern: { type: 'hstripes', c1: 0xf4f4f4, c2: 0xb3121e, scale: 8, zone: 'suit' }, acc: [['tricorn'], ['eyepatch'], ['parrot']] },
    chef: { label: 'Chef', cat: 'jobs', suit: 0xf6f6f6, collar: 0.55, acc: [['toque'], ['mustache', { style: 'curl' }], ['neckerchief'], ['buttons', { double: true }]] },
    cowboy: { label: 'Cowboy', cat: 'jobs', suit: 0x3c5a8a, collar: 0.55, belt: 0x5a3a22, beltY: -0.22, chest: 'sheriff', chestSize: 0.24, chestY: 0.12, acc: [['cowboy'], ['neckerchief', { triangle: true }]] },
    astronaut: { label: 'Astronaut', cat: 'jobs', suit: 0xeef0f3, collar: 0.55, belt: 0x8d939b, beltY: -0.2, chest: 'mission', chestSize: 0.28, chestY: 0.1, acc: [['astro']] },
    ninja: { label: 'Ninja', cat: 'jobs', skin: 0x16161a, mask: 0xf6bd16, bill: 0x2a2a30, acc: [['headband', { tails: true, dy: 0.38 }], ['katana']] },
    knight: { label: 'Knight', cat: 'jobs', skin: 0xb9bec6, mat: { metalness: 0.75, roughness: 0.3, envMapIntensity: 1.1 }, chest: 'cross', chestSize: 0.4, acc: [['knighthelm']] },
    viking: { label: 'Viking', cat: 'jobs', suit: 0x6b4a2c, collar: 0.55, belt: 0x2a1e14, beltY: -0.2, acc: [['vikinghelm'], ['beard', { style: 'long', color: 0xd27a2c }], ['scarf', { color: 0x8a8378, thick: 0.12 }]] },
    king: { label: 'King', cat: 'jobs', suit: 0x7b1522, collar: 0.55, cape: 0x7b1522, acc: [['crown'], ['chain', { medal: true }], ['scepter'], ['scarf', { color: 0xfaf7ef, thick: 0.09 }]] },
    prisoner: { label: 'Prisoner', cat: 'jobs', suit: 0xf2f2f2, collar: 0.55, chest: 'num1337', chestSize: 0.42, chestY: 0.15, pattern: { type: 'hstripes', c1: 0xf2f2f2, c2: 0x141414, scale: 7, zone: 'suit' }, acc: [['prisonercap'], ['ballchain']] },
    doctor: { label: 'Doctor', cat: 'jobs', suit: 0xf6f6f6, collar: 0.55, chest: 'redcross', chestSize: 0.18, chestY: 0.25, acc: [['headmirror'], ['stethoscope']] },
    clown: { label: 'Clown', cat: 'jobs', suit: 0xf4f4f4, collar: 0.55, face: 0xffffff, faceX: 0.05, pattern: { type: 'dots', c2: 0xe6312e, scale: 5, zone: 'suit' }, acc: [['clownwig'], ['rednose'], ['ruffle', { colors: [0xffffff, 0xf2c500, 0x1f5fd0] }]] },
    santa: { label: 'Santa', cat: 'jobs', suit: 0xc8151b, collar: 0.55, belt: 0x141414, beltY: -0.18, stripe: 0xf4f4f4, stripes: [-0.42], acc: [['santa'], ['beard', { style: 'long' }], ['mustache', { style: 'walrus', color: 0xf4f4f4 }]] },
    bavarian: { label: 'Bavarian', cat: 'jobs', suit: 0xf4f4f4, collar: 0.55, briefs: 0x6b4a2c, briefsY: -0.05, pattern: { type: 'suspenders', c2: 0x6b4a2c, zone: 'suit', y: [-0.1, 0.6] }, acc: [['tyrolean'], ['beer']] },
    football: { label: 'Football fan', cat: 'jobs', suit: 0xf4f4f4, collar: 0.55, stripe: 0x141414, stripe2: 0xdd0000, stripes: [0.33, 0.24], belt: 0xffce00, beltY: 0.15, briefs: 0x141414, briefsY: -0.3, chest: 'num10', chestSize: 0.36, chestY: -0.12, acc: [['football']] },

    // ── Spaß ──
    bee: { label: 'Bee', cat: 'fun', skin: 0xf2c500, pattern: { type: 'hstripes', c1: 0xf2c500, c2: 0x1a1a1a, scale: 5, zone: 'all', y: [-0.6, 0.55] }, acc: [['antennae'], ['beewings'], ['stinger']] },
    unicorn: { label: 'Unicorn', cat: 'fun', skin: 0xf7dcec, bill: 0xf08ab8, acc: [['unihorn'], ['mane']] },
    angel: { label: 'Angel', cat: 'fun', suit: 0xfafafa, collar: 0.55, belt: 0xe2b62a, beltY: -0.15, acc: [['halo'], ['angelwings']] },
    wizard: { label: 'Wizard', cat: 'fun', suit: 0x2a3a8f, collar: 0.55, pattern: { type: 'dots', c2: 0xf2c500, scale: 6, zone: 'suit' }, acc: [['wizard'], ['beard', { style: 'long' }], ['wand']] },
    hippie: { label: 'Hippie', cat: 'fun', suit: 0xffffff, collar: 0.55, chest: 'peace', chestSize: 0.32, chestY: 0.05, pattern: { type: 'tiedye', scale: 3, zone: 'suit' }, acc: [['glasses', { round: true, lens: 0xf28c1e, opacity: 0.55, frame: 'gold' }], ['headband', { color: 0x8a3fb0, flower: 0xe6312e, dy: 0.34 }], ['longhair', { color: 0x6b4a2c }]] },
    pubg: { label: 'PUBG player', cat: 'fun', suit: 0x5c6140, collar: 0.55, pattern: { type: 'camo', c1: 0x3f4430, c2: 0x7a7556, scale: 3, zone: 'suit' }, acc: [['pubghelm'], ['vest'], ['pan']] },
    streamer: { label: 'Streamer', cat: 'fun', suit: 0x5e2a79, collar: 0.55, stripe: 0xf2b705, stripes: [-0.3], chest: 'gg', chestSize: 0.34, chestY: 0.02, acc: [['headset']] },

    // ── Berühmtheiten ──
    elvis: { label: 'Elvis', cat: 'celebs', suit: 0xf7f5ef, collar: 0.5, belt: 0xe2b62a, beltY: -0.22, pattern: { type: 'dots', c2: 0xe2b62a, scale: 10, zone: 'suit', y: [-0.18, 0.5] }, acc: [['pompadour'], ['glasses', { lens: 0x7a5a20, opacity: 0.8, frame: 'gold' }], ['highcollar', { color: 0xf7f5ef }]] },
    einstein: { label: 'Einstein', cat: 'celebs', suit: 0x6a6c70, collar: 0.55, hair: 0xe8e8e8, hairY: 0.42, acc: [['wildhair'], ['mustache', { style: 'walrus', color: 0xe8e8e8 }], ['tie', { color: 0x3a3a40 }]] },
    bobross: { label: 'Bob Ross', cat: 'celebs', suit: 0x9cc3e6, collar: 0.55, briefs: 0x3b5f8a, briefsY: -0.25, acc: [['afro', { color: 0x6b4a2c }], ['beard', { style: 'full', color: 0x6b4a2c }], ['palette']] },
    freddie: { label: 'Freddie Mercury', cat: 'celebs', suit: 0xf4f4f4, collar: 0.55, wing: 0xf5c518, belt: 0x141414, beltY: -0.2, hair: 0x111114, hairY: 0.38, acc: [['mustache', { style: 'thick' }], ['halfmic']] }
  });
})(this);
