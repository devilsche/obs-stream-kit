// PUBG POI-Lookup: laedt Polygon-Regionen aus /api/pubg/pois zur
// Render-Zeit. Smallest-area-wins bei verschachtelten Regionen.
//
// Welt-Koordinaten in cm (1m = 100 cm). Regionen sind Polygone als
// Punkt-Liste [[x, y], ...]. Ein Polygon ohne Namen ('') gibt 'null'
// zurueck = kein Label im Tooltip.
//
// Pin-Lookup ist async: erste fromCoords-Aufrufe vor dem ready-Promise
// geben null zurueck. Konsumer sollten 'await PubgUI.POI.ready' bevor
// sie ihre Tooltips rendern, dann zweite Render-Pass.
(function () {
  if (!window.PubgUI) window.PubgUI = {};
  const POI = window.PubgUI.POI = {};

  // Map-Groesse-Fallback (wird vom Server-Response ueberschrieben).
  const MAP_SIZE_KM_FALLBACK = {
    "Baltic_Main":     8, "Erangel_Main":   8,
    "Desert_Main":     8, "Savage_Main":    4,
    "DihorOtok_Main":  8, "Tiger_Main":     8,
    "Kiki_Main":       8, "Neon_Main":      8,
    "Chimera_Main":    3, "Summerland_Main":2,
    "Heaven_Main":     1, "Range_Main":     2,
  };

  // map_id -> { mapKm, regions: [{name, points: [[x,y]...]}] }
  let DATA = {};

  POI.ready = fetch((window.__SERVE_BASE__||"/") + "api/pubg/pois")
    .then(r => r.json())
    .then(j => {
      const d = (j && j.data) || j;
      if (d && typeof d === "object") DATA = d;
    })
    .catch(() => { DATA = {}; });

  function polyArea(points) {
    if (!points || points.length < 3) return 0;
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }
  function pointInPoly(px, py, points) {
    if (!points || points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i][0], yi = points[i][1];
      const xj = points[j][0], yj = points[j][1];
      const intersect = ((yi > py) !== (yj > py))
        && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  // Min-Distanz von Punkt zum Polygon (= zur naechsten Edge).
  // Punkt im cm-Welt-System; Rueckgabe ebenfalls in cm.
  function distToPoly(px, py, points) {
    if (!points || points.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = 0;
      if (len2 > 0) {
        t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      }
      const qx = ax + t * dx, qy = ay + t * dy;
      const d = Math.hypot(px - qx, py - qy);
      if (d < best) best = d;
    }
    return best;
  }
  // Schwerpunkt (Vertex-Mittel) — fuer Kompass-Richtung gut genug.
  function polyCentroid(points) {
    if (!points || !points.length) return [0, 0];
    let sx = 0, sy = 0;
    for (const p of points) { sx += p[0]; sy += p[1]; }
    return [sx / points.length, sy / points.length];
  }
  // PUBG-Welt: X+ = Osten, Y+ = Sueden (Y waechst nach unten auf der Map).
  // Bearing = Winkel im Uhrzeigersinn von Norden zu Vektor (dx, dy).
  // dx,dy = Spielerposition relativ zum POI-Mittelpunkt; das Label sagt
  // "Spieler kommt aus Richtung X" relativ zum POI.
  function compassDir(dx, dy) {
    const rad = Math.atan2(dx, -dy);
    const deg = (rad * 180 / Math.PI + 360) % 360;
    const dirs = ["north", "north-east", "east", "south-east",
                  "south", "south-west", "west", "north-west"];
    return dirs[Math.round(deg / 45) % 8];
  }

  POI.fromCoords = function (mapName, xCm, yCm) {
    if (!mapName || xCm == null || yCm == null) return null;
    // Aliase fuer doppelte Map-IDs (Erangel)
    const alias = (mapName === "Erangel_Main") ? "Baltic_Main" : mapName;
    const blob = DATA[alias] || DATA[mapName];
    if (!blob) return null;
    // Regionen sind in Welt-cm gespeichert (gleiche Coords-Domain wie
    // die Pin-Telemetry-Coords). Cal im Editor ist nur Visualisierungs-
    // Hilfe — die persistierten Region-Points sind bereits in Welt-cm,
    // daher hier KEINE extra Transformation noetig.
    const regions = blob.regions || [];
    // Phase 1: kleinste umschliessende Region gewinnt (Nesting-faehig)
    let best = null;
    let bestArea = Infinity;
    for (const r of regions) {
      if (!r.name) continue;
      if (pointInPoly(xCm, yCm, r.points)) {
        const a = polyArea(r.points);
        if (a < bestArea) { bestArea = a; best = r; }
      }
    }
    if (best) return best.name;

    // Phase 2: Single-Closest-Fallback. Nur 1 POI (vermeidet Multi-POI-
    // Richtungs-Konflikt, wenn z.B. 2 Orte im NO und 2 im SW sind).
    // Richtung relativ zu DIESEM einen POI.
    const NEAR_CM = 50000;  // 500m
    let nearest = null;
    let nearestD = Infinity;
    for (const r of regions) {
      if (!r.name) continue;
      const d = distToPoly(xCm, yCm, r.points);
      if (d < nearestD) { nearestD = d; nearest = r; }
    }
    if (!nearest || nearestD > NEAR_CM) return null;
    const distM = Math.max(1, Math.round(nearestD / 100));
    const [cx, cy] = polyCentroid(nearest.points);
    const dir = compassDir(xCm - cx, yCm - cy);
    return `Near ${nearest.name} (${distM}m ${dir})`;
  };
})();
