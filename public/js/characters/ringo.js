import * as THREE from '../../vendor/three.min.js';

/**
 * King Ringo XIII, the ring-tailed lemur.
 * A lean grey body (slim waist, broad ribcage) with a white belly, a big head tipped up toward the camera: a white
 * mask with big black eye patches, big white eyes with dark-brown irises under heavy smug lids, a long narrow pointed
 * snout and a one-sided smirk. A huge ringed tail leaves the sacrum and loops over in a big S, grey long-fingered hands
 * and chunky long-toed feet, and the gold crown: a snug circlet with a peak and a gem at the front, a tuft of fur
 * inside it and a fan of nine tall green leaves with yellow-orange tips standing nearly upright. Everything is chunky,
 * flat-shaded low poly like the reference game.
 */

const HEAD_SCALE = 2.5;
const HEAD_TILT = 0.55; // the chin lifts, smug-style, so the camera sees the white mask from above
const tiltPos = ([x, y, z]) => [
  x,
  y * Math.cos(HEAD_TILT) - z * Math.sin(HEAD_TILT),
  y * Math.sin(HEAD_TILT) + z * Math.cos(HEAD_TILT),
];

// Head-local design coordinates (before the tilt).
const EYE = [1.5, 0.9, -2.8];
const BROW = [1.2, 2.3, -2.5]; // starting guess only: build() re-centres each brow pivot on its own geometry
const EAR = [2.2, 3.0, 0.1];
const CHEEK_X = 2.0; // rump pivot x: the two cheeks meet at the centre line

export const spec = {
  id: 'ringo',
  browRest: 0.0,
  eyeOpen: 0.92,
  padColor: '#a93338', // a deeper crimson than the default, so the cheeks stay readable against the pad when they blush
  pivots: {
    head: [0, 2.8, -8.3],
    armL: [-5.2, 4.7, -7.0],
    armR: [5.2, 4.7, -7.0],
    legL: [-3.3, 3.0, 10.0],
    legR: [3.3, 3.0, 10.0],
    tail: [1.0, 7.8, 10.4],
    rumpL: [-CHEEK_X, 4.2, 12.0],
    rumpR: [CHEEK_X, 4.2, 12.0],
    anus: [0, 3.4, 14.4],
    eyeL: tiltPos([-EYE[0], EYE[1], EYE[2]]),
    eyeR: tiltPos([EYE[0], EYE[1], EYE[2]]),
    browL: tiltPos([-BROW[0], BROW[1], BROW[2]]),
    browR: tiltPos([BROW[0], BROW[1], BROW[2]]),
    earL: tiltPos([-EAR[0], EAR[1], EAR[2]]),
    earR: tiltPos([EAR[0], EAR[1], EAR[2]]),
  },
  pawTarget: [7.3, -3.8, -13.5],
  footTarget: [4.3, -9.2, 11.8],
  rump: { center: [0, 4.4, 12.2], radius: 4.4 },
};

const C = {
  fur: '#8d9099',
  furDark: '#565963',
  furLight: '#b0b3bb',
  white: '#ebebe9',
  whiteShade: '#c5c8cf',
  black: '#16161b',
  ringBlack: '#18181e',
  ringWhite: '#f4f4f2',
  pad: '#6f6264',
  padDark: '#4a4144',
  tip: '#d6d8de',
  warm: '#cfa79c',
  crease: '#454650',
  earIn: '#efe1dd',
  lidTop: '#2c2d36', // a shade lighter than the patch, so the lid reads as a lid and not as more patch
  lidBottom: '#25262d',
  irisAmber: '#6b4a1c', // a warm dark brown, so the white of the eye and the black pupil both stay readable
  gold: '#f5b01c',
  goldLight: '#ffe56b',
  goldDark: '#b0690a',
  green: '#3fb53a',
  greenDark: '#2a8b2c',
  lime: '#9ed93a',
  yellow: '#f6dc2e',
  orange: '#f08a1c',
};

