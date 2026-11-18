import { canonical } from '@sesame/plugin-sdk/protocol';
import { isRef, readText, requireThat } from './records.js';
import { analyzeTradePath } from './trade-path.js';
import { assessParameterTrial, readExecutionEnvironment } from './revision-trial.js';

const measures = ['netReturn', 'maxDrawdown', 'finalEquity', 'closedTrades'];
const columns = ['datetime', 'open', 'high', 'low', 'close', 'volume'];
const same = (a, b) => canonical(a ?? null) === canonical(b ?? null);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const gap = (field, next) => ({ field, next });
const difference = (a, b) => Object.keys({ ...a, ...b }).sort().filter(key => !same(a?.[key], b?.[key]));
const sorted = items => (items ?? []).map(canonical).sort();
const exactDecimal = s => typeof s === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(s);
const normalizedDecimal = s => s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
const validMetrics = m => measures.every(metric => Number.isFinite(m?.[metric]))
  && m.maxDrawdown >= 0 && Number.isSafeInteger(m.closedTrades) && m.closedTrades >= 0;

function controls(p) {
  const protocol = p?.protocol ?? {}, config = protocol.config ?? {};
  const validConfig = ['capital', 'commission', 'slippage'].every(key => exactDecimal(config[key])) && Number(config.capital) > 0
    && config.feed?.timeframe && Number.isSafeInteger(config.feed.compression) && config.feed.compression > 0;
  return {
    mandate: p?.mandateRef ?? null, development: protocol.development ?? null, backend: protocol.backend ?? null,
    config: validConfig ? { ...config, ...Object.fromEntries(['capital', 'commission', 'slippage'].map(key => [key, normalizedDecimal(config[key])])) } : null,
    objective: protocol.objective ?? null, constraints: sorted(protocol.constraints), selection: protocol.selection ?? { method: 'point_best' },
    columns: Object.fromEntries(columns.map(name => [name, protocol.columns?.[name] ?? name])),
  };
}

function developmentArm(p) {
  const experiment = p?.experiment, best = experiment?.best, control = controls(p), counts = experiment?.counts;
  const gaps = [];
  if (!isRef(control.mandate, 'resource')) gaps.push(gap('mandateRef', 'Pin the applicable research mandate.'));
  if (!isRef(control.development, 'data')) gaps.push(gap('development', 'Pin the exact development partition.'));
  if (!control.backend || !control.config || !measures.includes(control.objective?.metric) || !['minimize', 'maximize'].includes(control.objective.direction))
    gaps.push(gap('protocol', 'Record the native backend, feed, capital, commission, slippage and objective.'));
  if (!isRef(experiment?.protocolRef, 'resource') || !isRef(experiment?.selectionRef, 'resource') || !isRef(best?.batchResultRef, 'strategy.result')
    || !record(best?.parameters) || !validMetrics(best?.metrics) || !(counts?.planned > 0 && counts.planned === counts.completed && counts.eligible > 0))
    gaps.push(gap('nativeSelection', 'Complete the development trials and freeze an eligible native result and selection.'));
  if (gaps.length) return { status: 'needs_evidence', gaps };
  return {
    status: 'observed', version: p.version, protocolRef: experiment.protocolRef, selectionRef: experiment.selectionRef,
    nativeResultRef: best.batchResultRef, developmentRef: control.development, parameters: best.parameters, metrics: best.metrics,
    objective: control.objective, plannedTrials: counts.planned,
  };
}

function designDifferences(a, b) {
  const left = a.structure ?? {}, right = b.structure ?? {};
  const changes = difference(left.components, right.components).map(name => 'component.' + name);
  if (left.mode !== right.mode) changes.push('architecture');
  changes.push(...difference(left.bindings, right.bindings).map(name => 'binding.' + name));
  // Ignore ordering of independent uses, count each changed factor role separately.
  const factorUses = s => Object.groupBy(s.factors ?? [], f => JSON.stringify([f.factorId ?? null, f.purpose ?? null]));
  const leftUses = factorUses(left), rightUses = factorUses(right);
  for (const key of new Set([...Object.keys(leftUses), ...Object.keys(rightUses)])) {
    if (!same(sorted(leftUses[key]), sorted(rightUses[key]))) changes.push('factor.' + key);
  }
  return changes;
}

