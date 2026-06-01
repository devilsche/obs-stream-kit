// tools/match-replay.js
const isBotAcc = (acc) => typeof acc === "string" && acc.startsWith("ai.");
const isBotTeam = (tid) => Number(tid) >= 200;
const botSuffix = (acc) => isBotAcc(acc) ? " ·BOT" : "";

const RS = {
  replay: null,         // geladenes Replay-Dict
  focusedTeam: null,    // team_id oder null
  playing: false,
  cursorMs: 0,
  speed: 1,
  lastFrameWall: 0,
  toggles: { kills: true, knocks: true, streaks: true, zones: true, names: true,
             grid: false },
  view: { zoom: 1, panX: 0, panY: 0, tZoom: 1, tPanX: 0, tPanY: 0 },
  // Empty defaults damit Hover/Render-Helpers vor dem ersten Load nicht crashen
  _tracks: {}, _groundTracks: {}, _deaths: {}, _relands: {},
  _jumpTs: {}, _accTeam: {}, _accName: {}, _teamColor: {},
  _flightStart: 0,
};

async function loadMatchList() {
  const sel = document.getElementById("matchSelect");
  console.log("[match-replay] loadMatchList start, sel=", sel);
  let list;
  try {
    list = await PubgUI.fetchJson("/api/pubg/matches-list?limit=2000");
  } catch (e) {
    console.error("[match-replay] matches-list FAIL", e);
    if (sel) sel.innerHTML = `<option>⚠ ${e.message || e}</option>`;
    return;
  }
  console.log("[match-replay] got list type=", typeof list, "len=",
              Array.isArray(list) ? list.length : "(not array)", list);
  if (!Array.isArray(list)) {
    if (sel) sel.innerHTML = `<option>⚠ unexpected: ${JSON.stringify(list).slice(0,80)}</option>`;
    return;
  }
  if (list.length === 0) {
    if (sel) sel.innerHTML = `<option>⚠ keine Matches in der DB</option>`;
    return;
  }
  // Optionen-Texte vorberechnen (case-insensitive Filter spaeter)
  const items = list.map(m => {
    const d = new Date(m.playedAt);
    const dt = d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit",
              hour: "2-digit", minute: "2-digit" });
    const mapShort = PubgUI.fmtMap(m.mapName);
    const text = `${dt} · ${mapShort} · #${m.place ?? "?"} · ${m.kills ?? "?"}K`;
    return { matchId: m.matchId, text, lower: text.toLowerCase() };
  });
  RS._matchItems = items;
  const cntEl = document.getElementById("matchCount");
  if (cntEl) cntEl.textContent = `(${items.length})`;
  function renderOptions(filter) {
    const f = (filter || "").toLowerCase().trim();
    const filtered = f ? items.filter(it => it.lower.includes(f)) : items;
    sel.innerHTML = filtered.map(it =>
      `<option value="${it.matchId}">${it.text}</option>`).join("");
    if (cntEl) cntEl.textContent = f ? `(${filtered.length}/${items.length})` : `(${items.length})`;
  }
  renderOptions("");
  const filterEl = document.getElementById("matchFilter");
  if (filterEl) {
    filterEl.addEventListener("input", () => {
      const prev = sel.value;
      renderOptions(filterEl.value);
      // Auswahl beibehalten wenn noch in der gefilterten Liste
      if (Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
    });
  }
  // URL-Parameter ?match=ID überschreibt die Vorauswahl. Wenn die ID
  // nicht in der Liste der letzten 50 ist, fuegen wir sie als
  // separate Option oben ein, damit der Replay trotzdem laeuft
  // (Backend faellt auf HiDrive zurueck).
  const urlMatch = PubgUI.qs("match");
  if (urlMatch) {
    sel.value = urlMatch;
    if (sel.value !== urlMatch) {
      const opt = document.createElement("option");
      opt.value = urlMatch;
      opt.textContent = `(URL) ${urlMatch.slice(0, 8)}…`;
      sel.insertBefore(opt, sel.firstChild);
      sel.value = urlMatch;
    }
  }
  sel.addEventListener("change", () => {
    const url = new URL(window.location);
    url.searchParams.set("match", sel.value);
    history.replaceState(null, "", url);
    loadReplay(sel.value);
  });
  if (sel.value) loadReplay(sel.value);
}

function setLoading(state, text) {
  const el = document.getElementById("loading");
  if (!el) return;
  const txt = document.getElementById("loadingText");
  if (txt && text) txt.textContent = text;
  el.querySelector(".spinner").style.display =
    state === "error" ? "none" : "";
  el.classList.toggle("show", state !== "done");
}

async function loadReplay(matchId) {
  setLoading("show", "Replay wird geladen…");
  try {
    RS.replay = await PubgUI.fetchJson(
      "/api/pubg/match-replay?match=" + encodeURIComponent(matchId), 60000);
  } catch (e) {
    RS.replay = null;
    const msg = (e && /404/.test(String(e.message || e)))
      ? "Keine Telemetrie für dieses Match verfügbar."
      : "Replay konnte nicht geladen werden.";
    setLoading("error", msg);
    buildTeamList();
    return;
  }
  RS.cursorMs = 0;
  RS.playing = false;
  RS.focusedTeam = null;
  await PubgUI.POI.ready;
  const mapName = RS.replay.mapName;
  const alias = mapName === "Erangel_Main" ? "Baltic_Main" : mapName;
  const poiResp = await PubgUI.fetchJson(
    "/api/pubg/pois?map=" + encodeURIComponent(alias));
  RS._poiBlob = (poiResp && poiResp.data) || poiResp;
  // buildPlayerTracks fuellt RS._deaths — vor buildTeamList damit das
  // Team-List initial den dead-state und Kill-Counts kennt.
  buildPlayerTracks();
  buildTeamList();
  syncScrubberAndClock();
  // resize + initial render
  if (window._rsInitCanvas) window._rsInitCanvas();
  setLoading("done");
}

