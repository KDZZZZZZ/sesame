// Read-only opt-in verification of the already-frozen public BTC fixture. Never
// fetches market data, executes its Python, writes the daily workspace or opens
// user configuration. Outputs, if requested, go only to the supplied audit dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { matchHistorical } from '../packages/historical-evidence/src/match.js';
import { calibrateHistorical } from '../packages/historical-evidence/src/calibrate.js';

const directory = process.env.SESAME_BTC_HISTORY_FIXTURE_DIR;
const receipts = process.env.SESAME_BTC_HISTORY_RECEIPT_DIR;
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const DAY = 86400000;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} differs from ${b}`);

test('fixed public BTC replay adapts chronology only and independently reproduces features, original scores and both result groups', { skip: !directory }, async () => {
  const originals = new Map();
  const read = async path => { const bytes = await readFile(join(directory, path)); originals.set(path, bytes); return JSON.parse(bytes); };
  const match = (await read('match-input.json'))[0], calibration = (await read('calibration-input.json'))[0];
  const components = (await read('match-components.json'))[0], audit = (await read('replay-audit.json'))[0];
  const scores = await read('scores.json'), plan = (await read('plan.json'))[0], code = (await read('code.json'))[0];
  const source = (await read('inputs/' + match.source_refs[0].id + '.json'))[0];
  const bytes = Buffer.from(source.raw_response_base64, 'base64');
  assert.equal(hash(bytes), source.raw_sha256);
  assert.equal(hash(await readFile(join(directory, 'replay.py'))), code.sha256);
  assert.equal(hash(Buffer.from(code.source)), code.sha256);
  const bars = JSON.parse(bytes), close = bars.map(row => Number(row[4])), times = bars.map(row => row[6]);
  assert.equal(bars.length, 731); assert.equal(match.cases.length, 118); assert.equal(scores.length, 100);
  const features = index => {
    const prices = close.slice(index - 19, index + 1), mean = prices.reduce((a, b) => a + b, 0) / 20;
    const slope = prices.reduce((a, b, i) => a + (i - 9.5) * (b - mean), 0) / prices.reduce((a, _, i) => a + (i - 9.5) ** 2, 0);
    const returns = Array.from({ length: 20 }, (_, i) => close[index - 19 + i] / close[index - 20 + i] - 1);
    const average = returns.reduce((a, b) => a + b, 0) / 20;
    return { trend20: slope * 20 / close[index], vol20: Math.sqrt(returns.reduce((a, b) => a + (b - average) ** 2, 0) / 20) };
  };
  const fs = new Map(times.map((_, i) => i >= 20 ? [i, features(i)] : [i, null]));
  const regime = f => f.vol20 >= .025 ? 'high_vol' : 'low_vol';
  const distance = (a, b) => Math.sqrt(((a.trend20 - b.trend20) / .10) ** 2 / 2 + ((a.vol20 - b.vol20) / .015) ** 2 / 2);
  const iso = ms => new Date(ms).toISOString(), caseId = i => 'case-' + iso(times[i]).slice(0, 10);
  const candidates = Array.from({ length: 118 }, (_, i) => 20 + i * 6);
  for (let n = 0; n < candidates.length; n++) {
    const i = candidates[n], row = match.cases[n];
    assert.equal(row.id, caseId(i)); assert.equal(row.at, iso(times[i]));
    assert.equal(row.outcome.label, Number(close[i + 5] > close[i]));
    assert.equal(row.outcome.end_at, iso(times[i] + 5 * DAY));
    for (const key of ['trend20', 'vol20']) near(row.features[key].value, fs.get(i)[key]);
  }
  const independentlyScored = [];
  for (let i = 120; i < bars.length - 5; i += 6) {
    const training = candidates.filter(j => times[j + 5] <= Math.min(times[i], Date.parse(plan.fit_end)) && times[j] < times[i] && regime(fs.get(j)) === regime(fs.get(i)));
    const matched = training.filter(j => distance(fs.get(i), fs.get(j)) <= 1);
    const recent = matched.filter(j => times[j] >= times[i] - 90 * DAY);
    const chosen = (recent.length >= 8 ? recent : matched).sort((a, b) => distance(fs.get(i), fs.get(a)) - distance(fs.get(i), fs.get(b)) || times[b] - times[a] || a - b).slice(0, 20);
    if (!chosen.length) continue;
    independentlyScored.push({ id: 'replay-' + iso(times[i]).slice(0, 10), score: (chosen.filter(j => close[j + 5] > close[j]).length + 1) / (chosen.length + 2), ids: chosen.map(caseId) });
  }
  assert.equal(independentlyScored.length, scores.length);
  for (let i = 0; i < scores.length; i++) {
    assert.equal(independentlyScored[i].id, scores[i].id); near(independentlyScored[i].score, scores[i].probability);
    assert.deepEqual(independentlyScored[i].ids, scores[i].training_case_ids);
    assert.equal(calibration.records[i].probability, scores[i].probability);
    assert.equal(calibration.records[i].outcome.label, scores[i].label);
    assert.equal(calibration.records[i].replay.training_label_cutoff, scores[i].training_label_cutoff);
  }

  // This input's UTC source has exactly microsecond precision. Round observation
  // upward, never backward; retain the original string and exact 611us delta.
  const observedOriginal = source.metadata.retrieved_at;
  const parsed = observedOriginal.match(/^(.*T\d{2}:\d{2}:\d{2})\.(\d{6})\+00:00$/);
  assert.ok(parsed, 'Explicit UTC six-decimal source expected; no implicit parser adaptation');
  const micros = Number(parsed[2]), millis = Math.ceil(micros / 1000), observed = iso(Date.parse(parsed[1] + 'Z') + millis);
  const deltaMicros = millis * 1000 - micros;
  assert.equal(deltaMicros, 611);
  assert.ok(Date.parse(observed) <= Date.parse(components.actual_generated_at));
  const adapted = structuredClone(match);
  adapted.origin = 'historical_replay'; adapted.replay = { generated_at: components.actual_generated_at, observed_at: observed,
    code_ref: match.source_refs[1], data_refs: [match.source_refs[0]], source_vintage: 'current_snapshot_not_point_in_time' };
  adapted.query.replay = { feature_cutoff: adapted.query.at };
  for (const row of adapted.cases) {
    row.replay = { feature_cutoff: row.at, outcome_available_at: row.outcome.available_at };
    row.outcome.available_at = observed;
  }
  assert.deepEqual(adapted.plan, match.plan, 'No plan, scale, threshold or cohort change');
  assert.equal(adapted.query.at, match.query.at);
  assert.ok(adapted.plan.features.every(feature => !Object.hasOwn(feature, 'tolerance')));
  const result = matchHistorical(adapted);
  const queryFeatures = fs.get(bars.length - 1);
  for (const scope of result.cohorts.filter(scope => scope.id !== 'comparable_instruments')) {
    for (const group of scope.groups) {
      const population = candidates.filter(i => regime(fs.get(i)) === group.regime_id && (scope.id !== 'same_instrument_recent' || times[i] >= times.at(-1) - 90 * DAY));
      const matches = population.filter(i => distance(queryFeatures, fs.get(i)) <= 1).sort((a, b) => distance(queryFeatures, fs.get(a)) - distance(queryFeatures, fs.get(b)) || times[b] - times[a]).slice(0, 20);
      assert.equal(group.n_eligible, population.length);
      assert.deepEqual(group.matches.map(row => row.id), matches.map(caseId));
      assert.equal(group.statistics.successes, matches.filter(i => close[i + 5] > close[i]).length);
      assert.equal(group.baseline.n, population.length);
      assert.equal(group.baseline.successes, population.filter(i => close[i + 5] > close[i]).length);
    }
  }
  assert.equal(result.forecast_probability, null);
  const adaptedCalibration = structuredClone(calibration);
  for (const row of adaptedCalibration.records) { assert.equal(row.outcome.available_at, observedOriginal); row.outcome.available_at = observed; }
  assert.deepEqual(adaptedCalibration.plan, calibration.plan);
  const calibrated = calibrateHistorical(adaptedCalibration);
  assert.equal(calibrated.status, 'exploratory'); assert.deepEqual(calibrated.current_predictions, []);
  assert.equal(calibrated.groups.reduce((n, group) => n + group.fit.n, 0), audit.split_counts.fit);
  assert.equal(calibrated.groups.reduce((n, group) => n + group.evaluation.n, 0), audit.split_counts.evaluation);
  assert.equal(calibrated.excluded.length, audit.split_counts.embargo);
  assert.ok(calibrated.groups.every(group => group.calibrated_grid === null));
  for (const [path, original] of originals) assert.deepEqual(await readFile(join(directory, path)), original);
  const receipt = { status: 'passed', packageVersion: '1.1.1', checkedAt: new Date().toISOString(), realModelCalls: 0, networkCalls: 0,
    rawResponseDigest: hash(bytes), frozenCodeDigest: code.sha256, bars: bars.length, cases: match.cases.length, scores: scores.length,
    unchanged: ['original fixture bytes', 'method plan and frozen_at', 'query.at', 'features/scales/weights/threshold', '100 scores/labels/training neighbors', 'fit/evaluation split'],
    observationAdaptation: { original: observedOriginal, adapted: observed, deltaMicroseconds: deltaMicros, policy: 'ceil-to-millisecond; original immutable source retained; no cutoff crossed' },
    selection: result.selection, matchGroups: result.cohorts.map(scope => ({ scope: scope.id, groups: scope.groups.map(group => ({ regime: group.regime_id, n: group.n_retained, successes: group.statistics.successes, baselineN: group.baseline.n })) })),
    calibrationGroups: calibrated.groups.map(group => ({ regime: group.regime_id, fitN: group.fit.n, evaluationN: group.evaluation.n, scoredN: group.evaluation.n_scored,
      metrics: group.evaluation.metrics_on_common_scored_rows, calibrated_grid: group.calibrated_grid })), excluded: calibrated.excluded,
    interpretation: 'Independent local recomputation of already-frozen public history, exploratory only. This does not update, install into, or resume the paused daily workflow.' };
  if (receipts) {
    const out = resolve(receipts), rel = relative(resolve(directory), out);
    assert.ok(rel.startsWith('..'), 'Receipt output must be outside the daily fixture tree');
    await mkdir(out, { recursive: true });
    for (const [name, value] of [['btc-replay-receipt', receipt], ['adapted-match-input', [adapted]], ['adapted-calibration-input', [adaptedCalibration]], ['match-result', result], ['calibration-result', calibrated]])
      await writeFile(join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n');
  }
});
