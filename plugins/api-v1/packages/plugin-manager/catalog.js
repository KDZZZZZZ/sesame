import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const CATALOG_URL = 'https://raw.githubusercontent.com/KDZZZZZZ/sesame/main/plugins/optional-api-v1/catalog.json';
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const check = (value, message, code = 'CATALOG_INVALID') => { if (!value) throw Object.assign(new Error(message), { code }); };
const safe = path => typeof path === 'string' && path.length > 0 && path.length <= 512 && !/[\\:\x00-\x1f\x7f]/.test(path) && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
const normalize = value => String(value).startsWith('sha256:') ? value : `sha256:${value}`;
export const treeDigest = files => hash(JSON.stringify([...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file => [file.path, normalize(file.sha256)])));

async function bytes(fetcher, url, limit, signal) {
  const response = await fetcher(url, { signal, redirect: 'error' });
  check(response.ok, `Catalog download failed: HTTP ${response.status}`, 'CATALOG_DOWNLOAD');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { signal?.throwIfAborted(); length += chunk.length; check(length <= limit, 'Catalog download exceeded its byte budget'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
export async function readCatalog(signal, fetcher = globalThis.fetch) {
  const deadline = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  const raw = await bytes(fetcher, CATALOG_URL, 4 * 1024 * 1024, deadline);
  const catalog = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  check(catalog.schemaVersion === 1 && catalog.apiVersion === '1' && catalog.channel === 'development' && Array.isArray(catalog.plugins) && catalog.plugins.length <= 100, 'Expected the Plugin API 1 development catalog');
  const ids = new Set();
  for (const entry of catalog.plugins) {
    check(/^sesame\/[a-z][a-z0-9-]*$/.test(entry.id) && !ids.has(entry.id), 'Catalog identity must be unique'); ids.add(entry.id);
    check(/^\d+\.\d+\.\d+$/.test(entry.version) && ['active','withdrawn'].includes(entry.status) && entry.apiVersion === '1', 'Invalid catalog version or status');
    const slug = entry.id.split('/')[1];
    check(entry.source?.repository === 'https://github.com/KDZZZZZZ/sesame' && /^[a-f0-9]{40}$/.test(entry.source.commit) && entry.source.path === `plugins/optional-api-v1/packages/${slug}`, 'Source must pin an official package commit');
    check(entry.review?.automated === 'package-static-review' && ['not-recorded','approved'].includes(entry.review.human), 'Catalog must distinguish static checks and human review');
    const files = entry.package?.files;
    check(Array.isArray(files) && files.length > 0 && files.length <= 1024, 'Missing package file index');
    const paths = new Set(); let total = 0;
    for (const file of files) {
      check(safe(file.path) && /^[a-f0-9]{64}$/.test(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 2 * 1024 * 1024, 'Invalid package file');
      const folded = file.path.normalize('NFD').toLowerCase(); check(!paths.has(folded), 'Package paths collide'); paths.add(folded); total += file.bytes;
    }
    check(total <= 16 * 1024 * 1024 && paths.has('plugin.json') && paths.has('license'), 'Package bytes or required identity/license files are invalid');
    check(normalize(entry.package.treeDigest) === treeDigest(files), 'Catalog tree digest does not match its file index');
  }
  return { catalog, digest: hash(raw) };
}
export async function catalogQuery(args, signal, fetcher) {
  const { catalog, digest } = await readCatalog(signal, fetcher), query = (args.query ?? '').toLowerCase();
  const items = catalog.plugins.filter(entry => entry.status === 'active' && (!args.plugin_id || entry.id === args.plugin_id) && `${entry.id} ${entry.title} ${entry.description}`.toLowerCase().includes(query));
  return { catalog_url: CATALOG_URL, catalog_digest: digest, apiVersion: '1', channel: 'development', items: items.map(({ package: pkg, ...entry }) => ({ ...entry, package: { treeDigest: normalize(pkg.treeDigest), files: pkg.files.length, bytes: pkg.files.reduce((sum, file) => sum + file.bytes, 0) } })), next: 'Use the exact plugin_id and catalog_digest with plugin_install_catalog. This catalog requires a compatible API 1 host; the stable 0.1.4 website catalog is separate.' };
}
export async function installCatalog(host, args, signal, fetcher = globalThis.fetch) {
  check(host.scope.kind === 'main', 'Catalog installation requires the main Agent', 'FORBIDDEN');
  const result = await host.storage.idempotentAsync(`catalog:${args.command_id}`, hash(JSON.stringify(args)), async () => {
    const { catalog, digest } = await readCatalog(signal, fetcher);
    check(digest === args.catalog_digest, 'Catalog changed; inspect the current entry again', 'CATALOG_CHANGED');
    const entry = catalog.plugins.find(entry => entry.id === args.plugin_id);
    check(entry?.status === 'active', 'Exact plugin is absent or withdrawn', 'CATALOG_UNAVAILABLE');
    const present = host.plugins.discover(entry.id).items.find(item => item.id === entry.id);
    if (present) { check(present.digest === normalize(entry.package.treeDigest) && present.version === entry.version, 'A different version is installed; inspect it and use explicit update or rollback', 'CATALOG_VERSION_CONFLICT'); return { installed: present, reused: true, catalog_digest: digest }; }
    const parent = host.workspace.path('plugin-drafts'); await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(join(parent, 'catalog-'));
    const deadline = AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]);
    for (const file of entry.package.files) {
      const url = `https://raw.githubusercontent.com/KDZZZZZZ/sesame/${entry.source.commit}/${entry.source.path}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
      const content = await bytes(fetcher, url, file.bytes, deadline);
      check(content.length === file.bytes && hash(content) === normalize(file.sha256), `Downloaded file differs: ${file.path}`, 'PACKAGE_INTEGRITY');
      const path = join(directory, file.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, { flag: 'wx' });
    }
    const tested = await host.plugins.manage('test', { path: directory }, signal);
    check(tested.passed && tested.id === entry.id && tested.version === entry.version && tested.digest === normalize(entry.package.treeDigest), 'Package identity, tests or actual bytes differ from the catalog', 'PACKAGE_TEST_FAILED');
    const installed = await host.plugins.manage('install', { path: directory, digest: tested.digest, command_id: `catalog-${hash(args.command_id).slice(7)}` }, signal);
    return { installed, reused: false, catalog_digest: digest, test_results: tested.results, draft_path: directory };
  });
  if (result.installed.runtime_status !== 'ready') return { ...result, loaded: false, next: 'Inspect runtime_status and diagnostics; static native checks are not a behavior or environment guarantee.' };
  const loaded = await host.plugins.load(args.plugin_id);
  return { ...result, loaded: true, plugin: loaded, next: 'The current session tools were refreshed. Read the plugin skill, inspect existing dependencies/configuration and reuse them; preparation is a separate explicit operation.' };
}
