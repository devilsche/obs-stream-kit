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

  POI.ready = fetch("/api/pubg/pois")
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

  POI.fromCoords = function (mapName, xCm, yCm) {
    if (!mapName || xCm == null || yCm == null) return null;
    // Aliase fuer doppelte Map-IDs (Erangel)
    const alias = (mapName === "Erangel_Main") ? "Baltic_Main" : mapName;
    const blob = DATA[alias] || DATA[mapName];
    if (!blob) return null;
    // Pin-Calibration anwenden: gleiche affine Korrektur wie im Editor,
    // damit Runtime-Lookup und visuelles Pin-Alignment matchen.
    // Formel: effective = (raw - mapCenter) * scale + mapCenter + offset
    // -> Center-anchored, scale dehnt symmetrisch aus dem Bildmittelpunkt.
    const cal = blob.pinCalibration || {};
    const sx = cal.scaleX != null ? cal.scaleX : 1;
    const sy = cal.scaleY != null ? cal.scaleY : 1;
    const mc = (blob.mapKm || 8) * 100000 / 2;
    const ax = (xCm - mc) * sx + mc + (cal.offsetX || 0);
    const ay = (yCm - mc) * sy + mc + (cal.offsetY || 0);
    const regions = blob.regions || [];
    let best = null;
    let bestArea = Infinity;
    for (const r of regions) {
      if (!r.name) continue;
      if (pointInPoly(ax, ay, r.points)) {
        const a = polyArea(r.points);
        if (a < bestArea) { bestArea = a; best = r; }
      }
    }
    return best ? best.name : null;
  };
})();