function buildTeamList() {
  const host = document.getElementById("teamList");
  if (!RS.replay) { host.innerHTML = ""; return; }
  host.innerHTML = RS.replay.teams.map(t => {
    const bot = isBotTeam(t.teamId);
    const players = t.players.map(p => {
      const botLbl = isBotAcc(p.accountId) ? " ·BOT" : "";
      return `<div class="player" data-acc="${p.accountId}">`
           + `<span class="pname">${p.name}${botLbl}</span>`
           + `<span class="pkills" title="Kills bis Cursor-Zeitpunkt">`
           + `0<small>K</small></span>`
           + `</div>`;
    }).join("");
    return `
    <div class="team${bot ? " bot-team" : ""}" data-team="${t.teamId}">
      <div class="team-head" role="button" tabindex="0"
           aria-label="Team ${t.teamId}${bot ? " (Bots)" : ""} fokussieren">
        <span class="team-swatch" style="background:${t.color}"></span>
        <strong>Team ${t.teamId}${bot ? ' <span class="material-symbols-outlined icon-sm" aria-hidden="true">smart_toy</span>' : ""}</strong>
      </div>
      <div class="team-players">${players}</div>
    </div>`;
  }).join("");
  // Initial dead-state setzen (Cursor=0 -> niemand tot)
  updateTeamListDeadState(0);
  host.querySelectorAll(".team-head").forEach(el => {
    const tid = Number(el.closest(".team").dataset.team);
    const focus = () => setFocus(tid);
    el.addEventListener("click", focus);
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); focus(); }
    });
  });
}

function updateTeamListDeadState(cursorMs) {
  // Pro Spieler: wenn ein Death-Event <= cursorMs UND kein Reland nach
  // diesem Death — markiere als dead. Plus: Kill-Counter live mitziehen
  // (zaehlt nur kill-Events <= cursorMs).
  const tl = document.getElementById("teamList");
  if (!tl || !RS.replay) return;
  // Kill-Counts bis Cursor — Events sind nach ts sortiert, also einfach
  // bis zum ersten Event mit ts > cursor zaehlen.
  const killsByAcc = {};
  for (const e of RS.replay.events) {
    if (e.ts > cursorMs) break;
    if (e.type === "kill" && e.actorId) {
      killsByAcc[e.actorId] = (killsByAcc[e.actorId] || 0) + 1;
    }
  }
  tl.querySelectorAll(".player").forEach(el => {
    const acc = el.dataset.acc;
    if (!acc) return;
    // dead-state
    const deaths = RS._deaths[acc] || [];
    const relands = RS._relands[acc] || [];
    let dead = false;
    for (const d of deaths) {
      if (d <= cursorMs) {
        const revived = relands.some(r => r > d && r <= cursorMs);
        if (!revived) dead = true;
      }
    }
    el.classList.toggle("dead", dead);
    // kill-count
    const k = killsByAcc[acc] || 0;
    const kEl = el.querySelector(".pkills");
    if (kEl) kEl.innerHTML = `${k}<small>K</small>`;
  });
}

function setFocus(teamId) {
  RS.focusedTeam = (RS.focusedTeam === teamId) ? null : teamId;
  document.querySelectorAll(".team").forEach(el =>
    el.classList.toggle("focused",
      Number(el.dataset.team) === RS.focusedTeam));
  if (RS.focusedTeam == null) {
    // Defokussieren → zurueck auf Default-View (smooth via tick-lerp)
    RS.view.tZoom = 1;
    RS.view.tPanX = 0;
    RS.view.tPanY = 0;
    RS.followTeam = null;
  } else {
    zoomToTeam(RS.focusedTeam);
    // Follow-Modus aktiv: bei Zeit-Aenderung wird die Karte
    // automatisch zentriert (bis User selber pant/zoomt).
    RS.followTeam = RS.focusedTeam;
  }
}

function panToTeam(teamId) {
  // Wie zoomToTeam, aber laesst den aktuellen Zoom unangetastet —
  // nur Pan auf das Team-Centroid. Fuer Follow-Mode-Frames.
  const cnv = document.getElementById("map");
  if (!cnv || !cnv.width) return;
  const blob = getCal();
  const cal = blob.pinCalibration || {};
  const mapKm = blob.mapKm || 8;
  const base = Math.min(cnv.width, cnv.height);
  const offX = (cnv.width - base) / 2;
  const offY = (cnv.height - base) / 2;
  let sx = 0, sy = 0, n = 0;
  for (const acc of Object.keys(RS._accTeam)) {
    if (RS._accTeam[acc] !== teamId) continue;
    const p = posAt(acc, RS.cursorMs);
    if (!p) continue;
    const [px, py] = applyCal(p.x, p.y, mapKm, cal);
    sx += offX + px * base;
    sy += offY + py * base;
    n++;
  }
  if (!n) return;
  const cx = sx / n;
  const cy = sy / n;
  const z = RS.view.tZoom;  // aktuellen Zoom-Target unveraendert lassen
  RS.view.tPanX = -(cx - cnv.width / 2) * z;
  RS.view.tPanY = -(cy - cnv.height / 2) * z;
}

