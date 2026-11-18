/* Autos für den Party-Regen (effects/item-rain.html?kind=car|mix): echte 3D-Modelle von Sketchfab
 * (im Car-Picker ausgewählt, mit scripts/build_car_rain.py aufbereitet, Katalog /api/fx/cars/catalog.json,
 * Dateien /api/fx/cars/model/<uid>.glb). Braucht three r128, GLTFLoader und js/glb-fix.js davor.
 *
 *   ToyCars.ready({ model, count }) → Promise   lädt den Katalog und count zufällige Modelle aus dem Mix
 *                                               (oder genau model, bzw. model=brand:<Marke> nur diese Marke)
 *   ToyCars.MODELS          geladene Modelle (Schlüssel), aus denen der Regen zieht
 *   ToyCars.has(key), ToyCars.dims(key) → { L, W, H, belt }, ToyCars.pickPaint(key) → { c, r?, z? } (Farbset)
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

  // Modell ausrichten, skalieren, mittig setzen; Räder/Lack über GlbFix
  // Räder aus selbst gewählten Teilen (Car editor „Pick wheel parts“): Teile nach Lage zu Rädern gruppieren
  // (Seite, dann entlang der Länge), je Rad Drehpunkt in der Mitte, Drehgruppe „Spin“ um die Querachse
  function buildWheels(scene, keys) {
    scene.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(scene), size = new THREE.Vector3(), ctr = new THREE.Vector3(); box.getSize(size); box.getCenter(ctr);
    var lx = size.x >= size.z, len = lx ? size.x : size.z, parts = [];
    scene.traverse(function (o) {
      if (!o.isMesh || keys.indexOf(o.userData.pkey) < 0) return;
      var b = new THREE.Box3().setFromObject(o), c = new THREE.Vector3(); b.getCenter(c); parts.push({ o: o, c: c, b: b });
    });
    var groups = [];
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
      var b = new THREE.Box3(); g.list.forEach(function (p) { b.union(p.b); });
      var c = new THREE.Vector3(); b.getCenter(c);
      var pivot = new THREE.Group(); pivot.name = 'Wheel ' + g.side + i; pivot.position.copy(c); scene.add(pivot);
      var spin = new THREE.Group(); spin.name = 'Spin'; spin.userData.ax = lx ? 'z' : 'x'; pivot.add(spin);
      scene.updateMatrixWorld(true);
      g.list.forEach(function (p) { spin.attach(p.o); p.o.userData.wheelPart = true; });
    });
    return groups.length;
  }

  function prepare(scene, e) {
    var v = vehicle(e.key);
    // eigene Räder: ausdrücklich gewählte Radteile, sonst die gewählten Felgen (plus Reifen) – dann dreht nur das
    var own = Array.isArray(v.wheelParts) || (Array.isArray(v.rimParts) && v.rimParts.length > 0);
    if (root.GlbFix) GlbFix.prepare(scene, { wheels: !own && v.straight !== false });
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
    var wheelKeys = Array.isArray(v.wheelParts) ? v.wheelParts : null;
    if (!wheelKeys && own) {
      // Felgen + Reifen (Material heißt tire/tyre/reifen/rubber, nicht Dichtungen/Leisten)
      wheelKeys = v.rimParts.slice();
      scene.traverse(function (o) {
        if (!o.isMesh) return;
        var nm = [].concat(o.material).map(function (m) { return (m && m.name) || ''; }).join(' ');
        if (/tire|tyre|reifen|rubber|whitewall/i.test(nm) && !/trim|seal|strip|window|door/i.test(nm)) wheelKeys.push(o.userData.pkey);
      });
    }
    var ownWheels = own && wheelKeys && wheelKeys.length ? buildWheels(scene, wheelKeys) : 0;
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
    META[e.key] = { all: all, paint: paint, rim: rim, zones: zones, autoPaintParts: autoPaintParts, autoRimParts: autoRimParts, wheels: ownWheels || (ud.wheels || []).length };
    if (!EDIT) mergeStatic(scene);   // im Editor einzeln lassen: Teile müssen anklickbar bleiben
    scene.updateMatrixWorld(true);
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
  // Oberflächen der Farbbereiche: [Metall, Rauheit, Klarlack]
  var FINISH = { matte: [0, 0.85, 0], satin: [0.1, 0.5, 0], gloss: [0.1, 0.22, 1], chrome: [1, 0.08, 0] };
  function zoneMat(m, hex, f) {
    var k = 'z:' + f + ':' + m.uuid + ':' + hex;
    if (!PAINTS[k]) {
      var c = PAINTS[k] = m.clone(), F = FINISH[f] || FINISH.satin;
      c.color.setHex(hex).convertSRGBToLinear();
      c.map = null; c.metalnessMap = null; c.roughnessMap = null; if (c.aoMap) c.aoMapIntensity = 0.35;
      c.metalness = F[0]; c.roughness = F[1];
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
          if (zc != null) x.material = zoneMat(x.material, zc, zl[i].f);
          return;
        }
        if (rim != null && o.rimParts && o.rimParts.indexOf(k) >= 0) x.material = colourMat(x.material, rim, 'r', false);
        else if (color != null && o.paintParts && o.paintParts.indexOf(k) >= 0) x.material = colourMat(x.material, color, 'p', texOff);
      });
      return car;
    }
    if (color != null) meta.paint.forEach(function (m) { swap[m.uuid] = colourMat(m, color, 'p', texOff); });
    if (rim != null) meta.rim.forEach(function (m) { swap[m.uuid] = colourMat(m, rim, 'r', false); });
    (Array.isArray(v.zones) ? v.zones : []).forEach(function (z) {
      var zc = zoneColour(z, o.zones);
      if (zc != null) ((meta.zones || {})[z.id] || []).forEach(function (m) { swap[m.uuid] = zoneMat(m, zc, z.f); });
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
    ready: ready, build: build, dims: dims, pickPaint: pickPaint, random: random, applyCustom: applyCustom, prepare: prepare,
    meta: function (k) { return META[k]; }, editMode: function (on) { EDIT = !!on; },
    forget: function (k) { delete TPL[k]; delete loading[k]; var i = MODELS.indexOf(k); if (i >= 0) MODELS.splice(i, 1); },
    paintTemplate: paintTemplate, has: function (k) { return !!BYKEY[k] || !!TPL[k]; }, catalog: function () { return CATALOG; },
    loadCatalog: loadCatalog, loadModel: loadModel, vehicle: vehicle, MODELS: MODELS, UNIT: UNIT, base: function () { return BASE; }
  };
})(typeof window !== 'undefined' ? window : this);
