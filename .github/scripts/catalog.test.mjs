import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLock, createArchive, sha256 } from '../../plugins/api-v1/scripts/plugin-lock.mjs';
import { buildCatalog } from '../../plugins/api-v1/scripts/catalog.mjs';
import { buildInventory } from '../../plugins/api-v1/scripts/inventory.mjs';
import { buildR2Profile } from './plugin-r2.mjs';
import { validateRepository } from './validate-catalog.mjs';

const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const git = (root, ...args) => execFileSync('git', ['-C', root, '-c', 'core.autocrlf=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { encoding: 'utf8' }).trim();
function fixture(t, { taxonomy = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sesame-api2-inventory-'));
  t.after(() => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  const policy = {};
  for (const [source, kind, name] of [['api-v1', 'core', 'core-one'], ['optional-api-v1', 'optional', 'optional-one']]) {
    const directory = join(root, 'plugins', source), pkg = join(directory, 'packages', name);
    mkdirSync(pkg, { recursive: true });
    json(join(directory, 'bundle-profile.json'), { schemaVersion: 1, kind, engines: { sesame: '>=0.2.0-0' }, packages: [`sesame/${name}`] });
    json(join(pkg, 'plugin.json'), { id: `sesame/${name}`, apiVersion: '2', version: '1.0.0', license: 'MIT', default_state: kind === 'core' ? 'mounted' : 'discoverable',
      entry: 'index.js', capability_manifest: 'capabilities.json', engines: { sesame: taxonomy ? '>=0.3.0-dev.1 <0.4.0' : '>=0.2.3' },
      ...(taxonomy ? { permissions: { scopes: [], calls: ['host.resources.read'] } } : {}) });
    json(join(pkg, 'package.json'), { version: '1.0.0', type: 'module', license: 'MIT' });
    json(join(pkg, 'capabilities.json'), { schemaVersion: 1, apiVersion: '2', capabilities: [{ id: 'read', kind: 'function', consumers: ['agent', 'host'], execution: 'immediate',
      inputSchema: {}, outputSchema: {}, binding: { type: 'native', name: 'read' }, usage: { purpose: 'Read fixture', inputs: 'Empty object', outputs: 'Fixture record', prerequisites: [], limitations: [] } }],
      sources: [], views: [], services: [], knowledge: [], hooks: [], stateCollections: [], artifactSchemas: [] });
    writeFileSync(join(pkg, 'LICENSE'), 'MIT\n');
    writeFileSync(join(pkg, 'index.js'), "throw new Error('candidate plugin must never execute');\n");
    json(join(directory, 'official-plugins.lock.json'), buildLock(directory));
    policy[name] = { category: 'research', ...(taxonomy ? { functionalCategory: 'analysis', implementationKinds: ['function'] } : {}),
      title: { en: name, zh: '示例' }, summary: { en: 'Fixture data', zh: '示例数据' }, dependencies: { en: 'None', zh: '无' } };
  }
  const core = join(root, 'plugins/api-v1');
  mkdirSync(join(core, 'scripts'));
  for (const name of ['plugin-taxonomy.mjs', 'inventory.mjs']) writeFileSync(join(core, 'scripts', name), "throw new Error('candidate validator must never execute');\n");
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

test('legacy projection retains its exact format while taxonomy projection derives only source facts', t => {
  for (const taxonomy of [false, true]) {
    const { root, core } = fixture(t, { taxonomy });
    const inventory = JSON.parse(readFileSync(join(core, 'inventory.json')));
    assert.equal(Object.hasOwn(inventory, 'taxonomy'), taxonomy);
    assert.deepEqual(inventory.packages.map(pkg => pkg.engines.sesame), Array(2).fill(taxonomy ? '>=0.3.0-dev.1 <0.4.0' : '>=0.2.3'));
    for (const pkg of inventory.packages) {
      assert.equal(Object.hasOwn(pkg, 'permissions'), taxonomy);
      assert.equal(Object.hasOwn(pkg, 'functionalCategory'), taxonomy);
      assert.equal(Object.hasOwn(pkg, 'implementationKinds'), taxonomy);
      if (taxonomy) {
        assert.deepEqual(pkg.permissions, { scopes: [], calls: ['host.resources.read'] });
        assert.deepEqual(pkg.implementationKinds, ['function']);
      }
    }
    if (taxonomy) {
      assert.deepEqual(inventory.taxonomy.functionalCategories.map(item => item.id), ['business', 'analysis', 'integration', 'presentation', 'platform']);
      assert.deepEqual(inventory.taxonomy.implementationKinds.map(item => item.id), ['knowledge', 'function', 'adapter', 'workflow', 'service']);
      assert.match(inventory.notice, /honor each package engines range/);
    } else {
      assert.equal(inventory.notice, 'This descriptive inventory is not an installation catalog. It has no source commits or package digests. Installable entries are generated separately only from fixed, actually published releases.');
    }
    assert.equal(validateRepository(root).inventory, 2);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./validate-catalog.mjs', import.meta.url)), root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
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
    ['.github/application-release.json', value => { value.assets.pop(); }, /schemaVersion 1 requires exactly 6 assets/],
  ]) {
    const { root } = fixture(t), target = join(root, path), value = JSON.parse(readFileSync(target)); mutate(value); json(target, value);
    assert.throws(() => validateRepository(root), message);
  }
  const { root } = fixture(t); writeFileSync(join(root, 'plugins/api-v1/packages/core-one/index.js'), 'changed source bytes');
  assert.throws(() => validateRepository(root), /source lock differs/);
});

test('descriptive policy cannot override source identities or omit explanations', t => {
  for (const taxonomy of [false, true]) for (const field of ['id', 'version', 'license', 'engines', 'author', 'state', 'permissions']) {
    const { root, core, policy } = fixture(t, { taxonomy });
    policy['core-one'][field] = 'invented'; json(join(core, 'inventory-policy.json'), policy);
    assert.throws(() => buildInventory(core), /Unknown policy field/);
    assert.throws(() => validateRepository(root), /Unknown policy field/);
  }
  for (const taxonomy of [false, true]) for (const [mutate, message] of [
    [policy => { policy['core-one'].summary.zh = ''; }, /explicit English and Chinese/],
    [policy => { policy['core-one'].summary.en = 'x'.repeat(2001); }, /explicit English and Chinese/],
    [policy => { policy['core-one'].title.extra = 'unexpected'; }, /explicit English and Chinese/],
    [policy => { delete policy['core-one'].dependencies; }, /missing required descriptive/],
    [policy => { policy['core-one'].category = 'unknown'; }, /invalid legacy category/],
    [policy => { delete policy['optional-one']; }, /Missing reviewed package/],
    [policy => { policy.absent = structuredClone(policy['core-one']); }, /absent packages/],
  ]) {
    const { root, core, policy } = fixture(t, { taxonomy }); mutate(policy); json(join(core, 'inventory-policy.json'), policy);
    assert.throws(() => validateRepository(root), message);
  }
});

test('taxonomy requires a complete consistent format and does not silently accept partial migration', t => {
  for (const [mutate, message] of [
    [policy => { policy['core-one'].functionalCategory = 'unknown'; }, /invalid functional category/],
    [policy => { delete policy['core-one'].functionalCategory; }, /invalid functional category/],
    [policy => { delete policy['core-one'].implementationKinds; }, /unique supported/],
    [policy => { policy['core-one'].implementationKinds = ['workflow', 'workflow']; }, /unique supported/],
    [policy => { policy['core-one'].implementationKinds = ['script']; }, /unique supported/],
    [policy => { policy['core-one'].implementationKinds = []; }, /unique supported/],
    [policy => { policy['core-one'].implementationReason = 'brief'; }, /explain the curated exception/],
    [policy => { delete policy['core-one'].functionalCategory; delete policy['core-one'].implementationKinds; }, /cannot mix legacy and taxonomy/],
  ]) {
    const { root, core, policy } = fixture(t, { taxonomy: true }); mutate(policy); json(join(core, 'inventory-policy.json'), policy);
    assert.throws(() => validateRepository(root), message);
  }
  const { root, core, policy } = fixture(t);
  policy['core-one'].implementationReason = 'A reason alone is not a complete taxonomy classification.';
  json(join(core, 'inventory-policy.json'), policy);
  assert.throws(() => validateRepository(root), /invalid functional category/);
});

test('taxonomy cannot manufacture knowledge-only packages or hide exposed workflow and source capabilities', t => {
  for (const kind of ['knowledge', 'workflow', 'source']) {
    const { root, core, policy } = fixture(t, { taxonomy: true });
    const path = join(core, 'packages/core-one/capabilities.json'), declaration = JSON.parse(readFileSync(path));
    policy['core-one'].implementationReason = 'A candidate explanation cannot remove an exposed implementation.';
    if (kind === 'knowledge') policy['core-one'].implementationKinds = ['knowledge'];
    if (kind === 'workflow') declaration.capabilities[0].kind = 'workflow';
    if (kind === 'source') declaration.sources.push({ id: 'fixture-source', contract: 'fixture/1', operations: {} });
    json(path, declaration); json(join(core, 'official-plugins.lock.json'), buildLock(core));
    json(join(core, 'inventory-policy.json'), policy);
    assert.throws(() => validateRepository(root), /cannot create or hide exposed execution|cannot hide a declared/);
  }
  const { root, core, policy } = fixture(t, { taxonomy: true });
  policy['core-one'].implementationReason = 'No implementation exception exists for this matching native function.';
  json(join(core, 'inventory-policy.json'), policy);
  assert.throws(() => validateRepository(root), /stale implementation exception/);
});

test('the projected inventory cannot mix formats or hide source permissions by removing policy labels', t => {
  for (const taxonomy of [false, true]) {
    const { root, core } = fixture(t, { taxonomy });
    const path = join(core, 'inventory.json'), inventory = JSON.parse(readFileSync(path));
    if (taxonomy) delete inventory.taxonomy;
    else inventory.taxonomy = {};
    json(path, inventory); assert.throws(() => validateRepository(root), /inventory differs/);
  }
  const { root, core, policy } = fixture(t, { taxonomy: true });
  for (const entry of Object.values(policy)) { delete entry.functionalCategory; delete entry.implementationKinds; }
  json(join(core, 'inventory-policy.json'), policy);
  assert.throws(() => validateRepository(root), /inventory differs/);
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

test('GitHub catalog projects taxonomy from each fixed source without changing release or package identities', t => {
  const { root, core, policy } = fixture(t, { taxonomy: true });
  git(root, 'init', '-q'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixed API 2 source');
  const sourceCommit = git(root, 'rev-parse', 'HEAD');
  const plans = [['api-v1', 'core'], ['optional-api-v1', 'optional']].map(([directory, profile]) => {
    const sourceRoot = `plugins/${directory}`, source = join(root, sourceRoot), lock = buildLock(source);
    const tag = `plugins-${profile === 'optional' ? 'optional-' : ''}api-v1-dev.999999`;
    return { schemaVersion: 1, tag, sourceCommit, sourceRoot, profile, pullRequest: 100, title: 'Fixed catalog fixture',
      archive: { name: `sesame-${profile === 'optional' ? 'optional' : 'official'}-plugins-api-v1-dev.999999.tar.gz`, sha256: sha256(createArchive(source, lock)) },
      lockSha256: sha256(readFileSync(join(source, 'official-plugins.lock.json'))) };
  });
  mkdirSync(join(root, '.github/plugin-releases'));
  for (const plan of plans) json(join(root, `.github/plugin-releases/${plan.tag}.json`), plan);
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'reviewed publication plans');
  const releaseCommit = git(root, 'rev-parse', 'HEAD');
  const sources = { schemaVersion: 1, releases: plans.map(plan => ({ tag: plan.tag, releaseCommit, reviewSha256: 'a'.repeat(64) })) };
  const catalog = buildCatalog(root, sources);
  for (const plugin of catalog.plugins) {
    assert.equal(plugin.functionalCategory, policy[plugin.name].functionalCategory);
    assert.deepEqual(plugin.implementationKinds, policy[plugin.name].implementationKinds);
    assert.equal(plugin.source.commit, sourceCommit);
    assert.equal(plugin.engines.sesame, '>=0.3.0-dev.1 <0.4.0');
    const plan = plans.find(item => item.tag === plugin.release);
    const indexed = buildLock(join(root, plan.sourceRoot)).packages.find(item => item.id === plugin.id);
    assert.equal(plugin.version, indexed.version);
    assert.deepEqual(plugin.package, { treeDigest: indexed.treeDigest, files: indexed.files });
    assert.equal(catalog.releases.find(item => item.tag === plan.tag).archive.sha256, plan.archive.sha256);
  }
  json(join(core, 'inventory-policy.json'), { 'core-one': { functionalCategory: 'unreviewed' } });
  assert.equal(JSON.stringify(buildCatalog(root, sources)), JSON.stringify(catalog));
});
