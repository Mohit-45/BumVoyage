import http from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { WebSocketServer } from 'ws';
import { LEVELS } from '../public/shared/levels.js';
import { RoomManager } from './RoomManager.js';
import { cleanCode, clientIp, createKeyedLimiter, createRateLimiter, requestPathname } from './util.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const gzipAsync = promisify(gzip);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

// Sent on every response, errors included. HSTS only goes out when the proxy says the
// visitor came in over https, so plain-http local runs are never pinned to https.
function securityHeaders(req) {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  return proto === 'https' ? { ...SECURITY_HEADERS, 'Strict-Transport-Security': 'max-age=31536000' } : SECURITY_HEADERS;
}

const LEVEL_INFO = LEVELS.map(({ id, name, tagline }) => ({ id, name, tagline }));

// Defaults for the per-address limits; startServer options override them (the tests do).
// Households and offices share one address, so these are generous.
const LIMITS = {
  maxConnectionsPerIp: 20,
  createBurst: 15,
  createRefillMs: 2_000,
  joinMissBurst: 20,
  joinMissRefillMs: 2_000,
  maxRooms: undefined,
};
// A socket that has more than this many messages dropped by the rate limiter inside one
// window is flooding, and is disconnected.
const FLOOD_DROPS = 200;
const FLOOD_WINDOW_MS = 10_000;

function sendJson(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function plain(res, headers, status, text, extra) {
  res.writeHead(status, { ...headers, ...extra, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(text);
}

// Text assets are served gzipped. Everything else is already compressed (png, audio) or
// does not shrink. Compressed bytes are cached per file and thrown away when the file
// changes; the cache can only ever hold files that exist under public/.
const TEXT_TYPES = new Set(['.html', '.js', '.css', '.json', '.svg']);
const MIN_GZIP_BYTES = 1024;
const fileCache = new Map();

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(`W/"${hash.digest('base64url').slice(0, 22)}"`));
  });
}

// The ETag comes from the file's content, so a redeploy that rewrites unchanged files
// (new mtimes) still answers 304 instead of sending them all again.
function fileEntry(file, st) {
  let entry = fileCache.get(file);
  if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
    const fresh = {
      mtimeMs: st.mtimeMs,
      size: st.size,
      etag: hashFile(file),
      gz: null,
      forget() {
        if (fileCache.get(file) === fresh) fileCache.delete(file);
      },
    };
    fresh.etag.catch(fresh.forget);
    fileCache.set(file, fresh);
    entry = fresh;
  }
  return entry;
}

function gzipped(file, entry) {
  if (!entry.gz) {
    entry.gz = readFile(file).then((raw) => gzipAsync(raw, { level: 9 }));
    entry.gz.catch(entry.forget);
  }
  return entry.gz;
}

// Vendor files are not fingerprinted and audio clips are paired with manifest.json, so
// nothing is cached for long: our own text revalidates on every load (a cheap 304), while
// binary assets and the vendored library may be reused for an hour.
function cacheControl(rel, ext) {
  return TEXT_TYPES.has(ext) && !rel.startsWith('/vendor/') ? 'no-cache' : 'public, max-age=3600';
}

function acceptsGzip(req) {
  for (const part of String(req.headers['accept-encoding'] ?? '').split(',')) {
    const [coding, ...params] = part.trim().toLowerCase().split(';');
    if (coding.trim() !== 'gzip') continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  }
  return false;
}

