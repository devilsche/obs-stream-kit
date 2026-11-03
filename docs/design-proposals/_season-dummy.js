/* Gemeinsame Bausteine der Jahreszeiten-Klickdummys: Skalierung der Bühne,
   SVG-Helfer, Zufall, Steuerleiste → data-*-Attribute, Partikel mit
   Rand-Fade, Namensschilder, Rangliste. Ergebnis liegt in window.SD. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 1920, H = 1080;
  var stage = document.getElementById('stage');
  var col = document.getElementById('col');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Skalierung (per <style>, kein Inline-Style) ──
  var scaleStyle = document.createElement('style');
  document.head.appendChild(scaleStyle);
  function fit() {
    var s = Math.min(col.clientWidth / 1920, (window.innerHeight - 40) / 1080);
    if (window.innerWidth <= 900) s = col.clientWidth / 1920;
    scaleStyle.textContent = '.stage-wrap{--s:' + Math.max(0.15, s).toFixed(4) + '}';
  }
  window.addEventListener('resize', fit);
  fit();

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  // Pseudozufall mit festem Startwert: Aufbau sieht bei jedem Laden gleich aus
  var seed = 11;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function camel(k) { return k.replace(/-(\w)/g, function (m, c) { return c.toUpperCase(); }); }

  // Checkboxen → data-key="1|0", Selects → data-key="wert"; onChange bekommt beides
  function bindControls(onChange) {
    document.getElementById('controls').addEventListener('change', function (e) {
      var t = e.target, key = t.dataset.key;
      if (!key) return;
      var v = t.type === 'checkbox' ? (t.checked ? '1' : '0') : t.value;
      stage.dataset[camel(key)] = v;
      if (onChange) onChange(key, v);
    });
  }
  function on(id, fn) { document.getElementById(id).addEventListener('click', fn); }
  function toggle(id, fn) {
    var b = document.getElementById(id);
    b.addEventListener('click', function () {
      var now = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(now));
      fn(now);
    });
  }
  // Schieberegler mit Ausgabe; set() schreibt von außen zurück
  function slider(id, fn) {
    var r = document.getElementById(id), out = document.getElementById(id + 'Out');
    r.addEventListener('input', function () { out.textContent = r.value + '%'; fn(r.value / 100); });
    return { set: function (v) { r.value = Math.round(v * 100); out.textContent = r.value + '%'; } };
  }

  // Kurzer Effekt über ein data-Attribut (z. B. celebrate), Animationen starten neu
  var pulses = {};
  function pulse(attr, ms) {
    stage.dataset[attr] = '0';
    void stage.offsetWidth;
    stage.dataset[attr] = '1';
    clearTimeout(pulses[attr]);
    pulses[attr] = setTimeout(function () { stage.dataset[attr] = '0'; }, ms);
  }

  function tag(layer, text, x, y, big) {
    x = Math.max(140, Math.min(W - 140, x));
    var t = el('text', { 'class': 'name-tag' + (big ? ' name-tag--big' : ''), x: x.toFixed(0), y: y.toFixed(0), 'text-anchor': 'middle' }, layer);
    t.textContent = text;
    setTimeout(function () { t.remove(); }, 3700);
    return t;
  }

  var NAMES = ['Hat3', 'PixelPaul', 'Mia_GG', 'Lunatic', 'xSniperx', 'Kekskrümel', 'Nordlicht', 'Bubu', 'Sonnenkind', 'Frostbeule'];
  function pick() { return NAMES[Math.floor(Math.random() * NAMES.length)]; }

  // Rangliste (Name → Anzahl) mit HUD-Kasten
  function Leaders(box, list) {
    var by = {}, timer;
    return {
      add: function (name) { by[name] = (by[name] || 0) + 1; },
      top: function () {
        return Object.keys(by).map(function (k) { return [k, by[k]]; })
          .sort(function (a, b) { return b[1] - a[1]; });
      },
      show: function () {
        list.textContent = '';
        var top = this.top().slice(0, 5);
        if (!top.length) top = [['Nobody yet', 0]];
        top.forEach(function (e, i) {
          var li = document.createElement('li');
          var a = document.createElement('span'), b = document.createElement('span');
          a.textContent = (i + 1) + '. ' + e[0];
          b.textContent = e[1] + '×';
          li.appendChild(a); li.appendChild(b); list.appendChild(li);
        });
        box.classList.remove('is-on'); void box.offsetWidth; box.classList.add('is-on');
        clearTimeout(timer);
        timer = setTimeout(function () { box.classList.remove('is-on'); }, 6000);
      }
    };
  }

  // ── Partikel ──
  // p: x, y, vx, vy; g = Schwerkraft nach oben geworfen, term = Sinktempo,
  // sway = seitliches Pendeln, life = Lebensdauer (s, optional),
  // floor(x) = Boden, auf dem sie verschwinden; draw(ctx, p, alpha)
  function Particles(canvas) {
    var ctx = canvas.getContext('2d'), list = [];
    var self = {
      wind: 0, windTarget: 0,
      add: function (p) {
        if (reduced || list.length > 1200) return;
        p.vx = p.vx || 0; p.vy = p.vy === undefined ? 60 : p.vy;
        p.g = p.g === undefined ? 900 : p.g; p.term = p.term || 80;
        p.sway = p.sway === undefined ? rand(10, 40) : p.sway;
        p.ph = rand(0, 6.28); p.vph = p.vph || rand(1.5, 4);
        p.rot = rand(0, 6.28); p.vr = p.vr === undefined ? rand(-2, 2) : p.vr;
        p.age = 0; p.wf = p.wf === undefined ? 1 : p.wf;
        list.push(p);
      },
      count: function () { return list.length; },
      step: function (dt) {
        self.wind += (self.windTarget - self.wind) * Math.min(1, dt * 3);
        self.windTarget *= Math.pow(0.35, dt);
        ctx.clearRect(0, 0, W, H);
        for (var i = list.length - 1; i >= 0; i--) {
          var p = list[i];
          p.age += dt; p.ph += p.vph * dt; p.rot += p.vr * dt;
          if (p.vy < p.term) p.vy = Math.min(p.term, p.vy + p.g * dt);
          else p.vy += (p.term - p.vy) * dt * 0.8;
          p.vx += (self.wind * p.wf - p.vx) * dt * (p.drag || 0.9);
          p.x += (p.vx + Math.cos(p.ph) * p.sway) * dt;
          p.y += p.vy * dt;
          // Rand-Fade: nie hart über Kanten
          var a = clamp01(Math.min(p.x + 40, W + 40 - p.x) / 140) * clamp01((p.y + 40) / 90);
          var fl = p.floor ? p.floor(p.x) : H + 30;
          a *= clamp01((fl - p.y) / 30);
          if (p.life) a *= clamp01((p.life - p.age) / 0.6);
          // weg erst beim Fallen (hochgeworfene starten am Boden)
          if (a <= 0 && p.vy > 0 && (p.y > 0 || p.age > 3)) { list.splice(i, 1); continue; }
          if (p.x < -300 || p.x > W + 300) { list.splice(i, 1); continue; }
          p.draw(ctx, p, a);
        }
      }
    };
    return self;
  }

  function loop(fn) {
    var last = performance.now();
    (function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      fn(dt, now);
      requestAnimationFrame(frame);
    })(last);
  }

  window.SD = {
    W: W, H: H, NS: NS, stage: stage, reduced: reduced,
    el: el, rnd: rnd, rand: rand, clamp01: clamp01,
    bindControls: bindControls, on: on, toggle: toggle, slider: slider,
    pulse: pulse, tag: tag, pick: pick, NAMES: NAMES,
    Leaders: Leaders, Particles: Particles, loop: loop
  };
})();
