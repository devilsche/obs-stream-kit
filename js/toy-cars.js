/* Spielzeugautos im Stil klassischer BMW-Modelle für den Party-Regen (effects/item-rain.html?kind=car),
 * three.js r128. Maße nach den Vorbildern (L × B × H, Radstand in m), Räder etwas größer wie bei
 * Spielzeugautos. Kein Markenlogo, kein Schriftzug – erkennbar an Form, Front und Lichtern.
 *
 * Aufbau in drei Ebenen (alles im Auto-Editor tools/car-editor.html umbaubar):
 *   Karosserie (BODIES): Seitenprofil-Kennzahlen, Front und Heck des Vorbilds
 *     2002  (1966–77) rundlich, runde Einzelscheinwerfer im schwarzen Grill
 *     e30   (1982–94) kantig, je zwei runde Scheinwerfer, schmale Doppelniere
 *     e30m3            Karosserie des M3 (höheres Heck, kürzere Heckscheibe)
 *     e36   (1990–2000) Keil, Doppelscheinwerfer unter Glas
 *     e46   (1998–2006) rundlicher, breitere Niere
 *     e92m3 (2007–13) größer, breite Niere
 *     Überall: Hofmeister-Knick am hinteren Ende des Seitenfensters.
 *   Felgen (RIMS): eigene 3D-Bauteile – Speichenform, Anzahl, Schüssel, Horn, Oberfläche, Nabe
 *   Fahrzeug (VEHICLES): Karosserie + Felgen/Reifen je Achse + Tuning-Teile (PARTS: Lippe, Splitter,
 *     Canards, Heckflügel, Dachspoiler, Diffusor, Schweller, Verbreiterung, Endrohre, Powerdome)
 *     + Stoßstangen, Leuchtringe, Breitbau, Tieferlegung, Spur, Sturz + typische Lackierungen
 *
 *   ToyCars.build(vehicle, colorHex, livery) → THREE.Group (Mitte im Auto, Länge in x, ~4,4 Einheiten)
 *   ToyCars.MODELS (Fahrzeuge im Zufallsmix), ToyCars.dims(vehicle), ToyCars.pickPaint(vehicle)
 *   ToyCars.applyCustom({rims, vehicles}) – eigene Felgen/Fahrzeuge aus /api/fx/cars/custom.js
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  // Seitenprofil-Kennzahlen je Karosserie (m): L, W, H, wb Radstand, fo Überhang vorn, r Radradius (Spielzeug),
  // nose Höhe Front oben, cowl Höhe am Windschutzscheibenfuß, belt Gürtellinie hinten, deck Kofferraum,
  // ws/rs Länge Windschutz-/Heckscheibe (waagrecht), roofF/roofR Dachkanten (Anteil von L ab hinten),
  // slant Neigung der Front, tumble Einzug der Fahrgastzelle oben, round Kantenradius, plan Ecken von oben
  // lights: round1 | round2 | glass, grill: schwarzer Grill quer, kidney: Nierenbreite
  var BODIES = {
    '2002':  { label: '2002 (1966–77)', L: 4.23, W: 1.59, H: 1.41, wb: 2.50, fo: 0.78, r: 0.33, nose: 0.74, cowl: 0.86, belt: 0.86, deck: 0.84, ws: 0.42, rs: 0.40, roofF: 0.62, roofR: 0.33, slant: 0.02, tumble: 0.16, round: 0.1, plan: 0.2, lights: 'round1', grill: true, tail: 'round' },
    e30:     { label: 'E30 (1982–94)', L: 4.32, W: 1.65, H: 1.38, wb: 2.57, fo: 0.80, r: 0.34, nose: 0.76, cowl: 0.88, belt: 0.90, deck: 0.90, ws: 0.52, rs: 0.40, roofF: 0.6, roofR: 0.31, slant: 0.0, tumble: 0.14, plan: 0.08, lights: 'round2', grill: true, tail: 'wide' },
    e30m3:   { label: 'E30 M3 (1986–91)', L: 4.35, W: 1.68, H: 1.37, wb: 2.56, fo: 0.82, r: 0.35, nose: 0.74, cowl: 0.87, belt: 0.90, deck: 0.92, ws: 0.54, rs: 0.36, roofF: 0.6, roofR: 0.32, slant: 0.0, tumble: 0.14, plan: 0.1, lights: 'round2', grill: true, tail: 'wide' },
    e36:     { label: 'E36 (1990–2000)', L: 4.43, W: 1.71, H: 1.34, wb: 2.70, fo: 0.83, r: 0.35, nose: 0.66, cowl: 0.86, belt: 0.92, deck: 0.92, ws: 0.70, rs: 0.52, roofF: 0.6, roofR: 0.3, slant: 0.1, tumble: 0.17, round: 0.1, plan: 0.18, lights: 'glass', tail: 'modern' },
    e46:     { label: 'E46 (1998–2006)', L: 4.49, W: 1.76, H: 1.37, wb: 2.73, fo: 0.85, r: 0.36, nose: 0.68, cowl: 0.88, belt: 0.94, deck: 0.95, ws: 0.72, rs: 0.55, roofF: 0.6, roofR: 0.3, slant: 0.12, tumble: 0.18, round: 0.13, plan: 0.24, lights: 'glass', big: true, tail: 'modern' },
    e92m3:   { label: 'E92 M3 (2007–13)', L: 4.62, W: 1.80, H: 1.42, wb: 2.76, fo: 0.90, r: 0.38, nose: 0.70, cowl: 0.92, belt: 1.0, deck: 1.0, ws: 0.76, rs: 0.6, roofF: 0.6, roofR: 0.29, slant: 0.14, tumble: 0.2, round: 0.12, plan: 0.2, lights: 'glass', big: true, tail: 'modern' }
  };

  // ── Felgen ──
  // style: spokes (gerade Speichen), double (Doppelspeiche), y (Y-Speiche), mesh (Kreuzspeiche),
  // turbine (gebogene Schaufeln), disc (geschlossene Scheibe mit Löchern), steel (Stahlfelge)
  // n Speichen/Löcher, sw Speichenbreite (Anteil), dish Schüsseltiefe 0–1, lip Felgenhorn (Anteil vom Radius),
  // finish + color Oberfläche, accent Horn/Nabe (same | Oberfläche), cap small | big | nuts | none
  var RIM_STYLES = { spokes: 'Straight spokes', double: 'Double spokes', y: 'Y spokes', mesh: 'Cross spokes (mesh)', turbine: 'Turbine', disc: 'Closed disc', steel: 'Steel wheel' };
  var FINISHES = {
    silver: { label: 'Silver', c: 0xd6d9de, m: 0.85, r: 0.28 },
    chrome: { label: 'Chrome', c: 0xeef0f3, m: 1, r: 0.06 },
    polished: { label: 'Polished', c: 0xf4f5f7, m: 1, r: 0.14 },
    gold: { label: 'Gold', c: 0xc9a33a, m: 1, r: 0.25 },
    bronze: { label: 'Bronze', c: 0x8a6a3a, m: 0.9, r: 0.3 },
    gunmetal: { label: 'Gunmetal', c: 0x4f5359, m: 0.85, r: 0.32 },
    black: { label: 'Gloss black', c: 0x1a1b1e, m: 0.35, r: 0.25 },
    matte: { label: 'Matte black', c: 0x242528, m: 0.2, r: 0.75 },
    white: { label: 'White', c: 0xf2f2ee, m: 0.05, r: 0.3 },
    paint: { label: 'Colour', c: 0xc8151b, m: 0.3, r: 0.3 }
  };
  var RIMS_BUILTIN = {
    steel: { label: 'Steel wheel', style: 'steel', n: 8, sw: 0.35, dish: 0.25, lip: 0.06, finish: 'silver', accent: 'chrome', cap: 'big' },
    cross: { label: 'Cross spokes', style: 'mesh', n: 12, sw: 0.32, dish: 0.45, lip: 0.1, finish: 'silver', accent: 'polished', cap: 'small' },
    star: { label: 'Five-star', style: 'spokes', n: 5, sw: 0.42, dish: 0.35, lip: 0.06, finish: 'silver', accent: 'same', cap: 'small' },
    double: { label: 'Double spokes', style: 'double', n: 5, sw: 0.4, dish: 0.3, lip: 0.05, finish: 'gunmetal', accent: 'same', cap: 'small' },
    ystar: { label: 'Y spokes', style: 'y', n: 5, sw: 0.4, dish: 0.3, lip: 0.05, finish: 'silver', accent: 'same', cap: 'small' },
    'gold-mesh': { label: 'Gold mesh', style: 'mesh', n: 10, sw: 0.32, dish: 0.6, lip: 0.14, finish: 'gold', accent: 'polished', cap: 'nuts' },
    turbine: { label: 'Turbine', style: 'turbine', n: 10, sw: 0.4, dish: 0.15, lip: 0.04, finish: 'silver', accent: 'same', cap: 'small' },
    aero: { label: 'Aero disc', style: 'disc', n: 6, sw: 0.45, dish: 0.1, lip: 0.04, finish: 'white', accent: 'same', cap: 'small' }
  };

  // ── Tuning-Teile ──
  // je Teil: Parameter mit Bereich (Editor baut daraus die Regler), opts = Auswahl statt Regler
  // mat: paint (Lackfarbe), black, carbon, chrome, titanium, color (eigene Farbe in color)
  var PART_MATS = { paint: 'Body colour', black: 'Black', carbon: 'Carbon', chrome: 'Chrome', titanium: 'Titanium', color: 'Own colour' };
  var PARTS = {
    lip: { label: 'Front lip', mat: 'black', params: [
      { k: 'wid', label: 'Width', min: 0.5, max: 1.05, step: 0.01, def: 0.92 },
      { k: 'h', label: 'Height', min: 0.02, max: 0.15, step: 0.005, def: 0.06 },
      { k: 'out', label: 'Sticks out', min: 0, max: 0.3, step: 0.01, def: 0.12 },
      { k: 'y', label: 'Height above road', min: 0.06, max: 0.4, step: 0.01, def: 0.18 }] },
    splitter: { label: 'Splitter', mat: 'carbon', params: [
      { k: 'wid', label: 'Width', min: 0.5, max: 1.1, step: 0.01, def: 0.98 },
      { k: 'out', label: 'Sticks out', min: 0.02, max: 0.45, step: 0.01, def: 0.18 },
      { k: 'y', label: 'Height above road', min: 0.04, max: 0.35, step: 0.01, def: 0.12 }] },
    canards: { label: 'Canards', mat: 'carbon', params: [
      { k: 'size', label: 'Size', min: 0.05, max: 0.3, step: 0.01, def: 0.14 },
      { k: 'angle', label: 'Angle', min: -0.6, max: 0.6, step: 0.02, def: 0.25 },
      { k: 'y', label: 'Height above road', min: 0.15, max: 0.7, step: 0.01, def: 0.32 },
      { k: 'n', label: 'Per side', opts: [1, 2], def: 2 }] },
    wing: { label: 'Rear wing', mat: 'paint', params: [
      { k: 'style', label: 'Style', opts: ['post', 'swan', 'ducktail'], names: ['On posts', 'Swan neck', 'Ducktail'], def: 'post' },
      { k: 'span', label: 'Span', min: 0.4, max: 1.1, step: 0.01, def: 0.93 },
      { k: 'chord', label: 'Depth', min: 0.08, max: 0.5, step: 0.01, def: 0.26 },
      { k: 'height', label: 'Height', min: 0.02, max: 0.6, step: 0.01, def: 0.17 },
      { k: 'x', label: 'Position', min: 0, max: 0.8, step: 0.01, def: 0.16 },
      { k: 'angle', label: 'Angle', min: -0.3, max: 0.6, step: 0.01, def: 0.12 },
      { k: 'plates', label: 'End plates', opts: [0, 1], names: ['No', 'Yes'], def: 0 }] },
    roof: { label: 'Roof spoiler', mat: 'paint', params: [
      { k: 'chord', label: 'Depth', min: 0.06, max: 0.4, step: 0.01, def: 0.16 },
      { k: 'angle', label: 'Angle', min: -0.5, max: 0.5, step: 0.01, def: 0.15 }] },
    diffuser: { label: 'Diffuser', mat: 'carbon', params: [
      { k: 'wid', label: 'Width', min: 0.3, max: 1, step: 0.01, def: 0.7 },
      { k: 'len', label: 'Length', min: 0.2, max: 0.9, step: 0.01, def: 0.5 },
      { k: 'angle', label: 'Angle', min: 0, max: 0.6, step: 0.01, def: 0.22 },
      { k: 'h', label: 'Fin height', min: 0, max: 0.25, step: 0.01, def: 0.1 },
      { k: 'fins', label: 'Fins', min: 0, max: 9, step: 1, def: 5 }] },
    skirts: { label: 'Side skirts', mat: 'paint', params: [
      { k: 'h', label: 'Height', min: 0.03, max: 0.25, step: 0.01, def: 0.08 },
      { k: 'out', label: 'Sticks out', min: 0, max: 0.15, step: 0.005, def: 0.04 }] },
    flares: { label: 'Fender flares', mat: 'paint', params: [
      { k: 'out', label: 'Width', min: 0.01, max: 0.25, step: 0.005, def: 0.09 },
      { k: 'thick', label: 'Thickness', min: 0.03, max: 0.16, step: 0.005, def: 0.07 },
      { k: 'axle', label: 'Axles', opts: ['both', 'front', 'rear'], names: ['Both', 'Front', 'Rear'], def: 'both' }] },
    exhaust: { label: 'Exhaust', mat: 'chrome', params: [
      { k: 'side', label: 'Outlets', opts: ['left', 'right', 'both', 'center'], names: ['Left', 'Right', 'Both sides', 'Centre'], def: 'left' },
      { k: 'n', label: 'Pipes per outlet', opts: [1, 2], def: 1 },
      { k: 'd', label: 'Diameter', min: 0.03, max: 0.16, step: 0.005, def: 0.09 },
      { k: 'len', label: 'Length', min: 0.04, max: 0.35, step: 0.01, def: 0.12 },
      { k: 'pos', label: 'Distance from centre', min: 0, max: 0.9, step: 0.01, def: 0.51 },
      { k: 'gap', label: 'Pipe spacing', min: 0.06, max: 0.3, step: 0.01, def: 0.14 },
      { k: 'y', label: 'Height above road', min: 0.1, max: 0.5, step: 0.01, def: 0.22 }] },
    dome: { label: 'Power dome', mat: 'paint', params: [
      { k: 'len', label: 'Length', min: 0.3, max: 1.5, step: 0.01, def: 0.9 },
      { k: 'wid', label: 'Width', min: 0.15, max: 0.9, step: 0.01, def: 0.42 },
      { k: 'h', label: 'Height', min: 0.02, max: 0.16, step: 0.005, def: 0.05 },
      { k: 'x', label: 'Position', min: -0.5, max: 0.5, step: 0.01, def: 0 }] }
  };

  // ── Fahrzeuge ──
  // body Karosserie, rims {f, r} Felgen vorn/hinten, tires {f, r}: w Breite (m), side Flankenhöhe (Anteil vom
  // Radius), d Durchmesser (Faktor), bumpers chrome | black | paint, rings Leuchtringe, widen Breitbau (m),
  // ride Tieferlegung (m, negativ = tiefer), track Spurverbreiterung (m), camber Sturz (rad), mix im Zufallsmix,
  // paints: c Farbe, w Gewicht (häufiger), l Lackierung: stripes = drei Rennstreifen an der Flanke,
  // race = dazu Startnummer (2–99) im weißen Kreis auf beiden Türen, carbon = schwarzes Dach
  function ex1() { return { t: 'exhaust' }; }
  var VEHICLES_BUILTIN = {
    '2002': { label: '2002', years: '1966–77', body: '2002', bumpers: 'chrome', rims: { f: 'steel' }, parts: [ex1()],
      paints: [{ c: 0xe8742a, w: 4 }, { c: 0xf2f2ee, l: 'stripes', w: 2 }, { c: 0xd9cfae, w: 1 }, { c: 0x2f5d8a, w: 1 }] },   // Inka, „Turbo“, Chamonix, Fjord
    e30: { label: 'E30', years: '1982–94', body: 'e30', bumpers: 'chrome', rims: { f: 'cross' }, parts: [ex1()],
      paints: [{ c: 0xa8141c, w: 3 }, { c: 0xf2f2ee, w: 3 }, { c: 0x15161a, w: 1 }, { c: 0x1d3e7a, w: 1 }] },                // Henna, Alpinweiß, Diamantschwarz, Royalblau
    e30m3: { label: 'E30 M3', years: '1986–91', body: 'e30m3', bumpers: 'black', widen: 0.05, rims: { f: 'star' },
      parts: [{ t: 'lip' }, { t: 'wing' }, { t: 'flares' }, ex1()],
      paints: [{ c: 0xf2f2ee, l: 'race', w: 4 }, { c: 0xf2f2ee, l: 'stripes', w: 2 }, { c: 0xc8151b, w: 1 }, { c: 0x2a2c30, w: 1 }] },
    e36: { label: 'E36', years: '1990–2000', body: 'e36', bumpers: 'black', rims: { f: 'star' }, parts: [{ t: 'lip' }, ex1()],
      paints: [{ c: 0xe6c21a, w: 4 }, { c: 0x2b3f8f, w: 3 }, { c: 0x1d2a6e, w: 1 }] },                                     // Dakar, Estoril, Le Mans
    e46: { label: 'E46', years: '1998–2006', body: 'e46', bumpers: 'black', rings: true, rims: { f: 'star' }, parts: [ex1()],
      paints: [{ c: 0x2f7fc8, w: 4 }, { c: 0xe5b52a, w: 3 }, { c: 0xb3121a, w: 1 }, { c: 0xb8bcc2, w: 1 }] },               // Laguna Seca, Phoenix, Imola, Silbergrau
    e92m3: { label: 'E92 M3', years: '2007–13', body: 'e92m3', bumpers: 'black', rings: true, rims: { f: 'star' },
      parts: [{ t: 'lip' }, { t: 'dome' }, { t: 'flares', out: 0.05 }, { t: 'exhaust', side: 'both', n: 2, pos: 0.49 }],
      paints: [{ c: 0x8a1018, l: 'carbon', w: 3 }, { c: 0x1d3e8a, l: 'carbon', w: 2 }, { c: 0xf2f2ee, l: 'carbon', w: 2 }, { c: 0x15161a, w: 1 }] }  // Melbourne, Interlagos, Alpinweiß, Jerez
  };
  var TIRE_DEF = { w: 0.25, side: 0.26, d: 1 };

  // zusammengeführte Kataloge (eingebaut + gespeichert); MODELS = Fahrzeuge im Zufallsmix (gleiches Array bleibt)
  var RIMS = {}, VEHICLES = {}, MODELS = [], CACHE = {}, PAINTS = {}, RIM_MATS = {};
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function rebuildCatalog(custom) {
    custom = custom || {};
    Object.keys(RIMS).forEach(function (k) { delete RIMS[k]; });
    Object.keys(VEHICLES).forEach(function (k) { delete VEHICLES[k]; });
    Object.keys(RIMS_BUILTIN).forEach(function (k) { RIMS[k] = RIMS_BUILTIN[k]; });
    Object.keys(custom.rims || {}).forEach(function (k) { if (custom.rims[k] && typeof custom.rims[k] === 'object') RIMS[k] = custom.rims[k]; });
    Object.keys(VEHICLES_BUILTIN).forEach(function (k) { VEHICLES[k] = VEHICLES_BUILTIN[k]; });
    Object.keys(custom.vehicles || {}).forEach(function (k) { if (custom.vehicles[k] && typeof custom.vehicles[k] === 'object') VEHICLES[k] = custom.vehicles[k]; });
    MODELS.length = 0;
    Object.keys(VEHICLES).forEach(function (k) { if (VEHICLES[k].mix !== false) MODELS.push(k); });
    if (!MODELS.length) MODELS.push('e30');
    Object.keys(CACHE).forEach(function (k) { delete CACHE[k]; });
    Object.keys(PAINTS).forEach(function (k) { delete PAINTS[k]; });
  }
  var CUSTOM = { rims: {}, vehicles: {} };
  function applyCustom(c) {
    CUSTOM = { rims: (c && c.rims) || {}, vehicles: (c && c.vehicles) || {} };
    rebuildCatalog(CUSTOM);
  }
  rebuildCatalog(CUSTOM);

  function num(v, d, lo, hi) { v = typeof v === 'number' && isFinite(v) ? v : d; return Math.max(lo, Math.min(hi, v)); }
  // Fahrzeug mit allen Standardwerten (fehlende Felder, unbekannte Karosserie/Felge)
  function normVehicle(v) {
    v = v || {};
    var o = {
      label: typeof v.label === 'string' ? v.label : '', years: typeof v.years === 'string' ? v.years : '',
      body: BODIES[v.body] ? v.body : 'e30', bumpers: ['chrome', 'black', 'paint'].indexOf(v.bumpers) >= 0 ? v.bumpers : 'black',
      rings: !!v.rings, mix: v.mix !== false,
      widen: num(v.widen, 0, -0.1, 0.4), ride: num(v.ride, 0, -0.2, 0.3), track: num(v.track, 0, -0.1, 0.3), camber: num(v.camber, 0, -0.3, 0.3)
    };
    var rf = (v.rims && v.rims.f) || 'star', rr = (v.rims && v.rims.r) || rf;
    o.rims = { f: rf, r: rr };
    function tire(t) { t = t || {}; return { w: num(t.w, TIRE_DEF.w, 0.12, 0.6), side: num(t.side, TIRE_DEF.side, 0.06, 0.6), d: num(t.d, TIRE_DEF.d, 0.6, 1.6) }; }
    var tf = tire(v.tires && v.tires.f);
    o.tires = { f: tf, r: v.tires && v.tires.r ? tire(v.tires.r) : clone(tf) };
    o.parts = (Array.isArray(v.parts) ? v.parts : []).filter(function (p) { return p && PARTS[p.t]; }).map(normPart);
    o.paints = (Array.isArray(v.paints) ? v.paints : []).filter(function (p) { return p && typeof p.c === 'number'; });
    if (!o.paints.length) o.paints = [{ c: 0xc9ccd2 }];
    return o;
  }
  function normPart(p) {
    var spec = PARTS[p.t], o = { t: p.t, mat: PART_MATS[p.mat] ? p.mat : spec.mat };
    if (o.mat === 'color') o.color = typeof p.color === 'number' ? p.color : 0xc8151b;
    spec.params.forEach(function (q) {
      if (q.opts) o[q.k] = q.opts.indexOf(p[q.k]) >= 0 ? p[q.k] : q.def;
      else o[q.k] = num(p[q.k], q.def, q.min, q.max);
    });
    return o;
  }
  function normRim(r) {
    r = r || {};
    return {
      label: typeof r.label === 'string' ? r.label : '',
      style: RIM_STYLES[r.style] ? r.style : 'spokes', n: Math.round(num(r.n, 5, 3, 24)), sw: num(r.sw, 0.4, 0.08, 0.9),
      dish: num(r.dish, 0.3, 0, 1), lip: num(r.lip, 0.06, 0, 0.3), finish: FINISHES[r.finish] ? r.finish : 'silver',
      color: typeof r.color === 'number' ? r.color : null, accent: r.accent === 'same' || FINISHES[r.accent] ? r.accent : 'same',
      cap: ['small', 'big', 'nuts', 'none'].indexOf(r.cap) >= 0 ? r.cap : 'small', twist: num(r.twist, 0, -1, 1)
    };
  }
  function pickPaint(m) {
    var v = VEHICLES[m] || VEHICLES.e30, list = (v && v.paints && v.paints.length ? v.paints : [{ c: 0xc9ccd2 }]), sum = 0, r;
    list.forEach(function (p) { sum += p.w || 1; }); r = Math.random() * sum;
    for (var i = 0; i < list.length; i++) { r -= list[i].w || 1; if (r <= 0) return list[i]; }
    return list[0];
  }
  function hexStr(h) { return '#' + ('000000' + h.toString(16)).slice(-6); }

  function col(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  var MAT = {};
  function mats() {
    if (MAT.glass) return MAT;
    var phys = function (o) { var m = new THREE.MeshPhysicalMaterial(o); if (o.color != null) m.color.convertSRGBToLinear(); return m; };
    MAT.glass = phys({ color: 0x1a222c, roughness: 0.05, metalness: 0.3, clearcoat: 1, envMapIntensity: 1.4, side: THREE.DoubleSide });
    MAT.lens = phys({ color: 0x9aa6b4, roughness: 0.08, metalness: 0.6, clearcoat: 1, envMapIntensity: 1.5 });
    MAT.chrome = phys({ color: 0xe6e9ee, roughness: 0.12, metalness: 1, envMapIntensity: 1.3 });
    MAT.black = phys({ color: 0x141518, roughness: 0.55 });
    MAT.tire = phys({ color: 0x18191b, roughness: 0.85 });
    MAT.lamp = new THREE.MeshBasicMaterial({ color: col(0xfffbe8) });
    MAT.ring = new THREE.MeshBasicMaterial({ color: col(0xeaf8ff) });
    MAT.tail = phys({ color: 0xd8101e, roughness: 0.2, clearcoat: 1, emissive: 0x7a0008 });
    MAT.amber = phys({ color: 0xf29a1e, roughness: 0.2, clearcoat: 1 });
    MAT.plate = phys({ color: 0xf4f4f0, roughness: 0.5 });
    return MAT;
  }
  // ── Karosserie ──
  // Seitenprofil unten: Boden mit Radläufen, Front, Haube, Gürtellinie, Kofferraum, Heck (x 0 = Heck)
  function lowerShape(s) {
    var L = s.L, ro = L - s.wb - s.fo, xr = ro, xf = ro + s.wb, gc = 0.16, ar = s.r + 0.05;
    var sh = new THREE.Shape();
    sh.moveTo(0.06, gc + 0.04);
    sh.lineTo(xr - ar, gc);
    sh.lineTo(xr - ar, s.r);
    sh.absarc(xr, s.r, ar, Math.PI, 0, true);
    sh.lineTo(xr + ar, gc);                                           // Unterboden waagrecht zwischen den Radläufen
    sh.lineTo(xf - ar, gc);
    sh.lineTo(xf - ar, s.r);
    sh.absarc(xf, s.r, ar, Math.PI, 0, true);
    sh.lineTo(xf + ar, gc);
    sh.lineTo(L - 0.08, gc);
    sh.quadraticCurveTo(L, gc + 0.02, L, gc + 0.14);
    sh.lineTo(L - s.slant, s.nose);                                   // Front
    var xc = xf - 0.25 - s.ws * 0.2;                                  // Windschutzscheibenfuß
    sh.quadraticCurveTo(L - s.slant - 0.1, s.nose + 0.04, L - s.slant - 0.35, s.nose + 0.06);
    sh.lineTo(xc, s.cowl);                                            // Haube
    var xd = L * s.roofR - s.rs * 0.75;                               // Heckscheibenfuß
    sh.lineTo(xd, s.belt);                                            // Gürtellinie
    sh.lineTo(0.3, s.deck);                                           // Kofferraumdeckel
    sh.quadraticCurveTo(0.02, s.deck, 0.02, s.deck - 0.12);
    sh.lineTo(0, gc + 0.12);                                          // Heck
    sh.closePath();
    return { shape: sh, xr: xr, xf: xf, xc: xc, xd: xd };
  }
  // Fahrgastzelle: Windschutzscheibe, Dach, Heckscheibe (Seitenprofil)
  function cabinPts(s, lo) {
    var L = s.L, yb = Math.max(s.cowl, s.belt) - 0.02;
    return [[lo.xc + 0.02, yb], [L * s.roofF + 0.02, s.H], [L * s.roofR, s.H], [lo.xd, yb]];
  }
  // Seiten der Fahrgastzelle als Textur: Lack (weiß, wird mit der Lackfarbe multipliziert), Fenster dunkel,
  // B-Säule, Hofmeister-Knick hinten unten. UV der Extrusion = Profil-Koordinaten in m
  function cabinSideTex(s, cp) {
    var W = 1024, Hh = 512, L = s.L, H = s.H;
    function X(x) { return x / L * W; } function Y(y) { return (1 - y / H) * Hh; }
    var t = canvasTex(W, Hh, function (x) {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, Hh);
      var yb = cp[0][1] + 0.05, yt = H - 0.07;
      var fA = [cp[0][0] - 0.05, yb], fT = [cp[1][0] - 0.05, yt], rT = [cp[2][0] + 0.06, yt];
      // Hofmeister-Knick: die hintere Fensterkante läuft nach hinten unten und knickt kurz vor der
      // Gürtellinie deutlich nach vorn
      var kink = [cp[3][0] + 0.12, yb + 0.2];
      var bx = (fA[0] + kink[0]) / 2 + 0.05;
      function poly(p) { x.beginPath(); p.forEach(function (q, i) { (i ? x.lineTo : x.moveTo).call(x, X(q[0]), Y(q[1])); }); x.closePath(); }
      x.fillStyle = '#c8ccd2';                                        // Chrom-/Gummirahmen
      poly([fA, fT, rT, [kink[0] - 0.04, kink[1] + 0.02], [kink[0] + 0.34, yb - 0.02], [fA[0], yb - 0.02]]); x.fill();
      x.fillStyle = '#12161c';
      poly([[fA[0] - 0.02, yb + 0.01], [fT[0] - 0.02, yt - 0.03], [bx + 0.05, yt - 0.03], [bx + 0.05, yb + 0.01]]); x.fill();
      poly([[bx - 0.05, yb + 0.01], [bx - 0.05, yt - 0.03], [rT[0] + 0.02, yt - 0.03], [kink[0], kink[1]], [kink[0] + 0.3, yb + 0.01]]); x.fill();
    });
    t.repeat.set(1 / L, 1 / H);
    return t;
  }
  // Seiten unten: Türfugen, Schutzleiste, Griffe, Blinker vorn
  // opt.bg = Lackfarbe (sonst weiß, wird dann mit der Lackfarbe multipliziert), opt.livery = stripes|race
  function lowerSideTex(s, lo, opt) {
    opt = opt || {};
    var W = 1024, Hh = 256, L = s.L, H = s.H;
    function X(x) { return x / L * W; }
    var t = canvasTex(W, Hh * 2, function (x, w, h) {
      function YY(y) { return (1 - y / H) * h; }
      x.fillStyle = opt.bg != null ? hexStr(opt.bg) : '#ffffff'; x.fillRect(0, 0, w, h);
      if (opt.livery === 'stripes' || opt.livery === 'race') {
        // drei Rennstreifen (hellblau, dunkelblau, rot) über die Flanke, vorn schräg angeschnitten
        // (Startnummer: eigenes Teil, siehe numberPlates)
        [['#5bb3e6', 0.47], ['#1f2a8a', 0.41], ['#d8231e', 0.35]].forEach(function (st) {
          var y0 = st[1], hgt = 0.05, x0 = 0.3, x1 = L - 0.45;
          x.fillStyle = st[0]; x.beginPath(); x.moveTo(X(x0), YY(y0 + hgt)); x.lineTo(X(x1 - 0.05), YY(y0 + hgt)); x.lineTo(X(x1 + 0.12), YY(y0 + hgt + 0.18)); x.lineTo(X(x1 + 0.17), YY(y0 + 0.18)); x.lineTo(X(x1), YY(y0)); x.lineTo(X(x0), YY(y0)); x.closePath(); x.fill();
        });
      }
      x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 3;
      var d0 = lo.xc - 0.05, d1 = lo.xd + 0.25;
      x.beginPath(); x.moveTo(X(d0), YY(s.cowl - 0.02)); x.lineTo(X(d0), YY(0.24)); x.moveTo(X(d1), YY(s.belt - 0.02)); x.lineTo(X(d1), YY(0.24)); x.stroke();
      x.fillStyle = s.chrome ? '#b9bec6' : '#2a2c30'; x.fillRect(X(0.25), YY(0.5), X(L - 0.5), 10);   // Schutzleiste
      x.fillStyle = '#5a5e66'; x.fillRect(X(d1 + 0.18), YY(s.belt - 0.1), 26, 7);                 // Türgriff
      x.fillStyle = '#f29a1e'; x.fillRect(X(lo.xf + 0.42), YY(0.6), 14, 8);                        // Seitenblinker
    });
    t.repeat.set(1 / L, 1 / H);
    return t;
  }

  // Umriss dicht abtasten (sonst haben lange Kanten keine Zwischenpunkte zum Verformen)
  function dense(shape, n) { return new THREE.Shape(shape.getSpacedPoints(n)); }
  // Karosserie formen: Ecken von oben gerundet (plan, hängt nur von der Länge ab: die Seitenflächen
  // bestehen aus langen Dreiecken ohne Punkte in der Mitte, alles andere würde sie verbeulen).
  // Ausgestellte Kotflügel sind eigene Teile (siehe buildModel). Nur z wird verändert.
  function sculpt(geo, s, W, y0, y1, x0, x1) {
    var p = geo.attributes.position, half = W / 2, endL = Math.min(0.75, (x1 - x0) * 0.2);
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), az = Math.min(1.2, Math.abs(z) / half), f = 1;
      var e = Math.max(0, (x - (x1 - endL)) / endL, (x0 + endL - x) / endL);
      f *= 1 - (s.plan || 0) * e * e * Math.min(1, az * az);
      p.setZ(i, z * f);
    }
    smoothNormals(geo, 0.57);
  }

  // weiche Schattierung: Normalen benachbarter Flächen mitteln, solange der Knick unter ~55° liegt
  // (ExtrudeGeometry ist nicht indiziert, computeVertexNormals ergäbe Facetten)
  function smoothNormals(geo, cosT) {
    var p = geo.attributes.position.array, nT = p.length / 9, fn = new Float32Array(nT * 3), map = {}, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    function key(i) { return Math.round(p[i] * 2000) + ',' + Math.round(p[i + 1] * 2000) + ',' + Math.round(p[i + 2] * 2000); }
    for (var t = 0; t < nT; t++) {
      a.fromArray(p, t * 9); b.fromArray(p, t * 9 + 3); c.fromArray(p, t * 9 + 6);
      b.sub(a); c.sub(a); b.cross(c); var l = b.length() || 1; fn[t * 3] = b.x / l; fn[t * 3 + 1] = b.y / l; fn[t * 3 + 2] = b.z / l;
      for (var v = 0; v < 3; v++) { var k = key(t * 9 + v * 3); (map[k] || (map[k] = [])).push(t); }
    }
    var out = new Float32Array(p.length);
    for (t = 0; t < nT; t++) for (v = 0; v < 3; v++) {
      var list = map[key(t * 9 + v * 3)], sx = 0, sy = 0, sz = 0;
      for (var j = 0; j < list.length; j++) { var g = list[j], d = fn[t * 3] * fn[g * 3] + fn[t * 3 + 1] * fn[g * 3 + 1] + fn[t * 3 + 2] * fn[g * 3 + 2]; if (d > cosT) { sx += fn[g * 3]; sy += fn[g * 3 + 1]; sz += fn[g * 3 + 2]; } }
      var ln = Math.hypot(sx, sy, sz) || 1, o = t * 9 + v * 3; out[o] = sx / ln; out[o + 1] = sy / ln; out[o + 2] = sz / ln;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  }

  function add(g, geo, mat, x, y, z, rx, ry, rz) { var m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0); g.add(m); return m; }
  function rbox(w, h, d) { return new THREE.BoxGeometry(w, h, d); }


  // ── Felgen in 3D ──
  // Geometrie mit drei Material-Gruppen: 0 Oberfläche, 1 Akzent (Horn, Nabendeckel), 2 dunkel (Felgenbett, Löcher)
  function merge(list) {
    var byM = [[], [], []];
    list.forEach(function (it) {
      var g = it.g.index ? it.g.toNonIndexed() : it.g;
      if (!g.attributes.normal) g.computeVertexNormals();
      byM[it.m].push(g);
    });
    var pos = [], nor = [], out = new THREE.BufferGeometry(), start = 0;
    byM.forEach(function (gs, m) {
      var n = 0;
      gs.forEach(function (g) {
        var p = g.attributes.position.array, q = g.attributes.normal.array;
        for (var i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(q[i]); }
        n += p.length / 3;
      });
      if (n) out.addGroup(start, n, m);
      start += n;
    });
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return out;
  }
  // Balken von a nach b (Punkte [x, y, z]), Breite w0 → w1 quer dazu in der Felgenebene, Dicke th nach hinten
  function beam(a, b, w0, w1, th) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, px = -dy / l, py = dx / l;
    var c = [
      [a[0] + px * w0 / 2, a[1] + py * w0 / 2, a[2]], [a[0] - px * w0 / 2, a[1] - py * w0 / 2, a[2]],
      [b[0] - px * w1 / 2, b[1] - py * w1 / 2, b[2]], [b[0] + px * w1 / 2, b[1] + py * w1 / 2, b[2]]
    ];
    var k = c.map(function (p) { return [p[0], p[1], p[2] - th]; }), v = [];
    function quad(p, q, r, s) { v.push.apply(v, p.concat(q, r, p, r, s)); }
    quad(c[0], c[1], c[2], c[3]); quad(k[3], k[2], k[1], k[0]);
    quad(c[1], k[1], k[2], c[2]); quad(c[3], k[3], k[0], c[0]); quad(c[0], k[0], k[1], c[1]); quad(c[2], k[2], k[3], c[3]);
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
    return g;
  }
  function polar(r, a, z) { return [Math.cos(a) * r, Math.sin(a) * r, z]; }
  function zRot(g) { g.rotateX(Math.PI / 2); return g; }            // Achse y → z
  // Felge mit Außenseite bei z = 0 (zeigt nach +z), Radius R, Tiefe w
  function rimGeo(d, R, w) {
    var L = [], lipW = R * d.lip, r1 = R - lipW - R * 0.02, r0 = R * 0.22, dz = d.dish * w * 0.45, th = R * 0.09, n = d.n, sec = Math.PI * 2 / n;
    function zAt(r) { return -dz + (dz - R * 0.01) * (r - r0) / (r1 - r0); }   // Schüssel: Nabe hinten, Speichenenden vorn
    // Horn, Felgenbett, Rückwand
    L.push({ g: new THREE.RingGeometry(r1, R, 32, 1), m: 1 });
    L.push({ g: zRot(new THREE.CylinderGeometry(R, R, R * 0.06, 32, 1, true)).translate(0, 0, -R * 0.03), m: 1 });
    L.push({ g: zRot(new THREE.CylinderGeometry(r1, r1, w, 24, 1, true)).translate(0, 0, -w / 2), m: 2 });
    L.push({ g: new THREE.CircleGeometry(r1, 24).translate(0, 0, -w * 0.9), m: 2 });
    L.push({ g: new THREE.RingGeometry(r1 - R * 0.05, r1, 32, 1).translate(0, 0, -R * 0.012), m: 0 });   // Speichenkranz
    var ww = d.sw * sec * r1, tw = d.twist * sec;
    if (d.style === 'spokes' || d.style === 'double' || d.style === 'y') {
      for (var i = 0; i < n; i++) {
        var a = i * sec + Math.PI / 2;
        if (d.style === 'spokes') L.push({ g: beam(polar(r0, a, -dz), polar(r1, a + tw, zAt(r1)), Math.min(ww, sec * r0 * 0.9), ww, th), m: 0 });
        else if (d.style === 'double') [-1, 1].forEach(function (sd) {
          var o = ww * 0.32 * sd;
          L.push({ g: beam(polar(r0, a + sd * 0.12, -dz), polar(r1, a + tw + o / r1, zAt(r1)), Math.min(ww * 0.4, sec * r0 * 0.4), ww * 0.38, th), m: 0 });
        });
        else {
          var rm = r0 + (r1 - r0) * 0.45;
          L.push({ g: beam(polar(r0, a, -dz), polar(rm, a, zAt(rm)), Math.min(ww, sec * r0 * 0.9), ww * 0.9, th), m: 0 });
          [-1, 1].forEach(function (sd) { L.push({ g: beam(polar(rm, a, zAt(rm)), polar(r1, a + tw + sd * sec * 0.22, zAt(r1)), ww * 0.55, ww * 0.5, th), m: 0 }); });
        }
      }
    } else if (d.style === 'mesh') {
      var wm = Math.max(R * 0.02, ww * 0.35);
      for (var j = 0; j < n; j++) {
        var b = j * sec;
        [-1, 1].forEach(function (sd) { L.push({ g: beam(polar(r0, b, -dz), polar(r1, b + sd * sec * (0.9 + d.twist * 0.5), zAt(r1)), wm, wm, th * 0.7), m: 0 }); });
      }
      L.push({ g: zRot(new THREE.CylinderGeometry(r0 * 1.35, r0 * 1.35, th, 32, 1, true)).translate(0, 0, -dz), m: 0 });
    } else if (d.style === 'turbine') {
      var seg = 4, tw2 = sec * (0.6 + d.twist);
      for (var t = 0; t < n; t++) {
        var c0 = t * sec;
        for (var s = 0; s < seg; s++) {
          var ra = r0 + (r1 - r0) * s / seg, rb = r0 + (r1 - r0) * (s + 1) / seg;
          L.push({ g: beam(polar(ra, c0 + tw2 * s / seg, zAt(ra)), polar(rb, c0 + tw2 * (s + 1) / seg, zAt(rb)), ww * 0.6, ww * 0.7, th), m: 0 });
        }
      }
    } else {
      // Scheibe (disc/steel): Kegel von der Nabe zum Rand, Löcher als dunkle Flecken
      var lat = new THREE.LatheGeometry([new THREE.Vector2(r0, -dz), new THREE.Vector2(r1 + R * 0.005, -R * 0.01)], 32);
      L.push({ g: zRot(lat), m: 0 });
      var rh = (r0 + r1) / 2 + (d.style === 'steel' ? 0.05 * R : 0), hr = Math.min(d.sw * sec * rh * 0.5, (r1 - r0) * 0.4);
      for (var h = 0; h < n; h++) {
        var hg = new THREE.CircleGeometry(hr, 20);
        if (d.style === 'steel') hg.scale(0.65, 1, 1);
        hg.rotateZ(h * sec); var pp = polar(rh, h * sec, zAt(rh) + R * 0.012); hg.translate(pp[0], pp[1], pp[2]);
        L.push({ g: hg, m: 2 });
      }
    }
    // Nabe und Deckel
    L.push({ g: new THREE.CircleGeometry(r0 * 1.05, 32).translate(0, 0, -dz + 0.002), m: 0 });
    if (d.cap === 'small' || d.cap === 'big') {
      var cr = d.cap === 'big' ? R * 0.34 : R * 0.15;
      L.push({ g: zRot(new THREE.CylinderGeometry(cr * 0.85, cr, R * 0.06, 28)).translate(0, 0, -dz + R * 0.03), m: 1 });
    } else if (d.cap === 'nuts') {
      for (var u = 0; u < 5; u++) {
        var np = polar(r0 * 0.6, u / 5 * Math.PI * 2, -dz + R * 0.03);
        L.push({ g: zRot(new THREE.CylinderGeometry(R * 0.035, R * 0.035, R * 0.06, 6)).translate(np[0], np[1], np[2]), m: 1 });
      }
      L.push({ g: new THREE.CircleGeometry(r0 * 0.3, 20).translate(0, 0, -dz + 0.004), m: 2 });
    }
    return merge(L);
  }
  function finishMat(name, color) {
    var f = FINISHES[name] || FINISHES.silver, c = color != null ? color : f.c, k = name + ':' + c;
    if (!RIM_MATS[k]) {
      RIM_MATS[k] = new THREE.MeshPhysicalMaterial({ color: col(c), metalness: f.m, roughness: f.r, clearcoat: 0.6, envMapIntensity: 1.3, side: THREE.DoubleSide });
    }
    return RIM_MATS[k];
  }
  function rimMats(d) {
    var main = finishMat(d.finish, d.color);
    var acc = d.accent === 'same' ? main : finishMat(d.accent, null);
    if (!RIM_MATS.dark) RIM_MATS.dark = new THREE.MeshStandardMaterial({ color: col(0x101114), roughness: 0.7, side: THREE.DoubleSide });
    return [main, acc, RIM_MATS.dark];
  }
  // Reifen: gerundetes Profil um die Achse gedreht (Achse z), Außenradius R, Felgenradius Rr, Breite w
  var TIRE_MAT = null;
  function tireGeo(R, Rr, w) {
    var hw = w / 2, e = Math.min(0.05, (R - Rr) * 0.35), P = [
      [Rr * 0.99, -hw * 0.82], [Rr + (R - Rr) * 0.5, -hw * 0.98], [R - e, -hw], [R - e * 0.2, -hw + e], [R, -hw * 0.5],
      [R, hw * 0.5], [R - e * 0.2, hw - e], [R - e, hw], [Rr + (R - Rr) * 0.5, hw * 0.98], [Rr * 0.99, hw * 0.82]
    ].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    return zRot(new THREE.LatheGeometry(P, 28));
  }
  // Rad als Gruppe: Achse z, Außenseite +z; rim = Felgen-Bauplan, tire = {w, side, d}, r0 = Grundradius der Karosserie
  function wheel(rim, tire, r0) {
    var d = normRim(rim), R = r0 * tire.d, Rr = R * (1 - tire.side), w = tire.w;
    if (!TIRE_MAT) TIRE_MAT = new THREE.MeshPhysicalMaterial({ color: col(0x18191b), roughness: 0.85, side: THREE.DoubleSide });
    var g = new THREE.Group();
    g.add(new THREE.Mesh(tireGeo(R, Rr, w), TIRE_MAT));
    var rm = new THREE.Mesh(rimGeo(d, Rr, w * 0.9), rimMats(d)); rm.position.z = w * 0.42; rm.name = 'Rim'; g.add(rm);
    g.userData.R = R;
    return g;
  }

  // ── Teile-Materialien ──
  var PMATS = {};
  function partMat(p, paint) {
    var M = mats();
    if (p.mat === 'paint') return paint;
    if (p.mat === 'black') return M.black;
    if (p.mat === 'chrome') return M.chrome;
    var k = p.mat === 'color' ? 'c' + p.color : p.mat;
    if (PMATS[k]) return PMATS[k];
    if (p.mat === 'carbon') {
      var t = canvasTex(64, 64, function (x) {
        for (var i = 0; i < 8; i++) for (var j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? '#2a2c31' : '#141518'; x.fillRect(i * 8, j * 8, 8, 8); }
      });
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6);
      PMATS[k] = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t, roughness: 0.35, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
    } else if (p.mat === 'titanium') PMATS[k] = new THREE.MeshPhysicalMaterial({ color: col(0x8f8cae), roughness: 0.22, metalness: 1, envMapIntensity: 1.3 });
    else PMATS[k] = new THREE.MeshPhysicalMaterial({ color: col(p.color), roughness: 0.3, metalness: 0.3, clearcoat: 1 });
    return PMATS[k];
  }

  // Box zwischen zwei Punkten in der Seitenebene (x, y) bei z, Dicke th, Tiefe dz
  function rod(g, a, b, z, th, dz, mat) {
    var dx = b[0] - a[0], dy = b[1] - a[1], m = add(g, rbox(Math.hypot(dx, dy) + th, th, dz), mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z, 0, 0, Math.atan2(dy, dx));
    return m;
  }

  // ── Fahrzeug bauen ──
  function buildVehicle(vd) {
    var v = normVehicle(vd), bk = v.body, base = BODIES[bk], M = mats();
    var W = base.W + v.widen, s = Object.assign({}, base, { W: W, chrome: v.bumpers === 'chrome' });
    var paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 });
    paint.userData.isPaint = true;
    var car = new THREE.Group(), body = new THREE.Group(), shell = new THREE.Group(); car.add(body);
    shell.name = 'Shell'; body.add(shell);
    var bev = s.round || 0.07, lo = lowerShape(s), L = s.L;
    // Räder: Mitte auf Höhe des Reifenradius; die Karosserie hebt sich mit größeren Rädern und Tieferlegung
    var Rf = s.r * v.tires.f.d, Rrr = s.r * v.tires.r.d, lift = (Rf + Rrr) / 2 - s.r + v.ride;
    shell.position.y = lift;
    // Unterteil: Seiten mit Fugen-Textur, Rest Lack
    var lg = new THREE.ExtrudeGeometry(dense(lo.shape, 260), { depth: W - 2 * bev, steps: 10, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4 });
    lg.translate(0, 0, -(W - 2 * bev) / 2);
    sculpt(lg, s, W, 0.1, Math.max(s.cowl, s.belt), -bev, s.L + bev);
    var sideLo = paint.clone(); sideLo.map = lowerSideTex(s, lo); sideLo.userData.side = 'lower';
    add(shell, lg, [sideLo, paint]);
    // Fahrgastzelle: oben eingezogen (Tumblehome)
    var cp = cabinPts(s, lo), csh = new THREE.Shape();
    cp.forEach(function (p, i) { if (i) csh.lineTo(p[0], p[1]); else csh.moveTo(p[0], p[1]); });
    var cw = W * 0.86, cg = new THREE.ExtrudeGeometry(csh, { depth: cw - 0.08, steps: 4, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3 });
    cg.translate(0, 0, -(cw - 0.08) / 2);
    (function () { var p = cg.attributes.position, yb = cp[0][1]; for (var i = 0; i < p.count; i++) { var k = Math.max(0, (p.getY(i) - yb) / (s.H - yb)); p.setZ(i, p.getZ(i) * (1 - s.tumble * k)); } smoothNormals(cg, 0.57); })();
    var sideCab = paint.clone(); sideCab.map = cabinSideTex(s, cp);
    var roof = paint.clone(); roof.userData.roof = true;
    add(shell, cg, [sideCab, roof]);
    // Windschutz- und Heckscheibe als Glasflächen auf den Schrägen
    function pane(a, b, wid) {
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      var u = new THREE.Vector3(dx / len, dy / len, 0), vv = new THREE.Vector3(0, 0, 1), n = new THREE.Vector3().crossVectors(u, vv);
      var m = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.9, wid), M.glass);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, vv, n));
      m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0).addScaledVector(n, 0.065);
      shell.add(m); return m;
    }
    var mw = cw * (1 - s.tumble * 0.5) - 0.14;
    pane(cp[0], cp[1], mw); pane(cp[2], cp[3], mw);

    // ── Front (x = L) ──
    var yl = s.nose - 0.19, f0 = 0.3;
    function frontX(y) { return L + bev + 0.012 - s.slant * Math.max(0, Math.min(1, (y - f0) / (s.nose - f0))); }
    var front = new THREE.Group(); front.position.set(frontX(yl), 0, 0); front.rotation.y = Math.PI / 2; shell.add(front);   // lokal: x quer, y hoch, +z nach vorn
    function fadd(geo, mat, lx, y, dz) { return add(front, geo, mat, lx, y, frontX(y) - front.position.x + (dz || 0)); }
    var kw = s.big ? 0.22 : 0.15, kh = s.big ? 0.26 : bk === 'e36' ? 0.24 : 0.3;
    if (s.grill) fadd(rbox(W * (1 - (s.plan || 0) * 0.6) - 0.2, 0.26, 0.02), M.black, 0, yl, 0.0);   // schwarzer Grill quer
    [-1, 1].forEach(function (sd) {
      // Doppelniere: Chromrahmen, schwarzes Gitter mit senkrechten Stäben
      var kx = sd * (kw / 2 + 0.035);
      fadd(rbox(kw + 0.06, kh + 0.06, 0.03), M.chrome, kx, yl + 0.03, 0.012);
      fadd(rbox(kw, kh, 0.04), M.black, kx, yl + 0.03, 0.016);
      for (var b = 1; b < 4; b++) fadd(rbox(0.012, kh - 0.02, 0.045), M.chrome, kx - kw / 2 + b * kw / 4, yl + 0.03, 0.017);
      var ex = W / 2 - 0.3;
      if (s.lights === 'round1') { fadd(new THREE.CircleGeometry(0.15, 28), M.chrome, sd * ex, yl, 0.02); fadd(new THREE.CircleGeometry(0.125, 28), M.lamp, sd * ex, yl, 0.025); }
      else if (s.lights === 'round2') [0, 1].forEach(function (k) {
        var lx = sd * (ex + 0.07 - (1 - k) * 0.22); fadd(new THREE.CircleGeometry(0.1, 28), M.chrome, lx, yl, 0.02); fadd(new THREE.CircleGeometry(0.082, 28), M.lamp, lx, yl, 0.025);
      });
      else {
        // Scheinwerfer unter Glas, auf Wunsch mit hellen Leuchtringen
        fadd(rbox(0.5, 0.22, 0.03), M.lens, sd * (ex - 0.02), yl + 0.02, 0.012);
        [0, 1].forEach(function (k) {
          var cx = sd * (ex - 0.02) + (k ? 0.115 : -0.115);
          fadd(new THREE.CircleGeometry(0.07, 24), M.lamp, cx, yl + 0.02, 0.03);
          if (v.rings) fadd(new THREE.TorusGeometry(0.088, 0.016, 8, 32), M.ring, cx, yl + 0.02, 0.035);
        });
      }
      fadd(rbox(0.16, 0.06, 0.02), M.amber, sd * (W / 2 - 0.26), 0.36, 0.03);                // Blinker unten
    });
    fadd(rbox(0.46, 0.12, 0.02), M.plate, 0, 0.3, 0.07);                                       // Kennzeichenfeld (leer)
    if (v.bumpers === 'chrome') { fadd(rbox(W + 0.06, 0.11, 0.12), M.chrome, 0, 0.42, 0.06); fadd(rbox(W + 0.07, 0.03, 0.125), M.black, 0, 0.42, 0.062); }   // Chromstoßstange mit Gummileiste
    else fadd(rbox(W - 0.04, 0.18, 0.08), v.bumpers === 'paint' ? paint : M.black, 0, 0.24, 0.03);
    // ── Heck (x = 0) ──
    var rear = new THREE.Group(); rear.position.set(-bev - 0.012, 0, 0); rear.rotation.y = -Math.PI / 2; shell.add(rear);
    var yt = s.deck - 0.2;
    [-1, 1].forEach(function (sd) {
      if (s.tail === 'round') add(rear, new THREE.CircleGeometry(0.11, 24), M.tail, sd * (W / 2 - 0.26), yt, 0.02);
      else if (s.tail === 'wide') { add(rear, rbox(0.5, 0.2, 0.02), M.tail, sd * (W / 2 - 0.32), yt, 0.01); add(rear, rbox(0.15, 0.2, 0.025), M.amber, sd * (W / 2 - 0.66), yt, 0.012); }
      else { add(rear, rbox(0.46, 0.17, 0.02), M.tail, sd * (W / 2 - 0.32), yt + 0.02, 0.01); add(rear, rbox(0.2, 0.05, 0.025), M.lamp, sd * (W / 2 - 0.32), yt - 0.02, 0.012); }
    });
    add(rear, rbox(0.42, 0.11, 0.02), M.plate, 0, yt - 0.06, 0.01);
    if (v.bumpers === 'chrome') add(rear, rbox(W + 0.04, 0.08, 0.1), M.chrome, 0, 0.42, 0.05);
    else add(rear, rbox(W + 0.02, 0.18, 0.06), v.bumpers === 'paint' ? paint : M.black, 0, 0.27, 0.02);
    // Spiegel
    [-1, 1].forEach(function (sd) { add(shell, rbox(0.08, 0.08, 0.14), paint, lo.xc + 0.05, s.cowl + 0.08, sd * (W / 2 + 0.02)); });

    // ── Tuning-Teile ──
    var ctx = { s: s, W: W, L: L, lo: lo, cp: cp, cw: cw, shell: shell, front: front, rear: rear, fadd: fadd, bev: bev };
    v.parts.forEach(function (p) {
      var mat = partMat(p, paint);
      var before = { shell: shell.children.length, front: front.children.length, rear: rear.children.length };
      PART_BUILD[p.t](p, mat, ctx);
      // neu angelegte Meshes bekommen den Teilenamen (Editor: Anklicken zeigt das Teil)
      [['shell', shell], ['front', front], ['rear', rear]].forEach(function (e) {
        for (var i = before[e[0]]; i < e[1].children.length; i++) e[1].children[i].userData.part = p.t;
      });
    });

    // ── Räder ──
    [[lo.xr, v.rims.r, v.tires.r], [lo.xf, v.rims.f, v.tires.f]].forEach(function (ax) {
      var rimDef = typeof ax[1] === 'object' ? ax[1] : RIMS[ax[1]] || RIMS.star;   // Name oder Bauplan (Editor-Vorschau)
      [-1, 1].forEach(function (sd) {
        var wh = wheel(rimDef, ax[2], s.r), wz = sd * (W / 2 - ax[2].w / 2 + 0.04 + v.track);
        wh.position.set(ax[0], wh.userData.R, wz);
        wh.rotation.set(-v.camber, sd > 0 ? 0 : Math.PI, 0, 'YXZ');   // Sturz: oben nach innen
        wh.name = ax[0] === lo.xf ? 'Front wheel' : 'Rear wheel';
        body.add(wh);
      });
    });
    // Mitte des Autos in den Ursprung
    var Ht = s.H + lift;
    body.position.set(-L / 2, -Ht / 2, 0);
    car.userData.lo = { xc: lo.xc, xd: lo.xd, xf: lo.xf, xr: lo.xr };
    car.userData.W = W; car.userData.lift = lift;
    car.userData.dims = { L: L, W: W, H: Ht, belt: s.belt + lift };
    car.userData.spec = { L: s.L, H: s.H, W: W, cowl: s.cowl, belt: s.belt, chrome: s.chrome };
    return car;
  }

  // Bau der Teile in Karosserie-Koordinaten (shell: x 0 = Heck, L = Front, y ab Straße ohne Höherlegung)
  var PART_BUILD = {
    lip: function (p, mat, c) { var d = 0.08 + p.out; c.fadd(rbox(c.W * p.wid, p.h, d), mat, 0, p.y, p.out - d / 2 + 0.02); },
    splitter: function (p, mat, c) { var d = 0.1 + p.out; c.fadd(rbox(c.W * p.wid, 0.025, d), mat, 0, p.y, p.out - d / 2 + 0.02); },
    canards: function (p, mat, c) {
      [-1, 1].forEach(function (sd) {
        for (var i = 0; i < p.n; i++) {
          var m = c.fadd(rbox(p.size, 0.015, p.size * 0.6), mat, sd * (c.W / 2 - p.size / 2 + 0.03), p.y + i * 0.09, 0.02);
          m.rotation.set(p.angle, 0, sd * 0.12);
        }
      });
    },
    wing: function (p, mat, c) {
      var s = c.s, span = c.W * p.span, y = s.deck + p.height, x = p.x;
      if (p.style === 'ducktail') {
        var sh = new THREE.Shape(); sh.moveTo(x + p.chord, s.deck - 0.01); sh.lineTo(x - 0.02, s.deck - 0.01); sh.lineTo(x - 0.03, s.deck + p.height * 0.5 + 0.02); sh.closePath();
        var eg = new THREE.ExtrudeGeometry(sh, { depth: span, bevelEnabled: false }); eg.translate(0, 0, -span / 2);
        add(c.shell, eg, mat);
        return;
      }
      var bl = add(c.shell, rbox(p.chord, 0.035, span), mat, x, y, 0, 0, 0, p.angle);
      if (p.plates) [-1, 1].forEach(function (sd) { add(c.shell, rbox(p.chord * 1.15, 0.12 + p.chord * 0.2, 0.02), mat, x, y + 0.02, sd * span / 2); });
      var pz = span / 2 - Math.min(0.24, span * 0.2);
      [-1, 1].forEach(function (sd) {
        if (p.style === 'swan') {
          var top = y + 0.08, fx = x + p.chord * 0.25;
          rod(c.shell, [fx + 0.1, s.deck], [fx + 0.06, top], sd * pz, 0.03, 0.03, mat);
          rod(c.shell, [fx + 0.06, top], [fx - 0.02, y + 0.02], sd * pz, 0.03, 0.03, mat);
        } else add(c.shell, rbox(Math.min(0.14, p.chord * 0.6), p.height, 0.03), mat, x + 0.04, s.deck + p.height / 2, sd * pz);
      });
      return bl;
    },
    roof: function (p, mat, c) {
      var x = c.cp[2][0], y = c.s.H + 0.025;
      add(c.shell, rbox(p.chord, 0.025, c.cw * (1 - c.s.tumble) - 0.04), mat, x - p.chord / 2 + 0.02, y, 0, 0, 0, p.angle);
    },
    diffuser: function (p, mat, c) {
      var w = c.W * p.wid, x = p.len / 2 * Math.cos(p.angle) - c.bev, y = 0.15 + p.len / 2 * Math.sin(p.angle);
      add(c.shell, rbox(p.len, 0.02, w), mat, x, y, 0, 0, 0, -p.angle);
      for (var i = 0; i < p.fins; i++) {
        var z = p.fins > 1 ? -w / 2 + 0.03 + i * (w - 0.06) / (p.fins - 1) : 0;
        add(c.shell, rbox(p.len, p.h, 0.015), mat, x, y - p.h / 2, z, 0, 0, -p.angle);
      }
    },
    skirts: function (p, mat, c) {
      var ar = c.s.r + 0.05, x0 = c.lo.xr + ar, x1 = c.lo.xf - ar;
      [-1, 1].forEach(function (sd) { add(c.shell, rbox(x1 - x0, p.h, 0.04 + p.out), mat, (x0 + x1) / 2, 0.16 + p.h / 2 - 0.05, sd * (c.W / 2 + p.out / 2 - 0.01)); });
    },
    flares: function (p, mat, c) {
      var axles = p.axle === 'front' ? [c.lo.xf] : p.axle === 'rear' ? [c.lo.xr] : [c.lo.xr, c.lo.xf];
      axles.forEach(function (wx) {
        [-1, 1].forEach(function (sd) {
          var fl = add(c.shell, new THREE.TorusGeometry(c.s.r + 0.05 + p.thick * 0.7, p.thick, 10, 28, Math.PI), mat, wx, c.s.r, sd * (c.W / 2 - 0.01));
          fl.scale.set(1, 1, 1 + p.out * 0.85 / p.thick);
        });
      });
    },
    exhaust: function (p, mat, c) {
      var base = p.pos * c.W / 2, at = p.side === 'left' ? [-base] : p.side === 'right' ? [base] : p.side === 'both' ? [-base, base] : [0];
      at.forEach(function (x0) {
        for (var i = 0; i < p.n; i++) {
          var lx = p.n > 1 ? x0 + (i - (p.n - 1) / 2) * p.gap : x0;
          add(c.rear, new THREE.CylinderGeometry(p.d / 2, p.d / 2, p.len, 16, 1, true), mat, lx, p.y, p.len / 2 - 0.03, Math.PI / 2);
          add(c.rear, new THREE.CircleGeometry(p.d / 2 * 0.8, 16), mats().black, lx, p.y, p.len - 0.04);
        }
      });
    },
    dome: function (p, mat, c) {
      var s = c.s, ax = c.L - s.slant - 0.35, ay = s.nose + 0.06, bx = c.lo.xc, by = s.cowl;
      var t = 0.5 + p.x, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, ang = Math.atan2(by - ay, bx - ax) + Math.PI;
      var g = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(p.len / 2, p.h, p.wid / 2);
      add(c.shell, g, mat, x, y - 0.01, 0, 0, 0, ang);
    }
  };

  // je Fahrzeug einmal gebaut (Geometrie geteilt), je Farbe nur die Lack-Materialien getauscht
  // build(vehicle, color, livery): livery = stripes | race | carbon (siehe paints)
  function build(model, color, livery) {
    if (!VEHICLES[model]) model = VEHICLES.e30 ? 'e30' : MODELS[0];
    if (!CACHE[model]) CACHE[model] = buildVehicle(VEHICLES[model]);
    return paintCar(CACHE[model].clone(), model, color, livery, PAINTS);
  }
  // Vorschau eines (noch nicht gespeicherten) Aufbaus, ohne Cache
  function buildDef(def, color, livery) {
    return paintCar(buildVehicle(def), 'preview', color, livery, {});
  }
  function paintCar(car, pk0, color, livery, PAINTS) {
    var pk = pk0 + ':' + color + ':' + (livery || ''), sp = car.userData.spec;
    function recolor(m) {
      if (!m || !m.userData.isPaint) return m;
      var k = pk + ':' + m.uuid;
      if (!PAINTS[k]) {
        PAINTS[k] = m.clone();
        if (m.userData.side === 'lower' && (livery === 'stripes' || livery === 'race')) {
          // Lackierung mit echten Farben in der Textur, Material weiß
          PAINTS[k].map = lowerSideTex(sp, car.userData.lo, { bg: color, livery: livery });
        } else if (m.userData.roof && livery === 'carbon') PAINTS[k].color.copy(col(0x1a1b1e));
        else PAINTS[k].color.copy(col(color));
      }
      return PAINTS[k];
    }
    car.traverse(function (o) { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(recolor) : recolor(o.material); });
    if (livery === 'race') numberPlates(car, String(2 + Math.floor(Math.random() * 98)));
    return car;
  }
  // Startnummer als eigenes Teil auf beiden Türen (weißer Kreis, schwarze Zahl, auf beiden Seiten lesbar)
  var NUMS = {}, NUM_GEO = null;
  function numberMat(n) {
    if (NUMS[n]) return NUMS[n];
    var t = canvasTex(256, 256, function (x, w) {
      var c = w / 2; x.fillStyle = '#ffffff'; x.beginPath(); x.arc(c, c, 120, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#141414'; x.lineWidth = 10; x.beginPath(); x.arc(c, c, 112, 0, Math.PI * 2); x.stroke();
      x.fillStyle = '#141414'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '900 ' + (n.length > 1 ? 130 : 160) + 'px Arial, sans-serif';
      x.fillText(n, c, c + 8);
    });
    return (NUMS[n] = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2 }));
  }
  function numberPlates(car, n) {
    var lo = car.userData.lo, shell = car.getObjectByName('Shell'), half = car.userData.W / 2;
    var x = (lo.xc + lo.xd) / 2 + 0.1, y = 0.64;
    NUM_GEO = NUM_GEO || new THREE.CircleGeometry(0.21, 32);
    [-1, 1].forEach(function (sd) {
      var m = new THREE.Mesh(NUM_GEO, numberMat(n)); m.position.set(x, y, sd * (half + 0.015)); m.rotation.y = sd > 0 ? 0 : Math.PI;
      m.name = 'Race number'; shell.add(m);
    });
  }
  // Maße eines Fahrzeugs (für Regen und Fahrer-Ente): L, W, H (Straße bis Dach), belt (Gürtellinie ab Straße)
  function dims(model) {
    if (!VEHICLES[model]) model = MODELS[0];
    if (!CACHE[model]) CACHE[model] = buildVehicle(VEHICLES[model]);
    return CACHE[model].userData.dims;
  }
  function random() {
    var m = MODELS[Math.floor(Math.random() * MODELS.length)], p = pickPaint(m);
    return { model: m, color: p.c, livery: p.l || null };
  }

  root.ToyCars = {
    build: build, buildDef: buildDef, wheel: function (rim, tire, r0) { return wheel(rim, Object.assign({}, TIRE_DEF, tire || {}), r0 || 0.35); },
    dims: dims, has: function (k) { return !!VEHICLES[k]; }, random: random, pickPaint: pickPaint, applyCustom: applyCustom,
    normVehicle: normVehicle, normRim: normRim, normPart: normPart,
    MODELS: MODELS, VEHICLES: VEHICLES, RIMS: RIMS, BODIES: BODIES, PARTS: PARTS, PART_MATS: PART_MATS,
    RIM_STYLES: RIM_STYLES, FINISHES: FINISHES, TIRE_DEF: TIRE_DEF,
    isBuiltinVehicle: function (k) { return !!VEHICLES_BUILTIN[k]; }, isBuiltinRim: function (k) { return !!RIMS_BUILTIN[k]; },
    isCustomVehicle: function (k) { return !!CUSTOM.vehicles[k]; }, isCustomRim: function (k) { return !!CUSTOM.rims[k]; },
    builtinVehicle: function (k) { return VEHICLES_BUILTIN[k] ? clone(VEHICLES_BUILTIN[k]) : null; },
    builtinRim: function (k) { return RIMS_BUILTIN[k] ? clone(RIMS_BUILTIN[k]) : null; }
  };
})(typeof window !== 'undefined' ? window : this);
