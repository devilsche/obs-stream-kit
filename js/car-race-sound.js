/* Car Race – Klänge, komplett mit Web Audio erzeugt (keine Audiodateien, keine Lizenzfragen).
 *
 *   var s = CarRaceSound.create({ enabled, volume })   → null, wenn kein Web Audio
 *   s.resume()                       AudioContext starten (Browser-Tab: nach dem ersten Klick/Tastendruck)
 *   s.join()                         leises „Pling“ (Fahrer meldet sich an)
 *   s.beep(), s.go()                 Startampel: kurzer Piep je Licht, höherer Startton
 *   s.engine(on, speed, boost)       Motorbrummen des Feldes (Rauschen + tiefe Oszillatoren), Tonhöhe folgt dem
 *                                    mittleren Tempo (m/s); boost 0..1 = lauter (Unfall-Zoom)
 *   s.nitro()                        Zischen + Turbopfeifen
 *   s.thud(heavy)                    metallischer Schlag (Rempler, Crash)
 *   s.squeal(), s.gravel()           Reifenquietschen (Dreher), Kies (Abflug)
 *   s.whoosh()                       kurzes Vorbeirauschen (Überholen, höchstens alle 0,4 s)
 *   s.fire(level)                    Knistern der Wrack-Brände, 0 = aus (je Bild aufrufen)
 *   s.cheer(), s.fanfare()           Siegerehrung: Jubel (Rauschen schwillt an) + kurze Fanfare
 *   s.silence()                      Dauerklänge aus (Motor, Feuer, Motoren, Quietschen, Rumpeln)
 *
 * Zusätzlich für Car Drive (selbst fahren, js/car-drive.js):
 *   s.setVolume(v)                   Gesamtlautstärke 0..1 (0 = stumm)
 *   var m = s.motor(gain)            eigener Motor (je Auto oder fürs Feld): m.set(on, speed m/s, throttle 0..1),
 *                                    m.stop(); gain = Anteil am Pegel (eigenes Auto 1, andere leiser)
 *   s.skid(level), s.rumble(level)   Dauer-Quietschen (Rutschen/Handbremse) bzw. Kies-/Gras-Rumpeln, 0..1, je Bild
 *   s.jingle(big)                    kurze Tonfolge für eine Runde (big = Rekord)
 *   s.crash(level)                   Blech-Crash Auto ↔ Auto, 0..1 (dumpfer Schlag + Knirschen + Blechklang, ab 0,6
 *                                    Splittern), höchstens alle 0,12 s
 *   s.scrape(level)                  Dauer-Schrammen Blech an Blech, 0..1, je Bild (0 = aus)
 *
 * Alles läuft über einen Master-Pegel und einen Kompressor/Begrenzer – nie laute Spitzen, insgesamt dezent.
 */
