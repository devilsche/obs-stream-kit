/* Gummiente als 3D-Modell (three.js r128), Vorbild: echte Vinyl-Badeente.
 * Der Körper ist EINE glatte Fläche: weiche Vereinigung aus Bauch, Brust,
 * Hals, Kopf und Schwanz (Abstandsfunktionen), entlang Strahlen vom Inneren
 * abgetastet – so gibt es keine Nähte zwischen Kopf und Rumpf. Dazu offener
 * Schnabel (Ober-/Unterteil), angelegte Flügel, aufgemalte Augen.
 * Einheiten: Ente ~2.4 lang (Schnabel zeigt nach +x), ~2.2 hoch, Boden bei y = -0.55.
 *
 *   var duck = RubberDuck.build({ color, outfit });   // → THREE.Group
 *   RubberDuck.OUTFITS                                 // verfügbare Outfits
 *   RubberDuck.viewerOutfit(name)                      // Outfit, das sich der Zuschauer mit !outfit ausgesucht hat (oder null)
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
    // Rumpf 10 % breiter (z) – wirkt flacher, wie eine echte Badeente
    { c: [0.0, 0.0, 0], r: [1.0, 0.66, 0.86], k: 0 },        // Bauch
    { c: [0.42, 0.08, 0], r: [0.62, 0.6, 0.7], k: 0.25 },    // Brust
    { c: [-0.88, 0.32, 0], r: [0.36, 0.4, 0.44], k: 0.3 },   // Schwanz (hinten hoch)
    { c: [-1.12, 0.62, 0], r: [0.16, 0.2, 0.22], k: 0.22 },  // Schwanzspitze
    { c: [0.48, 0.55, 0], r: [0.42, 0.42, 0.46], k: 0.22 },  // Hals
    { c: [0.5, 1.05, 0], r: [0.62, 0.6, 0.6], k: 0.2 }       // Kopf
  ];
  var FLOOR = -0.55;
  // Körperform je Outfit (gilt während build): girth = Körperbreite (1 normal, >1 fett: breiter,
  // Bauch vorn, Doppelkinn, Pausbacken; <1 schlanker), muscles = Brustmuskeln. Weitere Formen
  // (Kinn, Backen, Brustmuskeln) hängen hinter dem Kopf an und gehören nicht zum Rumpf.
  var CUR = PARTS, CUR_KEY = '';
  function shapeFor(o) {
    var G = Math.max(0.7, Math.min(1.8, +o.girth || 1)), mu = !!o.muscles;
    if (G === 1 && !mu) return { key: '', parts: PARTS };
    var f = G - 1, P = PARTS.map(function (q) { return { c: q.c.slice(), r: q.r.slice(), k: q.k }; });
    P[0].c[0] += 0.12 * f; P[0].r[0] *= 1 + 0.4 * f; P[0].r[1] *= 1 + 0.15 * f; P[0].r[2] *= 1 + f;
    P[1].r[0] *= 1 + 0.35 * f; P[1].r[2] *= 1 + 0.8 * f;
    if (f > 0.05) {
      var sc = Math.min(1, f / 0.35);
      P.push({ c: [0.92, 0.66, 0], r: [0.3 * sc, 0.19 * sc, 0.4 * sc], k: 0.14 });
      [-1, 1].forEach(function (s) { P.push({ c: [0.74, 0.88, s * 0.46], r: [0.24 * sc, 0.2 * sc, 0.2 * sc], k: 0.12 }); });
    }
    if (mu) {
      P[1].r[1] *= 1.05; P[1].r[2] *= 1.12;
      [-1, 1].forEach(function (s) { P.push({ c: [0.9, 0.4, s * 0.23], r: [0.2, 0.16, 0.21], k: 0.08 }); });
    }
    return { key: G.toFixed(2) + (mu ? 'm' : ''), parts: P };
  }
  // nur Rumpf (Bauch, Brust, Schwanz) – für Teile, die nicht über den Kopf dürfen
  function sdTrunk(p) {
    var d = sdEll(p, CUR[0].c, CUR[0].r);
    for (var i = 1; i < 4; i++) d = smin(d, sdEll(p, CUR[i].c, CUR[i].r), CUR[i].k);
    return d;
  }
  function sdDuck(p) {
    var d = sdEll(p, CUR[0].c, CUR[0].r);
    for (var i = 1; i < CUR.length; i++) d = smin(d, sdEll(p, CUR[i].c, CUR[i].r), CUR[i].k);
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
  var BODIES = {};
  function body() { return BODIES[CUR_KEY] || (BODIES[CUR_KEY] = bodyGeometry()); }

  function ell(rx, ry, rz, seg) { var g = new THREE.SphereGeometry(1, seg || 32, Math.round((seg || 32) * 0.7)); g.scale(rx, ry, rz); return g; }
  // Schnabel wie ein echter offener Entenschnabel: zwei gewölbte Schalen (Ober-
  // und Unterschnabel), die nur hinten im Mundwinkel zusammenhängen, vorn leicht
  // geöffnet (Keil mit Winkel 2·open um das Scharnier). Jede Schale hat eine
  // gerundete Lippe (Wandstärke), dazwischen eine zusammenhängende Mundhöhle von der
  // oberen Lippe über den Rachen (am Kopf etwas breiter) zur unteren. EINE Geometrie.
  function billGeometry(len, wid, thick, open) {
    var Hx = -0.85 * len, LIP = 0.018, COLS = 48, ROWS = 16, S = 10;
    var lip = new THREE.Color(0xf2650f).convertSRGBToLinear();
    var mouthHi = new THREE.Color(0x6a1c06).convertSRGBToLinear(), mouthLo = new THREE.Color(0x1e0601).convertSRGBToLinear();
    // Ober- und Unterschnabel getrennt (idxU/idxL), damit sie einzeln bearbeitbar sind
    var pos = [], col = [], idxU = [], idxL = [], idx = idxU;
    function vtx(v, c) { pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; }
    function shape(x, y, z, up) {
      var t = (x + 1) / 2, w = wid * (0.72 + 0.38 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
      // Unterschnabel etwas kürzer und schmaler als der kräftige Oberschnabel
      // Unterschnabel am Kopf so breit und lang wie der Oberschnabel, zur Spitze etwas kürzer/schmaler
      return up ? new THREE.Vector3(x * len, y * thick, z * w) : new THREE.Vector3(x * len - len * 0.12 * t * t, y * thick * 0.85, z * w * (1 - 0.1 * t));
    }
    function wedge(v, up) {
      var dx = v.x - Hx, r = Math.sqrt(dx * dx + v.y * v.y), phi = Math.atan2(v.y, dx);
      if (up && phi < 0) phi = 0; if (!up && phi > 0) phi = 0;
      // am Kopf liegen die Schnabelhälften aufeinander, der Spalt öffnet sich erst zur Spitze
      var f = Math.max(0, Math.min(1, (dx / (len * 1.85) - 0.22) / 0.7)), op = open * f * f * (3 - 2 * f);
      var a = Math.abs(phi), na = op + a * (Math.PI - op) / Math.PI;
      var np = up ? na : -na;
      return new THREE.Vector3(Hx + r * Math.cos(np), r * Math.sin(np), v.z);
    }
    // äußere Schale; liefert die Punkte des Mundrands (Äquator) in Reihenfolge
    function shell(up) {
      idx = up ? idxU : idxL;
      var g = new THREE.SphereGeometry(1, COLS, ROWS, 0, Math.PI * 2, up ? 0 : Math.PI / 2, Math.PI / 2);
      var p = g.attributes.position, base = pos.length / 3, rim = [];
      for (var i = 0; i < p.count; i++) vtx(wedge(shape(p.getX(i), p.getY(i), p.getZ(i), up), up), lip);
      var ix = g.index.array;
      for (var k = 0; k < ix.length; k++) idx.push(base + ix[k]);
      var row = up ? ROWS : 0;
      for (var c = 0; c <= COLS; c++) { var j = base + row * (COLS + 1) + c; rim.push(new THREE.Vector3(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2])); }
      return rim;
    }
    var rimU = shell(true), rimL = shell(false);
    // Lippe: Rand um LIP nach innen (zur Schnabelmitte) und leicht in die Schale versetzt
    function inset(rim, up) {
      var cx = 0, cz = 0; rim.forEach(function (v) { cx += v.x; cz += v.z; }); cx /= rim.length; cz /= rim.length;
      return rim.map(function (v) {
        var d = new THREE.Vector3(cx - v.x, 0, cz - v.z); var L = d.length() || 1; d.multiplyScalar(Math.min(LIP, L * 0.5) / L);
        return new THREE.Vector3(v.x + d.x, v.y + (up ? LIP * 0.45 : -LIP * 0.45), v.z + d.z);
      });
    }
    var inU = inset(rimU, true), inL = inset(rimL, false);
    function strip(a, b, ca, cb, flip) {
      var ia = a.map(function (v) { return vtx(v, ca); }), ib = b.map(function (v) { return vtx(v, cb); });
      for (var c = 0; c < a.length - 1; c++) {
        if (flip) idx.push(ia[c], ia[c + 1], ib[c], ib[c], ia[c + 1], ib[c + 1]);
        else idx.push(ia[c], ib[c], ia[c + 1], ib[c], ib[c + 1], ia[c + 1]);
      }
    }
    // gerundete Lippen (orange), außen → innen
    idx = idxU; strip(rimU, inU, lip, lip, false);
    idx = idxL; strip(rimL, inL, lip, lip, true);
    // Mundhöhle: je Randpunkt eine Kurve von der oberen Lippe über den Rachen
    // (nach hinten zum Mundwinkel) zur unteren Lippe
    var grid = [];
    for (var c = 0; c <= COLS; c++) {
      var a = inU[c], b = inL[c];
      // Rachen fast so breit wie der Mund, damit das Innere bis an den Lippenrand reicht
      // Rachen so breit wie der breitere der beiden Ränder: am Mundwinkel volle Schnabelbreite
      var zt = Math.abs(a.z) > Math.abs(b.z) ? a.z : b.z;
      // Rachen reicht nach hinten bis zum Kopf; dort etwas breiter als der Schnabel, damit
      // man von vorn kein Gelb des Kopfes durch den Mund sieht
      var t = new THREE.Vector3(Hx + (Math.max(a.x, Hx) - Hx) * 0.22, (a.y + b.y) / 2, zt * 1.07);
      var colm = [];
      for (var k = 0; k <= S; k++) {
        var u = k / S, w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u;
        var v = new THREE.Vector3(a.x * w0 + t.x * w1 + b.x * w2, a.y * w0 + t.y * w1 + b.y * w2, a.z * w0 + t.z * w1 + b.z * w2);
        var depth = Math.sin(Math.PI * u);
        colm.push(vtx(v, mouthHi.clone().lerp(mouthLo, depth)));
      }
      grid.push(colm);
    }
    for (var c2 = 0; c2 < COLS; c2++) for (var k2 = 0; k2 < S; k2++) {
      var p00 = grid[c2][k2], p01 = grid[c2][k2 + 1], p10 = grid[c2 + 1][k2], p11 = grid[c2 + 1][k2 + 1];
      (k2 < S / 2 ? idxU : idxL).push(p00, p01, p10, p10, p01, p11);
    }
    // Normalen am ganzen Schnabel (glatter Übergang im Rachen), dann in zwei Teile zerlegen;
    // Ursprung am Mundwinkel (Hx), damit Drehen den Schnabel auf- und zuklappt
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idxU.concat(idxL));
    geo.computeVertexNormals();
    var nrm = geo.attributes.normal.array;
    function subset(list) {
      var map = {}, P = [], C = [], N = [], I = [];
      list.forEach(function (i) {
        if (map[i] === undefined) {
          map[i] = P.length / 3;
          P.push(pos[i * 3] - Hx, pos[i * 3 + 1], pos[i * 3 + 2]); C.push(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]); N.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
        }
        I.push(map[i]);
      });
      var gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      gg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      gg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      gg.setIndex(I);
      return gg;
    }
    geo.dispose();
    return { upper: subset(idxU), lower: subset(idxL), hinge: Hx };
  }
  function vinyl(hex, o) {
    var m = new THREE.MeshPhysicalMaterial(Object.assign({ color: hex, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.4 }, o || {}));
    m.color.convertSRGBToLinear();
    if (m.emissive) m.emissive.convertSRGBToLinear();
    return m;
  }

  // ── Outfits ──
  // Uniform als Farbzonen auf dem Körper (Shader, Modell-Koordinaten):
  // suit = Rumpf unterhalb der Kragenlinie, stripes = Reflexstreifen (y, Breite),
  // belt = Gürtel, briefs = Höschen unten, cowl = Maske über Kopf/Augen.
  var OUTFITS = {
    none: { label: 'Plain', cat: 'classic' },
    thw: { label: 'THW', cat: 'classic', suit: 0x1d2b5e, stripe: 0xf2c500, stripes: [0.18, -0.12], helmet: { color: 0xf2c500 }, helmetLabel: 'THW' },
    police: { label: 'Police', cat: 'classic', suit: 0x1e3c72, stripe: 0xd8dde6, stripes: [-0.05], cap: true, chest: 'star' },
    fire: { label: 'Fire brigade', cat: 'classic', suit: 0x1a2340, stripe: 0xf2d000, stripe2: 0xc9ced6, stripes: [0.2, -0.1], helmet: { color: 0xd9dde2, metal: true, neck: true } },
    batman: { label: 'Batman', cat: 'heroes', suit: 0x4a4e57, collar: 0.8, belt: 0xe2b62a, beltY: -0.3, cowl: 0x1a1b20, cape: 0x1a1b20, ears: true, chest: 'bat', eyes: 'white' },
    superman: { label: 'Superman', cat: 'heroes', suit: 0x1f4fb5, belt: 0xf2c500, beltY: -0.3, briefs: 0xc8151b, cape: 0xc8151b, chest: 'super' }
  };
  function col(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
  // Vinyl-Material mit Uniform-Zonen
  // Muster (Shader, Modell-Koordinaten): Nummer je Art, Farben c1/c2, Maßstab s
  var PATTERNS = { hstripes: 1, dots: 2, web: 3, fur: 4, bandage: 5, ribs: 6, tiedye: 7, camo: 8, suspenders: 9, abs: 10 };
  var PAT_GLSL = [
    'float dh31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
    'float dnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);',
    ' return mix(mix(mix(dh31(i), dh31(i + vec3(1,0,0)), f.x), mix(dh31(i + vec3(0,1,0)), dh31(i + vec3(1,1,0)), f.x), f.y),',
    '            mix(mix(dh31(i + vec3(0,0,1)), dh31(i + vec3(1,0,1)), f.x), mix(dh31(i + vec3(0,1,1)), dh31(i + vec3(1,1,1)), f.x), f.y), f.z); }',
    'vec4 duckPat(vec3 p, float t, vec3 c1, vec3 c2, float s, vec3 cur) {',
    '  if (t < 0.5) return vec4(cur, 0.0);',
    '  if (t < 1.5) { return vec4(mix(c1, c2, step(0.5, fract(p.y * s))), 1.0); }',
    '  if (t < 2.5) { float d = length(fract(p * s) - 0.5); return vec4(c2, 1.0 - smoothstep(0.17, 0.21, d)); }',
    '  if (t < 3.5) { vec3 d = p - vec3(1.0, 0.1, 0.0); float r = length(d); float th = atan(d.z, d.y);',
    '    float sp = abs(fract(th * 12.0 / 6.2832) - 0.5) * 6.2832 / 12.0 * r; float rg = abs(fract(r * s) - 0.5) / s;',
    '    return vec4(c2, max(1.0 - smoothstep(0.007, 0.014, sp), 1.0 - smoothstep(0.007, 0.014, rg))); }',
    '  if (t < 4.5) { float n = dnoise(p * s) * 0.65 + dnoise(p * s * 3.1) * 0.35; return vec4(mix(c1, c2, n), 1.0); }',
    '  if (t < 5.5) { float v = fract((p.y * 0.9 + p.z * 0.35 + p.x * 0.15) * s + dnoise(p * 6.0) * 0.35);',
    '    vec3 cl = mix(c1, c1 * 0.82, dnoise(p * s * 2.0)); return vec4(mix(cl, c2, smoothstep(0.82, 0.9, v)), 1.0); }',
    '  if (t < 6.5) { float front = smoothstep(0.25, 0.4, p.x); float inR = step(-0.3, p.y) * step(p.y, 0.48);',
    '    float rib = 1.0 - smoothstep(0.12, 0.17, abs(fract(p.y * s) - 0.5));',
    '    float side = step(0.08, abs(p.z)) * (1.0 - smoothstep(0.55, 0.62, abs(p.z)));',
    '    float stern = 1.0 - smoothstep(0.035, 0.05, abs(p.z)); return vec4(c2, front * inR * max(rib * side, stern)); }',
    '  if (t < 7.5) { float a = atan(p.z, p.y - 0.1) / 6.2832; float r = length(vec2(p.y - 0.1, p.z));',
    '    vec3 c = 0.5 + 0.5 * cos(6.2832 * (a * 2.0 + r * s + vec3(0.0, 0.33, 0.67))); return vec4(pow(c, vec3(2.2)), 1.0); }',
    '  if (t < 8.5) { float n = dnoise(p * s), n2 = dnoise(p * s * 1.7 + 7.0);',
    '    if (n > 0.6) return vec4(c1, 1.0); if (n2 > 0.62) return vec4(c2, 1.0); return vec4(cur, 0.0); }',
    '  if (t < 9.5) { return vec4(c2, (1.0 - smoothstep(0.045, 0.055, abs(abs(p.z) - 0.3))) * step(0.0, p.x + 0.2)); }',
    '  if (t < 10.5) { float fr = smoothstep(0.6, 0.75, p.x) * step(-0.3, p.y) * step(p.y, 0.24) * step(abs(p.z), 0.27);',
    '    float v = 1.0 - smoothstep(0.01, 0.02, abs(p.z)), sd = 1.0 - smoothstep(0.01, 0.02, abs(abs(p.z) - 0.26));',
    '    float hy = abs(fract((p.y + 0.3) / 0.135 + 0.5) - 0.5) * 0.135, h = 1.0 - smoothstep(0.008, 0.018, hy);',
    '    return vec4(c2, fr * max(max(v, h), sd * 0.6) * 0.6); }',
    '  return vec4(cur, 0.0);',
    '}'
  ].join('\n');
  // Vinyl-Material mit Uniform-Zonen. Reihenfolge: Anzug → Muster (Anzug/Haut) → Streifen,
  // Gürtel, Höschen → Maske (cowl) → Haar → Muster (alles) → Augenbinde → Gesicht → Emblem
  // Brust-Emblem: Punkt auf der Körperoberfläche in Richtung (1, chestY, chestZ), projiziert entlang der
  // waagrechten Normale dort (vorn genau +x), gedreht um chestRot Grad; liefert Lage und Achsen
  function emblemFrame(o) {
    var at = surface(new THREE.Vector3(1, o.chestY != null ? +o.chestY : -0.18, +o.chestZ || 0));
    var n = new THREE.Vector3(at.n.x, 0, at.n.z); if (n.lengthSq() < 1e-6) n.set(1, 0, 0); n.normalize();
    var t1 = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n).normalize(), t2 = new THREE.Vector3().crossVectors(n, t1);
    var r = (+o.chestRot || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    var u = t1.clone().multiplyScalar(cs).addScaledVector(t2, sn), v = t2.clone().multiplyScalar(cs).addScaledVector(t1, -sn);
    return { p: at.p, n: n, u: u, v: v, size: +o.chestSize || (o.chest === 'star' ? 0.24 : 0.46) };
  }
  // Werte der aufgemalten Zonen (Uniforms); aus dem Editor ohne Neubau nachziehbar (updatePaint)
  function paintUniforms(base, o, emb) {
    var HC = PARTS[5].c, HR = PARTS[5].r, pt = o.pattern || {}, ef = o.chest ? emblemFrame(o) : null;
    var zone = { suit: 0, all: 1, skin: 2 }[pt.zone || (o.suit ? 'suit' : 'all')];
    return {
      uSuit: col(o.suit || base), uStripe: col(o.stripe || o.suit || base), uStripe2: col(o.stripe2 || o.stripe || o.suit || base),
      uBelt: col(o.belt || o.suit || base), uBriefs: col(o.briefs || o.suit || base), uCowl: col(o.cowl || base),
      uS: new THREE.Vector4(o.stripes ? o.stripes[0] : -9, o.stripes && o.stripes[1] != null ? o.stripes[1] : -9, o.belt ? (o.beltY != null ? o.beltY : -0.3) : -9, o.briefs ? 1 : 0),
      uSuitOn: o.suit ? 1 : 0, uBriefsY: o.briefsY != null ? o.briefsY : -0.36,
      uCowlOn: o.cowl ? 1 : 0, uHC: new THREE.Vector3(HC[0], HC[1], HC[2]), uHR: new THREE.Vector3(HR[0], HR[1], HR[2]),
      uEmb: emb || new THREE.Texture(), uEmbOn: emb ? 1 : 0,
      uEmbAt: ef ? ef.p.clone() : new THREE.Vector3(), uEmbU: ef ? ef.u : new THREE.Vector3(0, 0, -1), uEmbV: ef ? ef.v : new THREE.Vector3(0, 1, 0),
      uEmbN: ef ? ef.n : new THREE.Vector3(1, 0, 0), uEmbSize: ef ? ef.size : 0.46,
      uCollar: o.collar || 0.55, uDip: +o.collarDip || 0, uCut: Math.min(1, Math.max(0, +o.collarV || 0)),
      uBeltW: o.beltW != null ? +o.beltW : 0.04, uStripeW: o.stripeW != null ? +o.stripeW : 0.045,
      uPat: PATTERNS[pt.type] || 0, uPatC1: col(pt.c1 != null ? pt.c1 : base), uPatC2: col(pt.c2 != null ? pt.c2 : 0x000000),
      uPatS: pt.scale || 6, uPatZone: zone, uPatY: new THREE.Vector2(pt.y ? pt.y[0] : -9, pt.y ? pt.y[1] : 9),
      uMask: col(o.mask || 0), uMaskOn: o.mask != null ? 1 : 0,
      uFace: col(o.face || 0), uFaceOn: o.face != null ? 1 : 0, uFaceX: o.faceX != null ? o.faceX : 0.25,
      uHair: col(o.hair || 0), uHairOn: o.hair != null ? 1 : 0, uHairY: HC[1] + (o.hairY != null ? o.hairY : 0.36), uPeak: o.hairPeak || 0
    };
  }
  function suitMaterial(base, o) {
    var m = vinyl(base, Object.assign({ emissive: o.skin != null ? 0x080604 : 0x2a1400 }, o.mat || {}));
    if (o.ghost) { m.transparent = true; m.opacity = 0.8; m.depthWrite = true; }
    if (!(o.suit || o.cowl || o.pattern || o.mask || o.face || o.hair || o.chest || o.briefs)) return m;
    var emb = o.chest ? emblemTex(o.chest) : null, u = paintUniforms(base, o, emb);
    hide(m.userData, 'paint', { u: u, chest: o.chest || null, base: base });
    m.onBeforeCompile = function (sh) {
      Object.keys(u).forEach(function (k) { sh.uniforms[k] = { value: u[k] }; });
      m.userData.paint.sh = sh;
      sh.vertexShader = 'varying vec3 vDuck;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vDuck = position;');
      sh.fragmentShader = 'varying vec3 vDuck; uniform vec3 uSuit, uStripe, uStripe2, uBelt, uBriefs, uCowl, uHC, uHR, uEmbAt, uEmbU, uEmbV, uEmbN, uPatC1, uPatC2, uMask, uFace, uHair; uniform vec4 uS; uniform vec2 uPatY;' +
        ' uniform float uCowlOn, uEmbOn, uEmbSize, uCollar, uDip, uCut, uBeltW, uStripeW, uSuitOn, uBriefsY, uPat, uPatS, uPatZone, uMaskOn, uFaceOn, uFaceX, uHairOn, uHairY, uPeak; uniform sampler2D uEmb;\n' + PAT_GLSL + '\n' +
        sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec3 cc = diffuse;\n' +
          'float inHead = length((vDuck - uHC) / uHR);\n' +
          'float headM = 1.0 - step(1.12, inHead);\n' +
          // Kragenlinie: unterhalb uCollar und nicht im Kopf → Anzug; vorn um uDip tiefer ausgeschnitten (rund bzw. V)
          'float cz = clamp(abs(vDuck.z) / 0.4, 0.0, 1.0);\n' +
          'float cline = uCollar - uDip * smoothstep(0.2, 0.8, vDuck.x) * mix(1.0 - cz * cz, 1.0 - cz, uCut);\n' +
          'float suitOn = uSuitOn * (1.0 - step(cline, vDuck.y)) * step(0.97, inHead);\n' +
          'cc = mix(cc, uSuit, suitOn);\n' +
          'float inY = step(uPatY.x, vDuck.y) * step(vDuck.y, uPatY.y);\n' +
          'if (uPatZone < 0.5 || uPatZone > 1.5) { float pz = uPatZone < 0.5 ? suitOn : 1.0 - suitOn; vec4 pt = duckPat(vDuck, uPat, uPatC1, uPatC2, uPatS, cc); cc = mix(cc, pt.rgb, pt.a * pz * inY); }\n' +
          'float aa = 0.012;\n' +
          'cc = mix(cc, uStripe, suitOn * (1.0 - smoothstep(uStripeW - aa, uStripeW + aa, abs(vDuck.y - uS.x))));\n' +
          'cc = mix(cc, uStripe2, suitOn * (1.0 - smoothstep(uStripeW - aa, uStripeW + aa, abs(vDuck.y - uS.y))));\n' +
          'cc = mix(cc, uBelt, suitOn * (1.0 - smoothstep(uBeltW - aa, uBeltW + aa, abs(vDuck.y - uS.z))));\n' +
          'cc = mix(cc, uBriefs, step(0.97, inHead) * uS.w * (1.0 - smoothstep(uBriefsY - aa, uBriefsY + aa, vDuck.y)));\n' +
          // Maske: Kopf oberhalb der Schnabellinie und hinten
          'float cowl = uCowlOn * headM * max(step(uHC.y - 0.06, vDuck.y), step(vDuck.x, uHC.x - 0.12));\n' +
          'cc = mix(cc, uCowl, cowl);\n' +
          // Haar: oben ab Stirnlinie (mit Spitze vorn) und am Hinterkopf
          'float hl = uHairY - uPeak * exp(-vDuck.z * vDuck.z * 25.0) * step(uHC.x, vDuck.x);\n' +
          'hl -= 0.6 * clamp(uHC.x + 0.05 - vDuck.x, 0.0, 0.75);\n' +
          'float hair = uHairOn * headM * smoothstep(hl - 0.012, hl + 0.012, vDuck.y);\n' +
          'cc = mix(cc, uHair, hair);\n' +
          'if (uPatZone > 0.5 && uPatZone < 1.5) { vec4 pt = duckPat(vDuck, uPat, uPatC1, uPatC2, uPatS, cc); cc = mix(cc, pt.rgb, pt.a * inY); }\n' +
          // Augenbinde rund um den Kopf auf Augenhöhe
          'cc = mix(cc, uMask, uMaskOn * headM * (1.0 - smoothstep(0.085, 0.1, abs(vDuck.y - (uHC.y + 0.22)))));\n' +
          // Gesicht: vorderer Kopfteil oberhalb des Schnabels (Gesichtsplatte, Maske)
          'cc = mix(cc, uFace, uFaceOn * headM * smoothstep(uHC.x + uFaceX - 0.01, uHC.x + uFaceX + 0.01, vDuck.x) * step(uHC.y - 0.16, vDuck.y));\n' +
          // Emblem: Projektion entlang der waagrechten Normale am Emblem-Punkt (nur diese Seite)
          'vec3 ed = vDuck - uEmbAt; vec2 euv = vec2(dot(ed, uEmbU), dot(ed, uEmbV)) / uEmbSize + 0.5;\n' +
          'if (uEmbOn > 0.5 && dot(ed, uEmbN) > -0.35 && euv.x > 0.0 && euv.x < 1.0 && euv.y > 0.0 && euv.y < 1.0) {\n' +
          '  vec4 et = texture2D(uEmb, euv); cc = mix(cc, pow(et.rgb, vec3(2.2)), et.a);\n' +
          '}\n' +
          'vec4 diffuseColor = vec4( cc, opacity );');
    };
    return m;
  }
  // Punkt + Normale auf der Körperoberfläche in Richtung dir (vom Inneren aus)
  function surface(dir) {
    var v = dir.clone().normalize(), q = new THREE.Vector3(), lo = 0, hi = 2.4;
    for (var it = 0; it < 30; it++) { var mid = (lo + hi) / 2; q.copy(CENTER).addScaledVector(v, mid); if (sdDuck(q) < 0) lo = mid; else hi = mid; }
    q.copy(CENTER).addScaledVector(v, lo);
    var e = 0.002, n = new THREE.Vector3(
      sdDuck(new THREE.Vector3(q.x + e, q.y, q.z)) - sdDuck(new THREE.Vector3(q.x - e, q.y, q.z)),
      sdDuck(new THREE.Vector3(q.x, q.y + e, q.z)) - sdDuck(new THREE.Vector3(q.x, q.y - e, q.z)),
      sdDuck(new THREE.Vector3(q.x, q.y, q.z + e)) - sdDuck(new THREE.Vector3(q.x, q.y, q.z - e))).normalize();
    return { p: q, n: n };
  }
  // Oberfläche auf Höhe y in Richtung phi (waagrecht von der Körperachse aus)
  function surfaceAt(y, phi, cx) {
    var dir = new THREE.Vector3(-Math.cos(phi), 0, Math.sin(phi)).multiplyScalar(-1);
    var o0 = new THREE.Vector3(cx != null ? cx : 0.1, y, 0), q = new THREE.Vector3(), lo = 0, hi = 2.0;
    if (sdDuck(o0) > 0) return { p: o0.clone(), n: dir.clone() };
    // in kleinen Schritten bis zum ERSTEN Austritt (sonst landet man z. B. hinter dem Hals am Schwanz)
    for (var st = 0.01; st <= 2.0; st += 0.01) { q.copy(o0).addScaledVector(dir, st); if (sdDuck(q) > 0) { lo = st - 0.01; hi = st; break; } }
    for (var it = 0; it < 20; it++) { var mid = (lo + hi) / 2; q.copy(o0).addScaledVector(dir, mid); if (sdDuck(q) < 0) lo = mid; else hi = mid; }
    q.copy(o0).addScaledVector(dir, lo);
    var e = 0.002, n = new THREE.Vector3(
      sdDuck(new THREE.Vector3(q.x + e, q.y, q.z)) - sdDuck(new THREE.Vector3(q.x - e, q.y, q.z)),
      sdDuck(new THREE.Vector3(q.x, q.y + e, q.z)) - sdDuck(new THREE.Vector3(q.x, q.y - e, q.z)),
      sdDuck(new THREE.Vector3(q.x, q.y, q.z + e)) - sdDuck(new THREE.Vector3(q.x, q.y, q.z - e))).normalize();
    return { p: q, n: n };
  }
  // gezeichnete Textur (Schriftzug, Emblem)
  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  function textTex(text, color, bg) {
    return canvasTex(512, 128, function (x, w, h) {
      if (bg) { x.fillStyle = bg; x.beginPath(); x.roundRect ? x.roundRect(8, 8, w - 16, h - 16, 22) : x.rect(8, 8, w - 16, h - 16); x.fill(); }
      x.fillStyle = color; x.font = '900 ' + Math.round(h * 0.62) + 'px "Arial Black", "Helvetica Neue", Arial, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      var s = Math.min(1, (w - 40) / x.measureText(text).width);
      x.save(); x.translate(w / 2, h / 2 + 4); x.scale(s, 1); x.fillText(text, 0, 0); x.restore();
    });
  }
  var EMBLEMS = {};   // weitere Embleme: EMBLEMS[name] = function (ctx2d, size)
  function emblemTex(kind) {
    return canvasTex(256, 256, function (x, w) {
      var c = w / 2;
      if (EMBLEMS[kind]) EMBLEMS[kind](x, w);
      else if (kind === 'bat') {
        // gelbes Oval, schwarzer Rand, Fledermaus-Silhouette
        x.fillStyle = '#111'; x.beginPath(); x.ellipse(c, c, 124, 80, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#f2c51e'; x.beginPath(); x.ellipse(c, c, 114, 70, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#111'; x.beginPath();
        x.moveTo(c, c - 8); x.lineTo(c - 8, c - 30); x.lineTo(c - 12, c - 12);
        x.quadraticCurveTo(c - 40, c - 34, c - 96, c - 20); x.quadraticCurveTo(c - 70, c - 8, c - 74, c + 14);
        x.quadraticCurveTo(c - 52, c + 2, c - 40, c + 22); x.quadraticCurveTo(c - 22, c + 6, c, c + 44);
        x.quadraticCurveTo(c + 22, c + 6, c + 40, c + 22); x.quadraticCurveTo(c + 52, c + 2, c + 74, c + 14);
        x.quadraticCurveTo(c + 70, c - 8, c + 96, c - 20); x.quadraticCurveTo(c + 40, c - 34, c + 12, c - 12);
        x.lineTo(c + 8, c - 30); x.closePath(); x.fill();
      } else if (kind === 'super') {
        // Rauten-Schild: roter Rand, gelbe Fläche, rotes S
        function shield(sc) { x.beginPath(); x.moveTo(c - 110 * sc, c - 70 * sc); x.lineTo(c - 70 * sc, c - 108 * sc); x.lineTo(c + 70 * sc, c - 108 * sc); x.lineTo(c + 110 * sc, c - 70 * sc); x.lineTo(c, c + 112 * sc); x.closePath(); }
        x.fillStyle = '#c8151b'; shield(1); x.fill();
        x.fillStyle = '#f2c500'; shield(0.84); x.fill();
        x.fillStyle = '#c8151b'; x.font = '900 150px "Arial Black", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.save(); x.translate(c, c - 12); x.scale(1.15, 0.9); x.fillText('S', 0, 0); x.restore();
      } else if (kind === 'star') {
        // Polizeistern (achtzackig, gold)
        x.fillStyle = '#d9b23a'; x.beginPath();
        for (var i = 0; i < 16; i++) { var a = i / 16 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 54 : 110; x.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
        x.closePath(); x.fill();
        x.fillStyle = '#1e3c72'; x.beginPath(); x.arc(c, c, 40, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#d9b23a'; x.beginPath(); x.arc(c, c, 24, 0, Math.PI * 2); x.fill();
      }
    });
  }
  function decalPlane(tex, w, h, at) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.copy(at.p).addScaledVector(at.n, 0.015);
    m.lookAt(m.position.clone().add(at.n));
    return m;
  }

  // Körperform des Outfits nur für die Dauer des Baus setzen (surface/surfaceAt der Zubehörteile folgen ihr)
  function build(opts) {
    var o = OUTFITS[(opts || {}).outfit] || OUTFITS.none, sh = shapeFor(o), prev = CUR, prevKey = CUR_KEY;
    CUR = sh.parts; CUR_KEY = sh.key;
    try { return buildDuck(opts); } finally { CUR = prev; CUR_KEY = prevKey; }
  }
  function buildDuck(opts) {
    opts = opts || {};
    var o = OUTFITS[opts.outfit] || OUTFITS.none;
    var g = new THREE.Group();
    var skin = o.skin != null ? o.skin : (opts.color != null ? opts.color : 0xf6bd16);
    var yellow = suitMaterial(skin, o);
    var wingMat = o.wing != null ? vinyl(o.wing, o.wingOpts) : (o.suit ? vinyl(o.suit) : yellow);
    var beak = o.bill != null ? vinyl(o.bill, { side: THREE.DoubleSide, envMapIntensity: 0.12, clearcoat: 0.15, roughness: 0.6 })
      : vinyl(0xffffff, { emissive: 0x200800, vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 0.12, clearcoat: 0.15, roughness: 0.6 });
    if (o.ghost) { beak.transparent = true; beak.opacity = 0.85; }
    var paint = new THREE.MeshBasicMaterial({ color: 0x0b0b0b }); paint.color.convertSRGBToLinear();
    var white = new THREE.MeshBasicMaterial({ color: 0xffffff });

    var b = new THREE.Mesh(body(), yellow); g.add(b);
    // Jedes Teil (Schnabel, Flügel, Augen, Helm, Zubehör …) landet in einer eigenen Gruppe mit
    // Drehpunkt in seiner Mitte; o.xf[id] bzw. acc-Option xf verschiebt/dreht/skaliert/färbt es
    // (Duck-Editor, tools/duck-editor.html). Ein Fehler in einem Teil kostet nur dieses Teil.
    var xfs = o.xf || {}, parts = [];
    function part(id, label, fn, xf, gkey) {
      var n0 = g.children.length;
      try { fn(); } catch (e) { if (root.console) root.console.warn('rubber-duck: part ' + id + ' failed', e); }
      var kids = g.children.slice(n0);
      if (!kids.length) return null;
      var grp = new THREE.Group(), inner = new THREE.Group(), box = new THREE.Box3(), c = new THREE.Vector3();
      kids.forEach(function (k) { box.expandByObject(k); });
      if (!box.isEmpty()) box.getCenter(c);
      kids.forEach(function (k) { inner.add(k); k.position.sub(c); });
      grp.add(inner);
      // Unterteile: alle Meshes des Teils in fester Reihenfolge, mit ihrer gebauten Lage
      var pieces = [];
      var mirrors = [];
      inner.traverse(function (m) {
        if (!m.isMesh) return;
        if (m.userData.mirrorOf) { mirrors.push(m); return; }   // Spiegelbild eines Stücks, folgt ihm
        m.userData.base = { p: m.position.toArray(), q: m.quaternion.toArray(), s: m.scale.toArray(), v: m.visible };
        hide(m.userData, 'baseGeo', m.geometry);
        pieces.push(m);
      });
      gkey = gkey || id;
      grp.name = id;
      grp.userData.part = { id: id, gkey: gkey, label: label, pivot: c.clone(), xf: xf || xfs[id] || null, gxf: GPARTS[gkey] || null };
      hide(grp.userData.part, 'inner', inner); hide(grp.userData.part, 'pieces', pieces); hide(grp.userData.part, 'mirrors', mirrors);
      // Kasten der Griffpunkte für das ganze Teil (Raum der inneren Gruppe, gebaute Lage)
      inner.updateMatrixWorld(true);
      var lb = new THREE.Box3();
      pieces.forEach(function (m) { lb.expandByObject(m); });
      if (!lb.isEmpty()) grp.userData.part.lbox = { min: lb.min.toArray(), size: lb.getSize(new THREE.Vector3()).toArray() };
      g.add(grp); parts.push(grp);
      applyPart(grp);
      return grp;
    }
    // Schnabel: ein Teil, leicht geöffnet
    // wie das Vorbild: kräftiger, runder Schnabel, nur leicht geöffnet
    var bg = billGeometry(0.44, 0.33, 0.15, 0.09), bill = new THREE.Group();
    bill.position.set(1.1, 0.92, 0); bill.rotation.z = -0.1;
    var billU = new THREE.Mesh(bg.upper, beak), billL = new THREE.Mesh(bg.lower, beak);
    billU.name = 'Upper bill'; billL.name = 'Lower bill';
    billU.position.x = billL.position.x = bg.hinge;
    bill.add(billU, billL);
    if (!o.noBill) part('bill', 'Bill', function () { g.add(bill); });
    // Flügel, leicht angelegt (bei Uniform in Uniformfarbe, mit Streifen am Ärmel)
    // noWings: wer eigene Arme animiert (Messer-Ente), lässt die angelegten Flügel weg
    if (!opts.noWings) [-1, 1].forEach(function (s) {
      part(s < 0 ? 'wingR' : 'wingL', s < 0 ? 'Right wing' : 'Left wing', function () {
        var w = new THREE.Mesh(ell(0.5, 0.3, 0.12, 32), wingMat); w.name = 'Wing';
        w.position.set(-0.05, 0.12, s * (0.79 + 0.78 * ((+o.girth || 1) - 1))); w.rotation.set(s * 0.15, s * 0.12, 0.35);
        g.add(w);
      });
    });
    // aufgemalte Augen: flach auf dem Kopf, entlang der Normalen
    var HC = new THREE.Vector3(PARTS[5].c[0], PARTS[5].c[1], 0), HR = PARTS[5].r;
    function headPoint(dir, rad) {
      var n = dir.clone().normalize();
      return HC.clone().add(new THREE.Vector3(n.x * HR[0], n.y * HR[1], n.z * HR[2]).multiplyScalar(rad || 1));
    }
    function decal(geo, mat, dir, rad) {
      var n = dir.clone().normalize(), m = new THREE.Mesh(geo, mat);
      m.position.copy(headPoint(dir, rad || (o.cowl ? 1.012 : 0.995)));
      m.lookAt(m.position.clone().add(n));
      g.add(m); return m;
    }
    var eyeCol = o.eyeColor != null ? new THREE.MeshBasicMaterial({ color: o.eyeColor }) : null;
    if (eyeCol) eyeCol.color.convertSRGBToLinear();
    part('eyes', 'Eyes', function () {
      if (o.eyes === 'one') { oneEye(); return; }
      [-1, 1].forEach(function (s) {
      var n0 = g.children.length;
      eyeSide(s);
      g.children.slice(n0).forEach(function (m, j) { m.name = (s < 0 ? 'Right eye' : 'Left eye') + (j ? ' ' + (j + 1) : ''); });
    }); });
    // Zyklop: ein großes Auge mittig über dem Schnabel (Augapfel, Iris in eyeColor, Pupille, Glanzpunkt)
    function oneEye() {
      var ed = new THREE.Vector3(0.8, 0.42, 0), r0 = o.cowl || o.face != null || o.pattern ? 1.012 : 0.995, n0 = g.children.length;
      decal(ell(0.2, 0.17, 0.012, 32), white, ed, r0);
      decal(ell(0.105, 0.105, 0.012, 24), eyeCol || paint, ed, r0 + 0.003);
      if (eyeCol) decal(ell(0.055, 0.06, 0.012, 20), paint, ed, r0 + 0.005);
      decal(ell(0.028, 0.03, 0.014, 10), white, new THREE.Vector3(0.84, 0.5, -0.07), r0 + 0.008);
      ['Eyeball', 'Iris', 'Pupil', 'Shine'].filter(function (x, i) { return eyeCol || i !== 2; })
        .forEach(function (nm, j) { g.children[n0 + j].name = nm; });
    }
    function eyeSide(s) {
      var ed = new THREE.Vector3(0.8, 0.36, s * 0.5), e2;
      if (o.eyes === 'none') return;
      if (o.eyes === 'white' || o.eyes === 'glow') {
        // Maske: schmale Augenschlitze (weiß bzw. leuchtend in eyeColor)
        var sl = decal(ell(0.1, 0.05, 0.012, 20), o.eyes === 'glow' ? (eyeCol || white) : white, ed);
        sl.rotateZ(s * -0.35);
      } else if (o.eyes === 'lens') {
        // große Maskenlinsen: schwarzer Rand, weiße Fläche
        e2 = decal(ell(0.17, 0.13, 0.012, 24), paint, ed); e2.rotateZ(s * -0.3);
        e2 = decal(ell(0.145, 0.105, 0.012, 24), white, ed, (o.cowl || o.face != null || o.pattern ? 1.012 : 0.995) + 0.004); e2.rotateZ(s * -0.3);
      } else if (o.eyes === 'x') {
        [0.6, -0.6].forEach(function (r) { var xb = decal(new THREE.BoxGeometry(0.17, 0.035, 0.012), paint, ed); xb.rotateZ(r); });
      } else if (o.eyes === 'big' || o.eyes === 'sockets') {
        // große dunkle Ovale (Alien, Totenkopf, Geist)
        e2 = decal(ell(o.eyes === 'big' ? 0.13 : 0.12, o.eyes === 'big' ? 0.17 : 0.13, 0.012, 24), paint, ed); e2.rotateZ(s * (o.eyes === 'big' ? -0.5 : 0));
        if (o.eyes === 'big') decal(ell(0.03, 0.035, 0.014, 10), white, new THREE.Vector3(0.84, 0.46, s * 0.42), 1.003);
        if (eyeCol) decal(ell(0.035, 0.035, 0.014, 10), eyeCol, ed, 1.004);
      } else if (o.eyes === 'sleepy') {
        e2 = decal(ell(0.09, 0.03, 0.012, 20), paint, ed); e2.rotateZ(s * -0.15);
      } else {
        if (eyeCol) {
          // farbige Iris mit Pupille
          decal(ell(0.085, 0.105, 0.012, 20), eyeCol, ed);
          decal(ell(0.045, 0.07, 0.013, 16), paint, ed, (o.cowl || o.face != null ? 1.012 : 0.995) + 0.002);
          decal(ell(0.02, 0.024, 0.014, 10), white, new THREE.Vector3(0.84, 0.44, s * 0.44), 1.004);
          return;
        }
        decal(ell(0.08, 0.1, 0.012, 20), paint, new THREE.Vector3(0.8, 0.36, s * 0.5));
        decal(ell(0.026, 0.03, 0.014, 10), white, new THREE.Vector3(0.84, 0.44, s * 0.44), 1.003);
      }
    }

    // Helm (THW gelb, Feuerwehr silber mit Nackenschutz) mit Schild vorn
    // Helm wie ein Schutzhelm oben auf dem Kopf: Rand auf Stirnhöhe über den Augen
    // (Augen bei ~HC.y+0.23), Kuppel etwas flacher als der Kopf
    if (o.helmet) part('helmet', 'Helmet', function () {
      var hm = o.helmet.metal ? vinyl(o.helmet.color, { metalness: 0.7, roughness: 0.3, envMapIntensity: 1.0 }) : vinyl(o.helmet.color, { roughness: 0.35, clearcoat: 0.8 });
      // Rand liegt direkt auf dem Kopf auf (Kopfradius auf dieser Höhe + Wandstärke)
      var RIM_Y = HC.y + 0.29, tilt = 0.1;
      var rimR = HR[0] * Math.sqrt(Math.max(0.2, 1 - Math.pow((RIM_Y - HC.y) / HR[1], 2))) + 0.025;
      var helmet = new THREE.Group(); helmet.position.set(HC.x - 0.03, RIM_Y, 0); helmet.rotation.z = tilt; g.add(helmet);
      var dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5), hm);
      dome.name = 'Dome'; dome.scale.set(rimR, 0.37, rimR * HR[2] / HR[0]); helmet.add(dome);
      var brim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 10, 64), hm);
      brim.name = 'Brim'; brim.scale.set(rimR + 0.02, (rimR + 0.02) * HR[2] / HR[0], 1); brim.rotation.x = Math.PI / 2; helmet.add(brim);
      // Kamm oben (typisch für Schutzhelme)
      var ridge = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12), hm);
      ridge.name = 'Ridge'; ridge.scale.set(rimR * 0.95, 0.39, 0.06); helmet.add(ridge);
      if (o.helmet.neck) {
        // Nackenschutz hinten (phi 0 liegt bei −x)
        var neckG = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.5, Math.PI * 0.2), hm);
        neckG.material.side = THREE.DoubleSide; neckG.name = 'Neck guard';
        neckG.scale.set(rimR + 0.04, 0.45, (rimR + 0.04) * HR[2] / HR[0]); helmet.add(neckG);
      }
      if (o.helmetLabel) {
        var lab = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.12), new THREE.MeshStandardMaterial({ map: textTex(o.helmetLabel, '#1d2b5e', '#ffffff'), transparent: true, roughness: 0.4 }));
        var la = 0.55, lp = new THREE.Vector3(Math.cos(la) * rimR * 1.01, Math.sin(la) * 0.37 * 1.01, 0);
        lab.position.copy(lp); lab.lookAt(lp.clone().add(new THREE.Vector3(Math.cos(la) / rimR, Math.sin(la) / 0.37, 0).normalize()));
        lab.name = 'Label'; helmet.add(lab);
      }
    });
    // Polizeimütze: Band, oben breiter Deckel, schwarzer Schirm, Stern
    if (o.cap) part('cap', 'Police cap', function () {
      var capM = vinyl(o.suit), black = vinyl(0x111318, { roughness: 0.2, clearcoat: 1 });
      var band2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.18, 48), black);
      band2.position.copy(HC).add(new THREE.Vector3(-0.02, 0.4, 0)); band2.rotation.z = 0.12; band2.name = 'Band'; g.add(band2);
      var top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 0.2, 48), capM);
      top.position.copy(HC).add(new THREE.Vector3(-0.04, 0.58, 0)); top.rotation.z = 0.12; top.name = 'Crown'; g.add(top);
      var visor = new THREE.Mesh(ell(0.3, 0.04, 0.42, 32), black);
      visor.position.copy(HC).add(new THREE.Vector3(0.48, 0.32, 0)); visor.rotation.z = -0.25; visor.name = 'Visor'; g.add(visor);
      var badge = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: emblemTex('star'), transparent: true, metalness: 0.5, roughness: 0.35 }));
      var bp = HC.clone().add(new THREE.Vector3(0.5, 0.47, 0)); badge.position.copy(bp); badge.lookAt(bp.clone().add(new THREE.Vector3(1, 0.2, 0)));
      badge.name = 'Star badge'; g.add(badge);
    });
    // Fledermaus-Ohren auf der Maske
    if (o.ears) part('ears', 'Bat ears', function () {
      var cowlM = vinyl(o.cowl, { roughness: 0.4 });
      [-1, 1].forEach(function (s) {
        var ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.38, 24), cowlM);
        ear.position.copy(headPoint(new THREE.Vector3(0.05, 0.85, s * 0.5), 0.92)).add(new THREE.Vector3(0, 0.12, 0));
        ear.rotation.set(s * 0.25, 0, 0.1); ear.name = s < 0 ? 'Right ear' : 'Left ear'; g.add(ear);
      });
    });
    // Umhang: oben ein Kragen um den Nacken (dort, wo hinten die Maske endet), von dort
    // über den Rücken bis etwa zur Schwanzwurzel; wölbt sich zu den Seiten herab
    if (o.cape) part('cape', 'Cape', function () {
      var cf = formOf('cape', Object.assign({}, (GPARTS.cape || {}).form, (xfs.cape || {}).form));
      var U = 28, V = 24, cpos = [], cidx = [], COLLAR_Y = 0.74 + cf.collar;
      var topAt = function (x) {             // Rücken-Oberseite (Mittellinie) des Rumpfs bei x
        var q = new THREE.Vector3(x, 1.6, 0), lo = -0.6, hi = 1.6, hit = false;
        for (var yy = 1.6; yy > -0.6; yy -= 0.04) { q.y = yy; if (sdTrunk(q) < 0) { hit = true; lo = yy; hi = yy + 0.04; break; } }
        if (!hit) return null;
        for (var it = 0; it < 18; it++) { var m = (lo + hi) / 2; q.y = m; if (sdTrunk(q) < 0) lo = m; else hi = m; }
        return lo;
      };
      // Kragen: Punkte rund um den Nacken (hintere Hälfte), knapp über der Haut
      var collar = [];
      for (var uu0 = 0; uu0 <= U; uu0++) {
        var sp = surfaceAt(COLLAR_Y, Math.PI + (uu0 / U * 2 - 1) * cf.around, 0.42);
        collar.push(sp.p.clone().addScaledVector(sp.n, 0.012));
      }
      var lastTop = 0.5;
      for (var vv = 0; vv <= V; vv++) {
        var tv = vv / V;
        var xc = -0.2 - tv * 0.62 * cf.len;     // Länge 1: endet vor der Schwanzspitze
        var tp = topAt(xc); if (tp !== null) lastTop = tp;
        var half = 0.38 * cf.top + 0.5 * cf.flare * tv, toCollar = 1 - Math.min(1, tv / 0.3);
        toCollar = toCollar * toCollar * (3 - 2 * toCollar);
        for (var uu = 0; uu <= U; uu++) {
          var z = (uu / U * 2 - 1) * half;
          var q = new THREE.Vector3(xc, lastTop + 0.025 - 0.9 * cf.wrap * z * z - Math.max(0, tv - 0.8) * 0.4 - Math.max(0, -1.05 - xc) * 0.9, z);
          q.lerp(collar[uu], toCollar);
          // nie in den Rumpf schneiden: so weit anheben, bis Abstand da ist
          for (var k = 0; k < 60 && sdTrunk(q) < 0.02; k++) q.y += 0.01;
          // in der Mitte nach unten hin leicht vom Rücken weg bauschen (liegt nicht an)
          var mid = 1 - Math.pow(uu / U * 2 - 1, 2);
          var tb = Math.max(0, (tv - 0.35) / 0.65);  // am Nacken anliegend, erst weiter hinten bauschig
          q.y += 0.07 * cf.billow * tb * mid; q.x -= 0.05 * cf.billow * tb * mid;
          cpos.push(q.x, q.y, q.z);
        }
      }
      for (var a = 0; a < V; a++) for (var c = 0; c < U; c++) {
        var i0 = a * (U + 1) + c;
        cidx.push(i0, i0 + U + 1, i0 + 1, i0 + 1, i0 + U + 1, i0 + U + 2);
      }
      var cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
      cg.setIndex(cidx); cg.computeVertexNormals();
      var capeMesh = new THREE.Mesh(cg, vinyl(o.cape, { side: THREE.DoubleSide, roughness: 0.6, clearcoat: 0.1 }));
      // Ruheform merken: zum Flattern wird um sie herum ausgelenkt. Die Richtung je Punkt
      // zeigt sicher vom Körper weg (Flächennormalen können je nach Reihenfolge nach innen zeigen)
      var nrmArr = Float32Array.from(cg.attributes.normal.array), pp = new THREE.Vector3(), pn = new THREE.Vector3();
      for (var ni = 0; ni < nrmArr.length; ni += 3) {
        pp.set(cpos[ni], cpos[ni + 1], cpos[ni + 2]);
        pn.set(pp.x + nrmArr[ni] * 0.03, pp.y + nrmArr[ni + 1] * 0.03, pp.z + nrmArr[ni + 2] * 0.03);
        if (sdTrunk(pn) < sdTrunk(pp)) { nrmArr[ni] = -nrmArr[ni]; nrmArr[ni + 1] = -nrmArr[ni + 1]; nrmArr[ni + 2] = -nrmArr[ni + 2]; }
      }
      capeMesh.name = 'Cape';
      capeMesh.userData.cape = { base: Float32Array.from(cpos), nrm: nrmArr, U: U, V: V };
      g.add(capeMesh);
    });
    // Zubehör (Hüte, Haare, Brillen, Requisiten): ACC[name](ctx, opts), siehe js/rubber-duck-outfits.js
    if (o.acc) {
      var ctx = { g: g, o: o, HC: HC, HR: HR, headPoint: headPoint, decal: decal, paint: paint, white: white, skin: skin, body: yellow, wingMat: wingMat };
      o.acc.forEach(function (a, i) {
        // noProps: Requisiten, die die Ente in der Flügelspitze hält, weglassen (Messer-Ente hat eigene Arme)
        if (opts.noProps && HELD[a[0]]) return;
        var fn = ACC[a[0]], ao = a[1] || {};
        // Form-Regler (FORMS): global umgebaut, darüber das Outfit
        var gf = (GPARTS['acc:' + a[0]] || {}).form, of = (ao.xf || {}).form;
        var ao2 = gf || of ? Object.assign({}, ao, { form: Object.assign({}, gf, of) }) : ao;
        if (fn) part('acc:' + i, ACC_LABELS[a[0]] || a[0], function () { fn(ctx, ao2); }, ao.xf, 'acc:' + a[0]);
      });
    }
    g.userData = { body: b, head: HC, headR: HR, decal: decal, wingMat: wingMat };
    hide(g.userData, 'parts', parts);
    return g;
  }

  // Umhang flattern lassen: time in s, strength 0..1+ (Wind bzw. Fahrtwind), phase
  // verschiebt das Muster je Ente. Am Kragen fest, nach unten immer freier.
  function flutter(duck, time, strength, phase) {
    duck.traverse(function (m) {
      var c = m.userData && m.userData.cape;
      if (!c) return;
      var pa = m.geometry.attributes.position, arr = pa.array, U = c.U, V = c.V, ph = phase || 0;
      for (var v = 0; v <= V; v++) {
        var tv = v / V, free = Math.pow(tv, 1.4) * strength;
        for (var u = 0; u <= U; u++) {
          var i = (v * (U + 1) + u) * 3, uu = u / U * 2 - 1;
          var wave = Math.sin(time * 7 + tv * 6 - uu * 1.5 + ph) * 0.07 + Math.sin(time * 11.3 + tv * 9 + uu * 2.6 + ph * 1.7) * 0.03;
          // nur nach außen schwingen (nach innen läge der Stoff im Körper und wirkte angeklebt)
          var off = free * (Math.abs(wave) + 0.06);
          arr[i] = c.base[i] + c.nrm[i] * off - free * 0.08;          // nach hinten wehen
          arr[i + 1] = c.base[i + 1] + c.nrm[i + 1] * off + free * 0.06; // leicht anheben
          arr[i + 2] = c.base[i + 2] + c.nrm[i + 2] * off;
        }
      }
      pa.needsUpdate = true;
      m.geometry.computeVertexNormals();
    });
  }
  // Klon mit eigener Umhang-Geometrie (sonst flattern alle Klone gleich)
  function cloneDuck(src) {
    var c = src.clone();
    c.traverse(function (m) {
      if (m.userData && m.userData.cape) m.geometry = m.geometry.clone();
    });
    return c;
  }

  // Teil-Anpassung aus dem Editor: p = Verschiebung, r = Drehung in Grad, s = Maßstab (x, y, z),
  // c = Farbe (0xRRGGBB), hide = ausblenden, sub = dasselbe je Unterteil (Name bzw. Index → Anpassung),
  // dort zusätzlich b = Biegung [vorn/hinten, seitlich]: Ränder heben (+) oder senken (−).
  // Zwei Ebenen: gxf = global umgebautes Teil (Part-Werkstatt), xf = Anpassung im Outfit; das
  // Outfit wirkt auf das global umgebaute Teil. Alles relativ zur gebauten Lage.
  var DEG = Math.PI / 180;
  // Verweise auf Three-Objekte nicht aufzählbar ablegen: clone() kopiert userData per JSON
  function hide(obj, k, v) { Object.defineProperty(obj, k, { value: v, writable: true, configurable: true, enumerable: false }); }
  function v3(a, d) { return a ? [+a[0] || 0, +a[1] || 0, +a[2] || 0] : [d, d, d]; }
  function sc3(a) { return a ? [+a[0] || 1, +a[1] || 1, +a[2] || 1] : [1, 1, 1]; }
  function rq(r) { var e = v3(r, 0); return new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0] * DEG, e[1] * DEG, e[2] * DEG)); }
  // Unterteil-Schlüssel: Name (bleibt gleich, auch wenn ein Outfit Stücke weglässt), sonst Index
  function pieceKey(m, i) { return m.name || String(i); }
  function subOf(xf, k) { return (xf && xf.sub && xf.sub[k]) || {}; }
  // Farbe setzen; bei mehreren Materialien (z. B. Kragen außen/Futter) nur das erste (außen)
  function setMat(m, c) {
    if (!m.material) return;
    if (!m.userData.origMat) hide(m.userData, 'origMat', m.material);
    if (c == null) { m.material = m.userData.origMat; return; }
    var arr = Array.isArray(m.material);
    if (m.material === m.userData.origMat) m.material = arr ? m.material.slice() : m.material.clone();
    var t = arr ? m.material[0] : m.material;
    if (arr && t === m.userData.origMat[0]) t = m.material[0] = t.clone();
    if (t && t.color) t.color.set(c).convertSRGBToLinear();
  }
  // Griffpunkte: 3×3×3 Gitter über einem Kasten, l = 81 Zahlen (Verschiebung je Punkt, x/y/z),
  // Punkt-Index = i·9 + j·3 + k (i entlang x, j entlang y, k entlang z). Quadratische
  // Interpolation durch die Punkte: ein Punkt, der verschoben wird, nimmt die Fläche genau dort mit.
  function lagr(t) { return [2 * (t - 0.5) * (t - 1), 4 * t * (1 - t), 2 * t * (t - 0.5)]; }
  function latOn(l) { if (!l) return false; for (var i = 0; i < l.length; i++) if (l[i]) return true; return false; }
  function latSum(a, b) {
    if (!latOn(a)) return latOn(b) ? b : null;
    if (!latOn(b)) return a;
    var r = []; for (var i = 0; i < 81; i++) r.push((+a[i] || 0) + (+b[i] || 0)); return r;
  }
  function latRest(box, idx) {
    var i = Math.floor(idx / 9), j = Math.floor(idx / 3) % 3, k = idx % 3;
    return [box.min[0] + box.size[0] * i / 2, box.min[1] + box.size[1] * j / 2, box.min[2] + box.size[2] * k / 2];
  }
  function latAt(box, l, x, y, z, out) {
    var wx = lagr(box.size[0] ? (x - box.min[0]) / box.size[0] : 0.5), wy = lagr(box.size[1] ? (y - box.min[1]) / box.size[1] : 0.5), wz = lagr(box.size[2] ? (z - box.min[2]) / box.size[2] : 0.5);
    out[0] = out[1] = out[2] = 0;
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      var wij = wx[i] * wy[j];
      if (!wij) continue;
      for (var k = 0; k < 3; k++) {
        var w = wij * wz[k], n = (i * 9 + j * 3 + k) * 3;
        if (!w) continue;
        out[0] += w * (+l[n] || 0); out[1] += w * (+l[n + 1] || 0); out[2] += w * (+l[n + 2] || 0);
      }
    }
    return out;
  }
  function geoBox(g) { if (!g.boundingBox) g.computeBoundingBox(); var b = g.boundingBox; return { min: b.min.toArray(), size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z] }; }
  // Lage eines Unterteils im Raum der inneren Gruppe
  function pieceMatrix(m, inner) {
    var M = new THREE.Matrix4();
    for (var o = m; o && o !== inner; o = o.parent) { o.updateMatrix(); M.premultiply(o.matrix); }
    return M;
  }
  // Verformen aus der gebauten Geometrie: Griffpunkte des Unterteils (lp), Biegung (b),
  // Griffpunkte des ganzen Teils (L im Raum der inneren Gruppe, Kasten box)
  // Verformen aus der Quell-Geometrie src (gebaut bzw. aus Grundform-Reglern neu erzeugt):
  // Griffpunkte des Unterteils (lp), Biegung (b), Griffpunkte des ganzen Teils (L, Kasten box)
  function deform(m, src, b, lp, L, box, inner) {
    if (m.userData.cape) { deformCape(m, b, lp, L, box, inner); return; }
    hide(m.userData, 'srcGeo', src);
    var bx = b ? +b[0] || 0 : 0, bz = b ? +b[1] || 0 : 0, any = bx || bz || lp || (L && box);
    if (!any) { m.geometry = src; return; }
    var geo = m.userData.defGeo;
    if (!geo || m.userData.defSrc !== src) { if (geo) geo.dispose(); geo = src.clone(); hide(m.userData, 'defGeo', geo); hide(m.userData, 'defSrc', src); }
    var bb = geoBox(src), hx = Math.max(Math.abs(bb.min[0]), Math.abs(bb.min[0] + bb.size[0])) || 1, hz = Math.max(Math.abs(bb.min[2]), Math.abs(bb.min[2] + bb.size[2])) || 1;
    var a0 = src.attributes.position.array, a = geo.attributes.position.array, d = [0, 0, 0];
    var M = null, Mi = null, v = new THREE.Vector3(), dv = new THREE.Vector3();
    if (L && box) { M = pieceMatrix(m, inner); Mi = new THREE.Matrix3().setFromMatrix4(M).invert(); }
    for (var i = 0; i < a.length; i += 3) {
      var x = a0[i], y = a0[i + 1], z = a0[i + 2];
      if (lp) { latAt(bb, lp, x, y, z, d); x += d[0]; y += d[1]; z += d[2]; }
      if (bx || bz) { var nx = a0[i] / hx, nz = a0[i + 2] / hz; y += bx * nx * nx + bz * nz * nz; }
      if (M) {
        v.set(x, y, z).applyMatrix4(M);
        latAt(box, L, v.x, v.y, v.z, d);
        dv.set(d[0], d[1], d[2]).applyMatrix3(Mi);
        x += dv.x; y += dv.y; z += dv.z;
      }
      a[i] = x; a[i + 1] = y; a[i + 2] = z;
    }
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.computeBoundingBox();
    m.geometry = geo;
  }

  // Umhang: verformt wird seine Ruheform (base, um die er flattert), Quelle ist die gebaute Fläche
  function deformCape(m, b, lp, L, box, inner) {
    var c = m.userData.cape;
    if (!m.userData.capeSrc) { var g0 = m.geometry.clone(); g0.computeBoundingBox(); hide(m.userData, 'capeSrc', g0); hide(m.userData, 'srcGeo', g0); }
    var src = m.userData.capeSrc, a0 = src.attributes.position.array, a = m.geometry.attributes.position.array;
    var bb = geoBox(src), hx = Math.max(Math.abs(bb.min[0]), Math.abs(bb.min[0] + bb.size[0])) || 1, hz = Math.max(Math.abs(bb.min[2]), Math.abs(bb.min[2] + bb.size[2])) || 1;
    var bx = b ? +b[0] || 0 : 0, bz = b ? +b[1] || 0 : 0, d = [0, 0, 0], M = null, Mi = null, v = new THREE.Vector3(), dv = new THREE.Vector3();
    if (L && box) { M = pieceMatrix(m, inner); Mi = new THREE.Matrix3().setFromMatrix4(M).invert(); }
    for (var i = 0; i < a.length; i += 3) {
      var x = a0[i], y = a0[i + 1], z = a0[i + 2];
      if (lp) { latAt(bb, lp, x, y, z, d); x += d[0]; y += d[1]; z += d[2]; }
      if (bx || bz) { var nx = a0[i] / hx, nz = a0[i + 2] / hz; y += bx * nx * nx + bz * nz * nz; }
      if (M) { v.set(x, y, z).applyMatrix4(M); latAt(box, L, v.x, v.y, v.z, d); dv.set(d[0], d[1], d[2]).applyMatrix3(Mi); x += dv.x; y += dv.y; z += dv.z; }
      a[i] = x; a[i + 1] = y; a[i + 2] = z;
    }
    c.base = Float32Array.from(a);
    m.geometry.attributes.position.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere(); m.geometry.computeBoundingBox();
  }

  // ── Grundformen: Stücke aus Quader, Zylinder, Kegel, Kugel, Ring lassen sich über ihre Maße
  // neu bauen (Editor „Shape“), dazu Quader mit runden Ecken, Biegen als Bogen, Zylinder als Feder,
  // Schlauch entlang von Knickpunkten. userData.prim = {t, p (Maße), a (Bau-Argumente), sc, off}:
  // sc/off = nachträgliche Streckung/Verschiebung der gebauten Geometrie (z. B. ell()).
  // Schlauch (t: 'hose'): p.pts Knickpunkte, p.spline = weiche Kurve statt Knicke, p.closed = Ring,
  // p.flat/p.twist = flaches Band; hug = Körperform-Key → liegt auf dem Körper an (Träger, Bänder).
  var PRIM_TYPES = {
    BoxGeometry: ['box', ['width', 'height', 'depth', 'widthSegments', 'heightSegments', 'depthSegments']],
    CylinderGeometry: ['cyl', ['radiusTop', 'radiusBottom', 'height', 'radialSegments', 'heightSegments', 'openEnded', 'thetaStart', 'thetaLength']],
    ConeGeometry: ['cone', ['radius', 'height', 'radialSegments', 'heightSegments', 'openEnded', 'thetaStart', 'thetaLength']],
    SphereGeometry: ['sphere', ['radius', 'widthSegments', 'heightSegments', 'phiStart', 'phiLength', 'thetaStart', 'thetaLength']],
    TorusGeometry: ['torus', ['radius', 'tube', 'radialSegments', 'tubularSegments', 'arc']]
  };
  function primDetect(g) {
    var T = PRIM_TYPES[g.type];
    if (!T || !g.parameters) return null;
    var args = T[1].map(function (k) { return g.parameters[k]; });
    var ref = new (Function.prototype.bind.apply(THREE[g.type], [null].concat(args)))();
    var a = g.attributes.position.array, r = ref.attributes.position.array, ok = a.length === r.length;
    var sc = [1, 1, 1], off = [0, 0, 0];
    if (ok) {
      var A = geoBox(g), R = geoBox(ref);
      for (var k = 0; k < 3; k++) { sc[k] = R.size[k] > 1e-9 ? A.size[k] / R.size[k] : 1; off[k] = A.min[k] - R.min[k] * sc[k]; }
      for (var i = 0; i < a.length && ok; i++) { var w = r[i] * sc[i % 3] + off[i % 3]; if (Math.abs(a[i] - w) > 1e-4 * (1 + Math.abs(a[i]))) ok = false; }
    }
    ref.dispose();
    if (!ok) return null;
    var P = g.parameters, t = T[0], p;
    if (t === 'box') p = { w: P.width, h: P.height, d: P.depth };
    else if (t === 'cyl') p = { rTop: P.radiusTop, rBot: P.radiusBottom, len: P.height };
    else if (t === 'cone') p = { rTop: 0, rBot: P.radius, len: P.height };
    else if (t === 'sphere') p = { r: P.radius, part: P.thetaLength / DEG };
    else p = { R: P.radius, tube: P.tube, arc: P.arc / DEG };
    return { t: t === 'cone' ? 'cyl' : t, p: p, a: args, src: t, sc: sc, off: off };
  }
  function primOf(m) {
    if (!m || m.userData.cape) return null;
    if (m.userData.prim === undefined) { var info = null; try { info = primDetect(m.userData.baseGeo || m.geometry); } catch (e) { info = null; } m.userData.prim = info; }
    return m.userData.prim;
  }
  // Regler je Grundform: {k, label, min, max, step, def}
  function primSpec(info) {
    if (!info) return [];
    var p = info.p, L = [];
    function sz(k, label, d) { L.push({ k: k, label: label, min: 0.005, max: Math.max(1, Math.ceil(d * 40) / 10), step: 0.005, def: d }); }
    if (info.t === 'box') {
      sz('w', 'Length (X)', p.w); sz('h', 'Height (Y)', p.h); sz('d', 'Depth (Z)', p.d);
      L.push({ k: 'round', label: 'Round corners', min: 0, max: 0.3, step: 0.002, def: 0 });
      L.push({ k: 'bend', label: 'Bend (°)', min: -360, max: 360, step: 1, def: 0 });
    } else if (info.t === 'cyl') {
      sz('rTop', 'Top radius', p.rTop); sz('rBot', 'Bottom radius', p.rBot); sz('len', 'Length', p.len);
      L.push({ k: 'bend', label: 'Bend (°)', min: -360, max: 360, step: 1, def: 0 });
      L.push({ k: 'bendDir', label: 'Bend direction (°)', min: 0, max: 360, step: 1, def: 0 });
      L.push({ k: 'turns', label: 'Spring turns (0 = solid)', min: 0, max: 30, step: 0.5, def: 0 });
      L.push({ k: 'wire', label: 'Spring wire', min: 0.003, max: 0.15, step: 0.001, def: Math.max(0.006, Math.round((p.rTop + p.rBot) * 0.12 * 1000) / 1000) });
    } else if (info.t === 'sphere') {
      sz('r', 'Radius', p.r);
      L.push({ k: 'part', label: 'Cut off (° from top)', min: 10, max: 180, step: 1, def: p.part });
    } else if (info.t === 'torus') {
      sz('R', 'Ring radius', p.R); sz('tube', 'Thickness', p.tube);
      L.push({ k: 'arc', label: 'Closed (°)', min: 10, max: 360, step: 1, def: p.arc });
    } else if (info.t === 'hose') {
      L.push({ k: 'r', label: 'Thickness (half width)', min: 0.004, max: 0.25, step: 0.001, def: p.r });
      L.push({ k: 'flat', label: 'Flatness (0 = round, 1 = band)', min: 0, max: 0.98, step: 0.01, def: p.flat || 0 });
      if (info.hug != null) L.push({ k: 'lift', label: 'Distance from body', min: 0, max: 0.2, step: 0.001, def: p.lift != null ? p.lift : 0.02 });
      else L.push({ k: 'twist', label: 'Turn the band (°)', min: -180, max: 180, step: 1, def: p.twist || 0 });
      L.push({ k: 'taper', label: 'End thickness (×)', min: 0.05, max: 3, step: 0.01, def: p.taper != null ? p.taper : 1 });
      if (!p.spline) L.push({ k: 'round', label: 'Round kinks', min: 0, max: 1, step: 0.01, def: p.round != null ? p.round : 0.5 });
      L.push({ k: 'turns', label: 'Coil turns (0 = smooth)', min: 0, max: 80, step: 0.5, def: 0 });
      L.push({ k: 'coil', label: 'Coil width', min: 0.01, max: 0.4, step: 0.005, def: 0.06 });
    }
    return L;
  }
  function primParams(info, gp) {
    var r = {}, sp = primSpec(info);
    sp.forEach(function (s) { var v = gp && gp[s.k] != null ? +gp[s.k] : s.def; r[s.k] = isFinite(v) ? Math.min(s.max, Math.max(s.min, v)) : s.def; });
    if (info.t === 'hose') r.pts = (gp && Array.isArray(gp.pts) && gp.pts.length >= 2 ? gp.pts : info.p.pts).map(function (q) { return v3(q, 0); });
    return r;
  }
  // Bogen: entlang Achse ai biegen, Richtung dir (Einheitsvektor senkrecht dazu), Winkel in Grad
  function bendGeo(g, ai, dir, deg) {
    var th = deg * DEG; if (!th) return;
    var bb = geoBox(g), L = bb.size[ai]; if (!L) return;
    var c = bb.min[ai] + L / 2, R = L / th, a = g.attributes.position.array, v = new THREE.Vector3();
    for (var i = 0; i < a.length; i += 3) {
      v.set(a[i], a[i + 1], a[i + 2]);
      var s = v.getComponent(ai) - c, d = v.dot(dir), ph = s / R;
      var ns = (R - d) * Math.sin(ph), nd = R - (R - d) * Math.cos(ph);
      v.addScaledVector(dir, nd - d); v.setComponent(ai, c + ns);
      a[i] = v.x; a[i + 1] = v.y; a[i + 2] = v.z;
    }
    g.attributes.position.needsUpdate = true; g.computeVertexNormals();
  }
  function roundBox(g, hx, hy, hz, r) {
    var a = g.attributes.position.array, n = g.attributes.normal.array, h = [hx - r, hy - r, hz - r];
    for (var i = 0; i < a.length; i += 3) {
      var q = [0, 1, 2].map(function (k) { return Math.max(-h[k], Math.min(h[k], a[i + k])); });
      var d = [a[i] - q[0], a[i + 1] - q[1], a[i + 2] - q[2]], l = Math.hypot(d[0], d[1], d[2]);
      if (l < 1e-9) continue;
      for (var k = 0; k < 3; k++) { n[i + k] = d[k] / l; a[i + k] = q[k] + d[k] / l * r; }
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  }
  // Linie durch Punkte (gleichmäßig nach Länge), für Schlauch und Feder
  class PathCurve extends THREE.Curve {
    constructor(pts) {
      super(); this.pts = pts; this.acc = [0];
      for (var i = 1; i < pts.length; i++) this.acc.push(this.acc[i - 1] + pts[i].distanceTo(pts[i - 1]));
    }
    getPoint(t, target) {
      var o = target || new THREE.Vector3(), P = this.pts, A = this.acc, L = A[A.length - 1], s = Math.max(0, Math.min(1, t)) * L, i = 1;
      while (i < A.length - 1 && A[i] < s) i++;
      var seg = A[i] - A[i - 1], f = seg > 1e-9 ? (s - A[i - 1]) / seg : 0;
      return o.copy(P[i - 1]).lerp(P[i], f);
    }
  }
  function roundedPath(pts, k) {
    var out = [pts[0].clone()];
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], b = pts[i], c = pts[i + 1], d = k * 0.5 * Math.min(a.distanceTo(b), b.distanceTo(c));
      if (d < 1e-5) { out.push(b.clone()); continue; }
      var p1 = b.clone().add(a.clone().sub(b).normalize().multiplyScalar(d)), p2 = b.clone().add(c.clone().sub(b).normalize().multiplyScalar(d));
      for (var s = 0; s <= 10; s++) { var t = s / 10, u = 1 - t; out.push(new THREE.Vector3().addScaledVector(p1, u * u).addScaledVector(b, 2 * u * t).addScaledVector(p2, t * t)); }
    }
    out.push(pts[pts.length - 1].clone());
    return out.filter(function (p, i) { return !i || p.distanceTo(out[i - 1]) > 1e-6; });
  }
  // Wendel um einen Pfad (Feder): Windungen, Weite, Draht
  function coilGeo(curve, turns, width, r0, r1, wire) {
    var n = Math.max(48, Math.ceil(turns * 40)), fr = curve.computeFrenetFrames(n, false), pts = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, a = t * turns * Math.PI * 2, w = width != null ? width : r0 + (r1 - r0) * t;
      pts.push(curve.getPointAt(t).addScaledVector(fr.normals[i], Math.cos(a) * w).addScaledVector(fr.binormals[i], Math.sin(a) * w));
    }
    return new THREE.TubeGeometry(new PathCurve(pts), n * 2, wire / 2, 10, false);
  }
  // Körperoberfläche für anliegende Schläuche (Träger): key = Körperform des Outfits (CUR_KEY beim Bau),
  // liefert für einen Punkt den radial projizierten Oberflächenpunkt samt Normale
  var HUGS = {};
  function hugger(key) {
    key = String(key || '');
    if (!HUGS[key]) {
      var parts = key ? shapeFor({ girth: parseFloat(key) || 1, muscles: /m$/.test(key) }).parts : PARTS;
      HUGS[key] = function (q) { var pc = CUR; CUR = parts; try { return surface(q.clone().sub(CENTER)); } finally { CUR = pc; } };
    }
    return HUGS[key];
  }
  // Schlauch-Querschnitt entlang einer Kurve: Ellipse mit Halbachsen r (Breite) und r·(1 − flat) (Dicke),
  // taper verjüngt zum Ende, twist dreht das Band um die Linie. Mit hug sitzen die Knickpunkte auf dem
  // Körper (Abstand lift), die flache Seite zeigt zur Haut; zwei Punkte = Gerade, ab drei Punkten wird
  // die Kurve nur nach außen geschoben, wo sie in den Körper tauchen würde (follow).
  function sweepGeo(curve, segs, rad, P, closed, hug, follow) {
    var fr = curve.computeFrenetFrames(segs, closed), C = [], Nb = [], i, j;
    for (i = 0; i <= segs; i++) {
      var c = curve.getPointAt(i / segs);
      if (hug) {
        // nur nach außen schieben, wo die Linie in den Körper taucht – nie an die Haut heranziehen;
        // bei zwei Punkten gar nicht (Gerade bleibt Gerade)
        var s = hug(c), out = c.clone().sub(s.p).dot(s.n), lf = P.lift || 0;
        if (follow && out < lf) c = s.p.clone().addScaledVector(s.n, lf);
        Nb.push(s.n);
      }
      C.push(c);
    }
    var pos = [], nor = [], uv = [], idx = [], tw = (P.twist || 0) * DEG, ct = Math.cos(tw), st = Math.sin(tw);
    var T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), d = new THREE.Vector3(), flat = Math.min(0.98, Math.max(0, P.flat || 0));
    for (i = 0; i <= segs; i++) {
      if (hug) {
        T.copy(C[Math.min(i + 1, segs)]).sub(C[Math.max(i - 1, 0)]);
        if (T.lengthSq() < 1e-12) T.copy(fr.tangents[i]);
        T.normalize();
        N.copy(Nb[i]).addScaledVector(T, -Nb[i].dot(T));
        if (N.lengthSq() < 1e-12) N.copy(fr.normals[i]);
        N.normalize(); B.crossVectors(T, N);
      } else {
        N.copy(fr.normals[i]).multiplyScalar(ct).addScaledVector(fr.binormals[i], st);
        B.copy(fr.binormals[i]).multiplyScalar(ct).addScaledVector(fr.normals[i], -st);
      }
      var f = 1 + ((P.taper != null ? P.taper : 1) - 1) * i / segs, rB = P.r * f, rN = rB * (1 - flat);
      for (j = 0; j <= rad; j++) {
        var v = j / rad * Math.PI * 2, cs = -Math.cos(v), sn = Math.sin(v);
        pos.push(C[i].x + N.x * cs * rN + B.x * sn * rB, C[i].y + N.y * cs * rN + B.y * sn * rB, C[i].z + N.z * cs * rN + B.z * sn * rB);
        d.copy(N).multiplyScalar(cs * rB).addScaledVector(B, sn * rN);
        if (d.lengthSq() < 1e-16) d.copy(N);
        d.normalize(); nor.push(d.x, d.y, d.z);
        uv.push(i / segs, j / rad);
      }
    }
    for (i = 1; i <= segs; i++) for (j = 1; j <= rad; j++) {
      var a = (rad + 1) * (i - 1) + (j - 1), b = (rad + 1) * i + (j - 1), e = (rad + 1) * i + j, h = (rad + 1) * (i - 1) + j;
      idx.push(a, b, h, b, e, h);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  // Editor: Punkt eines anliegenden Schlauchs auf den Körper setzen
  function hugAt(info, q) { return info && info.hug != null ? hugger(info.hug)(q) : null; }
  function makePrim(info, gp) {
    var P = primParams(info, gp), g, A = info.a || [];
    if (info.t === 'box') {
      var mx = Math.max(P.w, P.h, P.d), rr = Math.min(P.round, P.w / 2, P.h / 2, P.d / 2);
      if (rr || P.bend) {
        var sg = function (v) { return Math.max(rr ? 6 : 1, Math.ceil(v / mx * 24)); };
        g = new THREE.BoxGeometry(P.w, P.h, P.d, sg(P.w), sg(P.h), sg(P.d));
        if (rr) roundBox(g, P.w / 2, P.h / 2, P.d / 2, rr);
        if (P.bend) {
          var dims = [P.w, P.h, P.d], ai = dims.indexOf(mx), di = dims.indexOf(Math.min.apply(null, dims));
          if (di === ai) di = (ai + 1) % 3;
          bendGeo(g, ai, new THREE.Vector3(di === 0 ? 1 : 0, di === 1 ? 1 : 0, di === 2 ? 1 : 0), P.bend);
        }
      } else g = new THREE.BoxGeometry(P.w, P.h, P.d, A[3], A[4], A[5]);
    } else if (info.t === 'cyl') {
      var cone = info.src === 'cone', rs = cone ? A[2] : A[3], hs = cone ? A[3] : A[4], oe = cone ? A[4] : A[5], ts = cone ? A[5] : A[6], tl = cone ? A[6] : A[7];
      if (P.turns > 0) {
        var axis = new PathCurve([new THREE.Vector3(0, -P.len / 2, 0), new THREE.Vector3(0, P.len / 2, 0)]);
        g = coilGeo(axis, P.turns, null, P.rBot, P.rTop, P.wire);
      } else g = new THREE.CylinderGeometry(P.rTop, P.rBot, P.len, rs || 32, P.bend ? Math.max(hs || 1, 32) : hs, oe, ts, tl);
      if (P.bend) bendGeo(g, 1, new THREE.Vector3(Math.cos(P.bendDir * DEG), 0, Math.sin(P.bendDir * DEG)), P.bend);
    } else if (info.t === 'sphere') {
      g = new THREE.SphereGeometry(P.r, A[1], A[2], A[3], A[4], A[5], P.part * DEG);
    } else if (info.t === 'torus') {
      g = new THREE.TorusGeometry(P.R, P.tube, A[2], A[3], P.arc * DEG);
    } else if (info.t === 'hose') {
      var hp = info.p || {}, closed = !!hp.closed, hug = info.hug != null ? hugger(info.hug) : null;
      var cps = P.pts.map(function (q) { return new THREE.Vector3(q[0], q[1], q[2]); });
      if (hug) cps = cps.map(function (q) { var s = hug(q); return s.p.clone().addScaledVector(s.n, P.lift || 0); });
      var path = hp.spline && cps.length > 1 ? new THREE.CatmullRomCurve3(cps, closed) : new PathCurve(roundedPath(cps, P.round));
      var len = path.getLength() || 1;
      if (P.turns > 0) g = coilGeo(path, P.turns, P.coil, 0, 0, P.r * 2);
      else g = sweepGeo(path, Math.max(48, Math.ceil(len / 0.01)), hp.rad || 14, P, closed && !!hp.spline, hug, cps.length > 2);
    }
    var sc = info.sc || [1, 1, 1], off = info.off || [0, 0, 0];
    if (sc[0] !== 1 || sc[1] !== 1 || sc[2] !== 1) g.scale(sc[0], sc[1], sc[2]);
    if (off[0] || off[1] || off[2]) g.translate(off[0], off[1], off[2]);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  // Quell-Geometrie eines Stücks: Grundform-Maße (geo) aus beiden Ebenen, sonst die gebaute
  function pieceSrc(m, gp) {
    var base = m.userData.baseGeo || m.geometry;
    var has = gp && Object.keys(gp).length, info = has ? primOf(m) : null;
    if (!info) { if (m.userData.primGeo) { m.userData.primGeo.dispose(); hide(m.userData, 'primGeo', null); hide(m.userData, 'primKey', null); } return base; }
    var key = JSON.stringify(gp);
    if (m.userData.primKey !== key || !m.userData.primGeo) {
      var g = null;
      try { g = makePrim(info, gp); } catch (e) { if (root.console) root.console.warn('rubber-duck: shape failed', e); }
      if (!g) return base;
      if (m.userData.primGeo) m.userData.primGeo.dispose();
      hide(m.userData, 'primGeo', g); hide(m.userData, 'primKey', key);
    }
    return m.userData.primGeo;
  }
  function applyPart(grp) {
    var P = grp.userData.part, xo = P.xf || {}, xg = P.gxf || {}, pv = P.pivot, inner = P.inner;
    var p = v3(xo.p, 0), r = v3(xo.r, 0), s = sc3(xo.s);
    grp.position.set(pv.x + p[0], pv.y + p[1], pv.z + p[2]);
    grp.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG);
    grp.scale.set(s[0], s[1], s[2]);
    grp.visible = !xo.hide && !xg.hide;
    if (inner) {
      p = v3(xg.p, 0); r = v3(xg.r, 0); s = sc3(xg.s);
      inner.position.set(p[0], p[1], p[2]); inner.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG); inner.scale.set(s[0], s[1], s[2]);
    }
    var L = latSum(xg.l, xo.l);
    (P.pieces || []).forEach(function (m, i) {
      var b = m.userData.base, k = pieceKey(m, i), so = subOf(xo, k), sg = subOf(xg, k);
      var pg = v3(sg.p, 0), po = v3(so.p, 0), sgs = sc3(sg.s), sos = sc3(so.s);
      m.position.set(b.p[0] + pg[0] + po[0], b.p[1] + pg[1] + po[1], b.p[2] + pg[2] + po[2]);
      m.quaternion.fromArray(b.q).multiply(rq(sg.r)).multiply(rq(so.r));
      m.scale.set(b.s[0] * sgs[0] * sos[0], b.s[1] * sgs[1] * sos[1], b.s[2] * sgs[2] * sos[2]);
      m.visible = b.v && !so.hide && !sg.hide;
      var bg = v3(sg.b, 0), bo = v3(so.b, 0);
      var gp = sg.geo || so.geo ? Object.assign({}, sg.geo, so.geo) : null;
      deform(m, pieceSrc(m, gp), [bg[0] + bo[0], bg[1] + bo[1]], latSum(sg.l, so.l), L, P.lbox, inner);
      setMat(m, so.c != null ? so.c : xo.c != null ? xo.c : sg.c != null ? sg.c : xg.c);
    });
    mirrorPieces(grp, P);
  }
  // Spiegelbilder (userData.mirrorOf = Name des Stücks): an der Mittelebene der Ente (z = 0)
  // gespiegelt, mit derselben Geometrie und Farbe – wandert das Teil zur Seite, geht das Bild gegenläufig
  function mirrorPieces(grp, P) {
    if (!P.mirrors || !P.mirrors.length) return;
    grp.updateMatrix(); P.inner.updateMatrix();
    var GI = new THREE.Matrix4().multiplyMatrices(grp.matrix, P.inner.matrix), GIi = GI.clone().invert(), Rz = new THREE.Matrix4().makeScale(1, 1, -1);
    P.mirrors.forEach(function (mm) {
      var src = (P.pieces || []).filter(function (p) { return p.name === mm.userData.mirrorOf; })[0];
      if (!src) { mm.visible = false; return; }
      mm.matrixAutoUpdate = false;
      mm.matrix.copy(GIi).multiply(Rz).multiply(GI).multiply(pieceMatrix(src, P.inner));
      mm.matrix.decompose(mm.position, mm.quaternion, mm.scale);
      mm.matrixWorldNeedsUpdate = true;
      mm.geometry = src.geometry; mm.material = src.material; mm.visible = src.visible;
    });
  }
  // ältere Aufrufer: nur die Outfit-Ebene setzen
  function applyXf(grp, xf) { grp.userData.part.xf = xf || null; applyPart(grp); }
  // Lage eines Unterteils (nach dem Ziehen) zurück in die Anpassung einer Ebene ('o' Outfit, 'g' global)
  function readPiece(grp, i, layer) {
    var P = grp.userData.part, m = P.pieces[i], b = m.userData.base;
    var other = subOf(layer === 'o' ? P.gxf : P.xf, pieceKey(m, i)), op = v3(other.p, 0), os = sc3(other.s);
    var p = [m.position.x - b.p[0] - op[0], m.position.y - b.p[1] - op[1], m.position.z - b.p[2] - op[2]];
    var q0 = new THREE.Quaternion().fromArray(b.q), q;
    if (layer === 'o') q = q0.multiply(rq(other.r)).invert().multiply(m.quaternion);
    else q = q0.invert().multiply(m.quaternion).multiply(rq(other.r).invert());
    var e = new THREE.Euler().setFromQuaternion(q);
    return { p: p, r: [e.x / DEG, e.y / DEG, e.z / DEG], s: [m.scale.x / (b.s[0] * os[0]), m.scale.y / (b.s[1] * os[1]), m.scale.z / (b.s[2] * os[2])] };
  }
  // global umgebaute Teile (Server: /api/fx/ducks/custom.js, Editor: Part-Werkstatt)
  var GPARTS = {};
  function applyParts(map) { Object.keys(map || {}).forEach(function (k) { if (map[k] && typeof map[k] === 'object') GPARTS[k] = map[k]; }); }
  function setPartXf(k, xf) { if (xf) GPARTS[k] = xf; else delete GPARTS[k]; }
  function partXf(k) { return GPARTS[k] ? JSON.parse(JSON.stringify(GPARTS[k])) : null; }

  var ACC = {};
  // Form-Regler je Baustein (Editor): [{k, label, min, max, step, def}], vom Baustein über form gelesen
  var FORMS = {};
  // Umhang (Teil „cape“): Länge, Breite am Hals, Weite unten, Kragenhöhe, wie weit um den Hals,
  // wie stark er sich um die Seiten legt, wie bauschig er absteht
  FORMS.cape = [
    { k: 'len', label: 'Length', min: 0.3, max: 1.8, step: 0.01, def: 1 },
    { k: 'top', label: 'Width at the neck', min: 0.3, max: 2, step: 0.01, def: 1 },
    { k: 'flare', label: 'Width at the bottom', min: 0, max: 2.5, step: 0.01, def: 1 },
    { k: 'collar', label: 'Collar height', min: -0.25, max: 0.3, step: 0.01, def: 0 },
    { k: 'around', label: 'Around the neck', min: 0.5, max: 1.6, step: 0.01, def: 1.2 },
    { k: 'wrap', label: 'Wrap around the sides', min: 0, max: 2.5, step: 0.01, def: 1 },
    { k: 'billow', label: 'Billow', min: 0, max: 4, step: 0.05, def: 1 }
  ];
  function formOf(name, f) {
    var r = {}; f = f || {};
    (FORMS[name] || []).forEach(function (s) { var v = +f[s.k]; r[s.k] = isFinite(v) && f[s.k] != null ? Math.min(s.max, Math.max(s.min, v)) : s.def; });
    return r;
  }
  // Requisiten in der Flügelspitze bzw. vor dem Körper gehalten (build-Option noProps lässt sie weg)
  var HELD = { claws: 1, hammer: 1, trident: 1, scythe: 1, broom: 1, palette: 1, scepter: 1, wand: 1, katana: 1, shield: 1,
    beer: 1, halfmic: 1, club: 1, tray: 1, whip: 1, wheel: 1, bow: 1, dumbbell: 1, donut: 1, axe: 1, sword: 1, kiteshield: 1, gavel: 1 };
  var ACC_LABELS = {};   // Anzeigenamen der Bausteine (Editor), von rubber-duck-outfits.js gefüllt
  var KEYS = Object.keys(OUTFITS);
  // Outfits aus dem Duck-Editor (Server, /api/fx/ducks/custom.js): ersetzen ein Outfit aus dem
  // Code oder kommen neu dazu. ORIG hält das Code-Original für "zurücksetzen".
  var ORIG = {}, CUSTOM = {};
  function jclone(v) { return JSON.parse(JSON.stringify(v)); }
  function applyCustom(defs) {
    Object.keys(defs || {}).forEach(function (k) {
      var d = defs[k];
      if (!d || typeof d !== 'object') return;
      if (OUTFITS[k] && !CUSTOM[k] && !ORIG[k]) ORIG[k] = jclone(OUTFITS[k]);
      if (!ORIG[k] && !d.cat) d.cat = 'custom';
      CUSTOM[k] = true;
      OUTFITS[k] = d;
      if (KEYS.indexOf(k) < 0) KEYS.push(k);
    });
  }
  // gespeichertes Outfit verwerfen: Code-Original zurück bzw. eigenes Outfit weg
  function dropCustom(k) {
    if (!CUSTOM[k]) return;
    delete CUSTOM[k];
    if (ORIG[k]) { OUTFITS[k] = ORIG[k]; delete ORIG[k]; return; }
    delete OUTFITS[k];
    var i = KEYS.indexOf(k); if (i >= 0) KEYS.splice(i, 1);
  }
  function origin(k) { return !OUTFITS[k] ? null : !CUSTOM[k] ? 'code' : ORIG[k] ? 'changed' : 'new'; }
  function getDef(k) { return OUTFITS[k] ? jclone(OUTFITS[k]) : null; }
  function original(k) { return ORIG[k] ? jclone(ORIG[k]) : (OUTFITS[k] && !CUSTOM[k] ? jclone(OUTFITS[k]) : null); }
  // weitere Outfits anmelden (js/rubber-duck-outfits.js); die Namensliste bleibt dieselbe Liste
  function addOutfits(defs) {
    Object.keys(defs).forEach(function (k) { OUTFITS[k] = defs[k]; if (KEYS.indexOf(k) < 0) KEYS.push(k); });
  }
  // Outfit je Zuschauer (!outfit, Server: /api/fx/ducks/custom.js); Schlüssel = Login klein
  var VIEWERS = {};
  function setViewers(m) { VIEWERS = m && typeof m === 'object' ? m : {}; }
  function viewerOutfit(name) {
    var k = VIEWERS[String(name || '').replace(/^@/, '').trim().toLowerCase()];
    return k && OUTFITS[k] ? k : null;
  }
  function info(k) { var o = OUTFITS[k]; return o ? { key: k, label: o.label || k, cat: o.cat || 'classic', note: o.note || '' } : null; }
  // ── Aufgemalte Teile im Editor (Emblem, Kragen, Gürtel, Höschen, Streifen, Haaransatz, Gesichtsplatte) ──
  // kind: chest | collar | belt | briefs | stripes (i = 0/1) | hair | face. Alles in Modell-Koordinaten.
  function withShape(o, fn) { var sh = shapeFor(o), pc = CUR, pk = CUR_KEY; CUR = sh.parts; CUR_KEY = sh.key; try { return fn(); } finally { CUR = pc; CUR_KEY = pk; } }
  function rnd3(v) { return Math.round(v * 1000) / 1000; }
  function lineY(o, kind, i) {
    if (kind === 'collar') return o.collar || 0.55;
    if (kind === 'belt') return o.beltY != null ? +o.beltY : -0.3;
    if (kind === 'briefs') return o.briefsY != null ? +o.briefsY : -0.36;
    if (kind === 'stripes') return o.stripes && o.stripes[i || 0] != null ? +o.stripes[i || 0] : 0;
    return 0;
  }
  // Ankerpunkt (für den Anfasser im Editor)
  function paintAt(o, kind, i) {
    return withShape(o, function () {
      var H = PARTS[5];
      if (kind === 'chest') return emblemFrame(o).p.clone();
      if (kind === 'hair' || kind === 'face') {
        if (kind === 'face') { var x = H.c[0] + (o.faceX != null ? +o.faceX : 0.25), tx = (x - H.c[0]) / H.r[0]; return new THREE.Vector3(x, H.c[1] + H.r[1] * Math.sqrt(Math.max(0.02, 1 - tx * tx)), 0); }
        var y = H.c[1] + (o.hairY != null ? +o.hairY : 0.36), ty = (y - H.c[1]) / H.r[1];
        return new THREE.Vector3(H.c[0] + H.r[0] * Math.sqrt(Math.max(0.02, 1 - ty * ty)), y, 0);
      }
      var yl = lineY(o, kind, i) - (kind === 'collar' ? +o.collarDip || 0 : 0);
      return surfaceAt(yl, 0, 0.1).p.clone();
    });
  }
  // Wert aus einem (gezogenen) Punkt setzen; ändert o
  function paintSet(o, kind, p, i) {
    var H = PARTS[5];
    if (kind === 'chest') {
      var d = p.clone().sub(CENTER); d.x = Math.max(0.08, d.x);
      o.chestY = rnd3(Math.max(-3, Math.min(3, d.y / d.x))); o.chestZ = rnd3(Math.max(-3, Math.min(3, d.z / d.x)));
      if (!o.chestZ) delete o.chestZ;
    } else if (kind === 'face') o.faceX = rnd3(Math.max(-0.6, Math.min(0.6, p.x - H.c[0])));
    else if (kind === 'hair') o.hairY = rnd3(Math.max(-0.5, Math.min(0.6, p.y - H.c[1])));
    else {
      var y = rnd3(Math.max(-0.55, Math.min(1.6, p.y + (kind === 'collar' ? +o.collarDip || 0 : 0))));
      if (kind === 'collar') o.collar = y; else if (kind === 'belt') o.beltY = y; else if (kind === 'briefs') o.briefsY = y;
      else if (kind === 'stripes') { o.stripes = (o.stripes || [0]).slice(); o.stripes[i || 0] = y; }
    }
  }
  // was liegt an diesem Punkt der Körperoberfläche? → { kind, i } oder null
  function paintZone(o, p) {
    return withShape(o, function () {
      var H = PARTS[5], hp = new THREE.Vector3((p.x - H.c[0]) / H.r[0], (p.y - H.c[1]) / H.r[1], (p.z - H.c[2]) / H.r[2]).length(), near = 0.05;
      if (o.chest) {
        var ef = emblemFrame(o), d = p.clone().sub(ef.p), u = d.dot(ef.u) / ef.size + 0.5, v = d.dot(ef.v) / ef.size + 0.5;
        if (d.dot(ef.n) > -0.35 && u > 0 && u < 1 && v > 0 && v < 1) return { kind: 'chest' };
      }
      if (hp < 1.12) {
        if (o.face != null && Math.abs(p.x - H.c[0] - (o.faceX != null ? +o.faceX : 0.25)) < near && p.y > H.c[1] - 0.16) return { kind: 'face' };
        if (o.hair != null && Math.abs(p.y - H.c[1] - (o.hairY != null ? +o.hairY : 0.36)) < near * 1.5) return { kind: 'hair' };
        if (hp < 0.9) return null;          // tief im Kopf: kein Kragen (der Anzug endet am Kopf)
      }
      if (o.suit) {
        var cz = Math.min(1, Math.abs(p.z) / 0.4), fr = Math.max(0, Math.min(1, (p.x - 0.2) / 0.6)); fr = fr * fr * (3 - 2 * fr);
        var cut = Math.min(1, Math.max(0, +o.collarV || 0)), cl = (o.collar || 0.55) - (+o.collarDip || 0) * fr * ((1 - cz * cz) * (1 - cut) + (1 - cz) * cut);
        if (Math.abs(p.y - cl) < near) return { kind: 'collar' };
        if (o.belt && Math.abs(p.y - lineY(o, 'belt')) < Math.max(near, (o.beltW != null ? +o.beltW : 0.04) + 0.01)) return { kind: 'belt' };
        for (var k = 0; o.stripes && k < Math.min(2, o.stripes.length); k++) if (Math.abs(p.y - o.stripes[k]) < Math.max(near, (o.stripeW != null ? +o.stripeW : 0.045) + 0.01)) return { kind: 'stripes', i: k };
      }
      if (o.briefs && Math.abs(p.y - lineY(o, 'briefs')) < near) return { kind: 'briefs' };
      return null;
    });
  }
  // Werte der Bemalung ohne Neubau nachziehen; false = Neubau nötig (anderes Emblem, keine Bemalung)
  function updatePaint(duck, o, color) {
    var b = duck && duck.userData.body, P = b && b.material && b.material.userData.paint;
    if (!P || (P.chest || null) !== (o.chest || null)) return false;
    var nu = withShape(o, function () { return paintUniforms(o.skin != null ? o.skin : (color != null ? color : P.base), o, o.chest ? P.u.uEmb : null); });
    Object.keys(nu).forEach(function (k) { P.u[k] = nu[k]; if (P.sh && P.sh.uniforms[k]) P.sh.uniforms[k].value = nu[k]; });
    return true;
  }

  root.RubberDuck = {
    build: build, flutter: flutter, clone: cloneDuck, sdDuck: sdDuck, OUTFITS: KEYS, info: info, setViewers: setViewers, viewerOutfit: viewerOutfit,
    paintAt: paintAt, paintSet: paintSet, paintZone: paintZone, updatePaint: updatePaint,
    addOutfits: addOutfits, ACC: ACC, ACC_LABELS: ACC_LABELS, HELD: HELD, EMBLEMS: EMBLEMS, PATTERNS: Object.keys(PATTERNS),
    applyCustom: applyCustom, dropCustom: dropCustom, origin: origin, def: getDef, original: original, applyXf: applyXf,
    applyPart: applyPart, readPiece: readPiece, pieceKey: pieceKey, applyParts: applyParts, setPartXf: setPartXf, partXf: partXf,
    FORMS: FORMS, formOf: formOf, latRest: latRest, geoBox: geoBox,
    primOf: primOf, primSpec: primSpec, primParams: primParams, makePrim: makePrim, hugAt: hugAt,
    hugKey: function () { return CUR_KEY; },
    util: { vinyl: vinyl, ell: ell, canvasTex: canvasTex, textTex: textTex, surface: surface, surfaceAt: surfaceAt, sdTrunk: sdTrunk, PARTS: PARTS }
  };
})(typeof window !== 'undefined' ? window : this);
