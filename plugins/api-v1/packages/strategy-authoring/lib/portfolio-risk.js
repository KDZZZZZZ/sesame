import { Decimal, abs, artifactRef, bounded, check, clone, dec, exactAdd, exactLots, exactMul, fields, integer, key, marketMap, min, neg, references, same, sealed, time, utc, verifySeal } from './method-support.js';
const groupValue = (groups, name) => Object.hasOwn(groups, name) ? groups[name] : '0';

function metrics(items, metadata) {
  let gross = '0', net = '0'; const groups = new Map();
  for (const item of items) {
    const spec = metadata.get(key(item.instrument)); check(spec && spec.unit === item.quantity.unit, 'Risk target needs matching valuation/unit');
    const signed = exactMul(item.quantity.value, spec.unitValue), amount = abs(signed);
    gross = exactAdd(gross, amount); net = exactAdd(net, signed);
    for (const group of new Set(spec.groups)) groups.set(group, exactAdd(groups.get(group) ?? '0', amount));
  }
  return { gross, net, groups: Object.fromEntries(groups) };
}

/** Per-item caps/halts can unbalance a hedge; verify the final effective quantities too. */
export function checkPlannedPortfolio({ risk, plan, market }) {
  verifySeal(risk, 'portfolio-risk'); verifySeal(plan, 'execution-plan'); check(same(risk.scope, plan.scope), 'Portfolio risk and execution plan ownership differs');
  if (['blocked', 'needs_reconciliation'].includes(plan.status) || plan.positions.length !== risk.target.items.length) return sealed({ kind: 'portfolio-enforcement', status: 'not_evaluated', planDigest: plan.digest, reasons: ['execution_view_incomplete_or_blocked'], advice: [] });
  const metadata = marketMap(market.instruments, { asOf: utc(risk.asOf), maxDataAgeMs: market.maxDataAgeMs, currency: risk.equity.currency, fx: market.fx });
  const actual = metrics(plan.positions.map(row => ({ instrument: row.instrument, quantity: row.target })), metadata), reasons = [];
  if (Decimal.compare(actual.gross, risk.caps.gross) > 0) reasons.push('post_policy_gross_exposure');
  if (Decimal.compare(abs(actual.net), risk.caps.net) > 0) reasons.push('post_policy_net_exposure');
  for (const [group, cap] of Object.entries(risk.caps.groups)) if (Decimal.compare(groupValue(actual.groups, group), cap) > 0) reasons.push(`post_policy_group:${group}`);
  const evidence = [...risk.evidence, ...plan.evidence];
  const advice = reasons.length ? risk.target.items.map((item, index) => ({
    id: `${risk.target.id}:execution-portfolio-risk:${index}`, scope: { ...clone(risk.scope), instrument: clone(item.instrument) },
    source: { kind: 'algorithm', id: 'sesame.portfolio-risk', version: '1.0.0', configurationDigest: risk.evidence[0].digest },
    generatedAt: clone(risk.asOf), availableAt: clone(risk.asOf), expiresAt: clone(risk.target.validUntil), dataCutoffAt: clone(risk.asOf),
    inputs: evidence.map(ref => ({ ref: clone(ref), availableAt: clone(risk.asOf) })), action: 'flatten', reason: reasons.join(', '), evidence: clone(evidence),
  })) : [];
  return sealed({ kind: 'portfolio-enforcement', status: reasons.length ? 'flatten_required' : 'within_limits', planDigest: plan.digest, actual, caps: clone(risk.caps), reasons, advice, evidence });
}

