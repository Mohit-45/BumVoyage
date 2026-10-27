// Measures how the boat feels on a calm, straight, hazard-free stretch of river.
//   node scripts/feel.mjs
// "Speed" below is speed relative to the water (|v - river flow|): that is the part
// the drag acts on and the part the crew controls. Ground speed adds the river flow.
import { LEVELS } from '../public/shared/levels.js';
import { DT, BOAT, FART } from '../public/shared/config.js';
import { Simulation } from '../server/Simulation.js';
import { calmCourse } from '../test/autopilot.js';

const TARGETS = {
  blastMin: 70,
  blastMax: 100,
  coastMin: 450,
  coastMax: 900,
  keep15Min: 65,
  residualMax: 25,
  topMin: 300,
  topMax: 350,
};

// A crew floating with the river (a boat in a current moves with the current).
function crew(seats = 2) {
  const sim = new Simulation(calmCourse(), seats);
  sim.vx = sim.flowX;
  sim.vy = sim.flowY;
  return sim;
}

const run = (sim, seconds, each) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    sim.step();
    if (each) each(sim);
  }
};
const water = (sim) => Math.hypot(sim.vx - sim.flowX, sim.vy - sim.flowY);
const walkSeat = (sim, seat, relAngle) => {
  sim.setStick(seat, sim.a + relAngle, 1);
  run(sim, 1.3);
};
const settle = (sim) => run(sim, FART.burstBase + FART.burstExtra + 0.05);
// Water speed after `seconds` of pure coasting, using the same drag law as the simulation.
function coastSpeed(v, seconds) {
  for (let t = 0; t < seconds - 1e-9; t += DT) v -= (BOAT.drag + BOAT.dragQuad * v) * v * DT;
  return v;
}

const rows = [];
const pct = (v) => `${v.toFixed(0)}%`;
const report = (name, value, target, ok) => rows.push({ name, value, target, ok });

// (a) + (b): one full-power blast from the stern, then no input at all.
{
  const sim = crew(2);
  walkSeat(sim, 0, Math.PI);
  const x0 = sim.x;
  const y0 = sim.y;
  sim.startCharge(0);
  run(sim, FART.chargeSeconds);
  sim.release(0);
  const t0 = sim.time;
  const dist = () => Math.hypot(sim.x - x0, sim.y - y0);
  let peak = 0;
  let peakT = 0;
  let at15 = null;
  let coast = null;
  let coastT = null;
  run(sim, 60, () => {
    const sp = water(sim);
    if (sp > peak) {
      peak = sp;
      peakT = sim.time;
    }
    if (at15 === null && peak > 0 && sim.time - peakT >= 1.5) at15 = sp;
    if (coast === null && peak > 40 && sim.bursts.length === 0 && sp < 10) {
      coast = dist();
      coastT = sim.time - t0;
    }
  });
  report('one full blast: speed gained over the water', `${peak.toFixed(0)} px/s`, `${TARGETS.blastMin}-${TARGETS.blastMax} px/s`, peak >= TARGETS.blastMin && peak <= TARGETS.blastMax);
  report('(a) coast distance until speed < 10 px/s', coast === null ? 'never' : `${coast.toFixed(0)} px in ${coastT.toFixed(1)} s`, `${TARGETS.coastMin}-${TARGETS.coastMax} px`, coast !== null && coast >= TARGETS.coastMin && coast <= TARGETS.coastMax);
  const keep = (100 * at15) / peak;
  report('(b) speed 1.5 s after the peak, % of peak', pct(keep), `>= ${TARGETS.keep15Min}%`, keep >= TARGETS.keep15Min);
}

