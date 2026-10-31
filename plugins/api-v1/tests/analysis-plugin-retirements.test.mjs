import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyAnalysisRetirements } from '../scripts/verify-analysis-retirements.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bytes = readFileSync(new URL('./fixtures/analysis-plugin-contracts.json', import.meta.url));
const review = JSON.parse(readFileSync(new URL('./fixtures/analysis-plugin-retirements.json', import.meta.url)));
const check = (value = review, directory = root, source = bytes) => verifyAnalysisRetirements(directory, source, value);

test('executable retirement proves original contracts, actual replacement, retained bytes and license without aliases', () => {
  assert.deepEqual([...check()], ['sesame/abu-backtest-lab']);
  assert.equal(review.entries[0].previousVersion, '2.0.1');
  assert.equal(review.entries[0].replacementContract.version, '2.1.0');
  assert.equal(review.entries[0].validation.numericCases, 7);
  assert.equal(existsSync(join(root, review.entries[0].sourcePath)), false);
});

test('retirement approval cannot absorb altered contracts, aliases, lost methods, unknown identities or hash drift', () => {
  for (const change of [
    value => { value.status = 'pending-review'; },
    value => { value.baselineSha256 = 'sha256:' + '0'.repeat(64); },
    value => { value.entries.push(value.entries[0]); },
    value => { value.entries[0].pluginId = 'sesame/unknown'; },
    value => { value.entries[0].decision = 'pending'; },
    value => { value.entries[0].reason = ''; },
    value => { value.entries[0].baselineVersion = '2.0.1'; },
    value => { value.entries[0].previousManifest.permissions = { scopes: ['process.execute'], calls: [] }; },
    value => { value.entries[0].previousDeclaration.capabilities[0].effects = []; },
    value => { value.entries[0].capabilityMappings = []; },
    value => { value.entries[0].capabilityMappings[0].to = 'abu_backtest_lab_analyze'; },
    value => { value.entries[0].capabilityMappings[0].afterDigest = 'sha256:' + '0'.repeat(64); },
    value => { value.entries[0].replacementContract.declarationDigest = 'sha256:' + '0'.repeat(64); },
    value => { value.entries[0].retainedFiles[0].beforeSha256 = 'sha256:' + '0'.repeat(64); },
    value => { value.entries[0].retainedFiles[0].to = '../../outside'; },
    value => { value.entries[0].retainedFiles = value.entries[0].retainedFiles.filter(file => file.role !== 'license'); },
  ]) { const changed = structuredClone(review); change(changed); assert.throws(() => check(changed)); }
  assert.throws(() => check(review, root, Buffer.concat([bytes, Buffer.from('\n')])));
});

test('reintroducing a package/binding or modifying retained numerical bytes fails even with a valid review', t => {
  const temp = mkdtempSync(join(tmpdir(), 'sesame-analysis-retirement-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const item = review.entries[0];
  for (const path of ['plugins/api-v1/inventory-policy.json', 'plugins/optional-api-v1/bundle-profile.json', 'plugins/optional-api-v1/abu-plugins.json']) {
    mkdirSync(dirname(join(temp, path)), { recursive: true }); cpSync(join(root, path), join(temp, path));
  }
  cpSync(join(root, item.replacementSourcePath), join(temp, item.replacementSourcePath), { recursive: true });
  assert.doesNotThrow(() => check(review, temp));
  mkdirSync(join(temp, item.sourcePath)); assert.throws(() => check(review, temp), /alias/); rmSync(join(temp, item.sourcePath), { recursive: true });
  const alias = join(temp, 'plugins/optional-api-v1/packages/alias/capabilities.json'); mkdirSync(dirname(alias));
  writeFileSync(alias, JSON.stringify({ capabilities: [{ id: 'unrelated', binding: { name: 'abu_backtest_lab_analyze' } }] }));
  assert.throws(() => check(review, temp), /alias/); rmSync(dirname(alias), { recursive: true });
  const algorithm = join(temp, item.replacementSourcePath, 'scripts/audit.mjs'); writeFileSync(algorithm, readFileSync(algorithm) + '\n// changed\n');
  assert.throws(() => check(review, temp), /algorithm bytes changed/);
});
