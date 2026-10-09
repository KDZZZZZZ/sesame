import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLock, createArchive, sha256 } from '../../plugins/api-v1/scripts/plugin-lock.mjs';

const REPOSITORY = 'KDZZZZZZ/sesame';
const assert = (value, message) => { if (!value) throw new Error(message); };
const git = (root, args) => execFileSync('git', args, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
export function validatePlan(plan) {
  assert(plan.schemaVersion === 1 && /^[a-f0-9]{40}$/.test(plan.sourceCommit), 'Release requires a fixed source commit');
  const optional = plan.sourceRoot === 'plugins/optional-api-v1';
  assert(optional || plan.sourceRoot === 'plugins/api-v1', 'Unexpected release source root');
  assert(new RegExp(`^plugins-${optional ? 'optional-' : ''}api-v1-dev\\.[1-9][0-9]*$`).test(plan.tag), 'Development release tag is required');
  assert(plan.archive?.name === `sesame-${optional ? 'optional' : 'official'}-plugins-api-v1-${plan.tag.split('-').at(-1)}.tar.gz`, 'Unexpected archive filename');
  assert(/^[a-f0-9]{64}$/.test(plan.archive.sha256) && /^[a-f0-9]{64}$/.test(plan.lockSha256), 'Release digests must be fixed');
  assert(Number.isSafeInteger(plan.pullRequest) && plan.pullRequest > 0, 'Release requires a reviewed pull request');
  assert(typeof plan.title === 'string' && plan.title.length > 0 && plan.title.length <= 160, 'Invalid release title');
  return plan;
}

export function materializeSource(repository, plan, destination) {
  const prefix = `${plan.sourceRoot}/`;
  const tree = git(repository, ['ls-tree', '-r', '-z', plan.sourceCommit, '--', `${prefix}packages`, `${prefix}official-plugins.lock.json`]).toString();
  for (const record of tree.split('\0').filter(Boolean)) {
    const [meta, path] = record.split('\t'), [mode, type, oid] = meta.split(' ');
    assert(['100644', '100755'].includes(mode) && type === 'blob' && path.startsWith(prefix), 'Release source contains a non-file entry');
    const relative = path.slice(prefix.length);
    assert(!relative.split('/').some(part => !part || part === '.' || part === '..') && !relative.includes('\\'), 'Unsafe Git source path');
    const bytes = git(repository, ['cat-file', 'blob', oid]);
    assert(bytes.length <= 2 * 1024 * 1024, 'Release source file is too large');
    const target = join(destination, relative); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
}

export function prepareRelease(repository, input) {
  const plan = validatePlan(input), temp = mkdtempSync(join(tmpdir(), 'sesame-release-'));
  try {
    materializeSource(repository, plan, temp);
    const lock = buildLock(temp), lockBytes = Buffer.from(JSON.stringify(lock, null, 2) + '\n');
    assert(readFileSync(join(temp, 'official-plugins.lock.json')).equals(lockBytes), 'Source lock differs from package files');
    const archive = createArchive(temp, lock);
    assert(sha256(archive) === plan.archive.sha256 && sha256(lockBytes) === plan.lockSha256, `Release bytes differ from reviewed digests: archive=${sha256(archive)}, lock=${sha256(lockBytes)}`);
    const url = `https://github.com/${REPOSITORY}/releases/download/${plan.tag}/${plan.archive.name}`;
    const pin = { schemaVersion: 1, apiVersion: '1', sourceCommit: plan.sourceCommit, archive: { url, sha256: plan.archive.sha256 }, lockSha256: plan.lockSha256, packages: lock.packages.map(({ id, version, treeDigest }) => ({ id, version, treeDigest })) };
    return { plan, pin, files: new Map([[plan.archive.name, archive], ['official-plugins.lock.json', lockBytes], ['application-official-plugins.lock.json', Buffer.from(JSON.stringify(pin, null, 2) + '\n')], ['SHA256SUMS', Buffer.from(`${plan.archive.sha256}  ${plan.archive.name}\n${plan.lockSha256}  official-plugins.lock.json\n`)]]) };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

export function reviewEvidence(plan, pr, reviews, checks) {
  assert(pr.merged === true && pr.base.ref === 'main' && pr.head.repo.full_name === REPOSITORY, 'Release PR must be merged from this repository into main');
  const required = ['package-static-review', 'catalog-static-review'];
  const successful = required.map(name => {
    const check = checks.filter(item => item.name === name && item.head_sha === pr.head.sha && item.app?.slug === 'github-actions').sort((a, b) => b.id - a.id)[0];
    assert(check?.status === 'completed' && check.conclusion === 'success', `Missing successful check on the exact reviewed head: ${name}`);
    return { name, url: check.html_url, conclusion: check.conclusion, headSha: check.head_sha };
  });
  const latest = new Map();
  for (const review of reviews) if (review.state !== 'COMMENTED' && review.state !== 'PENDING') latest.set(review.user.login, review);
  assert(![...latest.values()].some(review => review.state === 'CHANGES_REQUESTED'), 'An unresolved changes-requested review prevents publication');
  const approvals = [...latest.values()].filter(review => review.state === 'APPROVED' && review.commit_id === pr.head.sha && review.user.type !== 'Bot' && review.user.id !== pr.user.id);
  return { schemaVersion: 1, tag: plan.tag, sourceCommit: plan.sourceCommit, pullRequest: { number: plan.pullRequest, url: pr.html_url, headSha: pr.head.sha, mergeCommit: pr.merge_commit_sha, mergedAt: pr.merged_at, mergedBy: pr.merged_by?.login }, automated: successful, human: { status: approvals.length ? 'approved' : 'not-recorded', approvals: approvals.map(review => ({ author: review.user.login, commit: review.commit_id, url: review.html_url })) }, reviews: reviews.map(review => ({ author: review.user.login, authorType: review.user.type, state: review.state, commit: review.commit_id, url: review.html_url })), scope: 'Static identity, immutable source and file checks. Candidate plugin factories and tools were not executed by CI. Automated checks and repository merge permission do not constitute human approval or a safety certification.' };
}

async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, { ...options, headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...options.headers } });
  if (response.status === 404 && options.allowMissing) return null;
  if (!response.ok) throw new Error(`GitHub API ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function allReviews(number) {
  const reviews = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await api(`/pulls/${number}/reviews?per_page=100&page=${page}`); reviews.push(...batch);
    if (batch.length < 100) return reviews;
  }
  throw new Error('Review pagination exceeded publication budget');
}

async function publish(repository, relative, prepared) {
  assert(process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_REF === 'refs/heads/main' && process.env.GITHUB_TOKEN, 'Publication requires the main-branch GitHub workflow');
  const { plan, files } = prepared;
  const [pr, reviews] = await Promise.all([api(`/pulls/${plan.pullRequest}`), allReviews(plan.pullRequest)]);
  // Required PR checks belong to its exact head, not to the later merge commit.
  const headChecks = await api(`/commits/${pr.head.sha}/check-runs?per_page=100`);
  const evidence = reviewEvidence(plan, pr, reviews, headChecks.check_runs);
  git(repository, ['merge-base', '--is-ancestor', plan.sourceCommit, pr.head.sha]);
  git(repository, ['merge-base', '--is-ancestor', pr.merge_commit_sha, 'HEAD']);
  assert(git(repository, ['show', `${pr.head.sha}:${relative}`]).equals(readFileSync(join(repository, relative))), 'Release plan changed after its reviewed PR');
  evidence.publication = { workflow: `https://github.com/${REPOSITORY}/blob/${pr.merge_commit_sha}/.github/workflows/plugin-api1-release.yml`, trigger: 'main branch workflow after merged PR and successful exact-head checks' };
  files.set('review.json', Buffer.from(JSON.stringify(evidence, null, 2) + '\n'));
  const tag = await api(`/git/ref/tags/${plan.tag}`, { allowMissing: true });
  if (tag) {
    const object = tag.object.type === 'tag' ? (await api(`/git/tags/${tag.object.sha}`)).object : tag.object;
    assert(object.type === 'commit' && object.sha === plan.sourceCommit, 'Existing tag points at different source; refusing to move it');
  }
  let release = await api(`/releases/tags/${plan.tag}`, { allowMissing: true });
  if (release && !release.draft) {
    const archive = release.assets.find(asset => asset.name === plan.archive.name);
    const lock = release.assets.find(asset => asset.name === 'official-plugins.lock.json');
    assert(release.prerelease && archive?.digest === `sha256:${plan.archive.sha256}` && lock?.digest === `sha256:${plan.lockSha256}`, 'Existing release identity differs; never overwrite a release');
    console.log(`Already published with the reviewed digests: ${release.html_url}`); return;
  }
  if (!release) release = await api('/releases', { method: 'POST', body: JSON.stringify({ tag_name: plan.tag, target_commitish: plan.sourceCommit, name: plan.title, draft: true, prerelease: true, make_latest: 'false', body: `Development plugin packages for the matching API 1 host.\n\nAutomatically published after [PR #${plan.pullRequest}](${pr.html_url}) was merged and its exact-head static checks passed. Source: ${plan.sourceCommit}.\n\nSee review.json for actual check URLs and review states; human review: ${evidence.human.status}. Static checks do not certify runtime behavior or safety. Existing stable 0.1.4 catalog metadata is unchanged.\n\nVerify SHA256SUMS and official-plugins.lock.json before installation. application-official-plugins.lock.json pins the archive and every package tree.` }) });
  for (const [name, bytes] of files) {
    const existing = release.assets.find(asset => asset.name === name);
    if (existing) { assert(existing.digest === `sha256:${sha256(bytes)}`, `Draft asset differs: ${name}; refusing overwrite`); continue; }
    const upload = new URL(release.upload_url.split('{')[0]); assert(upload.hostname === 'uploads.github.com', 'Unexpected asset upload endpoint'); upload.searchParams.set('name', name);
    const response = await fetch(upload, { method: 'POST', headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: bytes });
    assert(response.ok, `Asset upload failed: ${name} (${response.status})`);
    const asset = await response.json(); assert(asset.digest === `sha256:${sha256(bytes)}`, `Uploaded asset digest differs: ${name}`);
  }
  release = await api(`/releases/${release.id}`, { method: 'PATCH', body: JSON.stringify({ draft: false, prerelease: true, make_latest: 'false' }) });
  console.log(`Published ${release.html_url}`);
}

async function main() {
  const mode = process.argv[2], repository = resolve(process.argv[3] ?? '.');
  assert(['--check', '--build', '--publish'].includes(mode), 'Use --check, --build or --publish [repository]');
  const directory = join(repository, '.github/plugin-releases');
  if (!existsSync(directory)) { console.log('No API 1 release plans'); return; }
  for (const name of readdirSync(directory).sort()) {
    assert(/^[a-z0-9.-]+\.json$/.test(name), 'Unexpected release plan file');
    const relative = `.github/plugin-releases/${name}`, prepared = prepareRelease(repository, JSON.parse(readFileSync(join(directory, name))));
    if (mode === '--publish') await publish(repository, relative, prepared);
    else if (mode === '--build') { const output = join(repository, prepared.plan.sourceRoot, 'dist'); mkdirSync(output, { recursive: true }); for (const [name, bytes] of prepared.files) writeFileSync(join(output, basename(name)), bytes); }
    console.log(`Verified ${prepared.plan.tag}: ${prepared.plan.archive.sha256}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
