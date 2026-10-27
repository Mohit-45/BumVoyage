import * as THREE from '/vendor/three.min.js';
import { Boat } from '/js/boat.js';
import { sectorLayout } from '/shared/config.js';
import { CharacterRig } from '/js/characters/rig.js';

const q = new URLSearchParams(location.search);
const id = q.get('char') ?? 'leo';
const view = q.get('view') ?? 'game';
const heat = Number(q.get('heat') ?? 0);
const charge = Number(q.get('charge') ?? 0);
const kick = Number(q.get('kick') ?? 0);
const walk = Number(q.get('walk') ?? 0);
const width = Number(q.get('w') ?? 800);
const height = Number(q.get('h') ?? 600);

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(width, height, false);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
canvas.style.width = `${width}px`;
canvas.style.height = `${height}px`;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9bd7f5');
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
scene.environment = envMap;
scene.environmentIntensity = 0.45;
scene.add(new THREE.HemisphereLight('#ffffff', '#c9a37a', 1.0));
const sun = new THREE.DirectionalLight('#fff1d6', 2.0);
sun.position.set(-160, 260, 120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -90;
sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90;
sun.shadow.camera.bottom = -90;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 700;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.6;
scene.add(sun);

const water = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: '#2f9bea', roughness: 0.3, metalness: 0 }));
water.rotation.x = -Math.PI / 2;
water.position.y = -1.3;
water.receiveShadow = true;
scene.add(water);

const crewParam = q.get('crew');
const crew = crewParam ? crewParam.split(',') : [id];
const layout = sectorLayout(crew.length);
const colors = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c'];
const mods = {};
for (const cid of new Set(crew)) mods[cid] = await import(`/js/characters/${cid}.js`);
const info = crew.map((cid, i) => ({ name: cid, color: colors[i], animal: cid }));
const boat = new Boat(layout, info, 0, envMap, (cid) => new CharacterRig(mods[cid].spec, mods[cid].build));
if (crewParam) boat.group.rotation.y = Math.PI;
scene.add(boat.group);
const stateFor = (frame) => ({
  pos: layout.map((l, i) => l.center + (walk ? Math.sin(frame * 0.3 + i) * 0.2 : 0)),
  heat: layout.map(() => heat),
  ch: layout.map(() => charge),
});
if (kick > 0) for (const rig of boat.rigs) rig.kick(kick);
const frames = kick > 0 ? 14 : heat > 0 ? 90 : 4;
for (let i = 0; i < frames; i++) boat.update(stateFor(i), 1 / 60, charge);
scene.updateMatrixWorld(true);

const camera = new THREE.PerspectiveCamera(42, width / height, 1, 2000);
const cams = {
  game: { at: [88, 112, 0], look: [-38, 6, 0], fov: 50 },
  back: { at: [78, 30, 0], look: [33, 7, 0], fov: 40 },
  side: { at: [33, 16, 62], look: [33, 6.5, 0], fov: 38 },
  front: { at: [-2, 24, 0], look: [30, 6.5, 0], fov: 46 },
  top: { at: [33, 120, 0.01], look: [33, 0, 0], fov: 28 },
  face: { at: [8, 17, 13], look: [21, 11.5, 0], fov: 34 },
  rear: { at: [60, 14, 20], look: [38, 4, 0], fov: 38 },
  cast: { at: [88, 112, 0], look: [-38, 6, 0], fov: 50 },
  castlow: { at: [70, 70, 0], look: [-8, 4, 0], fov: 46 },
};
const c = cams[view] ?? cams.game;
if (crewParam && view === 'cast') Object.assign(c, cams.game);
camera.fov = c.fov;
camera.position.set(...c.at);
camera.lookAt(...c.look);
camera.updateProjectionMatrix();
renderer.render(scene, camera);
window.__ready = true;
