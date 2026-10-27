import * as THREE from '../../vendor/three.min.js';

/**
 * Hattie the hippo. A big, barrel-bodied, blue-violet hippo with a huge square muzzle,
 * dark swept lashes, heavy half-lids with a sly side-glance, small pink-centred ears and the biggest,
 * roundest bum on the boat.
 *
 * She drapes over the rim: chest on the pad, a pear-shaped barrel (broad shoulders, a slightly narrower
 * waist, big hips), two real buttocks that grow out of the hips and are split by a deep cleft that starts at
 * a tiny stub of a tail tucked into it, and thick short hind legs (a broad ham, a knee with a kneecap, a calf and ankle
 * about 60% as wide as the thigh) ending in big toe-out feet just above the water. Everything is built from bold,
 * low-sided lofts (flat top, flat belly, chamfered corners) so the faceting is a few big planes; every
 * marking is a vertex colour.
 *
 * Round 3 refinements: brows sunk onto the lids and damped when she strains, mitts out beside the jaw, tapered legs with a
 * closed crotch (no pad showing through), a smaller tail in the cleft's shadow colour, buttocks that curl under into the
 * thighs, thicker ears tipped back to show their pink, a pink lip rim on the muzzle, a greyer blue, and a bum that
 * widens as she charges.
 */
export const spec = {
  id: 'hattie',
  browRest: 0.04,
  // the mitts lie out beside the jaw (the muzzle is a little narrower than the spread of the hands), toes forward
  pawTarget: [9.35, -3.5, -15.75],
  footTarget: [3.9, -5.9, 10.5],
  rump: { center: [0, 4.4, 11.2], radius: 9.0 },
  pivots: {
    // the head sits a little further back than before so the muzzle stays inside the boat's reach even in a kick
    head: [0, 4.25, -7.2],
    armL: [-6.3, 3.7, -5.6],
    armR: [6.3, 3.7, -5.6],
    legL: [-3.9, 1.2, 9.6],
    legR: [3.9, 1.2, 9.6],
    // the tail root is buried in the valley of the sacrum, where the cleft begins
    tail: [0, 7.3, 8.9],
    // the cheek geometry is built in body coordinates, so at rest its transform is exactly the identity (which keeps the
    // joint with the torso watertight); the puff scales it about the seam through the position (see the puff re-weighting
    // at the end of build())
    rumpL: [0, 0, 0],
    rumpR: [0, 0, 0],
    anus: [0, 3.9, 14.2],
    // head-local coordinates (the head is scaled 1.8): eyes on the top corners of the skull,
    // ears well behind and outside them
    eyeL: [-2.85, 3.1, -1.0],
    eyeR: [2.85, 3.1, -1.0],
    // (the brows lie on the lids; the rig lifts and tilts them, see the damping in update() at the end of build())
    browL: [-2.85, 4.3, -0.85],
    browR: [2.85, 4.5, -0.85],
    earL: [-3.4, 2.4, 2.6],
    earR: [3.4, 2.4, 2.6],
  },
};

const TAU = Math.PI * 2;

/** Pull a colour toward its own grey by (1 - k): k = 0.9 takes 10% of the saturation out (done in sRGB, on the hex). */
function sat(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const grey = 0.299 * ch[0] + 0.587 * ch[1] + 0.114 * ch[2];
  return `#${ch.map((v) => Math.round(Math.max(0, Math.min(255, grey + (v - grey) * k))).toString(16).padStart(2, '0')).join('')}`;
}

// The skin is a blue-grey #8f93c7: the periwinkle of the earlier passes is pulled about 10% toward grey on the
// sides and on top; the darker back and the pale belly keep their contrast.
const C = {
  side: sat('#8489ca', 0.88),
  back: sat('#7176b8', 0.94),
  belly: '#d7d8ee',
  top: sat('#8e93d1', 0.88),
  pink: '#f4a3c0',
  lip: '#ec5f8e',
  liner: '#26203f',
  lid: sat('#9498d0', 0.88),
  lidEdge: sat('#8489ca', 0.88),
  nail: '#e6def2',
  sole: '#676ca1',
  crease: '#6c71a8',
  brow: sat('#6c71ae', 0.9),
  nose: sat('#8c91cc', 0.88),
  slit: '#2f2a55',
  cleft: '#474b8a',
  hilite: sat('#a3a8dc', 0.88),
};

/**
 * Hind leg rings, local to the leg pivot (y is up, measured from the pivot at y = 1.2 above the pad), right leg: a broad ham that
 * emerges from under the cheek, a thigh that tapers to a knee, a kneecap wedge (the step under the knee), a calf and ankle at
 * about 60% of the thigh's width, then the foot. The thigh is wide enough to cross the midline a little, so the two thighs
 * close the gap under the cleft (nothing, not even a sliver of the red pad, shows between them there) and open into a V below
 * the knee.
 */
const LEG_KEYS = [
  { y: 2.8, x: -0.2, z: 0.2, rx: 3.9, rz: 3.5, n: 2.4 }, // inside the cheek (hidden)
  { y: 1.2, x: -0.1, z: 0.15, rx: 4.4, rz: 3.95, n: 2.4 }, // where the thigh comes out from under the cheek
  { y: -0.1, x: -0.1, z: 0.1, rx: 4.45, rz: 3.9, n: 2.4 }, // the widest ring, the ham: the cheek rolls onto it
  { y: -1.5, x: -0.15, z: 0.1, rx: 4.15, rz: 3.65, n: 2.5 },
  { y: -2.6, x: -0.15, z: 0.15, rx: 3.85, rxi: 4.15, rz: 3.5, n: 2.6 },
  { y: -3.3, x: -0.15, z: 0.2, rx: 3.85, rxi: 4.15, rz: 3.4, n: 2.7 }, // the knee: the widest of the lower leg (the inner side overlaps the other thigh a little more, so a charge can't open a slit)
  { y: -4.1, x: -0.4, z: 0.5, rx: 2.9, rxi: 3.7, rz: 2.8, n: 2.4 }, // right under the kneecap: the outer side steps in, the inner side stays full
  { y: -5.1, x: -0.45, z: 0.8, rx: 2.65, rxi: 3.65, rz: 2.7, n: 2.4 }, // calf
  { y: -6.0, x: -0.4, z: 0.9, rx: 2.5, rxi: 3.7, rz: 2.55, n: 2.4 },
  { y: -6.6, x: -0.4, z: 0.9, rx: 2.45, rxi: 2.9, rz: 2.5, n: 2.4 }, // ankle
  { y: -7.1, x: -0.3, z: 0.9, rx: 2.7, rz: 2.6, n: 2.4 },
];

