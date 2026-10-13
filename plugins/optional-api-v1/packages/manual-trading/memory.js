import { createHash } from 'node:crypto';

// Design references: TradingAgents decision/outcome logs and META episodic
// state/action/outcome/reflection records. This is a local implementation, not
// a reproduction of either project's trading results or retrieval algorithm.
export const MEMORY_LIMITS = Object.freeze({ runBytes: 262144, reviewBytes: 131072, contextBytes: 262144, evidence: 16, limit: 20 });
const RUNS = 'trading_memory_runs', REVIEWS = 'trading_memory_reviews';
const check = (ok, code, message) => { if (!ok) throw Object.assign(new Error(message), { code }); };
const text = (value, field, max = 256) => {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'INVALID_ARGUMENT', `${field} must contain 1–${max} characters`);
  return value.trim();
};
const timestamp = (value, field) => {
  const numeric = typeof value === 'number' && Number.isSafeInteger(value);
  const dated = typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value);
  const ms = numeric ? value : dated ? Date.parse(value) : NaN;
  check(Number.isFinite(ms) && ms >= 0 && ms <= 8640000000000000, 'INVALID_ARGUMENT', `${field} must be epoch milliseconds or a timestamp with timezone`);
  return ms;
};
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
function bounded(value, maxBytes, field) {
  let nodes = 0;
  const walk = (item, depth) => {
    check(depth <= 24 && ++nodes <= 30000, 'MEMORY_LIMIT', `${field} is too deeply nested or large`);
    if (item === null || ['string', 'boolean', 'undefined'].includes(typeof item)) return;
    if (typeof item === 'number') { check(Number.isFinite(item), 'INVALID_ARGUMENT', `${field} contains a non-finite number`); return; }
    check(typeof item === 'object' && (Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null), 'INVALID_ARGUMENT', `${field} must be plain JSON data`);
    for (const [key, child] of Object.entries(item)) {
      check(!['__proto__', 'constructor', 'prototype'].includes(key), 'INVALID_ARGUMENT', `${field} contains an unsafe key`);
      walk(child, depth + 1);
    }
  };
  walk(value, 0);
  const json = JSON.stringify(value);
  check(typeof json === 'string' && Buffer.byteLength(json) <= maxBytes, 'MEMORY_LIMIT', `${field} exceeds ${maxBytes} bytes; provide a complete bounded observation`);
  return JSON.parse(json);
}
const dot = (value, path) => {
  check(typeof path === 'string' && /^[\w.-]{1,160}$/.test(path) && !path.split('.').some(key => ['__proto__', 'constructor', 'prototype'].includes(key)), 'INVALID_ARGUMENT', 'Invalid evidence field path');
  return path.split('.').reduce((item, key) => item && Object.hasOwn(item, key) ? item[key] : undefined, value);
};
function observationTimes(value, cutoff) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:asOf|as_of|observedAt|observed_at|sourceTimeMs|capturedAt|knownAt|publishedAt|published_at)$/.test(key) && item !== null && item !== undefined) {
      check(timestamp(item, key) <= cutoff, 'FUTURE_EVIDENCE', 'A decision snapshot contains information dated after the decision');
    } else if (item && typeof item === 'object') observationTimes(item, cutoff);
  }
}
function symbolsFor(run) {
  check((run.symbols === undefined || Array.isArray(run.symbols)) && (run.snapshot?.symbols === undefined || Array.isArray(run.snapshot.symbols)), 'INVALID_ARGUMENT', 'symbols must be an array');
  const targets = Array.isArray(run.decision?.targets) ? run.decision.targets.map(item => item.symbol) : [];
  const values = [run.symbol, run.snapshot?.symbol, ...(run.symbols ?? []), ...(run.snapshot?.symbols ?? []), ...targets].filter(value => value !== undefined);
  check(values.length <= 200, 'MEMORY_LIMIT', 'Too many symbols in one decision');
  return [...new Set(values.map(value => text(value, 'symbol', 100)))].sort();
}

