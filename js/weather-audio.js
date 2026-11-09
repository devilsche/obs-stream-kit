/* Ton der Weather-Source (optional, Schalter sound): Regen- und Wind-
 * Schleifen folgen der Lage und blenden weich über, jeder Blitz bekommt
 * einen Donner (nah/fern, die Verzögerung steckt schon in der WAV), Böen
 * rauschen. Dateien aus assets/effects/.
 *
 *   var audio = WeatherAudio.create('../assets/effects/');
 *   audio.set({ on, volume, thunder });  audio.update(kit.state());
 *   audio.thunder(dist);  audio.gust();
 * Donner aus opts.thunderFile (ohne eingebaute Pause), Verzögerung je Entfernung.
 */
(function (root) {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  var LOOPS = ['rain-loop-light', 'rain-loop-medium', 'rain-loop-storm', 'wind-loop-light', 'wind-loop-strong'];

  function create(base, opts) {
    opts = opts || {};
    var thunderFile = opts.thunderFile || (base + 'thunder-near-1.wav');
    var on = false, volume = 0.6, thunderLevel = 1, blocked = false;
    var loops = {}, targets = {}, lastThunder = -10;

    LOOPS.forEach(function (name) {
      var a = new Audio(base + name + '.wav');
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0;
      loops[name] = a;
      targets[name] = 0;
    });

    // Autoplay-Sperre (nur im Browser-Tab, OBS erlaubt Ton): nicht ständig
    // neu versuchen, sondern melden und beim ersten Klick nachholen
    function play(a) {
      if (blocked) return;
      var p = a.play();
      if (p && p.catch) p.catch(function (e) {
        if (e && e.name === 'NotAllowedError' && !blocked) {
          blocked = true;
          if (opts.onBlocked) opts.onBlocked(true);
        }
      });
    }

    // Lautstärken weich nachführen; stumme Schleifen anhalten
    setInterval(function () {
      LOOPS.forEach(function (name) {
        var a = loops[name], tgt = on ? targets[name] * volume : 0;
        var v = a.volume + clamp(tgt - a.volume, -0.05, 0.05);
        a.volume = clamp(v, 0, 1);
        if (a.volume > 0.005 && a.paused) play(a);
        else if (a.volume <= 0.005 && !a.paused) a.pause();
      });
    }, 100);

    function unlock() {
      if (!blocked) return;
      blocked = false;
      if (opts.onBlocked) opts.onBlocked(false);
      LOOPS.forEach(function (name) { if (loops[name].volume > 0.005) play(loops[name]); });
    }
    document.addEventListener('click', unlock);
    document.addEventListener('keydown', unlock);

    function oneShot(file, vol) {
      if (!on || vol <= 0.01) return;
      var a = new Audio(base + file);
      a.volume = clamp(vol, 0, 1);
      play(a);
    }

    return {
      set: function (o) {
        if (o.on !== undefined) on = !!o.on;
        if (typeof o.volume === 'number' && isFinite(o.volume)) volume = clamp(o.volume, 0, 1);
        if (typeof o.thunder === 'number' && isFinite(o.thunder)) thunderLevel = clamp(o.thunder, 0, 1);
      },
      // Zielpegel aus dem aktuellen Wetterzustand
      update: function (cur) {
        var rain = cur.rain || 0, drizzle = cur.drizzle || 0;
        var storm = smooth((rain - 0.75) / 0.25) * (cur.lightning > 1 ? 1 : 0.6);
        targets['rain-loop-storm'] = storm;
        targets['rain-loop-medium'] = clamp(rain * 1.2, 0, 1) * (1 - storm);
        targets['rain-loop-light'] = clamp(drizzle * 1.1, 0, 1) * (1 - clamp(rain * 1.5, 0, 1));
        var w = Math.max(Math.abs(cur.wind || 0), cur.windMin || 0, cur.windRandom ? 0.5 : 0);
        var strong = smooth((w - 0.5) / 0.4);
        targets['wind-loop-strong'] = strong;
        targets['wind-loop-light'] = w > 0.15 ? (w * (1 - strong)) : 0;
      },
      // Donner (assets/stingers/thunder-124463.mp3, setzt fast sofort ein):
      // naher Blitz sofort, ferner verzögert, leiser und etwas tiefer;
      // höchstens einer pro Sekunde, sonst stapeln sich die langen Donner
      thunder: function (dist) {
        var now = Date.now() / 1000;
        if (now - lastThunder < 1) return;
        lastThunder = now;
        var d = typeof dist === 'number' ? clamp(dist, 0, 1) : Math.random();
        var delay = d < 0.4 ? 0 : 400 + d * 800;
        var vol = volume * thunderLevel * (1 - 0.45 * d);
        setTimeout(function () {
          if (!on || vol <= 0.01) return;
          var a = new Audio(thunderFile);
          a.volume = clamp(vol, 0, 1);
          a.preservesPitch = false;
          a.playbackRate = (1 - 0.15 * d) * (0.94 + Math.random() * 0.12);
          play(a);
        }, delay);
      },
      gust: function () { oneShot('wind-gust.wav', volume * 0.9); }
    };
  }

  root.WeatherAudio = { create: create };
})(typeof window !== 'undefined' ? window : this);
