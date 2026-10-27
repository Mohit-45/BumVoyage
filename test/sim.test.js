import test from 'node:test';
import assert from 'node:assert/strict';
import { Course } from '../public/shared/course.js';
import { LEVELS } from '../public/shared/levels.js';
import { DT, BOAT, FART, sectorLayout, wrapAngle } from '../public/shared/config.js';
import { Simulation } from '../server/Simulation.js';
import { Autopilot, calmCourse, runAutopilot } from './autopilot.js';

const course = (i) => new Course(LEVELS[i]);

function stepFor(sim, seconds) {
  for (let t = 0; t < seconds; t += DT) sim.step();
}

function blast(sim, seat, holdSeconds) {
  sim.startCharge(seat);
  stepFor(sim, holdSeconds);
  sim.release(seat);
}

function walkTo(sim, seat, worldAngle) {
  sim.setStick(seat, worldAngle, 1);
  stepFor(sim, 1.2);
}

const BURST_TIME = FART.burstBase + FART.burstExtra + 0.05;
const waterSpeed = (sim) => Math.hypot(sim.vx - sim.flowX, sim.vy - sim.flowY);

// A two-seat boat floating with the current on a straight, empty river.
function calmBoat() {
  const sim = new Simulation(calmCourse(), 2);
  sim.vx = sim.flowX;
  sim.vy = sim.flowY;
  return sim;
}

// Seat 0 stands at the stern and blasts the boat forward at full power; returns the speed it reached.
function fullBlastForward(sim) {
  walkTo(sim, 0, sim.a + Math.PI);
  blast(sim, 0, FART.chargeSeconds);
  stepFor(sim, BURST_TIME);
  return waterSpeed(sim);
}

test('courses are deterministic and every level has its signature hazard', () => {
  assert.deepEqual(course(2).rollers, course(2).rollers);
  assert.ok(course(1).spikeFields.length > 0, 'Spiky Shallows has spikes');
  assert.ok(course(2).rollers.some((r) => r.mode === 'side'), 'Roller Creek has side rollers');
  assert.ok(course(2).rollers.some((r) => r.mode === 'top'), 'Roller Creek has rollers from ahead');
  assert.ok(course(3).whirlpools.length > 0, 'Whirlpool Wobble has whirlpools');
  assert.ok(course(4).falls.length > 0, 'Big Drop Falls has waterfalls');
  assert.ok(course(1).walls.length > 0, 'Spiky Shallows has spiked rails');
});

test('rivers wind around without ever crossing themselves', () => {
  for (const def of LEVELS) {
    const c = new Course(def);
    const pts = c.points;
    let turned = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
      const b = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
      turned += Math.abs(wrapAngle(b - a));
      assert.ok(pts[i].w >= 76, `${def.name}: river is narrower than the boat can handle at ${i}`);
    }
    assert.ok(turned > 2.5, `${def.name} should have real bends (turned ${turned.toFixed(1)} rad)`);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 16; j < pts.length; j++) {
        const gap = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) - pts[i].w - pts[j].w;
        assert.ok(gap > 0, `${def.name}: river folds back on itself near ${i} and ${j}`);
      }
    }
  }
});

test('rocks and spikes never block the whole river', () => {
  for (const def of LEVELS) {
    const c = new Course(def);
    for (const r of c.rocks) {
      const p = c.locate(r.x, r.y);
      assert.ok(p.halfWidth + p.dist - r.r >= def.clearance - 6, `${def.name}: rock at s=${r.s} leaves too little room`);
    }
    for (const f of c.spikeFields) {
      const p = c.locate(f.x, f.y);
      assert.ok(p.halfWidth + p.dist - f.r >= def.clearance - 6, `${def.name}: spikes at s=${f.s} leave too little room`);
    }
    for (const r of c.rollers.filter((x) => x.mode === 'top')) {
      // The barrel runs down the river toward the boat, so check the narrowest stretch it covers.
      let minW = Infinity;
      for (let along = 40; along <= r.travel + 40; along += 30) minW = Math.min(minW, c.pointAtS(r.s + along).w);
      assert.ok(r.laneMin <= r.lane + 1e-9, `${def.name}: roller at s=${r.s} has no lane to pick`);
      const wideSide = minW + r.laneMin - r.hl - r.r;
      assert.ok(wideSide >= BOAT.radius * 2 + 24, `${def.name}: roller at s=${r.s} leaves only ${wideSide.toFixed(0)} px beside it`);
    }
  }
});

