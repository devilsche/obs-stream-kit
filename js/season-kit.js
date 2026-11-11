/* Gemeinsame Bausteine der Jahreszeiten-Deko (effects/winter.html, spring.html,
   summer.html): URL-Einstellungen, SVG-Helfer, Partikel mit Rand-Fade,
   Namensschilder, Ranglisten, Gruppenaktionen, Remote-Polling mit
   Statusanzeige (?tune=1). Ergebnis liegt in window.SeasonKit. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 1920, H = 1080;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var params = new URLSearchParams(window.location.search);

  // ── Einstellungen (gleiche Regeln wie fx/commands.py) ──
  function choice() {
    var opts = Array.prototype.slice.call(arguments);
    return function (v) { v = String(v).toLowerCase(); return opts.indexOf(v) >= 0 ? v : undefined; };
  }
  function num(lo, hi, isInt) {
    return function (v) {
      var f = parseFloat(v);
      if (!isFinite(f)) return undefined;
      f = Math.max(lo, Math.min(hi, f));
      return isInt ? Math.round(f) : f;
    };
  }
  function flag(v) { return { '1': true, on: true, '0': false, off: false }[String(v).toLowerCase()]; }
  // spec: key → [Konverter, Standard]; liefert die Werte aus der URL
  function settings(spec) {
    var base = {};
    Object.keys(spec).forEach(function (k) {
      var raw = params.get(k), v = raw === null ? undefined : spec[k][0](raw);
      base[k] = v === undefined ? spec[k][1] : v;
    });
    return base;
  }
  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

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

  // CSS-Variablen per <style> (keine Inline-Styles)
  function styleSheet() {
    var s = document.createElement('style');
    document.head.appendChild(s);
    var last = '';
    return function (css) { if (css !== last) { s.textContent = css; last = css; } };
  }

  // Kurzer Effekt über ein data-Attribut, Animationen starten neu
  var pulses = {};
  function pulse(node, attr, ms) {
    node.dataset[attr] = '0';
    void node.offsetWidth;
    node.dataset[attr] = '1';
    clearTimeout(pulses[attr]);
    pulses[attr] = setTimeout(function () { node.dataset[attr] = '0'; }, ms);
  }

  function tag(layer, text, x, y, big) {
    if (!text) return null;
    x = Math.max(160, Math.min(W - 160, x));
    var t = el('text', { 'class': 'name-tag' + (big ? ' name-tag--big' : ''), x: x.toFixed(0), y: y.toFixed(0), 'text-anchor': 'middle' }, layer);
    t.textContent = text;
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3700);
    return t;
  }

  // Viele gleiche Chat-Aktionen kurz hintereinander: das erste Schild sofort, was
  // in den nächsten 2,5 s nachkommt, als ein Sammelschild („Tim, Anna and 23 others …“)
  var crowds = {};
  function names(list) {
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + ' and ' + list[1];
    var rest = list.length - 2;
    return list[0] + ', ' + list[1] + ' and ' + rest + (rest === 1 ? ' other' : ' others');
  }
  function crowd(key, name, single, many, show) {
    var c = crowds[key] || (crowds[key] = { names: [], timer: null });
    c.show = show; c.many = many;
    if (!c.timer) {
      show(single(name));
      c.timer = setTimeout(function flush() {
        var list = c.names;
        c.names = [];
        if (!list.length) { c.timer = null; return; }
        c.show(c.many(names(list), list.length));
        c.timer = setTimeout(flush, 2500);
      }, 2500);
      return;
    }
    if (c.names.indexOf(name) < 0) c.names.push(name);
  }

  function spot(node) {
    node.classList.remove('is-spot');
    void node.getBoundingClientRect();
    node.classList.add('is-spot');
    setTimeout(function () { node.classList.remove('is-spot'); }, 3300);
  }
  // !whereiam: Scheinwerfer und dreimal hüpfen
  function hop(node) {
    node.classList.remove('is-hop');
    spot(node);
    node.classList.add('is-hop');
    setTimeout(function () { node.classList.remove('is-hop'); }, 3300);
  }

  // Rangliste (Name ohne Groß/klein → Anzahl) mit HUD-Kasten
  function Leaders(box, list) {
    var by = {}, timer;
    return {
      reset: function () { by = {}; },
      add: function (name) {
        if (!name) return;
        var k = name.toLowerCase();
        by[k] = by[k] || { name: name, n: 0 };
        by[k].name = name;
        by[k].n++;
      },
      top: function () {
        return Object.keys(by).map(function (k) { return [by[k].name, by[k].n]; })
          .sort(function (a, b) { return b[1] - a[1]; });
      },
      show: function () {
        while (list.firstChild) list.removeChild(list.firstChild);
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
        timer = setTimeout(function () { box.classList.remove('is-on'); }, 10000);
      }
    };
  }

  // Gruppenaktion: need() verschiedene Namen innerhalb win() Sekunden
  function Group(need, win) {
    var hits = [];
    return {
      reset: function () { hits = []; },
      // force: Dashboard-Knopf, gelingt ohne weitere Mitmacher
      add: function (name, t, force) {
        if (force) { hits = []; return { count: need(), need: need(), success: true }; }
        hits = hits.filter(function (h) { return t - h.t <= win(); });
        var id = name ? name.toLowerCase() : '#' + t + Math.random();
        if (!hits.some(function (h) { return h.id === id; })) hits.push({ id: id, t: t });
        var r = { count: hits.length, need: need() };
        if (r.count >= r.need) { r.success = true; hits = []; }
        return r;
      },
      live: function (now) {
        hits = hits.filter(function (h) { return now - h.t <= win(); });
        if (!hits.length) return null;
        var oldest = Math.min.apply(null, hits.map(function (h) { return h.t; }));
        return { count: hits.length, need: need(), left: clamp01(1 - (now - oldest) / win()) };
      }
    };
  }

  // ── Partikel ──
  // p: x, y, vx, vy; g = Schwerkraft beim Hochwerfen, term = Sinktempo,
  // sway = seitliches Pendeln, life = Lebensdauer (s, optional),
  // floor(x) = Boden, auf dem sie verschwinden; draw(ctx, p, alpha)
  function Particles(canvas, max) {
    var ctx = canvas.getContext('2d'), list = [];
    max = max || 900;
    var self = {
      wind: 0, windTarget: 0,
      add: function (p) {
        if (reduced || list.length > max) return;
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
          if (p.life && p.age >= p.life) { list.splice(i, 1); continue; }
          // weg erst beim Fallen (hochgeworfene starten am Boden)
          if (a <= 0 && p.vy > 0 && (p.y > 0 || p.age > 3)) { list.splice(i, 1); continue; }
          if (p.x < -300 || p.x > W + 300 || p.age > 60) { list.splice(i, 1); continue; }
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

  // ── Remote-Polling: nur wenn per Token-URL ausgeliefert ──
  // h.state(state) beim ersten Poll, h.command(c) danach, h.status() für ?tune=1
  var clockOff = 0;   // Serverzeit − lokale Zeit
  function serverNow() { return Date.now() / 1000 + clockOff; }
  function connect(effect, h) {
    var tuneMode = params.get('tune') === '1';
    var tuneEl = document.getElementById('tune');
    var remote = 'off (no token URL)';
    function showTune() {
      if (tuneMode) tuneEl.textContent = 'remote: ' + remote + ' | ' + h.status();
    }
    if (tuneMode) { tuneEl.classList.add('is-on'); setInterval(showTune, 1000); }
    var m = window.location.pathname.match(/^\/s\/([A-Za-z0-9_]+)\//);
    if (m) {
      var url = '/s/' + m[1] + '/api/fx/' + effect + '/poll';
      var seq = null, epoch = null;
      remote = 'connecting';
      var pollOnce = function () {
        var delay = 1000;
        fetch(url + (seq === null ? '' : '?since=' + seq), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
          .then(function (data) {
            if (epoch !== null && data.epoch !== epoch) {
              // Server neu gestartet: Zähler beginnt bei 0, alles ab dort holen
              epoch = data.epoch; seq = 0; delay = 0;
              return;
            }
            epoch = data.epoch;
            if (typeof data.now === 'number') clockOff = data.now - Date.now() / 1000;
            if (seq === null) h.state(data.state || {});
            else (data.commands || []).forEach(h.command);
            seq = data.seq;
            remote = 'listening (seq ' + seq + ')';
          })
          .catch(function () { remote = 'error, retrying'; delay = 3000; })
          .then(function () { showTune(); setTimeout(pollOnce, delay); });
      };
      pollOnce();
    }
    showTune();
    // Testtasten (nur ?tune=1, lokal, nicht gespeichert)
    if (tuneMode && h.keys) {
      document.addEventListener('keydown', function (e) {
        var f = h.keys[e.key.toLowerCase()];
        if (f) { h.command(f()); showTune(); }
      });
    }
  }

  var NAMES = ['Hat3', 'PixelPaul', 'Mia_GG', 'Lunatic', 'Nordlicht'];
  function testName() { return NAMES[Math.floor(Math.random() * NAMES.length)]; }

  window.SeasonKit = {
    W: W, H: H, reduced: reduced,
    choice: choice, num: num, flag: flag, settings: settings, copy: copy,
    el: el, rnd: rnd, rand: rand, clamp01: clamp01, styleSheet: styleSheet,
    pulse: pulse, tag: tag, spot: spot, hop: hop, crowd: crowd, Leaders: Leaders, Group: Group,
    Particles: Particles, loop: loop, connect: connect, serverNow: serverNow, testName: testName
  };
})();