(function (root) {
  'use strict';

  function create(opts) {
    opts = opts || {};
    if (opts.enabled === false) return null;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    var ctx;
    try { ctx = new AC(); } catch (e) { return null; }
    var vol = Math.max(0, Math.min(1, opts.volume == null ? 0.5 : +opts.volume));

    // Master: Pegel → Kompressor/Begrenzer → Ausgang
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 10; comp.attack.value = 0.004; comp.release.value = 0.25;
    var master = ctx.createGain(); master.gain.value = vol * 0.6;
    master.connect(comp); comp.connect(ctx.destination);

    // gemeinsamer Rauschpuffer (2 s weißes Rauschen; feste Folge, damit nichts zufällig klingt)
    var noiseBuf = (function () {
      var n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0), a = 1234567;
      for (var i = 0; i < n; i++) { a = (a * 1103515245 + 12345) & 0x7fffffff; d[i] = a / 0x3fffffff - 1; }
      return b;
    })();
    function now() { return ctx.currentTime; }
    function noise(loop) { var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = !!loop; return s; }
    function env(g, t, a, peak, d) {   // Hüllkurve: Anstieg a, Spitze, Abklingen d
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    function tone(type, f, t, a, peak, d, f2) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
      env(g, t, a, peak, d); o.connect(g); g.connect(master);
      o.start(t); o.stop(t + a + d + 0.05);
    }
    function burst(filterType, f, q, t, a, peak, d, f2) {
      var s = noise(false), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      fl.type = filterType; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + d);
      env(g, t, a, peak, d); s.connect(fl); fl.connect(g); g.connect(master);
      s.start(t, Math.random() * 1.5); s.stop(t + a + d + 0.05);
    }

    // ---- Dauerklänge ----
    var eng = null, fireG = null, fireNext = 0, lastWhoosh = -1, motors = [], skidN = null, rumbleG = null, scrapeN = null, lastCrash = -1;
    function engineNodes() {
      if (eng) return eng;
      var out = ctx.createGain(); out.gain.value = 0; out.connect(master);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.connect(out);
      var o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'sawtooth'; o1.frequency.value = 48; o2.frequency.value = 49.5;
      var og = ctx.createGain(); og.gain.value = 0.35; o1.connect(og); o2.connect(og); og.connect(lp);
      var n = noise(true), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 0.8;
      var ng = ctx.createGain(); ng.gain.value = 0.5; n.connect(bp); bp.connect(ng); ng.connect(out);
      o1.start(); o2.start(); n.start();
      return (eng = { out: out, o1: o1, o2: o2, bp: bp, lp: lp });
    }

    var api = {
      ctx: ctx,
      resume: function () { if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {}); },
      join: function () { var t = now(); tone('sine', 1320, t, 0.005, 0.12, 0.3); tone('sine', 1980, t + 0.04, 0.005, 0.05, 0.25); },
      beep: function () { tone('square', 880, now(), 0.005, 0.07, 0.16); },
      go: function () { var t = now(); tone('square', 1320, t, 0.005, 0.09, 0.55); tone('sine', 660, t, 0.005, 0.05, 0.5); },
      engine: function (on, speed, boost) {
        if (!on && !eng) return;
        var e = engineNodes(), t = now(), v = Math.max(0, speed || 0);
        e.out.gain.setTargetAtTime(on ? 0.11 * (1 + 0.8 * (boost || 0)) : 0, t, on ? 0.4 : 0.25);
        e.o1.frequency.setTargetAtTime(42 + v * 3.2, t, 0.3);
        e.o2.frequency.setTargetAtTime(43.5 + v * 3.25, t, 0.3);
        e.bp.frequency.setTargetAtTime(180 + v * 18, t, 0.3);
        e.lp.frequency.setTargetAtTime(300 + v * 14, t, 0.3);
      },
      nitro: function () {
        var t = now();
        burst('highpass', 2500, 0.7, t, 0.05, 0.12, 1.1);
        tone('sine', 1400, t + 0.05, 0.08, 0.05, 0.8, 3200);
      },
      thud: function (heavy) {
        var t = now(), k = heavy ? 1 : 0.6;
        tone('sine', 110, t, 0.004, 0.25 * k, 0.28, 38);
        burst('bandpass', 1700, 6, t, 0.002, 0.12 * k, 0.12);
        tone('triangle', 620, t + 0.01, 0.002, 0.05 * k, 0.35, 540);
      },
      squeal: function () {
        var t = now(), o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = 1050; lfo.frequency.value = 23; lg.gain.value = 40;
        lfo.connect(lg); lg.connect(o.frequency);
        bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 4;
        env(g, t, 0.04, 0.045, 0.65); o.connect(bp); bp.connect(g); g.connect(master);
        o.start(t); lfo.start(t); o.stop(t + 0.75); lfo.stop(t + 0.75);
      },
      gravel: function () {
        var t = now();
        for (var i = 0; i < 6; i++) burst('lowpass', 900, 0.7, t + i * 0.07, 0.01, 0.06, 0.12);
      },
      whoosh: function () {
        var t = now();
        if (t - lastWhoosh < 0.4) return;
        lastWhoosh = t;
        burst('bandpass', 400, 1.2, t, 0.12, 0.05, 0.28, 2200);
      },
      fire: function (level) {
        level = Math.max(0, Math.min(1, level || 0));
        if (!fireG && level <= 0) return;
        var t = now();
        if (!fireG) {
          fireG = ctx.createGain(); fireG.gain.value = 0; fireG.connect(master);
          var n = noise(true), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650;
          n.connect(lp); lp.connect(fireG); n.start();
        }
        fireG.gain.setTargetAtTime(0.05 * level, t, 0.3);
        // Knacken: kurze Knackser in unregelmäßigen Abständen
        if (level > 0 && t >= fireNext) { burst('highpass', 2200, 0.8, t, 0.001, 0.05 * level, 0.04); fireNext = t + 0.05 + Math.random() * 0.25 / level; }
      },
      cheer: function () {
        var t = now();
        [700, 1100, 1700].forEach(function (f, i) {
          var s = noise(false), bp = ctx.createBiquadFilter(), g = ctx.createGain();
          bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.9;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06 / (i + 1), t + 1.0);
          g.gain.setValueAtTime(0.06 / (i + 1), t + 2.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 4.6);
          s.connect(bp); bp.connect(g); g.connect(master); s.start(t, i * 0.4); s.stop(t + 4.7);
        });
      },
      fanfare: function () {
        var t = now() + 0.3;
        [[523.25, 659.25, 783.99], [587.33, 739.99, 880], [659.25, 830.61, 987.77, 1318.51]].forEach(function (ch, k) {
          ch.forEach(function (f) { tone('sawtooth', f, t + k * 0.32, 0.02, 0.03, k === 2 ? 0.9 : 0.28); });
        });
      },
      silence: function () {
        api.engine(false); if (fireG) fireG.gain.setTargetAtTime(0, now(), 0.2);
        motors.forEach(function (m) { m.set(false); });
        api.skid(0); api.rumble(0); api.scrape(0);
      },
      setVolume: function (v) {
        vol = Math.max(0, Math.min(1, +v || 0));
        master.gain.setTargetAtTime(vol * 0.6, now(), 0.05);
      },
      // eigenständiger Motor: zwei Sägezähne (Grundton + Oberton) + gefiltertes Rauschen, Tonhöhe aus Tempo und Gas
      motor: function (gain) {
        var k = gain == null ? 1 : gain;
        var out = ctx.createGain(); out.gain.value = 0; out.connect(master);
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.connect(out);
        var o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), og = ctx.createGain();
        o1.type = 'sawtooth'; o2.type = 'square'; o1.frequency.value = 50; o2.frequency.value = 100; og.gain.value = 0.3;
        o1.connect(og); o2.connect(og); og.connect(lp);
        var n = noise(true), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
        bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 0.9; ng.gain.value = 0.35;
        n.connect(bp); bp.connect(ng); ng.connect(out);
        o1.start(); o2.start(); n.start(Math.random() * 1.5);
        var m = {
          set: function (on, speed, thr) {
            var t = now(), v = Math.max(0, speed || 0), th = Math.max(0, Math.min(1, thr || 0));
            // „Gänge“: Drehzahl steigt je Gang an und fällt beim Schalten zurück
            var g = v % 7 / 7, f = 46 + v * 1.6 + g * 38 + th * 14;
            out.gain.setTargetAtTime(on ? k * (0.07 + 0.06 * th) : 0, t, on ? 0.15 : 0.2);
            o1.frequency.setTargetAtTime(f, t, 0.08); o2.frequency.setTargetAtTime(f * 2.01, t, 0.08);
            bp.frequency.setTargetAtTime(220 + f * 3, t, 0.1); lp.frequency.setTargetAtTime(300 + f * 4 + th * 500, t, 0.1);
          },
          stop: function () {
            m.set(false);
            setTimeout(function () { try { o1.stop(); o2.stop(); n.stop(); out.disconnect(); } catch (e) { /* schon aus */ } }, 600);
            motors = motors.filter(function (x) { return x !== m; });
          }
        };
        motors.push(m);
        return m;
      },
      skid: function (level) {
        level = Math.max(0, Math.min(1, level || 0));
        if (!skidN && level <= 0) return;
        if (!skidN) {
          var o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
          o.type = 'sawtooth'; o.frequency.value = 980; lfo.frequency.value = 19; lg.gain.value = 35;
          lfo.connect(lg); lg.connect(o.frequency);
          bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 5; g.gain.value = 0;
          o.connect(bp); bp.connect(g); g.connect(master); o.start(); lfo.start();
          skidN = { g: g, o: o };
        }
        var t = now();
        skidN.g.gain.setTargetAtTime(0.035 * level, t, level > 0 ? 0.05 : 0.12);
        skidN.o.frequency.setTargetAtTime(900 + 220 * level, t, 0.1);
      },
      rumble: function (level) {
        level = Math.max(0, Math.min(1, level || 0));
        if (!rumbleG && level <= 0) return;
        if (!rumbleG) {
          var n = noise(true), lp = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain();
          lp.type = 'lowpass'; lp.frequency.value = 520;
          rumbleG = ctx.createGain(); rumbleG.gain.value = 0;
          lfo.frequency.value = 13; lg.gain.value = 0.4; lfo.connect(lg);
          var am = ctx.createGain(); am.gain.value = 0.7; lg.connect(am.gain);
          n.connect(lp); lp.connect(am); am.connect(rumbleG); rumbleG.connect(master); n.start(); lfo.start();
        }
        rumbleG.gain.setTargetAtTime(0.09 * level, now(), 0.08);
      },
      crash: function (level) {
        var t = now();
        level = Math.max(0, Math.min(1, level || 0));
        if (level <= 0 || t - lastCrash < 0.12) return;
        lastCrash = t;
        var k = 0.35 + 0.65 * level;
        tone('sine', 95 + 30 * (1 - level), t, 0.004, 0.32 * k, 0.22 + 0.25 * level, 34);   // dumpfer Schlag
        burst('lowpass', 1400, 0.8, t, 0.003, 0.2 * k, 0.16 + 0.22 * level, 260);           // Knirschen
        burst('bandpass', 2400, 3, t + 0.012, 0.002, 0.09 * k, 0.1 + 0.12 * level, 900);
        [430, 690, 1130].forEach(function (f, i) {                                          // Blech schwingt nach
          tone('triangle', f * (0.92 + 0.16 * Math.random()), t + 0.008 * i, 0.002, 0.035 * k, 0.25 + 0.35 * level, f * 0.86);
        });
        if (level > 0.6) {                                                                  // Splittern
          for (var i = 0; i < 5; i++) burst('highpass', 5200 + i * 600, 1.5, t + 0.04 + i * 0.035 + Math.random() * 0.02, 0.002, 0.04 * level, 0.07);
        }
      },
      scrape: function (level) {
        level = Math.max(0, Math.min(1, level || 0));
        if (!scrapeN && level <= 0) return;
        if (!scrapeN) {
          var n = noise(true), bp = ctx.createBiquadFilter(), bp2 = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain();
          var am = ctx.createGain(), g = ctx.createGain();
          bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 2.5;
          bp2.type = 'bandpass'; bp2.frequency.value = 3400; bp2.Q.value = 6;
          lfo.frequency.value = 31; lg.gain.value = 0.45; lfo.connect(lg); am.gain.value = 0.6; lg.connect(am.gain);
          g.gain.value = 0;
          n.connect(bp); n.connect(bp2); bp.connect(am); bp2.connect(am); am.connect(g); g.connect(master); n.start(); lfo.start();
          scrapeN = { g: g, bp: bp, lfo: lfo };
        }
        var t = now();
        scrapeN.g.gain.setTargetAtTime(0.11 * level, t, level > 0 ? 0.03 : 0.1);
        scrapeN.bp.frequency.setTargetAtTime(1700 + 900 * level, t, 0.08);
        scrapeN.lfo.frequency.setTargetAtTime(22 + 25 * level, t, 0.1);
      },
      jingle: function (big) {
        var t = now(), notes = big ? [659.25, 783.99, 987.77, 1318.51] : [783.99, 1046.5];
        notes.forEach(function (f, i) { tone('triangle', f, t + i * 0.11, 0.01, big ? 0.07 : 0.05, big && i === notes.length - 1 ? 0.6 : 0.22); });
      }
    };
    return api;
  }

  root.CarRaceSound = { create: create };
})(typeof window !== 'undefined' ? window : this);