test('the boat is split into equal parts for 1 to 4 players', () => {
  for (const n of [1, 2, 3, 4]) {
    const layout = sectorLayout(n);
    assert.equal(layout.length, n);
    const total = layout.reduce((sum, s) => sum + s.half * 2, 0);
    assert.ok(Math.abs(total - Math.PI * 2) < 1e-9, `${n} players should cover 360 degrees`);
    assert.equal(layout[0].percent, Math.round(100 / n));
  }
});

test('an animal cannot leave its own part of the boat', () => {
  const sim = new Simulation(course(0), 2);
  const [left, right] = sim.layout;
  walkTo(sim, 0, sim.a + Math.PI / 2);
  const offset = wrapAngle(sim.seats[0].pos - left.center);
  assert.ok(Math.abs(offset) <= left.half + 1e-6, 'left player stays on the left half');
  assert.ok(Math.abs(wrapAngle(sim.seats[0].pos - right.center)) > right.half - 0.05);
});

test('a single animal can walk all the way around the boat', () => {
  const sim = new Simulation(course(0), 1);
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    walkTo(sim, 0, sim.a + angle);
    assert.ok(Math.abs(wrapAngle(sim.seats[0].pos - angle)) < 0.05, `reached ${angle}`);
  }
});

test('standing at the back and blasting pushes the boat forward', () => {
  const sim = new Simulation(course(0), 1);
  const start = sim.progress;
  walkTo(sim, 0, sim.a + Math.PI);
  blast(sim, 0, 0.6);
  stepFor(sim, 2);
  assert.ok(sim.progress > start + 60, `progress only moved ${sim.progress - start}`);
});

test('standing on the left pushes the boat right and standing on the right pushes it left', () => {
  const lateral = (s) => {
    const loc = s.course.locate(s.x, s.y, s.hint);
    return (s.x - loc.px) * loc.ty * -1 + (s.y - loc.py) * loc.tx;
  };
  const a = new Simulation(course(0), 1);
  walkTo(a, 0, a.a - Math.PI / 2);
  blast(a, 0, 0.5);
  stepFor(a, 1.5);
  const b = new Simulation(course(0), 1);
  walkTo(b, 0, b.a + Math.PI / 2);
  blast(b, 0, 0.5);
  stepFor(b, 1.5);
  assert.ok(lateral(a) * lateral(b) < 0, 'opposite sides must push opposite ways');
});

test('a blast spends gas, gas refills, and an empty tank fizzles', () => {
  const sim = new Simulation(course(0), 2);
  blast(sim, 0, FART.chargeSeconds);
  const spent = sim.seats[0].gas;
  assert.ok(spent <= FART.gasMax - FART.gasBase - FART.gasPerPower + 1);
  stepFor(sim, 1);
  assert.ok(sim.seats[0].gas > spent);
  sim.drainEvents();
  sim.seats[1].gas = 0;
  sim.startCharge(1);
  sim.release(1);
  assert.ok(sim.drainEvents().some((e) => e.k === 'fizzle'));
});

test('too much farting makes the bum red and the blasts weaker', () => {
  const sim = new Simulation(course(0), 2);
  const fresh = sim.soreFactor(0);
  assert.equal(fresh, 1);
  for (let i = 0; i < 8; i++) {
    sim.seats[0].gas = FART.gasMax;
    blast(sim, 0, FART.chargeSeconds);
  }
  assert.ok(sim.seats[0].heat > FART.soreStart, `heat ${sim.seats[0].heat}`);
  assert.ok(sim.soreFactor(0) < 0.95, 'sore bum weakens the blast');
  const hot = sim.seats[0].heat;
  stepFor(sim, 5);
  assert.ok(sim.seats[0].heat < hot, 'heat cools down');
  assert.equal(sim.seats[1].heat, 0, 'only the farter heats up');
});

