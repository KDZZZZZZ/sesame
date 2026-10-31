import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildLock, createArchive, packageFiles, treeDigest } from '../scripts/plugin-lock.mjs';
import { verifyAnalysisRetirements } from '../scripts/verify-analysis-retirements.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const baselineBytes = readFileSync(new URL('./fixtures/analysis-plugin-contracts.json', import.meta.url));
const baseline = JSON.parse(baselineBytes);
const extensions = JSON.parse(readFileSync(new URL('./fixtures/analysis-plugin-contract-extensions.json', import.meta.url), 'utf8'));
const additionBytes = readFileSync(new URL('./fixtures/analysis-plugin-additions.json', import.meta.url));
const additions = JSON.parse(additionBytes);
const additionExtensions = JSON.parse(readFileSync(new URL('./fixtures/analysis-plugin-addition-extensions.json', import.meta.url)));
const retirements = JSON.parse(readFileSync(new URL('./fixtures/analysis-plugin-retirements.json', import.meta.url)));
assert.equal(additions.schemaVersion, 1);
assert.equal(additions.status, 'approved');
assert.ok(additions.reason.length >= 20);
assert.deepEqual(additions.packages.map(item => item.id), ['sesame/historical-evidence']);
assert.ok(additions.packages.every(item => !baseline.packages.some(original => original.id === item.id)));
const policy = JSON.parse(readFileSync(join(root, 'plugins/api-v1/inventory-policy.json'), 'utf8'));
const digest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
const byteDigest = value => 'sha256:' + createHash('sha256').update(value).digest('hex');

function validateExtensions(snapshot, bytes, extension) {
  assert.equal(extension.schemaVersion, 1, 'analysis extensions require their explicit schema');
  assert.ok(['pending-review', 'approved'].includes(extension.status), 'analysis extension status must be explicit');
  assert.equal(extension.baselineSha256, byteDigest(bytes), 'immutable analysis fixture bytes must not be recaptured');
  assert.deepEqual(Object.keys(extension.baselineVersions).sort(), snapshot.packages.map(item => item.id).sort(), 'baseline version facts must cover exactly the frozen package identities');
  for (const version of Object.values(extension.baselineVersions)) assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/, 'baseline version must be a release label, not a rule that strips other fields');
  assert.ok(Array.isArray(extension.changes), 'reviewed changes must be explicit');
  const packages = new Map(snapshot.packages.map(item => [item.id, item])), changes = new Map();
  for (const change of extension.changes) {
    const item = packages.get(change.pluginId), key = `${change.pluginId}:${change.component}`;
    assert.ok(item && ['manifest', 'declaration'].includes(change.component), `unknown analysis review target: ${key}`);
    assert.ok(!changes.has(key), `duplicate analysis review target: ${key}`);
    assert.equal(change.beforeDigest, item[`${change.component}Digest`], `analysis review must retain the original frozen digest: ${key}`);
    assert.match(change.afterDigest, /^sha256:[a-f0-9]{64}$/, `analysis review needs an exact after digest: ${key}`);
    assert.notEqual(change.afterDigest, change.beforeDigest, `version-only/no-op changes need no semantic approval: ${key}`);
    assert.ok(['pending', 'approved'].includes(change.decision), `analysis review decision must be explicit: ${key}`);
    assert.ok(typeof change.reason === 'string' && change.reason.trim().length >= 20, `analysis review needs a substantive reason: ${key}`);
    changes.set(key, change);
  }
  return changes;
}

function assertFrozenContract(item, component, actual, extension, changes) {
  // Re-inserting the authenticated original root version proves version-only
  // compatibility against the FULL old hash. No permission, engine, resource,
  // nested version or capability-schema field is omitted from that proof.
  const normalized = component === 'manifest' ? { ...actual, version: extension.baselineVersions[item.id] } : actual;
  const change = changes.get(`${item.id}:${component}`);
  if (change) {
    assert.equal(extension.status, 'approved', `${item.id}: semantic analysis changes await explicit review`);
    assert.equal(change.decision, 'approved', `${item.id}: ${component} change is not approved`);
  }
  assert.equal(digest(normalized), change?.afterDigest ?? item[`${component}Digest`], component === 'manifest'
    ? 'manifest identity, permissions, engines and resources stay compatible or match an exact reviewed change'
    : 'all capability schemas, bindings, effects, state and configuration stay compatible or match an exact reviewed change');
}
const reviewedChanges = validateExtensions(baseline, baselineBytes, extensions);
const reviewedAdditions = validateExtensions(additions, additionBytes, additionExtensions);
const retiredIds = verifyAnalysisRetirements(root, baselineBytes, retirements);
const currentContracts = [...baseline.packages, ...additions.packages].filter(item => !retiredIds.has(item.id));
// The 2026-10-28 navigation change moves only these two parsers out of the
// historical analysis set. Keep their frozen package contracts under test.
const reclassifiedParsers = new Map([
  ['sesame/rss-collect', 'search'],
  ['sesame/web-extract', 'search'],
]);

