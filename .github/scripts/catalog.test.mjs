import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLock } from '../../plugins/api-v1/scripts/plugin-lock.mjs';
import { buildInventory } from '../../plugins/api-v1/scripts/inventory.mjs';
import { buildR2Profile } from './plugin-r2.mjs';
import { validateRepository } from './validate-catalog.mjs';

const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const git = (root, ...args) => execFileSync('git', ['-C', root, '-c', 'core.autocrlf=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { encoding: 'utf8' }).trim();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sesame-api2-inventory-'));
  t.after(() => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  const policy = {};
  for (const [source, kind, name] of [['api-v1', 'core', 'core-one'], ['optional-api-v1', 'optional', 'optional-one']]) {
    const directory = join(root, 'plugins', source), pkg = join(directory, 'packages', name);
    mkdirSync(pkg, { recursive: true });
    json(join(directory, 'bundle-profile.json'), { schemaVersion: 1, kind, engines: { sesame: '>=0.2.0-0' }, packages: [`sesame/${name}`] });
    json(join(pkg, 'plugin.json'), { id: `sesame/${name}`, apiVersion: '2', version: '1.0.0', license: 'MIT', default_state: kind === 'core' ? 'mounted' : 'discoverable',
      entry: 'index.js', capability_manifest: 'capabilities.json', engines: { sesame: '>=0.2.3' } });
    json(join(pkg, 'package.json'), { version: '1.0.0', type: 'module', license: 'MIT' });
    json(join(pkg, 'capabilities.json'), { schemaVersion: 1, apiVersion: '2', capabilities: [{ id: 'read', kind: 'function', consumers: ['agent', 'host'], execution: 'immediate',
      inputSchema: {}, outputSchema: {}, binding: { type: 'native', name: 'read' }, usage: { purpose: 'Read fixture', inputs: 'Empty object', outputs: 'Fixture record', prerequisites: [], limitations: [] } }],
      sources: [], views: [], services: [], knowledge: [], hooks: [], stateCollections: [], artifactSchemas: [] });
    writeFileSync(join(pkg, 'LICENSE'), 'MIT\n');
    writeFileSync(join(pkg, 'index.js'), "throw new Error('candidate plugin must never execute');\n");
    json(join(directory, 'official-plugins.lock.json'), buildLock(directory));
    policy[name] = { category: 'research', title: { en: name, zh: '示例' }, summary: { en: 'Fixture data', zh: '示例数据' }, dependencies: { en: 'None', zh: '无' } };
  }
  const core = join(root, 'plugins/api-v1');
  json(join(core, 'inventory-policy.json'), policy);
  json(join(core, 'inventory.json'), buildInventory(core));
  mkdirSync(join(root, '.github'));
  json(join(root, '.github/application-release.json'), { schemaVersion: 1, repository: 'KDZZZZZZ/sesame', tag: 'v0.2.3', releaseId: 123,
    assets: ['INSTALL.md', 'Sesame-0.2.3-linux-x64.AppImage', 'Sesame-0.2.3-linux-x64.deb', 'Sesame-0.2.3-mac-arm64.dmg', 'Sesame-0.2.3-win-x64.exe', 'SHA256SUMS.txt'].map(name => ({ name, size: 10, sha256: 'a'.repeat(64) })) });
  return { root, core, policy };
}

test('current API 2 inventory validates without Git ancestors, legacy catalogs or remote releases', t => {
  const { root } = fixture(t);
  assert.equal(existsSync(join(root, '.git')), false);
  assert.deepEqual(validateRepository(root), { apiVersion: '2', packages: { core: 1, optional: 1 }, inventory: 2, r2Plans: 0, application: { tag: 'v0.2.3', assets: 6 }, remoteChecked: false });
  for (const path of ['plugins/catalog.json', 'plugins/api-v1/catalog.json', 'plugins/optional-api-v1/catalog.json']) writeFileSync(join(root, path), '{retired historical data');
  assert.equal(validateRepository(root).inventory, 2);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./validate-catalog.mjs', import.meta.url)), root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"remoteChecked":false/);
});

