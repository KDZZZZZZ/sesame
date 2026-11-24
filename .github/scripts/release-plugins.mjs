import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLock, createArchive, sha256, readProfile } from '../../plugins/api-v1/scripts/plugin-lock.mjs';
import { readPackageDirectory } from '../../plugins/protocol/directory.mjs';
import { readSemanticReview } from './semantic-review.mjs';

const REPOSITORY = 'KDZZZZZZ/sesame';
const HISTORICAL_CHECKS = [
  { name: 'package-static-review', path: '.github/workflows/plugin-api-v1.yml' },
  { name: 'catalog-static-review', path: '.github/workflows/plugin-catalog.yml' },
];
const CHECKS = [{ name: 'plugin-static-review', path: '.github/workflows/plugin-ci.yml' }];
const assert = (value, message) => { if (!value) throw new Error(message); };
const git = (root, args) => execFileSync('git', args, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
// Exact existing plans, loaded from the trusted publisher. Candidate plan files
// cannot declare themselves historical by omitting a profile or choosing a date.
const historical = new Map(JSON.parse(readFileSync(new URL('./historical-plugin-releases.json', import.meta.url))).map(plan => [plan.tag, JSON.stringify(canonical(plan))]));
export function validatePlan(plan) {
  assert(plan.schemaVersion === 1 && /^[a-f0-9]{40}$/.test(plan.sourceCommit), 'Release requires a fixed source commit');
  const optional = plan.sourceRoot === 'plugins/optional-api-v1';
  assert(optional || plan.sourceRoot === 'plugins/api-v1', 'Unexpected release source root');
  assert(new RegExp(`^plugins-${optional ? 'optional-' : ''}api-v1-dev\\.[1-9][0-9]*$`).test(plan.tag), 'Development release tag is required');
  assert(plan.archive?.name === `sesame-${optional ? 'optional' : 'official'}-plugins-api-v1-${plan.tag.split('-').at(-1)}.tar.gz`, 'Unexpected archive filename');
  assert(/^[a-f0-9]{64}$/.test(plan.archive.sha256) && /^[a-f0-9]{64}$/.test(plan.lockSha256), 'Release digests must be fixed');
  assert(plan.profile === undefined || plan.profile === (optional ? 'optional' : 'core'), 'Release profile differs from its source root');
  assert(Number.isSafeInteger(plan.pullRequest) && plan.pullRequest > 0, 'Release requires a reviewed pull request');
  assert(typeof plan.title === 'string' && plan.title.length > 0 && plan.title.length <= 160, 'Invalid release title');
  if (historical.has(plan.tag)) assert(JSON.stringify(canonical(plan)) === historical.get(plan.tag), 'Historical release plan identity is immutable');
  else assert(plan.profile === (optional ? 'optional' : 'core'), 'Every new release plan requires its distribution profile');
  return plan;
}

export function materializeSource(repository, plan, destination) {
  const prefix = `${plan.sourceRoot}/`;
  const tree = git(repository, ['ls-tree', '-rlz', plan.sourceCommit, '--', prefix + 'packages', prefix + 'official-plugins.lock.json', prefix + 'bundle-profile.json']);
  const paths = tree.toString('utf8').split('\0').filter(Boolean).map(record => {
    const match = /^(100644|100755) blob ([a-f0-9]{40}) +(\d+)\t([^\x00-\x1f\\:]+)$/.exec(record);
    assert(match && match[4].startsWith(prefix), 'Release source contains a non-file entry or unsafe Git source path');
    const path = match[4].slice(prefix.length);
    assert(path.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'Unsafe Git source path');
    const size = Number(match[3]);
    assert(size <= 2 * 1024 * 1024, 'Release source file is too large');
    return { path, oid: match[2], size };
  });
  // Read bounded batches from immutable Git blobs. This avoids one subprocess
  // per file when materializing the complete plugin collection.
  for (let first = 0; first < paths.length;) {
    let last = first, total = 0;
    while (last < paths.length && last - first < 256 && total < 8 * 1024 * 1024) total += paths[last++].size;
    const batch = paths.slice(first, last);
    const data = execFileSync('git', ['cat-file', '--batch'], { cwd: repository,
      input: batch.map(entry => entry.oid).join('\n') + '\n', maxBuffer: total + batch.length * 100 });
    let offset = 0;
    for (const { path, oid, size } of batch) {
      const header = data.indexOf(10, offset);
      assert(header >= offset && data.toString('ascii', offset, header) === `${oid} blob ${size}`, 'Unexpected Git blob');
      const end = header + 1 + size;
      assert(data[end] === 10, 'Incomplete Git blob');
      const target = join(destination, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data.subarray(header + 1, end), { flag: 'wx' });
      offset = end + 1;
    }
    first = last;
  }
}

export function prepareRelease(repository, input, { includePackageMetadata = false } = {}) {
  const plan = validatePlan(input), temp = mkdtempSync(join(tmpdir(), 'sesame-release-'));
  try {
    materializeSource(repository, plan, temp);
    const profile = readProfile(temp);
    assert(profile ? plan.profile === profile.kind : plan.profile === undefined, 'Fixed release profile differs or is missing');
    const lock = buildLock(temp), lockBytes = Buffer.from(JSON.stringify(lock, null, 2) + '\n');
    assert(lock.apiVersion === '2', 'New releases require Plugin API 2');
    assert(readFileSync(join(temp, 'official-plugins.lock.json')).equals(lockBytes), 'Source lock differs from package files');
    const archive = createArchive(temp, lock);
    assert(sha256(archive) === plan.archive.sha256 && sha256(lockBytes) === plan.lockSha256, `Release bytes differ from reviewed digests: archive=${sha256(archive)}, lock=${sha256(lockBytes)}`);
    const url = `https://github.com/${REPOSITORY}/releases/download/${plan.tag}/${plan.archive.name}`;
    const pin = { schemaVersion: 1, apiVersion: lock.apiVersion, sourceCommit: plan.sourceCommit, archive: { url, sha256: plan.archive.sha256 }, lockSha256: plan.lockSha256, packages: lock.packages.map(({ id, version, treeDigest }) => ({ id, version, treeDigest })) };
    const files = new Map([[plan.archive.name, archive], ['official-plugins.lock.json', lockBytes], ['application-official-plugins.lock.json', Buffer.from(JSON.stringify(pin, null, 2) + '\n')], ['SHA256SUMS', Buffer.from(`${plan.archive.sha256}  ${plan.archive.name}\n${plan.lockSha256}  official-plugins.lock.json\n`)]]);
    if (!includePackageMetadata) return { plan, pin, files };
    const packageMetadata = new Map();
    for (const pkg of lock.packages) {
      if (pkg.files.some(file => file.path === 'plugin.yaml')) {
        const { manifest, capabilities, surface, catalog } = readPackageDirectory(join(temp, 'packages', pkg.directory));
        packageMetadata.set(pkg.id, { manifest, capabilities, surface, catalog });
      }
    }
    return { plan, pin, files, packageMetadata };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

export function reviewEvidence(plan, pr, reviews, checks) {
  assert(pr.merged === true && pr.base.ref === 'main' && pr.head.repo.full_name === REPOSITORY, 'Release PR must be merged from this repository into main');
  const successful = CHECKS.map(({ name, path }) => {
    const check = checks.filter(item => item.name === name && item.head_sha === pr.head.sha && item.workflow?.path === path && item.workflow.event === 'pull_request_target').sort((a, b) => b.id - a.id)[0];
    assert(check?.status === 'completed' && check.conclusion === 'success', `Missing successful check on the exact reviewed head: ${name}`);
    return { name, url: check.html_url, conclusion: check.conclusion, headSha: check.head_sha, completedAt: check.completed_at, workflow: check.workflow };
  });
  const latest = new Map();
  for (const review of reviews) if (review.state !== 'COMMENTED' && review.state !== 'PENDING') latest.set(review.user.login, review);
  assert(![...latest.values()].some(review => review.state === 'CHANGES_REQUESTED'), 'An unresolved changes-requested review prevents publication');
  const approvals = [...latest.values()].filter(review => review.state === 'APPROVED' && review.commit_id === pr.head.sha && review.user.type !== 'Bot' && review.user.id !== pr.user.id && Number.isFinite(Date.parse(review.submitted_at)) && Date.parse(review.submitted_at) <= Date.parse(pr.merged_at));
  return { schemaVersion: 1, tag: plan.tag, sourceCommit: plan.sourceCommit, pullRequest: { number: plan.pullRequest, url: pr.html_url, headSha: pr.head.sha, mergeCommit: pr.merge_commit_sha, mergedAt: pr.merged_at, mergedBy: pr.merged_by?.login }, automated: successful, human: { status: approvals.length ? 'approved' : 'not-recorded', approvals: approvals.map(review => ({ author: review.user.login, commit: review.commit_id, url: review.html_url })) }, reviews: reviews.map(review => ({ author: review.user.login, authorType: review.user.type, state: review.state, commit: review.commit_id, url: review.html_url })), scope: 'Static identity, immutable source and file checks. Candidate plugin factories and tools were not executed by CI. Automated checks and repository merge permission do not constitute human approval or a safety certification.' };
}

export async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, { ...options, headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...options.headers } });
  if (response.status === 404 && options.allowMissing) return null;
  if (!response.ok) throw new Error(`GitHub API ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

export async function allReviews(number) {
  const reviews = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await api(`/pulls/${number}/reviews?per_page=100&page=${page}`); reviews.push(...batch);
    if (batch.length < 100) return reviews;
  }
  throw new Error('Review pagination exceeded publication budget');
}

export async function graphql(body) {
  const response = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert(response.ok, `Cannot read GitHub review discussions (${response.status})`);
  return response.json();
}

export async function trustedChecks(pr) {
  const checks = [];
  for (const required of CHECKS) {
    const workflow = await api(`/actions/workflows/${basename(required.path)}`);
    const { workflow_runs: runs } = await api(`/actions/workflows/${workflow.id}/runs?event=pull_request_target&head_sha=${pr.head.sha}&per_page=100`);
    const cutoff = pr.merged ? Date.parse(pr.merged_at) : Date.now();
    const run = runs.filter(item => item.workflow_id === workflow.id && item.path === required.path && item.event === 'pull_request_target' && item.head_sha === pr.head.sha && Date.parse(item.updated_at) <= cutoff).sort((a, b) => b.id - a.id)[0];
    assert(run?.status === 'completed' && run.conclusion === 'success', `Trusted workflow did not succeed for the exact PR head: ${required.path}`);
    const { jobs } = await api(`/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    const job = jobs.find(item => item.name === required.name);
    assert(job?.status === 'completed' && job.conclusion === 'success', `Trusted workflow omitted a successful ${required.name}`);
    checks.push({ ...job, head_sha: run.head_sha, workflow: { path: run.path, event: run.event, id: workflow.id, runId: run.id, runUrl: run.html_url } });
  }
  return checks;
}

