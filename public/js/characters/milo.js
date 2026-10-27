import * as THREE from '../../vendor/three.min.js';

/**
 * Milo, a mouse lemur. A tiny, chunky animal with a huge round head: enormous glossy dark eyes in brown face patches,
 * a cream face and blaze, a short pointed snout with a pink nose and two buck teeth, and big round pink-lined ears
 * turned out to the sides. The body is a short sturdy bean in soft warm grey with a cream belly: broad shoulders, a
 * dark stripe down the back, big haunches, two round cheeks with a clear cleft, thick short limbs with fat fingers and
 * toes, and a short bushy tail that curls up and over the back and ends in a cream tip.
 * All the big forms (skull, torso, cheeks, limbs) are chunky ring lofts with a few bold flat planes.
 */

// head-local design coordinates (before the head tilt)
const EYE_X = 5.3;
const EYE_Y = 2.7;
const HEAD_TILT = 0.2; // chin lifts a little so the big eyes and cream face look up and out

export const spec = {
  id: 'milo',
  browRest: -0.3,
  eyeOpen: 1,
  pivots: {
    head: [0, 2.9, -8.8],
    armL: [-4.3, 3.6, -5.6],
    armR: [4.3, 3.6, -5.6],
    legL: [-2.6, 3.4, 9.4],
    legR: [2.6, 3.4, 9.4],
    tail: [0, 6.4, 9.0],
    rumpL: [-2.7, 5.0, 10.4],
    rumpR: [2.7, 5.0, 10.4],
    anus: [0, 4.6, 13.4], // where the fart puff leaves: right at the bottom of the cleft, behind the cheeks
    // eye, brow and ear positions are head-local; the eye and brow depths are re-seated onto the skull in build()
    eyeL: [-EYE_X, EYE_Y, -5.0],
    eyeR: [EYE_X, EYE_Y, -5.0],
    browL: [-EYE_X, EYE_Y + 4.9, -4.3],
    browR: [EYE_X, EYE_Y + 4.9, -4.3],
    earL: [-4.9, 6.6, 0.6],
    earR: [4.9, 6.6, 0.6],
  },
  pawTarget: [7.9, -3.65, -12.8],
  footTarget: [3.8, -4.0, 10.0],
  // the sore blush is centred on the cheeks and fades out down the thigh well before the knee
  rump: { center: [0, 5.0, 11.4], radius: 6.8 },
  padColor: '#b8363c',
};

// Soft warm grey fur against clearly lighter cream, so the face and the tail tip pop at small size.
const C = {
  fur: '#917b64',
  furLight: '#a28d76',
  furDeep: '#6f5c4a',
  dorsal: '#523f2f',
  crown: '#99846d',
  belly: '#e8dbc2',
  cream: '#f6ead3',
  patch: '#54413a',
  brow: '#46342d',
  hand: '#ad9588',
  handDark: '#968074',
  handTip: '#e59aa3',
  sole: '#b99d92',
  toePad: '#e48f9a',
  pink: '#f08aa0',
  pinkLight: '#fab4c1',
  nose: '#ea6f8d',
  tailBase: '#76624f',
  tailMid: '#8f7a64',
  tailTip: '#f7ecd3',
  tooth: '#fffaf0',
  mouth: '#6a4538',
};

