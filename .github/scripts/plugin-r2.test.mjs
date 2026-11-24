import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProtocolFiles } from '../../plugins/protocol/package.mjs';
import { readPackageDirectory } from '../../plugins/protocol/directory.mjs';
import { buildLock, sha256 } from '../../plugins/api-v1/scripts/plugin-lock.mjs';
import { catalogPackage, readCatalogPolicy } from '../../plugins/api-v1/scripts/catalog.mjs';
import { buildR2Publication, buildR2Profile, checkR2Plans, generateR2Plan, isArchivedR2Plan, prepareR2Release, validateR2Plan } from './plugin-r2.mjs';
import { readCatalog } from '../../plugins/api-v1/packages/plugin-manager/catalog.js';

const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const git = (root, args) => execFileSync('git', ['-C', root, '-c', 'core.autocrlf=false', '-c', 'user.name=R2 test', '-c', 'user.email=r2-test@example.invalid', ...args], { encoding: 'utf8' }).trim();

function packageAt(root, sourceRoot, name, version = '1.0.0', marker = name, publisher = 'sesame') {
  const dir = join(root, sourceRoot, 'packages', name);
  mkdirSync(dir, { recursive: true });
  const manifest = { id: `${publisher}/${name}`, apiVersion: '2', version, title: name, description: `${name} fixture`, license: 'MIT',
    default_state: sourceRoot.includes('optional') ? 'discoverable' : 'mounted', entry: 'index.js',
    capability_manifest: 'capabilities.json', engines: { sesame: '>=0.2.3' } };
  json(join(dir, 'package.json'), { type: 'module', version, license: 'MIT' });
  const capability = (suffix, consumers) => ({ id: `${name.replaceAll('-', '_')}_${suffix}`, kind: 'function', description: marker,
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, consumers, execution: 'immediate', effects: [],
    binding: { type: 'native', name: suffix }, usage: { purpose: marker, inputs: 'An empty object.', outputs: 'The fixture value.', prerequisites: [], limitations: [] } });
  const capabilities = { schemaVersion: 1, apiVersion: '2', configSchema: {},
    capabilities: [capability('read', ['agent', 'host']), capability('host_only', ['host'])],
    sources: [], views: [], services: [], knowledge: [], hooks: [], stateCollections: [], artifactSchemas: [] };
  const files = createProtocolFiles(manifest, capabilities, { 'evals/cases/discovery.yaml': 'id: discovery\nenvironment: { mode: replay }\nsteps: [{ operation: server/discover }]\nexpect: [{ step: 0, pointer: /serverInfo/name, equals: ' + manifest.id + ' }]\n' });
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  writeFileSync(join(dir, 'LICENSE'), 'MIT\n');
  writeFileSync(join(dir, 'index.js'), `throw new Error('candidate code executed: ${marker}');\n`);
  writeFileSync(join(dir, 'PROVENANCE.md'), `${marker}\n`);
}

function sourceRoot(root, sourceRoot, kind, packages) {
  mkdirSync(join(root, sourceRoot, 'packages'), { recursive: true });
  json(join(root, sourceRoot, 'bundle-profile.json'), { schemaVersion: 1, kind, engines: { sesame: '>=0.2.0-0' }, discover: true, exclude: [] });
  for (const name of packages) packageAt(root, sourceRoot, name, '1.0.0', name === 'excluded' ? 'EXCLUDED_SENTINEL' : name);
  json(join(root, sourceRoot, 'official-plugins.lock.json'), buildLock(join(root, sourceRoot)));
}

function fixture(t, policy) {
  const root = mkdtempSync(join(tmpdir(), 'sesame-r2-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q']);
  sourceRoot(root, 'plugins/api-v1', 'core', ['core-one', 'core-two']);
  sourceRoot(root, 'plugins/optional-api-v1', 'optional', ['optional-one', 'excluded']);
  if (policy !== undefined) json(join(root, 'plugins/api-v1/inventory-policy.json'), policy);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixed source']);
  const sourceCommit = git(root, ['rev-parse', 'HEAD']);
  const partial = profile => buildR2Profile(root, { profile, sourceRoot: profile === 'core' ? 'plugins/api-v1' : 'plugins/optional-api-v1', sourceCommit, id: 'dev.19',
    packages: profile === 'core' ? ['sesame/core-one'] : ['sesame/optional-one'], archiveSha256: '0'.repeat(64), lockSha256: '0'.repeat(64) }, { verifyDigests: false });
  const core = partial('core'), optional = partial('optional');
  const plan = { schemaVersion: 1, id: 'dev.19', sourceCommit, pullRequest: 99, title: 'R2 fixture',
    profiles: [
      { profile: 'core', sourceRoot: 'plugins/api-v1', packages: ['sesame/core-one'], archiveSha256: core.archiveSha256, lockSha256: core.lockSha256 },
      { profile: 'optional', sourceRoot: 'plugins/optional-api-v1', packages: ['sesame/optional-one'], archiveSha256: optional.archiveSha256, lockSha256: optional.lockSha256 },
    ] };
  return { root, sourceCommit, plan };
}

