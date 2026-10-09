import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, judgmentHost } from './judgment-host.js';
import { JudgmentService, independentBlocks } from '../packages/judgment-evolution/service.js';
import { definitions } from '../packages/judgment-evolution/tools.js';
import { Type } from '@sesame/plugin-sdk/schema';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mt5agent-judgment-test-'));
  const store = new Store(directory);
  store.put('conversation', { id: 'conv_main', scope: 'main', agent_role: 'orchestrator', status: 'idle', active_response_message_id: 'msg_origin' });
  store.put('conversation', { id: 'child', scope: 'subagent', agent_role: 'research', parent_conversation_id: 'conv_main' });
  let now = new Date('2026-01-01T00:00:00Z'), enabled = true;
  const calls = [];
  const host = judgmentHost(store, { isActive: () => enabled }), clock = () => now;
  const state = { service: new JudgmentService(host, { clock }).init() };
  const setTime = value => { now = new Date(value); };
  const data = (value, observed = now.toISOString(), extra = {}) => store.put('dataset', { id: `data_${Math.random().toString(36).slice(2)}`, rows: [{ symbol: 'TEST', value, observed, irrelevant: 'not retained as evidence' }],
    provenance: { source_kind: 'external', provider: 'https://quotes.example/prices', as_of: now.toISOString() }, ...extra });
  return { directory, store, calls, clock, setTime, data, get service() { return state.service; }, reopen: () => { state.service = new JudgmentService(host, { clock }).init(); }, enable: value => { enabled = value; }, dispose: async () => { await state.service.close(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
const prediction = (overrides = {}) => ({ command_id: 'prediction-one', claim: 'TEST 在指定时刻的 value 大于 10', topic: 'price', regime: 'trend', rationale: '明确的测试数据判断，不代表真实市场预测。', probability: 0.8,
  due_at: '2026-01-02T00:00:00Z', verification: { provider: 'https://quotes.example/prices', metric: 'value', observed_at_field: 'observed', op: 'gt', target: 10, selector: { symbol: 'TEST' } }, ...overrides });

test('future judgments freeze criteria, are idempotent, main-only and survive reopening', async () => {
  const app = fixture();
  try {
    const args = prediction(), record = app.service.record('conv_main', args);
    assert.equal(app.service.record('conv_main', args).id, record.id);
    assert.throws(() => app.service.record('conv_main', { ...args, probability: 0.6 }), /command_id/);
    assert.throws(() => app.service.record('child', prediction({ command_id: 'child' })), /仅供主/);
    assert.throws(() => app.service.record('conv_main', prediction({ command_id: 'past', due_at: '2025-12-31T00:00:00Z' })), /未来/);
    assert.throws(() => app.service.record('conv_main', prediction({ command_id: 'tz', due_at: '2026-01-02' })), /时区/);
    await app.service.close();
    app.reopen();
    assert.equal(app.service.read('conv_main', record.id).probability, 0.8);
    assert.match(readFileSync(join(app.service.directory, 'CRITERIA.md'), 'utf8'), /尚无通过/);
  } finally { await app.dispose(); }
});

test('resolution requires frozen source, object, observation time and real lineage; loss is computed', async () => {
  const app = fixture();
  try {
    const item = app.service.record('conv_main', prediction());
    assert.throws(() => app.service.resolve('conv_main', { judgment_id: item.id, dataset_id: app.data(12).id }), /尚未/);
    app.setTime(item.due_at);
    const resolve = data => app.service.resolve('conv_main', { judgment_id: item.id, dataset_id: data.id });
    assert.throws(() => resolve(app.data(12, item.due_at, { provenance: { provider: 'https://quotes.example.evil/prices', source_kind: 'external', as_of: item.due_at } })), /来源/);
    assert.throws(() => resolve(app.data(12, '2026-01-01T00:00:00Z')), /窗口/);
    assert.throws(() => resolve(app.data(12, '2026-01-02T00:00:00')), /窗口/);
    assert.throws(() => resolve(app.data(12, item.due_at, { rows: [{ symbol: 'OTHER', value: 12, observed: item.due_at }] })), /匹配/);
    assert.throws(() => resolve(app.data(12, item.due_at, { provenance: { provider: 'https://quotes.example/prices', source_kind: 'synthetic', as_of: item.due_at } })), /合成/);
    const conflicting = app.data(12, item.due_at, { rows: [{ symbol: 'TEST', value: 12, observed: item.due_at }, { symbol: 'TEST', value: 8, observed: item.due_at }] });
    assert.throws(() => resolve(conflicting), /冲突/);
    app.store.delete('dataset', conflicting.id);
    const good = app.data(12), result = resolve(good);
    assert.equal(result.review.evidence.outcome, 1); assert.ok(Math.abs(result.review.brier - 0.04) < 1e-9);
    assert.equal(result.review.baseline_brier, 0.25);
    assert.equal(result.review.evidence.fields.irrelevant, undefined);
    assert.equal(resolve(good).review.id, result.review.id);
    assert.throws(() => resolve(app.data(8)), /不能改写/);
    assert.throws(() => app.service.defer('conv_main', { judgment_id: item.id, reason: 'try to hide loss' }), /已核验/);
  } finally { await app.dispose(); }
});

test('latest observation selection is deterministic and descendant source provenance remains required', async () => {
  const app = fixture();
  try {
    const item = app.service.record('conv_main', prediction({ verification: { ...prediction().verification, window_start: '2026-01-01T12:00:00Z' } }));
    app.setTime(item.due_at);
    const source = app.data(5), derived = app.data(5, item.due_at, { input_ids: [source.id], provenance: { source_kind: 'derived', provider: 'pi/bwrap', as_of: item.due_at },
      rows: [{ symbol: 'TEST', value: 12, observed: '2026-01-01T12:01:00Z' }, { symbol: 'TEST', value: 5, observed: item.due_at }] });
    const resolved = app.service.resolve('conv_main', { judgment_id: item.id, dataset_id: derived.id });
    assert.equal(resolved.review.evidence.outcome, 0); assert.equal(resolved.review.evidence.value, 5);
    assert.equal(resolved.review.evidence.roots[0].dataset_id, source.id);
  } finally { await app.dispose(); }
});

test('Agent-initiated review resolves evidence without creating messages and respects disabling', async () => {
  const app = fixture();
  try {
    const item = app.service.record('conv_main', prediction());
    app.store.update('conversation', 'conv_main', { active_response_message_id: null });
    app.setTime(item.due_at);
    await app.service.reviewDue('conv_main'); await app.service.reviewDue('conv_main');
    assert.equal(app.calls.length, 0); assert.equal(app.service.reviewQueue('conv_main', { kind: 'due' }).items[0].judgment_id, item.id);
    const before = app.service.statistics(); assert.equal(before.resolved, 0);
    const delayed = app.service.defer('conv_main', { judgment_id: item.id, reason: 'provider delayed' });
    assert.equal(delayed.status, 'awaiting_evidence'); assert.ok(delayed.next_review_at > item.due_at);
    app.setTime(delayed.next_review_at); app.data(12, item.due_at);
    app.store.update('conversation', 'conv_main', { active_response_message_id: null });
    app.enable(false); assert.throws(() => app.service.reviewDue('conv_main'), /未启用/); assert.equal(app.service.statistics().resolved, 0);
    app.enable(true); await app.service.reviewDue('conv_main'); assert.equal(app.service.statistics().resolved, 1);
    assert.equal(app.calls.length, 0, 'reviews must never impersonate user messages');
    assert.equal(app.service.reviewQueue('conv_main', { kind: 'reflection' }).items[0].judgment_id, item.id);
    assert.equal(app.service.statistics().pending_reflections, 1);
    const args = { judgment_id: item.id, analysis: '测试中证据满足原条件；单次成功不足以支持可迁移规律。', no_change_reason: '等待更多成功与失败的独立样本。' };
    app.service.reflect('conv_main', args);
    assert.equal(app.service.statistics().pending_reflections, 0);
    assert.deepEqual(app.service.reflect('conv_main', args).review.semantic, app.service.read('conv_main', item.id).review.semantic);
    assert.throws(() => app.service.reflect('conv_main', { ...args, analysis: 'changed' }), /不可覆盖/);
  } finally { await app.dispose(); }
});

test('rule promotion uses only new preregistered shadow predictions and conservative independent blocks', async () => {
  const app = fixture();
  try {
    const origin = app.service.record('conv_main', prediction()); app.setTime(origin.due_at);
    app.service.resolve('conv_main', { judgment_id: origin.id, dataset_id: app.data(12).id });
    const args = { command_id: 'criterion-one', title: '测试准则', guideline: '独立测试中的条件性规则', topic: 'price', regime: 'trend', limitations: '仅用于这个构造测试', evidence_ids: [origin.id] };
    const rule = app.service.proposeRule('conv_main', args);
    assert.equal(app.service.proposeRule('conv_main', args).id, rule.id);
    assert.equal(app.service.ruleEvaluation(rule).independent_blocks, 0, 'formation evidence is not validation');
    assert.throws(() => app.service.record('conv_main', prediction({ command_id: 'selective', due_at: '2026-01-03T00:00:00Z' })), /每个未退休/);
    for (let i = 0; i < 31; i++) {
      const created = new Date(Date.UTC(2026, 0, 3 + i)).toISOString(), due = new Date(Date.UTC(2026, 0, 3 + i, 12)).toISOString();
      app.setTime(created);
      const entryArgs = prediction({ command_id: `shadow-${i}`, due_at: due, probability: 0, baseline_probability: 0, rule_predictions: [{ rule_id: rule.id, probability: 1 }] });
      const entry = app.service.record('conv_main', entryArgs);
      assert.equal(app.service.record('conv_main', entryArgs).id, entry.id, 'shadow validation must not mutate caller args');
      app.setTime(due); app.service.resolve('conv_main', { judgment_id: entry.id, dataset_id: app.data(12).id });
    }
    const active = app.service.get('rule', rule.id); assert.equal(active.status, 'active');
    assert.ok(active.evaluation.lower_bound > 0); assert.equal(active.evaluation.independent_blocks, 31);
    assert.match(readFileSync(join(app.service.directory, 'CRITERIA.md'), 'utf8'), new RegExp(rule.id));
    const next = new Date(Date.parse(app.service.now()) + 86400000).toISOString();
    const unresolved = app.service.record('conv_main', prediction({ command_id: 'unresolved', due_at: next, rule_predictions: [{ rule_id: rule.id, probability: 1 }] }));
    app.setTime(unresolved.due_at); app.service.evaluateRules();
    assert.equal(app.service.get('rule', rule.id).status, 'probation', 'unresolved due observations prevent cherry-picked promotion');
    assert.equal(app.service.get('rule', rule.id).evaluation.unresolved_due, 1);
    app.service.retireRule('conv_main', { rule_id: rule.id, reason: 'test complete' });
    assert.equal(app.service.get('rule', rule.id).status, 'retired');
  } finally { await app.dispose(); }
});

test('overlapping and duplicate events cannot manufacture independent validation samples', () => {
  const rows = [{ start: '2026-01-01T00:00:00Z', end: '2026-01-03T00:00:00Z', improvement: 1 },
    { start: '2026-01-02T00:00:00Z', end: '2026-01-04T00:00:00Z', improvement: 0 },
    { start: '2026-01-05T00:00:00Z', end: '2026-01-05T00:00:00Z', improvement: 0.5 }];
  assert.deepEqual(independentBlocks(rows), [0.5, 0.5]);
});

test('coverage requires full-source semantic review, including responses without keyword matches', async () => {
  const app = fixture();
  try {
    app.store.put('message', { id: 'input', role: 'user', content: [{ type: 'text', text: '分析 TEST' }] });
    app.store.put('message', { id: 'answer', role: 'assistant', reply_to_message_id: 'input', content: [{ type: 'text', text: '预计 TEST 明天上涨。' }] });
    app.service.auditTurn({ conversationId: 'conv_main', responseId: 'answer', status: 'completed' });
    assert.equal(app.service.statistics().unchecked_statements, 1);
    assert.throws(() => app.service.acknowledgeCoverage('conv_main', { message_id: 'answer', review_summary: 'skip', exclusions: [] }), /读完原文/);
    assert.throws(() => app.service.auditSource('conv_main', { message_id: 'answer', offset: 3 }), /跳过/);
    const page = app.service.auditSource('conv_main', { message_id: 'answer', limit: 5 }); assert.equal(page.next_offset, 5);
    app.service.auditSource('conv_main', { message_id: 'answer', offset: 5 });
    assert.throws(() => app.service.acknowledgeCoverage('conv_main', { message_id: 'answer', review_summary: 'done', exclusions: [{ statement: 'other', reason: 'none' }] }), /原句/);
    app.service.acknowledgeCoverage('conv_main', { message_id: 'answer', review_summary: '全文检查完毕，发现一条口径未补全的判断。', exclusions: [{ statement: '预计 TEST 明天上涨', reason: '缺少具体市场、观察口径，不能编造' }] });
    assert.equal(app.service.statistics().unchecked_statements, 0);
    app.store.put('message', { id: 'no_keyword', role: 'assistant', reply_to_message_id: 'input', content: [{ type: 'text', text: 'TEST will close above 10 on January 2.' }] });
    app.service.auditTurn({ conversationId: 'conv_main', responseId: 'no_keyword', status: 'completed' });
    assert.equal(app.service.statistics().pending_coverage, 1, 'keyword misses still receive full semantic audit');
    app.store.put('message', { id: 'automation', role: 'user', origin: 'automation', content: [] });
    app.store.put('message', { id: 'automation_answer', role: 'assistant', reply_to_message_id: 'automation', content: [{ type: 'text', text: '复盘完成' }] });
    app.service.auditTurn({ conversationId: 'conv_main', responseId: 'automation_answer', status: 'completed' });
    assert.equal(app.service.get('coverage', 'automation_answer', true), null, 'automatic reviews do not recursively review themselves');
  } finally { await app.dispose(); }
});

test('official judgment declarations match runtime schemas and declare main-only scope', () => {
  const manifest = JSON.parse(readFileSync(new URL('../packages/judgment-evolution/plugin.json', import.meta.url)));
  const tools = JSON.parse(readFileSync(new URL('../packages/judgment-evolution/tools.json', import.meta.url)));
  assert.equal(manifest.id, 'sesame/judgment-evolution'); assert.equal(manifest.agent_scope, 'main');
  assert.equal(manifest.default_state, 'mounted');
  assert.deepEqual(manifest.tool_names.toSorted(), definitions.map(([name]) => name).toSorted());
  for (const [name, description, properties] of definitions) {
    const declaration = tools.find(tool => tool.name === name);
    assert.equal(declaration.description, description);
    assert.deepEqual(declaration.parameters, JSON.parse(JSON.stringify(Type.Object(properties, { additionalProperties: false }))));
  }
});
