import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '@sesame/plugin-sdk/protocol';
import { evaluatePipeline } from '../packages/strategy-authoring/lib/pipeline.js';
import { replayExecution, createExecutionProgram } from '../packages/strategy-authoring/lib/execution.js';
import { createMethodWorkflow } from '../packages/strategy-authoring/examples/method-workflow.js';

const ref = (id, kind = 'resource') => ({ id, kind, revision: 'test-1', schemaVersion: '1.0.0', digest: digest({ fictional: id }) });
const copy = value => JSON.parse(JSON.stringify(value));
function setup(change = () => {}) {
  const fixture = createMethodWorkflow({ strategySource: ref('source', 'strategy.source'), targetProfile: ref('target', 'strategy.target'), strategyId: 'execution-test', evidence: ref('fictional-fixture') });
  fixture.universe.topN = 1; fixture.universe.rank[0].order = 'asc'; fixture.portfolio.budget.value = '500'; change(fixture);
  const result = evaluatePipeline(fixture), program = result.executionProgram, orders = program.orders, events = [];
  const event = (type, order = orders[0], payload = {}, offset) => { const sequence = events.length; const time = { basis: 'utc', unixMs: fixture.asOf.unixMs + (offset ?? sequence + 1) }; const value = { schemaVersion: '1.0.0', id: `event-${sequence}`, sequence, type, scope: copy(order.scope), ...(type === 'position_confirmed' ? {} : { orderId: order.orderId }), occurredAt: time, availableAt: time, payload: copy(payload), evidence: [ref('broker-fact')] }; events.push(value); return value; };
  const send = order => { event('submitted', order, { requestId: `send-${order.orderId}` }); event('accepted', order, { venueOrderId: `venue-${order.orderId}` }); };
  const fill = (value, order = orders[0], id = `fill-${events.length}`) => event('fill', order, { executionId: id, quantity: { value, unit: 'share' }, price: { value: '100', currency: 'USD' } });
  return { fixture, result, program, orders, events, event, send, fill, run: () => replayExecution({ program, events }) };
}
const orderState = (result, order) => result.orders.find(value => value.orderId === order.orderId);
const commands = (result, kind, order) => result.commands.filter(value => value.kind === kind && (!order || value.orderId === order.orderId));
const bracket = f => { f.execution.config.protection = [{ instrument: copy(f.portfolio.instruments[0].instrument), stopPrice: { value: '90', currency: 'USD' }, takeProfitPrice: { value: '120', currency: 'USD' } }]; };

test('submission, acknowledgement and partial/final execution replay deterministically and preserve each fact', () => {
  const h = setup(); h.send(h.orders[0]); h.fill('2'); let r = h.run(); assert.equal(r.orders[0].status, 'partially_filled'); assert.equal(r.orders[0].filled, '2'); assert.equal(commands(r, 'submit').length, 0);
  h.fill('3'); r = h.run(); assert.equal(r.status, 'completed'); assert.equal(r.orders[0].filled, '5'); assert.deepEqual(h.run(), r); assert.equal(r.nativeEngineExecuted, false);
});

test('duplicate event and execution IDs are idempotent while conflicting execution facts pause without losing prior fills', () => {
  const h = setup(); h.send(h.orders[0]); const fill = h.fill('2'); h.events.push(copy(fill)); let r = h.run(); assert.equal(r.orders[0].filled, '2');
  h.event('fill', h.orders[0], copy(fill.payload)); r = h.run(); assert.equal(r.orders[0].filled, '2');
  const bad = copy(fill.payload); bad.quantity.value = '3'; h.event('fill', h.orders[0], bad); r = h.run(); assert.equal(r.status, 'paused'); assert.equal(r.error.code, 'EVENT_CONFLICT'); assert.equal(r.orders[0].filled, '2'); assert.deepEqual(r.commands, []);
});

test('a fill arriving before an acknowledgement consumes the old submit outbox instead of sending twice', () => {
  const h = setup(); h.fill('2'); const r = h.run(); assert.equal(r.orders[0].filled, '2'); assert.equal(commands(r, 'submit').length, 0);
});

test('a partial fill during cancellation and a late final fill are retained; fill wins over cancelled status', () => {
  const h = setup(); h.send(h.orders[0]); h.event('cancel_requested', h.orders[0], { requestId: 'cancel-1' }); h.fill('2'); h.event('cancelled', h.orders[0], { requestId: 'cancel-1', filledQuantity: '2' }); let r = h.run(); assert.equal(r.orders[0].status, 'cancelled'); assert.equal(r.orders[0].filled, '2');
  h.fill('3'); r = h.run(); assert.equal(r.orders[0].status, 'filled'); assert.equal(r.orders[0].filled, '5');
});

