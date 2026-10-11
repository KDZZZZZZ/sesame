import { Decimal, abs, artifactRef, baseScope, bounded, check, clone, dec, exactAdd, exactLots, exactMul, fields, integer, key, marketMap, measure, min, neg, owned, references, same, scope, sealed, text, utc, verifySeal } from './method-support.js';

/** Converts explicit signal scores and a finite base-currency budget to sized quantity targets. */
export function constructPortfolio({ id, scope: owner, asOf, strategySource, signals, universe, snapshot, config }) {
  text(id); scope(owner); const now = utc(asOf); artifactRef(strategySource); check(strategySource.kind === 'strategy.source', 'A fixed strategy.source is required'); verifySeal(signals); verifySeal(universe, 'universe-selection');
  check(same(signals.scope, owner) && utc(signals.asOf) === now && utc(universe.asOf) === now, 'Signal, universe and construction times/ownership must agree');
  fields(config, ['method', 'budget', 'budgetBasis', 'reserveFraction', 'feeRate', 'signalAggregation', 'inactiveSignalPolicy', 'removedInstrumentPolicy', 'instruments', 'fx', 'maxDataAgeMs', 'validUntil', 'evidence'], 'portfolio config');
  check(['equal', 'confidence', 'inverse_volatility'].includes(config.method), 'Unknown portfolio method'); check(['cash', 'gross_notional'].includes(config.budgetBasis), 'Budget basis must be cash or gross_notional'); check(['latest', 'consensus'].includes(config.signalAggregation), 'Signal aggregation must be explicit');
  check(['hold', 'flatten'].includes(config.inactiveSignalPolicy) && ['hold', 'flatten'].includes(config.removedInstrumentPolicy), 'Missing signal and universe removal policies must be explicit');
  measure(config.budget, 'currency'); dec(config.budget.value, 'budget', true); dec(config.reserveFraction, 'reserveFraction', true); check(Decimal.compare(config.reserveFraction, '1') <= 0, 'Reserve fraction exceeds one'); dec(config.feeRate, 'feeRate', true); integer(config.maxDataAgeMs, 'maxDataAgeMs'); check(utc(config.validUntil) > now, 'Construction deadline must be in the future'); references(config.evidence);
  owned(snapshot.scope, owner); check(['positions', 'workingOrders', 'pendingIntents'].every(name => snapshot.complete?.[name] === true), 'Portfolio sizing requires complete positions, orders and intent ledger');
  check(utc(snapshot.availableAt) <= now && utc(snapshot.observedAt) <= utc(snapshot.availableAt) && now - utc(snapshot.observedAt) <= config.maxDataAgeMs, 'Account snapshot is not currently available/fresh');
  const metadata = marketMap(config.instruments, { asOf: now, maxDataAgeMs: config.maxDataAgeMs, currency: config.budget.currency, fx: config.fx });
  const current = new Map();
  for (const row of bounded(snapshot.positions, 'positions')) { owned(row.scope, owner); const spec = metadata.get(key(row.scope.instrument)); check(spec && row.quantity?.unit === spec.unit, 'Held position needs explicit valuation and matching unit'); dec(row.quantity.value); current.set(key(row.scope.instrument), exactAdd(current.get(key(row.scope.instrument)) ?? '0', row.quantity.value)); }
  const selectedKeys = new Set(universe.selected.map(key)), chosen = [], held = [], exits = [], diagnostics = [];
  for (const instrument of universe.selected) {
    const spec = metadata.get(key(instrument)); check(spec, 'Selected instrument needs explicit valuation');
    const candidates = signals.active.filter(signal => same(signal.scope.instrument, instrument));
    let signal;
    if (candidates.length) {
      const ordered = [...candidates].sort((a, b) => utc(b.generatedAt) - utc(a.generatedAt) || b.sequence - a.sequence || (a.id < b.id ? -1 : 1));
      if (config.signalAggregation === 'consensus' && new Set(ordered.map(value => value.direction)).size > 1) diagnostics.push({ instrument, reason: 'conflicting_signals' }); else signal = ordered[0];
    }
    if (!signal) {
      if (current.has(key(instrument))) (config.inactiveSignalPolicy === 'flatten' ? exits : held).push({ instrument, spec, quantity: current.get(key(instrument)) });
      diagnostics.push({ instrument, reason: 'no_usable_signal' }); continue;
    }
    if (signal.direction === 'flat') { exits.push({ instrument, spec, quantity: current.get(key(instrument)) ?? '0', signal }); continue; }
    check(config.budgetBasis !== 'cash' || signal.direction === 'long', 'Cash-only sizing cannot infer margin or short-sale buying power; use an explicit gross-notional budget');
    let score = '1';
    if (config.method === 'confidence') { check(signal.confidence !== undefined, 'Confidence weighting requires a stated confidence; unknown is not zero'); score = signal.confidence; }
    if (config.method === 'inverse_volatility') { check(spec.volatility !== undefined, 'Inverse-volatility sizing requires fixed volatility input'); score = Decimal.div('1', spec.volatility); }
    if (Decimal.compare(score, '0') === 0) { diagnostics.push({ instrument, reason: 'zero_score' }); if (current.has(key(instrument))) (config.inactiveSignalPolicy === 'flatten' ? exits : held).push({ instrument, spec, quantity: current.get(key(instrument)) }); continue; }
    chosen.push({ instrument, spec, signal, score });
  }
  for (const [instrumentKey, quantity] of current) if (!selectedKeys.has(instrumentKey)) { const spec = metadata.get(instrumentKey); (config.removedInstrumentPolicy === 'flatten' ? exits : held).push({ instrument: spec.instrument, spec, quantity }); }
  const reserve = exactMul(config.budget.value, config.reserveFraction), usable = exactAdd(config.budget.value, neg(reserve));
  const heldNotional = held.reduce((sum, row) => exactAdd(sum, exactMul(abs(row.quantity), row.spec.unitValue)), '0');
  check(Decimal.compare(heldNotional, usable) <= 0, 'Preserved holdings already exceed the requested budget; explicitly change removal/holding policy or apply risk reduction');
  const allocationBudget = exactAdd(usable, neg(heldNotional)), totalScore = chosen.reduce((sum, row) => exactAdd(sum, row.score), '0');
  let remaining = allocationBudget, spent = '0', fees = '0', deadline = utc(config.validUntil); const items = [], allocations = [];
  // Canonical order fixes any final decimal rounding residual, independent of feed order.
  chosen.sort((a, b) => key(a.instrument) < key(b.instrument) ? -1 : 1);
  for (const row of chosen) {
    const unitWithFee = exactMul(row.spec.unitValue, exactAdd('1', config.feeRate));
    const byWeight = exactLots([allocationBudget, row.score], [totalScore, unitWithFee], row.spec.step), byRemaining = exactLots([remaining], [unitWithFee], row.spec.step);
    let quantity = min(byWeight, byRemaining); if (Decimal.compare(quantity, row.spec.minimum) < 0) { quantity = '0'; diagnostics.push({ instrument: row.instrument, reason: 'below_minimum_quantity' }); }
    const notional = exactMul(quantity, row.spec.unitValue), fee = exactMul(notional, config.feeRate), cost = exactAdd(notional, fee);
    remaining = exactAdd(remaining, neg(cost)); spent = exactAdd(spent, notional); fees = exactAdd(fees, fee); check(Decimal.compare(remaining, '0') >= 0, 'Construction exceeded its exact cash budget');
    if (row.signal.direction === 'short') quantity = neg(quantity);
    deadline = Math.min(deadline, utc(row.signal.expiresAt));
    items.push({ instrument: clone(row.instrument), quantity: { value: quantity, unit: row.spec.unit }, purpose: 'allocate', signalRefs: [{ id: row.signal.id, revision: row.signal.revision }], requirements: [] });
    allocations.push({ instrument: clone(row.instrument), score: row.score, normalizedWeight: Decimal.div(row.score, totalScore), quantity: { value: quantity, unit: row.spec.unit }, baseNotional: { value: notional, currency: config.budget.currency }, feeEstimate: { value: fee, currency: config.budget.currency }, price: row.spec.price, multiplier: row.spec.multiplier, fxRate: row.spec.fxRate, evidence: [...row.spec.evidence, ...row.spec.fxEvidence] });
  }
  for (const row of held) items.push({ instrument: clone(row.instrument), quantity: { value: row.quantity, unit: row.spec.unit }, purpose: 'hold', signalRefs: [], requirements: [] });
  for (const row of exits) items.push({ instrument: clone(row.instrument), quantity: { value: '0', unit: row.spec.unit }, purpose: 'exit', signalRefs: row.signal ? [{ id: row.signal.id, revision: row.signal.revision }] : [], requirements: [] });
  // A future execution must not keep sizing against an expired valuation/FX or account view.
  deadline = Math.min(deadline, utc(snapshot.observedAt) + config.maxDataAgeMs + 1);
  for (const item of items) {
    const spec = metadata.get(key(item.instrument)); deadline = Math.min(deadline, utc(spec.observedAt) + config.maxDataAgeMs + 1);
    if (spec.price.currency !== config.budget.currency) { const rate = config.fx.find(row => row.from === spec.price.currency && row.to === config.budget.currency); deadline = Math.min(deadline, utc(rate.observedAt) + config.maxDataAgeMs + 1); }
  }
  const totalAllocated = exactAdd(heldNotional, spent, fees), remainder = exactAdd(config.budget.value, neg(totalAllocated));
  const target = { schemaVersion: '1.1.0', id, scope: clone(owner), createdAt: clone(asOf), validUntil: { basis: 'utc', unixMs: deadline }, strategySource: clone(strategySource), evidence: clone(config.evidence), items };
  return sealed({ schemaVersion: '1.0.0', kind: 'portfolio-construction', asOf: clone(asOf), scope: clone(owner), method: config.method, target, allocations, heldNotional: { value: heldNotional, currency: config.budget.currency }, estimatedFees: { value: fees, currency: config.budget.currency }, reserved: { value: reserve, currency: config.budget.currency }, unallocatedBudget: { value: remainder, currency: config.budget.currency }, ...(config.budgetBasis === 'cash' ? { estimatedRemainingCash: { value: remainder, currency: config.budget.currency } } : {}), diagnostics, evidence: [...clone(config.evidence), ...universe.evidence, ...allocations.flatMap(value => value.evidence)], nativeEngineExecuted: false });
}
