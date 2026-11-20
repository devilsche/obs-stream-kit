/* Begrüßung vor dem Start (Car Race Overlay, Car Drive): „WELCOME TO <Strecke>“ und „START YOUR ENGINES“.
 * Nur Klassen/Text am DOM, kein Inline-Stil – Aussehen und Bewegung in widgets/components/car-race-welcome.css.
 *
 *   var w = CarRaceWelcome.attach(el)      el = leeres Element (bekommt Klasse race-welcome und den Inhalt)
 *   w.set(kind, title)                     kind 'welcome' | 'engines' | null (ausblenden); title = Streckenname
 *                                          (nur bei 'welcome'); gleiche Werte → keine Änderung (je Bild aufrufbar)
 *   CarRaceWelcome.text(kind, title)       → { kicker, title } (englischer Text, auch für Ansagen)
 *   CarRaceWelcome.windowsBefore(left)     Car Drive: Phase aus den Sekunden bis zum Start (left):
 *                                          'welcome' für 6,4 ≥ left > 4,5, 'engines' für 4,3 ≥ left > 3,15, sonst null
 */
(function (root) {
  'use strict';
  function text(kind, title) {
    if (kind === 'welcome') return { kicker: 'Welcome to', title: String(title || 'the track') };
    if (kind === 'engines') return { kicker: 'Start your', title: 'Engines' };
    return { kicker: '', title: '' };
  }
  function windowsBefore(left) {
    if (!(left != null && isFinite(left))) return null;
    if (left <= 6.4 && left > 4.5) return 'welcome';
    if (left <= 4.3 && left > 3.15) return 'engines';
    return null;
  }
  function attach(el) {
    if (!el) return { set: function () {} };
    el.classList.add('race-welcome');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    var panel = document.createElement('p'), kick = document.createElement('span'), ttl = document.createElement('span');
    panel.className = 'race-welcome__panel'; kick.className = 'race-welcome__kicker'; ttl.className = 'race-welcome__title';
    panel.appendChild(kick); panel.appendChild(ttl);
    el.textContent = ''; el.appendChild(panel);
    var cur = null, curTitle = null;
    return {
      el: el,
      set: function (kind, title) {
        kind = kind || null;
        var tt = kind === 'welcome' ? String(title || '') : '';
        if (kind === cur && tt === curTitle) return;
        cur = kind; curTitle = tt;
        if (!kind) {
          if (el.classList.contains('is-on')) { el.classList.remove('is-on'); el.classList.add('is-out'); }
          return;
        }
        var t = text(kind, title);
        kick.textContent = t.kicker; ttl.textContent = t.title;
        el.setAttribute('data-kind', kind);
        el.classList.remove('is-on', 'is-out');
        void el.offsetWidth;   // Animation neu starten
        el.classList.add('is-on');
      }
    };
  }
  root.CarRaceWelcome = { attach: attach, text: text, windowsBefore: windowsBefore };
})(typeof window !== 'undefined' ? window : this);
