// Executable research baseline, not a standard answer or a broker backtest.
// All factor values and diagnostics are computed locally; no generated code is executed.
import { createHash } from 'node:crypto';

export const EVALUATOR_VERSION = 'sesame-factor-ast/1.1.0';
const MAX_ROWS = 20000;
const MAX_NODES = 128;
const MAX_DEPTH = 12;
const MAX_WORK = 2048;
const prepared = new WeakSet();
const binary = new Set(['add', 'sub', 'mul', 'div']);
const unary = new Set(['neg', 'abs', 'log', 'rank', 'zscore']);
const rolling = new Set(['lag', 'delta', 'mean', 'std', 'sum']);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const numeric = value => finite(value) ? value : null;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const namePattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const safeName = value => typeof value === 'string' && namePattern.test(value)
  && !['__proto__', 'prototype', 'constructor'].includes(value);

function keys(value, expected, label) {
  assert(plain(value), `${label}: object required`);
  assert(Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)),
    `${label}: expected exactly ${expected.join(', ')}`);
}

function timestamp(value, label) {
  assert(typeof value === 'string', `${label}: ISO timestamp with timezone required`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  assert(match, `${label}: ISO timestamp with explicit timezone required`);
  const [, year, month, day, hour, minute, second, , zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const calendar = new Date(0);
  calendar.setUTCFullYear(y, m - 1, d);
  calendar.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  assert(calendar.getUTCFullYear() === y && calendar.getUTCMonth() === m - 1 && calendar.getUTCDate() === d
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60,
  `${label}: invalid calendar timestamp`);
  assert(zone === 'Z' || (Number(zone.slice(1, 3)) < 24 && Number(zone.slice(4)) < 60), `${label}: invalid timezone`);
  const result = new Date(value);
  assert(Number.isFinite(result.getTime()), `${label}: invalid timestamp`);
  assert(result.getUTCFullYear() >= 0 && result.getUTCFullYear() <= 9999, `${label}: UTC year outside supported ISO range`);
  return result.toISOString();
}

function hash(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

export const OPERATORS = freeze({
  field: 'Numeric field available at the row timestamp; absent fields remain unavailable.',
  constant: 'A finite numeric constant.',
  add: 'a + b', sub: 'a - b', mul: 'a * b', div: 'a / b; zero denominator is unavailable.',
  neg: '-a', abs: '|a|', log: 'Natural logarithm; nonpositive inputs are unavailable.',
  rank: 'Cross-sectional average rank mapped to [0, 1]; ties share ranks; singleton is unavailable.',
  zscore: 'Cross-sectional population z-score; zero variance is unavailable.',
  lag: 'Value window previous observations of the same symbol.',
  delta: 'Current value minus value window previous observations of the same symbol.',
  mean: 'Trailing full-window mean, including current observation; missing inputs invalidate window.',
  std: 'Trailing full-window population standard deviation; missing inputs invalidate window.',
  sum: 'Trailing full-window sum; missing inputs invalidate window.',
});

/** Validate and copy a bounded expression. This is an AST interpreter, never eval(). */
export function validateExpression(expression) {
  let nodes = 0, work = 0;
  function visit(node, depth) {
    assert(depth <= MAX_DEPTH, `Expression depth exceeds ${MAX_DEPTH}`);
    assert(++nodes <= MAX_NODES, `Expression nodes exceed ${MAX_NODES}`);
    assert(plain(node) && typeof node.op === 'string', 'Expression node needs an operator');
    work++;
    if (node.op === 'field') {
      keys(node, ['op', 'name'], 'field');
      assert(safeName(node.name), 'field: safe field name required');
      return { op: 'field', name: node.name };
    }
    if (node.op === 'constant') {
      keys(node, ['op', 'value'], 'constant');
      assert(finite(node.value), 'constant: finite number required');
      return { op: 'constant', value: node.value };
    }
    assert(binary.has(node.op) || unary.has(node.op) || rolling.has(node.op), `Unsupported operator: ${node.op}`);
    keys(node, rolling.has(node.op) ? ['op', 'args', 'window'] : ['op', 'args'], node.op);
    assert(Array.isArray(node.args) && node.args.length === (binary.has(node.op) ? 2 : 1), `${node.op}: wrong argument count`);
    const result = { op: node.op, args: node.args.map(child => visit(child, depth + 1)) };
    if (rolling.has(node.op)) {
      assert(Number.isSafeInteger(node.window) && node.window >= 1 && node.window <= 252, `${node.op}: window must be an integer from 1 to 252`);
      result.window = node.window;
      if (!['lag', 'delta'].includes(node.op)) work += node.window;
    }
    assert(work <= MAX_WORK, `Expression rolling work exceeds ${MAX_WORK}`);
    return result;
  }
  return freeze(visit(expression, 1));
}

/**
 * Rows are copied, sorted and sealed. Split ends are inclusive. The public summary
 * contains development data only; callers must not pass dataset.rows to agents.
 * horizon counts distinct market timestamps, so return endpoints align by date.
 */
export function prepareDataset(rows, config, { developmentOnly = false } = {}) {
  assert(Array.isArray(rows) && rows.length >= 1 && rows.length <= MAX_ROWS, `Dataset must contain 1–${MAX_ROWS} rows`);
  assert(plain(config), 'Dataset config required');
  const allowed = ['trainEnd', 'validationEnd', 'holdoutEnd', 'horizon', 'costBps', 'quantile', 'mode'];
  assert(Object.keys(config).every(key => allowed.includes(key)), 'Unknown dataset config field');
  const normalized = {
    trainEnd: timestamp(config.trainEnd, 'trainEnd'),
    validationEnd: timestamp(config.validationEnd, 'validationEnd'),
    holdoutEnd: timestamp(config.holdoutEnd ?? (developmentOnly ? config.validationEnd : undefined), 'holdoutEnd'),
    horizon: config.horizon ?? 1,
    costBps: config.costBps ?? 10,
    quantile: config.quantile ?? 0.25,
    mode: config.mode ?? 'auto',
  };
  assert(['auto', 'cross-sectional', 'time-series'].includes(normalized.mode), 'mode must be auto, cross-sectional or time-series');
  assert(normalized.trainEnd < normalized.validationEnd && (developmentOnly ? normalized.validationEnd <= normalized.holdoutEnd : normalized.validationEnd < normalized.holdoutEnd),
    'Require trainEnd < validationEnd < holdoutEnd');
  assert(Number.isSafeInteger(normalized.horizon) && normalized.horizon >= 1 && normalized.horizon <= 252,
    'horizon must be an integer from 1 to 252');
  assert(finite(normalized.costBps) && normalized.costBps >= 0 && normalized.costBps <= 10000,
    'costBps must be a finite one-way cost from 0 to 10000');
  assert(finite(normalized.quantile) && normalized.quantile > 0 && normalized.quantile <= 0.5,
    'quantile must be greater than 0 and at most 0.5');
  const seen = new Set();
  const copied = rows.map((row, index) => {
    keys(row, ['time', 'symbol', 'availableAt', 'fields'], `row ${index}`);
    const time = timestamp(row.time, `row ${index}.time`);
    const availableAt = timestamp(row.availableAt, `row ${index}.availableAt`);
    assert(availableAt <= time, `Point-in-time violation: row ${index} became available after its decision time`);
    assert(time <= normalized.holdoutEnd, `Row ${index} is after holdoutEnd`);
    assert(!developmentOnly || time <= normalized.validationEnd, `Development-only input contains a row after validationEnd: ${index}`);
    assert(typeof row.symbol === 'string' && row.symbol.trim() === row.symbol && row.symbol.length >= 1
      // eslint-disable-next-line no-control-regex -- Symbols must not contain control characters.
      && row.symbol.length <= 80 && !/[\u0000-\u001f]/.test(row.symbol), `row ${index}: valid symbol required`);
    const key = `${time}\u0000${row.symbol}`;
    assert(!seen.has(key), `Duplicate time/symbol: ${time} ${row.symbol}`);
    seen.add(key);
    assert(plain(row.fields) && Object.keys(row.fields).length >= 1 && Object.keys(row.fields).length <= 64,
      `row ${index}: 1–64 numeric fields required`);
    const fields = {};
    for (const name of Object.keys(row.fields).sort()) {
      assert(safeName(name) && finite(row.fields[name]), `row ${index}: fields must have safe names and finite numeric values`);
      fields[name] = row.fields[name];
    }
    assert(Object.hasOwn(fields, 'close') && fields.close > 0, `row ${index}: positive finite close required`);
    return { time, symbol: row.symbol, availableAt, fields };
  }).sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
  const development = copied.filter(row => row.time <= normalized.validationEnd);
  if (normalized.mode === 'auto') normalized.mode = new Set(development.map(row => row.symbol)).size === 1 ? 'time-series' : 'cross-sectional';
  assert(development.some(row => row.time <= normalized.trainEnd), 'Training split contains no rows');
  assert(development.some(row => row.time > normalized.trainEnd), 'Validation split contains no rows');
  assert(developmentOnly || copied.some(row => row.time > normalized.validationEnd), 'Holdout split contains no rows');
  const summary = {
    rows: development.length,
    trainRows: development.filter(row => row.time <= normalized.trainEnd).length,
    validationRows: development.filter(row => row.time > normalized.trainEnd).length,
    symbols: [...new Set(development.map(row => row.symbol))].sort(),
    fields: [...new Set(development.flatMap(row => Object.keys(row.fields)))].sort(),
    start: development[0].time,
    end: development.at(-1).time,
    holdoutSealed: !developmentOnly,
    horizonUnit: 'distinct-market-timestamps',
    developmentDigest: hash({ config: normalized, rows: development }),
  };
  const dataset = freeze({ evaluatorVersion: EVALUATOR_VERSION, ...(developmentOnly ? { access: 'development-only' } : {}), config: normalized, rows: copied,
    summary, digest: hash({ config: normalized, rows: copied }) });
  prepared.add(dataset);
  return dataset;
}

function checkedDataset(dataset) {
  assert(plain(dataset), 'Prepared dataset required');
  return prepared.has(dataset) ? dataset : prepareDataset(dataset.rows, dataset.config, { developmentOnly: dataset.access === 'development-only' });
}

function groups(rows, key) {
  const result = new Map();
  rows.forEach((row, index) => {
    if (!result.has(row[key])) result.set(row[key], []);
    result.get(row[key]).push(index);
  });
  return result;
}

export function average(values) {
  if (!values.length) return null;
  const scale = values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
  if (scale === 0) return 0;
  return numeric(scale * (values.reduce((sum, value) => sum + value / scale, 0) / values.length));
}

function sampleSD(values) {
  if (values.length < 2) return null;
  const m = average(values);
  return numeric(Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2 / (values.length - 1), 0)));
}

function ranks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = Array(values.length);
  for (let first = 0; first < order.length;) {
    let end = first + 1;
    while (end < order.length && order[end].value === order[first].value) end++;
    for (let i = first; i < end; i++) result[order[i].index] = (first + end - 1) / 2;
    first = end;
  }
  return result;
}

