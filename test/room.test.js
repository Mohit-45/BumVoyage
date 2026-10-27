import test from 'node:test';
import assert from 'node:assert/strict';
import { RECONNECT_GRACE_MS, Room } from '../server/Room.js';
import { RoomManager } from '../server/RoomManager.js';
import { cleanCode, cleanName, createKeyedLimiter } from '../server/util.js';
import { DT } from '../public/shared/config.js';

function fakeSocket() {
  return {
    readyState: 1,
    bufferedAmount: 0,
    sent: [],
    closed: false,
    send(text) {
      this.sent.push(JSON.parse(text));
    },
    close() {
      this.closed = true;
      this.readyState = 3;
    },
    ofType(type) {
      return this.sent.filter((m) => m.t === type);
    },
  };
}

function ticks(room, seconds) {
  for (let t = 0; t < seconds; t += DT) room.tick();
}

// Pretends `ms` have passed since the player dropped.
function ageDrop(player, ms) {
  player.dropAt -= ms;
}

function makeRoom(names = ['Alice', 'Bob']) {
  const room = new Room('BCDF');
  const sockets = names.map(() => fakeSocket());
  const players = names.map((name, i) => room.addPlayer(sockets[i], name));
  return { room, sockets, players };
}

test('only the host can start a race', () => {
  const { room, players } = makeRoom();
  room.handle(players[1], { t: 'start' });
  assert.equal(room.phase, 'lobby');
  room.handle(players[0], { t: 'start' });
  assert.equal(room.phase, 'countdown');
});

test('seats are handed out in join order and the room caps at four players', () => {
  const { room, players } = makeRoom(['A', 'B', 'C', 'D']);
  assert.equal(room.addPlayer(fakeSocket(), 'E'), null);
  room.handle(players[0], { t: 'start' });
  assert.deepEqual(
    players.map((p) => p.seat),
    [0, 1, 2, 3],
  );
});

test('players pick an animal, and unpicked players get a different one each', () => {
  const room = new Room('BCDF');
  const a = room.addPlayer(fakeSocket(), 'A', 'zeke');
  const b = room.addPlayer(fakeSocket(), 'B');
  const c = room.addPlayer(fakeSocket(), 'C', 'not-an-animal');
  assert.equal(a.animal, 'zeke');
  assert.notEqual(b.animal, 'zeke');
  assert.notEqual(c.animal, b.animal);
  room.handle(b, { t: 'animal', id: 'hattie' });
  assert.equal(b.animal, 'hattie');
  room.handle(b, { t: 'animal', id: 'dragon' });
  assert.equal(b.animal, 'hattie');
  const lobby = room.lobbyMessage();
  assert.deepEqual(
    lobby.players.map((p) => p.animal),
    ['zeke', 'hattie', c.animal],
  );
});

test('players can rename themselves in the lobby but not mid-race', () => {
  const { room, players } = makeRoom();
  room.handle(players[1], { t: 'rename', name: '  Captain  Bean!!  ' });
  assert.equal(players[1].name, 'Captain Bean');
  room.handle(players[1], { t: 'rename', name: '' });
  assert.equal(players[1].name, 'Captain Bean');
  room.handle(players[1], { t: 'rename', name: 'x'.repeat(40) });
  assert.equal(players[1].name.length, 14);
  room.handle(players[0], { t: 'start' });
  room.handle(players[1], { t: 'rename', name: 'Nope' });
  assert.notEqual(players[1].name, 'Nope');
});

test('animals cannot be swapped once the race has started', () => {
  const { room, players } = makeRoom();
  players[0].animal = 'leo';
  room.handle(players[0], { t: 'start' });
  room.handle(players[0], { t: 'animal', id: 'milo' });
  assert.equal(players[0].animal, 'leo');
});

test('countdown leads to go, then snapshots stream to every player', () => {
  const { room, sockets, players } = makeRoom();
  room.handle(players[0], { t: 'start' });
  ticks(room, 2);
  assert.equal(room.phase, 'countdown');
  ticks(room, 1.2);
  assert.equal(room.phase, 'racing');
  for (const s of sockets) {
    assert.equal(s.ofType('start').length, 1);
    assert.equal(s.ofType('go').length, 1);
    assert.ok(s.ofType('s').length > 5);
  }
});

