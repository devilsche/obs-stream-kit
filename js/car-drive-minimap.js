/* Minimap für Car Drive (tools/car-drive.html): Streckenkarte im HUD (Canvas, Größe über CSS-Klassen).
 *
 *   CarDriveMinimap.create(canvas, { reduce }) → { setTrack(T), setMode(m), draw(now, me, others), dispose() }
 *   mode     'follow' = Ausschnitt ~260 m um das eigene Auto, in Fahrtrichtung gedreht (vorn = oben; bei reduzierter
 *            Bewegung Norden oben), Auto im unteren Drittel → die nächsten Kurven sind zu sehen;
 *            'track'  = ganze Strecke, Norden oben; 'off' = ausgeblendet (canvas.hidden)
 *   me       { x, z, yaw } eigenes Auto (Pfeil in Akzentfarbe), others = [{ x, z, real }] (real = andere Fahrer, heller
 *            als KI-Gegner)
 * Zeichnet höchstens ~30-mal je Sekunde. Farben aus den Theme-Tokens der Seite (--cd-accent, --cd-primary, --cd-text).
 * Strecke als Pfad in Weltkoordinaten (T.at alle ~4 m), Start/Ziel als Querstrich.
 */
(function (root) {
  'use strict';
  var VIEW = 260, MIN_DT = 33;

  function create(canvas, opts) {
    opts = opts || {};
    if (!canvas || !canvas.getContext) return null;
    var g = canvas.getContext('2d'), reduce = !!opts.reduce, mode = 'follow', T = null, path = null, box = null, start = null, last = 0, col = null;
    function colors() {
      var cs = root.getComputedStyle ? getComputedStyle(canvas) : null;
      function v(n, fb) { var s = cs ? cs.getPropertyValue(n).trim() : ''; return s || fb; }
      return { accent: v('--cd-accent', '#f2b705'), primary: v('--cd-primary', '#5e2a79'), text: v('--cd-text', '#ffffff') };
    }
    function setTrack(t) {
      T = t || null; path = null; box = null; start = null; col = null;
      if (!T) return;
      var n = Math.max(60, Math.round(T.len / 4)), p = new Path2D(), x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (var i = 0; i <= n; i++) {
        var a = T.at(i / n * T.len);
        if (i) p.lineTo(a.x, a.z); else p.moveTo(a.x, a.z);
        x0 = Math.min(x0, a.x); x1 = Math.max(x1, a.x); z0 = Math.min(z0, a.z); z1 = Math.max(z1, a.z);
      }
      p.closePath();
      var s = T.at(0), hw = T.width / 2 + 3;
      start = [s.x + s.nx * hw, s.z + s.nz * hw, s.x - s.nx * hw, s.z - s.nz * hw];
      path = p; box = { x0: x0, x1: x1, z0: z0, z1: z1 };
      last = 0;
    }
    function setMode(m) {
      mode = m === 'track' || m === 'off' ? m : 'follow';
      canvas.hidden = mode === 'off';
      canvas.setAttribute('data-mode', mode);
      last = 0;
    }
    function arrow(x, y, ang, s, fill, stroke) {
      g.save(); g.translate(x, y); g.rotate(ang);
      g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.7, s * 0.75); g.lineTo(0, s * 0.4); g.lineTo(-s * 0.7, s * 0.75); g.closePath();
      g.lineWidth = Math.max(1.5, s * 0.22); g.strokeStyle = stroke; g.stroke(); g.fillStyle = fill; g.fill();
      g.restore();
    }
    function draw(now, me, others) {
      if (mode === 'off' || !path || !me) return;
      if (now - last < MIN_DT) return;
      last = now;
      var dpr = Math.min(2, root.devicePixelRatio || 1), W = Math.round((canvas.clientWidth || 200) * dpr), H = Math.round((canvas.clientHeight || 200) * dpr);
      if (!W || !H) return;
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      if (!col) col = colors();
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
      var k, rot = 0, cx, cy, ox, oz, follow = mode === 'follow';
      if (follow) {
        k = Math.min(W, H) / VIEW; cx = W / 2; cy = H * 0.66; ox = me.x; oz = me.z;
        if (!reduce) rot = -(Math.PI / 2 - me.yaw);   // Fahrtrichtung (cos yaw, −sin yaw) nach oben
        g.save(); g.beginPath(); g.arc(W / 2, H / 2, Math.min(W, H) / 2 - dpr, 0, Math.PI * 2); g.clip();
      } else {
        var pad = 14 * dpr, bw = Math.max(1, box.x1 - box.x0), bh = Math.max(1, box.z1 - box.z0);
        k = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh); cx = W / 2; cy = H / 2; ox = (box.x0 + box.x1) / 2; oz = (box.z0 + box.z1) / 2;
      }
      g.save();
      // Welt → Karte: verschieben, drehen, skalieren
      g.translate(cx, cy); g.rotate(rot); g.scale(k, k); g.translate(-ox, -oz);
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = 'rgba(0, 0, 0, 0.55)'; g.lineWidth = Math.max(T.width + 4, 7 * dpr / k); g.stroke(path);
      g.strokeStyle = col.primary; g.lineWidth = Math.max(T.width, 4.5 * dpr / k); g.stroke(path);
      g.strokeStyle = 'rgba(255, 255, 255, 0.85)'; g.lineWidth = Math.max(0.8, 1.2 * dpr / k); g.stroke(path);
      // Start/Ziel
      g.strokeStyle = col.text; g.lineWidth = Math.max(1.5, 3 * dpr / k); g.lineCap = 'butt';
      g.beginPath(); g.moveTo(start[0], start[1]); g.lineTo(start[2], start[3]); g.stroke();
      g.restore();
      // Autos (Bildschirm-Koordinaten, damit Punkte/Pfeil gleich groß bleiben)
      var c = Math.cos(rot), s = Math.sin(rot);
      function scr(x, z) { var dx = (x - ox) * k, dz = (z - oz) * k; return [cx + dx * c - dz * s, cy + dx * s + dz * c]; }
      (others || []).forEach(function (o) {
        var q = scr(o.x, o.z);
        g.beginPath(); g.arc(q[0], q[1], (o.real ? 4 : 3.4) * dpr, 0, Math.PI * 2);
        g.fillStyle = o.real ? col.text : 'rgba(205, 205, 215, 0.85)'; g.fill();
        g.lineWidth = 1.2 * dpr; g.strokeStyle = 'rgba(0, 0, 0, 0.7)'; g.stroke();
      });
      var m = scr(me.x, me.z);
      arrow(m[0], m[1], Math.PI / 2 - me.yaw + rot, 8 * dpr, col.accent, 'rgba(0, 0, 0, 0.8)');
      if (follow) g.restore();
    }
    setMode(mode);
    return {
      setTrack: setTrack, setMode: setMode, draw: draw,
      mode: function () { return mode; },
      dispose: function () { setTrack(null); g.clearRect(0, 0, canvas.width, canvas.height); }
    };
  }
  root.CarDriveMinimap = { create: create, MODES: ['follow', 'track', 'off'] };
})(typeof window !== 'undefined' ? window : this);
