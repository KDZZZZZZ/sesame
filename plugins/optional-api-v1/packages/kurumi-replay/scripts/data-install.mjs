import { isDeepStrictEqual } from 'node:util';
// Explicit preparation only. A small bounded, integrity-checked npm tarball
// installer, not npm/npx: no lifecycle scripts, global writes, HOME cache or bins.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Budget, abort, fail, hash, fetchBounded, readBounded, safePath, scan, relative } from './data-core.mjs';
const MAX_PACKAGE = 16 * 1024 * 1024;
function str(b) { return b.toString('utf8').replace(/\0.*$/s, ''); }
// Pinned npm packages use ordinary tar/ustar; reject links and extensions instead
// of invoking tar on an untrusted path or accepting path override semantics.
export function unpackTar(gzip) {
  const tar = gunzipSync(gzip, { maxOutputLength: MAX_PACKAGE });
  const files = []; const seen = new Set(); let offset = 0;
  while (offset + 512 <= tar.length) {
    const h = tar.subarray(offset, offset + 512); offset += 512;
    if (h.every(x => x === 0)) break;
    const sum = h.reduce((s, x, i) => s + (i >= 148 && i < 156 ? 32 : x), 0);
    if (sum !== parseInt(str(h.subarray(148, 156)).trim(), 8)) fail('INVALID_ARCHIVE', 'tar 校验和不匹配。');
    const name = str(h.subarray(0, 100)), prefix = str(h.subarray(345, 500));
    const full = prefix ? `${prefix}/${name}` : name;
    const type = h[156]; const rawSize = str(h.subarray(124, 136)).trim();
    if (!/^[0-7]+$/.test(rawSize)) fail('INVALID_ARCHIVE', '非法 tar 长度。');
    const size = parseInt(rawSize, 8);
    if (!Number.isSafeInteger(size) || offset + size > tar.length) fail('INVALID_ARCHIVE', '截断的 tar 内容。');
    if (full === 'package' && type === 53 && size === 0) continue;
    if (!full.startsWith('package/')) fail('UNSAFE_PATH', 'npm tar 必须在 package/ 下。');
    const rel = full.slice(8).replace(/\/$/, '');
    if (rel) relative(rel);
    if (type === 0 || type === 48) {
      if (!rel || seen.has(rel)) fail('INVALID_ARCHIVE', '空或重复的归档路径。');
      seen.add(rel); files.push({ path: rel, bytes: tar.subarray(offset, offset + size) });
      if (files.length > 10000) fail('CACHE_LIMIT', '归档文件数超预算。');
    } else if (type !== 53 || size !== 0) fail('UNSAFE_PATH', '拒绝 tar 链接、设备和路径扩展。');
    offset += Math.ceil(size / 512) * 512;
  }
  if (!files.length) fail('INVALID_ARCHIVE', '空 npm 包。');
  return files;
}
export async function verifyDependencies(root, cfg) {
  const bytes = await readBounded(root, 'deps/receipt.json');
  const r = JSON.parse(bytes);
  if (r.schemaVersion !== 1 || r.pinDigest !== hash(JSON.stringify(cfg.toolchain.packages)) || !Array.isArray(r.files)) fail('DEPENDENCY_MISMATCH', '依赖版本/固定列表不匹配。');
  const inventory = await scan(await safePath(root, 'deps'));
  const actual = inventory.files.filter(f => f.path !== 'receipt.json').map(f => f.path).sort();
  const recorded = r.files.map(f => f.path).sort();
  if (!isDeepStrictEqual(actual,recorded)) fail('DEPENDENCY_MISMATCH', '依赖文件清单变化；不会执行。');
  for (const f of r.files) {
    const b = await readBounded(root, `deps/${f.path}`);
    if (b.length !== f.bytes || hash(b) !== f.digest) fail('HASH_MISMATCH', '依赖文件 hash 不匹配；不会执行。', { path: f.path });
  }
  return { digest: hash(bytes), packages: r.packages, installedAt: r.installedAt };
}
export async function installDependencies(root, stage, cfg, signal) {
  abort(signal);
  try { return await verifyDependencies(root, cfg); }
  catch (e) {
    // Never silently replace a present but corrupted or different toolchain.
    if (e.code !== 'ENOENT') throw e;
    try { await fs.lstat(await safePath(root, 'deps')); fail('DEPENDENCY_MISMATCH', '已有未完成的依赖目录；请显式 clearData 后重试。'); }
    catch (x) { if (x.code !== 'ENOENT') throw x; }
  }
  const budget = await Budget.create(root); const files = [], packages = [];
  for (const pin of cfg.toolchain.packages) {
    abort(signal);
    if (!/^https:\/\/registry\.npmjs\.org\//.test(pin.url) || !/^sha512-/.test(pin.integrity)) fail('DEPENDENCY_MISMATCH', '只接受固定 npm registry sha512 包。');
    relative(pin.path);
    const cache = `dependency-cache/${pin.path}/${pin.version}.tgz`;
    let response, cachedBytes;
    try {
      const bytes = await readBounded(root, cache, 4 * 1024 * 1024); cachedBytes = bytes;
      const meta = JSON.parse(await readBounded(root, `${cache}.json`));
      if (meta.url !== pin.url || meta.integrity !== pin.integrity || hash(bytes) !== meta.digest) fail('HASH_MISMATCH', '私有 npm tarball cache 不匹配。');
      response = { bytes, observedAt: meta.observedAt, cacheHit: true, cacheImport: meta.cacheImport || null };
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (cachedBytes) {
        if ('sha512-' + createHash('sha512').update(cachedBytes).digest('base64') !== pin.integrity) fail('HASH_MISMATCH', '无收据的 npm 文件也不符合固定完整性摘要。');
        response = { bytes: cachedBytes, observedAt: null, cacheHit: true, cacheImport: 'Recovered fixed-integrity tarball; original network observedAt unavailable' };
      } else {
        const retryFile = `${cache}.retry.json`;
        try {
          const c = JSON.parse(await readBounded(root, retryFile));
          if (c.url !== pin.url || !Number.isFinite(Date.parse(c.retryAt))) fail('SOURCE_MISMATCH', 'npm Retry-After 收据不匹配。');
          if (Date.parse(c.retryAt) > Date.now()) fail('NETWORK_PAUSED', 'npm Retry-After 尚未到期，没有提前重试。', { url: pin.url, retryAt: c.retryAt, attempts: 0 });
          const f = await safePath(root, retryFile); const st = await fs.stat(f); await fs.unlink(f); budget.bytes -= st.size;
        } catch (x) { if (x.code !== 'ENOENT') throw x; }
        try { response = await fetchBounded(pin.url, 4 * 1024 * 1024, signal); }
        catch (x) {
          if (x.code === 'NETWORK_PAUSED' && x.details?.retryAt) await budget.json(retryFile, { url: pin.url, retryAt: x.details.retryAt });
          throw x;
        }
        if ('sha512-' + createHash('sha512').update(response.bytes).digest('base64') !== pin.integrity) fail('HASH_MISMATCH', 'npm 下载 integrity 不匹配。');
        await budget.write(cache, response.bytes);
      }
      await budget.json(`${cache}.json`, { url: pin.url, integrity: pin.integrity, digest: hash(response.bytes), observedAt: response.observedAt, cacheImport: response.cacheImport || null });
    }
    const integrity = 'sha512-' + createHash('sha512').update(response.bytes).digest('base64');
    if (integrity !== pin.integrity) fail('HASH_MISMATCH', 'npm 包 integrity 不匹配。', { name: pin.name, version: pin.version });
    const entries = unpackTar(response.bytes);
    const manifest = JSON.parse(entries.find(e => e.path === 'package.json')?.bytes.toString() || '{}');
    if (manifest.name !== pin.name || manifest.version !== pin.version) fail('DEPENDENCY_MISMATCH', 'npm 包名或版本不匹配。');
    const size = entries.reduce((s, e) => s + e.bytes.length, 0);
    if (pin.unpackedSize != null && size !== pin.unpackedSize) fail('DEPENDENCY_MISMATCH', 'npm 声明的解包长度不匹配。', { name: pin.name, size, expected: pin.unpackedSize });
    for (const entry of entries) {
      abort(signal);
      const local = `node_modules/${pin.path}/${entry.path}`;
      const f = await budget.write(`${stage}/deps/${local}`, entry.bytes);
      files.push({ ...f, path: local });
    }
    packages.push({ name: pin.name, path: pin.path, version: pin.version, declaredLicense: pin.license,
      licenseFiles: entries.filter(e => /(^|\/)(licen[sc]e|copying|notice)(\.|$)/i.test(e.path)).map(e => e.path),
      url: pin.url, integrity, tarballDigest: hash(response.bytes), observedAt: response.observedAt, cacheHit: response.cacheHit || false, cacheImport: response.cacheImport || null, unpackedBytes: size });
  }
  await budget.json(`${stage}/deps/receipt.json`, { schemaVersion: 1, installedAt: new Date().toISOString(), pinDigest: hash(JSON.stringify(cfg.toolchain.packages)), packages, files });
  await fs.rename(await safePath(root, `${stage}/deps`), await safePath(root, 'deps'));
  return verifyDependencies(root, cfg);
}
