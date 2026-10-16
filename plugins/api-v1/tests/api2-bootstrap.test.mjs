import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLock, createArchive } from '../scripts/plugin-lock.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const declarations = ['capabilities', 'sources', 'views', 'services', 'knowledge', 'hooks', 'stateCollections', 'artifactSchemas'];
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

function fixture(t) {
  const source = mkdtempSync(join(tmpdir(), 'sesame-api2-bootstrap-'));
  t.after(() => {
    assert.equal(dirname(resolve(source)), resolve(tmpdir()));
    rmSync(source, { recursive: true, force: true });
  });
  const path = join(source, 'packages/example');
  mkdirSync(path, { recursive: true });
  const manifest = { id: 'sesame/example', apiVersion: '2', version: '1.0.0', license: 'MIT', default_state: 'discoverable', entry: 'index.js', capability_manifest: 'capabilities.json', prompts: [], resources: [] };
  const declared = {
    schemaVersion: 1, apiVersion: '2', ...Object.fromEntries(declarations.map(key => [key, []])),
    capabilities: [{ id: 'fixture.read', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
      usage: { purpose: 'Read the fixture value.', inputs: 'An empty object.', outputs: 'A value object.', prerequisites: [], limitations: [] },
      consumers: ['agent', 'host'], binding: { type: 'native', export: 'read' } }],
    knowledge: [{ path: 'README.md' }],
  };
  save(join(path, 'plugin.json'), manifest);
  save(join(path, 'capabilities.json'), declared);
  save(join(path, 'package.json'), { name: '@sesame/plugin-example', version: '1.0.0', type: 'module', license: 'MIT' });
  writeFileSync(join(path, 'LICENSE'), 'Fixture license');
  writeFileSync(join(path, 'README.md'), '# Fixture\n');
  writeFileSync(join(path, 'index.js'), 'throw new Error("Candidate modules must never execute during validation");\n');
  return { source, path, manifest, declared };
}

test('API 1 core and optional sources retain their exact committed lock bytes', () => {
  for (const source of [sourceRoot, resolve(sourceRoot, '../optional-api-v1')]) {
    const lock = buildLock(source);
    assert.equal(lock.apiVersion, '1');
    assert.equal(JSON.stringify(lock, null, 2) + '\n', readFileSync(join(source, 'official-plugins.lock.json'), 'utf8'));
  }
});

test('API 2 capabilities produce deterministic locks and archives without executing modules', t => {
  const f = fixture(t), lock = buildLock(f.source);
  assert.equal(lock.apiVersion, '2');
  assert.deepEqual(lock.packages.map(pkg => pkg.id), ['sesame/example']);
  assert.deepEqual(buildLock(f.source), lock);
  assert.deepEqual(createArchive(f.source, lock), createArchive(f.source, lock));
});

test('API 2 requires every declaration collection and explicit capability usage', t => {
  const f = fixture(t), declarationPath = join(f.path, 'capabilities.json');
  for (const field of declarations) {
    const value = structuredClone(f.declared); delete value[field]; save(declarationPath, value);
    assert.throws(() => buildLock(f.source), new RegExp(`${field} must be explicitly declared`));
  }
  for (const field of ['purpose', 'inputs', 'outputs', 'prerequisites', 'limitations']) {
    const value = structuredClone(f.declared); delete value.capabilities[0].usage[field]; save(declarationPath, value);
    assert.throws(() => buildLock(f.source), /incomplete capability declaration/);
  }
  for (const field of ['inputSchema', 'outputSchema', 'usage']) {
    const value = structuredClone(f.declared); delete value.capabilities[0][field]; save(declarationPath, value);
    assert.throws(() => buildLock(f.source), /incomplete capability declaration/);
  }
  for (const consumers of [undefined, [], ['unknown']]) {
    const value = structuredClone(f.declared); value.capabilities[0].consumers = consumers; save(declarationPath, value);
    assert.throws(() => buildLock(f.source), /consumers must be explicit/);
  }
  const duplicate = structuredClone(f.declared); duplicate.capabilities.push(duplicate.capabilities[0]); save(declarationPath, duplicate);
  assert.throws(() => buildLock(f.source), /IDs must be unique/);
});

