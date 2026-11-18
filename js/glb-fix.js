/* Aufbereitung geladener Sketchfab-Modelle (GLTFLoader, three r128) für Regen, Übersicht und Mockups:
 * - alle Materialien beidseitig (manche Modelle haben gedrehte Flächen → fehlende Scheiben)
 * - Glas (Materialname enthält „glass“/„glas“ oder halbtransparent ohne Textur) wird dunkles, getöntes,
 *   undurchsichtiges Glas
 * - Texturen mit Transparenz (Logos, Embleme, Aufkleber): werden ausgeschnitten (alphaTest), nicht eingefärbt
 *
 * - hat das Modell einen Innenraum (Materialnamen wie leather, seat, interior, dashboard, steering …),
 *   bleiben die Scheiben getönt durchsichtig, sonst dunkel undurchsichtig (sonst sähe man ins Leere)
 *
 * - Kulisse weg: Partikel/Linien/Sprites und Teile, die weit über das Auto hinausragen (Wände, Boden,
 *   Studio-Hintergrund); das Auto ist der Bereich, in dem 85 % der Dreiecke liegen
 *
 * - Räder als eigene Teile (wheels): Reifen finden (Material tire/tyre/rubber/reifen), je Rad alles im
 *   Radzylinder (Felge, Kappe, Bremse, auch Stücke aus dem Lack-Material) herausschneiden, in eine eigene
 *   Gruppe mit Drehpunkt in der Radmitte legen und eingeschlagene Vorderräder gerade stellen; danach lenkbar
 *   (pivot.rotation.y) – root.userData.wheels = [{ pivot, front, side, radius }]
 * - Lack und Felgen umfärben (paint): Lack = Material mit paint/body/carpaint/lack/main_color im Namen,
 *   sonst das flächengrößte farbige Material; Felgen = Material mit rim/wheel/felge/hubcap im Namen oder
 *   die Lack-Stücke, die beim Herausschneiden der Räder anfallen
 *
 *   GlbFix.prepare(root) → root (Materialien werden in place angepasst), root.userData.interior = true/false
 *   GlbFix.setPaint(root, hex), GlbFix.setRims(root, hex) – Farbe setzen (null = Original)
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  var GLASS = [0.05, 0.065, 0.08];
  var DONE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  var INTERIOR = /interior|leather|seat|dash|steer|carpet|cockpit|stitch|gauge|headliner|\bint_|_int\b|pedal|gear|console/i;
  function isGlassName(n) { return /glass|glas|window|scheibe|windshield/i.test(n || '') && !isLampName(n); }
  // Lampengläser (bernstein, Scheinwerfer, Rückleuchten) bleiben durchscheinend, sonst verschwinden die Lampen
  function isLampName(n) { return /amber|bronze|lamp|light|head|tail|indicator|blinker|clear|lens/i.test(n || ''); }
  function fixMaterial(m, inside) {
    if (!m || (DONE && DONE.has(m))) return;
    if (DONE) DONE.set(m, true);
    m.side = THREE.DoubleSide;
    var see = m.transparent || m.opacity < 1 || (m.alphaTest > 0);
    // unsichtbare Hilfsflächen (Deckkraft fast 0, ohne Textur) ausblenden statt zu Glas zu machen
    if (m.opacity < 0.05 && !m.map) { m.visible = false; m.needsUpdate = true; return; }
    if (isLampName(m.name)) { if (see) m.depthWrite = false; m.needsUpdate = true; return; }
    if (isGlassName(m.name) || (see && !m.map)) {
      if (inside) {
        // mit Innenraum: getönt durchsichtig, Innenleben bleibt sichtbar
        m.transparent = true; m.opacity = Math.min(m.opacity < 1 ? m.opacity : 0.4, 0.45); m.depthWrite = false; m.alphaTest = 0;
        if (!m.map) m.color.setRGB(0.12, 0.14, 0.17);
        m.metalness = 0.2; m.roughness = 0.03; if ('clearcoat' in m) m.clearcoat = 1; m.envMapIntensity = 1.6;
        if ('transmission' in m) m.transmission = 0;
        m.needsUpdate = true;
        return;
      }
      // ohne Innenraum: eigenes Glas-Material, dunkel getönt, glänzend, undurchsichtig
      m.transparent = false; m.opacity = 1; m.alphaTest = 0; m.depthWrite = true;
      if (!m.map) m.color.setRGB(GLASS[0], GLASS[1], GLASS[2]);
      m.metalness = 0.3; m.roughness = 0.04;
      if ('clearcoat' in m) m.clearcoat = 1;
      m.envMapIntensity = 1.5;
    } else if (see && m.map) {
      // Texturen mit Transparenz (Logos, Embleme, Aufkleber, Gitter): ausschneiden statt einfärben,
      // dann gibt es keine Sortierfehler und keinen dunklen Kasten ums Logo
      m.transparent = false; m.opacity = 1; m.alphaTest = 0.5; m.depthWrite = true;
    }
    m.needsUpdate = true;
  }
  function tris(g) { return g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0); }
  // Studio-Kulisse entfernen (aus dem Baum, damit Box3.setFromObject sie nicht mehr mitzählt)
  function isolate(obj) {
    obj.updateMatrixWorld(true);
    var drop = [], parts = [];
    obj.traverse(function (o) {
      if (o.isPoints || o.isLine || o.isSprite) { drop.push(o); return; }
      if (o.isMesh && o.geometry) {
        var b = new THREE.Box3().setFromObject(o);
        if (!b.isEmpty()) parts.push({ o: o, b: b, t: tris(o.geometry) });
      }
    });
    var total = parts.reduce(function (a, p) { return a + p.t; }, 0);
    if (parts.length > 1 && total > 0) {
      // Kern: dreiecksreichste Teile, bis 85 % aller Dreiecke erfasst sind
      var sorted = parts.slice().sort(function (a, b) { return b.t - a.t; }), core = new THREE.Box3(), acc = 0;
      for (var i = 0; i < sorted.length && acc < total * 0.85; i++) { core.union(sorted[i].b); acc += sorted[i].t; }
      var cs = new THREE.Vector3(); core.getSize(cs);
      var grow = new THREE.Box3(core.min.clone().addScaledVector(cs, -0.6), core.max.clone().addScaledVector(cs, 0.6));
      parts.forEach(function (p) {
        var s = new THREE.Vector3(); p.b.getSize(s);
        // großzügig: bei Modellen mit sehr detaillierten Rädern ist der „Kern“ nur der Radbereich – die Karosserie
        // ist dann bis ~1,8× länger und darf nicht als Kulisse gelten
        var tooBig = s.x > cs.x * 3 || s.z > cs.z * 3 || s.y > cs.y * 3;
        // flache Bodenplatte/Wand, die über das Auto hinausreicht (Ausstellungs-Untergrund)
        var flat = Math.min(s.x, s.y, s.z) < Math.max(cs.x, cs.z) * 0.01 && (s.x > cs.x * 2 || s.z > cs.z * 2);
        tooBig = tooBig || flat;
        var outside = !grow.intersectsBox(p.b) || !grow.containsPoint(p.b.getCenter(new THREE.Vector3()));
        if ((tooBig || outside) && p.t < total * 0.1) drop.push(p.o);
      });
    }
    drop.forEach(function (o) { if (o.parent) o.parent.remove(o); });
    obj.userData.removedParts = drop.length;
  }
  // Anteil der Punkte im Kabinenkern (mittleres Längsdrittel, innere Breite, mittlere Höhe):
  // Sitze, Armaturenbrett, Lenkrad liegen dort, eine hohle Karosserie hat dort fast nichts
  function cabinShare(obj) {
    obj.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(obj), size = new THREE.Vector3(); box.getSize(size);
    if (box.isEmpty()) return 0;
    var lx = size.x >= size.z, v = new THREE.Vector3(), n = 0, hit = 0;
    obj.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      var p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 4000));
      for (var i = 0; i < p.count; i += step) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); n++;
        var l = lx ? (v.x - box.min.x) / size.x : (v.z - box.min.z) / size.z;
        var w = Math.abs(lx ? v.z - (box.min.z + box.max.z) / 2 : v.x - (box.min.x + box.max.x) / 2) / ((lx ? size.z : size.x) / 2);
        var h = (v.y - box.min.y) / size.y;
        if (l > 0.3 && l < 0.7 && w < 0.55 && h > 0.25 && h < 0.75) hit++;
      }
    });
    return n ? hit / n : 0;
  }
  function prepare(obj, opts) {
    opts = opts || {};
    isolate(obj);
    var inside = false;
    obj.traverse(function (o) {
      if (o.isMesh) [].concat(o.material).forEach(function (m) { if (m && INTERIOR.test(m.name || '')) inside = true; });
      if (o.name && INTERIOR.test(o.name)) inside = true;
    });
    if (!inside && cabinShare(obj) >= 0.04) inside = true;
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      [].concat(o.material).forEach(function (m) { fixMaterial(m, inside); });
      // durchsichtige Scheiben nach dem Rest zeichnen
      if ([].concat(o.material).some(function (m) { return m && m.transparent; })) o.renderOrder = 2;
    });
    obj.userData.interior = inside;
    try { obj.userData.wheels = opts.wheels === false ? [] : wheels(obj); } catch (e) { obj.userData.wheels = []; }
    try { colours(obj); } catch (e) { obj.userData.paintMats = []; obj.userData.rimMats = []; }
    return obj;
  }
  // ── Räder ──
  var TIRE = /tire|tyre|reifen|rubber|whitewall/i, NOT_TIRE = /trim|seal|strip|window|door|mat\b|pedal/i;
  var RIM = /\brim|rim\b|rims|felge|hubcap|wheel|alloy|spoke/i, NOT_RIM = /steer|stitch|tire|tyre|lenk|trim|interior|\bint/i;
  var PAINT = /paint|carpaint|lack|main_color|maincolor|body_?colou?r|bodywork|exterior_?colou?r|\bbody\b|^body/i, NOT_PAINT = /under|interior|\bint|chassis|frame|plastic|black|glass/i;
  function matName(m) { return (m && m.name) || ''; }
  function isTire(m) { return TIRE.test(matName(m)) && !NOT_TIRE.test(matName(m)); }
  // ganze Räder an Teile- oder Materialnamen (wheel_lf, 3DWheel Front L, Tyre_RR …), nicht das Lenkrad
  var WHEEL = /wheel|tyre|tire|\brim|rim_|_rim|whl/i, NOT_WHEEL = /steer|stitch|spare|lenk|interior|\bint_/i;
  function wheelNode(o, stop) { for (var p = o; p && p !== stop; p = p.parent) if (p.name && WHEEL.test(p.name) && !NOT_WHEEL.test(p.name)) return true; return false; }
  function isWheelMat(m) { return isTire(m) || (WHEEL.test(matName(m)) && !NOT_WHEEL.test(matName(m))); }
  function isRimMat(m) { return RIM.test(matName(m)) && !NOT_RIM.test(matName(m)); }
  // Dreiecke einer Geometrie als Liste von [a, b, c] Indizes
  function triIndex(g) {
    if (g.index) return g.index.array;
    var n = g.attributes.position.count, a = new Uint32Array(n);
    for (var i = 0; i < n; i++) a[i] = i;
    return a;
  }
  function wheels(obj) {
    obj.updateMatrixWorld(true);
    var inv = new THREE.Matrix4().copy(obj.matrixWorld).invert ? new THREE.Matrix4().copy(obj.matrixWorld).invert() : new THREE.Matrix4().getInverse(obj.matrixWorld);
    var meshes = [], tireP = [], v = new THREE.Vector3();
    obj.traverse(function (o) { if (o.isMesh && o.geometry && o.geometry.attributes.position) meshes.push(o); });
    var box = new THREE.Box3().setFromObject(obj), size = new THREE.Vector3(), ctr = new THREE.Vector3(); box.getSize(size); box.getCenter(ctr);
    var lx = size.x >= size.z;   // Längsachse x oder z
    // Reifenpunkte (in obj-Koordinaten); erst nur Reifen-Materialien (genauer Winkel), sonst ganze Räder nach Namen
    function collect(strict) {
    tireP = [];
    meshes.forEach(function (o) {
      var mats = [].concat(o.material), g = o.geometry, pos = g.attributes.position, M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      var groups = g.groups && g.groups.length ? g.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
      var idx = triIndex(g);
      var byNode = !strict && wheelNode(o, obj);
      groups.forEach(function (gr) {
        var mm = mats[gr.materialIndex || 0] || mats[0];
        if (!byNode && !(strict ? isTire(mm) : isWheelMat(mm))) return;
        var end = Math.min(idx.length, gr.start + gr.count), step = Math.max(1, Math.floor((end - gr.start) / 6000));
        for (var i = gr.start; i < end; i += step) {
          v.fromBufferAttribute(pos, idx[i]).applyMatrix4(M);
          if (v.y - box.min.y < size.y * 0.5) tireP.push(v.clone());   // nur untere Hälfte: Fenstergummis u. Ä. aus demselben Material raus
        }
      });
    });
    }
    function quads() {
      var q = {};
      tireP.forEach(function (p) {
        var l = lx ? p.x - ctr.x : p.z - ctr.z, w = lx ? p.z - ctr.z : p.x - ctr.x, k = (l > 0 ? 'a' : 'b') + (w > 0 ? 'r' : 'l');
        (q[k] = q[k] || []).push(p);
      });
      return Object.keys(q).filter(function (k) { return q[k].length >= 10; }).length;
    }
    collect(true);
    if (tireP.length < 40 || quads() < 4) collect(false);
    if (tireP.length < 40) return [];
    // vier Gruppen: vorn/hinten × links/rechts (um die Mitte des Autos)
    var Q = {};
    tireP.forEach(function (p) {
      var l = lx ? p.x - ctr.x : p.z - ctr.z, w = lx ? p.z - ctr.z : p.x - ctr.x, k = (l > 0 ? 'a' : 'b') + (w > 0 ? 'r' : 'l');
      (Q[k] = Q[k] || []).push(p);
    });
    var out = [];
    Object.keys(Q).forEach(function (k) {
      var pts = Q[k]; if (pts.length < 10) return;
      var b = new THREE.Box3().setFromPoints(pts), c = new THREE.Vector3(), s = new THREE.Vector3(); b.getCenter(c); b.getSize(s);
      // Achsrichtung: waagrechte Richtung mit der kleinsten Ausdehnung (2D-Hauptachsen der Reifenpunkte)
      var mx = 0, mz = 0; pts.forEach(function (p) { mx += p.x; mz += p.z; }); mx /= pts.length; mz /= pts.length;
      var sxx = 0, szz = 0, sxz = 0; pts.forEach(function (p) { var dx = p.x - mx, dz = p.z - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; });
      var ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);           // Richtung der größten Streuung (Radebene)
      var ax = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang));   // senkrecht dazu = Achse
      var R = s.y / 2, hw = 0;
      pts.forEach(function (p) { hw = Math.max(hw, Math.abs((p.x - c.x) * ax.x + (p.z - c.z) * ax.z)); });
      out.push({ key: k, center: new THREE.Vector3(mx, c.y, mz), axis: ax, radius: R, half: hw, front: k[0] });
    });
    if (out.length < 4) return [];
    // vorn = Seite mit dem größeren Radeinschlag bzw. die kürzere Überhang-Seite; Lenkwinkel je Rad
    var lenAx = lx ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), latAx = lx ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    out.forEach(function (w) {
      if (w.axis.dot(latAx) < 0) w.axis.negate();                 // Achse zeigt immer zur selben Seite
      w.steer = Math.atan2(w.axis.dot(lenAx), w.axis.dot(latAx)); // 0 = gerade, Vorzeichen = Lenkrichtung
      // Drehung um y, die die Achse auf die Querachse legt
      w.fix = Math.atan2(new THREE.Vector3().crossVectors(w.axis, latAx).y, w.axis.dot(latAx));
    });
    // Dreiecke im Radzylinder herauslösen
    var groupsOut = out.map(function (w) {
      var pivot = new THREE.Group(); pivot.name = 'Wheel ' + w.key; pivot.position.copy(w.center); obj.add(pivot);
      return { w: w, pivot: pivot, parts: {} };
    });
    meshes.forEach(function (o) {
      var g = o.geometry, pos = g.attributes.position, mats = [].concat(o.material), idx = triIndex(g);
      var M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), keep = [], moved = false;
      var groups = g.groups && g.groups.length ? g.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
      var newGroups = [], A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), m = new THREE.Vector3();
      groups.forEach(function (gr) {
        var mat = mats[gr.materialIndex || 0] || mats[0], end = Math.min(idx.length, gr.start + gr.count), startKeep = keep.length;
        for (var i = gr.start; i < end; i += 3) {
          A.fromBufferAttribute(pos, idx[i]).applyMatrix4(M); B.fromBufferAttribute(pos, idx[i + 1]).applyMatrix4(M); C.fromBufferAttribute(pos, idx[i + 2]).applyMatrix4(M);
          m.copy(A).add(B).add(C).multiplyScalar(1 / 3);
          var hit = null;
          for (var q = 0; q < groupsOut.length && !hit; q++) {
            var w = groupsOut[q].w, d = m.clone().sub(w.center), along = d.dot(w.axis);
            var radial = d.clone().addScaledVector(w.axis, -along).length();
            if (Math.abs(along) <= w.half * 1.15 + 0.004 && radial <= w.radius * 1.01) hit = groupsOut[q];
          }
          if (!hit) { keep.push(idx[i], idx[i + 1], idx[i + 2]); continue; }
          moved = true;
          var key = mat.uuid, part = hit.parts[key] || (hit.parts[key] = { mat: mat, pos: [] });
          [A, B, C].forEach(function (P) { part.pos.push(P.x - hit.w.center.x, P.y - hit.w.center.y, P.z - hit.w.center.z); });
        }
        if (keep.length > startKeep) newGroups.push({ start: startKeep, count: keep.length - startKeep, materialIndex: gr.materialIndex || 0 });
      });
      if (!moved) return;
      var ng = g.clone(); ng.setIndex(keep); ng.clearGroups();
      if (Array.isArray(o.material)) newGroups.forEach(function (gr) { ng.addGroup(gr.start, gr.count, gr.materialIndex); });
      o.geometry = ng;
    });
    var res = [];
    groupsOut.forEach(function (h) {
      Object.keys(h.parts).forEach(function (k) {
        var p = h.parts[k], geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3)); geo.computeVertexNormals();
        var mesh = new THREE.Mesh(geo, p.mat); mesh.userData.wheelPart = true; h.pivot.add(mesh);
      });
      // gerade stellen
      h.pivot.rotation.y = 0;
      var inner = new THREE.Group(); while (h.pivot.children.length) inner.add(h.pivot.children[0]);
      inner.rotation.y = h.w.fix; h.pivot.add(inner);
      res.push({ pivot: h.pivot, front: h.w.front, side: h.w.key[1], radius: h.w.radius, steer: h.w.steer });
    });
    return res;
  }

  // ── Farben ──
  function rimMesh(o) {
    for (var p = o; p; p = p.parent) if (p.name && RIM.test(p.name) && !NOT_RIM.test(p.name)) return true;
    return !!o.userData.wheelPart;
  }
  function paintMats(obj) {
    var area = {}, list = {};
    obj.traverse(function (o) {
      if (!o.isMesh || rimMesh(o)) return;
      var mats = [].concat(o.material), g = o.geometry, idx = triIndex(g);
      var groups = g.groups && g.groups.length ? g.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
      groups.forEach(function (gr) { var m = mats[gr.materialIndex || 0] || mats[0]; if (!m) return; list[m.uuid] = m; area[m.uuid] = (area[m.uuid] || 0) + Math.min(gr.count, idx.length); });
    });
    var named = Object.keys(list).filter(function (k) { return PAINT.test(matName(list[k])) && !NOT_PAINT.test(matName(list[k])); });
    if (named.length) return named.map(function (k) { return list[k]; });
    // sonst: das flächengrößte Material, das farbig und nicht Glas/Gummi/Chrom/Schwarz ist
    var best = null;
    Object.keys(list).forEach(function (k) {
      var m = list[k], c = m.color, lum = c ? (c.r + c.g + c.b) / 3 : 0;
      var chroma = c ? Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) : 0;
      if (m.transparent || isTire(m) || isGlassName(m.name) || /chrome|black|interior|leather|plastic|rubber|metal|glass|light|lamp/i.test(matName(m)) || (lum < 0.04 && chroma < 0.03)) return;
      if (!best || area[k] > area[best]) best = k;
    });
    return best ? [list[best]] : [];
  }
  function remember(m) { if (!m.userData.orig) m.userData.orig = { color: m.color ? m.color.getHex() : null, map: m.map || null }; }
  function setColor(mats, hex) {
    mats.forEach(function (m) {
      remember(m);
      if (hex == null) { if (m.userData.orig.color != null) m.color.setHex(m.userData.orig.color); m.map = m.userData.orig.map; }
      else m.color.set(hex);   // mit Textur: färbt sie ein (Atlas-Modelle behalten Lampen und Details)
      m.needsUpdate = true;
    });
  }
  function setPaint(obj, hex) { setColor(obj.userData.paintMats || [], hex); }
  function setRims(obj, hex) { setColor(obj.userData.rimMats || [], hex); }
  function colours(obj) {
    var paint = paintMats(obj), rims = [];
    // Felgen: eigene Felgen-Materialien oder Lack-Stücke in den Rädern (dann eigenes Material, damit getrennt färbbar)
    (obj.userData.wheels || []).forEach(function (w) {
      w.pivot.traverse(function (o) {
        if (!o.isMesh) return;
        if (paint.indexOf(o.material) >= 0) {
          var rm = obj.userData.rimFromPaint || (obj.userData.rimFromPaint = o.material.clone());
          rm.name = 'rim (from paint)'; o.material = rm;
        }
      });
    });
    var seen = {};
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      var byName = rimMesh(o) && !o.userData.wheelPart;
      [].concat(o.material).forEach(function (m) {
        if (!m || seen[m.uuid] || isTire(m)) return;
        // Teile, die nach Namen Felgen sind (z. B. Knoten „rim001“), aber Lack-ähnliche Materialien haben
        if (isRimMat(m) || m === obj.userData.rimFromPaint || (byName && !NOT_RIM.test(matName(m)) && !/black|bolt|nut|emblem|logo|disc|brake|caliper/i.test(matName(m)))) { seen[m.uuid] = 1; rims.push(m); }
      });
    });
    obj.userData.paintMats = paint; obj.userData.rimMats = rims;
  }

  root.GlbFix = { prepare: prepare, setPaint: setPaint, setRims: setRims };
})(typeof window !== 'undefined' ? window : this);
