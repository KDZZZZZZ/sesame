import { Decimal } from '@sesame/plugin-sdk/decimal';
import { artifactRef, canonical, check, clone, decimal, digest, object, text } from '@sesame/plugin-sdk/protocol';

export { Decimal, artifactRef, canonical, check, clone, digest, object, text };
export const same = (a, b) => canonical(a) === canonical(b);
export const key = instrument => canonical(instrument);
export function fields(value, allowed, name = 'value') { object(value, name); check(Object.keys(value).every(field => allowed.includes(field)), `${name}: unknown field ${Object.keys(value).find(field => !allowed.includes(field))}`); return value; }
export function bounded(values, name = 'items', min = 0, max = 10000) { check(Array.isArray(values) && values.length >= min && values.length <= max, `${name} must have ${min}..${max} entries`); return values; }
export function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) { check(Number.isSafeInteger(value) && value >= min && value <= max, `${name} must be an integer in ${min}..${max}`); return value; }
export function dec(value, name = 'value', nonnegative = false) { decimal(value, name); check(value.length <= 128, `${name} exceeds the decimal budget`); if (nonnegative) check(Decimal.compare(value, '0') >= 0, `${name} must be nonnegative`); return value; }
export function utc(value, name = 'time') { fields(value, ['basis', 'unixMs'], name); check(value.basis === 'utc', `${name} needs resolved UTC`); return integer(value.unixMs, `${name}.unixMs`); }
export const time = unixMs => ({ basis: 'utc', unixMs });
export function instrument(value) { fields(value, ['sourceId', 'instrumentId'], 'instrument'); text(value.sourceId); text(value.instrumentId); return value; }
export function scope(value, item = false) { fields(value, ['strategyId', 'runId', 'account', ...(item ? ['instrument'] : [])], 'scope'); text(value.strategyId); text(value.runId); fields(value.account, ['connectionId', 'accountId'], 'account'); text(value.account.connectionId); text(value.account.accountId); if (item) instrument(value.instrument); return value; }
export const baseScope = value => ({ strategyId: value.strategyId, runId: value.runId, account: value.account });
export function owned(value, expected) { scope(value, !!value.instrument); check(same(baseScope(value), baseScope(expected)), 'Account, strategy or run ownership differs'); }
export function references(values, name = 'evidence', min = 1) { bounded(values, name, min).forEach(artifactRef); return values; }
export function available(value, asOf, maxAgeMs, name = 'observation') { const observed = utc(value.observedAt, `${name}.observedAt`), received = utc(value.availableAt, `${name}.availableAt`); check(observed <= received && received <= asOf, `${name} was not available at the decision time`); check(asOf - observed <= maxAgeMs, `${name} is stale`); references(value.evidence, `${name}.evidence`); }
export function measure(value, dimension = 'unit') { fields(value, ['value', dimension], dimension); dec(value.value); text(value[dimension]); return value; }
export const abs = value => value[0] === '-' ? value.slice(1) : value;
export const neg = value => Decimal.compare(value, '0') === 0 ? '0' : value[0] === '-' ? value.slice(1) : `-${value}`;
export const min = (a, b) => Decimal.compare(a, b) <= 0 ? a : b;
export const max = (a, b) => Decimal.compare(a, b) >= 0 ? a : b;
export function sealed(value) { return { ...value, digest: digest(value) }; }
export function verifySeal(value, kind) { const { digest: hash, ...body } = object(value); check((!kind || value.kind === kind) && hash === digest(body), `Changed or invalid ${kind ?? 'receipt'}`); return value; }

