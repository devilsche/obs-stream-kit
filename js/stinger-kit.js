/*
  Stinger-Kit — obs-stream-kit

  Gemeinsame Bausteine fuer Stinger mit synthetischem Sound (Web Audio)
  statt MP3. Nach js/stinger-ready.js einbinden.

    StingerKit.vars({x: '50%'})        → CSS-Variablen auf :root (per <style>,
                                         kein Inline-Style)
    StingerKit.timings(name, DEFAULTS) → Zeitpunkte in Sekunden; Overrides aus
                                         dem Tune-Panel (localStorage), landen
                                         als --<key>: Xs auf :root
    StingerKit.audio()                 → {ctx, out} oder null bei ?sound=0
    StingerKit.onStart(fn)             → fn(), sobald stinger-ready die
                                         Animationen freigibt
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

  var audioState;
  function audio() {
    if (audioState !== undefined) return audioState;
    audioState = null;
    if (params.get('sound') === '0') return null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    var ctx;
    try { ctx = new AC(); } catch (e) { return null; }
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    var out = ctx.createGain();
    var vol = parseFloat(params.get('volume'));
    out.gain.value = isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 0.8;
    out.connect(comp);
    // Im normalen Browser blockt die Autoplay-Policy — erster Klick weckt auf.
    // OBS spielt ohne Klick.
    var wake = function () { if (ctx.state === 'suspended') ctx.resume(); };
    document.addEventListener('pointerdown', wake);
    document.addEventListener('keydown', wake);
    audioState = { ctx: ctx, out: out };
    return audioState;
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
      var a = audioState;
      if (a && a.ctx.state === 'suspended') a.ctx.resume();
      fn();
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
                       'Click anywhere once to enable sound in a normal browser.';
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
