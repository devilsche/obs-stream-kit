/* Friend: animierter Hund für OBS (effects/friend.html), three r128 + GLTFLoader.
 * Modell: „Animated Dog, Shiba Inu“ von quander (Sketchfab, CC BY 4.0), umgeformt (schlanker Pinscher-Körperbau,
 * gerade Rute, lange Schnauze) und umgefärbt (Black & tan). Gehen/Traben/Galopp, Kehren und Wedeln sind auf dem
 * Skelett programmiert; Sitzen, Pfote, Rollen und Hinlegen sind die Clips des Modells.
 *
 *   var f = FriendDog.create({ canvas, model, sizePx, fur, body, sound, volume, area, reactions, roam });
 *   f.ready.then(...);  f.react('follow');  f.act('sit', { face: 6 });
 *
 * Verhalten: läuft von sich aus herum, schaut sich um, setzt sich, legt sich nach längerer Ruhe hin (roam=false: steht).
 * Reaktionen (Vorlagen): happy, roll, zoomies, paw, bark, sit, none. Blickrichtung nach Uhrzeit (12 = weg, 3 = rechts,
 * 6 = zum Zuschauer, 9 = links). Erkenntnisse (gemessen, nicht raten): siehe Kommentare an Beinen/Kehre/Zurücksetzen.
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  var DEFAULT_REACTIONS = { follow: 'happy', sub: 'roll', resub: 'roll', giftsub: 'roll', raid: 'zoomies', bits: 'paw',
    donation: 'paw', welcome: 'paw', burnout: 'bark', pet: 'pet' };

  function create(opt) {
    var canvas = opt.canvas, W = canvas.width || 1920, H = canvas.height || 1080;
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, premultipliedAlpha: true });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.setClearColor(0, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    var scene = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(22, W / H, 0.05, 200);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.0));
    var key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 5, 4); scene.add(key);
    var rim = new THREE.DirectionalLight(0xb8c4ff, 0.55); rim.position.set(-4, 2, -3); scene.add(rim);   // neutrales Gegenlicht (Gold färbte schwarzes Fell oliv)
    var sc = document.createElement('canvas'); sc.width = sc.height = 128;
    var sx = sc.getContext('2d'), sg = sx.createRadialGradient(64, 64, 4, 64, 64, 64);
    sg.addColorStop(0, 'rgba(0,0,0,0.5)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); sx.fillStyle = sg; sx.fillRect(0, 0, 128, 128);
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
    var holder = new THREE.Group(); scene.add(holder);
    var BIND = [], TRACKED = [], B = {}, mixer = null, actions = {}, cur = null;
    var UP = new THREE.Vector3(0, 1, 0), LAT = new THREE.Vector3(), FWD = new THREE.Vector3();
    var SIZE = 0.6, TAIL_STRAIGHT = true, TAIL_UP = 0.45, TAIL_THIN = 0.5;
    // Körperbau-Vorlagen (Shiba-Modell umgeformt). Jack Russell: kompakt, etwas länger als hoch, kürzeres Bein,
    // Rute aufrecht. Pinscher: schlank, hochbeinig, hochgezogener Bauch, Rute schräg.
    var BODIES = {
      pinscher: { build: { len: 1.02, height: 1.04, width: 0.86 }, slim: { belly: 0.78, chest: 0.86, neck: 0.72 }, tailUp: 0.45, tailThin: 0.45, muzzle: 1.4, headW: 0.8, upperLeg: 0.72 },
      jack: { build: { len: 1.08, height: 0.95, width: 0.9 }, slim: { belly: 0.82, chest: 0.88, neck: 0.78 }, tailUp: 1.0, tailThin: 0.6, muzzle: 1.15, headW: 0.9, upperLeg: 0.85 }
    };
    var BUILD = BODIES.pinscher.build, SLIM = BODIES.pinscher.slim, MUZZLE = 1, HEADW = 1, UPLEG = 1, buildGroup = null, slimMeshes = [];

    var FEET = ['LF_toes', 'RF_toes', 'LB_toes', 'RB_toes', 'L_hand', 'R_hand', 'L_foot', 'R_foot'];

    // Kamera: Hund ~sizePx hoch, Boden 36 px über dem unteren Rand, waagrecht von der Seite
    var sizePx = Math.max(60, Math.min(500, opt.sizePx || 170));
    var pxPerUnit = sizePx / (0.75 * 1.04), visH = H / pxPerUnit, halfW = visH / 2 * (W / H);
    var dist = visH / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), camY = visH / 2 - 36 / pxPerUnit;
    cam.position.set(0, camY, dist); cam.lookAt(0, camY, 0); cam.updateProjectionMatrix();
    var AREAS = { full: [-halfW + 0.5, halfW - 0.5], left: [-halfW + 0.5, -halfW * 0.25], right: [halfW * 0.25, halfW - 0.5],
                  center: [-halfW * 0.35, halfW * 0.35] };
    var area = AREAS[opt.area] || AREAS.full, RANGE = halfW - 0.4;

    var LABEL = {};
    var S = { face: null, z: 0, rise: 0, yawRate: 0, mode: 'idle', dir: 1, x: (area[0] + area[1]) / 2, gait: 0, phase: 0, wag: 0.4, bark: 0, barkT: 0 };
    var CLIPS = { sit: 1, shake: 1, roll: 1, lie: 1 };
    var FUR_KEY = opt.fur || 'pinscher', BODY_KEY = opt.body || 'pinscher';

    var ready = new Promise(function (resolve, reject) {
      new THREE.GLTFLoader().load(opt.model, function (g) {
        var dog = g.scene;
        var box = new THREE.Box3().setFromObject(dog), size = box.getSize(new THREE.Vector3());
        dog.scale.setScalar(1.25 * SIZE / size.y);
        box.setFromObject(dog); dog.position.y -= box.min.y; dog.position.x -= (box.min.x + box.max.x) / 2; dog.position.z -= (box.min.z + box.max.z) / 2;
        var inner = new THREE.Group(); inner.add(dog);
        buildGroup = new THREE.Group(); buildGroup.add(inner); holder.add(buildGroup);   // Körperbau: in Hund-Achsen (x vorn, y hoch, z quer)
        dog.traverse(function (o) {
          if (o.isBone) { var k = o.name.replace(/_jnt\d+_\d+$/, ''); if (!B[k]) B[k] = o; BIND.push([o, o.quaternion.clone(), o.position.clone()]); }
          if (o.isMesh) o.frustumCulled = false;
        });
        dog.traverse(function (o) { if (o.isMesh && o.material && o.material.map && !FUR.mat) { FUR.mat = o.material; FUR.orig = o.material.map; } });
        applyFur(FUR_KEY);
        dog.traverse(function (o) { if (o.isSkinnedMesh) slimMeshes.push({ o: o, orig: o.geometry.attributes.position.array.slice() }); });
        applyBody(BODY_KEY);
        mixer = new THREE.AnimationMixer(dog);
        g.animations.forEach(function (c) { actions[c.name.replace(/^0\|/, '').replace(/_0$/, '')] = mixer.clipAction(c); });
        // Grundstellung = erstes Bild des Steh-Clips (die Ruhepose der Datei ist keine natürliche Haltung; Knochen ohne
        // Spur im aktuellen Clip fielen sonst in sie zurück und der Hund hing schräg in der Luft)
        var st = actions.standing; st.play(); mixer.update(0);
        BIND.forEach(function (b) { b[1].copy(b[0].quaternion); b[2].copy(b[0].position); });
        st.stop();
        // Nur Knochen zurücksetzen, die kein Clip bewegt (dort addieren sich sonst die eigenen Drehungen auf).
        // Knochen mit Clip-Spuren schreibt der Mixer jedes Bild selbst; ein Zurücksetzen bringt ihn aus dem Takt.
        // Welche Knochen bewegt welcher Clip? Zurückgesetzt wird je Bild, was die gerade aktiven Clips NICHT bewegen.
        g.animations.forEach(function (c) {
          var set = {}; c.tracks.forEach(function (tr) { set[tr.name.split('.')[0]] = 1; });
          TRACKED.push([actions[c.name.replace(/^0\|/, '').replace(/_0$/, '')], set]);
        });
        holder.updateMatrixWorld(true);
        var ph = new THREE.Vector3(), pp = new THREE.Vector3();
        B.head.getWorldPosition(ph); B.pelvis.getWorldPosition(pp);
        var f = ph.sub(pp); f.y = 0; f.normalize();
        inner.rotation.y = Math.atan2(f.z, f.x);
        shadow.scale.set(2.2 * SIZE, 0.8 * SIZE, 1);

        resolve();
      }, null, function (e) { console.error('[friend] model failed', e); reject(e); });
    });

    // Fell: Shiba-Textur umfärben. Orange (Deckhaar) → Zielfarbe, Weiß/Creme (Abzeichen an Brust, Beinen, Gesicht)
    // → Abzeichenfarbe. Beim Pinscher wird so Orange zu glänzendem Schwarz und Weiß zu Loh (Black & tan).
    var FUR = { mat: null, orig: null, cache: {} };
    var FURS = {
      natural: null,
      pinscher: { coat: [0.08, 0.065, 0.055], mark: [0.62, 0.44, 0.27] },   // nach Foto: warmes Schwarz, goldenes Loh
      red: { coat: [0.5, 0.2, 0.09], mark: [0.66, 0.4, 0.22] },
      dark: { coat: [0.28, 0.17, 0.1], mark: [0.55, 0.45, 0.36] }
    };
    function applyFur(key) {
      if (!FUR.mat) return;
      var f = FURS[key];
      if (!f) { FUR.mat.map = FUR.orig; FUR.mat.needsUpdate = true; return; }
      if (!FUR.cache[key]) {
        var img = FUR.orig.image, cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        var cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
        var d = cx.getImageData(0, 0, cv.width, cv.height), px = d.data;
        for (var i = 0; i < px.length; i += 4) {
          var r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
          var mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
          // Nase, Augen, Ballen (sehr dunkel) und Zunge/Zahnfleisch (rötlich) behalten ihre Farbe
          var hue = mx === mn ? 0 : mx === r ? ((g - b) / (mx - mn) + 6) % 6 * 60 : mx === g ? ((b - r) / (mx - mn) + 2) * 60 : ((r - g) / (mx - mn) + 4) * 60;
          if (mx < 0.22 || (sat > 0.35 && (hue < 14 || hue > 330))) continue;
          // nur wirklich helles Weiß wird Abzeichen (Loh), alles andere Deckhaar
          var white = Math.max(0, Math.min(1, (0.2 - sat) / 0.1)) * Math.max(0, Math.min(1, (mx - 0.62) / 0.18));
          var detail = 0.7 + 0.6 * (0.299 * r + 0.587 * g + 0.114 * b);                        // Fellstruktur bleibt erhalten
          for (var c = 0; c < 3; c++) {
            var v = (f.coat[c] * (1 - white) + f.mark[c] * white) * detail;
            px[i + c] = Math.max(0, Math.min(255, v * 255));
          }
        }
        cx.putImageData(d, 0, 0);
        var tx = new THREE.CanvasTexture(cv);
        tx.flipY = FUR.orig.flipY; tx.encoding = FUR.orig.encoding; tx.wrapS = FUR.orig.wrapS; tx.wrapT = FUR.orig.wrapT;
        tx.anisotropy = 4; FUR.cache[key] = tx;
      }
      FUR.mat.map = FUR.cache[key]; FUR.mat.needsUpdate = true;
    }

    // Körperbau anwenden: Rumpf quer zur Körperachse verschlanken (aus den Original-Positionen, Bind-Pose –
    // die Beine hängen an eigenen Knochen und bleiben lang), Gesamtproportionen, Rute (Winkel + Dicke)
    function applyBody(key) {
      var bd = BODIES[key] || BODIES.pinscher; BUILD = bd.build; SLIM = bd.slim; TAIL_UP = bd.tailUp; TAIL_THIN = bd.tailThin; MUZZLE = bd.muzzle || 1; HEADW = bd.headW || 1; UPLEG = bd.upperLeg || 1;
      if (buildGroup) buildGroup.scale.set(BUILD.len, BUILD.height, BUILD.width);
      slimMeshes.forEach(function (m) {
        var o = m.o; o.geometry.attributes.position.array.set(m.orig);
        (function () {
        var geo = o.geometry, pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, bones = o.skeleton.bones;
        var bindPos = bones.map(function (b, k) { return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(o.skeleton.boneInverses[k]).invert()); });
        var idx = function (n) { return bones.indexOf(B[n]); };
        var TORSO = {}; [['pelvis', SLIM.belly], ['COG', SLIM.belly], ['spine_1', SLIM.belly], ['spine_2', SLIM.belly], ['chest', SLIM.chest],
          ['neck_base', SLIM.neck], ['neck_mid', SLIM.neck], ['neck_fat', SLIM.neck], ['breathe', SLIM.belly]].forEach(function (e) { var k = idx(e[0]); if (k >= 0) TORSO[k] = e[1]; });
        var a0 = bindPos[idx('pelvis')], a1 = bindPos[idx('chest')];
        if (!a0 || !a1) return;
        var axis = new THREE.Vector3().subVectors(a1, a0).normalize(), v = new THREE.Vector3(), c = new THREE.Vector3(), off = new THREE.Vector3();
        for (var vi = 0; vi < pos.count; vi++) {
          var f = 0, wsum = 0;
          var GET = ['getX', 'getY', 'getZ', 'getW'];   // r128: noch kein getComponent
          for (var j = 0; j < 4; j++) { var bi2 = si[GET[j]](vi), ww = sw[GET[j]](vi); if (TORSO[bi2] != null) { f += ww * TORSO[bi2]; wsum += ww; } }
          if (wsum < 0.05) continue;
          var fac = 1 - wsum + f;                                   // gewichtete Mischung aus 1 (unverändert) und dem Schlankfaktor
          v.fromBufferAttribute(pos, vi);
          // Mittelpunkt auf der Körperachse (Becken → Brust), Abstand quer dazu skalieren
          var tAx = off.subVectors(v, a0).dot(axis); c.copy(a0).addScaledVector(axis, tAx);
          off.subVectors(v, c).multiplyScalar(fac); v.copy(c).add(off);
          pos.setXYZ(vi, v.x, v.y, v.z);
        }
        // Lange Schnauze (Vorbild: schlanker Pinscher/Windhund): Kopf-Vertices ab etwa Augenhöhe nach vorn ziehen.
        // Achse = Kopfgelenk → Mitte der Nasenlöcher; Kiefer/Zunge/Zähne hängen an eigenen Knochen und bewegen sich weiter.
        var hk = idx('head'), nl = idx('L_nostril'), nr = idx('R_nostril');
        if ((MUZZLE !== 1 || HEADW !== 1) && hk >= 0 && nl >= 0 && nr >= 0) {
          var hp = bindPos[hk], np = new THREE.Vector3().addVectors(bindPos[nl], bindPos[nr]).multiplyScalar(0.5);
          var fa = new THREE.Vector3().subVectors(np, hp), flen = fa.length(); fa.normalize();
          var d0 = flen * 0.42, HEADSET = {}, EARS = {};
          bones.forEach(function (bn, k) { var q = bn; while (q) { if (q === B.head) { HEADSET[k] = 1; break; } q = q.parent; } if (/ear/i.test(bn.name)) EARS[k] = 1; });
          var latAx = new THREE.Vector3().crossVectors(fa, new THREE.Vector3(0, 1, 0)).normalize();
          for (var vh = 0; vh < pos.count; vh++) {
            var hw = 0;
            for (var jh = 0; jh < 4; jh++) if (HEADSET[si[GET[jh]](vh)]) hw += sw[GET[jh]](vh);
            if (hw < 0.5) continue;
            v.fromBufferAttribute(pos, vh);
            var ew = 0; for (var je = 0; je < 4; je++) if (EARS[si[GET[je]](vh)]) ew += sw[GET[je]](vh);
            // schmalerer Kopf (Shiba-Backen weg), Ohren unverändert
            var side = off.subVectors(v, hp).dot(latAx);
            v.addScaledVector(latAx, -side * (1 - HEADW) * (1 - Math.min(1, ew * 2)));
            var pr = off.subVectors(v, hp).dot(fa);
            if (pr > d0) v.addScaledVector(fa, (pr - d0) * (MUZZLE - 1) * Math.min(1, hw));
            pos.setXYZ(vh, v.x, v.y, v.z);
          }
        }
        // Oberarme/Oberschenkel schmaler: Punkte an Schulter bzw. Hüfte zur Knochenlinie (Gelenk → nächstes Gelenk) ziehen
        if (UPLEG !== 1) [['L_shoulder', 'L_elbow'], ['R_shoulder', 'R_elbow'], ['L_hip', 'L_knee'], ['R_hip', 'R_knee']].forEach(function (pair) {
          var ka = idx(pair[0]), kb = idx(pair[1]);
          if (ka < 0 || kb < 0) return;
          var A = bindPos[ka], Bp = bindPos[kb], segA = new THREE.Vector3().subVectors(Bp, A), sl = segA.length(); segA.normalize();
          for (var vu = 0; vu < pos.count; vu++) {
            var uw = 0;
            for (var ju = 0; ju < 4; ju++) if (si[GET[ju]](vu) === ka) uw += sw[GET[ju]](vu);
            if (uw < 0.15) continue;
            v.fromBufferAttribute(pos, vu);
            var tS = Math.max(0, Math.min(sl, off.subVectors(v, A).dot(segA)));
            c.copy(A).addScaledVector(segA, tS);
            off.subVectors(v, c).multiplyScalar(1 - (1 - UPLEG) * Math.min(1, uw));
            v.copy(c).add(off); pos.setXYZ(vu, v.x, v.y, v.z);
          }
        });
        pos.needsUpdate = true; geo.computeVertexNormals();
        })();
      });
      // Pinscher-Rute: dünner (nur im Querschnitt). Längsachse = Richtung zum nächsten Glied in lokalen Koordinaten.
      if (TAIL_STRAIGHT && B.tail_1) {
        var tc = B.tail_1.children.filter(function (c) { return c.isBone; })[0];
        if (tc) {
          var lp = tc.position, ax = Math.abs(lp.x) >= Math.abs(lp.y) && Math.abs(lp.x) >= Math.abs(lp.z) ? 'x' : Math.abs(lp.y) >= Math.abs(lp.z) ? 'y' : 'z';
          var sc = { x: TAIL_THIN, y: TAIL_THIN, z: TAIL_THIN }; sc[ax] = 1;
          B.tail_1.scale.set(sc.x, sc.y, sc.z);
        
        }
      }
    }

    function play(name, opts) {
      opts = opts || {};
      var a = actions[name]; if (!a) return;
      a.reset(); a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = !!opts.once; a.play();
      if (cur && cur !== a) cur.crossFadeTo(a, 0.4, false);
      cur = a;
    }
    var tq = new THREE.Quaternion(), pq = new THREE.Quaternion(), ax = new THREE.Vector3();
    function turn(bone, worldAxis, ang) {
      if (!bone || !ang) return;
      bone.parent.getWorldQuaternion(pq); pq.invert();
      ax.copy(worldAxis).applyQuaternion(pq).normalize();
      tq.setFromAxisAngle(ax, ang); bone.quaternion.premultiply(tq);
    }


    function setMode(m) {
      // aus Sitzen/Liegen/… loslaufen: erst aufstehen (Überblenden in die Stehhaltung), dann in Blickrichtung los
      if ((m === 'walk' || m === 'run') && CLIPS[S.mode]) S.rise = S.mode === 'lie' || S.mode === 'roll' ? 0.8 : 0.5;
      S.mode = m;
      if (m === 'walk' || m === 'run' || m === 'idle') play('standing');
      if (m === 'sit') play('sitting');
      if (m === 'shake') play('shake', { once: true });
      if (m === 'roll') play('rollover', { once: true });
      if (m === 'lie') play('play_dead', { once: true });
    }

    // ── Ton: kurzes „Wuff“ (WebAudio), Lautstärke × Settings → Sound ──
    var actx = null, vol = (opt.volume == null ? 0.5 : opt.volume) * (typeof root.__SOUND_LEVEL__ === 'number' ? root.__SOUND_LEVEL__ : 1);
    function woof() {
      if (!opt.sound || vol <= 0) return;
      var C = root.AudioContext || root.webkitAudioContext; if (!C) return;
      actx = actx || new C(); if (actx.state === 'suspended') actx.resume();
      var t0 = actx.currentTime, o = actx.createOscillator(), gn = actx.createGain(), fl = actx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(560, t0); o.frequency.exponentialRampToValueAtTime(280, t0 + 0.15);
      fl.type = 'bandpass'; fl.frequency.value = 950; fl.Q.value = 1.2;
      gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(0.35 * vol, t0 + 0.015); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(fl); fl.connect(gn); gn.connect(actx.destination); o.start(t0); o.stop(t0 + 0.2);
    }
    function bark() { S.bark = 1; S.barkT = 0; woof(); }

    // ── Ablauf: Schritte nacheinander (Reaktionen und eigenes Verhalten) ──
    // goto {x, gait: 'walk'|'run'} · mode {m, dur} · bark {n, gap} · wag {v, dur} · face {hour, dur} · wait {dur}
    var plan = [], step = null, stepT = 0, lastEvent = 0, clockT = 0, roam = opt.roam !== false;
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function hourToward(x) { return x > S.x ? 4 : 8; }
    function startStep(s) {
      step = s; stepT = 0;
      if (s.do === 'goto') { S.dir = s.x > S.x ? 1 : -1; S.face = null; setMode(s.gait || 'walk'); }
      else if (s.do === 'mode') { if (s.face != null) S.face = s.face; setMode(s.m); }
      else if (s.do === 'face') { S.face = s.hour; if (S.mode !== 'sit' && !CLIPS[S.mode]) setMode('idle'); }
      else if (s.do === 'wag') S.wag = s.v;
      else if (s.do === 'bark') { s.left = s.n || 1; s.next = 0; }
    }
    function stepDone(dt) {
      var s = step; stepT += dt;
      if (s.do === 'goto') {
        var reached = S.dir > 0 ? S.x >= s.x : S.x <= s.x;
        if (reached || stepT > 15) { setMode('idle'); return true; }
        return false;
      }
      if (s.do === 'bark') {
        s.next -= dt;
        if (s.next <= 0 && s.left > 0) { bark(); s.left--; s.next = s.gap || 0.45; }
        return s.left <= 0 && s.next <= 0;
      }
      return stepT >= (s.dur || 0);
    }
    function runPlan(dt) {
      clockT += dt;
      if (step && stepDone(dt)) step = null;
      if (!step && plan.length) startStep(plan.shift());
      if (!step && !plan.length && roam) wander();
    }
    // eigenes Verhalten: herumlaufen, schauen, sitzen; nach langer Ruhe hinlegen und schlafen
    function wander() {
      var quiet = clockT - lastEvent;
      if (quiet > 120 && S.mode !== 'lie') { plan.push({ do: 'face', hour: rnd(5, 7), dur: 1 }, { do: 'wag', v: 0, dur: 0 }, { do: 'mode', m: 'lie', dur: rnd(25, 45) }); return; }
      var r = Math.random();
      if (r < 0.45) plan.push({ do: 'goto', x: rnd(area[0], area[1]), gait: 'walk' }, { do: 'wag', v: 0.35, dur: 0 }, { do: 'wait', dur: rnd(3, 7) });
      else if (r < 0.7) plan.push({ do: 'face', hour: rnd(4.5, 7.5), dur: 1.2 }, { do: 'mode', m: 'sit', dur: rnd(7, 14) }, { do: 'mode', m: 'idle', dur: 1 });
      else if (r < 0.85) plan.push({ do: 'face', hour: Math.random() < 0.5 ? rnd(2, 4) : rnd(8, 10), dur: rnd(2, 4) }, { do: 'face', hour: 6, dur: rnd(2, 3) });
      else plan.push({ do: 'wait', dur: rnd(2, 4) });
    }
    // Reaktionen (Vorlagen)
    var PRESETS = {
      happy: function () { return [{ do: 'face', hour: 6, dur: 0.4 }, { do: 'wag', v: 1, dur: 0 }, { do: 'bark', n: 2, gap: 0.4 },
        { do: 'goto', x: clamp(S.x + (S.x > 0 ? -1.4 : 1.4)), gait: 'run' }, { do: 'goto', x: S.x, gait: 'run' },
        { do: 'mode', m: 'sit', face: 6, dur: 4 }, { do: 'wag', v: 0.4, dur: 0 }]; },
      roll: function () { return [{ do: 'face', hour: 6, dur: 0.5 }, { do: 'wag', v: 1, dur: 0 }, { do: 'mode', m: 'roll', dur: clipLen('rollover', 6) },
        { do: 'mode', m: 'idle', dur: 1.5 }, { do: 'wag', v: 0.4, dur: 0 }]; },
      zoomies: function () { return [{ do: 'wag', v: 1, dur: 0 }, { do: 'bark', n: 3, gap: 0.35 }, { do: 'goto', x: area[1], gait: 'run' },
        { do: 'goto', x: area[0], gait: 'run' }, { do: 'goto', x: (area[0] + area[1]) / 2, gait: 'run' }, { do: 'face', hour: 6, dur: 2 }, { do: 'wag', v: 0.4, dur: 0 }]; },
      paw: function () { return [{ do: 'face', hour: 6, dur: 0.6 }, { do: 'wag', v: 0.9, dur: 0 }, { do: 'mode', m: 'shake', face: 6, dur: clipLen('shake', 5) },
        { do: 'mode', m: 'idle', dur: 1 }, { do: 'wag', v: 0.4, dur: 0 }]; },
      bark: function (p) { var tx = p && p.x != null ? p.x : 0; return [{ do: 'face', hour: hourToward(tx), dur: 0.5 }, { do: 'wag', v: 0.7, dur: 0 },
        { do: 'bark', n: p && p.n || 6, gap: 0.6 }, { do: 'wait', dur: 1 }, { do: 'wag', v: 0.4, dur: 0 }]; },
      sit: function () { return [{ do: 'face', hour: 6, dur: 0.6 }, { do: 'mode', m: 'sit', face: 6, dur: 8 }]; },
      pet: function () { return [{ do: 'face', hour: 6, dur: 0.6 }, { do: 'wag', v: 1, dur: 0 }, { do: 'mode', m: 'sit', face: 6, dur: 5 }, { do: 'wag', v: 0.4, dur: 0 }]; },
      none: function () { return []; }
    };
    function clamp(x) { return Math.max(area[0], Math.min(area[1], x)); }
    function clipLen(n, d) { var a = actions[n]; return a ? a.getClip().duration : d; }
    var reactions = {}; Object.keys(DEFAULT_REACTIONS).forEach(function (k) { reactions[k] = (opt.reactions && opt.reactions[k]) || DEFAULT_REACTIONS[k]; });
    function react(event, params) {
      var preset = reactions[event] || 'none', fn = PRESETS[preset];
      if (!fn || preset === 'none') return;
      lastEvent = clockT; plan = fn(params || {}); step = null; S.face = null;
    }
    function act(action, params) {
      params = params || {}; lastEvent = clockT; plan = []; step = null;
      var face = params.face != null ? params.face : null;
      var map = {
        walk: [{ do: 'goto', x: S.x > 0 ? area[0] : area[1], gait: 'walk' }],
        run: [{ do: 'goto', x: S.x > 0 ? area[0] : area[1], gait: 'run' }],
        stand: [{ do: 'mode', m: 'idle', face: face, dur: 6 }],
        sit: [{ do: 'mode', m: 'sit', face: face == null ? 6 : face, dur: 10 }],
        lie: [{ do: 'mode', m: 'lie', face: face, dur: 20 }], sleep: [{ do: 'wag', v: 0, dur: 0 }, { do: 'mode', m: 'lie', face: face, dur: 40 }],
        paw: PRESETS.paw(), roll: PRESETS.roll(), bark: PRESETS.bark({ n: 3 }), wag: [{ do: 'wag', v: 1, dur: 4 }, { do: 'wag', v: 0.4, dur: 0 }],
        turn: [{ do: 'goto', x: clamp(S.x - S.dir * 1.2), gait: 'walk' }],
        come: [{ do: 'goto', x: (area[0] + area[1]) / 2, gait: 'walk' }, { do: 'mode', m: 'sit', face: 6, dur: 6 }]
      };
      plan = (map[action] || []).slice();
      if (face != null && action !== 'sit' && action !== 'stand' && action !== 'lie' && action !== 'sleep') plan.push({ do: 'face', hour: face, dur: 6 });
    }

    var clock = new THREE.Clock(), t = 0;
    function frame() {
      var dt = Math.min(0.05, clock.getDelta()); t += dt;
      if (mixer) runPlan(dt);
      var want = S.mode === 'walk' ? 1 : S.mode === 'run' ? 2 : 0;
      if (S.rise > 0) { S.rise -= dt; want = 0; }          // steht erst auf (Clip blendet in die Stehhaltung über)
      S.gait += (want - S.gait) * Math.min(1, dt * 4);
      var g = S.gait, moving = Math.min(1, g);
      var freq = (1.6 + Math.max(0, g - 1) * 0.5) / Math.sqrt(SIZE), speed = (0.95 * Math.min(1, g) + 2.4 * Math.max(0, g - 1)) * Math.sqrt(SIZE);   // kleiner Hund: schnellere, kürzere Schritte   // Galopp: 2,1 Sprünge/s, langer Sprung
      // Laufen: Er bewegt sich immer in Körperrichtung, die Richtung ändert sich nur begrenzt schnell (wie ein Tier,
      // nicht wie ein Drehteller). Aus jeder Haltung – auch frontal zum Zuschauer – läuft er los und schwenkt im Bogen
      // auf die Laufbahn ein; Wenden ergibt automatisch eine Kehre (über die Seite zum Zuschauer hin).
      // Stand: Blickrichtung nach Uhrzeit (12 = weg, 3 = rechts, 6 = zu dir, 9 = links), beim Drehen tritt er auf der Stelle.
      var h = holder.rotation.y, moveOn = S.gait > 0.15 && S.mode !== 'idle' || (want > 0 && S.gait > 0.05);
      var hour = S.face;
      if (hour == null) hour = S.mode === 'shake' ? 6 : S.mode === 'idle' ? (S.dir > 0 ? 4.5 : 7.5) : (S.dir > 0 ? 3.7 : 8.3);
      var aim;
      if (moveOn) {
        aim = (S.dir > 0 ? 0 : Math.PI) + S.dir * Math.max(-0.5, Math.min(0.5, 0.7 * S.z));   // zurück auf die Laufbahn (z = 0)
      } else aim = -(hour - 3) * Math.PI / 6;
      var dy = Math.atan2(Math.sin(aim - h), Math.cos(aim - h));
      if (Math.abs(dy) > 2.6) dy = (Math.cos(h) > 0 ? -1 : 1) * Math.abs(dy);   // fast entgegengesetzt: über die Zuschauerseite wenden
      var maxRate = moveOn ? 1.1 + 1.0 * speed : 2.2;
      var rate = S.rise > 0 ? 0 : Math.max(-maxRate, Math.min(maxRate, dy * 4));   // beim Aufstehen nicht drehen
      h += rate * dt; holder.rotation.y = h;
      S.yawRate += (rate - S.yawRate) * Math.min(1, dt * 8);
      // im Stand beim Drehen auf der Stelle treten (Beine laufen leicht mit)
      if (!moveOn && Math.abs(rate) > 0.25) g = moving = Math.max(moving, Math.min(0.55, Math.abs(rate) / 3));
      S.phase = (S.phase + dt * (moveOn ? freq : 1.6)) % 1;
      if (moveOn) { S.x += Math.cos(h) * speed * dt; S.z += -Math.sin(h) * speed * dt; }
      // Rand: nie aus dem Bild laufen (Ziele liegen im Bereich; zur Sicherheit wenden)
      if ((S.x > RANGE && S.dir > 0) || (S.x < -RANGE && S.dir < 0)) S.dir *= -1;
      holder.position.x = S.x; holder.position.z = S.z; holder.position.y = 0;   // Höhe setzen Wippen und Bodenklemme jedes Bild neu
      shadow.position.set(S.x, 0.005, S.z);
      if (mixer) {
        // Laufen (Steh-Clip als Basis): Clip aus, jedes Bild ALLE Knochen aus der Grundstellung (erstes Bild des
        // Steh-Clips), dann nur die eigene Bewegung – sonst addieren sich Drehungen auf (gemessen: bis 2,4 rad nach einer Kehre).
        // Stehen und Clips: nur Knochen zurücksetzen, die der laufende Clip nicht selbst schreibt.
        var locomotion = moving > 0.02 && cur === actions.standing;
        if (locomotion) {
          for (var bi = 0; bi < BIND.length; bi++) { BIND[bi][0].quaternion.copy(BIND[bi][1]); BIND[bi][0].position.copy(BIND[bi][2]); }
        } else {
          var act = TRACKED.filter(function (x) { return x[0].isRunning() && x[0].getEffectiveWeight() > 0.001; });
          for (var bj = 0; bj < BIND.length; bj++) {
            var nm = BIND[bj][0].name, driven = false;
            for (var ai = 0; ai < act.length; ai++) if (act[ai][1][nm]) { driven = true; break; }
            if (!driven) { BIND[bj][0].quaternion.copy(BIND[bj][1]); BIND[bj][0].position.copy(BIND[bj][2]); }
          }
          if (cur === actions.standing) cur.timeScale = 1;
          mixer.update(dt);
        }
        holder.updateMatrixWorld(true);
        FWD.set(1, 0, 0).applyAxisAngle(UP, holder.rotation.y);
        LAT.crossVectors(UP, FWD).normalize();
        if (moving > 0.01) legs(S.phase, moving, g);
        var yr = S.yawRate * Math.min(1, moving * 1.5);
        if (Math.abs(yr) > 0.05) {   // Kurve: Rücken und Hals zur Innenseite, der Kopf führt
          turn(B.spine_1, UP, yr * 0.05); turn(B.spine_2, UP, yr * 0.05); turn(B.chest, UP, yr * 0.04);
          turn(B.neck_base, UP, yr * 0.09); turn(B.head, UP, yr * 0.1); turn(B.pelvis, UP, -yr * 0.03);
        }
        // Pinscher-Rute: die 7 Schwanzglieder nacheinander auf eine gerade Linie ausrichten (nach hinten, leicht
        // nach oben), statt des eingerollten Shiba-Ringels. Das Wedeln kommt danach obendrauf.
        if (TAIL_STRAIGHT) {
          holder.updateMatrixWorld(true);
          var tdir = new THREE.Vector3().copy(FWD).multiplyScalar(-Math.cos(TAIL_UP)).addScaledVector(UP, Math.sin(TAIL_UP)).normalize();
          var p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), vq = new THREE.Quaternion(), bw = new THREE.Quaternion(), pw = new THREE.Quaternion();
          for (var ti = 1; ti <= 7; ti++) {
            var tb = B['tail_' + ti], ch = tb && tb.children.filter(function (c) { return c.isBone; })[0];
            if (!ch) continue;
            tb.getWorldPosition(p0); ch.getWorldPosition(p1);
            var v = p1.sub(p0).normalize();
            vq.setFromUnitVectors(v, tdir);
            tb.getWorldQuaternion(bw); tb.parent.getWorldQuaternion(pw);
            tb.quaternion.copy(pw.invert().multiply(vq.multiply(bw)));
            tb.updateMatrixWorld(true);
          }
        }
        var w = S.wag * (1 - 0.4 * moving), wf = 9 + 5 * S.wag;
        if (TAIL_STRAIGHT) {
          // gerade Rute: Schwung aus der Wurzel – breit seitlich, dazu leicht kreisend auf und ab (auch von der Seite sichtbar)
          turn(B.tail_1, UP, Math.sin(t * wf) * 0.75 * w);
          turn(B.tail_1, LAT, Math.cos(t * wf) * 0.3 * w);
          for (var i = 2; i <= 7; i++) turn(B['tail_' + i], UP, Math.sin(t * wf - i * 0.35) * 0.06 * w);   // Peitscheneffekt zur Spitze
        } else {
          for (var i2 = 1; i2 <= 7; i2++) turn(B['tail_' + i2], UP, Math.sin(t * wf - i2 * 0.5) * 0.16 * w);
        }
        if (S.bark > 0) {
          S.barkT += dt; var open = Math.sin(Math.min(1, S.barkT / 0.32) * Math.PI);
          turn(B.jaw, LAT, open * 0.45); turn(B.head, LAT, -open * 0.18); turn(B.neck_base, LAT, -open * 0.1);
          if (S.barkT >= 0.32) S.bark = 0;
        }
        // Kopf zum Zuschauer (Rest der Drehung zur Kamera), im Stehen schaut er sich dabei ein wenig um
        // Kopf nur im Stehen zum Zuschauer drehen; bei Clips (Sitzen, Pfote …) führt der Clip den Kopf
        var look = 0;
        if (S.mode === 'idle') look = (1 - moving) * (-S.dir * 0.3 + Math.sin(t * 0.7) * 0.15 + Math.sin(t * 1.9) * 0.03);
        turn(B.neck_base, UP, look * 0.4); turn(B.head, UP, look * 0.6);
        // Boden: keine Pfote unter dem Boden (der Sitz-Clip drückt ein Hinterbein durch)
        holder.updateMatrixWorld(true);
        var minY = Infinity, wp = new THREE.Vector3();
        FEET.forEach(function (n) { if (B[n]) { B[n].getWorldPosition(wp); if (wp.y < minY) minY = wp.y; } });
        if (minY < 0.01 && moving < 0.05) holder.position.y += 0.01 - minY;   // nur im Stand/bei Clips (in Bewegung wippt der Gang selbst)
      }

      renderer.render(scene, cam);
      requestAnimationFrame(frame);
    }
    // Beine: Trab (diagonale Paare, weich) und Rotary Gallop (nach Hildebrand / Univ. Minnesota „Canine Gaits“):
    // Aufsetzen nacheinander hinten links → hinten rechts → vorne rechts → vorne links, je Bein kurze Stützphase
    // (Duty-Faktor ~0,3), zwei Flugphasen; Rücken krümmt sich (gesammelt, Hinterbeine unter dem Bauch) und streckt sich
    // (Vorderbeine weit vorn); Kopf bleibt ruhig (gleicht den Rücken aus).
    var GAL = { LH: 0.0, RH: 0.1, RF: 0.38, LF: 0.48 }, DUTY = 0.3;
    function gallopLeg(ph) {
      var f = ((ph % 1) + 1) % 1;
      if (f < DUTY) return { sweep: 1 - 2 * (f / DUTY), lift: 0, stance: true };           // vorn aufsetzen (+1) → nach hinten schieben (−1)
      var u = (f - DUTY) / (1 - DUTY);
      return { sweep: -1 + 2 * (0.5 - 0.5 * Math.cos(Math.PI * u)), lift: Math.sin(Math.PI * u), stance: false };   // in der Luft wieder nach vorn
    }
    function legs(p, k, g) {
      // Run = Rotary Gallop; #run-trot zeigt stattdessen den schnellen Trab
      var GALLOP = true, fast = Math.max(0, Math.min(1, g - 1));
      var TWO = Math.PI * 2, r = GALLOP ? fast : 0;
      var At = (0.38 + 0.12 * fast) * k, Ag = 0.5 * k, contacts = 0;
      // sweep > 0 = Bein vorn (gemessen per Pfotenposition). Beim Vorschwingen (Pfote in der Luft) beugen die Gelenke,
      // Richtungen per Messung der Pfotenhöhe gewählt (Vorderpfote hebt ~30 cm, Hinterpfote ~30 cm); im Stand leicht gebeugt.
      var SWEEP_BIAS = { f: 0.1, h: 0.11 };
      var FLEX = { fMid: 0.45, fLow: 0.95, fFoot: 0, hMid: 0.7, hLow: -0.8, hFoot: 0.35 };
      function leg(top, mid, low, foot, trotPh, galKey, front) {
        var ph = TWO * (p + trotPh), s = Math.sin(ph);
        var tl = Math.max(0, Math.cos(ph));                   // in der Luft, während die Pfote nach vorn schwingt (gemessen: Phase 0,75 → 0,25)
        var gl = gallopLeg(p - GAL[galKey]); if (gl.stance) contacts++;
        var sweep = (1 - r) * s * At + r * gl.sweep * Ag;      // + = nach vorn
        var air = ((1 - r) * tl + r * gl.lift) * k;           // 0 … 1: wie weit gebeugt
        var stand = 0.12 * k;                                  // federnde Grundbeugung im Stand
        // Schwung-Mitte so verschoben, dass die Pfoten im Mittel stehen wie im Stand (gemessen: sonst greift vorn
        // 15 cm zu weit nach vorn, hinten 6 cm zu weit nach hinten → wirkt gestreckt und nach vorn gebeugt)
        turn(top, LAT, -(sweep + (front ? SWEEP_BIAS.f : SWEEP_BIAS.h) * k));
        if (front) {
          turn(mid, LAT, FLEX.fMid * (air + stand));
          turn(low, LAT, FLEX.fLow * air);
          // Pfotengelenk vorn nicht zusätzlich drehen (sonst verdreht sich die Pfote)
        } else {
          turn(mid, LAT, FLEX.hMid * (air + stand));
          turn(low, LAT, FLEX.hLow * (air + stand));
          turn(foot, LAT, FLEX.hFoot * air - sweep * 0.25);
        }
      }
      leg(B.L_shoulder, B.L_elbow, B.L_wrist, B.L_hand, 0, 'LF', true);
      leg(B.R_shoulder, B.R_elbow, B.R_wrist, B.R_hand, 0.5, 'RF', true);
      leg(B.R_hip, B.R_knee, B.R_ankle, B.R_foot, 0, 'RH', false);
      leg(B.L_hip, B.L_knee, B.L_ankle, B.L_foot, 0.5, 'LH', false);
      // Rücken: im Galopp krümmen (gesammelt, kurz nach dem Aufsetzen hinten) und strecken (Vorderbeine vorn)
      var flex = Math.cos(TWO * (p - 0.05)) * r;
      turn(B.spine_1, LAT, -0.08 * flex); turn(B.spine_2, LAT, -0.06 * flex); turn(B.chest, LAT, -0.03 * flex);
      turn(B.neck_base, LAT, 0.13 * flex);                      // Kopf ruhig halten
      // Trab: leichtes Wippen und Wiegen
      var bob = Math.sin(TWO * p * 2) * (1 - r);
      turn(B.COG, FWD, Math.sin(TWO * p) * 0.03 * k * (1 - r)); turn(B.spine_1, LAT, bob * 0.02 * k); turn(B.neck_base, LAT, -bob * 0.05 * k);
      // Höhe: Trab wippt; Galopp hebt in den Flugphasen ab (kein Bein am Boden)
      holder.position.y = (Math.abs(bob) * 0.025 * k + r * (contacts === 0 ? 0.07 : contacts === 1 ? 0.025 : 0)) * SIZE;
    }

    ready.then(function () { setMode('idle'); requestAnimationFrame(frame); });
    return { ready: ready, react: react, act: act, setFur: function (k) { FUR_KEY = k; applyFur(k); }, setBody: function (k) { BODY_KEY = k; applyBody(k); } };
  }

  root.FriendDog = { create: create, REACTIONS: Object.keys(DEFAULT_REACTIONS) };
})(window);
