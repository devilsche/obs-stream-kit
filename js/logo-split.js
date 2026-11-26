/* Logo zerlegen – gemeinsam für Logo 3D (widgets/logo-3d.html) und den Logo-Cut-Editor (tools/logo-cut.html).
   Automatik: Streifenbild nach zusammenhängenden Flächen, Textbild nach Buchstaben-Flächen samt Umriss
   (Marching Squares, Douglas-Peucker). Von Hand ausgeschnittene Teile (data/logo-cuts.json, Pixel des
   Originalbilds) ersetzen die Automatik: fromCuts baut daraus dieselben Teile, toCuts macht aus der Automatik
   bearbeitbare Umrisse. Kein Framework, ES5 (+ Canvas). */
(function () {
  // Arbeitsauflösung: längste Seite höchstens 2048 px
  function pixels(im, s) {
    var c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
    var x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
    return { c: c, d: x.getImageData(0, 0, c.width, c.height) };
  }

  /* Streifenbild: zusammenhängende Flächen (Deckkraft > 40), weicher Rand per Nachbarschaft dazu.
     Mehr als 40 oder weniger als 2 Flächen → das Bild bleibt ein Teil. */
  function splitBlobs(px) {
    var w = px.d.width, h = px.d.height, a = px.d.data, lab = new Int32Array(w * h), n = 0, stack = new Int32Array(w * h), area = [];
    for (var i = 0; i < w * h; i++) {
      if (lab[i] || a[i * 4 + 3] <= 40) continue;
      n++; var sp = 0, cnt = 0; stack[sp++] = i; lab[i] = n;
      while (sp) {
        var p = stack[--sp], x = p % w; cnt++;
        if (x > 0 && !lab[p - 1] && a[(p - 1) * 4 + 3] > 40) { lab[p - 1] = n; stack[sp++] = p - 1; }
        if (x < w - 1 && !lab[p + 1] && a[(p + 1) * 4 + 3] > 40) { lab[p + 1] = n; stack[sp++] = p + 1; }
        if (p >= w && !lab[p - w] && a[(p - w) * 4 + 3] > 40) { lab[p - w] = n; stack[sp++] = p - w; }
        if (p < w * (h - 1) && !lab[p + w] && a[(p + w) * 4 + 3] > 40) { lab[p + w] = n; stack[sp++] = p + w; }
      }
      area[n] = cnt;
    }
    var total = 0; area.forEach(function (v) { total += v || 0; });
    var keep = []; for (var k = 1; k <= n; k++) if (area[k] > total * 0.01) keep.push(k);
    if (keep.length < 2 || keep.length > 40) return null;
    // weicher Rand (Glow/Schatten) an die nächste Fläche hängen
    for (var pass = 0; pass < 6; pass++) {
      for (i = 0; i < w * h; i++) {
        if (lab[i] || !a[i * 4 + 3]) continue;
        var xx = i % w, nb = (xx > 0 && lab[i - 1]) || (xx < w - 1 && lab[i + 1]) || (i >= w && lab[i - w]) || (i < w * (h - 1) && lab[i + w]);
        if (nb) lab[i] = -nb;
      }
      for (i = 0; i < w * h; i++) if (lab[i] < 0) lab[i] = -lab[i];
    }
    return keep.map(function (id) {
      var x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (var i = 0; i < w * h; i++) if (lab[i] === id) { var x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      var c = document.createElement('canvas'); c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
      var o = c.getContext('2d'), im = o.createImageData(c.width, c.height);
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
        var s = y * w + x; if (lab[s] !== id) continue;
        var t = ((y - y0) * c.width + (x - x0)) * 4; im.data[t] = a[s * 4]; im.data[t + 1] = a[s * 4 + 1]; im.data[t + 2] = a[s * 4 + 2]; im.data[t + 3] = a[s * 4 + 3];
      }
      o.putImageData(im, 0, 0);
      // Form selbst nachbauen: deckender Kern (Alpha > 200) – Ecken aus der obersten und untersten Kernzeile,
      // Farbe = Mittel der Kernpixel (ohne Glanzlichter/Schatten)
      // Kern: Deckkraft > 60 (gemessen: Streifenkörper 86–255, Glow-Saum darunter); Transparenz = Median des Körpers
      var hist = new Array(256).fill(0), hn = 0;
      for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) { var qa = y * w + x; if (lab[qa] === id && a[qa * 4 + 3] > 60) { hist[a[qa * 4 + 3]]++; hn++; } }
      var med = 0, acc = 0; for (var hv = 0; hv < 256; hv++) { acc += hist[hv]; if (acc >= hn / 2) { med = hv; break; } }
      var amax = med, thr = 60, ty = -1, by = -1, rs = 0, gs = 0, bs = 0, cn = 0, as = 0;
      for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
        var q = y * w + x; if (lab[q] !== id || a[q * 4 + 3] < thr) continue;
        as += a[q * 4 + 3];
        if (ty < 0) ty = y; by = y;
        var L = a[q * 4] + a[q * 4 + 1] + a[q * 4 + 2];
        if (L > 60 && L < 660) { rs += a[q * 4]; gs += a[q * 4 + 1]; bs += a[q * 4 + 2]; cn++; }
      }
      function span(yy) { var mn = w, mx = -1; for (var xq = x0; xq <= x1; xq++) { var qq = yy * w + xq; if (lab[qq] === id && a[qq * 4 + 3] >= thr) { if (xq < mn) mn = xq; if (xq > mx) mx = xq; } } return [mn, mx]; }
      var poly = null;
      if (ty >= 0 && by - ty > 8) {
        var t0 = span(ty + 2), b0 = span(by - 2);
        if (t0[1] > t0[0] && b0[1] > b0[0]) poly = [[t0[0], ty], [t0[1], ty], [b0[1], by], [b0[0], by]];
      }
      return { c: c, x0: x0, y0: y0, poly: poly, col: cn ? [rs / cn / 255, gs / cn / 255, bs / cn / 255] : null, alpha: amax / 255 };
    }).sort(function (p, q) { return (p.x0 + p.c.width / 2) - (q.x0 + q.c.width / 2); });
  }

  /* Textbild: Buchstaben über Spalten mit hellen, deckenden Pixeln (volle Auflösung); jede Spalte bekommt alles zwischen
     den Mitten der Lücken. Mehr als 30 Teile → ein Teil. */
  function splitColumns(px, full) {
    var w = px.d.width, h = px.d.height, a = px.d.data, any = new Uint8Array(w), y, x;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3]) any[x] = 1;
    // Buchstaben-Spalten: helle, deckende Pixel in voller Auflösung, auf die Arbeitsbreite umgerechnet
    var fw = full.d.width, fh = full.d.height, fa = full.d.data, fcov = new Uint8Array(fw), cov = new Uint8Array(w);
    for (y = 0; y < fh; y++) for (x = 0; x < fw; x++) { var o = (y * fw + x) * 4; if (fa[o + 3] > 200 && fa[o] + fa[o + 1] + fa[o + 2] > 360) fcov[x] = 1; }
    var runsF = [], sf = -1;
    for (x = 0; x <= fw; x++) { var onf = x < fw && fcov[x]; if (onf && sf < 0) sf = x; if (!onf && sf >= 0) { runsF.push([sf, x]); sf = -1; } }
    runsF = runsF.filter(function (r) { return r[1] - r[0] > fw * 0.008; });
    var k = w / fw;
    runsF.forEach(function (r) { for (var q = Math.floor(r[0] * k); q < Math.ceil(r[1] * k) && q < w; q++) cov[q] = 1; });
    var runs0 = runsF.map(function (r) { return [r[0] * k, r[1] * k]; });
    var runs = runs0;
    if (runs.length < 2 || runs.length > 30) return null;
    var lo = 0; while (lo < w && !any[lo]) lo++; var hi = w - 1; while (hi > 0 && !any[hi]) hi--;
    var cuts = [lo]; for (var i = 1; i < runs.length; i++) cuts.push(Math.round((runs[i - 1][1] + runs[i][0]) / 2)); cuts.push(hi + 1);
    var top = h, bot = 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3]) { if (y < top) top = y; if (y > bot) bot = y; }
    return runs.map(function (r, i) {
      var c = document.createElement('canvas'); c.width = cuts[i + 1] - cuts[i]; c.height = bot - top + 1;
      c.getContext('2d').drawImage(px.c, cuts[i], top, c.width, c.height, 0, 0, c.width, c.height);
      return { c: c, x0: cuts[i], y0: top };
    });
  }
  /* Weicher Schlagschatten im Textbild (reines Schwarz, halbdeckend) gehört nicht zu den Buchstaben: er käme beim
     Zerschneiden in harten Streifen mit und würde sich mitdrehen. Er wird herausgelöst und je Buchstabe aus dessen
     eigener Form neu gebaut (letterShadow), hängt dahinter und dreht sich deckungsgleich mit; die Buchstaben behalten Schrift und Kontur. */
  function separateShadow(px) {
    var w = px.d.width, h = px.d.height, a = px.d.data;
    var sc = document.createElement('canvas'); sc.width = w; sc.height = h;
    var sx = sc.getContext('2d'), sd = sx.createImageData(w, h), fd = new ImageData(new Uint8ClampedArray(a), w, h), f = fd.data, n = 0;
    for (var i = 0; i < w * h * 4; i += 4) {
      if (f[i + 3] > 0 && f[i + 3] < 230 && f[i] + f[i + 1] + f[i + 2] < 45) { sd.data[i + 3] = f[i + 3]; f[i + 3] = 0; n++; }
    }
    if (n < w * h * 0.002) return { face: px, shadow: null };
    sx.putImageData(sd, 0, 0);
    var fc = document.createElement('canvas'); fc.width = w; fc.height = h; fc.getContext('2d').putImageData(fd, 0, 0);
    return { face: { c: fc, d: fd }, shadow: { c: sc, d: sd } };
  }
  // ── Buchstaben als echte 3D-Körper ──
  // Zerlegen nach zusammenhängenden Flächen (nicht nach Spalten: kursive Buchstaben überlappen sich in x), Umriss
  // samt Löchern (o, R, D) per Marching Squares nachzeichnen, vereinfachen, mit Fase extrudieren. Die Vorderseite
  // trägt das Originalbild, Fase und Flanken sind Chrom.
  var LT = 110;   // Deckkraft-Schwelle für den Umriss
  function splitLetters(px) {
    var w = px.d.width, h = px.d.height, a = px.d.data, lab = new Int32Array(w * h), st = new Int32Array(w * h), comps = [], n = 0;
    for (var i = 0; i < w * h; i++) {
      if (lab[i] || a[i * 4 + 3] < LT) continue;
      n++; var sp = 0, c = { n: n, x0: w, y0: h, x1: 0, y1: 0, cnt: 0 }; st[sp++] = i; lab[i] = n;
      while (sp) {
        var q = st[--sp], x = q % w, y = (q - x) / w; c.cnt++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        var nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
        for (var k = 0; k < 4; k++) { var m = nb[k]; if (m >= 0 && !lab[m] && a[m * 4 + 3] >= LT) { lab[m] = n; st[sp++] = m; } }
      }
      comps.push(c);
    }
    var big = comps.reduce(function (m, c) { return Math.max(m, c.cnt); }, 0);
    comps = comps.filter(function (c) { return c.cnt > big * 0.04; }).sort(function (p, q) { return p.x0 - q.x0; });
    if (comps.length < 2 || comps.length > 30) return null;
    return comps.map(function (c) {
      var pad = 2, cw = c.x1 - c.x0 + 1 + pad * 2, ch = c.y1 - c.y0 + 1 + pad * 2;
      var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      var g = cv.getContext('2d'), id = g.createImageData(cw, ch), mask = new Uint8Array(cw * ch);
      // nur diese Fläche (samt weichem Rand bis 2 px), Nachbarbuchstaben bleiben draußen
      for (var y = 0; y < ch; y++) for (var x = 0; x < cw; x++) {
        var sx = x + c.x0 - pad, sy = y + c.y0 - pad; if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        var si = sy * w + sx, own = lab[si] === c.n;
        if (!own && a[si * 4 + 3]) { for (var dy = -2; dy <= 2 && !own; dy++) for (var dx = -2; dx <= 2 && !own; dx++) { var tx = sx + dx, ty = sy + dy; if (tx >= 0 && ty >= 0 && tx < w && ty < h && lab[ty * w + tx] === c.n) own = !lab[si]; } }
        if (!own) continue;
        var o = (y * cw + x) * 4; id.data[o] = a[si * 4]; id.data[o + 1] = a[si * 4 + 1]; id.data[o + 2] = a[si * 4 + 2]; id.data[o + 3] = a[si * 4 + 3];
        if (lab[si] === c.n) mask[y * cw + x] = 1;
      }
      g.putImageData(id, 0, 0);
      return { c: cv, x0: c.x0 - pad, y0: c.y0 - pad, mask: mask, mw: cw, mh: ch };
    });
  }
  // Marching Squares auf der Maske → geschlossene Linienzüge (Pixelkoordinaten, y nach unten)
  function contours(mask, w, h) {
    function v(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0; }
    var next = {}, pts = {};
    function seg(ax, ay, bx, by) { var ka = ax + ',' + ay, kb = bx + ',' + by; next[ka] = kb; pts[ka] = [ax, ay]; pts[kb] = [bx, by]; }
    for (var y = -1; y < h; y++) for (var x = -1; x < w; x++) {
      var tl = v(x, y), tr = v(x + 1, y), br = v(x + 1, y + 1), bl = v(x, y + 1), k = tl * 8 + tr * 4 + br * 2 + bl;
      var T = [x * 2 + 1, y * 2], R = [x * 2 + 2, y * 2 + 1], B = [x * 2 + 1, y * 2 + 2], L = [x * 2, y * 2 + 1];
      // Umlauf: Füllung immer rechts der Laufrichtung (y nach unten)
      var S = { 1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[R, T]], 5: [[L, T], [R, B]], 6: [[B, T]], 7: [[L, T]],
                8: [[T, L]], 9: [[T, B]], 10: [[T, R], [B, L]], 11: [[T, R]], 12: [[R, L]], 13: [[R, B]], 14: [[B, L]] }[k];
      if (S) S.forEach(function (sg) { seg(sg[0][0], sg[0][1], sg[1][0], sg[1][1]); });
    }
    var seen = {}, loops = [];
    Object.keys(next).forEach(function (k0) {
      if (seen[k0]) return; var loop = [], k = k0;
      while (k && !seen[k]) { seen[k] = 1; loop.push([pts[k][0] / 2, pts[k][1] / 2]); k = next[k]; }
      if (loop.length > 8) loops.push(rdp(loop, 0.8));
    });
    return loops;
  }
  function rdp(pts, eps) {   // Douglas-Peucker für geschlossene Züge
    function simp(a, b) {
      var A = pts[a], Bp = pts[b], dx = Bp[0] - A[0], dy = Bp[1] - A[1], L = Math.hypot(dx, dy) || 1, mx = 0, mi = -1;
      for (var i = a + 1; i < b; i++) { var d = Math.abs((pts[i][0] - A[0]) * dy - (pts[i][1] - A[1]) * dx) / L; if (d > mx) { mx = d; mi = i; } }
      return mx > eps ? simp(a, mi).concat(simp(mi, b).slice(1)) : [A, Bp];
    }
    var h = pts.length >> 1; return simp(0, h).concat(simp(h, pts.length - 1).slice(1, -1));
  }
  function area(l) { var s = 0; for (var i = 0; i < l.length; i++) { var p = l[i], q = l[(i + 1) % l.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; }
  function whole(px) {
    var w = px.d.width, h = px.d.height, a = px.d.data, x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (var i = 0; i < w * h; i++) if (a[i * 4 + 3]) { var x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) return [];
    var c = document.createElement('canvas'); c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
    c.getContext('2d').drawImage(px.c, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
    return [{ c: c, x0: x0, y0: y0 }];
  }

  // ── Von Hand ausgeschnittene Teile ──
  // Teil (Original-Pixel) → Canvas-Ausschnitt in Arbeitsauflösung (k = Arbeits-/Originalbreite), auf den Umriss
  // beschnitten (Löcher per evenodd). Liefert {c, x0, y0, loops (lokal), mw, mh} – loops[0] = Außenrand.
  function cutPart(px, part, k) {
    var rings = [part.poly].concat(part.holes || []).map(function (r) { return r.map(function (q) { return [q[0] * k, q[1] * k]; }); });
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rings[0].forEach(function (q) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
    x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2);
    x1 = Math.min(px.c.width, Math.ceil(x1) + 2); y1 = Math.min(px.c.height, Math.ceil(y1) + 2);
    var cw = Math.max(1, x1 - x0), ch = Math.max(1, y1 - y0), c = document.createElement('canvas'); c.width = cw; c.height = ch;
    var g = c.getContext('2d'), loops = rings.map(function (r) { return r.map(function (q) { return [q[0] - x0, q[1] - y0]; }); });
    g.beginPath(); loops.forEach(function (l) { l.forEach(function (q, j) { if (j) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath(); });
    g.save(); g.clip('evenodd'); g.drawImage(px.c, -x0, -y0); g.restore();
    return { c: c, x0: x0, y0: y0, loops: loops, mw: cw, mh: ch };
  }
  // Streifen: wie splitBlobs, aber mit fertigem Umriss (poly in Arbeitspixeln) und Farbe/Deckkraft aus dem Ausschnitt
  function stripesFromCuts(px, parts, k) {
    return parts.map(function (part) {
      var p = cutPart(px, part, k), d = p.c.getContext('2d').getImageData(0, 0, p.mw, p.mh).data, hist = new Array(256).fill(0), hn = 0, rs = 0, gs = 0, bs = 0, cn = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 60) { hist[d[i + 3]]++; hn++; }
        var L = d[i] + d[i + 1] + d[i + 2]; if (d[i + 3] > 60 && L > 60 && L < 660) { rs += d[i]; gs += d[i + 1]; bs += d[i + 2]; cn++; }
      }
      var med = 0, acc = 0; for (var hv = 0; hv < 256; hv++) { acc += hist[hv]; if (acc >= hn / 2) { med = hv; break; } }
      p.poly = p.loops[0].map(function (q) { return [q[0] + p.x0, q[1] + p.y0]; });
      p.col = cn ? [rs / cn / 255, gs / cn / 255, bs / cn / 255] : null; p.alpha = (med || 255) / 255;
      return p;
    }).sort(function (a, b) { return (a.x0 + a.mw / 2) - (b.x0 + b.mw / 2); });
  }
  function lettersFromCuts(face, parts, k) {
    return parts.map(function (part) { return cutPart(face, part, k); })
      .sort(function (a, b) { return (a.x0 + a.mw / 2) - (b.x0 + b.mw / 2); });
  }
  // Automatik → bearbeitbare Umrisse in Original-Pixeln (kind 0 = Streifen, 1 = Buchstaben)
  function toCuts(list, k, kind) {
    var r = function (q) { return [Math.round(q[0] / k * 100) / 100, Math.round(q[1] / k * 100) / 100]; };
    return (list || []).map(function (p) {
      if (kind === 0) {
        var poly = p.poly || [[p.x0, p.y0], [p.x0 + p.c.width, p.y0], [p.x0 + p.c.width, p.y0 + p.c.height], [p.x0, p.y0 + p.c.height]];
        return { poly: poly.map(r), holes: [] };
      }
      var loops = p.mask ? contours(p.mask, p.mw, p.mh) : [];
      if (!loops.length) return { poly: [[p.x0, p.y0], [p.x0 + p.c.width, p.y0], [p.x0 + p.c.width, p.y0 + p.c.height], [p.x0, p.y0 + p.c.height]].map(r), holes: [] };
      loops.sort(function (a, b) { return Math.abs(area(b)) - Math.abs(area(a)); });
      var so = Math.sign(area(loops[0])), off = function (l) { return l.map(function (q) { return r([q[0] + p.x0, q[1] + p.y0]); }); };
      return { poly: off(loops[0]), holes: loops.slice(1).filter(function (l) { return Math.sign(area(l)) !== so && Math.abs(area(l)) > 4; }).slice(0, 8).map(off) };
    });
  }

  window.LogoSplit = { pixels: pixels, splitBlobs: splitBlobs, splitColumns: splitColumns, separateShadow: separateShadow,
    splitLetters: splitLetters, contours: contours, rdp: rdp, area: area, whole: whole,
    stripesFromCuts: stripesFromCuts, lettersFromCuts: lettersFromCuts, toCuts: toCuts };
})();