function comparePair(a, b, from, to, retuned) {
  if (from.status !== 'observed' || to.status !== 'observed') return { status: 'needs_evidence' };
  const left = controls(a), right = controls(b);
  const trial = !retuned ? assessParameterTrial(a, b) : null;
  const mismatch = difference(left, right).filter(key => key !== 'selection' || !(retuned || trial));
  if (!retuned && !trial) {
    if (!same(a.protocol.parameters ?? {}, b.protocol.parameters ?? {})) mismatch.push('fixedParameters');
    if (!same(from.parameters, to.parameters)) mismatch.push('selectedParameters');
    if (!same(a.protocol.parameter_space, b.protocol.parameter_space)) mismatch.push('searchSpace');
  }
  if (trial && !trial.verified) mismatch.push('parameterTrial');
  if (mismatch.length) {
    const missingEnvironment = mismatch.length === 1 && trial?.issues.length === 1 && trial.environment.status === 'needs_evidence';
    return { status: missingEnvironment ? 'needs_evidence' : 'not_comparable', mismatch, ...(trial ? { trial } : {}),
      next: missingEnvironment ? 'Recover the pinned Backtrader environment receipts for the baseline and candidate.' : 'Repeat both development runs under matching controls.' };
  }
  const changes = designDifferences(a, b);
  const leftNative = a.implementation, rightNative = b.implementation;
  const nativeChanged = [leftNative?.nativeHash, rightNative?.nativeHash].every(h => typeof h === 'string' && /^sha256:[a-f0-9]{64}$/.test(h))
    ? leftNative.nativeHash !== rightNative.nativeHash
    : isRef(leftNative?.nativeSourceRef) && same(leftNative.nativeSourceRef, rightNative?.nativeSourceRef) ? false : null;
  let attribution = 'multiple_changes';
  if (trial?.verified) attribution = trial.alreadyTestedOnBaselineGrid === true ? 'previously_tested_parameter_change'
    : trial.alreadyTestedOnBaselineGrid === false ? 'predeclared_parameter_change' : 'parameter_change_prior_grid_unknown';
  else if (retuned) attribution = 'retuned_system';
  else if (!changes.length) attribution = nativeChanged ? 'unassigned_implementation_change' : 'no_declared_design_change';
  else if (nativeChanged !== true) attribution = 'native_change_unverified';
  else if (changes.length === 1) attribution = 'single_declared_change';
  const delta = Object.fromEntries(measures.map(metric => [metric, to.metrics[metric] - from.metrics[metric]]));
  const objectiveChange = delta[from.objective.metric] * (from.objective.direction === 'maximize' ? 1 : -1);
  const prior = from.tradePath?.activity, current = to.tradePath?.activity;
  const executionDelta = prior?.status === 'observed' && current?.status === 'observed'
    ? Object.fromEntries(['grossTradedNotional', 'commission', 'turnoverOnInitialEquity', 'turnoverOnAverageEquity'].map(key =>
      [key, Number.isFinite(prior[key]) && Number.isFinite(current[key]) ? current[key] - prior[key] : null])) : null;
  return { status: 'compared', changes, attribution, nativeSourceChanged: nativeChanged, delta, executionDelta,
    ...(trial ? { trial } : {}), selectionMethods: { from: left.selection, to: right.selection, changed: !same(left.selection, right.selection) },
    objective: { ...from.objective, from: from.metrics[from.objective.metric], to: to.metrics[from.objective.metric],
      outcome: objectiveChange === 0 ? 'unchanged' : objectiveChange > 0 ? 'improved' : 'declined' },
    searchSpaceChanged: !same(a.protocol.parameter_space, b.protocol.parameter_space),
    budgetChanged: a.protocol.max_trials !== b.protocol.max_trials, repeatedSelection: same(from.selectionRef, to.selectionRef),
  };
}

