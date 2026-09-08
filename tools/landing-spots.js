/* landing-spots.js — PUBG Landing Spots Tool
   Task 8: Karten-Selektor + State
   Task 9: Spieler-Autocomplete + refresh()
   Task 10: Heatmap + Scatter rendern
   Task 11: POI-Liste mit per-Spieler-Aufschlüsselung + Hover-Verknüpfung */

const LS = {
  data: null,            // landing-heatmap Response
  players: [],           // [{accountId, name}] der 4 Felder (nur gefüllte)
  activeScatter: new Set(),  // accountIds deren Scatter sichtbar ist
  mapName: null,
  mapImg: null,
  _imgName: null,
  _hoverPoi: null,
  view: { zoom: 1, panX: 0, panY: 0 },
  //: Zeitraum fuer BEIDE Quellen. Ohne gemeinsame Auswahl zeigte die
  //: Karte den ganzen Bestand und die Bewertung die Session — irrefuehrender
  //: als zwei getrennte Tools. Default bewusst "session": mit "all" startet
  //: das Tool auf dem ganzen Bestand und war damit der langsamste Fall.
  range: "session",
  //: Auswertung aus /api/pubg/shot-quality, indexiert nach POI-Name der
  //: aktuellen Karte. null = noch nicht geladen, {} = keine Daten.
  stats: null,
  //: "mine" zeigt nur Plaetze mit eigenen Landungen (rund 25 von 100) —
  //: sonst besteht die Tabelle zu drei Vierteln aus Zeilen ohne eigene
  //: Daten. "all" holt die ganze Lobby-Liste dazu.
  scope: "mine",
  //: "squad" = nur Matches mit allen Genannten im selben Team,
  //: "any" = jedes Match mit mindestens einem, Landungen kumuliert.
  playerMode: "squad",
  _selected: null,
};
const SCATTER_COLORS = ["#f2b705", "#3cb44b", "#46f0f0", "#f032e6"];
//: Abstand des POI-Namens vom Ortsmarker, in Bildschirm-Pixeln. Klein
//: halten: der Wert ist zoomabhaengig in Kartenmetern, und ein grosser
//: Offset laesst den Namen bei herausgezoomter Ansicht wie einen eigenen,
//: weit entfernten Spot aussehen.
const POI_LABEL_OFFSET_PX = 9;
const isBotAcc = (acc) => typeof acc === "string" && acc.startsWith("ai.");
const botMark = (acc) => isBotAcc(acc) ? " <span class=\"bot-mark\">·BOT</span>" : "";

// ---------------------------------------------------------------------------
// Task 8: Karten-Selektor
// ---------------------------------------------------------------------------

async function loadMaps() {
  // Maps aus der Match-Liste ableiten (distinct)
  const list = await PubgUI.fetchJson("/api/pubg/matches-list?limit=200");
  const maps = [...new Set(list.map(m => m.mapName).filter(Boolean))];
  const sel = document.getElementById("mapSelect");
  sel.innerHTML = maps.map(m =>
    `<option value="${m}">${PubgUI.fmtMap(m)}</option>`).join("");
  sel.addEventListener("change", () => {
    LS.mapName = sel.value;
    LS.view = { zoom: 1, panX: 0, panY: 0 };
    refresh();
  });
  LS.mapName = sel.value || maps[0];
  // Vorauswahl VOR dem ersten refresh, sonst laedt das Tool zweimal
  await preselectMe();
  syncControls();
  if (LS.mapName) { sel.value = LS.mapName; refresh(); }
}

// ---------------------------------------------------------------------------
// Task 9: Spieler-Autocomplete + refresh()
// ---------------------------------------------------------------------------

function wireAutocomplete(idx) {
  const input = document.getElementById("p" + idx);
  const list = document.getElementById("ac" + idx);
  let timer = null;
  let activeIdx = -1;

  function showList(show) {
    list.style.display = show ? "block" : "none";
    input.setAttribute("aria-expanded", String(show));
  }

  function setActiveOption(opts, newIdx) {
    opts.forEach((o, i) => {
      o.setAttribute("aria-selected", String(i === newIdx));
    });
    activeIdx = newIdx;
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    activeIdx = -1;
    const q = input.value.trim();
    if (!q) { showList(false); setPlayer(idx, null); return; }
    timer = setTimeout(async () => {
      const res = await PubgUI.fetchJson(
        "/api/pubg/player-search?q=" + encodeURIComponent(q));
      list.innerHTML = res.map(p =>
        `<div role="option" tabindex="0" data-acc="${p.accountId}"
              aria-selected="false">${p.name}${botMark(p.accountId)}</div>`
      ).join("");
      showList(res.length > 0);
      list.querySelectorAll("[role='option']").forEach(d => {
        const pick = () => {
          input.value = d.textContent;
          setPlayer(idx, { accountId: d.dataset.acc, name: d.textContent });
          showList(false);
          refresh();
        };
        d.addEventListener("click", pick);
        d.addEventListener("keydown", e => {
          if (e.key === "Enter") { e.preventDefault(); pick(); }
        });
      });
    }, 200);
  });

  // Keyboard navigation within dropdown
  input.addEventListener("keydown", e => {
    const opts = [...list.querySelectorAll("[role='option']")];
    if (!opts.length || list.style.display === "none") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveOption(opts, Math.min(activeIdx + 1, opts.length - 1));
      if (opts[activeIdx]) opts[activeIdx].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveOption(opts, Math.max(activeIdx - 1, 0));
      if (opts[activeIdx]) opts[activeIdx].focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const d = opts[activeIdx >= 0 ? activeIdx : 0];
      if (d) {
        input.value = d.textContent;
        setPlayer(idx, { accountId: d.dataset.acc, name: d.textContent });
        showList(false);
        refresh();
      }
    } else if (e.key === "Escape") {
      showList(false);
      input.focus();
    }
  });

  input.addEventListener("blur", () =>
    setTimeout(() => { showList(false); }, 150));
}

