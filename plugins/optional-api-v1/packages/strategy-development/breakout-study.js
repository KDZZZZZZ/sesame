import { Decimal } from '@sesame/plugin-sdk/decimal';
import { requireThat } from './records.js';

const fields = ['datetime', 'open', 'high', 'low', 'close'];
const instrumentFields = ['symbol', 'instrument', 'instrumentId', 'instrument_id'];
const measures = {
  meanGapOnSignalClose: 'gapOnSignalClose',
  meanContinuationOnSignalClose: 'continuationOnSignalClose',
  meanTotalOnSignalClose: 'totalOnSignalClose',
  meanContinuationOnNextOpen: 'continuationOnNextOpen',
};
const datedTime = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3}0*)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function utcTime(raw) {
  if (raw?.basis === 'utc' && Number.isSafeInteger(raw.unixMs) && Math.abs(raw.unixMs) <= 8.64e15) return raw.unixMs;
  const match = typeof raw === 'string' && datedTime.exec(raw);
  if (!match) return NaN;
  const midnight = Date.parse(match[1] + 'T00:00:00Z');
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== match[1]) return NaN;
  return Date.parse(raw);
}

function price(raw, row, field) {
  requireThat((typeof raw === 'string' || typeof raw === 'number') && Number.isFinite(Number(raw)) && Number(raw) > 0,
    'Row ' + row + ' requires a positive finite ' + field + ' price.');
  let text = String(raw);
  // JSON numbers may serialize a valid price in exponential notation. Keep supplied decimal strings exact.
  if (typeof raw === 'number' && text.includes('e')) {
    const [mantissa, exponent] = text.split('e');
    const [integer, fraction = ''] = mantissa.split('.'), digits = integer + fraction, point = integer.length + Number(exponent);
    const expanded = point <= 0 ? '0.' + '0'.repeat(-point) + digits
      : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point) + '.' + digits.slice(point);
    text = expanded;
  }
  requireThat(text.length <= 4096 && /^(0|[1-9]\d*)(\.\d+)?$/.test(text),
    'Row ' + row + ' has an invalid ' + field + ' price. Supply a finite JSON number or a plain decimal string.');
  return text;
}

function instrumentAt(row, key, index) {
  const value = row[key], validId = id => typeof id === 'string' && id.trim().length > 0 || Number.isSafeInteger(id);
  if (validId(value)) return value;
  if (key === 'instrument' && validId(value?.instrumentId) && (!Object.hasOwn(value, 'sourceId') || validId(value.sourceId))) {
    return { ...(value.sourceId === undefined ? {} : { sourceId: value.sourceId }), instrumentId: value.instrumentId };
  }
  requireThat(false, 'Row ' + index + ' has a missing or invalid ' + key + ' identifier. Supply a single-instrument series.');
}

function readBars(rows, columns, signal) {
  requireThat(Array.isArray(rows) && rows.length >= 2 && rows.length <= 100000, 'A breakout study requires 2–100000 development bars.');
  const names = fields.map(key => columns?.[key] ?? key);
  requireThat(names.every(name => typeof name === 'string' && name.length) && new Set(names).size === fields.length,
    'Map distinct datetime, open, high, low and close columns.');
  const identifiers = {};
  let previous = -Infinity;
  const bars = Array.from(rows, (row, i) => {
    if (i % 1024 === 0) signal?.throwIfAborted();
    const time = utcTime(row?.[names[0]]);
    requireThat(Number.isFinite(time) && time > previous, 'Row ' + i + ' needs a valid strictly increasing, timezone-qualified bar time at millisecond precision.');
    previous = time;
    for (const key of instrumentFields) {
      const present = Object.hasOwn(row, key);
      if (i === 0 && present) identifiers[key] = instrumentAt(row, key, i);
      else {
        requireThat(present === Object.hasOwn(identifiers, key), 'Row ' + i + ' has inconsistent or missing ' + key + ' coverage in the single-instrument series.');
        if (present) requireThat(JSON.stringify(instrumentAt(row, key, i)) === JSON.stringify(identifiers[key]),
          'Row ' + i + ' changes the ' + key + ' identifier. Supply a single-instrument series.');
      }
    }
    const [open, high, low, close] = names.slice(1).map((name, j) => price(row[name], i, fields[j + 1]));
    requireThat([open, close].every(value => Decimal.compare(low, value) <= 0 && Decimal.compare(value, high) <= 0),
      'Row ' + i + ' has an open or close outside its low/high range.');
    return { time, open, high, low, close };
  });
  const instrument = { basis: Object.keys(identifiers).length ? 'row_identifiers' : 'caller_declared_single_series', identifiers };
  return { bars, instrument };
}

function fraction(change, base) {
  const value = Number(Decimal.div(change, base));
  requireThat(Number.isFinite(value) && (value !== 0 || change === '0'), 'A development return exceeds the numeric result range.');
  return value;
}

function forwardLabels(signal, next, last) {
  const continuation = Decimal.sub(last.close, next.open);
  return {
    gapOnSignalClose: fraction(Decimal.sub(next.open, signal.close), signal.close),
    continuationOnSignalClose: fraction(continuation, signal.close),
    totalOnSignalClose: fraction(Decimal.sub(last.close, signal.close), signal.close),
    continuationOnNextOpen: fraction(continuation, next.open),
  };
}

