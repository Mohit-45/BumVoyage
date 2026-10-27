import { Course } from '../public/shared/course.js';
import { LEVELS } from '../public/shared/levels.js';
import { Simulation } from '../server/Simulation.js';
import { Autopilot } from '../test/autopilot.js';

// usage: node scripts/sinks.mjs LEVEL_INDEX [seats=2] [maxSeconds=600]
const [levelIdx, seats = 2, maxT = 600] = process.argv.slice(2).map(Number);
const course = new Course(LEVELS[levelIdx]);
const sim = new Simulation(course, seats);
const pilot = new Autopilot(sim);
const hits = new Map();
let lastHull = sim.hull;
while (sim.status !== 'finished' && sim.time < maxT) {
  pilot.step();
  for (const ev of sim.events) {
    if (['bump', 'ouch', 'spiked', 'flush'].includes(ev.k)) {
      const key = `${Math.round(sim.progress / 100) * 100}:${ev.k}`;
      hits.set(key, (hits.get(key) ?? 0) + 1);
    }
  }
  sim.events.length = 0;
}
const sorted = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('status', sim.status, 'time', sim.time.toFixed(0), 'progress', Math.round(sim.progress), 'sinks', sim.sinks);
for (const [k, v] of sorted) {
  const s = Number(k.split(':')[0]);
  const near = [];
  const within = (a) => Math.abs(a - s) < 220;
  course.rocks.filter((r) => within(r.s)).forEach((r) => near.push('rock'));
  course.spikeFields.filter((r) => within(r.s)).forEach(() => near.push('urchins'));
  // A barrel from ahead rolls over the whole stretch between its far and near ends.
  course.rollers.filter((r) => (r.mode === 'top' ? s > r.s - 100 && s < r.s + r.travel + 140 : within(r.s))).forEach((r) => near.push(`roller-${r.mode}`));
  course.whirlpools.filter((r) => within(r.s)).forEach(() => near.push('whirl'));
  course.logs.filter((r) => within(r.s)).forEach(() => near.push('log'));
  course.walls.filter((w) => s >= w.s0 - 100 && s <= w.s1 + 100).forEach((w) => near.push(`wall${w.side}`));
  course.falls.filter((f) => within(f.s0)).forEach(() => near.push('fall'));
  const p = course.pointAtS(s);
  console.log(k.padEnd(14), 'x', String(v).padStart(3), 'w=' + Math.round(p.w), near.join(','));
}
