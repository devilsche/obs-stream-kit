/* Grashalme für Car Drive (three r128) – nur im Browser-Spiel (tools/car-drive.html), nicht im Overlay (js/car-race.js).
 *
 *   CarDriveGrass.create(THREE, res, { reduce, quality }) → { update(dt, cam, car), stats(), dispose() }
 *   res      = CarTrackScene.build(…) (braucht res.grassAt, res.theme, res.group)
 *   reduce   = prefers-reduced-motion: Halme stehen still (kein Wiegen)
 *   quality  = 'full' | 'light' (Zuschauer „Light“: halbe Dichte als Obergrenze)
 *   update(dt, cam, car)  je Bild; cam = Kamera (Position), car = { x, z, r } eigenes Auto (Halme ducken sich) oder null
 *   stats()  → { instances, capacity, tiles, cached, q, draws, tris }
 *
 * Aufbau: Kachel-Gitter (8 m) um die Kamera bis Radius R (je Thema 42–60 m). Je Kachel wird einmal eine Liste von
 * Grasbüscheln erzeugt (fester Zufall aus Kachel + Strecke, nur wo res.grassAt > 0: nicht auf Fahrbahn, Curbs, Kies,
 * Sand, Asphalt, Begrenzung, Boxengasse, Deko-Plätzen und nur auf grüner Bodenfarbe) und zwischengespeichert; beim
 * Fahren wandert das Gitter mit, Kacheln werden nur neu belegt (aus dem Speicher oder neu berechnet mit Zeitbudget
 * ~2 ms je Bild, 8 ms solange Kacheln im Umkreis von 20 m fehlen). Alle aktiven Büschel landen in EINER InstancedBufferGeometry (ein Zeichenaufruf).
 * Büschel = 3 gebogene Halme (je 5 Dreiecke) + optional Blüte (Alpen). Der Vertex-Shader (onBeforeCompile auf einem
 * MeshStandardMaterial → Licht und Nebel wie die Szene) biegt die Halme im Wind, duckt sie unter dem Auto, dünnt nach
 * außen aus (Rang je Büschel gegen Dichte nach Abstand) und lässt sie zum Rand des Radius flach werden – dahinter
 * bleibt das Foto-Gras des Bodens. Farbe = Bodenfarbe an der Stelle (wie das Foto-Gras getönt), Basis dunkler,
 * Spitzen heller.
 * Leistung: Dichte-Faktor q passt sich der Bildrate an (unter ~42 fps runter, über ~57 fps langsam wieder hoch).
 */
