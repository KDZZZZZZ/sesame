import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSource, evaluateReplay } from '@sesame/plugin-sdk/svl';
import { analyzeBreakoutStudy } from '../breakout-study.js';
import { buildStructure, factorIntegrationGap, replaceComponent, verifyFactorUses } from '../structure.js';

const ref = id => ({ id, revision: '1', digest: 'sha256:' + 'a'.repeat(64), kind: 'resource', schemaVersion: '1.0.0' });
const instrument = { sourceId: 'demo', instrumentId: 'EXAMPLE' };
const bindings = { instruments: [instrument], marketDataRef: ref('bars'), candidateSnapshotRef: ref('listed-on-day'),
  riskPolicyRef: ref('mandate'), costModelRef: ref('costs'), targetProfileRef: { ...ref('target'), kind: 'strategy.target' } };
function replay(source, parameters, closes) {
  const result = evaluateReplay(source, { runId: 'test', parameters: { instrument, ...parameters }, events: closes.map((close, index) => ({
    eventId: 'bar-' + index, sequence: String(index + 1), type: 'bar.closed', input: 'bars',
    inputs: { bars: closes.slice(Math.max(0, index + 1 - source.inputs.bars.lookback), index + 1).map(value => ({ close: String(value) })) },
  })) });
  assert.equal(result.status, 'completed', JSON.stringify(result.events.at(-1)?.error));
  return result.events.map(row => row.state);
}
test('framework, classic and hybrid generate actual editable SVL with distinct replayed behavior', () => {
  const structure = buildStructure({ strategyId: 'my.strategy', bindings });
  assert.equal(structure.status, 'designed'); assert.deepEqual(structure.gaps, []); assert.deepEqual(structure.factorResolutions, []);
  assert.deepEqual(validateSource(structure.starterSource).diagnostics, []);
  assert.deepEqual(replay(structure.starterSource, { threshold: '10' }, [9, 11, 10]).map(s => s.positiveSignal), [false, true, false]);
  const classic = buildStructure({ strategyId: 'classic', mode: 'state_machine', bindings });
  assert.equal(classic.components.alpha, undefined); assert.equal(classic.components.portfolio, undefined);
  assert.deepEqual(replay(classic.starterSource, { entryLevel: '11', exitLevel: '9' }, [12, 10, 8]).map(s => s.longRegime), [true, true, false]);
  const hybrid = buildStructure({ mode: 'hybrid', bindings, components: { stateMachine: { model: 'long_flat', settings: { entryLevel: '11', exitLevel: '9' } } } });
  assert.deepEqual(replay(hybrid.starterSource, { threshold: '10' }, [12, 10, 8]),
    [{ positiveSignal: true, longRegime: true, eligible: true }, { positiveSignal: false, longRegime: true, eligible: false }, { positiveSignal: false, longRegime: false, eligible: false }]);
});

test('replacing a model changes its behavior, preserves every unrelated model and reports the missing evidence', () => {
  const base = buildStructure({ bindings });
  const weighted = replaceComponent(base, 'portfolio', 'inverse_volatility');
  assert.deepEqual(weighted.gaps.map(g => g.missing), ['volatilityRef']); assert.deepEqual(weighted.invalidated, ['portfolio', 'risk', 'execution']);
  assert.equal(base.components.portfolio.model, 'equal'); assert.deepEqual(weighted.starterSource, base.starterSource);
  const signal = replaceComponent(base, 'alpha', { model: 'moving_average', settings: { fastPeriod: 2, slowPeriod: 3 } });
  assert.deepEqual(signal.gaps, []); assert.equal(signal.components.portfolio.model, 'equal');
  assert.deepEqual(replay(signal.starterSource, {}, [3, 2, 1, 4, 5]).map(s => s.positiveSignal), [false, false, false, true, true]);
  assert.deepEqual(replaceComponent(signal, 'alpha', signal.components.alpha).invalidated, []);
  const blank = replaceComponent(base, 'alpha', null);
  assert.equal(blank.starterSource, null); assert.equal(blank.gaps.find(g => g.component === 'alpha').code, 'missing_component');
});

function breakoutReplay(source, snapshots, parameters = {}) {
  const result = evaluateReplay(source, { runId: 'breakout', parameters: { instrument, ...parameters }, events: snapshots.map((bars, i) =>
    ({ eventId: 'closed-' + i, sequence: String(i + 1), type: 'bar.closed', input: 'bars', inputs: { bars } })) });
  assert.equal(result.status, 'completed', JSON.stringify(result.events.at(-1)?.error));
  return result.events;
}

