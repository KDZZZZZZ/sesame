import { promises as fs, constants } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { digest, canonical } from '@sesame/plugin-sdk/protocol';
import { MAX_TRANSLATION_MANIFEST_BYTES, normalizeTranslation, translationFileSchema } from './translation-input.js';
import { registerTranslation } from './target.js';
import { requireValue } from './support.js';

function requestedPath(value) {
  requireValue(!value.includes('\0') && !value.split(/[\\/]/).includes('..') && (sep === '\\' || !value.includes('\\')), '清单路径不能包含空字符、上级目录或非本机路径分隔符');
  requireValue(isAbsolute(value) || !value.includes(':'), '清单必须是当前工作区内的文件');
  return normalize(value);
}
const inside = path => path && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameFile = (a, b) => sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

// The workspace is not an OS sandbox. This one intake operation deliberately
// accepts only a declared regular file beneath its current root. O_NOFOLLOW,
// nonblocking open and identity checks cover final-file replacement; ancestor
// identities and real paths are checked again before accepting any read bytes.
export async function readTranslationManifest(host, requested, signal) {
  signal?.throwIfAborted();
  const logicalRoot = resolve(host.workspace.path('.')), declaredRoot = await fs.lstat(logicalRoot, { bigint: true });
  requireValue(declaredRoot.isDirectory() && !declaredRoot.isSymbolicLink(), '工作区根目录不能是符号链接或非目录');
  const root = await fs.realpath(logicalRoot);
  requireValue(sameIdentity(declaredRoot, await fs.lstat(root, { bigint: true })), '工作区根目录在解析时发生变化');
  const candidate = resolve(logicalRoot, requested);
  let child = relative(logicalRoot, candidate);
  if (!inside(child) && isAbsolute(requested)) child = relative(root, requested);
  requireValue(inside(child), '翻译清单必须位于当前工作区内，不能读取工作区本身或外部路径');
  const parts = child.split(sep), ancestors = [];
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const stat = await fs.lstat(current, { bigint: true });
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), '清单路径不能经过符号链接或非目录');
    ancestors.push({ path: current, stat }); current = join(current, part);
  }
  const parent = await fs.lstat(current, { bigint: true });
  requireValue(parent.isDirectory() && !parent.isSymbolicLink(), '清单路径不能经过符号链接或非目录');
  ancestors.push({ path: current, stat: parent });
  const path = join(current, parts.at(-1)), declared = await fs.lstat(path, { bigint: true });
  requireValue(declared.isFile() && !declared.isSymbolicLink(), '翻译清单必须是普通文件，不能是符号链接或特殊文件');
  requireValue(declared.size <= BigInt(MAX_TRANSLATION_MANIFEST_BYTES), '翻译清单超过 8 MiB 上限');
  requireValue(await fs.realpath(path) === path, '清单路径不能经过符号链接');
  for (const ancestor of ancestors) {
    const currentStat = await fs.lstat(ancestor.path, { bigint: true });
    requireValue(currentStat.isDirectory() && !currentStat.isSymbolicLink() && sameIdentity(ancestor.stat, currentStat), '清单父目录在打开前发生变化');
  }
  let handle;
  try {
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true });
    requireValue(before.isFile() && sameFile(before, declared), '清单在打开前发生变化，请使用新的操作 ID 重试');
    const chunks = []; let size = 0;
    while (true) {
      signal?.throwIfAborted();
      const buffer = Buffer.alloc(Math.min(65536, MAX_TRANSLATION_MANIFEST_BYTES + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead; requireValue(size <= MAX_TRANSLATION_MANIFEST_BYTES, '翻译清单超过 8 MiB 上限');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    requireValue(sameFile(before, await handle.stat({ bigint: true })) && before.size === BigInt(size), '清单读取期间发生变化，未登记任何翻译');
    requireValue(await fs.realpath(path) === path && sameFile(before, await fs.lstat(path, { bigint: true })), '清单路径读取期间发生变化，未接受读取内容');
    const rootAfter = await fs.lstat(logicalRoot, { bigint: true });
    requireValue(rootAfter.isDirectory() && !rootAfter.isSymbolicLink() && sameIdentity(declaredRoot, rootAfter) && await fs.realpath(logicalRoot) === root, '工作区根目录读取期间发生变化，未接受读取内容');
    for (const ancestor of ancestors) {
      const after = await fs.lstat(ancestor.path, { bigint: true });
      requireValue(after.isDirectory() && !after.isSymbolicLink() && sameIdentity(ancestor.stat, after), '清单父目录读取期间发生变化，未接受读取内容');
    }
    signal?.throwIfAborted();
    const bytes = Buffer.concat(chunks, size);
    let parsed;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { requireValue(false, '翻译清单必须是有效 UTF-8 JSON'); }
    return { manifest: normalizeTranslation(parsed, false), source: { path: requested, sha256: digest(bytes), bytes: size } };
  } finally { await handle?.close(); }
}

function checkedSnapshot(row, requestDigest) {
  requireValue(row.request_digest === requestDigest, '操作 ID 已固定另一清单路径；修改翻译请使用新的操作 ID', 409, 'idempotency_conflict');
  const manifest = normalizeTranslation(row.manifest, false);
  requireValue(digest(manifest) === row.manifest_digest, '已固定的翻译输入快照校验失败', 409, 'translation_snapshot_corrupt');
  return { ...row, manifest };
}

export async function registerTranslationFile(host, mt5, args, signal) {
  requireValue(Value.Check(translationFileSchema, args), '需要 operation_id 与 manifest_path，不能附加内联翻译字段');
  const path = requestedPath(args.manifest_path), operation = digest(args.operation_id).slice(7), requestDigest = digest({ manifest_path: path });
  let row = host.storage.get('mt5_translation_manifest', operation, true), reused = Boolean(row);
  if (row) row = checkedSnapshot(row, requestDigest);
  else {
    const input = await readTranslationManifest(host, path, signal), manifestDigest = digest(input.manifest);
    row = host.storage.transaction(() => {
      const prior = host.storage.get('mt5_translation_manifest', operation, true);
      if (prior) {
        reused = true;
        const checked = checkedSnapshot(prior, requestDigest);
        requireValue(checked.manifest_digest === manifestDigest, '并发请求读取了不同的清单内容；操作 ID 已固定首次快照', 409, 'idempotency_conflict');
        return checked;
      }
      return host.storage.put('mt5_translation_manifest', { id: operation, request_digest: requestDigest, manifest_digest: manifestDigest, manifest_bytes: Buffer.byteLength(canonical(input.manifest)), ...input });
    });
  }
  signal?.throwIfAborted();
  const result = await registerTranslation(host, mt5, { operation_id: args.operation_id, ...row.manifest });
  return { ...result, manifest: { digest: row.manifest_digest, bytes: row.manifest_bytes, source: row.source, reused, storage: 'immutable-plugin-snapshot' } };
}