function contractFixture() {
  const manifest = { id: 'fixture/analysis', version: '1.0.0', engines: { sesame: '>=0.2.3' }, resources: ['guide.md'], dependencies: [{ name: 'fixture/source', version: '1.0.0' }] };
  const declaration = { capabilities: [{ id: 'calculate', inputSchema: { type: 'object', properties: { version: { type: 'string' } } }, effects: ['read'], binding: { type: 'native', name: 'calculate' } }], stateCollections: [] };
  const item = { id: manifest.id, manifestDigest: digest(manifest), declarationDigest: digest(declaration) };
  const snapshot = { schemaVersion: 1, packages: [item] }, bytes = Buffer.from(JSON.stringify(snapshot));
  const extension = { schemaVersion: 1, status: 'approved', baselineSha256: byteDigest(bytes), baselineVersions: { [item.id]: manifest.version }, changes: [] };
  return { manifest, declaration, item, snapshot, bytes, extension };
}

test('version reconstruction retains the full manifest and declaration semantic gates', () => {
  const f = contractFixture(), changes = validateExtensions(f.snapshot, f.bytes, f.extension);
  const relabeled = { ...f.manifest, version: '2.0.0' };
  assert.doesNotThrow(() => assertFrozenContract(f.item, 'manifest', relabeled, f.extension, changes));
  assert.doesNotThrow(() => assertFrozenContract(f.item, 'declaration', f.declaration, f.extension, changes));
  for (const mutate of [
    value => { value.permissions = { scopes: [], calls: ['fixture/source#read'] }; },
    value => { value.engines.sesame = '>=0.3.0-dev.1 <0.4.0'; },
    value => { value.resources = []; },
    value => { value.dependencies[0].version = '2.0.0'; },
  ]) { const changed = structuredClone(relabeled); mutate(changed); assert.throws(() => assertFrozenContract(f.item, 'manifest', changed, f.extension, changes)); }
  for (const mutate of [
    value => { value.capabilities[0].inputSchema.properties.version.type = 'integer'; },
    value => { value.capabilities[0].effects = []; },
    value => { value.capabilities[0].binding.name = 'another'; },
    value => { value.stateCollections.push({ name: 'new-state' }); },
  ]) { const changed = structuredClone(f.declaration); mutate(changed); assert.throws(() => assertFrozenContract(f.item, 'declaration', changed, f.extension, changes)); }
});

test('semantic extensions require exact reviewed before/after hashes, not replacement goldens', () => {
  const f = contractFixture(), manifest = { ...f.manifest, version: '2.0.0', engines: { sesame: '>=0.3.0-dev.1 <0.4.0' } };
  f.extension.changes.push({ pluginId: f.item.id, component: 'manifest', beforeDigest: f.item.manifestDigest, afterDigest: digest({ ...manifest, version: '1.0.0' }), decision: 'approved', reason: 'Fixture-only review of the exact host compatibility floor migration.' });
  const check = extension => assertFrozenContract(f.item, 'manifest', manifest, extension, validateExtensions(f.snapshot, f.bytes, extension));
  assert.doesNotThrow(() => check(f.extension));
  for (const mutate of [
    value => { value.status = 'pending-review'; },
    value => { value.changes[0].decision = 'pending'; },
    value => { value.changes[0].beforeDigest = 'sha256:' + 'a'.repeat(64); },
    value => { value.changes[0].afterDigest = 'sha256:' + 'a'.repeat(64); },
    value => { value.changes[0].reason = ''; },
    value => { value.changes[0].pluginId = 'fixture/unknown'; },
    value => { value.changes[0].component = 'permissions-only'; },
    value => { value.changes.push(value.changes[0]); },
    value => { value.baselineVersions[f.item.id] = '0.9.0'; },
    value => { value.baselineVersions['fixture/unknown'] = '1.0.0'; },
  ]) { const changed = structuredClone(f.extension); mutate(changed); assert.throws(() => check(changed)); }
  const changed = { ...manifest, resources: ['unexpected.md'] };
  assert.throws(() => assertFrozenContract(f.item, 'manifest', changed, f.extension, validateExtensions(f.snapshot, f.bytes, f.extension)), 'approved hashes cannot absorb new semantic drift');
  assert.throws(() => validateExtensions(f.snapshot, Buffer.concat([f.bytes, Buffer.from('\n')]), f.extension), /immutable analysis fixture bytes/);
});

