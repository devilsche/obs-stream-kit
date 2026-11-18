/* Autos für den Party-Regen (effects/item-rain.html?kind=car|mix): echte 3D-Modelle von Sketchfab
 * (im Car-Picker ausgewählt, mit scripts/build_car_rain.py aufbereitet, Katalog /api/fx/cars/catalog.json,
 * Dateien /api/fx/cars/model/<uid>.glb). Braucht three r128, GLTFLoader und js/glb-fix.js davor.
 *
 *   ToyCars.ready({ model, count }) → Promise   lädt den Katalog und count zufällige Modelle aus dem Mix
 *                                               (oder genau model, bzw. model=brand:<Marke> nur diese Marke)
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

  // Modell ausrichten, skalieren, mittig setzen; Räder/Lack über GlbFix
  function prepare(scene, e) {
    var v = vehicle(e.key);
    if (root.GlbFix) GlbFix.prepare(scene, { wheels: v.straight !== false });
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
      var wheel = null; for (var p = o.parent; p && p !== scene; p = p.parent) if (/^Wheel /.test(p.name || '')) { wheel = p.name; break; }
      var m0 = [].concat(o.material)[0], base = wheel ? wheel + ':' + (m0 && m0.userData.key) : (o.name || '#' + n);
      n++; pk[base] = (pk[base] || 0) + 1;
      o.userData.pkey = pk[base] > 1 ? base + '~' + pk[base] : base;
    });
    var ud = scene.userData;
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
    var autoPaint = {}, autoRim = {};
    (ud.paintMats || []).forEach(function (m) { autoPaint[m.uuid] = 1; }); (ud.rimMats || []).forEach(function (m) { autoRim[m.uuid] = 1; });
    var autoPaintParts = [], autoRimParts = [];
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      var ms = [].concat(o.material);
      if (ms.some(function (m) { return m && autoPaint[m.uuid]; })) autoPaintParts.push(o.userData.pkey);
      if (ms.some(function (m) { return m && autoRim[m.uuid]; })) autoRimParts.push(o.userData.pkey);
    });
    META[e.key] = { all: all, paint: paint, rim: rim, autoPaintParts: autoPaintParts, autoRimParts: autoRimParts, wheels: (ud.wheels || []).length };
    if (!EDIT) mergeStatic(scene);   // im Editor einzeln lassen: Teile müssen anklickbar bleiben
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
    if (vehicle(e.key).flip) front = -front;   // im Car editor als falsch herum markiert
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
    car.userData.key = e.key;
    delete ud.wheels; delete ud.paintMats; delete ud.rimMats; delete ud.rimFromPaint;
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

  // Lackfarbe: Liste aus dem Editor (gewichtet), c = null heißt Originalfarbe des Modells
  function pickPaint(key) {
    var list = vehicle(key).paints;
    if (!Array.isArray(list) || !list.length) return { c: null };
    var sum = 0, r; list.forEach(function (p) { sum += p.w || 1; }); r = Math.random() * sum;
    for (var i = 0; i < list.length; i++) { r -= list[i].w || 1; if (r <= 0) return { c: list[i].c == null ? null : list[i].c }; }
    return { c: list[0].c == null ? null : list[0].c };
  }
  function colourMat(m, hex, tag, texOff) {
    var k = tag + ':' + m.uuid + ':' + hex + (texOff ? ':t' : '');
    if (!PAINTS[k]) { PAINTS[k] = m.clone(); PAINTS[k].color.setHex(hex); if (texOff) PAINTS[k].map = null; }
    return PAINTS[k];
  }
  // Kopie einer Vorlage mit Lack-/Felgenfarbe (rim: Zahl = Farbe, null = Original, undefined = aus dem Editor);
  // o = { paint: [Schlüssel], rims: [Schlüssel], texOff } überschreibt die Einstellungen (Vorschau im Editor)
  // o.paintParts / o.rimParts: Teile-Schlüssel (Editor-Vorschau, Teile nicht zusammengefasst)
  function paintTemplate(t, color, rim, o) {
    o = o || {};
    var key = t.userData.key, v = vehicle(key), meta = META[key] || { all: [], paint: [], rim: [] };
    var texOff = o.texOff != null ? o.texOff : !!v.texOff;
    var car = t.clone(true), swap = {};
    if (rim === undefined) rim = v.rim;
    if (o.paintParts || o.rimParts) {
      // je Teil umfärben (Material-Kopien je Original-Material und Farbe)
      car.traverse(function (x) {
        if (!x.isMesh || Array.isArray(x.material)) return;
        var k = x.userData.pkey;
        if (rim != null && o.rimParts && o.rimParts.indexOf(k) >= 0) x.material = colourMat(x.material, rim, 'r', false);
        else if (color != null && o.paintParts && o.paintParts.indexOf(k) >= 0) x.material = colourMat(x.material, color, 'p', texOff);
      });
      return car;
    }
    if (color != null) meta.paint.forEach(function (m) { swap[m.uuid] = colourMat(m, color, 'p', texOff); });
    if (rim != null) meta.rim.forEach(function (m) { swap[m.uuid] = colourMat(m, rim, 'r', false); });
    if (Object.keys(swap).length) car.traverse(function (x) {
      if (!x.isMesh) return;
      if (Array.isArray(x.material)) x.material = x.material.map(function (m) { return swap[m.uuid] || m; });
      else if (swap[x.material.uuid]) x.material = swap[x.material.uuid];
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
    meta: function (k) { return META[k]; }, editMode: function (on) { EDIT = !!on; },
    forget: function (k) { delete TPL[k]; delete loading[k]; var i = MODELS.indexOf(k); if (i >= 0) MODELS.splice(i, 1); },
    paintTemplate: paintTemplate, has: function (k) { return !!BYKEY[k] || !!TPL[k]; }, catalog: function () { return CATALOG; },
    loadCatalog: loadCatalog, loadModel: loadModel, vehicle: vehicle, MODELS: MODELS, UNIT: UNIT, base: function () { return BASE; }
  };
})(typeof window !== 'undefined' ? window : this);
