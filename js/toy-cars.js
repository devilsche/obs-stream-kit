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

  // Karosserien: Stil von Front und Heck (lights round1 | round2 | glass, grill = schwarzer Grill quer, big = breite
  // Niere, tail round | wide | modern) und Grundform (shape, im Auto-Editor je Fahrzeug umbaubar).
  // shape (m): L Länge, W Breite, wb Radstand, fo Überhang vorn, r Radradius (Spielzeug, etwas groß),
  //   top: 10 Punkte der Oberkante im Seitenprofil, x ab Heck, y ab Straße:
  //     0 Heck oben, 1 Kofferraum, 2 Heckscheibenfuß, 3 Dach hinten, 4 Dach Mitte, 5 Dach vorn,
  //     6 Windschutzscheibenfuß, 7 Haube, 8 Haube vorn, 9 Front oben (Knicke an 2 und 6)
  //   bot: 4 Punkte der Unterkante (Heck, Schweller hinten, Schweller vorn, Front)
  //   belt: Punkte der Fensterunterkante zwischen Heckscheiben- und Windschutzscheibenfuß
  //   plan: 6 Punkte halbe Breite (Anteil von W/2) über die Länge (Draufsicht)
  //   tuck Einzug unten, sr Schulterrundung, gB Glasbreite an der Gürtellinie, gR Breite am Dach (Anteil),
  //   crown Wölbung von Dach und Haube, endR Kantenradius an Front und Heck
  // Proportionen nach Blueprints (getoutlines.com, CC BY 4.0): Glashaus an der Gürtellinie ≈ 0,78 W,
  // Dach ≈ 0,64 W, Dach als Bogen, lange flache Scheiben bei E36/E46/E92, Front in der Draufsicht gerundet
  var BODIES = {
    '2002': { label: '2002 (1966–77)', lights: 'round1', grill: true, tail: 'round', shape: {
      L: 4.23, W: 1.59, wb: 2.50, fo: 0.78, r: 0.33,
      top: [[0, 0.70], [0.30, 0.84], [0.80, 0.86], [1.25, 1.37], [1.85, 1.41], [2.55, 1.38], [2.95, 0.88], [3.6, 0.83], [4.08, 0.80], [4.23, 0.70]],
      bot: [[0, 0.32], [0.5, 0.2], [3.9, 0.2], [4.23, 0.3]], belt: [[1.9, 0.86]],
      plan: [[0, 0.86], [0.3, 0.97], [1.5, 1], [3, 1], [3.95, 0.97], [4.23, 0.86]],
      tuck: 0.9, sr: 0.1, gB: 0.86, gR: 0.72, crown: 0.05, endR: 0.1 } },
    e30: { label: 'E30 (1982–94)', lights: 'round2', grill: true, tail: 'wide', shape: {
      L: 4.32, W: 1.65, wb: 2.57, fo: 0.80, r: 0.34,
      top: [[0, 0.74], [0.3, 0.9], [0.62, 0.91], [1.15, 1.35], [1.8, 1.38], [2.35, 1.37], [3.12, 0.92], [3.7, 0.87], [4.2, 0.84], [4.32, 0.76]],
      bot: [[0, 0.3], [0.45, 0.2], [4.0, 0.2], [4.32, 0.28]], belt: [[1.9, 0.91]],
      plan: [[0, 0.9], [0.25, 0.98], [1.5, 1], [3, 1], [4.1, 0.99], [4.32, 0.9]],
      tuck: 0.93, sr: 0.05, gB: 0.8, gR: 0.66, crown: 0.03, endR: 0.06 } },
    e30m3: { label: 'E30 M3 (1986–91)', lights: 'round2', grill: true, tail: 'wide', shape: {
      L: 4.35, W: 1.68, wb: 2.56, fo: 0.82, r: 0.35,
      top: [[0, 0.78], [0.25, 0.95], [0.55, 0.95], [1.1, 1.34], [1.7, 1.37], [2.3, 1.36], [3.15, 0.93], [3.75, 0.87], [4.22, 0.82], [4.35, 0.74]],
      bot: [[0, 0.3], [0.45, 0.19], [4.0, 0.19], [4.35, 0.24]], belt: [[1.9, 0.93]],
      plan: [[0, 0.9], [0.25, 0.98], [1.5, 1], [3, 1], [4.1, 0.99], [4.35, 0.9]],
      tuck: 0.93, sr: 0.05, gB: 0.8, gR: 0.66, crown: 0.03, endR: 0.06 } },
    e36: { label: 'E36 (1990–2000)', lights: 'glass', tail: 'modern', shape: {
      L: 4.43, W: 1.71, wb: 2.70, fo: 0.83, r: 0.35,
      top: [[0, 0.74], [0.3, 0.92], [0.55, 0.93], [1.3, 1.31], [1.95, 1.34], [2.45, 1.32], [3.30, 0.88], [3.9, 0.8], [4.3, 0.72], [4.43, 0.64]],
      bot: [[0, 0.3], [0.45, 0.2], [4.05, 0.2], [4.43, 0.24]], belt: [[1.9, 0.92]],
      plan: [[0, 0.88], [0.3, 0.97], [1.5, 1], [3.2, 1], [4.15, 0.96], [4.43, 0.86]],
      tuck: 0.92, sr: 0.08, gB: 0.78, gR: 0.64, crown: 0.05, endR: 0.1 } },
    e46: { label: 'E46 (1998–2006)', lights: 'glass', big: true, tail: 'modern', shape: {
      L: 4.49, W: 1.76, wb: 2.73, fo: 0.85, r: 0.36,
      top: [[0, 0.80], [0.15, 0.99], [0.45, 1.02], [1.25, 1.32], [1.9, 1.37], [2.47, 1.33], [3.24, 0.95], [3.8, 0.88], [4.3, 0.78], [4.49, 0.68]],
      bot: [[0, 0.3], [0.45, 0.2], [4.1, 0.2], [4.49, 0.26]], belt: [[1.9, 0.98]],
      plan: [[0, 0.86], [0.25, 0.95], [1.5, 1], [3.3, 1], [4.15, 0.95], [4.49, 0.84]],
      tuck: 0.92, sr: 0.1, gB: 0.78, gR: 0.64, crown: 0.06, endR: 0.12 } },
    e92m3: { label: 'E92 M3 (2007–13)', lights: 'glass', big: true, tail: 'modern', shape: {
      L: 4.62, W: 1.80, wb: 2.76, fo: 0.90, r: 0.38,
      top: [[0, 0.84], [0.12, 0.99], [0.38, 1.02], [1.27, 1.38], [1.85, 1.42], [2.35, 1.38], [3.23, 0.98], [3.85, 0.9], [4.45, 0.78], [4.62, 0.68]],
      bot: [[0, 0.3], [0.45, 0.2], [4.2, 0.18], [4.62, 0.22]], belt: [[2.0, 0.99]],
      plan: [[0, 0.88], [0.2, 0.96], [1.5, 1], [3.3, 1], [4.15, 0.94], [4.62, 0.84]],
      tuck: 0.93, sr: 0.1, gB: 0.77, gR: 0.63, crown: 0.06, endR: 0.12 } }
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
      widen: num(v.widen, 0, -0.1, 0.4), ride: num(v.ride, 0, -0.2, 0.3), track: num(v.track, 0, -0.1, 0.3), camber: num(v.camber, 0, -0.3, 0.3),
      gap: num(v.gap, 0.05, 0, 0.3)
    };
    o.shape = normShape(v.shape, BODIES[o.body].shape);
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
  // Grundform prüfen: Zahlen begrenzen, Punktlisten mit richtiger Anzahl, x aufsteigend zwischen 0 und L
  function normShape(sh, base) {
    sh = sh && typeof sh === 'object' ? sh : {};
    var o = {
      L: num(sh.L, base.L, 3, 6.5), W: num(sh.W, base.W, 1.2, 2.6), r: num(sh.r, base.r, 0.2, 0.6),
      tuck: num(sh.tuck, base.tuck, 0.6, 1), sr: num(sh.sr, base.sr, 0, 0.3), gB: num(sh.gB, base.gB, 0.5, 1),
      gR: num(sh.gR, base.gR, 0.3, 1), crown: num(sh.crown, base.crown, 0, 0.3), endR: num(sh.endR, base.endR, 0.02, 0.3)
    };
    o.wb = num(sh.wb, base.wb, 1.6, o.L - 0.8); o.fo = num(sh.fo, base.fo, 0.3, o.L - o.wb - 0.3);
    o.gR = Math.min(o.gR, o.gB - 0.02);
    function list(a, b, n0, n1, scale) {
      var ok = Array.isArray(a) && a.length >= n0 && a.length <= n1 && a.every(function (p) { return Array.isArray(p) && p.length === 2 && isFinite(p[0]) && isFinite(p[1]); });
      return (ok ? a : b.map(function (p) { return [p[0] * scale, p[1]]; })).map(function (p) { return [+p[0], +p[1]]; });
    }
    var k = o.L / base.L;
    o.top = list(sh.top, base.top, 10, 10, k); o.bot = list(sh.bot, base.bot, 4, 4, k);
    o.plan = list(sh.plan, base.plan, 6, 6, k); o.belt = list(sh.belt, base.belt, 1, 6, k);
    [o.top, o.bot, o.plan].forEach(function (a) {
      a[0][0] = 0; a[a.length - 1][0] = o.L;
      for (var i = 1; i < a.length - 1; i++) a[i][0] = Math.max(a[i - 1][0] + 0.01, Math.min(o.L - 0.01 * (a.length - 1 - i), a[i][0]));
    });
    o.top.forEach(function (p) { p[1] = Math.max(0.25, Math.min(2.6, p[1])); });
    o.bot.forEach(function (p) { p[1] = Math.max(0.05, Math.min(0.8, p[1])); });
    o.plan.forEach(function (p) { p[1] = Math.max(0.3, Math.min(1.1, p[1])); });
    o.belt.sort(function (a, b) { return a[0] - b[0]; });
    o.belt.forEach(function (p) { p[0] = Math.max(o.top[2][0] + 0.02, Math.min(o.top[6][0] - 0.02, p[0])); p[1] = Math.max(0.3, Math.min(2.4, p[1])); });
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
    MAT.clear = phys({ color: 0xffffff, roughness: 0.02, metalness: 0, transmission: 0, transparent: true, opacity: 0.22, clearcoat: 1, envMapIntensity: 1.6 });
    MAT.well = new THREE.MeshStandardMaterial({ color: col(0x0c0d10), roughness: 0.9, side: THREE.DoubleSide });
    return MAT;
  }
  // ── Karosserie ──
  // Kurve durch Punkte (Catmull-Rom), nPer Schritte je Abschnitt (Zahl oder Liste), Knicke an sharp
  function curveN(P, nPer, sharp) {
    sharp = sharp || [];
    var out = [P[0].slice()];
    for (var i = 0; i < P.length - 1; i++) {
      var p1 = P[i], p2 = P[i + 1], p0 = i > 0 && sharp.indexOf(i) < 0 ? P[i - 1] : p1, p3 = i + 2 < P.length && sharp.indexOf(i + 1) < 0 ? P[i + 2] : p2;
      var n = typeof nPer === 'number' ? nPer : nPer[i];
      for (var k = 1; k <= n; k++) {
        var t = k / n, t2 = t * t, t3 = t2 * t, q = [];
        for (var c = 0; c < 2; c++) q.push(0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
        out.push(q);
      }
    }
    return out;
  }
  // y einer nach x laufenden Polylinie an der Stelle x (Rückläufer der Kurve werden übersprungen)
  function mono(poly) { var o = [poly[0]]; for (var i = 1; i < poly.length; i++) if (poly[i][0] > o[o.length - 1][0] + 1e-6) o.push(poly[i]); return o; }
  function at(poly, x) {
    if (x <= poly[0][0]) return poly[0][1];
    for (var i = 1; i < poly.length; i++) if (x <= poly[i][0]) { var a = poly[i - 1], b = poly[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    return poly[poly.length - 1][1];
  }
  // Querschnitt: 10 Stützpunkte K0 (unten Mitte) … K9 (oben Mitte), [z, y]; feiner im Bereich der Seitenscheiben
  var SEG_N = [2, 2, 2, 3, 2, 2, 6, 3, 3];
  var SEG_OF = (function () { var o = []; SEG_N.forEach(function (n, s) { for (var k = 0; k < n; k++) o.push(s); }); o.push(8); return o; })();
  var NH = SEG_OF.length;            // Punkte je halbem Querschnitt
  // Form vorbereiten: abgetastete Kurven + Hilfsfunktionen (alles in Karosserie-Koordinaten, x 0 = Heck)
  function prepShape(S, W) {
    var top = mono(curveN(S.top, 10, [2, 6])), bot = mono(curveN(S.bot, 10)), plan = mono(curveN(S.plan, 10));
    var bp = [[S.top[2][0], S.top[2][1]]].concat(S.belt, [[S.top[6][0], S.top[6][1]]]), belt = mono(curveN(bp, 8));
    var P = {
      S: S, W: W, L: S.L,
      topAt: function (x) { return at(top, Math.max(0, Math.min(S.L, x))); },
      botAt: function (x) { return at(bot, Math.max(0, Math.min(S.L, x))); },
      hwAt: function (x) { return at(plan, Math.max(0, Math.min(S.L, x))) * W / 2; },
      beltAt: function (x) {
        var yt = P.topAt(x);
        return x > S.top[2][0] && x < S.top[6][0] ? Math.min(yt, at(belt, x)) : yt;
      }
    };
    return P;
  }
  // halber Querschnitt an der Stelle x; d = Einzug an den gerundeten Enden
  function section(P, x, d) {
    var S = P.S, yb = P.botAt(x), yt = P.topAt(x), hw = P.hwAt(x), bl = P.beltAt(x), mid = (yb + yt) / 2;
    if (d) { hw = Math.max(0.05, hw - d); yt = Math.max(mid + 0.02, yt - d); yb = Math.min(mid - 0.02, yb + d); }
    bl = Math.max(yb + 0.06, Math.min(bl, yt));
    var c1 = S.crown * hw * S.gR, sTop = Math.max(yb + 0.05, Math.min(bl, yt - c1)), sr = Math.min(S.sr, (sTop - yb) * 0.3, hw * 0.3);
    var lift0 = Math.min(0.08, (sTop - yb) * 0.2), zg = Math.min(hw * S.gB, hw - sr * 0.6), zr = Math.min(hw * S.gR, zg - 0.01);
    var K = [[0, yb], [hw * S.tuck, yb], [hw * (1 - (1 - S.tuck) * 0.3), yb + lift0], [hw, yb + (sTop - yb) * 0.45], [hw, sTop - sr],
      [hw - sr * 0.4, sTop - sr * 0.1], [zg, sTop], [zr, Math.max(sTop, yt - c1)], [zr * 0.5, Math.max(sTop, yt - c1 * 0.25)], [0, Math.max(sTop, yt)]];
    return curveN(K, SEG_N, [6]);
  }
  function inPoly(pt, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function segDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  // Karosserie als eine glatte Fläche aus Querschnitten (Material-Gruppen: 0 Lack, 1 Glas, 2 Zierleiste, 3 Dach)
  // arches: [{ x, y, a }] Radläufe (Ausschnitt), seams: x der Türfugen (echte Rillen)
  function bodyGeo(P, arches, seams, win) {
    var S = P.S, L = S.L, r = S.endR, xs = [], i, j;
    for (i = 0; i <= 60; i++) xs.push(L * i / 60);
    arches.forEach(function (A) {
      [-1, -0.85, -0.6, -0.3, 0, 0.3, 0.6, 0.85, 1].forEach(function (f) { xs.push(A.x + f * A.a); });
      xs.push(A.x - A.a - 0.004, A.x + A.a + 0.004);
    });
    seams.forEach(function (x) { xs.push(x - 0.014, x, x + 0.014); });
    S.top.forEach(function (p) { xs.push(p[0]); });
    xs = xs.filter(function (x) { return x >= 0 && x <= L; }).sort(function (a, b) { return a - b; });
    xs = xs.filter(function (x, k) { return !k || x - xs[k - 1] > 0.002; });
    // gerundete Enden: Stationen hinter dem Heck und vor der Front mit Einzug
    var st = xs.map(function (x) { return { x: x, d: 0 }; });
    for (i = 1; i <= 4; i++) {
      var th = i / 4 * Math.PI / 2;
      st.unshift({ x: -r * Math.sin(th), d: r * (1 - Math.cos(th)), at: 0 });
      st.push({ x: L + r * Math.sin(th), d: r * (1 - Math.cos(th)), at: L });
    }
    var M = 2 * (NH - 1), pos = [], uv = [], rings = [];
    st.forEach(function (o) {
      var h = section(P, o.at != null ? o.at : o.x, o.d), ring = [];
      var isSeam = o.at == null && seams.some(function (x) { return Math.abs(o.x - x) < 0.001; });
      for (j = 0; j < M; j++) {
        var p = j < NH ? j : M - j, sd = j < NH ? 1 : -1, z = h[p][0], y = h[p][1];
        // Radlauf: Flanke über dem Rad zum Bogen hochziehen
        if (o.at == null && p >= 1 && p <= 9) arches.forEach(function (A) {
          var dx = o.x - A.x;
          if (Math.abs(dx) < A.a) { var ya = A.y + Math.sqrt(A.a * A.a - dx * dx); if (y < ya) y = ya; }
        });
        // Türfuge: schmale Rille in der Flanke
        if (isSeam && p >= 3 && p <= 11 && y > h[0][1] + 0.08 && y < P.beltAt(o.x) - 0.02 &&
          !arches.some(function (A) { return Math.abs(o.x - A.x) < A.a + 0.02; })) z -= 0.012;
        pos.push(o.x, y, sd * z); uv.push(o.x, y); ring.push(p);
      }
      rings.push(ring);
    });
    var idx = [[], [], [], []], ns = st.length;
    function V(a, b) { return a * M + b; }
    for (i = 0; i < ns - 1; i++) for (j = 0; j < M; j++) {
      var j1 = (j + 1) % M, a = V(i, j), b = V(i + 1, j), c = V(i + 1, j1), dd = V(i, j1);
      var pq = Math.min(rings[i][j], rings[i][j1]), seg = SEG_OF[pq];
      var xm = (st[i].x + st[i + 1].x) / 2, ym = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[dd * 3 + 1]) / 4, g = 0;
      var inside = st[i].at == null && st[i + 1].at == null;
      if (inside && seg === 6) {
        if (inPoly([xm, ym], win.side)) g = Math.abs(xm - win.bx) < 0.035 ? 2 : 1;
        else if (win.side.some(function (q, k) { return segDist([xm, ym], q, win.side[(k + 1) % win.side.length]) < 0.03; })) g = 2;
      } else if (inside && seg >= 7) {
        if ((xm > S.top[5][0] && xm < S.top[6][0]) || (xm > S.top[2][0] && xm < S.top[3][0])) g = 1;
        else if (xm >= S.top[3][0] && xm <= S.top[5][0]) g = 3;
      }
      idx[g].push(a, b, dd, b, c, dd);
    }
    // Kappen vorn und hinten (flach)
    [0, ns - 1].forEach(function (k) {
      var cx = 0, cy = 0;
      for (j = 0; j < M; j++) { cx += pos[V(k, j) * 3]; cy += pos[V(k, j) * 3 + 1]; }
      var ci = pos.length / 3; pos.push(cx / M, cy / M, 0); uv.push(cx / M, cy / M);
      for (j = 0; j < M; j++) { var j1 = (j + 1) % M; if (k) idx[0].push(ci, V(k, j1), V(k, j)); else idx[0].push(ci, V(k, j), V(k, j1)); }
    });
    var geo = new THREE.BufferGeometry(), all = [], start = 0;
    idx.forEach(function (l, m) { if (l.length) geo.addGroup(start, l.length, m); start += l.length; all = all.concat(l); });
    geo.setIndex(all);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
  }
  // Radhaus innen: dunkler Halbtunnel über dem Rad
  function wellGeo(A, hw) {
    var pos = [], idx = [], n = 16;
    for (var k = 0; k <= n; k++) {
      var t = k / n * Math.PI, x = A.x + Math.cos(t) * A.a, y = A.y + Math.sin(t) * A.a;
      pos.push(x, y, -hw, x, y, hw);
      if (k) { var b = (k - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    var g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    return g;
  }
  // Lackierung mit Rennstreifen (stripes/race) als Farbtextur, in Seitenprojektion (uv = x, y in m)
  function liveryTex(L, H, opt) {
    var W = 1024, Hh = 512;
    function X(x) { return x / L * W; }
    var t = canvasTex(W, Hh, function (x, w, h) {
      function YY(y) { return (1 - y / H) * h; }
      x.fillStyle = hexStr(opt.bg); x.fillRect(0, 0, w, h);
      // drei Rennstreifen (hellblau, dunkelblau, rot) über die Flanke, vorn schräg angeschnitten
      [['#5bb3e6', 0.47], ['#1f2a8a', 0.41], ['#d8231e', 0.35]].forEach(function (st) {
        var y0 = st[1], hgt = 0.05, x0 = 0.3, x1 = L - 0.45;
        x.fillStyle = st[0]; x.beginPath(); x.moveTo(X(x0), YY(y0 + hgt)); x.lineTo(X(x1 - 0.05), YY(y0 + hgt)); x.lineTo(X(x1 + 0.12), YY(y0 + hgt + 0.18)); x.lineTo(X(x1 + 0.17), YY(y0 + 0.18)); x.lineTo(X(x1), YY(y0)); x.lineTo(X(x0), YY(y0)); x.closePath(); x.fill();
      });
    });
    t.repeat.set(1 / L, 1 / H);
    return t;
  }
  // abgerundetes Rechteck als Fläche (Mitte 0,0), für Lampen, Niere, Blinker
  function rrect(w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    var s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  // flacher Körper mit gerundeten Kanten (Tiefe d nach +z)
  function pill(w, h, d, r) {
    var b = Math.min(d * 0.45, 0.012);
    var g = new THREE.ExtrudeGeometry(rrect(w - 2 * b, h - 2 * b, r), { depth: Math.max(0.002, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 6 });
    g.translate(0, 0, b);
    return g;
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
    var v = normVehicle(vd), bk = v.body, B = BODIES[bk], S = v.shape, M = mats();
    var W = S.W + v.widen, L = S.L, chrome = v.bumpers === 'chrome', P = prepShape(S, W);
    var paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 });
    paint.userData.isPaint = true; paint.userData.side = 'lower';
    var roof = paint.clone(); roof.userData.roof = true; roof.userData.side = null;
    var trim = chrome ? M.chrome : M.black;
    var car = new THREE.Group(), body = new THREE.Group(), shell = new THREE.Group(); car.add(body);
    shell.name = 'Shell'; body.add(shell);
    var xr = L - S.wb - S.fo, xf = xr + S.wb, r = S.endR;
    // Räder: Mitte auf Höhe des Reifenradius; die Karosserie hebt sich mit größeren Rädern und Tieferlegung,
    // die Radläufe wachsen mit dem Reifen der jeweiligen Achse (Mitte = Radmitte, Luft = gap)
    var Rf = S.r * v.tires.f.d, Rrr = S.r * v.tires.r.d, lift = (Rf + Rrr) / 2 - S.r + v.ride;
    // Radlauf darf nicht durch Haube bzw. Kofferraum stoßen: dann sitzt die Karosserie höher (Monstertruck)
    lift = Math.max(lift, 2 * Rf + v.gap - (P.topAt(xf) - 0.08), 2 * Rrr + v.gap - (P.topAt(xr) - 0.1));
    shell.position.y = lift;
    function arch(x, R) {
      var a = Math.min(R + v.gap, x - 0.12, L - x - 0.12, S.wb / 2 - 0.05);
      return { x: x, y: Math.max(P.botAt(x) + 0.01, R - lift), a: a };
    }
    var arches = [arch(xr, Rrr), arch(xf, Rf)];
    var xc = S.top[6][0], xd = S.top[2][0], cowl = S.top[6][1], deck = P.topAt(0.3), nose = S.top[9][1];
    var H = Math.max.apply(null, S.top.map(function (p) { return p[1]; }));
    // Türen: Fuge vorn kurz hinter dem Radlauf, hinten unter dem Hofmeister-Knick
    var d0 = Math.min(xc - 0.05, xf - arches[1].a - 0.06), d1 = xd + 0.25;
    // Seitenfenster mit Hofmeister-Knick
    function bAt(x) { return P.beltAt(x); }
    var fA = [xc - 0.1, bAt(xc - 0.1) + 0.03], fT = [S.top[5][0] - 0.08, P.topAt(S.top[5][0] - 0.08) - 0.06];
    var rT = [S.top[3][0] + 0.08, P.topAt(S.top[3][0] + 0.08) - 0.06], kink = [xd + 0.2, bAt(xd + 0.2) + 0.18], kb = [xd + 0.5, bAt(xd + 0.5) + 0.03];
    var win = { side: [fA, fT, rT, kink, kb], bx: (fA[0] + kink[0]) / 2 + 0.05 };
    var bg = bodyGeo(P, arches, [d0, d1], win);
    add(shell, bg, [paint, M.glass, trim, roof]).name = 'Body';
    arches.forEach(function (A) { add(shell, wellGeo(A, P.hwAt(A.x) - 0.03), M.well); });

    // ── Front (x = L + Kantenradius) ──
    var hwF = P.hwAt(L) - r, ytF = P.topAt(L);
    function frontX(y) {
      var yr = ytF - r;
      if (y <= yr) return L + r;
      var dy = Math.min(r, y - yr); return L + Math.sqrt(Math.max(0, r * r - dy * dy));
    }
    var yl = Math.min(nose - 0.19, ytF - r - 0.06);
    var front = new THREE.Group(); front.position.set(L + r, 0, 0); front.rotation.y = Math.PI / 2; shell.add(front);   // lokal: x quer, y hoch, +z nach vorn
    function fadd(geo, mat, lx, y, dz) { return add(front, geo, mat, lx, y, frontX(y) - front.position.x + (dz || 0)); }
    var kw = B.big ? 0.22 : 0.15, kh = B.big ? 0.26 : bk === 'e36' ? 0.24 : 0.3, ex = Math.min(W / 2 - 0.3, hwF - 0.2);
    if (B.grill) {
      fadd(pill(Math.min(W - 0.2, 2 * hwF - 0.04), 0.26, 0.03, 0.03), M.black, 0, yl, -0.02);   // schwarzer Grill quer
      for (var gs = 0; gs < 4; gs++) fadd(rbox(Math.min(W - 0.24, 2 * hwF - 0.08), 0.012, 0.02), M.chrome, 0, yl - 0.09 + gs * 0.06, 0.012);
    }
    [-1, 1].forEach(function (sd) {
      // Doppelniere: Chromrahmen, vertieftes schwarzes Gitter mit senkrechten Stäben
      var kx = sd * (kw / 2 + 0.035), ky = yl + 0.03;
      var ring = new THREE.Shape(); ring.copy(rrect(kw + 0.05, kh + 0.05, 0.06)); ring.holes.push(rrect(kw, kh, 0.045));
      fadd(new THREE.ExtrudeGeometry(ring, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 6 }), M.chrome, kx, ky, 0.0);
      fadd(new THREE.ShapeGeometry(rrect(kw, kh, 0.045)), M.black, kx, ky, -0.015);
      for (var b = 1; b < 4; b++) fadd(rbox(0.01, kh - 0.03, 0.02), M.chrome, kx - kw / 2 + b * kw / 4, ky, -0.006);
      // Scheinwerfer: Chromring, Reflektor-Schüssel, Birne, gewölbtes Glas
      function lamp(lx, ly, rad, dz) {
        fadd(new THREE.TorusGeometry(rad, rad * 0.14, 8, 28), M.chrome, lx, ly, dz + 0.01);
        var refl = new THREE.LatheGeometry([new THREE.Vector2(0.001, -rad * 0.6), new THREE.Vector2(rad * 0.5, -rad * 0.45), new THREE.Vector2(rad * 0.95, 0)], 24); refl.rotateX(Math.PI / 2);
        fadd(refl, M.chrome, lx, ly, dz);
        fadd(new THREE.SphereGeometry(rad * 0.18, 12, 8), M.lamp, lx, ly, dz - rad * 0.3);
        var lens = new THREE.SphereGeometry(rad * 1.6, 24, 6, 0, Math.PI * 2, 0, 0.62); lens.rotateX(Math.PI / 2); lens.translate(0, 0, -rad * 1.6 * Math.cos(0.62));
        fadd(lens, M.clear, lx, ly, dz + 0.004);
      }
      if (B.lights === 'round1') lamp(sd * ex, yl, 0.13, 0.0);
      else if (B.lights === 'round2') [0, 1].forEach(function (k) { lamp(sd * (ex + 0.07 - (1 - k) * 0.22), yl, 0.088, 0.0); });
      else {
        // Scheinwerfer unter Glas: Gehäuse, zwei Reflektoren, auf Wunsch helle Leuchtringe
        fadd(pill(0.5, 0.22, 0.03, 0.05), M.black, sd * (ex - 0.02), yl + 0.02, -0.025);
        [0, 1].forEach(function (k) {
          var cx = sd * (ex - 0.02) + (k ? 0.115 : -0.115);
          var refl = new THREE.LatheGeometry([new THREE.Vector2(0.001, -0.03), new THREE.Vector2(0.035, -0.025), new THREE.Vector2(0.075, 0)], 20); refl.rotateX(Math.PI / 2);
          fadd(refl, M.chrome, cx, yl + 0.02, 0.0);
          fadd(new THREE.SphereGeometry(0.02, 10, 6), M.lamp, cx, yl + 0.02, -0.01);
          if (v.rings) fadd(new THREE.TorusGeometry(0.075, 0.013, 8, 32), M.ring, cx, yl + 0.02, 0.004);
        });
        fadd(pill(0.52, 0.24, 0.02, 0.06), M.clear, sd * (ex - 0.02), yl + 0.02, 0.0);
      }
      fadd(pill(0.16, 0.06, 0.025, 0.02), M.amber, sd * Math.min(W / 2 - 0.26, hwF - 0.1), 0.36, 0.0);   // Blinker unten
    });
    fadd(rbox(0.46, 0.12, 0.012), M.plate, 0, 0.3, 0.07);                                    // Kennzeichenfeld (leer)
    // Stoßstange vorn: gerundeter Balken (Chrom mit Gummileiste, schwarz oder Wagenfarbe)
    var bwF = Math.min(W + 0.04, 2 * hwF + 2 * r + 0.04);
    if (chrome) { fadd(pill(bwF, 0.11, 0.1, 0.045), M.chrome, 0, 0.42, 0.02); fadd(pill(bwF + 0.01, 0.03, 0.105, 0.012), M.black, 0, 0.42, 0.022); }
    else fadd(pill(bwF - 0.06, 0.18, 0.08, 0.05), v.bumpers === 'paint' ? paint : M.black, 0, 0.24, -0.02);
    // ── Heck (x = −Kantenradius) ──
    var hwR = P.hwAt(0) - r, ytR = P.topAt(0);
    var rear = new THREE.Group(); rear.position.set(-r - 0.002, 0, 0); rear.rotation.y = -Math.PI / 2; shell.add(rear);
    var yt = Math.min(deck - 0.2, ytR - r - 0.1), tx = Math.min(W / 2 - 0.32, hwR - 0.26);
    [-1, 1].forEach(function (sd) {
      if (B.tail === 'round') { add(rear, new THREE.CylinderGeometry(0.11, 0.11, 0.03, 24), M.tail, sd * tx, yt, 0.012, Math.PI / 2); add(rear, new THREE.TorusGeometry(0.11, 0.012, 6, 24), M.chrome, sd * tx, yt, 0.028); }
      else if (B.tail === 'wide') { add(rear, pill(0.5, 0.2, 0.03, 0.03), M.tail, sd * tx, yt, 0); add(rear, pill(0.15, 0.2, 0.032, 0.03), M.amber, sd * (tx - 0.34), yt, 0); }
      else { add(rear, pill(0.46, 0.17, 0.035, 0.05), M.tail, sd * tx, yt + 0.02, 0); add(rear, pill(0.2, 0.05, 0.037, 0.02), M.lamp, sd * tx, yt - 0.02, 0); }
    });
    add(rear, rbox(0.42, 0.11, 0.012), M.plate, 0, yt - 0.06, 0.006);
    var bwR = Math.min(W + 0.02, 2 * hwR + 2 * r + 0.02);
    if (chrome) add(rear, pill(bwR, 0.08, 0.09, 0.035), M.chrome, 0, 0.42, 0);
    else add(rear, pill(bwR - 0.04, 0.18, 0.06, 0.05), v.bumpers === 'paint' ? paint : M.black, 0, 0.27, 0);
    // ── Seite: Spiegel, Türgriffe, Seitenblinker, Schutzleiste (alles echte Teile) ──
    [-1, 1].forEach(function (sd) {
      var mx = xc + 0.08, my = bAt(mx) + 0.1, mz = P.hwAt(mx) * S.gB + 0.04;
      var hous = new THREE.SphereGeometry(1, 16, 10); hous.scale(0.07, 0.055, 0.1);
      add(shell, hous, paint, mx, my, sd * (mz + 0.08));
      add(shell, new THREE.CircleGeometry(0.045, 16), M.glass, mx - 0.068, my, sd * (mz + 0.08), 0, -Math.PI / 2);
      add(shell, rbox(0.04, 0.025, 0.08), M.black, mx + 0.01, my - 0.02, sd * (mz + 0.02));
      var hx = d1 + 0.2, hy = bAt(hx) - 0.12;
      add(shell, pill(0.13, 0.03, 0.02, 0.012), trim, hx, hy, sd * (P.hwAt(hx) - 0.004), 0, sd > 0 ? 0 : Math.PI);
      var bx = xf + Math.min(0.42, arches[1].a + 0.08);
      add(shell, pill(0.07, 0.035, 0.012, 0.012), M.amber, bx, 0.6, sd * (P.hwAt(bx) - 0.002), 0, sd > 0 ? 0 : Math.PI);
      // Schutzleiste zwischen den Radläufen, folgt der Flanke
      var x0 = xr + arches[0].a + 0.05, x1 = xf - arches[1].a - 0.05, pts = [];
      for (var k = 0; k <= 8; k++) { var x = x0 + (x1 - x0) * k / 8; pts.push(new THREE.Vector3(x, 0.5, sd * (P.hwAt(x) + 0.004))); }
      var strip = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.018, 6, false); strip.scale(1, 1.4, 1);
      strip.translate(0, -0.5 * 0.4, 0);
      add(shell, strip, trim);
    });

    // ── Tuning-Teile ──
    var cp = [[xc, cowl], S.top[5].slice(), S.top[3].slice(), [xd, S.top[2][1]]];
    var ctx = { s: { r: S.r, H: H, deck: deck, nose: nose, cowl: cowl, slant: 0 }, P: P, W: W, L: L, lo: { xr: xr, xf: xf, xc: xc, xd: xd, arch: { r: arches[0], f: arches[1] } },
      cp: cp, cw: 2 * P.hwAt(S.top[3][0]) * S.gR, shell: shell, front: front, rear: rear, fadd: fadd, bev: r };
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
    [[xr, v.rims.r, v.tires.r], [xf, v.rims.f, v.tires.f]].forEach(function (ax) {
      var rimDef = typeof ax[1] === 'object' ? ax[1] : RIMS[ax[1]] || RIMS.star;   // Name oder Bauplan (Editor-Vorschau)
      [-1, 1].forEach(function (sd) {
        var wh = wheel(rimDef, ax[2], S.r), wz = sd * (P.hwAt(ax[0]) - ax[2].w / 2 + 0.04 + v.track);
        wh.position.set(ax[0], wh.userData.R, wz);
        wh.rotation.set(-v.camber, sd > 0 ? 0 : Math.PI, 0, 'YXZ');   // Sturz: oben nach innen
        wh.name = ax[0] === xf ? 'Front wheel' : 'Rear wheel';
        body.add(wh);
      });
    });
    // Mitte des Autos in den Ursprung
    var Ht = H + lift, beltMid = bAt((xd + xc) / 2);
    body.position.set(-L / 2, -Ht / 2, 0);
    car.userData.lo = { xc: xc, xd: xd, xf: xf, xr: xr };
    car.userData.W = W; car.userData.lift = lift;
    car.userData.dims = { L: L, W: W, H: Ht, belt: beltMid + lift };
    car.userData.spec = { L: L, H: H };
    car.userData.numHalf = P.hwAt((xc + xd) / 2 + 0.1);   // Flanke an der Startnummer (userData wird beim Klonen kopiert, keine Funktionen)
    return car;
  }

  // Bau der Teile in Karosserie-Koordinaten (shell: x 0 = Heck, L = Front, y ab Straße ohne Höherlegung)
  var PART_BUILD = {
    lip: function (p, mat, c) { var d = 0.08 + p.out; c.fadd(pill(c.W * p.wid, p.h, d, Math.min(p.h / 2, 0.03)), mat, 0, p.y, p.out - d); },
    splitter: function (p, mat, c) { var d = 0.1 + p.out; c.fadd(pill(c.W * p.wid, 0.025, d, 0.012), mat, 0, p.y, p.out - d); },
    canards: function (p, mat, c) {
      [-1, 1].forEach(function (sd) {
        for (var i = 0; i < p.n; i++) {
          var m = c.fadd(rbox(p.size, 0.015, p.size * 0.6), mat, sd * (c.P.hwAt(c.L) - p.size / 2 + 0.06), p.y + i * 0.09, -0.02);
          m.rotation.set(p.angle, 0, sd * 0.12);
        }
      });
    },
    wing: function (p, mat, c) {
      var span = c.W * p.span, x = p.x, deck = c.P.topAt(x), y = deck + p.height;
      if (p.style === 'ducktail') {
        var sh = new THREE.Shape(); sh.moveTo(x + p.chord, c.P.topAt(x + p.chord) - 0.01); sh.lineTo(x - 0.02, deck - 0.01); sh.lineTo(x - 0.03, deck + p.height * 0.5 + 0.02); sh.closePath();
        var eg = new THREE.ExtrudeGeometry(sh, { depth: span, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 }); eg.translate(0, 0, -span / 2);
        add(c.shell, eg, mat);
        return;
      }
      // Flügelblatt mit Tragflächen-Profil
      var foil = new THREE.Shape(), ch = p.chord;
      foil.moveTo(ch / 2, 0); foil.quadraticCurveTo(0.1 * ch, 0.06 * ch + 0.02, -ch / 2, 0.012); foil.lineTo(-ch / 2, -0.004); foil.quadraticCurveTo(0, -0.01, ch / 2, 0);
      var fg = new THREE.ExtrudeGeometry(foil, { depth: span, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 2, curveSegments: 10 });
      fg.translate(0, 0, -span / 2);
      var bl = add(c.shell, fg, mat, x, y, 0, 0, 0, p.angle);
      if (p.plates) [-1, 1].forEach(function (sd) { add(c.shell, pill(p.chord * 1.15, 0.12 + p.chord * 0.2, 0.02, 0.03), mat, x, y + 0.02, sd * span / 2 - (sd > 0 ? 0 : 0.02)); });
      var pz = span / 2 - Math.min(0.24, span * 0.2);
      [-1, 1].forEach(function (sd) {
        if (p.style === 'swan') {
          var top = y + 0.08, fx = x + p.chord * 0.25;
          rod(c.shell, [fx + 0.1, c.P.topAt(fx + 0.1)], [fx + 0.06, top], sd * pz, 0.03, 0.03, mat);
          rod(c.shell, [fx + 0.06, top], [fx - 0.02, y + 0.02], sd * pz, 0.03, 0.03, mat);
        } else { var px = x + 0.04, py = c.P.topAt(px); add(c.shell, rbox(Math.min(0.14, p.chord * 0.6), y - py, 0.03), mat, px, (y + py) / 2, sd * pz); }
      });
      return bl;
    },
    roof: function (p, mat, c) {
      var x = c.cp[2][0], y = c.cp[2][1] + 0.02;
      add(c.shell, pill(p.chord, 0.025, c.cw - 0.04, 0.01), mat, x - p.chord / 2 + 0.02, y, -(c.cw - 0.04) / 2, 0, 0, p.angle);
    },
    diffuser: function (p, mat, c) {
      var w = c.W * p.wid, x = p.len / 2 * Math.cos(p.angle) - c.bev, y = c.P.botAt(0.4) - 0.04 + p.len / 2 * Math.sin(p.angle);
      add(c.shell, rbox(p.len, 0.02, w), mat, x, y, 0, 0, 0, -p.angle);
      for (var i = 0; i < p.fins; i++) {
        var z = p.fins > 1 ? -w / 2 + 0.03 + i * (w - 0.06) / (p.fins - 1) : 0;
        add(c.shell, rbox(p.len, p.h, 0.015), mat, x, y - p.h / 2, z, 0, 0, -p.angle);
      }
    },
    skirts: function (p, mat, c) {
      var x0 = c.lo.xr + c.lo.arch.r.a, x1 = c.lo.xf - c.lo.arch.f.a, xm = (x0 + x1) / 2;
      [-1, 1].forEach(function (sd) { add(c.shell, pill(x1 - x0, p.h, 0.04 + p.out, Math.min(p.h / 2, 0.03)), mat, xm, c.P.botAt(xm) + p.h / 2 - 0.05, sd * (c.P.hwAt(xm) - 0.03) - (sd > 0 ? 0 : 0.04 + p.out), 0, 0, 0); });
    },
    flares: function (p, mat, c) {
      var axles = p.axle === 'front' ? ['f'] : p.axle === 'rear' ? ['r'] : ['r', 'f'];
      axles.forEach(function (k) {
        var A = c.lo.arch[k];
        [-1, 1].forEach(function (sd) {
          var fl = add(c.shell, new THREE.TorusGeometry(A.a + p.thick * 0.7, p.thick, 10, 28, Math.PI), mat, A.x, A.y, sd * (c.P.hwAt(A.x) - 0.01));
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
          add(c.rear, new THREE.TorusGeometry(p.d / 2, 0.006, 6, 16), mat, lx, p.y, p.len - 0.03);
          add(c.rear, new THREE.CircleGeometry(p.d / 2 * 0.95, 16), mats().black, lx, p.y, p.len - 0.06);
        }
      });
    },
    dome: function (p, mat, c) {
      var ax = c.L - 0.3, bx = c.lo.xc + 0.05, t = 0.5 + p.x, x = ax + (bx - ax) * t, y = c.P.topAt(x);
      var ang = Math.atan2(c.P.topAt(x + 0.1) - c.P.topAt(x - 0.1), 0.2);
      var g = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(p.len / 2, p.h, p.wid / 2);
      add(c.shell, g, mat, x, y - 0.012, 0, 0, 0, ang);
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
          PAINTS[k].map = liveryTex(sp.L, sp.H, { bg: color });
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
    var lo = car.userData.lo, shell = car.getObjectByName('Shell'), half = car.userData.numHalf;
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
    normVehicle: normVehicle, normRim: normRim, normPart: normPart, normShape: normShape,
    curve: function (pts, n, sharp) { return curveN(pts, n, sharp); },
    MODELS: MODELS, VEHICLES: VEHICLES, RIMS: RIMS, BODIES: BODIES, PARTS: PARTS, PART_MATS: PART_MATS,
    RIM_STYLES: RIM_STYLES, FINISHES: FINISHES, TIRE_DEF: TIRE_DEF,
    isBuiltinVehicle: function (k) { return !!VEHICLES_BUILTIN[k]; }, isBuiltinRim: function (k) { return !!RIMS_BUILTIN[k]; },
    isCustomVehicle: function (k) { return !!CUSTOM.vehicles[k]; }, isCustomRim: function (k) { return !!CUSTOM.rims[k]; },
    builtinVehicle: function (k) { return VEHICLES_BUILTIN[k] ? clone(VEHICLES_BUILTIN[k]) : null; },
    builtinRim: function (k) { return RIMS_BUILTIN[k] ? clone(RIMS_BUILTIN[k]) : null; }
  };
})(typeof window !== 'undefined' ? window : this);
