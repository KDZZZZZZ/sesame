import { Decimal } from '@sesame/plugin-sdk/decimal';
import { artifactRef, canonical, check, clone, decimal, digest, object, text } from '@sesame/plugin-sdk/protocol';

// A deterministic reference contract, not a broker adapter or portfolio optimizer.
// All clocks, account observations and model outputs are supplied by the caller.
export const PIPELINE_VERSION = '1.0.0';
const MAX_ITEMS = 10000;
const allowed = (value, keys, path) => {
  object(value, path);
  check(Object.keys(value).every(key => keys.includes(key)), `${path}: unknown field ${Object.keys(value).find(key => !keys.includes(key))}`);
};
const list = (value, path, nonempty = false) => {
  check(Array.isArray(value) && value.length <= MAX_ITEMS && (!nonempty || value.length > 0), `${path} must be a bounded${nonempty ? ' nonempty' : ''} array`);
  return value;
};
const integer = (value, path, min = 0) => check(Number.isSafeInteger(value) && value >= min, `${path} must be a safe integer >= ${min}`);
const same = (a, b) => canonical(a) === canonical(b);
const exact = (value, path) => { decimal(value, path); check(value.length <= 128 && value.replace(/[-.]/g, '').replace(/^0+/, '').length <= 34, `${path} exceeds Decimal34 precision`); return value; };
const nonnegative = (value, path) => { exact(value, path); check(Decimal.compare(value, '0') >= 0, `${path} must be nonnegative`); return value; };
const minimum = (a, b) => Decimal.compare(a, b) <= 0 ? a : b;
const ref = value => { artifactRef(value); return value; };
const hash = (value, path) => check(/^sha256:[a-f0-9]{64}$/.test(value), `${path} must be an exact sha256 digest`);
const decimalParts = input => { const [whole, fraction = ''] = input.split('.'); return { n: BigInt(whole + fraction), scale: fraction.length }; };
// Quantize uses Decimal34 rounding. A second quantize is not a proof of divisibility
// when an exceptionally small step makes the intermediate result exceed 34 digits.
function exactStepMultiple(value, step) {
  const a = decimalParts(value), b = decimalParts(step), scale = Math.max(a.scale, b.scale);
  return (a.n * 10n ** BigInt(scale - a.scale)) % (b.n * 10n ** BigInt(scale - b.scale)) === 0n;
}
function exactSumEquals(values, expected) {
  const rows = values.map(decimalParts), total = decimalParts(expected), scale = Math.max(total.scale, ...rows.map(row => row.scale));
  return rows.reduce((sum, row) => sum + row.n * 10n ** BigInt(scale - row.scale), 0n) === total.n * 10n ** BigInt(scale - total.scale);
}

function time(value, path = 'time') {
  allowed(value, ['basis', 'unixMs'], path);
  check(value.basis === 'utc', `${path} needs resolved UTC; wall clocks require an evidenced mapping first`);
  integer(value.unixMs, `${path}.unixMs`);
  return value.unixMs;
}
const utc = unixMs => ({ basis: 'utc', unixMs });
function instrument(value) {
  allowed(value, ['sourceId', 'instrumentId'], 'instrument'); text(value.sourceId); text(value.instrumentId); return value;
}
function scope(value, withInstrument = false) {
  allowed(value, ['strategyId', 'runId', 'account', ...(withInstrument ? ['instrument'] : [])], 'scope');
  text(value.strategyId); text(value.runId);
  allowed(value.account, ['connectionId', 'accountId'], 'account'); text(value.account.connectionId); text(value.account.accountId);
  if (withInstrument) instrument(value.instrument);
  return value;
}
const portfolioScope = value => ({ strategyId: value.strategyId, runId: value.runId, account: value.account });
const scoped = (a, b) => same(portfolioScope(a), portfolioScope(b));
function measure(value, path = 'quantity') {
  allowed(value, ['value', 'unit'], path); exact(value.value, `${path}.value`); text(value.unit, `${path}.unit`); return value;
}
function refs(values, path, nonempty = false) { list(values, path, nonempty).forEach(ref); }
function signalRef(value) {
  allowed(value, ['id', 'revision'], 'signal reference'); text(value.id); integer(value.revision, 'signal revision', 1); return value;
}
const signalIdentity = value => ({ id: value.id, revision: value.revision });
function source(value) {
  allowed(value, ['kind', 'id', 'version', 'configurationDigest', 'model'], 'source');
  check(['agent', 'algorithm', 'human'].includes(value.kind), 'Unknown signal/risk source kind');
  text(value.id); text(value.version); hash(value.configurationDigest, 'source.configurationDigest');
  if (value.kind === 'agent') {
    allowed(value.model, ['provider', 'id', 'version', 'promptDigest'], 'source.model');
    text(value.model.provider); text(value.model.id); text(value.model.version); hash(value.model.promptDigest, 'source.model.promptDigest');
  } else check(value.model === undefined, 'Only an Agent source can carry model metadata');
}
function observations(value, cutoff, generated) {
  check(time(cutoff, 'dataCutoffAt') <= generated, 'Data cutoff is later than generation');
  list(value, 'inputs', true).forEach(input => {
    allowed(input, ['ref', 'availableAt'], 'input'); ref(input.ref);
    check(time(input.availableAt, 'input.availableAt') <= time(cutoff), 'Input evidence was not available at the declared data cutoff');
  });
}