export function rankCorrelation(x, y) {
  if (x.length < 2) return null;
  const a = ranks(x), b = ranks(y), am = average(a), bm = average(b);
  let product = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    product += (a[i] - am) * (b[i] - bm);
    aa += (a[i] - am) ** 2;
    bb += (b[i] - bm) ** 2;
  }
  return aa > 0 && bb > 0 ? numeric(Math.max(-1, Math.min(1, product / Math.sqrt(aa * bb)))) : null;
}

function compute(rows, expression) {
  const bySymbol = groups(rows, 'symbol'), byTime = groups(rows, 'time'), cache = new Map();
  function run(node) {
    const key = JSON.stringify(node);
    if (cache.has(key)) return cache.get(key);
    let values = Array(rows.length).fill(null);
    if (node.op === 'field') values = rows.map(row => numeric(row.fields[node.name]));
    else if (node.op === 'constant') values.fill(node.value);
    else {
      const operands = node.args.map(run), a = operands[0], b = operands[1];
      if (binary.has(node.op)) values = a.map((value, index) => {
        if (value === null || b[index] === null) return null;
        switch (node.op) {
          case 'add': return numeric(value + b[index]);
          case 'sub': return numeric(value - b[index]);
          case 'mul': return numeric(value * b[index]);
          default: return b[index] === 0 ? null : numeric(value / b[index]);
        }
      });
      else if (['neg', 'abs', 'log'].includes(node.op)) values = a.map(value => {
        if (value === null) return null;
        if (node.op === 'neg') return numeric(-value);
        if (node.op === 'abs') return Math.abs(value);
        return value > 0 ? numeric(Math.log(value)) : null;
      });
      else if (['rank', 'zscore'].includes(node.op)) {
        for (const indexes of byTime.values()) {
          const valid = indexes.filter(index => a[index] !== null);
          if (valid.length < 2) continue;
          const input = valid.map(index => a[index]);
          if (node.op === 'rank') ranks(input).forEach((value, i) => { values[valid[i]] = value / (valid.length - 1); });
          else {
            const m = average(input);
            const sd = numeric(Math.sqrt(input.reduce((sum, value) => sum + (value - m) ** 2 / input.length, 0)));
            if (sd !== null && sd > 0) valid.forEach(index => { values[index] = numeric((a[index] - m) / sd); });
          }
        }
      } else {
        for (const indexes of bySymbol.values()) for (let pos = 0; pos < indexes.length; pos++) {
          const index = indexes[pos], window = node.window;
          if (node.op === 'lag' || node.op === 'delta') {
            if (pos < window) continue;
            const prior = a[indexes[pos - window]];
            values[index] = node.op === 'lag' ? prior : (a[index] === null || prior === null ? null : numeric(a[index] - prior));
            continue;
          }
          if (pos + 1 < window) continue;
          let count = 0, m = 0, m2 = 0, sum = 0;
          for (let j = pos + 1 - window; j <= pos; j++) {
            const value = a[indexes[j]];
            if (value === null) break;
            const delta = value - m;
            m += delta / ++count;
            m2 += delta * (value - m);
            sum += value;
          }
          if (count !== window) continue;
          values[index] = numeric(node.op === 'sum' ? sum : node.op === 'std' ? Math.sqrt(Math.max(0, m2 / count)) : m);
        }
      }
    }
    cache.set(key, values);
    return values;
  }
  return { values: run(expression), byTime };
}

