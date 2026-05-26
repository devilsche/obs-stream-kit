// tools/match-replay.js
const RS = {
  replay: null,         // geladenes Replay-Dict
  focusedTeam: null,    // team_id oder null
  playing: false,
  cursorMs: 0,
  speed: 1,
  lastFrameWall: 0,
  toggles: { kills: true, knocks: true, streaks: true, names: true },
  view: { zoom: 1, panX: 0, panY: 0 },  // zoom: Faktor, pan: Pixel-Offset
};

async function loadMatchList() {
  const sel = document.getElementById("matchSelect");
  const list = await PubgUI.fetchJson("/api/pubg/matches-list?limit=50");
  sel.innerHTML = list.map(m => {
    const d = new Date(m.playedAt);
    const dt = d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit",
              hour: "2-digit", minute: "2-digit" });
    const mapShort = (m.mapName || "?").replace("_Main", "");
    return `<option value="${m.matchId}">${dt} · ${mapShort} · #${m.place ?? "?"} · ${m.kills ?? "?"}K</option>`;
  }).join("");
  // URL-Parameter ?match=ID überschreibt die Vorauswahl
  const urlMatch = PubgUI.qs("match");
  if (urlMatch) sel.value = urlMatch;
  sel.addEventListener("change", () => loadReplay(sel.value));
  if (sel.value) loadReplay(sel.value);
}

async function loadReplay(matchId) {
  RS.replay = await PubgUI.fetchJson(
    "/api/pubg/match-replay?match=" + encodeURIComponent(matchId), 60000);
  RS.cursorMs = 0;
  RS.playing = false;
  RS.focusedTeam = null;
  await PubgUI.POI.ready;
  const mapName = RS.replay.mapName;
  const alias = mapName === "Erangel_Main" ? "Baltic_Main" : mapName;
  RS._poiBlob = await PubgUI.fetchJson(
    "/api/pubg/pois?map=" + encodeURIComponent(alias));
  buildTeamList();
  buildPlayerTracks();
  syncScrubberAndClock();
  // resize + initial render
  if (window._rsInitCanvas) window._rsInitCanvas();
}

function buildTeamList() {
  const host = document.getElementById("teamList");
  if (!RS.replay) { host.innerHTML = ""; return; }
  host.innerHTML = RS.replay.teams.map(t => `
    <div class="team" data-team="${t.teamId}">
      <div class="team-head" role="button" tabindex="0"
           aria-label="Team ${t.teamId} fokussieren">
        <span class="team-swatch" style="background:${t.color}"></span>
        <strong>Team ${t.teamId}</strong>
      </div>
      <div class="team-players">
        ${t.players.map(p => p.name).join("<br>")}
      </div>
    </div>`).join("");
  host.querySelectorAll(".team-head").forEach(el => {
    const tid = Number(el.closest(".team").dataset.team);
    const focus = () => setFocus(tid);
    el.addEventListener("click", focus);
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); focus(); }
    });
  });
}

function setFocus(teamId) {
  RS.focusedTeam = (RS.focusedTeam === teamId) ? null : teamId;
  document.querySelectorAll(".team").forEach(el =>
    el.classList.toggle("focused",
      Number(el.dataset.team) === RS.focusedTeam));
}

// --- Task 8: Canvas-Basemap + Koordinaten-Projektion ---

// Kalibrierung auf normalisierte 0-1-Coords anwenden (Port von mdApplyPinCal,
// aber im 0-1-Raum statt cm). cal-Offsets sind in cm → /span normalisieren.
function applyCal(nx, ny, mapKm, cal) {
  if (!cal) return [nx, ny];
  let x = nx, y = ny;
  if (cal.flipX) x = 1 - x;
  if (cal.flipY) y = 1 - y;
  const rot = (((cal.rotate || 0) % 360) + 360) % 360;
  if (rot !== 0) {
    const dx = x - 0.5, dy = y - 0.5;
    if (rot === 90)  { x = 0.5 - dy; y = 0.5 + dx; }
    if (rot === 180) { x = 0.5 - dx; y = 0.5 - dy; }
    if (rot === 270) { x = 0.5 + dy; y = 0.5 - dx; }
  }
  const span = mapKm * 100000;
  x = (x - 0.5) * (cal.scaleX || 1) + 0.5 + (cal.offsetX || 0) / span;
  y = (y - 0.5) * (cal.scaleY || 1) + 0.5 + (cal.offsetY || 0) / span;
  return [x, y];
}

