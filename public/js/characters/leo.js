import * as THREE from '../../vendor/three.min.js';

/**
 * Leo the lion. Golden fur, cream muzzle, chest and belly, and a HUGE orange-brown mane built
 * from layers of fat, chunky, pointed tufts of varied size (dark roots, orange base, amber tips, every other
 * tuft a lighter amber) that frame a big face and roll back over massive shoulders. The head tips well back
 * (chin up, show-off). Broad jaw with a wide grin (white teeth, one red tongue band), eyes sunk into skin
 * sockets with an almond window each (flat, slanted upper lid line, the confident half-lidded smirk) under
 * slim russet brows, small round ears, big flat paws with dark claw tips and a long tail with a fat
 * dark-brown tuft. Inverted-triangle silhouette: deep chest, a visible step down from the broad shoulders to
 * the waist, narrower hips, two bold six-sided buttock lobes with a V-shaped cleft above tapering thighs.
 * Everything is built from a few bold facets, in the same chunky low-poly style as the mane.
 */
const TILT = 0.62; // chin up: the cocky show-off pose (the whole head, mane included, tips back with the face)
const tiltPos = ([x, y, z]) => [x, y * Math.cos(TILT) - z * Math.sin(TILT), y * Math.sin(TILT) + z * Math.cos(TILT)];

const EYE = [3.0, 2.2, -3.2]; // right eye centre in face coordinates (left mirrored)
const BROW = [3.0, 4.6, -3.7]; // sits on the brow ridge just above the lid
const BROW_SLOPE = 0.34; // the forehead leans back, so the brow ridge lies back with it
const MANE_TILT = 0.3; // the mane is rooted at the neck, so it tips back much less than the face
const GAZE_UP = 0.42; // the pupils look a little up out of the face plane, so they read from above and in front
const CHEEK_X = 2.05; // each buttock sits this far from the centre line

export const spec = {
  id: 'leo',
  browRest: 0.1,
  eyeOpen: 0.96,
  padColor: '#cf3b3b',
  pivots: {
    head: [0, 1.4, -9.2],
    armL: [-5.9, 4.8, -6.6],
    armR: [5.9, 4.8, -6.6],
    legL: [-2.0, 3.6, 10.2],
    legR: [2.0, 3.6, 10.2],
    rumpL: [-CHEEK_X, 4.3, 12.0],
    rumpR: [CHEEK_X, 4.3, 12.0],
    tail: [-1.2, 6.5, 10.0], // rises out of the top of the rump beside the cleft, so the seam stays clear
    anus: [0, 3.6, 14.6], // just behind the seam between the cheeks (no mesh here)
    eyeL: tiltPos([-EYE[0], EYE[1], EYE[2]]),
    eyeR: tiltPos(EYE),
    browL: tiltPos([-BROW[0], BROW[1], BROW[2]]),
    browR: tiltPos(BROW),
    earL: tiltPos([-3.7, 4.2, -0.9]),
    earR: tiltPos([3.7, 4.2, -0.9]),
  },
  pawTarget: [7.9, -3.8, -16.2],
  footTarget: [2.0, -7.6, 11.4],
  // the sore blush covers both cheeks, fades down the thighs and up the lower back
  rump: { center: [0, 3.4, 13.4], radius: 8.8 },
};

const HEAD_SCALE = 1.34; // big head: the face carries the character, the mane only frames it
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const COL = {
  fur: '#e3a24b',
  furLight: '#efbb68',
  furDeep: '#cd8632',
  cream: '#f5dca3',
  maneUnder: '#8f3f14',
  maneBase: '#b3561b',
  maneTip: '#dc8a2e',
  tuft: '#6a3412',
  earIn: '#d98f45',
  crease: '#b9702a',
};

/* colour sets for the tufts: three clean tones only (dark root, rich orange base, amber tip). The rings
 * get darker toward the back so the front ring pops and frames the face. */
const SET = {
  front: { c0: '#7a3010', cm: '#b8541a', c1: '#f0a63a' },
  frontAlt: { c0: '#7a3010', cm: '#cc6b1f', c1: '#f7bb52' },
  mid: { c0: '#6a280c', cm: '#a64a15', c1: '#e8993a' },
  midAlt: { c0: '#6a280c', cm: '#bb5c1c', c1: '#f2ae48' },
  back: { c0: '#5e220a', cm: '#9a4213', c1: '#e08f30' },
  backAlt: { c0: '#5e220a', cm: '#b05419', c1: '#eda843' },
  cheek: { c0: '#7a3010', cm: '#b8541a', c1: '#f0a63a' },
  cape: { c0: '#6a280c', cm: '#a64a15', c1: '#e08f30' },
};

/* deterministic random numbers so every Leo is identical */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* torso key sections: z, centre y, half width, half height. A deep chest and broad shoulders, a waist
 * that tucks up toward the hips, and narrow hips so the silhouette is an inverted triangle. */
const TK = [
  [-8.6, 4.4, 4.6, 3.6],
  [-5.8, 5.9, 6.6, 4.6],
  [-2.9, 6.0, 6.5, 4.7],
  [-0.1, 5.6, 4.8, 4.0], // the step down from the broad shoulders to the waist
  [2.7, 5.3, 4.3, 3.6],
  [5.6, 5.2, 4.1, 3.2],
  [8.4, 5.2, 4.0, 3.1],
];
function torsoAt(z) {
  if (z <= TK[0][0]) return { cy: TK[0][1], rx: TK[0][2], ry: TK[0][3] };
  for (let i = 0; i < TK.length - 1; i++) {
    const a = TK[i];
    const b = TK[i + 1];
    if (z <= b[0]) {
      const t = (z - a[0]) / (b[0] - a[0]);
      const s = t * t * (3 - 2 * t);
      return { cy: a[1] + (b[1] - a[1]) * s, rx: a[2] + (b[2] - a[2]) * s, ry: a[3] + (b[3] - a[3]) * s };
    }
  }
  const l = TK[TK.length - 1];
  return { cy: l[1], rx: l[2], ry: l[3] };
}

/* ======================================================================== tufts
 * A tuft is one broad, flat, leaf-shaped, curved blade of hair: a root point p, a start direction d, a
 * curve vector g (where the tip is pulled to, in units of length), a length, a half width, a half
 * thickness and a flat-side hint n (the outward surface normal). Colour runs from a dark root through the
 * base colour to a bright tip. Only three rings of vertices, so every tuft is a chunky folded plane. */
const LOCK_S = [0, 0.45, 0.8];
const LOCK_W = [1.0, 0.94, 0.52];
const LOCK_T = [1.0, 0.95, 0.7]; // blunt, thick tips: edge-on they read as a chunky wedge, never a needle
const MAX_LEN = 6.4; // no tuft anywhere is longer than this, so nothing sticks out like a spear
const SLENDER = 1.5; // length / half width never exceeds this: every tuft is a fat, bold wedge, never a sliver

/** Position and local frame of a tuft at parameter s (0 root .. 1 tip). */
function lockAt(b, s) {
  const dl = Math.hypot(b.d[0], b.d[1], b.d[2]) || 1;
  const dx = b.d[0] / dl;
  const dy = b.d[1] / dl;
  const dz = b.d[2] / dl;
  const g = b.g ?? [0, 0, 0];
  const L = b.len;
  const px = b.p[0] + (dx * s + g[0] * s * s) * L;
  const py = b.p[1] + (dy * s + g[1] * s * s) * L;
  const pz = b.p[2] + (dz * s + g[2] * s * s) * L;
  let tx = dx + 2 * g[0] * s;
  let ty = dy + 2 * g[1] * s;
  let tz = dz + 2 * g[2] * s;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  let zx = b.n[0];
  let zy = b.n[1];
  let zz = b.n[2];
  const k = zx * tx + zy * ty + zz * tz;
  zx -= k * tx;
  zy -= k * ty;
  zz -= k * tz;
  let zl = Math.hypot(zx, zy, zz);
  if (zl < 1e-4) {
    zx = 0;
    zy = 1 - ty * ty;
    zz = -ty * tz;
    zl = Math.hypot(zx, zy, zz);
    if (zl < 1e-4) {
      zx = 1 - tx * tx;
      zy = -tx * ty;
      zz = -tx * tz;
      zl = Math.hypot(zx, zy, zz) || 1;
    }
  }
  zx /= zl;
  zy /= zl;
  zz /= zl;
  // X = T x Z (width direction)
  const X = [ty * zz - tz * zy, tz * zx - tx * zz, tx * zy - ty * zx];
  return { px, py, pz, X, Z: [zx, zy, zz] };
}