// Materialize only the winning native development pass. A backtest-local tradeId
// is not a cross-run signal identity. Order times supply a descriptive alignment.
async function readRows(host, ref, signal) {
  const { content } = await host.resources.read(ref, { part: 'manifest' });
  requireThat(content?.format === 'json-rows' && typeof content.path === 'string', 'Invalid fixed table format.');
  const rows = JSON.parse(await readText(host, ref, content.path, 32 * 1024 * 1024));
  signal?.throwIfAborted();
  requireThat(Array.isArray(rows) && rows.length === content.rowCount, 'Incomplete fixed table.');
  return rows;
}

export async function loadTradeEvidence(host, project, signal, page) {
  const arm = developmentArm(project);
  if (arm.status !== 'observed') return { status: 'unavailable', reason: 'missing_development_selection' };
  let environment;
  try {
    signal?.throwIfAborted();
    const ref = arm.nativeResultRef;
    const [manifest, metadata] = await Promise.all([host.resources.read(ref, { part: 'manifest' }), host.resources.read(ref, { part: 'metadata' })]);
    const r = manifest.content;
    const pinned = dep => manifest.dependencies?.some(item => same(item, dep));
    requireThat(metadata.producer?.id === 'sesame/backtrader' && same(metadata.ref, ref)
      && r?.status === 'completed' && same(r.inputs, [arm.developmentRef]), 'Expected a completed native development receipt.');
    environment = await readExecutionEnvironment(host, manifest, ref, signal);
    const fixed = record(project.protocol.parameter_space) && Object.keys(project.protocol.parameter_space).length === 0;
    if (fixed) {
      requireThat(arm.plannedTrials === 1 && !r.optimizer && isRef(r.assumptions, 'resource') && pinned(r.assumptions), 'Missing fixed native baseline inputs.');
      const { content: inputs } = await host.resources.read(r.assumptions, { part: 'manifest' });
      requireThat(inputs?.type === 'backtrader-inputs' && same(inputs.data, arm.developmentRef) && same(inputs.parameters, arm.parameters)
        && same(inputs.nativeSource, r.nativeSource) && r.statistics?.finalEquity != null
        && Number(r.statistics.finalEquity) === arm.metrics.finalEquity && r.statistics.closedTrades === arm.metrics.closedTrades, 'The fixed baseline differs from the selected native result.');
    } else {
      requireThat(r.optimizer?.native === true && r.optimizer.method === 'Cerebro.optstrategy', 'Expected a native optimization receipt for a parameter grid.');
    }
    const tableRef = r.data?.find(item => item.id === (fixed ? 'trades' : 'passes'))?.ref;
    requireThat(isRef(tableRef, 'data') && pinned(tableRef), 'Missing pinned native trade evidence table.');
    const rows = await readRows(host, tableRef, signal);
    let trades = rows, orders, equity;
    const sourceRefs = [ref, tableRef, arm.developmentRef], readGaps = [];
    async function optionalTable(name, key) {
      try {
        requireThat(isRef(key, 'data') && (name === 'development' || pinned(key)), 'Missing pinned ' + name + ' table.');
        const values = await readRows(host, key, signal);
        if (name !== 'development') sourceRefs.push(key);
        return values;
      } catch (error) {
        signal?.throwIfAborted();
        readGaps.push({ table: name, reason: error.message });
        return null;
      }
    }
    if (!fixed) {
      const matches = rows.filter(pass => pass.status === 'completed' && same(pass.parameters, arm.parameters));
      requireThat(matches.length === 1 && matches[0].statistics?.finalEquity != null && Number(matches[0].statistics.finalEquity) === arm.metrics.finalEquity, 'Could not identify the selected native pass.');
      trades = matches[0].trades;
      orders = matches[0].orders;
      equity = matches[0].equity;
    } else {
      const refFor = name => r.data?.find(item => item.id === name)?.ref;
      orders = await optionalTable('orders', refFor('orders'));
      equity = await optionalTable('equity', refFor('equity'));
    }
    requireThat(Array.isArray(trades) && trades.length === arm.metrics.closedTrades, 'Incomplete native closed-trade ledger.');
    const amount = raw => (typeof raw === 'number' || typeof raw === 'string' && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw))
      && Number.isFinite(Number(raw)) ? Number(raw) : null;
    const time = raw => typeof raw === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(raw) && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
    const closed = trades.map(trade => ({ tradeId: trade?.tradeId ?? null, openTime: time(trade?.openTime), closeTime: time(trade?.closeTime),
      gross: amount(trade?.pnl), net: amount(trade?.pnlAfterCommission) }));
    const development = Array.isArray(orders) || Array.isArray(equity) ? await optionalTable('development', arm.developmentRef) : null;
    const tradePath = analyzeTradePath({ trades: closed, orders, equity, development, columns: project.protocol.columns, initialCapital: project.protocol.config.capital,
      finalEquity: arm.metrics.finalEquity, currency: project.mandate?.fields?.capital?.currency ?? null, sourceRefs, readGaps }, page);
    return { status: 'observed', nativeResultRef: ref, tableRef, parameters: arm.parameters, closed, tradePath, environment };
  } catch (error) {
    signal?.throwIfAborted();
    return { status: 'unavailable', reason: error.message, ...(environment ? { environment } : {}) };
  }
}

