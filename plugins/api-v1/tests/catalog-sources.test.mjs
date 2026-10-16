import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCatalog, validateCatalog, validatePublishedRelease, checkPublished } from '../scripts/catalog.mjs';
import { catalogQuery, CATALOG_URL } from '../packages/plugin-manager/catalog.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const catalogBytes = readFileSync(new URL('../catalog.json', import.meta.url));
const catalog = JSON.parse(catalogBytes);

test('the 31-entry unified directory exactly reconstructs two fixed released archives', () => {
  assert.deepEqual(validateCatalog(root), catalog);
  assert.equal(catalog.plugins.length, 31);
  assert.equal(catalog.plugins.filter(item => item.format === 'agent-plugins').length, 4);
  assert.equal(catalog.plugins.filter(item => item.distribution === 'core').length, 9);
  assert.equal(catalog.plugins.filter(item => item.distribution === 'optional').length, 22);
  for (const p of catalog.plugins) assert.equal(p.engines.sesame, '>=0.2.0-0');
  assert.deepEqual(catalog.releases.map(item => item.tag), ['plugins-api-v1-dev.15', 'plugins-optional-api-v1-dev.9']);
  for (const [id, version] of Object.entries({ 'sesame/akshare': '1.0.6', 'sesame/data-access': '2.3.1', 'sesame/orchestration': '2.1.2', 'sesame/reports': '2.0.3' })) assert.equal(catalog.plugins.find(item => item.id === id).version, version);
  const mt5 = catalog.plugins.find(item => item.id === 'sesame/mt5');
  assert.equal(mt5.version, '1.2.0'); assert.ok(mt5.tools.includes('mt5_translation_file'));
  assert.equal(mt5.package.treeDigest, 'sha256:6ae118d2bdb1c1e837c30a8fb0ec0eb51f1fecbce8f16780bb66ac0b1ac4f8d3');
  assert.equal(catalog.plugins.find(item => item.id === 'sesame/plugin-manager').version, '2.1.2', 'Only the actually released manager enters the catalog');
  assert.equal(catalog.plugins.find(item => item.id === 'sesame/quantskills-catalog').version, '2.1.0');
  assert.equal(catalog.plugins.find(item => item.id === 'sesame/ccxt').version, '1.0.2');
  assert.equal(catalog.plugins.find(item => item.id === 'sesame/ccxt').package.treeDigest, 'sha256:ba29b5dfcc1e398303587f79d1ca528ffff4273ddc264cca9296b9e203fec565');
  assert.equal(catalog.plugins.find(item => item.id === 'sesame/backtrader').license, 'GPL-3.0-or-later');
});

test('exact official/native/MCP/optional names resolve from the same fixed catalog snapshot', async () => {
  const fetcher = async url => { assert.equal(url, CATALOG_URL); return new Response(catalogBytes); };
  for (const id of catalog.plugins.map(item => item.id)) {
    const result = await catalogQuery({ plugin_id: id }, undefined, fetcher);
    assert.deepEqual(result.items.map(item => item.id), [id]); assert.match(result.catalog_digest, /^sha256:[0-9a-f]{64}$/);
  }
  for (const plugin_id of ['sesame/mt5-official', 'sesame/host-files', 'sesame/user-guide', 'sesame/research', 'sesame/technical-analysis', 'sesame/market-interpretation', 'sesame/quant-research']) {
    assert.deepEqual((await catalogQuery({ plugin_id }, undefined, fetcher)).items, [], 'Removed or old stable identities are not aliases');
  }
});

test('stable 0.1.4 and the historical optional catalog remain byte-identical to the dev12 publishing commit', () => {
  for (const path of ['plugins/catalog.json', 'plugins/optional-api-v1/catalog.json']) {
    assert.deepEqual(readFileSync(new URL(`../../../${path}`, import.meta.url)), execFileSync('git', ['show', `e35da9047d628a37f78adc2552d0799881dca6dd:${path}`], { cwd: root }));
  }
});

function metadata(release) {
  return { tag_name: release.tag, target_commitish: release.releaseCommit, draft: false, prerelease: true, published_at: '2026-10-09T22:39:52Z',
    assets: [release.archive, release.lock, release.review].map(item => ({ browser_download_url: item.url, digest: `sha256:${item.sha256}`, size: 123 })) };
}
test('publication checks refuse draft, moved commit, altered asset digest and absent review evidence', async () => {
  for (const change of [m => { m.draft = true; }, m => { m.target_commitish = 'main'; }, m => { m.assets[0].digest = 'sha256:' + '0'.repeat(64); }, m => { m.assets.pop(); }, m => { m.published_at = null; }]) {
    const actual = metadata(catalog.releases[0]); change(actual);
    assert.throws(() => validatePublishedRelease(catalog.releases[0], actual), /fixed|differs/);
  }
  const urls = [];
  await checkPublished(catalog, async (url, options) => { urls.push(url); assert.equal(options.redirect, 'error'); const release = catalog.releases.find(item => url.endsWith(item.tag)); return new Response(JSON.stringify(metadata(release))); });
  assert.equal(urls.length, 2); assert.ok(urls.every(url => url.startsWith('https://api.github.com/repos/KDZZZZZZ/sesame/releases/tags/')));
});

test('catalog generation never selects floating latest sources or silently repeats a release group', () => {
  const sources = JSON.parse(readFileSync(new URL('../catalog.sources.json', import.meta.url)));
  assert.throws(() => buildCatalog(root, { ...sources, releases: [{ ...sources.releases[0], releaseCommit: 'main' }, sources.releases[1]] }), /fixed/);
  assert.throws(() => buildCatalog(root, { ...sources, releases: [sources.releases[0], sources.releases[0]] }), /repeated/);
});
