import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRelease, validatePlan } from '../../../.github/scripts/release-plugins.mjs';
import { FUNCTIONAL_CATEGORIES, IMPLEMENTATION_KINDS } from './plugin-taxonomy.mjs';

const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const REPOSITORY = 'KDZZZZZZ/sesame';
const require = (value, message) => { if (!value) throw new Error(message); };
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const git = (root, args) => execFileSync('git', args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });
const jsonAt = (root, commit, path) => JSON.parse(git(root, ['show', `${commit}:${path}`]));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const functionalCategories = new Set(FUNCTIONAL_CATEGORIES.map(item => item.id));
const implementationKinds = new Set(IMPLEMENTATION_KINDS.map(item => item.id));

// Historical policy may lack either label. Only these descriptive fields may be
// projected; package identity, files, capabilities and installation pins stay fixed.
function catalogClassification(entry) {
  if (entry === undefined) return {};
  require(object(entry), 'Catalog policy entry must be an object');
  const classification = {};
  if (Object.hasOwn(entry, 'functionalCategory')) {
    require(functionalCategories.has(entry.functionalCategory), 'Catalog policy has an invalid functional category');
    classification.functionalCategory = entry.functionalCategory;
  }
  if (Object.hasOwn(entry, 'implementationKinds')) {
    require(Array.isArray(entry.implementationKinds) && entry.implementationKinds.length > 0 && entry.implementationKinds.every(kind => implementationKinds.has(kind)) && new Set(entry.implementationKinds).size === entry.implementationKinds.length, 'Catalog policy requires unique supported implementation kinds');
    classification.implementationKinds = [...entry.implementationKinds];
  }
  return classification;
}

/** Read reviewed metadata from immutable Git data, never the candidate's scripts. */
export function readCatalogPolicy(root, sourceCommit) {
  require(hex(sourceCommit, 40), 'Catalog policy requires a fixed source commit');
  const path = 'plugins/api-v1/inventory-policy.json';
  const tree = git(root, ['ls-tree', sourceCommit, '--', path]).toString('utf8').trim();
  if (!tree) return {};
  require(/^100(?:644|755) blob [a-f0-9]{40}\tplugins\/api-v1\/inventory-policy\.json$/.test(tree), 'Catalog policy must be an ordinary Git file');
  const policy = jsonAt(root, sourceCommit, path);
  require(object(policy), 'Catalog policy must be an object');
  return Object.fromEntries(Object.entries(policy).map(([name, entry]) => [name, catalogClassification(entry)]));
}

/** Project a verified package index without evaluating any plugin code. */
export function catalogPackage(pkg, manifest, declaration, release, { withdrawn = false, classification } = {}) {
  require(manifest.apiVersion === '2' && declaration?.apiVersion === '2' && declaration.schemaVersion === 1 && Array.isArray(declaration.capabilities), 'Catalog requires API 2 manifests and explicit capability declarations');
  require(manifest.id === pkg.id && manifest.version === pkg.version, 'Catalog package identity differs from its fixed manifest');
  require(manifest.capability_manifest === 'capabilities.json' && pkg.files.some(file => file.path === manifest.capability_manifest), 'Catalog capability manifest must be the indexed capabilities.json');
  require(manifest.tool_names === undefined && manifest.tool_definitions === undefined, 'API 2 capabilities have one declaration source');
  const path = `${release.sourceRoot}/packages/${pkg.directory}`, mcp = manifest.execution === 'mcp';
  return { id: pkg.id, name: pkg.directory, version: pkg.version, apiVersion: '2', format: mcp ? 'sesame-mcp' : 'sesame-native',
    engines: manifest.engines, distribution: release.sourceRoot === 'plugins/api-v1' ? 'core' : 'optional', ...catalogClassification(classification),
    title: manifest.title, description: manifest.description, license: manifest.license,
    author: manifest.author ?? { name: 'Sesame contributors', url: `https://github.com/${REPOSITORY}` }, status: withdrawn ? 'withdrawn' : 'active',
    release: release.tag, source: { repository: `https://github.com/${REPOSITORY}`, commit: release.sourceCommit, path },
    package: { treeDigest: pkg.treeDigest, files: pkg.files }, capabilityManifest: manifest.capability_manifest,
    capabilities: declaration.capabilities.map(({ id, kind, description, consumers, execution, effects, binding }) => ({ id, kind, description, consumers, execution, effects, binding })),
    tools: declaration.capabilities.filter(cap => cap.consumers.includes('agent')).map(cap => cap.id),
    review: { automated: 'package-static-review', human: 'not-recorded', record: release.review,
      notes: 'The linked publication record distinguishes static checks, maintainer-recorded Agent review and human approval. Static checks do not certify behavior, environment readiness or safety.' },
    requirements: `Plugin API 2 host. ${mcp ? 'Declared MCP servers and tests run locally as the current user; reuse an existing compatible runtime.' : 'Native checks cover the explicit capability manifest and JavaScript syntax; activation follows installation.'} Read the declared capability usage and knowledge, and verify environment prerequisites separately. The catalog downloader does not install dependencies.`,
    documentationUrl: `https://github.com/${REPOSITORY}/tree/${release.sourceCommit}/${path}`, feedbackUrl: `https://github.com/${REPOSITORY}/issues` };
}