function opportunityCost(a, b, comparison) {
  const result = { status: 'needs_trade_evidence', confirmedFilteredLosses: null, confirmedMissedProfits: null,
    next: 'Record the same entry opportunity ID, observation and availability time, filter decision and subsequent fills for both variants.' };
  const valid = p => p.tradeEvidence?.status === 'observed' && isRef(p.tradeEvidence.tableRef, 'data')
    && same(p.tradeEvidence.nativeResultRef, p.experiment.best.batchResultRef)
    && same(p.tradeEvidence.parameters, p.experiment.best.parameters) && p.tradeEvidence.closed.length === p.experiment.best.metrics.closedTrades;
  if (comparison.status !== 'compared' || !valid(a) || !valid(b)) return result;
  const left = a.tradeEvidence.closed, right = b.tradeEvidence.closed, entries = new Set(right.map(t => t.openTime));
  if (![...left, ...right].every(t => t.openTime && t.closeTime && t.openTime <= t.closeTime && Number.isFinite(t.net)))
    return { ...result, status: 'incomplete_trade_times_or_net_pnl' };
  if (entries.size !== right.length || new Set(left.map(t => t.openTime)).size !== left.length) return { ...result, status: 'ambiguous_entry_times' };
  const baselineOnly = left.filter(trade => !entries.has(trade.openTime));
  return { ...result, status: 'observed_entry_time_difference', alignedBy: 'single-feed UTC entry bar of closed trades',
    currency: a.mandate?.fields?.capital?.currency ?? null,
    matchedEntries: left.length - baselineOnly.length, baselineOnlyLosses: baselineOnly.filter(t => t.net < 0).length,
    baselineOnlyProfits: baselineOnly.filter(t => t.net > 0).length, baselineOnlyFlat: baselineOnly.filter(t => t.net === 0).length,
    baselineOnlyNetPnl: baselineOnly.reduce((n, t) => n + t.net, 0), sourceRefs: [a.tradeEvidence.tableRef, b.tradeEvidence.tableRef] };
}