/** Immutable signal/withdrawal events. revision is monotonic within a source channel. */
export function validateSignalEvent(event) {
  allowed(event, ['schemaVersion', 'id', 'sequence', 'revision', 'channel', 'kind', 'scope', 'source', 'occurredAt', 'generatedAt', 'availableAt', 'expiresAt', 'dataCutoffAt', 'inputs', 'direction', 'confidence', 'supersedes', 'reason'], 'signal event');
  check(event.schemaVersion === PIPELINE_VERSION, 'Unsupported pipeline version');
  text(event.id); integer(event.sequence, 'sequence'); integer(event.revision, 'revision', 1); text(event.channel);
  scope(event.scope, true); source(event.source);
  check(['signal', 'withdrawal'].includes(event.kind), 'Unknown signal event kind');
  const occurred = time(event.occurredAt), generated = time(event.generatedAt), available = time(event.availableAt);
  check(occurred <= generated && generated <= available, 'Signal occurrence, generation and availability are out of order');
  observations(event.inputs, event.dataCutoffAt, generated);
  if (event.supersedes !== undefined) { signalRef(event.supersedes); check(event.supersedes.id !== event.id && event.supersedes.revision < event.revision, 'A replacement must reference an older immutable signal'); }
  if (event.kind === 'signal') {
    check(time(event.expiresAt) > occurred, 'Signal expiry must follow the event it describes');
    check(['long', 'short', 'flat'].includes(event.direction), 'Signal direction is long, short or flat');
    if (event.confidence !== undefined) { nonnegative(event.confidence, 'confidence'); check(Decimal.compare(event.confidence, '1') <= 0, 'Confidence exceeds one'); }
  } else {
    check(event.supersedes !== undefined, 'A withdrawal must identify the signal it withdraws'); text(event.reason);
    check(event.expiresAt === undefined && event.direction === undefined && event.confidence === undefined, 'Withdrawal events cannot carry a new prediction');
  }
  return clone(event);
}

function validateGuard(guard) {
  allowed(guard, ['id', 'scope', 'issuedAt', 'blockedUntil', 'retiredSignals', 'reason', 'evidence'], 'reentry guard');
  text(guard.id); scope(guard.scope, true); text(guard.reason);
  check(time(guard.blockedUntil) >= time(guard.issuedAt), 'Cooldown cannot precede its risk decision');
  list(guard.retiredSignals, 'retiredSignals').forEach(signalRef); refs(guard.evidence, 'guard evidence', true);
}

