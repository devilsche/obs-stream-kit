/* Car editor (tools/car-editor.html) – Abschnitt „Sound“: Motorklang je Auto von Hand einstellen.
 *
 * Die Automatik (scripts/build_engine_sounds.py) erwischt die Bereiche einer Aufnahme oft falsch. Hier wählt man eine
 * Quell-Aufnahme (assets/sounds/engines/src/, scripts/build_engine_sources.py), sieht Wellenform + gemessene Drehzahl
 * auf einem Canvas und markiert Leerlauf, Hochlauf (mit Drehzahl am Anfang/Ende), Gas weg, Anlassen und optional den
 * Begrenzer – per Maus (Marker ziehen) oder Tastatur (Canvas: ↑/↓ Marker wählen, ←/→ schieben) bzw. Zahlenfeldern.
 * Dazu Kenndaten (Leerlauf, Begrenzer, Gänge, Schaltdrehzahl, Gangsprünge, Begrenzer-Art) und ein Gang-Simulator mit
 * den echten Race stats des Autos (vmax, 0–100) und der Laufzeit-Stimme (js/car-engine-audio.js) mit dem Entwurf.
 *
 * Gespeichert wird (über den Speichern-Knopf des Editors) def.sound – nur Abweichungen von der Automatik:
 *   { src, idle: [t0, t1], sweep: { t0, t1, rpm0, rpm1 }, lift: {…}, start: [t0, t1], limiter: [t0, t1],
 *     idleRpm, redline, gears, shiftRpm, steps: [n − 1], limitStyle, limitHz }
 *   src + Abschnitte nur, sobald man an Aufnahme/Markierungen etwas tut; Abschnitte, die dem Vorschlag der Automatik
 *   (src/<id>.json auto) entsprechen, fallen weg; ein abgewählter Vorschlag wird null. Prüfung: fx/car_models.py.
 *
 *   var se = CarSoundEditor.create({ audio, ctx, resume, car, def, type, race, say })
 *     audio() → CarEngineAudio-Instanz (oder null), ctx() → ihr AudioContext, resume() → Ton freigeben (nach Klick),
 *     car() → Katalog-Eintrag, def() → Entwurf des Autos, type() → Motorart (Race stats),
 *     race() → { vmax, acc } (Race stats), say(text, cls) → Statuszeile
 *   se.fill([force])   nach Autowechsel / Motorart-Wechsel (force = neu laden, z. B. Auto neu geladen)
 *   se.stop()   Wiedergabe + Simulator aus
 */