function zoomToTeam(teamId) {
  const cnv = document.getElementById("map");
  if (!cnv || !cnv.width) return;
  const blob = getCal();
  const cal = blob.pinCalibration || {};
  const mapKm = blob.mapKm || 8;
  const base = Math.min(cnv.width, cnv.height);
  const offX = (cnv.width - base) / 2;
  const offY = (cnv.height - base) / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
  for (const acc of Object.keys(RS._accTeam)) {
    if (RS._accTeam[acc] !== teamId) continue;
    const p = posAt(acc, RS.cursorMs);
    if (!p) continue;
    const [cx, cy] = applyCal(p.x, p.y, mapKm, cal);
    const px = offX + cx * base;
    const py = offY + cy * base;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    n++;
  }
  if (!n) return;
  const bw = Math.max(60, maxX - minX);
  const bh = Math.max(60, maxY - minY);
  const padding = 1.6;
  const z = Math.max(1, Math.min(8,
    Math.min(cnv.width / (bw * padding), cnv.height / (bh * padding))));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  RS.view.tZoom = z;
  RS.view.tPanX = -(cx - cnv.width / 2) * z;
  RS.view.tPanY = -(cy - cnv.height / 2) * z;
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

// Kern: kalibriertes/rohes 0-1 → Canvas-Pixel (Zoom + Pan + Quadrat-Fit).
function _normToCanvas(cx, cy) {
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

// Fuer PINS/Marker/Streaks: pinCalibration anwenden (verschiebt die Pins
// relativ zur FIXEN Basemap — exakt wie mdApplyPinCal im Session-Report).
function projToCanvas(nx, ny) {
  const blob = getCal();
  const [cx, cy] = applyCal(nx, ny, blob.mapKm || 8, blob.pinCalibration || {});
  return _normToCanvas(cx, cy);
}

// Fuer die BASEMAP: KEINE Kalibrierung — das Kartenbild bleibt fix, nur
// die Pins werden darueber kalibriert. (Vorher lief die Basemap durch
// projToCanvas und verschob sich mit den Pins → Kalibrierung wirkungslos.)
function projRaw(nx, ny) {
  return _normToCanvas(nx, ny);
}

let _mapImg = null;
function loadMapImage(mapName) {
  // _hd.webp zuerst (8192px HD webp, ~6-13MB) — gleiche Aufloesung
  // wie .png aber ~10x kleiner. Fallback .png (Symlink ins HD-Source),
  // dann .webp (Mid_Res).
  const base = "/widgets-static/pubg/maps/" + mapName;
  function tryLoad(url) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
    });
  }
  return tryLoad(base + "_hd.webp")
    .then(i => i || tryLoad(base + ".png"))
    .then(i => i || tryLoad(base + ".webp"));
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
  // Hochwertiges Resampling: ohne 'high' wird das HD-Webp matschig
  // gerendert wenn die Canvas-Pixelgroesse kleiner als die Quelle ist.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Quadrat-Crop des Map-Bildes auf den Canvas-Quadrat-Bereich,
  // dann Zoom/Pan via projToCanvas-Eckpunkte.
  const [x0, y0] = projRaw(0, 0);
  const [x1, y1] = projRaw(1, 1);
  ctx.drawImage(_mapImg, x0, y0, x1 - x0, y1 - y0);
}

// --- Task 9: Pin-Interpolation + Marker + Streaks ---

