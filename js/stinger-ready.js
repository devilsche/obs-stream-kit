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
    'html.stinger-loading *::after { animation-play-state: paused !important; }' +
    // Stummer Neustart: Video waehrend des Nachladens unsichtbar (sonst
    // kurzer schwarzer Kasten), danach weich einblenden
    'video.stinger-reload, video.stinger-wait { opacity: 0 !important; }' +
    'video.stinger-reveal { animation: stingerReveal .4s ease-out !important; }' +
    '@keyframes stingerReveal { from { opacity: 0; } to { opacity: 1; } }';
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

  // Bricht die Audio-Ausgabe der Browser-Engine weg (z.B. nach einem
  // Stream-Reconnect: AUDIO_RENDERER_ERROR), scheitert play() oder das
  // Video bricht mitten drin ab. Videos laufen dann stumm weiter, damit
  // wenigstens das Bild kommt. console.error landet im OBS-Log.
  function playMuted(m, reason) {
    if (m.muted) return null;
    console.error('[stinger-ready] audio failed, continuing muted:', m.currentSrc || m.src, reason);
    m.muted = true;
    try { return m.play(); } catch (e) { return null; }
  }

  function watchAudioFailure(m) {
    if (m.tagName !== 'VIDEO' || m._stingerWatched) return;
    m._stingerWatched = true;
    m.addEventListener('error', function () {
      var err = m.error;
      if (m.muted || !err) return;
      var t = m.currentTime || 0;
      console.error('[stinger-ready] media error, reloading muted:', m.currentSrc || m.src, err.code, err.message);
      m.muted = true;
      m.addEventListener('loadeddata', function () {
        try { m.currentTime = t; } catch (e) {}
        m.play().catch(function (e2) { console.error('[stinger-ready] muted replay failed:', e2); });
      }, { once: true });
      try { m.load(); } catch (e) {}
    });
  }

  // Haengt die Audio-Ausgabe, kommt weder Fehler noch abgelehntes play() —
  // das Video bleibt einfach auf dem ersten Frame stehen. Dann stumm neu
  // laden. Puffern zaehlt nicht: erst wenn mindestens 1 s Video geladen ist
  // und es trotzdem 1,5 s steht, ist es das Audio (readyState taugt nicht —
  // bei haengendem Audio bleibt er unter 3). Nach 6 s ohne Bewegung greift
  // der Neustart in jedem Fall.
  function bufferedAhead(m) {
    try { return m.buffered.length ? m.buffered.end(m.buffered.length - 1) : 0; }
    catch (e) { return 0; }
  }

  function reloadMuted(m, t0) {
    console.error('[stinger-ready] video stalled, reloading muted:', m.currentSrc || m.src);
    m.muted = true;
    m.classList.add('stinger-reload');
    m.addEventListener('playing', function () {
      m.classList.remove('stinger-reload');
      m.classList.add('stinger-reveal');
    }, { once: true });
    m.addEventListener('loadeddata', function () {
      // Dort weiter, wo das Video laut Animation schon sein muesste
      try { m.currentTime = (Date.now() - t0) / 1000; } catch (e) {}
      m.play().catch(function (e2) { console.error('[stinger-ready] muted replay failed:', e2); });
    }, { once: true });
    try { m.load(); } catch (e) {}
  }

  function watchStall(m) {
    if (m.tagName !== 'VIDEO') return;
    var t0 = Date.now();
    var stuckSince = null;
    var iv = setInterval(function () {
      if (m.muted || m.ended || m.currentTime > 0) { clearInterval(iv); return; }
      var waited = Date.now() - t0;
      var loaded = bufferedAhead(m) >= 1 || m.readyState >= 3;
      if (!loaded) stuckSince = null;
      else if (stuckSince === null) stuckSince = Date.now();
      if ((stuckSince !== null && Date.now() - stuckSince >= 1500) || waited >= 6000) {
        clearInterval(iv);
        reloadMuted(m, t0);
      }
    }, 250);
  }

  function tryPlay(m) {
    watchAudioFailure(m);
    watchStall(m);
    if (m._stingerFollow) setTimeout(m._stingerFollow, 600);
    var p;
    try { p = m.play(); } catch (e) {
      console.warn('[stinger-ready] play() threw:', e);
      return m.tagName === 'VIDEO' ? playMuted(m, e) : null;
    }
    if (!p || typeof p.catch !== 'function') return p || null;
    return p.catch(function (err) {
      if (m._stingerFollow) m._stingerFollow();
      if (m.tagName === 'VIDEO' && !m.muted) {
        var p2 = playMuted(m, err);
        if (p2 && typeof p2.then === 'function') return p2;
      }
      console.warn('[stinger-ready] autoplay blocked for', m.currentSrc || m.src, '— retrying on next click', err);
      var retry = function () {
        document.removeEventListener('click', retry);
        document.removeEventListener('keydown', retry);
        try { m.play().catch(function () {}); } catch (e) {}
      };
      document.addEventListener('click', retry, { once: true });
      document.addEventListener('keydown', retry, { once: true });
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

      // readyState >= 3 (HAVE_FUTURE_DATA) = canplay-Equivalent — Event könnte bereits
      // vor diesem Listener gefeuert haben (bei autoplay + preload=auto auf localhost)
      if (m.readyState >= 3) {
        check();
        return;
      }

      // canplay (enough buffered to START) + loadeddata (first frame/audio available)
      // deutlich schneller als canplaythrough (das auf komplette Pufferung wartet)
      m.addEventListener('canplay',    check);
      m.addEventListener('loadeddata', check);
      m.addEventListener('error',      check);

      // Fallback wenn gar kein Event feuert — 3s Safety für langsame Assets
      setTimeout(check, 3000);

      // Nur neu laden wenn preload nicht schon auto ist — sonst brechen wir
      // den bereits laufenden Fetch ab (Chrome zeigt das als "canceled cross-origin")
      if (m.preload !== 'auto') {
        m.preload = 'auto';
        try { m.load(); } catch (e) {}
      }
    });
  }

  // Ton und Bild trennen: Videos mit Tonspur laufen stumm, der Ton kommt aus
  // einem unsichtbaren <audio> mit derselben Datei. Haengt die Audio-Ausgabe
  // der Browser-Engine, haengt sonst das ganze Video — stumm laeuft es
  // immer, und zwar puenktlich statt erst nach einem Neustart.
  function splitVideoAudio() {
    var videos = document.querySelectorAll('video[data-stinger-autoplay]');
    Array.prototype.forEach.call(videos, function (v) {
      var src = v.getAttribute('src');
      if (v.muted || v.hasAttribute('muted') || !src) return;
      var a = document.createElement('audio');
      a.src = src;
      a.preload = 'auto';
      a.setAttribute('data-stinger-autoplay', '');
      if (v.hasAttribute('data-delay')) a.setAttribute('data-delay', v.getAttribute('data-delay'));
      v.muted = true;
      v.setAttribute('muted', '');
      // Das Video startet nicht selbst, sondern sobald der Ton wirklich
      // laeuft — wie frueher, als Bild und Ton im selben Element hingen und
      // die Animationen darauf abgestimmt wurden. Kommt kein Ton (Ausgabe
      // haengt oder abgelehnt), startet das Bild nach 600 ms trotzdem.
      v.removeAttribute('data-stinger-autoplay');
      v.removeAttribute('autoplay');
      v.autoplay = false;
      // Bis zum ersten echten Frame unsichtbar — ein wartendes Video malt in
      // OBS sonst einen schwarzen Kasten, wo der Greenscreen sein sollte
      v.classList.add('stinger-wait');
      v.addEventListener('playing', function () { v.classList.remove('stinger-wait'); }, { once: true });
      var followed = false;
      a._stingerFollow = function () {
        if (followed) return;
        followed = true;
        v.play().catch(function (e) { console.error('[stinger-ready] video play failed:', e); });
      };
      a.addEventListener('playing', a._stingerFollow, { once: true });
      v.parentNode.insertBefore(a, v.nextSibling);
      // Pause/Springen (Tune-Panel) mitnehmen
      v.addEventListener('pause', function () { a.pause(); });
      v.addEventListener('seeked', function () {
        try { a.currentTime = v.currentTime; } catch (e) {}
        if (!v.paused) a.play().catch(function () {});
      });
    });
  }

  function init() {
    splitVideoAudio();
    waitForFonts();
    waitForMedia();
    // Absolute Safety: max 5s — auch wenn Assets langsam laden, irgendwann muss der Stinger starten
    setTimeout(startAnimations, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
