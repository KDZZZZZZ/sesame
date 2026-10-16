import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '@sesame/plugin-sdk/protocol';
import { assessRisk, evaluatePipeline, planExecution, replaySignals, validatePipeline, validateSignalEvent } from '../packages/strategy-authoring/lib/pipeline.js';
import { createPipelineFixture } from '../packages/strategy-authoring/examples/pipeline-fixture.js';

// Fixed fictional references belong only to this offline test; no host artifact is implied.
const ref = (id, kind = 'resource') => ({ id, kind, revision: 'test-1', schemaVersion: '1.0.0', digest: digest({ fictional: id }) });
const copy = value => JSON.parse(JSON.stringify(value));
const fixture = () => copy(createPipelineFixture({ strategySource: ref('test-strategy', 'strategy.source'), targetProfile: ref('test-profile', 'strategy.target'), strategyId: 'pipeline-demo', evidence: ref('test-evidence') }));
const t = unixMs => ({ basis: 'utc', unixMs });
const signalState = f => replaySignals(f.events, { asOf: f.asOf, scope: f.scope, guards: f.guards });
const risk = f => assessRisk({ target: f.target, signals: signalState(f), policy: f.policy, advice: f.advice });
const execution = (f, decision = risk(f)) => planExecution({ decision, snapshot: f.snapshot, capabilities: f.capabilities, asOf: f.executionAt ?? f.asOf });
function advice(f, action, cap) {
  const now = f.asOf.unixMs;
  return { id: `risk-${action}`, scope: { ...copy(f.scope), instrument: copy(f.events[0].scope.instrument) }, source: { kind: 'agent', id: 'risk-observer', version: '1', configurationDigest: digest('fixture-config'), model: { provider: 'fixture', id: 'fixture-model', version: 'recorded-v1', promptDigest: digest('fixture-prompt') } }, generatedAt: t(now - 10), availableAt: t(now), expiresAt: t(now + 30000), dataCutoffAt: t(now - 1000), inputs: copy(f.events[0].inputs), action, ...(cap === undefined ? {} : { cap: { value: cap, unit: 'share' } }), reason: 'Fictional risk observation', evidence: [ref('risk-observation')] };
}
function position(f, quantity, instrument = f.target.items[0].instrument) {
  return { id: `position-${instrument.instrumentId}`, scope: { ...copy(f.scope), instrument: copy(instrument) }, quantity: { value: quantity, unit: 'share' } };
}
function replacement(original, overrides = {}) {
  return { ...copy(original), id: `${original.id}-r2`, sequence: original.sequence + 2, revision: original.revision + 1, supersedes: { id: original.id, revision: original.revision }, ...overrides };
}

test('a two-instrument frozen fixture has deterministic owned net deltas and immutable stage evidence', () => {
  const f = fixture(), before = JSON.stringify(f), first = evaluatePipeline(f);
  assert.deepEqual(evaluatePipeline(f), first);
  assert.equal(JSON.stringify(f), before, 'No input state is mutated');
  assert.equal(first.validationScope, 'fixed-input-pipeline-evaluation');
  assert.equal(first.nativeEngineExecuted, false);
  assert.equal(first.executionPlan.status, 'ready');
  assert.deepEqual(first.executionPlan.intents.map(intent => intent.quantity), [{ value: '10', unit: 'share' }, { value: '2', unit: 'share' }]);
  assert.ok(first.executionPlan.intents.every(intent => intent.scope.runId === f.scope.runId && intent.deadline.unixMs <= first.riskDecision.validUntil.unixMs));
  assert.equal(first.executionPlan.decisionDigest, first.riskDecision.digest);
  assert.equal(first.executionPlan.evidence[0].digest, f.target.evidence[0].digest);
  assert.equal(validatePipeline(f).executionStatus, 'ready');
});