test('long breakout compares the current close with the previous complete high window and resets on missing history', () => {
  const base = buildStructure({ bindings }), structure = replaceComponent(base, 'alpha', { model: 'long_breakout', settings: { lookback: 2 } });
  assert.deepEqual(structure.gaps, []); assert.ok(structure.interfaces.alpha.models.includes('long_breakout'));
  for (const [slot, original] of Object.entries(base.components)) {
    if (slot !== 'alpha') assert.deepEqual(structure.components[slot], original);
  }
  const source = structure.starterSource;
  assert.deepEqual(validateSource(source).diagnostics, []); assert.equal(source.inputs.bars.barPolicy, 'closed');
  const bars = [
    { high: '12', close: '10' }, { high: '11', close: '9' }, { high: '20', close: '13' },
    { high: '25', close: '20' }, { high: '29', close: '27' },
  ];
  const snapshots = bars.map((_, i) => bars.slice(0, i + 1));
  snapshots.push([bars[4]], [bars[2], { high: null, close: '20' }, bars[4]], [bars[0], bars[1], { high: null, close: '13' }]);
  const events = breakoutReplay(source, snapshots);
  assert.deepEqual(events.map(e => [e.state.signalReady, e.state.positiveSignal]),
    [[false, false], [false, false], [true, true], [true, false], [true, true], [false, false], [false, false], [true, true]]);
  assert.ok(events[1].trace.some(row => row.nodeId === 'previous-highs' && row.value.status === 'not_ready'));
  assert.deepEqual(events.flatMap(e => e.intents), []);
});

test('long breakout supports the full configurable window and leaves hybrid regime transitions independent', () => {
  const standard = buildStructure({ bindings, components: { alpha: 'long_breakout' } });
  assert.deepEqual(standard.starterSource.parameters.lookback, { type: 'integer', default: 20, min: 1, max: 500 });
  const prior = Array.from({ length: 500 }, () => ({ high: '10', close: '8' })), current = { high: '20', close: '11' };
  const full = breakoutReplay(standard.starterSource, [prior, [...prior, current]], { lookback: 500 });
  assert.deepEqual(full.map(e => e.state.signalReady), [false, true]); assert.equal(full[1].state.positiveSignal, true);
  const hybrid = buildStructure({ mode: 'hybrid', bindings, components: { stateMachine: { model: 'long_flat', settings: { entryLevel: '15', exitLevel: '7' } } } });
  const switched = replaceComponent(hybrid, 'alpha', { model: 'long_breakout', settings: { lookback: 1 } });
  const bars = [prior[0], current, { high: '23', close: '16' }, { high: '25', close: '24' }];
  assert.deepEqual(breakoutReplay(switched.starterSource, bars.map((_, i) => bars.slice(0, i + 1)))
    .map(e => [e.state.positiveSignal, e.state.longRegime, e.state.eligible]),
  [[false, false, false], [true, false, false], [false, true, false], [true, true, true]]);
  for (const lookback of [0, 501, 2.5, '2', null]) {
    const invalid = replaceComponent(standard, 'alpha', { model: 'long_breakout', settings: { lookback } });
    assert.equal(invalid.starterSource, null); assert.ok(invalid.gaps.some(g => g.component === 'alpha' && g.code === 'source_settings'));
  }
});

test('SVL and the opportunity study identify the same labeled and right-censored closes on frozen OHLC bars', () => {
  const bars = Object.freeze([[12, 9], [11, 10], [19, 13], [23, 19], [25, 24], [27, 23], [29, 28], [31, 30]]
    .map(([high, close], i) => Object.freeze({ datetime: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
      open: String(close - 1), high: String(high), low: String(close - 2), close: String(close) })));
  const options = { lookback: 2, horizon: 2, side: 'long' };
  const { coverage, sides } = analyzeBreakoutStudy(bars, {}, options);
  const { opportunities, allDecisions, examples } = sides.long;
  assert.equal(opportunities.labeled, 2); assert.equal(opportunities.rightCensored, 2);
  const sample = [...examples.labeled, ...examples.rightCensored];
  assert.equal(sample.length, opportunities.count);
  const { starterSource } = buildStructure({ bindings, components: { alpha: { model: 'long_breakout', settings: { lookback: options.lookback } } } });
  const events = breakoutReplay(starterSource, bars.map((_, i) => bars.slice(0, i + 1)));
  assert.deepEqual(events.flatMap((e, i) => e.state.signalReady ? [bars[i].datetime] : []),
    bars.slice(coverage.warmupBars).map(bar => bar.datetime));
  assert.equal(events.filter(e => e.state.signalReady).length, allDecisions.count);
  const signals = events.flatMap((e, i) => e.state.positiveSignal ? [{ decisionIndex: i, signalBarTime: bars[i].datetime,
    priorExtreme: e.trace.find(row => row.nodeId === 'previous-high').value }] : []);
  assert.deepEqual(signals, sample.map(({ decisionIndex, signalBarTime, priorExtreme }) => ({ decisionIndex, signalBarTime, priorExtreme })));
});

