import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { technicalFixtures } from '../packages/reports/scripts/module-technical-fixtures.mjs';
import { validateKnowledgeBasis } from '../packages/reports/report-knowledge.js';

const fixture = JSON.parse(readFileSync(new URL('../packages/reports/examples/module-visual-fixtures.json', import.meta.url)));
const row = (section, field) => fixture.rows.find(item => item.section_id === section && item.field === field);
const value = (section, field) => row(section, field).value;
const ohlc = row => Object.fromEntries(['time', 'open', 'high', 'low', 'close'].map(key => [key, row[key]]));
const input = value('M01', 'price_chart').rows;
const constantCandles = length => Array.from({ length }, (_, i) => ({ time: new Date(Date.UTC(2026, 7, i + 1)).toISOString().slice(0, 10), open: '100.00', high: '102.00', low: '98.00', close: '100.00' }));

test('M02 methods share the unchanged 48 candles, fixed input identity and cutoff', () => {
  const plotted = value('M02', 'price_chart').rows, scans = value('M02', 'method_scan');
  assert.equal(input.length, 48);
  assert.deepEqual(plotted.map(ohlc), input.map(ohlc));
  assert.equal(scans.length, 5);
  const digest = `sha256:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
  for (const method of scans) {
    assert.deepEqual(method.input, scans[0].input);
    assert.equal(method.input.input_ref.digest, digest);
    assert.equal(method.input.as_of, '2026-09-18T00:00:00.000Z');
    assert.equal(method.input.period, 'D1');
    assert.equal(method.input.unit, 'USD');
    assert.ok(method.method_ref.startsWith('demo/'));
    assert.ok(method.definition && method.parameters && method.implementation_version);
  }
  const frozen = structuredClone(input);
  assert.deepEqual(technicalFixtures(input), technicalFixtures(input));
  assert.deepEqual(input, frozen, 'Independent demo calculations must not change the shared OHLC input');
});

test('moving averages use completed bars with warmup and do not read later prices', () => {
  const candles = constantCandles(24).map((row, i) => ({ ...row, open: String(i + 1), close: String(i + 1), high: String(i + 2), low: String(i) }));
  const result = technicalFixtures(candles), plotted = result.charts['M02.price_chart'];
  assert.ok(plotted.slice(0, 4).every(row => row.sma5 === null));
  assert.ok(plotted.slice(0, 19).every(row => row.sma20 === null));
  assert.equal(plotted[4].sma5, 3);
  assert.equal(plotted[19].sma20, 10.5);
  assert.equal(plotted.at(-1).sma5, 22);
  assert.equal(plotted.at(-1).sma20, 14.5);
  const changed = structuredClone(candles);
  changed[23] = { ...changed[23], high: '101', close: '100' };
  const changedPlot = technicalFixtures(changed).charts['M02.price_chart'];
  assert.deepEqual(changedPlot.slice(0, 23).map(row => [row.sma5, row.sma20]), plotted.slice(0, 23).map(row => [row.sma5, row.sma20]));
  assert.equal(result.values['M02.method_scan'].find(row => row.id === 'sma-trend').first_available_at, '2026-08-21T00:00:00.000Z');
});

test('FVG boundaries are actual three-bar gaps and begin only after confirmation', () => {
  const candles = [
    { time: '2026-08-01', open: '10', high: '11', low: '9', close: '10' },
    { time: '2026-08-02', open: '12', high: '13', low: '11', close: '12' },
    { time: '2026-08-03', open: '14', high: '15', low: '13', close: '14' },
    { time: '2026-08-04', open: '13', high: '14', low: '10', close: '12' },
  ];
  const result = technicalFixtures(candles), gap = result.values['M02.feature_signals'].find(row => row.id === 'fvg-2');
  assert.deepEqual(gap.value, { lower: '11', upper: '13' });
  assert.equal(gap.side, 'upward_geometry');
  assert.equal(gap.first_available_at, '2026-08-04T00:00:00.000Z');
  assert.equal(gap.filled_at, '2026-08-05T00:00:00.000Z');
  assert.equal(result.charts['M02.price_chart'][2].fvg1_lower, null);
  assert.equal(result.charts['M02.price_chart'][3].fvg1_lower, '11');
  assert.equal(result.charts['M02.price_chart'][3].fvg1_upper, '13');
  const gaps = value('M02', 'feature_signals').filter(row => row.id.startsWith('fvg-'));
  assert.equal(gaps.length, 7);
  for (const gap of gaps) {
    const index = Number(gap.id.slice(4));
    const before = input[index - 2], current = input[index];
    if (gap.side === 'upward_geometry') {
      assert.ok(Number(current.low) > Number(before.high));
      assert.deepEqual(gap.value, { lower: before.high, upper: current.low });
    } else {
      assert.ok(Number(current.high) < Number(before.low));
      assert.deepEqual(gap.value, { lower: current.high, upper: before.low });
    }
    assert.ok(Date.parse(gap.first_available_at) > Date.parse(gap.observed_at));
  }
  assert.equal(value('M02', 'price_chart').options.overlays.length, 10);
});

test('zero geometric matches remain no_signal with no invented FVG overlays', () => {
  const result = technicalFixtures(constantCandles(24));
  const method = result.values['M02.method_scan'].find(row => row.id === 'fvg-three-bar');
  assert.equal(method.status, 'no_signal');
  assert.equal(method.result.detected, 0);
  assert.equal(result.values['M02.feature_signals'].filter(row => row.id.startsWith('fvg-')).length, 0);
  assert.ok(result.chartOptions['M02.price_chart'].overlays.every(row => !row.field.startsWith('fvg')));
  assert.ok(result.charts['M02.method_comparison_chart'].some(row => row.id === 'fvg-three-bar-no_signal' && row.state === '未出信号'));
  assert.deepEqual(result.values['M02.event_identity'], []);
  assert.deepEqual(result.values['M02.geometry'], []);
  assert.equal(result.charts['M02.lifecycle_chart'][0].stage, 'scan_result');
});

test('FVG identity, times, geometry and lifecycle all describe the same observed events', () => {
  const signals = value('M02', 'feature_signals').filter(row => row.id.startsWith('fvg-'));
  const identities = value('M02', 'event_identity'), times = value('M02', 'event_times'), geometry = value('M02', 'geometry');
  const lifecycle = value('M02', 'event_lifecycle'), plotted = value('M02', 'lifecycle_chart').rows;
  assert.deepEqual(plotted, lifecycle);
  assert.equal(identities.length, 7);
  assert.equal(plotted.length, 14);
  for (const signal of signals) {
    assert.ok(identities.some(row => row.id === signal.id));
    const eventTimes = times.find(row => row.id === signal.id), bounds = geometry.find(row => row.id === signal.id);
    assert.equal(eventTimes.formation_bar, signal.observed_at);
    assert.equal(eventTimes.first_available_at, signal.first_available_at);
    assert.ok(Date.parse(eventTimes.formation_bar) < Date.parse(eventTimes.first_available_at));
    assert.equal(bounds.lower, signal.value.lower);
    assert.equal(bounds.upper, signal.value.upper);
    assert.equal(bounds.first_available_at, signal.first_available_at);
    assert.equal(bounds.filled_at, signal.filled_at);
    const detected = plotted.find(row => row.event_id === signal.id && row.stage === 'detected');
    const filled = plotted.find(row => row.event_id === signal.id && row.stage === 'filled');
    assert.equal(detected.time, signal.first_available_at);
    assert.equal(filled.time, signal.filled_at);
    for (const event of [detected, filled]) {
      assert.equal(event.historical_search.status, 'pending');
      assert.equal(event.evidence[0].href, '#section-M02');
    }
  }
  for (const key of ['entry_zone', 'targets', 'stop_plan', 'reward_risk']) {
    const supplied = value('M02', key);
    for (const entry of Array.isArray(supplied) ? supplied : [supplied]) assert.match(entry['方案性质'], /独立条件方案.*不是本次FVG\/ATR推导/);
  }
  assert.equal(value('M02', 'entry_zone')['下界'], '110');
  assert.equal(value('M02', 'stop_plan')['参考止损'], '108 USD');
});

test('ATR preserves its Wilder price-range value and is never mapped to the price axis', () => {
  const candles = constantCandles(16);
  candles[14].high = '105.00'; candles[14].low = '95.00';
  const result = technicalFixtures(candles);
  assert.equal(result.values['M02.feature_signals'].find(row => row.id === 'atr-latest').value, 4.398);
  assert.equal(result.values['M02.method_scan'].find(row => row.id === 'atr-wilder').first_available_at, '2026-08-15T00:00:00.000Z');
  assert.match(result.values['M02.feature_signals'].find(row => row.id === 'atr-latest').unit, /price range/);
  for (const options of [result.chartOptions['M02.price_chart'], value('M02', 'price_chart').options]) {
    assert.ok(options.overlays.every(overlay => !/atr/i.test(overlay.field)));
    assert.ok(options.overlays.length <= 12);
  }
});

test('no breakout and unavailable volume methods retain distinct execution and timeline states', () => {
  const scans = value('M02', 'method_scan'), timeline = value('M02', 'method_comparison_chart').rows;
  const breakout = scans.find(row => row.id === 'donchian-breakout'), vwap = scans.find(row => row.id === 'vwap');
  assert.equal(breakout.status, 'no_signal');
  assert.equal(breakout.parameters.evaluation, 'last_closed_bar_only');
  assert.equal(vwap.status, 'unavailable');
  assert.equal(vwap.first_available_at, null);
  assert.match(vwap.result.reason, /未运行VWAP/);
  assert.ok(timeline.some(row => row.id === 'breakout-latest' && row.state === '未出信号'));
  assert.ok(timeline.some(row => row.id === 'vwap-unavailable' && row.state === '不可运行'));
  const last = value('M02', 'feature_signals').find(row => row.id === 'breakout-latest');
  assert.ok(Number(last.value.close) >= last.value.prior_lower && Number(last.value.close) <= last.value.prior_upper);
});

test('new technical observations keep history pending without borrowing directional confidence', async () => {
  const { resolveStructure, bindResults } = await import('../packages/reports/report-structure.js');
  for (const entry of [...value('M02', 'method_scan'), ...value('M02', 'feature_signals')]) {
    assert.equal(entry.historical_search.status, 'pending');
    assert.equal(entry.historical_search.eligible_count, null);
    assert.equal(entry.historical_search.policy, 'same_instrument_recent_first');
    assert.equal(entry.confidence, undefined);
    assert.equal(entry.score, undefined);
    assert.equal(entry.historical_basis, undefined);
  }
  const selected = resolveStructure({ sections: [{ module_id: 'M02', fields: ['price_chart', 'method_scan', 'feature_signals', 'method_comparison_chart'] }] });
  const bound = bindResults(selected, fixture.rows);
  assert.equal(bound.completeness.status, 'complete');
  assert.equal(bound.researchValidation, 'not_evaluated');
  assert.deepEqual(bound.evidence_refs, []);
});

test('knowledge explanations retain the existing breakout, event and joint historical observations', () => {
  const steps = value('M14', 'inference_evidence'), selectors = { breakout: row => row.breakout, event: row => row.event, joint: row => row.breakout && row.event };
  assert.deepEqual(steps.map(step => step.confidence.estimate), [.55, .5, .65]);
  assert.deepEqual(steps.map(step => step.historical_basis.sample.resolved), [80, 80, 40]);
  for (const step of steps) {
    validateKnowledgeBasis(step.knowledge_basis);
    assert.ok(step.knowledge_basis.theory_refs.every(ref => ref.startsWith('demo/')));
    const cases = fixture.history_rows.filter(selectors[step.id]);
    assert.equal(step.confidence.estimate, cases.filter(row => row.outcome === '上涨').length / cases.length);
    assert.equal(step.historical_basis.sample.resolved, cases.length);
  }
  assert.deepEqual(value('M13', 'inference_evidence'), steps);
});

test('technical suggestions stay folded and optional while candlesticks have a price unit', async () => {
  const { resolveStructure } = await import('../packages/reports/report-structure.js');
  const names = ['method_scan', 'feature_signals', 'method_comparison_chart'];
  const combined = resolveStructure({ template_id: 'R02' }).sections.find(section => section.module_id === 'M02');
  const keys = combined.fields.map(field => field.key), position = keys.indexOf('price_chart');
  assert.deepEqual(keys.slice(position + 1, position + 4), names);
  for (const name of names) assert.ok(combined.fields.find(field => field.key === name).display === 'folded');
  assert.ok(combined.fields.every(field => !field.required));
  const custom = resolveStructure({ sections: [{ module_id: 'M02', fields: ['price_chart'] }] });
  assert.deepEqual(custom.sections[0].fields.map(field => field.key), ['price_chart']);
  for (const section of ['M01', 'M02', 'M06']) assert.equal(value(section, section === 'M06' ? 'event_price_chart' : 'price_chart').options.unit, 'USD');
  assert.equal(technicalFixtures(input, { unit: 'EUR' }).chartOptions['M02.price_chart'].unit, 'EUR');
  const catalog = readFileSync(new URL('../packages/reports/templates/module-catalog.json', import.meta.url));
  assert.ok(catalog.length <= 128 * 1024);
});
