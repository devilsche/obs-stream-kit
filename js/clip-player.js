/*
 * Shared Clip-Player für alle Szenen.
 *
 * Nutzung:
 *   <div id="clipContainer">
 *     <div class="clip-placeholder"><p class="clip-placeholder__text">...</p></div>
 *     <div class="countdown-overlay" id="countdownOverlay">
 *       <span class="countdown__label">Nächster Clip</span>
 *       <p class="countdown__title" id="countdownTitle"></p>
 *       <span class="countdown__timer" id="countdownTimer"></span>
 *     </div>
 *   </div>
 *   <div class="clip-meta" id="clipMeta">...</div>  (optional)
 *
 * URL-Parameter (automatisch gelesen):
 *   ?clips=Slug1,Slug2,Slug3
 *   &count=100&countdown=5
 */
var ClipPlayer = (function () {

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // Clips laufen als direktes <video> statt im clips.twitch.tv-iframe:
  // Kanaele mit Content Classification Labels bekommen im Embed ein
  // "Start Watching"-Interstitial vorgeschaltet, das auf einen Klick wartet —
  // im Overlay klickt niemand. Die signierte MP4-URL liefert der Server als
  // clip.mp4 mit.

  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatViews(n) {
    if (!n && n !== 0) return '';
    return n.toLocaleString('de-DE') + ' Views';
  }

  function init(opts) {
    opts = opts || {};
    var containerId  = opts.containerId || 'clipContainer';
    var muted        = opts.muted !== undefined ? opts.muted : false;
    var countdownSec = opts.countdown || parseInt(new URLSearchParams(window.location.search).get('countdown'), 10) || 5;

    var container        = document.getElementById(containerId);
    var placeholder      = container ? container.querySelector('.clip-placeholder') : null;
    var countdownOverlay = container ? container.querySelector('.countdown-overlay') : null;
    var countdownTitle   = document.getElementById('countdownTitle');
    var countdownTimer   = document.getElementById('countdownTimer');
    var clipMeta         = document.getElementById('clipMeta');
    var clipMetaTitle    = document.getElementById('clipMetaTitle');
    var clipMetaDetails  = document.getElementById('clipMetaDetails');

    var params       = new URLSearchParams(window.location.search);
    var manualClips  = params.get('clips');
    var clipCount    = parseInt(params.get('count'), 10) || 100;

    var clips = [];
    var currentIndex = 0;
    var clipTimer = null;

    function showError(msg) {
      if (placeholder) {
        var txt = placeholder.querySelector('.clip-placeholder__text');
        if (txt) txt.textContent = msg;
      }
    }

    function showMeta(clip) {
      if (!clipMeta) return;
      if (clipMetaTitle) clipMetaTitle.textContent = clip.title || '';
      if (clipMetaDetails) {
        var parts = [];
        if (clip.creator) parts.push('von ' + clip.creator);
        if (clip.createdAt) parts.push(formatDate(clip.createdAt));
        if (clip.views !== undefined) parts.push(formatViews(clip.views));
        clipMetaDetails.innerHTML = parts.join(' <span class="clip-meta__dot"></span> ');
      }
      clipMeta.classList.add('clip-meta--visible');
    }

    function hideMeta() {
      if (clipMeta) clipMeta.classList.remove('clip-meta--visible');
    }

    function showCountdown(currentIdx) {
      if (!countdownOverlay) {
        // Kein Countdown-Overlay — direkt nächsten Clip laden
        currentIndex = (currentIdx + 1) % clips.length;
        loadClip(currentIndex);
        return;
      }

      var nextIdx = (currentIdx + 1) % clips.length;
      var nextClip = clips[nextIdx];

      if (countdownTitle) countdownTitle.textContent = nextClip.title || 'Clip ' + (nextIdx + 1);
      if (countdownTimer) {
        countdownTimer.classList.remove('boom-3', 'boom-2', 'boom-1');
      }
      countdownOverlay.classList.add('countdown-overlay--visible');

      var remaining = countdownSec;
      if (countdownTimer) countdownTimer.textContent = remaining;

      var interval = setInterval(function () {
        remaining--;
        if (remaining <= 0) {
          clearInterval(interval);
          currentIndex = nextIdx;
          loadClip(currentIndex);
        } else {
          if (countdownTimer) {
            countdownTimer.textContent = remaining;
            if (remaining <= 3) {
              countdownTimer.classList.remove('boom-3', 'boom-2', 'boom-1');
              void countdownTimer.offsetWidth;
              countdownTimer.classList.add('boom-' + remaining);
            }
          }
        }
      }, 1000);
    }

    function loadClip(index) {
      var clip = clips[index % clips.length];
      if (placeholder) placeholder.style.display = 'none';
      if (countdownOverlay) countdownOverlay.classList.remove('countdown-overlay--visible');
      if (clipTimer) clearTimeout(clipTimer);

      var old = container.querySelector('video.clip-video');
      if (old) { old.removeAttribute('src'); old.remove(); }

      var video = document.createElement('video');
      video.className = 'clip-video';
      video.src = clip.mp4;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = !!muted;
      video.preload = 'auto';
      container.appendChild(video);

      showMeta(clip);

      var settled = false;

      function goNext(fade) {
        if (settled) return;
        settled = true;
        clearTimeout(clipTimer);
        clearTimeout(stallTimer);
        hideMeta();
        if (fade) {
          video.classList.add('fade-out');
          setTimeout(function () {
            video.removeAttribute('src'); video.remove(); showCountdown(index);
          }, 800);
        } else {
          video.removeAttribute('src'); video.remove();
          showCountdown(index);
        }
      }

      // Kommt binnen 12s kein Playback zustande (Netzwerk, abgelaufener Token),
      // wird der Clip uebersprungen statt die Szene haengen zu lassen.
      var stallTimer = setTimeout(function () { goNext(false); }, 12000);

      video.addEventListener('playing', function () { clearTimeout(stallTimer); });
      // Das echte Ende des Videos schaltet weiter — kein Timer auf clip.duration
      // mehr, der schon waehrend des Pufferns lief und zu frueh ablief.
      video.addEventListener('ended', function () { goNext(true); });
      video.addEventListener('error', function () { goNext(false); });

      var started = video.play();
      if (started && started.catch) {
        started.catch(function () {
          // Autoplay mit Ton blockiert der Browser ohne Nutzerinteraktion
          // (in OBS nicht, im normalen Tab schon) — dann stumm weiterlaufen,
          // statt auf einen Klick zu warten, der nie kommt.
          if (!video.muted) {
            video.muted = true;
            var retry = video.play();
            if (retry && retry.catch) retry.catch(function () { goNext(false); });
          } else {
            goNext(false);
          }
        });
      }
    }

    function startPlayer(clipData) {
      // Ohne abspielbare MP4-URL ist ein Clip nicht darstellbar (geloescht,
      // oder der Token-Abruf hat fuer ihn nichts geliefert) — raus damit.
      clips = (clipData || []).filter(function (c) { return c && c.mp4; });
      if (clips.length === 0) {
        showError('Keine Clips gefunden');
        return;
      }
      shuffle(clips);
      loadClip(0);
    }

    var serveBase    = (window.__SERVE_BASE__ || '/').replace(/\/+$/, '/');
    var screenshotMs = (parseInt(params.get('screenshotSec'), 10) || 10) * 1000;

    function startClipFlow() {
      // Clips kommen server-seitig (kein Secret im Browser, und nur der Server
      // kann die signierten MP4-URLs holen) — auch im manuellen Modus, dort
      // eingeschraenkt auf die genannten Slugs.
      var url = manualClips
        ? serveBase + 'api/twitch/clips?slugs=' + encodeURIComponent(manualClips)
        : serveBase + 'api/twitch/clips?count=' + clipCount;
      fetch(url, { credentials: 'omit' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var list = (data && data.clips) || [];
          if (!list.length) throw new Error('Keine Clips gefunden');
          startPlayer(list);
        })
        .catch(function (err) {
          console.error('ClipPlayer:', err);
          showError(err.message || 'API-Fehler');
        });
    }

    // ─── Steam-Media-Modus (Trailer via hls.js + Screenshot-Slideshow) ───
    var hlsLoading = null;
    function ensureHls() {
      if (window.Hls) return Promise.resolve(window.Hls);
      if (hlsLoading) return hlsLoading;
      hlsLoading = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
        s.onload = function () { resolve(window.Hls); };
        s.onerror = function () { reject(new Error('hls.js load failed')); };
        document.head.appendChild(s);
      });
      return hlsLoading;
    }

    function startSteamMedia(media) {
      var playlist = [];
      (media.trailers || []).forEach(function (t) {
        if (t.hls) playlist.push({ type: 'trailer', hls: t.hls, name: t.name });
      });
      (media.screenshots || []).forEach(function (url) {
        playlist.push({ type: 'shot', url: url });
      });
      if (!playlist.length) { startClipFlow(); return; }
      if (placeholder) placeholder.style.display = 'none';
      shuffle(playlist);
      var idx = 0;

      function clearStage() {
        var old = container.querySelector('iframe, video, img.steam-shot');
        if (old) old.remove();
      }
      function next() { idx = (idx + 1) % playlist.length; play(idx); }

      function play(i) {
        var item = playlist[i % playlist.length];
        clearStage();
        if (clipMetaTitle) clipMetaTitle.textContent = media.gameName || 'Steam Highlight';
        if (clipMetaDetails) {
          clipMetaDetails.textContent = (item.type === 'trailer')
            ? (item.name || 'Trailer') : 'Screenshot';
        }
        if (clipMeta) clipMeta.classList.add('clip-meta--visible');

        if (item.type === 'shot') {
          var img = document.createElement('img');
          img.className = 'steam-shot';
          img.src = item.url;
          container.appendChild(img);
          setTimeout(next, screenshotMs);
          return;
        }
        // Trailer: HLS-Video
        var video = document.createElement('video');
        video.muted = (muted === false) ? false : true; // Default stumm in OBS
        video.autoplay = true; video.playsInline = true;
        container.appendChild(video);
        var advanced = false;
        function adv() { if (advanced) return; advanced = true; next(); }
        video.addEventListener('ended', adv);
        video.addEventListener('error', function () { setTimeout(adv, 200); });
        // Sicherheitsnetz falls Stream haengt
        var guard = setTimeout(adv, 90000);
        video.addEventListener('ended', function () { clearTimeout(guard); });

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = item.hls; video.play().catch(function () {});
        } else {
          ensureHls().then(function (Hls) {
            if (Hls.isSupported()) {
              var hls = new Hls();
              hls.loadSource(item.hls);
              hls.attachMedia(video);
              hls.on(Hls.Events.MANIFEST_PARSED, function () { video.play().catch(function () {}); });
              hls.on(Hls.Events.ERROR, function (e, d) { if (d && d.fatal) adv(); });
            } else { adv(); }
          }).catch(function () { adv(); });
        }
      }
      play(0);
    }

    // ─── Quelle entscheiden: Steam-Media (falls aktiv + Spiel laeuft) sonst Clips ───
    // Signatur aus Quelle+Spiel+Media-Mengen — aendert sie sich (Spiel gestartet/
    // gewechselt/gestoppt oder Media frisch gecacht), laedt die Source sauber neu.
    function mediaSig(d) {
      return (d && d.source) + ':' + ((d && d.appId) || '')
        + ':' + ((d && d.trailers && d.trailers.length) || 0)
        + 'x' + ((d && d.screenshots && d.screenshots.length) || 0);
    }
    var HIGHLIGHT_URL = serveBase + 'api/steam/highlight-media';
    fetch(HIGHLIGHT_URL, { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var sig0 = mediaSig(d);
        if (d && d.source === 'steam'
            && ((d.trailers && d.trailers.length) || (d.screenshots && d.screenshots.length))) {
          startSteamMedia(d);
        } else {
          startClipFlow();
        }
        // Re-Poll: Spielwechsel/-stopp → Quelle hat sich geaendert → Szene neu laden.
        setInterval(function () {
          fetch(HIGHLIGHT_URL, { credentials: 'omit' })
            .then(function (r) { return r.json(); })
            .then(function (d2) { if (mediaSig(d2) !== sig0) location.reload(); })
            .catch(function () {});
        }, 45000);
      })
      .catch(function () { startClipFlow(); });
  }

  return { init: init };
})();
