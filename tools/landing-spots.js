/* landing-spots.js — PUBG Landing Spots Tool
   Task 8: Karten-Selektor + State */

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

loadMaps();
