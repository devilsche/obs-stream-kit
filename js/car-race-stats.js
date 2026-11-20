/* Car Race: Race stats je Auto – echte Fahrzeugwerte (Schätzung je Katalog-Schlüssel bzw. Fahrzeugklasse)
 * plus im Car editor gespeicherte Abweichungen.
 * Läuft im Browser (window.CarRaceStats) und in Node (module.exports). Prüfskript: scripts/check_car_race_sim.js
 *
 *   CarRaceStats.guess(entry) → { on, vmax, acc, hp, kg, grip, brake, drive, len }
 *       entry = Katalog-Eintrag { key, name, brand, len }. Echte Werte: vmax km/h, acc = 0–100 km/h in s,
 *       hp = PS, kg = Leergewicht, grip = Kurvenhaftung in g, brake = Bremsverzögerung in g.
 *       Zuerst die Tabelle je Katalog-Schlüssel (vom Nutzer abgesegnet), sonst die Fahrzeugklasse über
 *       Namens-Regex; len aus dem Katalog (Rückfall 4,5 m).
 *   CarRaceStats.of(key[, entry]) → race-Objekt: guess() überlagert mit ToyCars.vehicle(key).race
 *       (nur gültige Felder; alte 1–10-Felder power/speed/handling/susp/brakes/weight werden verworfen).
 *       Ohne entry wird der Katalog von ToyCars durchsucht.
 *   CarRaceStats.KEYS, CarRaceStats.RANGE (gültige Bereiche je Feld), CarRaceStats.TABLE (Schlüssel → Werte),
 *   CarRaceStats.clean(race) → nur gültige Felder
 */
