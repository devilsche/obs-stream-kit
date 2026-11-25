/* Alert-Ton und Anzeigedauer aus dem Dashboard (Stream → Alert → Sound & timing).
 * Einbinden als ERSTES Skript im <body> (nach der Server-Injektion im <head>, vor den Skripten der Seite):
 * Es legt die Anzeigedauer fest, BEVOR die Seite ihren Ausblende-Timer aus ?duration= liest.
 *
 * Server: window.__ALERT_SOUND__ = { volume, files: [ids], lens: {id: s}, base, default?, default_len?,
 *                                    duration, stay }
 * Regel (eine Einstellung im Dashboard): Ist der Ton länger als die Dauer, bleibt der Alert stehen, bis er endet
 * (stay), oder der Ton blendet mit dem Alert aus. Die Dauer zählt ab dem Erscheinen des Alerts.
 *
 * Wartemodus (alerts/live.html) gibt soundfile=<id>|default|none, duration und full=1 schon vor: dann wird nur
 * gespielt. URL: sound=0 stumm, volume=0–1 als Faktor, duration= überschreibt die Dashboard-Dauer.
 * In OBS „Audio über OBS steuern“ aktivieren, dann erscheint der Ton im Mixer. */
(function () {
  'use strict';
  var cfg = window.__ALERT_SOUND__, q = new URLSearchParams(location.search);
  if (!cfg) return;
  var hosted = q.has('soundfile');
  var files = cfg.files || [], lens = cfg.lens || {};

  // Ton wählen: vom Host vorgegeben, sonst zufällig (nie zweimal hintereinander derselbe), sonst eingebaut
  var src = null, len = 0, pick = q.get('soundfile');
  if (q.get('sound') !== '0' && pick !== 'none') {
    if (pick === 'default' && cfg['default']) { src = cfg['default']; len = cfg.default_len || 0; }
    else if (pick && files.indexOf(pick) >= 0) { src = cfg.base + pick + '.mp3'; len = lens[pick] || 0; }
    else if (!hosted && files.length) {
      var key = 'alert-sound-last:' + cfg.base, last = null;
      try { last = localStorage.getItem(key); } catch (e) { /* ohne Speicher eben zufällig */ }
      var pool = files.length > 1 ? files.filter(function (id) { return id !== last; }) : files;
      var id = pool[Math.floor(Math.random() * pool.length)];
      try { localStorage.setItem(key, id); } catch (e) { /* egal */ }
      src = cfg.base + id + '.mp3'; len = lens[id] || 0;
    } else if (!hosted && cfg['default']) { src = cfg['default']; len = cfg.default_len || 0; }
  }
  var f = parseFloat(q.get('volume')), vol = (cfg.volume == null ? 0.6 : cfg.volume) * (isNaN(f) ? 1 : Math.max(0, Math.min(1, f)));
  if (typeof window.__SOUND_LEVEL__ === 'number') vol *= window.__SOUND_LEVEL__;   // Settings → Sound
  if (vol <= 0) src = null;

  // Anzeigedauer: URL > Dashboard; bei „bleibt bis Tonende“ mindestens so lang wie der Ton
  var dur = parseFloat(q.get('duration')) || cfg.duration || 6;
  var stay = hosted ? q.get('full') === '1' : cfg.stay !== false;
  if (!hosted) {
    if (src && stay && len > dur) dur = Math.ceil(len);
    if (String(dur) !== q.get('duration')) {
      q.set('duration', String(dur));
      try { history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash); } catch (e) { /* file:// u. Ä. */ }
    }
  }
  if (!src) return;

  var a = new Audio(src);
  a.preload = 'auto';
  a.volume = Math.min(1, vol);
  var p = a.play();
  if (p && p.catch) p.catch(function () {   // normaler Browser: erst nach Klick (OBS spielt direkt)
    var once = function () { document.removeEventListener('click', once); a.play().catch(function () {}); };
    document.addEventListener('click', once);
  });
  if (stay) return;   // Alert bleibt so lange, wie der Ton läuft
  // sonst mit dem Alert ausblenden
  var fade = 0.6;
  setTimeout(function () {
    var t0 = performance.now(), v0 = a.volume;
    (function step() {
      var k = Math.min(1, (performance.now() - t0) / (fade * 1000));
      a.volume = Math.max(0, v0 * (1 - k));
      if (k < 1) requestAnimationFrame(step); else a.pause();
    })();
  }, Math.max(0, (dur - 0.3) * 1000));
})();