test('signal availability rather than occurrence controls fixed replay; expiry is not a liquidation order', () => {
  const f = fixture(), early = replaySignals(f.events, { asOf: t(f.asOf.unixMs - 1), scope: f.scope });
  assert.deepEqual(early.active, []);
  const expired = replaySignals(f.events, { asOf: t(f.asOf.unixMs + 120000), scope: f.scope });
  assert.deepEqual(expired.active, []); assert.ok(expired.inactive.every(item => item.reason === 'expired'));
  assert.equal(expired.intents, undefined);
});

test('evidence after cutoff and generation before data availability are rejected without coercion', () => {
  const f = fixture(), event = f.events[0];
  event.inputs[0].availableAt.unixMs = event.dataCutoffAt.unixMs + 1;
  assert.throws(() => validateSignalEvent(event), /available at the declared data cutoff/);
  const invalid = fixture().events[0]; invalid.dataCutoffAt = t(invalid.generatedAt.unixMs + 1);
  assert.throws(() => validateSignalEvent(invalid), /cutoff is later/);
  invalid.generatedAt = { basis: 'wall', value: '2026-10-10T00:00:00', authority: 'broker' };
  assert.throws(() => validateSignalEvent(invalid), /unknown field|resolved UTC/);
});

test('Agent signals require frozen model version, prompt digest and source configuration', () => {
  const f = fixture(), event = f.events[0]; event.source = advice(f, 'halt').source;
  assert.equal(validateSignalEvent(event).source.model.version, 'recorded-v1');
  delete event.source.model.promptDigest;
  assert.throws(() => validateSignalEvent(event), /promptDigest/);
});

test('duplicates are idempotent but conflicting IDs and channel revisions are rejected', () => {
  const f = fixture(); f.events.push(copy(f.events[0]));
  assert.equal(signalState(f).active.length, 2);
  f.events.at(-1).confidence = '0.9';
  assert.throws(() => signalState(f), /reused with different content/);
  const g = fixture(); g.events.push({ ...copy(g.events[0]), sequence: 2, id: 'different-id-same-revision' });
  assert.throws(() => signalState(g), /revision was reused/);
});

test('replacement and withdrawal never revive older predictions after the replacement expires', () => {
  const f = fixture(), original = f.events[0], next = replacement(original, { expiresAt: t(f.asOf.unixMs + 1) });
  f.events.push(next);
  assert.deepEqual(signalState(f).active.map(value => value.id), [next.id, f.events[1].id]);
  const later = replaySignals(f.events, { asOf: t(f.asOf.unixMs + 2), scope: f.scope });
  assert.ok(!later.active.some(value => value.scope.instrument.instrumentId === 'DEMO_A'));
  const withdrawal = replacement(next, { kind: 'withdrawal', reason: 'Thesis ended', sequence: 3 });
  delete withdrawal.direction; delete withdrawal.confidence; delete withdrawal.expiresAt;
  f.events.push(withdrawal);
  assert.ok(!signalState(f).active.some(value => value.scope.instrument.instrumentId === 'DEMO_A'));
});

test('late older model completions cannot replace a newer channel revision', () => {
  const f = fixture(), original = f.events[0], now = f.asOf.unixMs;
  const newer = replacement(original, { id: 'revision-3', revision: 3, generatedAt: t(now), availableAt: t(now) });
  const delayed = replacement(original, { id: 'delayed-revision-2', sequence: 3, generatedAt: t(now - 50), availableAt: t(now + 1) });
  f.events.push(newer, delayed); f.asOf = t(now + 1);
  const state = signalState(f);
  assert.ok(state.active.some(value => value.id === newer.id));
  assert.ok(state.inactive.some(value => value.signal.id === delayed.id && value.reason === 'late_revision'));
});

