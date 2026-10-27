import { DT, BOAT, FART, clampToSector, wrapAngle } from '../public/shared/config.js';
import { Course } from '../public/shared/course.js';
import { LEVELS } from '../public/shared/levels.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Level 1's course class and river flow, but a dead straight, very wide and empty river. Used to
// measure how the boat itself behaves without banks or hazards getting in the way.
export function calmCourse() {
  const course = new Course(LEVELS[0]);
  const step = course.stepLength;
  course.points = Array.from({ length: 800 }, (_, i) => ({ x: 0, y: i * step, w: 900 }));
  for (const key of ['rocks', 'spikes', 'spikeFields', 'logs', 'currents', 'rollers', 'whirlpools', 'falls', 'walls']) course[key] = [];
  course.finishS = 1e9;
  course.length = (course.points.length - 1) * step;
  return course;
}

// A velocity controller for the loose boat.
//
// Every decision it (1) picks a steering target on the river like a person would, (2) turns that
// into a desired velocity (toward the target, at a cruise speed that is cut near gorges, obstacles
// and drops), (3) compares it with the real velocity, minus whatever blasts are already charging
// or still burning, and (4) sends each seat to the spot on the rim that pushes along the error and
// sizes its blast to the error. Blasts that point backward brake the boat, sideways ones steer it.
// Charging takes power x 1.1 s and walking round the rim takes up to 0.9 s, so a seat starts
// charging "just in time" to be in place when its blast is ready, and speed limits are set early
// enough to brake in time. Barrels that sweep across the river and logs are timed: it works out
// what speed gets it through between sweeps, and waits short of them when nothing does. Barrels
// rolling in from ahead keep their lane, so it swerves into the free one.
export class Autopilot {
  constructor(sim, { cruise = 100, lookahead = 200, interval = 0.1, brake = 26, latency = 0.45, plan = {} } = {}) {
    this.sim = sim;
    this.cruise = cruise;
    this.lookahead = lookahead;
    this.interval = interval;
    this.brake = brake;
    this.latency = latency;
    this.plan = { dead: 0.5, accel: 40, margin: 14, stop: 30, ...plan };
    this.sweepList = this.sweepers();
    this.plans = sim.seats.map(() => null);
    this.nextDecision = 0;
    this.lane = 0;
    this.aim = { ux: 1, uy: 0, limit: 0, relX: 0, relY: 0 };
    this.bands = [];
    this.hold = false;
  }