test('prepare builds deterministic selected source locks and archives without candidate imports', t => {
  const { root, plan } = fixture(t);
  const first = prepareR2Release(root, plan), second = prepareR2Release(root, plan);
  assert.deepEqual(first.profiles.map(profile => [profile.profile, profile.archiveSha256, profile.lockSha256]), second.profiles.map(profile => [profile.profile, profile.archiveSha256, profile.lockSha256]));
  assert.equal(first.profiles[0].lock.packages.length, 1);
  assert.ok(first.profiles.every(profile => profile.lock.apiVersion === '2' && profile.pin.apiVersion === '2'));
  assert.equal(first.profiles[1].lock.packages.length, 1);
  assert.equal(first.profiles[1].lock.packages[0].id, 'sesame/optional-one');
  assert.doesNotMatch(first.profiles[1].archive.toString('latin1'), /EXCLUDED_SENTINEL/);
});

test('archived releases keep their existing metadata across the package format migration', () => {
  const archived = JSON.parse(readFileSync(new URL('../plugin-r2-api2/dev.11.json', import.meta.url)));
  assert.equal(isArchivedR2Plan(archived), true);
  assert.throws(() => isArchivedR2Plan({ ...archived, sourceCommit: 'a'.repeat(40) }), /immutable/);
  assert.equal(isArchivedR2Plan({ ...archived, id: 'dev.999' }), false);
});

test('release reuses the reviewed selection, explicitly includes community IDs, and pins reproducible bytes', async t => {
  const { root, plan } = fixture(t);
  const directory = join(root, '.github/plugin-r2-api2');
  mkdirSync(directory, { recursive: true });
  json(join(directory, plan.id + '.json'), plan);
  const sourceRoot = 'plugins/optional-api-v1';
  packageAt(root, sourceRoot, 'community-one', '0.1.3-dev.3.10', 'community', 'lab.tools');
  json(join(root, sourceRoot, 'official-plugins.lock.json'), buildLock(join(root, sourceRoot)));
  assert.throws(() => generateR2Plan(root, 100), /Commit package/);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'review selection and add new community source']);
  const source = git(root, ['rev-parse', 'HEAD']);
  assert.throws(() => generateR2Plan(root, 100, { include: ['lab.tools/missing'] }), /missing from/);
  // An uncommitted plan for a different PR cannot influence this selection.
  const draft = { ...plan, id: 'dev.21', pullRequest: 101, profiles: structuredClone(plan.profiles) };
  draft.profiles[1].packages.push('sesame/excluded');
  json(join(directory, 'dev.21.json'), draft);
  const generated = generateR2Plan(root, 100, { include: ['lab.tools/community-one'] });
  assert.equal(generated.plan.id, 'dev.22');
  assert.equal(generated.plan.sourceCommit, source);
  assert.deepEqual(JSON.parse(readFileSync(join(root, generated.path))), generated.plan);
  assert.deepEqual(generated.plan.profiles.map(p => p.packages), [
    ['sesame/core-one'], ['lab.tools/community-one', 'sesame/optional-one'],
  ]);
  const publication = buildR2Publication(root, generated.plan, { releaseCommit: 'b'.repeat(40), review: Buffer.from('{}') });
  const downloaded = await readCatalog(undefined, async () => new Response(JSON.stringify(publication.catalog)));
  assert.equal(downloaded.catalog.plugins.find(plugin => plugin.id === 'lab.tools/community-one').version, '0.1.3-dev.3.10');
  for (const version of ['dev', '1.2', '1.2.3-', '1.2.3-dev.1+build', 123]) {
    const invalid = structuredClone(publication.catalog);
    invalid.plugins[0].version = version;
    await assert.rejects(readCatalog(undefined, async () => new Response(JSON.stringify(invalid))), /Invalid catalog version/);
  }
  git(root, ['add', generated.path]);
  git(root, ['commit', '-qm', 'record plan']);
  assert.deepEqual(generateR2Plan(root, 100), generated);
  assert.throws(() => generateR2Plan(root, 100, { include: ['sesame/excluded'] }), /different package selection/);
});

