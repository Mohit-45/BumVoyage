import * as THREE from '../../vendor/three.min.js';

/**
 * Gerry the giraffe: a chunky, flat-shaded, low-poly cartoon giraffe lying over the rim of the boat (about 6,000 triangles).
 *
 * Big simple masses, no stacked balls:
 *  - a deep, round barrel of a torso (14 sided loft) with a pale belly and a handful of big, round, well-spaced chestnut spots
 *    on a warm yellow coat. The spots are cut into the meshes along their outline (see carve()), so their edges are crisp
 *    polygon edges, every piece has one flat colour, and no dense mesh is needed
 *  - a thick, spotted neck that rises out of the withers in a low arch (the crest is about y 10) and then sweeps forward and
 *    down to the head, so it shows as a long tube against the deck; one low, smooth dark ridge of mane runs along the crest
 *  - a big head: rounded skull, a broad pale muzzle with large nostrils, two stubby horns with dark knobs, leaf ears, big eyes
 *    with a visible pupil under a heavy upper lid, and short round brows tilted up at the inner ends (a worried, friendly face)
 *  - thick spotted forelegs with big flat split hooves on the deck, thick hind legs with pale socks and split hooves hanging
 *    just above the water
 *  - two big rounded cheeks with a clean cream cleft of constant width, mirrored exactly on both cheeks. The cheeks are mostly
 *    plain yellow (one spot each, on the outer side), so the sore-bum blush (a shader tint driven by spec.rump) shows clearly
 *  - a short, thick tail that hangs beside the right hip (it never covers the cheeks), ending in a dark tuft
 *
 * The shared rig animates everything (kick, recoil, squint, brows, ears, tail), so nothing here wraps rig.update or rig.kick.
 */
export const spec = {
  id: 'gerry',
  browRest: -0.35,
  eyeOpen: 0.9,
  pivots: {
    // the head pivot is the joint at the end of the neck (the back of the skull); the whole head is built from it
    head: [0, 4.2, -12.8],
    armL: [-3.7, 5.0, -4.6],
    armR: [3.7, 5.0, -4.6],
    legL: [-2.2, 3.4, 10.2],
    legR: [2.2, 3.4, 10.2],
    tail: [3.6, 6.2, 12.3],
    anus: [0, 3.2, 15.0],
    rumpL: [-2.0, 4.0, 12],
    rumpR: [2.0, 4.0, 12],
    // face-local coordinates (the face is scaled by FACE_SCALE and pitched down by FACE_PITCH)
    eyeL: [-1.4, 1.05, -1.35],
    eyeR: [1.4, 1.05, -1.35],
    browL: [-1.4, 2.2, -1.4],
    browR: [1.4, 2.2, -1.4],
    earL: [-1.45, 1.1, 0.7],
    earR: [1.45, 1.1, 0.7],
  },
  pawTarget: [7.2, -4.3, -14.3],
  footTarget: [2.9, -7.1, 11.6],
  rump: { center: [0, 4.0, 12.8], radius: 7.0 },
};

const TAU = Math.PI * 2;
const FACE_PITCH = -0.38;
const FACE_SCALE = 2.1;
const EYE_R = 1.3;

const C = {
  gold: '#f4b92c',
  cream: '#fbe7ad',
  belly: '#fcf1d2',
  sock: '#f7dc95',
  spotA: '#98531f',
  spotB: '#834619',
  dark: '#3a2410',
  mane: '#5b3314',
  maneLite: '#7d4a20',
  tan: '#f1d9a8',
  tanDeep: '#c99d66',
  hoof: '#43302a',
  hoofTop: '#5c4638',
  inner: '#f2b392',
  earRim: '#6e3716',
  brow: '#5e2f12',
};

/* ---------- small numeric helpers ---------- */

function hash(x, y, z) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const vec = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Radii that follow the spine points: one [rx, ry] per spine point, blended between points by arc length. */
function radiiAlong(spine, radii) {
  const d = [0];
  for (let i = 1; i < spine.length; i++) d.push(d[i - 1] + Math.hypot(spine[i][0] - spine[i - 1][0], spine[i][1] - spine[i - 1][1], spine[i][2] - spine[i - 1][2]));
  const total = d[d.length - 1] || 1;
  return (t) => {
    const s = t * total;
    let i = 0;
    while (i < d.length - 2 && s > d[i + 1]) i++;
    const k = Math.min(1, Math.max(0, (s - d[i]) / (d[i + 1] - d[i] || 1)));
    const e = 0.5 * k + 0.5 * k * k * (3 - 2 * k);
    return [radii[i][0] + (radii[i + 1][0] - radii[i][0]) * e, radii[i][1] + (radii[i + 1][1] - radii[i][1]) * e];
  };
}

/* ---------- surface frames and round spots ---------- */

/**
 * Finds points on a loft by ray casting from its spine: at(t, theta) is the surface point (and face normal) at fraction t along
 * the spine and angle theta around it (the same angle the loft uses to place its ring vertices).
 */
