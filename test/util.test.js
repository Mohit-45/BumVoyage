import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, cleanCode, cleanName, requestPathname } from '../server/util.js';

const req = (forwarded, peer = '10.0.0.9') => ({ headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded }, socket: { remoteAddress: peer } });

test('clientIp takes the first forwarded hop by default and the socket peer without the header', () => {
  assert.equal(clientIp(req('1.2.3.4, 10.1.1.1')), '1.2.3.4');
  assert.equal(clientIp(req(undefined)), '10.0.0.9');
  assert.equal(clientIp(req('')), '10.0.0.9');
});

test('clientIp counts from the right when told how many proxy hops are trusted', () => {
  // a client that sends its own X-Forwarded-For ends up first: the proxy appends the real address
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4'), 1), '1.2.3.4');
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4, 172.16.0.1'), 2), '1.2.3.4');
  assert.equal(clientIp(req('1.2.3.4'), 3), '1.2.3.4');
});

test('clientIp never throws on odd input', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': ['a', 'b'] }, socket: { remoteAddress: '::1' } }), '::1');
  assert.ok(clientIp(req('x'.repeat(500))).length <= 64);
});

test('names and room codes only ever coerce real strings', () => {
  assert.equal(cleanName({ toString: 0 }, 'Fallback'), 'Fallback');
  assert.equal(cleanName('  <b>Gus</b>  the   Great and Powerful', 'x'), 'bGusb the Grea');
  assert.equal(cleanCode({ toString: 0 }), '');
  assert.equal(cleanCode('ab-cd9ef'), 'ABCD');
});

test('requestPathname survives paths that used to crash the server', () => {
  for (const bad of ['//', '/%', '/%zz', '/%c0%ae%c0%ae/package.json', '\\\\']) {
    assert.doesNotThrow(() => requestPathname(bad), bad);
  }
  assert.equal(requestPathname('/index.html?x=1'), '/index.html');
  assert.equal(requestPathname('//evil.example/path'), '/evil.example/path');
  assert.equal(requestPathname(undefined), null);
});
