import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLock, createArchive, sha256 } from '../../plugins/api-v1/scripts/plugin-lock.mjs';
import { readSemanticReview } from './semantic-review.mjs';

const REPOSITORY = 'KDZZZZZZ/sesame';
const CHECKS = [{ name: 'package-static-review', path: '.github/workflows/plugin-api-v1.yml' }, { name: 'catalog-static-review', path: '.github/workflows/plugin-catalog.yml' }];
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

async function graphql(body) {
  const response = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert(response.ok, `Cannot read GitHub review discussions (${response.status})`);
  return response.json();
}

async function trustedChecks(pr) {
  const checks = [];
  for (const required of CHECKS) {
    const workflow = await api(`/actions/workflows/${basename(required.path)}`);
    const { workflow_runs: runs } = await api(`/actions/workflows/${workflow.id}/runs?event=pull_request_target&head_sha=${pr.head.sha}&per_page=100`);
    const cutoff = pr.merged ? Date.parse(pr.merged_at) : Date.now();
    const run = runs.filter(item => item.workflow_id === workflow.id && item.path === required.path && item.event === 'pull_request_target' && item.head_sha === pr.head.sha && Date.parse(item.updated_at) <= cutoff).sort((a, b) => b.id - a.id)[0];
    assert(run?.status === 'completed' && run.conclusion === 'success', `Trusted workflow did not succeed for the exact PR head: ${required.path}`);
    const { jobs } = await api(`/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    const job = jobs.find(item => item.name === required.name);
    assert(job, `Trusted workflow omitted ${required.name}`);
    checks.push({ ...job, head_sha: run.head_sha, workflow: { path: run.path, event: run.event, id: workflow.id, runId: run.id, runUrl: run.html_url } });
  }
  return checks;
}

async function findRelease(tag) {
  const published = await api(`/releases/tags/${tag}`, { allowMissing: true });
  if (published) return published;
  // The tag endpoint does not return drafts. Authenticated listing lets retries
  // continue the same partially uploaded draft without duplicate creation.
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
  if (!asset) return;
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/assets/${asset.id}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/octet-stream', 'X-GitHub-Api-Version': '2022-11-28' } });
  assert(response.ok, 'Cannot read existing review record');
  const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length <= 1024 * 1024 && asset.digest === `sha256:${sha256(bytes)}`, 'Existing review record digest differs');
  const record = JSON.parse(bytes);
  assert(record.tag === plan.tag && record.sourceCommit === plan.sourceCommit && record.pullRequest?.number === plan.pullRequest && record.pullRequest.headSha === pr.head.sha && record.pullRequest.mergeCommit === pr.merge_commit_sha, 'Existing review record identifies different source');
  assert(record.publication?.commit === releaseCommit, 'Existing review record identifies a different publishing revision');
  assert(record.automated?.length === CHECKS.length && ['approved', 'not-recorded'].includes(record.human?.status), 'Incomplete existing review record');
  for (const required of CHECKS) {
    const check = record.automated.find(item => item.name === required.name);
    assert(Number.isSafeInteger(check?.workflow?.runId), 'Existing review record has no workflow identity');
    const [run, workflow] = await Promise.all([api(`/actions/runs/${check.workflow.runId}`), api(`/actions/workflows/${basename(required.path)}`)]);
    assert(run.workflow_id === workflow.id && run.path === required.path && run.event === 'pull_request_target' && run.head_sha === pr.head.sha && run.conclusion === 'success', 'Existing review record is not backed by a successful trusted workflow');
  }
  // Keep the historical publication record immutable when later comments or
  // additional successful reruns arrive on the same PR.
  files.set('review.json', bytes);
}

async function publish(repository, relative, prepared) {
  assert(process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_REF === 'refs/heads/main' && process.env.GITHUB_TOKEN, 'Publication requires the main-branch GitHub workflow');
  const { plan, files } = prepared;
  const [pr, reviews] = await Promise.all([api(`/pulls/${plan.pullRequest}`), allReviews(plan.pullRequest)]);
  // Required PR checks belong to its exact head, not to the later merge commit.
  const evidence = reviewEvidence(plan, pr, reviews, await trustedChecks(pr));
  git(repository, ['merge-base', '--is-ancestor', plan.sourceCommit, pr.head.sha]);
  git(repository, ['merge-base', '--is-ancestor', pr.merge_commit_sha, 'HEAD']);
  assert(git(repository, ['show', `${pr.head.sha}:${relative}`]).equals(readFileSync(join(repository, relative))), 'Release plan changed after its reviewed PR');
  const tag = await api(`/git/ref/tags/${plan.tag}`, { allowMissing: true });
  const object = tag ? (tag.object.type === 'tag' ? (await api(`/git/tags/${tag.object.sha}`)).object : tag.object) : null;
  let release = await findRelease(plan.tag);
  const head = git(repository, ['rev-parse', 'HEAD']).toString().trim(), releaseCommit = releaseCommitFor(head, object, release);
  git(repository, ['merge-base', '--is-ancestor', pr.merge_commit_sha, releaseCommit]);
  git(repository, ['merge-base', '--is-ancestor', releaseCommit, head]);
  assert(git(repository, ['show', `${releaseCommit}:${relative}`]).equals(readFileSync(join(repository, relative))), 'Publishing revision contains a different release plan');
  evidence.publication = { commit: releaseCommit, workflow: `https://github.com/${REPOSITORY}/blob/${releaseCommit}/.github/workflows/plugin-api1-release.yml`, trigger: 'main branch workflow after merged PR and successful exact-head checks' };
  files.set('review.json', Buffer.from(JSON.stringify(evidence, null, 2) + '\n'));
  if (release) {
    await preserveRecordedReview(release, plan, pr, files, releaseCommit);
  }
  if (release && !release.draft) {
    assert(release.prerelease, 'Existing release is not a prerelease'); validateAssets(release, files);
    console.log(`Already published with the reviewed digests: ${release.html_url}`); return;
  }
  // Historical releases retain their original record. Every new publication
  // now needs a semantic review completed before merge, not a late comment.
  assert(evidence.automated.every(check => Number.isFinite(Date.parse(check.completedAt)) && Date.parse(check.completedAt) <= Date.parse(pr.merged_at)), 'Required static checks must finish before merge');
  evidence.semantic = await readSemanticReview(pr, reviews, api, graphql);
  evidence.publication.trigger = 'main branch workflow after merged PR, completed pre-merge exact-head semantic review and static checks';
  if (release?.assets.some(asset => asset.name === 'review.json')) {
    const recorded = JSON.parse(files.get('review.json'));
    assert(JSON.stringify(recorded.semantic) === JSON.stringify(evidence.semantic), 'Draft semantic evidence changed; refusing to replace its review record');
  } else files.set('review.json', Buffer.from(JSON.stringify(evidence, null, 2) + '\n'));
  if (!release) {
    if (!tag) assert((await api('/git/ref/heads/main')).object.sha === head, 'Main advanced during publication; rerun at its current revision');
    release = await api('/releases', { method: 'POST', body: JSON.stringify({ tag_name: plan.tag, target_commitish: releaseCommit, name: plan.title, draft: true, prerelease: true, make_latest: 'false', body: `Development plugin packages for the matching API 1 host.\n\nAutomatically published after [PR #${plan.pullRequest}](${pr.html_url}) completed its exact-head semantic review and static checks before merge. [Semantic review record](${evidence.semantic.url}); decision: ${evidence.semantic.decision}, kind: ${evidence.semantic.kind}. Fixed package source: ${plan.sourceCommit}. Publishing revision/tag: ${releaseCommit}.\n\nSee review.json for actual check URLs, review identities and timestamps; human review: ${evidence.human.status}. Automated review does not certify runtime behavior or safety. Existing stable 0.1.4 catalog metadata is unchanged.\n\nVerify SHA256SUMS and official-plugins.lock.json before installation. application-official-plugins.lock.json pins the archive and every package tree.` }) });
  }
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
  if (mode === '--review-check') {
    const number = Number(process.argv[4]); assert(Number.isSafeInteger(number) && number > 0 && process.env.GITHUB_TOKEN, 'Use --review-check repository pull-request-number with a read token');
    const pr = await api(`/pulls/${number}`);
    assert(pr.base.ref === 'main' && pr.head.repo.full_name === REPOSITORY, 'Review check requires a repository PR targeting main');
    await trustedChecks(pr);
    console.log(JSON.stringify(await readSemanticReview(pr, await allReviews(number), api, graphql), null, 2)); return;
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
