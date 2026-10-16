import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCapabilities } from '../packages/memory/index.js';
import { MemoryRepository } from '../packages/memory/repository.js';

const DAY = 86400000;
const source = id => ({ type: 'user_message', id });
const entry = (sources, patch = {}) => ({ category: 'trading/risk-rules', title: '单笔风险上限', summary: '单笔风险不能超过账户净值的 1%。',
  content: '账户 alpha 的每笔交易，止损处预计损失连同成本不得超过当时账户净值的 1%。', scope: { kind: 'global' }, evidence: 'explicit', sources, ...patch });

function repositoryFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sesame-trading-memory-'));
  let time = Date.parse('2026-01-01T00:00:00Z');
  const f = { beforeVerify: null };
  const repository = new MemoryRepository(directory, async (_cid, value) => {
    await f.beforeVerify?.(value);
    if (value.type !== 'user_message' || !value.id.startsWith('human-')) throw Object.assign(new Error('not human'), { code: 'memory_source_invalid' });
    return { type: 'user_message', id: value.id };
  }, { clock: () => time }).init();
  repository.contexts.set('main', { id: 'main', scope: 'main', runId: 'main-run' });
  repository.contexts.set('child', { id: 'child', scope: 'subagent', runId: 'child-run', project_id: 'other-project' });
  Object.assign(f, { repository, main: repository.facade('main'), child: repository.facade('child'),
    advance: days => { time += days * DAY; },
    risk: (id, patch = {}) => repository.save('main', { ...entry([source(id)], patch), confirmation_source: source(id) }),
  });
  t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
  return f;
}

