import * as THREE from '../vendor/three.min.js';

const MAX = 1100;

const VERTEX = `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(1.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vColor.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, a);
    #include <colorspace_fragment>
  }
`;

const PUFF_COLORS = ['#a6e22e', '#8fd11f', '#bff04a', '#7fc414', '#c9f56b'];
const WATER_COLORS = ['#ffffff', '#e6f6ff', '#cfeeff'];
const CONFETTI = ['#ffd43b', '#ff6b6b', '#4dabf7', '#69db7c', '#ffffff', '#ff8a3d'];

export class Particles {
  constructor(scene) {
    this.count = 0;
    this.items = [];
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 4);
    this.sizes = new Float32Array(MAX);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  setScale(heightPx, fovDeg, pixelRatio) {
    this.material.uniforms.uScale.value = (heightPx * pixelRatio) / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  spawn(p) {
    if (this.items.length >= MAX) this.items.shift();
    this.items.push({
      x: p.x,
      y: p.y,
      z: p.z,
      vx: p.vx ?? 0,
      vy: p.vy ?? 0,
      vz: p.vz ?? 0,
      life: p.life,
      max: p.life,
      s0: p.s0,
      s1: p.s1,
      color: new THREE.Color(p.color),
      alpha: p.alpha ?? 0.8,
      drag: p.drag ?? 1.5,
      gravity: p.gravity ?? 0,
      lift: p.lift ?? 0,
    });
  }

  fart(x, y, z, dx, dz, power, vx = 0, vz = 0) {
    const n = 14 + Math.round(power * 26);
    for (let i = 0; i < n; i++) {
      const along = i / n;
      const spread = (Math.random() - 0.5) * (0.28 + power * 0.22);
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const speed = (110 + power * 230) * (0.55 + along * 0.75);
      this.spawn({
        x: x + (Math.random() - 0.5) * 3,
        y: y + (Math.random() - 0.5) * 2,
        z: z + (Math.random() - 0.5) * 3,
        vx: (dx * cos - dz * sin) * speed + vx * 0.3,
        vy: 4 + Math.random() * 12,
        vz: (dx * sin + dz * cos) * speed + vz * 0.3,
        life: 0.8 + along * 0.8 + Math.random() * 0.4 + power * 0.4,
        s0: 9 + power * 5,
        s1: 24 + power * 26 + Math.random() * 8,
        color: PUFF_COLORS[i % PUFF_COLORS.length],
        alpha: 0.9,
        drag: 1.9,
        lift: 4,
      });
    }
  }

  splash(x, y, z, count, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (30 + Math.random() * 110) * power;
      this.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: 60 + Math.random() * 110 * power,
        vz: Math.sin(a) * s,
        life: 0.6 + Math.random() * 0.6,
        s0: 5,
        s1: 2.5,
        color: WATER_COLORS[i % WATER_COLORS.length],
        alpha: 0.9,
        drag: 0.8,
        gravity: 260,
      });
    }
  }

  steam(x, y, z) {
    this.spawn({
      x: x + (Math.random() - 0.5) * 6,
      y,
      z: z + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 10,
      vy: 26 + Math.random() * 16,
      vz: (Math.random() - 0.5) * 10,
      life: 0.9,
      s0: 4,
      s1: 14,
      color: '#ffffff',
      alpha: 0.5,
      drag: 1,
    });
  }

  mist(x, y, z) {
    this.spawn({
      x: x + (Math.random() - 0.5) * 120,
      y,
      z: z + (Math.random() - 0.5) * 120,
      vx: (Math.random() - 0.5) * 20,
      vy: 20 + Math.random() * 30,
      vz: (Math.random() - 0.5) * 20,
      life: 1.4,
      s0: 24,
      s1: 70,
      color: '#ffffff',
      alpha: 0.35,
      drag: 0.8,
    });
  }

  confetti(x, y, z, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 150;
      this.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: 120 + Math.random() * 160,
        vz: Math.sin(a) * s,
        life: 1.6 + Math.random() * 1.2,
        s0: 7,
        s1: 5,
        color: CONFETTI[i % CONFETTI.length],
        alpha: 1,
        drag: 0.9,
        gravity: 190,
      });
    }
  }

  update(dt) {
    const items = this.items;
    let w = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vz *= damp;
      p.vy = p.vy * damp + (p.lift - p.gravity) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      items[w++] = p;
    }
    items.length = w;
    for (let i = 0; i < w; i++) {
      const p = items[i];
      const k = 1 - p.life / p.max;
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      this.colors[i * 4] = p.color.r;
      this.colors[i * 4 + 1] = p.color.g;
      this.colors[i * 4 + 2] = p.color.b;
      this.colors[i * 4 + 3] = p.alpha * (1 - k) ** 1.3 * Math.min(1, k * 8 + 0.2);
      this.sizes[i] = p.s0 + (p.s1 - p.s0) * k;
    }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, w);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aColor.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
  }

  clear() {
    this.items.length = 0;
  }
}
