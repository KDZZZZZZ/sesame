import { Decimal, artifactRef, available, bounded, canonical, check, clone, dec, fields, integer, instrument, key, same, sealed, text, uniqueInstruments, utc } from './method-support.js';

function predicate(spec, row, depth = 0) {
  check(depth < 12, 'Universe filter nesting exceeds budget');
  if (Object.hasOwn(spec, 'all') || Object.hasOwn(spec, 'any')) { const op = Object.hasOwn(spec, 'all') ? 'all' : 'any'; fields(spec, [op], 'filter'); const values = bounded(spec[op], 'filter children', 1, 64).map(item => predicate(item, row, depth + 1)); return op === 'all' ? values.every(Boolean) : values.some(Boolean); }
  if (Object.hasOwn(spec, 'not')) { fields(spec, ['not'], 'filter'); return !predicate(spec.not, row, depth + 1); }
  fields(spec, ['field', 'type', 'op', 'value'], 'filter'); text(spec.field); check(['decimal', 'string', 'boolean'].includes(spec.type), 'Filter type must be explicit'); check(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'].includes(spec.op), 'Unknown universe filter operator');
  const values = spec.op === 'in' ? bounded(spec.value, 'membership filter', 0, 1000) : [spec.value];
  for (const value of values) { if (spec.type === 'decimal') dec(value); else check(typeof value === spec.type, 'Universe filter value type differs'); }
  const actual = Object.hasOwn(row, spec.field) ? row[spec.field] : undefined; if (actual === undefined || actual === null) return false;
  const compare = value => { if (spec.type === 'decimal') { dec(actual); dec(value); return Decimal.compare(actual, value); } check(typeof actual === spec.type && typeof value === spec.type, 'Universe field type differs'); return actual < value ? -1 : actual > value ? 1 : 0; };
  if (spec.op === 'in') return bounded(spec.value, 'membership filter', 0, 1000).some(value => compare(value) === 0);
  const result = compare(spec.value); return { eq: result === 0, ne: result !== 0, gt: result > 0, gte: result >= 0, lt: result < 0, lte: result <= 0 }[spec.op];
}

/** Dynamic selection uses point-in-time candidate records, not future membership. */
export function selectUniverse(input) {
  fields(input, ['asOf', 'candidates', 'filter', 'rank', 'topN', 'previous', 'maxDataAgeMs'], 'universe input'); const now = utc(input.asOf); integer(input.maxDataAgeMs, 'maxDataAgeMs'); integer(input.topN, 'topN', 0, 1000);
  const candidates = bounded(input.candidates, 'candidates', 0, 10000); uniqueInstruments(candidates, 'universe candidate'); const previous = bounded(input.previous, 'previous', 0, 1000); uniqueInstruments(previous, 'previous universe');
  const rank = bounded(input.rank, 'rank', 1, 16); rank.forEach(rule => { fields(rule, ['field', 'type', 'order', 'missing'], 'ranking'); text(rule.field); check(['decimal', 'string'].includes(rule.type) && ['asc', 'desc'].includes(rule.order) && ['last', 'exclude'].includes(rule.missing), 'Ranking needs type, direction and missing policy'); });
  if (input.filter) predicate(input.filter, {});
  const rejected = [], accepted = [];
  for (const candidate of candidates) {
    fields(candidate, ['instrument', 'fields', 'observedAt', 'availableAt', 'evidence'], 'universe candidate'); instrument(candidate.instrument); check(candidate.fields && typeof candidate.fields === 'object' && !Array.isArray(candidate.fields), 'Candidate fields must be a record');
    for (const name of Object.keys(candidate.fields)) check(!['__proto__', 'constructor', 'prototype'].includes(name), 'Unsafe universe field');
    bounded(candidate.evidence, 'candidate evidence', 1).forEach(artifactRef);
    check(utc(candidate.observedAt) <= utc(candidate.availableAt), 'Candidate availability precedes observation');
    let reason = utc(candidate.availableAt) > now ? 'not_available' : now - utc(candidate.observedAt) > input.maxDataAgeMs ? 'stale' : null;
    if (!reason && input.filter && !predicate(input.filter, candidate.fields)) reason = 'filtered';
    if (!reason && rank.some(rule => rule.missing === 'exclude' && candidate.fields[rule.field] == null)) reason = 'missing_rank';
    if (reason) rejected.push({ instrument: clone(candidate.instrument), reason }); else {
      for (const rule of rank) { const value = candidate.fields[rule.field]; if (value != null) { if (rule.type === 'decimal') dec(value); else check(typeof value === 'string', 'Rank field must be text'); } }
      accepted.push(candidate);
    }
  }
  accepted.sort((a, b) => {
    for (const rule of rank) {
      const av = a.fields[rule.field], bv = b.fields[rule.field]; if (av == null || bv == null) { if (av == null && bv == null) continue; return av == null ? 1 : -1; }
      let value; if (rule.type === 'decimal') { dec(av); dec(bv); value = Decimal.compare(av, bv); } else { check(typeof av === 'string' && typeof bv === 'string', 'Rank field must be text'); value = av < bv ? -1 : av > bv ? 1 : 0; }
      if (value) return rule.order === 'asc' ? value : -value;
    }
    return key(a.instrument) < key(b.instrument) ? -1 : key(a.instrument) > key(b.instrument) ? 1 : 0;
  });
  const selected = accepted.slice(0, input.topN).map(value => clone(value.instrument));
  return sealed({ schemaVersion: '1.0.0', kind: 'universe-selection', asOf: clone(input.asOf), selected, added: selected.filter(value => !previous.some(old => same(old, value))), removed: previous.filter(value => !selected.some(next => same(next, value))).map(clone), unchanged: selected.filter(value => previous.some(old => same(old, value))), rejected: [...rejected, ...accepted.slice(input.topN).map(value => ({ instrument: clone(value.instrument), reason: 'below_rank_cutoff' }))], evidence: candidates.filter(candidate => selected.some(value => same(value, candidate.instrument))).flatMap(candidate => candidate.evidence) });
}
