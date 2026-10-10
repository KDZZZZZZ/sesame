import { Decimal, abs, artifactRef, bounded, check, clone, dec, digest, exactAdd, exactLots, fields, integer, key, measure, min, neg, owned, references, same, scope, sealed, stepMultiple, text, time, uniqueInstruments, utc, verifySeal } from './method-support.js';

const terminal = new Set(['filled', 'cancelled', 'rejected', 'expired']);
const active = order => !terminal.has(order.status) && !['held', 'initialized'].includes(order.status);
const positive = (value, name) => { dec(value, name, true); check(Decimal.compare(value, '0') > 0, `${name} must be positive`); };
const price = value => { if (value !== undefined) { measure(value, 'currency'); positive(value.value, 'order price'); } };
const orderFeature = { market: 'marketOrder', limit: 'limitOrder', stop: 'stopOrder', stop_limit: 'stopLimitOrder' };
function support(capabilities, config, name) {
  const mode = capabilities.features[name];
  check(mode === 'native' || mode === 'software' && (config.allowSoftwareFeatures ?? []).includes(name) && config.emulationEvidence, `Required execution capability ${name} is unsupported or its software implementation was not selected`, 'UNSUPPORTED_CAPABILITY');
  if (mode === 'software') artifactRef(config.emulationEvidence);
  return mode;
}
function definition(value) {
  text(value.orderId); scope(value.scope, true); measure(value.quantity); positive(value.quantity.value, 'order quantity');
  check(['buy', 'sell'].includes(value.side) && Object.hasOwn(orderFeature, value.orderType), 'Unknown order side/type');
  price(value.limitPrice); price(value.stopPrice);
  if (['limit', 'stop_limit'].includes(value.orderType)) check(value.limitPrice, 'Limit orders require a price');
  if (['stop', 'stop_limit'].includes(value.orderType)) check(value.stopPrice, 'Stop orders require a trigger');
  check(typeof value.reduceOnly === 'boolean', 'reduceOnly must be explicit');
  check(['day', 'gtc', 'ioc', 'fok'].includes(value.timeInForce), 'Unsupported order timeInForce');
}

