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
  const intens = (p) => (p.landings != null ? p.landings : p.total);
  const maxTotal = Math.max(1, ...LS.data.pois.map(intens));
  for (const poi of LS.data.pois) {
    if (poi.cx == null) continue;
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

  // Hover-Highlight (Task 11 — ausgeführt wenn _hoverPoi gesetzt)
  if (LS._hoverPoi && LS.data) {
    const poi = LS.data.pois.find(p => p.name === LS._hoverPoi);
    if (poi && poi.cx != null) {
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
  const intens = (p) => (p.landings != null ? p.landings : p.total);
  return LS.data.pois
    .filter(p => p.name !== "—")
    .map(p => {
      const s = (LS.stats || {})[p.name] || null;
      // Kein eigener Drop hier? Dann liegen die Daten vielleicht beim
      // Oberplatz — "nichts hier" waere falsch, gelandet wurde, nur eine
      // Polygon-Grenze weiter.
      const base = p.name.split(" - ")[0];
      const parent = (!s && base !== p.name && (LS.stats || {})[base])
        ? base : null;
      return {
        name: p.name, poi: p, lobby: intens(p), parent,
        drops: s ? s.drops : null,
        squadHeldPct: s ? s.squadHeldPct : null,
        earlyDeathPct: s ? s.earlyDeathPct : null,
        diedAlonePct: s ? s.diedAlonePct : null,
        lobbyEarlyPct: s ? s.lobbyEarlyPct : null,
        diff: s ? s.diff : null,
        survivalMin: s ? s.survivalMin : null,
        avgPlace: s ? s.avgPlace : null,
        reliable: s ? s.reliable : false,
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
  const total = rows.length;
  if (LS.scope === "mine") rows = rows.filter(r => r.drops != null || r.parent);

  const col = SPOT_COLS.find(c => c.key === SPOT_SORT) || SPOT_COLS[1];
  rows.sort((a, b) => {
    const va = a[SPOT_SORT], vb = b[SPOT_SORT];
    if (col.text) return String(va || "").localeCompare(String(vb || "")) * SPOT_DIR;
    if (va == null && vb == null) return 0;
    if (va == null) return 1;      // Leere immer nach unten
    if (vb == null) return -1;
    return (va - vb) * SPOT_DIR;
  });

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
      const nameCell = r.parent
        ? `${PubgUI.esc(r.name)} <button type="button" class="parent-ref"
             data-jump="${PubgUI.esc(r.parent)}">→ ${PubgUI.esc(r.parent)}</button>`
        : PubgUI.esc(r.name) + (r.drops != null && !r.reliable
            ? ' <span class="bot-mark">thin</span>' : "");
      return `<tr data-poi="${PubgUI.esc(r.name)}"
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
    "Click a row to centre that spot on the map. <b>Lobby</b> counts every "
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
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadMaps();