(function (root) {
  'use strict';
  var SECS = [
    { k: 'idle', label: 'Idle', name: 'Idle loop', col: '#4fc3f7', len: 1.5 },
    { k: 'sweep', label: 'Rev-up', name: 'Rev-up (on throttle)', col: '#9be59b', len: 4, rpm: 1 },
    { k: 'lift', label: 'Lift off', name: 'Lift off / overrun', col: '#ffab70', len: 2.5, rpm: -1 },
    { k: 'start', label: 'Start', name: 'Start-up', col: '#c39bff', len: 2.5 },
    { k: 'limiter', label: 'Limiter', name: 'Rev limiter (optional)', col: '#ff8a80', len: 1 }
  ];
  var MIN_LEN = { idle: 0.2, sweep: 0.3, lift: 0.3, start: 0.2, limiter: 0.2 };
  var MAX_LEN = { idle: 10, sweep: 20, lift: 20, start: 8, limiter: 10 };
  var CURVE = '#ff8fd8', WAVE = '#7d8aa8', GRID = '#2a3346', TXT = '#c4bad6', ACT = '#f2b705';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function fmtRpm(x) { return Math.round(x).toLocaleString('en-US').replace(/,/g, ' '); }

  function create(o) {
    var M = root.CarEngineAudio && root.CarEngineAudio.Model;
    var S = {
      car: null, type: null, index: null, src: null, info: null, buf: null, peaks: null, sec: {}, own: false,
      view: [0, 1], act: null, play: null, autoSrc: null, loadTok: 0
    };
    var cv = $('sndWave'), g2 = cv.getContext('2d');

    function A() { return o.audio(); }
    function bank() { var a = A(); return a && a.bank(); }
    function typeSpec() { var b = bank(); return b && b.types[S.type] ? b.types[S.type] : null; }
    function dur() { return S.buf ? S.buf.duration : S.info ? S.info.dur : 30; }

    // ---------------------------------------------------------------- Abschnitte (DOM)
    var secEls = {};
    SECS.forEach(function (d) {
      var w = el('div', 'snd-sec'), r1 = el('div', 'row'), cb = el('input'), lab = el('label', null, d.name), key = el('span', 'snd-key k-' + d.k);
      cb.type = 'checkbox'; cb.id = 'sndOn-' + d.k; lab.htmlFor = cb.id; key.setAttribute('aria-hidden', 'true');
      var pl = el('button', 'small', 'Play'); pl.type = 'button'; pl.setAttribute('aria-label', 'Play ' + d.name);
      r1.append(cb, key, lab, pl);
      var r2_ = el('div', 'row');
      function num(id, txt, min, max, step) {
        var l = el('label', null, txt), i = el('input'); i.type = 'number'; i.id = id; i.min = String(min); i.max = String(max); i.step = String(step);
        l.htmlFor = id; r2_.append(l, i); return i;
      }
      var t0 = num('snd-' + d.k + '-t0', 'Start (s)', 0, 60, 0.01), t1 = num('snd-' + d.k + '-t1', 'End (s)', 0, 60, 0.01);
      w.append(r1, r2_);
      var rp0 = null, rp1 = null;
      if (d.rpm) {
        var r3 = el('div', 'row');
        var l0 = el('label', null, 'RPM at start'), l1 = el('label', null, 'RPM at end');
        rp0 = el('input'); rp1 = el('input');
        [rp0, rp1].forEach(function (i, k) { i.type = 'number'; i.min = '100'; i.max = '20000'; i.step = '50'; i.id = 'snd-' + d.k + '-rpm' + k; });
        l0.htmlFor = rp0.id; l1.htmlFor = rp1.id;
        r3.append(l0, rp0, l1, rp1); w.append(r3);
      }
      $('sndSecs').appendChild(w);
      secEls[d.k] = { cb: cb, t0: t0, t1: t1, rpm0: rp0, rpm1: rp1, play: pl };
      cb.addEventListener('change', function () {
        var s = S.sec[d.k];
        if (cb.checked && !s) {
          var c = (S.view[0] + S.view[1]) / 2, h = Math.min(d.len, dur()) / 2;
          s = S.sec[d.k] = { t0: r2(clamp(c - h, 0, dur() - 2 * h)), t1: 0 };
          s.t1 = r2(s.t0 + 2 * h);
          if (d.rpm) { s.rpm0 = d.rpm > 0 ? 1500 : 6000; s.rpm1 = d.rpm > 0 ? 6000 : 1500; autoRpm(d.k, 't0'); autoRpm(d.k, 't1'); }
        }
        if (s) s.on = cb.checked;
        if (cb.checked) S.act = d.k + '.t0';
        touched(); syncSec(d.k); draw();
      });
      [['t0', t0], ['t1', t1]].forEach(function (p) {
        p[1].addEventListener('change', function () {
          var s = S.sec[d.k]; if (!s) return;
          var v = +p[1].value;
          if (!isFinite(v)) { syncSec(d.k); return; }
          setT(d.k, p[0], v); touched(); syncSec(d.k); draw();
        });
      });
      if (d.rpm) {
        [['rpm0', rp0], ['rpm1', rp1]].forEach(function (p) {
          p[1].addEventListener('change', function () {
            var s = S.sec[d.k]; if (!s) return;
            var v = +p[1].value;
            if (isFinite(v) && v >= 100 && v <= 20000) s[p[0]] = Math.round(v);
            fixRpm(d.k); touched(); syncSec(d.k); draw();
          });
        });
      }
      pl.addEventListener('click', function () { playSec(d.k); });
    });
    // Hochlauf steigt, Abfall fällt (≥ 5 %), sonst ändert der Server ihn ab
    function fixRpm(k) {
      var s = S.sec[k], d = SECS.filter(function (x) { return x.k === k; })[0];
      if (!s || !d.rpm) return;
      if (d.rpm > 0 && s.rpm1 < s.rpm0 * 1.06) s.rpm1 = Math.min(20000, Math.round(s.rpm0 * 1.06));
      if (d.rpm < 0 && s.rpm1 > s.rpm0 / 1.06) s.rpm1 = Math.max(100, Math.round(s.rpm0 / 1.06));
    }
    function setT(k, which, v) {
      var s = S.sec[k], D = dur();
      v = clamp(r2(v), 0, D);
      if (which === 't0') s.t0 = clamp(v, Math.max(0, s.t1 - MAX_LEN[k]), s.t1 - MIN_LEN[k]);
      else s.t1 = clamp(v, s.t0 + MIN_LEN[k], Math.min(D, s.t0 + MAX_LEN[k]));
      s.t0 = r2(Math.max(0, s.t0)); s.t1 = r2(s.t1);
      autoRpm(k, which);                                  // Drehzahl an der Marke aus der Messung (danach von Hand änderbar)
    }
    // Drehzahl an einer Marke aus der Messung (Median ±0,1 s), umgerechnet auf die Zylinderzahl der Motorart
    function curveRpm(t) {
      var inf = S.info;
      if (!inf || !inf.rpm) return null;
      var a = Math.floor((t - 0.1 - inf.t0) / inf.dt), b = Math.ceil((t + 0.1 - inf.t0) / inf.dt), v = [];
      for (var i = Math.max(0, a); i <= Math.min(inf.rpm.length - 1, b); i++) if (inf.rpm[i] > 0) v.push(inf.rpm[i]);
      if (!v.length) return null;
      v.sort(function (x, y) { return x - y; });
      return v[v.length >> 1] * cylK();
    }
    function cylK() { var sp = typeSpec(); return S.info && sp ? S.info.cyl / sp.cyl : 1; }
    function autoRpm(k, which) {
      var s = S.sec[k], d = SECS.filter(function (x) { return x.k === k; })[0];
      if (!d.rpm || !s) return;
      var r = curveRpm(which === 't0' ? s.t0 : s.t1);
      if (r) s[which === 't0' ? 'rpm0' : 'rpm1'] = Math.round(r / 10) * 10;
      fixRpm(k);
    }
    function syncSec(k) {
      var s = S.sec[k], e = secEls[k], on = !!(s && s.on);
      e.cb.checked = on;
      [e.t0, e.t1, e.rpm0, e.rpm1].forEach(function (i) { if (i) i.disabled = !on; });
      e.play.disabled = !on || !S.src;
      e.t0.value = s ? s.t0.toFixed(2) : ''; e.t1.value = s ? s.t1.toFixed(2) : '';
      if (e.rpm0) { e.rpm0.value = s ? s.rpm0 : ''; e.rpm1.value = s ? s.rpm1 : ''; }
    }

    // ---------------------------------------------------------------- Kenndaten
    function autoParams(red, gears) {
      var b = typeSpec();
      if (!b || !M) return null;
      var sp = { type: S.type, idle: b.idle, red: red || b.red, gears: gears || b.gears, g1: b.g1 }, tn = M.tune({ type: S.type });
      return { idleRpm: b.idle, redline: b.red, gears: b.gears, shiftRpm: Math.round(tn.shift * sp.red / 10) * 10,
        steps: M.steps(sp), limitStyle: tn.soft ? 'soft' : 'hard', limitHz: tn.hz };
    }
    function stepInputs(n, vals) {
      var box = $('sndSteps'), keep = [];
      Array.prototype.forEach.call(box.querySelectorAll('input'), function (i) { keep.push(+i.value); });
      box.textContent = '';
      for (var g = 1; g < n; g++) {
        var l = el('label'), i = el('input');
        i.type = 'number'; i.min = '1'; i.max = '3'; i.step = '0.01'; i.id = 'sndStep' + g; i.className = 'snd-step';
        i.value = (vals && vals[g - 1] != null ? vals[g - 1] : keep[g - 1] || 1.3).toFixed(2);
        l.append(document.createTextNode('Gear ' + g + '→' + (g + 1)), i);
        i.addEventListener('change', function () { var x = +this.value; this.value = clamp(isFinite(x) ? x : 1.3, 1, 3).toFixed(2); paramsChanged(); });
        box.appendChild(l);
      }
    }
    function est(id, v) { $(id + 'Est').textContent = 'auto ' + v; }
    function fillParams() {
      var ds = o.def().sound || {}, a = autoParams();
      if (!a) return;
      var red = ds.redline || a.redline, gears = ds.gears || a.gears, a2 = autoParams(red, gears);
      $('sndIdle').value = ds.idleRpm || a.idleRpm; est('sndIdle', fmtRpm(a.idleRpm));
      $('sndRed').value = red; est('sndRed', fmtRpm(a.redline));
      $('sndGears').value = gears; est('sndGears', a.gears);
      $('sndShift').value = ds.shiftRpm || a2.shiftRpm; est('sndShift', fmtRpm(a2.shiftRpm)); autoShift = a2.shiftRpm;
      $('sndLimit').value = ds.limitStyle || a.limitStyle; est('sndLimit', a.limitStyle === 'soft' ? 'soft' : 'hard cuts');
      $('sndLimitHz').value = ds.limitHz || a.limitHz; est('sndLimitHz', a.limitHz);
      stepInputs(gears, ds.steps && ds.steps.length === gears - 1 ? ds.steps : a2.steps);
    }
    function readParams() {
      var a = autoParams();
      if (!a) return {};
      function n(id, lo, hi, dflt) { var v = +$(id).value; return isFinite(v) && $(id).value !== '' ? clamp(Math.round(v), lo, hi) : dflt; }
      var red = n('sndRed', 1000, 20000, a.redline), gears = n('sndGears', 1, 10, a.gears), a2 = autoParams(red, gears);
      var idle = Math.min(n('sndIdle', 200, 6000, a.idleRpm), Math.round(red * 0.7));
      var p = { idleRpm: idle, redline: red, gears: gears, shiftRpm: clamp(n('sndShift', 500, 20000, a2.shiftRpm), Math.round(red * 0.6), red),
        limitStyle: $('sndLimit').value, limitHz: n('sndLimitHz', 3, 30, a.limitHz) };
      var st = Array.prototype.map.call($('sndSteps').querySelectorAll('input'), function (i) { return clamp(r2(+i.value || 1.3), 1, 3); });
      p.steps = st.length === gears - 1 ? st : a2.steps;
      var o2 = {};
      ['idleRpm', 'redline', 'gears', 'limitStyle', 'limitHz'].forEach(function (k) { if (p[k] !== a[k]) o2[k] = p[k]; });
      if (p.shiftRpm !== a2.shiftRpm) o2.shiftRpm = p.shiftRpm;
      if (p.steps.some(function (x, i) { return Math.abs(x - a2.steps[i]) > 0.005; })) o2.steps = p.steps;
      return o2;
    }
    // Schaltdrehzahl folgt dem Begrenzer, solange sie auf dem Vorschlag der Automatik steht
    var autoShift = null;
    function paramsChanged() {
      var gears = +$('sndGears').value, a3 = autoParams(+$('sndRed').value || null, gears || null);
      if (a3 && autoShift != null && +$('sndShift').value === autoShift) $('sndShift').value = a3.shiftRpm;
      if (a3) { autoShift = a3.shiftRpm; est('sndShift', fmtRpm(a3.shiftRpm)); }
      if (isFinite(gears) && gears >= 1 && gears <= 10 && $('sndSteps').querySelectorAll('input').length !== gears - 1) {
        var a2 = autoParams(+$('sndRed').value || null, gears);
        stepInputs(gears, a2 && a2.steps);
      }
      store(); simRebuild();
    }
    Array.prototype.forEach.call(document.querySelectorAll('.snd-p'), function (i) { i.addEventListener('change', paramsChanged); });

    // ---------------------------------------------------------------- Entwurf → def.sound (nur Abweichungen)
    function touched() { S.own = true; store(); simRebuild(); }
    function draft() {
      var out = readParams(), auto = (S.info && S.info.auto) || {};
      if (S.own && S.src) {
        out.src = S.src;
        SECS.forEach(function (d) {
          var s = S.sec[d.k], a = auto[d.k];
          if (!s || !s.on) { if (a) out[d.k] = null; return; }
          var v = d.rpm ? { t0: s.t0, t1: s.t1, rpm0: s.rpm0, rpm1: s.rpm1 } : [s.t0, s.t1];
          var same = a && (d.rpm ? Math.abs(a.t0 - s.t0) < 0.005 && Math.abs(a.t1 - s.t1) < 0.005 && a.rpm0 === s.rpm0 && a.rpm1 === s.rpm1
            : Math.abs(a[0] - s.t0) < 0.005 && Math.abs(a[1] - s.t1) < 0.005);
          if (!same) out[d.k] = v;
        });
      }
      var c = M ? M.cleanSound(out) : null;
      return c;
    }
    function store() {
      var d = o.def(), c = draft();
      if (c) d.sound = c; else delete d.sound;
      mode();
    }
    function mode() {
      var c = o.def().sound;
      var vals = c && ['idleRpm', 'redline', 'gears', 'shiftRpm', 'steps', 'limitStyle', 'limitHz'].some(function (k) { return c[k] != null; });
      $('sndMode').textContent = !c ? 'Using: automatic sound.' : c.src ? 'Using: your marked sections of this recording' + (vals ? ' and your engine values.' : '.')
        : 'Using: automatic sound with your engine values.';
    }

    // ---------------------------------------------------------------- Aufnahme laden
    function fillSelect() {
      var sel = $('sndSrc'), idx = S.index || {}, mine = [], other = [];
      sel.textContent = '';
      Object.keys(idx).forEach(function (id) { (idx[id].types.indexOf(S.type) >= 0 ? mine : other).push(id); });
      function group(lbl, ids) {
        if (!ids.length) return;
        var g = el('optgroup'); g.label = lbl;
        ids.sort(function (a, b) { return idx[a].title.localeCompare(idx[b].title); }).forEach(function (id) {
          var op = el('option', null, idx[id].title + ' – ' + idx[id].user + (+id === S.autoSrc ? ' (automatic)' : ''));
          op.value = id; g.appendChild(op);
        });
        sel.appendChild(g);
      }
      var lbl = (root.CarEngineAudio.TYPES.filter(function (t) { return t.id === S.type; })[0] || { label: S.type }).label;
      group('Recordings for ' + lbl, mine);
      group('Other engine types', other);
    }
    function credit() {
      var m = S.index && S.index[S.src];
      $('sndCredit').textContent = m ? '“' + m.title + '” by ' + m.user + ' (' + m.lic + ', freesound.org), ' + m.dur.toFixed(1) + ' s – types: ' + m.types.join(', ') : '';
    }
    function loadSrc(id, keepSecs) {
      var a = A();
      if (!a) return Promise.resolve();
      stopPlay();
      var tok = ++S.loadTok;
      S.src = +id; S.info = null; S.buf = null; S.peaks = null;
      $('sndSrc').value = String(id); credit(); draw();
      $('sndLive').textContent = 'Loading the recording …';
      return a.source(+id).then(function (r) {
        if (tok !== S.loadTok) return;
        S.info = r.info; S.buf = r.buf;
        if (!S.buf) { $('sndLive').textContent = 'The recording could not be loaded.'; return; }
        peaks();
        S.view = [0, S.buf.duration];
        if (!keepSecs) {
          var au = (S.info && S.info.auto) || {};
          S.sec = {};
          SECS.forEach(function (d) {
            var v = au[d.k];
            if (!v) return;
            // Vorschläge sind auf die Zylinderzahl der Aufnahme beschriftet → auf die Motorart des Autos umrechnen
            S.sec[d.k] = d.rpm ? { t0: v.t0, t1: v.t1, rpm0: Math.round(v.rpm0 * cylK()), rpm1: Math.round(v.rpm1 * cylK()), on: true } : { t0: v[0], t1: v[1], on: true };
          });
        }
        S.act = S.sec.sweep ? 'sweep.t0' : null;
        SECS.forEach(function (d) { syncSec(d.k); });
        $('sndLive').textContent = '';
        view(); draw();
      });
    }
    // Hüllkurve: Min/Max je 64 Proben (schnelles Zeichnen auch ganz herausgezoomt)
    function peaks() {
      var d = S.buf.getChannelData(0), n = Math.ceil(d.length / 64), mn = new Float32Array(n), mx = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        var a = 1, b = -1;
        for (var j = i * 64, e = Math.min(d.length, j + 64); j < e; j++) { var x = d[j]; if (x < a) a = x; if (x > b) b = x; }
        mn[i] = a; mx[i] = b;
      }
      S.peaks = { mn: mn, mx: mx, k: 64 / S.buf.sampleRate };
    }

    // ---------------------------------------------------------------- Zeichnen
    function size() {
      var dpr = root.devicePixelRatio || 1, w = Math.max(200, cv.clientWidth), h = cv.clientHeight || 180;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      return { w: w, h: h, dpr: dpr };
    }
    function x2t(x, w) { return S.view[0] + x / w * (S.view[1] - S.view[0]); }
    function t2x(t, w) { return (t - S.view[0]) / (S.view[1] - S.view[0]) * w; }
    function handles() {
      var out = [];
      SECS.forEach(function (d) { var s = S.sec[d.k]; if (s && s.on) { out.push({ id: d.k + '.t0', k: d.k, w: 't0', t: s.t0, d: d }); out.push({ id: d.k + '.t1', k: d.k, w: 't1', t: s.t1, d: d }); } });
      return out;
    }
    function draw() {
      var z = size(), w = z.w, h = z.h;
      g2.setTransform(z.dpr, 0, 0, z.dpr, 0, 0);
      g2.clearRect(0, 0, w, h);
      g2.font = '11px "DM Sans", system-ui, sans-serif';
      if (!S.buf) { g2.fillStyle = TXT; g2.fillText(S.src ? 'Loading …' : 'No recording', 8, 16); return; }
      var top = 18, bh = h - top - 14, mid = top + bh / 2, sp = typeSpec(), maxR = Math.max(sp ? sp.red * 1.15 : 8000, 2000);
      // Drehzahl-Raster
      g2.strokeStyle = GRID; g2.fillStyle = TXT; g2.lineWidth = 1;
      for (var rr = 2000; rr < maxR; rr += maxR > 12000 ? 4000 : 2000) {
        var y = top + bh - rr / maxR * bh;
        g2.beginPath(); g2.moveTo(0, y); g2.lineTo(w, y); g2.stroke();
        g2.fillText(rr / 1000 + 'k', 2, y - 2);
      }
      // Abschnitte (Bänder + Beschriftung)
      SECS.forEach(function (d) {
        var s = S.sec[d.k];
        if (!s || !s.on) return;
        var a = t2x(s.t0, w), b = t2x(s.t1, w);
        if (b < 0 || a > w) return;
        g2.globalAlpha = 0.18; g2.fillStyle = d.col; g2.fillRect(a, top, b - a, bh); g2.globalAlpha = 1;
        g2.fillStyle = d.col; g2.fillRect(a, 2, Math.max(2, b - a), 3);
        g2.fillText(d.label, Math.max(2, a + 3), 14);
      });
      // Wellenform
      var P = S.peaks, t0 = S.view[0], t1 = S.view[1];
      g2.fillStyle = WAVE;
      for (var x = 0; x < w; x++) {
        var a0 = Math.floor(x2t(x, w) / P.k), a1 = Math.max(a0 + 1, Math.floor(x2t(x + 1, w) / P.k)), mn = 0, mx = 0;
        for (var j = Math.max(0, a0); j < Math.min(P.mn.length, a1); j++) { if (P.mn[j] < mn) mn = P.mn[j]; if (P.mx[j] > mx) mx = P.mx[j]; }
        g2.fillRect(x, mid - mx * bh / 2, 1, Math.max(1, (mx - mn) * bh / 2));
      }
      // gemessene Drehzahl
      var inf = S.info;
      if (inf && inf.rpm) {
        g2.strokeStyle = CURVE; g2.lineWidth = 1.5; g2.beginPath();
        var pen = false, k = cylK();
        for (var i2 = 0; i2 < inf.rpm.length; i2++) {
          var t = inf.t0 + i2 * inf.dt;
          if (t < t0 - inf.dt || t > t1 + inf.dt) continue;
          var v = inf.rpm[i2];
          if (!v) { pen = false; continue; }
          var px = t2x(t, w), py = top + bh - clamp(v * k / maxR, 0, 1) * bh;
          if (pen) g2.lineTo(px, py); else g2.moveTo(px, py);
          pen = true;
        }
        g2.stroke();
      }
      // Marker (aktiver dick + gold, mit Griff)
      handles().forEach(function (hd) {
        var hx = t2x(hd.t, w);
        if (hx < -2 || hx > w + 2) return;
        var on = hd.id === S.act;
        g2.strokeStyle = on ? ACT : hd.d.col; g2.lineWidth = on ? 3 : 2;
        g2.beginPath(); g2.moveTo(hx, top); g2.lineTo(hx, top + bh); g2.stroke();
        g2.fillStyle = on ? ACT : hd.d.col;
        g2.fillRect(hx - 5, top + bh - 2, 10, 10);
      });
      // Abspielposition
      if (S.play && S.play.t0 != null) {
        var a = A(), ctx = a && o.ctx();
        if (ctx) {
          var tp = S.play.t0 + (ctx.currentTime - S.play.at);
          if (tp <= S.play.t1) { var xp = t2x(tp, w); g2.strokeStyle = '#ffffff'; g2.lineWidth = 1; g2.beginPath(); g2.moveTo(xp, top); g2.lineTo(xp, top + bh); g2.stroke(); }
        }
      }
      // Zeitachse
      g2.fillStyle = TXT;
      g2.fillText(t0.toFixed(1) + ' s', 2, h - 2);
      var lbl = t1.toFixed(1) + ' s';
      g2.fillText(lbl, w - g2.measureText(lbl).width - 2, h - 2);
    }
    function view() {
      var D = dur(), span = S.view[1] - S.view[0], pan = $('sndPan');
      pan.disabled = span >= D - 0.01;
      pan.value = String(span >= D ? 0 : Math.round(S.view[0] / (D - span) * 1000));
      $('sndViewOut').textContent = S.view[0].toFixed(1) + '–' + S.view[1].toFixed(1) + ' s';
    }
    function zoom(f, c) {
      var D = dur(), span = clamp((S.view[1] - S.view[0]) * f, Math.min(1, D), D);
      if (c == null) { var hd = handles().filter(function (x) { return x.id === S.act; })[0]; c = hd ? hd.t : (S.view[0] + S.view[1]) / 2; }
      var a = clamp(c - span / 2, 0, D - span);
      S.view = [a, a + span]; view(); draw();
    }
    $('sndZoomIn').addEventListener('click', function () { zoom(0.5); });
    $('sndZoomOut').addEventListener('click', function () { zoom(2); });
    $('sndPan').addEventListener('input', function () {
      var D = dur(), span = S.view[1] - S.view[0], a = +$('sndPan').value / 1000 * (D - span);
      S.view = [a, a + span]; view(); draw();
    });

    // ---------------------------------------------------------------- Marker ziehen / Tastatur
    var drag = null;
    function near(x, w) {
      var best = null, bd = 12;
      handles().forEach(function (hd) { var d = Math.abs(t2x(hd.t, w) - x); if (d < bd || (d === bd && hd.id === S.act)) { bd = d; best = hd; } });
      return best;
    }
    cv.addEventListener('pointerdown', function (e) {
      if (!S.buf) return;
      var r = cv.getBoundingClientRect(), hd = near(e.clientX - r.left, r.width);
      if (!hd) return;
      drag = hd; S.act = hd.id; cv.setPointerCapture(e.pointerId); e.preventDefault(); draw();
    });
    cv.addEventListener('pointermove', function (e) {
      var r = cv.getBoundingClientRect(), x = e.clientX - r.left;
      if (!drag) { cv.classList.toggle('grab', !!(S.buf && near(x, r.width))); return; }
      setT(drag.k, drag.w, x2t(clamp(x, 0, r.width), r.width)); syncSec(drag.k); announce(); draw();
    });
    function endDrag() { if (!drag) return; drag = null; touched(); }
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('keydown', function (e) {
      if (!S.buf) return;
      var hs = handles(), i = hs.map(function (x) { return x.id; }).indexOf(S.act);
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!hs.length) return;
        i = (i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1) + hs.length) % hs.length;
        S.act = hs[i].id; e.preventDefault();
        var hd = hs[i];
        if (hd.t < S.view[0] || hd.t > S.view[1]) zoom(1, hd.t);
        announce(); draw(); return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (i < 0) return;
        var h2 = hs[i], st = (e.shiftKey ? 0.1 : 0.01) * (e.key === 'ArrowLeft' ? -1 : 1);
        setT(h2.k, h2.w, h2.t + st); syncSec(h2.k); e.preventDefault(); announce(); draw();
        clearTimeout(cv._kt); cv._kt = setTimeout(touched, 400);
        return;
      }
      if (e.key === '+' || e.key === '=') { zoom(0.5); e.preventDefault(); }
      if (e.key === '-') { zoom(2); e.preventDefault(); }
    });
    cv.addEventListener('focus', function () { if (!S.act) { var hs = handles(); if (hs.length) S.act = hs[0].id; } announce(); draw(); });
    function announce() {
      var hd = handles().filter(function (x) { return x.id === S.act; })[0];
      if (!hd) { $('sndLive').textContent = 'No marked section – tick one below.'; return; }
      var s = S.sec[hd.k], rp = hd.d.rpm ? ', ' + fmtRpm(s[hd.w === 't0' ? 'rpm0' : 'rpm1']) + ' rpm' : '';
      $('sndLive').textContent = hd.d.label + ' ' + (hd.w === 't0' ? 'start' : 'end') + ': ' + hd.t.toFixed(2) + ' s' + rp;
    }
    root.addEventListener('resize', function () { draw(); });

    // ---------------------------------------------------------------- Hören
    function stopPlay() { if (S.play && S.play.h) S.play.h.stop(); S.play = null; }
    function tickPlay() {
      if (!S.play) return;
      draw();
      var ctx = o.ctx();
      if (ctx && S.play.t1 != null && ctx.currentTime - S.play.at > S.play.t1 - S.play.t0 + 0.05) { S.play = null; draw(); return; }
      requestAnimationFrame(tickPlay);
    }
    function playRange(kind, w, label) {
      var a = A();
      if (!a || !S.src) return;
      o.resume();
      stopPlay();
      var p = S.play = { h: null };
      a.playSection(S.src, kind, w, 3).then(function (h) {
        if (S.play !== p) { if (h) h.stop(); return; }
        if (!h) { o.say('Could not play this part.', 'err'); return; }
        p.h = h;
        var once = kind !== 'idle' && kind !== 'limiter';
        if (once) { p.t0 = Array.isArray(w) ? w[0] : w.t0; p.t1 = Array.isArray(w) ? w[1] : w.t1; p.at = o.ctx().currentTime; requestAnimationFrame(tickPlay); }
        o.say('Playing: ' + label + (once ? '.' : ' (looped, 3 s).'), 'ok');
      });
    }
    function playSec(k) {
      var s = S.sec[k], d = SECS.filter(function (x) { return x.k === k; })[0];
      if (!s || !s.on) return;
      simStop(true);
      playRange(k, d.rpm ? { t0: s.t0, t1: s.t1 } : [s.t0, s.t1], d.name + ' ' + s.t0.toFixed(2) + '–' + s.t1.toFixed(2) + ' s');
    }
    $('sndPlayAll').addEventListener('click', function () { simStop(true); playRange('start', [S.view[0], dur()], 'recording from ' + S.view[0].toFixed(1) + ' s'); });
    $('sndStopAll').addEventListener('click', function () { stopPlay(); simStop(); draw(); });
    $('sndSrc').addEventListener('change', function () { loadSrc(+$('sndSrc').value).then(function () { touched(); }); });

    // ---------------------------------------------------------------- Gang-Simulator
    var sim = { v: null, key: '', kmh: 0, thr: 0, act: null, t: 0, lastGear: 1, cutT: 0, timer: 0, brake: false, hold: 0 };
    function race() { var r = o.race() || {}; return { vmax: Math.max(30, +r.vmax || 250), acc: Math.max(1.5, +r.acc || 6) }; }
    function simInfo() {
      var r = race();
      $('simInfo').textContent = 'Uses this car’s race stats: top speed ' + Math.round(r.vmax) + ' km/h, 0–100 km/h in ' + r.acc + ' s.';
    }
    function voiceKey() { return S.type + '|' + JSON.stringify(o.def().sound || null); }
    function simVoice() {
      var a = A();
      if (!a) return null;
      if (sim.v && sim.key === voiceKey()) return sim.v;
      var keep = sim.v ? { rpm: sim.v.rpm(), gear: sim.v.gear() } : null;
      if (sim.v) sim.v.stop();
      sim.key = voiceKey();
      sim.v = a.voice(S.type, { gain: 1, seed: o.car().key, sound: o.def().sound || null });
      if (!keep) sim.v.oneShot('start', 0.6);
      return sim.v;
    }
    // Entwurf geändert, während der Simulator läuft: Stimme neu (kurz verzögert, damit Tippen nicht dauernd neu baut)
    function simRebuild() {
      if (!sim.timer) return;
      clearTimeout(sim.rb);
      sim.rb = setTimeout(function () { if (sim.timer && sim.key !== voiceKey()) { simVoice(); applyAct(); } }, 350);
    }
    function pressed(act) {
      Array.prototype.forEach.call(document.querySelectorAll('.sim-b'), function (b) {
        if (['acc100', 'vmax', 'hold', 'lift', 'neutral'].indexOf(b.dataset.act) >= 0) b.setAttribute('aria-pressed', b.dataset.act === act ? 'true' : 'false');
      });
    }
    function applyAct() {
      var v = sim.v;
      if (!v) return;
      v.manual(sim.act === 'hold' || !!sim.manual);
      v.neutral(sim.act === 'neutral');
    }
    function simStart(act) {
      var a = A();
      if (!a) { o.say('No Web Audio in this browser.', 'err'); return; }
      o.resume(); stopPlay();
      a.ready.then(function (ok) {
        if (!ok) { o.say('Engine sounds could not be loaded.', 'err'); return; }
        var v = simVoice();
        if (!v) return;
        if (act === 'up' || act === 'down') {
          sim.manual = true; v.manual(true); v.shift(act === 'up' ? 1 : -1);
          if (!sim.act) sim.act = 'idle';
          $('simState').textContent = 'Shifted ' + (act === 'up' ? 'up' : 'down') + ' – gears stay where you put them until Lift off or a new run.';
        } else {
          sim.act = act; sim.t = 0; sim.brake = false; sim.hold = 0;
          sim.manual = act === 'hold';
          if (act === 'acc100' || act === 'vmax' || act === 'neutral') sim.kmh = 0;
          $('simState').textContent = { acc100: 'Accelerating 0–100 km/h, then braking.', vmax: 'Accelerating to top speed, holding it, then braking.',
            hold: 'Full throttle, no automatic shifting – runs into the rev limiter.', lift: 'Throttle off, rolling out.',
            neutral: 'Revving in neutral: short burst, then a long one into the limiter.' }[act] || '';
        }
        pressed(sim.act);
        applyAct();
        if (!sim.timer) { sim.last = performance.now(); sim.timer = setInterval(simTick, 40); }
      });
    }
    function simStop(quiet) {
      if (sim.timer) clearInterval(sim.timer);
      sim.timer = 0;
      if (sim.v) sim.v.stop();
      sim.v = null; sim.act = null; sim.kmh = 0; sim.manual = false;
      pressed(null);
      $('simRpm').value = 0; $('simRpmOut').textContent = '0'; $('simGear').textContent = '–'; $('simKmh').textContent = '0 km/h';
      if (!quiet) $('simState').textContent = 'Engine off.';
    }
    function simTick() {
      var now = performance.now(), dt = clamp((now - sim.last) / 1000, 0, 0.1), v = sim.v;
      sim.last = now;
      if (!v) return;
      var sp = v.spec(), r = race();
      if (!sp) return;                                                     // Klänge laden noch
      sim.t += dt;
      var act = sim.act, vmax = r.vmax, thr = 0;
      if (act === 'acc100') { if (!sim.brake && sim.kmh >= Math.min(100, vmax * 0.95)) sim.brake = true; thr = sim.brake ? 0 : 1; if (sim.brake && sim.kmh <= 0) done(); }
      else if (act === 'vmax') {
        if (!sim.brake && sim.kmh >= vmax * 0.985) sim.hold += dt;
        if (sim.hold > 2 || sim.t > 90) sim.brake = true;
        thr = sim.brake ? 0 : 1;
        if (sim.brake && sim.kmh <= 0) done();
      } else if (act === 'hold') thr = 1;
      else if (act === 'lift') { thr = 0; if (sim.kmh <= 0) done(); }
      else if (act === 'neutral') {
        thr = sim.t < 0.6 ? 1 : sim.t < 1.6 ? 0 : sim.t < 4.6 ? 1 : 0;
        if (sim.t > 6) { done(); }
      }
      var info = v.info();
      if (info.gear !== sim.lastGear) { if (info.gear > sim.lastGear) sim.cutT = 0.2; sim.lastGear = info.gear; }
      sim.cutT = Math.max(0, sim.cutT - dt);
      // Fahrphysik: 0–100 in acc s (Luftwiderstand ∝ v²: dv/dt = A·(1 − (v/vmax)²) → t(v) = vmax/A · artanh(v/vmax))
      var x = sim.kmh / vmax, Aacc = vmax * Math.atanh(Math.min(0.95, 100 / vmax)) / r.acc;
      var acc = act === 'neutral' ? 0 : thr * Aacc * (1 - x * x) * (sim.cutT > 0 ? 0 : 1);
      var dec = thr > 0 ? 0 : sim.brake ? Math.max(25, vmax / 10) : 2 + 10 * x * x;
      sim.kmh = clamp(sim.kmh + (acc - dec) * dt, 0, vmax);
      // von Hand gehaltener Gang: nicht schneller, als der Begrenzer im Gang zulässt
      if (sim.manual && M) {
        var rr = M.ratios(sp), g = clamp(info.gear, 1, rr.length), cap = vmax / (rr[g - 1] * M.tune(sp).vtop);
        if (sim.kmh > cap) sim.kmh = cap;
      }
      if (act === 'neutral') sim.kmh = 0;
      v.update(dt, { speed: sim.kmh / vmax, throttle: thr });
      var rpm = v.rpm();
      $('simRpm').max = sp.red; $('simRpm').low = Math.round(sp.red * 0.85); $('simRpm').high = Math.round(sp.red * 0.97); $('simRpm').optimum = Math.round(sp.red * 0.4);
      $('simRpm').value = Math.round(rpm);
      $('simRpmOut').textContent = fmtRpm(rpm) + ' rpm' + (info.limiter ? ' · limiter' : '');
      $('simGear').textContent = act === 'neutral' ? 'N' : String(info.gear);
      $('simKmh').textContent = Math.round(sim.kmh) + ' km/h';
      function done() { sim.act = 'idle'; sim.manual = false; applyAct(); pressed(null); $('simState').textContent = 'Idling. Pick the next run or stop the engine.'; }
    }
    Array.prototype.forEach.call(document.querySelectorAll('.sim-b'), function (b) {
      b.addEventListener('click', function () { if (b.dataset.act === 'stop') simStop(); else simStart(b.dataset.act); });
    });

    // ---------------------------------------------------------------- Zurücksetzen / Füllen
    $('sndReset').addEventListener('click', function () {
      delete o.def().sound; fill(true); simRebuild();
      o.say('Sound reset to automatic. Save to keep it.', 'ok');
    });

    function fill(force) {
      var car = o.car(), type = o.type(), a = A();
      if (!car) return;
      var same = !force && S.car === car.key && S.type === type;
      S.car = car.key; S.type = type;
      simInfo();
      var ev = type === 'ev';
      $('sndNone').hidden = !ev; $('sndBody').hidden = ev;
      mode();
      if (ev || !a || !M) { mode(); return; }
      if (same) { mode(); return; }
      stopPlay(); simStop(true);
      $('simState').textContent = '';
      var ds = o.def().sound || null;
      S.own = !!(ds && ds.src);
      Promise.all([a.ready, a.sources(), a.autoSrc(type, car.key)]).then(function (r) {
        if (S.car !== car.key || S.type !== type) return;
        S.index = (r[1] && r[1].sources) || {};
        S.autoSrc = r[2];
        fillParams();
        fillSelect();
        var want = ds && ds.src && S.index[ds.src] ? ds.src : S.index[S.autoSrc] ? S.autoSrc
          : +(($('sndSrc').options[0] || {}).value || 0);
        mode();
        if (!want) { S.src = null; S.buf = null; draw(); return; }
        loadSrc(want, false).then(function () {
          // gespeicherte Markierungen über die Vorschläge legen (null = aus)
          if (ds && ds.src === want) {
            SECS.forEach(function (d) {
              if (ds[d.k] === null) { if (S.sec[d.k]) S.sec[d.k].on = false; }
              else if (ds[d.k]) {
                var v = ds[d.k];
                S.sec[d.k] = d.rpm ? { t0: v.t0, t1: v.t1, rpm0: v.rpm0, rpm1: v.rpm1, on: true } : { t0: v[0], t1: v[1], on: true };
              }
              syncSec(d.k);
            });
            draw();
          }
        });
      });
    }

    SECS.forEach(function (d) { syncSec(d.k); });
    return { fill: fill, stop: function () { stopPlay(); simStop(true); } };
  }

  root.CarSoundEditor = { create: create, SECS: SECS };
})(typeof window !== 'undefined' ? window : this);
