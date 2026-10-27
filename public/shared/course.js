import { BOAT } from './config.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

const SPIKE_RADIUS = 11;
const SPIKE_FIELD_RADIUS = 46;
const ROLLER_RADIUS = 22;
const WHIRL_RADIUS = 86;
const WHIRL_CORE = 26;
const FALL_LENGTH = 130;
const FALL_DROP = 34;
const FALL_ACCEL = 100;
const MIN_HALF_WIDTH = 76;
const ROLLER_TRAVEL = 600;
const ROLLER_TOP_HALF_LENGTH = 28;
const ROLLER_TOP_MIN_HALF_LENGTH = 10;
const ROLLER_TOP_SLACK = 36;
const LOG_MIN_WIDTH = 80;
const WALL_MIN_WIDTH = 84;
const WALL_MIN_LENGTH = 160;
// Respawn flags: how far along the river to look for a calm spot, and the open water wanted
// around the boat there (edge to edge, px).
const RESPAWN_SEARCH = 300;
const RESPAWN_ROOM = 50;
const RESPAWN_FALL_ROOM = 150;
const clampCurve = (k, max) => Math.min(max, Math.max(-max, k));

export const HAZARD = {
  FALL_ACCEL,
  WHIRL_SWIRL: 60,
  WHIRL_PULL: 48,
  WHIRL_SPIN: 1.8,
  WHIRL_CORE_DRAG: 2,
  WHIRL_FLUSH_SECONDS: 2.2,
  WHIRL_GAS_LOSS: 30,
  ROLLER_SPAWN_SAFE: 320,
  FLUSH_SPEED: 130,
  FLUSH_SPIN: 1.6,
};

