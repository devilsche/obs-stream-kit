/*
  Stinger Asset-Wait Helper — obs-stream-kit

  Pausiert alle CSS-Animationen bis Fonts + Audio geladen sind.
  Dann: Animationen starten gleichzeitig und Audio spielt ab.

  Beim erneuten Sichtbarwerden (OBS triggert Stinger erneut, Browser Source
  bleibt im Speicher): Animationen + Audio werden vollständig zurückgesetzt
  und neu gestartet — Sound spielt immer von Anfang und vollständig.

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

  // Sofort: Animationen pausieren via class
  html.classList.add('stinger-loading');

  // CSS injekten für Pause + Reset
  var styleEl = document.createElement('style');
  styleEl.textContent =
    'html.stinger-loading *, ' +
    'html.stinger-loading *::before, ' +
    'html.stinger-loading *::after { animation-play-state: paused !important; }' +
    'html.stinger-resetting *, ' +
    'html.stinger-resetting *::before, ' +
    'html.stinger-resetting *::after { animation: none !important; }';
  (document.head || html).appendChild(styleEl);

  var initialized = false;
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
      console.warn('[stinger-ready] autoplay blocked for', m.currentSrc || m.src, err);
    });
    return p;
  }

  // Vollständiger Reset + Neustart (OBS triggert Stinger erneut)
  function restartStinger() {
    if (!initialized) return;
    started = false;

    // Audio/Video stoppen und zurückspulen
    var medias = document.querySelectorAll('audio[data-stinger-autoplay], video[data-stinger-autoplay]');
    Array.prototype.forEach.call(medias, function (m) {
      try { m.pause(); m.currentTime = 0; } catch (e) {}
    });

    // CSS-Animationen auf Frame 0 zurücksetzen:
    // 1. stinger-resetting → animation: none (alle Animationen entfernt, Element auf Ausgangszustand)
    html.classList.add('stinger-resetting');
    void html.offsetWidth; // Reflow — Browser verarbeitet animation: none

    // 2. Reset weg + Loading rein (atomisch vor nächstem Reflow)
    //    → Animationen starten frisch, aber sofort pausiert
    html.classList.remove('stinger-resetting');
    html.classList.add('stinger-loading');
    void html.offsetWidth; // Reflow — Browser kennt neuen Animations-Startpunkt

    // 3. Los!
    startAnimations();
  }

  // Sichtbarkeit-Listener: OBS zeigt Stinger erneut
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) restartStinger();
  });

  var ready = { fonts: false, media: false };

  function maybeGo() {
    if (ready.fonts && ready.media) {
      initialized = true;
      startAnimations();
    }
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
      m.addEventListener('canplay',    check);
      m.addEventListener('loadeddata', check);
      m.addEventListener('error',      check);
      setTimeout(check, 600);

      if (m.preload !== 'auto') {
        m.preload = 'auto';
        try { m.load(); } catch (e) {}
      }
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