function surfaceOf(geometry, spine, up, radii) {
  const curve = new THREE.CatmullRomCurve3(spine.map(vec), false, 'centripetal');
  const upV = vec(up);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.far = 80;
  return {
    length: curve.getLength(),
    ringRadius: (t) => {
      const r = radii(t);
      return (r[0] + r[1]) / 2;
    },
    at(t, theta) {
      const c = curve.getPointAt(t);
      const T = curve.getTangentAt(t).normalize();
      let N = upV.clone().addScaledVector(T, -upV.dot(T));
      if (N.lengthSq() < 1e-4) N = new THREE.Vector3(1, 0, 0).addScaledVector(T, -T.x);
      N.normalize();
      const B = new THREE.Vector3().crossVectors(T, N).normalize();
      const dir = N.multiplyScalar(Math.cos(theta)).addScaledVector(B, Math.sin(theta)).normalize();
      ray.set(c, dir);
      const hit = ray.intersectObject(mesh)[0];
      if (!hit) return null;
      return { c: hit.point.clone(), n: hit.face.normal.clone().normalize(), T };
    },
    /** surface point where a ray from `origin` along `dir` leaves the mesh */
    cast(origin, dir) {
      ray.set(vec(origin), vec(dir).normalize());
      const hit = ray.intersectObject(mesh)[0];
      if (!hit) return null;
      return { c: hit.point.clone(), n: hit.face.normal.clone().normalize(), T: vec(dir).normalize() };
    },
  };
}

/**
 * A round-ish spot as an implicit shape on the surface: a slightly elongated, slightly lumpy disc around a surface point.
 * d(x, y, z) is negative inside, positive outside (about a distance in world units).
 */
function makeSpot(fr, o) {
  const n = fr.n.clone();
  let a = o.axis ? vec(o.axis) : fr.T.clone();
  a.addScaledVector(n, -a.dot(n));
  if (a.lengthSq() < 1e-6) a = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y);
  a.normalize();
  let b = new THREE.Vector3().crossVectors(n, a).normalize();
  if (o.rot) {
    a = a.clone().multiplyScalar(Math.cos(o.rot)).addScaledVector(b, Math.sin(o.rot)).normalize();
    b = new THREE.Vector3().crossVectors(n, a).normalize();
  }
  const seed = o.seed ?? 0;
  const e = o.e ?? 1.15;
  const se = Math.sqrt(e);
  const k2 = o.k2 ?? 0.04 + 0.07 * hash(seed, 1.7, 3.1);
  const k3 = o.k3 ?? 0.02 + 0.05 * hash(seed, 5.3, 0.7);
  const p2 = TAU * hash(seed, 2.9, 8.1);
  const p3 = TAU * hash(seed, 9.1, 4.3);
  const r = o.r;
  const c = fr.c;
  const d = (x, y, z) => {
    const qx = x - c.x;
    const qy = y - c.y;
    const qz = z - c.z;
    const qa = qx * a.x + qy * a.y + qz * a.z;
    const qb = qx * b.x + qy * b.y + qz * b.z;
    const qn = qx * n.x + qy * n.y + qz * n.z;
    const rho = Math.hypot(qa / se, qb * se, qn);
    const phi = Math.atan2(qb, qa);
    return rho - r * (1 + k2 * Math.cos(2 * phi + p2) + k3 * Math.cos(3 * phi + p3));
  };
  return {
    d,
    c: [c.x, c.y, c.z],
    reach: r * (1 + k2 + k3) * se + 0.5,
    r,
    color: new THREE.Color(hash(seed, 3.3, 1.1) < 0.55 ? C.spotA : C.spotB),
  };
}

/**
 * Staggered, slightly jittered spot layout (like a distorted hex grid): o.rows is [[t, [theta, ...]], ...]. A spot that would
 * crowd an earlier one shrinks until a clear gap is left (and is dropped if it would get too small). Returns spot features.
 */
function layoutSpots(surf, o) {
  const rnd = rng(o.seed);
  const gap = o.gap ?? 0.8;
  const out = [];
  for (const [t, thetas] of o.rows) {
    for (const th of thetas) {
      const tt = t + (rnd() - 0.5) * 2 * (o.jt ?? 0);
      const tth = th + (rnd() - 0.5) * 2 * (o.jth ?? 0);
      let r = o.r[0] + (o.r[1] - o.r[0]) * rnd();
      const e = (o.e?.[0] ?? 1.0) + ((o.e?.[1] ?? 1.3) - (o.e?.[0] ?? 1.0)) * rnd();
      const rot = rnd() * Math.PI;
      const fr = surf.at(tt, tth);
      if (!fr) continue;
      if (o.skip?.(fr.c, tt, tth)) continue;
      for (const q of out) r = Math.min(r, Math.hypot(q.c[0] - fr.c.x, q.c[1] - fr.c.y, q.c[2] - fr.c.z) - q.r * 1.12 - gap);
      if (r < (o.rMin ?? 1.0)) continue;
      out.push(makeSpot(fr, { r, e, rot, seed: o.seed * 31 + out.length * 7 + 1, axis: o.axis }));
    }
  }
  return out;
}

/* ---------- carving a mesh along implicit contours ---------- */

