import { id, digest, requireValue, text, mean } from './support.js';

// Rule candidates and prospective scoring share the service's ledger and policy.
// Overlapping outcome intervals form one statistical block, even across assets.
// This is deliberately more conservative than counting repeated forecasts as IID.
export function independentBlocks(rows) {
  const sorted = [...rows].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const blocks = [];
  for (const row of sorted) {
    const last = blocks.at(-1), start = Date.parse(row.start), end = Date.parse(row.end);
    if (last && start <= last.end) { last.end = Math.max(last.end, end); last.values.push(row.improvement); }
    else blocks.push({ end, values: [row.improvement] });
  }
  return blocks.map(block => mean(block.values));
}

export function proposeRule(service, conversationId, args) {
  service.assertMain(conversationId);
  const rule = service.idempotent('rule', args.command_id, args, () => {
    for (const name of ['title', 'guideline', 'topic', 'regime', 'limitations']) text(args[name], name, name === 'guideline' ? 4000 : 2000);
    requireValue(Array.isArray(args.evidence_ids) && args.evidence_ids.length > 0 && args.evidence_ids.length <= 20, '候选准则需绑定 1–20 个已复盘判断');
    const evidenceIds = [...new Set(args.evidence_ids)];
    for (const key of evidenceIds) requireValue(service.get('prediction', key).status === 'resolved', '准则只能引用已复盘判断');
    if (args.parent_rule_id) service.get('rule', args.parent_rule_id);
    requireValue(service.list('rule').filter(rule => rule.status !== 'retired' && rule.topic === args.topic).length < 10, '同一主题最多保留 10 个在试准则；请先退休不再适用的准则');
    return service.put('rule', { id: id('criterion'), version: 1, title: args.title, guideline: args.guideline, topic: args.topic, regime: args.regime,
      limitations: args.limitations, evidence_ids: evidenceIds, parent_rule_id: args.parent_rule_id ?? null,
      created_at: service.now(), status: 'candidate', evaluation: null });
  });
  service.refreshFiles(); return rule;
}
export function ruleEvaluation(service, rule) {
  const allRules = service.list('rule');
  const family = allRules.length, trial = allRules.findIndex(item => item.id === rule.id) + 1;
  const predictions = service.list('prediction').filter(prediction => Date.parse(prediction.created_at) >= Date.parse(rule.created_at) &&
    !rule.evidence_ids.includes(prediction.id) && prediction.rule_predictions.some(shadow => shadow.rule_id === rule.id && shadow.rule_version === rule.version));
  const due = predictions.filter(item => Date.parse(item.due_at) <= Date.parse(service.now()));
  const resolved = due.filter(item => item.status === 'resolved');
  // Repeated versions of the same event never manufacture additional samples.
  const unique = [...new Map([...resolved].reverse().map(item => [item.event_key, item])).values()];
  const rows = unique.map(item => {
    const probability = item.rule_predictions.find(shadow => shadow.rule_id === rule.id).probability;
    const shadowLoss = (probability - item.review.evidence.outcome) ** 2;
    return { start: item.verification.window_start, end: item.due_at, improvement: item.review.brier - shadowLoss, baseline_improvement: item.review.baseline_brier - shadowLoss };
  });
  const blocks = independentBlocks(rows), improvement = mean(blocks), n = blocks.length;
  const baselineBlocks = independentBlocks(rows.map(row => ({ ...row, improvement: row.baseline_improvement }))), baselineImprovement = mean(baselineBlocks);
  const evidenceFingerprint = digest(JSON.stringify({ observations: unique.map(item => [item.id, item.review.id, item.review.brier, item.rule_predictions]), pending: due.filter(item => item.status !== 'resolved').map(item => item.id) }));
  const inspection = Math.max(1, (rule.evaluation?.inspection_index ?? 0) + (rule.evaluation?.evidence_fingerprint === evidenceFingerprint ? 0 : 1));
  // Allocate error across every candidate and every future inspection. The
  // telescoping 1/(k*(k+1)) weights prevent repeated peeking from reusing alpha.
  const alpha = service.policy.alpha / (2 * Math.max(1, trial) * (Math.max(1, trial) + 1) * inspection * (inspection + 1));
  // Hoeffding lower bound for paired improvements in [-1,1], adjusted for all
  // candidates and sample counts. These are conservative operational gates, not a
  // guarantee of future profitability or a test that proves market independence.
  const lower = n ? improvement - Math.sqrt(2 * Math.log(1 / alpha) / n) : null;
  const baselineLower = n ? baselineImprovement - Math.sqrt(2 * Math.log(1 / alpha) / n) : null;
  const windows = new Set(unique.map(item => item.due_at.slice(0, 10))).size;
  const pending = due.length - resolved.length;
  const accepted = n >= service.policy.min_samples && windows >= service.policy.min_windows && pending === 0 && lower > 0 && baselineLower > 0;
  return { evaluated_at: service.now(), registered: predictions.length, resolved: resolved.length, unresolved_due: pending,
    independent_blocks: n, calendar_windows: windows, candidate_trials: family, trial_index: trial,
    inspection_index: inspection, evidence_fingerprint: evidenceFingerprint, mean_brier_improvement: improvement,
    lower_bound: lower, mean_baseline_brier_improvement: baselineImprovement, baseline_lower_bound: baselineLower, adjusted_alpha: alpha, accepted,
    reason: accepted ? '前瞻影子样本同时超过主判断与事前基准的保守门槛；仍需观察适用条件与漂移' : pending ? '到期样本尚未全部核验，不能选择性跳过失败或缺失结果' : n < service.policy.min_samples || windows < service.policy.min_windows ? '前瞻独立样本或时间窗口不足' : '未同时证明相对同期主判断与事前基准的概率评分改善' };
}
export function evaluateRules(service) {
  let changed = false;
  for (const rule of service.list('rule')) {
    if (rule.status === 'retired') continue;
    const evaluation = service.ruleEvaluation(rule);
    const status = evaluation.accepted ? 'active' : rule.status === 'active' || rule.status === 'probation' ? 'probation' : 'candidate';
    if (status !== rule.status || rule.evaluation?.evidence_fingerprint !== evaluation.evidence_fingerprint) changed = true;
    if (status !== rule.status) service.put('rule_event', { id: id('rule_event'), rule_id: rule.id, from: rule.status, to: status, created_at: service.now(), evaluation });
    service.put('rule', { ...rule, status, evaluation });
  }
  return changed;
}
export function retireRule(service, conversationId, { rule_id, reason }) {
  service.assertMain(conversationId); const rule = service.get('rule', rule_id);
  const result = service.put('rule', { ...rule, status: 'retired', retired_at: service.now(), retirement_reason: text(reason, '退休原因', 2000) });
  service.refreshFiles(); return result;
}
