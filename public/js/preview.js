import * as THREE from '../vendor/three.min.js';
import { Particles } from './fx.js';
import { buildAnimal } from './animals3d.js';
import { disposeTree } from './gfx.js';

export class AnimalPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 600);
    // the character sits on the rim at z = 33 and the whole boat spins round the character, so the camera stays on them
    this.camera.position.set(0, 54, 118);
    this.camera.lookAt(0, 4, 33);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8fb0c0', 2.0));
    const sun = new THREE.DirectionalLight('#fff3d6', 2.6);
    sun.position.set(-40, 90, 70);
    this.scene.add(sun);
    this.orbit = new THREE.Group();
    this.orbit.position.set(0, 0, 33);
    this.scene.add(this.orbit);
    const cream = new THREE.MeshStandardMaterial({ color: '#f6e7c8', roughness: 0.45 });
    const tube = new THREE.Mesh(new THREE.TorusGeometry(33, 6.4, 24, 72), cream);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 2.2, -33);
    this.orbit.add(tube);
    const deck = new THREE.Mesh(new THREE.CircleGeometry(28, 48), new THREE.MeshStandardMaterial({ color: '#7bc65a', roughness: 0.7 }));
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(0, 3, -33);
    this.orbit.add(deck);
    this.particles = new Particles(this.scene);
    this.particles.setScale(canvas.height, this.camera.fov, this.renderer.getPixelRatio());
    this.rig = null;
    this.id = null;
    this.spin = 0.55;
    this.last = 0;
    this.heat = 0;
  }

  setAnimal(id) {
    if (this.id === id) return;
    if (this.rig) {
      this.orbit.remove(this.rig.group);
      disposeTree(this.rig.group);
    }
    this.id = id;
    this.rig = buildAnimal(id);
    this.rig.group.position.set(0, 8.6, 0);
    this.orbit.add(this.rig.group);
    this.heat = 0;
  }

  toot(power = 0.8) {
    if (!this.rig) return;
    this.rig.kick(power);
    this.scene.updateMatrixWorld(true);
    const at = new THREE.Vector3();
    this.rig.anus.getWorldPosition(at);
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.orbit.getWorldQuaternion(new THREE.Quaternion()));
    this.particles.fart(at.x, at.y, at.z, dir.x, dir.z, power);
    this.heat = Math.min(1, this.heat + 0.2);
  }

  resize() {
    const size = Math.max(120, this.canvas.clientWidth || 200);
    this.renderer.setSize(size, size, false);
    this.particles.setScale(size, this.camera.fov, this.renderer.getPixelRatio());
  }

  render(now) {
    if (!this.rig) return;
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    this.heat = Math.max(0, this.heat - dt * 0.12);
    this.orbit.rotation.y += dt * this.spin * (Math.abs(this.rig.puffL.v) > 1 ? 0.1 : 1);
    this.rig.update(dt, { walk: 0, charge: 0, heat: this.heat });
    this.particles.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
