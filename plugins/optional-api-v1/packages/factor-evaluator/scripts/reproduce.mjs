import { readFile } from 'node:fs/promises';
import { prepareDataset, evaluateFactor } from '../engine.js';
import { evaluateCandidate, evaluateDiagnostics } from '../diagnostics.js';
import { evaluateSearchDiagnostics } from '../search-diagnostics.js';
import { canonical, check, inputDigest } from '../evaluator.js';
const [runPath, dataPath] = process.argv.slice(2);
check(runPath && dataPath, 'Usage: node scripts/reproduce.mjs <run.json> <run.dataset.json>');
const run = JSON.parse(await readFile(runPath, 'utf8')), frozen = JSON.parse(await readFile(dataPath, 'utf8'));
check(!frozen.holdoutSealed, 'This unfinished archive excludes holdout rows; use a final archive');
const dataset = prepareDataset(frozen.dataset.rows, frozen.dataset.config, { developmentOnly: frozen.dataset.access === 'development-only' });
check(inputDigest(dataset, run.data) === run.data.digest && frozen.dataDigest === run.data.digest, 'Frozen input digest differs');
let count = 0;
for (const trial of run.trials.filter(t => t.metrics)) {
  const measured = await evaluateCandidate(dataset, trial.candidate ?? trial.expression, { diagnostics: trial.metrics.diagnosticPlan });
  check(canonical(measured) === canonical(trial.metrics), `Development metrics differ: ${trial.id}`); count++;
}
const selection = run.selection?.evaluation ?? run.selection;
if (selection?.diagnostics) {
  const trials = Object.fromEntries(run.trials.filter(trial => trial.metrics).map(trial => [trial.id, trial.candidate ?? trial.expression]));
  const requested = run.evaluation?.contract?.diagnosticPlan ?? run.trials.find(trial => trial.metrics)?.metrics.diagnosticPlan ?? {};
  const measured = await evaluateSearchDiagnostics(dataset, trials, requested, { failedTrials: selection.failedTrials ?? [] });
  check(canonical(measured) === canonical(selection.diagnostics), 'Complete-search diagnostics differ');
}
for (const trialId of Object.keys(run.holdout ?? {})) {
  check(run.selection?.trialIds.includes(trialId), 'Holdout result is outside frozen selection');
  const trial = run.trials.find(t => t.id === trialId);
  const measured = evaluateFactor(dataset, trial.candidate ?? trial.expression, { holdout: true }).holdout;
  if (run.holdout[trialId].diagnostics?.outOfSample) measured.diagnostics = { outOfSample: (await evaluateDiagnostics(dataset,
    trial.candidate ?? trial.expression, { outOfSample: trial.metrics.diagnosticPlan.outOfSample }, { finalized: true })).outOfSample };
  check(canonical(measured) === canonical(run.holdout[trialId]), `Holdout metrics differ: ${trialId}`);
}
process.stdout.write(JSON.stringify({ verified: true, runId: run.id, experiments: count, searchDiagnosticsVerified: Boolean(selection?.diagnostics), holdoutCount: Object.keys(run.holdout ?? {}).length, evaluatorVersion: dataset.evaluatorVersion }) + '\n');