test('blasts are ignored during the countdown and work once racing', () => {
  const { room, sockets, players } = makeRoom();
  room.handle(players[0], { t: 'start' });
  room.handle(players[0], { t: 'charge', on: true });
  room.handle(players[0], { t: 'charge', on: false });
  assert.equal(room.sim.bursts.length, 0);
  ticks(room, 3.2);
  room.handle(players[0], { t: 'charge', on: true });
  ticks(room, 0.5);
  room.handle(players[0], { t: 'charge', on: false });
  ticks(room, 0.1);
  const burst = sockets[1]
    .ofType('ev')
    .flatMap((m) => m.list)
    .find((e) => e.k === 'burst');
  assert.ok(burst, 'other players should see the burst');
  assert.equal(burst.seat, 0);
});

test('joystick input moves only the sender seat and ignores nonsense', () => {
  const { room, players } = makeRoom();
  room.handle(players[0], { t: 'start' });
  room.handle(players[1], { t: 'stick', a: 1.5, m: 99 });
  assert.equal(room.sim.seats[1].stickMag, 1);
  assert.equal(room.sim.seats[0].stickMag, 0);
  room.handle(players[0], { t: 'stick', a: 'x', m: 1 });
  assert.equal(room.sim.seats[0].stickMag, 0);
});

test('a dropped player can resume their seat with their token mid-race', () => {
  const { room, sockets, players } = makeRoom();
  room.handle(players[0], { t: 'start' });
  ticks(room, 3.2);
  room.detach(sockets[1]);
  assert.equal(players[1].connected, false);
  const back = room.resume(fakeSocket(), players[1].token);
  assert.equal(back, players[1]);
  assert.equal(back.seat, 1);
  assert.equal(back.connected, true);
  assert.equal(room.resume(fakeSocket(), 'wrong-token'), null);
});

test('a late joiner gets the race state and no nozzle', () => {
  const { room } = makeRoom();
  room.handle(room.host, { t: 'start' });
  ticks(room, 3.2);
  const late = fakeSocket();
  const player = room.addPlayer(late, 'Late');
  room.sendState(player);
  assert.equal(player.seat, -1);
  const start = late.ofType('start')[0];
  assert.equal(start.racing, true);
  assert.equal(start.seats.length, 2);
});

test('host moves on when the host leaves the lobby', () => {
  const { room, sockets, players } = makeRoom();
  room.detach(sockets[0]);
  assert.equal(room.host, players[1]);
});

test('only the host can change the river, and only to a real one', () => {
  const { room, players } = makeRoom();
  room.handle(players[1], { t: 'level', i: 2 });
  assert.equal(room.levelIndex, 0);
  room.handle(players[0], { t: 'level', i: 5 });
  assert.equal(room.levelIndex, 5);
  room.handle(players[0], { t: 'level', i: 99 });
  assert.equal(room.levelIndex, 5);
});

test('a player who drops in the lobby keeps their seat and character for the grace period', () => {
  const { room, sockets, players } = makeRoom();
  room.handle(players[1], { t: 'animal', id: 'hattie' });
  room.handle(players[1], { t: 'rename', name: 'Bob the Great' });
  room.detach(sockets[1]);
  assert.equal(players[1].connected, false);
  assert.ok(room.players.has(players[1].id), 'still in the room');
  const away = room.lobbyMessage().players.find((p) => p.id === players[1].id);
  assert.equal(away.connected, false);

  const back = room.resume(fakeSocket(), players[1].token);
  assert.equal(back, players[1]);
  assert.equal(back.connected, true);
  assert.equal(back.dropAt, null);
  assert.equal(back.animal, 'hattie');
  assert.equal(back.name, 'Bob the Great');
  assert.equal(back.color, players[1].color);
});