export function compound(returns) {
  if (!returns.length) return { return: null, maxDrawdown: null, insolvent: false };
  let nav = 1, peak = 1, maxDrawdown = 0;
  for (const value of returns) {
    if (value <= -1) return { return: null, maxDrawdown: null, insolvent: true };
    nav *= 1 + value;
    if (!Number.isFinite(nav)) return { return: null, maxDrawdown: null, insolvent: false };
    peak = Math.max(peak, nav);
    maxDrawdown = Math.max(maxDrawdown, 1 - nav / peak);
  }
  return { return: numeric(nav - 1), maxDrawdown: numeric(maxDrawdown), insolvent: false };
}

export function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * fraction;
  const lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] * (hi - position || 1) + (hi === lo ? 0 : sorted[hi] * (position - lo));
}

function timeSeriesMetrics(rows, values, config, name, byTime, details, fitEnd) {
  const times = [...byTime.keys()];
  const start = name === 'train' ? null : name === 'validation' ? config.trainEnd : config.validationEnd;
  const end = config[`${name}End`];
  const lookup = new Map(rows.map((row, index) => [`${row.time}\u0000${row.symbol}`, index]));
  const training = new Map();
  for (let index = 0; index < rows.length; index++) if (rows[index].time <= fitEnd && values[index] !== null) {
    const symbol = rows[index].symbol;
    if (!training.has(symbol)) training.set(symbol, []);
    training.get(symbol).push(values[index]);
  }
  const thresholds = Object.fromEntries([...training].map(([symbol, input]) => [symbol, {
    low: quantile(input, config.quantile), high: quantile(input, 1 - config.quantile), observations: input.length,
  }]));
  details.observations = []; details.ic = []; details.returns = [];
  details.thresholds = { fitEnd, bySymbol: thresholds };
  let rowCount = 0, dates = 0, factorObservations = 0, labelObservations = 0;
  let purgedBoundaryRows = 0, missingForwardRows = 0, numericReturnFailures = 0, overlapSkippedPeriods = 0;
  let previousEnd = null;
  for (let position = 0; position < times.length; position++) {
    const time = times[position];
    if ((start !== null && time <= start) || time > end) continue;
    dates++;
    const endTime = times[position + config.horizon], active = [];
    for (const index of byTime.get(time)) {
      rowCount++;
      if (values[index] !== null) factorObservations++;
      if (endTime === undefined || endTime > end) { purgedBoundaryRows++; continue; }
      const row = rows[index], next = lookup.get(`${endTime}\u0000${row.symbol}`);
      if (next === undefined) { missingForwardRows++; continue; }
      const label = numeric(rows[next].fields.close / row.fields.close - 1);
      if (label === null) { numericReturnFailures++; continue; }
      labelObservations++;
      if (values[index] === null) continue;
      details.observations.push({ time, endTime, symbol: row.symbol, value: values[index], label, fields: row.fields });
      const cutoff = Object.hasOwn(thresholds, row.symbol) ? thresholds[row.symbol] : null;
      if (!cutoff || cutoff.low === null || cutoff.low >= cutoff.high) continue;
      const direction = values[index] > cutoff.high ? 1 : values[index] < cutoff.low ? -1 : 0;
      if (direction) active.push(direction * label);
    }
    if (!active.length) continue;
    if (previousEnd !== null && time < previousEnd) { overlapSkippedPeriods++; continue; }
    const gross = average(active), net = numeric(gross - 2 * config.costBps / 10000);
    if (net === null) { numericReturnFailures++; continue; }
    details.returns.push({ time, endTime, gross, net }); previousEnd = endTime;
  }
  const bySymbol = groups(details.observations, 'symbol');
  const series = [...bySymbol].map(([symbol, indexes]) => {
    const paired = indexes.map(index => details.observations[index]);
    return { symbol, observations: paired.length, rankIC: paired.length >= 4 ? rankCorrelation(paired.map(row => row.value), paired.map(row => row.label)) : null };
  });
  const measured = series.filter(item => item.rankIC !== null);
  const rankIC = average(measured.map(item => item.rankIC));
  const grossReturns = details.returns.map(item => item.gross), netReturns = details.returns.map(item => item.net);
  const gross = compound(grossReturns), net = compound(netReturns);
  return {
    rows: rowCount, dates, factorObservations, labelObservations, eligibleObservations: details.observations.length,
    coverage: rowCount ? factorObservations / rowCount : null, labelCoverage: rowCount ? labelObservations / rowCount : null,
    rankIC, rankICMean: rankIC, rankICStd: null, rankICIR: null, validICPeriods: 0,
    validICSeries: measured.length, rankICMethod: 'equal-weight-per-symbol-time-series-spearman',
    perSymbol: series.slice(0, 32), symbolCount: series.length, omittedSymbolDetails: Math.max(0, series.length - 32),
    portfolioPeriods: netReturns.length, grossReturn: gross.return, netReturn: net.return,
    meanGrossReturn: average(grossReturns), meanNetReturn: average(netReturns),
    turnover: netReturns.length ? 2 : null, totalTurnover: netReturns.length * 2, costPerPeriod: 2 * config.costBps / 10000,
    maxDrawdown: net.maxDrawdown, grossMaxDrawdown: gross.maxDrawdown, insolvent: net.insolvent,
    thresholdFitEnd: fitEnd, purgedBoundaryRows, missingForwardRows, numericReturnFailures, overlapSkippedPeriods,
  };
}