/** Catmull-Rom through scalar knots, t in [0, n-1]. */
function crSample(v, t) {
  const n = v.length;
  const i = Math.min(n - 2, Math.max(0, Math.floor(t)));
  const f = t - i;
  const p0 = v[Math.max(0, i - 1)];
  const p1 = v[i];
  const p2 = v[i + 1];
  const p3 = v[Math.min(n - 1, i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

const sgnPow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

/** Piecewise-smooth radius profile: knots [[t, rx, ry], ...] -> t => [rx, ry]. */
function profile(knots) {
  return (t) => {
    let i = 0;
    while (i < knots.length - 2 && t > knots[i + 1][0]) i++;
    const a = knots[i];
    const b = knots[i + 1];
    const k = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    const s = k * k * (3 - 2 * k);
    return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  };
}

/**
 * Close a stack of rings into one watertight, outward-facing tube.
 * rings: [{ c: [x,y,z], pts: [[x,y,z], ...] }] (all rings have the same point count).
 * capStart / capEnd: 'dome' closes an end with a shrinking dome (capSteps rings), 'flat' with a flat fan, 'none' leaves it open.
 */
function tubeGeometry(rings, { capStart = 'dome', capEnd = 'dome', capSteps = 1, capLen = 0.5 } = {}) {
  const all = rings.map((r) => ({ c: new THREE.Vector3(...r.c), pts: r.pts.map((p) => new THREE.Vector3(...p)) }));
  const meanR = (r) => r.pts.reduce((s, p) => s + p.distanceTo(r.c), 0) / r.pts.length;
  const cap = (ring, other) => {
    const dir = ring.c.clone().sub(other.c).normalize();
    const R = meanR(ring);
    const out = [];
    for (let j = 1; j <= capSteps; j++) {
      const phi = (j / capSteps) * (Math.PI / 2);
      const shift = capLen * R * Math.sin(phi);
      out.push({
        c: ring.c.clone().addScaledVector(dir, shift),
        pts: ring.pts.map((p) => p.clone().sub(ring.c).multiplyScalar(Math.cos(phi)).add(ring.c).addScaledVector(dir, shift)),
      });
    }
    return out;
  };
  const sides = all[0].pts.length;
  const pre = capStart === 'dome' ? cap(all[0], all[1]).reverse() : [];
  const post = capEnd === 'dome' ? cap(all[all.length - 1], all[all.length - 2]) : [];
  const stack = [...pre, ...all, ...post];
  const positions = [];
  for (const r of stack) for (const p of r.pts) positions.push(p.x, p.y, p.z);
  const indices = [];
  for (let i = 0; i < stack.length - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k;
      const b = i * sides + ((k + 1) % sides);
      const c = (i + 1) * sides + k;
      const d = (i + 1) * sides + ((k + 1) % sides);
      indices.push(a, b, c, b, d, c);
    }
  }
  // flat end caps: a fan to the ring centre
  const fan = (ringIndex, last) => {
    const ci = positions.length / 3;
    const ring = stack[ringIndex];
    positions.push(ring.c.x, ring.c.y, ring.c.z);
    for (let k = 0; k < sides; k++) {
      const a = ringIndex * sides + k;
      const b = ringIndex * sides + ((k + 1) % sides);
      if (last) indices.push(a, b, ci);
      else indices.push(b, a, ci);
    }
  };
  if (capStart === 'flat') fan(0, false);
  if (capEnd === 'flat') fan(stack.length - 1, true);
  // make sure the winding faces outward (test on a ring in the middle of the original stack)
  const mi = pre.length + Math.floor(all.length / 2);
  const mid = stack[Math.min(mi, stack.length - 2)];
  const nxt = stack[Math.min(mi, stack.length - 2) + 1];
  const p0 = mid.pts[0];
  const normal = new THREE.Vector3().crossVectors(mid.pts[1].clone().sub(p0), nxt.pts[0].clone().sub(p0));
  if (normal.dot(p0.clone().sub(mid.c)) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Interpolate keyed fields with Catmull-Rom, `sub` rings between keys (sub 1 = the keys only: bold planes). */
function sampleKeys(keys, fields, dflt, sub) {
  const vals = {};
  for (const f of fields) vals[f] = keys.map((k) => k[f] ?? dflt[f]);
  const total = (keys.length - 1) * sub;
  const out = [];
  for (let i = 0; i <= total; i++) {
    const r = {};
    for (const f of fields) r[f] = sub === 1 ? vals[f][i] : crSample(vals[f], i / sub);
    out.push(r);
  }
  return out;
}

/**
 * Loft of super-elliptical rings along Z (n = 2 is an ellipse, 3+ is a rounded box).
 * keys: [{ z, x, y, rx, ry, n }] in order along Z (either direction).
 * phase 0.5 turns the ring half a step so the top and the bottom are flat faces instead of ridges.
 */
function superLoft(keys, { sides = 8, sub = 1, phase = 0.5, capLen = 0.5, capSteps = 1, capStart = 'dome', capEnd = 'dome' } = {}) {
  const rs = sampleKeys(keys, ['z', 'x', 'y', 'rx', 'ry', 'n'], { x: 0, y: 0, n: 2 }, sub);
  const rings = rs.map((r) => {
    const e = 2 / Math.max(2, r.n);
    const pts = [];
    for (let k = 0; k < sides; k++) {
      const a = ((k + phase) / sides) * TAU;
      pts.push([r.x + r.rx * sgnPow(Math.sin(a), e), r.y + r.ry * sgnPow(Math.cos(a), e), r.z]);
    }
    return { c: [r.x, r.y, r.z], pts };
  });
  return tubeGeometry(rings, { capStart, capEnd, capSteps, capLen });
}

/**
 * Buttock loft: the rear half of the barrel, split down the middle. Each ring is the right half of a torso-style ring:
 * the outer arc uses exactly the torso's formula (same sides, same phase), so a ring with the same numbers as the last
 * torso ring is flush with it and the cheek grows out of the hips with no ledge, no shard and no seam. The inner side is
 * a wall that is closed on the midline at the top (so the two halves form one smooth back and the tail sits on a saddle)
 * and opens toward the bottom by `gap`: a wedge-shaped cleft that starts low. Its lower end is lifted by h, `dip` sinks the
 * top of the midline into a shallow valley and `bulge` rounds the wall off toward the rear. The dome at the back shrinks about the
 * middle of the cheek, so the two rear faces meet in a V cleft.
 * keys: [{ z, gap, xOut, cy, ry, n, h, bulge, dip }], front to back. Built for the right cheek (inner side = -X).
 */
function rumpLoft(keys, { sub = 1, capLen = 0.4, capSteps = 1 } = {}) {
  const rs = sampleKeys(keys, ['z', 'gap', 'xOut', 'cy', 'ry', 'n', 'h', 'bulge', 'dip', 'round'], { gap: 0, n: 2.5, h: 0, bulge: 0, dip: 0, round: 0 }, sub);
  const rings = rs.map((r) => {
    const e = 2 / Math.max(2, r.n);
    const at = (deg) => {
      const a = (deg / 360) * TAU;
      return [r.xOut * sgnPow(Math.sin(a), e), r.cy + r.ry * sgnPow(Math.cos(a), e)];
    };
    // the outer arc: the torso's five points (18, 54, 90, 126, 162 degrees from the top) plus one extra point on each of the
    // two lower flanks (108 and 144 degrees). With round = 0 the extras sit on the chords (so the ring is exactly the torso's
    // ring and the joint stays flush); with round = 1 they sit on the curve, which rounds the underside of the cheek into a real
    // buttock instead of one long straight flank ending in a pointed corner.
    const p5 = [18, 54, 90, 126, 162].map(at);
    const chord = (a, b, deg) => {
      const c = at(deg);
      return [(a[0] + b[0]) / 2 + (c[0] - (a[0] + b[0]) / 2) * r.round, (a[1] + b[1]) / 2 + (c[1] - (a[1] + b[1]) / 2) * r.round];
    };
    const arc = [p5[0], p5[1], p5[2], chord(p5[2], p5[3], 108), p5[3], chord(p5[3], p5[4], 144), p5[4]];
    const yTop = arc[0][1];
    const yBot = arc[arc.length - 1][1] + r.h;
    const yMid = yTop - r.dip; // the top of the wall on the midline: a shallow valley between the buttocks
    // inner wall: closed on the midline at the top, opening toward the bottom (a wedge), rounded by `bulge`
    const wallX = (t) => r.gap * (1 - t) ** 1.6 + r.bulge * Math.sin(Math.PI * t);
    // the top midline vertex reaches 0.4 past the midline (and 0.1 lower), so the two cheeks overlap there and cross at a clean line
    // instead of just touching: two meshes that only touch along an edge leave a hairline crack, with the dark inside showing through
    const pts = [[-0.4, yMid - 0.1, r.z]];
    for (const p of arc) pts.push([p[0], p[1], r.z]);
    pts.push([wallX(0), yBot, r.z]);
    for (let j = 1; j <= 3; j++) {
      const t = j / 4;
      pts.push([wallX(t), yBot + (yMid - yBot) * t, r.z]);
    }
    return { c: [r.xOut / 2, (yTop + yBot) / 2, r.z], pts };
  });
  return tubeGeometry(rings, { capStart: 'flat', capEnd: 'dome', capLen, capSteps });
}

/**
 * Vertical loft of super-elliptical rings (horizontal slices), top to bottom: a leg with real planes between a few knee, calf
 * and ankle rings. keys: [{ y, x, z, rx, rz, n, rxi }]. Built for the right leg (the left one is its mirror image).
 */
function legLoft(keys, { sides = 10, phase = 0.5, capTop = 'flat', capBottom = 'dome', capLen = 0.4 } = {}) {
  const rings = keys.map((k) => {
    const e = 2 / Math.max(2, k.n ?? 2.4);
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = ((i + phase) / sides) * TAU;
      const sn = Math.sin(a);
      // rxi: half-width of the inner side (toward -X for the right leg), when it differs from the outer side
      pts.push([k.x + (sn < 0 ? k.rxi ?? k.rx : k.rx) * sgnPow(sn, e), k.y, k.z + k.rz * sgnPow(Math.cos(a), e)]);
    }
    return { c: [k.x, k.y, k.z], pts };
  });
  return tubeGeometry(rings, { capStart: capTop, capEnd: capBottom, capLen });
}

/** First surface hit of geometry `geo` (identity transform) along a ray, from inside or outside. */
function surfaceHit(geo, origin, dir) {
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(origin.clone(), dir.clone().normalize(), 0, 200);
  const hit = ray.intersectObject(mesh, false)[0];
  if (!hit) return null;
  const n = hit.face.normal.clone();
  if (n.dot(dir) > 0) n.negate();
  return { point: hit.point.clone(), normal: n };
}

/**
 * Hattie's skin: the shared heat-aware skin material with a warmer, earlier blush. The lavender skin goes to a
 * salmon-pink / red (#c2132a at full heat) but keeps a share of its own painted tone (so the cheek highlight and the
 * cleft shadow survive and it reads as flushed skin, not paint). Green and blue leave faster than red arrives, the
 * response is front-loaded, and the blush is remapped so it is gone by the knee.
 */
function warmSkin(rig, dim = 1) {
  const m = rig.skinMaterial();
  const base = m.onBeforeCompile;
  const original = 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.2, 0.18), clamp(uHeat * vRump * 1.15, 0.0, 0.9));';
  // `dim` darkens the blushed colour (not the resting colour) by that factor at full blush: the tail, whose faces tilt up into the
  // sun, would otherwise light up as a pale pink wedge in the middle of the red cleft
  const warm = [
    '{ float rm = smoothstep(0.22, 0.9, vRump);',
    '  float hT = clamp(sqrt(clamp(uHeat * rm * 1.35, 0.0, 1.0)), 0.0, 0.93);',
    '  vec3 sore = mix(vec3(0.78, 0.09, 0.13), diffuseColor.rgb * vec3(1.5, 0.5, 0.58), 0.26);',
    '  vec3 k = vec3(hT, min(1.0, hT * 2.0), min(1.0, hT * 2.6));',
    '  diffuseColor.rgb += (sore - diffuseColor.rgb) * k;',
    `  diffuseColor.rgb *= mix(1.0, ${dim.toFixed(3)}, hT); }`,
  ].join('\n');
  m.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    const f = shader.fragmentShader;
    shader.fragmentShader = f.includes(original) ? f.replace(original, warm) : f.replace('vec3(0.93, 0.2, 0.18)', 'vec3(0.76, 0.075, 0.115)');
  };
  m.customProgramCacheKey = () => `hattie-skin-heat-v5-${dim.toFixed(3)}`;
  return m;
}

