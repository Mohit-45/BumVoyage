import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { WebSocket } from 'ws';
import { startServer } from '../server/app.js';

function connect(port, headers) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`, { headers });
  const inbox = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.match(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const opened = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return {
    ws,
    inbox,
    opened,
    send: (obj) => ws.send(JSON.stringify(obj)),
    next(type, timeout = 4000) {
      const existing = inbox.find((m) => m.t === type);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeout);
        waiters.push({
          match: (m) => m.t === type,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('two devices can create, join, race and see each other fart', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const alice = connect(app.port);
  const bob = connect(app.port);
  await Promise.all([alice.opened, bob.opened]);

  alice.send({ t: 'create', name: 'Alice', animal: 'ringo' });
  const joined = await alice.next('joined');
  assert.match(joined.code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  assert.equal(joined.levels.length, 6);

  bob.send({ t: 'join', code: joined.code.toLowerCase(), name: 'Bob', animal: 'hattie' });
  await bob.next('joined');
  await sleep(100);
  const lobby = alice.inbox.filter((m) => m.t === 'lobby').at(-1);
  assert.deepEqual(
    lobby.players.map((p) => [p.name, p.animal]),
    [
      ['Alice', 'ringo'],
      ['Bob', 'hattie'],
    ],
  );

  bob.send({ t: 'start' });
  await sleep(100);
  assert.equal(alice.inbox.some((m) => m.t === 'start'), false, 'guests cannot start the race');

  alice.send({ t: 'start' });
  await Promise.all([alice.next('start'), bob.next('start')]);
  await Promise.all([alice.next('go', 6000), bob.next('go', 6000)]);

  alice.send({ t: 'stick', a: 0, m: 1 });
  alice.send({ t: 'charge', on: true });
  await sleep(450);
  alice.send({ t: 'charge', on: false });
  await sleep(300);
  const events = bob.inbox.filter((m) => m.t === 'ev').flatMap((m) => m.list);
  assert.ok(events.some((e) => e.k === 'burst' && e.seat === 0), "Bob sees Alice's burst");
  const snap = bob.inbox.filter((m) => m.t === 's').at(-1);
  assert.ok(snap, 'snapshots arrive');
  assert.ok(snap.gas[0] < 100, "Alice's tank dropped");
  assert.ok(snap.heat[0] > 0, "Alice's bum warmed up");
  assert.equal(snap.gas[1], 100, "Bob's tank is untouched");
  assert.equal(snap.heat[1], 0);

  alice.ws.close();
  bob.ws.close();
});

test('joining a missing room reports an error', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const c = connect(app.port);
  await c.opened;
  c.send({ t: 'join', code: 'BCDF', name: 'Zed' });
  const err = await c.next('err');
  assert.match(err.msg, /No room/);
  c.ws.close();
});

test('a dropped client resumes its seat with its token', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const first = connect(app.port);
  await first.opened;
  first.send({ t: 'create', name: 'Alice' });
  const joined = await first.next('joined');
  const other = connect(app.port);
  await other.opened;
  other.send({ t: 'join', code: joined.code, name: 'Bob' });
  await other.next('joined');
  first.send({ t: 'start' });
  await first.next('start');

  first.ws.terminate();
  await sleep(150);
  const back = connect(app.port);
  await back.opened;
  back.send({ t: 'resume', code: joined.code, token: joined.token });
  const again = await back.next('joined');
  assert.equal(again.you, joined.you);
  const start = await back.next('start');
  assert.ok(start.seats.some((s) => s.id === joined.you && s.seat === 0));
  back.ws.close();
  other.ws.close();
});

test('serves the game page, shared code, 3D library and a health check', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const base = `http://localhost:${app.port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Bum Voyage/);
  assert.equal((await fetch(`${base}/shared/course.js`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/three.min.js`)).status, 200);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/nope.js`)).status, 404);
});

// A plain http request with full control over headers; the body comes back undecoded.
function request(port, { path = '/', method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

// Writes `text` to a raw socket, so request lines Node's http client would refuse to
// build ('/%zz', '//') reach the server exactly as written.
function raw(port, text) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(text));
    let out = '';
    const finish = () => {
      socket.destroy();
      resolve(out);
    };
    socket.setTimeout(1500, finish);
    socket.on('data', (d) => {
      out += d;
    });
    socket.on('close', finish);
    socket.on('error', finish);
  });
}

