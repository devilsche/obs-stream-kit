/* Car Race: Race stats je Auto – Schätzwerte nach Fahrzeugklasse plus im Car editor gespeicherte Werte.
 * Läuft im Browser (window.CarRaceStats) und in Node (module.exports). Prüfskript: scripts/check_car_race_sim.js
 *
 *   CarRaceStats.guess(entry) → { on, power, speed, handling, susp, brakes, weight, drive, len }
 *       entry = Katalog-Eintrag { key, name, brand, len }. Werte sind Verhältnis-Werte 1–10 (keine echten
 *       Einheiten); Klasse über Namens-Regex, len aus dem Katalog (Rückfall 4,5 m).
 *   CarRaceStats.of(key[, entry]) → race-Objekt: guess() überlagert mit ToyCars.vehicle(key).race
 *       (nur gültige Felder). Ohne entry wird der Katalog von ToyCars durchsucht.
 *   CarRaceStats.KEYS, CarRaceStats.clean(race) → nur gültige Felder
 */
(function (root) {
  'use strict';
  var KEYS = ['power', 'speed', 'handling', 'susp', 'brakes', 'weight'];

  // Reihenfolge zählt: erste passende Klasse gewinnt (Spaß-Autos und Busse vor den Sportwagen)
  var CLASSES = [
    { id: 'fun', re: /krabby|hoonicorn|crasher/i,
      v: { power: 10, speed: 7, handling: 6, susp: 6, brakes: 5, weight: 5 }, drive: 'awd' },
    { id: 'bus', re: /\bbus\b|trolza|megapolis|\bpaz\b|\bliaz\b/i,
      v: { power: 2, speed: 2, handling: 2, susp: 4, brakes: 3, weight: 10 }, drive: 'rwd' },
    { id: 'truck', re: /truck|\bural\b|caterpillar|kamaz|\bman\b|scania|\bzil\b|\bmaz\b/i,
      v: { power: 4, speed: 3, handling: 3, susp: 7, brakes: 3, weight: 9 }, drive: 'awd' },
    { id: 'suv', re: /\bg\s?-?63\b|\bg-?klasse\b|\bg-?class\b/i,
      v: { power: 7, speed: 6, handling: 3, susp: 7, brakes: 5, weight: 8 }, drive: 'awd' },
    { id: 'hyper', re: /\b91[78]k?\b|\bw14\b|\bformula\b|\bf1\b/i,
      v: { power: 10, speed: 10, handling: 9, susp: 5, brakes: 9, weight: 2 }, drive: 'awd' },
    { id: 'super', re: /supercar|lamborghini|ferrari|koenigsegg|bugatti|mclaren|gt3|aventador|huracan|pagani/i,
      v: { power: 10, speed: 10, handling: 8, susp: 5, brakes: 8, weight: 3 }, drive: 'awd' },
    { id: 'sport', re: /\bsport\b|\bm[2-8]\b|\brs\d*\b|\bamg\b|porsche|mustang|shelby|corvette|\bevo\b|\bgt-?r\b|\bsupra\b/i,
      v: { power: 8, speed: 8, handling: 7, susp: 5, brakes: 7, weight: 4 }, drive: 'rwd' },
    { id: 'small', re: /\bgolf\b|\bpolo\b|\bmini\b|\bfiat\b|\b2cv\b|\bsmart\b|\b(vw|volkswagen) up!?(?!\w)/i,
      v: { power: 4, speed: 4, handling: 6, susp: 5, brakes: 5, weight: 3 }, drive: 'fwd' },
    { id: 'sedan', re: /sedan|estate|limousine|kombi/i,
      v: { power: 5, speed: 5, handling: 5, susp: 5, brakes: 5, weight: 5 }, drive: 'rwd' }
  ];
  var DEFAULT = CLASSES[CLASSES.length - 1];

  function klass(entry) {
    var s = ((entry && entry.name) || '') + ' ' + ((entry && entry.brand) || '') + ' ' + ((entry && entry.key) || '');
    for (var i = 0; i < CLASSES.length; i++) if (CLASSES[i].re.test(s)) return CLASSES[i];
    return DEFAULT;
  }

  function guess(entry) {
    var c = klass(entry), len = entry && +entry.len;
    var r = { on: true };
    KEYS.forEach(function (k) { r[k] = c.v[k]; });
    r.drive = /ferrari/i.test((entry && (entry.brand || '') + ' ' + (entry.name || '')) || '') ? 'rwd' : c.drive; // Ferrari-Supercars fahren Heckantrieb
    r.len = len >= 2 && len <= 20 ? len : 4.5;
    return r;
  }

  function clean(race) {
    var o = {};
    if (!race || typeof race !== 'object') return o;
    if (typeof race.on === 'boolean') o.on = race.on;
    KEYS.forEach(function (k) { var n = +race[k]; if (race[k] != null && n >= 1 && n <= 10) o[k] = n; });
    if (race.drive === 'fwd' || race.drive === 'rwd' || race.drive === 'awd') o.drive = race.drive;
    var l = +race.len; if (race.len != null && l >= 2 && l <= 20) o.len = l;
    return o;
  }

  function of(key, entry) {
    var TC = root.ToyCars;
    if (!entry && TC && TC.catalog) entry = TC.catalog().filter(function (e) { return e.key === key; })[0];
    var saved = TC && TC.vehicle ? TC.vehicle(key).race : null;
    var r = guess(entry || { key: key }), c = clean(saved);
    Object.keys(c).forEach(function (k) { r[k] = c[k]; });
    return r;
  }

  var api = { guess: guess, of: of, clean: clean, KEYS: KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CarRaceStats = api;
})(typeof window !== 'undefined' ? window : this);
