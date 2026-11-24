/* Car Drive – das Rennen selbst fahren (tools/car-drive.html, Admin, Vollbild). three r128.
 * Menü (Auto, Farbset, Strecke, Gegner 0–7, Runden 1–5) → Laden (volle Modelle, je Auto ToyCars.mergeForRace) →
 * Startaufstellung + Countdown → Rennen → Ergebnis.
 *
 * Spieler: eigene Arcade-Fahrphysik (js/car-drive-phys.js), Werte aus CarRaceStats.of → CarRaceSim.stats (gleiche
 * Spielzeug-Größen wie die Gegner). Gegner: CarRaceSim (Ideallinie, gleiche Werte; der Spieler ist NICHT in der Sim),
 * fester Schritt 1/60 s, dargestellt interpoliert. Kontakt Spieler ↔ Gegner: Stoß nach Masse (st.mass) – der Spieler
 * wird verschoben/gebremst, beim Gegner ändern sich Tempo (c.v) und Seitenversatz (c.d) in der Sim.
 * Strecke: js/car-track-scene.js (aus car-race.js herausgelöst). Bühne/Licht: js/car-stage.js.
 * Kameras: Verfolger (Standard, geglättet), Motorhaube, TV (Streckenkameras, wechseln mit dem Auto).
 * Steuerung: Tastatur + Gamepad-API (Standard-Belegung). Bestzeit je Auto + Strecke in localStorage.
 * Keine Inline-Styles: Zustände über Klassen, data-Attribute und hidden; Farben im WebGL aus Theme-Proben (.tk-*).
 *
 * Mehrspieler (Schritt 2): Netz js/car-drive-net.js, Dienst drive_ws.py, Räume fx/drive_room.py.
 *   Streamer (diese Seite unter /app/tools/car-drive): „Host multiplayer“ öffnet einen Raum (POST /s/<token>/api/fx/car-drive
 *   ?cmd=open&host=1, Body = Grenzwerte je Auto für die Plausibilitätsprüfung), zeigt Code/Link, startet das Rennen
 *   (cmd=start) und fährt selbst mit. Zuschauer: dieselbe Seite unter /drive/<code> (window.__DRIVE__, data-mode="viewer"),
 *   Twitch-Anmeldung, Auto aus der Garage oder Zufall, Grafik leicht (.race.glb, 0,75 Auflösung) oder voll.
 *   Im Rennen: keine KI; Fremdautos aus dem Server-Takt (100 ms Puffer, interpoliert), Kontakt schubst nur das eigene
 *   Auto (nach Masse), Countdown/Start/Ergebnis vom Server.
 *
 * Chatrennen steuerbar (Schritt 2b, data-mode="race", /drive/race/<kanal>): dieselbe Seite ohne Menü. Wer im Chat
 * !race getippt hat und mit Twitch angemeldet ist, sitzt sofort im zugeteilten Auto auf seinem Startplatz (Sim-Aufstellung
 * aus seed), wartet auf den Start (Server-Uhr) und fährt dann selbst; Zustände gehen über /drive-ws/race an die
 * Overlays. KI-Gegner aus derselben Sim wie im Overlay (andere Piloten als Geister), andere Piloten live, von der KI
 * übernommene Autos über CarRaceSim.follower. Kontakt schubst nur das eigene Auto. Nicht rechtzeitig verbunden oder
 * übernommen: Zuschauen (Kamera auf dem eigenen Auto). Ergebnis + Punkte kommen aus dem Chatrennen (state.result).
 * Wer im Countdown dazukommt (oder Auto/Lack tauscht), wird in der Startaufstellung nachgebaut (rcRebuildGrid).
 *
 * Wertung: wer im Ziel ist, behält seinen Platz (Zielzeit, sonst Reihenfolge des Zieleinlaufs) – nur Autos ohne Ziel
 * werden nach Fortschritt dahinter sortiert (wie js/car-race.js); Platz nach dem Ziel = Server-Ergebnis, sobald da.
 * Rundenrekorde: Mehrspieler/Chatrennen vom Server (geprüfte Runden, fx_race_lap_record, Meldung „rec“ über den WS),
 * solo nur lokal (localStorage je Auto + Strecke und je Strecke), der Server-Streckenrekord wird nur angezeigt.
 * Effekte: Bremsspuren + Qualm (js/car-drive-fx.js), Klänge (js/car-race-sound.js, nach der ersten Eingabe, M = stumm),
 * Motoren aus echten Aufnahmen (js/car-engine-audio.js, Motorart je Auto aus CarRaceStats engine).
 * Vor dem Start (Countdown): Kamera mit Maus/Touch/rechtem Stick um das eigene Auto drehen, Mausrad/Pinch zoomt.
 * Tempogefühl (nur Optik/Klang, Fahrphysik und Zeiten unverändert), alles nach Tempo / vtop des eigenen Autos:
 * Verfolger tiefer und näher bei Tempo, bleibt beim Beschleunigen zurück, rückt beim Bremsen heran, Sichtfeld bis
 * +20° (Haube +16°, Nitro etwas mehr), leichtes Neigen in Kurven, hochfrequentes Rütteln nach Untergrund (Asphalt
 * kaum, Randstein/Kies deutlich); Fahrtwind-Streifen + Vignette am Bildrand ab ~60 % vtop, verwischter Asphalt,
 * verwischte Felgen (js/car-drive-fx.js speed), Leitpfosten/Chevrons an der Strecke (js/car-track-surface.js),
 * Fahrtwind + Abrollgeräusch (car-race-sound.js wind/tyres). Reduzierte Bewegung: kein Rütteln/Neigen/Streifen,
 * Sichtfeld- und Kamera-Änderungen deutlich schwächer.
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, TC = root.ToyCars, Sim = root.CarRaceSim, Stats = root.CarRaceStats, Phys = root.CarDrivePhys, Net = root.CarDriveNet;
  var CFG = root.__DRIVE__ || null, VIEWER = !!(CFG && CFG.mode === 'viewer'), RACE = !!(CFG && CFG.mode === 'race');
  var doc = root.document;
  function $(id) { return doc.getElementById(id); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function damp(k, dt) { return 1 - Math.exp(-k * dt); }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function cleanName(n) {
    return String(n || '').replace(/\|\s*www\.\S+/gi, '').replace(/\[\s*free\s*\]/gi, '').replace(/\bfree\b/gi, '')
      .replace(/\s{2,}/g, ' ').replace(/^[\s|\-–·]+|[\s|\-–·]+$/g, '');
  }
  function fmt(t) {
    if (!(t >= 0) || !isFinite(t)) return '–';
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  }
  var LS = 'carDrive.';
  function load(k, def) { try { var v = root.localStorage.getItem(LS + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function save(k, v) { try { root.localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* privat/gesperrt */ } }
  var REDUCE = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!THREE || !TC || !Sim || !Stats || !Phys || !root.CarTrackScene) {
    var st0 = $('menuStatus'); if (st0) st0.textContent = 'Scripts failed to load – reload the page.';
    return;
  }

  // ---- Renderer / Szene ----
  var app = $('app'), canvas = $('view');
  app.dataset.mode = VIEWER ? 'viewer' : RACE ? 'race' : 'solo';
  var renderScale = 1;   // Zuschauer „Light“: 0,75
  // alpha: ohne Strecke (Menü, Lobby) bleibt die Szene durchsichtig, dahinter liegt der Theme-Hintergrund (.app);
  // den Himmel setzt erst die Strecke (car-track-scene applyEnv) und nimmt ihn beim Abbau wieder weg.
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = true;   // Enten-Fahrer an der Karosserie abschneiden
  var scene = new THREE.Scene();
  if (root.CarStage) CarStage.setup(renderer, scene, { exposure: 1.1 });
  var cam = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 3000);
  cam.position.set(0, 60, 80); cam.lookAt(0, 0, 0);
  var maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  function resize() {
    var w = Math.max(64, app.clientWidth || root.innerWidth), h = Math.max(36, app.clientHeight || root.innerHeight);
    renderer.setPixelRatio(Math.min(1.5, root.devicePixelRatio || 1) * renderScale);
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  resize();
  root.addEventListener('resize', resize);
  var FX = root.CarDriveFx ? root.CarDriveFx.create(THREE, scene, cam, { reduce: REDUCE }) : null;
  // Tempogefühl: Fahrtwind-Streifen + Vignette, verwischte Felgen (js/car-drive-fx.js), siehe speedFrame
  var SPD = root.CarDriveFx && root.CarDriveFx.speed ? root.CarDriveFx.speed(THREE, scene, { reduce: REDUCE }) : null;

  function tokenColor(cls, fb) {
    var el = doc.querySelector('.' + cls), c = el && getComputedStyle(el).color;
    return c || fb;
  }
  var shadowTex = (function () {
    var c = doc.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();

  // ---- Menü ----
  var ui = {
    search: $('carSearch'), list: $('carList'), info: $('carInfo'), paint: $('paintSel'), track: $('trackSel'),
    opp: $('oppRange'), oppOut: $('oppOut'), laps: $('lapRange'), lapOut: $('lapOut'), duck: $('duckChk'),
    form: $('menuForm'), status: $('menuStatus'), menu: $('menu'), loading: $('loading'), loadBar: $('loadBar'),
    loadText: $('loadText'), pause: $('pause'), finish: $('finish'), results: $('results'), finishBest: $('finishBest'),
    hud: $('hud'), countdown: $('countdown'), announce: $('announce'), fs: $('fsBtn'),
    lobby: $('lobby'), signin: $('signin'), roster: $('roster'), lobbyStatus: $('lobbyStatus'),
    finishNote: $('finishNote')
  };
  var catalog = [], byKey = {};
  var pref = load('menu', {}) || {};
  // Begrüßung vor dem Countdown (js/car-race-welcome.js, Aussehen widgets/components/car-race-welcome.css)
  var welcomeUi = root.CarRaceWelcome && $('welcome') ? CarRaceWelcome.attach($('welcome')) : null;

  Sim.TRACKS.forEach(function (seed, i) {
    var T = Sim.track(seed), o = doc.createElement('option');
    o.value = String(i); o.textContent = T.name + ' – ' + T.character + ', ' + Math.round(T.len) + ' m';
    ui.track.appendChild(o);
  });
  ui.track.value = String(clamp(pref.track | 0, 0, Sim.TRACKS.length - 1));
  ui.opp.value = String(pref.opp != null ? clamp(pref.opp | 0, 0, 7) : 5);
  ui.laps.value = String(pref.laps != null ? clamp(pref.laps | 0, 1, 5) : 2);   // lange Strecken: 2 Runden ≈ 2:20
  if (pref.duck === false) ui.duck.checked = false;
  function syncOutputs() { ui.oppOut.textContent = ui.opp.value; ui.lapOut.textContent = ui.laps.value; }
  ui.opp.addEventListener('input', syncOutputs); ui.laps.addEventListener('input', syncOutputs); syncOutputs();

  function displayName(e) { return cleanName(TC.vehicle(e.key).name || e.name || e.key); }
  // Zuschauer: nur Autos aus der eigenen Garage plus ein Zufallsauto (vom Server ausgelost, Ticket)
  var viewerCars = null;
  function listPool() {
    if (!VIEWER) return catalog;
    if (!viewerCars) return [];
    // Zuschauer: Zufallsauto + Garage fahrbar, alle übrigen fahrbaren Autos gesperrt mit Preis (Anreiz für !buy).
    // Der Streamer (all) darf jedes Auto fahren.
    var out = [], seen = {}, prices = viewerCars.prices || {};
    if (viewerCars.rnd && byKey[viewerCars.rnd] && !viewerCars.all) { out.push({ e: byKey[viewerCars.rnd], rnd: true }); seen[viewerCars.rnd] = 1; }
    (viewerCars.garage || []).forEach(function (k) { if (byKey[k] && !seen[k]) { out.push({ e: byKey[k] }); seen[k] = 1; } });
    out.sort(function (a, b) { return a.rnd ? -1 : b.rnd ? 1 : displayName(a.e).localeCompare(displayName(b.e)); });
    catalog.forEach(function (e) { if (!seen[e.key] && prices[e.key] != null) out.push({ e: e, price: prices[e.key] }); });
    return out;
  }
  function fillList() {
    var q = ui.search.value.trim().toLowerCase(), cur = ui.list.value || pref.car;
    ui.list.textContent = '';
    var shown = 0;
    listPool().forEach(function (x) {
      var e = x.e || x, label = (x.rnd ? 'Random car: ' : '') + displayName(e), hay = (label + ' ' + (e.brand || '') + ' ' + e.key).toLowerCase();
      if (q && hay.indexOf(q) < 0) return;
      var o = doc.createElement('option'); o.value = e.key; o.textContent = label + (e.brand ? ' (' + e.brand + ')' : '');
      if (x.price != null) { o.disabled = true; o.textContent += ' – locked · !buy for ' + x.price + ' coins'; }
      ui.list.appendChild(o); shown++;
    });
    if (cur && byKey[cur] && ui.list.querySelector('option[value="' + CSS.escape(cur) + '"]:not([disabled])')) ui.list.value = cur;
    else if (ui.list.querySelector('option:not([disabled])')) ui.list.value = ui.list.querySelector('option:not([disabled])').value;
    carChanged();
    if (!shown) ui.info.textContent = VIEWER && !viewerCars ? '' : 'No car matches “' + ui.search.value + '”.';
  }
  function carChanged() {
    var key = ui.list.value, e = byKey[key];
    ui.paint.textContent = '';
    if (!e) { ui.info.textContent = ''; return; }
    var raw = Stats.of(key, e);
    ui.info.textContent = Math.round(raw.vmax) + ' km/h · 0–100 in ' + raw.acc + ' s · ' + Math.round(raw.hp) + ' hp · ' +
      Math.round(raw.kg) + ' kg · ' + String(raw.drive || 'rwd').toUpperCase() + ' · ' + (+raw.len).toFixed(1) + ' m';
    var paints = TC.vehicle(key).paints;
    if (!Array.isArray(paints) || !paints.length) {
      var o0 = doc.createElement('option'); o0.value = '0'; o0.textContent = 'Original colour'; ui.paint.appendChild(o0);
    } else paints.forEach(function (p, i) {
      var o = doc.createElement('option'); o.value = String(i);
      o.textContent = 'Set ' + (i + 1) + (p.c == null ? ' – original colour' : ' – ' + (typeof p.c === 'number' ? '#' + ('000000' + p.c.toString(16)).slice(-6) : String(p.c)));
      ui.paint.appendChild(o);
    });
    if (pref.car === key && pref.paint != null && ui.paint.options[pref.paint | 0]) ui.paint.value = String(pref.paint | 0);
  }
  ui.search.addEventListener('input', fillList);
  ui.list.addEventListener('change', carChanged);
  ui.status.textContent = 'Loading car catalogue…';
  TC.loadCatalog().then(function (list) {
    catalog = list.slice().sort(function (a, b) { return displayName(a).localeCompare(displayName(b)); });
    catalog.forEach(function (e) { byKey[e.key] = e; });
    ui.status.textContent = catalog.length ? '' : 'The car catalogue is empty.';
    fillList();
    if (VIEWER) viewerInit();
    if (RACE) rcInit();
  }).catch(function () { ui.status.textContent = 'Could not load the car catalogue.'; });

  // ---- Fullscreen ----
  ui.fs.addEventListener('click', function () {
    try {
      if (doc.fullscreenElement) doc.exitFullscreen();
      else if (app.requestFullscreen) app.requestFullscreen();
    } catch (e) { /* nicht erlaubt */ }
  });
  doc.addEventListener('fullscreenchange', function () {
    var on = !!doc.fullscreenElement;
    ui.fs.setAttribute('aria-pressed', on ? 'true' : 'false');
    ui.fs.querySelector('.icon').textContent = on ? 'fullscreen_exit' : 'fullscreen';
    ui.fs.querySelector('.sr-only').textContent = on ? 'Exit fullscreen' : 'Fullscreen';
    setTimeout(resize, 50);
  });

  // ---- Panels ----
  var PANELS = ['menu', 'loading', 'pause', 'finish', 'lobby', 'signin'];
  function showPanel(name) {
    PANELS.forEach(function (p) { ui[p].hidden = p !== name; });
    app.classList.toggle('racing', !name);
    if (name) {
      var f = ui[name].querySelector(name === 'menu' ? '#carList' : 'button:not([hidden]), select, input, a.btn');
      if (f) setTimeout(function () { try { f.focus(); } catch (e) { /* */ } }, 0);
    }
  }
  function say(t) { ui.announce.textContent = t; }
  var msgT = 0;
  function flash(text, secs, big) { var m = $('hMsg'); m.textContent = text; m.classList.add('show'); m.classList.toggle('big', !!big); msgT = secs || 1.5; }

  // ---- Autos ----
  // Räder einsammeln (wie car-race.js setModel): vorn = vorderste Achse oder im Car editor markiert
  function collectWheels(holder, model, len, height) {
    holder.position.set(0, 0, 0); holder.rotation.set(0, 0, 0); holder.updateMatrixWorld(true);
    var wheels = [];
    model.traverse(function (o) {
      if (!/^Wheel /.test(o.name || '')) return;
      var w = new THREE.Vector3(); o.getWorldPosition(w);
      var spin = o.getObjectByName('Spin'), sgn = 1;
      if (spin) {
        var q = new THREE.Quaternion(); spin.getWorldQuaternion(q);
        var axw = new THREE.Vector3(spin.userData.ax === 'z' ? 0 : 1, 0, spin.userData.ax === 'z' ? 1 : 0).applyQuaternion(q);
        sgn = axw.z >= 0 ? 1 : -1;
      }
      wheels.push({ pivot: o, spin: spin, x: w.x, sgn: sgn, flag: o.userData.front, base: spin ? spin.rotation[spin.userData.ax || 'x'] : 0 });
    });
    wheels = wheels.filter(function (w) {
      var b = new THREE.Box3().setFromObject(w.pivot), sz = new THREE.Vector3(); b.getSize(sz);
      return !b.isEmpty() && sz.x <= len * 0.45 && sz.y <= Math.max(height * 0.9, 0.5);
    });
    var maxX = Math.max.apply(null, wheels.map(function (w) { return w.x; }).concat([-1e9]));
    var flagged = wheels.some(function (w) { return w.flag != null; });
    wheels.forEach(function (w) { w.front = flagged ? !!w.flag : w.x > 0 && w.x > maxX - len * 0.08; });
    return wheels;
  }
  var duckCache = {};
  function addDuck(model, key, outfit) {
    var RD = root.RubberDuck;
    if (!TC.addDriver || !RD) return null;
    var build0 = RD.build, ck = outfit || '';
    RD.build = function (o) {
      if (!duckCache[ck]) duckCache[ck] = build0.call(RD, o);
      return RD.clone ? RD.clone(duckCache[ck]) : duckCache[ck].clone();
    };
    try { return TC.addDriver(model, key, { outfit: outfit || undefined }); } catch (e) { return null; }
    finally { RD.build = build0; }
  }
  // Grundriss des Modells für die Kontakte (CarDrivePhys.overlap): Vertices der Karosserie zwischen 8 und 50 % der
  // Höhe (ohne Räder, Fahrer-Ente, Dach und Spiegelspitzen), je Längsscheibe der äußerste Punkt links/rechts, daraus die
  // konvexe Hülle mit ≤ 16 Ecken in Metern ([vorn, links]); einmal je Auto. Unbrauchbar (zu klein) → null = runde Box.
  var footCache = {};
  function footprint(key, model, d, k) {
    if (Object.prototype.hasOwnProperty.call(footCache, key)) return scaleShape(footCache[key], k);
    var N = 48, lo = new Float32Array(N).fill(Infinity), hi = new Float32Array(N).fill(-Infinity);
    var y0 = -d.H / 2 + d.H * 0.08, y1 = -d.H / 2 + d.H * 0.5, v = new THREE.Vector3(), inv = new THREE.Matrix4();
    try {
      model.updateMatrixWorld(true); inv.copy(model.matrixWorld).invert();
      model.traverse(function (o) {
        if (!o.isMesh || o.isInstancedMesh || o.userData.driver || !o.geometry || !o.geometry.attributes.position) return;
        for (var p = o; p && p !== model; p = p.parent) if (/^Wheel /.test(p.name || '') || p.userData.driver) return;
        var m = [].concat(o.material)[0]; if (m && m.visible === false) return;
        var pos = o.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 40000));
        var mw = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        for (var i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mw);
          if (v.y < y0 || v.y > y1) continue;
          var b = Math.floor((v.x / d.L + 0.5) * N); if (b < 0 || b >= N) continue;
          if (v.z < lo[b]) lo[b] = v.z; if (v.z > hi[b]) hi[b] = v.z;
        }
      });
    } catch (e) { footCache[key] = null; return null; }
    var pts = [];
    for (var b = 0; b < N; b++) if (lo[b] <= hi[b]) { var x = ((b + 0.5) / N - 0.5) * d.L; pts.push([x, -lo[b]], [x, -hi[b]]); }
    var sh = Phys.outline(pts, 16), area = 0;
    if (sh) for (var i = 0; i < sh.length; i++) { var a = sh[i], c = sh[(i + 1) % sh.length]; area += a[0] * c[1] - c[0] * a[1]; }
    footCache[key] = sh && Math.abs(area) / 2 > 0.45 * d.L * d.W ? sh : null;
    return scaleShape(footCache[key], k);
  }
  function scaleShape(sh, k) { return sh ? sh.map(function (p) { return [p[0] * k, p[1] * k]; }) : null; }
  function makeCar(key, set, opts) {
    var entry = byKey[key], raw = Stats.of(key, entry), st = Sim.stats(raw);
    var holder = new THREE.Group(); holder.rotation.order = 'YXZ';
    var owned = [], car = { key: key, entry: entry, raw: raw, st: st, len: st.len, holder: holder, owned: owned, wheels: [], duck: null,
      name: entry ? displayName(entry) : key, w: Sim.carWidth(st.len), height: st.len * 0.3 };
    var model = null;
    if (opts.loaded) {
      model = TC.build(key, set.c, set);
      var d = model.userData.dims || TC.dims(key);
      if (d && d.L > 0) {
        var k = st.len / d.L;
        car.shape = footprint(key, model, d, k);
        model.scale.setScalar(k); model.position.y = d.H / 2 * k + 0.03;
        car.height = d.H * k; car.w = d.W * k;
      } else model = null;
    }
    if (model) {
      holder.add(model);
      if (opts.duck) car.duck = addDuck(model, key, opts.outfit);
      car.wheels = collectWheels(holder, model, st.len, car.height);
      car.rimBlur = SPD ? SPD.wheels(holder, car.wheels) : null;
    } else {
      // Ersatz-Kiste (Modell nicht geladen)
      var mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(set && set.c != null ? set.c : 0x9146ff), roughness: 0.4, metalness: 0.1 });
      var box = new THREE.Mesh(new THREE.BoxGeometry(st.len, car.height * 0.6, car.w), mat);
      box.position.y = 0.3 + car.height * 0.3; holder.add(box); owned.push(mat, box.geometry);
    }
    var sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.07; sh.scale.set(st.len * 1.15, car.w * 1.4, 1); holder.add(sh);
    owned.push(sh.geometry, sh.material);
    scene.add(holder);
    return car;
  }
  // Raddrehung fürs Bild: aus der gefahrenen Strecke (vorwärts/rückwärts), höchstens SPIN_STEP je Bild. Echte
  // Drehzahl wäre bei 50 km/h ~42° je Bild (60 fps) – bei 5–20 Speichen springt das Bild dann vor, zurück oder steht
  // (Wagenrad-Effekt), die Räder drehen scheinbar „frei“. Gilt für eigenes Auto, KI und Mitspieler gleich (deren
  // Drehwinkel kommt nur 20× je s bzw. als Winkel 0…2π und ist bei Tempo ohnehin nicht eindeutig).
  var SPIN_STEP = 0.3;
  function shownSpin(c, x, z, yaw) {
    if (c.spinX != null) {
      var dx = x - c.spinX, dz = z - c.spinZ, d = Math.hypot(dx, dz);
      if (d < 6) {   // größere Sprünge: neu gesetzt (Start, Zurücksetzen)
        var along = dx * Math.cos(yaw) - dz * Math.sin(yaw);   // Fahrtrichtung wie car-drive-phys: (cos yaw, −sin yaw)
        var wr = clamp(0.07 * (c.len || 4.5), 0.3, 0.55);
        c.spinShown = ((c.spinShown || 0) + clamp(along / wr, -SPIN_STEP, SPIN_STEP)) % (Math.PI * 2000);
      }
    }
    c.spinX = x; c.spinZ = z;
    return c.spinShown || 0;
  }
  function placeCar(c, x, z, yaw, roll, pitch, steer, spin) {
    var sl = trackRes ? trackRes.slopeAt(x, z, yaw) : null;
    c.holder.position.set(x, gh(x, z), z);
    c.holder.rotation.set(roll + (sl ? sl.roll : 0), yaw, pitch + (sl ? sl.pitch : 0));
    spin = shownSpin(c, x, z, yaw);
    for (var i = 0; i < c.wheels.length; i++) {
      var w = c.wheels[i];
      if (w.spin) w.spin.rotation[w.spin.userData.ax || 'x'] = w.base - spin * w.sgn;
      if (w.front) w.pivot.rotation.y = steer;
    }
    if (c.duck && TC.updateDriverClip) TC.updateDriverClip(c.duck);
  }
  function disposeCar(c) {
    if (c.rimBlur) { c.rimBlur.dispose(); c.rimBlur = null; }
    scene.remove(c.holder);
    c.owned.forEach(function (x) { if (x && x.dispose) x.dispose(); });   // Modell-Materialien gehören ToyCars (geteilt)
  }

  // ---- Klang (js/car-race-sound.js): startet nach der ersten Eingabe, M = stumm, Lautstärke in localStorage ----
  // Motoren: echte Aufnahmen je Motorart (js/car-engine-audio.js, Motorart aus CarRaceStats engine); das eigene Auto
  // voll, die drei nächsten Fremdautos leiser nach Abstand mit Doppler. Ohne Klangbank (Laden fehlgeschlagen):
  // Rückfall auf den erzeugten Motor von car-race-sound.js
  var snd = null, sndOn = load('sound', true) !== false, sndVol = clamp(+load('volume', 0.6) || 0, 0, 1);
  var eng = null, engOk = false, OTHER_N = 3, OTHER_REF = 6, OTHER_MAX = 70;
  var sm = { me: null, field: null, mev: null, others: [], nitro: 0, hitT: 0, lastSlip: 0, padThr: 0 };
  function soundStart() {
    if (!snd && root.CarRaceSound) snd = root.CarRaceSound.create({ volume: sndOn ? sndVol : 0 });
    if (snd && !eng && root.CarEngineAudio) {
      eng = root.CarEngineAudio.create(snd);
      if (eng) eng.ready.then(function (ok) { engOk = ok; });
    }
    if (snd) snd.resume();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { doc.addEventListener(ev, soundStart, { passive: true }); });
  function soundUi() {
    [$('sndBtn'), $('soundBtn')].forEach(function (b) {
      b.setAttribute('aria-pressed', sndOn ? 'true' : 'false');
      b.querySelector('.icon').textContent = sndOn ? 'volume_up' : 'volume_off';
    });
    $('sndBtn').querySelector('.sr-only').textContent = sndOn ? 'Sound on – press to mute (M)' : 'Sound off – press to unmute (M)';
    $('soundText').textContent = sndOn ? 'Sound on' : 'Sound off';
    $('volRange').value = String(Math.round(sndVol * 100));
  }
  function setSound(on) {
    sndOn = !!on; save('sound', sndOn);
    soundStart();
    if (snd) snd.setVolume(sndOn ? sndVol : 0);
    soundUi();
  }
  $('sndBtn').addEventListener('click', function () { setSound(!sndOn); });
  $('soundBtn').addEventListener('click', function () { setSound(!sndOn); });
  $('volRange').addEventListener('input', function () {
    sndVol = clamp((+$('volRange').value || 0) / 100, 0, 1); save('volume', sndVol);
    if (!sndOn && sndVol > 0) { setSound(true); return; }
    if (snd) snd.setVolume(sndOn ? sndVol : 0);
  });
  soundUi();
  function sfx(name, arg) { if (snd && sndOn) snd[name](arg); }
  function hitSound(v) { var t = performance.now(); if (v > 1.5 && t - sm.hitT > 160) { sm.hitT = t; sfx('thud', v > 6); } }
  function soundStop() {
    if (!snd) return;
    snd.silence();
    if (sm.me) { sm.me.stop(); sm.me = null; }
    if (sm.field) { sm.field.stop(); sm.field = null; }
    if (sm.mev) { sm.mev.v.stop(); sm.mev = null; }
    sm.others.forEach(function (o) { o.v.stop(); });
    sm.others = [];
  }
  function engineOf(c) { return (c && c.raw && c.raw.engine) || 'i4'; }
  // „START YOUR ENGINES“: eigenes Auto dreht einmal hoch, das Feld gibt 1,6 s lang kräftig Gas (otherEngines)
  function fieldRev() {
    sm.revUntil = performance.now() / 1000 + 1.6;
    if (!snd || !sndOn) return;
    if (sm.mev) { sm.mev.v.oneShot('rev', 0.5); sm.mev.v.blip(0.9); }
    sm.others.forEach(function (o) { o.v.blip(0.8 + Math.random() * 0.2); });
  }
  // je Bild: eigener Motor (laut), nahe Fremdautos (leise, Doppler), Quietschen, Rumpeln, Nitro
  function soundFrame(inp) {
    if (!snd) return;
    var dt = sm.lastT ? clamp((performance.now() - sm.lastT) / 1000, 0, 0.1) : 0.016;
    sm.lastT = performance.now();
    var off = !race || race.paused || race.phase === 'results' || !sndOn;
    if (off) {
      snd.skid(0); snd.rumble(0); snd.scrape(0); snd.wind(0); snd.tyres(0); if (sm.me) sm.me.set(false); if (sm.field) sm.field.set(false);
      if (sm.mev) sm.mev.v.update(dt, { on: false });
      sm.others.forEach(function (o) { o.v.update(dt, { on: false }); });
      return;
    }
    var pc = race.pc, sp = Math.hypot(pc.vx, pc.vz), cd = race.phase === 'countdown';
    // Gas fürs Motorgeräusch: im Countdown aus Tastatur/Gamepad (Gasstöße im Stand), sonst aus der Eingabe
    var thr = inp ? Math.max(inp.throttle || 0, pc.u < -0.5 ? inp.brake || 0 : 0)
      : cd && !race.spect ? Math.max((keys.KeyW || keys.ArrowUp) ? 1 : 0, sm.padThr) : race.spect ? 0.5 : 0;
    if (eng && engOk) {
      if (sm.me) { sm.me.stop(); sm.me = null; }
      if (sm.field) { sm.field.stop(); sm.field = null; }
      if (!sm.mev || sm.mev.car !== race.me) {
        if (sm.mev) sm.mev.v.stop();
        sm.mev = { car: race.me, v: eng.voice(engineOf(race.me), { gain: 1, seed: race.me.key }) };
        if (cd) sm.mev.v.oneShot('start', 0.55);
      }
      sm.mev.v.update(dt, { speed: Math.abs(pc.u) / Math.max(1, pc.P.vtop), throttle: thr });
      otherEngines(dt, cd);
    } else {
      if (!sm.me) sm.me = snd.motor(1);
      if (!sm.field) sm.field = snd.motor(0.3);
      sm.me.set(true, Math.abs(pc.u), inp ? thr : 0.3);
      var n = 0, sum = 0;
      (race.remotes || []).concat(race.ai || []).forEach(function (c) {
        if (!c || !c.holder) return;
        var d = Math.hypot(c.holder.position.x - pc.x, c.holder.position.z - pc.z);
        if (d < 45 && c.fxSpeed != null) { n++; sum += c.fxSpeed * (1 - d / 45); }
      });
      sm.field.set(n > 0, n ? sum / n * 1.4 : 0, 0.5);
    }
    var hard = pc.surface === 'asphalt' || pc.surface === 'curb';
    snd.skid(hard && sp > 3 && !race.spect ? clamp((pc.slip - 0.42) / 0.45, 0, 1) : 0);
    snd.rumble(!hard && sp > 1 ? clamp(sp / 12, 0.2, 1) : 0);
    snd.scrape(race.scrape || 0);
    // Fahrtwind + Abrollen (Tempogefühl), nach Tempoverhältnis; im Countdown still
    var rr = cd ? 0 : clamp(sp / Math.max(1, pc.P.vtop), 0, 1.3);
    snd.wind(rr); snd.tyres(hard ? rr : 0);
    if (pc.nitroT > 0 && sm.nitro <= 0) sfx('nitro');
    sm.nitro = pc.nitroT;
    if (pc.rail > 0) hitSound(pc.rail);
  }
  // Fremdautos: die OTHER_N nächsten (zur Kamera) bekommen eine Stimme; Tempo aus den gezeichneten Lagen (fxSpeed),
  // Gas aus der Tempoänderung, Doppler aus der Abstandsänderung (Sim-Einheiten → echte m/s über vmax)
  var camRight = new THREE.Vector3();
  function otherEngines(dt, cd) {
    var lx = cam.position.x, lz = cam.position.z, seen = [], list = [];
    (race.ai || []).concat(race.remotes || []).forEach(function (c) {
      if (!c || !c.holder || c === race.me || seen.indexOf(c) >= 0) return;
      seen.push(c);
      var d = Math.hypot(c.holder.position.x - lx, c.holder.position.z - lz);
      if (d < OTHER_MAX) list.push({ c: c, d: d });
    });
    list.sort(function (a, b) { return a.d - b.d; });
    list = list.slice(0, OTHER_N);
    var want = list.map(function (x) { return x.c; });
    sm.others = sm.others.filter(function (o) { if (want.indexOf(o.car) < 0) { o.v.stop(); return false; } return true; });
    camRight.setFromMatrixColumn(cam.matrixWorld, 0);
    list.forEach(function (x) {
      var c = x.c, o = sm.others.filter(function (q) { return q.car === c; })[0];
      if (!o) {
        o = { car: c, v: eng.voice(engineOf(c), { gain: 0.6, seed: c.key, lite: true }), d: x.d, u: c.fxSpeed || 0 };
        sm.others.push(o);
      }
      var u = c.fxSpeed || 0, vtop = Math.max(1, (c.st && c.st.vmax) || 30), mps = ((c.raw && c.raw.vmax) || 250) / 3.6 / vtop;
      var acc = dt > 0 ? (u - o.u) / dt : 0, radial = dt > 0 ? -(x.d - o.d) / dt * mps : 0;
      o.u = u; o.d = x.d;
      o.thr = (o.thr || 0) + ((cd ? 0 : acc > 0.3 ? 0.85 : acc < -1 ? 0 : 0.35) - (o.thr || 0)) * Math.min(1, dt * 6);
      var revving = performance.now() / 1000 < (sm.revUntil || 0);
      if (cd && (revving ? Math.random() < dt * 2.4 : race.cd < 3.5 && Math.random() < dt * 0.6)) o.v.blip(revving ? 0.75 + Math.random() * 0.25 : 0.5 + Math.random() * 0.4);
      var dx = c.holder.position.x - lx, dz = c.holder.position.z - lz, dl = Math.max(1e-3, Math.hypot(dx, dz));
      o.v.update(dt, { speed: u / vtop, throttle: o.thr, dist: x.d, ref: OTHER_REF, radial: radial,
        pan: clamp((dx * camRight.x + dz * camRight.z) / dl, -1, 1) * 0.7 });
    });
  }
  // ---- Eingabe ----
  var keys = {}, pressed = {};
  var GAME_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, ShiftLeft: 1, ShiftRight: 1, KeyR: 1, KeyC: 1 };
  doc.addEventListener('keydown', function (e) {
    if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) { cycleMap(); return; }
    if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) { setSound(!sndOn); return; }
    if (e.code === 'Escape' && race && (race.phase === 'race' || race.phase === 'countdown' || race.phase === 'done')) {
      e.preventDefault(); setPaused(!menuOpen()); return;
    }
    if (e.code === 'KeyP' && race && (race.chat || (race.mp && mpTaken(mp.me))) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); aiToggle(); return; }
    if (!race || race.paused || race.menu || !(race.phase === 'race' || race.phase === 'countdown' || race.phase === 'done')) return;
    if (GAME_KEYS[e.code]) {
      e.preventDefault();
      if (!keys[e.code]) pressed[e.code] = true;
      keys[e.code] = true;
    }
  });
  doc.addEventListener('keyup', function (e) { keys[e.code] = false; });
  root.addEventListener('blur', function () { keys = {}; if (race && !race.mp && race.phase === 'race' && !race.paused) setPaused(true); });
  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden && race && !race.mp && race.phase === 'race' && !race.paused) setPaused(true);
    // Raum: Tab war im Hintergrund, die KI hat übernommen (keine Zustände) → beim Zurückkommen Steuer automatisch zurück
    // (kurz warten, bis Bildtakt und Verbindung wieder laufen)
    if (!doc.hidden && race && race.mp && !race.chat) setTimeout(function () {
      if (!doc.hidden && race && race.mp && !race.chat && mp && mpTaken(mp.me)) mpTakeWheel();
    }, 400);
  });

  var pad = { prev: [], active: false };
  function readPad() {
    var list = navigator.getGamepads ? navigator.getGamepads() : [], gp = null;
    for (var i = 0; i < (list ? list.length : 0); i++) if (list[i] && list[i].connected) { gp = list[i]; break; }
    if (!gp) { pad.active = false; return null; }
    var b = gp.buttons, val = function (i) { return b[i] ? (typeof b[i].value === 'number' ? b[i].value : b[i].pressed ? 1 : 0) : 0; };
    var cur = b.map(function (x) { return !!(x && x.pressed); });
    var edge = function (i) { return cur[i] && !pad.prev[i]; };
    var ax = gp.axes[0] || 0, dz = 0.12;
    ax = Math.abs(ax) < dz ? 0 : (ax - Math.sign(ax) * dz) / (1 - dz);
    var rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
    rx = Math.abs(rx) < 0.18 ? 0 : rx; ry = Math.abs(ry) < 0.18 ? 0 : ry;
    var r = { throttle: val(7), brake: val(6), steer: -ax, handbrake: cur[0], nitro: cur[1], cam: edge(3), start: edge(9), back: edge(8),
      up: edge(12), down: edge(13), left: edge(14), right: edge(15), a: edge(0), b: edge(1), lookX: rx, lookY: ry };
    pad.prev = cur;
    if (r.throttle > 0.05 || r.brake > 0.05 || ax !== 0 || cur.some(Boolean)) pad.active = true;
    return r;
  }
  // Menü mit dem Gamepad: Steuerkreuz bewegt den Fokus, A klickt, B = zurück (Pause schließen)
  function padMenu(p) {
    var open = PANELS.filter(function (n) { return !ui[n].hidden; })[0];
    if (!open || !p) return;
    var items = Array.prototype.slice.call(ui[open].querySelectorAll('button, select, input, summary')).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!items.length) return;
    var i = items.indexOf(doc.activeElement);
    if (p.down) items[(i + 1) % items.length].focus();
    if (p.up) items[(i - 1 + items.length) % items.length].focus();
    if (p.a && i >= 0 && items[i].tagName === 'BUTTON') items[i].click();
    // links/rechts: Auswahl bzw. Regler ändern
    var cur = items[i], step = p.right ? 1 : p.left ? -1 : 0;
    if (step && cur && cur.tagName === 'SELECT' && cur.options.length) {
      cur.selectedIndex = clamp(cur.selectedIndex + step, 0, cur.options.length - 1); cur.dispatchEvent(new Event('change'));
    } else if (step && cur && cur.type === 'range') {
      cur.value = String(clamp((+cur.value) + step, +cur.min, +cur.max)); cur.dispatchEvent(new Event('input'));
    }
    if (p.b && open === 'pause') setPaused(false);
  }
  // ---- Umschauen: Maus/Touch ziehen dreht die Kamera um das eigene Auto, Mausrad/Pinch zoomt ----
  // look.yaw = Winkel um das Auto (0 = hinter dem Auto), look.pitch = Höhe, look.dist = Abstand; im Countdown und im
  // Rennen. Ohne Eingabe pendelt die Kamera nach LOOK_IDLE s sanft zurück hinter das Auto (reduzierte Bewegung: sofort).
  var LOOK_IDLE = 2.5, LOOK_PITCH = 0.32;
  var look = { used: false, yaw: 0, pitch: LOOK_PITCH, dist: 0, ptrs: {}, pinch: 0, idle: 0 };
  function lookAllowed() { return !!(race && (race.phase === 'countdown' || race.phase === 'race' || race.phase === 'done') && !race.paused && race.pc); }
  function lookReset() { look.used = false; look.yaw = 0; look.pitch = LOOK_PITCH; look.dist = 0; look.ptrs = {}; look.pinch = 0; look.idle = 0; }
  function lookBase() { return race ? race.me.len * 1.15 + 4.2 : 9; }
  // je Bild: nach der Ruhezeit Winkel, Höhe und Abstand weich zur Verfolgerposition zurück, dann übernimmt die Kamera
  function lookReturn(dt) {
    if (!look.used || Object.keys(look.ptrs).length) { look.idle = 0; return; }
    look.idle += dt;
    if (look.idle < LOOK_IDLE) return;
    if (REDUCE) { lookReset(); race.camPos = null; return; }
    var k = damp(2.2, dt);
    look.yaw += (0 - look.yaw) * k; look.pitch += (LOOK_PITCH - look.pitch) * k; look.dist += (lookBase() - look.dist) * k;
    if (Math.abs(look.yaw) < 0.02 && Math.abs(look.pitch - LOOK_PITCH) < 0.02 && Math.abs(look.dist - lookBase()) < 0.1) {
      var ptrs = look.ptrs; lookReset(); look.ptrs = ptrs;
    }
  }
  function lookOrbit(dx, dy) {
    look.idle = 0;
    if (!look.used) { look.used = true; look.dist = lookBase(); }
    look.yaw = wrapAngle(look.yaw - dx * 0.0065);
    look.pitch = clamp(look.pitch + dy * 0.0045, 0.05, 1.25);
  }
  function lookZoom(f) {
    look.idle = 0;
    if (!look.used) { look.used = true; look.dist = lookBase(); }
    look.dist = clamp(look.dist * f, Math.max(3, race.me.len * 0.9), 40);
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (!lookAllowed()) return;
    look.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    app.dataset.look = 'drag';
  });
  canvas.addEventListener('pointermove', function (e) {
    var p0 = look.ptrs[e.pointerId];
    if (!p0 || !lookAllowed()) return;
    var ids = Object.keys(look.ptrs);
    if (ids.length >= 2) {
      // Pinch: Abstand der beiden Finger
      p0.x = e.clientX; p0.y = e.clientY;
      var a = look.ptrs[ids[0]], b = look.ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (look.pinch > 0 && d > 0) lookZoom(look.pinch / d);
      look.pinch = d;
      return;
    }
    lookOrbit(e.clientX - p0.x, e.clientY - p0.y);
    p0.x = e.clientX; p0.y = e.clientY;
  });
  function lookUp(e) {
    delete look.ptrs[e.pointerId]; look.pinch = 0;
    if (!Object.keys(look.ptrs).length && app.dataset.look === 'drag') app.dataset.look = '1';
  }
  canvas.addEventListener('pointerup', lookUp);
  canvas.addEventListener('pointercancel', lookUp);
  canvas.addEventListener('wheel', function (e) {
    if (!lookAllowed()) return;
    e.preventDefault();
    lookZoom(Math.exp(clamp(e.deltaY, -200, 200) * 0.0015));
  }, { passive: false });
  // Countdown an/aus: Hinweis, Cursor; beim Start (GO) übernimmt die Verfolgerkamera weich (reduzierte Bewegung: sofort)
  function lookPhase() {
    var on = lookAllowed(), hint = on && race.phase === 'countdown';   // Hinweis nur in der Startaufstellung
    if ($('hLook').hidden === hint) $('hLook').hidden = !hint;
    if (on) { if (!app.dataset.look) app.dataset.look = '1'; }
    else if (app.dataset.look) { delete app.dataset.look; look.ptrs = {}; }
  }

  var steerKb = 0, thrKb = 0, brkKb = 0;
  function playerInput(dt, p) {
    var L = keys.KeyA || keys.ArrowLeft, R = keys.KeyD || keys.ArrowRight;
    var tgt = (L ? 1 : 0) - (R ? 1 : 0);
    // Tastatur: Lenkung weich ein (je nach Tempo) und schneller zurück, Gas/Bremse kurz rampen
    var rate = tgt === 0 || Math.sign(tgt) !== Math.sign(steerKb) ? 6 : 3.2;
    steerKb += clamp(tgt - steerKb, -rate * dt, rate * dt);
    thrKb += clamp(((keys.KeyW || keys.ArrowUp) ? 1 : 0) - thrKb, -8 * dt, 6 * dt);
    brkKb += clamp(((keys.KeyS || keys.ArrowDown) ? 1 : 0) - brkKb, -8 * dt, 8 * dt);
    var inp = { throttle: thrKb, brake: brkKb, steer: steerKb, handbrake: !!keys.Space, nitro: !!(keys.ShiftLeft || keys.ShiftRight) };
    if (p) {
      inp.throttle = Math.max(inp.throttle, p.throttle); inp.brake = Math.max(inp.brake, p.brake);
      if (Math.abs(p.steer) > 0) {
        // Stick: leicht geglättet, feinfühlig um die Mitte (Kurve ^1,4)
        var s = Math.sign(p.steer) * Math.pow(Math.abs(p.steer), 1.4);
        pad.steer = (pad.steer || 0) + (s - (pad.steer || 0)) * damp(18, dt);
        if (tgt === 0) inp.steer = pad.steer;
      } else pad.steer = (pad.steer || 0) * (1 - damp(18, dt));
      inp.handbrake = inp.handbrake || p.handbrake; inp.nitro = inp.nitro || p.nitro;
    }
    return inp;
  }

  // ---- Rennen ----
  var race = null, trackRes = null, grass = null;
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pickOpponents(n, playerKey) {
    var cands = catalog.filter(function (e) {
      if (e.key === playerKey || TC.vehicle(e.key).mix === false) return false;
      var r = Stats.of(e.key, e); return r.on !== false;
    });
    if (cands.length < n) cands = catalog.filter(function (e) { return e.key !== playerKey; });
    // kleinere Dateien bevorzugen (zwei Drittel aus der kleineren Hälfte) – volle Modelle sind schwer
    cands.sort(function (a, b) { return (a.bytes || 0) - (b.bytes || 0); });
    var half = Math.ceil(cands.length / 2), small = shuffle(cands.slice(0, half)), big = shuffle(cands.slice(half));
    var nS = Math.min(small.length, Math.ceil(n * 2 / 3));
    var pick = small.slice(0, nS).concat(big.slice(0, n - nS));
    if (pick.length < n) pick = pick.concat(small.slice(nS, nS + n - pick.length));
    return shuffle(pick).slice(0, n);
  }
  function settings() {
    return { car: ui.list.value, paint: ui.paint.value | 0, track: ui.track.value | 0, opp: ui.opp.value | 0, laps: ui.laps.value | 0, duck: ui.duck.checked };
  }
  ui.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var s = settings();
    if (!byKey[s.car]) { ui.status.textContent = 'Pick a car first.'; ui.list.focus(); return; }
    if (VIEWER) { viewerJoin(s); return; }
    save('menu', s); pref = s;
    begin(s, null);
  });

  function begin(s, opponents) {
    teardown();
    showPanel('loading');
    var opp = opponents || pickOpponents(s.opp, s.car);
    var entries = [byKey[s.car]].concat(opp), total = entries.length, done = 0, ok = {};
    ui.loadBar.max = total; ui.loadBar.value = 0;
    var token = {}; begin.token = token;
    function next(i) {
      if (begin.token !== token) return Promise.resolve(false);
      if (i >= entries.length) return Promise.resolve(true);
      var e = entries[i];
      ui.loadText.textContent = 'Car ' + (i + 1) + ' of ' + total + ': ' + displayName(e);
      return TC.loadModel(e).then(function (t) { if (TC.mergeForRace) TC.mergeForRace(t); ok[e.key] = true; })
        .catch(function () { ok[e.key] = false; })
        .then(function () {
          done++; ui.loadBar.value = done;
          return new Promise(function (res) { setTimeout(res, 30); });   // Fortschritt zeichnen lassen
        }).then(function () { return next(i + 1); });
    }
    next(0).then(function (go) { if (go) setupRace(s, opp, ok); });
  }

  // Strecken-Kulisse (js/car-track-scene.js): Thema je Strecke mit Himmel, Licht, Nebel und optischer Höhe
  function buildTrack(T) {
    trackRes = CarTrackScene.build(T, { primary: tokenColor('tk-primary', '#5e2a79'), accent: tokenColor('tk-accent', '#f2b705'), maxAniso: maxAniso, reduceMotion: REDUCE });
    trackRes.applyEnv(scene, renderer, { background: true });
    scene.add(trackRes.group);
    if (FX && FX.setGround) FX.setGround(trackRes.heightAt);
    // Grashalme nah an der Kamera (js/car-drive-grass.js); Zuschauer „Light“ mit halber Dichte
    if (minimap) minimap.setTrack(T);
    grass = root.CarDriveGrass ? CarDriveGrass.create(THREE, trackRes, { reduce: REDUCE, quality: renderScale < 1 ? 'light' : 'full' }) : null;
  }
  // Minimap (js/car-drive-minimap.js): Taste N / Gamepad Back schaltet Mitdrehen → ganze Strecke → aus (gemerkt)
  var MAP_TEXT = { follow: 'Minimap: follow car', track: 'Minimap: whole track', off: 'Minimap: off' };
  var minimap = root.CarDriveMinimap ? CarDriveMinimap.create($('hMap'), { reduce: REDUCE }) : null;
  function setMapMode(m, announce) {
    if (!minimap) return;
    minimap.setMode(m); save('map', minimap.mode());
    $('mapText').textContent = MAP_TEXT[minimap.mode()];
    if (announce) { flash(MAP_TEXT[minimap.mode()], 1.2); say(MAP_TEXT[minimap.mode()]); }
  }
  function cycleMap() { if (minimap) { var M = CarDriveMinimap.MODES; setMapMode(M[(M.indexOf(minimap.mode()) + 1) % M.length], true); } }
  if (minimap) { setMapMode(load('map', 'follow')); $('mapBtn').addEventListener('click', function () { cycleMap(); }); }
  else if ($('mapBtn')) $('mapBtn').hidden = true;
  function mapFrame(now) {
    if (!minimap || !race || !race.me || !race.me.holder) return;
    var h = race.me.holder, others = [];
    (race.ai || []).forEach(function (c) { if (c && c.holder && c.holder.visible) others.push({ x: c.holder.position.x, z: c.holder.position.z, real: false }); });
    (race.remotes || []).forEach(function (c) { if (c && c.holder && c.holder.visible && c !== race.me) others.push({ x: c.holder.position.x, z: c.holder.position.z, real: true }); });
    minimap.draw(now, { x: h.position.x, z: h.position.z, yaw: h.rotation.y }, others);
  }
  function grassFrame(dt) {
    if (!grass) return;
    var h = race && race.me && race.me.holder;
    grass.update(dt, cam, h ? { x: h.position.x, z: h.position.z, r: race.me.len * 0.55 } : null);
  }
  // Geländehöhe (nur Optik – die Fahrphysik bleibt 2D)
  function gh(x, z) { return trackRes ? trackRes.heightAt(x, z) : 0; }
  function groundY(x, z) { return trackRes ? trackRes.groundAt(x, z) : 0; }
  function setupRace(s, opp, ok) {
    var seed = Sim.TRACKS[s.track] || 1, T = Sim.track(seed);
    buildTrack(T);
    var RD = root.RubberDuck, outfits = RD && RD.OUTFITS ? RD.OUTFITS : [];
    // Gegner: Startplätze vorn (Sim-Aufstellung), Spieler dahinter
    var ai = opp.map(function (e) {
      return makeCar(e.key, TC.pickPaint(e.key), { loaded: ok[e.key], duck: s.duck, outfit: outfits.length ? outfits[Math.floor(Math.random() * outfits.length)] : null });
    });
    var me = makeCar(s.car, TC.paintAt(s.car, s.paint), { loaded: ok[s.car], duck: s.duck, outfit: null });
    var simSeed = (Math.random() * 1e9) | 0;
    var sim = ai.length ? Sim.create({ seed: simSeed, track: T, laps: s.laps, finishWindow: 1e6, maxTime: s.laps * 100 + 120,
      cars: ai.map(function (c, i) { return { id: 'ai' + i, stats: c.st }; }) }) : null;
    // Startplatz des Spielers wie die Sim es täte: Zweierreihen, ungerade Zahl → neben dem letzten Gegner
    var k = ai.length, sP, dP;
    if (!k) { sP = -(1 + me.len / 2); dP = 2.3; }
    else {
      var last = sim.cars[k - 1];
      if (k % 2 === 1) { sP = last.s; dP = -2.3; }
      else { sP = last.s - (ai[k - 1].len / 2 + me.len / 2 + 2.5); dP = 2.3; }
    }
    var P = Phys.params(me.st, me.raw), pc = Phys.create(T, P, { s: sP, d: dP });
    race = {
      s: s, T: T, seed: seed, sim: sim, ai: ai, me: me, pc: pc, laps: s.laps, phase: 'countdown', paused: false,
      t: 0, cd: 6.4, lapStart: 0, lastLap: null, bestLap: null, stored: load('best2.' + s.car + '.' + seed, null),
      prev: null, finishT: null, doneT: 0, camMode: 'chase', camPos: null, camLook: null, tvIdx: -1, shake: 0,
      lapsShown: -1, posShown: '', opp: opp, newBest: false
    };
    recLoad(race, s.track);
    if (sim) snap();
    ai.forEach(function (c, i) { var q = sim.cars[i]; placeCar(c, q.x, q.z, q.yaw, 0, 0, 0, 0); });
    placeCar(me, pc.x, pc.z, pc.yaw, 0, 0, 0, 0);
    ui.hud.hidden = false; showPanel(null);
    setCam('chase', true);
    ui.countdown.hidden = false;
    say('Get ready');
    canvas.setAttribute('tabindex', '-1');
    try { canvas.focus({ preventScroll: true }); } catch (e) { /* */ }
  }

  function teardown() {
    begin.token = null;
    if (welcomeUi) welcomeUi.set(null);
    if (race) {
      race.ai.forEach(function (c) { if (c) disposeCar(c); }); disposeCar(race.me);
      if (race.remotes) race.remotes.forEach(disposeCar);
      race = null;
    }
    if (grass) { grass.dispose(); grass = null; }
    if (minimap) minimap.setTrack(null);
    if (trackRes) { trackRes.dispose(); trackRes = null; }
    if (FX && FX.setGround) FX.setGround(null);
    ui.hud.hidden = true; ui.countdown.hidden = true;
    keys = {}; steerKb = thrKb = brkKb = 0;
    if (FX) FX.clear();
    if (SPD) SPD.set(0, 0, 0);
    soundStop(); lookReset();
  }

  // Solo: echte Pause. Mehrspieler-Raum/Chatrennen: die Uhr läuft beim Server weiter → nur ein Menü, das Rennen
  // läuft dahinter weiter (Chatrennen: „Let AI drive“ / „Take the wheel“)
  function menuOpen() { return race ? (race.mp ? !!race.menu : race.paused) : false; }
  function setPaused(on) {
    if (!race) return;
    if (race.mp) { race.menu = on; race.paused = false; } else race.paused = on;
    keys = {};
    $('pauseTitle').textContent = race.mp ? 'Race menu' : 'Paused';
    $('resumeBtn').textContent = race.mp ? 'Close menu' : 'Resume';
    $('restartBtn').hidden = !!race.mp;
    $('menuBtn').textContent = race.chat ? 'Leave race' : race.mp ? 'Back to lobby' : 'Back to menu';
    aiBtnSync();
    if (on) showPanel('pause'); else { showPanel(null); try { canvas.focus({ preventScroll: true }); } catch (e) { /* */ } }
  }
  $('resumeBtn').addEventListener('click', function () { setPaused(false); });
  $('restartBtn').addEventListener('click', function () { if (race) { var s = race.s, o = race.opp; begin(s, o); } });
  $('menuBtn').addEventListener('click', function () {
    if (race && race.chat) {
      // Chatrennen verlassen: Verbindung zu, die KI übernimmt das Auto; kein automatisches Wieder-Einsteigen
      rc.left = race.raceId; teardown(); mpStop(); showPanel('lobby'); if (rc.st) rcLobby(rc.st);
      setLobbyStatus('You left the race – the AI drives your car.'); return;
    }
    var m = race && race.mp; teardown(); if (m && mp) showLobby(); else showPanel('menu');
  });
  function aiToggle() { if (race && race.chat) rcToggleAi(); else mpTakeWheel(); }
  $('aiBtn').addEventListener('click', function () { aiToggle(); setPaused(false); });
  $('againBtn').addEventListener('click', function () {
    if (race && race.chat) { teardown(); showLobby(); if (rc.st) rcLobby(rc.st); return; }
    if (race && race.mp) { teardown(); showLobby(); return; }
    if (race) { var s = race.s, o = race.opp; begin(s, o); }
  });
  $('finishMenuBtn').addEventListener('click', function () {
    if (race && race.chat) { teardown(); showLobby(); if (rc.st) rcLobby(rc.st); return; }
    if (race && race.mp) { teardown(); mpLeave(); return; }
    teardown(); showPanel('menu');
  });

  // Sim-Zustand für die Interpolation
  function snap() {
    race.prev = race.sim.cars.map(function (c) { return { x: c.x, z: c.z, yaw: c.yaw, roll: c.roll, pitch: c.pitch, steer: c.steer, spin: c.spin }; });
  }
  // Ausgeschiedene Autos (DNF) durchscheinend: eigene Kopien der Materialien (Vorlagen werden geteilt), einmal je Auto
  function ghostCar(c, on) {
    if (!c || !c.holder || !!c.ghosted === on) return;
    c.ghosted = on;
    c.holder.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      if (on) {
        if (!o.userData.ghostMat) {
          var mk = function (m) { var g = m.clone(); g.transparent = true; g.opacity = 0.28 * (m.opacity == null ? 1 : m.opacity); g.depthWrite = false; c.owned.push(g); return g; };
          o.userData.solidMat = o.material;
          o.userData.ghostMat = Array.isArray(o.material) ? o.material.map(mk) : mk(o.material);
        }
        o.material = o.userData.ghostMat;
      } else if (o.userData.solidMat) o.material = o.userData.solidMat;
    });
  }
  function drawAI() {
    if (!race.sim) return;
    var a = clamp((race.t - race.sim.time) / Sim.DT, 0, 1);   // eine Sim-Stufe zurück, weich dazwischen
    race.ai.forEach(function (c, i) {
      var q = race.sim.cars[i], p = race.prev[i] || q;
      if (!c || q.ghost) return;   // Chatrennen: Piloten zeichnet rcDraw
      ghostCar(c, q.state === 'dnf');
      placeCar(c, lerp(p.x, q.x, a), lerp(p.z, q.z, a), p.yaw + (q.yaw - p.yaw) * a, lerp(p.roll, q.roll, a), lerp(p.pitch, q.pitch, a),
        lerp(p.steer, q.steer, a), p.spin + wrapAngle(q.spin - p.spin) * a);
    });
  }

  // ---- Kontakte Auto ↔ Auto ----
  // Grundfläche als Rechteck (Länge/Breite des Modells bzw. der Sim), Überlappung und Stoß in CarDrivePhys
  // (stepContacts/collide). Nur das eigene Auto reagiert (andere Clients rechnen dasselbe bei sich), im Solo-Rennen
  // bekommt die KI zusätzlich den Gegenstoß ab. Ausgeschiedene (DNF) sind durchscheinend und kein Hindernis.
  function poseOf(c, x, z, yaw, v, mass) {
    var o = { c: c, x: x, z: z, yaw: yaw, len: c.len, w: c.w, shape: c.shape, vx: Math.cos(yaw) * v, vz: -Math.sin(yaw) * v, mass: mass };
    var p = c.cPose;   // Lage im vorigen Bild: wird über die Teilschritte mitgezogen (kein Durchtunneln)
    if (p && Math.hypot(p.x - x, p.z - z) < 8) { o.x0 = p.x; o.z0 = p.z; o.yaw0 = p.yaw; }
    c.cPose = { x: x, z: z, yaw: yaw };
    return o;
  }
  function contactList() {
    var out = [];
    if (race.chat) {
      // Chatrennen: KI aus der Sim (gemeinsam, nicht anstoßen), andere Piloten/Übernommene aus Live-Takt bzw. Nachfahrer
      if (race.spect) return out;
      race.ai.forEach(function (c, i) {
        if (!c) return;
        if (race.remotes.indexOf(c) >= 0) {
          var r = c.smp; if (!r) return;
          var po = poseOf(c, r.x, r.z, r.yaw, r.speed || 0, c.st.mass); po.peer = !c.isAi; out.push(po); return;
        }
        var q = race.sim.cars[i];
        if (q.state === 'dnf') return;   // ausgeschieden: durchscheinend, man fährt hindurch
        var o = poseOf(c, q.x, q.z, q.yaw, q.v, c.st.mass);
        if (!q.ghost) { o.rq = q; o.i = i; }   // KI der Sim: Treffer gehen als Ereignis an alle (rcHitSend)
        out.push(o);
      });
      return out;
    }
    if (race.sim) race.ai.forEach(function (c, i) {
      if (!c) return;
      var q = race.sim.cars[i];
      if (q.state === 'dnf') return;     // ausgeschieden: durchscheinend, man fährt hindurch
      var o = poseOf(c, q.x, q.z, q.yaw, q.v, c.st.mass);
      o.q = q; o.i = i; out.push(o);
    });
    if (race.mp) race.remotes.forEach(function (c) {
      var r = c.smp; if (!r) return;
      var o = poseOf(c, r.x, r.z, r.yaw, r.speed || 0, c.st.mass);
      o.peer = !c.isAi;   // Mitspieler rechnet denselben Kontakt bei sich; übernommene (KI) fahren feste Bahn
      out.push(o);
    });
    return out;
  }
  // Mitspieler: harte Kontakte melden (bump), damit der andere sofort reagiert, auch wenn er den Kontakt bei sich
  // knapp verpasst; je Gegner höchstens alle 0,3 s. Eigene Kontakte merken (ankommende bump nicht doppelt anwenden).
  // Auch Schrammen/Anlehnen zählen: sonst merkt der Gerammte nichts, wenn sein Bild den Kontakt knapp verpasst
  // (Kotflügel in der Kurve) und er „schrammt“ ohne Wirkung vorbei. Stöße je Gegner im Bild summiert, gesendet in
  // peerBumpSend (höchstens alle 0,12 s je Gegner, ab BUMP_MIN N·s).
  var BUMP_MIN = 0.4;
  function peerHit(o, h) {
    var c = o.c; if (!c || !race) return;
    c.contactAt = race.t;
    var a = c.bumpAcc || (c.bumpAcc = { jx: 0, jz: 0, imp: 0 });
    a.jx += h.jx; a.jz += h.jz; a.imp = Math.max(a.imp, h.impact);
  }
  function peerBumpSend() {
    if (!race || !race.remotes) return;
    race.remotes.forEach(function (c) {
      var a = c.bumpAcc; if (!a) return;
      if (!mp || !mp.net || race.spect || (c.bumpAt != null && race.t - c.bumpAt < 0.12)) return;   // weiter sammeln
      c.bumpAcc = null;
      if (Math.hypot(a.jx, a.jz) < BUMP_MIN) return;
      c.bumpAt = race.t;
      mp.net.send({ t: 'bump', to: c.id, jx: Math.round(a.jx * 1000) / 1000, jz: Math.round(a.jz * 1000) / 1000, imp: Math.round(a.imp * 100) / 100 });
    });
  }
  // bump eines Mitspielers: Gegenstoß (−J) auf mein Auto, wenn ich den Kontakt nicht selbst gerade gerechnet habe
  function peerBump(m) {
    if (!race || !race.pc || race.spect || race.phase !== 'race' || !(m.jx || m.jz)) return;
    var c = (race.remotes || []).filter(function (r) { return r.id === String(m.from); })[0];
    if (c && c.contactAt != null && race.t - c.contactAt < 0.3) return;
    var pc = race.pc, mP = pc.P.mass, jx = clamp(-m.jx, -60, 60), jz = clamp(-m.jz, -60, 60);
    pc.vx += jx / mP; pc.vz += jz / mP;
    var fx = Math.cos(pc.yaw), fz = -Math.sin(pc.yaw), lx = -Math.sin(pc.yaw), lz = -Math.cos(pc.yaw);
    pc.u = pc.vx * fx + pc.vz * fz; pc.w = pc.vx * lx + pc.vz * lz;
    if (c) c.contactAt = race.t;
    if ((m.imp || 0) >= Phys.CRASH_V) { race.crashT = Math.max(race.crashT || 0, 0.25); pc.hitT = Math.max(pc.hitT || 0, 0.2); }
  }
  // Fremdauto für Anzeige + Kontakt: Puffer (ruhig, Vergangenheit), in der Nähe weich auf die Voraussage (Gegenwart)
  // überblendet – dort, wo man sich berühren kann, stimmen Bild und Kontakt mit der echten Lage überein
  var NEAR_PRED = 8, FAR_PRED = 14;
  function netPose(c, at) {
    var q = mp.net.sample(c.id, at, race.T);
    if (!q || !mp.net.predict) return q;
    var p = mp.net.predict(c.id, race.T), pc = race.pc;
    if (!p || !pc) return q;
    var dist = Math.hypot(p.x - pc.x, p.z - pc.z), k = clamp((FAR_PRED - dist) / (FAR_PRED - NEAR_PRED), 0, 1);
    if (k <= 0) return q;
    var o = Object.assign({}, q);
    ['x', 'z', 'roll', 'pitch', 'steer', 'speed', 'prog'].forEach(function (f) { o[f] = q[f] + (p[f] - q[f]) * k; });
    o.yaw = q.yaw + wrapAngle(p.yaw - q.yaw) * k;
    return o;
  }
  // Solo: Gegenstoß auf die KI über die Sim (sim.hit) – Tempo längs, Seitenschub quer (Streckenkoordinaten),
  // ein harter Treffer kann sie drehen (je schwerer ich im Verhältnis, desto eher)
  function nudgeAI(o, h) {
    if (!isFinite(o.mass) || !o.q || o.i == null || !race.sim.hit) return;
    var q = o.q, a = race.T.at(q.s), gx = Math.cos(q.yaw), gz = -Math.sin(q.yaw);
    var dvx = -h.jx / o.mass, dvz = -h.jz / o.mass, spin = 0;
    if (h.impact >= Phys.CRASH_V && !(o.c.spinCd > race.t)) {
      o.c.spinCd = race.t + 0.6;
      spin = clamp((h.impact - 4) / 12, 0, 0.7) * clamp(race.pc.P.mass / o.mass, 0.2, 1.5);
    }
    race.sim.hit(o.i, dvx * gx + dvz * gz, (dvx * a.nx + dvz * a.nz) * 1.3, spin);
  }
  // Chatrennen: Treffer auf KI-Autos sammeln (je Bild) und als Ereignis an den Server – er verteilt es an Overlay und
  // alle Fahrer, jede Instanz wendet es zur selben Rennsekunde an (fx/drive_race.Room.hit, CarRaceSim „hit“)
  function rcHitAdd(o, h) {
    if (!isFinite(o.mass) || !o.rq) return;
    var q = o.rq, a = race.T.at(q.s), gx = Math.cos(q.yaw), gz = -Math.sin(q.yaw);
    var dvx = -h.jx / o.mass, dvz = -h.jz / o.mass, acc = race.hitAcc || (race.hitAcc = {});
    var e = acc[o.i] || (acc[o.i] = { dv: 0, dl: 0, imp: 0 });
    e.dv += dvx * gx + dvz * gz; e.dl += (dvx * a.nx + dvz * a.nz) * 1.3; e.imp = Math.max(e.imp, h.impact);
  }
  function rcHitSend() {
    var acc = race.hitAcc;
    race.hitAcc = null;
    if (!acc || !mp || !mp.net || race.spect || race.phase !== 'race') return;
    var cd = race.hitCd || (race.hitCd = {});
    Object.keys(acc).forEach(function (i) {
      var e = acc[i], q = race.sim.cars[i];
      if (!q || Math.abs(e.dv) + Math.abs(e.dl) < 0.3 || cd[i] > race.t) return;
      cd[i] = race.t + 0.5;
      var spin = e.imp >= Phys.CRASH_V && Math.random() < clamp((e.imp - 4) / 12, 0, 0.7) * clamp(race.pc.P.mass / race.ai[i].st.mass, 0.2, 1.5);
      mp.net.send({ t: 'hit', id: q.id, rt: Math.round(race.t * 100) / 100, dv: Math.round(e.dv * 100) / 100, dl: Math.round(e.dl * 100) / 100, spin: spin ? 1 : 0 });
    });
  }
  // Ereignisse für die Sim: race_events vom Server + per WS schon gemeldete Treffer (bis Flask sie führt)
  function rcHitKey(e) { return e.t + '|' + e.id + '|' + e.by; }
  function rcEvents(st) {
    var srv = (st && st.race_events) || [], have = {}, list = srv.slice();
    srv.forEach(function (e) { if (e && e.type === 'hit') have[rcHitKey(e)] = 1; });
    Object.keys(race && race.wsHits || {}).forEach(function (k) { if (!have[k]) list.push(race.wsHits[k]); });
    return list;
  }
  function rcHitMsg(ev) {
    if (!race || !race.chat || !race.sim || !ev || ev.type !== 'hit') return;
    race.wsHits = race.wsHits || {};      // je Rennen (race wird je Chatrennen neu angelegt)
    if (race.wsHits[rcHitKey(ev)]) return;
    race.wsHits[rcHitKey(ev)] = ev;
    var list = rcEvents(rc.st);
    rc.evKey = JSON.stringify(list);
    if (race.sim.setEvents(list) && rc.st) rcBuildSim(rc.st);   // zu spät angekommen: Sim mit dem Treffer neu nachrechnen
  }
  // Solo: mein Auto als Hindernis für die KI (fährt nicht auf, lenkt nicht hinein, überholt außen herum)
  function simObstacles() {
    var pc = race.pc;
    if (!race.sim.setObstacles) return;
    race.sim.setObstacles(race.phase === 'countdown' ? [] : [{ s: pc.s, d: pc.d, v: Math.max(0, pc.u), len: race.me.len, w: race.me.w }]);
  }
  // eigenes Auto fahren + Kontakte; Crash: Kamera-Ruck (reduzierte Bewegung: keiner), Funken/Splitter, Blech-Klang –
  // stärker je Aufprall und je schwerer der andere; Schrammen: Funkenstrom + Schleifgeräusch statt Abprallen
  function driveStep(dt, inp) {
    var pc = race.pc, crash = null, scrape = null;
    Phys.stepContacts(pc, inp, dt, { len: race.me.len, w: race.me.w, shape: race.me.shape }, contactList(), function (o, h) {
      if (o.peer) peerHit(o, h);
      if (h.impact > 0 && o.q) nudgeAI(o, h);
      else if (h.impact > 0 && o.rq) rcHitAdd(o, h);
      if (h.impact >= Phys.CRASH_V) { if (!crash || h.impact > crash.impact) crash = h; }
      else if (h.slide > 1.5 && (!scrape || h.slide > scrape.slide)) scrape = h;
    });
    if (race.chat) rcHitSend();
    if (race.mp) peerBumpSend();
    race.crashT = Math.max(0, (race.crashT || 0) - dt);
    if (crash && race.crashT <= 0) {
      var mP = pc.P.mass, mO = isFinite(crash.o.mass) ? crash.o.mass : mP * 4, heavy = mO / (mO + mP);
      var lvl = clamp(crash.impact / 18 * (0.55 + 0.9 * heavy), 0.08, 1);
      race.shake = Math.min(0.7, race.shake + lvl * 0.55);
      race.crashT = 0.08;
      if (FX) FX.crash(crash.px, crash.pz, lvl, crash.nx, crash.nz);
      sfx('crash', lvl);
    }
    race.scrape = scrape && !crash ? clamp((scrape.slide - 1.5) / 14, 0.12, 1) : 0;
    if (race.scrape && FX) FX.scrape(scrape.px, scrape.pz, race.scrape, dt, scrape.tx, scrape.tz);
  }

  // ---- Kameras ----
  var CAMS = { chase: 'Chase camera', hood: 'Hood camera', tv: 'TV camera' }, CAM_ORDER = ['chase', 'hood', 'tv'];
  function setCam(m, snapNow) {
    race.camMode = m; race.tvIdx = -1;
    $('hCam').textContent = CAMS[m] + ' – C / Y to switch';
    if (snapNow) race.camPos = null;
  }
  // Streckenkameras: Abstand nach Streckenlänge (lange Strecken ~60 m, Kart ~40 m), sonst schneidet es zu oft
  function tvSpacing(T) { return clamp(T.len / 20, 40, 60); }
  function tvSpot(i) {
    var T = race.T, SP = tvSpacing(T), s = i * SP, a = T.at(s);
    var sd = a.runL >= a.runR ? 1 : -1, off = T.width / 2 + (sd > 0 ? a.runL : a.runR) + 4, x = a.x + a.nx * sd * off, z = a.z + a.nz * sd * off;
    return new THREE.Vector3(x, Math.max(gh(x, z), groundY(x, z)) + 5.5, z);
  }
  var tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3();
  // Tempogefühl (nur Optik – Fahrphysik und Zeiten bleiben): alles am Tempoverhältnis r = Tempo / vtop des eigenen
  // Autos, damit es je Auto gleich wirkt. Geglättet: r, Längsbeschleunigung (je s, relativ zu vtop), Gierrate.
  // Rütteln je Untergrund (Winkel in rad bei voller Fahrt; Randstein/Kies deutlich, Asphalt kaum)
  var SHAKE_SURF = { asphalt: 1, curb: 4.5, grass: 3, gravel: 5.5 }, SHAKE_A = 0.0011;
  function speedState(dt, pc, sp) {
    var vt = Math.max(1, pc.P.vtop), rRaw = clamp(sp / vt, 0, 1.3), dtt = Math.max(dt, 1e-3);
    var so = race.sos || (race.sos = { r: rRaw, sp: sp, acc: 0, yaw: pc.yaw, yr: 0, roll: 0, t: 0 });
    if (dt > 0) {
      so.r += (rRaw - so.r) * damp(4, dt);
      so.acc += (clamp((sp - so.sp) / dtt / vt, -1.5, 1.5) - so.acc) * damp(3, dt);
      so.yr += (clamp(wrapAngle(pc.yaw - so.yaw) / dtt, -3, 3) - so.yr) * damp(5, dt);
      so.t += dt;
    }
    so.sp = sp; so.yaw = pc.yaw;
    return so;
  }
  function updateCam(dt) {
    var pc = race.pc, me = race.me, fx = Math.cos(pc.yaw), fz = -Math.sin(pc.yaw), mode = race.camMode;
    var sp = Math.hypot(pc.vx, pc.vz), fov = 62, cy = me.holder.position.y;   // cy: Fahrbahnhöhe am Auto
    var so = speedState(dt, pc, sp), r = Math.min(1, so.r), mot = REDUCE ? 0.4 : 1, nitro = pc.nitroT > 0 && !REDUCE ? 1 : 0;
    lookReturn(dt);
    if (look.used) {
      // Umschauen (Startaufstellung und Rennen): Kreisbahn um das eigene Auto, folgt seiner Fahrtrichtung
      var ang = pc.yaw + Math.PI + look.yaw, hd = look.dist * Math.cos(look.pitch);
      tmpV.set(pc.x + Math.cos(ang) * hd, cy + look.dist * Math.sin(look.pitch) + me.height * 0.6, pc.z - Math.sin(ang) * hd);
      tmpV.y = Math.max(tmpV.y, groundY(tmpV.x, tmpV.z) + 0.6);   // nie ins Gelände
      tmpL.set(pc.x, cy + me.height * 0.5, pc.z);
      if (!race.camPos) { race.camPos = tmpV.clone(); race.camLook = tmpL.clone(); }
      race.camPos.lerp(tmpV, damp(14, dt)); race.camLook.lerp(tmpL, damp(14, dt));
      cam.position.copy(race.camPos); cam.lookAt(race.camLook);
      if (Math.abs(cam.fov - 60) > 0.05) { cam.fov += (60 - cam.fov) * damp(5, dt); cam.updateProjectionMatrix(); }
      return;
    }
    if (mode === 'chase') {
      // hinter dem Auto, Blickrichtung etwas in Fahrtrichtung (Drift sichtbar)
      var hx = fx, hz = fz;
      if (sp > 4) { var vx = pc.vx / sp, vz = pc.vz / sp; hx = fx * 0.7 + vx * 0.3; hz = fz * 0.7 + vz * 0.3; var l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l; }
      // bei Tempo tiefer und etwas näher; beim Beschleunigen bleibt die Kamera zurück, beim Bremsen rückt sie heran
      var back = (me.len * 1.15 + 4.2) * (1 - 0.14 * r * mot) + clamp(so.acc * 2.2, -0.7, 1.0) * mot, up = (1.7 + me.height * 0.9) * (1 - 0.2 * r * mot);
      tmpV.set(pc.x - hx * back, 0, pc.z - hz * back);
      // Höhe über der Fahrbahn am Auto bzw. – wenn es dahinter ansteigt – über dem Gelände an der Kamera
      tmpV.y = Math.max(cy + up, gh(tmpV.x, tmpV.z) + up * 0.75, groundY(tmpV.x, tmpV.z) + 0.8);
      var ahead = 4 + 3 * r;
      tmpL.set(pc.x + fx * ahead, gh(pc.x + fx * ahead, pc.z + fz * ahead) + me.height * 0.75, pc.z + fz * ahead);
      if (!race.camPos) { race.camPos = tmpV.clone(); race.camLook = tmpL.clone(); }
      race.camPos.lerp(tmpV, damp(7, dt)); race.camLook.lerp(tmpL, damp(12, dt));
      // Sichtfeld weitet sich mit dem Tempo (oben stärker), Nitro legt etwas drauf
      fov = 60 + 20 * mot * Math.pow(Math.min(so.r, 1.15), 1.4) + 4 * nitro;
    } else if (mode === 'hood') {
      me.holder.updateMatrixWorld(true);
      tmpV.set(me.len * 0.08, me.height * 1.02 + 0.12, 0); me.holder.localToWorld(tmpV);
      tmpL.set(me.len * 0.08 + 30, me.height * 0.8, 0); me.holder.localToWorld(tmpL);
      race.camPos = tmpV.clone(); race.camLook = tmpL.clone();
      fov = 68 + 16 * mot * Math.pow(Math.min(so.r, 1.15), 1.3) + 3 * nitro;
    } else {
      var SP = tvSpacing(race.T), n = Math.max(1, Math.floor(race.T.len / SP)), idx = Math.floor(((pc.s + SP / 2) % race.T.len) / SP) % n;
      if (idx !== race.tvIdx) { race.tvIdx = idx; race.tvPos = tvSpot(idx); race.camLook = new THREE.Vector3(pc.x, cy + 1, pc.z); }
      race.camPos = race.tvPos.clone();
      tmpL.set(pc.x, cy + me.height * 0.5, pc.z);
      race.camLook.lerp(tmpL, damp(10, dt));
      var dist = race.camPos.distanceTo(race.camLook);
      fov = clamp(2 * Math.atan(me.len * 1.6 / Math.max(1, dist)) * 180 / Math.PI, 12, 55);
    }
    cam.position.copy(race.camPos);
    if (race.shake > 0 && !REDUCE) {
      cam.position.x += (Math.random() - 0.5) * race.shake; cam.position.y += (Math.random() - 0.5) * race.shake * 0.6;
    }
    race.shake = Math.max(0, race.shake - dt * 1.5);
    if (mode !== 'hood') cam.position.y = Math.max(cam.position.y, groundY(cam.position.x, cam.position.z) + 0.5);
    cam.lookAt(race.camLook);
    if (mode !== 'tv') camFeel(dt, so, pc, sp, mode);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * damp(5, dt); cam.updateProjectionMatrix(); }
  }
  // Rütteln (hochfrequent, nach Tempo und Untergrund; Motorhaube etwas stärker) und leichtes Neigen in Kurven (aus
  // Gierrate × Tempo, wie Seitenkraft nach außen). Bei reduzierter Bewegung beides aus.
  function camFeel(dt, so, pc, sp, mode) {
    var rollT = 0;
    if (!REDUCE) {
      var k = SHAKE_SURF[pc.surface] || 1, rr = Math.min(so.r, 1.2);
      var amp = SHAKE_A * k * Math.pow(rr, 1.5) * (mode === 'hood' ? 1.4 : 1);
      if (pc.surface !== 'asphalt') amp = Math.max(amp, SHAKE_A * k * 0.35 * Math.min(1, sp / 6));   // neben der Bahn rumpelt es auch langsam
      if (amp > 1e-5) {
        var t = so.t, rn = Math.random() - 0.5;
        cam.rotateX(amp * (Math.sin(t * 61) * 0.4 + Math.sin(t * 97.3 + 1.7) * 0.3 + rn * 0.6));
        cam.rotateY(amp * 0.6 * (Math.sin(t * 73.1 + 0.4) * 0.5 + Math.sin(t * 41.7 + 2.2) * 0.3 + (Math.random() - 0.5) * 0.5));
      }
      rollT = clamp(-so.yr * Math.min(so.r, 1) * 0.035, -0.045, 0.045);
    }
    so.roll += (rollT - so.roll) * damp(4, dt);
    if (Math.abs(so.roll) > 1e-4) cam.rotateZ(so.roll);
  }
  // je Bild: Fahrtwind-Streifen/Vignette (nur Verfolger-/Haubenkamera ohne Umschauen), verwischter Asphalt,
  // verwischte Felgen am eigenen Auto und an nahen Fremdautos
  var RIM_NEAR = 40, RIM_N = 3;
  function speedFrame(dt) {
    var W = canvas.clientWidth || root.innerWidth, H = canvas.clientHeight || root.innerHeight;
    var live = race && race.pc && !race.paused && race.phase !== 'results' && race.phase !== 'countdown';
    var so = live ? race.sos : null, onboard = live && so && !look.used && (race.camMode === 'chase' || race.camMode === 'hood');
    var r = so ? so.r : 0;
    // Halle (dunkle Decke): helle Fahrtwind-Streifen würden zum grauen Schleier – dort nur angedeutet
    var dim = trackRes && trackRes.theme && trackRes.theme.indoor ? 0.3 : 1;
    if (SPD) SPD.set(onboard ? smooth(0.6, 1.0, r) * (race.camMode === 'hood' ? 1.15 : 1) * dim : 0, onboard ? 0.32 * smooth(0.45, 1.05, r) : 0, dt, W, H);
    if (trackRes && trackRes.setMotionBlur) trackRes.setMotionBlur(onboard && !REDUCE ? 0.3 * smooth(0.3, 1.0, r) : 0);
    if (!race) return;
    if (race.paused) dt = 0;
    if (race.me && race.me.rimBlur) race.me.rimBlur.set(race.pc ? smooth(0.12, 0.45, Math.hypot(race.pc.vx, race.pc.vz) / Math.max(1, race.pc.P.vtop)) : 0, dt);
    // Fremdautos: nur die RIM_N nächsten innerhalb RIM_NEAR (je Auto 4 Zeichenaufrufe, solange sichtbar)
    var list = [];
    (race.ai || []).concat(race.remotes || []).forEach(function (c) {
      if (!c || !c.rimBlur || c === race.me || list.some(function (x) { return x.c === c; })) return;
      list.push({ c: c, d: Math.hypot(c.holder.position.x - cam.position.x, c.holder.position.z - cam.position.z) });
    });
    list.sort(function (a, b) { return a.d - b.d; });
    list.forEach(function (x, i) {
      var c = x.c, vt = Math.max(1, (c.st && c.st.vmax) || 30);
      c.rimBlur.set(i < RIM_N && x.d < RIM_NEAR ? smooth(0.12, 0.45, (c.fxSpeed || 0) / vt) : 0, dt);
    });
  }

  // ---- Wertung ----
  // Wertung wie im Overlay (js/car-race.js): Zielankömmlinge nach Zielzeit vorn und dort eingefroren – wer einmal im
  // Ziel ist (Zielzeit gemeldet oder Fortschritt über der Ziellinie, Zeit kommt evtl. erst später übers Netz), bleibt
  // im Ziel; Gleichstand/geschätzte Zeiten nach Reihenfolge des Zieleinlaufs. Ohne Ziel nach Fortschritt dahinter.
  function standings() {
    var list = [{ me: true, key: 'me', name: race.me.name, prog: race.pc.prog, fin: race.finishT, dnf: false }];
    if (race.sim) race.sim.cars.forEach(function (q, i) {
      if (!race.ai[i] || q.ghost) return;
      list.push({ me: false, key: 'ai' + i, name: race.ai[i].name, prog: q.s, fin: q.place != null ? q.finish : null, dnf: q.place == null && q.state === 'dnf' && q.wreck });
    });
    if (race.remotes) race.remotes.forEach(function (c) {
      var fin = mp && mp.fin[c.id] != null ? mp.fin[c.id] : mp && mp.info && mp.info.fin && mp.info.fin[c.id] != null ? mp.info.fin[c.id] : c.finQ;
      list.push({ me: false, key: 'r' + c.id, name: c.label, prog: c.prog, fin: fin != null ? fin : null, dnf: false });
    });
    var seen = race.finSeen || (race.finSeen = {}), line = race.T.len * race.laps;
    list.forEach(function (x) {
      if (x.fin == null && !x.dnf && race.phase !== 'countdown' && x.prog >= line) x.fin = seen[x.key] ? seen[x.key].t : race.t;
      if (x.fin != null && !seen[x.key]) seen[x.key] = { t: x.fin, n: race.finN = (race.finN || 0) + 1 };
      if (x.fin == null && seen[x.key]) x.fin = seen[x.key].t;
      x.order = seen[x.key] ? seen[x.key].n : 0;
    });
    list.sort(function (a, b) {
      if ((a.fin != null) !== (b.fin != null)) return a.fin != null ? -1 : 1;
      if (a.fin != null) return a.fin - b.fin || a.order - b.order;
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      return b.prog - a.prog;
    });
    return list;
  }
  // eigener Endplatz aus dem Server-Ergebnis (sobald da), sonst null
  function serverPlace() {
    if (!race || !race.mp || !mp || !mp.results || mp.results.race_id !== race.raceId) return null;
    var r = mp.results.list.filter(function (x) { return String(x.id) === mp.me; })[0];
    return r && r.place ? r.place : null;
  }
  function setText(id, t) { var el = $(id); if (el.textContent !== t) el.textContent = t; }
  // große Zahl mit kleinem „/gesamt“ dahinter
  function bigNum(id, a, b) {
    var el = $(id), sm = doc.createElement('small');
    el.textContent = String(a); sm.textContent = '/' + b; el.appendChild(sm);
  }
  function updateHud(list) {
    var pc = race.pc, n = list.length, pos = 1;
    list.forEach(function (x, i) { if (x.me) pos = i + 1; });
    if (race.finishT != null && serverPlace()) pos = serverPlace();
    var posTxt = pos + '/' + n;
    if (race.posShown !== posTxt) { bigNum('hPos', pos, n); race.posShown = posTxt; }
    var lap = Math.min(race.laps, pc.laps + 1);
    if (race.lapsShown !== lap) { bigNum('hLap', lap, race.laps); race.lapsShown = lap; }
    setText('hCur', fmt(race.phase === 'race' ? race.t - race.lapStart : race.phase === 'countdown' ? 0 : null));
    setText('hLast', fmt(race.lastLap));
    var best = race.bestLap != null && (race.stored == null || race.bestLap < race.stored) ? race.bestLap : race.stored;
    setText('hBest', fmt(best));
    setText('hSpeed', String(Math.round(Phys.speedKmh(pc))));
    var rev = pc.u < -0.5;
    if ($('hGear').hidden === rev) $('hGear').hidden = !rev;
    recHud();
    var nb = $('hNitro'), state = pc.nitroT > 0 ? 'on' : Phys.nitroReady(pc) && pc.prog > 0 ? 'ready' : 'used';
    if (nb.dataset.state !== state) { nb.dataset.state = state; setText('hNitroText', state === 'on' ? 'Nitro!' : state === 'ready' ? 'Nitro ready' : 'Nitro next lap'); }
  }

  function aiDrivesMe() { return !!(race && mp && (race.chat ? race.taken[mp.me] : race.mp && mpTaken(mp.me))); }
  function lapDone(lapTime) {
    if (race.lapAi || aiDrivesMe()) { race.lapAi = aiDrivesMe(); race.lastLap = lapTime; flash('Lap ' + fmt(lapTime) + ' – the AI drove part of it', 2); return; }
    race.lastLap = lapTime;
    if (race.bestLap == null || lapTime < race.bestLap) race.bestLap = lapTime;
    var big = false;
    if (race.stored == null || lapTime < race.stored) {
      race.stored = lapTime; race.newBest = true;
      save('best2.' + race.s.car + '.' + race.seed, Math.round(lapTime * 1000) / 1000);
      flash('Best lap ' + fmt(lapTime), 2);
    } else flash('Lap ' + fmt(lapTime), 1.5);
    if (!race.mp) {
      // solo (ohne Prüfung): Streckenrekord nur lokal; der Server-Rekord wird nur verglichen, nie geschrieben
      if (!race.local || lapTime < race.local.t) {
        race.local = { t: Math.round(lapTime * 1000) / 1000, car: race.s.car, name: race.me.name };
        save('trackBest2.' + race.seed, race.local);
        flash('New local track record ' + fmt(lapTime), 2.5, true); big = true;
      }
      if (race.rec && race.rec.track && lapTime < race.rec.track.time) flash('Faster than the track record – solo laps are not counted', 3);
    }
    sfx('jingle', big);
  }

  // ---- Rundenrekorde (Server: geprüfte Runden; solo nur lesen) ----
  function recUrl(track, car) {
    var base = CFG && CFG.records ? CFG.records + '?' : root.__WIDGET_TOKEN__ ? '/s/' + root.__WIDGET_TOKEN__ + '/api/fx/car-race?cmd=records&' : null;
    return base ? base + 'track=' + track + (car ? '&car=' + encodeURIComponent(car) : '') : null;
  }
  function recLoad(r, track) {
    r.rec = { idx: track, track: null, car: null };
    r.local = load('trackBest2.' + r.seed, null);
    if (r.local && !(r.local.t > 0)) r.local = null;
    var url = recUrl(track, r.s.car);
    if (!url) return;
    fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (x) { return x.json(); }).then(function (j) {
      if (race !== r || !j || !j.ok) return;
      r.rec.track = j.record || null; r.rec.car = j.car || null;
      r.rec.cars = Array.isArray(j.cars) ? j.cars : []; r.rec.mine = j.mine || null; r.rec.signed = 'mine_all' in j;
    }).catch(function () { /* ohne Rekorde */ });
  }
  function recName(row) {
    var e = row && byKey[row.car_key];
    return row ? row.car_name || (e ? displayName(e) : row.car_key) : '';
  }
  function recHud() {
    var rec = race.rec || {}, solo = !race.mp, carRow = solo ? null : rec.car;
    setText('hCarRecLbl', solo ? 'Local record' : 'Car record');
    if (solo) {
      setText('hCarRec', race.local ? fmt(race.local.t) : '–');
      setText('hCarRecBy', race.local ? (race.local.name || race.local.car || '') : '');
    } else {
      setText('hCarRec', carRow ? fmt(carRow.time) : '–');
      setText('hCarRecBy', carRow ? carRow.display : '');
    }
    // Klassen-Rekord: schnellste Bestzeit je Auto unter den Autos derselben Klasse (Car editor „Record class“)
    var myCls = race.me && race.me.raw ? race.me.raw.rclass : null, clsRow = null;
    if (myCls && root.CarRaceStats) (rec.cars || []).forEach(function (x) {
      if (!clsRow && CarRaceStats.of(x.car_key).rclass === myCls) clsRow = x;
    });
    setText('hClassRecLbl', myCls && root.CarRaceStats ? CarRaceStats.rclassName(myCls) : 'Class record');
    setText('hClassRec', clsRow ? fmt(clsRow.time) : '–');
    setText('hClassRecBy', clsRow ? clsRow.display + ' · ' + recName(clsRow) : '');
    // eigene Bestzeit dieser Strecke (jedes Auto; nur angemeldet, Chatrennen/Räume)
    var showMine = !solo && !!rec.signed;
    ['hMineLbl', 'hMine', 'hMineBy'].forEach(function (id) { $(id).hidden = !showMine; });
    if (showMine) { setText('hMine', rec.mine ? fmt(rec.mine.time) : '–'); setText('hMineBy', rec.mine ? recName(rec.mine) : ''); }
    setText('hTrackRec', rec.track ? fmt(rec.track.time) : '–');
    setText('hTrackRecBy', rec.track ? rec.track.display + ' · ' + recName(rec.track) : '');
  }
  // WS-Meldung „rec“: geprüfte Runde war Bestzeit/Rekord (eigene → große Einblendung)
  function recMsg(m) {
    if (!race || !race.mp || !race.rec || m.track !== race.rec.idx) return;
    var mine = mp && String(m.id) === mp.me, row = { display: m.name, car_key: m.car, time: m.time };
    if (m.track_rec) race.rec.track = m.best_track || row;
    if (m.car === race.s.car && (m.car_rec || !race.rec.car)) race.rec.car = m.best_car || row;
    // Bestzeit je Auto (Klassen-Rekord) und eigene Bestzeit nachziehen, Liste bleibt nach Zeit sortiert
    var cars = (race.rec.cars || []).filter(function (x) { return x.car_key !== m.car; }), old = (race.rec.cars || []).filter(function (x) { return x.car_key === m.car; })[0];
    cars.push(old && old.time <= m.time ? old : row); cars.sort(function (a, b) { return a.time - b.time; }); race.rec.cars = cars;
    if (mine && race.rec.signed && (!race.rec.mine || m.time < race.rec.mine.time)) race.rec.mine = row;
    if (mine && m.track_rec) { flash('NEW TRACK RECORD ' + fmt(m.time), 3.5, true); sfx('jingle', true); say('New track record'); }
    else if (mine && m.car_rec) { flash('NEW CAR RECORD ' + fmt(m.time), 3, true); sfx('jingle', true); say('New car record'); }
    else if (!mine && m.track_rec) flash('Track record by ' + m.name + ' – ' + fmt(m.time), 2.5);
  }

  function showResults() {
    race.phase = 'results';
    var list = standings();
    if (race.mp && mp && mp.results) {
      // Mehrspieler: Wertung vom Server (nur plausible Fahrer bekommen einen Platz)
      list = mp.results.list.map(function (r) {
        return { me: String(r.id) === mp.me, name: r.name, place: r.place, fin: r.status === 'finished' ? r.time : null,
          dnf: r.status === 'dnf', invalid: r.status === 'invalid' };
      }).sort(function (a, b) { return (a.place || 1e9) - (b.place || 1e9); });
    }
    ui.results.textContent = '';
    list.forEach(function (x, i) {
      var li = doc.createElement('li'); if (x.me) li.className = 'me';
      var pl = doc.createElement('span'); pl.className = 'pl'; pl.textContent = race.mp ? (x.place ? String(x.place) : '–') : String(i + 1);
      var nm = doc.createElement('span'); nm.textContent = x.name;
      if (x.me) { var tg = doc.createElement('span'); tg.className = 'tag'; tg.textContent = 'You'; nm.appendChild(tg); }
      var tm = doc.createElement('span'); tm.className = 'tm';
      tm.textContent = x.fin != null ? fmt(x.fin) : x.invalid ? 'Not counted' : x.dnf ? 'DNF' : 'running';
      li.appendChild(pl); li.appendChild(nm); li.appendChild(tm); ui.results.appendChild(li);
    });
    $('againBtn').textContent = race.mp ? 'Back to lobby' : 'Race again';
    $('finishMenuBtn').textContent = race.chat ? 'Close' : race.mp ? 'Leave room' : 'Back to menu';
    ui.finishNote.textContent = '';
    if (race.mp) mpFinishNote();
    ui.finishBest.textContent = '';
    if (race.bestLap != null) {
      ui.finishBest.appendChild(doc.createTextNode('Your best lap: '));
      var b = doc.createElement('strong'); b.textContent = fmt(race.bestLap); ui.finishBest.appendChild(b);
      if (race.newBest) ui.finishBest.appendChild(doc.createTextNode(' – new record for this car on ' + race.T.name + '.'));
    }
    showPanel('finish');
  }

  // Nach dem Zieleinlauf fährt der Spieler locker auf der Linie weiter (einfacher Autopilot)
  function cruise(pc) {
    var T = race.T, a = T.at(pc.s + 6 + Math.abs(pc.u) * 0.5);
    var err = wrapAngle(Math.atan2(-(a.z - pc.z), a.x - pc.x) - pc.yaw), vmax = 1e9;
    for (var k = 0; k <= 40; k += 4) vmax = Math.min(vmax, Math.sqrt(pc.P.grip * 0.7 / Math.max(Math.abs(T.at(pc.s + k).curv), 1e-4)) + k * 0.3);
    vmax = Math.min(vmax, pc.P.vtop * 0.6);
    return { steer: clamp(err * 2.5, -1, 1), throttle: pc.u < vmax ? 0.7 : 0, brake: pc.u > vmax + 2 ? 0.6 : 0 };
  }

  // ---- Mehrspieler ----
  var mp = null;
  // Streamer: Raum-Befehle über die Token-Route (wie Streamer.bot)
  function api(cmd, extra, body) {
    var url = '/s/' + (root.__WIDGET_TOKEN__ || '') + '/api/fx/car-drive?cmd=' + cmd + (extra || '');
    var init = { credentials: 'same-origin' };
    if (body) { init.method = 'POST'; init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
    return fetch(url, init).then(function (r) { return r.json().catch(function () { return { ok: false, say: 'HTTP ' + r.status }; }); });
  }
  function wsUrl(code) {
    var q = null;
    try { q = new URLSearchParams(root.location.search).get('ws'); } catch (e) { /* alt */ }   // lokal ohne nginx: ?ws=ws://127.0.0.1:9010
    return (q || ((root.location.protocol === 'https:' ? 'wss://' : 'ws://') + root.location.host)) + '/drive-ws/' + code;
  }
  // Grenzwerte je Auto für die Plausibilitätsprüfung (gleiche Werte wie die Fahrphysik): Endtempo, Sim-Rundenzeit je Strecke
  function driveLimits() {
    var cars = {}, tracks = Sim.TRACKS.map(function (seed) { return Sim.track(seed); });
    catalog.forEach(function (e) {
      try {
        var raw = Stats.of(e.key, e), st = Sim.stats(raw), P = Phys.params(st, raw);
        cars[e.key] = { vtop: Math.round(P.vtop * 1000) / 1000, lap: tracks.map(function (T) { return Math.round(Sim.lapTime(st, T) * 1000) / 1000; }) };
      } catch (err) { /* ohne Werte gilt die globale Grenze */ }
    });
    return { cars: cars };
  }
  function rosterById(id) { return mp ? mp.roster.filter(function (d) { return String(d.id) === String(id); })[0] : null; }
  function gridPose(gi) { return { s: -(4 + Math.floor(gi / 2) * 7.5), d: gi % 2 === 0 ? 2.3 : -2.3 }; }   // wie fx/drive_room.grid_pose
  function setLobbyStatus(t) { ui.lobbyStatus.textContent = t || ''; }
  function showLobby() { showPanel('lobby'); renderRoster(); }
  function lobbyTrack() {
    var T = Sim.track(Sim.TRACKS[mp.room.track | 0] || 1), n = mp.room.laps | 0;
    $('lobbyTrack').textContent = T.name + ' · ' + n + ' lap' + (n === 1 ? '' : 's');
  }
  function renderRoster() {
    if (!mp) return;
    ui.roster.textContent = '';
    $('lobbyCount').textContent = mp.roster.length + '/8';
    if (!mp.roster.length) {
      var e0 = doc.createElement('li'); e0.className = 'roster-empty'; e0.textContent = 'Nobody on the grid yet.'; ui.roster.appendChild(e0);
    }
    mp.roster.forEach(function (d) {
      var li = doc.createElement('li');
      if (String(d.id) === mp.me) li.className = 'me';
      if (!d.connected) li.dataset.off = '1';
      var nm = doc.createElement('span'); nm.textContent = d.name;
      [[d.host, 'Host'], [String(d.id) === mp.me, 'You'], [!d.connected, 'offline']].forEach(function (t) {
        if (!t[0]) return;
        var tg = doc.createElement('span'); tg.className = 'tag'; tg.textContent = t[1]; nm.appendChild(tg);
      });
      if (d.connected) {
        var pg = doc.createElement('span'); pg.className = 'ping'; nm.appendChild(pg);
        pingText(pg, String(d.id) === mp.me ? (mp.net && mp.net.ping() ? mp.net.ping().ms : null) : mp.net && mp.net.peerPing(String(d.id)));
      }
      var car = doc.createElement('span'); car.className = 'car'; car.textContent = byKey[d.car] ? displayName(byKey[d.car]) : d.car || '–';
      li.appendChild(nm); li.appendChild(car); ui.roster.appendChild(li);
    });
    $('mpStartBtn').disabled = !mp.roster.length || mp.phase === 'countdown' || mp.phase === 'race';
  }
  // Ping-Text (ms); ab PING_HIGH zusätzlich „high“, damit nicht nur die Farbe den Zustand zeigt
  var PING_HIGH = 150, LAG_SHOW = 0.4;
  function pingText(el, ms) {
    var t = ms == null ? '' : ms + ' ms' + (ms >= PING_HIGH ? ' high' : '');
    if (el.textContent !== t) el.textContent = t;
    if (ms != null && ms >= PING_HIGH) el.dataset.high = '1'; else delete el.dataset.high;
  }
  // Lobby: Pings kommen einmal pro Sekunde (S mit pg) – Liste nur bei Änderung neu aufbauen
  function rosterPings() {
    if (!mp || ui.lobby.hidden) return;
    var key = mp.roster.map(function (d) {
      return String(d.id) === mp.me ? (mp.net.ping() ? mp.net.ping().ms : '') : mp.net.peerPing(String(d.id));
    }).join(',');
    if (key !== mp.pingKey) { mp.pingKey = key; renderRoster(); }
  }
  // HUD: eigener Ping + Zittern, darunter die anderen Fahrer mit Ping und „lag“, solange Daten fehlen
  var netHudAt = 0;
  function netHud() {
    var box = $('hNet'), on = !!(race && (race.mp || race.chat) && mp && mp.net && race.phase !== 'results');
    if (box.hidden === on) box.hidden = !on;
    if (!on) return;
    var t = performance.now();
    if (t - netHudAt < 500) return;
    netHudAt = t;
    var me = mp.net.ping();
    setText('hNetMe', me ? 'Ping ' + me.ms + ' ms · jitter ' + me.jitter + ' ms' + (me.ms >= PING_HIGH ? ' · high' : '') : 'Ping –');
    if (me && me.ms >= PING_HIGH) $('hNetMe').dataset.high = '1'; else delete $('hNetMe').dataset.high;
    var list = $('hNetList'), rows = (race.remotes || []).filter(Boolean);
    while (list.children.length > rows.length) list.removeChild(list.lastChild);
    rows.forEach(function (c, i) {
      var li = list.children[i];
      if (!li) {
        li = doc.createElement('li');
        var n = doc.createElement('span'); n.className = 'nm'; li.appendChild(n);
        var p = doc.createElement('span'); p.className = 'ping'; li.appendChild(p);
        list.appendChild(li);
      }
      var ai = !!((race.chat && race.taken && race.taken[c.id]) || (!race.chat && mpTaken(c.id)));
      var lag = !ai && mp.net.lag(c.id) > LAG_SHOW;
      if (li.firstChild.textContent !== c.label) li.firstChild.textContent = c.label;
      pingText(li.lastChild, ai ? null : mp.net.peerPing(c.id));
      if (ai) li.lastChild.textContent = 'AI';
      if (lag) { li.dataset.lag = '1'; li.lastChild.textContent = (li.lastChild.textContent ? li.lastChild.textContent + ' · ' : '') + 'lag'; }
      else delete li.dataset.lag;
    });
  }
  function mpLoad(key) {
    var e = key && byKey[key];
    if (!mp || !e) return Promise.resolve();
    if (mp.loading[key]) return mp.loading[key];
    var m = mp;
    return (m.loading[key] = TC.loadModel(e, m.light ? { race: true } : undefined)
      .then(function (t) { if (TC.mergeForRace) TC.mergeForRace(t); m.loaded[key] = true; })
      .catch(function () { m.loaded[key] = false; }));
  }
  function mpStart(o) {
    mpStop();
    mp = { code: o.code, url: o.url || '', role: o.role, me: String(o.me), room: o.room || {}, roster: [], car: o.car,
      paint: o.paint | 0, light: !!o.light, duck: o.duck !== false, phase: (o.room || {}).phase || 'lobby', raceId: null,
      startAt: null, grid: [], fin: {}, results: null, recorded: null, loaded: {}, loading: {}, taken: {}, follow: {}, carrier: null };
    app.dataset.role = o.role;
    $('lobbyCode').textContent = mp.code;
    $('lobbyUrl').value = mp.url;
    lobbyTrack();
    showLobby();
    setLobbyStatus('Connecting…');
    mpLoad(mp.car);
    var m = mp;
    mp.net = Net.connect({ url: wsUrl(mp.code), ticket: o.ticket, onMessage: function (msg) { if (mp === m) mpMsg(msg); },
      onState: function (on) { if (!on && mp === m) setLobbyStatus('Connection lost – reconnecting…'); } });
  }
  function mpStop() {
    if (!mp) return;
    try { mp.net.close(); } catch (e) { /* zu */ }
    mp = null;
    delete app.dataset.role;
  }
  function mpLeave(msg) {
    mpStop();
    teardown();
    showPanel('menu');
    ui.status.textContent = msg || '';
  }
  function mpMsg(m) {
    switch (m.t) {
      case 'welcome':
        mp.me = String(m.id); mp.room = m.room || mp.room; mp.phase = mp.room.phase; mp.roster = m.roster || [];
        mp.carrier = m.carrier == null ? null : String(m.carrier);
        (m.taken || []).forEach(function (ev) { mpTakeover(ev); });
        lobbyTrack(); renderRoster();
        mp.net.send({ t: 'join', car: mp.car, paint: mp.paint });
        setLobbyStatus(mp.room && mp.room.test ? 'Test room – races start by themselves 10 s after the last driver joined; nothing is saved.' :
          mp.role === 'host' ? 'Post the link in the chat, then start the race.' : 'Waiting for the streamer to start the race.');
        break;
      case 'joined':
        // Rennen läuft schon: Beitritt merken und beim nächsten Ergebnis/Lobby automatisch wiederholen
        mp.wantJoin = !m.ok && /race running/.test(m.msg || '');
        if (!m.ok) setLobbyStatus(mp.wantJoin ? 'A race is running – you join the next one automatically.' : m.msg);
        break;
      case 'garage': garageChanged(m.garage); break;
      case 'S': if (m.pg) rosterPings(); break;
      case 'takeover': case 'release': mpTakeover(m.ev); break;
      case 'bump': peerBump(m); break;
      case 'carrier': mp.carrier = m.id == null ? null : String(m.id); break;
      case 'ai_denied': mpDenied(); break;
      case 'roster':
        mp.roster = m.list || []; renderRoster();
        mp.roster.forEach(function (d) { mpLoad(d.car); });
        break;
      case 'phase':
        mpPhase(m);
        if (mp && mp.wantJoin && (m.phase === 'done' || m.phase === 'lobby')) { mp.wantJoin = false; mp.net.send({ t: 'join', car: mp.car, paint: mp.paint }); }
        break;
      case 'lap':
        if (m.fin != null) mp.fin[String(m.id)] = m.fin;
        if (String(m.id) === mp.me && !m.ok && race && race.mp) flash('Lap not counted', 2.5);
        break;
      case 'results':
        mp.results = m;
        if (race && race.mp && race.raceId === m.race_id && race.phase === 'race') showResults();
        if (!race || !race.mp) {
          var w = (m.list || []).filter(function (r) { return r.place === 1; })[0];
          setLobbyStatus(w ? 'Last race won by ' + w.name + ' (' + fmt(w.time) + ').' : 'Last race finished without a valid winner.');
        }
        break;
      case 'recorded':
        mp.recorded = m;
        if (race && race.mp && race.phase === 'results') mpFinishNote();
        break;
      case 'rec': recMsg(m); break;
      case 'closed': mpLeave(m.msg ? m.msg.charAt(0).toUpperCase() + m.msg.slice(1) + '.' : 'The room was closed.'); break;
      case 'gone': mpLeave(m.code === 4401 ? 'Sign-in expired – reload the page.' : m.code === 4404 ? 'This room is closed.' : 'Connection lost.'); break;
      case 'error': setLobbyStatus(m.msg); break;
    }
  }
  function mpPhase(m) {
    mp.phase = m.phase; mp.room.phase = m.phase;
    if (m.track != null) mp.room.track = m.track;
    if (m.laps) mp.room.laps = m.laps;
    lobbyTrack();
    if ((m.phase === 'countdown' || m.phase === 'race') && m.race_id) {
      if (m.race_id !== mp.raceId) { mp.fin = {}; mp.results = null; mp.recorded = null; mp.taken = {}; mp.follow = {}; mp.carrier = null; }
      mp.raceId = m.race_id; mp.startAt = m.start_at; mp.grid = m.grid || [];
      var mine = mp.grid.some(function (g) { return String(g.id) === mp.me; });
      if (!mine) setLobbyStatus('Race running – you will be on the grid next time.');
      else if (!(race && race.mp && race.raceId === mp.raceId) && !mpBeginRace.pending) mpBeginRace();
    }
    renderRoster();
  }
  // Countdown: Modelle der Startaufstellung laden (höchstens bis kurz vor dem Start), dann Szene aufbauen
  function mpBeginRace() {
    teardown();
    showPanel('loading');
    var keys = [mp.car], seen = {}, done = 0;
    mp.grid.forEach(function (g) { var d = rosterById(g.id); if (d && d.car) keys.push(d.car); });
    keys = keys.filter(function (k) { if (seen[k]) return false; seen[k] = 1; return true; });
    ui.loadBar.max = keys.length; ui.loadBar.value = 0;
    ui.loadText.textContent = 'Loading ' + keys.length + ' car' + (keys.length === 1 ? '' : 's') + '…';
    var token = {}; begin.token = token; mpBeginRace.pending = true;
    var all = Promise.all(keys.map(function (k) { return mpLoad(k).then(function () { done++; ui.loadBar.value = done; }); }));
    var wait = Math.max(0.3, mp.startAt - mp.net.serverNow() - 1.2);
    Promise.race([all, new Promise(function (res) { setTimeout(res, wait * 1000); })]).then(function () {
      mpBeginRace.pending = false;
      if (begin.token !== token || !mp) return;
      setupRaceMP();
    });
  }
  function setupRaceMP() {
    var idx = mp.room.track | 0, seed = Sim.TRACKS[idx] || 1, T = Sim.track(seed);
    buildTrack(T);
    var RD = root.RubberDuck, outfits = RD && RD.OUTFITS ? RD.OUTFITS : [], myGrid = 0, remotes = [];
    mp.grid.forEach(function (g) {
      if (String(g.id) === mp.me) { myGrid = g.grid | 0; return; }
      var d = rosterById(g.id) || { car: null, paint: 0, name: '?' };
      var c = makeCar(d.car, d.car ? TC.paintAt(d.car, d.paint | 0) : null, { loaded: !!mp.loaded[d.car], duck: mp.duck,
        outfit: outfits.length ? outfits[Math.floor(Math.random() * outfits.length)] : null });
      var p = gridPose(g.grid | 0), a = T.at(p.s);
      c.id = String(g.id); c.label = d.name || '?'; c.prog = p.s; c.smp = null;
      placeCar(c, a.x + a.nx * p.d, a.z + a.nz * p.d, a.yaw, 0, 0, 0, 0);
      remotes.push(c);
    });
    var me = makeCar(mp.car, TC.paintAt(mp.car, mp.paint), { loaded: !!mp.loaded[mp.car], duck: mp.duck, outfit: null });
    var pc = Phys.create(T, Phys.params(me.st, me.raw), gridPose(myGrid));
    race = {
      s: { car: mp.car, paint: mp.paint, track: idx, laps: mp.room.laps }, T: T, seed: seed, sim: null, ai: [], remotes: remotes,
      mp: true, raceId: mp.raceId, me: me, pc: pc, laps: mp.room.laps | 0 || 2, phase: 'countdown', paused: false,
      t: 0, cd: mp.startAt - mp.net.serverNow(), lapStart: 0, lastLap: null, bestLap: null, stored: load('best2.' + mp.car + '.' + seed, null),
      prev: null, finishT: null, doneT: 0, camMode: 'chase', camPos: null, camLook: null, tvIdx: -1, shake: 0,
      lapsShown: -1, posShown: '', opp: [], newBest: false
    };
    recLoad(race, idx);
    placeCar(me, pc.x, pc.z, pc.yaw, 0, 0, 0, 0);
    ui.hud.hidden = false; showPanel(null);
    setCam('chase', true);
    ui.countdown.hidden = false; ui.countdown.textContent = '';
    say('Race starts soon');
    canvas.setAttribute('tabindex', '-1');
    try { canvas.focus({ preventScroll: true }); } catch (e) { /* */ }
  }
  function mpSend() {
    if (!mp || !mp.net || !race || !race.mp || race.raceId !== mp.raceId || race.spect) return;
    var pc = race.pc;
    mp.net.sendState({ x: pc.x, z: pc.z, yaw: pc.yaw, roll: pc.roll, pitch: pc.pitch, steer: pc.steer,
      speed: Math.hypot(pc.vx, pc.vz), prog: pc.prog, t: race.phase === 'countdown' ? 0 : race.t, spin: pc.spin });
  }
  function drawRemotes() {
    if (!race.remotes || !mp || !mp.net) return;
    var now = mp.net.serverNow(), at = now - mp.net.delay(), t = now - mp.startAt;
    race.remotes.forEach(function (c) {
      var f = mpTaken(c.id) ? mpFollower(c.id, c.st) : null, q;
      if (f) { var fq = f.at(t); q = fqState(fq); c.finQ = fq.finish; }
      else q = netPose(c, at);
      c.smp = q; c.isAi = !!f;
      if (!q) return;
      q = blendSrc(c, q, f ? 'ai' : 'net');
      c.prog = q.prog;
      placeCar(c, q.x, q.z, q.yaw, q.roll, q.pitch, q.steer, q.spin);
    });
    // eigenes Auto übernommen: Lage/Runden aus dem Nachfahrer (wie im Chatrennen)
    if (mpTaken(mp.me) && race.phase === 'race') {
      var pc = race.pc, f2 = mpFollower(mp.me, race.me.st), q2 = f2 && f2.at(t);
      if (q2) {
        pc.x = q2.x; pc.z = q2.z; pc.yaw = q2.yaw; pc.prog = q2.s; if (q2.s > 0) pc.laps = Math.max(pc.laps, Math.min(race.laps, Math.floor(q2.s / race.T.len)));
        pc.vx = Math.cos(q2.yaw) * q2.v; pc.vz = -Math.sin(q2.yaw) * q2.v; pc.u = q2.v; pc.steer = q2.steer; pc.spin = q2.spin;
      }
    }
  }
  function fqState(fq) { return { x: fq.x, z: fq.z, yaw: fq.yaw, roll: fq.roll, pitch: 0, steer: fq.steer, spin: fq.spin, speed: fq.v, prog: fq.s }; }
  // Wechsel der Quelle (Netz ↔ KI-Nachfahrer): Versatz über 0,5 s abbauen statt zu springen
  function blendSrc(c, q, src) {
    var b = c.blend || (c.blend = {}), t = performance.now() / 1000;
    if (b.src && b.src !== src && b.x != null) {
      var dx = b.x - q.x, dz = b.z - q.z;
      if (dx * dx + dz * dz < 400) { b.dx = dx; b.dz = dz; b.dy = wrapAngle(b.yaw - q.yaw); b.t0 = t; } else b.t0 = null;
    }
    b.src = src;
    var k = b.t0 != null ? 1 - (t - b.t0) / 0.5 : 0;
    if (k > 0) q = Object.assign({}, q, { x: q.x + b.dx * k, z: q.z + b.dz * k, yaw: q.yaw + b.dy * k });
    else b.t0 = null;
    b.x = q.x; b.z = q.z; b.yaw = q.yaw;
    return q;
  }
  // ---- Räume: KI-Übernahme bei Verbindungsabbruch (fx/drive_room.Room._takeovers) ----
  // 3 s ohne Zustand im Rennen → takeover {ev}; alle fahren das Auto mit dem Nachfahrer ab ev weiter, der Träger
  // (Server bestimmt, Nachricht carrier) meldet dessen Lage (s mit for, 5 Hz), damit Runden und Ziel zählen.
  function mpTaken(id) { return !!(mp && mp.taken && mp.taken[id]); }
  function mpTakeover(ev) {
    if (!mp || !ev || ev.id == null) return;
    var id = String(ev.id), was = mpTaken(id);
    if (ev.type === 'release') delete mp.taken[id]; else mp.taken[id] = ev;
    delete mp.follow[id];
    if (id !== mp.me || !race || !race.mp || race.chat) return;
    race.spect = mpTaken(id);
    if (race.spect) { race.lapAi = true; if (!was) flash('Connection lost – the AI took over your car. Press P to take the wheel', 4); }
    aiBtnSync();
  }
  function mpFollower(id, st) {
    var ev = mp.taken[id];
    if (!ev || !race || !st) return null;
    if (!mp.follow[id]) {
      var snap = ev.x != null ? ev : { t: ev.t, s: ev.prog, d: ev.d || 0, speed: ev.speed || 0 };
      mp.follow[id] = Sim.follower(race.T, st, snap, { laps: race.laps });
    }
    return mp.follow[id];
  }
  var aiSendAt = 0;
  function mpSendAi() {
    if (!mp || !mp.net || mp.carrier !== mp.me || !race || !race.mp || race.chat || race.raceId !== mp.raceId) return;
    var ids = Object.keys(mp.taken);
    if (!ids.length) return;
    var w = performance.now();
    if (w - aiSendAt < 200) return;
    aiSendAt = w;
    var sn = mp.net.serverNow(), t = sn - mp.startAt;
    ids.forEach(function (id) {
      if (id === mp.me || mp.fin[id] != null) return;
      var c = (race.remotes || []).filter(function (x) { return x.id === id; })[0];
      var f = c && mpFollower(id, c.st), q = f && f.at(t);
      if (!q) return;
      mp.net.send({ t: 's', for: id, x: q.x, z: q.z, yaw: q.yaw, roll: q.roll || 0, pitch: 0, steer: q.steer, speed: q.v,
        prog: q.s, rt: t, spin: q.spin, ts: Math.round(sn * 1000) / 1000 });
    });
  }
  // Taste P / Menü: nach der Übernahme wieder selbst steuern (ab der Lage des Nachfahrers)
  function mpTakeWheel() {
    if (!race || !race.mp || race.chat || !mp || race.phase !== 'race' || !mpTaken(mp.me)) return;
    var t = mp.net.serverNow() - mp.startAt, f = mpFollower(mp.me, race.me.st), q = f && f.at(t), pc = race.pc;
    if (!q || q.finish != null) { flash('The AI already finished the race for you', 2); return; }
    pc.x = q.x; pc.z = q.z; pc.yaw = q.yaw; pc.u = q.v; pc.vx = Math.cos(q.yaw) * q.v; pc.vz = -Math.sin(q.yaw) * q.v;
    pc.r = 0; pc.w = 0; pc.steer = q.steer; pc.spin = q.spin; pc.prog = q.s; pc.hint = -1;
    pc.laps = Math.max(pc.laps, q.s > 0 ? Math.floor(q.s / race.T.len) : 0);
    steerKb = thrKb = brkKb = 0;
    mp.wheelPrev = mp.taken[mp.me];
    mp.net.send({ t: 'release', x: q.x, z: q.z, yaw: q.yaw, speed: q.v, prog: q.s, rt: t });
    mpTakeover({ type: 'release', id: mp.me });
    race.lapAi = true;
    flash('You have the wheel', 1.5); say('You have the wheel');
  }
  function mpDenied() {
    if (!mp || !race || !race.mp || race.chat || !mp.wheelPrev || mpTaken(mp.me)) return;
    mpTakeover(mp.wheelPrev); mp.wheelPrev = null;
    flash('Could not take the wheel right now', 2.5);
  }
  function mpFinishNote() {
    if (!mp) return;
    var parts = [], mine = mp.results ? mp.results.list.filter(function (r) { return String(r.id) === mp.me; })[0] : null;
    if (mine && mine.status === 'invalid') parts.push('Your race was not counted (' + (mine.reasons.join(', ') || 'implausible') + ').');
    if (mp.recorded && mp.recorded.chat) parts.push('Points and coins are added like in every chat race. Next race: type !race in chat.');
    else if (mp.recorded && mp.recorded.race_id === mp.raceId) {
      if (mp.recorded.counted) {
        var p = mp.recorded.points ? mp.recorded.points[mp.me] : null;
        parts.push('Points and coins saved' + (p != null ? ' – you got ' + p + ' point' + (p === 1 ? '' : 's') : '') + '.');
      } else parts.push('This race does not count for points (it needs at least two valid drivers).');
    } else if (mp.results) parts.push('Saving the results…');
    ui.finishNote.textContent = parts.join(' ');
  }
  $('hostBtn').addEventListener('click', function () {
    var s = settings();
    if (!byKey[s.car]) { ui.status.textContent = 'Pick a car first.'; ui.list.focus(); return; }
    if (!Net) { ui.status.textContent = 'Network script failed to load – reload the page.'; return; }
    save('menu', s); pref = s;
    ui.status.textContent = 'Opening a room…';
    api('open', '&host=1&track=' + s.track + '&laps=' + s.laps, { limits: driveLimits() }).then(function (r) {
      if (!r || !r.ok || !r.ticket) { ui.status.textContent = (r && (r.say || r.error)) || 'Could not open a room.'; return; }
      ui.status.textContent = '';
      mpStart({ code: r.code, url: r.url, ticket: r.ticket, role: 'host', me: r.me.id, room: r.room, car: s.car, paint: s.paint, light: false, duck: s.duck });
    }).catch(function () { ui.status.textContent = 'Could not open a room.'; });
  });
  $('mpStartBtn').addEventListener('click', function () {
    setLobbyStatus('Starting…');
    api('start').then(function (r) { setLobbyStatus(r.ok ? 'Race starts in a few seconds…' : (r.say || r.error || 'Could not start the race.')); })
      .catch(function () { setLobbyStatus('Could not start the race.'); });
  });
  $('mpCloseBtn').addEventListener('click', function () { api('close').catch(function () { /* Raum verfällt ohnehin */ }); mpLeave('Room closed.'); });
  $('mpLeaveBtn').addEventListener('click', function () { if (mp) mp.net.send({ t: 'leave' }); mpLeave(''); });
  $('copyBtn').addEventListener('click', function () {
    var inp = $('lobbyUrl');
    function done() { setLobbyStatus('Link copied.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done, function () { inp.select(); });
    else { inp.select(); try { doc.execCommand('copy'); done(); } catch (e) { /* markiert */ } }
  });

  // Zuschauer (/drive/<code>): Anmeldung, Garage + Zufallsauto, Grafikstufe
  function viewerInit() {
    if (!CFG.room) {
      ui.status.textContent = 'This room is closed or does not exist – ask the streamer for a new link.';
      $('startBtn').disabled = true; return;
    }
    if (!CFG.user) { $('signinBtn').href = CFG.login; showPanel('signin'); return; }
    var who = $('whoami'), out = doc.createElement('a');
    who.textContent = 'Signed in as ' + CFG.user.name + ' · ';
    out.href = CFG.logout; out.textContent = 'Sign out'; who.appendChild(out);
    $('startText').textContent = 'Join race';
    ui.status.textContent = 'Loading your garage…';
    fetch(CFG.ticket, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.signin) { $('signinBtn').href = CFG.login; showPanel('signin'); return; }
      if (!j.ok) { ui.status.textContent = j.error || 'This room is not available.'; $('startBtn').disabled = true; return; }
      viewerCars = { garage: j.garage || [], rnd: j.rnd, ticket: j.ticket, room: j.room, me: j.me, all: !!j.all, prices: j.prices || {} };
      var T = Sim.track(Sim.TRACKS[j.room.track | 0] || 1);
      ui.status.textContent = T.name + ' · ' + j.room.laps + ' lap' + (j.room.laps === 1 ? '' : 's') + ' · ' + j.room.drivers + '/' + j.room.max + ' drivers' +
        (viewerCars.all ? ' – streamer: all cars unlocked.' : viewerCars.garage.length ? '' :
          ' – no cars in your garage yet, you get a random one (buy cars in the chat with !buy).');
      fillList();
    }).catch(function () { ui.status.textContent = 'Could not reach the server.'; });
  }
  // Neues Auto gekauft (Server-Nachricht garage): Ticket neu holen, damit ein erneuter Beitritt das Auto annimmt
  function garageChanged(keys) {
    if (!VIEWER || !viewerCars || !Array.isArray(keys)) return;
    var fresh = keys.filter(function (k) { return viewerCars.garage.indexOf(k) < 0 && byKey[k]; });
    fetch(CFG.ticket, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok || !j.ticket) return;
      viewerCars.garage = j.garage || []; viewerCars.ticket = j.ticket; viewerCars.rnd = j.rnd;
      viewerCars.all = !!j.all; viewerCars.prices = j.prices || viewerCars.prices;
      fillList();
      if (!fresh.length) return;
      var txt = 'New in your garage: ' + fresh.map(function (k) { return displayName(byKey[k]); }).join(', ');
      if (mp && mp.phase === 'lobby') setLobbyStatus(txt + ' – leave the grid and join again to drive it.');
      else if (!mp) ui.status.textContent = txt + '.';
    }).catch(function () { /* nächstes Neuladen holt die Garage */ });
  }
  function viewerJoin(s) {
    if (!viewerCars || !viewerCars.ticket) return;
    if (!Net) { ui.status.textContent = 'Network script failed to load – reload the page.'; return; }
    renderScale = 1; resize();   // immer volle Grafik (Light = Rennmodelle, zu grob)
    mpStart({ code: CFG.code, ticket: viewerCars.ticket, role: 'viewer', me: viewerCars.me.id, room: viewerCars.room,
      car: s.car, paint: s.paint, light: false, duck: true });
  }

  // ---- Chatrennen steuerbar (/drive/race/<kanal>) ----
  // Rennen = das Chatrennen (Zustand von Flask, CFG.state, alle 1,5 s); Fahrer-Ticket nur für angemeldete Teilnehmer.
  var rc = { st: null, raceId: null, ticket: null, busy: false, evKey: '' };
  var SUB_PAINTS = { gold: { c: 0xd4a017, f: 'shiny' }, purple: { c: 0x5e2a79, f: 'gloss' }, carbon: { c: 0x2b2b30, f: 'carbonGloss' } };
  function rcInit() {
    app.dataset.mode = 'race';
    if (!CFG.user) { $('signinText').textContent = 'Sign in with Twitch to steer your own car in the chat race. Only your Twitch name and ID are used.'; $('signinBtn').href = CFG.login; showPanel('signin'); return; }
    var who = $('whoamiRace'), out = doc.createElement('a');
    who.textContent = 'Signed in as ' + CFG.user.name + ' · ';
    out.href = CFG.logout; out.textContent = 'Sign out'; who.appendChild(out);
    $('lobbyTitle').textContent = 'Chat race';
    showLobby();
    rcPoll();
  }
  function rcPoll() {
    fetch(CFG.state, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(rcState).catch(function () { setLobbyStatus('Could not reach the server – retrying…'); })
      .then(function () { setTimeout(rcPoll, race && race.chat && race.phase !== 'results' ? 1000 : 1500); });
  }
  // erwarteter Rennstart: im Countdown liegt starts_at noch vor der Fahrervorstellung (Server liefert go_at)
  function rcGo(st) { return st.go_at != null ? st.go_at : st.starts_at; }
  function rcRacer(st, id) { return (st.racers || []).filter(function (r) { return String(r.user_id) === String(id); })[0] || null; }
  function rcState(st) {
    rc.st = st;
    var me = st.me || {}, ph = st.phase, live = ph === 'lobby' || ph === 'countdown' || ph === 'intro' || ph === 'race';
    if (st.race_id !== rc.raceId) {           // neues Rennen (oder keins): alles von vorn
      rc.raceId = st.race_id; rc.ticket = null; rc.evKey = '';
      if (race && race.chat) { teardown(); showPanel('lobby'); }   // abgebrochen/vorbei: zurück zur Warte-Tafel statt leerer Szene
      if (mp) mpStop();
    }
    if (!(race && race.chat)) rcLobby(st);
    if (!me.in_race || !live || rc.left === st.race_id) return;
    if (!mp && !rc.busy) rcConnect();
    if (mp && !(race && race.chat) && !rc.busy && ph !== 'lobby' && rc.st.seed != null) rcBegin();
    if (race && race.chat) rcUpdate(st);
  }
  // Warte-Tafel: wer fährt, was zu tun ist
  function rcLobby(st) {
    var me = st.me || {}, ph = st.phase;
    mp = mp || null;
    ui.roster.textContent = '';
    $('lobbyCount').textContent = (st.racers || []).length + '/10';
    (st.racers || []).forEach(function (r) {
      var li = doc.createElement('li'); if (String(r.user_id) === String(me.id)) li.className = 'me';
      var nm = doc.createElement('span'); nm.textContent = r.display;
      if (String(r.user_id) === String(me.id)) { var tg = doc.createElement('span'); tg.className = 'tag'; tg.textContent = 'You'; nm.appendChild(tg); }
      var car = doc.createElement('span'); car.className = 'car'; car.textContent = byKey[r.car_key] ? displayName(byKey[r.car_key]) : r.car_key || '–';
      li.appendChild(nm); li.appendChild(car); ui.roster.appendChild(li);
    });
    if (!(st.racers || []).length) { var e0 = doc.createElement('li'); e0.className = 'roster-empty'; e0.textContent = 'No race open right now.'; ui.roster.appendChild(e0); }
    var res = st.result && me.id ? st.result.filter(function (x) { return String(x.user_id) === String(me.id); })[0] : null;
    if (ph === 'podium' || ph === 'cooldown') setLobbyStatus((res ? (res.place ? 'You finished P' + res.place + '. ' : 'You did not finish. ') : '') + 'Next race: type !race in chat.');
    else if (!me.in_race) setLobbyStatus(ph === 'intro' || ph === 'race' ? 'A race is running – type !race in chat to join the next one.' : 'Type !race in chat to join – your car shows up here.');
    else if (ph === 'lobby') setLobbyStatus('You are in! The race starts once 3 drivers have joined. Keep this page open.');
    else setLobbyStatus('Loading your car…');
  }
  function rcConnect() {
    rc.busy = true;
    fetch(CFG.ticket, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      rc.busy = false;
      if (!j.ok) { setLobbyStatus(j.error || 'Could not join.'); return; }
      renderScale = 1; resize();
      mp = { code: 'race', role: 'driver', me: String(j.me.id), room: {}, roster: [], light: false, duck: true, phase: '', raceId: j.race_id,
        startAt: null, grid: [], fin: {}, results: null, recorded: null, loaded: {}, loading: {}, info: null };
      var m = mp;
      mp.net = Net.connect({ url: wsUrl('race'), ticket: j.ticket, onMessage: function (msg) { if (mp === m) rcMsg(msg); },
        onState: function (on) { if (!on && mp === m && race && race.chat) flash('Connection lost – reconnecting…', 2); } });
      (rc.st.racers || []).forEach(function (r) { mpLoad(r.car_key); });
    }).catch(function () { rc.busy = false; });
  }
  function rcMsg(m) {
    if (m.t === 'welcome' || m.t === 'race') { mp.info = m.race; if (race && race.chat) (m.race.taken || []).forEach(rcTakeover); }
    else if (m.t === 'takeover' || m.t === 'release') rcTakeover(m.ev);
    else if (m.t === 'bump') peerBump(m);
    else if (m.t === 'hit') rcHitMsg(m.ev);
    else if (m.t === 'ai_denied') rcDenied(m.want);
    else if (m.t === 'rec') recMsg(m);
    else if (m.t === 'lap') {
      if (m.fin != null) mp.fin[String(m.id)] = m.fin;
      if (String(m.id) === mp.me && !m.ok && race && race.chat) flash('Lap not counted', 2.5);
    } else if (m.t === 'error') setLobbyStatus(m.msg);
    else if (m.t === 'gone') { mpStop(); setLobbyStatus(m.code === 4401 ? 'Sign-in expired – reload the page.' : 'Connection lost – reload the page.'); }
  }
  function rcPilots(st) { return Array.isArray(st.pilots) ? st.pilots.map(String) : null; }
  function rcSimCars(st) {
    var pil = rcPilots(st) || [];
    return (st.racers || []).slice().sort(function (a, b) { return a.grid - b.grid; }).map(function (r) {
      var e = byKey[r.car_key], raw = Stats.of(r.car_key || '', e || undefined);
      return { id: String(r.user_id), stats: Sim.stats(raw), ghost: pil.indexOf(String(r.user_id)) >= 0, src: r };
    });
  }
  function rcBuildSim(st) {
    var cars = rcSimCars(st), T = race.T;
    race.simCars = cars;
    race.sim = Sim.create({ seed: st.seed | 0, track: T, laps: st.laps || 2, finishWindow: st.finish_window || 25, cars: cars, events: rcEvents(st) });
    race.pilotsKey = (rcPilots(st) || ['-']).join('|');
    race.follow = {};
    var t = mp.net.serverNow() - rcGo(st);
    if (t > 0) race.sim.fastForward(Math.min(t, 120));
    snap();
  }
  function rcSet(r) {
    var sub = SUB_PAINTS[typeof r.paint === 'string' ? r.paint : r.sub_paint] || null;
    var set = r.car_key ? TC.paintAt(r.car_key, typeof r.paint === 'number' ? r.paint : 0) : { c: null };
    return sub ? Object.assign({}, set, { c: sub.c, sub: sub }) : set;
  }
  // Szene: Strecke, eigenes Auto am Startplatz (Sim-Aufstellung), KI-Autos, andere Piloten
  function rcBegin() {
    var st = rc.st, meId = mp.me;
    rc.busy = true;
    var keys = (st.racers || []).map(function (r) { return r.car_key; }).filter(Boolean);
    var wait = Math.max(0.3, (rcGo(st) || 0) - mp.net.serverNow() - 2);
    Promise.race([Promise.all(keys.map(mpLoad)), new Promise(function (res) { setTimeout(res, wait * 1000); })]).then(function () {
      rc.busy = false;
      if (rc.st.race_id !== st.race_id || !mp || (race && race.chat)) return;
      teardown();
      st = rc.st;
      var tIdx = ((st.track | 0) % Sim.TRACKS.length + Sim.TRACKS.length) % Sim.TRACKS.length, T = Sim.track(Sim.TRACKS[tIdx]);
      buildTrack(T);
      race = { s: { car: null, paint: 0, track: tIdx, laps: st.laps || 2 }, T: T, seed: T.seed, sim: null, ai: [], remotes: [],
        mp: true, chat: true, raceId: st.race_id, me: null, pc: null, laps: st.laps || 2, phase: 'countdown', paused: false,
        t: 0, cd: rcGo(st) - mp.net.serverNow(), lapStart: 0, lastLap: null, bestLap: null, stored: null,
        prev: null, finishT: null, doneT: 0, camMode: 'chase', camPos: null, camLook: null, tvIdx: -1, shake: 0,
        lapsShown: -1, posShown: '', opp: [], newBest: false, follow: {}, taken: {}, aiLast: {}, nitroSeen: {} };
      mp.startAt = rcGo(st); mp.raceId = st.race_id;
      rcCars(st);
      ui.hud.hidden = false; showPanel(null);
      setCam('chase', true);
      ui.countdown.hidden = false; ui.countdown.textContent = '';
      say('Race starts soon');
      canvas.setAttribute('tabindex', '-1');
      try { canvas.focus({ preventScroll: true }); } catch (e) { /* */ }
    });
  }
  // Startaufstellung aus dem Rennzustand bauen (beim Start der Szene und neu, wenn sich im Countdown Fahrer, Autos oder
  // Lacke ändern): Sim neu, KI-Autos (Index wie in der Sim), andere Fahrer, eigenes Auto auf seinem Startplatz.
  // Kamera, Umschauen und Countdown bleiben; fehlende Modelle werden nachgeladen und dann einmal neu aufgebaut.
  function rcRosterKey(st) {
    return (st.racers || []).slice().sort(function (a, b) { return a.grid - b.grid; })
      .map(function (r) { return [r.user_id, r.car_key, r.paint, r.sub_paint, r.grid].join(':'); }).join('|');
  }
  function rcCars(st) {
    var meId = mp.me, RD = root.RubberDuck, outfits = RD && RD.OUTFITS ? RD.OUTFITS : [], T = race.T, missing = {};
    race.ai.forEach(function (c) { if (c) { disposeCar(c); if (FX) FX.forget(c.id); } });
    if (race.me) disposeCar(race.me);
    race.ai = []; race.remotes = []; race.myIdx = null;
    rcBuildSim(st);
    var mine = rcRacer(st, meId), mineSrc = mine || { car_key: null, paint: 0 };
    if (mineSrc.car_key && !mp.loaded[mineSrc.car_key]) missing[mineSrc.car_key] = 1;
    race.me = makeCar(mineSrc.car_key, rcSet(mineSrc), { loaded: !!mp.loaded[mineSrc.car_key], duck: true, outfit: null });
    if (race.s.car !== mineSrc.car_key) {
      race.s.car = mineSrc.car_key;
      race.stored = load('best2.' + mineSrc.car_key + '.' + T.seed, null);
      recLoad(race, race.s.track);
    }
    race.simCars.forEach(function (sc, i) {
      if (sc.id === meId) { race.ai.push(null); race.myIdx = i; return; }
      if (sc.src.car_key && !mp.loaded[sc.src.car_key]) missing[sc.src.car_key] = 1;
      var c = makeCar(sc.src.car_key, rcSet(sc.src), { loaded: !!mp.loaded[sc.src.car_key], duck: true, outfit: outfits.length ? outfits[i % outfits.length] : null });
      c.id = sc.id; c.label = sc.src.display; c.idx = i; c.prog = race.sim.cars[i].s; c.smp = null;
      race.ai.push(c);
    });
    var g0 = race.sim.cars[race.myIdx || 0];
    race.pc = Phys.create(T, Phys.params(race.me.st, race.me.raw), { s: g0.s, d: g0.d });
    placeCar(race.me, race.pc.x, race.pc.z, race.pc.yaw, 0, 0, 0, 0);
    race.ai.forEach(function (c, i) { if (c) { var q = race.sim.cars[i]; placeCar(c, q.x, q.z, q.yaw, 0, 0, 0, 0); } });
    race.rosterKey = rcRosterKey(st);
    rcRoles(st);
    var keys = Object.keys(missing), r = race;
    if (keys.length) Promise.all(keys.map(mpLoad)).then(function () {
      if (race === r && r.phase === 'countdown' && mp && keys.some(function (k) { return mp.loaded[k]; })) r.rosterKey = '';
    });
  }
  // Rollen nach dem Einfrieren: Piloten (live/Nachfahrer) als „remotes“, KI in race.ai; selbst: fahren oder zuschauen
  function rcRoles(st) {
    var pil = rcPilots(st);
    race.remotes = [];
    race.ai.forEach(function (c) { if (c && pil && pil.indexOf(c.id) >= 0) race.remotes.push(c); });
    race.spect = !!(pil && pil.indexOf(mp.me) < 0) || !!race.taken[mp.me];
    if (pil && pil.indexOf(mp.me) < 0 && !race.spectSaid) { race.spectSaid = true; flash('You were not connected when the grid closed – the AI drives your car', 4); }
  }
  // KI übernimmt (takeover: Verbindung weg oder „Let AI drive“) bzw. Pilot übernimmt wieder (release). Je Fahrer gilt
  // das jüngste Ereignis nach t; eigene Wünsche wirken sofort (local) und werden vom Server-Ereignis ersetzt.
  function rcTakeover(ev) {
    if (!race || !race.chat || !ev || ev.id == null || (ev.type !== 'takeover' && ev.type !== 'release')) return;
    var id = String(ev.id), cur = race.aiLast[id];
    if (cur && !(+ev.t > +cur.t) && !(cur.local && !ev.local && cur.type === ev.type)) return;
    var was = !!race.taken[id];
    race.aiLast[id] = ev;
    if (ev.type === 'takeover') race.taken[id] = ev; else delete race.taken[id];
    delete race.follow[id];
    if (id !== mp.me) return;
    race.spect = !!race.taken[id] || !rcIsPilot();
    if (ev.type === 'takeover') race.lapAi = true;
    if (ev.type === 'takeover' && !was && !ev.local && ev.by !== 'user') flash('Connection lost – the AI took over your car. Press P to take the wheel', 4);
    aiBtnSync();
  }
  function rcIsPilot() { var pil = rc.st ? rcPilots(rc.st) : null; return !!(pil && mp && pil.indexOf(mp.me) >= 0); }
  // Taste P / Menü: KI fahren lassen bzw. wieder selbst steuern
  function rcToggleAi() {
    if (!race || !race.chat || !mp || !mp.net || race.phase !== 'race' || !race.pc) return;
    var me = mp.me, pc = race.pc, t = mp.net.serverNow() - mp.startAt;
    if (!rcIsPilot()) { flash('You are not steering in this race', 2); return; }
    if (race.taken[me]) {
      var f = rcFollower(me, race.myIdx), q = f && f.at(t);
      if (!q || q.finish != null) { flash('The AI already finished the race for you', 2); return; }
      // sanfte Übergabe: Fahrphysik übernimmt Lage und Tempo des Nachfahrers (alle anderen rechnen denselben)
      pc.x = q.x; pc.z = q.z; pc.yaw = q.yaw; pc.u = q.v; pc.vx = Math.cos(q.yaw) * q.v; pc.vz = -Math.sin(q.yaw) * q.v;
      pc.r = 0; pc.w = 0; pc.steer = q.steer; pc.spin = q.spin; pc.prog = q.s; pc.hint = -1;
      pc.laps = Math.max(pc.laps, q.s > 0 ? Math.floor(q.s / race.T.len) : 0);
      steerKb = thrKb = brkKb = 0;
      mp.net.send({ t: 'release', x: q.x, z: q.z, yaw: q.yaw, speed: q.v, prog: q.s, rt: t });
      rcTakeover({ t: t, type: 'release', id: me, local: true });
      race.lapStart = race.t; race.lapAi = true;
      flash('You have the wheel', 1.5); say('You have the wheel');
    } else {
      // letzter Zustand sofort, dann übernimmt die KI ab hier (mit echtem Tempo)
      mp.net.sendState({ x: pc.x, z: pc.z, yaw: pc.yaw, roll: pc.roll, pitch: pc.pitch, steer: pc.steer,
        speed: Math.hypot(pc.vx, pc.vz), prog: pc.prog, t: race.t, spin: pc.spin }, true);
      mp.net.send({ t: 'ai' });
      rcTakeover({ t: race.t, type: 'takeover', id: me, by: 'user', local: true, x: pc.x, z: pc.z, yaw: pc.yaw,
        speed: Math.max(0, pc.u), prog: pc.prog, lap: pc.laps });
      flash('The AI is driving', 1.5); say('The AI is driving your car');
    }
  }
  // Server lehnt ab (z. B. Rennen vorbei, Lage unplausibel): Zustand zurück auf das, was der Server hat
  function rcDenied(want) {
    if (!race || !race.chat || !mp) return;
    var me = mp.me, cur = race.aiLast[me], prev = null;
    if (!cur || !cur.local) return;
    // jüngstes Ereignis, das der Server kennt
    [].concat(mp.info && mp.info.taken || [], rc.st && rc.st.race_events || []).forEach(function (e) {
      if (e && String(e.id) === me && (e.type === 'takeover' || e.type === 'release') && (!prev || +e.t >= +prev.t)) prev = e;
    });
    if (prev) race.aiLast[me] = prev; else delete race.aiLast[me];
    if (prev && prev.type === 'takeover') race.taken[me] = prev; else delete race.taken[me];
    delete race.follow[me];
    race.spect = !!race.taken[me] || !rcIsPilot();
    flash(want === 'release' ? 'Could not take the wheel right now' : 'The AI cannot take over right now', 2.5);
    aiBtnSync();
  }
  function aiBtnSync() {
    var b = $('aiBtn'), on = aiDrivesMe();
    b.hidden = !(race && race.phase === 'race' && (race.chat ? rcIsPilot() : on));
    $('aiText').textContent = on ? 'Take the wheel' : 'Let AI drive';
    $('aiIcon').textContent = on ? 'sports_esports' : 'smart_toy';
  }
  function aiHud() {
    var on = !!(race && race.phase === 'race' && aiDrivesMe() && (!race.chat || rcIsPilot())), el = $('hAi');
    if (el.hidden === on) el.hidden = !on;
  }
  function rcFollower(id, i) {
    var ev = race.taken[id]; if (!ev) return null;
    if (!race.follow[id]) {
      var g0 = race.sim.cars[i], snap0 = ev.grid || ev.prog == null ? { t: ev.t, s: g0.s, d: g0.d, speed: 0 } : ev;
      race.follow[id] = Sim.follower(race.T, race.simCars[i].stats, snap0, { laps: race.laps });
    }
    return race.follow[id];
  }
  function rcUpdate(st) {
    if (st.race_id !== race.raceId) return;
    // Startzeit verschoben (Vorstellung begonnen, „Start now“, neue Fahrer im Countdown): Uhr + Sim nachziehen
    if (rcGo(st) != null && rcGo(st) !== mp.startAt && race.phase === 'countdown') { mp.startAt = rcGo(st); race.cd = mp.startAt - mp.net.serverNow(); rcBuildSim(st); }
    // neue/abgemeldete Fahrer, Auto- oder Lacktausch im Countdown: Startaufstellung neu bauen
    if (race.phase === 'countdown' && rcRosterKey(st) !== race.rosterKey) rcCars(st);
    if ((rcPilots(st) || ['-']).join('|') !== race.pilotsKey) { rcBuildSim(st); rcRoles(st); }
    (st.race_events || []).forEach(function (e) {
      if (e.type === 'takeover' || e.type === 'release') rcTakeover(e);
      // Nitro aus dem Chat für mich: wirkt hier (einmal je Ereignis)
      if (e.type === 'nitro' && String(e.id) === mp.me && !race.nitroSeen[e.t] && !race.spect) {
        race.nitroSeen[e.t] = 1; race.pc.nitroT = Phys.NITRO_T; flash('Nitro from the chat!', 2);
      }
    });
    var evl = rcEvents(st), key = JSON.stringify(evl);
    if (key !== rc.evKey) { rc.evKey = key; if (race.sim.setEvents(evl)) rcBuildSim(st); }
    if ((st.phase === 'podium' || st.phase === 'cooldown') && Array.isArray(st.result) && !mp.results) {
      mp.results = { race_id: st.race_id, list: st.result.map(function (x) {
        return { id: String(x.user_id), name: x.display, place: x.place, time: null, status: x.place ? 'finished' : x.invalid ? 'invalid' : 'dnf', reasons: [] };
      }) };
      mp.recorded = { race_id: st.race_id, counted: true, points: null, chat: true };
      if (race.phase === 'race' || race.phase === 'done' || race.phase === 'countdown') showResults();
    }
  }
  // je Bild: andere Piloten live bzw. als Nachfahrer, eigenes Auto beim Zuschauen aus Sim/Nachfahrer
  function rcDraw() {
    if (!race || !race.chat || !race.sim) return;
    var at = mp.net.serverNow() - mp.net.delay(), t = mp.net.serverNow() - mp.startAt;
    race.remotes.forEach(function (c) {
      var f = rcFollower(c.id, c.idx), q;
      if (f) { var fq = f.at(t); q = { x: fq.x, z: fq.z, yaw: fq.yaw, roll: fq.roll, pitch: 0, steer: fq.steer, spin: fq.spin, speed: fq.v, prog: fq.s }; c.finQ = fq.finish; }
      else q = netPose(c, at);
      c.smp = q; c.isAi = !!f;
      if (!q) { var g = race.sim.cars[c.idx]; placeCar(c, g.x, g.z, g.yaw, 0, 0, 0, 0); return; }
      c.prog = q.prog;
      placeCar(c, q.x, q.z, q.yaw, q.roll, q.pitch, q.steer, q.spin);
    });
    if (race.spect) {
      var pc = race.pc, f2 = rcFollower(mp.me, race.myIdx), q2 = f2 ? f2.at(t) : race.sim.cars[race.myIdx];
      if (q2 && !q2.ghost) { pc.x = q2.x; pc.z = q2.z; pc.yaw = q2.yaw; pc.prog = q2.s; if (q2.s > 0) pc.laps = Math.max(pc.laps, Math.min(race.laps, Math.floor(q2.s / race.T.len))); pc.vx = Math.cos(q2.yaw) * q2.v; pc.vz = -Math.sin(q2.yaw) * q2.v; pc.u = q2.v; pc.steer = q2.steer; pc.spin = q2.spin; }
    }
  }
  // ---- Schleife ----
  var lastT = performance.now();
  function frame(now) {
    root.requestAnimationFrame(frame);
    // Hänger im Mehrspieler sichtbar machen (3 s ohne Zustand = KI übernimmt): Bildlücke über 0,5 s in die Konsole
    if (race && race.mp && !doc.hidden && lastT && now - lastT > 500) console.warn('[car-drive] frame gap ' + Math.round(now - lastT) + ' ms at race time ' + (race.t || 0).toFixed(1) + ' s');
    var dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    var p = readPad();
    sm.padThr = p ? p.throttle || 0 : 0;
    if (p && p.back && race) cycleMap();
    if (p && p.start && race && (race.phase === 'race' || race.phase === 'countdown' || race.phase === 'done')) setPaused(!menuOpen());
    else if (p) padMenu(p);
    if (!race || !trackRes) { idleCam(dt); soundFrame(null); renderer.render(scene, cam); return; }
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('hMsg').classList.remove('show', 'big'); }
    if (race.paused || race.phase === 'results') {
      if (race.phase === 'results' && !race.paused) stepWorld(dt, cruise(race.pc));
      lookPhase(); fxFrame(dt, null); trackRes.update(race.paused ? 0 : dt); grassFrame(race.paused ? 0 : dt); mapFrame(now);
      renderer.render(scene, cam); return;
    }
    var pc = race.pc;
    if (pressed.KeyC || (p && p.cam)) setCam(CAM_ORDER[(CAM_ORDER.indexOf(race.camMode) + 1) % CAM_ORDER.length], true);
    if (race.phase === 'countdown') {
      var before = Math.ceil(race.cd);
      race.cd = race.mp ? mp.startAt - mp.net.serverNow() : race.cd - dt;
      var after = Math.ceil(race.cd);
      // Begrüßung vor dem Countdown: „WELCOME TO <Strecke>“, dann „START YOUR ENGINES“ (das Feld gibt Gas); in der
      // Zeit keine Zahlen, danach 3-2-1-GO
      var wk = root.CarRaceWelcome ? CarRaceWelcome.windowsBefore(race.cd) : null;
      if (welcomeUi) welcomeUi.set(wk, race.T.name);
      if (wk !== race.wkShown) {
        race.wkShown = wk;
        if (wk) { var wt = CarRaceWelcome.text(wk, race.T.name); say(wt.kicker + ' ' + wt.title); }
        if (wk === 'engines') fieldRev();
      }
      var shown = race.cd > 6.4 ? String(after) : after > 3 ? '' : after > 0 ? String(after) : 'GO';
      if (shown !== ui.countdown.textContent) {
        ui.countdown.textContent = shown;
        if (shown) {
          ui.countdown.classList.remove('tick'); void ui.countdown.offsetWidth; ui.countdown.classList.add('tick');
          if (!wk) say(after > 0 ? String(after) : 'Go');
          if (after > 0 && after <= 3 && after !== before) sfx('beep');
        }
      }
      if (p && (p.lookX || p.lookY) && lookAllowed()) lookOrbit(p.lookX * dt * 420, p.lookY * dt * 320);
      if (race.cd <= 0 && (!race.chat || rc.st.phase === 'intro' || rc.st.phase === 'race')) {
        race.phase = 'race'; race.t = race.mp ? Math.max(0, -race.cd) : 0; race.lapStart = 0;
        sfx('go');
        if (welcomeUi) welcomeUi.set(null);
        // Umschauen bleibt beim Start erhalten und pendelt nach der Ruhezeit von selbst zurück
        setTimeout(function () { ui.countdown.hidden = true; ui.countdown.textContent = ''; }, 700);
      }
      placeCar(race.me, pc.x, pc.z, pc.yaw, pc.roll, pc.pitch, pc.steer, pc.spin);
      drawAI();
      if (race.chat) { rcDraw(); placeCar(race.me, pc.x, pc.z, pc.yaw, pc.roll, pc.pitch, pc.steer, pc.spin); mpSend(); }
      else if (race.mp) { drawRemotes(); mpSend(); }
    } else {
      var inp = race.spect ? null : race.phase === 'done' ? cruise(pc) : playerInput(dt, p);
      if (p && (p.lookX || p.lookY) && lookAllowed()) lookOrbit(p.lookX * dt * 420, p.lookY * dt * 320);
      if (race.phase === 'race' && pressed.KeyR) { Phys.reset(pc); flash('Back on track', 1); }
      stepWorld(dt, inp);
    }
    pressed = {};
    mpSendAi();
    updateHud(standings());
    netHud();
    updateCam(dt);
    lookPhase();
    fxFrame(dt, race.phase === 'countdown' ? null : inp);
    trackRes.update(dt);   // Fahnen, Wellen, Leuchtturm (reduzierte Bewegung: steht)
    grassFrame(dt);
    mapFrame(now);
    aiHud();
    renderer.render(scene, cam);
  }
  function stepWorld(dt, inp) {
    var pc = race.pc;
    race.t += dt;
    if (race.mp && race.phase !== 'results') {
      // Rennzeit an der Server-Uhr halten (die Plausibilitätsprüfung vergleicht beide)
      var srvT = mp.net.serverNow() - mp.startAt;
      if (Math.abs(srvT - race.t) > 0.15) race.t = srvT;
    }
    if (race.sim && !race.chat && !race.mp) simObstacles();
    if (race.sim) { while (race.sim.time + Sim.DT <= race.t + 1e-9) { snap(); race.sim.step(); } }
    var lapsPre = pc.laps;
    if (race.chat) rcDraw();   // fährt die KI mein Auto, setzt rcDraw Lage/Runden aus dem Nachfahrer
    else if (race.mp && !inp) drawRemotes();   // Raum: dasselbe über den Nachfahrer der Übernahme
    var aiMine = !!(race.chat && mp && race.taken[mp.me] && rcIsPilot()) || !!(race.mp && !race.chat && mpTaken(mp.me));
    if (!inp && aiMine && race.phase === 'race' && pc.laps > lapsPre) {
      // Runden/Ziel auch, solange die KI fährt (sonst hängt Car Drive hinter dem Overlay; zählt nicht als Rekord)
      lapDone(race.t - race.lapStart); race.lapStart = race.t;
      if (pc.laps >= race.laps) {
        race.finishT = race.t; race.phase = 'done'; race.doneT = 0;
        var posA = 1; standings().forEach(function (x, i) { if (x.me) posA = i + 1; });
        flash('The AI finished your race – P' + posA, 3); say('Finished in position ' + posA);
      } else say('Lap ' + (pc.laps + 1) + ' of ' + race.laps);
    }
    if (inp) {
      var lapsBefore = pc.laps;
      if (race.mp && !race.chat) drawRemotes();
      driveStep(dt, inp);
      if (pc.rail > 2) race.shake = Math.min(0.5, race.shake + pc.rail * 0.04);
      if (race.phase === 'race' && pc.laps > lapsBefore) {
        lapDone(race.t - race.lapStart); race.lapStart = race.t;
        if (pc.laps >= race.laps) {
          race.finishT = race.t; race.phase = 'done'; race.doneT = 0;
          var pos = 1; standings().forEach(function (x, i) { if (x.me) pos = i + 1; });
          flash('Finished – P' + pos, 3); say('Finished in position ' + pos);
        } else say('Lap ' + (pc.laps + 1) + ' of ' + race.laps);
      }
    }
    if (race.phase === 'done') {
      race.doneT += dt;
      if (race.mp) {
        // Ergebnis kommt vom Server (alle im Ziel oder Zielfenster abgelaufen); Rückfall, falls es ausbleibt
        if ((mp && mp.results && mp.results.race_id === mp.raceId) || race.doneT > 60) showResults();
      } else {
        var open = race.sim ? race.sim.cars.some(function (q) { return q.place == null && q.state !== 'dnf'; }) : false;
        if (!open || race.doneT > 12) showResults();
      }
    }
    placeCar(race.me, pc.x, pc.z, pc.yaw, pc.roll, pc.pitch, pc.steer, pc.spin);
    drawAI();
    if (race.mp) mpSend();
    if (race.phase === 'results') updateCam(dt);
  }
  // Bremsspuren/Qualm (eigenes Auto aus der Fahrphysik, andere aus ihren gezeichneten Lagen) + Klänge
  function fxFrame(dt, inp) {
    if (FX && race && race.pc && !race.paused) {
      var pc = race.pc;
      if (race.phase !== 'countdown') {
        FX.drive('me', { x: pc.x, z: pc.z, yaw: pc.yaw, len: race.me.len, w: race.me.w }, pc.slip,
          { speed: Math.hypot(pc.vx, pc.vz), surface: pc.surface, vx: pc.vx, vz: pc.vz, dt: dt });
        var seen = [];
        (race.ai || []).concat(race.remotes || []).forEach(function (c, i) {
          if (!c || !c.holder || seen.indexOf(c) >= 0) return;
          seen.push(c);
          var q = race.sim && c.idx == null && race.sim.cars[i] ? race.sim.cars[i] : null;
          c.fxSpeed = FX.watch(c.id || 'ai' + i, { x: c.holder.position.x, z: c.holder.position.z, yaw: c.holder.rotation.y, len: c.len, w: c.w },
            dt, q && q.off ? 'grass' : 'asphalt');
        });
      }
      FX.update(dt, canvas.clientWidth || root.innerWidth, canvas.clientHeight || root.innerHeight);
    }
    speedFrame(dt);
    soundFrame(inp);
  }
  // Menü: langsamer Kameraflug um den Ursprung (ohne Strecke nur Himmel)
  var idleA = 0;
  function idleCam(dt) { idleA += dt * 0.05; cam.position.set(Math.cos(idleA) * 120, 70, Math.sin(idleA) * 120); cam.lookAt(0, 0, 0); }
  root.requestAnimationFrame(frame);
  showPanel(RACE ? 'lobby' : 'menu');
  // Fehlersuche/Prüfskript: aktueller Rennzustand (nur lesen)
  root.CarDrive = { state: function () { return race; },
    debug: function () { return { sound: !!snd, soundOn: sndOn, volume: sndVol, look: { used: look.used, yaw: look.yaw, dist: look.dist }, fx: FX ? FX.count() : null, grass: grass ? grass.stats() : null }; }, grass: function () { return grass; } };
})(typeof window !== 'undefined' ? window : this);
