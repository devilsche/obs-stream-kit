// tools/match-replay.js
const RS = {
  replay: null,         // geladenes Replay-Dict
  focusedTeam: null,    // team_id oder null
  playing: false,
  cursorMs: 0,
  speed: 1,
  lastFrameWall: 0,
  toggles: { kills: true, knocks: true, streaks: true, zones: true, names: true,
             grid: false },
  view: { zoom: 1, panX: 0, panY: 0 },  // zoom: Faktor, pan: Pixel-Offset
};

async function loadMatchList() {
  const sel = document.getElementById("matchSelect");
  const list = await PubgUI.fetchJson("/api/pubg/matches-list?limit=50");
  sel.innerHTML = list.map(m => {
    const d = new Date(m.playedAt);
    const dt = d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit",
              hour: "2-digit", minute: "2-digit" });
    const mapShort = PubgUI.fmtMap(m.mapName);
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
  const poiResp = await PubgUI.fetchJson(
    "/api/pubg/pois?map=" + encodeURIComponent(alias));
  RS._poiBlob = (poiResp && poiResp.data) || poiResp;
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
  // High-Res .png zuerst (Symlinks aus api-assets via refresh-maps, wie
  // im Session-Report), .webp als Fallback.
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => {
      const img2 = new Image();
      img2.onload = () => res(img2);
      img2.onerror = () => res(null);
      img2.src = "/widgets/pubg/maps/" + mapName + ".webp";
    };
    img.src = "/widgets/pubg/maps/" + mapName + ".png";
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
  const [x0, y0] = projRaw(0, 0);
  const [x1, y1] = projRaw(1, 1);
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
  // Erster Track-Timestamp pro Spieler = erster Moment mit z < 150000 (Fallschirm/Boden).
  // Davor zeigt posAt() die Flugzeugposition; danach Track-Interpolation (Fallschirm + Boden).
  RS._firstTrackTs = {};
  for (const [acc, tr] of Object.entries(tracks)) {
    if (tr.length) RS._firstTrackTs[acc] = tr[0].ts;
  }
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
  // Noch im Flieger: vor dem ersten Track-Event (z<150000) → Flugzeugposition.
  // Strikt auf das bekannte Flight-Path-Fenster begrenzen → kein "null-Loch"
  // zwischen Flugzeug-Ende und erstem Boden-Event mehr.
  const firstTrackTs = RS._firstTrackTs[acc] ?? Infinity;
  if (ms < firstTrackTs) {
    const fp = RS.replay.flightPath;
    if (fp && fp.length && ms >= fp[0][2] && ms <= fp[fp.length - 1][2])
      return flightPosAt(ms);
    return null;
  }
  // Ab erstem Track-Event: Track-Interpolation (deckt Fallschirm-Descent + Boden ab).
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

  // Marker: erster Absprung (grün) + letzter Spieler verlässt Flieger (rot)
  // Basis: erster Track-Event pro Spieler = Zeitpunkt des Absprungs (z<150000)
  const allJumpTs = Object.values(RS._firstTrackTs || {});
  const firstJumpTs = allJumpTs.length ? Math.min(...allJumpTs) : Infinity;
  const lastJumpTs  = allJumpTs.length ? Math.max(...allJumpTs) : -Infinity;
  function drawJumpMarker(flightMs, color, label) {
    const p = flightPosAt(flightMs);
    if (!p) return;
    const [jx, jy] = projToCanvas(p.x, p.y);
    ctx.fillStyle = color;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(jx, jy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px DM Sans";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(label, jx, jy - 6);
  }
  if (firstJumpTs !== Infinity)  drawJumpMarker(firstJumpTs, "#3cdb5e", "▼");
  if (lastJumpTs !== -Infinity)  drawJumpMarker(lastJumpTs,  "#ff4444", "▼");

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

  // 2) Spieler-Pins — eigener Spieler als Pfeilnadel (◆ + Halo)
  const heroAcc = RS.replay.heroAccountId ?? null;
  const nameScale = Math.max(8, Math.min(12, 12 / RS.view.zoom));
  // Nicht-Hero zuerst, dann Hero obendrauf
  const accList = Object.keys(RS._accTeam);
  const sorted = [...accList.filter(a => a !== heroAcc),
                  ...accList.filter(a => a === heroAcc)];
  for (const acc of sorted) {
    const p = posAt(acc, ms);
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
      // Name immer sichtbar
      if (RS.toggles.names) {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${nameScale}px DM Sans`;
        ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(RS._accName[acc] || "", px + 10, py - 7);
      }
    } else {
      ctx.fillStyle = focused ? RS._teamColor[tid] : "#bbb";
      ctx.globalAlpha = focused ? 1 : 0.7;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = "bold 8px DM Sans";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(tid), px, py);
      if (RS.toggles.names) {
        ctx.globalAlpha = focused ? 1 : 0.5;
        ctx.fillStyle = RS._teamColor[tid] || "#fff";
        ctx.font = `${nameScale}px DM Sans`;
        ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(RS._accName[acc] || "", px + 7, py - 5);
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
  const cnv = document.getElementById("map");
  const r = cnv.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newZoom = Math.max(0.5, Math.min(20, RS.view.zoom * factor));
  // Mausposition beim Zoomen als Ankerpunkt
  RS.view.panX = mx - (mx - RS.view.panX) * (newZoom / RS.view.zoom);
  RS.view.panY = my - (my - RS.view.panY) * (newZoom / RS.view.zoom);
  RS.view.zoom = newZoom;
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
