import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLock } from '../../api-v1/scripts/plugin-lock.mjs';

test('factor workflow and evaluator pass the official independent package boundary validator', t => {
  const root = mkdtempSync(join(tmpdir(), 'sesame-factor-packages-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.match(basename(root), /^sesame-factor-packages-/);
    rmSync(root, { recursive: true, force: true });
  });
  const names = ['auto-factor-mining', 'factor-evaluator'];
  mkdirSync(join(root, 'packages'));
  for (const name of names) cpSync(fileURLToPath(new URL(`../packages/${name}/`, import.meta.url)), join(root, 'packages', name), { recursive: true });
  writeFileSync(join(root, 'bundle-profile.json'), JSON.stringify({ schemaVersion: 1, kind: 'optional', engines: { sesame: '>=0.2.0-0' }, packages: names.map(name => `sesame/${name}`) }));
  const lock = buildLock(root);
  assert.deepEqual(lock.packages.map(pkg => pkg.id), names.map(name => `sesame/${name}`));
  assert.ok(lock.packages.every(pkg => pkg.files.length > 0));
});