test('missing supersession history and nonmonotonic availability are rejected', () => {
  const f = fixture(), newer = replacement(f.events[0]); delete newer.supersedes; f.events.push(newer);
  assert.throws(() => signalState(f), /explicitly supersede/);
  const g = fixture(); g.events[1].availableAt = t(g.asOf.unixMs - 1);
  assert.throws(() => signalState(g), /nondecreasing availability/);
});

test('ownership, unit and target-source mistakes do not become execution plans', () => {
  const f = fixture(); f.target.scope.account.accountId = 'another';
  assert.throws(() => evaluatePipeline(f), /different ownership/);
  const g = fixture(); g.target.items[0].quantity.unit = 'lot';
  assert.throws(() => evaluatePipeline(g), /quantity units differ/);
  const h = fixture(); h.target.items[0].signalRefs = [h.target.items[1].signalRefs[0]];
  assert.throws(() => evaluatePipeline(h), /no recorded signal evidence/);
  const i = fixture(); i.target.strategySource.kind = 'resource';
  assert.throws(() => evaluatePipeline(i), /strategy.source/);
});

test('an allocation cannot cite an expired signal or execute beyond that signal lifetime', () => {
  const f = fixture(); f.events[0].expiresAt = t(f.asOf.unixMs);
  assert.throws(() => evaluatePipeline(f), /inactive/);
  const g = fixture(); g.target.validUntil = t(g.events[0].expiresAt.unixMs + 1);
  assert.throws(() => evaluatePipeline(g), /outlive/);
  const h = fixture(); h.executionAt = t(h.asOf.unixMs + 60000);
  assert.equal(evaluatePipeline(h).executionPlan.status, 'blocked');
});

test('risk advice cannot enlarge a hard cap, change quantity sign or enable shorting', () => {
  const f = fixture(); f.target.items[0].quantity.value = '50'; f.policy.limits[0].maxAbsPosition = '20';
  f.advice.push(advice(f, 'cap', '80'));
  let result = evaluatePipeline(f);
  assert.equal(result.riskDecision.items[0].quantity.value, '20');
  assert.ok(result.riskDecision.items[0].reasons.some(value => value.reason === 'cannot_relax_hard_cap'));
  f.target.items[0].quantity.value = '-50'; f.advice[0].cap.value = '5'; f.policy.limits[0].allowShort = true;
  result = evaluatePipeline(f); assert.equal(result.riskDecision.items[0].quantity.value, '-5');
  f.policy.limits[0].allowShort = false;
  assert.equal(evaluatePipeline(f).riskDecision.items[0].quantity.value, '0');
  f.advice[0].allowShort = true;
  assert.throws(() => evaluatePipeline(f), /unknown field allowShort/);
});

test('risk halt permits reduction but forbids an increase and a same-magnitude sign flip', () => {
  const f = fixture(); f.policy.limits[0].allowShort = true; f.snapshot.positions.push(position(f, '10')); f.advice.push(advice(f, 'halt'));
  f.target.items[0].quantity.value = '-10';
  assert.equal(evaluatePipeline(f).executionPlan.positions[0].target.value, '10');
  f.target.items[0].quantity.value = '15';
  assert.equal(evaluatePipeline(f).executionPlan.positions[0].target.value, '10');
  f.target.items[0].quantity.value = '4';
  assert.equal(evaluatePipeline(f).executionPlan.intents[0].quantity.value, '6');
  assert.equal(evaluatePipeline(f).executionPlan.intents[0].purpose, 'reduce');
});