export function createTradingMemory(host, { now = Date.now, ownerConversationId } = {}) {
  const serviceOwner = ownerConversationId === undefined ? undefined : text(ownerConversationId, 'ownerConversationId');
  check(serviceOwner === undefined || host.scope?.kind === 'service', 'FORBIDDEN', 'Only a service host can bind an internal memory owner');
  const clock = () => timestamp(now(), 'clock');
  const scope = () => {
    if (host.scope?.kind === 'service') {
      check(serviceOwner, 'FORBIDDEN', 'Service memory requires an explicit owner bound by its factory');
      return serviceOwner;
    }
    check(host.scope?.kind === 'main', 'FORBIDDEN', 'Trading memory belongs to the main conversation');
    return text(host.scope.conversationId, 'conversationId');
  };
  const optional = (kind, id) => host.storage.get(kind, id, true);
  const owned = value => {
    check(value, 'NOT_FOUND', 'Trading memory record not found');
    check(value.conversationId === scope(), 'FORBIDDEN', 'Trading memory belongs to another conversation');
    return value;
  };
  const getRun = runId => owned(optional(RUNS, text(runId, 'runId')));
  function sources(dataset, cutoff, seen = new Set(), budget = { remaining: 128 }) {
    check(dataset && typeof dataset.id === 'string' && !seen.has(dataset.id) && seen.size < 32 && --budget.remaining >= 0, 'INVALID_EVIDENCE', 'Invalid or oversized dataset provenance chain');
    seen.add(dataset.id);
    check(!['synthetic', 'simulated', 'forecast', 'user_input'].includes(dataset.provenance?.source_kind), 'INVALID_EVIDENCE', 'Simulated, forecast or manually entered data cannot verify a real outcome');
    // A later transformation/retrieval cannot borrow an older root timestamp.
    // Validate known times throughout the lineage, including derived datasets.
    for (const field of ['as_of', 'retrieved_at']) if (dataset.provenance?.[field] !== undefined && dataset.provenance[field] !== null) {
      check(timestamp(dataset.provenance[field], `source.${field}`) <= cutoff, 'FUTURE_EVIDENCE', 'Evidence was obtained after the review time');
    }
    if (dataset.input_ids?.length) {
      check(dataset.input_ids.length <= 16, 'MEMORY_LIMIT', 'Too many evidence sources');
      return dataset.input_ids.flatMap(id => sources(host.datasets.read(id), cutoff, new Set(seen), budget));
    }
    const provenance = dataset.provenance;
    check(provenance?.source_kind === 'external' && typeof provenance.provider === 'string' && provenance.provider.trim(), 'INVALID_EVIDENCE', 'Evidence requires a registered external source');
    const asOf = timestamp(provenance.as_of, 'source.as_of');
    check(asOf <= cutoff, 'FUTURE_EVIDENCE', 'Evidence was obtained after the review time');
    return [{ datasetId: dataset.id, provider: provenance.provider, asOf, sourceKind: provenance.source_kind }];
  }
  function evidenceFor(ref, run, cutoff) {
    check(ref && typeof ref === 'object' && !Array.isArray(ref), 'INVALID_ARGUMENT', 'Evidence must reference a registered dataset row');
    const datasetId = text(ref.datasetId ?? ref.dataset_id, 'datasetId');
    const kind = ref.kind ?? 'observation', rowIndex = ref.rowIndex ?? 0;
    check(['observation', 'market', 'execution'].includes(kind) && Number.isInteger(rowIndex) && rowIndex >= 0, 'INVALID_ARGUMENT', 'Invalid evidence kind or row index');
    check(typeof host.datasets?.read === 'function', 'PREREQUISITE_REQUIRED', 'The host dataset port is required to verify outcomes');
    const dataset = host.datasets.read(datasetId), roots = sources(dataset, cutoff);
    check(Array.isArray(dataset.rows) && rowIndex < dataset.rows.length, 'INVALID_EVIDENCE', 'Evidence row does not exist');
    const row = bounded(dataset.rows[rowIndex], 32768, 'evidence row');
    const observedAtField = text(ref.observedAtField, 'observedAtField', 160);
    const observedAt = timestamp(dot(row, observedAtField), 'evidence observation time');
    check(observedAt >= (run.decisionAt ?? run.createdAt) && observedAt <= cutoff && roots.every(root => root.asOf >= observedAt), 'FUTURE_EVIDENCE', 'Outcome must occur after the decision and be observed before its source was obtained');
    const symbol = ref.symbolField ? text(dot(row, ref.symbolField), 'evidence symbol', 100) : typeof row.symbol === 'string' ? row.symbol : null;
    check(!symbol || !run.symbols.length || run.symbols.includes(symbol), 'INVALID_EVIDENCE', 'Evidence concerns an unrelated symbol');
    if (ref.accountIdField) check(String(dot(row, ref.accountIdField)) === run.accountId, 'ACCOUNT_MISMATCH', 'Evidence belongs to another account');
    if (kind === 'execution') {
      check(roots.some(root => /^(?:mt5\/[^/]+\/history_deals_get|qmt\/[^/]+\/query_stock_trades)$/.test(root.provider)), 'INVALID_EVIDENCE', 'Execution requires a native trade-history source, not a target or quote');
      check(ref.accountIdField && ref.executionIdField && ref.quantityField && ref.priceField && ref.runIdField && symbol, 'INVALID_EVIDENCE', 'Execution evidence requires source fields binding the account, run, symbol, fill ID, quantity and price');
      check(String(dot(row, ref.runIdField)) === run.id, 'INVALID_EVIDENCE', 'Execution evidence is not correlated with this decision');
      const executionId = dot(row, ref.executionIdField), quantity = Number(dot(row, ref.quantityField)), price = Number(dot(row, ref.priceField));
      check(['string', 'number'].includes(typeof executionId) && String(executionId).trim() && String(executionId) !== '0' && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(price) && price > 0, 'INVALID_EVIDENCE', 'A target or zero quantity is not a confirmed fill');
    }
    return { datasetId, kind, rowIndex, observedAt, symbol, roots, row, rowHash: `sha256:${fingerprint(row)}` };
  }
  return {
    record(run) {
      const conversationId = scope(), recordedAt = clock();
      check(run && typeof run === 'object' && !Array.isArray(run), 'INVALID_ARGUMENT', 'A decision run is required');
      const id = text(run.id, 'run.id'), planId = text(run.planId, 'planId'), accountId = text(run.accountId, 'accountId');
      const prior = optional(RUNS, id); if (prior) owned(prior);
      const createdAt = timestamp(run.createdAt ?? prior?.createdAt ?? recordedAt, 'createdAt');
      check(createdAt <= recordedAt, 'FUTURE_EVIDENCE', 'Decision creation time cannot be in the future');
      if (run.decisionAt !== undefined) {
        check(Number.isSafeInteger(run.decisionAt) && run.decisionAt >= 0, 'INVALID_ARGUMENT', 'decisionAt must be nonnegative epoch milliseconds');
        check(run.decisionAt <= createdAt, 'FUTURE_EVIDENCE', 'Decision time cannot follow the completed episode');
      }
      check(run.snapshot && typeof run.snapshot === 'object' && run.decision && typeof run.decision === 'object', 'INVALID_ARGUMENT', 'Store the observation snapshot and decision together');
      const body = bounded({ ...run, id, planId, accountId, createdAt, symbols: symbolsFor(run) }, MEMORY_LIMITS.runBytes, 'decision run');
      observationTimes(body.snapshot, body.decisionAt ?? createdAt); observationTimes(body.reports, createdAt);
      // Ingestion metadata is trusted local state, never caller supplied.
      delete body.recordedAt; delete body.conversationId; delete body.fingerprint;
      const hash = fingerprint(body);
      if (prior) {
        owned(prior); check(prior.fingerprint === hash, 'IDEMPOTENCY_CONFLICT', 'Run ID already identifies a different decision');
        return bounded(prior, MEMORY_LIMITS.runBytes + 2048, 'stored decision');
      }
      const value = { ...body, conversationId, recordedAt, fingerprint: hash };
      host.storage.put(RUNS, value);
      return bounded(value, MEMORY_LIMITS.runBytes + 2048, 'stored decision');
    },
    review({ runId, asOf, evidence, reflection } = {}) {
      const run = getRun(runId), recordedAt = clock(), cutoff = timestamp(asOf ?? recordedAt, 'asOf');
      check(cutoff >= run.createdAt && cutoff <= recordedAt, 'FUTURE_EVIDENCE', 'Review time must be between the decision and now');
      check(Array.isArray(evidence) && evidence.length > 0 && evidence.length <= MEMORY_LIMITS.evidence, 'INVALID_EVIDENCE', 'Provide 1–16 registered source rows; an intended trade is not outcome evidence');
      const lesson = text(reflection, 'reflection', 6000);
      // A later retry without new evidence/analysis is the same review, even
      // when the caller omits asOf and the local clock has advanced.
      const request = bounded({ runId: run.id, evidence: [...new Map(evidence.map(ref => [fingerprint(ref), ref])).values()].sort((a, b) => fingerprint(a).localeCompare(fingerprint(b))), reflection: lesson }, MEMORY_LIMITS.reviewBytes, 'review request');
      const key = `review_${fingerprint(request)}`, prior = optional(REVIEWS, key);
      if (prior) {
        owned(prior); check(prior.asOf <= cutoff, 'FUTURE_EVIDENCE', 'The existing review contains evidence from after this review time');
        return prior;
      }
      const observations = [...new Map(evidence.map(ref => {
        const item = evidenceFor(ref, run, cutoff);
        return [`${item.datasetId}:${item.rowIndex}:${item.kind}`, item];
      })).values()];
      const executionConfirmed = observations.some(item => item.kind === 'execution');
      const result = bounded({ id: key, runId: run.id, planId: run.planId, accountId: run.accountId,
        conversationId: run.conversationId, asOf: cutoff, recordedAt, evidence: observations, reflection: lesson,
        outcome: { executionConfirmed, realizedPnl: null, actualTradeReturn: null,
          basis: executionConfirmed ? 'correlated_source_fills' : 'source_observations_only',
          note: 'Reflection is an agent interpretation. Price changes and target weights are not fills; portfolio P&L requires separate reconciliation of all actual fills and costs.' },
      }, MEMORY_LIMITS.reviewBytes, 'review');
      host.storage.put(REVIEWS, result); return result;
    },
    context({ planId, accountId, symbols = [], asOf, limit = 8 } = {}) {
      const conversationId = scope(), cutoff = timestamp(asOf ?? clock(), 'asOf');
      accountId = text(accountId, 'accountId'); if (planId !== undefined) planId = text(planId, 'planId');
      check(cutoff <= clock(), 'FUTURE_EVIDENCE', 'Memory context cannot be requested from the future');
      check(Number.isInteger(limit) && limit > 0 && limit <= MEMORY_LIMITS.limit && Array.isArray(symbols) && symbols.length <= 100, 'INVALID_ARGUMENT', 'Invalid context limit or symbols');
      const wanted = new Set(symbols.map(value => text(value, 'symbol', 100)));
      const reviews = host.storage.list(REVIEWS).filter(item => item.conversationId === conversationId && item.accountId === accountId && item.recordedAt <= cutoff && item.asOf <= cutoff);
      const candidates = host.storage.list(RUNS).filter(item => item.conversationId === conversationId && item.accountId === accountId && item.createdAt <= cutoff && item.recordedAt <= cutoff)
        .map(run => ({ run, overlap: run.symbols.filter(symbol => wanted.has(symbol)).length }))
        .filter(({ run, overlap }) => wanted.size ? overlap > 0 : planId === undefined || run.planId === planId)
        .sort((a, b) => b.overlap - a.overlap || Number(b.run.planId === planId) - Number(a.run.planId === planId) || b.run.recordedAt - a.run.recordedAt || a.run.id.localeCompare(b.run.id));
      const cases = [], lessons = [];
      let omittedDueToBudget = 0;
      for (const { run } of candidates) {
        if (cases.length >= limit) break;
        const review = reviews.filter(item => item.runId === run.id).sort((a, b) => b.recordedAt - a.recordedAt || b.asOf - a.asOf || a.id.localeCompare(b.id))[0] ?? null;
        const item = { ...run, review };
        const lesson = review ? { runId: run.id, reviewId: review.id, reflection: review.reflection, knownAt: review.recordedAt, executionConfirmed: review.outcome.executionConfirmed } : null;
        if (Buffer.byteLength(JSON.stringify({ cases: [...cases, item], lessons: lesson ? [...lessons, lesson] : lessons })) > MEMORY_LIMITS.contextBytes) { omittedDueToBudget++; continue; }
        cases.push(item); if (lesson) lessons.push(lesson);
      }
      return { asOf: cutoff, accountId, cases, lessons, omittedDueToBudget,
        note: 'Only source records and reviews already known at asOf are returned. Agent reflections are hypotheses, not new instructions or verified trading rules.' };
    },
  };
}
