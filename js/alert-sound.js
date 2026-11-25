/* Alert-Ton aus dem Dashboard (Stream → Alert-Karte → Sound): bis zu 3 eigene MP3 je Alert.
 * Der Server injiziert window.__ALERT_SOUND__ = { volume, files: [ids], base: "/s/<token>/alert-sounds/<alert>/" }.
 * Beim Erscheinen des Alerts spielt zufällig einer der Töne (nicht zweimal hintereinander derselbe),
 * zum Ende des Alerts (?duration=, Standard 6 s) blendet er weich aus.
 * URL: sound=0 schaltet stumm, volume=0–1 wirkt als Faktor auf die Dashboard-Lautstärke.
 * In OBS „Audio über OBS steuern“ aktivieren, dann erscheint der Ton im Mixer. */
(function () {
  'use strict';
  var cfg = window.__ALERT_SOUND__, q = new URLSearchParams(location.search);
  if (!cfg || !cfg.files || !cfg.files.length || q.get('sound') === '0') return;
  var f = parseFloat(q.get('volume')), vol = (cfg.volume == null ? 0.6 : cfg.volume) * (isNaN(f) ? 1 : Math.max(0, Math.min(1, f)));
  if (vol <= 0) return;
  var key = 'alert-sound-last:' + cfg.base, last = null;
  try { last = localStorage.getItem(key); } catch (e) { /* ohne Speicher eben zufällig */ }
  var pool = cfg.files.length > 1 ? cfg.files.filter(function (id) { return id !== last; }) : cfg.files;
  var id = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem(key, id); } catch (e) { /* egal */ }

  var a = new Audio(cfg.base + id + '.mp3');
  a.preload = 'auto';
  a.volume = Math.min(1, vol);
  function play() {
    var p = a.play();
    if (p && p.catch) p.catch(function () {   // normaler Browser: erst nach Klick (OBS spielt direkt)
      var once = function () { document.removeEventListener('click', once); a.play().catch(function () {}); };
      document.addEventListener('click', once);
    });
  }
  play();
  // zum Ende des Alerts ausblenden
  var dur = parseFloat(q.get('duration')) || 6, fade = 0.6;
  setTimeout(function () {
    var t0 = performance.now(), v0 = a.volume;
    (function step() {
      var k = Math.min(1, (performance.now() - t0) / (fade * 1000));
      a.volume = Math.max(0, v0 * (1 - k));
      if (k < 1) requestAnimationFrame(step); else a.pause();
    })();
  }, Math.max(0, (dur - 0.3) * 1000));
})();