/** Replays the recorded availability order, including late/stale results, without a model call. */
export function replaySignals(events, { asOf, scope: requestedScope, guards = [] }) {
  const now = time(asOf); scope(requestedScope); list(events, 'events'); list(guards, 'guards'); guards.forEach(guard => { validateGuard(guard); check(scoped(guard.scope, requestedScope), 'Risk guard belongs to another account, strategy or run'); });
  const seen = new Map(), revisions = new Set(), latest = new Map(), history = [], inactive = [];
  let lastSequence = -1, lastAvailable = -1;
  for (const raw of events) {
    const event = validateSignalEvent(raw), bytes = canonical(event);
    check(scoped(event.scope, requestedScope), 'Signal belongs to a different account, strategy or run');
    if (seen.has(event.id)) { check(seen.get(event.id) === bytes, 'Signal ID was reused with different content', 'EVENT_CONFLICT'); continue; }
    check(event.sequence > lastSequence && time(event.availableAt) >= lastAvailable, 'Signal timeline must retain increasing sequence and nondecreasing availability');
    seen.set(event.id, bytes); lastSequence = event.sequence; lastAvailable = time(event.availableAt);
    if (lastAvailable > now) continue;
    history.push(event);
    const key = canonical([event.scope, event.source.kind, event.source.id, event.channel]), previous = latest.get(key), revisionKey = canonical([key, event.revision]);
    check(!revisions.has(revisionKey), 'A channel revision was reused', 'EVENT_CONFLICT'); revisions.add(revisionKey);
    if (previous && event.revision <= previous.revision) {
      check(event.revision !== previous.revision, 'A channel revision was reused', 'EVENT_CONFLICT');
      inactive.push({ signal: signalIdentity(event), reason: 'late_revision' }); continue;
    }
    if (previous) {
      check(event.supersedes && same(event.supersedes, signalIdentity(previous)), 'New channel revision must explicitly supersede the previous observed revision');
      check(time(event.generatedAt) >= time(previous.generatedAt), 'A new revision cannot predate the result it replaces');
      inactive.push({ signal: signalIdentity(previous), reason: event.kind === 'withdrawal' ? 'withdrawn' : 'superseded' });
    } else check(event.kind !== 'withdrawal' && event.supersedes === undefined, 'Signal timeline is missing its superseded history');
    latest.set(key, event);
  }
  const active = [];
  for (const event of latest.values()) {
    if (event.kind === 'withdrawal') continue;
    let reason = time(event.expiresAt) <= now ? 'expired' : null;
    const applicable = guards.filter(guard => same(guard.scope, event.scope) && time(guard.issuedAt) <= now);
    if (applicable.some(guard => time(event.generatedAt) <= time(guard.issuedAt) || guard.retiredSignals.some(retired => same(retired, signalIdentity(event))))) reason = 'risk_retired';
    else if (applicable.some(guard => now < time(guard.blockedUntil))) reason = 'risk_cooldown';
    if (reason) inactive.push({ signal: signalIdentity(event), reason }); else active.push(event);
  }
  const result = { schemaVersion: PIPELINE_VERSION, scope: clone(requestedScope), asOf: clone(asOf), active, inactive, history, guards: clone(guards) };
  return { ...result, digest: digest(result) };
}

/** Quantity targets may cover multiple instruments; sizing and currency conversion are upstream. */
export function validatePortfolioTarget(target, signalState) {
  allowed(target, ['schemaVersion', 'id', 'scope', 'createdAt', 'validUntil', 'strategySource', 'evidence', 'items'], 'portfolio target');
  check(target.schemaVersion === PIPELINE_VERSION, 'Unsupported pipeline version'); text(target.id); scope(target.scope);
  check(scoped(target.scope, signalState.scope), 'Target and signals have different ownership');
  check(time(target.createdAt) === time(signalState.asOf), 'Construct targets against a signal view at the same decision time');
  check(time(target.validUntil) > time(target.createdAt), 'Target must have a positive validity interval');
  ref(target.strategySource); check(target.strategySource.kind === 'strategy.source', 'An exact strategy.source is required'); refs(target.evidence, 'target evidence', true);
  const seen = new Set();
  for (const item of list(target.items, 'target items', true)) {
    allowed(item, ['instrument', 'quantity', 'purpose', 'signalRefs', 'stateMachineEvidence', 'requirements'], 'target item');
    instrument(item.instrument); measure(item.quantity); const key = canonical(item.instrument);
    check(!seen.has(key), 'Duplicate instrument target'); seen.add(key);
    check(['allocate', 'exit'].includes(item.purpose), 'Target purpose must be allocate or exit');
    list(item.signalRefs, 'signalRefs').forEach(signalRef); list(item.requirements, 'requirements').forEach(text);
    check(new Set(item.signalRefs.map(canonical)).size === item.signalRefs.length, 'Repeated signal reference');
    if (item.stateMachineEvidence !== undefined) {
      allowed(item.stateMachineEvidence, ['ref', 'evaluatedAt', 'availableAt'], 'state-machine evidence'); ref(item.stateMachineEvidence.ref);
      check(time(item.stateMachineEvidence.evaluatedAt) <= time(item.stateMachineEvidence.availableAt) && time(item.stateMachineEvidence.availableAt) <= time(target.createdAt), 'State-machine evidence was not available at the target decision time');
    }
    for (const selected of item.signalRefs) check(signalState.history.some(signal => same(signalIdentity(signal), selected) && same(signal.scope.instrument, item.instrument)), 'Target has no recorded signal evidence for this instrument');
    if (item.purpose === 'exit') check(Decimal.compare(item.quantity.value, '0') === 0, 'An exit target must be flat');
    else {
      check(item.signalRefs.length > 0 || item.stateMachineEvidence, 'Allocation needs active signals or fixed classic-state-machine evidence');
      for (const selected of item.signalRefs) {
        const signal = signalState.active.find(value => same(signalIdentity(value), selected));
        check(signal && same(signal.scope.instrument, item.instrument), 'Target references an inactive or different-instrument signal');
        check(time(target.validUntil) <= time(signal.expiresAt), 'Target validity cannot outlive an allocation signal');
      }
    }
  }
  return clone(target);
}