/** Split a triangle along the zero contour of d (vertices within tol of the contour count as on it, so no slivers). */
function splitTriangle(t, d, tol, out) {
  const v = [d(t[0][0], t[0][1], t[0][2]), d(t[1][0], t[1][1], t[1][2]), d(t[2][0], t[2][1], t[2][2])];
  const s = v.map((x) => (x > tol ? 1 : x < -tol ? -1 : 0));
  if (!(s.includes(1) && s.includes(-1))) {
    out.push(t);
    return;
  }
  const crossing = (p, q, dp, dq) => {
    const k = dp / (dp - dq);
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
  };
  const z = s.indexOf(0);
  if (z >= 0) {
    // the contour passes through vertex z and crosses the opposite edge
    const i = z;
    const j = (z + 1) % 3;
    const k = (z + 2) % 3;
    const x = crossing(t[j], t[k], v[j], v[k]);
    out.push([t[i], t[j], x], [t[i], x, t[k]]);
    return;
  }
  const i = s[0] === s[1] ? 2 : s[0] === s[2] ? 1 : 0; // the lone vertex
  const j = (i + 1) % 3;
  const k = (i + 2) % 3;
  const x1 = crossing(t[i], t[j], v[i], v[j]);
  const x2 = crossing(t[i], t[k], v[i], v[k]);
  out.push([t[i], x1, x2], [x1, t[j], t[k]], [x1, t[k], x2]);
}

/**
 * Cut a mesh along the contours of the given features and give every piece ONE flat colour (colorAt at the piece centroid).
 * The silhouette and the facets do not change; the colour edges are crisp, straight edges that run through the
 * mesh edges, shared between neighbours (no cracks). features: [{ d, c?, reach? }] (d < 0 inside).
 */