const get = (port, target) => raw(port, `GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
const status = (response) => Number(response.match(/^HTTP\/1\.1 (\d+)/)?.[1] ?? 0);

async function healthy(port) {
  const res = await request(port, { path: '/healthz' });
  return res.status === 200 && res.body.toString() === 'ok';
}

const closed = (client) => new Promise((resolve) => client.ws.once('close', (code) => resolve(code)));

test('hostile http requests get an error response and never take the server down', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const targets = [
    '/%zz',
    '/%',
    '//',
    '///',
    '//x/y',
    '/\\',
    '/\\evil.example/x',
    '/%c0%ae%c0%ae/package.json',
    '/%00',
    '/..%2f..%2fpackage.json',
    '/%2e%2e/%2e%2e/package.json',
  ];
  const expected = new Map([
    ['/%zz', 400],
    ['/%', 400],
    ['//', 200],
    ['///', 200],
    ['//x/y', 404],
    ['/\\', 200],
    ['/\\evil.example/x', 404],
    ['/%c0%ae%c0%ae/package.json', 400],
    ['/%00', 400],
    ['/..%2f..%2fpackage.json', 403],
    ['/%2e%2e/%2e%2e/package.json', 404],
  ]);
  for (const target of targets) {
    const response = await get(app.port, target);
    assert.equal(status(response), expected.get(target), `GET ${target}`);
    assert.ok(await healthy(app.port), `still healthy after GET ${target}`);
  }
  const post = await request(app.port, { method: 'POST', path: '/index.html' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  assert.ok(await healthy(app.port));
});

test('upgrade requests for bad paths are dropped without killing the server', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  for (const target of ['//', '/%zz', '/', '/wss', '/ws/x']) {
    const response = await raw(
      app.port,
      `GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
    );
    assert.ok(!response.startsWith('HTTP/1.1 101'), `no websocket for ${target}`);
    assert.ok(await healthy(app.port), `still healthy after upgrade for ${target}`);
  }
  assert.equal(app.connections.size, 0, 'rejected upgrades are not counted as connections');
});

test('malformed websocket messages never crash the server or other players', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const bystander = connect(app.port);
  await bystander.opened;
  bystander.send({ t: 'create', name: 'Bystander' });
  const room = await bystander.next('joined');

  const attacker = connect(app.port);
  await attacker.opened;
  const hostile = [
    { t: 'create', name: { toString: 0 } },
    { t: 'create', name: { toString: 0 }, animal: { toString: 0 } },
    { t: 'join', code: { toString: 0 } },
    { t: 'join', code: { toString: 1 }, name: { toString: 0 } },
    { t: 'resume', code: { toString: 0 }, token: 'x' },
    { t: 'resume', code: room.code, token: { toString: 0 } },
    { t: 'resume', code: [room.code], token: ['x'] },
    { t: 'nonsense' },
    { t: 42 },
    { t: { toString: 0 } },
    [],
    null,
    'str',
    7,
  ];
  for (const msg of hostile) attacker.send(msg);
  attacker.ws.send('not json at all');
  attacker.ws.send(Buffer.from([0, 255, 254]));
  attacker.send({ t: 'create', name: 'Real' });
  await attacker.next('joined');
  attacker.send({ t: 'rename', name: { toString: 0 } });
  attacker.send({ t: 'level', i: { valueOf: 0 } });
  attacker.send({ t: 'animal', id: { toString: 0 } });
  attacker.send({ t: 'stick', a: { toString: 0 }, m: { toString: 0 } });
  attacker.send({ t: 'ping', ts: { toString: 0 } });
  await sleep(150);

  assert.ok(await healthy(app.port));
  assert.equal(attacker.ws.readyState, WebSocket.OPEN, 'merely malformed input does not even cost the connection');
  bystander.send({ t: 'rename', name: 'Still Here' });
  await sleep(100);
  assert.equal(bystander.inbox.filter((m) => m.t === 'lobby').at(-1).players[0].name, 'Still Here');
  bystander.ws.close();
  attacker.ws.close();
});

