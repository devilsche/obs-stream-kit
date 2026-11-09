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

  // ── Eisblumen-Äste: Startpunkt am Rand, Richtung nach innen, Schwelle,
  //    ab welchem Frost-Stand der Ast zu wachsen beginnt ──
  function makeBranches() {
    var out = [];
    function add(x, y, ang, len, thr) {
      var segs = [], px = x, py = y, a = ang;
      var n = Math.round(len / 14);
      for (var i = 0; i < n; i++) {
        a += rand(-0.18, 0.18);
        var nx = px + Math.cos(a) * 14, ny = py + Math.sin(a) * 14;
        // Farnblätter: kurze Seitenzweige im 60°-Winkel
        var twigs = [];
        if (i > 1 && i % 2 === 0) {
          var tl = rand(10, 34) * (1 - i / n * 0.6);
          twigs.push([a + 1.05, tl], [a - 1.05, tl * rand(0.6, 1)]);
        }
        segs.push({ x0: px, y0: py, x1: nx, y1: ny, twigs: twigs });
        px = nx; py = ny;
      }
      out.push({ segs: segs, thr: thr, w: rand(1.1, 2.2) });
    }
    // Ecken: viele lange Äste, früh
    [[0, 0, 0.785], [W, 0, 2.356], [0, H, -0.785], [W, H, -2.356]].forEach(function (c) {
      for (var i = 0; i < 24; i++) {
        add(c[0] + rand(-10, 10), c[1] + rand(-10, 10), c[2] + rand(-0.8, 0.8), rand(180, 640), rand(0, 30));
      }
    });
    // Ränder: kürzere Äste, später
    for (var k = 0; k < 110; k++) {
      var side = k % 4, t = rand(0.12, 0.88);
      var x = side === 0 ? t * W : side === 1 ? t * W : side === 2 ? 0 : W;
      var y = side === 0 ? 0 : side === 1 ? H : t * H;
      var ang = side === 0 ? Math.PI / 2 : side === 1 ? -Math.PI / 2 : side === 2 ? 0 : Math.PI;
      add(x, y, ang + rand(-0.6, 0.6), rand(80, 300), rand(12, 70));
    }
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

    function drawCrystals() {
      ctx.clearRect(0, 0, W, H);
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
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(200,230,255,0.8)';
      ctx.shadowBlur = 4;
      branches.forEach(function (b) {
        var grow = clamp((L - b.thr) / 18, 0, 1);
        if (grow <= 0) return;
        var n = Math.max(1, Math.round(b.segs.length * grow));
        ctx.strokeStyle = 'rgba(240,248,255,' + (0.5 + 0.4 * grow) + ')';
        ctx.lineWidth = b.w * 1.3;
        ctx.beginPath();
        for (var i = 0; i < n; i++) {
          var s = b.segs[i];
          ctx.moveTo(s.x0, s.y0);
          ctx.lineTo(s.x1, s.y1);
          s.twigs.forEach(function (tw) {
            ctx.moveTo(s.x1, s.y1);
            ctx.lineTo(s.x1 + Math.cos(tw[0]) * tw[1] * grow, s.y1 + Math.sin(tw[0]) * tw[1] * grow);
          });
        }
        ctx.stroke();
      });
      ctx.shadowBlur = 0;
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