test('risk liquidation retires every currently active signal for the instrument and carries a durable cooldown', () => {
  const f = fixture(), now = f.asOf.unixMs;
  const secondSource = copy(f.events[0]); secondSource.id = 'other-active-thesis'; secondSource.sequence = 2; secondSource.source.id = 'another-alpha'; f.events.push(secondSource);
  f.advice.push(advice(f, 'flatten')); f.snapshot.positions.push(position(f, '10'));
  const result = evaluatePipeline(f), guard = result.riskDecision.guards[0];
  assert.equal(result.riskDecision.items[0].quantity.value, '0');
  assert.equal(result.executionPlan.intents[0].purpose, 'reduce');
  assert.equal(guard.retiredSignals.length, 2);
  let state = replaySignals(f.events, { scope: f.scope, asOf: t(now + 11000), guards: [guard] });
  assert.ok(!state.active.some(value => value.scope.instrument.instrumentId === 'DEMO_A'));
  const next = replacement(f.events[0], { sequence: 3, availableAt: t(now + 100), generatedAt: t(now + 100) }); f.events.push(next);
  state = replaySignals(f.events, { scope: f.scope, asOf: t(now + 1000), guards: [guard] });
  assert.ok(state.inactive.some(value => value.signal.id === next.id && value.reason === 'risk_cooldown'));
  state = replaySignals(f.events, { scope: f.scope, asOf: t(now + 11000), guards: [guard] });
  assert.ok(state.active.some(value => value.id === next.id));
});

test('risk flatten does not imply the backend has filled the exit, and a zero cap also retires old signals', () => {
  const f = fixture(); f.policy.limits[0].maxAbsPosition = '0';
  const result = evaluatePipeline(f);
  assert.equal(result.riskDecision.guards.length, 1);
  assert.equal(result.executionPlan.nativeEngineExecuted, false);
  assert.equal(result.executionPlan.fills, undefined);
});

test('old or future advice is not used; stale input advice stops new risk and cannot extend validity', () => {
  const f = fixture(), now = f.asOf.unixMs, old = advice(f, 'cap', '0'); old.expiresAt = t(now - 1); old.generatedAt = t(now - 100); f.advice = [old];
  let result = evaluatePipeline(f);
  assert.equal(result.riskDecision.items[0].quantity.value, '10');
  assert.equal(result.riskDecision.ignoredAdvice[0].reason, 'expired');
  f.advice = [advice(f, 'flatten')]; f.advice[0].availableAt = t(now + 1);
  result = evaluatePipeline(f); assert.equal(result.riskDecision.items[0].quantity.value, '10');
  f.advice = [advice(f, 'halt')]; f.advice[0].dataCutoffAt = t(now - 60001); f.advice[0].inputs[0].availableAt = t(now - 60001);
  result = evaluatePipeline(f); assert.equal(result.riskDecision.items[0].mode, 'halt');
  assert.ok(result.riskDecision.ignoredAdvice.some(value => value.reason === 'stale_inputs'));
  assert.ok(result.riskDecision.items[0].newRiskValidUntil.unixMs <= f.advice[0].expiresAt.unixMs);
});

test('complete positions without complete orders and intent ledger remain blocked', () => {
  const f = fixture(); f.snapshot.complete.pendingIntents = false;
  const result = evaluatePipeline(f).executionPlan;
  assert.equal(result.status, 'needs_reconciliation'); assert.deepEqual(result.intents, []);
  delete f.snapshot.complete.workingOrders;
  assert.throws(() => evaluatePipeline(f), /Completeness must be explicit/);
});

test('unknown, submitted, partially-filled and cancellation-pending requests require reconciliation, never a guessed offset', () => {
  for (const status of ['unknown', 'sent', 'partially_filled', 'cancel_pending']) {
    const f = fixture(); f.snapshot.pendingIntents.push({ id: `request-${status}`, scope: f.events[0].scope, status });
    const result = evaluatePipeline(f).executionPlan;
    assert.equal(result.status, 'needs_reconciliation'); assert.deepEqual(result.intents, []);
    assert.deepEqual(result.reasons[0].requestIds, [`request-${status}`]);
  }
});

