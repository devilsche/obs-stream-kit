/* Ton der Weather-Source (optional, Schalter sound): Regen- und Wind-
 * Schleifen folgen der Lage und blenden weich über, jeder Blitz bekommt
 * einen Donner (nah/fern, die Verzögerung steckt schon in der WAV), Böen
 * rauschen. Dateien aus assets/effects/.
 *
 *   var audio = WeatherAudio.create('../assets/effects/');
 *   audio.set({ on, volume, thunder });  audio.update(kit.state());
 *   audio.thunder(dist);  audio.gust();
 */
(function (root) {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  var LOOPS = ['rain-loop-light', 'rain-loop-medium', 'rain-loop-storm', 'wind-loop-light', 'wind-loop-strong'];

  function create(base) {
    var on = false, volume = 0.6, thunderLevel = 1;
    var loops = {}, targets = {}, lastThunder = -10;

    LOOPS.forEach(function (name) {
      var a = new Audio(base + name + '.wav');
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0;
      loops[name] = a;
      targets[name] = 0;
    });

    function play(a) {
      var p = a.play();
      // Autoplay-Sperre im Browser-Tab: beim ersten Klick nachholen
      if (p && p.catch) p.catch(function () {});
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

    document.addEventListener('click', function () {
      LOOPS.forEach(function (name) { if (loops[name].volume > 0.005) play(loops[name]); });
    });

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
      // Donner: nah oder fern je nach Einschlag, höchstens einer je 0,7 s
      thunder: function (dist) {
        var now = Date.now() / 1000;
        if (now - lastThunder < 0.7) return;
        lastThunder = now;
        var near = typeof dist === 'number' ? dist < 0.4 : Math.random() < 0.4;
        var file = 'thunder-' + (near ? 'near' : 'far') + '-' + (Math.random() < 0.5 ? 1 : 2) + '.wav';
        oneShot(file, volume * thunderLevel * (near ? 1 : 0.8));
      },
      gust: function () { oneShot('wind-gust.wav', volume * 0.9); }
    };
  }

  root.WeatherAudio = { create: create };
})(typeof window !== 'undefined' ? window : this);
