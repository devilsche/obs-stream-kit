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
  // gerundete Lippe (Wandstärke), dazwischen eine zusammenhängende Mundhöhle: vom
  // Gaumen hinter der oberen Lippe nach hinten zum Mundwinkel und wieder vor zur
  // unteren Lippe, zur Tiefe hin dunkler. Alles EINE Geometrie.
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
      var t = new THREE.Vector3(Hx + (Math.max(a.x, Hx) - Hx) * 0.22, (a.y + b.y) / 2, zt);
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
    none: {},
    thw: { suit: 0x1d2b5e, stripe: 0xf2c500, stripes: [0.18, -0.12], helmet: { color: 0xf2c500 }, helmetLabel: 'THW' },
    police: { suit: 0x1e3c72, stripe: 0xd8dde6, stripes: [-0.05], cap: true, chest: 'star' },
    fire: { suit: 0x1a2340, stripe: 0xf2d000, stripe2: 0xc9ced6, stripes: [0.2, -0.1], helmet: { color: 0xd9dde2, metal: true, neck: true } },
    batman: { suit: 0x4a4e57, collar: 0.8, belt: 0xe2b62a, beltY: -0.3, cowl: 0x1a1b20, cape: 0x1a1b20, ears: true, chest: 'bat', eyes: 'white' },
    superman: { suit: 0x1f4fb5, belt: 0xf2c500, beltY: -0.3, briefs: 0xc8151b, cape: 0xc8151b, chest: 'super' }
  };
  function col(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
  // Vinyl-Material mit Uniform-Zonen
  function suitMaterial(base, o) {
    var m = vinyl(base, { emissive: 0x2a1400 });
    if (!o.suit) return m;
    // Brust-Emblem: von vorn (+x) auf die Körperoberfläche projiziert, liegt also drauf
    var emb = o.chest ? emblemTex(o.chest) : null, embAt = o.chest ? surface(new THREE.Vector3(1, -0.18, 0)) : null;
    var embSize = o.chest === 'star' ? 0.24 : 0.46;
    var HC = PARTS[5].c, HR = PARTS[5].r;
    m.onBeforeCompile = function (sh) {
      var u = {
        uSuit: col(o.suit), uStripe: col(o.stripe || o.suit), uStripe2: col(o.stripe2 || o.stripe || o.suit),
        uBelt: col(o.belt || o.suit), uBriefs: col(o.briefs || o.suit), uCowl: col(o.cowl || base),
        uS: new THREE.Vector4(o.stripes ? o.stripes[0] : -9, o.stripes && o.stripes[1] != null ? o.stripes[1] : -9, o.belt ? o.beltY : -9, o.briefs ? 1 : 0),
        uCowlOn: o.cowl ? 1 : 0, uHC: new THREE.Vector3(HC[0], HC[1], HC[2]), uHR: new THREE.Vector3(HR[0], HR[1], HR[2]),
        uEmb: emb || new THREE.Texture(), uEmbOn: emb ? 1 : 0,
        uEmbAt: new THREE.Vector3(embAt ? embAt.p.x : 0, embAt ? embAt.p.y : 0, 0), uEmbSize: embSize,
        uCollar: o.collar || 0.55
      };
      Object.keys(u).forEach(function (k) { sh.uniforms[k] = { value: u[k] }; });
      sh.vertexShader = 'varying vec3 vDuck;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vDuck = position;');
      sh.fragmentShader = 'varying vec3 vDuck; uniform vec3 uSuit, uStripe, uStripe2, uBelt, uBriefs, uCowl, uHC, uHR, uEmbAt; uniform vec4 uS; uniform float uCowlOn, uEmbOn, uEmbSize, uCollar; uniform sampler2D uEmb;\n' +
        sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec3 cc = diffuse;\n' +
          'float inHead = length((vDuck - uHC) / uHR);\n' +
          // Kragenlinie: unterhalb y≈0.55 und nicht im Kopf → Uniform
          'float suitOn = (1.0 - step(uCollar, vDuck.y)) * step(0.97, inHead);\n' +
          'cc = mix(cc, uSuit, suitOn);\n' +
          'float aa = 0.012;\n' +
          'cc = mix(cc, uStripe, suitOn * (1.0 - smoothstep(0.045 - aa, 0.045 + aa, abs(vDuck.y - uS.x))));\n' +
          'cc = mix(cc, uStripe2, suitOn * (1.0 - smoothstep(0.045 - aa, 0.045 + aa, abs(vDuck.y - uS.y))));\n' +
          'cc = mix(cc, uBelt, suitOn * (1.0 - smoothstep(0.04 - aa, 0.04 + aa, abs(vDuck.y - uS.z))));\n' +
          'cc = mix(cc, uBriefs, suitOn * uS.w * (1.0 - smoothstep(-0.36 - aa, -0.36 + aa, vDuck.y)));\n' +
          // Maske: Kopf oberhalb der Schnabellinie und hinten
          'float cowl = uCowlOn * (1.0 - step(1.12, inHead)) * max(step(uHC.y - 0.06, vDuck.y), step(vDuck.x, uHC.x - 0.12));\n' +
          'cc = mix(cc, uCowl, cowl);\n' +
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
  function surfaceAt(y, phi) {
    var dir = new THREE.Vector3(-Math.cos(phi), 0, Math.sin(phi)).multiplyScalar(-1);
    var o0 = new THREE.Vector3(0.1, y, 0), q = new THREE.Vector3(), lo = 0, hi = 2.0;
    if (sdDuck(o0) > 0) return { p: o0.clone(), n: dir.clone() };
    for (var it = 0; it < 28; it++) { var mid = (lo + hi) / 2; q.copy(o0).addScaledVector(dir, mid); if (sdDuck(q) < 0) lo = mid; else hi = mid; }
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
  function emblemTex(kind) {
    return canvasTex(256, 256, function (x, w) {
      var c = w / 2;
      if (kind === 'bat') {
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
    var yellow = suitMaterial(opts.color != null ? opts.color : 0xf6bd16, o);
    var wingMat = o.suit ? vinyl(o.suit) : yellow;
    var beak = vinyl(0xffffff, { emissive: 0x200800, vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 0.12, clearcoat: 0.15, roughness: 0.6 });
    var paint = new THREE.MeshBasicMaterial({ color: 0x0b0b0b }); paint.color.convertSRGBToLinear();
    var white = new THREE.MeshBasicMaterial({ color: 0xffffff });

    var b = new THREE.Mesh(body(), yellow); g.add(b);
    // Schnabel: ein Teil, leicht geöffnet
    // wie das Vorbild: kräftiger, runder Schnabel, nur leicht geöffnet
    var bill = new THREE.Mesh(billGeometry(0.44, 0.33, 0.15, 0.09), beak);
    bill.position.set(1.1, 0.92, 0); bill.rotation.z = -0.1; g.add(bill);
    // Flügel, leicht angelegt (bei Uniform in Uniformfarbe, mit Streifen am Ärmel)
    [-1, 1].forEach(function (s) {
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
    [-1, 1].forEach(function (s) {
      if (o.eyes === 'white') {
        // Maske: weiße, schmale Augenschlitze
        var sl = decal(ell(0.1, 0.05, 0.012, 20), white, new THREE.Vector3(0.8, 0.36, s * 0.5));
        sl.rotateZ(s * -0.35);
      } else {
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
        var sp = surfaceAt(COLLAR_Y, Math.PI + (uu0 / U * 2 - 1) * 1.2);
        collar.push(sp.p.clone().addScaledVector(sp.n, 0.035));
      }
      var lastTop = 0.5;
      for (var vv = 0; vv <= V; vv++) {
        var tv = vv / V;
        var xc = -0.2 - tv * 0.85;
        var tp = topAt(xc); if (tp !== null) lastTop = tp;
        var half = 0.38 + 0.5 * tv, toCollar = 1 - Math.min(1, tv / 0.3);
        toCollar = toCollar * toCollar * (3 - 2 * toCollar);
        for (var uu = 0; uu <= U; uu++) {
          var z = (uu / U * 2 - 1) * half;
          var q = new THREE.Vector3(xc, lastTop + 0.06 - 0.9 * z * z - Math.max(0, tv - 0.8) * 0.4, z);
          q.lerp(collar[uu], toCollar);
          // nie in den Rumpf schneiden: so weit anheben, bis Abstand da ist
          for (var k = 0; k < 40 && sdTrunk(q) < 0.045; k++) q.y += 0.02;
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
      // Ruheform merken: zum Flattern wird um sie herum ausgelenkt
      capeMesh.userData.cape = { base: Float32Array.from(cpos), nrm: Float32Array.from(cg.attributes.normal.array), U: U, V: V };
      g.add(capeMesh);
    }
    g.userData = { body: b, head: HC, headR: HR, decal: decal };
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
          var off = free * (wave + 0.05);
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

  root.RubberDuck = { build: build, flutter: flutter, clone: cloneDuck, sdDuck: sdDuck, OUTFITS: Object.keys(OUTFITS) };
})(typeof window !== 'undefined' ? window : this);
