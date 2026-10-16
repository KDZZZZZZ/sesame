import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { api } from './release-plugins.mjs';
import { publicationReview } from './plugin-r2-review.mjs';
import { API2_PLAN_DIRECTORY, buildR2Publication, validateR2Plan } from './plugin-r2.mjs';

const exec = promisify(execFile);
const check = (value, message) => { if (!value) throw new Error(message); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const CATALOG_KEY = 'plugins/api-v1/catalog.json';
const ORIGIN = 'https://dl.sesame.bot';
const immutableCache = 'public, max-age=31536000, immutable';
const catalogCache = 'no-store, max-age=0';
const conditionalConflict = error => /PreconditionFailed|412|ConditionalRequestConflict|409/.test(error.stderr ?? error.message ?? '');
const contentType = key => key.endsWith('.json') ? 'application/json; charset=utf-8' : key.endsWith('.tar.gz') ? 'application/gzip' : /\.(m?js)$/.test(key) ? 'text/javascript; charset=utf-8' : /\.(md|txt)$/.test(key) ? 'text/plain; charset=utf-8' : 'application/octet-stream';

export function reviewBytes(evidence, recorded) {
  if (!recorded) return Buffer.from(JSON.stringify(evidence, null, 2) + '\n');
  const prior = JSON.parse(recorded);
  // Later informational GitHub comments do not rewrite the original record.
  // Every substantive identity, approval and pre-merge snapshot still matches.
  const stable = record => Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'reviews'));
  check(JSON.stringify(stable(prior)) === JSON.stringify(stable(evidence)), 'Recorded R2 review differs from the verified publication evidence');
  return recorded;
}

