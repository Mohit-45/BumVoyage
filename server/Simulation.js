import { DT, BOAT, FART, sectorLayout, wrapAngle, clampToSector } from '../public/shared/config.js';
import { HAZARD } from '../public/shared/course.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, digits) => {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
};
// Shortest time between two thud events (a thud is a sound and a splash on every client).
const THUD_GAP = 0.15;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Simulation {
  constructor(course, seatCount) {
    this.course = course;
    this.layout = sectorLayout(seatCount);
    this.powerScale = seatCount === 1 ? FART.soloScale : 1;
    this.seats = this.layout.map((l) => ({
      pos: l.center,
      stickAng: 0,
      stickMag: 0,
      chargeStart: -1,
      gas: FART.gasMax,
      heat: 0,
    }));
    this.bursts = [];
    this.events = [];
    this.time = 0;
    this.hull = BOAT.maxHull;
    this.invuln = 0;
    this.lastThud = -1;
    this.shoved = false;
    this.wasShoved = false;
    this.status = 'running';
    this.sunkTimer = 0;
    this.checkpoint = -1;
    this.sinks = 0;
    this.bumps = 0;
    this.hint = -1;
    this.flowX = 0;
    this.flowY = 0;
    this.tx = 1;
    this.ty = 0;
    this.progress = 0;
    this.prevProgress = 0;
    this.stuckFor = 0;
    this.contactX = 0;
    this.contactY = 0;
    this.trapTimer = 0;
    this.liveRollers = new Set();
    this.dudRollers = new Set();
    this.placeAt(course.startS);
  }

  placeAt(s) {
    const pose = this.course.poseAtS(s);
    this.x = pose.x;
    this.y = pose.y;
    this.a = pose.a;
    this.vx = 0;
    this.vy = 0;
    this.w = 0;
    this.bursts = [];
    this.hint = pose.index;
    this.locate();
    this.prevProgress = this.progress;
  }

  locate() {
    const loc = this.course.locate(this.x, this.y, this.hint);
    this.hint = loc.index;
    this.progress = loc.s;
    this.tx = loc.tx;
    this.ty = loc.ty;
    this.flowX = loc.tx * this.course.flow;
    this.flowY = loc.ty * this.course.flow;
    return loc;
  }

  setStick(seat, angle, magnitude) {
    const s = this.seats[seat];
    if (!s) return;
    s.stickAng = wrapAngle(angle);
    s.stickMag = clamp(magnitude, 0, 1);
  }

  startCharge(seat) {
    const s = this.seats[seat];
    if (s && s.chargeStart < 0 && this.status === 'running') s.chargeStart = this.time;
  }

  clearCharge(seat) {
    if (this.seats[seat]) this.seats[seat].chargeStart = -1;
  }

  soreFactor(seat) {
    const heat = this.seats[seat].heat;
    return 1 - FART.soreWeakening * smoothstep(FART.soreStart, 1, heat);
  }

  release(seat) {
    const s = this.seats[seat];
    if (!s || s.chargeStart < 0) return;
    const held = this.time - s.chargeStart;
    s.chargeStart = -1;
    if (this.status !== 'running') return;
    let power = clamp(held / FART.chargeSeconds, FART.minPower, 1);
    if (s.gas < FART.gasBase + FART.gasPerPower * power) {
      power = (s.gas - FART.gasBase) / FART.gasPerPower;
      if (power < FART.minPower) {
        this.events.push({ k: 'fizzle', seat });
        return;
      }
    }
    s.gas -= FART.gasBase + FART.gasPerPower * power;
    const sore = this.soreFactor(seat);
    s.heat = Math.min(1, s.heat + FART.heatBase + FART.heatPerPower * power);
    const angle = s.pos + this.a;
    this.bursts.push({
      seat,
      ux: Math.cos(angle),
      uy: Math.sin(angle),
      impulse: FART.maxImpulse * power * this.powerScale * sore,
      duration: FART.burstBase + FART.burstExtra * power,
      age: 0,
    });
    this.events.push({ k: 'burst', seat, p: round(power, 2), ang: round(angle, 3), heat: round(s.heat, 2) });
  }

  step() {
    if (this.status === 'finished') return;
    this.time += DT;
    for (const s of this.seats) {
      s.gas = Math.min(FART.gasMax, s.gas + FART.gasRegen * DT);
      s.heat = Math.max(0, s.heat - FART.heatDecay * DT);
    }
    if (this.status === 'sunk') {
      this.sunkTimer -= DT;
      if (this.sunkTimer <= 0) this.respawn();
      return;
    }
    this.invuln = Math.max(0, this.invuln - DT);
    this.walk();
    this.integrate();
    this.contactX = 0;
    this.contactY = 0;
    this.wasShoved = this.shoved;
    this.shoved = false;
    this.collide();
    this.freeIfStuck();
    this.track();
  }

  walk() {
    this.seats.forEach((s, i) => {
      if (s.stickMag < FART.stickDeadzone) return;
      const sector = this.layout[i];
      const target = clampToSector(wrapAngle(s.stickAng - this.a), sector);
      const delta = wrapAngle(target - s.pos);
      const stepSize = FART.walkSpeed * DT;
      s.pos = wrapAngle(s.pos + clamp(delta, -stepSize, stepSize));
    });
  }

  integrate() {
    let ax = 0;
    let ay = 0;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      const mag = ((2 * b.impulse) / b.duration) * (1 - b.age / b.duration);
      ax -= b.ux * mag;
      ay -= b.uy * mag;
      b.age += DT;
      if (b.age >= b.duration) this.bursts.splice(i, 1);
    }
    const rvx = this.vx - this.flowX;
    const rvy = this.vy - this.flowY;
    const dragK = BOAT.drag + BOAT.dragQuad * Math.hypot(rvx, rvy);
    ax -= dragK * rvx;
    ay -= dragK * rvy;
    for (const c of this.course.currents) {
      const d = Math.hypot(this.x - c.x, this.y - c.y);
      if (d < c.r) {
        const f = 1 - d / c.r;
        ax += c.ax * f;
        ay += c.ay * f;
      }
    }
    if (this.course.fallAt(this.progress)) {
      ax += this.tx * HAZARD.FALL_ACCEL;
      ay += this.ty * HAZARD.FALL_ACCEL;
    }
    let inCore = false;
    for (const whirl of this.course.whirlpools) {
      const st = this.course.whirlState(whirl, this.time);
      const dx = this.x - st.x;
      const dy = this.y - st.y;
      const d = Math.hypot(dx, dy);
      if (d >= whirl.r) continue;
      const f = 1 - d / whirl.r;
      const inv = 1 / Math.max(d, 1);
      const sign = whirl.dir;
      ax += -dy * inv * HAZARD.WHIRL_SWIRL * f * sign - dx * inv * HAZARD.WHIRL_PULL * f;
      ay += dx * inv * HAZARD.WHIRL_SWIRL * f * sign - dy * inv * HAZARD.WHIRL_PULL * f;
      this.addSpin(HAZARD.WHIRL_SPIN * f * sign * DT);
      if (d < whirl.core) {
        inCore = true;
        this.vx *= 1 - HAZARD.WHIRL_CORE_DRAG * DT;
        this.vy *= 1 - HAZARD.WHIRL_CORE_DRAG * DT;
      }
    }
    if (inCore) this.trapTimer += DT;
    else this.trapTimer = Math.max(0, this.trapTimer - 2 * DT);
    if (this.trapTimer > HAZARD.WHIRL_FLUSH_SECONDS) this.flush();
    this.vx += ax * DT;
    this.vy += ay * DT;
    this.w -= BOAT.angularDrag * this.w * DT;
    this.x += this.vx * DT;
    this.y += this.vy * DT;
    this.a = wrapAngle(this.a + this.w * DT);
  }

  addSpin(dw) {
    this.w = clamp(this.w + dw, -BOAT.maxSpin, BOAT.maxSpin);
  }

  flush() {
    this.trapTimer = 0;
    this.vx = this.tx * HAZARD.FLUSH_SPEED;
    this.vy = this.ty * HAZARD.FLUSH_SPEED;
    this.addSpin(HAZARD.FLUSH_SPIN);
    for (const seat of this.seats) seat.gas = Math.max(0, seat.gas - HAZARD.WHIRL_GAS_LOSS);
    this.events.push({ k: 'flush', x: round(this.x, 0), y: round(this.y, 0) });
    this.hurt(this.x, this.y, 'ouch');
  }

  collide() {
    const course = this.course;
    for (const rock of course.rocks) this.hitCircle(rock.x, rock.y, 0, 0, rock.r, BOAT.restitutionRock, false);
    for (const spike of course.spikes) this.hitCircle(spike.x, spike.y, 0, 0, spike.r, BOAT.restitutionHazard, true);
    for (const log of course.logs) {
      const st = course.logState(log, this.time);
      this.hitCircle(st.x, st.y, st.vx, st.vy, log.r, BOAT.restitutionRock, false);
    }
    for (const roller of course.rollers) {
      const st = course.rollerState(roller, this.time);
      if (!st.active) {
        this.liveRollers.delete(roller);
        this.dudRollers.delete(roller);
        continue;
      }
      const along = clamp((this.x - st.x) * st.ux + (this.y - st.y) * st.uy, -st.hl, st.hl);
      const cx = st.x + st.ux * along;
      const cy = st.y + st.uy * along;
      if (!this.liveRollers.has(roller)) {
        this.liveRollers.add(roller);
        // A barrel that pops up in front of the boat leaves no time to dodge, so on that run it is a
        // dud: still a solid barrel that shoves the boat (the client draws it solid), but harmless.
        if (st.mode === 'top' && Math.hypot(this.x - cx, this.y - cy) < HAZARD.ROLLER_SPAWN_SAFE) this.dudRollers.add(roller);
      }
      const dud = this.dudRollers.has(roller);
      this.hitCircle(cx, cy, st.vx, st.vy, st.r, BOAT.restitutionHazard, !dud, dud);
    }
    const loc = this.locate();
    const limit = loc.halfWidth - BOAT.radius;
    if (loc.dist > limit) {
      const nx = (this.x - loc.px) / loc.dist;
      const ny = (this.y - loc.py) / loc.dist;
      this.x = loc.px + nx * limit;
      this.y = loc.py + ny * limit;
      this.contactX -= nx;
      this.contactY -= ny;
      const vn = this.vx * nx + this.vy * ny;
      if (vn > 0) {
        const tvx = this.vx - vn * nx;
        const tvy = this.vy - vn * ny;
        // Friction drags the spin toward rolling along the bank (contact point at +radius * n), so a
        // boat that is pushed into a bank and slides along it settles instead of spinning up.
        this.addSpin(BOAT.spinFriction * (-nx * tvy + ny * tvx - BOAT.radius * this.w));
        this.vx -= (1 + BOAT.restitutionBank) * vn * nx;
        this.vy -= (1 + BOAT.restitutionBank) * vn * ny;
        const side = Math.sign((this.x - loc.px) * -loc.ty + (this.y - loc.py) * loc.tx);
        const spiked = this.course.wallAt(loc.s, side);
        this.impact(vn, loc.px + nx * loc.halfWidth, loc.py + ny * loc.halfWidth, spiked, spiked ? 'spiked' : 'bump');
      } else if (this.course.wallAt(loc.s, Math.sign((this.x - loc.px) * -loc.ty + (this.y - loc.py) * loc.tx)) && this.invuln <= 0) {
        this.impact(BOAT.bumpSpeed, loc.px + nx * loc.halfWidth, loc.py + ny * loc.halfWidth, true, 'spiked');
      }
    }
  }

  // A `soft` obstacle is solid, so the boat is held out of its body, but it neither hurts nor
  // takes any of the boat's momentum.
  hitCircle(ox, oy, ovx, ovy, or, restitution, harm, soft = false) {
    const dx = this.x - ox;
    const dy = this.y - oy;
    const min = BOAT.radius + or;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 0.0001;
    const nx = dx / d;
    const ny = dy / d;
    this.x = ox + nx * min;
    this.y = oy + ny * min;
    const rvx = this.vx - ovx;
    const rvy = this.vy - ovy;
    const rvn = rvx * nx + rvy * ny;
    if (soft) {
      // One thud when the barrel first meets the boat, not for every tick it keeps pushing it along.
      if (rvn < 0 && !this.wasShoved) this.thud(-rvn, ox + nx * or, oy + ny * or);
      this.shoved = true;
      return;
    }
    this.contactX += nx;
    this.contactY += ny;
    if (rvn < 0) {
      const tvx = rvx - rvn * nx;
      const tvy = rvy - rvn * ny;
      // Same for an obstacle: the contact point sits at -radius * n.
      this.addSpin(BOAT.spinFriction * (nx * tvy - ny * tvx - BOAT.radius * this.w));
      this.vx -= (1 + restitution) * rvn * nx;
      this.vy -= (1 + restitution) * rvn * ny;
      this.impact(-rvn, ox + nx * or, oy + ny * or, harm);
    } else if (harm && this.invuln <= 0) {
      this.impact(BOAT.bumpSpeed, ox + nx * or, oy + ny * or, true);
    }
  }

  // A barrel squeezing the boat against a bank closes in on every tick, so thuds are rate limited.
  thud(speed, x, y) {
    if (speed <= 30 || this.time - this.lastThud <= THUD_GAP) return;
    this.lastThud = this.time;
    this.events.push({ k: 'thud', x: round(x, 0), y: round(y, 0) });
  }

  impact(speed, x, y, harm, kind = 'bump') {
    if ((speed < BOAT.bumpSpeed && !harm) || this.invuln > 0) {
      this.thud(speed, x, y);
      return;
    }
    this.hurt(x, y, harm ? (kind === 'spiked' ? 'spiked' : 'ouch') : 'bump', speed);
  }

  hurt(x, y, kind, speed = 160) {
    if (this.invuln > 0 && kind !== 'ouch') return;
    this.hull -= 1;
    this.bumps += 1;
    this.invuln = BOAT.invulnSeconds;
    this.events.push({ k: kind, x: round(x, 0), y: round(y, 0), sev: round(clamp(speed / 220, 0.3, 1), 2) });
    if (this.hull <= 0) this.sink();
  }

  sink() {
    this.status = 'sunk';
    this.sunkTimer = BOAT.respawnDelay;
    this.sinks += 1;
    this.bursts = [];
    for (const s of this.seats) s.chargeStart = -1;
    this.events.push({ k: 'sunk', x: round(this.x, 0), y: round(this.y, 0) });
  }

  respawn() {
    const cps = this.course.checkpoints;
    const s = this.checkpoint >= 0 ? cps[this.checkpoint] : this.course.startS;
    this.placeAt(s);
    this.hull = BOAT.maxHull;
    this.invuln = 1.5;
    this.status = 'running';
    // Barrels went on rolling while the boat was sunk and collide() did not run, so forget which
    // were live or duds: every barrel still rolling gets judged afresh against the new position.
    this.liveRollers.clear();
    this.dudRollers.clear();
    this.shoved = false;
    for (const seat of this.seats) {
      seat.gas = FART.gasMax;
      seat.heat = 0;
    }
    this.events.push({ k: 'respawn' });
  }

  freeIfStuck() {
    const touching = this.contactX !== 0 || this.contactY !== 0;
    if (touching && Math.hypot(this.vx, this.vy) < 20) this.stuckFor += DT;
    else this.stuckFor = Math.max(0, this.stuckFor - DT * 2);
    if (this.stuckFor < BOAT.stuckSeconds) return;
    const len = Math.hypot(this.contactX, this.contactY) || 1;
    this.vx += (this.contactX / len) * BOAT.nudgeSpeed;
    this.vy += (this.contactY / len) * BOAT.nudgeSpeed;
    this.stuckFor = 0;
    this.invuln = Math.max(this.invuln, 0.8);
    this.events.push({ k: 'nudge', x: round(this.x, 0), y: round(this.y, 0) });
  }

  track() {
    const course = this.course;
    for (const f of course.falls) {
      const end = f.s0 + f.len;
      if (this.prevProgress < f.s0 && this.progress >= f.s0) this.events.push({ k: 'dropin' });
      if (this.prevProgress < end && this.progress >= end) {
        for (const s of this.seats) s.gas = Math.max(0, s.gas - FART.plungeGasLoss);
        this.events.push({ k: 'plunge', x: round(this.x, 0), y: round(this.y, 0) });
      }
    }
    this.prevProgress = this.progress;
    const next = this.checkpoint + 1;
    if (next < course.checkpoints.length && this.progress >= course.checkpoints[next]) {
      this.checkpoint = next;
      this.events.push({ k: 'cp', i: next });
    }
    if (this.progress >= course.finishS) {
      this.status = 'finished';
      this.events.push({ k: 'finish' });
    }
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  stars() {
    const par = this.course.parTime;
    if (this.sinks === 0 && this.bumps <= 3 && this.time <= par) return 3;
    if (this.sinks <= 1 && this.time <= par * 1.6) return 2;
    return 1;
  }

  snapshot() {
    return {
      t: 's',
      T: round(this.time, 3),
      x: round(this.x, 1),
      y: round(this.y, 1),
      a: round(this.a, 3),
      w: round(this.w, 2),
      vx: round(this.vx, 1),
      vy: round(this.vy, 1),
      hull: this.hull,
      st: this.status,
      pos: this.seats.map((s) => round(s.pos, 3)),
      gas: this.seats.map((s) => Math.round(s.gas)),
      heat: this.seats.map((s) => round(s.heat, 2)),
      ch: this.seats.map((s) =>
        s.chargeStart < 0 ? 0 : round(Math.min(1, (this.time - s.chargeStart) / FART.chargeSeconds), 2),
      ),
      p: Math.round(this.progress),
      cp: this.checkpoint,
      inv: this.invuln > 0,
    };
  }
}
