import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLock } from '../../api-v1/scripts/plugin-lock.mjs';

const packageRoot = new URL('../packages/auto-factor-mining/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, packageRoot)));

test('the self-contained factor package passes the official package boundary validator', t => {
  const root = mkdtempSync(join(tmpdir(), 'sesame-factor-packages-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.match(basename(root), /^sesame-factor-packages-/);
    rmSync(root, { recursive: true, force: true });
  });
  const names = ['auto-factor-mining'];
  mkdirSync(join(root, 'packages'));
  for (const name of names) cpSync(fileURLToPath(new URL(`../packages/${name}/`, import.meta.url)), join(root, 'packages', name), { recursive: true });
  writeFileSync(join(root, 'bundle-profile.json'), JSON.stringify({ schemaVersion: 1, kind: 'optional', engines: { sesame: '>=0.2.0-0' }, packages: names.map(name => `sesame/${name}`) }));
  const lock = buildLock(root);
  assert.deepEqual(lock.packages.map(pkg => pkg.id), names.map(name => `sesame/${name}`));
  assert.ok(lock.packages.every(pkg => pkg.files.length > 0));
});

test('seven public tools expose independent native steps without a research scheduler or reports', () => {
  const manifest = read('plugin.json'), declaration = read('capabilities.json');
  const capabilities = declaration.capabilities;
  assert.equal(manifest.title, '因子研究');
  assert.match(manifest.version, /^3\.\d+\.\d+$/);
  assert.equal(manifest.version, read('package.json').version);
  assert.deepEqual(capabilities.filter(cap => cap.consumers.includes('agent')).map(cap => cap.id),
    ['factor_environment', 'factor_prepare', 'factor_search', 'factor_compute', 'factor_evaluate', 'factor_library', 'factor_pool']);
  const workflows = capabilities.filter(cap => cap.kind === 'workflow');
  assert.equal(workflows.length, 0);
  for (const id of ['factor_prepare', 'factor_search', 'factor_compute', 'factor_evaluate']) {
    const cap = capabilities.find(cap => cap.id === id);
    assert.equal(cap.execution, 'run');
    assert.equal(cap.resumable, true);
  }
  for (const name of ['runtime.js', 'report.js']) assert.equal(existsSync(new URL(name, packageRoot)), false);
  assert.ok(capabilities.every(cap => !cap.id.startsWith('auto_factor_')));
  assert.deepEqual(declaration.sources, []);
  assert.deepEqual(declaration.services, []);
  assert.deepEqual(manifest.permissions.scopes, ['capabilities.compose', 'process.execute']);
  assert.deepEqual(manifest.permissions.calls, ['host.process.exec']);
  assert.equal(existsSync(new URL('../factor-evaluator/', packageRoot)), false);
  assert.equal(JSON.parse(readFileSync(new URL('../bundle-profile.json', import.meta.url))).packages.includes('sesame/factor-evaluator'), false);
});

test('environment configuration and immutable storage are declared without blocking environment preparation', () => {
  const declaration = read('capabilities.json'), byId = new Map(declaration.capabilities.map(cap => [cap.id, cap]));
  assert.equal(byId.get('factor_environment').execution, 'run');
  for (const id of ['factor_configuration_read', 'factor_configuration_update']) {
    assert.equal(byId.get(id).execution, 'immediate');
    assert.deepEqual(byId.get(id).consumers, ['host']);
  }
  assert.deepEqual(declaration.configuration.fields[0].binding, { type: 'capability', read: 'factor_configuration_read', update: 'factor_configuration_update', valuePath: '/pythonPath', configuredPath: '/ready', writePath: '/pythonPath' });
  for (const id of ['factor_prepare', 'factor_search', 'factor_compute', 'factor_evaluate']) assert.deepEqual(byId.get(id).configurationRequirements.map(({ field, optional }) => ({ field, optional })), [{ field: 'pythonPath', optional: false }]);
  assert.deepEqual(byId.get('factor_environment').configurationRequirements ?? [], []);
  assert.equal(declaration.stateCollections.length, 7);
  assert.ok(declaration.stateCollections.every(item => item.mode === 'document' && item.access === 'private'));
  const resource = declaration.artifactSchemas.find(item => item.kind === 'resource');
  assert.equal(resource.schema.additionalProperties, false);
  assert.deepEqual(resource.schema.required, ['format', 'path', 'bytesDigest', 'schema']);
});