/** Deterministic proportional portfolio risk; hard exposure caps are checked after lot rounding. */
export function constrainPortfolio({ construction, market, config }) {
  verifySeal(construction, 'portfolio-construction'); const now = utc(construction.asOf), currency = construction.unallocatedBudget.currency;
  fields(config, ['policyRef', 'equity', 'maxEquityAgeMs', 'maxDrawdown', 'maxGrossExposure', 'maxAbsNetExposure', 'groupLimits'], 'portfolio risk config'); artifactRef(config.policyRef);
  integer(config.maxEquityAgeMs, 'maxEquityAgeMs'); dec(config.maxDrawdown, 'maxDrawdown', true); check(Decimal.compare(config.maxDrawdown, '1') <= 0, 'Drawdown threshold exceeds one'); dec(config.maxGrossExposure, 'maxGrossExposure', true); dec(config.maxAbsNetExposure, 'maxAbsNetExposure', true);
  fields(config.equity, ['currency', 'historyStart', 'complete', 'observations'], 'equity history'); check(config.equity.currency === currency && config.equity.complete === true, 'Risk needs complete equity history in its base currency');
  const start = utc(config.equity.historyStart); check(start <= now, 'Equity history starts in the future');
  let previous = start - 1, current = null, peak = '0'; const ids = new Set(), used = [];
  for (const row of bounded(config.equity.observations, 'equity observations', 1)) {
    fields(row, ['id', 'value', 'observedAt', 'availableAt', 'evidence'], 'equity observation'); check(typeof row.id === 'string' && row.id && !ids.has(row.id), 'Equity observations need unique IDs'); ids.add(row.id); dec(row.value, 'equity', true); references(row.evidence);
    const observed = utc(row.observedAt), available = utc(row.availableAt); check(observed >= start && observed >= previous && available >= observed, 'Equity history must retain its true time order'); previous = observed;
    if (available > now || observed > now) continue;
    current = row; used.push(row); if (Decimal.compare(row.value, peak) > 0) peak = row.value;
  }
  check(current && now - utc(current.observedAt) <= config.maxEquityAgeMs, 'Current equity is missing or stale');
  const metadata = marketMap(market.instruments, { asOf: now, maxDataAgeMs: market.maxDataAgeMs, currency, fx: market.fx });
  const groupLimits = bounded(config.groupLimits, 'group limits', 0, 1000), seen = new Set();
  for (const limit of groupLimits) { fields(limit, ['group', 'maxGrossExposure'], 'group limit'); check(typeof limit.group === 'string' && limit.group && !seen.has(limit.group), 'Group limits need unique names'); seen.add(limit.group); dec(limit.maxGrossExposure, 'group limit', true); }
  const drawdown = Decimal.compare(peak, '0') === 0 ? '0' : Decimal.div(exactAdd(peak, neg(current.value)), peak);
  const before = metrics(construction.target.items, metadata), caps = { gross: exactMul(current.value, config.maxGrossExposure), net: exactMul(current.value, config.maxAbsNetExposure), groups: Object.fromEntries(groupLimits.map(limit => [limit.group, exactMul(current.value, limit.maxGrossExposure)])) };
  const reasons = []; let scale = '1';
  const capRatio = (value, maximum, name) => { if (Decimal.compare(value, maximum) > 0) { scale = min(scale, Decimal.div(maximum, value)); reasons.push(name); } };
  capRatio(before.gross, caps.gross, 'gross_exposure'); capRatio(abs(before.net), caps.net, 'net_exposure');
  for (const limit of groupLimits) capRatio(groupValue(before.groups, limit.group), caps.groups[limit.group], `group:${limit.group}`);
  const drawdownHit = Decimal.compare(drawdown, config.maxDrawdown) >= 0 && Decimal.compare(drawdown, '0') > 0;
  if (drawdownHit || Decimal.compare(current.value, '0') === 0) { scale = '0'; reasons.push(drawdownHit ? 'drawdown_limit' : 'no_equity'); }
  const target = clone(construction.target);
  target.validUntil = time(Math.min(utc(target.validUntil), utc(current.observedAt) + config.maxEquityAgeMs + 1));
  for (const item of target.items) {
    const spec = metadata.get(key(item.instrument));
    const adjusted = exactLots([abs(item.quantity.value), scale], ['1'], spec.step);
    item.quantity.value = Decimal.compare(item.quantity.value, '0') < 0 ? neg(adjusted) : adjusted;
    if (Decimal.compare(abs(item.quantity.value), spec.minimum) < 0) item.quantity.value = '0';
    if (Decimal.compare(item.quantity.value, '0') === 0 && (drawdownHit || reasons.length)) item.purpose = 'exit';
  }
  let after = metrics(target.items, metadata);
  if (Decimal.compare(after.gross, caps.gross) > 0 || Decimal.compare(abs(after.net), caps.net) > 0 || groupLimits.some(limit => Decimal.compare(groupValue(after.groups, limit.group), caps.groups[limit.group]) > 0)) {
    // Rounding one hedged leg can break an exact net cap. Do not silently tolerate it.
    reasons.push('lot_rounding_exceeds_hard_cap'); for (const item of target.items) { item.quantity.value = '0'; item.purpose = 'exit'; } after = metrics(target.items, metadata);
  }
  const evidence = [config.policyRef, ...used.flatMap(row => row.evidence), ...construction.evidence];
  const advice = reasons.length ? target.items.map((item, index) => ({
    id: `${target.id}:portfolio-risk:${index}`, scope: { ...clone(target.scope), instrument: clone(item.instrument) },
    source: { kind: 'algorithm', id: 'sesame.portfolio-risk', version: '1.0.0', configurationDigest: config.policyRef.digest },
    generatedAt: clone(construction.asOf), availableAt: clone(construction.asOf), expiresAt: clone(target.validUntil), dataCutoffAt: clone(construction.asOf),
    inputs: evidence.map(ref => ({ ref: clone(ref), availableAt: clone(construction.asOf) })), action: Decimal.compare(item.quantity.value, '0') === 0 ? 'flatten' : 'cap', ...(Decimal.compare(item.quantity.value, '0') === 0 ? {} : { cap: { value: abs(item.quantity.value), unit: item.quantity.unit } }), reason: reasons.join(', '), evidence: clone(evidence),
  })) : [];
  return sealed({ schemaVersion: '1.0.0', kind: 'portfolio-risk', asOf: clone(construction.asOf), scope: clone(construction.scope), target, advice, drawdown, highWaterMark: { value: peak, currency }, equity: { value: current.value, currency }, scale, before, after, caps, reasons, evidence: clone(evidence), nativeEngineExecuted: false });
}
