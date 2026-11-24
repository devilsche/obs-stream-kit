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

  // Automatische Räder: Stücke, die ganz in einem Radzylinder liegen, aber nicht am Rad hängen, nachträglich
  // anhängen. Grund: ein Netz für beide Reifen einer Achse (M5 E28, Golf R32, A45, G63 …) hat seine Mitte in der
  // Wagenmitte und wurde von GlbFix nicht zugeordnet; nach dem Zerlegen in Stücke liegt jedes Stück in einem Rad.
  // Erst nach dem Vergeben der Teile-Schlüssel (Schlüssel bleiben gleich). Bremssättel/Bremsen bleiben stehen.
  function adoptWheelPieces(scene) {
    var ws = scene.userData.wheels || []; if (ws.length < 2) return 0;
    scene.updateMatrixWorld(true);
    // Prüfung in der Lage wie modelliert (vor dem Geradestellen): GlbFix hängt Teile so an „inner“, dass deren Lage
    // relativ zum Drehpunkt erhalten bleibt; inner dreht um fix → modellierte Achse = Querachse um −fix gedreht
    var W = ws.map(function (w) {
      var sp = w.pivot.getObjectByName('Spin'), c = new THREE.Vector3(); w.pivot.getWorldPosition(c);
      if (!sp) return null;
      var inner = sp.children[0] || sp, lat = new THREE.Vector3(sp.userData.ax === 'z' ? 0 : 1, 0, sp.userData.ax === 'z' ? 1 : 0);
      var ax = lat.applyAxisAngle(new THREE.Vector3(0, 1, 0), -inner.rotation.y).transformDirection(w.pivot.matrixWorld);
      var s = new THREE.Vector3(); w.pivot.getWorldScale(s);
      return { c: c, ax: ax, R: w.radius * s.x, H: Math.max((w.half || 0) * 1.6, w.radius * 0.5) * s.x, inner: inner, pivot: w.pivot };
    }).filter(Boolean);
    // nur plausible Räder (Unterkante nahe der tiefsten, Radius wie der Median) – Schein-Räder in der Wagenmitte
    // (LaFerrari) bekommen keine weiteren Teile
    var rs = W.map(function (w) { return w.R; }).sort(function (a, b) { return a - b; }), med = rs[Math.floor(rs.length / 2)];
    var lowB = Math.min.apply(null, W.map(function (w) { return w.c.y - w.R; }));
    W = W.filter(function (w) { return w.R > med * 0.6 && w.R < med * 1.6 && w.c.y - w.R - lowB < med * 0.25; });
    if (!W.length) return 0;
    function inWheel(o) { for (var p = o; p && p !== scene; p = p.parent) if (/^Wheel /.test(p.name || '')) return true; return false; }
    var todo = [], v = new THREE.Vector3(), d = new THREE.Vector3();
    scene.traverse(function (o) {
      if (!o.isMesh || inWheel(o) || !o.geometry.attributes.position) return;
      // Bremse, Fahrwerk, Karosserie, Auspuff, Lampen bleiben stehen (liegen oft auch im Radbereich)
      if (/cal+ip|brake|bremse|sattel|chassis|body|engine|exhaust|light|lamp|shaft|arm\b|lowerarm|upperarm|axle|susp|shock|spring|strut|knuckle|hub(?!cap)|fender|arch|mud|frame|bumper|skirt|tie_?rod|link|lowr|sway|control|wishbone|damper|brace/i.test([].concat(o.material).map(function (m) { return (m && m.name) || ''; }).join(' ') + ' ' + (o.name || ''))) return;
      var p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 400)), cnt = W.map(function () { return 0; }), n = 0;
      for (var i = 0; i < p.count; i += step) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); n++;
        for (var j = 0; j < W.length; j++) {
          d.copy(v).sub(W[j].c); var al = d.dot(W[j].ax), rad = d.addScaledVector(W[j].ax, -al).length();
          if (rad <= W[j].R * 1.12 && Math.abs(al) <= W[j].H) { cnt[j]++; break; }
        }
      }
      var best = cnt.indexOf(Math.max.apply(null, cnt));
      if (n && cnt[best] >= n * 0.9) {
        // ohne Rad-Namen nur Stücke mittig auf der Achse (Reifen, Scheibe, Felge) – außermittige namenlose Stücke
        // sind meist Bremssättel, die sonst mitdrehen würden (M3 E92)
        var named = /tire|tyre|reifen|rubber|rim|felge|wheel|whl|spoke|hubcap|alloy|nut|bolt|screw|lug/i.test([].concat(o.material).map(function (m) { return (m && m.name) || ''; }).join(' ') + ' ' + (o.name || ''));
        if (!named) {
          var b0 = new THREE.Box3(); for (i = 0; i < p.count; i += step) b0.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
          d.copy(b0.getCenter(new THREE.Vector3())).sub(W[best].c); var a1 = d.dot(W[best].ax);
          if (d.addScaledVector(W[best].ax, -a1).length() > W[best].R * 0.2) return;
        }
        todo.push([o, W[best]]); return;
      }
      // Reifen ohne Namen (G63, 918: Material „Scene_-_Root“), größer als der erkannte Radius (der kam von der
      // Felge): rund (in der Radebene gleich hoch wie breit), mittig auf der Achse, nicht viel größer als die Felge
      var bb = new THREE.Box3(); for (i = 0; i < p.count; i += step) bb.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
      var cc = bb.getCenter(new THREE.Vector3());
      for (var q = 0; q < W.length; q++) {
        var w = W[q]; d.copy(cc).sub(w.c); var a0 = d.dot(w.ax);
        if (d.addScaledVector(w.ax, -a0).length() > w.R * 0.25 || Math.abs(a0) > w.H * 1.5) continue;
        var up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3().crossVectors(w.ax, up).normalize();
        var eu = [Infinity, -Infinity], es = [Infinity, -Infinity], ea = [Infinity, -Infinity], rmax = 0;
        for (i = 0; i < p.count; i += step) {
          v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).sub(w.c);
          var pu = v.dot(up), ps = v.dot(side), pa = v.dot(w.ax);
          eu = [Math.min(eu[0], pu), Math.max(eu[1], pu)]; es = [Math.min(es[0], ps), Math.max(es[1], ps)]; ea = [Math.min(ea[0], pa), Math.max(ea[1], pa)];
          rmax = Math.max(rmax, Math.sqrt(pu * pu + ps * ps));
        }
        var hu = eu[1] - eu[0], hs = es[1] - es[0];
        if (rmax <= w.R * 1.8 && hu > w.R * 1.6 && Math.abs(hu - hs) < hu * 0.12 && ea[1] - ea[0] < hu * 0.6) {
          // Reifenmitte (in der Radebene) als neue Drehmitte merken, sonst eiert das Rad um die Felgen-Schätzung
          var mid = new THREE.Vector3(); mid.addScaledVector(up, (eu[0] + eu[1]) / 2).addScaledVector(side, (es[0] + es[1]) / 2);
          if (!w.ring || hu > w.ring.size) w.ring = { off: mid, size: hu };
          todo.push([o, w]); return;
        }
      }
    });
    todo.forEach(function (t) {
      // Lage relativ zum (ungedrehten) Drehpunkt übernehmen – wie GlbFix es mit den übrigen Radteilen macht
      var o = t[0], M = new THREE.Matrix4().copy(t[1].pivot.matrixWorld).invert().multiply(o.matrixWorld);
      t[1].inner.add(o); M.decompose(o.position, o.quaternion, o.scale); o.userData.wheelPart = true;
    });
    // Reifen mit Namen, deren Mitte neben dem Drehpunkt liegt (Mittelwert der Reifenpunkte statt Mitte; Shelby GT500:
    // Rad eierte 3,5 cm): Reifenmitte in der Radebene messen
    W.forEach(function (w) {
      if (w.ring) return;
      var up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3().crossVectors(w.ax, up).normalize(), eu = [Infinity, -Infinity], es = [Infinity, -Infinity], n = 0;
      w.inner.updateMatrixWorld(true);
      // erst die benannten Reifen; heißen sie nicht so (Porsche RAUH: alles „material_34“, Rad eierte 1,5–3 cm), alle
      // Radteile – der Reifen ist ohnehin der äußerste Ring, die Ausdehnung in der Radebene gibt seine Mitte
      [true, false].some(function (named) {
        w.inner.traverse(function (o) {
          if (!o.isMesh || (named && !/tire|tyre|reifen/i.test(((o.material && o.material.name) || '') + ' ' + (o.name || '')))) return;
          var p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 3000));
          for (var i = 0; i < p.count; i += step) {
            v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).sub(w.c); var pu = v.dot(up), ps = v.dot(side); n++;
            eu = [Math.min(eu[0], pu), Math.max(eu[1], pu)]; es = [Math.min(es[0], ps), Math.max(es[1], ps)];
          }
        });
        return n > 20;
      });
      var hu = eu[1] - eu[0], hs = es[1] - es[0];
      // nur wenn der Reifen rund und etwa so groß wie das Rad ist (keine halben Reifen o. Ä.)
      if (n > 20 && Math.abs(hu - hs) < hu * 0.08 && hu > w.R * 1.6 && hu < w.R * 2.6)
        w.ring = { off: new THREE.Vector3().addScaledVector(up, (eu[0] + eu[1]) / 2).addScaledVector(side, (es[0] + es[1]) / 2), size: hu };
    });
    // Drehpunkt auf die Reifenmitte legen (Weltlage aller Teile bleibt): pivot um off verschieben, inner zurück
    W.forEach(function (w) {
      if (!w.ring || w.ring.off.length() < w.R * 0.02) return;
      var keep = w.inner.parent && w.inner.parent.parent, off = w.ring.off.clone();
      w.pivot.position.add(off);
      var back = off.clone().negate(); if (keep) back.applyAxisAngle(new THREE.Vector3(0, 1, 0), -keep.rotation.y);
      back.applyAxisAngle(new THREE.Vector3(0, 1, 0), -w.inner.rotation.y);
      w.inner.children.forEach(function (ch) { ch.position.add(back.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0)); });
    });
    return todo.length;
  }

  // deckungsgleiche Doppel-Teile (gleiches Material, gleiche Dreieckszahl, gleiche Lage – z. B. SF90 Spider: jede
  // Scheibe zweimal): wer eines wählt, bekommt das andere mit, sonst deckt das ungefärbte Doppel die Farbe zu
  function twins(scene) {
    scene.updateMatrixWorld(true);
    var all = new THREE.Box3().setFromObject(scene), sz = new THREE.Vector3(); all.getSize(sz);
    var q = Math.max(sz.x, sz.y, sz.z, 1e-9) * 5e-4, seen = {}, out = {}, v = new THREE.Vector3();
    scene.traverse(function (o) {
      if (!o.isMesh || Array.isArray(o.material) || !o.geometry.attributes.position) return;
      var p = o.geometry.attributes.position, b = new THREE.Box3();
      for (var i = 0; i < p.count; i++) b.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
      var k = (o.material.name || o.material.uuid) + '|' + p.count + '|' + b.min.toArray().concat(b.max.toArray()).map(function (x) { return Math.round(x / q); }).join(',');
      if (seen[k] && !out[seen[k]]) { out[seen[k]] = o.userData.pkey; out[o.userData.pkey] = seen[k]; } else if (!seen[k]) seen[k] = o.userData.pkey;
    });
    return out;
  }

  // Hüllquader aus den Eckpunkten selbst (Weltlage): Box3.setFromObject in three r128 dreht nur den Quader der
  // Geometrie mit – bei schräg liegenden Teilen (Ferrari 296 GT3, Teile-Achsen ~53° bzw. leicht gekippt) wird er
  // zu groß, das Auto schwebt dann über dem Boden und wird zu klein skaliert
  // Karosserie-Länge (x) aus den Punkten unterhalb von 55 % der Höhe; zu wenig Punkte → ganze Länge
  function bodyLength(obj, box, size) {
    var y1 = box.min.y + size.y * 0.55, lo = Infinity, hi = -Infinity, v = new THREE.Vector3(), n = 0;
    obj.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      var p = o.geometry.attributes.position, M = o.matrixWorld, step = Math.max(1, Math.floor(p.count / 60000));
      for (var i = 0; i < p.count; i += step) {
        v.fromBufferAttribute(p, i).applyMatrix4(M);
        if (v.y > y1) continue;
        if (v.x < lo) lo = v.x; if (v.x > hi) hi = v.x; n++;
      }
    });
    var L = hi - lo;
    return n > 50 && L > size.x * 0.6 ? L : size.x;
  }
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
      var b = new THREE.Box3().setFromObject(o), c = new THREE.Vector3(); b.getCenter(c);
      // versehentlich gewählte Karosserieteile (größer als knapp die halbe Wagenlänge) nicht ans Rad hängen –
      // sie würden mitlenken/mitrollen und die ganze Front „ins Rad ziehen“
      var bs = new THREE.Vector3(); b.getSize(bs);
      if (Math.max(bs.x, bs.y, bs.z) > len * 0.45) { if (root.console) console.warn('ToyCars: wheel part ignored (too big): ' + o.userData.pkey); return; }
      parts.push({ o: o, c: c, b: b, roll: roll, steer: steer });
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
    // Gruppen, die kein Rad sind (versehentlich gewähltes Einzelteil neben dem Rad, z. B. Schmutzfänger beim
    // BMW 2002 turbo): nicht rund oder viel kleiner als die Räder – sie drehten sich als eigenes „Rad“ um ihre
    // eigene Mitte. Ihre Teile kommen zum Rad, in dessen Bereich sie liegen, sonst bleiben sie am Auto.
    function gbox(g) { var b = new THREE.Box3(); g.list.forEach(function (p) { b.union(p.b); }); return b; }
    var maxH = 0;
    groups.forEach(function (g) {
      var s = gbox(g).getSize(new THREE.Vector3()), dl = lx ? s.x : s.z;
      g.round = Math.min(dl, s.y) >= Math.max(dl, s.y) * 0.7; g.h = s.y;
      if (g.round) maxH = Math.max(maxH, s.y);
    });
    var real = groups.filter(function (g) { return g.round && g.h >= maxH * 0.5; });
    if (real.length) groups = groups.filter(function (g) {
      if (real.indexOf(g) >= 0) return true;
      g.list.forEach(function (p) {
        var best = null, bd = Infinity;
        real.forEach(function (w) { var d = gbox(w).getCenter(new THREE.Vector3()).distanceTo(p.c); if (d < bd) { bd = d; best = w; } });
        if (best && bd < best.h * 0.6) best.list.push(p);
        else if (root.console) console.warn('ToyCars: wheel part ignored (not at a wheel): ' + p.o.userData.pkey);
      });
      return false;
    });
    groups.forEach(function (g, i) {
      // Drehpunkt = Mitte der rollenden Teile (Bremssattel sitzt außermittig), sonst aller Teile; die genaue
      // Achse (Mitte und Richtung) setzt danach trueAxles()
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

  // Echte Radachse je Rad: Spin dreht um seine lokale x- bzw. z-Achse durch den Drehpunkt. Liegt der Drehpunkt
  // neben der Radmitte oder steht das Rad im Modell schräg (Sturz: E30 M3/M2 1–1,5°, Knoten „3DWheel Front L“ mit
  // gekippter Matrix), eiert es beim Drehen. Mitte und Richtung kommen deshalb aus dem Reifen selbst: äußerer Ring
  // aller Teile des Rads (Reifen; Sattel und Bremse liegen weiter innen). Achse = Richtung, in der der Ring am
  // schmalsten ist (Lauffläche: Breite·cos + Durchmesser·sin der Schräglage – unabhängig davon, wie dicht der Reifen
  // vernetzt ist, anders als Mittelwert/Streuung), Mitte = Mitte der Ausdehnung. Zwischen Spin und seine Eltern
  // kommt eine Gruppe „Axle“ (Lage = echte Achse); Spin und alle Verbraucher (rotation[ax]) bleiben unverändert.
  function trueAxles(scene) {
    scene.updateMatrixWorld(true);
    var v = new THREE.Vector3(), list = []; scene.traverse(function (o) { if (/^Wheel /.test(o.name || '')) list.push(o); });
    function frame(a) {   // zwei Richtungen in der Radebene
      var u = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      u.addScaledVector(a, -u.dot(a)).normalize();
      return [u, new THREE.Vector3().crossVectors(a, u)];
    }
    function ext(P, d) { var lo = Infinity, hi = -Infinity; for (var i = 0; i < P.length; i++) { var x = P[i].dot(d); if (x < lo) lo = x; if (x > hi) hi = x; } return [lo, hi]; }
    // Achse und Mitte aus Punkten (P-Koordinaten); null, wenn der äußere Ring kein Rad ist
    function fitAxle(pts, e0) {
      if (pts.length < 30) return null;
      var a = e0.clone(), c = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3()), ring = null, R = 0, D = Math.PI / 180;
      for (var it = 0; it < 2; it++) {
        var rs = pts.map(function (q) { var d = q.clone().sub(c); return d.addScaledVector(a, -d.dot(a)).length(); });
        R = Math.max.apply(null, rs);
        ring = pts.filter(function (q, i) { return rs[i] >= R * 0.85; });
        if (ring.length < 20) return null;
        // schmalste Richtung: ±6° in 1°, ±1° in 0,2°, ±0,2° in 0,04° (Suche auf höchstens 1500 Ringpunkten,
        // Mitte und Prüfung auf allen – sonst fehlen die äußersten Punkte)
        var sub = ring, st2 = Math.ceil(ring.length / 1500); if (st2 > 1) sub = ring.filter(function (q, i) { return i % st2 === 0; });
        var F = frame(e0), best = a.clone(), bw = ext(sub, a), bW = bw[1] - bw[0];
        [[6, 1], [1, 0.2], [0.2, 0.04]].forEach(function (g) {
          var b0 = best.clone();
          for (var x = -g[0]; x <= g[0] + 1e-9; x += g[1]) for (var y = -g[0]; y <= g[0] + 1e-9; y += g[1]) {
            var d = b0.clone().addScaledVector(F[0], Math.tan(x * D)).addScaledVector(F[1], Math.tan(y * D)).normalize();
            var r = ext(sub, d); if (r[1] - r[0] < bW) { bW = r[1] - r[0]; best = d; }
          }
        });
        a.copy(best);
        var Fa = frame(a), eu = ext(ring, Fa[0]), ew = ext(ring, Fa[1]), ea = ext(ring, a); bW = ea[1] - ea[0];
        // nur echte Räder: rund (in der Ebene gleich weit) und quer schmaler als hoch, nahe der bisherigen Achse
        if (Math.abs((eu[1] - eu[0]) - (ew[1] - ew[0])) > 0.12 * Math.max(eu[1] - eu[0], ew[1] - ew[0]) || bW > 0.9 * (eu[1] - eu[0]) || a.dot(e0) < Math.cos(10 * D)) return null;
        c.copy(Fa[0]).multiplyScalar((eu[0] + eu[1]) / 2).addScaledVector(Fa[1], (ew[0] + ew[1]) / 2).addScaledVector(a, (ea[0] + ea[1]) / 2);
      }
      return { a: a, c: c, R: R };
    }
    list.forEach(function (w) {
      var sp = w.getObjectByName('Spin'); if (!sp || !sp.parent || sp.parent.name === 'Axle') return;
      var P = sp.parent, inv = new THREE.Matrix4().copy(P.matrixWorld).invert();
      function points(o) {
        var pts = [];
        o.traverse(function (m) {
          if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
          var M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), p = m.geometry.attributes.position;
          for (var i = 0; i < p.count; i++) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(M).clone());
        });
        return pts;
      }
      // Spin-Achse in P-Koordinaten (Spin selbst ist ungedreht)
      var e0 = new THREE.Vector3(sp.userData.ax === 'z' ? 0 : 1, 0, sp.userData.ax === 'z' ? 1 : 0).applyQuaternion(sp.quaternion);
      // erst nur die rollenden Teile (Reifen dabei), sonst das ganze Rad (z. B. nur Felgenstücke rollen, Reifen lenkt nur)
      var spPts = points(sp), fit = fitAxle(spPts, e0) || fitAxle(points(w), e0);
      if (!fit) return;
      var a = fit.a, c = fit.c, R = fit.R;
      // nur übernehmen, wenn der Reifen um die neue Achse wirklich runder läuft als um die alte (Porsche RAUH: die
      // schmalste Richtung durch das tiefe Felgenprofil kippte die Achse, drei Räder eierten 1,5–3 cm, das vierte ohne
      // Anpassung lief rund): Schwankung des Außenradius (äußerste 15 % der Punkte) vorher/nachher vergleichen
      function wob(pts, ax, cc) {
        var rs = pts.map(function (q) { var d = q.clone().sub(cc); return d.addScaledVector(ax, -d.dot(ax)).length(); });
        var mx = Math.max.apply(null, rs), lo = Infinity;
        rs.forEach(function (r) { if (r >= mx * 0.85 && r < lo) lo = r; });
        // Ringpunkte je Winkel: größter Radius in 24 Sektoren, Spanne darüber
        var F = frame(ax), sec = [];
        pts.forEach(function (q, i) {
          if (rs[i] < mx * 0.85) return;
          var d = q.clone().sub(cc), k = Math.floor((Math.atan2(d.dot(F[1]), d.dot(F[0])) + Math.PI) / (2 * Math.PI) * 24) % 24;
          sec[k] = Math.max(sec[k] || 0, rs[i]);
        });
        var vals = sec.filter(function (x) { return x > 0; });
        return vals.length < 12 ? Infinity : Math.max.apply(null, vals) - Math.min.apply(null, vals);
      }
      if (spPts.length >= 30 && wob(spPts, a, c) >= wob(spPts, e0, sp.position) * 0.9) return;
      // kaum Abweichung (unter 0,1° und 0,2 % des Radius): Aufbau lassen, wie er ist
      var off = c.clone().sub(sp.position), offR = off.addScaledVector(a, -off.dot(a)).length() / Math.max(1e-9, R);
      if (a.dot(e0) > Math.cos(0.1 * Math.PI / 180) && offR < 0.002) return;
      var ax = new THREE.Group(); ax.name = 'Axle';
      ax.position.copy(c); ax.quaternion.setFromUnitVectors(e0, a).multiply(sp.quaternion);
      var kids = sp.children.slice();
      kids.forEach(function (k) { P.attach(k); });   // Weltlage bleibt
      P.remove(sp); P.add(ax); sp.position.set(0, 0, 0); sp.quaternion.identity(); sp.scale.set(1, 1, 1); ax.add(sp);
      scene.updateMatrixWorld(true);
      kids.forEach(function (k) { sp.attach(k); });
    });
    scene.updateMatrixWorld(true);
    return list.length;
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
    if (!own) adoptWheelPieces(scene);
    // „Split a part“ im Car editor: einzelne Teile fein zerlegen (an harten Kanten/UV-Nähten, ohne Verschweißen);
    // Stücke heißen <Teil>.<n>; Auswahlen auf das ganze Teil gelten für alle Stücke, Stücke ohne Zerlegung fürs ganze Teil
    var kids = {}, exists = {}, splitFail = {}, cutKids = {};
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
        if (isl.length < 2 || isl.length > 400) {
          // nur wenn alles andere scheitert (z. B. Caterpillar-Rahmen: 2260 Flächen, ein Klumpen nach Berührung):
          // in zusammenhängende Stücke (verschweißt) zerlegen, bis 1000 Stücke – bisher gelungene Zerlegungen bleiben gleich
          var welded = islandsOf(o.geometry);
          if (welded.length >= 2 && welded.length <= 1000) isl = welded;
          else {
            // letzte, feinere Stufe (erst wenn alles davor scheitert, alte Zerlegungen bleiben gleich):
            // schon ab 15° Knick trennen, sonst Textur-Inseln bis 1000 Stücke
            var fine = facesOf(o.geometry, 15), uvi = islandsOf(o.geometry, true);
            if (fine.length >= 2 && fine.length <= 1000) isl = fine;
            else if (uvi.length >= 2 && uvi.length <= 1000) isl = uvi;
            else { splitFail[o.userData.pkey] = welded.length < 2 && fine.length < 2 ? 'smooth' : 'many'; return; }
          }
        }
        kids[o.userData.pkey] = [];
        // fast alles in einem Stück (z. B. Monza-Motorraum: 32 724 von 32 730 Dreiecken): Zerlegung bleibt (Schlüssel
        // stabil), der Editor rät aber zu „Cut a part“
        var big = 0; isl.forEach(function (tris) { big = Math.max(big, tris.length); });
        if (big > ntri * 0.9) splitFail[o.userData.pkey] = 'dominant';
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
    // „Cut a part“ im Car editor: Teil an einer Ebene zerschneiden (cutParts: [{key, p: [nx, ny, nz, d]}], Ebene in
    // Modell-Koordinaten = Lage im geladenen glTF-Szenenknoten, unabhängig von Kamera und Skalierung). Dreiecke nach
    // der Seite ihres Mittelpunkts; Stücke heißen <Teil>|a (n·x + d ≥ 0) und <Teil>|b, wieder schneidbar (<Teil>|a|b …)
    (Array.isArray(v.cutParts) ? v.cutParts : []).forEach(function (c) {
      if (!c || typeof c.key !== 'string' || !Array.isArray(c.p) || c.p.length !== 4) return;
      var o = null; scene.traverse(function (x) { if (!o && x.isMesh && !Array.isArray(x.material) && x.userData.pkey === c.key) o = x; });
      if (!o) return;
      scene.updateMatrixWorld(true);
      var M = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(scene.matrixWorld).invert(), o.matrixWorld);
      var g = o.geometry, pos = g.attributes.position, idx = g.index ? g.index.array : null, nt = (idx ? idx.length : pos.count) / 3;
      var A = [], B = [], P = new THREE.Vector3(), Q = new THREE.Vector3(), R = new THREE.Vector3();
      for (var t = 0; t < nt; t++) {
        P.fromBufferAttribute(pos, idx ? idx[t * 3] : t * 3).applyMatrix4(M); Q.fromBufferAttribute(pos, idx ? idx[t * 3 + 1] : t * 3 + 1).applyMatrix4(M);
        R.fromBufferAttribute(pos, idx ? idx[t * 3 + 2] : t * 3 + 2).applyMatrix4(M); P.add(Q).add(R).multiplyScalar(1 / 3);
        (c.p[0] * P.x + c.p[1] * P.y + c.p[2] * P.z + c.p[3] >= 0 ? A : B).push(t);
      }
      if (!A.length || !B.length) return;
      cutKids[c.key] = [];
      [['a', A], ['b', B]].forEach(function (side) {
        var m = new THREE.Mesh(subGeo(g, side[1]), o.material);
        m.name = o.name + '|' + side[0]; m.renderOrder = o.renderOrder;
        m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
        m.userData = Object.assign({}, o.userData, { pkey: c.key + '|' + side[0] });
        cutKids[c.key].push(m.userData.pkey); o.parent.add(m);
      });
      o.parent.remove(o);
    });
    var byBase = {};
    scene.traverse(function (o) {
      if (!o.isMesh) return; exists[o.userData.pkey] = 1;
      var m = /^(.*)\/\d+$/.exec(o.userData.pkey || ''); if (m) (byBase[m[1]] || (byBase[m[1]] = [])).push(o.userData.pkey);
    });
    var twin = twins(scene);
    function norm(list) {
      if (!Array.isArray(list)) return list;
      var out = [];
      list.forEach(function (k) {
        var add = kids[k] || (!exists[k] && byBase[k]) || (!exists[k] && /\.\d+$/.test(k) && exists[k.replace(/\.\d+$/, '')] ? [k.replace(/\.\d+$/, '')] : [k]);
        // zerschnittene Teile: Auswahl auf dem ganzen Teil gilt für alle Stücke (auch mehrfach geschnitten)
        var cut = []; (function exp(list) { list.forEach(function (x) { if (cutKids[x]) exp(cutKids[x]); else cut.push(x); }); })(add);
        cut.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); if (twin[x] && out.indexOf(twin[x]) < 0) out.push(twin[x]); });
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
    trueAxles(scene);   // eigene und automatische Räder: Drehachse = echte Radachse (kein Eiern)
    var ud = scene.userData;
    ud.modelRoot = true;   // Car editor „Cut a part“: Schnittebene in den Koordinaten dieses Knotens
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
    META[e.key] = { all: all, paint: paint, rim: rim, zones: zones, norm: norm, kids: kids, twin: twin, splitFail: splitFail, cutKids: cutKids, autoPaintParts: autoPaintParts, autoRimParts: autoRimParts, wheels: ownWheels || (ud.wheels || []).length };
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
    // Länge der Karosserie (Stoßstangen, Seiten) statt des ganzen Kastens: nur Punkte in der unteren Hälfte der Höhe –
    // ein überstehender Heckflügel oder Spiegel macht das Auto sonst kürzer, als es ist
    var bodyL = bodyLength(rot, box, size), k = (e.len || 4.5) * UNIT / Math.max(1e-6, bodyL);
    var wrap = new THREE.Group(); wrap.add(rot); wrap.scale.setScalar(k);
    var c = new THREE.Vector3(); box.getCenter(c); size.multiplyScalar(k);
    rot.position.sub(c);
    // Karosserie in eigener Ebene „Body“: Fahrhöhe (Car editor „Ride height“) hebt/neigt nur sie, die Räder bleiben
    var body = new THREE.Group(); body.name = 'Body'; body.add(wrap);
    var car = new THREE.Group(); car.add(body); car.name = e.key; car.updateMatrixWorld(true);
    car.userData.dims = { L: size.x, B: bodyL * k, W: size.z, H: size.y, belt: size.y * 0.62 };
    car.userData.key = e.key;
    delete ud.wheels; delete ud.paintMats; delete ud.rimMats; delete ud.rimFromPaint;
    var rd = rideOf(e.key); applyRide(car, rd.f, rd.r);
    return car;
  }
  // ── Fahrhöhe je Achse (Car editor „Ride height“): vehicle.ride = {f, r} in cm, + = höher. Hebt die Karosserie-Ebene
  // („Body“) an der Vorder-/Hinterachse an (Neigung dazwischen) und setzt die Radgruppen zurück an ihren Platz –
  // die Räder bleiben auf dem Boden. Wiederholbar (Ausgangslage der Räder in userData.p0/q0, auch in Kopien).
  var RIDE_MIN = -20, RIDE_MAX = 30;
  function bodyOf(car) {
    if (!car) return car;
    for (var i = 0; i < car.children.length; i++) if (car.children[i].name === 'Body') return car.children[i];
    return car;
  }
  function rideOf(key) {
    var r = vehicle(key).ride || {};
    function c(x) { x = +x || 0; return Math.max(RIDE_MIN, Math.min(RIDE_MAX, x)); }
    return { f: c(r.f), r: c(r.r) };
  }
  function applyRide(car, f, r) {
    var body = bodyOf(car); if (!body || body === car) return;
    var wheels = []; car.traverse(function (o) { if (/^Wheel /.test(o.name || '')) wheels.push(o); });
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0);
    wheels.forEach(function (w) {
      if (w.userData.p0) { w.position.fromArray(w.userData.p0); w.quaternion.fromArray(w.userData.q0); }
      else { w.userData.p0 = w.position.toArray(); w.userData.q0 = w.quaternion.toArray(); }
    });
    car.updateMatrixWorld(true);
    car.userData.ride = { f: +f || 0, r: +r || 0 };
    if (!f && !r) return;
    var inv = new THREE.Matrix4().copy(car.matrixWorld).invert(), L = (car.userData.dims || { L: 4.4 }).L;
    var keep = wheels.map(function (w) {
      var p = new THREE.Vector3(), q = new THREE.Quaternion(); w.getWorldPosition(p); w.getWorldQuaternion(q);
      return { p: p, q: q, x: p.clone().applyMatrix4(inv).x };
    });
    var xs = keep.map(function (k) { return k.x; }), xF = Math.max.apply(null, xs.concat([-1e9])), xR = Math.min.apply(null, xs.concat([1e9]));
    if (wheels.length < 2 || xF - xR < L * 0.2) { xF = L * 0.3; xR = -L * 0.3; }
    var yF = f / 100 * UNIT, yR = r / 100 * UNIT, sl = (yF - yR) / (xF - xR);
    body.position.y = yR - xR * sl; body.rotation.z = Math.atan(sl);
    car.updateMatrixWorld(true);
    wheels.forEach(function (w, i) {
      var par = w.parent, pq = new THREE.Quaternion();
      w.position.copy(par.worldToLocal(keep[i].p.clone()));
      par.getWorldQuaternion(pq); w.quaternion.copy(pq.invert().multiply(keep[i].q));
      w.updateMatrixWorld(true);
    });
  }
  // Sitz-/Wand-Schätzung in Karosserie-Koordinaten: kurz ohne Fahrhöhe rechnen
  function noRide(t, fn) {
    var b = bodyOf(t), rd = t && t.userData.ride;
    if (!b || b === t || !rd || (!rd.f && !rd.r)) return fn();
    applyRide(t, 0, 0);
    try { return fn(); } finally { applyRide(t, rd.f, rd.r); }
  }
  // opts.race: leichte Renn-Version (<uid>.race.glb, Texturen ≤ 256 px; der Server liefert sonst das volle Modell).
  // Die Vorlage liegt unter demselben Schlüssel wie das volle Modell (build() sucht dort) – eine Seite lädt nur eine Variante.
  function loadModel(e, opts) {
    if (TPL[e.key]) return Promise.resolve(TPL[e.key]);
    if (loading[e.key]) return loading[e.key];
    return (loading[e.key] = new Promise(function (res, rej) {
      // ?v=Dateigröße: nach einem Neubau holt der Browser die neue Datei statt der 7 Tage gecachten alten
      var race = opts && opts.race, ver = (race ? e.raceBytes : e.bytes) || 0;
      new THREE.GLTFLoader().load(BASE + 'api/fx/cars/model/' + e.uid + (race ? '.race.glb' : '.glb') + (ver ? '?v=' + ver : ''), function (gl) {
        try { TPL[e.key] = prepare(gl.scene, e); res(TPL[e.key]); } catch (err) { rej(err); }
      }, null, rej);
    }));
  }
  // Für viele Autos gleichzeitig (Car Race): alle Teile je Besitzer und Material zu einem Netz zusammenfassen –
  // Besitzer = nächste bewegte Gruppe (Spin = rollt, „Wheel …“ = lenkt) oder das Auto selbst. Anders als mergeStatic
  // auch die Radteile und Netze mit unterschiedlichen Zusatz-Attributen (nur gemeinsame bleiben). Einmal je Vorlage;
  // Umfärben über build() bleibt möglich (Material-Zuordnung je Material-uuid). Rückgabe: Anzahl Netze danach.
  function mergeForRace(t) {
    var BGU = THREE.BufferGeometryUtils;
    if (!BGU || !BGU.mergeBufferGeometries || t.userData.raceMerged) return 0;
    t.updateMatrixWorld(true);
    var groups = {}, list = [];
    t.traverse(function (o) {
      if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material) || !o.geometry || !o.geometry.attributes.position) return;
      if (Object.keys(o.geometry.morphAttributes || {}).length) return;
      var owner = bodyOf(t);
      for (var p = o.parent; p && p !== t; p = p.parent) if (p.name === 'Spin' || /^Wheel /.test(p.name || '')) { owner = p; break; }
      var k = owner.uuid + '|' + o.material.uuid + '|' + o.renderOrder;
      (groups[k] || (groups[k] = { owner: owner, mat: o.material, order: o.renderOrder, list: [] })).list.push(o);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.list.length < 2) return;
      // nur Attribute, die alle Teile haben; gemischt indiziert/nicht indiziert → alle ohne Index
      var names = Object.keys(g.list[0].geometry.attributes).filter(function (a) {
        return g.list.every(function (o) { var x = o.geometry.attributes[a], y = g.list[0].geometry.attributes[a]; return x && x.itemSize === y.itemSize && !x.isInterleavedBufferAttribute; });
      });
      var mixed = g.list.some(function (o) { return !o.geometry.index; });
      var inv = new THREE.Matrix4().copy(g.owner.matrixWorld).invert();
      var geos = g.list.map(function (o) {
        var src = mixed && o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, gg = new THREE.BufferGeometry();
        names.forEach(function (a) { gg.setAttribute(a, src.attributes[a].clone()); });
        if (!mixed && src.index) gg.setIndex(src.index.clone());
        gg.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        return gg;
      });
      var merged = null;
      try { merged = BGU.mergeBufferGeometries(geos, false); } catch (err) { merged = null; }
      if (!merged) return;
      var mesh = new THREE.Mesh(merged, g.mat); mesh.renderOrder = g.order; mesh.userData.wheelPart = g.owner !== t && g.owner.name !== 'Body';
      g.owner.add(mesh);
      g.list.forEach(function (o) { if (o.parent) o.parent.remove(o); });
    });
    t.userData.raceMerged = true;
    var n = 0; t.traverse(function (o) { if (o.isMesh) n++; });
    return n;
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
  var FINISH = { matte: [0, 0.85, 0], satin: [0.1, 0.5, 0], gloss: [0.1, 0.22, 1], shiny: [0.35, 0.1, 1], chrome: [1, 0.06, 0], glass: [0, 0.04, 1],
    carbon: [0.15, 0.55, 0], carbonGloss: [0.2, 0.15, 1] };
  var CARBON_DEFAULT = 0x1a1a1a;   // Carbon ohne eigene Farbe: fast schwarz
  function isCarbon(f) { return f === 'carbon' || f === 'carbonGloss'; }
  // Kohlefaser: 2×2-Köper, einmal als Canvas erzeugt (64 px = 8×8 Bündel); hell/dunkel je Bündelrichtung, mit
  // leichtem Glanzverlauf längs der Fasern. Ohne Canvas (Node) kein Muster, nur Farbe/Oberfläche
  var CARBON_TEX;
  function carbonTex() {
    if (CARBON_TEX !== undefined) return CARBON_TEX;
    CARBON_TEX = null;
    try {
      var N = 64, cv = document.createElement('canvas'); cv.width = cv.height = N;
      var g = cv.getContext('2d'), cell = N / 8;
      for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) {
        var warp = ((x + y) >> 1) % 2 === 0;   // 2×2-Köper: Richtung wechselt alle zwei Felder, diagonal versetzt
        for (var t = 0; t < cell; t++) {
          var f = Math.sin(Math.PI * (t + 0.5) / cell), l = Math.round((warp ? 70 : 150) + 70 * f);
          g.fillStyle = 'rgb(' + l + ',' + l + ',' + l + ')';
          if (warp) g.fillRect(x * cell + t, y * cell, 1, cell); else g.fillRect(x * cell, y * cell + t, cell, 1);
        }
      }
      var tex = new THREE.CanvasTexture(cv);
      // Mipmaps (64 px, Zweierpotenz) + Anisotropie gegen Moiré aus der Entfernung
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
      CARBON_TEX = tex;
    } catch (e) { CARBON_TEX = null; }
    return CARBON_TEX;
  }
  // Carbon-Teile bekommen Kasten-UVs in Auto-Größe (eine Kachel = 2,4 cm → Bündel 3 mm wie echtes Köper-Carbon), unabhängig von den
  // Modell-UVs (Atlas-UVs ergäben riesige oder winzige Muster); Geometrie dafür einmal je Teil kopiert
  var CARBON_GEO = {}, CARBON_TILE = 0.024;   // Meter je Kachel (8 Bündel)
  function carbonUV(car) {
    var inv = null, v = new THREE.Vector3(), n = new THREE.Vector3();
    car.traverse(function (x) {
      if (!x.isMesh || Array.isArray(x.material) || !x.material.userData.carbon || x.material.alphaMap) return;   // Plaketten-Maske braucht die Modell-UVs
      if (!inv) { car.updateMatrixWorld(true); inv = new THREE.Matrix4().copy(car.matrixWorld).invert(); }
      var M = new THREE.Matrix4().multiplyMatrices(inv, x.matrixWorld), id = x.geometry.uuid + ':' + M.elements.map(function (e) { return e.toFixed(4); }).join(',');
      var g = CARBON_GEO[id];
      if (!g) {
        g = x.geometry.clone();
        var p = g.attributes.position, nr = g.attributes.normal, uv = new Float32Array(p.count * 2), NM = new THREE.Matrix3().getNormalMatrix(M);
        var s = 1 / (CARBON_TILE * UNIT);   // Teile liegen in Auto-Einheiten (UNIT je Meter)
        for (var i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(M);
          if (nr) n.fromBufferAttribute(nr, i).applyMatrix3(NM); else n.set(0, 1, 0);
          var ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
          if (ax >= ay && ax >= az) { uv[i * 2] = v.z * s; uv[i * 2 + 1] = v.y * s; }
          else if (ay >= az) { uv[i * 2] = v.x * s; uv[i * 2 + 1] = v.z * s; }
          else { uv[i * 2] = v.x * s; uv[i * 2 + 1] = v.y * s; }
        }
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        CARBON_GEO[id] = g;
      }
      x.geometry = g;
    });
  }
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
  // Textur nur noch als Schnittmaske (Alpha), Farbe kommt allein aus der Bereichsfarbe
  function cutOnly(c) {
    c.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\n  diffuseColor.a *= texture2D( map, vUv ).a;\n#endif');
    };
    c.customProgramCacheKey = function () { return 'cutonly'; };
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
      // ausgeschnittene Textur (alphaTest, Logos/Gitter): bei „Flat colour“ bleibt sie nur als Schnittmaske
      if (flat && c.map && m.alphaTest > 0 && !c.alphaMap) cutOnly(c);
      else if (flat || !c.map) { c.map = null; if (c.aoMap) c.aoMapIntensity = 0.35; } else detailMap(c);
      c.metalnessMap = null; c.roughnessMap = null;
      c.metalness = F[0]; c.roughness = F[1];
      // Glas: bleibt durchsichtig, die Farbe tönt nur (getönte Scheiben, farbige Lampengläser); mindestens 0,3 ohne Regler
      if (f === 'glass') { c.transparent = true; c.opacity = op != null ? Math.max(0.05, Math.min(1, op)) : Math.max(0.3, Math.min(m.transparent ? m.opacity : 1, 0.55)); c.depthWrite = false; c.alphaTest = 0; }
      // alle anderen Oberflächen sind deckend – auch auf Scheiben (sonst blieb z. B. „Gloss“ auf der Frontscheibe
      // bei 30 % Deckkraft und wirkte unsichtbar); ausgeschnittene Texturen (alphaTest) bleiben ausgeschnitten
      else { c.transparent = false; c.opacity = 1; c.depthWrite = true; if (!c.map && !c.alphaMap) c.alphaTest = 0; if ('transmission' in c) c.transmission = 0; }
      if (isCarbon(f) && !(m.alphaTest > 0 && m.map && !m.alphaMap)) {   // Schnitt über die Textur-Alpha: dann ohne Gewebe
        var ct = carbonTex();
        c.map = ct; c.onBeforeCompile = function () {}; c.customProgramCacheKey = function () { return 'carbon'; };
        c.normalMap = null; c.aoMap = null; c.bumpMap = ct; c.bumpScale = 0.004;
        c.envMapIntensity = f === 'carbonGloss' ? 1.6 : 0.8; c.userData.carbon = true;
      }
      if ('clearcoat' in c) { c.clearcoat = F[2]; c.clearcoatRoughness = f === 'carbonGloss' ? 0.04 : 0.08; }
    }
    return PAINTS[k];
  }
  // Farbe eines Bereichs: Set-Farbe, sonst Grundfarbe; null = Original lassen
  function zoneColour(z, over) { return over && over[z.id] != null ? over[z.id] : (z.c == null ? (isCarbon(z.f) ? CARBON_DEFAULT : null) : z.c); }
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
      var zl = o.zoneList || [], tw = meta.twin || {};
      function has(list, k) { return !!list && (list.indexOf(k) >= 0 || (tw[k] != null && list.indexOf(tw[k]) >= 0)); }
      car.traverse(function (x) {
        if (!x.isMesh || Array.isArray(x.material)) return;
        var k = x.userData.pkey;
        for (var i = 0; i < zl.length; i++) {
          if (!has(zl[i].parts || [], k)) continue;
          var zc = zoneColour(zl[i], o.zones);
          if (zc != null) x.material = zoneMat(x.material, zc, zl[i].f, zl[i].flat, zl[i].o);
          return;
        }
        if (rim != null && has(o.rimParts, k)) x.material = colourMat(x.material, rim, 'r', rimTex);
        else if (color != null && has(o.paintParts, k)) x.material = colourMat(x.material, color, 'p', texOff);
      });
      carbonUV(car);
      return car;
    }
    // o.sub = { c, f }: feste Lackierung (Car Race, Sub-Farbsets) – nur der Lack (automatischer Lack und
    // Farbbereich „Paint“) mit Farbe und Oberfläche über zoneMat; Scheiben, Reifen, übrige Bereiche bleiben
    var sp = o.sub && o.sub.c != null ? o.sub : null;
    if (sp) meta.paint.forEach(function (m) { swap[m.uuid] = zoneMat(m, sp.c, sp.f || 'gloss', false); });
    else if (color != null) meta.paint.forEach(function (m) { swap[m.uuid] = colourMat(m, color, 'p', texOff); });
    if (rim != null) meta.rim.forEach(function (m) { swap[m.uuid] = colourMat(m, rim, 'r', rimTex); });
    (Array.isArray(v.zones) ? v.zones : []).forEach(function (z) {
      if (sp && z.id === 'paint') { ((meta.zones || {})[z.id] || []).forEach(function (m) { swap[m.uuid] = zoneMat(m, sp.c, sp.f || 'gloss', false); }); return; }
      var zc = zoneColour(z, o.zones);
      if (zc != null) ((meta.zones || {})[z.id] || []).forEach(function (m) { swap[m.uuid] = zoneMat(m, zc, z.f, z.flat, z.o); });
    });
    if (Object.keys(swap).length) car.traverse(function (x) {
      if (!x.isMesh) return;
      if (Array.isArray(x.material)) x.material = x.material.map(function (m) { return swap[m.uuid] || m; });
      else if (swap[x.material.uuid]) x.material = swap[x.material.uuid];
    });
    carbonUV(car);
    return car;
  }
  // set (optional): Farbset aus pickPaint – Felge und Bereichsfarben dazu; set.sub = { c, f } feste Lackierung
  function build(key, color, set) {
    var t = TPL[key] || TPL[MODELS[0]];
    if (!set || typeof set !== 'object') set = {};
    return t ? paintTemplate(t, color, set.r, { zones: set.z, sub: set.sub }) : new THREE.Group();
  }
  // ── Fahrer (Gummiente im Auto) ──
  // Sitz je Fahrzeug: seat = {x, y, z, s, r, p, l} in den Koordinaten der fertigen Vorlage (Mitte im Auto, Front +x,
  // links = −z, Boden −H/2); s = Höhe der Ente in Auto-Einheiten, r = Drehung um y, p = Neigung (Schnabel hoch,
  // um z), l = seitlich (um x); ältere Sitze ohne p/l bleiben gültig. Gespeichert im Car editor,
  // sonst geschätzt: Fahrerplatz links (Linkslenker) vorn im Innenraum, Größe so, dass die Ente mit Abstand
  // unter Dach, zwischen Tür und Mitte und zwischen Armaturenbrett und Lehne passt (offenes Cockpit: Kopf darf
  // herausschauen). Die Ente aus js/rubber-duck.js ist 2,2 hoch, Boden bei y = −0.55, Schnabel +x.
  var DUCK_H = 2.2, DUCK_FLOOR = -0.55, DUCK_W = 1.9 / 2.2, DUCK_L = 2.4 / 2.2;
  var SEATS = {};
  function hullMeshes(t) {
    var list = [];
    t.updateMatrixWorld(true);
    t.traverse(function (o) {
      if (!o.isMesh || o.userData.driver || !o.geometry || !o.geometry.attributes.position) return;
      for (var p = o; p; p = p.parent) if (/^Wheel /.test(p.name || '') || p.userData.driver) return;
      var m = [].concat(o.material)[0]; if (m && m.visible === false) return;
      list.push(o);
    });
    return list;
  }
  // alle Trefferhöhen einer senkrechten Linie (von oben nach unten) bzw. Abstand bis zum ersten Treffer
  function castAll(ray, meshes, o, d) {
    ray.set(o, d); ray.far = Infinity;
    return ray.intersectObjects(meshes, false).map(function (h) { return h.distance; });
  }
  function autoSeat(t) { return noRide(t, function () { return autoSeat0(t); }); }
  function autoSeat0(t) {
    var D = t.userData.dims || { L: 4.4, W: 1.8, H: 1.3 }, L = D.L, W = D.W, H = D.H, y0 = -H / 2;
    var meshes = hullMeshes(t), ray = new THREE.Raycaster();
    ray.params.Line = { threshold: 0 }; ray.params.Points = { threshold: 0 };
    var down = new THREE.Vector3(0, -1, 0);
    // senkrechte Linien von oben: alle Flächenhöhen, absteigend
    function column(x, z) {
      var hs = castAll(ray, meshes, new THREE.Vector3(x, H, z).applyMatrix4(t.matrixWorld), down).map(function (dd) { return H - dd; });
      return hs.sort(function (a, b) { return b - a; });
    }
    // Punkte von Teilen nach Namen (Material oder Knoten) in Vorlagen-Koordinaten
    function namedPts(rx, notRx) {
      var pts = [], v = new THREE.Vector3();
      meshes.forEach(function (o) {
        var nm = [].concat(o.material).map(function (m) { return (m && m.name) || ''; }).join(' '), chain = '';
        for (var p = o; p && p !== t; p = p.parent) chain += ' ' + (p.name || '');
        if (!rx.test(nm + chain) || (notRx && notRx.test(nm + chain))) return;
        var pa = o.geometry.attributes.position, st = Math.max(1, Math.floor(pa.count / 400));
        for (var i = 0; i < pa.count; i += st) pts.push(v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld).clone());
      });
      return pts;
    }
    function boxOf(pts) { var b = new THREE.Box3(); pts.forEach(function (p) { b.expandByPoint(p); }); return b; }
    var unitM = UNIT, zd = -W * 0.22, sx = null, open = false;
    // 1. Lenkrad (30 von 70 Modellen): Fahrer sitzt ~0,45 m dahinter, auf seiner Höhe quer
    var sw = namedPts(/steer|lenkrad|steering/i, /column|säule|lock|stalk|paddle|shift/i).filter(function (p) { return p.y > y0 + H * 0.3 && p.y < y0 + H * 0.85; });
    if (sw.length > 10) {
      var sb = boxOf(sw), sc = sb.getCenter(new THREE.Vector3()), ss = sb.getSize(new THREE.Vector3());
      if (Math.max(ss.y, ss.z) < 0.7 * unitM) { sx = sc.x - 0.45 * unitM; zd = sc.z; }
    }
    // 2. sonst Scheiben über der Gürtellinie (Glashaus): Fahrer hinter der Frontscheibe
    if (sx == null) {
      var gl = namedPts(/glass|glas|window|windshield|windscreen|scheibe/i, /lamp|light|head|tail|mirror|spiegel|indicator/i).filter(function (p) { return p.y > y0 + H * 0.66; });
      if (gl.length > 10) {
        var gb = boxOf(gl), glen = gb.max.x - gb.min.x;
        // Frontscheibe = vorderes Ende des Glashauses; offene Autos haben nur die Scheibe (kurz)
        sx = glen > 0.6 * unitM ? gb.max.x - Math.min(glen * 0.45, 1.1 * unitM) : gb.min.x - 0.3 * unitM;
        if (gb.max.z - gb.min.z < W * 0.3) zd = (gb.min.z + gb.max.z) / 2;   // schmale Scheibe: Einsitzer mittig
      }
    }
    if (sx == null) sx = L * 0.05;
    // Sitzhöhe: senkrecht von oben an (sx, zd): oberste Fläche unterhalb der Gürtellinie = Sitz/Boden;
    // darüber die nächste Fläche = Dach (fehlt sie: offen)
    var hs = column(sx, zd), seat = null, roof = Infinity;
    // Sitzfläche liegt tief (Polster ~ 25–45 % der Höhe); Lenkrad, Armaturenbrett, Kopfstützen liegen darüber
    for (var j = 0; j < hs.length; j++) if (hs[j] < y0 + H * 0.45 && hs[j] > y0 + H * 0.05) { seat = hs[j]; break; }
    if (seat != null) for (j = hs.length - 1; j >= 0; j--) if (hs[j] > seat + H * 0.25) { roof = hs[j]; break; }
    if (seat == null) seat = y0 + H * 0.3;
    // Dach muss über dem Sitz deutlich Platz lassen, sonst ist es keine Kabine (z. B. Motorhaube getroffen)
    open = roof === Infinity || roof > y0 + H * 1.2;
    var col = { x: sx, c: { lo: seat, hi: roof, gap: open ? H * 0.9 : roof - seat, open: open } };
    var seatY = col.c.lo, z = zd, x = col.x, s, outward = zd <= 0 ? -1 : 1, U = UNIT;
    function hitsFrom(px, py, pz, dx, dy, dz) { return castAll(ray, meshes, new THREE.Vector3(px, py, pz), new THREE.Vector3(dx, dy, dz)); }
    // Dach = erste Fläche oberhalb von ~70 % der Höhe über dem Sitz (Lenkrad, Sonnenblende darunter zählen nicht)
    var ups = hitsFrom(x, seatY + H * 0.03, z, 0, 1, 0), roofY = null;
    for (var j2 = 0; j2 < ups.length; j2++) { var yy = seatY + H * 0.03 + ups[j2]; if (yy >= y0 + H * 0.7) { roofY = yy; break; } }
    var open = !!col.c.open || roofY == null;
    if (!open) {
      // Ente füllt die Kabine: Kopf knapp unters Dach; zu niedrig (< 0,55 m) → Sitz bis zum Boden absenken
      s = (roofY - seatY) * 0.97;
      if (s < 0.55 * U) {
        var below = hs.filter(function (h) { return h < seatY - 1e-4 && h > y0 + H * 0.02; })[0];
        if (below != null) { seatY = Math.max(below, roofY - 0.55 * U / 0.97); s = (roofY - seatY) * 0.97; }
      }
      // Kopf mittig ins Seitenfenster: Fenster auf der Fahrerseite um den Sitz herum
      var win = namedPts(/glass|glas|window|windshield|windscreen|scheibe/i, /lamp|light|head|tail|mirror|spiegel|indicator/i).filter(function (p) {
        return p.z * outward > W * 0.3 && Math.abs(p.x - x) < 0.35 * U && p.y > y0 + H * 0.4 && p.y < roofY;
      });
      if (win.length > 5) {
        var wy = win.map(function (p) { return p.y; }), mid = (Math.min.apply(null, wy) + Math.max.apply(null, wy)) / 2;
        // Kopfmitte liegt bei 73 % der Entenhöhe; Sitz so weit anheben, dass sie in Fensterhöhe kommt (Kopf bleibt unterm Dach)
        if (seatY + 0.73 * s < mid) {
          var k = 0.73 * 0.97, ns = (mid - k * roofY) / (1 - k);
          if (ns > seatY) { var ss = (roofY - ns) * 0.97; if (ss >= Math.min(s, 0.45 * U)) { seatY = ns; s = ss; } }
        }
      }
    } else {
      // offenes Cockpit: Kopf deutlich über den Rand (Kopf ab ~55 % der Entenhöhe)
      var side = column(x, z + outward * W * 0.18), rim = side.length ? side[0] : seatY + H * 0.3;
      s = Math.min(Math.max((rim - seatY) / 0.55, 0.55 * U, H * 0.35), 0.95 * U);
    }
    // in der Hülle bleiben: zur Tür mindestens die halbe Entenbreite (0,43 × Höhe), sonst nach innen rücken
    var hz = 0.43 * s, dr = hitsFrom(x, seatY + s * 0.5, z, 0, 0, outward)[0];
    if (dr != null && dr < hz * 1.05) z -= outward * (hz * 1.05 - dr);
    return { x: +x.toFixed(4), y: +seatY.toFixed(4), z: +z.toFixed(4), s: +s.toFixed(4), r: 0, auto: true, open: open };
  }
  // gespeicherter Sitz (Car editor) oder Schätzung; t = Vorlage (ohne: geladene Vorlage des Autos)
  function seatOf(key, t) {
    var v = vehicle(key).seat;
    if (v && typeof v === 'object' && isFinite(v.x) && isFinite(v.y) && isFinite(v.z) && v.s > 0) return { x: +v.x, y: +v.y, z: +v.z, s: +v.s, r: +v.r || 0, p: +v.p || 0, l: +v.l || 0, clip: v.clip && typeof v.clip === 'object' ? v.clip : undefined };
    t = t || TPL[key]; if (!t) return null;
    if (!SEATS[key]) SEATS[key] = autoSeat(t);
    return SEATS[key];
  }
  // Ente als Kind des Autos (Kopie aus build()) an den Sitz setzen, Schnabel nach vorn (+x); gibt die Ente zurück.
  // Ändert weder Teile-Schlüssel noch Radgruppen (Vorlage bleibt unberührt). opts: {color, outfit, seat}
  function addDriver(car, key, opts) {
    opts = opts || {};
    if (!root.RubberDuck || !car) return null;
    var st = opts.seat || seatOf(key || car.userData.key, opts.template); if (!st) return null;
    var duck = root.RubberDuck.build({ color: opts.color, outfit: opts.outfit });
    var k = st.s / DUCK_H;
    // Drehung: Turn um y, dann Lean (x, seitlich) und Tilt (z, Schnabel hoch/runter) – Reihenfolge YXZ
    duck.scale.setScalar(k); duck.position.set(st.x, st.y - DUCK_FLOOR * k, st.z);
    duck.rotation.order = 'YXZ'; duck.rotation.set(+st.l || 0, +st.r || 0, +st.p || 0);
    duck.name = 'Driver'; duck.userData.driver = true;
    duck.traverse(function (o) { o.userData.driver = true; });
    // Vorlage liegt in car.children[0] (wrap) – Sitz gilt in Auto-Koordinaten, also direkt am Auto
    bodyOf(car).add(duck);   // Karosserie-Ebene: hebt sich mit der Fahrhöhe
    // Schnittwände (seat.clip, Auto-Koordinaten): was jenseits liegt, wird nicht gezeichnet – Ente guckt nicht
    // seitlich oder hinten heraus. Eigene Material-Kopien je Ente; Ebenen in Weltlage per updateDriverClip
    var planes = clipPlanes(st.clip);
    if (planes.length) {
      duck.userData.clipLocal = planes; duck.userData.clipWorld = planes.map(function (p) { return p.clone(); });
      duck.traverse(function (o) {
        if (!o.isMesh) return;
        o.material = Array.isArray(o.material) ? o.material.map(function (m) { var c = m.clone(); c.clippingPlanes = duck.userData.clipWorld; return c; })
          : (function (m) { var c = m.clone(); c.clippingPlanes = duck.userData.clipWorld; return c; })(o.material);
      });
      updateDriverClip(duck);
    }
    return duck;
  }
  // clip = {l, r, b, f, t}: linke Wand (z), rechte Wand (z), hinten (x), vorn (x), Dach (y) – sichtbar bleibt innen
  function clipPlanes(c) {
    var out = [];
    if (!c || typeof c !== 'object') return out;
    if (isFinite(c.l) && c.l !== null) out.push(new THREE.Plane(new THREE.Vector3(0, 0, 1), -c.l));    // z ≥ l
    if (isFinite(c.r) && c.r !== null) out.push(new THREE.Plane(new THREE.Vector3(0, 0, -1), +c.r));   // z ≤ r
    if (isFinite(c.b) && c.b !== null) out.push(new THREE.Plane(new THREE.Vector3(1, 0, 0), -c.b));    // x ≥ b
    if (isFinite(c.f) && c.f !== null) out.push(new THREE.Plane(new THREE.Vector3(-1, 0, 0), +c.f));   // x ≤ f
    if (isFinite(c.t) && c.t !== null) out.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), +c.t));   // y ≤ t
    return out;
  }
  // Schnittwände in Weltlage nachführen (jedes Bild, wenn sich das Auto bewegt): Ebenen hängen am Auto (Eltern der Ente)
  function updateDriverClip(duck) {
    if (!duck || !duck.userData.clipLocal) return;
    var car = duck.parent; if (!car) return;
    car.updateWorldMatrix(true, false);
    var nm = new THREE.Matrix3().getNormalMatrix(car.matrixWorld);
    duck.userData.clipLocal.forEach(function (p, i) { duck.userData.clipWorld[i].copy(p).applyMatrix4(car.matrixWorld, nm); });
  }
  // alle Fahrer unter einem Objekt (z. B. der ganzen Szene) nachführen
  function updateDriverClips(rootObj) {
    if (!rootObj) return;
    rootObj.traverse(function (o) { if (o.name === 'Driver' && o.userData.clipLocal) updateDriverClip(o); });
  }
  // Wände aus der Kabine schätzen (Car editor „Auto walls“): Türinnenseiten, Frontscheibe, Heckscheibe/Rückwand, Dach
  function autoWalls(key, t, st) {
    t = t || TPL[key]; st = st || seatOf(key, t); if (!t || !st) return null;
    return noRide(t, function () { return autoWalls0(t, st); });
  }
  function autoWalls0(t, st) {
    var meshes = hullMeshes(t), ray = new THREE.Raycaster(), U = UNIT, D = t.userData.dims;
    function hits(o, d) { return castAll(ray, meshes, o, d); }
    var mid = new THREE.Vector3(st.x, st.y + st.s * 0.5, st.z), head = new THREE.Vector3(st.x, st.y + st.s * 0.8, st.z), c = {};
    var hl = hits(mid, new THREE.Vector3(0, 0, -1)), hr = hits(mid, new THREE.Vector3(0, 0, 1));
    if (hl.length) c.l = +(st.z - hl[0] + 0.005 * U).toFixed(4);
    // rechts: Innenseite der anderen Tür (vorletzte Fläche), Konsole/Beifahrersitz dazwischen zählen nicht
    if (hr.length) c.r = +(st.z + (hr.length > 1 ? hr[hr.length - 2] : hr[0]) - 0.005 * U).toFixed(4);
    var hf = hits(head, new THREE.Vector3(1, 0, 0)), hb = hits(head, new THREE.Vector3(-1, 0, 0)).filter(function (d) { return d > 0.12 * U; });
    if (hf.length) c.f = +(st.x + hf[0] - 0.005 * U).toFixed(4);
    if (hb.length) c.b = +(st.x - hb[0] + 0.005 * U).toFixed(4);
    var hu = hits(new THREE.Vector3(st.x, st.y + st.s * 0.5, st.z), new THREE.Vector3(0, 1, 0)).filter(function (d) { return st.y + st.s * 0.5 + d > -D.H / 2 + D.H * 0.7; });
    if (hu.length) c.t = +(st.y + st.s * 0.5 + hu[0] - 0.005 * U).toFixed(4);
    return c;
  }
  function dims(key) { var t = TPL[key] || TPL[MODELS[0]]; return t ? t.userData.dims : { L: 4.4, W: 1.8, H: 1.4, belt: 0.9 }; }
  function random() { var m = MODELS[Math.floor(Math.random() * MODELS.length)], p = pickPaint(m); return { model: m, color: p.c }; }

  root.ToyCars = {
    ready: ready, build: build, dims: dims, pickPaint: pickPaint, paintAt: paintAt, random: random, applyCustom: applyCustom, prepare: prepare,
    meta: function (k) { return META[k]; }, editMode: function (on) { EDIT = !!on; },
    forget: function (k) { delete TPL[k]; delete loading[k]; delete SEATS[k]; var i = MODELS.indexOf(k); if (i >= 0) MODELS.splice(i, 1); },
    paintTemplate: paintTemplate, has: function (k) { return !!BYKEY[k] || !!TPL[k]; }, catalog: function () { return CATALOG; },
    loadCatalog: loadCatalog, loadModel: loadModel, mergeForRace: mergeForRace, vehicle: vehicle,
    seatOf: seatOf, autoSeat: autoSeat, bodyOf: bodyOf, rideOf: rideOf, applyRide: applyRide, RIDE_MIN: RIDE_MIN, RIDE_MAX: RIDE_MAX, addDriver: addDriver, updateDriverClip: updateDriverClip, updateDriverClips: updateDriverClips, autoWalls: autoWalls, forgetSeat: function (k) { delete SEATS[k]; }, MODELS: MODELS, UNIT: UNIT, base: function () { return BASE; }
  };
})(typeof window !== 'undefined' ? window : this);
