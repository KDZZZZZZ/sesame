import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const COMPILER_SNAPSHOT_LIMITS = Object.freeze({
  manifestBytes: 8 * 1024 * 1024, fileCount: 10_000,
  fileBytes: 256 * 1024 * 1024, totalBytes: 512 * 1024 * 1024,
  chunkBytes: 256 * 1024, recordBytes: 1024 * 1024,
  pathBytes: 1024, depth: 64, nodeCount: 40_000,
});
const sha = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const folded = value => value.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFC');
const device = /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const sameStat = (a, b) => ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const samePath = (a, b) => a.normalize('NFC') === b.normalize('NFC');

export class CompilerSnapshotError extends Error {
  constructor(code, message) { super(message); this.name = 'CompilerSnapshotError'; this.code = `compiler_snapshot_${code}`; }
}
function check(condition, code, message) { if (!condition) throw new CompilerSnapshotError(code, message); }
function paths(manifest) {
  check(manifest && typeof manifest === 'object' && !Array.isArray(manifest) && sha(manifest.compiler_sha256)
    && manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files), 'manifest', 'Invalid compiler manifest');
  const entries = Object.entries(manifest.files).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  check(entries.length > 0 && entries.length <= COMPILER_SNAPSHOT_LIMITS.fileCount, 'limit', 'Compiler file count exceeds its bound');
  const seen = new Map([[folded('manifest.json'), { name: 'manifest.json', directory: false }]]);
  let total = 0;
  for (const [name, item] of entries) {
    check(name && name.isWellFormed() && !/[\\:<>"|?*\p{Cc}\p{Cf}]/u.test(name), 'path', 'Unsafe compiler path');
    check(Buffer.byteLength(name) <= COMPILER_SNAPSHOT_LIMITS.pathBytes, 'limit', 'Compiler path exceeds 1024 UTF8 bytes');
    const parts = name.split('/');
    check(parts.length <= COMPILER_SNAPSHOT_LIMITS.depth, 'limit', 'Compiler path exceeds 64 components');
    check(parts.every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)
      && !device.test(part.split('.')[0].trimEnd())), 'path', 'Unsafe compiler path');
    for (let index = 1; index <= parts.length; index++) {
      const current = parts.slice(0, index).join('/'), key = folded(current), directory = index < parts.length;
      const prior = seen.get(key);
      check(!prior || prior.name === current && prior.directory && directory, 'path', 'Aliased compiler paths');
      check(prior || seen.size < COMPILER_SNAPSHOT_LIMITS.nodeCount, 'limit', 'Compiler snapshot exceeds 40000 file/directory nodes');
      seen.set(key, { name: current, directory });
    }
    check(item && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= COMPILER_SNAPSHOT_LIMITS.fileBytes
      && sha(item.sha256), 'limit', 'Invalid compiler file size or digest');
    total += item.bytes;
    check(total <= COMPILER_SNAPSHOT_LIMITS.totalBytes, 'limit', 'Compiler snapshot exceeds 512 MiB');
  }
  check(Object.hasOwn(manifest.files, '.compiler/MetaEditor64.exe')
    && manifest.files['.compiler/MetaEditor64.exe'].sha256 === manifest.compiler_sha256, 'manifest', 'Compiler identity is missing or inconsistent');
  return entries;
}
function frame(value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  check(bytes.length <= COMPILER_SNAPSHOT_LIMITS.recordBytes, 'limit', 'Compiler record exceeds 1 MiB');
  return bytes;
}

async function openSource(root, name, maximum, expected, signal) {
  signal?.throwIfAborted();
  const parents = [], parts = name.split('/');
  let parent = root;
  for (let index = 0; index < parts.length; index++) {
    const stat = await fs.lstat(parent, { bigint: true });
    check(stat.isDirectory() && !stat.isSymbolicLink() && samePath(await fs.realpath(parent), parent),
      'path', 'Compiler source contains a directory link or alias');
    parents.push({ path: parent, stat });
    parent = join(parent, parts[index]);
  }
  const path = join(root, name), before = await fs.lstat(path, { bigint: true });
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n,
    'path', 'Compiler inputs must be ordinary files without links');
  check(before.size <= BigInt(maximum) && (!expected || before.size === BigInt(expected.bytes)),
    'integrity', 'Compiler source has an invalid size');
  const handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    check(sameStat(before, opened), 'changed', 'Compiler source identity changed while opening');
    return { path, handle, stat: opened, parents };
  } catch (error) { await handle.close(); throw error; }
}