test('other runs, changed accounts and offsetting hedge positions are not silently netted', () => {
  const f = fixture(), row = position(f, '5'); row.scope.runId = 'another-run'; f.snapshot.positions.push(row);
  assert.equal(evaluatePipeline(f).executionPlan.status, 'needs_reconciliation');
  row.scope.account.accountId = 'another-account';
  assert.throws(() => evaluatePipeline(f), /different account/);
  const g = fixture(); g.snapshot.positions = [position(g, '5'), { ...position(g, '-5'), id: 'opposing-hedge' }];
  assert.throws(() => evaluatePipeline(g), /Offsetting hedge positions/);
});

test('account time must be known, available and fresh; a future observation cannot leak into an earlier plan', () => {
  const f = fixture(); f.snapshot.observedAt.unixMs -= 1001;
  assert.equal(evaluatePipeline(f).executionPlan.status, 'blocked');
  const g = fixture(); g.snapshot.availableAt.unixMs += 1;
  assert.equal(evaluatePipeline(g).executionPlan.reasons[0].reason, 'snapshot_not_available');
});

test('order quantities use Decimal34 and declared steps without converting shares into lots', () => {
  const f = fixture(); f.target.items[0].quantity.value = '10.9'; f.snapshot.positions.push(position(f, '0.1'));
  f.capabilities.instruments[0].step = '0.1'; f.capabilities.instruments[0].minimum = '0.1';
  assert.equal(evaluatePipeline(f).executionPlan.intents[0].quantity.value, '10.8');
  const g = fixture(); g.target.items[0].quantity.value = '10.9';
  assert.equal(evaluatePipeline(g).executionPlan.positions[0].target.value, '10');
  g.snapshot.positions.push(position(g, '0.5'));
  assert.equal(evaluatePipeline(g).executionPlan.status, 'requires_backend_planner');
  const h = fixture(); h.snapshot.positions.push(position(h, '2')); h.snapshot.positions[0].quantity.unit = 'lot';
  assert.throws(() => evaluatePipeline(h), /quantity units differ/);
});

test('a Decimal34 quantization round-trip cannot falsely prove an exceptionally small step is divisible', () => {
  const f = fixture(); f.target.items[0].quantity.value = '2';
  f.capabilities.instruments[0].step = `0.${'0'.repeat(33)}3`; f.capabilities.instruments[0].minimum = f.capabilities.instruments[0].step;
  const result = evaluatePipeline(f).executionPlan;
  assert.equal(result.status, 'requires_backend_planner'); assert.deepEqual(result.intents, []);
});

test('rounding a large position difference must not create an order that overshoots the exact target', () => {
  const f = fixture(), large = `1${'0'.repeat(33)}`, small = `0.${'0'.repeat(33)}1`;
  f.target.items[0].quantity.value = large; f.policy.limits[0].maxAbsPosition = large; f.policy.limits[0].maxOrderQuantity = large;
  f.snapshot.positions.push(position(f, small)); f.capabilities.instruments[0].step = small; f.capabilities.instruments[0].minimum = small;
  const result = evaluatePipeline(f).executionPlan;
  assert.equal(result.status, 'requires_backend_planner'); assert.deepEqual(result.intents, []);
  assert.equal(result.reasons[0].reason, 'quantity_arithmetic_exceeds_precision');
});

test('target reversal, protection, OCO and software support are explicitly delegated without emitting partial plans', () => {
  const f = fixture(); f.target.items[0].requirements = ['oco'];
  let result = evaluatePipeline(f).executionPlan;
  assert.equal(result.status, 'requires_backend_planner'); assert.deepEqual(result.intents, []);
  assert.equal(result.reasons[0].reason, 'unsupported_required_capability');
  f.capabilities.features.oco = 'native';
  result = evaluatePipeline(f).executionPlan; assert.equal(result.reasons[0].reason, 'requires_backend_order_planner');
  f.target.items[0].requirements = []; f.capabilities.features.marketOrder = 'software';
  assert.deepEqual(evaluatePipeline(f).executionPlan.intents, []);
  const g = fixture(); g.policy.limits[0].allowShort = true; g.snapshot.positions.push(position(g, '10')); g.target.items[0].quantity.value = '-10';
  assert.equal(evaluatePipeline(g).executionPlan.status, 'requires_backend_planner');
});

