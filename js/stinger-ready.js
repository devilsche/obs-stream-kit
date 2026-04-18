/*
  Stinger Asset-Wait Helper — obs-stream-kit

  Pausiert alle CSS-Animationen bis Fonts + Audio geladen sind.
  Dann: Animationen starten gleichzeitig und Audio spielt ab.

  Verwendung im Stinger-HTML:

    <head>
      <script src="../js/stinger-ready.js"></script>
      ...
    </head>

    <body>
      ...
      <!-- Audio sofort beim Ready abspielen: -->
      <audio data-stinger-autoplay preload="auto" src="../assets/stingers/khan.mp3"></audio>

      <!-- Audio mit Delay nach Ready abspielen: -->
      <audio data-stinger-autoplay data-delay="1600" preload="auto" src="..."></audio>
    </body>

  Safety: Falls Assets nie laden → Start nach max. 4s.
*/

(function () {
  'use strict';

  var html = document.documentElement;

  // Sofort: Animationen pausieren via class
  html.classList.add('stinger-loading');

  // Pause-CSS injecten (damit jedes Stinger-HTML nicht extra dafür sorgen muss)
  var styleEl = document.createElement('style');
  styleEl.textContent =
    'html.stinger-loading *, ' +
    'html.stinger-loading *::before, ' +
    'html.stinger-loading *::after { animation-play-state: paused !important; }';
  (document.head || html).appendChild(styleEl);

  var started = false;

  function startAnimations() {
    if (started) return;
    started = true;
    html.classList.remove('stinger-loading');

    // Autoplay-Audios abspielen (mit optionalem Delay)
    var audios = document.querySelectorAll('audio[data-stinger-autoplay]');
    Array.prototype.forEach.call(audios, function (a) {
      var delay = parseInt(a.getAttribute('data-delay'), 10) || 0;
      if (delay > 0) {
        setTimeout(function () {
          try { a.play().catch(function () {}); } catch (e) {}
        }, delay);
      } else {
        try { a.play().catch(function () {}); } catch (e) {}
      }
    });
  }

  var ready = { fonts: false, audio: false };

  function maybeGo() {
    if (ready.fonts && ready.audio) startAnimations();
  }

  function waitForFonts() {
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        ready.fonts = true;
        maybeGo();
      });
    } else {
      ready.fonts = true;
      maybeGo();
    }
  }

  function waitForAudio() {
    var audios = document.querySelectorAll('audio');
    if (audios.length === 0) {
      ready.audio = true;
      maybeGo();
      return;
    }

    var total = audios.length;
    var loaded = 0;

    Array.prototype.forEach.call(audios, function (a) {
      var done = false;
      function check() {
        if (done) return;
        done = true;
        loaded++;
        if (loaded >= total) {
          ready.audio = true;
          maybeGo();
        }
      }
      a.addEventListener('canplaythrough', check);
      a.addEventListener('error', check);

      // Fallback falls canplaythrough nicht feuert (manche Browser/Codecs)
      setTimeout(check, 2500);

      if (a.preload !== 'auto') a.preload = 'auto';
      try { a.load(); } catch (e) {}
    });
  }

  function init() {
    waitForFonts();
    waitForAudio();
    // Absolute Safety: max 4s Wartezeit
    setTimeout(startAnimations, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
