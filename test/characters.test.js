import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../public/vendor/three.min.js';
import { ANIMAL_IDS } from '../public/shared/animals.js';
import { CHARACTERS, buildAnimal } from '../public/js/characters/index.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every selectable animal has a character module', () => {
  assert.deepEqual(Object.keys(CHARACTERS).sort(), [...ANIMAL_IDS].sort());
  for (const id of ANIMAL_IDS) {
    assert.equal(CHARACTERS[id].spec.id, id);
    assert.equal(typeof CHARACTERS[id].build, 'function');
  }
});

test('unknown character ids fall back to a valid rig', () => {
  const rig = buildAnimal('nobody');
  assert.ok(rig.group instanceof THREE.Group);
  assert.ok(rig.group.children.length > 0);
});

test('every character passes the placement checks (no clipping, hands on deck, bum outside)', () => {
  // scripts/check-rigs.mjs poses each rig (rest, charged, kick, walk, sore) and measures it against the boat
  const out = execFileSync('node', [path.join(root, 'scripts', 'check-rigs.mjs'), '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 });
  const results = JSON.parse(out);
  assert.deepEqual(results.map((r) => r.id).sort(), [...ANIMAL_IDS].sort());
  for (const r of results) assert.deepEqual(r.problems, [], `${r.id}: ${r.problems.join('; ')}`);
});

test('every character animates without producing NaNs', () => {
  for (const id of ANIMAL_IDS) {
    const rig = buildAnimal(id);
    rig.kick(1);
    for (let f = 0; f < 120; f++) rig.update(1 / 60, { walk: f % 60 < 30 ? 3.6 : -3.6, charge: f % 90 < 45 ? 1 : 0, heat: f / 120 });
    rig.group.updateMatrixWorld(true);
    rig.group.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 5) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        assert.ok(Number.isFinite(v.x + v.y + v.z), `${id}: NaN vertex after animating`);
      }
    });
  }
});

test('character modules are quiet (no console output in shipped code)', () => {
  for (const id of ANIMAL_IDS) {
    const source = readFileSync(path.join(root, 'public', 'js', 'characters', `${id}.js`), 'utf8');
    assert.doesNotMatch(source, /console\.(log|warn|error|debug|info)/, `${id}.js writes to the console`);
  }
});
