import { readFile } from 'node:fs/promises';
import { prepareDataset, evaluateFactor } from '../engine.js';
import { canonical, check, inputDigest } from '../evaluator.js';
const [runPath, dataPath] = process.argv.slice(2);
check(runPath && dataPath, 'Usage: node scripts/reproduce.mjs <run.json> <run.dataset.json>');
const run = JSON.parse(await readFile(runPath, 'utf8')), frozen = JSON.parse(await readFile(dataPath, 'utf8'));
check(!frozen.holdoutSealed, 'This unfinished archive excludes holdout rows; use a final archive');
const dataset = prepareDataset(frozen.dataset.rows, frozen.dataset.config, { developmentOnly: frozen.dataset.access === 'development-only' });
check(inputDigest(dataset, run.data) === run.data.digest && frozen.dataDigest === run.data.digest, 'Frozen input digest differs');
let count = 0;
for (const trial of run.trials.filter(t => t.metrics)) {
  check(canonical(evaluateFactor(dataset, trial.candidate ?? trial.expression)) === canonical(trial.metrics), `Development metrics differ: ${trial.id}`); count++;
}
for (const trialId of Object.keys(run.holdout ?? {})) {
  check(run.selection?.trialIds.includes(trialId), 'Holdout result is outside frozen selection');
  const trial = run.trials.find(t => t.id === trialId);
  check(canonical(evaluateFactor(dataset, trial.candidate ?? trial.expression, { holdout: true }).holdout) === canonical(run.holdout[trialId]), `Holdout metrics differ: ${trialId}`);
}
process.stdout.write(JSON.stringify({ verified: true, runId: run.id, experiments: count, holdoutCount: Object.keys(run.holdout ?? {}).length, evaluatorVersion: dataset.evaluatorVersion }) + '\n');