  segmentClearance(x0, y0, x1, y1, ox, oy, radius) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    const raw = ((ox - x0) * dx + (oy - y0) * dy) / len2;
    if (raw < 0.08) return 200;
    const t = clamp(raw, 0, 1);
    return Math.hypot(ox - (x0 + dx * t), oy - (y0 + dy * t)) - radius - BOAT.radius;
  }

  waterSpeed() {
    const sim = this.sim;
    return Math.hypot(sim.vx - sim.flowX, sim.vy - sim.flowY);
  }

  obstaclesNear(s, look) {
    const sim = this.sim;
    const course = sim.course;
    const eta = sim.time + Math.max(0, look / Math.max(60, this.waterSpeed()));
    const out = [];
    for (const r of course.rocks) if (Math.abs(r.s - s) < look + 120) out.push([r.x, r.y, r.r]);
    for (const f of course.spikeFields) if (Math.abs(f.s - s) < look + 120) for (const k of f.spikes) out.push([k.x, k.y, k.r + 10]);
    for (const l of course.logs) {
      if (Math.abs(l.s - s) > look + 120) continue;
      const st = course.logState(l, eta);
      out.push([st.x, st.y, l.r + 14]);
    }
    for (const wp of course.whirlpools) {
      if (Math.abs(wp.s - s) > look + 120) continue;
      const st = course.whirlState(wp, eta);
      out.push([st.x, st.y, wp.r * 0.8]);
    }
    return out;
  }

  // Lateral bands (offset from the river centre line) that barrels rolling down the river toward
  // us occupy: they keep their lane for the whole run, so pick a different one early.
  rollerBands() {
    const sim = this.sim;
    const course = sim.course;
    const bands = [];
    for (const ro of course.rollers) {
      if (ro.mode !== 'top') continue;
      const st = course.rollerState(ro, sim.time);
      if (!st.active) continue;
      const loc = course.locate(st.x, st.y);
      if (loc.s < sim.progress - 50 || loc.s > sim.progress + this.lookahead + 420) continue;
      const off = (st.x - loc.px) * -loc.ty + (st.y - loc.py) * loc.tx;
      const reach = ro.hl + ro.r + BOAT.radius + 6;
      bands.push({ lo: off - reach, hi: off + reach });
    }
    return bands;
  }

  pickTarget() {
    const sim = this.sim;
    const course = sim.course;
    const bands = this.rollerBands();
    this.bands = bands;
    for (const look of [this.lookahead, 140, 90, 55]) {
      const s = Math.min(course.finishS, sim.progress + look);
      const p = course.pointAtS(s);
      const obstacles = this.obstaclesNear(s, look);
      const wallMargin = 30;
      let best = null;
      for (let k = -6; k <= 6; k++) {
        let limit = p.w - BOAT.radius - 8;
        const frac = k / 6;
        if (frac !== 0 && course.wallAt(s, Math.sign(frac))) limit = p.w - BOAT.radius - wallMargin;
        const off = frac * limit;
        if (bands.some((b) => off > b.lo && off < b.hi)) continue;
        const x = p.x + p.nx * off;
        const y = p.y + p.ny * off;
        let clear = 200;
        for (const [ox, oy, or] of obstacles) clear = Math.min(clear, this.segmentClearance(sim.x, sim.y, x, y, ox, oy, or));
        if (clear < 12) continue;
        const cost = Math.abs(off - this.lane) - Math.min(clear, 80) * 0.5;
        if (!best || cost < best.cost) best = { cost, x, y, off };
      }
      if (best) {
        this.lane = best.off;
        return best;
      }
    }
    const p = course.pointAtS(Math.min(course.finishS, sim.progress + 90));
    return { x: p.x, y: p.y, off: 0 };
  }

  // The fastest it is sensible to go when passing river position s (px/s over the water).
  safeSpeedAt(s) {
    const course = this.sim.course;
    const p = course.pointAtS(s);
    let safe = this.cruise;
    safe = Math.min(safe, 45 + (p.w - 76) * 1.5);
    if (course.wallAt(s, -1) || course.wallAt(s, 1)) safe = Math.min(safe, 60);
    for (const f of course.falls) if (s > f.s0 - 80 && s < f.s0 + f.len) safe = Math.min(safe, 40);
    for (const r of course.rocks) if (Math.abs(r.s - s) < 50) safe = Math.min(safe, 75);
    for (const f of course.spikeFields) if (Math.abs(f.s - s) < 60) safe = Math.min(safe, 65);
    for (const w of course.whirlpools) if (Math.abs(w.s - s) < 110) safe = Math.min(safe, 65);
    for (const r of course.rollers) if (r.mode === 'top' && Math.abs(r.s + 340 - s) < 340) safe = Math.min(safe, 70);
    for (const l of course.logs) if (Math.abs(l.s - s) < 70) safe = Math.min(safe, 70);
    return safe;
  }

  // Slow down early enough that we can still stop in time: cruise, or whatever lets us reach
  // the slowest upcoming spot at its safe speed with a gentle brake.
  speedLimit() {
    const sim = this.sim;
    let limit = this.cruise;
    for (let d = 0; d <= 420; d += 30) {
      const safe = this.safeSpeedAt(Math.min(sim.course.finishS + 60, sim.progress + d));
      const allowed = Math.sqrt(safe * safe + 2 * this.brake * Math.max(0, d - 30));
      limit = Math.min(limit, allowed);
    }
    return Math.max(38, limit);
  }

  lateral() {
    const sim = this.sim;
    const loc = sim.course.locate(sim.x, sim.y, sim.hint);
    return (sim.x - loc.px) * -loc.ty + (sim.y - loc.py) * loc.tx;
  }

  // Everything that sweeps across the river and has to be timed rather than steered around:
  // barrels rolling in from the side, and logs.
  sweepers() {
    const course = this.sim.course;
    const list = [];
    for (const ro of course.rollers) {
      if (ro.mode !== 'side') continue;
      list.push({ s: ro.s, reach: ro.hl + ro.r + BOAT.radius + this.plan.margin, at: (t) => course.rollerState(ro, t) });
    }
    for (const log of course.logs) {
      const at = (t) => ({ ...course.logState(log, t), active: true, ux: 1, uy: 0, hl: 0, r: log.r });
      list.push({ s: log.s, reach: log.r + BOAT.radius + this.plan.margin, at });
    }
    return list;
  }

  // Would the boat get past this sweeper unhurt if it kept to lateral position `lat` and moved
  // at `speed`? Walks the boat and the sweeper forward in time. Blasts take most of a second to
  // get going (walk round the rim, charge), then the boat speeds up or slows down gently.
  crossingClear(sw, lat, speed) {
    const sim = this.sim;
    const course = sim.course;
    let s = sim.progress;
    let v = Math.max(0, sim.vx * sim.tx + sim.vy * sim.ty);
    const step = 0.1;
    for (let tau = 0; tau < 12 && s < sw.s + sw.reach + 14; tau += step) {
      if (s > sw.s - sw.reach - 40) {
        const st = sw.at(sim.time + tau);
        if (st.active) {
          const bp = course.pointAtS(s);
          const bx = bp.x + bp.nx * lat;
          const by = bp.y + bp.ny * lat;
          const along = clamp((bx - st.x) * st.ux + (by - st.y) * st.uy, -st.hl, st.hl);
          if (Math.hypot(bx - (st.x + st.ux * along), by - (st.y + st.uy * along)) < BOAT.radius + st.r + this.plan.margin) return false;
        }
      }
      if (tau >= this.plan.dead) v += clamp(speed - v, -this.plan.accel * step, this.plan.accel * step);
      s += Math.max(0, v) * step;
    }
    return true;
  }

  // For things that sweep across the river: the speed (and lane) that gets us through their
  // zone between sweeps, or "hold" when we must wait before it for the next gap.
  planCrossings() {
    const sim = this.sim;
    const course = sim.course;
    const out = { limit: Infinity, hold: false };
    const lat = this.lateral();
    for (const sw of this.sweepList) {
      const ahead = sw.s - sim.progress;
      if (ahead > 460 || ahead < -sw.reach) continue;
      const half = course.pointAtS(sw.s).w - BOAT.radius - 10;
      const lanes = ahead > 220 ? [lat, -half * 0.7, half * 0.7, 0] : [lat];
      let best = null;
      for (const lane of lanes) {
        for (const speed of [this.cruise, 80, 62, 48, 36, 26]) {
          if (!this.crossingClear(sw, lane, speed)) continue;
          if (!best || speed > best.speed || (speed === best.speed && Math.abs(lane - lat) < Math.abs(best.lane - lat))) best = { speed, lane };
          break;
        }
      }
      // Once the boat is well inside the zone the best thing is to get out the far side.
      const committed = ahead < sw.reach;
      if (best) {
        if (best.lane !== lat && !committed) this.lane = best.lane;
        if (best.speed < this.cruise) out.limit = Math.min(out.limit, Math.max(best.speed, 26));
      } else if (!committed && ahead > 0) {
        // Nothing works right now: stop short of the zone and wait for the next gap.
        const room = ahead - sw.reach - this.plan.stop;
        out.limit = Math.min(out.limit, Math.sqrt(2 * this.brake * 0.8 * Math.max(0, room - 10)));
        if (room < 40) out.hold = true;
      }
    }
    return out;
  }

  // Velocity the blasts that are already in the air (or charging) will still add.
  pending(except = -1) {
    const sim = this.sim;
    let x = 0;
    let y = 0;
    for (const b of sim.bursts) {
      const left = b.impulse * (1 - b.age / b.duration) ** 2;
      x -= b.ux * left;
      y -= b.uy * left;
    }
    this.plans.forEach((plan, i) => {
      if (!plan || i === except) return;
      x += plan.ux * plan.power * plan.cap;
      y += plan.uy * plan.power * plan.cap;
    });
    return { x, y };
  }

  capacity(seat) {
    const sim = this.sim;
    const s = sim.seats[seat];
    const afford = clamp((s.gas - FART.gasBase) / FART.gasPerPower, 0, 1);
    const full = FART.maxImpulse * sim.powerScale * sim.soreFactor(seat);
    return { full, afford, cap: full * afford };
  }

  // Where seat i should stand to push along (ex, ey), and the direction it will then really push.
  station(seat, ex, ey) {
    const sim = this.sim;
    const want = Math.atan2(-ey, -ex);
    const rel = clampToSector(wrapAngle(want - sim.a), sim.layout[seat]);
    const world = wrapAngle(rel + sim.a);
    return { want, rel, world, ux: -Math.cos(world), uy: -Math.sin(world) };
  }

  walkTime(seat, rel) {
    return Math.abs(wrapAngle(rel - this.sim.seats[seat].pos)) / FART.walkSpeed;
  }

  // Desired velocity minus actual velocity, with the cached steering aim and speed limit.
  baseError() {
    const sim = this.sim;
    const aim = this.aim;
    const rvx = sim.vx - sim.flowX;
    const rvy = sim.vy - sim.flowY;
    // By the time a blast is ready the boat will have lost a little speed to drag.
    const dragK = BOAT.drag + BOAT.dragQuad * Math.hypot(rvx, rvy);
    return {
      x: aim.relX - rvx + dragK * rvx * this.latency,
      y: aim.relY - rvy + dragK * rvy * this.latency,
    };
  }

  // A barrel is rolling down on us: move sideways into the free lane quickly instead of drifting
  // there at the leisurely pace of "toward the target".
  swerve() {
    const sim = this.sim;
    const loc = sim.course.locate(sim.x, sim.y, sim.hint);
    const lat = this.lateral();
    const forward = Math.min(this.aim.limit, 60);
    // Fast while far from the lane, easing off early enough to be able to stop on it.
    const gap = this.lane - lat;
    const sideways = Math.sign(gap) * Math.min(85, Math.sqrt(2 * 26 * Math.max(0, Math.abs(gap) - 6)));
    const vx = loc.tx * forward + -loc.ty * sideways;
    const vy = loc.ty * forward + loc.tx * sideways;
    const mag = Math.hypot(vx, vy) || 1;
    this.aim = { ux: vx / mag, uy: vy / mag, limit: mag, relX: vx, relY: vy };
  }

  decide() {
    const sim = this.sim;
    const crossing = this.planCrossings();
    const target = this.pickTarget();
    const dx = target.x - sim.x;
    const dy = target.y - sim.y;
    const dist = Math.hypot(dx, dy) || 1;
    const limit = Math.min(this.speedLimit(), crossing.limit);
    const ux = dx / dist;
    const uy = dy / dist;
    // Holding for a barrel means standing still relative to the bank, not relative to the water.
    this.hold = crossing.hold;
    this.aim = this.hold
      ? { ux, uy, limit: 0, relX: -sim.flowX, relY: -sim.flowY }
      : { ux, uy, limit, relX: ux * limit, relY: uy * limit };
    if (this.bands.length && !this.hold) this.swerve();
    const base = this.baseError();
    const pend = this.pending();
    const ex = base.x - pend.x;
    const ey = base.y - pend.y;
    const idle = [];
    sim.seats.forEach((seat, i) => {
      if (!this.plans[i] && sim.seats[i].chargeStart < 0) idle.push(i);
    });
    const errMag = Math.hypot(ex, ey);
    // Seats not about to fire wait where the next push will most likely be needed.
    const aimX = errMag > 8 ? ex : this.aim.ux;
    const aimY = errMag > 8 ? ey : this.aim.uy;
    for (const i of idle) sim.setStick(i, this.station(i, aimX, aimY).world, 1);
    if (errMag < 8) return;
    // Least squares over the idle seats: p_i in [0,1] so that the blasts add up to the error.
    const info = idle.map((i) => {
      const st = this.station(i, ex, ey);
      const c = this.capacity(i);
      const hot = sim.seats[i].heat > 0.9 ? 0 : 1;
      return { i, st, cap: c.cap * hot };
    });
    const p = info.map(() => 0);
    for (let pass = 0; pass < 8; pass++) {
      info.forEach((a, k) => {
        if (a.cap <= 0) return;
        let rx = ex;
        let ry = ey;
        info.forEach((b, j) => {
          if (j === k) return;
          rx -= b.st.ux * p[j] * b.cap;
          ry -= b.st.uy * p[j] * b.cap;
        });
        p[k] = clamp((rx * a.st.ux + ry * a.st.uy) / a.cap, 0, 1);
      });
    }
    info.forEach((a, k) => {
      const power = p[k];
      if (power < Math.max(FART.minPower, 0.14)) return;
      const hold = power * FART.chargeSeconds;
      const walk = this.walkTime(a.i, a.st.rel);
      // Start charging when the walk will be done by the time the charge is.
      if (walk > hold + 0.08) return;
      sim.startCharge(a.i);
      this.plans[a.i] = { power, cap: a.cap, ux: a.st.ux, uy: a.st.uy, stand: a.st.world };
      sim.setStick(a.i, a.st.world, 1);
    });
  }

  releaseDue() {
    const sim = this.sim;
    this.plans.forEach((plan, i) => {
      if (!plan) return;
      const seat = sim.seats[i];
      if (seat.chargeStart < 0) {
        this.plans[i] = null;
        return;
      }
      sim.setStick(i, plan.stand, 1);
      const held = clamp((sim.time - seat.chargeStart) / FART.chargeSeconds, 0, 1);
      const rel = clampToSector(wrapAngle(plan.stand - sim.a), sim.layout[i]);
      const ready = Math.abs(wrapAngle(rel - seat.pos)) < 0.22;
      // How much is still wanted from this seat, given everything else that is in the air.
      const rest = this.pendingForSeat(i);
      const wanted = clamp(rest / plan.cap, 0, 1);
      const enough = held >= Math.max(FART.minPower, wanted - 0.03);
      const waited = sim.time - seat.chargeStart > FART.chargeSeconds + 0.5;
      if ((enough && ready) || held >= 1 || waited) {
        sim.release(i);
        this.plans[i] = null;
      }
    });
  }

  // Velocity this seat should still add along its own push direction (the error without it).
  pendingForSeat(seat) {
    const plan = this.plans[seat];
    const base = this.baseError();
    const pend = this.pending(seat);
    return (base.x - pend.x) * plan.ux + (base.y - pend.y) * plan.uy;
  }

  step() {
    const sim = this.sim;
    if (sim.status === 'running') {
      if (sim.time >= this.nextDecision) {
        this.decide();
        this.nextDecision = sim.time + this.interval;
      }
      this.releaseDue();
    } else {
      this.plans.fill(null);
    }
    sim.step();
    return DT;
  }
}

export function runAutopilot(sim, maxSeconds = 400, options) {
  const pilot = new Autopilot(sim, options);
  while (sim.status !== 'finished' && sim.time < maxSeconds) pilot.step();
  return { finished: sim.status === 'finished', time: sim.time, sinks: sim.sinks, bumps: sim.bumps };
}
