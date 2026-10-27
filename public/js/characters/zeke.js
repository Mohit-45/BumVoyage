import * as THREE from '../../vendor/three.min.js';

/**
 * Zeke the zebra. A chunky plains zebra: a white coat with bold black stripes (broad over the shoulders and the haunches,
 * narrower along the back, thin and few on the neck and the face), a big blocky head with a warm light-grey muzzle and a
 * charcoal nose, big dark-pupilled eyes under thin brows, short rounded upright ears with black tips, a short stiff mane of
 * broad black and slim white blocks, thick legs with big black hooves and a slim striped tail with a black tuft.
 * He lies on his belly over the tube: chest on the red pad, forelegs reaching out on the deck with the
 * hooves flat, hips and a proper two-cheeked bum hanging over the water, hind hooves a clear gap above it.
 *
 * The body stays white and faceted; the black stripes are curved bands laid on the skin (every point of a band is
 * ray-cast onto the surface) so their edges are clean instead of stair-stepped. The hind legs are split at the hock, so a
 * kick folds the lower legs up and back (see the end of the file).
 * The sore-bum blush is a custom heat response on the skin material: white fur turns skin pink-red, black stays black.
 */

// head-local layout (the head is built at full size, its pivot sits at the end of the neck)
const EYE = [4.0, 4.0, -4.0]; // nominal spots; build() moves each pivot onto the skull surface with a ray cast
const BROW = [3.7, 7.0, -4.0];
const EAR = [3.4, 5.5, 1.2];

export const spec = {
  id: 'zeke',
  browRest: 0.0,
  pivots: {
    head: [0, 3.0, -8.6],
    armL: [-6.4, 4.4, -6.4],
    armR: [6.4, 4.4, -6.4],
    legL: [-2.05, 3.8, 9.8],
    legR: [2.05, 3.8, 9.8],
    rumpL: [-2.5, 5.6, 11.2],
    rumpR: [2.5, 5.6, 11.2],
    tail: [0, 8.9, 11.4],
    anus: [0, 5.2, 14.4],
    eyeL: [-EYE[0], EYE[1], EYE[2]],
    eyeR: EYE,
    browL: [-BROW[0], BROW[1], BROW[2]],
    browR: BROW,
    earL: [-EAR[0], EAR[1], EAR[2]],
    earR: EAR,
  },
  // lowest point of the hoof (x is mirrored for the left side); the hind hooves hang a clear gap above the water
  pawTarget: [8.7, -5.4, -14.9],
  footTarget: [2.15, -8.8, 11.2],
  // the blush covers both cheeks and the tops of the thighs and fades out softly up the haunch (shaped in the shader)
  rump: { center: [0, 4.0, 13.6], radius: 10.5 },
};

const WHITE = '#f8f8f5';
const BLACK = '#17171b';
const MUZZLE = '#c3beb8'; // warm light grey
const NOSE = '#3d393b'; // warm charcoal
const TAU = Math.PI * 2;
const sgnPow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