/** Compiles a checked quantity decision to linked order definitions. It never submits them. */
export function createExecutionProgram({ decision, plan, snapshot, capabilities, config = {}, asOf }) {
  verifySeal(decision, 'risk-decision'); verifySeal(plan, 'execution-plan'); owned(plan.scope, decision.scope); check(plan.decisionDigest === decision.digest, 'Execution plan belongs to another risk decision');
  fields(config, ['entries', 'protection', 'allowSoftwareFeatures', 'emulationEvidence', 'onProtectionFailure'], 'execution config'); bounded(config.entries ?? [], 'entry policies'); bounded(config.protection ?? [], 'protection policies'); bounded(config.allowSoftwareFeatures ?? [], 'software capabilities').forEach(text);
  uniqueInstruments(config.entries ?? [], 'entry policy'); uniqueInstruments(config.protection ?? [], 'protection policy');
  if (config.emulationEvidence) artifactRef(config.emulationEvidence);
  check(['halt', 'flatten'].includes(config.onProtectionFailure ?? 'halt'), 'Protection failure policy must be halt or flatten');
  const now = utc(asOf); check(now >= utc(decision.asOf), 'Execution cannot predate its decision');
  artifactRef(capabilities.profile); check(capabilities.profile.kind === 'strategy.target' && same(plan.profile, capabilities.profile), 'Execution requires the planned strategy.target');
  check(same(plan.asOf, asOf) && plan.snapshotId === snapshot.id, 'Execution compilation must use the checked plan time and snapshot');
  const unimplemented = plan.reasons.filter(reason => !['requires_backend_order_planner', 'delta_outside_single_order_limits'].includes(reason.reason));
  if (['blocked', 'needs_reconciliation'].includes(plan.status) || unimplemented.length) return sealed({ schemaVersion: '1.0.0', kind: 'execution-program', status: plan.status === 'needs_reconciliation' ? plan.status : 'blocked', scope: clone(decision.scope), createdAt: clone(asOf), decisionDigest: decision.digest, profile: clone(capabilities.profile), orders: [], initialPositions: [], capabilities: clone(capabilities), policy: clone(config), reasons: clone(plan.reasons), evidence: clone(plan.evidence) });
  support(capabilities, config, 'netPosition');
  const orders = [], initialPositions = [], safety = [];
  for (const position of plan.positions) {
    const item = decision.items.find(row => same(row.instrument, position.instrument)); check(item, 'Execution position has no approved risk item');
    check(item.requirements.every(name => ['netPosition', 'reduceOnly'].includes(name)), 'Target requirements need a backend planner; this compiler cannot silently claim an unimplemented execution semantic', 'UNSUPPORTED_CAPABILITY');
    item.requirements.forEach(name => support(capabilities, config, name));
    const spec = capabilities.instruments.find(row => same(row.instrument, position.instrument)); check(spec && spec.unit === item.quantity.unit, 'Execution quantity metadata differs');
    const current = position.current.value, target = position.target.value; initialPositions.push({ instrument: clone(position.instrument), quantity: clone(position.current) });
    const entry = (config.entries ?? []).find(row => same(row.instrument, position.instrument));
    if (entry) { fields(entry, ['instrument', 'orderType', 'limitPrice', 'stopPrice', 'timeInForce'], 'entry policy'); check(Object.hasOwn(orderFeature, entry.orderType), 'Unknown entry order type'); price(entry.limitPrice); price(entry.stopPrice); }
    const protection = (config.protection ?? []).find(row => same(row.instrument, position.instrument));
    if (protection) { fields(protection, ['instrument', 'stopPrice', 'takeProfitPrice', 'timeInForce'], 'protection policy'); check(protection.stopPrice || protection.takeProfitPrice, 'Protection requires a stop or take-profit price'); price(protection.stopPrice); price(protection.takeProfitPrice); support(capabilities, config, 'modifyOrder'); support(capabilities, config, 'cancelOrder'); support(capabilities, config, 'reduceOnly'); if (protection.stopPrice && protection.takeProfitPrice) support(capabilities, config, 'ocoQuantityReduction'); }
    const reversal = Decimal.compare(current, '0') * Decimal.compare(target, '0') < 0;
    const legs = reversal ? [{ signed: neg(current), reduce: true, afterFlat: false }, { signed: target, reduce: false, afterFlat: true }] : [{ signed: exactAdd(target, neg(current)), reduce: Decimal.compare(abs(target), abs(current)) < 0, afterFlat: false }];
    let previousClose = null;
    for (const [legIndex, leg] of legs.entries()) {
      let remaining = abs(leg.signed); if (Decimal.compare(remaining, '0') === 0) continue;
      check(stepMultiple(remaining, spec.step), 'Order delta does not fit the quantity step');
      const maxOrder = exactLots([item.limit.maxOrderQuantity], ['1'], spec.step); positive(maxOrder, 'maximum order quantity');
      let previousChunk = null, chunk = 0;
      while (Decimal.compare(remaining, '0') > 0) {
        const children = protection && !leg.reduce ? Number(!!protection.stopPrice) + Number(!!protection.takeProfitPrice) : 0;
        check(orders.length + 1 + children <= 1000, 'Execution program exceeds 1000 orders');
        const quantity = min(remaining, maxOrder); check(Decimal.compare(quantity, spec.minimum) >= 0, 'Split-order residual is below the minimum quantity');
        const orderType = leg.reduce ? 'market' : entry?.orderType ?? 'market'; support(capabilities, config, orderFeature[orderType]); if (leg.reduce) support(capabilities, config, 'reduceOnly');
        const orderId = digest([decision.digest, position.instrument, legIndex, chunk++]);
        const order = { orderId, scope: { ...clone(decision.scope), instrument: clone(position.instrument) }, side: Decimal.compare(leg.signed, '0') > 0 ? 'buy' : 'sell', quantity: { value: quantity, unit: spec.unit }, orderType, ...(orderType !== 'market' && entry?.limitPrice ? { limitPrice: clone(entry.limitPrice) } : {}), ...(orderType !== 'market' && entry?.stopPrice ? { stopPrice: clone(entry.stopPrice) } : {}), timeInForce: entry?.timeInForce ?? 'gtc', reduceOnly: leg.reduce, role: leg.reduce ? 'reduce' : 'entry', activation: previousChunk ? { kind: 'after_filled', orderId: previousChunk } : leg.afterFlat ? { kind: 'after_flat', orderId: previousClose } : { kind: 'immediate' }, deadline: clone(leg.reduce ? decision.validUntil : time(Math.min(utc(decision.validUntil), utc(item.newRiskValidUntil)))) };
        definition(order); orders.push(order); previousChunk = orderId; if (leg.reduce) previousClose = orderId;
        if (protection && !leg.reduce) {
          for (const [role, orderType, field] of [['stop_loss', 'stop', 'stopPrice'], ['take_profit', 'limit', 'takeProfitPrice']]) {
            if (!protection[field]) continue; support(capabilities, config, orderFeature[orderType]);
            const child = { orderId: digest([orderId, role]), scope: clone(order.scope), side: order.side === 'buy' ? 'sell' : 'buy', quantity: clone(order.quantity), orderType, ...(orderType === 'stop' ? { stopPrice: clone(protection[field]) } : { limitPrice: clone(protection[field]) }), timeInForce: protection.timeInForce ?? 'gtc', reduceOnly: true, role, parentOrderId: orderId, ocoGroupId: digest([orderId, 'protection']), activation: { kind: 'parent_fill', orderId }, deadline: null };
            definition(child); orders.push(child);
          }
          safety.push({ instrument: clone(position.instrument), parentOrderId: orderId, policy: 'resize_after_each_fill_cancel_when_flat', onFailure: config.onProtectionFailure ?? 'halt', atomic: false, note: 'Child submission/amendment is event driven; the adapter must enforce reduce-only and reconciliation during the protection gap.' });
        }
        remaining = exactAdd(remaining, neg(quantity));
      }
    }
  }
  return sealed({ schemaVersion: '1.0.0', kind: 'execution-program', status: orders.length ? 'ready' : 'noop', scope: clone(decision.scope), createdAt: clone(asOf), decisionDigest: decision.digest, profile: clone(capabilities.profile), orders, initialPositions, capabilities: clone(capabilities), policy: clone(config), safety, reasons: [], evidence: clone(plan.evidence), nativeEngineExecuted: false });
}

