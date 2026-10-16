import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, link, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAccess, digest } from '../packages/workspace/file-access.js';
import { createCapabilities } from '../packages/workspace/index.js';
import { replacements } from '../packages/workspace/tools.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sesame-workspace-v2-'));
  const data = join(root, 'app'), work = join(data, 'workspaces', 'main'), auth = join(root, 'auth');
  await mkdir(work, { recursive: true }); await mkdir(auth);
  const context = { kind: 'main', sessionId: 'session', workspaceRoot: work, storageRoot: join(data, 'plugins', 'data', 'workspace'), filePolicy: { protectedRoots: [data, auth], readRoots: [work], writeRoots: [work] } };
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, data, work, auth, context, files: new FileAccess(context) };
}

test('file access fails closed without host policy and protects private roots and aliases', async t => {
  assert.throws(() => new FileAccess({}), /policy/i);
  const f = await fixture(t); await writeFile(join(f.data, 'app.sqlite'), 'private'); await writeFile(join(f.auth, 'auth.json'), 'secret');
  for (const path of [join(f.data, 'app.sqlite'), join(f.auth, 'auth.json')]) await assert.rejects(f.files.read({ path }), { code: 'external_file_forbidden' });
  await assert.rejects(f.files.remove({ path: f.data }), { code: 'external_file_forbidden' });
  const alias = join(f.root, 'alias');
  try { await symlink(f.data, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error; return; }
  await assert.rejects(f.files.read({ path: join(alias, 'app.sqlite') }), { code: 'external_file_forbidden' });
});

test('writes preserve no-overwrite and digest conflicts; removal never deletes a nonempty tree', async t => {
  const f = await fixture(t), path = join(f.work, 'value.txt');
  await f.files.write({ path, content: 'original' });
  await assert.rejects(f.files.write({ path, content: 'changed' }), { code: 'external_file_exists' });
  await assert.rejects(f.files.write({ path, content: 'changed', overwrite: true, expected_sha256: digest('wrong') }), { code: 'external_file_changed' });
  assert.equal(await readFile(path, 'utf8'), 'original');
  await f.files.write({ path, content: 'changed', overwrite: true, expected_sha256: digest('original') });
  assert.equal(await readFile(path, 'utf8'), 'changed');
  await assert.rejects(f.files.remove({ path: f.work }), error => ['ENOTEMPTY', 'EEXIST'].includes(error.code));
  await f.files.remove({ path, expected_sha256: digest('changed') });
});

test('hard links are rejected and reads expose real byte paging', async t => {
  const f = await fixture(t), path = join(f.work, 'value.txt'), linked = join(f.work, 'linked.txt');
  await writeFile(path, 'abcdef');
  const read = await f.files.read({ path, offset: 2, limit: 2 });
  assert.equal(read.content, 'cd'); assert.equal(read.next_offset, 4);
  await link(path, linked);
  await assert.rejects(f.files.read({ path }), { code: 'external_file_type' });
});

test('exact edits preserve BOM/newlines and reject ambiguous or overlapping replacements', () => {
  assert.equal(replacements('\uFEFFone\r\ntwo\r\n', [{ oldText: 'one\ntwo', newText: 'three\nfour' }]), '\uFEFFthree\r\nfour\r\n');
  assert.throws(() => replacements('ababa', [{ oldText: 'aba', newText: '' }]), /exactly one/);
  assert.throws(() => replacements('abcdef', [{ oldText: 'abc', newText: '' }, { oldText: 'bcde', newText: '' }]), /overlap/);
});

test('capabilities edit real workspace files and route commands through the managed process Run', async t => {
  const f = await fixture(t), calls = [], signal = new AbortController().signal;
  const host = { context: f.context, capabilities: { async invoke(id, input, options) { calls.push({ id, input, options }); return { type: 'run', run: { id: 'process_real' }, receipt: {} }; } }, runs: { async wait() { return { reason: 'settled', run: { id: 'process_real', status: 'completed', output: { output: 'real output', exitCode: 0 } } }; }, async cancel() {} } };
  const tools = new Map(createCapabilities(host).map(item => [item.name, item.execute]));
  await tools.get('write')({ path: 'sample.txt', content: 'one\ntwo' });
  await tools.get('edit')({ path: 'sample.txt', edits: [{ oldText: 'two', newText: 'three' }] });
  assert.equal((await tools.get('read')({ path: 'sample.txt', offset: 2, limit: 1 })).text, 'three');
  assert.throws(() => tools.get('write')({ path: '../outside', content: 'no' }), /workspace/i);
  const result = await tools.get('bash')({ command: 'echo checked', timeout: 3 }, signal);
  assert.equal(result.output, 'real output'); assert.equal(result.run.id, 'process_real');
  assert.equal(calls[0].id, 'host.process.exec'); assert.equal(calls[0].input.cwd, await realpath(f.work)); assert.equal(calls[0].input.timeoutMs, 3000); assert.equal(calls[0].options.signal, signal);
});