function validatePolicy(policy, target, now) {
  allowed(policy, ['id', 'scope', 'evidence', 'validFrom', 'validUntil', 'maxSignalAgeMs', 'maxDataAgeMs', 'cooldownMs', 'requiredRiskSources', 'limits'], 'hard risk policy');
  text(policy.id); scope(policy.scope); check(scoped(policy.scope, target.scope), 'Risk policy ownership differs'); ref(policy.evidence);
  check(time(policy.validFrom) <= now && now < time(policy.validUntil), 'Hard risk policy is not active');
  integer(policy.maxSignalAgeMs, 'maxSignalAgeMs'); integer(policy.maxDataAgeMs, 'maxDataAgeMs'); integer(policy.cooldownMs, 'cooldownMs');
  const required = policy.requiredRiskSources ?? [];
  list(required, 'requiredRiskSources').forEach(value => { allowed(value, ['kind', 'id', 'version'], 'required risk source'); check(['agent', 'algorithm', 'human'].includes(value.kind), 'Unknown required risk source kind'); text(value.id); text(value.version); });
  check(new Set(required.map(canonical)).size === required.length, 'Duplicate required risk source');
  const seen = new Set();
  for (const limit of list(policy.limits, 'limits', true)) {
    allowed(limit, ['instrument', 'unit', 'maxAbsPosition', 'maxOrderQuantity', 'allowShort', 'maxSnapshotAgeMs'], 'hard limit');
    instrument(limit.instrument); text(limit.unit); nonnegative(limit.maxAbsPosition, 'maxAbsPosition'); nonnegative(limit.maxOrderQuantity, 'maxOrderQuantity');
    check(typeof limit.allowShort === 'boolean', 'allowShort must be explicit'); integer(limit.maxSnapshotAgeMs, 'maxSnapshotAgeMs');
    const key = canonical(limit.instrument); check(!seen.has(key), 'Duplicate hard risk instrument'); seen.add(key);
  }
}
function validateAdvice(advice) {
  allowed(advice, ['id', 'scope', 'source', 'generatedAt', 'availableAt', 'expiresAt', 'dataCutoffAt', 'inputs', 'action', 'cap', 'reason', 'evidence'], 'risk advice');
  text(advice.id); scope(advice.scope, true); source(advice.source); text(advice.reason); refs(advice.evidence, 'risk advice evidence', true);
  const generated = time(advice.generatedAt), available = time(advice.availableAt);
  check(generated <= available && generated < time(advice.expiresAt), 'Invalid risk advice lifetime'); observations(advice.inputs, advice.dataCutoffAt, generated);
  check(['allow', 'cap', 'halt', 'flatten'].includes(advice.action), 'Risk advice can only allow within policy, cap, halt new risk, or flatten');
  if (advice.action === 'cap') { measure(advice.cap); nonnegative(advice.cap.value, 'risk cap'); }
  else check(advice.cap === undefined, 'Only a cap advice carries a quantity cap');
}