test('optional factors reuse existing evidence or route to only the missing existing capability', () => {
  const factor = { purpose: 'alpha', factorId: 'factor', definitionDigest: ref('definition').digest, sourcePartition: 'development', evaluationId: 'evaluation',
    consumption: { inputFields: ['close'], decisionTime: 'closed bar', transform: 'positive value is bullish', missingPolicy: 'skip',
      observedAtField: 'observed', availableAtField: 'available', revisionPolicy: 'first vintage' },
    implementation: { mode: 'external_feed', ref: ref('fixed feature'), validationRef: ref('numerical timing comparison') } };
  const opts = { bindings, factors: [factor] };
  assert.equal(buildStructure(opts).factorResolutions[0].status, 'verify');
  const queries = [{ purpose: 'alpha' }, { purpose: 'risk', librarySearched: true }, { ...factor, sourcePartition: 'holdout' },
    { ...factor, consumption: { ...factor.consumption, timingSamples: [{ observedAt: 5, availableAt: 9, decisionAt: 7 }] } }];
  const result = buildStructure({ bindings, factors: queries });
  assert.deepEqual(result.factorResolutions.map(f => f.status), ['lookup', 'search', 'evaluate', 'binding_gap']);
  assert.deepEqual(result.gaps.filter(g => g.capability).map(g => g.capability.split('#')[1]), ['factor_library', 'factor_search', 'factor_evaluate']);
  assert.equal(result.factorResolutions[3].integrationGap.missing, 'timingSamples');
  const invalid = buildStructure({ bindings, factors: [{ ...factor, implementation: { mode: 'external_feed', ref: ref('feed') } }] });
  assert.equal(invalid.factorResolutions[0].gap.missing, 'implementation');
});

test('only verified, supported development evidence from the named factor can be reused', async () => {
  const definitionDigest = ref('definition').digest;
  const use = { purpose: 'alpha', factorId: 'F', definitionDigest, sourcePartition: 'development', evaluationId: 'dev',
    consumption: { inputFields: ['close'], decisionTime: 'next bar', transform: 'level test', missingPolicy: 'skip' },
    implementation: { mode: 'svl_function', ref: ref('implementation'), validationRef: ref('comparison') } };
  const first = [{ id: 'oos', eligibility: 'supported', partition: 'holdout' }, { id: 'invalid', eligibility: 'insufficient', partition: 'development' }];
  const second = [{ id: 'dev', eligibility: 'supported', partition: 'development', profile: { id: 'profile1' }, context: { snapshotId: 'data1' } }];
  const calls = [], host = { capabilities: { async invoke(id, input) {
    calls.push(input); assert.equal(id, 'sesame/auto-factor-mining#factor_library'); assert.equal(input.action, 'read');
    return { type: 'result', value: { factor: { id: 'F', definitionDigest }, evaluations: { items: input.cursor ? second : first, cursor: input.cursor ? null : 'page2' } } };
  } } };
  assert.deepEqual((await verifyFactorUses(host, buildStructure({ bindings }))).factors, []); assert.equal(calls.length, 0);
  const factors = [use, { ...use, evaluationId: 'oos' }, { ...use, evaluationId: 'fake' },
    { ...use, definitionDigest: 'sha256:' + '0'.repeat(64) }, { ...use, evaluationId: 'invalid' }, { ...use, snapshotId: 'other' }];
  const verified = await verifyFactorUses(host, buildStructure({ bindings, factors }));
  assert.deepEqual(verified.factorResolutions.map(item => item.status), ['reuse', 'evidence_gap', 'evidence_gap', 'evidence_gap', 'evidence_gap', 'evidence_gap']);
  assert.deepEqual(calls.map(input => input.cursor), [undefined, 'page2']);
  const absent = { capabilities: { invoke: async () => { throw new Error('plugin disabled'); } } };
  const blocked = await verifyFactorUses(absent, buildStructure({ bindings, factors: [use] }));
  assert.equal(blocked.gaps[0].missing, 'factor_library'); assert.match(blocked.gaps[0].impact, /disabled/);
});

