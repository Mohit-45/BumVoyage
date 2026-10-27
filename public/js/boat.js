import * as THREE from '../vendor/three.min.js';
import { wrapAngle } from '../shared/config.js';
import { TAU, canvasTexture, lerp } from './gfx.js';
import { buildAnimal } from './animals3d.js';

const TUBE_RADIUS = 33;
const TUBE_THICKNESS = 6.4;
const RIM_RADIUS = 33;
const RIG_Y = 8.6;

function deckTexture() {
  return canvasTexture(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#7bc65a';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
        g.fillRect(0, i * 32, w, 32);
        g.fillStyle = 'rgba(40,90,30,0.55)';
        g.fillRect(0, i * 32, w, 3);
      }
    },
    [1, 1],
  );
}

export class Boat {
  constructor(layout, seatInfo, mySeat, envMap, factory = buildAnimal) {
    this.factory = factory;
    this.layout = layout;
    this.seatInfo = seatInfo;
    this.mySeat = mySeat;
    this.group = new THREE.Group();
    this.rigs = [];
    this.prevPos = [];
    this.walkRates = layout.map(() => 0);
    this.heatSmooth = layout.map(() => 0);
    this.build(envMap);
  }

  build(envMap) {
    const g = this.group;
    const cream = new THREE.MeshPhysicalMaterial({
      color: '#f6e7c8',
      roughness: 0.42,
      clearcoat: 0.55,
      clearcoatRoughness: 0.32,
      envMap,
      envMapIntensity: 0.9,
    });
    this.tubeMat = cream;
    const tube = new THREE.Mesh(new THREE.TorusGeometry(TUBE_RADIUS, TUBE_THICKNESS, 28, 84), cream);
    tube.rotation.x = Math.PI / 2;
    tube.position.y = 2.2;
    tube.castShadow = true;
    tube.receiveShadow = true;
    g.add(tube);

    const seamMat = new THREE.MeshStandardMaterial({ color: '#d9c59e', roughness: 0.6 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      const seam = new THREE.Mesh(new THREE.TorusGeometry(TUBE_THICKNESS + 0.05, 0.38, 6, 28), seamMat);
      seam.position.set(Math.cos(a) * TUBE_RADIUS, 2.2, Math.sin(a) * TUBE_RADIUS);
      seam.rotation.y = -a;
      g.add(seam);
    }

    const teal = new THREE.MeshPhysicalMaterial({ color: '#46bdb2', roughness: 0.4, clearcoat: 0.4, envMap, envMapIntensity: 0.8 });
    const flange = new THREE.Mesh(new THREE.TorusGeometry(TUBE_RADIUS + 0.4, 3.4, 14, 84), teal);
    flange.rotation.x = Math.PI / 2;
    flange.position.y = -1.6;
    g.add(flange);

    const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.7 });
    const deck = new THREE.Mesh(new THREE.CircleGeometry(TUBE_RADIUS - TUBE_THICKNESS + 1.2, 64), deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = 3.0;
    deck.receiveShadow = true;
    g.add(deck);

    const loopMat = new THREE.MeshStandardMaterial({ color: '#ff8a1f', roughness: 0.5 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.26;
      const loop = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.6, 8, 16), loopMat);
      loop.position.set(Math.cos(a) * (TUBE_RADIUS + TUBE_THICKNESS - 0.4), 3.2, Math.sin(a) * (TUBE_RADIUS + TUBE_THICKNESS - 0.4));
      loop.rotation.y = Math.PI / 2 - a;
      g.add(loop);
    }

    this.layout.forEach((sector, i) => {
      const info = this.seatInfo[i];
      const color = new THREE.Color(info ? info.color : '#999999');
      const wedge = new THREE.Mesh(
        new THREE.CircleGeometry(TUBE_RADIUS - TUBE_THICKNESS + 1, 40, -(sector.center + sector.half), sector.half * 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: sector.full ? 0.2 : 0.42, depthWrite: false }),
      );
      wedge.rotation.x = -Math.PI / 2;
      wedge.position.y = 3.06;
      g.add(wedge);
      if (!sector.full) {
        for (const edge of [sector.center - sector.half, sector.center + sector.half]) {
          const line = new THREE.Mesh(new THREE.BoxGeometry(TUBE_RADIUS - TUBE_THICKNESS - 1, 0.4, 0.9), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
          const len = (TUBE_RADIUS - TUBE_THICKNESS - 1) / 2;
          line.position.set(Math.cos(edge) * len, 3.2, Math.sin(edge) * len);
          line.rotation.y = -edge;
          g.add(line);
        }
      }
      const rig = this.factory(info ? info.animal : 'leo');
      rig.group.position.set(Math.cos(sector.center) * RIM_RADIUS, RIG_Y, Math.sin(sector.center) * RIM_RADIUS);
      rig.group.rotation.y = Math.PI / 2 - sector.center;
      g.add(rig.group);
      this.rigs.push(rig);
    });

    this.arrow = new THREE.Group();
    const arrowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false });
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 4), arrowMat);
    shaft.position.x = 12;
    const head = new THREE.Mesh(new THREE.ConeGeometry(6.5, 11, 3), arrowMat);
    head.rotation.z = -Math.PI / 2;
    head.rotation.x = Math.PI / 2;
    head.position.x = 26;
    this.arrow.add(shaft, head);
    this.arrow.position.y = 3.5;
    this.arrow.visible = this.mySeat >= 0;
    this.arrowMat = arrowMat;
    if (this.mySeat >= 0 && this.seatInfo[this.mySeat]) arrowMat.color.set(this.seatInfo[this.mySeat].color);
    g.add(this.arrow);
  }

  update(st, dt, localCharge) {
    this.layout.forEach((sector, i) => {
      const rig = this.rigs[i];
      const pos = st.pos[i] ?? sector.center;
      const prev = this.prevPos[i] ?? pos;
      const rate = dt > 0 ? wrapAngle(pos - prev) / dt : 0;
      this.prevPos[i] = pos;
      this.walkRates[i] = lerp(this.walkRates[i], rate, 1 - Math.exp(-dt * 14));
      this.heatSmooth[i] = lerp(this.heatSmooth[i], st.heat[i] ?? 0, 1 - Math.exp(-dt * 6));
      rig.group.position.set(Math.cos(pos) * RIM_RADIUS, RIG_Y, Math.sin(pos) * RIM_RADIUS);
      rig.group.rotation.y = Math.PI / 2 - pos;
      const charge = i === this.mySeat ? localCharge : st.ch[i] ?? 0;
      rig.update(dt, { walk: this.walkRates[i], charge, heat: this.heatSmooth[i] });
    });
    if (this.arrow && this.mySeat >= 0) {
      const pos = st.pos[this.mySeat] ?? 0;
      this.arrow.rotation.y = -(pos + Math.PI);
      const scale = 0.8 + localCharge * 0.7;
      this.arrow.scale.set(scale, 1, 1 + localCharge * 0.4);
    }
  }

  flash(on) {
    this.tubeMat.emissive.set(on ? '#ff2d2d' : '#000000');
    this.tubeMat.emissiveIntensity = on ? 0.55 : 0;
  }
}

