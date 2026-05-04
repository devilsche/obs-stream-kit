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

  PubgUI.fmtMap = (raw) => {
    if (!raw) return "—";
    return raw.replace(/_Main$/, "").replace(/_/g, " ");
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

  global.PubgUI = PubgUI;
})(window);