test('modification preserves partial executions and rejects a fill race beyond the acknowledged new quantity', () => {
  const h = setup(); h.send(h.orders[0]); h.fill('1'); h.event('modify_requested', h.orders[0], { requestId: 'amend-1', quantity: { value: '3', unit: 'share' } }); h.fill('1'); h.event('modified', h.orders[0], { requestId: 'amend-1' }); let r = h.run(); assert.equal(r.orders[0].quantity.value, '3'); assert.equal(r.orders[0].filled, '2');
  const g = setup(); g.send(g.orders[0]); g.event('modify_requested', g.orders[0], { requestId: 'amend-1', quantity: { value: '1', unit: 'share' } }); g.fill('2'); g.event('modified', g.orders[0], { requestId: 'amend-1' }); r = g.run(); assert.equal(r.status, 'paused'); assert.match(r.error.message, /raced with fills/); assert.equal(r.orders[0].filled, '2');
});

test('an amendment cannot increase authorization, violate lot size, or change price currency', () => {
  for (const quantity of ['6', '1.5']) { const h = setup(); h.send(h.orders[0]); h.event('modify_requested', h.orders[0], { requestId: 'amend', quantity: { value: quantity, unit: 'share' } }); assert.equal(h.run().status, 'paused'); }
  const h = setup(f => { f.execution.config.entries = [{ instrument: f.portfolio.instruments[0].instrument, orderType: 'limit', limitPrice: { value: '99', currency: 'USD' } }]; }); h.send(h.orders[0]); h.event('modify_requested', h.orders[0], { requestId: 'amend', quantity: { value: '3', unit: 'share' }, limitPrice: { value: '99', currency: 'EUR' } }); assert.match(h.run().error.message, /currency/);
});

test('unknown submit outcomes reconcile without retry and cannot reference a request that was never issued', () => {
  const h = setup(); h.event('submitted', h.orders[0], { requestId: 'send-1' }); h.event('unknown', h.orders[0], { operation: 'submit', requestId: 'send-1', reason: 'transport timeout' }); let r = h.run(); assert.equal(r.status, 'needs_reconciliation'); assert.deepEqual(r.commands.map(value => value.kind), ['reconcile']);
  h.event('reconciled', h.orders[0], { status: 'not_found', includesClosed: true, fillsComplete: true }); r = h.run(); assert.equal(r.status, 'needs_reconciliation'); assert.deepEqual(r.commands.map(value => value.kind), ['reconcile']);
  const bad = setup(); bad.event('unknown', bad.orders[0], { operation: 'submit', requestId: 'invented', reason: 'timeout' }); assert.equal(bad.run().status, 'paused');
});

test('recovery invalidates the pending outbox and requires a complete authoritative reconciliation, even after a late acknowledgement', () => {
  const h = setup(); const before = h.run(); let r = replayExecution({ program: h.program, checkpoint: before.checkpoint }); assert.deepEqual(r.commands.map(value => value.kind), ['reconcile']); assert.equal(r.status, 'needs_reconciliation');
  h.event('accepted', h.orders[0], { venueOrderId: 'late-venue' }); r = replayExecution({ program: h.program, checkpoint: before.checkpoint, events: h.events }); assert.equal(r.status, 'needs_reconciliation'); assert.equal(commands(r, 'submit').length, 0);
  h.event('reconciled', h.orders[0], { status: 'accepted', venueOrderId: 'late-venue', quantity: { value: '5', unit: 'share' }, fills: [], filledQuantity: '0', includesClosed: true, fillsComplete: true }); r = replayExecution({ program: h.program, checkpoint: before.checkpoint, events: h.events }); assert.equal(r.status, 'working'); assert.equal(commands(r, 'submit').length, 0); assert.equal(commands(r, 'reconcile').length, 0);
});

test('reconciliation accounts for missing executions instead of trusting a terminal status or cumulative number', () => {
  const h = setup(); h.event('submitted', h.orders[0], { requestId: 'send' }); h.event('unknown', h.orders[0], { operation: 'submit', requestId: 'send', reason: 'lost' });
  h.event('reconciled', h.orders[0], { status: 'filled', venueOrderId: 'v', quantity: { value: '5', unit: 'share' }, fills: [{ executionId: 'recovered-fill', quantity: { value: '5', unit: 'share' }, price: { value: '100', currency: 'USD' } }], filledQuantity: '5', includesClosed: true, fillsComplete: true }); const r = h.run(); assert.equal(r.status, 'completed'); assert.equal(r.orders[0].filled, '5');
  h.events.at(-1).payload.fills = []; assert.match(h.run().error.message, /fill evidence/);
});