test('hard hits crack the hull, sink the boat, and respawn it at the last flag', () => {
  const sim = new Simulation(course(0), 2);
  const loc = sim.course.locate(sim.x, sim.y, sim.hint);
  const driveIntoBank = () => {
    const nx = -loc.ty;
    const ny = loc.tx;
    sim.x = loc.px + nx * (loc.halfWidth - BOAT.radius - 2);
    sim.y = loc.py + ny * (loc.halfWidth - BOAT.radius - 2);
    sim.vx = nx * 220;
    sim.vy = ny * 220;
    sim.step();
  };
  driveIntoBank();
  assert.equal(sim.hull, BOAT.maxHull - 1);
  sim.invuln = 0;
  sim.hull = 1;
  driveIntoBank();
  assert.equal(sim.status, 'sunk');
  assert.equal(sim.sinks, 1);
  stepFor(sim, BOAT.respawnDelay + 0.1);
  assert.equal(sim.status, 'running');
  assert.equal(sim.hull, BOAT.maxHull);
});

test('a gentle bump is free but spikes always hurt', () => {
  const sim = new Simulation(course(1), 2);
  const loc = sim.course.locate(sim.x, sim.y, sim.hint);
  sim.x = loc.px - loc.ty * (loc.halfWidth - BOAT.radius + 1);
  sim.y = loc.py + loc.tx * (loc.halfWidth - BOAT.radius + 1);
  sim.vx = -loc.ty * 30;
  sim.vy = loc.tx * 30;
  sim.step();
  assert.equal(sim.hull, BOAT.maxHull);

  const spiky = new Simulation(course(1), 2);
  const spike = spiky.course.spikes[0];
  spiky.x = spike.x + BOAT.radius + spike.r - 1;
  spiky.y = spike.y;
  spiky.vx = -5;
  spiky.vy = 0;
  spiky.step();
  assert.equal(spiky.hull, BOAT.maxHull - 1);
  assert.ok(spiky.drainEvents().some((e) => e.k === 'ouch'));
});

test('a spike roller crushes a boat in its path', () => {
  const c = course(2);
  const roller = c.rollers.find((r) => r.mode === 'side');
  const sim = new Simulation(c, 2);
  let found = null;
  for (let t = 0; t < roller.period * 3 && !found; t += 0.1) {
    const st = c.rollerState(roller, t);
    if (st.active && Math.abs(st.x - roller.cx) < 60) found = { t, st };
  }
  assert.ok(found, 'roller crosses the river');
  sim.time = found.t;
  sim.x = found.st.x;
  sim.y = found.st.y;
  sim.hint = -1;
  sim.step();
  assert.ok(sim.hull < BOAT.maxHull, 'roller hurt the boat');
});

test('a whirlpool spins the boat, and sitting in its core gets you flushed', () => {
  const c = course(3);
  const whirl = c.whirlpools[0];
  const sim = new Simulation(c, 2);
  const st = c.whirlState(whirl, 0);
  sim.x = st.x + 50;
  sim.y = st.y;
  sim.hint = -1;
  stepFor(sim, 0.8);
  assert.ok(Math.abs(sim.w) > 0.4, `spin ${sim.w}`);
  const core = new Simulation(c, 2);
  core.time = 0;
  core.x = st.x;
  core.y = st.y;
  core.hint = -1;
  const before = core.hull;
  let flushed = false;
  for (let t = 0; t < 4 && !flushed; t += DT) {
    core.x = c.whirlState(whirl, core.time).x;
    core.y = c.whirlState(whirl, core.time).y;
    core.vx = 0;
    core.vy = 0;
    core.step();
    flushed = core.events.some((e) => e.k === 'flush');
  }
  assert.ok(flushed, 'the whirlpool should flush a boat stuck in its core');
  assert.ok(core.hull < before, 'being flushed costs a hull point');
});

