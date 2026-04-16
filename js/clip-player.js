/*
 * Shared Clip-Player für alle Szenen.
 *
 * Nutzung:
 *   <div id="clipContainer"><div id="clipPlaceholder">...</div></div>
 *   <script src="../js/clip-player.js"></script>
 *   <script>
 *     ClipPlayer.init({ containerId: 'clipContainer', muted: true });
 *   </script>
 *
 * URL-Parameter (automatisch gelesen):
 *   ?channel=LuCKoR_HD&client_id=xxx&client_secret=xxx
 *   ?clips=Slug1,Slug2,Slug3
 *   &count=100
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
    // parent muss sowohl localhost als auch 127.0.0.1 abdecken
    var host = window.location.hostname;
    var parentParam = '&parent=' + host;
    if (host === '127.0.0.1') parentParam += '&parent=localhost';
    if (host === 'localhost') parentParam += '&parent=127.0.0.1';
    return 'https://clips.twitch.tv/embed?clip=' + encodeURIComponent(slug)
      + parentParam
      + '&autoplay=true'
      + '&muted=' + (muted ? 'true' : 'false');
  }

  function init(opts) {
    opts = opts || {};
    var containerId = opts.containerId || 'clipContainer';
    var muted       = opts.muted !== undefined ? opts.muted : false;
    var onClipLoad  = opts.onClipLoad || null;
    var onClipEnd   = opts.onClipEnd || null;
    var extraDelay  = opts.extraDelay || 700;
    var autoAdvance = opts.autoAdvance !== undefined ? opts.autoAdvance : true;

    var container   = document.getElementById(containerId);
    var placeholder = container ? container.querySelector('.clip-placeholder') : null;

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

    function loadClip(index) {
      var clip = clips[index % clips.length];
      if (placeholder) placeholder.style.display = 'none';
      if (clipTimer) clearTimeout(clipTimer);

      var oldIframe = container.querySelector('iframe');
      if (oldIframe) oldIframe.remove();

      var iframe = document.createElement('iframe');
      iframe.src = buildEmbedUrl(clip.id, muted);
      iframe.allow = 'autoplay; fullscreen';
      iframe.allowFullscreen = true;
      container.appendChild(iframe);

      if (onClipLoad) onClipLoad(clip, index);

      iframe.addEventListener('load', function () {
        var durationMs = Math.ceil(clip.duration) * 1000 + extraDelay;
        clipTimer = setTimeout(function () {
          if (onClipEnd) onClipEnd(clip, index);
          if (autoAdvance) {
            currentIndex = (index + 1) % clips.length;
            loadClip(currentIndex);
          }
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
      return { loadClip: loadClip, clips: clips };
    }

    // API Modus
    if (!clientId || !clientSecret) {
      showError('client_id & client_secret fehlt');
      return { loadClip: loadClip, clips: clips };
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

    return { loadClip: loadClip, clips: clips };
  }

  return { init: init };
})();