function capabilityFixture(t) {
  const storageRoot = mkdtempSync(join(tmpdir(), 'sesame-trading-tools-')), messages = new Map(), models = [];
  const f = { respond: () => ({ entries: [] }) };
  const host = { context: { storageRoot, sessionId: 'main', kind: 'main', runId: 'run-main' },
    data: { async query({ source: querySource, input }) {
      if (querySource.providerId === 'host#sessions') return { items: [{ id: input.sessionId, kind: input.sessionId === 'main' ? 'main' : 'subagent', projectId: 'other-project' }] };
      if (querySource.providerId === 'host#messages') return { items: input.ids.map(id => messages.get(id)).filter(Boolean) };
      if (querySource.providerId === 'host#artifacts') return { items: [] };
      throw new Error('unexpected data source');
    } },
    resources: { async read() { throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' }); } },
    events: { async emit() { return { accepted: true }; } },
    capabilities: { async invoke(id, input) {
      assert.equal(id, 'host.model.complete'); models.push(input);
      return { type: 'result', value: { text: JSON.stringify(f.respond(input.input)) } };
    } },
  };
  const call = (name, input = {}, sessionId = 'main') => createCapabilities({ ...host,
    context: { ...host.context, sessionId, kind: sessionId === 'main' ? 'main' : 'subagent' },
  }).find(capability => capability.name === name).execute(input, new AbortController().signal);
  Object.assign(f, { call, messages, models,
    human(id, text = entry([]).content, patch = {}) {
      messages.set(id, { id, role: 'user', sourceSessionId: null, systemGenerated: false, ownerRunId: null, origin: 'human', content: [{ type: 'text', text }], ...patch });
      return source(id);
    },
    compact(id, evidence, sessionId = 'main') {
      return call('memory_before_compact', { checkpointId: id, messages: [{ source: evidence }], model: { provider: 'fixture', id: 'test' } }, sessionId);
    },
  });
  t.after(async () => { await call('memory_dispose'); rmSync(storageRoot, { recursive: true, force: true }); });
  return f;
}

test('trading categories retain applicability and context summaries retain source references', async t => {
  const f = repositoryFixture(t), scope = { kind: 'strategy', project_id: 'project-a', strategy_id: 'strategy-a' };
  const style = await f.main.save(entry([source('human-style')], { category: 'trading/style', title: '持仓风格', scope }));
  const knowledge = await f.main.save(entry([source('human-knowledge')], { category: 'trading/strategy-knowledge', title: '策略条件', evidence: 'inferred', scope }));
  const context = f.child.tradingContext();
  assert.deepEqual(context.totals, { risk_rules: 0, style: 1, strategy_knowledge: 1 });
  assert.equal(context.risk_state, 'missing'); assert.equal(context.complete, true);
  assert.deepEqual(context.style[0].scope, scope); assert.deepEqual(context.style[0].sources, style.sources);
  assert.equal('content' in context.style[0], false);
  assert.equal(context.strategy_knowledge[0].id, knowledge.id);
  assert.deepEqual(f.main.tree().categories.trading, ['style', 'risk-rules', 'strategy-knowledge']);
  assert.throws(() => f.main.tradingContext({ limit: 21 }), /1–20/);
});

test('risk saves require an authentic top-level human confirmation and record its provenance', async t => {
  const f = capabilityFixture(t), evidence = f.human('evidence'), confirmation = f.human('confirmation');
  const save = confirmation_source => f.call('memory_manage', { action: 'save', entry: entry([evidence]), ...(confirmation_source ? { confirmation_source } : {}) });
  await assert.rejects(save(), error => error.code === 'memory_risk_confirmation_required' && /confirmation_source/.test(error.message));
  await assert.rejects(save({ type: 'artifact', id: 'artifact' }), { code: 'memory_risk_confirmation_required' });
  await assert.rejects(save(source('missing')), { code: 'memory_risk_confirmation_required' });
  for (const patch of [{ role: 'assistant' }, { sourceSessionId: 'parent' }, { systemGenerated: true }, { ownerRunId: 'run' }, { origin: 'system' }]) {
    const invalid = f.human('invalid', 'system text', patch);
    await assert.rejects(save(invalid), { code: 'memory_risk_confirmation_required' });
  }
  await assert.rejects(f.call('memory_manage', { action: 'save', entry: { ...entry([evidence]), confirmation_source: confirmation } }), { code: 'memory_risk_confirmation_required' });
  await assert.rejects(f.call('memory_manage', { action: 'save', entry: entry([evidence], { category: ' trading/risk-rules ' }) }), { code: 'memory_risk_confirmation_required' });
  const saved = await save(confirmation);
  assert.equal(saved.pinned, true); assert.equal(saved.expires_at, null); assert.deepEqual(saved.confirmed_by, confirmation);
  assert.deepEqual(saved.sources, [evidence, confirmation]);
  const context = await f.call('memory_trading_context', {}, 'child');
  assert.equal(context.risk_state, 'documented'); assert.equal(context.risk_rules[0].content, saved.content);
  assert.deepEqual(context.risk_rules[0].sources, saved.sources);
});

test('formal risk rules reject inference, expiry, unpinning and category downgrades', async t => {
  const f = repositoryFixture(t);
  for (const patch of [{ evidence: 'inferred' }, { evidence: 'verified' }, { evidence: 'conflicted' }, { pinned: false }, { expires_at: '2030-01-01' }]) {
    await assert.rejects(f.risk('human-invalid', patch), { code: 'memory_risk_protected' });
  }
  const saved = await f.risk('human-create');
  for (const patch of [{ category: 'trading/style' }, { evidence: 'inferred' }, { pinned: false }, { expires_at: '2030-01-01' }]) {
    await assert.rejects(f.main.save({ id: saved.id, expected_version: saved.version, ...patch, confirmation_source: source('human-update') }), { code: 'memory_risk_protected' });
  }
  assert.equal(f.main.read(saved.id).version, 1);
});

test('a confirmed ordinary memory becomes a pinned risk rule without an explicit pinned field', async t => {
  const f = repositoryFixture(t);
  const ordinary = await f.main.save(entry([source('human-style')], { category: 'trading/style', pinned: false }));
  const risk = await f.main.save({ id: ordinary.id, expected_version: ordinary.version, category: 'trading/risk-rules',
    content: '账户 alpha 每笔预计损失最多 0.5%。', confirmation_source: source('human-confirm-risk') });
  assert.equal(risk.pinned, true); assert.equal(risk.category, 'trading/risk-rules');
  assert.deepEqual(risk.confirmed_by, source('human-confirm-risk')); assert.equal(f.main.tradingContext().risk_state, 'documented');
});

test('archiving a superseded risk resolves candidate conflicts while restoring it rechecks active rules', async t => {
  const f = repositoryFixture(t), original = await f.risk('human-original');
  const candidate = await f.child.propose(entry([source('human-proposal')], { content: '账户 alpha 每笔预计损失最多 0.5%。' }));
  const accepted = await f.main.resolveCandidate({ id: candidate.id, expected_version: candidate.version, action: 'accept', confirmation_source: source('human-accept') });
  let replacement = accepted.memory;
  assert.equal(f.main.tradingContext().risk_state, 'needs_review');
  let archived = await f.main.archive(original.id, f.main.read(original.id).version, source('human-archive'));
  assert.equal(archived.status, 'archived'); assert.equal(f.main.tradingContext().risk_state, 'documented');
  assert.deepEqual(f.main.read(replacement.id).conflicts_with, []);
  replacement = await f.main.save({ id: replacement.id, expected_version: replacement.version, conflicts_with: [], confirmation_source: source('human-merge') });
  assert.equal(replacement.status, 'hot'); assert.deepEqual(f.repository.raw(replacement.id).conflicts_with, []);
  assert.equal(f.main.tradingContext().risk_state, 'documented', 'a save must not reintroduce an archived risk conflict');
  const restored = await f.main.restore(original.id, archived.version, source('human-restore'));
  assert.equal(restored.status, 'conflict');
  assert.equal(f.main.read(replacement.id).status, 'conflict', 'restoration rechecks conflicting content even after the stored link was cleared');
  assert.deepEqual(f.main.read(replacement.id).conflicts_with, [original.id]);
  assert.equal(f.main.tradingContext().risk_state, 'needs_review');
  archived = await f.main.archive(original.id, restored.version, source('human-rearchive'));
  assert.equal(f.main.tradingContext().risk_state, 'documented');
  assert.equal(f.main.read(original.id).content, original.content, 'resolving a conflict does not require forgetting history');
  assert.equal(f.repository.db.prepare('SELECT COUNT(*) AS count FROM memory_history WHERE id=?').get(original.id).count, 3);
  assert.equal(archived.manually_archived, true);
});

test('risk-specific archived conflict handling does not change ordinary memory conflicts', async t => {
  const f = repositoryFixture(t), category = 'trading/strategy-knowledge';
  const original = await f.main.save(entry([source('human-one')], { category, title: 'Ordinary fact' }));
  const replacement = await f.main.save(entry([source('human-two')], { category, title: 'Ordinary fact', content: 'A conflicting ordinary conclusion.' }));
  await f.main.archive(original.id, f.main.read(original.id).version);
  assert.equal(f.main.read(replacement.id).status, 'conflict');
  assert.ok(f.main.read(replacement.id).conflicts_with.includes(original.id));
});

test('each risk edit, archive, restore and forget requires a different verified user message', async t => {
  const f = repositoryFixture(t);
  let saved = await f.risk('human-create');
  await assert.rejects(f.main.save({ id: saved.id, expected_version: saved.version, content: '修改', confirmation_source: source('human-create') }), { code: 'memory_risk_confirmation_required' });
  saved = await f.main.save({ id: saved.id, expected_version: saved.version, content: '单笔上限修改为 0.5%。', confirmation_source: source('human-update') });
  await assert.rejects(f.main.archive(saved.id, saved.version), { code: 'memory_risk_confirmation_required' });
  await assert.rejects(f.main.archive(saved.id, saved.version, source('human-update')), { code: 'memory_risk_confirmation_required' });
  saved = await f.main.archive(saved.id, saved.version, source('human-archive'));
  assert.equal(saved.manually_archived, true); assert.equal(f.main.tradingContext().totals.risk_rules, 0);
  const used = await f.main.markUsed({ id: saved.id, source: source('human-adoption'), reason: '审计引用已撤销规则' });
  assert.equal(used.manually_archived, true, 'adoption cannot restore a revoked risk rule');
  await assert.rejects(f.main.restore(saved.id, saved.version, source('human-archive')), { code: 'memory_risk_confirmation_required' });
  saved = await f.main.restore(saved.id, saved.version, source('human-restore'));
  assert.equal(saved.manually_archived, false); assert.deepEqual(saved.confirmed_by, source('human-restore'));
  assert.equal(f.repository.db.prepare('SELECT COUNT(*) AS count FROM memory_history WHERE id=?').get(saved.id).count, 3);
  assert.ok(!saved.sources.some(value => value.id === 'human-archive'));
  const archivedHistory = JSON.parse(f.repository.db.prepare('SELECT body FROM memory_history WHERE id=? AND version=3').get(saved.id).body);
  assert.deepEqual(archivedHistory.confirmed_by, source('human-archive'));
  await assert.rejects(f.main.forget(saved.id, saved.version, source('human-restore')), { code: 'memory_risk_confirmation_required' });
  const receipt = await f.main.forget(saved.id, saved.version, source('human-forget'));
  assert.deepEqual(receipt.confirmed_by, source('human-forget'));
  assert.throws(() => f.main.read(saved.id), { code: 'memory_not_found' });
  assert.equal(f.repository.db.prepare('SELECT COUNT(*) AS count FROM memory_history WHERE id=?').get(saved.id).count, 0);
});

test('subagents can read and propose but accepting risk candidates needs a fresh supplied confirmation', async t => {
  const f = capabilityFixture(t), evidence = f.human('evidence'), confirmation = f.human('confirmation');
  await assert.rejects(f.call('memory_manage', { action: 'save', entry: entry([evidence]), confirmation_source: confirmation }, 'child'), { code: 'memory_read_only' });
  const candidate = await f.call('memory_propose', entry([evidence]), 'child');
  const pending = await f.call('memory_trading_context', {}, 'child');
  assert.equal(pending.pending_risk_candidates, 1); assert.equal(pending.risk_state, 'missing'); assert.deepEqual(pending.risk_rules, []);
  const accept = patch => f.call('memory_manage', { action: 'accept', id: candidate.id, expected_version: candidate.version, ...patch });
  await assert.rejects(accept({}), { code: 'memory_risk_confirmation_required' });
  await assert.rejects(accept({ entry: { category: 'trading/style' }, confirmation_source: confirmation }), { code: 'memory_risk_protected' });
  await assert.rejects(accept({ entry: { confirmation_source: confirmation } }), { code: 'memory_risk_confirmation_required' });
  const accepted = await accept({ confirmation_source: confirmation });
  assert.deepEqual(accepted.memory.confirmed_by, confirmation); assert.equal(accepted.memory.pinned, true);
  const context = await f.call('memory_trading_context', {}, 'child');
  assert.equal(context.pending_risk_candidates, 0); assert.equal(context.risk_rules[0].id, accepted.memory.id);
});

test('risk rules survive maintenance and context reads without fabricating adoption', async t => {
  const f = repositoryFixture(t), risk = await f.risk('human-risk', { value: 'low' });
  const oldConstraint = await f.main.save(entry([source('human-old')], { category: 'user/constraints', title: '旧固定约束' }));
  const style = await f.main.save(entry([source('human-style')], { category: 'trading/style', title: '待核实风格', evidence: 'inferred', value: 'low' }));
  f.advance(366); f.repository.maintain();
  assert.equal(f.main.read(risk.id).status, 'hot'); assert.equal(f.main.read(oldConstraint.id).status, 'hot');
  assert.equal(f.main.read(style.id).status, 'archived', 'a personal style may cool but must not be automatically deleted');
  assert.equal(f.main.search({ query: '单笔风险上限' }).items[0].id, risk.id);
  assert.equal(f.child.tradingContext().risk_rules[0].id, risk.id);
  const unchanged = f.main.read(risk.id);
  assert.equal(unchanged.last_used_at, null); assert.equal(unchanged.use_count, 0); assert.equal(unchanged.version, 1);
});

test('repeated confirmed edits keep source lists bounded while history retains old confirmations', async t => {
  const f = repositoryFixture(t), evidence = source('human-evidence');
  let saved = await f.risk('human-confirm-0', { sources: [evidence] });
  for (let i = 1; i <= 25; i++) {
    saved = await f.main.save({ id: saved.id, expected_version: saved.version, summary: `已确认修订 ${i}`, confirmation_source: source(`human-confirm-${i}`) });
    assert.deepEqual(saved.sources, [evidence, source(`human-confirm-${i}`)]);
  }
  assert.equal(saved.version, 26);
  const history = f.repository.db.prepare('SELECT body FROM memory_history WHERE id=?').all(saved.id).map(row => JSON.parse(row.body));
  assert.equal(history.length, 25);
  assert.ok(history.some(value => value.confirmed_by.id === 'human-confirm-0'));
  assert.ok(history.some(value => value.confirmed_by.id === 'human-confirm-24'));
});

test('trading context includes all risks beyond the startup limit and bounds only style and knowledge groups', async t => {
  const f = repositoryFixture(t), riskIds = [];
  for (let i = 0; i < 25; i++) riskIds.push((await f.risk(`human-risk-${i}`, { title: `风险 ${i}`, scope: { kind: 'project', project_id: `project-${i}` } })).id);
  for (const category of ['trading/style', 'trading/strategy-knowledge']) for (let i = 0; i < 3; i++) {
    await f.main.save(entry([source(`human-${i}`)], { category, title: `${category} ${i}` }));
  }
  assert.equal(f.main.index().items.length, 20);
  const context = f.child.tradingContext({ limit: 2 });
  assert.equal(context.risk_state, 'documented'); assert.equal(context.complete, true);
  assert.deepEqual(new Set(context.risk_rules.map(value => value.id)), new Set(riskIds));
  assert.equal(context.style.length, 2); assert.equal(context.strategy_knowledge.length, 2);
  assert.deepEqual(context.totals, { risk_rules: 25, style: 3, strategy_knowledge: 3 });
});

test('risk context preserves full bodies and explicitly reports every risk omitted by its budget', async t => {
  const f = repositoryFixture(t), riskIds = [];
  for (let i = 0; i < 4; i++) riskIds.push((await f.risk(`human-long-${i}`, { title: `长风险 ${i}`, content: 'x'.repeat(19980) + '单笔不能超过净值1%'.padEnd(20, '。') })).id);
  const context = f.main.tradingContext({ limit: 1 });
  assert.equal(context.risk_state, 'needs_review'); assert.equal(context.complete, false);
  assert.equal(context.totals.risk_rules, 4); assert.equal(context.risk_rules.length, 1); assert.equal(context.unread_risk_rule_ids.length, 3);
  assert.deepEqual(new Set([...context.risk_rules.map(value => value.id), ...context.unread_risk_rule_ids]), new Set(riskIds));
  for (const risk of context.risk_rules) assert.equal(risk.content, f.main.read(risk.id).content);
  assert.ok(Buffer.byteLength(JSON.stringify(context, null, 2)) <= 32000);
  assert.equal(context.risk_offset, 0); assert.equal(context.next_risk_offset, null);
});

test('oversized UTF-8 risk bodies are identified and can be completely read using bounded pages', async t => {
  const f = capabilityFixture(t), evidence = f.human('human-long'), content = '风险'.repeat(9990) + '账户净值1%'.padEnd(20, '。');
  const saved = await f.call('memory_manage', { action: 'save', entry: entry([evidence], { content }), confirmation_source: evidence });
  const context = await f.call('memory_trading_context');
  assert.equal(context.risk_state, 'needs_review'); assert.equal(context.complete, false);
  assert.deepEqual(context.risk_rules, []); assert.deepEqual(context.unread_risk_rule_ids, [saved.id]);
  let offset = 0, reconstructed = '';
  do {
    const page = await f.call('memory_read', { id: saved.id, offset }, 'child');
    assert.equal(page.offset, offset); assert.equal(page.total_content_length, content.length); assert.equal(page.content_complete, false);
    assert.ok(page.content.length <= 4000); assert.equal(page.version, saved.version); assert.deepEqual(page.sources, saved.sources);
    reconstructed += page.content; offset = page.next_offset;
  } while (offset !== null);
  assert.equal(reconstructed, content);
  assert.equal((await f.call('memory_read', { id: saved.id })).content, content, 'ordinary internal-compatible reads remain unchanged');
  await assert.rejects(f.call('memory_read', { id: saved.id, offset: -1 }), /offset/);
  await assert.rejects(f.call('memory_read', { id: saved.id, length: 4001 }), /length/);
});

test('large risk ID lists page in stable ID order without exceeding the complete response budget', async t => {
  const f = repositoryFixture(t), first = await f.risk('human-template', { content: 'Never assume missing evidence is zero risk.' });
  const raw = f.repository.raw(first.id), ids = new Set([first.id]);
  f.repository.transaction(() => {
    for (let i = 0; i < 900; i++) {
      const id = `mem_fixture_${String(i).padStart(8, '0')}`; ids.add(id);
      f.repository.record({ ...raw, id, title: `Risk ${i}` });
    }
  });
  const seen = new Set(); let offset = 0, pages = 0;
  do {
    const page = f.main.tradingContext({ risk_offset: offset }); pages++;
    assert.equal(page.totals.risk_rules, ids.size); assert.equal(page.risk_offset, offset);
    assert.equal(page.complete, false); assert.equal(page.risk_state, 'needs_review');
    const rendered = JSON.stringify(page, null, 2);
    assert.ok(Buffer.byteLength(rendered) <= 32000); assert.ok(rendered.split('\n').length <= 1800);
    for (const id of [...page.risk_rules.map(value => value.id), ...page.unread_risk_rule_ids]) { assert.ok(!seen.has(id)); seen.add(id); }
    if (page.next_risk_offset !== null) assert.ok(page.next_risk_offset > offset);
    offset = page.next_risk_offset;
  } while (offset !== null);
  assert.ok(pages > 1); assert.deepEqual(seen, ids);
});

test('conflicts, review dates and legacy expired or unconfirmed risks remain visible for review', async t => {
  const f = repositoryFixture(t);
  const first = await f.risk('human-first'), second = await f.risk('human-second', { content: '账户 alpha 单笔上限是 2%。' });
  let context = f.main.tradingContext();
  assert.equal(context.risk_state, 'needs_review'); assert.equal(context.risk_rules.length, 2);
  assert.ok(context.risk_rules.every(value => value.status === 'conflict'));
  const review = await f.risk('human-review', { title: '需复核红线', review_at: '2026-01-02' });
  const legacy = await f.risk('human-legacy', { title: '旧记录' }), raw = f.repository.raw(legacy.id);
  raw.expires_at = '2026-01-02'; delete raw.confirmed_by; f.repository.record(raw);
  f.advance(2); f.repository.maintain(); context = f.child.tradingContext();
  assert.equal(context.risk_state, 'needs_review'); assert.equal(context.complete, true);
  assert.equal(context.risk_rules.find(value => value.id === review.id).review_due, true);
  assert.equal(context.risk_rules.find(value => value.id === legacy.id).status, 'expired');
  assert.ok(context.risk_rules.some(value => value.id === first.id)); assert.ok(context.risk_rules.some(value => value.id === second.id));
});

test('automatic compaction only proposes new and changed risk rules, never accepts a risk candidate', async t => {
  const f = capabilityFixture(t), first = f.human('first'), confirmation = f.human('confirmation');
  const proposal = (input, patch = {}) => ({ category: 'trading/risk-rules', scope: { kind: 'global' }, title: '单笔风险上限', summary: '单笔风险上限',
    content: input.documents[0].text, evidence: 'explicit', citations: [{ key: input.documents[0].key, quote: input.documents[0].text }], ...patch });
  f.respond = input => ({ entries: [proposal(input)] });
  assert.equal((await f.compact('first-pass', first)).counts.proposed, 1);
  let context = await f.call('memory_trading_context');
  assert.equal(context.risk_rules.length, 0); assert.equal(context.pending_risk_candidates, 1);
  const repeated = f.human('repeated', '账户 alpha 每笔交易的止损预计损失不得超过净值的 0.8%。');
  const candidate = await f.call('memory_propose', entry([repeated], { content: f.messages.get('repeated').content[0].text }));
  f.respond = input => ({ entries: [proposal(input, { candidateId: candidate.id })] });
  assert.equal((await f.compact('candidate-pass', repeated)).counts.deferred, 1);
  context = await f.call('memory_trading_context'); assert.equal(context.risk_rules.length, 0);
  const saved = await f.call('memory_manage', { action: 'save', entry: entry([first]), confirmation_source: confirmation });
  const changed = f.human('changed', '账户 alpha 每笔交易止损预计损失不得超过净值的 0.5%。');
  f.respond = input => ({ entries: [proposal(input, { targetId: saved.id })] });
  assert.equal((await f.compact('changed-pass', changed)).counts.proposed, 1);
  const after = await f.call('memory_read', { id: saved.id });
  assert.equal(after.content, saved.content); assert.equal(after.version, saved.version); assert.deepEqual(after.confirmed_by, confirmation);
});

test('automatic compaction keeps legacy user constraints protected and subagent risk output proposed', async t => {
  const f = capabilityFixture(t), first = f.human('first', '报告必须保留真实数据口径。');
  const saved = await f.call('memory_manage', { action: 'save', entry: entry([first], { category: 'user/constraints', title: '数据口径', content: '报告必须保留真实数据口径。' }) });
  const changed = f.human('changed', '报告必须保留真实数据口径和时间范围。');
  f.respond = input => ({ entries: [{ category: 'user/constraints', scope: { kind: 'global' }, title: '数据口径', summary: '保留依据',
    content: input.documents[0].text, evidence: 'explicit', targetId: saved.id, citations: [{ key: input.documents[0].key, quote: input.documents[0].text }] }] });
  assert.equal((await f.compact('constraint-pass', changed)).counts.proposed, 1);
  assert.equal((await f.call('memory_read', { id: saved.id })).content, saved.content);
  const childSource = f.human('child-evidence', '账户 beta 单笔损失不得超过净值 0.5%。');
  f.respond = input => ({ entries: [{ category: 'trading/risk-rules', scope: { kind: 'global' }, title: 'beta 风险', summary: '单笔 0.5%',
    content: input.documents[0].text, evidence: 'explicit', citations: [{ key: input.documents[0].key, quote: input.documents[0].text }] }] });
  assert.equal((await f.compact('child-pass', childSource, 'child')).counts.proposed, 1);
  assert.equal((await f.call('memory_trading_context')).risk_rules.length, 0);
});

for (const action of ['save', 'archive', 'restore', 'forget']) test(`${action} rechecks the risk version after asynchronous confirmation`, async t => {
  const f = repositoryFixture(t), saved = await f.risk('human-original');
  let changed = false;
  f.beforeVerify = value => {
    if (value.id !== 'human-next' || changed) return;
    changed = true;
    const latest = f.repository.raw(saved.id); latest.version++; latest.summary = 'A concurrent correction'; f.repository.record(latest);
  };
  const operation = action === 'save'
    ? f.main.save({ id: saved.id, expected_version: saved.version, summary: 'A stale edit', confirmation_source: source('human-next') })
    : f.main[action](saved.id, saved.version, source('human-next'));
  await assert.rejects(operation, { code: 'version_conflict' });
  const current = f.main.read(saved.id);
  assert.equal(current.summary, 'A concurrent correction'); assert.equal(current.manually_archived, false);
  assert.deepEqual(current.confirmed_by, source('human-original'));
});