test('a handler that throws closes only the offending socket', async (t) => {
  t.mock.method(console, 'error', () => {});
  const app = await startServer(0);
  t.after(() => app.close());
  const good = connect(app.port);
  const bad = connect(app.port);
  await Promise.all([good.opened, bad.opened]);
  const original = app.manager.create.bind(app.manager);
  app.manager.create = () => {
    throw new Error('simulated bug');
  };
  const code = closed(bad);
  bad.send({ t: 'create' });
  assert.equal(await code, 1011);
  app.manager.create = original;
  assert.ok(await healthy(app.port));
  good.send({ t: 'create', name: 'Fine' });
  await good.next('joined');
  good.ws.close();
});

test('every crash payload from the review leaves /healthz answering', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  for (const target of ['/%zz', '/%', '//', '/%c0%ae%c0%ae/package.json']) await get(app.port, target);
  await raw(app.port, 'GET // HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
  const c = connect(app.port);
  await c.opened;
  for (const msg of [
    { t: 'create', name: { toString: 0 } },
    { t: 'join', code: { toString: 0 } },
    { t: 'resume', code: { toString: 0 }, token: 'x' },
    { t: 'rename', name: { toString: 0 } },
  ]) {
    c.send(msg);
  }
  await sleep(100);
  assert.ok(await healthy(app.port));
  c.ws.close();
});

test('security headers ride on every response, and HSTS only behind an https proxy', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const responses = [
    await request(app.port, { path: '/' }),
    await request(app.port, { path: '/healthz' }),
    await request(app.port, { path: '/nope.js' }),
    await request(app.port, { path: '/..%2fpackage.json' }),
    await request(app.port, { path: '/%zz' }),
    await request(app.port, { path: '/', method: 'POST' }),
  ];
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200, 404, 403, 400, 405],
  );
  for (const res of responses) {
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /base-uri 'self'/);
    assert.match(csp, /form-action 'self'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['strict-transport-security'], undefined);
  }
  const secure = await request(app.port, { path: '/', headers: { 'X-Forwarded-Proto': 'https' } });
  assert.equal(secure.headers['strict-transport-security'], 'max-age=31536000');
  const secureError = await request(app.port, { path: '/nope', headers: { 'X-Forwarded-Proto': 'https,http' } });
  assert.equal(secureError.headers['strict-transport-security'], 'max-age=31536000');
  const plain = await request(app.port, { path: '/', headers: { 'X-Forwarded-Proto': 'http' } });
  assert.equal(plain.headers['strict-transport-security'], undefined);
});

test('the http keep-alive outlasts a proxy idle timeout', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  assert.ok(app.server.keepAliveTimeout >= 65_000);
  assert.ok(app.server.headersTimeout > app.server.keepAliveTimeout);
});

test('static files are gzipped, validated with an ETag, and answered with 304', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const gz = { 'Accept-Encoding': 'gzip, deflate, br' };

  const plainRes = await request(app.port, { path: '/vendor/three.min.js' });
  assert.equal(plainRes.status, 200);
  assert.equal(plainRes.headers['content-encoding'], undefined);
  assert.equal(plainRes.headers.vary, 'Accept-Encoding');
  assert.equal(Number(plainRes.headers['content-length']), plainRes.body.length);

  const zipped = await request(app.port, { path: '/vendor/three.min.js', headers: gz });
  assert.equal(zipped.status, 200);
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(zipped.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(Number(zipped.headers['content-length']), zipped.body.length);
  assert.ok(zipped.body.length < plainRes.body.length / 2, 'much smaller on the wire');
  assert.ok(gunzipSync(zipped.body).equals(plainRes.body), 'and identical once decoded');
  assert.equal(zipped.headers.etag, plainRes.headers.etag);

  const refused = await request(app.port, { path: '/vendor/three.min.js', headers: { 'Accept-Encoding': 'gzip;q=0' } });
  assert.equal(refused.headers['content-encoding'], undefined);

  const { etag } = zipped.headers;
  assert.match(etag, /^W\/"[\w-]+"$/);
  assert.ok(zipped.headers['last-modified']);
  for (const header of [{ 'If-None-Match': etag }, { 'If-None-Match': `"other", ${etag}` }, { 'If-None-Match': '*' }]) {
    const res = await request(app.port, { path: '/vendor/three.min.js', headers: { ...gz, ...header } });
    assert.equal(res.status, 304);
    assert.equal(res.body.length, 0);
    assert.equal(res.headers.etag, etag);
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.match(res.headers['content-security-policy'], /frame-ancestors/);
  }
  const stale = await request(app.port, { path: '/vendor/three.min.js', headers: { 'If-None-Match': '"nope"' } });
  assert.equal(stale.status, 200);

  const byDate = await request(app.port, {
    path: '/vendor/three.min.js',
    headers: { 'If-Modified-Since': new Date(Date.now() + 60_000).toUTCString() },
  });
  assert.equal(byDate.status, 304);
  const oldDate = await request(app.port, { path: '/vendor/three.min.js', headers: { 'If-Modified-Since': new Date(0).toUTCString() } });
  assert.equal(oldDate.status, 200);
  const mismatch = await request(app.port, {
    path: '/vendor/three.min.js',
    headers: { 'If-None-Match': '"nope"', 'If-Modified-Since': new Date(Date.now() + 60_000).toUTCString() },
  });
  assert.equal(mismatch.status, 200, 'If-None-Match wins over If-Modified-Since');

  const head = await request(app.port, { path: '/vendor/three.min.js', method: 'HEAD', headers: gz });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], zipped.headers['content-length']);
  assert.equal(head.headers['content-encoding'], 'gzip');
});

