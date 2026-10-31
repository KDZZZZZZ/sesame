// SPDX-License-Identifier: GPL-3.0-only
import { bars, parameters, integer, finite, check, mean, std, runCli } from './runtime.mjs';

const iso = ms => new Date(ms).toISOString();
const round = value => value === null ? null : Math.round(value * 1e10) / 1e10;

function slice(values, end, size) {
  return end + 1 >= size ? values.slice(end + 1 - size, end + 1) : null;
}

function ema(prev, value, span) {
  const alpha = 2 / (span + 1);
  return prev === null ? value : alpha * value + (1 - alpha) * prev;
}

function trueRange(rows, i) {
  if (i === 0) return rows[0].high - rows[0].low;
  return Math.max(rows[i].high - rows[i].low, Math.abs(rows[i].high - rows[i - 1].close), Math.abs(rows[i].low - rows[i - 1].close));
}

export function analyze(input) {
  const p = parameters(input, ['sma_window', 'ema_span', 'macd_fast', 'macd_slow', 'macd_signal', 'rsi_window', 'bollinger_window', 'bollinger_stddev', 'atr_window', 'max_bars']);
  const effective = {
    sma_window: integer(p.sma_window ?? 5, 'sma_window', 2, 250),
    ema_span: integer(p.ema_span ?? 5, 'ema_span', 2, 250),
    macd_fast: integer(p.macd_fast ?? 3, 'macd_fast', 2, 100),
    macd_slow: integer(p.macd_slow ?? 6, 'macd_slow', 3, 250),
    macd_signal: integer(p.macd_signal ?? 3, 'macd_signal', 2, 100),
    rsi_window: integer(p.rsi_window ?? 5, 'rsi_window', 2, 250),
    bollinger_window: integer(p.bollinger_window ?? 5, 'bollinger_window', 2, 250),
    bollinger_stddev: finite(p.bollinger_stddev ?? 2, 'bollinger_stddev', 0.1, 10),
    atr_window: integer(p.atr_window ?? 5, 'atr_window', 2, 250),
    max_bars: integer(p.max_bars ?? 5000, 'max_bars', 10, 10000),
  };
  check(effective.macd_fast < effective.macd_slow, 'macd_fast must be smaller than macd_slow');
  const rows = bars(input);
  check(rows.length <= effective.max_bars, 'bars exceeds max_bars');

  const closes = rows.map(row => row.close);
  const trueRanges = rows.map((_, i) => trueRange(rows, i));
  const series = [];
  let emaValue = null, macdFast = null, macdSlow = null, macdSignal = null;
  let runningAvailableAt = -Infinity;

  for (let i = 0; i < rows.length; i += 1) {
    runningAvailableAt = Math.max(runningAvailableAt, Date.parse(rows[i].available_at));
    emaValue = ema(emaValue, closes[i], effective.ema_span);
    macdFast = ema(macdFast, closes[i], effective.macd_fast);
    macdSlow = ema(macdSlow, closes[i], effective.macd_slow);
    const macdLine = macdFast - macdSlow;
    macdSignal = ema(macdSignal, macdLine, effective.macd_signal);

    const smaWindow = slice(closes, i, effective.sma_window);
    const rsiWindow = i >= effective.rsi_window ? closes.slice(i - effective.rsi_window, i + 1) : null;
    const bollWindow = slice(closes, i, effective.bollinger_window);
    const atrWindow = slice(trueRanges, i, effective.atr_window);

    let rsi = null;
    if (rsiWindow) {
      const diffs = rsiWindow.slice(1).map((v, j) => v - rsiWindow[j]);
      const gains = diffs.map(v => Math.max(v, 0));
      const losses = diffs.map(v => Math.max(-v, 0));
      const avgGain = mean(gains), avgLoss = mean(losses);
      rsi = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
    }

    let bollinger = { middle: null, upper: null, lower: null, width: null };
    if (bollWindow) {
      const middle = mean(bollWindow);
      const band = effective.bollinger_stddev * std(bollWindow);
      bollinger = { middle, upper: middle + band, lower: middle - band, width: middle === 0 ? null : (2 * band) / middle };
    }

    series.push({
      time: rows[i].time,
      available_at: iso(runningAvailableAt),
      close: closes[i],
      sma: round(smaWindow ? mean(smaWindow) : null),
      ema: round(emaValue),
      macd: { line: round(macdLine), signal: round(macdSignal), histogram: round(macdLine - macdSignal) },
      rsi: round(rsi),
      bollinger: Object.fromEntries(Object.entries(bollinger).map(([k, v]) => [k, round(v)])),
      atr: round(atrWindow ? mean(atrWindow) : null),
    });
  }

  return {
    parameters: effective,
    observations: {
      baseline_note: 'Transparent indicator baseline; null warmup values are not fabricated.',
      rows: rows.length,
      latest: series.at(-1),
      series,
    },
    limitations: [
      'EMA/MACD seed at the first visible close; this is simple and reproducible, not ABU equivalence.',
      'ATR uses a simple rolling mean of true range rather than Wilder smoothing.',
      'Historical row availability is the maximum available_at of observations used up to that row.',
    ],
  };
}

runCli(import.meta.url, analyze);
