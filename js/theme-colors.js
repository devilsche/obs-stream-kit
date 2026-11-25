/* Theme-Farben für JS/WebGL-Effekte (Canvas, three.js): liest die --theme-*-Tokens der Seite und meldet Wechsel.
 * Der Server schaltet data-theme live um und feuert „themechange“ (webcore/serving.py THEME_LIVE_JS).
 *
 *   ThemeColors.get('--theme-accent', '#f2b705')   → '#f2b705' (CSS-Farbwert, getrimmt)
 *   ThemeColors.palette()                          → { accent, accent2, primary, text } mit Fallbacks
 *   ThemeColors.onChange(fn)                       → fn(palette) bei jedem Theme-Wechsel
 *
 * Seite muss ../widgets/_theme.css laden, sonst gelten die Fallbacks (Entry: Gold/Lila). */
(function (root) {
  'use strict';
  var cache = null, subs = [];
  function get(name, fallback) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; }
    catch (e) { return fallback; }
  }
  function palette() {
    if (!cache) {
      var accent = get('--theme-accent', '#f2b705');
      cache = { accent: accent, accent2: get('--theme-accent-2', accent), primary: get('--theme-primary', '#5e2a79'), text: get('--theme-text', '#e8e0f0') };
    }
    return cache;
  }
  root.addEventListener('themechange', function () {
    cache = null;
    var p = palette();
    subs.forEach(function (fn) { try { fn(p); } catch (e) { console.error('[theme-colors]', e); } });
  });
  root.ThemeColors = { get: get, palette: palette, onChange: function (fn) { subs.push(fn); } };
})(window);