test('publication emits API 2 capabilities, R2 catalog and immutable package file objects accepted by the manager', async t => {
  const { root, plan } = fixture(t), review = Buffer.from('{"schemaVersion":1,"ok":true}\n'), releaseCommit = 'b'.repeat(40);
  const publication = buildR2Publication(root, plan, { releaseCommit, review });
  assert.equal(publication.catalog.schemaVersion, 2);
  assert.equal(publication.catalog.apiVersion, '2');
  assert.deepEqual(publication.catalog.releases.map(release => release.tag), ['r2-core-api-v1-dev.19', 'r2-optional-api-v1-dev.19']);
  assert.equal(publication.catalog.releases[0].archive.url, 'https://dl.sesame.bot/plugins/api-v1/releases/dev.19/core/plugins.tar.gz');
  assert.ok(!('engines' in publication.catalog.releases[0]));
  assert.equal(publication.catalog.plugins.length, 2);
  for (const plugin of publication.catalog.plugins) {
    assert.equal(plugin.apiVersion, '2');
    assert.equal(plugin.capabilityManifest, 'plugin.yaml');
    assert.equal(plugin.capabilities.length, 2);
    assert.deepEqual(plugin.tools, [`${plugin.name.replaceAll('-', '_')}_read`]);
    assert.match(plugin.package.baseUrl, /^https:\/\/dl\.sesame\.bot\/plugins\/api-v1\/packages\/[a-f0-9]{64}$/);
    for (const file of plugin.package.files) assert.equal(publication.objects.has(`plugins/api-v1/packages/${plugin.package.treeDigest.slice(7)}/${file.path}`), true);
  }
  assert.equal(publication.objects.get('plugins/api-v1/releases/dev.19/review.json').equals(review), true);
  assert.equal(publication.objects.has('plugins/api-v1/releases/dev.19/core/application-official-plugins.lock.json'), true);
  assert.equal(publication.objects.has('plugins/api-v1/releases/dev.19/catalog.json'), true);
  assert.equal(sha256(publication.objects.get('plugins/api-v1/releases/dev.19/review.json')), publication.catalog.releases[0].review.sha256);
  const downloaded = await readCatalog(undefined, async () => new Response(JSON.stringify(publication.catalog)));
  assert.deepEqual(downloaded.catalog, publication.catalog);
});

test('publication carries fixed reviewed labels while package files, locks and pins keep their authority', async t => {
  const policy = { 'core-one': { functionalCategory: 'platform', implementationKinds: ['service'] },
    'optional-one': { functionalCategory: 'business', implementationKinds: ['knowledge', 'workflow'] } };
  const { root, plan } = fixture(t, policy), options = { releaseCommit: 'b'.repeat(40), review: Buffer.from('{"ok":true}\n') };
  const first = buildR2Publication(root, plan, options);
  for (const plugin of first.catalog.plugins) {
    assert.equal(plugin.functionalCategory, policy[plugin.name].functionalCategory);
    assert.deepEqual(plugin.implementationKinds, policy[plugin.name].implementationKinds);
    assert.equal(plugin.source.commit, plan.sourceCommit);
    const profile = first.profiles.find(item => item.profile === plugin.distribution);
    const indexed = profile.lock.packages.find(item => item.id === plugin.id);
    assert.equal(plugin.version, indexed.version);
    assert.equal(plugin.package.treeDigest, indexed.treeDigest);
    assert.deepEqual(plugin.package.files, indexed.files);
    assert.equal('functionalCategory' in indexed, false);
    assert.equal('implementationKinds' in profile.pin.packages.find(item => item.id === plugin.id), false);
    assert.equal(profile.archiveSha256, plan.profiles.find(item => item.profile === profile.profile).archiveSha256);
    assert.equal(profile.lockSha256, plan.profiles.find(item => item.profile === profile.profile).lockSha256);
  }
  const downloaded = await readCatalog(undefined, async () => new Response(JSON.stringify(first.catalog)));
  assert.deepEqual(downloaded.catalog, first.catalog);
  // Neither a moved HEAD nor executable candidate validators can alter fixed metadata.
  json(join(root, 'plugins/api-v1/inventory-policy.json'), { 'core-one': { functionalCategory: 'unreviewed' } });
  mkdirSync(join(root, 'plugins/api-v1/scripts'));
  writeFileSync(join(root, 'plugins/api-v1/scripts/plugin-taxonomy.mjs'), "throw new Error('candidate taxonomy executed');\n");
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'unreviewed policy']);
  assert.deepEqual(buildR2Publication(root, plan, options).objects, first.objects);
  assert.throws(() => readCatalogPolicy(root, git(root, ['rev-parse', 'HEAD'])), /invalid functional category/);
});

