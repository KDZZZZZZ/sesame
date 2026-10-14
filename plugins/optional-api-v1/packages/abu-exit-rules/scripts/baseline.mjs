// SPDX-License-Identifier: GPL-3.0-only
import { bars, check, finite, instant, integer, parameters, runCli } from './runtime.mjs';

function trueRange(row, previousClose) {
  if (previousClose === null) return row.high - row.low;
  return Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose));
}

function average(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function maxAvailable(rows, start, end) {
  let latest = rows[start].available_at;
  for (let i = start + 1; i <= end; i += 1) if (rows[i].available_at > latest) latest = rows[i].available_at;
  return latest;
}

function validatePosition(input) {
  const position = input.position;
  check(position && typeof position === 'object' && !Array.isArray(position), 'position: object required');
  check(['long', 'short'].includes(position.side), 'position.side: long or short required');
  const entryAt = instant(position.entry_time, 'position.entry_time');
  check(entryAt <= instant(input.as_of, 'as_of'), 'position.entry_time must not be after as_of');
  finite(position.entry_price, 'position.entry_price', Number.MIN_VALUE, 1e15);
  return position;
}

export function analyze(input) {
  const rows = bars(input);
  const position = validatePosition(input);
  const p = parameters(input, ['atr_window', 'stop_loss_atr', 'stop_win_atr', 'trailing_atr', 'max_holding_bars']);
  const atrWindow = integer(p.atr_window ?? 14, 'atr_window', 2, 200);
  const stopLossAtr = finite(p.stop_loss_atr ?? 2, 'stop_loss_atr', 0.1, 100);
  const stopWinAtr = finite(p.stop_win_atr ?? 3, 'stop_win_atr', 0.1, 100);
  const trailingAtr = finite(p.trailing_atr ?? 2, 'trailing_atr', 0.1, 100);
  const maxHoldingBars = integer(p.max_holding_bars ?? 20, 'max_holding_bars', 1, 10000);

  const entryMs = Date.parse(position.entry_time);
  const entryIndex = rows.findIndex(row => Date.parse(row.time) === entryMs);
  check(entryIndex >= 0, 'position.entry_time must align to a provided bar close time');
  const held = rows.slice(entryIndex + 1);
  check(held.length > 0, 'At least one visible bar after position.entry_time is required');

  let bestHigh = position.entry_price;
  let bestLow = position.entry_price;
  const trValues = rows.map((row, i) => trueRange(row, i === 0 ? null : rows[i - 1].close));
  const series = held.map((row, i) => {
    const rowIndex = entryIndex + 1 + i;
    bestHigh = Math.max(bestHigh, row.high);
    bestLow = Math.min(bestLow, row.low);
    const atrStart = rowIndex + 1 >= atrWindow ? rowIndex + 1 - atrWindow : null;
    const atr = atrStart === null ? null : average(trValues.slice(atrStart, rowIndex + 1));
    const reasons = [];
    if (atr !== null) {
      if (position.side === 'long') {
        if (row.close <= position.entry_price - stopLossAtr * atr) reasons.push('atr_stop_loss');
        if (row.close >= position.entry_price + stopWinAtr * atr) reasons.push('atr_stop_win');
        if (bestHigh - row.close >= trailingAtr * atr) reasons.push('atr_trailing_stop');
      } else {
        if (row.close >= position.entry_price + stopLossAtr * atr) reasons.push('atr_stop_loss');
        if (row.close <= position.entry_price - stopWinAtr * atr) reasons.push('atr_stop_win');
        if (row.close - bestLow >= trailingAtr * atr) reasons.push('atr_trailing_stop');
      }
    }
    if (i + 1 >= maxHoldingBars) reasons.push('max_holding_bars');
    const usedStart = atrStart === null ? entryIndex + 1 : Math.min(atrStart, entryIndex + 1);
    const usedAvailableAt = maxAvailable(rows, usedStart, rowIndex);
    return { time: row.time, available_at: row.available_at, used_available_at: usedAvailableAt, status: atr === null ? 'atr_warmup' : 'ready', atr, best_high_since_entry: bestHigh, best_low_since_entry: bestLow, holding_bars: i + 1, exit_reasons: reasons, earliest_action_available_at: reasons.length ? usedAvailableAt : null };
  });

  return {
    parameters: { atr_window: atrWindow, stop_loss_atr: stopLossAtr, stop_win_atr: stopWinAtr, trailing_atr: trailingAtr, max_holding_bars: maxHoldingBars },
    observations: { decision_available_at: maxAvailable(rows, 0, rows.length - 1), position: { side: position.side, entry_time: position.entry_time, entry_price: position.entry_price, entry_bar_excluded_from_extrema: true }, latest: series[series.length - 1], first_exit: series.find(row => row.exit_reasons?.length) ?? null, series },
    limitations: [
      'Position entry_time must align to a supplied bar close; the entry bar is excluded from holding extrema because no bar-open timestamp proves its full range occurred after entry.',
      'ATR may use visible pre-entry bars for warmup, while holding-period exits work even when ATR is still warming up.',
      'ATR exits are research observations and do not submit, cancel or fill orders.',
      'This independently rewritten baseline references ABU ATR stop ideas without copying ABU implementation code.',
    ],
  };
}

runCli(import.meta.url, analyze);
