import * as THREE from '../vendor/three.min.js';
import { mulberry32 } from '../shared/course.js';
import { TAU, clamp, paint, canvasTexture, hash2 } from './gfx.js';
import { createWhirlMaterial } from './water.js';

const UP = new THREE.Vector3(0, 1, 0);

function extPoint(course, s) {
  const last = course.length - 1;
  if (s >= 0 && s <= last) return course.pointAtS(s);
  const p = course.pointAtS(s < 0 ? 0 : last);
  const dist = s < 0 ? s : s - last;
  return { ...p, x: p.x + p.tx * dist, y: p.y + p.ty * dist };
}

function makeUrchinGeometry() {
  const parts = [];
  const sphere = new THREE.SphereGeometry(6, 14, 10);
  paint(sphere, '#5a2a78');
  parts.push(sphere);
  for (let i = 0; i < 20; i++) {
    const y = 1 - (i / 19) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    const d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const cone = new THREE.ConeGeometry(1.6, 8.5, 6);
    cone.translate(0, 4.25, 0);
    cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d));
    cone.translate(d.x * 5, d.y * 5, d.z * 5);
    paint(cone, '#ff4d8d');
    parts.push(cone);
  }
  return THREE.mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

function makeRollerGeometry(hl, radius) {
  const parts = [];
  const body = new THREE.CylinderGeometry(radius * 0.8, radius * 0.8, hl * 2, 24);
  paint(body, '#8e3fb8');
  parts.push(body);
  for (const sign of [-1, 1]) {
    const cap = new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, 4, 24);
    cap.translate(0, sign * (hl - 2), 0);
    paint(cap, '#5d2a7a');
    parts.push(cap);
  }
  const rows = Math.max(3, Math.round(hl / 13));
  for (let r = 0; r < rows; r++) {
    const y = -hl + 11 + (r * (hl * 2 - 22)) / Math.max(1, rows - 1);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU + (r % 2) * 0.31;
      const cone = new THREE.ConeGeometry(2.8, 9, 7);
      cone.translate(0, 4.5, 0);
      cone.rotateZ(-Math.PI / 2);
      cone.rotateY(-a);
      cone.translate(Math.cos(a) * radius * 0.72, y, Math.sin(a) * radius * 0.72);
      paint(cone, '#fff4de');
      parts.push(cone);
    }
  }
  return THREE.mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

function barkTexture() {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#8a5a2b';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(${40 + Math.random() * 50},${20 + Math.random() * 30},10,${0.15 + Math.random() * 0.3})`;
      g.fillRect(Math.random() * w, 0, 1 + Math.random() * 3, h);
    }
  });
}

export class Hazards {
  constructor(group, course, terrain, shared, theme) {
    this.group = group;
    this.course = course;
    this.terrain = terrain;
    this.shared = shared;
    this.theme = theme;
    this.logs = [];
    this.rollers = [];
    this.whirls = [];
    this.gates = [];
    this.foam = [];
    this.foamMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.build();
  }

  water(s) {
    return this.course.heightAt(s) - 0.35;
  }