function getCal() {
  const mapName = RS.replay ? RS.replay.mapName : null;
  const alias = mapName === "Erangel_Main" ? "Baltic_Main" : mapName;
  // PubgUI.POI hat DATA intern; wir holen mapKm/cal über die pois-API direkt.
  return RS._poiBlob || { mapKm: RS.replay ? RS.replay.mapKm : 8, pinCalibration: {} };
}

// normalisiertes (0-1) → Canvas-Pixel (mit Zoom + Pan)
function projToCanvas(nx, ny) {
  const blob = getCal();
  const [cx, cy] = applyCal(nx, ny, blob.mapKm || 8, blob.pinCalibration || {});
  const cnv = document.getElementById("map");
  const base = Math.min(cnv.width, cnv.height);
  const offX = (cnv.width - base) / 2;
  const offY = (cnv.height - base) / 2;
  const px = offX + cx * base;
  const py = offY + cy * base;
  return [
    (px - cnv.width / 2) * RS.view.zoom + cnv.width / 2 + RS.view.panX,
    (py - cnv.height / 2) * RS.view.zoom + cnv.height / 2 + RS.view.panY,
  ];
}

let _mapImg = null;
function loadMapImage(mapName) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = "/widgets/pubg/maps/" + mapName + ".webp";
  });
}

function resizeCanvas() {
  const cnv = document.getElementById("map");
  const r = cnv.parentElement.getBoundingClientRect();
  cnv.width = Math.floor(r.width);
  cnv.height = Math.floor(r.height);
}

window._rsInitCanvas = async function () {
  resizeCanvas();
  _mapImg = await loadMapImage(
    RS.replay.mapName === "Erangel_Main" ? "Baltic_Main" : RS.replay.mapName);
  renderFrame();
};
window.addEventListener("resize", () => { resizeCanvas(); renderFrame(); });

function drawBasemap(ctx) {
  const cnv = document.getElementById("map");
  ctx.fillStyle = "#0d061a";
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  if (!_mapImg) return;
  // Quadrat-Crop des Map-Bildes auf den Canvas-Quadrat-Bereich,
  // dann Zoom/Pan via projToCanvas-Eckpunkte.
  const [x0, y0] = projToCanvas(0, 0);
  const [x1, y1] = projToCanvas(1, 1);
  ctx.drawImage(_mapImg, x0, y0, x1 - x0, y1 - y0);
}

// --- Task 9: Pin-Interpolation + Marker + Streaks ---

function buildPlayerTracks() {
  const tracks = {};   // accountId → [{ts,x,y}]
  const deaths = {};   // accountId → [ts,...]
  const relands = {};  // accountId → [ts,...]  (landings nach erstem)
  for (const e of RS.replay.events) {
    if (e.type === "position" || e.type === "landing") {
      (tracks[e.actorId] = tracks[e.actorId] || []).push(
        { ts: e.ts, x: e.x, y: e.y });
      if (e.type === "landing")
        (relands[e.actorId] = relands[e.actorId] || []).push(e.ts);
    } else if (e.type === "death") {
      (deaths[e.actorId] = deaths[e.actorId] || []).push(e.ts);
    }
  }
  RS._tracks = tracks;
  RS._deaths = deaths;
  RS._relands = relands;
  // accountId → teamId und → color Lookup
  RS._accTeam = {};
  RS._accName = {};
  RS._teamColor = {};
  for (const t of RS.replay.teams) {
    RS._teamColor[t.teamId] = t.color;
    for (const p of t.players) {
      RS._accTeam[p.accountId] = t.teamId;
      RS._accName[p.accountId] = p.name;
    }
  }
}