/** Agents may tighten a fixed policy. They cannot edit/replace its authority or enable permissions. */
export function assessRisk({ target, signals, policy, advice = [] }) {
  target = validatePortfolioTarget(target, signals); const now = time(target.createdAt); validatePolicy(policy, target, now);
  list(advice, 'risk advice'); advice.forEach(validateAdvice);
  check(new Set(advice.map(value => value.id)).size === advice.length, 'Repeated risk advice identity');
  advice.forEach(value => check(scoped(value.scope, target.scope), 'Risk advice belongs to another account, strategy or run'));
  const guards = [], items = [], ignoredAdvice = [];
  for (const value of advice) if (time(value.availableAt) > now || time(value.expiresAt) <= now) ignoredAdvice.push({ id: value.id, reason: time(value.availableAt) > now ? 'not_available' : 'expired' });
  for (const item of target.items) {
    const limit = policy.limits.find(value => same(value.instrument, item.instrument)); check(limit, 'Missing explicit hard limit for target instrument');
    check(limit.unit === item.quantity.unit, 'Target and risk quantity units differ');
    let cap = limit.maxAbsPosition, mode = 'allow'; const reasons = [], evidence = [policy.evidence], newRiskValidity = [time(target.validUntil), time(policy.validUntil)];
    if (signals.guards.some(guard => same(guard.scope.instrument, item.instrument) && time(guard.issuedAt) <= now && now < time(guard.blockedUntil))) { mode = 'halt'; reasons.push({ reason: 'risk_cooldown' }); }
    if (item.purpose === 'allocate' && item.stateMachineEvidence && signals.guards.some(guard => same(guard.scope.instrument, item.instrument) && time(guard.issuedAt) <= now && time(item.stateMachineEvidence.evaluatedAt) <= time(guard.issuedAt))) { mode = 'halt'; reasons.push({ reason: 'state_machine_evidence_predates_risk_exit' }); }
    for (const value of advice.filter(value => same(value.scope.instrument, item.instrument) && time(value.availableAt) <= now && now < time(value.expiresAt))) {
      newRiskValidity.push(time(value.expiresAt), time(value.dataCutoffAt) + policy.maxDataAgeMs);
      if (now - time(value.dataCutoffAt) > policy.maxDataAgeMs) { ignoredAdvice.push({ id: value.id, reason: 'stale_inputs' }); mode = mode === 'flatten' ? mode : 'halt'; continue; }
      evidence.push(...value.evidence);
      if (value.action === 'cap') { check(value.cap.unit === limit.unit, 'Advice cap unit differs'); cap = minimum(cap, value.cap.value); if (Decimal.compare(value.cap.value, limit.maxAbsPosition) > 0) reasons.push({ id: value.id, reason: 'cannot_relax_hard_cap' }); }
      else if (value.action === 'flatten') mode = 'flatten';
      else if (value.action === 'halt' && mode !== 'flatten') mode = 'halt';
      reasons.push({ id: value.id, reason: value.reason });
    }
    for (const selected of item.signalRefs) {
      const signal = signals.active.find(value => same(signalIdentity(value), selected));
      if (item.purpose === 'allocate') {
        newRiskValidity.push(time(signal.generatedAt) + policy.maxSignalAgeMs, time(signal.dataCutoffAt) + policy.maxDataAgeMs, time(signal.expiresAt));
        if (now - time(signal.generatedAt) > policy.maxSignalAgeMs || now - time(signal.dataCutoffAt) > policy.maxDataAgeMs) { mode = mode === 'flatten' ? mode : 'halt'; reasons.push({ id: signal.id, reason: 'stale_signal_or_inputs' }); }
      }
    }
    for (const required of policy.requiredRiskSources ?? []) if (!advice.some(value => same(value.scope.instrument, item.instrument) && value.source.kind === required.kind && value.source.id === required.id && value.source.version === required.version && time(value.availableAt) <= now && now < time(value.expiresAt) && now - time(value.dataCutoffAt) <= policy.maxDataAgeMs)) {
      mode = mode === 'flatten' ? mode : 'halt'; reasons.push({ source: clone(required), reason: 'required_risk_judgment_missing' });
    }
    let value = item.quantity.value;
    if (!limit.allowShort && Decimal.compare(value, '0') < 0) { value = '0'; reasons.push({ reason: 'shorting_not_allowed' }); }
    if (Decimal.compare(Decimal.abs(value), cap) > 0) { value = Decimal.compare(value, '0') < 0 ? Decimal.sub('0', cap) : cap; reasons.push({ reason: 'quantity_capped' }); }
    if (mode === 'flatten') value = '0';
    if (mode === 'flatten' || Decimal.compare(cap, '0') === 0 || (item.purpose === 'allocate' && Decimal.compare(item.quantity.value, '0') !== 0 && Decimal.compare(value, '0') === 0)) {
      const guardScope = { ...target.scope, instrument: item.instrument };
      const guard = { id: `${target.id}:${digest(guardScope)}`, scope: clone(guardScope), issuedAt: utc(now), blockedUntil: utc(now + policy.cooldownMs), retiredSignals: signals.active.filter(signal => same(signal.scope.instrument, item.instrument)).map(signalIdentity), reason: 'risk_flatten', evidence: clone(evidence) };
      validateGuard(guard); guards.push(guard);
    }
    items.push({ ...clone(item), quantity: { value, unit: limit.unit }, mode, reasons, newRiskValidUntil: utc(Math.min(...newRiskValidity)), effectiveMaxAbsPosition: cap, limit: clone(limit) });
  }
  const result = { schemaVersion: PIPELINE_VERSION, kind: 'risk-decision', scope: clone(target.scope), asOf: utc(now), validUntil: utc(Math.min(time(target.validUntil), time(policy.validUntil))), targetId: target.id, targetDigest: digest(target), signalStateDigest: signals.digest, policy: clone(policy), strategySource: clone(target.strategySource), evidence: clone(target.evidence), items, guards, ignoredAdvice };
  return { ...result, digest: digest(result) };
}

