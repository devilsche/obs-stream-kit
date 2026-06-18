// widgets/_params.js — gemeinsamer Parameter-Helfer (Widget + Detailseite).
(function (global) {
  function readParams(id) {
    if (typeof document === 'undefined') return [];
    var el = document.getElementById(id || 'params');
    if (!el) return [];
    try { var d = JSON.parse(el.textContent); return Array.isArray(d) ? d : []; }
    catch (_) { return []; }
  }
  function values(schema, search) {
    var q = new URLSearchParams(search != null ? search :
      (typeof location !== 'undefined' ? location.search : ''));
    var out = {};
    (schema || []).forEach(function (p) {
      var v = q.get(p.key);
      out[p.key] = (v === null || v === '') ? p.default : v;
    });
    return out;
  }
  function buildUrl(base, schema, vals) {
    var q = new URLSearchParams();
    (schema || []).forEach(function (p) {
      var v = vals[p.key];
      if (v !== undefined && v !== null && String(v) !== '' && String(v) !== String(p.default))
        q.set(p.key, v);
    });
    var s = q.toString();
    return s ? base + '?' + s : base;
  }
  global.Params = { readParams: readParams, values: values, buildUrl: buildUrl };
})(typeof window !== 'undefined' ? window : globalThis);
