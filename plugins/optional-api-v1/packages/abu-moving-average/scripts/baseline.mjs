// SPDX-License-Identifier: GPL-3.0-only
import { bars, check, mean, integer, parameters, runCli } from './runtime.mjs';

function sma(rows, end, window) {
  if (end + 1 < window) return null;
  return mean(rows.slice(end + 1 - window, end + 1).map(row => row.close));
}

function maxAvailable(rows, start, end) {
  let latest = rows[start].available_at;
  for (let i = start + 1; i <= end; i += 1) if (rows[i].available_at > latest) latest = rows[i].available_at;
  return latest;
}

export function analyze(input) {
  const rows = bars(input);
  const p = parameters(input, ['fast_window', 'slow_window']);
  const fastWindow = integer(p.fast_window ?? 5, 'fast_window', 2, 200);
  const slowWindow = integer(p.slow_window ?? 20, 'slow_window', 3, 500);
  check(fastWindow < slowWindow, 'fast_window must be less than slow_window');

  const series = rows.map((row, i) => {
    const fast = sma(rows, i, fastWindow);
    const slow = sma(rows, i, slowWindow);
    if (fast === null || slow === null) return { time: row.time, available_at: row.available_at, fast_sma: fast, slow_sma: slow, status: 'warmup', signal: null };
    const prevFast = sma(rows, i - 1, fastWindow);
    const prevSlow = sma(rows, i - 1, slowWindow);
    let signal = null;
    if (prevFast !== null && prevSlow !== null && prevFast <= prevSlow && fast > slow) signal = 'fast_crossed_above_slow';
    if (prevFast !== null && prevSlow !== null && prevFast >= prevSlow && fast < slow) signal = 'fast_crossed_below_slow';
    const usedAvailableAt = maxAvailable(rows, Math.max(0, i - slowWindow), i);
    return { time: row.time, available_at: row.available_at, used_available_at: usedAvailableAt, fast_sma: fast, slow_sma: slow, spread: fast - slow, signal, earliest_action_available_at: signal ? usedAvailableAt : null };
  });

  return {
    parameters: { fast_window: fastWindow, slow_window: slowWindow },
    observations: { decision_available_at: maxAvailable(rows, 0, rows.length - 1), latest: series[series.length - 1], series },
    limitations: [
      'Dual moving-average crosses are lagging close-based observations and are not filled orders.',
      'No transaction costs, slippage, minimum lot or venue session rules are applied.',
      'This is an independently rewritten ABU-style double moving-average baseline, not ABU source code.',
    ],
  };
}

runCli(import.meta.url, analyze);