test('the immutable analysis contract plus explicit additions cover current analysis packages and reclassified search parsers', () => {
  assert.equal(baseline.packages.length, 31);
  assert.equal(baseline.packages.reduce((count, item) => count + item.capabilityIds.length, 0), 33);
  assert.deepEqual([...retiredIds], ['sesame/abu-backtest-lab']);
  assert.deepEqual(currentContracts.filter(item => !reclassifiedParsers.has(item.id)).map(item => item.id.split('/')[1]).sort(), Object.keys(policy).filter(name => policy[name].functionalCategory === 'analysis').sort());
  for (const [id, category] of reclassifiedParsers) {
    assert.equal(baseline.packages.find(item => item.id === id).functionalCategory, 'analysis');
    assert.equal(policy[id.split('/')[1]].functionalCategory, category);
    assert.equal(policy[id.split('/')[1]].category, 'data');
  }
  assert.ok(!baseline.packages.some(item => item.id.includes('kurumi')));
});

for (const item of currentContracts) {
  test(`${item.id}: preserves complete declarations and loads from its independently packaged archive`, async t => {
    const directory = join(root, item.sourcePath), name = item.id.split('/')[1];
    const manifest = JSON.parse(readFileSync(join(directory, 'plugin.json'), 'utf8'));
    const declaration = JSON.parse(readFileSync(join(directory, 'capabilities.json'), 'utf8'));
    if (additions.packages.some(added => added.id === item.id)) {
      assertFrozenContract(item, 'manifest', manifest, additionExtensions, reviewedAdditions);
      assertFrozenContract(item, 'declaration', declaration, additionExtensions, reviewedAdditions);
    } else {
      assertFrozenContract(item, 'manifest', manifest, extensions, reviewedChanges);
      assertFrozenContract(item, 'declaration', declaration, extensions, reviewedChanges);
    }
    assert.equal(policy[name].functionalCategory, reclassifiedParsers.get(item.id) ?? item.functionalCategory);
    assert.deepEqual(policy[name].implementationKinds, item.implementationKinds);
    for (const path of item.paths) assert.ok(existsSync(join(directory, path)), `Original package path remains available: ${path}`);

    const temporary = mkdtempSync(join(tmpdir(), 'sesame-analysis-archive-'));
    t.after(() => { assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep)); rmSync(temporary, { recursive: true, force: true, maxRetries: 3 }); });
    const stage = join(temporary, 'source'), unpacked = join(temporary, 'installed');
    mkdirSync(join(stage, 'packages'), { recursive: true }); mkdirSync(unpacked);
    cpSync(directory, join(stage, 'packages', name), { recursive: true });
    const lock = buildLock(stage), archive = join(temporary, 'plugin.tar.gz');
    assert.equal(lock.packages.length, 1);
    writeFileSync(archive, createArchive(stage, lock));
    // GNU tar interprets a Windows C: archive path as a remote host. Keep the
    // extraction isolated, but pass portable relative names inside its cwd.
    execFileSync('tar', ['-xzf', 'plugin.tar.gz', '-C', 'installed'], { cwd: temporary, windowsHide: true, stdio: 'pipe' });
    assert.deepEqual(readdirSync(unpacked).sort(), [name, 'official-plugins.lock.json'].sort());
    assert.deepEqual(JSON.parse(readFileSync(join(unpacked, 'official-plugins.lock.json'), 'utf8')), lock);
    const installed = join(unpacked, name);
    assert.equal(treeDigest(packageFiles(installed)), treeDigest(lock.packages[0].files));
    const { createCapabilities } = await import(pathToFileURL(join(installed, manifest.entry)));
    assert.equal(typeof createCapabilities, 'function');
    // Registration is side-effect-free even for stateful evaluator/decision services.
    const capabilities = createCapabilities({});
    assert.deepEqual(capabilities.map(capability => capability.name), declaration.capabilities.map(capability => capability.binding.name));
  });
}
