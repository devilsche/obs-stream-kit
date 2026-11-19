/* Autos für den Party-Regen (effects/item-rain.html?kind=car|mix): echte 3D-Modelle von Sketchfab
 * (im Car-Picker ausgewählt, mit scripts/build_car_rain.py aufbereitet, Katalog /api/fx/cars/catalog.json,
 * Dateien /api/fx/cars/model/<uid>.glb). Braucht three r128, GLTFLoader und js/glb-fix.js davor.
 *
 *   ToyCars.ready({ model, count }) → Promise   lädt den Katalog und count zufällige Modelle aus dem Mix
 *                                               (oder genau model, bzw. model=brand:<Marke> nur diese Marke)
 *   ToyCars.MODELS          geladene Modelle (Schlüssel), aus denen der Regen zieht
 *   ToyCars.has(key), ToyCars.dims(key) → { L, W, H, belt }, ToyCars.pickPaint(key) → { c, r?, z? } (Farbset)
 *   ToyCars.paintAt(key, i) → Farbset Nummer i aus dem Editor (ungültig: erstes Set, ohne Sets Originalfarbe)
 *   ToyCars.build(key, color) → THREE.Group (Mitte im Auto, Länge in x, Front +x, ~4,4 Einheiten je 4,5 m)
 *   ToyCars.applyCustom({ vehicles }) – Lackfarben, Felgenfarbe, Mix aus dem Auto-Editor (/api/fx/cars/custom.js)
 *   ToyCars.prepare(gltfScene, entry) → Vorlage (für Editor/Übersicht)
 *
 * Ausrichtung: Längsachse = längere von x/z, Front aus dem Katalog (eingeschlagene Räder, Lampen-Namen),
 * sonst die Seite mit dem kürzeren Überhang (Abstand Radachse–Fahrzeugende). Größe nach entry.len (m).
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  var UNIT = 4.4 / 4.5;            // Einheiten je Meter (ein 4,5-m-Auto ist 4,4 Einheiten lang, wie früher)
  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src || '';
    var m = /^(.*\/s\/[^/]+\/)/.exec(s) || /^(.*\/)js\/toy-cars\.js/.exec(s);
    return m ? m[1] : '../';
  })();
  var CATALOG = [], BYKEY = {}, TPL = {}, CUSTOM = {}, MODELS = [], PAINTS = {}, loading = {};
  // Materiallisten je Modell außerhalb von userData: three.js kopiert userData beim Klonen per JSON –
  // Materialien/Gruppen dort würden bei jedem fallenden Auto samt Texturen serialisiert (Ruckeln)
  var META = {};
  var EDIT = false;   // Car editor: Teile nicht zusammenfassen (einzeln anklickbar)

  function applyCustom(c) { CUSTOM = (c && c.vehicles) || {}; PAINTS = {}; }
  function vehicle(key) { return CUSTOM[key] || {}; }
  function inMix(e) { return vehicle(e.key).mix !== false; }

  function loadCatalog() {
    if (CATALOG.length) return Promise.resolve(CATALOG);
    return fetch(BASE + 'api/fx/cars/catalog.json', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (list) {
      CATALOG = Array.isArray(list) ? list : [];
      CATALOG.forEach(function (e) { BYKEY[e.key] = e; });
      return CATALOG;
    });
  }

  // Starre Teile mit gleichem Material zu einem Mesh zusammenfassen (weniger Zeichenaufrufe – bei 40 Autos
  // mit je dutzenden Teilen sonst tausende pro Bild); Räder (Gruppen „Wheel …“) bleiben eigene Teile
  function mergeStatic(scene) {
    var BGU = THREE.BufferGeometryUtils;
    if (!BGU || !BGU.mergeBufferGeometries) return;
    scene.updateMatrixWorld(true);
    var inv = new THREE.Matrix4().copy(scene.matrixWorld).invert(), groups = {};
    function inWheel(o) { for (var p = o; p && p !== scene; p = p.parent) if (/^Wheel /.test(p.name || '')) return true; return false; }
    scene.traverse(function (o) {
      if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material) || inWheel(o)) return;
      var g = o.geometry; if (!g || !g.attributes.position || Object.keys(g.morphAttributes || {}).length) return;
      var sig = o.material.uuid + '|' + Object.keys(g.attributes).sort().join(',') + '|' + (g.index ? 'i' : 'n') + '|' + o.renderOrder;
      (groups[sig] = groups[sig] || { mat: o.material, order: o.renderOrder, list: [] }).list.push(o);
    });
    Object.keys(groups).forEach(function (k) {
      var gr = groups[k]; if (gr.list.length < 2) return;
      var geos = gr.list.map(function (o) { var gg = o.geometry.clone(); gg.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); return gg; });
      var merged = null;
      try { merged = BGU.mergeBufferGeometries(geos, false); } catch (err) { merged = null; }
      if (!merged) return;
      var mesh = new THREE.Mesh(merged, gr.mat); mesh.renderOrder = gr.order; scene.add(mesh);
      gr.list.forEach(function (o) { if (o.parent) o.parent.remove(o); });
    });
  }

  // Teile in zusammenhängende Stücke zerlegen (Tür und Gerüst sind oft ein Mesh): Ecken verbunden über
  // gemeinsame Dreiecke oder gleiche Position. So ist im Editor jedes Stück einzeln wählbar; der Regen
  // fasst danach wieder zusammen (mergeStatic). Mehr als 400 Stücke: Mesh bleibt ganz.
  function islandsOf(geo, noWeld) {
    var pos = geo.attributes.position, n = pos.count, idx = geo.index ? geo.index.array : null, nt = (idx ? idx.length : n) / 3;
    var par = new Int32Array(n); for (var i = 0; i < n; i++) par[i] = i;
    function f(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
    function u(a, b) { a = f(a); b = f(b); if (a !== b) par[b] = a; }
    var seen = {};
    for (i = 0; i < n && !noWeld; i++) {
      var k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
      if (seen[k] !== undefined) u(seen[k], i); else seen[k] = i;
    }
    for (var t = 0; t < nt; t++) { var a = idx ? idx[t * 3] : t * 3; u(a, idx ? idx[t * 3 + 1] : t * 3 + 1); u(a, idx ? idx[t * 3 + 2] : t * 3 + 2); }
    var groups = {}, order = [];
    for (t = 0; t < nt; t++) { var r = f(idx ? idx[t * 3] : t * 3); if (!groups[r]) { groups[r] = []; order.push(r); } groups[r].push(t); }
    return order.map(function (r) { return groups[r]; });
  }
  function subGeo(geo, tris) {
    var idx = geo.index ? geo.index.array : null, out = new THREE.BufferGeometry();
    Object.keys(geo.attributes).forEach(function (an) {
      var at = geo.attributes[an], sz = at.itemSize, Arr = at.isInterleavedBufferAttribute ? Float32Array : at.array.constructor;
      var arr = new Arr(tris.length * 3 * sz), o = 0;
      tris.forEach(function (t) {
        for (var q = 0; q < 3; q++) {
          var vi = idx ? idx[t * 3 + q] : t * 3 + q;
          for (var c = 0; c < sz; c++) arr[o++] = at.isInterleavedBufferAttribute ? [at.getX, at.getY, at.getZ, at.getW][c].call(at, vi) : at.array[vi * sz + c];
        }
      });
      out.setAttribute(an, new THREE.BufferAttribute(arr, sz, at.normalized));
    });
    return out;
  }
  // sehr viele Stücke (z. B. 1386 Profilklötze auf 6 Reifen): Stücke, deren Hüllquader sich berühren, zusammenfassen
  function clusterIslands(geo, isl) {
    var pos = geo.attributes.position, idx = geo.index ? geo.index.array : null;
    if (!geo.boundingBox) geo.computeBoundingBox();
    var sz = new THREE.Vector3(); geo.boundingBox.getSize(sz); var eps = sz.length() * 0.002;
    var bx = isl.map(function (tris) {
      var b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      tris.forEach(function (t) { for (var q = 0; q < 3; q++) { var v = idx ? idx[t * 3 + q] : t * 3 + q, x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (z < b[2]) b[2] = z; if (x > b[3]) b[3] = x; if (y > b[4]) b[4] = y; if (z > b[5]) b[5] = z; } });
      return b;
    });
    var n = isl.length, par = []; for (var i = 0; i < n; i++) par[i] = i;
    function f(a) { while (par[a] !== a) a = par[a] = par[par[a]]; return a; }
    for (i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
      var A = bx[i], B = bx[j];
      if (A[0] - eps <= B[3] && B[0] - eps <= A[3] && A[1] - eps <= B[4] && B[1] - eps <= A[4] && A[2] - eps <= B[5] && B[2] - eps <= A[5]) par[f(j)] = f(i);
    }
    var g = {}, order = [];
    for (i = 0; i < n; i++) { var r = f(i); if (!g[r]) { g[r] = []; order.push(r); } g[r] = g[r].concat(isl[i]); }
    return order.map(function (r) { return g[r]; });
  }
  // Flächen nach Richtung trennen: Dreiecke über gemeinsame Kanten (Ecken verschweißt) verbinden, aber nur,
  // wenn ihre Flächen weniger als maxDeg abknicken – Seitenwand, Dach, Front werden eigene Stücke
  function facesOf(geo, maxDeg) {
    var pos = geo.attributes.position, idx = geo.index ? geo.index.array : null, nt = (idx ? idx.length : pos.count) / 3;
    function vi(t, q) { return idx ? idx[t * 3 + q] : t * 3 + q; }
    function key(i) { return Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4); }
    var N = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t, q;
    for (t = 0; t < nt; t++) {
      a.fromBufferAttribute(pos, vi(t, 0)); b.fromBufferAttribute(pos, vi(t, 1)); c.fromBufferAttribute(pos, vi(t, 2));
      N.push(new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).normalize());
    }
    var par = new Int32Array(nt); for (t = 0; t < nt; t++) par[t] = t;
    function f(x) { while (par[x] !== x) x = par[x] = par[par[x]]; return x; }
    var edges = {}, cos = Math.cos(maxDeg * Math.PI / 180);
    for (t = 0; t < nt; t++) for (q = 0; q < 3; q++) {
      var A = key(vi(t, q)), B = key(vi(t, (q + 1) % 3)), e = A < B ? A + '|' + B : B + '|' + A;
      (edges[e] || (edges[e] = [])).push(t);
    }
    Object.keys(edges).forEach(function (e) {
      var L = edges[e];
      for (var i = 1; i < L.length; i++) if (N[L[0]].dot(N[L[i]]) >= cos) par[f(L[i])] = f(L[0]);
    });
    var groups = {}, order = [];
    for (t = 0; t < nt; t++) { var r = f(t); if (!groups[r]) { groups[r] = []; order.push(r); } groups[r].push(t); }
    return order.map(function (r) { return groups[r]; });
  }
  function splitIslands(scene) {
    var list = [];
    scene.traverse(function (o) { if (o.isMesh && !o.isSkinnedMesh && !Array.isArray(o.material) && o.geometry && o.geometry.attributes.position) list.push(o); });
    list.forEach(function (o) {
      var isl = islandsOf(o.geometry), nt = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      // ein einziges Netz mit Textur (Low-Poly-Atlas: Scheinwerfer, Kennzeichen nur aufgemalt): nach Textur-Inseln trennen
      // (an UV-Nähten sind die Ecken doppelt, ohne Verschweißen zerfällt das Netz in die Bereiche des Texturbilds)
      if (isl.length < 2 || Math.max.apply(null, isl.map(function (x) { return x.length; })) > nt * 0.9) {
        if (o.material && o.material.map && o.geometry.attributes.uv) { var uvIsl = islandsOf(o.geometry, true); if (uvIsl.length > 1 && uvIsl.length <= 400) isl = uvIsl; }
      }
      if (isl.length > 400) isl = clusterIslands(o.geometry, isl);
      if (isl.length < 2 || isl.length > 400) return;
      var base = o.name || '';
      isl.forEach(function (tris, k) {
        var m = new THREE.Mesh(subGeo(o.geometry, tris), o.material);
        m.name = (base || 'part') + '/' + k; m.renderOrder = o.renderOrder;
        m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
        m.userData = Object.assign({}, o.userData);
        o.parent.add(m);
      });
      o.parent.remove(o);
    });
  }

  // weich schattieren: Normalen gleich liegender Ecken mitteln, außer an Kanten über maxDeg (flach schattierte Räder wirken sonst eckig)
  function smoothNormals(g, maxDeg) {
    var pos = g.attributes.position, nrm = g.attributes.normal;
    if (!pos) return;
    if (!nrm) { g.computeVertexNormals(); return; }
    if (!g.boundingBox) g.computeBoundingBox();
    var sz = new THREE.Vector3(); g.boundingBox.getSize(sz);
    var eps = Math.max(1e-7, sz.length() * 1e-5), n = pos.count, map = {}, cos = Math.cos(maxDeg * Math.PI / 180), i, j;
    for (i = 0; i < n; i++) {
      var k = Math.round(pos.getX(i) / eps) + ',' + Math.round(pos.getY(i) / eps) + ',' + Math.round(pos.getZ(i) / eps);
      (map[k] || (map[k] = [])).push(i);
    }
    var src = new Float32Array(n * 3), out = new Float32Array(n * 3);
    for (i = 0; i < n; i++) { src[i * 3] = nrm.getX(i); src[i * 3 + 1] = nrm.getY(i); src[i * 3 + 2] = nrm.getZ(i); }
    // je Lage: Ecken mit ähnlicher Richtung (Kette unter maxDeg) zu Gruppen verbinden, jede Gruppe bekommt
    // genau eine gemittelte Normale – so gibt es an glatten Stellen keinen Sprung, echte Kanten bleiben
    Object.keys(map).forEach(function (k) {
      var gr = map[k], m = gr.length, par = [];
      for (var q = 0; q < m; q++) par[q] = q;
      function f(q) { while (par[q] !== q) q = par[q] = par[par[q]]; return q; }
      for (var a = 0; a < m; a++) for (var b = a + 1; b < m; b++) {
        var A = gr[a] * 3, B = gr[b] * 3;
        if (src[A] * src[B] + src[A + 1] * src[B + 1] + src[A + 2] * src[B + 2] >= cos) par[f(b)] = f(a);
      }
      var acc = {};
      gr.forEach(function (vi, q) { var r = f(q), c = acc[r] || (acc[r] = [0, 0, 0]); c[0] += src[vi * 3]; c[1] += src[vi * 3 + 1]; c[2] += src[vi * 3 + 2]; });
      gr.forEach(function (vi, q) {
        var c = acc[f(q)], l = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) || 1;
        out[vi * 3] = c[0] / l; out[vi * 3 + 1] = c[1] / l; out[vi * 3 + 2] = c[2] / l;
      });
    });
    g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  }

  // Hüllquader aus den Eckpunkten selbst (Weltlage): Box3.setFromObject in three r128 dreht nur den Quader der
  // Geometrie mit – bei schräg liegenden Teilen (Ferrari 296 GT3, Teile-Achsen ~53° bzw. leicht gekippt) wird er
  // zu groß, das Auto schwebt dann über dem Boden und wird zu klein skaliert
  function exactBox(obj) {
    obj.updateMatrixWorld(true);
    var b = new THREE.Box3(), v = new THREE.Vector3();
    obj.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      var p = o.geometry.attributes.position, M = o.matrixWorld;
      for (var i = 0; i < p.count; i++) b.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(M));
    });
    return b.isEmpty() ? new THREE.Box3().setFromObject(obj) : b;
  }

  // Modell ausrichten, skalieren, mittig setzen; Räder/Lack über GlbFix
  // Räder aus selbst gewählten Teilen (Car editor „Pick wheel parts“): Teile nach Lage zu Rädern gruppieren
  // (Seite, dann entlang der Länge), je Rad Drehpunkt in der Mitte, Drehgruppe „Spin“ um die Querachse
  // rollKeys: Teile, die sich beim Fahren drehen (Reifen, Felgen); steerKeys: Teile, die beim Lenken mitgehen
  // (Vorderräder samt Bremssätteln). Ein Teil darf in beiden sein. Ein Rad lenkt, sobald eines seiner Teile lenkt;
  // nur lenkende Teile (Bremssattel) drehen nicht mit. Ohne steerKeys lenkt die vorderste Achse.
  function buildWheels(scene, rollKeys, steerKeys) {
    steerKeys = steerKeys || [];
    scene.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(scene), size = new THREE.Vector3(), ctr = new THREE.Vector3(); box.getSize(size); box.getCenter(ctr);
    var lx = size.x >= size.z, len = lx ? size.x : size.z, parts = [];
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      var roll = rollKeys.indexOf(o.userData.pkey) >= 0, steer = steerKeys.indexOf(o.userData.pkey) >= 0;
      if (!roll && !steer) return;
      var b = new THREE.Box3().setFromObject(o), c = new THREE.Vector3(); b.getCenter(c); parts.push({ o: o, c: c, b: b, roll: roll, steer: steer });
    });
    var groups = [], flagged = steerKeys.length > 0;
    ['l', 'r'].forEach(function (side) {
      var ps = parts.filter(function (p) { var w = lx ? p.c.z - ctr.z : p.c.x - ctr.x; return side === 'r' ? w > 0 : w <= 0; });
      ps.sort(function (a, b) { return lx ? a.c.x - b.c.x : a.c.z - b.c.z; });
      var cur = null;
      ps.forEach(function (p) {
        var l = lx ? p.c.x : p.c.z;
        if (!cur || l - cur.last > len * 0.08) { cur = { side: side, list: [], last: l }; groups.push(cur); }
        cur.list.push(p); cur.last = l;
      });
    });
    groups.forEach(function (g, i) {
      // Drehpunkt = Mitte der rollenden Teile (Bremssattel sitzt außermittig), sonst aller Teile
      var b = new THREE.Box3(), rl = g.list.filter(function (p) { return p.roll; });
      (rl.length ? rl : g.list).forEach(function (p) { b.union(p.b); });
      var c = new THREE.Vector3(); b.getCenter(c);
      var pivot = new THREE.Group(); pivot.name = 'Wheel ' + g.side + i; pivot.position.copy(c); scene.add(pivot);
      if (flagged) pivot.userData.front = g.list.some(function (p) { return p.steer; });
      var spin = new THREE.Group(); spin.name = 'Spin'; spin.userData.ax = lx ? 'z' : 'x'; pivot.add(spin);
      scene.updateMatrixWorld(true);
      g.list.forEach(function (p) { (p.roll ? spin : pivot).attach(p.o); p.o.userData.wheelPart = true; });
    });
    return groups.length;
  }

  function prepare(scene, e) {
    var v = vehicle(e.key);
    // kurzzeitig gespeichert: frontWheelParts = lenkt und dreht
    if (Array.isArray(v.frontWheelParts) && !Array.isArray(v.steerParts))
      v = Object.assign({}, v, { steerParts: v.frontWheelParts.slice(), wheelParts: (v.wheelParts || []).concat(v.frontWheelParts) });
    // eigene Räder: ausdrücklich gewählte Radteile, sonst die gewählten Felgen (plus Reifen) – dann dreht nur das
    var own = Array.isArray(v.wheelParts) || Array.isArray(v.steerParts) || (Array.isArray(v.rimParts) && v.rimParts.length > 0);
    if (root.GlbFix) GlbFix.prepare(scene, { wheels: !own, straight: v.straight !== false, align: true });
    splitIslands(scene);
    // feste Schlüssel je Material (Name, sonst Reihenfolge) – für die Auswahl im Car editor
    var all = [], seen = {}, names = {};
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      [].concat(o.material).forEach(function (m) {
        if (!m || seen[m.uuid]) return; seen[m.uuid] = 1;
        var base = m.name || '#' + all.length; names[base] = (names[base] || 0) + 1;
        m.userData.key = names[base] > 1 ? base + '~' + names[base] : base;
        all.push(m);
      });
    });
    function byKeys(keys) { return all.filter(function (m) { return keys.indexOf(m.userData.key) >= 0; }); }
    // feste Schlüssel je Teil (Mesh): Name bzw. Reihenfolge, Radteile mit Rad und Material – Auswahl im Editor
    var pk = {}, n = 0;
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      var base = o.name || '#' + n;   // unabhängig davon, ob das Teil an einem Rad hängt (Auswahl bleibt stabil)
      n++; pk[base] = (pk[base] || 0) + 1;
      o.userData.pkey = pk[base] > 1 ? base + '~' + pk[base] : base;
    });
    // „Split a part“ im Car editor: einzelne Teile fein zerlegen (an harten Kanten/UV-Nähten, ohne Verschweißen);
    // Stücke heißen <Teil>.<n>; Auswahlen auf das ganze Teil gelten für alle Stücke, Stücke ohne Zerlegung fürs ganze Teil
    var kids = {}, exists = {};
    if (Array.isArray(v.splitParts) && v.splitParts.length) {
      var todo = [];
      scene.traverse(function (o) { if (o.isMesh && !Array.isArray(o.material) && v.splitParts.indexOf(o.userData.pkey) >= 0) todo.push(o); });
      todo.forEach(function (o) {
        var isl = islandsOf(o.geometry, true);
        // ohne gemeinsame Ecken (jedes Dreieck einzeln gespeichert, z. B. der Trolza-Bus) oder ohne Nähte:
        // nach Flächenrichtung trennen, sehr viele Flächen nach Berührung zusammenfassen
        var ntri = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
        if (isl.length < 2 || isl.length > 400 || isl.length === ntri) isl = facesOf(o.geometry, 35);
        if (isl.length > 400) isl = clusterIslands(o.geometry, isl);
        if (isl.length < 2 || isl.length > 400) return;
        kids[o.userData.pkey] = [];
        isl.forEach(function (tris, j) {
          var m = new THREE.Mesh(subGeo(o.geometry, tris), o.material);
          m.name = o.name + '.' + j; m.renderOrder = o.renderOrder;
          m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
          m.userData = Object.assign({}, o.userData, { pkey: o.userData.pkey + '.' + j });
          kids[o.userData.pkey].push(m.userData.pkey); o.parent.add(m);
        });
        o.parent.remove(o);
      });
    }
    var byBase = {};
    scene.traverse(function (o) {
      if (!o.isMesh) return; exists[o.userData.pkey] = 1;
      var m = /^(.*)\/\d+$/.exec(o.userData.pkey || ''); if (m) (byBase[m[1]] || (byBase[m[1]] = [])).push(o.userData.pkey);
    });
    function norm(list) {
      if (!Array.isArray(list)) return list;
      var out = [];
      list.forEach(function (k) {
        var add = kids[k] || (!exists[k] && byBase[k]) || (!exists[k] && /\.\d+$/.test(k) && exists[k.replace(/\.\d+$/, '')] ? [k.replace(/\.\d+$/, '')] : [k]);
        add.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
      });
      return out;
    }
    v = Object.assign({}, v, { paintParts: norm(v.paintParts), rimParts: norm(v.rimParts), wheelParts: norm(v.wheelParts), steerParts: norm(v.steerParts),
      zones: Array.isArray(v.zones) ? v.zones.map(function (z) { return Object.assign({}, z, { parts: norm(z.parts) }); }) : v.zones });
    var wheelKeys = Array.isArray(v.wheelParts) || Array.isArray(v.steerParts) ? (v.wheelParts || []) : null;
    if (!wheelKeys && own) {
      // Felgen + Reifen (Material heißt tire/tyre/reifen/rubber, nicht Dichtungen/Leisten)
      wheelKeys = v.rimParts.slice();
      scene.traverse(function (o) {
        if (!o.isMesh) return;
        var nm = [].concat(o.material).map(function (m) { return (m && m.name) || ''; }).join(' ');
        if (/tire|tyre|reifen|rubber|whitewall/i.test(nm) && !/trim|seal|strip|window|door/i.test(nm)) wheelKeys.push(o.userData.pkey);
      });
    }
    var ownWheels = own && wheelKeys && (wheelKeys.length || (v.steerParts || []).length) ? buildWheels(scene, wheelKeys, v.steerParts || []) : 0;
    var ud = scene.userData;
    // „Smooth wheel shading“ im Car editor: alle Teile an den Rädern weich schattieren
    if (v.smoothWheels) {
      var sm = [];
      scene.traverse(function (o) { if (o.isMesh && o.userData.wheelPart && sm.indexOf(o.geometry) < 0) sm.push(o.geometry); });
      sm.forEach(function (g) { smoothNormals(g, 50); });
    }
    // gewählte Teile (paintParts/rimParts) bekommen eigene Material-Kopien: nur sie werden umgefärbt,
    // auch wenn ihr Material sonst z. B. mit den Scheinwerfern geteilt ist
    function partMats(parts, tag) {
      var out = [], copies = {};
      scene.traverse(function (o) {
        if (!o.isMesh || parts.indexOf(o.userData.pkey) < 0 || Array.isArray(o.material)) return;
        var m = o.material, c = copies[m.uuid];
        if (!c) { c = copies[m.uuid] = m.clone(); c.userData = { key: m.userData.key + '@' + tag }; out.push(c); }
        o.material = c;
      });
      return out;
    }
    var paint = Array.isArray(v.paintParts) ? partMats(v.paintParts, 'paint') : Array.isArray(v.paintMats) ? byKeys(v.paintMats) : (ud.paintMats || []);
    var rim = Array.isArray(v.rimParts) ? partMats(v.rimParts, 'rim') : Array.isArray(v.rimMats) ? byKeys(v.rimMats) : (ud.rimMats || []);
    // eigene Farbbereiche (Car editor „Colour zones“): je Bereich eigene Material-Kopien, gewinnen gegen Lack/Felge
    var zones = {};
    (Array.isArray(v.zones) ? v.zones : []).forEach(function (z) {
      if (z && z.id && Array.isArray(z.parts) && z.parts.length) zones[z.id] = partMats(z.parts, 'z' + z.id);
    });
    var autoPaint = {}, autoRim = {};
    (ud.paintMats || []).forEach(function (m) { autoPaint[m.uuid] = 1; }); (ud.rimMats || []).forEach(function (m) { autoRim[m.uuid] = 1; });
    var autoPaintParts = [], autoRimParts = [];
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      var ms = [].concat(o.material);
      if (ms.some(function (m) { return m && autoPaint[m.uuid]; })) autoPaintParts.push(o.userData.pkey);
      if (ms.some(function (m) { return m && autoRim[m.uuid]; })) autoRimParts.push(o.userData.pkey);
    });
    META[e.key] = { all: all, paint: paint, rim: rim, zones: zones, norm: norm, kids: kids, autoPaintParts: autoPaintParts, autoRimParts: autoRimParts, wheels: ownWheels || (ud.wheels || []).length };
    if (!EDIT) mergeStatic(scene);   // im Editor einzeln lassen: Teile müssen anklickbar bleiben
    scene.updateMatrixWorld(true);
    // Längsachse und Front-Schätzung wie bisher über Box3 (sonst kippt bei knappen Überhängen die Fahrtrichtung)
    var box = new THREE.Box3().setFromObject(scene), size = new THREE.Vector3(); box.getSize(size);
    var lx = size.x >= size.z, front = e.front || 0;
    if (!front) {
      // kürzerer Überhang vorn: Radmitten gegen die Fahrzeugenden
      var ws = []; scene.traverse(function (o) { if (/^Wheel /.test(o.name || '')) ws.push(o); });
      if (ws.length >= 4) {
        var vals = ws.map(function (w) { var p = new THREE.Vector3(); w.getWorldPosition(p); return lx ? p.x : p.z; });
        var lo = lx ? box.min.x : box.min.z, hi = lx ? box.max.x : box.max.z;
        front = (hi - Math.max.apply(null, vals)) < (Math.min.apply(null, vals) - lo) ? 1 : -1;
      } else front = 1;
    }
    if (vehicle(e.key).flip) front = -front;   // im Car editor als falsch herum markiert
    var rot = new THREE.Group(); rot.add(scene);
    rot.rotation.y = lx ? (front > 0 ? 0 : Math.PI) : (front > 0 ? Math.PI / 2 : -Math.PI / 2);
    rot.updateMatrixWorld(true);
    box = exactBox(rot); box.getSize(size);
    var k = (e.len || 4.5) * UNIT / Math.max(1e-6, size.x);
    var wrap = new THREE.Group(); wrap.add(rot); wrap.scale.setScalar(k);
    var c = new THREE.Vector3(); box.getCenter(c); size.multiplyScalar(k);
    rot.position.sub(c);
    var car = new THREE.Group(); car.add(wrap); car.name = e.key;
    car.userData.dims = { L: size.x, W: size.z, H: size.y, belt: size.y * 0.62 };
    car.userData.key = e.key;
    delete ud.wheels; delete ud.paintMats; delete ud.rimMats; delete ud.rimFromPaint;
    return car;
  }
  // opts.race: leichte Renn-Version (<uid>.race.glb, Texturen ≤ 256 px; der Server liefert sonst das volle Modell).
  // Die Vorlage liegt unter demselben Schlüssel wie das volle Modell (build() sucht dort) – eine Seite lädt nur eine Variante.
  function loadModel(e, opts) {
    if (TPL[e.key]) return Promise.resolve(TPL[e.key]);
    if (loading[e.key]) return loading[e.key];
    return (loading[e.key] = new Promise(function (res, rej) {
      new THREE.GLTFLoader().load(BASE + 'api/fx/cars/model/' + e.uid + (opts && opts.race ? '.race.glb' : '.glb'), function (gl) {
        try { TPL[e.key] = prepare(gl.scene, e); res(TPL[e.key]); } catch (err) { rej(err); }
      }, null, rej);
    }));
  }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // Katalog + Auswahl laden: auflösen, sobald das erste Modell fertig ist (oder nach timeout); die übrigen
  // laden weiter und kommen in MODELS dazu – der Regen zieht bei jedem neuen Auto aus der aktuellen Liste.
  // Bevorzugt kleine Dateien (zwei Drittel der Auswahl aus der kleineren Hälfte des Katalogs).
  function ready(opts) {
    opts = opts || {};
    var count = opts.count || 4, timeout = opts.timeout || 10000;
    return loadCatalog().then(function () {
      var pick;
      var brand = /^brand:(.+)$/i.exec(opts.model || '');
      if (opts.model && BYKEY[opts.model]) pick = [BYKEY[opts.model]];
      else {
        // model=brand:<Marke>: nur Autos dieser Marke (auch die, die nicht im Mix sind)
        var mix = (brand ? CATALOG.filter(function (e) { return (e.brand || '').toLowerCase() === brand[1].toLowerCase(); }) : CATALOG.filter(inMix)).sort(function (a, b) { return (a.bytes || 0) - (b.bytes || 0); });
        var small = shuffle(mix.slice(0, Math.ceil(mix.length / 2))), big = shuffle(mix.slice(Math.ceil(mix.length / 2)));
        var nSmall = Math.min(small.length, Math.ceil(count * 2 / 3));
        pick = small.slice(0, nSmall).concat(big.slice(0, count - nSmall));
        // kleinste zuerst laden, damit der Regen schnell starten kann
        pick.sort(function (a, b) { return (a.bytes || 0) - (b.bytes || 0); });
      }
      return new Promise(function (resolve) {
        var done = false;
        function finish() { if (done) return; done = true; resolve(MODELS.slice()); }
        if (!pick.length) return finish();
        pick.forEach(function (e) {
          loadModel(e).then(function () { if (MODELS.indexOf(e.key) < 0) MODELS.push(e.key); finish(); }).catch(function () {});
        });
        setTimeout(finish, timeout);
      });
    }).catch(function () { return MODELS.slice(); });
  }

  // Farbset: Liste aus dem Editor (gewichtet). c = Lack (null = Originalfarbe des Modells),
  // r = Felge (fehlt = Felgenfarbe des Autos, null = Original), z = Bereichsfarben {Bereich: Farbe} (fehlt = Grundfarbe)
  function setOf(p) {
    var o = { c: p.c == null ? null : p.c };
    if (p.r !== undefined) o.r = p.r;
    if (p.z && typeof p.z === 'object') o.z = p.z;
    return o;
  }
  function pickPaint(key) {
    var list = vehicle(key).paints;
    if (!Array.isArray(list) || !list.length) return { c: null };
    var sum = 0, r; list.forEach(function (p) { sum += p.w || 1; }); r = Math.random() * sum;
    for (var i = 0; i < list.length; i++) { r -= list[i].w || 1; if (r <= 0) return setOf(list[i]); }
    return setOf(list[0]);
  }
  // Farbset Nummer i aus dem Editor (Car Race: der Server würfelt den Index); ungültiger Index → erstes Set,
  // ohne Sets Originalfarbe – nie zufällig, damit jede Overlay-Instanz dieselben Farben zeigt
  function paintAt(key, i) {
    var list = vehicle(key).paints;
    if (!Array.isArray(list) || !list.length) return { c: null };
    return setOf(list[i >= 0 && list[i | 0] ? i | 0 : 0]);
  }
  // Oberflächen der Farbbereiche: [Metall, Rauheit, Klarlack]
  var FINISH = { matte: [0, 0.85, 0], satin: [0.1, 0.5, 0], gloss: [0.1, 0.22, 1], shiny: [0.35, 0.1, 1], chrome: [1, 0.06, 0], glass: [0, 0.04, 1] };
  // mittlere (lineare) Helligkeit einer Textur, damit die Graustufen-Struktur im Mittel 1 ergibt
  var LUM = {};
  function texLum(tex) {
    if (LUM[tex.uuid] != null) return LUM[tex.uuid];
    var v = 0.5;
    try {
      var img = tex.image, cv = document.createElement('canvas'); cv.width = cv.height = 32;
      var g = cv.getContext('2d'); g.drawImage(img, 0, 0, 32, 32);
      var d = g.getImageData(0, 0, 32, 32).data, sum = 0, n = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        var l = 0.2126 * Math.pow(d[i] / 255, 2.2) + 0.7152 * Math.pow(d[i + 1] / 255, 2.2) + 0.0722 * Math.pow(d[i + 2] / 255, 2.2);
        sum += l; n++;
      }
      if (n) v = Math.max(0.02, sum / n);
    } catch (e) { /* kein Bild/Canvas (z. B. Node) */ }
    return (LUM[tex.uuid] = v);
  }
  // Textur nur als Struktur: Graustufen, auf mittlere Helligkeit 1 normiert, mal Bereichsfarbe
  function detailMap(c) {
    var k = 1 / texLum(c.map);
    c.onBeforeCompile = function (sh) {
      sh.uniforms.uDetailK = { value: k };
      sh.fragmentShader = 'uniform float uDetailK;\n' + sh.fragmentShader.replace('#include <map_fragment>', [
        '#ifdef USE_MAP',
        '  vec4 texelColor = mapTexelToLinear( texture2D( map, vUv ) );',
        '  float dl = dot( texelColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) * uDetailK;',
        '  diffuseColor.rgb *= mix( 1.0, clamp( dl, 0.0, 1.8 ), 0.85 );',
        '  diffuseColor.a *= texelColor.a;',
        '#endif'].join('\n'));
    };
    c.customProgramCacheKey = function () { return 'detail'; };
  }
  // op: Deckkraft bei Glas (0.05–1), sonst ohne Bedeutung
  function zoneMat(m, hex, f, flat, op) {
    var k = 'z:' + f + ':' + m.uuid + ':' + hex + (flat ? ':flat' : '') + (f === 'glass' ? ':' + (op != null ? op : '') : '');
    if (!PAINTS[k]) {
      var c = PAINTS[k] = m.clone(), F = FINISH[f] || FINISH.satin;
      c.color.setHex(hex);
      // Metall zeigt nur die gespiegelte Umgebung, eingefärbt mit seiner Farbe: dunkle Farbe = schwarzes Chrom.
      // Darum Helligkeit anheben, Farbton behalten (Gold-Chrom geht weiter)
      if (f === 'chrome') { var hsl = {}; c.color.getHSL(hsl); c.color.setHSL(hsl.h, hsl.s * 0.6, Math.max(hsl.l, 0.8)); c.envMapIntensity = 1.4; }
      c.color.convertSRGBToLinear();
      if (flat || !c.map) { c.map = null; if (c.aoMap) c.aoMapIntensity = 0.35; } else detailMap(c);
      c.metalnessMap = null; c.roughnessMap = null;
      c.metalness = F[0]; c.roughness = F[1];
      // Glas: bleibt durchsichtig, die Farbe tönt nur (getönte Scheiben, farbige Lampengläser)
      if (f === 'glass') { c.transparent = true; c.opacity = op != null ? Math.max(0.05, Math.min(1, op)) : Math.min(m.transparent ? m.opacity : 1, 0.55); c.depthWrite = false; c.alphaTest = 0; }
      if ('clearcoat' in c) { c.clearcoat = F[2]; c.clearcoatRoughness = 0.08; }
    }
    return PAINTS[k];
  }
  // Farbe eines Bereichs: Set-Farbe, sonst Grundfarbe; null = Original lassen
  function zoneColour(z, over) { return over && over[z.id] != null ? over[z.id] : (z.c == null ? null : z.c); }
  function colourMat(m, hex, tag, texOff) {
    var k = tag + ':' + m.uuid + ':' + hex + (texOff ? ':t' : '');
    if (!PAINTS[k]) {
      // Farbwähler liefert sRGB, three.js rechnet linear: umrechnen, sonst wirkt die Farbe blass und überbelichtet
      var c = PAINTS[k] = m.clone(); c.color.setHex(hex).convertSRGBToLinear();
      // Textur ersetzen: reine Lackfarbe; eingebackene Schattierung (AO) nur noch schwach
      if (texOff) { c.map = null; if (c.aoMap) c.aoMapIntensity = 0.35; }
      // Lack wie echter Autolack: wenig Metall (Metallwert 1 spiegelt nur die Umgebung und wirkt dunkel), Klarlack
      if (tag === 'p') {
        c.metalness = Math.min(c.metalness != null ? c.metalness : 0, 0.35); c.metalnessMap = null;
        c.roughness = Math.min(Math.max(c.roughness != null ? c.roughness : 0.4, 0.25), 0.45);
        if ('clearcoat' in c) { c.clearcoat = 1; c.clearcoatRoughness = 0.06; }
      }
    }
    return PAINTS[k];
  }
  // Kopie einer Vorlage mit Lack-/Felgenfarbe (rim: Zahl = Farbe, null = Original, undefined = aus dem Editor);
  // o = { paint: [Schlüssel], rims: [Schlüssel], texOff } überschreibt die Einstellungen (Vorschau im Editor)
  // o.paintParts / o.rimParts / o.zoneList: Teile-Schlüssel (Editor-Vorschau, Teile nicht zusammengefasst)
  // o.zones: Bereichsfarben des Sets {Bereich: Farbe}
  function paintTemplate(t, color, rim, o) {
    o = o || {};
    var key = t.userData.key, v = vehicle(key), meta = META[key] || { all: [], paint: [], rim: [], zones: {} };
    var texOff = o.texOff != null ? o.texOff : !!v.texOff;
    // Felgenfarbe ersetzt die Felgen-Textur (sonst Farbe × z. B. braune Chrom-Textur); Standard: an bei selbst gewählten Felgen
    var rimTex = o.rimTexOff != null ? o.rimTexOff : v.rimTexOff != null ? !!v.rimTexOff : Array.isArray(v.rimParts) && v.rimParts.length > 0;
    var car = t.clone(true), swap = {};
    if (rim === undefined) rim = v.rim;
    if (o.paintParts || o.rimParts || o.zoneList) {
      // je Teil umfärben (Material-Kopien je Original-Material und Farbe); Bereiche zuerst
      var zl = o.zoneList || [];
      car.traverse(function (x) {
        if (!x.isMesh || Array.isArray(x.material)) return;
        var k = x.userData.pkey;
        for (var i = 0; i < zl.length; i++) {
          if ((zl[i].parts || []).indexOf(k) < 0) continue;
          var zc = zoneColour(zl[i], o.zones);
          if (zc != null) x.material = zoneMat(x.material, zc, zl[i].f, zl[i].flat, zl[i].o);
          return;
        }
        if (rim != null && o.rimParts && o.rimParts.indexOf(k) >= 0) x.material = colourMat(x.material, rim, 'r', rimTex);
        else if (color != null && o.paintParts && o.paintParts.indexOf(k) >= 0) x.material = colourMat(x.material, color, 'p', texOff);
      });
      return car;
    }
    if (color != null) meta.paint.forEach(function (m) { swap[m.uuid] = colourMat(m, color, 'p', texOff); });
    if (rim != null) meta.rim.forEach(function (m) { swap[m.uuid] = colourMat(m, rim, 'r', rimTex); });
    (Array.isArray(v.zones) ? v.zones : []).forEach(function (z) {
      var zc = zoneColour(z, o.zones);
      if (zc != null) ((meta.zones || {})[z.id] || []).forEach(function (m) { swap[m.uuid] = zoneMat(m, zc, z.f, z.flat, z.o); });
    });
    if (Object.keys(swap).length) car.traverse(function (x) {
      if (!x.isMesh) return;
      if (Array.isArray(x.material)) x.material = x.material.map(function (m) { return swap[m.uuid] || m; });
      else if (swap[x.material.uuid]) x.material = swap[x.material.uuid];
    });
    return car;
  }
  // set (optional): Farbset aus pickPaint – Felge und Bereichsfarben dazu
  function build(key, color, set) {
    var t = TPL[key] || TPL[MODELS[0]];
    if (!set || typeof set !== 'object') set = {};
    return t ? paintTemplate(t, color, set.r, { zones: set.z }) : new THREE.Group();
  }
  function dims(key) { var t = TPL[key] || TPL[MODELS[0]]; return t ? t.userData.dims : { L: 4.4, W: 1.8, H: 1.4, belt: 0.9 }; }
  function random() { var m = MODELS[Math.floor(Math.random() * MODELS.length)], p = pickPaint(m); return { model: m, color: p.c }; }

  root.ToyCars = {
    ready: ready, build: build, dims: dims, pickPaint: pickPaint, paintAt: paintAt, random: random, applyCustom: applyCustom, prepare: prepare,
    meta: function (k) { return META[k]; }, editMode: function (on) { EDIT = !!on; },
    forget: function (k) { delete TPL[k]; delete loading[k]; var i = MODELS.indexOf(k); if (i >= 0) MODELS.splice(i, 1); },
    paintTemplate: paintTemplate, has: function (k) { return !!BYKEY[k] || !!TPL[k]; }, catalog: function () { return CATALOG; },
    loadCatalog: loadCatalog, loadModel: loadModel, vehicle: vehicle, MODELS: MODELS, UNIT: UNIT, base: function () { return BASE; }
  };
})(typeof window !== 'undefined' ? window : this);