function setPlayer(idx, player) {
  LS.players[idx] = player;  // kann null sein
  syncControls();
}

//: Schalter aus- und einblenden, je nachdem ob sie ueberhaupt etwas
//: aendern. Die Leiste hatte sieben Elemente, von denen zwei je nach
//: Auswahl wirkungslos waren — das liest sich als Auswahlmoeglichkeit,
//: obwohl nichts passiert.
function syncControls() {
  const n = LS.players.filter(Boolean).length;
  // Squad-vs-kumuliert unterscheidet sich erst ab zwei Spielern. Bei einem
  // liefern beide Modi dasselbe (ein Test haelt das fest).
  const mode = document.getElementById("modeWrap");
  if (mode) mode.hidden = n < 2;
  // Der Flugrouten-Filter braucht einen Referenzspieler — ohne Auswahl
  // ignoriert ihn der Rechenkern stillschweigend.
  const route = document.getElementById("routeWrap");
  if (route) route.hidden = n < 1;
}

[0, 1, 2, 3].forEach(wireAutocomplete);
document.getElementById("routeFilter")
  .addEventListener("change", refresh);

//: Eigenen Account in P1 vorbelegen. Ohne Auswahl liefert der Endpoint nur
//: die Lobby-Intensitaet und keine eigenen Punkte — man startete also auf
//: einer Karte ohne sich selbst darauf.
async function preselectMe() {
  try {
    const me = await PubgUI.getMyName();
    if (!me || me === "Streamer") return null;
    const hits = await PubgUI.fetchJson(
      "/api/pubg/player-search?q=" + encodeURIComponent(me));
    const exact = (hits || []).find(h => h.name === me) || (hits || [])[0];
    if (!exact) return null;
    const input = document.getElementById("p0");
    input.value = exact.name;
    setPlayer(0, { accountId: exact.accountId, name: exact.name });
    LS.activeScatter.add(exact.accountId);
    return exact;
  } catch (e) {
    console.warn("Vorauswahl fehlgeschlagen:", e && e.message);
    return null;
  }
}

async function refresh() {
  if (!LS.mapName) return;
  const params = new URLSearchParams();
  params.set("map", LS.mapName);
  [0, 1, 2, 3].forEach(i => {
    if (LS.players[i]) params.set("p" + i, LS.players[i].accountId);
  });
  if (document.getElementById("routeFilter").checked)
    params.set("routeFilter", "1");
  params.set("range", LS.range);
  params.set("playerMode", LS.playerMode);
  // Beide Quellen parallel und mit demselben Zeitraum. shot-quality ist der
  // teurere Aufruf (rund 2,5 s auf dem vollen Bestand), deshalb nicht
  // hintereinander.
  const [heat] = await Promise.all([
    PubgUI.fetchJson("/api/pubg/landing-heatmap?" + params, 120000),
    loadStats(),
  ]);
  LS.data = heat;
  document.getElementById("matchCount").textContent =
    LS.data.totalMatches + " matches";
  await ensureMapImage();
  buildPlayersBar();
  renderSpotTable();
  renderHeatmap();
}

document.getElementById("rangeSwitch").addEventListener("click", e => {
  const b = e.target.closest("button[data-range]");
  if (!b || b.dataset.range === LS.range) return;
  LS.range = b.dataset.range;
  [...e.currentTarget.querySelectorAll("button")].forEach(x =>
    x.setAttribute("aria-pressed", String(x.dataset.range === LS.range)));
  refresh();
});

// ---------------------------------------------------------------------------
// Task 10: Heatmap + Scatter rendern
// ---------------------------------------------------------------------------

function ensureMapImage() {
  const name = LS.mapName === "Erangel_Main" ? "Baltic_Main" : LS.mapName;
  if (LS.mapImg && LS._imgName === name) return Promise.resolve();
  const base = "/widgets-static/pubg/maps/" + name;
  const candidates = [base + "_hd.webp", base + ".png", base + ".webp"];
  return new Promise(res => {
    let i = 0;
    function tryNext() {
      if (i >= candidates.length) { LS.mapImg = null; res(); return; }
      const img = new Image();
      img.onload = () => { LS.mapImg = img; LS._imgName = name; res(); };
      img.onerror = () => { i++; tryNext(); };
      img.src = candidates[i++];
    }
    tryNext();
  });
}

function fitCanvas() {
  const cnv = document.getElementById("heat");
  const r = cnv.parentElement.getBoundingClientRect();
  cnv.width = Math.floor(r.width);
  cnv.height = Math.floor(r.height);
}

