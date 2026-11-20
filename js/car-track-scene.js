/* Strecken-Kulisse aus einer CarRaceSim-Strecke (three r128) für das Car-Race-Overlay (js/car-race.js) und Car Drive
 * (js/car-drive.js): Gelände, Asphalt, Randlinien, Curbs, Kiesbett an Kurven-Außenseiten, Leitplanken am Rand des
 * Auslaufs, Start/Ziel mit Portal, dazu je Strecke ein Thema (js/car-track-themes.js: Stadion, Wald, Alpen, Küste,
 * Industrie) mit Himmel, Licht, Nebel, Bodenfarbe, Deko und optischem Höhenprofil.
 * Fahrbahn, Curbs, Auslauf, Begrenzung und Rand-Deko baut js/car-track-surface.js (nach der Deko); fehlt das Modul,
 * bleibt die einfache Fassung (flache Bänder) hier.
 *
 *   CarTrackScene.build(T, { primary, accent, maxAniso, reduceMotion }) → {
 *       group, theme, P, gantry, decor, nearTrack(x, z, R), trackDist(x, z, R),
 *       heightAt(x, z)         Höhe der Fahrbahn/des Geländes (nur Optik; Sim und Fahrphysik bleiben 2D),
 *       groundAt(x, z)         Höhe der Geländefläche, wie sie gezeichnet ist (für Dinge, die neben der Bahn stehen),
 *       slopeAt(x, z, yaw)     → { pitch, roll } Neigung eines Autos mit Blickrichtung yaw (Drehordnung YXZ wie
 *                              holder.rotation.set(roll, yaw, pitch)), normalAt(x, z) → Vector3,
 *       applyEnv(scene, renderer, { background })  Nebel, Licht (die Lichter aus js/car-stage.js), Belichtung,
 *                              optional Hintergrundfarbe (Car Drive; das Overlay bleibt durchsichtig, der Himmel ist
 *                              eine Kuppel in der Gruppe),
 *       update(dt)             Fahnen, Wellen, Leuchtturm (bei reduzierter Bewegung steht alles),
 *       setMotionBlur(m)       Bewegungsunschärfe der Fahrbahn längs der Strecke in Metern (Car Drive; 0 = aus),
 *       props                  Promise → propStats, sobald alle Kulissen-Modelle geladen/eingesetzt sind,
 *       propStats              { loaded: [key], failed: [key], tris, draws } der eingesetzten Kulissen-Modelle,
 *       grassAt(x, z, out)     Gras-Anteil 0…1 (Car Drive: Grashalme, js/car-drive-grass.js), out → { y, r, g, b },
 *       dispose()              entfernt alles, gibt frei und setzt Licht/Nebel zurück }
 *   opts.propGate()            optional: false = gerade keine Modelle laden/einsetzen (Car Race: während des Rennens)
 *   Kulissen-Modelle (Sketchfab, data/track-props, scripts/build_track_props.py): nach dem Aufbau nachgeladen, ersetzen
 *   je Platz die prozedurale Deko einer Art (ctx.kind(…, { prop })); fehlt der Katalog oder ein Modell, bleibt die
 *   prozedurale Deko. Vorlagen bleiben für die Seite im Speicher (nächstes Rennen ohne neues Laden).
 *   T = CarRaceSim.track(seed); primary/accent = Farben für Portal/Dächer (CSS-Farbtext oder Zahl);
 *   group noch nicht in der Szene (Aufrufer: scene.add(res.group)).
 *   decor = { objs: [{ o, r }], inst: [{ meshes, spots: [{ x, z, r, hidden }], setHidden(i, bool) }] } – was
 *   Kamerafahrten (Podest, Vorstellung) im Weg stehen kann; inst = Instanzen, ausblenden über setHidden (setzt die
 *   prozedurale Instanz und ein eingesetztes Kulissen-Modell auf eine Null-Matrix).
 *   Kiesbett-Regel: außen an Kurven (|curv| > 1/60, ±14 m), wo der Auslauf > 3 m ist – dieselbe Regel nutzt
 *   js/car-drive-phys.js (trackInfo) für die Fahrphysik.
 * Deko steht nie im Auslauf (≥ 14 m neben der Fahrbahn), Ausnahme: Banden/Reifenstapel/Zaun direkt hinter der Leitplanke.
 * Zeichenaufrufe: je Deko-Art ein InstancedMesh, Hintergrund eine zusammengefasste Geometrie (Ecken-Farben).
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  var TAU = Math.PI * 2, EXTENT = 1500, DROP = 0.06, SKY_R = 1900;
  function lerp(a, b, t) { return a + (b - a) * t; }
  function col(c, fb) { try { return new THREE.Color(c == null || c === '' ? fb : c); } catch (e) { return new THREE.Color(fb); } }
  // Rückfall ohne js/car-track-themes.js: flach, Wiese, keine Deko
  var PLAIN = { id: 'plain', flat: true, sky: { top: 0x6fa8dc, horizon: 0xcfe2f3 }, fog: { near: 420, far: 1700 }, sun: { color: 0xffffff, k: 1 },
    hemi: { sky: 0xffffff, ground: 0x5a6070, k: 1 }, fill: 1, exposure: 1, groundTex: { base: [232, 232, 232], spread: 0.22 },
    height: function () { return function () { return 0; }; }, groundColor: function () { return function () { return 0x4a763a; }; } };

  // ---- Kulissen-Modelle (Sketchfab, scripts/build_track_props.py → data/track-props) ----
  // Katalog { props: [{ uid (Paket-Teil: <uid>-<part>), kind, slot, slots (optional: mehrere Platz-Typen), theme,
  // themes (optional), size: [x, y, z] (m), sink, bytes, … }], credits } und je Modell eine Vorlage (Teile je Material
  // zusammengefasst). Beides bleibt für die ganze Seite im Speicher – das nächste Rennen nimmt dieselben Vorlagen
  // (dispose() einer Strecke gibt nur die Instanzen frei). Fehlt etwas: prozedurale Deko.
  // Foto-Rasen (ambientCG „Grass 001“, CC0, 1,4 m, assets/textures/track/grass_lawn_diff_1k.jpg): nur als Helligkeits-
  // Struktur – die Farbe kommt weiter aus den Ecken-Farben des Themas. Gras-UV läuft in 12-m-Kacheln → das Foto wird
  // 8 × 8 in eine 1024er-Fläche gelegt (≈ 1,5 m je Foto), auf Grundton gt.base normiert, Streuung nach gt.spread.
  var grassPhoto = { img: null, wait: [], failed: false, cache: {} };
  function photoGrass(gt, done) {
    if (!PROP_BASE || !root.document || grassPhoto.failed) return;
    var key = gt.base.join(',') + '|' + gt.spread + '|' + (gt.stripes ? 1 : 0);
    if (grassPhoto.cache[key]) { done(grassPhoto.cache[key]); return; }
    function make() {
      var N = 1024, REP = 8, cv = document.createElement('canvas'); cv.width = cv.height = N;
      var x = cv.getContext('2d'), st = N / REP, i, j;
      for (i = 0; i < REP; i++) for (j = 0; j < REP; j++) x.drawImage(grassPhoto.img, i * st, j * st, st + 1, st + 1);
      var im = x.getImageData(0, 0, N, N), d = im.data, sum = 0, n = N * N;
      for (i = 0; i < n; i++) sum += 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      var mean = sum / n || 1, k = Math.min(1.6, (gt.spread || 0.2) / 0.2);
      for (i = 0; i < n; i++) {
        var L = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / mean, f = 1 + (L - 1) * 0.85 * k;
        d[i * 4] = Math.min(255, gt.base[0] * f); d[i * 4 + 1] = Math.min(255, gt.base[1] * f); d[i * 4 + 2] = Math.min(255, gt.base[2] * f);
      }
      x.putImageData(im, 0, 0);
      if (gt.stripes) { x.fillStyle = 'rgba(0,0,0,0.07)'; x.fillRect(0, 0, N, N / 2); }   // Mähstreifen (Stadion)
      return (grassPhoto.cache[key] = cv);
    }
    if (grassPhoto.img) { done(make()); return; }
    grassPhoto.wait.push(function () { done(make()); });
    if (grassPhoto.wait.length > 1) return;
    var img = new Image();
    img.onload = function () { grassPhoto.img = img; var w = grassPhoto.wait; grassPhoto.wait = []; w.forEach(function (f) { f(); }); };
    img.onerror = function () { grassPhoto.failed = true; grassPhoto.wait = []; };   // fehlt die Datei: berechnete Textur bleibt
    img.src = PROP_BASE + 'assets/textures/track/grass_lawn_diff_1k.jpg';
  }
  var PROP_BASE = (function () {
    var s = root.document && document.currentScript && document.currentScript.src || '';
    var m = /^(.*\/s\/[^/]+\/)/.exec(s) || /^(.*\/)js\/car-track-scene\.js/.exec(s);
    return m ? m[1] : null;
  })();
  var propCatalog = null, propTpl = {};
  function loadPropCatalog() {
    if (propCatalog) return propCatalog;
    if (!PROP_BASE || !root.fetch || !THREE.GLTFLoader) return (propCatalog = Promise.resolve({ props: [], credits: [] }));
    return (propCatalog = fetch(PROP_BASE + 'api/fx/track-props/catalog.json', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (c) { return { props: Array.isArray(c && c.props) ? c.props : [], credits: Array.isArray(c && c.credits) ? c.credits : [] }; })
      .catch(function () { return { props: [], credits: [] }; }));
  }
  // Vorlage: alle Netze in Modell-Koordinaten (die Datei ist schon normiert: Meter, Fuß auf y = 0, Mitte x = z = 0),
  // je Material zu einem Netz zusammengefasst → { parts: [{ geo, mat }], size }
  function loadPropTpl(e) {
    if (propTpl[e.uid]) return propTpl[e.uid];
    return (propTpl[e.uid] = new Promise(function (res, rej) {
      new THREE.GLTFLoader().load(PROP_BASE + 'api/fx/track-props/' + e.uid + '.glb' + (e.bytes ? '?v=' + e.bytes : ''), function (gl) {
        try { res(propParts(gl.scene, e)); } catch (err) { rej(err); }
      }, null, rej);
    }));
  }
  function propParts(sceneObj, e) {
    var BGU = THREE.BufferGeometryUtils, groups = {}, order = [];
    sceneObj.updateMatrixWorld(true);
    sceneObj.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.length !== 1) return;   // Mehrfach-Material kommt aus dem GLTFLoader nicht vor
      var m = mats[0], k = m.uuid;
      if (!groups[k]) { groups[k] = { mat: m, list: [] }; order.push(k); }
      groups[k].list.push(o);
    });
    // einfarbige Materialien (ohne Textur, undurchsichtig, nicht leuchtend) zu einem Material mit Ecken-Farbe
    // zusammenlegen – Low-Poly-Modelle haben oft Dutzende davon (je eins ein Zeichenaufruf)
    var plain = {};
    order = order.filter(function (k) {
      var m = groups[k].mat;
      var flat = m.isMeshStandardMaterial && !m.vertexColors && !m.transparent && !m.map && !m.emissiveMap && !m.alphaMap &&
        !m.normalMap && !m.aoMap && !m.roughnessMap && !m.metalnessMap && !(m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.01) && !m.alphaTest;
      if (!flat) return true;
      var key = 'plain|' + m.side;
      if (!plain[key]) {
        plain[key] = groups[key] = { mat: new THREE.MeshStandardMaterial({ vertexColors: true, side: m.side, roughness: 0, metalness: 0 }), list: [], plain: true, n: 0 };
        order.push(key);
      }
      var pg = plain[key];
      pg.mat.roughness += m.roughness; pg.mat.metalness += m.metalness; pg.n++;
      groups[k].list.forEach(function (o) {
        var gg = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(), n = gg.attributes.position.count, cols = new Float32Array(n * 3);
        for (var i = 0; i < n; i++) { cols[i * 3] = m.color.r; cols[i * 3 + 1] = m.color.g; cols[i * 3 + 2] = m.color.b; }
        gg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        if (!gg.attributes.normal) gg.computeVertexNormals();
        pg.list.push({ geometry: gg, matrixWorld: o.matrixWorld, tmp: true });
      });
      return false;
    });
    Object.keys(plain).forEach(function (k) { var pg = plain[k]; pg.mat.roughness /= pg.n; pg.mat.metalness /= pg.n; });
    var parts = [], box = new THREE.Box3();
    order.forEach(function (k) {
      var gr = groups[k], mixed = gr.list.some(function (o) { return !o.geometry.index; });
      var names = ['position', 'normal', 'uv', 'color'].filter(function (a) {
        return gr.list.every(function (o) { var x = o.geometry.attributes[a]; return x && !x.isInterleavedBufferAttribute && x.itemSize === gr.list[0].geometry.attributes[a].itemSize; });
      });
      var geos = gr.list.map(function (o) {
        var src = mixed && o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, gg = new THREE.BufferGeometry();
        names.forEach(function (a) { gg.setAttribute(a, src.attributes[a].clone()); });
        if (!mixed && src.index) gg.setIndex(src.index.clone());
        gg.applyMatrix4(o.matrixWorld);
        if (src !== o.geometry) src.dispose();
        if (o.tmp) o.geometry.dispose();
        return gg;
      });
      var merged = geos.length === 1 ? geos[0] : (BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(geos, false) : null);
      if (merged) { if (merged !== geos[0]) geos.forEach(function (x) { x.dispose(); }); merged = [merged]; } else merged = geos;
      var mat = gr.mat;   // Seite (einseitig/beidseitig) wie in der Datei – Umriss-Hüllen (Toon-Outline) brauchen einseitig
      if (mat.envMapIntensity != null) mat.envMapIntensity = 0.6;
      if (!gr.plain && names.indexOf('color') < 0) mat.vertexColors = false;
      merged.forEach(function (gg) {
        if (!gg.attributes.normal) gg.computeVertexNormals();
        gg.computeBoundingBox(); box.union(gg.boundingBox);
        parts.push({ geo: gg, mat: mat });
      });
    });
    var sz = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    var tris = 0;
    parts.forEach(function (p) { tris += (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3; });
    return { parts: parts, size: sz, tris: tris, sink: +e.sink || 0 };
  }

  function build(T, opts) {
    opts = opts || {};
    var Themes = root.CarTrackThemes, theme = (Themes && Themes.forTrack(T)) || PLAIN, reduce = !!opts.reduceMotion;
    var owned = [], decor = { objs: [], inst: [] }, maxAniso = opts.maxAniso || 4, anims = [];
    function own(x) { owned.push(x); return x; }
    function lin(c) { return Themes ? Themes.lin(c) : new THREE.Color(c).convertSRGBToLinear(); }
    function canvasTex(w, h, draw, repeat) {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      var t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, maxAniso); }
      return t;
    }
    function noise(g, w, h, base, spread, rnd) {
      g.fillStyle = 'rgb(' + base.join(',') + ')'; g.fillRect(0, 0, w, h);
      for (var i = 0; i < w * h / 3; i++) {
        var k = (rnd() - 0.5) * spread;
        g.fillStyle = 'rgba(' + (k > 0 ? '255,255,255,' : '0,0,0,') + Math.abs(k).toFixed(3) + ')';
        g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2));
      }
    }
    var g = new THREE.Group();
    var raw = T._raw, n = raw.n, ds = raw.ds, HALF = T.width / 2;
    var rnd = CarRaceSim.rng((T.seed | 0) + 7919);
    // Mittellinie + Normale je Rasterpunkt
    var P = [];
    for (var i = 0; i < n; i++) { var a = T.at(i * ds); P.push(a); }
    // Raster für „liegt nah an der Strecke?“ / Abstand zur Mittellinie (Deko, Leitplanken, Bodenfarbe)
    var CELL = 8, hash = new Map();
    function hkey(cx, cz) { return (cx + 30000) * 65536 + (cz + 30000); }
    P.forEach(function (p, i) { var k = hkey(Math.floor(p.x / CELL), Math.floor(p.z / CELL)); var l = hash.get(k); if (!l) hash.set(k, l = []); l.push(i); });
    function nearTrack(x, z, R) {
      var r = Math.ceil(R / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), R2 = R * R;
      for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) {
        var l = hash.get(hkey(cx + a, cz + b)); if (!l) continue;
        for (var q = 0; q < l.length; q++) { var p = P[l[q]], dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < R2) return true; }
      }
      return false;
    }
    // nächster Mittellinienpunkt im Umkreis R → { i, d } (d = Infinity, wenn keiner)
    function trackNearest(x, z, R) {
      var r = Math.ceil(R / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), best = Infinity, bi = -1;
      for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) {
        var l = hash.get(hkey(cx + a, cz + b)); if (!l) continue;
        for (var q = 0; q < l.length; q++) { var p = P[l[q]], dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz; if (d2 < best) { best = d2; bi = l[q]; } }
      }
      return { i: bi, d: Math.sqrt(best) };
    }
    function trackDist(x, z, R) { return trackNearest(x, z, R).d; }
    // Auslauf je Rasterpunkt (links/rechts, m) – dahinter steht die Leitplanke
    var runL = T.runoff ? T.runoff.left : [], runR = T.runoff ? T.runoff.right : [];
    function runAt(i, sd) { var v = (sd > 0 ? runL : runR)[i % n]; return v > 0 ? v : 0; }
    var cx = 0, cz = 0, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    P.forEach(function (p) { cx += p.x / n; cz += p.z / n; minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
    function outside(x, z) { return Math.hypot(Math.max(0, minX - x, x - maxX), Math.max(0, minZ - z, z - maxZ)); }

    // ---- Thema: Höhe (nur Optik) ----
    var ctx = {
      T: T, P: P, n: n, ds: ds, HALF: HALF, cx: cx, cz: cz, minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ,
      radius: Math.hypot(maxX - minX, maxZ - minZ) / 2, outside: outside, nearTrack: nearTrack, trackDist: trackDist,
      rng: function (salt) { return CarRaceSim.rng(((T.seed | 0) * 7919 + salt * 104729) | 0); },
      primary: col(opts.primary, 0x5e2a79).getHex(), accent: col(opts.accent, 0xf2b705).getHex()
    };
    ctx.rnd = ctx.rng(1);
    var H = theme.height(ctx), flat = !!theme.flat;
    // Fahrbahn quer fast eben: nahe der Strecke zieht die Höhe zum (gewichteten) Höhenverlauf der Mittellinie, nur 20 %
    // der Querneigung bleiben; ab 16 m neben der Fahrbahn wieder reines Gelände. Gewichte gleiten mit dem Abstand
    // (keine Stufen, auch wo sich zwei Streckenteile nahe kommen). Autos, Fahrbahn, Gelände nutzen dieselbe Funktion.
    var KEEP = 0.2, W_IN = HALF + 3, W_OUT = HALF + 16, RK = HALF + 26, HC = new Float64Array(n);
    if (!flat) for (var hi = 0; hi < n; hi++) HC[hi] = H(P[hi].x, P[hi].z);
    function heightAt(x, z) {
      if (flat) return 0;
      var h = H(x, z);
      if (outside(x, z) > RK) return h;
      var r = Math.ceil(RK / CELL), gx = Math.floor(x / CELL), gz = Math.floor(z / CELL), sk = 0, sh = 0, dmin2 = Infinity, RK2 = RK * RK;
      for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) {
        var l = hash.get(hkey(gx + a, gz + b)); if (!l) continue;
        for (var q = 0; q < l.length; q++) {
          var p = P[l[q]], dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
          if (d2 >= RK2) continue;
          if (d2 < dmin2) dmin2 = d2;
          var k = 1 - Math.sqrt(d2) / RK; k *= k; k *= k;
          sk += k; sh += k * HC[l[q]];
        }
      }
      if (!(sk > 0)) return h;
      var dmin = Math.sqrt(dmin2), t = Math.min(1, Math.max(0, (W_OUT - dmin) / (W_OUT - W_IN))), w = t * t * (3 - 2 * t);
      return h + w * (1 - KEEP) * (sh / sk - h);
    }
    ctx.height = heightAt;

    // ---- Gelände: Raster, nahe der Strecke dicht (4 m), nach außen immer gröber bis ±1500 m ----
    function axis(lo, hi, c) {
      var a = [], x, s;
      for (x = lo; x < hi; x += 4) a.push(x);
      a.push(hi);
      var right = [], left = [];
      for (s = 4, x = hi; x < c + EXTENT; ) { s = Math.min(s * 1.14, 160); x += s; right.push(x); }
      for (s = 4, x = lo; x > c - EXTENT; ) { s = Math.min(s * 1.14, 160); x -= s; left.push(x); }
      return left.reverse().concat(a, right);
    }
    var XS = axis(minX - 40, maxX + 40, cx), ZS = axis(minZ - 40, maxZ + 40, cz), NX = XS.length, NZ = ZS.length;
    var TY = new Float32Array(NX * NZ);
    var tPos = new Float32Array(NX * NZ * 3), tUv = new Float32Array(NX * NZ * 2), tIdx = [];
    for (var zi = 0; zi < NZ; zi++) for (var xi = 0; xi < NX; xi++) {
      var vi = zi * NX + xi, X = XS[xi], Z = ZS[zi], Y = heightAt(X, Z) - DROP;
      TY[vi] = Y; tPos[vi * 3] = X; tPos[vi * 3 + 1] = Y; tPos[vi * 3 + 2] = Z;
      tUv[vi * 2] = X / 12; tUv[vi * 2 + 1] = Z / 12;
      if (xi < NX - 1 && zi < NZ - 1) { var A = vi, B = vi + 1, C = vi + NX, D = vi + NX + 1; tIdx.push(A, C, B, B, C, D); }
    }
    function findCell(arr, v) { var lo = 0, hi = arr.length - 1; if (v <= arr[0] || v >= arr[hi]) return -1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (arr[m] <= v) lo = m; else hi = m; } return lo; }
    // Höhe der gezeichneten Geländefläche (gleiche Dreiecksteilung wie das Raster)
    function groundAt(x, z) {
      var i = findCell(XS, x), j = findCell(ZS, z);
      if (i < 0 || j < 0) return heightAt(x, z) - DROP;
      var u = (x - XS[i]) / (XS[i + 1] - XS[i]), v = (z - ZS[j]) / (ZS[j + 1] - ZS[j]), k = j * NX + i;
      var a = TY[k], b = TY[k + 1], c = TY[k + NX], d = TY[k + NX + 1];
      return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
    }
    ctx.ground = groundAt;
    var gt = theme.groundTex || PLAIN.groundTex;
    var grassTex = own(canvasTex(128, 128, function (x, w, h) {
      noise(x, w, h, gt.base, gt.spread, rnd);
      if (gt.stripes) { x.fillStyle = 'rgba(0,0,0,0.07)'; x.fillRect(0, 0, w, h / 2); }   // Mähstreifen (Stadion)
    }, true));
    photoGrass(gt, function (cv) { grassTex.image = cv; grassTex.needsUpdate = true; });
    var terrainGeo = own(new THREE.BufferGeometry());
    terrainGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    terrainGeo.setAttribute('uv', new THREE.BufferAttribute(tUv, 2));
    terrainGeo.setIndex(tIdx); terrainGeo.computeVertexNormals();
    var terrain = new THREE.Mesh(terrainGeo, own(new THREE.MeshStandardMaterial({ map: grassTex, vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.6 })));
    g.add(terrain);

    // Band entlang der Strecke: Seitenversatz a…b (Zahl oder Funktion des Rasterindex), Höhe ya/yb über dem Gelände
    // (Wand: a = b, ya ≠ yb); keep(i) je Abschnitt; nl = Unterteilung quer (folgt dem Gelände)
    function strip(a0, b0, ya, yb, mat, vLen, keep, nl) {
      nl = nl || 1;
      var pos = [], uv = [], idx = [], row = nl + 1;
      for (var i = 0; i <= n; i++) {
        var p = P[i % n], a = typeof a0 === 'function' ? a0(i % n) : a0, b = typeof b0 === 'function' ? b0(i % n) : b0;
        for (var j = 0; j <= nl; j++) {
          var f = j / nl, off = lerp(a, b, f), x = p.x + p.nx * off, z = p.z + p.nz * off;
          pos.push(x, heightAt(x, z) + lerp(ya, yb, f), z);
          uv.push(f, i * ds / vLen);
        }
        if (i < n && (!keep || keep(i))) {
          for (var q = 0; q < nl; q++) { var o = i * row + q, o2 = o + row; idx.push(o, o + 1, o2, o + 1, o2 + 1, o2); }
        }
      }
      if (!idx.length) return null;
      var geo = own(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      var m = new THREE.Mesh(geo, mat); g.add(m); return m;
    }
    // Fahrbahn + Rand: js/car-track-surface.js (nach der Deko, siehe unten); ohne das Modul die einfache Fassung hier
    var Surface = root.CarTrackSurface;
    function curvy(i) { return Math.abs(P[i].curv) > 1 / 60 || Math.abs(P[(i + 1) % n].curv) > 1 / 60; }
    // Kiesbett im Auslauf an Kurven-Außenseiten (±14 m um die Kurve), wo der Auslauf > 3 m ist; sonst Gras
    var outsideK = { 1: new Uint8Array(n), '-1': new Uint8Array(n) }, W14 = Math.round(14 / ds);
    for (var ci = 0; ci < n; ci++) {
      if (Math.abs(P[ci].curv) <= 1 / 60) continue;
      var outSd = P[ci].curv > 0 ? -1 : 1;   // Linkskurve → außen = rechts
      for (var k = -W14; k <= W14; k++) outsideK[outSd][(ci + k + n) % n] = 1;
    }
    var gravelK = { 1: new Uint8Array(n), '-1': new Uint8Array(n) };
    [1, -1].forEach(function (sd) {
      for (var i = 0; i < n; i++) gravelK[sd][i] = outsideK[sd][i] && outsideK[sd][(i + 1) % n] && runAt(i, sd) > 3 && runAt(i + 1, sd) > 3 ? 1 : 0;
    });
    var p0 = P[0], fx0 = Math.cos(p0.yaw), fz0 = -Math.sin(p0.yaw);
    if (!Surface) (function () {
      var NL = flat ? 1 : 4;   // Hügel: Asphalt quer unterteilt, damit das Gelände nirgends durchsticht
      var asphaltTex = own(canvasTex(128, 128, function (x, w, h) { noise(x, w, h, [62, 64, 70], 0.3, rnd); }, true));
      var asphalt = own(new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
      strip(-HALF, HALF, 0.03, 0.03, asphalt, 9, null, NL);
      var white = own(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7, side: THREE.DoubleSide }));
      strip(HALF - 0.45, HALF - 0.25, 0.04, 0.04, white, 10);
      strip(-HALF + 0.25, -HALF + 0.45, 0.04, 0.04, white, 10);
      var curbTex = own(canvasTex(8, 64, function (x, w, h) { x.fillStyle = '#d8262b'; x.fillRect(0, 0, w, h / 2); x.fillStyle = '#f4f4f4'; x.fillRect(0, h / 2, w, h / 2); }, true));
      var curb = own(new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.6, side: THREE.DoubleSide }));
      strip(HALF, HALF + 0.9, 0.05, 0.05, curb, 4, curvy);
      strip(-HALF - 0.9, -HALF, 0.05, 0.05, curb, 4, curvy);
      var gravelTex = own(canvasTex(128, 128, function (x, w, h) { noise(x, w, h, [196, 178, 140], 0.45, rnd); }, true));
      var gravel = own(new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
      [1, -1].forEach(function (sd) {
        strip(function (i) { return sd * (HALF + 0.9); }, function (i) { return sd * (HALF + Math.max(0.9, runAt(i, sd))); }, 0.035, 0.035, gravel, 5,
          function (i) { return gravelK[sd][i]; }, flat ? 1 : 3);
      });
      // Leitplanken am Außenrand des Auslaufs (die Sim lässt dort nicht weiter); Industrie: Reifenstapel statt dessen
      if (theme.rail !== false) {
        var rail = own(new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide }));
        [1, -1].forEach(function (sd) {
          var off = function (i) { return sd * (HALF + runAt(i, sd) + 0.3); };
          strip(off, off, 0.25, 0.85, rail, 10);
        });
      }
      // Start/Ziel: Schachbrett über die Fahrbahn (folgt dem Gelände)
      var checkTex = own(canvasTex(160, 32, function (x, w, h) {
        for (var a = 0; a < 10; a++) for (var b = 0; b < 2; b++) { x.fillStyle = (a + b) % 2 ? '#111' : '#f4f4f4'; x.fillRect(a * 16, b * 16, 16, 16); }
      }));
      var pos = [], uv = [], idx = [], NQ = 6;
      for (var b = 0; b <= 1; b++) for (var a = 0; a <= NQ; a++) {
        var off = lerp(-HALF, HALF, a / NQ), al = (b - 0.5) * 1.6, x = p0.x + p0.nx * off + fx0 * al, z = p0.z + p0.nz * off + fz0 * al;
        pos.push(x, heightAt(x, z) + 0.06, z); uv.push(a / NQ, b);
      }
      for (var q = 0; q < NQ; q++) idx.push(q, q + NQ + 1, q + 1, q + 1, q + NQ + 1, q + NQ + 2);
      var geo = own(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, own(new THREE.MeshStandardMaterial({ map: checkTex, roughness: 0.7, side: THREE.DoubleSide }))));
    })();
    // Portal und Dächer in den Theme-Farben (Primär + Akzent)
    var purple = own(new THREE.MeshStandardMaterial({ color: col(opts.primary, 0x5e2a79), roughness: 0.5 }));
    var gold = own(new THREE.MeshStandardMaterial({ color: col(opts.accent, 0xf2b705), roughness: 0.4, metalness: 0.3 }));
    // Portal: Pfosten hinter den Leitplanken (lokal z = −Normale: links = −z), reichen 3 m in den Boden (Hang)
    var gantry = new THREE.Group(), postL = HALF + runAt(0, 1) + 0.8, postR = HALF + runAt(0, -1) + 0.8;
    [-postL, postR].forEach(function (z) {
      var post = new THREE.Mesh(own(new THREE.BoxGeometry(0.4, 7.6, 0.4)), purple);
      post.position.set(0, 0.8, z); gantry.add(post);
    });
    var span = postL + postR + 0.4, mid = (postR - postL) / 2;
    var beam = new THREE.Mesh(own(new THREE.BoxGeometry(0.5, 0.9, span)), purple); beam.position.set(0, 4.6, mid); gantry.add(beam);
    var stripe = new THREE.Mesh(own(new THREE.BoxGeometry(0.52, 0.18, span + 0.02)), gold); stripe.position.set(0, 4.6, mid); gantry.add(stripe);
    gantry.position.set(p0.x, heightAt(p0.x, p0.z), p0.z); gantry.rotation.y = p0.yaw; g.add(gantry);
    decor.objs.push({ o: gantry, r: HALF + 13 });

    // ---- Himmel: Kuppel mit Verlauf (Horizont → Zenit), ohne Nebel/Tonemapping, hinter allem ----
    (function () {
      var geo = own(new THREE.SphereGeometry(SKY_R, 32, 14)), p = geo.attributes.position, cols = [];
      var top = lin(theme.sky.top), hz = lin(theme.sky.horizon), c = new THREE.Color();
      for (var i = 0; i < p.count; i++) { var t = Math.max(0, p.getY(i) / SKY_R); c.copy(hz).lerp(top, Math.pow(t, 0.55)); cols.push(c.r, c.g, c.b); }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      var dome = new THREE.Mesh(geo, own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false })));
      dome.position.set(cx, 0, cz); dome.renderOrder = -10; dome.frustumCulled = false; g.add(dome);
    })();

    // ---- Deko (Thema) ----
    var timeU = { value: 0 }, MATS = {};
    // variant: '' = normales Mesh, 'i' = Instanzen, 'it' = Instanzen mit Farbe je Instanz – je eigenes Material,
    // weil three r128 ein Programm mit Instanzfarbe sonst auch für Meshes ohne instanceColor nimmt (Absturz)
    function mat(name, variant) {
      variant = variant || '';
      var key = name + '|' + variant;
      if (MATS[key]) return MATS[key];
      var m;
      if (name === 'glow') m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      else if (name === 'water') m = new THREE.MeshStandardMaterial({ color: 0x3f86b0, roughness: 0.2, metalness: 0.1, envMapIntensity: 0.9 });
      else if (name === 'foam') {
        var ft = own(canvasTex(64, 64, function (x, w, h) {
          x.clearRect(0, 0, w, h);
          for (var i = 0; i < 90; i++) { x.fillStyle = 'rgba(255,255,255,' + (0.3 + rnd() * 0.6).toFixed(2) + ')'; x.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 2 + Math.floor(rnd() * 6), 2); }
        }, true));
        m = new THREE.MeshBasicMaterial({ map: ft, transparent: true, opacity: 0.8, depthWrite: false });
        anims.push(function (dt) { ft.offset.x = (ft.offset.x + dt * 0.02) % 1; ft.offset.y = 0.15 * Math.sin(timeU.value * 0.7); });
      } else {
        m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true, envMapIntensity: 0.5, side: name === 'wave' ? THREE.DoubleSide : THREE.FrontSide });
        if (name === 'wave') {   // Fahnentuch: Welle wächst vom Mast weg (lokal x), Phase je Instanz
          m.onBeforeCompile = function (sh) {
            sh.uniforms.uTime = timeU;
            sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
              '#include <begin_vertex>\nfloat wph = 0.0;\n#ifdef USE_INSTANCING\nwph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;\n#endif\n' +
              'transformed.z += sin(uTime * 5.0 + transformed.x * 2.2 + wph) * 0.13 * max(transformed.x, 0.0);');
          };
          m.customProgramCacheKey = function () { return 'track-flag-wave-' + variant; };
        }
      }
      return (MATS[key] = own(m));
    }
    var kinds = [], bgKits = [], occ = new Map(), occR = 0, OCC = 6;
    // Art registrieren: parts = [{ geo, mat }] (alle Teile teilen die Plätze; [] = nur Kulissen-Modell, ohne Ersatz),
    // o = { r (Radius bei Größe 1), tint, prop }. prop = { slot (Katalog-Feld slot, sonst kind), box: { w, d, h } (Platz
    // in m, lokal x/z/y – das Modell wird nur verkleinert, nie vergrößert), yaw (Zusatzdrehung), y (Höhe über dem Platz),
    // front (Vorderkante auf lokal z), tile (kleine Modelle entlang x nebeneinander, bis box.w voll ist),
    // onProp(spot, { height, scale }) } – Modelle derselben Art wechseln sich je Platz
    // ab (Reihenfolge des Katalogs, unabhängig davon, welches zuerst geladen ist)
    ctx.kind = function (name, parts, o) {
      var kd = { name: name, parts: parts, r: (o && o.r) || 2, tint: !!(o && o.tint), spots: [], prop: (o && o.prop) || null };
      parts.forEach(function (p) { own(p.geo); });
      // a.abs: y ist absolut (nicht über dem Gelände) – z. B. auf einer Insel im Meer
      kd.add = function (x, z, a) {
        a = a || {};
        var s = a.s || 1;
        kd.spots.push({ x: x, z: z, rot: a.rot || 0, s: s, y: a.y || 0, abs: !!a.abs, tint: a.tint, r: kd.r * s, hidden: false, prop: null });
      };
      kinds.push(kd);
      return kd;
    };
    // Platz belegen (kein Überlappen mit anderer Deko; ohne ignoreTrack nur ≥ 14 m neben der Fahrbahn)
    ctx.place = function (x, z, rad, ignoreTrack) {
      if (!ignoreTrack) { var need = HALF + 14 + rad; if (trackDist(x, z, need + 0.5) < need) return false; }
      var r = Math.ceil((rad + occR) / OCC), gx = Math.floor(x / OCC), gz = Math.floor(z / OCC);
      for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) {
        var l = occ.get(hkey(gx + a, gz + b)); if (!l) continue;
        for (var q = 0; q < l.length; q++) { var o = l[q], dx = o[0] - x, dz = o[1] - z, rr = o[2] + rad; if (dx * dx + dz * dz < rr * rr) return false; }
      }
      var k = hkey(gx, gz), cell = occ.get(k); if (!cell) occ.set(k, cell = []);
      cell.push([x, z, rad]); occR = Math.max(occR, rad);
      return true;
    };
    // Rechteck (lokal x ±hw, z z0…z1, Drehung rot wie kind.add) frei von Fahrbahn + Auslauf (≥ 13 m neben der Fahrbahn)?
    ctx.clearRect = function (x, z, rot, hw, z0, z1) {
      var c = Math.cos(rot), s = Math.sin(rot), need = HALF + 13;
      for (var u = -hw; u <= hw + 1e-6; u += hw / 4) for (var v = z0; v <= z1 + 1e-6; v += (z1 - z0) / 3) {
        if (trackDist(x + u * c + v * s, z - u * s + v * c, need + 0.5) < need) return false;
      }
      return true;
    };
    // zufällig im Band dmin…dmax (m neben der Fahrbahn) streuen; o = { dmin, dmax, rad, s: [min, max], pred, tint() }
    // Anzahl je Thema gilt für eine ~320-m-Runde; lange Strecken bekommen mehr (√ der Länge, höchstens doppelt so
    // viele), damit die Kulisse nicht ausdünnt, ohne dass die Dreiecke mit der Länge voll mitwachsen
    var SCATTER_K = Math.max(1, Math.min(2, Math.sqrt(T.len / 320)));
    ctx.scatter = function (kd, count, o) {
      count = Math.round(count * SCATTER_K);
      var R = ctx.rnd, placed = 0, s0 = o.s ? o.s[0] : 1, s1 = o.s ? o.s[1] : 1, ext = HALF + o.dmax;
      for (var t = 0; t < count * 30 && placed < count; t++) {
        var x = lerp(minX - ext, maxX + ext, R()), z = lerp(minZ - ext, maxZ + ext, R()), s = lerp(s0, s1, R());
        var rad = (o.rad || kd.r) * s, dn = Math.max(o.dmin, 14 + rad);
        // billig zuerst: Abstand zum Strecken-Rechteck ist eine untere Schranke, dann nur kleine Suchradien
        if (outside(x, z) > ext || nearTrack(x, z, HALF + dn) || !nearTrack(x, z, ext)) continue;
        if (o.pred && !o.pred(x, z)) continue;
        if (!ctx.place(x, z, rad)) continue;
        kd.add(x, z, { rot: R() * TAU, s: s, tint: o.tint ? o.tint() : null });
        placed++;
      }
      return placed;
    };
    // Zufallsplatz im Band, Drehung wie der nächste Streckenpunkt
    ctx.randomSpot = function (dmin, dmax) {
      var R = ctx.rnd, ext = HALF + dmax;
      for (var t = 0; t < 60; t++) {
        var x = lerp(minX - ext, maxX + ext, R()), z = lerp(minZ - ext, maxZ + ext, R()), nr = trackNearest(x, z, ext + 1), d = nr.d - HALF;
        if (nr.i < 0 || d < dmin || d > dmax) continue;
        return { x: x, z: z, rot: P[nr.i].yaw };
      }
      return null;
    };
    // entlang der Leitplanken-Linie (Auslauf + 0,3 m + extra), o = { step, extra, side, every(s), tint(k), rad }
    ctx.alongRail = function (kd, o) {
      var k = 0;
      (o.side ? [o.side] : [1, -1]).forEach(function (sd) {
        for (var s = 0; s < T.len; s += o.step) {
          if (o.every && !o.every(s)) continue;
          var a = T.at(s), off = HALF + (sd > 0 ? a.runL : a.runR) + 0.3 + (o.extra || 0);
          var x = a.x + a.nx * sd * off, z = a.z + a.nz * sd * off;
          if (trackDist(x, z, off + 1) < off - 0.3) continue;   // anderer Streckenteil näher
          if (!ctx.place(x, z, o.rad || 0.45, true)) continue;
          kd.add(x, z, { rot: a.yaw, tint: o.tint ? o.tint(k++) : null });
        }
      });
    };
    // flaches Band entlang einer Punktliste (Bach, Gischt); y über dem Gelände bzw. absolut
    ctx.ribbon = function (pts, w, y, matName, absolute) {
      var pos = [], uv = [], idx = [], L = 0;
      for (var i = 0; i < pts.length; i++) {
        var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        var nx = -dz / l * w / 2, nz = dx / l * w / 2;
        if (i) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        [-1, 1].forEach(function (sd) {
          var x = pts[i][0] + nx * sd, z = pts[i][1] + nz * sd;
          pos.push(x, absolute ? y : groundAt(x, z) + y, z); uv.push(L / 6, sd > 0 ? 1 : 0);
        });
        if (i) { var o = (i - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
      }
      var geo = own(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      var m = new THREE.Mesh(geo, mat(matName)); m.material.side = THREE.DoubleSide; g.add(m);
      return m;
    };
    // Meer: große Fläche bis zum Horizont (−z), Wellenmuster zieht langsam
    ctx.sea = function (y, zEdge) {
      var st = own(canvasTex(128, 128, function (x, w, h) {
        x.fillStyle = 'rgb(225,232,236)'; x.fillRect(0, 0, w, h);
        for (var i = 0; i < 260; i++) { x.fillStyle = 'rgba(255,255,255,' + (0.25 + rnd() * 0.5).toFixed(2) + ')'; x.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 4 + Math.floor(rnd() * 10), 1); }
      }, true));
      var len = zEdge - (cz - EXTENT - 300), wd = 2 * EXTENT + 600;
      st.repeat.set(wd / 14, len / 14);
      var m = new THREE.Mesh(own(new THREE.PlaneGeometry(wd, len)), own(new THREE.MeshStandardMaterial({ map: st, color: 0x2a6e8c, roughness: 0.3, metalness: 0.15, envMapIntensity: 0.9 })));
      m.rotation.x = -Math.PI / 2; m.position.set(cx, y, zEdge - len / 2); g.add(m);
      anims.push(function (dt) { st.offset.y = (st.offset.y + dt * 0.035) % 1; st.offset.x = 0.04 * Math.sin(timeU.value * 0.5); });
      return m;
    };
    // Lichtkegel des Leuchtturms (additiv, dreht sich langsam)
    ctx.beam = function (x, y, z) {
      var bm = own(new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      var geo = own(new THREE.ConeGeometry(5, 46, 14, 1, true)); geo.translate(0, -23, 0); geo.rotateZ(Math.PI / 2);   // Spitze an der Laterne, Kegel nach +x
      var grp = new THREE.Group(); grp.position.set(x, y, z);
      [0, Math.PI].forEach(function (r) { var c = new THREE.Mesh(geo, bm); c.rotation.y = r; c.rotation.z = -0.06; grp.add(c); });
      g.add(grp); decor.objs.push({ o: grp, r: 9 });
      anims.push(function (dt) { grp.rotation.y += dt * 0.55; });
      return grp;
    };
    ctx.bg = function (kit) { if (kit && !kit.empty()) bgKits.push(kit); };
    // Relief (Bergketten, Hügel, Inseln aus CarTrackThemes.Relief): glatt schattiert, Ecken-Farben, ein Zeichenaufruf
    ctx.bgMesh = function (geo) {
      if (!geo) return;
      var m = new THREE.Mesh(own(geo), own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.3 })));
      m.frustumCulled = false; g.add(m);
    };
    if (theme.decorate) theme.decorate(ctx);

    // Instanzen bauen: je Art und Teil ein InstancedMesh (Matrizen aus den Plätzen, Höhe = Gelände)
    var mtx = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), yAx = new THREE.Vector3(0, 1, 0), white1 = new THREE.Color(1, 1, 1);
    var ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
    function spotY(s) { return s.abs ? s.y : groundAt(s.x, s.z) + s.y; }
    function spotMatrix(s, out) { qt.setFromAxisAngle(yAx, s.rot); sc.setScalar(s.s); ps.set(s.x, spotY(s), s.z); return out.compose(ps, qt, sc); }
    kinds.forEach(function (kd) {
      if (!kd.spots.length) return;
      var meshes = kd.parts.map(function (p) {
        var tinted = kd.tint && !p.notint;
        var im = own(new THREE.InstancedMesh(p.geo, mat(p.mat || 'v', tinted ? 'it' : 'i'), kd.spots.length));
        im.frustumCulled = false;   // Instanzen liegen überall – die Kugel der Grundform passt nicht
        kd.spots.forEach(function (s, i) {
          im.setMatrixAt(i, spotMatrix(s, mtx));
          if (tinted) im.setColorAt(i, s.tint != null ? lin(s.tint) : white1);
        });
        im.instanceMatrix.needsUpdate = true;
        g.add(im); return im;
      });
      kd.meshes = meshes; kd.propSets = [];
      var entry = { name: kd.name, meshes: meshes, spots: kd.spots };
      // Platz i aus-/einblenden (Kamerafahrten): gilt für die prozedurale Deko und das Kulissen-Modell an diesem Platz
      entry.setHidden = function (i, hidden) { kd.spots[i].hidden = !!hidden; applySpot(kd, i); };
      decor.inst.push(entry);
    });
    // Platz i neu setzen: Modell geladen → prozedurale Instanz auf null, Modell-Instanzen sichtbar (außer ausgeblendet)
    function applySpot(kd, i) {
      var s = kd.spots[i], procOn = !s.hidden && s.prop == null;
      spotMatrix(s, mtx);
      // alle Plätze mit Modell → prozedurale Art gar nicht mehr zeichnen (spart den Zeichenaufruf)
      var anyProc = kd.spots.some(function (x) { return x.prop == null; });
      kd.meshes.forEach(function (m) { m.setMatrixAt(i, procOn ? mtx : ZERO_M); m.instanceMatrix.needsUpdate = true; m.visible = anyProc; });
      kd.propSets.forEach(function (ps1) {
        ps1.slots.forEach(function (sl, j) {
          if (sl.spot !== i) return;
          ps1.meshes.forEach(function (m) { m.setMatrixAt(j, s.hidden ? ZERO_M : sl.m); m.instanceMatrix.needsUpdate = true; });
        });
      });
    }

    // ---- Kulissen-Modelle: nach dem Aufbau nachladen (die Strecke steht sofort mit prozeduraler Deko) ----
    // opts.propGate() → false: gerade nicht laden/tauschen (Car Race: während des Rennens), später nochmal
    var disposed = false, propStats = { loaded: [], failed: [], tris: 0, draws: 0 };
    function propsFor(kd, cat) {
      // Katalog-Eintrag gilt für seinen slot (sonst kind) oder – optional – für alle in slots (ein Modell, mehrere Plätze),
      // ebenso für sein theme oder alle in themes
      var slot = kd.prop.slot || kd.name;
      return cat.props.filter(function (e) {
        if (!e || !e.uid) return false;
        if (Array.isArray(e.themes) ? e.themes.indexOf(theme.id) < 0 : e.theme && e.theme !== theme.id) return false;
        return Array.isArray(e.slots) ? e.slots.indexOf(slot) >= 0 : (e.slot || e.kind) === slot;
      });
    }
    function gateThen(fn) {
      if (disposed) return;
      if (opts.propGate && !opts.propGate()) { setTimeout(function () { gateThen(fn); }, 1000); return; }
      fn();
    }
    function swapIn(kd, v, nVar, tpl) {
      var P0 = kd.prop, box = P0.box || {}, size = tpl.size, yaw = P0.yaw || 0;
      // nur verkleinern: größte Ausdehnung muss in den reservierten Platz passen
      var k = Math.min(1, box.w ? box.w / size.x : 1, box.d ? box.d / size.z : 1, box.h ? box.h / size.y : 1);
      // front: Vorderkante (−z) des Modells auf lokal z = front (Tribüne: erste Reihe wie bei der prozeduralen)
      var oz = P0.front != null ? P0.front + size.z * k / 2 : 0, oy = (P0.y || 0) - tpl.sink * size.y * k;
      var n = 1, step = 0;
      if (P0.tile && box.w) { step = size.x * k * 1.04; n = Math.max(1, Math.min(6, Math.floor(box.w / step))); }
      var slots = [], m4 = new THREE.Matrix4(), off = new THREE.Matrix4();
      kd.spots.forEach(function (s, i) {
        if (i % nVar !== v) return;
        for (var t = 0; t < n; t++) {
          var lx = (t - (n - 1) / 2) * step;
          spotMatrix(s, m4);
          // lokal: Versatz entlang x (Kacheln), Absenken (Fuß im Wasser/Gelände), Zusatzdrehung, Maßstab
          off.compose(new THREE.Vector3(lx, oy, oz), new THREE.Quaternion().setFromAxisAngle(yAx, yaw), new THREE.Vector3(k, k, k));
          slots.push({ spot: i, m: new THREE.Matrix4().multiplyMatrices(m4, off) });
        }
      });
      if (!slots.length) return;
      var meshes = tpl.parts.map(function (p) {
        var im = own(new THREE.InstancedMesh(p.geo, p.mat, slots.length));
        im.frustumCulled = false;
        slots.forEach(function (sl, j) { im.setMatrixAt(j, sl.m); });
        im.instanceMatrix.needsUpdate = true;
        g.add(im); return im;
      });
      kd.propSets.push({ meshes: meshes, slots: slots });
      propStats.tris += tpl.tris * slots.length; propStats.draws += meshes.length;
      var seen = {};
      slots.forEach(function (sl) {
        var s = kd.spots[sl.spot];
        s.prop = v;
        if (!seen[sl.spot]) { seen[sl.spot] = 1; applySpot(kd, sl.spot); if (P0.onProp) P0.onProp(s, { height: size.y * k * s.s, scale: k }); }
      });
    }
    var propsReady = new Promise(function (resolve) {
      var users = kinds.filter(function (kd) { return kd.prop && kd.spots.length && kd.meshes; });
      if (!users.length) { resolve(propStats); return; }
      // erst nach dem ersten Bild der Strecke anfangen (Laden/Aufbereiten kostet Zeit auf dem Haupt-Thread)
      setTimeout(function () {
        gateThen(function () {
          loadPropCatalog().then(function (cat) {
            var jobs = [];
            users.forEach(function (kd) {
              var list = propsFor(kd, cat);
              list.forEach(function (e, v) {
                jobs.push(function () {
                  return loadPropTpl(e).then(function (tpl) {
                    return new Promise(function (ok) { gateThen(function () { if (!disposed) { swapIn(kd, v, list.length, tpl); propStats.loaded.push(e.key || e.uid); } ok(); }); });
                  }, function () { propStats.failed.push(e.key || e.uid); });
                });
              });
            });
            // nacheinander, mit Luft dazwischen (kein Ruckeln durch mehrere Modelle in einem Bild)
            (function next() {
              if (disposed || !jobs.length) { resolve(propStats); return; }
              jobs.shift()().then(function () { setTimeout(next, 60); });
            })();
          });
        });
      }, 250);
    });
    // Hintergrund: alles in eine Geometrie (ein Zeichenaufruf)
    if (bgKits.length) {
      var all = new Themes.Kit();
      bgKits.forEach(function (k) { Array.prototype.push.apply(all.pos, k.pos); Array.prototype.push.apply(all.col, k.col); });
      g.add(new THREE.Mesh(own(all.geo()), mat('v')));
    }
    // Bodenfarbe je Ecke (nach der Deko: Höfe/Ufer stehen erst dann fest)
    var gc = theme.groundColor(ctx);
    (function () {
      var cols = new Float32Array(NX * NZ * 3);
      for (var i = 0; i < NX * NZ; i++) {
        var x = tPos[i * 3], z = tPos[i * 3 + 2], d = outside(x, z) > 32 ? 1e9 : trackDist(x, z, HALF + 32) - HALF;
        var c = lin(gc(x, z, tPos[i * 3 + 1] + DROP, d));
        cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
      }
      terrainGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    })();
    // Fahrbahn, Curbs, Auslauf, Begrenzung, Rand-Deko (js/car-track-surface.js)
    var surfaceStats = null, surfaceRes = null;
    if (Surface) surfaceRes = Surface.build({
      T: T, P: P, n: n, ds: ds, HALF: HALF, g: g, own: own, heightAt: heightAt, trackDist: trackDist, runAt: runAt, gravel: gravelK,
      curvy: curvy, theme: theme, gc: gc, place: ctx.place, rng: ctx.rng, lin: lin, maxAniso: maxAniso, gantry: gantry, pit: ctx.pit || null,
      grassTex: grassTex, flat: flat
    });
    if (surfaceRes) surfaceStats = surfaceRes.stats;

    // ---- Gras-Abfrage (Car Drive: Halme aus js/car-drive-grass.js) ----
    // grassAt(x, z, out) → 0…1 (Anteil Gras): 0 auf Fahrbahn + Curbs, im Kiesbett (Kiesbett-Regel, ±3 Rasterpunkte
    // wie die weiche Mischung des Auslaufs), im Asphalt-Auslauf, an der Begrenzung, in der Boxengasse, auf belegten
    // Deko-Plätzen und wo die Bodenfarbe nicht grün ist (Höfe, Beton, Strand, Meer, Fels, Schnee, Waldboden, Ufer).
    // out (optional) bekommt { y (Höhe der sichtbaren Fläche), r, g, b (Bodenfarbe linear) }.
    var runoffKind = (theme.surface && theme.surface.runoff) || 'gravel';
    function grassAt(x, z, out) {
      var nr = trackNearest(x, z, HALF + 20), e = 1e9, band = false;
      if (nr.i >= 0) {
        var p = P[nr.i], sd = (x - p.x) * p.nx + (z - p.z) * p.nz >= 0 ? 1 : -1, Rr = 0;
        for (var k = -3; k <= 3; k++) Rr = Math.max(Rr, runAt((nr.i + k + n) % n, sd));   // Auslauf kann sprunghaft wechseln
        Rr += 0.3; e = nr.d - HALF;
        if (e < 1.9) return 0;
        if (e < Rr + 1.5) {
          band = true;
          if (runoffKind === 'tarmac' && e < Rr + 0.3) return 0;
          if (e > Rr - 0.4 && e < Rr + 0.7) return 0;   // Leitplanke, Mauer, Reifenstapel
          if (e < Rr) for (k = -3; k <= 3; k++) if (gravelK[sd][(nr.i + k + n) % n]) return 0;
        }
        var pit = ctx.pit;
        if (pit && sd === pit.sd && e < 16.5) {
          var sm = ((nr.i * ds - pit.s0) % T.len + T.len) % T.len;
          if (sm < pit.s1 - pit.s0 + 2) return 0;
        }
      }
      var r = Math.ceil((1 + occR) / OCC), gx = Math.floor(x / OCC), gz = Math.floor(z / OCC);
      for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) {
        var l = occ.get(hkey(gx + a, gz + b)); if (!l) continue;
        for (var q = 0; q < l.length; q++) { var o = l[q], dx = o[0] - x, dz = o[1] - z, rr = o[2] * 0.9; if (dx * dx + dz * dz < rr * rr) return 0; }
      }
      var y = band ? heightAt(x, z) + 0.015 : groundAt(x, z), c = gc(x, z, y + DROP, e);
      if (typeof c === 'number') c = lin(c);
      var gr = c.g > 1e-4 ? (c.g - Math.max(c.r, c.b)) / c.g : 0, w = Math.min(1, Math.max(0, (gr - 0.08) / 0.12));
      if (out && w > 0) { out.y = y; out.r = c.r; out.g = c.g; out.b = c.b; }
      return w;
    }

    // ---- Neigung ----
    function grad(x, z) { var e = 0.6; return [(heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)]; }
    var ZERO = { pitch: 0, roll: 0 };
    function slopeAt(x, z, yaw) {
      if (flat) return ZERO;
      var gr = grad(x, z), c = Math.cos(yaw), s = Math.sin(yaw);
      return { pitch: Math.atan(gr[0] * c - gr[1] * s), roll: -Math.atan(gr[0] * s + gr[1] * c) };
    }
    function normalAt(x, z, out) {
      out = out || new THREE.Vector3();
      if (flat) return out.set(0, 1, 0);
      var gr = grad(x, z); return out.set(-gr[0], 1, -gr[1]).normalize();
    }

    // ---- Licht/Nebel (die Lichter aus CarStage.setup bleiben, werden nur getönt) ----
    var envSaved = null;
    function applyEnv(scene, renderer, o) {
      restoreEnv();
      envSaved = { scene: scene, renderer: renderer, fog: scene.fog, bg: scene.background, exp: renderer ? renderer.toneMappingExposure : null, lights: [] };
      scene.fog = new THREE.Fog(theme.sky.horizon, theme.fog.near, theme.fog.far);
      if (o && o.background) scene.background = new THREE.Color(theme.sky.horizon);
      var dirs = 0;
      scene.children.forEach(function (l) {
        if (!l.isLight) return;
        envSaved.lights.push([l, l.color.clone(), l.intensity, l.position.clone(), l.groundColor ? l.groundColor.clone() : null]);
        if (l.isHemisphereLight) { l.color.set(theme.hemi.sky); l.groundColor.set(theme.hemi.ground); l.intensity *= theme.hemi.k; }
        else if (l.isDirectionalLight) {
          if (dirs === 0) { l.color.set(theme.sun.color); l.intensity *= theme.sun.k; if (theme.sun.pos) l.position.fromArray(theme.sun.pos); }
          else { l.color.set(theme.hemi.sky); l.intensity *= theme.fill; }
          dirs++;
        }
      });
      if (renderer && envSaved.exp != null) renderer.toneMappingExposure = envSaved.exp * (theme.exposure || 1);
    }
    function restoreEnv() {
      if (!envSaved) return;
      var e = envSaved; envSaved = null;
      e.scene.fog = e.fog; e.scene.background = e.bg;
      if (e.renderer && e.exp != null) e.renderer.toneMappingExposure = e.exp;
      e.lights.forEach(function (s) { s[0].color.copy(s[1]); s[0].intensity = s[2]; s[0].position.copy(s[3]); if (s[4]) s[0].groundColor.copy(s[4]); });
    }
    function update(dt) {
      if (reduce || !(dt > 0)) return;
      timeU.value += dt;
      for (var i = 0; i < anims.length; i++) anims[i](dt);
    }

    return {
      group: g, theme: theme, nearTrack: nearTrack, trackDist: trackDist, decor: decor, P: P, gantry: gantry,
      heightAt: heightAt, groundAt: groundAt, slopeAt: slopeAt, normalAt: normalAt, applyEnv: applyEnv, update: update,
      props: propsReady, propStats: propStats, surfaceStats: surfaceStats, grassAt: grassAt,
      // Bewegungsunschärfe der Fahrbahn in Metern (Car Drive, Tempogefühl); 0 = aus
      setMotionBlur: function (m) { if (surfaceRes && surfaceRes.setMotionBlur) surfaceRes.setMotionBlur(m); },
      dispose: function () {
        disposed = true;
        restoreEnv();
        if (g.parent) g.parent.remove(g);
        owned.forEach(function (x) { if (x && x.dispose) x.dispose(); }); owned = [];
      }
    };
  }
  // Quellenangaben der Kulissen-Modelle (CC BY) für Übersichtsseiten: Promise → [{ name, author, license, url, kind, theme }]
  root.CarTrackScene = { build: build, propCredits: function () { return loadPropCatalog().then(function (c) { return c.credits; }); } };
})(typeof window !== 'undefined' ? window : this);