function accumulator() {
  return { count: 0, labeled: 0, rightCensored: 0, continuationWins: 0, ...Object.fromEntries(Object.keys(measures).map(key => [key, null])) };
}

function observe(stats, label, sign) {
  stats.count++;
  if (!label) { stats.rightCensored++; return; }
  const n = ++stats.labeled;
  if (sign * label.continuationOnNextOpen > 0) stats.continuationWins++;
  for (const [key, field] of Object.entries(measures)) {
    const value = sign * label[field] || 0;
    stats[key] = n === 1 ? value : stats[key] * ((n - 1) / n) + value / n;
  }
}

const iso = bar => new Date(bar.time).toISOString();
function example(bars, i, lookback, horizon, threshold, label, sign) {
  const next = bars[i + 1], last = bars[i + horizon];
  return { decisionIndex: i, signalBarTime: iso(bars[i]), signalClose: bars[i].close, priorExtreme: threshold,
    lookbackFirstBarTime: iso(bars[i - lookback]), lookbackLastBarTime: iso(bars[i - 1]),
    nextOpenBarTime: next ? iso(next) : null, nextOpen: next?.open ?? null,
    horizonBarTime: last ? iso(last) : null, horizonClose: last?.close ?? null, availableFollowingBars: Math.min(horizon, bars.length - i - 1),
    labels: label ? Object.fromEntries(Object.entries(label).map(([key, value]) => [key, sign * value || 0])) : null };
}

export function analyzeBreakoutStudy(rows, columns, options, signal) {
  signal?.throwIfAborted();
  const { lookback, horizon, side } = options ?? {};
  requireThat([lookback, horizon].every(value => Number.isInteger(value) && value >= 1 && value <= 500), 'Use integer lookback and horizon values from 1 to 500 bars.');
  requireThat(['long', 'short', 'both'].includes(side), 'Choose long, short or both breakout directions.');
  const { bars, instrument } = readBars(rows, columns, signal);
  const arms = (side === 'both' ? ['long', 'short'] : [side]).map(name => ({
    name, sign: name === 'long' ? 1 : -1, extreme: name === 'long' ? 'high' : 'low', queue: [], head: 0,
    opportunities: accumulator(), allDecisions: accumulator(), examples: { labeled: [], rightCensored: [] },
  }));
  for (let i = 0; i < bars.length; i++) {
    if (i % 1024 === 0) signal?.throwIfAborted();
    const eligible = i >= lookback, bar = bars[i];
    const label = eligible && i + horizon < bars.length ? forwardLabels(bar, bars[i + 1], bars[i + horizon]) : null;
    for (const arm of arms) {
      const { sign, extreme, queue } = arm;
      while (arm.head < queue.length && queue[arm.head] < i - lookback) arm.head++;
      if (eligible) {
        // The deque currently contains prior bars only. Today's high/low becomes usable at the next decision.
        const threshold = bars[queue[arm.head]][extreme];
        observe(arm.allDecisions, label, sign);
        if (sign * Decimal.compare(bar.close, threshold) > 0) {
          observe(arm.opportunities, label, sign);
          const samples = label ? arm.examples.labeled : arm.examples.rightCensored;
          if (samples.length < (label ? 4 : 2)) samples.push(example(bars, i, lookback, horizon, threshold, label, sign));
        }
      }
      while (queue.length > arm.head && sign * Decimal.compare(bar[extreme], bars[queue.at(-1)][extreme]) >= 0) queue.pop();
      queue.push(i);
    }
  }
  const sides = {};
  for (const { name, opportunities, allDecisions, examples } of arms) {
    for (const group of [opportunities, allDecisions]) group.continuationWinRate = group.labeled ? group.continuationWins / group.labeled : null;
    const keys = [...Object.keys(measures), 'continuationWinRate'];
    const differenceVsAll = Object.fromEntries(keys.map(key => {
      if (!opportunities.labeled) return [key, null];
      const difference = opportunities[key] - allDecisions[key];
      requireThat(Number.isFinite(difference), 'A descriptive difference exceeds the numeric result range.');
      return [key, difference];
    }));
    sides[name] = { opportunities, allDecisions, differenceVsAll, examples };
  }
  const warmupBars = Math.min(lookback, bars.length), decisions = bars.length - warmupBars, labeled = Math.max(0, decisions - horizon);
  return { method: 'breakout_continuation', parameters: { lookback, horizon, side },
    coverage: { bars: bars.length, warmupBars, decisions, labeled, rightCensored: decisions - labeled, firstBarTime: iso(bars[0]), lastBarTime: iso(bars.at(-1)), instrument },
    sides, interpretation: [
      'Direction-signed gross price changes are decimal fractions. Gap and continuation use the same signal-close denominator and add to the total. Continuation on next open uses the next open as denominator.',
      'At each decision close, compare with the preceding lookback bars, excluding the decision bar. All-decisions controls include every eligible close in the same direction, including breakouts.',
      'Means and win rates use only decisions with a complete in-partition horizon. A win requires a strictly positive continuation. Examples show the earliest four labeled and two censored opportunities per side.',
      'UTC timestamps identify source bars. Open and close are price observations, not actual fills. Overlapping decision horizons can share bars. Descriptive differences do not establish causation or net trading returns.',
    ] };
}