/* how deep a world point sits inside the tube, the flange or the deck (positive = inside) */
function boatDepth(x, y, z) {
  const rho = Math.hypot(x, z + 33);
  const tube = 6.4 - Math.hypot(rho - 33, y + 6.4);
  const flange = 3.4 - Math.hypot(rho - 33.4, y + 10.2);
  const deck = rho < 27.8 ? -5.6 - y : -1e9;
  return Math.max(tube, flange, deck);
}

/**
 * Safety net: any tuft that would reach into the tube, the flange or the deck, or stick out wider than
 * maxX, is lifted, swept back and shortened until it clears. Checked at several head yaws because the
 * head swings when the lion looks around.
 */
function fitLocks(list, { origin = [0, 0, 0], scale = 1, tilt = 0, yaws = [0], wideYaws = [0], maxX = 11.1, margin = 0.5 } = {}) {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const violates = (b) => {
    for (let k = 1; k <= 6; k++) {
      const s = k / 6;
      const f = lockAt(b, s);
      for (const wx of [-0.9, 0, 0.9]) {
        const w = wx * b.w * (1 - 0.4 * s);
        const px = f.px + f.X[0] * w;
        const fy = f.py + f.X[1] * w;
        const fz = f.pz + f.X[2] * w;
        const py = fy * ct - fz * st; // the head (mane included) is tipped back by `tilt`
        const pz = fy * st + fz * ct;
        for (const yaw of yaws) {
          const cy = Math.cos(yaw);
          const sy = Math.sin(yaw);
          const wxp = origin[0] + scale * (px * cy + pz * sy);
          const wzp = origin[2] + scale * (-px * sy + pz * cy);
          const wyp = origin[1] + scale * py;
          if (boatDepth(wxp, wyp, wzp) > -(b.margin ?? margin)) return 'boat';
          if (wideYaws.includes(yaw) && Math.abs(wxp) > maxX) return 'wide';
        }
      }
    }
    return null;
  };
  const keep = [];
  for (const b of list) {
    b.len = Math.min(b.len, MAX_LEN);
    let ok = false;
    for (let it = 0; it < 24; it++) {
      b.w = Math.max(b.w, b.len / SLENDER);
      const why = violates(b);
      if (!why) {
        ok = true;
        break;
      }
      const dl = Math.hypot(b.d[0], b.d[1], b.d[2]);
      if (why === 'boat') {
        b.d = [b.d[0], b.d[1] + 0.12 * dl, b.d[2]];
        if (b.g) b.g = [b.g[0], b.g[1] + 0.03, b.g[2]];
        b.len *= 0.97;
      } else {
        b.d = [b.d[0] * 0.93, b.d[1], b.d[2] + 0.04 * dl];
        if (b.g) b.g = [b.g[0] * 0.9, b.g[1], b.g[2]];
        b.len *= 0.98;
      }
    }
    // a tuft that cannot be made to clear the boat is simply left out (it would be hidden anyway)
    if (ok && b.len > 1.6) keep.push(b);
  }
  list.length = 0;
  list.push(...keep);
  return list;
}

