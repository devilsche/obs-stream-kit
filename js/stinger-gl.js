/* Gemeinsame Bausteine der WebGL-Stinger (transitions/stinger-warp.html, transitions/stinger-shards.html).
   Uhr ab Ladebeginn der Seite (performance.now() = 0 = Navigationsstart): OBS startet den Übergang, wenn es die
   Seite neu lädt (restart_when_active) – die Ladezeit zählt also schon mit, sonst käme die Abdeckung zu spät und
   OBS schaltet sichtbar vor den Würfeln um. Bleibt die Seite geladen (restart_when_active aus), startet die Uhr beim
   Aktivwerden der Quelle neu (obsSourceActiveChanged).
   Zeiten aus der URL, Theme-Farben als RGB, Name als Textur (R = scharfer Text, G = weicher Schein). */
(function () {
  'use strict';
  var T0 = 0, running = false, restart = null;
  window.addEventListener('obsSourceActiveChanged', function (e) {
    // nur wenn die Seite schon länger bereitliegt – frisch geladen zählt der Ladebeginn
    if (e && e.detail && e.detail.active && performance.now() > 1500) { T0 = performance.now(); if (restart) restart(); }
  });
  var P = new URLSearchParams(location.search);

  function num(k, d, lo, hi) { var v = parseFloat(P.get(k)); return isNaN(v) ? d : Math.max(lo, Math.min(hi, v)); }

  /* Zeiten in ms aus der URL: cut = Bild zu (Transition Point in OBS), hold = so lange bleibt es danach zu,
     dur = Dauer des Öffnens danach. In OBS: Duration = cut + hold + dur, Transition Point = cut.
     Ergebnis in s: cut, open (= cut + hold, ab da öffnet es), dur (= Gesamtdauer). */
  function timing(defOpen, defCut) {
    var cut = num('cut', defCut, 300, 5000), hold = num('hold', 0, 0, 5000), op = num('dur', defOpen, 300, 5000);
    return { cut: cut / 1000, open: (cut + hold) / 1000, dur: (cut + hold + op) / 1000 };
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

  /* Bild in der Mitte (Name, Logo oder nichts): 2048×2048-Textur, obere Hälfte = Bild in Farbe (RGBA),
     untere Hälfte = weicher Schein drumherum (Grauwert). Auf dem Schirm liegt es in einem 1600×800-Feld in der Mitte.
     ?show=name|logo|none (Standard name); logo = eines aus dem Logo-Pool window.__STINGER_LOGOS__ (bis zu 10 Uploads im
     Dashboard), ?logos=<id>,<id> = Auswahl dieses Stingers (leer = alle): bei jedem Übergang per Zufall, nie zweimal
     dasselbe hintereinander. Ohne Upload der Name.
     done(canvas) kommt, sobald Schrift oder Bild geladen sind (Schrift spätestens nach 700 ms mit Ersatz). */
  var AW = 2048, AH = 1024;
  var _logo;
  function logoUrl() {
    if (_logo !== undefined) return _logo;
    var all = (window.__STINGER_LOGOS__ || []).filter(function (e) { return e && e.url; });
    var want = (P.get('logos') || '').split(',').filter(Boolean), last = null, i;
    var L = all.filter(function (e) { return !want.length || want.indexOf(e.id) >= 0; });
    if (!L.length) L = all;   // Auswahl leer oder gelöscht: ganzer Pool
    L = L.map(function (e) { return e.url; });
    if (!L.length) return (_logo = null);
    try { last = localStorage.getItem('stinger-logo-last'); } catch (e) { /* ohne Speicher eben reiner Zufall */ }
    i = Math.floor(Math.random() * L.length);
    if (L.length > 1 && L[i] === last) i = (i + 1 + Math.floor(Math.random() * (L.length - 1))) % L.length;
    try { localStorage.setItem('stinger-logo-last', L[i]); } catch (e) { /* egal */ }
    return (_logo = L[i]);
  }
  function show() {
    var s = P.get('show') || 'name';
    if (s === 'logo' && !logoUrl()) s = 'name';
    if (s === 'name' && !name()) s = 'none';
    return s;
  }
  function pack(art, done) {
    var soft = document.createElement('canvas'), out = document.createElement('canvas');
    soft.width = AW; soft.height = AH; out.width = AW; out.height = AH * 2;
    var x = soft.getContext('2d');
    x.filter = 'blur(26px)'; x.drawImage(art, 0, 0); x.drawImage(art, 0, 0);
    var o = out.getContext('2d');
    o.drawImage(art, 0, 0);
    var B = x.getImageData(0, 0, AW, AH).data, img = o.createImageData(AW, AH), d = img.data;
    for (var i = 0; i < d.length; i += 4) { var v = Math.min(255, B[i + 3] * 1.6); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    o.putImageData(img, 0, AH);
    done(out);
  }
  function artTexture(C, done) {
    var mode = show();
    if (mode === 'none') return;
    var art = document.createElement('canvas'); art.width = AW; art.height = AH;
    var a = art.getContext('2d');
    if (mode === 'logo') {
      var im = new Image();
      im.onload = function () {
        var k = Math.min((AW - 96) / im.naturalWidth, (AH - 96) / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
        a.drawImage(im, (AW - w) / 2, (AH - h) / 2, w, h);
        pack(art, done);
      };
      im.onerror = function () { console.error('stinger: logo not loaded'); };
      im.src = logoUrl();
      return;
    }
    var text = name(), fam = font();
    function draw() {
      var size = 300;
      a.font = '900 ' + size + 'px "' + fam + '", sans-serif';
      var w = a.measureText(text).width || 1;
      if (w > 1880) size = Math.floor(size * 1880 / w);
      a.font = '900 ' + size + 'px "' + fam + '", sans-serif';
      a.textAlign = 'center'; a.textBaseline = 'middle';
      var f = C.accent.map(function (v) { return Math.round((1 + (v - 1) * 0.28) * 255); });   // Akzent → fast Weiß
      a.fillStyle = 'rgb(' + f.join(',') + ')';
      a.fillText(text, AW / 2, AH / 2 + size * 0.04);
      pack(art, done);
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


  /* three.js-Bühne: Wand bei z = 0 füllt 1920×1080 genau (Kamera-Abstand aus dem Blickwinkel). Gibt null ohne WebGL. */
  function threeStage(canvas) {
    var W = 1920, H = 1080, r;
    try { r = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true }); } catch (e) { return null; }
    r.setPixelRatio(1); r.setSize(W, H, false); r.setClearColor(0x000000, 0);
    var cam = new THREE.PerspectiveCamera(30, W / H, 10, 12000);
    cam.position.z = (H / 2) / Math.tan(15 * Math.PI / 180);
    return { renderer: r, scene: new THREE.Scene(), cam: cam, W: W, H: H };
  }

  // Theme-Farben + Name-Textur als three-Uniforms (uP, uA, uA2, uBg, uTex, uHasText, uT, uCut, uOpen, uDur, uCalm)
  function threeUniforms(T, C) {
    function v3(c) { return new THREE.Vector3(c[0], c[1], c[2]); }
    var tex = new THREE.Texture(); tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = false;
    var U = {
      uT: { value: 0 }, uCut: { value: T.cut }, uOpen: { value: T.open }, uDur: { value: T.dur }, uCalm: { value: reduced() ? 1 : 0 },
      uP: { value: v3(C.primary) }, uA: { value: v3(C.accent) }, uA2: { value: v3(C.accent2) }, uBg: { value: v3(C.bg) },
      uTex: { value: tex }, uHasText: { value: 0 }
    };
    artTexture(C, function (cv) { tex.image = cv; tex.needsUpdate = true; U.uHasText.value = 1; });
    return U;
  }

  // Bildschleife bis Ende + 0,1 s, danach leer (OBS zeigt sonst das letzte Bild weiter)
  function run(stage, U, T, each) {
    function frame() {
      var t = now();
      U.uT.value = t;
      if (each) each(t);
      stage.renderer.render(stage.scene, stage.cam);
      if (t < T.dur + 0.1) requestAnimationFrame(frame);
      else { stage.renderer.clear(); running = false; }
    }
    restart = function () { if (!running) { running = true; frame(); } };
    running = true; frame();
  }

  // GLSL-Bausteine: Rauschen, Drehmatrix, Name (tp = Bildschirm-UV → Textur, Textrechteck 1500×375 in der Mitte)
  var GLSL = [
    'float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
    '  return mix(mix(h1(i), h1(i+vec2(1,0)), f.x), mix(h1(i+vec2(0,1)), h1(i+vec2(1,1)), f.x), f.y); }',
    'mat3 rot(vec3 ax, float an){ ax = normalize(ax); float s = sin(an), c = cos(an), o = 1.0 - c;',
    '  return mat3(o*ax.x*ax.x + c, o*ax.x*ax.y + ax.z*s, o*ax.z*ax.x - ax.y*s,',
    '              o*ax.x*ax.y - ax.z*s, o*ax.y*ax.y + c, o*ax.y*ax.z + ax.x*s,',
    '              o*ax.z*ax.x + ax.y*s, o*ax.y*ax.z - ax.x*s, o*ax.z*ax.z + c); }',
    // tp: 0..1 im 1600×800-Feld, y nach unten; artAt = Bild (RGBA), glowAt = Schein
    'vec4 artAt(sampler2D tx, vec2 tp){ if (tp.x < 0.0 || tp.x > 1.0 || tp.y < 0.0 || tp.y > 1.0) return vec4(0.0);',
    '  return texture2D(tx, vec2(tp.x, clamp(tp.y, 0.002, 0.998) * 0.5)); }',
    'float glowAt(sampler2D tx, vec2 tp){ if (tp.x < 0.0 || tp.x > 1.0 || tp.y < 0.0 || tp.y > 1.0) return 0.0;',
    '  return texture2D(tx, vec2(tp.x, 0.5 + clamp(tp.y, 0.002, 0.998) * 0.5)).r; }',
    // Bildschirm-UV (y nach oben) → tp
    'vec2 artUv(vec2 uv){ vec2 tp = (uv - 0.5) * vec2(1920.0, 1080.0) / vec2(1600.0, 800.0); tp.y = -tp.y; return tp + 0.5; }'
  ].join('\n');

  window.StingerGL = { timing: timing, now: now, colors: colors, name: name, font: font,
    artTexture: artTexture, show: show, reduced: reduced, fallback: fallback,
    threeStage: threeStage, threeUniforms: threeUniforms, run: run, GLSL: GLSL, param: function (k) { return P.get(k); } };
})();