test('library confirmation and strategy integration retain independent outcomes and both gaps', async () => {
  const definitionDigest = ref('definition').digest;
  const use = { purpose: 'sizing', factorId: 'F', definitionDigest, sourcePartition: 'development', evaluationId: 'dev',
    consumption: { inputFields: ['close'], decisionTime: 'next bar', transform: 'scale exposure', missingPolicy: 'skip' },
    implementation: { mode: 'svl_function', ref: ref('implementation'), validationRef: ref('comparison') } };
  const { implementation, ...unwired } = use;
  const late = { ...use, consumption: { ...use.consumption, timingSamples: [{ observedAt: 2, availableAt: 4, decisionAt: 3 }] } };
  const missingEvidence = { ...use, evaluationId: 'absent' };
  const factors = [unwired, late, missingEvidence, { ...missingEvidence, consumption: late.consumption }];
  const calls = [];
  const host = { capabilities: { invoke: async (capability, input) => {
    calls.push(input.factorId);
    return { type: 'result', value: { factor: { id: 'F', definitionDigest }, evaluations: {
      items: [{ id: 'dev', partition: 'development', eligibility: 'supported' }], cursor: null } } };
  } } };
  const structure = await verifyFactorUses(host, buildStructure({ bindings, factors }));
  assert.deepEqual(calls, ['F']); assert.equal(structure.status, 'needs_inputs');
  const [missingAdapter, lateAdapter, missingArchive, both] = structure.factorResolutions;
  assert.deepEqual([missingAdapter.status, lateAdapter.status], ['binding_gap', 'binding_gap']);
  assert.ok([missingAdapter, lateAdapter].every(item => item.verification === 'factor_library_development_evaluation'));
  assert.deepEqual([missingAdapter.integrationGap.missing, lateAdapter.integrationGap.missing], ['implementation', 'timingSamples']);
  assert.equal(factorIntegrationGap(missingEvidence, 2), null);
  assert.equal(missingArchive.status, 'evidence_gap'); assert.equal(missingArchive.integrationGap, undefined);
  assert.equal(both.verification, undefined); assert.equal(both.gap.missing, 'evaluationId');
  assert.deepEqual(both.integrationGap, factorIntegrationGap(factors[3], 3));
  assert.deepEqual(structure.gaps.filter(item => item.component === 'factors[3]').map(item => item.missing), ['evaluationId', 'timingSamples']);
  assert.ok(structure.factorResolutions.every(item => item.status !== 'reuse'));
});

test('a pinned external factor produces an editable SVL input that excludes later releases in replay', () => {
  const use = { purpose: 'alpha', factorId: 'liquidity', definitionDigest: ref('definition').digest, evaluationId: 'dev', sourcePartition: 'development',
    consumption: { inputFields: ['depth'], decisionTime: 'bar close', transform: 'adapter emits bullish', missingPolicy: 'skip', revisionPolicy: 'first available vintage',
      observedAtField: 'observed', availableAtField: 'released', decisionAtField: 'decision' },
    implementation: { mode: 'external_feed', ref: ref('feature feed'), validationRef: ref('adapter check'),
      schemaRef: ref('schema'), availabilityPolicyRef: ref('clock'), signalField: 'bullish' } };
  const draft = buildStructure({ bindings, factors: [use], components: { alpha: 'factor_signal' } });
  assert.deepEqual(draft.gaps, []); assert.deepEqual(validateSource(draft.starterSource).diagnostics, []);
  const utc = unixMs => ({ basis: 'utc', unixMs });
  const values = [[1, 2, 3, true], [4, 7, 5, false], [5, 7, 7, false]];
  const result = evaluateReplay(draft.starterSource, { runId: 'factor', events: values.map(([obs, release, decision, bullish], index) =>
    ({ eventId: String(index), sequence: String(index + 1), type: 'external.input', input: 'factor', availableAt: utc(decision),
      inputs: { factor: { observed: utc(obs), released: utc(release), decision: utc(decision), bullish } } })) });
  assert.equal(result.status, 'completed'); assert.deepEqual(result.events.map(row => row.state.positiveSignal), [true, true, false]);
});

test('an unknown implementation, missing tool or incompatible custom model supplies the exact repair path', () => {
  const base = buildStructure({ availableCapabilities: [], bindings: { ...bindings, targetProfileRef: { id: 'latest' } } });
  assert.ok(base.gaps.some(g => g.code === 'missing_capability' && g.capability === 'sesame/strategy-authoring#strategy_validate'));
  assert.ok(base.gaps.some(g => g.missing === 'targetProfileRef' && g.next)); assert.ok(base.gaps.every(g => g.impact && g.next));
  const model = { model: 'custom', settings: { sourceRef: ref('source'), capability: 'example/custom#forecast',
    inputContract: 'Universe+Observations', outputContract: 'Signal' } };
  const valid = buildStructure({ bindings, components: { alpha: model } });
  assert.deepEqual(valid.gaps, []); assert.equal(valid.starterSource, null);
  assert.equal(replaceComponent(valid, 'alpha', { ...model, settings: { ...model.settings, outputContract: 'Order' } }).gaps[0].code, 'interface_mismatch');
  assert.equal(replaceComponent(valid, 'alpha', 'unregistered').gaps[0].code, 'unsupported_model');
});
