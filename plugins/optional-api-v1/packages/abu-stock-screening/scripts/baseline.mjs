// SPDX-License-Identifier: GPL-3.0-only
import { validateInput, bars, parameters, integer, array, check, mean, runCli } from './runtime.mjs';

const round = value => value === null ? null : Math.round(value * 1e10) / 1e10;
const maxIso = rows => new Date(Math.max(...rows.map(row => Date.parse(row.available_at)))).toISOString();

function regressionSlope(values) {
  const xs = values.map((_, i) => i);
  const mx = mean(xs), my = mean(values);
  const den = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  return den === 0 ? 0 : xs.reduce((sum, x, i) => sum + (x - mx) * (values[i] - my), 0) / den;
}

function efficiency(values) {
  const path = values.slice(1).reduce((sum, v, i) => sum + Math.abs(v - values[i]), 0);
  return path === 0 ? 0 : (values.at(-1) - values[0]) / path;
}

function scoreRank(items, key) {
  const sorted = [...items].sort((a, b) => {
    const av = a.metrics[key], bv = b.metrics[key];
    return bv - av || a.id.localeCompare(b.id);
  });
  const n = sorted.length;
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].metrics[key] === sorted[i].metrics[key]) j += 1;
    const averageRank = (i + 1 + j) / 2;
    const score = n === 1 ? 1 : (n - averageRank) / (n - 1);
    for (let k = i; k < j; k += 1) {
      sorted[k].ranks[key] = averageRank;
      sorted[k].scores[key] = score;
    }
    i = j;
  }
}

function instrumentMetrics(input, instrument, effective) {
  check(instrument && typeof instrument === 'object' && !Array.isArray(instrument), 'instrument object required');
  check(typeof instrument.id === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(instrument.id), 'instrument.id: stable short id required');
  const rows = bars({ schema_version: input.schema_version, source: input.source, as_of: input.as_of, bars: instrument.bars });
  check(rows.length <= effective.max_bars_per_instrument, `${instrument.id}: bars exceeds max_bars_per_instrument`);
  const closes = rows.map(row => row.close);
  const latest = rows.at(-1);
  const momentum = rows.length > effective.momentum_window ? latest.close / rows[rows.length - 1 - effective.momentum_window].close - 1 : null;
  const trendValues = rows.length >= effective.trend_window ? closes.slice(-effective.trend_window) : null;
  const efficiencyValues = rows.length >= effective.efficiency_window ? closes.slice(-effective.efficiency_window) : null;
  const priceValues = rows.length >= effective.price_window ? closes.slice(-effective.price_window) : null;
  const slope = trendValues ? regressionSlope(trendValues) : null;
  const latestClose = latest.close;
  const minPrice = priceValues ? Math.min(...priceValues) : null;
  const maxPrice = priceValues ? Math.max(...priceValues) : null;
  return {
    id: instrument.id,
    latest_time: latest.time,
    available_at: maxIso(rows),
    bars: rows.length,
    latest_close: latestClose,
    metrics: {
      momentum: round(momentum),
      trend: round(slope === null ? null : (slope * effective.trend_window) / latestClose),
      efficiency: round(efficiencyValues ? efficiency(efficiencyValues) : null),
      price_position: round(priceValues ? (maxPrice === minPrice ? 0.5 : (latestClose - minPrice) / (maxPrice - minPrice)) : null),
    },
    ranks: {},
    scores: {},
  };
}

export function analyze(input) {
  validateInput(input);
  const p = parameters(input, ['momentum_window', 'trend_window', 'efficiency_window', 'price_window', 'top_n', 'max_instruments', 'max_bars_per_instrument']);
  const effective = {
    momentum_window: integer(p.momentum_window ?? 5, 'momentum_window', 1, 500),
    trend_window: integer(p.trend_window ?? 8, 'trend_window', 3, 500),
    efficiency_window: integer(p.efficiency_window ?? p.trend_window ?? 8, 'efficiency_window', 3, 500),
    price_window: integer(p.price_window ?? 20, 'price_window', 2, 1000),
    top_n: integer(p.top_n ?? 10, 'top_n', 1, 100),
    max_instruments: integer(p.max_instruments ?? 50, 'max_instruments', 2, 500),
    max_bars_per_instrument: integer(p.max_bars_per_instrument ?? 5000, 'max_bars_per_instrument', 10, 10000),
  };
  const instruments = array(input.instruments, 'instruments', 1, effective.max_instruments);
  const ids = new Set();
  const items = instruments.map(inst => {
    const item = instrumentMetrics(input, inst, effective);
    check(!ids.has(item.id), 'instrument.id values must be unique');
    ids.add(item.id);
    return item;
  });
  check(new Set(items.map(item => item.latest_time)).size === 1, 'instrument latest bar times must match for a cross-sectional screen');
  const eligible = items.filter(item => Object.values(item.metrics).every(value => value !== null));
  for (const item of items) item.status = eligible.includes(item) ? 'ok' : 'insufficient_history';
  for (const key of ['momentum', 'trend', 'efficiency', 'price_position']) scoreRank(eligible, key);
  for (const item of eligible) {
    item.composite_score = round(mean(['momentum', 'trend', 'efficiency', 'price_position'].map(key => item.scores[key])));
  }
  for (const item of items.filter(item => item.status !== 'ok')) item.composite_score = null;
  const ranked = [...eligible].sort((a, b) => b.composite_score - a.composite_score || a.id.localeCompare(b.id));
  ranked.forEach((item, i) => { item.rank = i + 1; });
  const all = [...ranked, ...items.filter(item => item.status !== 'ok').sort((a, b) => a.id.localeCompare(b.id))];
  return {
    parameters: effective,
    observations: {
      baseline_note: 'Bounded historical universe screen; ranks are descriptive cross-sectional features, not trade orders.',
      universe_size: items.length,
      top: ranked.slice(0, Math.min(effective.top_n, ranked.length)),
      all,
    },
    limitations: [
      'The universe is exactly the supplied instrument list; survivorship, liquidity and eligibility must be handled before input.',
      'Composite score equally weights price, momentum, trend and efficiency; instruments with insufficient history are excluded rather than given fabricated low scores.',
      'ABU PickStockBu has multiple independent pickers; this package provides one bounded screen suitable for Agent review.',
    ],
  };
}

runCli(import.meta.url, analyze);