//: Eckenradius des Hover-Umrisses in Pixeln. Wird pro Ecke auf die halbe
//: kuerzere Kantenlaenge begrenzt, sonst ueberschlagen sich die Bogen bei
//: kleinen Polygonen.
const POLY_CORNER_R = 14;

//: Legt einen abgerundeten Pfad entlang der uebergebenen Bildschirmpunkte.
//: arcTo statt Bezier, weil es den Radius direkt nimmt und bei stumpfen
//: Winkeln sauber laeuft.
function roundedPolyPath(ctx, pts) {
  const n = pts.length;
  if (n < 3) return;
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  // Startpunkt: Mitte der ersten Kante — von dort laesst sich jede Ecke
  // gleich behandeln, ohne Sonderfall am Anfang.
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  ctx.beginPath();
  const [sx, sy] = mid(pts[0], pts[1]);
  ctx.moveTo(sx, sy);
  for (let i = 1; i <= n; i++) {
    const cur = pts[i % n];
    const next = pts[(i + 1) % n];
    const prev = pts[i - 1];
    const r = Math.min(POLY_CORNER_R,
                       len(prev, cur) / 2, len(cur, next) / 2);
    ctx.arcTo(cur[0], cur[1], next[0], next[1], r);
  }
  ctx.closePath();
}

// normalisiert (0-1) → Canvas-Pixel (Map quadratisch zentriert, + Zoom/Pan)
function projXY(nx, ny) {
  const cnv = document.getElementById("heat");
  const base = Math.min(cnv.width, cnv.height);
  const offX = (cnv.width - base) / 2;
  const offY = (cnv.height - base) / 2;
  const px = offX + nx * base;
  const py = offY + ny * base;
  const z = LS.view.zoom;
  return [
    (px - cnv.width / 2) * z + cnv.width / 2 + LS.view.panX,
    (py - cnv.height / 2) * z + cnv.height / 2 + LS.view.panY,
  ];
}

//: Landungen je Platz — Lobby oder nur die Auswahl, je nach LS.scope.
//: Dieselbe Funktion fuer Karte und Tabelle, damit beide dasselbe zeigen.
//: Vorher faerbte die Karte immer nach der Lobby, auch wenn die Tabelle
//: auf die eigenen Plaetze gefiltert war.
function poiIntensity(p) {
  if (LS.scope === "mine") {
    const by = p.byPlayer || {};
    return Object.values(by).reduce((s, v) => s + (v.count || 0), 0);
  }
  return p.landings != null ? p.landings : p.total;
}

function renderHeatmap() {
  fitCanvas();
  const cnv = document.getElementById("heat");
  const ctx = cnv.getContext("2d");
  ctx.fillStyle = getComputedStyle(document.documentElement)
    .getPropertyValue("--theme-bg").trim() || "#0d061a";
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  // Basemap quadratisch
  if (LS.mapImg) {
    const [x0, y0] = projXY(0, 0);
    const [x1, y1] = projXY(1, 1);
    ctx.drawImage(LS.mapImg, x0, y0, x1 - x0, y1 - y0);
  }
  if (!LS.data) return;

  // Heatmap-Blobs pro POI (Radius ~ total, Farbe Gold→Lila nach Intensität)
  // Intensitaet ueber die LANDUNGEN, nicht die Match-Zahl: bei 100
  // Lobby-Spielern in einem Match ist total 1 und landings 100.
  const intens = poiIntensity;
  const maxTotal = Math.max(1, ...LS.data.pois.map(intens));
  for (const poi of LS.data.pois) {
    if (poi.cx == null) continue;
    // In der eigenen Sicht Plaetze ohne eigene Landung weglassen — sonst
    // stehen dort Marker und Namen ohne Inhalt.
    if (intens(poi) <= 0) continue;
    const [px, py] = projXY(poi.cx, poi.cy);
    const intensity = intens(poi) / maxTotal;
    const radius = 20 + intensity * 60;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
    grad.addColorStop(0, `rgba(94,42,121,${0.25 + intensity * 0.45})`);
    grad.addColorStop(1, "rgba(242,183,5,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();

    // Mittelpunkt-Marker: der Blob ist weich und sein Radius haengt an der
    // Intensitaet, nicht am Ort — ohne Marker ist nicht ablesbar, wo der
    // Spot wirklich liegt.
    ctx.fillStyle = "#f2b705";
    ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();

    // Label dicht am Marker, mit FESTEM kleinem Offset. Vorher hing der
    // Offset am Blob-Radius (20-80 px, zoom-invariant): bei Zoom 1 sass das
    // Label damit bis zu 960 m ueber dem echten Ort und sah aus wie ein
    // eigener Spot weit im Norden. Der Offset bleibt zoomabhaengig — 9 px
    // sind bei Zoom 1 rund 100 m — aber der Marker darunter ist eindeutig.
    ctx.font = "bold 12px DM Sans";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const label = poi.name + " " + intens(poi) + "×";
    // Umriss, damit der Text auch ueber hellen Kartenteilen lesbar ist —
    // dicht am Marker liegt er jetzt oefter auf dem Blob.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(label, px, py - POI_LABEL_OFFSET_PX);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, px, py - POI_LABEL_OFFSET_PX);
  }

  // Scatter-Punkte nur für aktive Spieler
  for (const sp of LS.data.scatterPoints) {
    if (!LS.activeScatter.has(sp.accountId)) continue;
    const idx = LS.players.findIndex(
      p => p && p.accountId === sp.accountId);
    const color = SCATTER_COLORS[idx] || "#fff";
    const [px, py] = projXY(sp.x, sp.y);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
  }

  // Hover-Highlight: die echten Polygon-Raender, abgerundet. Ein Kreis
  // mit festem Radius sagte nichts darueber, wie weit der Ort reicht —
  // die POIs sind zwischen 150 m und 1,8 km breit.
  if (LS._hoverPoi && LS.data) {
    const poi = LS.data.pois.find(p => p.name === LS._hoverPoi);
    if (poi && poi.shape && poi.shape.length >= 3) {
      ctx.strokeStyle = "#f2b705";
      ctx.lineWidth = 3;
      roundedPolyPath(ctx, poi.shape.map(([nx, ny]) => projXY(nx, ny)));
      ctx.stroke();
    } else if (poi && poi.cx != null) {
      // Kein Umriss vorhanden (aeltere Payload): Kreis als Rueckfall
      const [px, py] = projXY(poi.cx, poi.cy);
      ctx.strokeStyle = "#f2b705";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, 36, 0, Math.PI * 2); ctx.stroke();
    }
  }
}
window.addEventListener("resize", renderHeatmap);

