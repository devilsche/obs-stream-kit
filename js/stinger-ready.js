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

    // Autoplay-Audios und -Videos abspielen (mit optionalem Delay)
    var medias = document.querySelectorAll('audio[data-stinger-autoplay], video[data-stinger-autoplay]');
    Array.prototype.forEach.call(medias, function (m) {
      var delay = parseInt(m.getAttribute('data-delay'), 10) || 0;
      if (delay > 0) {
        setTimeout(function () {
          try { m.play().catch(function () {}); } catch (e) {}
        }, delay);
      } else {
        try { m.play().catch(function () {}); } catch (e) {}
      }
    });
  }

  var ready = { fonts: false, media: false };

  function maybeGo() {
    if (ready.fonts && ready.media) startAnimations();
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

  function waitForMedia() {
    var medias = document.querySelectorAll('audio, video');
    if (medias.length === 0) {
      ready.media = true;
      maybeGo();
      return;
    }

    var total = medias.length;
    var loaded = 0;

    Array.prototype.forEach.call(medias, function (m) {
      var done = false;
      function check() {
        if (done) return;
        done = true;
        loaded++;
        if (loaded >= total) {
          ready.media = true;
          maybeGo();
        }
      }
      // canplay (enough buffered to START) + loadeddata (first frame/audio available)
      // deutlich schneller als canplaythrough (das auf komplette Pufferung wartet)
      m.addEventListener('canplay',    check);
      m.addEventListener('loadeddata', check);
      m.addEventListener('error',      check);

      // Fallback wenn gar kein Event feuert
      setTimeout(check, 1200);

      if (m.preload !== 'auto') m.preload = 'auto';
      try { m.load(); } catch (e) {}
    });
  }

  function init() {
    waitForFonts();
    waitForMedia();
    // Absolute Safety: max 2s Wartezeit
    setTimeout(startAnimations, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