test('missing and legacy policies retain original catalog serialization and immutable publication objects', t => {
  for (const policy of [undefined, { 'core-one': { category: 'workspace', title: { en: 'Legacy', zh: '历史' } } }]) {
    const { root, plan } = fixture(t, policy), options = { releaseCommit: 'b'.repeat(40), review: Buffer.from('{"ok":true}\n') };
    const publication = buildR2Publication(root, plan, options);
    const originalPlugins = publication.catalog.plugins.map(plugin => {
      const profile = publication.profiles.find(item => item.profile === plugin.distribution);
      const pkg = profile.lock.packages.find(item => item.id === plugin.id);
      const path = join(root, profile.sourceRoot, 'packages', pkg.directory);
      const { manifest, capabilities, surface } = readPackageDirectory(path);
      const entry = catalogPackage(pkg, manifest, capabilities, publication.catalog.releases.find(item => item.tag === plugin.release), { surface });
      assert.equal(Object.hasOwn(plugin, 'functionalCategory'), false);
      assert.equal(Object.hasOwn(plugin, 'implementationKinds'), false);
      return { ...entry, package: { ...entry.package, baseUrl: plugin.package.baseUrl } };
    });
    const originalBytes = Buffer.from(JSON.stringify({ ...publication.catalog, plugins: originalPlugins }, null, 2) + '\n');
    assert.deepEqual(publication.objects.get('plugins/api-v1/releases/dev.19/catalog.json'), originalBytes);
    json(join(root, 'plugins/api-v1/inventory-policy.json'), { 'core-one': { functionalCategory: 'platform', implementationKinds: ['service'] } });
    assert.deepEqual(buildR2Publication(root, plan, options).objects, publication.objects);
  }
});

test('fixed policy reading rejects floating sources, malformed data and Git links without executing code', t => {
  const { root, sourceCommit } = fixture(t);
  assert.deepEqual(readCatalogPolicy(root, sourceCommit), {});
  assert.throws(() => readCatalogPolicy(root, 'HEAD'), /fixed source commit/);
  const path = 'plugins/api-v1/inventory-policy.json';
  for (const [value, message] of [['{invalid json', /JSON/], ['[]', /must be an object/],
    ['{"core-one":{"implementationKinds":["adapter","adapter"]}}', /unique supported/]]) {
    writeFileSync(join(root, path), value); git(root, ['add', path]); git(root, ['commit', '-qm', 'invalid policy data']);
    assert.throws(() => readCatalogPolicy(root, git(root, ['rev-parse', 'HEAD'])), message);
  }
  const oid = git(root, ['hash-object', '-w', path]);
  git(root, ['update-index', '--add', '--cacheinfo', `120000,${oid},${path}`]);
  git(root, ['commit', '-qm', 'linked policy data']);
  assert.throws(() => readCatalogPolicy(root, git(root, ['rev-parse', 'HEAD'])), /ordinary Git file/);
});

test('plans reject duplicate identities, wrong roots, bad paths and digest drift', t => {
  const { root, plan } = fixture(t);
  assert.equal('verifyDigests' in validateR2Plan(plan), false);
  assert.throws(() => validateR2Plan({ ...plan, id: 'latest' }), /dev\.N/);
  assert.throws(() => validateR2Plan({ ...plan, id: `dev.${Number.MAX_SAFE_INTEGER + 1}` }), /safe integer/);
  assert.throws(() => validateR2Plan({ ...plan, profiles: [{ ...plan.profiles[0], packages: Array.from({ length: 100 }, (_, i) => `sesame/package-${i}`) }, plan.profiles[1]] }), /100 packages/);
  assert.throws(() => prepareR2Release(root, { ...plan, profiles: [{ ...plan.profiles[0], sourceRoot: '../secret' }, plan.profiles[1]] }), /sourceRoot/);
  assert.throws(() => prepareR2Release(root, { ...plan, profiles: [{ ...plan.profiles[0], packages: ['sesame/core-one', 'sesame/core-one'] }, plan.profiles[1]] }), /unique/);
  assert.throws(() => prepareR2Release(root, { ...plan, profiles: [{ ...plan.profiles[0], packages: ['sesame/core-one', 'sesame/optional-one'] }, plan.profiles[1]] }), /more than one profile/);
  assert.throws(() => prepareR2Release(root, { ...plan, profiles: [{ ...plan.profiles[0], archiveSha256: 'f'.repeat(64) }, plan.profiles[1]] }), /archive digest differs/);
});

