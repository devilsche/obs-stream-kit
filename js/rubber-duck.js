/* Gummiente als 3D-Modell (three.js r128), Vorbild: echte Vinyl-Badeente.
 * Der Körper ist EINE glatte Fläche: weiche Vereinigung aus Bauch, Brust,
 * Hals, Kopf und Schwanz (Abstandsfunktionen), entlang Strahlen vom Inneren
 * abgetastet – so gibt es keine Nähte zwischen Kopf und Rumpf. Dazu offener
 * Schnabel (Ober-/Unterteil), angelegte Flügel, aufgemalte Augen.
 * Einheiten: Ente ~2.4 lang (Schnabel zeigt nach +x), ~2.2 hoch, Boden bei y = -0.55.
 *
 *   var duck = RubberDuck.build({ color, outfit });   // → THREE.Group
 *   RubberDuck.OUTFITS                                 // verfügbare Outfits
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  // ── Abstandsfunktionen ──
  function sdEll(p, c, r) {
    var x = (p.x - c[0]) / r[0], y = (p.y - c[1]) / r[1], z = (p.z - c[2]) / r[2];
    var k0 = Math.sqrt(x * x + y * y + z * z);
    return (k0 - 1) * Math.min(r[0], r[1], r[2]);
  }
  function smin(a, b, k) { var h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b + (a - b) * h - k * h * (1 - h); }
  // Teile des Rumpfs (Mitte, Radien)
  var PARTS = [
    { c: [0.0, 0.0, 0], r: [1.0, 0.66, 0.78], k: 0 },        // Bauch
    { c: [0.42, 0.08, 0], r: [0.62, 0.6, 0.64], k: 0.25 },   // Brust
    { c: [-0.88, 0.32, 0], r: [0.36, 0.4, 0.4], k: 0.3 },    // Schwanz (hinten hoch)
    { c: [-1.12, 0.62, 0], r: [0.16, 0.2, 0.2], k: 0.22 },   // Schwanzspitze
    { c: [0.48, 0.55, 0], r: [0.42, 0.42, 0.42], k: 0.22 },  // Hals
    { c: [0.5, 1.05, 0], r: [0.62, 0.6, 0.6], k: 0.2 }       // Kopf
  ];
  var FLOOR = -0.55;
  function sdDuck(p) {
    var d = sdEll(p, PARTS[0].c, PARTS[0].r);
    for (var i = 1; i < PARTS.length; i++) d = smin(d, sdEll(p, PARTS[i].c, PARTS[i].r), PARTS[i].k);
    // flacher Boden (weich abgeschnitten)
    var fl = FLOOR - p.y;
    var k = 0.08, h = Math.max(0, Math.min(1, 0.5 - 0.5 * (fl - d) / k));
    return fl + (d - fl) * h + k * h * (1 - h);   // weiches Maximum(d, fl)
  }
  // Fläche: Kugel-Netz, jeder Punkt entlang seines Strahls vom Inneren aus auf die Fläche gesetzt
  var CENTER = new THREE.Vector3(0.18, 0.32, 0);
  function bodyGeometry() {
    var g = new THREE.SphereGeometry(1, 160, 120), p = g.attributes.position, v = new THREE.Vector3(), q = new THREE.Vector3();
    for (var i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      var lo = 0, hi = 2.4;
      for (var it = 0; it < 26; it++) {
        var mid = (lo + hi) / 2;
        q.copy(CENTER).addScaledVector(v, mid);
        if (sdDuck(q) < 0) lo = mid; else hi = mid;
      }
      q.copy(CENTER).addScaledVector(v, lo);
      p.setXYZ(i, q.x, q.y, q.z);
    }
    g.computeVertexNormals();
    return g;
  }
  var BODY = null;
  function body() { return BODY || (BODY = bodyGeometry()); }

  function ell(rx, ry, rz, seg) { var g = new THREE.SphereGeometry(1, seg || 32, Math.round((seg || 32) * 0.7)); g.scale(rx, ry, rz); return g; }
  // Schnabel: breit, vorn rund, flach, leicht nach oben geschwungen
  function billGeometry(len, wid, thick, lift) {
    var g = new THREE.SphereGeometry(1, 48, 24), p = g.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      var t = (x + 1) / 2;                       // 0 hinten (Kopf) … 1 Spitze
      var w = wid * (0.75 + 0.35 * Math.sin(Math.PI * Math.min(1, t * 1.2)));
      p.setXYZ(i, x * len, y * thick + lift * t * t, z * w);
    }
    g.computeVertexNormals();
    return g;
  }
  function vinyl(hex, o) {
    var m = new THREE.MeshPhysicalMaterial(Object.assign({ color: hex, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.4 }, o || {}));
    m.color.convertSRGBToLinear();
    if (m.emissive) m.emissive.convertSRGBToLinear();
    return m;
  }

  function build(opts) {
    opts = opts || {};
    var g = new THREE.Group();
    var yellow = vinyl(opts.color != null ? opts.color : 0xf6bd16, { emissive: 0x2a1400 });
    var beak = vinyl(0xf2650f, { emissive: 0x200800 });
    var beakIn = vinyl(0xb83c0a, { roughness: 0.7 });
    var paint = new THREE.MeshBasicMaterial({ color: 0x0b0b0b }); paint.color.convertSRGBToLinear();
    var white = new THREE.MeshBasicMaterial({ color: 0xffffff });

    var b = new THREE.Mesh(body(), yellow); g.add(b);
    // Schnabel offen: Oberschnabel etwas angehoben, Unterschnabel kleiner und tiefer
    var up = new THREE.Mesh(billGeometry(0.4, 0.3, 0.1, 0.05), beak);
    up.position.set(1.12, 0.98, 0); up.rotation.z = -0.08; g.add(up);
    var low = new THREE.Mesh(billGeometry(0.32, 0.24, 0.07, 0.0), beak);
    low.position.set(1.06, 0.83, 0); low.rotation.z = -0.28; g.add(low);
    var mouth = new THREE.Mesh(ell(0.2, 0.06, 0.2, 20), beakIn); mouth.position.set(1.0, 0.9, 0); g.add(mouth);
    // Flügel, leicht angelegt (in den Körper gegossen)
    [-1, 1].forEach(function (s) {
      var w = new THREE.Mesh(ell(0.5, 0.3, 0.12, 32), yellow);
      w.position.set(-0.05, 0.12, s * 0.72); w.rotation.set(s * 0.15, s * 0.12, 0.35);
      g.add(w);
    });
    // aufgemalte Augen: flach auf dem Kopf, entlang der Normalen
    var HC = new THREE.Vector3(PARTS[5].c[0], PARTS[5].c[1], 0);
    function decal(geo, mat, dir, rad) {
      var n = dir.clone().normalize(), m = new THREE.Mesh(geo, mat);
      m.position.copy(HC).add(new THREE.Vector3(n.x * PARTS[5].r[0], n.y * PARTS[5].r[1], n.z * PARTS[5].r[2]).multiplyScalar(rad || 0.995));
      m.lookAt(m.position.clone().add(n));
      g.add(m); return m;
    }
    [-1, 1].forEach(function (s) {
      decal(ell(0.08, 0.1, 0.012, 20), paint, new THREE.Vector3(0.55, 0.38, s * 0.74));
      decal(ell(0.026, 0.03, 0.014, 10), white, new THREE.Vector3(0.6, 0.46, s * 0.68), 1.003);
    });
    g.userData = { body: b, head: HC, headR: PARTS[5].r, decal: decal };
    return g;
  }

  root.RubberDuck = { build: build, sdDuck: sdDuck, OUTFITS: ['none'] };
})(typeof window !== 'undefined' ? window : this);