// Candidate manifests are data. The fixed Git source is reconstructed and checked
// by the same trusted archive builder used for release publication, never imported.
export function buildCatalog(root = repository, sources = JSON.parse(readFileSync(join(root, 'plugins/api-v1/catalog.sources.json')))) {
  require(sources.schemaVersion === 1 && Array.isArray(sources.releases) && sources.releases.length === 2, 'Select one fixed official and one fixed optional release');
  require(new Set(sources.releases.map(item => item.tag)).size === sources.releases.length, 'Catalog release group is missing or repeated');
  const withdrawals = sources.withdrawn ?? [];
  require(Array.isArray(withdrawals) && withdrawals.every(id => /^sesame\/[a-z][a-z0-9-]*$/.test(id)) && new Set(withdrawals).size === withdrawals.length, 'Withdrawals must be unique exact IDs');
  const releases = [], plugins = [], roots = new Set(), ids = new Set();
  for (const selected of sources.releases) {
    require(/^plugins-(?:optional-)?api-v1-dev\.[1-9][0-9]*$/.test(selected.tag) && hex(selected.releaseCommit, 40) && hex(selected.reviewSha256, 64), 'Catalog source needs fixed publication and review identities');
    const planPath = `.github/plugin-releases/${selected.tag}.json`;
    const plan = validatePlan(jsonAt(root, selected.releaseCommit, planPath));
    require(plan.tag === selected.tag && !roots.has(plan.sourceRoot), 'Catalog release group is missing or repeated'); roots.add(plan.sourceRoot);
    require(jsonAt(root, plan.sourceCommit, `${plan.sourceRoot}/official-plugins.lock.json`).apiVersion === '2', `Release ${plan.tag} is an API 1 historical snapshot; select a reviewed API 2 release instead of relabeling its bytes`);
    require(JSON.stringify(plan) === JSON.stringify(JSON.parse(readFileSync(join(root, planPath)))), 'Recorded release plan changed after publication');
    git(root, ['merge-base', '--is-ancestor', plan.sourceCommit, selected.releaseCommit]);
    const policy = readCatalogPolicy(root, plan.sourceCommit);
    const prepared = prepareRelease(root, plan), lock = JSON.parse(prepared.files.get('official-plugins.lock.json'));
    const download = `https://github.com/${REPOSITORY}/releases/download/${plan.tag}`;
    const release = { tag: plan.tag, releaseCommit: selected.releaseCommit, sourceCommit: plan.sourceCommit, sourceRoot: plan.sourceRoot, ...(plan.profile ? { profile: plan.profile, engines: { sesame: '>=0.2.0-0' } } : {}),
      archive: { url: `${download}/${plan.archive.name}`, sha256: plan.archive.sha256 },
      lock: { url: `${download}/official-plugins.lock.json`, sha256: plan.lockSha256 },
      review: { url: `${download}/review.json`, sha256: selected.reviewSha256 } };
    releases.push(release);
    for (const pkg of lock.packages) {
      require(!ids.has(pkg.id), `Repeated catalog identity: ${pkg.id}`); ids.add(pkg.id);
      const path = `${plan.sourceRoot}/packages/${pkg.directory}`, manifest = jsonAt(root, plan.sourceCommit, `${path}/plugin.json`);
      const declared = jsonAt(root, plan.sourceCommit, `${path}/${manifest.capability_manifest}`);
      plugins.push(catalogPackage(pkg, manifest, declared, release, { withdrawn: withdrawals.includes(pkg.id), classification: Object.hasOwn(policy, pkg.directory) ? policy[pkg.directory] : undefined }));
    }
    // Published readers interpret this optional shorthand as exact equality for
    // every package, not as a lower bound. prepareRelease already validated the
    // real profile and each manifest; keep all entry-level ranges and fixed pins.
    if (release.profile && plugins.some(pkg => pkg.release === release.tag && pkg.engines?.sesame !== release.engines.sesame)) {
      delete release.profile;
      delete release.engines;
    }
  }
  require(withdrawals.every(id => ids.has(id)), 'Cannot withdraw an unknown package identity');
  plugins.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { schemaVersion: 1, apiVersion: '2', channel: 'development', releases, plugins };
}

export function validatePublishedRelease(release, actual) {
  require(actual?.tag_name === release.tag && actual.target_commitish === release.releaseCommit && actual.draft === false && actual.prerelease === true && Number.isFinite(Date.parse(actual.published_at)), `Release is not the fixed published development revision: ${release.tag}`);
  for (const asset of [release.archive, release.lock, release.review]) {
    const matches = actual.assets?.filter(item => item.browser_download_url === asset.url);
    require(matches?.length === 1 && matches[0].digest === `sha256:${asset.sha256}` && Number.isSafeInteger(matches[0].size) && matches[0].size > 0, `Published asset differs: ${asset.url}`);
  }
}
export async function checkPublished(catalog, fetcher = globalThis.fetch, { token = process.env.GITHUB_TOKEN } = {}) {
  for (const release of catalog.releases) {
    const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${encodeURIComponent(release.tag)}`, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    require(response.ok, `Cannot confirm published release ${release.tag}: HTTP ${response.status}`);
    validatePublishedRelease(release, await response.json());
  }
}
export function validateCatalog(root = repository) {
  const catalog = buildCatalog(root), expected = JSON.stringify(catalog, null, 2) + '\n';
  require(readFileSync(join(root, 'plugins/api-v1/catalog.json'), 'utf8') === expected, 'Unified catalog differs from its fixed released source bytes');
  return catalog;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), sourceAt = args.indexOf('--source'), root = sourceAt === -1 ? repository : resolve(args[sourceAt + 1]);
  require(args.includes('--write') || args.includes('--check'), 'Use --write or --check, optionally --published and --source <repository>');
  const catalog = args.includes('--write') ? buildCatalog(root) : validateCatalog(root);
  if (args.includes('--published')) await checkPublished(catalog);
  if (args.includes('--write')) writeFileSync(join(root, 'plugins/api-v1/catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  console.log(JSON.stringify({ packages: catalog.plugins.length, releases: catalog.releases.map(item => item.tag), publishedChecked: args.includes('--published') }));
}
