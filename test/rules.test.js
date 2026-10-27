import test from 'node:test';
import assert from 'node:assert/strict';
import { Course } from '../public/shared/course.js';
import { LEVELS } from '../public/shared/levels.js';
import { BOAT, DT, FART } from '../public/shared/config.js';
import { Simulation } from '../server/Simulation.js';
import { calmCourse } from './autopilot.js';

function stepFor(sim, seconds) {
  for (let t = 0; t < seconds; t += DT) sim.step();
}

test('the river nudges a wedged boat free after a few seconds', () => {
  const course = calmCourse();
  course.points = course.points.map((p) => ({ ...p, w: 100 })); // 200 px wide, boat radius 32
  const sim = new Simulation(course, 2);
  sim.x = 100 - BOAT.radius + 3; // pressed 3 px into the right bank
  sim.vx = sim.vy = 0;
  const events = [];
  for (let t = 0; t < BOAT.stuckSeconds + 2; t += DT) {
    sim.vx = Math.max(sim.vx, 10); // something keeps pressing it into the bank, slowly
    sim.step();
    events.push(...sim.drainEvents());
  }
  assert.ok(events.some((e) => e.k === 'nudge'), 'a boat held against the bank should be nudged free');
});

test('after sinking the boat restarts from the last flag, not the start', () => {
  const course = new Course(LEVELS[0]);
  const sim = new Simulation(course, 2);
  const flag = course.checkpoints[1];
  sim.placeAt(flag + 5);
  sim.prevProgress = flag - 1;
  sim.checkpoint = 0;
  sim.step();
  assert.equal(sim.checkpoint, 1, 'passing the second flag records it');
  sim.hull = 1;
  sim.invuln = 0;
  sim.sink();
  stepFor(sim, BOAT.respawnDelay + 0.1);
  assert.equal(sim.status, 'running');
  assert.ok(Math.abs(sim.progress - flag) < 20, `respawned at ${sim.progress}, flag at ${flag}`);
});

test('a solo player gets the soloScale boost', () => {
  const impulse = (seats) => {
    const sim = new Simulation(calmCourse(), seats);
    sim.startCharge(0);
    stepFor(sim, FART.chargeSeconds);
    sim.release(0);
    return sim.bursts[0].impulse;
  };
  assert.ok(Math.abs(impulse(1) / impulse(2) - FART.soloScale) < 1e-9);
});

test('star thresholds hold at their exact boundaries', () => {
  const sim = new Simulation(new Course(LEVELS[0]), 2);
  const par = sim.course.parTime;
  Object.assign(sim, { sinks: 0, bumps: 3, time: par });
  assert.equal(sim.stars(), 3);
  sim.bumps = 4;
  assert.equal(sim.stars(), 2);
  Object.assign(sim, { sinks: 1, bumps: 9, time: par * 1.6 });
  assert.equal(sim.stars(), 2);
  sim.time = par * 1.6 + 0.01;
  assert.equal(sim.stars(), 1);
});

test('every river that asks for whirlpools has at least one', () => {
  for (const def of LEVELS) {
    if (!(def.weights.whirlpool > 0)) continue;
    assert.ok(new Course(def).whirlpools.length > 0, `${def.name} asks for whirlpools but has none`);
  }
});
