import { Course } from '../public/shared/course.js';
import { LEVELS } from '../public/shared/levels.js';
import { ANIMAL_IDS } from '../public/shared/animals.js';
import { COLORS, COUNTDOWN_SECONDS, DT, MAX_PLAYERS, SNAPSHOT_EVERY } from '../public/shared/config.js';
import { Simulation } from './Simulation.js';
import { cleanName, makeToken } from './util.js';

// How long a player whose socket dropped (page refresh, phone screen lock, network
// blip) keeps their seat, name and character before the room forgets them.
export const RECONNECT_GRACE_MS = 45_000;

const courseCache = new Map();

function getCourse(index) {
  if (!courseCache.has(index)) courseCache.set(index, new Course(LEVELS[index]));
  return courseCache.get(index);
}

function send(ws, text, lossy) {
  if (ws.readyState !== 1) return;
  if (lossy && ws.bufferedAmount > 262144) return;
  ws.send(text);
}

export class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.nextId = 1;
    this.phase = 'lobby';
    this.levelIndex = 0;
    this.course = null;
    this.sim = null;
    this.countdown = 0;
    this.ticks = 0;
    this.seatList = [];
    this.result = null;
    this.lastActive = Date.now();
  }

  get host() {
    for (const p of this.players.values()) if (p.connected) return p;
    return null;
  }

  isEmpty() {
    for (const p of this.players.values()) if (p.connected) return false;
    return true;
  }

  addPlayer(ws, rawName, rawAnimal) {
    if (this.players.size >= MAX_PLAYERS && !this.evictAwayPlayer()) return null;
    const used = new Set([...this.players.values()].map((p) => p.color));
    const takenAnimals = new Set([...this.players.values()].map((p) => p.animal));
    const id = `p${this.nextId++}`;
    const wanted = ANIMAL_IDS.includes(rawAnimal) ? rawAnimal : null;
    const player = {
      id,
      name: cleanName(rawName, `Cheeky ${this.nextId - 1}`),
      color: COLORS.find((c) => !used.has(c)) ?? COLORS[0],
      animal: wanted ?? ANIMAL_IDS.find((a) => !takenAnimals.has(a)) ?? ANIMAL_IDS[0],
      token: makeToken(),
      ws: null,
      connected: false,
      dropAt: null,
      seat: -1,
    };
    this.players.set(id, player);
    this.attach(player, ws);
    return player;
  }

  resume(ws, token) {
    for (const player of this.players.values()) {
      if (player.token !== token) continue;
      if (player.ws && player.ws !== ws) {
        player.ws.player = null;
        player.ws.room = null;
        player.ws.close();
      }
      this.attach(player, ws);
      return player;
    }
    return null;
  }

  attach(player, ws) {
    player.ws = ws;
    player.connected = true;
    player.dropAt = null;
    ws.player = player;
    ws.room = this;
    this.lastActive = Date.now();
  }

  // The socket closed. The player stays in the room, marked away, so a resume with
  // their token gets the same seat and character back. pruneDropped forgets them once
  // the grace period is over.
  detach(ws) {
    if (!this.release(ws)) return;
    this.broadcastLobby();
  }

  release(ws) {
    const player = ws.player;
    ws.player = null;
    ws.room = null;
    if (!player || player.ws !== ws) return null;
    player.connected = false;
    player.ws = null;
    player.dropAt = Date.now();
    if (this.sim && player.seat >= 0) this.sim.clearCharge(player.seat);
    this.lastActive = Date.now();
    return player;
  }

  // An explicit leave gives the seat up straight away.
  leave(ws) {
    const player = this.release(ws);
    if (!player) return;
    this.players.delete(player.id);
    this.broadcastLobby();
  }

  // Forgets away players whose grace period is over. Seated players keep their seat for
  // as long as a race is running, since the simulation has a boat sector for them.
  pruneDropped(now = Date.now()) {
    const inRace = this.phase === 'countdown' || this.phase === 'racing';
    let pruned = false;
    for (const [id, p] of this.players) {
      if (p.connected || now - p.dropAt <= RECONNECT_GRACE_MS) continue;
      if (inRace && p.seat >= 0) continue;
      this.players.delete(id);
      pruned = true;
    }
    if (pruned) this.broadcastLobby();
    return pruned;
  }

  // In the lobby or on the results screen a full room may still hold away players. The
  // one gone longest makes way for a newcomer, so ghosts never turn people away.
  evictAwayPlayer() {
    if (this.phase !== 'lobby' && this.phase !== 'finished') return false;
    let oldest = null;
    for (const p of this.players.values()) if (!p.connected && (!oldest || p.dropAt < oldest.dropAt)) oldest = p;
    if (!oldest) return false;
    this.players.delete(oldest.id);
    return true;
  }

  // Brings a (re)joining client up to date: the lobby, plus whatever race screen the
  // others are looking at. After a race the result is replayed exactly as it was sent.
  sendState(player) {
    this.broadcastLobby();
    const racing = this.phase === 'countdown' || this.phase === 'racing';
    if (racing) {
      send(player.ws, JSON.stringify(this.startMessage()));
    } else if (this.phase === 'finished' && this.sim && this.result) {
      send(player.ws, JSON.stringify(this.startMessage()));
      send(player.ws, JSON.stringify(this.sim.snapshot()));
      send(player.ws, JSON.stringify(this.result));
    }
  }

  // The seat list is fixed when the race starts, so it always matches the simulation
  // even if a seated player has since left.
  startMessage() {
    return {
      t: 'start',
      level: this.levelIndex,
      countdown: Math.max(0, Math.ceil(this.countdown)),
      racing: this.phase === 'racing' || this.phase === 'finished',
      seats: this.seatList.map((s) => ({ ...s })),
    };
  }

  lobbyMessage() {
    const host = this.host;
    return {
      t: 'lobby',
      code: this.code,
      phase: this.phase,
      level: this.levelIndex,
      host: host ? host.id : null,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        animal: p.animal,
        connected: p.connected,
        seat: p.seat,
      })),
    };
  }

  broadcast(obj, lossy = false) {
    const text = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.ws) send(p.ws, text, lossy);
  }

  broadcastLobby() {
    this.broadcast(this.lobbyMessage());
  }

  handle(player, msg) {
    this.lastActive = Date.now();
    const isHost = this.host === player;
    switch (msg.t) {
      case 'stick':
        if (this.sim && player.seat >= 0 && Number.isFinite(msg.a) && Number.isFinite(msg.m)) {
          this.sim.setStick(player.seat, msg.a, msg.m);
        }
        break;
      case 'charge':
        if (this.phase !== 'racing' || player.seat < 0) break;
        if (msg.on) this.sim.startCharge(player.seat);
        else this.sim.release(player.seat);
        break;
      case 'rename':
        if (this.phase === 'lobby' || this.phase === 'finished') {
          const name = cleanName(msg.name, player.name);
          if (name !== player.name) {
            player.name = name;
            this.broadcastLobby();
          }
        }
        break;
      case 'animal':
        if (ANIMAL_IDS.includes(msg.id) && this.phase !== 'racing' && this.phase !== 'countdown') {
          player.animal = msg.id;
          this.broadcastLobby();
        }
        break;
      case 'level':
        if (isHost && (this.phase === 'lobby' || this.phase === 'finished') && Number.isInteger(msg.i)) {
          if (msg.i >= 0 && msg.i < LEVELS.length) {
            this.levelIndex = msg.i;
            this.broadcastLobby();
          }
        }
        break;
      case 'start':
        if (isHost && (this.phase === 'lobby' || this.phase === 'finished')) this.startRace();
        break;
      case 'lobby':
        if (isHost && this.phase !== 'lobby') this.toLobby();
        break;
      case 'ping':
        send(player.ws, JSON.stringify({ t: 'pong' }));
        break;
      default:
        break;
    }
  }

  startRace() {
    const seated = [...this.players.values()].filter((p) => p.connected).slice(0, MAX_PLAYERS);
    if (seated.length === 0) return;
    for (const p of this.players.values()) p.seat = -1;
    seated.forEach((p, i) => {
      p.seat = i;
    });
    this.course = getCourse(this.levelIndex);
    this.sim = new Simulation(this.course, seated.length);
    this.seatList = seated.map((p) => ({ id: p.id, seat: p.seat }));
    this.result = null;
    this.phase = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.ticks = 0;
    this.broadcast(this.startMessage());
    this.broadcastLobby();
  }

  toLobby() {
    this.phase = 'lobby';
    this.sim = null;
    this.seatList = [];
    this.result = null;
    for (const p of this.players.values()) p.seat = -1;
    this.broadcastLobby();
  }

  tick() {
    if (this.phase === 'countdown') {
      this.countdown -= DT;
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.countdown = 0;
        this.broadcast({ t: 'go' });
      }
    } else if (this.phase === 'racing') {
      this.sim.step();
      const events = this.sim.drainEvents();
      if (events.length) this.broadcast({ t: 'ev', list: events });
      if (this.sim.status === 'finished') {
        this.finishRace();
        return;
      }
    } else {
      return;
    }
    this.ticks += 1;
    if (this.ticks % SNAPSHOT_EVERY === 0) this.broadcast(this.sim.snapshot(), true);
  }

  finishRace() {
    this.phase = 'finished';
    this.result = {
      t: 'finish',
      level: this.levelIndex,
      time: Math.round(this.sim.time * 10) / 10,
      sinks: this.sim.sinks,
      bumps: this.sim.bumps,
      stars: this.sim.stars(),
      par: this.course.parTime,
      hasNext: this.levelIndex < LEVELS.length - 1,
    };
    this.broadcast(this.sim.snapshot());
    this.broadcast(this.result);
    // Whoever dropped during the race gets a fresh grace period to come back to the results.
    const now = Date.now();
    for (const p of this.players.values()) if (!p.connected) p.dropAt = now;
    this.lastActive = now;
    this.broadcastLobby();
  }
}