test('a solo creator can come back to the lobby after a refresh', () => {
  const { room, sockets, players } = makeRoom(['Solo']);
  room.detach(sockets[0]);
  assert.equal(room.isEmpty(), true);
  assert.equal(room.pruneDropped(), false);
  assert.equal(room.resume(fakeSocket(), players[0].token), players[0]);
});

test('away players are forgotten only after the grace period', () => {
  const { room, sockets, players } = makeRoom();
  room.detach(sockets[1]);
  ageDrop(players[1], RECONNECT_GRACE_MS - 1000);
  assert.equal(room.pruneDropped(), false);
  assert.ok(room.players.has(players[1].id));
  ageDrop(players[1], 2000);
  assert.equal(room.pruneDropped(), true);
  assert.equal(room.players.has(players[1].id), false);
  assert.equal(room.resume(fakeSocket(), players[1].token), null, 'the token is dead once the seat is released');
  assert.equal(sockets[0].ofType('lobby').at(-1).players.length, 1, 'the others see the seat free up');
});

test('leaving gives the seat up at once and kills the token', () => {
  const { room, sockets, players } = makeRoom();
  room.leave(sockets[1]);
  assert.equal(room.players.has(players[1].id), false);
  assert.equal(room.resume(fakeSocket(), players[1].token), null);
});

test('the host moves on while the host is away, and stays moved once they are forgotten', () => {
  const { room, sockets, players } = makeRoom(['A', 'B', 'C']);
  room.detach(sockets[0]);
  assert.equal(room.host, players[1]);
  assert.equal(room.lobbyMessage().host, players[1].id);
  ageDrop(players[0], RECONNECT_GRACE_MS + 1);
  room.pruneDropped();
  assert.equal(room.host, players[1]);
  assert.equal(room.players.size, 2);
  room.detach(sockets[1]);
  room.detach(sockets[2]);
  assert.equal(room.host, null, 'nobody connected, nobody hosts');
});

test('away players never turn a newcomer away from the lobby', () => {
  const { room, sockets, players } = makeRoom(['A', 'B', 'C', 'D']);
  room.detach(sockets[1]);
  ageDrop(players[1], 5000);
  room.detach(sockets[2]);
  const late = room.addPlayer(fakeSocket(), 'E');
  assert.ok(late, 'a full room with away players still admits a newcomer');
  assert.equal(room.players.has(players[1].id), false, 'the player gone longest made way');
  assert.equal(room.players.has(players[2].id), true);
  assert.ok(room.addPlayer(fakeSocket(), 'F'), 'and so does the next one');
  assert.equal(room.players.has(players[2].id), false);
  assert.equal(room.addPlayer(fakeSocket(), 'G'), null, 'once everyone is connected the cap holds');
  assert.equal(room.players.size, 4);
});

test('away players still hold their place in a race that is running', () => {
  const { room, sockets } = makeRoom(['A', 'B', 'C', 'D']);
  room.handle(room.host, { t: 'start' });
  room.detach(sockets[3]);
  assert.equal(room.addPlayer(fakeSocket(), 'E'), null);
});

test('a seated player who drops mid-race keeps the seat until the race is over, then gets a fresh grace period', () => {
  const { room, sockets, players } = makeRoom();
  room.handle(players[0], { t: 'start' });
  ticks(room, 3.2);
  room.detach(sockets[1]);
  ageDrop(players[1], RECONNECT_GRACE_MS * 10);
  assert.equal(room.pruneDropped(), false, 'the simulation still has a boat sector for them');
  assert.equal(room.players.has(players[1].id), true);

  room.sim.status = 'finished';
  ticks(room, 0.1);
  assert.equal(room.phase, 'finished');
  assert.equal(room.pruneDropped(), false, 'the results screen starts a new grace period');
  assert.equal(room.resume(fakeSocket(), players[1].token), players[1]);
});

test('going back to the lobby does not bypass the grace period', () => {
  const { room, sockets, players } = makeRoom();
  room.handle(players[0], { t: 'start' });
  room.detach(sockets[1]);
  room.handle(players[0], { t: 'lobby' });
  assert.equal(room.phase, 'lobby');
  assert.ok(room.players.has(players[1].id));
  assert.deepEqual(
    room.lobbyMessage().players.map((p) => p.seat),
    [-1, -1],
  );
});

