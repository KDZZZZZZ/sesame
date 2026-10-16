import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSource, evaluateReplay, graph, SVL_SEMANTICS } from '@sesame/plugin-sdk/svl';
import { quantFunctions } from '../packages/strategy-authoring/lib/quant-functions.js';

const decimal = { kind: 'decimal' }, record = fields => ({ kind: 'record', fields });
const utc = unixMs => ({ basis: 'utc', unixMs });
function calculation(name, args, prices = ['1','2','3','4','5'], output = decimal, initial = '0', other = {}) {
  const source = { language: 'svl/1', schemaVersion: '1.2.0', strategyId: 'quant-library-fixture', semantics: structuredClone(SVL_SEMANTICS), parameters: {}, functions: [], extensions: [quantFunctions()],
    inputs: { bars: { kind: 'bars', instrument: { literal: { sourceId: 'fixture', instrumentId: 'asset' } }, timeframe: 'M1', barPolicy: 'closed', priceBasis: 'last', adjustment: 'none', session: 'fixture', lookback: 512 }, external: { kind: 'accountSnapshot', binding: 'fixture' } },
    state: { result: { type: output, initial } }, nodes: [
      { id: 'calculate', op: 'function.call', inputs: { functionId: `sesame/quant/${name}`, arguments: { record: args } } },
      { id: 'ready', op: 'value.isReady', inputs: { value: { node: 'calculate' } } },
      { id: 'save', op: 'state.set', inputs: { stateId: 'result', value: { node: 'calculate' } } },
    ], handlers: [{ id: 'onBar', event: { type: 'bar.closed', input: 'bars' }, steps: [{ id: 'readySave', when: 'ready', actions: ['save'] }] }] };
  const frozen = JSON.parse(JSON.stringify(source));
  validateSource(frozen);
  const bars = prices.map((close, index) => ({ open: close, high: close, low: close, close, openTime: utc(index * 60000), endTime: utc((index + 1) * 60000), availableAt: utc((index + 1) * 60000) }));
  const replay = evaluateReplay(frozen, { runId: 'fixture', events: [{ eventId: 'bar', sequence: '1', type: 'bar.closed', input: 'bars', availableAt: utc(prices.length * 60000), inputs: { bars, external: other } }] });
  return { source: frozen, replay, value: replay.state.result, result: replay.events[0].trace.find(row => row.nodeId === 'calculate' && !row.functionId)?.value };
}
const closes = { input: 'bars', field: 'close' };

test('RSI Wilder initialization, flat case and missing-data behavior are pinned in a plugin module', () => {
  const rising = calculation('rsi', { prices: closes, period: 3 }); assert.equal(rising.replay.status, 'completed'); assert.equal(rising.value, '100');
  assert.equal(calculation('rsi', { prices: closes, period: 3 }, ['5','4','3','2','1']).value, '0');
  assert.equal(calculation('rsi', { prices: closes, period: 3 }, ['2','2','2','2','2']).value, '50');
  assert.equal(calculation('rsi', { prices: closes, period: 3 }, ['1','2','1','2']).value, '66.66666666666666666666666666666667');
  const warming = calculation('rsi', { prices: closes, period: 3 }, ['1','2','3']); assert.deepEqual(warming.result, { status: 'not_ready' });
  const gap = calculation('rsi', { prices: { input: 'external', field: 'prices' }, period: 3 }, ['1'], decimal, '0', { prices: ['1', '2', null, '4', '5'] }); assert.deepEqual(gap.result, { status: 'not_ready' });
});

test('ATR uses the first close as context, three true ranges for its seed, then Wilder smoothing', () => {
  const bars = [{ high:'11',low:'9',close:'10' }, { high:'13',low:'10',close:'12' }, { high:'14',low:'11',close:'13' }, { high:'15',low:'12',close:'14' }, { high:'18',low:'13',close:'17' }];
  const result = calculation('atr', { bars: { input: 'external', field: 'ohlc' }, period: 3 }, ['1'], decimal, '0', { ohlc: bars });
  assert.equal(result.replay.status, 'completed'); assert.equal(result.value, '3.666666666666666666666666666666667');
  const bad = structuredClone(bars); bad[1].low = '14';
  assert.deepEqual(calculation('atr', { bars: { input: 'external', field: 'ohlc' }, period: 3 }, ['1'], decimal, '0', { ohlc: bad }).result, { status: 'not_ready' });
});

