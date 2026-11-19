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
 *   opts.align: schräg abgestelltes Modell gerade drehen (nur Autos, ToyCars setzt es)
 *
 * Regressionsfälle (Prüfstand: Modell ohne Texturen durch GlbFix + ToyCars.prepare, Teile-Schlüssel und
 * Radgruppen aller Katalog-Autos vorher/nachher vergleichen):
 *   - ferrari-296-gt3: Auto im Original ~53° gedreht → align; Frontkamera zeigte 3/4-Ansicht
 *   - mitsubishi-lancer-evo-ix: Material „INT_Rubber“ galt als Reifen → Vorderräder schief/zu hoch (NOT_TIRE)
 *   - 2020-abt-sportline-audi-rs6, 1992-porsche-911-964-turbo-s, 2022-porsche-911-gt3-touring: Achsrichtung aus
 *     ganzen Rad-Netzen verrauscht (±4–42°, links/rechts gegensinnig) → galten als eingeschlagen und wurden
 *     verdreht „gerade gestellt“, vorn UND hinten (Gegenrad-Regel)
 *   - bmw-m3-competition: Skin-Netze → scripts/build_car_rain.py bake_skins (nicht hier)
 *   - 2020-ferrari-roma, SF90, GT3 Touring: COLOR_0-Alpha ≈ 0 → Carbon/Chrom/Scheiben schrieben Alpha 0 (dropMaskAlpha)
 *   - ~38 Autos mit KHR_materials_transmission (Lampengläser, Scheiben ohne Innenraum): r128 → fast unsichtbar
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
  // Plaketten aus Spiele-Exporten (SF90 Spider „BadgeA“: Pferd hinten, Schriftzug, Wappen) haben keine Alpha-
  // Maske: das Motiv steckt in der Normal-Map (Relief) bzw. als Farbe auf einer einheitlichen Grundfarbe, die
  // Fläche drumherum zeigt sonst einen grauen Rand. Maske: Normal-Map weicht von flach ab ODER Farbe weicht von der
  // Grundfarbe ab (1 px aufgeweitet) → alphaMap + alphaTest. Nur wenn die Grundfarbe ≥ 30 % des Bildes ausmacht.
  var DECAL = /badge|emblem|logo|decal|sticker/i;
  function cutMask(base, nrm, w, h) {
    var n = w * h, cnt = {}, best = null, i;
    for (i = 0; i < n; i++) { var q = (base[i * 4] >> 3) + ',' + (base[i * 4 + 1] >> 3) + ',' + (base[i * 4 + 2] >> 3); cnt[q] = (cnt[q] || 0) + 1; if (!best || cnt[q] > cnt[best]) best = q; }
    if (!best || cnt[best] < n * 0.3) return null;
    var bg = [0, 0, 0], bn = 0;
    for (i = 0; i < n; i++) if ((base[i * 4] >> 3) + ',' + (base[i * 4 + 1] >> 3) + ',' + (base[i * 4 + 2] >> 3) === best) { bg[0] += base[i * 4]; bg[1] += base[i * 4 + 1]; bg[2] += base[i * 4 + 2]; bn++; }
    bg = bg.map(function (x) { return x / bn; });
    var keep = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      var cd = Math.max(Math.abs(base[i * 4] - bg[0]), Math.abs(base[i * 4 + 1] - bg[1]), Math.abs(base[i * 4 + 2] - bg[2]));
      var dv = Math.max(Math.abs(nrm[i * 4] - 128), Math.abs(nrm[i * 4 + 1] - 128));
      keep[i] = cd > 12 || dv > 10 ? 1 : 0;
    }
    // nur Grundfarbe ausschneiden, die mit dem Bildrand verbunden ist (die Atlas-Fläche zwischen den Motiven):
    // dunkle Motivteile innerhalb eines Wappens (schwarzes Pferd im gelben Schild) bleiben stehen
    var cutAway = new Uint8Array(n), stack = [];
    function seed(j) { if (!keep[j] && !cutAway[j]) { cutAway[j] = 1; stack.push(j); } }
    for (i = 0; i < w; i++) { seed(i); seed((h - 1) * w + i); }
    for (i = 0; i < h; i++) { seed(i * w); seed(i * w + w - 1); }
    while (stack.length) {
      var j = stack.pop(), x0 = j % w;
      if (x0 > 0) seed(j - 1); if (x0 < w - 1) seed(j + 1); if (j >= w) seed(j - w); if (j < n - w) seed(j + w);
    }
    for (i = 0; i < n; i++) if (!cutAway[i]) keep[i] = 1;
    var out = new Uint8Array(n);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var k = 0;
      for (var dy = -1; dy <= 1 && !k; dy++) for (var dx = -1; dx <= 1 && !k; dx++) {
        var yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w && keep[yy * w + xx]) k = 1;
      }
      out[y * w + x] = k ? 255 : 0;
    }
    return out;
  }
  function decalCutout(m) {
    try {
      var img = m.map.image, nimg = m.normalMap.image; if (!img || !nimg || typeof document === 'undefined') return;
      var w = Math.min(img.width || 0, 1024), h = Math.min(img.height || 0, 1024); if (!w || !h) return;
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h; var g = cv.getContext('2d');
      g.drawImage(img, 0, 0, w, h); var base = g.getImageData(0, 0, w, h).data;
      g.clearRect(0, 0, w, h); g.drawImage(nimg, 0, 0, w, h); var nrm = g.getImageData(0, 0, w, h).data;
      var mask = cutMask(base, nrm, w, h); if (!mask) return;
      var id = g.createImageData(w, h);
      for (var i = 0; i < w * h; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = mask[i]; id.data[i * 4 + 3] = 255; }
      g.putImageData(id, 0, 0);
      var t = new THREE.CanvasTexture(cv), s = m.map;
      t.flipY = s.flipY; t.wrapS = s.wrapS; t.wrapT = s.wrapT; t.repeat.copy(s.repeat); t.offset.copy(s.offset);
      t.center.copy(s.center); t.rotation = s.rotation; t.matrixAutoUpdate = s.matrixAutoUpdate; if (!s.matrixAutoUpdate) t.matrix.copy(s.matrix);
      m.alphaMap = t; m.alphaTest = 0.5; m.transparent = false; m.depthWrite = true;
    } catch (e) { /* ohne Canvas (Node) oder fremde Bildquelle: Plakette bleibt wie sie ist */ }
  }
  function tinted(m) { var c = m.color; return !!c && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 0.25; }
  // Vertex-Farben mit Alpha (COLOR_0 als VEC4): three r128 multipliert das Alpha in die Deckkraft. Spiele-Exporte
  // (Ferrari Roma, SF90, GT3 Touring …) speichern dort eine Maske ≈ 0 → Teile schreiben Alpha 0, in OBS sieht man
  // durch Carbon, Chrom und Scheiben hindurch. Ist das Alpha im Mittel < 0,5, gilt es nicht als Deckkraft: nur RGB behalten
  function dropMaskAlpha(o) {
    var g = o.geometry, at = g && g.attributes && g.attributes.color;
    if (!at || at.itemSize !== 4 || !at.count) return;
    var max = !at.normalized || at.isInterleavedBufferAttribute ? 1 : ({ Uint8Array: 255, Uint16Array: 65535, Int8Array: 127, Int16Array: 32767 }[at.array.constructor.name] || 1);
    var sum = 0, n = 0, step = Math.max(1, Math.floor(at.count / 2000)), i;
    for (i = 0; i < at.count; i += step) { sum += at.getW(i) / max; n++; }
    if (sum / n >= 0.5) return;
    var Arr = at.isInterleavedBufferAttribute ? Float32Array : at.array.constructor, out = new Arr(at.count * 3);
    for (i = 0; i < at.count; i++) { out[i * 3] = at.getX(i); out[i * 3 + 1] = at.getY(i); out[i * 3 + 2] = at.getZ(i); }
    g.setAttribute('color', new THREE.BufferAttribute(out, 3, at.normalized));
  }
  function fixMaterial(m, inside) {
    if (!m || (DONE && DONE.has(m))) return;
    if (DONE) DONE.set(m, true);
    m.side = THREE.DoubleSide;
    // KHR_materials_transmission: three r128 rechnet Transmission nur als Deckkraft-Abzug (Alpha ≈ 1 − transmission
    // + Glanz) – Scheiben/Lampengläser mit transmission ≈ 1 wurden unsichtbar, in OBS (durchsichtige Browser-Quelle)
    // sogar Löcher. Darum: Transmission aus, stattdessen normale Teildeckkraft (transmission 1 → Deckkraft 0,4)
    if (m.transmission > 0) {
      var tr = m.transmission; m.transmission = 0;
      m.transparent = true; m.opacity = Math.min(m.opacity, Math.max(0.3, 1 - 0.6 * tr));
    }
    var see = m.transparent || m.opacity < 1 || (m.alphaTest > 0);
    // unsichtbare Hilfsflächen (Deckkraft fast 0, ohne Textur) ausblenden statt zu Glas zu machen
    if (m.opacity < 0.05 && !m.map) { m.visible = false; m.needsUpdate = true; return; }
    if (isLampName(m.name)) { if (see) m.depthWrite = false; m.needsUpdate = true; return; }
    if (isGlassName(m.name) || (see && !m.map)) {
      if (inside) {
        // mit Innenraum: getönt durchsichtig, Innenleben bleibt sichtbar
        // mindestens 0,3 Deckkraft: Glas mit Alpha 0,25 (Ferrari Roma) wirkte sonst wie gar keine Scheibe
        m.transparent = true; m.opacity = Math.max(0.3, Math.min(m.opacity < 1 ? m.opacity : 0.4, 0.45)); m.depthWrite = false; m.alphaTest = 0;
        if (!m.map && !tinted(m)) m.color.setRGB(0.12, 0.14, 0.17);   // farbiges Glas (RED_GLASS) behält seine Farbe
        m.metalness = 0.2; m.roughness = 0.03; if ('clearcoat' in m) m.clearcoat = 1; m.envMapIntensity = 1.6;
        if ('transmission' in m) m.transmission = 0;
        m.needsUpdate = true;
        return;
      }
      // ohne Innenraum: eigenes Glas-Material, dunkel getönt, glänzend, undurchsichtig
      m.transparent = false; m.opacity = 1; m.alphaTest = 0; m.depthWrite = true;
      if (!m.map && !tinted(m)) m.color.setRGB(GLASS[0], GLASS[1], GLASS[2]);
      m.metalness = 0.3; m.roughness = 0.04;
      if ('clearcoat' in m) m.clearcoat = 1;
      m.envMapIntensity = 1.5;
    } else if (see && m.map) {
      // Texturen mit Transparenz (Logos, Embleme, Aufkleber, Gitter): ausschneiden statt einfärben,
      // dann gibt es keine Sortierfehler und keinen dunklen Kasten ums Logo
      m.transparent = false; m.opacity = 1; m.alphaTest = 0.5; m.depthWrite = true;
    } else if (DECAL.test(m.name || '') && m.map && m.normalMap && !see) {
      decalCutout(m);
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
  // schräg abgestelltes Modell (z. B. Ferrari 296 GT3: Auto im Original ~53° gedreht) gerade drehen: Gierwinkel,
  // bei dem der Grundriss (xz-Hüllrechteck aller Punkte) am kleinsten ist. Nur bei deutlichem Gewinn (> 10 %
  // weniger Fläche und > 3°), damit gerade Modelle unverändert bleiben. Inhalt kommt in eine Gruppe „Yaw“
  // (Namen und Reihenfolge der Teile bleiben gleich → Teile-Schlüssel im Car editor ändern sich nicht).
  function align(obj) {
    obj.updateMatrixWorld(true);
    var inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(), P = [], v = new THREE.Vector3();
    obj.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      var p = o.geometry.attributes.position, M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), step = Math.max(1, Math.floor(p.count / 1500));
      for (var i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(M); P.push(v.x, v.z); }
    });
    if (P.length < 20) return 0;
    function area(d) {
      var a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (var i = 0; i < P.length; i += 2) {
        var x = P[i] * c + P[i + 1] * s, z = -P[i] * s + P[i + 1] * c;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      return (x1 - x0) * (z1 - z0);
    }
    var best = 0, bA = area(0), a0 = bA, d;
    for (d = 1; d < 90; d++) { var A = area(d); if (A < bA) { bA = A; best = d; } }
    for (d = best - 1; d <= best + 1; d += 0.1) { var A2 = area(d); if (A2 < bA) { bA = A2; best = d; } }
    if (best > 45) best -= 90;   // kleinste Drehung, Längsachse landet auf x oder z
    if (Math.abs(best) < 3 || bA > a0 * 0.9) return 0;
    var g = new THREE.Group(); g.name = 'Yaw';
    while (obj.children.length) g.add(obj.children[0]);
    g.rotation.y = best * Math.PI / 180; obj.add(g); obj.updateMatrixWorld(true);
    return best;
  }
  function prepare(obj, opts) {
    opts = opts || {};
    isolate(obj);
    if (opts.align) obj.userData.yaw = align(obj);
    var inside = false;
    obj.traverse(function (o) {
      if (o.isMesh) [].concat(o.material).forEach(function (m) { if (m && INTERIOR.test(m.name || '')) inside = true; });
      if (o.name && INTERIOR.test(o.name)) inside = true;
    });
    if (!inside && cabinShare(obj) >= 0.04) inside = true;
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      dropMaskAlpha(o);
      [].concat(o.material).forEach(function (m) { fixMaterial(m, inside); });
      // durchsichtige Scheiben nach dem Rest zeichnen
      if ([].concat(o.material).some(function (m) { return m && m.transparent; })) o.renderOrder = 2;
    });
    obj.userData.interior = inside;
    try { obj.userData.wheels = opts.wheels === false ? [] : wheels(obj, opts.straight !== false); } catch (e) { obj.userData.wheels = []; }
    try { colours(obj); } catch (e) { obj.userData.paintMats = []; obj.userData.rimMats = []; }
    return obj;
  }
  // ── Räder ──
  // Innenraum-Gummi (z. B. „INT_Rubber“ beim Lancer Evo IX: Fußmatten, Dichtungen im Motorraum) ist kein Reifen –
  // sonst landen die Vorderräder in der Kabine, stehen ~45° schräg und hängen zu hoch im Radkasten
  var TIRE = /tire|tyre|reifen|rubber|whitewall/i, NOT_TIRE = /trim|seal|strip|window|door|mat\b|pedal|interior|\bint_|_int\b/i;
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
  // straight: im Modell eingeschlagene Räder (mehr als ~2°) gerade stellen; sonst bleiben sie wie modelliert
  function wheels(obj, straight) {
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
    function clusters() {
      var len = lx ? size.x : size.z, gap = Math.max(0.02 * len, 1e-6), out = {};
      ['l', 'r'].forEach(function (side) {
        var pts = tireP.filter(function (p) { var w = lx ? p.z - ctr.z : p.x - ctr.x; return side === 'r' ? w > 0 : w <= 0; });
        pts.sort(function (a, b) { return (lx ? a.x - b.x : a.z - b.z); });
        var cur = [], n = 0;
        function flush() { if (cur.length >= 10) out[side + (n++)] = cur; cur = []; }
        pts.forEach(function (p, i) {
          if (i && (lx ? p.x - pts[i - 1].x : p.z - pts[i - 1].z) > gap) flush();
          cur.push(p);
        });
        flush();
      });
      return out;
    }
    function quads() { return Object.keys(clusters()).length; }
    collect(true);
    if (tireP.length < 40 || quads() < 4) collect(false);
    if (tireP.length < 40) return [];
    // Räder je Seite entlang der Länge an Lücken trennen: jede Achse einzeln (auch 6 oder 10 Räder bei Truck/Bus)
    var Q = clusters();
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
      out.push({ key: k, center: new THREE.Vector3(mx, c.y, mz), axis: ax, radius: R, half: hw });
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
      return { w: w, pivot: pivot, parts: {}, whole: [] };
    });
    // Gibt es eigene Rad-/Reifen-Netze, wird nur aus denen geschnitten (Karosserie bleibt ganz);
    // ganze Teile (mehr als 3 Netze) werden nicht zerschnitten, sondern komplett ans nächste Rad gehängt
    function isNamed(o) { return nameRim(o, obj) || wheelNode(o, obj) || [].concat(o.material).some(function (mm) { return isWheelMat(mm); }); }
    var anyNamed = meshes.some(isNamed), wholeMode = meshes.length > 3;
    meshes.forEach(function (o) {
      if (!wholeMode && anyNamed && !isNamed(o)) return;
      var g = o.geometry, pos = g.attributes.position, mats = [].concat(o.material), idx = triIndex(g);
      var srcRim = nameRim(o, obj);   // Felge nach Teilenamen (z. B. „M_Rim_Main“ mit Material „material“) – merken
      var M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), keep = [], moved = false;
      // nur Teile, die überwiegend im Rad liegen (oder Reifen/Felge heißen), werden zerschnitten – Karosserie,
      // Radkasten, Fahrwerk bleiben dran. Ausnahme: Modelle aus 1–3 Netzen (dort steckt das Rad in der Karosserie)
      var named = srcRim || wheelNode(o, obj) || mats.some(function (mm) { return isWheelMat(mm); });
      if (!named && meshes.length > 3) {
        var tot = 0, ins = 0, P = new THREE.Vector3(), Q = new THREE.Vector3(), S = new THREE.Vector3(), stepT = Math.max(3, Math.floor(idx.length / 3 / 1500) * 3);
        for (var ti = 0; ti + 2 < idx.length; ti += stepT) {
          P.fromBufferAttribute(pos, idx[ti]).applyMatrix4(M); Q.fromBufferAttribute(pos, idx[ti + 1]).applyMatrix4(M); S.fromBufferAttribute(pos, idx[ti + 2]).applyMatrix4(M);
          P.add(Q).add(S).multiplyScalar(1 / 3); tot++;
          for (var qq = 0; qq < groupsOut.length; qq++) {
            var ww = groupsOut[qq].w, dd = P.clone().sub(ww.center), al = dd.dot(ww.axis);
            if (Math.abs(al) <= ww.half * 1.02 + 0.004 && dd.addScaledVector(ww.axis, -al).length() <= ww.radius * 0.98) { ins++; break; }
          }
        }
        if (!tot || ins / tot < 0.6) return;
      }
      if (wholeMode) {
        // ganzes Teil ans nächste Rad (Mitte des Teils im Radbereich)
        var bb = new THREE.Box3().setFromObject(o), cc = new THREE.Vector3(); bb.getCenter(cc); cc.applyMatrix4(inv);
        var best = null, bd = Infinity;
        groupsOut.forEach(function (h) { var d = cc.distanceTo(h.w.center); if (d < bd) { bd = d; best = h; } });
        if (best && bd < best.w.radius * 1.6) { best.whole.push(o); if (srcRim) o.userData.rimByName = true; }
        return;
      }
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
            if (Math.abs(along) <= w.half * 1.02 + 0.004 && radial <= w.radius * 0.98) hit = groupsOut[q];   // eng: Haube/Kotflügel bleiben dran
          }
          if (!hit) { keep.push(idx[i], idx[i + 1], idx[i + 2]); continue; }
          moved = true;
          var key = mat.uuid + (srcRim ? ':rim' : ''), part = hit.parts[key] || (hit.parts[key] = { mat: mat, pos: [], attrs: {}, rim: srcRim });
          [A, B, C].forEach(function (P) { part.pos.push(P.x - hit.w.center.x, P.y - hit.w.center.y, P.z - hit.w.center.z); });
          // alle übrigen Daten mitnehmen (Normalen gedreht, UVs, Farben, Tangenten) – sonst greifen Texturen ins Leere
          var NM = new THREE.Matrix3().getNormalMatrix(M);
          Object.keys(g.attributes).forEach(function (an) {
            if (an === 'position') return;
            var at = g.attributes[an], arr = part.attrs[an] || (part.attrs[an] = { size: an === 'tangent' ? 4 : at.itemSize, norm: an === 'normal' || an === 'tangent' ? false : at.normalized,
              type: an === 'normal' || an === 'tangent' || at.isInterleavedBufferAttribute ? Float32Array : at.array.constructor, v: [] });
            for (var q = 0; q < 3; q++) {
              var vi = idx[i + q];
              if (an === 'normal') { var nv = new THREE.Vector3().fromBufferAttribute(at, vi).applyMatrix3(NM).normalize(); arr.v.push(nv.x, nv.y, nv.z); }
              else if (an === 'tangent') { var tv = new THREE.Vector3(at.getX(vi), at.getY(vi), at.getZ(vi)).applyMatrix3(NM).normalize(); arr.v.push(tv.x, tv.y, tv.z, at.itemSize > 3 ? at.getW(vi) : 1); }
              else for (var cc = 0; cc < at.itemSize; cc++) arr.v.push(at.isInterleavedBufferAttribute ? [at.getX, at.getY, at.getZ, at.getW][cc].call(at, vi) : at.array[vi * at.itemSize + cc]);
            }
          });
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
        geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
        Object.keys(p.attrs).forEach(function (an) {
          var a = p.attrs[an];
          if (a.v.length / a.size === p.pos.length / 3) geo.setAttribute(an, new THREE.BufferAttribute(new a.type(a.v), a.size, a.norm));
        });
        if (!geo.attributes.normal) geo.computeVertexNormals();
        var mesh = new THREE.Mesh(geo, p.mat); mesh.userData.wheelPart = true; if (p.rim) mesh.userData.rimByName = true; h.pivot.add(mesh);
      });
      // gerade stellen
      h.pivot.rotation.y = 0;
      var inner = new THREE.Group(); while (h.pivot.children.length) inner.add(h.pivot.children[0]);
      h.pivot.add(inner); obj.updateMatrixWorld(true);
      h.whole.forEach(function (o) { inner.attach(o); o.userData.wheelPart = true; });   // Weltlage bleibt
      // Rad auf die Querachse drehen, damit es sauber um die Spin-Achse dreht; nicht gerade stellen = die Drehung
      // außen wieder zurück (Rad bleibt sichtbar wie modelliert, dreht trotzdem um seine eigene Achse)
      // eingeschlagen nur, wenn das Gegenrad derselben Achse in dieselbe Richtung zeigt: echte Lenkung dreht beide
      // gleich, entgegengesetzte Winkel sind Messrauschen der Achsrichtung (ABT RS6: ganze Räder aus einem Netz,
      // alle vier ±4,5° → „gerade stellen“ verdrehte vorn UND hinten)
      var mate = null, md = Infinity;
      out.forEach(function (o2) {
        if (o2 === h.w || o2.key[0] === h.w.key[0]) return;
        var d = Math.abs(o2.center.dot(lenAx) - h.w.center.dot(lenAx)); if (d < md) { md = d; mate = o2; }
      });
      var turned = Math.abs(h.w.steer) > 0.035 && (!mate || (mate.steer * h.w.steer > 0 && Math.abs(mate.steer) > 0.035));
      // Rauschen über 2°: Rad gilt als gerade modelliert, dreht um die Querachse (sonst eiert es um die Schätzachse)
      if (Math.abs(h.w.steer) > 0.035 && !turned) h.w.fix = 0;
      inner.rotation.y = h.w.fix;
      var keep = new THREE.Group(); keep.name = 'Keep'; keep.rotation.y = straight && turned ? 0 : -h.w.fix;
      // Drehgruppe: dreht das Rad um seine Achse, pivot.rotation.y lenkt
      var spin = new THREE.Group(); spin.name = 'Spin'; spin.userData.ax = lx ? 'z' : 'x';
      spin.add(inner); keep.add(spin); h.pivot.add(keep);
      res.push({ pivot: h.pivot, side: h.w.key[0], radius: h.w.radius, steer: h.w.steer });
    });
    return res;
  }

  // ── Farben ──
  function nameRim(o, stop) {
    for (var p = o; p && p !== stop; p = p.parent) if (p.name && RIM.test(p.name) && !NOT_RIM.test(p.name)) return true;
    return false;
  }
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
      var byName = (rimMesh(o) && !o.userData.wheelPart) || !!o.userData.rimByName;
      [].concat(o.material).forEach(function (m) {
        if (!m || seen[m.uuid] || isTire(m)) return;
        // Teile, die nach Namen Felgen sind (z. B. Knoten „rim001“), aber Lack-ähnliche Materialien haben
        if (isRimMat(m) || m === obj.userData.rimFromPaint || (byName && !NOT_RIM.test(matName(m)) && !/black|bolt|nut|emblem|logo|disc|brake|caliper/i.test(matName(m)))) { seen[m.uuid] = 1; rims.push(m); }
      });
    });
    obj.userData.paintMats = paint; obj.userData.rimMats = rims;
  }

  root.GlbFix = { prepare: prepare, setPaint: setPaint, setRims: setRims, cutMask: cutMask };
})(typeof window !== 'undefined' ? window : this);
