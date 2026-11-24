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
 *     (Material mit vertexColors, flatShading → Spielzeug-Look; je Deko-Art ein InstancedMesh = ein Zeichenaufruf);
 *     optional mit Atlas-Kachel je Teil (Fassade, Werbung, Graffiti).
 *   CarTrackThemes.Art – ein Atlas (Canvas zur Laufzeit) für Fassaden, Fantasie-Sponsoren und Graffiti, dazu das
 *     passende Material (Kachel je Ecke/Instanz) und paint() für einfarbige Kulissen-Modelle (Katalog-Feld paint).
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
  // chunks: Teile mit Atlas-Kachel (Art) – { at (erste Ecke), n, uv, keep (je Dreieck), tile, vary, mode }
  function Kit() { this.pos = []; this.col = []; this.chunks = []; }
  // geo wird übernommen (danach freigegeben); color: Farbe oder f(x, y, z) → Farbe (Koordinaten nach o-Transformation);
  // o: { x, y, z, rx, ry, rz, s | sx, sy, sz, jit (Verbeulen in m, je Ecke fest) }
  // Atlas (Art, Material mat 'atl' bzw. Art.material): o.tile = Kachel-Name (Art.TILES) → Textur auf diesem Teil, Farbe
  //   multipliziert; o.uv: 'geo' (UV der Grundform auf die Kachel, Standard), 'box' (Projektion nach Flächen-Normale,
  //   o.m Meter je Wiederholung, Schrift von außen lesbar), 'cyl' (rund um die Teil-Achse, o.reps Wiederholungen, o.m
  //   Meter je Wiederholung in der Höhe); o.faces(nx, ny, nz) → nur diese Flächen; o.uvK = [ku, kv] Streckung um die
  //   Mitte (> 1: Motiv kleiner als die Fläche); o.vary: Kachel je Instanz wechseln (Art.material vary, Instanz-Wert iVar)
  Kit.prototype.add = function (geo, color, o) {
    o = o || {};
    var g = geo.index ? geo.toNonIndexed() : geo, s = o.s || 1;
    var m = new THREE.Matrix4().compose(new THREE.Vector3(o.x || 0, o.y || 0, o.z || 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ')),
      new THREE.Vector3(o.sx || s, o.sy || s, o.sz || s));
    var p = g.attributes.position, v = new THREE.Vector3(), fixed = typeof color === 'function' ? null : lin(color);
    var at = this.pos.length / 3, lp = o.tile && o.uv === 'cyl' ? [] : null;
    for (var i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (o.jit) {
        var hx = Math.round(v.x * 1000), hy = Math.round(v.y * 1000), hz = Math.round(v.z * 1000);
        v.x += (hash3(hx, hy, hz) - 0.5) * o.jit; v.y += (hash3(hy, hz, hx) - 0.5) * o.jit; v.z += (hash3(hz, hx, hy) - 0.5) * o.jit;
      }
      if (lp) lp.push(v.x, v.y, v.z);
      v.applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      var c = fixed || lin(color(v.x, v.y, v.z));
      this.col.push(c.r, c.g, c.b);
    }
    if (o.tile && Art.TILES[o.tile]) this.chunks.push(artChunk(this.pos, at, p.count, g.attributes.uv, lp, o));
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  };
  // einzelnes Dreieck (Ecken [x, y, z]); optional Atlas: uvs = [[u, v] × 3], tile (Name), mode (siehe Art.material)
  Kit.prototype.tri = function (A, B, C, color, uvs, tile, mode) {
    var c = lin(color), at = this.pos.length / 3;
    for (var k = 0; k < 3; k++) { var q = [A, B, C][k]; this.pos.push(q[0], q[1], q[2]); this.col.push(c.r, c.g, c.b); }
    if (uvs && Art.TILES[tile]) {
      this.chunks.push({ at: at, n: 3, uv: [uvs[0][0], uvs[0][1], uvs[1][0], uvs[1][1], uvs[2][0], uvs[2][1]], keep: [1], tile: Art.TILES[tile], vary: false, mode: mode || 0 });
    }
    return this;
  };
  // anderes Kit anhängen (Hintergrund: alles in eine Geometrie)
  Kit.prototype.merge = function (k) {
    var off = this.pos.length / 3;
    Array.prototype.push.apply(this.pos, k.pos); Array.prototype.push.apply(this.col, k.col);
    for (var i = 0; i < k.chunks.length; i++) { var c = k.chunks[i], d = {}; for (var f in c) d[f] = c[f]; d.at += off; this.chunks.push(d); }
    return this;
  };
  Kit.prototype.tiled = function () { return this.chunks.length > 0; };
  Kit.prototype.geo = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.chunks.length) {
      // Ecken ohne Kachel: aTile = 0 → keine Textur (nur Ecken-Farbe)
      var nv = this.pos.length / 3, UV = new Float32Array(nv * 2), TL = new Float32Array(nv * 4), ST = new Float32Array(nv * 4);
      this.chunks.forEach(function (c) {
        var r = c.tile.r, st = c.tile.step;
        for (var t = 0; t < c.n; t += 3) {
          if (!c.keep[t / 3]) continue;
          for (var k = 0; k < 3; k++) {
            var j = c.at + t + k;
            UV[j * 2] = c.uv[(t + k) * 2]; UV[j * 2 + 1] = c.uv[(t + k) * 2 + 1];
            TL[j * 4] = r[0]; TL[j * 4 + 1] = r[1]; TL[j * 4 + 2] = r[2]; TL[j * 4 + 3] = r[3];
            ST[j * 4] = c.vary ? st[0] : 0; ST[j * 4 + 1] = c.vary ? st[1] : 0; ST[j * 4 + 2] = c.vary ? st[2] : 1; ST[j * 4 + 3] = c.mode;
          }
        }
      });
      g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
      g.setAttribute('aTile', new THREE.BufferAttribute(TL, 4));
      g.setAttribute('aStep', new THREE.BufferAttribute(ST, 4));
    }
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  };
  Kit.prototype.empty = function () { return !this.pos.length; };
  // Atlas-UVs für ein eben eingefügtes Teil (Kit.add): je Dreieck Normale, Filter, UV nach o.uv
  function artChunk(pos, at, cnt, uvAttr, lp, o) {
    var mode = o.uv || (uvAttr ? 'geo' : 'box'), M = o.m || 4, ku = o.uvK ? o.uvK[0] : 1, kv = o.uvK ? o.uvK[1] : 1;
    var U = new Float32Array(cnt * 2), keep = new Uint8Array(Math.ceil(cnt / 3)), reps = o.reps || 4;
    for (var t = 0; t + 2 < cnt; t += 3) {
      var a = (at + t) * 3, b = a + 3, c = a + 6;
      var ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      var vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      if (o.faces && !o.faces(nx, ny, nz)) continue;
      keep[t / 3] = 1;
      var ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      for (var k = 0; k < 3; k++) {
        var j = (at + t + k) * 3, x = pos[j], y = pos[j + 1], z = pos[j + 2], u, v;
        if (mode === 'geo') { u = (uvAttr.getX(t + k) - 0.5) * ku + 0.5; v = (uvAttr.getY(t + k) - 0.5) * kv + 0.5; }
        else if (mode === 'cyl') { u = Math.atan2(lp[(t + k) * 3 + 2], lp[(t + k) * 3]) / TAU; v = y / M; }
        else if (ay >= ax && ay >= az) { u = x / M; v = (ny > 0 ? -z : z) / M; }
        else if (ax >= az) { u = (nx > 0 ? -z : z) / M; v = y / M; }
        else { u = (nz > 0 ? x : -x) / M; v = y / M; }
        U[(t + k) * 2] = u; U[(t + k) * 2 + 1] = v;
      }
      if (mode === 'cyl') {   // Naht: Dreieck über ±½ Umlauf → zusammenziehen, dann auf reps Wiederholungen
        var i0 = t * 2, us = [U[i0], U[i0 + 2], U[i0 + 4]];
        if (Math.max.apply(null, us) - Math.min.apply(null, us) > 0.5) for (k = 0; k < 3; k++) if (U[i0 + k * 2] < 0) U[i0 + k * 2] += 1;
        for (k = 0; k < 3; k++) U[i0 + k * 2] *= reps;
      }
    }
    return { at: at, n: cnt, uv: U, keep: keep, tile: Art.TILES[o.tile], vary: !!o.vary, mode: mode === 'geo' ? 1 : 0 };
  }
  // ---- Art: ein Atlas für Fassaden, Werbung und Graffiti (Canvas, zur Laufzeit gezeichnet, seitenweit geteilt) ----
  // 2048 × 1024: links 4 × 4 Fassaden-Kacheln à 256² (kachelbar), rechts oben 8 Werbeflächen à 512 × 128 (frei
  // erfundene Sponsoren), rechts unten 6 Graffiti à 341 × 256 (durchsichtiger Grund). Ein Material-Typ für alles
  // (Art.material): je Ecke Kachel (aTile = u0, v0, du, dv) und Modus (aStep.w: 0 = wiederholen, 1 = einmal, Rand
  // durchsichtig; 2 = waagrecht wiederholen, senkrecht einmal), Farbe = Ecken-Farbe × Textur (wo die Textur durchsichtig ist: nur Ecken-Farbe). vary: Kachel je
  // Instanz (InstancedBufferAttribute iVar → Spalte/Zeile über aStep.xyz). Keine Kachel (aTile = 0): nur Ecken-Farbe.
  var AW = 2048, AH = 1024;
  var Art = { TILES: {}, ADS: 8, TAGS: 6 };
  (function () {
    function t(name, x, y, w, h, inset, step) {
      Art.TILES[name] = { r: [(x + inset) / AW, 1 - (y + h - inset) / AH, (w - 2 * inset) / AW, (h - 2 * inset) / AH], step: step || [0, 0, 1], px: [x, y, w, h] };
    }
    ['concrete', 'office', 'corrugated', 'rust', 'brick', 'brickWin', 'roof', 'silo', 'crowd', 'seats', 'door', 'wood', 'grime', 'glassBand', 'panel', 'glass']
      .forEach(function (n, i) { t(n, (i % 4) * 256, Math.floor(i / 4) * 256, 256, 256, 1); });
    for (var k = 0; k < Art.ADS; k++) t('ad' + k, 1024 + (k % 2) * 512, Math.floor(k / 2) * 128, 512, 128, 0, [512 / AW, -128 / AH, 2]);
    for (k = 0; k < Art.TAGS; k++) t('tag' + k, 1024 + (k % 3) * 341, 512 + Math.floor(k / 3) * 256, 341, 256, 0, [341 / AW, -256 / AH, 3]);
    Art.TILES.ad = Art.TILES.ad0; Art.TILES.tag = Art.TILES.tag0;
  })();
  // fester Zufall fürs Zeichnen (unabhängig von der Strecke)
  function xr(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  // Fantasie-Sponsoren (keine echten Marken): Name, Grund, Schrift, Logo
  var SPONSORS = [
    ['PURPLE PEAK', '#5e2a79', '#f2b705', 'peak'], ['GOLDEN LAP', '#f2b705', '#3b1650', 'flag'],
    ['HYPERNOODLE', '#121417', '#7cf26a', 'bolt'], ['TURBO TACO', '#ff7a1a', '#fff3c4', 'taco'],
    ['ZEPHYR FUEL', '#1f5fae', '#ffffff', 'drop'], ['PIXEL PISTON', '#f4f4f2', '#1d2230', 'pixel'],
    ['COMET COLA', '#c8102e', '#ffffff', 'comet'], ['GRIPWORX', '#0f4c4a', '#e9fbf5', 'tread']
  ];
  var TAG_WORDS = ['VROOM', 'BOOST', 'GG', 'KART', 'NITRO', 'WOW'];
  var TAG_COLS = [['#ff3fa4', '#ffd23f'], ['#3fd0ff', '#7b5cff'], ['#f2b705', '#ff5e3a'], ['#7cf26a', '#1fb8a6'], ['#b06cff', '#ff8adf'], ['#ffef5a', '#ff7a1a']];
  function drawAtlas(g) {
    var R = xr(4711);
    function clip(x, y, w, h, fn) { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); fn(); g.restore(); }
    function speck(x, y, w, h, n, a) {
      for (var i = 0; i < n; i++) { var k = R() - 0.5; g.fillStyle = (k > 0 ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + (Math.abs(k) * a).toFixed(3) + ')'; g.fillRect(x + R() * w, y + R() * h, 1 + R() * 2, 1 + R() * 2); }
    }
    function streaks(x, y, w, h, n, a) {
      for (var i = 0; i < n; i++) {
        var sx = x + R() * w, sw = 2 + R() * 8, sh = h * (0.2 + R() * 0.6), gr = g.createLinearGradient(0, y, 0, y + sh);
        gr.addColorStop(0, 'rgba(40,36,30,' + (a * (0.5 + R())).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(40,36,30,0)');
        g.fillStyle = gr; g.fillRect(sx, y, sw, sh);
      }
    }
    function F(name, fn) { var p = Art.TILES[name].px; clip(p[0], p[1], p[2], p[3], function () { fn(p[0], p[1], p[2], p[3]); }); }
    function panes(x, y, w, h, lit) {   // Glas mit Spiegelung, Rahmen
      var gr = g.createLinearGradient(x, y, x + w * 0.6, y + h);
      gr.addColorStop(0, '#5f86a8'); gr.addColorStop(0.5, '#2e4c68'); gr.addColorStop(1, '#6f97b8');
      g.fillStyle = lit ? '#f1d59a' : gr; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(x + w * 0.15, y + h); g.lineTo(x + w * 0.55, y); g.lineTo(x + w * 0.75, y); g.lineTo(x + w * 0.35, y + h); g.fill();
      g.strokeStyle = '#22272e'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    }
    function ribs(x, y, w, h, base, light, dark, step) {
      g.fillStyle = base; g.fillRect(x, y, w, h);
      for (var i = 0; i < w; i += step) {
        var gr = g.createLinearGradient(x + i, 0, x + i + step, 0);
        gr.addColorStop(0, light); gr.addColorStop(0.45, base); gr.addColorStop(0.55, dark); gr.addColorStop(1, base);
        g.fillStyle = gr; g.fillRect(x + i, y, step, h);
      }
    }
    function bricks(x, y, w, h) {
      g.fillStyle = '#b3a897'; g.fillRect(x, y, w, h);
      for (var r = 0; r < h / 16; r++) for (var c = -1; c < w / 32 + 1; c++) {
        var bx = x + c * 32 + (r % 2) * 16, l = 0.8 + R() * 0.35;
        g.fillStyle = 'rgb(' + Math.round(150 * l) + ',' + Math.round(72 * l) + ',' + Math.round(52 * l) + ')'; g.fillRect(bx + 1, y + r * 16 + 1, 30, 13);
      }
    }
    // Fassaden
    F('concrete', function (x, y, w, h) {
      g.fillStyle = '#bdbab2'; g.fillRect(x, y, w, h); speck(x, y, w, h, 2600, 0.22);
      for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
        g.fillStyle = 'rgba(0,0,0,' + (0.03 + R() * 0.05).toFixed(3) + ')'; g.fillRect(x + i * 128, y + j * 128, 128, 128);
        for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) { g.fillStyle = 'rgba(60,58,54,0.5)'; g.beginPath(); g.arc(x + i * 128 + 24 + a * 40, y + j * 128 + 24 + b * 40, 2.2, 0, TAU); g.fill(); }
      }
      g.fillStyle = '#6f6c66'; g.fillRect(x, y, w, 2); g.fillRect(x, y + 127, w, 2); g.fillRect(x, y, 2, h); g.fillRect(x + 127, y, 2, h);
      streaks(x, y, w, h, 7, 0.12);
    });
    F('office', function (x, y, w, h) {
      g.fillStyle = '#cfccc4'; g.fillRect(x, y, w, h); speck(x, y, w, h, 1200, 0.15);
      for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) panes(x + c * 64 + 8, y + r * 64 + 12, 48, 40, R() < 0.12);
      for (r = 0; r < 4; r++) { g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(x, y + r * 64 + 54, w, 3); }
    });
    F('corrugated', function (x, y, w, h) { ribs(x, y, w, h, '#a9b2ba', '#d3dbe2', '#7e8890', 16); speck(x, y, w, h, 900, 0.12); var gr = g.createLinearGradient(0, y + h * 0.7, 0, y + h); gr.addColorStop(0, 'rgba(70,60,45,0)'); gr.addColorStop(1, 'rgba(70,60,45,0.25)'); g.fillStyle = gr; g.fillRect(x, y, w, h); });
    F('rust', function (x, y, w, h) {
      ribs(x, y, w, h, '#7a6656', '#9c8574', '#4f4036', 16);
      for (var i = 0; i < 40; i++) { g.fillStyle = 'rgba(' + (140 + R() * 50 | 0) + ',' + (70 + R() * 30 | 0) + ',30,' + (0.15 + R() * 0.25).toFixed(2) + ')'; g.beginPath(); g.arc(x + R() * w, y + R() * h, 4 + R() * 16, 0, TAU); g.fill(); }
      streaks(x, y, w, h, 10, 0.18);
    });
    F('brick', function (x, y, w, h) { bricks(x, y, w, h); speck(x, y, w, h, 1500, 0.2); streaks(x, y, w, h, 5, 0.1); });
    F('brickWin', function (x, y, w, h) {
      bricks(x, y, w, h); speck(x, y, w, h, 1000, 0.18);
      [24, 140].forEach(function (wx) {
        g.fillStyle = '#7e7466'; g.fillRect(x + wx - 4, y + 36, 100, 8);
        g.fillStyle = '#2b3138'; g.fillRect(x + wx, y + 44, 92, 150);
        for (var r = 0; r < 5; r++) for (var c = 0; c < 4; c++) panes(x + wx + 3 + c * 22, y + 47 + r * 29, 21, 28, R() < 0.06);
      });
    });
    F('roof', function (x, y, w, h) {
      g.fillStyle = '#4c525a'; g.fillRect(x, y, w, h); speck(x, y, w, h, 1800, 0.18);
      for (var i = 0; i < w; i += 32) { g.fillStyle = '#6a7179'; g.fillRect(x + i, y, 3, h); g.fillStyle = '#353a40'; g.fillRect(x + i + 3, y, 2, h); }
    });
    F('silo', function (x, y, w, h) {
      ribs(x, y, w, h, '#c4c9ce', '#dde2e6', '#a3a9af', 32);
      for (var r = 0; r < h; r += 64) { g.fillStyle = '#8c939a'; g.fillRect(x, y + r, w, 5); for (var c = 4; c < w; c += 16) { g.fillStyle = '#6f767d'; g.fillRect(x + c, y + r + 9, 3, 3); } }
      streaks(x, y, w, h, 8, 0.2);
      for (var i = 0; i < 6; i++) { g.fillStyle = 'rgba(150,80,30,0.25)'; g.fillRect(x + R() * w, y + R() * h, 3, 20 + R() * 40); }
    });
    var shirts = ['#e04848', '#3a86ff', '#ffbe0b', '#f2f2f2', '#8338ec', '#2ec4b6', '#fb5607', '#222831', '#5e2a79', '#f2b705'];
    var skins = ['#f1c7a5', '#d9a07a', '#a8714e', '#7a4a2e', '#f5d6bd'];
    F('crowd', function (x, y, w, h) {
      for (var r = 0; r < 4; r++) {
        var ry = y + r * 64;
        g.fillStyle = r % 2 ? '#4b2163' : '#5e2a79'; g.fillRect(x, ry, w, 64);
        g.fillStyle = '#2b1238'; g.fillRect(x, ry + 56, w, 8);
        for (var c = 0; c < 8; c++) {
          var cx = x + c * 32 + 16 + (R() - 0.5) * 6;
          if (R() < 0.22) { g.fillStyle = r % 2 ? '#6a3389' : '#7a3d9c'; g.fillRect(cx - 11, ry + 26, 22, 30); continue; }
          g.fillStyle = shirts[Math.floor(R() * shirts.length)]; g.fillRect(cx - 12, ry + 30, 24, 26);
          g.fillStyle = skins[Math.floor(R() * skins.length)]; g.beginPath(); g.arc(cx, ry + 20, 8.5, 0, TAU); g.fill();
          if (R() < 0.3) { g.fillStyle = shirts[Math.floor(R() * shirts.length)]; g.fillRect(cx - 9, ry + 9, 18, 6); }   // Mütze
          if (R() < 0.15) { g.fillStyle = '#f2b705'; g.fillRect(cx + 10, ry + 4, 4, 22); }   // Fähnchen
        }
      }
      speck(x, y, w, h, 800, 0.12);
    });
    F('seats', function (x, y, w, h) {
      for (var r = 0; r < 4; r++) for (var c = 0; c < 8; c++) {
        var ry = y + r * 64; g.fillStyle = '#3d4249'; g.fillRect(x + c * 32, ry, 32, 64);
        g.fillStyle = (c + r) % 5 === 0 ? '#f2b705' : '#5e2a79'; g.fillRect(x + c * 32 + 3, ry + 14, 26, 34);
        g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x + c * 32 + 3, ry + 14, 26, 5);
      }
    });
    F('door', function (x, y, w, h) {
      g.fillStyle = '#9aa1a8'; g.fillRect(x, y, w, h);
      for (var i = 0; i < h; i += 10) { g.fillStyle = '#b8bec4'; g.fillRect(x, y + i, w, 4); g.fillStyle = '#7b828a'; g.fillRect(x, y + i + 8, w, 2); }
      g.fillStyle = '#f2b705'; for (i = 0; i < w; i += 32) { g.fillRect(x + i, y + h - 14, 16, 14); }
      streaks(x, y, w, h, 5, 0.1);
    });
    F('wood', function (x, y, w, h) {
      for (var i = 0; i < w; i += 32) {
        var l = 0.85 + R() * 0.3; g.fillStyle = 'rgb(' + Math.round(130 * l) + ',' + Math.round(92 * l) + ',' + Math.round(60 * l) + ')'; g.fillRect(x + i, y, 32, h);
        g.fillStyle = 'rgba(40,25,15,0.5)'; g.fillRect(x + i, y, 2, h);
        for (var k = 0; k < 6; k++) { g.fillStyle = 'rgba(60,40,20,0.25)'; g.fillRect(x + i + 4 + R() * 24, y, 1, h); }
      }
    });
    F('grime', function (x, y, w, h) {
      g.fillStyle = '#8e8b84'; g.fillRect(x, y, w, h); speck(x, y, w, h, 3000, 0.3); streaks(x, y, w, h, 14, 0.25);
      g.fillStyle = '#5d5a55'; g.fillRect(x, y + 126, w, 3); g.fillRect(x + 84, y, 3, h); g.fillRect(x + 170, y, 3, h);
    });
    F('glassBand', function (x, y, w, h) { g.fillStyle = '#2b3138'; g.fillRect(x, y, w, h); for (var c = 0; c < 8; c++) panes(x + c * 32 + 2, y + 8, 28, h - 16, R() < 0.08); });
    F('panel', function (x, y, w, h) {
      g.fillStyle = '#dfe2e6'; g.fillRect(x, y, w, h); speck(x, y, w, h, 900, 0.1);
      for (var r = 0; r < h; r += 64) { g.fillStyle = '#9ea4ab'; g.fillRect(x, y + r, w, 2); g.fillStyle = '#f4f6f8'; g.fillRect(x, y + r + 2, w, 2); }
      g.fillStyle = '#b8bdc3'; g.fillRect(x + 127, y, 2, h);
      streaks(x, y, w, h, 4, 0.06);
    });
    F('glass', function (x, y, w, h) { for (var r = 0; r < 2; r++) for (var c = 0; c < 2; c++) panes(x + c * 128, y + r * 128, 128, 128, false); });
    // Werbung (Rand 4 px durchsichtig: einmalig gemappt bleibt die Fläche drumherum in der Ecken-Farbe)
    function logo(kind, cx, cy, s, c1, c2) {
      g.save(); g.translate(cx, cy); g.fillStyle = c1; g.strokeStyle = c1; g.lineWidth = s * 0.12; g.lineJoin = 'round';
      g.beginPath();
      if (kind === 'peak') { g.moveTo(-s, s * 0.7); g.lineTo(-s * 0.2, -s * 0.8); g.lineTo(s * 0.2, -s * 0.1); g.lineTo(s * 0.5, -s * 0.5); g.lineTo(s, s * 0.7); g.fill(); }
      else if (kind === 'flag') { for (var i = 0; i < 4; i++) for (var j = 0; j < 3; j++) if ((i + j) % 2 === 0) g.rect(-s + i * s * 0.5, -s * 0.75 + j * s * 0.5, s * 0.5, s * 0.5); g.fill(); g.fillRect(-s - s * 0.12, -s * 0.75, s * 0.1, s * 1.8); }
      else if (kind === 'bolt') { g.moveTo(s * 0.2, -s); g.lineTo(-s * 0.6, s * 0.15); g.lineTo(-s * 0.05, s * 0.15); g.lineTo(-s * 0.3, s); g.lineTo(s * 0.6, -s * 0.2); g.lineTo(s * 0.05, -s * 0.2); g.closePath(); g.fill(); }
      else if (kind === 'taco') { g.arc(0, s * 0.3, s, Math.PI, 0); g.fill(); g.fillStyle = c2; g.beginPath(); g.arc(-s * 0.4, -s * 0.15, s * 0.18, 0, TAU); g.arc(s * 0.3, -s * 0.3, s * 0.15, 0, TAU); g.fill(); }
      else if (kind === 'drop') { g.moveTo(0, -s); g.quadraticCurveTo(s * 0.9, s * 0.1, 0, s * 0.9); g.quadraticCurveTo(-s * 0.9, s * 0.1, 0, -s); g.fill(); }
      else if (kind === 'pixel') { ['#e04848', '#3a86ff', '#f2b705', '#2ec4b6'].forEach(function (c, i) { g.fillStyle = c; g.fillRect(-s + (i % 2) * s, -s + Math.floor(i / 2) * s, s * 0.9, s * 0.9); }); }
      else if (kind === 'comet') { g.arc(s * 0.4, -s * 0.2, s * 0.45, 0, TAU); g.fill(); g.lineWidth = s * 0.16; [0.5, 0, -0.5].forEach(function (o) { g.beginPath(); g.moveTo(-s, s * (0.5 + o * 0.6)); g.lineTo(s * 0.1, s * o * 0.3); g.stroke(); }); }
      else if (kind === 'tread') { g.arc(0, 0, s, 0, TAU); g.fill(); g.fillStyle = c2; for (var k = 0; k < 8; k++) { g.save(); g.rotate(k * TAU / 8); g.fillRect(-s * 0.1, -s * 0.95, s * 0.2, s * 0.35); g.restore(); } g.beginPath(); g.arc(0, 0, s * 0.35, 0, TAU); g.fill(); }
      g.restore();
    }
    var FONT = '"DM Sans", "Arial Black", Arial, sans-serif';
    SPONSORS.forEach(function (sp, k) {
      var p = Art.TILES['ad' + k].px, x = p[0] + 4, y = p[1] + 4, w = p[2] - 8, h = p[3] - 8;
      g.fillStyle = sp[1]; g.fillRect(x, y, w, h);
      var gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgba(255,255,255,0.14)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.16)');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      logo(sp[3], x + 62, y + h / 2, 34, sp[2], sp[1]);
      g.fillStyle = sp[2]; g.textBaseline = 'middle'; g.textAlign = 'left';
      var fs = 64; g.font = '800 ' + fs + 'px ' + FONT;
      var tw = g.measureText(sp[0]).width, maxW = w - 140;
      if (tw > maxW) { fs = Math.floor(fs * maxW / tw); g.font = '800 ' + fs + 'px ' + FONT; tw = g.measureText(sp[0]).width; }
      g.fillText(sp[0], x + 120 + (maxW - tw) / 2, y + h / 2 + 3);
    });
    // Graffiti: Wurf-Fläche (Blase) hinter dicken, umrandeten Buchstaben, Glanzpunkte, Tropfen
    TAG_WORDS.forEach(function (word, k) {
      var p = Art.TILES['tag' + k].px, cx = p[0] + p[2] / 2, cy = p[1] + p[3] / 2, cs = TAG_COLS[k];
      clip(p[0] + 4, p[1] + 4, p[2] - 8, p[3] - 8, function () {
        g.save(); g.translate(cx, cy); g.rotate((R() - 0.5) * 0.16);
        var fs = word.length <= 2 ? 150 : 96; g.font = '900 ' + fs + 'px Impact, "Arial Black", ' + FONT;
        var tw = g.measureText(word).width, k2 = Math.min(1, (p[2] - 50) / tw); g.scale(k2, 1);
        if (k % 2 === 0) {   // Blase
          g.fillStyle = 'rgba(20,20,26,0.9)'; g.beginPath();
          for (var a = 0; a <= 24; a++) { var an = a / 24 * TAU, rr = 1 + (R() - 0.5) * 0.12; g.lineTo(Math.cos(an) * (tw / 2 + 26) * rr, Math.sin(an) * (fs * 0.62) * rr); }
          g.fill();
        }
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
        g.strokeStyle = '#141418'; g.lineWidth = 18; g.strokeText(word, 4, 6);
        g.lineWidth = 14; g.strokeStyle = '#ffffff'; g.strokeText(word, 0, 0);
        var gr = g.createLinearGradient(0, -fs / 2, 0, fs / 2); gr.addColorStop(0, cs[0]); gr.addColorStop(1, cs[1]);
        g.fillStyle = gr; g.fillText(word, 0, 0);
        g.fillStyle = 'rgba(255,255,255,0.75)';   // Glanz
        for (var s = 0; s < 4; s++) { g.beginPath(); g.arc((R() - 0.5) * tw * 0.8, -fs * 0.22 + (R() - 0.5) * 8, 3 + R() * 3, 0, TAU); g.fill(); }
        g.fillStyle = cs[1];   // Tropfen
        for (s = 0; s < 5; s++) { var dx = (R() - 0.5) * tw * 0.8, dl = 10 + R() * 30; g.fillRect(dx, fs * 0.3, 4, dl); g.beginPath(); g.arc(dx + 2, fs * 0.3 + dl, 3.5, 0, TAU); g.fill(); }
        g.restore();
        g.strokeStyle = cs[0]; g.lineWidth = 4;   // Sternchen
        for (s = 0; s < 3; s++) { var sx = p[0] + 20 + R() * (p[2] - 40), sy = p[1] + 18 + R() * 30, sl = 6 + R() * 6; g.beginPath(); g.moveTo(sx - sl, sy); g.lineTo(sx + sl, sy); g.moveTo(sx, sy - sl); g.lineTo(sx, sy + sl); g.stroke(); }
      });
    });
  }
  var atlasTex;
  Art.atlas = function () {
    if (atlasTex !== undefined) return atlasTex;
    atlasTex = null;
    if (!root.document) return null;
    try {
      var cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
      drawAtlas(cv.getContext('2d'));
      atlasTex = new THREE.CanvasTexture(cv);
      atlasTex.encoding = THREE.sRGBEncoding; atlasTex.anisotropy = 4;
      atlasTex.wrapS = atlasTex.wrapT = THREE.ClampToEdgeWrapping;
      atlasTex.trackBytes = AW * AH * 4 * 4 / 3;
    } catch (e) { atlasTex = null; }
    return atlasTex;
  };
  // Material mit Atlas: o = { side, roughness, metalness, flat, env, vary (Instanz-Kachel iVar), cut (Ausstanzen nach Alpha),
  //   inst (für Instanzen – eigenes Material, wie mat() in js/car-track-scene.js) }
  // seitenweit geteilt je Kombination (nicht freigeben)
  var artMats = {};
  var ART_FRAG = [
    '#ifdef USE_MAP',
    'if (vTile.z > 0.0) {',
    '  vec2 af = vec2(vAMode > 0.5 && vAMode < 1.5 ? clamp(vAtl.x, 0.0, 1.0) : fract(vAtl.x), vAMode > 0.5 ? clamp(vAtl.y, 0.0, 1.0) : fract(vAtl.y));',
    '  vec2 tuv = vTile.xy + af * vTile.zw;',
    '  #if __VERSION__ >= 300',
    // Mip-Stufe aus der ungebrochenen UV (keine Nähte am Kachelrand), höchstens ~32 Texel je Pixel (bleibt in der Kachel)
    '  vec2 gx = dFdx(vAtl) * vTile.zw, gy = dFdy(vAtl) * vTile.zw; float gm = max(length(gx), length(gy));',
    '  if (gm > 0.0156) { gx *= 0.0156 / gm; gy *= 0.0156 / gm; }',
    '  vec4 tx = textureGrad(map, tuv, gx, gy);',
    '  #else',
    '  vec4 tx = texture2D(map, tuv);',
    '  #endif',
    '  tx = mapTexelToLinear(tx);',
    '  diffuseColor.rgb *= mix(vec3(1.0), tx.rgb, tx.a);',
    '  #ifdef ART_CUT',
    '  diffuseColor.a *= tx.a;',
    '  #endif',
    '}',
    '#ifdef ART_CUT',
    'else { diffuseColor.a = 0.0; }',
    '#endif',
    '#endif'
  ].join('\n');
  Art.material = function (o) {
    o = o || {};
    var side = o.side == null ? THREE.FrontSide : o.side;
    var key = [side, o.roughness, o.metalness, !!o.flat, o.env, !!o.vary, !!o.cut, !!o.inst].join('|');
    if (artMats[key]) return artMats[key];
    var m = new THREE.MeshStandardMaterial({ vertexColors: true, map: Art.atlas(), roughness: o.roughness == null ? 0.85 : o.roughness, metalness: o.metalness || 0,
      flatShading: !!o.flat, envMapIntensity: o.env == null ? 0.5 : o.env, side: side, alphaTest: o.cut ? 0.5 : 0 });
    m.onBeforeCompile = function (sh) {
      sh.vertexShader = 'attribute vec4 aTile;\nattribute vec4 aStep;\nvarying vec4 vTile;\nvarying vec2 vAtl;\nvarying float vAMode;\n' +
        (o.vary ? 'attribute float iVar;\n' : '') +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTile = aTile; vAtl = uv; vAMode = aStep.w;\n' +
          (o.vary ? 'vTile.xy += vec2(mod(iVar, aStep.z) * aStep.x, floor(iVar / aStep.z + 0.001) * aStep.y);\n' : ''));
      sh.fragmentShader = (o.cut ? '#define ART_CUT\n' : '') + 'varying vec4 vTile;\nvarying vec2 vAtl;\nvarying float vAMode;\n' +
        sh.fragmentShader.replace('#include <map_fragment>', ART_FRAG);
    };
    m.customProgramCacheKey = function () { return 'track-art-' + (o.vary ? 'v' : '') + (o.cut ? 'c' : ''); };
    return (artMats[key] = m);
  };
  // Kachel je Instanz: Werte für iVar (Index in der Reihe der Kachel, z. B. ad0 … ad7)
  Art.setVary = function (geo, vals) { geo.setAttribute('iVar', new THREE.InstancedBufferAttribute(new Float32Array(vals), 1)); };

  // Einfarbige Kulissen-Modelle bemalen (Katalog-Feld paint): je Dreieck nach Normale (Modell-Koordinaten: Fuß y = 0,
  // Tribünen-Front −z) eine Kachel mit Box-Projektion; geo nicht indiziert, Farbe je Ecke (wird angelegt).
  // style: seats (Tribünen: Sitzflächen/Front Publikum, Rückseite Werbung, Seiten Beton), warehouse (Wände Wellblech,
  // Dach), pits (helle, graue Teile: Wände Paneele, Dach). → true, wenn etwas bemalt wurde
  Art.paint = function (geo, style, base, size, seed) {
    var p = geo.attributes.position, n = p.count, cnt = 0;
    if (!geo.attributes.color) {
      var cc = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) { cc[i * 3] = base.r; cc[i * 3 + 1] = base.g; cc[i * 3 + 2] = base.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    }
    var C = geo.attributes.color, UV = new Float32Array(n * 2), TL = new Float32Array(n * 4), ST = new Float32Array(n * 4);
    var ad = Art.TILES['ad' + (Math.abs(seed | 0) % Art.ADS)], H = size ? size.y : 5;
    var bandH = Math.min(2.4, Math.max(0.9, H * 0.3)), bandY = H * 0.55 - bandH / 2;
    for (var t = 0; t + 2 < n; t += 3) {
      var ax = p.getX(t), ay = p.getY(t), az = p.getZ(t);
      var ux = p.getX(t + 1) - ax, uy = p.getY(t + 1) - ay, uz = p.getZ(t + 1) - az, vx = p.getX(t + 2) - ax, vy = p.getY(t + 2) - ay, vz = p.getZ(t + 2) - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!(l > 1e-12)) continue;
      nx /= l; ny /= l; nz /= l;
      var r0 = C.getX(t), g0 = C.getY(t), b0 = C.getZ(t), lum = (r0 + g0 + b0) / 3, sat = Math.max(r0, g0, b0) - Math.min(r0, g0, b0);
      var tile = null, M = 4, col = 1, mode = 0, band = false;
      if (style === 'seats') {
        if (ny > 0.55 || nz < -0.55) { tile = 'crowd'; M = 2.4; }
        else if (nz > 0.55) { tile = 'ad'; band = true; col = 0.86; }
        else if (ny > -0.5) { tile = 'concrete'; col = 0.95; }
      } else if (style === 'warehouse') {
        if (ny > 0.5) { tile = 'roof'; M = 4; } else if (ny > -0.5) { tile = 'corrugated'; M = 3; }
      } else if (style === 'pits') {
        if (sat < 0.12 && lum > 0.35) { if (ny > 0.5) { tile = 'roof'; M = 4; } else if (ny > -0.5) { tile = 'panel'; M = 4; } }
      }
      if (!tile) continue;
      cnt++;
      var T = tile === 'ad' ? ad : Art.TILES[tile], aax = Math.abs(nx), aay = Math.abs(ny), aaz = Math.abs(nz);
      for (var k = 0; k < 3; k++) {
        var j = t + k, x = p.getX(j), y = p.getY(j), z = p.getZ(j), u, v;
        if (aay >= aax && aay >= aaz) { u = x / M; v = (ny > 0 ? -z : z) / M; }
        else if (aax >= aaz) { u = (nx > 0 ? -z : z) / M; v = y / M; }
        else { u = (nz > 0 ? x : -x) / M; v = y / M; }
        if (band) { u = (nz > 0 ? x : -x) / (bandH * 4); v = (y - bandY) / bandH; mode = 2; }
        UV[j * 2] = u; UV[j * 2 + 1] = v;
        TL[j * 4] = T.r[0]; TL[j * 4 + 1] = T.r[1]; TL[j * 4 + 2] = T.r[2]; TL[j * 4 + 3] = T.r[3];
        ST[j * 4 + 2] = 1; ST[j * 4 + 3] = mode;
        C.setXYZ(j, col, col, col);
      }
    }
    if (!cnt) return false;
    geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    geo.setAttribute('aTile', new THREE.BufferAttribute(TL, 4));
    geo.setAttribute('aStep', new THREE.BufferAttribute(ST, 4));
    C.needsUpdate = true;
    return true;
  };

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
  // Laubbaum (Ersatz für Kulissen-Modelle in Stadion/Kart): Stamm + zwei verbeulte Kronen-Kugeln, ~8 m
  // (in Kit k, bei x = ox, Größe s)
  function leafTree(k, ox, s) {
    k.add(cyl(0.22 * s, 0.34 * s, 3.4 * s, 6), 0x6b4a2f, { x: ox, y: 1.7 * s });
    k.add(ico(2.6 * s), function (x, y) { return mix(0x3f7a34, 0x5c9446, (y - 3.5 * s) / (4 * s)); }, { x: ox, y: 5.4 * s, sy: 0.85, jit: 0.8 });
    k.add(ico(1.7 * s), 0x4f8a3e, { x: ox + 1.2 * s, y: 6.9 * s, z: -0.4 * s, jit: 0.5 });
    return k;
  }
  // Laubbäume am Rand und im Hintergrund (Stadion, Kart): einzelne Bäume (slot parkTree) und Dreier-Reihen (slot
  // treeRow); prozedural Laubbäume, mit Kulissen-Modellen Eichen. Nie im Auslauf (scatter: ≥ 14 m + dmin)
  function leafTrees(ctx, nTree, nRow, dmin, dmax) {
    var lt = leafTree(new Kit(), 0, 1), row = new Kit();
    [-8.5, 0, 8.5].forEach(function (x, i) { leafTree(row, x, [0.9, 1.1, 0.95][i]); });
    var tree = ctx.kind('parkTree', [{ geo: lt.geo() }], { r: 3.2, prop: { slot: 'parkTree', box: { w: 15, d: 15, h: 12 } } });
    var rowK = ctx.kind('treeRow', [{ geo: row.geo() }], { r: 13, prop: { slot: 'treeRow', box: { w: 28, d: 12, h: 12 } } });
    ctx.scatter(tree, nTree, { dmin: dmin, dmax: dmax, rad: 3.5, s: [0.85, 1.2] });
    ctx.scatter(rowK, nRow, { dmin: dmin + 10, dmax: dmax + 20, rad: 13, s: [0.9, 1.1] });
  }
  // Gras-Büschel und Büsche (Kulissen-Modelle slot grass/bush; Ersatz: drei schräge Halme bzw. eine Kugel):
  // dicht hinter der Leitplanke und locker im Gelände. o = { grass (je m und Seite), bush, far (Büschel im Gelände),
  // farBush, pred, dry (Ersatzfarbe trocken) }
  function greenery(ctx, o) {
    var gk = new Kit(), gc = o.dry ? 0xb3a467 : 0x5d8a3c;
    [[0, 0.35], [2.1, -0.3], [4.2, 0.25]].forEach(function (b) { gk.add(cone(0.09, 0.7, 3), gc, { y: 0.32, ry: b[0], rx: b[1] }); });
    var grass = ctx.kind('grass', [{ geo: gk.geo() }], { r: 0.5, prop: { slot: 'grass', box: { w: 3, d: 3, h: 1.2 } } });
    var bk = new Kit();
    bk.add(ico(1), o.dry ? 0x8a8a4a : 0x3f6e32, { y: 0.7, sy: 0.75, jit: 0.35 });
    var bush = ctx.kind('bush', [{ geo: bk.geo() }], { r: 1.4, prop: { slot: 'bush', box: { w: 4, d: 4, h: 2.5 } } });
    ctx.scatterRail(grass, { perM: o.grass, extra: [0.2, 7], rad: 0.45, s: [0.7, 1.35], pred: o.pred });
    ctx.scatterRail(bush, { perM: o.bush, extra: [1, 9], rad: 1.3, s: [0.7, 1.2], pred: o.pred });
    if (o.far) ctx.scatter(grass, o.far, { dmin: 14, dmax: 45, rad: 0.45, s: [0.8, 1.4], pred: o.pred });
    if (o.farBush) ctx.scatter(bush, o.farBush, { dmin: 14, dmax: 60, rad: 1.3, s: [0.8, 1.3], pred: o.pred });
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
      // Werbebande: Rahmen + Fläche mit wechselnden Fantasie-Sponsoren (Atlas, Kachel je Instanz), hinter der Leitplanke
      var bd = new Kit();
      bd.add(box(6, 1.1, 0.12), 0xffffff, { y: 0.75, tile: 'ad', vary: true, faces: function (nx, ny, nz) { return Math.abs(nz) > 0.5; } });
      bd.add(box(6.1, 0.12, 0.16), 0x22252b, { y: 1.33 });
      bd.add(box(0.1, 1.5, 0.1), 0x22252b, { x: -2.9, y: 0.55 }); bd.add(box(0.1, 1.5, 0.1), 0x22252b, { x: 2.9, y: 0.55 });
      var board = ctx.kind('board', [{ geo: bd.geo(), mat: 'atl' }], { r: 3, vary: true });
      // Fahne: Mast + Tuch (weht im Wind, außer bei reduzierter Bewegung)
      var fp = new Kit(), fc = new Kit();
      fp.add(cyl(0.06, 0.09, 9, 5), 0xd8dde4, { y: 4.3 });
      fc.add(new THREE.PlaneGeometry(2.6, 1.5, 6, 2), 0xffffff, { x: 1.35, y: 7.9 });
      var flag = ctx.kind('flag', [{ geo: fp.geo(), notint: true }, { geo: fc.geo(), mat: 'wave' }], { r: 1.5, tint: true });
      // Boxengasse: flaches Boxengebäude mit Garagentoren und Dachstreifen
      var pt = new Kit();
      pt.add(box(48, 5, 10), 0xffffff, { y: 2.0, z: 5, tile: 'panel', uv: 'box', m: 4, faces: function (nx, ny, nz) { return Math.abs(ny) < 0.5; } });
      for (var gi = 0; gi < 10; gi++) pt.add(box(3.4, 3.2, 0.1), 0xd8dce0, { x: -21 + gi * 4.67, y: 1.6, z: -0.03, tile: 'door', faces: function (nx, ny, nz) { return nz < -0.5; } });
      pt.add(box(48.4, 0.5, 10.4), prim, { y: 4.75, z: 5 });
      pt.add(box(48.6, 0.3, 0.2), acc, { y: 4.1, z: -0.12 });
      pt.add(box(6, 3, 5), 0xe8eaee, { x: 14, y: 6.5, z: 5 });
      pt.add(box(6.2, 0.9, 0.1), 0x3a4a5e, { x: 14, y: 6.7, z: 2.45 });
      // Kulissen-Modell (slot pits): eine Box, als Boxenreihe nebeneinander, Tor nach vorn (−z, zur Boxengasse)
      var pits = ctx.kind('pits', [{ geo: pt.geo(), mat: 'atl' }], { r: 25, prop: { slot: 'pits', box: { w: 48, d: 14, h: 6 }, front: 0, tile: true } });

      // Plätze: Boxengebäude an der Startgeraden (Seite mit Platz), Tribünen an Geraden, Fahnen am Start
      var used = {};
      function along(s, sd, off) { var p = P(s); return { x: p.x + p.nx * sd * off, z: p.z + p.nz * sd * off, rot: p.yaw + (sd > 0 ? Math.PI : 0), p: p }; }
      function straightAt(s, span) { for (var k = -span; k <= span; k += 4) if (Math.abs(P(s + k).curv) > 1 / 70) return false; return true; }
      var pitSide = 0;
      [1, -1].some(function (sd) {
        var o = along(-30, sd, HALF + 12 + 4);
        // Tiefe 14 m: Platz für das Kulissen-Modell (Boxen sind tiefer als das prozedurale Gebäude)
        if (!ctx.clearRect(o.x, o.z, o.rot, 24.5, -0.5, 14) || !ctx.place(o.x, o.z, 12, true)) return false;
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
      // Werbebanden hinter der Leitplanke auf Geraden (beide Seiten): derselbe Sponsor 2–4 Banden lang, dann ein anderer
      // (eigener Zufall – die Deko danach bleibt, wo sie war)
      var adR = ctx.rng(77), adK = Math.floor(adR() * 8), adRun = 0;
      function nextAd() { if (adRun-- <= 0) { adK = (adK + 1 + Math.floor(adR() * 6)) % 8; adRun = 1 + Math.floor(adR() * 3); } return adK; }
      [1, -1].forEach(function (sd) {
        for (var s2 = 0; s2 < L; s2 += 7) {
          if (!straightAt(s2, 4)) continue;
          var a2 = P(s2), run = sd > 0 ? a2.runL : a2.runR, off = HALF + run + 1.5;
          var x = a2.x + a2.nx * sd * off, z = a2.z + a2.nz * sd * off;
          if (ctx.trackDist(x, z, off + 2) < off - 0.5) continue;   // anderer Streckenteil zu nah
          if (!ctx.place(x, z, 2.6, true)) continue;
          board.add(x, z, { rot: a2.yaw, v: nextAd() });
        }
      });
      leafTrees(ctx, 10, 4, 30, 120);
      greenery(ctx, { grass: 0.14, bush: 0.012, far: 120, farBush: 14 });
      // Hintergrund: Oberrang rund um das Stadion (Schüssel) – N Plätze einer Art (slot upper: Tribünen-Modelle, kleine
      // nebeneinander), Ersatz: geneigter Rang mit Zuschauerpunkten und Dachkante (lokal: +z vom Stadion weg)
      var R = ctx.radius + 170, N = 56, w = TAU * R / N * 1.02, up = new Kit();
      up.add(box(w, 16, 18), function (x, y) { return y > 14 ? 0x5a5f69 : hash3(x * 3, y * 3, 0) > 0.5 ? crowd[Math.floor(hash3(x, y, 1) * crowd.length)] : 0x7c8290; },
        { y: 6, rx: 0.32 });
      up.add(box(w, 1.2, 14), prim, { y: 18, z: 6 });
      var upper = ctx.kind('upper', [{ geo: up.geo() }], { r: w / 2, prop: { slot: 'upper', box: { w: w, d: 20, h: 22 }, front: -9, tile: true } });
      for (var i = 0; i < N; i++) {
        var am = (i + 0.5) / N * TAU;
        upper.add(ctx.cx + Math.cos(am) * R, ctx.cz + Math.sin(am) * R * 0.8, { rot: Math.PI / 2 - am });
      }
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
      // nahe Bäume als Kulissen-Modelle (slot forestTree: Nadel-, Birken-, Eichen-Modelle im Wechsel; Ersatz: Nadelbaum)
      var treeN = ctx.kind('tree', [{ geo: pineGeo(false) }], { r: 2.2, tint: true, prop: { slot: 'forestTree', box: { w: 11, d: 11, h: 15 } } });
      ctx.scatter(treeN, 70, { dmin: 15, dmax: 50, rad: 2.2, s: [0.8, 1.3], pred: offCreek, tint: green });
      ctx.scatter(pine, 200, { dmin: 15, dmax: 80, rad: 1.8, s: [0.8, 1.5], pred: offCreek, tint: green });
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
      greenery(ctx, { grass: 0.22, bush: 0.02, far: 220, farBush: 30, pred: offCreek });
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
      // nahe Bäume als Kulissen-Modelle (slot alpineTree: Kiefer, Pappel, Nadelbäume aus dem Wald; Ersatz: Nadelbaum)
      var treeN = ctx.kind('tree', [{ geo: pineGeo(true) }], { r: 2, tint: true, prop: { slot: 'alpineTree', box: { w: 10, d: 10, h: 16 } } });
      ctx.scatter(treeN, 60, { dmin: 15, dmax: 70, rad: 2, s: [0.8, 1.3], tint: function () { return mix(0xffffff, 0xbfd0c0, rnd()); } });
      ctx.scatter(pine, 170, { dmin: 15, dmax: 240, rad: 2, s: [0.8, 1.5], tint: function () { return mix(0xffffff, 0xbfd0c0, rnd()); } });
      ctx.scatter(ctx.kind('rock', [{ geo: rockGeo(0x77756f, 0xa5a39b) }], { r: 1.6 }), 55, { dmin: 15, dmax: 140, rad: 1.6, s: [0.6, 1.8] });
      var hk = new Kit();
      hk.add(box(7, 5, 6), 0x8a5a33, { y: 1.0 });
      hk.add(box(7.2, 0.4, 0.1), 0x5e3c20, { y: 1.8, z: 3.02 });
      hk.add(prism(8.2, 7.6, 2.8), 0x5b4a44, { y: 4.85 });
      hk.add(box(1.2, 1, 0.1), 0xdfe8f0, { x: -1.8, y: 2.2, z: 3.03 }); hk.add(box(1.2, 1, 0.1), 0xdfe8f0, { x: 1.8, y: 2.2, z: 3.03 });
      hk.add(box(0.6, 2, 0.6), 0x77736d, { x: 2.2, y: 5.6, z: -1 });
      ctx.scatter(ctx.kind('hut', [{ geo: hk.geo() }], { r: 5, prop: { slot: 'hut', box: { w: 12, d: 12, h: 12 } } }), 4, { dmin: 26, dmax: 110, rad: 5.5, s: [0.9, 1.1] });
      greenery(ctx, { grass: 0.16, bush: 0.012, far: 160, farBush: 16 });
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
      // Kulissen-Modelle (slot palm): Palmen-Modelle im Wechsel, Ersatz: die prozedurale Palme
      var palm = ctx.kind('palm', [{ geo: pk.geo() }], { r: 2.2, tint: true, prop: { slot: 'palm', box: { w: 10, d: 10, h: 12 } } });
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
      // Dünengras und Büsche nur an Land (über dem Wasser)
      greenery(ctx, { grass: 0.08, bush: 0.01, far: 70, farBush: 10, dry: true, pred: function (x, z) { return z > ctx.shoreZ + 25; } });
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
      hk.add(box(44, 11, 22), 0xffffff, { y: 4.5, tile: 'corrugated', uv: 'box', m: 3, faces: function (nx, ny, nz) { return Math.abs(ny) < 0.5; } });
      hk.add(prism(44.6, 23, 4), 0xffffff, { y: 11.3, tile: 'roof', uv: 'box', m: 4 });
      for (var d = 0; d < 4; d++) hk.add(box(5, 5.5, 0.12), 0xffffff, { x: -15 + d * 10, y: 2.75, z: 11.03, tile: 'door', faces: function (nx, ny, nz) { return nz > 0.5; } });
      hk.add(box(42, 1.1, 0.1), 0xffffff, { y: 8.2, z: 11.04, tile: 'glassBand', uvK: [1, 1], faces: function (nx, ny, nz) { return nz > 0.5; } });
      hk.add(box(44.2, 0.5, 0.14), ctx.accent, { y: 9.4, z: 11.05 });
      var hall = ctx.kind('hall', [{ geo: hk.geo(), mat: 'atl' }], { r: 25, prop: { slot: 'hall', box: { w: 46, d: 26, h: 24 } } });
      // Container (Farbe je Instanz), Rippen als dünne Leisten
      var ck = new Kit();
      ck.add(box(6.1, 2.6, 2.45), 0xffffff, { y: 1.3 });
      for (var r = 0; r < 9; r++) ck.add(box(0.12, 2.3, 2.5), 0xd9d9d9, { x: -2.6 + r * 0.65, y: 1.3 });
      ck.add(box(0.1, 2.4, 2.3), 0x9a9a9a, { x: 3.06, y: 1.3 });
      // Graffiti auf Containern: Aufkleber-Fläche (ausgestanzt nach Alpha, Motiv je Instanz) an der Außenseite eines
      // äußeren unteren Containers; sitzt ein Kulissen-Modell dort, rückt sie auf dessen Seitenwand (onProp: faceZ)
      var tagK = new Kit();
      tagK.add(new THREE.PlaneGeometry(2.3, 1.6), 0xffffff, { y: 1.15, tile: 'tag', vary: true });
      var tag = ctx.kind('tag', [{ geo: tagK.geo(), mat: 'atlcut' }], { r: 1.2, vary: true });
      function tagTo(s, d) {
        var tg = tag.spots[s.tagI];
        tg.x = s.x + s.tagSide * d * Math.sin(s.rot); tg.z = s.z + s.tagSide * d * Math.cos(s.rot);
      }
      var cont = ctx.kind('container', [{ geo: ck.geo() }], { r: 3.4, tint: true, prop: { slot: 'container', box: { w: 6.3, d: 2.7, h: 2.9 },
        onProp: function (s, info) {
          if (s.tagI == null || !info.faceZ) return;
          tagTo(s, (s.tagSide > 0 ? info.faceZ[1] : -info.faceZ[0]) + 0.03); tag.refresh(s.tagI);
        } } });
      var tagR = ctx.rng(78);
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
          var side = q === 0 && q === cols - 1 ? (tagR() < 0.5 ? -1 : 1) : q === 0 ? -1 : q === cols - 1 ? 1 : 0;
          if (side && tagR() < 0.5) {
            var cs0 = cont.spots[cont.spots.length - lv];
            cs0.tagI = tag.spots.length; cs0.tagSide = side;
            tag.add(cs0.x, cs0.z, { rot: rc + (side < 0 ? Math.PI : 0), v: Math.floor(tagR() * Art.TAGS) });
            tagTo(cs0, 1.28);
          }
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
      leafTrees(ctx, 6, 3, 30, 110);
      greenery(ctx, { grass: 0.1, bush: 0.008, far: 60, farBush: 6, dry: true });
      // Hintergrund: Fabrikhallen (dieselbe Art wie die Hallen am Hof → Kulissen-Modelle statt grauer Klötze),
      // Schornsteine (rot-weiß), Silos
      var bg = new Kit();
      for (var i = 0; i < 40; i++) {
        var aa = rnd() * TAU, R = ctx.radius + 230 + rnd() * 420, bx = ctx.cx + Math.cos(aa) * R, bz = ctx.cz + Math.sin(aa) * R;
        var w = 30 + rnd() * 60, h = 12 + rnd() * 26, kind = rnd();
        if (kind < 0.55) hall.add(bx, bz, { rot: aa, s: Math.max(0.8, Math.min(1.8, w / 44)) });
        else if (kind < 0.8) {
          var ch = 45 + rnd() * 40;
          bg.add(cyl(1.8, 2.6, ch, 8), function (x, y) { return Math.floor(y / 7) % 2 ? 0xd8262b : 0xeeeeee; }, { x: bx, y: ch / 2, z: bz,
            tile: 'grime', uv: 'cyl', reps: 2, m: 5, faces: function (nx, ny, nz) { return Math.abs(ny) < 0.5; } });
        } else {
          for (var si = 0; si < 3; si++) bg.add(cyl(5, 5, 22, 10), 0xffffff, { x: bx + si * 11, y: 11, z: bz, tile: 'silo', uv: 'cyl', reps: 5, m: 6, faces: function (nx, ny, nz) { return Math.abs(ny) < 0.5; } });
        }
      }
      ctx.bg(bg);
      // Graffiti-Mauern: freistehende Betonwände auf den Höfen neben der Strecke, längs zur Fahrbahn, Motiv je Instanz
      // (beide Seiten); am Ende, damit die Deko davor bleibt, wo sie war
      var tw = new Kit();
      tw.add(box(5, 0.4, 0.6), 0x8e8b84, { y: 0.1 });
      tw.add(box(4.8, 2.6, 0.24), 0xd2cfc8, { y: 1.55, tile: 'tag', vary: true, uvK: [1.3, 1.05], faces: function (nx, ny, nz) { return Math.abs(nz) > 0.5; } });
      var tagWall = ctx.kind('tagWall', [{ geo: tw.geo(), mat: 'atl' }], { r: 2.6, vary: true });
      for (var tt = 0, nt = 0; tt < 300 && nt < 8; tt++) {
        var ot = ctx.randomSpot(16, 70);
        if (!ot || !ctx.place(ot.x, ot.z, 2.7)) continue;
        tagWall.add(ot.x, ot.z, { rot: ot.rot, v: (nt + Math.floor(tagR() * 2)) % Art.TAGS }); nt++;
      }
    }
  };

  // Alte Industriehalle (Kart): die Bahn steht in einer großen Halle – Wellblech über Betonsockel, Stahlstützen,
  // Fachwerkträger, Oberlichter, Hallenstrahler, Rolltore, Graffiti, Container und Fässer an den Wänden. Wände und Dach
  // sind nur von innen sichtbar (nach innen gerichtete Flächen): Kameras außerhalb (Overlay-Regie) schauen hinein wie in
  // ein Puppenhaus, Kameras innen sehen eine geschlossene Halle. Kein Himmel (indoor), Licht steil von oben.
  // Container-Modelle aus dem Industrie-Katalog (propTheme).
  THEMES.hall = {
    id: 'hall', name: 'Hall', flat: true, indoor: true, propTheme: 'industrial',
    // Nebel erst weit hinter der Halle (sonst wird die ferne Wand zur grauen Fläche); Hemisphäre unten hell (Licht vom
    // Boden auf die Dach-Unterseite und die Träger)
    sky: { top: 0x2a2d31, horizon: 0x3b3f44 }, fog: { near: 320, far: 1100 },
    sun: { color: 0xfff3e0, k: 0.85, pos: [0.25, 10, 0.4] }, hemi: { sky: 0xd7dde4, ground: 0x9a948a, k: 1.0 }, fill: 0.7, exposure: 1.0,
    groundTex: { base: [232, 232, 232], spread: 0.3 },
    rail: false,
    surface: { curb: [0x2a6fd6, 0xf2c200], runoff: 'tarmac', barrier: 'tyres', stripes: false },
    height: function () { return function () { return 0; }; },
    groundColor: function (ctx) {
      var B = ctx.hallBox;
      return function (x, z) {
        if (B && (x < B.x0 || x > B.x1 || z < B.z0 || z > B.z1)) return 0x1c1d20;   // außerhalb der Halle
        var n = fbm(x / 18, z / 18), c = mix(0x6c6d69, 0x7f807b, n);                // Hallenboden aus Beton
        if (n < 0.32) c = mix(c, 0x4c4d50, (0.32 - n) * 3.5);                       // Öl-/Wasserflecken
        if (fbm(x / 5 + 40, z / 5) > 0.72) c = mix(c, 0x8a8478, 0.35);             // Staub
        return c;
      };
    },
    decorate: function (ctx) {
      var rnd = ctx.rnd, HALF = ctx.HALF, H = 16, M = 26;
      var x0 = ctx.minX - HALF - M, x1 = ctx.maxX + HALF + M, z0 = ctx.minZ - HALF - M, z1 = ctx.maxZ + HALF + M;
      var W = x1 - x0, D = z1 - z0, hx = (x0 + x1) / 2, hz = (z0 + z1) / 2;
      ctx.hallBox = { x0: x0, x1: x1, z0: z0, z1: z1, h: H };
      // Reifenstapel statt Leitplanke (wie Industrie)
      var tyres = ctx.kind('tyres', [{ geo: tyreStack(0.5) }], { r: 0.5, tint: true });
      var tcol = [0x1a1a1c, 0x1a1a1c, 0xf2f2f2, 0xd8262b, 0x1a1a1c, 0xf2b705];
      ctx.alongRail(tyres, { step: 1.05, extra: 0.25, tint: function (k) { return tcol[k % tcol.length]; } });
      // Hülle aus einzelnen Flächen, die nach innen zeigen (keine Kästen: deren Boden/Deckel blieben als Platten stehen):
      // Wellblech, Betonsockel, Rost-Band, Dach-Unterseite
      function band(k, y0b, y1b, inset, color, o) {
        var h = y1b - y0b, ym = (y0b + y1b) / 2, e = inset || 0;
        var base = function (extra) { var r = { y: ym }; for (var f in o) r[f] = o[f]; for (var g in extra) r[g] = extra[g]; return r; };
        k.add(new THREE.PlaneGeometry(W, h), color, base({ x: hx, z: z0 + e }));
        k.add(new THREE.PlaneGeometry(W, h), color, base({ x: hx, z: z1 - e, ry: Math.PI }));
        k.add(new THREE.PlaneGeometry(D, h), color, base({ x: x0 + e, z: hz, ry: Math.PI / 2 }));
        k.add(new THREE.PlaneGeometry(D, h), color, base({ x: x1 - e, z: hz, ry: -Math.PI / 2 }));
      }
      var sh = new Kit();
      band(sh, 0, H, 0, 0xc2b3a2, { tile: 'corrugated', uv: 'box', m: 4 });
      band(sh, 0, 2.6, 0.05, 0xd1ccc2, { tile: 'concrete', uv: 'box', m: 3 });
      band(sh, 2.6, 6, 0.06, 0xb08a68, { tile: 'rust', uv: 'box', m: 4 });
      sh.add(new THREE.PlaneGeometry(W, D), 0xc4c9cf, { x: hx, y: H, z: hz, rx: Math.PI / 2, tile: 'corrugated', uv: 'box', m: 5 });
      ctx.bg(sh);
      // Fensterband: Tageslicht von draußen (leuchtend, nur von innen sichtbar), Sprossen davor
      var fb = new Kit();
      band(fb, 10.2, 12.6, 0.1, 0xd6e2ec, {});
      var win = ctx.kind('windowBand', [{ geo: fb.geo(), mat: 'glow' }], { r: 1 });
      win.add(0, 0, { abs: true, y: 0 });
      var mk = new Kit();
      for (var mx = 0; mx <= Math.round(W / 3); mx++) {
        mk.add(box(0.14, 2.5, 0.14), 0x3a4048, { x: x0 + mx * W / Math.round(W / 3), y: 11.4, z: z0 + 0.2 });
        mk.add(box(0.14, 2.5, 0.14), 0x3a4048, { x: x0 + mx * W / Math.round(W / 3), y: 11.4, z: z1 - 0.2 });
      }
      for (var mz = 0; mz <= Math.round(D / 3); mz++) {
        mk.add(box(0.14, 2.5, 0.14), 0x3a4048, { x: x0 + 0.2, y: 11.4, z: z0 + mz * D / Math.round(D / 3) });
        mk.add(box(0.14, 2.5, 0.14), 0x3a4048, { x: x1 - 0.2, y: 11.4, z: z0 + mz * D / Math.round(D / 3) });
      }
      ctx.kind('mullions', [{ geo: mk.geo() }], { r: 1 }).add(0, 0, { abs: true, y: 0 });
      // Plätze an den Wänden: Seite → Lage (t = 0…1 entlang der Wand), Drehung nach innen (+z der Platz-Form zeigt in die Halle)
      function onWall(side, t, inset) {
        inset = inset || 0;
        if (side === 0) return { x: x0 + W * t, z: z0 + inset, rot: 0 };
        if (side === 1) return { x: x0 + W * t, z: z1 - inset, rot: Math.PI };
        if (side === 2) return { x: x0 + inset, z: z0 + D * t, rot: Math.PI / 2 };
        return { x: x1 - inset, z: z0 + D * t, rot: -Math.PI / 2 };
      }
      // Stahlstützen (Doppel-T) alle 12 m an den Wänden
      var ck = new Kit();
      ck.add(box(0.7, H, 0.12), 0x55606b, { y: H / 2, z: 0.3 }); ck.add(box(0.7, H, 0.12), 0x55606b, { y: H / 2, z: -0.3 });
      ck.add(box(0.12, H, 0.6), 0x4c5661, { y: H / 2 });
      ck.add(box(1.1, 0.3, 1.1), 0x6b6a66, { y: 0.15 });
      var column = ctx.kind('column', [{ geo: ck.geo() }], { r: 0.8 });
      [0, 1, 2, 3].forEach(function (sd) {
        var L = sd < 2 ? W : D, nC = Math.max(2, Math.round(L / 12));
        for (var i = 0; i <= nC; i++) { var w0 = onWall(sd, i / nC, 0.45); column.add(w0.x, w0.z, { rot: w0.rot }); }
      });
      // Fachwerkträger quer (über die Tiefe D) alle 12 m: Ober-/Untergurt, Pfosten, Diagonalen
      var tk = new Kit(), yb = H - 3.4, yt = H - 0.6, hh = yt - yb, nP = Math.max(2, Math.round(D / 3)), dz = D / nP;
      tk.add(box(0.35, 0.45, D), 0x66707b, { y: yb }); tk.add(box(0.35, 0.45, D), 0x66707b, { y: yt });
      for (var p = 0; p <= nP; p++) {
        var zz = -D / 2 + p * dz;
        tk.add(box(0.2, hh, 0.2), 0x5c6570, { y: (yb + yt) / 2, z: zz });
        if (p < nP) tk.add(box(0.14, Math.hypot(dz, hh), 0.14), 0x5c6570, { y: (yb + yt) / 2, z: zz + dz / 2, rx: (p % 2 ? 1 : -1) * Math.atan2(dz, hh) });
      }
      var truss = ctx.kind('truss', [{ geo: tk.geo() }], { r: 1 });
      // Pfetten längs (über die Breite W) zwischen den Trägern
      var pk = new Kit(); pk.add(box(W, 0.3, 0.22), 0x5f6873, { y: H - 0.5 });
      var purlin = ctx.kind('purlin', [{ geo: pk.geo() }], { r: 1 });
      for (var pz = z0 + 6; pz < z1 - 3; pz += 9) purlin.add(hx, pz, { abs: true, y: 0 });
      // Oberlichter (leuchtend, nur von unten sichtbar) in jedem zweiten Feld, Hallenstrahler unter dem Untergurt
      var lk = new Kit(); lk.add(new THREE.PlaneGeometry(4.2, D - 12), 0xe6edf2, { y: H - 0.12, rx: Math.PI / 2 });
      var sky = ctx.kind('skylight', [{ geo: lk.geo(), mat: 'glow' }], { r: 2 });
      // Hängelampe: Schirm (Modell slot hallLamp, Ersatz Kasten), Kabel und Leuchtfläche bleiben prozedural
      var hk = new Kit(), hc = new Kit(), hg = new Kit();
      hk.add(cone(0.55, 0.45, 10), 0x2b2e33, { y: 0.22 });
      hc.add(box(0.04, 2.6, 0.04), 0x1f2226, { y: 1.75 });
      hg.add(new THREE.CircleGeometry(0.42, 12), 0xfff1d2, { y: 0.03, rx: Math.PI / 2 });
      var lamp = ctx.kind('hallLamp', [{ geo: hk.geo() }], { r: 1, prop: { slot: 'hallLamp', box: { w: 1.6, d: 1.6, h: 1.2 } } });
      var lampC = ctx.kind('lampCable', [{ geo: hc.geo() }], { r: 0.2 });
      var lampG = ctx.kind('lampGlow', [{ geo: hg.geo(), mat: 'glow' }], { r: 0.5 });
      var nT = Math.max(2, Math.round(W / 12));
      for (var t = 0; t <= nT; t++) {
        var tx = x0 + W * t / nT;
        if (t > 0 && t < nT) truss.add(tx, hz, { abs: true, y: 0 });
        if (t < nT && t % 2 === 0) sky.add(tx + W / nT / 2, hz, { abs: true, y: 0 });
        if (t > 0 && t < nT) for (var lz = z0 + 10; lz < z1 - 6; lz += 14) {
          lamp.add(tx, lz, { abs: true, y: yb - 2.9 }); lampC.add(tx, lz, { abs: true, y: yb - 2.9 }); lampG.add(tx, lz, { abs: true, y: yb - 2.9 });
        }
      }
      // Rolltore und Graffiti an den Wänden (je Wand ein paar, nach innen)
      var dk = new Kit(); dk.add(new THREE.PlaneGeometry(7, 6.5), 0xffffff, { y: 3.25, tile: 'door' });
      var door = ctx.kind('door', [{ geo: dk.geo(), mat: 'atl' }], { r: 3.5 });
      var gk = new Kit(); gk.add(new THREE.PlaneGeometry(3.2, 2.1), 0xffffff, { y: 1.5, tile: 'tag', vary: true });
      var tag = ctx.kind('wallTag', [{ geo: gk.geo(), mat: 'atlcut' }], { r: 1.6, vary: true });
      var nTag = 0;
      [0, 1, 2, 3].forEach(function (sd) {
        [0.27, 0.73].forEach(function (u) { var w1 = onWall(sd, u, 0.08); door.add(w1.x, w1.z, { rot: w1.rot }); });
        [0.12, 0.42, 0.58, 0.88].forEach(function (u) {
          if (rnd() < 0.3) return;
          var w2 = onWall(sd, u + (rnd() - 0.5) * 0.05, 0.1); tag.add(w2.x, w2.z, { rot: w2.rot, v: (nTag++) % Art.TAGS });
        });
      });
      // Container an den Wänden (Farbe je Instanz, Modelle slot container), 1–2 hoch, parallel zur Wand
      var cK = new Kit();
      cK.add(box(6.1, 2.6, 2.45), 0xffffff, { y: 1.3 });
      for (var r = 0; r < 9; r++) cK.add(box(0.12, 2.3, 2.5), 0xd9d9d9, { x: -2.6 + r * 0.65, y: 1.3 });
      var cont = ctx.kind('container', [{ geo: cK.geo() }], { r: 3.4, tint: true, prop: { slot: 'container', box: { w: 6.3, d: 2.7, h: 2.9 } } });
      var ccol = [0xc0392b, 0x2563a8, 0x2e8b57, 0xe67e22, 0x7f8c8d, 0xd4ac0d];
      [0, 1, 2, 3].forEach(function (sd) {
        var L = sd < 2 ? W : D;
        for (var u = 0.08; u < 0.95; u += 7.5 / L) {
          if (rnd() < 0.45) continue;
          var w3 = onWall(sd, u, 2.1);
          if (!ctx.place(w3.x, w3.z, 3.3)) continue;
          var lv = rnd() < 0.35 ? 2 : 1;
          for (var l = 0; l < lv; l++) cont.add(w3.x, w3.z, { rot: w3.rot, y: l * 2.6, tint: ccol[Math.floor(rnd() * ccol.length)] });
        }
      });
      // Ölfässer in Gruppen (Modell slot drum, Ersatz Zylinder in Instanzfarbe), Paletten-Stapel, Reifenhaufen
      var drum = ctx.kind('drum', [{ geo: cyl(0.3, 0.3, 0.95, 10).translate(0, 0.475, 0) }], { r: 0.35, tint: true, prop: { slot: 'drum', box: { w: 0.8, d: 0.8, h: 1.1 } } });
      var pk2 = new Kit();
      for (var pl = 0; pl < 4; pl++) pk2.add(box(1.2, 0.14, 1.0), 0x9c7a4d, { y: 0.07 + pl * 0.16 });
      var pallets = ctx.kind('pallets', [{ geo: pk2.geo() }], { r: 0.8 });
      var tk2 = new Kit();
      for (var ty = 0; ty < 3; ty++) tk2.add(new THREE.TorusGeometry(0.3, 0.12, 6, 12), 0x18191b, { y: 0.12 + ty * 0.24, rx: Math.PI / 2 });
      var tyrePile = ctx.kind('tyrePile', [{ geo: tk2.geo() }], { r: 0.5, prop: { slot: 'tyrePile', box: { w: 1.4, d: 1.4, h: 1.4 } } });
      var bcol = [0x2f5d8a, 0xa13a2a, 0x6d6b3a, 0x8a5a2b];
      for (var b2 = 0; b2 < 46; b2++) {
        var sd2 = Math.floor(rnd() * 4), w4 = onWall(sd2, 0.05 + rnd() * 0.9, 2 + rnd() * 6), kindR = rnd();
        if (!ctx.place(w4.x, w4.z, 1.1)) continue;
        if (kindR < 0.5) {
          var nD = 2 + Math.floor(rnd() * 3), tint = bcol[Math.floor(rnd() * bcol.length)];
          for (var dd = 0; dd < nD; dd++) { var an = dd * 2.2 + rnd(), rr = dd ? 0.62 : 0; drum.add(w4.x + Math.cos(an) * rr, w4.z + Math.sin(an) * rr, { rot: rnd() * TAU, tint: tint }); }
        } else if (kindR < 0.75) pallets.add(w4.x, w4.z, { rot: w4.rot + (rnd() - 0.5) * 0.4 });
        else tyrePile.add(w4.x, w4.z, { rot: rnd() * TAU, s: 1 + rnd() * 0.4 });
      }
      // Sicherungskästen an den Wänden (Modell slot fuseBox), liegende Tanks parallel zur Wand (slot tank)
      var fuse = ctx.kind('fuseBox', [{ geo: box(3, 3.2, 0.5).translate(0, 1.6, 0.25) }], { r: 1.6, prop: { slot: 'fuseBox', box: { w: 3.4, d: 0.7, h: 3.6 } } });
      var tankK = new Kit();
      tankK.add(cyl(1.3, 1.3, 7, 14), 0x8a8f86, { y: 1.5, rz: Math.PI / 2 });
      tankK.add(box(0.4, 1, 2), 0x4a4d52, { x: -2.5, y: 0.5 }); tankK.add(box(0.4, 1, 2), 0x4a4d52, { x: 2.5, y: 0.5 });
      var tank = ctx.kind('tank', [{ geo: tankK.geo() }], { r: 3.6, prop: { slot: 'tank', box: { w: 7.4, d: 3, h: 3.2 } } });
      [0, 1, 2, 3].forEach(function (sd) {
        [0.2, 0.5, 0.8].forEach(function (u) {
          if (rnd() < 0.4) return;
          var wf = onWall(sd, u + (rnd() - 0.5) * 0.08, 0.15);
          if (ctx.place(wf.x, wf.z, 1.5)) fuse.add(wf.x, wf.z, { rot: wf.rot });
        });
        if (rnd() < 0.6) { var wt = onWall(sd, 0.3 + rnd() * 0.4, 2.2); if (ctx.place(wt.x, wt.z, 3.8)) tank.add(wt.x, wt.z, { rot: wt.rot }); }
      });
      // Betonwände (Modell slot jersey, 5 m) in kurzen Reihen an den Wänden, Pylonen in Grüppchen
      var jersey = ctx.kind('jersey', [{ geo: box(5, 1.2, 0.5).translate(0, 0.6, 0) }], { r: 2.6, prop: { slot: 'jersey', box: { w: 5.2, d: 0.8, h: 1.6 } } });
      var coneK = ctx.kind('cone', [{ geo: cone(0.2, 0.6, 8).translate(0, 0.3, 0) }], { r: 0.25, tint: true, prop: { slot: 'cone', box: { w: 0.6, d: 0.6, h: 0.7 } } });
      [0, 1, 2, 3].forEach(function (sd) {
        var L = sd < 2 ? W : D, start = 0.1 + rnd() * 0.5, n = 2 + Math.floor(rnd() * 3);
        for (var j = 0; j < n; j++) {
          var wj = onWall(sd, start + j * 5.2 / L, 4.5);
          if (ctx.place(wj.x, wj.z, 2.6)) jersey.add(wj.x, wj.z, { rot: wj.rot });
        }
        for (var cg = 0; cg < 3; cg++) {
          var wc = onWall(sd, 0.1 + rnd() * 0.8, 3 + rnd() * 8);
          for (var ci = 0; ci < 3 + Math.floor(rnd() * 3); ci++) {
            var cx2 = wc.x + (rnd() - 0.5) * 3, cz2 = wc.z + (rnd() - 0.5) * 3;
            if (ctx.place(cx2, cz2, 0.3)) coneK.add(cx2, cz2, { rot: rnd() * TAU, tint: 0xff6a1a });
          }
        }
      });
      // Container-Gruppen (nur als Kulissen-Modell) in zwei Ecken
      var pile = ctx.kind('containerPile', [], { r: 10, prop: { slot: 'containerPile', box: { w: 20, d: 13, h: 7 } } });
      [[x0 + 14, z0 + 11, 0], [x1 - 14, z1 - 11, Math.PI]].forEach(function (c) { if (ctx.place(c[0], c[1], 10)) pile.add(c[0], c[1], { rot: c[2] }); });
    }
  };

  var BY_LAYOUT = { Speedway: 'stadium', Twister: 'forest', Hairpin: 'alpine', Coast: 'coast', Kart: 'hall' };
  function forTrack(T) { return THEMES[BY_LAYOUT[T && T.name] || 'stadium']; }

  root.CarTrackThemes = { forTrack: forTrack, THEMES: THEMES, BY_LAYOUT: BY_LAYOUT, Kit: Kit, Art: Art, lin: lin, mix: mix, smooth: smooth, fbm: fbm, tyreStack: tyreStack, Relief: Relief, ranges: ranges };
})(typeof window !== 'undefined' ? window : this);