export function build(rig, kit) {
  const { parts, mats, limb } = rig;
  const { loft, paint, add, merge, extrude, mirrorX, ellipsoid, smooth, mix, lerp } = kit;

  const cWhite = new THREE.Color(WHITE);
  const cBlack = new THREE.Color(BLACK);
  const cShade = new THREE.Color('#dedad6');
  const cEarWhite = new THREE.Color().setRGB(1.3, 1.3, 1.28);
  const cMuzzle = new THREE.Color(MUZZLE);
  const cNose = new THREE.Color(NOSE);
  /** white fur, shaded a little on undersides, blended to black by k (0..1) */
  const fur = (k, shade = 0) => cWhite.clone().lerp(cShade, shade).lerp(cBlack, k);
  const under = (ny) => smooth(0.1, -1.0, ny) * 0.28;

  // ---------------------------------------------------------------- skin material with a proper sore-bum blush
  // Same heat-aware skin as the other animals, but tuned for a striped animal: white fur turns a skin-pink red
  // with a plateau over both cheeks and a long, soft falloff (no hard edge on the haunch); the black stripes only
  // darken toward a dull red (at most about a fifth) so they stay black. The shader colours are linear.
  const skin = rig.skinMaterial();
  {
    const baseCompile = skin.onBeforeCompile;
    skin.onBeforeCompile = (shader, renderer) => {
      baseCompile(shader, renderer);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nfloat gPale = 1.0;')
        .replace(
          'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.2, 0.18), clamp(uHeat * vRump * 1.15, 0.0, 0.9));',
          `{
          float irritation = smoothstep(0.0, 1.0, uHeat * vRump * 1.3);
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float pale = smoothstep(0.03, 0.4, lum);
          gPale = pale;
          vec3 soreSkin = vec3(0.64, 0.1, 0.09);
          vec3 soreDark = vec3(0.08, 0.01, 0.015);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(soreDark, soreSkin, pale), irritation * mix(0.2, 1.0, pale));
        }`,
        )
        .replace('totalEmissiveRadiance += vec3(0.5, 0.03, 0.03) * uGlow * vRump;', 'totalEmissiveRadiance += vec3(0.4, 0.02, 0.02) * uGlow * vRump * mix(0.15, 1.0, gPale);');
    };
    skin.customProgramCacheKey = () => 'zeke-skin-heat-v1';
  }

  /**
   * Paint one flat colour per QUAD (a loft cell is two consecutive triangles), evaluated at the cell centre.
   * Crisp edges that follow the rings, faceted look, no sawtooth. Returns a NEW non-indexed geometry.
   */
  const flat = (geometry, fn) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i + 5 < pos.count; i += 6) {
      let x = 0;
      let y = 0;
      let z = 0;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let k = 0; k < 6; k++) {
        x += pos.getX(i + k) / 6;
        y += pos.getY(i + k) / 6;
        z += pos.getZ(i + k) / 6;
        nx += nor.getX(i + k) / 6;
        ny += nor.getY(i + k) / 6;
        nz += nor.getZ(i + k) / 6;
      }
      c.set(fn(x, y, z, nx, ny, nz, i / 6));
      for (let k = 0; k < 6; k++) {
        colors[(i + k) * 3] = c.r;
        colors[(i + k) * 3 + 1] = c.g;
        colors[(i + k) * 3 + 2] = c.b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  };

  /**
   * flat() for a loft: fn gets s = arc length along the spine (exact, from the ring index, no nearest-point search).
   * cfg is the same object passed to loft(); L is the spine length.
   */
  const flatS = (geometry, cfg, L, fn) =>
    flat(geometry, (x, y, z, nx, ny, nz, q) => {
      const ring = Math.floor(q / cfg.sides);
      const main = ring - (cfg.capStart === 'none' ? 0 : cfg.capSteps ?? 3);
      const s = Math.min(1, Math.max(0, (main + 0.5) / cfg.stations)) * L;
      return fn(s, x, y, z, nx, ny, nz);
    });

  /** 1 inside any [a, b] interval */
  const within = (s, list) => (list.some(([a, b]) => s >= a && s <= b) ? 1 : 0);

  /**
   * Radii pinned to a spine's control points (by chord length) so the profile lands where you read it.
   * (kit.loft spreads plain radius lists evenly along the spine, which drifts when the points are unevenly spaced.)
   */
  const radiiOn = (spine, radii) => {
    const d = [0];
    for (let i = 1; i < spine.length; i++) d.push(d[i - 1] + Math.hypot(spine[i][0] - spine[i - 1][0], spine[i][1] - spine[i - 1][1], spine[i][2] - spine[i - 1][2]));
    const ts = d.map((v) => v / d[d.length - 1]);
    return (t) => {
      let i = 0;
      while (i < ts.length - 2 && t > ts[i + 1]) i++;
      const k = Math.min(1, Math.max(0, (t - ts[i]) / (ts[i + 1] - ts[i])));
      const e = k * k * (3 - 2 * k);
      return [lerp(radii[i][0], radii[i + 1][0], e), lerp(radii[i][1], radii[i + 1][1], e)];
    };
  };

  /** total length of a Catmull-Rom spine, as kit.loft measures it */
  const spineLength = (points) => new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal').getLength();

  /**
   * Outermost skin point of a geometry along the line from `inside` toward `outside` (and its face normal).
   * A small ray caster of our own: triangle boxes are precomputed so each ray only tests the few triangles near it,
   * which keeps building the stripes cheap.
   */
  const surface = (geometry) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const P = g.attributes.position.array;
    const count = P.length / 9;
    const box = new Float32Array(count * 6);
    for (let t = 0; t < count; t++) {
      for (let k = 0; k < 3; k++) {
        const a = P[t * 9 + k];
        const b = P[t * 9 + 3 + k];
        const c = P[t * 9 + 6 + k];
        box[t * 6 + k * 2] = Math.min(a, b, c);
        box[t * 6 + k * 2 + 1] = Math.max(a, b, c);
      }
    }
    const REACH = 60;
    return (inside, outside) => {
      const o = inside;
      let d0 = outside[0] - o[0];
      let d1 = outside[1] - o[1];
      let d2 = outside[2] - o[2];
      const len = Math.hypot(d0, d1, d2) || 1;
      d0 /= len;
      d1 /= len;
      d2 /= len;
      const lo = [Math.min(o[0] - REACH * d0, o[0] + REACH * d0), Math.min(o[1] - REACH * d1, o[1] + REACH * d1), Math.min(o[2] - REACH * d2, o[2] + REACH * d2)];
      const hi = [Math.max(o[0] - REACH * d0, o[0] + REACH * d0), Math.max(o[1] - REACH * d1, o[1] + REACH * d1), Math.max(o[2] - REACH * d2, o[2] + REACH * d2)];
      let best = -Infinity;
      let bi = -1;
      for (let t = 0; t < count; t++) {
        const b = t * 6;
        if (box[b] > hi[0] || box[b + 1] < lo[0] || box[b + 2] > hi[1] || box[b + 3] < lo[1] || box[b + 4] > hi[2] || box[b + 5] < lo[2]) continue;
        const i = t * 9;
        const e1x = P[i + 3] - P[i];
        const e1y = P[i + 4] - P[i + 1];
        const e1z = P[i + 5] - P[i + 2];
        const e2x = P[i + 6] - P[i];
        const e2y = P[i + 7] - P[i + 1];
        const e2z = P[i + 8] - P[i + 2];
        // Moller-Trumbore, two-sided
        const px = d1 * e2z - d2 * e2y;
        const py = d2 * e2x - d0 * e2z;
        const pz = d0 * e2y - d1 * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det;
        const tx = o[0] - P[i];
        const ty = o[1] - P[i + 1];
        const tz = o[2] - P[i + 2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < -1e-5 || u > 1 + 1e-5) continue;
        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = (d0 * qx + d1 * qy + d2 * qz) * inv;
        if (v < -1e-5 || u + v > 1 + 1e-5) continue;
        const hitT = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (hitT > best && hitT >= -REACH && hitT <= REACH) {
          best = hitT;
          bi = t;
        }
      }
      if (bi < 0) return null;
      const i = bi * 9;
      const a = new THREE.Vector3(P[i + 3] - P[i], P[i + 4] - P[i + 1], P[i + 5] - P[i + 2]);
      const b = new THREE.Vector3(P[i + 6] - P[i], P[i + 7] - P[i + 1], P[i + 8] - P[i + 2]);
      return { p: new THREE.Vector3(o[0] + d0 * best, o[1] + d1 * best, o[2] + d2 * best), n: a.cross(b).normalize() };
    };
  };

  /** make the triangles of an indexed geometry face the way `normal` points (checked on the first triangle) */
  const faceOutward = (g, normal) => {
    const pos = g.attributes.position;
    const ix = g.index.array;
    const a = new THREE.Vector3().fromBufferAttribute(pos, ix[0]);
    const b = new THREE.Vector3().fromBufferAttribute(pos, ix[1]);
    const c = new THREE.Vector3().fromBufferAttribute(pos, ix[2]);
    const fn = new THREE.Vector3().crossVectors(b.sub(a), c.sub(a));
    if (fn.dot(normal) < 0) {
      for (let i = 0; i < ix.length; i += 3) {
        const t = ix[i + 1];
        ix[i + 1] = ix[i + 2];
        ix[i + 2] = t;
      }
    }
  };

  /** A thin flat ribbon laid on a surface (crisp curved stripes). */
  const decal = (hit, inside, targets, widths, off = 0.09, step = 0.4) => {
    const curve = new THREE.CatmullRomCurve3(targets.map((t) => new THREE.Vector3(t[0], t[1], t[2])), false, 'centripetal');
    const count = Math.max(4, Math.round(curve.getLength() / step));
    const samples = [];
    for (let i = 0; i <= count; i++) {
      const tp = curve.getPointAt(i / count);
      const h = hit(typeof inside === 'function' ? inside(tp) : inside, [tp.x, tp.y, tp.z]);
      if (h) samples.push({ ...h, t: i / count });
    }
    const pos = [];
    const nor = [];
    const idx = [];
    const widthAt = (t) => {
      const f = t * (widths.length - 1);
      const i = Math.min(widths.length - 2, Math.floor(f));
      return widths[i] + (widths[i + 1] - widths[i]) * (f - i);
    };
    samples.forEach((smp, i) => {
      const a = samples[Math.max(0, i - 1)].p;
      const b = samples[Math.min(samples.length - 1, i + 1)].p;
      const T = b.clone().sub(a).normalize();
      const B = new THREE.Vector3().crossVectors(T, smp.n).normalize();
      const w = widthAt(smp.t) / 2;
      const c = smp.p.clone().addScaledVector(smp.n, off);
      const l = c.clone().addScaledVector(B, -w);
      const r = c.clone().addScaledVector(B, w);
      pos.push(l.x, l.y, l.z, r.x, r.y, r.z);
      nor.push(smp.n.x, smp.n.y, smp.n.z, smp.n.x, smp.n.y, smp.n.z);
    });
    for (let i = 0; i < samples.length - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    if (samples.length > 1) faceOutward(g, samples[0].n);
    return g;
  };

  /**
   * A curved stripe wrapped on a surface as a grid: `at(u, v)` gives a point outside the skin for u along the band
   * and v across it, and every grid point is ray-cast onto the surface. Both edges and the middle hug the skin,
   * so the edges are clean however the body curves under the band.
   */
  const band = (hit, inside, at, { n = 40, rows = 3, off = 0.06 } = {}) => {
    const pos = [];
    const nor = [];
    const idx = [];
    const slot = new Map();
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= rows; j++) {
        const t = at(i / n, j / rows);
        const h = hit(typeof inside === 'function' ? inside(t) : inside, t);
        if (!h) continue;
        const p = h.p.clone().addScaledVector(h.n, off);
        slot.set(i * (rows + 1) + j, pos.length / 3);
        pos.push(p.x, p.y, p.z);
        nor.push(h.n.x, h.n.y, h.n.z);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < rows; j++) {
        const a = slot.get(i * (rows + 1) + j);
        const b = slot.get(i * (rows + 1) + j + 1);
        const c = slot.get((i + 1) * (rows + 1) + j);
        const d = slot.get((i + 1) * (rows + 1) + j + 1);
        if ([a, b, c, d].some((v) => v === undefined)) continue;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    if (idx.length) faceOutward(g, new THREE.Vector3(nor[0], nor[1], nor[2]));
    return g;
  };

  // ---------------------------------------------------------------- super-elliptic lofts (flat tops, chamfered corners)
  /** Catmull-Rom through scalar knots, t in [0, n-1] */
  const crSample = (v, t) => {
    const n = v.length;
    const i = Math.min(n - 2, Math.max(0, Math.floor(t)));
    const f = t - i;
    const p0 = v[Math.max(0, i - 1)];
    const p1 = v[i];
    const p2 = v[i + 1];
    const p3 = v[Math.min(n - 1, i + 2)];
    return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  };

  /** Close a stack of rings (equal point counts) into one outward-facing tube; ends are a dome, a flat fan or open. */
  const tube = (rings, { capStart = 'dome', capEnd = 'dome', capSteps = 2, capLen = 0.5 } = {}) => {
    const sides = rings[0].pts.length;
    const cap = (ring, other) => {
      const dir = ring.c.clone().sub(other.c).normalize();
      const R = ring.pts.reduce((s, p) => s + p.distanceTo(ring.c), 0) / sides;
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
    const pre = capStart === 'dome' ? cap(rings[0], rings[1]).reverse() : [];
    const post = capEnd === 'dome' ? cap(rings[rings.length - 1], rings[rings.length - 2]) : [];
    const stack = [...pre, ...rings, ...post];
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
    // make sure the winding faces outward (tested on a ring in the middle)
    const mi = Math.min(pre.length + Math.floor(rings.length / 2), stack.length - 2);
    const p0 = stack[mi].pts[0];
    const normal = new THREE.Vector3().crossVectors(stack[mi].pts[1].clone().sub(p0), stack[mi + 1].pts[0].clone().sub(p0));
    if (normal.dot(p0.clone().sub(stack[mi].c)) < 0) {
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
  };

  /**
   * Loft of super-elliptic rings along Z (n = 2 is an ellipse, 3+ a rounded box).
   * keys: [{ z, x, y, rx, ry, n }]; sub rings are interpolated between keys (sub 1 = the keys only: bold planes).
   * phase 0.5 turns the ring half a step, so the top and the bottom are flat faces instead of ridges.
   */
  const superLoft = (keys, { sides = 12, sub = 1, phase = 0.5, capStart = 'dome', capEnd = 'flat', capSteps = 2, capLen = 0.5 } = {}) => {
    const fields = ['z', 'x', 'y', 'rx', 'ry', 'n'];
    const vals = {};
    for (const f of fields) vals[f] = keys.map((k) => k[f] ?? (f === 'n' ? 2 : 0));
    const total = (keys.length - 1) * sub;
    const rings = [];
    for (let i = 0; i <= total; i++) {
      const r = {};
      for (const f of fields) r[f] = sub === 1 ? vals[f][i] : crSample(vals[f], i / sub);
      const e = 2 / Math.max(2, r.n);
      const pts = [];
      for (let k = 0; k < sides; k++) {
        const a = ((k + phase) / sides) * TAU;
        pts.push(new THREE.Vector3(r.x + r.rx * sgnPow(Math.sin(a), e), r.y + r.ry * sgnPow(Math.cos(a), e), r.z));
      }
      rings.push({ c: new THREE.Vector3(r.x, r.y, r.z), pts });
    }
    return tube(rings, { capStart, capEnd, capSteps, capLen });
  };

  /**
   * A short stiff brush: blunt tapered blocks in a row, alternating black and white (the black ones broader and a touch taller).
   * rows: [{ z, y, h, w, d, lean, color }]; each block is a truncated four-sided pyramid standing on its root.
   */
  const brush = (rows) => {
    const list = rows.map((r) => {
      const g = new THREE.CylinderGeometry(0.7, 1, r.h, 4, 1);
      g.rotateY(Math.PI / 4);
      g.scale(r.d / 2 / 0.7071, 1, r.w / 2 / 0.7071);
      g.translate(0, r.h / 2, 0);
      g.deleteAttribute('uv');
      g.rotateX(r.lean);
      g.translate(0, r.y, r.z);
      g.computeVertexNormals();
      paint(g, r.color);
      return g;
    });
    return merge(list);
  };

  // ---------------------------------------------------------------- torso: a barrel that tapers into the hips
  const torsoCfg = {
    spine: [[0, 7.0, -4.8], [0, 6.95, -1.8], [0, 6.5, 1.3], [0, 5.95, 3.9], [0, 5.55, 6.0]],
    radii: [[5.5, 5.4], [6.5, 5.8], [6.5, 5.6], [6.0, 5.1], [5.3, 4.5]],
    sides: 14,
    stations: 12,
    capSteps: 3,
    twist: Math.PI / 14, // half a step: the back is a flat facet, not a ridge, so the stripes lie flat across it
  };
  const torso = loft(torsoCfg);
  const torsoP = flat(torso, (x, y, z, nx, ny) => fur(0, under(ny)));
  add(parts.body, torsoP, skin, { name: 'torso' });

  {
    const hit = surface(torso);
    // height of the barrel's centre line at a given z (the dome behind the hips keeps sloping down)
    const spineY = (z) => {
      const pts = [[-4.8, 7.0], [-1.8, 6.95], [1.3, 6.5], [3.9, 5.95], [6.0, 5.55]];
      if (z >= pts[4][0]) return pts[4][1] - 0.17 * (z - pts[4][0]);
      for (let i = 0; i < 4; i++) if (z <= pts[i + 1][0]) return lerp(pts[i][1], pts[i + 1][1], (z - pts[i][0]) / (pts[i + 1][0] - pts[i][0]));
      return pts[0][1];
    };
    const REACH = 0.78;

    /**
     * One flank band wrapped from belly to belly over the back. s runs -1 (left flank) .. +1 (right flank), 0 = spine.
     * sweep curls the lower ends backward, wob makes the edges wander a little, pinch narrows the lower ends.
     */
    const centreOf = (b, s) => b.zc + b.sweep * Math.abs(s) ** 1.5 + b.wob * Math.sin(s * 3.1 + b.ph);
    const flankBand = (b) =>
      band(
        hit,
        (t) => [0, spineY(t[2]), t[2]],
        (u, v) => {
          const s = lerp(b.s0 ?? -1, b.s1 ?? 1, u);
          const a = s * REACH * Math.PI;
          const k = Math.abs(s);
          const taper = 1 - b.pinch * k ** 2;
          const z = centreOf(b, s) + (v - 0.5) * b.w * taper;
          return [20 * Math.sin(a), spineY(z) + 20 * Math.cos(a), z];
        },
        { n: 28, rows: 2, off: 0.27 },
      );

    // four bands of different thickness: broad on the shoulder and on the haunch, thin in the middle of the back; the
    // lower ends curl back and narrow, so the barrel does not read as ruled
    const bands = [
      { zc: -5.1, w: 2.7, sweep: 1.0, wob: 0.12, ph: 0.3, pinch: 0.45, gap: 0.14 },
      { zc: -1.7, w: 2.0, sweep: 1.3, wob: 0.1, ph: 1.7, pinch: 0.3, gap: 0.14 },
      { zc: 1.4, w: 1.45, sweep: 1.4, wob: 0.1, ph: 2.9, pinch: 0.2 },
      { zc: 4.9, w: 2.6, sweep: 1.8, wob: 0.1, ph: 4.1, pinch: 0.6 },
    ];
    // the bands that run under the mane stop short of the spine (the crest stays white, so the black and white blocks stand out)
    const pieces = bands.flatMap((b) => (b.gap ? [{ ...b, s1: -b.gap }, { ...b, s0: b.gap }] : [b]));
    const g = merge(pieces.map(flankBand));
    paint(g, BLACK);
    add(parts.body, g, mats.matte, { name: 'stripes', shadow: false });
  }

  // ---------------------------------------------------------------- neck
  const neckSpine = [[0, 8.0, -4.4], [0, 7.0, -6.0], [0, 5.5, -7.3], [0, 4.1, -8.1]];
  const neckCfg = {
    spine: neckSpine,
    radii: [[4.9, 5.0], [4.6, 4.7], [4.4, 4.4], [4.2, 4.2]],
    sides: 12,
    stations: 10,
    capStart: 'none',
    capEnd: 'none',
  };
  const neck = loft(neckCfg);
  // uneven bands (thin, thick, medium) so the neck does not look ruled
  const neckBands = [[0.35, 1.3], [2.2, 3.9], [4.8, 5.6]];
  const neckP = flatS(neck, neckCfg, spineLength(neckSpine), (s, x, y, z, nx, ny) => fur(within(s, neckBands) * (ny > 0.8 ? 0 : 1), under(ny)));
  add(parts.body, neckP, skin, { name: 'neck' });

  // ---------------------------------------------------------------- mane: a short stiff brush of black and white blocks
  {
    const top = surface(merge([torsoP, neckP]));
    const crestY = (z) => {
      const h = top([0, 0, z], [0, 40, z]);
      return h ? h.p.y : 9;
    };
    const rows = [];
    // black blocks broad and a little taller, white ones slim between them: a short even brush, not spikes
    const hs = [2.7, 2.3, 2.8, 2.4, 2.8, 2.4, 2.6, 2.3];
    let i = 0;
    for (let z = 0.4; z >= -7.4; z -= 1.15, i++) {
      const black = i % 2 === 0;
      rows.push({ z, y: crestY(z) - 0.8, h: hs[i % hs.length], w: black ? 1.45 : 1.05, d: black ? 2.9 : 2.5, lean: 0.14 + 0.03 * Math.sin(i * 1.9), color: black ? BLACK : WHITE });
    }
    add(parts.body, brush(rows), mats.matte, { name: 'mane' });
  }

  // ---------------------------------------------------------------- head: one chunky block from the skull to the blunt muzzle
  // Built at full size on the head pivot and tipped up a few degrees (a child group, because the rig drives the pivot's own
  // rotation) so the eyes, grin and muzzle show to the camera above. The eyes, brows and ears move into that group.
  const head = kit.pivot(parts.head, [0, 0, 0], 'headTilt');
  head.rotation.x = 0.1;
  for (const key of ['eyeL', 'eyeR', 'browL', 'browR', 'earL', 'earR']) head.add(parts[key]);
  const skullKeys = [
    { z: 3.4, y: 1.0, rx: 4.3, ry: 4.5, n: 2.3 },
    { z: 0.6, y: 1.5, rx: 6.1, ry: 5.6, n: 2.6 },
    { z: -2.8, y: 1.0, rx: 6.1, ry: 5.4, n: 2.8 },
    { z: -5.4, y: -0.6, rx: 5.0, ry: 4.6, n: 3.0 },
    { z: -8.4, y: -1.5, rx: 4.4, ry: 4.0, n: 3.2 },
    { z: -10.2, y: -1.8, rx: 4.1, ry: 3.75, n: 3.3 },
  ];
  const SK = { sides: 12, capStart: 'dome', capEnd: 'dome', capSteps: 2, capLen: 0.3 };
  const skull = superLoft(skullKeys, { ...SK, sub: 1 });
  // a smooth twin of the skull: stripes and rings are ray-cast onto it, so they never sink into the chunky facets
  const skullSmooth = superLoft(skullKeys, { ...SK, sides: 30, sub: 4, capSteps: 5 });
  const MOUTH_Y = -3.3; // the mouth line: charcoal above it on the nose end, light grey chin below
  const skullP = flat(skull, (x, y, z, nx, ny, nz) => {
    // white face, a warm light-grey muzzle, and a charcoal nose block over the front of the muzzle
    let c = fur(0, under(ny));
    if (z < -5.9) c = cMuzzle.clone().lerp(cShade, Math.max(0, under(ny) - 0.08));
    if (z < -8.3 && y > MOUTH_Y) c = cNose;
    return c;
  });
  add(head, skullP, skin, { name: 'skull' });

  const faceHit = surface(skullSmooth);
  /** first skull point along a line from a point inside it (used to seat eyes, brows and ears exactly on the surface) */
  const onSkull = (from, dir) => {
    const h = faceHit(from, [from[0] + dir[0] * 30, from[1] + dir[1] * 30, from[2] + dir[2] * 30]);
    return h ? [h.p.x, h.p.y, h.p.z] : from;
  };
  /** points around the muzzle: [angle in degrees (0 = straight ahead, + = the zebra's right), y], 30 out from the axis at zc */
  const around = (zc, list) => list.map(([deg, y]) => [30 * Math.sin((deg * Math.PI) / 180), y, zc - 30 * Math.cos((deg * Math.PI) / 180)]);
  {
    // a wide grin: one dark crease under the charcoal upper lip, across the front of the muzzle and back along both cheeks,
    // curling up at the corners of the mouth
    const turn = [[-112, -1.2], [-98, -2.0], [-80, -2.7], [-55, -3.25], [-28, -3.6], [0, -3.7], [28, -3.6], [55, -3.25], [80, -2.7], [98, -2.0], [112, -1.2]];
    const g = decal(faceHit, (tp) => [0, tp.y, -6.5], around(-6.5, turn), [0.2, 0.45, 0.6, 0.62, 0.62, 0.62, 0.62, 0.62, 0.6, 0.45, 0.2], 0.05, 4);
    paint(g, '#2a1d20');
    add(head, g, mats.matte, { name: 'grin', shadow: false });
  }

  // crisp black stripes down the face (narrow ones: the white forehead and cheeks stay dominant)
  {
    const C = [0, 0.3, -1.8];
    const stripes = [];
    const pair = (targets, widths) => {
      stripes.push(decal(faceHit, C, targets, widths, 0.06));
      stripes.push(decal(faceHit, C, targets.map(([x, y, z]) => [-x, y, z]), widths, 0.06));
    };
    // centre stripe, forehead to the nose bridge (stops where the muzzle begins)
    stripes.push(decal(faceHit, C, [[0, 8, -1.0], [0, 5.5, -3.2], [0, 3.2, -5.2], [0, 1.6, -6.3]], [0.9, 1.0, 0.75, 0.4], 0.06));
    // one band down each cheek, behind the eye
    pair([[5.8, 4.6, 0.9], [6.3, 2.0, 0.8], [6.3, -0.8, 0.9], [5.8, -3.4, 0.8]], [0.5, 1.2, 1.15, 0.4]);
    const g = merge(stripes);
    paint(g, BLACK);
    add(head, g, mats.matte, { name: 'faceStripes', shadow: false });
  }

  // one chunky pair of front teeth, set into the grin (hanging from the charcoal upper lip over the mouth line)
  {
    const front = faceHit([0, -2.2, -6.0], [0, -2.2, -20]);
    const tz = (front ? front.p.z : -11.0) + 0.05;
    const tooth = extrude([[-0.7, 0], [0.7, 0], [0.7, -1.4], [0.4, -1.7], [-0.4, -1.7], [-0.7, -1.4]], 0.55, { bevel: 0.12 });
    const teeth = merge([tooth.clone().translate(-0.75, 0, 0), tooth.clone().translate(0.75, 0, 0)]);
    paint(teeth, '#fffdf1');
    add(head, teeth, mats.matte, { pos: [0, -1.55, tz], name: 'teeth' });
  }

  // ---------------------------------------------------------------- eyes: a round eyeball sunk into the skull, a big dark pupil
  // Each eye sits in a socket that faces up, out and forward, so the pupil shows from the front, the side AND from above. The
  // pivot is moved onto the skull surface and the ball is sunk a little into it, so a clear dome of white shows all round.
  const eyeWhite = rig.plain('#fffdf6', { roughness: 0.35 });
  const pupilMat = rig.plain('#14121a', { roughness: 0.55 });
  const EYE_YAW = 0.7;
  const EYE_TILT = 0.5;
  const eyeQuat = (sign) => new THREE.Quaternion().setFromEuler(new THREE.Euler(EYE_TILT, -sign * EYE_YAW, 0, 'YXZ'));
  const nEye = new THREE.Vector3(0, 0, -1).applyQuaternion(eyeQuat(1)); // outward normal of the right eye's socket
  const t1Eye = new THREE.Vector3(1, 0, 0).applyQuaternion(eyeQuat(1));
  const t2Eye = new THREE.Vector3(0, 1, 0).applyQuaternion(eyeQuat(1));
  const EYE_ON = onSkull([EYE[0] - nEye.x * 7, EYE[1] - nEye.y * 7, EYE[2] - nEye.z * 7], [nEye.x, nEye.y, nEye.z]);
  parts.eyeR.position.set(EYE_ON[0], EYE_ON[1], EYE_ON[2]);
  parts.eyeL.position.set(-EYE_ON[0], EYE_ON[1], EYE_ON[2]);
  const glintDisc = (() => {
    const g = new THREE.CylinderGeometry(0.34, 0.34, 0.12, 8);
    g.rotateX(Math.PI / 2);
    g.deleteAttribute('uv');
    return g;
  })();
  for (const [eye, sign] of [[parts.eyeL, -1], [parts.eyeR, 1]]) {
    const socket = new THREE.Group();
    socket.quaternion.copy(eyeQuat(sign));
    socket.position.copy(new THREE.Vector3(0, 0, 0.75).applyQuaternion(socket.quaternion));
    eye.add(socket);
    add(socket, ellipsoid(2.2, 2.3, 1.98, { detail: 2 }), eyeWhite, { name: 'eyeWhite' });
    add(socket, ellipsoid(1.2, 1.3, 0.56, { detail: 2 }), pupilMat, { name: 'pupil', pos: [sign * -0.1, -0.15, -1.55] });
    add(socket, glintDisc, mats.glint, { name: 'glint', pos: [sign * -0.1 + 0.45, 0.4, -2.15] });
  }

  // a thin dark rim around each eye, laid on the skull around the eyeball in the eye's own plane
  const ringPoint = (r, a) => [
    EYE_ON[0] + t1Eye.x * Math.cos(a) * r * 0.96 + t2Eye.x * Math.sin(a) * r,
    EYE_ON[1] + t1Eye.y * Math.cos(a) * r * 0.96 + t2Eye.y * Math.sin(a) * r,
    EYE_ON[2] + t1Eye.z * Math.cos(a) * r * 0.96 + t2Eye.z * Math.sin(a) * r,
  ];
  {
    const ring = band(
      faceHit,
      (t) => [t[0] - nEye.x * 16, t[1] - nEye.y * 16, t[2] - nEye.z * 16],
      (u, v) => {
        const p = ringPoint(lerp(2.1, 2.23, v), u * TAU);
        return [p[0] + nEye.x * 8, p[1] + nEye.y * 8, p[2] + nEye.z * 8];
      },
      { n: 20, rows: 1, off: 0.06 },
    );
    paint(ring, '#26262d');
    add(head, merge([ring, mirrorX(ring)]), mats.matte, { name: 'eyeRing', shadow: false });
  }

  // brows: a slim black arch lying on the skull over each eye, concentric with the eye (it follows the surface, so it can never
  // float off the brow ridge); the rig's furrow is damped at the end of the file
  {
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const a = ((34 + (k / 8) * 92) * Math.PI) / 180;
      const p = ringPoint(3.4, a);
      const h = faceHit([p[0] - nEye.x * 16, p[1] - nEye.y * 16, p[2] - nEye.z * 16], [p[0] + nEye.x * 8, p[1] + nEye.y * 8, p[2] + nEye.z * 8]);
      if (h) pts.push([h.p.x + h.n.x * 0.05, h.p.y + h.n.y * 0.05, h.p.z + h.n.z * 0.05]);
    }
    const mid = pts[Math.floor(pts.length / 2)];
    const arch = loft({
      spine: pts.map((p) => [p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]]),
      radii: [[0.18, 0.16], [0.3, 0.24], [0.36, 0.27], [0.36, 0.27], [0.3, 0.24], [0.18, 0.16]],
      sides: 5,
      stations: 8,
      up: [nEye.x, nEye.y, nEye.z],
      capStart: 'round',
      capEnd: 'round',
      capSteps: 1,
    });
    paint(arch, BLACK);
    add(parts.browR, arch, mats.matte, { name: 'brow' });
    add(parts.browL, mirrorX(arch), mats.matte, { name: 'brow' });
    parts.browR.position.set(mid[0], mid[1], mid[2]);
    parts.browL.position.set(-mid[0], mid[1], mid[2]);
    rig.pivotPos.browR = [mid[0], mid[1], mid[2]];
    rig.pivotPos.browL = [-mid[0], mid[1], mid[2]];
  }

  // ears: rounded, upright and chunky (a thick cone, so they read from every side), white outside with a black tip and a pale
  // grey lining on the front
  {
    const spine = [[0, -1.0, 0], [0, 0.9, -0.05], [0, 2.7, -0.2], [0, 4.4, -0.4]];
    const earCfg = {
      spine,
      radii: radiiOn(spine, [[2.05, 1.15], [2.05, 1.1], [1.65, 0.9], [0.85, 0.5]]),
      sides: 8,
      stations: 6,
      up: [0, 0, 1],
      capStart: 'none',
      capEnd: 'round',
      capSteps: 2,
    };
    // the white is pushed past 1.0 on purpose: the back of the ear faces away from the sun, and without this it reads grey
    const earP = flat(loft(earCfg), (x, y, z, nx, ny, nz) => {
      if (y > 3.3) return cBlack;
      if (nz < -0.45 && y > 0.2) return '#cdc4c0';
      return cEarWhite;
    });
    const base = onSkull([EAR[0], 1.0, EAR[2]], [0, 1, 0]);
    parts.earR.position.set(base[0], base[1] - 0.3, base[2]);
    parts.earL.position.set(-base[0], base[1] - 0.3, base[2]);
    add(parts.earR, earP, mats.matte, { rot: [-0.12, -0.35, -0.34], name: 'ear' });
    add(parts.earL, mirrorX(earP), mats.matte, { rot: [-0.12, 0.35, 0.34], name: 'ear' });
  }

  // ---------------------------------------------------------------- sturdy forelegs with big rounded hooves
  // The leg starts deep inside the chest and swells into a thick upper arm, so there is no ball at the shoulder; three
  // bold bands per leg, one chunky hoof.
  const hoofFront = (() => {
    const g = loft({
      spine: [[0, 1.2, 1.3], [0, 1.2, -0.5], [0, 1.2, -2.0]],
      radii: [[2.3, 1.2], [2.7, 1.2], [2.25, 1.1]],
      sides: 10,
      stations: 3,
      up: [0, 1, 0],
      capSteps: 2,
    });
    return flat(g, (x, y, z, nx, ny) => mix('#17171c', '#32323a', smooth(0.4, 1, ny) * 0.5));
  })();
  for (const [pivot, side, vec] of [[parts.armL, -1, limb.arm.L], [parts.armR, 1, limb.arm.R]]) {
    const hx = vec[0];
    const hy = vec[1];
    const hz = vec[2];
    const spine = [
      [side * -2.6, 2.2, 2.4],
      [side * 0.9, -1.8, -0.4],
      [side * 2.4, -5.6, -4.0],
      [hx, hy + 3.2, hz + 1.3],
      [hx, hy + 1.9, hz + 0.95],
    ];
    const armCfg = {
      spine,
      radii: radiiOn(spine, [[2.0, 2.0], [2.7, 2.7], [2.35, 2.3], [2.0, 1.95], [1.95, 1.9]]),
      sides: 10,
      stations: 9,
      up: [0, 1, 0],
    };
    const arm = loft(armCfg);
    const L = spineLength(spine);
    const armP = flatS(arm, armCfg, L, (s, x, y, z, nx, ny) => {
      // three bold bands: above the knee, on the cannon, and just above the hoof
      const k = within(s, [[L - 10.6, L - 8.7], [L - 6.9, L - 5.5], [L - 3.8, L - 2.8]]);
      return fur(k, under(ny));
    });
    add(pivot, armP, skin, { name: 'arm' });
    const hoof = side > 0 ? hoofFront : mirrorX(hoofFront);
    add(pivot, hoof, mats.matte, { pos: [hx, hy, hz], name: 'hoof' });
  }

  // ---------------------------------------------------------------- hind legs: thigh, hock, cannon, hoof
  const HOOF_TOP = 2.5; // the hoof's top ring sits this far above the foot target
  const hoofRear = (() => {
    const g = loft({
      spine: [[0, HOOF_TOP, 0.05], [0, 1.4, -0.05], [0, 0.55, -0.3], [0, 0.0, -0.45]],
      radii: [[1.8, 1.85], [2.45, 2.6], [2.75, 3.0], [2.5, 2.8]],
      sides: 10,
      stations: 4,
      up: [0, 0, 1],
      capStart: 'none',
      capEnd: 'none',
    });
    return flat(g, (x, y, z, nx, ny) => mix('#17171c', '#33333b', smooth(0.4, 1, ny) * 0.5));
  })();
  const hoofCap = (() => {
    // a flat black sole under the hoof so it is closed
    const g = new THREE.CircleGeometry(1, 10);
    g.rotateX(Math.PI / 2);
    g.scale(2.5, 1, 2.8);
    paint(g, '#101014');
    return g;
  })();
  // Each hind leg is two lofts: the thigh and gaskin down to the hock, and a lower leg with the hoof on a hock pivot, so the
  // lower leg can fold up and back in a kick (see the kick motion at the end of this file).
  const hocks = [];
  const HOCK = [0, -6.9, 1.65]; // the hock joint, relative to the hip pivot
  /** arc length along a spine at the point nearest to a given height (the spines here run steadily downward) */
  const sAtY = (spine, y) => {
    const curve = new THREE.CatmullRomCurve3(spine.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i <= 400; i++) {
      const d = Math.abs(curve.getPointAt(i / 400).y - y);
      if (d < bestD) {
        bestD = d;
        best = i / 400;
      }
    }
    return best * curve.getLength();
  };
  for (const [pivot, side, vec] of [[parts.legL, -1, limb.leg.L], [parts.legR, 1, limb.leg.R]]) {
    const hx = vec[0];
    const hy = vec[1];
    const hz = vec[2];
    // thigh: the stifle swings forward a little, then the gaskin comes back to the hock
    const upSpine = [
      [0, 1.2, -0.3],
      [side * 0.15, -1.9, -0.9],
      [side * 0.15, -3.5, 0.0],
      [side * -0.1, -4.9, 0.8],
      [0, HOCK[1], HOCK[2]],
    ];
    const upCfg = {
      spine: upSpine,
      radii: radiiOn(upSpine, [[3.3, 3.4], [3.2, 3.6], [3.05, 3.05], [2.75, 2.8], [2.3, 2.4]]),
      sides: 10,
      stations: 9,
      up: [0, 0, 1],
      capEnd: 'round',
      capSteps: 2,
    };
    const upper = loft(upCfg);
    const Lu = spineLength(upSpine);
    // two bold bands on the thigh under the bum stripes, the upper one broader
    const bandsU = [[-3.9, -2.1], [-6.3, -5.4]].map(([y0, y1]) => [sAtY(upSpine, y1), sAtY(upSpine, y0)]);
    add(pivot, flatS(upper, upCfg, Lu, (s, x, y, z, nx, ny) => fur(within(s, bandsU), under(ny) * 0.5)), skin, { name: 'leg' });

    // lower leg and hoof, in hock coordinates (origin = the hock joint)
    const hock = kit.pivot(pivot, HOCK, 'hock');
    hocks.push(hock);
    const topY = hy + HOOF_TOP - 0.3 - HOCK[1]; // the leg ends inside the hoof
    const loSpine = [
      [0, 0.0, 0.0],
      [0, topY * 0.33, 0.12],
      [0, topY * 0.68, 0.06],
      [hx, topY, hz + 0.3 - HOCK[2]],
    ];
    const loCfg = {
      spine: loSpine,
      radii: radiiOn(loSpine, [[2.3, 2.4], [2.0, 2.15], [1.85, 1.85], [1.85, 1.85]]),
      sides: 10,
      stations: 5,
      up: [0, 0, 1],
      capStart: 'round',
      capEnd: 'none',
      capSteps: 2,
    };
    const lower = loft(loCfg);
    const Ll = spineLength(loSpine);
    const bandsL = [[-2.7, -1.4]].map(([y0, y1]) => [sAtY(loSpine, y1), sAtY(loSpine, y0)]);
    add(hock, flatS(lower, loCfg, Ll, (s, x, y, z, nx, ny) => fur(within(s, bandsL), under(ny) * 0.5)), skin, { name: 'leg' });
    add(hock, hoofRear, mats.matte, { pos: [hx, hy - HOCK[1], hz + 0.2 - HOCK[2]], name: 'hoof' });
    add(hock, hoofCap, mats.matte, { pos: [hx, hy - HOCK[1] + 0.02, hz - 0.25 - HOCK[2]], name: 'sole' });
  }

  // ---------------------------------------------------------------- the bum: two real cheeks with a cleft
  {
    const cheek = loft({
      spine: [[0, 0.7, -3.2], [0, -0.1, 0.1], [0, -1.5, 1.9]],
      radii: [[2.75, 2.95], [3.15, 3.5], [2.75, 3.1]],
      sides: 12,
      stations: 7,
      up: [0, 1, 0],
      capSteps: 3,
    });
    const cheekP = flat(cheek, (x, y, z, nx, ny) => fur(0, under(ny)));
    add(parts.rumpR, cheekP, skin, { name: 'cheekR' });
    add(parts.rumpL, mirrorX(cheekP), skin, { name: 'cheekL' });

    // two bold arcs fanning out from beside the tail root, down and around each cheek (the crown, the cleft and the tail root stay
    // white); they run on into the thigh bands below
    const hit = surface(cheek);
    const ribbons = [];
    for (const [ly, w, tilt, a0] of [[1.0, 1.8, 2.3, -48], [-1.9, 1.3, 1.9, -52]]) {
      ribbons.push(
        band(
          hit,
          (t) => [0, t[1], 0.2],
          (u, v) => {
            const a = ((a0 + (143 - a0) * u) * Math.PI) / 180;
            const taper = 0.4 + 0.6 * Math.sin(Math.PI * u) ** 0.5;
            const y = ly - tilt * u * 0.9 + (v - 0.5) * w * taper;
            return [20 * Math.sin(a), y, 0.2 + 20 * Math.cos(a)];
          },
          { n: 22, rows: 2, off: 0.26 },
        ),
      );
    }
    const rib = merge(ribbons);
    paint(rib, BLACK);
    add(parts.rumpR, rib, mats.matte, { name: 'cheekStripesR', shadow: false });
    add(parts.rumpL, mirrorX(rib), mats.matte, { name: 'cheekStripesL', shadow: false });
  }

  // ---------------------------------------------------------------- tail: flicked out to one side, a slim black brush on the end
  // It rises a little off the croup, then swishes out sideways and back over the water with the brush lying nearly level, so the
  // brush shows full length from any seat around the boat and stays below the top of the head.
  {
    const spine = [[0, -0.7, -0.9], [0.25, 0.3, 0.2], [0.9, 1.1, 1.2], [1.9, 1.6, 2.2], [3.1, 1.6, 3.2], [4.2, 1.2, 4.0]];
    const tailCfg = {
      spine,
      radii: [[1.05, 1.05], [0.85, 0.85], [0.7, 0.7], [0.58, 0.58], [0.5, 0.5], [0.46, 0.46]],
      sides: 6,
      stations: 8,
      up: [0, 0, 1],
      capStart: 'none',
    };
    const tail = loft(tailCfg);
    const tailP = flatS(tail, tailCfg, spineLength(spine), (s, x, y, z, nx, ny) => fur(within(s, [[2.8, 4.0], [5.2, 6.3]])));
    add(parts.tail, tailP, skin, { name: 'tail' });
    // the brush: one slim black teardrop that swings away from the body (out over the water)
    const drop = loft({
      spine: [[4.2, 1.2, 4.0], [5.2, 1.1, 4.7], [6.2, 0.9, 5.4], [7.0, 0.6, 6.0]],
      radii: [[0.55, 0.55], [1.2, 1.1], [1.1, 0.95], [0.3, 0.26]],
      sides: 8,
      stations: 5,
      up: [0, 0, 1],
      capStart: 'none',
    });
    paint(drop, (x, y, z, nx, ny) => mix('#141418', '#2d2d34', smooth(0, 1, ny) * 0.5));
    add(parts.tail, drop, mats.matte, { name: 'tuft' });
  }

  // ---------------------------------------------------------------- motion
  {
    // the brows only furrow a little when he strains (never upright), and a kick folds the lower hind legs up and back at the
    // hock on top of the shared leg swing (hoof up, sole to the camera, always away from the tube)
    const kickState = { age: 99, power: 0 };
    const baseKick = rig.kick;
    const baseUpdate = rig.update;
    rig.kick = function kick(power) {
      baseKick.call(this, power);
      kickState.age = 0;
      kickState.power = power;
    };
    rig.update = function update(dt, state) {
      baseUpdate.call(this, dt, state);
      this.parts.browL.rotation.z *= 0.5;
      this.parts.browR.rotation.z *= 0.5;
      this.parts.tail.rotation.x *= 0.45; // the flick stays below the top of the head
      kickState.age += dt;
      const T = 0.9;
      const env = kickState.age < T ? Math.sin(Math.PI * (kickState.age / T) ** 0.8) : 0;
      const amp = env * (0.72 + 0.28 * Math.min(1, kickState.power));
      hocks[0].rotation.x = -0.45 * amp;
      hocks[1].rotation.x = -0.4 * amp;
    };
  }
}