test('touching a spiked rail hurts even when drifting slowly', () => {
  const c = course(1);
  const wall = c.walls[0];
  const sim = new Simulation(c, 2);
  sim.placeAt((wall.s0 + wall.s1) / 2);
  const loc = c.locate(sim.x, sim.y, sim.hint);
  const sign = wall.side;
  const nx = -loc.ty * sign;
  const ny = loc.tx * sign;
  sim.x = loc.px + nx * (loc.halfWidth - BOAT.radius + 1);
  sim.y = loc.py + ny * (loc.halfWidth - BOAT.radius + 1);
  sim.vx = nx * 12;
  sim.vy = ny * 12;
  sim.step();
  assert.equal(sim.hull, BOAT.maxHull - 1);
  assert.ok(sim.drainEvents().some((e) => e.k === 'spiked'));
  const plain = new Simulation(c, 2);
  plain.placeAt(c.startS + 40);
  const l2 = c.locate(plain.x, plain.y, plain.hint);
  plain.x = l2.px - l2.ty * (l2.halfWidth - BOAT.radius + 1);
  plain.y = l2.py + l2.tx * (l2.halfWidth - BOAT.radius + 1);
  plain.vx = -l2.ty * 12;
  plain.vy = l2.tx * 12;
  plain.step();
  assert.equal(plain.hull, BOAT.maxHull, 'a plain padded rail is harmless');
});

test('plunging down a waterfall rattles everyone’s gas tank', () => {
  const c = course(4);
  const fall = c.falls[0];
  const sim = new Simulation(c, 2);
  sim.placeAt(fall.s0 + fall.len - 8);
  sim.vx = sim.tx * 160;
  sim.vy = sim.ty * 160;
  stepFor(sim, 1);
  assert.ok(sim.seats.every((s) => s.gas < FART.gasMax - 10), 'gas dropped for everybody');
});

test('a full blast changes the boat speed by roughly 70 to 100 px/s', () => {
  const sim = calmBoat();
  const speed = fullBlastForward(sim);
  assert.ok(speed > 65 && speed < 105, `a full blast gave ${speed.toFixed(0)} px/s`);
});

test('the boat keeps gliding after a blast, nothing brakes it for free', () => {
  const sim = calmBoat();
  const start = { x: sim.x, y: sim.y };
  const peak = fullBlastForward(sim);
  stepFor(sim, 1.5);
  const later = waterSpeed(sim);
  assert.ok(later > 0.6 * peak, `speed fell from ${peak.toFixed(0)} to ${later.toFixed(0)} px/s in 1.5 s with nobody braking`);
  stepFor(sim, 5);
  assert.ok(waterSpeed(sim) > 0.25 * peak, 'still sliding six seconds after the blast');
  const glided = Math.hypot(sim.x - start.x, sim.y - start.y);
  assert.ok(glided > 350, `glided only ${glided.toFixed(0)} px`);
  assert.ok(BOAT.drag <= 0.25, 'water drag must stay small or the boat brakes by itself');
});

test('a gliding boat is only stopped by counter-farting from the opposite side', () => {
  const sim = calmBoat();
  walkTo(sim, 0, sim.a + Math.PI);
  walkTo(sim, 1, sim.a);
  sim.startCharge(0);
  stepFor(sim, 0.8);
  sim.startCharge(1);
  stepFor(sim, FART.chargeSeconds - 0.8);
  sim.release(0);
  stepFor(sim, 0.8);
  const peak = waterSpeed(sim);
  assert.ok(peak > 55, `the first blast got the boat moving (${peak.toFixed(0)} px/s)`);
  sim.release(1);
  stepFor(sim, BURST_TIME);
  const residual = waterSpeed(sim);
  assert.ok(residual < 0.3 * peak, `a counter blast should remove most of the motion (${residual.toFixed(0)} of ${peak.toFixed(0)} px/s left)`);
});

test('two or three blasts build real speed, and the top speed stays bounded', () => {
  const sim = calmBoat();
  walkTo(sim, 0, sim.a + Math.PI);
  walkTo(sim, 1, sim.a + Math.PI);
  sim.startCharge(0);
  sim.startCharge(1);
  stepFor(sim, FART.chargeSeconds);
  sim.release(0);
  sim.release(1);
  stepFor(sim, BURST_TIME);
  const two = waterSpeed(sim);
  assert.ok(two > 110, `two seats together reached only ${two.toFixed(0)} px/s`);
  let top = two;
  for (let k = 0; k < 40; k++) {
    sim.seats.forEach((s, i) => {
      s.gas = FART.gasMax;
      sim.startCharge(i);
    });
    for (let t = 0; t < FART.chargeSeconds; t += DT) {
      sim.step();
      top = Math.max(top, waterSpeed(sim));
    }
    sim.release(0);
    sim.release(1);
  }
  assert.ok(top < 380, `blasting forever reached ${top.toFixed(0)} px/s`);
  assert.ok(top > 250, `top speed is too slow to be fun (${top.toFixed(0)} px/s)`);
});

