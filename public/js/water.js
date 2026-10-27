import * as THREE from '../vendor/three.min.js';

const FOG_CHUNK = `
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  vec3 applyFog(vec3 col, vec3 world) {
    float f = smoothstep(uFogNear, uFogFar, distance(world, cameraPosition));
    return mix(col, uFog, f);
  }
`;

const WATER_VERTEX = `
  attribute float aEdge;
  attribute float aFall;
  attribute float aS;
  attribute float aLat;
  varying vec3 vWorld;
  varying float vEdge;
  varying float vFall;
  varying float vS;
  varying float vLat;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vEdge = aEdge;
    vFall = aFall;
    vS = aS;
    vLat = aLat;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAGMENT = `
  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  varying vec3 vWorld;
  varying float vEdge;
  varying float vFall;
  varying float vS;
  varying float vLat;
  ${FOG_CHUNK}
  void main() {
    vec2 p = vWorld.xz;
    float rush = clamp(vFall * 3.0, 0.0, 1.0);
    vec2 g = vec2(0.0);
    g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.11 + uTime * 1.3) * 0.07;
    g += vec2(-0.6, 0.8) * cos(dot(p, vec2(-0.6, 0.8)) * 0.17 + uTime * 1.7) * 0.055;
    g += vec2(0.2, -0.98) * cos(dot(p, vec2(0.2, -0.98)) * 0.31 + uTime * 2.3) * 0.033;
    g += vec2(-0.9, -0.4) * cos(dot(p, vec2(-0.9, -0.4)) * 0.52 + uTime * 2.9) * 0.02;
    g *= 1.0 + rush * 2.2;
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = 0.04 + 0.5 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
    float depth = smoothstep(4.0, 90.0, vEdge);
    vec3 col = mix(uShallow, uDeep, depth * 0.75);
    float streak = smoothstep(0.94, 1.0, sin(vS * 0.045 - uTime * (1.1 + rush * 7.0) + vLat * 0.07 + sin(vLat * 0.05 + vS * 0.01) * 2.0));
    col += streak * 0.12;
    float caustic = sin(p.x * 0.23 + uTime * 0.9) * sin(p.y * 0.21 - uTime * 0.7);
    col += smoothstep(0.65, 1.0, caustic) * 0.05;
    col = mix(col, uSky, fres);
    vec3 H = normalize(uSunDir + V);
    float spec = pow(clamp(dot(N, H), 0.0, 1.0), 520.0) * 0.9;
    col += spec * vec3(1.0, 0.96, 0.86);
    float foamStreak = smoothstep(0.5, 1.0, sin(vWorld.x * 0.37 + vWorld.z * 0.11 - uTime * (5.0 + rush * 10.0)));
    col = mix(col, vec3(1.0), clamp(rush * (0.4 + 0.5 * foamStreak), 0.0, 0.92));
    float foam = smoothstep(18.0, 0.0, vEdge) * (0.5 + 0.35 * sin(vS * 0.31 + uTime * 2.0));
    col = mix(col, vec3(1.0), clamp(foam, 0.0, 0.85));
    gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
    #include <colorspace_fragment>
  }
`;

const WHIRL_VERTEX = `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WHIRL_FRAGMENT = `
  uniform float uTime;
  uniform float uDir;
  varying vec2 vUv;
  varying vec3 vWorld;
  ${FOG_CHUNK}
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float ang = atan(p.y, p.x);
    float spiral = ang * uDir * 3.0 + uTime * 2.4 * uDir - r * 14.0;
    float arms = smoothstep(0.3, 0.95, sin(spiral));
    float core = smoothstep(0.34, 0.0, r);
    vec3 rim = vec3(0.7, 0.88, 1.0);
    vec3 base = mix(rim, vec3(0.02, 0.12, 0.38), smoothstep(0.9, 0.05, r));
    vec3 col = mix(base, vec3(1.0), arms * (1.0 - r) * 0.85);
    col = mix(col, vec3(0.0, 0.05, 0.2), core * 0.7);
    float alpha = (1.0 - smoothstep(0.74, 1.0, r)) * (0.45 + 0.4 * arms + 0.5 * core);
    gl_FragColor = vec4(applyFog(col, vWorld), alpha);
    #include <colorspace_fragment>
  }
`;

const SHEET_VERTEX = WHIRL_VERTEX;

