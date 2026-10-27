import * as THREE from '../../vendor/three.min.js';
import * as kit from './kit.js';

const { clamp, smooth } = kit;

/**
 * The rig frame. Origin = the top of the boat's inflatable tube, directly over its centre line.
 *   +Z = outward (away from the boat centre, over the water)
 *   -Z = inward (toward the deck and the middle of the boat)
 *   +Y = up, X = sideways.
 * The character lies on its belly across the tube: chest on the red pad, hips overhanging the outside,
 * hands flat on the deck, hind legs hanging down outside the tube to just above the water.
 */
export const FRAME = {
  tubeRadius: 33,
  tubeThickness: 6.4,
  tubeCenterY: -6.4,
  deckY: -5.6,
  deckRadius: 27.8,
  flangeY: -10.2,
  flangeRadius: 33.4,
  flangeThickness: 3.4,
  waterY: -9.9,
  padHalfWidth: 4.6,
  pawX: 5.4,
  pawY: -3.4,
  pawZ: -15,
  footX: 4.4,
  footY: -9.0,
  footZ: 11,
};

export const PIVOTS = {
  head: [0, 1.2, -12.5],
  armL: [-5.4, 4.6, -6.5],
  armR: [5.4, 4.6, -6.5],
  legL: [-4.4, 3.4, 10],
  legR: [4.4, 3.4, 10],
  tail: [0, 5.8, 14],
  rumpL: [-3.3, 4.2, 12],
  rumpR: [3.3, 4.2, 12],
  anus: [0, 4.4, 15.6],
  eyeL: [-2.7, 1.3, -4.4],
  eyeR: [2.7, 1.3, -4.4],
  browL: [-2.7, 3.3, -4.2],
  browR: [2.7, 3.3, -4.2],
  earL: [-3.6, 3.6, 0.4],
  earR: [3.6, 3.6, 0.4],
};

function spring(k = 380, c = 11) {
  return { x: 0, v: 0, k, c };
}

function stepSpring(s, dt) {
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.v += (-s.k * s.x - s.c * s.v) * h;
    s.x += s.v * h;
  }
}

export class CharacterRig {
  constructor(spec, build) {
    this.spec = spec;
    this.id = spec.id;
    this.group = new THREE.Group();
    this.heat = { value: 0 };
    this.glow = { value: 0 };
    this.mats = this.makeMaterials();
    this.pivotPos = { ...PIVOTS, ...(spec.pivots ?? {}) };
    this.limb = this.computeLimbs();
    this.parts = {};
    this.buildSkeleton();
    build(this, kit);
    this.finalize();
    this.puffL = spring(380, 10);
    this.puffR = spring(330, 9);
    this.recoil = spring(260, 9);
    this.headKick = spring(300, 10);
    this.legKick = spring(150, 6.5);
    this.t = Math.random() * 10;
    this.gait = 0;
    this.look = 0;
    this.flick = 0;
    this.bulge = 0;
    this.blinkAt = 1 + Math.random() * 3;
    this.blink = 0;
    this.heatLevel = 0;
    this.chargeLevel = 0;
  }

