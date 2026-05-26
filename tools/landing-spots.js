/* landing-spots.js — PUBG Landing Spots Tool
   Task 8: Karten-Selektor + State
   Task 9: Spieler-Autocomplete + refresh() */

const LS = {
  data: null,            // landing-heatmap Response
  players: [],           // [{accountId, name}] der 4 Felder (nur gefüllte)
  activeScatter: new Set(),  // accountIds deren Scatter sichtbar ist
  mapName: null,
  mapImg: null,
  _imgName: null,
  _hoverPoi: null,
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
    `<option value="${m}">${m.replace("_Main", "")}</option>`).join("");
  sel.addEventListener("change", () => { LS.mapName = sel.value; refresh(); });
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
  renderHeatmap();   // Task 10
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadMaps();
