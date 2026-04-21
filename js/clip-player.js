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
 *   ?channel=LuCKoR_HD&client_id=xxx&client_secret=xxx
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

  function buildEmbedUrl(slug, muted) {
    var host = window.location.hostname;
    var parents = [host, 'localhost', '127.0.0.1', 'absolute'];
    var parentParam = parents.map(function (p) { return '&parent=' + p; }).join('');
    return 'https://clips.twitch.tv/embed?clip=' + encodeURIComponent(slug)
      + parentParam
      + '&autoplay=true'
      + '&muted=' + (muted ? 'true' : 'false');
  }

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
    var extraDelay   = opts.extraDelay || 700;
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
    var channel      = params.get('channel') || 'LuCKoR_HD';
    var clientId     = params.get('client_id') || window.__TWITCH_CLIENT_ID__ || '';
    var clientSecret = params.get('client_secret') || window.__TWITCH_CLIENT_SECRET__ || '';
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

      var oldIframe = container.querySelector('iframe');
      if (oldIframe) oldIframe.remove();

      var iframe = document.createElement('iframe');
      iframe.src = buildEmbedUrl(clip.id, muted);
      iframe.allow = 'autoplay; fullscreen';
      iframe.allowFullscreen = true;
      container.appendChild(iframe);

      showMeta(clip);

      var settled = false;

      function goNext(fade) {
        if (settled) return;
        settled = true;
        clearTimeout(clipTimer);
        clearTimeout(noLoadTimer);
        window.removeEventListener('message', onTwitchMsg);
        hideMeta();
        if (fade) {
          iframe.classList.add('fade-out');
          setTimeout(function () { iframe.remove(); showCountdown(index); }, 800);
        } else {
          iframe.remove();
          showCountdown(index);
        }
      }

      function onTwitchMsg(e) {
        if (!e.data) return;
        var d;
        try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (ex) { return; }
        if (d && d.eventName === 'ERROR') goNext(false);
      }
      window.addEventListener('message', onTwitchMsg);

      // Fallback: iframe lädt gar nicht (Netzwerk-Fehler etc.)
      var noLoadTimer = setTimeout(function () { goNext(false); }, 12000);

      iframe.addEventListener('load', function () {
        clearTimeout(noLoadTimer);
        var durationMs = Math.ceil(clip.duration) * 1000 + extraDelay;
        clipTimer = setTimeout(function () {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', onTwitchMsg);
          iframe.classList.add('fade-out');
          hideMeta();
          setTimeout(function () { showCountdown(index); }, 800);
        }, durationMs);
      });
    }

    function startPlayer(clipData) {
      clips = clipData;
      if (clips.length === 0) {
        showError('Keine Clips gefunden');
        return;
      }
      shuffle(clips);
      loadClip(0);
    }

    // Manueller Modus
    if (manualClips) {
      var ids = manualClips.split(',')
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s.length > 0; });
      startPlayer(ids.map(function (id) {
        return { id: id, title: '', duration: 30 };
      }));
      return;
    }

    // API Modus
    if (!clientId || !clientSecret) {
      showError('client_id & client_secret fehlt');
      return;
    }

    fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_id=' + encodeURIComponent(clientId)
        + '&client_secret=' + encodeURIComponent(clientSecret)
        + '&grant_type=client_credentials'
    })
    .then(function (r) { return r.json(); })
    .then(function (tokenData) {
      if (!tokenData.access_token) throw new Error('Token-Fehler');
      var token = tokenData.access_token;
      var headers = { 'Client-ID': clientId, 'Authorization': 'Bearer ' + token };

      return fetch('https://api.twitch.tv/helix/users?login=' + encodeURIComponent(channel), { headers: headers })
        .then(function (r) { return r.json(); })
        .then(function (userData) {
          if (!userData.data || !userData.data.length) throw new Error('Kanal nicht gefunden');
          return userData.data[0].id;
        })
        .then(function (bid) {
          return fetch('https://api.twitch.tv/helix/clips?broadcaster_id=' + bid + '&first=' + clipCount, { headers: headers });
        })
        .then(function (r) { return r.json(); })
        .then(function (clipData) {
          if (!clipData.data || !clipData.data.length) throw new Error('Keine Clips gefunden');
          startPlayer(clipData.data.map(function (c) {
            return {
              id: c.id,
              title: c.title || '',
              duration: c.duration || 30,
              createdAt: c.created_at || '',
              views: c.view_count || 0,
              creator: c.creator_name || ''
            };
          }));
        });
    })
    .catch(function (err) {
      console.error('ClipPlayer:', err);
      showError(err.message || 'API-Fehler');
    });
  }

  return { init: init };
})();
