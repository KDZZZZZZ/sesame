import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { operation } from './operations.js';

export const CATALOG_URL = 'https://dl.sesame.bot/plugins/api-v1/catalog.json';
const R2_ORIGIN = 'https://dl.sesame.bot';
const REPOSITORY = 'https://github.com/KDZZZZZZ/sesame';
const LEGACY_CATALOG_URL = 'https://raw.githubusercontent.com/KDZZZZZZ/sesame/main/plugins/api-v1/catalog.json';
const FUNCTIONAL_CATEGORY_LABELS = {
  business: 'Task workflows 业务流程', analysis: 'Knowledge and analysis 专业能力',
  search: 'Search and sources 搜索与来源', integration: 'Resource integrations 资源接入',
  presentation: 'Presentation and interaction 交互呈现', platform: 'Platform management 平台管理',
};
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const check = (value, message, code = 'CATALOG_INVALID') => { if (!value) throw Object.assign(new Error(message), { code }); };
const validPathChars = path => ![...path].some(char => char === '\\' || char === ':' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const safe = path => typeof path === 'string' && path.length > 0 && path.length <= 512 && validPathChars(path) && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
const normalize = value => String(value).startsWith('sha256:') ? value : `sha256:${value}`;
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const pathUrl = path => path.split('/').map(encodeURIComponent).join('/');
export const treeDigest = files => hash(JSON.stringify([...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(file => [file.path, normalize(file.sha256)])));
const capabilitySummaries = capabilities => capabilities.map(({ id, kind, description, consumers, execution, effects, binding }) => ({ id, kind, description, consumers, execution, effects, binding }));

async function bytes(fetcher, url, limit, signal) {
  signal?.throwIfAborted();
  const response = await fetcher(url, { signal, redirect: 'error' });
  check(response.ok, `Catalog download failed: HTTP ${response.status}`, 'CATALOG_DOWNLOAD');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { signal?.throwIfAborted(); length += chunk.length; check(length <= limit, 'Catalog download exceeded its byte budget'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}

function validateFiles(entry) {
  const files = entry.package?.files;
  check(Array.isArray(files) && files.length > 0 && files.length <= 1024, 'Missing package file index');
  const paths = new Set(); let total = 0;
  for (const file of files) {
    check(file && safe(file.path) && hex(file.sha256, 64) && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 2 * 1024 * 1024, 'Invalid package file');
    const folded = file.path.normalize('NFD').toLowerCase(); check(!paths.has(folded), 'Package paths collide'); paths.add(folded); total += file.bytes;
  }
  check(total <= 16 * 1024 * 1024 && paths.has('plugin.json') && paths.has('license'), 'Package bytes or required identity/license files are invalid');
  check(normalize(entry.package.treeDigest) === treeDigest(files), 'Catalog tree digest does not match its file index');
  return files;
}

function validateLegacyRelease(release, releases) {
  check(release && typeof release === 'object', 'Invalid release record');
  if (release.profile !== undefined) check(['core', 'optional'].includes(release.profile) && release.engines?.sesame === '>=0.2.0-0', 'Invalid profiled release compatibility');
  const optional = release.sourceRoot === 'plugins/optional-api-v1';
  check(optional || release.sourceRoot === 'plugins/api-v1', 'Unexpected release source root');
  check(new RegExp(`^plugins-${optional ? 'optional-' : ''}api-v1-dev\\.[1-9][0-9]*$`).test(release.tag) && !releases.has(release.tag) && hex(release.sourceCommit, 40) && hex(release.releaseCommit, 40), 'Release must have immutable source and publication commits');
  const base = `${REPOSITORY}/releases/download/${release.tag}`, revision = release.tag.split('-').at(-1);
  check(release.archive?.url === `${base}/sesame-${optional ? 'optional' : 'official'}-plugins-api-v1-${revision}.tar.gz` && hex(release.archive.sha256, 64) && release.lock?.url === `${base}/official-plugins.lock.json` && hex(release.lock.sha256, 64) && release.review?.url === `${base}/review.json` && hex(release.review.sha256, 64), 'Release asset URLs and digests must be fixed');
  releases.set(release.tag, { ...release, transport: 'github' });
}

function validateR2Release(release, releases) {
  check(release && typeof release === 'object', 'Invalid release record');
  check(release.transport === 'r2' && ['core', 'optional'].includes(release.profile) && release.engines === undefined, 'Invalid R2 release transport or compatibility');
  const sourceRoot = release.profile === 'core' ? 'plugins/api-v1' : 'plugins/optional-api-v1';
  const match = new RegExp(`^r2-${release.profile}-api-v1-dev\\.([1-9][0-9]*)$`).exec(release.tag);
  check(match && !releases.has(release.tag) && release.sourceRoot === sourceRoot && hex(release.sourceCommit, 40) && hex(release.releaseCommit, 40), 'R2 release must have immutable source and publication commits');
  const releaseBase = `${R2_ORIGIN}/plugins/api-v1/releases/dev.${match[1]}`;
  const packageBase = `${releaseBase}/${release.profile}`;
  check(release.archive?.url === `${packageBase}/plugins.tar.gz` && hex(release.archive.sha256, 64), 'R2 archive URL and digest must be fixed');
  check(release.lock?.url === `${packageBase}/official-plugins.lock.json` && hex(release.lock.sha256, 64), 'R2 lock URL and digest must be fixed');
  check(release.review?.url === `${releaseBase}/review.json` && hex(release.review.sha256, 64), 'R2 review URL and digest must be fixed');
  releases.set(release.tag, release);
}

function validateEntry(entry, releases, schemaVersion) {
  check(entry && typeof entry === 'object', 'Invalid catalog entry');
  check(/^sesame\/[a-z][a-z0-9-]*$/.test(entry.id), 'Catalog identity must be unique');
  check(/^\d+\.\d+\.\d+$/.test(entry.version) && ['active', 'withdrawn'].includes(entry.status) && entry.apiVersion === '2' && ['sesame-native', 'sesame-mcp'].includes(entry.format), 'Invalid catalog version, format or status');
  const slug = entry.id.split('/')[1], release = releases.get(entry.release);
  check(release && entry.source?.repository === REPOSITORY && entry.source.commit === release.sourceCommit && entry.source.path === `${release.sourceRoot}/packages/${slug}`, 'Source must pin an official package release commit');
  if (schemaVersion === 1) {
    if (release.profile) check(entry.distribution === release.profile && entry.engines?.sesame === release.engines?.sesame, 'Package compatibility differs from its released profile');
    check(entry.package?.baseUrl === undefined, 'Legacy package entries must not declare R2 package URLs');
  } else {
    check(entry.distribution === release.profile && typeof entry.engines?.sesame === 'string' && entry.engines.sesame.length > 0, 'R2 package compatibility differs from its released profile');
    check(entry.package?.baseUrl === `${R2_ORIGIN}/plugins/api-v1/packages/${normalize(entry.package.treeDigest).slice(7)}`, 'R2 package base URL must be content-addressed');
  }
  check(entry.review?.automated === 'package-static-review' && entry.review.human === 'not-recorded' && entry.review.record?.url === release.review.url && entry.review.record?.sha256 === release.review.sha256, 'Catalog must link its review record without claiming human approval');
  validateFiles(entry);
  check(entry.capabilityManifest === 'capabilities.json' && entry.package.files.some(file => file.path === entry.capabilityManifest), 'Catalog must index its pinned capability declaration');
  check(Array.isArray(entry.capabilities) && entry.capabilities.length <= 1024, 'Catalog requires explicit capability metadata');
  const ids = new Set();
  for (const capability of entry.capabilities) {
    check(capability && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(capability.id) && !ids.has(capability.id), 'Catalog capability identity must be unique');
    ids.add(capability.id);
    check(['function', 'agent', 'workflow'].includes(capability.kind) && typeof capability.description === 'string' && capability.description.length > 0, 'Catalog capability kind and description are required');
    check(Array.isArray(capability.consumers) && capability.consumers.length > 0 && capability.consumers.every(value => ['agent', 'host'].includes(value)), 'Catalog capability consumers must be explicit');
  }
  check(JSON.stringify(entry.tools) === JSON.stringify(entry.capabilities.filter(capability => capability.consumers.includes('agent')).map(capability => capability.id)), 'Catalog tools must equal the declared agent capabilities');
}

function validateCatalog(catalog) {
  check(catalog && typeof catalog === 'object' && [1, 2].includes(catalog.schemaVersion) && catalog.apiVersion === '2' && catalog.channel === 'development' && Array.isArray(catalog.plugins) && catalog.plugins.length <= 100, 'Expected the Plugin API 2 development catalog');
  check(Array.isArray(catalog.releases) && catalog.releases.length > 0 && catalog.releases.length <= 100, 'Catalog requires fixed release identities');
  const releases = new Map();
  for (const release of catalog.releases) {
    if (catalog.schemaVersion === 1) validateLegacyRelease(release, releases);
    else validateR2Release(release, releases);
  }
  const ids = new Set();
  for (const entry of catalog.plugins) {
    validateEntry(entry, releases, catalog.schemaVersion);
    check(!ids.has(entry.id), 'Catalog identity must be unique'); ids.add(entry.id);
  }
}

export async function readCatalog(signal, fetcher = globalThis.fetch) {
  const deadline = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  const raw = await bytes(fetcher, CATALOG_URL, 4 * 1024 * 1024, deadline);
  const catalog = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  validateCatalog(catalog);
  return { catalog, digest: hash(raw) };
}

export async function catalogQuery(args, signal, fetcher) {
  const { catalog, digest } = await readCatalog(signal, fetcher), query = (args.query ?? '').toLowerCase();
  const items = catalog.plugins.filter(entry => entry.status === 'active' && (!args.plugin_id || entry.id === args.plugin_id)
    && `${entry.id} ${entry.title} ${entry.description} ${entry.functionalCategory ?? ''} ${FUNCTIONAL_CATEGORY_LABELS[entry.functionalCategory] ?? ''}`.toLowerCase().includes(query));
  return { catalog_url: CATALOG_URL, legacy_catalog_url: LEGACY_CATALOG_URL, catalog_digest: digest, schemaVersion: catalog.schemaVersion, apiVersion: '2', channel: 'development', releases: catalog.releases,
    items: items.map(({ package: pkg, ...entry }) => ({ ...entry, package: { treeDigest: normalize(pkg.treeDigest), files: pkg.files.length, bytes: pkg.files.reduce((sum, file) => sum + file.bytes, 0), ...(pkg.baseUrl ? { baseUrl: pkg.baseUrl } : {}) } })),
    next: 'Use exact plugin_id and catalog_digest with plugin_install_catalog. For a newer catalog version, inspect the installed digest and explicitly choose action:update with expected_digest. Keep a newer installed version when the catalog is older; this interface does not support downgrades. The host enforces update versions and permissions. Identical bytes return already-installed; disabled plugins stay disabled. Only API 2 packages are accepted.' };
}

async function installed(host, id) {
  try { return await host.plugins.read(id, { part: 'status' }); }
  catch (error) { if (error.status === 404 || ['plugin_not_found', 'NOT_FOUND'].includes(error.code)) return null; throw error; }
}

function packageUrl(entry, file, schemaVersion) {
  if (schemaVersion === 1) return `https://raw.githubusercontent.com/KDZZZZZZ/sesame/${entry.source.commit}/${entry.source.path}/${pathUrl(file.path)}`;
  return `${entry.package.baseUrl}/${pathUrl(file.path)}`;
}

export async function installCatalog(host, args, signal, fetcher = globalThis.fetch) {
  check(host.context.kind === 'main', 'Catalog installation requires the main Agent', 'FORBIDDEN');
  const action = args.action ?? 'install';
  check(['install', 'update'].includes(action), 'Choose install or explicit update');
  check(/^sesame\/[a-z][a-z0-9-]*$/.test(args.plugin_id) && /^sha256:[a-f0-9]{64}$/.test(args.catalog_digest) && /^[A-Za-z0-9_-]{16,128}$/.test(args.command_id), 'Invalid catalog operation identity');
  check(action === 'update' ? /^sha256:[a-f0-9]{64}$/.test(args.expected_digest) : args.expected_digest === undefined, 'Explicit update requires expected_digest; install must omit it', 'CATALOG_UPDATE_REQUIRED');
  const fingerprint = hash(JSON.stringify([host.context.sessionId ?? null, args.plugin_id, args.catalog_digest, action, args.expected_digest ?? null]));
  const result = await operation(host, `catalog:${args.command_id}`, fingerprint, async () => {
    const { catalog, digest } = await readCatalog(signal, fetcher);
    check(digest === args.catalog_digest, 'Catalog changed; inspect the current entry again', 'CATALOG_CHANGED');
    const entry = catalog.plugins.find(entry => entry.id === args.plugin_id);
    check(entry?.status === 'active', 'Exact plugin is absent or withdrawn', 'CATALOG_UNAVAILABLE');
    const present = await installed(host, entry.id), expected = normalize(entry.package.treeDigest);
    if (present?.version === entry.version) {
      check(present.digest === expected, 'The same version has different bytes; refusing replacement', 'CATALOG_VERSION_CONFLICT');
      return { installed: present, status: 'already-installed', reused: true, catalog_digest: digest };
    }
    if (action === 'install') check(!present, 'A different version is installed; inspect it. Only a newer catalog version can use action:update with expected_digest; keep a newer installed version because this interface does not support downgrades', 'CATALOG_UPDATE_REQUIRED');
    else check(present && present.digest === args.expected_digest, 'Installed digest changed or the plugin is absent; inspect it again', 'CATALOG_INSTALLED_CHANGED');
    check(host.context.workspaceRoot, 'A workspace is required');
    const parent = join(host.context.workspaceRoot, 'plugin-drafts'); await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(join(parent, 'catalog-'));
    const controller = new AbortController(), deadline = AbortSignal.any([AbortSignal.timeout(120000), controller.signal, ...(signal ? [signal] : [])]);
    let cursor = 0;
    // Bounded parallel file reads keep large native packages within one request.
    // Every URL is immutable and every byte is verified before host tests run.
    const worker = async () => {
      while (cursor < entry.package.files.length) {
        const file = entry.package.files[cursor++];
        const content = await bytes(fetcher, packageUrl(entry, file, catalog.schemaVersion), file.bytes, deadline);
        check(content.length === file.bytes && hash(content) === normalize(file.sha256), `Downloaded file differs: ${file.path}`, 'PACKAGE_INTEGRITY');
        const path = join(directory, file.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, { flag: 'wx' });
      }
    };
    const downloaded = await Promise.allSettled(Array.from({ length: Math.min(4, entry.package.files.length) }, () => worker().catch(error => { controller.abort(error); throw error; })));
    const failed = downloaded.find(item => item.status === 'rejected');
    if (failed) { await rm(directory, { recursive: true, force: true }); throw failed.reason; }
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'plugin.json'), 'utf8'));
      check(manifest.id === entry.id && manifest.version === entry.version && manifest.apiVersion === '2' && manifest.capability_manifest === entry.capabilityManifest, 'Downloaded identity differs from the catalog', 'PACKAGE_INTEGRITY');
      const declaration = JSON.parse(await readFile(join(directory, entry.capabilityManifest), 'utf8'));
      check(declaration.schemaVersion === 1 && declaration.apiVersion === '2' && Array.isArray(declaration.capabilities)
        && JSON.stringify(capabilitySummaries(declaration.capabilities)) === JSON.stringify(capabilitySummaries(entry.capabilities)), 'Downloaded capability metadata differs from the catalog', 'PACKAGE_INTEGRITY');
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
    const source = { path: directory, digest: expected }, options = { operationId: `catalog-${hash(args.command_id).slice(7)}`, signal };
    const next = action === 'update'
      ? await host.plugins.update(entry.id, source, { ...options, expectedRevision: args.expected_digest })
      : await host.plugins.install(source, options);
    check(next.plugin.id === entry.id && next.plugin.version === entry.version && next.plugin.digest === expected, 'Installed identity differs from the fixed catalog', 'PACKAGE_INTEGRITY');
    return { installed: next.plugin, receipt: next.receipt, status: action === 'update' ? 'updated' : 'installed', reused: false, catalog_digest: digest, draft_path: directory };
  });
  // A replayed receipt is not authority over the current installation. Re-read
  // it before refreshing tools, including after an unknown post-commit outcome.
  const current = await installed(host, args.plugin_id);
  check(current && current.digest === result.installed.digest && current.version === result.installed.version, 'Installation changed after this operation; inspect the current plugin', 'CATALOG_INSTALLED_CHANGED');
  if (current.state === 'disabled' || ['failed', 'degraded'].includes(current.runtime_status)) return { ...result, installed: current, loaded: false, next: 'The existing disabled policy or activation diagnostic was preserved. Inspect state, runtime_status and diagnostics; catalog installation does not enable a disabled plugin.' };
  const loaded = await host.plugins.setEnabled(args.plugin_id, true, { scope: 'session' });
  return { ...result, installed: current, loaded: true, plugin: loaded, next: 'The current session tools and resources were refreshed. Read the plugin skill and reuse existing dependencies/configuration. Preparation is a separate explicit operation; static native checks do not certify behavior.' };
}
