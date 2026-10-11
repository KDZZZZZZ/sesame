import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '@sesame/plugin-sdk/protocol';
import { evaluatePipeline } from '../packages/strategy-authoring/lib/pipeline.js';
import { selectUniverse } from '../packages/strategy-authoring/lib/universe.js';
import { createMethodWorkflow } from '../packages/strategy-authoring/examples/method-workflow.js';

const ref = (id, kind = 'resource') => ({ id, kind, revision: 'test-1', schemaVersion: '1.0.0', digest: digest({ fictional: id }) });
const copy = value => JSON.parse(JSON.stringify(value));
const fixture = () => copy(createMethodWorkflow({ strategySource: ref('source', 'strategy.source'), targetProfile: ref('target', 'strategy.target'), strategyId: 'test-methods', evidence: ref('teaching') }));
const quantities = result => result.target.items.map(item => item.quantity.value);
const position = (f, quantity, index = 0) => ({ id: `position-${index}`, scope: { ...copy(f.scope), instrument: copy(f.portfolio.instruments[index].instrument) }, quantity: { value: quantity, unit: 'share' } });

test('equal allocation computes actual multi-currency quantities with complete evidence and deterministic order', () => {
  const f = fixture(), before = JSON.stringify(f), result = evaluatePipeline(f);
  assert.deepEqual(quantities(result), ['5', '25']); assert.equal(result.construction.estimatedRemainingCash.value, '0');
  assert.equal(result.construction.allocations[1].fxRate, '2'); assert.equal(result.executionProgram.orders.length, 2);
  assert.deepEqual(result.executionReplay.commands.map(command => command.kind), ['submit', 'submit']);
  assert.equal(result.validationScope, 'fixed-input-strategy-method-workflow'); assert.equal(result.nativeEngineExecuted, false);
  assert.equal(JSON.stringify(f), before); assert.deepEqual(evaluatePipeline(f), result);
});

test('confidence and inverse-volatility scores produce independently checked sized portfolios', () => {
  const f = fixture(); f.portfolio.method = 'confidence'; let result = evaluatePipeline(f);
  assert.deepEqual(quantities(result), ['2', '37']); assert.equal(result.construction.estimatedRemainingCash.value, '60');
  f.portfolio.method = 'inverse_volatility'; result = evaluatePipeline(f);
  assert.deepEqual(quantities(result), ['6', '16']); assert.equal(result.construction.estimatedRemainingCash.value, '80');
  delete f.portfolio.instruments[0].volatility; assert.throws(() => evaluatePipeline(f), /requires fixed volatility/);
  f.portfolio.method = 'confidence'; delete f.events[0].confidence; assert.throws(() => evaluatePipeline(f), /unknown is not zero/);
});

test('reserves, exact proportional fees, contract multipliers and minimum lots stay within budget', () => {
  const f = fixture(); f.portfolio.reserveFraction = '0.1'; f.portfolio.feeRate = '0.01'; f.portfolio.instruments[1].multiplier = '5';
  let result = evaluatePipeline(f); assert.deepEqual(quantities(result), ['4', '4']); assert.equal(result.construction.estimatedFees.value, '8'); assert.equal(result.construction.estimatedRemainingCash.value, '192');
  f.portfolio.instruments[1].minimum = '5'; result = evaluatePipeline(f); assert.equal(result.target.items[1].quantity.value, '0'); assert.equal(result.construction.estimatedRemainingCash.value, '596');
});

test('fractional lots never overspend when rational allocation falls immediately below a boundary', () => {
  const f = fixture(); f.universe.topN = 1; f.portfolio.budget.value = '0.3'; f.portfolio.instruments[1].price.value = '0.1'; f.portfolio.fx[0].rate = '1'; f.portfolio.instruments[1].step = '1';
  assert.equal(evaluatePipeline(f).target.items[0].quantity.value, '3');
  f.portfolio.budget.value = '0.2999999999999999999999999999999999';
  assert.equal(evaluatePipeline(f).target.items[0].quantity.value, '2');
});

