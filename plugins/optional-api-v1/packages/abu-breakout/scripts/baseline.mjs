// SPDX-License-Identifier: GPL-3.0-only
import { bars, check, integer, parameters, runCli } from './runtime.mjs';

function maxAvailable(rows) {
  return rows.reduce((latest, row) => row.available_at > latest ? row.available_at : latest, rows[0].available_at);
}

function windowExtreme(rows, start, end, key, op) {
  let value = rows[start][key];
  for (let i = start + 1; i <= end; i += 1) value = op(value, rows[i][key]);
  return value;
}

function windowAvailable(rows, start, end) {
  return maxAvailable(rows.slice(start, end + 1));
}

export function analyze(input) {
  const rows = bars(input);
  const p = parameters(input, ['lookback', 'direction']);
  const lookback = integer(p.lookback ?? 20, 'lookback', 2, 500);
  const direction = p.direction ?? 'both';
  check(['both', 'long', 'short'].includes(direction), 'direction: both, long or short required');

  const observations = rows.map((row, i) => {
    if (i < lookback) return { time: row.time, available_at: row.available_at, status: 'warmup', signal: null };
    const start = i - lookback;
    const high = windowExtreme(rows, start, i - 1, 'high', Math.max);
    const low = windowExtreme(rows, start, i - 1, 'low', Math.min);
    const usedAvailableAt = windowAvailable(rows, start, i);
    const longBreak = row.close > high;
    const shortBreak = row.close < low;
    let signal = null;
    if ((direction === 'both' || direction === 'long') && longBreak) signal = 'prior_high_close_breakout';
    if ((direction === 'both' || direction === 'short') && shortBreak) signal = signal ? 'two_sided_breakout_conflict' : 'prior_low_close_breakdown';
    return {
      time: row.time,
      available_at: row.available_at,
      lookback_high: high,
      lookback_low: low,
      close: row.close,
      signal,
      used_available_at: usedAvailableAt,
      earliest_action: signal ? 'next_interval_after_signal_available' : null,
      earliest_action_available_at: signal ? usedAvailableAt : null,
    };
  });

  return {
    parameters: { lookback, direction },
    observations: {
      decision_available_at: maxAvailable(rows),
      latest: observations[observations.length - 1],
      series: observations,
    },
    limitations: [
      'Breakout uses only prior-window highs/lows and current close; it does not model intrabar fills.',
      'Earliest action is the next interval after the signal bar is available, not a simulated execution price.',
      'This ABU-inspired baseline is independently rewritten; it is not ABU FactorBuyBreak or FactorSellBreak code.',
    ],
  };
}

runCli(import.meta.url, analyze);