test('MACD and Bollinger use the same aligned prices and documented initialization/variance', () => {
  const macd = calculation('macd', { prices: closes, fast: 1, slow: 2, signal: 2 }, undefined, record({ macd: decimal, signal: decimal, histogram: decimal }), { macd:'0',signal:'0',histogram:'0' });
  assert.equal(macd.replay.status, 'completed', JSON.stringify(macd.replay.events[0].error)); assert.deepEqual(macd.value, { macd:'0.5',signal:'0.5',histogram:'0' });
  const bands = calculation('bollinger', { prices: closes, period: 3, deviations: '2' }, undefined, record({ middle: decimal, upper: decimal, lower: decimal }), { middle:'0',upper:'0',lower:'0' });
  assert.equal(bands.value.middle, '4'); assert.ok(Math.abs(Number(bands.value.upper) - (4 + 2 * Math.sqrt(2/3))) < 1e-12);
});

test('zscore, Donchian and realized volatility expose deterministic typed outputs', () => {
  const z = calculation('zscore', { values: closes, period: 3 }); assert.ok(Math.abs(Number(z.value) - Math.sqrt(1.5)) < 1e-12);
  const range = calculation('donchian', { highs: closes, lows: closes, period: 3 }, undefined, record({ upper: decimal, lower: decimal }), { upper:'0',lower:'0' }); assert.deepEqual(range.value, { upper:'5',lower:'3' });
  const vol = calculation('volatility', { prices: closes, period: 3, periodsPerYear: 252 }, ['1','2','4','8','16']); assert.equal(vol.value, '0');
  const flat = calculation('zscore', { values: closes, period: 3 }, ['1','1','1']); assert.deepEqual(flat.result, { status: 'not_ready' });
});

test('published function formulas are digest-pinned, expandable and traced without host-specific indicator names', () => {
  const result = calculation('rsi', { prices: closes, period: 3 }), view = graph(result.source);
  assert.ok(view.modules.some(module => module.id === 'sesame/quant'));
  assert.ok(view.functions.some(fn => fn.id === 'sesame/quant/rsiStep'));
  assert.ok(result.replay.events[0].trace.some(row => row.functionId === 'sesame/quant/rsiStep'));
  result.source.extensions[0].module.functions[0].nodes[0].inputs.field = 'tampered'; assert.throws(() => validateSource(result.source), /digest/);
});

test('normal 100 and 200 bar windows finish within the default evaluator budget', () => {
  for (const count of [100, 200]) {
    const prices = Array.from({ length: count }, (_, index) => String(100 + index % 23));
    const bars = prices.map(close => ({ high: String(Number(close) + 2), low: String(Number(close) - 2), close }));
    const cases = [
      ['rsi', { prices: closes, period: 14 }, decimal, '0', {}],
      ['atr', { bars: { input: 'external', field: 'ohlc' }, period: 14 }, decimal, '0', { ohlc: bars }],
      ['macd', { prices: closes, fast: 12, slow: 26, signal: 9 }, record({ macd: decimal, signal: decimal, histogram: decimal }), { macd: '0', signal: '0', histogram: '0' }, {}],
      ['bollinger', { prices: closes, period: 20, deviations: '2' }, record({ middle: decimal, upper: decimal, lower: decimal }), { middle: '0', upper: '0', lower: '0' }, {}],
      ['volatility', { prices: closes, period: 20, periodsPerYear: 252 }, decimal, '0', {}],
    ];
    for (const [name, args, type, initial, inputs] of cases) {
      const result = calculation(name, args, prices, type, initial, inputs);
      assert.equal(result.replay.status, 'completed', `${name}/${count}: ${JSON.stringify(result.replay.events[0].error)}`);
      assert.notDeepEqual(result.result, { status: 'not_ready' }, `${name}/${count} should have finished its warmup`);
      assert.ok(result.replay.events[0].trace.some(row => row.functionId === `sesame/quant/${name}`));
    }
  }
});
