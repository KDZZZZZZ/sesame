import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildLock } from '../../plugins/api-v1/scripts/plugin-lock.mjs';
import { validateOptionalCatalog } from './validate-api1-catalog.mjs';

test('historical optional catalog checks its fixed Git source despite changed candidate versions and membership', t => {
  const root = mkdtempSync(join(tmpdir(), 'sesame-catalog-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = join(root, 'plugins/optional-api-v1');
  const git = args => execFileSync('git', args, { cwd: root }).toString().trim();
  const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  const packageAt = (name, version) => { const directory = join(base, 'packages', name); mkdirSync(directory, { recursive: true }); json(join(directory, 'plugin.json'), { id: `sesame/${name}`, apiVersion: '1', version, license: 'MIT', default_state: 'discoverable', tool_names: [], tool_definitions: 'tools.json' }); json(join(directory, 'package.json'), { type: 'module', version, license: 'MIT' }); json(join(directory, 'tools.json'), []); writeFileSync(join(directory, 'LICENSE'), 'MIT\n'); };
  git(['init','-q']); packageAt('example','1.0.0'); const lock = buildLock(base); json(join(base, 'official-plugins.lock.json'), lock);
  git(['add','.']); git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixed publication']);
  const sourceCommit = git(['rev-parse','HEAD']), pkg = lock.packages[0];
  const catalog = { schemaVersion: 1, apiVersion: '1', channel: 'development', sourceCommit, plugins: [{ id: pkg.id, version: pkg.version, apiVersion: '1', format: 'sesame-native', status: 'active', source: { repository: 'https://github.com/KDZZZZZZ/sesame', commit: sourceCommit, path: 'plugins/optional-api-v1/packages/example' }, package: { treeDigest: pkg.treeDigest, files: pkg.files }, review: { automated: 'package-static-review', human: 'not-recorded' }, license: 'MIT', tools: [] }] };
  const path = join(base, 'catalog.json'); json(path, catalog);
  packageAt('example','2.0.0'); packageAt('new-package','1.0.0'); json(join(base, 'official-plugins.lock.json'), buildLock(base));
  assert.deepEqual(validateOptionalCatalog(root), { packages: 1, sourceCommit });
  const changed = JSON.parse(readFileSync(path)); changed.plugins[0].version = '2.0.0'; json(path, changed); assert.throws(() => validateOptionalCatalog(root), /identity differs/);
  json(path, { ...catalog, sourceCommit: 'main' }); assert.throws(() => validateOptionalCatalog(root), /immutable commit/);
  json(path, catalog); catalog.plugins[0].package.files[0].sha256 = '0'.repeat(64); json(path, catalog); assert.throws(() => validateOptionalCatalog(root), /locked files differ/);
});
