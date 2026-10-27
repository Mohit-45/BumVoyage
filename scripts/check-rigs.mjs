import * as THREE from '../public/vendor/three.min.js';
import { CharacterRig, FRAME } from '../public/js/characters/rig.js';

const ALL = ['leo', 'zeke', 'gerry', 'hattie', 'milo', 'ringo'];

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const ids = args.filter((a) => !a.startsWith('--'));
const targets = ids.length ? ids : ALL;

const LIMITS = {
  tubePenetration: 0.35,
  deckPenetration: 0.5,
  flangePenetration: 0.35,
  zMin: -22,
  zMax: 18.5,
  halfWidth: 11.5,
  maxHeight: 27,
  minRear: 13,
  pawBand: [FRAME.deckY - 0.5, FRAME.deckY + 2.6],
  footBand: [FRAME.waterY - 1.0, FRAME.waterY + 3.2],
  maxMeshes: 110,
  maxTriangles: 45000,
};

function regionOf(mesh, rig) {
  let o = mesh;
  while (o && o !== rig.group) {
    const n = o.name;
    if (n === 'pad') return 'pad';
    if (n === 'armL' || n === 'armR') return 'arm';
    if (n === 'legL' || n === 'legR') return 'leg';
    if (n === 'head') return 'head';
    if (n === 'tail') return 'tail';
    if (n === 'rumpL' || n === 'rumpR') return 'rump';
    o = o.parent;
  }
  return 'body';
}

function sampleVertices(rig, stride = 1) {
  rig.group.updateMatrixWorld(true);
  const out = [];
  const v = new THREE.Vector3();
  rig.group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const region = regionOf(mesh, rig);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      out.push({ x: v.x, y: v.y, z: v.z, region });
    }
  });
  return out;
}

function penetration(p) {
  const rho = Math.hypot(p.x, p.z + FRAME.tubeRadius);
  const tube = FRAME.tubeThickness - Math.hypot(rho - FRAME.tubeRadius, p.y - FRAME.tubeCenterY);
  const flange = FRAME.flangeThickness - Math.hypot(rho - FRAME.flangeRadius, p.y - FRAME.flangeY);
  const deck = rho < FRAME.deckRadius ? FRAME.deckY - p.y : -Infinity;
  return { tube, flange, deck };
}

function scan(vertices, worst, label) {
  for (const p of vertices) {
    if (p.region === 'pad') continue;
    const pen = penetration(p);
    for (const [kind, depth] of Object.entries(pen)) {
      if (depth > worst[kind].depth) worst[kind] = { depth, region: p.region, at: [p.x, p.y, p.z].map((n) => +n.toFixed(2)), pose: label };
    }
  }
}

function runPose(rig, label, state, frames, worst, kickPower) {
  if (kickPower) rig.kick(kickPower);
  for (let f = 0; f < frames; f++) {
    rig.update(1 / 60, state(f));
    if (f % 4 === 0) scan(sampleVertices(rig, 2), worst, label);
  }
}

