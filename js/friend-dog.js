/* Friend: animierter Hund für OBS (effects/friend.html), three r128 + GLTFLoader.
 * Modell: „Animated Dog, Shiba Inu“ von quander (Sketchfab, CC BY 4.0), umgeformt (schlanker Pinscher-Körperbau,
 * gerade Rute, lange Schnauze) und umgefärbt (Black & tan). Gehen/Traben/Galopp, Kehren und Wedeln sind auf dem
 * Skelett programmiert; Sitzen, Pfote, Rollen und Hinlegen sind die Clips des Modells.
 *
 *   var f = FriendDog.create({ canvas, model, sizePx, fur, body, sound, volume, area, reactions, roam });
 *   f.ready.then(...);  f.react('follow');  f.act('sit', { face: 6 });
 *
 * Verhalten: läuft von sich aus herum, schaut sich um, setzt sich, legt sich nach längerer Ruhe hin (roam=false: steht).
 * Reaktionen (Vorlagen): happy, roll, zoomies, paw, bark, sit, beg, growl, none. Zusatzhaltungen über den Clips (am Skelett):
 * Männchen (beg), Kampfstellung mit Knurren (stance), Ducken (cower), Wasser abschütteln (shakeoff), Strampeln in der Luft
 * (flail). Wetter (weather(kind)): Regen → schütteln, Blitz → ducken, Hagel → wegrennen und ducken, Tornado → wirbelt
 * ihn hoch, Tsunami/Lawine → spült ihn weg, Schnee → Zoomies, Aurora/Regenbogen/Meteore → schaut und wedelt. Blickrichtung nach Uhrzeit (12 = weg, 3 = rechts,
 * 6 = zum Zuschauer, 9 = links). Erkenntnisse (gemessen, nicht raten): siehe Kommentare an Beinen/Kehre/Zurücksetzen.
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  var DEFAULT_REACTIONS = { follow: 'happy', sub: 'roll', resub: 'roll', giftsub: 'roll', raid: 'zoomies', bits: 'paw',
    donation: 'paw', welcome: 'paw', burnout: 'bark', pet: 'pet', fire: 'pee' };

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
    var SNOUT = [];
    function unSnout() { for (var i = 0; i < SNOUT.length; i++) if (SNOUT[i][2]) { SNOUT[i][0].position.sub(SNOUT[i][1]); SNOUT[i][2] = false; } }
    var EAR_FOLD = 0, EAR_BASE = 0.45, EAR_TIP = 1.9;   // Kippwinkel (rad) bei ears=100: Basis nach vorne, Spitze dazu
    var TAIL_SCALE = null, SIZE = 0.6, TAIL_STRAIGHT = true, TAIL_UP = 0.45, TAIL_THIN = 0.5;
    // Körperbau-Vorlagen (Shiba-Modell umgeformt). Jack Russell: kompakt, etwas länger als hoch, kürzeres Bein,
    // Rute aufrecht. Pinscher: schlank, hochbeinig, hochgezogener Bauch, Rute schräg.
    var BODIES = {
      pinscher: { build: { len: 1.02, height: 1.04, width: 0.86 }, slim: { belly: 0.78, chest: 0.86, neck: 0.72 }, tailUp: 0.45, tailThin: 0.28, muzzle: 1.4, headW: 0.8, upperLeg: 0.72, earFold: 0.85 },
      jack: { build: { len: 1.08, height: 0.95, width: 0.9 }, slim: { belly: 0.82, chest: 0.88, neck: 0.78 }, tailUp: 1.0, tailThin: 0.6, muzzle: 1.15, headW: 0.9, upperLeg: 0.85, earFold: 0.85 }
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
    var S = { resume: null, face: null, z: 0, rise: 0, yawRate: 0, mode: 'idle', dir: 1, x: (area[0] + area[1]) / 2, gait: 0, phase: 0, wag: 0.4, bark: 0, barkT: 0,
              pose: null, poseW: 0, growlLeft: 0, growlNext: 0, growlT: 9, fly: null };
    var CLIPS = { sit: 1, shake: 1, roll: 1, lie: 1, beg: 1, hide: 1, lookup: 1 };
    // Zusatzhaltungen am Skelett (über dem Steh- bzw. Sitz-Clip), weich ein- und ausgeblendet
    var POSES = { beg: 1, hide: 1, stance: 1, cower: 1, shakeoff: 1, flail: 1, lookup: 1, test: 1, pee: 1 };
    var SIT_POSES = { beg: 1, hide: 1, lookup: 1 };   // bauen auf der gemerkten Sitzhaltung auf
    var fxg = null;   // Gruppe für Wirbeln (Tornado) zwischen holder und Körper
    // Pinkelstrahl (Feuer löschen): Tropfen auf einer Wurfparabel vom Becken zum Feuer
    var PEE_N = 46, peePos = new Float32Array(PEE_N * 3), peeA = new Float32Array(PEE_N), peeGeo = new THREE.BufferGeometry();
    peeGeo.setAttribute('position', new THREE.BufferAttribute(peePos, 3)); peeGeo.setAttribute('a', new THREE.BufferAttribute(peeA, 1));
    var peeMesh = new THREE.Points(peeGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      uniforms: { s: { value: Math.max(3, (opt.sizePx || 170) / 40) } },
      vertexShader: 'attribute float a; varying float va; uniform float s; void main(){ va = a; gl_PointSize = s * (0.6 + a); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying float va; void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(1.0, 0.86, 0.25, va * (1.0 - r * 1.6)); }' }));
    peeMesh.frustumCulled = false; peeMesh.visible = false; scene.add(peeMesh);
    var FUR_KEY = opt.fur || 'pinscher', BODY_KEY = opt.body || 'pinscher';

    var ready = new Promise(function (resolve, reject) {
      new THREE.GLTFLoader().load(opt.model, function (g) {
        var dog = g.scene;
        var box = new THREE.Box3().setFromObject(dog), size = box.getSize(new THREE.Vector3());
        dog.scale.setScalar(1.25 * SIZE / size.y);
        box.setFromObject(dog); dog.position.y -= box.min.y; dog.position.x -= (box.min.x + box.max.x) / 2; dog.position.z -= (box.min.z + box.max.z) / 2;
        var inner = new THREE.Group(); inner.add(dog);
        buildGroup = new THREE.Group(); buildGroup.add(inner);   // Körperbau: in Hund-Achsen (x vorn, y hoch, z quer)
        fxg = new THREE.Group(); fxg.add(buildGroup); holder.add(fxg);
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
      var bd = BODIES[key] || BODIES.pinscher; BUILD = bd.build; SLIM = bd.slim; TAIL_UP = bd.tailUp; TAIL_THIN = bd.tailThin; MUZZLE = bd.muzzle || 1; HEADW = bd.headW || 1; UPLEG = bd.upperLeg || 1; EAR_FOLD = opt.ears != null ? opt.ears : (bd.earFold || 0);
      if (buildGroup) buildGroup.scale.set(BUILD.len, BUILD.height, BUILD.width);
      unSnout(); SNOUT.length = 0;
      slimMeshes.forEach(function (m) {
        var o = m.o; o.geometry.attributes.position.array.set(m.orig);
        (function () {
        var geo = o.geometry, pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, bones = o.skeleton.bones;
        if (!m.inv0) m.inv0 = o.skeleton.boneInverses.map(function (mx) { return mx.clone(); });   // Original-Bind (setBody mehrfach)
        o.skeleton.boneInverses.forEach(function (mx, k) { mx.copy(m.inv0[k]); });
        var bindW = m.inv0.map(function (mx) { return mx.clone().invert(); });
        var bindPos = bindW.map(function (mx) { return new THREE.Vector3().setFromMatrixPosition(mx); });
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
          // Knochen im Kopf genauso verschieben wie die Punkte (sonst drehen Zunge/Kiefer um Gelenke, die mitten in der
          // verlängerten Schnauze liegen, und die Zunge hängt beim Hecheln durch den Unterkiefer): neue Ruhelage,
          // neue Bind-Matrizen; der Versatz der lokalen Position kommt jedes Bild nach Mixer/Zurücksetzen dazu (SNOUT),
          // so bleiben Clip-Bewegungen dieser Knochen erhalten.
          var newW = bindW.map(function (mx) { return mx.clone(); }), moved = {};
          bones.forEach(function (bn, k) {
            if (!/^tongue_\d/.test(bn.name)) return;   // nur die Zunge: alles andere im Kopf passt, Stirn/Brauen verschieben gab Grafikfehler
            var bp = bindPos[k], nv = bp.clone();
            var sd = off.subVectors(nv, hp).dot(latAx);
            nv.addScaledVector(latAx, -sd * (1 - HEADW) * (EARS[k] ? 0 : 1));
            var pb = off.subVectors(nv, hp).dot(fa);
            if (pb > d0) nv.addScaledVector(fa, (pb - d0) * (MUZZLE - 1));
            if (nv.distanceToSquared(bp) < 1e-10) return;
            newW[k].setPosition(nv); moved[k] = 1;
          });
          bones.forEach(function (bn, k) {
            if (!moved[k]) return;
            o.skeleton.boneInverses[k].copy(newW[k]).invert();
            var pk = bones.indexOf(bn.parent);
            if (pk < 0) return;
            var lp = new THREE.Vector3().setFromMatrixPosition(newW[k]).applyMatrix4(newW[pk].clone().invert());
            for (var bb = 0; bb < BIND.length; bb++) if (BIND[bb][0] === bn) SNOUT.push([bn, lp.sub(BIND[bb][2]), false]);   // Versatz zur Ruhelage
          });
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
        // Pinscher-Rute: dünn und rund. Punkte der Schwanzglieder zur Knochenlinie (tail_1 → … → tail_7, verlängert)
        // ziehen, zur Spitze hin etwas mehr. Bewusst im Mesh statt per Knochen-Skalierung: ungleich skalierte Eltern
        // scheren die gedrehten Glieder dahinter platt.
        if (TAIL_THIN !== 1) {
          var tk = [], TAILK = {};
          for (var tn = 1; tn <= 7; tn++) { var kk = idx('tail_' + tn); if (kk >= 0) { tk.push(bindPos[kk]); TAILK[kk] = 1; } }
          if (tk.length >= 2) {
            var lastSeg = new THREE.Vector3().subVectors(tk[tk.length - 1], tk[tk.length - 2]);
            tk.push(tk[tk.length - 1].clone().add(lastSeg));
            var cum = [0]; for (var ci = 1; ci < tk.length; ci++) cum.push(cum[ci - 1] + tk[ci].distanceTo(tk[ci - 1]));
            var total = cum[cum.length - 1], seg = new THREE.Vector3(), best = new THREE.Vector3();
            for (var vt = 0; vt < pos.count; vt++) {
              var tw = 0;
              for (var jt = 0; jt < 4; jt++) if (TAILK[si[GET[jt]](vt)]) tw += sw[GET[jt]](vt);
              if (tw < 0.05) continue;
              v.fromBufferAttribute(pos, vt);
              var bd2 = Infinity, bt = 0;
              for (var sgi = 0; sgi < tk.length - 1; sgi++) {
                seg.subVectors(tk[sgi + 1], tk[sgi]); var sl2 = seg.lengthSq();
                var tt = sl2 > 0 ? Math.max(0, Math.min(1, off.subVectors(v, tk[sgi]).dot(seg) / sl2)) : 0;
                c.copy(tk[sgi]).addScaledVector(seg, tt); var dd = c.distanceToSquared(v);
                if (dd < bd2) { bd2 = dd; best.copy(c); bt = (cum[sgi] + tt * Math.sqrt(sl2)) / total; }
              }
              var thin = TAIL_THIN * (1 - 0.35 * bt);                // zur Spitze hin schlanker
              off.subVectors(v, best).multiplyScalar(1 - (1 - thin) * Math.min(1, tw));
              v.copy(best).add(off); pos.setXYZ(vt, v.x, v.y, v.z);
            }
          }
        }
        // Kippohr knickt bei ~20 % der Ohrlänge (nah am Kopf), nicht erst an der Spitze: das Spitzengelenk des Modells
        // dorthin verlegen (neue Ruhelage + Bind) und die Gewichte am Ohr weich zwischen Basis und Spitze neu verteilen
        ['L', 'R'].forEach(function (sd) {
          var kb = idx(sd + '_ear_base'), kt = idx(sd + '_ear_tip');
          if (kb < 0 || kt < 0) return;
          var tipB = bones[kt], endB = tipB.children.filter(function (c) { return c.isBone; })[0];
          var A = bindPos[kb], E = endB ? endB.position.clone().applyMatrix4(bindW[kt]) : bindPos[kt].clone().sub(A).multiplyScalar(1.6).add(A);
          var ax = E.clone().sub(A), len = ax.length(); if (len < 1e-6) return; ax.normalize();
          var Pn = A.clone().addScaledVector(ax, len * 0.2);
          for (var ve = 0; ve < pos.count; ve++) {
            var sb = -1, st = -1, wb2 = 0, wt2 = 0, low = -1, lowW = 9;
            for (var je2 = 0; je2 < 4; je2++) {
              var bi3 = si[GET[je2]](ve), ww3 = sw[GET[je2]](ve);
              if (bi3 === kb) { sb = je2; wb2 += ww3; } else if (bi3 === kt) { st = je2; wt2 += ww3; } else if (ww3 < lowW) { lowW = ww3; low = je2; }
            }
            var sum = wb2 + wt2; if (sum < 0.02) continue;
            v.fromBufferAttribute(pos, ve);
            var fr = off.subVectors(v, A).dot(ax) / len, ft = Math.max(0, Math.min(1, (fr - 0.12) / 0.14)); ft = ft * ft * (3 - 2 * ft);
            if (st < 0) { if (sb >= 0 && wb2 >= sum - 1e-6 && low >= 0 && lowW < 0.02) st = low; else continue; si['set' + 'XYZW'[st]](ve, kt); }
            if (sb < 0) { sb = (low >= 0 && low !== st) ? low : -1; if (sb < 0) continue; si['set' + 'XYZW'[sb]](ve, kb); }
            sw['set' + 'XYZW'[sb]](ve, sum * (1 - ft)); sw['set' + 'XYZW'[st]](ve, sum * ft);
          }
          si.needsUpdate = true; sw.needsUpdate = true;
          var nw = bindW[kt].clone(); nw.setPosition(Pn); o.skeleton.boneInverses[kt].copy(nw).invert();
          var lp = Pn.clone().applyMatrix4(bindW[kb].clone().invert());
          if (SNOUT.some(function (e) { return e[0] === tipB; })) return;   // mehrere Meshes teilen das Skelett
          for (var bb2 = 0; bb2 < BIND.length; bb2++) if (BIND[bb2][0] === tipB) SNOUT.push([tipB, lp.clone().sub(BIND[bb2][2]), false]);
        });
        pos.needsUpdate = true; geo.computeVertexNormals();
        })();
      });
      TAIL_SCALE = !!B.tail_1;   // Schwanzglieder jedes Bild auf Maßstab 1 (Clips haben eigene Skalierungsspuren)
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


    function setMode(m, keep) {
      if (!keep) S.resume = null;   // neuer Befehl: angefangenes „aufstehen, drehen, wieder hinsetzen“ verwerfen
      // hinsetzen/hinlegen mit Blickrichtung, steht aber anders: erst im Stand drehen, dann absetzen
      if ((m === 'sit' || m === 'lie') && S.face != null && holder) {
        var d0 = -(S.face - 3) * Math.PI / 6 - holder.rotation.y;
        if (Math.abs(Math.atan2(Math.sin(d0), Math.cos(d0))) > 0.35) { if (CLIPS[S.mode]) S.rise = S.mode === 'lie' || S.mode === 'roll' ? 0.8 : 0.5; S.resume = m; m = 'idle'; }
      }
      // aus Sitzen/Liegen/… loslaufen: erst aufstehen (Überblenden in die Stehhaltung), dann in Blickrichtung los
      if ((m === 'walk' || m === 'run') && CLIPS[S.mode]) S.rise = S.mode === 'lie' || S.mode === 'roll' ? 0.8 : 0.5;
      S.mode = m;
      if (POSES[m]) S.pose = m;
      if (m === 'walk' || m === 'run' || m === 'idle' || m === 'stance' || m === 'cower' || m === 'shakeoff' || m === 'flail' || m === 'test' || m === 'pee') play('standing');
      if (m === 'sit' || SIT_POSES[m]) play('sitting');
      if (m === 'shake') play('shake', { once: true });
      if (m === 'roll') play('rollover', { once: true });
      if (m === 'lie') play('play_dead', { once: true });
    }

    // ── Ton: kurzes „Wuff“ (WebAudio), Lautstärke × Settings → Sound ──
    var actx = null, vol = (opt.volume == null ? 0.5 : opt.volume) * (typeof root.__SOUND_LEVEL__ === 'number' ? root.__SOUND_LEVEL__ : 1);
    // Echtes Bellen (opt.barkSound, assets/friend/bark.mp3), leicht variierte Tonhöhe, damit Serien nicht gleich klingen;
    // ohne Datei oder bei Ladefehler das synthetische „Wuff“.
    var barkSrc = opt.barkSound || null, barkOk = !!barkSrc;
    function woof() {
      if (!opt.sound || vol <= 0) return;
      if (barkOk) {
        var a = new Audio(barkSrc); a.volume = Math.min(1, vol);
        a.preservesPitch = false; a.mozPreservesPitch = false; a.playbackRate = 0.94 + Math.random() * 0.14;
        a.onerror = function () { barkOk = false; };
        var pr = a.play(); if (pr && pr.catch) pr.catch(function () { /* Browser ohne Klick: stumm */ });
        return;
      }
      var C = root.AudioContext || root.webkitAudioContext; if (!C) return;
      actx = actx || new C(); if (actx.state === 'suspended') actx.resume();
      var t0 = actx.currentTime, o = actx.createOscillator(), gn = actx.createGain(), fl = actx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(560, t0); o.frequency.exponentialRampToValueAtTime(280, t0 + 0.15);
      fl.type = 'bandpass'; fl.frequency.value = 950; fl.Q.value = 1.2;
      gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(0.35 * vol, t0 + 0.015); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(fl); fl.connect(gn); gn.connect(actx.destination); o.start(t0); o.stop(t0 + 0.2);
    }
    function bark() { S.bark = 1; S.barkT = 0; woof(); }
    // Knurren (opt.growlSound, CC0 „Dog Growl“ von bonebrah, OpenGameArt): kurze Stöße, leicht variiert
    var growlSrc = opt.growlSound || null;
    function growl() {
      S.growlT = 0;
      if (!opt.sound || vol <= 0 || !growlSrc) return;
      var a = new Audio(growlSrc); a.volume = Math.min(1, vol * 0.9);
      a.preservesPitch = false; a.mozPreservesPitch = false; a.playbackRate = 0.85 + Math.random() * 0.15;
      var pr = a.play(); if (pr && pr.catch) pr.catch(function () {});
    }

    // ── Ablauf: Schritte nacheinander (Reaktionen und eigenes Verhalten) ──
    // goto {x, gait: 'walk'|'run'} · mode {m, dur, growl} · bark {n, gap} · wag {v, dur} · face {hour, dur} · wait {dur}
    // fly {kind: 'tornado'|'tsunami', dur, dir}: hochgewirbelt bzw. weggespült (Versatz über der normalen Position)
    var plan = [], step = null, stepT = 0, lastEvent = 0, clockT = 0, roam = opt.roam !== false;
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function hourToward(x) { return x > S.x ? 4 : 8; }
    function startStep(s) {
      step = s; stepT = 0;
      if (s.do === 'goto') { S.dir = s.x > S.x ? 1 : -1; S.face = null; setMode(s.gait || 'walk'); }
      else if (s.do === 'mode') { if (s.face != null) S.face = s.face; setMode(s.m); if (s.growl) { S.growlLeft = s.growl; S.growlNext = 0.2; } }
      else if (s.do === 'call') { try { s.fn(); } catch (e) { console.error('[friend]', e); } }
      else if (s.do === 'fly') {
        var dir = s.dir || (S.x > 0 ? -1 : 1);
        S.fly = { kind: s.kind, t0: t, dur: s.dur || 3, x0: S.x, dir: dir,
                  dist: s.kind === 'tsunami' ? Math.min(2.6, Math.abs((dir > 0 ? area[1] : area[0]) - S.x)) : 0 };
        S.face = null; setMode('flail');
      }
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
      if (s.do === 'fly' && stepT >= (s.dur || 3)) {
        if (S.fly && S.fly.kind === 'tsunami') S.x = S.fly.x0 + S.fly.dir * S.fly.dist;   // bleibt, wo die Welle ihn abgesetzt hat
        S.fly = null; if (fxg) fxg.rotation.set(0, 0, 0);
        setMode('idle'); return true;
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
      beg: function (f) { f = typeof f === 'number' ? f : 6; return [{ do: 'face', hour: f, dur: 0.6 }, { do: 'wag', v: 1, dur: 0 }, { do: 'mode', m: 'sit', face: f, dur: 0.8 },
        { do: 'mode', m: 'beg', face: f, dur: 5 }, { do: 'mode', m: 'sit', face: f, dur: 1.5 }, { do: 'wag', v: 0.4, dur: 0 }]; },
      growl: function (f) { f = typeof f === 'number' ? f : 6; return [{ do: 'face', hour: f, dur: 0.5 }, { do: 'wag', v: 0, dur: 0 }, { do: 'mode', m: 'stance', dur: 4.5, growl: 4 },
        { do: 'bark', n: 2, gap: 0.35 }, { do: 'mode', m: 'idle', dur: 1 }, { do: 'wag', v: 0.4, dur: 0 }]; },
      // Heldentat: zum Feuer rennen, Hinterteil hin, Bein heben, löschen, stolz bellen
      pee: function (p) {
        if (!p || p.x == null) return [];
        // Wie ein Rüde an einem Pfosten: mit der Flanke neben das Feuer, Bein auf der Feuerseite heben, Strahl aus der
        // Leiste im Bogen zum Feuer. Rücken schräg zum Zuschauer (11 bzw. 1 Uhr), damit man Bein und Strahl sieht.
        // Mehrere Feuer: unter allen das nächste nehmen, das er erreicht, ohne an einem anderen vorbeizulaufen, und eine
        // Seite, an der kein anderes brennt (sonst verbrennt er sich). Geht nichts davon, bellt er nur.
        var toU = function (v) { return (parseFloat(v) - W / 2) / pxPerUnit; };
        var all = [parseFloat(p.x)].concat(String(p.others || '').split(',').filter(Boolean).map(parseFloat)).filter(function (v) { return !isNaN(v); });
        var near = 170 / pxPerUnit, pass = 140 / pxPerUnit, plan = null;
        all.map(function (px) { return { px: px, x: toU(px) }; })
          .sort(function (a, b) { return Math.abs(a.x - S.x) - Math.abs(b.x - S.x); })
          .some(function (f) {
            var others = all.filter(function (v) { return v !== f.px; }).map(toU);
            var ok = function (x) {
              var a = Math.min(S.x, x), b = Math.max(S.x, x);
              return x >= -RANGE && x <= RANGE && others.every(function (o) { return Math.abs(o - x) > near && (o < a - pass || o > b + pass); });
            };
            var d = (S.x < f.x ? [-1, 1] : [1, -1]).filter(function (dd) { return ok(f.x + dd * 0.8); })[0];
            if (d) plan = { fire: f, side: d };
            return !!plan;
          });
        if (!plan) return [{ do: 'face', hour: 6, dur: 0.3 }, { do: 'bark', n: 3, gap: 0.3 }, { do: 'wag', v: 0.4, dur: 0 }];
        var fx = plan.fire.x, fpx = plan.fire.px, right = plan.side < 0, stand = fx + plan.side * 0.8;   // Abstand: Strahl im weiten Bogen
        return [{ do: 'wag', v: 1, dur: 0 }, { do: 'bark', n: 1, gap: 0.3 }, { do: 'goto', x: stand, gait: 'run' },
          // erst fertig umdrehen, sonst Bein und Strahl auf der falschen Seite
          { do: 'face', hour: right ? 11.3 : 12.7, dur: 1.4 },
          { do: 'call', fn: function () { S.peeX = fx; S.peeSide = right ? 'R' : 'L'; } },
          { do: 'mode', m: 'pee', dur: 3.2 }, { do: 'call', fn: function () { S.peeX = null; if (opt.onExtinguish) opt.onExtinguish(fpx); } },
          { do: 'mode', m: 'idle', face: 6, dur: 0.5 }, { do: 'bark', n: 2, gap: 0.4 }, { do: 'wag', v: 1, dur: 2 }, { do: 'wag', v: 0.4, dur: 0 }];
      },
      shakeoff: function (f) { f = typeof f === 'number' ? f : 6; return [{ do: 'face', hour: f, dur: 0.5 }, { do: 'mode', m: 'shakeoff', dur: 1.6 }, { do: 'mode', m: 'idle', dur: 0.6 }]; },
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
        playdead: [{ do: 'face', hour: 6, dur: 0.5 }, { do: 'wag', v: 0, dur: 0 }, { do: 'mode', m: 'lie', dur: 8 }, { do: 'mode', m: 'idle', dur: 1 }, { do: 'wag', v: 0.4, dur: 0 }],
        hide: [{ do: 'face', hour: face == null ? 6 : face, dur: 0.3 }, { do: 'mode', m: 'sit', face: face == null ? 6 : face, dur: 0.7 },
          { do: 'mode', m: 'hide', face: face == null ? 6 : face, dur: 6 }, { do: 'mode', m: 'idle', dur: 0.6 }],
        beg: PRESETS.beg(face), growl: PRESETS.growl(face), shakeoff: PRESETS.shakeoff(face),
        turn: [{ do: 'goto', x: clamp(S.x - S.dir * 1.2), gait: 'walk' }],
        come: [{ do: 'goto', x: (area[0] + area[1]) / 2, gait: 'walk' }, { do: 'mode', m: 'sit', face: 6, dur: 6 }],
        test: [{ do: 'mode', m: 'test', face: face == null ? 3 : face, dur: 60 }]
      };
      plan = (map[action] || []).slice();
      if (face != null && action !== 'sit' && action !== 'stand' && action !== 'lie' && action !== 'sleep') plan.push({ do: 'face', hour: face, dur: 6 });
    }

    // Wetter: was der Hund bei welchem Wetter-Befehl tut (weather.html bekommt dieselben Befehle)
    function weather(kind, p) {
      p = p || {};
      var edge = S.x > 0 ? area[1] : area[0], seq = null;
      if (kind === 'rain' || kind === 'drizzle' || kind === 'storm' || kind === 'sleet') seq = [{ do: 'wait', dur: 2.5 }].concat(PRESETS.shakeoff(), [{ do: 'wait', dur: 4 }], PRESETS.shakeoff());
      else if (kind === 'strike') seq = [{ do: 'mode', m: 'cower', dur: 2 }, { do: 'mode', m: 'idle', dur: 0.8 }];
      else if (kind === 'megabolt' || kind === 'ballbolt') seq = [{ do: 'face', hour: 6, dur: 0.3 }, { do: 'mode', m: 'sit', face: 6, dur: 0.7 },
        { do: 'mode', m: 'hide', face: 6, dur: 6 }, { do: 'mode', m: 'sit', face: 6, dur: 1 }, { do: 'mode', m: 'idle', dur: 0.6 }];
      else if (kind === 'hail') seq = [{ do: 'goto', x: edge, gait: 'run' }, { do: 'face', hour: 6, dur: 0.3 }, { do: 'mode', m: 'cower', dur: 5 }, { do: 'mode', m: 'idle', dur: 1 }];
      else if (kind === 'tornado') seq = [{ do: 'face', hour: 6, dur: 0.3 }, { do: 'mode', m: 'cower', dur: 1.4 }, { do: 'fly', kind: 'tornado', dur: 3.6 },
        { do: 'mode', m: 'shakeoff', dur: 1.4 }, { do: 'mode', m: 'idle', face: 6, dur: 0.4 }, { do: 'bark', n: 2, gap: 0.45 }, { do: 'wait', dur: 0.6 }];
      else if (kind === 'tsunami' || kind === 'avalanche') {
        // Herkunft der Welle (vom Server, gleich wie im Wetter): weggespült wird er von ihr weg; die Front erreicht ihn
        // je nach Abstand zur Herkunftsseite (Tsunami: 1,8 s Rückzug, dann 4,6 s Lauf über das Bild)
        var from = p.side === 'right' ? -1 : p.side === 'left' ? 1 : (Math.random() < 0.5 ? 1 : -1);
        var sx = (S.x / halfW + 1) / 2, reach = from > 0 ? sx : 1 - sx;
        var arrive = kind === 'tsunami' ? 1.8 + 4.6 * Math.min(1, reach * 1.2) : 1.4 + 5 * reach;
        seq = [{ do: 'face', hour: from > 0 ? 9 : 3, dur: 0.4 }, { do: 'wait', dur: Math.max(0, arrive - 1.6) }, { do: 'mode', m: 'cower', dur: 1.2 },
          { do: 'fly', kind: 'tsunami', dur: 3.2, dir: from }, { do: 'mode', m: 'shakeoff', dur: 1.6 }, { do: 'mode', m: 'idle', dur: 0.6 }];
      }
      else if (kind === 'snow' || kind === 'blizzard') seq = PRESETS.zoomies();
      else if (kind === 'aurora' || kind === 'rainbow') seq = [{ do: 'face', hour: 6, dur: 0.5 }, { do: 'wag', v: 1, dur: 0 }, { do: 'mode', m: 'sit', face: 6, dur: 0.8 },
        { do: 'mode', m: 'lookup', face: 6, dur: 6 }, { do: 'mode', m: 'sit', face: 6, dur: 1 }, { do: 'wag', v: 0.4, dur: 0 }];
      else if (kind === 'meteors') seq = [{ do: 'face', hour: 6, dur: 0.4 }, { do: 'mode', m: 'sit', face: 6, dur: 0.6 }, { do: 'mode', m: 'lookup', face: 6, dur: 1.5 },
        { do: 'bark', n: 4, gap: 0.5 }, { do: 'mode', m: 'lookup', face: 6, dur: 3 }, { do: 'mode', m: 'sit', face: 6, dur: 1 }];
      if (!seq) return;
      lastEvent = clockT; plan = seq; step = null; S.face = null;
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
      var hm = S.resume || S.mode;
      if (hour == null) hour = hm === 'shake' ? 6 : hm === 'idle' ? (S.dir > 0 ? 4.5 : 7.5) : (S.dir > 0 ? 3.7 : 8.3);
      var aim;
      if (moveOn) {
        aim = (S.dir > 0 ? 0 : Math.PI) + S.dir * Math.max(-0.5, Math.min(0.5, 0.7 * S.z));   // zurück auf die Laufbahn (z = 0)
      } else aim = -(hour - 3) * Math.PI / 6;
      var dy = Math.atan2(Math.sin(aim - h), Math.cos(aim - h));
      if (Math.abs(dy) > 2.6) dy = (Math.cos(h) > 0 ? -1 : 1) * Math.abs(dy);   // fast entgegengesetzt: über die Zuschauerseite wenden
      // Drehen aus dem Sitzen/Liegen: erst aufstehen, im Stand drehen, dann wieder hinsetzen/hinlegen.
      // Während anderer Clips (Rollen, Pfote) gar nicht drehen – sonst laufen Beine und Rücken über die Clip-Haltung (Knoten).
      if (!moveOn && (S.mode === 'sit' || S.mode === 'lie') && S.face != null && Math.abs(dy) > 0.35) {
        var back = S.mode; setMode('idle'); S.resume = back; S.rise = back === 'lie' ? 0.8 : 0.5;
      } else if (S.resume && S.mode === 'idle' && S.rise <= 0 && Math.abs(dy) < 0.08) setMode(S.resume);
      var inClip = !moveOn && CLIPS[S.mode];
      var maxRate = moveOn ? 1.1 + 1.0 * speed : 2.2;
      var rate = S.rise > 0 || inClip ? 0 : Math.max(-maxRate, Math.min(maxRate, dy * 4));   // beim Aufstehen nicht drehen
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
        unSnout();   // Schnauzen-Versatz vom letzten Bild zurücknehmen (Knochen ohne Positionsspur würden sonst aufaddieren)
        // Haltungen im Stand (Kampfstellung, Ducken, Schütteln, Strampeln) wie das Laufen: alle Knochen aus der Grundstellung,
        // sonst addieren sich die Drehungen Bild für Bild auf (gemessen: Vorderbein nach 1 s senkrecht nach oben)
        var standPose = POSES[S.mode] && !SIT_POSES[S.mode] || (S.poseW > 0.01 && !SIT_POSES[S.pose] && !CLIPS[S.mode]);
        var locomotion = (moving > 0.02 || standPose) && cur === actions.standing;
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
          // Männchen baut auf der Sitzhaltung auf; der Sitz-Clip ist ein Standbild (Länge 0) und wird nicht jedes Bild neu
          // geschrieben – deshalb die Sitzhaltung einmal merken und jedes Bild wiederherstellen (sonst addiert sich die Pose auf)
          if (SIT_POSES[S.mode] || (SIT_POSES[S.pose] && S.poseW > 0.01)) {
            if (!S.begSnap) S.begSnap = BIND.map(function (b) { return [b[0].quaternion.clone(), b[0].position.clone()]; });
            else for (var bs = 0; bs < BIND.length; bs++) { BIND[bs][0].quaternion.copy(S.begSnap[bs][0]); BIND[bs][0].position.copy(S.begSnap[bs][1]); }
          } else S.begSnap = null;
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
        // Die Clips (Stehen, Rollen, Totstellen) haben eigene Skalierungsspuren für alle Schwanzglieder und machen
        // die Rute sonst nach dem ersten Bild wieder buschig: jedes Bild nach dem Mixer alle Glieder auf Maßstab 1 (dünn ist das Mesh).
        // Kippohren (Pinscher): obere Ohrhälfte (Glied ear_tip) nach vorne-unten abknicken, leicht nach außen.
        // Jedes Bild nach dem Mixer, weil alle Clips eigene Ohrspuren haben; die Bewegung der Clips bleibt erhalten.
        for (var sni = 0; sni < SNOUT.length; sni++) { SNOUT[sni][0].position.add(SNOUT[sni][1]); SNOUT[sni][2] = true; }
        if (EAR_FOLD > 0) {
          // Kippohr: ganzes Ohr an der Basis nach vorne kippen (um die Querachse, UP → FWD), Spitze weiter nach vorne-unten
          // knicken. Das Spitzenglied allein bewegt nur das letzte Stück und lässt einen Zacken stehen.
          // Nicht jeder Clip hat Ohrspuren (Totstellen nicht): dann schreibt der Mixer die Ohren nicht neu und der Knick
          // addiert sich jedes Bild auf – die Ohren flattern. Steht noch unser Ergebnis vom letzten Bild drin, erst zurücksetzen.
          if (!S.earQ) S.earQ = {};
          ['L', 'R'].forEach(function (sd) {
            ['_ear_base', '_ear_tip'].forEach(function (part, pi) {
              var eb = B[sd + part]; if (!eb) return;
              var mem = S.earQ[sd + part];
              if (mem && eb.quaternion.equals(mem[1])) eb.quaternion.copy(mem[0]);
              var pre = eb.quaternion.clone();
              turn(eb, LAT, (pi ? EAR_TIP : EAR_BASE) * EAR_FOLD);
              S.earQ[sd + part] = [pre, eb.quaternion.clone()];
            });
          });
        }
        if (TAIL_SCALE) {
          for (var tsi = 1; tsi <= 7; tsi++) if (B['tail_' + tsi]) B['tail_' + tsi].scale.set(1, 1, 1);
        }
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
        // Zusatzhaltungen (weich ein-/ausgeblendet), Knurren
        S.poseW += ((POSES[S.mode] ? 1 : 0) - S.poseW) * Math.min(1, dt * 6);
        if (S.poseW > 0.01 && S.pose) pose(S.pose, S.poseW);
        if (S.growlLeft > 0) { S.growlNext -= dt; if (S.growlNext <= 0) { growl(); S.growlLeft--; S.growlNext = 0.9 + Math.random() * 0.3; } }
        S.growlT += dt;
        // Strahl: vom Becken (etwas hinter der Mitte, Höhe der Hüfte) im Bogen zum Feuer am Boden
        peeMesh.visible = S.mode === 'pee' && S.poseW > 0.6 && S.peeX != null;
        if (peeMesh.visible) {
          // Leiste: vor dem Becken unter dem Bauch, zur Feuerseite hin
          var p0 = new THREE.Vector3(), gr = new THREE.Vector3(); B.pelvis.getWorldPosition(p0);
          B[(S.peeSide === 'R' ? 'L' : 'R') + '_hip'].getWorldPosition(gr);   // Hüfte des Standbeins: Höhe der Leiste
          p0.addScaledVector(FWD, 0.14); p0.y = Math.max(0.06, gr.y - 0.22);   // ≈ 20 px tiefer als zuvor (bei Standardgröße 170)
          p0.addScaledVector(LAT, (S.peeSide === 'R' ? -1 : 1) * 0.07);
          var p1 = new THREE.Vector3(S.peeX, 0.04, 0), hgt = 0.16 + Math.abs(p1.x - p0.x) * 0.4;   // Feuer liegt auf der Bildebene (z = 0)
          for (var pi = 0; pi < PEE_N; pi++) {
            var u = (pi / PEE_N + t * 1.7) % 1;
            peePos[pi * 3] = p0.x + (p1.x - p0.x) * u; peePos[pi * 3 + 1] = p0.y + (p1.y - p0.y) * u + 4 * hgt * u * (1 - u) * 0.6; peePos[pi * 3 + 2] = p0.z + (p1.z - p0.z) * u;
            peeA[pi] = 0.75 * Math.min(1, u * 6) * Math.min(1, (1 - u) * 8 + 0.3);
          }
          peeGeo.attributes.position.needsUpdate = peeGeo.attributes.a.needsUpdate = true;
        }
        // gebeugte Steh-Haltungen: Rumpf so kippen, dass Vorder- und Hinterpfoten gleich hoch stehen (Beine beugen allein
        // hebt nur Pfoten an – gemessen: Hinterpfoten 15 cm in der Luft, Vorderpfoten am Boden)
        if (S.poseW > 0.05 && S.pose && POSES[S.pose] && !SIT_POSES[S.pose] && S.pose !== 'flail' && S.pose !== 'shakeoff' && S.pose !== 'pee' && !S.fly) levelFeet();
        // Boden: keine Pfote unter dem Boden (der Sitz-Clip drückt ein Hinterbein durch)
        holder.updateMatrixWorld(true);
        var minY = Infinity, wp = new THREE.Vector3();
        FEET.forEach(function (n) { if (B[n]) { B[n].getWorldPosition(wp); if (wp.y < minY) minY = wp.y; } });
        if (minY < 0.01 && moving < 0.05) holder.position.y += 0.01 - minY;   // nur im Stand/bei Clips (in Bewegung wippt der Gang selbst)
        // gebeugte Haltungen im Stand (Ducken): Körper sinkt, bis die Pfoten am Boden stehen (sonst schwebt er mit angezogenen Beinen)
        else if (minY > 0.01 && moving < 0.05 && S.poseW > 0.05 && S.pose && !SIT_POSES[S.pose] && !S.fly) holder.position.y -= (minY - 0.01) * Math.min(1, S.poseW * 1.5);
      }
      // Tornado: hochgewirbelt (dreht sich, kippt), fällt zurück · Tsunami: auf der Welle seitlich weggetragen, wippt
      if (S.fly && fxg) {
        var fu = Math.min(1, (t - S.fly.t0) / S.fly.dur), lift;
        if (S.fly.kind === 'tornado') {
          lift = Math.pow(Math.sin(Math.PI * fu), 0.8) * visH * 0.45;
          fxg.rotation.set(Math.sin(t * 5) * 0.5 * Math.sin(Math.PI * fu), t * 9 * Math.sin(Math.PI * fu), Math.cos(t * 4) * 0.4 * Math.sin(Math.PI * fu));
          holder.position.x += Math.sin(t * 3) * 0.3 * Math.sin(Math.PI * fu);
        } else {
          var wave = Math.sin(Math.PI * Math.min(1, fu * 1.15));
          lift = wave * 0.55 + Math.sin(t * 7) * 0.06 * wave;
          holder.position.x += S.fly.dir * S.fly.dist * (1 - Math.pow(1 - fu, 2));
          fxg.rotation.set(Math.sin(t * 6) * 0.25 * wave, 0, Math.sin(t * 5) * 0.3 * wave);
        }
        holder.position.y += lift;
        shadow.position.x = holder.position.x;
        shadow.scale.set(2.2 * SIZE * (1 - 0.5 * Math.min(1, lift / visH * 2)), 0.8 * SIZE, 1);
      } else if (shadow.scale.x !== 2.2 * SIZE) shadow.scale.set(2.2 * SIZE, 0.8 * SIZE, 1);

      renderer.render(scene, cam);
      requestAnimationFrame(frame);
    }
    // Beine: Trab (diagonale Paare, weich) und Rotary Gallop (nach Hildebrand / Univ. Minnesota „Canine Gaits“):
    // Aufsetzen nacheinander hinten links → hinten rechts → vorne rechts → vorne links, je Bein kurze Stützphase
    // (Duty-Faktor ~0,3), zwei Flugphasen; Rücken krümmt sich (gesammelt, Hinterbeine unter dem Bauch) und streckt sich
    // (Vorderbeine weit vorn); Kopf bleibt ruhig (gleicht den Rücken aus).
    // Haltungen am Skelett. Vorzeichen (gemessen wie beim Gang): turn(…, LAT, +) kippt nach vorn-unten (Nase runter,
    // Bein nach hinten), − nach oben (Bein nach vorn); FWD = Längsachse (Rollen).
    function pose(name, w) {
      var LEGS = [[B.L_shoulder, B.L_elbow, B.L_wrist], [B.R_shoulder, B.R_elbow, B.R_wrist]];
      var HIND = [[B.L_hip, B.L_knee, B.L_ankle], [B.R_hip, B.R_knee, B.R_ankle]];
      if (name === 'beg') {   // Männchen: aus dem Sitzen Oberkörper aufrichten, Vorderpfoten angewinkelt hoch, leicht wippen
        var bob = Math.sin(t * 3.2) * 0.05;
        // Oberkörper senkrecht über dem Becken (wie stehend), Kopf schaut nach vorn
        turn(B.spine_1, LAT, -(0.5 + bob) * w); turn(B.spine_2, LAT, -0.32 * w); turn(B.chest, LAT, -0.2 * w);
        LEGS.forEach(function (l) { turn(l[0], LAT, 0.8 * w); turn(l[1], LAT, -2.2 * w); turn(l[2], LAT, 2.0 * w); });   // Oberarm dicht am Körper, Ellbogen vorn, Unterarm zur Brust, Pfoten stark abgeknickt
        LEGS.forEach(function (l, i) { turn(l[0], FWD, (i ? -1 : 1) * 0.28 * w); });   // etwas auseinander (kein Händchenhalten)
        turn(B.neck_base, LAT, 0.8 * w); turn(B.head, LAT, 0.05 * w);
      } else if (name === 'hide') {   // Platz und Pfoten über den Kopf: Bauch am Boden, Kopf zwischen den Vorderbeinen
        turn(B.spine_1, LAT, 0.4 * w); turn(B.spine_2, LAT, 0.25 * w); turn(B.chest, LAT, 0.15 * w);
        LEGS.forEach(function (l) { turn(l[0], LAT, -1.7 * w); turn(l[1], LAT, 2.3 * w); turn(l[2], LAT, 1.1 * w); });
        turn(B.neck_base, LAT, 0.6 * w); turn(B.head, LAT, 0.45 * w);
        tailOver(-0.9 * w);
      } else if (name === 'stance') {
        // Drohen (Quellen: VCA, ASPCA, Penn Vet): groß machen, Beine steif gestreckt, Gewicht nach VORN, Kopf waagrecht
        // nach vorn mit direktem Blick, Lefzen hoch, Rute hoch und steif. Vorne tief wäre die Spielaufforderung.
        turn(B.COG, LAT, 0.06 * w);                                    // leicht nach vorn gelehnt
        LEGS.forEach(function (l) { turn(l[0], LAT, -0.18 * w); turn(l[1], LAT, -0.05 * w); });   // Vorderbeine schräg unter den Körper: Brust vor den Pfoten
        HIND.forEach(function (l) { turn(l[0], LAT, 0.1 * w); });      // Hinterbeine schieben
        turn(B.neck_base, LAT, 0.12 * w); turn(B.head, LAT, -0.16 * w); // Hals vor, Kopf waagrecht
        var snarl = S.growlT < 0.8 ? Math.sin(Math.min(1, S.growlT / 0.8) * Math.PI) : 0;
        turn(B.jaw, LAT, (0.06 + 0.16 * snarl) * w);
        tailOver(1.2 * w);
      } else if (name === 'cower') {
        // Angst (Tufts, ASPCA, PetMD): klein machen – Hinterhand tief eingeknickt (Gewicht hinten), Vorderbeine gebeugt,
        // Rücken rund, Kopf tief, Rute eingezogen. Werte gemessen (Gelenk-Testraster): Hüfte − = Oberschenkel vor,
        // Knie + = Unterschenkel zurück, Schulter + = Oberarm zurück, Ellbogen + = Unterarm vor. Der Rumpf wird danach
        // ausgeglichen (levelFeet), damit alle Pfoten am Boden stehen.
        HIND.forEach(function (l) { turn(l[0], LAT, -0.9 * w); turn(l[1], LAT, 1.5 * w); turn(l[2], LAT, -0.6 * w); });
        LEGS.forEach(function (l) { turn(l[0], LAT, 0.5 * w); turn(l[1], LAT, 0.85 * w); turn(l[2], LAT, -0.2 * w); });
        turn(B.spine_2, LAT, 0.15 * w);
        turn(B.neck_base, LAT, 1.0 * w); turn(B.head, LAT, 0.35 * w);
        tailOver(-1.5 * w);
      } else if (name === 'pee') {   // Bein heben: linkes Hinterbein seitlich hoch (Längsachse), leicht weg gelehnt
        // Bein auf der Feuerseite seitlich hoch (S.peeSide), Gewicht auf die anderen drei, leicht weg gelehnt
        var sd = S.peeSide === 'R' ? -1 : 1, hp = B[(S.peeSide || 'L') + '_hip'], kn = B[(S.peeSide || 'L') + '_knee'];
        // Rüde am Pfosten: Oberschenkel seitlich hoch und etwas nach vorn, Knie stark gebeugt, Pfote eingezogen –
        // nicht gestreckt weg (sonst wirkt es wie ein Tritt und der Strahl käme aus dem Rücken)
        var an = B[(S.peeSide || 'L') + '_ankle'];
        // Knie/Sprunggelenk um die mitgedrehte Scharnierachse beugen (das Bein steht seitlich, die Weltquerachse wäre falsch)
        var ab = sd * 2.25 * w, hinge = LAT.clone().applyAxisAngle(FWD, ab);
        // Becken kippt mit hoch (Seite des gehobenen Beins steigt), das Standbein gleicht aus und bleibt senkrecht
        var so = B[(S.peeSide === 'R' ? 'L' : 'R') + '_hip'];
        turn(B.pelvis, FWD, sd * 0.3 * w); if (so) turn(so, FWD, -sd * 0.3 * w);
        turn(hp, LAT, -0.35 * w); turn(hp, FWD, ab); turn(kn, hinge, 1.2 * w); if (an) turn(an, hinge, -0.8 * w);
        turn(B.COG, FWD, -sd * 0.06 * w); tailOver(0.4 * w);
      } else if (name === 'lookup') {   // sitzt und schaut nach oben (Regenbogen, Aurora, Meteore)
        turn(B.neck_base, LAT, -0.55 * w); turn(B.head, LAT, -0.45 * w);
      } else if (name === 'shakeoff') {   // Wasser abschütteln: Welle von Kopf bis Becken, schnell, klingt ab
        var k = Math.sin(t * 26) * w;
        turn(B.head, FWD, 0.55 * k); turn(B.neck_base, FWD, 0.35 * k); turn(B.chest, FWD, 0.25 * k);
        turn(B.spine_2, FWD, -0.15 * k); turn(B.pelvis, FWD, -0.12 * k);
      } else if (name === 'flail') {   // in der Luft: Beine strampeln
        var f = Math.sin(t * 16) * w;
        LEGS.forEach(function (l, i) { turn(l[0], LAT, (i ? f : -f) * 0.7); turn(l[1], LAT, 0.4 * w); });
        HIND.forEach(function (l, i) { turn(l[0], LAT, (i ? -f : f) * 0.6); });
        turn(B.head, LAT, -0.3 * w);
      }
    }
    var FRONT_FEET = ['LF_toes', 'RF_toes', 'L_hand', 'R_hand'], HIND_FEET = ['LB_toes', 'RB_toes', 'L_foot', 'R_foot'];
    function levelFeet() {
      var wv = new THREE.Vector3();
      function low(list) { var m = { y: Infinity, x: 0 }; list.forEach(function (n) { if (!B[n]) return; B[n].getWorldPosition(wv); if (wv.y < m.y) { m.y = wv.y; m.x = wv.dot(FWD); } }); return m; }
      for (var k = 0; k < 3; k++) {
        holder.updateMatrixWorld(true);
        var f = low(FRONT_FEET), h = low(HIND_FEET), len = Math.max(0.2, f.x - h.x);
        var ang = Math.max(-0.25, Math.min(0.25, Math.atan2(h.y - f.y, len)));   // > 0: hinten höher → hinten absenken (Nase hoch = −); begrenzt, sonst kippt er über
        if (Math.abs(ang) < 0.002) break;
        turn(B.COG, LAT, -ang);
      }
    }
    // Rute zusätzlich heben/senken (nach dem Ausrichten): oben + , unten − (gemessen: + LAT hebt die Rute)
    function tailOver(up) { turn(B.tail_1, LAT, up * 0.9); turn(B.tail_2, LAT, up * 0.2); }

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
    if (opt.testPose && opt.testPose.length) root.__friendDbg = { S: S, holder: holder, B: B, FEET: FEET };   // nur Vorschau mit ?pt=
    return { ready: ready, react: react, act: act, weather: weather, setFur: function (k) { FUR_KEY = k; applyFur(k); }, setBody: function (k) { BODY_KEY = k; applyBody(k); } };
  }

  root.FriendDog = { create: create, REACTIONS: Object.keys(DEFAULT_REACTIONS) };
})(window);
