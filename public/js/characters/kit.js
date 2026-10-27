import * as THREE from '../../vendor/three.min.js';

const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);

export function hash3(x, y, z) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Loft an organic tube along a spine.
 * spine: [[x,y,z], ...] control points (Catmull-Rom).
 * radii: [[rx, ry], ...] knots along the spine (smoothly interpolated) or a function t -> [rx, ry].
 *   rx is the half-width across the ring's B axis, ry the half-height along the ring's N axis.
 *   For a body running along Z with up=[0,1,0]: rx = half-width (X), ry = half-height (Y).
 * up: reference "up" used to orient the rings (use [0,0,1] for things running along Y).
 * capStart / capEnd: 'round' | 'none'.
 */
export function loft({ spine, radii, sides = 10, stations = 12, up = [0, 1, 0], capStart = 'round', capEnd = 'round', capSteps = 3, twist = 0 }) {
  const curve = new THREE.CatmullRomCurve3(spine.map(V), false, 'centripetal');
  const upV = V(up);
  const radiusAt = (t) => {
    if (typeof radii === 'function') return radii(t);
    const f = t * (radii.length - 1);
    const i = Math.min(radii.length - 2, Math.floor(f));
    const k = f - i;
    const s = k * k * (3 - 2 * k);
    const a = radii[i];
    const b = radii[i + 1];
    return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  };
  const frame = (t) => {
    const c = curve.getPointAt(t);
    const T = curve.getTangentAt(t).normalize();
    let N = upV.clone().addScaledVector(T, -upV.dot(T));
    if (N.lengthSq() < 1e-4) N = new THREE.Vector3(1, 0, 0).addScaledVector(T, -T.x);
    N.normalize();
    const B = new THREE.Vector3().crossVectors(T, N).normalize();
    return { c, T, N, B };
  };
  const rings = [];
  const first = frame(0);
  const last = frame(1);
  const [rx0, ry0] = radiusAt(0);
  const [rx1, ry1] = radiusAt(1);
  if (capStart === 'round') {
    const r = (rx0 + ry0) / 2;
    for (let j = capSteps; j >= 1; j--) {
      const phi = (j / capSteps) * (Math.PI / 2);
      rings.push({ c: first.c.clone().addScaledVector(first.T, -r * Math.sin(phi)), N: first.N, B: first.B, rx: rx0 * Math.cos(phi), ry: ry0 * Math.cos(phi) });
    }
  }
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const f = frame(t);
    const [rx, ry] = radiusAt(t);
    rings.push({ c: f.c, N: f.N, B: f.B, rx, ry });
  }
  if (capEnd === 'round') {
    const r = (rx1 + ry1) / 2;
    for (let j = 1; j <= capSteps; j++) {
      const phi = (j / capSteps) * (Math.PI / 2);
      rings.push({ c: last.c.clone().addScaledVector(last.T, r * Math.sin(phi)), N: last.N, B: last.B, rx: rx1 * Math.cos(phi), ry: ry1 * Math.cos(phi) });
    }
  }
  const positions = [];
  for (const ring of rings) {
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * TAU + twist;
      const p = ring.c.clone().addScaledVector(ring.N, ring.ry * Math.cos(a)).addScaledVector(ring.B, ring.rx * Math.sin(a));
      positions.push(p.x, p.y, p.z);
    }
  }
  const indices = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k;
      const b = i * sides + ((k + 1) % sides);
      const c = (i + 1) * sides + k;
      const d = (i + 1) * sides + ((k + 1) % sides);
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const mid = Math.floor(rings.length / 2) * sides;
  const p0 = new THREE.Vector3().fromArray(positions, mid * 3);
  const p1 = new THREE.Vector3().fromArray(positions, (mid + 1) * 3);
  const p2 = new THREE.Vector3().fromArray(positions, (mid + sides) * 3);
  const faceNormal = new THREE.Vector3().crossVectors(p1.clone().sub(p0), p2.clone().sub(p0));
  const radial = p0.clone().sub(rings[Math.floor(rings.length / 2)].c);
  if (faceNormal.dot(radial) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
    geometry.setIndex(indices);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Low-poly ellipsoid (icosphere). detail 1 = chunky/faceted, 2 = smoother. jitter adds deterministic lumpiness. */
export function ellipsoid(rx, ry, rz, { detail = 1, jitter = 0, seed = 0 } = {}) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 1 + (hash3(x * 7 + seed, y * 7 + seed, z * 7) - 0.5) * jitter;
    pos.setXYZ(i, x * rx * k, y * ry * k, z * rz * k);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

export function cone(radius, height, sides = 7) {
  const g = new THREE.ConeGeometry(radius, height, sides, 1);
  g.translate(0, height / 2, 0);
  g.deleteAttribute('uv');
  return g;
}

export function cylinder(radius, height, sides = 8) {
  const g = new THREE.CylinderGeometry(radius, radius, height, sides, 1);
  g.deleteAttribute('uv');
  return g;
}

export function box(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  return g;
}

/** Extrude a 2D outline (array of [x,y]) into a thin slab (ears, brows, crowns, leaves). Centered on its depth. */
export function extrude(points, depth = 1, { bevel = 0.25 } = {}) {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** Mirror a geometry across X (keeps outward-facing normals). */
export function mirrorX(source) {
  const g = source.clone();
  g.scale(-1, 1, 1);
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.index.needsUpdate = true;
  } else {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      const x = pos.getX(i + 1);
      const y = pos.getY(i + 1);
      const z = pos.getZ(i + 1);
      pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      pos.setXYZ(i + 2, x, y, z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Paint vertex colors. fn(x, y, z, nx, ny, nz) returns a color (hex string, number or THREE.Color). */
export function paint(geometry, fn) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const out = typeof fn === 'function' ? fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 1, nor ? nor.getZ(i) : 0) : fn;
    c.set(out);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Blend two colors by t (0..1) and return a THREE.Color. */
export function mix(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), clamp(t, 0, 1));
}

/** Merge geometries into one (all get position, normal and color). */
export function merge(list) {
  const prepared = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'color'].includes(name)) n.deleteAttribute(name);
    if (!n.attributes.normal) n.computeVertexNormals();
    if (!n.attributes.color) paint(n, '#ffffff');
    return n;
  });
  return THREE.mergeGeometries(prepared);
}

/** Apply a transform to a geometry in place and return it. */
export function place(geometry, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(V(pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])), V(scale));
  geometry.applyMatrix4(m);
  geometry.computeVertexNormals();
  return geometry;
}

/** Create a mesh, set transform and add it to a parent. */
export function add(parent, geometry, material, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], name = '', shadow = true } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = shadow;
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

/** Group pivot at a position. */
export function pivot(parent, pos = [0, 0, 0], name = '') {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  if (name) g.name = name;
  parent.add(g);
  return g;
}
