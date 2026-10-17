import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'KDZZZZZZ/sesame';
const PLAN_PATH = '.github/application-release.json';
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const FIRST_UPDATER_TAG = 'v0.2.4';
const SUMS = 'SHA256SUMS.txt';
const MAX_SUMS = 64 * 1024;
const MAX_TAG_ANNOTATIONS = 8;
const assert = (value, message) => { if (!value) throw new Error(message); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function fields(value, required, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...required].sort()), `${label} has missing or unknown fields`);
}
function compareStableTags(left, right) {
  const a = left.slice(1).split('.').map(BigInt), b = right.slice(1).split('.').map(BigInt);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
function assetNames(tag, schemaVersion) {
  assert(typeof tag === 'string' && STABLE_TAG.test(tag), 'Application tag must be stable vX.Y.Z');
  // Keep legacy plans verifiable without allowing new releases to omit updater assets.
  if (schemaVersion === 1) assert(compareStableTags(tag, FIRST_UPDATER_TAG) < 0, `Application releases ${FIRST_UPDATER_TAG} and later require schemaVersion 2 with update assets`);
  else assert(compareStableTags(tag, FIRST_UPDATER_TAG) >= 0, `Application schemaVersion 2 requires ${FIRST_UPDATER_TAG} or later`);
  const version = tag.slice(1);
  const names = ['INSTALL.md', `Sesame-${version}-linux-x64.AppImage`, `Sesame-${version}-linux-x64.deb`, `Sesame-${version}-mac-arm64.dmg`, `Sesame-${version}-win-x64.exe`, SUMS];
  if (schemaVersion === 2) names.push(`Sesame-${version}-win-x64.exe.blockmap`, `Sesame-${version}-linux-x64.deb.blockmap`, 'update-feed-win32-x64.yml', 'update-plan-win32-x64.json', 'update-feed-linux-x64.yml', 'update-plan-linux-x64.json');
  return names;
}

export function validateApplicationPlan(plan) {
  fields(plan, ['schemaVersion', 'repository', 'tag', 'releaseId', 'assets'], 'Application release plan');
  assert([1, 2].includes(plan.schemaVersion) && plan.repository === REPOSITORY, 'Unsupported application release schema or repository');
  assert(Number.isSafeInteger(plan.releaseId) && plan.releaseId > 0, 'Application release ID must be a positive integer');
  const expected = new Set(assetNames(plan.tag, plan.schemaVersion));
  assert(Array.isArray(plan.assets) && plan.assets.length === expected.size, `Application schemaVersion ${plan.schemaVersion} requires exactly ${expected.size} assets`);
  for (const asset of plan.assets) {
    fields(asset, ['name', 'size', 'sha256'], 'Application asset');
    assert(expected.delete(asset.name), `Unexpected or duplicate application asset: ${asset.name}`);
    assert(Number.isSafeInteger(asset.size) && asset.size > 0, `Invalid asset size: ${asset.name}`);
    assert(typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/.test(asset.sha256), `Invalid asset SHA256: ${asset.name}`);
    if (asset.name === SUMS) assert(asset.size <= MAX_SUMS, 'Checksum file exceeds its size budget');
  }
  assert(expected.size === 0, 'Application release asset is missing');
  return plan;
}

export function validateApplicationAssets(input, release) {
  const plan = validateApplicationPlan(input);
  assert(release?.id === plan.releaseId && release.tag_name === plan.tag, 'Remote release ID or tag differs from the application plan');
  assert(typeof release.draft === 'boolean' && release.prerelease === false, 'Application release must have an explicit draft state and must not be a prerelease');
  if (!release.draft) assert(Number.isFinite(Date.parse(release.published_at)), 'Published application release has no publication date');
  assert(Array.isArray(release.assets) && release.assets.length === plan.assets.length, 'Remote release asset set is incomplete or unexpected');
  const expected = new Map(plan.assets.map(asset => [asset.name, asset])), ids = new Set();
  for (const asset of release.assets) {
    const declared = expected.get(asset.name);
    assert(declared && expected.delete(asset.name), `Unexpected or duplicate remote asset: ${asset.name}`);
    assert(Number.isSafeInteger(asset.id) && asset.id > 0 && !ids.has(asset.id), 'Remote asset ID is missing or repeated');
    ids.add(asset.id);
    assert(asset.state === 'uploaded' && asset.size === declared.size && asset.digest === `sha256:${declared.sha256}`, `Remote asset bytes or upload state differ: ${asset.name}`);
  }
  return release;
}

export function validateChecksums(input, bytes) {
  const plan = validateApplicationPlan(input), checksum = plan.assets.find(asset => asset.name === SUMS);
  assert(Buffer.isBuffer(bytes) && bytes.length === checksum.size && sha256(bytes) === checksum.sha256, 'Checksum file size or SHA256 differs from the application plan');
  const expected = new Map(plan.assets.filter(asset => asset.name !== SUMS).map(asset => [asset.name, asset.sha256]));
  const lines = bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  assert(lines.length === expected.size, `Checksum file must cover exactly ${expected.size} application payloads`);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
    assert(match && expected.get(match[2]) === match[1] && expected.delete(match[2]), 'Checksum entry is missing, repeated, unexpected or differs from the application plan');
  }
  assert(expected.size === 0, 'Checksum file omitted an application payload');
}

