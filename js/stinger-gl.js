/* Gemeinsame Bausteine der WebGL-Stinger (transitions/stinger-warp.html, transitions/stinger-shards.html).
   Uhr ab Skriptstart (nicht ab Schriftladen, sonst käme die Abdeckung zu spät und der harte Schnitt wäre sichtbar),
   Zeiten aus der URL, Theme-Farben als RGB, Name als Textur (R = scharfer Text, G = weicher Schein). */
(function () {
  'use strict';
  var T0 = performance.now();
  var P = new URLSearchParams(location.search);

  function num(k, d, lo, hi) { var v = parseFloat(P.get(k)); return isNaN(v) ? d : Math.max(lo, Math.min(hi, v)); }

  // Dauer und Schnittpunkt in ms, müssen zu den OBS-Werten (Duration / Transition Point) passen
  function timing(defDur, defCut) {
    var dur = num('dur', defDur, 600, 8000), cut = num('cut', defCut, 300, dur - 300);
    return { dur: dur / 1000, cut: cut / 1000 };
  }

  // ?at=1.2 hält die Zeit an (Sekunden) – zum Prüfen einzelner Bilder
  var AT = parseFloat(P.get('at'));
  function now() { return isNaN(AT) ? (performance.now() - T0) / 1000 : AT; }

  var _ctx = document.createElement('canvas').getContext('2d');
  function rgb(c, fb) {
    _ctx.fillStyle = fb; _ctx.fillStyle = (c || '').trim() || fb;
    var s = _ctx.fillStyle;
    if (s.charAt(0) === '#') return [1, 3, 5].map(function (i) { return parseInt(s.slice(i, i + 2), 16) / 255; });
    var m = s.match(/[\d.]+/g) || [0, 0, 0];
    return [m[0] / 255, m[1] / 255, m[2] / 255];
  }

  function colors() {
    var cs = getComputedStyle(document.documentElement);
    function tok(n) { return cs.getPropertyValue(n); }
    return {
      primary: rgb(tok('--theme-primary'), '#5e2a79'),
      accent: rgb(tok('--theme-accent'), '#f2b705'),
      accent2: rgb(tok('--theme-accent-2'), '#c985ff'),
      bg: rgb(tok('--theme-bg'), '#08040f')
    };
  }

  // ?name= > Twitch-Kanal vom Server; Großbuchstaben in JS, ß bleibt ß
  function name() {
    var n = P.get('name') || window.__TWITCH_CHANNEL__ || '';
    return Array.from(n).map(function (c) { return c === 'ß' ? c : c.toUpperCase(); }).join('');
  }

  // ?font= > Dashboard-Setting > Theme-Schrift > Orbitron
  function font() {
    var f = P.get('font') || window.__STINGER_FONT__ || '';
    if (!f) f = (getComputedStyle(document.documentElement).getPropertyValue('--theme-stinger-font') || '').split(',')[0];
    f = f.replace(/["']/g, '').trim();
    return f || 'Orbitron';
  }

  /* Name als 2048×512-Bild: R = Schrift, G = weicher Schein drumherum. done(canvas) kommt, sobald die Schrift
     geladen ist (spätestens nach 700 ms mit Ersatzschrift). */
  function nameTexture(done) {
    var text = name(), fam = font(), W = 2048, H = 512;
    function draw() {
      var sharp = document.createElement('canvas'), soft = document.createElement('canvas'), out = document.createElement('canvas');
      [sharp, soft, out].forEach(function (c) { c.width = W; c.height = H; });
      var a = sharp.getContext('2d'), size = 300;
      a.font = '900 ' + size + 'px "' + fam + '", sans-serif';
      var w = a.measureText(text).width || 1;
      if (w > 1880) size = Math.floor(size * 1880 / w);
      [sharp, soft].forEach(function (c, i) {
        var x = c.getContext('2d');
        x.font = '900 ' + size + 'px "' + fam + '", sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
        if (i === 1) x.filter = 'blur(26px)';
        x.fillText(text, W / 2, H / 2 + size * 0.04);
        if (i === 1) x.fillText(text, W / 2, H / 2 + size * 0.04);
      });
      var A = sharp.getContext('2d').getImageData(0, 0, W, H).data, B = soft.getContext('2d').getImageData(0, 0, W, H).data;
      var o = out.getContext('2d'), img = o.createImageData(W, H), d = img.data;
      for (var i = 0; i < d.length; i += 4) { d[i] = A[i + 3]; d[i + 1] = Math.min(255, B[i + 3] * 1.6); d[i + 2] = 0; d[i + 3] = 255; }
      o.putImageData(img, 0, 0);
      done(out);
    }
    var fired = false;
    function once() { if (!fired) { fired = true; draw(); } }
    if (document.fonts && document.fonts.load) document.fonts.load('900 100px "' + fam + '"').then(once, once);
    setTimeout(once, 700);
    if (!document.fonts) once();
  }

  function reduced() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }

  // ohne WebGL: einfacher Abdeck-Fade per CSS (Klasse am <html>), damit der Schnitt trotzdem verdeckt ist
  function fallback() { document.documentElement.classList.add('stinger-no-gl'); }

  window.StingerGL = { timing: timing, now: now, colors: colors, name: name, font: font,
    nameTexture: nameTexture, reduced: reduced, fallback: fallback, param: function (k) { return P.get(k); } };
})();