// --- Zoom (Wheel, zur Cursor-Position) + Pan (Drag) + Reset (Doppelklick) ---
const heatEl = () => document.getElementById("heat");

heatEl().addEventListener("wheel", e => {
  e.preventDefault();
  const cnv = heatEl();
  const r = cnv.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newZoom = Math.max(1, Math.min(20, LS.view.zoom * factor));
  const ratio = newZoom / LS.view.zoom;
  const hw = cnv.width / 2, hh = cnv.height / 2;
  LS.view.panX = mx - hw - (mx - hw - LS.view.panX) * ratio;
  LS.view.panY = my - hh - (my - hh - LS.view.panY) * ratio;
  LS.view.zoom = newZoom;
  renderHeatmap();
}, { passive: false });

let _lsDrag = null;
heatEl().addEventListener("mousedown", e => {
  _lsDrag = { x: e.clientX, y: e.clientY,
              px: LS.view.panX, py: LS.view.panY };
  heatEl().style.cursor = "grabbing";
});
window.addEventListener("mousemove", e => {
  if (!_lsDrag) return;
  LS.view.panX = _lsDrag.px + (e.clientX - _lsDrag.x);
  LS.view.panY = _lsDrag.py + (e.clientY - _lsDrag.y);
  renderHeatmap();
});
window.addEventListener("mouseup", () => {
  _lsDrag = null;
  heatEl().style.cursor = "";
});
//: Region unter dem Zeiger finden. Kleinster umschliessender POI gewinnt —
//: dieselbe Regel wie match_poi im Backend, sonst zeigt der Tooltip einen
//: anderen Ort an als die Tabelle zaehlt.
function poiAtScreen(sx, sy) {
  if (!LS.data) return null;
  const inside = (pt, shape) => {
    let hit = false;
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
      const [xi, yi] = shape[i], [xj, yj] = shape[j];
      if (((yi > pt[1]) !== (yj > pt[1]))
          && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) hit = !hit;
    }
    return hit;
  };
  const area = (shape) => {
    let a = 0;
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
      a += shape[j][0] * shape[i][1] - shape[i][0] * shape[j][1];
    }
    return Math.abs(a / 2);
  };
  let best = null, bestArea = Infinity;
  for (const poi of LS.data.pois) {
    if (!poi.shape || poi.shape.length < 3) continue;
    const scr = poi.shape.map(([nx, ny]) => projXY(nx, ny));
    if (!inside([sx, sy], scr)) continue;
    const a = area(scr);
    if (a < bestArea) { bestArea = a; best = poi; }
  }
  return best;
}

heatEl().addEventListener("mousemove", e => {
  if (_lsDrag) return;                 // beim Ziehen kein Tooltip
  const box = heatEl().getBoundingClientRect();
  const poi = poiAtScreen(e.clientX - box.left, e.clientY - box.top);
  const tip = document.getElementById("mapTip");
  if (!poi) {
    tip.hidden = true;
    if (LS._hoverPoi !== (LS._selected || null)) highlightPoi(LS._selected || null);
    return;
  }
  const s = (LS.stats || {})[poi.name];
  const mine = Object.values(poi.byPlayer || {})
    .reduce((a, v) => a + (v.count || 0), 0);
  const lobby = poi.landings != null ? poi.landings : poi.total;
  const bits = [`${num0(lobby)} lobby landing${lobby === 1 ? "" : "s"}`];
  if (mine) bits.push(`<b>${num0(mine)} yours</b>`);
  if (poi.parent) bits.push(`in ${PubgUI.esc(poi.parent)}`);
  tip.innerHTML = `<b>${PubgUI.esc(poi.name)}</b><br>`
    + `<span class="mt-sub">${bits.join(" · ")}</span>`
    + (s ? `<br><span class="mt-sub">you died ${
        s.earlyDeathPct == null ? "—" : s.earlyDeathPct.toFixed(0) + " %"
      } · lobby ${
        s.lobbyEarlyPct == null ? "—" : s.lobbyEarlyPct.toFixed(0) + " %"
      }</span>` : "");
  tip.hidden = false;
  // Feste Ecke statt am Zeiger: eine Mausposition liesse sich nur ueber
  // JS-.style setzen, und das ist im Projekt nicht erlaubt. Fest gesetzt
  // springt der Kasten ausserdem nicht und verdeckt nie den Ort, den man
  // gerade anschaut — der ist durch den Umriss markiert.
  if (LS._hoverPoi !== poi.name) highlightPoi(poi.name);
});
heatEl().addEventListener("mouseleave", () => {
  document.getElementById("mapTip").hidden = true;
  highlightPoi(LS._selected || null);
});