test('exceeding a per-order limit never silently creates an unbounded split-order strategy', () => {
  const f = fixture(); f.policy.limits[0].maxOrderQuantity = '5';
  const result = evaluatePipeline(f).executionPlan;
  assert.equal(result.status, 'requires_backend_planner'); assert.deepEqual(result.intents, []);
});

test('classic state machines can supply fixed rule evidence and explicit exit targets without an Alpha model', () => {
  const f = fixture(); f.events = [];
  for (const item of f.target.items) { item.signalRefs = []; item.stateMachineEvidence = { ref: ref('classic-rule-evaluation'), evaluatedAt: f.asOf, availableAt: f.asOf }; }
  assert.equal(evaluatePipeline(f).executionPlan.status, 'ready');
  f.target.items[0].purpose = 'exit'; f.target.items[0].quantity.value = '0'; f.snapshot.positions.push(position(f, '4'));
  assert.equal(evaluatePipeline(f).executionPlan.intents[0].purpose, 'reduce');
});

test('unknown signal confidence is omitted, while claimed confidence must stay within zero and one', () => {
  const event = fixture().events[0]; delete event.confidence;
  assert.equal(validateSignalEvent(event).confidence, undefined);
  event.confidence = '1.01'; assert.throws(() => validateSignalEvent(event), /Confidence exceeds/);
});

test('delayed pre-exit model output and reused classic-rule evidence cannot bypass a risk exit', () => {
  const f = fixture(), now = f.asOf.unixMs; f.advice.push(advice(f, 'flatten'));
  const guard = evaluatePipeline(f).riskDecision.guards[0];
  const delayed = replacement(f.events[0], { availableAt: t(now + 11000), generatedAt: t(now - 50) });
  f.events.push(delayed);
  const state = replaySignals(f.events, { scope: f.scope, asOf: t(now + 11000), guards: [guard] });
  assert.ok(state.inactive.some(row => row.signal.id === delayed.id && row.reason === 'risk_retired'));
  f.events = []; f.advice = []; f.guards = [guard]; f.asOf = t(now + 11000); f.target.createdAt = f.asOf; f.snapshot.observedAt = f.asOf; f.snapshot.availableAt = f.asOf;
  for (const item of f.target.items) { item.signalRefs = []; item.stateMachineEvidence = { ref: ref('pre-risk-state'), evaluatedAt: t(now), availableAt: t(now) }; }
  const evaluated = evaluatePipeline(f);
  assert.equal(evaluated.riskDecision.items[0].mode, 'halt');
  assert.equal(evaluated.executionPlan.positions[0].target.value, '0');
});

test('a halt cannot preserve exposure that is already outside hard quantity or shorting limits', () => {
  const f = fixture(); f.policy.limits[0].allowShort = true; f.policy.limits[0].maxAbsPosition = '5';
  f.snapshot.positions.push(position(f, '10')); f.target.items[0].quantity.value = '-4'; f.advice.push(advice(f, 'halt'));
  assert.equal(evaluatePipeline(f).executionPlan.positions[0].target.value, '5');
  f.snapshot.positions[0].quantity.value = '-10'; f.target.items[0].quantity.value = '4'; f.policy.limits[0].allowShort = false;
  assert.equal(evaluatePipeline(f).executionPlan.positions[0].target.value, '0');
});

test('risk input freshness is checked again at execution; a fresh account alone cannot authorize new risk', () => {
  const f = fixture(), now = f.asOf.unixMs; f.advice = [advice(f, 'cap', '5')];
  f.advice[0].dataCutoffAt = t(now - 59900); f.advice[0].inputs[0].availableAt = t(now - 59900);
  f.executionAt = t(now + 1000); f.snapshot.observedAt = f.executionAt; f.snapshot.availableAt = f.executionAt;
  const result = evaluatePipeline(f);
  assert.ok(!result.executionPlan.intents.some(intent => intent.scope.instrument.instrumentId === 'DEMO_A' && intent.purpose === 'increase'));
  assert.equal(result.executionPlan.positions[0].restriction, 'new_risk_inputs_expired');
});