test('universe supports typed filters, ranking, ties and added/removed membership', () => {
  const f = fixture(), input = { ...f.universe, asOf: f.asOf };
  input.filter = { all: [{ field: 'liquidity', type: 'decimal', op: 'gte', value: '1000' }, { field: 'market', type: 'string', op: 'in', value: ['demo'] }] }; input.topN = 1; input.previous = [input.candidates[0].instrument];
  let result = selectUniverse(input); assert.equal(result.selected[0].instrumentId, 'DEMO_B'); assert.equal(result.added.length, 1); assert.equal(result.removed[0].instrumentId, 'DEMO_A');
  input.candidates[1].fields.liquidity = '1000'; result = selectUniverse(input); assert.equal(result.selected[0].instrumentId, 'DEMO_A');
  delete input.candidates[0].fields.liquidity; result = selectUniverse(input); assert.equal(result.selected[0].instrumentId, 'DEMO_B');
});

test('future/stale candidates cannot leak into dynamic membership and unsafe ranking data is rejected', () => {
  const f = fixture(), input = { ...f.universe, asOf: f.asOf }; input.candidates[1].availableAt.unixMs++;
  let result = selectUniverse(input); assert.deepEqual(result.selected.map(value => value.instrumentId), ['DEMO_A']);
  input.candidates[0].observedAt.unixMs -= 10000; result = selectUniverse(input); assert.deepEqual(result.selected, []);
  input.candidates[0].observedAt = f.asOf; input.candidates[0].fields.liquidity = 'NaN'; assert.throws(() => selectUniverse(input), /decimal/);
});

test('missing/expired signals and removed instruments hold existing positions unless the policy explicitly exits', () => {
  const f = fixture(); f.snapshot.positions.push(position(f, '2')); f.events[0].expiresAt = f.asOf;
  let result = evaluatePipeline(f); const held = result.target.items.find(item => item.instrument.instrumentId === 'DEMO_A');
  assert.equal(held.purpose, 'hold'); assert.equal(held.quantity.value, '2'); assert.equal(result.construction.heldNotional.value, '200');
  assert.equal(result.executionPlan.intents.some(intent => intent.scope.instrument.instrumentId === 'DEMO_A'), false);
  f.portfolio.inactiveSignalPolicy = 'flatten'; result = evaluatePipeline(f); assert.equal(result.target.items.find(item => item.instrument.instrumentId === 'DEMO_A').purpose, 'exit');
  f.portfolio.inactiveSignalPolicy = 'hold'; f.universe.topN = 1; result = evaluatePipeline(f); assert.equal(result.target.items.find(item => item.instrument.instrumentId === 'DEMO_A').purpose, 'hold');
  f.portfolio.removedInstrumentPolicy = 'flatten'; result = evaluatePipeline(f); assert.equal(result.target.items.find(item => item.instrument.instrumentId === 'DEMO_A').quantity.value, '0');
});

test('holding an old position reserves its budget and never silently liquidates it to fund new signals', () => {
  const f = fixture(); f.snapshot.positions.push(position(f, '11')); f.events[0].expiresAt = f.asOf;
  assert.throws(() => evaluatePipeline(f), /Preserved holdings already exceed/);
});

test('an empty universe without existing positions is a no-op', () => {
  const f = fixture(); f.universe.topN = 0;
  const result = evaluatePipeline(f); assert.deepEqual(result.target.items, []); assert.equal(result.executionProgram.status, 'noop');
});

test('conflicting channels require an explicit aggregation policy', () => {
  const f = fixture(), other = copy(f.events[0]); other.id = 'opposing'; other.channel = 'contrarian'; other.direction = 'short'; other.sequence = 2; f.events.push(other); f.portfolio.signalAggregation = 'consensus';
  let result = evaluatePipeline(f); assert.equal(result.target.items.some(item => item.instrument.instrumentId === 'DEMO_A'), false); assert.ok(result.construction.diagnostics.some(value => value.reason === 'conflicting_signals'));
  f.portfolio.signalAggregation = 'latest'; assert.throws(() => evaluatePipeline(f), /Cash-only/);
  f.portfolio.budgetBasis = 'gross_notional'; f.policy.limits[0].allowShort = true; result = evaluatePipeline(f); assert.equal(result.target.items[0].quantity.value, '-5'); assert.equal(result.construction.estimatedRemainingCash, undefined);
});

