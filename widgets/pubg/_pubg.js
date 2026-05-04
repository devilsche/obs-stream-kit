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

  PubgUI.fetchJson = async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
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
        const isDefault = spec.default != null && String(v) === String(spec.default);
        PubgUI.setUrlParam(spec.key, isDefault ? null : v);
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