  skinMaterial(options = {}) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0, ...options });
    const heat = this.heat;
    const glow = this.glow;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uHeat = heat;
      shader.uniforms.uGlow = glow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float rump;\nvarying float vRump;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRump = rump;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uHeat;\nuniform float uGlow;\nvarying float vRump;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.2, 0.18), clamp(uHeat * vRump * 1.15, 0.0, 0.9));')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.5, 0.03, 0.03) * uGlow * vRump;');
    };
    m.customProgramCacheKey = () => 'bum-skin-heat-v1';
    m.userData.skin = true;
    return m;
  }

  plain(color, options = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...options });
  }

  makeMaterials() {
    return {
      skin: this.skinMaterial(),
      matte: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 }),
      shiny: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.35, metalness: 0.05 }),
      eyeWhite: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2 }),
      pupil: new THREE.MeshStandardMaterial({ color: '#15151c', roughness: 0.15 }),
      glint: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      nose: new THREE.MeshStandardMaterial({ color: '#1b1315', roughness: 0.3 }),
      pad: new THREE.MeshStandardMaterial({ color: this.spec.padColor ?? '#d83b3b', roughness: 0.5 }),
    };
  }

  computeLimbs() {
    const p = { ...PIVOTS, ...(this.spec.pivots ?? {}) };
    const paw = this.spec.pawTarget ?? [FRAME.pawX, FRAME.pawY, FRAME.pawZ];
    const foot = this.spec.footTarget ?? [FRAME.footX, FRAME.footY, FRAME.footZ];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const arm = { L: sub([-paw[0], paw[1], paw[2]], p.armL), R: sub([paw[0], paw[1], paw[2]], p.armR) };
    const leg = { L: sub([-foot[0], foot[1], foot[2]], p.legL), R: sub([foot[0], foot[1], foot[2]], p.legR) };
    const len = (v) => Math.hypot(v[0], v[1], v[2]);
    return { arm, leg, armLength: len(arm.L), legLength: len(leg.L) };
  }

  buildSkeleton() {
    const { group, parts, pivotPos: p } = this;
    parts.pad = kit.add(group, this.padGeometry(), this.mats.pad, { name: 'pad' });
    parts.bodyRoot = kit.pivot(group, [0, 0, 0], 'bodyRoot');
    parts.body = kit.pivot(parts.bodyRoot, [0, 0, 0], 'body');
    parts.head = kit.pivot(parts.bodyRoot, p.head, 'head');
    for (const key of ['eyeL', 'eyeR', 'browL', 'browR', 'earL', 'earR']) parts[key] = kit.pivot(parts.head, p[key], key);
    parts.armL = kit.pivot(parts.bodyRoot, p.armL, 'armL');
    parts.armR = kit.pivot(parts.bodyRoot, p.armR, 'armR');
    parts.rumpL = kit.pivot(parts.bodyRoot, p.rumpL, 'rumpL');
    parts.rumpR = kit.pivot(parts.bodyRoot, p.rumpR, 'rumpR');
    parts.tail = kit.pivot(parts.bodyRoot, p.tail, 'tail');
    parts.legL = kit.pivot(group, p.legL, 'legL');
    parts.legR = kit.pivot(group, p.legR, 'legR');
    this.anus = kit.pivot(parts.bodyRoot, p.anus, 'anus');
  }

  padGeometry() {
    const inner = FRAME.tubeThickness + 0.05;
    const outer = inner + 1.0;
    const half = 1.25;
    const pts = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI / 2 - half + (2 * half * i) / steps;
      pts.push([Math.cos(a) * outer, Math.sin(a) * outer]);
    }
    for (let i = steps; i >= 0; i--) {
      const a = Math.PI / 2 - half + (2 * half * i) / steps;
      pts.push([Math.cos(a) * inner, Math.sin(a) * inner]);
    }
    const g = kit.extrude(pts, FRAME.padHalfWidth * 2, { bevel: 0.35 });
    g.rotateY(Math.PI / 2);
    g.translate(0, FRAME.tubeCenterY, 0);
    g.computeVertexNormals();
    return g;
  }

  finalize() {
    const center = new THREE.Vector3(...(this.spec.rump?.center ?? [0, 6, 12.6]));
    const radius = this.spec.rump?.radius ?? 8.5;
    this.group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (!o.material.userData?.skin) return;
      o.geometry = o.geometry.clone();
      const pos = o.geometry.attributes.position;
      const mask = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const d = Math.hypot((v.x - center.x) * 0.8, v.y - center.y, v.z - center.z);
        mask[i] = 1 - smooth(radius * 0.4, radius, d);
      }
      o.geometry.setAttribute('rump', new THREE.BufferAttribute(mask, 1));
    });
  }

  kick(power) {
    this.puffL.v += 16 + 20 * power;
    this.puffR.v += 12 + 22 * power;
    this.recoil.v += 8 + 10 * power;
    this.headKick.v += 5 + 9 * power;
    this.legKick.v += 6 + 10 * power;
    this.look = (Math.random() < 0.5 ? -1 : 1) * (0.5 + 0.5 * Math.random());
    this.flick = 1;
    this.bulge = 0.35 + 0.4 * power;
  }

  update(dt, { walk = 0, charge = 0, heat = 0 }) {
    this.t += dt;
    const { parts } = this;
    this.chargeLevel = charge;
    this.heatLevel = heat;
    const walkAmt = clamp(Math.abs(walk) / 3.6, 0, 1);
    this.gait += dt * (6 + 5 * walkAmt) * walkAmt;
    for (const s of [this.puffL, this.puffR, this.recoil, this.headKick, this.legKick]) stepSpring(s, dt);
    this.flick = Math.max(0, this.flick - dt * 2.4);
    this.bulge = Math.max(0, this.bulge - dt * 2.2);
    this.look *= Math.exp(-dt * 1.8);

    const sore = smooth(0.55, 1, heat);
    this.heat.value = smooth(0.08, 1, heat) * 0.95;
    this.glow.value = sore * (0.35 + 0.25 * Math.sin(this.t * 8));
    const shiver = sore * Math.sin(this.t * 40) * 0.05;
    const breathe = Math.sin(this.t * 2.3) * 0.25;

    parts.bodyRoot.position.set(shiver * 3, breathe * 0.35 + sore * Math.abs(Math.sin(this.t * 9)) * 0.2, -this.recoil.x * 0.34 - charge * 0.4);
    parts.bodyRoot.rotation.x = -0.07 * charge - this.recoil.x * 0.01;
    parts.bodyRoot.rotation.z = Math.sin(this.gait) * 0.03 * walkAmt;

    const tremble = Math.sin(this.t * 85) * 0.05 * charge;
    [this.puffL, this.puffR].forEach((puff, i) => {
      const cheek = i === 0 ? parts.rumpL : parts.rumpR;
      const k = 1 + 0.26 * charge + puff.x * 0.12 + tremble;
      cheek.scale.set(k, k * (1 + puff.x * 0.05), k);
      cheek.position.z = this.pivotPos.rumpL[2] + puff.x * 0.6 + charge * 0.4;
      cheek.position.y = this.pivotPos.rumpL[1] + puff.x * 0.2;
    });

    this.blinkAt -= dt;
    if (this.blinkAt <= 0) {
      this.blink = 0.13;
      this.blinkAt = 2 + Math.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt);
    const squint = Math.min(1 - 0.6 * charge, 1 - 0.3 * sore);
    const lid = this.blink > 0 ? 0.12 : 1;
    const eyeOpen = this.spec.eyeOpen ?? 1;
    for (const eye of [parts.eyeL, parts.eyeR]) {
      eye.scale.set(1 + this.bulge * 0.35, Math.max(0.08, squint * lid * eyeOpen) * (1 + this.bulge * 0.3), 1 + this.bulge * 0.3);
    }
    const strain = Math.min(1, charge + sore * 0.6);
    const brow = (this.spec.browRest ?? 0.18) + strain * 0.55;
    parts.browL.rotation.z = -brow;
    parts.browR.rotation.z = brow;
    parts.browL.position.y = this.pivotPos.browL[1] - strain * 0.5 + this.bulge * 0.6;
    parts.browR.position.y = this.pivotPos.browR[1] - strain * 0.5 + this.bulge * 0.6;

    parts.head.rotation.x = -0.08 * charge + this.headKick.x * 0.03;
    parts.head.rotation.y = this.look * 0.7 + Math.sin(this.t * 1.7) * 0.05;
    parts.head.rotation.z = shiver;
    const twitch = Math.max(0, Math.sin(this.t * 1.3)) ** 8;
    parts.earL.rotation.z = -this.flick * 0.5 - twitch * 0.25;
    parts.earR.rotation.z = this.flick * 0.5 + twitch * 0.25;

    const lift = (phase) => Math.max(0, Math.sin(this.gait + phase)) * 0.45 * walkAmt;
    const plant = -parts.bodyRoot.rotation.x;
    parts.armL.rotation.x = lift(0) + plant;
    parts.armR.rotation.x = lift(Math.PI) + plant;

    const outward = this.legKick.x * 0.6 + charge * 0.2;
    const sway = Math.sin(this.gait + 1) * 0.05 * walkAmt;
    parts.legL.rotation.x = Math.min(-0.04, -0.12 - outward + sway + Math.sin(this.t * 1.9) * 0.02);
    parts.legR.rotation.x = Math.min(-0.04, -0.12 - outward - sway + Math.sin(this.t * 1.9 + 1) * 0.02);
    parts.legL.rotation.z = -0.02 - charge * 0.1 - sore * shiver;
    parts.legR.rotation.z = 0.02 + charge * 0.1 + sore * shiver;

    parts.tail.rotation.z = Math.sin(this.t * 4.6) * 0.3 * (0.4 + walkAmt);
    parts.tail.rotation.x = -this.flick * 0.8 - charge * 0.3;
  }
}