export function compareProjects({ baseline, candidate, matched, ablation, retuned = false }) {
  const projects = { A: baseline, B: candidate, C: matched, D: ablation }, arms = {};
  for (const [name, p] of Object.entries(projects)) {
    const arm = p ? developmentArm(p) : { status: 'not_supplied' };
    if (arm.status === 'observed' && p.tradeEvidence?.status === 'observed' && p.tradeEvidence.tradePath
      && same(p.tradeEvidence.nativeResultRef, arm.nativeResultRef) && same(p.tradeEvidence.parameters, arm.parameters)) {
      const { trades, page, ...summary } = p.tradeEvidence.tradePath;
      arm.tradePath = summary;
    }
    arms[name] = arm;
  }
  const ab = comparePair(baseline, candidate, arms.A, arms.B, retuned), comparisons = { candidateMinusBaseline: ab };
  const gaps = [];
  for (const [key, name] of [['C', 'candidateMinusMatched'], ['D', 'candidateMinusAblation']]) {
    const control = projects[key];
    if (!control) { gaps.push(gap(key, key === 'C' ? 'Add a control matched on trade count, holding time or exposure when attribution requires it.' : 'Run the candidate with the suspect component disabled.')); continue; }
    const delta = comparePair(control, candidate, arms[key], arms.B, retuned);
    comparisons[name] = delta;
    if (delta.status === 'compared' && key === 'C') {
      delta.matchedOnClosedTradeCount = arms.C.metrics.closedTrades === arms.B.metrics.closedTrades;
      delta.exposureMatchVerified = false;
      if (!delta.matchedOnClosedTradeCount) gaps.push(gap('C.match', 'The closed-trade counts differ. Verify the predeclared exposure or holding-time match before interpreting this control.'));
    }
    if (delta.status === 'compared' && key === 'D' && ab.status === 'compared') {
      delta.restoresBaselineDesign = ab.changes.length > 0 && !designDifferences(baseline, control).length;
      if (!delta.restoresBaselineDesign) gaps.push(gap('D.design', 'Verify which component D disables and inspect its remaining differences from the baseline.'));
    }
    if (delta.repeatedSelection) gaps.push(gap(key, 'A reused selection is the same observation; run the stated control or ablation independently.'));
  }
  const selection = retuned ? 'separately_retuned' : ab.trial ? ab.attribution ?? 'parameter_change_unverified' : 'same_parameters';
  return { status: ab.status, partition: 'development', selection,
    arms, comparisons, opportunityCost: opportunityCost(baseline, candidate, ab), gaps };
}

