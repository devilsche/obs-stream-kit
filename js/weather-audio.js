/* Ton der Weather-Source (optional, Schalter sound): Regen- und Wind-
 * Schleifen folgen der Lage und blenden weich über, jeder Blitz bekommt
 * einen Donner (nah/fern, die Verzögerung steckt schon in der WAV), Böen
 * rauschen. Dateien aus assets/effects/.
 *
 *   var audio = WeatherAudio.create('../assets/effects/');
 *   audio.set({ on, volume, thunder, ambient });  audio.update(kit.state());
 *   audio.thunder(dist);  audio.gust();  audio.spectacle(info);
 * Windhose (Spektakel tornado): eigenes Sturmrauschen, lauter je näher sie der
 * Bildmitte kommt, unabhängig vom Regler für Regen/Wind; mit siren eine
 * erzeugte Sirene dazu (an- und abschwellender Heulton).
 * Alles läuft über Web Audio (vorab dekodierte Puffer): OBS gibt <audio>-Elemente
 * einer Browser-Source nicht aus. Donner aus opts.thunderFile setzt mit dem Blitz ein.
 */
(function (root) {
  'use strict';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  var AMBIENT = 0.3;   // Standard für Regen und Wind (früher voll = 1)
  var LOOPS = ['rain-loop-light', 'rain-loop-medium', 'rain-loop-storm', 'wind-loop-light', 'wind-loop-strong'];

  function create(base, opts) {
    opts = opts || {};
    var thunderFile = opts.thunderFile || (base + 'thunder-near-1.wav');
    // Donner einmal laden und dekodieren
    var AC = root.AudioContext || root.webkitAudioContext;
    var actx = AC ? new AC() : null, thunderBuf = null, voices = [];
    if (actx) {
      fetch(thunderFile).then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) { return new Promise(function (ok, no) { actx.decodeAudioData(ab, ok, no); }); })
        .then(function (buf) { thunderBuf = buf; })
        .catch(function () { thunderBuf = null; });
    }
    // ambient: Regen und Wind relativ zur Gesamtlautstärke (leise, damit das Spiel hörbar bleibt)
    var on = false, volume = 0.6, thunderLevel = 1, ambient = AMBIENT, siren = false, blocked = false;

    // OBS gibt <audio>-Elemente der Browser-Source nicht aus, Web Audio schon:
    // Schleifen und Böen laufen deshalb wie der Donner über dekodierte Puffer
    var bufs = {};
    function load(url, cb) {
      if (bufs[url]) { if (bufs[url].buf) cb(bufs[url].buf); else bufs[url].wait.push(cb); return; }
      var entry = bufs[url] = { buf: null, wait: [cb] };
      fetch(url).then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) { return new Promise(function (ok, no) { actx.decodeAudioData(ab, ok, no); }); })
        .then(function (buf) { entry.buf = buf; entry.wait.forEach(function (f) { f(buf); }); entry.wait = []; })
        .catch(function () { delete bufs[url]; });
    }
    // Schleife mit derselben Schnittstelle wie ein <audio>-Element (volume, paused, play, pause)
    function makeLoop(url) {
      if (!actx) {
        var a = new Audio(url);
        a.loop = true; a.preload = 'auto'; a.volume = 0;
        return a;
      }
      var g = actx.createGain(), buf = null, src = null, vol = 0;
      g.gain.value = 0;
      g.connect(actx.destination);
      load(url, function (b) { buf = b; });
      return {
        get volume() { return vol; },
        set volume(v) { vol = v; g.gain.setTargetAtTime(v, actx.currentTime, 0.03); },
        get paused() { return !src; },
        play: function () {
          if (!src && buf) {
            src = actx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            src.connect(g);
            src.start();
          }
          return Promise.resolve();
        },
        pause: function () {
          if (!src) return;
          try { src.stop(); } catch (e) { /* schon beendet */ }
          src.disconnect();
          src = null;
        }
      };
    }

    // Windhose: eigene Sturm-Schleife, Pegel aus den laufenden Tornados
    var twisters = [], twistLoop = makeLoop(base + 'wind-loop-strong.wav');
    var loops = {}, targets = {}, lastThunder = -10;

    LOOPS.forEach(function (name) {
      loops[name] = makeLoop(base + name + '.wav');
      targets[name] = 0;
    });
    if (actx) load(base + 'wind-gust.wav', function () {});

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
        var a = loops[name], tgt = on ? targets[name] * volume * ambient : 0;
        var v = a.volume + clamp(tgt - a.volume, -0.05, 0.05);
        a.volume = clamp(v, 0, 1);
        if (a.volume > 0.005 && a.paused) play(a);
        else if (a.volume <= 0.005 && !a.paused) a.pause();
      });
      // Windhose: Hüllkurve über die Dauer, dazu Nähe zur Bildmitte
      twisters = twisters.filter(function (t) { return t.active(); });
      var tw = 0;
      twisters.forEach(function (t) {
        var p = clamp(t.elapsed() / t.dur, 0, 1), x = t.x();
        var near = x === null ? 0.5 : 1 - clamp(Math.abs(x - 960) / 1300, 0, 1);
        tw = Math.max(tw, smooth(p / 0.12) * (1 - smooth((p - 0.8) / 0.2)) * (0.45 + 0.55 * near));
      });
      var tt = on ? tw * volume * 0.9 : 0;
      twistLoop.volume = clamp(twistLoop.volume + clamp(tt - twistLoop.volume, -0.08, 0.08), 0, 1);
      if (twistLoop.volume > 0.005 && twistLoop.paused) play(twistLoop);
      else if (twistLoop.volume <= 0.005 && !twistLoop.paused) twistLoop.pause();
      // im Browser-Tab startet Web Audio erst nach einem Klick: Hinweis zeigen
      if (on && actx && actx.state === 'suspended' && !blocked && volume > 0.01) {
        blocked = true;
        if (opts.onBlocked) opts.onBlocked(true);
        actx.resume().catch(function () {});
      } else if (blocked && actx && actx.state === 'running') {
        blocked = false;
        if (opts.onBlocked) opts.onBlocked(false);
      }
    }, 100);

    // Sirene: zwei leicht verstimmte Sägezähne durch einen Tiefpass, Ton steigt
    // langsam an, hält und sinkt zum Ende (wie eine Motorsirene in der Ferne)
    // Bei mehreren Windhosen heult nur eine Sirene, die nächste erst danach
    var sirenEnd = 0;
    function playSiren(dur) {
      if (!actx || !on || volume <= 0.01 || actx.currentTime < sirenEnd) return;
      var t0 = actx.currentTime, end = t0 + dur;
      sirenEnd = end;
      var g = actx.createGain(), lp = actx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1400;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.16 * volume, t0 + 1.5);
      g.gain.setValueAtTime(0.16 * volume, end - 2);
      g.gain.linearRampToValueAtTime(0, end);
      lp.connect(g); g.connect(actx.destination);
      [1, 1.26].forEach(function (k) {
        var o = actx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(160 * k, t0);
        o.frequency.linearRampToValueAtTime(520 * k, t0 + Math.min(3.5, dur * 0.4));
        o.frequency.setValueAtTime(520 * k, end - 3);
        o.frequency.linearRampToValueAtTime(200 * k, end);
        o.connect(lp);
        o.start(t0);
        o.stop(end + 0.05);
      });
    }

    function unlock() {
      if (actx && actx.state === 'suspended') actx.resume();
      if (!blocked) return;
      blocked = false;
      if (opts.onBlocked) opts.onBlocked(false);
      LOOPS.forEach(function (name) { if (loops[name].volume > 0.005) play(loops[name]); });
    }
    document.addEventListener('click', unlock);
    document.addEventListener('keydown', unlock);

    function oneShot(file, vol) {
      if (!on || vol <= 0.01) return;
      if (actx) {
        var entry = bufs[base + file];
        if (!entry || !entry.buf || actx.state !== 'running') return;
        var src = actx.createBufferSource(), g = actx.createGain();
        src.buffer = entry.buf;
        g.gain.value = clamp(vol, 0, 1);
        src.connect(g).connect(actx.destination);
        src.start();
        return;
      }
      var a = new Audio(base + file);
      a.volume = clamp(vol, 0, 1);
      play(a);
    }

    return {
      set: function (o) {
        if (o.on !== undefined) on = !!o.on;
        // in OBS läuft Ton ohne Klick: Web Audio gleich starten
        if (on && actx && actx.state === 'suspended') actx.resume().catch(function () {});
        if (typeof o.volume === 'number' && isFinite(o.volume)) volume = clamp(o.volume, 0, 1);
        if (typeof o.thunder === 'number' && isFinite(o.thunder)) thunderLevel = clamp(o.thunder, 0, 1);
        if (typeof o.ambient === 'number' && isFinite(o.ambient)) ambient = clamp(o.ambient, 0, 1);
        if (o.siren !== undefined) siren = !!o.siren;
      },
      // Zielpegel aus dem aktuellen Wetterzustand
      update: function (cur) {
        var rain = cur.rain || 0, drizzle = cur.drizzle || 0;
        var storm = smooth((rain - 0.75) / 0.25) * (cur.lightning > 1 ? 1 : 0.6);
        targets['rain-loop-storm'] = storm;
        targets['rain-loop-medium'] = clamp(rain * 1.2, 0, 1) * (1 - storm);
        targets['rain-loop-light'] = clamp(drizzle * 1.1, 0, 1) * (1 - clamp(rain * 1.5, 0, 1));
        // leichtes Lüftchen bleibt still; hörbar ab mittlerem Wind, laut im Sturm
        var w = Math.max(Math.abs(cur.wind || 0), cur.windMin || 0, cur.windRandom ? 0.4 : 0);
        var strong = smooth((w - 0.55) / 0.35);
        targets['wind-loop-strong'] = strong;
        targets['wind-loop-light'] = smooth((w - 0.3) / 0.25) * 0.7 * (1 - strong);
      },
      // Donner: vorab dekodiert und aus dem Speicher gespielt (keine Ladezeit),
      // setzt mit dem Blitz ein; fern nur leiser und tiefer. Jeder Blitz
      // bekommt garantiert seinen eigenen Donner von Anfang an; laufen schon
      // sechs, blendet der älteste schnell aus und macht Platz
      thunder: function (dist) {
        if (!on) return;
        var d = typeof dist === 'number' ? clamp(dist, 0, 1) : Math.random();
        var vol = volume * thunderLevel * (1 - 0.45 * d);
        if (vol <= 0.01) return;
        var rate = (1 - 0.15 * d) * (0.94 + Math.random() * 0.12);
        if (actx && thunderBuf && actx.state === 'running') {
          var src = actx.createBufferSource(), g = actx.createGain();
          src.buffer = thunderBuf;
          src.playbackRate.value = rate;
          while (voices.length >= 6) {
            var old = voices.shift(), t = actx.currentTime;
            old.g.gain.cancelScheduledValues(t);
            old.g.gain.setValueAtTime(old.g.gain.value, t);
            old.g.gain.linearRampToValueAtTime(0, t + 0.4);
            try { old.src.stop(t + 0.45); } catch (e) { /* schon beendet */ }
          }
          // gleichzeitige Donner teilen sich etwas Pegel (Summe übersteuert nicht), einzeln bleiben sie laut
          g.gain.value = clamp(vol / Math.pow(voices.length + 1, 0.2), 0, 1);
          src.connect(g).connect(actx.destination);
          var voice = { src: src, g: g };
          voices.push(voice);
          src.onended = function () {
            var i = voices.indexOf(voice);
            if (i >= 0) voices.splice(i, 1);
          };
          src.start();
          return;
        }
        // Rückfall ohne Web Audio
        var a = new Audio(thunderFile);
        a.volume = clamp(vol, 0, 1);
        a.preservesPitch = false;
        a.playbackRate = rate;
        play(a);
      },
      gust: function (k) { oneShot('wind-gust.wav', volume * ambient * 0.9 * Math.min(1.3, 0.55 + 0.45 * (k || 1))); },
      // Spektakel-Start (info aus kit.on('spectacle')): Windhose bekommt Ton
      spectacle: function (info) {
        if (!info || info.type !== 'tornado' || info.reduced) return;
        twisters.push(info);
        if (siren) playSiren(info.dur);
      }
    };
  }

  root.WeatherAudio = { create: create };
})(typeof window !== 'undefined' ? window : this);
