// SPDX-License-Identifier: GPL-3.0-only
import { bars, parameters, integer, finite, check, mean, std, runCli } from './runtime.mjs';

const iso = ms => new Date(ms).toISOString();
const round = value => value === null ? null : Math.round(value * 1e10) / 1e10;
const slice = (values, end, size) => end + 1 >= size ? values.slice(end + 1 - size, end + 1) : null;

function trueRange(rows, i) {
  if (i === 0) return rows[0].high - rows[0].low;
  return Math.max(rows[i].high - rows[i].low, Math.abs(rows[i].high - rows[i - 1].close), Math.abs(rows[i].low - rows[i - 1].close));
}

export function analyze(input) {
  const p = parameters(input, ['return_window', 'atr_window', 'gap_threshold_pct', 'annualization', 'max_bars']);
  const effective = {
    return_window: integer(p.return_window ?? 5, 'return_window', 2, 500),
    atr_window: integer(p.atr_window ?? 5, 'atr_window', 2, 500),
    gap_threshold_pct: finite(p.gap_threshold_pct ?? 0.01, 'gap_threshold_pct', 0, 1),
    annualization: finite(p.annualization ?? 252, 'annualization', 1, 100000),
    max_bars: integer(p.max_bars ?? 5000, 'max_bars', 10, 10000),
  };
  const rows = bars(input);
  check(rows.length <= effective.max_bars, 'bars exceeds max_bars');
  const returns = rows.map((row, i) => i === 0 ? null : row.close / rows[i - 1].close - 1);
  const trs = rows.map((_, i) => trueRange(rows, i));
  let cumPv = 0, cumVol = 0;
  let runningAvailableAt = -Infinity;
  const series = rows.map((row, i) => {
    runningAvailableAt = Math.max(runningAvailableAt, Date.parse(row.available_at));
    const typical = (row.high + row.low + row.close) / 3;
    cumPv += typical * row.volume;
    cumVol += row.volume;
    const retWindow = i >= effective.return_window ? returns.slice(i + 1 - effective.return_window, i + 1).filter(v => v !== null) : null;
    const atrWindow = slice(trs, i, effective.atr_window);
    const gap_pct = i === 0 ? null : row.open / rows[i - 1].close - 1;
    return {
      time: row.time,
      available_at: iso(runningAvailableAt),
      close: row.close,
      return_1: round(returns[i]),
      rolling_return_std: round(retWindow && retWindow.length === effective.return_window ? std(retWindow) : null),
      annualized_return_std: round(retWindow && retWindow.length === effective.return_window ? std(retWindow) * Math.sqrt(effective.annualization) : null),
      atr: round(atrWindow ? mean(atrWindow) : null),
      gap_pct: round(gap_pct),
      gap_flag: gap_pct === null ? false : Math.abs(gap_pct) >= effective.gap_threshold_pct,
      cumulative_vwap: round(cumVol > 0 ? cumPv / cumVol : null),
    };
  });
  return {
    parameters: effective,
    observations: {
      baseline_note: 'Volatility baseline using close-to-close returns, true range, gaps and cumulative VWAP.',
      rows: rows.length,
      latest: series.at(-1),
      gaps: series.filter(row => row.gap_flag).map(row => ({ time: row.time, available_at: row.available_at, gap_pct: row.gap_pct })),
      series,
    },
    limitations: [
      'Return volatility is close-to-close and uses simple sample population std from the window, not a realized intraday estimator.',
      'VWAP is cumulative over supplied rows only and inherits the declared volume quality.',
      'Gap flags compare current open to prior close; corporate actions and session boundaries must be handled before input.',
    ],
  };
}

runCli(import.meta.url, analyze);
