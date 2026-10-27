import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer } from '../public/js/snapshots.js';

const SPEED = 100; // px per second along x
const INTERVAL = 0.05; // snapshots are made every 50 ms

// What the server sends: a boat sailing along x at a steady speed.
const snapshot = (T, extra = {}) => ({ t: 's', T, x: SPEED * T, y: 0, a: 0, w: 0, vx: SPEED, vy: 0, st: 'running', hull: 5, pos: [0], gas: [100], heat: [0], ch: [0], p: 0, cp: -1, inv: false, ...extra });

// A small deterministic random generator, so the "bad network" is the same every run.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Arrival times for `count` snapshots over a link where some packets stall and hold up the ones behind them.
function arrivals(count, { base = 70, stallChance = 0.12, stallMax = 350, seed = 7 } = {}) {
  const random = rng(seed);
  const out = [];
  let last = 0;
  for (let n = 1; n <= count; n++) {
    const jitter = random() < stallChance ? random() * stallMax : random() * 25;
    last = Math.max(last, n * INTERVAL * 1000 + base + jitter);
    out.push({ T: n * INTERVAL, at: last });
  }
  return out;
}

// The old way: interpolate between arrival times, a fixed 110 ms behind.
class Naive {
  constructor() {
    this.snaps = [];
  }
  push(snap, now) {
    snap.recv = now;
    this.snaps.push(snap);
  }
  sample(now) {
    const { snaps } = this;
    const last = snaps[snaps.length - 1];
    const target = now - 110;
    if (target >= last.recv) {
      const dt = Math.min(0.12, (target - last.recv) / 1000);
      return { ...last, x: last.x + last.vx * dt };
    }
    if (target <= snaps[0].recv) return snaps[0];
    for (let i = snaps.length - 2; i >= 0; i--) {
      const a = snaps[i];
      if (a.recv > target) continue;
      const b = snaps[i + 1];
      const k = (target - a.recv) / Math.max(1, b.recv - a.recv);
      return { ...b, x: a.x + (b.x - a.x) * k };
    }
    return last;
  }
}

// Draws 60 frames a second from the first arrival to the last and reports how the boat moved on screen.
function play(buffer, plan, { warmup = 6000 } = {}) {
  let next = 0;
  const xs = [];
  const end = plan.at(-1).at;
  for (let now = plan[0].at; now <= end; now += 1000 / 60) {
    while (next < plan.length && plan[next].at <= now) {
      buffer.push(snapshot(plan[next].T), plan[next].at);
      next++;
    }
    const st = buffer.sample(now);
    if (now >= warmup) xs.push({ now, x: st.x, T: st.T });
  }
  let frozen = 0;
  let jumped = 0;
  let backwards = 0;
  for (let i = 1; i < xs.length; i++) {
    const ratio = (xs[i].x - xs[i - 1].x) / ((xs[i].now - xs[i - 1].now) / 1000) / SPEED;
    if (ratio < 0.35) frozen++;
    if (ratio > 2.2) jumped++;
    if (xs[i].x < xs[i - 1].x - 1e-9) backwards++;
  }
  return { frames: xs.length - 1, frozen, jumped, backwards, bad: (frozen + jumped) / (xs.length - 1) };
}

test('on a clean connection the boat moves at exactly its real speed, 100 ms behind the server', () => {
  const plan = arrivals(400, { stallChance: 0, base: 70 });
  const buffer = new SnapshotBuffer();
  const result = play(buffer, plan);
  assert.equal(result.frozen + result.jumped + result.backwards, 0);
  assert.ok(Math.abs(buffer.delay - 0.1) < 0.03, `cushion ${buffer.delay}`);
  // the sampled position is where the boat was `delay` seconds before the server's present
  const now = plan.at(-1).at;
  const st = buffer.sample(now);
  assert.ok(Math.abs(st.T - ((now - buffer.base) / 1000 - buffer.delay)) < 0.05);
  assert.ok(Math.abs(st.x - SPEED * st.T) < 1, 'and its position matches the real path at that moment');
});

test('bursty arrivals no longer make the boat freeze and jump', () => {
  const plan = arrivals(600);
  const smooth = play(new SnapshotBuffer(), plan);
  const naive = play(new Naive(), plan);
  assert.ok(smooth.bad < 0.02, `buffered: ${smooth.frozen} frozen and ${smooth.jumped} jumped of ${smooth.frames} frames`);
  assert.ok(naive.bad > 0.08, `the old way should stutter in this scenario (${naive.frozen} frozen, ${naive.jumped} jumped)`);
  assert.ok(smooth.bad * 5 < naive.bad);
  assert.equal(smooth.backwards, 0, 'time never runs backwards');
});

test('a rougher link costs a bigger cushion, and a calm one gives it back', () => {
  const buffer = new SnapshotBuffer();
  play(buffer, arrivals(300, { stallChance: 0.3, stallMax: 400, seed: 3 }), { warmup: 0 });
  assert.ok(buffer.delay > 0.25, `cushion ${buffer.delay} should have grown`);
  assert.ok(buffer.delay <= 0.45);
  // a long calm stretch afterwards: the window forgets the bad patch
  const calm = buffer.latest().T;
  let now = buffer.latest().recv;
  for (let n = 1; n <= 260; n++) {
    now += 50;
    buffer.push(snapshot(calm + n * INTERVAL), now);
    buffer.sample(now);
  }
  assert.ok(buffer.delay < 0.15, `cushion ${buffer.delay} should have shrunk again`);
});

