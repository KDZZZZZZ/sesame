import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { buildLock, createArchive, readProfile } from '../scripts/plugin-lock.mjs';
import { buildInventory } from '../scripts/inventory.mjs';

const core = fileURLToPath(new URL('../', import.meta.url));
const optional = fileURLToPath(new URL('../../optional-api-v1/', import.meta.url));
function fixture(t, kind = 'optional') {
  const root = mkdtempSync(join(tmpdir(), 'sesame-profile-')), pkg = join(root, 'packages/example'); mkdirSync(pkg, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = { id: 'sesame/example', apiVersion: '2', version: '1.0.0', license: 'MIT', default_state: 'discoverable', capability_manifest: 'capabilities.json', engines: { sesame: '>=0.2.0-0' } };
  const write = value => writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(value));
  write(manifest); writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '1.0.0', type: 'module', license: 'MIT' }));
  writeFileSync(join(pkg, 'LICENSE'), 'MIT fixture'); writeFileSync(join(pkg, 'capabilities.json'), JSON.stringify({schemaVersion:1,apiVersion:'2',capabilities:[],sources:[],views:[],services:[],knowledge:[],hooks:[],stateCollections:[],artifactSchemas:[]}));
  const profile = { schemaVersion: 1, kind, engines: manifest.engines, packages: [manifest.id] };
  writeFileSync(join(root, 'bundle-profile.json'), JSON.stringify(profile));
  return { root, pkg, manifest, profile, write };
}
test('candidate distribution has eleven core and forty-eight optional identities, including separate product and coordination guides', () => {
  const defaults = buildLock(core), options = buildLock(optional);
  assert.equal(defaults.packages.length, 11); assert.equal(options.packages.length, 48);
  const ids = [...defaults.packages, ...options.packages].map(item => item.id); assert.equal(new Set(ids).size, 59);
  assert.deepEqual(defaults.packages.map(item => item.id), readProfile(core).packages);
  assert.ok(defaults.packages.some(item => item.id === 'sesame/ultra'));
  assert.ok(!options.packages.some(item => item.id === 'sesame/ultra'));
  assert.ok(options.packages.some(item => item.id === 'sesame/mt5'));
  assert.ok(options.packages.some(item => item.id === 'sesame/binance'));
  for (const id of ['sesame/host-files', 'sesame/research', 'sesame/manual-trading']) assert.ok(!ids.includes(id));
  for (const id of ['sesame/investment-research', 'sesame/trading-decision', 'sesame/ultra', 'sesame/user-guide']) assert.ok(ids.includes(id));
  const names = defaults.packages.flatMap(pkg => JSON.parse(readFileSync(join(core, 'packages', pkg.directory, 'capabilities.json'))).capabilities.filter(cap => cap.consumers.includes('agent')).map(cap => cap.id));
  assert.equal(new Set(names).size, names.length);
  for (const name of ['read', 'host_files_run', 'data_read', 'research_register', 'market_read', 'report_publish', 'strategy_validate']) assert.ok(names.includes(name), name);
});
test('the actual core archive contains only the eleven reviewed packages and their exact file list', () => {
  const lock = buildLock(core), bytes = gunzipSync(createArchive(core, lock)), names = [];
  for (let offset = 0; bytes[offset];) {
    const header = bytes.subarray(offset, offset + 512), text = (a, b) => header.subarray(a, b).toString().replace(/\0.*$/, '');
    const name = [text(345, 500), text(0, 100)].filter(Boolean).join('/'), size = parseInt(text(124, 136), 8);
    names.push(name); offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.deepEqual(names.sort(), ['official-plugins.lock.json', ...lock.packages.flatMap(pkg => pkg.files.map(file => `${pkg.directory}/${file.path}`))].sort());
  for (const pkg of buildLock(optional).packages) assert.equal(names.some(name => name.startsWith(`${pkg.directory}/`)), false, pkg.id);
});
test('profile enforcement rejects omitted or old engines, implicit mounting, legacy grants and altered membership', t => {
  const f = fixture(t); assert.equal(buildLock(f.root).packages.length, 1);
  for (const change of [{ engines: undefined }, { engines: { sesame: '>=0.1.4' } }, { default_state: 'mounted' }, { migration: { collections: [] } }]) {
    f.write({ ...f.manifest, ...change }); assert.throws(() => buildLock(f.root), /engine|default state|legacy/);
  }
  f.write(f.manifest);
  for (const reference of ['host.storage.legacy.list("old")', 'host.storage?.legacy.list("old")', 'host.storage["legacy"].path("old")']) {
    writeFileSync(join(f.pkg, 'index.js'), reference); assert.throws(() => buildLock(f.root), /private storage/);
  }
  rmSync(join(f.pkg, 'index.js'));
  writeFileSync(join(f.root, 'bundle-profile.json'), JSON.stringify({ ...f.profile, packages: ['sesame/other'] })); assert.throws(() => buildLock(f.root), /Package set/);
  writeFileSync(join(f.root, 'bundle-profile.json'), JSON.stringify({ ...f.profile, packages: ['sesame/example', 'sesame/example'] })); assert.throws(() => buildLock(f.root), /unique/);
});
test('source trees without distribution profiles still require API 2 declarations', t => {
  const f = fixture(t); rmSync(join(f.root, 'bundle-profile.json'));
  f.write({ ...f.manifest, engines: undefined, migration: { collections: ['old'] } });
  assert.equal(readProfile(f.root), null); assert.equal(buildLock(f.root).packages.length, 1);
  f.write({ ...f.manifest, apiVersion: '1' }); assert.throws(() => buildLock(f.root), /API version must be 2/);
});
test('descriptive inventory records compatibility without claiming an application release', () => {
  const preview = buildInventory(core);
  assert.deepEqual(preview, JSON.parse(readFileSync(join(core, 'inventory.json'))));
  assert.equal(preview.status, 'descriptive-inventory');
  assert.equal(preview.application.released, undefined);
  assert.equal(preview.application.minimum, '0.2.0');
  assert.equal(preview.packages.filter(p => p.distribution === 'core').length, 11);
  assert.equal(preview.packages.filter(p => p.distribution === 'optional').length, 48);
  const ultra = preview.packages.find(p => p.id === 'sesame/ultra');
  assert.equal(ultra.distribution, 'core');
  assert.equal(ultra.functionalCategory, 'business');
  assert.deepEqual(ultra.implementationKinds, ['workflow', 'service']);
  assert.equal(ultra.sourcePath, 'plugins/api-v1/packages/ultra');
  for (const item of preview.packages) {
    for (const key of ['source', 'sourceCommit', 'package', 'treeDigest', 'review', 'release']) assert.equal(item[key], undefined);
    assert.equal(item.engines.sesame, JSON.parse(readFileSync(join(core, '../..', item.sourcePath, 'plugin.json'))).engines.sesame);
    assert.ok(item.title.en && item.title.zh && item.dependencies.en && item.dependencies.zh);
  }
});
