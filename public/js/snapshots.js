// A jitter buffer for the 20 Hz snapshot stream.
//
// Snapshots do not arrive evenly: on a far-away or busy connection they come late and in bursts. Drawing each one the
// moment it arrives makes the boat freeze, then jump. So the world is drawn a little in the past, on the server's own
// clock (snapshot.T): the buffer replays snapshots at the pace they were made, keeps a cushion that grows with the
// jitter it measures, and speeds up or slows down by at most 15% to keep that cushion. Time never jumps and never runs
// backwards, however the packets arrive.

const MIN_DELAY = 0.1; // seconds behind the server on a clean connection (two snapshots)
const MAX_DELAY = 0.45;
const SLACK = 0.06; // one snapshot interval plus a little, on top of the measured lateness
const WINDOW_MS = 8000; // how much history the clock and jitter estimates use
const MAX_SPEED_ADJUST = 0.15;
const GIVE_UP = 1; // seconds off the wanted time before the clock jumps instead of slewing (a sleeping tab)
const MAX_EXTRAPOLATE = 0.12;
const JUMP = 220; // px between two snapshots that means the boat was moved (a respawn), not that it sailed
const KEEP = 120;
const STRAGGLER = 1; // seconds: a snapshot this much older than the newest is a straggler, much older means a new race

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class SnapshotBuffer {
  constructor() {
    this.reset();
  }

  reset() {
    this.snaps = [];
    this.window = []; // [arrival ms, arrival ms - T ms] for snapshots whose T moved on
    this.base = null; // the smallest of those: the server clock is (now - base) / 1000
    this.delay = MIN_DELAY; // the cushion the playout clock aims for, in seconds
    this.renderT = null; // the playout clock, in server seconds
    this.lastNow = null;
  }

  latest() {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  /** The server time the world is being drawn at, or null until the clock is known. */
  renderTime() {
    return this.renderT;
  }

  push(snap, now) {
    const last = this.latest();
    if (last && snap.T < last.T - 1e-6) {
      if (last.T - snap.T < STRAGGLER) return; // an old snapshot that got overtaken: nothing to learn from it
      this.reset(); // the clock started over: a new race
    }
    snap.recv = now;
    const prev = this.latest();
    if (prev && snap.T === prev.T) {
      this.snaps[this.snaps.length - 1] = snap; // time stood still (the countdown): only the newest matters
      return;
    }
    this.snaps.push(snap);
    if (this.snaps.length > KEEP) this.snaps.shift();
    if (!prev) return;
    this.window.push([now, now - snap.T * 1000]);
    while (this.window[0][0] < now - WINDOW_MS) this.window.shift();
    this.base = Math.min(...this.window.map((w) => w[1]));
    const late = this.window.map((w) => w[1] - this.base).sort((a, b) => a - b);
    this.delay = clamp(SLACK + late[Math.floor(late.length * 0.95)] / 1000, MIN_DELAY, MAX_DELAY);
  }

  sample(now) {
    const snaps = this.snaps;
    if (snaps.length === 0) return null;
    const last = snaps[snaps.length - 1];
    if (this.base === null) return last; // the clock is not known yet
    const dt = this.lastNow === null ? 0 : Math.max(0, (now - this.lastNow) / 1000);
    this.lastNow = now;
    const wanted = (now - this.base) / 1000 - this.delay;
    if (this.renderT === null || Math.abs(wanted - this.renderT) > GIVE_UP) {
      this.renderT = wanted;
    } else {
      this.renderT += dt * (1 + clamp((wanted - this.renderT) * 2, -MAX_SPEED_ADJUST, MAX_SPEED_ADJUST));
    }
    const t = this.renderT;
    if (t >= last.T) {
      const ahead = Math.min(MAX_EXTRAPOLATE, t - last.T);
      const moving = last.st === 'running';
      return {
        ...last,
        x: last.x + (moving ? last.vx * ahead : 0),
        y: last.y + (moving ? last.vy * ahead : 0),
        a: last.a + (moving ? last.w * ahead : 0),
        T: t,
      };
    }
    if (t <= snaps[0].T) return snaps[0];
    for (let i = snaps.length - 2; i >= 0; i--) {
      const a = snaps[i];
      if (a.T > t) continue;
      const b = snaps[i + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) > JUMP) return b;
      const k = (t - a.T) / (b.T - a.T);
      return {
        ...b,
        x: lerp(a.x, b.x, k),
        y: lerp(a.y, b.y, k),
        a: lerpAngle(a.a, b.a, k),
        T: t,
        pos: b.pos.map((p, i2) => lerpAngle(a.pos[i2] ?? p, p, k)),
      };
    }
    return last;
  }
}