async function checkOne(id) {
  const problems = [];
  const mod = await import(`../public/js/characters/${id}.js`);
  const rig = new CharacterRig(mod.spec, mod.build);
  rig.update(0.016, { walk: 0, charge: 0, heat: 0 });
  const all = sampleVertices(rig);
  const meshes = [];
  rig.group.traverse((o) => o.isMesh && meshes.push(o));
  let triangles = 0;
  for (const m of meshes) triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  if (meshes.length > LIMITS.maxMeshes) problems.push(`too many meshes (${meshes.length} > ${LIMITS.maxMeshes})`);
  if (triangles > LIMITS.maxTriangles) problems.push(`too many triangles (${Math.round(triangles)} > ${LIMITS.maxTriangles})`);
  if (all.some((p) => !Number.isFinite(p.x + p.y + p.z))) problems.push('NaN in geometry');

  const body = all.filter((p) => p.region !== 'pad');
  const box = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
  for (const p of body) for (const k of ['x', 'y', 'z']) {
    box[k][0] = Math.min(box[k][0], p[k]);
    box[k][1] = Math.max(box[k][1], p[k]);
  }
  if (box.z[0] < LIMITS.zMin) problems.push(`reaches too far toward the boat centre (z ${box.z[0].toFixed(1)} < ${LIMITS.zMin})`);
  if (box.z[1] > LIMITS.zMax) problems.push(`sticks out too far behind (z ${box.z[1].toFixed(1)} > ${LIMITS.zMax})`);
  if (box.z[1] < LIMITS.minRear) problems.push(`bum is not outside the boat (rear-most z ${box.z[1].toFixed(1)} < ${LIMITS.minRear})`);
  if (Math.max(Math.abs(box.x[0]), Math.abs(box.x[1])) > LIMITS.halfWidth) problems.push(`too wide (|x| ${Math.max(Math.abs(box.x[0]), Math.abs(box.x[1])).toFixed(1)} > ${LIMITS.halfWidth})`);
  if (box.y[1] > LIMITS.maxHeight) problems.push(`too tall (y ${box.y[1].toFixed(1)} > ${LIMITS.maxHeight})`);

  const arms = all.filter((p) => p.region === 'arm');
  const legs = all.filter((p) => p.region === 'leg');
  if (arms.length === 0) problems.push('no arm geometry');
  else {
    const low = Math.min(...arms.map((p) => p.y));
    if (low < LIMITS.pawBand[0] || low > LIMITS.pawBand[1]) problems.push(`hands do not rest on the deck (lowest arm y ${low.toFixed(2)}, want ${LIMITS.pawBand[0].toFixed(1)}..${LIMITS.pawBand[1].toFixed(1)})`);
  }
  if (legs.length === 0) problems.push('no leg geometry');
  else {
    const low = Math.min(...legs.map((p) => p.y));
    if (low < LIMITS.footBand[0] || low > LIMITS.footBand[1]) problems.push(`feet are not just above the water (lowest leg y ${low.toFixed(2)}, want ${LIMITS.footBand[0].toFixed(1)}..${LIMITS.footBand[1].toFixed(1)})`);
  }
  for (const key of ['head', 'eyeL', 'eyeR', 'browL', 'browR', 'tail', 'rumpL', 'rumpR', 'armL', 'armR', 'legL', 'legR']) {
    if (!rig.parts[key] || rig.parts[key].children.length === 0) problems.push(`pivot "${key}" has no geometry attached`);
  }

  const worst = { tube: { depth: -Infinity }, flange: { depth: -Infinity }, deck: { depth: -Infinity } };
  scan(sampleVertices(rig), worst, 'rest');
  runPose(rig, 'charged', () => ({ walk: 0, charge: 1, heat: 0 }), 40, worst);
  runPose(rig, 'kick', () => ({ walk: 0, charge: 0, heat: 0.4 }), 60, worst, 1);
  runPose(rig, 'walk', (f) => ({ walk: 3.6 * (f % 80 < 40 ? 1 : -1), charge: 0.2, heat: 0 }), 160, worst);
  runPose(rig, 'sore', () => ({ walk: 0, charge: 0, heat: 1 }), 60, worst);
  if (worst.tube.depth > LIMITS.tubePenetration) problems.push(`${worst.tube.region} clips into the inflatable tube by ${worst.tube.depth.toFixed(2)} at [${worst.tube.at}] during "${worst.tube.pose}"`);
  if (worst.flange.depth > LIMITS.flangePenetration) problems.push(`${worst.flange.region} clips into the teal flange by ${worst.flange.depth.toFixed(2)} at [${worst.flange.at}] during "${worst.flange.pose}"`);
  if (worst.deck.depth > LIMITS.deckPenetration) problems.push(`${worst.deck.region} sinks into the deck by ${worst.deck.depth.toFixed(2)} at [${worst.deck.at}] during "${worst.deck.pose}"`);

  return {
    id,
    ok: problems.length === 0,
    problems,
    stats: {
      meshes: meshes.length,
      triangles: Math.round(triangles),
      bounds: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, v.map((n) => +n.toFixed(1))])),
      worstTube: +Math.max(0, worst.tube.depth).toFixed(2),
      worstDeck: +Math.max(0, worst.deck.depth).toFixed(2),
    },
  };
}

const results = [];
for (const id of targets) {
  try {
    results.push(await checkOne(id));
  } catch (error) {
    results.push({ id, ok: false, problems: [`build failed: ${error.message}`], stats: {} });
  }
}

if (asJson) console.log(JSON.stringify(results, null, 2));
else {
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id}  ${JSON.stringify(r.stats)}`);
    for (const p of r.problems) console.log(`   - ${p}`);
  }
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
