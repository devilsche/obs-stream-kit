/* Fahrbahn und Streckenrand der Car-Race-Strecken (three r128), aufgerufen von js/car-track-scene.js nach der Deko
 * (Bodenfarbe und belegte Plätze stehen dann fest). Genutzt im Overlay (js/car-race.js) und in Car Drive.
 *
 *   CarTrackSurface.build(S) → { stats: { draws, tris, texBytes } }
 *   S = { T, P, n, ds, HALF, g (Gruppe), own(x), heightAt, trackDist, runAt(i, sd), gravel: {1, -1} (Uint8Array je
 *         Rasterpunkt, Kiesbett-Regel wie js/car-drive-phys.js), curvy(i), theme, gc(x, z, h, d) (Bodenfarbe),
 *         place(x, z, r, ignoreTrack), rng(salt), lin(c), maxAniso, gantry, pit ({ sd, s0, s1 } Boxengasse) }
 *
 * Inhalt (alles deterministisch aus dem Strecken-Seed, folgt der optischen Höhe heightAt):
 *   Asphalt      Kachel-Texturen (Farbe, Normalen, Rauheit) mit UV nach Bogenlänge s und Querabstand d; jede
 *                Querlinie bekommt eine ganze Zahl von Kacheln pro Runde (keine Naht am Start), keine Dehnung
 *                in Kurven. Ideallinie und Bremszonen dunkler (Ecken-Farbe).
 *   Aufkleber    EIN Zeichenaufruf (Atlas): Gummispuren in Bremszonen/Kurvenausgängen, Flicken, Vergussnähte,
 *                weiße Randlinien, Start/Ziel-Schachbrett, Startplätze, Boxengassen-Markierung (Speedway).
 *   Curbs        erhabenes Profil mit Sägezahn-Rippen, Farbblöcke je Thema, Wurst-Curbs an Schikanen.
 *   Auslauf      ein Band je Seite mit eigenem Shader: Gras mit Mähstreifen und dunklerem Saum, Kies/Sand/Asphalt
 *                weich eingeblendet (Mischwert je Ecke), Kies mit Wellen + Normalen + Kieselsteinen (Instanzen).
 *   Begrenzung   Leitplanke (doppeltes W-Profil auf Pfosten), Reifenstapel mit Gurt (Kurven-Außenseiten mit Kies;
 *                Kart überall), Betonmauer mit Fangzaun (Stadion). Vorderkante wie bisher: Auslauf + 0,3 m.
 *   Rand-Deko    Streckenposten, Countdown-Tafeln (Streifen statt Zahlen) vor Bremszonen, Startampel am Portal.
 * Auslauf/Leitplanke bleiben genau dort, wo Sim (js/car-race-sim.js) und Fahrphysik (js/car-drive-phys.js) sie
 * erwarten – hier ist alles nur Optik.
 * Texturen werden einmal je Seite erzeugt (Asphalt 1024², sonst ≤ 512²; Mipmaps, Anisotropie bis 16) und von allen
 * Strecken geteilt.
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  var TAU = Math.PI * 2;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  // fester Zufall (xorshift) für die Texturen – unabhängig von der Strecke, damit der Cache für alle gilt
  function xrng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // ---- Kachelbare Texturen (Float-Felder N×N, Rand läuft herum) ----
  function tileNoise(N, cells, rnd) {
    var gr = new Float32Array(cells * cells), out = new Float32Array(N * N), x, y;
    for (x = 0; x < gr.length; x++) gr[x] = rnd();
    for (y = 0; y < N; y++) {
      var fy = y / N * cells, iy = Math.floor(fy), ty = fy - iy, iy1 = (iy + 1) % cells;
      ty = ty * ty * (3 - 2 * ty);
      for (x = 0; x < N; x++) {
        var fx = x / N * cells, ix = Math.floor(fx), tx = fx - ix, ix1 = (ix + 1) % cells;
        tx = tx * tx * (3 - 2 * tx);
        var a = gr[iy * cells + ix], b = gr[iy * cells + ix1], c = gr[iy1 * cells + ix], d = gr[iy1 * cells + ix1];
        out[y * N + x] = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
      }
    }
    return out;
  }
  function fbmField(N, rnd, octs) {   // octs = [[Zellen, Gewicht], …]
    var out = new Float32Array(N * N);
    octs.forEach(function (o) { var f = tileNoise(N, o[0], rnd); for (var i = 0; i < out.length; i++) out[i] += f[i] * o[1]; });
    return out;
  }
  // runder Stein/Fleck auf ein Feld stempeln (herumlaufend); fn(Feld-Index, Gewicht 0…1)
  function stamp(N, cx, cy, r, fn) {
    var r0 = Math.ceil(r);
    for (var dy = -r0; dy <= r0; dy++) for (var dx = -r0; dx <= r0; dx++) {
      var q = (dx * dx + dy * dy) / (r * r);
      if (q > 1) continue;
      var x = ((Math.round(cx) + dx) % N + N) % N, y = ((Math.round(cy) + dy) % N + N) % N;
      fn(y * N + x, 1 - q);
    }
  }
  function normalsFrom(H, N, k) {
    var d = new Uint8Array(N * N * 4);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var i = y * N + x;
      var gx = (H[y * N + (x + 1) % N] - H[y * N + (x - 1 + N) % N]) * k, gy = (H[((y + 1) % N) * N + x] - H[((y - 1 + N) % N) * N + x]) * k;
      var l = Math.sqrt(gx * gx + gy * gy + 1);
      d[i * 4] = (-gx / l * 0.5 + 0.5) * 255; d[i * 4 + 1] = (-gy / l * 0.5 + 0.5) * 255; d[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255; d[i * 4 + 3] = 255;
    }
    return d;
  }
  function dataTex(data, N, M, srgb, aniso) {
    var t = new THREE.DataTexture(data, N, M || N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.anisotropy = aniso || 1;
    if (srgb) t.encoding = THREE.sRGBEncoding;
    t.needsUpdate = true;
    t.trackBytes = data.length * 4 / 3;   // mit Mipmaps
    return t;
  }

  var TEX = {};   // Cache für die ganze Seite (dispose() einer Strecke gibt nur den GPU-Speicher frei)
  // Asphalt: Grundton, Gesteinskörnung (helle/dunkle Körner), großflächige Flecken; Normalen + Rauheit aus der Höhe
  function asphaltTex(aniso) {
    if (TEX.asphalt) return TEX.asphalt;
    // 1024² und kräftigere Mittel-Strukturen: feine Körner allein mitteln sich in den Mipmaps (Abstand, flacher Blick)
    // zu flachem Grau – gröbere Körnung, Flecken und Bitumen-Nester bleiben auch aus der Overlay-Totale sichtbar
    var N = 1024, rnd = xrng(91), H = fbmField(N, rnd, [[4, 0.5], [16, 0.3], [64, 0.25], [128, 0.15], [256, 0.1]]);
    var tone = fbmField(N, rnd, [[3, 0.6], [8, 0.4]]), mid = fbmField(N, rnd, [[24, 0.5], [48, 0.35], [96, 0.25]]), A = new Float32Array(N * N), i;
    for (i = 0; i < N * N; i++) A[i] = 0;
    for (i = 0; i < 95000; i++) {   // Körner: Höhe + Farbe (hell = Splitt, dunkel = Bitumen)
      var r = 0.8 + rnd() * 2.6, light = rnd() < 0.45, k = (light ? 1 : -0.7) * (0.3 + rnd() * 0.7), h = 0.35 + rnd() * 0.45;
      stamp(N, rnd() * N, rnd() * N, r, function (q, w) { H[q] += h * Math.sqrt(w); A[q] += k * w; });
    }
    var col = new Uint8Array(N * N * 4), rough = new Uint8Array(N * N * 4);
    for (i = 0; i < N * N; i++) {
      var base = 62 + (tone[i] - 0.5) * 26 + (mid[i] - 0.5) * 22 + A[i] * 40 + (H[i] - 1) * 10;
      col[i * 4] = clamp(base, 20, 200); col[i * 4 + 1] = clamp(base + 2, 20, 200); col[i * 4 + 2] = clamp(base + 6, 20, 210); col[i * 4 + 3] = 255;
      var ro = 0.86 + (A[i] > 0.2 ? -0.12 : 0.04) - (tone[i] - 0.5) * 0.1;
      rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = clamp(ro, 0, 1) * 255; rough[i * 4 + 3] = 255;
    }
    TEX.asphalt = { map: dataTex(col, N, N, true, aniso), normal: dataTex(normalsFrom(H, N, 2.2), N, N, false, aniso), rough: dataTex(rough, N, N, false, aniso) };
    return TEX.asphalt;
  }
  // Kies (gerundete Kiesel, Grautöne mit Ocker) oder Sand (fein, Rippel)
  function looseTex(kind, aniso) {
    if (TEX[kind]) return TEX[kind];
    var N = 512, rnd = xrng(kind === 'sand' ? 57 : 23), H, C = new Float32Array(N * N * 3), i;
    if (kind === 'sand') {
      H = fbmField(N, rnd, [[8, 0.3], [32, 0.2], [128, 0.35]]);
      var rip = tileNoise(N, 6, rnd);
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        i = y * N + x;
        H[i] += 0.35 * Math.sin((y / N) * TAU * 14 + rip[i] * 6);   // Windrippel
        var c = 0.86 + (H[i] - 0.6) * 0.12;
        C[i * 3] = 222 * c; C[i * 3 + 1] = 200 * c; C[i * 3 + 2] = 156 * c;
      }
      for (i = 0; i < 9000; i++) {
        var dk = rnd() < 0.5 ? 0.82 : 1.1;
        stamp(N, rnd() * N, rnd() * N, 0.6 + rnd() * 0.6, function (q) { C[q * 3] *= dk; C[q * 3 + 1] *= dk; C[q * 3 + 2] *= dk; });
      }
    } else {
      H = new Float32Array(N * N);
      for (i = 0; i < N * N; i++) { C[i * 3] = 120; C[i * 3 + 1] = 112; C[i * 3 + 2] = 98; }
      var tones = [[196, 188, 172], [170, 160, 142], [214, 204, 182], [150, 140, 126], [184, 160, 120], [128, 122, 114]];
      for (i = 0; i < 5200; i++) {   // Kiesel: gewölbt, mit Schattenfuge
        var t = tones[Math.floor(rnd() * tones.length)], r2 = 2.2 + rnd() * 4.2, sh = 0.85 + rnd() * 0.3;
        stamp(N, rnd() * N, rnd() * N, r2, function (q, w) {
          var h2 = Math.sqrt(w) * r2 * 0.5;
          if (h2 > H[q]) { H[q] = h2; var k2 = sh * (0.75 + 0.25 * Math.sqrt(w)); C[q * 3] = t[0] * k2; C[q * 3 + 1] = t[1] * k2; C[q * 3 + 2] = t[2] * k2; }
        });
      }
    }
    var col = new Uint8Array(N * N * 4);
    for (i = 0; i < N * N; i++) { col[i * 4] = clamp(C[i * 3], 0, 255); col[i * 4 + 1] = clamp(C[i * 3 + 1], 0, 255); col[i * 4 + 2] = clamp(C[i * 3 + 2], 0, 255); col[i * 4 + 3] = 255; }
    TEX[kind] = { map: dataTex(col, N, N, true, aniso), normal: dataTex(normalsFrom(H, N, kind === 'sand' ? 0.9 : 0.55), N, N, false, aniso) };
    return TEX[kind];
  }
  // feines Korn für Curbs (hell, mit Gebrauchsspuren)
  function curbTex(aniso) {
    if (TEX.curb) return TEX.curb;
    var N = 128, rnd = xrng(5), f = fbmField(N, rnd, [[8, 0.5], [32, 0.5]]), d = new Uint8Array(N * N * 4);
    for (var i = 0; i < N * N; i++) { var v = clamp(225 + (f[i] - 0.5) * 50 + (rnd() - 0.5) * 22, 0, 255); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    return (TEX.curb = dataTex(d, N, N, true, aniso));
  }
  // Aufkleber-Atlas (RGBA): Bereiche als [u0, v0, u1, v1]
  var REG = { rub: [0.01, 0.0, 0.24, 1.0], rubL: [0.26, 0.0, 0.49, 1.0], patch: [0.5, 0.0, 1.0, 0.5], snake: [0.51, 0.52, 0.74, 0.98], paint: [0.8, 0.56, 0.95, 0.94] };
  function decalTex(aniso) {
    if (TEX.decal) return TEX.decal;
    var N = 512, rnd = xrng(77), D = new Float32Array(N * N * 4), i;   // rgb 0…255, a 0…1
    function px(x, y) { return ((y | 0) * N + (x | 0)) * 4; }
    function over(q, r, gg, b, a) {   // Überblenden (über vorhandenes)
      var o = D[q + 3], na = a + o * (1 - a);
      if (na <= 0) return;
      D[q] = (r * a + D[q] * o * (1 - a)) / na; D[q + 1] = (gg * a + D[q + 1] * o * (1 - a)) / na; D[q + 2] = (b * a + D[q + 2] * o * (1 - a)) / na; D[q + 3] = na;
    }
    // Gummispuren: Reifenpaare (Spurweite ~1,6 m auf 1,9 m Bandbreite), Streifen mit Anfang/Ende, Längsfaser
    [[REG.rub, 0.34, 26], [REG.rubL, 0.2, 18]].forEach(function (R) {
      var x0 = R[0][0] * N, x1 = R[0][2] * N, w = x1 - x0, A = R[1];
      for (var k = 0; k < R[2]; k++) {
        var jit = (rnd() - 0.5) * w * 0.12, len0 = rnd() * N * 0.35, len1 = N - rnd() * N * 0.35, tw = 2 + rnd() * 5, a = A * (0.5 + rnd() * 0.7);
        [0.2, 0.8].forEach(function (c) {
          var cx = x0 + w * c + jit;
          for (var y = Math.floor(len0); y < len1; y++) {
            var fade = smooth(len0, len0 + 40, y) * smooth(len1, len1 - 60, y), wob = Math.sin(y * 0.02 + k) * 1.5;
            for (var x = Math.floor(cx - tw + wob); x <= cx + tw + wob; x++) {
              if (x < x0 + 2 || x > x1 - 2) continue;
              var e = 1 - Math.abs(x - cx - wob) / (tw + 0.5);
              if (e > 0) over(px(x, y), 18, 18, 20, a * fade * e * (0.7 + 0.3 * Math.sin(y * 1.7 + x)));
            }
          }
        });
      }
    });
    // Flicken: dunkler, neuerer Asphalt mit unregelmäßigem Rand und Vergussfuge
    (function () {
      var x0 = REG.patch[0] * N, y0 = REG.patch[1] * N, w = (REG.patch[2] - REG.patch[0]) * N, h = (REG.patch[3] - REG.patch[1]) * N;
      var f = fbmField(64, rnd, [[4, 0.6], [16, 0.4]]);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var u = x / w, v = y / h, edge = Math.min(u, v, 1 - u, 1 - v) * 2, jag = (f[(y >> 2) % 64 * 64 + (x >> 2) % 64] - 0.5) * 0.12;
        var inside = edge - 0.1 - jag;
        if (inside < 0) continue;
        var seal = inside < 0.035, g = (seal ? 14 : 44) + (rnd() - 0.5) * 14;
        over(px(x0 + x, y0 + y), g, g + 1, g + 4, seal ? 0.95 : 0.92);
      }
    })();
    // Vergussnähte („Teerschlangen“): geschwungene schwarze Linien
    (function () {
      var x0 = REG.snake[0] * N, x1 = REG.snake[2] * N, y0 = REG.snake[1] * N, y1 = REG.snake[3] * N, w = x1 - x0;
      for (var k = 0; k < 3; k++) {
        var cx = x0 + w * (0.25 + k * 0.25), ph = rnd() * TAU, fr = 0.02 + rnd() * 0.03, amp = w * 0.12, tw = 1.5 + rnd() * 2;
        for (var y = y0 + 6; y < y1 - 6; y++) {
          var xm = cx + Math.sin(y * fr + ph) * amp + Math.sin(y * 0.13 + k) * 2, fade = smooth(y0 + 6, y0 + 30, y) * smooth(y1 - 6, y1 - 30, y);
          for (var x = Math.floor(xm - tw); x <= xm + tw; x++) if (x > x0 + 1 && x < x1 - 1) over(px(x, y), 10, 10, 12, 0.85 * fade * (1 - Math.abs(x - xm) / (tw + 0.6)));
        }
      }
    })();
    // Farbe (weiß, Korn): Vertex-Farbe färbt (weiß/gelb/schwarz)
    (function () {
      for (var y = Math.floor(REG.paint[1] * N) - 4; y < REG.paint[3] * N + 4; y++) for (var x = Math.floor(REG.paint[0] * N) - 4; x < REG.paint[2] * N + 4; x++) {
        var r = rnd(), v = 236 + (r - 0.5) * 30;
        over(px(x, y), v, v, v, r < 0.06 ? 0.55 : 0.94);
      }
    })();
    var d = new Uint8Array(N * N * 4);
    for (i = 0; i < N * N; i++) { d[i * 4] = clamp(D[i * 4], 0, 255); d[i * 4 + 1] = clamp(D[i * 4 + 1], 0, 255); d[i * 4 + 2] = clamp(D[i * 4 + 2], 0, 255); d[i * 4 + 3] = clamp(D[i * 4 + 3] * 255, 0, 255); }
    var t = dataTex(d, N, N, true, aniso);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return (TEX.decal = t);
  }
  // Fangzaun: Rautengeflecht (Alpha), 64² = 0,5 m
  function fenceTex(aniso) {
    if (TEX.fence) return TEX.fence;
    var N = 64, d = new Uint8Array(N * N * 4);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var a = Math.min(Math.abs(((x + y) % 16) - 8), Math.abs(((x - y + 64) % 16) - 8)), w = a < 1.2 ? 1 : a < 2 ? 0.4 : 0, i = (y * N + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 200; d[i + 3] = w * 255;
    }
    return (TEX.fence = dataTex(d, N, N, true, aniso));
  }

  // ---- Geometrie-Sammler (indiziert): pos, uv, Farbe (3 oder 4), Zusatz (aRun) ----
  function Batch(cs, es) { this.pos = []; this.uv = []; this.col = []; this.ext = []; this.idx = []; this.cs = cs || 0; this.es = es || 0; }
  Batch.prototype.v = function (x, y, z, u, v, c, e) {
    this.pos.push(x, y, z); this.uv.push(u, v);
    if (this.cs) for (var k = 0; k < this.cs; k++) this.col.push(c[k]);
    if (this.es) for (var q = 0; q < this.es; q++) this.ext.push(e[q]);
    return this.pos.length / 3 - 1;
  };
  // Gitter aus R Ringen × C Spalten ab Index base; keep(r) = Viereck r…r+1 zeichnen; up = erwartete Normale
  // (Wicklung wird danach ausgerichtet)
  Batch.prototype.grid = function (base, R, C, keep, up) {
    var i0 = this.idx.length;
    for (var r = 0; r < R - 1; r++) {
      if (keep && !keep(r)) continue;
      for (var c = 0; c < C - 1; c++) { var a = base + r * C + c, b = a + 1, d = a + C, e = d + 1; this.idx.push(a, d, b, b, d, e); }
    }
    if (up && this.idx.length > i0) this.orient(i0, up);
  };
  Batch.prototype.orient = function (i0, up) {
    var P = this.pos, I = this.idx, sum = 0;
    for (var t = i0; t < I.length; t += 3 * Math.max(1, Math.floor((I.length - i0) / 30))) {
      var a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      var ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      sum += (uy * vz - uz * vy) * up[0] + (uz * vx - ux * vz) * up[1] + (ux * vy - uy * vx) * up[2];
    }
    if (sum < 0) for (var q = i0; q < I.length; q += 3) { var tmp = I[q + 1]; I[q + 1] = I[q + 2]; I[q + 2] = tmp; }
  };
  Batch.prototype.geo = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.cs) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, this.cs));
    if (this.es) g.setAttribute('aRun', new THREE.Float32BufferAttribute(this.ext, this.es));
    g.setIndex(this.idx); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  };

  function build(S) {
    var T = S.T, P = S.P, n = S.n, ds = S.ds, HALF = S.HALF, hAt = S.heightAt, theme = S.theme, own = S.own, g = S.g;
    var cfg = theme.surface || {}, rnd = S.rng(31), aniso = Math.min(16, S.maxAniso || 4), lin = S.lin;
    var stats = { draws: 0, tris: 0, texBytes: 0 }, texSeen = [];
    var Kit = root.CarTrackThemes && root.CarTrackThemes.Kit;
    function tex(t) { if (texSeen.indexOf(t) < 0) { texSeen.push(t); stats.texBytes += t.trackBytes || 0; own(t); } return t; }
    function addMesh(geo, mat, ro) {
      var m = new THREE.Mesh(own(geo), own(mat)); m.userData.surface = true; if (ro) m.renderOrder = ro;
      g.add(m); stats.draws++; stats.tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      return m;
    }
    function rgb(c) { var k = lin(c); return [k.r, k.g, k.b]; }
    function rgba(c, a) { var k = lin(c); return [k.r, k.g, k.b, a]; }
    function wrap(i) { return ((i % n) + n) % n; }
    // Punkt im Abstand d (links +) neben dem Rasterpunkt i bzw. bei Bogenlänge s
    function ptI(i, d) { var p = P[wrap(i)]; return [p.x + p.nx * d, p.z + p.nz * d]; }
    function ptS(s, d) { var a = T.at(s); return [a.x + a.nx * d, a.z + a.nz * d, a]; }

    // ---- Ideallinie: Scheitel innen, an Ein-/Ausgang außen (geglättet), Bremszonen ----
    var CRV = new Float64Array(n), LINE = new Float64Array(n), BRAKE = new Float64Array(n), i, k;
    for (i = 0; i < n; i++) CRV[i] = P[i].curv;
    function meanC(i0, a, b) { var s = 0; for (var q = a; q <= b; q++) s += CRV[wrap(i0 + q)]; return s / (b - a + 1); }
    var tgt = new Float64Array(n);
    for (i = 0; i < n; i++) {
      var here = Math.tanh(40 * meanC(i, -5, 5)), near = (meanC(i, 8, 40) + meanC(i, -40, -8)) / 2;
      tgt[i] = 3.0 * here - 3.0 * Math.tanh(45 * near) * (1 - Math.abs(here));
    }
    for (i = 0; i < n; i++) { var sm = 0; for (k = -12; k <= 12; k++) sm += tgt[wrap(i + k)]; LINE[i] = clamp(sm / 25, -3.3, 3.3); }
    T.corners.forEach(function (c) {
      var i0 = Math.round(c.s0 / ds);
      for (var q = -28; q <= 4; q++) BRAKE[wrap(i0 + q)] = Math.max(BRAKE[wrap(i0 + q)], smooth(-28, -14, q) * smooth(4, 0, q));
    });

    // ---- Asphalt: UV (Querabstand, Bogenlänge je Querlinie, ganze Kacheln je Runde) ----
    var at = asphaltTex(aniso);
    var road = new Batch(3), TILE = 10;
    // Band entlang des Rasters mit Querlinien ds[], Kacheln je Querlinie geschlossen; fn(i, j) → { d, y, c }
    function loopBand(b, D, yFn, colFn, uFn) {
      var C = D.length, base = b.pos.length / 3, arc = [], acc = new Float64Array(C), j, prev = null;
      for (i = 0; i <= n; i++) {
        var row = [];
        for (j = 0; j < C; j++) {
          var xz = ptI(i, D[j]); row.push(xz);
          if (prev) acc[j] += Math.hypot(xz[0] - prev[j][0], xz[1] - prev[j][1]);
        }
        arc.push(Float64Array.from(acc)); prev = row;
      }
      var scale = [];
      for (j = 0; j < C; j++) { var tot = acc[j] || 1; scale.push(Math.max(1, Math.round(tot / TILE)) / tot); }
      for (i = 0; i <= n; i++) for (j = 0; j < C; j++) {
        var q = ptI(i, D[j]);
        b.v(q[0], hAt(q[0], q[1]) + yFn(i, j), q[1], uFn(j), arc[i][j] * scale[j], colFn(wrap(i), D[j]));
      }
      b.grid(base, n + 1, C, null, [0, 1, 0]);
    }
    var RD = [];
    for (k = 0; k <= 12; k++) RD.push(-HALF + k * (2 * HALF / 12));
    var tone = S.rng(33), ringTone = new Float64Array(n);
    // großflächige Tönung längs (ältere/neuere Abschnitte), weich
    var knots = []; for (k = 0; k < 12; k++) knots.push(0.95 + tone() * 0.1);
    for (i = 0; i < n; i++) { var f = i / n * 12, k0 = Math.floor(f), tt = f - k0; tt = tt * tt * (3 - 2 * tt); ringTone[i] = lerp(knots[k0 % 12], knots[(k0 + 1) % 12], tt); }
    loopBand(road, RD, function () { return 0.03; }, function (ii, d) {
      var w = Math.exp(-Math.pow((d - LINE[ii]) / 1.5, 2)), dark = 1 - 0.16 * w - 0.08 * w * BRAKE[ii];
      var v = ringTone[ii] * dark; return [v, v, v];
    }, function (j) { return (RD[j] + HALF) / TILE; });
    // Boxengasse (Speedway): Asphaltstreifen zwischen Mauer und Boxengebäude
    var pit = S.pit;
    if (pit) {
      var base0 = road.pos.length / 3, PR = 0, pd0 = function (a) { return HALF + (pit.sd > 0 ? a.runL : a.runR) + 0.75; };
      for (var ps = pit.s0; ps <= pit.s1 + 1e-6; ps += 1, PR++) {
        var pa = T.at(ps), lo = pd0(pa), hi = HALF + 15.3;
        for (var pj = 0; pj <= 2; pj++) {
          var dd = pit.sd * lerp(lo, Math.max(lo + 0.5, hi), pj / 2), x = pa.x + pa.nx * dd, z = pa.z + pa.nz * dd;
          road.v(x, hAt(x, z) + 0.02, z, Math.abs(dd) / TILE, (ps - pit.s0) / TILE, [0.97, 0.97, 0.97]);
        }
      }
      road.grid(base0, PR, 3, null, [0, 1, 0]);
    }
    addMesh(road.geo(), new THREE.MeshStandardMaterial({ map: tex(at.map), normalMap: tex(at.normal), normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: tex(at.rough), roughness: 1, metalness: 0, vertexColors: true, envMapIntensity: 0.5 }));

    // ---- Aufkleber (ein Zeichenaufruf) ----
    var dec = new Batch(4), Y_DEC = 0.042;
    // Band von s0 bis s1, Querlage dFn(s) → [d0, d1], Atlas-Bereich R; tile = Bereich je Ring spiegeln (Farbe/Korn)
    function decal(s0, s1, dFn, R, c, tile, cols) {
      cols = cols || 2;
      var L = s1 - s0, steps = Math.max(1, Math.ceil(L / 1.0)), base = dec.pos.length / 3;
      for (var r = 0; r <= steps; r++) {
        var s = s0 + L * r / steps, dd = dFn(s), a = T.at(s), vv = tile ? (r % 2 ? R[3] : R[1]) : lerp(R[1], R[3], r / steps);
        for (var j = 0; j < cols; j++) {
          var d = lerp(dd[0], dd[1], j / (cols - 1)), x = a.x + a.nx * d, z = a.z + a.nz * d;
          dec.v(x, hAt(x, z) + Y_DEC, z, lerp(R[0], R[2], j / (cols - 1)), vv, c);
        }
      }
      dec.grid(base, steps + 1, cols, null, [0, 1, 0]);
    }
    function lineAt(s) { var u = ((s / ds) % n + n) % n, i0 = Math.floor(u), f = u - i0; return lerp(LINE[i0], LINE[(i0 + 1) % n], f); }
    // Gummi: Bremszone kräftig, Kurve leicht, Ausgang mittel – entlang der Ideallinie
    T.corners.forEach(function (c) {
      function along(w) { return function (s) { var l = lineAt(s); return [l - w, l + w]; }; }
      decal(c.s0 - 27, c.s0 + 3, along(1.0), REG.rub, [1, 1, 1, 1]);
      decal(c.s0 - 2, c.s0 + c.len + 2, along(1.05), REG.rubL, [1, 1, 1, 0.6]);
      decal(c.s0 + c.len - 3, c.s0 + c.len + 16, along(1.0), REG.rubL, [1, 1, 1, 0.9]);
    });
    // Flicken + Vergussnähte (nicht im Startbereich)
    for (k = 0; k < 5; k++) {
      var s0 = 15 + rnd() * (T.len - 40), len = 2.5 + rnd() * 4, w = 0.8 + rnd() * 1.2, cd = (rnd() - 0.5) * 2 * (HALF - 1 - w);
      decal(s0, s0 + len, function () { return [cd - w, cd + w]; }, REG.patch, [1, 1, 1, 1]);
    }
    for (k = 0; k < 9; k++) {
      var s1 = 12 + rnd() * (T.len - 30), l1 = 4 + rnd() * 7, c1 = (rnd() - 0.5) * 2 * (HALF - 1.5);
      decal(s1, s1 + l1, function () { return [c1 - 0.7, c1 + 0.7]; }, REG.snake, [1, 1, 1, 0.9]);
    }
    // weiße Randlinien (ganze Runde)
    [1, -1].forEach(function (sd) {
      decal(0, T.len, function () { return sd > 0 ? [HALF - 0.45, HALF - 0.25] : [-HALF + 0.25, -HALF + 0.45]; }, REG.paint, [1, 1, 1, 1], true);
    });
    // Start/Ziel-Schachbrett (2 × 10 Felder, ±0,8 m um s = 0) + weiße Startlinie davor
    var WHITE = [1, 1, 1, 1], BLACK = [0.035, 0.035, 0.04, 1], YEL = rgba(0xf2c200, 1);
    for (var cb = 0; cb < 2; cb++) for (var ca = 0; ca < 10; ca++) {
      (function (a, b) {
        var d0 = -HALF + a * (2 * HALF / 10), d1 = d0 + 2 * HALF / 10;
        decal(-0.8 + b * 0.8, b * 0.8, function () { return [d0, d1]; }, REG.paint, (a + b) % 2 ? BLACK : WHITE, true);
      })(ca, cb);
    }
    // Startplätze: Winkel (vorn quer, seitlich nach hinten) – Reihen wie in der Sim mit einem mittleren Auto (4,4 m)
    for (var row = 0; row < 5; row++) {
      var sf = -(1 + 2.2) - row * 6.9 + 2.25;   // Vorderkante knapp hinter dem Schachbrett
      [2.3, -2.3].forEach(function (dc) {
        decal(sf - 0.15, sf, function () { return [dc - 1.1, dc + 1.1]; }, REG.paint, WHITE, true);
        [-1.1, 1.1].forEach(function (e) { decal(sf - 1.0, sf, function () { return [dc + e - 0.07, dc + e + 0.07]; }, REG.paint, WHITE, true); });
      });
    }
    // Boxengasse: weiße Linie an der Mauer, gelbe Boxen vor den Toren
    if (pit) {
      var inner = function (s) { var a = T.at(s); return HALF + (pit.sd > 0 ? a.runL : a.runR) + 0.75; };
      decal(pit.s0, pit.s1, function (s) { var d0 = inner(s) + 0.25; return pit.sd > 0 ? [d0, d0 + 0.15] : [-d0 - 0.15, -d0]; }, REG.paint, WHITE, true);
      for (var gi = 0; gi < 10; gi++) {
        var gs = pit.mid - 21 + gi * 4.67;
        if (gs - 1.6 < pit.s0 || gs + 1.6 > pit.s1) continue;
        (function (gs0) {
          function lat(f) { return function (s) { var a = inner(s) + 0.6, b = HALF + 15.1, d0 = lerp(a, b, f[0]), d1 = lerp(a, b, f[1]); return pit.sd > 0 ? [d0, d1] : [-d1, -d0]; }; }
          decal(gs0 - 1.6, gs0 - 1.48, lat([0.3, 1]), REG.paint, YEL, true);
          decal(gs0 + 1.48, gs0 + 1.6, lat([0.3, 1]), REG.paint, YEL, true);
          decal(gs0 - 1.6, gs0 + 1.6, lat([0.3, 0.36]), REG.paint, YEL, true);
        })(gs);
      }
    }
    addMesh(dec.geo(), new THREE.MeshStandardMaterial({ map: tex(decalTex(aniso)), vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, roughness: 0.72, metalness: 0, envMapIntensity: 0.5 }), -1);

    // ---- Curbs: erhabenes Profil, Sägezahn-Rippen, Farbblöcke (je Thema), Rampen an den Enden ----
    var curbCols = (cfg.curb || [0xd8262b, 0xf4f4f4]).map(rgb), cb2 = new Batch(3);
    var PROF = [[0, 0.03, 0], [0.06, 0.058, 0.5], [0.3, 0.072, 1], [0.62, 0.072, 1], [0.84, 0.062, 0.5], [0.92, 0.03, 0], [0.99, 0.0, 0]];
    var runs = [];
    (function () {
      var start = -1;
      for (i = 0; i < n; i++) if (S.curvy(i) && !S.curvy(wrap(i - 1))) { start = i; break; }
      if (start < 0) return;
      for (var q = 0; q < n; q++) {
        var ii = wrap(start + q);
        if (S.curvy(ii) && !S.curvy(wrap(ii - 1))) runs.push([start + q, start + q]);
        if (S.curvy(ii) && runs.length) runs[runs.length - 1][1] = start + q + 1;
      }
    })();
    runs.forEach(function (r) {
      var sA = r[0] * ds, sB = r[1] * ds, L = sB - sA;
      [1, -1].forEach(function (sd) {
        var base = cb2.pos.length / 3, R = 0, steps = Math.max(2, Math.round(L / 0.25)), prevBlk = -1;
        for (var q = 0; q <= steps; q++) {
          var sl = L * q / steps, blk = Math.floor(sl / 1.0 + 1e-6) % 2, s = sA + sl, a = T.at(s);
          var ramp = Math.min(1, sl / 1.2, (L - sl) / 1.2), rib = (function () { var ph = (sl / 0.75 + 1e-6) % 1; return ph < 0.67 ? ph / 0.67 : (1 - ph) / 0.33; })();
          var emit = function (cIdx) {
            for (var j = 0; j < PROF.length; j++) {
              var pr = PROF[j], d = sd * (HALF + pr[0]), x = a.x + a.nx * d, z = a.z + a.nz * d;
              var y = pr[1] > 0.03 ? 0.03 + (pr[1] - 0.03 + pr[2] * 0.016 * rib) * ramp : pr[1];
              cb2.v(x, hAt(x, z) + y, z, pr[0], sl / 2, curbCols[cIdx]);
            }
            R++;
          };
          if (prevBlk >= 0 && blk !== prevBlk) emit(prevBlk);   // harte Farbkante: Ring doppelt
          emit(blk); prevBlk = blk;
        }
        cb2.grid(base, R, PROF.length, null, [0, 1, 0]);
      });
    });
    // Wurst-Curbs an Schikanen (Kurven entgegengesetzter Richtung dicht hintereinander), innen am Scheitel
    var hw = Kit ? new Kit() : null, metal = Kit ? new Kit() : null;
    if (cfg.sausage && hw) {
      var cs = T.corners;
      cs.forEach(function (c, ci) {
        var nx = cs[(ci + 1) % cs.length], gap = ((nx.s0 - (c.s0 + c.len)) % T.len + T.len) % T.len;
        if (nx.dir === c.dir || gap > 18) return;
        [c, nx].forEach(function (cc) {
          var sm = cc.s0 + cc.len / 2, sd = cc.dir, a = T.at(sm), d = sd * (HALF + 1.35), x = a.x + a.nx * d, z = a.z + a.nz * d;
          var sz = new THREE.CylinderGeometry(0.16, 0.16, 2.6, 10, 1, false, 0, Math.PI);
          sz.rotateZ(Math.PI / 2);
          var cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
          hw.add(sz, function (vx, vy, vz) { return Math.floor(((vx - x) * cy - (vz - z) * sy) * 2.2 + 50) % 2 ? 0xf2c200 : 0x1d1e22; }, { x: x, y: hAt(x, z) + 0.0, z: z, ry: a.yaw });
          [-1.3, 1.3].forEach(function (e) {
            var cap = new THREE.SphereGeometry(0.16, 8, 4, 0, TAU, 0, Math.PI / 2), ex = x + Math.cos(a.yaw) * e, ez = z - Math.sin(a.yaw) * e;
            hw.add(cap, 0xf2c200, { x: ex, y: hAt(ex, ez), z: ez });
          });
        });
      });
    }
    var curbMat = new THREE.MeshStandardMaterial({ map: tex(curbTex(aniso)), vertexColors: true, roughness: 0.55, metalness: 0, flatShading: true, envMapIntensity: 0.6 });
    if (cb2.idx.length) addMesh(cb2.geo(), curbMat);

    // ---- Auslauf: Gras (Mähstreifen, Saum) ↔ Kies/Sand/Asphalt, weich gemischt ----
    var kind = cfg.runoff || 'gravel', loose = kind === 'tarmac' ? at : looseTex(kind, aniso);
    var GM = { 1: new Float64Array(n), '-1': new Float64Array(n) };
    [1, -1].forEach(function (sd) {
      for (i = 0; i < n; i++) { var s2 = 0, wsum = 0; for (k = -3; k <= 3; k++) { var wk = 4 - Math.abs(k); s2 += S.gravel[sd][wrap(i + k)] * wk; wsum += wk; } GM[sd][i] = s2 / wsum; }
    });
    var fbm = root.CarTrackThemes ? root.CarTrackThemes.fbm : function () { return 0.5; };
    var ro = new Batch(3, 3), FR = [0.15, 0.3, 0.5, 0.7, 0.85, 1.0];
    function undul(x, z) { return (fbm(x / 1.9, z / 1.9) - 0.5) * 0.09; }
    [1, -1].forEach(function (sd) {
      var base = ro.pos.length / 3;
      for (i = 0; i <= n; i++) {
        var ii = wrap(i), Rr = S.runAt(ii, sd) + 0.3, gm = kind === 'tarmac' ? 1 : GM[sd][ii];
        var E = [0, 0.95];
        FR.forEach(function (f) { E.push(Math.max(0.95 + 0.01, 0.95 + (Rr - 0.95) * f)); });
        E.push(Math.max(E[E.length - 1] + 0.05, Rr + 0.6), Math.max(E[E.length - 1] + 0.1, Rr + 1.5));
        for (var j = 0; j < E.length; j++) {
          var e = E[j], last = j === E.length - 1, d = sd * (HALF + e), x = P[ii].x + P[ii].nx * d, z = P[ii].z + P[ii].nz * d, h = hAt(x, z);
          var mixL = kind === 'tarmac' ? smooth(0.9, 1.0, e) * smooth(Rr + 0.25, Rr + 0.05, e) : smooth(1.0, 1.7, e) * smooth(Rr - 0.1, Rr - 0.7, e);
          var mx = clamp(gm * mixL, 0, 1), y = last ? -0.045 : 0.02 + (kind === 'tarmac' ? 0 : mx * undul(x, z));
          var c = lin(S.gc(x, z, h, e)), fringe = 1 - 0.14 * smooth(Rr - 0.6, Rr + 0.3, e) * smooth(Rr + 1.5, Rr + 0.7, e);
          var stripe = smooth(0.95, 1.6, e) * smooth(Rr - 0.2, Rr - 0.9, e) * (cfg.stripes === false ? 0 : 1);
          ro.v(x, h + y, z, x / 12, z / 12, [c.r * fringe, c.g * fringe, c.b * fringe * 0.96], [e, mx, stripe]);
        }
      }
      ro.grid(base, n + 1, FR.length + 4, null, [0, 1, 0]);
    });
    var roMat = new THREE.MeshStandardMaterial({ map: tex(S.grassTex), normalMap: tex(loose.normal), vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.5 });
    tex(loose.map);
    var gScale = kind === 'sand' ? 1 / 2.6 : kind === 'tarmac' ? 1 / TILE : 1 / 1.7;
    roMat.onBeforeCompile = function (sh) {
      sh.uniforms.tLoose = { value: loose.map }; sh.uniforms.uLooseS = { value: gScale }; sh.uniforms.uLooseN = { value: kind === 'tarmac' ? 0.5 : 1.0 };
      sh.vertexShader = 'attribute vec3 aRun;\nvarying vec3 vRun;\nvarying vec2 vWxz;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRun = aRun;\nvWxz = position.xz;');
      sh.fragmentShader = 'uniform sampler2D tLoose;\nuniform float uLooseS;\nuniform float uLooseN;\nvarying vec3 vRun;\nvarying vec2 vWxz;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\nvec2 gUv = vWxz * uLooseS;\n' +
          'diffuseColor.rgb *= 1.0 + (step(0.5, fract(vRun.x / 5.0)) * 2.0 - 1.0) * 0.07 * vRun.z;\n' +
          'diffuseColor.rgb = mix(diffuseColor.rgb, sRGBToLinear(texture2D(tLoose, gUv)).rgb, vRun.y);')
        .replace('#include <normal_fragment_maps>', 'vec3 mapN = texture2D(normalMap, gUv).xyz * 2.0 - 1.0;\n' +
          'mapN.xy *= normalScale * mix(0.12, uLooseN, vRun.y);\nnormal = perturbNormal2Arb(-vViewPosition, normal, mapN, faceDirection);');
    };
    roMat.customProgramCacheKey = function () { return 'track-runoff'; };
    addMesh(ro.geo(), roMat);
    // Kieselsteine (Instanzen) im Kiesbett
    if (kind === 'gravel') {
      var spots = [], prnd = S.rng(37), PCOL = [0xcfc6b4, 0xb3a68f, 0x9b958b, 0xe0d6c0, 0x8c8478];
      [1, -1].forEach(function (sd) {
        for (i = 0; i < n && spots.length < 1600; i++) {
          if (GM[sd][i] < 0.85) continue;
          var Rr = S.runAt(i, sd) + 0.3, area = Math.max(0, Rr - 2.6), cnt = Math.floor(area * 0.6 + prnd());
          for (var q = 0; q < cnt; q++) {
            var e = 1.9 + prnd() * (Rr - 2.6), f2 = prnd(), d = sd * (HALF + e);
            var pa = P[i], pb = P[wrap(i + 1)], x = lerp(pa.x, pb.x, f2) + lerp(pa.nx, pb.nx, f2) * d, z = lerp(pa.z, pb.z, f2) + lerp(pa.nz, pb.nz, f2) * d;
            spots.push([x, hAt(x, z) + 0.02 + undul(x, z), z, 0.04 + prnd() * prnd() * 0.12, prnd() * TAU, PCOL[Math.floor(prnd() * PCOL.length)]]);
          }
        }
      });
      if (spots.length) {
        var pgeo = new THREE.OctahedronGeometry(1, 0), pim = new THREE.InstancedMesh(own(pgeo), own(new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true })), spots.length);
        var m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), eu = new THREE.Euler();
        spots.forEach(function (p, q) {
          eu.set(p[4] * 0.7, p[4], p[4] * 1.3); qt.setFromEuler(eu);
          m4.compose(new THREE.Vector3(p[0], p[1], p[2]), qt, new THREE.Vector3(p[3] * 1.3, p[3] * 0.6, p[3]));
          pim.setMatrixAt(q, m4); pim.setColorAt(q, lin(p[5]));
        });
        pim.instanceMatrix.needsUpdate = true; pim.frustumCulled = false; pim.userData.surface = true;
        g.add(pim); own(pim); stats.draws++; stats.tris += 8 * spots.length;
      }
    }

    // ---- Begrenzung (Vorderkante = Auslauf + 0,3 m) ----
    var barrier = cfg.barrier || (theme.rail === false ? 'tyres' : 'armco');
    // Ring i der Begrenzungslinie: Punkt, Richtung nach außen, Gierwinkel
    function bAt(i, sd, extra) {
      var ii = wrap(i), p = P[ii], off = sd * (HALF + S.runAt(ii, sd) + 0.3 + (extra || 0));
      var x = p.x + p.nx * off, z = p.z + p.nz * off;
      return { x: x, z: z, y: hAt(x, z), ox: p.nx * sd, oz: p.nz * sd, yaw: p.yaw };
    }
    // Profil entlang eines Abschnitts der Begrenzung extrudieren (flach schattiert, in Kit): prof = [[e, y]…],
    // colFn(Segment, i) → Farbe
    function tri(kit, A, B, C, c) { var k3 = lin(c); [A, B, C].forEach(function (v) { kit.pos.push(v[0], v[1], v[2]); kit.col.push(k3.r, k3.g, k3.b); }); }
    function extrude(kit, sd, i0, i1, prof, colFn, extra) {
      var prev = null;
      for (var q = i0; q <= i1; q++) {
        var b = bAt(q, sd, extra), ring = prof.map(function (pp) { return [b.x + b.ox * pp[0], b.y + pp[1], b.z + b.oz * pp[0]]; });
        if (prev) for (var j = 0; j < prof.length - 1; j++) {
          var cc = colFn(j, q);
          tri(kit, prev[j], ring[j], prev[j + 1], cc); tri(kit, prev[j + 1], ring[j], ring[j + 1], cc);
        }
        prev = ring;
      }
    }
    // Abschnitte je Seite: Reifen (Kies an der Kurven-Außenseite, ±2 m) oder Grundart
    function sections(sd, pred) {
      var out = [], cur = null;
      for (var q = 0; q < n; q++) {
        if (pred(q)) { if (!cur) cur = [q, q]; cur[1] = q + 1; } else if (cur) { out.push(cur); cur = null; }
      }
      if (cur) { if (out.length && out[0][0] === 0 && cur[1] === n) out[0] = [cur[0], n + out[0][1]]; else out.push(cur); }
      return out;
    }
    var tyreStack = root.CarTrackThemes && root.CarTrackThemes.tyreStack, tyreSpots = [], fenceSecs = [];
    var belt = [[0, 0.06], [0, 0.82], [0.03, 0.84], [0.03, 0.06]];
    var BELT_C = function (j, q) { return j === 1 ? 0x6b7078 : (Math.floor(q / 4) % 2 ? 0x2a2d33 : 0x22252a); };
    if (hw && metal) {
      [1, -1].forEach(function (sd) {
        // Reifen nur dort, wo die Kurve selbst ist (Außenseite, ±6 m), sonst Leitplanke
        var tyreAt = function (q) {
          if (barrier === 'tyres') return true; if (barrier === 'wall') return false;
          if (!S.gravel[sd][wrap(q)]) return false;
          for (var k2 = -6; k2 <= 6; k2++) if (CRV[wrap(q + k2)] * sd < -1 / 60) return true;
          return false;
        };
        var tyreSec = sections(sd, tyreAt), mainSec = barrier === 'tyres' ? [] : sections(sd, function (q) { return !tyreAt(q) || !tyreAt(q + 1); });
        if (barrier !== 'tyres' && !tyreSec.length) mainSec = [[0, n]];
        // Reifenstapel mit Gurt (Kart: Stapel kommen aus dem Thema, hier nur der Gurt davor)
        tyreSec.forEach(function (sec) {
          if (barrier === 'tyres') { extrude(hw, sd, sec[0], sec[1], belt, BELT_C, -0.28); return; }
          extrude(hw, sd, sec[0], sec[1], belt, BELT_C, 0);
          var acc = 0;
          for (var q = sec[0]; q < sec[1]; q++) {
            var a = bAt(q, sd, 0.36), b = bAt(q + 1, sd, 0.36), L = Math.hypot(b.x - a.x, b.z - a.z);
            for (; acc < L; acc += 0.64) { var f = acc / L, x = lerp(a.x, b.x, f), z = lerp(a.z, b.z, f); tyreSpots.push([x, hAt(x, z), z, a.yaw]); }
            acc -= L;
          }
        });
        mainSec.forEach(function (sec) {
          if (barrier === 'wall') {
            // Betonmauer: Fuß verschmutzt, Front in Feldern leicht unterschiedlich, Krone hell
            extrude(hw, sd, sec[0], sec[1], [[0, -0.4], [0, 0.16], [0, 0.86], [0.06, 1.0], [0.28, 1.0], [0.34, 0.86], [0.34, -0.4]], function (j, q) {
              if (j === 0) return 0x8c8c86; if (j === 1) return Math.floor(q / 4) % 2 ? 0xd7d7d1 : 0xcfcfc8; if (j === 2 || j === 3) return 0xe4e4df; return 0xb4b4ae;
            });
            // Fangzaun: Pfosten alle 3 m (Metall), Geflecht als eigenes Band (unten)
            for (var q2 = sec[0]; q2 < sec[1]; q2 += 3) {
              var b = bAt(q2, sd, 0.2);
              metal.add(new THREE.BoxGeometry(0.09, 2.8, 0.09), 0x80868e, { x: b.x, y: b.y + 2.35, z: b.z });
              metal.add(new THREE.BoxGeometry(0.06, 0.06, 0.7), 0x80868e, { x: b.x + b.ox * 0.3, y: b.y + 3.72, z: b.z + b.oz * 0.3, ry: b.yaw, rx: 0 });
            }
            fenceSecs.push([sd, sec]);
          } else {
            // Leitplanke: zwei W-Profile übereinander, Pfosten alle 2 m
            var W = function (y0) { return [[0.07, y0], [0, y0 + 0.05], [0, y0 + 0.1], [0.06, y0 + 0.155], [0, y0 + 0.21], [0, y0 + 0.26], [0.07, y0 + 0.31]]; };
            var railC = function (j) { return j % 3 === 1 ? 0xd8dce2 : 0xb3b9c1; };
            extrude(metal, sd, sec[0], sec[1], W(0.36), railC);
            extrude(metal, sd, sec[0], sec[1], W(0.7), railC);
            for (var q3 = sec[0]; q3 <= sec[1]; q3 += 2) {
              var bp = bAt(q3, sd, 0.15);
              metal.add(new THREE.BoxGeometry(0.1, 1.45, 0.12), 0x6f757d, { x: bp.x, y: bp.y + 0.33, z: bp.z, ry: bp.yaw });
            }
          }
        });
      });
    }
    if (tyreSpots.length && tyreStack) {
      var tGeo = tyreStack(), tim = new THREE.InstancedMesh(own(tGeo), own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })), tyreSpots.length);
      var tc = [0xf2f2f2, 0xd8262b], m5 = new THREE.Matrix4(), q5 = new THREE.Quaternion(), yA = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
      tyreSpots.forEach(function (p, q) {
        q5.setFromAxisAngle(yA, p[3] + q * 0.7); m5.compose(new THREE.Vector3(p[0], p[1], p[2]), q5, one);
        tim.setMatrixAt(q, m5); tim.setColorAt(q, lin(tc[Math.floor(q / 3) % 2]));
      });
      tim.instanceMatrix.needsUpdate = true; tim.frustumCulled = false; tim.userData.surface = true;
      g.add(tim); own(tim); stats.draws++; stats.tris += tyreSpots.length * (tGeo.index ? tGeo.index.count : tGeo.attributes.position.count) / 3;
    }
    // Fangzaun-Geflecht (Stadion): ein Band je Abschnitt, durchscheinend, nach allem anderen gezeichnet
    if (fenceSecs.length) {
      var fb = new Batch(0);
      fenceSecs.forEach(function (fs) {
        var sd = fs[0], sec = fs[1], base = fb.pos.length / 3, acc = 0, prev = null, R = 0;
        for (var q = sec[0]; q <= sec[1]; q++) {
          var b = bAt(q, sd, 0.17);
          if (prev) acc += Math.hypot(b.x - prev.x, b.z - prev.z);
          fb.v(b.x, b.y + 1.0, b.z, acc / 0.5, 0); fb.v(b.x, b.y + 3.6, b.z, acc / 0.5, 2.6 / 0.5);
          prev = b; R++;
        }
        fb.grid(base, R, 2, null, null);
      });
      addMesh(fb.geo(), new THREE.MeshStandardMaterial({ map: tex(fenceTex(aniso)), color: 0xb9bec6, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        metalness: 0.4, roughness: 0.5, envMapIntensity: 0.6 }), 1);
    }

    // ---- Rand-Deko: Streckenposten, Countdown-Tafeln ----
    if (hw) {
      var nMarsh = 0;
      T.corners.forEach(function (c, ci) {
        if (nMarsh >= 6 || ci % 2) return;
        var sd = -c.dir, s = c.s0 - 5, a = T.at(s), off = HALF + (sd > 0 ? a.runL : a.runR) + 2.6, x = a.x + a.nx * sd * off, z = a.z + a.nz * sd * off;
        if (S.trackDist(x, z, off + 1) < off - 0.5 || !S.place(x, z, 1.5, true)) return;
        var y = hAt(x, z), ry = a.yaw, lz = -sd;   // lokal z = −sd → zur Strecke hin
        function at3(lx, ly, lz2) { var c2 = Math.cos(ry), s2 = Math.sin(ry); return { x: x + lx * c2 + lz2 * s2, y: y + ly, z: z - lx * s2 + lz2 * c2 }; }
        function put(geo, col, lx, ly, lz2, o) { var p3 = at3(lx, ly, lz2); o = o || {}; o.x = p3.x; o.y = p3.y; o.z = p3.z; o.ry = ry + (o.ry || 0); hw.add(geo, col, o); }
        put(new THREE.BoxGeometry(2.0, 0.2, 1.6), 0x9a9a94, 0, 0.0, 0);
        put(new THREE.BoxGeometry(1.7, 2.1, 1.3), 0xf1f1ee, 0, 1.15, 0);
        put(new THREE.BoxGeometry(1.72, 0.55, 1.32), 0x2e3540, 0, 1.55, lz * 0.01);
        put(new THREE.BoxGeometry(2.1, 0.14, 1.7), 0xf08a24, 0, 2.27, 0);
        put(new THREE.BoxGeometry(0.06, 1.8, 0.06), 0xdadada, 0.75, 1.0, lz * 0.95);
        put(new THREE.BoxGeometry(0.02, 0.4, 0.55), 0xf2c200, 0.75, 1.65, lz * 0.95);
        put(new THREE.BoxGeometry(0.02, 0.4, 0.55), 0x2a6fd6, 0.79, 1.65, lz * 0.95);
        nMarsh++;
      });
      // Countdown-Tafeln: vor Kurven mit langer Anfahrt, 2 Streifen bei 50 m, 1 Streifen bei 25 m (außen)
      var cs2 = T.corners;
      cs2.forEach(function (c, ci) {
        var pv = cs2[(ci - 1 + cs2.length) % cs2.length], appr = ((c.s0 - (pv.s0 + pv.len)) % T.len + T.len) % T.len;
        [[50, 2], [25, 1]].forEach(function (bd) {
          if (appr < bd[0] + 8) return;
          var sd = -c.dir, s = c.s0 - bd[0], a = T.at(s), off = HALF + (sd > 0 ? a.runL : a.runR) + 1.1, x = a.x + a.nx * sd * off, z = a.z + a.nz * sd * off;
          if (S.trackDist(x, z, off + 1) < off - 0.5 || !S.place(x, z, 0.8, true)) return;
          var y = hAt(x, z), ry = a.yaw, c2 = Math.cos(ry), s2 = Math.sin(ry);
          function W3(lx, ly, lz) { return [x + lx * c2 + lz * s2, y + ly, z - lx * s2 + lz * c2]; }
          [-0.36, 0.36].forEach(function (lz) { var p3 = W3(0.05, 0, lz); hw.add(new THREE.BoxGeometry(0.07, 2.2, 0.07), 0x5b6068, { x: p3[0], y: p3[1] + 1.1, z: p3[2], ry: ry }); });
          var pp = W3(0, 0, 0); hw.add(new THREE.BoxGeometry(0.04, 1.2, 0.9), 0xf4f4f2, { x: pp[0], y: pp[1] + 1.55, z: pp[2], ry: ry });
          // schräge Streifen (Parallelogramme) auf der Front (lokal −x, der Anfahrt zugewandt)
          var Wd = 0.16, SL = 0.32, span = bd[1] * Wd + (bd[1] - 1) * 0.12 + SL, z0 = -span / 2;
          for (var k3 = 0; k3 < bd[1]; k3++) {
            var za = z0 + k3 * (Wd + 0.12), A = W3(-0.025, 1.0, za), B = W3(-0.025, 1.0, za + Wd), C = W3(-0.025, 2.1, za + Wd + SL), D = W3(-0.025, 2.1, za + SL);
            tri(hw, A, D, B, 0xd8262b); tri(hw, B, D, C, 0xd8262b);
          }
        });
      });
    }
    if (hw && !hw.empty()) addMesh(hw.geo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide }));
    if (metal && !metal.empty()) addMesh(metal.geo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.65, envMapIntensity: 1.0, side: THREE.DoubleSide }));

    // ---- Startampel am Portal (lokal: x = Fahrtrichtung, z quer, Balken bei y 4,6) – Lampen aus ----
    if (S.gantry && Kit) {
      var sk = new Kit();
      sk.add(new THREE.BoxGeometry(0.34, 0.8, 3.3), 0x15171b, { x: -0.36, y: 3.72 });
      [-1.2, 1.2].forEach(function (z) { sk.add(new THREE.BoxGeometry(0.1, 0.35, 0.1), 0x2b2f36, { x: -0.3, y: 4.25, z: z }); });
      for (var lc = 0; lc < 5; lc++) for (var lr = 0; lr < 2; lr++) {
        var lzc = -1.32 + lc * 0.66;
        sk.add(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 8), 0x090a0c, { x: -0.54, y: 3.55 + lr * 0.34, z: lzc, rz: Math.PI / 2 });
        sk.add(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 8), lr ? 0x3a0b0b : 0x2a0909, { x: -0.575, y: 3.55 + lr * 0.34, z: lzc, rz: Math.PI / 2 });
      }
      var slm = new THREE.Mesh(own(sk.geo()), own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2 })));
      slm.userData.surface = true; S.gantry.add(slm); stats.draws++;
    }
    return { stats: stats };
  }

  root.CarTrackSurface = { build: build, REG: REG };
})(typeof window !== 'undefined' ? window : this);
