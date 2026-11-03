/*
  Stinger-Kit — obs-stream-kit

  Gemeinsame Bausteine fuer Stinger mit synthetischem Sound (Web Audio)
  statt MP3. Nach js/stinger-ready.js einbinden.

    StingerKit.vars({x: '50%'})        → CSS-Variablen auf :root (per <style>,
                                         kein Inline-Style)
    StingerKit.timings(name, DEFAULTS) → Zeitpunkte in Sekunden; Overrides aus
                                         dem Tune-Panel (localStorage), landen
                                         als --<key>: Xs auf :root
    StingerKit.audio()                 → {ctx, out} oder null bei ?sound=0;
                                         ctx ist ein OfflineAudioContext
    StingerKit.onStart(fn)             → fn(), sobald stinger-ready die
                                         Animationen freigibt; danach wird
                                         der eingeplante Ton gerendert und
                                         per <audio> abgespielt
    StingerKit.tune(name, DEFAULTS, LABELS) → Panel bei ?tune=1

  Audio und CSS-Animationen nutzen dieselben Zeitpunkte, laufen also
  synchron, solange onStart als Nullpunkt dient.
*/
(function () {
  'use strict';

  var html = document.documentElement;
  var params = new URLSearchParams(window.location.search);

  function vars(map) {
    var css = ':root{';
    Object.keys(map).forEach(function (k) { css += '--' + k + ':' + map[k] + ';'; });
    var el = document.createElement('style');
    el.textContent = css + '}';
    (document.head || html).appendChild(el);
  }

  function storageKey(name) { return 'stinger-kit:' + name; }

  function timings(name, defaults) {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey(name)) || '{}') || {}; } catch (e) {}
    var out = {};
    var cssVars = {};
    Object.keys(defaults).forEach(function (k) {
      var v = typeof saved[k] === 'number' ? saved[k] : defaults[k];
      out[k] = v;
      cssVars[k] = v + 's';
    });
    vars(cssVars);
    return out;
  }

  // Der Ton wird nicht live über Web Audio ausgegeben, sondern vorab in einen
  // OfflineAudioContext gerendert, als WAV verpackt und über ein normales
  // <audio>-Element abgespielt — derselbe Weg wie bei den MP3-Stingern, der in
  // OBS nachweislich funktioniert. Die Stinger merken davon nichts: sie planen
  // ihre Töne wie gewohnt ab ctx.currentTime (hier 0) ein.
  var RENDER_SECONDS = 8;
  var RATE = 44100;
  var audioState;
  function audio() {
    if (audioState !== undefined) return audioState;
    audioState = null;
    if (params.get('sound') === '0') return null;
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) { console.error('[stinger-kit] no OfflineAudioContext, sound disabled'); return null; }
    var ctx;
    try { ctx = new OAC(2, RATE * RENDER_SECONDS, RATE); } catch (e) {
      console.error('[stinger-kit] OfflineAudioContext failed:', e);
      return null;
    }
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    var out = ctx.createGain();
    var vol = parseFloat(params.get('volume'));
    out.gain.value = isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 0.8;
    out.connect(comp);
    audioState = { ctx: ctx, out: out };
    return audioState;
  }

  function toWav(buf) {
    var ch = buf.numberOfChannels, n = buf.length;
    // Stille am Ende abschneiden
    var endAt = 0;
    for (var c = 0; c < ch; c++) {
      var d = buf.getChannelData(c);
      for (var i = n - 1; i > endAt; i--) { if (Math.abs(d[i]) > 0.0005) { endAt = i; break; } }
    }
    n = Math.min(buf.length, endAt + Math.floor(RATE * 0.1));
    var bytes = 44 + n * ch * 2;
    var v = new DataView(new ArrayBuffer(bytes));
    function str(o, t) { for (var k = 0; k < t.length; k++) v.setUint8(o + k, t.charCodeAt(k)); }
    str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, ch, true); v.setUint32(24, RATE, true);
    v.setUint32(28, RATE * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * ch * 2, true);
    var chans = [];
    for (var c2 = 0; c2 < ch; c2++) chans.push(buf.getChannelData(c2));
    var o = 44;
    for (var j = 0; j < n; j++) {
      for (var c3 = 0; c3 < ch; c3++) {
        var x = Math.max(-1, Math.min(1, chans[c3][j]));
        v.setInt16(o, x * 32767, true);
        o += 2;
      }
    }
    return new Blob([v.buffer], { type: 'audio/wav' });
  }

  // Rendern dauert einige zehn Millisekunden — das Element startet deshalb
  // an der Stelle, an der die Animation inzwischen ist.
  function playRendered(t0) {
    var a = audioState;
    if (!a) return;
    a.ctx.startRendering().then(function (buf) {
      var el = new Audio(URL.createObjectURL(toWav(buf)));
      el.preload = 'auto';
      el.addEventListener('loadedmetadata', function () {
        var offset = (performance.now() - t0) / 1000;
        if (offset > 0.05) { try { el.currentTime = offset; } catch (e) {} }
        var p = el.play();
        if (p && p.catch) p.catch(function (err) {
          // Normaler Browser ohne Klick: beim ersten Klick von vorn
          console.warn('[stinger-kit] autoplay blocked, click to play', err);
          var retry = function () { el.currentTime = 0; el.play().catch(function () {}); };
          document.addEventListener('pointerdown', retry, { once: true });
          document.addEventListener('keydown', retry, { once: true });
        });
      }, { once: true });
      el.addEventListener('error', function () {
        console.error('[stinger-kit] audio element error', el.error && el.error.code);
      });
    }).catch(function (e) { console.error('[stinger-kit] rendering failed:', e); });
  }

  // Rauschpuffer werden von mehreren Stingern gebraucht (Regen, Gong, Stempel)
  function noiseBuffer(ctx, seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function onStart(fn) {
    var fired = false;
    function go() {
      if (fired) return;
      fired = true;
      var t0 = performance.now();
      fn();
      playRendered(t0);
    }
    if (!html.classList.contains('stinger-loading')) { go(); return; }
    var mo = new MutationObserver(function () {
      if (!html.classList.contains('stinger-loading')) { mo.disconnect(); go(); }
    });
    mo.observe(html, { attributes: true, attributeFilter: ['class'] });
  }

  var TUNE_CSS =
    '.sk-tune{position:fixed;top:24px;right:24px;width:380px;z-index:1000;' +
    'background:rgba(20,10,30,.94);border:2px solid #f2b705;border-radius:10px;padding:16px;' +
    'color:#f2b705;font:13px "Courier New",monospace;box-shadow:0 0 30px rgba(242,183,5,.35)}' +
    '.sk-tune h2{font-size:15px;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px}' +
    '.sk-tune__row{display:flex;justify-content:space-between;align-items:center;gap:10px;' +
    'padding:4px 0;border-bottom:1px solid rgba(242,183,5,.2)}' +
    '.sk-tune__row label{color:rgba(255,220,150,.85);font-size:12px}' +
    '.sk-tune input{width:76px;background:rgba(242,183,5,.1);border:1px solid rgba(242,183,5,.45);' +
    'color:#f2b705;padding:4px 6px;font:inherit;text-align:right;border-radius:3px}' +
    '.sk-tune input:focus-visible,.sk-tune button:focus-visible{outline:2px solid #fff;outline-offset:2px}' +
    '.sk-tune__actions{display:flex;gap:8px;margin-top:12px}' +
    '.sk-tune button{flex:1;min-height:32px;background:rgba(242,183,5,.15);border:1px solid #f2b705;' +
    'color:#f2b705;font:700 12px "Courier New",monospace;text-transform:uppercase;letter-spacing:1px;' +
    'border-radius:4px;cursor:pointer}' +
    '.sk-tune button:hover{background:rgba(242,183,5,.3)}' +
    '.sk-tune button.sk-tune__reset{border-color:#ff8888;color:#ff8888}' +
    '.sk-tune__hint{margin-top:10px;font-size:10px;color:rgba(255,220,150,.65);line-height:1.4}';

  function tune(name, defaults, labels) {
    if (params.get('tune') !== '1') return;
    var cur = timings(name, defaults);
    var st = document.createElement('style');
    st.textContent = TUNE_CSS;
    document.head.appendChild(st);

    var panel = document.createElement('section');
    panel.className = 'sk-tune';
    panel.setAttribute('aria-label', 'Stinger timing');
    var h = document.createElement('h2');
    h.textContent = name + ' tune';
    panel.appendChild(h);

    var inputs = {};
    Object.keys(defaults).forEach(function (k) {
      var row = document.createElement('div');
      row.className = 'sk-tune__row';
      var lab = document.createElement('label');
      lab.htmlFor = 'sk-' + k;
      lab.textContent = labels[k] || k;
      var inp = document.createElement('input');
      inp.type = 'number'; inp.step = '0.05'; inp.min = '0'; inp.max = '10';
      inp.id = 'sk-' + k;
      inp.value = cur[k];
      inputs[k] = inp;
      row.appendChild(lab);
      row.appendChild(inp);
      panel.appendChild(row);
    });

    function save() {
      var vals = {};
      Object.keys(inputs).forEach(function (k) { vals[k] = parseFloat(inputs[k].value) || 0; });
      try { localStorage.setItem(storageKey(name), JSON.stringify(vals)); } catch (e) {}
      location.reload();
    }
    function reset() {
      try { localStorage.removeItem(storageKey(name)); } catch (e) {}
      location.reload();
    }
    function copy() {
      var lines = Object.keys(inputs).map(function (k) { return k + ': ' + inputs[k].value; });
      if (navigator.clipboard) navigator.clipboard.writeText(lines.join('\n')).catch(function () {});
    }

    var actions = document.createElement('div');
    actions.className = 'sk-tune__actions';
    [['Apply', save, ''], ['Replay', function () { location.reload(); }, ''],
     ['Copy', copy, ''], ['Reset', reset, 'sk-tune__reset']].forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b[0];
      if (b[2]) btn.className = b[2];
      btn.addEventListener('click', b[1]);
      actions.appendChild(btn);
    });
    panel.appendChild(actions);

    var hint = document.createElement('p');
    hint.className = 'sk-tune__hint';
    hint.textContent = 'Times in seconds from start. Apply saves and replays. Keys: R replay, S apply. ' +
                       'Click once to hear the sound in a normal browser.';
    panel.appendChild(hint);

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'r' || e.key === 'R') location.reload();
      else if (e.key === 's' || e.key === 'S') save();
    });

    var mount = function () { document.body.appendChild(panel); };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  }

  // prefers-reduced-motion: Stinger zeigen dann nur Blenden statt Bewegung
  var reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  window.StingerKit = {
    params: params,
    vars: vars,
    timings: timings,
    audio: audio,
    noiseBuffer: noiseBuffer,
    onStart: onStart,
    tune: tune,
    reducedMotion: reducedMotion
  };
})();