function posAt(acc, ms) {
  const tr = RS._tracks[acc];
  if (!tr || !tr.length) return null;
  // tot? letzter death vor ms ohne nachfolgendes reland
  const dts = RS._deaths[acc] || [];
  const rts = RS._relands[acc] || [];
  let dead = false;
  for (const d of dts) {
    if (d <= ms) {
      const reland = rts.find(r => r > d && r <= ms);
      dead = !reland;
    }
  }
  if (dead) return null;
  if (ms <= tr[0].ts) return { x: tr[0].x, y: tr[0].y };
  if (ms >= tr[tr.length - 1].ts) {
    const last = tr[tr.length - 1];
    return { x: last.x, y: last.y };
  }
  for (let i = 1; i < tr.length; i++) {
    if (tr[i].ts >= ms) {
      const a = tr[i - 1], b = tr[i];
      const f = (ms - a.ts) / Math.max(1, b.ts - a.ts);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return null;
}

function markersUpTo(ms) {
  const out = [];
  for (const e of RS.replay.events) {
    if (e.ts > ms) break;
    if (e.type === "kill" && RS.toggles.kills) out.push(e);
    if (e.type === "knock" && RS.toggles.knocks) out.push(e);
  }
  return out;
}

function activeStreaks(ms) {
  if (!RS.toggles.streaks) return [];
  // Hit-Events deren Einschlag < 200ms her ist
  return RS.replay.events.filter(e =>
    e.type === "hit" && e.ts <= ms && ms - e.ts <= 200);
}

function teamColorOf(acc) {
  const tid = RS._accTeam[acc];
  return RS._teamColor[tid] || "#888";
}

function renderFrame() {
  const cnv = document.getElementById("map");
  const ctx = cnv.getContext("2d");
  drawBasemap(ctx);
  if (!RS.replay) return;
  const ms = RS.cursorMs;

  // 1) Bullet-Streaks (unter den Pins)
  for (const e of activeStreaks(ms)) {
    const [ax, ay] = projToCanvas(e.ax, e.ay);
    const [tx, ty] = projToCanvas(e.tx, e.ty);
    const age = ms - e.ts;
    ctx.globalAlpha = 0.7 * (1 - age / 200);
    ctx.strokeStyle = teamColorOf(e.actorId);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 2) Kill/Knock-Marker (X)
  for (const e of markersUpTo(ms)) {
    const [mx, my] = projToCanvas(e.tx, e.ty);
    const sz = e.type === "kill" ? 6 : 3;
    ctx.strokeStyle = teamColorOf(e.actorId);
    ctx.globalAlpha = e.type === "kill" ? 1 : 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx - sz, my - sz); ctx.lineTo(mx + sz, my + sz);
    ctx.moveTo(mx + sz, my - sz); ctx.lineTo(mx - sz, my + sz);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 3) Spieler-Pins
  const nameScale = Math.max(8, Math.min(12, 12 / RS.view.zoom));
  for (const acc in RS._accTeam) {
    const p = posAt(acc, ms);
    if (!p) continue;
    const [px, py] = projToCanvas(p.x, p.y);
    const tid = RS._accTeam[acc];
    const focused = RS.focusedTeam == null || RS.focusedTeam === tid;
    ctx.fillStyle = focused ? RS._teamColor[tid] : "#bbb";
    ctx.globalAlpha = focused ? 1 : 0.7;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
    // Teamnummer immer
    ctx.fillStyle = "#000";
    ctx.font = "bold 8px DM Sans";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(tid), px, py);
    // Namens-Badge (nur fokussiertes Team + Toggle)
    if (RS.toggles.names && RS.focusedTeam === tid) {
      ctx.fillStyle = "#fff";
      ctx.font = `${nameScale}px DM Sans`;
      ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(RS._accName[acc] || "", px + 7, py - 5);
    }
    ctx.globalAlpha = 1;
  }
}

// Toggle-Checkboxen verdrahten
["Kills", "Knocks", "Streaks", "Names"].forEach(k => {
  const cb = document.getElementById("tgl" + k);
  cb.addEventListener("change", () => {
    RS.toggles[k.toLowerCase()] = cb.checked;
    renderFrame();
  });
});

// --- Task 10: Wiedergabe-Steuerung ---

