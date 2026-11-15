/* Bühne für Vollbild-Szenen mit Gummienten (effects/duck-assembly.html, effects/duck-court.html):
 * Renderer 1920×1080 mit Licht und Spiegel-Umgebung, Enten aus js/rubber-duck.js auf dem Boden (y = 0),
 * Namensschilder und Sprechblasen als Sprites (Canvas), Watscheln, Holz-Textur und Töne per WebAudio
 * (Hammerschlag, Gemurmel, Quaken, Pfiff – ohne Sounddateien).
 *
 *   var S = DuckStage.create({ canvas, volume });
 *   S.duck(outfit) → Gruppe (Ente sitzt auf dem Boden, schaut nach +x); S.face(obj, dx, dz)
 *   S.tag(text) / S.bubble(text) → Sprite; S.wood(w, h, hex) → Textur; S.sfx.gavel() …
 *   S.run(TOTAL, function (t, real) { … }, { freeze })   // blendet am Anfang/Ende weich ein/aus
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, RD = root.RubberDuck;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function ease(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // Zahl aus dem Namen (für gleichbleibende Zufallswerte je Ente)
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

  function envMap(renderer) {
    var c = document.createElement('canvas'); c.width = 512; c.height = 256;
    var x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#c9d2dc'); g.addColorStop(0.55, '#6a7280'); g.addColorStop(1, '#25282e');
    x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    var tex = new THREE.CanvasTexture(c); tex.mapping = THREE.EquirectangularReflectionMapping; tex.encoding = THREE.sRGBEncoding;
    var pm = new THREE.PMREMGenerator(renderer), t = pm.fromEquirectangular(tex).texture; pm.dispose();
    return t;
  }
  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  function roundRect(x, X, Y, W, H, r) {
    x.beginPath(); x.moveTo(X + r, Y); x.lineTo(X + W - r, Y); x.quadraticCurveTo(X + W, Y, X + W, Y + r); x.lineTo(X + W, Y + H - r);
    x.quadraticCurveTo(X + W, Y + H, X + W - r, Y + H); x.lineTo(X + r, Y + H); x.quadraticCurveTo(X, Y + H, X, Y + H - r); x.lineTo(X, Y + r); x.quadraticCurveTo(X, Y, X + r, Y); x.closePath();
  }
  var FONT = '"DM Sans", "Segoe UI", Arial, sans-serif';
  // Schriftgröße so, dass der Text in die Breite passt
  function fitFont(x, text, weight, size, maxW) {
    x.font = weight + ' ' + size + 'px ' + FONT;
    var w = x.measureText(text).width;
    if (w > maxW) { size = Math.max(16, Math.floor(size * maxW / w)); x.font = weight + ' ' + size + 'px ' + FONT; }
    return size;
  }
  // Namensschild: lila Plakette, goldener Rand, weißer Name
  function tag(text, opts) {
    opts = opts || {};
    var W = 640, H = 128, t = String(text || '').slice(0, 25);
    var tex = canvasTex(W, H, function (x) {
      x.fillStyle = opts.bg || 'rgba(58, 22, 78, 0.92)'; roundRect(x, 6, 6, W - 12, H - 12, 40); x.fill();
      x.lineWidth = 6; x.strokeStyle = opts.line || '#f2b705'; x.stroke();
      x.fillStyle = opts.color || '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
      fitFont(x, t, '700', 64, W - 80); x.fillText(t, W / 2, H / 2 + 3);
    });
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    var k = opts.size || 1.6; s.scale.set(k * W / H * 0.5, k * 0.5, 1); s.renderOrder = 5;
    return s;
  }
  // Sprechblase: weiß, Zipfel unten links, Text in bis zu zwei Zeilen
  function bubble(text, opts) {
    opts = opts || {};
    var W = 1024, H = 420, lines = wrap(String(text || ''), 26).slice(0, 3);
    var tex = canvasTex(W, H, function (x) {
      x.fillStyle = '#ffffff'; x.strokeStyle = '#1d2433'; x.lineWidth = 10;
      roundRect(x, 10, 10, W - 20, H - 110, 90); x.fill(); x.stroke();
      x.beginPath(); x.moveTo(230, H - 104); x.lineTo(190, H - 14); x.lineTo(330, H - 104); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(230, H - 100); x.lineTo(190, H - 14); x.lineTo(330, H - 100); x.stroke();
      x.fillStyle = opts.color || '#1d2433'; x.textAlign = 'center'; x.textBaseline = 'middle';
      var size = 96, top = (H - 100) / 2 - (lines.length - 1) * 52;
      lines.forEach(function (l) { size = Math.min(size, fitFont(x, l, '800', 96, W - 140)); });
      x.font = '800 ' + size + 'px ' + FONT;
      lines.forEach(function (l, i) { x.fillText(l, W / 2, top + i * 104); });
    });
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    var k = opts.size || 3; s.scale.set(k * W / H, k, 1); s.renderOrder = 6;
    s.center.set(0.2, 0.02);
    return s;
  }
  function wrap(text, n) {
    var words = text.split(/\s+/), out = [], cur = '';
    words.forEach(function (w) { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
    if (cur) out.push(cur);
    return out.length ? out : [''];
  }
  // Holz: Bretter mit Maserung
  function wood(w, h, hex, boards) {
    var base = '#' + ('000000' + (hex || 0x6b4426).toString(16)).slice(-6);
    var t = canvasTex(512, 512, function (x) {
      x.fillStyle = base; x.fillRect(0, 0, 512, 512);
      var n = boards || 8;
      for (var b = 0; b < n; b++) {
        var y0 = b * 512 / n;
        x.fillStyle = 'rgba(0,0,0,' + (0.06 + (b % 3) * 0.04) + ')'; x.fillRect(0, y0, 512, 512 / n);
        for (var k = 0; k < 14; k++) { x.strokeStyle = 'rgba(30,15,5,' + (0.08 + hash(b + ':' + k) * 0.12) + ')'; x.lineWidth = 1 + hash(k + '/' + b) * 2; x.beginPath(); var yy = y0 + hash(b + '-' + k) * 512 / n; x.moveTo(0, yy); x.bezierCurveTo(170, yy + 6, 340, yy - 6, 512, yy + 2); x.stroke(); }
        x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, y0, 512, 3);
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w || 1, h || 1);
    return t;
  }

  // ── Töne (WebAudio, ohne Dateien) ──
  function makeSfx(volume) {
    var AC = root.AudioContext || root.webkitAudioContext, ctx = null, master = null;
    function ac() {
      if (!AC || volume <= 0) return null;
      if (!ctx) { try { ctx = new AC(); master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination); } catch (e) { ctx = null; } }
      if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
      return ctx;
    }
    function noiseBuf(c, sec) {
      var b = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate), d = b.getChannelData(0), last = 0;
      for (var i = 0; i < d.length; i++) { var w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      return b;
    }
    function env(c, g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
    return {
      // Holzhammer: tiefer Schlag und heller Klack
      gavel: function () {
        var c = ac(); if (!c) return; var t = c.currentTime;
        var o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
        env(c, g, t, 0.004, 1.0, 0.3); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4);
        var n = c.createBufferSource(), f = c.createBiquadFilter(), g2 = c.createGain(); n.buffer = noiseBuf(c, 0.1);
        f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.2; env(c, g2, t, 0.002, 0.9, 0.06);
        n.connect(f); f.connect(g2); g2.connect(master); n.start(t);
      },
      // Gemurmel im Saal
      murmur: function (sec) {
        var c = ac(); if (!c) return; var t = c.currentTime;
        var n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
        n.buffer = noiseBuf(c, sec); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 2.5;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.4); g.gain.setValueAtTime(0.35, t + sec - 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
        l.frequency.value = 3.3; lg.gain.value = 0.12; l.connect(lg); lg.connect(g.gain);
        n.connect(f); f.connect(g); g.connect(master); n.start(t); l.start(t); l.stop(t + sec);
      },
      // Quaken: Sägezahn mit fallender Tonhöhe durch ein „Schnabel“-Filter
      quack: function (pitch, delay) {
        var c = ac(); if (!c) return; var t = c.currentTime + (delay || 0), p = pitch || 1;
        var o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(520 * p, t); o.frequency.exponentialRampToValueAtTime(330 * p, t + 0.16);
        f.type = 'bandpass'; f.frequency.value = 1300 * p; f.Q.value = 3; env(c, g, t, 0.01, 0.5, 0.17);
        o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + 0.25);
      },
      // Trillerpfeife (Polizei)
      whistle: function () {
        var c = ac(); if (!c) return; var t = c.currentTime;
        var o = c.createOscillator(), l = c.createOscillator(), lg = c.createGain(), g = c.createGain();
        o.frequency.value = 2600; l.frequency.value = 28; lg.gain.value = 140; l.connect(lg); lg.connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.03); g.gain.setValueAtTime(0.25, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
        o.connect(g); g.connect(master); o.start(t); l.start(t); o.stop(t + 0.8); l.stop(t + 0.8);
      },
      // kurzer Fanfaren-Akkord (Versammlung eröffnet)
      fanfare: function () {
        var c = ac(); if (!c) return; var t = c.currentTime;
        [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.4]].forEach(function (n) {
          var o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = n[0];
          env(c, g, t + n[1], 0.02, 0.12, n[1] === 0.4 ? 0.7 : 0.18); o.connect(g); g.connect(master); o.start(t + n[1]); o.stop(t + n[1] + 1);
        });
      }
    };
  }

  function create(opts) {
    var W = 1920, H = 1080;
    var renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1)); renderer.setSize(W, H, false);
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    var scene = new THREE.Scene(); scene.environment = envMap(renderer);
    var cam = new THREE.PerspectiveCamera(opts.fov || 34, W / H, 0.1, 200);
    scene.add(new THREE.HemisphereLight(0xfff6e0, 0x5a3a20, 0.55));
    var key = new THREE.DirectionalLight(0xfff2dc, 0.9); key.position.set(-6, 14, 10); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); var sc = key.shadow.camera; sc.left = -20; sc.right = 20; sc.top = 14; sc.bottom = -14; sc.far = 60;
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xbfd4ff, 0.3); fill.position.set(8, 6, 6); scene.add(fill);

    var outfits = RD.OUTFITS.filter(function (k) { return k !== 'none'; });
    // Ente auf dem Boden: Gruppe am Bodenpunkt, darin die Ente (Schnabel nach +x)
    function duck(outfit) {
      var o = outfit === 'mix' || outfit === 'random' || !outfit ? outfits[Math.floor(Math.random() * outfits.length)] : outfit;
      var g = new THREE.Group(), d = RD.build({ outfit: o }); d.position.y = 0.55; g.add(d);
      d.traverse(function (m) { if (m.isMesh) { m.castShadow = true; } });
      g.userData.duck = d; g.userData.outfit = o;
      return g;
    }
    // Blickrichtung: Schnabel zeigt nach (dx, dz)
    function face(obj, dx, dz) { obj.rotation.y = Math.atan2(-dz, dx); }
    // Watscheln: wippt seitlich und hüpft leicht, solange amount > 0
    function waddle(obj, t, amount, speed) {
      var d = obj.userData.duck; if (!d) return;
      var ph = t * (speed || 11) + (obj.userData.ph || 0);
      d.rotation.x = Math.sin(ph) * 0.14 * amount; d.position.y = 0.55 + Math.abs(Math.sin(ph)) * 0.12 * amount;
    }
    // Schnabel auf/zu (Unterschnabel klappt am Mundwinkel)
    function talk(obj, open) {
      var d = obj.userData.duck; if (!d) return;
      if (!obj.userData.lower) d.traverse(function (m) { if (m.name === 'Lower bill') obj.userData.lower = m; });
      if (obj.userData.lower) obj.userData.lower.rotation.z = -0.45 * clamp01(open);
    }
    var sfx = makeSfx(opts.volume == null ? 0.7 : opts.volume);

    function run(TOTAL, step, ro) {
      ro = ro || {};
      var t0 = null, cues = ro.cues || [], fired = [];
      function frame(ts) {
        if (t0 === null) t0 = ts;
        var real = ro.freeze != null ? ro.freeze : (ts - t0) / 1000;
        if (ro.freeze == null) cues.forEach(function (c, i) { if (!fired[i] && real >= c[0]) { fired[i] = true; c[1](); } });
        var fade = Math.max(0, Math.min(ease(real / 0.5), 1 - ease((real - (TOTAL - 0.6)) / 0.6)));
        opts.canvas.style.setProperty('--fade', fade.toFixed(3));
        step(real);
        RD.flutter && scene.children.forEach(function (o) { if (o.userData.duck) RD.flutter(o.userData.duck, real, 0.25, o.userData.ph || 0); });
        renderer.render(scene, cam);
        if (ro.freeze != null || real < TOTAL + 0.2) requestAnimationFrame(frame);
        else renderer.clear();
      }
      requestAnimationFrame(frame);
    }

    return { renderer: renderer, scene: scene, cam: cam, key: key, duck: duck, face: face, waddle: waddle, talk: talk,
             tag: tag, bubble: bubble, wood: wood, canvasTex: canvasTex, roundRect: roundRect, sfx: sfx, run: run, outfits: outfits, FONT: FONT };
  }

  // Namen aus ?names=a,b,c bzw. „@a @b“ (Chat-Befehl über Streamer.bot), bereinigt; nicht ersetzte
  // Platzhalter (%…%) fallen weg, doppelte auch
  function names(q, key) {
    var seen = {};
    return (q.get(key || 'names') || '').split(/[\s,;]+/).map(function (s) { return s.trim().replace(/^@/, '').slice(0, 25); })
      .filter(function (s) { var k = s.toLowerCase(); if (!s || s.indexOf('%') >= 0 || seen[k]) return false; seen[k] = 1; return true; });
  }

  root.DuckStage = { create: create, names: names, ease: ease, lerp: lerp, clamp01: clamp01, hash: hash };
})(typeof window !== 'undefined' ? window : this);