test('missing FX, unknown contract valuation, stale prices and foreign account holdings are rejected', () => {
  const f = fixture(); f.portfolio.fx = []; assert.throws(() => evaluatePipeline(f), /Missing explicit EUR\/USD/);
  const g = fixture(); g.portfolio.instruments[0].valuation = 'inverse'; assert.throws(() => evaluatePipeline(g), /linear contract/);
  const h = fixture(); h.portfolio.instruments[0].observedAt.unixMs -= 10000; assert.throws(() => evaluatePipeline(h), /stale/);
  const i = fixture(); i.snapshot.positions.push(position(i, '1')); i.snapshot.positions[0].scope.account.accountId = 'foreign'; assert.throws(() => evaluatePipeline(i), /ownership differs/);
});

test('gross, net and overlapping group limits reduce targets and remain true after rounding', () => {
  const f = fixture(); f.portfolioRisk.maxGrossExposure = '0.5'; let result = evaluatePipeline(f); assert.deepEqual(quantities(result), ['2', '12']); assert.equal(result.portfolioRisk.after.gross, '440');
  f.portfolioRisk.maxGrossExposure = '1'; f.portfolioRisk.maxAbsNetExposure = '0.3'; result = evaluatePipeline(f); assert.deepEqual(quantities(result), ['1', '7']); assert.equal(result.portfolioRisk.after.net, '240');
  f.portfolioRisk.maxAbsNetExposure = '1'; f.portfolioRisk.groupLimits[0].maxGrossExposure = '0.4'; result = evaluatePipeline(f); assert.equal(result.portfolioRisk.after.gross, '400');
  assert.ok(result.riskDecision.items.every(item => item.effectiveMaxAbsPosition === item.quantity.value));
});

test('a hard per-instrument cap cannot unbalance a hedge beyond the portfolio net limit', () => {
  const f = fixture(); f.portfolio.budgetBasis = 'gross_notional'; f.events[1].direction = 'short'; f.policy.limits[1].allowShort = true; f.portfolioRisk.maxAbsNetExposure = '0'; f.policy.limits[1].maxAbsPosition = '5';
  f.snapshot.positions = [position(f, '3', 0), position(f, '-15', 1)];
  const r = evaluatePipeline(f); assert.equal(r.portfolioRisk.after.net, '0'); assert.equal(r.portfolioEnforcement.status, 'flatten_required'); assert.equal(r.portfolioEnforcement.actual.net, '400');
  assert.equal(r.portfolioEnforcement.final.actual.net, '0'); assert.ok(r.executionPlan.positions.every(row => row.target.value === '0')); assert.equal(r.riskDecision.guards.length, 2); assert.ok(r.executionProgram.orders.every(order => order.reduceOnly));
});

test('a risk flatten overrides a missing-signal hold instead of retaining the old position', () => {
  const f = fixture(), evidence = ref('fresh-risk'); f.events[0].expiresAt = f.asOf; f.snapshot.positions = [position(f, '2')];
  f.advice = [{ id: 'fresh-exit', scope: { ...copy(f.scope), instrument: copy(f.events[0].scope.instrument) }, source: { kind: 'algorithm', id: 'risk', version: '1', configurationDigest: evidence.digest }, generatedAt: f.asOf, availableAt: f.asOf, expiresAt: { basis: 'utc', unixMs: f.asOf.unixMs + 1000 }, dataCutoffAt: f.asOf, inputs: [{ ref: evidence, availableAt: f.asOf }], action: 'flatten', reason: 'Risk exit', evidence: [evidence] }];
  const r = evaluatePipeline(f), plan = r.executionPlan.positions.find(row => row.instrument.instrumentId === 'DEMO_A'); assert.equal(plan.target.value, '0'); assert.equal(plan.delta.value, '-2'); assert.ok(r.executionProgram.orders.find(order => order.scope.instrument.instrumentId === 'DEMO_A').reduceOnly);
});