export function diagnoseProject(project) {
  const findings = [], checks = [], add = (code, observed, component, next, evidence = []) => findings.push({ code, observed, component, next, evidence });
  const e = project.experiment, arm = developmentArm(project);
  const t = project.tradeEvidence;
  const tradePath = arm.status === 'observed' && t?.status === 'observed' && same(t.nativeResultRef, arm.nativeResultRef) && same(t.parameters, arm.parameters) ? t.tradePath : null;
  if (project.mandate?.questions?.length) add('mandate_conflict', project.mandate.questions, 'mandate', 'Resolve the conflicting explicit terms before selecting a candidate.');
  if (arm.status !== 'observed') {
    for (const item of e?.gaps ?? []) add(item.code ?? 'backend_gap', item.message, 'native_backtest', item.next ?? 'Inspect the original native receipt and rerun the affected development step.');
    if (!findings.length) add('missing_native_baseline', arm.gaps, 'implementation', 'Build the complete baseline and run it on a fixed development partition.');
  } else {
    const m = arm.metrics, refs = [arm.nativeResultRef];
    if (m.closedTrades === 0) add('no_closed_trades', { closedTrades: 0 }, 'execution', 'Trace bar warm-up, eligible signals, filter vetoes, submitted orders, fills and open positions in that order.', refs);
    if (m.netReturn < 0) add('negative_net_return', { netReturn: m.netReturn }, 'implementation', 'Split closed-trade gross P&L, commission, remaining positions and execution timing before changing the signal.', refs);
    if (t?.status === 'observed' && same(t.nativeResultRef, arm.nativeResultRef) && same(t.parameters, arm.parameters) && t.closed.length === m.closedTrades
      && t.closed.every(row => Number.isFinite(row.gross) && Number.isFinite(row.net))) {
      const gross = t.closed.reduce((sum, tr) => sum + tr.gross, 0), net = t.closed.reduce((sum, tr) => sum + tr.net, 0);
      if (gross > 0 && net < 0) add('closed_trade_cost_drag', { gross, netAfterCommission: net }, 'execution', 'Compare one turnover or no-trade-buffer change with frozen Alpha, risk and base fees. Stress the cost model separately.', [t.tableRef]);
    }
    if (tradePath?.favorableThenExitedWithoutGrossGain > 0) {
      add('observed_favorable_move_given_back', { count: tradePath.favorableThenExitedWithoutGrossGain, measuredClosedTrades: tradePath.coverage.measured },
        project.structure?.components?.stateMachine ? 'stateMachine' : 'portfolio',
        'Test one predeclared exit or target-reduction rule with the same entries, sizing, development data and costs. Compare net return and drawdown; use recorded MFE only to identify the exit hypothesis.',
        tradePath.sourceRefs);
    }
    if (tradePath?.coverage.unavailable) checks.push('Resolve order/trade association gaps before interpreting per-trade excursions. Inspect signed fill history and trade tracking IDs for overlapping or scaled positions.');
    if (tradePath?.coverage.fillsOnly) checks.push('Recover the intervening OHLC bars on the frozen development feed to refine the fill-only lower bounds.');
    if (tradePath?.coverage.reasons.missing_interior_extrema) checks.push('Recover missing high and low values in the frozen interior bars before estimating full-period excursion bounds.');
    const limit = project.mandate?.fields?.maxDrawdown;
    if (Number.isFinite(limit) && m.maxDrawdown > limit) add('development_drawdown_breach', { maxDrawdown: m.maxDrawdown, limit }, 'risk', 'Trace concentration and exposure at the drawdown before revising sizing or risk rules.', refs);
    if (arm.plannedTrials > 1) checks.push('Compare adjacent parameter values and subperiods on development data; keep all attempted trials and the predeclared objective.');
    const h = e.holdout;
    if (isRef(h?.resultRef, 'strategy.result') && isRef(h.recordRef, 'resource') && validMetrics(h.metrics)
      && (h.status === 'completed' && e.status === 'completed' || h.status === 'constraints-failed' && e.status === 'failed')) {
      if (h.status === 'constraints-failed' || m.netReturn > 0 && h.metrics.netReturn < 0)
        add('holdout_deterioration', { status: h.status, developmentNetReturn: m.netReturn, holdoutNetReturn: h.metrics.netReturn, violations: h.violations ?? [] },
          'validation', 'Archive the consumed holdout. Diagnose leakage, regime dependence or costs and reserve fresh data for the next confirmation.', [arm.nativeResultRef, h.resultRef]);
    } else checks.push('Confirm frozen parameters once on an untouched chronological holdout.');
  }
  if (project.structure?.factors?.length) checks.push('Check the consumed feature against its fixed definition at decision time. Use development trades for marginal contribution.');
  if (project.structure?.components?.alpha?.model === 'moving_average') checks.push('Compare warm-up histories at identical timestamps and replay with future bars withheld.');
  for (const item of project.structure?.gaps ?? []) checks.push(item.next);
  const priority = ['mandate_conflict', 'holdout_deterioration', 'development_drawdown_breach', 'closed_trade_cost_drag', 'no_closed_trades', 'observed_favorable_move_given_back'];
  const first = priority.map(code => findings.find(item => item.code === code)).find(Boolean) ?? findings[0];
  return { status: findings.length ? 'findings' : 'review', findings, checks: [...new Set(checks)], tradePath: tradePath ?? { status: 'unavailable', reason: t?.reason ?? 'missing_development_trade_evidence' },
    nextRevision: first ? { component: first.component, reason: first.code, next: first.next } : null };
}
