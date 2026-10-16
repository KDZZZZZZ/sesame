import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRelease, validatePlan } from '../../../.github/scripts/release-plugins.mjs';

const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const REPOSITORY = 'KDZZZZZZ/sesame';
const require = (value, message) => { if (!value) throw new Error(message); };
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const git = (root, args) => execFileSync('git', args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });
const jsonAt = (root, commit, path) => JSON.parse(git(root, ['show', `${commit}:${path}`]));

// Candidate manifests are data. The fixed Git source is reconstructed and checked
// by the same trusted archive builder used for release publication, never imported.
export function buildCatalog(root = repository, sources = JSON.parse(readFileSync(join(root, 'plugins/api-v1/catalog.sources.json')))) {
  require(sources.schemaVersion === 1 && Array.isArray(sources.releases) && sources.releases.length === 2, 'Select one fixed official and one fixed optional release');
  const withdrawals = sources.withdrawn ?? [];
  require(Array.isArray(withdrawals) && withdrawals.every(id => /^sesame\/[a-z][a-z0-9-]*$/.test(id)) && new Set(withdrawals).size === withdrawals.length, 'Withdrawals must be unique exact IDs');
  const releases = [], plugins = [], roots = new Set(), ids = new Set();
  for (const selected of sources.releases) {
    require(/^plugins-(?:optional-)?api-v1-dev\.[1-9][0-9]*$/.test(selected.tag) && hex(selected.releaseCommit, 40) && hex(selected.reviewSha256, 64), 'Catalog source needs fixed publication and review identities');
    const planPath = `.github/plugin-releases/${selected.tag}.json`;
    const plan = validatePlan(jsonAt(root, selected.releaseCommit, planPath));
    require(plan.tag === selected.tag && !roots.has(plan.sourceRoot), 'Catalog release group is missing or repeated'); roots.add(plan.sourceRoot);
    require(JSON.stringify(plan) === JSON.stringify(JSON.parse(readFileSync(join(root, planPath)))), 'Recorded release plan changed after publication');
    git(root, ['merge-base', '--is-ancestor', plan.sourceCommit, selected.releaseCommit]);
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
      const extension = manifest.extensions?.['bot.sesame'], standard = Boolean(manifest.$schema);
      const definitions = jsonAt(root, plan.sourceCommit, `${path}/${standard ? extension.builtin.tool_definitions : manifest.tool_definitions}`);
      plugins.push({ id: pkg.id, name: pkg.directory, version: pkg.version, apiVersion: '1', format: standard ? 'agent-plugins' : 'sesame-native',
        ...(plan.profile ? { engines: extension?.engines ?? manifest.engines, distribution: plan.profile } : {}),
        title: standard ? extension.builtin.title : manifest.title, description: manifest.description, license: manifest.license,
        author: manifest.author ?? { name: 'Sesame contributors', url: `https://github.com/${REPOSITORY}` }, status: withdrawals.includes(pkg.id) ? 'withdrawn' : 'active',
        release: plan.tag, source: { repository: `https://github.com/${REPOSITORY}`, commit: plan.sourceCommit, path },
        package: { treeDigest: pkg.treeDigest, files: pkg.files },
        tools: standard ? Object.entries(definitions).flatMap(([server, tools]) => tools.map(tool => ({ server, name: tool.name }))) : manifest.tool_names,
        review: { automated: 'package-static-review', human: 'not-recorded', record: release.review,
          notes: 'The linked publication record distinguishes static checks, maintainer-recorded Agent review and human approval. Static checks do not certify behavior, environment readiness or safety.' },
        requirements: standard ? 'Plugin API 1 host. Declared stdio tests and servers execute locally as the current user; inspect and reuse an existing compatible runtime. No dependency installer is executed by the catalog downloader.' : 'Plugin API 1 host. Native checks cover manifest/schema/JavaScript syntax; installation activates the plugin. Read its skill and verify environment prerequisites separately. Existing host-granted migration access is not expanded by this catalog.',
        documentationUrl: `https://github.com/${REPOSITORY}/tree/${plan.sourceCommit}/${path}`, feedbackUrl: `https://github.com/${REPOSITORY}/issues` });
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
  return { schemaVersion: 1, apiVersion: '1', channel: 'development', releases, plugins };
}

export function validatePublishedRelease(release, actual) {
  require(actual?.tag_name === release.tag && actual.target_commitish === release.releaseCommit && actual.draft === false && actual.prerelease === true && Number.isFinite(Date.parse(actual.published_at)), `Release is not the fixed published development revision: ${release.tag}`);
  for (const asset of [release.archive, release.lock, release.review]) {
    const matches = actual.assets?.filter(item => item.browser_download_url === asset.url);
    require(matches?.length === 1 && matches[0].digest === `sha256:${asset.sha256}` && Number.isSafeInteger(matches[0].size) && matches[0].size > 0, `Published asset differs: ${asset.url}`);
  }
}
export async function checkPublished(catalog, fetcher = globalThis.fetch) {
  for (const release of catalog.releases) {
    const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${release.tag}`, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/vnd.github+json' } });
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