function metrics(rows, values, config, name, byTime, details = {}, fitEnd = config.trainEnd) {
  if (config.mode === 'time-series') return timeSeriesMetrics(rows, values, config, name, byTime, details, fitEnd);
  details.observations = []; details.ic = []; details.returns = [];
  const times = [...byTime.keys()];
  const start = name === 'train' ? null : name === 'validation' ? config.trainEnd : config.validationEnd;
  const end = config[`${name === 'train' ? 'train' : name === 'validation' ? 'validation' : 'holdout'}End`];
  const lookup = new Map(rows.map((row, index) => [`${row.time}\u0000${row.symbol}`, index]));
  let rowCount = 0, factorObservations = 0, labelObservations = 0, eligibleObservations = 0;
  let purgedBoundaryRows = 0, missingForwardRows = 0, numericReturnFailures = 0;
  let dates = 0, insufficientCrossSections = 0, tiedTails = 0, overlapSkippedPeriods = 0;
  let previousEnd = null;
  const ic = [], grossReturns = [], netReturns = [];
  for (let position = 0; position < times.length; position++) {
    const time = times[position];
    if ((start !== null && time <= start) || time > end) continue;
    dates++;
    const indexes = byTime.get(time), endTime = times[position + config.horizon], paired = [];
    rowCount += indexes.length;
    for (const index of indexes) {
      if (values[index] !== null) factorObservations++;
      if (endTime === undefined || endTime > end) { purgedBoundaryRows++; continue; }
      const next = lookup.get(`${endTime}\u0000${rows[index].symbol}`);
      if (next === undefined) { missingForwardRows++; continue; }
      const label = numeric(rows[next].fields.close / rows[index].fields.close - 1);
      if (label === null) { numericReturnFailures++; continue; }
      labelObservations++;
      if (values[index] !== null) paired.push({ time, endTime, symbol: rows[index].symbol, fields: rows[index].fields, value: values[index], label });
    }
    eligibleObservations += paired.length;
    details.observations.push(...paired);
    if (paired.length < 4) { insufficientCrossSections++; continue; }
    const correlation = rankCorrelation(paired.map(row => row.value), paired.map(row => row.label));
    if (correlation !== null) { ic.push(correlation); details.ic.push({ time, value: correlation }); }
    // Full tied groups must fit in a tail. Symbol ordering never creates a signal.
    const ordered = [...paired].sort((a, b) => a.value - b.value);
    const tail = Math.max(1, Math.floor(ordered.length * config.quantile));
    const low = ordered.slice(0, tail), high = ordered.slice(-tail);
    const lowCut = low.at(-1).value, highCut = high[0].value;
    const lowSafe = ordered[tail]?.value === lowCut ? low.filter(row => row.value !== lowCut) : low;
    const highSafe = ordered[ordered.length - tail - 1]?.value === highCut ? high.filter(row => row.value !== highCut) : high;
    if (!lowSafe.length || !highSafe.length || lowSafe.at(-1).value >= highSafe[0].value) { tiedTails++; continue; }
    if (previousEnd !== null && time < previousEnd) { overlapSkippedPeriods++; continue; }
    const gross = numeric(0.5 * average(highSafe.map(row => row.label)) - 0.5 * average(lowSafe.map(row => row.label)));
    const net = gross === null ? null : numeric(gross - 2 * config.costBps / 10000);
    if (net === null) { numericReturnFailures++; continue; }
    grossReturns.push(gross);
    netReturns.push(net);
    details.returns.push({ time, endTime, gross, net });
    previousEnd = endTime;
  }
  const rankIC = average(ic), rankICStd = sampleSD(ic);
  const gross = compound(grossReturns), net = compound(netReturns);
  return {
    rows: rowCount, dates, factorObservations, labelObservations, eligibleObservations,
    coverage: rowCount ? factorObservations / rowCount : null,
    labelCoverage: rowCount ? labelObservations / rowCount : null,
    validICPeriods: ic.length, rankIC, rankICMean: rankIC, rankICStd,
    rankICMethod: 'mean-cross-sectional-spearman',
    rankICIR: rankICStd !== null && rankICStd > 0 ? numeric(rankIC / rankICStd) : null,
    portfolioPeriods: netReturns.length,
    grossReturn: gross.return, netReturn: net.return,
    meanGrossReturn: average(grossReturns), meanNetReturn: average(netReturns),
    turnover: netReturns.length ? 2 : null, totalTurnover: netReturns.length * 2,
    costPerPeriod: 2 * config.costBps / 10000,
    maxDrawdown: net.maxDrawdown, grossMaxDrawdown: gross.maxDrawdown,
    insolvent: net.insolvent,
    purgedBoundaryRows, missingForwardRows, numericReturnFailures,
    insufficientCrossSections, tiedTails, overlapSkippedPeriods,
  };
}

