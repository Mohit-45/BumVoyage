const SESSION_KEY = 'bumvoyage.session';

const PING_EVERY_MS = 3000;
// The server answers pings (and streams snapshots), so this long without any inbound message means the socket is dead.
const DEAD_AFTER_MS = 6000;
// After the page wakes up, a socket gets this long to prove it is still alive.
const WAKE_PROBE_MS = 3000;
const CONNECT_TIMEOUT_MS = 8000;
// A socket must stay open this long before the reconnect backoff starts over.
const STABLE_MS = 10000;
const QUEUE_TTL_MS = 15000;
const QUEUE_MAX = 16;
const CLAIM_WAIT_MS = 400;

// Used when sessionStorage is blocked, so a dropped connection can still resume within this page.
let memorySession = null;
const claimed = new Set();

function parseSession(raw) {
  try {
    const session = JSON.parse(raw);
    return session && typeof session.code === 'string' && typeof session.token === 'string' ? session : null;
  } catch {
    return null;
  }
}

export function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return parseSession(raw);
  } catch {
    /* storage unavailable: use the in-memory copy */
  }
  return memorySession;
}

export function writeSession(session) {
  memorySession = session ?? null;
  if (session) claimSession(session.token);
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}

// A duplicated or restored tab inherits sessionStorage, token included. Two live pages resuming one
// player would kick each other forever, so each token is claimed with a Web Lock that this page holds
// until it goes away. A second page finds the token taken (resolves false) and should start fresh.
export function claimSession(token) {
  const locks = globalThis.navigator?.locks;
  if (claimed.has(token) || !locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    // Wait briefly instead of failing at once: a reloading page's lock is released as it unloads.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), CLAIM_WAIT_MS);
    const granted = () => {
      clearTimeout(timer);
      claimed.add(token);
      resolve(true);
      return new Promise(() => {});
    };
    try {
      locks.request(`bumvoyage:${token}`, { signal: abort.signal }, granted).catch((err) => {
        clearTimeout(timer);
        resolve(err?.name !== 'AbortError');
      });
    } catch {
      clearTimeout(timer);
      resolve(true);
    }
  });
}

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.queue = [];
    this.attempts = 0;
    this.rtt = 0;
    this.wantOpen = false;
    this.reconnectTimer = null;
    this.connectTimer = null;
    this.watchTimer = null;
    this.openedAt = 0;
    this.lastMsgAt = 0;
    this.lastPingAt = 0;
    this.lastTickAt = 0;
    globalThis.addEventListener?.('online', () => this.wake());
    globalThis.document?.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.wake();
    });
  }

  get online() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, data) {
    for (const fn of this.handlers.get(type) ?? []) fn(data);
  }

  connect() {
    this.wantOpen = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(this.reconnectTimer);
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${scheme}://${location.host}/ws`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.emit('status', 'connecting');
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) this.markDead();
    }, CONNECT_TIMEOUT_MS);
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      clearTimeout(this.connectTimer);
      this.openedAt = performance.now();
      this.lastMsgAt = this.openedAt;
      this.lastPingAt = this.openedAt;
      // Resume first, even when messages queued up while offline: they then apply to the resumed player
      // (or are ignored if the resume fails). Only a create or join starts a new seat instead.
      const session = readSession();
      const entering = this.queue.some((item) => item.t === 'create' || item.t === 'join');
      if (session && !entering) ws.send(JSON.stringify({ t: 'resume', code: session.code, token: session.token }));
      for (const item of this.queue) if (this.openedAt - item.at <= QUEUE_TTL_MS) ws.send(item.text);
      this.queue = [];
      this.emit('status', 'open');
      this.startWatch();
    });
    ws.addEventListener('message', (event) => {
      if (this.ws !== ws) return;
      this.lastMsgAt = performance.now();
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        this.rtt = Math.round(performance.now() - msg.ts);
        return;
      }
      this.emit(msg.t, msg);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      clearTimeout(this.connectTimer);
      this.stopWatch();
      this.emit('status', 'closed');
      if (this.wantOpen) this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {});
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(5000, 400 * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  // Lets go of the current socket without waiting for it: its late events are ignored from now on.
  drop() {
    const old = this.ws;
    this.ws = null;
    clearTimeout(this.connectTimer);
    this.stopWatch();
    if (old) {
      try {
        old.close();
      } catch {
        /* already gone */
      }
    }
  }

  // The socket claims to be open (or still connecting) but is not delivering: start over with backoff.
  markDead() {
    this.drop();
    this.emit('status', 'closed');
    if (this.wantOpen) this.scheduleReconnect();
  }

  // Discards the current socket and opens a fresh one right away.
  reconnect() {
    clearTimeout(this.reconnectTimer);
    this.drop();
    this.attempts = 0;
    this.connect();
  }

  // The page came back to the foreground or the network came back. Sockets often die silently while a
  // phone sleeps, so replace one that is closed and make an open one prove it is alive.
  wake() {
    if (!this.wantOpen || !this.ws) {
      if (this.wantOpen) this.reconnect();
      return;
    }
    if (this.ws.readyState > WebSocket.OPEN) {
      this.reconnect();
    } else if (this.ws.readyState === WebSocket.OPEN) {
      const now = performance.now();
      this.lastMsgAt = Math.max(this.lastMsgAt, now - DEAD_AFTER_MS + WAKE_PROBE_MS);
      this.lastPingAt = now;
      this.send({ t: 'ping', ts: now }, true);
    }
  }

  startWatch() {
    this.stopWatch();
    this.lastTickAt = performance.now();
    this.watchTimer = setInterval(() => this.tick(), 1000);
  }

  stopWatch() {
    clearInterval(this.watchTimer);
  }

  tick() {
    const now = performance.now();
    const starved = now - this.lastTickAt > 2500;
    this.lastTickAt = now;
    // A throttled or suspended page cannot tell silence from sleep: probe instead of giving up.
    if (starved) {
      this.wake();
      return;
    }
    // Only a seated socket is watched: the server answers pings from players in a room.
    if (readSession() && now - this.lastMsgAt > DEAD_AFTER_MS) {
      this.markDead();
      return;
    }
    if (now - this.lastPingAt >= PING_EVERY_MS - 250) {
      this.lastPingAt = now;
      this.send({ t: 'ping', ts: now }, true);
    }
    if (this.attempts > 0 && now - this.openedAt > STABLE_MS) this.attempts = 0;
  }

  send(obj, dropIfClosed = false) {
    const text = JSON.stringify(obj);
    if (this.online) {
      this.ws.send(text);
    } else if (!dropIfClosed) {
      this.queue.push({ t: obj.t, text, at: performance.now() });
      if (this.queue.length > QUEUE_MAX) this.queue.shift();
      this.connect();
    }
  }

  clearQueue() {
    this.queue = [];
  }

  close() {
    this.wantOpen = false;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectTimer);
    this.stopWatch();
    if (this.ws) this.ws.close();
  }
}