  foamRing(x, s, z, inner, outer) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 36), this.foamMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, this.water(s) + 0.25, z);
    ring.renderOrder = 2;
    this.group.add(ring);
    this.foam.push(ring);
  }

  build() {
    this.buildRails();
    this.buildRocks();
    this.buildUrchins();
    this.buildLogs();
    this.buildRollers();
    this.buildWhirlpools();
    this.buildCurrents();
    this.buildGates();
  }

  buildRails() {
    const course = this.course;
    const green = new THREE.MeshStandardMaterial({ color: this.theme.rail, roughness: 0.32, metalness: 0.02 });
    const purple = new THREE.MeshStandardMaterial({ color: '#8e3fb8', roughness: 0.3, metalness: 0.05 });
    const spikeMat = new THREE.MeshStandardMaterial({ color: '#fff4de', roughness: 0.35 });
    const spikeGeo = new THREE.ConeGeometry(2.6, 10, 8);
    spikeGeo.translate(0, 5, 0);
    const s0 = -520;
    const s1 = course.length + 520;
    const spikeBatches = [];
    const run = (side, a, b, spiked) => {
      const pts = [];
      for (let s = a; s < b + 10; s += 20) {
        const ss = Math.min(s, b);
        const p = extPoint(course, ss);
        const lateral = p.w + 5.4;
        pts.push(new THREE.Vector3(p.x + p.nx * side * lateral, course.heightAt(ss) + 5.9, p.y + p.ny * side * lateral));
      }
      if (pts.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(6, pts.length * 2), spiked ? 5.8 : 5, 12, false), spiked ? purple : green);
      tube.castShadow = true;
      tube.receiveShadow = true;
      this.group.add(tube);
      if (spiked) spikeBatches.push({ curve, side, a, b });
    };
    for (const side of [-1, 1]) {
      const cuts = course.walls.filter((w) => w.side === side).sort((x, y) => x.s0 - y.s0);
      let cursor = s0;
      for (const w of cuts) {
        if (w.s0 > cursor) run(side, cursor, w.s0, false);
        run(side, w.s0, w.s1, true);
        cursor = w.s1;
      }
      if (cursor < s1) run(side, cursor, s1, false);
    }
    const total = spikeBatches.reduce((sum, b) => sum + Math.ceil((b.b - b.a) / 13) * 2, 0);
    if (total > 0) {
      const spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, total);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      let i = 0;
      for (const batch of spikeBatches) {
        const n = Math.ceil((batch.b - batch.a) / 13);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const point = batch.curve.getPointAt(t);
          const s = batch.a + (batch.b - batch.a) * t;
          const p = extPoint(course, s);
          const inward = new THREE.Vector3(-batch.side * p.nx, 0, -batch.side * p.ny);
          for (let kind = 0; kind < 2; kind++) {
            const dir = kind === 0 ? inward.clone().add(new THREE.Vector3(0, 0.35, 0)).normalize() : new THREE.Vector3(0, 1, 0).addScaledVector(inward, 0.25).normalize();
            const pos = point.clone().addScaledVector(dir, 5.2);
            q.setFromUnitVectors(UP, dir);
            const phase = (k % 2) * 0.5 + kind * 0.25;
            pos.addScaledVector(batch.curve.getTangentAt(t), phase * 6);
            m.compose(pos, q, new THREE.Vector3(1, 1, 1));
            if (i < total) spikes.setMatrixAt(i++, m);
          }
        }
      }
      spikes.count = i;
      spikes.castShadow = true;
      spikes.frustumCulled = false;
      this.group.add(spikes);
    }
  }

  buildRocks() {
    const rand = mulberry32(this.course.def.seed + 17);
    const lo = new THREE.Color('#5f5a58');
    const hi = new THREE.Color('#aa9e93');
    const c = new THREE.Color();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, flatShading: true });
    for (const r of this.course.rocks) {
      const geo = new THREE.IcosahedronGeometry(r.r, 2);
      const pos = geo.attributes.position;
      const colors = [];
      for (let i = 0; i < pos.count; i++) {
        const k = 0.86 + hash2(pos.getX(i) * 3.1 + pos.getZ(i) * 7.7 + r.s, pos.getY(i) * 5.3 + r.x) * 0.26;
        const y = pos.getY(i) * k * 0.9;
        pos.setXYZ(i, pos.getX(i) * k, y, pos.getZ(i) * k);
        c.copy(lo).lerp(hi, clamp((y / r.r + 0.6) / 1.5, 0, 1));
        colors.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(r.x, this.water(r.s) + r.r * 0.2, r.y);
      mesh.rotation.y = rand() * TAU;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.foamRing(r.x, r.s, r.y, r.r * 0.9, r.r * 1.55);
    }
  }

  buildUrchins() {
    const rand = mulberry32(this.course.def.seed + 29);
    const urchin = makeUrchinGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.1, flatShading: true });
    for (const field of this.course.spikeFields) {
      for (const spike of field.spikes) {
        const mesh = new THREE.Mesh(urchin, mat);
        mesh.scale.setScalar(0.93);
        mesh.position.set(spike.x, this.water(field.s) + 4, spike.y);
        mesh.rotation.set(rand() * TAU, rand() * TAU, 0);
        mesh.castShadow = true;
        this.group.add(mesh);
      }
      this.foamRing(field.x, field.s, field.y, field.r * 0.6, field.r * 1.2);
    }
  }

  buildLogs() {
    const bark = barkTexture();
    const mat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.9 });
    const capMat = new THREE.MeshStandardMaterial({ color: '#c99a62', roughness: 0.8 });
    this.logs = this.course.logs.map((log) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 62, 20), mat);
      body.rotation.z = Math.PI / 2;
      body.castShadow = true;
      g.add(body);
      for (const x of [-31.2, 31.2]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(15.5, 15.5, 0.8, 20), capMat);
        cap.rotation.z = Math.PI / 2;
        cap.position.x = x;
        g.add(cap);
      }
      this.group.add(g);
      return { log, group: g };
    });
  }

  buildRollers() {
    const geos = new Map();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.08, flatShading: true });
    this.rollers = this.course.rollers.map((roller) => {
      const key = `${roller.hl}`;
      if (!geos.has(key)) geos.set(key, makeRollerGeometry(roller.hl, roller.r));
      const outer = new THREE.Group();
      const inner = new THREE.Mesh(geos.get(key), mat);
      inner.castShadow = true;
      outer.add(inner);
      this.group.add(outer);
      return { roller, outer, inner };
    });
  }

  buildWhirlpools() {
    this.whirls = this.course.whirlpools.map((whirl) => {
      const material = createWhirlMaterial(this.shared, whirl.dir);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(whirl.r, 72), material);
      disc.rotation.x = -Math.PI / 2;
      disc.renderOrder = 2;
      const group = new THREE.Group();
      group.add(disc);
      this.group.add(group);
      return { whirl, group };
    });
  }

  buildCurrents() {
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false });
    const arrowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false });
    for (const c of this.course.currents) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(c.r - 3, c.r, 48), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(c.x, this.water(c.s) + 0.3, c.y);
      ring.renderOrder = 2;
      this.group.add(ring);
      const len = Math.hypot(c.ax, c.ay) || 1;
      for (let k = -1; k <= 1; k++) {
        const holder = new THREE.Group();
        holder.position.set(c.x - (c.ay / len) * k * 20, this.water(c.s) + 0.6, c.y + (c.ax / len) * k * 20);
        holder.rotation.y = Math.atan2(-c.ax, -c.ay);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(8, 20, 3), arrowMat);
        cone.rotation.x = -Math.PI / 2;
        cone.renderOrder = 2;
        holder.add(cone);
        this.group.add(holder);
      }
    }
  }

  buildGates() {
    const course = this.course;
    const make = (s, color, checkered) => {
      const p = course.pointAtS(s);
      const h = course.heightAt(s);
      const g = new THREE.Group();
      const postMat = new THREE.MeshStandardMaterial({ color: '#6b4423', roughness: 0.8 });
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, 66, 10), postMat);
        post.position.set(p.x + p.nx * (p.w + 14) * side, h + 34, p.y + p.ny * (p.w + 14) * side);
        post.castShadow = true;
        g.add(post);
      }
      const material = checkered
        ? new THREE.MeshStandardMaterial({ map: this.checkerTexture(), transparent: true, opacity: 0.85, depthWrite: false })
        : new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false });
      const banner = new THREE.Mesh(new THREE.BoxGeometry((p.w + 14) * 2, 9, 1.5), material);
      banner.position.set(p.x, h + 60, p.y);
      banner.rotation.y = -Math.atan2(p.ty, p.tx) + Math.PI / 2;
      g.add(banner);
      this.group.add(g);
      return banner;
    };
    const startLine = course.pointAtS(course.startS - 50);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry((startLine.w + 4) * 2, 10),
      new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.8 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -Math.atan2(startLine.ty, startLine.tx) - Math.PI / 2;
    line.position.set(startLine.x, this.water(course.startS - 50) + 0.3, startLine.y);
    this.group.add(line);
    make(course.finishS, '#ffffff', true);
    this.gates = course.checkpoints.map((s) => make(s, '#ffd43b', false));
  }

  checkerTexture() {
    return canvasTexture(256, 32, (g) => {
      for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 4; y++) {
          g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
          g.fillRect(x * 8, y * 8, 8, 8);
        }
      }
    });
  }

  update(T, t, camera, checkpoint) {
    const course = this.course;
    for (const item of this.logs) {
      const p = course.logState(item.log, T);
      item.group.position.set(p.x, this.water(item.log.s) + 5 + Math.sin(t * 2 + item.log.phase) * 0.8, p.y);
      item.group.rotation.y = -Math.atan2(item.log.ny, item.log.nx) + Math.PI / 2;
    }
    for (const item of this.rollers) {
      const r = course.rollerState(item.roller, T);
      item.outer.visible = r.mode === 'side' || r.active;
      item.outer.position.set(r.x, this.water(item.roller.s) + r.r * 0.78, r.y);
      item.outer.quaternion.setFromUnitVectors(UP, new THREE.Vector3(r.ux, 0, r.uy));
      item.inner.rotation.y = r.roll;
    }
    for (const item of this.whirls) {
      const s = course.whirlState(item.whirl, T);
      item.group.position.set(s.x, this.water(item.whirl.s) + 0.35, s.y);
    }
    const pulse = 0.45 + 0.15 * Math.sin(t * 2.2);
    this.foamMaterial.opacity = pulse;
    this.gates.forEach((banner, i) => {
      banner.material.color.set(checkpoint >= i ? '#69db7c' : '#ffd43b');
      banner.material.opacity = clamp((banner.position.distanceTo(camera.position) - 80) / 220, 0.1, 0.6);
    });
  }
}