test('the boat bounces off a bank and keeps spinning for a while', () => {
  const sim = new Simulation(course(0), 2);
  const loc = sim.course.locate(sim.x, sim.y, sim.hint);
  const nx = -loc.ty;
  const ny = loc.tx;
  sim.x = loc.px + nx * (loc.halfWidth - BOAT.radius - 1);
  sim.y = loc.py + ny * (loc.halfWidth - BOAT.radius - 1);
  sim.vx = nx * 90 + loc.tx * 90;
  sim.vy = ny * 90 + loc.ty * 90;
  sim.step();
  assert.ok(sim.vx * nx + sim.vy * ny < -20, 'the bank throws the boat back toward the river');
  assert.ok(sim.hull === BOAT.maxHull, 'a glancing bump is free');
  const spin = Math.abs(sim.w);
  assert.ok(spin > 0.3, `the scrape starts a spin (${spin.toFixed(2)} rad/s)`);
  stepFor(sim, 1.5);
  assert.ok(Math.abs(sim.w) > 0.4 * spin, 'the spin lasts a while');
  stepFor(sim, 10);
  assert.ok(Math.abs(sim.w) < 0.1 * spin, 'but not forever');
});

test('pressed into a bank while sliding along it, the boat settles into a roll instead of spinning up', () => {
  for (const [push, speed] of [[42, 100], [42, 60], [20, 100]]) {
    const c = calmCourse();
    c.points.forEach((p) => {
      p.w = 100;
    });
    const sim = new Simulation(c, 2);
    sim.placeAt(600);
    const loc = c.locate(sim.x, sim.y, sim.hint);
    const nx = -loc.ty;
    const ny = loc.tx;
    sim.x = loc.px + nx * (loc.halfWidth - BOAT.radius - 3);
    sim.y = loc.py + ny * (loc.halfWidth - BOAT.radius - 3);
    sim.vx = loc.tx * speed;
    sim.vy = loc.ty * speed;
    sim.invuln = 1e6;
    // A steady side current, like the generator's 'side' current, shoving the boat into the bank.
    c.currents = [{ x: sim.x, y: sim.y, r: 1e5, ax: nx * push, ay: ny * push, s: 600 }];
    let spin = 0;
    for (let t = 0; t < 8; t += DT) {
      sim.step();
      spin = Math.max(spin, Math.abs(sim.w));
    }
    const now = c.locate(sim.x, sim.y, sim.hint);
    assert.ok(now.halfWidth - BOAT.radius - now.dist < 2, 'the boat stayed pressed against the bank');
    assert.ok(spin < 3, `${speed} px/s with a ${push} px/s^2 push spun the boat up to ${spin.toFixed(1)} rad/s`);
  }
});

test('the spin is capped however many impulses pile up', () => {
  const sim = new Simulation(course(0), 2);
  for (let i = 0; i < 100; i++) sim.addSpin(2);
  assert.equal(sim.w, BOAT.maxSpin);
  for (let i = 0; i < 200; i++) sim.addSpin(-2);
  assert.equal(sim.w, -BOAT.maxSpin);
  assert.ok(BOAT.maxSpin <= 8, 'the cap must stay low enough for the crew to keep aiming');
});

test('a boat squeezed against a bank thuds now and then, not once per tick', () => {
  const sim = new Simulation(course(0), 2);
  const loc = sim.course.locate(sim.x, sim.y, sim.hint);
  const nx = -loc.ty;
  const ny = loc.tx;
  sim.invuln = 100;
  sim.drainEvents();
  let thuds = 0;
  for (let t = 0; t < 60; t++) {
    sim.x = loc.px + nx * (loc.halfWidth - BOAT.radius - 1);
    sim.y = loc.py + ny * (loc.halfWidth - BOAT.radius - 1);
    sim.vx = nx * 120;
    sim.vy = ny * 120;
    sim.step();
    thuds += sim.drainEvents().filter((e) => e.k === 'thud').length;
  }
  assert.ok(thuds >= 4 && thuds <= 7, `${thuds} thuds in one second`);
});