function tick(wallNow) {
  if (RS.playing && RS.replay) {
    const dt = wallNow - (RS.lastFrameWall || wallNow);
    RS.cursorMs += dt * RS.speed;
    if (RS.cursorMs >= RS.replay.durationMs) {
      RS.cursorMs = RS.replay.durationMs;
      RS.playing = false;
      document.getElementById("playPause").textContent = "▶";
    }
    syncScrubberAndClock();
    renderFrame();
  }
  RS.lastFrameWall = wallNow;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function syncScrubberAndClock() {
  if (!RS.replay) return;
  const scr = document.getElementById("scrubber");
  scr.value = String(Math.round(
    (RS.cursorMs / Math.max(1, RS.replay.durationMs)) * 1000));
  document.getElementById("clock").textContent =
    fmtClock(RS.cursorMs) + " / " + fmtClock(RS.replay.durationMs);
}

document.getElementById("playPause").addEventListener("click", () => {
  if (!RS.replay) return;
  RS.playing = !RS.playing;
  if (RS.playing && RS.cursorMs >= RS.replay.durationMs) RS.cursorMs = 0;
  document.getElementById("playPause").textContent = RS.playing ? "❚❚" : "▶";
  RS.lastFrameWall = performance.now();
});

document.getElementById("scrubber").addEventListener("input", () => {
  if (!RS.replay) return;
  const f = Number(document.getElementById("scrubber").value) / 1000;
  RS.cursorMs = f * RS.replay.durationMs;
  RS.playing = false;
  document.getElementById("playPause").textContent = "▶";
  syncScrubberAndClock();
  renderFrame();
});

document.getElementById("speedSelect").addEventListener("change", e => {
  RS.speed = Number(e.target.value);
});

// --- Task 11: Zoom, Pan, Hover-Tooltips ---

const stageEl = () => document.querySelector(".stage");

stageEl().addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  RS.view.zoom = Math.max(0.5, Math.min(20, RS.view.zoom * factor));
  renderFrame();
}, { passive: false });

let _drag = null;
stageEl().addEventListener("mousedown", e => {
  _drag = { x: e.clientX, y: e.clientY,
            px: RS.view.panX, py: RS.view.panY };
});
window.addEventListener("mousemove", e => {
  if (!_drag) return;
  RS.view.panX = _drag.px + (e.clientX - _drag.x);
  RS.view.panY = _drag.py + (e.clientY - _drag.y);
  renderFrame();
});
window.addEventListener("mouseup", () => { _drag = null; });

const TOOLTIP = () => document.getElementById("tooltip");

function hitTest(mx, my) {
  const ms = RS.cursorMs;
  // 1) Pins (Radius 7px)
  for (const acc in RS._accTeam) {
    const p = posAt(acc, ms);
    if (!p) continue;
    const [px, py] = projToCanvas(p.x, p.y);
    if (Math.hypot(px - mx, py - my) <= 7) {
      const tid = RS._accTeam[acc];
      // Kills/Knocks dieses Spielers bis Cursor zählen
      let k = 0, kn = 0;
      for (const e of RS.replay.events) {
        if (e.ts > ms) break;
        if (e.actorId === acc && e.type === "kill") k++;
        if (e.actorId === acc && e.type === "knock") kn++;
      }
      return `Team ${tid} · ${RS._accName[acc]} · ${k} Kills · ${kn} Knocks`;
    }
  }
  // 2) Kill/Knock-Marker (8px)
  for (const e of markersUpTo(ms)) {
    const [ex, ey] = projToCanvas(e.tx, e.ty);
    if (Math.hypot(ex - mx, ey - my) <= 8) {
      const verb = e.type === "kill" ? "killed" : "knocked";
      const dist = e.distance != null ? Math.round(e.distance / 100) + "m" : "?";
      const wp = (e.weapon || "?").replace(/^Weap/, "").replace(/_C$/, "");
      return `${RS._accName[e.targetId] || "?"} ${verb} by `
           + `${RS._accName[e.actorId] || "?"} · ${wp} · ${dist}`;
    }
  }
  return null;
}

stageEl().addEventListener("mousemove", e => {
  if (_drag) return;
  const cnv = document.getElementById("map");
  const r = cnv.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const txt = hitTest(mx, my);
  const tt = TOOLTIP();
  if (txt) {
    tt.textContent = txt;
    tt.style.display = "block";
    tt.style.left = (mx + 12) + "px";
    tt.style.top = (my + 12) + "px";
  } else {
    tt.style.display = "none";
  }
});
stageEl().addEventListener("mouseleave", () => {
  TOOLTIP().style.display = "none";
});

// Bootstrap
loadMatchList();
