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
    // Rumpf 10 % breiter (z) – wirkt flacher, wie eine echte Badeente
    { c: [0.0, 0.0, 0], r: [1.0, 0.66, 0.86], k: 0 },        // Bauch
    { c: [0.42, 0.08, 0], r: [0.62, 0.6, 0.7], k: 0.25 },    // Brust
    { c: [-0.88, 0.32, 0], r: [0.36, 0.4, 0.44], k: 0.3 },   // Schwanz (hinten hoch)
    { c: [-1.12, 0.62, 0], r: [0.16, 0.2, 0.22], k: 0.22 },  // Schwanzspitze
    { c: [0.48, 0.55, 0], r: [0.42, 0.42, 0.46], k: 0.22 },  // Hals
    { c: [0.5, 1.05, 0], r: [0.62, 0.6, 0.6], k: 0.2 }       // Kopf
  ];
  var FLOOR = -0.55;
  // nur Rumpf (Bauch, Brust, Schwanz) – für Teile, die nicht über den Kopf dürfen
  function sdTrunk(p) {
    var d = sdEll(p, PARTS[0].c, PARTS[0].r);
    for (var i = 1; i < 4; i++) d = smin(d, sdEll(p, PARTS[i].c, PARTS[i].r), PARTS[i].k);
    return d;
  }
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
  // Schnabel wie ein echter offener Entenschnabel: zwei gewölbte Schalen (Ober-
  // und Unterschnabel), die nur hinten im Mundwinkel zusammenhängen, vorn leicht
  // geöffnet (Keil mit Winkel 2·open um das Scharnier). Jede Schale hat eine
  // gerundete Lippe (Wandstärke), dazwischen eine zusammenhängende Mundhöhle von der
  // oberen Lippe über den Rachen (am Kopf etwas breiter) zur unteren. EINE Geometrie.
  function billGeometry(len, wid, thick, open) {
    var Hx = -0.85 * len, LIP = 0.018, COLS = 48, ROWS = 16, S = 10;
    var lip = new THREE.Color(0xf2650f).convertSRGBToLinear();
    var mouthHi = new THREE.Color(0x6a1c06).convertSRGBToLinear(), mouthLo = new THREE.Color(0x1e0601).convertSRGBToLinear();
    var pos = [], col = [], idx = [];
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
    strip(rimU, inU, lip, lip, false);
    strip(rimL, inL, lip, lip, true);
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
      idx.push(p00, p01, p10, p10, p01, p11);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
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
  var PATTERNS = { hstripes: 1, dots: 2, web: 3, fur: 4, bandage: 5, ribs: 6, tiedye: 7, camo: 8, suspenders: 9 };
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
    '  return vec4(cur, 0.0);',
    '}'
  ].join('\n');
  // Vinyl-Material mit Uniform-Zonen. Reihenfolge: Anzug → Muster (Anzug/Haut) → Streifen,
  // Gürtel, Höschen → Maske (cowl) → Haar → Muster (alles) → Augenbinde → Gesicht → Emblem
  function suitMaterial(base, o) {
    var m = vinyl(base, Object.assign({ emissive: o.skin != null ? 0x080604 : 0x2a1400 }, o.mat || {}));
    if (o.ghost) { m.transparent = true; m.opacity = 0.8; m.depthWrite = true; }
    if (!(o.suit || o.cowl || o.pattern || o.mask || o.face || o.hair || o.chest || o.briefs)) return m;
    // Brust-Emblem: von vorn (+x) auf die Körperoberfläche projiziert, liegt also drauf
    var emb = o.chest ? emblemTex(o.chest) : null, embAt = o.chest ? surface(new THREE.Vector3(1, o.chestY != null ? o.chestY : -0.18, 0)) : null;
    var embSize = o.chestSize || (o.chest === 'star' ? 0.24 : 0.46);
    var HC = PARTS[5].c, HR = PARTS[5].r, pt = o.pattern || {};
    var zone = { suit: 0, all: 1, skin: 2 }[pt.zone || (o.suit ? 'suit' : 'all')];
    m.onBeforeCompile = function (sh) {
      var u = {
        uSuit: col(o.suit || base), uStripe: col(o.stripe || o.suit || base), uStripe2: col(o.stripe2 || o.stripe || o.suit || base),
        uBelt: col(o.belt || o.suit || base), uBriefs: col(o.briefs || o.suit || base), uCowl: col(o.cowl || base),
        uS: new THREE.Vector4(o.stripes ? o.stripes[0] : -9, o.stripes && o.stripes[1] != null ? o.stripes[1] : -9, o.belt ? (o.beltY != null ? o.beltY : -0.3) : -9, o.briefs ? 1 : 0),
        uSuitOn: o.suit ? 1 : 0, uBriefsY: o.briefsY != null ? o.briefsY : -0.36,
        uCowlOn: o.cowl ? 1 : 0, uHC: new THREE.Vector3(HC[0], HC[1], HC[2]), uHR: new THREE.Vector3(HR[0], HR[1], HR[2]),
        uEmb: emb || new THREE.Texture(), uEmbOn: emb ? 1 : 0,
        uEmbAt: new THREE.Vector3(embAt ? embAt.p.x : 0, embAt ? embAt.p.y : 0, 0), uEmbSize: embSize,
        uCollar: o.collar || 0.55,
        uPat: PATTERNS[pt.type] || 0, uPatC1: col(pt.c1 != null ? pt.c1 : base), uPatC2: col(pt.c2 != null ? pt.c2 : 0x000000),
        uPatS: pt.scale || 6, uPatZone: zone, uPatY: new THREE.Vector2(pt.y ? pt.y[0] : -9, pt.y ? pt.y[1] : 9),
        uMask: col(o.mask || 0), uMaskOn: o.mask != null ? 1 : 0,
        uFace: col(o.face || 0), uFaceOn: o.face != null ? 1 : 0, uFaceX: o.faceX != null ? o.faceX : 0.25,
        uHair: col(o.hair || 0), uHairOn: o.hair != null ? 1 : 0, uHairY: HC[1] + (o.hairY != null ? o.hairY : 0.36), uPeak: o.hairPeak || 0
      };
      Object.keys(u).forEach(function (k) { sh.uniforms[k] = { value: u[k] }; });
      sh.vertexShader = 'varying vec3 vDuck;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vDuck = position;');
      sh.fragmentShader = 'varying vec3 vDuck; uniform vec3 uSuit, uStripe, uStripe2, uBelt, uBriefs, uCowl, uHC, uHR, uEmbAt, uPatC1, uPatC2, uMask, uFace, uHair; uniform vec4 uS; uniform vec2 uPatY;' +
        ' uniform float uCowlOn, uEmbOn, uEmbSize, uCollar, uSuitOn, uBriefsY, uPat, uPatS, uPatZone, uMaskOn, uFaceOn, uFaceX, uHairOn, uHairY, uPeak; uniform sampler2D uEmb;\n' + PAT_GLSL + '\n' +
        sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec3 cc = diffuse;\n' +
          'float inHead = length((vDuck - uHC) / uHR);\n' +
          'float headM = 1.0 - step(1.12, inHead);\n' +
          // Kragenlinie: unterhalb uCollar und nicht im Kopf → Anzug
          'float suitOn = uSuitOn * (1.0 - step(uCollar, vDuck.y)) * step(0.97, inHead);\n' +
          'cc = mix(cc, uSuit, suitOn);\n' +
          'float inY = step(uPatY.x, vDuck.y) * step(vDuck.y, uPatY.y);\n' +
          'if (uPatZone < 0.5 || uPatZone > 1.5) { float pz = uPatZone < 0.5 ? suitOn : 1.0 - suitOn; vec4 pt = duckPat(vDuck, uPat, uPatC1, uPatC2, uPatS, cc); cc = mix(cc, pt.rgb, pt.a * pz * inY); }\n' +
          'float aa = 0.012;\n' +
          'cc = mix(cc, uStripe, suitOn * (1.0 - smoothstep(0.045 - aa, 0.045 + aa, abs(vDuck.y - uS.x))));\n' +
          'cc = mix(cc, uStripe2, suitOn * (1.0 - smoothstep(0.045 - aa, 0.045 + aa, abs(vDuck.y - uS.y))));\n' +
          'cc = mix(cc, uBelt, suitOn * (1.0 - smoothstep(0.04 - aa, 0.04 + aa, abs(vDuck.y - uS.z))));\n' +
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
          // Emblem vorn auf der Brust (nur Vorderseite, Projektion entlang x)
          'vec2 euv = vec2(-vDuck.z / uEmbSize + 0.5, (vDuck.y - uEmbAt.y) / uEmbSize + 0.5);\n' +
          'if (uEmbOn > 0.5 && vDuck.x > uEmbAt.x - 0.35 && euv.x > 0.0 && euv.x < 1.0 && euv.y > 0.0 && euv.y < 1.0) {\n' +
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

  function build(opts) {
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
    // Schnabel: ein Teil, leicht geöffnet
    // wie das Vorbild: kräftiger, runder Schnabel, nur leicht geöffnet
    var bill = new THREE.Mesh(billGeometry(0.44, 0.33, 0.15, 0.09), beak);
    bill.position.set(1.1, 0.92, 0); bill.rotation.z = -0.1; if (!o.noBill) g.add(bill);
    // Flügel, leicht angelegt (bei Uniform in Uniformfarbe, mit Streifen am Ärmel)
    // noWings: wer eigene Arme animiert (Messer-Ente), lässt die angelegten Flügel weg
    if (!opts.noWings) [-1, 1].forEach(function (s) {
      var w = new THREE.Mesh(ell(0.5, 0.3, 0.12, 32), wingMat);
      w.position.set(-0.05, 0.12, s * 0.79); w.rotation.set(s * 0.15, s * 0.12, 0.35);
      g.add(w);
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
    [-1, 1].forEach(function (s) {
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
    });

    // Helm (THW gelb, Feuerwehr silber mit Nackenschutz) mit Schild vorn
    // Helm wie ein Schutzhelm oben auf dem Kopf: Rand auf Stirnhöhe über den Augen
    // (Augen bei ~HC.y+0.23), Kuppel etwas flacher als der Kopf
    if (o.helmet) {
      var hm = o.helmet.metal ? vinyl(o.helmet.color, { metalness: 0.7, roughness: 0.3, envMapIntensity: 1.0 }) : vinyl(o.helmet.color, { roughness: 0.35, clearcoat: 0.8 });
      // Rand liegt direkt auf dem Kopf auf (Kopfradius auf dieser Höhe + Wandstärke)
      var RIM_Y = HC.y + 0.29, tilt = 0.1;
      var rimR = HR[0] * Math.sqrt(Math.max(0.2, 1 - Math.pow((RIM_Y - HC.y) / HR[1], 2))) + 0.025;
      var helmet = new THREE.Group(); helmet.position.set(HC.x - 0.03, RIM_Y, 0); helmet.rotation.z = tilt; g.add(helmet);
      var dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5), hm);
      dome.scale.set(rimR, 0.37, rimR * HR[2] / HR[0]); helmet.add(dome);
      var brim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 10, 64), hm);
      brim.scale.set(rimR + 0.02, (rimR + 0.02) * HR[2] / HR[0], 1); brim.rotation.x = Math.PI / 2; helmet.add(brim);
      // Kamm oben (typisch für Schutzhelme)
      var ridge = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12), hm);
      ridge.scale.set(rimR * 0.95, 0.39, 0.06); helmet.add(ridge);
      if (o.helmet.neck) {
        // Nackenschutz hinten (phi 0 liegt bei −x)
        var neckG = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.5, Math.PI * 0.2), hm);
        neckG.material.side = THREE.DoubleSide;
        neckG.scale.set(rimR + 0.04, 0.45, (rimR + 0.04) * HR[2] / HR[0]); helmet.add(neckG);
      }
      if (o.helmetLabel) {
        var lab = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.12), new THREE.MeshStandardMaterial({ map: textTex(o.helmetLabel, '#1d2b5e', '#ffffff'), transparent: true, roughness: 0.4 }));
        var la = 0.55, lp = new THREE.Vector3(Math.cos(la) * rimR * 1.01, Math.sin(la) * 0.37 * 1.01, 0);
        lab.position.copy(lp); lab.lookAt(lp.clone().add(new THREE.Vector3(Math.cos(la) / rimR, Math.sin(la) / 0.37, 0).normalize()));
        helmet.add(lab);
      }
    }
    // Polizeimütze: Band, oben breiter Deckel, schwarzer Schirm, Stern
    if (o.cap) {
      var capM = vinyl(o.suit), black = vinyl(0x111318, { roughness: 0.2, clearcoat: 1 });
      var band2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.18, 48), black);
      band2.position.copy(HC).add(new THREE.Vector3(-0.02, 0.4, 0)); band2.rotation.z = 0.12; g.add(band2);
      var top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 0.2, 48), capM);
      top.position.copy(HC).add(new THREE.Vector3(-0.04, 0.58, 0)); top.rotation.z = 0.12; g.add(top);
      var visor = new THREE.Mesh(ell(0.3, 0.04, 0.42, 32), black);
      visor.position.copy(HC).add(new THREE.Vector3(0.48, 0.32, 0)); visor.rotation.z = -0.25; g.add(visor);
      var badge = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: emblemTex('star'), transparent: true, metalness: 0.5, roughness: 0.35 }));
      var bp = HC.clone().add(new THREE.Vector3(0.5, 0.47, 0)); badge.position.copy(bp); badge.lookAt(bp.clone().add(new THREE.Vector3(1, 0.2, 0)));
      g.add(badge);
    }
    // Fledermaus-Ohren auf der Maske
    if (o.ears) {
      var cowlM = vinyl(o.cowl, { roughness: 0.4 });
      [-1, 1].forEach(function (s) {
        var ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.38, 24), cowlM);
        ear.position.copy(headPoint(new THREE.Vector3(0.05, 0.85, s * 0.5), 0.92)).add(new THREE.Vector3(0, 0.12, 0));
        ear.rotation.set(s * 0.25, 0, 0.1); g.add(ear);
      });
    }
    // Umhang: oben ein Kragen um den Nacken (dort, wo hinten die Maske endet), von dort
    // über den Rücken bis etwa zur Schwanzwurzel; wölbt sich zu den Seiten herab
    if (o.cape) {
      var U = 28, V = 24, cpos = [], cidx = [], COLLAR_Y = 0.74;
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
        var sp = surfaceAt(COLLAR_Y, Math.PI + (uu0 / U * 2 - 1) * 1.2, 0.42);
        collar.push(sp.p.clone().addScaledVector(sp.n, 0.012));
      }
      var lastTop = 0.5;
      for (var vv = 0; vv <= V; vv++) {
        var tv = vv / V;
        var xc = -0.2 - tv * 0.62;              // endet vor der Schwanzspitze
        var tp = topAt(xc); if (tp !== null) lastTop = tp;
        var half = 0.38 + 0.5 * tv, toCollar = 1 - Math.min(1, tv / 0.3);
        toCollar = toCollar * toCollar * (3 - 2 * toCollar);
        for (var uu = 0; uu <= U; uu++) {
          var z = (uu / U * 2 - 1) * half;
          var q = new THREE.Vector3(xc, lastTop + 0.025 - 0.9 * z * z - Math.max(0, tv - 0.8) * 0.4, z);
          q.lerp(collar[uu], toCollar);
          // nie in den Rumpf schneiden: so weit anheben, bis Abstand da ist
          for (var k = 0; k < 60 && sdTrunk(q) < 0.02; k++) q.y += 0.01;
          // in der Mitte nach unten hin leicht vom Rücken weg bauschen (liegt nicht an)
          var mid = 1 - Math.pow(uu / U * 2 - 1, 2);
          var tb = Math.max(0, (tv - 0.35) / 0.65);  // am Nacken anliegend, erst weiter hinten bauschig
          q.y += 0.07 * tb * mid; q.x -= 0.05 * tb * mid;
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
      capeMesh.userData.cape = { base: Float32Array.from(cpos), nrm: nrmArr, U: U, V: V };
      g.add(capeMesh);
    }
    // Zubehör (Hüte, Haare, Brillen, Requisiten): ACC[name](ctx, opts), siehe js/rubber-duck-outfits.js
    if (o.acc) {
      var ctx = { g: g, o: o, HC: HC, HR: HR, headPoint: headPoint, decal: decal, paint: paint, white: white, skin: skin, body: yellow, wingMat: wingMat };
      o.acc.forEach(function (a) {
        var fn = ACC[a[0]];
        if (fn) fn(ctx, a[1] || {});
      });
    }
    g.userData = { body: b, head: HC, headR: HR, decal: decal, wingMat: wingMat };
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

  var ACC = {};
  var KEYS = Object.keys(OUTFITS);
  // weitere Outfits anmelden (js/rubber-duck-outfits.js); die Namensliste bleibt dieselbe Liste
  function addOutfits(defs) {
    Object.keys(defs).forEach(function (k) { OUTFITS[k] = defs[k]; if (KEYS.indexOf(k) < 0) KEYS.push(k); });
  }
  function info(k) { var o = OUTFITS[k]; return o ? { key: k, label: o.label || k, cat: o.cat || 'classic', note: o.note || '' } : null; }
  root.RubberDuck = {
    build: build, flutter: flutter, clone: cloneDuck, sdDuck: sdDuck, OUTFITS: KEYS, info: info,
    addOutfits: addOutfits, ACC: ACC, EMBLEMS: EMBLEMS,
    util: { vinyl: vinyl, ell: ell, canvasTex: canvasTex, textTex: textTex, surface: surface, surfaceAt: surfaceAt, sdTrunk: sdTrunk, PARTS: PARTS }
  };
})(typeof window !== 'undefined' ? window : this);