function checkedDecision(value) {
  object(value, 'risk decision'); const { digest: receiptDigest, ...body } = value;
  check(value.kind === 'risk-decision' && value.schemaVersion === PIPELINE_VERSION && digest(body) === receiptDigest, 'Risk decision was changed or has an unsupported format');
  return value;
}
function validateSnapshot(snapshot, decision) {
  allowed(snapshot, ['id', 'scope', 'observedAt', 'availableAt', 'complete', 'positions', 'workingOrders', 'pendingIntents', 'evidence'], 'account snapshot');
  text(snapshot.id); scope(snapshot.scope); check(scoped(snapshot.scope, decision.scope), 'Snapshot account, strategy or run differs');
  check(time(snapshot.observedAt) <= time(snapshot.availableAt), 'Snapshot cannot be available before observation'); refs(snapshot.evidence, 'snapshot evidence', true);
  allowed(snapshot.complete, ['positions', 'workingOrders', 'pendingIntents'], 'snapshot completeness');
  for (const kind of ['positions', 'workingOrders', 'pendingIntents']) {
    check(typeof snapshot.complete[kind] === 'boolean', 'Completeness must be explicit for positions, working orders and pending intents');
    const seen = new Set();
    for (const row of list(snapshot[kind], kind)) {
      allowed(row, ['id', 'scope', ...(kind === 'positions' ? ['quantity'] : ['status'])], kind);
      text(row.id); scope(row.scope, true); check(same(row.scope.account, decision.scope.account), 'Snapshot contains a different account');
      check(!seen.has(row.id), `Duplicate ${kind} identity`); seen.add(row.id);
      if (kind === 'positions') measure(row.quantity);
      else check(['prepared', 'sent', 'accepted', 'partially_filled', 'cancel_pending', 'unknown'].includes(row.status), 'Only unresolved requests belong in workingOrders/pendingIntents');
    }
  }
}