// S3 credentials remain in the workflow environment; command arguments never
// contain them. Conditional writes prevent replacing an immutable object.
export function r2Store(endpoint, bucket = 'sesame-releases') {
  check(/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint ?? ''), 'Expected the configured Cloudflare R2 account endpoint');
  const aws = args => exec('aws', ['s3api', ...args, '--bucket', bucket, '--endpoint-url', endpoint, '--no-cli-pager', '--output', 'json'], { maxBuffer: 1024 * 1024 });
  return {
    async get(key) {
      const directory = await mkdtemp(join(tmpdir(), 'sesame-r2-get-')), file = join(directory, 'object');
      try {
        let result;
        try { result = await aws(['get-object', '--key', key, file]); }
        catch (error) { if (/NoSuchKey|\(404\)/.test(error.stderr ?? '')) return null; throw error; }
        return { bytes: await readFile(file), etag: JSON.parse(result.stdout).ETag };
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    async put(key, bytes, { etag, absent = false, cacheControl = immutableCache } = {}) {
      const directory = await mkdtemp(join(tmpdir(), 'sesame-r2-put-')), file = join(directory, 'object');
      try {
        await writeFile(file, bytes);
        await aws(['put-object', '--key', key, '--body', file, '--content-type', contentType(key), '--cache-control', cacheControl,
          ...(absent ? ['--if-none-match', '*'] : ['--if-match', etag])]);
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}

export async function putImmutable(store, key, bytes) {
  check(key.startsWith('plugins/api-v1/') && key !== CATALOG_KEY && !key.split('/').some(part => !part || part === '.' || part === '..') && !key.includes('\\'), 'Unexpected immutable plugin object key');
  try { await store.put(key, bytes, { absent: true, cacheControl: immutableCache }); }
  catch (error) { if (!conditionalConflict(error)) throw error; }
  const actual = await store.get(key);
  check(actual?.bytes.equals(bytes), `Immutable R2 object differs: ${key}`);
}

function catalogSequence(catalog) {
  check(catalog?.schemaVersion === 2 && Array.isArray(catalog.releases) && catalog.releases.length === 2, 'Expected the R2 catalog');
  const revisions = catalog.releases.map(item => /^r2-(?:core|optional)-api-v1-dev\.([1-9][0-9]*)$/.exec(item.tag)?.[1]);
  check(revisions.every(value => value && value === revisions[0]) && Number.isSafeInteger(Number(revisions[0])), 'Catalog must identify one fixed R2 publication');
  return Number(revisions[0]);
}

export async function publishObjects(store, publication, { verifyPublic = async () => {}, beforePromote = async () => {}, onProgress = () => {} } = {}) {
  const { objects, catalog } = publication;
  check(catalog?.apiVersion === '2', 'New R2 publications require API 2');
  const nextBytes = Buffer.from(JSON.stringify(catalog, null, 2) + '\n');
  const previous = await store.get(CATALOG_KEY);
  const nextSequence = catalogSequence(catalog);
  if (previous) {
    const previousSequence = catalogSequence(JSON.parse(previous.bytes));
    check(nextSequence >= previousSequence, 'Refusing to roll back the public plugin catalog');
    if (nextSequence === previousSequence) check(previous.bytes.equals(nextBytes), 'A published catalog revision cannot change');
  }
  check(objects instanceof Map && objects.size > 0 && !objects.has(CATALOG_KEY), 'Build only immutable objects before catalog promotion');
  const queue = [...objects]; let cursor = 0, completed = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const [key, bytes] = queue[cursor++];
      await putImmutable(store, key, bytes);
      onProgress(++completed, queue.length);
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(8, queue.length) }, worker));
  const failed = results.find(item => item.status === 'rejected');
  if (failed) throw failed.reason;
  await verifyPublic(publication);
  await beforePromote();
  if (!previous?.bytes.equals(nextBytes)) {
    await store.put(CATALOG_KEY, nextBytes, { absent: !previous, etag: previous?.etag, cacheControl: catalogCache });
  }
  const promoted = await store.get(CATALOG_KEY);
  check(promoted?.bytes.equals(nextBytes), 'Public catalog changed during promotion');
  return { url: `${ORIGIN}/${CATALOG_KEY}`, sha256: digest(nextBytes), packages: catalog.plugins.length, objects: objects.size };
}

async function verifyPublicAssets({ objects, catalog }) {
  const keys = new Set(catalog.releases.flatMap(release => [release.archive.url, release.lock.url, release.review.url]).map(url => url.slice(ORIGIN.length + 1)));
  // Real installation reads files, so also check every manager bootstrap file.
  const manager = catalog.plugins.find(item => item.id === 'sesame/plugin-manager');
  if (manager) for (const file of manager.package.files) keys.add(`${manager.package.baseUrl.slice(ORIGIN.length + 1)}/${file.path}`);
  for (const key of keys) {
    const url = `${ORIGIN}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    check(response.ok, `Public R2 asset is unavailable: ${key} (HTTP ${response.status})`);
    check(Buffer.from(await response.arrayBuffer()).equals(objects.get(key)), `Public R2 asset differs: ${key}`);
  }
}

async function main() {
  check(process.argv[2] === '--publish', 'Use --publish [repository]');
  check(process.env.GITHUB_REPOSITORY === 'KDZZZZZZ/sesame' && process.env.GITHUB_REF === 'refs/heads/main' && /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') && process.env.GITHUB_TOKEN, 'R2 publication requires the canonical main workflow');
  const root = resolve(process.argv[3] ?? '.');
  const current = async () => {
    const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    const remote = await api('/git/ref/heads/main');
    check(head === process.env.GITHUB_SHA && remote.object.sha === head, 'A stale workflow cannot publish after main moves');
  };
  await current();
  const names = await readdir(join(root, API2_PLAN_DIRECTORY)).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const plans = names.filter(name => /^dev\.[1-9][0-9]*\.json$/.test(name)).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1]));
  if (!plans.length) { console.log('No API 2 R2 plugin publication plan'); return; }
  const planPath = `${API2_PLAN_DIRECTORY}/${plans.at(-1)}`, plan = JSON.parse(await readFile(join(root, planPath), 'utf8'));
  validateR2Plan(plan);
  check(plans.at(-1) === `${plan.id}.json`, 'Publication filename differs from its plan identity');
  const store = r2Store(process.env.R2_ENDPOINT);
  const evidence = await publicationReview(root, plan, planPath);
  const recorded = await store.get(`plugins/api-v1/releases/${plan.id}/review.json`);
  const publication = buildR2Publication(root, plan, { releaseCommit: evidence.publication.commit, review: reviewBytes(evidence, recorded?.bytes) });
  const result = await publishObjects(store, publication, { verifyPublic: verifyPublicAssets, beforePromote: current, onProgress: (done, total) => { if (done % 100 === 0 || done === total) console.log(`Verified R2 objects: ${done}/${total}`); } });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