test('respawn flags sit in open water, clear of rocks, urchins, whirlpools, falls and sweeping barrels', () => {
  for (const def of LEVELS) {
    const c = new Course(def);
    assert.equal(c.checkpoints.length, 3);
    assert.deepEqual(new Course(def).checkpoints, c.checkpoints, `${def.name}: flags must be deterministic`);
    c.checkpoints.forEach((s, k) => {
      const at = `${def.name} flag ${k + 1}`;
      assert.ok(s > c.startS + 200 && s < c.finishS - 200, `${at} is too close to the start or the finish`);
      if (k > 0) assert.ok(s - c.checkpoints[k - 1] > 500, `${at} is too close to the previous flag`);
      const p = c.pointAtS(s);
      for (const o of [...c.rocks, ...c.spikes]) {
        const gap = Math.hypot(o.x - p.x, o.y - p.y) - o.r - BOAT.radius;
        assert.ok(gap >= 50, `${at}: the respawned boat would sit ${gap.toFixed(0)} px from a rock or urchin`);
      }
      for (const w of c.whirlpools) assert.ok(Math.hypot(w.cx - p.x, w.cy - p.y) >= w.r + 50, `${at} is inside a whirlpool`);
      for (const f of c.falls) assert.ok(s < f.s0 - 150 || s > f.s0 + f.len + 150, `${at} is on a waterfall`);
      for (const l of c.logs) assert.ok(Math.abs(l.s - s) >= l.r + BOAT.radius + 50, `${at} is in a log's sweep`);
      for (const r of c.rollers.filter((x) => x.mode === 'side')) {
        assert.ok(Math.abs(r.s - s) >= r.hl + r.r + BOAT.radius + 50, `${at} is in a barrel's sweep`);
      }
    });
  }
});

// Roller Coaster Creek with only its first barrel from ahead on it. The barrel pops up with its
// centre `distance` px ahead of the idle boat, rolling straight at it.
function barrelScene(distance) {
  const c = course(2);
  const roller = c.rollers.find((r) => r.mode === 'top');
  for (const key of ['rocks', 'spikes', 'spikeFields', 'logs', 'currents', 'whirlpools', 'falls', 'walls']) c[key] = [];
  c.rollers = [roller];
  const sim = new Simulation(c, 2);
  const start = (Math.ceil(roller.phase) + 1 - roller.phase) * roller.period;
  const st = c.rollerState(roller, start + 0.02);
  const speed = Math.hypot(st.vx, st.vy);
  sim.time = start - DT;
  sim.x = st.x + (st.vx / speed) * distance;
  sim.y = st.y + (st.vy / speed) * distance;
  sim.hint = -1;
  sim.locate();
  sim.vx = sim.flowX;
  sim.vy = sim.flowY;
  sim.prevProgress = sim.progress;
  return { c, roller, sim };
}

function barrelGap(sim, roller) {
  const st = sim.course.rollerState(roller, sim.time);
  const along = Math.max(-st.hl, Math.min(st.hl, (sim.x - st.x) * st.ux + (sim.y - st.y) * st.uy));
  return Math.hypot(sim.x - (st.x + st.ux * along), sim.y - (st.y + st.uy * along)) - st.r - BOAT.radius;
}

test('a barrel that pops up right in front of the boat is solid and shoves it, but does no harm', () => {
  const { c, roller, sim } = barrelScene(150);
  const from = sim.progress;
  let closest = Infinity;
  let pushed = 0;
  let thuds = 0;
  for (let t = 0; t < 7; t += DT) {
    sim.step();
    thuds += sim.drainEvents().filter((e) => e.k === 'thud').length;
    if (c.rollerState(roller, sim.time).active) closest = Math.min(closest, barrelGap(sim, roller));
    pushed = Math.max(pushed, from - sim.progress);
  }
  assert.equal(sim.hull, BOAT.maxHull, 'a barrel nobody could dodge costs no hull');
  assert.ok(closest > -1, `the boat sank ${(-closest).toFixed(0)} px into the barrel: it has to look and act solid`);
  assert.ok(pushed > 100, `the barrel pushed the boat back only ${pushed.toFixed(0)} px`);
  assert.ok(thuds >= 1 && thuds <= 3, `${thuds} thuds for one barrel`);
});