(function (root) {
  'use strict';
  var KEYS = ['vmax', 'acc', 'hp', 'kg', 'grip', 'brake'];
  var RANGE = {
    vmax: [30, 420], acc: [1.5, 60], hp: [20, 2000], kg: [300, 40000], grip: [0.2, 5.0], brake: [0.3, 6.0], len: [0.5, 20]
  };

  // Tabelle je Katalog-Schlüssel: vmax, acc, hp, kg, grip, brake, drive (vom Nutzer abgesegnet, Bremsen vom Controller)
  var ROWS = {
    'amg-w14-s1': '350,2.6,1000,798,4.0,5.0,rwd',
    '2025-koenigsegg-gemera': '400,1.9,1700,1850,1.10,1.25,awd',
    'porsche-917k-lm-red': '360,2.3,630,800,1.50,1.6,rwd',
    'ferrari-laferrari': '350,2.4,963,1585,1.15,1.35,rwd',
    '2022-lamborghini-countach-lp': '355,2.8,814,1595,1.10,1.3,awd',
    'porsche-918-free': '345,2.6,887,1675,1.10,1.35,awd',
    '2021-ferrari-sf90-spider': '340,2.5,1000,1670,1.10,1.35,awd',
    'ferrari-488-pista-widebody': '340,2.85,720,1385,1.15,1.35,rwd',
    '2026-ferrari-849-testarossa': '330,2.3,1050,1570,1.15,1.35,awd',
    '2023-ferrari-sf90-xx-stradal': '320,2.3,1030,1560,1.20,1.4,awd',
    '2021-porsche-911-turbo-s-992': '330,2.7,650,1640,1.10,1.35,awd',
    'porsche-911-turbo-s': '330,2.9,580,1600,1.05,1.3,awd',
    'ferrari-gtc4-lusso': '335,3.4,690,1920,0.98,1.2,awd',
    '1995-lamborghini-diablo-sv': '320,4.0,520,1530,0.95,1.1,rwd',
    '2020-ferrari-roma': '320,3.4,620,1570,1.00,1.25,rwd',
    'porsche-911-gt3-2': '318,3.4,500,1430,1.15,1.35,rwd',
    '2022-porsche-911-gt3-touring': '320,3.9,510,1420,1.15,1.35,rwd',
    '2023-porsche-911-gt3-rs-2-7': '313,3.4,510,1420,1.20,1.4,rwd',
    '2020-abt-sportline-audi-rs6': '320,3.2,740,2150,1.00,1.2,awd',
    '2015-porsche-911-carrera-s': '308,4.3,400,1440,1.00,1.25,rwd',
    '2020-audi-rs-6-avant': '305,3.6,600,2075,0.98,1.2,awd',
    '2024-audi-rs6-avant-gt': '305,3.3,630,2000,1.05,1.25,awd',
    'porsche-911-turbo-996-2000-b': '305,4.2,420,1540,0.95,1.15,awd',
    '2019-ferrari-monza-sp2': '300,2.9,810,1520,1.05,1.3,rwd',
    'ferrari-550-barchetta-2000-a': '300,4.4,485,1690,0.92,1.1,rwd',
    '2017-porsche-gt-rsr-991-duke': '300,3.5,515,1250,1.40,1.5,rwd',
    'ferrari-296-gt3': '290,3.0,600,1250,1.60,1.7,rwd',
    'ferrari-296-gt3-verstappen': '290,3.0,600,1250,1.60,1.7,rwd',
    '2024-porsche-992-gt3-r': '290,3.0,565,1260,1.70,1.75,rwd',
    'ford-mustang-shelby-gt500': '290,3.5,770,1900,1.05,1.25,rwd',
    '1962-chevrolet-corvette-gran': '290,4.0,550,900,0.90,1.0,rwd',
    'bmw-m3-competition': '290,3.9,510,1730,1.00,1.25,rwd',
    '1992-porsche-911-964-turbo-s': '290,4.7,385,1290,0.95,1.1,rwd',
    '1988-ferrari-testarossa': '290,5.8,390,1500,0.86,1.0,rwd',
    'audi-a4-r9-dtm-a': '280,3.2,460,1050,1.90,2.0,rwd',
    '2020-audi-rs5-coup': '280,3.9,450,1750,1.00,1.2,awd',
    'mercedes-benz-a45-amg-2018': '270,4.2,381,1555,0.98,1.15,awd',
    'porsche-911-rauh-welt-free': '270,4.8,350,1250,1.00,1.15,rwd',
    '1982-porsche-930-911-turbo-3': '260,5.4,300,1300,0.87,1.0,rwd',
    'free-1975-porsche-911-930-tu': '250,6.0,260,1140,0.87,1.0,rwd',
    '2010-bmw-m3-e92': '250,4.8,420,1655,0.95,1.15,rwd',
    'mitsubishi-lancer-evo-ix': '250,4.9,280,1400,1.00,1.15,awd',
    '1990-mercedes-benz-190e-2-5': '250,7.1,235,1340,0.90,1.05,rwd',
    'mercedes-benz-500te-w126-est': '250,6.5,320,1800,0.82,1.0,rwd',
    'vw-golf-gti-mk7': '250,6.4,230,1350,0.95,1.1,fwd',
    '2002-volkswagen-golf-r32-mk4': '247,6.6,241,1480,0.90,1.05,awd',
    '1988-bmw-m5-e28': '245,6.5,286,1430,0.82,0.95,rwd',
    'audi-a4-b8': '245,6.9,211,1500,0.88,1.05,fwd',
    'audi-a4-l40-tfsi': '240,7.5,190,1600,0.85,1.0,fwd',
    'bmw-e39-free': '236,7.5,193,1500,0.83,1.0,rwd',
    'free-bmw-m3-e30': '235,6.9,200,1200,0.88,1.0,rwd',
    'mercedes-190e-evo-1982-3d-mo': '230,7.5,185,1200,0.85,1.0,rwd',
    'mersedes-benz-g63-amg': '220,4.5,585,2560,0.75,0.95,awd',
    'audi-a4-b5-5-avant': '220,9.0,150,1400,0.80,0.95,fwd',
    '2000-volkswagen-passat-varia': '215,9.4,150,1400,0.80,0.95,fwd',
    '1973-bmw-2002-turbo': '211,7.0,170,1080,0.75,0.85,rwd',
    '1992-volkswagen-golf-gti': '208,7.9,139,960,0.82,0.95,fwd',
    '67-mustang-high-poly': '200,6.5,335,1500,0.75,0.85,rwd',
    'ford-mustang-1965': '180,8.5,225,1300,0.72,0.8,rwd',
    '1999-volkswagen-gol-2000-gti': '190,9.5,120,980,0.78,0.9,fwd',
    '1998-volkswagen-new-beetle': '185,10.9,115,1250,0.78,0.9,fwd',
    '1984-mercedes-190e': '190,11.0,122,1100,0.75,0.85,rwd',
    'volkswagen-golf-gti-1976': '182,9.0,110,810,0.80,0.9,fwd',
    'classic-crasher-c170-dominat': '180,6.0,400,1800,0.70,0.8,rwd',
    'caterpillar-ct680': '120,25,500,9000,0.45,0.6,rwd',
    'krabby-patty-wagon': '90,15,50,400,0.70,0.7,rwd',
    'ural-4320-soviet-army-truck': '85,35,230,8000,0.40,0.55,awd',
    'trolza-5265-00-megapolis': '60,30,245,12000,0.35,0.5,rwd'
  };
  function row(s) {
    var a = s.split(',');
    return { vmax: +a[0], acc: +a[1], hp: +a[2], kg: +a[3], grip: +a[4], brake: +a[5], drive: a[6] };
  }
  var TABLE = {};
  Object.keys(ROWS).forEach(function (k) { TABLE[k] = row(ROWS[k]); });

  // Klassen-Rückfall für Autos ohne Tabellenzeile. Reihenfolge zählt: erste passende Klasse gewinnt
  // (Spaß-Autos und Busse vor den Sportwagen)
  var CLASSES = [
    { id: 'fun', re: /krabby|hoonicorn|crasher/i, v: row('260,2.8,900,1400,1.05,1.15,awd') },
    { id: 'bus', re: /\bbus\b|trolza|megapolis|\bpaz\b|\bliaz\b/i, v: row('70,30,250,12000,0.35,0.5,rwd') },
    { id: 'truck', re: /truck|\bural\b|caterpillar|kamaz|\bman\b|scania|\bzil\b|\bmaz\b/i, v: row('100,28,400,9000,0.42,0.58,awd') },
    { id: 'suv', re: /\bg\s?-?63\b|\bg-?klasse\b|\bg-?class\b/i, v: row('220,5.0,500,2500,0.75,0.95,awd') },
    { id: 'hyper', re: /\b91[78]k?\b|\bw14\b|\bformula\b|\bf1\b/i, v: row('350,2.5,900,1500,1.25,1.4,awd') },
    { id: 'super', re: /supercar|lamborghini|ferrari|koenigsegg|bugatti|mclaren|gt3|aventador|huracan|pagani/i,
      v: row('330,2.9,700,1550,1.10,1.3,awd') },
    { id: 'sport', re: /\bsport\b|\bm[2-8]\b|\brs\d*\b|\bamg\b|porsche|mustang|shelby|corvette|\bevo\b|\bgt-?r\b|\bsupra\b/i,
      v: row('285,4.2,480,1550,0.98,1.2,rwd') },
    { id: 'small', re: /\bgolf\b|\bpolo\b|\bmini\b|\bfiat\b|\b2cv\b|\bsmart\b|\b(vw|volkswagen) up!?(?!\w)/i,
      v: row('195,9.0,125,1050,0.80,0.92,fwd') },
    { id: 'sedan', re: /sedan|estate|limousine|kombi/i, v: row('220,8.5,180,1500,0.82,1.0,rwd') }
  ];
  var DEFAULT = CLASSES[CLASSES.length - 1];

  function klass(entry) {
    var s = ((entry && entry.name) || '') + ' ' + ((entry && entry.brand) || '') + ' ' + ((entry && entry.key) || '');
    for (var i = 0; i < CLASSES.length; i++) if (CLASSES[i].re.test(s)) return CLASSES[i];
    return DEFAULT;
  }

  function inRange(k, n) { return isFinite(n) && n >= RANGE[k][0] && n <= RANGE[k][1]; }

  function guess(entry) {
    var t = entry && entry.key && TABLE.hasOwnProperty(entry.key) ? TABLE[entry.key] : null;
    var c = klass(entry), v = t || c.v, len = entry && +entry.len;
    var r = { on: true };
    KEYS.forEach(function (k) { r[k] = v[k]; });
    // Ferrari-Supercars ohne Tabellenzeile fahren Heckantrieb
    r.drive = t ? t.drive : /ferrari/i.test((entry && (entry.brand || '') + ' ' + (entry.name || '')) || '') ? 'rwd' : v.drive;
    r.len = inRange('len', len) ? len : 4.5;
    return r;
  }

  // nur gültige Felder der neuen Form; alte 1–10-Felder (power, speed, handling, susp, brakes, weight) fallen weg
  function clean(race) {
    var o = {};
    if (!race || typeof race !== 'object') return o;
    if (typeof race.on === 'boolean') o.on = race.on;
    KEYS.concat(['len']).forEach(function (k) { var n = +race[k]; if (race[k] != null && race[k] !== '' && inRange(k, n)) o[k] = n; });
    if (race.drive === 'fwd' || race.drive === 'rwd' || race.drive === 'awd') o.drive = race.drive;
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

  var api = { guess: guess, of: of, clean: clean, KEYS: KEYS, RANGE: RANGE, TABLE: TABLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CarRaceStats = api;
})(typeof window !== 'undefined' ? window : this);
