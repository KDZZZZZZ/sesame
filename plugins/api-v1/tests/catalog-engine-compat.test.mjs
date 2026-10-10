import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCatalog } from '../scripts/catalog.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });
const jsonAt = (commit, path) => JSON.parse(git(['show', `${commit}:${path}`]));
// Published releases are immutable regression fixtures, independent of whichever
// catalog sources are selected later. Candidate plugin factories are not loaded.
const mixedSources = { schemaVersion: 1, releases: [
  { tag: 'plugins-api-v1-dev.17', releaseCommit: '3b518d6cd6ba57f945fc465da1d7c2f438a20203', reviewSha256: 'b136da7798e41a847696e8d4a2921bf50c2709f5f1b3b1838c461b56eb7b6538' },
  { tag: 'plugins-optional-api-v1-dev.11', releaseCommit: '3b518d6cd6ba57f945fc465da1d7c2f438a20203', reviewSha256: 'c1d150de9173000d8052a205c7b5704e2794f0813818490dcef82f4697b0c754' },
], withdrawn: [] };
const uniformSources = { schemaVersion: 1, releases: [
  { tag: 'plugins-api-v1-dev.16', releaseCommit: '28e457777d94924f847bf1717713300100fece65', reviewSha256: '5937611dcea1f3b7a6aecb9582aa80ab62ea2be1fbc84e63d5020a3c85189d17' },
  { tag: 'plugins-optional-api-v1-dev.10', releaseCommit: '28e457777d94924f847bf1717713300100fece65', reviewSha256: '35740ab340391b0876777a51d89f0c1a845bbe47bafde761fd3b88e52069ec33' },
], withdrawn: [] };
let mixed;
const mixedCatalog = () => mixed ??= buildCatalog(root, mixedSources);
const fetchCatalog = catalog => async () => new Response(JSON.stringify(catalog));
const installedReaderSource = '8445b44ac846c6f63b71a99d64e0d8486ca7fa88';
const reader = import(`data:text/javascript;base64,${git(['show', `${installedReaderSource}:plugins/api-v1/packages/plugin-manager/catalog.js`]).toString('base64')}`);

test('a uniform released profile retains its summary and all previous catalog bytes', () => {
  const actual = buildCatalog(root, uniformSources);
  // The currently published homogeneous directory is fixed in this commit.
  const expected = jsonAt('3b518d6cd6ba57f945fc465da1d7c2f438a20203', 'plugins/api-v1/catalog.json');
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual.releases.map(r => [r.profile, r.engines.sesame]), [['core', '>=0.2.0-0'], ['optional', '>=0.2.0-0']]);
});

test('mixed package minima omit only the misleading release summary; actual ranges and pins survive', () => {
  const catalog = mixedCatalog();
  assert.equal(catalog.plugins.length, 32);
  assert.equal(catalog.releases[0].profile, 'core');
  assert.deepEqual(catalog.releases[0].engines, { sesame: '>=0.2.0-0' });
  assert.equal(Object.hasOwn(catalog.releases[1], 'profile'), false);
  assert.equal(Object.hasOwn(catalog.releases[1], 'engines'), false);
  for (const selected of mixedSources.releases) {
    const release = catalog.releases.find(r => r.tag === selected.tag);
    const plan = jsonAt(selected.releaseCommit, `.github/plugin-releases/${selected.tag}.json`);
    const lock = jsonAt(plan.sourceCommit, `${plan.sourceRoot}/official-plugins.lock.json`);
    const base = `https://github.com/KDZZZZZZ/sesame/releases/download/${plan.tag}`;
    assert.equal(release.releaseCommit, selected.releaseCommit);
    assert.equal(release.sourceCommit, plan.sourceCommit);
    assert.equal(release.sourceRoot, plan.sourceRoot);
    assert.deepEqual(release.archive, { url: `${base}/${plan.archive.name}`, sha256: plan.archive.sha256 });
    assert.deepEqual(release.lock, { url: `${base}/official-plugins.lock.json`, sha256: plan.lockSha256 });
    assert.deepEqual(release.review, { url: `${base}/review.json`, sha256: selected.reviewSha256 });
    for (const pkg of lock.packages) {
      const entry = catalog.plugins.find(p => p.id === pkg.id);
      const manifest = jsonAt(plan.sourceCommit, `${entry.source.path}/plugin.json`);
      assert.deepEqual(entry.engines, manifest.extensions?.['bot.sesame']?.engines ?? manifest.engines);
      assert.equal(entry.distribution, plan.profile);
      assert.equal(entry.source.commit, plan.sourceCommit);
      assert.equal(entry.version, pkg.version);
      assert.deepEqual(entry.package, { treeDigest: pkg.treeDigest, files: pkg.files });
      assert.deepEqual(entry.review.record, release.review);
    }
  }
  assert.deepEqual(catalog.plugins.find(p => p.id === 'sesame/manual-trading').engines, { sesame: '>=0.2.1' });
});

test('the already-published reader can query all 32 entries and core updates without updating itself', async () => {
  const { readCatalog, catalogQuery } = await reader;
  const catalog = mixedCatalog();
  const broken = structuredClone(catalog);
  Object.assign(broken.releases[1], { profile: 'optional', engines: { sesame: '>=0.2.0-0' } });
  await assert.rejects(readCatalog(undefined, fetchCatalog(broken)), { code: 'CATALOG_INVALID' }, 'Control reproduces the pre-fix bootstrap failure');
  const fetcher = fetchCatalog(catalog);
  assert.equal((await readCatalog(undefined, fetcher)).catalog.plugins.length, 32);
  for (const entry of catalog.plugins) {
    const result = await catalogQuery({ plugin_id: entry.id }, undefined, fetcher);
    assert.deepEqual(result.items.map(p => [p.id, p.version, p.engines]), [[entry.id, entry.version, entry.engines]]);
  }
  for (const [id, version] of [['configuration', '2.0.3'], ['orchestration', '2.1.3'], ['workspace', '1.1.1']]) {
    assert.equal((await catalogQuery({ plugin_id: `sesame/${id}` }, undefined, fetcher)).items[0].version, version);
  }
});

const hostRoot = process.env.SESAME_HOST_ROOT;
test('real host install admission still rejects manual on 0.2.0 while accepting compatible core packages', { skip: !hostRoot }, async () => {
  // Data-only entry point used by the real plugin manager for test/install/update.
  // This creates no application state and invokes no model, provider or broker.
  const { inspectPackage } = await import(pathToFileURL(join(hostRoot, 'modules/agent/plugin-system/package.js')));
  const catalog = mixedCatalog();
  const filesFor = entry => Object.fromEntries(entry.package.files.map(file => [file.path, git(['show', `${entry.source.commit}:${entry.source.path}/${file.path}`])]));
  const manual = catalog.plugins.find(p => p.id === 'sesame/manual-trading'), files = filesFor(manual);
  assert.throws(() => inspectPackage(files, { applicationVersion: '0.2.0' }), { code: 'plugin_host_incompatible', status: 409 });
  const accepted = inspectPackage(files, { applicationVersion: '0.2.1' });
  assert.equal(accepted.id, manual.id); assert.equal(accepted.digest, manual.package.treeDigest);
  for (const entry of catalog.plugins.filter(p => p.distribution === 'core')) {
    const inspected = inspectPackage(filesFor(entry), { applicationVersion: '0.2.0' });
    assert.equal(inspected.id, entry.id); assert.equal(inspected.digest, entry.package.treeDigest);
    assert.deepEqual(inspected.engines, entry.engines);
  }
});
