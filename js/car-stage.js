/* Gemeinsame Bühne für Auto-Modelle in Car Viewer, Car-Picker-Vorschau und Übersicht (three r128):
 * Studio-Raum als Umgebung (RoomEnvironment, wie der model-viewer von Google) statt weißem Himmel,
 * filmische Belichtung (ACES), damit helle Lacke und Chrom nicht ausbrennen, wenig Zusatzlicht.
 *
 *   CarStage.setup(renderer, scene) – Umgebung, Belichtung und Licht einrichten
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;
  function setup(renderer, scene, opt) {
    opt = opt || {};
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = opt.exposure || 1.35;
    renderer.physicallyCorrectLights = true;
    var pm = new THREE.PMREMGenerator(renderer);
    if (THREE.RoomEnvironment) scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    pm.dispose();
    // Führungslicht von oben vorn, Gegenlicht von der anderen Seite (sonst liegt eine Seite im Schatten),
    // kräftiges Grundlicht, damit Räder und dunkle Lacke nicht absaufen
    var key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 7, 5); scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 1.0); fill.position.set(-5, 4, -5); scene.add(fill);
    var low = new THREE.DirectionalLight(0xffffff, 0.5); low.position.set(0, -2, 6); scene.add(low);   // von unten vorn: Räder, Schweller
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6070, 0.9));
    return scene;
  }
  root.CarStage = { setup: setup };
})(typeof window !== 'undefined' ? window : this);