test('text and the vendored library always revalidate, audio may be reused for an hour, and audio is not gzipped', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const gz = { 'Accept-Encoding': 'gzip' };
  const page = await request(app.port, { path: '/', headers: gz });
  assert.equal(page.headers['cache-control'], 'no-cache');
  assert.equal(page.headers['content-encoding'], 'gzip');
  assert.match(gunzipSync(page.body).toString(), /Bum Voyage/);
  for (const file of ['/js/main.js', '/css/style.css', '/audio/manifest.json', '/shared/levels.js']) {
    const res = await request(app.port, { path: file, headers: gz });
    assert.equal(res.status, 200, file);
    assert.equal(res.headers['cache-control'], 'no-cache', file);
  }
  // the bundle only holds the names the code uses, so a stale copy would break a newer page
  const vendor = await request(app.port, { path: '/vendor/three.min.js', headers: gz });
  assert.equal(vendor.headers['cache-control'], 'no-cache');

  const wav = await request(app.port, { path: '/audio/wet-fart.wav', headers: gz });
  assert.equal(wav.status, 200);
  assert.equal(wav.headers['content-type'], 'audio/wav');
  assert.equal(wav.headers['content-encoding'], undefined);
  assert.equal(wav.headers.vary, undefined);
  assert.equal(wav.headers['cache-control'], 'public, max-age=3600');
  assert.equal(Number(wav.headers['content-length']), wav.body.length);
  const again = await request(app.port, { path: '/audio/wet-fart.wav', headers: { 'If-None-Match': wav.headers.etag } });
  assert.equal(again.status, 304);
});

test('static requests for directories and missing files are 404s', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  for (const target of ['/js', '/js/', '/audio', '/nope.png']) assert.equal((await request(app.port, { path: target })).status, 404, target);
  assert.ok(await healthy(app.port));
});

test('too many connections from one address are refused, and the count never leaks', async (t) => {
  const app = await startServer(0, { maxConnectionsPerIp: 3 });
  t.after(() => app.close());
  const open = [];
  for (let i = 0; i < 3; i++) {
    const c = connect(app.port);
    await c.opened;
    open.push(c);
  }
  const refused = connect(app.port);
  const rejection = await new Promise((resolve) => {
    refused.ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
    refused.ws.on('error', () => {});
  });
  assert.equal(rejection, 429);

  const behindProxy = connect(app.port, { 'X-Forwarded-For': '203.0.113.7, 10.0.0.1' });
  await behindProxy.opened;
  assert.equal(app.connections.get('203.0.113.7'), 1, 'the first X-Forwarded-For hop is the caller');
  open.push(behindProxy);

  const first = open.shift();
  first.ws.close();
  await closed(first);
  const replacement = connect(app.port);
  await replacement.opened;
  open.push(replacement);

  for (const c of open) c.ws.close();
  await Promise.all(open.map(closed));
  await sleep(50);
  assert.equal(app.connections.size, 0, 'closed sockets release their slot');
  assert.ok(await healthy(app.port));
});

