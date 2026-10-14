import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLock, packageFiles } from '../../api-v1/scripts/plugin-lock.mjs';

const hostRoot = process.env.SESAME_HOST_ROOT;
test('host admission rejects pre-dev8 installs before missing factor invocation guarantees can run', { skip: !hostRoot }, async () => {
  const { inspectPackage } = await import(pathToFileURL(join(hostRoot, 'modules/agent/plugin-system/package.js')));
  for (const name of ['auto-factor-mining', 'factor-evaluator']) {
    const source = fileURLToPath(new URL(`../packages/${name}/`, import.meta.url));
    const files = Object.fromEntries(packageFiles(source).map(file => [file.path, readFileSync(join(source, file.path))]));
    for (const applicationVersion of ['0.2.2', '0.2.3-dev.6', '0.2.3-dev.7']) {
      assert.throws(() => inspectPackage(files, { applicationVersion }), { code: 'plugin_host_incompatible', status: 409 }, name);
    }
    for (const applicationVersion of ['0.2.3-dev.8', '0.2.3-dev.9', '0.2.3']) {
      assert.equal(inspectPackage(files, { applicationVersion }).id, `sesame/${name}`);
    }
  }
});

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
