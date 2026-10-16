// SPDX-License-Identifier: GPL-3.0-only
import { bars, parameters, integer, finite, check, mean, std, runCli } from './runtime.mjs';

const iso = ms => new Date(ms).toISOString();
const round = value => value === null ? null : Math.round(value * 1e10) / 1e10;
const maxAt = rows => Math.max(...rows.map(row => Date.parse(row.available_at)));

function regression(values) {
  const xs = values.map((_, i) => i);
  const mx = mean(xs), my = mean(values);
  const den = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  const slope = den === 0 ? 0 : xs.reduce((sum, x, i) => sum + (x - mx) * (values[i] - my), 0) / den;
  const intercept = my - slope * mx;
  const fitted = xs.map(x => intercept + slope * x);
  const residuals = values.map((v, i) => v - fitted[i]);
  const ssTot = values.reduce((sum, v) => sum + (v - my) ** 2, 0);
  const ssRes = residuals.reduce((sum, v) => sum + v ** 2, 0);
  return { slope, intercept, fitted, residualStd: std(residuals), r2: ssTot === 0 ? null : 1 - ssRes / ssTot };
}

function efficiency(values) {
  const direct = values.at(-1) - values[0];
  const path = values.slice(1).reduce((sum, v, i) => sum + Math.abs(v - values[i]), 0);
  return path === 0 ? 0 : direct / path;
}

export function analyze(input) {
  const p = parameters(input, ['window', 'channel_stddev', 'max_bars']);
  const effective = {
    window: integer(p.window ?? 8, 'window', 3, 500),
    channel_stddev: finite(p.channel_stddev ?? 2, 'channel_stddev', 0.1, 10),
    max_bars: integer(p.max_bars ?? 5000, 'max_bars', 10, 10000),
  };
  const rows = bars(input);
  check(rows.length <= effective.max_bars, 'bars exceeds max_bars');
  const closes = rows.map(row => row.close);
  const series = rows.map((row, i) => {
    if (i + 1 < effective.window) {
      return { time: row.time, available_at: row.available_at, close: row.close, slope: null, normalized_slope: null, r2: null, channel: null, path_efficiency: null };
    }
    const windowRows = rows.slice(i + 1 - effective.window, i + 1);
    const values = closes.slice(i + 1 - effective.window, i + 1);
    const reg = regression(values);
    const fittedLast = reg.fitted.at(-1);
    const band = effective.channel_stddev * reg.residualStd;
    return {
      time: row.time,
      available_at: iso(maxAt(windowRows)),
      close: row.close,
      slope: round(reg.slope),
      normalized_slope: round((reg.slope * effective.window) / row.close),
      r2: round(reg.r2),
      channel: { center: round(fittedLast), upper: round(fittedLast + band), lower: round(fittedLast - band), residual_std: round(reg.residualStd) },
      path_efficiency: round(efficiency(values)),
    };
  });
  return {
    parameters: effective,
    observations: {
      baseline_note: 'Rolling close-price regression baseline with explicit per-window availability.',
      rows: rows.length,
      latest: series.at(-1),
      series,
    },
    limitations: [
      'Regression uses equally spaced bars and close prices only; no volume, gaps, regime or benchmark adjustment.',
      'Normalized slope is scale-adjusted by the latest close and window length; it is a descriptive feature, not a forecast.',
      'ABU TLine includes richer plotting and structure utilities; this package keeps a small auditable baseline.',
    ],
  };
}

runCli(import.meta.url, analyze);