test('a spectator who dropped during a race is forgotten after the grace period', () => {
  const { room } = makeRoom();
  room.handle(room.host, { t: 'start' });
  ticks(room, 3.2);
  const late = fakeSocket();
  const spectator = room.addPlayer(late, 'Late');
  room.detach(late);
  ageDrop(spectator, RECONNECT_GRACE_MS + 1);
  assert.equal(room.pruneDropped(), true);
  assert.equal(room.players.has(spectator.id), false);
});

test('resuming on the results screen replays the result', () => {
  const { room, sockets, players } = makeRoom();
  room.handle(players[0], { t: 'start' });
  ticks(room, 3.2);
  room.sim.status = 'finished';
  ticks(room, 0.1);
  const finish = sockets[0].ofType('finish')[0];
  assert.ok(finish, 'connected players got the result');

  room.detach(sockets[1]);
  const back = fakeSocket();
  const player = room.resume(back, players[1].token);
  room.sendState(player);
  assert.equal(back.ofType('lobby').at(-1).phase, 'finished');
  const start = back.ofType('start')[0];
  assert.equal(start.racing, true);
  assert.equal(start.seats.length, 2);
  assert.ok(back.ofType('s').length >= 1, 'final snapshot');
  assert.deepEqual(back.ofType('finish')[0], finish);
});

test('a lobby has no race screen to replay', () => {
  const { room, players } = makeRoom();
  const late = fakeSocket();
  const player = room.addPlayer(late, 'Late');
  room.sendState(player);
  assert.equal(late.ofType('start').length, 0);
  assert.equal(late.ofType('finish').length, 0);
  assert.equal(players.length, 2);
});

test('resumed and late-joining clients get a seat list that matches the simulation after a seated player leaves', () => {
  const { room, sockets, players } = makeRoom();
  room.handle(players[0], { t: 'start' });
  ticks(room, 3.2);
  room.leave(sockets[0]);
  assert.equal(room.sim.seats.length, 2);
  assert.deepEqual(
    room.startMessage().seats.map((s) => s.seat),
    [0, 1],
  );

  room.detach(sockets[1]);
  const back = fakeSocket();
  room.sendState(room.resume(back, players[1].token));
  const resumed = back.ofType('start')[0];
  assert.equal(resumed.seats.length, room.sim.seats.length);
  assert.equal(resumed.seats.find((s) => s.id === players[1].id).seat, 1);

  const late = fakeSocket();
  room.sendState(room.addPlayer(late, 'Late'));
  assert.equal(late.ofType('start')[0].seats.length, room.sim.seats.length);
});

test('the seat list is reset when the crew goes back to the lobby', () => {
  const { room, players } = makeRoom();
  room.handle(players[0], { t: 'start' });
  assert.equal(room.startMessage().seats.length, 2);
  room.handle(players[0], { t: 'lobby' });
  assert.deepEqual(room.seatList, []);
  assert.equal(room.result, null);
});

test('names and codes that are not strings never throw', () => {
  const hostile = [{ toString: 0 }, { toString: 1 }, { valueOf: () => ({}) }, [1, 2], 12, true, null, undefined, Symbol.iterator];
  for (const value of hostile) {
    assert.equal(cleanName(value, 'Fallback'), 'Fallback');
    assert.equal(cleanCode(value), '');
  }
  assert.equal(cleanName('  Bob!  ', 'x'), 'Bob');
  assert.equal(cleanCode('bcdfg'), 'BCDF');
  const room = new Room('BCDF');
  const player = room.addPlayer(fakeSocket(), { toString: 0 }, { toString: 0 });
  assert.match(player.name, /^Cheeky/);
  room.handle(player, { t: 'rename', name: { toString: 0 } });
  room.handle(player, { t: 'animal', id: { toString: 0 } });
  room.handle(player, { t: 'level', i: { valueOf: 0 } });
  assert.match(player.name, /^Cheeky/);
});

