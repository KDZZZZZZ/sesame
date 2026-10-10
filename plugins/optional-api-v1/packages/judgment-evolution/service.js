import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, lstatSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { id, digest, requireValue, securePath } from './support.js';

export const JUDGMENT_PLUGIN = 'sesame/judgment-evolution';
export const JUDGMENT_POLICY = Object.freeze({ min_samples: 30, min_windows: 3, alpha: 0.05, retry_hours: 24 });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = (value, name, max = 4000) => { requireValue(typeof value === 'string' && value.trim() && value.length <= max, `${name} 需要 1–${max} 个字符`); return value.trim(); };
const probability = value => { requireValue(finite(value) && value >= 0 && value <= 1, '概率必须在 0–1 之间'); return value; };
const timestamp = value => {
  requireValue(typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), '时间必须包含日期、时间和时区');
  return new Date(value).toISOString();
};
const clone = value => JSON.parse(JSON.stringify(value));
const scalar = value => ['string', 'number', 'boolean'].includes(typeof value) && (typeof value !== 'number' || finite(value));
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const dot = (object, path) => {
  requireValue(typeof path === 'string' && /^[\w.-]{1,160}$/.test(path) && !path.split('.').some(p => ['__proto__', 'constructor', 'prototype'].includes(p)), '字段路径无效');
  return path.split('.').reduce((value, key) => value && Object.hasOwn(value, key) ? value[key] : undefined, object);
};

function sourceMatches(expected, actual) {
  if (expected === actual) return true;
  try {
    const wanted = new URL(expected), found = new URL(actual);
    return wanted.origin === found.origin && found.pathname === wanted.pathname && (!wanted.search || wanted.search === found.search);
  } catch { return false; }
}

function condition(actual, verification) {
  if (verification.op === 'eq') {
    if (typeof verification.target === 'number' && typeof actual === 'string' && actual.trim()) actual = Number(actual);
    requireValue(scalar(actual), '证据字段必须是标量');
    return actual === verification.target;
  }
  if (typeof actual === 'string' && actual.trim()) actual = Number(actual);
  requireValue(finite(actual), '证据字段不是有效数值');
  const target = verification.target;
  return verification.op === 'gt' ? actual > target : verification.op === 'gte' ? actual >= target : verification.op === 'lt' ? actual < target : verification.op === 'lte' ? actual <= target : actual >= target && actual <= verification.upper;
}

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

