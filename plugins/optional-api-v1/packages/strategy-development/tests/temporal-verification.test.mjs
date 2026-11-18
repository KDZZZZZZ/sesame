import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReplay } from '@sesame/plugin-sdk/svl';
import { buildStructure } from '../structure.js';
import { checkTemporalReplay } from '../temporal-verification.js';
import { researchMethod } from '../research-method.js';

const utc = unixMs => ({ basis: 'utc', unixMs });
const bar = (end, close, release = end) => ({ openTime: utc(end - 9), endTime: utc(end), availableAt: utc(release), close: String(close) });
const event = (n, at, bars) => ({ eventId: 'bar-' + n, sequence: String(n), type: 'bar.closed', input: 'bars', availableAt: utc(at), inputs: { bars } });
const instrument = { sourceId: 'fixture', instrumentId: 'TEST' };
const check = (source, events, ids, lengths = [], nodes = [], initialState) => {
  const fixture = { runId: 'fixed', parameters: { instrument }, events, ...(initialState ? { initialState } : {}) };
  const baseline = evaluateReplay(source, fixture);
  assert.equal(baseline.status, 'completed');
  return checkTemporalReplay(source, fixture, baseline, { event_ids: ids, warmup_lengths: lengths, trace_nodes: nodes });
};

test('censoring bars already inside an event detects a late release that changed an earlier decision', () => {
  const source = buildStructure({ components: { alpha: { model: 'close_threshold', settings: { threshold: '10' } } } }).starterSource;
  source.inputs.bars.lookback = 4;
  const early = bar(10, 9), late = bar(20, 15, 30);
  const out = check(source, [event(1, 22, [early, late]), event(2, 30, [early, late])], ['bar-1', 'bar-2'], [], ['close']);
  assert.equal(out.status, 'findings');
  assert.deepEqual(out.checkpoints[0].asOf.stateFields, ['positiveSignal']);
  assert.equal(out.checkpoints[0].asOf.nodeChanges[0].id, 'close');
  assert.equal(out.checkpoints[1].asOf.status, 'agreed_at_checkpoint');
});

test('shorter history clips the event windows too; all decisions use the same timestamp and the same causal inputs', () => {
  const source = buildStructure({ components: { alpha: { model: 'moving_average', settings: { fastPeriod: 2, slowPeriod: 3 } } } }).starterSource;
  const bars = [9, 10, 11, 12].map((price, i) => bar((i + 1) * 10, price));
  const events = bars.map((b, i) => event(i + 1, b.endTime.unixMs, bars.slice(0, i + 1)));
  const out = check(source, events, ['bar-4'], [1, 4, 6], ['latest-slow']);
  const c = out.checkpoints[0];
  assert.equal(c.asOf.status, 'agreed_at_checkpoint');
  assert.equal(c.decisionUtcMs, 40);
  assert.deepEqual(c.warmup.map(w => w.status), ['changed', 'needs_evidence', 'needs_evidence']);
  assert.match(c.warmup[1].message, /identical/);
  assert.ok(c.warmup[0].stateFields.includes('positiveSignal'));
});

test('a missing current bar, a repeated close and a never-ready decision cannot establish agreement', () => {
  const source = buildStructure({ components: { alpha: { model: 'moving_average', settings: { fastPeriod: 2, slowPeriod: 3 } } } }).starterSource;
  const one = bar(10, 9);
  assert.equal(check(source, [event(1, 12, [])], ['bar-1']).status, 'needs_evidence');
  assert.equal(check(source, [event(1, 12, [one]), event(2, 22, [one])], ['bar-2']).status, 'needs_evidence');
  for (const nodes of [[], ['latest-slow']]) {
    const c = check(source, [event(1, 12, [one])], ['bar-1'], [], nodes).checkpoints[0];
    assert.equal(c.asOf.status, 'needs_evidence');
  }
});

test('traced series compare historical samples when the final value stays identical', () => {
  const source = buildStructure({ components: { alpha: { model: 'moving_average', settings: { fastPeriod: 2, slowPeriod: 3 } } } }).starterSource;
  const bars = [bar(10, 5), bar(20, 4, 50), bar(30, 10), bar(40, 20)];
  const out = check(source, [event(1, 40, bars)], ['bar-1'], [], ['fast-average']);
  const change = out.checkpoints[0].asOf.nodeChanges[0];
  assert.equal(change.id, 'fast-average');
  assert.equal(change.scope, 'window_history_only');
  assert.equal(change.baseline[0].value.latest, change.variant[0].value.latest);
  assert.notEqual(change.baseline[0].value.digest, change.variant[0].value.digest);
});

test('sparse decisions cannot substitute for the actual closed bars of a warm-up window', () => {
  const source = buildStructure({ components: { alpha: { model: 'moving_average', settings: { fastPeriod: 2, slowPeriod: 3 } } } }).starterSource;
  const bars = [1, 2, 3, 4, 5, 6, 7].map(n => bar(n * 10, n));
  const events = [1, 4, 7].map((n, i) => event(i + 1, n * 10, bars.slice(0, n)));
  const out = check(source, events, ['bar-3'], [2], ['latest-fast']);
  assert.equal(out.checkpoints[0].asOf.status, 'agreed_at_checkpoint');
  assert.equal(out.checkpoints[0].warmup[0].status, 'needs_evidence');
  assert.match(out.checkpoints[0].warmup[0].message, /decision/);
});

test('a fixture snapshot without a historical origin cannot seed a later warm-up', () => {
  const source = buildStructure({ components: { alpha: { model: 'close_threshold', settings: { threshold: '10' } } } }).starterSource;
  const events = [9, 11].map((price, i) => event(i + 1, (i + 1) * 10, [bar((i + 1) * 10, price)]));
  const out = check(source, events, ['bar-2'], [1], ['close'], { positiveSignal: true });
  assert.equal(out.initialStateBasis, 'fixture_snapshot');
  assert.equal(out.checkpoints[0].asOf.status, 'agreed_at_checkpoint');
  assert.equal(out.checkpoints[0].warmup[0].status, 'needs_evidence');
});

test('a missing publication time or unsupported feed cannot certify a point-in-time test', () => {
  const source = buildStructure({ components: { alpha: { model: 'close_threshold', settings: { threshold: '10' } } } }).starterSource;
  const input = bar(10, 11);
  delete input.availableAt;
  assert.equal(check(source, [event(1, 12, [input])], ['bar-1']).status, 'needs_evidence');
  const decision = event(1, 12, [bar(10, 11)]);
  delete decision.availableAt;
  assert.equal(check(source, [decision], ['bar-1']).status, 'needs_evidence');
  assert.equal(check(source, [event(1, 12, [bar(10, 11, 9)])], ['bar-1']).status, 'needs_evidence');
});

test('all nine research decisions lead to readable packaged methods', async () => {
  const index = await researchMethod();
  assert.equal(index.methods.length, 9);
  for (const item of index.methods) {
    const record = await researchMethod(item.id);
    assert.match(record.guidance, /^# /);
    assert.ok(record.guidance.length > 400);
  }
});
