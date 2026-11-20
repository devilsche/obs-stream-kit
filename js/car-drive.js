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
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, TC = root.ToyCars, Sim = root.CarRaceSim, Stats = root.CarRaceStats, Phys = root.CarDrivePhys;
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
    renderer.setPixelRatio(Math.min(1.5, root.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  resize();
  root.addEventListener('resize', resize);

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
    hud: $('hud'), countdown: $('countdown'), announce: $('announce'), fs: $('fsBtn')
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
  function fillList() {
    var q = ui.search.value.trim().toLowerCase(), cur = ui.list.value || pref.car;
    ui.list.textContent = '';
    var shown = 0;
    catalog.forEach(function (e) {
      var label = displayName(e), hay = (label + ' ' + (e.brand || '') + ' ' + e.key).toLowerCase();
      if (q && hay.indexOf(q) < 0) return;
      var o = doc.createElement('option'); o.value = e.key; o.textContent = label + (e.brand ? ' (' + e.brand + ')' : '');
      ui.list.appendChild(o); shown++;
    });
    if (cur && byKey[cur] && ui.list.querySelector('option[value="' + CSS.escape(cur) + '"]')) ui.list.value = cur;
    else if (shown) ui.list.selectedIndex = 0;
    carChanged();
    if (!shown) ui.info.textContent = 'No car matches “' + ui.search.value + '”.';
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
  var PANELS = ['menu', 'loading', 'pause', 'finish'];
  function showPanel(name) {
    PANELS.forEach(function (p) { ui[p].hidden = p !== name; });
    app.classList.toggle('racing', !name);
    if (name) {
      var f = ui[name].querySelector(name === 'menu' ? '#carList' : 'button, select, input');
      if (f) setTimeout(function () { try { f.focus(); } catch (e) { /* */ } }, 0);
    }
  }
  function say(t) { ui.announce.textContent = t; }
  var msgT = 0;
  function flash(text, secs) { var m = $('hMsg'); m.textContent = text; m.classList.add('show'); msgT = secs || 1.5; }

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

  // ---- Eingabe ----
  var keys = {}, pressed = {};
  var GAME_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, ShiftLeft: 1, ShiftRight: 1, KeyR: 1, KeyC: 1 };
  doc.addEventListener('keydown', function (e) {
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
  root.addEventListener('blur', function () { keys = {}; if (race && race.phase === 'race' && !race.paused) setPaused(true); });
  doc.addEventListener('visibilitychange', function () { if (doc.hidden && race && race.phase === 'race' && !race.paused) setPaused(true); });

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
    var r = { throttle: val(7), brake: val(6), steer: -ax, handbrake: cur[0], nitro: cur[1], cam: edge(3), start: edge(9),
      up: edge(12), down: edge(13), left: edge(14), right: edge(15), a: edge(0), b: edge(1) };
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
      race.ai.forEach(disposeCar); disposeCar(race.me);
      race = null;
    }
    if (trackRes) { trackRes.dispose(); trackRes = null; }
    ui.hud.hidden = true; ui.countdown.hidden = true;
    keys = {}; steerKb = thrKb = brkKb = 0;
  }

  function setPaused(on) {
    if (!race) return;
    race.paused = on;
    keys = {};
    if (on) showPanel('pause'); else { showPanel(null); try { canvas.focus({ preventScroll: true }); } catch (e) { /* */ } }
  }
  $('resumeBtn').addEventListener('click', function () { setPaused(false); });
  $('restartBtn').addEventListener('click', function () { if (race) { var s = race.s, o = race.opp; begin(s, o); } });
  $('menuBtn').addEventListener('click', function () { teardown(); showPanel('menu'); });
  $('againBtn').addEventListener('click', function () { if (race) { var s = race.s, o = race.opp; begin(s, o); } });
  $('finishMenuBtn').addEventListener('click', function () { teardown(); showPanel('menu'); });

  // Sim-Zustand für die Interpolation
  function snap() {
    race.prev = race.sim.cars.map(function (c) { return { x: c.x, z: c.z, yaw: c.yaw, roll: c.roll, pitch: c.pitch, steer: c.steer, spin: c.spin }; });
  }
  function drawAI() {
    if (!race.sim) return;
    var a = clamp((race.t - race.sim.time) / Sim.DT, 0, 1);   // eine Sim-Stufe zurück, weich dazwischen
    race.ai.forEach(function (c, i) {
      var q = race.sim.cars[i], p = race.prev[i] || q;
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
        if (-vn > 1.5) { race.shake = Math.min(0.5, race.shake + -vn * 0.03); }
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
  function standings() {
    var list = [{ me: true, name: race.me.name, prog: race.pc.prog, fin: race.finishT, dnf: false }];
    if (race.sim) race.sim.cars.forEach(function (q, i) {
      list.push({ me: false, name: race.ai[i].name, prog: q.s, fin: q.finish, dnf: q.place == null && q.state === 'dnf' && q.wreck });
    });
    list.sort(function (a, b) {
      if ((a.fin != null) !== (b.fin != null)) return a.fin != null ? -1 : 1;
      if (a.fin != null) return a.fin - b.fin;
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      return b.prog - a.prog;
    });
    return list;
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
    var posTxt = pos + '/' + n;
    if (race.posShown !== posTxt) { bigNum('hPos', pos, n); race.posShown = posTxt; }
    var lap = Math.min(race.laps, pc.laps + 1);
    if (race.lapsShown !== lap) { bigNum('hLap', lap, race.laps); race.lapsShown = lap; }
    setText('hCur', fmt(race.phase === 'race' ? race.t - race.lapStart : race.phase === 'countdown' ? 0 : null));
    setText('hLast', fmt(race.lastLap));
    var best = race.bestLap != null && (race.stored == null || race.bestLap < race.stored) ? race.bestLap : race.stored;
    setText('hBest', fmt(best));
    setText('hSpeed', String(Math.round(Phys.speedKmh(pc))));
    var nb = $('hNitro'), state = pc.nitroT > 0 ? 'on' : Phys.nitroReady(pc) && pc.prog > 0 ? 'ready' : 'used';
    if (nb.dataset.state !== state) { nb.dataset.state = state; setText('hNitroText', state === 'on' ? 'Nitro!' : state === 'ready' ? 'Nitro ready' : 'Nitro next lap'); }
  }

  function lapDone(lapTime) {
    race.lastLap = lapTime;
    if (race.bestLap == null || lapTime < race.bestLap) race.bestLap = lapTime;
    if (race.stored == null || lapTime < race.stored) {
      race.stored = lapTime; race.newBest = true;
      save('best.' + race.s.car + '.' + race.seed, Math.round(lapTime * 1000) / 1000);
      flash('Best lap ' + fmt(lapTime), 2);
    } else flash('Lap ' + fmt(lapTime), 1.5);
  }

  function showResults() {
    race.phase = 'results';
    var list = standings();
    ui.results.textContent = '';
    list.forEach(function (x, i) {
      var li = doc.createElement('li'); if (x.me) li.className = 'me';
      var pl = doc.createElement('span'); pl.className = 'pl'; pl.textContent = String(i + 1);
      var nm = doc.createElement('span'); nm.textContent = x.name;
      if (x.me) { var tg = doc.createElement('span'); tg.className = 'tag'; tg.textContent = 'You'; nm.appendChild(tg); }
      var tm = doc.createElement('span'); tm.className = 'tm';
      tm.textContent = x.fin != null ? fmt(x.fin) : x.dnf ? 'DNF' : 'running';
      li.appendChild(pl); li.appendChild(nm); li.appendChild(tm); ui.results.appendChild(li);
    });
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

  // ---- Schleife ----
  var lastT = performance.now();
  function frame(now) {
    root.requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    var p = readPad();
    if (p && p.start && race && (race.phase === 'race' || race.phase === 'countdown' || race.phase === 'done')) setPaused(!race.paused);
    else if (p) padMenu(p);
    if (!race || !trackRes) { idleCam(dt); renderer.render(scene, cam); return; }
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('hMsg').classList.remove('show'); }
    if (race.paused || race.phase === 'results') { if (race.phase === 'results' && !race.paused) stepWorld(dt, cruise(race.pc)); renderer.render(scene, cam); return; }
    var pc = race.pc;
    if (pressed.KeyC || (p && p.cam)) setCam(CAM_ORDER[(CAM_ORDER.indexOf(race.camMode) + 1) % CAM_ORDER.length], true);
    if (race.phase === 'countdown') {
      var before = Math.ceil(race.cd);
      race.cd -= dt;
      var after = Math.ceil(race.cd);
      if (after !== before || !ui.countdown.textContent) {
        ui.countdown.textContent = after > 0 ? String(after) : 'GO';
        ui.countdown.classList.remove('tick'); void ui.countdown.offsetWidth; ui.countdown.classList.add('tick');
        say(after > 0 ? String(after) : 'Go');
      }
      if (race.cd <= 0) { race.phase = 'race'; race.t = 0; race.lapStart = 0; setTimeout(function () { ui.countdown.hidden = true; ui.countdown.textContent = ''; }, 700); }
      placeCar(race.me, pc.x, pc.z, pc.yaw, pc.roll, pc.pitch, pc.steer, pc.spin);
      drawAI();
    } else {
      var inp = race.phase === 'done' ? cruise(pc) : playerInput(dt, p);
      if (race.phase === 'race' && pressed.KeyR) { Phys.reset(pc); flash('Back on track', 1); }
      stepWorld(dt, inp);
    }
    pressed = {};
    updateHud(standings());
    updateCam(dt);
    renderer.render(scene, cam);
  }
  function stepWorld(dt, inp) {
    var pc = race.pc;
    race.t += dt;
    if (race.sim) { while (race.sim.time + Sim.DT <= race.t + 1e-9) { snap(); race.sim.step(); } }
    if (inp) {
      var lapsBefore = pc.laps;
      Phys.step(pc, inp, dt);
      if (race.sim) contacts();
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
      var open = race.sim ? race.sim.cars.some(function (q) { return q.place == null && q.state !== 'dnf'; }) : false;
      if (!open || race.doneT > 12) showResults();
    }
    placeCar(race.me, pc.x, pc.z, pc.yaw, pc.roll, pc.pitch, pc.steer, pc.spin);
    drawAI();
    if (race.phase === 'results') updateCam(dt);
  }
  // Menü: langsamer Kameraflug um den Ursprung (ohne Strecke nur Himmel)
  var idleA = 0;
  function idleCam(dt) { idleA += dt * 0.05; cam.position.set(Math.cos(idleA) * 120, 70, Math.sin(idleA) * 120); cam.lookAt(0, 0, 0); }
  root.requestAnimationFrame(frame);
  showPanel('menu');
  // Fehlersuche/Prüfskript: aktueller Rennzustand (nur lesen)
  root.CarDrive = { state: function () { return race; } };
})(typeof window !== 'undefined' ? window : this);
