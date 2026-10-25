import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { bars as strictBars } from '../scripts/abu-runtime.mjs';

// Frozen FMP daily OHLCV from the 2026-10-18 live research run, not generated prices.
// Date precision and unknown historical availability are retained verbatim.
const prices = [
  ['2026-10-01',330,332.48,325.81,330.32,36306346],
  ['2026-10-02',333.26,334.54,330.61,333.69,33278600],
  ['2026-10-05',332.82,336.21,331.65,332.89,34400900],
  ['2026-10-06',332.28,334.38,330.62,333.63,30449005],
  ['2026-10-07',336.96,338.67,332.78,336.67,34147900],
  ['2026-10-08',336.82,341.57,335.9,340.42,35332449],
  ['2026-10-09',331.7,338.61,330.7,336.64,37881200],
  ['2026-10-12',338.22,342.63,337.6,340.97,25900600],
  ['2026-10-13',344.67,348.15,340.74,341.27,38983839],
  ['2026-10-14',344.61,347.09,341.72,342.96,50061100],
  ['2026-10-15',346.95,347.85,341.6,342,39767300],
  ['2026-10-16',346.09,347.82,340.46,343.46,59946368],
];
function fixture() {
  return { schema_version: 1, source: { id: 'FMP:AAPL:non-split-adjusted:2026-10-01/16', kind: 'historical' },
    as_of: '2026-10-18T11:00:00.000Z', parameters: { atr_window: 10 },
    bars: prices.map(([time,open,high,low,close,volume]) => ({ time, available_at: null, open,high,low,close,volume })) };
}

for (const name of ['abu-volatility', 'abu-indicators']) {
  const root = new URL(`../packages/${name}/`, import.meta.url);
  const { analyze } = await import(new URL('scripts/baseline.mjs', root));
  const declaration = JSON.parse(await readFile(new URL('capabilities.json', root), 'utf8')).capabilities[0];

  test(`${name}: real date-only input computes the gap-inclusive ten-day TR average`, () => {
    const input = fixture(), saved = structuredClone(input);
    assert.equal(Value.Check(declaration.inputSchema, { input }), true);
    const { observations, limitations } = analyze(input);
    assert.equal(observations.series[0].true_range, null);
    assert.equal(observations.series[9].atr, null, 'ten bars supply only nine previous-close comparisons');
    assert.equal(observations.series.find(row => row.time === '2026-10-14').true_range, 5.82);
    assert.deepEqual(observations.series.slice(-10).map(row => row.true_range), [4.56,3.76,5.89,5.67,9.72,5.99,7.41,5.82,6.25,7.36]);
    assert.equal(observations.latest.atr, 6.243);
    assert.ok(Math.abs(observations.latest.atr_percent - 1.8176789145752053) < 1e-8);
    assert.ok(observations.series.every(row => row.available_at === null));
    assert.ok(limitations.some(text => /historical.*availab|point.in.time/i.test(text)));
    assert.deepEqual(input, saved);
    const omitted = fixture(); for (const row of omitted.bars) delete row.available_at;
    assert.equal(Value.Check(declaration.inputSchema, { input: omitted }), true);
    assert.equal(analyze(omitted).observations.latest.atr, 6.243);
  });

  test(`${name}: unknown availability propagates without changing real timestamps`, () => {
    const input = fixture();
    for (const row of input.bars) {
      row.available_at = row.time + 'T21:01:00.000Z';
      row.time += 'T21:00:00.000Z';
    }
    const known = analyze(input).observations;
    assert.equal(known.latest.available_at, '2026-10-16T21:01:00.000Z');
    input.bars[3].available_at = null;
    const unknown = analyze(input).observations;
    assert.equal(unknown.series[2].available_at, '2026-10-05T21:01:00.000Z');
    assert.equal(unknown.latest.available_at, null);
    assert.equal(unknown.latest.atr, known.latest.atr);
  });

  test(`${name}: snapshot input still rejects future, invalid and mixed dates`, () => {
    const future = fixture(); future.as_of = '2026-10-15T23:00:00.000Z';
    assert.throws(() => analyze(future), /as_of/);
    for (const change of [{ time: '2026-02-30' }, { available_at: '2026-10-20T00:00:00.000Z' }, { available_at: '2026-09-01T00:00:00.000Z' }]) {
      const input = fixture(); Object.assign(input.bars[0], change);
      assert.throws(() => analyze(input));
    }
    const mixed = fixture(); mixed.bars[0].time += 'T00:00:00.000Z';
    assert.throws(() => analyze(mixed), /precision/);
    const duplicate = fixture(); duplicate.bars[1].time = duplicate.bars[0].time;
    assert.throws(() => analyze(duplicate), /unique/);
  });

  test(`${name}: callable calculation freezes the real daily input and result`, async () => {
    const { createCapabilities } = await import(new URL('index.js', root));
    const resources = new Map(); let sequence = 0;
    const host = { resources: {
      async create(spec) { const ref = { id: `source-${++sequence}`, kind: 'blob', version: 1 }; resources.set(ref.id, JSON.parse(spec.source.content)); return ref; },
      async publish(source) { const ref = { id: `data-${++sequence}`, revision: 'one', digest: 'sha256:' + 'a'.repeat(64), kind: 'data', schemaVersion: '1.0.0' }; resources.set(ref.id, resources.get(source.id)); return { ref }; },
      async remove(ref) { resources.delete(ref.id); },
    } };
    const input = fixture();
    const result = await createCapabilities(host)[0].execute({ input });
    assert.equal(Value.Check(declaration.outputSchema, result), true);
    assert.equal(result.observations.latest.atr, 6.243);
    assert.deepEqual(resources.get(result.input_artifact.id), [{ input }]);
    assert.equal(resources.get(result.result_artifact.id)[0].observations.latest.atr, 6.243);
  });
}

test('historical timing validation remains explicit for other ABU consumers', () => {
  assert.throws(() => strictBars(fixture()), /UTC timestamp/);
});