/** Minimal net-quantity plan. No sending, matching, retries, currency conversion or protective-order emulation. */
export function planExecution({ decision, snapshot, capabilities, asOf }) {
  checkedDecision(decision); validateSnapshot(snapshot, decision); const now = time(asOf);
  allowed(capabilities, ['profile', 'features', 'instruments'], 'capabilities'); ref(capabilities.profile); check(capabilities.profile.kind === 'strategy.target', 'Execution capabilities need an exact strategy.target profile'); object(capabilities.features, 'features');
  for (const support of Object.values(capabilities.features)) check(['native', 'software', 'unsupported'].includes(support), 'Capability support must be explicit');
  const metadata = new Map();
  for (const spec of list(capabilities.instruments, 'instrument metadata', true)) {
    allowed(spec, ['instrument', 'unit', 'step', 'minimum'], 'instrument metadata'); instrument(spec.instrument); text(spec.unit); nonnegative(spec.minimum, 'minimum'); nonnegative(spec.step, 'step'); check(Decimal.compare(spec.step, '0') > 0, 'Quantity step must be positive');
    const key = canonical(spec.instrument); check(!metadata.has(key), 'Duplicate instrument metadata'); metadata.set(key, spec);
  }
  const reasons = [], intents = [], positions = [];
  const result = status => {
    const body = { schemaVersion: PIPELINE_VERSION, kind: 'execution-plan', status, asOf: clone(asOf), scope: clone(decision.scope), decisionDigest: decision.digest, strategySource: decision.strategySource, targetId: decision.targetId, snapshotId: snapshot.id, profile: capabilities.profile, evidence: [...decision.evidence, decision.policy.evidence, ...snapshot.evidence], reasons, positions, intents: status === 'ready' ? intents : [], nativeEngineExecuted: false };
    return { ...body, digest: digest(body) };
  };
  if (now < time(decision.asOf) || now >= time(decision.validUntil) || now >= time(decision.policy.validUntil)) { reasons.push({ reason: 'decision_not_active' }); return result('blocked'); }
  if (time(snapshot.availableAt) > now) { reasons.push({ reason: 'snapshot_not_available' }); return result('blocked'); }
  if (Object.values(snapshot.complete).some(value => !value)) { reasons.push({ reason: 'incomplete_account_view' }); return result('needs_reconciliation'); }
  for (const item of decision.items) {
    const rows = snapshot.positions.filter(row => same(row.scope.instrument, item.instrument));
    const unresolved = [...snapshot.workingOrders, ...snapshot.pendingIntents].filter(row => same(row.scope.instrument, item.instrument));
    if (rows.some(row => !scoped(row.scope, decision.scope)) || unresolved.some(row => !scoped(row.scope, decision.scope))) reasons.push({ instrument: item.instrument, reason: 'shared_position_ownership_requires_backend_reconciliation' });
    if (unresolved.length) reasons.push({ instrument: item.instrument, reason: 'outstanding_or_unknown_requests', requestIds: unresolved.map(row => row.id) });
  }
  if (reasons.length) return result('needs_reconciliation');
  for (const item of decision.items) {
    const spec = metadata.get(canonical(item.instrument)); check(spec && spec.unit === item.quantity.unit, 'Missing or incompatible instrument quantity metadata');
    if (now - time(snapshot.observedAt) > item.limit.maxSnapshotAgeMs) { reasons.push({ instrument: item.instrument, reason: 'stale_account_snapshot' }); continue; }
    const rows = snapshot.positions.filter(row => same(row.scope.instrument, item.instrument));
    rows.forEach(row => check(row.quantity.unit === spec.unit, 'Position and target quantity units differ'));
    check(rows.every(row => Decimal.compare(row.quantity.value, '0') >= 0) || rows.every(row => Decimal.compare(row.quantity.value, '0') <= 0), 'Offsetting hedge positions require an explicit backend position planner');
    const current = rows.reduce((sum, row) => Decimal.add(sum, row.quantity.value), '0');
    if (!exactSumEquals(rows.map(row => row.quantity.value), current)) { reasons.push({ instrument: item.instrument, reason: 'quantity_arithmetic_exceeds_precision' }); continue; }
    let target = Decimal.quantize(item.quantity.value, spec.step, Decimal.compare(item.quantity.value, '0') < 0 ? 'ceil' : 'floor');
    const reverses = Decimal.compare(current, '0') * Decimal.compare(target, '0') < 0;
    const riskMode = item.mode === 'flatten' ? 'flatten' : now < time(item.newRiskValidUntil) ? item.mode : 'halt';
    if (riskMode === 'halt' && (reverses || Decimal.compare(Decimal.abs(target), Decimal.abs(current)) > 0)) target = current;
    if (!item.limit.allowShort && Decimal.compare(target, '0') < 0) target = '0';
    if (Decimal.compare(Decimal.abs(target), item.effectiveMaxAbsPosition) > 0) target = Decimal.compare(target, '0') < 0 ? Decimal.sub('0', item.effectiveMaxAbsPosition) : item.effectiveMaxAbsPosition;
    target = Decimal.quantize(target, spec.step, Decimal.compare(target, '0') < 0 ? 'ceil' : 'floor');
    const delta = Decimal.sub(target, current); positions.push({ instrument: clone(item.instrument), current: { value: current, unit: spec.unit }, target: { value: target, unit: spec.unit }, delta: { value: delta, unit: spec.unit }, riskMode, ...(riskMode !== item.mode ? { restriction: 'new_risk_inputs_expired' } : {}) });
    if (!exactSumEquals([current, delta], target)) { reasons.push({ instrument: item.instrument, reason: 'quantity_arithmetic_exceeds_precision' }); continue; }
    if (Decimal.compare(delta, '0') === 0) continue;
    const unsupported = item.requirements.filter(name => !['native', 'software'].includes(capabilities.features[name]));
    if (unsupported.length) { reasons.push({ instrument: item.instrument, reason: 'unsupported_required_capability', capabilities: unsupported }); continue; }
    if (item.requirements.length || capabilities.features.marketOrder !== 'native' || capabilities.features.netPosition !== 'native' || Decimal.compare(current, '0') * Decimal.compare(target, '0') < 0) { reasons.push({ instrument: item.instrument, reason: 'requires_backend_order_planner' }); continue; }
    const quantity = Decimal.abs(delta);
    if (Decimal.compare(quantity, spec.minimum) < 0 || Decimal.compare(quantity, item.limit.maxOrderQuantity) > 0 || !exactStepMultiple(quantity, spec.step)) { reasons.push({ instrument: item.instrument, reason: 'delta_outside_single_order_limits' }); continue; }
    const purpose = Decimal.compare(Decimal.abs(target), Decimal.abs(current)) < 0 ? 'reduce' : 'increase';
    intents.push({ intentId: digest([decision.digest, snapshot.id, capabilities.profile, item.instrument, delta]), scope: { ...clone(decision.scope), instrument: clone(item.instrument) }, kind: 'net-quantity-delta', side: Decimal.compare(delta, '0') > 0 ? 'buy' : 'sell', quantity: { value: quantity, unit: spec.unit }, purpose, deadline: purpose === 'increase' ? utc(Math.min(time(decision.validUntil), time(item.newRiskValidUntil))) : clone(decision.validUntil), signalRefs: clone(item.signalRefs) });
  }
  if (reasons.length) return result(reasons.some(reason => reason.reason === 'stale_account_snapshot') ? 'blocked' : 'requires_backend_planner');
  return result(intents.length ? 'ready' : 'noop');
}