async function unchanged(source, signal) {
  signal?.throwIfAborted();
  check(sameStat(source.stat, await source.handle.stat({ bigint: true }))
    && sameStat(source.stat, await fs.lstat(source.path, { bigint: true }))
    && samePath(source.path, await fs.realpath(source.path)), 'changed', 'Compiler source identity changed while streaming');
  for (const parent of source.parents) {
    check(sameStat(parent.stat, await fs.lstat(parent.path, { bigint: true }))
      && samePath(parent.path, await fs.realpath(parent.path)), 'changed', 'Compiler source directory changed while streaming');
  }
  signal?.throwIfAborted();
}

async function readExactly(handle, buffer, length, position, signal) {
  let filled = 0;
  while (filled < length) {
    signal?.throwIfAborted();
    const { bytesRead } = await handle.read(buffer, filled, Math.min(COMPILER_SNAPSHOT_LIMITS.chunkBytes, length - filled), position + filled);
    check(bytesRead > 0, 'integrity', 'Compiler source ended early');
    filled += bytesRead;
  }
  signal?.throwIfAborted();
}

/** Emit a dedicated finite snapshot substream. The consumer owns transport deadlines/backpressure. */
export async function* compilerSnapshotFrames(directory, manifestSha256, { signal } = {}) {
  signal?.throwIfAborted();
  check(typeof directory === 'string' && sha(manifestSha256), 'manifest', 'Expected a frozen directory and manifest SHA256');
  const requested = resolve(directory), rootStat = await fs.lstat(requested, { bigint: true });
  check(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'path', 'Frozen root must not be a link or alias');
  const root = await fs.realpath(requested);
  check(samePath(root, requested), 'path', 'Frozen root must use its physical path without ancestor aliases');
  const manifestSource = await openSource(root, 'manifest.json', COMPILER_SNAPSHOT_LIMITS.manifestBytes, undefined, signal);
  let raw;
  try {
    check(manifestSource.stat.size > 0n, 'manifest', 'Compiler manifest is empty');
    raw = Buffer.alloc(Number(manifestSource.stat.size));
    await readExactly(manifestSource.handle, raw, raw.length, 0, signal);
    await unchanged(manifestSource, signal);
  } finally { await manifestSource.handle.close(); }
  check(hash(raw) === manifestSha256, 'integrity', 'Compiler manifest digest mismatch');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), entries = paths(manifest);
  yield frame({ type: 'begin', version: 1, manifest_bytes: raw.length, manifest_sha256: manifestSha256 });
  for (let offset = 0; offset < raw.length; offset += COMPILER_SNAPSHOT_LIMITS.chunkBytes) {
    signal?.throwIfAborted();
    yield frame({ type: 'manifest_chunk', offset, data: raw.subarray(offset, offset + COMPILER_SNAPSHOT_LIMITS.chunkBytes).toString('base64') });
  }
  yield frame({ type: 'manifest_end' });
  for (const [index, [name, item]] of entries.entries()) {
    signal?.throwIfAborted();
    const source = await openSource(root, name, COMPILER_SNAPSHOT_LIMITS.fileBytes, item, signal);
    try {
      yield frame({ type: 'file', index, path: name });
      const digest = createHash('sha256');
      const buffer = Buffer.allocUnsafe(COMPILER_SNAPSHOT_LIMITS.chunkBytes);
      let offset = 0;
      while (offset < item.bytes) {
        signal?.throwIfAborted();
        const length = Math.min(buffer.length, item.bytes - offset);
        await readExactly(source.handle, buffer, length, offset, signal);
        const bytes = buffer.subarray(0, length);
        digest.update(bytes);
        yield frame({ type: 'chunk', offset, data: bytes.toString('base64') });
        offset += length;
      }
      await unchanged(source, signal);
      check(`sha256:${digest.digest('hex')}` === item.sha256, 'integrity', 'Compiler source digest mismatch');
    } finally { await source.handle.close(); }
    yield frame({ type: 'file_end' });
  }
  signal?.throwIfAborted();
  check(sameStat(manifestSource.stat, await fs.lstat(manifestSource.path, { bigint: true }))
    && sameStat(rootStat, await fs.lstat(requested, { bigint: true })), 'changed', 'Frozen compiler manifest or root changed');
  signal?.throwIfAborted();
  yield frame({ type: 'end' });
}