const limitations = freeze([
  'Factor association and direction returns are research measurements, not a broker execution backtest.',
  'Availability timestamps are checked, not independently verified. Universe selection, corporate actions, delistings and vendor revisions require separate point-in-time evidence.',
  'Forward returns use supplied closes at aligned market timestamps. Entering at the observed close is an idealized assumption; latency, liquidity, short availability, impact and borrowing costs are not modeled.',
  'Portfolio diagnostics hold half long and half short with gross exposure one. Each nonoverlapping interval starts and ends flat, incurs absolute turnover two and fixed one-way costs twice.',
  'Rank IC is the mean per-date Spearman correlation with at least four paired assets. ICIR is mean divided by sample standard deviation, not annualized or adjusted for overlapping labels.',
  'Boundary-crossing labels are purged. Missing fields or endpoints are not imputed. Tied groups crossing a quantile cutoff are omitted; this can leave a date without a portfolio.',
  'Rolling windows count observations for each symbol; forward horizon counts distinct market timestamps. Missing bars can therefore affect the effective duration.',
  'This engine cannot enforce an untouched holdout outside its caller. The workflow must freeze candidate selection and record every holdout exposure before calling holdout evaluation.',
]);

export function evaluateFactor(input, expression, { holdout = false } = {}) {
  assert(typeof holdout === 'boolean', 'holdout must be boolean');
  const dataset = checkedDataset(input), normalized = validateExpression(expression);
  assert(!holdout || dataset.access !== 'development-only', 'Development-only evaluation has no holdout');
  const cutoff = holdout ? dataset.config.holdoutEnd : dataset.config.validationEnd;
  const rows = dataset.rows.filter(row => row.time <= cutoff);
  const { values, byTime } = compute(rows, normalized);
  const result = {
    evaluatorVersion: EVALUATOR_VERSION,
    expression: normalized,
    expressionDigest: hash(normalized),
    dataDigest: hash({ config: dataset.config, rows }),
    protocol: {
      splitEnds: 'inclusive', mode: dataset.config.mode, minAssets: dataset.config.mode === 'time-series' ? 1 : 4, horizon: dataset.config.horizon,
      horizonUnit: 'distinct-market-timestamps', rankICIR: 'not-annualized',
      portfolio: dataset.config.mode === 'time-series' ? 'train-quantile-direction-equal-active-symbols-flat-to-flat' : 'gross-one-half-long-half-short-flat-to-flat',
      costBps: dataset.config.costBps, quantile: dataset.config.quantile,
      portfolioSampling: 'nonoverlapping',
    },
    limitations: dataset.config.mode === 'time-series' ? [
      'Time-series Rank IC measures within-symbol factor/forward-return association; multiple symbols are averaged equally without pooling prices or labels.',
      'Direction diagnostics use only training factor quantiles, fixed through validation and holdout, with nonoverlapping close-to-close periods and two fixed one-way costs. They are not executed trades, win rates or per-trade R.',
      ...limitations.filter(text => !text.startsWith('Portfolio diagnostics') && !text.startsWith('Rank IC is')),
    ] : limitations,
  };
  if (holdout) result.holdout = metrics(rows, values, dataset.config, 'holdout', byTime);
  else {
    result.train = metrics(rows, values, dataset.config, 'train', byTime);
    result.validation = metrics(rows, values, dataset.config, 'validation', byTime);
  }
  return result;
}