function isNotModified(req, etag, mtimeMs) {
  const none = req.headers['if-none-match'];
  if (none) {
    const mine = etag.replace(/^W\//, '');
    return none.trim() === '*' || none.split(',').some((tag) => tag.trim().replace(/^W\//, '') === mine);
  }
  const since = Date.parse(req.headers['if-modified-since'] ?? '');
  return Number.isFinite(since) && Math.floor(mtimeMs / 1000) * 1000 <= since;
}

async function serveStatic(req, res) {
  const headers = securityHeaders(req);
  const pathname = requestPathname(req.url);
  if (pathname === '/healthz') return plain(res, headers, 200, 'ok');
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, headers, 405, 'Method not allowed', { Allow: 'GET, HEAD' });

  let rel = null;
  if (pathname !== null) {
    try {
      rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
    } catch {
      /* malformed percent-encoding */
    }
  }
  if (rel === null || rel.includes('\0')) return plain(res, headers, 400, 'Bad request');
  const file = path.normalize(path.join(publicDir, rel));
  if (!file.startsWith(publicDir + path.sep)) return plain(res, headers, 403, 'Forbidden');

  let st;
  try {
    st = await stat(file);
  } catch {
    st = null;
  }
  if (!st || !st.isFile()) return plain(res, headers, 404, 'Not found');

  const ext = path.extname(file);
  const compressible = TEXT_TYPES.has(ext) && st.size >= MIN_GZIP_BYTES;
  const entry = fileEntry(file, st);
  let etag;
  try {
    etag = await entry.etag;
  } catch {
    return plain(res, headers, 404, 'Not found');
  }
  const common = {
    ...headers,
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
    'Cache-Control': cacheControl(rel, ext),
    ...(compressible && { Vary: 'Accept-Encoding' }),
  };
  if (isNotModified(req, etag, st.mtimeMs)) {
    res.writeHead(304, common);
    res.end();
    return;
  }
  const type = { ...common, 'Content-Type': MIME[ext] ?? 'application/octet-stream' };
  const head = req.method === 'HEAD';
  if (compressible && acceptsGzip(req)) {
    const body = await gzipped(file, entry);
    if (body.length < st.size) {
      res.writeHead(200, { ...type, 'Content-Encoding': 'gzip', 'Content-Length': body.length });
      res.end(head ? undefined : body);
      return;
    }
  }
  res.writeHead(200, { ...type, 'Content-Length': st.size });
  if (head) {
    res.end();
    return;
  }
  // Streamed, so a slow reader costs a buffer's worth of memory rather than the whole file.
  pipeline(createReadStream(file), res, () => {});
}

export function startServer(port, options = {}) {
  const limits = { ...LIMITS, ...options };
  const manager = new RoomManager({ maxRooms: limits.maxRooms });
  const server = http.createServer((req, res) => {
    serveStatic(req, res).catch((err) => {
      console.error('static request failed', err);
      if (!res.headersSent) res.writeHead(500, { ...securityHeaders(req), 'Content-Type': 'text/plain; charset=utf-8' });
      res.end();
    });
  });
  // Longer than a reverse proxy's idle timeout, or it reuses a connection that Node has
  // just closed and the visitor sees a 502.
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });

  const connections = new Map();
  const createLimit = createKeyedLimiter(limits.createRefillMs, limits.createBurst);
  const joinMisses = createKeyedLimiter(limits.joinMissRefillMs, limits.joinMissBurst);
  const guards = { createLimit, joinMisses };

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    try {
      if (requestPathname(req.url) !== '/ws') {
        socket.destroy();
        return;
      }
      const ip = clientIp(req);
      const open = connections.get(ip) ?? 0;
      if (open >= limits.maxConnectionsPerIp) {
        socket.end('HTTP/1.1 429 Too Many Requests\r\nRetry-After: 10\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        return;
      }
      connections.set(ip, open + 1);
      socket.once('close', () => {
        const left = (connections.get(ip) ?? 1) - 1;
        if (left > 0) connections.set(ip, left);
        else connections.delete(ip);
      });
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } catch (err) {
      console.error('websocket upgrade failed', err);
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.player = null;
    ws.room = null;
    ws.ip = clientIp(req);
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    // A handler that throws must not take the process down. The socket that caused it
    // is closed; the client reconnects and resumes like after any other drop.
    const guarded = (handler) => (...args) => {
      try {
        handler(...args);
      } catch (err) {
        console.error('websocket handler failed', err);
        ws.close(1011, 'Server error');
      }
    };
    const allow = createRateLimiter(90, 120);
    let drops = 0;
    let windowStart = 0;
    ws.on(
      'message',
      guarded((data) => {
        if (!allow()) {
          const now = Date.now();
          if (now - windowStart > FLOOD_WINDOW_MS) {
            windowStart = now;
            drops = 0;
          }
          if (++drops > FLOOD_DROPS) ws.terminate();
          return;
        }
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (!msg || typeof msg.t !== 'string') return;
        onMessage(manager, ws, msg, guards);
      }),
    );
    ws.on(
      'close',
      guarded(() => {
        if (ws.room) ws.room.detach(ws);
      }),
    );
    ws.on('error', () => {});
  });

  let heartbeat = null;
  let closing = null;
  function close() {
    closing ??= new Promise((done) => {
      clearInterval(heartbeat);
      manager.stop();
      for (const ws of wss.clients) ws.terminate();
      server.close(done);
      server.closeAllConnections?.();
    });
    return closing;
  }

  // Deploys and restarts: tell everyone, give the close frames a moment to go out, then stop.
  async function shutdown(graceMs = 1500) {
    for (const ws of wss.clients) {
      sendJson(ws, { t: 'err', msg: 'The server is restarting. Rejoin in a minute.' });
      ws.close(1012, 'Server restarting');
    }
    const deadline = Date.now() + graceMs;
    while (wss.clients.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    return close();
  }

  // Timers start only once the port is bound, so a failed listen leaves nothing running.
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      server.on('error', (err) => console.error('http server error', err));
      heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
          if (!ws.isAlive) {
            ws.terminate();
            continue;
          }
          ws.isAlive = false;
          ws.ping();
        }
        createLimit.prune();
        joinMisses.prune();
      }, 25_000);
      manager.start();
      resolve({ server, manager, port: server.address().port, close, shutdown, connections });
    });
  });
}