function status(order) {
  if (Decimal.compare(order.filled, order.quantity.value) >= 0 && Decimal.compare(order.filled, '0') > 0) return 'filled';
  if (order.terminal) return order.terminal;
  if (order.unknown || order.reconciliationRequired) return 'unknown';
  if (order.pendingCancel) return 'pending_cancel';
  if (order.pendingModify) return 'pending_update';
  if (Decimal.compare(order.filled, '0') > 0) return 'partially_filled';
  if (order.venueOrderId) return 'accepted';
  return order.phase;
}
function updateStatus(order) { order.status = status(order); }
function initialState(program) {
  return { schemaVersion: '1.0.0', kind: 'execution-checkpoint', programDigest: program.digest, scope: clone(program.scope), sequence: -1, availableAt: clone(program.createdAt), orders: Object.fromEntries(program.orders.map(value => [value.orderId, { ...clone(value), authorizedQuantity: value.quantity.value, filled: '0', desiredQuantity: value.quantity.value, phase: value.activation.kind === 'immediate' ? 'initialized' : 'held', status: value.activation.kind === 'immediate' ? 'initialized' : 'held', venueOrderId: null, terminal: null, unknown: false, reconciliationRequired: false, pendingModify: null, pendingCancel: null }])), positions: Object.fromEntries(program.initialPositions.map(value => [key(value.instrument), value.quantity.value])), positionConfirmations: {}, seenEvents: {}, seenExecutions: {}, commands: {}, breaches: [], trace: [], halted: false };
}
function addCommand(state, order, kind, payload = {}) {
  const pending = Object.values(state.commands).find(command => command.orderId === order.orderId && command.kind === kind && command.state === 'planned' && same(command.payload, payload));
  if (pending) return pending.commandId;
  if (['submit', 'modify', 'cancel'].includes(kind)) for (const command of Object.values(state.commands)) {
    if (command.orderId === order.orderId && command.state === 'planned' && (command.kind === kind || ['modify', 'cancel'].includes(kind) && ['modify', 'cancel'].includes(command.kind))) command.state = 'superseded';
  }
  const command = { commandId: digest([state.programDigest, order.orderId, kind, payload, state.sequence]), kind, orderId: order.orderId, scope: clone(order.scope), payload: clone(payload) };
  if (!state.commands[command.commandId]) state.commands[command.commandId] = { ...command, state: 'planned' };
  return command.commandId;
}
function applyFill(state, order, fill, event) {
  fields(fill, ['executionId', 'quantity', 'price', 'commission'], 'fill'); text(fill.executionId); measure(fill.quantity); check(fill.quantity.unit === order.quantity.unit, 'Fill quantity unit differs'); positive(fill.quantity.value, 'fill quantity'); price(fill.price); check(fill.price, 'Fill price is required');
  if (fill.commission) measure(fill.commission, 'currency');
  const fingerprint = digest({ orderId: order.orderId, ...fill }), executionKey = `execution:${fill.executionId}`, old = state.seenExecutions[executionKey];
  if (old) { check(old === fingerprint, 'Execution ID was reused with conflicting fill facts', 'EVENT_CONFLICT'); return; }
  state.seenExecutions[executionKey] = fingerprint; order.filled = exactAdd(order.filled, fill.quantity.value);
  const beforePosition = state.positions[key(order.scope.instrument)] ?? '0';
  state.positions[key(order.scope.instrument)] = exactAdd(beforePosition, order.side === 'buy' ? fill.quantity.value : neg(fill.quantity.value));
  const afterPosition = state.positions[key(order.scope.instrument)];
  if (order.reduceOnly && (Decimal.compare(abs(afterPosition), abs(beforePosition)) > 0 || Decimal.compare(beforePosition, '0') * Decimal.compare(afterPosition, '0') < 0)) { state.breaches.push({ eventId: event.id, orderId: order.orderId, reason: 'venue_reduce_only_violation', before: beforePosition, after: afterPosition }); state.halted = true; }
  order.lastFillSequence = event.sequence;
  if (Decimal.compare(order.filled, order.quantity.value) > 0) { state.breaches.push({ eventId: event.id, orderId: order.orderId, reason: 'venue_overfill', filled: order.filled, authorized: order.quantity.value }); state.halted = true; }
  if (order.parentOrderId) {
    const siblings = Object.values(state.orders).filter(value => value.parentOrderId === order.parentOrderId), closed = siblings.reduce((sum, value) => exactAdd(sum, value.filled), '0');
    if (Decimal.compare(closed, state.orders[order.parentOrderId].filled) > 0) { state.breaches.push({ eventId: event.id, orderId: order.orderId, reason: 'protection_race_overclose', closed, opened: state.orders[order.parentOrderId].filled }); state.halted = true; }
  }
  updateStatus(order);
}
function processEvent(state, program, event) {
  fields(event, ['schemaVersion', 'id', 'sequence', 'type', 'orderId', 'scope', 'occurredAt', 'availableAt', 'payload', 'evidence'], 'execution event');
  check(event.schemaVersion === '1.0.0', 'Unsupported execution event version'); text(event.id); integer(event.sequence, 'execution sequence'); references(event.evidence); owned(event.scope, program.scope); check(utc(event.occurredAt) <= utc(event.availableAt), 'Execution event availability precedes occurrence');
  const fingerprint = digest(event), eventKey = `event:${event.id}`; if (state.seenEvents[eventKey]) { check(state.seenEvents[eventKey] === fingerprint, 'Execution event ID conflict', 'EVENT_CONFLICT'); return; }
  check(event.sequence > state.sequence && utc(event.availableAt) >= utc(state.availableAt), 'Execution event ordering changed');
  const payload = event.payload ?? {};
  if (event.type === 'position_confirmed') {
    scope(event.scope, true); fields(payload, ['quantity'], 'position confirmation'); measure(payload.quantity); const defs = program.orders.filter(value => same(value.scope.instrument, event.scope.instrument)); check(defs.length && defs.every(value => value.quantity.unit === payload.quantity.unit), 'Position confirmation unit/ownership differs');
    const expected = state.positions[key(event.scope.instrument)] ?? '0';
    state.positionConfirmations[key(event.scope.instrument)] = { sequence: event.sequence, quantity: payload.quantity.value, evidence: clone(event.evidence) };
    for (const command of Object.values(state.commands)) if (command.kind === 'confirm_position' && same(command.scope.instrument, event.scope.instrument) && command.state === 'planned') command.state = 'observed';
    if (Decimal.compare(expected, payload.quantity.value) !== 0) { state.breaches.push({ eventId: event.id, reason: 'position_mismatch', expected, observed: payload.quantity.value }); state.halted = true; }
  } else {
    const order = Object.hasOwn(state.orders, event.orderId) ? state.orders[event.orderId] : null; check(order, 'Execution event references an unknown client order'); check(same(order.scope, event.scope), 'Execution event account, run or instrument differs');
    const markCommand = kind => { for (const command of Object.values(state.commands)) if (command.orderId === order.orderId && command.kind === kind && ['planned', 'uncertain'].includes(command.state)) command.state = 'observed'; };
    if (event.type === 'submitted') { fields(payload, ['requestId'], 'submission'); text(payload.requestId); check(['prepared', 'initialized'].includes(order.phase) && !order.terminal && !order.unknown, 'Order was already sent, held or unresolved'); order.phase = 'submitted'; order.submitRequestId = payload.requestId; markCommand('submit'); }
    else if (event.type === 'accepted') { fields(payload, ['venueOrderId'], 'acceptance'); text(payload.venueOrderId); check(order.phase === 'submitted' || order.unknown || order.reconciliationRequired || Decimal.compare(order.filled, '0') > 0, 'Acknowledgement has no submitted request'); if (order.venueOrderId) check(order.venueOrderId === payload.venueOrderId, 'Venue order identity changed'); order.venueOrderId = payload.venueOrderId; order.phase = 'submitted'; order.unknown = false; markCommand('submit'); }
    else if (event.type === 'fill') { check(!['held', 'initialized'].includes(order.phase), 'Fill has no submission or recovery evidence'); applyFill(state, order, payload, event); order.phase = 'submitted'; markCommand('submit'); }
    else if (event.type === 'modify_requested') {
      fields(payload, ['requestId', 'quantity', 'limitPrice', 'stopPrice'], 'modify request'); text(payload.requestId); support(program.capabilities, program.policy, 'modifyOrder'); check(active(order) && !order.unknown && !order.reconciliationRequired && !order.pendingModify && !order.pendingCancel && !order.terminal, 'Order cannot accept this modification'); measure(payload.quantity); check(payload.quantity.unit === order.quantity.unit && Decimal.compare(payload.quantity.value, order.filled) >= 0 && Decimal.compare(payload.quantity.value, order.authorizedQuantity) <= 0, 'Modification exceeds authorization or drops recorded fills'); positive(payload.quantity.value, 'modified quantity'); const spec = program.capabilities.instruments.find(row => same(row.instrument, order.scope.instrument)); check(stepMultiple(payload.quantity.value, spec.step) && Decimal.compare(payload.quantity.value, spec.minimum) >= 0, 'Modification violates order quantity step/minimum'); price(payload.limitPrice); price(payload.stopPrice); if (payload.limitPrice) check(order.limitPrice && payload.limitPrice.currency === order.limitPrice.currency, 'Limit amendment changes order type or currency'); if (payload.stopPrice) check(order.stopPrice && payload.stopPrice.currency === order.stopPrice.currency, 'Stop amendment changes order type or currency'); order.pendingModify = clone(payload); markCommand('modify');
    } else if (event.type === 'modified') {
      fields(payload, ['requestId'], 'modify acknowledgement'); check(order.pendingModify?.requestId === payload.requestId, 'Modification acknowledgement does not match its request');
      check(Decimal.compare(order.pendingModify.quantity.value, order.filled) >= 0, 'Modification raced with fills beyond its new quantity; reconcile venue state');
      order.quantity = clone(order.pendingModify.quantity); if (order.pendingModify.limitPrice) order.limitPrice = clone(order.pendingModify.limitPrice); if (order.pendingModify.stopPrice) order.stopPrice = clone(order.pendingModify.stopPrice); order.pendingModify = null; order.unknown = false;
    } else if (event.type === 'modify_rejected') { fields(payload, ['requestId', 'reason'], 'modify rejection'); check(order.pendingModify?.requestId === payload.requestId, 'Unknown modify rejection'); text(payload.reason); order.pendingModify = null; order.unknown = false; order.reconciliationRequired = true; }
    else if (event.type === 'cancel_requested') { fields(payload, ['requestId'], 'cancel request'); text(payload.requestId); support(program.capabilities, program.policy, 'cancelOrder'); check(active(order) && !order.unknown && !order.reconciliationRequired && !order.pendingCancel, 'Order cannot accept this cancellation'); order.pendingCancel = payload.requestId; markCommand('cancel'); }
    else if (event.type === 'cancelled') { fields(payload, ['requestId', 'filledQuantity'], 'cancellation'); if (payload.requestId !== undefined) check(order.pendingCancel === payload.requestId, 'Cancellation acknowledgement does not match'); if (payload.filledQuantity !== undefined) { dec(payload.filledQuantity, 'cancelled filled quantity', true); check(Decimal.compare(payload.filledQuantity, order.filled) === 0, 'Cancellation fill count requires missing execution evidence'); } order.terminal = 'cancelled'; order.pendingCancel = null; order.unknown = false; }
    else if (event.type === 'cancel_rejected') { fields(payload, ['requestId', 'reason'], 'cancel rejection'); check(order.pendingCancel === payload.requestId, 'Unknown cancellation rejection'); text(payload.reason); order.pendingCancel = null; order.reconciliationRequired = true; }
    else if (['rejected', 'expired'].includes(event.type)) { fields(payload, ['reason'], 'terminal event'); text(payload.reason); order.terminal = event.type; order.unknown = false; }
    else if (event.type === 'unknown') { fields(payload, ['operation', 'requestId', 'reason'], 'unknown outcome'); check(['submit', 'modify', 'cancel'].includes(payload.operation), 'Unknown operation kind'); text(payload.requestId); text(payload.reason); const expected = payload.operation === 'submit' ? order.submitRequestId : payload.operation === 'modify' ? order.pendingModify?.requestId : order.pendingCancel; check(expected === payload.requestId, 'Unknown outcome does not match an issued request'); if (!terminal.has(order.status)) order.unknown = true; }
    else if (event.type === 'reconciled') {
      fields(payload, ['status', 'venueOrderId', 'quantity', 'fills', 'filledQuantity', 'includesClosed', 'fillsComplete'], 'reconciliation'); check(['not_found', 'accepted', 'partially_filled', 'filled', 'cancelled', 'expired', 'rejected'].includes(payload.status), 'Unknown reconciliation status');
      if (payload.status === 'not_found' || payload.includesClosed !== true || payload.fillsComplete !== true) { order.unknown = true; order.reconciliationRequired = true; }
      else {
        measure(payload.quantity); check(payload.quantity.unit === order.quantity.unit, 'Reconciled quantity unit differs'); positive(payload.quantity.value, 'reconciled quantity'); bounded(payload.fills, 'reconciled fills').forEach(fill => applyFill(state, order, fill, event)); dec(payload.filledQuantity, 'reconciled filled quantity', true); check(Decimal.compare(payload.filledQuantity, order.filled) === 0, 'Reconciliation is missing or contradicts fill evidence');
        if (payload.venueOrderId) { text(payload.venueOrderId); if (order.venueOrderId) check(order.venueOrderId === payload.venueOrderId, 'Reconciliation changed venue identity'); order.venueOrderId = payload.venueOrderId; }
        order.quantity = clone(payload.quantity); order.phase = 'submitted'; order.terminal = terminal.has(payload.status) ? payload.status : null; order.unknown = false; order.reconciliationRequired = false; order.pendingCancel = null; order.pendingModify = null;
        check(payload.status !== 'filled' || Decimal.compare(order.filled, order.quantity.value) === 0, 'A filled status needs all executions');
        if (Decimal.compare(order.quantity.value, order.authorizedQuantity) > 0) { state.breaches.push({ eventId: event.id, orderId: order.orderId, reason: 'reconciled_quantity_exceeds_authorization' }); state.halted = true; }
      }
      markCommand('reconcile'); if (!order.unknown && !order.reconciliationRequired) { markCommand('submit'); markCommand('modify'); markCommand('cancel'); }
    } else throw new Error(`Unknown execution event type: ${event.type}`);
    updateStatus(order);
  }
  state.sequence = event.sequence; state.availableAt = clone(event.availableAt); state.seenEvents[eventKey] = fingerprint;
  state.trace.push({ eventId: event.id, sequence: event.sequence, type: event.type, ...(event.orderId ? { orderId: event.orderId, status: state.orders[event.orderId].status, filled: state.orders[event.orderId].filled } : {}), positions: clone(state.positions) });
}
function supersede(state, order, kinds) { for (const command of Object.values(state.commands)) if (command.orderId === order.orderId && kinds.includes(command.kind) && command.state === 'planned') command.state = 'superseded'; }
function protectionReady(state) {
  for (const parent of Object.values(state.orders).filter(order => !order.parentOrderId && Decimal.compare(order.filled, '0') > 0)) {
    const children = Object.values(state.orders).filter(order => order.parentOrderId === parent.orderId); if (!children.length) continue;
    const remaining = exactAdd(parent.filled, neg(children.reduce((sum, order) => exactAdd(sum, order.filled), '0'))); if (Decimal.compare(remaining, '0') <= 0) continue;
    if (children.some(order => !order.venueOrderId || terminal.has(order.status) || order.unknown || order.reconciliationRequired || order.pendingModify || order.pendingCancel || Decimal.compare(exactAdd(order.quantity.value, neg(order.filled)), remaining) !== 0)) return false;
  }
  return true;
}
function newRiskReady(state) { return !state.halted && !Object.values(state.orders).some(order => order.unknown || order.reconciliationRequired || order.role === 'reduce' && order.status !== 'filled') && protectionReady(state); }
function schedule(state, program) {
  const now = utc(state.availableAt);
  for (const order of Object.values(state.orders)) {
    if (order.unknown || order.reconciliationRequired) { supersede(state, order, ['submit', 'modify', 'cancel']); addCommand(state, order, 'reconcile', { reason: 'unresolved_outcome', venueOrderId: order.venueOrderId }); continue; }
    if (order.parentOrderId) {
      const parent = state.orders[order.parentOrderId], siblings = Object.values(state.orders).filter(value => value.parentOrderId === parent.orderId), closed = siblings.reduce((sum, value) => exactAdd(sum, value.filled), '0');
      const remaining = Decimal.compare(parent.filled, closed) > 0 ? exactAdd(parent.filled, neg(closed)) : '0';
      order.desiredQuantity = exactAdd(order.filled, remaining);
      for (const command of Object.values(state.commands)) if (command.orderId === order.orderId && command.kind === 'modify' && command.state === 'planned' && Decimal.compare(command.payload.quantity.value, order.desiredQuantity) !== 0) command.state = 'superseded';
      if (Decimal.compare(remaining, '0') === 0) {
        if (order.phase === 'prepared') { supersede(state, order, ['submit']); order.phase = 'held'; updateStatus(order); }
        if (active(order) && !order.pendingCancel) addCommand(state, order, 'cancel', { reason: 'protection_position_flat' }); else if (order.phase === 'held' && terminal.has(parent.status)) { order.terminal = 'cancelled'; updateStatus(order); } continue;
      }
      if (terminal.has(order.status)) {
        if (!state.breaches.some(value => value.orderId === order.orderId && value.reason === 'protection_unavailable')) state.breaches.push({ orderId: order.orderId, reason: 'protection_unavailable', remaining }); state.halted = true;
        if ((program.policy.onProtectionFailure ?? 'halt') === 'flatten') addCommand(state, order, 'emergency_reduce', { quantity: { value: remaining, unit: order.quantity.unit }, reason: 'protection_failure', requiresFreshAccountCheck: true });
        continue;
      }
      if (order.phase === 'held') { order.phase = 'initialized'; order.quantity.value = order.desiredQuantity; updateStatus(order); }
      else if (order.phase === 'prepared' && Decimal.compare(order.quantity.value, order.desiredQuantity) !== 0) { supersede(state, order, ['submit']); order.phase = 'initialized'; order.quantity.value = order.desiredQuantity; updateStatus(order); }
      else if (order.venueOrderId && !order.pendingModify && !order.pendingCancel && Decimal.compare(order.quantity.value, order.desiredQuantity) !== 0) addCommand(state, order, 'modify', { quantity: { value: order.desiredQuantity, unit: order.quantity.unit }, ...(order.limitPrice ? { limitPrice: order.limitPrice } : {}), ...(order.stopPrice ? { stopPrice: order.stopPrice } : {}), reason: 'synchronize_protected_quantity' });
    } else if (order.phase === 'held') {
      const prior = state.orders[order.activation.orderId];
      if (prior?.status === 'filled') {
        if (order.activation.kind === 'after_flat') { const confirmation = state.positionConfirmations[key(order.scope.instrument)]; if (!confirmation || confirmation.sequence <= prior.lastFillSequence || Decimal.compare(confirmation.quantity, '0') !== 0) { addCommand(state, order, 'confirm_position', { requiredQuantity: { value: '0', unit: order.quantity.unit }, afterOrderId: prior.orderId }); continue; } }
        order.phase = 'initialized'; updateStatus(order);
      } else if (prior && ['cancelled', 'rejected', 'expired'].includes(prior.status)) { order.terminal = 'cancelled'; updateStatus(order); }
    }
    if (order.phase === 'initialized' && !order.terminal) {
      if (order.deadline && now >= utc(order.deadline)) { order.terminal = 'expired'; updateStatus(order); continue; }
      if (!order.reduceOnly && !newRiskReady(state)) continue;
      const commandId = addCommand(state, order, 'submit', { side: order.side, quantity: clone(order.quantity), orderType: order.orderType, ...(order.limitPrice ? { limitPrice: order.limitPrice } : {}), ...(order.stopPrice ? { stopPrice: order.stopPrice } : {}), timeInForce: order.timeInForce, reduceOnly: order.reduceOnly, parentOrderId: order.parentOrderId ?? null, ocoGroupId: order.ocoGroupId ?? null });
      order.phase = 'prepared'; order.submitCommandId = commandId; updateStatus(order);
    }
  }
}

