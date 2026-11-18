/* Autos für den Party-Regen (effects/item-rain.html?kind=car|mix): echte 3D-Modelle von Sketchfab
 * (im Car-Picker ausgewählt, mit scripts/build_car_rain.py aufbereitet, Katalog /api/fx/cars/catalog.json,
 * Dateien /api/fx/cars/model/<uid>.glb). Braucht three r128, GLTFLoader und js/glb-fix.js davor.
 *
 *   ToyCars.ready({ model, count }) → Promise   lädt den Katalog und count zufällige Modelle aus dem Mix
 *                                               (oder genau model); löst spätestens nach timeout ms auf
 *   ToyCars.MODELS          geladene Modelle (Schlüssel), aus denen der Regen zieht
 *   ToyCars.has(key), ToyCars.dims(key) → { L, W, H, belt }, ToyCars.pickPaint(key) → { c }
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

  // Modell ausrichten, skalieren, mittig setzen; Räder/Lack über GlbFix
  function prepare(scene, e) {
    if (root.GlbFix) GlbFix.prepare(scene);
    mergeStatic(scene);
    scene.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(scene), size = new THREE.Vector3(); box.getSize(size);
    var lx = size.x >= size.z, front = e.front || 0;
    if (!front) {
      // kürzerer Überhang vorn: Radmitten gegen die Fahrzeugenden
      var ws = scene.userData.wheels || [];
      if (ws.length >= 4) {
        var vals = ws.map(function (w) { var p = new THREE.Vector3(); w.pivot.getWorldPosition(p); return lx ? p.x : p.z; });
        var lo = lx ? box.min.x : box.min.z, hi = lx ? box.max.x : box.max.z;
        front = (hi - Math.max.apply(null, vals)) < (Math.min.apply(null, vals) - lo) ? 1 : -1;
      } else front = 1;
    }
    var rot = new THREE.Group(); rot.add(scene);
    rot.rotation.y = lx ? (front > 0 ? 0 : Math.PI) : (front > 0 ? Math.PI / 2 : -Math.PI / 2);
    rot.updateMatrixWorld(true);
    box.setFromObject(rot); box.getSize(size);
    var k = (e.len || 4.5) * UNIT / Math.max(1e-6, size.x);
    var wrap = new THREE.Group(); wrap.add(rot); wrap.scale.setScalar(k);
    wrap.updateMatrixWorld(true);
    box.setFromObject(wrap); var c = new THREE.Vector3(); box.getCenter(c); box.getSize(size);
    rot.position.sub(c.divideScalar(k));
    var car = new THREE.Group(); car.add(wrap); car.name = e.key;
    car.userData.dims = { L: size.x, W: size.z, H: size.y, belt: size.y * 0.62 };
    car.userData.paintMats = scene.userData.paintMats || [];
    car.userData.rimMats = scene.userData.rimMats || [];
    car.userData.key = e.key;
    return car;
  }
  function loadModel(e) {
    if (TPL[e.key]) return Promise.resolve(TPL[e.key]);
    if (loading[e.key]) return loading[e.key];
    return (loading[e.key] = new Promise(function (res, rej) {
      new THREE.GLTFLoader().load(BASE + 'api/fx/cars/model/' + e.uid + '.glb', function (gl) {
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
      if (opts.model && BYKEY[opts.model]) pick = [BYKEY[opts.model]];
      else {
        var mix = CATALOG.filter(inMix).sort(function (a, b) { return (a.bytes || 0) - (b.bytes || 0); });
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

  // Lackfarbe: Liste aus dem Editor (gewichtet), c = null heißt Originalfarbe des Modells
  function pickPaint(key) {
    var list = vehicle(key).paints;
    if (!Array.isArray(list) || !list.length) return { c: null };
    var sum = 0, r; list.forEach(function (p) { sum += p.w || 1; }); r = Math.random() * sum;
    for (var i = 0; i < list.length; i++) { r -= list[i].w || 1; if (r <= 0) return { c: list[i].c == null ? null : list[i].c }; }
    return { c: list[0].c == null ? null : list[0].c };
  }
  function colourMat(m, hex, tag) {
    var k = tag + ':' + m.uuid + ':' + hex;
    if (!PAINTS[k]) { PAINTS[k] = m.clone(); PAINTS[k].color.setHex(hex); }
    return PAINTS[k];
  }
  // Kopie einer Vorlage mit Lack-/Felgenfarbe (rim: Zahl = Farbe, null = Original, undefined = aus dem Editor)
  function paintTemplate(t, color, rim) {
    var car = t.clone(true), swap = {};
    if (rim === undefined) rim = vehicle(t.userData.key).rim;
    if (color != null) t.userData.paintMats.forEach(function (m) { swap[m.uuid] = colourMat(m, color, 'p'); });
    if (rim != null) t.userData.rimMats.forEach(function (m) { swap[m.uuid] = colourMat(m, rim, 'r'); });
    if (Object.keys(swap).length) car.traverse(function (o) {
      if (!o.isMesh) return;
      if (Array.isArray(o.material)) o.material = o.material.map(function (m) { return swap[m.uuid] || m; });
      else if (swap[o.material.uuid]) o.material = swap[o.material.uuid];
    });
    return car;
  }
  function build(key, color) {
    var t = TPL[key] || TPL[MODELS[0]];
    return t ? paintTemplate(t, color) : new THREE.Group();
  }
  function dims(key) { var t = TPL[key] || TPL[MODELS[0]]; return t ? t.userData.dims : { L: 4.4, W: 1.8, H: 1.4, belt: 0.9 }; }
  function random() { var m = MODELS[Math.floor(Math.random() * MODELS.length)], p = pickPaint(m); return { model: m, color: p.c }; }

  root.ToyCars = {
    ready: ready, build: build, dims: dims, pickPaint: pickPaint, random: random, applyCustom: applyCustom, prepare: prepare,
    paintTemplate: paintTemplate, has: function (k) { return !!BYKEY[k] || !!TPL[k]; }, catalog: function () { return CATALOG; },
    loadCatalog: loadCatalog, loadModel: loadModel, vehicle: vehicle, MODELS: MODELS, UNIT: UNIT, base: function () { return BASE; }
  };
})(typeof window !== 'undefined' ? window : this);
