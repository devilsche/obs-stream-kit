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
    renderer.toneMappingExposure = opt.exposure || 0.9;
    renderer.physicallyCorrectLights = true;
    var pm = new THREE.PMREMGenerator(renderer);
    if (THREE.RoomEnvironment) scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    pm.dispose();
    // schwaches Führungslicht von oben vorn für Form und Schatten-Kanten
    var key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(-3, 6, 4); scene.add(key);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x303640, 0.35));
    return scene;
  }
  root.CarStage = { setup: setup };
})(typeof window !== 'undefined' ? window : this);