function buildPlayerTracks() {
  const tracks = {};       // accountId → [{ts,x,y}]  — alle Events (Lobby + Boden)
  const groundTracks = {}; // accountId → [{ts,x,y}]  — nur Events ab Flugstart
  const deaths = {};
  const relands = {};
  const fp = RS.replay.flightPath;
  const flightStart = fp && fp.length ? fp[0][2] : 0;

  // Hilfs-Push: Track-Sample anhaengen. Sort+Dedup machen wir nachher
  // pro Account, sonst werden's O(n²)-Inserts.
  const pushSample = (acc, ts, x, y) => {
    if (!acc || x == null || y == null) return;
    (tracks[acc] = tracks[acc] || []).push({ ts, x, y });
    if (ts >= flightStart)
      (groundTracks[acc] = groundTracks[acc] || []).push({ ts, x, y });
  };

  // Comeback-Linien: pro Spieler Liste von [{deathTs, x0, y0, landTs, x1, y1}]
  // 'x0/y0' = letzte bekannte Pos vor death, 'x1/y1' = first land-pos nach death.
  // Wird in Render gezeichnet als gestrichelte Linie (= Comeback-Trip).
  const comebacks = {};
  for (const e of RS.replay.events) {
    if (e.type === "position" || e.type === "landing") {
      pushSample(e.actorId, e.ts, e.x, e.y);
      if (e.type === "landing")
        (relands[e.actorId] = relands[e.actorId] || []).push(e.ts);
    } else if (e.type === "death") {
      (deaths[e.actorId] = deaths[e.actorId] || []).push(e.ts);
    } else if (e.type === "knock" || e.type === "kill" || e.type === "hit") {
      // Schuss-Events haben EXAKTE Koordinaten zum Event-Zeitpunkt.
      pushSample(e.actorId, e.ts, e.ax, e.ay);
      pushSample(e.targetId, e.ts, e.tx, e.ty);
    } else if (e.type === "vehicle_enter" || e.type === "vehicle_leave") {
      // Comeback-Heli capture (RedeployAircraft_*_C). actor_x/y NUR
      // in neuen Matches (telemetry.py erweitert) — alte Matches: null.
      pushSample(e.actorId, e.ts, e.x, e.y);
    }
  }
  // Pro Account: nach Timestamp sortieren + Duplikate (selbe ts) zusammenfassen
  for (const map of [tracks, groundTracks]) {
    for (const acc of Object.keys(map)) {
      map[acc].sort((a, b) => a.ts - b.ts);
      const dedup = [];
      for (const s of map[acc]) {
        if (dedup.length && dedup[dedup.length - 1].ts === s.ts) continue;
        dedup.push(s);
      }
      map[acc] = dedup;
    }
  }
  // Comeback-Transit-Samples (Heli-Entry, Heli-Position) BLEIBEN im
  // Track, damit der Pin den Spieler im Heli mitfliegen zeigt. Das
  // Wandern vom Death-Spot zur Heli-Entry verhindert der death-aware
  // Snap im _interpTrack (snap auf b wenn Tod zwischen a und b liegt).
  RS._tracks = tracks;
  RS._groundTracks = groundTracks;
  RS._deaths = deaths;
  RS._relands = relands;
  // Comeback-Linien: pro Account fuer jeden death-then-reland-Pair eine
  // [from-pos, to-pos] Linie. Frontend zeichnet sie als gestrichelte
  // Spur weil PUBG keine Heli-Position-Events emittiert.
  RS._comebackLines = {};
  for (const acc of Object.keys(deaths)) {
    const ds = deaths[acc] || [];
    const rs = relands[acc] || [];
    const tr = tracks[acc] || [];
    const lines = [];
    for (const d of ds) {
      // Erste Reland NACH dieser Death
      const reland = rs.find(r => r > d);
      if (reland == null) continue;
      // Letzte Position vor death
      let from = null;
      for (const p of tr) {
        if (p.ts <= d) from = p; else break;
      }
      // Erste Position >= reland (Landing-Punkt)
      const to = tr.find(p => p.ts >= reland);
      if (!from || !to) continue;
      lines.push({ deathTs: d, relandTs: reland,
                    x0: from.x, y0: from.y, x1: to.x, y1: to.y });
    }
    if (lines.length) RS._comebackLines[acc] = lines;
  }
  // Absprung-Zeitpunkt = erster Ground-Track-Event (z<150000) nach Flugstart
  RS._jumpTs = {};
  for (const [acc, gt] of Object.entries(groundTracks)) {
    if (gt.length) RS._jumpTs[acc] = gt[0].ts;
  }
  RS._flightStart = flightStart;

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

function _interpTrack(tr, ms, deaths) {
  if (!tr || !tr.length || ms < tr[0].ts) return null;
  if (ms >= tr[tr.length - 1].ts) {
    const l = tr[tr.length - 1]; return { x: l.x, y: l.y };
  }
  for (let i = 1; i < tr.length; i++) {
    if (tr[i].ts >= ms) {
      const a = tr[i - 1], b = tr[i];
      // Wenn ein Tod zwischen a und b liegt → Snap auf b (kein
      // Wandern vom Death-Spot zur Comeback-Landing).
      if (deaths && deaths.some(d => d > a.ts && d <= b.ts)) {
        return { x: b.x, y: b.y };
      }
      const f = (ms - a.ts) / Math.max(1, b.ts - a.ts);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return null;
}

function posAt(acc, ms) {
  // Tod-Check — Spieler ist tot wenn ein death-event vor ms und kein
  // reland (LogParachuteLanding) bzw. kein Comeback-Heli-Entry danach.
  // Im Toten-Zustand bleibt der Pin auf dem Death-Spot stehen (NICHT
  // unsichtbar) — Spieler-Body liegt da bis er via Heli abgeholt wird.
  const dts = RS._deaths[acc] || [];
  const rts = RS._relands[acc] || [];
  const tr  = RS._tracks[acc] || [];
  let dead = false;
  let deathTs = null;
  for (const d of dts) {
    if (d <= ms) {
      const reland = rts.some(r => r > d && r <= ms);
      const trackPos = tr.some(p => p.ts > d && p.ts <= ms);
      if (!reland && !trackPos) {
        dead = true; deathTs = d;
      } else {
        dead = false; deathTs = null;
      }
    }
  }
  if (dead) {
    // Letztes Sample <= deathTs heraussuchen = Death-Spot.
    let lastPre = null;
    for (const p of tr) {
      if (p.ts <= deathTs) lastPre = p;
      else break;
    }
    if (lastPre) return { x: lastPre.x, y: lastPre.y };
    return null;
  }

  const fp  = RS.replay.flightPath;
  const fs  = RS._flightStart;   // Flugstart-Zeitpunkt
  const fe  = fp && fp.length ? fp[fp.length - 1][2] : -Infinity;
  const jts = RS._jumpTs[acc] ?? Infinity;  // Absprung (erster Ground-Event nach Flugstart)

  // 1,5 s vor Flugstart alle zum Startpunkt teleportieren → kein sichtbares Gleiten
  const SNAP_MS = 1500;
  if (ms < fs - SNAP_MS) {
    // Lobby: Spieler laufen auf der Karte — normaler Track
    return _interpTrack(RS._tracks[acc], ms, RS._deaths[acc]);
  }
  if (ms < jts) {
    // Im Flieger (inkl. Snap-Fenster): Startpunkt oder mitfliegen
    if (!fp || !fp.length) return null;
    if (ms < fp[0][2]) return { x: fp[0][0], y: fp[0][1] };
    if (ms <= fe) return flightPosAt(ms);
    return null;
  }
  // Fallschirm / Boden: Ground-Track
  return _interpTrack(RS._groundTracks[acc], ms, RS._deaths[acc]);
}

function markersUpTo(ms) {
  if (!RS.replay || !RS.replay.events) return [];
  const out = [];
  for (const e of RS.replay.events) {
    if (e.ts > ms) break;
    if (e.type === "kill" && RS.toggles.kills) out.push(e);
    if (e.type === "knock" && RS.toggles.knocks) out.push(e);
  }
  return out;
}

// Bullets die zum Cursor-Zeitpunkt in der Luft sind.
// Flugzeit aus Distanz errechnet (750 m/s Durchschnitt → 75 cm/ms).
// Impact-ts - travelMs = fire_ts; Bullet ist sichtbar für fire_ts..impact_ts.
const _BULLET_CM_PER_MS = 75;
const _MAX_BULLET_MS    = 2000;  // längster sinnvoller Schuss ~1500 m

function activeStreaks(ms) {
  if (!RS.toggles.streaks) return [];
  const out = [];
  for (const e of RS.replay.events) {
    if (e.ts > ms + _MAX_BULLET_MS) break;
    if (e.type !== "hit") continue;
    const dist     = e.distance ?? 0;
    const travelMs = Math.max(30, dist / _BULLET_CM_PER_MS);
    const fireTs   = e.ts - travelMs;
    if (ms < fireTs || ms > e.ts) continue;
    out.push({ ...e, t: (ms - fireTs) / travelMs });  // t: 0=abgefeuert, 1=Einschlag
  }
  return out;
}

function teamColorOf(acc) {
  const tid = RS._accTeam[acc];
  return RS._teamColor[tid] || "#888";
}

// Zone zum Cursor-Zeitpunkt.
// safeZone (blau) interpoliert smooth zwischen Events.
// nextZone (weiß gestrichelt) wird sofort aus dem letzten Event genommen —
// keine Animation, da sie als "angekündigt" gilt und sofort erscheinen soll.
function currentZone(ms) {
  let prev = null, next = null;
  for (const e of RS.replay.events) {
    if (e.type !== "zone") continue;
    if (e.ts <= ms) prev = e;
    else if (!next) { next = e; break; }
  }
  if (!prev) return next || null;
  if (!next) return prev;
  const t = (ms - prev.ts) / Math.max(1, next.ts - prev.ts);
  const lerp = (a, b) => a == null || b == null ? (a ?? b) : a + (b - a) * t;
  return {
    safeX: lerp(prev.safeX, next.safeX), safeY: lerp(prev.safeY, next.safeY),
    safeR: lerp(prev.safeR, next.safeR),
    // nextZone: sofort aus prev (keine Interpolation)
    nextX: prev.nextX, nextY: prev.nextY, nextR: prev.nextR,
  };
}

// Canvas-Radius aus normalisiertem Radius: Mitte + Randpunkt projizieren,
// Pixel-Distanz nehmen (uebernimmt Zoom + Kalibrierungs-Scale automatisch).
function zoneRadiusPx(cx, cy, rNorm) {
  const [px, py] = projToCanvas(cx, cy);
  const [ex, ey] = projToCanvas(cx + rNorm, cy);
  return Math.hypot(ex - px, ey - py);
}

// 8×8-Kalibrier-Raster: zwei Gitter uebereinander.
//   - bildbasiert (projRaw, weiss): teilt das Kartenbild gleichmaessig
//   - kalibriert (projToCanvas, cyan): Welt-Gitter durch pinCalibration,
//     gleiche Projektion wie die Pins
// Decken sie sich → Kalibrierung stimmt; Versatz zeigt den Fehler.
function drawGrid(ctx) {
  const N = 8;
  function gridWith(projFn, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([]);
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      // vertikale Linie f über volle Höhe (0..1 in y)
      ctx.beginPath();
      let [x0, y0] = projFn(f, 0);
      let [x1, y1] = projFn(f, 1);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      // horizontale Linie f über volle Breite (0..1 in x)
      ctx.beginPath();
      [x0, y0] = projFn(0, f);
      [x1, y1] = projFn(1, f);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }
  ctx.globalAlpha = 0.5;
  gridWith(projRaw, "rgba(255,255,255,0.9)", 1);          // Bild-Raster
  gridWith(projToCanvas, "rgba(60,200,255,0.9)", 1);      // kalibriertes Raster
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

// Flugzeug-Position zum Cursor-Zeitpunkt interpolieren.
// Gibt {x,y} (normalisiert) oder null zurück.
function flightPosAt(ms) {
  const fp = RS.replay.flightPath;
  if (!fp || fp.length < 2) return null;
  if (ms < fp[0][2]) return null;
  if (ms > fp[fp.length - 1][2]) return null;
  for (let i = 1; i < fp.length; i++) {
    if (fp[i][2] >= ms) {
      const a = fp[i - 1], b = fp[i];
      const t = (ms - a[2]) / Math.max(1, b[2] - a[2]);
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t };
    }
  }
  return null;
}

function drawFlightRoute(ctx, ms) {
  const fp = RS.replay.flightPath;
  if (!fp || fp.length < 2) return;

  // Richtungsvektor aus ersten + letzten bekannten Punkt
  const first = fp[0], last = fp[fp.length - 1];
  const dx = last[0] - first[0], dy = last[1] - first[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len;

  // Linie über gesamte Kartenbreite extrapolieren (canvas clippt automatisch)
  const ext = 3;
  const [ex0, ey0] = projToCanvas(first[0] - nx * ext, first[1] - ny * ext);
  const [ex1, ey1] = projToCanvas(last[0]  + nx * ext, last[1]  + ny * ext);
  ctx.strokeStyle = "rgba(242,183,5,0.45)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 8]);
  ctx.beginPath(); ctx.moveTo(ex0, ey0); ctx.lineTo(ex1, ey1); ctx.stroke();
  ctx.setLineDash([]);

  // Bekannter Pfad kräftiger darüber
  ctx.strokeStyle = "rgba(242,183,5,0.7)";
  ctx.lineWidth = 1.8;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  for (let i = 0; i < fp.length; i++) {
    const [cx, cy] = projToCanvas(fp[i][0], fp[i][1]);
    if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
  }
  ctx.stroke();
  ctx.setLineDash([]);


  // Flugzeug-Icon als Dreieck am aktuellen Punkt
  const pos = flightPosAt(ms);
  if (!pos) return;
  const [px, py] = projToCanvas(pos.x, pos.y);
  // Flugrichtung aus dem Pfad ableiten
  let vx = 0, vy = 0;
  for (let i = 1; i < fp.length; i++) {
    if (fp[i][2] >= ms) {
      vx = fp[i][0] - fp[i - 1][0];
      vy = fp[i][1] - fp[i - 1][1];
      break;
    }
  }
  const angle = Math.atan2(vy, vx);
  const sz = 8;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.fillStyle = "rgba(242,183,5,0.95)";
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sz, 0);
  ctx.lineTo(-sz, -sz * 0.6);
  ctx.lineTo(-sz * 0.4, 0);
  ctx.lineTo(-sz, sz * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function renderFrame() {
  const cnv = document.getElementById("map");
  const ctx = cnv.getContext("2d");
  drawBasemap(ctx);
  if (!RS.replay) return;
  const ms = RS.cursorMs;

  // 0a) Flugroute (unter allem anderen)
  drawFlightRoute(ctx, ms);

  // 0b) Bluezone: aktuelle Safe-Zone (durchgezogen) + naechste weisse Zone
  //    (gestrichelt). Liegt unter Streaks/Markern/Pins.
  const zone = RS.toggles.zones ? currentZone(ms) : null;
  if (zone) {
    if (zone.safeR) {
      const [sx, sy] = projToCanvas(zone.safeX, zone.safeY);
      ctx.strokeStyle = "#3aa0ff";
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(sx, sy, zoneRadiusPx(zone.safeX, zone.safeY, zone.safeR),
              0, Math.PI * 2);
      ctx.stroke();
    }
    if (zone.nextR) {
      const [nx, ny] = projToCanvas(zone.nextX, zone.nextY);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(nx, ny, zoneRadiusPx(zone.nextX, zone.nextY, zone.nextR),
              0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 1) Bullet-Streaks — kurzer Screen-Space-Strich an der aktuellen Bullet-Position
  for (const s of activeStreaks(ms)) {
    // Bullet-Kopf interpoliert zwischen Schütze und Ziel
    const bx = s.ax + (s.tx - s.ax) * s.t;
    const by = s.ay + (s.ty - s.ay) * s.t;
    const [hpx, hpy] = projToCanvas(bx, by);
    // Richtungsvektor in Screen-Space (von Quelle → Ziel)
    const [apx, apy] = projToCanvas(s.ax, s.ay);
    const [tpx, tpy] = projToCanvas(s.tx, s.ty);
    const dx = tpx - apx, dy = tpy - apy;
    const len = Math.hypot(dx, dy) || 1;
    const streak = 4;  // px
    ctx.strokeStyle = teamColorOf(s.actorId);
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(hpx - dx / len * streak, hpy - dy / len * streak);
    ctx.lineTo(hpx, hpy);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 1b) Comeback-Linien (gestrichelt, Team-Farbe) zwischen Last-Pos
  // vor Tod und Landing nach Comeback-Heli — PUBG liefert keine
  // Heli-Position-Events, daher diese Visual-Bruecke.
  if (RS._comebackLines) {
    for (const acc of Object.keys(RS._comebackLines)) {
      const tid = RS._accTeam[acc];
      const color = RS._teamColor[tid] || "#888";
      for (const cb of RS._comebackLines[acc]) {
        if (ms < cb.deathTs) continue;  // noch nicht gestorben
        const [x0, y0] = projToCanvas(cb.x0, cb.y0);
        const [x1, y1] = projToCanvas(cb.x1, cb.y1);
        // Fade nach Reland in den naechsten 30s auf Alpha 0.3
        const sinceReland = ms - cb.relandTs;
        let alpha = 0.75;
        if (sinceReland > 0) alpha = Math.max(0.25, 0.75 - sinceReland / 30000 * 0.5);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
  }

  // 2) Spieler-Pins — eigener Spieler als Pfeilnadel (◆ + Halo)
  const heroAcc = RS.replay.heroAccountId ?? null;
  const nameScale = Math.max(12, Math.min(18, 18 / RS.view.zoom));
  // Nicht-Hero zuerst, dann Hero obendrauf
  const accList = Object.keys(RS._accTeam);
  const sorted = [...accList.filter(a => a !== heroAcc),
                  ...accList.filter(a => a === heroAcc)];

  // Pre-Pass: Gruppen von Team-Mates am SELBEN Spot finden (= Auto-
  // Insassen nach Shared-Vehicle-Unifikation). Pro Gruppe spaeter nur
  // EIN Name + "+N" rendern. Hero wird bevorzugter Leader, sonst der
  // erste in sorted-Order.
  const _grpByKey = {};
  const _posOf = {};
  for (const acc of sorted) {
    const p = posAt(acc, ms);
    if (!p) continue;
    _posOf[acc] = p;
    const tid = RS._accTeam[acc];
    if (tid == null) continue;
    const [px, py] = projToCanvas(p.x, p.y);
    // 5px-Bucket: bei perfekt unifizierten Auto-Spuren liegen alle exakt
    // auf einem Pixel. Tolerance fuer leichte Driften.
    const key = `${tid}|${Math.round(px / 5)}|${Math.round(py / 5)}`;
    (_grpByKey[key] = _grpByKey[key] || []).push(acc);
  }
  // Pro acc: ist er Leader seiner Gruppe? Und wie viele follower?
  const _grpMeta = {};  // acc → {isLeader, count}
  for (const accs of Object.values(_grpByKey)) {
    if (accs.length < 2) continue;
    // Hero bevorzugen, sonst erster Eintrag
    const leader = accs.find(a => a === heroAcc) || accs[0];
    for (const a of accs) {
      _grpMeta[a] = { isLeader: a === leader, count: accs.length };
    }
  }

  for (const acc of sorted) {
    const p = _posOf[acc];
    if (!p) continue;
    const [px, py] = projToCanvas(p.x, p.y);
    const tid = RS._accTeam[acc];
    const focused = RS.focusedTeam == null || RS.focusedTeam === tid;
    const isHero = acc === heroAcc;
    if (isHero) {
      // Äußerer Glow-Ring
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      // Diamant-Pin (◆)
      const d = 8;
      ctx.fillStyle = RS._teamColor[tid] || "#fff";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px,     py - d);
      ctx.lineTo(px + d, py);
      ctx.lineTo(px,     py + d);
      ctx.lineTo(px - d, py);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // Teamnummer
      ctx.fillStyle = "#000";
      ctx.font = "bold 8px DM Sans";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(tid), px, py);
      // Name immer sichtbar (Hero ist Leader bei Vehicle-Group)
      if (RS.toggles.names) {
        const meta = _grpMeta[acc];
        if (!meta || meta.isLeader) {
          const suffix = (meta && meta.count > 1) ? ` +${meta.count - 1}` : "";
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${nameScale}px DM Sans`;
          ctx.textAlign = "left"; ctx.textBaseline = "bottom";
          ctx.fillText((RS._accName[acc] || "") + botSuffix(acc) + suffix,
                       px + 10, py - 7);
        }
      }
    } else {
      // Team-Farbe immer voll — kein Ausgrauen mehr. Stattdessen
      // markiert ein Ring (gold) Mitglieder des fokussierten Teams.
      const isFocusedTeam = (RS.focusedTeam != null && RS.focusedTeam === tid);
      if (isFocusedTeam) {
        ctx.strokeStyle = "#f2b705";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = RS._teamColor[tid];
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = "bold 8px DM Sans";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(tid), px, py);
      if (RS.toggles.names) {
        const meta = _grpMeta[acc];
        if (!meta || meta.isLeader) {
          const suffix = (meta && meta.count > 1) ? ` +${meta.count - 1}` : "";
          ctx.fillStyle = RS._teamColor[tid] || "#fff";
          ctx.font = `${isFocusedTeam ? "bold " : ""}${nameScale}px DM Sans`;
          ctx.textAlign = "left"; ctx.textBaseline = "bottom";
          ctx.fillText((RS._accName[acc] || "") + botSuffix(acc) + suffix,
                       px + 7, py - 5);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // 3) Kill/Knock-Marker (X) — nach den Pins, damit sie nicht verdeckt werden
  const heroTeamId = RS.replay.heroTeamId ?? null;
  const heroColor2 = RS._teamColor[heroTeamId] || "#fff";
  for (const e of markersUpTo(ms)) {
    const [emx, emy] = projToCanvas(e.tx, e.ty);
    const victimTeam = RS._accTeam[e.targetId];
    const isHeroVictim = heroTeamId !== null && victimTeam === heroTeamId;
    const sz = e.type === "kill" ? 6 : 5;
    if (isHeroVictim) {
      const r = e.type === "kill" ? 14 : 10;
      ctx.strokeStyle = e.type === "kill" ? "#ff3a3a" : heroColor2;
      ctx.lineWidth = e.type === "kill" ? 2.5 : 1.5;
      ctx.globalAlpha = 0.9;
      if (e.type === "knock") ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(emx, emy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = isHeroVictim
      ? (e.type === "kill" ? "#ff3a3a" : heroColor2)
      : teamColorOf(e.actorId);
    ctx.globalAlpha = e.type === "kill" ? 1 : 0.85;
    ctx.lineWidth = isHeroVictim ? 2.5 : 2;
    ctx.beginPath();
    ctx.moveTo(emx - sz, emy - sz); ctx.lineTo(emx + sz, emy + sz);
    ctx.moveTo(emx + sz, emy - sz); ctx.lineTo(emx - sz, emy + sz);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 4) Kalibrier-Raster (ganz oben, damit beide Gitter sichtbar sind)
  if (RS.toggles.grid) drawGrid(ctx);
}

// Toggle-Checkboxen verdrahten
["Kills", "Knocks", "Streaks", "Zones", "Names", "Grid"].forEach(k => {
  const cb = document.getElementById("tgl" + k);
  cb.addEventListener("change", () => {
    RS.toggles[k.toLowerCase()] = cb.checked;
    renderFrame();
  });
});

// --- Task 10: Wiedergabe-Steuerung ---

function tick(wallNow) {
  const dt = wallNow - (RS.lastFrameWall || wallNow);
  RS.lastFrameWall = wallNow;

  // Smooth-Zoom: Ansicht per Exponential-Lerp zum Zielwert interpolieren (tau ≈ 100 ms)
  const lf = 1 - Math.exp(-dt / 100);
  const v = RS.view;
  const zDiff = v.tZoom - v.zoom, xDiff = v.tPanX - v.panX, yDiff = v.tPanY - v.panY;
  const animating = Math.abs(zDiff) > 0.0005 || Math.abs(xDiff) > 0.2 || Math.abs(yDiff) > 0.2;
  if (animating) {
    v.zoom += zDiff * lf;
    v.panX += xDiff * lf;
    v.panY += yDiff * lf;
  }

  if (RS.playing && RS.replay) {
    RS.cursorMs += dt * RS.speed;
    if (RS.cursorMs >= RS.replay.durationMs) {
      RS.cursorMs = RS.replay.durationMs;
      RS.playing = false;
      document.getElementById("playPause").textContent = "▶";
    }
    // Follow-Mode: bei Zeit-Aenderung die Karte aufs Team re-centern
    if (RS.followTeam != null) panToTeam(RS.followTeam);
    syncScrubberAndClock();
    updateTeamListDeadState(RS.cursorMs);
    renderFrame();
  } else if (animating) {
    renderFrame();
  }
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
  // Follow-Mode: auch bei manuellem Scrubber-Drag Karte aufs Team re-centern
  if (RS.followTeam != null) panToTeam(RS.followTeam);
  syncScrubberAndClock();
  updateTeamListDeadState(RS.cursorMs);
  renderFrame();
});

document.getElementById("speedSelect").addEventListener("change", e => {
  RS.speed = Number(e.target.value);
});

// --- Task 11: Zoom, Pan, Hover-Tooltips ---

const stageEl = () => document.querySelector(".stage");

stageEl().addEventListener("wheel", e => {
  e.preventDefault();
  const cnv = document.getElementById("map");
  const r = cnv.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newZoom = Math.max(0.5, Math.min(20, RS.view.tZoom * factor));
  const ratio = newZoom / RS.view.tZoom;
  const hw = cnv.width / 2, hh = cnv.height / 2;
  RS.view.tPanX = mx - hw - (mx - hw - RS.view.tPanX) * ratio;
  RS.view.tPanY = my - hh - (my - hh - RS.view.tPanY) * ratio;
  RS.view.tZoom = newZoom;
  // Wheel-Zoom laesst Follow aktiv — du kannst beim verfolgten Team
  // einfach reinzoomen. Nur Drag (mousedown) bricht den Follow ab.
}, { passive: false });

let _drag = null;
stageEl().addEventListener("mousedown", e => {
  _drag = { x: e.clientX, y: e.clientY,
            px: RS.view.tPanX, py: RS.view.tPanY };
  RS.followTeam = null;  // Manueller Pan → Follow aus
});
window.addEventListener("mousemove", e => {
  if (!_drag) return;
  RS.view.panX = RS.view.tPanX = _drag.px + (e.clientX - _drag.x);
  RS.view.panY = RS.view.tPanY = _drag.py + (e.clientY - _drag.y);
  renderFrame();
});
window.addEventListener("mouseup", () => { _drag = null; });

const TOOLTIP = () => document.getElementById("tooltip");

// POI-Name fuer eine normalisierte Position. Die Event-Coords sind ROH-
// normalisiert (build_replay: cm/span ohne Kalibrierung), Regionen liegen
// im selben Weltsystem → cm zurueckrechnen und PubgUI.POI.fromCoords nutzen.
function poiAt(nx, ny) {
  if (!RS.replay || nx == null) return null;
  const span = (RS.replay.mapKm || 8) * 100000;
  return PubgUI.POI.fromCoords(RS.replay.mapName, nx * span, ny * span);
}

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
      const poi = poiAt(p.x, p.y);
      const loc = poi ? ` · ${poi}` : "";
      return `Team ${tid} · ${RS._accName[acc]} · ${k} Kills · ${kn} Knocks${loc}`;
    }
  }
  // 2) Kill/Knock-Marker (8px)
  for (const e of markersUpTo(ms)) {
    const [ex, ey] = projToCanvas(e.tx, e.ty);
    if (Math.hypot(ex - mx, ey - my) <= 8) {
      const verb = e.type === "kill" ? "killed" : "knocked";
      const dist = e.distance != null ? Math.round(e.distance / 100) + "m" : "?";
      const wp = (e.weapon || "?").replace(/^Weap/, "").replace(/_C$/, "");
      const poi = poiAt(e.tx, e.ty);
      const loc = poi ? ` · ${poi}` : "";
      return `${RS._accName[e.targetId] || "?"} ${verb} by `
           + `${RS._accName[e.actorId] || "?"} · ${wp} · ${dist}${loc}`;
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
