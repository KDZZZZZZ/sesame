import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildLock, createArchive, packageFiles, portableGzip, sha256, treeDigest } from '../scripts/plugin-lock.mjs';

function source(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sesame-plugin-lock-')), root = join(directory, 'packages/example'); mkdirSync(root, { recursive: true });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({ id: 'sesame/example', apiVersion: '1', version: '1.0.0', license: 'MIT', default_state: 'discoverable', tool_names: [], tool_definitions: 'tools.json', prompts: [], resources: [] }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@sesame/plugin-example', version: '1.0.0', type: 'module', license: 'MIT' }));
  writeFileSync(join(root, 'LICENSE'), 'Fixture license'); writeFileSync(join(root, 'tools.json'), '[]');
  return { directory, root };
}

test('portable gzip has a fixed wire representation and supports empty and multi-block payloads', () => {
  assert.equal(portableGzip(Buffer.from('hello')).toString('hex'), '1f8b08000000000000ff010500faff68656c6c6f86a6103605000000');
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(65535, 7), Buffer.alloc(131071, 123)]) assert.deepEqual(gunzipSync(portableGzip(bytes)), bytes);
});

test('tree identity includes sorted relative paths and prefixed inner hashes', () => {
  const files = [{ path: 'b.txt', sha256: sha256('b'), bytes: 1 }, { path: 'a.txt', sha256: sha256('a'), bytes: 1 }];
  assert.equal(treeDigest(files), `sha256:${sha256(JSON.stringify([['a.txt', `sha256:${sha256('a')}`], ['b.txt', `sha256:${sha256('b')}`]]))}`);
  assert.notEqual(treeDigest(files), treeDigest(files.map(file => ({ ...file, path: `other/${file.path}` }))));
});

test('archive is deterministic and contains exactly lock and declared package files', t => {
  const f = source(t), lock = buildLock(f.directory), archive = createArchive(f.directory, lock);
  assert.deepEqual(createArchive(f.directory, lock), archive);
  const tar = gunzipSync(archive), names = [];
  for (let offset = 0; tar[offset];) {
    const header = tar.subarray(offset, offset + 512), name = header.subarray(0, 100).toString().replace(/\0.*$/, ''), size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, ''), 8);
    names.push(name); assert.equal(header.subarray(136, 148).toString(), '00000000000\0'); assert.equal(header[156], 48);
    const bytes = tar.subarray(offset + 512, offset + 512 + size);
    if (name === 'official-plugins.lock.json') assert.deepEqual(JSON.parse(bytes), lock);
    else { const file = lock.packages[0].files.find(file => `example/${file.path}` === name); assert.ok(file); assert.equal(file.sha256, sha256(bytes)); }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.deepEqual(names.sort(), ['official-plugins.lock.json', ...lock.packages[0].files.map(file => `example/${file.path}`)].sort());
  writeFileSync(join(f.root, 'tools.json'), '[{"name":"changed"}]');
  assert.throws(() => createArchive(f.directory, lock), /differs/);
});

test('source validation rejects symlinks, private imports, stale metadata and unexpected local files', t => {
  const f = source(t);
  symlinkSync('tools.json', join(f.root, 'alias.json')); assert.throws(() => packageFiles(f.root), /Unsafe/); rmSync(join(f.root, 'alias.json'));
  writeFileSync(join(f.root, 'index.js'), "import x from '../../../../modules/agent/private.js';"); assert.throws(() => buildLock(f.directory), /escapes/); rmSync(join(f.root, 'index.js'));
  writeFileSync(join(f.root, 'nul.json'), '{}'); assert.throws(() => packageFiles(f.root), /Unsafe/); rmSync(join(f.root, 'nul.json'));
  mkdirSync(join(f.root, 'node_modules')); assert.throws(() => buildLock(f.directory), /Local or generated/); rmSync(join(f.root, 'node_modules'), { recursive: true });
  writeFileSync(join(f.root, 'package.json'), JSON.stringify({ version: '9.0.0', type: 'module', license: 'MIT' })); assert.throws(() => buildLock(f.directory), /version/);
});