function carve(source, features, colorAt, tol = 0.1) {
  const g = source.index ? source.toNonIndexed() : source;
  const P = g.attributes.position.array;
  const pos = [];
  const nor = [];
  const col = [];
  for (let o = 0; o < P.length; o += 9) {
    const A = [P[o], P[o + 1], P[o + 2]];
    const B = [P[o + 3], P[o + 4], P[o + 5]];
    const Cc = [P[o + 6], P[o + 7], P[o + 8]];
    const ux = B[0] - A[0];
    const uy = B[1] - A[1];
    const uz = B[2] - A[2];
    const vx = Cc[0] - A[0];
    const vy = Cc[1] - A[1];
    const vz = Cc[2] - A[2];
    let fx = uy * vz - uz * vy;
    let fy = uz * vx - ux * vz;
    let fz = ux * vy - uy * vx;
    const fl = Math.hypot(fx, fy, fz);
    if (fl < 1e-9) continue;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    const mx = (A[0] + B[0] + Cc[0]) / 3;
    const my = (A[1] + B[1] + Cc[1]) / 3;
    const mz = (A[2] + B[2] + Cc[2]) / 3;
    const rad = Math.max(Math.hypot(A[0] - mx, A[1] - my, A[2] - mz), Math.hypot(B[0] - mx, B[1] - my, B[2] - mz), Math.hypot(Cc[0] - mx, Cc[1] - my, Cc[2] - mz));
    let tris = [[A, B, Cc]];
    for (const f of features) {
      if (f.c && Math.hypot(mx - f.c[0], my - f.c[1], mz - f.c[2]) > f.reach + rad) continue;
      const next = [];
      for (const t of tris) splitTriangle(t, f.d, tol, next);
      tris = next;
    }
    for (const t of tris) {
      const color = colorAt((t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3, fx, fy, fz);
      for (const p of t) {
        pos.push(p[0], p[1], p[2]);
        nor.push(fx, fy, fz);
        col.push(color.r, color.g, color.b);
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

export function build(rig, kit) {
  const { parts, mats, limb } = rig;
  const { smooth, mix } = kit;
  const col = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, new THREE.Color(v)]));

  /* ---------- helpers ---------- */
  const M = new THREE.Matrix4();
  const xf = (g, { pos = [0, 0, 0], quat = null, scale = [1, 1, 1] } = {}) => {
    M.compose(new THREE.Vector3(...pos), quat ?? new THREE.Quaternion(), new THREE.Vector3(...scale));
    g.applyMatrix4(M);
    g.computeVertexNormals();
    return g;
  };
  const aim = (to, from = [0, 1, 0]) => new THREE.Quaternion().setFromUnitVectors(vec(from).normalize(), vec(to).normalize());
  const cap = (radius, angle, w = 10, h = 3) => new THREE.SphereGeometry(radius, w, h, 0, TAU, 0, angle).toNonIndexed();
  const inSpot = (spots, x, y, z) => {
    for (const s of spots) if (s.d(x, y, z) < 0) return s;
    return null;
  };
  /** an oriented, flat-shaded skin part: the loft is carved along `features` and coloured by `colorAt` */
  const skinPart = (parent, loft, features, colorAt, name) => kit.add(parent, carve(loft, features, colorAt), mats.skin, { name });
  const flat = (color, options = {}) => rig.plain(color, { flatShading: true, ...options });
  const eyeWhiteMat = flat('#ffffff', { roughness: 0.3 });
  const pupilMat = flat('#15151c', { roughness: 0.25 });

  /* ================= TORSO ================= */
  // A deep, round barrel: the belly rests on the pad and the back slopes down toward the hips. A cream belly below y = 3.1.
  const torsoSpine = [[0, 5.2, -3.2], [0, 5.6, -1.2], [0, 5.3, 1.0], [0, 4.7, 4.2], [0, 4.3, 6.8]];
  const torsoRadii = radiiAlong(torsoSpine, [[3.2, 3.3], [4.6, 4.3], [4.9, 4.2], [4.6, 4.0], [3.9, 3.4]]);
  const torsoGeo = kit.loft({ spine: torsoSpine, radii: torsoRadii, sides: 14, stations: 11, capSteps: 2 });
  const torsoSurf = surfaceOf(torsoGeo, torsoSpine, [0, 1, 0], torsoRadii);
  const BELLY_Y = 3.1;
  const torsoSpots = layoutSpots(torsoSurf, {
    seed: 11,
    rows: [
      [0.2, [-1.5, 0, 1.5]],
      [0.5, [-2.0, -0.75, 0.75, 2.0]],
      [0.8, [-1.5, 0, 1.5]],
    ],
    jt: 0.03,
    jth: 0.12,
    r: [1.55, 1.95],
    gap: 0.85,
    e: [1, 1.3],
    skip: (c) => c.y - 1.2 < BELLY_Y + 0.4, // keep clear of the belly line
  });
  skinPart(
    parts.body,
    torsoGeo,
    [...torsoSpots, { d: (x, y) => y - BELLY_Y }],
    (x, y, z) => {
      if (y < BELLY_Y) return col.belly;
      return inSpot(torsoSpots, x, y, z)?.color ?? col.gold;
    },
    'torso'
  );

  /* ================= NECK ================= */
  // Thick, with a gentle S: out of the withers, a low crest (y ~ 9), then sweeping forward and down to the head joint over the deck.
  const HEAD_AT = spec.pivots.head;
  const neckPts = [[0, 6.8, 1.0], [0, 8.9, -1.8], [0, 10.3, -4.8], [0, 9.5, -7.8], [0, 7.0, -10.5], [HEAD_AT[0], HEAD_AT[1], HEAD_AT[2]]];
  // [vertical, width] per spine point
  const neckRadius = radiiAlong(neckPts, [[2.35, 2.15], [2.25, 2.05], [2.05, 1.9], [1.8, 1.7], [1.6, 1.55], [1.5, 1.45]]);
  const neckGeo = kit.loft({ spine: neckPts, radii: neckRadius, sides: 12, stations: 18, up: [1, 0, 0], capStart: 'none', capEnd: 'round', capSteps: 2 });
  const neckSurf = surfaceOf(neckGeo, neckPts, [1, 0, 0], neckRadius);
  const DORSAL = -Math.PI / 2;
  const neckSpots = layoutSpots(neckSurf, {
    seed: 7,
    rows: [
      [0.16, [DORSAL - 1.7, DORSAL, DORSAL + 1.7]],
      [0.29, [DORSAL - 0.85, DORSAL + 0.85, DORSAL + 2.5]],
      [0.42, [DORSAL - 1.7, DORSAL, DORSAL + 1.7]],
      [0.55, [DORSAL - 0.85, DORSAL + 0.85, DORSAL - 2.5]],
      [0.68, [DORSAL - 1.7, DORSAL, DORSAL + 1.7]],
      [0.8, [DORSAL - 0.85, DORSAL + 0.85]],
    ],
    jt: 0.015,
    jth: 0.12,
    r: [1.0, 1.35],
    gap: 0.7,
    e: [1, 1.3],
  });
  skinPart(parts.body, neckGeo, neckSpots, (x, y, z) => inSpot(neckSpots, x, y, z)?.color ?? col.gold, 'neck');

  // mane: one low, smooth, tapering ridge of dark brown hair along the crest of the neck (not a row of tufts)
  {
    const curve = new THREE.CatmullRomCurve3(neckPts.map(vec), false, 'centripetal');
    const crest = [];
    for (let i = 0; i <= 8; i++) {
      const t = 0.1 + 0.78 * (i / 8);
      const T = curve.getTangentAt(t).normalize();
      const D = new THREE.Vector3(1, 0, 0).cross(T).normalize(); // dorsal direction (outside of the arch)
      crest.push(curve.getPointAt(t).addScaledVector(D, neckRadius(t)[0] * 0.97).toArray());
    }
    const ridge = kit.loft({
      spine: crest,
      radii: (t) => {
        const k = Math.sin(Math.PI * t) ** 0.6;
        return [0.16 + 0.26 * k, 0.2 + 0.26 * k];
      },
      sides: 6,
      stations: 12,
      up: [1, 0, 0],
      capSteps: 1,
    });
    kit.paint(ridge, (x, y, z, nx, ny) => mix(C.mane, C.maneLite, smooth(0.2, 1, ny) * 0.55));
    kit.add(parts.body, ridge, mats.matte, { name: 'mane' });
  }

  /* ================= HEAD (built in a pitched, scaled face frame whose origin is the neck joint) ================= */
  const face = kit.pivot(parts.head, [0, 0, 0], 'face');
  face.rotation.x = FACE_PITCH;
  face.scale.setScalar(FACE_SCALE);
  for (const k of ['eyeL', 'eyeR', 'browL', 'browR', 'earL', 'earR']) face.add(parts[k]);

  // skull: a rounded cranium and a broad tan muzzle that ends in a blunt, rounded tip
  const SK_SPINE = [[0, 0.55, -0.35], [0, 0.45, -1.3], [0, 0.05, -2.35], [0, -0.3, -3.15]];
  const SK_RADII = [[1.55, 1.6], [1.62, 1.6], [1.4, 1.34], [1.2, 1.12]];
  const skullGeo = kit.loft({ spine: SK_SPINE, radii: SK_RADII, sides: 12, stations: 6, capSteps: 2 });
  const MUZZLE_Z = -2.0;
  const NOSE_Z = -3.55;
  // the mouth line: a slanted plane that wraps the muzzle, dropping toward the corners; tan above it, pale jaw below
  const lineY = (z) => -0.62 - (z + 2.2) * 0.17;
  skinPart(
    face,
    skullGeo,
    [{ d: (x, y, z) => z - MUZZLE_Z }, { d: (x, y, z) => z - NOSE_Z }, { d: (x, y, z) => (y - lineY(z)) / 1.014 }],
    (x, y, z) => {
      if (z < MUZZLE_Z) {
        if (z < NOSE_Z) return col.tanDeep;
        return y < lineY(z) ? col.belly : col.tan;
      }
      return col.gold;
    },
    'skull'
  );

  // nostrils: two big dark slits set high on the front of the muzzle
  {
    const c = SK_SPINE[3];
    const rad = [SK_RADII[3][0], SK_RADII[3][1], (SK_RADII[3][0] + SK_RADII[3][1]) / 2];
    for (const sx of [-1, 1]) {
      const d = new THREE.Vector3(sx * 0.52, 0.4, -0.76).normalize();
      const s0 = 1 / Math.hypot(d.x / rad[0], d.y / rad[1], d.z / rad[2]);
      const n = [d.x / rad[0], d.y / rad[1], d.z / rad[2]];
      const at = (k) => [c[0] + d.x * s0 * k, c[1] + d.y * s0 * k, c[2] + d.z * s0 * k];
      const q = new THREE.Quaternion().setFromAxisAngle(vec(n).normalize(), sx * 0.6).multiply(aim(n));
      const slit = kit.ellipsoid(0.42, 0.14, 0.3, { detail: 0 });
      xf(slit, { pos: at(1.0), quat: q });
      kit.add(face, slit, mats.nose, { name: 'nostril' });
    }
  }

  // horns (ossicones): two stubby, thick, slightly splayed horns with a dark knob on top
  {
    const horn = kit.loft({
      spine: [[0, -0.4, 0], [0.03, 0.3, 0.02], [0.09, 1.15, 0.05], [0.14, 1.7, 0.07]],
      radii: [[0.58, 0.58], [0.5, 0.5], [0.44, 0.44], [0.42, 0.42]],
      sides: 8,
      stations: 4,
      up: [0, 0, 1],
      capEnd: 'none',
      capSteps: 1,
    });
    kit.paint(horn, (x, y) => mix(mix(C.gold, C.spotA, 0.2), C.spotA, smooth(0.6, 1.7, y) * 0.35));
    const knob = new THREE.SphereGeometry(0.46, 8, 4, 0, TAU, 0, Math.PI * 0.6).toNonIndexed();
    xf(knob, { pos: [0.14, 1.65, 0.07], scale: [1, 0.8, 1] });
    kit.paint(knob, C.dark);
    for (const sx of [-1, 1]) {
      kit.add(face, sx === 1 ? horn : kit.mirrorX(horn), mats.skin, { pos: [sx * 0.9, 1.75, -0.3], rot: [0, 0, sx * -0.18], name: 'ossicone' });
      kit.add(face, sx === 1 ? knob : kit.mirrorX(knob), mats.matte, { pos: [sx * 0.9, 1.75, -0.3], rot: [0, 0, sx * -0.18], name: 'knob' });
    }
  }

  // eyes: big, with a clearly visible pupil. Only the front of the white shows; a head-coloured upper lid covers its top and sags
  // toward the outer corner (a worried look); the pupil looks forward, toward the middle of the boat.
  for (const [eye, sx] of [[parts.eyeL, -1], [parts.eyeR, 1]]) {
    const R = EYE_R;
    kit.add(eye, new THREE.SphereGeometry(R, 10, 7), eyeWhiteMat, { name: 'eyeWhite' });
    const d = new THREE.Vector3(sx * 0.1, 0.2, -0.95).normalize();
    const upPerp = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y).normalize();
    const outPerp = new THREE.Vector3(sx, 0, 0).addScaledVector(d, -d.x * sx).normalize();
    kit.add(eye, xf(cap(R * 1.012, 0.55, 10, 3), { quat: aim(d.toArray()) }), pupilMat, { name: 'pupil' });
    const gl = d.clone().addScaledVector(upPerp, 0.33).addScaledVector(outPerp, 0.17).normalize();
    kit.add(eye, xf(cap(R * 1.03, 0.13, 8, 2), { quat: aim(gl.toArray()) }), mats.glint, { name: 'glint' });

    // socket: head-coloured skin wrapped around the back of the eyeball
    {
      const socket = new THREE.SphereGeometry(R * 1.08, 10, 4, 0, TAU, 0, 1.45).toNonIndexed();
      kit.paint(socket, col.gold);
      xf(socket, { quat: aim([-d.x, -d.y, -d.z]) });
      kit.add(eye, socket, mats.matte, { name: 'socket' });
    }

    // lid: a spherical cap whose pole sits above the gaze and leans toward the outer corner
    const alpha = 0.8;
    const lift = 1.55;
    const droop = 0.38;
    const base = d.clone().multiplyScalar(Math.cos(lift)).addScaledVector(upPerp, Math.sin(lift));
    const pole = base.multiplyScalar(Math.cos(droop)).addScaledVector(outPerp, Math.sin(droop)).normalize();
    const lidQ = aim(pole.toArray());
    const LR = R * 1.07;
    const lidCap = kit.paint(new THREE.SphereGeometry(LR, 10, 4, 0, TAU, 0, alpha).toNonIndexed(), col.gold);
    // dark lash line along the front part of the lid edge
    const dLocal = d.clone().applyQuaternion(lidQ.clone().invert());
    const mid = Math.atan2(dLocal.z, dLocal.x);
    const edgeR = LR * Math.sin(alpha);
    const edgeY = LR * Math.cos(alpha);
    const arcPts = [];
    for (let i = 0; i <= 6; i++) {
      const a = mid + (i / 6 - 0.5) * 2.5;
      arcPts.push([Math.cos(a) * edgeR * 1.004, edgeY, Math.sin(a) * edgeR * 1.004]);
    }
    const lash = kit.loft({ spine: arcPts, radii: [[0.13, 0.13], [0.17, 0.17], [0.13, 0.13]], sides: 4, stations: 6, up: [0, 1, 0] });
    kit.paint(lash, col.dark);
    const lidG = kit.merge([lidCap, lash]);
    xf(lidG, { quat: lidQ });
    kit.add(eye, lidG, mats.matte, { name: 'lid' });
  }

  // brows: short, round-ended dark strokes lying on the lid ridge, raised at the inner end (the rig adds spec.browRest and the
  // straining furrow on top)
  {
    const brow = kit.loft({
      spine: [[-0.6, 0.12, 0.0], [-0.2, 0.17, 0.0], [0.25, 0.12, 0.02], [0.58, 0.0, 0.06]],
      radii: [[0.2, 0.2], [0.22, 0.2], [0.2, 0.18], [0.15, 0.14]],
      sides: 6,
      stations: 4,
      up: [0, 1, 0],
      capSteps: 2,
    });
    kit.paint(brow, col.brow);
    for (const [pivot, sx] of [[parts.browL, -1], [parts.browR, 1]]) {
      kit.add(pivot, sx === 1 ? brow : kit.mirrorX(brow), mats.matte, { name: 'brow', rot: [0, 0, sx === 1 ? -0.1 : 0.1] });
    }
  }

  // ears: leaf ears held out to the sides, tilted so the broad back of the leaf faces up and back; gold outside with a dark tip,
  // pink inside
  {
    const earLoft = kit.loft({
      spine: [[0, 0, 0], [0.75, 0.1, 0.12], [1.5, 0.08, 0.24], [2.15, -0.14, 0.3]],
      radii: [[0.5, 0.25], [0.78, 0.24], [0.82, 0.2], [0.5, 0.14]],
      sides: 8,
      stations: 5,
      up: [0, 1, 0],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 2,
    });
    kit.paint(earLoft, (x, y, z, nx, ny) => {
      const tipK = smooth(1.3, 2.4, x);
      if (ny > 0.45) return mix(mix(C.gold, C.spotA, 0.3), C.earRim, tipK * 0.65);
      if (ny < -0.45) return mix(C.inner, C.earRim, tipK * 0.6);
      return col.earRim;
    });
    xf(earLoft, { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -0.55, 0.1, 'ZYX')) });
    kit.add(parts.earR, earLoft, mats.matte, { name: 'ear' });
    kit.add(parts.earL, kit.mirrorX(earLoft), mats.matte, { name: 'ear' });
  }

  /* ================= BUTTOCKS ================= */
  // Each cheek is a big, rounded, slightly drooping buttock. The two cheeks overlap a little at the middle, which makes a clear
  // vertical cleft; a cream strip of constant width marks it, mirrored exactly on both cheeks. The cheeks are plain yellow apart
  // from one spot each on the outer side, so the sore blush reads clearly.
  {
    const spine = [[0.1, 1.6, -2.0], [0, 0.4, -0.7], [0, -1.0, 0.4]];
    const radii = radiiAlong(spine, [[2.9, 2.8], [3.0, 2.9], [2.5, 2.5]]);
    const geo = kit.loft({ spine, radii, sides: 12, stations: 5, up: [0, 0, 1], capSteps: 2 });
    const surf = surfaceOf(geo, spine, [0, 0, 1], radii);
    const cleftX = -spec.pivots.rumpR[0]; // local x of the cleft (world x = 0) on the right cheek
    const outer = surf.cast([0, 0.3, -0.6], [1, 0.55, 0.15]);
    const cheekSpots = outer ? [makeSpot(outer, { r: 1.5, e: 1.2, rot: 0.6, seed: 97, axis: [0, 1, 0] })] : [];
    const band = { d: (x) => Math.abs(x - cleftX) - 0.4 };
    const cheek = carve(
      geo,
      [...cheekSpots, band],
      (x, y, z) => {
        if (Math.abs(x - cleftX) < 0.4) return col.cream;
        return inSpot(cheekSpots, x, y, z)?.color ?? col.gold;
      }
    );
    kit.add(parts.rumpR, cheek, mats.skin, { name: 'cheek' });
    kit.add(parts.rumpL, kit.mirrorX(cheek), mats.skin, { name: 'cheek' });
  }

  // inner-thigh web: a slim wedge between the upper thighs in the plain coat colour, so the red pad never shows through the crotch
  {
    const spine = [[0, 4.4, 10.8], [0, 2.2, 11.0], [0, -0.6, 11.3]];
    const radii = radiiAlong(spine, [[1.9, 1.7], [1.5, 1.5], [0.8, 1.2]]);
    const web = kit.loft({ spine, radii, sides: 8, stations: 4, up: [0, 0, 1], capStart: 'none', capSteps: 1 });
    kit.paint(web, col.gold);
    kit.add(parts.body, web, mats.skin, { name: 'groin' });
  }

  /* ---------- cloven hooves ---------- */
  // Front hoof: a flat, rounded slab (outline seen from above, toe toward -Z), narrow toe, the top sloping down toward the
  // toe and a chamfered edge. Two toes with a clear split lie flat on the deck. Local origin = the centre of the sole footprint.
  const frontToe = (splay) => {
    const k = 1.2;
    const outline = [[-0.6, -1.2], [0.6, -1.2], [0.68, -0.3], [0.56, 0.65], [0.27, 1.35], [-0.27, 1.35], [-0.56, 0.65], [-0.68, -0.3]].map(([x, y]) => [x * k, y * k]);
    const g = kit.extrude(outline, 0.9, { bevel: 0.22 }); // shape in XY (Y = toward the toe), depth along Z (= height)
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const toe = smooth(-0.2, 2.0, p.getY(i)); // 0 at the heel, 1 at the toe tip
      if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) - 0.5 * toe); // sloping top
      p.setX(i, p.getX(i) + splay * toe * 0.6); // toes splay apart
    }
    g.rotateX(-Math.PI / 2); // shape Y -> world -Z (toward the boat centre), depth Z -> world +Y
    g.computeVertexNormals();
    kit.paint(g, (x, y, z, nx, ny) => (ny > 0.45 ? col.hoofTop : col.hoof));
    return g;
  };
  // Hind hoof: a hanging hoof seen from the side: sloped front face, narrower toe, domed top, flat heel; toe toward -Z.
  const hindToe = (splay) => {
    const k = 1.15;
    const outline = [[-0.85, 0.7], [-1.0, -0.15], [-0.92, -0.95], [0.78, -0.95], [1.12, -0.72], [0.62, 0.3], [0.15, 0.82], [-0.45, 0.95]].map(([x, y]) => [x * k, y * k]);
    const g = kit.extrude(outline, 0.9, { bevel: 0.16 }); // shape in XY (X = toward the toe), depth along Z (= sideways)
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const toe = smooth(-0.1, 1.3, p.getX(i));
      p.setZ(i, p.getZ(i) * (1 - 0.3 * toe) * (1 - 0.3 * smooth(-1.0, 1.05, p.getY(i)))); // narrower toe, tapering up to the pastern
      p.setZ(i, p.getZ(i) + splay * toe * 0.38); // toes splay apart
    }
    g.rotateY(Math.PI / 2); // shape X -> world -Z (toward the boat centre), depth Z -> world +X
    g.computeVertexNormals();
    kit.paint(g, (x, y, z, nx, ny) => (ny > 0.45 ? col.hoofTop : col.hoof));
    return g;
  };

  /* ================= FORELEGS (hooves flat on the deck) ================= */
  // shoulder -> upper arm -> elbow -> forearm -> knee -> cannon -> hoof; thick, set wide so the big head sits between them
  {
    const v = limb.arm.R;
    const spine = [
      [0, 0, 0],
      [v[0] * 0.16, v[1] * 0.3, v[2] * 0.06],
      [v[0] * 0.4, v[1] * 0.64, v[2] * 0.22],
      [v[0] * 0.62, v[1] * 0.8, v[2] * 0.45],
      [v[0] * 0.82, v[1] * 0.92, v[2] * 0.68],
      v,
    ];
    const radii = radiiAlong(spine, [[2.6, 2.6], [2.25, 2.25], [1.85, 1.85], [1.5, 1.5], [1.62, 1.62], [1.22, 1.22]]);
    const geo = kit.loft({ spine, radii, sides: 10, stations: 11, up: [0, 0, 1], capEnd: 'round', capSteps: 2 });
    const surf = surfaceOf(geo, spine, [0, 0, 1], radii);
    const spots = layoutSpots(surf, { seed: 5, rows: [[0.46, [3.5]], [0.6, [4.45]], [0.74, [3.65]]], jt: 0.015, jth: 0.1, r: [0.85, 1.05], rMin: 0.75, gap: 0.8, e: [1, 1.25] });
    const SOCK_Y = v[1] * 0.9;
    const arm = carve(geo, [...spots, { d: (x, y) => y - SOCK_Y }], (x, y, z) => {
      if (y < SOCK_Y) return col.sock;
      return inSpot(spots, x, y, z)?.color ?? col.gold;
    });
    const toes = [];
    for (const tx of [-1, 1]) {
      const toe = frontToe(tx);
      xf(toe, { pos: [v[0] + tx * 0.8, v[1] - 0.3, v[2] - 0.5] });
      toes.push(toe);
    }
    const hoof = kit.merge(toes);
    kit.add(parts.armR, arm, mats.skin, { name: 'arm' });
    kit.add(parts.armR, hoof, mats.matte, { name: 'hoof' });
    kit.add(parts.armL, kit.mirrorX(arm), mats.skin, { name: 'arm' });
    kit.add(parts.armL, kit.mirrorX(hoof), mats.matte, { name: 'hoof' });
  }

  /* ================= HIND LEGS (hanging hooves) ================= */
  // thick thigh -> stifle -> hock that sticks out behind -> cannon -> big split hooves; pale socks below the hock
  {
    const v = limb.leg.R;
    const hockAt = [v[0] * 0.55, -6.4, 1.8];
    const spine = [[0, 1.4, 0.3], [v[0] * 0.12, -1.8, 0.4], [v[0] * 0.3, -4.0, -0.4], hockAt, [v[0] * 0.78, -8.5, 1.6], v];
    const radii = radiiAlong(spine, [[2.6, 3.0], [2.45, 2.75], [1.85, 2.0], [1.4, 1.5], [1.18, 1.22], [1.08, 1.08]]);
    const geo = kit.loft({ spine, radii, sides: 10, stations: 12, up: [0, 0, 1], capEnd: 'round', capSteps: 2 });
    const surf = surfaceOf(geo, spine, [0, 0, 1], radii);
    const spots = layoutSpots(surf, { seed: 3, rows: [[0.43, [-0.9]]], jt: 0.02, jth: 0.1, r: [1.0, 1.3], gap: 0.8, e: [1, 1.25] });
    const SOCK_Y = -6.9;
    const leg = carve(geo, [...spots, { d: (x, y) => y - SOCK_Y }], (x, y, z) => {
      if (y < SOCK_Y) return col.sock;
      return inSpot(spots, x, y, z)?.color ?? col.gold;
    });
    const toes = [];
    for (const tx of [-1, 1]) {
      const toe = hindToe(tx);
      xf(toe, { pos: [v[0] + tx * 0.7, v[1] - 0.95, v[2] - 0.05] });
      toes.push(toe);
    }
    const hoof = kit.merge(toes);
    kit.add(parts.legR, leg, mats.skin, { name: 'leg' });
    kit.add(parts.legR, hoof, mats.matte, { name: 'hoof' });
    kit.add(parts.legL, kit.mirrorX(leg), mats.skin, { name: 'leg' });
    kit.add(parts.legL, kit.mirrorX(hoof), mats.matte, { name: 'hoof' });
  }

  /* ================= TAIL ================= */
  // A short, thick tail rooted in the top of the right cheek; it swings out to the side and hangs beside the hip, so the cleft
  // and the cheeks stay clear. A dark tuft at the end.
  {
    const tailPts = [[-0.9, -0.7, -1.0], [0, 0.3, 0.3], [1.0, 0.3, 1.6], [1.8, -1.0, 2.5], [2.3, -2.7, 3.0], [2.5, -4.0, 3.1]];
    const tailRadii = radiiAlong(tailPts, [[0.85, 0.85], [0.8, 0.8], [0.68, 0.68], [0.56, 0.56], [0.5, 0.5], [0.46, 0.46]]);
    const tail = kit.loft({ spine: tailPts, radii: tailRadii, sides: 7, stations: 8, up: [1, 0, 0], capStart: 'round', capEnd: 'none', capSteps: 1 });
    kit.paint(tail, col.gold);
    kit.add(parts.tail, tail, mats.skin, { name: 'tail' });
    const tuft = kit.loft({
      spine: [[2.5, -3.9, 3.1], [2.52, -4.8, 3.1], [2.52, -5.9, 3.05], [2.52, -6.7, 3.0]],
      radii: [[0.46, 0.46], [0.9, 0.82], [0.8, 0.72], [0.18, 0.18]],
      sides: 7,
      stations: 5,
      up: [1, 0, 0],
      capStart: 'none',
      capEnd: 'round',
      capSteps: 1,
    });
    kit.paint(tuft, (x, y) => mix(C.mane, C.dark, smooth(-4.8, -6.6, y)));
    kit.add(parts.tail, tuft, mats.matte, { name: 'tailTuft' });
  }
}
