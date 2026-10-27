import { DT } from '../public/shared/config.js';
import { RECONNECT_GRACE_MS, Room } from './Room.js';
import { makeCode } from './util.js';

const MAX_ROOMS = 500;
// A room nobody is connected to is kept a little longer than the reconnect grace period,
// so a race whose whole crew dropped can still be resumed. A room with nobody in it at
// all (everyone left or timed out) has nobody to resume, so it goes almost at once.
const EMPTY_ROOM_TTL_MS = RECONNECT_GRACE_MS * 2;
const VACANT_ROOM_TTL_MS = 10_000;
const STALE_ROOM_TTL_MS = 3 * 60 * 60_000;
const SWEEP_EVERY_MS = 5_000;

export class RoomManager {
  constructor({ maxRooms = MAX_ROOMS } = {}) {
    this.maxRooms = maxRooms;
    this.rooms = new Map();
    this.loopTimer = null;
    this.sweepTimer = null;
    this.accumulator = 0;
    this.lastTime = 0;
  }

  create() {
    if (this.rooms.size >= this.maxRooms) return null;
    const code = makeCode((c) => this.rooms.has(c));
    if (!code) return null;
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(code) ?? null;
  }

  start() {
    this.lastTime = performance.now();
    this.loopTimer = setInterval(() => this.loop(), 1000 / 120);
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_EVERY_MS);
  }

  stop() {
    clearInterval(this.loopTimer);
    clearInterval(this.sweepTimer);
    this.loopTimer = null;
    this.sweepTimer = null;
  }

  loop() {
    const now = performance.now();
    this.accumulator = Math.min(this.accumulator + (now - this.lastTime) / 1000, DT * 6);
    this.lastTime = now;
    while (this.accumulator >= DT) {
      for (const [code, room] of this.rooms) {
        try {
          room.tick();
        } catch (err) {
          this.crash(code, room, err);
        }
      }
      this.accumulator -= DT;
    }
  }

  // A room whose tick throws would throw again on every tick, so it is closed rather than
  // kept. Its players are told and disconnected; every other room carries on.
  crash(code, room, err) {
    console.error(`room ${code} crashed and was closed`, err);
    this.rooms.delete(code);
    for (const p of room.players.values()) {
      const ws = p.ws;
      if (!ws) continue;
      try {
        ws.player = null;
        ws.room = null;
        if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'err', msg: 'Something went wrong with this room. Please start a new one.' }));
        ws.close(1011, 'Room error');
      } catch {
        /* the socket is already gone */
      }
    }
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      try {
        room.pruneDropped(now);
        const idle = now - room.lastActive;
        const ttl = room.players.size === 0 ? VACANT_ROOM_TTL_MS : EMPTY_ROOM_TTL_MS;
        if ((room.isEmpty() && idle > ttl) || idle > STALE_ROOM_TTL_MS) this.rooms.delete(code);
      } catch (err) {
        this.crash(code, room, err);
      }
    }
  }
}
