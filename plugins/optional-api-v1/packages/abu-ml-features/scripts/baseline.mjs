// SPDX-License-Identifier: GPL-3.0-only
import { bars, check, integer, instant, parameters, runCli } from './runtime.mjs';

const allowed = ['window', 'atr_window', 'rank_window'];
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
function slope(values) {
  const mx = (values.length - 1) / 2, my = mean(values);
  let num = 0, den = 0;
  for (let i = 0; i < values.length; i++) { num += (i - mx) * (values[i] - my); den += (i - mx) ** 2; }
  return den ? num / den : 0;
}
function trueRange(row, prev) {
  return Math.max(row.high - row.low, Math.abs(row.high - prev.close), Math.abs(row.low - prev.close));
}

export function analyze(input) {
  const p = parameters(input, allowed);
  const window = p.window === undefined ? 5 : integer(p.window, 'window', 2, 252);
  const atrWindow = p.atr_window === undefined ? window : integer(p.atr_window, 'atr_window', 2, 252);
  const rankWindow = p.rank_window === undefined ? window : integer(p.rank_window, 'rank_window', 2, 252);
  const rows = bars(input);
  const queries = input.decision_times ?? [input.as_of];
  check(Array.isArray(queries) && queries.length >= 1 && queries.length <= 1000, 'decision_times: array required');
  check(queries.length * rows.length <= 10_000_000, 'Feature scan budget exceeds 10,000,000 query-bars');
  const observations = [];
  for (const q of queries) {
    const qt = instant(q, 'decision_times[]');
    check(qt <= Date.parse(input.as_of), 'decision time must be <= as_of');
    const prior = rows.filter(r => Date.parse(r.available_at) <= qt);
    check(prior.length >= Math.max(window, atrWindow, rankWindow) + 1, 'Not enough prior visible bars for requested windows');
    const closes = prior.slice(-window).map(r => r.close);
    const rankCloses = prior.slice(-rankWindow).map(r => r.close);
    const returns = [];
    for (let i = prior.length - window; i < prior.length; i++) returns.push(prior[i].close / prior[i - 1].close - 1);
    const atrs = [];
    for (let i = prior.length - atrWindow; i < prior.length; i++) atrs.push(trueRange(prior[i], prior[i - 1]));
    const last = prior[prior.length - 1], prev = prior[prior.length - 2];
    const used = prior.slice(-Math.max(window, atrWindow, rankWindow) - 1);
    const sourceUntil = new Date(Math.max(...used.map(r => Date.parse(r.available_at)))).toISOString();
    observations.push({
      decision_time: q,
      available_by: q,
      source_until: sourceUntil,
      close_regression_slope: slope(closes),
      close_rank_percentile: rankCloses.filter(v => v <= last.close).length / rankCloses.length,
      realized_volatility: sd(returns),
      atr: mean(atrs),
      gap_from_previous_close: last.open / prev.close - 1,
      close: last.close,
    });
  }
  return {
    parameters: { window, atr_window: atrWindow, rank_window: rankWindow },
    observations,
    limitations: [
      'Every feature uses only bars whose available_at is not later than the decision time; current-bar fields are used only after that bar is visible.',
      'Features are descriptive research inputs, not labels or executable signals.',
    ],
  };
}

runCli(import.meta.url, analyze);
