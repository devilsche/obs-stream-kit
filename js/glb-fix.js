/* Aufbereitung geladener Sketchfab-Modelle (GLTFLoader, three r128) für Regen, Übersicht und Mockups:
 * - alle Materialien beidseitig (manche Modelle haben gedrehte Flächen → fehlende Scheiben)
 * - Glas (Materialname enthält „glass“/„glas“ oder halbtransparent ohne Textur) wird dunkles, getöntes,
 *   undurchsichtiges Glas
 * - Atlas-Texturen mit Transparenz (z. B. Scheiben als durchsichtige Stellen): durchsichtige Pixel werden zu
 *   dunklem Glas, das Material undurchsichtig (sonst sieht man durchs Auto bzw. Sortierfehler)
 *
 * - hat das Modell einen Innenraum (Materialnamen wie leather, seat, interior, dashboard, steering …),
 *   bleiben die Scheiben getönt durchsichtig, sonst dunkel undurchsichtig (sonst sähe man ins Leere)
 *
 *   GlbFix.prepare(root) → root (Materialien werden in place angepasst), root.userData.interior = true/false
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  var GLASS = [0.05, 0.065, 0.08];
  var DONE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  // Pixel mit Alpha < 1 zu dunklem Glas mischen, Alpha voll
  function opaqueTexture(tex) {
    var img = tex && tex.image;
    if (!img || !img.width) return tex;
    var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    var x = c.getContext('2d'); x.drawImage(img, 0, 0);
    var d;
    try { d = x.getImageData(0, 0, c.width, c.height); } catch (e) { return tex; }
    var p = d.data, g0 = GLASS[0] * 255, g1 = GLASS[1] * 255, g2 = GLASS[2] * 255;
    for (var i = 0; i < p.length; i += 4) {
      var a = p[i + 3] / 255;
      if (a < 0.98) {
        // je durchsichtiger, desto mehr Glas; leicht spiegelnd heller als Schwarz
        var k = Math.min(1, (1 - a) * 1.4);
        p[i] = p[i] * (1 - k) + g0 * k; p[i + 1] = p[i + 1] * (1 - k) + g1 * k; p[i + 2] = p[i + 2] * (1 - k) + g2 * k;
        p[i + 3] = 255;
      }
    }
    x.putImageData(d, 0, 0);
    var t = new THREE.CanvasTexture(c);
    t.flipY = tex.flipY; t.encoding = tex.encoding; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
    t.repeat.copy(tex.repeat); t.offset.copy(tex.offset); t.anisotropy = 4;
    return t;
  }
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
      m.map = opaqueTexture(m.map);
      m.transparent = false; m.opacity = 1; m.alphaTest = 0; m.depthWrite = true;
    }
    m.needsUpdate = true;
  }
  function prepare(obj) {
    var inside = false;
    obj.traverse(function (o) {
      if (o.isMesh) [].concat(o.material).forEach(function (m) { if (m && INTERIOR.test(m.name || '')) inside = true; });
      if (o.name && INTERIOR.test(o.name)) inside = true;
    });
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      [].concat(o.material).forEach(function (m) { fixMaterial(m, inside); });
      // durchsichtige Scheiben nach dem Rest zeichnen
      if ([].concat(o.material).some(function (m) { return m && m.transparent; })) o.renderOrder = 2;
    });
    obj.userData.interior = inside;
    return obj;
  }
  root.GlbFix = { prepare: prepare };
})(typeof window !== 'undefined' ? window : this);