function onMessage(manager, ws, msg, guards) {
  if (ws.player && ws.room) {
    if (msg.t === 'leave') ws.room.leave(ws);
    else ws.room.handle(ws.player, msg);
    return;
  }
  if (msg.t === 'create') {
    if (!guards.createLimit.take(ws.ip)) {
      return sendJson(ws, { t: 'err', msg: 'You are creating rooms too quickly. Wait a few seconds and try again.' });
    }
    const room = manager.create();
    if (!room) return sendJson(ws, { t: 'err', msg: 'The server is full right now. Try again soon.' });
    return enter(ws, room, room.addPlayer(ws, msg.name, msg.animal));
  }
  if (msg.t === 'join') {
    if (!guards.joinMisses.has(ws.ip)) {
      return sendJson(ws, { t: 'err', msg: 'Too many wrong codes. Wait a moment and try again.' });
    }
    const room = manager.get(cleanCode(msg.code));
    if (!room) {
      guards.joinMisses.take(ws.ip);
      return sendJson(ws, { t: 'err', msg: 'No room with that code.' });
    }
    const player = room.addPlayer(ws, msg.name, msg.animal);
    if (!player) return sendJson(ws, { t: 'err', msg: 'That room is full (4 players max).' });
    return enter(ws, room, player);
  }
  if (msg.t === 'resume') {
    const room = manager.get(cleanCode(msg.code));
    const player = room && typeof msg.token === 'string' ? room.resume(ws, msg.token) : null;
    if (!player) {
      return sendJson(ws, {
        t: 'err',
        code: 'resume-failed',
        msg: 'Could not rejoin your room. It may have closed, or you were away too long.',
      });
    }
    return enter(ws, room, player);
  }
  return undefined;
}

function enter(ws, room, player) {
  sendJson(ws, { t: 'joined', code: room.code, you: player.id, token: player.token, levels: LEVEL_INFO });
  room.sendState(player);
}