(function (root) {
  'use strict';
  var TILE = 8, CACHE_MAX = 700, STRIDE = 11, TRIS = 17;
  // Halmhöhe h (m), Breite w (m), Büschel je m², Radius R, Biegung, Fleckigkeit, Höhen-Streuung, Blüten-Anteil, Wind
  var PRESET = {
    stadium:    { dens: 16, h: [0.22, 0.42], w: 0.026, R: 60, curve: 0.3, patch: 0.25, hvar: 0.45, flowers: 0, wind: 0.35 },
    forest:     { dens: 14, h: [0.2, 0.5], w: 0.026, R: 60, curve: 0.4, patch: 0.5, hvar: 0.7, flowers: 0, wind: 0.45 },
    alpine:     { dens: 12, h: [0.15, 0.4], w: 0.024, R: 60, curve: 0.35, patch: 0.35, hvar: 0.6, flowers: 0.08, wind: 0.6 },
    coast:      { dens: 4, h: [0.3, 0.75], w: 0.02, R: 60, curve: 0.55, patch: 0.8, hvar: 0.6, flowers: 0, wind: 0.9, tint: [1.1, 1.0, 0.72] },
    industrial: { dens: 1.0, h: [0.12, 0.3], w: 0.02, R: 50, curve: 0.35, patch: 0.45, hvar: 0.5, flowers: 0, wind: 0.4 },
    plain:      { dens: 1.4, h: [0.15, 0.35], w: 0.02, R: 55, curve: 0.35, patch: 0.3, hvar: 0.4, flowers: 0, wind: 0.45 }
  };

  function hash2(x, z) { var s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, z) {
    var ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    var a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  function rngFor(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // Büschel-Geometrie: 3 Halme (unten breit, Spitze ein Punkt) + Blüte (Raute an der Spitze von Halm 0)
  // position = (Querversatz × Breite, Höhenanteil t, Blüte senkrecht), aB = (Winkel, Biegung, Versatz x, z),
  // aF = (ist Blüte, Querversatz der Blüte)
  function clumpGeo(THREE) {
    var pos = [], aB = [], aF = [], idx = [], rnd = rngFor(9127), T = [0, 0.35, 0.7], W = [1, 0.8, 0.5];
    for (var b = 0; b < 3; b++) {
      var ang = rnd() * Math.PI * 2, cu = 0.4 + rnd() * 0.6, ox = (rnd() - 0.5) * 2, oz = (rnd() - 0.5) * 2, base = pos.length / 3;
      if (b === 0) { ox *= 0.3; oz *= 0.3; }
      for (var r = 0; r < 3; r++) [-0.5, 0.5].forEach(function (sd) { pos.push(sd * W[r], T[r], 0); aB.push(ang, cu, ox, oz); aF.push(0, 0); });
      pos.push(0, 1, 0); aB.push(ang, cu, ox, oz); aF.push(0, 0);
      for (r = 0; r < 2; r++) { var o = base + r * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      idx.push(base + 4, base + 5, base + 6);
      if (b === 0) {
        var fb = pos.length / 3;
        [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (f) { pos.push(0, 1, f[1]); aB.push(ang, cu, ox, oz); aF.push(1, f[0]); });
        idx.push(fb, fb + 2, fb + 1, fb, fb + 1, fb + 3);
      }
    }
    var g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map(function (v, i) { return i % 3 === 1 ? 1 : 0; }), 3));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(aB, 4));
    g.setAttribute('aF', new THREE.Float32BufferAttribute(aF, 2));
    g.setIndex(idx);
    return g;
  }

  var VERT_HEAD = [
    'attribute vec4 aB;', 'attribute vec2 aF;', 'attribute vec4 iA;', 'attribute vec4 iB;', 'attribute vec3 iC;',
    'uniform float uTime;', 'uniform float uSway;', 'uniform vec2 uWind;', 'uniform vec4 uCar;', 'uniform vec2 uFade;',
    'uniform vec3 uLod;', 'uniform float uCurve;', 'uniform vec3 uTint;',
    'varying vec3 vGC;', ''
  ].join('\n');
  // ersetzt beginnormal_vertex: Lage, Biegung, Ausdünnen, Farbe; begin_vertex nimmt gPos
  var VERT_MAIN = [
    'float gT = position.y;',
    'float gC = cos(iA.w), gS = sin(iA.w);',
    'float gYaw = iA.w + aB.x;',
    'vec2 gDir = vec2(cos(gYaw), sin(gYaw));',
    'vec2 gSide = vec2(-gDir.y, gDir.x);',
    'float gSpread = 0.04 + 0.22 * iB.x;',
    'vec2 gBase = iA.xz + vec2(aB.z * gC - aB.w * gS, aB.z * gS + aB.w * gC) * gSpread;',
    'float gDist = distance(gBase, cameraPosition.xz);',
    'float gLod = uLod.z * min(1.0, pow(uLod.x / max(gDist, uLod.x), uLod.y));',
    'float gH = iB.x * (1.0 - smoothstep(uFade.x, uFade.y, gDist)) * (1.0 - smoothstep(gLod - 0.08, gLod, iB.z));',
    'vec2 gCd = gBase - uCar.xy;',
    'float gCl = length(gCd);',
    'float gPress = uCar.w * (1.0 - smoothstep(uCar.z * 0.55, uCar.z, gCl));',
    'gH *= 1.0 - 0.75 * gPress;',
    'float gVar = fract(iA.w * 3.713);',
    'float gPh = gVar * 6.2832 + dot(gBase, vec2(0.21, 0.17));',
    'float gSw = uSway * (sin(uTime * 1.7 + gPh) * 0.6 + sin(uTime * 0.63 + gPh * 0.5 + gBase.x * 0.05) * 0.4);',
    'vec2 gBendV = uWind * (0.6 + gSw) + gDir * aB.y * uCurve + gCd / max(gCl, 0.001) * gPress * 1.4;',
    'vec2 gBend = gBendV * gT * gT;',
    'float gBl = min(length(gBend), 0.9);',
    'vec2 gXZ = gBase + gSide * position.x * iB.y * (1.0 + gDist / 9.0) + gBend * gH;',
    'vec3 gPos = vec3(gXZ.x, iA.y + gH * gT * (1.0 - 0.45 * gBl * gBl), gXZ.y);',
    'float gFs = 0.03 * step(0.5, iB.w) * aF.x * step(0.01, gH);',
    'gPos += vec3(gSide.x * aF.y * gFs, position.z * gFs, gSide.y * aF.y * gFs);',
    'vec3 objectNormal = normalize(vec3(gBendV.x * 0.4 + gDir.x * 0.25, 1.0, gBendV.y * 0.4 + gDir.y * 0.25));',
    'vec3 gBaseC = iC * uTint * (0.84 + gVar * 0.32);',
    'vGC = mix(gBaseC * 0.5, gBaseC * 1.28 + vec3(0.025, 0.022, 0.0), gT);',
    'if (aF.x > 0.5) vGC = iB.w < 1.5 ? vec3(0.9, 0.9, 0.86) : iB.w < 2.5 ? vec3(0.95, 0.72, 0.08) : iB.w < 3.5 ? vec3(0.42, 0.2, 0.62) : vec3(0.25, 0.38, 0.85);'
  ].join('\n');

  // volle Dichte bis LOD_NEAR m, dahinter sanft weniger (vorher 12 m / 1,25 – ab ~20 m sah man kaum noch Halme)
  var LOD_NEAR = 28, LOD_EXP = 0.9;

  function create(THREE, res, opts) {
    opts = opts || {};
    if (!THREE || !res || !res.grassAt || !res.group) return null;
    var reduce = !!opts.reduce, theme = res.theme || {}, pr = PRESET[theme.id] || PRESET.plain;
    var qMax = opts.quality === 'light' ? 0.55 : 1, q = qMax;
    var CAP = opts.quality === 'light' ? 40000 : 110000;   // dichtes Gras (2026-11-24, vom User gewünscht: „man sah nix dichtes“)
    var seed = ((res.P && res.P.length) || 1) * 7919 + Math.round((res.P && res.P[0] ? res.P[0].x * 13 + res.P[0].z * 7 : 0));

    var geo = clumpGeo(THREE);
    var iA = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4), iB = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    var iC = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    [iA, iB, iC].forEach(function (a) { a.setUsage(THREE.DynamicDrawUsage); });
    geo.setAttribute('iA', iA); geo.setAttribute('iB', iB); geo.setAttribute('iC', iC);
    geo.instanceCount = 0;

    var wr = rngFor(seed + 31), wa = wr() * Math.PI * 2;
    var U = {
      uTime: { value: 0 }, uSway: { value: reduce ? 0 : 0.5 }, uWind: { value: new THREE.Vector2(Math.cos(wa), Math.sin(wa)).multiplyScalar(pr.wind * 0.35) },
      uCar: { value: new THREE.Vector4(0, 0, 1, 0) }, uFade: { value: new THREE.Vector2(pr.R * 0.7, pr.R) },
      uLod: { value: new THREE.Vector3(LOD_NEAR, LOD_EXP, q) }, uCurve: { value: pr.curve }, uTint: { value: new THREE.Vector3().fromArray(pr.tint || [1, 1, 1]) }
    };
    var mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    mat.onBeforeCompile = function (sh) {
      Object.keys(U).forEach(function (k) { sh.uniforms[k] = U[k]; });
      sh.vertexShader = VERT_HEAD + sh.vertexShader
        .replace('#include <beginnormal_vertex>', VERT_MAIN)
        .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');
      sh.fragmentShader = 'varying vec3 vGC;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGC;')
        // beidseitig, aber ohne Umklappen der Normale (Rückseite sonst dunkel)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);\ngeometryNormal = normal;');
    };
    mat.customProgramCacheKey = function () { return 'drive-grass'; };
    var mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = -1;
    res.group.add(mesh);

    // ---- Kacheln ----
    var cache = new Map(), active = [], queue = [], camTile = null, lastBuild = { x: 1e9, z: 1e9, t: 0, dirty: true }, clock = 0;
    var tmp = { y: 0, r: 0, g: 0, b: 0 }, RT = Math.ceil(pr.R / TILE);
    function key(tx, tz) { return (tx + 30000) * 65536 + (tz + 30000); }
    function buildTile(tx, tz) {
      var rnd = rngFor((key(tx, tz) * 2654435761 + seed) >>> 0), N = Math.round(TILE * TILE * pr.dens), out = new Float32Array(N * STRIDE), c = 0;
      for (var i = 0; i < N; i++) {
        var x = (tx + rnd()) * TILE, z = (tz + rnd()) * TILE, r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
        var pm = pr.patch ? Math.min(1, Math.max(0, 1 - pr.patch + pr.patch * (vnoise(x / 7, z / 7) * 1.9 - 0.35))) : 1;
        if (r1 >= pm) continue;
        var w = res.grassAt(x, z, tmp);
        if (!(w > 0) || r2 >= w) continue;
        var hv = 1 + pr.hvar * (vnoise(x / 11 + 17, z / 11 + 5) - 0.5) * 1.6;
        var h = (pr.h[0] + (pr.h[1] - pr.h[0]) * r3) * Math.max(0.3, hv) * (0.55 + 0.45 * w), o = c * STRIDE;
        out[o] = x; out[o + 1] = tmp.y; out[o + 2] = z; out[o + 3] = r4 * Math.PI * 2;
        out[o + 4] = h; out[o + 5] = pr.w * (0.8 + r2 * 0.4); out[o + 6] = 0;
        out[o + 7] = pr.flowers && rnd() < pr.flowers ? 1 + Math.floor(rnd() * 4) : 0;
        out[o + 8] = tmp.r * 0.8; out[o + 9] = tmp.g * 0.8; out[o + 10] = tmp.b * 0.8;
        c++;
      }
      for (i = 0; i < c; i++) out[i * STRIDE + 6] = (i + 0.5) / c;   // Rang (Erzeugungsfolge ist zufällig → jede Teilmenge gleichmäßig)
      return { n: c, d: out };
    }
    function getTile(k) { var t = cache.get(k); if (t) { cache.delete(k); cache.set(k, t); } return t; }
    function setActive(cx, cz) {
      active = []; queue = [];
      for (var a = -RT; a <= RT; a++) for (var b = -RT; b <= RT; b++) {
        var tx = cx + a, tz = cz + b;
        var dx = Math.max(0, Math.abs(a) - 0.5) * TILE, dz = Math.max(0, Math.abs(b) - 0.5) * TILE;
        if (dx * dx + dz * dz > pr.R * pr.R) continue;
        var t = { tx: tx, tz: tz, k: key(tx, tz), dn: Math.hypot(dx, dz) };
        active.push(t);
        if (!cache.has(t.k)) queue.push(t);
      }
      active.sort(function (u, v) { return u.dn - v.dn; });
      queue.sort(function (u, v) { return u.dn - v.dn; });
    }
    function lodAt(d) { return q * Math.min(1, Math.pow(LOD_NEAR / Math.max(d, LOD_NEAR), LOD_EXP)); }
    function rebuild(px, pz) {
      var A = iA.array, B = iB.array, C = iC.array, n = 0;
      for (var i = 0; i < active.length && n < CAP; i++) {
        var at = active[i], t = getTile(at.k);
        if (!t || !t.n) continue;
        var x0 = at.tx * TILE, z0 = at.tz * TILE;
        var dx = Math.max(0, x0 - px, px - x0 - TILE), dz = Math.max(0, z0 - pz, pz - z0 - TILE);
        var cnt = Math.min(t.n, Math.ceil(t.n * Math.min(1, lodAt(Math.hypot(dx, dz)) + 0.04)), CAP - n), d = t.d;
        for (var j = 0; j < cnt; j++, n++) {
          var o = j * STRIDE;
          A[n * 4] = d[o]; A[n * 4 + 1] = d[o + 1]; A[n * 4 + 2] = d[o + 2]; A[n * 4 + 3] = d[o + 3];
          B[n * 4] = d[o + 4]; B[n * 4 + 1] = d[o + 5]; B[n * 4 + 2] = d[o + 6]; B[n * 4 + 3] = d[o + 7];
          C[n * 3] = d[o + 8]; C[n * 3 + 1] = d[o + 9]; C[n * 3 + 2] = d[o + 10];
        }
      }
      [iA, iB, iC].forEach(function (a) { a.updateRange.offset = 0; a.updateRange.count = n * a.itemSize; a.needsUpdate = true; });
      geo.instanceCount = n;
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }

    // Bildrate → Dichte (geglättet; nach einer Änderung kurz warten)
    var ema = 1 / 60, slow = 0, fast = 0, lastNow = 0;
    function adapt(dt) {
      if (!(dt > 0)) { lastNow = 0; return; }
      var now = root.performance ? performance.now() : 0;
      if (lastNow && now > lastNow) dt = Math.min(0.5, (now - lastNow) / 1000);   // echte Bildzeit (dt des Spiels ist gekappt)
      lastNow = now;
      ema += (dt - ema) * 0.05;
      if (ema > 1 / 42) { slow += dt; fast = 0; } else if (ema < 1 / 57) { fast += dt; slow = 0; } else { slow = fast = 0; }
      if (slow > 1.5 && q > 0.2) { q = Math.max(0.2, q * 0.75); slow = 0; lastBuild.dirty = true; }
      else if (fast > 5 && q < qMax) { q = Math.min(qMax, q * 1.15); fast = 0; lastBuild.dirty = true; }
      U.uLod.value.z = q;
    }

    var disposed = false;
    function update(dt, cam, car) {
      if (disposed || !cam) return;
      clock += dt || 0;
      if (!reduce) U.uTime.value += dt || 0;
      adapt(dt);
      if (car) U.uCar.value.set(car.x, car.z, car.r || 2.4, 1); else U.uCar.value.w = 0;
      var px = cam.position.x, pz = cam.position.z, ctx = Math.floor(px / TILE), ctz = Math.floor(pz / TILE);
      if (!camTile || camTile[0] !== ctx || camTile[1] !== ctz) { camTile = [ctx, ctz]; setActive(ctx, ctz); lastBuild.dirty = true; }
      // fehlende Kacheln mit Zeitbudget (nächste zuerst; solange nahe Kacheln fehlen, mehr Zeit)
      var t0 = root.performance ? performance.now() : 0, built = 0;
      while (queue.length) {
        var t = queue.shift(), budget = t.dn < 20 ? 8 : 2;
        if (!cache.has(t.k)) { cache.set(t.k, buildTile(t.tx, t.tz)); built++; }
        if (root.performance && performance.now() - t0 > budget) break;
      }
      if (built) lastBuild.dirty = true;
      var moved = Math.hypot(px - lastBuild.x, pz - lastBuild.z);
      if ((lastBuild.dirty || moved > 3) && clock - lastBuild.t > 0.06) {
        rebuild(px, pz); lastBuild.x = px; lastBuild.z = pz; lastBuild.t = clock; lastBuild.dirty = false;
      }
    }
    return {
      mesh: mesh,
      update: update,
      stats: function () {
        return { instances: geo.instanceCount, capacity: CAP, tiles: active.length, pending: queue.length, cached: cache.size, q: +q.toFixed(2), draws: geo.instanceCount ? 1 : 0, tris: geo.instanceCount * TRIS, theme: theme.id || 'plain' };
      },
      // Prüfskript: aktive Büschel-Positionen (Stichprobe)
      sample: function (max) {
        var out = [], n = geo.instanceCount, step = Math.max(1, Math.floor(n / (max || 500)));
        for (var i = 0; i < n; i += step) out.push([iA.array[i * 4], iA.array[i * 4 + 2]]);
        return out;
      },
      dispose: function () {
        if (disposed) return;
        disposed = true;
        if (mesh.parent) mesh.parent.remove(mesh);
        geo.dispose(); mat.dispose(); cache.clear(); active = []; queue = [];
      }
    };
  }
  root.CarDriveGrass = { create: create, PRESET: PRESET };
})(typeof window !== 'undefined' ? window : this);