heatEl().addEventListener("dblclick", () => {
  LS.view.zoom = 1; LS.view.panX = 0; LS.view.panY = 0;
  renderHeatmap();
});

function buildPlayersBar() {
  const bar = document.getElementById("playersBar");
  const active = LS.players.map((p, i) => ({ p, i })).filter(o => o.p);
  bar.innerHTML = active.map(({ p, i }) => `
    <div class="pchip" role="button" tabindex="0" data-acc="${p.accountId}"
         aria-pressed="${LS.activeScatter.has(p.accountId) ? "true" : "false"}"
         aria-label="Toggle scatter for ${p.name}">
      <span class="dot" style="background:${SCATTER_COLORS[i]}"></span>
      <span>${p.name}${botMark(p.accountId)}</span>
    </div>`).join("");
  bar.querySelectorAll(".pchip").forEach(chip => {
    const acc = chip.dataset.acc;
    const toggle = () => {
      if (LS.activeScatter.has(acc)) LS.activeScatter.delete(acc);
      else LS.activeScatter.add(acc);
      chip.classList.toggle("active", LS.activeScatter.has(acc));
      chip.setAttribute("aria-pressed", String(LS.activeScatter.has(acc)));
      renderHeatmap();
    };
    chip.addEventListener("click", toggle);
    chip.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
}

// ---------------------------------------------------------------------------
// Task 11: POI-Liste mit per-Spieler-Aufschlüsselung + Hover-Verknüpfung
// ---------------------------------------------------------------------------

//: Analyse je Landeplatz dazuholen. Eigener Endpoint, eigener Aufruf: die
//: Heatmap kommt aus landing-heatmap (Lobby-Intensitaet, eine Karte), die
//: Bewertung aus shot-quality (eigener Account, alle Karten). Beide
//: bekommen denselben `range`.
async function loadStats() {
  LS.stats = null;
  try {
    const d = await PubgUI.fetchJson(
      "/api/pubg/shot-quality?range=" + encodeURIComponent(LS.range)
      + "&withLandings=1", 120000);
    const rows = ((d.landings || {}).byPoi || [])
      .filter(r => r.map === LS.mapName
                || (LS.mapName === "Erangel_Main" && r.map === "Baltic_Main")
                || (LS.mapName === "Baltic_Main" && r.map === "Erangel_Main"));
    LS.stats = Object.fromEntries(rows.map(r => [r.poi, r]));
  } catch (e) {
    LS.stats = {};       // Karte bleibt nutzbar, nur ohne Bewertung
    console.warn("shot-quality nicht erreichbar:", e && e.message);
  }
}

const pct1 = (v) => v == null ? "—" : v.toFixed(1) + " %";
const num0 = (v) => v == null ? "—" : Math.round(v).toLocaleString("en-US");
const num1 = (v) => v == null ? "—" : v.toFixed(1);

//: Spalten der Spot-Tabelle. `good` sagt, welche Richtung besser ist —
//: die Tabelle mischt zwangslaeufig beide, und ohne Marker muss man jede
//: Spalte einzeln durchdenken.
const SPOT_COLS = [
  { key: "name", label: "Spot", text: true },
  { key: "lobby", label: "Lobby", help: "Landings by everyone in the lobby" },
  { key: "drops", label: "Mine", help: "Your own landings here" },
  { key: "squadHeldPct", label: "Squad held", good: "up",
    help: "Share of rounds where your squad was NOT wiped within 5 min of your landing" },
  { key: "earlyDeathPct", label: "You died", good: "down",
    help: "Share of your rounds where YOU die within 5 min of landing, inside the spot" },
  { key: "diedAlonePct", label: "Died alone", good: "down",
    help: "You dead, squad still standing — the spot works and you are losing it" },
  { key: "lobbyEarlyPct", label: "Lobby died", good: "down",
    help: "Same measure for everyone who lands here" },
  { key: "diff", label: "Diff", good: "down",
    help: "Your death rate minus the lobby rate at the same spot" },
  { key: "survivalMin", label: "\u00d8 Surv", good: "up" },
  { key: "avgPlace", label: "\u00d8 Place", good: "down" },
];
let SPOT_SORT = "lobby";
let SPOT_DIR = -1;

function spotRows() {
  if (!LS.data) return [];
  return LS.data.pois
    .filter(p => p.name !== "—")
    .map(p => {
      const s = (LS.stats || {})[p.name] || null;
      // Kein eigener Drop hier? Dann liegen die Daten vielleicht beim
      // Oberplatz — "nichts hier" waere falsch, gelandet wurde, nur eine
      // Polygon-Grenze weiter.
      // Elternschaft kommt aus der GEOMETRIE (Backend): kleinster POI, der
      // diesen umschliesst. Namen truegen — "Gatka" liegt IN "Gatka
      // Neighborhood", der laengere Name ist der Container.
      const family = p.parent || null;
      const parent = (!s && family && (LS.stats || {})[family])
        ? family : null;
      return {
        name: p.name, poi: p,
        lobby: (p.landings != null ? p.landings : p.total), parent,
        drops: s ? s.drops : null,
        squadHeldPct: s ? s.squadHeldPct : null,
        earlyDeathPct: s ? s.earlyDeathPct : null,
        diedAlonePct: s ? s.diedAlonePct : null,
        lobbyEarlyPct: s ? s.lobbyEarlyPct : null,
        diff: s ? s.diff : null,
        survivalMin: s ? s.survivalMin : null,
        avgPlace: s ? s.avgPlace : null,
        reliable: s ? s.reliable : false,
        family,
      };
    });
}

function spotHeadHtml() {
  return "<tr>" + SPOT_COLS.map(c => {
    const active = c.key === SPOT_SORT;
    const arrow = active ? (SPOT_DIR < 0 ? "\u25bc" : "\u25b2") : "";
    const aria = active ? (SPOT_DIR < 0 ? "descending" : "ascending") : "none";
    const dir = c.good ? `<span class="goal" aria-hidden="true">${
      c.good === "up" ? "\u2191" : "\u2193"}</span>` : "";
    const note = c.good ? ` (${c.good === "up" ? "higher" : "lower"} is better)` : "";
    return `<th data-sort="${c.key}" tabindex="0" aria-sort="${aria}"`
      + ` class="${active ? "active" : ""}"`
      + ` title="${PubgUI.esc((c.help || c.label) + note)}">`
      + `${PubgUI.esc(c.label)}${dir}`
      + `<span class="sort-arrow">${arrow}</span></th>`;
  }).join("") + "</tr>";
}

function renderSpotTable() {
  const head = document.getElementById("spotHead");
  const body = document.getElementById("spotRows");
  if (!head || !body) return;
  head.innerHTML = spotHeadHtml();

  let rows = spotRows();
  // Landungen der Kinder je Container aufsummieren. match_poi zaehlt eine
  // Landung immer beim KLEINSTEN umschliessenden POI — ein Container
  // bekommt also nur, was in keinem Kind liegt, und sieht ohne diese
  // Summe leerer aus als die Gegend bespielt ist.
  const kidsOf = {};
  for (const r of rows) {
    if (!r.family) continue;
    const k = kidsOf[r.family] || (kidsOf[r.family] = { lobby: 0, mine: 0, n: 0 });
    k.lobby += r.lobby || 0;
    k.mine += r.drops || 0;
    k.n += 1;
  }
  for (const r of rows) r.kids = kidsOf[r.name] || null;
  const total = rows.length;
  if (LS.scope === "mine") {
    // Sichtbar bleibt, wer eigene Drops hat, oder zu einer Familie gehoert,
    // in der irgendwo gelandet wurde. Der Container kommt IMMER mit, auch
    // ohne eigene Landung: ein Verweis "gehoert zu Georgopol" ist wertlos,
    // wenn Georgopol nicht in der Liste steht — man kann nicht hinspringen
    // und die Einrueckung haengt in der Luft.
    const fam = new Set();
    for (const r of rows) {
      if (r.drops == null) continue;
      fam.add(r.name);
      if (r.family) fam.add(r.family);      // Container des eigenen Spots
    }
    // Zwei Ebenen: der Container eines Containers gehoert auch dazu.
    for (const r of rows) if (fam.has(r.name) && r.family) fam.add(r.family);
    rows = rows.filter(r => fam.has(r.name)
      || (r.family && fam.has(r.family)));
  }

  const col = SPOT_COLS.find(c => c.key === SPOT_SORT) || SPOT_COLS[1];
  const cmp = (a, b) => {
    const va = a[SPOT_SORT], vb = b[SPOT_SORT];
    if (col.text) return String(va || "").localeCompare(String(vb || "")) * SPOT_DIR;
    if (va == null && vb == null) return 0;
    if (va == null) return 1;      // Leere immer nach unten
    if (vb == null) return -1;
    return (va - vb) * SPOT_DIR;
  };

  // Familien bleiben zusammen. Flach sortieren und Kinder nur einruecken
  // reicht nicht: eine mit "\u21b3" markierte Zeile, die die Sortierung
  // irgendwohin wirft, liest sich als Unterbereich der Zeile darueber —
  // "\u21b3 Bootyard - Warehouses" direkt unter Lipovka behauptet eine
  // Zugehoerigkeit, die es nicht gibt. Sortiert wird darum die FAMILIE,
  // Kinder stehen immer direkt unter ihrem Container.
  // Gruppiert wird NUR bei Sortierung nach Namen. Bei jeder Zahlenspalte
  // will man ein Ranking, und die Familie ueberstimmt es: "Hospital" mit 6
  // eigenen Drops verschwindet unter "Georgopol" mit 0, weil der Zweig
  // nach seiner staerksten Zeile rankt. Flach sortiert steht jede Zeile
  // auf ihrem Wert — der Container kommt dann als Text in die Zelle statt
  // als Einrueckung, die sonst eine Zugehoerigkeit zur Zeile darueber
  // behauptet.
  const grouped = SPOT_SORT === "name";
  const byName = new Map(rows.map(r => [r.name, r]));
  const childrenOf = new Map();
  const roots = [];
  for (const r of rows) {
    const up = r.family && byName.has(r.family) ? r.family : null;
    r.depth = 0;
    if (up) (childrenOf.get(up) || childrenOf.set(up, []).get(up)).push(r);
    else roots.push(r);
  }
  // Tiefe fuer die Einrueckung, ueber die Kette nach oben gezaehlt.
  for (const r of rows) {
    let d = 0, cur = r;
    while (cur.family && byName.has(cur.family) && d < 8) {
      cur = byName.get(cur.family); d += 1;
    }
    r.depth = d;
  }
  // Ein Zweig steht so hoch wie seine staerkste Zeile — sonst versteckt ein
  // duenner Container (Bootyard: 3 eigene Drops) die 57 seines Kindes.
  const rankCache = new Map();
  const rank = r => {
    if (rankCache.has(r.name)) return rankCache.get(r.name);
    const best = [r, ...(childrenOf.get(r.name) || []).map(rank)].sort(cmp)[0];
    rankCache.set(r.name, best);
    return best;
  };
  if (grouped) {
    const flatten = (list) => list
      .sort((a, b) => cmp(rank(a), rank(b)))
      .flatMap(r => [r, ...flatten(childrenOf.get(r.name) || [])]);
    rows = flatten(roots);
  } else {
    for (const r of rows) r.depth = 0;   // keine Einrueckung ohne Gruppen
    rows.sort(cmp);
  }

  // Die Lobby-Gesamtsicht bleibt immer ablesbar, auch wenn die Tabelle auf
  // die eigenen Plaetze gefiltert ist.
  const lobbyTotal = spotRows().reduce((s, r) => s + (r.lobby || 0), 0);
  const mineTotal = spotRows().reduce((s, r) => s + (r.drops || 0), 0);
  document.getElementById("spotCount").innerHTML =
    `<b>${rows.length}</b> of ${total} spots · `
    + `${num0(lobbyTotal)} lobby landings · `
    + `<b>${num0(mineTotal)}</b> yours`;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${SPOT_COLS.length}">`
      + `No spot with own landings in this range — switch to All spots `
      + `or widen the range.</td></tr>`;
  } else {
    body.innerHTML = rows.map(r => {
      const cls = (k, v, bad, good) => {
        if (v == null) return "";
        return bad(v) ? "bad" : (good && good(v) ? "good" : "");
      };
      const diffCls = cls("diff", r.diff, v => v > 3, v => v < -3);
      const heldCls = cls("h", r.squadHeldPct, v => v < 50, v => v >= 75);
      const aloneCls = (r.diedAlonePct != null && r.diedAlonePct >= 15
                        && (r.squadHeldPct ?? 0) >= 50) ? "bad" : "";
      const sign = r.diff == null ? "—"
        : (r.diff > 0 ? "+" : "\u2212") + Math.abs(r.diff).toFixed(1);
      // Kinder verweisen nach oben, Container zeigen was in ihnen steckt.
      // Der Container-Name steht im Payload, auch wenn seine Zeile fehlt:
      // bei range=session ist in "Georgopol" niemand gelandet, also gibt
      // es dort keine Georgopol-Zeile — "Hospital" stand deshalb ohne
      // jeden Bezug da, obwohl die Zugehoerigkeit bekannt ist. Der Name
      // wird immer gezeigt, nur der Sprung braucht die Zeile.
      const ref = r.family || null;
      const refRow = ref ? rows.some(o => o.name === ref) : false;
      let nameCell = PubgUI.esc(r.name);
      if (ref && refRow && grouped) {
        nameCell = `<span class="in-parent">↳</span> ` + nameCell
          + ` <button type="button" class="parent-ref"
               data-jump="${PubgUI.esc(ref)}"
               title="Part of ${PubgUI.esc(ref)} — landings count at the
                      smallest matching spot, so they show up here, not there"
               >in ${PubgUI.esc(ref)}</button>`;
      } else if (ref) {
        nameCell += ` <span class="in-note"
               title="Lies inside ${PubgUI.esc(ref)}${refRow
                 ? ". Sort by name to see the spots grouped."
                 : " — nobody landed in " + PubgUI.esc(ref)
                   + " itself in this range, so it has no row."}"
               >in ${PubgUI.esc(ref)}</span>`;
      } else if (r.kids && grouped) {
        nameCell += ` <span class="kids-note" title="Landings inside the
            ${r.kids.n} spots within this one. They count there, not here."
            >+${num0(r.kids.mine)} in ${r.kids.n} inner spot${
            r.kids.n === 1 ? "" : "s"}</span>`;
      }
      if (r.drops != null && !r.reliable) {
        nameCell += ' <span class="bot-mark">thin</span>';
      }
      return `<tr data-poi="${PubgUI.esc(r.name)}"
                  data-depth="${Math.min(r.depth || 0, 3)}"
                  class="${r.drops == null ? "nodata" : ""}${
                    LS._selected === r.name ? " sel" : ""}">
        <td>${nameCell}</td>
        <td>${num0(r.lobby)}</td>
        <td>${r.drops == null ? "—" : num0(r.drops)}</td>
        <td class="${heldCls}">${pct1(r.squadHeldPct)}</td>
        <td>${pct1(r.earlyDeathPct)}</td>
        <td class="${aloneCls}">${pct1(r.diedAlonePct)}</td>
        <td>${pct1(r.lobbyEarlyPct)}</td>
        <td class="${diffCls}">${sign}</td>
        <td>${num1(r.survivalMin)}</td>
        <td>${num1(r.avgPlace)}</td>
      </tr>`;
    }).join("");
  }

  document.getElementById("spotFoot").innerHTML =
    (LS.scope === "mine"
      ? "<b>Mine</b>: table and map show only the selected players' "
        + "landings — spots nobody of them dropped at are hidden on the map. "
      : "<b>Lobby</b>: the map is shaded by everyone's landings and the "
        + "table lists all spots. Your own numbers stay in the columns. ")
    + "Click a row to centre that spot on the map. <b>Lobby</b> counts every "
    + "landing there, <b>Mine</b> only yours. <b>You died</b> means you "
    + "personally dead — not knocked-and-revived — within 5 min of your own "
    + "landing and inside the spot; <b>Squad held</b> is the share of rounds "
    + "where the squad was not wiped in that window. A high <b>Died alone</b> "
    + "next to a high <b>Squad held</b> is the clearest signal here: the spot "
    + "works, you are the one losing it. Sub-areas without own landings point "
    + "at the parent spot, where they are counted. "
    + (LS.playerMode === "any"
       ? "<b>Any of them</b>: every match with at least one of the named "
         + "players, their landings added up — they need not have played "
         + "together."
       : "<b>Same squad</b>: only matches where all named players were in "
         + "one team. Switch to <b>Any of them</b> to add up their landings "
         + "regardless of who played with whom.");
}

function onSpotSort(th) {
  const key = th.dataset.sort;
  const col = SPOT_COLS.find(c => c.key === key);
  if (SPOT_SORT === key) SPOT_DIR *= -1;
  else { SPOT_SORT = key; SPOT_DIR = col && col.text ? 1 : -1; }
  renderSpotTable();
  const again = document.querySelector(`#spotHead th[data-sort="${key}"]`);
  if (again) again.focus();
}

//: Ort auf der Karte zentrieren. Invertiert die projXY-Formel; poi.cx/cy
//: kommen schon normalisiert (0-1) aus dem Backend.
function centreOnPoi(poi) {
  if (!poi || poi.cx == null) return;
  const cnv = document.getElementById("heat");
  const base = Math.min(cnv.width, cnv.height);
  const offX = (cnv.width - base) / 2, offY = (cnv.height - base) / 2;
  LS.view.zoom = Math.max(LS.view.zoom, 3);
  const z = LS.view.zoom;
  const px = offX + poi.cx * base, py = offY + poi.cy * base;
  LS.view.panX = cnv.width / 2 - ((px - cnv.width / 2) * z + cnv.width / 2);
  LS.view.panY = cnv.height / 2 - ((py - cnv.height / 2) * z + cnv.height / 2);
}

function selectSpot(name) {
  LS._selected = name;
  LS._hoverPoi = name;
  const poi = (LS.data && LS.data.pois.find(p => p.name === name)) || null;
  centreOnPoi(poi);
  renderSpotTable();
  renderHeatmap();
}

function highlightPoi(name) {
  LS._hoverPoi = name;
  renderHeatmap();
}

document.getElementById("spotRows").addEventListener("click", e => {
  const jump = e.target.closest(".parent-ref");
  if (jump) { selectSpot(jump.dataset.jump); return; }
  const tr = e.target.closest("tr[data-poi]");
  if (tr) selectSpot(tr.dataset.poi);
});
document.getElementById("spotRows").addEventListener("mouseover", e => {
  const tr = e.target.closest("tr[data-poi]");
  if (tr && tr.dataset.poi !== LS._hoverPoi) highlightPoi(tr.dataset.poi);
});
document.getElementById("spotRows").addEventListener("mouseout", e => {
  if (e.target.closest("tr[data-poi]")) highlightPoi(LS._selected || null);
});
document.getElementById("spotHead").addEventListener("click", e => {
  const th = e.target.closest("th[data-sort]");
  if (th) onSpotSort(th);
});
document.getElementById("spotHead").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const th = e.target.closest("th[data-sort]");
  if (th) { e.preventDefault(); onSpotSort(th); }
});
document.getElementById("modeSwitch").addEventListener("click", e => {
  const b = e.target.closest("button[data-mode]");
  if (!b || b.dataset.mode === LS.playerMode) return;
  LS.playerMode = b.dataset.mode;
  [...e.currentTarget.querySelectorAll("button")].forEach(x =>
    x.setAttribute("aria-pressed", String(x.dataset.mode === LS.playerMode)));
  refresh();     // Serverseitig — der Modus aendert die Match-Auswahl
});
document.getElementById("scopeSwitch").addEventListener("click", e => {
  const b = e.target.closest("button[data-scope]");
  if (!b || b.dataset.scope === LS.scope) return;
  LS.scope = b.dataset.scope;
  [...e.currentTarget.querySelectorAll("button")].forEach(x =>
    x.setAttribute("aria-pressed", String(x.dataset.scope === LS.scope)));
  renderSpotTable();
  renderHeatmap();   // die Karte faerbt nach derselben Sicht
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadMaps();