async function findRelease(tag) {
  const published = await api(`/releases/tags/${tag}`, { allowMissing: true });
  if (published) return published;
  // Inspect authenticated draft listings as well, so the retirement guard can
  // explicitly reject every unpublished release without creating anything.
  for (let page = 1; page <= 10; page++) {
    const batch = await api(`/releases?per_page=100&page=${page}`), matching = batch.filter(item => item.tag_name === tag);
    assert(matching.length <= 1, 'More than one release uses the requested tag');
    if (matching.length) return matching[0];
    if (batch.length < 100) return null;
  }
  throw new Error('Release pagination exceeded publication budget');
}

export function validateAssets(release, files) {
  assert(release.assets.length === files.size, 'Release asset set is incomplete or contains unexpected assets');
  for (const [name, bytes] of files) {
    const matches = release.assets.filter(asset => asset.name === name);
    assert(matches.length === 1 && matches[0].digest === `sha256:${sha256(bytes)}` && matches[0].size === bytes.length, `Published asset differs or is missing: ${name}`);
  }
}

export function releaseCommitFor(head, object, release) {
  const commit = object?.sha ?? release?.target_commitish ?? head;
  assert(/^[a-f0-9]{40}$/.test(commit), 'Publication tag requires a fixed main-branch commit');
  assert(!object || object.type === 'commit', 'Publication tag must resolve to a commit');
  assert(!release || release.target_commitish === commit, 'Existing release and tag identify different publishing revisions');
  return commit;
}

