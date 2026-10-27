export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 3;
export const MAX_PLAYERS = 4;
export const COUNTDOWN_SECONDS = 3;

export const BOAT = {
  radius: 32,
  // Inflatable raft: it barely grips the water. Linear drag is small, so a blast
  // keeps the boat gliding for seconds; the quadratic term only caps top speed.
  drag: 0.15,
  dragQuad: 0.0012,
  angularDrag: 0.45,
  // Hard cap on the boat's spin (rad/s). Whirlpools and glancing hits stay well under it; it only
  // stops a pile-up of impulses from spinning the boat faster than the crew can walk the rim.
  maxSpin: 6,
  maxHull: 5,
  bumpSpeed: 100,
  invulnSeconds: 1.0,
  restitutionBank: 0.5,
  restitutionRock: 0.55,
  restitutionHazard: 0.55,
  // Per px/s of the contact point sliding along a bank or obstacle, so a bounce drives the spin
  // toward rolling contact (spinFriction * radius = 0.32 of the gap closed per bounce).
  spinFriction: 0.01,
  respawnDelay: 2.2,
  stuckSeconds: 3,
  nudgeSpeed: 65,
};

export const FART = {
  chargeSeconds: 1.1,
  minPower: 0.12,
  maxImpulse: 80,
  soloScale: 1.25,
  gasMax: 100,
  gasBase: 4,
  gasPerPower: 36,
  gasRegen: 28,
  burstBase: 0.22,
  burstExtra: 0.22,
  walkSpeed: 3.6,
  stickDeadzone: 0.2,
  heatBase: 0.05,
  heatPerPower: 0.14,
  heatDecay: 0.05,
  soreStart: 0.6,
  soreWeakening: 0.4,
  plungeGasLoss: 40,
};

export const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c'];

const PI = Math.PI;

const LAYOUT_DEFS = {
  1: [{ name: 'Whole Boat', center: 0, half: PI, full: true }],
  2: [
    { name: 'Port Side', center: -PI / 2, half: PI / 2 },
    { name: 'Starboard Side', center: PI / 2, half: PI / 2 },
  ],
  3: [
    { name: 'Stern', center: PI, half: PI / 3 },
    { name: 'Port Bow', center: -PI / 3, half: PI / 3 },
    { name: 'Starboard Bow', center: PI / 3, half: PI / 3 },
  ],
  4: [
    { name: 'Stern Port', center: (-3 * PI) / 4, half: PI / 4 },
    { name: 'Stern Starboard', center: (3 * PI) / 4, half: PI / 4 },
    { name: 'Bow Port', center: -PI / 4, half: PI / 4 },
    { name: 'Bow Starboard', center: PI / 4, half: PI / 4 },
  ],
};

const HINTS = {
  1: 'You can stand anywhere around the boat. Stand opposite to where you want to go.',
  2: 'You own half the boat. Your blasts can push the raft toward the other half.',
  3: 'You own a third of the boat. Cover your direction and shout for help.',
  4: 'You own a quarter of the boat. Every direction needs a teammate.',
};

export function sectorLayout(count) {
  const n = Math.min(4, Math.max(1, count));
  return LAYOUT_DEFS[n].map((s) => ({ ...s, hint: HINTS[n], percent: Math.round(100 / n) }));
}

export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function clampToSector(target, sector) {
  if (sector.full) return target;
  const delta = wrapAngle(target - sector.center);
  if (Math.abs(delta) <= sector.half) return target;
  return wrapAngle(sector.center + Math.sign(delta) * sector.half);
}