test('room creation is rate limited per address', async (t) => {
  const app = await startServer(0, { createBurst: 2, createRefillMs: 600_000 });
  t.after(() => app.close());
  const c = connect(app.port);
  await c.opened;
  for (let i = 0; i < 2; i++) {
    c.send({ t: 'create', name: 'Churn' });
    await sleep(50);
    c.send({ t: 'leave' });
    await sleep(50);
  }
  assert.equal(c.inbox.filter((m) => m.t === 'joined').length, 2);
  c.send({ t: 'create', name: 'Churn' });
  await sleep(100);
  assert.equal(c.inbox.filter((m) => m.t === 'joined').length, 2, 'the third room is refused');
  assert.match(c.inbox.filter((m) => m.t === 'err').at(-1).msg, /too quickly/);

  const other = connect(app.port, { 'X-Forwarded-For': '198.51.100.9' });
  await other.opened;
  other.send({ t: 'create', name: 'Neighbour' });
  await other.next('joined');
  c.ws.close();
  other.ws.close();
});

test('guessing room codes is throttled, but valid joins still work', async (t) => {
  const app = await startServer(0, { joinMissBurst: 3, joinMissRefillMs: 600_000 });
  t.after(() => app.close());
  const host = connect(app.port, { 'X-Forwarded-For': '192.0.2.1' });
  await host.opened;
  host.send({ t: 'create', name: 'Host' });
  const { code } = await host.next('joined');

  const guesser = connect(app.port, { 'X-Forwarded-For': '192.0.2.50' });
  await guesser.opened;
  for (const guess of ['BBBB', 'CCCC', 'DDDD']) {
    guesser.send({ t: 'join', code: guess });
    await sleep(30);
  }
  assert.equal(guesser.inbox.filter((m) => /No room/.test(m.msg ?? '')).length, 3);
  guesser.send({ t: 'join', code });
  await sleep(100);
  assert.equal(guesser.inbox.some((m) => m.t === 'joined'), false, 'a scanner is locked out even for a real code');
  assert.match(guesser.inbox.filter((m) => m.t === 'err').at(-1).msg, /wrong codes/);

  const friend = connect(app.port, { 'X-Forwarded-For': '192.0.2.77' });
  await friend.opened;
  friend.send({ t: 'join', code, name: 'Friend' });
  await friend.next('joined');
  host.ws.close();
  guesser.ws.close();
  friend.ws.close();
});

test('a socket that floods past the message limit is disconnected', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const flooder = connect(app.port);
  const bystander = connect(app.port);
  await Promise.all([flooder.opened, bystander.opened]);
  const code = closed(flooder);
  const burst = JSON.stringify({ t: 'ping', ts: 1 });
  for (let i = 0; i < 1500 && flooder.ws.readyState === WebSocket.OPEN; i++) flooder.ws.send(burst);
  assert.ok([1006, 1005, 1000].includes(await code), 'the server dropped the flooder');
  assert.equal(bystander.ws.readyState, WebSocket.OPEN, 'other connections are unaffected');
  assert.ok(await healthy(app.port));
  bystander.ws.close();
});

test('a lobby player who refreshes gets the same seat, name and character back', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const alice = connect(app.port);
  const bob = connect(app.port);
  await Promise.all([alice.opened, bob.opened]);
  alice.send({ t: 'create', name: 'Alice', animal: 'ringo' });
  const joined = await alice.next('joined');
  bob.send({ t: 'join', code: joined.code, name: 'Bob', animal: 'hattie' });
  await bob.next('joined');

  alice.ws.close();
  await closed(alice);
  await sleep(100);
  const whileAway = bob.inbox.filter((m) => m.t === 'lobby').at(-1);
  assert.equal(whileAway.players.length, 2, 'Bob still sees Alice in the room');
  assert.equal(whileAway.players.find((p) => p.name === 'Alice').connected, false);
  assert.equal(whileAway.host, whileAway.players.find((p) => p.name === 'Bob').id, 'the host role moves while she is away');

  const back = connect(app.port);
  await back.opened;
  back.send({ t: 'resume', code: joined.code, token: joined.token });
  const again = await back.next('joined');
  assert.equal(again.you, joined.you);
  assert.equal(again.token, joined.token);
  const lobby = await back.next('lobby');
  assert.deepEqual(
    lobby.players.map((p) => [p.name, p.animal, p.connected]),
    [
      ['Alice', 'ringo', true],
      ['Bob', 'hattie', true],
    ],
  );
  back.ws.close();
  bob.ws.close();
});

