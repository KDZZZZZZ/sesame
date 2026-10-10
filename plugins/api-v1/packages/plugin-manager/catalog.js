import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const CATALOG_URL = 'https://raw.githubusercontent.com/KDZZZZZZ/sesame/main/plugins/api-v1/catalog.json';
const REPOSITORY = 'https://github.com/KDZZZZZZ/sesame';
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const check = (value, message, code = 'CATALOG_INVALID') => { if (!value) throw Object.assign(new Error(message), { code }); };
const safe = path => typeof path === 'string' && path.length > 0 && path.length <= 512 && !/[\\:\x00-\x1f\x7f]/.test(path) && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
const normalize = value => String(value).startsWith('sha256:') ? value : `sha256:${value}`;
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
export const treeDigest = files => hash(JSON.stringify([...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file => [file.path, normalize(file.sha256)])));

async function bytes(fetcher, url, limit, signal) {
  signal?.throwIfAborted();
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
  check(catalog && typeof catalog === 'object' && catalog.schemaVersion === 1 && catalog.apiVersion === '1' && catalog.channel === 'development' && Array.isArray(catalog.plugins) && catalog.plugins.length <= 100, 'Expected the Plugin API 1 development catalog');
  check(Array.isArray(catalog.releases) && catalog.releases.length > 0 && catalog.releases.length <= 100, 'Catalog requires fixed release identities');
  const releases = new Map();
  for (const release of catalog.releases) {
    check(release && typeof release === 'object', 'Invalid release record');
    if (release.profile !== undefined) check(['core', 'optional'].includes(release.profile) && release.engines?.sesame === '>=0.2.0-0', 'Invalid profiled release compatibility');
    const optional = release.sourceRoot === 'plugins/optional-api-v1';
    check(optional || release.sourceRoot === 'plugins/api-v1', 'Unexpected release source root');
    check(new RegExp(`^plugins-${optional ? 'optional-' : ''}api-v1-dev\\.[1-9][0-9]*$`).test(release.tag) && !releases.has(release.tag) && hex(release.sourceCommit, 40) && hex(release.releaseCommit, 40), 'Release must have immutable source and publication commits');
    const base = `${REPOSITORY}/releases/download/${release.tag}`, revision = release.tag.split('-').at(-1);
    check(release.archive?.url === `${base}/sesame-${optional ? 'optional' : 'official'}-plugins-api-v1-${revision}.tar.gz` && hex(release.archive.sha256, 64) && release.lock?.url === `${base}/official-plugins.lock.json` && hex(release.lock.sha256, 64) && release.review?.url === `${base}/review.json` && hex(release.review.sha256, 64), 'Release asset URLs and digests must be fixed');
    releases.set(release.tag, release);
  }
  const ids = new Set();
  for (const entry of catalog.plugins) {
    check(entry && typeof entry === 'object', 'Invalid catalog entry');
    check(/^sesame\/[a-z][a-z0-9-]*$/.test(entry.id) && !ids.has(entry.id), 'Catalog identity must be unique'); ids.add(entry.id);
    check(/^\d+\.\d+\.\d+$/.test(entry.version) && ['active', 'withdrawn'].includes(entry.status) && entry.apiVersion === '1' && ['sesame-native', 'agent-plugins'].includes(entry.format), 'Invalid catalog version, format or status');
    const slug = entry.id.split('/')[1], release = releases.get(entry.release);
    check(release && entry.source?.repository === REPOSITORY && entry.source.commit === release.sourceCommit && entry.source.path === `${release.sourceRoot}/packages/${slug}`, 'Source must pin an official package release commit');
    if (release.profile) check(entry.distribution === release.profile && entry.engines?.sesame === release.engines.sesame, 'Package compatibility differs from its released profile');
    check(entry.review?.automated === 'package-static-review' && entry.review.human === 'not-recorded' && entry.review.record?.url === release.review.url && entry.review.record?.sha256 === release.review.sha256, 'Catalog must link its review record without claiming human approval');
    const files = entry.package?.files;
    check(Array.isArray(files) && files.length > 0 && files.length <= 1024, 'Missing package file index');
    const paths = new Set(); let total = 0;
    for (const file of files) {
      check(file && safe(file.path) && hex(file.sha256, 64) && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 2 * 1024 * 1024, 'Invalid package file');
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
  return { catalog_url: CATALOG_URL, catalog_digest: digest, apiVersion: '1', channel: 'development', releases: catalog.releases,
    items: items.map(({ package: pkg, ...entry }) => ({ ...entry, package: { treeDigest: normalize(pkg.treeDigest), files: pkg.files.length, bytes: pkg.files.reduce((sum, file) => sum + file.bytes, 0) } })),
    next: 'Use exact plugin_id and catalog_digest with plugin_install_catalog. For a newer catalog version, inspect the installed digest and explicitly choose action:update with expected_digest. Keep a newer installed version or use explicit rollback for an older version. The host enforces update versions and permissions. Identical bytes return already-installed; disabled plugins stay disabled. This API 1 development catalog is separate from stable 0.1.4.' };
}
function installed(host, id) {
  try { return host.plugins.inspect(id); }
  catch (error) { if (error.status === 404 || error.code === 'plugin_not_found') return null; throw error; }
}
export async function installCatalog(host, args, signal, fetcher = globalThis.fetch) {
  check(host.scope.kind === 'main', 'Catalog installation requires the main Agent', 'FORBIDDEN');
  const action = args.action ?? 'install';
  check(['install', 'update'].includes(action), 'Choose install or explicit update');
  check(/^sesame\/[a-z][a-z0-9-]*$/.test(args.plugin_id) && /^sha256:[a-f0-9]{64}$/.test(args.catalog_digest) && /^[A-Za-z0-9_-]{16,128}$/.test(args.command_id), 'Invalid catalog operation identity');
  check(action === 'update' ? /^sha256:[a-f0-9]{64}$/.test(args.expected_digest) : args.expected_digest === undefined, 'Explicit update requires expected_digest; install must omit it', 'CATALOG_UPDATE_REQUIRED');
  const fingerprint = hash(JSON.stringify([host.scope.conversationId ?? null, args.plugin_id, args.catalog_digest, action, args.expected_digest ?? null]));
  const result = await host.storage.idempotentAsync(`catalog:${args.command_id}`, fingerprint, async () => {
    const { catalog, digest } = await readCatalog(signal, fetcher);
    check(digest === args.catalog_digest, 'Catalog changed; inspect the current entry again', 'CATALOG_CHANGED');
    const entry = catalog.plugins.find(entry => entry.id === args.plugin_id);
    check(entry?.status === 'active', 'Exact plugin is absent or withdrawn', 'CATALOG_UNAVAILABLE');
    const present = installed(host, entry.id), expected = normalize(entry.package.treeDigest);
    if (present?.version === entry.version) {
      check(present.digest === expected, 'The same version has different bytes; refusing replacement', 'CATALOG_VERSION_CONFLICT');
      return { installed: present, status: 'already-installed', reused: true, catalog_digest: digest };
    }
    if (action === 'install') check(!present, 'A different version is installed; inspect it. Only a newer catalog version can use action:update with expected_digest; older versions require explicit rollback', 'CATALOG_UPDATE_REQUIRED');
    else check(present && present.digest === args.expected_digest, 'Installed digest changed or the plugin is absent; inspect it again', 'CATALOG_INSTALLED_CHANGED');
    const parent = host.workspace.path('plugin-drafts'); await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(join(parent, 'catalog-'));
    const controller = new AbortController(), deadline = AbortSignal.any([AbortSignal.timeout(120000), controller.signal, ...(signal ? [signal] : [])]);
    let cursor = 0;
    // Bounded parallel file reads keep large native packages within one request.
    // Every URL is immutable and every byte is verified before host tests run.
    const worker = async () => {
      while (cursor < entry.package.files.length) {
        const file = entry.package.files[cursor++];
        const url = `https://raw.githubusercontent.com/KDZZZZZZ/sesame/${entry.source.commit}/${entry.source.path}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
        const content = await bytes(fetcher, url, file.bytes, deadline);
        check(content.length === file.bytes && hash(content) === normalize(file.sha256), `Downloaded file differs: ${file.path}`, 'PACKAGE_INTEGRITY');
        const path = join(directory, file.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, { flag: 'wx' });
      }
    };
    const downloaded = await Promise.allSettled(Array.from({ length: Math.min(4, entry.package.files.length) }, () => worker().catch(error => { controller.abort(error); throw error; })));
    const failed = downloaded.find(item => item.status === 'rejected');
    if (failed) { await rm(directory, { recursive: true, force: true }); throw failed.reason; }
    const tested = await host.plugins.manage('test', { path: directory }, signal);
    check(tested.passed, `Package tests failed; no installation was attempted. ${JSON.stringify(tested.results ?? []).slice(0, 6000)}`, 'PACKAGE_TEST_FAILED');
    check(tested.id === entry.id && tested.version === entry.version && tested.format === entry.format && tested.digest === expected, 'Tested identity or actual bytes differ from the catalog', 'PACKAGE_TEST_FAILED');
    const next = await host.plugins.manage(action, { path: directory, digest: tested.digest, command_id: `catalog-${hash(args.command_id).slice(7)}`, ...(action === 'update' ? { expected_digest: args.expected_digest } : {}) }, signal);
    return { installed: next, status: action === 'update' ? 'updated' : 'installed', reused: false, catalog_digest: digest, test_results: tested.results, draft_path: directory };
  });
  // A replayed receipt is not authority over the current installation. Re-read
  // it before refreshing tools, including after an unknown post-commit outcome.
  const current = installed(host, args.plugin_id);
  check(current && current.digest === result.installed.digest && current.version === result.installed.version, 'Installation changed after this operation; inspect the current plugin', 'CATALOG_INSTALLED_CHANGED');
  if (current.state === 'disabled' || ['failed', 'degraded'].includes(current.runtime_status)) return { ...result, installed: current, loaded: false, next: 'The existing disabled policy or activation diagnostic was preserved. Inspect state, runtime_status and diagnostics; catalog installation does not enable a disabled plugin.' };
  const loaded = await host.plugins.load(args.plugin_id);
  return { ...result, installed: current, loaded: true, plugin: loaded, next: 'The current session tools and resources were refreshed. Read the plugin skill and reuse existing dependencies/configuration. Preparation is a separate explicit operation; static native checks do not certify behavior.' };
}
