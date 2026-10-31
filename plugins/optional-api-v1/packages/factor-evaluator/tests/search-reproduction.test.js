import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareDataset } from '../engine.js';
import { evaluateCandidate } from '../diagnostics.js';
import { evaluateSearchDiagnostics } from '../search-diagnostics.js';
import { inputDigest } from '../evaluator.js';

test('portable reproduction recomputes the complete numerical search and detects removal of an unselected loser', async () => {
  const iso = day => new Date(Date.UTC(2024, 0, day)).toISOString(), rows = [], prices = [100, 100, 100, 100];
  for (let day = 1; day <= 65; day++) for (let s = 0; s < 4; s++) {
    rows.push({ time: iso(day), availableAt: iso(day), symbol: `S${s}`, fields: { close: prices[s], signal: s, noise: (s + day) % 4 } });
    prices[s] *= 1 + (s - 1.5) * (.002 + .0005 * Math.sin(day));
  }
  const dataset = prepareDataset(rows, { trainEnd: iso(16), validationEnd: iso(49), holdoutEnd: iso(65), costBps: 0 });
  const candidates = { winner: { op: 'field', name: 'signal' }, loser: { op: 'neg', args: [{ op: 'field', name: 'signal' }] }, noise: { op: 'field', name: 'noise' } };
  const requested = { dsr: true, pbo: { blocks: 4 } }, trials = [];
  for (const [id, candidate] of Object.entries(candidates)) trials.push({ id, candidate, metrics: await evaluateCandidate(dataset, candidate, { diagnostics: requested }) });
  const diagnostics = await evaluateSearchDiagnostics(dataset, candidates, requested);
  assert.equal(diagnostics.dsr.status, 'completed'); assert.equal(diagnostics.pbo.status, 'completed');
  const data = { sourceId: 'synthetic-search-test', digest: inputDigest(dataset, { sourceId: 'synthetic-search-test' }) };
  const run = { id: 'synthetic-search-test', data, trials, selection: { trialIds: ['winner'], diagnostics, failedTrials: [] }, holdout: {} };
  const directory = await mkdtemp(join(tmpdir(), 'sesame-search-reproduce-'));
  try {
    const runPath = join(directory, 'run.json'), datasetPath = join(directory, 'dataset.json');
    await writeFile(datasetPath, JSON.stringify({ dataset, dataDigest: data.digest, holdoutSealed: false }));
    const reproduce = async value => {
      await writeFile(runPath, JSON.stringify(value));
      return spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/reproduce.mjs', import.meta.url)), runPath, datasetPath], { encoding: 'utf8' });
    };
    const original = await reproduce(run);
    assert.equal(original.status, 0, original.stderr); assert.equal(JSON.parse(original.stdout).searchDiagnosticsVerified, true);
    const missingLoser = await reproduce({ ...run, trials: trials.filter(trial => trial.id !== 'loser') });
    assert.notEqual(missingLoser.status, 0); assert.match(missingLoser.stderr, /Complete-search diagnostics differ/);
    const changed = structuredClone(run); changed.selection.diagnostics.dsr.byTrial.winner.probability = .1234;
    const fabricated = await reproduce(changed);
    assert.notEqual(fabricated.status, 0); assert.match(fabricated.stderr, /Complete-search diagnostics differ/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