// Accelerations (px/s^2) of the three kinds of river current.
const CURRENT_PUSH = { with: 46, against: -34, side: 42 };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Course {
  constructor(def) {
    this.def = def;
    this.name = def.name;
    this.theme = def.theme;
    this.stepLength = def.stepLength;
    this.flow = def.flow;
    this.points = [];
    this.rocks = [];
    this.spikes = [];
    this.spikeFields = [];
    this.logs = [];
    this.currents = [];
    this.rollers = [];
    this.whirlpools = [];
    this.falls = [];
    this.walls = [];
    this.checkpoints = [];
    this.buildRiver();
    this.length = (this.points.length - 1) * this.stepLength;
    this.finishS = this.length - 100;
    this.parTime = Math.round(this.length / 42);
    this.startS = 110;
    this.buildObstacles();
    this.buildCheckpoints();
  }

  buildRiver() {
    let best = null;
    let bestOverlaps = Infinity;
    for (let attempt = 0; attempt < 80; attempt++) {
      const pts = this.tryRiver(attempt);
      const overlaps = this.countOverlaps(pts);
      if (overlaps < bestOverlaps) {
        best = pts;
        bestOverlaps = overlaps;
      }
      if (overlaps === 0) break;
    }
    this.points = best;
  }

  countOverlaps(pts) {
    let count = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 16; j < pts.length; j++) {
        const need = pts[i].w + pts[j].w + 36;
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        if (dx * dx + dy * dy < need * need) count++;
      }
    }
    return count;
  }

  tryRiver(attempt) {
    const rand = mulberry32(this.def.seed + attempt * 977);
    const { steps, stepLength, halfWidth, wobble, curve, seed } = this.def;
    const events = [];
    for (let c = 16; c < steps - 10; c += 12 + Math.floor(rand() * 16)) {
      events.push({ c, span: 4 + rand() * 6, factor: rand() < 0.55 ? 0.68 + rand() * 0.12 : 1.18 + rand() * 0.2 });
    }
    const widthAt = (i, calm) => {
      let f = 1;
      for (const e of events) {
        const t = (i - e.c) / e.span;
        if (Math.abs(t) < 1) f *= 1 + (e.factor - 1) * (1 - t * t) ** 2;
      }
      return Math.max(MIN_HALF_WIDTH, (calm ? halfWidth * 1.15 : halfWidth * f) + (calm ? 0 : Math.sin(i * 0.23 + seed) * wobble));
    };
    const pts = [];
    let x = 0;
    let y = 0;
    let heading = Math.PI / 2;
    let kappa = 0;
    let target = 0;
    let hold = 0;
    let lastSign = rand() < 0.5 ? -1 : 1;
    for (let i = 0; i <= steps; i++) {
      const calm = i < 8 || i > steps - 6;
      pts.push({ x, y, w: widthAt(i, calm) });
      if (i === steps) break;
      if (!calm) {
        if (hold <= 0) {
          const sign = rand() < 0.72 ? -lastSign : lastSign;
          const magnitude = (0.35 + 0.65 * rand()) * curve;
          target = rand() < 0.14 ? 0 : sign * magnitude;
          if (target !== 0) lastSign = sign;
          hold = target === 0 ? 4 + rand() * 5 : Math.min(5 + rand() * 12, 2.4 / (stepLength * Math.abs(target)));
        }
        hold -= 1;
        const deviation = heading - Math.PI / 2;
        const pull = -deviation * 0.0022;
        kappa += (clampCurve(target + pull, curve * 1.1) - kappa) * 0.24;
      } else {
        kappa *= 0.7;
      }
      heading += kappa * stepLength;
      x += Math.cos(heading) * stepLength;
      y += Math.sin(heading) * stepLength;
    }
    return pts;
  }

  buildObstacles() {
    const rand = mulberry32(this.def.seed * 7919 + 13);
    const { spacing, weights } = this.def;
    const kinds = Object.keys(weights).filter((k) => weights[k] > 0);
    const total = kinds.reduce((sum, k) => sum + weights[k], 0);
    let s = 520;
    let lastMoving = -1e9;
    while (s < this.finishS - 420) {
      let roll = rand() * total;
      let kind = kinds[0];
      for (const k of kinds) {
        if (roll < weights[k]) {
          kind = k;
          break;
        }
        roll -= weights[k];
      }
      let used = 0;
      const moving = kind === 'rollerSide' || kind === 'rollerTop' || kind === 'log' || kind === 'whirlpool' || kind === 'fall';
      if (moving && s - lastMoving < 430) kind = 'rock';
      if (moving && kind !== 'rock') lastMoving = s + (kind === 'fall' ? FALL_LENGTH : 0);
      if (kind === 'fall' && this.falls.length >= (this.def.maxFalls ?? 1)) kind = 'rock';
      if (kind === 'rock') this.addRock(s, rand, 0, false);
      else if (kind === 'cluster') used = this.addCluster(s, rand);
      else if (kind === 'log') this.addLog(s, rand);
      else if (kind === 'current') this.addCurrent(s, rand);
      else if (kind === 'spikes') this.addSpikes(s, rand);
      else if (kind === 'rollerSide') this.addRoller(s, rand, 'side');
      else if (kind === 'rollerTop') used = this.addRoller(s, rand, 'top') ? 520 : 0;
      else if (kind === 'whirlpool') this.addWhirlpool(s, rand);
      else if (kind === 'wall') this.addWall(s, rand);
      else if (kind === 'fall') used = this.addFall(s);
      s += used + spacing[0] + rand() * (spacing[1] - spacing[0]);
    }
    this.ensureWhirlpool();
  }

  // A river that asks for whirlpools gets at least one, even when the random pass never rolled
  // it (moving hazards need room around them, so on a short or twisty river it can come up empty).
  // It draws from its own stream, so every river that already has one keeps exactly the same hazards.
  ensureWhirlpool() {
    if (!(this.def.weights.whirlpool > 0) || this.whirlpools.length) return;
    const rand = mulberry32(this.def.seed * 104729 + 29);
    const moving = [...this.rollers.map((o) => o.s), ...this.logs.map((o) => o.s), ...this.falls.flatMap((o) => [o.s0, o.s0 + o.len])];
    const first = this.startS + 1400;
    const last = this.finishS - 1000;
    const count = Math.floor((last - first) / 60) + 1;
    const offset = Math.floor(rand() * count);
    let best = null;
    for (let k = 0; k < count; k++) {
      const s = first + ((offset + k) % count) * 60;
      const { w, x, y } = this.pointAtS(s);
      if (w < 84 || moving.some((m) => Math.abs(m - s) < 450) || this.tooClose(x, y, WHIRL_RADIUS * 0.6)) continue;
      // the widest stretch of river is the fairest place for it
      if (!best || w > best.w + 1) best = { s, w };
    }
    if (best) this.addWhirlpool(best.s, rand);
  }

  freeSpot(s, rand, r, side, tight) {
    const p = this.pointAtS(s);
    const lo = Math.max(0, this.def.clearance - p.w + r);
    const hi = p.w - r - 10;
    if (lo > hi) return null;
    const span = tight ? (hi - lo) * 0.6 : hi - lo;
    const off = lo + rand() * span;
    const sign = side || (rand() < 0.5 ? -1 : 1);
    return { x: p.x + p.nx * off * sign, y: p.y + p.ny * off * sign, p };
  }

  tooClose(x, y, r) {
    const gap = BOAT.radius * 2 + 44;
    if (this.rocks.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + gap)) return true;
    return this.spikeFields.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + gap);
  }

  addRock(s, rand, side, tight) {
    const [rMin, rMax] = this.def.rockRadius;
    for (let attempt = 0; attempt < 14; attempt++) {
      const r = Math.max(14, rMin + rand() * (rMax - rMin) - attempt * 1.5);
      const spot = this.freeSpot(s, rand, r, side, tight);
      if (!spot || this.tooClose(spot.x, spot.y, r)) continue;
      this.rocks.push({ x: spot.x, y: spot.y, r, s });
      return;
    }
  }

  addCluster(s, rand) {
    const side = rand() < 0.5 ? -1 : 1;
    for (let i = 0; i < 3; i++) this.addRock(s + i * 190, rand, side * (i % 2 === 0 ? 1 : -1), true);
    return 380;
  }

  addSpikes(s, rand) {
    for (let attempt = 0; attempt < 14; attempt++) {
      const r = SPIKE_FIELD_RADIUS - attempt * 2;
      const spot = this.freeSpot(s, rand, r, 0, false);
      if (!spot || this.tooClose(spot.x, spot.y, r)) continue;
      const count = 5 + Math.floor(rand() * 3);
      const field = { x: spot.x, y: spot.y, r, s, spikes: [] };
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rand() * 0.6;
        const d = i === 0 ? 0 : (r - SPIKE_RADIUS - 4) * (0.55 + rand() * 0.45);
        const spike = { x: spot.x + Math.cos(a) * d, y: spot.y + Math.sin(a) * d, r: SPIKE_RADIUS };
        field.spikes.push(spike);
        this.spikes.push(spike);
      }
      this.spikeFields.push(field);
      return;
    }
  }

  // Narrowest half-width of the river between two positions along it.
  minWidth(s0, s1) {
    let min = Infinity;
    for (let s = s0; s <= s1; s += 20) min = Math.min(min, this.pointAtS(s).w);
    return Math.min(min, this.pointAtS(s1).w);
  }

  addLog(s, rand) {
    const p = this.pointAtS(s);
    const period = 3.8 + rand() * 1.8;
    const phase = rand() * Math.PI * 2;
    // A log sweeps the whole river; in a tight gorge there is no pocket to wait in.
    if (this.minWidth(s - 80, s + 80) < LOG_MIN_WIDTH) return;
    this.logs.push({
      s,
      cx: p.x,
      cy: p.y,
      nx: p.nx,
      ny: p.ny,
      amp: p.w - 30,
      period,
      phase,
      r: 22,
    });
  }

  addCurrent(s, rand) {
    const p = this.pointAtS(s);
    const off = (rand() * 2 - 1) * p.w * 0.4;
    const r = 64 + rand() * 30;
    const roll = rand();
    let dir;
    if (roll < 0.35) dir = [p.tx, p.ty, CURRENT_PUSH.with];
    else if (roll < 0.6) dir = [p.tx, p.ty, CURRENT_PUSH.against];
    else dir = [p.nx, p.ny, rand() < 0.5 ? CURRENT_PUSH.side : -CURRENT_PUSH.side];
    this.currents.push({
      x: p.x + p.nx * off,
      y: p.y + p.ny * off,
      r,
      ax: dir[0] * dir[2],
      ay: dir[1] * dir[2],
      s,
    });
  }

  addRoller(s, rand, mode) {
    const p = this.pointAtS(s);
    if (mode === 'side' && p.w < 92) return false;
    if (mode === 'side') {
      const dir = rand() < 0.5 ? -1 : 1;
      this.rollers.push({
        mode: 'side',
        dir,
        s,
        cx: p.x,
        cy: p.y,
        tx: p.tx,
        ty: p.ty,
        nx: p.nx,
        ny: p.ny,
        reach: p.w + ROLLER_RADIUS + 12,
        hl: 52,
        r: ROLLER_RADIUS,
        period: 7.5 + rand() * 2.5,
        phase: rand(),
      });
      return true;
    }
    // The barrel drives down the river toward the boat for `travel` px, so the whole stretch it
    // covers has to be wide enough to slip past it, whichever lane it picks.
    const period = 7.5 + rand() * 2;
    const phase = rand();
    const seed = Math.floor(rand() * 1000);
    const minW = this.minWidth(s + 40, s + ROLLER_TRAVEL + 40);
    // The barrel gets shorter where the river is narrow, so that in its worst lane there are still
    // boat width plus some slack of open water on the wide side: minW + laneMax - hl - r with
    // laneMax = minW - hl - 8.
    const gap = BOAT.radius * 2 + ROLLER_TOP_SLACK;
    const hl = clamp(minW - (8 + ROLLER_RADIUS + gap) / 2, ROLLER_TOP_MIN_HALF_LENGTH, ROLLER_TOP_HALF_LENGTH);
    const laneMax = minW - hl - 8;
    // Beside a barrel in lane L there are minW + |L| - hl - r px of water on the wide side.
    const laneMin = Math.max(0, gap + hl + ROLLER_RADIUS - minW);
    this.rollers.push({
      mode: 'top',
      dir: 1,
      s,
      cx: p.x,
      cy: p.y,
      tx: p.tx,
      ty: p.ty,
      nx: p.nx,
      ny: p.ny,
      hl,
      lane: laneMax,
      laneMin,
      r: ROLLER_RADIUS,
      travel: ROLLER_TRAVEL,
      period,
      phase,
      seed,
    });
    return true;
  }

  addWhirlpool(s, rand) {
    const p = this.pointAtS(s);
    if (p.w < 84) return;
    this.whirlpools.push({
      s,
      cx: p.x,
      cy: p.y,
      nx: p.nx,
      ny: p.ny,
      amp: Math.max(8, p.w * 0.24),
      period: 8 + rand() * 4,
      phase: rand() * Math.PI * 2,
      r: WHIRL_RADIUS,
      core: WHIRL_CORE,
      dir: rand() < 0.5 ? -1 : 1,
    });
  }

  addWall(s, rand) {
    const side = rand() < 0.5 ? -1 : 1;
    const len = 300 + rand() * 320;
    let s0 = Math.max(this.startS + 200, s - len / 2);
    let s1 = Math.min(this.finishS - 200, s + len / 2);
    // A loose boat cannot thread a spiked rail through a gorge: only keep the part of the rail
    // where the river is wide enough to stay clear of it.
    let best = null;
    let from = null;
    for (let at = s0; at <= s1 + 20; at += 20) {
      const wide = at <= s1 && this.pointAtS(at).w >= WALL_MIN_WIDTH;
      if (wide && from === null) from = at;
      if (!wide && from !== null) {
        if (!best || at - 20 - from > best.s1 - best.s0) best = { s0: from, s1: at - 20 };
        from = null;
      }
    }
    if (from !== null && (!best || s1 - from > best.s1 - best.s0)) best = { s0: from, s1 };
    if (!best || best.s1 - best.s0 < WALL_MIN_LENGTH) return;
    s0 = best.s0;
    s1 = best.s1;
    if (this.walls.some((w) => w.side === side && s0 < w.s1 + 140 && s1 > w.s0 - 140)) return;
    this.walls.push({ side, s0, s1 });
  }

  addFall(s) {
    if (this.falls.some((f) => Math.abs(f.s0 - s) < 700)) return 0;
    this.falls.push({ s0: s, len: FALL_LENGTH, drop: FALL_DROP });
    return FALL_LENGTH + 260;
  }

  // A flag is also where a sunk crew restarts, at rest on the centre line, so each one sits at the
  // quarter marks of the river or, when that spot is crowded, at the nearest calmer spot along it.
  buildCheckpoints() {
    const lo = this.startS + 200;
    const hi = this.finishS - 200;
    for (let k = 1; k <= 3; k++) {
      const base = (this.finishS * k) / 4;
      let best = base;
      let bestCost = this.respawnCost(base);
      for (let off = 30; bestCost > 0 && off <= RESPAWN_SEARCH; off += 30) {
        for (const s of [base + off, base - off]) {
          const cost = s >= lo && s <= hi ? this.respawnCost(s) : Infinity;
          if (cost < bestCost) {
            best = s;
            bestCost = cost;
          }
        }
      }
      this.checkpoints.push(best);
    }
  }

  // How badly a boat set down at rest on the centre line at s would be placed: the shortfall (px)
  // against the room it should have around it, summed over everything nearby. 0 is a clean spot.
  respawnCost(s) {
    const p = this.pointAtS(s);
    const short = (gap, room) => Math.max(0, room - gap);
    let cost = 0;
    for (const o of this.rocks) cost += short(Math.hypot(o.x - p.x, o.y - p.y) - o.r - BOAT.radius, RESPAWN_ROOM);
    for (const o of this.spikes) cost += short(Math.hypot(o.x - p.x, o.y - p.y) - o.r - BOAT.radius, RESPAWN_ROOM);
    // The rest of the hazards move, so measure along the river: logs and side barrels sweep the
    // whole width, a whirlpool pulls from `r` around the centre line, a fall flings the boat downstream.
    for (const o of this.logs) cost += short(Math.abs(o.s - s), o.r + BOAT.radius + RESPAWN_ROOM);
    for (const o of this.rollers) if (o.mode === 'side') cost += short(Math.abs(o.s - s), o.hl + o.r + BOAT.radius + RESPAWN_ROOM);
    for (const o of this.whirlpools) cost += short(Math.hypot(o.cx - p.x, o.cy - p.y), o.r + RESPAWN_ROOM);
    for (const f of this.falls) cost += short(Math.max(f.s0 - s, s - (f.s0 + f.len), 0), RESPAWN_FALL_ROOM);
    // A spiked rail hurts on the slightest touch and a still boat can drift into it.
    if (this.wallAt(s, -1) || this.wallAt(s, 1)) cost += RESPAWN_ROOM / 2;
    return cost;
  }

  wallAt(s, side) {
    return this.walls.some((w) => w.side === side && s >= w.s0 && s <= w.s1);
  }

  heightAt(s) {
    let h = 0;
    for (const f of this.falls) h -= f.drop * smooth((s - f.s0) / f.len);
    return h;
  }

  fallAt(s) {
    return this.falls.find((f) => s >= f.s0 && s <= f.s0 + f.len) ?? null;
  }

  pointAtS(s) {
    const last = this.points.length - 2;
    const f = clamp(s / this.stepLength, 0, last + 1);
    const i = Math.min(last, Math.floor(f));
    const t = f - i;
    const a = this.points[i];
    const b = this.points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const tx = dx / len;
    const ty = dy / len;
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      w: lerp(a.w, b.w, t),
      tx,
      ty,
      nx: -ty,
      ny: tx,
      index: i,
    };
  }

  poseAtS(s) {
    const p = this.pointAtS(s);
    return { x: p.x, y: p.y, a: Math.atan2(p.ty, p.tx), index: p.index };
  }

  locate(x, y, hint = -1) {
    const pts = this.points;
    const last = pts.length - 2;
    const lo = hint < 0 ? 0 : Math.max(0, hint - 6);
    const hi = hint < 0 ? last : Math.min(last, hint + 6);
    let best = null;
    for (let i = lo; i <= hi; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / len2, 0, 1);
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (!best || d2 < best.d2) best = { i, t, px, py, d2, dx, dy, len2 };
    }
    const len = Math.sqrt(best.len2);
    const a = pts[best.i];
    const b = pts[best.i + 1];
    return {
      index: best.i,
      px: best.px,
      py: best.py,
      dist: Math.sqrt(best.d2),
      tx: best.dx / len,
      ty: best.dy / len,
      halfWidth: lerp(a.w, b.w, best.t),
      s: (best.i + best.t) * this.stepLength,
    };
  }

  logState(log, time) {
    const w = (Math.PI * 2) / log.period;
    const phase = w * time + log.phase;
    const off = log.amp * Math.sin(phase);
    const vel = log.amp * w * Math.cos(phase);
    return {
      x: log.cx + log.nx * off,
      y: log.cy + log.ny * off,
      vx: log.nx * vel,
      vy: log.ny * vel,
    };
  }

  whirlState(whirl, time) {
    const w = (Math.PI * 2) / whirl.period;
    const off = whirl.amp * Math.sin(w * time + whirl.phase);
    return { x: whirl.cx + whirl.nx * off, y: whirl.cy + whirl.ny * off };
  }

  rollerState(roller, time) {
    const cycle = time / roller.period + roller.phase;
    const k = Math.floor(cycle);
    const u = cycle - k;
    if (roller.mode === 'side') {
      const cross = 0.36;
      let p = null;
      let back = false;
      if (u < cross) p = u / cross;
      else if (u >= 0.5 && u < 0.5 + cross) {
        p = (u - 0.5) / cross;
        back = true;
      }
      const startSign = roller.dir * (back ? -1 : 1);
      const resting = p === null;
      const progress = resting ? (u < 0.5 ? 1 : 0) : p;
      const off = lerp(-startSign * roller.reach, startSign * roller.reach, progress);
      const speed = (2 * roller.reach) / (cross * roller.period);
      return {
        x: roller.cx + roller.nx * off,
        y: roller.cy + roller.ny * off,
        ux: roller.tx,
        uy: roller.ty,
        hl: roller.hl,
        r: roller.r,
        active: !resting,
        vx: resting ? 0 : roller.nx * startSign * speed,
        vy: resting ? 0 : roller.ny * startSign * speed,
        roll: off / roller.r,
        mode: 'side',
      };
    }
    const travelFrac = 0.8;
    const resting = u >= travelFrac;
    const p = resting ? 1 : u / travelFrac;
    // Each pass picks a lane that always leaves room beside the barrel for the boat.
    const pick = Math.sin((k + roller.seed) * 2.399);
    const lane = Math.sign(pick || 1) * (roller.laneMin + Math.abs(pick) * (roller.lane - roller.laneMin));
    const along = roller.travel * (1 - p) + 40;
    const speed = roller.travel / (travelFrac * roller.period);
    const base = this.pointAtS(roller.s + along);
    return {
      x: base.x + base.nx * lane,
      y: base.y + base.ny * lane,
      ux: base.nx,
      uy: base.ny,
      hl: roller.hl,
      r: roller.r,
      active: !resting,
      vx: -base.tx * speed,
      vy: -base.ty * speed,
      roll: -along / roller.r,
      mode: 'top',
    };
  }
}