test('full immutable source lock is required before subset build', t => {
  const { root, plan } = fixture(t);
  writeFileSync(join(root, 'plugins/api-v1/packages/core-one/LICENSE'), 'changed\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'stale lock']);
  const stale = { ...plan, sourceCommit: git(root, ['rev-parse', 'HEAD']) };
  assert.throws(() => prepareR2Release(root, stale), /source lock differs/);
});

test('CLI check allows empty infrastructure and build writes deterministic object tree', t => {
  const empty = mkdtempSync(join(tmpdir(), 'sesame-r2-empty-'));
  try {
    const check = spawnSync(process.execPath, [fileURLToPath(new URL('./plugin-r2.mjs', import.meta.url)), '--check', empty], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /"plans":0/);
  } finally { rmSync(empty, { recursive: true, force: true }); }
  const { root, plan } = fixture(t), out = join(root, 'out'), review = join(root, 'review.json'), planPath = join(root, '.github/plugin-r2-api2/dev.19.json');
  mkdirSync(dirname(planPath), { recursive: true });
  json(planPath, plan);
  writeFileSync(review, '{"schemaVersion":1}\n');
  const built = spawnSync(process.execPath, [fileURLToPath(new URL('./plugin-r2.mjs', import.meta.url)), '--build', root, planPath, out, review, 'c'.repeat(40)], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(existsSync(join(out, 'plugins/api-v1/releases/dev.19/catalog.json')), true);
  assert.equal(existsSync(join(out, 'plugins/api-v1/releases/dev.19/core/plugins.tar.gz')), true);
});

test('CLI check rejects a plan filename that does not match its fixed id', t => {
  const { root, plan } = fixture(t), planPath = join(root, '.github/plugin-r2-api2/dev.10.json');
  mkdirSync(dirname(planPath), { recursive: true });
  json(planPath, plan);
  const check = spawnSync(process.execPath, [fileURLToPath(new URL('./plugin-r2.mjs', import.meta.url)), '--check', root], { encoding: 'utf8' });
  assert.notEqual(check.status, 0);
  assert.match(check.stderr, /filename must match id/);
});

test('API 2 check does not read or modify retired publication inputs', t => {
  const root = mkdtempSync(join(tmpdir(), 'sesame-r2-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const legacy = join(root, '.github/plugin-r2/dev.3.json');
  mkdirSync(dirname(legacy), { recursive: true });
  const bytes = Buffer.from('{retired plan is not current publication metadata\n');
  writeFileSync(legacy, bytes);
  const checked = spawnSync(process.execPath, [fileURLToPath(new URL('./plugin-r2.mjs', import.meta.url)), '--check', root], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /"plans":0/);
  assert.deepEqual(readFileSync(legacy), bytes);
});

test('current plans reject linked metadata before reading candidate content', t => {
  for (const mode of ['parent', 'directory', 'dangling', 'file', 'hardlink']) {
    const root = mkdtempSync(join(tmpdir(), 'sesame-r2-linked-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const outside = join(root, 'outside'), github = join(root, '.github'), plans = join(github, 'plugin-r2-api2');
    mkdirSync(outside);
    if (mode === 'parent') symlinkSync(outside, github, 'junction');
    else {
      mkdirSync(github);
      if (mode === 'directory' || mode === 'dangling') symlinkSync(mode === 'directory' ? outside : join(root, 'missing'), plans, 'junction');
      else {
        mkdirSync(plans);
        const target = join(outside, 'plan.json'); writeFileSync(target, 'must not parse linked bytes');
        if (mode === 'file') symlinkSync(target, join(plans, 'dev.5.json'));
        else linkSync(target, join(plans, 'dev.5.json'));
      }
    }
    assert.throws(() => checkR2Plans(root), /ordinary (?:files|directories)/, mode);
  }
});