/** Internal numerical evidence for optional diagnostics. Bounds never expose a later split. */
export function factorEvidence(input, expression, { split = 'validation', start, end, fitEnd } = {}) {
  const dataset = checkedDataset(input), normalized = validateExpression(expression);
  assert(['train', 'validation', 'holdout'].includes(split), 'Unknown evidence split');
  assert(split !== 'holdout' || dataset.access !== 'development-only', 'Development-only evaluation has no holdout');
  const cutoff = end ?? dataset.config[`${split}End`];
  assert(cutoff <= dataset.config[`${split}End`], 'Diagnostic end exceeds its split');
  const config = { ...dataset.config, [`${split}End`]: cutoff };
  if (start !== undefined) { assert(split === 'validation', 'Custom start requires validation split'); config.trainEnd = start; }
  const thresholdEnd = fitEnd ?? config.trainEnd;
  assert(thresholdEnd <= config.trainEnd, 'Threshold fitting must end before validation');
  const rows = dataset.rows.filter(row => row.time <= cutoff), computed = compute(rows, normalized), details = {};
  const result = metrics(rows, computed.values, config, split, computed.byTime, details, thresholdEnd);
  return { ...details, metrics: result, mode: dataset.config.mode };
}

/** Train-only redundancy: average of finite per-date rank correlations. */
export function compareFactors(input, expressionA, expressionB) {
  const dataset = checkedDataset(input);
  const a = validateExpression(expressionA), b = validateExpression(expressionB);
  const rows = dataset.rows.filter(row => row.time <= dataset.config.trainEnd);
  const resultA = compute(rows, a), resultB = compute(rows, b);
  const correlations = [];
  let observations = 0;
  const comparisonGroups = dataset.config.mode === 'time-series' ? groups(rows, 'symbol') : resultA.byTime;
  for (const indexes of comparisonGroups.values()) {
    const paired = indexes.filter(index => resultA.values[index] !== null && resultB.values[index] !== null);
    if (paired.length < 4) continue;
    const correlation = rankCorrelation(paired.map(index => resultA.values[index]), paired.map(index => resultB.values[index]));
    if (correlation !== null) { correlations.push(correlation); observations += paired.length; }
  }
  return {
    evaluatorVersion: EVALUATOR_VERSION,
    scope: 'train', method: dataset.config.mode === 'time-series' ? 'equal-weight-per-symbol-time-series-spearman' : 'mean-cross-sectional-spearman',
    correlation: average(correlations), periods: correlations.length, observations,
  };
}