test('stale alpha does not block a current risk flatten or an otherwise valid same-side reduction', () => {
  const f = fixture(), now = f.asOf.unixMs, event = f.events[0];
  event.occurredAt = t(now - 62000); event.generatedAt = t(now - 61000); event.dataCutoffAt = t(now - 62000); event.inputs[0].availableAt = event.dataCutoffAt;
  f.advice = [advice(f, 'flatten')]; f.snapshot.positions = [position(f, '10')];
  let result = evaluatePipeline(f);
  assert.equal(result.executionPlan.intents.find(intent => intent.scope.instrument.instrumentId === 'DEMO_A').quantity.value, '10');
  f.advice = []; f.target.items[0].quantity.value = '4';
  result = evaluatePipeline(f);
  assert.equal(result.executionPlan.intents.find(intent => intent.scope.instrument.instrumentId === 'DEMO_A').quantity.value, '6');
});

test('an explicitly required Agent risk source must be present, current and match version for every instrument', () => {
  const f = fixture(); f.policy.requiredRiskSources = [{ kind: 'agent', id: 'risk-observer', version: '1' }];
  let result = evaluatePipeline(f);
  assert.equal(result.executionPlan.status, 'noop'); assert.ok(result.riskDecision.items.every(item => item.mode === 'halt'));
  f.advice.push(advice(f, 'allow')); result = evaluatePipeline(f);
  assert.deepEqual(result.executionPlan.intents.map(intent => intent.scope.instrument.instrumentId), ['DEMO_A']);
  f.advice[0].source.version = 'different-version';
  assert.equal(evaluatePipeline(f).executionPlan.status, 'noop');
  f.advice[0].source.version = '1'; f.advice[0].availableAt.unixMs += 1;
  assert.equal(evaluatePipeline(f).executionPlan.status, 'noop');
  f.advice[0].availableAt = f.asOf; f.advice[0].expiresAt = t(f.asOf.unixMs - 1);
  assert.equal(evaluatePipeline(f).executionPlan.status, 'noop');
});

test('allow means no extra restriction: it cannot relax another cap and mandatory judgment loss does not force liquidation', () => {
  const f = fixture(); f.policy.requiredRiskSources = [{ kind: 'agent', id: 'risk-observer', version: '1' }];
  f.advice = [advice(f, 'allow'), advice(f, 'cap', '3')];
  assert.equal(evaluatePipeline(f).executionPlan.intents[0].quantity.value, '3');
  f.advice = []; f.snapshot.positions.push(position(f, '5'));
  assert.equal(evaluatePipeline(f).executionPlan.positions[0].target.value, '5');
  f.target.items[0].quantity.value = '2';
  assert.equal(evaluatePipeline(f).executionPlan.intents[0].purpose, 'reduce');
});

test('a serialized decision cannot be modified and reused as though its receipt still matched', () => {
  const f = fixture(), decision = risk(f); decision.items[0].quantity.value = '999';
  assert.throws(() => execution(f, decision), /Risk decision was changed/);
});

test('the reference evaluator contains no implicit wall-clock, random event ID, broker or model calls', async () => {
  const f = fixture(), before = evaluatePipeline(f), originalNow = Date.now, originalFetch = globalThis.fetch;
  Date.now = () => { throw new Error('Unexpected live clock'); };
  globalThis.fetch = () => { throw new Error('Unexpected live request'); };
  try { assert.deepEqual(evaluatePipeline(f), before); }
  finally { Date.now = originalNow; globalThis.fetch = originalFetch; }
});
