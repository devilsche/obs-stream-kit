/* Strecken-Themen für die Car-Race-Kulisse (three r128), genutzt von js/car-track-scene.js – also im Chat-Rennen-
 * Overlay (js/car-race.js) und in Car Drive (js/car-drive.js). Konzept: docs/superpowers/specs/2026-11-20-track-themes-design.md
 *
 *   CarTrackThemes.forTrack(T) → Thema der Strecke (nach Layout-Name):
 *     Speedway = Stadion · Twister = Wald · Hairpin = Alpen · Coast = Küste · Kart = Industrie
 *   Thema: { id, sky: { top, horizon }, fog: { near, far }, sun: { color, k, pos }, hemi: { sky, ground, k }, fill,
 *            exposure, groundTex: { base, spread, stripes }, rail (false = keine Leitplanke, Reifenstapel statt dessen),
 *            height(ctx) → H(x, z) (nur Optik), groundColor(ctx) → f(x, z, h, d) Bodenfarbe je Ecke,
 *            decorate(ctx) – Deko über ctx.kind()/ctx.bg()/ctx.place() (siehe js/car-track-scene.js) }
 *   CarTrackThemes.Kit – Low-Poly-Baukasten: Teile mit Farbe je Ecke zu EINER Geometrie zusammenfassen
 *     (Material mit vertexColors, flatShading → Spielzeug-Look; je Deko-Art ein InstancedMesh = ein Zeichenaufruf).
 *
 * Alles deterministisch aus dem Strecken-Seed (CarRaceSim.rng): jede Overlay-Instanz sieht dieselbe Kulisse.
 * Höhe ist nur Optik – Sim und Fahrphysik bleiben 2D.
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  var TAU = Math.PI * 2;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // weicher Übergang e0 → e1 (auch rückwärts: e0 > e1)
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  var linCache = {};
  // Farbe (sRGB-Hex/Text) → linear, wie three sie für Ecken-/Instanzfarben erwartet
  function lin(c) {
    if (c && c.isColor) return c;
    var k = String(c);
    return linCache[k] || (linCache[k] = new THREE.Color(c).convertSRGBToLinear());
  }
  function mix(a, b, t) { return lin(a).clone().lerp(lin(b), clamp(t, 0, 1)); }
  // Hash für feste Zufallswerte je Ort (gleiche Ecke → gleiche Verschiebung, Flächen reißen nicht auf)
  function hash3(x, y, z) { var s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
  // Wertrauschen 2D (glatt), für Bodenflecken
  function vnoise(x, z) {
    var xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    var a = hash3(xi, 0, zi), b = hash3(xi + 1, 0, zi), c = hash3(xi, 0, zi + 1), d = hash3(xi + 1, 0, zi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, z) { return vnoise(x, z) * 0.6 + vnoise(x * 2.1 + 17, z * 2.1 + 9) * 0.3 + vnoise(x * 4.3 + 3, z * 4.3 + 41) * 0.1; }
  // Summe weniger Sinuswellen (Richtung, Wellenlänge, Phase aus rnd) – glatte Hügel ohne Rauschtexturen
  function waveSet(rnd, n, amp, lmin, lmax) {
    var W = [];
    for (var i = 0; i < n; i++) {
      var a = rnd() * TAU, k = TAU / lerp(lmin, lmax, rnd());
      W.push([Math.cos(a) * k, Math.sin(a) * k, rnd() * TAU, amp / n * 1.5]);
    }
    return function (x, z) { var h = 0; for (var i = 0; i < W.length; i++) h += W[i][3] * Math.sin(W[i][0] * x + W[i][1] * z + W[i][2]); return h; };
  }

  // ---- Low-Poly-Baukasten ----
  function Kit() { this.pos = []; this.col = []; }
  // geo wird übernommen (danach freigegeben); color: Farbe oder f(x, y, z) → Farbe (Koordinaten nach o-Transformation);
  // o: { x, y, z, rx, ry, rz, s | sx, sy, sz, jit (Verbeulen in m, je Ecke fest) }
  Kit.prototype.add = function (geo, color, o) {
    o = o || {};
    var g = geo.index ? geo.toNonIndexed() : geo, s = o.s || 1;
    var m = new THREE.Matrix4().compose(new THREE.Vector3(o.x || 0, o.y || 0, o.z || 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ')),
      new THREE.Vector3(o.sx || s, o.sy || s, o.sz || s));
    var p = g.attributes.position, v = new THREE.Vector3(), fixed = typeof color === 'function' ? null : lin(color);
    for (var i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (o.jit) {
        var hx = Math.round(v.x * 1000), hy = Math.round(v.y * 1000), hz = Math.round(v.z * 1000);
        v.x += (hash3(hx, hy, hz) - 0.5) * o.jit; v.y += (hash3(hy, hz, hx) - 0.5) * o.jit; v.z += (hash3(hz, hx, hy) - 0.5) * o.jit;
      }
      v.applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      var c = fixed || lin(color(v.x, v.y, v.z));
      this.col.push(c.r, c.g, c.b);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  };
  Kit.prototype.geo = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  };
  Kit.prototype.empty = function () { return !this.pos.length; };
  function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
  function cyl(rt, rb, h, seg) { return new THREE.CylinderGeometry(rt, rb, h, seg || 6, 1); }
  function cone(r, h, seg) { return new THREE.ConeGeometry(r, h, seg || 7, 1); }
  function ico(r) { return new THREE.IcosahedronGeometry(r, 0); }
  // Prisma (Satteldach): Länge entlang x, Giebel nach oben
  function prism(len, w, h) { var g = new THREE.CylinderGeometry(1, 1, len, 3, 1); g.rotateZ(Math.PI / 2); g.rotateX(Math.PI / 2); g.scale(1, h / 1.5, w / 1.732); g.translate(0, -h / 6, 0); return g; }


  // ---- Relief: Bergketten/Hügel/Inseln aus Rauschen (glatt schattiert, Farbe nach Neigung und Höhe) ----
  // Gitter mit eigenen Normalen (aus den Nachbarpunkten), alle Gitter einer Szene in EINER Geometrie
  function Relief() { this.pos = []; this.col = []; this.nor = []; this.idx = []; }
  // R Zeilen × C Spalten; wrap = Spalten ringförmig; pf(r, c) → { p: [x, y, z], k }; cf(p, ny, k) → Farbe (linear)
  Relief.prototype.grid = function (R, C, wrap, pf, cf) {
    var V = [], r, c, base = this.pos.length / 3;
    for (r = 0; r < R; r++) for (c = 0; c < C; c++) V.push(pf(r, c));
    function at(rr, cc) { return V[rr * C + cc].p; }
    for (r = 0; r < R; r++) for (c = 0; c < C; c++) {
      var cl = wrap ? (c - 1 + C) % C : Math.max(c - 1, 0), cr = wrap ? (c + 1) % C : Math.min(c + 1, C - 1);
      var ru = Math.min(r + 1, R - 1), rd = Math.max(r - 1, 0), A = at(r, cl), B = at(r, cr), U = at(ru, c), D = at(rd, c);
      var ax = B[0] - A[0], ay = B[1] - A[1], az = B[2] - A[2], bx = U[0] - D[0], by = U[1] - D[1], bz = U[2] - D[2];
      var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!(l > 1e-9)) { nx = 0; ny = 1; nz = 0; l = 1; }   // zusammenfallende Nachbarn (Inselgipfel)
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      var v = V[r * C + c], col = cf(v.p, ny / l, v.k);
      this.pos.push(v.p[0], v.p[1], v.p[2]); this.nor.push(nx / l, ny / l, nz / l); this.col.push(col.r, col.g, col.b);
    }
    var i0 = this.idx.length;
    for (r = 0; r < R - 1; r++) for (c = 0; c < (wrap ? C : C - 1); c++) {
      var a = base + r * C + c, b = base + r * C + (c + 1) % C, d = a + C, e = b + C;
      this.idx.push(a, d, b, b, d, e);
    }
    // Wicklung nach oben ausrichten (an einem Viereck in der Mitte geprüft)
    var P = this.pos, I = this.idx, t = i0 + Math.floor((I.length - i0) / 6) * 3;
    if (I.length > i0) {
      var p0 = I[t] * 3, p1 = I[t + 1] * 3, p2 = I[t + 2] * 3;
      var ux = P[p1] - P[p0], uz = P[p1 + 2] - P[p0 + 2], wx = P[p2] - P[p0], wz = P[p2 + 2] - P[p0 + 2];
      if (uz * wx - ux * wz < 0) for (var q = i0; q < I.length; q += 3) { var tmp = I[q + 1]; I[q + 1] = I[q + 2]; I[q + 2] = tmp; }
    }
    return this;
  };
  Relief.prototype.geo = function () {
    if (!this.idx.length) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx); g.computeBoundingSphere();
    return g;
  };
  // Grat-Rauschen (ridged multifractal): scharfe Kämme, weiche Täler
  function ridged(x, z, oct) {
    var s = 0, a = 0.5, f = 1, w = 1;
    for (var o = 0; o < (oct || 5); o++) {
      var v = 1 - Math.abs(vnoise(x * f, z * f) * 2 - 1);
      v *= v; v *= w; w = clamp(v * 1.7, 0, 1);
      s += v * a; f *= 2.03; a *= 0.5;
    }
    return s;
  }
  // Bergketten in Tiefen-Schichten rund um die Strecke. o = { layers: [[r0, r1, Höhe, Dunst]], seed, lambda,
  //   back (Zusatzhöhe hinten −z), mask(θ) → 0…1, pal: { grass, forest, scree, rock, rock2, snow }, snow (Schneegrenze
  //   relativ, 0 = keiner), forest (bis zu dieser relativen Höhe Wald), haze (Farbe), seg, rows }
  function ranges(rl, ctx, o) {
    var rr = ctx.rng(o.seed || 19), seg = o.seg || 288, rows = o.rows || 14, pal = o.pal, haze = lin(o.haze);
    o.layers.forEach(function (L, li) {
      var ox = rr() * 500, oz = rr() * 500, lam = (o.lambda || 260) * (1 + li * 0.35), r0 = L[0], r1 = L[1], hmax = L[2];
      var snowOff = rr() * 100;
      rl.grid(rows, seg, true, function (r, c) {
        var t = r / (rows - 1), th = c / seg * TAU, R = lerp(r0, r1, Math.pow(t, 0.9));
        var x = ctx.cx + Math.cos(th) * R, z = ctx.cz + Math.sin(th) * R;
        var mk = o.mask ? o.mask(th) : 1, bk = 1 + (o.back || 0) * Math.max(0, -Math.sin(th));
        var env = smooth(0, 0.32, t) * (1 - 0.45 * smooth(0.72, 1, t));
        var big = 0.45 + 0.55 * vnoise((x + ox) / (lam * 3.2), (z + oz) / (lam * 3.2));   // Pässe und Gipfelgruppen
        var hh = hmax * bk * mk * env * big * (0.2 + ridged((x + ox) / lam, (z + oz) / lam));
        var base = ctx.height(x, z) - 4;
        return { p: [x, base + hh, z], k: { rel: hh / Math.max(1, hmax * bk * mk), n: vnoise((x + snowOff) / 60, z / 60), haze: L[3] } };
      }, function (p, ny, k) {
        var slope = 1 - ny, c = mix(pal.grass, pal.grass2 || pal.grass, k.n);
        if (o.forest) c = mix(c, mix(pal.forest, pal.forest2 || pal.forest, k.n), smooth(o.forest + 0.08, o.forest - 0.1, k.rel + (k.n - 0.5) * 0.12) * smooth(0.6, 0.38, slope));
        c = mix(c, pal.scree, smooth(0.2, 0.4, k.rel) * smooth(0.18, 0.32, slope) * 0.8);
        c = mix(c, mix(pal.rock, pal.rock2, k.n), smooth(0.34, 0.5, slope));
        if (o.snow) {
          var line = o.snow + (k.n - 0.5) * 0.16;
          c = mix(c, pal.snow, smooth(line - 0.04, line + 0.06, k.rel) * smooth(0.72, 0.55, slope));
        }
        return c.clone().lerp(haze, k.haze);
      });
    });
    return rl;
  }
  // Insel: unregelmäßiger Umriss, Gipfel in der Mitte (Höhe hpk über y0), Strand – Fels – Grün
  function island(rl, x0, z0, y0, ir, hpk, seed, pal, hazeC, hz) {
    var segs = 28, rows = 9, haze = lin(hazeC);
    rl.grid(rows, segs, true, function (r, c) {
      var t = r / (rows - 1), th = c / segs * TAU;
      var edge = ir * (0.8 + 0.4 * vnoise(Math.cos(th) * 1.6 + seed, Math.sin(th) * 1.6 + seed * 1.7));
      var R = edge * (1 - t), x = x0 + Math.cos(th) * R, z = z0 + Math.sin(th) * R;
      var prof = Math.pow(t, 1.6) * (3 - 2 * t);
      var rough = 1 + (1 - t) * t * 1.6 * (ridged(x / 70 + seed, z / 70) - 0.4);
      return { p: [x, y0 + hpk * clamp(prof * rough, 0, 1.2) - (r === 0 ? 3 : 0), z], k: { rel: t, n: vnoise(x / 40, z / 40) } };
    }, function (p, ny, k) {
      var slope = 1 - ny, c = mix(pal.grass, pal.forest, k.n);
      c = mix(c, mix(pal.rock, pal.rock2, k.n), smooth(0.3, 0.5, slope));
      c = mix(c, pal.sand, smooth(0.16, 0.05, k.rel));
      return c.clone().lerp(haze, hz);
    });
    return rl;
  }

  // ---- Bausteine, die mehrere Themen nutzen ----
  function pineGeo(dark) {
    var k = new Kit(), g = dark ? [0x234f2a, 0x2a5d31, 0x316a38] : [0x2f6b34, 0x347a3a, 0x3a8540];
    k.add(cyl(0.2, 0.28, 2.2), 0x6b4a2f, { y: 0.6 });
    k.add(cone(2.0, 3.2, 7), g[0], { y: 2.9 });
    k.add(cone(1.55, 2.7, 7), g[1], { y: 4.3, ry: 0.4 });
    k.add(cone(1.05, 2.2, 7), g[2], { y: 5.6, ry: 0.8 });
    return k.geo();
  }
  function rockGeo(c1, c2) {
    var k = new Kit();
    k.add(ico(1), function (x, y) { return mix(c1, c2, y * 0.8 + 0.3); }, { y: 0.25, sx: 1.5, sy: 0.85, sz: 1.15, jit: 0.45 });
    k.add(ico(0.6), c2, { x: 0.9, y: 0.1, z: 0.4, jit: 0.3, sy: 0.8 });
    return k.geo();
  }
  function cliffGeo(c1, c2, snow) {
    var k = new Kit();
    function rc(x, y) { return y > 7.5 && snow ? (hash3(x, y, 1) > 0.4 ? snow : c2) : mix(c1, c2, y / 9 + (hash3(x, 0, y) - 0.5) * 0.3); }
    k.add(ico(4.5), rc, { y: 2.2, sx: 1.6, sy: 1.3, sz: 1.0, jit: 2.2 });
    k.add(ico(3.2), rc, { x: -3.6, y: 4.8, z: 0.8, sx: 1.1, sy: 1.6, jit: 1.6 });
    k.add(ico(2.6), rc, { x: 4.0, y: 1.4, z: -0.6, sy: 1.1, jit: 1.2 });
    return k.geo();
  }

  // Reifenstapel: 3 Reifen (Drehkörper mit Flanke, Lauffläche, Loch), Fugen dazwischen; mittlerer Reifen weiß
  // (Instanzfarbe tönt ihn), Rest fast schwarz. r = Außenradius (m); Fuß auf y = 0
  function tyreStack(r) {
    r = r || 0.31;
    var h = r * 0.62, k = new Kit(), pts = [[r, 0], [r, 0.97 * h], [0.88 * r, h], [r, 1.03 * h], [r, 1.97 * h], [0.88 * r, 2 * h], [r, 2.03 * h], [r, 2.95 * h], [0.5 * r, 3 * h]];
    var lathe = new THREE.LatheGeometry(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), 7);
    // mittlerer Reifen hell (Instanzfarbe), Loch oben fast schwarz
    k.add(lathe, function (x, y, z) { return Math.hypot(x, z) < r * 0.6 ? 0x0c0c0d : y > h * 1.02 && y < h * 1.98 ? 0xffffff : 0x1b1c1f; });
    return k.geo();
  }

  // ---- Themen ----
  var THEMES = {};

  // Stadion: große Tribünen, Flutlichtmasten, Werbebanden, Fahnen, Boxengasse; flach, heller Tag
  THEMES.stadium = {
    id: 'stadium', name: 'Stadium', flat: true,
    sky: { top: 0x3d7cc9, horizon: 0xc8dcf0 }, fog: { near: 420, far: 1700 },
    sun: { color: 0xffffff, k: 1.05, pos: [4, 7, 5] }, hemi: { sky: 0xdfeeff, ground: 0x4d6a45, k: 1 }, fill: 1, exposure: 1.0,
    groundTex: { base: [232, 232, 232], spread: 0.12, stripes: true },
    surface: { curb: [0xd8262b, 0xf4f4f4], runoff: 'gravel', barrier: 'wall' },
    height: function () { return function () { return 0; }; },
    groundColor: function (ctx) {
      return function (x, z, h, d) { var n = fbm(x / 40, z / 40); return mix(0x3f8a3c, 0x4f9a46, n); };
    },
    decorate: function (ctx) {
      var P = ctx.T.at, HALF = ctx.HALF, rnd = ctx.rnd, prim = ctx.primary, acc = ctx.accent;
      // Tribüne: 5 Ränge mit bunten Zuschauern, Rückwand, Dach in Primärfarbe auf Stützen (lokal: x längs, +z vom Track weg)
      var st = new Kit(), crowd = [0xe04848, 0x3a86ff, 0xffbe0b, 0xf2f2f2, 0x8338ec, 0x2ec4b6, 0xfb5607, 0x222831];
      for (var r = 0; r < 5; r++) {
        var hh = 0.9 + r * 0.9;
        st.add(box(26, hh + 2, 1.8), r % 2 ? 0x9aa0aa : 0x8a8f99, { y: hh / 2 - 1, z: r * 1.8 });
        for (var q = 0; q < 34; q++) {
          if (rnd() < 0.12) continue;
          st.add(box(0.5, 0.75, 0.45), crowd[Math.floor(rnd() * crowd.length)], { x: -12.4 + q * 0.75 + (rnd() - 0.5) * 0.2, y: hh + 0.37, z: r * 1.8 - 0.3 });
        }
      }
      st.add(box(26, 9, 0.5), 0x6d7280, { y: 3.5, z: 9.2 });
      [-12, 0, 12].forEach(function (x) { st.add(box(0.4, 9.5, 0.4), 0x50555f, { x: x, y: 4.75, z: 8.6 }); });
      st.add(box(27, 0.4, 10.5), prim, { y: 9.2, z: 4.2, rx: -0.08 });
      st.add(box(27.2, 0.2, 0.3), acc, { y: 8.75, z: -0.9 });
      // Kulissen-Modelle (Tribünen/Sitzreihen): erste Reihe vorn wie die prozedurale, kleine nebeneinander bis 26 m
      var stand = ctx.kind('stand', [{ geo: st.geo() }], { r: 14, prop: { slot: 'stand', box: { w: 26, d: 11, h: 12 }, front: -1, tile: true } });
      // Flutlichtmast: Gittermast (schlank), Kopf mit Lampenfeld (leuchtend)
      var ms = new Kit();
      ms.add(cyl(0.3, 0.55, 26, 6), 0x9ea4ad, { y: 12 });
      ms.add(box(5, 2.6, 0.5), 0x3a3f47, { y: 25.5, z: -0.2 });
      var lampK = new Kit();
      for (var a = 0; a < 4; a++) for (var b = 0; b < 2; b++) lampK.add(box(1, 0.95, 0.12), 0xfff6d8, { x: -1.8 + a * 1.2, y: 24.9 + b * 1.15, z: -0.5 });
      var mast = ctx.kind('mast', [{ geo: ms.geo() }, { geo: lampK.geo(), mat: 'glow' }], { r: 3, prop: { slot: 'mast', box: { w: 9, d: 9, h: 30 } } });
      // Werbebande: Rahmen + helle Fläche (Farbe je Instanz), steht hinter der Leitplanke
      var bd = new Kit();
      bd.add(box(6, 1.1, 0.12), 0xffffff, { y: 0.75 });
      bd.add(box(6.1, 0.12, 0.16), 0x22252b, { y: 1.33 });
      bd.add(box(0.1, 1.5, 0.1), 0x22252b, { x: -2.9, y: 0.55 }); bd.add(box(0.1, 1.5, 0.1), 0x22252b, { x: 2.9, y: 0.55 });
      bd.add(box(3.4, 0.26, 0.14), 0x1b1d22, { x: -0.8, y: 0.8 });
      var board = ctx.kind('board', [{ geo: bd.geo() }], { r: 3, tint: true });
      // Fahne: Mast + Tuch (weht im Wind, außer bei reduzierter Bewegung)
      var fp = new Kit(), fc = new Kit();
      fp.add(cyl(0.06, 0.09, 9, 5), 0xd8dde4, { y: 4.3 });
      fc.add(new THREE.PlaneGeometry(2.6, 1.5, 6, 2), 0xffffff, { x: 1.35, y: 7.9 });
      var flag = ctx.kind('flag', [{ geo: fp.geo(), notint: true }, { geo: fc.geo(), mat: 'wave' }], { r: 1.5, tint: true });
      // Boxengasse: flaches Boxengebäude mit Garagentoren und Dachstreifen
      var pt = new Kit();
      pt.add(box(48, 5, 10), 0xd6d9de, { y: 2.0, z: 5 });
      for (var gi = 0; gi < 10; gi++) pt.add(box(3.4, 3.2, 0.1), 0x2b2f36, { x: -21 + gi * 4.67, y: 1.6, z: -0.03 });
      pt.add(box(48.4, 0.5, 10.4), prim, { y: 4.75, z: 5 });
      pt.add(box(48.6, 0.3, 0.2), acc, { y: 4.1, z: -0.12 });
      pt.add(box(6, 3, 5), 0xe8eaee, { x: 14, y: 6.5, z: 5 });
      pt.add(box(6.2, 0.9, 0.1), 0x3a4a5e, { x: 14, y: 6.7, z: 2.45 });
      var pits = ctx.kind('pits', [{ geo: pt.geo() }], { r: 25 });

      // Plätze: Boxengebäude an der Startgeraden (Seite mit Platz), Tribünen an Geraden, Fahnen am Start
      var used = {};
      function along(s, sd, off) { var p = P(s); return { x: p.x + p.nx * sd * off, z: p.z + p.nz * sd * off, rot: p.yaw + (sd > 0 ? Math.PI : 0), p: p }; }
      function straightAt(s, span) { for (var k = -span; k <= span; k += 4) if (Math.abs(P(s + k).curv) > 1 / 70) return false; return true; }
      var pitSide = 0;
      [1, -1].some(function (sd) {
        var o = along(-30, sd, HALF + 12 + 4);
        if (!ctx.clearRect(o.x, o.z, o.rot, 24.5, -0.5, 10.5) || !ctx.place(o.x, o.z, 12, true)) return false;
        pits.add(o.x, o.z, { rot: o.rot }); pitSide = sd;
        ctx.pit = { sd: sd, mid: -30, s0: -52, s1: -8 };   // Boxengasse vor dem Gebäude (Markierung: js/car-track-surface.js)
        return true;
      });
      var L = ctx.T.len, nStand = 0;
      for (var s = 0; s < L && nStand < 6; s += 6) {
        for (var sd = 1; sd >= -1; sd -= 2) {
          var o = along(s, sd, HALF + 12 + 4);
          if (!ctx.clearRect(o.x, o.z, o.rot, 13.5, -1.2, 10) || !ctx.place(o.x, o.z, 13, true)) continue;
          stand.add(o.x, o.z, { rot: o.rot }); nStand++; s += 20; break;
        }
      }
      // Fahnenreihe gegenüber den Boxen, rund um Start/Ziel
      for (var fs = -34; fs <= 34; fs += 8.5) {
        var of = along(fs, -(pitSide || 1), HALF + 16);
        if (!ctx.place(of.x, of.z, 1.2)) continue;
        var fcol = [prim, acc, 0xf4f4f4][Math.round((fs + 34) / 8.5) % 3];
        flag.add(of.x, of.z, { rot: of.rot + Math.PI / 2, tint: fcol });
      }
      // Flutlichtmasten rund um die Strecke (Kopf zur Strecke gedreht)
      var nm = 0;
      for (var t = 0; t < 400 && nm < 8; t++) {
        var sm = rnd() * L, sdm = rnd() < 0.5 ? 1 : -1, om = along(sm, sdm, HALF + 22 + rnd() * 14);
        if (!ctx.place(om.x, om.z, 3)) continue;
        mast.add(om.x, om.z, { rot: om.rot }); nm++;
      }
      // mobile Lichtmasten (nur als Kulissen-Modell, slot mobileLight) im Fahrerlager neben der Strecke
      ctx.scatter(ctx.kind('mobileLight', [], { r: 2, prop: { slot: 'mobileLight', box: { w: 5, d: 5, h: 4 } } }), 6, { dmin: 18, dmax: 45, rad: 2.2 });
      // Strahler auf Pfosten (nur als Kulissen-Modell, slot floodPost)
      ctx.scatter(ctx.kind('floodPost', [], { r: 1.2, prop: { slot: 'floodPost', box: { w: 3, d: 3, h: 6 } } }), 6, { dmin: 16, dmax: 40, rad: 1.2 });
      // 7-m-Lampenmasten: Mast prozedural, Kopf prozedural oder Kulissen-Modell (slot floodHead)
      var pk7 = new Kit(), hk7 = new Kit(), hg7 = new Kit();
      pk7.add(cyl(0.1, 0.16, 7, 6), 0x8d939b, { y: 3.5 });
      hk7.add(box(1.2, 0.7, 0.35), 0x3a3f47, { y: 7.35 });
      hg7.add(box(1.0, 0.5, 0.06), 0xfff6d8, { y: 7.35, z: -0.2 });
      var pole7 = ctx.kind('floodPole', [{ geo: pk7.geo() }], { r: 1 });
      var head7 = ctx.kind('floodHead', [{ geo: hk7.geo() }, { geo: hg7.geo(), mat: 'glow' }], { r: 1, prop: { slot: 'floodHead', box: { w: 1.6, d: 1.6, h: 1.6 }, y: 7 } });
      for (var tf = 0, nf = 0; tf < 200 && nf < 6; tf++) {
        var of7 = ctx.randomSpot(15, 28);
        if (!of7 || !ctx.place(of7.x, of7.z, 1)) continue;
        pole7.add(of7.x, of7.z, { rot: of7.rot }); head7.add(of7.x, of7.z, { rot: of7.rot }); nf++;
      }
      // Werbebanden hinter der Leitplanke auf Geraden (beide Seiten), Farbe abwechselnd
      var adCols = [prim, acc, 0xf4f4f4, 0x2a7de1, 0xe23b3b], ai = 0;
      [1, -1].forEach(function (sd) {
        for (var s2 = 0; s2 < L; s2 += 7) {
          if (!straightAt(s2, 4)) continue;
          var a2 = P(s2), run = sd > 0 ? a2.runL : a2.runR, off = HALF + run + 1.5;
          var x = a2.x + a2.nx * sd * off, z = a2.z + a2.nz * sd * off;
          if (ctx.trackDist(x, z, off + 2) < off - 0.5) continue;   // anderer Streckenteil zu nah
          if (!ctx.place(x, z, 2.6, true)) continue;
          board.add(x, z, { rot: a2.yaw, tint: adCols[ai++ % adCols.length] });
        }
      });
      // Hintergrund: Oberrang rund um das Stadion (Schüssel), mit Zuschauerpunkten und Dachkante
      var bg = new Kit(), R = ctx.radius + 170, N = 56;
      for (var i = 0; i < N; i++) {
        var a0 = i / N * TAU, am = a0 + Math.PI / N, x0 = ctx.cx + Math.cos(am) * R, z0 = ctx.cz + Math.sin(am) * R * 0.8;
        var w = TAU * R / N * 1.02;
        bg.add(box(w, 16, 18), function (x, y) { return y > 14 ? 0x5a5f69 : hash3(x * 3, y * 3, 0) > 0.5 ? crowd[Math.floor(hash3(x, y, 1) * crowd.length)] : 0x7c8290; },
          { x: x0, y: 6, z: z0, ry: -am - Math.PI / 2, rx: -0.32 });
        bg.add(box(w, 1.2, 14), prim, { x: x0 + Math.cos(am) * 6, y: 18, z: z0 + Math.sin(am) * 6, ry: -am - Math.PI / 2 });
      }
      ctx.bg(bg);
    }
  };

  // Wald: Nadelbäume, Felsen, Holzzaun, Bach mit Brücke; sanfte Hügel, weiches grünliches Licht
  THEMES.forest = {
    id: 'forest', name: 'Forest',
    sky: { top: 0x5b8fc4, horizon: 0xcfe0d6 }, fog: { near: 300, far: 1300 },
    sun: { color: 0xfff1d6, k: 0.9, pos: [5, 7, 3] }, hemi: { sky: 0xd8ecd8, ground: 0x3d5a32, k: 1 }, fill: 0.85, exposure: 1.0,
    groundTex: { base: [232, 232, 232], spread: 0.26 },
    surface: { curb: [0xd8262b, 0xf4f4f4], runoff: 'gravel', barrier: 'armco', sausage: true },
    height: function (ctx) {
      var w = waveSet(ctx.rng(11), 3, 2.6, 95, 170);
      return function (x, z) { return w(x - ctx.cx, z - ctx.cz); };
    },
    groundColor: function (ctx) {
      return function (x, z, h, d) {
        var n = fbm(x / 28, z / 28), c = mix(0x3d6b32, 0x557a3a, n);
        if (n > 0.66 && d > 18) c = mix(c, 0x6b5a3a, (n - 0.66) * 3);   // Waldboden-Flecken
        if (ctx.creekD && ctx.creekD(x, z) < 4.5) c = mix(c, 0x5a4a30, 0.7);   // Ufer
        return c;
      };
    },
    decorate: function (ctx) {
      var rnd = ctx.rnd, HALF = ctx.HALF;
      // Bach: geschwungen außerhalb der Strecke (Seite mit dem meisten Platz), Brücke in der Mitte
      var zc = ctx.minZ - 34, x0 = ctx.minX - 260, x1 = ctx.maxX + 260;
      function creekZ(x) { return zc + 6 * Math.sin(x / 23) + 3 * Math.sin(x / 9.5 + 1); }
      ctx.creekD = function (x, z) { return x < x0 || x > x1 ? 1e9 : Math.abs(z - creekZ(x)); };
      var pts = [];
      for (var x = x0; x <= x1; x += 3) pts.push([x, creekZ(x)]);
      ctx.ribbon(pts, 3.2, 0.06, 'water');
      var bx = (ctx.minX + ctx.maxX) / 2 + 12, bz = creekZ(bx), bdir = Math.atan2(-(creekZ(bx + 1) - creekZ(bx - 1)), 2);
      var br = new Kit();
      br.add(box(2.4, 0.25, 8), 0x8a6239, { y: 0.55 });
      [-1.1, 1.1].forEach(function (x) {
        br.add(box(0.12, 0.12, 8), 0x6e4c2c, { x: x, y: 1.5 });
        [-3.6, -1.2, 1.2, 3.6].forEach(function (z) { br.add(box(0.14, 1.6, 0.14), 0x6e4c2c, { x: x, y: 0.7, z: z }); });
      });
      // Brücken (Kulissen-Modelle: Spannweite entlang x → quer zum Bach gedreht): die Brücke in der Mitte und weitere
      // am Bach entlang, wo Platz ist; dazu ein japanischer Brückengarten am anderen Ufer (nur als Modell)
      var bridge = ctx.kind('bridge', [{ geo: br.geo() }], { r: 8, prop: { slot: 'bridge', box: { w: 16, d: 8, h: 10 }, yaw: Math.PI / 2 } });
      bridge.add(bx, bz, { rot: bdir });
      ctx.place(bx, bz, 4.5, true);
      function creekRot(x) { return Math.atan2(-(creekZ(x + 1) - creekZ(x - 1)), 2); }
      [-80, 80, -160, 160].forEach(function (dx) {
        var x = bx + dx, z = creekZ(x);
        if (ctx.place(x, z, 8)) bridge.add(x, z, { rot: creekRot(x) });
      });
      var garden = ctx.kind('garden', [], { r: 9, prop: { slot: 'garden', box: { w: 16, d: 16, h: 12 } } });
      [40, -40, 120, -120].some(function (dx) {
        var x = bx + dx, z = creekZ(x) - 16;
        if (!ctx.place(x, z, 9)) return false;
        garden.add(x, z, { rot: creekRot(x) }); return true;
      });
      function offCreek(x, z) { return ctx.creekD(x, z) > 4.5; }
      // Nadelbäume: dicht nahe der Strecke, weiter draußen als Waldrand
      var pine = ctx.kind('pine', [{ geo: pineGeo(false) }], { r: 2.2, tint: true });
      var pineD = ctx.kind('pineDark', [{ geo: pineGeo(true) }], { r: 2.2, tint: true });
      function green() { return mix(0xffffff, 0xc9d8b0, rnd()); }
      ctx.scatter(pine, 260, { dmin: 15, dmax: 80, rad: 1.8, s: [0.8, 1.5], pred: offCreek, tint: green });
      ctx.scatter(pineD, 520, { dmin: 70, dmax: 270, rad: 2.2, s: [1.0, 1.8], pred: offCreek, tint: green });
      // Felsen
      ctx.scatter(ctx.kind('rock', [{ geo: rockGeo(0x6f7069, 0x9a9b92) }], { r: 1.6 }), 40, { dmin: 15, dmax: 120, rad: 1.6, s: [0.6, 1.6], pred: offCreek });
      // Bewaldete Hügelketten im Hintergrund (Wald bis fast oben, Lichtungen, wenig Fels), im Dunst
      ctx.bgMesh(ranges(new Relief(), ctx, { seed: 11, forest: 0.85, haze: THEMES.forest.sky.horizon, lambda: 200,
        layers: [[380, 700, 70, 0.08], [620, 1020, 120, 0.25], [920, 1260, 170, 0.4]],
        pal: { grass: 0x5d7a3e, grass2: 0x6c8645, forest: 0x264a2a, forest2: 0x2f5a31, scree: 0x7c7466, rock: 0x6c6a63, rock2: 0x807d75, snow: 0xf2f5fa } }).geo());
      // Holzzaun an Geraden hinter der Leitplanke (Abschnitte à 4 m)
      var fk = new Kit();
      [-1.9, 0, 1.9].forEach(function (x) { fk.add(box(0.16, 1.3, 0.16), 0x6e4c2c, { x: x, y: 0.45 }); });
      fk.add(box(4, 0.12, 0.08), 0x8a6239, { y: 0.55 }); fk.add(box(4, 0.12, 0.08), 0x8a6239, { y: 0.95 });
      var fence = ctx.kind('fence', [{ geo: fk.geo() }], { r: 2.1 });
      ctx.alongRail(fence, { step: 4, extra: 2.2, side: ctx.T.turnDir > 0 ? -1 : 1, every: function (s) { return Math.floor(s / 60) % 2 === 0; } });
    }
  };

  // Alpen: Berge im Hintergrund, Felswände, Schneereste, Kehren am Hang; deutliches Auf und Ab, kühles Licht
  THEMES.alpine = {
    id: 'alpine', name: 'Alpine',
    sky: { top: 0x2f6fc2, horizon: 0xdbe8f5 }, fog: { near: 380, far: 2100 },
    sun: { color: 0xeef4ff, k: 1.15, pos: [3, 8, 4] }, hemi: { sky: 0xe6f0ff, ground: 0x5d6b52, k: 1.05 }, fill: 1, exposure: 1.02,
    groundTex: { base: [232, 232, 232], spread: 0.24 },
    surface: { curb: [0xd8262b, 0xf4f4f4], runoff: 'gravel', barrier: 'armco', sausage: true },
    height: function (ctx) {
      // schiefe Ebene (weich begrenzt) + Wellen + Anstieg zu den Bergen weit draußen
      var w = waveSet(ctx.rng(13), 3, 1.4, 80, 140), dx = 0.8, dz = -0.6, G = 0.115, R = 110;
      return function (x, z) {
        var u = (x - ctx.cx) * dx + (z - ctx.cz) * dz;
        return G * R * Math.tanh(u / R) + w(x - ctx.cx, z - ctx.cz) + 30 * smooth(200, 700, ctx.outside(x, z));
      };
    },
    groundColor: function (ctx) {
      return function (x, z, h, d) {
        var n = fbm(x / 30, z / 30), c = mix(0x6f9a4a, 0x8aab58, n);
        var rock = fbm(x / 55 + 9, z / 55 + 4);
        if (rock > 0.62 && d > 16) c = mix(c, 0x8b8a84, (rock - 0.62) * 4);
        var snow = fbm(x / 22 + 31, z / 22 + 17);
        if (snow > 0.6 && d > 22) c = mix(c, 0xf4f7fb, (snow - 0.6) * 6);   // Schneereste
        if (h > 18) c = mix(c, 0xf4f7fb, (h - 18) / 10);
        return c;
      };
    },
    decorate: function (ctx) {
      var rnd = ctx.rnd;
      // Bergketten in drei Tiefen-Schichten, hinten (−z, Blickrichtung der Totalen) höher: Grat-Rauschen, Fels nach
      // Neigung, Schnee nach Höhe mit weicher Grenze, Wald an den unteren Hängen, Dunst zur Ferne hin
      for (var burn = 0; burn < 180; burn++) rnd();   // Zufallsfolge wie früher (Deko danach bleibt, wo sie war)
      ctx.bgMesh(ranges(new Relief(), ctx, { seed: 13, back: 0.55, snow: 0.55, forest: 0.3, haze: THEMES.alpine.sky.horizon,
        layers: [[430, 820, 160, 0.1], [720, 1250, 280, 0.28], [1120, 1760, 420, 0.42]],
        pal: { grass: 0x5d7c46, grass2: 0x6f8c50, forest: 0x2b472d, forest2: 0x35553a, scree: 0x908b80, rock: 0x6a6761, rock2: 0x817d76, snow: 0xf2f5fa } }).geo());
      // Felswände bergseitig nahe der Strecke
      var cliff = ctx.kind('cliff', [{ geo: cliffGeo(0x6c6a66, 0x9a978f, 0xf4f7fb) }], { r: 8 });
      ctx.scatter(cliff, 16, { dmin: 22, dmax: 75, rad: 8, s: [0.8, 1.35], pred: function (x, z) { return (x - ctx.cx) * 0.8 - (z - ctx.cz) * 0.6 > -10; } });
      // vereinzelte Nadelbäume, Felsen, Almhütten
      var pine = ctx.kind('pine', [{ geo: pineGeo(true) }], { r: 2, tint: true });
      ctx.scatter(pine, 220, { dmin: 15, dmax: 240, rad: 2, s: [0.8, 1.5], tint: function () { return mix(0xffffff, 0xbfd0c0, rnd()); } });
      ctx.scatter(ctx.kind('rock', [{ geo: rockGeo(0x77756f, 0xa5a39b) }], { r: 1.6 }), 55, { dmin: 15, dmax: 140, rad: 1.6, s: [0.6, 1.8] });
      var hk = new Kit();
      hk.add(box(7, 5, 6), 0x8a5a33, { y: 1.0 });
      hk.add(box(7.2, 0.4, 0.1), 0x5e3c20, { y: 1.8, z: 3.02 });
      hk.add(prism(8.2, 7.6, 2.8), 0x5b4a44, { y: 4.85 });
      hk.add(box(1.2, 1, 0.1), 0xdfe8f0, { x: -1.8, y: 2.2, z: 3.03 }); hk.add(box(1.2, 1, 0.1), 0xdfe8f0, { x: 1.8, y: 2.2, z: 3.03 });
      hk.add(box(0.6, 2, 0.6), 0x77736d, { x: 2.2, y: 5.6, z: -1 });
      ctx.scatter(ctx.kind('hut', [{ geo: hk.geo() }], { r: 5, prop: { slot: 'hut', box: { w: 12, d: 12, h: 12 } } }), 4, { dmin: 26, dmax: 110, rad: 5.5, s: [0.9, 1.1] });
    }
  };

  // Küste: Meer, Strand, Palmen, Leuchtturm, Klippe; leichtes Auf und Ab, warme Abendstimmung
  THEMES.coast = {
    id: 'coast', name: 'Coast',
    sky: { top: 0x46679e, horizon: 0xffbf94 }, fog: { near: 380, far: 1900 },
    sun: { color: 0xffc9a0, k: 1.0, pos: [6, 3.2, 3] }, hemi: { sky: 0xffd9c2, ground: 0x5b6a4a, k: 0.95 }, fill: 0.8, exposure: 1.02,
    groundTex: { base: [232, 232, 232], spread: 0.22 },
    sea: -3.0,
    surface: { curb: [0x2a6fd6, 0xf4f4f4], runoff: 'sand', barrier: 'armco', sausage: true },
    height: function (ctx) {
      var w = waveSet(ctx.rng(17), 2, 1.8, 100, 160), zs = ctx.minZ - 64;
      ctx.shoreZ = zs;
      return function (x, z) { return w(x - ctx.cx, z - ctx.cz) - 9 * smooth(zs, zs - 46, z); };
    },
    groundColor: function (ctx) {
      var sea = THEMES.coast.sea;
      return function (x, z, h, d) {
        var n = fbm(x / 26, z / 26), c = mix(0x6f8f45, 0x8a9d52, n);
        c = mix(c, 0xe3cf9c, smooth(0.9, -0.3, h) * smooth(ctx.shoreZ + 30, ctx.shoreZ + 6, z));   // Strand
        if (h < sea + 0.3) c = mix(0xd9c38f, 0x9c8a62, clamp((sea + 0.3 - h) / 2, 0, 1));
        return c;
      };
    },
    decorate: function (ctx) {
      var rnd = ctx.rnd, sea = THEMES.coast.sea;
      ctx.sea(sea, ctx.shoreZ - 2);
      // Küstenlinie (Höhe = Meeresspiegel) je x suchen → Gischt-Streifen
      var shore = [];
      for (var x = ctx.cx - 900; x <= ctx.cx + 900; x += 6) {
        var lo = ctx.shoreZ - 80, hi = ctx.shoreZ + 10;
        for (var it = 0; it < 22; it++) { var mid = (lo + hi) / 2; if (ctx.height(x, mid) > sea) hi = mid; else lo = mid; }
        shore.push([x, (lo + hi) / 2]);
      }
      ctx.ribbon(shore, 2.2, sea + 0.04, 'foam', true);
      function land(x, z) { return ctx.height(x, z) > sea + 0.6; }
      // Palmen: geschwungener Stamm aus Segmenten, Wedel, Kokosnüsse
      var pk = new Kit(), lean = 0;
      for (var sgi = 0; sgi < 6; sgi++) {
        lean += 0.07;
        pk.add(cyl(0.2 - sgi * 0.015, 0.24 - sgi * 0.015, 1.5, 6), sgi % 2 ? 0x8d6e4a : 0x7a5c3c, { x: Math.sin(lean) * sgi * 1.1 * 0.6, y: 0.6 + sgi * 1.35, rz: -lean });
      }
      var tx = Math.sin(lean) * 6 * 0.66, ty = 0.6 + 6 * 1.35;
      for (var f = 0; f < 7; f++) {
        var fa = f / 7 * TAU;
        pk.add(box(3.6, 0.08, 0.9), f % 2 ? 0x3f8a3a : 0x4f9e44, { x: tx + Math.cos(fa) * 1.6, y: ty - 0.5, z: Math.sin(fa) * 1.6, ry: -fa, rz: -0.45 });
      }
      [0, 2.1, 4.2].forEach(function (a) { pk.add(ico(0.22), 0x5a3d22, { x: tx + Math.cos(a) * 0.35, y: ty - 0.3, z: Math.sin(a) * 0.35 }); });
      var palm = ctx.kind('palm', [{ geo: pk.geo() }], { r: 2.2, tint: true });
      ctx.scatter(palm, 70, { dmin: 15, dmax: 130, rad: 2.2, s: [0.8, 1.25], pred: land, tint: function () { return mix(0xffffff, 0xd8e6c4, rnd()); } });
      // Strand: bunte Sonnenschirme (Gimmick)
      var uk = new Kit();
      uk.add(cyl(0.04, 0.04, 2.4, 4), 0xeeeeee, { y: 1.2 });
      uk.add(new THREE.ConeGeometry(1.4, 0.55, 8, 1), function (x, y, z) { return Math.floor((Math.atan2(z, x) + Math.PI) / (TAU / 8)) % 2 ? 0xffffff : 0xfafafa; }, { y: 2.3 });
      var umb = ctx.kind('umbrella', [{ geo: uk.geo() }], { r: 1.5, tint: true });
      var ucol = [0xe23b3b, 0x2a7de1, 0xffbe0b, 0x2ec4b6, 0xfb5607];
      ctx.scatter(umb, 14, { dmin: 22, dmax: 220, rad: 2, pred: function (x, z) { var h = ctx.height(x, z); return h > sea + 0.5 && h < sea + 2.2; }, tint: function () { return ucol[Math.floor(rnd() * ucol.length)]; } });
      // Leuchtturm auf einer Felsklippe an der Küste (rot-weiß, Laterne leuchtet, Lichtkegel dreht sich)
      var lx = ctx.maxX + 18, lz = ctx.shoreZ - 22;
      var rkK = new Kit(), lk = new Kit(), glow = new Kit();
      rkK.add(ico(7), function (x, y) { return mix(0x6d655a, 0x988e7e, y / 8); }, { y: 1.5, sx: 1.3, sy: 0.9, jit: 2.6 });
      rkK.add(ico(4.5), 0x857b6c, { x: -6, y: 0.5, z: 3, jit: 1.8 });
      for (var b = 0; b < 5; b++) lk.add(cyl(2.3 - (b + 1) * 0.22, 2.3 - b * 0.22, 3.4, 12), b % 2 ? 0xd8262b : 0xf4f4f4, { y: 7 + b * 3.4 });
      lk.add(cyl(1.9, 1.9, 0.3, 12), 0x2b2f36, { y: 24.2 });
      lk.add(cone(1.4, 1.6, 12), 0xd8262b, { y: 27.1 });
      glow.add(cyl(1.0, 1.0, 1.7, 10), 0xfff1b0, { y: 25.3 });
      ctx.kind('lighthouseRock', [{ geo: rkK.geo() }], { r: 9 }).add(lx, lz, { y: -1.2 });
      // Turm: Kulissen-Modell (slot cliff) steht auf dem Fels (Fuß des prozeduralen Turms bei 5,3 m), Lichtkegel wandert
      // auf ~88 % seiner Höhe mit
      var beamBase = ctx.ground(lx, lz) - 1.2, beam = null;
      var lh = ctx.kind('lighthouse', [{ geo: lk.geo() }, { geo: glow.geo(), mat: 'glow' }], { r: 9, prop: { slot: 'cliff', box: { w: 22, d: 22, h: 34 }, y: 5.3,
        onProp: function (sp, info) { if (beam) beam.position.y = beamBase + 5.3 + info.height * 0.88; } } });
      lh.add(lx, lz, { y: -1.2 });
      ctx.place(lx, lz, 9, true);
      beam = ctx.beam(lx, beamBase + 25.3, lz);
      // Klippe: große Felsen an der Küste beim Leuchtturm
      var rk = ctx.kind('cliffrock', [{ geo: cliffGeo(0x6d655a, 0x9a8f7c) }], { r: 7 });
      for (var k = 0; k < 6; k++) {
        var rx = lx - 14 - k * 11 - rnd() * 4, rz = lz + (rnd() - 0.5) * 10;
        if (ctx.place(rx, rz, 6, true)) rk.add(rx, rz, { rot: rnd() * TAU, s: 0.7 + rnd() * 0.5, y: -1.5 });
      }
      // Hintergrund: flache Inseln am Horizont; auf jeder ein Leuchtturm (nur als Kulissen-Modell, slot island) – genau
      // auf der Inselkuppe: deren Ecke verschiebt Kit.add um hash3 (wie dort berechnet)
      // Hügel im Hinterland (nur Landseite, +z), Inseln am Horizont aus Rauschen; auf jeder Insel ein Leuchtturm (nur als
      // Kulissen-Modell, slot island) genau auf dem Gipfel (Mitte der Insel)
      var rl = new Relief(), cPal = { grass: 0x7b8f48, grass2: 0x95985e, forest: 0x4f6a3c, forest2: 0x5d7843, scree: 0xa3957a, rock: 0x7a6f60, rock2: 0x958a78, snow: 0xffffff, sand: 0xd9c38f };
      ranges(rl, ctx, { seed: 17, forest: 0.4, haze: THEMES.coast.sky.horizon, lambda: 230, mask: function (th) { return smooth(-0.05, 0.4, Math.sin(th)); },
        layers: [[460, 860, 65, 0.12], [760, 1320, 115, 0.3]], pal: cPal });
      var isle = ctx.kind('islandLighthouse', [], { r: 20, prop: { slot: 'island', box: { w: 40, d: 40, h: 45 } } });
      for (var is = 0; is < 5; is++) {
        var ix = ctx.cx + (rnd() - 0.5) * 1800, iz = ctx.shoreZ - 650 - rnd() * 450, ir = 60 + rnd() * 110, hpk = ir * 0.32;
        island(rl, ix, iz, sea - 2, ir, hpk, is * 7.3 + 1, cPal, THEMES.coast.sky.horizon, 0.25 + (ctx.shoreZ - iz - 650) / 450 * 0.2);
        isle.add(ix, iz, { abs: true, y: sea - 2 + hpk - 1.5, rot: is * 1.3 });
      }
      ctx.bgMesh(rl.geo());
      // Felseninsel mit Leuchtturm im Meer zwischen Strand und Horizont (nur als Kulissen-Modell, slot sea)
      ctx.kind('seaIsland', [], { r: 30, prop: { slot: 'sea', box: { w: 70, d: 70, h: 50 } } }).add(ctx.maxX - 140, ctx.shoreZ - 260, { abs: true, y: sea, rot: 2.2 });
    }
  };

  // Industrie: Reifenstapel als Begrenzung, Container, Lagerhalle, Asphaltflächen; flach, bedeckt-kühles Licht
  THEMES.industrial = {
    id: 'industrial', name: 'Industrial', flat: true,
    sky: { top: 0x6f8296, horizon: 0xc9ced3 }, fog: { near: 320, far: 1400 },
    sun: { color: 0xf3f6fa, k: 0.95, pos: [4, 7, 5] }, hemi: { sky: 0xe3e8ee, ground: 0x5a5d61, k: 1.05 }, fill: 1, exposure: 1.0,
    groundTex: { base: [232, 232, 232], spread: 0.3 },
    rail: false,
    surface: { curb: [0x2a6fd6, 0xf2c200], runoff: 'tarmac', barrier: 'tyres', stripes: false },
    height: function () { return function () { return 0; }; },
    groundColor: function (ctx) {
      return function (x, z, h, d) {
        var n = fbm(x / 24, z / 24), c = mix(0x7d8079, 0x8f918a, n);   // Beton/Schotter
        if (n < 0.38) c = mix(c, 0x5d7a45, (0.38 - n) * 4);           // Grasflecken
        if (ctx.inYard(x, z)) c = mix(0x4a4c51, 0x55575c, n);          // Asphaltflächen
        return c;
      };
    },
    decorate: function (ctx) {
      var rnd = ctx.rnd, yards = [];
      ctx.inYard = function (x, z) {
        for (var i = 0; i < yards.length; i++) { var y = yards[i], dx = x - y.x, dz = z - y.z, c = Math.cos(y.r), s = Math.sin(y.r);
          if (Math.abs(dx * c - dz * s) < y.w && Math.abs(dx * s + dz * c) < y.d) return true; }
        return false;
      };
      // Reifenstapel statt Leitplanke (mittlerer Reifen in Instanzfarbe); Gurt davor: js/car-track-surface.js
      var tyres = ctx.kind('tyres', [{ geo: tyreStack(0.5) }], { r: 0.5, tint: true });
      var tcol = [0x1a1a1c, 0x1a1a1c, 0xf2f2f2, 0xd8262b, 0x1a1a1c, 0xf2b705];
      ctx.alongRail(tyres, { step: 1.05, extra: 0.25, tint: function (k) { return tcol[k % tcol.length]; } });
      // Lagerhalle: Wände, Satteldach, Rolltore, Fensterband
      var hk = new Kit();
      hk.add(box(44, 11, 22), 0xb9bec4, { y: 4.5 });
      hk.add(prism(44.6, 23, 4), 0x5d646d, { y: 11.3 });
      for (var d = 0; d < 4; d++) hk.add(box(5, 5.5, 0.12), 0x6d747c, { x: -15 + d * 10, y: 2.75, z: 11.03 });
      hk.add(box(42, 1.1, 0.1), 0x9fb6c8, { y: 8.2, z: 11.04 });
      hk.add(box(44.2, 0.5, 0.14), ctx.accent, { y: 9.4, z: 11.05 });
      var hall = ctx.kind('hall', [{ geo: hk.geo() }], { r: 25, prop: { slot: 'hall', box: { w: 46, d: 26, h: 24 } } });
      // Container (Farbe je Instanz), Rippen als dünne Leisten
      var ck = new Kit();
      ck.add(box(6.1, 2.6, 2.45), 0xffffff, { y: 1.3 });
      for (var r = 0; r < 9; r++) ck.add(box(0.12, 2.3, 2.5), 0xd9d9d9, { x: -2.6 + r * 0.65, y: 1.3 });
      ck.add(box(0.1, 2.4, 2.3), 0x9a9a9a, { x: 3.06, y: 1.3 });
      var cont = ctx.kind('container', [{ geo: ck.geo() }], { r: 3.4, tint: true, prop: { slot: 'container', box: { w: 6.3, d: 2.7, h: 2.9 } } });
      var ccol = [0xc0392b, 0x2563a8, 0x2e8b57, 0xe67e22, 0x7f8c8d, 0xd4ac0d];
      // Lampenmast mit Ausleger, Leuchte (leuchtend)
      var lk = new Kit(), lg = new Kit();
      lk.add(cyl(0.12, 0.18, 10, 6), 0x8d939b, { y: 5 });
      lk.add(box(2.4, 0.15, 0.15), 0x8d939b, { x: -1.1, y: 9.9 });
      lg.add(box(0.9, 0.18, 0.45), 0xfff3cf, { x: -2.1, y: 9.75 });
      var lamp = ctx.kind('lamp', [{ geo: lk.geo() }, { geo: lg.geo(), mat: 'glow' }], { r: 1.2 });

      // Hallen mit Hof davor (bis zu 4: jede Lagerhalle aus den Kulissen-Modellen bekommt einen Platz), Containerstapel, Lampen
      var nh = 0;
      for (var tr = 0; tr < 300 && nh < 4; tr++) {
        var o = ctx.randomSpot(40, 110);
        if (!o || !ctx.place(o.x, o.z, 25)) continue;
        var rot = Math.round(o.rot / (Math.PI / 2)) * (Math.PI / 2);
        hall.add(o.x, o.z, { rot: rot }); nh++;
        yards.push({ x: o.x, z: o.z, r: rot, w: 34, d: 24 });
      }
      var nc = 0;
      for (var tc = 0; tc < 600 && nc < 14; tc++) {
        var oc = ctx.randomSpot(18, 95);
        if (!oc || !ctx.place(oc.x, oc.z, 7)) continue;
        var rc = Math.round(oc.rot / (Math.PI / 2)) * (Math.PI / 2) + (rnd() < 0.2 ? Math.PI / 2 : 0);
        var cols = 1 + Math.floor(rnd() * 3), sn = Math.sin(rc), cs = Math.cos(rc);
        for (var q = 0; q < cols; q++) {
          var oz = (q - (cols - 1) / 2) * 2.55, lv = rnd() < 0.45 ? 2 : 1;
          for (var l = 0; l < lv; l++) cont.add(oc.x + oz * sn, oc.z + oz * cs, { rot: rc, y: l * 2.6, tint: ccol[Math.floor(rnd() * ccol.length)] });
        }
        yards.push({ x: oc.x, z: oc.z, r: rc, w: 5, d: 5 });
        nc++;
      }
      // Container-Gruppen (nur als Kulissen-Modell, slot containerPile): ein paar Plätze auf eigenem Hof
      var pile = ctx.kind('containerPile', [], { r: 10, prop: { slot: 'containerPile', box: { w: 20, d: 13, h: 7 } } });
      for (var tp = 0, np = 0; tp < 300 && np < 3; tp++) {
        var op = ctx.randomSpot(24, 90);
        if (!op || !ctx.place(op.x, op.z, 11)) continue;
        var rp = Math.round(op.rot / (Math.PI / 2)) * (Math.PI / 2);
        pile.add(op.x, op.z, { rot: rp }); np++;
        yards.push({ x: op.x, z: op.z, r: rp, w: 11, d: 8 });
      }
      for (var s2 = 10; s2 < ctx.T.len; s2 += 38) {
        var a = ctx.T.at(s2), sd = (Math.floor(s2 / 38) % 2) ? 1 : -1, off = ctx.HALF + 16.5;
        var lx = a.x + a.nx * sd * off, lz = a.z + a.nz * sd * off;
        if (ctx.place(lx, lz, 1.2)) lamp.add(lx, lz, { rot: a.yaw + (sd > 0 ? -Math.PI / 2 : Math.PI / 2) });
      }
      ctx.scatter(ctx.kind('rock', [{ geo: rockGeo(0x6f706b, 0x8d8e88) }], { r: 1.2 }), 18, { dmin: 15, dmax: 100, rad: 1.2, s: [0.4, 0.9] });
      // Hintergrund: Fabrikhallen (dieselbe Art wie die Hallen am Hof → Kulissen-Modelle statt grauer Klötze),
      // Schornsteine (rot-weiß), Silos
      var bg = new Kit();
      for (var i = 0; i < 40; i++) {
        var aa = rnd() * TAU, R = ctx.radius + 230 + rnd() * 420, bx = ctx.cx + Math.cos(aa) * R, bz = ctx.cz + Math.sin(aa) * R;
        var w = 30 + rnd() * 60, h = 12 + rnd() * 26, kind = rnd();
        if (kind < 0.55) hall.add(bx, bz, { rot: aa, s: Math.max(0.8, Math.min(1.8, w / 44)) });
        else if (kind < 0.8) {
          var ch = 45 + rnd() * 40;
          bg.add(cyl(1.8, 2.6, ch, 8), function (x, y) { return Math.floor(y / 7) % 2 ? 0xd8262b : 0xeeeeee; }, { x: bx, y: ch / 2, z: bz });
        } else {
          for (var si = 0; si < 3; si++) bg.add(cyl(5, 5, 22, 10), 0xa9b0b8, { x: bx + si * 11, y: 11, z: bz });
        }
      }
      ctx.bg(bg);
    }
  };

  var BY_LAYOUT = { Speedway: 'stadium', Twister: 'forest', Hairpin: 'alpine', Coast: 'coast', Kart: 'industrial' };
  function forTrack(T) { return THEMES[BY_LAYOUT[T && T.name] || 'stadium']; }

  root.CarTrackThemes = { forTrack: forTrack, THEMES: THEMES, BY_LAYOUT: BY_LAYOUT, Kit: Kit, lin: lin, mix: mix, smooth: smooth, fbm: fbm, tyreStack: tyreStack, Relief: Relief, ranges: ranges };
})(typeof window !== 'undefined' ? window : this);
