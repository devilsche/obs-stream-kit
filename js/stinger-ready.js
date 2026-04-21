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

  Safety: Falls Assets nie laden → Start nach max. 2s.
*/

(function () {
  'use strict';

  var html = document.documentElement;
  var head = document.head || html;

  // Kein Cache — OBS Browser Source soll nie alte Versionen nutzen
  [
    ['Cache-Control', 'no-cache, no-store, must-revalidate'],
    ['Pragma',        'no-cache'],
    ['Expires',       '0']
  ].forEach(function (pair) {
    var m = document.createElement('meta');
    m.httpEquiv = pair[0];
    m.content   = pair[1];
    head.insertBefore(m, head.firstChild);
  });

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

    // Autoplay-Audios und -Videos anspielen. Animationen starten erst wenn
    // play() wirklich Playback begonnen hat (Promise resolved), damit Audio
    // und Animation synchron starten — auch auf Rechnern mit 100-200ms
    // Audio-Start-Latenz.
    var medias = document.querySelectorAll('audio[data-stinger-autoplay], video[data-stinger-autoplay]');
    var immediatePromises = [];
    Array.prototype.forEach.call(medias, function (m) {
      var delay = parseInt(m.getAttribute('data-delay'), 10) || 0;
      if (delay > 0) {
        // Delayed → nicht auf Start warten
        setTimeout(function () { tryPlay(m); }, delay);
      } else {
        var p = tryPlay(m);
        if (p && typeof p.then === 'function') immediatePromises.push(p.catch(function () {}));
      }
    });

    var release = function () { html.classList.remove('stinger-loading'); };
    if (immediatePromises.length === 0) {
      release();
    } else {
      Promise.all(immediatePromises).then(release);
      // Safety: nach 300ms trotzdem starten falls play() nie resolved
      setTimeout(release, 300);
    }
  }

  function tryPlay(m) {
    var p;
    try { p = m.play(); } catch (e) { console.warn('[stinger-ready] play() threw:', e); return null; }
    if (!p || typeof p.catch !== 'function') return p || null;
    p.catch(function (err) {
      console.warn('[stinger-ready] autoplay blocked for', m.currentSrc || m.src, '— retrying on next click', err);
      var retry = function () {
        document.removeEventListener('click', retry);
        document.removeEventListener('keydown', retry);
        try { m.play().catch(function () {}); } catch (e) {}
      };
      document.addEventListener('click', retry, { once: true });
      document.addEventListener('keydown', retry, { once: true });
    });
    return p;
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
    var all = document.querySelectorAll('audio, video');
    // Nur Media mit Quelle beachten — leere <audio>-/video-Elemente wuerden
    // sonst nie canplay feuern und den Fallback-Timeout triggern
    var medias = Array.prototype.filter.call(all, function (m) {
      return !!(m.src || m.currentSrc || m.querySelector('source[src]'));
    });
    if (medias.length === 0) {
      ready.media = true;
      maybeGo();
      return;
    }

    var total = medias.length;
    var loaded = 0;

    medias.forEach(function (m) {
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

      // Fallback wenn gar kein Event feuert — 8s, damit auch langsame Ladezeiten abgewartet werden
      setTimeout(check, 8000);

      // Nur neu laden wenn preload nicht schon auto ist — sonst brechen wir
      // den bereits laufenden Fetch ab (Chrome zeigt das als "canceled cross-origin")
      if (m.preload !== 'auto') {
        m.preload = 'auto';
        try { m.load(); } catch (e) {}
      }
    });
  }

  function init() {
    waitForFonts();
    waitForMedia();
    // Absolute Safety: max 10s Wartezeit — lieber länger warten als ohne Audio starten
    setTimeout(startAnimations, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
