import { clone, digest } from '@sesame/plugin-sdk/protocol';

// These formulas are ordinary frozen SVL functions. The host does not know RSI,
// ATR, Bollinger bands or a particular portfolio model by name.
const decimal = { kind: 'decimal' }, integer = { kind: 'integer' };
const series = element => ({ kind: 'series', element, maxItems: 512 });
const record = fields => ({ kind: 'record', fields });
const p = parameter => ({ parameter }), literal = value => ({ literal: value }), rec = fields => ({ record: fields });
const missing = literal({ status: 'not_ready' });
function fn(id, parameters, output, build) {
  const nodes = [], op = (name, inputs) => { const id = `n${nodes.length + 1}`; nodes.push({ id, op: name, inputs }); return { node: id }; };
  const get = (value, field) => op('record.get', { record: value, field });
  const select = (condition, whenTrue, whenFalse) => op('value.select', { condition, whenTrue, whenFalse });
  const last = value => op('series.value', { series: value, offset: 0 });
  return { id, parameters, output, result: build({ op, get, select, last }), nodes };
}
const rsiState = record({ previous: decimal, count: decimal, gain: decimal, loss: decimal });
const atrState = record({ previous: decimal, count: decimal, average: decimal });

function wilder(op, select, average, sample, count, period) {
  const seed = op('compare.lt', { left: count, right: period });
  const weight = select(seed, count, op('math.sub', { left: period, right: '1' }));
  const denominator = select(seed, op('math.add', { left: count, right: '1' }), period);
  return op('math.div', { left: op('math.add', { left: op('math.mul', { left: average, right: weight }), right: sample }), right: denominator });
}
const functions = [
  fn('rsiStep', { item: decimal, index: integer, accumulator: rsiState, period: integer }, rsiState, ({ op, get, select }) => {
    const previous = get(p('accumulator'), 'previous'), count = get(p('accumulator'), 'count');
    const delta = op('math.sub', { left: p('item'), right: previous });
    const gain = op('math.max', { values: [delta, '0'] }), loss = op('math.max', { values: [op('math.sub', { left: '0', right: delta }), '0'] });
    return select(op('compare.lt', { left: count, right: '0' }), rec({ previous: p('item'), count: '0', gain: '0', loss: '0' }),
      rec({ previous: p('item'), count: op('math.add', { left: count, right: '1' }),
        gain: wilder(op, select, get(p('accumulator'), 'gain'), gain, count, p('period')),
        loss: wilder(op, select, get(p('accumulator'), 'loss'), loss, count, p('period')) }));
  }),
  fn('rsi', { prices: series(decimal), period: integer }, decimal, ({ op, get, select }) => {
    const result = op('array.reduce', { values: p('prices'), functionId: 'rsiStep', maxItems: 512,
      initial: literal({ previous: '0', count: '-1', gain: '0', loss: '0' }), arguments: rec({ period: p('period') }) });
    const ready = op('logic.all', { values: [op('compare.gt', { left: p('period'), right: 0 }), op('compare.gte', { left: get(result, 'count'), right: p('period') })] });
    const gain = get(result, 'gain'), loss = get(result, 'loss');
    const value = select(op('compare.eq', { left: loss, right: '0' }), select(op('compare.eq', { left: gain, right: '0' }), '50', '100'),
      op('math.sub', { left: '100', right: op('math.div', { left: '100', right: op('math.add', { left: '1', right: op('math.div', { left: gain, right: loss }) }) }) }));
    return select(ready, value, missing);
  }),
  fn('atrStep', { item: record({ high: decimal, low: decimal, close: decimal }), index: integer, accumulator: atrState, period: integer }, atrState, ({ op, get, select }) => {
    const previous = get(p('accumulator'), 'previous'), count = get(p('accumulator'), 'count'), high = get(p('item'), 'high'), low = get(p('item'), 'low'), close = get(p('item'), 'close');
    const tr = op('math.max', { values: [op('math.sub', { left: high, right: low }), op('math.abs', { value: op('math.sub', { left: high, right: previous }) }), op('math.abs', { value: op('math.sub', { left: low, right: previous }) })] });
    const valid = op('logic.all', { values: [op('compare.gte', { left: high, right: low }), op('compare.gte', { left: high, right: close }), op('compare.lte', { left: low, right: close })] });
    return select(valid, select(op('compare.lt', { left: count, right: '0' }), rec({ previous: close, count: '0', average: '0' }),
      rec({ previous: close, count: op('math.add', { left: count, right: '1' }), average: wilder(op, select, get(p('accumulator'), 'average'), tr, count, p('period')) })), missing);
  }),
  fn('atr', { bars: series(record({ high: decimal, low: decimal, close: decimal })), period: integer }, decimal, ({ op, get, select }) => {
    const result = op('array.reduce', { values: p('bars'), functionId: 'atrStep', maxItems: 512, initial: literal({ previous: '0', count: '-1', average: '0' }), arguments: rec({ period: p('period') }) });
    return select(op('logic.all', { values: [op('compare.gt', { left: p('period'), right: 0 }), op('compare.gte', { left: get(result, 'count'), right: p('period') })] }), get(result, 'average'), missing);
  }),
  fn('macd', { prices: series(decimal), fast: integer, slow: integer, signal: integer }, record({ macd: decimal, signal: decimal, histogram: decimal }), ({ op, last }) => {
    const fast = op('series.ema', { series: p('prices'), period: p('fast') }), slow = op('series.ema', { series: p('prices'), period: p('slow') });
    const macd = op('series.sub', { left: fast, right: slow }), signal = op('series.ema', { series: macd, period: p('signal') });
    return rec({ macd: last(macd), signal: last(signal), histogram: last(op('series.sub', { left: macd, right: signal })) });
  }),
  fn('bollinger', { prices: series(decimal), period: integer, deviations: decimal }, record({ middle: decimal, upper: decimal, lower: decimal }), ({ op, last, select }) => {
    const mean = last(op('series.sma', { series: p('prices'), period: p('period') })), sd = last(op('series.std', { series: p('prices'), period: p('period'), ddof: 0 })), distance = op('math.mul', { left: sd, right: p('deviations') });
    return select(op('compare.gte', { left: p('deviations'), right: '0' }), rec({ middle: mean, upper: op('math.add', { left: mean, right: distance }), lower: op('math.sub', { left: mean, right: distance }) }), missing);
  }),
  fn('donchian', { highs: series(decimal), lows: series(decimal), period: integer }, record({ upper: decimal, lower: decimal }), ({ op, last }) => rec({
    upper: last(op('series.max', { series: p('highs'), period: p('period') })), lower: last(op('series.min', { series: p('lows'), period: p('period') })),
  })),
  fn('zscore', { values: series(decimal), period: integer }, decimal, ({ op, last, select }) => {
    const mean = last(op('series.sma', { series: p('values'), period: p('period') })), sd = last(op('series.std', { series: p('values'), period: p('period'), ddof: 0 }));
    return select(op('compare.gt', { left: sd, right: '0' }), op('math.div', { left: op('math.sub', { left: last(p('values')), right: mean }), right: sd }), missing);
  }),
  fn('volatility', { prices: series(decimal), period: integer, periodsPerYear: integer }, decimal, ({ op, last }) => {
    const returns = op('series.returns', { series: p('prices'), periods: 1, method: 'log' });
    return op('math.mul', { left: last(op('series.std', { series: returns, period: p('period'), ddof: 1 })), right: op('math.sqrt', { value: p('periodsPerYear') }) });
  }),
];
const module = { schemaVersion: '1.0.0', language: 'svl/1', languageVersion: '1.2.0', functions };
export const quantFunctions = () => clone({ id: 'sesame/quant', version: '1.0.0', digest: digest(module), module });

export function createQuantTools(host) {
  const { define, string } = host.tools;
  return [define('strategy_functions', 'Write the versioned declarative SVL quant function module (RSI, ATR, MACD, Bollinger, Donchian, z-score and realized volatility) to the workspace. Embed the whole frozen extension in an SVL 1.2 source; formulas expand into the same graph and replay.', {
    output_path: string('Workspace JSON path for the complete frozen extension object'),
  }, async (args, signal) => {
    const extension = quantFunctions();
    await host.workspace.file('write', args.output_path, JSON.stringify(extension, null, 2) + '\n', signal);
    return { id: extension.id, version: extension.version, digest: extension.digest, languageVersion: '1.2.0', path: args.output_path,
      functions: extension.module.functions.filter(fn => !fn.id.endsWith('Step')).map(fn => ({ id: `${extension.id}/${fn.id}`, parameters: fn.parameters, output: fn.output })), reference: 'skills/strategy-authoring/references/quant-functions.md' };
  })];
}
