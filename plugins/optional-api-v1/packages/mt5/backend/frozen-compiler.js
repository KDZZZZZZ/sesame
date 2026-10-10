import { promises as fs } from 'node:fs';
import { join, posix } from 'node:path';
import { digest, requireValue } from './support.js';

export async function fileManifest(directory, prefix = '', result = {}) {
  for (const entry of await fs.readdir(join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await fileManifest(directory, name, result);
    else {
      if (!entry.isFile()) throw new Error('构建输入不能包含链接或特殊文件');
      const bytes = await fs.readFile(join(directory, name));
      result[name] = { bytes: bytes.length, sha256: digest(bytes) };
    }
  }
  return result;
}

export async function stageFrozenBuild(source, manifest_sha256, staging, signal) {
  const manifestBytes = await fs.readFile(join(source, 'manifest.json'));
  requireValue(manifestBytes.length <= 8 * 1024 * 1024, '构建清单过大');
  requireValue(digest(manifestBytes) === manifest_sha256, '构建清单摘要不匹配');
  const manifest = JSON.parse(manifestBytes);
  requireValue(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files), '构建清单无效');
  const realSource = await fs.realpath(source);
  let total = 0;
  const entries = Object.entries(manifest.files);
  requireValue(entries.length <= 10000, '构建文件过多');
  for (const [name, expected] of entries) {
    signal?.throwIfAborted();
    requireValue(name && !posix.isAbsolute(name) && !/[\\:\x00]/.test(name) && !name.split('/').some(part => !part || part === '.' || part === '..'), '构建清单路径无效');
    const sourceFile = join(source, name), targetFile = join(staging, name);
    const stat = await fs.lstat(sourceFile);
    requireValue(stat.isFile() && stat.size === expected.bytes && stat.size <= 256 * 1024 * 1024, '冻结构建输入无效');
    const real = await fs.realpath(sourceFile), relative = posix.relative(realSource, real);
    requireValue(relative && !relative.startsWith('../') && !posix.isAbsolute(relative), '构建输入越过目录边界');
    total += stat.size;
    requireValue(total <= 512 * 1024 * 1024, '冻结构建超过 512 MiB');
    await fs.mkdir(join(targetFile, '..'), { recursive: true });
    await fs.copyFile(sourceFile, targetFile);
    requireValue(digest(await fs.readFile(targetFile)) === expected.sha256, '冻结构建输入摘要不匹配');
  }
  requireValue(manifest.files['.compiler/MetaEditor64.exe']?.sha256 === manifest.compiler_sha256, '编译器摘要不匹配');
  await fs.writeFile(join(staging, 'manifest.json'), manifestBytes);
}
