import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { compilerSnapshotFrames, COMPILER_SNAPSHOT_LIMITS } from '../packages/mt5/backend/compiler-snapshot.js';
import { digest as hash } from '../packages/mt5/backend/support.js';
import { fileManifest } from '../packages/mt5/backend/native.js';

const tempRoot = fileURLToPath(new URL('../../../.test-output/compiler/', import.meta.url));
const receiver = fileURLToPath(new URL('../packages/mt5/backend/resources/compiler-snapshot.py', import.meta.url));
async function fixture(t, editor = Buffer.alloc(600_001, 73)) {
  await fs.mkdir(tempRoot, { recursive: true });
  const root = await fs.mkdtemp(join(tempRoot, 'compiler-snapshot-test-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tempRoot));
    assert.match(basename(root), /^compiler-snapshot-test-/);
    await fs.rm(root, { recursive: true, force: true });
  });
  const source = join(root, 'source'), parent = join(root, 'received');
  await fs.mkdir(source); await fs.mkdir(parent);
  const files = new Map([
    ['.compiler/MetaEditor64.exe', editor], ['Experts/Strategy.mq5', Buffer.from('void OnTick() {}\n')],
    ['Include/Custom/icon.bin', Buffer.from([0, 255, 128, 42])], ['Include/empty', Buffer.alloc(0)],
    ['engine.json', Buffer.from('{"fixture":true}')],
  ]);
  for (const [name, bytes] of files) { await fs.mkdir(dirname(join(source, name)), { recursive: true }); await fs.writeFile(join(source, name), bytes); }
  // This is the production file/hash schema, not a P0 fixture approximation.
  const manifest = { build_id: 'controlled-test', compiler_sha256: hash(editor), files: await fileManifest(source) };
  const save = async () => { const bytes = Buffer.from(JSON.stringify(manifest, null, 2)); await fs.writeFile(join(source, 'manifest.json'), bytes); return hash(bytes); };
  return { root, source, parent, files, manifest, save, digest: await save() };
}
async function receive(source, parent, digest) {
  const child = spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [receiver, '--parent', parent, '--manifest-sha256', digest], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
  let streamError;
  try { await pipeline(Readable.from(source), child.stdin); } catch (error) { streamError = error; }
  const code = await closed;
  return { code, result: stdout ? JSON.parse(stdout) : null, stderr, streamError };
}

test('frozen compiler and arbitrary Include resources cross the bounded stream exactly', async t => {
  const f = await fixture(t);
  await fs.writeFile(join(f.source, 'not-in-manifest.txt'), 'must not be sent');
  async function* bounded() {
    for await (const frame of compilerSnapshotFrames(f.source, f.digest)) {
      assert.ok(Buffer.isBuffer(frame)); assert.ok(frame.length <= 1024 * 1024);
      assert.equal(frame.at(-1), 10);
      const value = JSON.parse(frame); if (value.data) assert.ok(Buffer.from(value.data, 'base64').length <= 256 * 1024);
      yield frame;
    }
  }
  const r = await receive(bounded(), f.parent, f.digest);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.streamError, undefined);
  assert.equal(r.result.manifest_sha256, f.digest); assert.equal(r.result.file_count, f.files.size);
  assert.equal(dirname(r.result.directory), f.parent);
  for (const [name, bytes] of f.files) assert.deepEqual(await fs.readFile(join(r.result.directory, name)), bytes);
  assert.equal(hash(await fs.readFile(join(r.result.directory, 'manifest.json'))), f.digest);
  await assert.rejects(fs.stat(join(r.result.directory, 'not-in-manifest.txt')), { code: 'ENOENT' });
  assert.equal(COMPILER_SNAPSHOT_LIMITS.fileBytes, 256 * 1024 * 1024);
});

async function collect(source) { const result = []; for await (const value of source) result.push(value); return result; }

