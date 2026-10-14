// SPDX-License-Identifier: GPL-3.0-only
import { array, check, finite, instant, integer, parameters, runCli, text, validateInput } from './runtime.mjs';

const allowed = ['task', 'learning_rate', 'iterations', 'l2'];
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, z))));

function dot(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
function vec(features, names, prefix) {
  check(features && typeof features === 'object' && !Array.isArray(features), `${prefix}: object required`);
  return names.map(n => finite(features[n], `${prefix}.${n}`, -1e18, 1e18));
}

export function analyze(input) {
  validateInput(input);
  const p = parameters(input, allowed);
  const task = p.task ?? 'regression';
  check(['regression', 'logistic'].includes(task), 'task: regression or logistic required');
  const lr = p.learning_rate === undefined ? 0.05 : finite(p.learning_rate, 'learning_rate', 1e-6, 1);
  const iterations = p.iterations === undefined ? 500 : integer(p.iterations, 'iterations', 1, 10000);
  const l2 = p.l2 === undefined ? 0.01 : finite(p.l2, 'l2', 0, 1000);
  const names = array(input.feature_names, 'feature_names', 1, 50).map((n, i) => text(n, `feature_names[${i}]`));
  check(new Set(names).size === names.length, 'feature_names: duplicates are not allowed');
  const rows = array(input.rows, 'rows', 2, 20000).map((row, i) => {
    check(row && typeof row === 'object' && !Array.isArray(row), `rows[${i}]: object required`);
    const time = instant(row.time, `rows[${i}].time`);
    const avail = instant(row.available_at, `rows[${i}].available_at`);
    const labelAvail = instant(row.label_available_at, `rows[${i}].label_available_at`);
    check(time <= avail && avail <= labelAvail && labelAvail <= Date.parse(input.as_of), `rows[${i}]: chronology invalid`);
    check(avail <= time, `rows[${i}]: feature available_at must be no later than row.time decision point`);
    check(['train', 'eval'].includes(row.split), `rows[${i}].split: train or eval required`);
    const label = finite(row.label, `rows[${i}].label`, -1e18, 1e18);
    if (task === 'logistic') check(label === 0 || label === 1, `rows[${i}].label: logistic label must be 0 or 1`);
    return { id: row.id ?? `row-${i}`, split: row.split, time, label_at: labelAvail, time_text: row.time, x: vec(row.features, names, `rows[${i}].features`), y: label };
  }).sort((a, b) => a.time - b.time);
  check(new Set(rows.map(r => r.id)).size === rows.length, 'rows: duplicate id');
  check(new Set(rows.map(r => r.time_text)).size === rows.length, 'rows: duplicate time');
  const train = rows.filter(r => r.split === 'train');
  const evalRows = rows.filter(r => r.split === 'eval');
  check(train.length >= 2 && evalRows.length >= 1, 'At least two train rows and one eval row required');
  check(Math.max(...train.map(r => r.time)) < Math.min(...evalRows.map(r => r.time)), 'Evaluation rows must be chronologically after training rows');
  check(Math.max(...train.map(r => r.label_at)) < Math.min(...evalRows.map(r => r.time)), 'All training labels must be available before the first evaluation decision time');
  check(train.length * (names.length + 1) * iterations <= 5_000_000, 'Training budget exceeds 5,000,000 row-feature-iterations');
  const means = names.map((_, j) => mean(train.map(r => r.x[j])));
  const scales = names.map((_, j) => Math.sqrt(mean(train.map(r => (r.x[j] - means[j]) ** 2))) || 1);
  const scale = x => [1, ...x.map((v, j) => (v - means[j]) / scales[j])];
  const trainScaled = train.map(r => ({ x: scale(r.x), y: r.y }));
  const evalScaled = evalRows.map(r => ({ ...r, sx: scale(r.x) }));
  const w = Array(names.length + 1).fill(0);
  for (let it = 0; it < iterations; it++) {
    const grad = Array(w.length).fill(0);
    for (const r of trainScaled) {
      const pred = task === 'logistic' ? sigmoid(dot(w, r.x)) : dot(w, r.x);
      const err = pred - r.y;
      for (let j = 0; j < w.length; j++) grad[j] += err * r.x[j] / train.length;
    }
    for (let j = 1; j < w.length; j++) grad[j] += l2 * w[j];
    for (let j = 0; j < w.length; j++) w[j] -= lr * grad[j];
  }
  const predict = r => task === 'logistic' ? sigmoid(dot(w, r.sx)) : dot(w, r.sx);
  const predictions = evalScaled.map(r => ({ time: r.time_text, prediction: predict(r), actual: r.y }));
  const mse = mean(predictions.map(r => (r.prediction - r.actual) ** 2));
  const accuracy = task === 'logistic' ? mean(predictions.map(r => (r.prediction >= 0.5 ? 1 : 0) === r.actual ? 1 : 0)) : null;
  return {
    parameters: { task, learning_rate: lr, iterations, l2, feature_names: names },
    observations: {
      train_rows: train.length,
      eval_rows: evalRows.length,
      scaler: Object.fromEntries(names.map((n, i) => [n, { mean: means[i], scale: scales[i] }])),
      coefficients: { intercept: w[0], weights: Object.fromEntries(names.map((n, i) => [n, w[i + 1]])) },
      chronological_eval: { predictions, mse, accuracy },
    },
    limitations: [
      'Scaling and coefficients are fit on training rows only; prediction does not refit hidden state.',
      'Evaluation is chronological and should not be described as out-of-sample unless the supplied split truly represents future unseen data.',
      'This small linear baseline is for reproducible comparison, not a production model-selection framework.',
    ],
  };
}

runCli(import.meta.url, analyze);
