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
  const manifest = { id: 'sesame/example', apiVersion: '1', version: '1.0.0', license: 'MIT', default_state: 'discoverable', tool_names: [], tool_definitions: 'tools.json', engines: { sesame: '>=0.2.0-0' } };
  const write = value => writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(value));
  write(manifest); writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '1.0.0', type: 'module', license: 'MIT' }));
  writeFileSync(join(pkg, 'LICENSE'), 'MIT fixture'); writeFileSync(join(pkg, 'tools.json'), '[]');
  const profile = { schemaVersion: 1, kind, engines: manifest.engines, packages: [manifest.id] };
  writeFileSync(join(root, 'bundle-profile.json'), JSON.stringify(profile));
  return { root, pkg, manifest, profile, write };
}
test('candidate distribution has nine defaults and twenty-two optional identities, with no duplicate tools from merged packages', () => {
  const defaults = buildLock(core), options = buildLock(optional);
  assert.equal(defaults.packages.length, 9); assert.equal(options.packages.length, 22);
  const ids = [...defaults.packages, ...options.packages].map(item => item.id); assert.equal(new Set(ids).size, 31);
  assert.deepEqual(defaults.packages.map(item => item.id), readProfile(core).packages);
  assert.ok(options.packages.some(item => item.id === 'sesame/mt5'));
  for (const id of ['sesame/host-files', 'sesame/user-guide', 'sesame/research']) assert.ok(!ids.includes(id));
  const names = defaults.packages.flatMap(pkg => JSON.parse(readFileSync(join(core, 'packages', pkg.directory, 'plugin.json'))).tool_names);
  assert.equal(new Set(names).size, names.length);
  for (const name of ['read', 'host_files_run', 'data_read', 'research_register', 'market_read', 'agent_delegate', 'report_publish', 'strategy_validate']) assert.ok(names.includes(name), name);
});
test('the actual default archive contains only the nine reviewed packages and their exact file list', () => {
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
test('historical source trees without profiles retain their exact legacy build semantics', t => {
  const f = fixture(t); rmSync(join(f.root, 'bundle-profile.json'));
  f.write({ ...f.manifest, engines: undefined, migration: { collections: ['old'] } });
  assert.equal(readProfile(f.root), null); assert.equal(buildLock(f.root).packages.length, 1);
});
test('descriptive inventory records compatibility without claiming an application release', () => {
  const preview = buildInventory(core);
  assert.deepEqual(preview, JSON.parse(readFileSync(join(core, 'inventory.json'))));
  assert.equal(preview.status, 'descriptive-inventory');
  assert.equal(preview.application.released, undefined);
  assert.equal(preview.application.minimum, '0.2.0');
  assert.equal(preview.packages.filter(p => p.distribution === 'core').length, 9);
  assert.equal(preview.packages.filter(p => p.distribution === 'optional').length, 22);
  for (const item of preview.packages) {
    for (const key of ['source', 'sourceCommit', 'package', 'treeDigest', 'review', 'release']) assert.equal(item[key], undefined);
    assert.equal(item.engines.sesame, '>=0.2.0-0');
    assert.ok(item.title.en && item.title.zh && item.dependencies.en && item.dependencies.zh);
  }
});