test('host refuses hardlinked sources and an aliased frozen root', async t => {
  const f = await fixture(t);
  const editor = join(f.source, '.compiler/MetaEditor64.exe');
  const alias = join(f.root, 'editor-alias');
  await fs.link(editor, alias);
  await assert.rejects(collect(compilerSnapshotFrames(f.source, f.digest)), /link|ordinary|regular/i);
  await fs.unlink(alias);
  const rootAlias = join(f.root, 'root-alias');
  await fs.symlink(f.source, rootAlias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(collect(compilerSnapshotFrames(rootAlias, f.digest)), /link|alias/i);
});

test('same-content source replacement after the first chunk cannot finalize a snapshot', async t => {
  const f = await fixture(t); let replaced = false, ended = false;
  await assert.rejects(async () => {
    for await (const raw of compilerSnapshotFrames(f.source, f.digest)) {
      const value = JSON.parse(raw);
      if (!replaced && value.type === 'chunk') {
        const editor = join(f.source, '.compiler/MetaEditor64.exe');
        await fs.rename(editor, join(f.root, 'original-editor'));
        await fs.writeFile(editor, f.files.get('.compiler/MetaEditor64.exe'));
        replaced = true;
      }
      if (value.type === 'end') ended = true;
    }
  }, /chang|identity/i);
  assert.equal(replaced, true); assert.equal(ended, false);
});

test('source directory links and manifest hardlinks are rejected before their data is streamed', async t => {
  const f = await fixture(t);
  const include = join(f.source, 'Include'), moved = join(f.root, 'original-include');
  await fs.rename(include, moved);
  await fs.symlink(moved, include, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(collect(compilerSnapshotFrames(f.source, f.digest)), /link|alias/i);
  await fs.unlink(include); await fs.rename(moved, include);
  await fs.link(join(f.source, 'manifest.json'), join(f.root, 'manifest-alias'));
  await assert.rejects(collect(compilerSnapshotFrames(f.source, f.digest)), /link|ordinary/i);
});

test('unknown digest algorithms, unsafe manifests and original bounds fail without a commit', async t => {
  const f = await fixture(t), original = structuredClone(f.manifest);
  for (const value of [f.digest.slice(7), `sha512:${'0'.repeat(64)}`, `sha256:${'A'.repeat(64)}`]) {
    await assert.rejects(collect(compilerSnapshotFrames(f.source, value)), /SHA256/i);
  }
  for (const mutation of ['file-limit', 'total-limit', 'count-limit', 'traversal', 'case', 'unicode', 'algorithm', 'compiler-missing']) {
    f.manifest.files = structuredClone(original.files);
    const editor = f.manifest.files['.compiler/MetaEditor64.exe'];
    if (mutation === 'file-limit') editor.bytes = 256 * 1024 * 1024 + 1;
    if (mutation === 'total-limit') { editor.bytes = 256 * 1024 * 1024; f.manifest.files.extra = { bytes: 256 * 1024 * 1024, sha256: hash('') }; }
    if (mutation === 'count-limit') for (let i = 0; i < 10000; i++) f.manifest.files[`item${i}`] = { bytes: 0, sha256: hash('') };
    if (mutation === 'traversal') f.manifest.files['../escape'] = { bytes: 0, sha256: hash('') };
    if (mutation === 'case') f.manifest.files['include/extra'] = { bytes: 0, sha256: hash('') };
    if (mutation === 'unicode') {
      f.manifest.files['Straße/one'] = { bytes: 0, sha256: hash('') };
      f.manifest.files['STRASSE/two'] = { bytes: 0, sha256: hash('') };
    }
    if (mutation === 'algorithm') editor.sha256 = `md5:${'0'.repeat(32)}`;
    if (mutation === 'compiler-missing') delete f.manifest.files['.compiler/MetaEditor64.exe'];
    const digest = await f.save();
    await assert.rejects(collect(compilerSnapshotFrames(f.source, digest)), error => error.code?.startsWith('compiler_snapshot_'), mutation);
  }
});

test('canceled host streaming closes the substream and guest removes all partial files', async t => {
  const f = await fixture(t), controller = new AbortController();
  async function* canceled() {
    for await (const raw of compilerSnapshotFrames(f.source, f.digest, { signal: controller.signal })) {
      yield raw;
      if (JSON.parse(raw).type === 'chunk') controller.abort(new Error('controlled cancellation'));
    }
  }
  const result = await receive(canceled(), f.parent, f.digest);
  assert.equal(result.code, 1); assert.equal(result.result, null);
  assert.match(result.streamError.message, /controlled cancellation/);
  assert.deepEqual(await fs.readdir(f.parent), []);
});

test('a multi-record manifest is transmitted without rewriting its original production bytes', async t => {
  const f = await fixture(t); f.manifest.note = 'bounded metadata '.repeat(75_000); f.digest = await f.save();
  let manifestChunks = 0;
  async function* frames() {
    for await (const raw of compilerSnapshotFrames(f.source, f.digest)) {
      assert.ok(raw.length <= 1024 * 1024);
      if (JSON.parse(raw).type === 'manifest_chunk') manifestChunks++;
      yield raw;
    }
  }
  const result = await receive(frames(), f.parent, f.digest);
  assert.equal(result.code, 0, result.stderr); assert.ok(manifestChunks > 1);
  assert.deepEqual(await fs.readFile(join(result.result.directory, 'manifest.json')), await fs.readFile(join(f.source, 'manifest.json')));
});

test('changing the frozen manifest during transmission prevents the final end record', async t => {
  const f = await fixture(t); let changed = false;
  await assert.rejects(async () => {
    for await (const raw of compilerSnapshotFrames(f.source, f.digest)) {
      const value = JSON.parse(raw);
      if (!changed && value.type === 'chunk') {
        await fs.writeFile(join(f.source, 'manifest.json'), '{}'); changed = true;
      }
      assert.notEqual(value.type, 'end');
    }
  }, /changed/i);
  assert.equal(changed, true);
});

test('path byte/depth and aggregate node boundaries are checked before file streaming', async t => {
  const f = await fixture(t), compiler = structuredClone(f.manifest.files['.compiler/MetaEditor64.exe']);
  const empty = { bytes: 0, sha256: hash('') };
  async function preflight(names, accepted) {
    f.manifest.files = { '.compiler/MetaEditor64.exe': compiler, ...Object.fromEntries(names.map(name => [name, empty])) };
    const source = compilerSnapshotFrames(f.source, await f.save());
    try {
      if (accepted) assert.equal(JSON.parse((await source.next()).value).type, 'begin');
      else await assert.rejects(source.next(), { code: 'compiler_snapshot_limit' });
    } finally { await source.return(); }
  }
  const path1024 = [...Array(5).fill('d'.repeat(200)), 'f'.repeat(19)].join('/');
  assert.equal(Buffer.byteLength(path1024), 1024);
  await preflight([path1024], true); await preflight([`${path1024}x`], false);
  await preflight(['界'.repeat(342)], false);
  await preflight([Array(64).fill('d').join('/')], true);
  await preflight([Array(65).fill('d').join('/')], false);
  const nodes40000 = Array.from({ length: 9999 }, (_, i) => `${i}/a/b/${i === 0 ? 'c/' : ''}file`);
  await preflight(nodes40000, true);
  nodes40000[1] = '1/a/b/c/file'; await preflight(nodes40000, false);
});

test('an editor-sized 115827176-byte file is streamed in fixed chunks and verified on disk', { timeout: 30_000 }, async t => {
  const f = await fixture(t), size = 115_827_176, block = Buffer.alloc(256 * 1024), checksum = createHash('sha256');
  const editor = join(f.source, '.compiler/MetaEditor64.exe');
  const source = await fs.open(editor, 'w');
  try { await source.truncate(size); } finally { await source.close(); }
  for (let offset = 0; offset < size; offset += block.length) checksum.update(block.subarray(0, Math.min(block.length, size - offset)));
  const expected = `sha256:${checksum.digest('hex')}`;
  f.manifest.compiler_sha256 = expected; f.manifest.files['.compiler/MetaEditor64.exe'] = { bytes: size, sha256: expected };
  f.digest = await f.save(); let chunks = 0;
  async function* frames() {
    for await (const raw of compilerSnapshotFrames(f.source, f.digest)) {
      assert.ok(raw.length <= 1024 * 1024);
      const value = JSON.parse(raw);
      if (value.type === 'chunk') { chunks++; assert.ok(Buffer.from(value.data, 'base64').length <= block.length); }
      yield raw;
    }
  }
  const result = await receive(frames(), f.parent, f.digest);
  assert.equal(result.code, 0, result.stderr); assert.ok(chunks > 400);
  const target = await fs.open(join(result.result.directory, '.compiler/MetaEditor64.exe'), 'r');
  const received = createHash('sha256'); let count = 0;
  try {
    for (;;) { const { bytesRead } = await target.read(block); if (!bytesRead) break; count += bytesRead; received.update(block.subarray(0, bytesRead)); }
  } finally { await target.close(); }
  assert.equal(count, size); assert.equal(`sha256:${received.digest('hex')}`, expected);
});