/** Public tool entry: a closed, JSON-only fixture; its exact artifact refs are resolved by the host tool. */
export function evaluatePipeline(fixture) {
  allowed(fixture, ['schemaVersion', 'asOf', 'executionAt', 'scope', 'events', 'guards', 'target', 'policy', 'advice', 'snapshot', 'capabilities'], 'pipeline fixture');
  check(fixture.schemaVersion === PIPELINE_VERSION, 'Unsupported pipeline version');
  const signals = replaySignals(fixture.events, { asOf: fixture.asOf, scope: fixture.scope, guards: fixture.guards ?? [] });
  const target = validatePortfolioTarget(fixture.target, signals);
  const riskDecision = assessRisk({ target, signals, policy: fixture.policy, advice: fixture.advice ?? [] });
  const executionPlan = planExecution({ decision: riskDecision, snapshot: fixture.snapshot, capabilities: fixture.capabilities, asOf: fixture.executionAt ?? fixture.asOf });
  return { schemaVersion: PIPELINE_VERSION, scope: clone(fixture.scope), signals, target, riskDecision, executionPlan, validationScope: 'fixed-input-pipeline-evaluation', nativeEngineExecuted: false };
}

export function validatePipeline(fixture) {
  const result = evaluatePipeline(fixture);
  return { schemaVersion: PIPELINE_VERSION, valid: true, executionStatus: result.executionPlan.status, reasons: result.executionPlan.reasons, validationScope: result.validationScope, nativeEngineExecuted: false };
}