async function preserveRecordedReview(release, plan, pr, files, releaseCommit) {
  const asset = release.assets.find(item => item.name === 'review.json');
  assert(asset, 'Historical publication is missing its immutable review record');
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/assets/${asset.id}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/octet-stream', 'X-GitHub-Api-Version': '2022-11-28' } });
  assert(response.ok, 'Cannot read existing review record');
  const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length <= 1024 * 1024 && asset.digest === `sha256:${sha256(bytes)}`, 'Existing review record digest differs');
  const record = JSON.parse(bytes);
  assert(record.tag === plan.tag && record.sourceCommit === plan.sourceCommit && record.pullRequest?.number === plan.pullRequest && record.pullRequest.headSha === pr.head.sha && record.pullRequest.mergeCommit === pr.merge_commit_sha, 'Existing review record identifies different source');
  assert(record.publication?.commit === releaseCommit, 'Existing review record identifies a different publishing revision');
  assert(record.automated?.length === HISTORICAL_CHECKS.length && ['approved', 'not-recorded'].includes(record.human?.status), 'Incomplete existing review record');
  for (const required of HISTORICAL_CHECKS) {
    const check = record.automated.find(item => item.name === required.name);
    assert(Number.isSafeInteger(check?.workflow?.runId), 'Existing review record has no workflow identity');
    const run = await api(`/actions/runs/${check.workflow.runId}`);
    assert(run.workflow_id === check.workflow.id && run.path === required.path && run.event === 'pull_request_target' && run.head_sha === pr.head.sha && run.conclusion === 'success', 'Existing review record is not backed by a successful trusted workflow');
  }
  // Keep the historical publication record immutable when later comments or
  // additional successful reruns arrive on the same PR.
  files.set('review.json', bytes);
}

