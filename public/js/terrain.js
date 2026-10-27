import * as THREE from '../vendor/three.min.js';
import { clamp, smoothstep, fbm2, noise2, hash2 } from './gfx.js';

const CELL = 24;
const BAND = 820;
const FLAT_START = 30;
const FLAT_END = 104;
const CLIFF_SPAN = 420;
const CLIFF_HEIGHT = 118;
const HASH = 120;
const RUN = 320;
const key = (cx, cy) => (cx + 2048) * 8192 + (cy + 2048);
// scenery sits in one instanced mesh per run of river and bank, so frustum and shadow culling can skip whatever is out of view
const runOf = (p, side) => Math.floor(p.s / RUN) * 2 + (side < 0 ? 0 : 1);

function instanceRuns(group, items, geometry, material, perItem, place) {
  const runs = new Map();
  for (const item of items) {
    if (!runs.has(item.run)) runs.set(item.run, []);
    runs.get(item.run).push(item);
  }
  for (const list of runs.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length * perItem);
    list.forEach((item, i) => place(mesh, item, i));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
}

export class Terrain {
  constructor(course, path) {
    this.course = course;
    this.path = path;
    this.samples = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 12));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        this.samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, s: a.s + (b.s - a.s) * t });
      }
    }
    const last = path[path.length - 1];
    this.samples.push({ x: last.x, y: last.y, w: last.w, s: last.s });
    this.buckets = new Map();
    this.samples.forEach((p, i) => {
      const k = key(Math.floor(p.x / HASH), Math.floor(p.y / HASH));
      if (!this.buckets.has(k)) this.buckets.set(k, []);
      this.buckets.get(k).push(i);
    });
  }

  nearest(x, y) {
    const cx = Math.floor(x / HASH);
    const cy = Math.floor(y / HASH);
    let best = null;
    let bd = Infinity;
    for (let r = 0; r <= 9; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const bucket = this.buckets.get(key(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const idx of bucket) {
            const p = this.samples[idx];
            const d2 = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
            if (d2 < bd) {
              bd = d2;
              best = p;
            }
          }
        }
      }
      if (best && Math.sqrt(bd) <= r * HASH) break;
    }
    return best ? { dist: Math.sqrt(bd), w: best.w, s: best.s } : null;
  }

  profile(x, z) {
    const near = this.nearest(x, z);
    if (!near) return null;
    const d = near.dist - near.w;
    const base = this.course.heightAt(near.s);
    let y;
    let t = 0;
    if (d < 0) y = base - 3.2;
    else if (d < FLAT_START) y = base - 3.2 + (d / FLAT_START) * 8.7;
    else if (d < FLAT_END) y = base + 5.5 + (fbm2(x * 0.02, z * 0.02) - 0.5) * 3;
    else {
      t = clamp((d - FLAT_END) / CLIFF_SPAN, 0, 1);
      y =
        base +
        5.5 +
        CLIFF_HEIGHT * t ** 1.25 +
        (fbm2(x * 0.012, z * 0.012) - 0.5) * 44 * smoothstep(0, 0.5, t) +
        (noise2(x * 0.08, z * 0.08) - 0.5) * 6 * t;
    }
    return { y, d, base, t, s: near.s };
  }

  heightAt(x, z) {
    const p = this.profile(x, z);
    return p ? p.y : 0;
  }

  build(theme) {
    const samples = this.samples;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of samples) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y);
      maxZ = Math.max(maxZ, p.y);
    }
    minX = Math.floor((minX - BAND) / CELL) * CELL;
    minZ = Math.floor((minZ - BAND) / CELL) * CELL;
    const cols = Math.ceil((maxX + BAND - minX) / CELL) + 1;
    const rows = Math.ceil((maxZ + BAND - minZ) / CELL) + 1;

    const covered = new Set();
    for (const k of this.buckets.keys()) {
      const cy = (k % 8192) - 2048;
      const cx = Math.floor(k / 8192) - 2048;
      for (let dx = -8; dx <= 8; dx++) for (let dy = -8; dy <= 8; dy++) covered.add(key(cx + dx, cy + dy));
    }

    const ground = new THREE.Color(theme.ground);
    const cliffs = theme.cliff.map((c) => new THREE.Color(c));
    const sand = new THREE.Color('#f3dfae');
    const bed = new THREE.Color('#bfa575');
    const tmp = new THREE.Color();

    const index = new Int32Array(cols * rows).fill(-1);
    const positions = [];
    const colors = [];
    let count = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = minX + i * CELL;
        const z = minZ + j * CELL;
        if (!covered.has(key(Math.floor(x / HASH), Math.floor(z / HASH)))) continue;
        const prof = this.profile(x, z);
        if (!prof || prof.d > BAND) continue;
        positions.push(x, prof.y, z);
        if (prof.d < 0) tmp.copy(bed);
        else if (prof.d < FLAT_START) tmp.copy(ground).lerp(sand, 1 - prof.d / FLAT_START);
        else if (prof.t <= 0.001) {
          tmp.copy(ground);
          tmp.offsetHSL(0, 0, (hash2(i, j) - 0.5) * 0.03);
        } else {
          const u = (prof.y - prof.base) / 11 + noise2(x * 0.03, z * 0.03) * 1.2;
          const idx = ((Math.floor(u) % cliffs.length) + cliffs.length) % cliffs.length;
          tmp.copy(cliffs[idx]);
          tmp.lerp(ground, clamp(1 - prof.t * 9, 0, 1));
        }
        colors.push(tmp.r, tmp.g, tmp.b);
        index[j * cols + i] = count++;
      }
    }
    const indices = [];
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = index[j * cols + i];
        const b = index[j * cols + i + 1];
        const c = index[(j + 1) * cols + i];
        const d = index[(j + 1) * cols + i + 1];
        if (a < 0 || b < 0 || c < 0 || d < 0) continue;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
    mesh.receiveShadow = true;
    return mesh;
  }

  scenery(group, theme, rand) {
    const trees = [];
    const rocks = [];
    const total = this.samples.length;
    let guard = 0;
    while (trees.length < 150 && guard++ < 3000) {
      const p = this.samples[Math.floor(rand() * total)];
      const next = this.samples[Math.min(total - 1, this.samples.indexOf(p) + 1)];
      const tx = next.x - p.x;
      const tz = next.y - p.y;
      const len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len;
      const nz = tx / len;
      const side = rand() < 0.5 ? -1 : 1;
      const off = p.w + 30 + rand() * (rand() < 0.75 ? 70 : 200);
      const x = p.x + nx * off * side + (rand() - 0.5) * 20;
      const z = p.y + nz * off * side + (rand() - 0.5) * 20;
      const prof = this.profile(x, z);
      if (!prof || prof.d < 26 || prof.d > 300) continue;
      trees.push({ x, y: prof.y, z, s: 0.8 + rand() * 0.9, tone: rand(), run: runOf(p, side) });
    }
    guard = 0;
    while (rocks.length < 60 && guard++ < 2000) {
      const p = this.samples[Math.floor(rand() * total)];
      const side = rand() < 0.5 ? -1 : 1;
      const next = this.samples[Math.min(total - 1, this.samples.indexOf(p) + 1)];
      const len = Math.hypot(next.x - p.x, next.y - p.y) || 1;
      const nx = -(next.y - p.y) / len;
      const nz = (next.x - p.x) / len;
      const off = p.w + 24 + rand() * 90;
      const x = p.x + nx * off * side;
      const z = p.y + nz * off * side;
      const prof = this.profile(x, z);
      if (!prof || prof.d < 22) continue;
      rocks.push({ x, y: prof.y, z, s: 4 + rand() * 9, r: rand() * 6, run: runOf(p, side) });
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const leaf = new THREE.Color(theme.leaf);
    const spots = [
      [0, 17, 0, 9],
      [-5.5, 13, 2, 6.8],
      [5, 13.5, -2, 7],
    ];
    for (const t of trees) t.turn = rand() * 6.28;
    const trunkGeo = new THREE.CylinderGeometry(1.6, 2.4, 14, 8);
    trunkGeo.translate(0, 7, 0);
    instanceRuns(group, trees, trunkGeo, new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 0.9 }), 1, (trunks, t, i) => {
      q.setFromAxisAngle(up, t.turn);
      m.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      trunks.setMatrixAt(i, m);
    });
    const blobGeo = new THREE.IcosahedronGeometry(1, 2);
    instanceRuns(group, trees, blobGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 }), 3, (blobs, t, i) => {
      q.setFromAxisAngle(up, t.turn);
      spots.forEach(([dx, dy, dz, r], k) => {
        m.compose(new THREE.Vector3(t.x + dx * t.s, t.y + dy * t.s, t.z + dz * t.s), q, new THREE.Vector3(r * t.s, r * t.s * 0.88, r * t.s));
        blobs.setMatrixAt(i * 3 + k, m);
        blobs.setColorAt(i * 3 + k, col.copy(leaf).offsetHSL(0.01 * k, 0.02, t.tone * 0.12 - 0.05 + k * 0.025));
      });
    });

    const boulderGeo = new THREE.IcosahedronGeometry(1, 1);
    instanceRuns(group, rocks, boulderGeo, new THREE.MeshStandardMaterial({ color: '#9b6f5c', roughness: 0.9, flatShading: true }), 1, (boulders, r, i) => {
      q.setFromEuler(new THREE.Euler(r.r, r.r * 2, 0));
      m.compose(new THREE.Vector3(r.x, r.y + r.s * 0.25, r.z), q, new THREE.Vector3(r.s, r.s * 0.7, r.s * 0.9));
      boulders.setMatrixAt(i, m);
    });
  }
}
