import * as THREE from '../vendor/three.min.js';
import { wrapAngle } from '../shared/config.js';
import { mulberry32 } from '../shared/course.js';
import { clamp, lerp, disposeTree, softDiscTexture } from './gfx.js';
import { Terrain } from './terrain.js';
import { buildWater, createShared, createSheetMaterial, RippleRings, sunShadowFrame } from './water.js';
import { Hazards } from './hazards.js';
import { Boat } from './boat.js';
import { Particles } from './fx.js';

const INTERP_MS = 110;
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 2, 5200);
    this.envMap = null;
    this.buildEnv();
    this.scene.environmentIntensity = 0.45;
    // a restored context comes back with an empty render target, so the environment has to be drawn again
    // (three registered its own restore handler first, so the renderer is ready by the time this runs)
    canvas.addEventListener('webglcontextrestored', () => this.buildEnv());
    this.hemi = new THREE.HemisphereLight('#ffffff', '#c9a37a', 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.camera.near = 50;
    this.sun.shadow.camera.far = 1200;
    this.scene.add(this.sun, this.sun.target);
    this.particles = new Particles(this.scene);
    this.course = null;
    this.courseGroup = null;
    this.boat = null;
    this.halo = null;
    this.rigs = [];
    this.snaps = [];
    this.layout = [];
    this.seatInfo = [];
    this.mySeat = -1;
    this.localCharge = 0;
    this.yaw = Math.PI / 2;
    this.snapCamera = true;
    this.shake = 0;
    this.hint = -1;
    this.lastRender = 0;
    this.progressNow = 0;
    this.sinkNow = 0;
    this.camPos = null;
    this.fallSpots = [];
    this.stats = { x: 0, y: 0, a: 0 };
    this.aspect = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  buildEnv() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new THREE.RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    // after a context restore the old map's GPU data is already gone, so it is only dropped, not disposed
    const old = this.envMap;
    this.envMap = texture;
    this.scene.environment = this.envMap;
    // the boat materials hold their own reference to the map
    this.boat?.group.traverse((o) => {
      if (o.material?.envMap === old) o.material.envMap = this.envMap;
    });
  }

  resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.camera.fov = this.aspect < 0.9 ? 60 : 50;
    this.camera.updateProjectionMatrix();
    this.particles.setScale(h, this.camera.fov, this.renderer.getPixelRatio());
  }

  buildPath(course) {
    const pts = course.points;
    const step = course.stepLength;
    const first = course.pointAtS(0);
    const last = course.pointAtS(course.length - 1);
    const before = [];
    for (let k = 12; k >= 1; k--) {
      before.push({ x: first.x - first.tx * k * step, y: first.y - first.ty * k * step, w: pts[0].w, s: -k * step });
    }
    const after = [];
    for (let k = 1; k <= 12; k++) {
      after.push({ x: last.x + last.tx * k * step, y: last.y + last.ty * k * step, w: pts[pts.length - 1].w, s: course.length - 1 + k * step });
    }
    return [...before, ...pts.map((p, i) => ({ x: p.x, y: p.y, w: p.w, s: i * step })), ...after];
  }

  setCourse(course) {
    if (this.courseGroup) {
      this.scene.remove(this.courseGroup);
      disposeTree(this.courseGroup);
    }
    this.course = course;
    const theme = course.theme;
    this.path = this.buildPath(course);
    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.Fog(theme.fog, 420, 1900);
    this.hemi.color.set(new THREE.Color(theme.sky).lerp(new THREE.Color('#ffffff'), 0.5));
    this.shared = createShared(theme);
    const group = new THREE.Group();
    this.courseGroup = group;
    this.scene.add(group);
    this.terrain = new Terrain(course, this.path);
    group.add(this.terrain.build(theme));
    this.terrain.scenery(group, theme, mulberry32(course.def.seed + 999));
    group.add(buildWater(course, this.path, theme, this.shared));
    this.hazards = new Hazards(group, course, this.terrain, this.shared, theme);
    this.buildCanyonFalls(group, course);
    this.buildClouds(group, course);
    this.ripples = new RippleRings(group);
    this.particles.clear();
    this.snaps = [];
    this.hint = -1;
    this.snapCamera = true;
  }

  buildCanyonFalls(group, course) {
    const material = createSheetMaterial(this.shared);
    const rand = mulberry32(course.def.seed + 515);
    this.fallSpots = [];
    for (let k = 0; k < 4; k++) {
      const s = course.length * (0.14 + k * 0.22) + rand() * 200;
      const side = rand() < 0.5 ? -1 : 1;
      const p = course.pointAtS(clamp(s, 10, course.length - 10));
      const dist = p.w + 190 + rand() * 60;
      const x = p.x + p.nx * side * dist;
      const z = p.y + p.ny * side * dist;
      const prof = this.terrain.profile(x, z);
      if (!prof || prof.t < 0.1) continue;
      const flatY = prof.base + 5.5;
      const height = prof.y - flatY + 6;
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(44, height, 1, 1), material);
      sheet.position.set(x, flatY + height / 2 - 2, z);
      sheet.rotation.y = Math.atan2(-side * p.nx, -side * p.ny);
      sheet.renderOrder = 4;
      group.add(sheet);
      this.fallSpots.push({ x, y: flatY, z });
    }
  }

  buildClouds(group, course) {
    const rand = mulberry32(course.def.seed + 4242);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.88, fog: false });
    const cloud = new THREE.SphereGeometry(1, 12, 8);
    for (let i = 0; i < 18; i++) {
      const p = course.points[Math.floor(rand() * course.points.length)];
      const c = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const puff = new THREE.Mesh(cloud, mat);
        puff.position.set((k - 1.5) * 42, rand() * 14, rand() * 24);
        puff.scale.set(52 + rand() * 24, 22 + rand() * 12, 30);
        c.add(puff);
      }
      c.position.set(p.x + (rand() - 0.5) * 2200, 520 + rand() * 180, p.y + (rand() - 0.5) * 2200);
      group.add(c);
    }
  }

  setCrew(layout, seatInfo, mySeat) {
    if (this.boat) {
      this.scene.remove(this.boat.group, this.halo);
      disposeTree(this.boat.group);
      disposeTree(this.halo);
    }
    this.layout = layout;
    this.seatInfo = seatInfo;
    this.mySeat = mySeat;
    this.boat = new Boat(layout, seatInfo, mySeat, this.envMap);
    this.rigs = this.boat.rigs;
    this.scene.add(this.boat.group);
    this.halo = new THREE.Group();
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(110, 110),
      new THREE.MeshBasicMaterial({ map: softDiscTexture('rgba(0,20,40,0.45)'), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 1;
    const foam = new THREE.Mesh(
      new THREE.RingGeometry(34, 47, 72),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.renderOrder = 2;
    this.haloFoam = foam;
    this.halo.add(shadow, foam);
    this.scene.add(this.halo);
  }

  push(snap) {
    snap.recv = performance.now();
    this.snaps.push(snap);
    if (this.snaps.length > 40) this.snaps.shift();
    const prev = this.snaps[this.snaps.length - 2];
    if (prev && Math.hypot(snap.x - prev.x, snap.y - prev.y) > 220) this.snapCamera = true;
  }

  latest() {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  sample(now) {
    const snaps = this.snaps;
    if (snaps.length === 0) return null;
    const last = snaps[snaps.length - 1];
    const target = now - INTERP_MS;
    if (target >= last.recv) {
      const dt = Math.min(0.12, (target - last.recv) / 1000);
      const moving = last.st === 'running';
      return {
        ...last,
        x: last.x + (moving ? last.vx * dt : 0),
        y: last.y + (moving ? last.vy * dt : 0),
        a: last.a + (moving ? last.w * dt : 0),
      };
    }
    if (target <= snaps[0].recv) return snaps[0];
    for (let i = snaps.length - 2; i >= 0; i--) {
      const a = snaps[i];
      if (a.recv > target) continue;
      const b = snaps[i + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) > 220) return b;
      const t = (target - a.recv) / Math.max(1, b.recv - a.recv);
      return {
        ...b,
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        a: lerpAngle(a.a, b.a, t),
        T: lerp(a.T, b.T, t),
        pos: b.pos.map((p, k) => lerpAngle(a.pos[k] ?? p, p, t)),
      };
    }
    return last;
  }

  setLocalCharge(level) {
    this.localCharge = level;
  }

  waterY() {
    return this.course ? this.course.heightAt(this.progressNow) - 0.35 : 0;
  }

  event(ev) {
    if (!this.course || !this.boat) return;
    const wy = this.waterY();
    const st = this.stats;
    if (ev.k === 'burst') {
      const rig = this.rigs[ev.seat];
      if (!rig) return;
      rig.kick(ev.p);
      this.boat.group.updateMatrixWorld(true);
      const at = new THREE.Vector3();
      rig.anus.getWorldPosition(at);
      const snap = this.latest();
      const dx = Math.cos(ev.ang);
      const dz = Math.sin(ev.ang);
      this.particles.fart(at.x, at.y, at.z, dx, dz, ev.p, snap ? snap.vx : 0, snap ? snap.vy : 0);
      this.ripples.burst(at.x + dx * 26, wy + 0.4, at.z + dz * 26, ev.p);
      if (ev.seat === this.mySeat) this.shake = Math.max(this.shake, 1.2 + ev.p * 2.5);
    } else if (ev.k === 'fizzle') {
      const rig = this.rigs[ev.seat];
      if (rig) {
        this.boat.group.updateMatrixWorld(true);
        const at = new THREE.Vector3();
        rig.anus.getWorldPosition(at);
        this.particles.steam(at.x, at.y, at.z);
      }
    } else if (ev.k === 'bump' || ev.k === 'ouch' || ev.k === 'spiked') {
      this.particles.splash(ev.x, wy + 6, ev.y, 14 + Math.round(ev.sev * 14), 0.9 + ev.sev * 0.5);
      this.ripples.spawn(ev.x, wy + 0.4, ev.y, 38 + ev.sev * 20, 1.2, 0);
      this.shake = Math.max(this.shake, 6 + ev.sev * 9);
    } else if (ev.k === 'thud') {
      this.particles.splash(ev.x, wy + 4, ev.y, 5);
      this.ripples.spawn(ev.x, wy + 0.4, ev.y, 24, 1, 0);
    } else if (ev.k === 'sunk') {
      this.particles.splash(ev.x, wy + 4, ev.y, 46, 1.3);
      this.ripples.burst(ev.x, wy + 0.4, ev.y, 1.4);
      this.shake = 14;
    } else if (ev.k === 'respawn') {
      this.snapCamera = true;
    } else if (ev.k === 'flush') {
      this.particles.splash(ev.x, wy + 4, ev.y, 40, 1.4);
      this.ripples.burst(ev.x, wy + 0.4, ev.y, 1.6);
      this.shake = 12;
    } else if (ev.k === 'plunge') {
      this.particles.splash(ev.x, wy + 6, ev.y, 60, 1.6);
      this.ripples.burst(ev.x, wy + 0.4, ev.y, 1.8);
      this.shake = 16;
    } else if (ev.k === 'dropin') {
      this.shake = Math.max(this.shake, 5);
    } else if (ev.k === 'nudge') {
      this.particles.splash(ev.x, wy + 4, ev.y, 10);
    } else if (ev.k === 'finish') {
      this.particles.confetti(st.x, wy + 30, st.y, 90);
    }
  }

  render(now) {
    const dt = Math.min(0.05, this.lastRender ? (now - this.lastRender) / 1000 : 0.016);
    this.lastRender = now;
    const course = this.course;
    const st = this.sample(now);
    const t = now / 1000;
    if (course && this.shared) this.shared.uTime.value = t;
    if (course && st && this.boat) {
      this.stats = { x: st.x, y: st.y, a: st.a };
      const loc = course.locate(st.x, st.y, this.hint);
      this.hint = loc.index;
      this.progressNow = loc.s;
      this.updateBoat(st, loc, t, dt);
      this.hazards.update(st.T, t, this.camera, st.cp);
      this.ripples.update(dt);
      this.updateCamera(st, loc, dt);
      this.updateFx(st, dt);
      sunShadowFrame(this.sun, this.boat.group.position, 250);
    }
    this.particles.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateBoat(st, loc, t, dt) {
    const wy = this.course.heightAt(loc.s) - 0.35;
    const sunk = st.st === 'sunk';
    const bob = Math.sin(t * 2.1) * 0.7 + Math.sin(t * 3.3 + 1) * 0.3;
    this.sinkNow = lerp(this.sinkNow, sunk ? -26 : 0, 1 - Math.exp(-dt * 3));
    const boat = this.boat.group;
    boat.position.set(st.x, wy + 1.3 + bob + this.sinkNow, st.y);
    boat.rotation.y = -st.a;
    const lean = Math.hypot(st.vx, st.vy) * 0.0016;
    const dir = Math.atan2(st.vy, st.vx);
    boat.rotation.x = Math.sin(t * 1.7) * 0.02 + Math.sin(dir - st.a) * lean;
    boat.rotation.z = Math.sin(t * 1.3) * 0.02 - Math.cos(dir - st.a) * lean;
    this.boat.flash(st.inv && !sunk && Math.floor(performance.now() / 110) % 2 === 0);
    this.boat.update(st, dt, this.localCharge);
    this.halo.position.set(st.x, wy + 0.3, st.y);
    this.haloFoam.material.opacity = 0.3 + 0.12 * Math.sin(t * 2.6);
  }

  updateCamera(st, loc, dt) {
    const course = this.course;
    const ahead = course.pointAtS(Math.min(course.length - 2, loc.s + 120));
    const target = Math.atan2(ahead.ty, ahead.tx);
    if (this.snapCamera) {
      this.yaw = target;
      this.camPos = null;
    } else {
      this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-dt * 2.6));
    }
    const portrait = clamp((1.1 - this.aspect) / 0.7, 0, 1);
    const scale = 1 + portrait * 0.95;
    const dist = 88 * scale;
    const height = 112 * scale;
    const fx = Math.cos(this.yaw);
    const fz = Math.sin(this.yaw);
    const h = course.heightAt(loc.s);
    const wanted = new THREE.Vector3(st.x - fx * dist, h + height, st.y - fz * dist);
    if (!this.camPos || this.snapCamera) this.camPos = wanted.clone();
    else this.camPos.lerp(wanted, 1 - Math.exp(-dt * 6));
    this.snapCamera = false;
    this.shake *= Math.exp(-dt * 7);
    this.camera.position.copy(this.camPos);
    this.camera.position.x += (Math.random() - 0.5) * this.shake;
    this.camera.position.y += (Math.random() - 0.5) * this.shake;
    this.camera.lookAt(st.x + fx * 38, h + 6, st.y + fz * 38);
  }

  updateFx(st, dt) {
    const course = this.course;
    const wy = this.waterY();
    const speed = Math.hypot(st.vx, st.vy);
    if (speed > 28 && st.st === 'running' && Math.random() < Math.min(1, dt * speed * 0.12)) {
      const back = Math.atan2(st.vy, st.vx) + Math.PI + (Math.random() - 0.5) * 0.8;
      this.particles.spawn({
        x: st.x + Math.cos(back) * 34,
        y: wy + 1.5,
        z: st.y + Math.sin(back) * 34,
        vx: Math.cos(back) * 14,
        vy: 4,
        vz: Math.sin(back) * 14,
        life: 0.9,
        s0: 5,
        s1: 11,
        color: '#ffffff',
        alpha: 0.45,
        drag: 1.4,
      });
    }
    for (let i = 0; i < this.rigs.length; i++) {
      const heat = this.boat.heatSmooth[i] ?? 0;
      if (heat > 0.6 && Math.random() < dt * (heat - 0.5) * 14) {
        this.boat.group.updateMatrixWorld(true);
        const at = new THREE.Vector3();
        this.rigs[i].anus.getWorldPosition(at);
        this.particles.steam(at.x, at.y + 3, at.z);
      }
    }
    for (const f of course.falls) {
      if (Math.abs(f.s0 + f.len - this.progressNow) < 520 && Math.random() < dt * 20) {
        const p = course.pointAtS(f.s0 + f.len);
        this.particles.mist(p.x, course.heightAt(f.s0 + f.len) + 4, p.y);
      }
    }
    for (const spot of this.fallSpots) {
      if (Math.hypot(spot.x - st.x, spot.z - st.y) < 700 && Math.random() < dt * 8) this.particles.mist(spot.x, spot.y + 2, spot.z);
    }
  }
}