export function requirePublishedPluginRelease(release) {
  assert(release?.draft === false, 'New plugin Releases are retired; absent or draft releases cannot be published. Existing published releases may only be verified.');
  return release;
}

async function publish(repository, relative, prepared) {
  assert(process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_REF === 'refs/heads/main' && process.env.GITHUB_TOKEN, 'Publication requires the main-branch GitHub workflow');
  const { plan, files } = prepared;
  const release = requirePublishedPluginRelease(await findRelease(plan.tag));
  const pr = await api(`/pulls/${plan.pullRequest}`);
  assert(pr.merged && pr.base.ref === 'main' && pr.head.repo.full_name === REPOSITORY, 'Historical release requires its original merged PR');
  git(repository, ['merge-base', '--is-ancestor', plan.sourceCommit, pr.head.sha]);
  git(repository, ['merge-base', '--is-ancestor', pr.merge_commit_sha, 'HEAD']);
  assert(git(repository, ['show', `${pr.head.sha}:${relative}`]).equals(readFileSync(join(repository, relative))), 'Release plan changed after its reviewed PR');
  const tag = await api(`/git/ref/tags/${plan.tag}`, { allowMissing: true });
  const object = tag ? (tag.object.type === 'tag' ? (await api(`/git/tags/${tag.object.sha}`)).object : tag.object) : null;
  const head = git(repository, ['rev-parse', 'HEAD']).toString().trim(), releaseCommit = releaseCommitFor(head, object, release);
  git(repository, ['merge-base', '--is-ancestor', pr.merge_commit_sha, releaseCommit]);
  git(repository, ['merge-base', '--is-ancestor', releaseCommit, head]);
  assert(git(repository, ['show', `${releaseCommit}:${relative}`]).equals(readFileSync(join(repository, relative))), 'Publishing revision contains a different release plan');
  await preserveRecordedReview(release, plan, pr, files, releaseCommit);
  assert(release.prerelease, 'Existing release is not a prerelease'); validateAssets(release, files);
  console.log(`Verified historical publication without changes: ${release.html_url}`);
}

async function main() {
  const mode = process.argv[2], repository = resolve(process.argv[3] ?? '.');
  if (mode === '--review-check') {
    assert(process.env.GITHUB_TOKEN, 'A GitHub read token is required');
    let number = Number(process.argv[4]);
    if (process.argv[4] === 'auto') {
      const open = await api('/pulls?state=open&base=main&head=KDZZZZZZ:dev&per_page=2');
      if (!open.length) return;
      assert(open.length === 1, 'Expected a single canonical promotion PR');
      number = open[0].number;
    }
    assert(Number.isSafeInteger(number) && number > 0, 'Expected an open dev-to-main PR number');
    const pr = await api(`/pulls/${number}`);
    assert(!pr.merged && pr.state === 'open' && pr.base.ref === 'main' && pr.head.ref === 'dev' &&
      pr.head.repo.full_name === REPOSITORY, 'Review check requires the open canonical dev-to-main PR before merge');
    const reviews = await allReviews(number);
    // An initial CI completion may precede the first approval. Submitting a
    // review wakes the same trusted workflow again.
    if (process.argv[4] === 'auto' && !reviews.some(r => r.state === 'APPROVED' && r.commit_id === pr.head.sha)) return;
    await trustedChecks(pr);
    const semantic = await readSemanticReview(pr, reviews, api, graphql);
    const current = await api(`/pulls/${number}`);
    assert(current.merged === false && current.state === 'open' && current.head.sha === pr.head.sha, 'PR changed or merged during semantic review check');
    console.log(JSON.stringify({ schemaVersion: 1, repository: REPOSITORY, pullRequest: number, headSha: pr.head.sha, merged: false, checkedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), semantic }, null, 2)); return;
  }
  assert(['--check', '--build', '--publish'].includes(mode), 'Use --check, --build, --publish or --review-check [repository]');
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