// Exact finite-decimal arithmetic for budgets and lot counts; no floating point.
const power = n => { integer(n, 'scale', 0, 2048); return 10n ** BigInt(n); };
const parts = value => { dec(value); const [whole, fraction = ''] = value.split('.'); return { n: BigInt(whole + fraction), s: fraction.length }; };
const format = ({ n, s }) => { if (n === 0n) return '0'; while (s > 0 && n % 10n === 0n) { n /= 10n; s--; } const digits = (n < 0n ? -n : n).toString().padStart(s + 1, '0'); return `${n < 0n ? '-' : ''}${s ? `${digits.slice(0, -s)}.${digits.slice(-s)}` : digits}`; };
export function exactAdd(...values) { const rows = values.map(parts), s = Math.max(0, ...rows.map(row => row.s)); return format({ n: rows.reduce((sum, row) => sum + row.n * power(s - row.s), 0n), s }); }
export function exactMul(...values) { return format(values.map(parts).reduce((a, b) => ({ n: a.n * b.n, s: a.s + b.s }), { n: 1n, s: 0 })); }
export function exactLots(numerators, denominators, step) {
  const a = numerators.map(parts).reduce((x, y) => ({ n: x.n * y.n, s: x.s + y.s }), { n: 1n, s: 0 });
  const b = [...denominators, step].map(parts).reduce((x, y) => ({ n: x.n * y.n, s: x.s + y.s }), { n: 1n, s: 0 });
  check(a.n >= 0n && b.n > 0n, 'Lot sizing needs nonnegative budget and positive unit cost/step');
  const lots = a.n * power(b.s) / (b.n * power(a.s)); return exactMul(lots.toString(), step);
}
export function stepMultiple(value, step) { const a = parts(value), b = parts(step), s = Math.max(a.s, b.s); check(b.n > 0n, 'Step must be positive'); return a.n * power(s - a.s) % (b.n * power(s - b.s)) === 0n; }
export function uniqueInstruments(values, name = 'instruments') { const seen = new Set(); for (const value of values) { instrument(value.instrument ?? value); const k = key(value.instrument ?? value); check(!seen.has(k), `Duplicate ${name}`); seen.add(k); } }

export function marketMap(records, { asOf, maxDataAgeMs, currency, fx }) {
  bounded(records, 'instrument metadata', 1, 1000); uniqueInstruments(records); bounded(fx, 'FX records');
  const fxMap = new Map();
  for (const rate of fx) {
    fields(rate, ['from', 'to', 'rate', 'observedAt', 'availableAt', 'evidence'], 'FX rate'); text(rate.from); text(rate.to); dec(rate.rate, 'FX rate', true); check(Decimal.compare(rate.rate, '0') > 0, 'FX rate must be positive'); available(rate, asOf, maxDataAgeMs, 'FX');
    const k = `${rate.from}\0${rate.to}`; check(!fxMap.has(k), 'Duplicate FX pair'); fxMap.set(k, rate);
  }
  return new Map(records.map(record => {
    fields(record, ['instrument', 'unit', 'price', 'multiplier', 'step', 'minimum', 'volatility', 'groups', 'valuation', 'observedAt', 'availableAt', 'evidence'], 'instrument metadata');
    instrument(record.instrument); text(record.unit); measure(record.price, 'currency'); dec(record.multiplier, 'multiplier', true); dec(record.step, 'step', true); dec(record.minimum, 'minimum', true);
    check(record.valuation === 'linear', 'Only explicit linear contract valuation is supported'); check(Decimal.compare(record.price.value, '0') > 0 && Decimal.compare(record.multiplier, '0') > 0 && Decimal.compare(record.step, '0') > 0, 'Price, multiplier and step must be positive');
    if (record.volatility !== undefined) { dec(record.volatility, 'volatility', true); check(Decimal.compare(record.volatility, '0') > 0, 'Volatility must be positive'); }
    bounded(record.groups, 'groups').forEach(text); available(record, asOf, maxDataAgeMs, 'instrument valuation');
    const conversion = record.price.currency === currency ? null : fxMap.get(`${record.price.currency}\0${currency}`);
    check(record.price.currency === currency || conversion, `Missing explicit ${record.price.currency}/${currency} FX evidence`);
    return [key(record.instrument), { ...clone(record), fxRate: conversion?.rate ?? '1', fxEvidence: conversion?.evidence ?? [], unitValue: exactMul(record.price.value, record.multiplier, conversion?.rate ?? '1') }];
  }));
}
