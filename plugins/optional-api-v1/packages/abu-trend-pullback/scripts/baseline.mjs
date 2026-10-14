// SPDX-License-Identifier: GPL-3.0-only
import { bars, check, finite, integer, parameters, runCli } from './runtime.mjs';

function range(rows, start, end) {
  let high = rows[start].high;
  let low = rows[start].low;
  for (let i = start + 1; i <= end; i += 1) {
    high = Math.max(high, rows[i].high);
    low = Math.min(low, rows[i].low);
  }
  return { high, low };
}

function maxAvailable(rows, start, end) {
  let latest = rows[start].available_at;
  for (let i = start + 1; i <= end; i += 1) if (rows[i].available_at > latest) latest = rows[i].available_at;
  return latest;
}

export function analyze(input) {
  const rows = bars(input);
  const p = parameters(input, ['trend_window', 'pullback_window', 'min_trend_return', 'min_pullback', 'max_pullback', 'golden_tolerance']);
  const trendWindow = integer(p.trend_window ?? 20, 'trend_window', 4, 500);
  const pullbackWindow = integer(p.pullback_window ?? 5, 'pullback_window', 2, 100);
  check(pullbackWindow < trendWindow, 'pullback_window must be less than trend_window');
  const minTrendReturn = finite(p.min_trend_return ?? 0.05, 'min_trend_return', 0, 5);
  const minPullback = finite(p.min_pullback ?? 0.02, 'min_pullback', 0, 1);
  const maxPullback = finite(p.max_pullback ?? 0.25, 'max_pullback', 0, 1);
  check(minPullback <= maxPullback, 'min_pullback must be <= max_pullback');
  const goldenTolerance = finite(p.golden_tolerance ?? 0.08, 'golden_tolerance', 0, 0.5);

  const series = rows.map((row, i) => {
    if (i < trendWindow) return { time: row.time, available_at: row.available_at, status: 'warmup', signal: null };
    const prior = rows[i - trendWindow].close;
    const trendReturn = (row.close - prior) / prior;
    const recent = range(rows, i - pullbackWindow, i);
    const trendRange = range(rows, i - trendWindow, i);
    const pullbackFromRecentHigh = recent.high > 0 ? (recent.high - row.close) / recent.high : null;
    const rebound = row.close > rows[i - 1].close && row.low >= Math.min(rows[i - 1].low, row.close);
    const goldenRatio = trendRange.high > trendRange.low ? (trendRange.high - row.close) / (trendRange.high - trendRange.low) : null;
    const nearGolden = goldenRatio !== null && Math.abs(goldenRatio - 0.382) <= goldenTolerance;
    const inPullback = pullbackFromRecentHigh !== null && pullbackFromRecentHigh >= minPullback && pullbackFromRecentHigh <= maxPullback;
    const signal = trendReturn >= minTrendReturn && inPullback && rebound ? (nearGolden ? 'trend_pullback_rebound_near_382' : 'trend_pullback_rebound') : null;
    const usedAvailableAt = maxAvailable(rows, i - trendWindow, i);
    return { time: row.time, available_at: row.available_at, used_available_at: usedAvailableAt, trend_return: trendReturn, pullback_from_recent_high: pullbackFromRecentHigh, golden_pullback_ratio: goldenRatio, rebound, signal, earliest_action_available_at: signal ? usedAvailableAt : null };
  });

  return {
    parameters: { trend_window: trendWindow, pullback_window: pullbackWindow, min_trend_return: minTrendReturn, min_pullback: minPullback, max_pullback: maxPullback, golden_tolerance: goldenTolerance },
    observations: { decision_available_at: maxAvailable(rows, 0, rows.length - 1), latest: series[series.length - 1], series },
    limitations: [
      'The pullback and golden-ratio checks use only historical bar ranges; they are heuristic research labels.',
      'No market regime, liquidity or execution-quality filter is included.',
      'This independently rewritten baseline borrows the idea family from ABU trend/golden demos, not their source implementation.',
    ],
  };
}

runCli(import.meta.url, analyze);
