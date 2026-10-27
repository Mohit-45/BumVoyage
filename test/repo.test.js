import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../public/vendor/three.min.js';
import { startServer } from '../server/app.js';

const root = process.env.REPO_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(root, ...p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const walk = (dir) =>
  readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

test('render.yaml starts the same server as npm start, on a health path the server answers', async (t) => {
  const yaml = read('render.yaml');
  const start = yaml.match(/startCommand:\s*(.+)/)[1].trim();
  assert.equal(pkg.scripts.start, start, 'render.yaml startCommand and package.json start disagree');
  const health = yaml.match(/healthCheckPath:\s*(\S+)/)[1];
  const app = await startServer(0);
  t.after(() => app.close());
  assert.equal((await fetch(`http://127.0.0.1:${app.port}${health}`)).status, 200);
  assert.match(yaml, /buildCommand:\s*npm ci --omit=dev/);
  assert.ok(pkg.dependencies.ws, 'ws must be a production dependency (the build omits devDependencies)');
  for (const dep of ['three', 'esbuild', 'puppeteer-core']) assert.ok(!pkg.dependencies[dep], `${dep} must stay a devDependency`);
});

test('every THREE.* name the browser code uses is exported by the committed bundle', () => {
  const used = new Set();
  for (const f of walk('public/js')) for (const m of read(f).matchAll(/\bTHREE\.([A-Za-z0-9_]+)/g)) used.add(m[1]);
  assert.ok(used.size > 20);
  assert.deepEqual([...used].filter((n) => !(n in THREE)), []);
});

test('the committed three.js bundle is what npm run build:vendor would produce', (t) => {
  const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild');
  if (!existsSync(esbuild)) return t.skip('devDependencies not installed');
  const out = path.join(os.tmpdir(), `three-${process.pid}.js`);
  execFileSync(esbuild, ['scripts/vendor-entry.js', '--bundle', '--minify', '--format=esm', `--outfile=${out}`, '--log-level=error'], { cwd: root });
  assert.ok(readFileSync(out).equals(readFileSync(path.join(root, 'public/vendor/three.min.js'))), 'public/vendor/three.min.js is stale: run npm run build:vendor');
  const rev = JSON.parse(read('node_modules/three/package.json')).version.split('.')[1];
  assert.equal(THREE.REVISION, rev);
  assert.match(read('public/vendor/three.min.js'), /@license[\s\S]*MIT/, 'the three.js MIT notice must survive minification');
});

test('every sound clip points at a real file, inside its length, with a credit', () => {
  const manifest = JSON.parse(read('public/audio/manifest.json'));
  const credited = new Map(manifest.sources.map((s) => [s.file, s]));
  const wavSeconds = (file) => {
    const b = readFileSync(path.join(root, 'public/audio', file));
    let off = 12;
    while (b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4);
    return b.readUInt32LE(off + 4) / (b.readUInt32LE(24) * b.readUInt16LE(22) * (b.readUInt16LE(34) / 8));
  };
  for (const clip of manifest.clips) {
    assert.ok(credited.has(clip.file), `${clip.file} has no entry in sources`);
    assert.ok(clip.start < clip.end && clip.end <= wavSeconds(clip.file) + 0.01, `bad range in ${JSON.stringify(clip)}`);
  }
  for (const s of manifest.sources) {
    assert.match(s.license, /public domain|CC0/i, `${s.file}: only no-attribution licences are shipped without a notice`);
    assert.match(s.url, /^https:\/\//);
  }
  const files = readdirSync(path.join(root, 'public/audio')).filter((f) => /\.(wav|mp3|ogg)$/.test(f));
  assert.deepEqual(files.sort(), [...credited.keys()].sort(), 'audio files and credited sources differ');
  const readme = read('public/audio/README.md');
  for (const f of files) assert.ok(readme.includes(f), `${f} is missing from public/audio/README.md`);
});

test('index.html has every element id the game script asks for, and nothing the CSP would block', () => {
  const html = read('public/index.html');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const wanted = new Set();
  for (const f of walk('public/js').filter((f) => /main|input|preview|audio|scene/.test(f))) {
    for (const m of read(f).matchAll(/(?:\$|getElementById)\(\s*'([^']+)'\s*\)/g)) wanted.add(m[1]);
  }
  assert.ok(wanted.size > 30);
  assert.deepEqual([...wanted].filter((id) => !ids.has(id)), []);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline event handler');
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/i, 'inline script');
  assert.doesNotMatch(html, /\sstyle=/i, 'inline style attribute');
});

test('README only mentions scripts, npm scripts and files that exist', () => {
  const readme = read('README.md');
  for (const m of readme.matchAll(/npm run ([a-z:]+)/g)) assert.ok(pkg.scripts[m[1]], `npm run ${m[1]} does not exist`);
  for (const m of readme.matchAll(/`((?:scripts|public|server|test)\/[A-Za-z0-9_./-]+)`/g)) assert.ok(existsSync(path.join(root, m[1])), `${m[1]} does not exist`);
  for (const m of readme.matchAll(/node (scripts\/[a-z-]+\.mjs)/g)) assert.ok(existsSync(path.join(root, m[1])), `${m[1]} does not exist`);
});
