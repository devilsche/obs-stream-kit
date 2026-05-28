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
};
const SCATTER_COLORS = ["#f2b705", "#3cb44b", "#46f0f0", "#f032e6"];

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
              aria-selected="false">${p.name}</div>`
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
}

[0, 1, 2, 3].forEach(wireAutocomplete);
document.getElementById("routeFilter")
  .addEventListener("change", refresh);

async function refresh() {
  if (!LS.mapName) return;
  const params = new URLSearchParams();
  params.set("map", LS.mapName);
  [0, 1, 2, 3].forEach(i => {
    if (LS.players[i]) params.set("p" + i, LS.players[i].accountId);
  });
  if (document.getElementById("routeFilter").checked)
    params.set("routeFilter", "1");
  LS.data = await PubgUI.fetchJson("/api/pubg/landing-heatmap?" + params);
  document.getElementById("matchCount").textContent =
    LS.data.totalMatches + " Matches";
  await ensureMapImage();
  buildPlayersBar();
  renderPoiList();
  renderHeatmap();
}

// ---------------------------------------------------------------------------
// Task 10: Heatmap + Scatter rendern
// ---------------------------------------------------------------------------

function ensureMapImage() {
  const name = LS.mapName === "Erangel_Main" ? "Baltic_Main" : LS.mapName;
  if (LS.mapImg && LS._imgName === name) return Promise.resolve();
  // High-Res .png zuerst (api-assets via refresh-maps, wie Session-Report),
  // .webp als Fallback.
  return new Promise(res => {
    const img = new Image();
    img.onload = () => { LS.mapImg = img; LS._imgName = name; res(); };
    img.onerror = () => {
      const img2 = new Image();
      img2.onload = () => { LS.mapImg = img2; LS._imgName = name; res(); };
      img2.onerror = () => { LS.mapImg = null; res(); };
      img2.src = "/widgets/pubg/maps/" + name + ".webp";
    };
    img.src = "/widgets/pubg/maps/" + name + ".png";
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
  ctx.fillStyle = "#0d061a";
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  // Basemap quadratisch
  if (LS.mapImg) {
    const [x0, y0] = projXY(0, 0);
    const [x1, y1] = projXY(1, 1);
    ctx.drawImage(LS.mapImg, x0, y0, x1 - x0, y1 - y0);
  }
  if (!LS.data) return;

  // Heatmap-Blobs pro POI (Radius ~ total, Farbe Gold→Lila nach Intensität)
  const maxTotal = Math.max(1, ...LS.data.pois.map(p => p.total));
  for (const poi of LS.data.pois) {
    if (poi.cx == null) continue;
    const [px, py] = projXY(poi.cx, poi.cy);
    const intensity = poi.total / maxTotal;
    const radius = 20 + intensity * 60;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
    grad.addColorStop(0, `rgba(94,42,121,${0.25 + intensity * 0.45})`);
    grad.addColorStop(1, "rgba(242,183,5,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
    // POI-Label
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px DM Sans";
    ctx.textAlign = "center";
    ctx.fillText(poi.name + " " + poi.total + "×", px, py - radius - 4);
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
         aria-label="Scatter ${p.name} umschalten">
      <span class="dot" style="background:${SCATTER_COLORS[i]}"></span>
      <span>${p.name}</span>
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

function renderPoiList() {
  const host = document.getElementById("poiList");
  if (!LS.data || !LS.data.pois.length) {
    host.innerHTML = `<p>Keine Landings für diese Auswahl.</p>`;
    return;
  }
  const maxTotal = Math.max(1, ...LS.data.pois.map(p => p.total));
  host.innerHTML = LS.data.pois.map(poi => {
    const players = Object.entries(poi.byPlayer)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([, v]) =>
        `<div class="poi-player"><span>${v.name}</span>`
        + `<span>${v.count}× · ${v.pct}%</span></div>`).join("");
    const w = Math.round(poi.total / maxTotal * 100);
    return `
      <div class="poi" data-poi="${poi.name}">
        <div class="poi-head">
          <span>${poi.name}</span><span>${poi.total}×</span>
        </div>
        <div class="bar" style="width:${w}%" role="presentation"></div>
        ${players}
      </div>`;
  }).join("");
}

function highlightPoi(name) {
  LS._hoverPoi = name;
  renderHeatmap();
}

document.getElementById("poiList").addEventListener("mouseover", e => {
  const el = e.target.closest(".poi");
  if (el) highlightPoi(el.dataset.poi);
});
document.getElementById("poiList").addEventListener("mouseout", e => {
  if (e.target.closest(".poi")) highlightPoi(null);
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadMaps();
