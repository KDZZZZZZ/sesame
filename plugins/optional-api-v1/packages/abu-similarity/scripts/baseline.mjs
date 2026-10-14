// SPDX-License-Identifier: GPL-3.0-only
import { validateInput, bars, parameters, integer, array, check, mean, std, runCli } from './runtime.mjs';

const round = value => value === null ? null : Math.round(value * 1e10) / 1e10;
const maxIso = (...times) => new Date(Math.max(...times.map(t => Date.parse(t)))).toISOString();

function returnsFor(input, instrument, maxBars) {
  check(instrument && typeof instrument === 'object' && !Array.isArray(instrument), 'instrument object required');
  check(typeof instrument.id === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(instrument.id), 'instrument.id: stable short id required');
  const rows = bars({ schema_version: input.schema_version, source: input.source, as_of: input.as_of, bars: instrument.bars });
  check(rows.length <= maxBars, `${instrument.id}: bars exceeds max_bars_per_instrument`);
  const byTime = new Map();
  for (let i = 1; i < rows.length; i += 1) {
    byTime.set(`${rows[i - 1].time}|${rows[i].time}`, { start_time: rows[i - 1].time, end_time: rows[i].time, value: rows[i].close / rows[i - 1].close - 1, available_at: maxIso(rows[i - 1].available_at, rows[i].available_at) });
  }
  return { id: instrument.id, returns: byTime };
}

function pearson(xs, ys) {
  const sx = std(xs), sy = std(ys);
  if (sx === 0 || sy === 0) return null;
  const mx = mean(xs), my = mean(ys);
  return mean(xs.map((x, i) => (x - mx) * (ys[i] - my))) / (sx * sy);
}

function ranks(values) {
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = Array(values.length);
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].v === sorted[i].v) j += 1;
    const rank = (i + j + 1) / 2;
    for (let k = i; k < j; k += 1) out[sorted[k].i] = rank;
    i = j;
  }
  return out;
}

function signAgreement(xs, ys) {
  let comparable = 0, same = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = Math.sign(xs[i]), b = Math.sign(ys[i]);
    if (a === 0 || b === 0) continue;
    comparable += 1;
    if (a === b) same += 1;
  }
  return comparable === 0 ? null : same / comparable;
}

export function analyze(input) {
  validateInput(input);
  const p = parameters(input, ['min_overlap', 'max_instruments', 'max_bars_per_instrument']);
  const effective = {
    min_overlap: integer(p.min_overlap ?? 3, 'min_overlap', 2, 10000),
    max_instruments: integer(p.max_instruments ?? 20, 'max_instruments', 2, 100),
    max_bars_per_instrument: integer(p.max_bars_per_instrument ?? 5000, 'max_bars_per_instrument', 10, 10000),
  };
  const instruments = array(input.instruments, 'instruments', 2, effective.max_instruments);
  const ids = new Set();
  const prepared = instruments.map(inst => {
    const preparedInst = returnsFor(input, inst, effective.max_bars_per_instrument);
    check(!ids.has(preparedInst.id), 'instrument.id values must be unique');
    ids.add(preparedInst.id);
    return preparedInst;
  });
  const pairs = [];
  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const a = prepared[i], b = prepared[j];
      const common = [...a.returns.keys()].filter(time => b.returns.has(time)).sort();
      const xs = [], ys = [], availability = [];
      for (const time of common) {
        const ar = a.returns.get(time), br = b.returns.get(time);
        xs.push(ar.value); ys.push(br.value); availability.push(maxIso(ar.available_at, br.available_at));
      }
      const enough = xs.length >= effective.min_overlap;
      const pCorr = enough ? pearson(xs, ys) : null;
      const sCorr = enough ? pearson(ranks(xs), ranks(ys)) : null;
      pairs.push({
        instruments: [a.id, b.id],
        overlap: xs.length,
        available_at: availability.length ? availability.sort().at(-1) : null,
        pearson: round(pCorr),
        spearman: round(sCorr),
        sign_agreement: round(enough ? signAgreement(xs, ys) : null),
        status: !enough ? 'insufficient_overlap' : (pCorr === null || sCorr === null ? 'constant_or_degenerate' : 'ok'),
      });
    }
  }
  return {
    parameters: effective,
    observations: {
      baseline_note: 'Aligned return similarity baseline; missing, disjoint and constant series are explicit null statuses.',
      instruments: prepared.map(inst => ({ id: inst.id, return_count: inst.returns.size })),
      pairs,
    },
    limitations: [
      'Only exact adjacent return endpoint pairs are compared; no calendar inference or forward fill is performed.',
      'Correlation is descriptive and unstable on short samples; it is not return probability or causal evidence.',
      'ABU SimilarBu has additional search helpers; this package keeps bounded pairwise metrics for Agent workflows.',
    ],
  };
}

runCli(import.meta.url, analyze);
