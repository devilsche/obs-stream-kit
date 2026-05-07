(function (global) {
  const PubgUI = {};

  PubgUI.fmtNum = (n) => {
    if (n == null) return "—";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  };

  PubgUI.fmtPct = (n) => (n == null ? "—" : n.toFixed(1) + "%");

  PubgUI.fmtKD = (n) => (n == null ? "—" : n.toFixed(2));

  PubgUI.fmtPlace = (n) => (n == null ? "—" : "#" + n);

  // Hot-Markierung: 🔥-Flamme + Glow-Effekt (.pubg-fire / .pubg-hot in
  // _pubg.css). Nutzung: hotIf(value, threshold, formattedString).
  // Returns HTML — Caller muss innerHTML setzen, nicht textContent.
  PubgUI.hotWrap = (formatted) =>
    `<span class="pubg-fire">🔥</span><span class="pubg-hot">${formatted}</span>`;
  PubgUI.hotIf = (value, threshold, formatted) =>
    (value || 0) > threshold ? PubgUI.hotWrap(formatted) : formatted;

  // Offizielle PUBG-Map-Namen — die API liefert interne Codenamen.
  const MAP_NAMES = {
    "Baltic_Main":      "Erangel",
    "Erangel_Main":     "Erangel",
    "Desert_Main":      "Miramar",
    "Savage_Main":      "Sanhok",
    "DihorOtok_Main":   "Vikendi",
    "Range_Main":       "Camp Jackal",
    "Chimera_Main":     "Paramo",
    "Summerland_Main":  "Karakin",
    "Heaven_Main":      "Haven",
    "Tiger_Main":       "Taego",
    "Kiki_Main":        "Deston",
    "Neon_Main":        "Rondo",
  };

  PubgUI.fmtMap = (raw) => {
    if (!raw) return "—";
    return MAP_NAMES[raw] || raw.replace(/_Main$/, "").replace(/_/g, " ");
  };

  PubgUI.fmtMode = (raw) => {
    if (!raw) return "—";
    return raw.toUpperCase().replace("-", " ");
  };

  PubgUI.fmtKm = (km) => (km == null ? "—" : km.toFixed(2) + "km");

  // ── Zeit-Formatter — Browser-Lokalzeit (CEST/CET je nach Sommerzeit) ───────
  PubgUI.fmtDate = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });
  };
  PubgUI.fmtTime = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  };
  PubgUI.fmtDateTime = (iso) => {
    if (!iso) return "—";
    return PubgUI.fmtDate(iso) + " " + PubgUI.fmtTime(iso);
  };
  // Match-Start = matchEnd - durationSec.  PUBG-API played_at ist Match-Ende.
  PubgUI.matchStartIso = (matchEndIso, durationSec) => {
    if (!matchEndIso) return null;
    const end = new Date(matchEndIso).getTime();
    return new Date(end - (durationSec || 0) * 1000).toISOString();
  };

  PubgUI.fmtRelative = (iso) => {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return "gerade eben";
    if (diff < 3600) return Math.floor(diff/60) + " Min";
    if (diff < 86400) return Math.floor(diff/3600) + "h";
    return Math.floor(diff/86400) + " Tagen";
  };

  PubgUI.fetchJson = async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  };

  // Range-Label-Map (englisch durchgängig, laut Overlay-Rules-Spec).
  // "all" wird dynamisch zu "Database (since DD.MM.)" ergänzt — siehe
  // PubgUI.fmtRangeLabel.
  PubgUI._RANGE_LABELS = {
    session: "Session",
    week:    "7 days",
    all:     "Database",
    career:  "Career",
  };

  let _dbInfoPromise = null;
  PubgUI.getDbInfo = () => {
    if (!_dbInfoPromise) {
      _dbInfoPromise = PubgUI.fetchJson("/api/pubg/db-info").catch(() => ({}));
    }
    return _dbInfoPromise;
  };

  // Liefert ein Promise<string>. Für range="all" wird "(since DD.MM.)"
  // angehängt, basierend auf firstMatchAt aus /api/pubg/db-info.
  PubgUI.fmtRangeLabel = async (range) => {
    const base = PubgUI._RANGE_LABELS[range] || range;
    if (range !== "all") return base;
    const info = await PubgUI.getDbInfo();
    if (!info || !info.firstMatchAt) return base;
    const d = new Date(info.firstMatchAt);
    const since = String(d.getDate()).padStart(2, "0") + "."
                + String(d.getMonth() + 1).padStart(2, "0") + ".";
    return `${base} (since ${since})`;
  };

  // Header-Element rendern: <Title> · <Range>. Deaktivierbar via ?header=0.
  // Erwartet ein Element mit data-pubg-header="<Title>" oder explizit übergeben.
  // Range wird async aufgelöst (für Database-since).
  PubgUI.renderHeader = async (el, title, range) => {
    if (PubgUI.qs("header") === "0") {
      if (el) el.style.display = "none";
      return;
    }
    if (!el) return;
    const rangeLabel = await PubgUI.fmtRangeLabel(range);
    el.textContent = `${title} · ${rangeLabel}`;
    el.style.display = "";
  };

  // Vertikaler Auto-Scroll für Slot-Widgets, deren Inhalt die Slot-Höhe
  // überschreitet. Cycle: bottom → top → bottom mit Pause an den Enden.
  // root muss overflow:hidden haben und max-height begrenzt sein.
  // Liefert eine stop()-Function zurück.
  // opts: { speed: px/sec (default 25), pause: ms an den Enden (default 2500) }
  PubgUI.autoscroll = (root, opts) => {
    if (!root) return () => {};
    const speed = (opts && opts.speed) || 25;
    const pauseMs = (opts && opts.pause) || 2500;
    let direction = -1; // -1 = nach oben (zeigt ältere), 1 = nach unten
    let pauseRemaining = pauseMs;
    let lastTs = 0;
    let stopped = false;
    let rafId = null;

    function step(ts) {
      if (stopped) return;
      if (!lastTs) lastTs = ts;
      const dt = ts - lastTs;
      lastTs = ts;
      const overflow = root.scrollHeight - root.clientHeight;
      if (overflow <= 1) {
        root.scrollTop = 0;
        rafId = requestAnimationFrame(step);
        return;
      }
      if (pauseRemaining > 0) {
        pauseRemaining -= dt;
        rafId = requestAnimationFrame(step);
        return;
      }
      let pos = root.scrollTop + direction * (speed * dt) / 1000;
      if (pos <= 0) { pos = 0; direction = 1; pauseRemaining = pauseMs; }
      if (pos >= overflow) { pos = overflow; direction = -1; pauseRemaining = pauseMs; }
      root.scrollTop = pos;
      rafId = requestAnimationFrame(step);
    }

    // Start am Boden (neueste Inhalte) — passt zum bottom-Anker der Slot-Widgets
    requestAnimationFrame(() => {
      root.scrollTop = root.scrollHeight - root.clientHeight;
      rafId = requestAnimationFrame(step);
    });

    return () => { stopped = true; if (rafId) cancelAnimationFrame(rafId); };
  };

  // Body ausblenden wenn letzter Match älter als maxAgeMs (Default 1h).
  // Für Live-Widgets (live-bar, news-ticker) — sollen nur on-screen sein
  // wenn aktuell gespielt wird. Bei Fehler oder leerer DB: ausblenden.
  PubgUI.hideIfStale = async (maxAgeMs) => {
    const limit = maxAgeMs == null ? 3600 * 1000 : maxAgeMs;
    let stale = true;
    try {
      const lm = await PubgUI.fetchJson("/api/pubg/last-match");
      const ts = lm && lm.playedAt ? new Date(lm.playedAt).getTime() : 0;
      stale = !ts || (Date.now() - ts > limit);
    } catch (_) {
      stale = true;
    }
    if (document.body) document.body.style.display = stale ? "none" : "";
    return stale;
  };

  PubgUI.poll = (url, interval, onData, onError) => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        onData(await PubgUI.fetchJson(url));
      } catch (e) {
        if (onError) onError(e);
      }
      if (!stopped) setTimeout(tick, interval);
    };
    tick();
    return () => { stopped = true; };
  };

  PubgUI.qs = (key, fallback) => {
    const u = new URL(location.href);
    return u.searchParams.get(key) ?? fallback;
  };

  // Globaler Scale-Faktor via ?scale=0.8 — skaliert das ganze Widget.
  // CSS-zoom funktioniert in OBS Browser-Sources (Chromium-basiert).
  PubgUI._applyScale = () => {
    const s = parseFloat(PubgUI.qs("scale", ""));
    if (!isNaN(s) && s > 0 && s !== 1) {
      const apply = () => { document.body.style.zoom = String(s); };
      if (document.body) apply();
      else document.addEventListener("DOMContentLoaded", apply);
    }
  };
  PubgUI._applyScale();

  PubgUI.animateNumber = function (el, targetValue, opts) {
    const o = opts || {};
    const duration = o.durationMs || 900;
    const formatter = o.format || ((n) => String(Math.round(n)));
    const startText = (el.textContent || "").replace(/[^\d.\-]/g, "");
    const start = parseFloat(startText) || 0;
    if (start === targetValue) {
      el.textContent = formatter(targetValue);
      return;
    }
    const startTs = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - startTs) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      const value = start + (targetValue - start) * eased;
      el.textContent = formatter(value);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };

  // ── Filter-Bar ─────────────────────────────────────────────────────────────
  // Setzt URL-Parameter live + reloaded das Widget. Versteckt sich bei
  // ?filter=0. Specs: [{key, label, type:"select"|"range"|"text", options?,
  // min?, max?, default?}]. Nach Reload greifen die neuen URL-Params automatisch.

  PubgUI.setUrlParam = (key, value) => {
    const u = new URL(location.href);
    if (value == null || value === "") u.searchParams.delete(key);
    else u.searchParams.set(key, String(value));
    history.replaceState(null, "", u.toString());
  };

  PubgUI._injectFilterCss = () => {
    if (document.getElementById("pubg-filter-css")) return;
    const css = document.createElement("style");
    css.id = "pubg-filter-css";
    css.textContent = `
      .pubg-filter-bar {
        position: fixed;
        top: 0; left: 0; right: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        padding: 6px 12px;
        background: rgba(20, 12, 30, 0.92);
        border-bottom: 1px solid var(--pubg-border, rgba(94,42,121,0.6));
        font-size: 0.78em;
        z-index: 9999;
        backdrop-filter: blur(6px);
      }
      .pubg-filter-bar .grp { display: flex; align-items: center; gap: 6px; }
      .pubg-filter-bar label {
        color: var(--pubg-muted, #8a7d99);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 0.85em;
      }
      .pubg-filter-bar input[type=range] { width: 100px; }
      .pubg-filter-bar select, .pubg-filter-bar input[type=text],
      .pubg-filter-bar input[type=number] {
        background: rgba(0,0,0,0.4);
        color: var(--pubg-text, #e8e0f0);
        border: 1px solid var(--pubg-border, rgba(94,42,121,0.6));
        padding: 2px 6px;
        border-radius: 3px;
        font-family: inherit;
        font-size: inherit;
      }
      .pubg-filter-bar .val {
        color: var(--pubg-gold, #f2b705);
        font-weight: 700;
        min-width: 24px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .pubg-filter-bar .hint {
        margin-left: auto;
        color: var(--pubg-muted, #8a7d99);
        opacity: 0.6;
        font-size: 0.85em;
      }
      /* padding-top wird via JS exakt auf Filter-Bar-Höhe gesetzt
         (wrappt manchmal bei vielen Specs auf zwei Zeilen) */
      body.pubg-has-filter { padding-top: 44px !important; }
    `;
    document.head.appendChild(css);
  };

  PubgUI.buildFilter = (specs) => {
    if (PubgUI.qs("filter") === "0") return;
    PubgUI._injectFilterCss();
    document.body.classList.add("pubg-has-filter");

    const bar = document.createElement("div");
    bar.className = "pubg-filter-bar";

    specs.forEach((spec) => {
      const grp = document.createElement("div");
      grp.className = "grp";

      const label = document.createElement("label");
      label.textContent = spec.label;
      grp.appendChild(label);

      let input;
      const current = PubgUI.qs(spec.key, spec.default);

      if (spec.type === "select") {
        input = document.createElement("select");
        spec.options.forEach(([val, lbl]) => {
          const opt = document.createElement("option");
          opt.value = val;
          opt.textContent = lbl;
          if (String(val) === String(current)) opt.selected = true;
          input.appendChild(opt);
        });
      } else if (spec.type === "range") {
        input = document.createElement("input");
        input.type = "range";
        input.min = spec.min ?? 1;
        input.max = spec.max ?? 50;
        input.value = current ?? spec.default ?? spec.min ?? 1;
        const valSpan = document.createElement("span");
        valSpan.className = "val";
        valSpan.textContent = input.value;
        input.addEventListener("input", () => valSpan.textContent = input.value);
        grp.appendChild(input);
        grp.appendChild(valSpan);
      } else {
        input = document.createElement("input");
        input.type = spec.type || "text";
        if (current != null) input.value = current;
        if (spec.placeholder) input.placeholder = spec.placeholder;
      }

      if (spec.type !== "range") grp.appendChild(input);

      input.addEventListener("change", (e) => {
        const v = e.target.value;
        // Range: immer expliziten Wert setzen — Default-Löschen würde
        // Backend-Setting greifen lassen statt Slider-Wert (Bug-Quelle).
        // Select/Text: bei Default-Wert URL sauber halten.
        const keepInUrl = spec.type === "range"
          || spec.default == null
          || String(v) !== String(spec.default);
        PubgUI.setUrlParam(spec.key, keepInUrl ? v : null);
        location.reload();
      });

      bar.appendChild(grp);
    });

    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "?filter=0 versteckt";
    bar.appendChild(hint);

    document.body.insertBefore(bar, document.body.firstChild);

    // Body-padding-top exakt auf Filter-Bar-Höhe + Puffer setzen.
    // !important damit Widget-CSS (`body { padding: 16px }`) nicht überstimmt.
    const adjustPadding = () => {
      const h = bar.getBoundingClientRect().height;
      document.body.style.setProperty("padding-top",
        (h + 18) + "px", "important");
    };
    requestAnimationFrame(adjustPadding);
    requestAnimationFrame(() => requestAnimationFrame(adjustPadding));
    window.addEventListener("resize", adjustPadding);
    // Fonts laden async → Re-Adjust nach Font-Load
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(adjustPadding);
    }
  };

  global.PubgUI = PubgUI;
})(window);