test('a barrel that shows up far enough away is still a real hazard', () => {
  const { sim } = barrelScene(450);
  stepFor(sim, 7);
  assert.ok(sim.hull < BOAT.maxHull, 'an idle boat in the barrel’s path gets hurt');
});

test('after a sinking, every barrel still rolling is judged afresh against the respawned boat', () => {
  const { roller, sim } = barrelScene(150);
  stepFor(sim, 0.5);
  assert.ok(sim.liveRollers.has(roller) && sim.dudRollers.has(roller), 'the barrel was a dud');
  sim.sink();
  while (sim.status === 'sunk') sim.step();
  assert.equal(sim.liveRollers.size, 0);
  assert.equal(sim.dudRollers.size, 0);
});

test('the velocity autopilot brakes a boat that is going too fast', () => {
  const sim = new Simulation(course(0), 2);
  const pilot = new Autopilot(sim);
  sim.vx = sim.tx * 230;
  sim.vy = sim.ty * 230;
  const before = Math.hypot(sim.vx, sim.vy);
  for (let t = 0; t < 4; t += DT) pilot.step();
  assert.equal(sim.status, 'running');
  assert.ok(Math.hypot(sim.vx, sim.vy) < before * 0.7, 'the crew fired from the bow side to slow down');
});

test('a wild crew never makes the boat explode', () => {
  const sim = new Simulation(course(5), 4);
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let top = 0;
  for (let t = 0; t < 120; t += DT) {
    if (Math.floor(t / DT) % 20 === 0) {
      sim.seats.forEach((_, i) => {
        sim.setStick(i, rand() * Math.PI * 2 - Math.PI, 1);
        if (rand() < 0.5) sim.startCharge(i);
        else sim.release(i);
      });
    }
    sim.step();
    top = Math.max(top, Math.hypot(sim.vx, sim.vy));
    assert.ok(Number.isFinite(sim.x) && Number.isFinite(sim.vx) && Number.isFinite(sim.w), 'state stays finite');
  }
  assert.ok(top < 420, `top speed ${top.toFixed(0)} px/s`);
});

test('doing nothing never finishes a river', () => {
  const sim = new Simulation(course(0), 2);
  stepFor(sim, 200);
  assert.notEqual(sim.status, 'finished');
});

test('a smart crew can finish every river', () => {
  for (const [level, seats] of [[0, 1], [0, 3], [1, 2], [2, 4], [3, 2], [4, 4], [5, 1]]) {
    const result = runAutopilot(new Simulation(course(level), seats), 600);
    assert.ok(result.finished, `${LEVELS[level].name} with ${seats} players did not finish`);
  }
});

test('difficulty: Poot Pond is gentle for every crew size, every other river is possible', () => {
  LEVELS.forEach((def, level) => {
    const c = course(level);
    const results = [1, 2, 3, 4].map((seats) => runAutopilot(new Simulation(c, seats), 600));
    const finished = results.filter((r) => r.finished).length;
    if (level === 0) {
      assert.equal(finished, 4, `${def.name}: every crew size should finish`);
      results.forEach((r, k) => assert.ok(r.sinks <= 2, `${def.name}: ${k + 1} players sank ${r.sinks} times`));
    } else {
      assert.ok(finished >= 2, `${def.name}: only ${finished} of 4 crew sizes finished`);
    }
  });
});

test('stars reward clean, fast runs and not idle drifting', () => {
  const sim = new Simulation(course(0), 2);
  const par = sim.course.parTime;
  sim.time = par - 1;
  assert.equal(sim.stars(), 3);
  sim.bumps = 5;
  assert.equal(sim.stars(), 2);
  sim.sinks = 2;
  assert.equal(sim.stars(), 1);
  sim.sinks = 0;
  sim.time = par * 3;
  assert.equal(sim.stars(), 1);
});
