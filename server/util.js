import { randomBytes } from 'node:crypto';

const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

export function makeCode(exists) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    const bytes = randomBytes(4);
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!exists(code)) return code;
  }
  return null;
}

export function makeToken() {
  return randomBytes(12).toString('hex');
}

// Client JSON can carry any type, and String() throws on objects like {"toString":0},
// so only real strings are ever coerced.
export function cleanName(raw, fallback) {
  const name = (typeof raw === 'string' ? raw : '')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return name || fallback;
}

export function cleanCode(raw) {
  return (typeof raw === 'string' ? raw : '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4);
}

// The path part of a request target, or null when it cannot be parsed. Leading
// slashes (a backslash counts as one to the URL parser) are collapsed first because
// '//x' would otherwise parse as a host-relative URL ('//' alone is invalid and throws).
export function requestPathname(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  try {
    return new URL(rawUrl.replace(/^[/\\]{2,}/, '/'), 'http://localhost').pathname;
  } catch {
    return null;
  }
}

// The caller's address. The app sits behind Render's proxy, which appends to X-Forwarded-For,
// so by default the first hop is taken as the client; without the header it is the socket peer.
// A client can prepend hops of its own, though. Once you know how many hops the platform appends,
// set TRUST_PROXY_HOPS to that number to count from the right instead (1 = the address the
// nearest proxy saw connecting). Do not guess: with too small a count every visitor shares one address.
export function clientIp(req, trustedHops = Number(process.env.TRUST_PROXY_HOPS) || 0) {
  const forwarded = req.headers['x-forwarded-for'];
  const hops = typeof forwarded === 'string' ? forwarded.split(',').map((hop) => hop.trim()).filter(Boolean) : [];
  const hop = trustedHops > 0 ? hops[Math.max(0, hops.length - trustedHops)] : hops[0];
  return (hop || req.socket.remoteAddress || 'unknown').slice(0, 64);
}

export function createRateLimiter(ratePerSecond, burst) {
  let tokens = burst;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * ratePerSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

// Token buckets per key (an IP address). `take` spends a token and says whether there
// was one; `has` only looks. `prune` forgets buckets that have been idle for a minute so
// the map cannot grow with the number of distinct callers.
export function createKeyedLimiter(refillMs, burst) {
  const buckets = new Map();
  const level = (key, now) => {
    const bucket = buckets.get(key) ?? { tokens: burst, last: now };
    bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.last) / refillMs);
    bucket.last = now;
    buckets.set(key, bucket);
    return bucket;
  };
  return {
    has: (key, now = Date.now()) => level(key, now).tokens >= 1,
    take(key, now = Date.now()) {
      const bucket = level(key, now);
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
    prune(now = Date.now()) {
      for (const [key, bucket] of buckets) if (now - bucket.last > 60_000) buckets.delete(key);
    },
    get size() {
      return buckets.size;
    },
  };
}