test('API 2 rejects legacy declarations, invalid bindings and missing resources', t => {
  const f = fixture(t), manifestPath = join(f.path, 'plugin.json'), declarationPath = join(f.path, 'capabilities.json');
  for (const field of ['tool_names', 'tool_definitions']) {
    save(manifestPath, { ...f.manifest, [field]: [] });
    assert.throws(() => buildLock(f.source), /single capability declaration/);
  }
  save(manifestPath, { ...f.manifest, capability_manifest: '../outside.json' });
  assert.throws(() => buildLock(f.source), /capability manifest is missing/);
  save(manifestPath, { ...f.manifest, entry: 'missing.js' });
  assert.throws(() => buildLock(f.source), /native entry is missing/);
  save(manifestPath, f.manifest);
  save(declarationPath, { ...f.declared, apiVersion: '1' });
  assert.throws(() => buildLock(f.source), /capability manifest version/);
  const mcp = structuredClone(f.declared); mcp.capabilities[0].binding = { type: 'mcp', server: 'missing', name: 'read' }; save(declarationPath, mcp);
  assert.throws(() => buildLock(f.source), /undeclared MCP server binding/);
  save(declarationPath, { ...f.declared, knowledge: [{ path: 'missing.md' }] });
  assert.throws(() => buildLock(f.source), /missing resource/);
});

test('API 2 keeps package identity, profile and static import boundaries', t => {
  const f = fixture(t), manifestPath = join(f.path, 'plugin.json');
  writeFileSync(join(f.path, 'index.js'), "import secret from '../../../private.js';\n");
  assert.throws(() => buildLock(f.source), /import escapes/);
  writeFileSync(join(f.path, 'index.js'), "import value from 'undeclared-package';\n");
  assert.throws(() => buildLock(f.source), /undeclared dependency/);
  writeFileSync(join(f.path, 'index.js'), 'export const value = 1;\n');
  save(manifestPath, { ...f.manifest, id: 'other/example' });
  assert.throws(() => buildLock(f.source), /Incorrect publisher identity/);
  save(join(f.source, 'bundle-profile.json'), { schemaVersion: 1, kind: 'optional', engines: { sesame: '>=0.2.0-0' }, packages: ['sesame/example'] });
  save(manifestPath, { ...f.manifest, engines: { sesame: '>=0.1.4' } });
  assert.throws(() => buildLock(f.source), /must not widen/);
  save(manifestPath, { ...f.manifest, engines: { sesame: '>=0.2.3-dev.5' } });
  assert.equal(buildLock(f.source).apiVersion, '2');
  writeFileSync(join(f.path, 'index.js'), 'const privateState = storage.legacy;\n');
  assert.throws(() => buildLock(f.source), /must use private storage/);
});

test('dispatch rejects unsupported, conflicting and mixed manifest API versions', t => {
  const f = fixture(t), manifestPath = join(f.path, 'plugin.json');
  save(manifestPath, { ...f.manifest, apiVersion: '3' });
  assert.throws(() => buildLock(f.source), /unsupported API version/);
  save(manifestPath, { ...f.manifest, extensions: { 'bot.sesame': { apiVersion: '1' } } });
  assert.throws(() => buildLock(f.source), /conflicting API versions/);
  save(manifestPath, f.manifest);
  const legacy = join(f.source, 'packages/legacy'); mkdirSync(legacy);
  save(join(legacy, 'plugin.json'), { id: 'sesame/legacy', apiVersion: '1' });
  assert.throws(() => buildLock(f.source), /Mixed API versions/);
});

test('dispatch refuses package-directory and manifest symlinks before reading target data', t => {
  const f = fixture(t), manifestPath = join(f.path, 'plugin.json');
  rmSync(manifestPath); symlinkSync('README.md', manifestPath);
  assert.throws(() => buildLock(f.source), /manifest must be an ordinary file/);
  symlinkSync(f.path, join(f.source, 'packages/alias'), 'junction');
  assert.throws(() => buildLock(f.source), /Package is not an ordinary directory/);
  const linked = join(f.source, 'linked'); mkdirSync(linked);
  symlinkSync(join(f.source, 'packages'), join(linked, 'packages'), 'junction');
  assert.throws(() => buildLock(linked), /Packages must be an ordinary directory/);
});

// Point at a clean export of the reviewed API 2 commit for migration acceptance.
// This is data only: neither its validator nor any package module is imported.
test('reviewed API 2 core and optional source match all 55 committed package locks', { skip: !process.env.SESAME_API2_SOURCE }, () => {
  let packages = 0;
  for (const bundle of ['api-v1', 'optional-api-v1']) {
    const source = resolve(process.env.SESAME_API2_SOURCE, 'plugins', bundle), lock = buildLock(source);
    assert.equal(lock.apiVersion, '2');
    assert.equal(JSON.stringify(lock, null, 2) + '\n', readFileSync(join(source, 'official-plugins.lock.json'), 'utf8'));
    packages += lock.packages.length;
  }
  assert.equal(packages, 55);
});
