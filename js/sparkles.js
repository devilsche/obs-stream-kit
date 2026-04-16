/*
  Shared Sparkle Engine — obs-stream-kit
  Fliegende ✦ Sparkles via requestAnimationFrame.

  Usage:
    const engine = new SparkleEngine(container, {
      count: 14,
      speed: 0.5,
      maxOpacity: 1.0,
      colors: { gold: 0.35, purple: 0.35, white: 0.30 },
      sizeWeights: { big: 0.15, normal: 0.35, small: 0.35, tiny: 0.15 },
      fixedColor: null  // 'gold' | 'purple' | 'white' — overrides random
    });
    engine.start();
*/

(function(root) {
  'use strict';

  var COLORS = {
    gold:   { color: '#f2b705', shadow: 'rgba(242,183,5,0.8)',   shadowFar: 'rgba(242,183,5,0.4)' },
    purple: { color: '#c9a0dc', shadow: 'rgba(201,160,220,0.8)', shadowFar: 'rgba(201,160,220,0.4)' },
    white:  { color: '#ffffff', shadow: 'rgba(255,255,255,0.8)', shadowFar: 'rgba(255,255,255,0.4)' }
  };

  var SIZE_PX = { big: 20, normal: 14, small: 9, tiny: 6 };
  var SIZE_NAMES = ['big', 'normal', 'small', 'tiny'];

  function weightedPick(weights) {
    var keys = Object.keys(weights);
    var r = Math.random();
    var sum = 0;
    for (var i = 0; i < keys.length; i++) {
      sum += weights[keys[i]];
      if (r < sum) return keys[i];
    }
    return keys[keys.length - 1];
  }

  function Sparkle(container, w, h, opts) {
    this.w = w;
    this.h = h;
    this.x = Math.random() * w;
    this.y = Math.random() * h;
    this.vx = (Math.random() - 0.5) * (opts.speed || 0.5);
    this.vy = (Math.random() - 0.5) * (opts.speed || 0.5);
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.wobbleSpeed = 0.005 + Math.random() * 0.01;
    this.fadePhase = Math.random() * Math.PI * 2;
    this.fadeCycle = 4000 + Math.random() * 4000;
    this.maxOpacity = opts.maxOpacity || 1.0;

    var colorName = opts.fixedColor || weightedPick(opts.colors);
    var sizeName = weightedPick(opts.sizeWeights);
    var c = COLORS[colorName];

    this.el = document.createElement('span');
    this.el.textContent = '\u2726'; // ✦
    this.el.style.cssText =
      'position:absolute;pointer-events:none;font-family:serif;' +
      'font-size:' + SIZE_PX[sizeName] + 'px;' +
      'color:' + c.color + ';' +
      'text-shadow:0 0 6px ' + c.shadow + ',0 0 15px ' + c.shadowFar + ';' +
      'will-change:transform,opacity;';
    container.appendChild(this.el);
  }

  Sparkle.prototype.update = function(t) {
    this.vx += Math.sin(this.wobblePhase + t * this.wobbleSpeed) * 0.01;
    this.vy += Math.cos(this.wobblePhase + t * this.wobbleSpeed * 0.7) * 0.01;

    if (Math.random() < 0.003) {
      this.vx += (Math.random() - 0.5) * 0.3;
      this.vy += (Math.random() - 0.5) * 0.3;
    }

    this.vx *= 0.999;
    this.vy *= 0.999;
    this.x += this.vx;
    this.y += this.vy;

    // Am Rand sanft umkehren statt harten Wrap-Around
    var margin = 30;
    if (this.x < margin) {
      this.vx += 0.02;
    } else if (this.x > this.w - margin) {
      this.vx -= 0.02;
    }
    if (this.y < margin) {
      this.vy += 0.02;
    } else if (this.y > this.h - margin) {
      this.vy -= 0.02;
    }
    // Sicherheitsnetz: falls doch rausgeflogen, sanft zurücksetzen
    if (this.x < -10) { this.x = margin; this.vx = Math.abs(this.vx); }
    if (this.x > this.w + 10) { this.x = this.w - margin; this.vx = -Math.abs(this.vx); }
    if (this.y < -10) { this.y = margin; this.vy = Math.abs(this.vy); }
    if (this.y > this.h + 10) { this.y = this.h - margin; this.vy = -Math.abs(this.vy); }

    // Randnähe → Opacity runterfahren (fade out statt harter Abschnitt)
    var edgeFade = 1.0;
    var fadeZone = 40;
    if (this.x < fadeZone) edgeFade = Math.min(edgeFade, this.x / fadeZone);
    if (this.x > this.w - fadeZone) edgeFade = Math.min(edgeFade, (this.w - this.x) / fadeZone);
    if (this.y < fadeZone) edgeFade = Math.min(edgeFade, this.y / fadeZone);
    if (this.y > this.h - fadeZone) edgeFade = Math.min(edgeFade, (this.h - this.y) / fadeZone);
    edgeFade = Math.max(0, edgeFade);

    var fade = (Math.sin(this.fadePhase + t / this.fadeCycle * Math.PI * 2) + 1) / 2;
    var opacity = (0.1 + fade * 0.9) * this.maxOpacity * edgeFade;

    this.el.style.transform = 'translate(' + this.x + 'px,' + this.y + 'px)';
    this.el.style.opacity = opacity;
  };

  function SparkleEngine(container, opts) {
    opts = opts || {};
    this.container = container;
    this.count = opts.count || 14;
    this.opts = {
      speed: opts.speed || 0.5,
      maxOpacity: opts.maxOpacity || 1.0,
      colors: opts.colors || { gold: 0.35, purple: 0.35, white: 0.30 },
      sizeWeights: opts.sizeWeights || { big: 0.15, normal: 0.35, small: 0.35, tiny: 0.15 },
      fixedColor: opts.fixedColor || null
    };
    this.sparkles = [];
    this._raf = null;
  }

  SparkleEngine.prototype.start = function() {
    var rect = this.container.getBoundingClientRect();
    var w = rect.width || this.container.offsetWidth || 500;
    var h = rect.height || this.container.offsetHeight || 300;

    for (var i = 0; i < this.count; i++) {
      this.sparkles.push(new Sparkle(this.container, w, h, this.opts));
    }

    var self = this;
    function loop(t) {
      for (var i = 0; i < self.sparkles.length; i++) {
        self.sparkles[i].update(t);
      }
      self._raf = requestAnimationFrame(loop);
    }
    this._raf = requestAnimationFrame(loop);
  };

  SparkleEngine.prototype.stop = function() {
    if (this._raf) cancelAnimationFrame(this._raf);
  };

  root.SparkleEngine = SparkleEngine;

})(window);