/** Radii interpolated by spine control-point index, so each knot lands exactly on its control point. */
function profile(spine, knots) {
  const curve = new THREE.CatmullRomCurve3(spine.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  const n = spine.length - 1;
  const at = (f) => {
    let i = 0;
    while (i < knots.length - 2 && f > knots[i + 1][0]) i++;
    const a = knots[i];
    const b = knots[i + 1];
    const k = Math.min(1, Math.max(0, (f - a[0]) / (b[0] - a[0])));
    const s = k * k * (3 - 2 * k);
    return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  };
  const fn = (t) => at(Math.min(n, Math.max(0, curve.getUtoTmapping(t) * n)));
  fn.curve = curve;
  fn.at = at;
  fn.n = n;
  return fn;
}

/** Piecewise-linear lookup: keys must be ascending. */
const lookup = (keys, vals, x) => {
  if (x <= keys[0]) return vals[0];
  for (let i = 0; i < keys.length - 1; i++) {
    if (x <= keys[i + 1]) return vals[i] + ((vals[i + 1] - vals[i]) * (x - keys[i])) / (keys[i + 1] - keys[i]);
  }
  return vals[vals.length - 1];
};

export function build(rig, kit) {
  const { parts, mats, limb } = rig;
  const { mix, smooth } = kit;

  /* ---------- skin: the shared heat-aware fur, with a warm pink-red blush for the sore bum ---------- */
  const skin = rig.skinMaterial();
  const baseCompile = skin.onBeforeCompile;
  const soreRed = new THREE.Color('#ee6c64');
  const soreVec = `vec3(${soreRed.r.toFixed(4)}, ${soreRed.g.toFixed(4)}, ${soreRed.b.toFixed(4)})`;
  skin.onBeforeCompile = (shader, renderer) => {
    baseCompile(shader, renderer);
    // never more than ~60% blush: the fur and the cheek facets stay readable, so the bum never turns into a red blob
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3(0.93, 0.2, 0.18), clamp(uHeat * vRump * 1.15, 0.0, 0.9)',
      `${soreVec}, clamp(pow(uHeat, 0.3) * vRump * 0.64, 0.0, 0.6)`,
    );
  };
  skin.customProgramCacheKey = () => 'ringo-skin-heat-v3';
  // The blush is driven by this module's own per-vertex mask (a hot spot on each cheek), not the rig-wide sphere.
  skin.userData.skin = false;

  /**
   * How red this spot of the rest pose goes when sore: a hot spot on the crown and the outer-lower part of each cheek
   * that fades out over ~2.5 units, clearly dying away toward the cleft (x near 0), the thigh and the hip.
   */
  const bumMask = (x, y, z) => {
    let d = Infinity;
    for (const s of [-1, 1]) d = Math.min(d, Math.hypot((x - s * 2.6) * 0.95, (y - 3.8) * 0.85, (z - 13.2) * 0.9));
    return (1 - smooth(1.0, 3.8, d)) * smooth(0.55, 1.9, Math.abs(x)) * smooth(10.6, 12.6, z) * smooth(0.6, 2.4, y);
  };
  /** Attach geometry to a pivot with the skin material, writing the blush mask from rest-pose world positions. */
  const addSkin = (parent, geo, origin, mask, name) => {
    const pos = geo.attributes.position;
    const values = new Float32Array(pos.count);
    if (mask) for (let i = 0; i < pos.count; i++) values[i] = mask(pos.getX(i) + origin[0], pos.getY(i) + origin[1], pos.getZ(i) + origin[2]);
    geo.setAttribute('rump', new THREE.BufferAttribute(values, 1));
    return kit.add(parent, geo, skin, { name });
  };
  const ZERO = [0, 0, 0];

  /* ---------- torso: broad ribcage, slim waist, hips ---------- */
  const torsoSpine = [[0, 3.4, -9.6], [0, 4.6, -7.2], [0, 4.9, -3.4], [0, 4.5, 0.6], [0, 4.8, 4.4], [0, 5.2, 7.2], [0, 5.1, 8.8]];
  const torso = kit.loft({
    spine: torsoSpine,
    // a broader pelvis (x 4.5 / 5.7 / 4.7 at the hips) so the cheeks sit inside the hips instead of hanging off them
    radii: profile(torsoSpine, [[0, 3.4, 3.2], [1, 5.9, 4.7], [2, 5.0, 4.3], [3, 3.0, 3.2], [4, 4.5, 3.7], [5, 5.7, 4.1], [6, 4.7, 3.4]]),
    sides: 10,
    stations: 10,
    capSteps: 2,
    twist: Math.PI / 10,
  });
  kit.paint(torso, (x, y, z, nx, ny) => {
    let c = mix(C.furDark, C.fur, smooth(0.95, 0.3, ny)); // dark back and shoulders
    c = mix(c, C.furDark, (1 - smooth(0.0, 1.1, Math.abs(x))) * smooth(0.55, 0.95, ny) * 0.7); // a darker stripe along the spine, so the back reads against the water
    c = mix(c, C.furLight, smooth(0.2, -0.4, ny)); // lighter flanks
    c = mix(c, C.white, smooth(-0.25, -0.75, ny) * smooth(8.0, 4.5, z)); // white belly, fading out before the hips
    c = mix(c, C.white, smooth(-6.8, -9.2, z) * smooth(0.6, -0.1, ny)); // white chest bib
    return c;
  });
  addSkin(parts.body, torso, ZERO, bumMask, 'torso');

  const neck = kit.loft({
    spine: [[0, 4.3, -7.8], [0, 3.1, -9.2], [0, 2.0, -10.2]],
    radii: [[3.3, 3.1], [3.0, 2.8], [2.8, 2.7]],
    sides: 10,
    stations: 4,
    capStart: 'none',
    capEnd: 'none',
  });
  kit.paint(neck, (x, y, z, nx, ny) => mix(C.fur, C.white, smooth(0.3, -0.35, ny)));
  addSkin(parts.body, neck, ZERO, null, 'neck');

  /* ---------- the bum: two firm, faceted buttocks with flat inner faces meeting in a real cleft ---------- */
  // Short, chunky hexagonal wedges (about a quarter smaller than before): a ridge down the back of each cheek, flat
  // inner faces that face each other across the cleft, and a flat-ish underside where the cheek meets the thigh.
  const cheekSpine = [[0.0, 1.7, -1.9], [0.1, 0.7, -0.6], [0.15, -0.5, 0.15], [0.2, -1.9, 0.0]];
  const cheek = kit.loft({
    spine: cheekSpine,
    radii: profile(cheekSpine, [[0, 1.25, 1.25], [1, 1.75, 1.8], [2, 1.85, 1.9], [3, 1.4, 1.4]]),
    sides: 6,
    stations: 4,
    up: [0, 0, 1],
    capSteps: 2,
    twist: 0,
  });
  kit.paint(cheek, (x, y, z, nx, ny, nz) => {
    const wx = x + CHEEK_X; // distance from the centre line
    let c = mix(mix(C.furDark, C.fur, 0.55), C.fur, smooth(0.85, 0.1, ny));
    c = mix(c, C.furLight, smooth(0.1, -0.7, ny) * 0.8);
    c = mix(c, C.warm, 0.06); // the barest warmth: the cheeks read as grey fur, and the sore blush is the only pink
    // the cleft: the inner flat face and the rear edge beside it go dark, deepest in the middle of the cheek's height
    const inner = smooth(0.15, 0.85, -nx) * smooth(1.6, 0.4, wx);
    const rear = smooth(2.0, 0.7, wx) * smooth(0.0, 0.8, nz) * smooth(-2.0, 0.8, y);
    return mix(c, C.crease, Math.max(inner * 0.95, rear * 0.8));
  });
  addSkin(parts.rumpR, cheek.clone(), [CHEEK_X, 4.2, 12.0], bumMask, 'rumpR');
  addSkin(parts.rumpL, kit.mirrorX(cheek), [-CHEEK_X, 4.2, 12.0], bumMask, 'rumpL');

  /* ---------- head: broad cranium into a long pointed snout ---------- */
  parts.head.scale.setScalar(HEAD_SCALE);

  const skullSpine = [[0, 0.75, 0.65], [0, 0.8, -0.7], [0, 0.55, -2.2], [0, 0.15, -3.4], [0, -0.2, -3.95], [0, -0.42, -4.4]];
  const skullProf = profile(skullSpine, [[0, 1.8, 2.0], [1, 2.7, 2.9], [2, 2.35, 2.55], [3, 1.4, 1.36], [4, 0.88, 0.85], [5, 0.58, 0.56]]);
  const SKULL_SIDES = 14;
  const makeSkull = () => kit.loft({ spine: skullSpine, radii: skullProf, sides: SKULL_SIDES, stations: 12, capSteps: 2, twist: Math.PI / SKULL_SIDES });
  const skull = makeSkull();
  kit.paint(skull, (x, y, z, nx, ny) => {
    // white muzzle, cheeks and chin; grey cranium and forehead, with the white mask climbing up between the eyes
    const lower = smooth(0.15, -0.55, ny) * smooth(1.4, -0.5, z);
    const face = smooth(-0.7, -2.2, z);
    const white = Math.min(1, Math.max(lower * 0.95, face));
    let c = mix(mix(C.fur, C.furDark, smooth(0.4, 0.95, ny) * smooth(-1.0, 1.2, z) * 0.5), C.white, white);
    // a soft darker stripe down the forehead between the patches
    const stripe = (1 - smooth(0.3, 0.9, Math.abs(x))) * smooth(0.3, -0.7, z) * (1 - smooth(-2.4, -3.2, z)) * smooth(0.15, 0.6, ny);
    c = mix(c, C.furDark, stripe * 0.5);
    // a shading step under the jaw, so the white face never blows out flat
    return mix(c, C.whiteShade, smooth(-0.35, -0.9, ny) * white * 0.85);
  });
  // The probe is the same chunky skull (never rendered): patches, brows and mouth are raycast onto its facets.
  const skullProbe = new THREE.Mesh(makeSkull(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  skullProbe.updateMatrixWorld(true);
  kit.place(skull, { rot: [HEAD_TILT, 0, 0] });
  addSkin(parts.head, skull, ZERO, null, 'skull');

  // Nose: a black wedge at the tip, with a lighter bridge so it reads from the camera above.
  const nose = kit.loft({
    spine: [[0, -0.38, -4.1], [0, -0.5, -4.78]],
    radii: [[0.6, 0.5], [0.5, 0.38]],
    sides: 8,
    stations: 3,
    capSteps: 2,
    twist: Math.PI / 8,
  });
  kit.paint(nose, (x, y, z, nx, ny) => mix(C.black, '#4b4e5a', smooth(0.55, 0.95, ny) * smooth(-4.9, -4.3, z)));
  kit.place(nose, { rot: [HEAD_TILT, 0, 0] });
  kit.add(parts.head, nose, mats.matte, { name: 'nose' });

  const raycaster = new THREE.Raycaster();
  const hitSkull = (origin, dir) => {
    raycaster.set(origin, dir);
    return raycaster.intersectObject(skullProbe)[0];
  };
  /** Skull centre-line height and ring radii at a given head-local z. */
  const skullAt = (zq) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i <= 400; i++) {
      const d = Math.abs(skullProf.curve.getPoint(i / 400).z - zq);
      if (d < bd) {
        bd = d;
        best = i / 400;
      }
    }
    const p = skullProf.curve.getPoint(best);
    const [rx, ry] = skullProf.at(best * skullProf.n);
    return { y: p.y, rx, ry };
  };

  // Eye patches: crisp black diamonds draped over the skull around each eye.
  const PATCH_TH = 0.4; // the temple point sits a little higher than the point toward the snout
  const PATCH_U = [-1.6, 2.3]; // reach toward the snout / toward the temple (about 18% bigger than before)
  const PATCH_V = 1.6;
  const PATCH_SHIFT = [0.15, 0.25]; // slides the patch so the eye sits at its heart (toward the temple, up)
  const patchFrame = (sign) => {
    const n = new THREE.Vector3(sign * 0.5, 0.2, -0.84).normalize();
    const ep = new THREE.Vector3(sign * 0.84, 0, 0.54).normalize(); // toward the temple
    const eq = new THREE.Vector3(0, 1, 0);
    eq.addScaledVector(n, -eq.dot(n)).addScaledVector(ep, -eq.dot(ep)).normalize();
    const eye = new THREE.Vector3(sign * EYE[0], EYE[1], EYE[2]);
    const surface = hitSkull(eye.clone().addScaledVector(n, 8), n.clone().negate());
    return { n, ep, eq, sign, C0: surface ? surface.point.clone() : eye };
  };
  /** The nearest point of the skull's spine (its centre line) to a head-local point. */
  const axisPoint = (o) => {
    let near = 0;
    let nd = Infinity;
    for (let k = 0; k <= 60; k++) {
      const d = skullProf.curve.getPoint(k / 60).distanceToSquared(o);
      if (d < nd) {
        nd = d;
        near = k / 60;
      }
    }
    return skullProf.curve.getPoint(near);
  };
  /** A point on the skull under patch-plane coordinates (pp toward the temple, qq up), lifted off the surface. */
  const onSkull = (f, pp, qq, lift) => {
    const o = f.C0.clone().addScaledVector(f.ep, pp + PATCH_SHIFT[0]).addScaledVector(f.eq, qq + PATCH_SHIFT[1]);
    // project along the patch normal; a tip that runs past the skull's silhouette seen that way is dropped onto the skull
    // radially from its spine instead, so every point of the patch lands on the head and nothing ever floats off it
    // (the projection swings toward the side of the head for points out toward the temple, where the skull falls away)
    const pn = f.n.clone().addScaledVector(f.ep, 0.35 * pp).normalize();
    let hit = hitSkull(o.clone().addScaledVector(pn, 8), pn.clone().negate());
    if (!hit) {
      const axis = axisPoint(o);
      const dir = o.clone().sub(axis);
      if (dir.lengthSq() < 1e-6) dir.set(f.sign, 0, 0);
      dir.normalize();
      hit = hitSkull(axis.clone().addScaledVector(dir, 12), dir.clone().negate());
    }
    return hit ? hit.point.clone().addScaledVector(hit.face.normal, lift) : o;
  };
  const rotPQ = (uu, vv, th) => [uu * Math.cos(th) - vv * Math.sin(th), uu * Math.sin(th) + vv * Math.cos(th)];
  const patchGeo = (sign) => {
    const f = patchFrame(sign);
    const { n } = f;
    const rings = 6;
    const segs = 36;
    const positions = [];
    const project = (pp, qq) => {
      const pt = onSkull(f, pp, qq, 0.12); // clear of the skull facets, so no specks show through
      positions.push(pt.x, pt.y, pt.z);
    };
    project(0, 0);
    for (let r = 1; r <= rings; r++) {
      const k = r / rings;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const cu = Math.cos(a);
        const sv = Math.sin(a);
        // a true diamond: a long sharp point toward the temple, a shorter soft point toward the snout
        const e = cu > 0 ? 1.5 : 2.0; // the temple point is a diamond tip, but not a razor: no slivers to tear across the skull facets
        const uu = Math.sign(cu) * Math.pow(Math.abs(cu), 2 / e) * (cu > 0 ? PATCH_U[1] : -PATCH_U[0]) * k;
        const vv = Math.sign(sv) * Math.pow(Math.abs(sv), 2 / e) * PATCH_V * k;
        project(...rotPQ(uu, vv, PATCH_TH));
      }
    }
    const idx = [];
    const ringIdx = (r, i) => 1 + (r - 1) * segs + (i % segs);
    for (let i = 0; i < segs; i++) idx.push(0, ringIdx(1, i), ringIdx(1, i + 1));
    for (let r = 1; r < rings; r++) {
      for (let i = 0; i < segs; i++) {
        const a = ringIdx(r, i);
        const b = ringIdx(r, i + 1);
        const c = ringIdx(r + 1, i);
        const d = ringIdx(r + 1, i + 1);
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make every face point outward, away from the skull's spine
    const arr = g.index.array;
    const pos = g.attributes.position;
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();
    const nn = new THREE.Vector3();
    for (let t = 0; t < arr.length; t += 3) {
      va.fromBufferAttribute(pos, arr[t]);
      vb.fromBufferAttribute(pos, arr[t + 1]);
      vc.fromBufferAttribute(pos, arr[t + 2]);
      nn.crossVectors(vb.clone().sub(va), vc.clone().sub(va));
      const centre = va.clone().add(vb).add(vc).multiplyScalar(1 / 3);
      if (nn.dot(centre.sub(axisPoint(centre))) < 0) {
        const tmp = arr[t + 1];
        arr[t + 1] = arr[t + 2];
        arr[t + 2] = tmp;
      }
    }
    g.computeVertexNormals();
    kit.paint(g, C.black);
    return g;
  };
  const patches = kit.merge([patchGeo(-1), patchGeo(1)]);
  kit.place(patches, { rot: [HEAD_TILT, 0, 0] });
  // a whisper of polygon offset on top of the 0.12 lift: the black wins the depth test against the skull facets it lies
  // on, but never against the eyeballs, which stand clear of the patch
  const patchMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 });
  kit.add(parts.head, patches, patchMat, { name: 'eyePatches', shadow: false });

  // A cocky smirk: one short, slightly curled black line on each cheek, well back from the nose so it never reads as a
  // moustache; the right side curls up more, the lopsided, cockier one. No crease hook.
  const smirk = [];
  const muzzleTube = (pts, r0, r1) => {
    if (pts.length < 3) return;
    const tube = kit.loft({ spine: pts, radii: (t) => [r0 + (r1 - r0) * t, r0 + (r1 - r0) * t], sides: 5, stations: pts.length * 2, up: [0, 1, 0], capSteps: 1 });
    kit.paint(tube, C.black);
    smirk.push(tube);
  };
  const onMuzzle = (sign, z, y) => {
    const hit = hitSkull(new THREE.Vector3(sign * 9, y, z), new THREE.Vector3(-sign, 0, 0));
    return hit ? [hit.point.x + sign * 0.05, hit.point.y, hit.point.z] : null;
  };
  for (const sign of [1]) {
    // one-sided, as a smirk should be: only the right cheek (the left stays a calm, smug blank)
    const pts = [];
    const curl = 0.55;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const z = -3.7 + t * 0.8; // a short run on the cheek: z -3.7 .. -2.9
      const s = skullAt(z);
      const p = onMuzzle(sign, z, s.y - 0.72 * s.ry + curl * Math.pow(t, 2.0));
      if (p) pts.push(p);
    }
    muzzleTube(pts, 0.16, 0.12);
  }
  if (smirk.length) {
    const smirkGeo = kit.merge(smirk);
    kit.place(smirkGeo, { rot: [HEAD_TILT, 0, 0] });
    kit.add(parts.head, smirkGeo, patchMat, { name: 'smirk', shadow: false });
  }

  // Eyes: flat-shaded, low-poly (8 segments, no specular), so they sit in the same world as the chunky skull. A
  // desaturated amber iris, a big black pupil, a heavy slanted upper lid that covers about a third of the iris and
  // a lower lid pushed up by a smug cheek: half-lidded and self-satisfied, never startled.
  const flatMat = (color, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true });
  const whiteMat = flatMat('#fbfaf3', 0.6);
  const irisMat = flatMat(C.irisAmber, 0.75);
  const pupilMat = flatMat('#0b0b0f', 0.9);
  const R = [1.0, 1.1, 0.88];
  const EYE_SCALE = 1.18; // the whole eye is about 18% bigger than before, so it reads from the game camera
  // low-poly ball with its poles along the gaze (z), so a disc seen from the front is a clean octagonal fan
  const facetBall = (rx, ry, rz, ws = 8, hs = 4) => {
    const g = new THREE.SphereGeometry(1, ws, hs);
    g.deleteAttribute('uv');
    g.rotateX(Math.PI / 2);
    g.scale(rx, ry, rz);
    g.computeVertexNormals();
    return g;
  };
  const OUT = 0.42; // how far the eyeballs stand proud of the patch, so the whole iris shows instead of a crescent
  for (const [eye, sign] of [[parts.eyeL, -1], [parts.eyeR, 1]]) {
    // the gaze turns a little outward (like the skull under it) and up with the tilted head
    const aim = (g, pos = [0, 0, 0]) => {
      // the offsets are in design coordinates (along the tilted gaze), like the eye pivot itself
      const q = tiltPos([pos[0] * EYE_SCALE, pos[1] * EYE_SCALE, (pos[2] - OUT) * EYE_SCALE]);
      return kit.place(g, { pos: q, rot: [HEAD_TILT, -sign * 0.2, 0], scale: [EYE_SCALE, EYE_SCALE, EYE_SCALE] });
    };
    // a big white eyeball, a dark-brown iris about 60% of its width (so a clear white ring shows around it), and a large
    // black pupil sunk into the iris
    kit.add(eye, aim(facetBall(R[0] * 0.88, R[1] * 0.9, R[2] * 0.88, 8, 5)), whiteMat, { name: 'eyeWhite' });
    kit.add(eye, aim(facetBall(0.5, 0.57, 0.3, 8, 4), [0, -0.04, -0.66]), irisMat, { name: 'iris' });
    kit.add(eye, aim(facetBall(0.29, 0.38, 0.2, 8, 4), [sign * 0.02, -0.07, -0.84]), pupilMat, { name: 'pupil' });
    kit.add(eye, aim(facetBall(0.12, 0.12, 0.08, 6, 3), [0.15, 0.1, -1.04]), mats.glint, { name: 'glint' });
    // the heavy upper lid: a deep cap over the top of the eyeball, slanted so the inner end droops
    const lid = new THREE.SphereGeometry(1, 8, 2, 0, Math.PI * 2, 0, 0.82);
    lid.deleteAttribute('uv');
    lid.rotateX(-0.52);
    lid.rotateZ(sign * 0.16);
    lid.scale(R[0] * 0.88 * 1.07, R[1] * 0.9 * 1.07, R[2] * 0.88 * 1.07); // hugs the eyeball, so it reads as an eyelid and not a hat
    lid.computeVertexNormals();
    kit.paint(lid, C.lidTop);
    kit.add(eye, aim(lid), mats.matte, { name: 'lid' });
  }

  // Brows: short, chunky ridges seated flush on the top edge of each eye patch, well behind the crown band. The
  // left is relaxed; the right sits higher and arches more: the cocked, self-satisfied eyebrow. Each brow pivots
  // about its own centre, so furrowing it when he strains turns it in place.
  const browSets = [
    { pivot: parts.browL, key: 'browL', sign: -1, u: [-0.4, 1.2], lift: -0.16, arch: 0.02, rad: 0.2 },
    { pivot: parts.browR, key: 'browR', sign: 1, u: [-0.4, 1.3], lift: -0.06, arch: 0.04, rad: 0.21 },
  ];
  for (const b of browSets) {
    const f = patchFrame(b.sign);
    const world = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const uu = b.u[0] + (b.u[1] - b.u[0]) * t;
      // the top edge of the diamond, rotated like the patch, then lifted off it
      const edge = uu < 0 ? PATCH_V * Math.pow(1 - Math.pow(-uu / -PATCH_U[0], 2.0), 1 / 2.0) : PATCH_V * Math.pow(1 - Math.pow(uu / PATCH_U[1], 1.5), 1 / 1.5);
      const [pp, qq] = rotPQ(uu, edge + b.lift + b.arch * Math.sin(Math.PI * t), PATCH_TH);
      const q = onSkull(f, pp, qq, 0.2);
      world.push(tiltPos([q.x, q.y, q.z]));
    }
    const mid = world[Math.floor(n / 2)];
    b.pivot.position.set(mid[0], mid[1], mid[2]);
    rig.pivotPos[b.key] = [mid[0], mid[1], mid[2]];
    const tube = kit.loft({
      spine: world.map((w) => [w[0] - mid[0], w[1] - mid[1], w[2] - mid[2]]),
      radii: (t) => {
        const taper = 0.5 + 0.5 * Math.pow(Math.sin(Math.PI * (0.05 + 0.9 * t)), 0.7);
        return [b.rad * taper * 0.85, b.rad * taper];
      },
      sides: 5,
      stations: 7,
      up: [0, 1, 0],
      capSteps: 2,
    });
    kit.paint(tube, (x, y, z, nx, ny) => mix('#4a4c57', '#6d6f7b', smooth(0.0, 0.9, ny))); // grey fur ridge: reads on the black patch and on the white forehead
    kit.add(b.pivot, tube, mats.matte, { name: 'brow' });
  }

  // Ears: round and upright, grey on the back (which is what the camera sees from behind and above) with a big pale
  // inside that opens forward and outward, the way a lemur's ears do, so the white never shows as a flat disc from behind.
  for (const [ear, sign] of [[parts.earL, -1], [parts.earR, 1]]) {
    const ringPts = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ringPts.push([Math.cos(a) * 0.95, Math.sin(a) * 1.15 + 0.08 * Math.sin(a) * Math.abs(Math.sin(a))]);
    }
    const outer = kit.extrude(ringPts, 0.5, { bevel: 0.16 });
    kit.paint(outer, (x, y, z, nx, ny, nz) => mix(C.fur, C.furDark, smooth(0.0, 0.8, nz) * 0.35)); // a darker back
    const inner = kit.extrude(ringPts.map(([px, py]) => [px * 0.74, py * 0.76 - 0.06]), 0.3, { bevel: 0.08 });
    kit.paint(inner, C.earIn);
    kit.place(inner, { pos: [0, 0, -0.33] });
    const geo = kit.merge([outer, inner]);
    kit.place(geo, { pos: [sign * 0.2, 0.9, 0.0], rot: [0.0, -sign * 0.85, sign * -0.4] });
    kit.add(ear, geo, mats.matte, { name: 'ear' });
  }

  /* ---------- the crown: a snug gold circlet with a gem peak, a fur tuft and a fan of tall leaves ---------- */
  // The circlet and the leaves are laid out in the upright (world-like) frame and converted into the skull's own,
  // tilted frame, so the ring sits level on the crown of the head and the leaves rise straight whatever the tilt is.
  const AX = new THREE.Vector3(1, 0, 0);
  const toSkull = (v) => v.clone().applyAxisAngle(AX, -HEAD_TILT); // upright frame -> head-local (pre-tilt) frame
  const upL = toSkull(new THREE.Vector3(0, 1, 0)).normalize();
  const RING = { z: 1.0, rx: 1.3, rz: 1.0, thick: 0.3 }; // a snug circlet that hugs the skull
  const ringPeak = (th) => {
    const d = Math.abs(th - Math.PI); // the peak rises over the forehead (theta 180 degrees = toward the face)
    return Math.exp(-Math.pow(d / 0.62, 2));
  };
  /** A point of the circlet's centre line (resting on the skull) and its half height; the front is taller. */
  const ringPoint = (th) => {
    const origin = toSkull(new THREE.Vector3(RING.rx * Math.sin(th), 30, RING.z + RING.rz * Math.cos(th)));
    const hit = hitSkull(origin, upL.clone().negate());
    const base = hit ? hit.point.clone() : origin.clone().addScaledVector(upL, -27);
    const half = 0.64 + 0.8 * ringPeak(th); // a slimmer band (about 1.0 above the skull) that rises to a peak over the forehead
    return { c: base.addScaledVector(upL, half - 0.3), half, th };
  };
  const RING_N = 14;
  const ringPts = [];
  for (let i = 0; i < RING_N; i++) ringPts.push(ringPoint((i / RING_N) * Math.PI * 2));
  const RING_SIDES = 8;
  const ring = (() => {
    const pos = [];
    ringPts.forEach((p, i) => {
      const prev = ringPts[(i + RING_N - 1) % RING_N].c;
      const next = ringPts[(i + 1) % RING_N].c;
      const T = next.clone().sub(prev).normalize();
      const Nn = upL.clone().addScaledVector(T, -upL.dot(T)).normalize();
      const B = new THREE.Vector3().crossVectors(T, Nn).normalize();
      for (let k = 0; k < RING_SIDES; k++) {
        const a = (k / RING_SIDES) * Math.PI * 2 + Math.PI / RING_SIDES;
        const v = p.c.clone().addScaledVector(Nn, (p.half / 0.924) * Math.cos(a)).addScaledVector(B, (RING.thick / 0.924) * Math.sin(a));
        pos.push(v.x, v.y, v.z);
      }
    });
    const idx = [];
    for (let i = 0; i < RING_N; i++) {
      for (let k = 0; k < RING_SIDES; k++) {
        const a = i * RING_SIDES + k;
        const b = i * RING_SIDES + ((k + 1) % RING_SIDES);
        const c = ((i + 1) % RING_N) * RING_SIDES + k;
        const d = ((i + 1) % RING_N) * RING_SIDES + ((k + 1) % RING_SIDES);
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    // make the faces point away from the ring's centre line
    const v = (n) => new THREE.Vector3().fromArray(pos, n * 3);
    const fn = new THREE.Vector3().crossVectors(v(idx[1]).sub(v(idx[0])), v(idx[2]).sub(v(idx[0])));
    const probe = v(idx[0]).sub(ringPts[0].c);
    if (fn.dot(probe) < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  })();
  kit.paint(ring, (x, y, z, nx, ny, nz) => {
    const up = ny * Math.cos(HEAD_TILT) - nz * Math.sin(HEAD_TILT); // how much this facet faces the sky
    let c = mix(C.gold, C.goldLight, smooth(0.15, 0.85, up));
    return mix(c, C.goldDark, smooth(-0.15, -0.85, up));
  });
  const crown = [ring];

  // A gem in the front peak, so the band reads as a crown at a glance: a small faceted diamond, not a ball.
  {
    const front = ringPoint(Math.PI);
    const out = toSkull(new THREE.Vector3(0, 0, -1)).normalize();
    const gem = new THREE.OctahedronGeometry(1, 0);
    gem.deleteAttribute('uv');
    gem.scale(0.36, 0.56, 0.3);
    gem.computeVertexNormals();
    kit.paint(gem, (x, y, z, nx, ny) => mix('#e83a1c', '#ff8a3a', smooth(-0.2, 0.9, ny)));
    const X = toSkull(new THREE.Vector3(1, 0, 0));
    const Z = out;
    const Y = new THREE.Vector3().crossVectors(Z, X);
    const at = front.c.clone().addScaledVector(out, RING.thick * 0.85).addScaledVector(upL, front.half * 0.35);
    gem.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(at));
    gem.computeVertexNormals();
    crown.push(gem);
  }

  // A tuft of fur inside the band: without it the circlet shows a bare grey patch of skull and reads as a donut from above.
  {
    const tuftBits = [];
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.3;
      const mid = k === 0;
      const ox = mid ? 0 : RING.rx * 0.5 * Math.sin(a);
      const oz = mid ? 0 : RING.rz * 0.5 * Math.cos(a);
      const origin = toSkull(new THREE.Vector3(ox, 30, RING.z + oz));
      const hit = hitSkull(origin, upL.clone().negate());
      if (!hit) continue;
      const H = mid ? 2.2 : 1.7 + 0.25 * Math.sin(k * 2.1);
      const spike = kit.cone(mid ? 0.55 : 0.46, H, 5);
      kit.paint(spike, (x, y) => mix(mix(C.furDark, C.fur, smooth(0.0, 0.5, y / H)), C.furLight, smooth(0.55, 1.0, y / H)));
      const lean = new THREE.Vector3(mid ? 0 : 0.28 * Math.sin(a), 1, mid ? 0.18 : 0.28 * Math.cos(a)).normalize();
      const dirL = toSkull(lean);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirL);
      spike.applyMatrix4(new THREE.Matrix4().compose(hit.point.clone().addScaledVector(upL, -0.35), q, new THREE.Vector3(1, 1, 1)));
      spike.computeVertexNormals();
      tuftBits.push(spike);
    }
    if (tuftBits.length) crown.push(...tuftBits);
  }

  // A fan of leaves around the back and sides of the circlet, like a feathered headdress, none in front so the white
  // mask, the brows and the eyes stay clear. Each one curls a little and ends in a yellow-orange tip.
  const leafW = (t) => lookup([0, 0.12, 0.3, 0.52, 0.72, 0.88, 1.0], [0.5, 0.88, 1.0, 0.9, 0.66, 0.4, 0.14], t);
  // nine blades: a tall one in the middle, shorter ones toward the sides, all standing nearly upright and fanning out
  // only a little, so they read as tall blades and never as a flat sunflower
  const leafDefs = [
    { deg: 0, lean: 0.3, L: 5.0, W: 0.66 },
    { deg: 29, lean: 0.33, L: 4.7, W: 0.66 },
    { deg: -29, lean: 0.33, L: 4.7, W: 0.66 },
    { deg: 58, lean: 0.35, L: 4.2, W: 0.64 },
    { deg: -58, lean: 0.35, L: 4.2, W: 0.64 },
    { deg: 87, lean: 0.38, L: 3.6, W: 0.62 },
    { deg: -87, lean: 0.38, L: 3.6, W: 0.62 },
    { deg: 116, lean: 0.4, L: 3.1, W: 0.6 },
    { deg: -116, lean: 0.4, L: 3.1, W: 0.6 },
  ];
  leafDefs.forEach((d, i) => {
    const th = (d.deg * Math.PI) / 180;
    const { L, W } = d;
    const leaf = kit.loft({
      spine: [[0, 0, 0], [0, L * 0.5, L * 0.04], [0, L, L * 0.17]],
      radii: (t) => [W * leafW(t), 0.33 * (0.5 + 0.5 * leafW(t))],
      sides: 4,
      stations: 7,
      up: [0, 0, 1],
      capStart: 'none',
      capEnd: 'round',
      capSteps: 2,
    });
    const lime = i % 2 === 1; // alternate deep green and lime leaves
    kit.paint(leaf, (x, y) => {
      const t = Math.max(0, y) / L;
      let c = mix(lime ? C.green : C.greenDark, lime ? C.lime : C.green, smooth(0.05, 0.5, t));
      c = mix(c, C.lime, smooth(0.45, 0.72, t) * (lime ? 0.5 : 0.85));
      c = mix(c, C.yellow, smooth(0.66, 0.8, t));
      c = mix(c, C.orange, smooth(0.88, 0.97, t));
      return mix(c, '#ffffff', 0.12 * (1 - smooth(0.0, 0.18 * W, Math.abs(x)))); // a pale ridge down the middle
    });
    const base = ringPoint(((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
    const X = toSkull(new THREE.Vector3(Math.cos(th), 0, -Math.sin(th)));
    const Y = toSkull(new THREE.Vector3(Math.sin(th) * Math.sin(d.lean), Math.cos(d.lean), Math.cos(th) * Math.sin(d.lean)));
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const start = base.c.clone().addScaledVector(upL, base.half - 0.4);
    leaf.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(start));
    leaf.computeVertexNormals();
    crown.push(leaf);
  });
  const crownGeo = kit.merge(crown);
  kit.place(crownGeo, { rot: [HEAD_TILT, 0, 0] }); // sits on the lifted skull, circlet and leaves together...
  // ...on a pivot at the circlet's own centre, so it can bounce a hair when he farts without lifting off the skull.
  const cp = (() => {
    const mid = new THREE.Vector3();
    ringPts.forEach((p) => mid.add(p.c));
    mid.multiplyScalar(1 / RING_N).applyAxisAngle(AX, HEAD_TILT);
    return [mid.x, mid.y, mid.z];
  })();
  const crownPivot = kit.pivot(parts.head, cp, 'crown');
  kit.place(crownGeo, { pos: [-cp[0], -cp[1], -cp[2]] });
  kit.add(crownPivot, crownGeo, mats.shiny, { name: 'crown' });

  /* ---------- hands: big, long fingers lying flat on the deck, lighter tips ---------- */
  const digit = (pts, radii, sides = 6, up = [0, 1, 0]) =>
    kit.loft({ spine: pts, radii, sides, stations: 3, up, capStart: 'round', capEnd: 'round', capSteps: 2 });
  const HAND = 1.25;
  const FINGER_TIP = '#a4a7af'; // only a shade lighter than the fur, so the hand reads as part of the arm and not as a glove
  const handGeo = (s) => {
    const k = HAND;
    const list = [];
    const palm = kit.loft({
      spine: [[0, -0.2, 0.7], [0, -0.55, -0.8], [0, -0.62, -1.9]].map((p) => p.map((v) => v * k)),
      radii: [[1.1, 0.8], [1.45, 0.55], [1.35, 0.5]].map((r) => r.map((v) => v * k)),
      sides: 8,
      stations: 4,
      up: [0, 1, 0],
    });
    kit.paint(palm, (x, y, z, nx, ny) => mix(C.fur, C.furLight, smooth(-0.2, -0.9, ny) * 0.5));
    list.push(palm);
    // long but blunt, chunky fingers, fanned so their tips stay apart
    const fingers = [
      { x: -1.05, dx: -0.6, len: 2.3 },
      { x: -0.36, dx: -0.18, len: 2.8 },
      { x: 0.36, dx: 0.18, len: 2.8 },
      { x: 1.05, dx: 0.65, len: 2.2 },
    ];
    for (const f of fingers) {
      const x0 = f.x * s * k;
      const dx = f.dx * s * k;
      const g = digit(
        [[x0, -0.68 * k, -1.8 * k], [x0 + dx * 0.5, -0.74 * k, -(1.8 + f.len * 0.52) * k], [x0 + dx, -0.8 * k, -(1.8 + f.len) * k]],
        [[0.55 * k, 0.5 * k], [0.48 * k, 0.43 * k], [0.38 * k, 0.36 * k]],
      );
      kit.paint(g, (x, y, z) => mix(C.fur, FINGER_TIP, smooth(-(1.8 + f.len * 0.6) * k, -(1.8 + f.len * 1.0) * k, z)));
      list.push(g);
    }
    const thumb = digit(
      [[-0.9 * s * k, -0.7 * k, -0.3 * k], [-1.6 * s * k, -0.78 * k, -1.1 * k], [-2.15 * s * k, -0.8 * k, -1.9 * k]],
      [[0.6 * k, 0.52 * k], [0.5 * k, 0.44 * k], [0.4 * k, 0.37 * k]],
    );
    kit.paint(thumb, (x, y, z) => mix(C.fur, FINGER_TIP, smooth(-1.2 * k, -1.9 * k, z)));
    list.push(thumb);
    return kit.merge(list);
  };

  /* ---------- arms: thick at the shoulder, a clear elbow kicked out, a strong wrist ---------- */
  for (const [pivot, side, vec] of [[parts.armL, -1, limb.arm.L], [parts.armR, 1, limb.arm.R]]) {
    const W = vec;
    // a gentle elbow kicked out: guide points halfway along each segment (not close beside the elbow), so the tube
    // never folds over itself on the inside of the bend
    const E = [side * 3.6, -5.1, -3.5];
    const A = E.map((v) => v * 0.55);
    const Bp = [0, 1, 2].map((i) => E[i] + (W[i] - E[i]) * 0.5);
    const armSpine = [[-side * 1.3, 0.5, 0.5], [0, 0, 0], A, E, Bp, W];
    const arm = kit.loft({
      spine: armSpine,
      radii: profile(armSpine, [[0, 2.0, 2.0], [1, 2.4, 2.4], [2, 1.85, 1.85], [3, 1.6, 1.6], [4, 1.4, 1.4], [5, 1.1, 1.1]]),
      sides: 8,
      stations: 12,
      up: [1, 0, 0],
    });
    kit.paint(arm, (x, y, z, nx, ny) => mix(mix(C.furDark, C.fur, smooth(0.9, 0.2, ny)), C.furLight, smooth(0.0, -0.7, ny)));
    addSkin(pivot, arm, ZERO, null, 'arm');
    const hand = handGeo(side);
    kit.place(hand, { pos: W });
    addSkin(pivot, hand, ZERO, null, 'hand');
  }

  /* ---------- legs: a tapered thigh, a knee kicked out, a sturdy shin, and a deep, chunky long-toed foot ---------- */
  const FOOT = 1.2;
  const ANKLE_Y = -7.9;
  const footGeo = (s) => {
    const k = FOOT;
    const list = [];
    // a deep heel and instep: wide across, and nearly as deep front to back as it is wide at the ball of the foot
    const spine = [[0, 0.5, 0.4], [0, -0.5, 0.2], [0, -1.4, -0.2], [0, -2.0, -0.55]].map(([x, y, z]) => [x * k, y * k, z * k]);
    const foot = kit.loft({
      spine,
      radii: profile(spine, [[0, 1.2 * k, 1.35 * k], [1, 1.45 * k, 1.25 * k], [2, 1.6 * k, 1.1 * k], [3, 1.62 * k, 1.0 * k]]),
      sides: 8,
      stations: 4,
      up: [0, 0, 1],
      capStart: 'round',
      capSteps: 2,
      twist: Math.PI / 8,
    });
    kit.paint(foot, (x, y, z, nx, ny, nz) => mix(mix(C.fur, C.furLight, smooth(-0.8 * k, -2.0 * k, y)), C.pad, smooth(0.2, 0.85, nz) * 0.3));
    list.push(foot);
    // five fat, short toes fanned out like fingers, the big one on the inside, with dark rounded tips
    const toes = [
      { x: -1.25, tx: -2.4, ty: -3.15, tz: -1.5, r: 0.95 },
      { x: -0.62, tx: -1.2, ty: -3.45, tz: -1.9, r: 0.8 },
      { x: 0.0, tx: 0.0, ty: -3.6, tz: -2.0, r: 0.78 },
      { x: 0.62, tx: 1.25, ty: -3.45, tz: -1.9, r: 0.75 },
      { x: 1.2, tx: 2.4, ty: -3.1, tz: -1.5, r: 0.7 },
    ];
    for (const t of toes) {
      const p0 = [t.x * s * k, -1.65 * k, -0.7 * k];
      const p2 = [t.tx * s * k, t.ty * k, t.tz * k];
      const pm = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2 - 0.1, (p0[2] + p2[2]) / 2 - 0.05];
      const g = digit([p0, pm, p2], [[t.r * k, t.r * 0.95 * k], [t.r * 0.92 * k, t.r * 0.85 * k], [t.r * 0.8 * k, t.r * 0.75 * k]], 6, [0, 0, 1]);
      kit.paint(g, (x, y, z) => mix(C.furLight, C.padDark, smooth(-2.7 * k, -3.45 * k, y)));
      list.push(g);
    }
    const merged = kit.merge(list);
    // splay the whole foot outward (about the ankle) so the toes show from behind
    kit.place(merged, { rot: [0.22, -s * 0.2, 0] }); // toes tipped forward so the foot reads from the side too
    return merged;
  };

  for (const [pivot, side] of [[parts.legL, -1], [parts.legR, 1]]) {
    // hip, a thigh swung out and forward, a knee kicked out, then the shin coming back in toward the ankle
    const legSpine = [[0, 1.5, -0.5], [0, 0, 0], [1.0 * side, -3.2, -1.7], [1.9 * side, -5.0, -2.2], [1.5 * side, -6.9, -0.2], [1.1 * side, ANKLE_Y, 1.5]];
    const leg = kit.loft({
      spine: legSpine,
      // a lean athletic thigh and shin (about 13% slimmer than before), so the big feet carry the leg instead of a pipe
      radii: profile(legSpine, [[0, 1.85, 1.95], [1, 2.2, 2.2], [2, 1.8, 1.85], [3, 1.52, 1.57], [4, 1.36, 1.4], [5, 1.25, 1.27]]),
      sides: 8,
      stations: 10,
      up: [0, 0, 1],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 2,
      twist: Math.PI / 8,
    });
    kit.paint(leg, (x, y, z, nx) => {
      const inner = smooth(0.2, 0.9, -nx * side);
      return mix(mix(C.furDark, C.fur, smooth(0.5, -5.0, y)), C.furLight, inner * 0.8);
    });
    addSkin(pivot, leg, ZERO, null, 'leg');
    // the foot hangs from the ankle, which sits where the shin ends
    const foot = footGeo(side);
    kit.place(foot, { pos: [1.1 * side, ANKLE_Y, 1.5] });
    addSkin(pivot, foot, ZERO, null, 'foot');
  }

  /* ---------- tail: slim, ringed, leaving the sacrum off-centre and hooking over in an S ---------- */
  const TAIL_SIDES = 10;
  const capSteps = 3;
  const WHITE_W = [4, 4, 3, 4, 4, 3, 4, 3, 4, 3, 4]; // station counts: ring widths are a little irregular
  const BLACK_W = [3, 3, 2, 3, 3, 3, 2, 3, 2, 3, 3];
  const baseStations = 6; // grey fur where the tail leaves his back
  const bandOf = []; // per station interval: 0 = fur, 1 = white, 2 = black, with position inside the band
  for (let s = 0; s < baseStations; s++) bandOf.push({ kind: 0, u: s / baseStations });
  WHITE_W.forEach((w, k) => {
    for (let s = 0; s < w; s++) bandOf.push({ kind: 1, u: (s + 0.5) / w });
    for (let s = 0; s < BLACK_W[k]; s++) bandOf.push({ kind: 2, u: (s + 0.5) / BLACK_W[k] });
  });
  const tipStations = 2;
  for (let s = 0; s < tipStations; s++) bandOf.push({ kind: 2, u: 0.5 });
  const TAIL_STATIONS = bandOf.length;
  // A bigger S that bulges out to one side, then loops over at the top and curls its tip back in (centre line, world coordinates).
  const tailWorld = [
    [1.0, 7.8, 10.4], [0.9, 9.8, 12.6], [1.5, 12.4, 14.4], [3.4, 15.0, 15.4], [5.8, 17.4, 15.0],
    [7.0, 20.0, 14.0], [6.0, 22.2, 13.2], [3.8, 23.0, 13.0], [1.8, 21.8, 13.6], [1.2, 19.6, 14.2],
  ];
  const tailSpine = tailWorld.map(([x, y, z]) => [x - spec.pivots.tail[0], y - spec.pivots.tail[1], z - spec.pivots.tail[2]]);
  const tail = kit.loft({
    spine: tailSpine,
    radii: (t) => {
      let r = 2.2 - 0.5 * smooth(0.15, 0.6, t) - 0.5 * smooth(0.6, 1.0, t); // a huge, fluffy tail: about 2.2 at the root, 1.7 in the middle, 1.2 at the tip
      // the white bands are a good deal fluffier than the black rings
      const idx = Math.min(TAIL_STATIONS - 1, Math.max(0, Math.round(t * TAIL_STATIONS - 0.5)));
      const band = bandOf[idx];
      if (band.kind === 1) r *= 1 + 0.12 * Math.sin(Math.PI * band.u);
      else if (band.kind === 2) r *= 1 - 0.05 * Math.sin(Math.PI * band.u);
      return [r, r];
    },
    sides: TAIL_SIDES,
    stations: TAIL_STATIONS,
    up: [0, 0, 1],
    capSteps,
  });
  // Colour every quad by the ring it belongs to (not every vertex), so the black and white bands have crisp edges.
  const tailBanded = tail.toNonIndexed();
  {
    const count = tailBanded.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const col = new THREE.Color();
    for (let tri = 0; tri < count / 3; tri++) {
      const interval = Math.floor(tri / (2 * TAIL_SIDES)); // loft emits two triangles per quad, ring by ring
      const s = interval - capSteps; // station index this ring of quads starts at
      if (s >= TAIL_STATIONS) col.set(C.ringBlack);
      else {
        const band = bandOf[Math.max(0, s)];
        if (band.kind === 0) col.copy(mix(C.furDark, C.fur, smooth(0, baseStations - 1, Math.max(0, s))));
        else col.set(band.kind === 1 ? C.ringWhite : C.ringBlack);
      }
      for (let v = 0; v < 3; v++) col.toArray(colors, (tri * 3 + v) * 3);
    }
    tailBanded.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  kit.add(parts.tail, tailBanded, mats.matte, { name: 'tail' });

  /* ---------- livelier motion: crown bounce, bigger kick and charge ----------
     The base rig resets every pose value each frame, so these are plain offsets on top of it. */
  const baseUpdate = rig.update.bind(rig);
  rig.update = (dt, state) => {
    baseUpdate(dt, state);
    const charge = rig.chargeLevel;
    // the crown stays seated on the skull: only a hair of bounce, so the band never lifts off
    crownPivot.rotation.x = -rig.headKick.x * 0.03 - rig.recoil.x * 0.01 - charge * 0.02;
    crownPivot.rotation.z = Math.sin(rig.t * 3.1) * 0.015 + rig.look * 0.03 + Math.sin(rig.t * 23) * 0.028 * charge; // a tremble when he strains
    crownPivot.position.y = cp[1] + Math.max(0, rig.headKick.x) * 0.05; // a little hop when he lets rip
    parts.bodyRoot.position.z -= rig.recoil.x * 0.25;
    parts.bodyRoot.rotation.x -= rig.recoil.x * 0.012;
    // the tail flicks and sways, but gently, so it stays beside his bum and inside the boat's footprint
    parts.tail.rotation.x = -rig.flick * 0.26 - charge * 0.1;
    parts.tail.rotation.z = parts.tail.rotation.z * 0.4 + Math.sin(rig.t * 9) * 0.07 * charge; // the tail lashes about while he strains
    parts.rumpL.scale.multiplyScalar(1 + 0.05 * charge + rig.puffL.x * 0.05);
    parts.rumpR.scale.multiplyScalar(1 + 0.05 * charge + rig.puffR.x * 0.05);
    parts.head.rotation.x -= charge * 0.03;
    // the hands shuffle forward only a little when he walks, so the fingertips stay inside the footprint
    for (const arm of [parts.armL, parts.armR]) {
      const plant = -parts.bodyRoot.rotation.x;
      arm.rotation.x = plant + (arm.rotation.x - plant) * 0.3;
    }
    // the brows furrow a little less deeply than the base rig asks, so they stay on top of the skull
    const strain = Math.min(1, charge + kit.smooth(0.55, 1, rig.heatLevel) * 0.6);
    for (const brow of [parts.browL, parts.browR]) {
      brow.rotation.z *= 0.62;
      brow.position.y += 0.36 * strain;
    }
  };
}