export function assertPublicationContext(env, localSha) {
  assert(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REF === 'refs/heads/main', 'Application publication requires this repository main branch in GitHub Actions');
  assert(['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME), 'Application publication requires a main push or manual dispatch');
  assert(env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/.github/workflows/application-release.yml@refs/heads/main`, 'Application publication requires the trusted main application workflow');
  assert(typeof env.GITHUB_SHA === 'string' && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA) && localSha === env.GITHUB_SHA, 'Application publication must use the exact workflow checkout');
}

function checkLatest(plan, latest) {
  if (!latest) return;
  assert(STABLE_TAG.test(latest.tag_name) && latest.draft === false && latest.prerelease === false, 'Latest release must be a stable application version');
  if (latest.tag_name === plan.tag) assert(latest.id === plan.releaseId, 'Latest tag belongs to a different release ID');
  assert(compareStableTags(plan.tag, latest.tag_name) >= 0, 'A newer application release is already latest; refusing downgrade');
}

async function publicationTarget(plan, release, workflowSha, request) {
  const reference = await request(`/git/ref/tags/${plan.tag}`, { allowMissing: true });
  if (reference === null) {
    const target = release.target_commitish;
    assert(typeof target === 'string' && target.length > 0 && target.length <= 1024 && target.trim() === target && !['.', '..'].includes(target), 'Draft target_commitish is missing or malformed');
    const commit = await request(`/commits/${encodeURIComponent(target)}`);
    assert(commit?.sha === workflowSha, 'Draft target must resolve to the workflow commit');
    // Freeze a movable branch target before GitHub creates the missing tag.
    return { target_commitish: workflowSha };
  }
  assert(reference?.ref === `refs/tags/${plan.tag}`, 'Application tag reference is malformed or mismatched');
  let object = reference.object;
  const seen = new Set();
  for (;;) {
    assert(object && typeof object.sha === 'string' && /^[a-f0-9]{40}$/.test(object.sha) && ['commit', 'tag'].includes(object.type), 'Application tag object is malformed or does not resolve to a commit');
    if (object.type === 'commit') {
      assert(object.sha === workflowSha, 'Existing application tag must resolve to the workflow commit');
      return {};
    }
    assert(seen.size < MAX_TAG_ANNOTATIONS && !seen.has(object.sha), 'Application tag annotation chain is cyclic or exceeds its depth budget');
    seen.add(object.sha);
    const annotation = await request(`/git/tags/${object.sha}`);
    assert(annotation?.sha === object.sha, 'Application tag annotation identity differs from the requested object');
    object = annotation.object;
  }
}

/** Verification reads metadata and the small checksum file; installer bytes are never downloaded here. */
export async function releaseApplication(input, { mode, request, readChecksums, env = process.env, localSha } = {}) {
  const plan = validateApplicationPlan(input);
  assert(['verify', 'publish'].includes(mode), 'Use verify or publish for remote application checks');
  if (mode === 'publish') assertPublicationContext(env, localSha);
  const path = `/releases/${plan.releaseId}`;
  let release = validateApplicationAssets(plan, await request(path));
  validateChecksums(plan, await readChecksums(release.assets.find(asset => asset.name === SUMS)));
  const result = action => ({ action, tag: plan.tag, releaseId: plan.releaseId, published: action === 'published' });
  if (!release.draft) return result('already-published');
  if (mode === 'publish') {
    release = validateApplicationAssets(plan, await request(path));
    if (!release.draft) return result('already-published');
  }
  checkLatest(plan, await request('/releases/latest', { allowMissing: true }));
  if (mode === 'verify') return result('verified-draft');
  const target = await publicationTarget(plan, release, env.GITHUB_SHA, request);
  const main = await request('/git/ref/heads/main');
  assert(main?.object?.type === 'commit' && main.object.sha === env.GITHUB_SHA, 'Main advanced; publication must run against its current revision');
  const published = validateApplicationAssets(plan, await request(path, { method: 'PATCH', body: { draft: false, prerelease: false, make_latest: 'true', ...target } }));
  assert(published.draft === false, 'GitHub did not confirm application publication');
  return result('published');
}

async function boundedBytes(response, limit) {
  const length = response.headers.get('content-length');
  assert(length === null || /^\d+$/.test(length) && Number(length) <= limit, 'GitHub response exceeds its byte budget');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    assert(size <= limit, 'GitHub response exceeds its byte budget');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function githubClient() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const endpoint = `https://api.github.com/repos/${REPOSITORY}`;
  return {
    request: async (path, options = {}) => {
      const response = await fetch(endpoint + path, { method: options.method ?? 'GET', headers: { ...headers, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(60000) });
      if (response.status === 404 && options.allowMissing) return null;
      assert(response.ok, `GitHub application API ${path}: HTTP ${response.status}`);
      return JSON.parse((await boundedBytes(response, 2 * 1024 * 1024)).toString('utf8'));
    },
    readChecksums: async asset => {
      assert(asset.name === SUMS && asset.size <= MAX_SUMS, 'Only the bounded checksum asset may be downloaded');
      const response = await fetch(`${endpoint}/releases/assets/${asset.id}`, { headers: { ...headers, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(60000) });
      assert(response.ok, `Cannot read application checksum asset: HTTP ${response.status}`);
      return boundedBytes(response, MAX_SUMS);
    },
  };
}

async function main() {
  const [mode, directory = '.'] = process.argv.slice(2);
  assert(process.argv.length <= 4 && ['--check', '--verify', '--publish'].includes(mode), 'Use --check, --verify or --publish [repository]');
  const root = resolve(directory), bytes = readFileSync(join(root, PLAN_PATH)), plan = validateApplicationPlan(JSON.parse(bytes));
  if (mode === '--check') { console.log(JSON.stringify({ tag: plan.tag, releaseId: plan.releaseId, assets: plan.assets.length, remoteChecked: false })); return; }
  let localSha;
  if (mode === '--publish') {
    localSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    assertPublicationContext(process.env, localSha);
    assert(execFileSync('git', ['show', `${localSha}:${PLAN_PATH}`], { cwd: root }).equals(bytes), 'Application plan differs from the committed main revision');
    assert(process.env.GITHUB_TOKEN || process.env.GH_TOKEN, 'Application publication requires the workflow token');
  }
  const result = await releaseApplication(plan, { mode: mode.slice(2), ...githubClient(), localSha });
  if (mode === '--publish' && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${result.tag}\npublished=${result.published}\n`);
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