// (c): the same blast from the stern, then an equal and opposite blast from the bow, fired 0.8 s later.
{
  const sim = crew(2);
  walkSeat(sim, 0, Math.PI);
  walkSeat(sim, 1, 0);
  const delay = 0.8;
  sim.startCharge(0);
  run(sim, delay);
  sim.startCharge(1); // seat 1 starts late so that it releases `delay` seconds after seat 0
  run(sim, FART.chargeSeconds - delay);
  sim.release(0);
  let peak = 0;
  run(sim, delay, () => (peak = Math.max(peak, water(sim))));
  sim.release(1);
  settle(sim);
  const residual = water(sim);
  const rel = (100 * residual) / peak;
  report('(c) residual after equal+opposite blast 0.8 s later', `${residual.toFixed(0)} px/s = ${pct(rel)} of peak`, `<= ${TARGETS.residualMax}%`, rel <= TARGETS.residualMax);
}

// (d): a 2-player crew brakes from cruising speed. Both start at the stern, so they must walk
// round to the bow while charging, then fire together. Power is sized to the speed the boat will
// have at the moment of release; each seat starts charging just in time.
function brake(cruise, reaction) {
  const sim = crew(2);
  walkSeat(sim, 0, Math.PI);
  walkSeat(sim, 1, Math.PI);
  sim.vx = sim.flowX + sim.tx * cruise;
  sim.vy = sim.flowY + sim.ty * cruise;
  const start = sim.time;
  run(sim, reaction);
  const walkTime = Math.PI / FART.walkSpeed + 0.05;
  // Drag keeps acting while the burst plays, so size the blast for the speed at mid-burst.
  const v = coastSpeed(cruise, reaction + walkTime + 0.17);
  const power = Math.min(1, Math.max(FART.minPower, v / (2 * FART.maxImpulse)));
  const hold = power * FART.chargeSeconds;
  sim.setStick(0, sim.a, 1);
  sim.setStick(1, sim.a, 1);
  run(sim, Math.max(0, walkTime - hold));
  sim.startCharge(0);
  sim.startCharge(1);
  run(sim, hold);
  sim.release(0);
  sim.release(1);
  while (sim.time - start < 30 && !(sim.bursts.length === 0 && water(sim) < 10)) sim.step();
  return sim.time - start;
}
{
  const cruise = 120;
  const reaction = 0.3;
  const t = brake(cruise, reaction);
  report(`(d) 2-player crew stops from ${cruise} px/s`, `${t.toFixed(1)} s (incl. ${reaction} s reaction)`, 'a few seconds', t > 0 && t <= 4);
  const idle = crew(2);
  idle.vx = idle.flowX + idle.tx * cruise;
  idle.vy = idle.flowY + idle.ty * cruise;
  let tIdle = 0;
  while (tIdle < 60 && water(idle) >= 10) {
    idle.step();
    tIdle += DT;
  }
  report('    same boat with nobody braking, speed < 10 px/s after', `${tIdle.toFixed(0)} s`, 'many seconds', tIdle >= 8);
}

// (e): top speed when two seats push forward as hard as they can (free gas, so only drag and heat limit it).
{
  const sim = crew(2);
  walkSeat(sim, 0, Math.PI);
  walkSeat(sim, 1, Math.PI);
  let top = 0;
  const note = () => (top = Math.max(top, water(sim)));
  for (let k = 0; k < 40; k++) {
    sim.seats.forEach((_, i) => sim.startCharge(i));
    run(sim, FART.chargeSeconds, note);
    sim.seats.forEach((s, i) => {
      s.gas = FART.gasMax;
      sim.release(i);
    });
    run(sim, 0.02, note);
  }
  report('(e) top speed, 2 seats blasting non-stop (free gas)', `${top.toFixed(0)} px/s`, `${TARGETS.topMin}-${TARGETS.topMax} px/s`, top >= TARGETS.topMin && top <= TARGETS.topMax);
}

console.log(`Boat feel on a calm straight stretch (river flow ${LEVELS[0].flow} px/s, drag ${BOAT.drag}/s + ${BOAT.dragQuad} quadratic, full blast ${FART.maxImpulse} px/s)\n`);
for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'MISS'} ${r.name.padEnd(58)} ${String(r.value).padEnd(36)} target ${r.target}`);
if (rows.some((r) => !r.ok)) process.exitCode = 1;