test('the playout clock never jumps back, even when a late packet changes the estimate', () => {
  const buffer = new SnapshotBuffer();
  const plan = arrivals(500, { stallChance: 0.2, stallMax: 500, seed: 11 });
  let next = 0;
  let previous = -Infinity;
  for (let now = plan[0].at; now <= plan.at(-1).at; now += 1000 / 60) {
    while (next < plan.length && plan[next].at <= now) {
      buffer.push(snapshot(plan[next].T), plan[next].at);
      next++;
    }
    buffer.sample(now);
    const t = buffer.renderTime();
    if (t !== null) {
      assert.ok(t >= previous, `clock went from ${previous} back to ${t}`);
      previous = t;
    }
  }
});

test('the countdown (time standing still) does not pile up snapshots, and the race then plays smoothly', () => {
  const buffer = new SnapshotBuffer();
  let now = 0;
  for (let n = 0; n < 60; n++) {
    now += 50;
    buffer.push(snapshot(0, { st: 'running' }), now);
  }
  assert.equal(buffer.snaps.length, 1);
  assert.equal(buffer.sample(now).T, 0);
  assert.equal(buffer.renderTime(), null);
  const plan = arrivals(200, { stallChance: 0 }).map((p) => ({ T: p.T, at: p.at + now }));
  const result = play(buffer, plan, { warmup: now + 3000 });
  assert.equal(result.frozen + result.jumped, 0);
});

test('a new race (the server clock starts over) resets the buffer', () => {
  const buffer = new SnapshotBuffer();
  for (let n = 1; n <= 40; n++) {
    buffer.push(snapshot(n * INTERVAL), n * 50);
    buffer.sample(n * 50);
  }
  assert.ok(buffer.renderTime() !== null);
  buffer.push(snapshot(0), 3000);
  assert.equal(buffer.snaps.length, 1);
  assert.equal(buffer.renderTime(), null);
  assert.equal(buffer.latest().T, 0);
});

test('a snapshot that arrives after a newer one is ignored and does not disturb the clock', () => {
  const buffer = new SnapshotBuffer();
  for (let n = 1; n <= 40; n++) {
    buffer.push(snapshot(n * INTERVAL), n * 50 + 70);
    buffer.sample(n * 50 + 70);
  }
  const before = { count: buffer.snaps.length, renderT: buffer.renderTime(), newest: buffer.latest().T };
  buffer.push(snapshot(1.9), 2200); // 0.1 s older than the newest, overtaken on the way
  assert.equal(buffer.snaps.length, before.count);
  assert.equal(buffer.latest().T, before.newest);
  assert.equal(buffer.renderTime(), before.renderT);
});

test('a respawn (the boat moved a long way between snapshots) is shown as a cut, not a slide', () => {
  const buffer = new SnapshotBuffer();
  let now = 0;
  for (let n = 1; n <= 40; n++) {
    now = n * 50 + 70;
    buffer.push(snapshot(n * INTERVAL), now);
  }
  // the boat is put back 600 px at T = 2.05
  buffer.push(snapshot(2.05, { x: 5000 }), now + 50);
  buffer.push(snapshot(2.1, { x: 5000 + SPEED * 0.05 }), now + 100);
  const seen = [];
  for (let f = now; f < now + 600; f += 1000 / 60) seen.push(buffer.sample(f).x);
  const slid = seen.filter((x) => x > 400 && x < 4900);
  assert.equal(slid.length, 0, 'no frame shows the boat part-way across the jump');
});

test('a tab that slept for half a minute catches up at once instead of slowly', () => {
  const buffer = new SnapshotBuffer();
  const plan = arrivals(200, { stallChance: 0 });
  play(buffer, plan, { warmup: 0 });
  const last = plan.at(-1);
  let at = last.at;
  let T = last.T;
  for (let n = 0; n < 600; n++) {
    at += 50;
    T += INTERVAL;
    buffer.push(snapshot(T), at); // snapshots kept arriving while the page was not drawing
  }
  const st = buffer.sample(at + 10);
  assert.ok(Math.abs(st.T - (T - buffer.delay)) < 0.15, `drawn at ${st.T}, newest is ${T}`);
});

test('with no news for a while the boat drifts on for a moment, then holds still', () => {
  const buffer = new SnapshotBuffer();
  const plan = arrivals(120, { stallChance: 0 });
  play(buffer, plan, { warmup: 0 });
  const quiet = plan.at(-1).at + 3000;
  const st = buffer.sample(quiet);
  const newest = buffer.latest();
  assert.ok(st.x - newest.x <= SPEED * 0.12 + 1e-6, `drifted ${st.x - newest.x} px`);
  assert.ok(st.x >= newest.x);
});