export function build(rig, kit) {
  const { parts, mats, limb } = rig;
  parts.head.scale.setScalar(1.8); // a big head
  const { smooth } = kit;
  const skin = warmSkin(rig);
  const cBelly = new THREE.Color(C.belly);
  const cBack = new THREE.Color(C.back);
  const cCrease = new THREE.Color(C.crease);
  const cNail = new THREE.Color(C.nail);
  const cTop = new THREE.Color(C.top);
  const cHilite = new THREE.Color(C.hilite);
  const cCleft = new THREE.Color(C.cleft);

  // Skin: deeper blue-violet on the back, lavender sides, a pale belly band underneath.
  const fur = (x, y, z, nx, ny) => kit.mix(C.side, C.back, smooth(0.3, 0.95, ny)).lerp(cBelly, smooth(-0.05, -0.6, ny) * 0.92);
  // buttocks and legs: no pale underside, so there is no bright seam where the cheek meets the thigh
  const flesh = (x, y, z, nx, ny) => kit.mix(C.side, C.back, smooth(0.25, 0.95, ny)).lerp(cCrease, smooth(0.0, -0.9, ny) * 0.12);
  const paintFur = (g, fn = fur) => kit.paint(g, fn);
  const addSkin = (parent, g, name, o = {}) => kit.add(parent, g, skin, { name, ...o });

  // ---------------------------------------------------------------- torso: a pear-shaped barrel that rests on the pad
  // broad shoulders, a slightly narrower waist, the widest point at the hips so the buttocks grow out of it
  const torso = superLoft(
    [
      { z: -8.6, y: 3.2, rx: 5.2, ry: 3.8, n: 2.4 },
      { z: -6.2, y: 4.9, rx: 7.6, ry: 5.2, n: 2.6 },
      { z: -2.8, y: 5.5, rx: 7.7, ry: 4.9, n: 2.6 },
      { z: 0.4, y: 5.9, rx: 7.1, ry: 4.9, n: 2.6 },
      { z: 3.4, y: 5.6, rx: 8.0, ry: 5.0, n: 2.6 },
      // the visible torso ends at z = 3.4, where the buttocks take over with the very same ring. The last two rings are a core
      // that carries on inside the buttocks (smaller than they are), so the joint can never show a crack or a see-through gap.
      { z: 5.0, y: 5.3, rx: 7.5, ry: 4.5, n: 2.6 },
      { z: 6.2, y: 5.2, rx: 7.8, ry: 4.7, n: 2.5 },
    ],
    { sides: 10, sub: 1, capLen: 0.25, capSteps: 1 },
  );
  // up-ness from the position, not the normal: at the shared ring the torso and the cheeks get exactly the same colour
  const posUp = (y) => Math.max(-1, Math.min(1, (y - 5.6) / 5.0));
  paintFur(torso, (x, y, z, nx, ny) => {
    const k = smooth(0.4, 3.4, z);
    const nyE = ny + (posUp(y) - ny) * k;
    const base = fur(x, y, z, nx, nyE);
    // the pale underside fades out toward the hips and is exactly the buttock colour by z = 3.4, where the buttocks start
    base.lerp(flesh(x, y, z, nx, nyE), smooth(1.0, 3.4, z));
    return base.lerp(cBelly, smooth(-5.5, -9, z) * smooth(0.5, -0.1, ny) * 0.5);
  });
  addSkin(parts.body, torso, 'torso');

  // thick neck that carries the shoulders into the head (the throat shows under the jaw)
  const neck = superLoft(
    [
      { z: -6.0, y: 4.6, rx: 6.6, ry: 5.0, n: 2.4 },
      { z: -9.4, y: 2.4, rx: 5.8, ry: 4.2, n: 2.4 },
      { z: -12.2, y: 0.8, rx: 4.9, ry: 3.4, n: 2.4 },
    ],
    { sides: 8, sub: 1, capStart: 'none', capEnd: 'flat' },
  );
  paintFur(neck);
  addSkin(parts.body, neck, 'neck');

  // ---------------------------------------------------------------- the bum
  // The buttocks are the rear half of the barrel, split down the middle (see rumpLoft). Each cheek has its own pivot at the seam
  // where it joins the hips, so a puff swells it backward and never opens the joint.
  // The second key is the torso's last visible ring (same numbers, z 3.4) 0.05 bigger, and the first key starts 1.2 inside the
  // torso, so the buttocks rise out of the torso at a steep angle and continue it with no ledge, hem or shard; behind that ring
  // the torso carries on inside them as a smaller core. Two meshes that merely touch along an edge leave a dark hairline crack
  // (and two that cross at a shallow angle a dotted one), so the cheeks overlap the torso instead. They only scale about that
  // ring (see the puff re-weighting), so a puff or a kick can't pull them off the torso.
  // Behind the hip crest (z 5.9) the cleft opens: the midline sinks into a valley (dip) and the walls part at the bottom (gap).
  // The rings are drawn up (bottom edge at y about 0.3, hidden inside the thigh) so the buttocks sit on the thighs like hams.
  const cheekKeys = [
    { z: 2.2, gap: 0, xOut: 6.45, cy: 5.72, ry: 3.76, n: 2.6, h: 0, bulge: 0, dip: 0 }, // 1.2 inside the torso (hidden)
    { z: 3.4, gap: 0, xOut: 8.05, cy: 5.6, ry: 5.05, n: 2.6, h: 0, bulge: 0, dip: 0 }, // the torso's last ring, 0.05 outside it
    { z: 5.9, gap: 0, xOut: 9.0, cy: 5.1, ry: 5.4, n: 2.5, h: 0, bulge: 0, dip: 0, round: 0.4 },
    // (rounder underneath: n close to 2 and a smaller h, so the cheek curls under like a real buttock and rolls onto the thigh
    // instead of ending in a flat shelf with a pointed corner)
    { z: 7.9, gap: 0.5, xOut: 9.3, cy: 4.9, ry: 4.8, n: 2.1, h: 0.2, bulge: 0, dip: 1.3, round: 1 },
    { z: 9.2, gap: 1.0, xOut: 9.4, cy: 4.6, ry: 4.5, n: 2.1, h: 0.3, bulge: 0, dip: 2.2, round: 1 },
    { z: 10.6, gap: 1.5, xOut: 9.2, cy: 4.3, ry: 4.2, n: 2.1, h: 0.45, bulge: 0.1, dip: 2.9, round: 1 },
    { z: 12.2, gap: 2.0, xOut: 8.6, cy: 4.0, ry: 3.8, n: 2.1, h: 0.6, bulge: 0.3, dip: 3.0, round: 1 },
    { z: 13.5, gap: 2.0, xOut: 7.2, cy: 3.8, ry: 3.1, n: 2.3, h: 0.8, bulge: 0.4, dip: 2.5, round: 1 },
  ];
  const cheekGeo = rumpLoft(cheekKeys, { capLen: 0.45, capSteps: 2 });
  paintFur(cheekGeo, (x, y, z, nx, ny) => {
    const nyE = posUp(y) + (ny - posUp(y)) * smooth(3.4, 5.6, z); // same colour as the torso on the shared ring (see posUp)
    const base = flesh(x, y, z, nx, nyE);
    // a pale lavender highlight on the crown of each cheek (not across the seam)
    base.lerp(cHilite, smooth(0.3, 0.85, ny) * smooth(7.0, 10.5, z) * smooth(2.5, 5.5, x) * 0.85);
    // the underside of each cheek never sees the sun: a lighter paint there keeps it from ending in a dark hem above the thigh
    base.lerp(cHilite, smooth(-0.15, -0.75, ny) * smooth(5.0, 8.0, z) * smooth(8.0, 3.0, Math.abs(x)) * 0.5);
    // the cleft: a dark valley that runs from the tail root down the middle, wide enough to read from the game camera
    base.lerp(cCleft, smooth(4.4, 0.8, Math.abs(x)) * smooth(7.2, 9.6, z) * 0.9);
    return base;
  });
  // The two cheeks overlap along the midline of the back (see rumpLoft) and cross at a very shallow angle there, which at a
  // distance z-fights into a dotted line. A depth bias on the left cheek's material makes the right cheek win the overlap
  // every time, so the crossing is one clean line.
  const skinL = warmSkin(rig);
  skinL.polygonOffset = true;
  skinL.polygonOffsetFactor = 1;
  skinL.polygonOffsetUnits = 8;
  addSkin(parts.rumpR, cheekGeo, 'cheekR');
  kit.add(parts.rumpL, kit.mirrorX(cheekGeo), skinL, { name: 'cheekL' });

  // stubby tail: a short tapered wedge (four flat faces, no ball at the end), a third smaller than before, that grows out of the
  // valley of the sacrum where the cleft begins and points down and back along the slope of the cleft, so it nestles between the
  // cheeks instead of standing up from them. It is painted in the cleft's own shadow colour at the root and never lighter than
  // the cheek around it, and it is on the blushing skin material, so on a sore bum it goes red exactly like the cleft.
  const tail = kit.loft({
    spine: [[0, 0.45, -1.0], [0, 0.05, -0.05], [0, -0.55, 0.85], [0, -1.15, 1.55]],
    radii: [[1.25, 0.9], [1.1, 0.8], [0.8, 0.58], [0.46, 0.34]],
    sides: 4,
    twist: Math.PI / 4,
    stations: 3,
    up: [0, 1, 0],
    capStart: 'none',
    capEnd: 'round',
    capSteps: 1,
  });
  kit.paint(tail, (x, y, z, nx, ny) => cCleft.clone().lerp(cBack, smooth(-0.3, 1.6, z) * 0.35));
  kit.add(parts.tail, tail, warmSkin(rig, 0.68), { name: 'tail' });

  // ---------------------------------------------------------------- head (head-local coordinates, scaled 1.8)
  // one continuous loft from the back of the skull to the front of the muzzle: a domed cranium, a sloping forehead
  // and a wide, tall, square snout that is wider than the cranium. Lighter lavender on top of the snout and a pale
  // jaw below the smile line, so it reads from above and from the front.
  // smirk line: corners lifted, the viewer's-left side (character's right) lifted a touch more
  const mouthY = (x) => -2.5 + 0.06 * x * x + 0.14 * x;
  const skull = superLoft(
    [
      { z: 3.4, y: 0.3, rx: 3.4, ry: 2.7, n: 2.3 },
      { z: 1.2, y: 0.9, rx: 4.25, ry: 3.6, n: 2.4 },
      { z: -1.3, y: 0.9, rx: 4.45, ry: 3.8, n: 2.6 },
      // (a touch narrower than before so the mitts lying beside the jaw show from above)
      { z: -3.1, y: -0.4, rx: 4.75, ry: 3.7, n: 3.2 },
      { z: -4.9, y: -1.0, rx: 4.65, ry: 3.45, n: 3.6 },
      { z: -5.9, y: -1.05, rx: 4.35, ry: 3.15, n: 3.6 },
    ],
    { sides: 12, sub: 1, capStart: 'dome', capEnd: 'flat', capLen: 0.5, capSteps: 1 },
  );
  // (the back of the skull is closed with a dome, the snout with a flat face)
  paintFur(skull, (x, y, z, nx, ny, nz) => {
    const base = fur(x, y, z, nx, ny);
    // toward the back of the skull the colour hands over to the shoulders' exact back colour, so the seam is invisible
    base.lerp(cBack, smooth(-0.8, 2.4, z) * smooth(-0.5, 0.4, ny));
    const mz = smooth(-1.9, -3.6, z); // 0 on the cranium, 1 on the snout
    // a snout top a shade lighter than the back so a wide square hippo muzzle reads from above (but never near-white)
    base.lerp(cTop, smooth(0.2, 0.75, ny) * mz * 0.95);
    base.lerp(cBelly, mz * 0.1);
    // pale jaw below the smile line
    base.lerp(cBelly, smooth(0.3, -0.5, y - mouthY(x)) * mz * 0.85);
    return base;
  });
  addSkin(parts.head, skull, 'skull');

  // pink lip line: a thin lip pressed into the snout surface (found by raycast), curling up into a smirk
  {
    const centre = new THREE.Vector3(0, -1.4, -3.9);
    const pts = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const phi = THREE.MathUtils.degToRad(-62 + (124 * i) / steps);
      const flat = new THREE.Vector3(Math.sin(phi), 0, -Math.cos(phi));
      const h1 = surfaceHit(skull, centre, flat);
      if (!h1) continue;
      const aim = new THREE.Vector3(h1.point.x, mouthY(h1.point.x), h1.point.z).sub(centre);
      const h2 = surfaceHit(skull, centre, aim);
      if (!h2) continue;
      pts.push(h2.point.clone().addScaledVector(h2.normal, -0.09).toArray());
    }
    const lip = kit.loft({
      spine: pts,
      radii: [[0.08, 0.1], [0.24, 0.3], [0.28, 0.35], [0.24, 0.3], [0.08, 0.1]],
      sides: 6,
      stations: 14,
      up: [0, 1, 0],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 1,
    });
    kit.paint(lip, C.lip);
    kit.add(parts.head, lip, mats.matte, { name: 'lip' });
  }

  // a slim pink lip rim along the front edge of the muzzle top: the smile line on the front face cannot be seen from above, so
  // this is what tells the viewer at game scale that the wide square thing is a muzzle with lips
  {
    const e = 2 / 3.6;
    const ring = (deg) => {
      const a = (deg / 360) * TAU;
      return [4.35 * sgnPow(Math.sin(a), e), -1.05 + 3.15 * sgnPow(Math.cos(a), e)];
    };
    const spine = [-75, -45, -15, 15, 45, 75].map((d) => ring(d)).map((p) => [p[0], p[1] + 0.02, -5.96]);
    const rim = kit.loft({
      spine,
      radii: [[0.09, 0.11], [0.13, 0.15], [0.15, 0.17], [0.15, 0.17], [0.13, 0.15], [0.09, 0.11]],
      sides: 6,
      stations: 8,
      up: [0, 0, -1],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 1,
    });
    kit.paint(rim, C.lip);
    kit.add(parts.head, rim, mats.matte, { name: 'lipRim' });
  }

  // nostrils: two small, flat, snout-coloured bumps right at the front edge of the muzzle, the dark slit almost filling each
  // one. They are tiny, dark and far from the real eyes, so they read as nostrils and never as a second pair of eyes.
  for (const s of [-1, 1]) {
    const hit = surfaceHit(skull, new THREE.Vector3(s * 1.5, 9, -5.35), new THREE.Vector3(0, -1, 0));
    if (!hit) continue;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hit.normal);
    const e = new THREE.Euler().setFromQuaternion(q);
    const bump = kit.ellipsoid(0.66, 0.32, 0.52, { detail: 1 });
    kit.paint(bump, (x, y) => kit.mix(C.top, C.nose, 0.55 + smooth(0.2, -0.2, y) * 0.3));
    addSkin(parts.head, bump, 'nostril', { pos: hit.point.toArray(), rot: [e.x, e.y, e.z] });
    const hole = kit.ellipsoid(0.5, 0.12, 0.26, { detail: 1 });
    kit.paint(hole, C.slit);
    const hc = hit.point.clone().addScaledVector(hit.normal, 0.2);
    addSkin(parts.head, hole, 'nostrilHole', { pos: hc.toArray(), rot: [e.x, e.y, e.z + s * 0.3] });
  }

  // ---------------------------------------------------------------- eyes, half-lids, lashes, brows
  // Big bright eyes: a white eyeball set into the skull with a modest dark pupil (white all around it), tipped up
  // toward the viewer, under a heavy, glossy, violet-lavender half-lid that covers the top ~40% and is edged by a dark
  // liner on the front: knowing and sassy, not startled. Lashes are short and sweep outward and back from the outer corner.
  const EYE_TILT = 1.3;
  const eyeDir = (x, y, z) => new THREE.Vector3(x, y, z).applyEuler(new THREE.Euler(EYE_TILT, 0, 0)).toArray();
  const LID = { sx: 1.62, sy: 1.62, sz: 1.48, theta: 1.0 };
  const lidTilt = new THREE.Euler(EYE_TILT - 0.35, 0, -0.1); // tipped back from the eye: the rim sits just over the top of the pupil
  const lidQ = new THREE.Quaternion().setFromEuler(lidTilt);
  const eyeLidGeo = () => {
    const cap = new THREE.SphereGeometry(1, 10, 4, 0, TAU, 0, LID.theta);
    cap.deleteAttribute('uv');
    cap.scale(LID.sx, LID.sy, LID.sz);
    cap.computeVertexNormals();
    // the lid is skin (painted with the same function as the skull, in the head frame), so it merges with the head
    kit.place(cap, { rot: [lidTilt.x, lidTilt.y, lidTilt.z] });
    kit.paint(cap, (x, y, z, nx, ny) => fur(x, y, z, nx, ny).lerp(cHilite, smooth(0.5, 0.95, ny) * 0.18));
    const yRim = LID.sy * Math.cos(LID.theta);
    const rRim = (LID.sx + LID.sz) * 0.5 * Math.sin(LID.theta);
    // everything below is built in the head frame (the lid tilt is applied to the points)
    const onRim = (phi, lift = 0) => new THREE.Vector3(Math.cos(phi) * rRim, yRim + lift, -Math.sin(phi) * rRim).applyQuaternion(lidQ);
    // dark lid line along the front edge of the lid, from the outer corner round to the inner corner
    const linePts = [];
    for (let i = 0; i <= 8; i++) linePts.push(onRim(-0.25 + (Math.PI + 0.5) * (i / 8), -0.02).toArray());
    const liner = kit.loft({
      spine: linePts,
      radii: [[0.13, 0.13], [0.15, 0.15], [0.15, 0.15], [0.13, 0.13]],
      sides: 4,
      stations: 8,
      up: [0, 1, 0],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 1,
    });
    kit.paint(liner, C.liner);
    const list = [cap, liner];
    // three short lashes from the outer corner, swept outward and back (built for the right eye)
    for (const [phi, len, back] of [[0.0, 0.85, 0.55], [0.4, 1.0, 0.4], [0.8, 0.85, 0.25]]) {
      const base = onRim(phi, -0.05);
      const dir = new THREE.Vector3(0.82, 0.05, back).normalize();
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const at = (a, h) => base.clone().addScaledVector(dir, a * len).addScaledVector(new THREE.Vector3(0, 1, 0), h * len).toArray();
      const lash = kit.loft({
        spine: [at(0, 0), at(0.4, 0.03), at(0.75, 0.12), at(1, 0.3)],
        radii: [[0.15, 0.17], [0.11, 0.13], [0.05, 0.06]],
        sides: 4,
        stations: 3,
        up: side.toArray(),
        capStart: 'none',
        capEnd: 'round',
        capSteps: 1,
      });
      kit.paint(lash, C.liner);
      list.push(lash);
    }
    return kit.merge(list);
  };
  const lidR = eyeLidGeo();
  const lidL = kit.mirrorX(lidR);
  // soft lower lid: pushes up under the eye for a smug, confident squint line
  const lowerLid = (() => {
    const g = new THREE.SphereGeometry(1, 10, 3, 0, TAU, Math.PI - 0.6, 0.6);
    g.deleteAttribute('uv');
    g.scale(1.62, 1.66, 1.52);
    g.computeVertexNormals();
    kit.paint(g, (x, y, z, nx, ny) => kit.mix(C.side, C.lid, smooth(-0.9, -0.3, ny) * 0.8));
    kit.place(g, { rot: [EYE_TILT, 0, 0] });
    return g;
  })();

  const pupilMat = rig.plain('#15151c', { roughness: 0.5 });
  for (const [eye, sign, lid] of [[parts.eyeL, -1, lidL], [parts.eyeR, 1, lidR]]) {
    kit.add(eye, kit.ellipsoid(1.45, 1.48, 1.35, { detail: 2 }), mats.eyeWhite, { name: 'eyeWhite' });
    // dark pupils glance to one side (the same way in both eyes: a sly side-eye), tucked under the lid
    kit.add(eye, kit.ellipsoid(0.74, 0.78, 0.45, { detail: 2 }), pupilMat, { pos: eyeDir(0.3, -0.23, -1.06), rot: [EYE_TILT, 0, 0], name: 'pupil' });
    kit.add(eye, kit.ellipsoid(0.2, 0.2, 0.12, { detail: 1 }), mats.glint, { pos: eyeDir(0.3 + 0.3, 0.15, -1.5), name: 'glint' });
    kit.add(eye, kit.ellipsoid(0.1, 0.1, 0.06, { detail: 1 }), mats.glint, { pos: eyeDir(0.3 - 0.28, -0.57, -1.52), name: 'glint2' });
    kit.add(eye, lid, mats.matte, { name: 'lid' });
    kit.add(eye, lowerLid, mats.matte, { name: 'lowerLid' });
  }

  // brows: a short, thick, low ridge lying on the lid (30% shorter than before, sunk onto the lid so it never stands off the
  // skull like a horn), its inner end held a touch high for a smug raised-brow look (built for the right brow). The rig lifts and
  // tilts it when she strains; update() at the end of build() keeps that small enough that the ridge stays on the lid.
  const ridge = kit.loft({
    spine: [[-0.85, 0.12, 0.1], [-0.28, 0.32, 0], [0.28, 0.36, 0], [0.77, 0.26, 0], [1.12, 0.06, 0.1]],
    radii: [[0.16, 0.26], [0.24, 0.34], [0.27, 0.36], [0.23, 0.31], [0.14, 0.2]],
    sides: 6,
    stations: 5,
    up: [0, 0, 1],
    capStart: 'round',
    capEnd: 'round',
    capSteps: 1,
  });
  kit.paint(ridge, (x, y, z, nx, ny) => kit.mix(C.brow, C.side, smooth(0.0, -0.9, ny) * 0.4));
  kit.add(parts.browR, ridge, mats.matte, { name: 'brow' });
  kit.add(parts.browL, kit.mirrorX(ridge), mats.matte, { name: 'brow' });

  // ears: small rounded-pointed ovals, thick rather than flat (25% thicker than before), set behind and outside the eyes, a
  // little low in the skull, and tipped back and out so the pink inside faces up and forward: it shows from above (the game
  // camera) and from the front and the side
  const earOutline = [[-1.0, 0], [-1.15, 0.8], [-0.9, 1.6], [-0.3, 2.15], [0.3, 2.15], [0.9, 1.6], [1.15, 0.8], [1.0, 0]];
  const earInnerOutline = [[-0.62, 0.2], [-0.75, 0.8], [-0.52, 1.35], [0, 1.7], [0.52, 1.35], [0.75, 0.8], [0.62, 0.2]];
  const earShell = kit.extrude(earOutline, 0.56, { bevel: 0.22 });
  kit.paint(earShell, (x, y, z, nx, ny) => kit.mix(C.side, C.back, smooth(0.2, 1.0, ny) * 0.5));
  const earInner = kit.extrude(earInnerOutline, 0.18, { bevel: 0.08 });
  kit.paint(earInner, C.pink);
  kit.place(earInner, { pos: [0, 0, -0.46] });
  for (const [ear, sign] of [[parts.earL, -1], [parts.earR, 1]]) {
    const tilt = { rot: [0.6, -sign * 0.3, -sign * 0.3], scale: [0.85, 0.85, 0.85] };
    kit.add(ear, earShell, mats.matte, { name: 'ear', ...tilt });
    kit.add(ear, earInner, mats.matte, { name: 'earInner', shadow: false, ...tilt });
  }

  // ---------------------------------------------------------------- arms: shoulder, elbow, forearm, wrist, mitt
  const pawSkin = (x, y, z, nx, ny) => kit.mix(C.side, C.back, smooth(0.0, 0.9, ny)).lerp(cBelly, smooth(-0.3, -0.9, ny) * 0.55);
  const makePaw = ({ dir, width, len, thick, toes, toeLen, toeR, fan, sole = false, droop = 0.1 }) => {
    const skinFor = (x, y, z, nx, ny) => {
      const base = pawSkin(x, y, z, nx, ny);
      return sole ? base.lerp(new THREE.Color(C.sole), smooth(-0.1, -0.7, ny) * 0.9) : base;
    };
    const palm = superLoft(
      [
        { z: 0, y: 0, rx: width * 0.86, ry: thick * 1.15, n: 2.4 },
        { z: dir * len * 0.5, y: 0, rx: width, ry: thick, n: 2.8 },
        { z: dir * len, y: -0.05, rx: width * 0.97, ry: thick * 0.85, n: 3.0 },
      ],
      { sides: 8, sub: 1, capLen: 0.3, capStart: 'dome', capEnd: 'none', capSteps: 1 },
    );
    kit.paint(palm, skinFor);
    const list = [palm];
    const spacing = (width * 1.7) / toes;
    for (let i = 0; i < toes; i++) {
      const k = i - (toes - 1) / 2;
      const x0 = k * spacing;
      const z0 = dir * (len - 0.4);
      const ang = k * fan;
      const d = [Math.sin(ang), 0, dir * Math.cos(ang)];
      const at = (a) => [x0 + d[0] * toeLen * a, -0.05 - droop * toeLen * a, z0 + d[2] * toeLen * a];
      const toe = kit.loft({
        spine: [at(0), at(0.55), at(1)],
        radii: [[toeR * 1.0, toeR * 0.88], [toeR * 1.04, toeR * 0.86], [toeR * 0.92, toeR * 0.78]],
        sides: 8,
        stations: 2,
        capStart: 'none',
        capEnd: 'round',
        capSteps: 2,
      });
      // pale rounded toe-tip instead of a separate nail bead
      kit.paint(toe, (px, py, pz, nx, ny) => {
        const along = ((px - x0) * d[0] + (pz - z0) * d[2]) / toeLen;
        return skinFor(px, py, pz, nx, ny).lerp(cNail, smooth(0.8, 1.0, along) * 0.75 * (0.5 + 0.5 * smooth(-0.3, 0.5, ny)));
      });
      list.push(toe);
    }
    return kit.merge(list);
  };

  // arm: thick short upper arm, a clearly bent elbow, forearm tapering to a visible wrist, then a chunky mitt
  for (const [pivot, side, vec] of [[parts.armL, -1, limb.arm.L], [parts.armR, 1, limb.arm.R]]) {
    const ax = Math.abs(vec[0]);
    const elbow = [side * (ax * 0.55 + 0.1), vec[1] * 0.58, vec[2] * 0.24];
    const fore = [vec[0] * 0.55, vec[1] * 0.8, vec[2] * 0.66];
    const wrist = [vec[0], vec[1], vec[2]];
    const arm = kit.loft({
      spine: [[0, 0, 0], [elbow[0] * 0.45, elbow[1] * 0.4, elbow[2] * 0.4], elbow, fore, wrist],
      radii: profile([[0, 3.25, 3.4], [0.2, 3.1, 3.2], [0.4, 2.85, 2.9], [0.55, 2.55, 2.5], [0.8, 2.05, 2.0], [0.94, 1.8, 1.75], [1, 1.95, 1.85]]),
      sides: 8,
      stations: 7,
      up: [0, 0, 1],
    });
    const lenAlong = (x, y, z) => {
      // normalized progress along the arm polyline, from the dominant direction
      const vv = vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2];
      return (x * vec[0] + y * vec[1] + z * vec[2]) / vv;
    };
    paintFur(arm, (x, y, z, nx, ny) => {
      const t = lenAlong(x, y, z);
      const elbowCrease = Math.exp(-(((t - 0.44) / 0.05) ** 2)) * 0.2;
      const wristBand = Math.exp(-(((t - 0.93) / 0.05) ** 2)) * 0.38;
      return fur(x, y, z, nx, ny).lerp(cCrease, elbowCrease + wristBand);
    });
    addSkin(pivot, arm, 'arm');
    const paw = makePaw({ dir: -1, width: 1.72, len: 2.4, thick: 1.25, toes: 4, toeLen: 1.55, toeR: 0.76, fan: 0.1 });
    addSkin(pivot, paw, 'paw', { pos: [vec[0], vec[1] - 0.36, vec[2] + 0.1] });
  }

  // ---------------------------------------------------------------- hind legs
  // a real thigh that grows out from under the cheek and tapers to a knee (with a kneecap), a calf and a narrow ankle about 60%
  // as wide as the thigh, and a broad foot with four chunky toes that droop down and out (a darker sole shows from behind).
  for (const [pivot, side, vec] of [[parts.legL, -1, limb.leg.L], [parts.legR, 1, limb.leg.R]]) {
    // the top of the leg starts 2.8 above its pivot, well inside the cheek, so no ring of it can poke out of the buttock; it is
    // widest just under the cheek (a ham that the rolled-under cheek sits on) and tapers to the knee. The two thighs cross the
    // midline a little and the inner side of the calf stays full down to the ankle, so nothing (the red pad, the tube) shows
    // through between them under the cleft; the V between the legs only opens at the ankles.
    const leg = legLoft(LEG_KEYS, { sides: 10 });
    paintFur(leg, (x, y, z, nx, ny) => {
      const base = flesh(x, y, z, nx, ny);
      base.lerp(cCrease, Math.exp(-(((y + 3.7) / 0.3) ** 2)) * 0.4); // the crease under the knee
      base.lerp(cCrease, Math.exp(-(((y + 6.45) / 0.3) ** 2)) * 0.34); // ankle band
      return base;
    });
    addSkin(pivot, side > 0 ? leg : kit.mirrorX(leg), 'leg');
    // the kneecap: a low, rounded wedge on the outer side of the knee (it stands out of the leg by about 0.4, on the outside, so
    // it is nowhere near the tube), so the knee reads from behind as well as from the side
    const kneeOutline = Array.from({ length: 10 }, (_, i) => [1.5 * Math.cos((i / 10) * TAU), 1.25 * Math.sin((i / 10) * TAU)]);
    const kneecap = kit.extrude(kneeOutline, 0.5, { bevel: 0.5 });
    kit.paint(kneecap, (x, y, z, nx, ny, nz) => flesh(x, y, z, nx, ny).lerp(cHilite, smooth(0.3, 0.95, nz) * 0.3));
    addSkin(pivot, kneecap, 'kneecap', { pos: [side * 3.3, -2.9, 0.1], rot: [0, side * Math.PI / 2, 0.15 * side] });
    // the foot: 17% bigger than before, a broad sole with four chunky toes that droop down and out
    const foot = makePaw({ dir: 1, width: 3.25, len: 2.8, thick: 1.5, toes: 4, toeLen: 1.9, toeR: 1.15, fan: 0.12, sole: true, droop: 0.3 });
    kit.place(foot, { rot: [0.5, 0, 0] });
    // toe-out: the feet point a little outward, like a hippo's
    addSkin(pivot, foot, 'foot', { pos: [side * -0.2, vec[1] - 0.6, vec[2] - 2.35], rot: [0, side * 0.34, 0] });
  }

  // ---------------------------------------------------------------- puff re-weighting
  // The shared rig puffs each cheek with one uniform scale and also slides it back, which turns a wide rump into a bigger
  // ball and pulls the cheek off the torso (a ledge). A fart or a full charge should instead swell the buttocks mostly
  // backward (and only a little up, down and sideways) about the seam where they join the hips, so the cleft stays and the
  // joint never opens. Re-weight that scale per axis, and pin the cheek to its pivot, right after the rig has set it. The
  // kick itself (legs swinging out) is left entirely to the shared rig.
  const baseUpdate = rig.update.bind(rig);
  const seam = [5.6, 5.4, 3.4]; // the cheeks scale about this point (right cheek; x is mirrored for the left)
  const browRestY = { L: rig.pivotPos.browL[1], R: rig.pivotPos.browR[1] };
  rig.update = (dt, state) => {
    baseUpdate(dt, state);
    const f = rig.flick;
    const ch = rig.chargeLevel;
    for (const cheek of [parts.rumpL, parts.rumpR]) {
      const k = cheek.scale.x - 1;
      // a full charge swells the buttocks a little sideways as well (the bum visibly widens while she builds up to a blast)
      const sx = 1 + k * 0.1 + 0.1 * ch;
      const sy = 1 + (cheek.scale.y - 1) * 0.1 + f * 0.01 + 0.03 * ch;
      const sz = 1 + k * 0.8 + f * 0.1;
      cheek.scale.set(sx, sy, sz);
      // scaling about the seam point c: p' = s * p + c * (1 - s), so the position carries c * (1 - s) (zero at rest)
      const cx = cheek === parts.rumpL ? -seam[0] : seam[0];
      cheek.position.set(cx * (1 - sx), seam[1] * (1 - sy), seam[2] * (1 - sz));
    }
    // The brows lie on the lids. The shared rig tilts them hard and lifts / drops them by half a unit when she strains or her eyes
    // bulge, which, on a ridge this short, would swing it off the skull like a horn. Keep the tilt small, and make the ridge ride
    // on the lid itself: the eyes squash about their centre when she strains (and swell when they bulge), and the brow keeps its
    // height above the eye's centre in the same proportion, so it never stands off the skull in any pose.
    const squint = Math.min(1 - 0.6 * ch, 1 - 0.3 * smooth(0.55, 1, rig.heatLevel));
    const eyeScaleY = squint * (1 + rig.bulge * 0.3);
    const eyeY = rig.pivotPos.eyeR[1];
    for (const [brow, key] of [[parts.browL, 'L'], [parts.browR, 'R']]) {
      brow.rotation.z *= 0.4;
      brow.position.y = eyeY + (browRestY[key] - eyeY) * eyeScaleY;
    }
    // The charge splays the hind legs outward; the thighs would open the gap under the cleft and show the pad through it.
    parts.legL.rotation.z *= 0.15;
    parts.legR.rotation.z *= 0.15;
  };
}