test('sweeping drops vacated rooms quickly and keeps rooms that are waiting for a reconnect', () => {
  const manager = new RoomManager();
  const solo = manager.create();
  const soloSocket = solo.addPlayer(fakeSocket(), 'Solo').ws;
  const crew = manager.create();
  const crewSockets = [fakeSocket(), fakeSocket()];
  crewSockets.forEach((ws, i) => crew.addPlayer(ws, `Crew ${i}`));
  const live = manager.create();
  live.addPlayer(fakeSocket(), 'Live');

  // Everybody in `solo` left on purpose: nobody can resume, so it goes within seconds.
  solo.leave(soloSocket);
  assert.equal(solo.players.size, 0);
  solo.lastActive = Date.now() - 11_000;
  // `crew` lost every socket, but both seats are inside the grace period.
  for (const ws of crewSockets) crew.detach(ws);
  crew.lastActive = Date.now() - 11_000;

  manager.sweep();
  assert.equal(manager.get(solo.code), null, 'a room with nobody in it is swept at once');
  assert.ok(manager.get(crew.code), 'a room of away players survives the grace period');
  assert.ok(manager.get(live.code));

  for (const p of crew.players.values()) ageDrop(p, RECONNECT_GRACE_MS + 1);
  manager.sweep();
  assert.equal(manager.get(crew.code), null, 'once the grace period is over the room goes with its last player');
  assert.ok(manager.get(live.code), 'rooms with people connected stay');
});

test('a room that was empty for longer than the reconnect grace period is swept even mid-race', () => {
  const manager = new RoomManager();
  const room = manager.create();
  const socket = fakeSocket();
  const player = room.addPlayer(socket, 'A');
  room.handle(player, { t: 'start' });
  room.detach(socket);
  manager.sweep();
  assert.ok(manager.get(room.code), 'a fresh drop is kept');
  room.lastActive = Date.now() - RECONNECT_GRACE_MS * 2 - 1000;
  manager.sweep();
  assert.equal(manager.get(room.code), null);
});

test('one room throwing in its tick closes only that room', (t) => {
  t.mock.method(console, 'error', () => {});
  const manager = new RoomManager();
  const broken = manager.create();
  const healthy = manager.create();
  const brokenSocket = fakeSocket();
  broken.addPlayer(brokenSocket, 'Doomed');
  const healthySocket = fakeSocket();
  const healthyPlayers = [healthy.addPlayer(healthySocket, 'Fine')];
  healthy.handle(healthyPlayers[0], { t: 'start' });
  broken.tick = () => {
    throw new Error('boom');
  };

  manager.lastTime = performance.now();
  manager.accumulator = DT * 3;
  manager.loop();

  assert.equal(manager.get(broken.code), null, 'the broken room is dropped');
  assert.ok(manager.get(healthy.code), 'the healthy room is untouched');
  assert.ok(healthy.countdown < 3, 'the healthy room kept ticking');
  assert.equal(brokenSocket.closed, true);
  assert.match(brokenSocket.ofType('err').at(-1).msg, /start a new one/);
});

test('the manager owns no timers once stopped', () => {
  const manager = new RoomManager();
  manager.start();
  assert.ok(manager.loopTimer && manager.sweepTimer);
  manager.stop();
  assert.equal(manager.loopTimer, null);
  assert.equal(manager.sweepTimer, null);
  manager.stop();
});

test('a per-caller limiter refills over time and forgets idle callers', () => {
  const limiter = createKeyedLimiter(1000, 2);
  const t0 = 1_000_000;
  assert.equal(limiter.take('a', t0), true);
  assert.equal(limiter.take('a', t0), true);
  assert.equal(limiter.take('a', t0), false);
  assert.equal(limiter.take('b', t0), true, 'callers are independent');
  assert.equal(limiter.has('a', t0 + 1000), true);
  assert.equal(limiter.take('a', t0 + 1000), true);
  assert.equal(limiter.take('a', t0 + 1000), false);
  limiter.prune(t0 + 120_000);
  assert.equal(limiter.size, 0);
});
