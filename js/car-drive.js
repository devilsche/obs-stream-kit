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
 * Effekte: Bremsspuren + Qualm (js/car-drive-fx.js), Klänge (js/car-race-sound.js, nach der ersten Eingabe, M = stumm).
 * Vor dem Start (Countdown): Kamera mit Maus/Touch/rechtem Stick um das eigene Auto drehen, Mausrad/Pinch zoomt.
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
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.localClippingEnabled = true;   // Enten-Fahrer an der Karosserie abschneiden
  var scene = new THREE.Scene();
  var SKY = 0x9cc3e6;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 180, 900);
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
    lobby: $('lobby'), signin: $('signin'), roster: $('roster'), lobbyStatus: $('lobbyStatus'), qual: $('qualSel'), qualRace: $('qualRace'),
    finishNote: $('finishNote')
  };
  var catalog = [], byKey = {};
  var pref = load('menu', {}) || {};

  Sim.TRACKS.forEach(function (seed, i) {
    var T = Sim.track(seed), o = doc.createElement('option');
    o.value = String(i); o.textContent = T.name + ' – ' + T.character + ', ' + Math.round(T.len) + ' m';
    ui.track.appendChild(o);
  });
  ui.track.value = String(clamp(pref.track | 0, 0, Sim.TRACKS.length - 1));
  ui.opp.value = String(pref.opp != null ? clamp(pref.opp | 0, 0, 7) : 5);
  ui.laps.value = String(pref.laps != null ? clamp(pref.laps | 0, 1, 5) : 3);
  if (pref.duck === false) ui.duck.checked = false;
  function syncOutputs() { ui.oppOut.textContent = ui.opp.value; ui.lapOut.textContent = ui.laps.value; }
  ui.opp.addEventListener('input', syncOutputs); ui.laps.addEventListener('input', syncOutputs); syncOutputs();

  function displayName(e) { return cleanName(TC.vehicle(e.key).name || e.name || e.key); }
  // Zuschauer: nur Autos aus der eigenen Garage plus ein Zufallsauto (vom Server ausgelost, Ticket)
  var viewerCars = null;
  function listPool() {
    if (!VIEWER) return catalog;
    if (!viewerCars) return [];
    var out = [], seen = {};
    if (viewerCars.rnd && byKey[viewerCars.rnd]) { out.push({ e: byKey[viewerCars.rnd], rnd: true }); seen[viewerCars.rnd] = 1; }
    (viewerCars.garage || []).forEach(function (k) { if (byKey[k] && !seen[k]) { out.push({ e: byKey[k] }); seen[k] = 1; } });
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
      ui.list.appendChild(o); shown++;
    });
    if (cur && byKey[cur] && ui.list.querySelector('option[value="' + CSS.escape(cur) + '"]')) ui.list.value = cur;
    else if (shown) ui.list.selectedIndex = 0;
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
        model.scale.setScalar(k); model.position.y = d.H / 2 * k + 0.03;
        car.height = d.H * k; car.w = d.W * k;
      } else model = null;
    }
    if (model) {
      holder.add(model);
      if (opts.duck) car.duck = addDuck(model, key, opts.outfit);
      car.wheels = collectWheels(holder, model, st.len, car.height);
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
  function placeCar(c, x, z, yaw, roll, pitch, steer, spin) {
    c.holder.position.set(x, 0, z);
    c.holder.rotation.set(roll, yaw, pitch);
    for (var i = 0; i < c.wheels.length; i++) {
      var w = c.wheels[i];
      if (w.spin) w.spin.rotation[w.spin.userData.ax || 'x'] = w.base - spin * w.sgn;
      if (w.front) w.pivot.rotation.y = steer;
    }
    if (c.duck && TC.updateDriverClip) TC.updateDriverClip(c.duck);
  }
  function disposeCar(c) {
    scene.remove(c.holder);
    c.owned.forEach(function (x) { if (x && x.dispose) x.dispose(); });   // Modell-Materialien gehören ToyCars (geteilt)
  }

  // ---- Klang (js/car-race-sound.js): startet nach der ersten Eingabe, M = stumm, Lautstärke in localStorage ----
  var snd = null, sndOn = load('sound', true) !== false, sndVol = clamp(+load('volume', 0.6) || 0, 0, 1);
  var sm = { me: null, field: null, nitro: 0, hitT: 0, lastSlip: 0 };
  function soundStart() {
    if (!snd && root.CarRaceSound) snd = root.CarRaceSound.create({ volume: sndOn ? sndVol : 0 });
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
  }
  // je Bild: eigener Motor (laut), Feld (leise, mittleres Tempo naher Autos), Quietschen, Rumpeln, Nitro
  function soundFrame(inp) {
    if (!snd) return;
    if (!race || race.paused || race.phase === 'results' || !sndOn) { snd.skid(0); snd.rumble(0); if (sm.me) sm.me.set(false); if (sm.field) sm.field.set(false); return; }
    var pc = race.pc, sp = Math.hypot(pc.vx, pc.vz);
    if (!sm.me) sm.me = snd.motor(1);
    if (!sm.field) sm.field = snd.motor(0.3);
    sm.me.set(true, Math.abs(pc.u), inp ? Math.max(inp.throttle || 0, pc.u < -0.5 ? inp.brake || 0 : 0) : 0.3);
    var n = 0, sum = 0;
    (race.remotes || []).concat(race.ai || []).forEach(function (c) {
      if (!c || !c.holder) return;
      var d = Math.hypot(c.holder.position.x - pc.x, c.holder.position.z - pc.z);
      if (d < 45 && c.fxSpeed != null) { n++; sum += c.fxSpeed * (1 - d / 45); }
    });
    sm.field.set(n > 0, n ? sum / n * 1.4 : 0, 0.5);
    var hard = pc.surface === 'asphalt' || pc.surface === 'curb';
    snd.skid(hard && sp > 3 && !race.spect ? clamp((pc.slip - 0.42) / 0.45, 0, 1) : 0);
    snd.rumble(!hard && sp > 1 ? clamp(sp / 12, 0.2, 1) : 0);
    if (pc.nitroT > 0 && sm.nitro <= 0) sfx('nitro');
    sm.nitro = pc.nitroT;
    if (pc.rail > 0) hitSound(pc.rail);
  }

  // ---- Eingabe ----
  var keys = {}, pressed = {};
  var GAME_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, ShiftLeft: 1, ShiftRight: 1, KeyR: 1, KeyC: 1 };
  doc.addEventListener('keydown', function (e) {
    if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) { setSound(!sndOn); return; }
    if (e.code === 'Escape' && race && (race.phase === 'race' || race.phase === 'countdown' || race.phase === 'done')) {
      e.preventDefault(); setPaused(!race.paused); return;
    }
    if (!race || race.paused || !(race.phase === 'race' || race.phase === 'countdown' || race.phase === 'done')) return;
    if (GAME_KEYS[e.code]) {
      e.preventDefault();
      if (!keys[e.code]) pressed[e.code] = true;
      keys[e.code] = true;
    }
  });
  doc.addEventListener('keyup', function (e) { keys[e.code] = false; });
  root.addEventListener('blur', function () { keys = {}; if (race && !race.mp && race.phase === 'race' && !race.paused) setPaused(true); });
  doc.addEventListener('visibilitychange', function () { if (doc.hidden && race && !race.mp && race.phase === 'race' && !race.paused) setPaused(true); });

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
    var r = { throttle: val(7), brake: val(6), steer: -ax, handbrake: cur[0], nitro: cur[1], cam: edge(3), start: edge(9),
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
  // ---- Umschauen vor dem Start: Maus/Touch ziehen dreht die Kamera um das eigene Auto, Mausrad/Pinch zoomt ----
  // look.yaw = Winkel um das Auto (0 = hinter dem Auto), look.pitch = Höhe, look.dist = Abstand; nur im Countdown.
  var look = { used: false, yaw: 0, pitch: 0.32, dist: 0, ptrs: {}, pinch: 0 };
  function lookAllowed() { return !!(race && race.phase === 'countdown' && !race.paused && race.pc); }
  function lookReset() { look.used = false; look.yaw = 0; look.pitch = 0.32; look.dist = 0; look.ptrs = {}; look.pinch = 0; }
  function lookBase() { return race ? race.me.len * 1.15 + 4.2 : 9; }
  function lookOrbit(dx, dy) {
    if (!look.used) { look.used = true; look.dist = lookBase(); }
    look.yaw = wrapAngle(look.yaw - dx * 0.0065);
    look.pitch = clamp(look.pitch + dy * 0.0045, 0.05, 1.25);
  }
  function lookZoom(f) {
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
    var on = lookAllowed();
    if ($('hLook').hidden === on) $('hLook').hidden = !on;
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
  var race = null, trackRes = null;
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

  function setupRace(s, opp, ok) {
    var seed = Sim.TRACKS[s.track] || 1, T = Sim.track(seed);
    trackRes = CarTrackScene.build(T, { primary: tokenColor('tk-primary', '#5e2a79'), accent: tokenColor('tk-accent', '#f2b705'), maxAniso: maxAniso });
    scene.add(trackRes.group);
    var RD = root.RubberDuck, outfits = RD && RD.OUTFITS ? RD.OUTFITS : [];
    // Gegner: Startplätze vorn (Sim-Aufstellung), Spieler dahinter
    var ai = opp.map(function (e) {
      return makeCar(e.key, TC.pickPaint(e.key), { loaded: ok[e.key], duck: s.duck, outfit: outfits.length ? outfits[Math.floor(Math.random() * outfits.length)] : null });
    });
    var me = makeCar(s.car, TC.paintAt(s.car, s.paint), { loaded: ok[s.car], duck: s.duck, outfit: null });
    var simSeed = (Math.random() * 1e9) | 0;
    var sim = ai.length ? Sim.create({ seed: simSeed, track: T, laps: s.laps, finishWindow: 1e6, maxTime: s.laps * 60 + 180,
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
      t: 0, cd: 3, lapStart: 0, lastLap: null, bestLap: null, stored: load('best.' + s.car + '.' + seed, null),
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
    say('Race starts in 3');
    canvas.setAttribute('tabindex', '-1');
    try { canvas.focus({ preventScroll: true }); } catch (e) { /* */ }
  }

  function teardown() {
    begin.token = null;
    if (race) {
      race.ai.forEach(function (c) { if (c) disposeCar(c); }); disposeCar(race.me);
      if (race.remotes) race.remotes.forEach(disposeCar);
      race = null;
    }
    if (trackRes) { trackRes.dispose(); trackRes = null; }
    ui.hud.hidden = true; ui.countdown.hidden = true;
    keys = {}; steerKb = thrKb = brkKb = 0;
    if (FX) FX.clear();
    soundStop(); lookReset();
  }

  function setPaused(on) {
    if (!race) return;
    race.paused = on;
    keys = {};
    $('restartBtn').hidden = !!race.mp;
    $('menuBtn').textContent = race.mp ? 'Back to lobby' : 'Back to menu';
    if (on) showPanel('pause'); else { showPanel(null); try { canvas.focus({ preventScroll: true }); } catch (e) { /* */ } }
  }
  $('resumeBtn').addEventListener('click', function () { setPaused(false); });
  $('restartBtn').addEventListener('click', function () { if (race) { var s = race.s, o = race.opp; begin(s, o); } });
  $('menuBtn').addEventListener('click', function () { var m = race && race.mp; teardown(); if (m && mp) showLobby(); else showPanel('menu'); });
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
  function drawAI() {
    if (!race.sim) return;
    var a = clamp((race.t - race.sim.time) / Sim.DT, 0, 1);   // eine Sim-Stufe zurück, weich dazwischen
    race.ai.forEach(function (c, i) {
      var q = race.sim.cars[i], p = race.prev[i] || q;
      if (!c || q.ghost) return;   // Chatrennen: Piloten zeichnet rcDraw
      placeCar(c, lerp(p.x, q.x, a), lerp(p.z, q.z, a), p.yaw + (q.yaw - p.yaw) * a, lerp(p.roll, q.roll, a), lerp(p.pitch, q.pitch, a),
        lerp(p.steer, q.steer, a), p.spin + wrapAngle(q.spin - p.spin) * a);
    });
  }

  // Kontakt Spieler ↔ Gegner: je Auto zwei Kreise (vorn/hinten), Stoß nach Masse
  function contacts() {
    var pc = race.pc, me = race.me, T = race.T;
    var fx = Math.cos(pc.yaw), fz = -Math.sin(pc.yaw), rM = me.w / 2, oM = Math.max(0, me.len / 2 - rM);
    var mine = [[pc.x + fx * oM, pc.z + fz * oM], [pc.x - fx * oM, pc.z - fz * oM]];
    race.ai.forEach(function (c, i) {
      var q = race.sim.cars[i];
      if (Math.abs(q.x - pc.x) > 12 || Math.abs(q.z - pc.z) > 12) return;
      var gx = Math.cos(q.yaw), gz = -Math.sin(q.yaw), rA = c.w / 2, oA = Math.max(0, c.len / 2 - rA);
      var theirs = [[q.x + gx * oA, q.z + gz * oA], [q.x - gx * oA, q.z - gz * oA]];
      var best = null;
      mine.forEach(function (m) { theirs.forEach(function (t) {
        var dx = m[0] - t[0], dz = m[1] - t[1], d = Math.hypot(dx, dz), pen = rM + rA - d;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen: pen, nx: d > 1e-4 ? dx / d : -fx, nz: d > 1e-4 ? dz / d : -fz };
      }); });
      if (!best) return;
      var mP = pc.P.mass, mA = c.st.mass, shareP = mA / (mP + mA);
      var wreck = q.state === 'dnf';
      if (wreck) shareP = 1;
      pc.x += best.nx * best.pen * shareP; pc.z += best.nz * best.pen * shareP;
      var vax = gx * q.v, vaz = gz * q.v, vn = (pc.vx - vax) * best.nx + (pc.vz - vaz) * best.nz;
      if (vn < 0) {
        var J = -(1 + 0.25) * vn / (1 / mP + (wreck ? 0 : 1 / mA));
        pc.vx += best.nx * J / mP; pc.vz += best.nz * J / mP;
        if (!wreck) {
          // Gegner: Tempo längs, Seitenversatz quer (in Streckenkoordinaten)
          var dvx = -best.nx * J / mA, dvz = -best.nz * J / mA, a = T.at(q.s);
          q.v = Math.max(0, q.v + (dvx * gx + dvz * gz));
          var lat = (dvx * a.nx + dvz * a.nz) * 0.12 + (-best.nx * a.nx - best.nz * a.nz) * best.pen * (1 - shareP);
          var lim = T.width / 2 + Math.max(0, q.d > 0 ? a.runL : a.runR) - c.w / 2 - 0.2;
          q.d = clamp(q.d + lat, -lim, lim);
        }
        if (-vn > 1.5) { race.shake = Math.min(0.5, race.shake + -vn * 0.03); hitSound(-vn); }
      }
    });
  }

  // ---- Kameras ----
  var CAMS = { chase: 'Chase camera', hood: 'Hood camera', tv: 'TV camera' }, CAM_ORDER = ['chase', 'hood', 'tv'];
  function setCam(m, snapNow) {
    race.camMode = m; race.tvIdx = -1;
    $('hCam').textContent = CAMS[m] + ' – C / Y to switch';
    if (snapNow) race.camPos = null;
  }
  function tvSpot(i) {
    var T = race.T, SP = 45, s = i * SP, a = T.at(s);
    var sd = a.runL >= a.runR ? 1 : -1, off = T.width / 2 + (sd > 0 ? a.runL : a.runR) + 4;
    return new THREE.Vector3(a.x + a.nx * sd * off, 5.5, a.z + a.nz * sd * off);
  }
  var tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3();
  function updateCam(dt) {
    var pc = race.pc, me = race.me, fx = Math.cos(pc.yaw), fz = -Math.sin(pc.yaw), mode = race.camMode;
    var sp = Math.hypot(pc.vx, pc.vz), fov = 62;
    if (race.phase === 'countdown' && look.used) {
      // Umschauen in der Startaufstellung: Kreisbahn um das eigene Auto
      var ang = pc.yaw + Math.PI + look.yaw, hd = look.dist * Math.cos(look.pitch);
      tmpV.set(pc.x + Math.cos(ang) * hd, look.dist * Math.sin(look.pitch) + me.height * 0.6, pc.z - Math.sin(ang) * hd);
      tmpL.set(pc.x, me.height * 0.5, pc.z);
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
      var back = me.len * 1.15 + 4.2, up = 1.7 + me.height * 0.9;
      tmpV.set(pc.x - hx * back, up, pc.z - hz * back);
      tmpL.set(pc.x + fx * 4, me.height * 0.75, pc.z + fz * 4);
      if (!race.camPos) { race.camPos = tmpV.clone(); race.camLook = tmpL.clone(); }
      race.camPos.lerp(tmpV, damp(7, dt)); race.camLook.lerp(tmpL, damp(12, dt));
      fov = 60 + clamp(sp / pc.P.vtop, 0, 1.3) * 10;
    } else if (mode === 'hood') {
      me.holder.updateMatrixWorld(true);
      tmpV.set(me.len * 0.08, me.height * 1.02 + 0.12, 0); me.holder.localToWorld(tmpV);
      tmpL.set(me.len * 0.08 + 30, me.height * 0.8, 0); me.holder.localToWorld(tmpL);
      race.camPos = tmpV.clone(); race.camLook = tmpL.clone();
      fov = 68 + clamp(sp / pc.P.vtop, 0, 1.3) * 8;
    } else {
      var SP = 45, n = Math.max(1, Math.floor(race.T.len / SP)), idx = Math.floor(((pc.s + 22) % race.T.len) / SP) % n;
      if (idx !== race.tvIdx) { race.tvIdx = idx; race.tvPos = tvSpot(idx); race.camLook = new THREE.Vector3(pc.x, 1, pc.z); }
      race.camPos = race.tvPos.clone();
      tmpL.set(pc.x, me.height * 0.5, pc.z);
      race.camLook.lerp(tmpL, damp(10, dt));
      var dist = race.camPos.distanceTo(race.camLook);
      fov = clamp(2 * Math.atan(me.len * 1.6 / Math.max(1, dist)) * 180 / Math.PI, 12, 55);
    }
    cam.position.copy(race.camPos);
    if (race.shake > 0 && !REDUCE) {
      cam.position.x += (Math.random() - 0.5) * race.shake; cam.position.y += (Math.random() - 0.5) * race.shake * 0.6;
    }
    race.shake = Math.max(0, race.shake - dt * 1.5);
    cam.lookAt(race.camLook);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * damp(5, dt); cam.updateProjectionMatrix(); }
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

  function lapDone(lapTime) {
    race.lastLap = lapTime;
    if (race.bestLap == null || lapTime < race.bestLap) race.bestLap = lapTime;
    var big = false;
    if (race.stored == null || lapTime < race.stored) {
      race.stored = lapTime; race.newBest = true;
      save('best.' + race.s.car + '.' + race.seed, Math.round(lapTime * 1000) / 1000);
      flash('Best lap ' + fmt(lapTime), 2);
    } else flash('Lap ' + fmt(lapTime), 1.5);
    if (!race.mp) {
      // solo (ohne Prüfung): Streckenrekord nur lokal; der Server-Rekord wird nur verglichen, nie geschrieben
      if (!race.local || lapTime < race.local.t) {
        race.local = { t: Math.round(lapTime * 1000) / 1000, car: race.s.car, name: race.me.name };
        save('trackBest.' + race.seed, race.local);
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
    r.local = load('trackBest.' + r.seed, null);
    if (r.local && !(r.local.t > 0)) r.local = null;
    var url = recUrl(track, r.s.car);
    if (!url) return;
    fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (x) { return x.json(); }).then(function (j) {
      if (race !== r || !j || !j.ok) return;
      r.rec.track = j.record || null; r.rec.car = j.car || null;
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
    setText('hTrackRec', rec.track ? fmt(rec.track.time) : '–');
    setText('hTrackRecBy', rec.track ? rec.track.display + ' · ' + recName(rec.track) : '');
  }
  // WS-Meldung „rec“: geprüfte Runde war Bestzeit/Rekord (eigene → große Einblendung)
  function recMsg(m) {
    if (!race || !race.mp || !race.rec || m.track !== race.rec.idx) return;
    var mine = mp && String(m.id) === mp.me, row = { display: m.name, car_key: m.car, time: m.time };
    if (m.track_rec) race.rec.track = m.best_track || row;
    if (m.car === race.s.car && (m.car_rec || !race.rec.car)) race.rec.car = m.best_car || row;
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
      var car = doc.createElement('span'); car.className = 'car'; car.textContent = byKey[d.car] ? displayName(byKey[d.car]) : d.car || '–';
      li.appendChild(nm); li.appendChild(car); ui.roster.appendChild(li);
    });
    $('mpStartBtn').disabled = !mp.roster.length || mp.phase === 'countdown' || mp.phase === 'race';
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
      startAt: null, grid: [], fin: {}, results: null, recorded: null, loaded: {}, loading: {} };
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
        lobbyTrack(); renderRoster();
        mp.net.send({ t: 'join', car: mp.car, paint: mp.paint });
        setLobbyStatus(mp.role === 'host' ? 'Post the link in the chat, then start the race.' : 'Waiting for the streamer to start the race.');
        break;
      case 'joined':
        if (!m.ok) setLobbyStatus(m.msg);
        break;
      case 'roster':
        mp.roster = m.list || []; renderRoster();
        mp.roster.forEach(function (d) { mpLoad(d.car); });
        break;
      case 'phase': mpPhase(m); break;
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
      if (m.race_id !== mp.raceId) { mp.fin = {}; mp.results = null; mp.recorded = null; }
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
    trackRes = CarTrackScene.build(T, { primary: tokenColor('tk-primary', '#5e2a79'), accent: tokenColor('tk-accent', '#f2b705'), maxAniso: maxAniso });
    scene.add(trackRes.group);
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
      mp: true, raceId: mp.raceId, me: me, pc: pc, laps: mp.room.laps | 0 || 3, phase: 'countdown', paused: false,
      t: 0, cd: mp.startAt - mp.net.serverNow(), lapStart: 0, lastLap: null, bestLap: null, stored: load('best.' + mp.car + '.' + seed, null),
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
    var at = mp.net.serverNow() - Net.DELAY;
    race.remotes.forEach(function (c) {
      var q = mp.net.sample(c.id, at);
      c.smp = q;
      if (!q) return;
      c.prog = q.prog;
      placeCar(c, q.x, q.z, q.yaw, q.roll, q.pitch, q.steer, q.spin);
    });
  }
  // Kontakt mit Fremdautos: nur das eigene Auto wird geschoben/gebremst (der andere Client macht dasselbe), nach Masse
  function mpContacts() {
    var pc = race.pc, me = race.me;
    var fx = Math.cos(pc.yaw), fz = -Math.sin(pc.yaw), rM = me.w / 2, oM = Math.max(0, me.len / 2 - rM);
    var mine = [[pc.x + fx * oM, pc.z + fz * oM], [pc.x - fx * oM, pc.z - fz * oM]];
    race.remotes.forEach(function (c) {
      var q = c.smp;
      if (!q || Math.abs(q.x - pc.x) > 12 || Math.abs(q.z - pc.z) > 12) return;
      var gx = Math.cos(q.yaw), gz = -Math.sin(q.yaw), rA = c.w / 2, oA = Math.max(0, c.len / 2 - rA);
      var theirs = [[q.x + gx * oA, q.z + gz * oA], [q.x - gx * oA, q.z - gz * oA]], best = null;
      mine.forEach(function (m) { theirs.forEach(function (t) {
        var dx = m[0] - t[0], dz = m[1] - t[1], d = Math.hypot(dx, dz), pen = rM + rA - d;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen: pen, nx: d > 1e-4 ? dx / d : -fx, nz: d > 1e-4 ? dz / d : -fz };
      }); });
      if (!best) return;
      var mP = pc.P.mass, mA = c.st.mass, shareP = mA / (mP + mA);
      pc.x += best.nx * best.pen * shareP; pc.z += best.nz * best.pen * shareP;
      var vn = (pc.vx - gx * q.speed) * best.nx + (pc.vz - gz * q.speed) * best.nz;
      if (vn < 0) {
        var J = -(1 + 0.25) * vn / (1 / mP + 1 / mA);
        pc.vx += best.nx * J / mP; pc.vz += best.nz * J / mP;
        if (-vn > 1.5) { race.shake = Math.min(0.5, race.shake + -vn * 0.03); hitSound(-vn); }
      }
    });
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
    ui.qual.value = load('quality', 'light') === 'full' ? 'full' : 'light';
    ui.status.textContent = 'Loading your garage…';
    fetch(CFG.ticket, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.signin) { $('signinBtn').href = CFG.login; showPanel('signin'); return; }
      if (!j.ok) { ui.status.textContent = j.error || 'This room is not available.'; $('startBtn').disabled = true; return; }
      viewerCars = { garage: j.garage || [], rnd: j.rnd, ticket: j.ticket, room: j.room, me: j.me };
      var T = Sim.track(Sim.TRACKS[j.room.track | 0] || 1);
      ui.status.textContent = T.name + ' · ' + j.room.laps + ' lap' + (j.room.laps === 1 ? '' : 's') + ' · ' + j.room.drivers + '/' + j.room.max + ' drivers' +
        (viewerCars.garage.length ? '' : ' – no cars in your garage yet, you get a random one (buy cars in the chat with !buy).');
      fillList();
    }).catch(function () { ui.status.textContent = 'Could not reach the server.'; });
  }
  function viewerJoin(s) {
    if (!viewerCars || !viewerCars.ticket) return;
    if (!Net) { ui.status.textContent = 'Network script failed to load – reload the page.'; return; }
    var light = ui.qual.value !== 'full';
    save('quality', light ? 'light' : 'full');
    renderScale = light ? 0.75 : 1; resize();
    mpStart({ code: CFG.code, ticket: viewerCars.ticket, role: 'viewer', me: viewerCars.me.id, room: viewerCars.room,
      car: s.car, paint: s.paint, light: light, duck: true });
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
    ui.qualRace.value = load('quality', 'light') === 'full' ? 'full' : 'light';
    ui.qualRace.addEventListener('change', function () { save('quality', ui.qualRace.value); });
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
    if (!me.in_race || !live) return;
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
      var light = ui.qualRace.value !== 'full';
      renderScale = light ? 0.75 : 1; resize();
      mp = { code: 'race', role: 'driver', me: String(j.me.id), room: {}, roster: [], light: light, duck: true, phase: '', raceId: j.race_id,
        startAt: null, grid: [], fin: {}, results: null, recorded: null, loaded: {}, loading: {}, info: null };
      var m = mp;
      mp.net = Net.connect({ url: wsUrl('race'), ticket: j.ticket, onMessage: function (msg) { if (mp === m) rcMsg(msg); },
        onState: function (on) { if (!on && mp === m && race && race.chat) flash('Connection lost – reconnecting…', 2); } });
      (rc.st.racers || []).forEach(function (r) { mpLoad(r.car_key); });
    }).catch(function () { rc.busy = false; });
  }
  function rcMsg(m) {
    if (m.t === 'welcome' || m.t === 'race') { mp.info = m.race; if (race && race.chat) (m.race.taken || []).forEach(rcTakeover); }
    else if (m.t === 'takeover') rcTakeover(m.ev);
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
    race.sim = Sim.create({ seed: st.seed | 0, track: T, laps: st.laps || 3, finishWindow: st.finish_window || 15, cars: cars, events: st.race_events || [] });
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
      trackRes = CarTrackScene.build(T, { primary: tokenColor('tk-primary', '#5e2a79'), accent: tokenColor('tk-accent', '#f2b705'), maxAniso: maxAniso });
      scene.add(trackRes.group);
      race = { s: { car: null, paint: 0, track: tIdx, laps: st.laps || 3 }, T: T, seed: T.seed, sim: null, ai: [], remotes: [],
        mp: true, chat: true, raceId: st.race_id, me: null, pc: null, laps: st.laps || 3, phase: 'countdown', paused: false,
        t: 0, cd: rcGo(st) - mp.net.serverNow(), lapStart: 0, lastLap: null, bestLap: null, stored: null,
        prev: null, finishT: null, doneT: 0, camMode: 'chase', camPos: null, camLook: null, tvIdx: -1, shake: 0,
        lapsShown: -1, posShown: '', opp: [], newBest: false, follow: {}, taken: {}, nitroSeen: {} };
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
      race.stored = load('best.' + mineSrc.car_key + '.' + T.seed, null);
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
    race.spect = !!(pil && pil.indexOf(mp.me) < 0);
    if (race.spect && !race.spectSaid) { race.spectSaid = true; flash('You were not connected when the grid closed – the AI drives your car', 4); }
  }
  function rcTakeover(ev) {
    if (!race || !race.chat || !ev || race.taken[ev.id]) return;
    race.taken[String(ev.id)] = ev;
    if (String(ev.id) === mp.me) { race.spect = true; flash('Connection lost – the AI took over your car', 4); }
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
      if (e.type === 'takeover') rcTakeover(e);
      // Nitro aus dem Chat für mich: wirkt hier (einmal je Ereignis)
      if (e.type === 'nitro' && String(e.id) === mp.me && !race.nitroSeen[e.t] && !race.spect) {
        race.nitroSeen[e.t] = 1; race.pc.nitroT = Phys.NITRO_T; flash('Nitro from the chat!', 2);
      }
    });
    var key = JSON.stringify(st.race_events || []);
    if (key !== rc.evKey) { rc.evKey = key; if (race.sim.setEvents(st.race_events || [])) rcBuildSim(st); }
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
    var at = mp.net.serverNow() - Net.DELAY, t = mp.net.serverNow() - mp.startAt;
    race.remotes.forEach(function (c) {
      var f = rcFollower(c.id, c.idx), q;
      if (f) { var fq = f.at(t); q = { x: fq.x, z: fq.z, yaw: fq.yaw, roll: fq.roll, pitch: 0, steer: fq.steer, spin: fq.spin, speed: fq.v, prog: fq.s }; c.finQ = fq.finish; }
      else q = mp.net.sample(c.id, at);
      c.smp = q;
      if (!q) { var g = race.sim.cars[c.idx]; placeCar(c, g.x, g.z, g.yaw, 0, 0, 0, 0); return; }
      c.prog = q.prog;
      placeCar(c, q.x, q.z, q.yaw, q.roll, q.pitch, q.steer, q.spin);
    });
    if (race.spect) {
      var pc = race.pc, f2 = rcFollower(mp.me, race.myIdx), q2 = f2 ? f2.at(t) : race.sim.cars[race.myIdx];
      if (q2 && !q2.ghost) { pc.x = q2.x; pc.z = q2.z; pc.yaw = q2.yaw; pc.prog = q2.s; pc.vx = Math.cos(q2.yaw) * q2.v; pc.vz = -Math.sin(q2.yaw) * q2.v; pc.u = q2.v; pc.steer = q2.steer; pc.spin = q2.spin; }
    }
  }
  // Kontakt: nur das eigene Auto wird geschoben (KI aus der Sim und andere Piloten), nach Masse
  function rcContacts() {
    if (race.spect) return;
    var others = [];
    race.ai.forEach(function (c, i) {
      if (!c) return;
      if (race.remotes.indexOf(c) >= 0) { if (c.smp) others.push({ c: c, q: c.smp }); return; }
      var q = race.sim.cars[i]; others.push({ c: c, q: { x: q.x, z: q.z, yaw: q.yaw, speed: q.v } });
    });
    var pc = race.pc, me = race.me, fx = Math.cos(pc.yaw), fz = -Math.sin(pc.yaw), rM = me.w / 2, oM = Math.max(0, me.len / 2 - rM);
    var mine = [[pc.x + fx * oM, pc.z + fz * oM], [pc.x - fx * oM, pc.z - fz * oM]];
    others.forEach(function (o) {
      var c = o.c, q = o.q;
      if (Math.abs(q.x - pc.x) > 12 || Math.abs(q.z - pc.z) > 12) return;
      var gx = Math.cos(q.yaw), gz = -Math.sin(q.yaw), rA = c.w / 2, oA = Math.max(0, c.len / 2 - rA), best = null;
      var theirs = [[q.x + gx * oA, q.z + gz * oA], [q.x - gx * oA, q.z - gz * oA]];
      mine.forEach(function (m) { theirs.forEach(function (tt) {
        var dx = m[0] - tt[0], dz = m[1] - tt[1], d = Math.hypot(dx, dz), pen = rM + rA - d;
        if (pen > 0 && (!best || pen > best.pen)) best = { pen: pen, nx: d > 1e-4 ? dx / d : -fx, nz: d > 1e-4 ? dz / d : -fz };
      }); });
      if (!best) return;
      var mP = pc.P.mass, mA = c.st.mass, shareP = mA / (mP + mA);
      pc.x += best.nx * best.pen * shareP; pc.z += best.nz * best.pen * shareP;
      var vn = (pc.vx - gx * (q.speed || 0)) * best.nx + (pc.vz - gz * (q.speed || 0)) * best.nz;
      if (vn < 0) {
        var J = -(1 + 0.25) * vn / (1 / mP + 1 / mA);
        pc.vx += best.nx * J / mP; pc.vz += best.nz * J / mP;
        if (-vn > 1.5) { race.shake = Math.min(0.5, race.shake + -vn * 0.03); hitSound(-vn); }
      }
    });
  }

  // ---- Schleife ----
  var lastT = performance.now();
  function frame(now) {
    root.requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    var p = readPad();
    if (p && p.start && race && (race.phase === 'race' || race.phase === 'countdown' || race.phase === 'done')) setPaused(!race.paused);
    else if (p) padMenu(p);
    if (!race || !trackRes) { idleCam(dt); soundFrame(null); renderer.render(scene, cam); return; }
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('hMsg').classList.remove('show', 'big'); }
    if (race.paused || race.phase === 'results') {
      if (race.phase === 'results' && !race.paused) stepWorld(dt, cruise(race.pc));
      lookPhase(); fxFrame(dt, null);
      renderer.render(scene, cam); return;
    }
    var pc = race.pc;
    if (pressed.KeyC || (p && p.cam)) setCam(CAM_ORDER[(CAM_ORDER.indexOf(race.camMode) + 1) % CAM_ORDER.length], true);
    if (race.phase === 'countdown') {
      var before = Math.ceil(race.cd);
      race.cd = race.mp ? mp.startAt - mp.net.serverNow() : race.cd - dt;
      var after = Math.ceil(race.cd);
      if (after !== before || !ui.countdown.textContent) {
        ui.countdown.textContent = after > 0 ? String(after) : 'GO';
        ui.countdown.classList.remove('tick'); void ui.countdown.offsetWidth; ui.countdown.classList.add('tick');
        say(after > 0 ? String(after) : 'Go');
        if (after > 0 && after <= 3 && after !== before) sfx('beep');
      }
      if (p && (p.lookX || p.lookY) && lookAllowed()) lookOrbit(p.lookX * dt * 420, p.lookY * dt * 320);
      if (race.cd <= 0 && (!race.chat || rc.st.phase === 'intro' || rc.st.phase === 'race')) {
        race.phase = 'race'; race.t = race.mp ? Math.max(0, -race.cd) : 0; race.lapStart = 0;
        sfx('go');
        // Umschauen beendet: Verfolgerkamera holt die Kamera weich zurück (reduzierte Bewegung: sofort)
        if (look.used && REDUCE) race.camPos = null;
        lookReset();
        setTimeout(function () { ui.countdown.hidden = true; ui.countdown.textContent = ''; }, 700);
      }
      placeCar(race.me, pc.x, pc.z, pc.yaw, pc.roll, pc.pitch, pc.steer, pc.spin);
      drawAI();
      if (race.chat) { rcDraw(); placeCar(race.me, pc.x, pc.z, pc.yaw, pc.roll, pc.pitch, pc.steer, pc.spin); mpSend(); }
      else if (race.mp) { drawRemotes(); mpSend(); }
    } else {
      var inp = race.spect ? null : race.phase === 'done' ? cruise(pc) : playerInput(dt, p);
      if (race.phase === 'race' && pressed.KeyR) { Phys.reset(pc); flash('Back on track', 1); }
      stepWorld(dt, inp);
    }
    pressed = {};
    updateHud(standings());
    updateCam(dt);
    lookPhase();
    fxFrame(dt, race.phase === 'countdown' ? null : inp);
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
    if (race.sim) { while (race.sim.time + Sim.DT <= race.t + 1e-9) { snap(); race.sim.step(); } }
    if (race.chat) rcDraw();
    if (inp) {
      var lapsBefore = pc.laps;
      Phys.step(pc, inp, dt);
      if (race.sim && !race.chat) contacts();
      if (race.chat) rcContacts();
      if (race.mp && !race.chat) { drawRemotes(); mpContacts(); }
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
    soundFrame(inp);
  }
  // Menü: langsamer Kameraflug um den Ursprung (ohne Strecke nur Himmel)
  var idleA = 0;
  function idleCam(dt) { idleA += dt * 0.05; cam.position.set(Math.cos(idleA) * 120, 70, Math.sin(idleA) * 120); cam.lookAt(0, 0, 0); }
  root.requestAnimationFrame(frame);
  showPanel(RACE ? 'lobby' : 'menu');
  // Fehlersuche/Prüfskript: aktueller Rennzustand (nur lesen)
  root.CarDrive = { state: function () { return race; },
    debug: function () { return { sound: !!snd, soundOn: sndOn, volume: sndVol, look: { used: look.used, yaw: look.yaw, dist: look.dist }, fx: FX ? FX.count() : null }; } };
})(typeof window !== 'undefined' ? window : this);