export function build(rig, kit) {
  const { parts, mats, limb } = rig;
  const { mix, smooth } = kit;
  const { max, abs, sin, cos, PI, hypot, sign } = Math;
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // heat-aware fur with a clear red blush (the colours in the shader are linear)
  const skin = rig.skinMaterial();
  {
    const baseCompile = skin.onBeforeCompile;
    skin.onBeforeCompile = (shader, renderer) => {
      baseCompile(shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('vec3(0.93, 0.2, 0.18)', 'vec3(0.88, 0.1, 0.11)');
    };
    skin.customProgramCacheKey = () => 'milo-skin-heat-v2';
  }

  /** A faceted (flat-normal) copy of a geometry, so round shapes keep the same low-poly finish as the rest. */
  const faceted = (g) => {
    const f = g.index ? g.toNonIndexed() : g;
    f.deleteAttribute('uv');
    f.computeVertexNormals();
    return f;
  };

  /** A spherical cap around the -Z pole of an ellipsoid (iris and pupil painted onto the eyeball). */
  const eyeCap = (rx, ry, rz, theta, ws, hs) => {
    const g = new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, theta);
    g.rotateX(-Math.PI / 2);
    g.scale(rx, ry, rz);
    return faceted(g);
  };

  /** A flat polygon facing +Z (an eye glint). */
  const disc = (rx, ry, sides) => {
    const g = new THREE.CircleGeometry(1, sides);
    g.scale(rx, ry, 1);
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    return g;
  };

  /** Euler angles that turn local direction `from` into world direction `to`. */
  const turn = (from, to) => {
    const q = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    return [e.x, e.y, e.z];
  };

  /** Flip triangle winding so the faces point away from the loft axis. */
  const faceOutward = (g, positions, midRing, sides, centre) => {
    const mid = midRing * sides;
    const p0 = v3(positions[mid * 3], positions[mid * 3 + 1], positions[mid * 3 + 2]);
    const p1 = v3(positions[(mid + 1) * 3], positions[(mid + 1) * 3 + 1], positions[(mid + 1) * 3 + 2]);
    const p2 = v3(positions[(mid + sides) * 3], positions[(mid + sides) * 3 + 1], positions[(mid + sides) * 3 + 2]);
    const fn = new THREE.Vector3().crossVectors(p1.clone().sub(p0), p2.clone().sub(p0));
    if (fn.dot(p0.clone().sub(centre)) < 0) {
      const a = g.index.array;
      for (let i = 0; i < a.length; i += 3) {
        const t = a[i + 1];
        a[i + 1] = a[i + 2];
        a[i + 2] = t;
      }
    }
  };

  /**
   * A chunky loft through explicit rings: each ring lies across Z and has its own centre, half-sizes and squareness
   * (exp 2 = ellipse, higher = squarer, so a low `sides` count gives a few bold flat planes). `taper` narrows the lower
   * half of a ring, `tilt` rolls it about X, and `jitter` nudges every vertex a little so neighbouring facets are
   * irregular instead of an even stack of bands. A ring with rx = ry = 0 closes the loft to a point.
   */
  const ringLoft = ({ rings, sides = 10, twist = 0, jitter = 0, seed = 0 }) => {
    const positions = [];
    rings.forEach((r, i) => {
      const e = 2 / (r.exp ?? 2.4);
      const ct = cos(r.tilt ?? 0);
      const st = sin(r.tilt ?? 0);
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * PI * 2 + twist;
        const ca = cos(a);
        const sa = sin(a);
        const j = 1 + jitter * (kit.hash3(i * 1.7 + 0.3, k * 2.3 + 0.1, seed) * 2 - 1);
        let x = r.rx * sign(sa) * abs(sa) ** e * j;
        const y = r.ry * sign(ca) * abs(ca) ** e * j;
        if (r.taper) x *= 1 - r.taper * smooth(0, -r.ry, y);
        positions.push(r.c[0] + x, r.c[1] + y * ct, r.c[2] + y * st);
      }
    });
    const idx = [];
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const a = i * sides + k;
        const b = i * sides + ((k + 1) % sides);
        const c = (i + 1) * sides + k;
        const d = (i + 1) * sides + ((k + 1) % sides);
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(idx);
    const midRing = Math.floor(rings.length / 2);
    faceOutward(g, positions, midRing, sides, v3(...rings[midRing].c));
    g.computeVertexNormals();
    return g;
  };

  // ---------------------------------------------------------------- torso
  // A short, sturdy bean: broad shoulders, a deep chest, a tucked waist and wide, deep haunches. Warm grey fur with a
  // darker stripe down the back, cream underneath. The big head hides the front of it.
  const bodyTint = (x, y, z, nx, ny) => {
    let c = mix(C.fur, C.furLight, smooth(0.35, 0.95, ny) * 0.45);
    c = mix(c, C.dorsal, smooth(4.2, 2.0, abs(x)) * smooth(0.6, 0.95, ny) * 0.9);
    return mix(c, C.belly, smooth(0.05, -0.55, ny) * smooth(7.0, 2.0, z));
  };

  const torso = ringLoft({
    rings: [
      { c: [0, 4.6, -8.0], rx: 3.6, ry: 3.0, exp: 2.2 },
      { c: [0, 5.0, -5.8], rx: 5.7, ry: 4.5, exp: 2.3, taper: 0.12 },
      { c: [0, 5.7, -2.6], rx: 5.9, ry: 4.6, exp: 2.3, taper: 0.14 },
      { c: [0, 5.8, 0.8], rx: 4.5, ry: 4.2, exp: 2.3, taper: 0.12 },
      { c: [0, 5.8, 3.8], rx: 4.7, ry: 4.3, exp: 2.3, taper: 0.12 },
      { c: [0, 5.5, 6.8], rx: 6.1, ry: 4.9, exp: 2.3, taper: 0.1 },
      { c: [0, 5.1, 9.4], rx: 5.6, ry: 4.6, exp: 2.2 },
      { c: [0, 5.0, 11.4], rx: 3.4, ry: 3.3, exp: 2.2 },
      { c: [0, 5.0, 12.2], rx: 0, ry: 0 },
    ],
    sides: 12,
    twist: PI / 12,
    jitter: 0.02,
    seed: 3,
  });
  kit.paint(torso, bodyTint);
  const torsoMesh = kit.add(parts.body, torso, skin, { name: 'torso' });

  // ----------------------------------------------------------------- head
  // Huge and round with a short pointed snout. Everything on the head hangs from one tilt group so the whole face
  // lifts a little toward the camera; the rig still drives the eye, brow and ear pivots in the same frame.
  const headG = kit.pivot(parts.head, [0, 0, 0], 'headTilt');
  const EYE = { rx: 4.3, ry: 4.7, rz: 2.4 };
  const EYE_YAW = 0.36;
  const EYE_PITCH = 0.16;
  const EYE_SINK = 0.9;

  const skull = ringLoft({
    rings: [
      { c: [0, -3.3, -9.8], rx: 0, ry: 0 },
      { c: [0, -3.3, -9.4], rx: 1.0, ry: 0.9, exp: 2.4 },
      { c: [0, -3.0, -8.5], rx: 2.3, ry: 2.0, exp: 2.4 },
      { c: [0, -2.2, -7.1], rx: 3.9, ry: 3.4, exp: 2.4 },
      { c: [0, -0.3, -5.3], rx: 8.3, ry: 6.5, exp: 2.5, taper: 0.15 },
      { c: [0, 1.2, -2.4], rx: 10.3, ry: 8.9, exp: 2.5, taper: 0.3 },
      { c: [0, 1.8, 0.9], rx: 9.8, ry: 8.7, exp: 2.5, taper: 0.4 },
      { c: [0, 2.6, 3.3], rx: 7.0, ry: 6.4, exp: 2.4, taper: 0.4 },
      { c: [0, 2.5, 4.7], rx: 3.6, ry: 3.6, exp: 2.2 },
      { c: [0, 2.5, 5.2], rx: 0, ry: 0 },
    ],
    sides: 12,
    twist: PI / 12,
    jitter: 0.025,
    seed: 11,
  });
  kit.paint(skull, (x, y, z, nx, ny) => {
    const ax = abs(x);
    // warm grey crown and back of the head with the dark stripe of the back running up between the ears
    let c = mix(C.fur, C.crown, smooth(0.2, 0.95, ny) * 0.7);
    c = mix(c, C.dorsal, smooth(2.2, 1.0, ax) * smooth(0.5, 0.9, ny) * smooth(-3.0, 0.0, z) * 0.75);
    // cream muzzle, cream under the eyes, cream chin and lower cheeks
    const muzzle = smooth(-5.6, -7.0, z);
    const cheeks = smooth(0.2, -2.4, y) * smooth(-1.2, -4.2, z);
    const chin = smooth(-0.2, -0.65, ny) * smooth(2.0, -3.0, z);
    // a cream bridge between the eyes running up from the muzzle
    const bridge = (1 - smooth(2.0, 3.0, ax)) * smooth(-4.0, -6.0, z) * smooth(-2.5, 0.5, y);
    c = mix(c, C.cream, max(muzzle, cheeks, chin, bridge) * 0.97);
    // a deep brown patch around each eye frames it
    const d = hypot((ax - EYE_X) / (EYE.rx * 1.4), (y - EYE_Y) / (EYE.ry * 1.3));
    const halo = (1 - smooth(0.72, 1.0, d)) * smooth(-2.4, -4.4, z);
    return mix(c, C.patch, halo * 0.75);
  });
  kit.add(headG, skull, skin, { name: 'skull' });

  // probe the skull so every face detail sits exactly on its surface
  const probe = new THREE.Mesh(skull, new THREE.MeshBasicMaterial());
  const ray = new THREE.Raycaster();
  const surfZ = (x, y) => {
    ray.set(v3(x, y, -40), v3(0, 0, 1));
    const hit = ray.intersectObject(probe, false)[0];
    return hit ? hit.point.z : 0;
  };
  const surfNormal = (x, y) => {
    const fx = (surfZ(x + 1, y) - surfZ(x - 1, y)) / 2;
    const fy = (surfZ(x, y + 1) - surfZ(x, y - 1)) / 2;
    return v3(fx, fy, -1).normalize();
  };

  // seat the eye pivots into the skull so only a dome of each eye shows
  for (const [pivotKey, side] of [['eyeL', -1], ['eyeR', 1]]) {
    parts[pivotKey].position.z = surfZ(side * EYE_X, EYE_Y) + EYE_SINK;
  }

  // the tip of the snout: the most forward point of the skull on the centre line
  let tipY = -3.3;
  let tipZ = 0;
  for (let y = -6; y <= 0; y += 0.1) {
    const z = surfZ(0, y);
    if (z < tipZ) {
      tipZ = z;
      tipY = y;
    }
  }

  // a small pink pointed nose on the tip of the cream snout
  const nose = kit.loft({
    spine: [[0, tipY + 0.25, tipZ + 0.5], [0, tipY - 0.05, tipZ - 0.8]],
    radii: [[1.2, 0.95], [0.5, 0.42]],
    sides: 6,
    stations: 2,
    capSteps: 2,
    capStart: 'none',
  });
  kit.paint(nose, C.nose);
  kit.add(headG, faceted(nose), mats.matte, { name: 'nose' });

  // a small dark mouth slit under the nose with two big buck teeth in front of it, so they read against the cream muzzle
  const mouthY = tipY - 1.7;
  const mouthZ = surfZ(0, mouthY);
  const slit = kit.box(2.8, 0.5, 0.5);
  kit.paint(slit, C.mouth);
  kit.place(slit, { pos: [0, mouthY + 0.15, mouthZ - 0.05] });
  const teeth = kit.merge([-1, 1].map((s) => {
    const t = kit.box(1.0, 1.8, 0.6);
    kit.paint(t, C.tooth);
    return kit.place(t, { pos: [s * 0.52, mouthY - 0.6, mouthZ - 0.3] });
  }));
  kit.add(headG, kit.merge([slit, teeth]), mats.matte, { name: 'teeth', shadow: false });

  // ---------------------------------------------------------------- eyes
  // Huge glossy dark-brown eyes with a near-black pupil and big glints, set high and forward on the skull and turned
  // only a little outward. Faceted like the rest of the body.
  const eyeBase = rig.plain('#2e1b12', { roughness: 0.38, flatShading: true });
  const pupilMat = rig.plain('#0a0504', { roughness: 0.55, flatShading: true });

  /** Position and orientation of a point on the eyeball surface (angle theta from the front pole, rotated by phi). */
  const onEye = (theta, phi, lift = 0) => {
    const dx = sin(theta) * cos(phi);
    const dy = sin(theta) * sin(phi);
    const dz = -cos(theta);
    const p = v3(EYE.rx * dx, EYE.ry * dy, EYE.rz * dz);
    const n = v3(dx / EYE.rx, dy / EYE.ry, dz / EYE.rz).normalize();
    return { pos: p.addScaledVector(n, lift).toArray(), rot: turn(v3(0, 0, 1), n) };
  };

  const eyeGeo = eyeCap(EYE.rx, EYE.ry, EYE.rz, PI, 12, 9);
  const pupilGeo = eyeCap(EYE.rx * 1.01, EYE.ry * 1.01, EYE.rz * 1.01, 0.78, 12, 3);
  const glintBigGeo = disc(1.35, 1.45, 10);
  const glintSmallGeo = disc(0.6, 0.6, 8);
  for (const [eye, side] of [[parts.eyeL, -1], [parts.eyeR, 1]]) {
    const root = kit.pivot(eye, [0, 0, 0], 'eyeRoot');
    root.rotation.set(EYE_PITCH, -side * EYE_YAW, 0);
    kit.add(root, eyeGeo, eyeBase, { name: 'eyeball' });
    kit.add(root, pupilGeo, pupilMat, { name: 'pupil', shadow: false });
    // one big clean glint and one clearly smaller one
    const big = onEye(0.6, 2.1, 0.2);
    kit.add(root, glintBigGeo, mats.glint, { pos: big.pos, rot: big.rot, name: 'glintBig', shadow: false });
    const small = onEye(0.8, -0.8, 0.2);
    kit.add(root, glintSmallGeo, mats.glint, { pos: small.pos, rot: small.rot, name: 'glintSmall', shadow: false });
  }

  // ---------------------------------------------------------------- brows
  // Bold brow strokes just above each eye: wide-eyed and a little worried at rest, they tip angry when he strains.
  const browOutline = (() => {
    const half = 3.0;
    const top = [];
    const bot = [];
    for (let i = 0; i <= 4; i++) {
      const u = -1 + (i / 4) * 2;
      const x = u * half;
      const arch = 0.5 * (1 - u * u);
      const thick = 0.18 + 0.38 * (1 - u * u) ** 0.7;
      top.push([x, arch + thick]);
      bot.unshift([x, arch - thick]);
    }
    return [...top, ...bot.slice(1, -1)];
  })();
  const browGeo = kit.extrude(browOutline, 0.55, { bevel: 0.12 });
  kit.paint(browGeo, C.brow);
  for (const [brow, side] of [[parts.browL, -1], [parts.browR, 1]]) {
    const bx = side * EYE_X;
    const sz = surfZ(bx, brow.position.y);
    brow.position.z = sz - 0.05;
    const n = surfNormal(bx, brow.position.y);
    kit.add(brow, browGeo.clone(), mats.matte, { rot: [-Math.atan2(n.y, -n.z), 0, 0], name: 'browStroke', shadow: false });
  }

  // ---------------------------------------------------------------- ears
  // Big, round ears set on the top corners of the skull and turned well out to the sides, so the bright-pink insides face
  // forward and out and the round furry backs read as big discs from behind. Each has a chunky faceted fur rim standing
  // proud of the pink bowl, so it never reads as a flat disc.
  const EAR_SIDES = 10;
  const earOutline = (rx, ry, cy) => Array.from({ length: EAR_SIDES }, (_, i) => {
    const a = (i / EAR_SIDES) * PI * 2 + PI / EAR_SIDES;
    return [rx * sin(a) * (0.9 + 0.1 * (cos(a) + 1) * 0.5), cy + ry * cos(a)];
  });
  const earRx = 4.3;
  const earRy = 4.7;
  const earCy = 3.8;
  /** A slab with a hole (the chunky fur rim of an ear, standing proud of the pink inside). */
  const ringSlab = (outer, inner, depth, bevel) => {
    const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.holes.push(new THREE.Path(inner.map(([x, y]) => new THREE.Vector2(x, y))));
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4 });
    g.translate(0, 0, -depth / 2);
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    return g;
  };
  const earOuterPts = earOutline(earRx, earRy, earCy);
  // back plate: warm grey fur, a touch lighter toward the top
  const earBack = kit.extrude(earOuterPts, 0.8, { bevel: 0.28 });
  kit.paint(earBack, (x, y) => mix(C.fur, C.furLight, smooth(-3.0, 4.0, y - earCy) * 0.5));
  // chunky faceted rim around the pink bowl
  const earRim = ringSlab(earOuterPts, earOutline(earRx * 0.76, earRy * 0.78, earCy - 0.1), 0.55, 0.24);
  kit.paint(earRim, (x, y) => mix(C.fur, C.furLight, 0.45 + smooth(-3.0, 4.0, y - earCy) * 0.3));
  kit.place(earRim, { pos: [0, 0, -0.6] });
  const earInner = kit.extrude(earOutline(earRx * 0.8, earRy * 0.82, earCy - 0.1), 0.2, { bevel: 0.08 });
  kit.paint(earInner, (x, y) => mix(C.pink, C.pinkLight, smooth(-1.0, 3.8, y - earCy) * 0.6));
  kit.place(earInner, { pos: [0, 0, -0.55] });
  const ear = kit.merge([earBack, earRim, earInner]);
  kit.add(parts.earL, ear, mats.matte, { rot: [0.22, 0.5, 0.45], name: 'ear' });
  kit.add(parts.earR, kit.mirrorX(ear), mats.matte, { rot: [0.22, -0.5, -0.45], name: 'ear' });

  // lift the whole head (skull, face details and the animated eye, brow and ear pivots) into the tilt group
  for (const key of ['eyeL', 'eyeR', 'browL', 'browR', 'earL', 'earR']) headG.add(parts[key]);
  headG.rotation.x = HEAD_TILT;

  // ---------------------------------------------------------------- arms and hands
  // Thick, short arms ending in big flat hands with fat fingers. Built for the right side and mirrored.
  const finger = (x0, y0, z0, dx, dz, len, r, tipFrom) => {
    const dir = v3(dx, 0, dz).normalize();
    const p1 = [x0 + dir.x * len * 0.5, y0, z0 + dir.z * len * 0.5];
    const p2 = [x0 + dir.x * len, y0 - 0.02, z0 + dir.z * len];
    const g = kit.loft({ spine: [[x0, y0, z0], p1, p2], radii: [[r, r * 0.95], [r * 0.95, r * 0.9], [r * 1.05, r]], sides: 6, stations: 2, up: [0, 1, 0], capSteps: 2, twist: PI / 6 });
    kit.paint(g, (x, y, z, nx, ny) => {
      const u = ((x - x0) * dir.x + (z - z0) * dir.z) / len;
      return mix(mix(C.hand, C.handDark, smooth(0.0, -0.8, ny) * 0.4), C.handTip, smooth(tipFrom, 1.02, u));
    });
    return g;
  };

  const buildArm = (vec) => {
    const [wx, wy, wz] = vec;
    const elbow = [wx * 0.5 + 1.5, wy * 0.55 + 1.7, wz * 0.45 + 1.2];
    const arm = kit.loft({
      spine: [[0, 0, 0], elbow, [wx, wy + 0.3, wz + 0.5]],
      radii: [[2.8, 2.8], [2.4, 2.35], [2.0, 1.95]],
      sides: 8,
      stations: 4,
      capSteps: 2,
      up: [0, 0, 1],
    });
    kit.paint(arm, (x, y, z, nx, ny) => mix(mix(C.fur, C.furLight, smooth(0.1, 0.9, ny) * 0.4), C.hand, smooth(wy * 0.4, wy * 0.95, y) * 0.9));
    const pieces = [arm];

    const palm = ringLoft({
      rings: [
        { c: [wx, wy - 0.4, wz + 0.8], rx: 2.1, ry: 1.35, exp: 2.4 },
        { c: [wx + 0.1, wy - 0.5, wz - 0.7], rx: 2.6, ry: 1.15, exp: 2.6 },
        { c: [wx + 0.1, wy - 0.55, wz - 2.0], rx: 2.7, ry: 1.05, exp: 2.6 },
        { c: [wx + 0.1, wy - 0.57, wz - 2.7], rx: 2.3, ry: 0.9, exp: 2.4 },
        { c: [wx + 0.1, wy - 0.57, wz - 3.0], rx: 0, ry: 0 },
      ],
      sides: 8,
      twist: PI / 8,
    });
    kit.paint(palm, (x, y, z, nx, ny) => mix(C.handDark, C.hand, smooth(wz - 2.6, wz - 0.5, z) * 0.3 + smooth(-0.2, 0.6, ny) * 0.5));
    pieces.push(palm);

    const fy = wy - 0.6;
    const fz = wz - 2.2;
    [
      { off: -2.0, slope: -0.12, len: 2.9, r: 0.92 },
      { off: -0.68, slope: -0.04, len: 3.4, r: 0.94 },
      { off: 0.68, slope: 0.05, len: 3.2, r: 0.92 },
      { off: 2.0, slope: 0.16, len: 2.5, r: 0.86 },
    ].forEach((f) => pieces.push(finger(wx + 0.1 + f.off, fy, fz, f.slope, -1, f.len, f.r, 0.62)));
    // a short fat thumb on the inner side
    pieces.push(finger(wx - 2.3, fy, wz - 0.4, -0.75, -0.66, 2.0, 1.0, 0.55));
    return kit.merge(pieces);
  };
  const armGeo = buildArm(limb.arm.R);
  kit.add(parts.armR, armGeo, skin, { name: 'arm' });
  kit.add(parts.armL, kit.mirrorX(armGeo), skin, { name: 'arm' });

  // ---------------------------------------------------------------- legs and feet
  // A fat thigh that comes out from under the cheek and overlaps the other one at the middle (so no red pad shows under
  // the cleft), a soft knee, a short thick shin, then a big foot with fat toes. One loft per leg, no loose joints.
  const buildLeg = (vec) => {
    const [ax, ay, az] = vec;
    const spine = [[-0.1, 1.5, -0.3], [0.2, -3.5, 0.9], [0.5, -5.6, 0.9], [ax, ay + 0.6, az]];
    const leg = kit.loft({
      spine,
      radii: [[3.3, 3.2], [3.0, 2.9], [2.5, 2.4], [2.0, 1.9]],
      sides: 8,
      stations: 6,
      capSteps: 2,
      capEnd: 'none',
      up: [0, 0, 1],
      twist: PI / 8,
    });
    kit.paint(leg, (x, y, z, nx, ny, nz) => {
      let c = mix(C.fur, C.furLight, smooth(0.3, 0.95, ny) * 0.3);
      c = mix(c, C.furDeep, smooth(0.2, 0.9, nz) * smooth(1.0, -3.0, y) * 0.2);
      return mix(c, C.hand, smooth(ay + 3.2, ay + 0.7, y) * 0.9);
    });
    const pieces = [leg];

    // a broad rounded heel under the ankle
    const instep = kit.loft({
      spine: [[ax, ay + 0.7, az + 0.05], [ax + 0.05, ay - 0.5, az + 0.2], [ax + 0.1, ay - 1.7, az + 0.25]],
      radii: [[2.0, 1.75], [2.6, 1.7], [2.8, 1.4]],
      sides: 8,
      stations: 2,
      capSteps: 2,
      capStart: 'none',
      up: [0, 0, 1],
      twist: PI / 8,
    });
    kit.paint(instep, (x, y, z, nx, ny, nz) => mix(C.hand, C.sole, smooth(0.0, 0.6, nz) * smooth(ay + 0.4, ay - 1.2, y)));
    pieces.push(instep);

    // an inner-thigh flap that reaches a little past the middle line, so the two thighs close the gap under the cleft
    const flap = kit.loft({
      spine: [[-1.0, 0.6, -0.1], [-0.9, -2.4, 0.5], [-0.7, -4.6, 0.9], [-0.4, -6.4, 0.9]],
      radii: [[2.3, 2.9], [2.2, 2.6], [2.0, 2.2], [1.5, 1.7]],
      sides: 8,
      stations: 3,
      capSteps: 2,
      up: [0, 0, 1],
      twist: PI / 8,
    });
    kit.paint(flap, (x, y, z, nx, ny) => mix(C.fur, C.furLight, smooth(0.3, 0.95, ny) * 0.3));
    pieces.push(flap);

    // four fat toes fanning a little; the inner one is the thickest
    const rootY = ay - 1.45;
    [
      { off: -2.3, slope: -0.2, len: 2.5, r: 1.05 },
      { off: -0.78, slope: -0.05, len: 3.0, r: 0.95 },
      { off: 0.78, slope: 0.09, len: 3.0, r: 0.95 },
      { off: 2.3, slope: 0.26, len: 2.5, r: 0.9 },
    ].forEach((t) => {
      const x0 = ax + 0.1 + t.off;
      const dir = v3(t.slope, -1, 0.06).normalize();
      const p0 = [x0, rootY, az + 0.3];
      const p1 = [x0 + dir.x * t.len * 0.5, rootY + dir.y * t.len * 0.5, az + 0.3 + dir.z * t.len * 0.5];
      const p2 = [x0 + dir.x * t.len, rootY + dir.y * t.len, az + 0.3 + dir.z * t.len];
      const g = kit.loft({ spine: [p0, p1, p2], radii: [[t.r, t.r * 0.95], [t.r * 0.95, t.r * 0.9], [t.r * 1.05, t.r]], sides: 6, stations: 2, up: [0, 0, 1], capSteps: 2, twist: PI / 6 });
      kit.paint(g, (x, y, z, nx, ny, nz) => {
        const u = (rootY - y) / (t.len * 0.97);
        return mix(mix(C.hand, C.sole, smooth(0.0, 0.55, nz) * 0.7), C.toePad, smooth(0.6, 1.02, u));
      });
      pieces.push(g);
    });
    return kit.merge(pieces);
  };
  const legGeo = buildLeg(limb.leg.R);
  kit.add(parts.legR, legGeo, skin, { name: 'leg' });
  kit.add(parts.legL, kit.mirrorX(legGeo), skin, { name: 'leg' });

  // ---------------------------------------------------------------- buttocks
  // Two big, rounded, slightly squarish cheeks with a clear vertical cleft between them. Each tapers toward the thigh
  // below it, so the thigh reads as a separate form instead of one fat column. They overlap a little at the centre
  // line so the crease reads as a V-shaped groove. The rig swells them when he strains; a counter-scale holder keeps
  // that swell modest.
  const cheek = ringLoft({
    rings: [
      { c: [0, 0.2, -2.2], rx: 2.8, ry: 2.6, exp: 2.6 },
      { c: [0, 0.2, -0.8], rx: 3.2, ry: 3.0, exp: 2.6, taper: 0.2 },
      { c: [0, 0.0, 0.9], rx: 3.3, ry: 3.1, exp: 2.6, taper: 0.28 },
      { c: [0, -0.2, 2.3], rx: 2.5, ry: 2.5, exp: 2.4, taper: 0.2 },
      { c: [0, -0.3, 3.0], rx: 1.3, ry: 1.3, exp: 2.2 },
      { c: [0, -0.3, 3.3], rx: 0, ry: 0 },
    ],
    sides: 10,
    twist: PI / 10,
  });
  kit.paint(cheek, (x, y, z, nx, ny) => {
    // x is measured from the cheek centre; the cleft lies toward -x on the right cheek (mirrored for the left).
    let c = mix(C.fur, C.furLight, smooth(0.3, 0.95, ny) * 0.35);
    // a deeper crease right down the cleft
    c = mix(c, C.furDeep, smooth(-1.4, -2.8, x) * 0.7);
    return mix(c, C.furDeep, smooth(-0.1, -0.8, ny) * 0.35);
  });
  const swellHolder = (pivotNode, geometry, name) => {
    const holder = kit.pivot(pivotNode, [0, 0, 0], `${name}Swell`);
    const base = THREE.Object3D.prototype.updateMatrix;
    // soft cap: small puffs pass through almost untouched, a full strain (rig scale ~1.26) settles at about 1.14x
    const damp = (k) => (k <= 1 ? 1 : (1 + 0.15 * Math.tanh((k - 1) / 0.15)) / k);
    holder.updateMatrix = function updateMatrix() {
      const p = this.parent.scale;
      this.scale.set(damp(p.x), damp(p.y), damp(p.z));
      base.call(this);
    };
    kit.add(holder, geometry, skin, { name });
  };
  swellHolder(parts.rumpR, cheek, 'cheekR');
  swellHolder(parts.rumpL, kit.mirrorX(cheek), 'cheekL');

  // ------------------------------------------------------------------ tail
  // A short, fat, bushy plume. It leaves the lower back just above the top of the cleft, rises, and curls over the back
  // toward the shoulders, so the whole curl and the cream tip show from above and behind while the cheeks stay clear.
  // The cross-section is a low three-lobed star that slowly spirals along the length, so the planes read as clumps of
  // fur instead of a smooth trunk. It runs from warm grey into a cream tip.
  const tailSpine = [
    [0, 0.5, 0.2], [1.2, 2.1, 0.5], [3.2, 3.3, -0.3], [5.3, 3.7, -2.0], [6.6, 3.3, -4.2],
  ];
  const tailKnots = [[0, 1.6], [0.2, 2.6], [0.45, 3.1], [0.72, 2.8], [0.9, 2.2], [1, 1.6]];
  const tailR = (t) => {
    for (let i = 0; i < tailKnots.length - 1; i++) {
      const [t0, r0] = tailKnots[i];
      const [t1, r1] = tailKnots[i + 1];
      if (t <= t1) return r0 + (r1 - r0) * smooth(t0, t1, t);
    }
    return tailKnots[tailKnots.length - 1][1];
  };

  /** A swept tube whose cross-section is a lobed star that spirals along the spine; closed by round caps. */
  const furLoft = ({ spine, radius, lobes, amp, spin, sides, stations, capSteps, up }) => {
    const curve = new THREE.CatmullRomCurve3(spine.map((q) => v3(...q)), false, 'centripetal');
    const upV = v3(...up);
    const frame = (t) => {
      const c = curve.getPointAt(t);
      const T = curve.getTangentAt(t).normalize();
      const N = upV.clone().addScaledVector(T, -upV.dot(T)).normalize();
      const B = new THREE.Vector3().crossVectors(T, N).normalize();
      return { c, T, N, B };
    };
    const rings = [];
    const f0 = frame(0);
    const f1 = frame(1);
    for (let j = capSteps; j >= 1; j--) {
      const phi = (j / capSteps) * (PI / 2);
      rings.push({ c: f0.c.clone().addScaledVector(f0.T, -radius(0) * sin(phi)), N: f0.N, B: f0.B, r: radius(0) * cos(phi), t: 0 });
    }
    for (let i = 0; i <= stations; i++) {
      const t = i / stations;
      const f = frame(t);
      rings.push({ c: f.c, N: f.N, B: f.B, r: radius(t), t });
    }
    for (let j = 1; j <= capSteps; j++) {
      const phi = (j / capSteps) * (PI / 2);
      rings.push({ c: f1.c.clone().addScaledVector(f1.T, radius(1) * 1.4 * sin(phi)), N: f1.N, B: f1.B, r: radius(1) * cos(phi), t: 1 });
    }
    const positions = [];
    const tOf = [];
    const kOf = [];
    for (const ring of rings) {
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * PI * 2;
        const lobe = cos(lobes * a + spin * ring.t * PI * 2);
        const m = ring.r * (1 + amp * lobe);
        const pt = ring.c.clone().addScaledVector(ring.N, m * cos(a) * 0.94).addScaledVector(ring.B, m * sin(a));
        positions.push(pt.x, pt.y, pt.z);
        tOf.push(ring.t);
        kOf.push(lobe);
      }
    }
    const idx = [];
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const a = i * sides + k;
        const b = i * sides + ((k + 1) % sides);
        const c = (i + 1) * sides + k;
        const d = (i + 1) * sides + ((k + 1) % sides);
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(idx);
    faceOutward(g, positions, Math.floor(rings.length / 2), sides, rings[Math.floor(rings.length / 2)].c);
    g.computeVertexNormals();
    const nor = g.attributes.normal;
    const colors = new Float32Array(tOf.length * 3);
    for (let i = 0; i < tOf.length; i++) {
      const t = tOf[i];
      let col = mix(C.tailBase, C.tailMid, smooth(0.05, 0.5, t));
      // darker underneath, lighter ridges: reads as layered clumps of fur
      col = mix(col, C.furDeep, smooth(0.0, -0.8, nor.getY(i)) * 0.3 * (1 - smooth(0.5, 0.8, t)));
      col = mix(col, C.furLight, max(0, kOf[i]) * 0.18 * (1 - smooth(0.5, 0.8, t)));
      col = mix(col, C.tailTip, smooth(0.56, 0.8, t));
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  };

  const plume = furLoft({ spine: tailSpine, radius: tailR, lobes: 3, amp: 0.14, spin: 0.5, sides: 8, stations: 6, capSteps: 1, up: [1, 0, 0] });

  // the end of the plume breaks into three short, blunt cream tufts that fan out a little, instead of one smooth cap
  const tailCurve = new THREE.CatmullRomCurve3(tailSpine.map((q) => v3(...q)), false, 'centripetal');
  const tailEnd = tailCurve.getPointAt(1);
  const tailDir = tailCurve.getTangentAt(1).normalize();
  const tailSide = new THREE.Vector3().crossVectors(tailDir, v3(1, 0, 0)).normalize();
  const tailUp = new THREE.Vector3().crossVectors(tailSide, tailDir).normalize();
  const tufts = [
    { yaw: -0.5, pitch: 0.1, len: 3.4, r: 1.35 },
    { yaw: 0.0, pitch: 0.35, len: 3.9, r: 1.5 },
    { yaw: 0.5, pitch: 0.05, len: 3.3, r: 1.3 },
  ].map((t) => {
    const g = kit.cylinder(t.r, t.len, 5, t.r * 0.35);
    g.translate(0, t.len / 2, 0); // base at the origin, pointing +Y
    kit.paint(g, (x, y) => mix(C.tailTip, C.tailMid, smooth(0.9, 0.0, y / t.len) * 0.18));
    const dir = tailDir.clone().applyAxisAngle(tailUp, t.yaw).applyAxisAngle(tailSide, -t.pitch).normalize();
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), dir));
    const base = tailEnd.clone().addScaledVector(tailDir, -1.4).addScaledVector(tailSide, t.yaw * 0.9).addScaledVector(tailUp, t.pitch * 1.2);
    return kit.place(g, { pos: base.toArray(), rot: [e.x, e.y, e.z] });
  });
  kit.add(parts.tail, kit.merge([plume, ...tufts]), mats.matte, { name: 'tail' });

  // ------------------------------------------------------------ strain and tail motion
  // The shared rig swings the hind legs out slowly and far, so Milo only adds a lazy wag of the curled tail and the
  // strain squash: the head flattens and widens and the chest swells, so the charge reads from the game camera even
  // though the small body barely moves.
  const baseUpdate = rig.update;
  rig.update = function update(dt, state) {
    baseUpdate.call(this, dt, state);
    const c = this.chargeLevel ?? 0;
    const walk = Math.min(1, Math.abs(state?.walk ?? 0) / 3.6);
    const tail = this.parts.tail;
    tail.rotation.set(0.32 * this.flick + 0.1 * c, sin(this.t * 2.4) * 0.1 * (0.5 + walk) + 0.05 * this.flick, 0);
    headG.scale.set(1 + 0.05 * c, 1 - 0.09 * c, 1 + 0.03 * c);
    torsoMesh.scale.set(1 + 0.08 * c, 1 + 0.06 * c, 1);
    this.parts.earL.rotation.x = 0.28 * c;
    this.parts.earR.rotation.x = 0.28 * c;
  };
}
