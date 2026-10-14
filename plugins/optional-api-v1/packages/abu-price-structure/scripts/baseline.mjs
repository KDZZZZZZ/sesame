// SPDX-License-Identifier: GPL-3.0-only
import { bars, parameters, integer, finite, check, runCli } from './runtime.mjs';

const iso = ms => new Date(ms).toISOString();
const round = value => value === null ? null : Math.round(value * 1e10) / 1e10;
const maxAt = rows => Math.max(...rows.map(row => Date.parse(row.available_at)));

function isPivot(rows, i, left, right, side) {
  const value = side === 'high' ? rows[i].high : rows[i].low;
  const cmp = side === 'high' ? (a, b) => a > b : (a, b) => a < b;
  for (let j = i - left; j <= i + right; j += 1) {
    if (j === i) continue;
    const other = side === 'high' ? rows[j].high : rows[j].low;
    if (!cmp(value, other)) return false;
  }
  return true;
}

function cluster(pivots, tolerance) {
  const levels = [];
  for (const pivot of pivots) {
    let level = levels.find(item => Math.abs(item.price - pivot.price) / Math.max(item.price, 1e-12) <= tolerance);
    if (!level) {
      level = { price: pivot.price, touches: 0, latest_confirmed_at: pivot.confirmed_at, sides: [] };
      levels.push(level);
    }
    level.price = (level.price * level.touches + pivot.price) / (level.touches + 1);
    level.touches += 1;
    level.latest_confirmed_at = pivot.confirmed_at > level.latest_confirmed_at ? pivot.confirmed_at : level.latest_confirmed_at;
    if (!level.sides.includes(pivot.side)) level.sides.push(pivot.side);
  }
  return levels
    .map(level => ({ ...level, price: round(level.price), sides: level.sides.sort() }))
    .sort((a, b) => b.touches - a.touches || b.latest_confirmed_at.localeCompare(a.latest_confirmed_at));
}

function golden(pivots) {
  const ordered = [...pivots].sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at));
  const hi = [...ordered].reverse().find(p => p.side === 'resistance');
  const lo = [...ordered].reverse().find(p => p.side === 'support');
  if (!hi || !lo) return null;
  const low = Math.min(hi.price, lo.price), high = Math.max(hi.price, lo.price);
  const range = high - low;
  return {
    low: round(low),
    high: round(high),
    available_at: hi.confirmed_at > lo.confirmed_at ? hi.confirmed_at : lo.confirmed_at,
    levels: [0.236, 0.382, 0.5, 0.618, 0.786].map(ratio => ({ ratio, price: round(high - range * ratio) })),
  };
}

export function analyze(input) {
  const p = parameters(input, ['left', 'right', 'cluster_tolerance_pct', 'max_bars', 'max_pivots']);
  const effective = {
    left: integer(p.left ?? 2, 'left', 1, 20),
    right: integer(p.right ?? 2, 'right', 1, 20),
    cluster_tolerance_pct: finite(p.cluster_tolerance_pct ?? 0.02, 'cluster_tolerance_pct', 0.0001, 0.2),
    max_bars: integer(p.max_bars ?? 5000, 'max_bars', 10, 10000),
    max_pivots: integer(p.max_pivots ?? 100, 'max_pivots', 1, 1000),
  };
  const rows = bars(input);
  check(rows.length <= effective.max_bars, 'bars exceeds max_bars');
  const pivots = [];
  for (let i = effective.left; i < rows.length - effective.right; i += 1) {
    const confirmRows = rows.slice(i - effective.left, i + effective.right + 1);
    if (isPivot(rows, i, effective.left, effective.right, 'high')) {
      pivots.push({ side: 'resistance', time: rows[i].time, confirmed_at: iso(maxAt(confirmRows)), price: rows[i].high });
    }
    if (isPivot(rows, i, effective.left, effective.right, 'low')) {
      pivots.push({ side: 'support', time: rows[i].time, confirmed_at: iso(maxAt(confirmRows)), price: rows[i].low });
    }
  }
  check(pivots.length <= effective.max_pivots, 'pivot count exceeds max_pivots');
  const normalized = pivots.map(pivot => ({ ...pivot, price: round(pivot.price) }));
  const levels = cluster(normalized, effective.cluster_tolerance_pct);
  return {
    parameters: effective,
    observations: {
      baseline_note: 'Delayed-confirmation pivot baseline; pivot time and confirmed_at are deliberately separate.',
      rows: rows.length,
      pivots: normalized,
      levels,
      golden_levels: golden(normalized),
    },
    limitations: [
      'Pivots are only known after right future bars; use confirmed_at, not pivot time, for causal decisions.',
      'Support and resistance clustering is a simple percentage tolerance, not ABU plotting or manual chart work.',
      'Golden levels use the latest confirmed high and low pivot only; no trend-leg judgment is inferred.',
    ],
  };
}

runCli(import.meta.url, analyze);
