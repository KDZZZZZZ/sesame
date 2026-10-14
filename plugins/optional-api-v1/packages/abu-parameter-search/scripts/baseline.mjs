// SPDX-License-Identifier: GPL-3.0-only
import { array, canonical, check, digest, finite, instant, integer, parameters, runCli, text, validateInput } from './runtime.mjs';

const allowed = ['phase', 'objective_metric', 'direction', 'max_grid_points'];

function values(v, name) {
  check(Array.isArray(v) && v.length >= 1 && v.length <= 100, `${name}: nonempty array <= 100 required`);
  return v.map((x, i) => {
    check(['number', 'string', 'boolean'].includes(typeof x), `${name}[${i}]: scalar number/string/boolean required`);
    check(typeof x !== 'number' || Number.isFinite(x), `${name}[${i}]: finite number required`);
    return x;
  });
}

function expand(grid, limit) {
  const keys = Object.keys(grid).sort();
  check(keys.length >= 1 && keys.length <= 10, 'grid: 1..10 parameters required');
  const lists = keys.map(k => values(grid[k], `grid.${k}`));
  let count = lists.reduce((a, b) => a * b.length, 1);
  check(count <= limit, `grid: ${count} points exceeds max_grid_points`);
  const out = [];
  const step = (idx, acc) => {
    if (idx === keys.length) { out.push({ ...acc }); return; }
    for (const v of lists[idx]) step(idx + 1, { ...acc, [keys[idx]]: v });
  };
  step(0, {});
  return out;
}

function paramHash(p) { return digest(canonical(p)); }
function rankTrials(development, direction) {
  return [...development].sort((a, b) => {
    const scoreDelta = direction === 'maximize' ? b.score - a.score : a.score - b.score;
    return scoreDelta || a.parameter_hash.localeCompare(b.parameter_hash);
  });
}

export function analyze(input) {
  validateInput(input);
  const p = parameters(input, allowed);
  const phase = p.phase ?? input.phase ?? 'development';
  check(['development', 'holdout'].includes(phase), 'phase: development or holdout required');
  const metric = p.objective_metric ?? input.objective?.metric ?? 'score';
  text(metric, 'objective_metric');
  const direction = p.direction ?? input.objective?.direction ?? 'maximize';
  check(['maximize', 'minimize'].includes(direction), 'direction: maximize or minimize required');
  const max_grid_points = p.max_grid_points === undefined ? 5000 : integer(p.max_grid_points, 'max_grid_points', 1, 100000);
  const grid = expand(input.grid, max_grid_points);
  const grid_sha256 = digest(canonical(grid));
  const objective_sha256 = digest(canonical({ metric, direction, max_grid_points }));
  const gridHashes = new Set(grid.map(paramHash));
  const trials = array(input.trials ?? [], 'trials', 0, 10000).map((row, i) => {
    check(row && typeof row === 'object' && !Array.isArray(row), `trials[${i}]: object required`);
    const available = instant(row.available_at, `trials[${i}].available_at`);
    check(available <= Date.parse(input.as_of), `trials[${i}]: unavailable at as_of`);
    check(['development', 'holdout'].includes(row.split), `trials[${i}].split: development or holdout required`);
    check(row.parameters && typeof row.parameters === 'object' && !Array.isArray(row.parameters), `trials[${i}].parameters: object required`);
    const hash = paramHash(row.parameters);
    check(gridHashes.has(hash), `trials[${i}]: parameters outside declared grid`);
    const metrics = row.metrics ?? { score: row.score };
    check(metrics && typeof metrics === 'object' && !Array.isArray(metrics), `trials[${i}].metrics: object required`);
    return { split: row.split, available_at: row.available_at, parameters: row.parameters, parameter_hash: hash, score: finite(metrics[metric], `trials[${i}].metrics.${metric}`, -1e18, 1e18), metrics };
  });
  const development = trials.filter(t => t.split === 'development');
  check(development.length > 0, 'At least one development trial required');
  const ranked = rankTrials(development, direction);
  const holdout = trials.filter(t => t.split === 'holdout');
  const development_sha256 = digest(canonical(ranked.map(t => ({ parameters: t.parameters, metrics: t.metrics, score: t.score }))));
  if (phase === 'development') check(input.frozen_selection === undefined, 'development phase rejects incoming frozen_selection');
  if (phase === 'holdout') check(input.frozen_selection, 'holdout phase requires frozen_selection from a prior development run');
  const selected = phase === 'holdout' ? input.frozen_selection?.parameters : ranked[0].parameters;
  check(gridHashes.has(paramHash(selected)), 'frozen selection must be one declared grid point');
  const selectedHash = paramHash(selected);
  check(development.some(t => t.parameter_hash === selectedHash), 'frozen selection must be among evaluated development trials');
  const selectedAtText = phase === 'holdout' ? input.frozen_selection?.selected_at : input.as_of;
  const selectedAt = instant(selectedAtText, 'frozen_selection.selected_at');
  check(selectedAt <= Date.parse(input.as_of), 'selected_at must be no later than as_of');
  const latestDevelopment = Math.max(...development.map(t => Date.parse(t.available_at)));
  check(latestDevelopment <= selectedAt, 'selected_at must be no earlier than development evidence availability');
  const frozenCore = { parameters: selected, selected_at: selectedAtText, development_sha256, grid_sha256, objective_sha256 };
  const selection_sha256 = digest(canonical(frozenCore));
  const frozenSelection = { ...frozenCore, parameter_hash: selectedHash, selection_sha256 };
  if (phase === 'development') {
    check(holdout.length === 0, 'development phase rejects holdout trials');
  } else {
    check(input.frozen_selection.grid_sha256 === grid_sha256, 'frozen_selection.grid_sha256 mismatch');
    check(input.frozen_selection.objective_sha256 === objective_sha256, 'frozen_selection.objective_sha256 mismatch');
    check(input.frozen_selection.development_sha256 === development_sha256, 'frozen_selection.development_sha256 mismatch');
    check(input.frozen_selection.parameter_hash === selectedHash, 'frozen_selection.parameter_hash mismatch');
    check(holdout.length > 0, 'holdout phase requires selected holdout evidence');
    for (const h of holdout) check(selectedAt < Date.parse(h.available_at), 'selection must be timestamped before holdout availability');
    check(holdout.every(t => t.parameter_hash === selectedHash), 'Holdout evidence for non-selected parameters is not allowed');
    check(input.frozen_selection.selection_sha256 === selection_sha256, 'frozen_selection.selection_sha256 mismatch');
  }
  return {
    parameters: { phase, objective_metric: metric, direction, max_grid_points },
    observations: {
      grid_points: grid.length,
      development_rank: ranked.map((t, i) => ({ rank: i + 1, parameters: t.parameters, parameter_hash: t.parameter_hash, score: t.score })),
      grid_sha256,
      objective_sha256,
      development_sha256,
      frozen_selection: frozenSelection,
      fixed_holdout_evidence: phase === 'holdout' ? holdout.map(t => ({ score: t.score, metrics: t.metrics })) : [],
    },
    limitations: [
      'Ranking uses development evidence only; run development first, freeze the returned frozen_selection artifact, then pass it unchanged to holdout.',
      'Hashes prove only declared self-consistency inside this local JSON record; the user must freeze the development artifact externally to prove holdout was not seen.',
      'Holdout evidence for non-selected parameters is rejected to avoid accidental holdout optimization.',
      'No strategy code or arbitrary expressions are executed; all evidence must be supplied as finite JSON metrics.',
    ],
  };
}

runCli(import.meta.url, analyze);
