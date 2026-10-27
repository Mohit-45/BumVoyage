import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { usedNames } from '../scripts/build-vendor.mjs';

// A throwaway tree with the three folders the scan reads. `files` maps a path to its source text.
function tree(t, files) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'vendor-scan-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const dir of ['public/js', 'scripts', 'test']) mkdirSync(path.join(base, dir), { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    writeFileSync(path.join(base, file), text);
  }
  return base;
}

const IMPORT = "import * as THREE from '../vendor/three.min.js';\n";

test('the scan collects every THREE.Name from the browser code, scripts and tests', (t) => {
  const base = tree(t, {
    'public/js/a.js': `${IMPORT}export const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));\n`,
    'public/js/deep/b.js': `${IMPORT}export const v = new THREE.Vector3();\n`,
    'scripts/c.mjs': `${IMPORT}console.log(THREE.REVISION, THREE.mergeGeometries);\n`,
    'test/d.test.js': `${IMPORT}new THREE.Group();\n`,
    'public/js/no-three.js': 'export const x = 1;\n',
  });
  assert.deepEqual(usedNames(base), ['BoxGeometry', 'Group', 'Mesh', 'REVISION', 'Vector3', 'mergeGeometries']);
});

test('names in comments are not a problem and prose about THREE never fails the scan', (t) => {
  const base = tree(t, {
    'public/js/a.js': `${IMPORT}// a THREE helper, see THREE.js\n/* THREE again */\n * THREE\nexport const c = new THREE.Color();\n`,
  });
  assert.deepEqual(usedNames(base), ['Color', 'REVISION']);
});

test('the scan refuses usage it cannot follow instead of leaving a name out of the bundle', (t) => {
  const asValue = tree(t, { 'public/js/a.js': `${IMPORT}export const all = Object.keys(THREE);\n` });
  assert.throws(() => usedNames(asValue), /public\/js\/a\.js: THREE is used as a value/);
  const named = tree(t, { 'public/js/a.js': "import { Mesh } from '../vendor/three.min.js';\n" });
  assert.throws(() => usedNames(named), /public\/js\/a\.js: import the bundle once, as "import \* as THREE/);
  const twice = tree(t, { 'public/js/a.js': `${IMPORT}${IMPORT}` });
  assert.throws(() => usedNames(twice), /import the bundle once/);
});