test('missing current metadata is rejected rather than treated as historical or optional', t => {
  for (const path of ['plugins/api-v1/official-plugins.lock.json', 'plugins/optional-api-v1/official-plugins.lock.json', 'plugins/api-v1/bundle-profile.json', 'plugins/optional-api-v1/bundle-profile.json', 'plugins/api-v1/inventory.json', 'plugins/api-v1/inventory-policy.json', '.github/application-release.json']) {
    const { root } = fixture(t); rmSync(join(root, path));
    assert.throws(() => validateRepository(root), /ENOENT/);
  }
});

test('stale locks, source bytes and display metadata cannot pass inventory validation', t => {
  for (const [path, mutate, message] of [
    ['plugins/api-v1/official-plugins.lock.json', value => { value.packages[0].treeDigest = `sha256:${'0'.repeat(64)}`; }, /source lock differs/],
    ['plugins/optional-api-v1/official-plugins.lock.json', value => { value.packages = []; }, /source lock differs/],
    ['plugins/api-v1/inventory.json', value => { value.packages[0].license = 'invented'; }, /inventory differs/],
    ['plugins/api-v1/packages/core-one/capabilities.json', value => { delete value.capabilities[0].usage; }, /incomplete capability/],
    ['plugins/api-v1/packages/core-one/plugin.json', value => { value.license = 'invented'; }, /per-package license/],
    ['plugins/api-v1/bundle-profile.json', value => { value.packages = ['sesame/wrong']; }, /Package set/],
    ['.github/application-release.json', value => { value.assets.pop(); }, /exactly six assets/],
  ]) {
    const { root } = fixture(t), target = join(root, path), value = JSON.parse(readFileSync(target)); mutate(value); json(target, value);
    assert.throws(() => validateRepository(root), message);
  }
  const { root } = fixture(t); writeFileSync(join(root, 'plugins/api-v1/packages/core-one/index.js'), 'changed source bytes');
  assert.throws(() => validateRepository(root), /source lock differs/);
});

test('descriptive policy cannot override source identities or omit explanations', t => {
  for (const field of ['id', 'version', 'license', 'engines', 'author', 'state']) {
    const { root, core, policy } = fixture(t);
    policy['core-one'][field] = 'invented'; json(join(core, 'inventory-policy.json'), policy);
    json(join(core, 'inventory.json'), buildInventory(core));
    assert.throws(() => validateRepository(root), /cannot override package facts/);
  }
  const { root, core, policy } = fixture(t); policy['core-one'].summary.zh = '';
  json(join(core, 'inventory-policy.json'), policy); json(join(core, 'inventory.json'), buildInventory(core));
  assert.throws(() => validateRepository(root), /explicit English and Chinese/);
});

test('new API 2 plans reconstruct exact source and reject changed digests after a fresh root commit', t => {
  const { root } = fixture(t);
  git(root, 'init', '-q'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'fresh root');
  const sourceCommit = git(root, 'rev-parse', 'HEAD');
  const profiles = [['core', 'api-v1', 'core-one'], ['optional', 'optional-api-v1', 'optional-one']].map(([profile, directory, name]) => {
    const draft = { profile, sourceRoot: `plugins/${directory}`, sourceCommit, id: 'dev.5', packages: [`sesame/${name}`], archiveSha256: '0'.repeat(64), lockSha256: '0'.repeat(64) };
    const built = buildR2Profile(root, draft, { verifyDigests: false });
    return { profile, sourceRoot: draft.sourceRoot, packages: draft.packages, archiveSha256: built.archiveSha256, lockSha256: built.lockSha256 };
  });
  const plan = { schemaVersion: 1, id: 'dev.5', sourceCommit, pullRequest: 100, title: 'Fresh API 2 publication', profiles };
  const path = join(root, '.github/plugin-r2-api2/dev.5.json'); mkdirSync(dirname(path)); json(path, plan);
  assert.equal(validateRepository(root).r2Plans, 1);
  plan.profiles[0].archiveSha256 = '0'.repeat(64); json(path, plan);
  assert.throws(() => validateRepository(root), /archive digest differs/);
});
