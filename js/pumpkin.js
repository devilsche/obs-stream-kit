/* Kürbis als Körper aus 10 Wülsten rund um die Stielachse, für das Herbst-
 * Thema und die Testseite tools/pumpkin-turn.html.
 *
 * Dreht er sich um die Achse (Winkel theta, 0 = Gesicht vorn), wandern die
 * Wülste: mittig breit und hell, zum Rand schmal und dunkler, hinten
 * verdeckt, auf der anderen Seite tauchen neue auf. Der Stiel dreht auf der
 * Stelle, seine gebogene Spitze schwingt zur Seite und wirkt verkürzt, wenn
 * sie nach vorn oder hinten zeigt. Glanz, Kontur und Schatten bleiben stehen
 * (das Licht dreht nicht mit). Das Gesicht sitzt auf dem vorderen Wulst.
 *
 *   var m = Pumpkin.build(bodyGroup);   // zeichnet in Körper-Koordinaten (Fuß 0/0)
 *   Pumpkin.pose(m, theta);             // Grad
 *   Pumpkin.turn(m, ms, from, done);    // dreht von `from` Grad nach 0
 */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var N = 10, RX = 41, RY = 31, CY = -30.5, FACE_R = 32;
  var STEM_AZ = 35;                      // Blickrichtung der Stielspitze in Ruhe (Grad)
  var FACE = 'M-20 -40 L-10 -40 L-15 -50 Z M10 -40 L20 -40 L15 -50 Z M-22 -22 L-15 -16 L-8 -22 L0 -16 L8 -22 L15 -16 L22 -22 Q0 -4 -22 -22 Z';

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function f1(v) { return (Math.round(v * 10) / 10).toString(); }
  var RAD = Math.PI / 180;

  // Aufbau: Glühen, Kontur, Wülste, Glanz, Tiefenschleier, Schneehaube, Stiel, Gesicht.
  // opts.shade: Deckkraft des dunklen Schleiers (hintere Kürbisse), opts.cap: Schneehaube
  function build(body, opts) {
    opts = opts || {};
    el('ellipse', { 'class': 'ta-pk-light', cx: 0, cy: -30, rx: 56, ry: 40 }, body);
    // dunkle Kontur: die Silhouette dahinter, nur ihr Rand bleibt sichtbar
    [[-18, -30, 24, 30], [18, -30, 24, 30], [0, -31, 22, 31]].forEach(function (e) {
      el('ellipse', { 'class': 'ta-pk-edge', cx: e[0], cy: e[1], rx: e[2], ry: e[3] }, body);
    });
    var gLobes = el('g', {}, body), lobes = [];
    for (var i = 0; i < N; i++) {
      var g = el('g', {}, gLobes);
      lobes.push({ g: g, az: i * 360 / N,
                   base: el('path', { 'class': 'ta-pk-body ta-pk-seg' }, g),
                   top: el('path', { 'class': 'ta-pk-lobe' }, g) });
    }
    el('ellipse', { 'class': 'ta-pk-sheen', cx: -22, cy: -42, rx: 7, ry: 13, transform: 'rotate(-18 -22 -42)' }, body);
    if (opts.shade) el('ellipse', { 'class': 'ta-pk-shade', cx: 0, cy: -30, rx: 43, ry: 31, 'fill-opacity': opts.shade.toFixed(2) }, body);
    if (opts.cap) el('path', { 'class': 'ts-cap', d: 'M-40 -45 Q-37 -64 -18 -63 Q0 -68 18 -63 Q37 -64 40 -45 Q20 -54 0 -52 Q-20 -54 -40 -45 Z' }, body);
    var m = { gLobes: gLobes, lobes: lobes,
              stem: el('path', { 'class': 'ta-pk-stem' }, body),
              face: el('path', { 'class': 'ta-pk-face', d: FACE }, body), theta: null };
    pose(m, 0);
    return m;
  }

  // Furchen sind Längenlinien wie auf einem Globus: alle laufen oben in der
  // Mulde am Stiel (TOP) und unten am Blütenansatz (BOT) zusammen, dazwischen
  // wölbt sich der Wulst. Eine Längenlinie bei Azimut a liegt in der Mitte bei
  // x = RX·sin(a); außen liegende Linien steigen an der Schulter etwas über die Mulde
  var TOP = -56.5, BOT = -1.5;
  function merDown(x) {
    var d = 4.5 * Math.abs(x) / RX;
    return ' C' + f1(x * 0.55) + ' ' + f1(TOP - d) + ' ' + f1(x) + ' ' + f1(CY - RY * 0.6) + ' ' + f1(x) + ' ' + f1(CY) +
           ' C' + f1(x) + ' ' + f1(CY + RY * 0.6) + ' ' + f1(x * 0.6) + ' ' + f1(BOT + 1) + ' 0 ' + BOT;
  }
  function merUp(x) {
    var d = 4.5 * Math.abs(x) / RX;
    return ' C' + f1(x * 0.6) + ' ' + f1(BOT + 1) + ' ' + f1(x) + ' ' + f1(CY + RY * 0.6) + ' ' + f1(x) + ' ' + f1(CY) +
           ' C' + f1(x) + ' ' + f1(CY - RY * 0.6) + ' ' + f1(x * 0.55) + ' ' + f1(TOP - d) + ' 0 ' + TOP;
  }
  function segment(x0, x1) { return 'M0 ' + TOP + merDown(x0) + merUp(x1) + ' Z'; }

  // Wulst bei Azimut a (0 = vorn): zwischen den Furchen a ± 18°, auf die
  // Bildebene projiziert; vorn hell, zum Rand dunkler, hinten verdeckt
  function pose(m, theta) {
    if (m.theta !== null && Math.abs(theta - m.theta) < 0.05) return;
    m.theta = theta;
    var half = 180 / N, order = [];
    m.lobes.forEach(function (L) {
      var a = L.az + theta, c = Math.cos(a * RAD);
      if (c < -0.25) { L.g.setAttribute('visibility', 'hidden'); return; }
      L.g.removeAttribute('visibility');
      var lo = Math.max(-90, Math.min(90, normDeg(a - half))), hi = Math.max(-90, Math.min(90, normDeg(a + half)));
      if (hi < lo) hi = lo;
      // am Rand quillt der Wulst ein wenig über den Umriss: gibt die Buckel der Silhouette
      var bulge = 1 + 0.05 * Math.max(0, Math.sin(Math.abs(a) * RAD));
      var x0 = RX * Math.sin(lo * RAD) * (lo <= -89 ? bulge : 1), x1 = RX * Math.sin(hi * RAD) * (hi >= 89 ? bulge : 1);
      var face = Math.max(0, c);
      L.base.setAttribute('d', segment(x0, x1));
      // heller Kern in der Mitte des Wulsts, die Furchen bleiben dunkler
      L.top.setAttribute('d', segment(x0 + (x1 - x0) * 0.22, x0 + (x1 - x0) * 0.78));
      L.top.setAttribute('fill-opacity', (0.9 * Math.pow(face, 1.4)).toFixed(2));
      order.push([c, L.g]);
    });
    // hinten zuerst, vorn zuletzt
    order.sort(function (p, q) { return p[0] - q[0]; }).forEach(function (o) { m.gLobes.appendChild(o[1]); });
    // Stiel: Fuß fest in der Mitte, Spitze zeigt nach STEM_AZ + theta
    var b = (STEM_AZ + theta) * RAD, side = 7 * Math.sin(b), fwd = Math.cos(b);
    var tx = side, ty = -72 + 3 * fwd;
    m.stem.setAttribute('d', 'M-3.5 -58 Q' + f1(-4 + 0.3 * side) + ' -69 ' + f1(tx - 1.5) + ' ' + f1(ty - 1.5) +
      ' L' + f1(tx + 2.2) + ' ' + f1(ty + 2.5) + ' Q' + f1(3 + 0.4 * side) + ' -66 3.5 -58 Z');
    // Gesicht auf dem vorderen Wulst
    var ct = Math.cos(theta * RAD);
    if (ct <= 0.02) m.face.setAttribute('visibility', 'hidden');
    else {
      m.face.removeAttribute('visibility');
      m.face.setAttribute('transform', Math.abs(theta) < 0.05 ? '' :
        'translate(' + f1(FACE_R * Math.sin(theta * RAD)) + ' 0) scale(' + ct.toFixed(3) + ' 1)');
    }
  }
  function normDeg(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a; }

  // Drehung nach 0 (Gesicht vorn), weich an- und auslaufend
  function turn(m, ms, from, done) {
    var t0 = null;
    function step(now) {
      if (t0 === null) t0 = now;
      var p = Math.min(1, (now - t0) / ms), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      pose(m, from * (1 - e));
      if (p < 1) root.requestAnimationFrame(step);
      else if (done) done();
    }
    root.requestAnimationFrame(step);
  }

  root.Pumpkin = { build: build, pose: pose, turn: turn };
})(typeof window !== 'undefined' ? window : this);
