/* Frost-Ebene der Weather-Source: Eisblumen wachsen von Ecken und Rändern
 * ins Bild (Stand 0..100 kommt vom Server), die Mitte bleibt frei.
 * !scrape fährt mit einem Kratzer eine Bahn frei, !warm haucht eine Stelle
 * frei (Atemwolke, Dampf); freie Stellen frieren in ~60 s wieder zu.
 *
 *   var frost = WeatherFrost.create(stageEl, { tags: svgGroup });
 *   frost.update(level, on);  frost.scrape(name, done, level);
 *   frost.warm(name, done, level);  frost.leaders(top);
 */
(function (root) {
  'use strict';

  var W = 1920, H = 1080;
  var reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function lerpN(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

  // ── Eisblumen wie am Fenster: geschwungene Federn/Farne, Seitenäste im
  //    60°-Winkel (sechseckiges Eis) in zwei Ordnungen, zur Spitze hin kürzer.
  //    Keime sitzen an Ecken und Rändern; je weiter innen, desto später
  //    (Schwelle thr = Frost-Stand, ab dem die Feder erscheint) ──
  function feather(x, y, ang, len, depth, out) {
    var step = 6, n = Math.max(2, Math.round(len / step));
    var curve = rand(-0.012, 0.012), px = x, py = y, a = ang;
    var stem = [[x, y]];
    for (var i = 1; i <= n; i++) {
      a += curve + rand(-0.02, 0.02);
      px += Math.cos(a) * step;
      py += Math.sin(a) * step;
      stem.push([px, py]);
      // Seitenäste beidseitig, zur Spitze hin kürzer (Federform)
      if (i % 2 === 0 && i < n - 1) {
        var side = len * (depth > 1 ? 0.42 : 0.3) * Math.pow(1 - i / n, 0.75);
        [1.047, -1.047].forEach(function (off) {
          var sl = side * rand(0.7, 1.05);
          if (sl < 4) return;
          if (depth > 1) feather(px, py, a + off, sl, depth - 1, out);
          else out.push({ pts: [[px, py], [px + Math.cos(a + off) * sl, py + Math.sin(a + off) * sl]], w: 0.8 });
        });
      }
    }
    out.push({ pts: stem, w: depth > 1 ? 1.6 : 1.1 });
  }

  function makeBranches() {
    var out = [];
    function seed(x, y, ang, len, depth, thr) {
      var lines = [];
      feather(x, y, ang, len, depth, lines);
      out.push({ lines: lines, thr: thr });
    }
    // Ecken: große Farne, früh
    [[0, 0, 0.785], [W, 0, 2.356], [0, H, -0.785], [W, H, -2.356]].forEach(function (c) {
      for (var i = 0; i < 14; i++) {
        seed(c[0] + rand(-20, 20), c[1] + rand(-20, 20), c[2] + rand(-0.85, 0.85), rand(160, 420), 3, rand(0, 25));
      }
    });
    // Ränder und nach innen: Keim je Abstand zum Rand später
    for (var k = 0; k < 170; k++) {
      var side = k % 4, t = rand(0.04, 0.96), d = Math.pow(Math.random(), 1.6) * 330;
      var x = side === 0 || side === 1 ? t * W : side === 2 ? d : W - d;
      var y = side === 0 ? d : side === 1 ? H - d : t * H;
      var inward = side === 0 ? Math.PI / 2 : side === 1 ? -Math.PI / 2 : side === 2 ? 0 : Math.PI;
      var edgeDist = Math.min(x, W - x, y, H - y);
      var thr = clamp(8 + edgeDist / 330 * 70 + rand(-6, 6), 0, 95);
      seed(x, y, inward + rand(-1.2, 1.2), rand(50, 210), Math.random() < 0.6 ? 2 : 3, thr);
    }
    out.sort(function (p, q) { return p.thr - q.thr; });
    return out;
  }

  // körniger Raureif: Punkte, die vom Rand nach innen erscheinen
  function makeSpeckles() {
    var out = [];
    for (var i = 0; i < 9000; i++) {
      var x = Math.random() * W, y = Math.random() * H;
      var edge = Math.min(x / W, 1 - x / W, y / H * 1.6, (1 - y / H) * 1.6);   // 0 am Rand, ~0,5 innen
      var cornerBoost = Math.min(x, W - x) < 300 && Math.min(y, H - y) < 300 ? 0.08 : 0;
      out.push({ x: x, y: y, r: Math.random() < 0.85 ? 1 : 1.8, thr: clamp((edge - cornerBoost) * 180 - 4, 0, 100) });
    }
    return out;
  }

  function create(stage, opts) {
    opts = opts || {};
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.className = 'wk-layer wk-frost';
    stage.appendChild(cv);
    var ctx = cv.getContext('2d');
    var branches = makeBranches();
    var speckles = makeSpeckles();
    var level = 0, shown = 0, on = true, drawnAt = -1, first = true;
    var holes = [], steam = [], sparks = [], tool = null;
    var tags = opts.tags || null;
    var board = opts.board || null;

    function tag(text, x, y) {
      if (root.SeasonKit && tags) root.SeasonKit.tag(tags, text, x, y, true);
    }

    // Federn liegen auf einer Sammel-Ebene: steigt der Stand, kommen nur die
    // neuen dazu; sinkt er (Kratzen), wird neu aufgebaut
    var acc = document.createElement('canvas');
    acc.width = W; acc.height = H;
    var actx = acc.getContext('2d');
    var accLevel = 0;
    function drawFeathers(from, to) {
      actx.lineCap = 'round';
      actx.lineJoin = 'round';
      branches.forEach(function (b) {
        if (b.thr <= from || b.thr > to) return;
        b.lines.forEach(function (ln) {
          actx.strokeStyle = 'rgba(238,247,255,' + (ln.w > 1.2 ? 0.55 : 0.38) + ')';
          actx.lineWidth = ln.w;
          actx.beginPath();
          actx.moveTo(ln.pts[0][0], ln.pts[0][1]);
          for (var i = 1; i < ln.pts.length; i++) actx.lineTo(ln.pts[i][0], ln.pts[i][1]);
          actx.stroke();
        });
      });
    }
    function syncFeathers(L) {
      if (L < accLevel - 0.5) {
        actx.clearRect(0, 0, W, H);
        accLevel = 0;
      }
      if (L > accLevel) {
        drawFeathers(accLevel, L);
        accLevel = L;
      }
    }

    function drawCrystals() {
      ctx.clearRect(0, 0, W, H);
      syncFeathers(shown);
      if (shown < 0.3) return;
      var L = shown;
      // Raureif-Schleier an den Rändern, Mitte frei
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(1, H / W);
      var haze = ctx.createRadialGradient(0, 0, W * lerpN(0.62, 0.3, L / 100), 0, 0, W * 0.72);
      haze.addColorStop(0, 'rgba(225,240,255,0)');
      haze.addColorStop(1, 'rgba(228,242,255,' + (0.6 * Math.sqrt(L / 100)) + ')');
      ctx.fillStyle = haze;
      ctx.fillRect(-W, -W, W * 2, W * 2);
      ctx.restore();
      // beschlagene Ecken: schon bei wenigen Prozent sichtbar, wachsen mit
      var cr = 200 + 7 * L, ca = 0.42 * Math.min(1, (L + 4) / 22);
      [[0, 0], [W, 0], [0, H], [W, H]].forEach(function (c) {
        var cg = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], cr);
        cg.addColorStop(0, 'rgba(232,244,255,' + ca + ')');
        cg.addColorStop(0.6, 'rgba(232,244,255,' + (ca * 0.45) + ')');
        cg.addColorStop(1, 'rgba(232,244,255,0)');
        ctx.fillStyle = cg;
        ctx.fillRect(c[0] - cr, c[1] - cr, cr * 2, cr * 2);
      });
      // Raureif-Körnung
      ctx.fillStyle = 'rgba(240,248,255,0.55)';
      speckles.forEach(function (p) {
        if (p.thr > L) return;
        ctx.fillRect(p.x, p.y, p.r, p.r);
      });
      // Federn mit leichtem Schimmer
      ctx.save();
      ctx.shadowColor = 'rgba(200,230,255,0.7)';
      ctx.shadowBlur = 3;
      ctx.drawImage(acc, 0, 0);
      ctx.restore();
    }

    // freie Stellen ausstanzen; sie frieren in ~60 s wieder zu
    function drawHoles(now) {
      holes = holes.filter(function (h) { return now - h.t0 < 60; });
      if (!holes.length) return;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      holes.forEach(function (h) {
        var k = 1 - smooth((now - h.t0 - 15) / 45);
        var g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r);
        g.addColorStop(0, 'rgba(0,0,0,' + (0.95 * k) + ')');
        g.addColorStop(0.7, 'rgba(0,0,0,' + (0.8 * k) + ')');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(h.x - h.r, h.y - h.r, h.r * 2, h.r * 2);
      });
      ctx.restore();
    }

    function drawOver(dt) {
      // Dampf beim Hauchen
      steam = steam.filter(function (p) { return (p.life -= dt) > 0; });
      steam.forEach(function (p) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.r += 30 * dt;
        var a = 0.3 * Math.min(1, p.life / 0.8) * smooth((1.6 - p.life) / 0.3);
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, 'rgba(240,246,255,' + a + ')');
        g.addColorStop(1, 'rgba(240,246,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      });
      // Freude-Funkeln, wenn die Scheibe frei ist
      sparks = sparks.filter(function (p) { return (p.life -= dt) > 0; });
      ctx.fillStyle = 'rgba(255,250,220,1)';
      sparks.forEach(function (p) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt;
        ctx.globalAlpha = Math.min(1, p.life);
        var r = 2 + 2 * Math.sin(p.life * 12);
        ctx.fillRect(p.x - r, p.y - 0.6, r * 2, 1.2);
        ctx.fillRect(p.x - 0.6, p.y - r, 1.2, r * 2);
      });
      ctx.globalAlpha = 1;
      // Kratzer fährt seine Bahn
      if (tool) {
        tool.t += dt;
        var k = Math.min(1, tool.t / tool.dur);
        var x = tool.x0 + (tool.x1 - tool.x0) * k, y = tool.y0 + (tool.y1 - tool.y0) * k + Math.sin(k * Math.PI * 6) * 10;
        if (k < 1 && Math.random() < 0.8) holes.push({ x: x, y: y, r: 55, t0: tool.now + tool.t });
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(k * Math.PI * 4) * 0.3 + tool.ang);
        ctx.fillStyle = 'rgba(127,196,255,0.95)';
        ctx.strokeStyle = 'rgba(42,100,184,1)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.rect(-60, -14, 120, 28);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(42,100,184,1)';
        ctx.fillRect(-14, 10, 28, 70);
        ctx.restore();
        if (k >= 1) tool = null;
      }
    }

    // Stelle am Rand, wo gerade Frost ist (Ecken bevorzugt)
    function frostySpot() {
      var c = [[200, 170], [W - 200, 170], [200, H - 170], [W - 200, H - 170],
               [W / 2, 90], [W / 2, H - 90], [110, H / 2], [W - 110, H / 2]];
      var pick = shown > 60 ? c[(Math.random() * c.length) | 0] : c[(Math.random() * 4) | 0];
      return [pick[0] + rand(-60, 60), pick[1] + rand(-40, 40)];
    }

    function celebrate(name) {
      for (var i = 0; i < 70; i++) {
        sparks.push({ x: rand(150, W - 150), y: rand(80, H - 200), vx: rand(-40, 40), vy: rand(-90, -20), life: rand(1, 2.2) });
      }
      tag('Glass is clear! Thanks, ' + (name || 'chat') + '!', W / 2, 420);
    }

    var last = null, time = 0;
    function frame(ts) {
      var dt = last === null ? 0 : Math.min((ts - last) / 1000, 0.05);
      last = ts;
      time += dt;
      // sichtbarer Stand: wächst langsam nach, sinkt nach Kratzen schnell
      if (shown < level) shown = Math.min(level, shown + Math.max(0.6, (level - shown) * 0.25) * dt);
      else if (shown > level) shown = Math.max(level, shown - Math.max(8, (shown - level) * 2) * dt);
      if (!on) { if (drawnAt !== -2) { ctx.clearRect(0, 0, W, H); drawnAt = -2; } }
      else if (Math.abs(shown - drawnAt) > 0.3 || holes.length || steam.length || sparks.length || tool) {
        drawCrystals();
        drawHoles(time);
        drawOver(dt);
        drawnAt = (holes.length || steam.length || sparks.length || tool) ? -1 : shown;
      }
      root.requestAnimationFrame(frame);
    }
    root.requestAnimationFrame(frame);

    return {
      update: function (lv, isOn) {
        level = clamp(lv || 0, 0, 100);
        on = isOn !== false;
        // beim Laden sofort auf dem Stand, danach wächst er sichtbar nach
        if (reduceMotion || first) shown = level;
        first = false;
      },
      scrape: function (name, done, lv) {
        var p = frostySpot();
        if (!done) { tag((name || 'Someone') + ': no frost yet', p[0], p[1] - 60); return; }
        level = clamp(lv, 0, 100);
        var dir = p[0] < W / 2 ? 1 : -1;
        if (reduceMotion) holes.push({ x: p[0], y: p[1], r: 120, t0: time });
        else tool = { x0: p[0] - dir * 160, y0: p[1], x1: p[0] + dir * 160, y1: p[1] + rand(-30, 30),
                      t: 0, dur: 1.2, now: time, ang: dir > 0 ? 0.2 : -0.2 };
        tag((name || 'Someone') + ' scraped the frost!', p[0], p[1] - 80);
        if (level <= 0) celebrate(name);
      },
      warm: function (name, done, lv) {
        var p = frostySpot();
        if (!done) { tag((name || 'Someone') + ': no frost yet', p[0], p[1] - 60); return; }
        level = clamp(lv, 0, 100);
        holes.push({ x: p[0], y: p[1], r: 150, t0: time });
        if (!reduceMotion) {
          for (var i = 0; i < 18; i++) {
            steam.push({ x: p[0] + rand(-60, 60), y: p[1] + rand(-30, 30), vx: rand(-20, 20), vy: rand(-70, -30),
                         r: rand(30, 60), life: rand(1.2, 1.6) });
          }
        }
        tag((name || 'Someone') + ' breathed on the glass!', p[0], p[1] - 90);
        if (level <= 0) celebrate(name);
      },
      clearAll: function () { level = 0; },
      leaders: function (top) {
        if (!board) return;
        var list = board.querySelector('ol');
        while (list.firstChild) list.removeChild(list.firstChild);
        var rows = top && top.length ? top : [['Nobody yet', 0]];
        rows.forEach(function (e, i) {
          var li = document.createElement('li');
          var a = document.createElement('span'), b = document.createElement('span');
          a.textContent = (i + 1) + '. ' + e[0];
          b.textContent = e[1] + '×';
          li.appendChild(a); li.appendChild(b); list.appendChild(li);
        });
        board.classList.remove('is-on'); void board.offsetWidth; board.classList.add('is-on');
        clearTimeout(board._t);
        board._t = setTimeout(function () { board.classList.remove('is-on'); }, 10000);
      }
    };
  }

  root.WeatherFrost = { create: create };
})(typeof window !== 'undefined' ? window : this);