test('a failed resume keeps the error shape the client expects', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const c = connect(app.port);
  await c.opened;
  c.send({ t: 'resume', code: 'BCDF', token: 'nope' });
  const err = await c.next('err');
  assert.equal(err.code, 'resume-failed');
  assert.equal(typeof err.msg, 'string');
  assert.doesNotMatch(err.msg, /ended/);
  c.ws.close();
});

test('shutdown tells players, closes their sockets and stops the server', async () => {
  const app = await startServer(0);
  const c = connect(app.port);
  await c.opened;
  c.send({ t: 'create' });
  await c.next('joined');
  const code = closed(c);
  await app.shutdown(2000);
  assert.equal(await code, 1012);
  assert.match((await c.next('err')).msg, /restarting/);
  await assert.rejects(request(app.port, { path: '/healthz' }));
  assert.equal(app.manager.loopTimer, null);
});

test('a port that is already taken fails startup instead of hanging', async () => {
  const first = await startServer(0);
  try {
    await assert.rejects(startServer(first.port), { code: 'EADDRINUSE' });
  } finally {
    await first.close();
  }
});

// The entry point is exercised in a child process so the process-level handlers, the
// signal handling and the exit codes are the real ones.
const indexPath = fileURLToPath(new URL('../server/index.js', import.meta.url));

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startChild(extra = '') {
  return freePort().then(
    (port) =>
      new Promise((resolve, reject) => {
        const code = `await import(${JSON.stringify(indexPath)}); ${extra}`;
        const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
          env: { ...process.env, PORT: String(port) },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const out = { stdout: '', stderr: '' };
        child.stdout.on('data', (d) => {
          out.stdout += d;
          if (out.stdout.includes('listening')) resolve({ child, port, out });
        });
        child.stderr.on('data', (d) => {
          out.stderr += d;
        });
        child.on('error', reject);
        child.on('exit', (exitCode) => {
          out.exitCode = exitCode;
          reject(new Error(`server exited early with ${exitCode}: ${out.stderr}`));
        });
      }),
  );
}

const exited = (child) => new Promise((resolve) => (child.exitCode !== null ? resolve(child.exitCode) : child.once('exit', resolve)));

test('the server process survives stray errors, then exits cleanly on SIGTERM', async () => {
  const { child, port, out } = await startChild(
    "setTimeout(() => { throw new Error('stray throw'); }, 150); setTimeout(() => { Promise.reject(new Error('stray rejection')); }, 200);",
  );
  child.removeAllListeners('exit');
  try {
    await sleep(700);
    assert.equal(child.exitCode, null, 'still running after an uncaught exception and a rejected promise');
    assert.ok(await healthy(port));
    assert.match(out.stderr, /stray throw/);
    assert.match(out.stderr, /stray rejection/);

    const player = connect(port);
    await player.opened;
    player.send({ t: 'create', name: 'Deploy' });
    await player.next('joined');
    const code = closed(player);
    child.kill('SIGTERM');
    assert.equal(await code, 1012, 'players are told the server is restarting');
    assert.equal(await exited(child), 0, 'a clean exit code');
  } finally {
    child.kill('SIGKILL');
  }
});

test('the server process exits for a clean restart when errors will not stop', async () => {
  const { child } = await startChild("for (let i = 0; i < 40; i++) setTimeout(() => { throw new Error('storm ' + i); }, 100 + i * 5);");
  child.removeAllListeners('exit');
  try {
    assert.equal(await exited(child), 1);
  } finally {
    child.kill('SIGKILL');
  }
});

test('the server process exits with an error when its port is taken', async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, resolve));
  const { port } = blocker.address();
  try {
    const child = spawn(process.execPath, [indexPath], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    assert.equal(await exited(child), 1);
  } finally {
    blocker.close();
  }
});
