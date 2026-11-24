import { readProtocolPackage } from '../../plugins/protocol/package.mjs';
import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLock, createArchive, readProfile, sha256 } from '../../plugins/api-v1/scripts/plugin-lock.mjs';
import { materializeSource } from './release-plugins.mjs';
import { catalogPackage, readCatalogPolicy } from '../../plugins/api-v1/scripts/catalog.mjs';

const RELEASE_BASE = 'https://dl.sesame.bot/plugins/api-v1/releases';
const PACKAGE_BASE = 'https://dl.sesame.bot/plugins/api-v1/packages';
const SOURCE_ROOTS = { core: 'plugins/api-v1', optional: 'plugins/optional-api-v1' };
// Current publication plans are API 2 only; retired plans are not publication inputs.
export const API2_PLAN_DIRECTORY = '.github/plugin-r2-api2';
const assert = (value, message) => { if (!value) throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const packageId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]*\/[a-z][a-z0-9-]*$/.test(value);
const releaseId = value => /^dev\.[1-9][0-9]*$/.test(value || '');
const releaseNumber = value => {
  const match = /^dev\.([1-9][0-9]*)$/.exec(value || '');
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
};
const safeObjectPath = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('\\') && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
const git = (root, args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const canonical = value => JSON.stringify(value);

function validateProfilePlan(profile, index) {
  assert(object(profile), `Invalid profile plan at ${index}`);
  assert(['core', 'optional'].includes(profile.profile), 'Plan must contain exactly core and optional profiles');
  assert(profile.sourceRoot === SOURCE_ROOTS[profile.profile], `${profile.profile}: sourceRoot differs from profile`);
  assert(Array.isArray(profile.packages) && profile.packages.length > 0, `${profile.profile}: packages are required`);
  assert(profile.packages.every(id => packageId(id) && (profile.profile === 'optional' || id.startsWith('sesame/'))) && new Set(profile.packages).size === profile.packages.length, `${profile.profile}: packages must be explicit unique plugin IDs for the profile`);
  assert(hex(profile.archiveSha256, 64) && hex(profile.lockSha256, 64), `${profile.profile}: release digests must be fixed`);
  assert(Object.keys(profile).every(key => ['profile', 'sourceRoot', 'packages', 'archiveSha256', 'lockSha256'].includes(key)), `${profile.profile}: unknown profile field`);
  return profile;
}

export function validateR2Plan(input) {
  assert(object(input) && input.schemaVersion === 1, 'R2 plan schemaVersion must be 1');
  assert(releaseId(input.id) && releaseNumber(input.id) !== null, 'R2 plan id must be dev.N with a safe integer N');
  assert(hex(input.sourceCommit, 40), 'R2 plan requires a fixed source commit');
  assert(Number.isSafeInteger(input.pullRequest) && input.pullRequest > 0, 'R2 plan requires a positive pull request');
  assert(typeof input.title === 'string' && input.title.length > 0 && input.title.length <= 160, 'R2 plan title is invalid');
  assert(Array.isArray(input.profiles) && input.profiles.length === 2, 'R2 plan requires exactly core and optional profiles');
  const profiles = input.profiles.map(validateProfilePlan);
  assert(canonical(profiles.map(item => item.profile).sort()) === canonical(['core', 'optional']), 'R2 plan must contain one core and one optional profile');
  const ids = new Set();
  for (const profile of profiles) for (const id of profile.packages) {
    assert(!ids.has(id), `Package selected in more than one profile: ${id}`);
    ids.add(id);
  }
  assert(ids.size <= 100, 'R2 plan cannot select more than 100 packages');
  assert(Object.keys(input).every(key => ['schemaVersion', 'id', 'sourceCommit', 'pullRequest', 'title', 'profiles'].includes(key)), 'R2 plan has unknown fields');
  return { ...input, profiles: profiles.map(profile => ({ ...profile })) };
}

function materializeProfileSource(repository, sourceCommit, sourceRoot) {
  const directory = mkdtempSync(join(tmpdir(), 'sesame-r2-source-'));
  try {
    materializeSource(repository, { sourceCommit, sourceRoot }, directory);
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function checkedFullSource(repository, sourceCommit, sourceRoot) {
  const source = materializeProfileSource(repository, sourceCommit, sourceRoot);
  try {
    const lock = buildLock(source), lockBytes = jsonBytes(lock);
    assert(readFileSync(join(source, 'official-plugins.lock.json')).equals(lockBytes), `${sourceRoot}: immutable source lock differs from all source packages`);
    return { source, lock };
  } catch (error) {
    rmSync(source, { recursive: true, force: true });
    throw error;
  }
}

function buildSubsetSource(source, profilePlan, fullLock) {
  const fullById = new Map(fullLock.packages.map(pkg => [pkg.id, pkg]));
  const profile = readProfile(source);
  assert(profile?.kind === profilePlan.profile, `${profilePlan.profile}: source bundle profile is missing or mismatched`);
  const directory = mkdtempSync(join(tmpdir(), 'sesame-r2-subset-'));
  try {
    mkdirSync(join(directory, 'packages'), { recursive: true });
    const selected = new Set(profilePlan.packages);
    for (const id of profilePlan.packages) {
      const pkg = fullById.get(id);
      assert(pkg, `${profilePlan.profile}: selected package does not exist in source lock: ${id}`);
      cpSync(join(source, 'packages', pkg.directory), join(directory, 'packages', pkg.directory), { recursive: true, errorOnExist: true, force: false });
    }
    writeFileSync(join(directory, 'bundle-profile.json'), jsonBytes({ schemaVersion: profile.schemaVersion, kind: profile.kind, engines: profile.engines, packages: profilePlan.packages }));
    const lock = buildLock(directory);
    assert(canonical(lock.packages.map(pkg => pkg.id).sort()) === canonical([...selected].sort()), `${profilePlan.profile}: selected lock differs from plan`);
    const lockBytes = jsonBytes(lock), archive = createArchive(directory, lock);
    return { directory, lock, lockBytes, archive };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function readManifestEntry(profilePlan, release, pkg, classification) {
  const prefix = pkg.treeDigest.slice(7) + '/';
  const files = Object.fromEntries(pkg.files.map(file => [file.path, profilePlan.fileBytes.get(prefix + file.path)]));
  const { manifest, capabilities: declaration, surface, catalog } = readProtocolPackage(files);
  const entry = catalogPackage(pkg, manifest, declaration, release, { classification, surface, catalog });
  return { ...entry, package: { ...entry.package, baseUrl: `${PACKAGE_BASE}/${pkg.treeDigest.slice(7)}` } };
}

export function buildR2Profile(repository, input, { verifyDigests = true } = {}) {
  const sourceCommit = input.sourceCommit;
  assert(hex(sourceCommit, 40), 'Profile build requires a fixed source commit');
  const profilePlan = validateProfilePlan({ profile: input.profile, sourceRoot: input.sourceRoot, packages: input.packages, archiveSha256: input.archiveSha256, lockSha256: input.lockSha256 }, 0);
  const { source, lock: fullLock } = checkedFullSource(repository, sourceCommit, profilePlan.sourceRoot);
  let subset;
  try {
    subset = buildSubsetSource(source, profilePlan, fullLock);
    assert(subset.lock.apiVersion === '2', 'New R2 publications require API 2');
    const archiveSha256 = sha256(subset.archive), lockSha256 = sha256(subset.lockBytes);
    if (verifyDigests) {
      assert(archiveSha256 === profilePlan.archiveSha256, `${profilePlan.profile}: archive digest differs: ${archiveSha256}`);
      assert(lockSha256 === profilePlan.lockSha256, `${profilePlan.profile}: lock digest differs: ${lockSha256}`);
    }
    const pin = { schemaVersion: 1, apiVersion: '2', sourceCommit, archive: { url: `${RELEASE_BASE}/${input.id}/${profilePlan.profile}/plugins.tar.gz`, sha256: archiveSha256 },
      lockSha256, packages: subset.lock.packages.map(({ id, version, treeDigest }) => ({ id, version, treeDigest })) };
    const fileBytes = new Map();
    for (const pkg of subset.lock.packages) for (const file of pkg.files) fileBytes.set(`${pkg.treeDigest.slice(7)}/${file.path}`, readFileSync(join(subset.directory, 'packages', pkg.directory, file.path)));
    return { profile: profilePlan.profile, sourceRoot: profilePlan.sourceRoot, sourceCommit, packages: profilePlan.packages, lock: subset.lock, lockBytes: subset.lockBytes,
      archive: subset.archive, archiveSha256, lockSha256, pin, pinBytes: jsonBytes(pin), fileBytes };
  } finally {
    rmSync(source, { recursive: true, force: true });
    if (subset) rmSync(subset.directory, { recursive: true, force: true });
  }
}

export function prepareR2Release(repository, input, options = {}) {
  const plan = validateR2Plan(input);
  const profiles = plan.profiles.map(profile => buildR2Profile(repository, { ...profile, sourceCommit: plan.sourceCommit, id: plan.id }, options));
  return { plan: { schemaVersion: plan.schemaVersion, id: plan.id, sourceCommit: plan.sourceCommit, pullRequest: plan.pullRequest, title: plan.title,
    profiles: plan.profiles.map(({ profile, sourceRoot, packages, archiveSha256, lockSha256 }) => ({ profile, sourceRoot, packages, archiveSha256, lockSha256 })) }, profiles };
}

function addObject(objects, key, bytes) {
  assert(safeObjectPath(key), `Unsafe object key: ${key}`);
  const prior = objects.get(key);
  if (prior) assert(prior.equals(bytes), `Object key collision with different bytes: ${key}`);
  else objects.set(key, bytes);
}

export function buildR2Publication(repository, input, { releaseCommit, review }) {
  assert(hex(releaseCommit, 40), 'R2 publication requires a fixed release commit');
  assert(Buffer.isBuffer(review) && review.length > 0 && review.length <= 1024 * 1024, 'R2 publication requires review bytes');
  const prepared = prepareR2Release(repository, input);
  const policy = readCatalogPolicy(repository, prepared.plan.sourceCommit);
  const reviewSha256 = sha256(review), releases = [], plugins = [], objects = new Map(), root = `plugins/api-v1/releases/${prepared.plan.id}`;
  for (const profile of prepared.profiles) {
    const prefix = `${root}/${profile.profile}`, tag = `r2-${profile.profile}-api-v1-${prepared.plan.id}`;
    const release = { transport: 'r2', tag, profile: profile.profile, sourceRoot: profile.sourceRoot, sourceCommit: prepared.plan.sourceCommit, releaseCommit,
      archive: { url: `${RELEASE_BASE}/${prepared.plan.id}/${profile.profile}/plugins.tar.gz`, sha256: profile.archiveSha256 },
      lock: { url: `${RELEASE_BASE}/${prepared.plan.id}/${profile.profile}/official-plugins.lock.json`, sha256: profile.lockSha256 },
      review: { url: `${RELEASE_BASE}/${prepared.plan.id}/review.json`, sha256: reviewSha256 } };
    releases.push(release);
    addObject(objects, `${prefix}/plugins.tar.gz`, profile.archive);
    addObject(objects, `${prefix}/official-plugins.lock.json`, profile.lockBytes);
    addObject(objects, `${prefix}/application-official-plugins.lock.json`, profile.pinBytes);
    for (const [name, bytes] of profile.fileBytes) addObject(objects, `plugins/api-v1/packages/${name}`, bytes);
    for (const pkg of profile.lock.packages) plugins.push(readManifestEntry(profile, release, pkg, pkg.id === 'sesame/' + pkg.directory && Object.hasOwn(policy, pkg.directory) ? policy[pkg.directory] : undefined));
  }
  plugins.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  releases.sort((a, b) => a.profile < b.profile ? -1 : a.profile > b.profile ? 1 : 0);
  const catalog = { schemaVersion: 2, apiVersion: '2', channel: 'development', releases, plugins };
  addObject(objects, `${root}/review.json`, review);
  addObject(objects, `${root}/plan.json`, jsonBytes(prepared.plan));
  addObject(objects, `${root}/catalog.json`, jsonBytes(catalog));
  return { plan: prepared.plan, catalog, objects, profiles: prepared.profiles };
}

function listPlans(root) {
  let directory = root;
  for (const part of API2_PLAN_DIRECTORY.split('/')) {
    directory = join(directory, part);
    let stat;
    try { stat = lstatSync(directory); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'R2 plan metadata must use ordinary directories');
  }
  return readdirSync(directory).sort().filter(name => name.endsWith('.json')).map(name => {
    const path = join(directory, name), stat = lstatSync(path);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'R2 plan metadata must use ordinary files');
    return path;
  });
}

// These packages used the previous on-disk declarations. Pin the seven plans
// already published by the repository before the YAML source migration.
const archived = JSON.parse(readFileSync(new URL('./historical-r2-plans.json', import.meta.url)));

export function isArchivedR2Plan(plan) {
  if (!Object.hasOwn(archived, plan.id)) return false;
  assert(sha256(jsonBytes(plan)) === archived[plan.id], 'Archived R2 release plan is immutable: ' + plan.id);
  return true;
}

export function generateR2Plan(repository, pullRequest, { include = [] } = {}) {
  assert(Number.isSafeInteger(pullRequest) && pullRequest > 0, 'Use release --pr <positive dev-to-main PR number>');
  const plans = listPlans(repository).map(path => {
    const plan = validateR2Plan(JSON.parse(readFileSync(path)));
    assert(basename(path) === plan.id + '.json', 'Plan filename must match id');
    isArchivedR2Plan(plan);
    return plan;
  });
  assert(Array.isArray(include) && include.every(packageId) && new Set(include).size === include.length,
    'Use one --include <publisher/slug> per additional package');
  const sourceCommit = git(repository, ['rev-parse', '--verify', 'HEAD^{commit}']).toString().trim();
  const inputs = Object.values(SOURCE_ROOTS).flatMap(root =>
    ['packages', 'bundle-profile.json', 'official-plugins.lock.json'].map(file => root + '/' + file));
  inputs.push('plugins/api-v1/inventory-policy.json');
  const pending = git(repository, ['status', '--porcelain', '--untracked-files=all', '--', ...inputs]);
  assert(!pending.length, 'Commit package, profile and lock changes before generating a release plan');
  const previous = plans.find(plan => plan.pullRequest === pullRequest);
  if (previous) {
    const changed = git(repository, ['diff', '--name-only', previous.sourceCommit, sourceCommit, '--', ...inputs]);
    assert(!changed.length, 'This PR already has a plan for different package sources');
    const selected = new Set(previous.profiles.flatMap(profile => profile.packages));
    assert(include.every(id => selected.has(id)), 'This PR already has a plan with a different package selection');
    prepareR2Release(repository, previous);
    return { path: join(API2_PLAN_DIRECTORY, previous.id + '.json'), plan: previous };
  }
  // Inherit reviewed package selection from the fixed commit. Uncommitted
  // drafts reserve a number but cannot add packages to the next release.
  const tracked = git(repository, ['ls-tree', '-r', '--name-only', sourceCommit, '--', API2_PLAN_DIRECTORY])
    .toString().trim().split('\n').filter(path => /^dev\.[1-9][0-9]*\.json$/.test(basename(path)))
    .sort((a, b) => releaseNumber(basename(b, '.json')) - releaseNumber(basename(a, '.json')));
  const latest = tracked.length ? validateR2Plan(JSON.parse(git(repository, ['show', sourceCommit + ':' + tracked[0]]))) : undefined;
  const selected = latest ? new Set([...latest.profiles.flatMap(profile => profile.packages), ...include]) : undefined;
  const n = Math.max(0, ...Object.keys(archived).map(releaseNumber), ...plans.map(plan => releaseNumber(plan.id)),
    latest ? releaseNumber(latest.id) : 0) + 1;
  const id = 'dev.' + n;
  const profiles = Object.entries(SOURCE_ROOTS).map(([profile, sourceRoot]) => {
    const sourceLock = JSON.parse(git(repository, ['show', sourceCommit + ':' + sourceRoot + '/official-plugins.lock.json']));
    const packages = sourceLock.packages.map(pkg => pkg.id).filter(id => !selected || selected.has(id));
    const bytes = buildR2Profile(repository, { profile, sourceRoot, sourceCommit, packages, id,
      archiveSha256: '0'.repeat(64), lockSha256: '0'.repeat(64) }, { verifyDigests: false });
    return { profile, sourceRoot, packages, archiveSha256: bytes.archiveSha256, lockSha256: bytes.lockSha256 };
  });
  assert(include.every(id => profiles.some(profile => profile.packages.includes(id))), 'An included package is missing from the fixed source locks');
  const plan = validateR2Plan({ schemaVersion: 1, id, sourceCommit, pullRequest, title: 'Sesame plugin release ' + id, profiles });
  const path = join(API2_PLAN_DIRECTORY, id + '.json');
  mkdirSync(dirname(join(repository, path)), { recursive: true });
  writeFileSync(join(repository, path), jsonBytes(plan), { flag: 'wx' });
  return { path, plan };
}

export function checkR2Plans(repository) {
  const plans = listPlans(repository);
  for (const path of plans) {
    const plan = validateR2Plan(JSON.parse(readFileSync(path)));
    assert(basename(path) === `${plan.id}.json`, `R2 plan filename must match id: ${basename(path)}`);
    if (!isArchivedR2Plan(plan)) prepareR2Release(repository, plan);
  }
  return { plans: plans.length };
}

function writeObjects(output, objects) {
  for (const [key, bytes] of objects) {
    const target = join(output, key);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}

async function main() {
  const [mode, repositoryArg, ...rest] = process.argv.slice(2), repository = resolve(repositoryArg ?? '.');
  assert(['--check', '--build'].includes(mode), 'Use --check <repository> or --build <repository> <plan> <output> <review> <releaseCommit>');
  if (mode === '--check') {
    console.log(JSON.stringify(checkR2Plans(repository)));
    return;
  }
  const [planPath, output, reviewPath, releaseCommit] = rest;
  assert(planPath && output && reviewPath && releaseCommit, '--build requires plan path, output directory, review file and release commit');
  const publication = buildR2Publication(repository, JSON.parse(readFileSync(resolve(planPath))), { releaseCommit, review: readFileSync(resolve(reviewPath)) });
  writeObjects(resolve(output), publication.objects);
  console.log(JSON.stringify({ id: publication.plan.id, objects: publication.objects.size, catalogSha256: sha256(jsonBytes(publication.catalog)) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