const SHEET_FRAGMENT = `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorld;
  ${FOG_CHUNK}
  void main() {
    float streak = sin(vUv.x * 46.0 + sin(vUv.y * 7.0 + uTime) * 2.0);
    float flow = fract(vUv.y * 3.0 + uTime * 1.5 + vUv.x * 4.0);
    vec3 col = mix(vec3(0.7, 0.9, 1.0), vec3(1.0), smoothstep(0.5, 1.0, streak) * 0.55 + (1.0 - flow) * 0.25);
    float alpha = 0.86 * smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x);
    gl_FragColor = vec4(applyFog(col, vWorld), alpha);
    #include <colorspace_fragment>
  }
`;

export function createShared(theme) {
  return {
    uTime: { value: 0 },
    uFog: { value: new THREE.Color(theme.fog) },
    uFogNear: { value: 420 },
    uFogFar: { value: 1900 },
    uSky: { value: new THREE.Color(theme.sky).lerp(new THREE.Color('#ffffff'), 0.35) },
    uSunDir: { value: new THREE.Vector3(-0.45, 0.8, 0.35).normalize() },
  };
}

export function buildWater(course, path, theme, shared) {
  const positions = [];
  const edge = [];
  const fall = [];
  const sCoord = [];
  const lat = [];
  const indices = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const s = path[i].s;
    const h = course.heightAt(s) - 0.35;
    const slope = Math.abs(course.heightAt(s + 20) - course.heightAt(s - 20)) / 40;
    const w = path[i].w + 7;
    positions.push(path[i].x + nx * w, h, path[i].y + ny * w, path[i].x, h, path[i].y, path[i].x - nx * w, h, path[i].y - ny * w);
    edge.push(0, w, 0);
    fall.push(slope, slope, slope);
    sCoord.push(s, s, s);
    lat.push(w, 0, -w);
    if (i < path.length - 1) {
      const k = i * 3;
      indices.push(k, k + 3, k + 1, k + 1, k + 3, k + 4, k + 1, k + 4, k + 2, k + 2, k + 4, k + 5);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  geometry.setAttribute('aFall', new THREE.Float32BufferAttribute(fall, 1));
  geometry.setAttribute('aS', new THREE.Float32BufferAttribute(sCoord, 1));
  geometry.setAttribute('aLat', new THREE.Float32BufferAttribute(lat, 1));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uShallow: { value: new THREE.Color(theme.water) },
      uDeep: { value: new THREE.Color(theme.deep) },
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 0;
  return mesh;
}

export function createWhirlMaterial(shared, dir) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uDir: { value: dir } },
    vertexShader: WHIRL_VERTEX,
    fragmentShader: WHIRL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
}

export function createSheetMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: SHEET_VERTEX,
    fragmentShader: SHEET_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export class RippleRings {
  constructor(group, size = 30) {
    this.rings = [];
    const geometry = new THREE.RingGeometry(0.88, 1, 56);
    geometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < size; i++) {
      const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 3;
      group.add(mesh);
      this.rings.push({ mesh, age: 0, life: 1, delay: 0, max: 30, active: false });
    }
    this.cursor = 0;
  }

  spawn(x, y, z, max, life = 1.4, delay = 0) {
    const ring = this.rings[this.cursor];
    this.cursor = (this.cursor + 1) % this.rings.length;
    ring.active = true;
    ring.age = -delay;
    ring.life = life;
    ring.max = max;
    ring.mesh.position.set(x, y, z);
    ring.mesh.visible = false;
  }

  burst(x, y, z, strength = 1) {
    const base = 22 + strength * 20;
    this.spawn(x, y, z, base, 1.5, 0);
    this.spawn(x, y, z, base * 1.45, 1.7, 0.16);
    this.spawn(x, y, z, base * 1.9, 1.9, 0.34);
  }

  update(dt) {
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.age += dt;
      if (ring.age < 0) continue;
      const k = ring.age / ring.life;
      if (k >= 1) {
        ring.active = false;
        ring.mesh.visible = false;
        continue;
      }
      ring.mesh.visible = true;
      const radius = 4 + ring.max * (1 - (1 - k) ** 2);
      ring.mesh.scale.set(radius, 1, radius);
      ring.mesh.material.opacity = 0.75 * (1 - k) ** 1.5;
    }
  }
}

export function sunShadowFrame(light, center, radius) {
  const cam = light.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.updateProjectionMatrix();
  light.target.position.copy(center);
  light.position.copy(center).add(new THREE.Vector3(-0.45, 0.8, 0.35).normalize().multiplyScalar(500));
  light.target.updateMatrixWorld();
}

