import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { copies, syncBoundaryHelpers } from '../scripts/sync-boundary-helpers.mjs';

test('all self-contained copies match their maintained sources', () => {
  assert.equal(syncBoundaryHelpers('--check'), 19);
});

test('the copy registry is explicit and excludes independent domain records', () => {
  assert.deepEqual(copies.map(({ source, targets }) => [source, targets.length]), [
    ['scripts/shared/dataset-snapshot.js', 2],
    ['scripts/shared/artifact-files.js', 2],
    ['scripts/shared/parser.js', 3],
    ['scripts/shared/workflow-mechanics.js', 3],
    ['scripts/shared/research-artifacts.js', 3],
    ['scripts/shared/investment-research-contract.js', 2],
    ['scripts/shared/report-publication.js', 2],
    ['scripts/shared/workflow-report-fixture.mjs', 2],
  ]);
  const targets = copies.flatMap(item => item.targets);
  assert.equal(new Set(targets).size, 19);
  assert.ok(targets.every(path => !path.includes('records')));
});

test('copy verification rejects drift and write repairs only the declared copies', t => {
  const directory = mkdtempSync(join(tmpdir(), 'sesame-boundary-sync-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const base = pathToFileURL(directory + '/');
  for (const { source, targets } of copies) {
    for (const file of [source, ...targets]) { mkdirSync(dirname(join(directory, file)), { recursive: true }); writeFileSync(join(directory, file), source); }
  }
  const parserServer = join(directory, 'packages/web-extract/server.py');
  const domainRecords = join(directory, 'packages/trading-decision/records.js');
  writeFileSync(parserServer, 'format-specific implementation');
  writeFileSync(domainRecords, 'intentional independent domain storage');
  assert.equal(syncBoundaryHelpers('--check', base), 19);
  writeFileSync(join(directory, copies[0].targets[1]), 'drift');
  assert.throws(() => syncBoundaryHelpers('--check', base), /Boundary helper copy differs/);
  assert.equal(syncBoundaryHelpers('--write', base), 19);
  assert.equal(syncBoundaryHelpers('--check', base), 19);
  writeFileSync(join(directory, 'packages/rss-collect/parser.js'), 'parser drift');
  assert.throws(() => syncBoundaryHelpers('--check', base), /packages\/rss-collect\/parser\.js/);
  assert.equal(syncBoundaryHelpers('--write', base), 19);
  assert.equal(readFileSync(parserServer, 'utf8'), 'format-specific implementation');
  assert.equal(readFileSync(domainRecords, 'utf8'), 'intentional independent domain storage');
});