export class JudgmentService {
  constructor(host, { clock = () => new Date(), policy = {} } = {}) {
    this.host = host; this.clock = clock;
    this.policy = { ...JUDGMENT_POLICY, ...policy }; this.busy = false;
  }
  now() { return this.clock().toISOString(); }
  init() {
    const work = this.host.workspace.root('conv_main');
    this.directory = join(work, 'judgment');
    this.stateDirectory = this.host.storage.directory;
    for (const path of [this.stateDirectory, this.directory]) { mkdirSync(path, { recursive: true, mode: 0o700 }); requireValue(!lstatSync(path).isSymbolicLink(), '判断工作区不能是符号链接'); }
    const path = join(this.stateDirectory, 'judgments.sqlite');
    requireValue(!existsSync(path) || !lstatSync(path).isSymbolicLink(), '判断数据库不能是符号链接');
    this.db = new DatabaseSync(path); securePath(this.stateDirectory);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id));');
    this.refreshFiles(); return this;
  }
  get(kind, key, optional = false) {
    const row = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, key);
    requireValue(row || optional, '判断或准则不存在', 404, 'judgment_not_found');
    return row ? JSON.parse(row.body) : null;
  }
  list(kind) { return this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row => JSON.parse(row.body)); }
  put(kind, value) { this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, value.id, JSON.stringify(value)); return value; }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  assertMain(conversationId) { requireValue(this.host.tasks.read(conversationId).scope === 'main', '判断登记、复盘与准则管理仅供主 Agent 使用', 403); }
  enabled() { return !this.closed && this.host.plugins.isActive(JUDGMENT_PLUGIN, 'conv_main'); }
  fingerprint(args) { return digest(JSON.stringify(args)); }
  idempotent(kind, command, args, fn) {
    text(command, 'command_id', 128);
    const key = `${kind}:${command}`, old = this.get('command', key, true), fingerprint = this.fingerprint(args);
    if (old) { requireValue(old.fingerprint === fingerprint, 'command_id 已用于不同参数', 409); return this.get(kind, old.result_id); }
    return this.transaction(() => { const value = fn(); this.put('command', { id: key, fingerprint, result_id: value.id }); return value; });
  }
  record(conversationId, args) {
    this.assertMain(conversationId);
    const record = this.idempotent('prediction', args.command_id, args, () => {
      const created = this.now(), due = timestamp(args.due_at), verification = clone(args.verification);
      requireValue(Date.parse(due) > Date.parse(created), '必须在结果发生前登记未来判断；历史判断不能补录成前瞻样本');
      text(args.claim, '判断', 2000); text(args.topic, 'topic', 120); text(args.regime, 'regime', 120);
      text(args.rationale, '依据摘要', 4000); requireValue(verification && typeof verification === 'object', '需要明确的验证口径');
      verification.provider = text(verification.provider, '证据来源', 2048);
      dot({}, verification.metric); dot({}, verification.observed_at_field);
      requireValue(['eq', 'gt', 'gte', 'lt', 'lte', 'between'].includes(verification.op), '验证运算符无效');
      requireValue(scalar(verification.target) && (verification.op === 'eq' || finite(verification.target)), '验证目标无效');
      if (verification.op === 'between') requireValue(finite(verification.upper) && verification.upper >= verification.target, '范围上界无效');
      verification.window_start = timestamp(verification.window_start ?? due);
      requireValue(Date.parse(verification.window_start) >= Date.parse(created) && Date.parse(verification.window_start) <= Date.parse(due), '观察窗口必须完全位于登记之后、截止之前');
      verification.selector ??= {};
      requireValue(verification.selector && typeof verification.selector === 'object' && !Array.isArray(verification.selector) && Object.keys(verification.selector).length <= 12, 'selector 应为有界字段匹配对象');
      for (const [field, value] of Object.entries(verification.selector)) { dot({}, field); requireValue(scalar(value), 'selector 仅支持标量'); }
      const shadows = clone(args.rule_predictions ?? []);
      requireValue(Array.isArray(shadows) && shadows.length <= 10 && new Set(shadows.map(x => x.rule_id)).size === shadows.length, '影子准则最多 10 个且不可重复');
      const applicable = this.list('rule').filter(rule => rule.status !== 'retired' && rule.topic === args.topic && (rule.regime === '*' || rule.regime === args.regime));
      requireValue(applicable.every(rule => shadows.some(shadow => shadow.rule_id === rule.id)), '需为此主题和环境的每个未退休准则登记影子概率，不能选择性只测试有利判断');
      for (const shadow of shadows) {
        const rule = this.get('rule', shadow.rule_id); probability(shadow.probability);
        requireValue(rule.status !== 'retired' && rule.topic === args.topic && (rule.regime === '*' || rule.regime === args.regime), '准则不适用于本判断或已退休');
        shadow.rule_version = rule.version;
      }
      return this.put('prediction', { id: id('judgment'), version: 1, conversation_id: conversationId,
        source_message_id: this.host.tasks.read(conversationId).active_response_message_id ?? null,
        claim: args.claim.trim(), topic: args.topic, regime: args.regime, rationale: args.rationale.trim(),
        probability: probability(args.probability), baseline_probability: probability(args.baseline_probability ?? 0.5),
        verification, rule_predictions: shadows, created_at: created, due_at: due, status: 'pending',
        event_key: digest(JSON.stringify([verification.provider, verification.metric, verification.selector, verification.window_start, due])),
        next_review_at: due, review_attempts: 0 });
    });
    this.refreshFiles(); return record;
  }
  sources(dataset, seen = new Set()) {
    requireValue(!seen.has(dataset.id) && seen.size < 100, '证据来源链无效'); seen.add(dataset.id);
    requireValue(dataset.provenance?.source_kind !== 'synthetic', '合成数据不能核验真实判断');
    if (dataset.input_ids?.length) return dataset.input_ids.flatMap(key => this.sources(this.host.datasets.read(key), new Set(seen)));
    requireValue(dataset.provenance?.provider && dataset.provenance?.as_of, '证据缺少可核验来源和获取时间');
    return [{ dataset_id: dataset.id, ...dataset.provenance }];
  }
  evidence(prediction, datasetId) {
    const dataset = this.host.datasets.read(datasetId), roots = this.sources(dataset), spec = prediction.verification;
    requireValue(roots.some(source => sourceMatches(spec.provider, source.provider)), '证据不来自事前指定的来源');
    requireValue(roots.every(source => Date.parse(source.as_of) <= Date.parse(this.now())), '证据获取时间不能在未来');
    requireValue(roots.some(source => sourceMatches(spec.provider, source.provider) && Date.parse(source.as_of) >= Date.parse(spec.window_start)), '证据早于事前指定的观察窗口');
    requireValue(Array.isArray(dataset.rows), '证据不是可查询数据集');
    const candidates = dataset.rows.map((row, index) => ({ row, index, observed_at: dot(row, spec.observed_at_field) }))
      .filter(({ row, observed_at }) => typeof observed_at === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(observed_at) &&
        Date.parse(observed_at) >= Date.parse(spec.window_start) && Date.parse(observed_at) <= Date.parse(prediction.due_at) &&
        Object.entries(spec.selector).every(([key, value]) => dot(row, key) === value));
    requireValue(candidates.length, '证据没有匹配指定对象和观察窗口的数据');
    // Selection is fixed at registration: the latest observation within the window.
    candidates.sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
    const selected = candidates[0], value = dot(selected.row, spec.metric);
    const sameTime = candidates.filter(candidate => Date.parse(candidate.observed_at) === Date.parse(selected.observed_at));
    requireValue(sameTime.every(candidate => JSON.stringify(dot(candidate.row, spec.metric)) === JSON.stringify(value)), '同一观察时间存在冲突证据，不能挑选有利结果', 409, 'judgment_evidence_conflict');
    requireValue(roots.filter(source => sourceMatches(spec.provider, source.provider)).every(source => Date.parse(source.as_of) >= Date.parse(selected.observed_at)), '证据来源获取时间早于观察时间，来源中的未来预测不能充当已发生事实');
    return { outcome: Number(condition(value, spec)), value, observed_at: timestamp(selected.observed_at), dataset_id: datasetId,
      row_index: selected.index, dataset_hash: digest(JSON.stringify(dataset.rows)),
      fields: Object.fromEntries([...new Set([spec.metric, spec.observed_at_field, ...Object.keys(spec.selector)])].map(field => [field, dot(selected.row, field)])), roots };
  }
  bestEvidence(prediction) {
    const candidates = [];
    for (const data of this.host.datasets.list()) {
      try { candidates.push(this.evidence(prediction, data.id)); }
      catch (error) { if (error.code === 'judgment_evidence_conflict') throw error; }
    }
    requireValue(candidates.length, '尚无符合事前来源、对象、观察窗口的真实证据', 422, 'judgment_evidence_missing');
    candidates.sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
    const latest = candidates[0], sameTime = candidates.filter(item => item.observed_at === latest.observed_at);
    requireValue(sameTime.every(item => JSON.stringify(item.value) === JSON.stringify(latest.value)), '同一观察时间在不同数据集中存在冲突证据，不能选择有利结果', 409, 'judgment_evidence_conflict');
    return { latest, candidates };
  }
  resolve(conversationId, { judgment_id, dataset_id, reflection }) {
    this.assertMain(conversationId);
    const prediction = this.get('prediction', judgment_id);
    if (prediction.status === 'resolved') {
      requireValue(prediction.review.evidence.dataset_id === dataset_id, '已核验判断不能改写证据', 409); return prediction;
    }
    requireValue(Date.parse(this.now()) >= Date.parse(prediction.due_at), '尚未到验证时间');
    const evidence = this.evidence(prediction, dataset_id), { latest } = this.bestEvidence(prediction);
    requireValue(evidence.observed_at === latest.observed_at, '必须使用已登记证据中窗口内最后一次观察，不能挑选较早结果');
    const outcome = evidence.outcome;
    const review = { id: id('review'), judgment_id, resolved_at: this.now(), evidence,
      brier: (prediction.probability - outcome) ** 2, baseline_brier: (prediction.baseline_probability - outcome) ** 2,
      reflection: reflection ? text(reflection, '复盘摘要', 4000) : '已按事前登记的来源、对象、时间窗口和判断条件自动核验。' };
    this.transaction(() => { this.put('review', review); this.put('prediction', { ...prediction, status: 'resolved', review }); });
    this.evaluateRules(); this.refreshFiles(); return this.get('prediction', judgment_id);
  }
  defer(conversationId, { judgment_id, reason }) {
    this.assertMain(conversationId); const prediction = this.get('prediction', judgment_id);
    requireValue(prediction.status !== 'resolved', '已核验判断不能改为待证据', 409);
    requireValue(Date.parse(this.now()) >= Date.parse(prediction.due_at), '尚未到验证时间');
    const attempts = prediction.review_attempts + 1;
    const next = new Date(Date.parse(this.now()) + Math.min(7, 2 ** Math.min(attempts - 1, 3)) * this.policy.retry_hours * 3600000).toISOString();
    const result = this.put('prediction', { ...prediction, status: 'awaiting_evidence', evidence_gap: text(reason, '缺失证据原因', 2000), review_attempts: attempts, next_review_at: next });
    this.evaluateRules(); this.refreshFiles(); return result;
  }
  reflect(conversationId, { judgment_id, analysis, rule_ids = [], no_change_reason }) {
    this.assertMain(conversationId);
    const prediction = this.get('prediction', judgment_id);
    requireValue(prediction.status === 'resolved', '先取得真实证据并核验，再做归因复盘');
    analysis = text(analysis, '证据、错误归因、适用边界与后续验证', 6000);
    requireValue(Array.isArray(rule_ids) && rule_ids.length <= 10, '复盘最多关联 10 条准则');
    for (const key of rule_ids) requireValue(this.get('rule', key).evidence_ids.includes(judgment_id), '关联准则必须引用本判断作为形成依据');
    if (!rule_ids.length) no_change_reason = text(no_change_reason, '当前无需新增准则的原因', 2000);
    const content = { analysis, rule_ids: [...new Set(rule_ids)], no_change_reason: no_change_reason ?? null };
    if (prediction.review.semantic) {
      const { completed_at, ...previous } = prediction.review.semantic;
      requireValue(JSON.stringify(previous) === JSON.stringify(content), '已完成的归因复盘不可覆盖；新假设可创建新版候选准则', 409);
      return prediction;
    }
    const review = { ...prediction.review, semantic: { ...content, completed_at: this.now() } };
    this.transaction(() => { this.put('review', review); this.put('prediction', { ...prediction, review }); });
    this.refreshFiles(); return this.get('prediction', judgment_id);
  }
  proposeRule(conversationId, args) {
    this.assertMain(conversationId);
    const rule = this.idempotent('rule', args.command_id, args, () => {
      for (const name of ['title', 'guideline', 'topic', 'regime', 'limitations']) text(args[name], name, name === 'guideline' ? 4000 : 2000);
      requireValue(Array.isArray(args.evidence_ids) && args.evidence_ids.length > 0 && args.evidence_ids.length <= 20, '候选准则需绑定 1–20 个已复盘判断');
      const evidenceIds = [...new Set(args.evidence_ids)];
      for (const key of evidenceIds) requireValue(this.get('prediction', key).status === 'resolved', '准则只能引用已复盘判断');
      if (args.parent_rule_id) this.get('rule', args.parent_rule_id);
      requireValue(this.list('rule').filter(rule => rule.status !== 'retired' && rule.topic === args.topic).length < 10, '同一主题最多保留 10 个在试准则；请先退休不再适用的准则');
      return this.put('rule', { id: id('criterion'), version: 1, title: args.title, guideline: args.guideline, topic: args.topic, regime: args.regime,
        limitations: args.limitations, evidence_ids: evidenceIds, parent_rule_id: args.parent_rule_id ?? null,
        created_at: this.now(), status: 'candidate', evaluation: null });
    });
    this.refreshFiles(); return rule;
  }
  ruleEvaluation(rule) {
    const allRules = this.list('rule');
    const family = allRules.length, trial = allRules.findIndex(item => item.id === rule.id) + 1;
    const predictions = this.list('prediction').filter(prediction => Date.parse(prediction.created_at) >= Date.parse(rule.created_at) &&
      !rule.evidence_ids.includes(prediction.id) && prediction.rule_predictions.some(shadow => shadow.rule_id === rule.id && shadow.rule_version === rule.version));
    const due = predictions.filter(item => Date.parse(item.due_at) <= Date.parse(this.now()));
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
    const alpha = this.policy.alpha / (2 * Math.max(1, trial) * (Math.max(1, trial) + 1) * inspection * (inspection + 1));
    // Hoeffding lower bound for paired improvements in [-1,1], adjusted for all
    // candidates and sample counts. These are conservative operational gates, not a
    // guarantee of future profitability or a test that proves market independence.
    const lower = n ? improvement - Math.sqrt(2 * Math.log(1 / alpha) / n) : null;
    const baselineLower = n ? baselineImprovement - Math.sqrt(2 * Math.log(1 / alpha) / n) : null;
    const windows = new Set(unique.map(item => item.due_at.slice(0, 10))).size;
    const pending = due.length - resolved.length;
    const accepted = n >= this.policy.min_samples && windows >= this.policy.min_windows && pending === 0 && lower > 0 && baselineLower > 0;
    return { evaluated_at: this.now(), registered: predictions.length, resolved: resolved.length, unresolved_due: pending,
      independent_blocks: n, calendar_windows: windows, candidate_trials: family, trial_index: trial,
      inspection_index: inspection, evidence_fingerprint: evidenceFingerprint, mean_brier_improvement: improvement,
      lower_bound: lower, mean_baseline_brier_improvement: baselineImprovement, baseline_lower_bound: baselineLower, adjusted_alpha: alpha, accepted,
      reason: accepted ? '前瞻影子样本同时超过主判断与事前基准的保守门槛；仍需观察适用条件与漂移' : pending ? '到期样本尚未全部核验，不能选择性跳过失败或缺失结果' : n < this.policy.min_samples || windows < this.policy.min_windows ? '前瞻独立样本或时间窗口不足' : '未同时证明相对同期主判断与事前基准的概率评分改善' };
  }
  evaluateRules() {
    let changed = false;
    for (const rule of this.list('rule')) {
      if (rule.status === 'retired') continue;
      const evaluation = this.ruleEvaluation(rule);
      const status = evaluation.accepted ? 'active' : rule.status === 'active' || rule.status === 'probation' ? 'probation' : 'candidate';
      if (status !== rule.status || rule.evaluation?.evidence_fingerprint !== evaluation.evidence_fingerprint) changed = true;
      if (status !== rule.status) this.put('rule_event', { id: id('rule_event'), rule_id: rule.id, from: rule.status, to: status, created_at: this.now(), evaluation });
      this.put('rule', { ...rule, status, evaluation });
    }
    return changed;
  }
  retireRule(conversationId, { rule_id, reason }) {
    this.assertMain(conversationId); const rule = this.get('rule', rule_id);
    const result = this.put('rule', { ...rule, status: 'retired', retired_at: this.now(), retirement_reason: text(reason, '退休原因', 2000) });
    this.refreshFiles(); return result;
  }
  query(conversationId, { status, topic, limit = 30, offset = 0 } = {}) {
    this.assertMain(conversationId); requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 100 && Number.isInteger(offset) && offset >= 0, '分页参数无效');
    const items = this.list('prediction').filter(item => (!status || item.status === status) && (!topic || item.topic === topic)).reverse();
    return { items: items.slice(offset, offset + limit), total: items.length, next_offset: offset + limit < items.length ? offset + limit : null, criteria_path: join(this.directory, 'CRITERIA.md') };
  }
  read(conversationId, key) { this.assertMain(conversationId); return this.get('prediction', key); }
  rules(conversationId) { this.assertMain(conversationId); if (this.evaluateRules()) this.refreshFiles(); return { items: this.list('rule'), policy: this.policy, path: join(this.directory, 'CRITERIA.md') }; }
  statistics() {
    const all = this.list('prediction'), resolved = all.filter(item => item.status === 'resolved');
    const calibration = Array.from({ length: 5 }, (_, i) => {
      const records = resolved.filter(item => Math.min(4, Math.floor(item.probability * 5)) === i);
      return { range: [i / 5, (i + 1) / 5], count: records.length, mean_probability: mean(records.map(item => item.probability)), observed_rate: mean(records.map(item => item.review.evidence.outcome)) };
    });
    return { registered: all.length, resolved: resolved.length, awaiting_evidence: all.filter(item => item.status === 'awaiting_evidence').length,
      pending_reflections: resolved.filter(item => !item.review.semantic).length,
      pending_coverage: this.list('coverage').filter(item => item.status === 'pending').length,
      unchecked_statements: this.list('coverage').filter(item => item.status === 'pending').reduce((sum, item) => sum + item.statements.length, 0),
      pending: all.filter(item => item.status === 'pending').length, brier: mean(resolved.map(item => item.review.brier)),
      baseline_brier: mean(resolved.map(item => item.review.baseline_brier)), calibration,
      note: 'Brier 越低越好；未核验结果不计作命中。评分衡量判断校准，不等同于交易收益。' };
  }
  writeFile(name, content) {
    requireValue(!lstatSync(this.directory).isSymbolicLink(), '判断导出目录不能是符号链接');
    const path = join(this.directory, name), temp = `${path}.next`;
    requireValue(!existsSync(path) || !lstatSync(path).isSymbolicLink(), '判断导出文件不能是符号链接');
    rmSync(temp, { force: true }); writeFileSync(temp, content, { flag: 'wx', mode: 0o600 }); renameSync(temp, path);
  }
  refreshFiles() {
    const rules = this.list('rule'), stats = this.statistics(), active = rules.filter(rule => rule.status === 'active');
    const clean = value => String(value).replaceAll('\r', '').replaceAll('\n', ' ');
    this.writeFile('CRITERIA.md', `# 专属判断准则\n\n更新：${this.now()}\n\n这些准则是有适用范围的研究结论，不是系统指令或交易授权。主 Agent 在委派相关任务时，明确提醒 subagent 用 host_files_read 读取本文件并关注适用范围。\n\n` +
      (active.length ? active.map(rule => `## ${clean(rule.title)}\n\n- ID：${rule.id}，版本：${rule.version}\n- 适用：${clean(rule.topic)} / ${clean(rule.regime)}\n- 准则：${clean(rule.guideline)}\n- 局限：${clean(rule.limitations)}\n- 前瞻独立样本块：${rule.evaluation.independent_blocks}；对主判断 / 事前基准的 Brier 改善下界：${rule.evaluation.lower_bound.toFixed(4)} / ${rule.evaluation.baseline_lower_bound.toFixed(4)}\n`).join('\n') : '尚无通过前瞻验证门槛的专属准则。候选规则仅作为待验证假设，不宣称可靠。\n') +
      '\n## 基础复盘约定\n\n先登记判断、概率、对象、时间窗口与证据来源；事后按原口径核验。缺失证据保留待核验。新准则先前瞻影子验证，不能用生成它的同一批历史样本证明它有效。\n');
    this.writeFile('INDEX.md', `# 判断与复盘\n\n更新：${this.now()}\n\n登记 ${stats.registered}；已核验 ${stats.resolved}；待证据 ${stats.awaiting_evidence}；有效准则 ${active.length}；候选 ${rules.filter(rule => rule.status === 'candidate').length}。\n\n- CRITERIA.md：当前通过门槛的准则\n- metrics.json：概率评分与校准统计\n- recent.json：最近 30 个判断和证据摘要\n- 完整历史通过 judgment_list / judgment_read 查询，权威台账由主工作区内的 judgment-state 管理。\n\n主 Agent 按任务需要读取 judgment_review_queue 并决定何时复盘；不定时发送聊天消息或调用模型。外部资料不能改变判断工具权限。\n`);
    this.writeFile('metrics.json', JSON.stringify(stats, null, 2));
    this.writeFile('recent.json', JSON.stringify(this.list('prediction').slice(-30).map(({ review, ...item }) => ({ ...item, ...(review ? { review: { id: review.id, resolved_at: review.resolved_at, brier: review.brier, baseline_brier: review.baseline_brier, reflection: review.reflection, semantic: review.semantic ?? null, evidence: { dataset_id: review.evidence.dataset_id, dataset_hash: review.evidence.dataset_hash, value: review.evidence.value, observed_at: review.evidence.observed_at, outcome: review.evidence.outcome } } } : {}) })), null, 2));
  }
  auditTurn({ conversationId, responseId, status }) {
    if (!this.enabled() || status !== 'completed' || this.host.tasks.read(conversationId).scope !== 'main') return;
    const message = this.host.messages.read(responseId), input = this.host.messages.read(message.reply_to_message_id, true);
    if (input?.origin === 'automation') return;
    const content = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    if (!content.trim() || this.get('coverage', responseId, true)) return;
    const registered = this.list('prediction').filter(item => item.source_message_id === responseId);
    const sentences = content.split(/[。！？\n]+/).map(value => value.trim()).filter(value => value && /预计|预测|预期|目标价|概率|(?:明天|下周|未来|明年).{0,40}(?:上涨|下跌|达到|超过|低于)|\b(?:predict|forecast|probability|expect)\b/i.test(value) && !/^(?:我|我们)(?:会|将)|已登记|已核验|尚未|无法|没有.*(?:预测|概率)/.test(value));
    const unmatched = sentences.filter(sentence => !registered.some(item => sentence.includes(item.id) || sentence.includes(item.claim) || item.claim.includes(sentence)));
    // Keep a durable queue without waking the model. The Agent chooses when
    // to audit; regex hints never substitute for reading the full source.
    this.put('coverage', { id: responseId, conversation_id: conversationId, created_at: this.now(), status: 'pending',
      source_hash: digest(content), source_length: content.length, read_offset: 0, statements: unmatched.slice(0, 20), attempts: 0 });
  }
  auditSource(conversationId, { message_id, offset = 0, limit = 12000 }) {
    this.assertMain(conversationId); const coverage = this.get('coverage', message_id);
    requireValue(Number.isInteger(offset) && offset >= 0 && offset <= (coverage.read_offset ?? 0) && Number.isInteger(limit) && limit > 0 && limit <= 20000, '必须依次读取完整原文，不能跳过页；每页最多 20000 字符');
    const message = this.host.messages.read(message_id), content = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    requireValue(!coverage.source_hash || digest(content) === coverage.source_hash, '原始回复已变化，请重新检查');
    const end = Math.min(content.length, offset + limit);
    this.put('coverage', { ...coverage, read_offset: Math.max(coverage.read_offset ?? 0, end), source_length: content.length });
    return { message_id, source_text: content.slice(offset, end), offset, total: content.length, next_offset: end < content.length ? end : null,
      registered_judgments: this.list('prediction').filter(item => item.source_message_id === message_id).map(item => ({ id: item.id, claim: item.claim })) };
  }
  acknowledgeCoverage(conversationId, { message_id, judgment_ids = [], exclusions = [], review_summary }) {
    this.assertMain(conversationId); const coverage = this.get('coverage', message_id);
    requireValue((coverage.read_offset ?? 0) >= (coverage.source_length ?? 1), '请先用 judgment_audit_source 读完原文，不能只检查关键词提示');
    text(review_summary, '完整语义核对结论', 4000);
    requireValue(Array.isArray(judgment_ids) && Array.isArray(exclusions), '需要有效判断引用与不适用项');
    for (const key of judgment_ids) this.get('prediction', key);
    for (const item of exclusions) { text(item.statement, '原句', 2000); text(item.reason, '不适用原因', 2000); requireValue(coverage.statements.includes(item.statement), '排除项必须来自本次待核对原句'); }
    const handled = new Set(exclusions.map(item => item.statement));
    for (const statement of coverage.statements) if (judgment_ids.some(key => { const claim = this.get('prediction', key).claim; return claim === statement || statement.includes(claim); })) handled.add(statement);
    requireValue(coverage.statements.every(statement => handled.has(statement)), '仍有原句未登记或解释');
    const result = this.put('coverage', { ...coverage, status: 'reviewed', judgment_ids, exclusions, review_summary, completed_at: this.now() });
    this.refreshFiles(); return result;
  }
  reviewQueue(conversationId, { kind = 'all', offset = 0, limit = 30 } = {}) {
    this.assertMain(conversationId);
    requireValue(this.enabled(), '判断复盘插件未启用', 403);
    requireValue(['all', 'due', 'reflection', 'coverage'].includes(kind) && Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 100, '复盘清单参数无效');
    const now = Date.parse(this.now());
    const items = [
      ...this.list('prediction').filter(item => item.status !== 'resolved' && Date.parse(item.next_review_at) <= now)
        .map(item => ({ kind: 'due', judgment_id: item.id, claim: item.claim, topic: item.topic, due_at: item.due_at, evidence_gap: item.evidence_gap ?? null })),
      ...this.list('prediction').filter(item => item.status === 'resolved' && !item.review.semantic)
        .map(item => ({ kind: 'reflection', judgment_id: item.id, claim: item.claim, resolved_at: item.review.resolved_at })),
      ...this.list('coverage').filter(item => item.status === 'pending')
        .map(item => ({ kind: 'coverage', message_id: item.id, created_at: item.created_at, hints: item.statements, source_length: item.source_length })),
    ].filter(item => kind === 'all' || item.kind === kind);
    return { items: items.slice(offset, offset + limit), total: items.length, offset,
      next_offset: offset + limit < items.length ? offset + limit : null, statistics: this.statistics(), criteria_path: join(this.directory, 'CRITERIA.md') };
  }
  reviewDue(conversationId) {
    this.assertMain(conversationId);
    requireValue(this.enabled(), '判断复盘插件未启用', 403);
    // Explicit Agent tool call only. This never starts a turn or fetches data.
    const now = Date.parse(this.now());
    const due = this.list('prediction').filter(item => item.status !== 'resolved' && Date.parse(item.next_review_at) <= now)
      .sort((a, b) => Date.parse(a.last_evidence_check_at ?? '1970-01-01T00:00:00Z') - Date.parse(b.last_evidence_check_at ?? '1970-01-01T00:00:00Z')).slice(0, 12);
    for (const prediction of due) {
      this.put('prediction', { ...prediction, last_evidence_check_at: this.now() });
      try { const { latest } = this.bestEvidence(prediction); this.resolve(conversationId, { judgment_id: prediction.id, dataset_id: latest.dataset_id }); }
      catch (error) { this.put('prediction', { ...this.get('prediction', prediction.id), evidence_gap: String(error.message).slice(0, 2000) }); }
    }
    this.evaluateRules(); this.refreshFiles();
    return { checked: due.length, resolved: due.filter(item => this.get('prediction', item.id).status === 'resolved').map(item => item.id),
      awaiting_evidence: due.filter(item => this.get('prediction', item.id).status !== 'resolved').map(item => ({ judgment_id: item.id, reason: this.get('prediction', item.id).evidence_gap })),
      statistics: this.statistics() };
  }
  async close() { if (this.closed) return; this.closed = true; this.db?.close(); }
}
