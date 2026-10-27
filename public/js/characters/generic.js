import { FRAME } from './rig.js';

/**
 * A plain, correctly placed quadruped. It is the baseline every character starts from:
 * it passes the placement checks, shows how to use the kit, and gives a sane silhouette.
 * Character modules replace or extend it with their own anatomy.
 */
export function buildGeneric(rig, kit, o = {}) {
  const { parts, mats, limb } = rig;
  const fur = o.fur ?? '#c9a27a';
  const belly = o.belly ?? '#ecd9b8';
  const accent = o.accent ?? '#6b4a2e';
  const tint = (x, y, z, nx, ny) => kit.mix(fur, belly, kit.smooth(0.05, -0.75, ny));

  const torso = kit.loft({
    spine: [[0, 5.9, -9], [0, 6.4, -2], [0, 5.9, 6], [0, 5.0, 13]],
    radii: [[5.0, 4.4], [6.2, 4.9], [6.4, 5.0], [5.0, 4.4]],
    sides: 10,
    stations: 10,
  });
  kit.paint(torso, tint);
  kit.add(parts.body, torso, mats.skin, { name: 'torso' });

  const neck = kit.loft({ spine: [[0, 5.6, -8.5], [0, 3.6, -10.5], [0, 1.8, -12]], radii: [[3.8, 3.6], [3.3, 3.2], [3.5, 3.3]], sides: 9, stations: 6, capStart: 'none' });
  kit.paint(neck, tint);
  kit.add(parts.body, neck, mats.skin, { name: 'neck' });

  const lobe = kit.loft({ spine: [[0, 0.6, -3], [0, 0, 0], [0, -0.8, 2.2]], radii: [[2.6, 3.0], [3.7, 4.2], [2.9, 3.3]], sides: 9, stations: 6 });
  kit.paint(lobe, tint);
  kit.add(parts.rumpL, lobe, mats.skin, { name: 'rumpL' });
  kit.add(parts.rumpR, kit.mirrorX(lobe), mats.skin, { name: 'rumpR' });

  const skull = kit.loft({
    spine: [[0, 0.4, 2.5], [0, 0.2, -1.5], [0, -0.6, -4.5], [0, -1, -6.5]],
    radii: [[3.8, 3.6], [4.5, 4.0], [3.0, 2.6], [2.0, 1.7]],
    sides: 10,
    stations: 8,
  });
  kit.paint(skull, (x, y, z, nx, ny) => kit.mix(fur, belly, kit.smooth(-0.5, -4.5, z) * 0.7 + kit.smooth(0.1, -0.8, ny) * 0.3));
  kit.add(parts.head, skull, mats.skin, { name: 'skull' });
  kit.add(parts.head, kit.ellipsoid(0.9, 0.7, 0.7, { detail: 1 }), mats.nose, { pos: [0, -0.4, -8.2], name: 'nose' });

  for (const [eye, sign] of [[parts.eyeL, -1], [parts.eyeR, 1]]) {
    kit.add(eye, kit.ellipsoid(1.8, 1.9, 1.3, { detail: 1 }), mats.eyeWhite, { name: 'eyeWhite' });
    kit.add(eye, kit.ellipsoid(0.95, 1.0, 0.6, { detail: 1 }), mats.pupil, { pos: [sign * 0.1, 0, -1.0], name: 'pupil' });
    kit.add(eye, kit.ellipsoid(0.3, 0.3, 0.2, { detail: 0 }), mats.glint, { pos: [sign * 0.1 + 0.3, 0.4, -1.45], name: 'glint' });
  }
  for (const brow of [parts.browL, parts.browR]) {
    const slab = kit.box(3.4, 0.7, 1.1);
    kit.paint(slab, accent);
    kit.add(brow, slab, mats.matte, { name: 'brow' });
  }
  for (const [ear, sign] of [[parts.earL, -1], [parts.earR, 1]]) {
    const geo = kit.cone(1.8, 3.0, 6);
    kit.paint(geo, fur);
    kit.add(ear, geo, mats.matte, { rot: [0, 0, -sign * 0.35], name: 'ear' });
  }

  for (const [pivot, side, vec] of [[parts.armL, -1, limb.arm.L], [parts.armR, 1, limb.arm.R]]) {
    const arm = kit.limb({ from: [0, 0, 0], to: vec, bend: [side * 1.6, 0.5, 2.2], r0: 2.8, r1: 2.2, r2: 1.9, sides: 8, up: [0, 0, 1] });
    kit.paint(arm, fur);
    kit.add(pivot, arm, mats.skin, { name: 'arm' });
    const paw = kit.ellipsoid(2.4, 1.0, 3.0, { detail: 1 });
    kit.paint(paw, accent);
    kit.add(pivot, paw, mats.matte, { pos: [vec[0], vec[1] + 0.1, vec[2] - 1.0], name: 'paw' });
  }

  for (const [pivot, vec] of [[parts.legL, limb.leg.L], [parts.legR, limb.leg.R]]) {
    const leg = kit.limb({ from: [0, 0, 0], to: vec, bend: [0, 0.5, 1.2], r0: 3.2, r1: 2.4, r2: 1.8, sides: 8, up: [0, 0, 1], capEnd: 'round' });
    kit.paint(leg, fur);
    kit.add(pivot, leg, mats.skin, { name: 'leg' });
    const foot = kit.ellipsoid(2.2, 1.0, 3.0, { detail: 1 });
    kit.paint(foot, accent);
    kit.add(pivot, foot, mats.matte, { pos: [vec[0], vec[1] + 0.7, vec[2] - 0.8], name: 'foot' });
  }

  const tail = kit.loft({ spine: [[0, 0, 0], [0, 2.2, 2.4], [0, 4.4, 2.2]], radii: [[1.3, 1.3], [0.9, 0.9], [0.6, 0.6]], sides: 6, stations: 6, up: [1, 0, 0] });
  kit.paint(tail, fur);
  kit.add(parts.tail, tail, mats.matte, { name: 'tail' });

  void FRAME;
}