test('cancel/modify rejections require reconciliation instead of assuming the original order disappeared', () => {
  for (const kind of ['cancel', 'modify']) { const h = setup(); h.send(h.orders[0]); h.event(`${kind}_requested`, h.orders[0], { requestId: 'req', ...(kind === 'modify' ? { quantity: { value: '3', unit: 'share' } } : {}) }); h.event(`${kind}_rejected`, h.orders[0], { requestId: 'req', reason: 'venue changed meanwhile' }); assert.equal(h.run().status, 'needs_reconciliation'); assert.equal(commands(h.run(), 'reconcile').length, 1); }
});

test('protection activates for each actual partial fill, resizes before submission, and blocks additional risk until acknowledged', () => {
  const h = setup(bracket), [parent, stop, take] = h.orders; h.send(parent); h.fill('2'); let r = h.run(); assert.equal(commands(r, 'submit', stop)[0].payload.quantity.value, '2'); assert.equal(commands(r, 'submit', take)[0].payload.quantity.value, '2');
  h.fill('3'); r = h.run(); assert.equal(commands(r, 'submit', stop).length, 1); assert.equal(commands(r, 'submit', stop)[0].payload.quantity.value, '5'); assert.equal(r.orders.filter(order => order.parentOrderId).every(order => order.quantity.value === '5'), true);
});

test('a partial take-profit reduces the sibling stop; flattening cancels remaining protection', () => {
  const h = setup(bracket), [parent, stop, take] = h.orders; h.send(parent); h.fill('5'); h.send(stop); h.send(take); h.fill('2', take); let r = h.run(); assert.equal(commands(r, 'modify', stop)[0].payload.quantity.value, '3');
  h.event('modify_requested', stop, { requestId: 'stop-resize', quantity: { value: '3', unit: 'share' } }); h.event('modified', stop, { requestId: 'stop-resize' }); h.fill('3', take); r = h.run(); assert.equal(commands(r, 'cancel', stop).length, 1);
  h.event('cancel_requested', stop, { requestId: 'stop-cancel' }); h.event('cancelled', stop, { requestId: 'stop-cancel', filledQuantity: '0' }); r = h.run(); assert.equal(r.status, 'completed'); assert.equal(Object.values(r.positions)[0], '0');
});

test('unsent protective amendments coalesce to the latest quantity and disappear when cancellation replaces them', () => {
  const h = setup(bracket), [parent, stop, take] = h.orders; h.send(parent); h.fill('5'); h.send(stop); h.send(take); h.fill('1', take); h.fill('1', take);
  let r = h.run(); assert.equal(commands(r, 'modify', stop).length, 1); assert.equal(commands(r, 'modify', stop)[0].payload.quantity.value, '3');
  h.fill('3', take); r = h.run(); assert.equal(commands(r, 'modify', stop).length, 0); assert.equal(commands(r, 'cancel', stop).length, 1);
});

test('OCO fill races preserve actual overclose facts, halt new risk, and explicitly report reduce-only violations', () => {
  const h = setup(bracket), [parent, stop, take] = h.orders; h.send(parent); h.fill('5'); h.send(stop); h.send(take); h.fill('5', take); h.fill('1', stop); const r = h.run(); assert.equal(r.status, 'needs_reconciliation'); assert.equal(Object.values(r.positions)[0], '-1'); assert.ok(r.breaches.some(value => value.reason === 'protection_race_overclose')); assert.ok(r.breaches.some(value => value.reason === 'venue_reduce_only_violation'));
});

test('rejected protection halts further risk and optionally requests a separately checked emergency reduction', () => {
  const h = setup(f => { bracket(f); f.execution.config.onProtectionFailure = 'flatten'; }), [parent, stop] = h.orders; h.send(parent); h.fill('2'); h.event('submitted', stop, { requestId: 'stop-send' }); h.event('rejected', stop, { reason: 'stop not supported on venue' }); const r = h.run(); assert.equal(r.status, 'needs_reconciliation'); assert.equal(commands(r, 'emergency_reduce', stop)[0].payload.requiresFreshAccountCheck, true);
});

test('sequential entry chunks do not add risk until protection for the previous fill is established', () => {
  const h = setup(f => { bracket(f); f.policy.limits[0].maxOrderQuantity = '2'; }), [parent, stop, take, next] = h.orders; h.send(parent); h.fill('2'); assert.equal(commands(h.run(), 'submit', next).length, 0); h.send(stop); h.send(take); assert.equal(commands(h.run(), 'submit', next).length, 1);
});