function buildLocks(list) {
  const pos = [];
  const col = [];
  const idx = [];
  const c0 = new THREE.Color();
  const cm = new THREE.Color();
  const c1 = new THREE.Color();
  const c = new THREE.Color();
  const smoothStep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const R = LOCK_S.length;
  for (const b of list) {
    c0.set(b.c0);
    cm.set(b.cm ?? COL.maneBase);
    c1.set(b.c1);
    const shade = b.shade ?? 1;
    const base = pos.length / 3;
    // clean bands: dark root ring, base ring, amber tip ring (no muddy blends)
    const tint = (s) => {
      c.copy(c0).lerp(cm, smoothStep(0, 0.3, s)).lerp(c1, smoothStep(0.4, 0.8, s));
      return c;
    };
    LOCK_S.forEach((s, k) => {
      const f = lockAt(b, s);
      const w = b.w * LOCK_W[k];
      const t = b.t * LOCK_T[k];
      const tc = tint(s);
      for (const [ax, az, dark] of [[1, 0, 0.94], [0, 1, 1.0], [-1, 0, 0.94], [0, -1, 0.86]]) {
        pos.push(f.px + f.X[0] * w * ax + f.Z[0] * t * az, f.py + f.X[1] * w * ax + f.Z[1] * t * az, f.pz + f.X[2] * w * ax + f.Z[2] * t * az);
        col.push(tc.r * shade * dark, tc.g * shade * dark, tc.b * shade * dark);
      }
    });
    const tipAt = lockAt(b, 1);
    pos.push(tipAt.px, tipAt.py, tipAt.pz);
    const tc = tint(1);
    col.push(tc.r * shade, tc.g * shade, tc.b * shade);
    for (let i = 0; i < R - 1; i++) {
      for (let k = 0; k < 4; k++) {
        const a = base + i * 4 + k;
        const bb = base + i * 4 + ((k + 1) % 4);
        const cc = base + (i + 1) * 4 + k;
        const dd = base + (i + 1) * 4 + ((k + 1) % 4);
        idx.push(a, cc, bb, bb, cc, dd);
      }
    }
    const tip = base + R * 4;
    for (let k = 0; k < 4; k++) idx.push(base + (R - 1) * 4 + k, tip, base + (R - 1) * 4 + ((k + 1) % 4));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function build(rig, kit) {
  const { parts, mats, limb } = rig;
  const { smooth, mix } = kit;
  const rnd = prng(20050527);
  const jit = (a) => (rnd() - 0.5) * 2 * a;
  const col = (hex) => new THREE.Color(hex);

  /* ------------------------------------------------------------------ torso */
  {
    const z0 = TK[0][0];
    const z1 = TK[TK.length - 1][0];
    const spine = TK.map((k) => [0, k[1], k[0]]);
    const torso = kit.loft({
      spine,
      radii: (t) => {
        const r = torsoAt(z0 + t * (z1 - z0));
        return [r.rx, r.ry];
      },
      sides: 8,
      twist: Math.PI / 8,
      stations: 6,
      capSteps: 2,
    });
    kit.paint(torso, (x, y, z, nx, ny, nz) => {
      // golden back, a clearly separate cream belly and chest underneath
      const c = col(COL.fur);
      c.lerp(col(COL.furLight), smooth(0.25, 0.9, Math.abs(nx)) * smooth(-2, 4, z) * 0.3); // lighter flanks
      c.lerp(col(COL.furDeep), smooth(0.6, 1.0, ny) * smooth(-1.5, 6, z) * 0.22); // a richer back along the spine
      const belly = smooth(0.0, -0.4, ny) * smooth(6.2, 2.4, z); // fades out well before the hips, so no pale belly pokes through the cheeks
      c.lerp(col('#f8e4b4'), belly);
      c.lerp(col(COL.cream), smooth(-0.1, -0.7, nz) * smooth(-4, -8, z) * 0.9); // chest bib
      c.lerp(col(COL.maneUnder), smooth(-2.0, -7.5, z) * smooth(-0.6, 0.1, ny));
      c.lerp(col(COL.furDeep), smooth(7.0, 10.5, z) * 0.22); // gentle shadow where the rump starts
      return c;
    });
    kit.add(parts.body, torso, mats.skin, { name: 'torso' });

    // strong neck carrying the head, mostly hidden by the mane
    const neck = kit.loft({
      spine: [[0, 5.0, -6.4], [0, 3.4, -8.2], [0, 1.9, -9.4]],
      radii: [[4.4, 4.0], [4.3, 3.9], [4.1, 3.6]],
      sides: 8,
      stations: 2,
      capStart: 'none',
    });
    kit.paint(neck, (x, y, z, nx, ny) => mix(COL.maneUnder, COL.fur, smooth(0.1, -0.7, ny)));
    kit.add(parts.body, neck, mats.skin, { name: 'neck' });
  }

  /* --------------------------------------------------------- shoulder cape
   * A solid shaggy shoulder mass (dark orange, fading into the golden back) wearing three staggered rows
   * of broad tufts that lie back over the shoulders like roof tiles. The rows stop in front of the waist, so
   * the golden back and the step down from the broad shoulders show behind the mane. */
  {
    const z0 = -9.6;
    const z1 = -0.8;
    const capeAt = (z) => {
      const T = torsoAt(z);
      const fade = smooth(-4.5, -0.8, z); // tapers into the back
      return { cy: T.cy + 0.15 * (1 - fade), rx: T.rx + 0.7 * (1 - fade) - 0.2 * fade, ry: T.ry - 0.1 - 0.4 * fade };
    };
    const spine = [];
    for (let i = 0; i <= 4; i++) {
      const z = z0 + ((z1 - z0) * i) / 4;
      spine.push([0, capeAt(z).cy, z]);
    }
    const cape = kit.loft({
      spine,
      radii: (t) => {
        const r = capeAt(z0 + t * (z1 - z0));
        return [r.rx, r.ry];
      },
      sides: 8,
      twist: Math.PI / 8,
      stations: 4,
      capStart: 'none',
      capEnd: 'none',
    });
    kit.paint(cape, (x, y, z, nx, ny) => {
      const c = col(COL.maneBase);
      c.lerp(col('#c7742a'), smooth(-3, -9.5, z) * 0.35);
      c.lerp(col(COL.maneUnder), smooth(0.1, -0.8, ny) * 0.7);
      c.lerp(col(COL.fur), smooth(-3.0, -0.9, z) * 0.9);
      return c;
    });
    kit.add(parts.body, cape, mats.skin, { name: 'cape' });

    const list = [];
    // a few broad, fat tufts lie back over the shoulders like roof tiles: three clear rows, no slivers
    // (angles are measured from the top of the spine, symmetric left and right; only the first two rows
    // reach down the flanks, so the cape tapers into the back instead of flaring out like wings)
    const rows = [
      { z: -8.7, angles: [-100, -58, 58, 100], len: 4.6, w: 3.2, set: SET.front, alt: SET.frontAlt },
      { z: -6.3, angles: [-78, -30, 30, 78], len: 5.2, w: 3.5, set: SET.mid, alt: SET.midAlt },
      { z: -3.9, angles: [-50, 0, 50], len: 5.4, w: 3.6, set: SET.cape, alt: SET.backAlt },
    ];
    rows.forEach((r, ri) => {
      for (let i = 0; i < r.angles.length; i++) {
        const a = r.angles[i] * DEG;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        const top = ca > 0.5;
        const T = capeAt(r.z);
        // over the top the tufts lie back along the spine, at the sides they droop down the flank
        list.push({
          p: [T.rx * sa * (top ? 0.84 : 0.92) + jit(0.3), T.cy + T.ry * ca * (top ? 0.84 : 0.92), r.z + jit(0.45)],
          d: top ? [sa * 0.2 + jit(0.22), 0.03 + jit(0.06), 1] : [sa * 0.5 + jit(0.15), -0.25 + jit(0.1), 0.85],
          g: top ? [sa * 0.04, -0.3 + jit(0.1), 0.1] : [sa * 0.02, -0.34 + jit(0.08), 0.1],
          // side tufts tilt their broad face up, so from the camera above they are fat plates, not slivers
          n: top ? [sa * 0.45, 1, 0] : [sa * 0.5, 0.85, 0],
          len: r.len * (top ? 0.9 : 0.95) * (1 + jit(0.16)),
          w: r.w * (top ? 1.1 : 1) * (1 + jit(0.08)),
          t: 1.3,
          shade: i % 2 ? 1.1 : 0.9,
          grp: top ? `capeTop${ri}` : 'capeSide',
          ...(i % 2 && r.alt ? r.alt : r.set),
        });
      }
    });
    // one lock per side drapes over the shoulder, short and high so the arm and hand stay in view
    for (const side of [-1, 1]) {
      const a = side * 104 * DEG;
      const z = -7.4;
      const T = capeAt(z);
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      list.push({
        p: [T.rx * sa * 0.92, T.cy + T.ry * ca * 0.92, z],
        d: [sa * 0.5, -0.45, 0.45],
        g: [sa * 0.05, -0.2, 0.25],
        n: [sa * 0.6, 0.8, 0],
        len: 3.2,
        w: 2.8,
        t: 1.3,
        shade: 1,
        grp: 'capeDrape',
        ...SET.front,
      });
    }
    // two bright tufts hang in front of the chest, under the chin
    [-3.2, 3.2].forEach((x) => {
      list.push({
        p: [x, 2.2, -8.2],
        d: [x * 0.06, -0.8, -0.4],
        g: [0, -0.2, 0.12],
        n: [0, -0.2, -1],
        len: 3.2,
        w: 2.4,
        t: 1.2,
        shade: 0.98,
        grp: 'chest',
        ...SET.cheek,
      });
    });
    fitLocks(list, { maxX: 10.9, margin: 0.6 });
    for (const grp of ['capeTop0', 'capeTop1', 'capeTop2', 'capeSide', 'capeDrape', 'chest']) {
      kit.add(parts.body, buildLocks(list.filter((b) => b.grp === grp)), mats.matte, { name: `mane_${grp}` });
    }
  }

  /* ----------------------------------------------------------------- head */
  {
    const head = parts.head;
    head.scale.setScalar(HEAD_SCALE);
    // the face tips well back (chin up, show-off); the mane is rooted at the neck and tips back only a little
    const face = kit.pivot(head, [0, 0, 0], 'face');
    face.rotation.x = TILT;
    const maneG = kit.pivot(head, [0, 0, 0], 'mane');
    maneG.rotation.x = MANE_TILT;
    const faceCol = (x, y, z, nx, ny) => {
      const cream = smooth(-4.4, -7.4, z) * 0.85 + smooth(0.0, -0.7, ny) * smooth(-2.2, -4.2, z) * 0.8;
      const c = col(COL.fur).lerp(col(COL.cream), Math.min(1, cream));
      c.lerp(col(COL.furDeep), smooth(0.5, 0.95, ny) * smooth(-3, -5, z) * 0.4);
      c.lerp(col(COL.maneUnder), smooth(-1.4, 1.6, z));
      return c;
    };

    const cranium = kit.loft({
      spine: [[0, 0.9, -0.1], [0, 0.9, -1.0]],
      radii: [[4.7, 4.1], [4.9, 4.2]],
      sides: 10,
      stations: 2,
      capStart: 'none', // the back of the skull is buried in the mane and would only dip into the tube
      capSteps: 3,
    });
    kit.paint(cranium, faceCol);
    kit.add(face, cranium, mats.skin, { name: 'cranium' });

    // broad, square muzzle (octagon with flat top, bottom and sides)
    const muzzle = kit.loft({
      spine: [[0, -1.0, -2.4], [0, -1.3, -4.6]],
      radii: [[4.6, 3.3], [4.45, 2.95]],
      sides: 8,
      twist: Math.PI / 8,
      stations: 3,
      capSteps: 2,
    });
    kit.paint(muzzle, faceCol);
    kit.add(face, muzzle, mats.skin, { name: 'muzzle' });

    // long nose bridge running up between the eyes
    const bridge = kit.loft({
      spine: [[0, 1.5, -3.2], [0, 0.7, -4.8], [0, 0.1, -5.7]],
      radii: [[1.7, 1.2], [1.95, 1.1], [2.05, 1.0]],
      sides: 6,
      stations: 3,
      capStart: 'none',
      capSteps: 2,
    });
    kit.paint(bridge, (x, y, z, nx, ny) => mix(COL.fur, COL.furLight, smooth(0, 0.8, ny) * 0.5 + smooth(-5.5, -7.5, z) * 0.4));
    kit.add(face, bridge, mats.skin, { name: 'bridge' });

    // puffy cream whisker pads, flattened wedges either side of the nose
    const pads = [];
    for (const sign of [-1, 1]) {
      const pad = kit.loft({
        spine: [[0.3 * sign, -2.05, -5.3], [1.7 * sign, -2.1, -4.9], [3.2 * sign, -1.85, -4.1]],
        radii: [[1.45, 1.0], [1.7, 1.1], [1.4, 0.95]],
        sides: 7,
        stations: 3,
        capSteps: 2,
        up: [0, 1, 0],
      });
      kit.paint(pad, COL.cream);
      kit.add(face, pad, mats.matte, { name: 'whiskerPad' });
      pads.push(pad);
    }

    // strong square chin, set a touch behind the muzzle so the upper lip overhangs it
    const jaw = kit.loft({
      spine: [[0, -3.6, -1.8], [0, -3.9, -4.5]],
      radii: [[4.3, 1.9], [3.85, 1.75]],
      sides: 8,
      twist: Math.PI / 8,
      stations: 3,
      capSteps: 2,
    });
    kit.paint(jaw, (x, y, z) => mix(COL.cream, COL.fur, smooth(-2.5, -0.2, z) * 0.7));
    kit.add(face, jaw, mats.skin, { name: 'jaw' });

    // big black nose
    const nose = kit.extrude(
      [[-1.55, 0.6], [-1.1, 1.0], [0, 1.12], [1.1, 1.0], [1.55, 0.6], [1.1, -0.2], [0.5, -0.9], [-0.5, -0.9], [-1.1, -0.2]],
      1.0,
      { bevel: 0.3 },
    );
    kit.add(face, nose, mats.nose, { pos: [0, -0.5, -7.1], rot: [0.28, 0, 0], scale: [0.95, 0.9, 0.9], name: 'nose' });

    /* the confident grin: a wide open smile laid exactly on the muzzle surface (found by ray casting). A
     * bold dark upper-lip line with strongly lifted corners, a band of white teeth under it, a dark mouth
     * opening with one continuous red tongue band at the bottom, and a short philtrum from the nose to the
     * lip. Every layer floats a little above the one below, so nothing z-fights or breaks into fragments. */
    {
      const caster = new THREE.Raycaster();
      const targets = [muzzle, jaw, ...pads].map((g) => new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
      const zAt = (x, y) => {
        caster.set(new THREE.Vector3(x, y, -14), new THREE.Vector3(0, 0, 1));
        const hit = caster.intersectObjects(targets, false)[0];
        return hit ? hit.point.z : null;
      };
      const onSurface = (x, y, lift) => {
        const z = zAt(x, y);
        return z === null ? null : [x, y, z - lift];
      };
      const XC = 3.9; // half width of the grin
      const YC = -3.0; // upper lip, centre
      const RISE = 2.3; // the corners sit this much higher than the centre
      const lipY = (x) => YC + RISE * Math.pow(Math.min(1, Math.abs(x) / XC), 2.0);
      const openAt = (x) => 1.45 * Math.pow(Math.max(0, 1 - Math.pow(x / XC, 2)), 0.75);

      /* a grid of vertices laid on the face surface: columns along x, rows from topFn(x) down to botFn(x).
       * Every vertex is ray cast onto the muzzle, so the strip hugs the facets instead of cutting through. */
      const strip = (xs, topFn, botFn, rows, colorFn, lift) => {
        const pos = [];
        const colr = [];
        const idx = [];
        const c = new THREE.Color();
        let lastZ = -7;
        xs.forEach((x) => {
          const yt = topFn(x);
          const yb = botFn(x);
          for (let j = 0; j <= rows; j++) {
            const t = j / rows;
            const y = yt + (yb - yt) * t;
            const pt = onSurface(x, y, lift) ?? [x, y, lastZ];
            lastZ = pt[2];
            pos.push(...pt);
            c.set(colorFn(x, t));
            colr.push(c.r, c.g, c.b);
          }
        });
        const R1 = rows + 1;
        for (let i = 0; i < xs.length - 1; i++) {
          for (let j = 0; j < rows; j++) {
            const a = i * R1 + j;
            idx.push(a, a + 1, a + R1, a + 1, a + R1 + 1, a + R1);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        // make sure the faces look toward -Z (at the viewer)
        const nrm = g.attributes.normal;
        let nz = 0;
        for (let i = 0; i < nrm.count; i++) nz += nrm.getZ(i);
        if (nz > 0) {
          const ix = g.index.array;
          for (let i = 0; i < ix.length; i += 3) {
            const t = ix[i + 1];
            ix[i + 1] = ix[i + 2];
            ix[i + 2] = t;
          }
          g.computeVertexNormals();
        }
        return g;
      };

      const N = 20;
      const xs = Array.from({ length: N + 1 }, (_, i) => -XC + (2 * XC * i) / N);
      // dark mouth opening, with one clear red tongue band along the lower lip
      const mouthDark = new THREE.Color('#2e100c');
      const mouthRed = new THREE.Color('#d2493f');
      const mouth = strip(xs, (x) => lipY(x), (x) => lipY(x) - openAt(x), 6, (x, t) => mouthDark.clone().lerp(mouthRed, smooth(0.45, 0.75, t)), 0.3);
      kit.add(face, mouth, mats.matte, { name: 'mouth' });
      // a clean white band of teeth hanging from the upper lip
      const teethXs = xs.filter((x) => Math.abs(x) < XC * 0.8);
      const teethC0 = new THREE.Color('#fffaec');
      const teethC1 = new THREE.Color('#ecd9ad');
      const teeth = strip(teethXs, (x) => lipY(x), (x) => lipY(x) - Math.min(openAt(x) * 0.95, 0.78), 3, (x, t) => teethC0.clone().lerp(teethC1, t), 0.5);
      kit.add(face, teeth, mats.matte, { name: 'teeth' });

      const tube = (pts, r, name, taper = 0.5, color = '#3a1810') => {
        const spine = pts.filter(Boolean);
        if (spine.length < 3) return;
        // thickest in the middle, tapering to a fine point at both ends
        const radii = spine.map((_, i) => {
          const k = r * (taper + (1 - taper) * Math.sin((Math.PI * i) / (spine.length - 1)));
          return [k, k];
        });
        const g = kit.loft({ spine, radii, sides: 5, stations: Math.max(8, spine.length * 2), up: [0, 1, 0] });
        kit.paint(g, color);
        kit.add(face, g, mats.matte, { name });
      };
      // upper-lip line, curling up at both corners into little cheek creases; it ends exactly at the
      // corners of the mouth and does not wander out across the cheek
      const lipPts = [];
      for (let i = 0; i <= 12; i++) {
        const x = -XC + (2 * XC * i) / 12;
        lipPts.push(onSurface(x, lipY(x), 0.3));
      }
      const left = [onSurface(-XC - 0.05, lipY(XC) + 0.3, 0.3), onSurface(-XC - 0.1, lipY(XC) + 0.62, 0.3)];
      const right = [onSurface(XC + 0.05, lipY(XC) + 0.3, 0.3), onSurface(XC + 0.1, lipY(XC) + 0.62, 0.3)];
      tube([...left.reverse(), ...lipPts, ...right], 0.26, 'grin', 0.5);
      // philtrum: a short line from the nose to the lip
      tube([onSurface(0, -1.35, 0.1), onSurface(0, -2.0, 0.1), onSurface(0, YC + 0.05, 0.1)], 0.2, 'philtrum', 0.85);
    }

    /* big expressive eyes. The eye pivots are tipped with the face, so squinting, blinking and bulging act
     * along the face. Big whites; an amber iris with a smaller black pupil sitting low in it, looking a
     * little up out of the face plane (so the pupils read from above and in front); a half-lid on top (the
     * inner end lower, the confident smirk) and a low cheek-lid below, and a bright glint. */
    const iris = rig.plain('#b3691c', { roughness: 0.3 });
    /* The eyes sit in sockets: each eyeball is wrapped in a skin shell that has an almond-shaped window cut
     * into the front. The window has a flat, slightly slanted upper lid line (the inner end lower, the
     * confident half-lidded smirk) and a round lower edge (the smile pushes the cheek up). From the sides
     * and from above only the skin shell shows, so there is never a blank white ball, while the iris and
     * the pupil look out of the window, a little up out of the face plane. */
    const g = new THREE.Vector3(0, Math.sin(GAZE_UP), -Math.cos(GAZE_UP));
    const e2 = new THREE.Vector3(0, Math.cos(GAZE_UP), Math.sin(GAZE_UP));
    const WIN = { wx: 0.82, wy: 0.52, b0: -0.12, top: 0.16, slant: 0.18 };
    const windowTest = (u, sign) => {
      const a = u.x;
      const b = u.dot(e2);
      const c = u.dot(g);
      const topLine = WIN.top + sign * a * WIN.slant;
      const w = (a / WIN.wx) ** 2 + ((b - WIN.b0) / WIN.wy) ** 2;
      return { inside: c > 0.15 && b < topLine && w < 1, w, c };
    };
    const buildShell = (sign) => {
      const R = [2.5, 2.6, 2.06];
      const N = 20; // around the window
      const K = 4; // rings from the window rim to the back of the shell
      const dirAt = (th, ph) => {
        const a = Math.sin(th) * Math.cos(ph);
        const b = Math.sin(th) * Math.sin(ph);
        const c = Math.cos(th);
        return new THREE.Vector3(a, b * e2.y + c * g.y, b * e2.z + c * g.z);
      };
      // the angle at which each ray out of the gaze axis leaves the window (the shape is star-shaped about the gaze)
      const edge = (ph) => {
        let lo = 0;
        let hi = 1.7;
        for (let it = 0; it < 24; it++) {
          const mid = (lo + hi) / 2;
          if (windowTest(dirAt(mid, ph), sign).inside) lo = mid;
          else hi = mid;
        }
        return lo;
      };
      const pos = [];
      const colr = [];
      const idx = [];
      const c = new THREE.Color();
      for (let k = 0; k <= K; k++) {
        for (let i = 0; i < N; i++) {
          const ph = (i / N) * TAU;
          const th0 = edge(ph);
          const th = k === K ? Math.PI : th0 + (Math.PI * 0.82 - th0) * (k / K) ** 0.8;
          const u = dirAt(th, ph);
          const rr = k === 0 ? 1.05 : 1.05 + 0.02 * k;
          pos.push(R[0] * u.x * rr, R[1] * u.y * rr, R[2] * u.z * rr);
          c.copy(mix(COL.fur, COL.furLight, smooth(0.4, 1, u.y) * 0.3)).lerp(col(COL.furDeep), (1 - smooth(0, 1.6, k)) * 0.75);
          colr.push(c.r, c.g, c.b);
        }
      }
      for (let k = 0; k < K; k++) {
        for (let i = 0; i < N; i++) {
          const a0 = k * N + i;
          const b0 = k * N + ((i + 1) % N);
          const c0 = (k + 1) * N + i;
          const d0 = (k + 1) * N + ((i + 1) % N);
          idx.push(a0, b0, c0, b0, d0, c0);
        }
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      out.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
      out.setIndex(idx);
      out.computeVertexNormals();
      // make sure the faces look outward
      const nrm = out.attributes.normal;
      const pp = out.attributes.position;
      let facing = 0;
      for (let i = 0; i < nrm.count; i++) facing += nrm.getX(i) * pp.getX(i) + nrm.getY(i) * pp.getY(i) + nrm.getZ(i) * pp.getZ(i);
      if (facing < 0) {
        const ix = out.index.array;
        for (let i = 0; i < ix.length; i += 3) {
          const t = ix[i + 1];
          ix[i + 1] = ix[i + 2];
          ix[i + 2] = t;
        }
        out.computeVertexNormals();
      }
      return out;
    };
    for (const [eye, sign] of [[parts.eyeL, -1], [parts.eyeR, 1]]) {
      eye.rotation.x = TILT;
      kit.add(eye, kit.ellipsoid(2.4, 2.5, 2.0, { detail: 2 }), mats.eyeWhite, { name: 'eyeWhite' });
      const gaze = kit.pivot(eye, [0, 0, 0], 'gaze');
      gaze.rotation.x = GAZE_UP;
      kit.add(gaze, kit.ellipsoid(1.55, 1.6, 0.7, { detail: 2 }), iris, { pos: [0, 0.0, -1.5], name: 'iris' });
      kit.add(gaze, kit.ellipsoid(0.8, 0.94, 0.5, { detail: 2 }), mats.pupil, { pos: [0, -0.3, -1.82], name: 'pupil' });
      kit.add(gaze, kit.ellipsoid(0.42, 0.42, 0.22, { detail: 0 }), mats.glint, { pos: [0.5, 0.46, -2.24], name: 'glint' });
      kit.add(eye, buildShell(sign), mats.matte, { name: 'eyeSocket' });
    }

    // slim russet brows: a thin curved ridge that follows the upper lid line of the eye window, thick over
    // the middle and fading to nothing at both ends (right built, left mirrored). The pivot carries the tilt,
    // so furrowing turns them in their own plane.
    {
      const toBrow = (P) => {
        const d = [P[0] - BROW[0], P[1] - BROW[1], P[2] - BROW[2]];
        const cs = Math.cos(-BROW_SLOPE);
        const sn = Math.sin(-BROW_SLOPE);
        return [d[0], d[1] * cs - d[2] * sn, d[1] * sn + d[2] * cs];
      };
      const NB = 9;
      const pts = [];
      const radii = [];
      for (let i = 0; i < NB; i++) {
        const a = -0.72 + (1.44 * i) / (NB - 1); // across the window; the inner end is the low one
        const bTop = WIN.top + a * WIN.slant + 0.26;
        const cc = Math.sqrt(Math.max(0.08, 1 - a * a - bTop * bTop));
        const u = new THREE.Vector3(a, bTop * e2.y + cc * g.y, bTop * e2.z + cc * g.z);
        pts.push(toBrow([EYE[0] + 2.5 * u.x * 1.1, EYE[1] + 2.6 * u.y * 1.1, EYE[2] + 2.06 * u.z * 1.1]));
        const k = 0.16 + 0.5 * Math.sin((Math.PI * i) / (NB - 1));
        radii.push([k * 0.8, k]);
      }
      const R = kit.loft({ spine: pts, radii, sides: 5, stations: 10, up: [0, 1, 0], capSteps: 1 });
      kit.paint(R, (x, y, z) => mix('#8a4512', '#bf7428', smooth(-2, 2.4, x)));
      kit.add(parts.browR, R, mats.matte, { name: 'browR' });
      kit.add(parts.browL, kit.mirrorX(R), mats.matte, { name: 'browL' });
      parts.browR.rotation.x = TILT + BROW_SLOPE;
      parts.browL.rotation.x = TILT + BROW_SLOPE;
    }

    // small round ears poking up out of the mane: a stubby rounded cup with a darker inner dome
    for (const [ear, sign] of [[parts.earL, -1], [parts.earR, 1]]) {
      const outer = kit.loft({
        spine: [[0, 0, 0.9], [0, 0, -0.1]],
        radii: [[1.7, 1.65], [1.65, 1.6]],
        sides: 8,
        stations: 2,
        capStart: 'none',
        capEnd: 'round',
        capSteps: 2,
      });
      kit.paint(outer, (x, y, z) => mix(COL.fur, COL.furLight, smooth(0.3, -1.2, z) * 0.3));
      kit.add(ear, outer, mats.matte, { rot: [TILT + 0.3, sign * 0.5, 0], name: 'ear' });
      const inner = kit.loft({
        spine: [[0, 0, 0.1], [0, 0, -0.5]],
        radii: [[1.05, 1.0], [1.0, 0.96]],
        sides: 7,
        stations: 2,
        capStart: 'none',
        capEnd: 'round',
        capSteps: 2,
      });
      kit.paint(inner, COL.earIn);
      kit.add(ear, inner, mats.matte, { pos: [0, 0, -0.65], rot: [TILT + 0.3, sign * 0.5, 0], name: 'earIn' });
    }

    /* head mane: a dark orange core wearing four rings of fat, chunky tufts (10, 10, 8 and 6). The front
     * ring is rooted at the front edge of the core and fans straight out, so from the front a ring of bright
     * amber tips frames the face like the sun, with the forehead and cheeks left clear. Behind it the rings
     * get longer, darker and lie back more, rolling into the shoulder cape. Every other tuft is a lighter
     * amber, so the layers separate into a two-tone mane. Two big bright tufts hang at the
     * cheeks. */
    const ruffAt = (z) => {
      const k = smooth(-2.6, 0.4, z);
      const back = smooth(0.4, 3.6, z);
      return {
        cy: 0.9 + 0.5 * smooth(-1, 4, z),
        rx: 4.8 + 1.0 * k - 2.5 * back,
        ry: 4.5 + 0.9 * k - 2.6 * back,
      };
    };
    {
      const z0 = -2.6;
      const z1 = 2.4;
      const spine = [];
      for (let i = 0; i <= 3; i++) {
        const z = z0 + ((z1 - z0) * i) / 3;
        spine.push([0, ruffAt(z).cy, z]);
      }
      const ruff = kit.loft({
        spine,
        radii: (t) => {
          const r = ruffAt(z0 + t * (z1 - z0));
          return [r.rx, r.ry];
        },
        sides: 10,
        twist: Math.PI / 10,
        stations: 3,
        capStart: 'none',
        capEnd: 'none',
      });
      kit.paint(ruff, (x, y, z, nx, ny) => {
        const c = col('#c4671f').lerp(col('#9a4416'), smooth(-2, 3, z));
        c.lerp(col(COL.maneUnder), smooth(0.1, -0.8, ny) * 0.6);
        return c;
      });
      kit.add(maneG, ruff, mats.matte, { name: 'ruff' });
    }

    const earWindow = (a, pad = 20) => {
      const deg = Math.abs(a / DEG);
      return Math.abs(deg - 43) < pad;
    };
    const list = [];
    let ti = 0;
    /** one ring of tufts around the head, evenly spaced (with a little jitter), seen from the front as a
     * crown of petals. flare = angle off the backward axis: 90 fans straight out, less lies back. */
    const ring = (r) => {
      for (let i = 0; i < r.n; i++) {
        const a = ((i + 0.5 + r.off * 0.5) / r.n) * TAU - Math.PI; // 0 = top of the head, +-180 = chin
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        const deg = Math.abs(a / DEG);
        const atEar = earWindow(a, r.earPad ?? 20);
        if (atEar && !r.earShort) continue;
        if (r.skipTop && deg < r.skipTop) continue;
        if (deg > 158) continue; // the chin stays clear
        if (r.skipLow && deg > r.skipLow) continue; // the lower back tufts would only sink into the chest
        const side = Math.abs(sa);
        const topK = smooth(0.35, 0.95, ca);
        const T = ruffAt(r.z);
        // longest at the cheeks, a touch shorter on top and under the jaw
        const lenK = (0.9 + 0.14 * side) * (1 - 0.22 * topK) * (ca < -0.4 ? 0.9 : 1) * (atEar ? 0.62 : 1);
        const f = (r.flare - (r.topFlare ?? 16) * topK + jit(6)) * DEG;
        const out = Math.sin(f);
        const back = Math.cos(f);
        // at the sides of the head a flat tuft with a sideways normal would be a thin edge-on sliver from
        // the game camera above, so the side tufts tilt their broad face up and droop a little
        const sideK = smooth(0.55, 0.9, side) * (1 - topK);
        const odd = ti++ % 2;
        list.push({
          p: [T.rx * sa * 0.93, T.cy + T.ry * ca * 0.93, r.z + jit(0.12)],
          d: [sa * out + jit(0.04), ca * out - 0.2 * sideK + jit(0.04), back],
          g: [-sa * 0.06, (ca > 0 ? -0.12 - 0.1 * ca : -0.12) - 0.18 * sideK, r.curl + (r.topCurl ?? 0.12) * topK + jit(0.04)],
          n: [sa * (1 - 0.3 * sideK), ca * (1 - sideK) + 0.85 * sideK, 0],
          len: r.len * lenK * (1 + jit(0.12)),
          w: r.w * (1 + jit(0.06)),
          t: 1.3,
          shade: odd ? 1.1 : 0.92,
          ...(odd && r.alt ? r.alt : r.set),
        });
      }
    };
    ring({ z: -2.2, n: 12, off: 0, len: 4.4, w: 3.1, flare: 90, topFlare: 44, curl: 0.3, set: SET.front, alt: SET.frontAlt, skipTop: 0 });
    ring({ z: -0.4, n: 10, off: 0, len: 5.2, w: 3.8, flare: 76, topFlare: 38, curl: 0.3, set: SET.mid, alt: SET.midAlt, skipLow: 124 });
    ring({ z: 1.6, n: 8, off: 1, len: 5.4, w: 4.0, flare: 62, topFlare: 28, curl: 0.25, set: SET.back, alt: SET.backAlt, skipTop: 0, skipLow: 112 });
    ring({ z: 3.3, n: 6, off: 0, len: 5.0, w: 4.2, flare: 42, topFlare: 26, curl: 0.2, set: SET.back, alt: SET.backAlt, skipTop: 0, earPad: 0, skipLow: 104 });

    // cheek tufts: one big bright lock per side hangs beside the jaw and flares a little forward so it
    // frames the face
    for (const side of [-1, 1]) {
      [[118, -1.7, 4.4]].forEach(([deg, z, len]) => {
        const a = side * deg * DEG;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        const T = ruffAt(z);
        list.push({
          p: [T.rx * sa * 0.9, T.cy + T.ry * ca * 0.9, z],
          d: [sa * 0.78, -0.62, -0.18],
          g: [sa * 0.06, -0.2, 0.34],
          n: [sa, ca, 0],
          len,
          w: 3.2,
          t: 1.3,
          shade: 1.02,
          ...SET.cheek,
        });
      });
    }
    // chin tufts: three bright locks hang below the jaw and flare a little forward (they peek out under
    // the chin from the front and from above)
    [-2.8, 0, 2.8].forEach((x, i) => {
      list.push({
        p: [x, -4.0, -3.2],
        d: [x * 0.1, -0.85, -0.4],
        g: [0, -0.15, 0.2],
        n: [0, -0.3, -1],
        len: i === 1 ? 3.0 : 3.4,
        w: 2.4,
        t: 1.2,
        margin: 3.2, // the chin is the lowest part of the head, and it dips further when the lion leans into a charge
        shade: i === 1 ? 1.04 : 0.98,
        ...SET.cheek,
      });
    });
    kit.add(maneG, buildLocks(fitLocks(list, { origin: spec.pivots.head, scale: HEAD_SCALE, tilt: MANE_TILT, yaws: [-0.7, -0.35, -0.06, 0, 0.06, 0.35, 0.7], wideYaws: [-0.06, 0, 0.06], maxX: 11.0, margin: 2.0 })), mats.matte, { name: 'headMane' });
  }

  /* ------------------------------------------------------------------ arms
   * Thick six-sided upper arm, elbow bowed out and back, a forearm that tapers to a clear wrist, then a big
   * flat paw (a broad palm and four short, fat toes with dark claw tips) lying on the deck out in front of
   * the mane. Few, bold facets, like the mane. */
  for (const [pivot, side, vec] of [[parts.armL, -1, limb.arm.L], [parts.armR, 1, limb.arm.R]]) {
    const [vx, vy, vz] = vec;
    const shoulder = [0, 0, 0];
    const elbow = [side * 1.0 + vx * 0.2, vy * 0.6, vz * 0.12];
    const wrist = [vx * 0.97, vy + 2.15, vz + 2.5];
    const furTint = (x, y, z, nx, ny) => mix(COL.fur, COL.furLight, smooth(-0.2, -0.9, ny) * 0.5);

    const upper = kit.loft({
      spine: [shoulder, [elbow[0] * 0.5, elbow[1] * 0.5, elbow[2] * 0.5], elbow],
      radii: [[3.0, 3.0], [2.7, 2.7], [2.35, 2.4]],
      sides: 6,
      stations: 3,
      up: [0, 0, 1],
    });
    kit.paint(upper, furTint);
    kit.add(pivot, upper, mats.skin, { name: 'arm' });

    const mid = [(elbow[0] + wrist[0]) / 2 + side * 0.25, (elbow[1] + wrist[1]) / 2, (elbow[2] + wrist[2]) / 2];
    const fore = kit.loft({
      spine: [elbow, mid, wrist],
      radii: [[2.3, 2.3], [1.95, 1.95], [1.75, 1.75]],
      sides: 6,
      stations: 3,
      up: [0, 0, 1],
      capStart: 'none',
    });
    kit.paint(fore, furTint);
    kit.add(pivot, fore, mats.skin, { name: 'forearm' });

    // big flat paw: a wide palm and four short, fat toes lying on the deck
    const palm = kit.loft({
      spine: [[vx, vy - 0.1, vz + 2.1], [vx, vy - 0.25, vz - 0.5]],
      radii: [[2.45, 1.2], [2.95, 1.15]],
      sides: 6,
      twist: Math.PI / 6,
      stations: 2,
      capSteps: 2,
      up: [0, 1, 0],
    });
    kit.paint(palm, (x, y, z, nx, ny) => mix(COL.fur, COL.furLight, smooth(-0.1, -0.8, ny) * 0.4));
    kit.add(pivot, palm, mats.skin, { name: 'palm' });
    const toes = [];
    const claws = [];
    const reach = [1.5, 1.9, 1.9, 1.5];
    [-1.7, -0.58, 0.58, 1.7].forEach((o, k) => {
      const ox = vx + o * side;
      const fan = o * 0.1 * side;
      const L = reach[k];
      const g = kit.loft({
        spine: [[ox, vy - 0.3, vz - 0.4], [ox + fan * 0.8, vy - 0.36, vz - 0.4 - L * 0.5], [ox + fan * 1.5, vy - 0.42, vz - 0.4 - L]],
        radii: [[1.0, 0.88], [0.98, 0.82], [0.85, 0.74]],
        sides: 6,
        stations: 2,
        capSteps: 2,
        up: [0, 1, 0],
      });
      // a darker crease at the knuckle splits the toes, lighter pads at the tips
      kit.paint(g, (x, y, z) => mix(COL.fur, COL.furLight, smooth(vz - 0.9, vz - 3.2, z) * 0.8).lerp(col(COL.furDeep), (1 - smooth(vz - 0.7, vz + 0.3, z)) * 0.55));
      toes.push(g);
      const c = kit.cone(0.34, 0.8, 5);
      kit.place(c, { pos: [ox + fan * 1.5, vy - 0.55, vz - 0.4 - L - 0.5], rot: [-1.82, 0, 0] });
      kit.paint(c, '#4b2a14');
      claws.push(c);
    });
    kit.add(pivot, kit.merge(toes), mats.matte, { name: 'fingers' });
    kit.add(pivot, kit.merge(claws), mats.matte, { name: 'claws' });
  }

  /* ------------------------------------------------------- rump (cheeks)
   * Two distinct rounded buttock lobes with bold six-sided facets, set close enough that their inner faces
   * meet in a clean V-shaped cleft along x = 0. They taper at the bottom into the thighs. Right built, left
   * mirrored. Each vertex also carries a 'cleft' weight (1 along the seam) that the sore-bum shader uses
   * to turn the blush a deeper red in the cleft and the middle of the cheeks. */
  {
    const cheek = kit.loft({
      spine: [[0.05, 1.5, -2.7], [0.05, 0.8, -1.0], [0, -0.1, 0.7], [0, -1.0, 1.9]],
      radii: [[1.95, 2.05], [2.45, 2.4], [2.45, 2.45], [1.8, 1.8]],
      sides: 6,
      stations: 4,
      capSteps: 2,
    });
    kit.paint(cheek, (x, y, z, nx, ny) => {
      const c = mix(COL.fur, COL.furLight, smooth(0.2, 1, ny) * 0.25);
      const wx = Math.abs(x + CHEEK_X); // distance from the centre line
      c.lerp(col(COL.crease), (1 - smooth(0.0, 1.5, wx)) * 0.5); // soft shadow along the seam
      return c;
    });
    const cp = cheek.attributes.position;
    const cleft = new Float32Array(cp.count);
    for (let i = 0; i < cp.count; i++) {
      const wx = Math.abs(cp.getX(i) + CHEEK_X);
      cleft[i] = (1 - smooth(0.0, 2.0, wx)) * smooth(-2.8, -0.8, cp.getZ(i)) * smooth(-2.4, -0.4, cp.getY(i));
    }
    cheek.setAttribute('cleft', new THREE.BufferAttribute(cleft, 1));
    kit.add(parts.rumpR, cheek, mats.skin, { name: 'rumpR' });
    kit.add(parts.rumpL, kit.mirrorX(cheek), mats.skin, { name: 'rumpL' });
  }

  /* ------------------------------------------------------------- hind legs
   * A thick six-sided thigh that tapers into a chunky knee, a short stout shin that ends in a rounded hock
   * (no separate cap, so nothing pokes out at the heel), and a big flat paw turned out about 12 degrees with
   * three round toes. The inside of the thigh is a lighter cream. Shin, paw and toes hang from a knee pivot
   * so the kick can flex them. */
  const kneePivots = [];
  const pawPivots = [];
  for (const [pivot, side, vec] of [[parts.legL, -1, limb.leg.L], [parts.legR, 1, limb.leg.R]]) {
    const [vx, vy, vz] = vec;
    const hip = [0, 0.9, 0.6];
    const knee = [side * -0.05, -4.2, -0.9];
    const hock = [vx * 0.9, -6.5, vz + 0.2];
    const heel = [vx, vy + 2.5, vz + 0.4]; // back of the paw, just under the hock
    const front = [vx, vy + 1.0, vz - 1.1]; // ball of the paw
    const furLeg = (x, y, z, nx, ny) =>
      mix(COL.fur, COL.furLight, 0.3 + smooth(-3, -9, y) * 0.2)
        .lerp(col(COL.cream), smooth(0.05, -0.75, nx * side) * 0.6 + smooth(0.2, -0.9, ny) * 0.2);

    const thigh = kit.loft({
      spine: [hip, [0, -2.0, 0.1], knee],
      radii: [[2.7, 2.8], [2.45, 2.4], [2.0, 2.0]],
      sides: 6,
      stations: 3,
      up: [0, 0, 1],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 2,
    });
    kit.paint(thigh, furLeg);
    kit.add(pivot, thigh, mats.skin, { name: 'leg' });

    const kp = kit.pivot(pivot, knee, side < 0 ? 'kneeL' : 'kneeR');
    kneePivots.push(kp);
    const rel = (p) => [p[0] - knee[0], p[1] - knee[1], p[2] - knee[2]];

    const shin = kit.loft({
      spine: [knee, [(knee[0] + hock[0]) / 2, (knee[1] + hock[1]) / 2, (knee[2] + hock[2]) / 2 - 0.2], hock].map(rel),
      radii: [[2.0, 1.95], [1.8, 1.78], [1.62, 1.62]],
      sides: 6,
      stations: 3,
      up: [0, 0, 1],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 2,
    });
    kit.paint(shin, (x, y, z, nx, ny) => furLeg(x, y + knee[1], z + knee[2], nx, ny));
    kit.add(kp, shin, mats.skin, { name: 'shin' });

    // paw: a chunky wedge running forward-down from the heel, wide across the ball, turned outward so the
    // toes read from behind. Built around the heel so one pivot swings the whole paw.
    const paws = kit.pivot(kp, rel(heel), side < 0 ? 'pawL' : 'pawR');
    paws.rotation.y = -side * 0.22;
    pawPivots.push(paws);
    const hr = (p) => [p[0] - heel[0], p[1] - heel[1], p[2] - heel[2]];
    const axis = new THREE.Vector3(front[0] - heel[0], front[1] - heel[1], front[2] - heel[2]).normalize();
    const paw = kit.loft({
      spine: [heel, front].map(hr),
      radii: [[1.6, 1.45], [1.95, 1.35], [2.0, 1.1]],
      sides: 6,
      stations: 2,
      up: [0, 1, 0],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 2,
    });
    kit.paint(paw, (x, y) => mix(COL.fur, COL.furLight, smooth(-8.5, -12, y + heel[1]) * 0.6));
    kit.add(paws, paw, mats.matte, { name: 'foot' });
    const toes = [];
    for (const o of [-1, 0, 1]) {
      const ang = o * 0.12; // fan the toes just a little
      const dir = new THREE.Vector3(axis.x + Math.sin(ang), axis.y, axis.z * Math.cos(ang)).normalize();
      const start = [front[0] + o * 1.1 + axis.x * 0.3, front[1] + axis.y * 0.3, front[2] + axis.z * 0.3 + (o === 0 ? 0 : 0.2)];
      const end = [start[0] + dir.x * 0.95, start[1] + dir.y * 0.95, start[2] + dir.z * 0.95];
      const t = kit.loft({
        spine: [start, end].map(hr),
        radii: [[1.0, 0.92], [0.92, 0.84]],
        sides: 6,
        stations: 2,
        capSteps: 2,
        up: [0, 1, 0],
      });
      kit.paint(t, () => mix(COL.fur, COL.furLight, 0.75));
      toes.push(t);
    }
    kit.add(paws, kit.merge(toes), mats.matte, { name: 'toes' });
  }
  // the thighs meet at the midline; a thin wedge of the same fur is buried between them (wide at the top,
  // fading to nothing between the knees), so the red saddle pad behind never peeks through the gap
  {
    const seam = kit.loft({
      spine: [[0, 2.6, 9.6], [0, 0.8, 9.5], [0, -1.2, 9.4]],
      radii: [[1.0, 1.3], [0.9, 1.2], [0.35, 0.5]],
      sides: 6,
      stations: 3,
      up: [0, 0, 1],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 1,
    });
    kit.paint(seam, (x, y) => mix(COL.fur, COL.cream, 0.35 + smooth(0.5, -2.4, y) * 0.2));
    kit.add(parts.body, seam, mats.skin, { name: 'thighSeam' });
  }
  // one haunch mass per side: it runs from the tucked waist along the flank and tapers down into the top
  // of the thigh, so the side silhouette reads as a single muscular thigh (no stacked lobes) and the red
  // saddle pad can never be seen through the gap between the belly, the cheek and the tube
  for (const side of [-1, 1]) {
    const haunch = kit.loft({
      spine: [[3.0, 3.2, 4.6], [3.7, 2.6, 7.2], [3.8, 1.1, 9.0], [3.4, -0.9, 10.0]].map(([x, y, z]) => [x * side, y, z]),
      radii: [[1.7, 1.9], [2.05, 2.25], [2.05, 2.45], [1.45, 1.75]],
      sides: 6,
      stations: 4,
      up: [0, 1, 0],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 2,
    });
    kit.paint(haunch, (x, y, z, nx, ny) => mix(COL.fur, COL.furLight, 0.25 + smooth(0.2, 1, ny) * 0.2).lerp(col(COL.cream), smooth(-0.2, -0.9, ny) * 0.5));
    kit.add(parts.body, haunch, mats.skin, { name: 'haunch' });
  }

  /* ------------------------------------------------------------------ tail
   * A slim shaft rises out of the top of the rump beside the cleft (rooted deep inside the body, so there
   * is no hook), arcs over the left cheek and hangs outside the haunch, ending in a fat, solid bunch of
   * dark-brown hair: a plump bud with a few broad blades around its lower half. */
  {
    const ts = -1; // hangs off the lion's left, the side the side-on camera sees
    const spine = [
      [0, 0.4, -2.2],
      [0, 0.9, -0.6],
      [0.4, 1.3, 0.8],
      [1.4, 0.9, 1.9],
      [2.6, -0.3, 2.5],
      [3.6, -2.3, 2.6],
      [4.2, -4.6, 2.5],
      [4.5, -6.5, 2.3],
    ].map(([x, y, z]) => [x * ts, y, z]);
    const shaft = kit.loft({
      spine,
      radii: [[1.1, 1.1], [0.95, 0.95], [0.82, 0.82], [0.74, 0.74], [0.72, 0.72], [0.76, 0.76], [0.8, 0.8], [0.84, 0.84]],
      sides: 6,
      stations: 8,
      up: [1, 0, 0],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 2,
    });
    kit.paint(shaft, (x, y) => mix(COL.fur, COL.tuft, smooth(-5.0, -8.0, y) * 0.45));
    kit.add(parts.tail, shaft, mats.matte, { name: 'tailShaft' });

    const tx = 4.5 * ts;
    const ty = -6.5;
    const tz = 2.3;
    const dark = { c0: '#44200a', cm: COL.tuft, c1: '#8d4c22' };
    const bud = kit.loft({
      spine: [[tx, ty + 0.6, tz], [tx, ty - 1.4, tz], [tx, ty - 3.2, tz]],
      radii: [[1.5, 1.5], [2.1, 2.1], [1.2, 1.2]],
      sides: 6,
      stations: 3,
      up: [0, 0, 1],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 2,
    });
    kit.paint(bud, (x, y) => mix('#6a3412', '#4a2309', smooth(ty - 0.5, ty - 3.8, y) * 0.8));
    kit.add(parts.tail, bud, mats.matte, { name: 'tailBud' });
    // four fat blades hang from the widest part of the bud and splay out a little: from above the bud itself
    // is a solid dark-brown mass, from the side the blades give the bunch its ragged lower edge
    const blades = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      blades.push({
        p: [tx + sa * 0.5, ty - 1.4, tz + ca * 0.5],
        d: [sa * 0.32, -1, ca * 0.32],
        g: [sa * 0.14, 0.05, ca * 0.14],
        n: [sa, 0.3, ca],
        len: 2.5 + (i % 2) * 0.5,
        w: 1.9,
        t: 1.5,
        shade: i % 2 ? 1.1 : 0.94,
        ...dark,
      });
    }
    kit.add(parts.tail, buildLocks(blades), mats.matte, { name: 'tailTuft' });
  }

  /* --------------------------------------------------------------- animation
   * Charging: the knees bend and the paws curl, the tail lifts away, so the wind-up reads even at small
   * size. Kick: the shins flick outward a little on top of the rig's own (now slower and bigger) leg-kick
   * spring. Leo's cheeks go red early (clearly by about a third of the heat meter) and fully by half. */
  {
    const baseUpdate = rig.update.bind(rig);
    rig.update = (dt, state) => {
      baseUpdate(dt, state);
      const charge = state?.charge ?? 0;
      rig.heat.value = Math.max(rig.heat.value, 0.95 * smooth(0.04, 0.5, state?.heat ?? 0));
      const flex = Math.max(0, rig.legKick.x) * 0.3 + charge * 0.42;
      kneePivots[0].rotation.x = -flex;
      kneePivots[1].rotation.x = -flex * 0.92;
      pawPivots[0].rotation.x = charge * 0.3;
      pawPivots[1].rotation.x = charge * 0.3;
      parts.tail.rotation.x -= charge * 0.15;
      // shorter steps while walking (the paws stay planted and never reach past the front limit), but the
      // planting that cancels the body's forward lean is kept in full, so the palms never sink into the deck
      const plant = -parts.bodyRoot.rotation.x;
      parts.armL.rotation.x = plant + (parts.armL.rotation.x - plant) * 0.6;
      parts.armR.rotation.x = plant + (parts.armR.rotation.x - plant) * 0.6;
    };
  }

  /* ----------------------------------------------------------- sore-bum depth
   * The shared skin shader blends the rump toward red by heat. Leo adds a little more depth on top: the
   * cleft and the middle of the cheeks turn a deeper red, fading out toward the thighs and lower back, so
   * the blush is not one flat salmon. (Own program key, so no other character's shader is touched.) */
  {
    const zeros = (g) => new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1);
    rig.group.traverse((o) => {
      if (o.isMesh && o.material === mats.skin && !o.geometry.attributes.cleft) o.geometry.setAttribute('cleft', zeros(o.geometry));
    });
    const baseCompile = mats.skin.onBeforeCompile;
    mats.skin.onBeforeCompile = (shader, renderer) => {
      baseCompile(shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('attribute float rump;', 'attribute float rump;\nattribute float cleft;\nvarying float vCleft;')
        .replace('vRump = rump;', 'vRump = rump;\nvCleft = cleft;');
      shader.fragmentShader = shader.fragmentShader
        .replace('varying float vRump;', 'varying float vRump;\nvarying float vCleft;')
        .replace('clamp(uHeat * vRump * 1.15, 0.0, 0.9));', 'clamp(uHeat * vRump * 1.15, 0.0, 0.9));\ndiffuseColor.rgb *= 1.0 - uHeat * (0.3 * smoothstep(0.5, 1.0, vRump) + 0.4 * vCleft * vRump);');
    };
    mats.skin.customProgramCacheKey = () => 'bum-skin-heat-leo-v2';
  }
}