test('equity drawdown uses only known complete history and creates durable risk exits', () => {
  const f = fixture(); f.snapshot.positions.push(position(f, '2')); f.portfolioRisk.equity.observations[0].value = '1250';
  const result = evaluatePipeline(f); assert.equal(result.portfolioRisk.drawdown, '0.2'); assert.ok(result.target.items.every(item => item.quantity.value === '0')); assert.equal(result.riskDecision.guards.length, 2);
  assert.ok(result.executionProgram.orders.some(order => order.reduceOnly));
  const g = fixture(); g.portfolioRisk.equity.complete = false; assert.throws(() => evaluatePipeline(g), /complete equity history/);
  const h = fixture(); h.portfolioRisk.equity.observations[1].availableAt.unixMs++; assert.throws(() => evaluatePipeline(h), /missing or stale/);
});

test('future equity highs cannot manufacture a drawdown at an earlier decision time', () => {
  const f = fixture(); const future = copy(f.portfolioRisk.equity.observations[1]); future.id = 'future-peak'; future.value = '1000000'; future.observedAt.unixMs++; future.availableAt.unixMs++; f.portfolioRisk.equity.observations.push(future);
  assert.equal(evaluatePipeline(f).portfolioRisk.drawdown, '0');
});

test('valuation, FX and equity freshness constrain later execution as well as initial construction', () => {
  const f = fixture(); f.policy.limits.forEach(limit => { limit.maxSnapshotAgeMs = 10000; }); f.executionAt = { basis: 'utc', unixMs: f.asOf.unixMs + 950 };
  let r = evaluatePipeline(f); assert.equal(r.executionProgram.status, 'blocked'); assert.ok(r.executionPlan.reasons.some(reason => reason.reason === 'decision_not_active'));
  const g = fixture(); g.portfolio.maxDataAgeMs = 10000; g.portfolioRisk.maxEquityAgeMs = 100; g.executionAt = { basis: 'utc', unixMs: g.asOf.unixMs + 200 }; r = evaluatePipeline(g); assert.equal(r.executionProgram.status, 'blocked');
});

test('duplicate and object-like group names neither double count nor escape a hard group cap', () => {
  const f = fixture(); f.portfolio.instruments[0].groups = ['__proto__', '__proto__']; f.portfolio.instruments[1].groups = ['__proto__']; f.portfolioRisk.groupLimits = [{ group: '__proto__', maxGrossExposure: '0.5' }];
  const r = evaluatePipeline(f); assert.equal(r.portfolioRisk.before.groups.__proto__, '1000'); assert.equal(r.portfolioRisk.after.groups.__proto__, '440');
});

test('single-order maximum becomes bounded sequential chunks instead of a silent oversized order', () => {
  const f = fixture(); f.policy.limits[1].maxOrderQuantity = '10'; const result = evaluatePipeline(f);
  assert.deepEqual(result.executionProgram.orders.filter(order => order.scope.instrument.instrumentId === 'DEMO_B').map(order => order.quantity.value), ['10', '10', '5']);
  assert.equal(result.executionReplay.commands.filter(command => command.scope.instrument.instrumentId === 'DEMO_B' && command.kind === 'submit').length, 1);
});

test('missing or unselected software protection capabilities cannot degrade into an unprotected entry', () => {
  const f = fixture(); f.execution.config.protection = [{ instrument: f.portfolio.instruments[0].instrument, stopPrice: { value: '90', currency: 'USD' }, takeProfitPrice: { value: '120', currency: 'USD' } }];
  f.capabilities.features.ocoQuantityReduction = 'software'; assert.throws(() => evaluatePipeline(f), /not selected/);
  f.execution.config.allowSoftwareFeatures = ['ocoQuantityReduction']; f.execution.config.emulationEvidence = ref('software-controller');
  const result = evaluatePipeline(f); assert.equal(result.executionProgram.orders.filter(order => order.parentOrderId).length, 2); assert.equal(result.executionProgram.safety[0].atomic, false);
});

export { fixture as methodFixture, ref as fictionalRef };