test('net reversal closes the old side, waits for explicit zero-position confirmation, then opens the new side', () => {
  const h = setup(f => { f.portfolio.budgetBasis = 'gross_notional'; f.policy.limits[0].allowShort = true; f.events[0].direction = 'short'; f.snapshot.positions = [{ id: 'p', scope: { ...copy(f.scope), instrument: copy(f.portfolio.instruments[0].instrument) }, quantity: { value: '2', unit: 'share' } }]; }), [close, open] = h.orders;
  assert.equal(close.reduceOnly, true); assert.equal(open.reduceOnly, false); h.send(close); h.fill('2', close); let r = h.run(); assert.equal(commands(r, 'submit', open).length, 0); assert.equal(commands(r, 'confirm_position', open).length, 1);
  h.event('position_confirmed', close, { quantity: { value: '0', unit: 'share' } }); r = h.run(); assert.equal(commands(r, 'submit', open).length, 1); assert.equal(commands(r, 'submit', open)[0].payload.quantity.value, '5'); assert.equal(commands(r, 'confirm_position').length, 0);
});

test('a portfolio sells down its old allocation before it releases other-instrument buys', () => {
  const h = setup(f => { f.universe.topN = 2; f.snapshot.positions = [{ id: 'old-a', scope: { ...copy(f.scope), instrument: copy(f.portfolio.instruments[0].instrument) }, quantity: { value: '5', unit: 'share' } }]; }), [reduce, increase] = h.orders;
  assert.equal(reduce.role, 'reduce'); assert.equal(commands(h.run(), 'submit', increase).length, 0); h.send(reduce); h.fill(reduce.quantity.value, reduce); assert.equal(commands(h.run(), 'submit', increase).length, 1);
});

test('mismatched positions, units, ownership and reordered facts fail closed', () => {
  const h = setup(); h.send(h.orders[0]); h.fill('1'); h.event('position_confirmed', h.orders[0], { quantity: { value: '2', unit: 'share' } }); assert.equal(h.run().status, 'needs_reconciliation');
  const g = setup(); g.send(g.orders[0]); g.fill('1').scope.account.accountId = 'another'; assert.match(g.run().error.message, /ownership differs/);
  const j = setup(); j.send(j.orders[0]); j.fill('1').payload.quantity.unit = 'contract'; assert.match(j.run().error.message, /unit differs/);
  const k = setup(); k.send(k.orders[0]); k.events[1].sequence = 0; assert.match(k.run().error.message, /ordering changed/);
});

test('overfills are recorded as violations rather than discarded, including rebate evidence', () => {
  const h = setup(); h.send(h.orders[0]); h.fill('6').payload.commission = { value: '-0.1', currency: 'USD' }; const r = h.run(); assert.equal(r.status, 'needs_reconciliation'); assert.equal(r.orders[0].filled, '6'); assert.ok(r.breaches.some(value => value.reason === 'venue_overfill'));
});

test('expired decisions and imprecise/unimplemented baseline plans cannot become a ready program', () => {
  const h = setup(); const changed = copy(h.result.executionPlan); changed.reasons = [{ reason: 'quantity_arithmetic_exceeds_precision' }]; changed.status = 'requires_backend_planner'; delete changed.digest; changed.digest = digest(changed);
  const program = createExecutionProgram({ decision: h.result.riskDecision, plan: changed, snapshot: h.fixture.snapshot, capabilities: h.fixture.capabilities, asOf: h.fixture.asOf }); assert.equal(program.status, 'blocked'); assert.equal(replayExecution({ program }).status, 'blocked');
  const f = h.fixture; f.executionAt = { basis: 'utc', unixMs: f.asOf.unixMs + 600000 }; const result = evaluatePipeline(f); assert.equal(result.executionProgram.status, 'blocked'); assert.deepEqual(result.executionReplay.commands, []);
});

test('an arbitrary target requirement is not implemented merely because a capability says native', () => {
  const h = setup(), decision = copy(h.result.riskDecision); decision.items[0].requirements = ['trailingStop']; delete decision.digest; decision.digest = digest(decision);
  const plan = copy(h.result.executionPlan); plan.decisionDigest = decision.digest; plan.status = 'requires_backend_planner'; plan.reasons = [{ reason: 'requires_backend_order_planner' }]; delete plan.digest; plan.digest = digest(plan);
  const capabilities = copy(h.fixture.capabilities); capabilities.features.trailingStop = 'native'; assert.throws(() => createExecutionProgram({ decision, plan, snapshot: h.fixture.snapshot, capabilities, asOf: h.fixture.asOf }), /cannot silently claim/);
});