/** Fixed fact replay, with a sealed checkpoint suitable for a target-owned durable ledger. */
export function replayExecution({ program, events = [], checkpoint }) {
  verifySeal(program, 'execution-program'); bounded(events, 'execution events', 0, 20000);
  let state = checkpoint ? clone(verifySeal(checkpoint, 'execution-checkpoint')) : initialState(program); delete state.digest;
  check(state.programDigest === program.digest && same(state.scope, program.scope), 'Checkpoint belongs to another program, account or run');
  if (checkpoint) for (const order of Object.values(state.orders)) if (active(order)) {
    order.reconciliationRequired = true; updateStatus(order);
    for (const command of Object.values(state.commands)) if (command.orderId === order.orderId && ['submit', 'modify', 'cancel'].includes(command.kind) && command.state === 'planned') command.state = 'uncertain';
  }
  schedule(state, program); let error;
  for (const event of events) {
    const next = clone(state);
    try { processEvent(next, program, event); schedule(next, program); state = next; }
    catch (failure) { error = { eventId: event.id ?? null, sequence: event.sequence ?? null, message: failure.message, code: failure.code ?? 'INVALID_EXECUTION_EVENT' }; break; }
  }
  const orders = Object.values(state.orders), unresolved = orders.some(order => order.unknown || order.reconciliationRequired);
  const commands = Object.values(state.commands).filter(command => {
    if (command.state !== 'planned' || error) return false;
    const order = state.orders[command.orderId];
    if (['submit', 'modify', 'cancel'].includes(command.kind) && (order.unknown || order.reconciliationRequired || terminal.has(order.status))) return false;
    if (command.kind === 'submit' && (order.phase !== 'prepared' || order.deadline && utc(state.availableAt) >= utc(order.deadline) || !order.reduceOnly && !newRiskReady(state))) return false;
    return true;
  }).map(clone);
  const result = { schemaVersion: '1.0.0', kind: 'execution-replay', status: error ? 'paused' : ['blocked', 'needs_reconciliation'].includes(program.status) ? program.status : state.halted || unresolved ? 'needs_reconciliation' : orders.every(order => terminal.has(order.status)) ? 'completed' : 'working', programDigest: program.digest, scope: clone(program.scope), orders: clone(orders), positions: clone(state.positions), commands, trace: clone(state.trace), breaches: clone(state.breaches), ...(error ? { error } : {}), checkpoint: sealed(state), validationScope: 'fixed-event-execution-state-machine', nativeEngineExecuted: false };
  return sealed(result);
}
